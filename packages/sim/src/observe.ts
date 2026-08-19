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
  cardById,
  cropOf,
  faceOf,
  gameEndScores,
  handlerFor,
  isFull,
  isOrchardCard,
  player,
  score,
  serviceOf,
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
  coins: true,
  cardPlaced: true,
  cardsToHand: true,
  cardsDiscarded: true,
  deckToBarn: true,
  stackToBarn: true,
  harvested: true,
  workerWorked: true,
  reshuffled: true,
  built: true,
  demolished: true,
  starterUpgraded: true,
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
  buy: true,
  market: true,
  build: true,
  upgrade: true,
  grow: true,
  harvest: true,
  deliver: true,
  moveBalloon: true,
  visit: true,
  workOwnWorker: true,
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
  /** Coins minted by effects tagged with this card id, per seat. */
  coins: number[];
  /** Seats that built it. */
  builtBy: Seat[];
}

/** One worker-visit, priced both ways: what the host minted, what the visitor gave up. */
export interface WorkerVisit {
  readonly visitor: Seat;
  readonly host: Seat;
  /** Coins the bank minted to the host as the wage. */
  hostGain: number;
  /** Coins the visitor could have taken instead, at that same board. */
  visitorAlternative: number;
  /** The host was the sole VP leader at the time. */
  hostWasLeader: boolean;
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

  /** Median coins across players, sampled at every round boundary. */
  coinsByRound: number[];
  /** Median barn size across players, sampled at every round boundary. */
  barnByRound: number[];
  leadChanges: number;
  endTriggerRound: number | null;

  turnsBySeat: number[];
  bonusTurnsBySeat: number[];
  /**
   * The market doc's headline metric (ticket 56): how each seat spent its bonus
   * slots. `visitsBySeat` and `workOwnBySeat` are the other two thirds of the
   * mix; "market outnumbers visit" is the doc's named hook-losing condition.
   */
  marketBuysBySeat: number[];
  workOwnBySeat: number[];
  /** 1-based round of each market buy, for the doc's midgame split. */
  marketRounds: number[];
  /**
   * 1-based round of each PLAIN coin visit - the £1 payout on a base Notice
   * Board, the floor move the market doc says the market eats first.
   */
  plainVisitRounds: number[];
  /**
   * The doc's exploit probe: deliveries whose whole card cost was covered by
   * market buys made since the seat's last harvest, so the slot could have been
   * bought outright at market with no farming between. It used to be split by
   * island level, because a Level 3 slot was the big prize; the flat island
   * (2026-08-09) makes every tile the same 4 cards, so it is one count.
   */
  marketFundedDeliveries: number;
  /** Of those, the ones by a Vegetable seat - the doc's sharpest case. */
  marketFundedVeg: number;
  visitsBySeat: number[];
  /**
   * THE FIVE-WAY BONUS-SLOT TALLY (the v30 plan, section 5.5, 19/08/2026).
   *
   * Watch-list item 0 used to be a three-way count - visit / market / own
   * Worker - and the market half of it stopped existing on 19/08/2026 when
   * `rules.turn.marketCost` went null. What replaced it is a slot with four
   * options and one way to waste it, so the tally has five columns:
   *
   *   visit-coin   `visitCoinBySeat`   - a card on a rival's Notice Board, £1
   *   visit-power  `visitPowerBySeat`  - a card on the board, their Service run
   *   own-power    `workOwnBySeat`     - £1 to run your own, no wage
   *   upgrade      `upgradesBySeat`    - £2 to flip one of your own starters
   *   SLOT UNSPENT `turnsBySeat - bonusTurnsBySeat`, derived, never stored
   *
   * The split of the visit is by PAYOFF MODE off the `visited` event, and the
   * engine's third mode rides with the coin half: `special` is the upgraded
   * County Show's two-card visit, which pays `visitPayout.twoCard` and runs
   * nobody's Service, so it is a coin visit that costs two cards rather than a
   * fourth kind of thing. Only `worker` is a power visit.
   *
   * ⚠️ SLOT UNSPENT IS THE NEW BUCKET AND THE LOAD-BEARING ONE. It is the only
   * number that can say whether the start-of-turn restriction is COSTING
   * visits, because a forfeited slot is invisible to every other column: the
   * visit is not being outcompeted there, it is being missed. Nothing counts
   * it - it is turns minus bonus turns, derived where it is read (assertion
   * 14), so it can never drift out of step with the turn count it is a
   * remainder of.
   *
   * ⚠️ THE INSTRUMENT CAVEAT, and it must travel with the number. The bots
   * choose ONE move at a time from the whole legal-move list and have no
   * concept of resolving the bonus before the main action. A seat holding a
   * live delivery - scored 12 to 48 by the weights, against a visit's 1.5 to
   * 5 - will always take the delivery and forfeit the slot, where a human
   * would spend the slot first and then deliver. So the unspent share is
   * biased PESSIMISTIC against real play, and the number to read is the DELTA
   * between paired arms (`overlays/bonus-any-time.overlay.json` is the
   * control), never the absolute.
   */
  visitCoinBySeat: number[];
  visitPowerBySeat: number[];
  visitsToLeaderBySeat: number[];
  deliveriesBySeat: number[];
  ownCropBuildsBySeat: number[];
  foreignCropBuildsBySeat: number[];
  wageCoinsBySeat: number[];
  upgradesBySeat: number[];
  /**
   * 1-based round of each starter flip, the twin of `marketRounds` and added
   * for the same reason on 19/08/2026: the upgrade took the market's place in
   * the bonus slot, so it needs the market's timing split. A capped option
   * SHOULD spike in the opening rounds and then stop - that shape is a PASS -
   * and only a LATE upgrade share is the solitaire-crowds-out-the-visit
   * finding. A bare count cannot tell those two apart.
   */
  upgradeRounds: number[];
  /**
   * The round in which the seat's Farmstead reached its upgraded face, or null
   * if it never did. Added 2026-08-12 for the Wheat rebalance, whose headline
   * (W2) rests on a premise nobody had measured: that most seats get the
   * upgraded suit power at all. It was inferred from 5.30 buildings against a
   * 3-own-crop-building milestone plus an 84.2% own-crop build rate, which is
   * an average over a distribution nobody had looked at.
   *
   * ⚠️ The rule under it CHANGED the same day: the free flip at the milestone
   * is gone and the Farmstead is bought for £2 like its siblings, so this is now
   * a PURCHASE round and not a milestone round. Numbers measured before
   * 2026-08-12 are not comparable with numbers measured after.
   */
  farmsteadFlipRoundBySeat: (number | null)[];
  /**
   * The seat's own turn number when it first activated its OWN Service, or null.
   * The bootstrap question since the Services (2026-08-10): every seat has one
   * from turn 1 but starts at GBP 0, so the first own-activation cannot happen
   * until income has, and income means visiting somebody.
   */
  firstOwnServiceTurnBySeat: (number | null)[];
  /** Turns the seat began holding cards with no legal visit anywhere. */
  clogTurnsBySeat: number[];
  /** Turns the seat began, counted only when the clog question was askable. */
  clogSampledBySeat: number[];

  /**
   * Turn ends at which a seat's OWN Service stood clogged, and the turn ends
   * sampled. The Service threshold is the only brake left on a popular farm now
   * the Working Week is gone, so this is what replaced the track metrics: too
   * high and popularity is a harvest tax, too low and the brake never bites.
   */
  serviceClogTurnsBySeat: number[];
  serviceClogSampledBySeat: number[];
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
  /** Uses of a Service by somebody other than its owner, by Service. */
  rivalUsesByWorker: Record<string, number>;
  workerVisits: WorkerVisit[];

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
   * Coins minted by A14 The Honeycomb Tower, by seat. Risk 2: the first
   * repeatable coin faucet in the game, and the coin unit is still un-derived.
   * Every other Tier 3 pays in a resource with a natural cap. Read against
   * total coins in play and the market's play rate, NEVER against A14's own
   * play rate. The £1 rate is the dial.
   */
  towerCoinsBySeat: number[];

  cards: Map<CardId, CardFacts>;
}

const WAGE = /^wage:/;
const RIDER = /^rider:(.+)$/;
/** A14 The Honeycomb Tower's `why` tag - the game's first repeatable coin faucet. */
const TOWER = 'A14';

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
    coins: Array<number>(seats).fill(0),
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
  private leader: Seat | null = null;
  /** Working counter for the exploit probe: market buys since the seat's last harvest. */
  private marketSinceHarvest: number[] = [];
  private seeded = false;
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
    this.marketSinceHarvest = Array<number>(seats).fill(0);
    const zeros = () => Array<number>(seats).fill(0);
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
      coinsByRound: [],
      barnByRound: [],
      leadChanges: 0,
      endTriggerRound: null,
      turnsBySeat: zeros(),
      bonusTurnsBySeat: zeros(),
      marketBuysBySeat: zeros(),
      workOwnBySeat: zeros(),
      marketRounds: [],
      plainVisitRounds: [],
      marketFundedDeliveries: 0,
      marketFundedVeg: 0,
      visitsBySeat: zeros(),
      visitCoinBySeat: zeros(),
      visitPowerBySeat: zeros(),
      visitsToLeaderBySeat: zeros(),
      deliveriesBySeat: zeros(),
      ownCropBuildsBySeat: zeros(),
      foreignCropBuildsBySeat: zeros(),
      wageCoinsBySeat: zeros(),
      upgradesBySeat: zeros(),
      upgradeRounds: [],
      farmsteadFlipRoundBySeat: Array<number | null>(seats).fill(null),
      firstOwnServiceTurnBySeat: Array<number | null>(seats).fill(null),
      clogTurnsBySeat: zeros(),
      clogSampledBySeat: zeros(),
      serviceClogTurnsBySeat: zeros(),
      serviceClogSampledBySeat: zeros(),
      reshufflesByCrop: Object.fromEntries([...spec.suits, ...spec.neutral].map((s) => [s, 0])),
      rivalUsesByWorker: {},
      workerVisits: [],
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
      towerCoinsBySeat: zeros(),
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
    this.move(d);
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
   * ✅ RE-READ ON 19/08/2026 against the start-of-turn rule and it is still
   * correct - and it is now correct BY CONSTRUCTION rather than by luck. The
   * guard below is `no pending task && !actionSpent && !bonusSpent`, and the
   * last two are exactly the engine's new `bonusOpen(data, state)` predicate.
   * So the sample is taken in the one window where a visit could legally
   * happen, which is what the probe always meant: before, an unspent slot after
   * a spent action was still a window this guard skipped, and the skip was
   * defensible but arbitrary. It is neither now. Nothing to change; the
   * denominator (`clogSampledBySeat`) counts the same turns it always did,
   * because every turn passes through this window before anything else.
   */
  private turnStart(d: Decision): void {
    const s = d.pre;
    if (this.turnsEnded === this.sampledTurn) return;
    if (s.tasks.length > 0 || s.turn.actionSpent || s.turn.bonusSpent) return;
    this.sampledTurn = this.turnsEnded;
    const seat = s.turnPlayer;
    // The Dairy rebuild's headline risk, asked FIRST: an empty hand is the
    // sharpest case of "no build available", not a reason to skip the question.
    this.m.buildSampledBySeat[seat] = (this.m.buildSampledBySeat[seat] ?? 0) + 1;
    if (!anyBuildOption(this.data, s, seat)) {
      this.m.noBuildTurnsBySeat[seat] = (this.m.noBuildTurnsBySeat[seat] ?? 0) + 1;
    }
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
        for (const id of move.fee) this.facts(id).junked = true;
        return;
      case 'market': {
        // The bonus-slot mix's third column, plus the exploit probe's counter.
        const seat = move.seat;
        this.m.marketBuysBySeat[seat] = (this.m.marketBuysBySeat[seat] ?? 0) + 1;
        this.m.marketRounds.push(this.round());
        this.marketSinceHarvest[seat] = (this.marketSinceHarvest[seat] ?? 0) + 1;
        return;
      }
      case 'workOwnWorker':
        this.m.workOwnBySeat[move.seat] = (this.m.workOwnBySeat[move.seat] ?? 0) + 1;
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
      // Claimed and uninteresting: their effect is measured through events.
      // `buy` included - the action-mix table counts it, the `coins` event pays
      // for it, and the card it takes is blind, so there is nothing card-level
      // to fold.
      case 'draw':
      case 'buy':
      case 'upgrade':
      case 'harvest':
      case 'deliver':
      case 'moveBalloon':
      case 'pass':
      case 'endTurn':
        return;
      default:
        move satisfies never;
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
    if (a.kind === 'discard') for (const id of a.cards) this.facts(id).junked = true;

    // O17's £1 divert, counted off the ANSWER: the event it emits is the shared
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
      case 'coins': {
        if (e.delta <= 0) return;
        if (WAGE.test(e.why))
          m.wageCoinsBySeat[e.seat] = (m.wageCoinsBySeat[e.seat] ?? 0) + e.delta;
        // A14 The Honeycomb Tower, split out of the per-card coin fold below
        // because risk 2 is about the FAUCET rather than about the card: it is
        // read against total coins in play, not against A14's own play rate.
        if (e.why === TOWER)
          m.towerCoinsBySeat[e.seat] = (m.towerCoinsBySeat[e.seat] ?? 0) + e.delta;
        const card = this.cardTag(e.why);
        if (card) {
          const f = this.facts(card);
          f.coins[e.seat] = (f.coins[e.seat] ?? 0) + e.delta;
        }
        return;
      }
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
      case 'workerWorked':
        if (e.owner !== null && e.owner !== e.seat) {
          m.rivalUsesByWorker[e.workerId] = (m.rivalUsesByWorker[e.workerId] ?? 0) + 1;
        } else if (e.owner !== null && m.firstOwnServiceTurnBySeat[e.seat] === null) {
          m.firstOwnServiceTurnBySeat[e.seat] = (m.turnsBySeat[e.seat] ?? 0) + 1;
        }
        return;
      case 'starterUpgraded':
        // Every flip is bought now, so every one of them counts as an upgrade;
        // the Farmstead is told apart by its slot for the timing metric.
        m.upgradesBySeat[e.seat] = (m.upgradesBySeat[e.seat] ?? 0) + 1;
        m.upgradeRounds.push(this.round());
        if (
          cardById(this.data, e.card).slot === 'farmstead' &&
          m.farmsteadFlipRoundBySeat[e.seat] == null
        ) {
          m.farmsteadFlipRoundBySeat[e.seat] = this.round();
        }
        return;
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
        // The exploit probe (ticket 56): could this slot have been bought
        // entirely at market, with no harvest between? Conservative in the
        // exploit's favour - it asks whether the market buys since the last
        // harvest COVER the cost, not which physical cards were spent, because
        // barn identity is inert and the engine spends arbitrary ids.
        const cost = Object.values(e.spend).reduce((a, n) => a + (n ?? 0), 0);
        // Was this delivery only payable because a demand token had moved? The
        // spend actually made, re-tested against the tokens AS DEALT. V14 emits
        // a SECOND `delivered` with an empty spend for the same payment, so the
        // cost gate is what stops one delivery being counted twice.
        if (cost > 0 && !this.dealtWouldPay(d.pre, e.tile, e.spend)) {
          m.deliveriesUnlockedByAlteration += 1;
        }
        if (cost > 0 && (this.marketSinceHarvest[e.seat] ?? 0) >= cost) {
          m.marketFundedDeliveries += 1;
          if (player(d.post, e.seat).suit === 'vegetable') m.marketFundedVeg += 1;
        }
        return;
      }
      case 'harvested':
        // Any harvest resets the exploit window; the card facts a harvest
        // carries are folded elsewhere (stack cards were counted as they
        // arrived on the building).
        this.marketSinceHarvest[e.seat] = 0;
        m.barnInByRoute.harvest = (m.barnInByRoute.harvest ?? 0) + e.cards.length;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + e.cards.length;
        return;
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
        m.visitsBySeat[e.seat] = (m.visitsBySeat[e.seat] ?? 0) + 1;
        // The five-way tally's two visit columns (19/08/2026). Split on the
        // payoff mode the engine already carries, so the two can never
        // disagree with `visitsBySeat`, which stays the sum of them. `special`
        // is the County Show's two-card visit: it pays coins and runs nobody's
        // Service, so it belongs on the coin side.
        if (e.mode === 'worker') {
          m.visitPowerBySeat[e.seat] = (m.visitPowerBySeat[e.seat] ?? 0) + 1;
        } else {
          m.visitCoinBySeat[e.seat] = (m.visitCoinBySeat[e.seat] ?? 0) + 1;
        }
        // The plain £1 visit - a coin payoff on a BASE board - is the floor
        // move the market doc says the market eats first; its round index
        // feeds the midgame split (ticket 56).
        if (e.mode === 'coin') {
          const board = player(d.pre, e.host).tableau.find(
            (b) => cardById(this.data, b.card).slot === 'noticeboard',
          );
          if (board && !board.upgraded) m.plainVisitRounds.push(this.round());
        }
        const leader = this.leaderOf(d);
        if (leader === e.host) {
          m.visitsToLeaderBySeat[e.seat] = (m.visitsToLeaderBySeat[e.seat] ?? 0) + 1;
        }
        if (e.mode === 'worker') this.workerVisit(d, e.seat, e.host, leader === e.host);
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
        // ⚠️ `upgrade` JOINED THIS LIST ON 19/08/2026, and it is gated on the
        // knob that moved it. Flipping a starter is a bonus-slot spend now, so
        // a turn that flipped one has spent its slot and is NOT an unspent
        // slot; under `overlays/upgrade-main-action.overlay.json` the flip is a
        // main action again and must not be counted here, or the control arm
        // would report its own upgrades as bonus spends and the five-way tally
        // would not be comparable between the arms - which is the only way it
        // is ever read.
        //
        // `market` is on the list for the same one-apply reason and NOT because
        // the market is live - it is null as of 19/08/2026. It matters only
        // under `overlays/turn-structure-v14.overlay.json`, which restores both
        // the market and the any-time slot together, and that is precisely the
        // arm the five-way tally is read against: a market taken after the
        // action would end the turn in the same apply and be scored as an
        // UNSPENT slot, inflating the control's unspent share and flattering
        // the shipped rule by exactly the amount being measured.
        const bonusMove =
          d.move.type === 'visit' ||
          d.move.type === 'workOwnWorker' ||
          d.move.type === 'market' ||
          (this.data.rules.turn.upgradeIsBonus && d.move.type === 'upgrade');
        if (d.pre.turn.bonusSpent || bonusMove) {
          m.bonusTurnsBySeat[seat] = (m.bonusTurnsBySeat[seat] ?? 0) + 1;
        }
        // The Service clog, sampled once per turn boundary for EVERY seat: a
        // clogged Service is a state of the table, not an event, and it is the
        // brake that replaced the Working Week.
        for (let s2 = 0; s2 < m.seats; s2++) {
          m.serviceClogSampledBySeat[s2] = (m.serviceClogSampledBySeat[s2] ?? 0) + 1;
          if (isFull(this.data, serviceOf(this.data, d.post, s2))) {
            m.serviceClogTurnsBySeat[s2] = (m.serviceClogTurnsBySeat[s2] ?? 0) + 1;
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
      // Claimed and uninteresting for balance: card movement between zones that
      // no assertion and no funnel layer reads.
      case 'cardPlaced':
      case 'cardsDiscarded':
      case 'demolished':
      case 'gameEnded':
        return;
      default:
        e satisfies never;
    }
  }

  /**
   * The worker-visit, priced in one currency so assertion 2's ratio means
   * something. The host's gain is the wage the bank mints. The visitor's gain
   * is what they gave up to take the Worker instead: the coins the same board
   * would have paid them for the same card. v14 section 7.2 frames the concern
   * in exactly that pair - "he gives a rival a card AND mints them up to £3"
   * against the £1 he could simply have taken.
   */
  private workerVisit(d: Decision, visitor: Seat, host: Seat, hostWasLeader: boolean): void {
    const wage = d.events
      .filter((x) => x.e === 'coins' && x.seat === host && WAGE.test(x.why))
      .reduce((acc, x) => acc + (x.e === 'coins' ? x.delta : 0), 0);
    const board = player(d.pre, host).tableau.find(
      (b) => cardById(this.data, b.card).slot === 'noticeboard',
    );
    const rates = this.data.rules.economy.visitPayout;
    this.m.workerVisits.push({
      visitor,
      host,
      hostGain: wage,
      visitorAlternative: board?.upgraded ? rates.upgraded : rates.base,
      hostWasLeader,
    });
  }

  private roundBoundary(state: GameState): void {
    const m = this.m;
    m.rounds += 1;
    m.coinsByRound.push(medianOf(state.players.map((p) => p.coins)));
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

  /** `why` strings that name a card: the bare id, and the `rider:` form. */
  private cardTag(why: string): CardId | null {
    if (this.m.cards.has(why)) return why;
    const rider = RIDER.exec(why);
    if (rider && rider[1] && this.m.cards.has(rider[1])) return rider[1];
    return null;
  }

  /** Close the fold: final scores, VP attribution, and any worker still on its track. */
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
    });
    return m;
  }
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
