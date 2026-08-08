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
 *   - **Activation count** is exactly the count of `grow` moves on a building,
 *     because `handlerFor().activate()` fires only from `doGrow`.
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

import type { GameData, Suit, WorkerAction } from '@gp/data';
import { deliveriesPerTile } from '@gp/data';
import type { CardId, GameEvent, GameState, Move, ScoreBreakdown, Seat, Task } from '@gp/engine';
import {
  MOVE_TYPES,
  cardById,
  faceOf,
  gameEndScores,
  handlerFor,
  player,
  score,
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
  workerAdvanced: true,
  workerExpired: true,
  reshuffled: false,
  built: true,
  covered: true,
  demolished: true,
  hired: true,
  starterUpgraded: true,
  delivered: true,
  balloonMoved: true,
  discardToBarn: true,
  cardGifted: true,
  handToBarn: true,
  visited: true,
  endTriggered: true,
  turnEnded: true,
  gameEnded: false,
} satisfies Record<GameEvent['e'], boolean>;

export const MOVE_KINDS = {
  task: true,
  cardMove: true,
  draw: true,
  buy: true,
  market: true,
  build: true,
  hire: true,
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

export interface WorkerLifetime {
  readonly worker: WorkerAction;
  readonly owner: Seat;
  /** Furthest paying space the meeple reached. `wages.length` is the top. */
  maxPos: number;
  /** True when the meeple walked home; false when the game ended first. */
  expired: boolean;
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
  visitsToLeaderBySeat: number[];
  deliveriesBySeat: number[];
  ownCropBuildsBySeat: number[];
  foreignCropBuildsBySeat: number[];
  wageCoinsBySeat: number[];
  upgradesBySeat: number[];
  /** The seat's own turn number when it first hired, or null. */
  firstHireTurnBySeat: (number | null)[];
  /** Turns the seat began holding cards with no legal visit anywhere. */
  clogTurnsBySeat: number[];
  /** Turns the seat began, counted only when the clog question was askable. */
  clogSampledBySeat: number[];

  workerLifetimes: WorkerLifetime[];
  /** Uses of a worker by somebody other than its owner, by worker. */
  rivalUsesByWorker: Record<string, number>;
  workerVisits: WorkerVisit[];

  /** D9 The Prosperity Wagon: works targeting the owner's own Worker, and a rival's. */
  wagonSelfWorks: number;
  wagonRivalWorks: number;
  /** Times the Wagon was ACTIVATED at all, and times its optional work was declined. */
  wagonActivations: number;
  wagonSkips: number;

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

  cards: Map<CardId, CardFacts>;
}

const WAGE = /^wage:/;
const RIDER = /^rider:(.+)$/;

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
  private readonly open = new Map<string, WorkerLifetime>();
  private seeded = false;
  private leaderCache: { d: Decision; v: Seat | null } | null = null;

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
      visitsToLeaderBySeat: zeros(),
      deliveriesBySeat: zeros(),
      ownCropBuildsBySeat: zeros(),
      foreignCropBuildsBySeat: zeros(),
      wageCoinsBySeat: zeros(),
      upgradesBySeat: zeros(),
      firstHireTurnBySeat: Array<number | null>(seats).fill(null),
      clogTurnsBySeat: zeros(),
      clogSampledBySeat: zeros(),
      workerLifetimes: [],
      rivalUsesByWorker: {},
      workerVisits: [],
      wagonSelfWorks: 0,
      wagonRivalWorks: 0,
      wagonActivations: 0,
      wagonSkips: 0,
      islandFill: NaN,
      movesChosen: {},
      movesOffered: {},
      balloonMoves: 0,
      raidsByVictim: zeros(),
      cards: new Map(),
    };
    for (const card of data.cards.catalogue) {
      this.m.cards.set(
        card.id,
        emptyFacts(seats, spec.suits.includes(card.suit) || spec.neutral.includes(card.suit)),
      );
    }
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
    this.m.movesChosen[d.move.type] = (this.m.movesChosen[d.move.type] ?? 0) + 1;
    for (const type of new Set(d.legal.map((m) => m.type))) {
      this.m.movesOffered[type] = (this.m.movesOffered[type] ?? 0) + 1;
    }
    this.turnStart(d);
    this.move(d);
    for (const e of d.events) this.event(d, e);
  }

  /**
   * The clog probe (assertion 5), sampled at the first decision of every turn:
   * the seat holds cards and yet no visit is legal anywhere, because every
   * rival's Notice Board is full. Only askable at a fresh turn - once the bonus
   * slot is spent `visitOptions` is empty for a reason that is not denial.
   */
  private turnStart(d: Decision): void {
    const s = d.pre;
    if (this.turnsEnded === this.sampledTurn) return;
    if (s.tasks.length > 0 || s.turn.actionSpent || s.turn.bonusSpent) return;
    this.sampledTurn = this.turnsEnded;
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
        const f = this.facts(move.building);
        f.activations += 1;
        if (move.building === 'D9') this.m.wagonActivations += 1;
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
      // Claimed and uninteresting: their effect is measured through events.
      // `buy` included - the action-mix table counts it, the `coins` event pays
      // for it, and the card it takes is blind, so there is nothing card-level
      // to fold.
      case 'cardMove':
      case 'draw':
      case 'buy':
      case 'hire':
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

    // D9 The Prosperity Wagon works any Worker including your own (ruling E),
    // which permits a hermit battery. Assertion 11 is the measurement.
    if (task.t === 'chooseWorker' && task.src === 'D9') {
      if (a.kind === 'skip') this.m.wagonSkips += 1;
      if (a.kind === 'worker') {
        const owner = d.pre.fair.find((w) => w.id === a.workerId)?.owner ?? null;
        if (owner === task.pid) this.m.wagonSelfWorks += 1;
        else this.m.wagonRivalWorks += 1;
      }
    }
  }

  private event(d: Decision, e: GameEvent): void {
    const m = this.m;
    switch (e.e) {
      case 'coins': {
        if (e.delta <= 0) return;
        if (WAGE.test(e.why))
          m.wageCoinsBySeat[e.seat] = (m.wageCoinsBySeat[e.seat] ?? 0) + e.delta;
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
        return;
      case 'built': {
        const f = this.facts(e.card);
        f.played = true;
        f.builtBy.push(e.seat);
        const own = cardById(this.data, e.card).suit === player(d.post, e.seat).suit;
        if (own) m.ownCropBuildsBySeat[e.seat] = (m.ownCropBuildsBySeat[e.seat] ?? 0) + 1;
        else m.foreignCropBuildsBySeat[e.seat] = (m.foreignCropBuildsBySeat[e.seat] ?? 0) + 1;
        return;
      }
      case 'hired': {
        if (m.firstHireTurnBySeat[e.seat] === null) {
          m.firstHireTurnBySeat[e.seat] = (m.turnsBySeat[e.seat] ?? 0) + 1;
        }
        this.open.set(e.workerId, {
          worker: e.workerId,
          owner: e.seat,
          maxPos: 0,
          expired: false,
        });
        return;
      }
      case 'workerWorked':
        if (e.owner !== null && e.owner !== e.seat) {
          m.rivalUsesByWorker[e.workerId] = (m.rivalUsesByWorker[e.workerId] ?? 0) + 1;
        }
        return;
      case 'workerAdvanced': {
        const life = this.open.get(e.workerId);
        if (life) life.maxPos = Math.max(life.maxPos, e.to);
        return;
      }
      case 'workerExpired': {
        const life = this.open.get(e.workerId);
        if (life) {
          life.expired = true;
          m.workerLifetimes.push(life);
          this.open.delete(e.workerId);
        }
        return;
      }
      case 'starterUpgraded':
        if (!e.free) m.upgradesBySeat[e.seat] = (m.upgradesBySeat[e.seat] ?? 0) + 1;
        return;
      case 'delivered': {
        m.deliveriesBySeat[e.seat] = (m.deliveriesBySeat[e.seat] ?? 0) + 1;
        // The exploit probe (ticket 56): could this slot have been bought
        // entirely at market, with no harvest between? Conservative in the
        // exploit's favour - it asks whether the market buys since the last
        // harvest COVER the cost, not which physical cards were spent, because
        // barn identity is inert and the engine spends arbitrary ids.
        const cost = Object.values(e.spend).reduce((a, n) => a + (n ?? 0), 0);
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
        return;
      case 'balloonMoved': {
        m.balloonMoves += 1;
        if (typeof e.from === 'number' && e.from !== e.seat) {
          m.raidsByVictim[e.from] = (m.raidsByVictim[e.from] ?? 0) + 1;
        }
        return;
      }
      case 'visited': {
        m.visitsBySeat[e.seat] = (m.visitsBySeat[e.seat] ?? 0) + 1;
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
        if (d.pre.turn.bonusSpent || d.move.type === 'visit' || d.move.type === 'workOwnWorker') {
          m.bonusTurnsBySeat[seat] = (m.bonusTurnsBySeat[seat] ?? 0) + 1;
        }
        this.turnsEnded += 1;
        if (this.turnsEnded % m.seats === 0) this.roundBoundary(d.post);
        return;
      }
      case 'endTriggered':
        m.endTriggerRound = Math.floor(this.turnsEnded / m.seats) + 1;
        return;
      // Claimed and uninteresting for balance: card movement between zones that
      // no assertion and no funnel layer reads.
      case 'cardPlaced':
      case 'cardsDiscarded':
      case 'deckToBarn':
      case 'stackToBarn':
      case 'covered':
      case 'demolished':
      case 'discardToBarn':
      case 'handToBarn':
      case 'reshuffled':
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
    for (const life of this.open.values()) m.workerLifetimes.push(life);
    this.open.clear();

    const capacity = state.island.tiles.length * deliveriesPerTile(this.data);
    const made = state.island.tiles.reduce((n, t) => n + t.deliveredBy.length, 0);
    m.islandFill = capacity === 0 ? NaN : made / capacity;

    const final = score(this.data, state);
    m.scores = final.seats;
    m.ranking = final.ranking;
    const first = final.ranking[0];
    m.winner = first === undefined ? null : first;

    // VP attribution, per card per seat: the printed face plus whatever the
    // card's own endgame formula returned. Covered cards (D11) still score
    // their printed VP, so they are counted where they lie.
    state.players.forEach((p, seat) => {
      for (const b of p.tableau) {
        const f = this.facts(b.card);
        const endgame = handlerFor(b.card)?.gameEnd?.(this.data, state, seat) ?? 0;
        f.vp[seat] = (f.vp[seat] ?? 0) + faceOf(this.data, b).printedVp + endgame;
      }
      for (const id of p.covered) {
        const f = this.facts(id);
        f.vp[seat] = (f.vp[seat] ?? 0) + (cardById(this.data, id).printedVp ?? 0);
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
