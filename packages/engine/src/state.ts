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
   * VP taken from the island, in delivery order - one entry per delivery, so
   * `receipts.length` is the receipt count the tie-break reads. Since the flat
   * island every entry is read straight off `island.vpByDeliveryOrder` (6 for
   * arriving first at a tile, 3 for second), and nothing is added on top, so a
   * scoring screen can re-derive the whole list from the tiles.
   */
  receipts: number[];
}

/**
 * Which seat owns each Service. Set at setup from the suit that brought it and
 * NEVER changed: there is no hiring, no expiry and no track since 2026-08-10.
 * `owner: null` means that suit is not at the table, so that Service is not in
 * the game at all.
 *
 * Derivable from `players[].suit`, and kept anyway: it is the index every
 * "whose Service performs action X" lookup wants, and it is one line of setup
 * against a scan in a dozen hot call sites.
 */
export interface WorkerState {
  id: WorkerAction;
  owner: Seat | null;
}

/**
 * One island tile in play. Cost, coins and VP are the same on every tile and
 * live in `island.tileRule` / `island.vpByDeliveryOrder`; the state stores only
 * what setup randomised (the demand tokens) and what play has done.
 */
export interface IslandTileState {
  /** Printed face id, e.g. "A1". Its level is layout only - see tileLevel. */
  tile: string;
  /** One demand token per crate, dealt at setup. 'wild' is the cornucopia. */
  crates: (Suit | 'wild')[];
  /**
   * THE DEMAND TOKENS ARE MUTABLE (the Vegetable rebuild, 2026-08-09). Parallel
   * to `crates`: entry i true = that token has been turned FACE DOWN by V6 The
   * Trade Depot, and a face-down token accepts cards of any crops at the normal
   * rate. Absent (the overwhelmingly common case) = nothing on this tile has
   * been turned.
   *
   * A PARALLEL ARRAY rather than making `crates` hold objects, deliberately. A
   * face-down token BEHAVES as wild but is not a cornucopia: the UI must draw it
   * differently, and V6 must never be offered a token that is already wild. This
   * shape leaves every existing reader of `crates` untouched, and `namedDemand`
   * is the single place that has to know - which is what makes the rule one edit
   * rather than an audit of every affordability path.
   *
   * V5's SWAP moves a token between crates, and the face-down flag travels with
   * the token it belongs to, because physically it is the token that moves.
   */
  faceDown?: boolean[];
  /**
   * Seats that have delivered here, IN ORDER, and the order is the payment: the
   * seat at index i took `island.vpByDeliveryOrder[i]`. Full at that array's
   * length. This is why nothing else has to be stored per delivery - the public
   * record on the tile is enough to re-derive every VP the island paid.
   */
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
   * The once-per-turn card BUY (2026-08-03): pay the bank and take the top card
   * of a deck that is not your own suit. Its own flag rather than a share of the
   * bonus slot, because it is a free action - the design's point is that a coin
   * is never dead, and a sink that competed with the visit would not be one.
   */
  buyUsed: boolean;
  /**
   * Set when turn end has been committed (explicit endTurn, or nothing left to
   * do): once the queue drains - the end-of-turn discard may still be pending -
   * the turn finalises unconditionally. Prevents a standing move from wedging
   * an ending turn open.
   */
  ending: boolean;
  /**
   * The Helping Hand gate. Set only by a visit's Service payoff; a repeat
   * re-works that Service by placing another card ON IT. `repeats` counts
   * repeats taken this visit.
   */
  visit: { host: Seat; workerId: WorkerAction; repeats: number } | null;
  /**
   * The ActionAgain gate (the reference's state 14): an upgraded Farmstead's
   * one optional repeat of the main action just taken. 'harvest' = the Wheat
   * "Harvest is 2 buildings". Armed by apply after the qualifying MAIN action
   * (never a Worker's - the reference offers the repeat from afterMainAction
   * only), consumed by the repeat move, declined by endTurn or by the turn
   * settling.
   *
   * It used to have a second value, 'build', for the upgraded Dairy Farmstead's
   * "BUILD: you may BUILD again". That card is gone (2026-08-10): it sold a
   * second Build ACTION - the scarcest resource in the game - for £2, and the
   * suit still came last by a distance. Wheat's repeat is the only one left,
   * and the union is narrowed to say so.
   */
  again: 'harvest' | null;
  /**
   * Built cards whose once-per-turn standing move has been taken this turn
   * (the upgraded Orchard Barn's gift). A handler's moves() checks membership;
   * turn end resets by replacing the whole object.
   */
  onceUsed: CardId[];
  /**
   * THE RECURSION GUARD (the Apiary rebuild, 2026-08-11): every card whose
   * printed ability has FIRED this turn, by any route - the GROW action, a
   * card-granted grow (A6, O13), an activation with no placement (A5, A12), or
   * a card marking itself from a hook (D16).
   *
   * The ruling it encodes is one line: **no card's text may fire twice in a
   * turn.** Without it A12 The Honey Hut fires A5 The Meadow Hive, which fires
   * A12, and the game does not terminate.
   *
   * It is enforced by FILTERING THE OPTION OUT (`growOptions`, `activateTargets`)
   * and never by throwing: the bots probe by cloning and replaying, so a guard
   * implemented as a runtime exception surfaces as a crash inside `probe.ts`
   * rather than as a move nobody takes.
   *
   * ⚠️ A sibling field, `buildSources`, was DELETED here on 2026-08-12 and the
   * deletion is recorded because the ruling it held is worth not re-inventing.
   * It recorded the source of every build made this turn, and D16 The Ledger was
   * its only reader: the 2026-08-10 ruling paid the Ledger once per build SOURCE
   * so The Grand Creamery could not draw four, with a deliberate carve-out that
   * NEVER deduped a null source, on the grounds that a plain Build and a
   * bonus-slot Build are two genuine Build actions. The Dairy rebalance moved
   * the Ledger onto this list instead, so the card fires once a turn full stop,
   * the carve-out is gone, and the field had no readers left. Both
   * multi-building cards still pay out once - for a simpler reason.
   */
  firedThisTurn: CardId[];
}

/**
 * A building ANYWHERE on the table. Sow targets used to be bare `CardId[]`,
 * implicitly the actor's own tableau; A4 The Herb Hive and A14 The Honeycomb
 * Tower place on a NEIGHBOUR's building, so the pair travels together. A target
 * list left undefined still means "your own buildings", which is what keeps
 * every pre-Apiary caller unchanged.
 */
export interface BuildingRef {
  seat: Seat;
  card: CardId;
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
      /** Pick a Service and perform its action. */
      t: 'chooseWorker';
      pid: Seat;
      src: CardId;
      /** Whose Services qualify. */
      owned: 'rival' | 'own' | 'any';
      /**
       * false = the Herb Hive mode: the action happens but NO card is placed on
       * the Service, so its threshold does not move and no wage is minted. It
       * was "the meeple does not advance" until the Working Week died; the
       * meaning ("this use is off the books") is unchanged.
       */
      progress: boolean;
      /** Coins the Service's owner mints from the bank when the pick resolves. */
      ownerCoins: number;
      /** "You may then WORK": a skip answer is offered. */
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
      /**
       * 'loaded' is the Wheat rebuild's gate: any building of yours with 1 or
       * more cards on it, however far off its threshold. It is deliberately NOT
       * a relaxation of the Harvest ACTION - the Wheat Farmstead's 2+ rule lives
       * in `harvestable` - but the printed exception W11 and W13 spell out in
       * words ("however many cards are on it").
       */
      filter: 'full' | 'notFull' | 'harvestable' | 'loaded';
      /**
       * `harvestable` only: buildings holding at least this many cards count
       * even when not full. The Wheat SERVICE passes 2 and nothing else passes
       * anything - since the W2/W3 swap of 19/08/2026 the relaxed harvest is
       * that door's action rather than the Wheat seat's suit power, so it has
       * to travel on the task rather than be looked up from the actor.
       */
      relaxedMin?: number;
      /** Never a legal target (W5's "Harvest another card"). */
      exclude?: CardId;
      /** Restrict targets to these buildings (O7's "one of your ORCHARDs"), as `sow` does. */
      targets?: CardId[];
      /** "You may Harvest" (O7): a skip answer is offered and ends the task. */
      optional?: boolean;
      then: 'harvest';
    }
  | {
      /** Sow: place a card from hand onto a non-full building. Suit-free, never activates. */
      t: 'sow';
      pid: Seat;
      src: CardId | null;
      remaining: number;
      /**
       * Restrict targets to these buildings (W9/W12's "sow onto your FIELDs").
       * Absent = every non-full building of the actor's OWN, which is what every
       * caller before the Apiary rebuild meant.
       */
      targets?: BuildingRef[];
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
       * discounts, the Builder's Yard's crop waiver, D7's stack payment. Absent
       * = the plain printed rules. Nothing is folded in on top any more - the
       * Dairy Farmstead stopped granting substitution on 2026-08-10, so what a
       * build carries is exactly what granted it.
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
      /**
       * The Apiary Service: sow the top card of a DECK onto one of your own
       * non-full buildings. Its own task rather than a rider on `sow`, because
       * the answer names a deck instead of a hand card - and because the whole
       * point is that the sown card never touches the actor's hand. Sowing from
       * hand would cost a visitor two cards for one threshold step.
       */
      t: 'sowFromDeck';
      pid: Seat;
      src: CardId | null;
      remaining: number;
      /**
       * Restrict targets to these buildings, exactly as `sow` does. The Wheat
       * rebuild's shared line "Sow 1 FIELD from the deck" is this task with the
       * seat's FIELDs listed, and W7's "onto this FIELD" is it with one. A
       * NEIGHBOUR's building is a legal entry (A4, A14) - and a sow onto a
       * neighbour's farm is not a VISIT: no bonus slot, no wage, no afterVisit.
       */
      targets?: BuildingRef[];
      /**
       * Fix the deck (A13's "the top card of EACH deck": one task per deck, in
       * a fixed order). Absent = the answer names any drawable deck, which is
       * every other caller.
       */
      suit?: Suit;
    }
  | {
      /**
       * GROW WITHOUT PLACING (the Apiary rebuild): fire a building's printed
       * ability with no card paid, no crop matched and no stack advanced. Its
       * own task rather than a `chooseBuilding` filter because the answer names
       * a building to FIRE, and because the target set is deliberately WIDER
       * than any placement's - a FULL building is legal here, since the only
       * reason a full building cannot be grown is that no card may be placed on
       * it, and nothing is being placed.
       *
       * `targets` is a snapshot taken when the card activated; the enumerator
       * re-checks each entry against `turn.firedThisTurn` and the live tableau,
       * which is what makes A12 -> A5 -> A12 terminate.
       */
      t: 'activate';
      pid: Seat;
      src: CardId;
      remaining: number;
      targets: CardId[];
    }
  | {
      /**
       * Put one card from your own hand into your own barn. The Wheat Service's
       * tail and the Vegetable Service's head, and the same primitive both
       * times: before a Deliver it IS "you may pay 1 card of the cost from your
       * hand", because the barn is where a delivery is paid from.
       *
       * Always optional in practice, so it can never be a downside.
       */
      t: 'handToBarn';
      pid: Seat;
      src: CardId | null;
      remaining: number;
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
       * THE DISCARD DIVERT SEAM (the Orchard rebuild, 2026-08-09). One task,
       * two cards: the rebuilt Orchard Farmstead ("when one of your draws
       * discards a card, give it to a neighbour instead") and O17 The Fruit
       * Basket ("whenever you discard a card, you may pay £1 to put it into
       * your barn instead"). They are mutually exclusive PER CARD by
       * construction - a discard either crosses the fence for +£1 or goes in
       * your barn for -£1 - so it is one seam, not two.
       *
       * `cards` are in LIMBO: out of the reveal or out of the hand, not yet in
       * any pile. That is exactly what `draw.revealed` already does, and it is
       * why the task is never enumerated empty - `skip` is always offered while
       * a card is still held, so the drain loop can never drop the task and
       * lose the cards. A seat with neither permanent never gets one at all;
       * `discardOrDivert` discards inline instead.
       */
      t: 'divert';
      pid: Seat;
      src: CardId | null;
      cards: CardId[];
      /** A DRAW produced these: the Farmstead's gift is offered here and nowhere else. */
      fromDraw: boolean;
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
  /**
   * The `activate` task's answer: which building to FIRE without placing a card.
   *
   * Deliberately NOT `kind: 'building'`, even though the payload is identical.
   * `chooseBuilding`'s only `then` is 'harvest', so the bots read a bare
   * `building` answer as a harvest and score it by stack size - which would have
   * the bot choosing what to activate as if it were emptying it, and would keep
   * the choice off the probe path entirely. Same reason `deckSow` was split out
   * of `sow`: when the answer names a different thing, it gets its own kind.
   */
  | { kind: 'activate'; card: CardId }
  /** `ontoSeat` is absent for the actor's own building - which is every sow but A4's and A14's. */
  | { kind: 'sow'; card: CardId; onto: CardId; ontoSeat?: Seat }
  /** sowFromDeck: which deck top, onto which building. */
  | { kind: 'deckSow'; suit: Suit; onto: CardId; ontoSeat?: Seat }
  | { kind: 'handToBarn'; card: CardId }
  | {
      kind: 'build';
      card: CardId;
      payment: CardId[];
      /** D7: cards lifted off the seat's OWN buildings to help pay, by id. */
      stacks?: CardId[];
    }
  /**
   * `head` / `deckHead` are V2 The Vegetable Farmstead's, and they MUST be
   * carried on the answer rather than re-derived when it resolves. The head is
   * loaded BEFORE the payment and is often the only reason the payment is
   * affordable, so an answer that drops it is an answer the barn cannot pay -
   * which is exactly what happened when `deliverAnswers` first enumerated the
   * head-augmented options and then threw the head away.
   */
  | {
      kind: 'deliver';
      tile: string;
      spend: Partial<Record<Suit, number>>;
      head?: CardId[];
      deckHead?: Suit;
    }
  | {
      kind: 'balloon';
      balloon: string;
      spend: Partial<Record<Suit, number>>;
      head?: CardId[];
      deckHead?: Suit;
    }
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
  /**
   * BUY one card, blind, off the top of a deck that is NOT your own suit, for
   * `rules.turn.buyCost` to the bank. A free action, once a turn, and
   * deliberately not a Draw: no reveal, no keep, and no draw modifier - so the
   * Orchard Farmstead and the Draw Worker keep the draw lane to themselves.
   */
  | { type: 'buy'; seat: Seat; suit: Suit }
  /**
   * BUY AT MARKET (docs/Market Bonus Action 2026-08-03.md): a bonus-slot option
   * beside the coin visit and the worker visit. Pay `rules.turn.marketCost` to
   * the bank, take the top card of any one deck in play - own suit included -
   * straight into your BARN, revealed as it goes. Consumes the bonus slot; not
   * a visit (no Helping Hand, no afterVisit, no wage) and not a Draw (no
   * reveal-and-keep, no draw modifier). Ticket 56 holds it beside `buy` so the
   * paired arms can decide which coin sink is the game's.
   */
  | { type: 'market'; seat: Seat; suit: Suit }
  /** Build a card from hand. `payment` is the chosen card ids; a coin-priced card pays coins and an empty payment. */
  | { type: 'build'; seat: Seat; card: CardId; payment: CardId[] }
  /** Flip a starter for coins - a Build-action branch, and all three of them since 2026-08-12. */
  | { type: 'upgrade'; seat: Seat; card: CardId }
  | { type: 'grow'; seat: Seat; building: CardId; payment: CardId }
  | { type: 'harvest'; seat: Seat; building: CardId }
  /**
   * Deliver from barn to an island tile. `spend` is a per-suit map - barn identity
   * is inert. `head` is V2 The Vegetable Farmstead's "you may FIRST put N cards
   * from your hand into your barn", moved before the payment is made and absent
   * for every other suit. `deckHead` is the same card on the UPGRADED face,
   * where the source moves from the hand to the top of a deck of your choice;
   * the two are alternatives, never a pair.
   */
  | {
      type: 'deliver';
      seat: Seat;
      tile: string;
      spend: Partial<Record<Suit, number>>;
      head?: CardId[];
      /** V2's UPGRADED head (19/08/2026): the top card of this deck, not a hand card. */
      deckHead?: Suit;
    }
  /**
   * The Deliver action's freight branch (reference DL-12): pay 2 differing
   * barn cards, take a balloon that is not on your own Aerodrome, collect its
   * reward. In play only when Vegetable is on the table.
   */
  | {
      type: 'moveBalloon';
      seat: Seat;
      balloon: string;
      spend: Partial<Record<Suit, number>>;
      /** V2's head on a flight - a balloon move IS the Deliver action (DL-12). */
      head?: CardId[];
      deckHead?: Suit;
    }
  /**
   * The visit half of the bonus slot: cards from hand onto a neighbour's
   * building, then the payoff printed on it. The MODE PICKS THE BUILDING, which
   * is why there is no separate target field:
   *
   *   coin / special -> their NOTICE BOARD, and the bank pays the VISITOR.
   *   worker         -> their SERVICE, and the bank pays the HOST.
   *
   * `fee` is exactly 1 card for `coin` and `worker`, and exactly 2 distinct
   * cards for `special` (Special Orders' "2 cards, take £3", upgraded face only,
   * which never offers a Service). Either building refuses the whole visit when
   * it is clogged, and they clog independently - which is the point of there
   * being two of them.
   */
  | {
      type: 'visit';
      seat: Seat;
      host: Seat;
      fee: CardId[];
      payoff: { mode: 'coin' } | { mode: 'worker'; workerId: WorkerAction } | { mode: 'special' };
    }
  /**
   * The other half of the bonus slot: activate your OWN Service. Costs
   * `workers.ownerActivationCost` to the bank, places no card, moves no
   * threshold and earns nothing - you never earn from your own farm.
   */
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
  | { e: 'reshuffled'; suit: Suit; count: number }
  | { e: 'built'; seat: Seat; card: CardId; payment: CardId[]; coins: number }
  /**
   * An empty building demolished by D14 The Cream Refinery. It goes to its own
   * suit's DISCARD, not to the barn - Dean's ruling of 19/08/2026 - so it is
   * neither a building nor freight afterwards. The `covered` event that used to
   * sit beside this one is gone with D11's build-on-top (19/08/2026).
   */
  | { e: 'demolished'; seat: Seat; card: CardId }
  /**
   * A starter flipped to its upgraded face. Always a purchase since 2026-08-12,
   * when the Farmstead's free milestone flip was retired - which is why the
   * event no longer carries a `free` flag. Readers that care WHICH starter (the
   * Farmstead's arrival is still the moment the suit power doubles) take it off
   * the card's slot.
   */
  | { e: 'starterUpgraded'; seat: Seat; card: CardId }
  | {
      e: 'delivered';
      seat: Seat;
      tile: string;
      /** The receipt taken: 6 for arriving first at this tile, 3 for second. */
      vp: number;
      coins: number;
      spend: Partial<Record<Suit, number>>;
    }
  | {
      e: 'balloonMoved';
      seat: Seat;
      balloon: string;
      from: Seat | 'centre';
      /** BARN cards paid, by suit. Empty for a hand-paid flight and for a free move. */
      spend: Partial<Record<Suit, number>>;
      /**
       * HAND cards discarded to pay for it - Vegetable's alternative route
       * (V4, V8). A COUNT and not the ids, on purpose: a barn payment is already
       * reported as an anonymous tally, and a count is all anything downstream
       * needs. The bots' pricer is the reason this exists at all - without it a
       * hand-paid flight reads as costing nothing, because nothing else in the
       * event stream charges for a card leaving a hand.
       */
      hand: number;
      /** True for a card effect's free move - no cards paid from anywhere. */
      free: boolean;
    }
  /** A face-up discard reclaimed into a barn (the upgraded Vegetable Barn's freight refund). */
  | { e: 'discardToBarn'; seat: Seat; card: CardId }
  /**
   * THE ISLAND'S DEMAND TOKENS CHANGED - the two events nothing in 105 cards
   * could emit before the Vegetable rebuild. Both are fully public: the tokens
   * sit face up (or visibly blank) on the board for everyone to read, so neither
   * is redacted.
   *
   * `crate` is the index into the tile's `crates` array, so a UI can animate the
   * exact token rather than re-diffing the tile.
   */
  | {
      e: 'demandSwapped';
      seat: Seat;
      a: { tile: string; crate: number };
      b: { tile: string; crate: number };
    }
  | { e: 'demandFaceDown'; seat: Seat; tile: string; crate: number }
  /**
   * A card given from one seat to another (the Orchard gift family). Identity
   * travels with it.
   *
   * `fromHand` is the difference between the two shapes of gift, and a bot
   * cannot price them the same. O6 and O9 give a card OUT OF HAND: the giver
   * really is a card down. The divert seam's gift (the rebuilt Farmstead) hands
   * over a card that was already on its way to a discard pile: the giver loses
   * nothing at all, and charging it as a lost card makes the plain discard
   * always look better and the power never fire.
   */
  | { e: 'cardGifted'; from: Seat; to: Seat; card: CardId; fromHand: boolean }
  /** A card sent from its owner's hand into their own barn (O17's £1 divert). */
  | { e: 'handToBarn'; seat: Seat; card: CardId }
  | { e: 'visited'; seat: Seat; host: Seat; mode: 'coin' | 'worker' | 'special' }
  | { e: 'endTriggered'; seat: Seat }
  | { e: 'turnEnded'; seat: Seat; next: Seat }
  | { e: 'gameEnded' };
