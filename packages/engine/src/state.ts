/**
 * The engine's state model, move protocol and event stream, as designed in
 * wayfinder ticket 04 and proven by ticket 05's spanning-set prototype.
 *
 * Everything in here is plain JSON: no classes, no closures, no Dates. A
 * GameState survives structuredClone, JSON round-trips, and being diffed by a
 * human. Card properties are never copied into state; a zone holds card ids and
 * the properties are read from GameData.
 *
 * ⭐ v31 (02/09/2026, docs/design-changes-v31-2026-09-02-v1.md). Read these
 * three before anything else; every other change in the file falls out of them:
 *
 *   1. **There are no coins.** `PlayerState.coins` is deleted, and so is the
 *      `coins` event, the `coins` field on `built` and `delivered`, and every
 *      move that spent money (`buy`, `market`, `upgrade`).
 *   2. **Players hold MEEPLES instead.** `PlayerState.meeples` is a count per
 *      colour, claimed off the island's delivery spaces and spent at the start
 *      of a turn to perform that colour's door action, after which the meeple
 *      leaves the game. It is not a currency: it buys one specific action and
 *      nothing else.
 *   3. **Starters have one face.** `BuildingState.upgraded` is deleted with the
 *      fifteen upgraded faces, and the five Farmstead suit powers went with
 *      them - the Farmstead prints an end-game scorer and nothing else now.
 */

import type { Suit, WorkerAction } from '@gp/data';

import type { BuildMods } from './actions.js';

export type Seat = number;

/** A card's spreadsheet Ref, e.g. "W13". All 105 are unique; the id IS the card. */
export type CardId = string;

/**
 * A built card in a player's tableau. Starters live here too, from setup.
 *
 * ⛔ `upgraded` IS GONE (v31, 02/09/2026). Starters used to flip to a second
 * printed face for GBP 2 and this flag said which side was showing; v31 deletes
 * all fifteen upgraded faces along with the currency that bought them, so every
 * card in the game shows one face for the whole game and there is nothing left
 * for the flag to record. What went with it: `faceOf`'s two-face pick (now a
 * straight card lookup), the `upgrade` move, the `starterUpgraded` event and
 * every `b.upgraded ? x : y` in the suit powers.
 */
export interface BuildingState {
  card: CardId;
  /** Cards paid or sown onto this building, oldest first. Full = length >= threshold. */
  stack: CardId[];
}

export interface PlayerState {
  suit: Suit;
  hand: CardId[];
  /** Stored value. Identity is inert here (views tally by suit) but ids keep card conservation checkable. */
  barn: CardId[];
  /**
   * MEEPLES HELD, BY COLOUR (v31, 02/09/2026) - the component that replaced the
   * currency.
   *
   * A meeple is claimed with an island delivery (it sits face up on the delivery
   * space from setup), and is spent at the START of a later turn to perform its
   * colour's plain door action free, after which it LEAVES THE GAME. So this is
   * a count of stored future actions, not a wallet: nothing refills it but the
   * island, and nothing but spending empties it.
   *
   * A count per colour rather than a list, because meeples of a colour are
   * interchangeable in every way a rule can read. All five colours are always
   * present as keys, including colours no seat is farming - a meeple of a suit
   * that is not at the table still works, because the five door actions exist
   * independently of who farms what.
   */
  meeples: Record<Suit, number>;
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
 * Which seat owns each DOOR. Set at setup from the suit that brought it and
 * NEVER changed: there is no hiring, no expiry and no track since 2026-08-10.
 * `owner: null` means that suit is not at the table, so nobody's Notice Board
 * grants that action.
 *
 * ⚠️ It is ownership of the BOARD, not of a meeple. Anybody may hold and spend a
 * meeple of any colour, including a colour no seat is farming, so a meeple's
 * action is looked up from `workers.roster` and never from here.
 *
 * Derivable from `players[].suit`, and kept anyway: it is the index every "whose
 * board grants action X" lookup wants, and it is one line of setup against a
 * scan in a dozen hot call sites.
 */
export interface WorkerState {
  id: WorkerAction;
  owner: Seat | null;
}

/**
 * One island tile in play. Cost and VP are the same on every tile and live in
 * `island.tileRule` / `island.vpByDeliveryOrder`; the state stores only what
 * setup randomised (the demand tokens and the meeples) and what play has done.
 */
export interface IslandTileState {
  /** Printed face id, e.g. "A1". Its level is layout only - see tileLevel. */
  tile: string;
  /** One demand token per crate, dealt at setup. 'wild' is the cornucopia. */
  crates: (Suit | 'wild')[];
  /**
   * ONE MEEPLE PER DELIVERY SPACE (v31), drawn from a bag of 25 at setup and
   * placed FACE UP - so which colour the first and second deliverer to this tile
   * will take is public from the first turn, and is the whole of the island's
   * new pull.
   *
   * Parallel to `deliveredBy` by INDEX, and deliberately never mutated: entry i
   * is the meeple on delivery space i, so the seat at `deliveredBy[i]` took
   * `meeples[i]`, and spaces from `deliveredBy.length` up are the ones still on
   * the board. That is the same trick `deliveredBy` itself plays with
   * `vpByDeliveryOrder` - one immutable printed schedule plus one growing record
   * of who arrived - and it means the tile still re-derives its whole history
   * rather than storing a second copy of it. `length` is
   * `deliveriesPerTile(data)`.
   */
  meeples: Suit[];
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
 * The two halves of the bonus slot (v31). One per turn by the printed rule;
 * `bonusUsed` records which have gone, so a card that grants a SECOND bonus
 * option (A Helping Hand: "you may take both") gives one of each rather than
 * two of the same.
 */
export type BonusOption = 'draw' | 'visit';

/**
 * Everything scoped to the current turn. Turn end replaces the whole object,
 * so a turn-scoped leak is structurally impossible.
 *
 * ⛔ TWO FIELDS LEFT IN v31 AND BOTH DELETIONS ARE RULE DELETIONS, not tidying:
 *
 *  - `buyUsed` was the once-per-turn card BUY (2026-08-03) - pay the bank, take
 *    the top card of a deck that was not your own suit. It had its own flag
 *    rather than a share of the bonus slot because it was a free action, on the
 *    argument that a coin should never be dead. v31 has no coins, so the whole
 *    argument and the move went (docs/design-changes-v31 §1.3).
 *  - `visit` was the Helping Hand gate: a visit that bought a Service's action
 *    recorded the host and the action so the card could pay a second card to
 *    work it again. The Helping Hand is rewritten as a bonus-slot modifier
 *    (§3.1), and there is no repeat to gate, so the record has no reader. The
 *    thing it used to guard is now `bonusUsed` above.
 */
export interface TurnState {
  actionSpent: boolean;
  /**
   * Bonus options taken this turn, in order. Empty is "the slot is open".
   *
   * ⭐ A LIST, NOT A BOOLEAN, SINCE v31. The printed rule is one option a turn,
   * which a boolean expressed perfectly well; A Helping Hand's rewrite ("Each
   * turn, you may take BOTH bonus options: Draw 1 AND place a card on a Notice
   * Board") is what needs the shape. Two facts have to be checked and a boolean
   * carries only one of them: how many options are left (`bonusSlotsFor`) and
   * whether THIS option has already gone. Without the second, a seat holding a
   * Helping Hand would take Draw 1 twice, which is not what the card says.
   */
  bonusUsed: BonusOption[];
  /**
   * Set when turn end has been committed (explicit endTurn, or nothing left to
   * do): once the queue drains the turn finalises unconditionally. Prevents a
   * standing move from wedging an ending turn open.
   */
  ending: boolean;
  /**
   * ⛔ `again` IS GONE (v31). It was the ActionAgain gate (the reference's state
   * 14): one optional repeat of the main action just taken, armed by `apply`
   * after a qualifying MAIN action and never after a door's, consumed by the
   * repeat move, declined by `endTurn` or by the turn settling.
   *
   * Both producers are dead cards. The upgraded Dairy Farmstead's "BUILD: you
   * may BUILD again" went on 2026-08-10 - it sold a second Build ACTION, the
   * scarcest resource in the game, for GBP 2, and the suit still came last by a
   * distance. The upgraded Wheat Farmstead's "Harvest is 2 buildings" went on
   * 2026-08-12, because Wheat came in first at 50.0% against an even share of
   * 36.4% and a free extra action on the suit's own core verb was the largest
   * single term in it. Both readings are worth keeping: a free repeat of a
   * suit's OWN core verb is the strongest thing a card can print.
   */
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
 * behaviour rides as riders the generic resolver applies, or in the last resort
 * as a `card` task resolved by the card's own handler.
 *
 * ⛔ `chooseWorker` IS GONE (v31). It picked a SERVICE and performed its action,
 * with an `owned: 'rival' | 'own' | 'any'` filter, a `progress` flag for the
 * Herb Hive's off-the-books use and an `ownerCoins` rider for the wage. All
 * three referents are gone: there are no Services, there is no threshold to
 * advance except the Notice Board's own, and there are no coins. It had no
 * producer left in the catalogue when it was deleted, which is why it goes
 * rather than being repointed - a door action is now reached by exactly two
 * routes, a visit and a meeple, and both name a COLOUR rather than choosing a
 * worker.
 */
export type Task =
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
      /**
       * THE END-OF-TURN OVERFLOW DISCARD, down to `rules.turn.handLimit`.
       * `finishTurn` is its only producer, and it is the ONLY enforcement of the
       * hand limit anywhere: a hand may be any size mid-turn, and is checked
       * once, at the boundary.
       *
       * ⭐ Deleted by v31 and reinstated the same day (02/09/2026) when the
       * simulator measured what the deletion actually cost - see
       * `RulesFile.turn.handLimit`. `downTo` is carried on the task rather than
       * re-read at resolution so that a limit changed mid-turn (by a knob reload
       * or, one day, by a card) cannot move the target between push and answer.
       *
       * ⚠️ Its answers are C(hand, excess) subsets, which is the second-widest
       * enumeration in the game after a build payment. That is affordable only
       * because the hand it reads was bounded by the previous turn's pass
       * through the same task.
       */
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
       *
       * ⚠️ TWO RULES ABOUT CARD IDS IN `riders`, both of them the hidden-
       * information boundary and neither of them enforceable by the type:
       *
       *   1. Riders are MASKED for every seat but `pid` (`redactTask`). The bag
       *      is untyped, so the seam masks all of it; do not put an id in here
       *      expecting a rival to read it.
       *   2. An answer may NEVER name a rider's LIMBO card by id. Limbo is a
       *      zone no PlayerView models - a card off a deck top that is in no
       *      hand, no pile and no stack - so an answer naming one puts an id in
       *      the move list that nothing in the view can justify, and the move
       *      list is not redacted (ticket 10). Answer by SLOT instead, via
       *      `revealedIn` / `pickFromReveal` below.
       *
       * Rule 2 binds LIMBO only. An answer naming a card in the seat's own hand
       * (O15) or face up in a discard (D5, D6, O17) names something the view
       * already carries, which is why those enumerators read the way they do.
       */
      t: 'card';
      pid: Seat;
      src: CardId;
      kind: string;
      riders: Record<string, unknown>;
    };

/**
 * An answer to the head task. Shape depends on the task type.
 *
 * ⛔ One kind left v31 and did not come back: `worker` answered `chooseWorker`
 * (see its tombstone above). `discard` went with it and DID come back on
 * 02/09/2026 with the hand limit; it is the answer to the turn-boundary
 * overflow, and names which cards go.
 */
export type TaskAnswer =
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
   * ⛔ `head` / `deckHead` rode on both of these until v31 and are GONE with the
   * card that printed them. They were V2 The Vegetable Farmstead's "you may
   * FIRST put 1 card from your hand (upgraded: 1 card from a deck) into your
   * barn", and they had to be carried on the ANSWER rather than re-derived at
   * resolution: the head is loaded before the payment and was frequently the
   * only reason the payment was affordable, so an answer that dropped it was an
   * answer the barn could not pay. That trap is worth remembering if any future
   * card loads the barn mid-delivery. The five Farmsteads print one line each in
   * v31 and it is an end-game scorer, so there is no head to carry.
   */
  | {
      kind: 'deliver';
      tile: string;
      spend: Partial<Record<Suit, number>>;
    }
  | {
      kind: 'balloon';
      balloon: string;
      spend: Partial<Record<Suit, number>>;
    }
  /** The turn-boundary overflow: exactly `hand.length - downTo` cards, chosen by their holder. */
  | { kind: 'discard'; cards: CardId[] }
  | { kind: 'skip' }
  | { kind: 'card'; payload: Record<string, unknown> };

/**
 * THE ONE RIDER KEY that may hold cards in LIMBO - off a deck top, in no hand,
 * no pile and no stack - and the two functions that read it.
 *
 * One key rather than a convention per card, so `redactTask`'s docblock, this
 * one and the sim's view-safety walk are all describing the same thing. Two
 * cards use it: D10 The Scout's Post ("Reveal the top card of each deck") and
 * D15 The Grand Creamery ("Reveal the top two deck cards"). Both then let the
 * owner CHOOSE one, which is the whole reason limbo needs a vocabulary at all -
 * a reveal nobody chooses from can just resolve and never be asked about.
 *
 * ⭐ THE CHOICE IS BY SLOT, NEVER BY ID, and that is the rule the helpers exist
 * to make convenient. `legalMoves` hands a policy the move list UNREDACTED
 * beside a redacted view (ticket 10: "the Move union is view-safe by
 * construction"), and that claim holds only while every id in a move is one the
 * seat's view also carries. A limbo id is in no view field, so an answer naming
 * one breaks the claim - the move list becomes the side channel, and the move
 * LOG, which is captured, replayed and shared, records the deck order with it.
 * `{ pick: 1 }` says the same thing to the owner (who holds the reveal in their
 * own unmasked copy of the task) and nothing at all to anybody else.
 */
export const REVEAL_RIDER = 'revealed';

/** The cards a card task is holding in limbo. Empty when it holds none. */
export function revealedIn(task: Extract<Task, { t: 'card' }>): CardId[] {
  const held = task.riders[REVEAL_RIDER];
  return Array.isArray(held) ? (held as CardId[]) : [];
}

/**
 * The limbo card a `{ pick }` answer chose. Throws rather than returning null:
 * `apply` has already matched the answer against the enumerator, so an
 * out-of-range slot here means the two disagree, which is a bug and not a move.
 */
export function pickFromReveal(
  task: Extract<Task, { t: 'card' }>,
  answer: Extract<TaskAnswer, { kind: 'card' }>,
): CardId {
  const card = revealedIn(task)[answer.payload['pick'] as number];
  if (card === undefined) {
    throw new Error(`${task.src}/${task.kind}: no revealed card in slot ${answer.payload['pick']}`);
  }
  return card;
}

/**
 * Where control returns when the task queue drains. 'bonus' was called 'worker'
 * until v31, when the Services it named stopped existing; it covers both halves
 * of the bonus slot and the meeple phase, all of which resume the same way.
 */
export type Resume = 'main' | 'bonus' | 'turnflow';

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
  /** The plain Draw action: `rules.turn.baseDraw`, see 2 keep 2. Deck picks are the draw task's answers. */
  | { type: 'draw'; seat: Seat }
  /**
   * THE SOLITAIRE HALF OF THE BONUS SLOT (v31): Draw `rules.turn.bonusDraw` off
   * the top of any ONE deck in play. A real Draw - it pushes the same see/keep
   * task, so the deck pick is the task's answer and `afterDrawKeep` fires -
   * which is why it carries no `suit` of its own.
   *
   * It exists so the bonus slot is never dead: a seat with an empty hand has no
   * card to place on a Notice Board and would otherwise skip the slot entirely.
   * It is also the yardstick every door has to beat, which is the whole reason
   * the Orchard door is Draw 3 rather than Draw 2.
   *
   * ⛔ It replaces THREE deleted coin sinks that used to sit in or beside this
   * slot: `buy` (blind top card of a deck that was not your own suit, a free
   * action once a turn), `market` (top card of any deck straight into your barn,
   * a bonus option) and `upgrade` (flip a starter for GBP 2, a bonus option
   * since 19/08/2026). All three were bought with coins, and the standing
   * finding they died on is worth keeping: money is what buys SOLITAIRE in this
   * game, because a visit is bought with a card and every other bonus option was
   * bought with a coin, so a coin sink in the bonus slot crowds the visit out
   * all game. v31 deletes the currency, which deletes the competitor.
   */
  | { type: 'bonusDraw'; seat: Seat }
  /**
   * SPEND ONE MEEPLE (v31): perform its colour's plain door action, free, and
   * the meeple LEAVES THE GAME - it returns to no pool and cannot be re-earned
   * except off the island.
   *
   * Legal only at the very start of a turn: before the bonus option and before
   * the core action. Any number may be spent, one at a time, and a meeple may
   * never be held back and spent later in the same turn - which is the only
   * thing stopping the supply from being a hand of free reactive actions.
   */
  | { type: 'spendMeeple'; seat: Seat; colour: Suit }
  /** Build a card from hand. `payment` is the chosen card ids - since v31 a build costs cards and nothing else. */
  | { type: 'build'; seat: Seat; card: CardId; payment: CardId[] }
  | { type: 'grow'; seat: Seat; building: CardId; payment: CardId }
  | { type: 'harvest'; seat: Seat; building: CardId }
  /** Deliver from barn to an island tile. `spend` is a per-suit map - barn identity is inert. */
  | {
      type: 'deliver';
      seat: Seat;
      tile: string;
      spend: Partial<Record<Suit, number>>;
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
    }
  /**
   * THE INTERACTION HALF OF THE BONUS SLOT (v31): place exactly ONE card from
   * your hand on any Notice Board, then immediately perform that board's suit
   * action. The board must not be clogged.
   *
   * ⭐ THE MODE DISCRIMINATOR IS GONE, AND THAT IS THE CHANGE. It used to pick
   * which of the host's two rival-touchable buildings the fee landed on - the
   * Notice Board paid the VISITOR coins, the Service granted its action and paid
   * the HOST a wage - with a third `special` mode for the upgraded board's "2
   * cards, take GBP 3". Change 6 (20/08/2026) merged the two buildings into one;
   * v31 deletes the coins, so the board has one payoff and the visit has one
   * shape: one card in, one action out, and `fee` is a single id rather than a
   * list because no route places two.
   *
   * ⭐ `host` MAY BE THE VISITOR'S OWN SEAT, gated by
   * `rules.turn.selfVisitAllowed`, and that is risk 2 of the whole pass, armed
   * on purpose. It replaces the old `workOwnWorker` move (activate your own
   * Service, paid to the bank, placing no card): the owner now places a card on
   * their own board exactly as a rival does, so the only brake on self-visiting
   * is structural - your own card counts toward your own threshold of 2, so
   * feeding your board clogs it in two turns and shuts your own door.
   * `a08-the-hook` must count self-visits SEPARATELY, which is what the
   * `visited` event's `self` flag is for.
   */
  | {
      type: 'visit';
      seat: Seat;
      host: Seat;
      fee: CardId;
    }
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
} satisfies Record<MoveType, true>;

export const MOVE_TYPES = Object.keys(MOVE_TYPE_KEYS) as readonly MoveType[];

/**
 * One truth-level stream; redactEvents masks per seat. Feeds UI animation and
 * sim metrics alike.
 *
 * ⛔ `coins` IS GONE (v31) and it was the busiest event in the game. Every
 * narrator, every bot pricing term and every sim assertion that read a coin
 * delta now reads `meepleGained` / `meepleSpent` instead - which is not a
 * rename: coins were fungible and continuous, meeples are five discrete
 * colours, each worth exactly one specific action, and they leave the game when
 * used. A metric that averages them is measuring nothing.
 */
export type GameEvent =
  | { e: 'cardPlaced'; seat: Seat; onto: { seat: Seat; building: CardId }; card: CardId }
  | { e: 'cardsToHand'; seat: Seat; cards: CardId[] }
  | { e: 'cardsDiscarded'; suit: Suit; cards: CardId[] }
  | { e: 'deckToBarn'; seat: Seat; suit: Suit; card: CardId }
  /** One card lifted from a building's stack into its owner's barn (W14) - NOT a harvest, no on-harvest passives. */
  | { e: 'stackToBarn'; seat: Seat; building: CardId; card: CardId }
  | { e: 'harvested'; seat: Seat; building: CardId; cards: CardId[] }
  /**
   * A DOOR ACTION RAN. `colour` is whose door it is (which is also what a meeple
   * of that colour does), `action` is what it did, and `via` is what paid for
   * it - a card on a Notice Board, or a meeple leaving the game.
   *
   * Replaces `workerWorked`, whose `owner` and `free` fields described the old
   * Service economy: `owner` was who collected the wage and `free` marked the
   * Herb Hive's off-the-books use that advanced no track. There are no wages, no
   * tracks and no off-the-books uses in v31, so both fields would have been
   * constants. Whose farm was used is on `visited` instead, where it belongs.
   */
  | { e: 'doorUsed'; seat: Seat; colour: Suit; action: WorkerAction; via: 'visit' | 'meeple' }
  /**
   * A MEEPLE WAS CLAIMED off an island delivery space and is now in a player's
   * supply. `space` is the index into the tile's `meeples`, so a UI can animate
   * the exact one and a metric can tell the 6 VP space from the 3 VP one.
   */
  /**
   * ⚠️ `tile` and `space` ARE NULLABLE SINCE 03/09/2026. Until the
   * `meepleFromBag` balloon there was exactly one way to gain a meeple - taking
   * it off an island delivery space - and the event could name that space
   * unconditionally. A balloon meeple comes from a bag and from no space, so the
   * two fields say null rather than lying about a tile.
   */
  | { e: 'meepleGained'; seat: Seat; colour: Suit; tile: string | null; space: number | null }
  /**
   * A MEEPLE WAS SPENT and has LEFT THE GAME. It goes back to no pool - there is
   * no supply to return it to - so `meepleGained` minus `meepleSpent` over a
   * whole game is exactly the meeples that died unspent in players' supplies,
   * which is the dead-component number the v31 plan asks the sim to watch.
   */
  | { e: 'meepleSpent'; seat: Seat; colour: Suit; action: WorkerAction }
  | { e: 'reshuffled'; suit: Suit; count: number }
  | { e: 'built'; seat: Seat; card: CardId; payment: CardId[] }
  /**
   * An empty building demolished by D14 The Cream Refinery. It goes to its own
   * suit's DISCARD, not to the barn - Dean's ruling of 19/08/2026 - so it is
   * neither a building nor freight afterwards. The `covered` event that used to
   * sit beside this one is gone with D11's build-on-top (19/08/2026).
   */
  | { e: 'demolished'; seat: Seat; card: CardId }
  /**
   * ⛔ `starterUpgraded` IS GONE (v31): starters have one face and nothing
   * flips. It fired when a seat paid GBP 2 to turn a Barn, Farmstead or Notice
   * Board over, and the last thing it recorded that no other event did was the
   * moment a suit power doubled. There are no suit powers on the starters now -
   * the Farmstead prints an end-game scorer and nothing else - so nothing is
   * listening for that moment.
   */
  | {
      e: 'delivered';
      seat: Seat;
      tile: string;
      /** The receipt taken: 6 for arriving first at this tile, 3 for second. */
      vp: number;
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
  /**
   * A card was placed on a Notice Board and its door action taken.
   *
   * ⭐ `self` IS THE NUMBER THE WHOLE v31 PASS TURNS ON. Self-visiting is a
   * solitaire door bought with the same currency as the interaction door, and
   * every previous version of this game has had the solitaire option crowd the
   * visit out when the two competed for one slot. `a08-the-hook` must count
   * these SEPARATELY and must never credit a self-visit as interaction, or the
   * assertion will report a healthy hook while the table plays solitaire. It is
   * a flag on the event rather than a `seat === host` check at every reader
   * precisely so that nobody can forget to make the distinction.
   */
  | { e: 'visited'; seat: Seat; host: Seat; self: boolean; colour: Suit; action: WorkerAction }
  | { e: 'endTriggered'; seat: Seat }
  | { e: 'turnEnded'; seat: Seat; next: Seat }
  | { e: 'gameEnded' };
