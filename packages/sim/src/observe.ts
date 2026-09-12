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
import {
  deliveriesPerTile,
  isCommons,
  isCommonsTakeCoins,
  isCommonsTakeToSpend,
  isMeepleCurrency,
  isNoticeBoardPower,
  meepleIndexForSpace,
  storeCoinsPerCard,
} from '@gp/data';
import type { CardId, GameEvent, GameState, Move, Seat, Task } from '@gp/engine';
import {
  MOVE_TYPES,
  anyBuildOption,
  bonusOpen,
  cardById,
  commonsBoards,
  commonsHarvestMin,
  cropOf,
  doorOf,
  faceOf,
  gameEndScores,
  handlerFor,
  hasCentre,
  isFull,
  isHarvestable,
  isOrchardCard,
  meeplesHeld,
  player,
  score,
  noticeBoardsOf,
  noticeBoardSlots,
  slotBlocked,
  anyVisitOption,
  workerActionLegal,
} from '@gp/engine';
import type { PolicyId } from '@gp/bots';

import type { Decision } from './driver.js';
import type { Outcome } from './driver.js';

/**
 * A16 The Beekeeper's Veil, named once. The only `afterPlacement` handler in the
 * catalogue (checked 11/09/2026), which is what lets `countA16` reconstruct its
 * fires off `cardPlaced` without an `abilityFired` event.
 */
const A16 = 'A16';

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
  // ⭐ THE MEEPLE-LOOP ARM'S TWO NEW EVENTS, both folded since 04/09/2026.
  // `meepleBoxed` is the supply cap's only leak, counted by SOURCE (which
  // faucet overflowed) and by COLOUR (which colour nobody can hold twice of);
  // `boardCollected` is what separates a Collect that took meeples home from a
  // Collect on an EMPTY board, which is the arm's solitaire line and the thing
  // the free Draw 1 became.
  meepleBoxed: true,
  boardCollected: true,
  // ⭐ THE MEEPLE-AS-CARD HANDOFF'S TWO NEW EVENTS (v2, 04/09/2026), both
  // gated behind their own knobs (`rules.turn.meepleAsCard`,
  // `rules.turn.slotToll`) and both silent under the shipped defaults.
  // `meepleAsCard` is R15's whole measurement surface - a meeple spent as a
  // card of its colour, one event per meeple; `visitToll` is the amended R6's
  // - meeples burned to enter an occupied slot. `meepleBoxed`'s `source` union
  // also grew four new members for the same change; see the field comments on
  // `meeplesBoxedBySeat` and `meeplesBoxedAllSourcesBySeat` below for the trap
  // that created and how it is avoided.
  meepleAsCard: true,
  visitToll: true,
  // ⭐ R17 (05/09/2026): a meeple spent as a card LANDING on a neighbour's board
  // rather than going to the box. It rides beside `meepleAsCard`, which still
  // carries the use and the threshold flag, so this one answers only "who got
  // fed" - and that is the question R17 exists to create.
  meepleplaced: true,
  // ⭐ THE COMMONS' ONE NEW EVENT (C3, 09/09/2026): a card played from a hand
  // onto one of the five central Notice Boards. It is the whole of the bonus
  // slot under `visitCurrency: 'commons'` and the only place the fee-suit mix
  // and the pile depth can be read - `doorUsed` fires beside it and says what
  // the play BOUGHT, which is a different question and a different counter
  // (D4). Silent under both controls, where there is no commons at all.
  commonsPlayed: true,
  // ⭐ DEAN'S VARIANT'S ONE NEW EVENT (09/09/2026, `rules.turn.commonsTake:
  // 'bonus'`): the whole of one central pile moving to a hand, no fee, no
  // action. Silent under the shipped `'harvest'` rule and under both controls.
  commonsTaken: true,
  // ⭐ DEAN'S 'spend' VARIANT'S SUMMARY EVENT (09/09/2026, `rules.turn.
  // commonsTake: 'spend'`): fires once per take, for every board, once its
  // resolution completes - the taken/used/discarded accounting `commonsTaken`
  // alone cannot carry for the dairy, vegetable and apiary legs. Silent under
  // `'harvest'` and `'bonus'` and under both controls.
  commonsSpent: true,
  // ⭐ THE COMMONS-WITH-COINS ARM'S TWO NEW EVENTS (K3/K4 and K7, Dean
  // 10/09/2026), both silent under every other value of `rules.turn.commonsTake`
  // and under both controls. `coinsMinted` fires BESIDE `commonsTaken` when a
  // take clears a pile to the suits' discard piles - one coin per card, so
  // `coins === cards.length` always - and is the arm's ONE mint. `coinsSpent`
  // fires at each of the arm's TWO sinks: the Farmstead's coin-paid GROW
  // (`on: 'farmstead'`, always one coin) and an Endgame card bought for
  // `rules.economy.endgameCoinCost` and no cards (`on: 'endgame'`, fired just
  // before a `built` whose `payment` is empty). ⛔ ONE MINT AND TWO SINKS IS THE
  // WHOLE ARITHMETIC (K7): every coin economy this project has shipped died of a
  // second faucet, so a third event here would be the old failure repeating.
  coinsMinted: true,
  coinsSpent: true,
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
  // The meeple-loop arm's other bonus option. Folded through the
  // `boardCollected` event rather than through the move, because the move
  // cannot say whether anything came home and the four-way bonus mix turns on
  // exactly that distinction.
  collect: true,
  // ⭐ THE COMMONS' BONUS OPTION (C3). Folded through BOTH the move and the
  // `commonsPlayed` event, and the split is the same one `visit` already draws:
  // the MOVE knows which card left the hand (so the funnel can junk it), and
  // only the EVENT knows how deep the pile it landed on was.
  //
  // ⛔ AND SINCE THE WILD PAIR (K3, 10/09/2026) THE MOVE IS THE ONLY THING THAT
  // KNOWS WHAT A **PLAY** IS. `rules.economy.commonsWildPair` lets two cards of
  // any colours pay for one board, and the engine emits ONE `commonsPlayed` PER
  // CARD, so a pair is two events for one play. Every PLAY count therefore folds
  // off this move (`commonsPlaysBySeat`, `commonsPlaysByBoard`,
  // `commonsWildPairPlaysBySeat`) and every CARD count off the event
  // (`commonsCardsIntoCentreBySeat`, `commonsPlaysByFeeSuit`). Under every other
  // knob the two are equal and nothing moves; under the pair they are not, and
  // conflating them is exactly the trap A Helping Hand sprang on a17 on
  // 09/09/2026.
  commons: true,
  // ⭐ DEAN'S VARIANT'S OTHER BONUS OPTION (09/09/2026): folded through BOTH the
  // move and the `commonsTaken` event, on the same split `commons` draws above -
  // the MOVE is what a bonus-turn tally counts, the EVENT carries the cards.
  commonsTake: true,
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

/**
 * The metric types live in `game-metrics.ts` since 2026-09-12 (1,527 lines of pure
 * declaration, lifted so this file is just the `Fold` that fills them in). They are
 * re-exported here so every existing import site keeps working.
 */
export type { CardFacts, RivalFreight, MeepleGift, GameMetrics } from './game-metrics.js';

// A re-export does not bind the names locally, and Fold uses two of them.
import type { CardFacts, GameMetrics } from './game-metrics.js';

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
  /**
   * ⛔ THE VILLAGE STORE EXCHANGE WINDOW IN PROGRESS (C113, 12/09/2026), or null
   * between windows. A window is one `mint` task from the moment it is first
   * faced to the moment it resolves, and it exists as instance state because the
   * question C113 asks is per-DELIVERY and the engine answers it one card at a
   * time.
   *
   * ⚠️ IT CANNOT BE TRACKED BY TASK IDENTITY. `apply` clones the whole state, so
   * the task object a decision sees is a different object from the one the next
   * decision sees. The window is closed instead by the CONTINUATION TEST in
   * `store` below, which is exact for every case but one it names.
   */
  private exchange: { pid: Seat; ceiling: number; barn: number; converted: number } | null = null;
  /**
   * Seats whose next harvest was BOUGHT through the wheat board, latched on the
   * `doorUsed` that paid for it. See `commonsHarvestsBoughtBySeat` for why the
   * route cannot simply be read off the `harvested` event.
   */
  private boughtHarvestPending = new Set<Seat>();
  /**
   * The stall run in progress for each NOTICE BOARD, in its owner's own turns,
   * or 0 while that board is below its threshold. Run state rather than a
   * metric: only the CLOSED runs reach `boardStallRuns`, and whatever is still
   * open when the game ends reaches `boardStallRunsOpenAtEnd` instead.
   *
   * ⛔ KEYED ON THE BOARD CARD AND NOT ON THE SEAT SINCE 11/09/2026 (Dean's
   * two-board fix). A seat lays out two boards at two seats under
   * `rules.economy.noticeBoardsBySeats`, they fill and empty independently, and
   * one counter per seat would splice two boards' histories into a single run.
   * Every board card is dealt at most once in a game - the own-suit board comes
   * with the starters and the extra is drawn from the suits nobody is farming,
   * without replacement - so the card id is a sound key.
   */
  private boardStallRun = new Map<CardId, number>();
  /**
   * The unclaimed run in progress for each CENTRAL pile, in TABLE turns, keyed
   * by board colour, or 0 while the pile is below `commonsHarvestMin`. Run
   * state rather than a metric, on exactly the contract `boardStallRun` states
   * of itself: only CLOSED runs reach `centralPileStallRuns`, and whatever is
   * still open when the game ends reaches `centralPileStallRunsOpenAtEnd`.
   */
  private centralPileStallRun = new Map<string, number>();

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
      barnAtEndBySeat: zeros(),
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
      mainActionsBySeat: zeros(),
      boughtDoorActionsBySeat: zeros(),
      meeplesGainedBySeat: zeros(),
      meeplesSpentBySeat: zeros(),
      meeplesGainedByColour: byColour(),
      meeplesSpentByColour: byColour(),
      meeplesUnspentBySeat: zeros(),
      meeplesUnspentByColour: byColour(),
      meeplesSpentByAction: {},
      meepleHeldTurnsBySeat: zeros(),
      meepleGainedRounds: [],
      meepleSpentRounds: [],
      firstMeepleTurnBySeat: Array<number | null>(seats).fill(null),
      clogTurnsBySeat: zeros(),
      clogSampledBySeat: zeros(),
      doorClogTurnsBySeat: zeros(),
      doorClogSampledBySeat: zeros(),
      reshufflesByCrop: Object.fromEntries([...spec.suits, ...spec.neutral].map((s) => [s, 0])),
      // ⭐ THE SAME KEY SET AS `reshufflesByCrop` ON PURPOSE (a24, 12/09/2026):
      // the three of them are read as one fraction per crop, and a key present
      // in one and absent from another would turn a ratio into a NaN that reads
      // like a finding. `poolAtEndByCrop` joins them because a crop's cards are
      // conserved and the three lines only close if they cover the same crops.
      reshuffledCardsByCrop: Object.fromEntries(
        [...spec.suits, ...spec.neutral].map((s) => [s, 0]),
      ),
      deckTopsTakenByCrop: Object.fromEntries([...spec.suits, ...spec.neutral].map((s) => [s, 0])),
      poolAtEndByCrop: Object.fromEntries([...spec.suits, ...spec.neutral].map((s) => [s, 0])),
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
      collectsWithMeeplesBySeat: zeros(),
      collectsEmptyBySeat: zeros(),
      wildVisitsBySeat: zeros(),
      meeplesBoxedBySeat: zeros(),
      meeplesBoxedAllSourcesBySeat: zeros(),
      meeplesBoxedBySource: {
        collect: 0,
        island: 0,
        balloon: 0,
        build: 0,
        activation: 0,
        delivery: 0,
        toll: 0,
      },
      meeplesBoxedByColour: byColour(),
      blockedWantTurnsBySeat: zeros(),
      blockedWantSampledBySeat: zeros(),
      holdOutTurnsBySeat: zeros(),
      holdOutSampledBySeat: zeros(),
      allBoardsFullTurns: 0,
      allBoardsFullSampled: 0,
      meepleTurnsBySeat: zeros(),
      slotsBlockedAtBoundary: 0,
      slotsSampledAtBoundary: 0,
      meepleGift: {
        givenBySeat: zeros(),
        receivedBySeat: zeros(),
        homeBySeat: zeros(),
        toLeaderBySeat: zeros(),
      },
      meepleResourceSpendsBySeat: zeros(),
      meepleResourceSpendsByUse: { build: 0, activation: 0, delivery: 0 },
      meepleResourceAtThresholdSpends: 0,
      meepleResourceWildSpends: 0,
      meepleResourceSpendRounds: [],
      tollMeeplesPaidBySeat: zeros(),
      tollVisitsBySeat: zeros(),
      visitsReceivedBySeat: zeros(),
      meeplesPlacedBySeat: zeros(),
      meeplesPlacedReceivedBySeat: zeros(),
      meeplePoolByRound: [],
      poolEmptyRound: null,
      commonsPlaysBySeat: zeros(),
      commonsCardsIntoCentreBySeat: zeros(),
      commonsWildPairPlaysBySeat: zeros(),
      commonsPlaysByBoard: byColour(),
      commonsPlaysByFeeSuit: byColour(),
      commonsPlaysOffCrop: 0,
      commonsHarvestsBySeat: zeros(),
      commonsPileSizeAtHarvest: [],
      commonsHarvestsBoughtBySeat: zeros(),
      commonsPileSizeByRound: [],
      commonsPileSizeByRoundThird: [],
      noticeBoardCardsByRound: [],
      noticeBoardCardsByRoundThird: [],
      boardHarvestableTurnsBySeat: zeros(),
      boardSampledTurnsBySeat: zeros(),
      boardStallRuns: [],
      boardStallRunsOpenAtEnd: [],
      boardMaxStackBySeat: zeros(),
      boardCardsAtEndBySeat: zeros(),
      boardsAtEnd: 0,
      boardsHoldingAtEnd: 0,
      extraBoardsBySeat: Array.from({ length: seats }, () => [] as Suit[]),
      barnFromCommonsBySeat: zeros(),
      barnFromOwnBySeat: zeros(),
      barnFromOwnBoardBySeat: zeros(),
      centralPileSampledTurns: 0,
      centralPileHarvestableTurns: 0,
      centralPileStallRuns: [],
      centralPileStallRunsOpenAtEnd: [],
      centralPileMaxByBoard: byColour(),
      a16FiresRivalBoard: 0,
      a16FiresOwnBoard: 0,
      a16FiresOrdinary: 0,
      a16PlacementsWhileHeld: 0,
      commonsStrandedAtEnd: 0,
      commonsTakesBySeat: zeros(),
      commonsTakesByBoard: byColour(),
      commonsTakeSizes: [],
      commonsTakenCardsBySeat: zeros(),
      commonsSpendTakesByBoard: byColour(),
      commonsSpendTakenByBoard: byColour(),
      commonsSpendUsedByBoard: byColour(),
      commonsSpendDiscardedByBoard: byColour(),
      commonsSpendDeliveriesFromCentre: 0,
      commonsSpendBarnBySeat: zeros(),
      commonsTakeFeesBySeat: zeros(),
      coinsMintedBySeat: zeros(),
      coinsMintedByBoard: byColour(),
      coinsSpentFarmsteadBySeat: zeros(),
      coinsSpentEndgameBySeat: zeros(),
      coinsHeldAtEndBySeat: zeros(),
      farmsteadFiresBySeat: zeros(),
      endgameBuiltBySeat: zeros(),
      endgameBuiltByCardSuit: byColour(),
      firstCoinRoundBySeat: Array<number | null>(seats).fill(null),
      storeCardsConvertedBySeat: zeros(),
      storeCoinsMintedBySeat: zeros(),
      storeConvertedByCardSuit: byColour(),
      storeExchanges: 0,
      storeExchangeCeiling: 0,
      storeExchangeBarn: 0,
      storeExchangesUsed: 0,
      storeExchangesEmptied: 0,
      storeDeliveriesNoExchange: 0,
      storeDeliveriesNoExchangeEmptySupply: 0,
      storeDeliveriesNoExchangeEmptyBarn: 0,
      coinSupplySampledTurns: 0,
      coinSupplyEmptyTurns: 0,
      coinSupplySum: 0,
      coinSupplyAtEnd: 0,
      coinsSpentBuildBySeat: zeros(),
      coinBuildsBySeat: zeros(),
      coinGrowsBySeat: zeros(),
      coinGrowsBoughtBySeat: zeros(),
      coinGrowsOfFullBySeat: zeros(),
      growsBySeat: zeros(),
      maxDiscardMoves: 0,
      maxLegalMovesSeen: 0,
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
      hostDrawCardsBySeat: zeros(),
      hostDrawPaymentsBySeat: zeros(),
      w17DrawCardsBySeat: zeros(),
      w17DrawFiresBySeat: zeros(),
      cardsToHandTotal: 0,
      handSampledTurns: 0,
      handSizeSum: 0,
      handAtBoundTurns: 0,
      handSizeMax: 0,
      handSampledTurnsBySeat: zeros(),
      handSizeSumBySeat: zeros(),
      handAtBoundTurnsBySeat: zeros(),
      handEmptyTurnsBySeat: zeros(),
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
    state.players.forEach((p, seat) => {
      for (const id of p.hand) this.facts(id).held = true;
      // Starters arrive pre-built: they are in play in every game, never drawn
      // and never junked. The cut list excludes them for exactly that reason;
      // the funnel still carries a row so the coverage test has one.
      for (const b of p.tableau) this.facts(b.card).played = true;
      // ⭐ THE EXTRA NOTICE BOARDS AS DEALT (Dean's two-board fix, 11/09/2026),
      // captured here because setup is the only place they can be read from:
      // no event announces them and nothing afterwards distinguishes the board
      // a seat's starters brought from the board it drew. A board whose suit is
      // not this seat's own suit is by construction one dealt from the suits
      // nobody is farming, so the test is the whole of the identification.
      // Empty in every game that lays out one board a seat, which is every game
      // this project has shipped.
      for (const b of p.tableau) {
        const card = cardById(this.data, b.card);
        if (card.slot !== 'noticeboard' || card.suit === p.suit) continue;
        this.m.extraBoardsBySeat[seat]?.push(card.suit);
      }
    });
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
    this.store(d);
    this.branching(d);
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
      const taken = Math.max(0, before - after + (shuffled[suit] ?? 0));
      this.m.deckTopsTaken += taken;
      // ⭐ THE SAME DIFF, SPLIT BY CROP (a24, 12/09/2026), so it is this scalar
      // split and never a second sample. a24 needs the draw volume PER DECK
      // because reshuffles are draws over pool, and a pooled total cannot tell
      // a played deck's churn from a neutral one's.
      this.m.deckTopsTakenByCrop[suit] = (this.m.deckTopsTakenByCrop[suit] ?? 0) + taken;
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
   * ⛔⛔ C113 AS A FOLD: THE VILLAGE STORE EXCHANGE, WINDOW BY WINDOW
   * (12/09/2026, ledger A150). This is the counter the whole Store pass turns
   * on, and it is here rather than on an event because the engine emits nothing
   * when an exchange is OFFERED - only when a card is actually converted.
   *
   * ⭐ WHY THE OFFER MATTERS AS MUCH AS THE CONVERSION.
   * `docs/village-store-2026-08-19-v1.md` section 1 ruled this exact placement
   * out in August: *"Free / a rider on Deliver. No cost, so it is always
   * correct. Breaks everything."* Dean's answer of 12/09/2026 is that a valid
   * delivery is a precondition and a capped shared supply bounds the reward.
   * ⛔ THE OBJECTION IS A TEST FOR THIS RUN AND NOT HISTORY: if every player
   * converts every spare card every time, the August verdict was right and the
   * PLACEMENT is what to change. A conversion count alone cannot say that; it
   * needs the offers and the ceilings beside it, which is what this fold takes.
   *
   * ⚠️ THE CONTINUATION TEST, STATED BECAUSE IT IS THE ONE APPROXIMATION HERE.
   * `apply` clones the state, so a task cannot be tracked by identity across
   * decisions. A window is treated as CONTINUING when the post-state's head is
   * still a `mint` for the same seat with `remaining` exactly one lower and the
   * task list has not shortened, which is precisely what one conversion does.
   * ⛔ THE ONE CASE IT MERGES is two mint tasks queued back to back for the same
   * seat whose second happens to open at exactly the first's `remaining - 1`.
   * That needs two deliveries resolved with no drain between them, which
   * `finishDelivery` and `drainTasks` make rare, and it costs one window in the
   * denominator when it happens. It is recorded rather than defended.
   */
  private store(d: Decision): void {
    if (storeCoinsPerCard(this.data) <= 0) return;
    this.storeOffers(d);
    const head = d.pre.tasks[0];
    if (head?.t !== 'mint') {
      this.closeExchange();
      return;
    }
    // The ceiling is the task's own `remaining`, which `pushStoreExchange` set
    // to min(barn after the crate, supply left) - the convertible cards, and
    // the exact quantity C113's second share is a share of.
    const window = (this.exchange ??= {
      pid: head.pid,
      ceiling: head.remaining,
      barn: player(d.pre, head.pid).barn.length,
      converted: 0,
    });
    for (const e of d.events) {
      if (e.e === 'coinsMinted' && e.board === 'store') window.converted += 1;
    }
    const post = d.post.tasks[0];
    const continues =
      d.post.tasks.length === d.pre.tasks.length &&
      post?.t === 'mint' &&
      post.pid === head.pid &&
      post.remaining === head.remaining - 1;
    if (!continues) this.closeExchange();
  }

  /** Bank a finished exchange window. Idempotent, so it can be called on every decision. */
  private closeExchange(): void {
    const w = this.exchange;
    if (w === null) return;
    this.exchange = null;
    const m = this.m;
    m.storeExchanges += 1;
    m.storeExchangeCeiling += w.ceiling;
    m.storeExchangeBarn += w.barn;
    if (w.converted > 0) m.storeExchangesUsed += 1;
    if (w.converted >= w.ceiling) m.storeExchangesEmptied += 1;
  }

  /**
   * ⛔ THE DELIVERIES THAT COULD NOT CONVERT, which is the other half of C113's
   * denominator and the half that says whether the CAP is doing anything.
   *
   * A delivery pushes a `mint` task only when min(barn, supply) is above zero,
   * so a delivery with no task appended is a delivery the Store could not serve.
   * The two reasons mean opposite things: an empty BARN is a seat with nothing
   * stranded, so the Store had no fault to fix; an empty SUPPLY is V4's cap
   * actually biting, which is exactly the pressure Dean's answer to the August
   * objection rests on. ⚠️ A supply that never empties is a supply rationing
   * nothing.
   *
   * ⚠️ COUNTED ONCE PER SEAT PER DECISION. V14 emits a SECOND `delivered` with
   * an empty spend for the same payment, and a per-event count would report one
   * delivery as two.
   */
  private storeOffers(d: Decision): void {
    const seats = new Set<Seat>();
    for (const e of d.events) if (e.e === 'delivered') seats.add(e.seat);
    if (seats.size === 0) return;
    const mints = (s: GameState, pid: Seat) =>
      s.tasks.filter((t) => t.t === 'mint' && t.pid === pid).length;
    for (const pid of seats) {
      if (mints(d.post, pid) > mints(d.pre, pid)) continue;
      const m = this.m;
      m.storeDeliveriesNoExchange += 1;
      // ⚠️ THE SUPPLY IS REPORTED FIRST WHERE BOTH ARE EMPTY, because a barn
      // emptied by a crate is an ordinary delivery and an empty supply is the
      // finding. The two counters therefore partition the total exactly.
      if ((d.post.coinSupply ?? 0) <= 0) m.storeDeliveriesNoExchangeEmptySupply += 1;
      else if (player(d.post, pid).barn.length === 0) m.storeDeliveriesNoExchangeEmptyBarn += 1;
    }
  }

  /**
   * ⛔ THE DECISION SPACE, AND IT IS A READING ABOUT THE INSTRUMENT (a27, C7).
   * Ungated, because it costs one comparison and because the control's numbers
   * are what the coin arms are read against.
   *
   * The end-of-turn discard task enumerates every subset of the overflow, so its
   * width is C(hand, hand - limit). A coin sink PAYS NO CARD, so cards stop
   * leaving the hand and that binomial climbs. ⭐ THIS IS THE SHAPE THAT BROKE
   * THE PROJECT ON 02/09/2026, when deleting the hand limit produced a
   * 116,535-move position and 91-second two-player games, and it is why the
   * limit came back the same day as an INSTRUMENT bound.
   */
  private branching(d: Decision): void {
    const n = d.legal.length;
    if (n > this.m.maxLegalMovesSeen) this.m.maxLegalMovesSeen = n;
    if (d.pre.tasks[0]?.t === 'discard' && n > this.m.maxDiscardMoves) {
      this.m.maxDiscardMoves = n;
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
    // ⛔ HAND SIZE, AND IT IS A READING ABOUT THE INSTRUMENT (C7). Sampled
    // here because this is already the one clean moment per turn - no pending
    // task, nothing spent - and because S17's whole mechanism is cards in hand.
    // The engine's `rules.turn.handLimit` is the SIMULATOR's bound and the table
    // plays with none, so `handAtBoundTurns` is the clipping rather than a
    // finding about hoarding. a21 prints all three with the caveat attached.
    const held = player(s, seat).hand.length;
    this.m.handSampledTurns += 1;
    this.m.handSizeSum += held;
    const bound = this.data.rules.turn.handLimit;
    if (bound !== null && held >= bound) this.m.handAtBoundTurns += 1;
    if (held > this.m.handSizeMax) this.m.handSizeMax = held;
    // ⭐ THE SAME THREE, BY SEAT (C114, 12/09/2026), so a22 can split them by the
    // crop the seat was farming. Folded here and nowhere else, so the by-seat
    // sums are the scalars above split rather than a second sample - and the
    // fourth line, the empty hand, is the liquidity FLOOR the crop diagnosis
    // needs. All four are readings about the INSTRUMENT (C7), which is why every
    // line a22 prints from them says so on the line itself.
    this.m.handSampledTurnsBySeat[seat] = (this.m.handSampledTurnsBySeat[seat] ?? 0) + 1;
    this.m.handSizeSumBySeat[seat] = (this.m.handSizeSumBySeat[seat] ?? 0) + held;
    if (bound !== null && held >= bound) {
      this.m.handAtBoundTurnsBySeat[seat] = (this.m.handAtBoundTurnsBySeat[seat] ?? 0) + 1;
    }
    if (held === 0) {
      this.m.handEmptyTurnsBySeat[seat] = (this.m.handEmptyTurnsBySeat[seat] ?? 0) + 1;
    }
    // ⛔ HOW OFTEN THE SUPPLY IS EMPTY (C113, 12/09/2026), sampled at the same
    // clean moment for the same reason. `GameState.coinSupply` is ABSENT rather
    // than zero wherever there is no Village Store - a serialisation question
    // and not a rules one - so the sample is gated on its presence and a run
    // without a Store contributes no turns at all rather than a run of zeroes
    // that would read as a supply permanently exhausted.
    if (s.coinSupply !== undefined) {
      this.m.coinSupplySampledTurns += 1;
      this.m.coinSupplySum += s.coinSupply;
      if (s.coinSupply <= 0) this.m.coinSupplyEmptyTurns += 1;
    }
    // ⭐ THE DELIVERY MEEPLE'S OWN DENOMINATOR (a23, 12/09/2026), folded HERE and
    // ungated. `meepleTurnStart` below is gated behind `isMeepleCurrency` and is
    // therefore a structural zero under the delivery meeple, whose currency is
    // `'noticeBoardPower'`. This costs nothing where there are no meeples:
    // `meeplesHeld` returns an empty list and the counter never moves, so no
    // control's numbers change.
    if (meeplesHeld(this.data, s, seat).length > 0) {
      this.m.meepleHeldTurnsBySeat[seat] = (this.m.meepleHeldTurnsBySeat[seat] ?? 0) + 1;
    }
    this.meepleTurnStart(s, seat);
  }

  /**
   * THE ARM'S TURN-START PROBES (04/09/2026): the hold-out rate, the gridlock
   * rate, and the meeple-turn denominator.
   *
   * All three are asked HERE rather than at a turn boundary because all three
   * are about the seat whose turn it is and about what it walked into. "Still
   * full at its owner's turn start" is the handoff's own wording, and a
   * boundary sample would answer a different question - the state a board was
   * left in by somebody else's turn, which nobody has to live with yet.
   *
   * Under the shipped `'card'` game this is one predicate and a return: there
   * are no slots, `noticeBoardSlots` would throw, and the control's counters
   * must not move.
   */
  private meepleTurnStart(s: GameState, seat: Seat): void {
    if (!isMeepleCurrency(this.data)) return;
    const m = this.m;
    m.holdOutSampledBySeat[seat] = (m.holdOutSampledBySeat[seat] ?? 0) + 1;
    if (this.boardFull(s, seat)) m.holdOutTurnsBySeat[seat] = (m.holdOutTurnsBySeat[seat] ?? 0) + 1;
    m.allBoardsFullSampled += 1;
    let everyBoard = true;
    for (let other = 0; other < m.seats; other++) {
      if (!this.boardFull(s, other)) {
        everyBoard = false;
        break;
      }
    }
    if (everyBoard) m.allBoardsFullTurns += 1;
    if (meeplesHeld(this.data, s, seat).length > 0) {
      m.meepleTurnsBySeat[seat] = (m.meepleTurnsBySeat[seat] ?? 0) + 1;
    }
  }

  /** All five colour slots blocked. The arm's "this farm is shut", and only ever asked under it. */
  private boardFull(state: GameState, seat: Seat): boolean {
    return this.data.cards.suits.every((colour) => slotBlocked(state, seat, colour));
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
    // ⛔ THE DENIAL QUESTION HAS NO SUBJECT UNDER THE COMMONS (C4, 09/09/2026).
    // Nothing in the game refuses a play: the central boards have no threshold,
    // hold any number of cards and never clog, so "no visit is legal anywhere"
    // can only ever mean "no board's ACTION was legal for me", which is a
    // different question from the one a05 was written to ask and would be
    // reported under its name. NOT SAMPLED rather than sampled at zero, for the
    // reason the turn-boundary guard states: an empty denominator reads as "not
    // measured", a zero numerator over a real one reads as a finding.
    if (isCommons(this.data)) return;
    // ⭐ THE CURRENCY DECIDES WHAT "HOLDING SOMETHING TO VISIT WITH" MEANS. Under
    // the shipped game a visit costs a card, so an empty hand is a card problem
    // and not a clog; under the meeple-loop arm a visit costs a MEEPLE and the
    // hand is irrelevant to it, so an empty SUPPLY is the equivalent exclusion.
    // Carrying the hand test across the arm would have sampled a population
    // defined by the wrong resource - the exact shape of mistake the denial
    // probe made on 03/09/2026 by copying a predicate instead of asking the
    // rules.
    const arm = isMeepleCurrency(this.data);
    if (arm ? meeplesHeld(this.data, s, seat).length === 0 : player(s, seat).hand.length === 0) {
      return;
    }
    this.m.clogSampledBySeat[seat] = (this.m.clogSampledBySeat[seat] ?? 0) + 1;
    // `anyVisitOption` IS `visitOptions(...).length > 0`, off the same walk -
    // see the engine. The probe never wanted the moves, and building them was
    // ~1.8% of a whole game under the shipped rules and more under the arm,
    // where the list is (rival hosts x 5 colours x 10 wild pairs) long.
    if (!anyVisitOption(this.data, s, seat)) {
      this.m.clogTurnsBySeat[seat] = (this.m.clogTurnsBySeat[seat] ?? 0) + 1;
    }
    if (arm) this.blockedWant(s, seat);
  }

  /**
   * ⭐ THE BLOCKED-WANT PROBE (the arm, 04/09/2026), sampled in the same window
   * as the denial probe above and answering the question that replaced it.
   *
   * For every colour this seat HOLDS: is that colour's door legal for this seat
   * right now, and is there a free slot of that colour on ANY rival's board?
   * A colour that is usable and has nowhere to go is a blocked want, and one is
   * enough to count the turn.
   *
   * The two gates are deliberately separate and only one of them is a design
   * fault. A colour whose door can do nothing for you (`workerActionLegal`
   * false - the Wheat door with nothing full, the Vegetable door with an empty
   * barn) is not blocked, it is simply not wanted this turn, and counting it
   * would blame the slots for a card-supply problem. Dean's standing ruling that
   * a door which can do nothing is not offered is what makes the distinction
   * measurable at all.
   *
   * Rival boards only, because X5 rules out the self-visit under any flag, so a
   * free slot on your own board is not a place a meeple can be spent.
   */
  private blockedWant(s: GameState, seat: Seat): void {
    const m = this.m;
    m.blockedWantSampledBySeat[seat] = (m.blockedWantSampledBySeat[seat] ?? 0) + 1;
    for (const colour of meeplesHeld(this.data, s, seat)) {
      // THE CHEAP GATE FIRST. Both tests have to pass for a colour to count, and
      // they commute, but `slotBlocked` is a property read where
      // `workerActionLegal` can reach `anyBuildOption` and `anyDeliverOption`.
      // A colour with a free slot somewhere is not blocked whatever its door
      // says, so asking the door about it is work with no reader.
      let free = false;
      for (let host = 0; host < m.seats && !free; host++) {
        if (host === seat) continue;
        if (!slotBlocked(s, host, colour)) free = true;
      }
      if (free) continue;
      if (!workerActionLegal(this.data, s, seat, doorOf(this.data, colour).id)) continue;
      m.blockedWantTurnsBySeat[seat] = (m.blockedWantTurnsBySeat[seat] ?? 0) + 1;
      return;
    }
  }

  private move(d: Decision): void {
    const { move, pre } = d;
    switch (move.type) {
      case 'grow': {
        this.facts(move.building).activations += 1;
        // ⭐ SINK TWO'S FIRING COUNT (K10, 10/09/2026): the Farmstead's coin-paid
        // GROW, which is a whole MAIN action and places nothing. `coin: true` is
        // the only thing that separates it from an ordinary activation, and it is
        // carried on the move rather than on an event, so this is the only place
        // it can be counted. `coinsSpentFarmsteadBySeat` counts the same firings
        // in coins (always one apiece) off `coinsSpent`; the two are kept apart so
        // that a disagreement between them is legible as a fold bug.
        if (move.coin === true) {
          this.m.farmsteadFiresBySeat[move.seat] =
            (this.m.farmsteadFiresBySeat[move.seat] ?? 0) + 1;
        }
        // ⭐ THE VILLAGE STORE'S SECOND SINK (V8/V9, 12/09/2026), and it is a
        // DIFFERENT FLAG from `coin` above: `coin` is the other coin arm's
        // Farmstead power (K10) and `coinGrow` is a Store coin standing in for an
        // activation card. Merging them would put every coin-Grow into a counter
        // that means something else, which is what the engine's own comment on
        // the move field warns about.
        this.grow(d.pre, move.seat, move.building, move.coinGrow === true, false);
        return;
      }
      case 'build':
        for (const id of move.payment) this.facts(id).junked = true;
        return;
      case 'visit':
        // ONE fee, not a list, since v31: no route places two cards on a board.
        // ⭐ AND NULL UNDER THE MEEPLE-LOOP ARM (R1), where no card leaves the
        // hand at all. That has a consequence the card funnel must not report as
        // a change in the cards: about 29 fee cards a game stop being junked and
        // stop reaching a rival's barn, so every card's junk rate and the whole
        // barn-in-by-route table move under the arm for a reason that is not
        // about any card. Read them as a delta and never as a card verdict.
        if (move.fee !== null) this.facts(move.fee).junked = true;
        return;
      // ⭐ THE COMMONS PLAY (C3), counted here for its CARD and off
      // `commonsPlayed` for everything else. The fee is junked exactly as a v31
      // visit fee is - it leaves the hand and buys an action - and the funnel
      // must see it, or every card's junk rate moves for a reason that is not
      // about any card. The action it bought is a `doorUsed` event and is
      // counted there, so nothing is added to `actionsBySeat` here.
      //
      // ⚠️ THE FEE IS NOT LOST THE WAY A v31 FEE COULD BE. It sits in a public
      // pile until somebody harvests it (C5), so `junked` here means "spent",
      // never "destroyed" - a18's barn-source line is where it reappears.
      //
      // ⛔ AND SINCE 10/09/2026 THE **PLAY** COUNT IS TAKEN HERE RATHER THAN OFF
      // THE EVENT (K3, the wild pair). One `commons` move is one play whatever
      // it paid; `commonsPlayed` fires once per CARD, so a pair fires twice. The
      // board mix rides with the play count for the same reason - a pair buys one
      // board action, not two. See the field comments on `commonsPlaysBySeat` and
      // `commonsCardsIntoCentreBySeat` for the three quantities and which one
      // carries a17's verdict.
      case 'commons':
        this.m.commonsPlaysBySeat[move.seat] = (this.m.commonsPlaysBySeat[move.seat] ?? 0) + 1;
        this.m.commonsPlaysByBoard[move.board] = (this.m.commonsPlaysByBoard[move.board] ?? 0) + 1;
        this.facts(move.fee).junked = true;
        // The wild pair's SECOND card (K3). Junked exactly as the first is - it
        // leaves the same hand for the same action - and counted as its own line
        // so `cards into the centre = plays + wild-pair plays` can be checked
        // rather than trusted.
        if (move.fee2 !== undefined) {
          this.m.commonsWildPairPlaysBySeat[move.seat] =
            (this.m.commonsWildPairPlaysBySeat[move.seat] ?? 0) + 1;
          this.facts(move.fee2).junked = true;
        }
        return;
      case 'collect':
        // ⭐ COLLECT RESOLVES AN ACTION, counted here for the same reason
        // `bonusDraw` is counted here in the shipped game: the draw it pushes is
        // indistinguishable from a main action's, and there is no event saying
        // the bonus slot was taken. The SPLIT - meeples home against an empty
        // board - is folded off `boardCollected`, which is the only thing that
        // knows. Keeping the action count on the move and the split on the event
        // is what stops a collect being counted as an action twice.
        this.m.actionsBySeat[move.seat] = (this.m.actionsBySeat[move.seat] ?? 0) + 1;
        return;
      case 'bonusDraw':
        // The bonus slot's solitaire half. One of the four columns, and the
        // ONLY one that is counted off a move rather than off an event - there
        // is no `bonusDrawTaken` event, and the draw it pushes is
        // indistinguishable from the main action's.
        this.m.bonusDrawBySeat[move.seat] = (this.m.bonusDrawBySeat[move.seat] ?? 0) + 1;
        this.m.actionsBySeat[move.seat] = (this.m.actionsBySeat[move.seat] ?? 0) + 1;
        return;
      // ⭐ DEAN'S VARIANTS' OTHER BONUS OPTION (09/09/2026, commonsTake:
      // 'bonus' OR 'spend'), counted here for the CARD count off `commonsTaken`
      // and here for the ACTION count - on the same footing as `bonusDraw`
      // above, on Dean's own framing: "we change the bonus action into a draw
      // instead of a harvest". No `doorUsed` ever fires for a take (no door is
      // bought), so `boughtDoorActionsBySeat` is untouched and only the plain
      // action count moves. ⚠️ UNDER 'spend' THE ACTION COUNTS ONCE HERE, AT
      // THE MOVE THAT CHOSE THE BOARD, never again when a dairy/vegetable/
      // apiary take's own task-answer resolves - `taskAnswer` below adds
      // nothing to `actionsBySeat` for a build/deliver/sow answer, on exactly
      // the same "counted once, at the move" reasoning `commons` above states
      // for a door bought through a central play.
      case 'commonsTake':
        this.m.actionsBySeat[move.seat] = (this.m.actionsBySeat[move.seat] ?? 0) + 1;
        // ⭐ "TAKES BY BOARD" (09/09/2026, `commonsTake: 'spend'`): every board
        // a `commonsTake` move ever chooses under 'spend', not only orchard and
        // wheat - `commonsTakesByBoard` above is fed off `commonsTaken`, which
        // dairy/vegetable/apiary never emit, so this is the one counter that
        // sees all five.
        if (isCommonsTakeToSpend(this.data)) {
          this.m.commonsSpendTakesByBoard[move.board] =
            (this.m.commonsSpendTakesByBoard[move.board] ?? 0) + 1;
        }
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
      this.m.mainActionsBySeat[seat] = (this.m.mainActionsBySeat[seat] ?? 0) + 1;
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
      // ⚠️ W17 THE PIE SHOP, SEPARATED FROM S17's RULE HERE AND NOWHERE ELSE
      // (11/09/2026). The card and the rule print the same words and both fire,
      // so a W17 owner visited once draws two - but only the RULE's cards carry
      // `via: 'hostDraw'` on the event, and W17's arrive on an ordinary
      // unlabelled `cardsToHand`. The draw TASK carries `src: 'W17'`, which is
      // the one thing that tells them apart, so the count is taken at the keep
      // answer. It is exact rather than inferred, and it counts CARDS DRAWN: a
      // firing the decks could not feed reveals nothing, is never offered a keep
      // and is not counted, which is the same contract the host draw's count
      // keeps.
      if (task.src === 'W17' && a.cards.length > 0) {
        this.m.w17DrawCardsBySeat[task.pid] =
          (this.m.w17DrawCardsBySeat[task.pid] ?? 0) + a.cards.length;
        this.m.w17DrawFiresBySeat[task.pid] = (this.m.w17DrawFiresBySeat[task.pid] ?? 0) + 1;
      }
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

    // ⭐ A BOUGHT GROW (the Apiary board's), off the ANSWER for the same reason:
    // a bought Grow is a task and never a `grow` move, so the move branch cannot
    // see it. V8 reaches it too - the design says so in as many words, because
    // the Apiary board's bought Grow is a Grow - and it is the half that makes
    // the design's stated ceiling of TWO coin-Grows a turn possible.
    if (task.t === 'grow' && a.kind === 'grow') {
      this.grow(d.pre, task.pid, a.building, a.coinGrow === true, true);
    }
  }

  /**
   * ONE GROW, from either route, split by what paid for it (V8) and by whether
   * the target was already FULL (V9).
   *
   * ⛔ V9 IS THE STRONGEST SINGLE CLAUSE IN THE PACKAGE and this is the line
   * that makes it readable on its own: a coin-Grow places nothing, so a full
   * building is a legal target and the game gets its first clog bypass since the
   * meeples. ⚠️ FULLNESS IS READ OFF THE PRE STATE, which is the only moment it
   * is still true - the ability is about to fire and may harvest the thing.
   * ⚠️ AND IT ASKS `isFull` AND NOT `isHarvestable`: the two stopped being the
   * same boolean on 10/09/2026 (S8), and the clause is about a building that is
   * SHUT to further cards, which is `isFull`.
   */
  private grow(pre: GameState, seat: Seat, target: CardId, coin: boolean, bought: boolean): void {
    const m = this.m;
    m.growsBySeat[seat] = (m.growsBySeat[seat] ?? 0) + 1;
    if (!coin) return;
    m.coinGrowsBySeat[seat] = (m.coinGrowsBySeat[seat] ?? 0) + 1;
    if (bought) m.coinGrowsBoughtBySeat[seat] = (m.coinGrowsBoughtBySeat[seat] ?? 0) + 1;
    const building = pre.players[seat]?.tableau.find((b) => b.card === target);
    if (building && isFull(this.data, building)) {
      m.coinGrowsOfFullBySeat[seat] = (m.coinGrowsOfFullBySeat[seat] ?? 0) + 1;
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
      case 'cardsToHand': {
        for (const id of e.cards) this.facts(id).held = true;
        // ⭐ THE DENOMINATOR FOR S17'S SHARE OF THE DRAWING, and it is every
        // card that reached a hand on this event and nothing else: a gift and a
        // take of a central pile have their own events and are not draws.
        m.cardsToHandTotal += e.cards.length;
        // ⭐ S17, THE HOST DRAW (11/09/2026). `via` is the engine's own label
        // and the ONLY thing that separates these cards from an ordinary draw;
        // it is absent on every other producer, so this branch is a structural
        // zero wherever `rules.turn.hostDrawOnVisit` is 0. ⛔ IT COUNTS CARDS
        // DRAWN AND NEVER VISITS PROMISED: a dry table pushes no task, so the
        // gap against `visitsReceivedBySeat` is the rule failing to pay.
        if (e.via === 'hostDraw') {
          m.hostDrawCardsBySeat[e.seat] = (m.hostDrawCardsBySeat[e.seat] ?? 0) + e.cards.length;
          m.hostDrawPaymentsBySeat[e.seat] = (m.hostDrawPaymentsBySeat[e.seat] ?? 0) + 1;
        }
        return;
      }
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
        // ⭐ THE ENDGAME CARDS (K15, 10/09/2026), counted under EVERY mode and
        // not only under the coin arm, because the pairing the handoff asks for
        // is a comparison of two PRICES for the same fifteen cards - 3 coins
        // against two cards of their own suit - and a counter that only existed
        // on one side of it could not make the comparison. Read by the CARD's own
        // suit as well as by seat: which suit's Endgame cards get bought is the
        // half of the reading that bears on the monoculture pull.
        if (cardById(this.data, e.card).type === 'endgame') {
          m.endgameBuiltBySeat[e.seat] = (m.endgameBuiltBySeat[e.seat] ?? 0) + 1;
          const suit = cardById(this.data, e.card).suit;
          m.endgameBuiltByCardSuit[suit] = (m.endgameBuiltByCardSuit[suit] ?? 0) + 1;
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
        // a16's "bought door" half (handoff v2 preamble): every door action,
        // whichever route paid for it, so this line matches `doorUsesByColour`
        // summed rather than either `via` branch alone.
        m.boughtDoorActionsBySeat[e.seat] = (m.boughtDoorActionsBySeat[e.seat] ?? 0) + 1;
        // Dean's question of 09/09/2026, the main-versus-bought split: the
        // wheat board's Harvest resolves through a task in a LATER decision, so
        // the route is latched here and spent on the next harvest by this seat.
        if (e.action === 'harvest' && e.via === 'commons') this.boughtHarvestPending.add(e.seat);
        return;
      }
      case 'meepleGained':
        m.meeplesGainedBySeat[e.seat] = (m.meeplesGainedBySeat[e.seat] ?? 0) + 1;
        m.meeplesGainedByColour[e.colour] = (m.meeplesGainedByColour[e.colour] ?? 0) + 1;
        // ⭐ THE ROUND OF THE MINT (a23, 12/09/2026). Under the delivery meeple
        // the only source is a SECOND delivery and the game ends on a SIXTH
        // delivery by anybody, so when a meeple arrives decides whether it could
        // ever have been spent. Without this the stranded count cannot tell the
        // end trigger from the component.
        m.meepleGainedRounds.push(this.round());
        return;
      case 'meepleSpent':
        m.meeplesSpentBySeat[e.seat] = (m.meeplesSpentBySeat[e.seat] ?? 0) + 1;
        m.meeplesSpentByColour[e.colour] = (m.meeplesSpentByColour[e.colour] ?? 0) + 1;
        // ⛔ THE ACTION OFF THE EVENT AND NEVER OFF THE COLOUR (M6, M7, a23).
        // `meepleSpent.action` was widened to `DoorAction` at commit 1b60def and
        // carries what was ACTUALLY bought: an apiary meeple buys GROW where the
        // roster's apiary door buys SOW, and an orchard meeple buys the PLAIN
        // Draw 2 where the Notice Board power is Draw 4. Re-deriving either from
        // the colour would report an action that never happened.
        m.meeplesSpentByAction[e.action] = (m.meeplesSpentByAction[e.action] ?? 0) + 1;
        m.meepleSpentRounds.push(this.round());
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
      // ⭐ THE COMMONS' WHOLE MEASUREMENT SURFACE (C3, 09/09/2026): one event
      // per card played onto a central board. Three tables come off it and they
      // answer three different questions - WHICH BOARD (the action bought, a17's
      // by-board breakdown), WHICH SUIT THE FEE WAS (L5: is the table paying
      // junk?), and HOW DEEP THE PILE GOT (a18, read against the harvests).
      //
      // The off-crop test uses the PAYER's suit off the post-state, which is
      // fixed for the whole game, so pre or post makes no difference and post is
      // what every other branch here uses.
      //
      // ⛔ IT IS ONE EVENT PER **CARD** AND SINCE 10/09/2026 THAT IS NOT ONE
      // EVENT PER PLAY. `rules.economy.commonsWildPair` (K3) lets two cards pay
      // for one board and `doCommons` calls `fx.playOnCommons` once for each, so
      // the PLAY count and the BOARD mix moved to the `commons` MOVE and only the
      // card-shaped readings are left here: the cards into the centre (a18's
      // conservation identity) and the fee-suit mix (L5, which wants both halves
      // of a pair counted).
      case 'commonsPlayed': {
        m.commonsCardsIntoCentreBySeat[e.seat] = (m.commonsCardsIntoCentreBySeat[e.seat] ?? 0) + 1;
        const feeSuit = cardById(this.data, e.card).suit;
        m.commonsPlaysByFeeSuit[feeSuit] = (m.commonsPlaysByFeeSuit[feeSuit] ?? 0) + 1;
        if (feeSuit !== player(d.post, e.seat).suit) m.commonsPlaysOffCrop += 1;
        return;
      }
      // ⭐ DEAN'S VARIANT'S ONE EVENT (09/09/2026, `commonsTake: 'bonus'`): the
      // whole of one central pile moved to `e.seat`'s hand. `cards.length` is
      // both the take's size (a18's 1/2/3/4/5+ histogram) and the hand-share
      // half of the farm-bypass reading under this variant, since a `harvested`
      // with `source: 'commons'` can never fire while Harvest never reaches
      // the centre.
      case 'commonsTaken': {
        m.commonsTakesBySeat[e.seat] = (m.commonsTakesBySeat[e.seat] ?? 0) + 1;
        m.commonsTakesByBoard[e.board] = (m.commonsTakesByBoard[e.board] ?? 0) + 1;
        m.commonsTakeSizes.push(e.cards.length);
        m.commonsTakenCardsBySeat[e.seat] =
          (m.commonsTakenCardsBySeat[e.seat] ?? 0) + e.cards.length;
        // ⭐ DEAN'S 'paid' VARIANT (09/09/2026): `fee` is present only under
        // that value - the first per-use sink in the commons line, counted by
        // the SEAT that paid it.
        if (e.fee !== undefined) {
          m.commonsTakeFeesBySeat[e.seat] = (m.commonsTakeFeesBySeat[e.seat] ?? 0) + 1;
        }
        return;
      }
      // ⭐ DEAN'S 'spend' VARIANT'S SUMMARY (09/09/2026, `commonsTake: 'spend'`):
      // fires once per take, for every board, when that board's resolution
      // completes - alongside `commonsTaken` for orchard/wheat, alone for
      // dairy/vegetable/apiary. `taken`/`used`/`discarded` are the pile's own
      // accounting; `deliveredFromCentre` is the vegetable leg's own flag, and
      // a wheat take's `used` is ALSO the farm-bypass reading's new subject -
      // cards that reached a barn with no Harvest at all.
      case 'commonsSpent': {
        m.commonsSpendTakenByBoard[e.board] = (m.commonsSpendTakenByBoard[e.board] ?? 0) + e.taken;
        m.commonsSpendUsedByBoard[e.board] = (m.commonsSpendUsedByBoard[e.board] ?? 0) + e.used;
        m.commonsSpendDiscardedByBoard[e.board] =
          (m.commonsSpendDiscardedByBoard[e.board] ?? 0) + e.discarded;
        if (e.deliveredFromCentre) m.commonsSpendDeliveriesFromCentre += 1;
        if (e.board === 'wheat') {
          m.commonsSpendBarnBySeat[e.seat] = (m.commonsSpendBarnBySeat[e.seat] ?? 0) + e.used;
        }
        return;
      }
      // ⭐ THE ARM'S ONE MINT (K3/K4, 10/09/2026, `commonsTake: 'coins'`). It
      // fires BESIDE `commonsTaken`, never instead of it, so the take itself, its
      // board and its size are all counted in the branch above and this branch
      // carries only what is new: the currency. `coins` equals the cleared pile's
      // size on every event, which is why a18 can read this counter as "cards
      // that left the game" and a19 as "coins minted" without either having to
      // trust the other.
      case 'coinsMinted': {
        m.coinsMintedBySeat[e.seat] = (m.coinsMintedBySeat[e.seat] ?? 0) + e.coins;
        m.coinsMintedByBoard[e.board] = (m.coinsMintedByBoard[e.board] ?? 0) + e.coins;
        m.firstCoinRoundBySeat[e.seat] ??= this.round();
        // ⭐ THE VILLAGE STORE'S MINT (V1, 12/09/2026), told apart from the arm
        // above by `board === 'store'` and nothing else. ONE EVENT PER CARD
        // CONVERTED, where the commons mint fires once for a whole pile, so the
        // two are never the same quantity and a25 counts CARDS here.
        if (e.board === 'store') {
          m.storeCardsConvertedBySeat[e.seat] = (m.storeCardsConvertedBySeat[e.seat] ?? 0) + 1;
          m.storeCoinsMintedBySeat[e.seat] = (m.storeCoinsMintedBySeat[e.seat] ?? 0) + e.coins;
          if (e.card !== undefined) {
            const suit = cardById(this.data, e.card).suit;
            m.storeConvertedByCardSuit[suit] = (m.storeConvertedByCardSuit[suit] ?? 0) + 1;
          }
        }
        return;
      }
      // ⭐ THE ARM'S TWO SINKS (K10-K15), and the split is the whole reading: a
      // coin has exactly two uses and the question a19 asks is which of them the
      // table actually reaches. `on: 'farmstead'` always carries one coin;
      // `on: 'endgame'` carries `rules.economy.endgameCoinCost` and fires just
      // before a `built` whose payment is empty, so the CARD is counted in the
      // `built` branch and only the price is counted here.
      //
      // ⭐ AND TWO MORE JOINED ON 12/09/2026 WITH THE VILLAGE STORE (V6 to V9).
      // `on: 'build'` fires ONCE for the whole coin component of one payment,
      // because coins are fungible and a payment names a COUNT and never which
      // coins - so the coins and the BUILDS are two different tallies and both
      // are kept. ⚠️ `on: 'grow'` IS DELIBERATELY NOT FOLDED HERE: it is always
      // exactly one coin, so the event carries nothing the Grow does not, and
      // `coinGrowsBySeat` is taken off the MOVE and the ANSWER instead, where
      // the target's fullness (V9) can still be read off the pre state. One
      // quantity, one counter. ⛔ THE FOUR MEMBERS
      // ARE TWO SEPARATE ECONOMIES AND NO OVERLAY TURNS BOTH ON: a19 reads the
      // first pair, a25 the second, and each reports NO SUBJECT where the other
      // is live.
      case 'coinsSpent': {
        if (e.on === 'farmstead') {
          m.coinsSpentFarmsteadBySeat[e.seat] =
            (m.coinsSpentFarmsteadBySeat[e.seat] ?? 0) + e.coins;
        } else if (e.on === 'endgame') {
          m.coinsSpentEndgameBySeat[e.seat] = (m.coinsSpentEndgameBySeat[e.seat] ?? 0) + e.coins;
        } else if (e.on === 'build') {
          m.coinsSpentBuildBySeat[e.seat] = (m.coinsSpentBuildBySeat[e.seat] ?? 0) + e.coins;
          m.coinBuildsBySeat[e.seat] = (m.coinBuildsBySeat[e.seat] ?? 0) + 1;
        }
        return;
      }
      case 'harvested': {
        m.barnInByRoute.harvest = (m.barnInByRoute.harvest ?? 0) + e.cards.length;
        m.barnInBySeat[e.seat] = (m.barnInBySeat[e.seat] ?? 0) + e.cards.length;
        // ⭐ THE FARM-BYPASS SPLIT (C5, and D3: a central pile only ever leaves
        // by harvest). `source` is carried on every harvest under every mode -
        // 'tableau' by construction under both controls - so the own-buildings
        // column is a real reading in all three and only the centre column has
        // no subject under the controls. See the fields' own comment.
        const bought = this.boughtHarvestPending.delete(e.seat);
        if (e.source === 'commons') {
          m.commonsHarvestsBySeat[e.seat] = (m.commonsHarvestsBySeat[e.seat] ?? 0) + 1;
          m.commonsPileSizeAtHarvest.push(e.cards.length);
          m.barnFromCommonsBySeat[e.seat] = (m.barnFromCommonsBySeat[e.seat] ?? 0) + e.cards.length;
          if (bought) {
            m.commonsHarvestsBoughtBySeat[e.seat] =
              (m.commonsHarvestsBoughtBySeat[e.seat] ?? 0) + 1;
          }
        } else {
          m.barnFromOwnBySeat[e.seat] = (m.barnFromOwnBySeat[e.seat] ?? 0) + e.cards.length;
          // ⭐ AND THE THIRD SOURCE, SPLIT OUT OF THE SECOND (11/09/2026). A
          // Notice Board is a BUILDING in a tableau under
          // `visitCurrency: 'noticeBoardPower'`, so the engine correctly carries
          // `source: 'tableau'` when its owner banks it - and a18's question is
          // not the engine's. Cards off your own board are fee material
          // somebody else paid; cards off everything else are your farm. Read
          // off the catalogue's `slot` rather than off `noticeBoardOf`, which
          // THROWS on a seat with no board (every seat under the commons), so
          // this needs no mode guard and reads a structural zero everywhere a
          // board has no harvestable stack.
          if (cardById(this.data, e.building).slot === 'noticeboard') {
            m.barnFromOwnBoardBySeat[e.seat] =
              (m.barnFromOwnBoardBySeat[e.seat] ?? 0) + e.cards.length;
          }
        }
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
        // ⭐ VISITS RECEIVED, by HOST (handoff v2 section 3.7): "does the
        // popular farm change hands". A visit count, not a meeple count - see
        // the field's own comment for why `meepleGift.receivedBySeat` cannot
        // answer this on its own (a wild pair would double it).
        m.visitsReceivedBySeat[e.host] = (m.visitsReceivedBySeat[e.host] ?? 0) + 1;
        const leader = this.leaderOf(d);
        if (leader === e.host) {
          m.visitsToLeaderBySeat[e.seat] = (m.visitsToLeaderBySeat[e.seat] ?? 0) + 1;
        }
        // ⭐ THE TWO ARMS PAY THE HOST IN DIFFERENT THINGS, so the transfer is
        // counted into two different structures and never into one pooled
        // "generosity" number. `RivalFreight` is cards and `MeepleGift` is
        // meeples; whichever arm is off contributes nothing to its own, which is
        // what keeps the control's freight line byte-comparable with every
        // report in `reports/`.
        if (isMeepleCurrency(this.data)) {
          // WHAT LEFT THE SUPPLY, not how many visits were made: a wild pair
          // (R10) is one visit and TWO meeples, and the host collects both.
          const paid = e.meeples ?? [];
          if (e.wild === true) m.wildVisitsBySeat[e.seat] = (m.wildVisitsBySeat[e.seat] ?? 0) + 1;
          m.meepleGift.givenBySeat[e.seat] = (m.meepleGift.givenBySeat[e.seat] ?? 0) + paid.length;
          m.meepleGift.receivedBySeat[e.host] =
            (m.meepleGift.receivedBySeat[e.host] ?? 0) + paid.length;
          if (leader === e.host) {
            m.meepleGift.toLeaderBySeat[e.host] =
              (m.meepleGift.toLeaderBySeat[e.host] ?? 0) + paid.length;
          }
          // ⭐ THE SPEND COUNTERS ARE FED FROM HERE UNDER THE ARM, because there
          // is no `meepleSpent` event any more: R8 deletes the turn-start spend
          // that emitted it, and a meeple is now spent by MOVING to a rival's
          // board. The colour split is what assertion 15's dead-colour line
          // reads, so it has to survive the change of route.
          for (const colour of paid) {
            m.meeplesSpentBySeat[e.seat] = (m.meeplesSpentBySeat[e.seat] ?? 0) + 1;
            m.meeplesSpentByColour[colour] = (m.meeplesSpentByColour[colour] ?? 0) + 1;
          }
          m.firstMeepleTurnBySeat[e.seat] ??= (m.turnsBySeat[e.seat] ?? 0) + 1;
          return;
        }
        // The fee has already landed by the time this event fires (doVisit
        // places it first), so the card on the host's board is the last one
        // placed by this move - which is exactly what the `cardPlaced` branch
        // recorded a moment ago.
        m.freight.paidBySeat[e.seat] = (m.freight.paidBySeat[e.seat] ?? 0) + 1;
        m.freight.receivedBySeat[e.host] = (m.freight.receivedBySeat[e.host] ?? 0) + 1;
        if (leader === e.host) {
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
        //
        // ⭐ AND `collect` JOINS THE LIST FOR THE MEEPLE-LOOP ARM (04/09/2026).
        // It is the arm's second bonus option and it can land in the same apply
        // as the boundary exactly as the other two can, so leaving it off would
        // under-report bonus turns and over-report SLOT UNSPENT - which is a
        // column of assertion 17 and the one number in it that is derived rather
        // than counted.
        //
        // ⭐ AND `commons` JOINS IT FOR THE COMMONS (09/09/2026), for the
        // identical reason: it is the mode's ONLY bonus option (C9), and a play
        // that lands in the same apply as the turn boundary would otherwise be
        // missed - which would under-report bonus turns and over-report SLOT
        // UNSPENT, and slot unspent is one of a17's two columns under this mode
        // and the only one that is derived rather than counted.
        //
        // ⭐ AND `commonsTake` JOINS IT BESIDE `commons` (Dean's variant,
        // 09/09/2026, `commonsTake: 'bonus'`): the slot's other free option
        // under that knob, on exactly the same reasoning - a take that lands in
        // the same apply as the boundary must count as a bonus turn or a17's
        // three-way tally under-reports the free option's own share.
        const bonusMove =
          d.move.type === 'visit' ||
          d.move.type === 'bonusDraw' ||
          d.move.type === 'collect' ||
          d.move.type === 'commons' ||
          d.move.type === 'commonsTake';
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
        //
        // ⭐ AND THE MEEPLE-LOOP ARM RE-BASES IT A FOURTH TIME, again without
        // touching the arithmetic. Under the arm the Notice Board is NOT A
        // BUILDING (R5): it has no threshold, so `isFull` is false forever and
        // this counter would read a flat 0% for a board that can be completely
        // shut. "Clogged" becomes ALL FIVE COLOUR SLOTS BLOCKED, which is the
        // same sentence about a different object - this farm is shut to the
        // table - and it is a HARDER bar than the old threshold of 2, so the
        // two numbers are not comparable in either direction. The continuous
        // reading underneath it is `slotsBlockedAtBoundary`, and assertion 4
        // prints both because a table at 20% occupancy and one at 80% can show
        // the same near-zero full-board rate.
        //
        // ⛔ AND UNDER THE COMMONS THE QUESTION HAS NO OBJECT AT ALL (C1,
        // 09/09/2026). No player has a Notice Board: the five boards stand
        // ownerless in the centre, they have no threshold (C4) and nothing can
        // refuse a play. `noticeBoardsOf` THROWS on a seat with no board, so this
        // is a guard against a crash as well as against a meaningless number -
        // and NOT SAMPLING is deliberate rather than sampling a zero. A zero
        // denominator reads as "not measured" wherever a05 and a04 print it; a
        // zero numerator over a real denominator would read as "never clogged",
        // which is a finding about a thing that does not exist.
        //
        // ⭐ AND DEAN'S TWO-BOARD FIX (11/09/2026) CHANGES THE PREDICATE AND NOT
        // THE NUMBER, which is worth saying rather than leaving to be
        // rediscovered. "Clogged" here means THE FARM IS SHUT TO THE TABLE, so
        // with two boards in front of a seat it is EVERY board full and not the
        // own-suit one - hence `every` over `noticeBoardsOf`. ⛔ IT IS
        // BYTE-IDENTICAL EVERYWHERE IT HAS EVER RUN: under `'card'` and the
        // commons a seat lays out at most one board, so `every` over one board
        // is that board; and under `'noticeBoardPower'` as shipped
        // `rules.economy.noticeBoardBlocks` is false, so `thresholdShuts`
        // answers false and `isFull` is PERMANENTLY FALSE however deep a stack
        // goes - a04 reads a genuine 0% and a20-board-stall is the assertion
        // that asks the question this one stopped answering. The change bites
        // only under the blocking control with two boards, where the honest
        // answer is that one open board is an open farm.
        const commons = isCommons(this.data);
        const arm = isMeepleCurrency(this.data);
        for (let s2 = 0; s2 < m.seats && !commons; s2++) {
          m.doorClogSampledBySeat[s2] = (m.doorClogSampledBySeat[s2] ?? 0) + 1;
          const shut = arm
            ? this.boardFull(d.post, s2)
            : noticeBoardsOf(this.data, d.post, s2).every((b) => isFull(this.data, b));
          if (shut) m.doorClogTurnsBySeat[s2] = (m.doorClogTurnsBySeat[s2] ?? 0) + 1;
          if (!arm) continue;
          for (const colour of this.data.cards.suits) {
            m.slotsSampledAtBoundary += 1;
            if (slotBlocked(d.post, s2, colour)) m.slotsBlockedAtBoundary += 1;
          }
        }
        // ⭐ THE STALL PROBE (a20, S8, 10/09/2026), and it samples ONE seat
        // where the loop above samples all of them. The question is the
        // OWNER's - "did you leave your own board loaded" - so it is asked at
        // the owner's own turn boundary and the run length below is counted in
        // the owner's own turns. See `boardHarvestableTurnsBySeat`.
        //
        // ⛔ `isHarvestable` AND NOT `isFull`, WHICH IS THE ENTIRE REASON THIS
        // PROBE EXISTS. Under S8's `3+` rule the two stopped being the same
        // boolean: a board at five cards is harvestable and is not full, so
        // the door-clog loop above reads a genuine and permanent 0% and would
        // report a design that never stalls whatever the table did.
        //
        // ⛔⛔ AND IT RUNS PER BOARD SINCE DEAN'S TWO-BOARD FIX (11/09/2026),
        // WHICH IS OPEN RISK 2 OF THE ARM ARRIVING IN THE INSTRUMENT. It
        // sampled `noticeBoardOf` - the seat's OWN SUIT'S board - and at two
        // seats under `rules.economy.noticeBoardsBySeats` that MISSES THE EXTRA
        // BOARD ENTIRELY. The run state is therefore keyed on the BOARD CARD
        // and not on the seat: two boards in one tableau fill and empty
        // independently, so one run counter per seat would splice two boards'
        // histories into one and report a stall that never happened.
        //
        // ⚠️ THE DENOMINATOR IS BOARD-TURNS AND NOT OWNER TURNS, and a20 says
        // so on its own line. A seat's incoming fee traffic SPLITS across its
        // boards, so at two seats each board fills at HALF the rate and sits
        // under its minimum for twice as long: a lower stall share there is
        // arithmetic before it is ever a finding.
        if (isNoticeBoardPower(this.data)) {
          for (const board of noticeBoardsOf(this.data, d.post, seat)) {
            const depth = board.stack.length;
            m.boardSampledTurnsBySeat[seat] = (m.boardSampledTurnsBySeat[seat] ?? 0) + 1;
            if (depth > (m.boardMaxStackBySeat[seat] ?? 0)) m.boardMaxStackBySeat[seat] = depth;
            if (isHarvestable(this.data, board)) {
              m.boardHarvestableTurnsBySeat[seat] = (m.boardHarvestableTurnsBySeat[seat] ?? 0) + 1;
              this.boardStallRun.set(board.card, (this.boardStallRun.get(board.card) ?? 0) + 1);
            } else {
              const run = this.boardStallRun.get(board.card) ?? 0;
              if (run > 0) m.boardStallRuns.push(run);
              this.boardStallRun.set(board.card, 0);
            }
          }
        }
        // ⭐ THE CENTRE'S HALF OF THE STALL (a20, 11/09/2026), and it samples
        // EVERY PILE where the probe above samples one seat. A central pile has
        // no owner, so there is nobody whose own turn boundary is the right
        // place to ask: the question is "did this pile sit there, takeable by
        // anybody, and did nobody take it", and that is a TABLE question asked
        // once a turn of the whole middle.
        //
        // ⛔ IT IS A DIFFERENT PHENOMENON FROM THE OWNED STALL AND NOT A SECOND
        // MEASUREMENT OF THE SAME ONE. An owned board sitting harvestable is one
        // named person declining their own payment; a central pile sitting
        // harvestable is a CONTESTED PILE NOBODY HAS CLAIMED YET, and a long run
        // there can be a pile the table is watching grow rather than a pile the
        // table has forgotten. a20 reports them on separate lines for that
        // reason and pools neither into the other.
        if (hasCentre(this.data)) {
          const piles = commonsBoards(d.post);
          const min = commonsHarvestMin(this.data);
          for (const colour of this.data.cards.suits) {
            const pile = piles[colour];
            if (pile === undefined) continue;
            m.centralPileSampledTurns += 1;
            if (pile.length > (m.centralPileMaxByBoard[colour] ?? 0)) {
              m.centralPileMaxByBoard[colour] = pile.length;
            }
            if (pile.length >= min) {
              m.centralPileHarvestableTurns += 1;
              this.centralPileStallRun.set(colour, (this.centralPileStallRun.get(colour) ?? 0) + 1);
            } else {
              const run = this.centralPileStallRun.get(colour) ?? 0;
              if (run > 0) m.centralPileStallRuns.push(run);
              this.centralPileStallRun.set(colour, 0);
            }
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
        // ⭐ THE POOL AT THE MOMENT IT IS EXACTLY KNOWABLE (a24, 12/09/2026).
        // The engine emits `count` as the deck's length the instant after the
        // discard went in, so it is every card of that crop not in a hand, on a
        // table or locked in a barn. It is the denominator of the line above.
        m.reshuffledCardsByCrop[e.suit] = (m.reshuffledCardsByCrop[e.suit] ?? 0) + e.count;
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
        this.countA16(d, e);
        if (e.seat === e.onto.seat) return;
        // ⛔ NO SEAT HAS A NOTICE BOARD UNDER THE COMMONS (C1), and
        // `noticeBoardsOf` throws rather than answering null - so this is a crash
        // guard first and a meaning guard second. A cross-table SOW still fires
        // this event under the commons, and the card it places lands on a rival
        // BUILDING, which was never freight. The commons' own transfer is a
        // `commonsPlayed` into a public pile and is counted there; a18 owns it.
        //
        // ⛔⛔ AND IT ASKS `noticeBoardsOf` AND NOT `noticeBoardOf` SINCE
        // 11/09/2026, WHICH IS THE MOST SERIOUS OF THE FIVE SITES DEAN'S
        // TWO-BOARD FIX TOUCHED. `noticeBoardOf` answers the seat's OWN SUIT'S
        // board, so a fee landing on a host's EXTRA board - the one drawn from
        // the unfarmed suits, whose power only rivals can buy - failed this
        // test and was never recorded as freight. Everything downstream of it
        // undercounts: `freight.bankedBySeat`, a02's gift tracking and a18's
        // farm bypass, all at TWO SEATS, which is the one column this variant
        // exists to move.
        if (isCommons(this.data)) return;
        const boards = noticeBoardsOf(this.data, d.post, e.onto.seat);
        if (!boards.some((b) => b.card === e.onto.building)) return;
        this.freightOnBoard[e.onto.seat]?.add(e.card);
        return;
      }
      // ⭐ THE SUPPLY CAP'S LEAK (R4). Emitted INSTEAD of `meepleGained`, never
      // beside it, so gained + boxed is every meeple ever offered to a supply
      // and neither line has to be corrected by the other.
      case 'meepleBoxed': {
        // ⚠️ THE TRAP, AND THE FIX (handoff v2, 04/09/2026): `source` used to
        // mean only "the cap refused this", so folding every source into one
        // seat total was safe. It no longer does - `'build'`, `'activation'`,
        // `'delivery'` and `'toll'` are a meeple leaving the game on its own
        // account, nothing to do with the cap - so `meeplesBoxedBySeat` is now
        // filtered to the three CAP sources only (kept v1-comparable) and
        // `meeplesBoxedAllSourcesBySeat` takes every source. See both fields'
        // own comments; under the shipped defaults no event ever carries a
        // non-cap source, so this filter changes nothing for the control.
        const capSource = e.source === 'collect' || e.source === 'island' || e.source === 'balloon';
        if (capSource) m.meeplesBoxedBySeat[e.seat] = (m.meeplesBoxedBySeat[e.seat] ?? 0) + 1;
        m.meeplesBoxedAllSourcesBySeat[e.seat] = (m.meeplesBoxedAllSourcesBySeat[e.seat] ?? 0) + 1;
        m.meeplesBoxedBySource[e.source] = (m.meeplesBoxedBySource[e.source] ?? 0) + 1;
        m.meeplesBoxedByColour[e.colour] = (m.meeplesBoxedByColour[e.colour] ?? 0) + 1;
        return;
      }
      // ⭐ R15'S WHOLE MEASUREMENT SURFACE (handoff v2, 04/09/2026): one event
      // per meeple spent as a card of its colour. `use` says which payment it
      // made; `atThreshold` (only ever true on an `'activation'`) is the
      // priced clog bypass and the new dial the handoff names by name; `wild`
      // says the meeple was half of a pair (R10) - two such events are ONE
      // resource, not two, which is why `meepleResourceWildSpends` is reported
      // as a raw count and the pair arithmetic is left to the reader.
      case 'meepleAsCard': {
        m.meepleResourceSpendsBySeat[e.seat] = (m.meepleResourceSpendsBySeat[e.seat] ?? 0) + 1;
        m.meepleResourceSpendsByUse[e.use] = (m.meepleResourceSpendsByUse[e.use] ?? 0) + 1;
        if (e.atThreshold) m.meepleResourceAtThresholdSpends += 1;
        if (e.wild) m.meepleResourceWildSpends += 1;
        m.meepleResourceSpendRounds.push(this.round());
        return;
      }
      // ⭐ R17 (05/09/2026): a meeple spent as a CARD landed on a neighbour's
      // board instead of the box. Counted from both sides, because "who got fed"
      // is the decision R17 creates.
      //
      // ⚠️ IT IS NOT A VISIT. It buys the payer no door and spends no bonus
      // slot, so a08's hook counts none of it, and the payer's own cost is
      // already counted by `meepleAsCard` firing for the same meeple. Pooling
      // the two would double the spend and inflate the hook with payments.
      case 'meepleplaced': {
        m.meeplesPlacedReceivedBySeat[e.host] = (m.meeplesPlacedReceivedBySeat[e.host] ?? 0) + 1;
        m.meeplesPlacedBySeat[e.seat] = (m.meeplesPlacedBySeat[e.seat] ?? 0) + 1;
        break;
      }
      // ⭐ THE AMENDED R6'S WHOLE MEASUREMENT SURFACE (handoff v2): a toll paid
      // to enter an already-occupied slot. `paid` is the toll only, never the
      // acting meeple - see `visited`/`meepleGift` for that half of the spend.
      // Each toll meeple also emits its own `meepleBoxed` with source `'toll'`,
      // which is where the colour split lives; this event is the per-visit
      // summary the way `boardCollected` is for a Collect.
      case 'visitToll': {
        m.tollMeeplesPaidBySeat[e.seat] = (m.tollMeeplesPaidBySeat[e.seat] ?? 0) + e.paid.length;
        m.tollVisitsBySeat[e.seat] = (m.tollVisitsBySeat[e.seat] ?? 0) + 1;
        return;
      }
      // ⭐ THE FOUR-WAY BONUS MIX'S SECOND AND THIRD COLUMNS, and the only place
      // they can be told apart. `kept` plus `boxed` empty is a Collect on an
      // EMPTY board, which is the arm's solitaire line; anything else is the
      // host being paid for having been visited. `homeBySeat` takes `kept`
      // alone, because a meeple the cap refused arrived and was never received -
      // exactly the distinction `RivalFreight.banked` draws for a card that dies
      // on a board nobody clears.
      case 'boardCollected': {
        const took = e.kept.length + e.boxed.length;
        if (took === 0) m.collectsEmptyBySeat[e.seat] = (m.collectsEmptyBySeat[e.seat] ?? 0) + 1;
        else {
          m.collectsWithMeeplesBySeat[e.seat] = (m.collectsWithMeeplesBySeat[e.seat] ?? 0) + 1;
        }
        m.meepleGift.homeBySeat[e.seat] = (m.meepleGift.homeBySeat[e.seat] ?? 0) + e.kept.length;
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
    // ⭐ THE POOL (handoff v2 section 3.5), read directly off state - see the
    // field's own comment for why this is exact rather than a running
    // balance. Only under the meeple arm: under `'card'` there is no pool,
    // and `noticeBoardSlots` would throw on a seat with no board.
    if (isMeepleCurrency(this.data)) {
      const pool = this.meeplePoolOf(state);
      m.meeplePoolByRound.push(pool);
      if (pool === 0 && m.poolEmptyRound === null) m.poolEmptyRound = m.rounds;
    }
    // ⭐ THE CENTRE, sampled the way the barn beside it is sampled: every card
    // standing on all five central piles at this instant, read off state rather
    // than kept as a running balance, for the reason `meeplePoolOf` states of
    // its own. Only under the commons - `commonsBoards` throws where there is no
    // commons zone, which is the seam doing its job.
    // ⭐ `hasCentre` AND NOT `isCommons` SINCE 11/09/2026, and it is the gate
    // Dean's unclaimed-boards variant turned from a synonym into a real
    // question. There is a centre under the commons (all five piles, C1) AND
    // under `visitCurrency: 'noticeBoardPower'` with
    // `rules.economy.unclaimedBoardsToCentre` (the unfarmed suits' piles only),
    // and a series that went silent on the second would have reported a centre
    // that never filled on the one arm built to ask whether it does.
    if (hasCentre(this.data)) {
      const boards = commonsBoards(state);
      let cards = 0;
      for (const colour of this.data.cards.suits) cards += boards[colour]?.length ?? 0;
      m.commonsPileSizeByRound.push(cards);
    }
    // ⭐ AND THE FARM'S ANSWER TO THE SAME SERIES (a18, 10/09/2026): every card
    // resting on every seat's own Notice Board at this instant. Under the
    // notice-board visit the boards ARE the shared surface - they are just
    // owned - so the reading a18 takes of the centre under the commons is
    // taken of the tableau here, and the two are the same shape and are still
    // not the same quantity: a card on a board has a named owner waiting to
    // harvest it, and a card in a central pile has not.
    // ⛔ EVERY BOARD A SEAT HAS LAID OUT AND NOT ITS OWN SUIT'S ALONE
    // (11/09/2026). Under `rules.economy.noticeBoardsBySeats` a seat holds two
    // at two seats, both of them collecting fees, and `noticeBoardOf` would
    // have reported the resting stock of half the table's boards as the whole
    // of it - on exactly the column a18 reads this series for.
    if (isNoticeBoardPower(this.data)) {
      let onBoards = 0;
      for (let seat = 0; seat < state.players.length; seat++) {
        for (const board of noticeBoardsOf(this.data, state, seat)) {
          onBoards += board.stack.length;
        }
      }
      m.noticeBoardCardsByRound.push(onBoards);
    }
    const leader = this.soleLeader(state);
    if (leader !== null && this.leader !== null && leader !== this.leader) m.leadChanges += 1;
    if (leader !== null) this.leader = leader;
  }

  /**
   * Every meeple in the game right now: every seat's supply, every Notice
   * Board slot on the table, and every meeple still sitting on an undelivered
   * island space.
   *
   * Island tiles store their meeple(s) DENSELY - `tile.meeples[i]` is the
   * meeple for whichever printed space `meepleIndexForSpace` maps to `i`, not
   * for space `i` itself (R12; see `doDeliver` and `setup.ts`). So a space
   * counts only when it is BOTH un-delivered (`space >= tile.deliveredBy.length`)
   * AND seeded (`meepleIndexForSpace` returns a real index): the shipped rules
   * seed only the 3 VP second space, so a tile whose first delivery is still
   * open correctly contributes nothing here - there is nothing sitting on
   * that space to pool.
   */
  private meeplePoolOf(state: GameState): number {
    let n = 0;
    for (const p of state.players) n += meepleCount(p.meeples);
    for (let seat = 0; seat < state.players.length; seat++) {
      const slots = noticeBoardSlots(state, seat);
      for (const colour of this.data.cards.suits) n += slots[colour]?.length ?? 0;
    }
    const per = deliveriesPerTile(this.data);
    for (const tile of state.island.tiles) {
      for (let space = tile.deliveredBy.length; space < per; space++) {
        const idx = meepleIndexForSpace(this.data, space);
        if (idx >= 0 && tile.meeples[idx] !== undefined) n += 1;
      }
    }
    return n;
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

  /**
   * ⭐ A16 THE BEEKEEPER'S VEIL, RECONSTRUCTED (11/09/2026) - see the fields'
   * own comment for why it matters and what the approximation is.
   *
   * A16 fires when a placement brings a building's stack to 2 and the PLACER is
   * the card's owner. `fx.land` pushes, so the card's index in the post-state
   * stack is the position it landed at: index 1 is the second card, which is the
   * `stackSize === 2` the handler tests. The split is by WHERE the card landed
   * rather than by what the move was called, because the landing site is what
   * the rule keys on - and because a sow onto a Notice Board is the same
   * placement as a fee onto one.
   *
   * ⛔ THERE IS NO CENTRAL COLUMN HERE AND THAT IS THE FINDING, NOT A GAP.
   * `fx.playOnCommons` never emits `cardPlaced` and never fires
   * `afterPlacement`, deliberately: a central board is in nobody's tableau and
   * is not a building. So a central play cannot reach this function at all, and
   * a18 prints the central play count beside these three so a reader can see the
   * zero is structural.
   */
  private countA16(d: Decision, e: Extract<GameEvent, { e: 'cardPlaced' }>): void {
    const holder = player(d.post, e.seat).tableau.some((b) => b.card === A16);
    if (!holder) return;
    this.m.a16PlacementsWhileHeld += 1;
    const building = player(d.post, e.onto.seat).tableau.find((b) => b.card === e.onto.building);
    if (building === undefined) return;
    if (building.stack.indexOf(e.card) !== 1) return;
    if (cardById(this.data, e.onto.building).slot === 'noticeboard') {
      if (e.seat === e.onto.seat) this.m.a16FiresOwnBoard += 1;
      else this.m.a16FiresRivalBoard += 1;
      return;
    }
    this.m.a16FiresOrdinary += 1;
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

    // ⭐ THE CENTRE BY THIRD (a18). Computed per GAME and once, so that games of
    // different lengths pool: a reader wants "the median centre size in the last
    // third", and a pooled series aligned on round 1 would compare a 25-round
    // game's endgame with a 40-round game's midgame. Empty below three samples,
    // because a third of a two-round series is not a third of anything.
    // ⭐ THE CENTRE'S REMAINDER (Dean's question, 09/09/2026), read off the
    // FINAL state rather than off the last round-boundary sample, because the
    // end-game trigger fires mid-round and the last sample can be a whole
    // rotation short of the end. It is the third term of a18's conservation
    // line: plays into the centre = cards harvested out + these.
    if (hasCentre(this.data)) {
      const boards = commonsBoards(state);
      let left = 0;
      for (const colour of this.data.cards.suits) left += boards[colour]?.length ?? 0;
      m.commonsStrandedAtEnd = left;
      // ⭐ THE CENTRE'S RIGHT-CENSORED TAIL (a20, 11/09/2026), on exactly the
      // contract the owned boards' tail below states: a run still open when the
      // game ends is a pile NOBODY EVER CLAIMED, which is the strongest form of
      // the finding, so it is banked apart rather than averaged in with the
      // runs that closed.
      for (const [, run] of this.centralPileStallRun) {
        if (run > 0) m.centralPileStallRunsOpenAtEnd.push(run);
      }
    }

    // ⭐ DEAD COINS (K7, 10/09/2026), read off the FINAL state for exactly the
    // reason the meeple line below is: minted-minus-spent and the wallet agree by
    // construction, so reading the wallet and printing both is what makes a
    // disagreement legible as a fold bug rather than as an economy that leaks.
    // `PlayerState.coins` is ABSENT under every mode without a coin economy (it
    // is a serialisation question, not a rules one), so this reads the optional
    // field directly rather than through `coinsOf`, which throws by design.
    //
    // ⭐ WIDENED ON 12/09/2026 FOR THE VILLAGE STORE (V11, ledger A150). There
    // are two coin economies in this codebase and they never run together, so
    // the wallet is read wherever EITHER is live and a19 and a25 gate on their
    // own leaf. ⛔ V11 IS WHY THE LINE MATTERS UNDER THE STORE: coins score
    // NOTHING at any rate, so a coin held at the end is a card converted for
    // nothing and the design's own sentence about dead coins is the context a25
    // prints beside it.
    if (isCommonsTakeCoins(this.data) || storeCoinsPerCard(this.data) > 0) {
      state.players.forEach((p, seat) => {
        m.coinsHeldAtEndBySeat[seat] = p.coins ?? 0;
      });
    }
    // ⭐ AND THE OTHER HALF OF V5's INVARIANT: what the shared supply still held.
    // Spent coins return to it, so the supply plus every wallet is the whole
    // pool for the entire game, and a25 prints the identity so a disagreement is
    // legible as a fold bug rather than as an economy that leaks.
    if (state.coinSupply !== undefined) m.coinSupplyAtEnd = state.coinSupply;

    // ⭐ THE STALL'S RIGHT-CENSORED TAIL (a20). A run still open when the game
    // ends is a board NOBODY EVER CLEARED, which is the strongest form of the
    // finding this reading is looking for - so it is banked in its own list
    // rather than pushed onto `boardStallRuns`, where a mean over the two
    // together would quietly average the worst cases away.
    //
    // ⛔ THE RUN TAIL IS WALKED PER BOARD AND THE CARDS ARE SUMMED PER SEAT
    // (11/09/2026). Two boards in one tableau have two open runs, and a seat's
    // resting stock is what is standing on BOTH of them; `boardsAtEnd` and
    // `boardsHoldingAtEnd` keep the per-BOARD population beside the per-seat
    // total, because A21 The Wax Hall scores a BUILDING holding a card (S16)
    // and a seat is not a building.
    if (isNoticeBoardPower(this.data)) {
      for (const [, run] of this.boardStallRun) {
        if (run > 0) m.boardStallRunsOpenAtEnd.push(run);
      }
      for (let seat = 0; seat < state.players.length; seat++) {
        let cards = 0;
        for (const board of noticeBoardsOf(this.data, state, seat)) {
          cards += board.stack.length;
          m.boardsAtEnd += 1;
          if (board.stack.length > 0) m.boardsHoldingAtEnd += 1;
        }
        m.boardCardsAtEndBySeat[seat] = cards;
      }
    }

    if (m.noticeBoardCardsByRound.length >= 3) {
      const series = m.noticeBoardCardsByRound;
      const cut = series.length / 3;
      m.noticeBoardCardsByRoundThird = [
        medianOf(series.slice(0, Math.ceil(cut))),
        medianOf(series.slice(Math.ceil(cut), Math.ceil(2 * cut))),
        medianOf(series.slice(Math.ceil(2 * cut))),
      ];
    }

    if (m.commonsPileSizeByRound.length >= 3) {
      const series = m.commonsPileSizeByRound;
      const cut = series.length / 3;
      m.commonsPileSizeByRoundThird = [
        medianOf(series.slice(0, Math.ceil(cut))),
        medianOf(series.slice(Math.ceil(cut), Math.ceil(2 * cut))),
        medianOf(series.slice(Math.ceil(2 * cut))),
      ];
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
      // ⭐ THE STRANDED COUNT BY COLOUR AND THE BARN THAT NEVER EMPTIED (a23 and
      // a24, 12/09/2026), both off the final state for the same reason as the
      // line above: a derived figure and a read figure disagreeing is an engine
      // bug, and only the read one can show it.
      for (const [colour, held] of Object.entries(p.meeples)) {
        if (held > 0)
          m.meeplesUnspentByColour[colour] = (m.meeplesUnspentByColour[colour] ?? 0) + held;
      }
      m.barnAtEndBySeat[seat] = p.barn.length;
    });
    // ⭐ WHAT IS STILL CIRCULATING (a24): each crop's deck and discard added
    // together at the stop. The complement of the barn line above, and the one
    // pool reading that exists even in a game where a deck never ran dry.
    for (const suit of this.data.cards.suits) {
      const deck = state.decks[suit]?.length ?? 0;
      const discard = state.discards[suit]?.length ?? 0;
      m.poolAtEndByCrop[suit] = deck + discard;
    }
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
