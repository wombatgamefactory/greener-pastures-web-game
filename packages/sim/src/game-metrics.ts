/**
 * WHAT THE SIMULATOR RECORDS: the metric types, and the reasoning for each.
 *
 * Lifted out of `observe.ts` on 2026-09-12. That file is two things - this
 * dictionary of what a game yields, and the `Fold` class that fills it in - and
 * at 3,923 lines the two could not be read apart. Nothing moved but the
 * declarations: there is no runtime code here at all, so tsc erases this file
 * entirely and `observe.ts` re-exports all four types. Every existing
 * `import { GameMetrics } from './observe.js'` still resolves.
 *
 * ⚠️ A METRIC'S COMMENT IS ITS DEFINITION. Several readings in this file are
 * shares of DIFFERENT denominators - turns, plays, harvests, door uses - and
 * quoting one against another's band has cost this project a full re-run
 * before. Read the comment before quoting the number.
 */

import type { Suit } from '@gp/data';
import type { PolicyId } from '@gp/bots';
import type { CardId, ScoreBreakdown, Seat } from '@gp/engine';
// Type-only, so the driver <-> metrics edge is erased and no cycle reaches runtime.
import type { Outcome } from './driver.js';

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

/**
 * ⭐ THE MEEPLE-LOOP ARM'S GENEROSITY, and the reason `RivalFreight` above could
 * not simply be re-pointed at it: the two arms give different THINGS, and the
 * things behave differently once given.
 *
 * A card fee lands on a rival's board and stays a card - it reaches their barn
 * or it dies there, and that is the whole story. A meeple lands in a rival's
 * SLOT and is a stored ACTION: it comes home to them on their next Collect, it
 * shuts that colour of their farm to the whole table while it sits there, and it
 * can be REFUSED at the door by the supply cap, in which case they got the
 * denial and none of the payment. So the arithmetic parallel is exact and the
 * meaning is not:
 *
 *   given     meeples placed on rivals' boards - the gift as it leaves
 *   received  meeples that landed on this seat's own board
 *   home      of those, the ones that survived the cap on the owner's Collect
 *   toLeader  meeples given to the seat that was already the sole VP leader
 *
 * `received - home` is the cap eating the host's payment, which has no analogue
 * in the card game at all and is the one number that could say the cap is set
 * too tight. Under `visitCurrency: 'card'` every field here stays 0 and
 * `RivalFreight` carries the transfer, so no report can pool the two by
 * accident.
 */
export interface MeepleGift {
  givenBySeat: number[];
  receivedBySeat: number[];
  homeBySeat: number[];
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
  /**
   * ⭐ NEW ON 12/09/2026 (a24): THE BARN EACH SEAT WAS STILL HOLDING WHEN THE
   * GAME STOPPED, read off the final state.
   *
   * ⛔ THIS IS "CARDS THAT ENTER A BARN AND NEVER LEAVE IT", which
   * `docs/village-store-coins-2026-09-12-v2.md` section 1 puts at about ELEVEN
   * a player a game and which is the MECHANISM behind the reshuffle reading
   * rather than a second symptom of it. `barnByRound` is a MEDIAN ACROSS
   * PLAYERS at a round boundary and cannot be summed into a per-player total;
   * this is per seat and can.
   *
   * ⚠️ It is an upper bound on stranding rather than the parity trap itself. A
   * card sitting in a barn at the end may have been deliverable and simply not
   * delivered before the trigger fired.
   */
  barnAtEndBySeat: number[];
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
   * ⭐ THE TWO HALVES OF `actionsBySeat`, KEPT APART FOR a16's RE-CUT (Dean,
   * 04/09/2026 evening, handoff v2 preamble): `mainActionsBySeat` is the ONE
   * core action a turn takes by rule (draw/build/grow/harvest/deliver/
   * moveBalloon); `boughtDoorActionsBySeat` is every `doorUsed` event
   * regardless of what paid for it - a card fee under `'card'`, a meeple visit
   * under `'meeple'`. Neither field is new counting: both are drawn from
   * events `actionsBySeat` already folds in, split apart rather than pooled,
   * so `actionsBySeat` itself is untouched and `report.ts`'s own reading of it
   * cannot move. Collect and the free Draw 1 are deliberately absent from
   * both - a16 puts them on their own line instead of inside the action count.
   */
  mainActionsBySeat: number[];
  boughtDoorActionsBySeat: number[];
  /**
   * MEEPLES GAINED AND SPENT, by seat and by colour. `gained - spent` over a
   * whole game is exactly the meeples that died unspent in a supply, because a
   * spent meeple returns to no pool - which is the dead-component number the
   * v31 plan asks for.
   *
   * ⛔⛔ THAT SENTENCE IS TRUE ONLY UNDER THE SHIPPED `'card'` GAME, AND IT IS
   * THE SINGLE EASIEST THING TO GET WRONG ABOUT THE MEEPLE-LOOP ARM. Under the
   * arm a meeple RECIRCULATES: it is spent onto a rival's board, collected back
   * into their supply, and spent again, so the same physical component is gained
   * many times over and `gained - spent` is arithmetic about a population that
   * does not exist. The counters are still fed - `spent` comes off the `visited`
   * event's meeple list rather than off `meepleSpent`, which the arm deletes -
   * because the COLOUR SPLIT is what the dead-colour line reads and it survives
   * the change of route. The RATIO does not. Assertion 15 refuses to print it
   * under the arm and reports spends per meeple-turn instead.
   */
  meeplesGainedBySeat: number[];
  meeplesSpentBySeat: number[];
  meeplesGainedByColour: Record<string, number>;
  meeplesSpentByColour: Record<string, number>;
  /** Meeples still in a supply when the game stopped, by seat. Read off the final state. */
  meeplesUnspentBySeat: number[];
  /**
   * ⭐ NEW ON 12/09/2026 FOR THE DELIVERY MEEPLE (M1 to M8, ledger A151, a23):
   * THE STRANDED COUNT BY COLOUR, read off the FINAL STATE and never derived as
   * gained-by-colour minus spent-by-colour.
   *
   * The two agree by construction under this arm - a spent meeple leaves the
   * game and returns to no pool, and with `meepleCapPerColour` null nothing is
   * boxed - so reading the state rather than the difference costs nothing and
   * makes a disagreement between them an engine bug nobody has to go looking
   * for. That is the same reason `meeplesUnspentBySeat` above is read off the
   * state, and a23 prints both totals so the identity is visible.
   *
   * ⛔ IT IS A DIFFERENT QUANTITY FROM `meeplesBoxedByColour`. A boxed meeple was
   * refused by the supply cap (R4, the meeple-loop arm); a stranded one was held
   * and never spent, which is D8 arriving as a number.
   */
  meeplesUnspentByColour: Record<string, number>;
  /**
   * ⭐ NEW ON 12/09/2026 (M4, M6, M7, ledger A151, a23): WHAT A SPENT MEEPLE
   * ACTUALLY BOUGHT, off the `meepleSpent` event's own `action` field.
   *
   * ⛔ READ THE EVENT AND NEVER RE-DERIVE THE ACTION FROM THE COLOUR. The field
   * was widened to `DoorAction` at commit `1b60def` precisely because the two
   * stopped agreeing: under M7 an APIARY meeple buys GROW where the workers
   * roster's apiary door buys SOW, and under M6 an ORCHARD meeple buys the PLAIN
   * Draw 2 where the Notice Board power is Draw 4. A colour-derived action here
   * would report a Sow that never happened.
   *
   * ⚠️ IT IS NOT THE SAME POPULATION AS `meepleDoorByColour`, which counts door
   * uses a meeple paid for under the meeple-loop arm's visit. This counts the
   * plain action a discarded island meeple bought after the main action.
   */
  meeplesSpentByAction: Record<string, number>;
  /**
   * ⭐ NEW ON 12/09/2026 (a23): TURNS THE SEAT BEGAN HOLDING AT LEAST ONE MEEPLE.
   *
   * The denominator D8 needs. `meepleTurnsBySeat` above asks the same question
   * and is GATED BEHIND `isMeepleCurrency`, so it is a structural zero under the
   * delivery meeple, whose currency is `'noticeBoardPower'`. This one is folded
   * at the same clean turn-start moment with no mode gate at all, which costs
   * nothing under a currency with no meeples in it: `meeplesHeld` returns an
   * empty list and the counter never moves.
   *
   * ⚠️ IT COUNTS TURNS AND NEVER MEEPLES. A seat holding three meeples for one
   * turn adds one, which is the right shape for "how many chances to spend did
   * this seat have" and the wrong one for "how long did a meeple sit".
   */
  meepleHeldTurnsBySeat: number[];
  /**
   * ⭐ NEW ON 12/09/2026 (a23): the 1-based round of every meeple minted and of
   * every meeple spent, so "it arrived too late to spend" can be separated from
   * "nobody wanted it".
   *
   * ⚠️ THIS IS THE FAILURE MODE THE DELIVERY MEEPLE IS MOST EXPOSED TO AND IT IS
   * STRUCTURAL RATHER THAN A TASTE. The meeple's only source is a second
   * delivery and the game ENDS on a sixth delivery by any player, so the last
   * meeples a seat earns are minted on the turns it has fewest left. A stranded
   * share that is mostly final-round mints is the end trigger and not the
   * component; a stranded share spread evenly across the game is the component.
   */
  meepleGainedRounds: number[];
  meepleSpentRounds: number[];
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
   * ⭐ NEW ON 12/09/2026 FOR DEAN'S CIRCULATION ARGUMENT (a24): THE CARDS A
   * RESHUFFLE PUT BACK, summed per crop off the `reshuffled` event's own
   * `count`, which the engine sets to the deck's length the instant after the
   * discard was shuffled into it (`fx.ts` `takeDeckTop`).
   *
   * ⭐ THAT NUMBER IS THE CIRCULATING POOL MEASURED AT THE ONLY MOMENT IT IS
   * EXACTLY KNOWABLE, and it is the term Dean's argument turns on. A reshuffle
   * happens when a deck runs dry, so the count is every card of that crop that
   * was neither in a hand, nor on a table, nor locked in a barn. `sum / count`
   * is the mean pool per reshuffle.
   *
   * ⛔ IT IS THE DENOMINATOR OF THE RESHUFFLE COUNT AND MUST BE READ BESIDE IT.
   * Reshuffles are draws divided by pool, so a reshuffle count that moves says
   * nothing on its own about which of the two moved. `deckTopsTakenByCrop` is
   * the other term.
   */
  reshuffledCardsByCrop: Record<string, number>;
  /**
   * ⭐ NEW ON 12/09/2026 (a24): `deckTopsTaken` SPLIT BY CROP, and it is that
   * scalar split rather than a second sample - the same decision diff, per
   * suit, before it is summed.
   *
   * It is the draw volume, which is the other half of the reshuffle
   * arithmetic. If reshuffles per played deck fall while this falls with them,
   * the game got shorter; if reshuffles fall while this holds and
   * `reshuffledCardsByCrop` rises, the POOL got bigger, which is the only one
   * of the two that would prove Dean's circulation argument.
   */
  deckTopsTakenByCrop: Record<string, number>;
  /**
   * ⭐ NEW ON 12/09/2026 (a24): THE DECK AND DISCARD OF EACH CROP ADDED TOGETHER
   * AT THE FINAL STATE - what is still circulating when the game stops.
   *
   * Read beside `reshuffledCardsByCrop` rather than instead of it. The pool at
   * a reshuffle is the pool in flight and needs a reshuffle to have happened;
   * this one exists in every game including one where a deck never ran dry, and
   * it is the complement of the barn line: a crop's 18 cards are in a hand, a
   * tableau, a barn or here.
   */
  poolAtEndByCrop: Record<string, number>;
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

  // --- The meeple-loop arm, 04/09/2026 -------------------------------------
  //
  // ⚠️ EVERY LINE IN THIS BLOCK IS ZERO UNDER THE SHIPPED `'card'` GAME, and
  // that is the contract the whole arm is measured under: `'card'` is the
  // experimental control and its numbers have to stay comparable with every
  // report in `reports/`, so nothing here is allowed to move a counter the
  // control already had. Read a zero as "the arm was off", never as a finding.
  //
  // ⚠️ AND NONE OF THEM HAS A NOISE FLOOR YET - run --noise before reading a
  // movement in one as a result, exactly as the Vegetable and Dairy blocks
  // above say of their own.

  /**
   * COLLECTS THAT TOOK MEEPLES HOME, against COLLECTS ON AN EMPTY BOARD.
   *
   * ⭐ THE SECOND OF THESE IS THE SOLITAIRE LINE, and it is what the free Draw 1
   * became: R9 deletes the standalone bonus draw, and the only card the slot can
   * still draw is the one attached to Collect. An empty-board Collect is
   * therefore exactly a Draw 1 wearing a different name, and the four-way bonus
   * mix has to be able to see it as one - which is why the engine emits
   * `boardCollected` with both lists empty rather than staying silent.
   *
   * A collect that took meeples home is a different animal: it is the host
   * being PAID for having been visited, which is the half of the design that
   * v31 had nothing of at all.
   */
  collectsWithMeeplesBySeat: number[];
  collectsEmptyBySeat: number[];
  /**
   * VISITS PAID WITH A WILD PAIR (R10), by seat. Two meeples spent as one of any
   * colour, both landing in the slot bought.
   *
   * The design's own open question turns on this share (handoff section 8): the
   * colour keying is doing work while the wild is rare, and if the wild takes
   * over half of all spends the slots probably want to be five unkeyed spaces
   * instead. a07 prints it as the wild share of all spends for that reason.
   */
  wildVisitsBySeat: number[];
  /**
   * MEEPLES RETURNED TO THE BOX under the supply CAP (R4) ONLY - `'collect'`,
   * `'island'` and `'balloon'`, the three sources v1 had and the only ones
   * this field has ever counted.
   *
   * ⚠️ DELIBERATELY KEPT CAP-ONLY (handoff v2, 04/09/2026), AND THAT IS A FIX
   * RATHER THAN THE ORIGINAL DESIGN. `meepleBoxed`'s `source` union grew four
   * new members under R15 and the amended R6 - `'build'`, `'activation'`,
   * `'delivery'`, `'toll'` - none of which the cap had anything to do with: a
   * meeple spent as a resource or burned as a toll left the game on its own
   * account, not because a supply overflowed. Before this fix the event
   * handler folded every source into this one seat total without looking, so
   * a report run under R15 would have quietly counted two unrelated things as
   * one number and moved the v1-comparable figure (13.41 boxed a game) for a
   * reason that had nothing to do with the cap. `meeplesBoxedAllSourcesBySeat`
   * below is the new grand total across every source; read the two side by
   * side and never let one stand in for the other.
   *
   * By SEAT, by SOURCE (`collect` is your own board coming home, `island` a
   * delivery, `balloon` the magenta balloon's bag draw) and by COLOUR. The
   * source split is the one that diagnoses: boxing on `collect` says the cap is
   * refusing the host's own payment, boxing on `island` says it is refusing the
   * island's, and those are two different arguments about whether the cap is
   * set right.
   */
  meeplesBoxedBySeat: number[];
  /**
   * ⭐ EVERY SOURCE, INCLUDING THE FOUR R15/R6 ADD (handoff v2, 04/09/2026):
   * `'build'`, `'activation'`, `'delivery'` (a meeple spent as a card - R15)
   * and `'toll'` (a meeple burned to enter an occupied slot - R6 amended),
   * beside the original `'collect'`, `'island'`, `'balloon'`. This is the
   * figure the handoff calls "every meeple that left the game"; `meeplesBoxedBySeat`
   * above is the CAP-ONLY subset of it, kept apart on purpose - see its own
   * comment. `meeplesBoxedBySource` below carries the same total split by
   * source name rather than by seat.
   */
  meeplesBoxedAllSourcesBySeat: number[];
  meeplesBoxedBySource: Record<string, number>;
  meeplesBoxedByColour: Record<string, number>;
  /**
   * ⭐ THE BLOCKED-WANT RATE (assertion 5 under the arm): turns on which the
   * seat reached its bonus slot holding a meeple whose door it could legally
   * use, and found NO FREE SLOT for that colour anywhere on the table.
   *
   * "Anywhere" means on a RIVAL's board, because there is no self-visit under
   * any flag (X5), so a seat's own free slot is not a place it can spend. At two
   * players that leaves exactly one board, which is why the handoff asks for
   * this number at 2p first and why it is the number that decides whether Dean's
   * island alternative (X2) has to come back.
   *
   * ⚠️ IT DOES NOT MEAN THE SEAT COULD NOT VISIT AT ALL. A seat blocked on
   * yellow and free on green is counted here and still had a visit to make. The
   * question is "the meeple I wanted to spend had nowhere to go", not "I was
   * shut out", and conflating the two would report a healthy table as a locked
   * one and vice versa. The shut-out question is `clogTurnsBySeat`, which the
   * probe beside this one still answers.
   */
  blockedWantTurnsBySeat: number[];
  blockedWantSampledBySeat: number[];
  /**
   * ⭐ THE HOLD-OUT RATE: turns that a seat BEGAN with its own Notice Board
   * still full - all five slots blocked - having had the chance to Collect and
   * not taken it.
   *
   * The arm's answer to clog-as-denial, and it points the opposite way from
   * v31's. A full board under the card game was a tax on the popular farm; a
   * full board here is a seat sitting on five stored actions it has chosen not
   * to bank, denying all five colours of its own farm to the table for as long
   * as it holds out. X3 rules out any penalty for it, so this measures a
   * behaviour that is entirely legal and entirely deliberate.
   *
   * ⚠️ IT IS NOT A SHARE OF ANYTHING THE BOTS WERE PRICED TO WANT. Collect is
   * priced as a draw plus the meeples actually kept, so a bot holds out only
   * when the cap would refuse what is on its board; a human might hold out to
   * deny. Read a low reading as "the pricer never wanted to", not as "nobody
   * would".
   */
  holdOutTurnsBySeat: number[];
  holdOutSampledBySeat: number[];
  /**
   * TURNS BEGUN WITH EVERY BOARD ON THE TABLE FULL, and the turns sampled. Total
   * gridlock of the visit economy: no colour is free at any seat, so the bonus
   * slot has nothing but Collect in it for everybody at once. Counted once per
   * turn for the table, not once per seat.
   */
  allBoardsFullTurns: number;
  allBoardsFullSampled: number;
  /**
   * TURNS BEGUN HOLDING AT LEAST ONE MEEPLE, by seat - the denominator for
   * "spends per meeple-turn" in assertion 15.
   *
   * ⭐ IT IS THE DENOMINATOR THAT REPLACES "GAINED", and the replacement is the
   * whole point. Under v31 a meeple was spent once and left the game, so
   * spent-over-gained was a real fraction of a real population. Under the arm a
   * meeple recirculates - spent to a rival, collected back, spent again - so
   * gained double-counts the same physical component and the ratio is
   * arithmetic about nothing. A turn on which a spend was POSSIBLE is a
   * population that does not move when the loop speeds up.
   */
  meepleTurnsBySeat: number[];
  /**
   * SLOT OCCUPANCY at turn boundaries: blocked slots against slots sampled, all
   * seats, five per seat. The continuous reading that sits under the binary
   * full-board rate in `doorClogTurnsBySeat` - a table at 20% occupancy and a
   * table at 80% both report few completely full boards, and only this line
   * tells them apart.
   */
  slotsBlockedAtBoundary: number;
  slotsSampledAtBoundary: number;
  /** The arm's generosity, in meeples. See `MeepleGift`. */
  meepleGift: MeepleGift;

  // --- R15 / R6 amended, the meeple-as-card handoff, 04/09/2026 -----------
  //
  // ⚠️ EVERY LINE IN THIS BLOCK IS ZERO WHEN `rules.turn.meepleAsCard` IS
  // `false` AND `rules.turn.slotToll` IS `null` - the shipped defaults, and
  // v1's own control. Neither `meepleAsCard` nor `visitToll` fires under those
  // defaults and `meepleBoxed`'s `source` never carries a resource or toll
  // value there, so nothing in this block can move under the control. Read a
  // zero as "the arm was off", exactly the contract the v31-era block above
  // states of itself. `meeplePoolByRound` and `poolEmptyRound` are the one
  // exception: they read off `visitCurrency: 'meeple'` alone (not off R15 or
  // the amended R6), because the pool exists the moment the shipped v1 loop
  // does - see their own comments.

  /**
   * MEEPLES SPENT AS A CARD OF THEIR COLOUR (R15), one `meepleAsCard` event =
   * one meeple. `meepleResourceSpendsByUse` splits the same total by what it
   * paid; the two must sum to the same number across a run, and a
   * disagreement between them is a fold bug, not a design reading.
   */
  meepleResourceSpendsBySeat: number[];
  /** ...by USE: a build cost (including a Power/Endgame card's own-suit half), a Grow's activation payment, or an island crate. */
  meepleResourceSpendsByUse: Record<'build' | 'activation' | 'delivery', number>;
  /**
   * Of `meepleResourceSpendsByUse.activation`, THE ONES THAT FIRED A BUILDING
   * ALREADY AT ITS THRESHOLD - the priced clog bypass R15 deliberately allows
   * (Dean, 04/09/2026 evening) and the number the handoff names as the new
   * dial by name (section 3.3). A meeple paid into a Grow never joins the
   * stack and never counts toward the threshold, so this is the one exit a
   * card could never have made on its own. Report it apart from the
   * `'activation'` total above AND as a share of every meeple that left the
   * game by any route (`meeplesBoxedAllSourcesBySeat`, summed) - the handoff
   * asks for both.
   */
  meepleResourceAtThresholdSpends: number;
  /**
   * Of every `meepleAsCard` event, the ones that were half of a WILD PAIR
   * (R10) - two meeples of colours other than the built suit, spent as one
   * card of any colour. Always an even number across a run; divide by two for
   * the count of PAIRS, since two of these events are one resource paid.
   */
  meepleResourceWildSpends: number;
  /** 1-based round of each `meepleAsCard` event - the numerator for the hoard-and-dump line's "spends in the final two rounds" share. */
  meepleResourceSpendRounds: number[];

  /** TOLL MEEPLES PAID (R6 amended) to enter an already-occupied slot, by the visitor who paid them. They go to the box, never to the host. */
  tollMeeplesPaidBySeat: number[];
  /** Visits that paid a NONZERO toll, by the visitor - the numerator for "share of visits that paid a toll" (handoff section 3.7). */
  tollVisitsBySeat: number[];
  /**
   * VISITS RECEIVED, by host, self-visits excluded by construction (X5) - "does
   * the popular farm change hands" (handoff section 3.7). A count of VISITS,
   * not of meeples, on purpose: `meepleGift.receivedBySeat` already counts
   * meeples received and a wild pair (two meeples, one visit) would silently
   * double-weight a single visit if that field were reused for this question.
   */
  visitsReceivedBySeat: number[];
  /**
   * R17: meeples spent as a CARD that landed on somebody's board, counted from
   * the payer's side and from the receiver's side.
   *
   * ⚠️ THESE ARE NOT VISITS AND MUST NEVER BE POOLED WITH THEM. A placement
   * buys the payer no door and does not spend the bonus slot, so a08's hook
   * counts none of it. What the pair is FOR is the question R17 creates: a
   * resource spend now feeds a neighbour, so who gets fed, and how evenly, is
   * the new decision on the table.
   */
  meeplesPlacedBySeat: number[];
  meeplesPlacedReceivedBySeat: number[];

  /**
   * ⭐ THE MEEPLE POOL AT EVERY ROUND BOUNDARY (handoff v2 section 3.5): every
   * meeple anywhere in the game at that instant - every seat's supply, every
   * Notice Board slot on the table, and every meeple still sitting on an
   * undelivered island space - summed once per round boundary.
   *
   * ⭐ READ DIRECTLY OFF STATE, NOT DERIVED FROM A RUNNING BALANCE. The fold's
   * `roundBoundary` already holds the full post-turn `GameState` -
   * `meeplesByRound` above reads every player's supply off that very state -
   * so the pool is counted exactly, the same way, rather than reconstructed
   * from `meepleGained` minus every drain. `observe.ts` sees round-boundary
   * state and always has; there was no engine hook to add for this line.
   *
   * Zero-length under `visitCurrency: 'card'`, where there is no pool at all -
   * no slots, no starting five, nothing to sum. Non-empty under the shipped
   * `'meeple'` default even with R15 and the amended R6 both off, because the
   * pool (supplies plus slots plus island) exists under v1 already; what R15
   * and R6 change is only how fast it drains.
   */
  meeplePoolByRound: number[];
  /** 1-based round the pool first read zero, or null if it never did in this game. */
  poolEmptyRound: number | null;

  /**
   * ⭐ THE NOTICE-BOARD VISIT'S OWN COUNTERS (S5-S11, Dean 10/09/2026), and all
   * seven of them are read off STATE rather than off an event, for one reason:
   * the fold holds the
   * post-move `GameState`, so a stack is counted rather than reconstructed from
   * a running balance that can drift.
   *
   * ⛔ THEY EXIST BECAUSE THE OLD DOOR-CLOG PROBE HAS STOPPED ANSWERING THE
   * QUESTION. `doorClogTurnsBySeat` asks "is this seat's Notice Board FULL",
   * and under S8's `3+` rule a Notice Board is never full: three is the MINIMUM
   * to harvest at and never a maximum load, so `isFull` answers false however
   * deep the stack goes and a04 reads a GENUINE and permanent 0%. The real
   * question the predecessor's record asks - does a board sit loaded while its
   * owner declines to clear it - needs `isHarvestable` and a run length, and
   * that is what these are. `a20-board-stall` owns them.
   *
   * TOTAL CARDS RESTING ON EVERY SEAT'S NOTICE BOARD, sampled at every round
   * boundary. a18 reads its thirds.
   */
  noticeBoardCardsByRound: number[];
  /**
   * The same series as THREE numbers - the median across this game's first,
   * middle and last third - computed once in `finish` so games of different
   * lengths pool. Empty when the game was too short to have thirds.
   */
  noticeBoardCardsByRoundThird: number[];
  /**
   * ⭐ THE STALL PROBE, AND THE SAMPLING POINT IS THE WHOLE OF ITS MEANING.
   * Sampled once per seat at THAT SEAT'S OWN turn boundary, not once per seat
   * at every turn boundary the way the door clog is. So the denominator is the
   * owner's own turns and a run of k is "k of my own turns went by with my
   * board sitting harvestable and me not harvesting it", which is the question
   * S8 exists to answer and the unit a reader can act on.
   *
   * ⚠️ IT THEREFORE CANNOT SEE A BOARD THAT FILLED AND WAS CLEARED INSIDE ONE
   * ROUND, and that is deliberate: a board the owner cleared at the first
   * opportunity never stalled. The cost is that this is a floor on how often a
   * board is loaded, never an estimate of it.
   */
  boardHarvestableTurnsBySeat: number[];
  /** The denominator for the line above: the owner's own turn boundaries. */
  boardSampledTurnsBySeat: number[];
  /**
   * COMPLETED stall runs, in owner turns, pooled across the seats of one game.
   * A run opens at the first of the owner's turn boundaries with the board at
   * or above its threshold and closes when a later one finds it below - which
   * under these rules means the owner harvested it.
   */
  boardStallRuns: number[];
  /**
   * Runs still OPEN when the game ended, which are the boards nobody ever
   * cleared. Kept apart from the completed ones rather than pooled with them:
   * an unfinished run is right-censored and a mean over the two together would
   * quietly understate exactly the failure this reading is looking for.
   */
  boardStallRunsOpenAtEnd: number[];
  /**
   * The deepest ANY of this seat's boards ever got, sampled at the same
   * boundary. ⚠️ At two seats under `rules.economy.noticeBoardsBySeats` a seat
   * has two, so this is the deeper of the pair rather than "the board's"
   * maximum, and a20 labels it that way.
   */
  boardMaxStackBySeat: number[];
  /**
   * Cards on ALL of each seat's Notice Boards at game end, summed. Two readings
   * at once: the cards that died on a board and were never anybody's payment,
   * and the handoff's reading 9 for A21 The Wax Hall, which counts a building
   * with a card on it and now counts this one (S16).
   *
   * ⛔ SUMMED OVER EVERY BOARD SINCE 11/09/2026 (Dean's two-board fix). It read
   * the own-suit board alone, which at two seats under the arm is half the
   * boards on the table.
   */
  boardCardsAtEndBySeat: number[];
  /**
   * ⭐ THE PER-BOARD POPULATION AT GAME END, kept beside the per-seat total
   * because A21 The Wax Hall scores a BUILDING holding a card and a seat is not
   * a building. `boardsAtEnd` is every Notice Board on the table when the game
   * stopped and `boardsHoldingAtEnd` the ones still carrying at least one card.
   * Identical to the seat counts in every game that lays out one board each.
   */
  boardsAtEnd: number;
  boardsHoldingAtEnd: number;
  /**
   * ⭐ THE COLOURS OF THE EXTRA NOTICE BOARDS EACH SEAT LAID OUT, in tableau
   * order (Dean's two-board fix, ruled 11/09/2026), captured once off the first
   * pre-state. EMPTY for every seat in every game this project has shipped.
   *
   * ⛔ IT IS WHAT MAKES THE OWN-AGAINST-RANDOM SPLIT READABLE, which is open
   * risk 1 of the arm: a seat's own suit's board prints a power the seat itself
   * can never buy but which is at least its OWN suit, and the extra board is
   * drawn AT RANDOM from the suits nobody is farming, so which one you get is
   * luck and its power is usable only by your rivals. Without this field a
   * report can count traffic by board colour and cannot say which kind of board
   * a colour was.
   *
   * A board colour identifies a board uniquely on the table: the own-suit
   * boards are the seats' own distinct suits and the extras are dealt from the
   * unfarmed suits without replacement, so no two boards in a game share one.
   */
  extraBoardsBySeat: Suit[][];

  // --- A16 THE BEEKEEPER'S VEIL (11/09/2026) --------------------------------
  //
  // ⭐ THE COUNTER THE ENGINE PASS ASKED FOR, AND IT IS A DESIGN READING RATHER
  // THAN A BOOKKEEPING ONE. A16 fires on a placement that brings a building's
  // stack to 2 (`afterPlacement`, and it is the ONLY `afterPlacement` handler in
  // the catalogue). A fee landing on a RIVAL'S Notice Board is such a placement
  // and fires it.
  //
  // ⚠️ HOW IT IS READ, AND THE ONE APPROXIMATION IN IT, STATED RATHER THAN
  // HIDDEN. There is no `abilityFired` event (see this file's header), so a fire
  // is reconstructed off `cardPlaced`: the placer holds A16 in their tableau,
  // and the placed card sits at INDEX 1 of the target building's stack in the
  // post-state, which is the stack position `afterPlacement` reported. That is
  // exact unless a card BENEATH it left the same stack inside the same decision
  // (`fx.spendFromStack` and `fx.discardStack`, both Dairy-only and neither
  // naming its building in an event), in which case the placement is missed.
  // A fire can never be invented by it, so every number below is a FLOOR.
  /** Fires caused by a card landing on a RIVAL's Notice Board - the cross-table fee. */
  a16FiresRivalBoard: number;
  /** Fires caused by a card landing on the placer's OWN Notice Board - a self-visit fee. Structurally 0 where self-visiting is banned. */
  a16FiresOwnBoard: number;
  /** Fires caused by an ordinary placement - a GROW payment, a sow, a build rider. Every mode has these. */
  a16FiresOrdinary: number;
  /** Seats holding A16 at the moment of a placement, summed over placements - the availability denominator, so a low fire count can be told from a card nobody built. */
  a16PlacementsWhileHeld: number;
  /**
   * ⭐ THE FARM-BYPASS READING (a18): barn cards a HARVEST took off the seat's
   * own buildings. A SUBSET of `barnInBySeat`, which pools every route into a
   * barn including the deck, hand, stack and discard shortcuts - so the two do
   * not sum and are not meant to.
   */
  barnFromOwnBySeat: number[];
  /**
   * ⭐ THE SECOND SOURCE OF A BARN CARD (11/09/2026): cards a seat harvested off
   * its OWN NOTICE BOARD,
   * which under `visitCurrency: 'noticeBoardPower'` is the fee material rivals
   * paid onto it.
   *
   * ⛔ IT IS A STRICT SUBSET OF `barnFromOwnBySeat` AND MUST BE SUBTRACTED FROM
   * IT, never added beside it. A Notice Board is a building in a tableau under
   * that currency, so the engine carries `source: 'tableau'` on a harvest of it
   * and the own-buildings column counts it - which is right for the engine and
   * wrong for a18, whose question is "did this card come off your FARM or out
   * of somebody else's pocket". `barnFromOwnBySeat` minus this is the farm.
   *
   * ⚠️ IT IS NOT THE SAME QUANTITY AS `freight.bankedBySeat`, and the gap is
   * the reason both exist. `freight.bankedBySeat` counts only cards a RIVAL
   * paid; this counts every card that came off the board, so the difference is
   * the owner's OWN self-visit fees coming home. A ban on self-visiting makes
   * the two equal by construction, which is exactly why the split is folded
   * rather than assumed.
   *
   * Zero under both controls, where under `'card'` and `'meeple'` the board has
   * no stack a harvest reaches.
   */
  barnFromOwnBoardBySeat: number[];
  /**
   * ⭐ DEAD COINS: coins still held when the game ended, read off the FINAL state
   * rather than derived as minted minus spent, on exactly the reasoning
   * `meeplesHeldAtEnd` states of itself.
   */
  coinsHeldAtEndBySeat: number[];
  /** ⭐ THE ARC: the 1-based round on which each seat first minted a coin, or null if it never did. */
  firstCoinRoundBySeat: (number | null)[];

  // --- THE VILLAGE STORE COIN, 12/09/2026 (V1 to V12, ledger A150) ---------
  //
  // ⚠️ EVERY LINE IN THIS BLOCK IS ZERO UNDER EVERY GAME WITH
  // `rules.economy.storeCoinsPerCard` AT ITS SHIPPED 0, which is every mode this
  // project has ever shipped. Read a zero as "there is no Village Store in this
  // game", never as a finding. a25, a26 and a27 all gate on that leaf and print
  // NO SUBJECT rather than a page of structural zeroes.
  //
  // ⚠️ AND NONE OF THEM HAS A NOISE FLOOR. `reference-v15` has never had
  // `--noise` run against a Store arm, and no line here is in `HEADLINE_METRICS`.

  /** ⭐ THE MINT (V1), AS CARDS: barn cards converted at the exchange, by the seat that converted them. One `coinsMinted` event with `board: 'store'` per CARD, so this is the count of cards that left a barn for their suit's discard (D1). */
  storeCardsConvertedBySeat: number[];
  /** ...AS COINS. Equal to the cards at `storeCoinsPerCard: 1`, and deliberately kept apart because the leaf is an int so the rate can be swept without another knob. A disagreement at rate 1 is a fold bug. */
  storeCoinsMintedBySeat: number[];
  /** ...by the CONVERTED CARD'S OWN SUIT, off the event's `card`. Which crops actually strand in a barn, which is the parity trap named rather than inferred. */
  storeConvertedByCardSuit: Record<string, number>;
  /**
   * ⛔ C113's DENOMINATOR: exchange WINDOWS offered. One per `mint` task pushed,
   * which is one per delivery where `min(barn after the crate, supply left)` was
   * above zero - `pushStoreExchange` pushes nothing when either is 0, so a window
   * is exactly "a delivery at which a conversion was possible".
   *
   * ⚠️ COUNTED OFF THE TASK AND NEVER OFF THE `delivered` EVENT, because V14 emits
   * a SECOND `delivered` with an empty spend for the same payment and a
   * delivery-keyed count would double it.
   */
  storeExchanges: number;
  /** ...the sum of those windows' CEILINGS, `min(barn, supply)` read off the task's own `remaining` at the moment it was offered. The convertible cards available, which is C113's other denominator. */
  storeExchangeCeiling: number;
  /** ...the sum of the BARN SIZES at those moments, so a reader can see whether the ceiling was the barn or the SUPPLY. A ceiling far below the barn is the supply rationing, which is the half of C113 Dean's answer rests on. */
  storeExchangeBarn: number;
  /** ⛔ C113's NUMERATOR: windows at which the seat converted AT LEAST ONE card. Near 100% is the August verdict confirmed. */
  storeExchangesUsed: number;
  /** ...and windows at which the seat converted EVERY convertible card it had. Nearer to C113's actual sentence than the line above: "every player converts every spare card every time". */
  storeExchangesEmptied: number;
  /**
   * ⛔ DELIVERIES THAT COULD NOT CONVERT AT ALL, counted once per seat per
   * decision so V14's double `delivered` cannot inflate them. Split by which
   * side was empty, because they mean opposite things: an empty BARN is a seat
   * with nothing stranded (the Store had nothing to fix) and an empty SUPPLY is
   * the cap actually biting, which is the pressure C113 asks about.
   */
  storeDeliveriesNoExchange: number;
  storeDeliveriesNoExchangeEmptySupply: number;
  storeDeliveriesNoExchangeEmptyBarn: number;
  /** ⭐ HOW OFTEN THE SUPPLY IS EMPTY (C113), sampled at the first decision of every turn, which is the same clean moment the hand is sampled at. Turns sampled, turns at which the shared supply held nothing, and the running total for a mean. */
  coinSupplySampledTurns: number;
  coinSupplyEmptyTurns: number;
  coinSupplySum: number;
  /** The shared supply still unspent when the game ended. `coinSupplyAtEnd + sum(coinsHeldAtEndBySeat)` is the whole pool under V5, and a disagreement is a fold bug. */
  coinSupplyAtEnd: number;
  /** ⭐ SINK ONE (V6/V7): coins spent on a BUILD, by seat. One `coinsSpent` event per build for the WHOLE coin component, because coins are fungible and a payment names a count, so this is coins and `coinBuildsBySeat` is builds. */
  coinsSpentBuildBySeat: number[];
  /** ...the count of BUILDS any part of which was paid in coins. */
  coinBuildsBySeat: number[];
  /** ⭐ SINK TWO (V8): coin-Grows, by seat. Always exactly one coin, so this is coins and Grows at once. Folded off the MOVE's `coinGrow` flag and the bought Grow's ANSWER, never off `coinsSpent`, so the two can be checked against each other. */
  coinGrowsBySeat: number[];
  /** ...of which were BOUGHT Grows (the Apiary board's, a `grow` task) rather than a main action. Two coin-Grows a turn is the design's stated ceiling and this is the half that makes the second one possible. */
  coinGrowsBoughtBySeat: number[];
  /** ⛔ V9, THE STRONGEST SINGLE CLAUSE IN THE PACKAGE: coin-Grows that fired on a building that was already FULL. The first clog bypass in this game since the meeples, and the one line that must be readable on its own. */
  coinGrowsOfFullBySeat: number[];
  /** EVERY Grow, by seat, main action and bought alike, so the coin half above has a denominator and card-Grows are the remainder. ⚠️ It is not `activationsBySeat`, which counts a Grow that PLACES NOTHING through the `activate` task and is a different population. */
  growsBySeat: number[];
  /**
   * ⛔ THE BRANCHING CONSEQUENCE OF A SINK THAT PAYS NO CARD (a27), and it is a
   * reading about the INSTRUMENT. The worst end-of-turn discard enumeration in
   * the game, and the worst position of any kind. A coin-Grow pays no card, so
   * cards stop leaving the hand, and the discard task enumerates C(hand, over)
   * - which is the exact shape that produced a 116,535-move position on
   * 02/09/2026 when the hand limit went.
   */
  maxDiscardMoves: number;
  maxLegalMovesSeen: number;

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
  /**
   * Balloon moves BY BALLOON ID (12/09/2026). ⛔ NOBODY HAD EVER MEASURED WHICH
   * OF THE FOUR IS TAKEN: every earlier reading is a table total, so a module
   * carried by one reward and three passengers is indistinguishable from four
   * even rewards. Keyed by the `balloon` field the `balloonMoved` event has
   * always carried, so this is a fold and not a new event. ⚠️ IT COUNTS MOVES,
   * NOT VALUE: the magenta balloon has no `amount` and cannot be swept, so a
   * low count on it may mean a dull reward or a reward that only pays a seat
   * holding a full building.
   */
  balloonMovesById: Record<string, number>;
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

  /**
   * ⭐ S17, THE HOST DRAW (Dean, ruled 11/09/2026, `rules.turn.hostDrawOnVisit`):
   * the cards the OWNER of a visited Notice Board took for being visited, by the
   * HOST whose hand they entered.
   *
   * ⭐ COUNTED OFF `cardsToHand` WITH `via === 'hostDraw'`, WHICH IS THE ONE
   * PLACE THE ENGINE LABELS THEM, and the label is a purely additive field so no
   * other count moves. ⛔ IT COUNTS CARDS ACTUALLY DRAWN AND NOT VISITS PROMISED,
   * which is the right quantity and not an approximation of a better one: a draw
   * task with no drawable deck has no legal answer and is dropped, so A DRY TABLE
   * PAYS NOTHING, and the gap between this and `visitsReceivedBySeat` is exactly
   * how often that happened.
   *
   * ⛔ A SELF-VISIT NEVER PAYS IT (the engine guards it), so nothing here is a
   * seat paying itself. A structural zero on every run with
   * `rules.turn.hostDrawOnVisit` at its shipped 0, which is every game this
   * project has ever measured before 11/09/2026.
   */
  hostDrawCardsBySeat: number[];
  /**
   * The same thing counted as PAYMENTS rather than as cards - one per host draw
   * that actually delivered - so `n` cards a visit and the share of visits that
   * paid anything can be read apart. Its denominator is `visitsReceivedBySeat`,
   * which is every non-self visit received.
   */
  hostDrawPaymentsBySeat: number[];
  /**
   * ⚠️ W17 THE PIE SHOP, COUNTED APART FROM THE RULE, because under S17 the card
   * and the rule say the same words and BOTH FIRE: a W17 owner visited once
   * draws two.
   *
   * ⛔ IT CANNOT BE READ OFF THE EVENT STREAM, and that is why it is folded off
   * the TASK instead. W17's cards arrive on an ordinary unlabelled `cardsToHand`
   * - `via` is S17's label and nothing else sets it - so the only thing that
   * separates them is the draw task's own `src`, which is `'W17'`. The count is
   * taken at the `keep` answer, the same moment the card funnel takes `kept`,
   * and it is EXACT rather than inferred.
   *
   * ⚠️ THE TWO ARE ASYMMETRIC AND THE ASYMMETRY IS THE READING: W17 carries the
   * once-a-turn latch every card's text carries (11/08/2026) and the RULE does
   * not, so a W17 owner visited twice in one turn draws THREE and not four.
   */
  w17DrawCardsBySeat: number[];
  /** W17 firings that actually delivered a card, by its owner. The same "cards drawn, not draws promised" contract the host draw's count keeps. */
  w17DrawFiresBySeat: number[];
  /**
   * EVERY CARD THAT REACHED A HAND ON A `cardsToHand` EVENT, pooled, and it is
   * the denominator for "what share of all the cards drawn did this rule add".
   *
   * ⚠️ WHAT IT IS NOT: it is not every card that ever entered a hand. A gift
   * (`cardGifted`) and the starting hand arrive on their own events and are deliberately excluded, because the question is what
   * share of the DRAWING this rule accounts for.
   */
  cardsToHandTotal: number;
  /**
   * ⛔ HAND SIZE, AND EVERY NUMBER FOLDED HERE IS A READING ABOUT THE INSTRUMENT
   * AND NOT ABOUT THE DESIGN. The engine bounds the hand at
   * `rules.turn.handLimit` because it cannot enumerate an unbounded one (C7);
   * THE TABLE PLAYS WITH NO HAND LIMIT AT ALL. Under S17 that stops being merely
   * true and becomes load-bearing on the reading, because the rule's principal
   * effect is more cards in hand: the instrument clips exactly the thing the
   * table enjoyed, and no report of it may be quoted as evidence about tightness
   * in either direction.
   *
   * Sampled once at the first decision of every turn, on the same clean moment
   * `buildSampledBySeat` uses.
   */
  handSampledTurns: number;
  handSizeSum: number;
  /** Turns that began AT the simulator's bound. The clipping, as a number. */
  handAtBoundTurns: number;
  handSizeMax: number;
  /**
   * ⭐ THE SAME THREE SAMPLES, BY SEAT, NEW ON 12/09/2026 FOR C114 - so a hand
   * reading can be split by the CROP the seat was farming, which is the one link
   * in the Orchard diagnosis that was inferred rather than measured.
   *
   * ⛔ EVERY ONE OF THEM IS A READING ABOUT THE INSTRUMENT AND NOT ABOUT THE
   * DESIGN, for exactly the reason the game-level fields above carry: the engine
   * bounds the hand at `rules.turn.handLimit` because it cannot enumerate an
   * unbounded one (C7) and THE TABLE PLAYS WITH NO HAND LIMIT AT ALL. Splitting
   * the reading by crop does not make it a reading about the game; it makes it a
   * reading about how the instrument treats each crop, which is why
   * `handAtBoundTurnsBySeat` is folded beside the mean rather than under it. A
   * crop clipped more often than another is a crop measured through a narrower
   * window, and a22 prints the two together for that reason.
   *
   * Folded at the same clean moment as the game-level fields, so the by-seat
   * sums are the game-level scalars split and never a second sample:
   * `sum(handSampledTurnsBySeat) === handSampledTurns` in every game.
   */
  handSampledTurnsBySeat: number[];
  handSizeSumBySeat: number[];
  handAtBoundTurnsBySeat: number[];
  /**
   * ⭐ THE LIQUIDITY FLOOR, BY SEAT: turns that began with an EMPTY HAND.
   *
   * The sharpest case of "no card the seat could legally spend as a fee", and
   * the only one that is exact under every mode this codebase has: a fee is a
   * card from the hand under `'card'` and `'noticeBoardPower'` alike, so a hand
   * of nothing cannot pay one. It is a floor on the build side too: a Build spends cards
   * from the hand, so an empty hand is also the sharpest case of "no build
   * available" that `noBuildTurnsBySeat` counts.
   */
  handEmptyTurnsBySeat: number[];

  cards: Map<CardId, CardFacts>;
}
