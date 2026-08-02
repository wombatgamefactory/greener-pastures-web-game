/**
 * The engine's state model, move protocol and event stream, as designed in
 * wayfinder ticket 04 and proven by ticket 05's spanning-set prototype.
 *
 * Everything in here is plain JSON: no classes, no closures, no Dates. A
 * GameState survives structuredClone, JSON round-trips, and being diffed by a
 * human. Card properties are never copied into state; a zone holds card ids and
 * the properties are read from GameData.
 */

import type { Suit, WorkerAction } from '@gp/data';

import type { BuildMods } from './actions.js';

export type Seat = number;

/** A card's spreadsheet Ref, e.g. "W13". All 105 are unique; the id IS the card. */
export type CardId = string;

/** A built card in a player's tableau. Starters live here too, from setup. */
export interface BuildingState {
  card: CardId;
  /** Cards paid or sown onto this building, oldest first. Full = length >= threshold. */
  stack: CardId[];
  /** Starters flip; deck cards never do. */
  upgraded: boolean;
}

export interface PlayerState {
  suit: Suit;
  coins: number;
  hand: CardId[];
  /** Stored value. Identity is inert here (views tally by suit) but ids keep card conservation checkable. */
  barn: CardId[];
  tableau: BuildingState[];
  /**
   * Cards buried under a D11 cover-build. Not buildings: invisible to every
   * count, formula and placement. Only their printed VP still scores, as a
   * bare sum (the reference's cover semantics).
   */
  covered: CardId[];
  /** VP values of island receipt tokens taken, in delivery order. */
  receipts: number[];
}

export interface WorkerState {
  id: WorkerAction;
  /** null = in the Hiring Fair. */
  owner: Seat | null;
  /** 0 = arrival space (no wage); 1..wages.length = paying spaces. Advancing past the end sends the Worker home. */
  trackPos: number;
}

/**
 * One island tile in play. Level, VP, coins and crate count are all read from
 * the tile's level rules in GameData; the state stores only what setup
 * randomised (the demand tokens) and what play has done (the deliveries).
 */
export interface IslandTileState {
  /** Printed face id, e.g. "A1". Level comes from data.island.tiles. */
  tile: string;
  /** One demand token per crate, dealt at setup. 'wild' is the cornucopia. */
  crates: (Suit | 'wild')[];
  /** Seats that have delivered here, in order. Full at data.island.deliveriesPerTile. */
  deliveredBy: Seat[];
}

export interface IslandState {
  tiles: IslandTileState[];
}

/**
 * The balloon module, in play only when Vegetable is on the table (null
 * otherwise). Ticket 17 sets it up; the balloon-move Deliver branch lands with
 * the Vegetable handler ticket.
 */
export interface AerodromeState {
  balloons: { id: string; at: Seat | 'centre' }[];
}

/**
 * Everything scoped to the current turn. Turn end replaces the whole object,
 * so a turn-scoped leak is structurally impossible.
 */
export interface TurnState {
  actionSpent: boolean;
  bonusSpent: boolean;
  /**
   * Set when turn end has been committed (explicit endTurn, or nothing left to
   * do): once the queue drains - the end-of-turn discard may still be pending -
   * the turn finalises unconditionally. Prevents a standing move from wedging
   * an ending turn open.
   */
  ending: boolean;
  /**
   * The Helping Hand gate. Set only by a visit's worker payoff; a repeat
   * re-works this worker. `repeats` counts repeats taken this visit.
   */
  visit: { host: Seat; workerId: WorkerAction; repeats: number } | null;
  /**
   * The ActionAgain gate (the reference's state 14): an upgraded Farmstead's
   * one optional repeat of the main action just taken. 'harvest' = the Wheat
   * "Harvest is 2 buildings", 'build' = the Dairy "BUILD: you may BUILD again".
   * Armed by apply after the qualifying MAIN action (never a Worker's - the
   * reference offers the repeat from afterMainAction only), consumed by the
   * repeat move, declined by endTurn or by the turn settling.
   */
  again: 'harvest' | 'build' | null;
  /**
   * Built cards whose once-per-turn standing move has been taken this turn
   * (the upgraded Orchard Barn's gift). A handler's moves() checks membership;
   * turn end resets by replacing the whole object.
   */
  onceUsed: CardId[];
}

/**
 * A suspended mid-effect choice, waiting for a task answer. Only choices queue;
 * immediate effects resolve synchronously. Head of the queue answers first.
 *
 * The vocabulary is deliberately small and generic: a task describes WHAT is
 * being chosen with data riders, never card-specific logic. Card-specific
 * behaviour rides as riders the generic resolver applies (e.g. `ownerCoins` on
 * chooseWorker), or in the last resort as a `card` task resolved by the card's
 * own handler.
 */
export type Task =
  | {
      /** Pick a Hired Worker and perform its action. */
      t: 'chooseWorker';
      pid: Seat;
      src: CardId;
      /** Whose workers qualify. */
      owned: 'rival' | 'own' | 'any';
      /** false = the Herb Hive mode: no meeple advance, therefore no wage. */
      progress: boolean;
      /** Coins the worker's owner mints from the bank when the pick resolves. */
      ownerCoins: number;
      /** Coins the ACTOR mints if the work happens (D9's "if you do, gain £2"). */
      actorCoins?: number;
      /** "You may then WORK" (D9): a skip answer is offered. */
      optional?: boolean;
    }
  | {
      /**
       * The see-N / keep-K draw engine, one task for the whole draw. While
       * `revealed.length < see` the answers are deck picks; once everything is
       * revealed the answers are keep-subsets. Kept cards go to hand, the rest
       * to their suits' discards.
       */
      t: 'draw';
      pid: Seat;
      src: CardId | null;
      see: number;
      keep: number;
      revealed: CardId[];
    }
  | {
      /**
       * Pick one of your own buildings matching the filter, then do `then` to
       * it. 'harvestable' is the Harvest ACTION's own target set (strict-full
       * plus the Wheat Farmstead's 2+ relaxation, surcharge-affordable) - the
       * Harvest Worker uses it so suit powers compose; card effects use the
       * plain gates. A harvest pays the target's surcharge (W8) on resolve.
       */
      t: 'chooseBuilding';
      pid: Seat;
      src: CardId | null;
      filter: 'full' | 'notFull' | 'harvestable';
      /** Never a legal target (W5's "Harvest another card"). */
      exclude?: CardId;
      then: 'harvest';
    }
  | {
      /** Sow: place a card from hand onto one of your own non-full buildings. Suit-free, never activates. */
      t: 'sow';
      pid: Seat;
      src: CardId | null;
      remaining: number;
      /** Restrict targets to these buildings (W9/W12's "sow onto your FIELDs"). */
      targets?: CardId[];
      /** "You may": a skip answer is offered and ends the task. */
      optional?: boolean;
    }
  | {
      /** A full Build action mid-effect (the Build Worker). Answers come from the same enumerator as the Build move. */
      t: 'build';
      pid: Seat;
      src: CardId | null;
      /**
       * The modifiers this build runs under: the cream balloon's and Dairy's
       * discounts, D7's coins-as-cards, D8's barn payment. Absent = the plain
       * printed rules. The seat's own Farmstead substitution is added on top by
       * the enumerator, so a card never has to remember it.
       */
      mods?: BuildMods;
      /** "You may Build" (D12's two builds): a skip answer is offered. */
      optional?: boolean;
    }
  | {
      /**
       * A full Deliver action mid-effect (the Deliver Worker, the Vegetable
       * deliver cards). Answers come from the same enumerators as the Deliver
       * move - island deliveries AND balloon moves, because moving a balloon
       * IS the Deliver action (reference DL-12).
       */
      t: 'deliver';
      pid: Seat;
      src: CardId | null;
      /** "You may immediately deliver" (A15): a skip answer is offered. */
      optional?: boolean;
    }
  | {
      /** End-of-turn discard down to the printed Barn hand size. */
      t: 'discard';
      pid: Seat;
      downTo: number;
    }
  | {
      /**
       * Escape hatch: a card-specific choice the generic vocabulary cannot
       * express. Resolved by the handler registered for `src`, keyed by `kind`.
       * None of the spanning set needed it; prefer the generic tasks.
       */
      t: 'card';
      pid: Seat;
      src: CardId;
      kind: string;
      riders: Record<string, unknown>;
    };

/** An answer to the head task. Shape depends on the task type. */
export type TaskAnswer =
  | { kind: 'worker'; workerId: WorkerAction }
  | { kind: 'deck'; suit: Suit }
  | { kind: 'keep'; cards: CardId[] }
  | { kind: 'building'; card: CardId }
  | { kind: 'sow'; card: CardId; onto: CardId }
  | {
      kind: 'build';
      card: CardId;
      payment: CardId[];
      /** D8: barn cards joining the payment, by suit tally (barn identity is inert). */
      barn?: Partial<Record<Suit, number>>;
      /** D7: coins spent as wild cards, on top of the card's printed coin price. */
      coinWild?: number;
    }
  | { kind: 'deliver'; tile: string; spend: Partial<Record<Suit, number>> }
  | { kind: 'balloon'; balloon: string; spend: Partial<Record<Suit, number>> }
  | { kind: 'discard'; cards: CardId[] }
  | { kind: 'skip' }
  | { kind: 'card'; payload: Record<string, unknown> };

/** Where control returns when the task queue drains. */
export type Resume = 'main' | 'worker' | 'turnflow';

export interface GameState {
  schema: 1;
  /** cards meta.sourceSha256 + overlay name; loading against different data fails loudly. */
  dataFingerprint: string;
  /** sfc32 state. */
  rng: [number, number, number, number];
  seats: number;
  /**
   * The seats' suits plus the one passive suit nobody farms - exactly the
   * decks on the table. Stored (not derived from deck emptiness) because a
   * fully-exhausted in-play suit is not the same as an out-of-game one.
   */
  suitsInPlay: Suit[];
  turnPlayer: Seat;
  phase: 'playing' | 'ended';
  endTrigger: { seat: Seat } | null;
  players: PlayerState[];
  /** Per-suit, index 0 = top. Never merged, never cross-shuffled. Out-of-play suits hold []. */
  decks: Record<Suit, CardId[]>;
  discards: Record<Suit, CardId[]>;
  fair: WorkerState[];
  island: IslandState;
  aerodrome: AerodromeState | null;
  turn: TurnState;
  tasks: Task[];
  resume: Resume | null;
}

/**
 * The Move union. Two families: turn moves (the five actions, the bonus slot,
 * turn end) and answers to a pending task. Card-contributed standing moves
 * (`cardMove`) are enumerated by legalMoves via the card's handler and applied
 * through the same registry, so legality still has exactly one source.
 */
export type Move =
  | { type: 'task'; seat: Seat; answer: TaskAnswer }
  | {
      type: 'cardMove';
      seat: Seat;
      /** The built card offering this move. */
      card: CardId;
      /** Handler-defined discriminator. */
      kind: string;
      payload: Record<string, unknown>;
    }
  /** The plain Draw action. Deck picks and the keep are the draw task's answers. */
  | { type: 'draw'; seat: Seat }
  /** Build a card from hand. `payment` is the chosen card ids; a coin-priced card pays coins and an empty payment. */
  | { type: 'build'; seat: Seat; card: CardId; payment: CardId[] }
  /** Hire a Worker from the Fair - a Build-action branch. */
  | { type: 'hire'; seat: Seat; workerId: WorkerAction }
  /** Flip a starter (Barn or Notice Board) for coins - a Build-action branch. The Farmstead only ever flips free. */
  | { type: 'upgrade'; seat: Seat; card: CardId }
  | { type: 'grow'; seat: Seat; building: CardId; payment: CardId }
  | { type: 'harvest'; seat: Seat; building: CardId }
  /** Deliver from barn to an island tile. `spend` is a per-suit map - barn identity is inert. */
  | { type: 'deliver'; seat: Seat; tile: string; spend: Partial<Record<Suit, number>> }
  /**
   * The Deliver action's freight branch (reference DL-12): pay 2 differing
   * barn cards, take a balloon that is not on your own Aerodrome, collect its
   * reward. In play only when Vegetable is on the table.
   */
  | { type: 'moveBalloon'; seat: Seat; balloon: string; spend: Partial<Record<Suit, number>> }
  /**
   * The visit half of the bonus slot: cards from hand onto a neighbour's Notice
   * Board, then the payoff printed on the face they landed on. `fee` is exactly
   * 1 card for `coin` and `worker`, and exactly 2 distinct cards for `special` -
   * Special Orders' "2 cards, take £3", which the upgraded face alone prints and
   * which never offers a Worker.
   */
  | {
      type: 'visit';
      seat: Seat;
      host: Seat;
      fee: CardId[];
      payoff: { mode: 'coin' } | { mode: 'worker'; workerId: WorkerAction } | { mode: 'special' };
    }
  /** The other half of the bonus slot. Free, no wage. */
  | { type: 'workOwnWorker'; seat: Seat; workerId: WorkerAction }
  /** Legal only when no main action is: spends the action, keeps the bonus slot. */
  | { type: 'pass'; seat: Seat }
  /** Decline whatever options are still live and end the turn. Legal once the action is spent. */
  | { type: 'endTurn'; seat: Seat };

export type MoveType = Move['type'];

/**
 * The Move union's discriminator, reflected at runtime.
 *
 * `satisfies` makes this a two-way lock: a missing key is not assignable to the
 * Record and an extra key trips the excess-property check, so the list cannot
 * drift from the union. That is what lets a consumer assert coverage over every
 * move type - the bot roster's scoring terms do exactly that, so a rules change
 * that adds a move type fails the build rather than scoring it 0 in silence.
 */
const MOVE_TYPE_KEYS = {
  task: true,
  cardMove: true,
  draw: true,
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
} satisfies Record<MoveType, true>;

export const MOVE_TYPES = Object.keys(MOVE_TYPE_KEYS) as readonly MoveType[];

/** One truth-level stream; redactEvents masks per seat. Feeds UI animation and sim metrics alike. */
export type GameEvent =
  | { e: 'coins'; seat: Seat; delta: number; why: string }
  | { e: 'cardPlaced'; seat: Seat; onto: { seat: Seat; building: CardId }; card: CardId }
  | { e: 'cardsToHand'; seat: Seat; cards: CardId[] }
  | { e: 'cardsDiscarded'; suit: Suit; cards: CardId[] }
  | { e: 'deckToBarn'; seat: Seat; suit: Suit; card: CardId }
  /** One card lifted from a building's stack into its owner's barn (W14) - NOT a harvest, no on-harvest passives. */
  | { e: 'stackToBarn'; seat: Seat; building: CardId; card: CardId }
  | { e: 'harvested'; seat: Seat; building: CardId; cards: CardId[] }
  | { e: 'workerWorked'; seat: Seat; workerId: WorkerAction; owner: Seat | null; free: boolean }
  | { e: 'workerAdvanced'; workerId: WorkerAction; to: number; wage: number; paidTo: Seat | null }
  | { e: 'workerExpired'; workerId: WorkerAction }
  | { e: 'reshuffled'; suit: Suit; count: number }
  | { e: 'built'; seat: Seat; card: CardId; payment: CardId[]; coins: number }
  /** A card buried under a D11 cover-build: no longer a building, printed VP still scores. */
  | { e: 'covered'; seat: Seat; card: CardId }
  /** An empty building demolished into its owner's barn (D14). */
  | { e: 'demolished'; seat: Seat; card: CardId }
  | { e: 'hired'; seat: Seat; workerId: WorkerAction }
  /** free = the Farmstead milestone flip (3rd own-colour build); false = a paid Barn/Notice Board flip. */
  | { e: 'starterUpgraded'; seat: Seat; card: CardId; free: boolean }
  | {
      e: 'delivered';
      seat: Seat;
      tile: string;
      vp: number;
      coins: number;
      spend: Partial<Record<Suit, number>>;
    }
  | {
      e: 'balloonMoved';
      seat: Seat;
      balloon: string;
      from: Seat | 'centre';
      spend: Partial<Record<Suit, number>>;
      /** True for a card effect's free move (V16) - no barn cards paid. */
      free: boolean;
    }
  /** A face-up discard reclaimed into a barn (the upgraded Vegetable Barn's freight refund). */
  | { e: 'discardToBarn'; seat: Seat; card: CardId }
  /** A card given from one hand to another (the Orchard gift family). Identity travels with it. */
  | { e: 'cardGifted'; from: Seat; to: Seat; card: CardId }
  /** A card sent from its owner's hand into their own barn (O17's £1 divert). */
  | { e: 'handToBarn'; seat: Seat; card: CardId }
  | { e: 'visited'; seat: Seat; host: Seat; mode: 'coin' | 'worker' | 'special' }
  | { e: 'endTriggered'; seat: Seat }
  | { e: 'turnEnded'; seat: Seat; next: Seat }
  | { e: 'gameEnded' };
