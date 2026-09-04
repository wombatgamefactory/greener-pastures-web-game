/**
 * The metric fold: one pass over (pre-move state, move, events, post-move
 * state) per decision, producing everything the 13 assertions, the per-card
 * funnel and the report read.
 *
 * Ticket 11's second confirmed decision is that NO engine change is needed for
 * any of this, and two tricks are why:
 *
 *   - **Surface rate** reads the reveal set off `task.revealed` on the STATE at
 *     the moment a `keep` answer is applied. The reveal is not in an event, but
 *     the harness holds `GameState` (it is in @gp/sim, which is allowed to), so
 *     it never needed to be.
 *   - **Activation count** is the count of `grow` moves on a building plus the
 *     count of `cardMove`s it offered, because those are the only two ways a
 *     card's own text fires by its owner's choice: `handlerFor().activate()`
 *     fires only from `doGrow`, and `applyMove` only from the card-move branch.
 *     The Wheat Tier 3 ACTION cards were the reason the second half existed -
 *     they had no threshold and were never grown, so a grow-only count reported
 *     them as never doing anything. ⚠️ ALL FIFTEEN TIER 3 CARDS BECAME ORDINARY
 *     GROW BUILDINGS ON 19/08/2026 and the ACTION concept went with them, so
 *     `cardMove` now has exactly one implementation in the catalogue - the
 *     Helping Hand's repeat. The second half of the count STAYS, because the
 *     repeat is a genuine firing of the Helping Hand and nothing else counts it,
 *     but it is no longer load-bearing for a whole tier.
 *
 * The honest gap, recorded rather than papered over: a passive that fires but
 * emits no card-tagged event - the Orchard Farmstead's draw modifier is the
 * clearest - is measured by its effect on the seat, not by a firing count. If
 * that proves insufficient the fix is one `abilityFired` event, and it is not
 * added pre-emptively.
 *
 * Two anti-rot lists live here. `EVENT_KINDS` and `MOVE_KINDS` must claim every
 * `GameEvent['e']` and every `Move['type']`; the smoke test checks them, so a
 * rules change that adds either fails the build rather than being folded into
 * silence.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveriesPerTile } from '@gp/data';
import type { CardId, GameEvent, GameState, Move, ScoreBreakdown, Seat, Task } from '@gp/engine';
import {
  MOVE_TYPES,
  anyBuildOption,
  bonusOpen,
  cardById,
  cropOf,
  faceOf,
  gameEndScores,
  handlerFor,
  isFull,
  isOrchardCard,
  player,
  score,
  noticeBoardOf,
  visitOptions,
} from '@gp/engine';
import type { PolicyId } from '@gp/bots';

import type { Decision } from './driver.js';
import type { Outcome } from './driver.js';

/**
 * Every event kind the fold has been taught to see. A kind mapped to `false`
 * is claimed as deliberately uninteresting, which is different from forgotten -
 * and it is the difference the smoke test enforces.
 */
export const EVENT_KINDS = {
  cardPlaced: true,
  cardsToHand: true,
  cardsDiscarded: true,
  deckToBarn: true,
  stackToBarn: true,
  harvested: true,
  doorUsed: true,
  meepleGained: true,
  meepleSpent: true,
  reshuffled: true,
  built: true,
  demolished: true,
  delivered: true,
  balloonMoved: true,
  discardToBarn: true,
  cardGifted: true,
  handToBarn: true,
  visited: true,
  endTriggered: true,
  turnEnded: true,
  demandSwapped: true,
  demandFaceDown: true,
  gameEnded: false,
} satisfies Record<GameEvent['e'], boolean>;

export const MOVE_KINDS = {
  task: true,
  cardMove: true,
  draw: true,
  bonusDraw: true,
  spendMeeple: true,
  build: true,
  grow: true,
  harvest: true,
  deliver: true,
  moveBalloon: true,
  visit: true,
  pass: true,
  endTurn: true,
} satisfies Record<Move['type'], boolean>;

/** What one card did in one game. Booleans are per-game, counts are totals. */
export interface CardFacts {
  /** Its deck was on the table. The denominator for surface rate. */
  inSupply: boolean;
  /** It appeared in a draw's reveal set at least once. */
  surfaced: boolean;
  /** It reached somebody's hand. The denominator for play and junk. */
  held: boolean;
  /** It was kept from a draw. */
  kept: boolean;
  /** It became a building. */
  played: boolean;
  /** It was spent as a visit fee, a build payment, or an end-of-turn discard. */
  junked: boolean;
  activations: number;
  /** VP it contributed at game end, per seat: printed face plus any endgame formula. */
  vp: number[];
  /** Seats that built it. */
  builtBy: Seat[];
}

/**
 * ⛔ `WorkerVisit` IS GONE (v31). It priced one worker-visit in coins both ways -
 * the wage the bank minted to the host against the coin payoff the visitor
 * declined at that same board - and v31 mints nothing at all: a visit is one
 * card in and one action out. Assertion 2 is re-pointed onto the only half of
 * the generosity that survives, which is the CARD, and `RivalFreight` below is
 * how it is counted.
 */

/**
 * FREIGHT GIVEN ACROSS THE TABLE, and the half of it that was actually banked.
 *
 * The generosity problem in v31 is a card and nothing else: you place a card on
 * a rival's Notice Board, they eventually Harvest that board, and your card
 * lands in their barn as exactly the mixed colour the island demands of them.
 * `placed` is the gift; `banked` is the gift that arrived. The gap between them
 * is the fee that died on a board nobody ever cleared, which is the one thing
 * that makes the transfer less than total.
 */
export interface RivalFreight {
  /** Fees placed on a RIVAL's Notice Board, by the seat that paid them. */
  paidBySeat: number[];
  /** Fees a seat RECEIVED from rivals on its own board. */
  receivedBySeat: number[];
  /** Of those received, the ones the host later harvested into their own barn. */
  bankedBySeat: number[];
  /** Fees received while the host was the sole VP leader. */
  toLeaderBySeat: number[];
}

export interface GameMetrics {
  readonly seed: string;
  readonly seats: number;
  readonly cell: string;
  readonly suits: readonly Suit[];
  readonly neutral: readonly Suit[];
  readonly profiles: readonly PolicyId[];
  outcome: Outcome;
  ended: boolean;
  /** Set only when `outcome` is 'crashed': the engine error, verbatim. */
  error: string | null;
  moves: number;
  rounds: number;
  chooseMs: number;

  scores: ScoreBreakdown[];
  ranking: Seat[];
  /** Sole winner, or null when the full tie-break chain still ties (seat order breaks it, so null is rare). */
  winner: Seat | null;

  /**
   * MEEPLES HELD, median across players, sampled at every round boundary - the
   * series that replaced `coinsByRound` when the currency went.
   *
   * It is NOT a wallet series and must not be read as one. A meeple is a stored
   * ACTION with no upkeep and no score, so the shape that matters is not a
   * plateau (which is what a coin pile had to show) but a series that keeps
   * returning to the floor. A supply that climbs and stays up is a pile of
   * actions nobody could spend, and that is a dead component rather than an
   * inflation problem.
   */
  meeplesByRound: number[];
  /** Median barn size across players, sampled at every round boundary. */
  barnByRound: number[];
  leadChanges: number;
  endTriggerRound: number | null;

  turnsBySeat: number[];
  bonusTurnsBySeat: number[];
  /**
   * ⭐ THE FOUR-WAY BONUS-SLOT TALLY (v31, and the assertion the whole pass
   * turns on). The slot holds exactly two options now and one way to waste it,
   * but the interaction option splits in two and THAT SPLIT IS THE POINT:
   *
   *   Draw 1        `bonusDrawBySeat`      - the free solitaire card
   *   visit rival   `visitsBySeat - selfVisitsBySeat`, derived
   *   visit SELF    `selfVisitsBySeat`     - your own board, your own action
   *   SLOT UNSPENT  `turnsBySeat - bonusTurnsBySeat`, derived, never stored
   *
   * ⛔ THE FIVE-WAY COIN TALLY IT REPLACES IS GONE, and with it every column
   * that named a currency: visit-coin and visit-power (there is one visit and
   * it pays an action), own-power (there is no Service to run for GBP 1) and
   * upgrade (there are no second faces to buy). Do not compare this tally with
   * any tally in `reports/` before 02/09/2026.
   *
   * ⭐ `selfVisitsBySeat` IS RISK 2 MADE ARITHMETIC. A self-visit is a
   * SOLITAIRE door bought with the interaction door's own currency, and every
   * previous version of this game has had the solitaire option crowd the visit
   * out when the two competed in one slot. It is counted off the `visited`
   * event's `self` flag - a flag the engine carries precisely so that no reader
   * can forget the distinction - and `a08-the-hook` credits ONLY the neighbour
   * half.
   *
   * ⚠️ SLOT UNSPENT AND THE INSTRUMENT CAVEAT, which must travel with the
   * number wherever it is printed. The bonus slot is a start-of-turn window
   * that shuts the moment the seat acts, and a term-table argmax always prefers
   * the big main action, so the evaluator had to be taught to take a closing
   * window before acting at all. What the sim therefore measures is the
   * RATIONAL FLOOR: a bot never forgets. The v31 plan wants unspent tallied
   * because a HUMAN forgets, and forgetting is a human failure a bot cannot
   * model. A low unspent share here is NOT evidence that the start-of-turn
   * restriction is harmless at a table.
   */
  bonusDrawBySeat: number[];
  visitsBySeat: number[];
  selfVisitsBySeat: number[];
  /** 1-based round of each visit, split by whose board, for the early/late read. */
  neighbourVisitRounds: number[];
  selfVisitRounds: number[];
  visitsToLeaderBySeat: number[];
  deliveriesBySeat: number[];
  ownCropBuildsBySeat: number[];
  foreignCropBuildsBySeat: number[];
  /**
   * ⭐ ACTIONS RESOLVED, by seat - RISK 1, and the number the whole v31 pass
   * moves. Nothing in the suite before 02/09/2026 measured it.
   *
   * One count of every core verb actually PERFORMED, whichever thing bought it:
   *
   *   the main action        one per turn, by rule
   *   the bonus slot         a door action, or the free Draw 1
   *   every meeple spent     free, uncapped, at the start of a turn
   *
   * `pass` counts nothing, because nothing was resolved. A card effect that
   * grants a draw or a sow inside another action is NOT counted: it is part of
   * the action that fired it, and counting it would make "actions per turn"
   * into "things that happened per turn", which is a different and much less
   * useful number.
   *
   * The floor is therefore 1.0 (a turn that only acts) and the printed
   * expectation is 2.0 (action plus bonus). Anything materially above 2.0 is
   * the meeple supply, which is the uncapped part.
   */
  actionsBySeat: number[];
  /** Of those, the ones bought by a meeple leaving the game. */
  meepleActionsBySeat: number[];
  /**
   * MEEPLES GAINED AND SPENT, by seat and by colour. `gained - spent` over a
   * whole game is exactly the meeples that died unspent in a supply, because a
   * spent meeple returns to no pool - which is the dead-component number the
   * v31 plan asks for.
   */
  meeplesGainedBySeat: number[];
  meeplesSpentBySeat: number[];
  meeplesGainedByColour: Record<string, number>;
  meeplesSpentByColour: Record<string, number>;
  /** Meeples still in a supply when the game stopped, by seat. Read off the final state. */
  meeplesUnspentBySeat: number[];
  /** The seat's own turn number when it first spent a meeple, or null. */
  firstMeepleTurnBySeat: (number | null)[];
  /** Turns the seat began holding cards with no legal visit anywhere. */
  clogTurnsBySeat: number[];
  /** Turns the seat began, counted only when the clog question was askable. */
  clogSampledBySeat: number[];

  /**
   * Turn ends at which a seat's OWN Notice Board stood clogged, and the turn
   * ends sampled. The board's threshold is the only brake in the game on a
   * popular farm: too high and popularity is a harvest tax, too low and the
   * brake never bites.
   *
   * ⭐ IT NOW THROTTLES A THIRD KIND OF TRAFFIC and no previous arm has measured
   * it doing so. The same two spaces absorb a rival's visit, the owner's own
   * SELF-visit, and any card effect that sows onto a board, so the clog is the
   * only structural brake on the solitaire door as well as on the busy one.
   */
  doorClogTurnsBySeat: number[];
  doorClogSampledBySeat: number[];
  /**
   * Times each crop's discard was shuffled back into its deck, by crop. The
   * C1 metric: a pool that cycles is not a pool that is sampled, and until
   * 2026-08-09 this event was claimed as "uninteresting for balance" and
   * dropped, so nobody knew the number. It is not a balance figure and it is
   * not meant to be - it is the only direct evidence the instrument can give
   * about whether the 105 cards behave as a pool or as a deck.
   *
   * Read it SPLIT, never pooled. A played crop's central deck holds 12 cards
   * (setup takes 6 of its 18 into a hand and a barn); a neutral crop's holds
   * 18 and nothing is taken out. The two behave nothing alike, and the split
   * is the finding: `report.ts` prints played and neutral on separate lines
   * for that reason. Keyed by crop so the split can be re-derived from
   * `suits` and `neutral` without re-running.
   */
  reshufflesByCrop: Record<string, number>;
  /**
   * ⭐ THE DOOR MIX (v31): every use of every suit's door, by the door's COLOUR
   * and split by what bought it. Which board the table walks to is the question
   * that replaced "which Worker gets rented"; there is no Working Week, no
   * track and no wage, so the only thing a door has left is its action.
   *
   * ⚠️ THE APIARY READING IS THE ONE NOT TO TRUST, and it is a pricer defect
   * rather than a metric one. A sow FROM HAND and a sow from a deck top emit
   * the same event, so the bots' pricer never charges the visitor the SECOND
   * card the Apiary door costs. The v31 plan says outright that the Apiary door
   * should be the weakest on the table by some distance; if this table says the
   * Apiary board takes normal traffic, that is the pricer talking.
   */
  doorUsesByColour: Record<string, number>;
  /** Of those, the ones bought by a card on a RIVAL's board. */
  neighbourDoorByColour: Record<string, number>;
  /** ...by a card on the visitor's OWN board. */
  selfDoorByColour: Record<string, number>;
  /** ...by a meeple leaving the game. */
  meepleDoorByColour: Record<string, number>;
  freight: RivalFreight;

  // --- The Dairy rebuild, 2026-08-10 ---------------------------------------
  //
  // Four lines its pass conditions need and no previous run recorded. They
  // replace the D9 Prosperity Wagon counters, which measured a thing that can no
  // longer happen: the Wagon's "work a Hired Worker" clause went with the Hiring
  // Fair and the card is a scaling build discount now. ⚠️ NONE OF THESE HAS A
  // NOISE FLOOR YET - run --noise before reading a movement in one as a finding.

  /** Buildings put down, by seat. The suit's own ramp, counted. */
  buildsBySeat: number[];
  /**
   * TURNS THAT BEGAN WITH NO BUILD AVAILABLE, by seat, and the turns sampled.
   *
   * The design's own headline risk, and the screen most likely to fail at a
   * table: Dairy's Tiers 1 and 2 are nine cards that all do nothing when you have
   * nothing you want to build. Sampled at the first decision of a turn, exactly
   * like the clog probe beside it - but WITHOUT its holding-cards guard, because
   * an empty hand is the sharpest case of no build available rather than a reason
   * not to ask.
   */
  noBuildTurnsBySeat: number[];
  buildSampledBySeat: number[];
  /**
   * CARDS TAKEN OFF DECK TOPS, all crops, all routes - draws, the market, a
   * Service's sow, D10's reveal, D14's refill and D15's run.
   *
   * The rebuild's likeliest external breakage, and the one it is measured
   * against: three Dairy cards pull off deck tops and D15 BUILDS them, so they
   * never return to the deck at all. Read beside `reshufflesByCrop`, which is
   * the number that must stay flat. Derived by diffing each decision's decks and
   * adding back whatever a reshuffle put in, so every route is counted whether or
   * not it emits an event of its own.
   */
  deckTopsTaken: number;
  /**
   * CARDS BUILT PER GRAND CREAMERY ACTIVATION (D15), one entry per firing.
   *
   * ⚠️ THE MEANING CHANGED ON 19/08/2026 AND THE NAME DID NOT. It used to be
   * the length of the escalating run, and it was the card's whole balance
   * question: a median of 1 was a disappointment machine, a median of 3 too
   * strong, and the dial was whether a coin-priced card counted as cost 0 or
   * busted the run. The card now reads "Reveal 2 deck cards. Build 1 for free.
   * Discard the other", so there is no run and no dial - the expected value is
   * a flat 1. The list is KEPT because what it can still catch is the failure
   * mode of the rewrite: an entry of 0 means the activation reached the pick
   * with nothing revealed, i.e. the decks were dry, and a rising share of those
   * is the reshuffle pressure the old card was flagged for showing up on the
   * new one. Anything other than 0 or 1 is a bug.
   */
  creameryRuns: number[];

  /**
   * How full the island was when the game stopped, 0..1. The design's real
   * question about the end trigger is whether it fires "at a sensible time
   * rather than early like the 2026-07-14 game did", and since the trigger
   * DEFINES the end, the trigger's position within the game is 100% by
   * construction and measures nothing. Island fill is the same question asked
   * of something that can vary.
   */
  islandFill: number;

  /** Moves taken, and decisions at which each move type was on offer. */
  movesChosen: Record<string, number>;
  movesOffered: Record<string, number>;

  balloonMoves: number;
  /** A balloon taken from another seat's Aerodrome, by victim. */
  raidsByVictim: number[];

  // --- The Vegetable rebuild, 2026-08-09 -----------------------------------
  //
  // Five lines its pass conditions need and no previous run recorded. ⚠️ NONE
  // OF THEM HAS A NOISE FLOOR YET - run --noise before reading a movement in one
  // as a finding.

  /**
   * Balloon moves BY SEAT, so the report can split them by suit. The draft's
   * central prediction is that this climbs sharply from 5.1 a game with a
   * Vegetable seat taking well over an even share, and a table total cannot
   * answer it.
   */
  balloonMovesBySeat: number[];
  /**
   * Of those, the ones paid OUT OF HAND (V4, V8) rather than out of the barn.
   * The suit's whole privilege, so it is the direct measurement of whether the
   * privilege is used - a Vegetable seat still taking the barn route is a
   * Vegetable seat not playing its Depots.
   */
  handFlightsBySeat: number[];
  /** Demand tokens altered, split by verb: V5's swap and V6's turn. */
  demandSwaps: number;
  demandFaceDowns: number;
  /**
   * DELIVERIES THAT WERE ONLY PAYABLE BECAUSE A DEMAND TOKEN HAD BEEN ALTERED -
   * the number that says whether the mutable tokens earned their rules.
   *
   * Measured against the tokens AS DEALT: the spend actually made is re-tested
   * against the tile's original demand, and counted only when the original
   * refuses it. So it is not "deliveries to a tile somebody touched", which
   * would count every delivery to a tile whose swap was irrelevant.
   */
  deliveriesUnlockedByAlteration: number;
  /**
   * Island receipts by FILL ORDER, by seat: index 0 is arriving first at a tile
   * (6 VP), index 1 second (3 VP). The flat island's only remaining time
   * gradient, and the thing V14 takes both of at once.
   */
  receiptsByOrderBySeat: number[][];

  /**
   * THE GIVEAWAY (the Orchard rebuild, 2026-08-09): cards handed across the
   * table, by GIVER. The rebuilt Orchard turns cards it does not want into a
   * neighbour's hand rather than into a discard, on five different cards plus
   * the Farmstead, and the design's own risk 7 is that this loosens the table's
   * card clock - the master brake. Read against the table's total draw.
   */
  giftsBySeat: number[];
  /**
   * HOW THE BARN FILLED, by route. `harvest` is the ordinary one (cards off a
   * stack); the rest are the shortcuts, and the Orchard rebuild's claim that the
   * suit is "rich in cards and deliberately poor in freight" lives or dies on
   * their share. Keys: harvest, hand (O12 and the Wheat hand-to-barn line),
   * deck (W15, the market), stack, discard (V1's refund).
   */
  barnInByRoute: Record<string, number>;
  /**
   * THE SAME TOTAL, by SEAT (the Dairy rebuild, 2026-08-10). Every route
   * pooled, because the rebuild's first pass condition is "cards into a Dairy
   * seat's barn" against every other suit, and route share is a separate
   * question the table above already answers. Read per suit, never per game:
   * most cells have no seat of a given suit at all.
   */
  barnInBySeat: number[];
  /** O17's £1 divert specifically, counted off the answer rather than the event. */
  divertsBySeat: number[];
  /** ORCHARDs BUILT (the D1 sub-type), by seat - what O1's refund and O20 both pay for. */
  orchardsBuiltBySeat: number[];

  /**
   * GROW WITHOUT PLACING (the Apiary rebuild, 2026-08-11), by seat. A5 The
   * Meadow Hive and A12 The Honey Hut fire a building with no card paid, and
   * this is the suit's whole thesis measured: everybody else is rationed to
   * about 3.6 GROWs a game, and Apiary buys more of them and aims them.
   *
   * Counted off the `activate` task ANSWER rather than off an event, because
   * there is no "an ability fired" event and by design there never will be -
   * nothing moves. Read as activations per Apiary TURN (risk 3: three
   * activations in a turn against a table average of 3.6 GROWs a GAME is a
   * different order of magnitude).
   */
  activationsBySeat: number[];
  /**
   * 1-based round of a seat's FIRST activation, or null. Risk 1, the cold
   * start: every activation card needs a target with a printed ability and an
   * opening tableau has none. Turn 8 or later means A5 needs a floor.
   */
  firstActivationRoundBySeat: (number | null)[];
  /**
   * Activations whose target was FULL. ⛔ THE COUNTER THAT MATTERS MOST, and it
   * matters more than the win rate: the design's central claim is that a
   * clogged building is a button to this suit and dead weight to every other,
   * which is why Apiary ships with no harvest valve at all. If this comes back
   * near zero the claim is wrong and the suit needs a valve.
   */
  activationsOfFullBySeat: number[];
  /**
   * Activations whose target printed a crop icon that is not the seat's own.
   * Risk 5, and A19 The Honey Hall pays for it: Apiary pays no crop cost to
   * fire a building, so a foreign Tier 2 or Tier 3 in an Apiary tableau is a
   * better card than it is in the tableau of the suit that printed it.
   */
  activationsOfForeignBySeat: number[];
  /**
   * ⛔ `towerCoinsBySeat` IS GONE (v31). A14 The Honeycomb Tower minted GBP 1
   * per HIVE and was the game's first repeatable coin faucet, which is why it
   * had a counter of its own. It draws a card per HIVE now, and a draw is
   * measured everywhere already - the funnel counts A14's activations and the
   * card clock counts what came out - so a bespoke line would be a second name
   * for a number the report prints twice over.
   */

  cards: Map<CardId, CardFacts>;
}

/**
 * The action mix's row label. Move type everywhere except `cardMove`, which is
 * split by its handler-defined `kind`.
 *
 * One move type now carries two unrelated things: the Helping Hand's
 * `repeatWork`, a bonus-slot tail, and the Wheat Tier 3 cards' `action`, which
 * IS the main action. Pooling them into one row would report a take rate that
 * means nothing, and the rebuild's first pass condition is the ACTION cards'
 * play rate specifically.
 */
function moveLabel(move: Move): string {
  return move.type === 'cardMove' ? `cardMove:${move.kind}` : move.type;
}

function emptyFacts(seats: number, inSupply: boolean): CardFacts {
  return {
    inSupply,
    surfaced: false,
    held: false,
    kept: false,
    played: false,
    junked: false,
    activations: 0,
    vp: Array<number>(seats).fill(0),
    builtBy: [],
  };
}

export interface FoldSpec {
  readonly seed: string;
  readonly cell: string;
  readonly suits: readonly Suit[];
  readonly neutral: readonly Suit[];
  readonly profiles: readonly PolicyId[];
}

/**
 * The fold's working state. Created before a game, fed every decision, closed
 * once with the final state.
 */
export class Fold {
  readonly m: GameMetrics;
  private readonly data: GameData;
  private turnsEnded = 0;
  private sampledTurn = -1;
  /**
   * ⭐ The DENIAL probe samples in a different window from the build probe since
   * 03/09/2026, so it needs its own once-a-turn latch. See `bonusWindow`.
   */
  private sampledBonusTurn = -1;
  private leader: Seat | null = null;
  private seeded = false;
  /**
   * Cards sitting on a Notice Board that a RIVAL put there, keyed by the board's
   * owning seat. Emptied into `freight.bankedBySeat` when that board is
   * harvested, which is the moment a gift stops being a gift on a board and
   * becomes freight in a barn.
   */
  private freightOnBoard: Set<CardId>[] = [];
  /**
   * The island's demand tokens AS DEALT, captured once off the first pre-state.
   * The baseline for `deliveriesUnlockedByAlteration`: without it the best that
   * can be measured is "a delivery to a tile somebody touched", which counts
   * every irrelevant swap.
   */
  private dealtCrates = new Map<string, (Suit | 'wild')[]>();
  private leaderCache: { d: Decision; v: Seat | null } | null = null;
  /** Buildings taken by the Grand Creamery run in progress, or null between runs. */
  private creameryRun: number | null = null;

  constructor(data: GameData, spec: FoldSpec, seats: number) {
    this.data = data;
    this.freightOnBoard = Array.from({ length: seats }, () => new Set<CardId>());
    const zeros = () => Array<number>(seats).fill(0);
    const byColour = () => Object.fromEntries(data.cards.suits.map((s) => [s, 0]));
    this.m = {
      seed: spec.seed,
      seats,
      cell: spec.cell,
      suits: spec.suits,
      neutral: spec.neutral,
      profiles: spec.profiles,
      outcome: 'maxMoves',
      ended: false,
      error: null,
      moves: 0,
      rounds: 0,
      chooseMs: 0,
      scores: [],
      ranking: [],
      winner: null,
      meeplesByRound: [],
      barnByRound: [],
      leadChanges: 0,
      endTriggerRound: null,
      turnsBySeat: zeros(),
      bonusTurnsBySeat: zeros(),
      bonusDrawBySeat: zeros(),
      visitsBySeat: zeros(),
      selfVisitsBySeat: zeros(),
      neighbourVisitRounds: [],
      selfVisitRounds: [],
      visitsToLeaderBySeat: zeros(),
      deliveriesBySeat: zeros(),
      ownCropBuildsBySeat: zeros(),
      foreignCropBuildsBySeat: zeros(),
      actionsBySeat: zeros(),
      meepleActionsBySeat: zeros(),
      meeplesGainedBySeat: zeros(),
      meeplesSpentBySeat: zeros(),
      meeplesGainedByColour: byColour(),
      meeplesSpentByColour: byColour(),
      meeplesUnspentBySeat: zeros(),
      firstMeepleTurnBySeat: Array<number | null>(seats).fill(null),
      clogTurnsBySeat: zeros(),
      clogSampledBySeat: zeros(),
      doorClogTurnsBySeat: zeros(),
      doorClogSampledBySeat: zeros(),
      reshufflesByCrop: Object.fromEntries([...spec.suits, ...spec.neutral].map((s) => [s, 0])),
      doorUsesByColour: byColour(),
      neighbourDoorByColour: byColour(),
      selfDoorByColour: byColour(),
      meepleDoorByColour: byColour(),
      freight: {
        paidBySeat: zeros(),
        receivedBySeat: zeros(),
        bankedBySeat: zeros(),
        toLeaderBySeat: zeros(),
      },
      buildsBySeat: zeros(),
      noBuildTurnsBySeat: zeros(),
      buildSampledBySeat: zeros(),
      deckTopsTaken: 0,
      creameryRuns: [],
      islandFill: NaN,
      movesChosen: {},
      movesOffered: {},
      balloonMoves: 0,
      raidsByVictim: zeros(),
      balloonMovesBySeat: zeros(),
      handFlightsBySeat: zeros(),
      demandSwaps: 0,
      demandFaceDowns: 0,
      deliveriesUnlockedByAlteration: 0,
      receiptsByOrderBySeat: Array.from({ length: seats }, () => []),
      giftsBySeat: zeros(),
      barnInByRoute: { harvest: 0, hand: 0, deck: 0, stack: 0, discard: 0 },
      barnInBySeat: zeros(),
      divertsBySeat: zeros(),
      orchardsBuiltBySeat: zeros(),
      activationsBySeat: zeros(),
      firstActivationRoundBySeat: Array<number | null>(seats).fill(null),
      activationsOfFullBySeat: zeros(),
      activationsOfForeignBySeat: zeros(),
      cards: new Map(),
    };
    for (const card of data.cards.catalogue) {
      this.m.cards.set(
        card.id,
        emptyFacts(seats, spec.suits.includes(card.suit) || spec.neutral.includes(card.suit)),
      );
    }
  }

  /**
   * Would this spend have paid this tile with its demand tokens AS DEALT?
   *
   * The measurement behind `deliveriesUnlockedByAlteration`. It re-runs
   * `doDeliver`'s own legality arithmetic - match what the demand names, pay for
   * the rest at the substitution rate - against the original crates instead of
   * the current ones. Cheap and exact, and it short-circuits to `true` on the
   * overwhelmingly common case of a tile nobody has touched, so a game with no
   * Vegetable seat pays nothing for it.
   */
  private dealtWouldPay(
    state: GameState,
    tileId: string,
    spend: Partial<Record<Suit, number>>,
  ): boolean {
    const dealt = this.dealtCrates.get(tileId);
    const tile = state.island.tiles.find((t) => t.tile === tileId);
    if (!dealt || !tile) return true;
    const unchanged =
      tile.faceDown?.some(Boolean) !== true &&
      dealt.length === tile.crates.length &&
      dealt.every((crate, i) => crate === tile.crates[i]);
    if (unchanged) return true;

    const per = this.data.island.tileRule.cardsPerCrate;
    const rate = this.data.island.cardsPerSubstitution;
    const paid = Object.values(spend).reduce((a: number, n) => a + (n ?? 0), 0);
    const base: Partial<Record<Suit, number>> = {};
    let wilds = 0;
    for (const crate of dealt) {
      if (crate === 'wild') wilds += 1;
      else base[crate] = (base[crate] ?? 0) + per;
    }
    // Every way the wild crates could have been nominated, exactly as the engine
    // validates: accept if any of them balances.
    const suits = state.suitsInPlay;
    const fills = (k: number): Suit[][] =>
      k === 0 ? [[]] : suits.flatMap((s) => fills(k - 1).map((rest) => [s, ...rest]));
    return fills(wilds).some((fill) => {
      const need: Partial<Record<Suit, number>> = { ...base };
      for (const s of fill) need[s] = (need[s] ?? 0) + per;
      let matched = 0;
      let total = 0;
      for (const [suit, want] of Object.entries(need) as [Suit, number][]) {
        matched += Math.min(spend[suit] ?? 0, want);
        total += want;
      }
      const substituted = total - matched;
      if (substituted === 0) return paid === matched;
      if (rate === null) return false;
      return paid - matched === rate * substituted;
    });
  }

  private facts(id: CardId): CardFacts {
    let f = this.m.cards.get(id);
    if (!f) {
      f = emptyFacts(this.m.seats, false);
      this.m.cards.set(id, f);
    }
    return f;
  }

  /** Starting hands are held without ever having been drawn. Run once, off the first pre-state. */
  private seed(state: GameState): void {
    if (this.seeded) return;
    this.seeded = true;
    for (const tile of state.island.tiles) this.dealtCrates.set(tile.tile, [...tile.crates]);
    for (const p of state.players) {
      for (const id of p.hand) this.facts(id).held = true;
      // Starters arrive pre-built: they are in play in every game, never drawn
      // and never junked. The cut list excludes them for exactly that reason;
      // the funnel still carries a row so the coverage test has one.
      for (const b of p.tableau) this.facts(b.card).played = true;
    }
  }

  observe(d: Decision): void {
    this.seed(d.pre);
    this.m.moves += 1;
    // The action mix: what was taken against what was on the table. A take rate
    // is the only way to tell "nobody wants to GROW" from "GROW is rarely
    // legal", and the two send a card change in opposite directions.
    const taken = moveLabel(d.move);
    this.m.movesChosen[taken] = (this.m.movesChosen[taken] ?? 0) + 1;
    for (const label of new Set(d.legal.map(moveLabel))) {
      this.m.movesOffered[label] = (this.m.movesOffered[label] ?? 0) + 1;
    }
    this.deckTops(d);
    this.creamery(d);
    this.turnStart(d);
    this.bonusWindow(d);
    this.move(d);
    this.mainAction(d);
    for (const e of d.events) this.event(d, e);
  }

  /**
   * Cards that left a deck during this decision.
   *
   * A diff rather than an event count, because there is no "a card left a deck"
   * event and the routes are many: a draw's reveal, the market, the Apiary
   * Service's sow, D10's reveal, D14's refill, D15's flips. A reshuffle refills
   * the deck mid-decision, so its own event carries the post-shuffle size and
   * that is added back - `pre - post + shuffled-in` is exactly what was taken,
   * with or without one. D10's returns show up as a NEGATIVE per-suit diff and
   * are floored at 0 per suit, which is the honest reading: a card revealed and
   * put back was not taken.
   */
  private deckTops(d: Decision): void {
    const shuffled: Partial<Record<Suit, number>> = {};
    for (const e of d.events) {
      if (e.e === 'reshuffled') shuffled[e.suit] = (shuffled[e.suit] ?? 0) + e.count;
    }
    for (const suit of this.data.cards.suits) {
      const before = d.pre.decks[suit]?.length ?? 0;
      const after = d.post.decks[suit]?.length ?? 0;
      this.m.deckTopsTaken += Math.max(0, before - after + (shuffled[suit] ?? 0));
    }
  }

  /**
   * D15 The Grand Creamery, counted off its own tasks rather than off an event,
   * because "the activation finished" is not something the engine emits.
   *
   * ⚠️ REPOINTED ON 19/08/2026 WITH THE CARD. It used to open on the standing
   * ACTION move and close on the first flip that built nothing, which was the
   * escalating run's length. D15 is an ordinary GROW building now and reveals
   * exactly two deck cards, so the window opens on the GROW and closes on the
   * `creameryPick` task that spends them. What is counted is how many cards the
   * activation actually put on the table - 1 in the ordinary case, 0 only when
   * the decks were too dry to reveal anything at all.
   */
  private creamery(d: Decision): void {
    if (d.move.type === 'grow' && d.move.building === 'D15') {
      // A previous window left open (the decks ran dry mid-reveal and the drain
      // loop dropped the task) is closed here rather than lost.
      if (this.creameryRun !== null) this.m.creameryRuns.push(this.creameryRun);
      this.creameryRun = 0;
      return;
    }
    if (this.creameryRun === null) return;
    const head = d.pre.tasks[0];
    if (!head || head.t !== 'card' || head.src !== 'D15') return;
    if (d.events.some((e) => e.e === 'built')) this.creameryRun += 1;
    if (head.kind === 'creameryPick') {
      this.m.creameryRuns.push(this.creameryRun);
      this.creameryRun = null;
    }
  }

  /**
   * The clog probe (assertion 5), sampled at the first decision of every turn:
   * the seat holds cards and yet no visit is legal anywhere, because every
   * rival's Notice Board is full. Only askable at a fresh turn - once the bonus
   * slot is spent `visitOptions` is empty for a reason that is not denial.
   *
   * ✅ RE-READ ON 19/08/2026 against the start-of-turn rule and it was still
   * correct - and correct BY CONSTRUCTION, because `no pending task &&
   * !actionSpent && !bonusSpent` was exactly the engine's `bonusOpen` predicate
   * of the day.
   *
   * ⛔ AND THAT IS PRECISELY WHY IT BROKE ON 03/09/2026. `bonusTiming` became
   * `'end'`, so `bonusOpen` now requires `actionSpent` to be TRUE - the exact
   * negation of the guard that had been copied out of it. The denial probe went
   * on sampling the top of the turn, which under the new order is the one window
   * where a visit is never legal, and assertion 5 reported **2p 100.0% 3p 100.0%
   * 4p 100.0%**: a perfect score for a question that was no longer being asked.
   *
   * ⚠️ THE LESSON IS THE ONE THE `turnflow` COMMENT ALREADY TEACHES, arriving
   * from the other direction: a predicate COPIED out of the rules silently stops
   * agreeing with them. The probe now CALLS `bonusOpen` instead of restating it,
   * so a fourth timing cannot break it again.
   *
   * The two questions are sampled in two different windows because they belong
   * to two different halves of the turn, and conflating them is what went wrong:
   *
   *   `turnStart`   the DAIRY no-build question. A main-action question, asked
   *                 before the action, unchanged.
   *   `bonusWindow` the DENIAL question. A bonus-slot question, asked wherever
   *                 the bonus slot is actually open.
   */
  private turnStart(d: Decision): void {
    const s = d.pre;
    if (this.turnsEnded === this.sampledTurn) return;
    if (s.tasks.length > 0 || s.turn.actionSpent || s.turn.bonusUsed.length > 0) return;
    this.sampledTurn = this.turnsEnded;
    const seat = s.turnPlayer;
    // The Dairy rebuild's headline risk: an empty hand is the sharpest case of
    // "no build available", not a reason to skip the question.
    this.m.buildSampledBySeat[seat] = (this.m.buildSampledBySeat[seat] ?? 0) + 1;
    if (!anyBuildOption(this.data, s, seat)) {
      this.m.noBuildTurnsBySeat[seat] = (this.m.noBuildTurnsBySeat[seat] ?? 0) + 1;
    }
  }

  /**
   * ⭐ THE DENIAL PROBE, sampled once per turn in the window where the bonus
   * slot is genuinely open - whichever end of the turn `rules.turn.bonusTiming`
   * puts that window at.
   *
   * The question is unchanged and so is the denominator's meaning: of the turns
   * where this seat reached its bonus slot holding at least one card, how many
   * found no legal visit anywhere? What changed is only WHERE the question can
   * honestly be asked.
   *
   * ⚠️ The denominator is no longer "every turn". A seat whose turn ends without
   * the window ever opening is not sampled, which is correct - it was never
   * offered the choice - but it does mean `clogSampledBySeat` and
   * `buildSampledBySeat` can now differ, where under the old order they could
   * not. Read the two as the different populations they are.
   */
  private bonusWindow(d: Decision): void {
    const s = d.pre;
    if (this.turnsEnded === this.sampledBonusTurn) return;
    if (s.tasks.length > 0) return;
    if (!bonusOpen(this.data, s)) return;
    this.sampledBonusTurn = this.turnsEnded;
    const seat = s.turnPlayer;
    if (player(s, seat).hand.length === 0) return;
    this.m.clogSampledBySeat[seat] = (this.m.clogSampledBySeat[seat] ?? 0) + 1;
    if (visitOptions(this.data, s, seat).length === 0) {
      this.m.clogTurnsBySeat[seat] = (this.m.clogTurnsBySeat[seat] ?? 0) + 1;
    }
  }

  private move(d: Decision): void {
    const { move, pre } = d;
    switch (move.type) {
      case 'grow': {
        this.facts(move.building).activations += 1;
        return;
      }
      case 'build':
        for (const id of move.payment) this.facts(id).junked = true;
        return;
      case 'visit':
        // ONE fee, not a list, since v31: no route places two cards on a board.
        this.facts(move.fee).junked = true;
        return;
      case 'bonusDraw':
        // The bonus slot's solitaire half. One of the four columns, and the
        // ONLY one that is counted off a move rather than off an event - there
        // is no `bonusDrawTaken` event, and the draw it pushes is
        // indistinguishable from the main action's.
        this.m.bonusDrawBySeat[move.seat] = (this.m.bonusDrawBySeat[move.seat] ?? 0) + 1;
        this.m.actionsBySeat[move.seat] = (this.m.actionsBySeat[move.seat] ?? 0) + 1;
        return;
      case 'task':
        this.taskAnswer(d, pre.tasks[0]);
        return;
      case 'cardMove': {
        // The other half of the activation count, and since 19/08/2026 the
        // Helping Hand's repeat is the whole of it: the Wheat Tier 3 ACTION
        // cards it was written for are GROW buildings now and arrive through
        // the `grow` branch above. A repeat is a firing of the Helping Hand by
        // the same standard, so the branch earns its keep on its own.
        this.facts(move.card).activations += 1;
        return;
      }
      // Claimed and uninteresting at the CARD level: their effect is measured
      // through events. `spendMeeple` is here because `meepleSpent` and
      // `doorUsed` between them carry everything about it.
      case 'draw':
      case 'harvest':
      case 'deliver':
      case 'moveBalloon':
      case 'spendMeeple':
      case 'pass':
      case 'endTurn':
        return;
      default:
        move satisfies never;
    }
  }

  /**
   * ⭐ ACTIONS RESOLVED (risk 1). A main action is counted here, off the MOVE,
   * because the five core verbs have no single event between them and because
   * only the move can say whether a verb was the turn's action or a door's.
   *
   * `pass` is not an action: it exists precisely because nothing was legal.
   * `bonusDraw` is counted in `move` above, and a door action - visit or meeple -
   * on the `doorUsed` event, so every route is counted exactly once.
   */
  private mainAction(d: Decision): void {
    const t = d.move.type;
    if (
      t === 'draw' ||
      t === 'build' ||
      t === 'grow' ||
      t === 'harvest' ||
      t === 'deliver' ||
      t === 'moveBalloon'
    ) {
      const seat = d.move.seat;
      this.m.actionsBySeat[seat] = (this.m.actionsBySeat[seat] ?? 0) + 1;
    }
  }

  private taskAnswer(d: Decision, task: Task | undefined): void {
    if (!task) return;
    const move = d.move;
    if (move.type !== 'task') return;
    const a = move.answer;

    // Surface: the whole reveal set, read off the state at the moment the
    // player commits to a keep. This is the trick that needs no engine change.
    if (a.kind === 'keep' && task.t === 'draw') {
      for (const id of task.revealed) this.facts(id).surfaced = true;
      for (const id of a.cards) this.facts(id).kept = true;
    }
    if (a.kind === 'build') for (const id of a.payment) this.facts(id).junked = true;
    // ⭐ THE `discard` ANSWER IS BACK, and so is this line (02/09/2026). v31
    // deleted the hand limit and the end-of-turn trim with it, which briefly
    // made the funnel's junk layer mean "spent on purpose" and nothing else;
    // `rules.turn.handLimit` reinstated both the same day. So junk is once
    // again the union of three unrelated fates - a build payment, a visit fee
    // and a card the boundary took - and the funnel cannot tell them apart. It
    // never could, and the `fuel` flag in the cut list is what stops that
    // ambiguity being read as a fault.
    if (a.kind === 'discard') for (const id of a.cards) this.facts(id).junked = true;

    // O17's divert, counted off the ANSWER: the event it emits is the shared
    // `handToBarn`, so the route table cannot tell it from The Fruit Press.
    if (task.t === 'divert' && a.kind === 'card' && a.payload.barn === true) {
      this.m.divertsBySeat[task.pid] = (this.m.divertsBySeat[task.pid] ?? 0) + 1;
    }

    // GROW WITHOUT PLACING, off the answer for the same reason: nothing moves,
    // so there is no event to read. The target's fullness and crop are taken
    // from the PRE state, which is the only moment either is still true - the
    // ability is about to fire and may harvest, sow or demolish the thing.
    if (task.t === 'activate' && a.kind === 'activate') {
      this.activation(d.pre, task.pid, a.card);
    }
  }

  /** One firing of a building's text with no card placed (A5, A12). */
  private activation(pre: GameState, seat: Seat, target: CardId): void {
    const m = this.m;
    m.activationsBySeat[seat] = (m.activationsBySeat[seat] ?? 0) + 1;
    m.firstActivationRoundBySeat[seat] ??= this.round();
    this.facts(target).activations += 1;
    const building = pre.players[seat]?.tableau.find((b) => b.card === target);
    if (!building) return;
    if (isFull(this.data, building)) {
      m.activationsOfFullBySeat[seat] = (m.activationsOfFullBySeat[seat] ?? 0) + 1;
    }
    const crop = cropOf(this.data, building);
    if (crop !== null && crop !== pre.players[seat]?.suit) {
      m.activationsOfForeignBySeat[seat] = (m.activationsOfForeignBySeat[seat] ?? 0) + 1;
    }
  }

  private event(d: Decision, e: GameEvent): void {
    const m = this.m;
    switch (e.e) {
      // ⛔ THE `coins` BRANCH IS GONE (v31) and it was the busiest one here. It
      // fed the wage income line, A14's faucet counter and the per-card coin
      // column of the funnel. There is no currency, so all three go: nothing
      // that used to be paid in coins is paid in anything now except cards and
      // actions, both of which are counted elsewhere.
      case 'cardsToHand':
        for (const id of e.cards) this.facts(id).held = true;
        return;
      case 'cardGifted':
        this.facts(e.card).held = true;
        m.giftsBySeat[e.from] = (m.giftsBySeat[e.from] ?? 0) + 1;
        return;
      case 'built': {
        const f = this.facts(e.card);
        f.played = true;
        f.builtBy.push(e.seat);
        m.buildsBySeat[e.seat] = (m.buildsBySeat[e.seat] ?? 0) + 1;
        const own = cardById(this.data, e.card).suit === player(d.post, e.seat).suit;
        if (own) m.ownCropBuildsBySeat[e.seat] = (m.ownCropBuildsBySeat[e.seat] ?? 0) + 1;
        else m.foreignCropBuildsBySeat[e.seat] = (m.foreignCropBuildsBySeat[e.seat] ?? 0) + 1;
        if (isOrchardCard(this.data, e.card)) {
          m.orchardsBuiltBySeat[e.seat] = (m.orchardsBuiltBySeat[e.seat] ?? 0) + 1;
        }
        return;
      }
      // ⭐ THE DOOR MIX AND HALF THE ACTION COUNT. One event per door action,
      // whichever thing bought it, so this is the single place a door use is
      // counted and it can never disagree with itself. The visit half is split
      // rival-against-self on the `visited` event below, which carries the flag;
      // here only the meeple half needs its own column.
      case 'doorUsed': {
        m.doorUsesByColour[e.colour] = (m.doorUsesByColour[e.colour] ?? 0) + 1;
        if (e.via === 'meeple') {
          m.meepleDoorByColour[e.colour] = (m.meepleDoorByColour[e.colour] ?? 0) + 1;
          m.meepleActionsBySeat[e.seat] = (m.meepleActionsBySeat[e.seat] ?? 0) + 1;
        }
        m.actionsBySeat[e.seat] = (m.actionsBySeat[e.seat] ?? 0) + 1;
        return;
      }
      case 'meepleGained':
        m.meeplesGainedBySeat[e.seat] = (m.meeplesGainedBySeat[e.seat] ?? 0) + 1;
        m.meeplesGainedByColour[e.colour] = (m.meeplesGainedByColour[e.colour] ?? 0) + 1;
        return;
      case 'meepleSpent':
        m.meeplesSpentBySeat[e.seat] = (m.meeplesSpentBySeat[e.seat] ?? 0) + 1;
        m.meeplesSpentByColour[e.colour] = (m.meeplesSpentByColour[e.colour] ?? 0) + 1;
        m.firstMeepleTurnBySeat[e.seat] ??= (m.turnsBySeat[e.seat] ?? 0) + 1;
        return;
      // ⛔ `starterUpgraded` IS GONE (v31): starters have one face and nothing
      // flips, so the upgrade column of the bonus tally and the Farmstead-flip
      // timing line both go with it.
      case 'delivered': {
        m.deliveriesBySeat[e.seat] = (m.deliveriesBySeat[e.seat] ?? 0) + 1;
        // First to a tile against second - the flat island's only remaining
        // time gradient, read off the receipt rather than off the tile so it
        // survives a knob on the VP schedule.
        const order = this.data.island.vpByDeliveryOrder.indexOf(e.vp);
        if (order >= 0) {
          const byOrder = m.receiptsByOrderBySeat[e.seat] as number[];
          byOrder[order] = (byOrder[order] ?? 0) + 1;
        }
        // ⛔ THE MARKET EXPLOIT PROBE IS GONE with the market (v31): it asked
        // whether the market buys made since a seat's last harvest covered a
        // tile outright, and there is nothing to buy with.
        const cost = Object.values(e.spend).reduce((a, n) => a + (n ?? 0), 0);
        // Was this delivery only payable because a demand token had moved? The
        // spend actually made, re-tested against the tokens AS DEALT. V14 emits
        // a SECOND `delivered` with an empty spend for the same payment, so the
        // cost gate is what stops one delivery being counted twice.
        if (cost > 0 && !this.dealtWouldPay(d.pre, e.tile, e.spend)) {
          m.deliveriesUnlockedByAlteration += 1;
        }
        return;
      }
      case 'harvested': {
        m.barnInByRoute.harvest = (m.barnInByRoute.harvest ?? 0) + e.cards.length;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + e.cards.length;
        // A HARVEST OF THE OWN NOTICE BOARD BANKS THE RIVAL FEES sitting on it
        // (assertion 2). Counted here rather than at the moment the fee lands,
        // because a gift that dies on a board nobody clears was never received.
        const mine = this.freightOnBoard[e.seat];
        if (mine !== undefined && mine.size > 0) {
          let banked = 0;
          for (const id of e.cards) {
            if (mine.delete(id)) banked += 1;
          }
          m.freight.bankedBySeat[e.seat] = (m.freight.bankedBySeat[e.seat] ?? 0) + banked;
        }
        return;
      }
      case 'balloonMoved': {
        m.balloonMoves += 1;
        m.balloonMovesBySeat[e.seat] = (m.balloonMovesBySeat[e.seat] ?? 0) + 1;
        // Paid out of HAND (V4, V8) rather than out of the barn, read off the
        // event's own count rather than inferred from an empty barn spend.
        if (e.hand > 0) m.handFlightsBySeat[e.seat] = (m.handFlightsBySeat[e.seat] ?? 0) + 1;
        if (typeof e.from === 'number' && e.from !== e.seat) {
          m.raidsByVictim[e.from] = (m.raidsByVictim[e.from] ?? 0) + 1;
        }
        return;
      }
      case 'demandSwapped':
        m.demandSwaps += 1;
        return;
      case 'demandFaceDown':
        m.demandFaceDowns += 1;
        return;
      case 'visited': {
        // ⭐ RISK 2, COUNTED. `visitsBySeat` is every visit; `selfVisitsBySeat`
        // is the solitaire half, read off the engine's own `self` flag rather
        // than re-derived from `seat === host` at each call site, so no reader
        // can quietly pool the two. `a08-the-hook` credits the difference and
        // never the whole.
        m.visitsBySeat[e.seat] = (m.visitsBySeat[e.seat] ?? 0) + 1;
        if (e.self) {
          m.selfVisitsBySeat[e.seat] = (m.selfVisitsBySeat[e.seat] ?? 0) + 1;
          m.selfDoorByColour[e.colour] = (m.selfDoorByColour[e.colour] ?? 0) + 1;
          m.selfVisitRounds.push(this.round());
          return;
        }
        m.neighbourDoorByColour[e.colour] = (m.neighbourDoorByColour[e.colour] ?? 0) + 1;
        m.neighbourVisitRounds.push(this.round());
        // The fee has already landed by the time this event fires (doVisit
        // places it first), so the card on the host's board is the last one
        // placed by this move - which is exactly what the `cardPlaced` branch
        // recorded a moment ago.
        m.freight.paidBySeat[e.seat] = (m.freight.paidBySeat[e.seat] ?? 0) + 1;
        m.freight.receivedBySeat[e.host] = (m.freight.receivedBySeat[e.host] ?? 0) + 1;
        const leader = this.leaderOf(d);
        if (leader === e.host) {
          m.visitsToLeaderBySeat[e.seat] = (m.visitsToLeaderBySeat[e.seat] ?? 0) + 1;
          m.freight.toLeaderBySeat[e.host] = (m.freight.toLeaderBySeat[e.host] ?? 0) + 1;
        }
        return;
      }
      case 'turnEnded': {
        const seat = e.seat;
        m.turnsBySeat[seat] = (m.turnsBySeat[seat] ?? 0) + 1;
        // The turn just ended, so `post.turn` is already the NEXT turn: the
        // bonus spend has to be read off the state the boundary was crossed
        // from. A bonus taken by this very move is in `pre` only if the move
        // was not itself the visit, so the post-state's flag is checked too
        // when the boundary and the visit landed in one apply.
        //
        // ⛔ THE COIN-BOUGHT OPTIONS ARE OFF THIS LIST (v31). It used to name
        // `workOwnWorker`, `market` and a knob-gated `upgrade` alongside the
        // visit, because each was a bonus-slot spend that could land in the
        // same apply as the boundary. Two options remain and both are here.
        const bonusMove = d.move.type === 'visit' || d.move.type === 'bonusDraw';
        if (d.pre.turn.bonusUsed.length > 0 || bonusMove) {
          m.bonusTurnsBySeat[seat] = (m.bonusTurnsBySeat[seat] ?? 0) + 1;
        }
        // ⭐ THE DOOR CLOG, sampled once per turn boundary for EVERY seat.
        // CHANGE 6 (20/08/2026) re-based this: it used to sample the Service,
        // one of TWO rival-touchable buildings, and now samples the NOTICE
        // BOARD, which is the only one. The number is not comparable across the
        // merge - the old one measured "half the farm is shut", this one
        // measures "the farm is shut" - and assertion 4's threshold moved with
        // it rather than being carried over.
        for (let s2 = 0; s2 < m.seats; s2++) {
          m.doorClogSampledBySeat[s2] = (m.doorClogSampledBySeat[s2] ?? 0) + 1;
          if (isFull(this.data, noticeBoardOf(this.data, d.post, s2))) {
            m.doorClogTurnsBySeat[s2] = (m.doorClogTurnsBySeat[s2] ?? 0) + 1;
          }
        }
        this.turnsEnded += 1;
        if (this.turnsEnded % m.seats === 0) this.roundBoundary(d.post);
        return;
      }
      case 'endTriggered':
        m.endTriggerRound = Math.floor(this.turnsEnded / m.seats) + 1;
        return;
      case 'reshuffled':
        m.reshufflesByCrop[e.suit] = (m.reshufflesByCrop[e.suit] ?? 0) + 1;
        return;
      // The barn's non-harvest routes (the Orchard rebuild's "poor in freight"
      // claim is a share of these against `harvest`).
      case 'deckToBarn':
        m.barnInByRoute.deck = (m.barnInByRoute.deck ?? 0) + 1;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + 1;
        return;
      case 'stackToBarn':
        m.barnInByRoute.stack = (m.barnInByRoute.stack ?? 0) + 1;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + 1;
        return;
      case 'discardToBarn':
        m.barnInByRoute.discard = (m.barnInByRoute.discard ?? 0) + 1;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + 1;
        return;
      case 'handToBarn':
        m.barnInByRoute.hand = (m.barnInByRoute.hand ?? 0) + 1;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + 1;
        return;
      // ⭐ A FEE LANDING ON A RIVAL'S NOTICE BOARD, remembered by card id so a
      // later harvest of that board can say which cards were gifts (assertion
      // 2). Every other `cardPlaced` - a GROW payment, a sow, a self-visit - is
      // still claimed and uninteresting.
      case 'cardPlaced': {
        if (e.seat === e.onto.seat) return;
        const board = noticeBoardOf(this.data, d.post, e.onto.seat);
        if (board.card !== e.onto.building) return;
        this.freightOnBoard[e.onto.seat]?.add(e.card);
        return;
      }
      // Claimed and uninteresting for balance: card movement between zones that
      // no assertion and no funnel layer reads.
      case 'cardsDiscarded':
      case 'demolished':
      case 'gameEnded':
        return;
      default:
        e satisfies never;
    }
  }

  /**
   * ⛔ `workerVisit` IS GONE (v31). It priced one visit in coins both ways for
   * assertion 2's ratio: the wage the bank minted to the host against the coin
   * payoff the same board would have paid the visitor for the same card. There
   * is no wage and no payoff, so there is no ratio - the freight counters above
   * are what assertion 2 reads instead.
   */

  private roundBoundary(state: GameState): void {
    const m = this.m;
    m.rounds += 1;
    m.meeplesByRound.push(medianOf(state.players.map((p) => meepleCount(p.meeples))));
    m.barnByRound.push(medianOf(state.players.map((p) => p.barn.length)));
    const leader = this.soleLeader(state);
    if (leader !== null && this.leader !== null && leader !== this.leader) m.leadChanges += 1;
    if (leader !== null) this.leader = leader;
  }

  /**
   * `soleLeader` for a decision, memoised on the decision itself. One apply can
   * emit several `visited` events (a Helping Hand repeat), and scoring the whole
   * table is the most expensive thing the fold does.
   */
  private leaderOf(d: Decision): Seat | null {
    if (this.leaderCache?.d === d) return this.leaderCache.v;
    const v = this.soleLeader(d.pre);
    this.leaderCache = { d, v };
    return v;
  }

  /** The single seat ahead on VP right now, or null while it is tied. */
  private soleLeader(state: GameState): Seat | null {
    const totals = gameEndScores(this.data, state).map((s) => s.total);
    const best = Math.max(...totals);
    const leaders = totals.flatMap((t, seat) => (t === best ? [seat] : []));
    return leaders.length === 1 ? (leaders[0] as Seat) : null;
  }

  /** The 1-based round in progress, read the way `endTriggerRound` reads it. */
  private round(): number {
    return Math.floor(this.turnsEnded / this.m.seats) + 1;
  }

  /** Close the fold: final scores, VP attribution, and the meeples nobody spent. */
  finish(
    state: GameState,
    outcome: Outcome,
    chooseMs: number,
    error: string | null = null,
  ): GameMetrics {
    const m = this.m;
    m.outcome = outcome;
    m.ended = outcome === 'ended';
    m.error = error;
    m.chooseMs = chooseMs;

    // A window left open by the decks running dry: the flip task enumerates
    // nothing and the drain loop drops it silently, so no decision closes it.
    if (this.creameryRun !== null) {
      m.creameryRuns.push(this.creameryRun);
      this.creameryRun = null;
    }

    const capacity = state.island.tiles.length * deliveriesPerTile(this.data);
    const made = state.island.tiles.reduce((n, t) => n + t.deliveredBy.length, 0);
    m.islandFill = capacity === 0 ? NaN : made / capacity;

    const final = score(this.data, state);
    m.scores = final.seats;
    m.ranking = final.ranking;
    const first = final.ranking[0];
    m.winner = first === undefined ? null : first;

    // VP attribution, per card per seat: the printed face plus whatever the
    // card's own endgame formula returned. The tableau is the whole of it -
    // there used to be a second loop here over D11's covered pile, which scored
    // printed VP from outside the tableau, and both the card and the zone were
    // deleted on 19/08/2026.
    state.players.forEach((p, seat) => {
      for (const b of p.tableau) {
        const f = this.facts(b.card);
        const endgame = handlerFor(b.card)?.gameEnd?.(this.data, state, seat) ?? 0;
        f.vp[seat] = (f.vp[seat] ?? 0) + faceOf(this.data, b).printedVp + endgame;
      }
      // ⭐ THE DEAD COMPONENT, read off the final state rather than derived as
      // gained minus spent. The two agree by construction (a spent meeple
      // returns to no pool), and the report prints both so that a disagreement
      // between them is an engine bug nobody has to go looking for.
      m.meeplesUnspentBySeat[seat] = meepleCount(p.meeples);
    });
    return m;
  }
}

/** Every meeple a supply holds, all colours. */
function meepleCount(meeples: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const held of Object.values(meeples)) n += held;
  return n;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The move types the fold claims. Exported so the smoke test can check coverage. */
export const CLAIMED_MOVE_TYPES: readonly string[] = MOVE_TYPES.filter((t) => t in MOVE_KINDS);
