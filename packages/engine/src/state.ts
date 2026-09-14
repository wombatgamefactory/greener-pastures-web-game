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

import type { DoorAction, Suit, WorkerAction } from '@gp/data';

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

/**
 * A Notice Board under the meeple-loop arm: five colour-keyed slots and nothing
 * else. Not a building - no threshold, no card stack, no sow onto it, no harvest
 * of it (R5) - and every colour is always a key, including colours no seat is
 * farming, because the five actions exist independently of who farms what.
 */
export interface NoticeBoardState {
  slots: Record<Suit, Suit[]>;
}

/**
 * What a DOOR buys, re-exported from the data package so the engine's events and
 * hooks name the same type the roster does: the five printed door actions plus
 * GROW, which an afterAction meeple and the Dairy board's follow-up buy.
 *
 * ⚠️ `grow` IS NOT A `WorkerAction`, deliberately - see the type's own note in
 * `@gp/data`. Under the `'card'` and `'meeple'` controls a door action is
 * exactly a `WorkerAction`.
 */
export type { DoorAction };

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
  /**
   * ⭐ THE FIVE COLOUR SLOTS OF THIS SEAT'S NOTICE BOARD - THE MEEPLE-LOOP ARM
   * ONLY (`rules.turn.visitCurrency: 'meeple'`, Dean 04/09/2026, rules R5/R6).
   *
   * ⚠️ ABSENT UNDER THE SHIPPED `'card'` GAME, and the absence is deliberate
   * rather than lazy typing. `'card'` is the control arm and has to stay
   * bit-reproducible against 03/09/2026 - a key present-and-empty would change
   * every serialised state, every capture and every replay comparison for a
   * field that game has no concept of. `noticeBoardSlots` in query.ts is the one
   * accessor and it throws if the arm is on and this is missing, so the
   * optionality never reaches a rule.
   *
   * A LIST PER SLOT, not a count and not a single meeple, because the wild spend
   * (R10) puts TWO meeples of other colours into the slot of the colour they
   * bought. Blocked is `slots[colour].length > 0`; the host takes the whole
   * slot back on their Collect, cap and all.
   */
  noticeBoard?: NoticeBoardState;
  /**
   * ⭐ COINS HELD - THE COMMONS-WITH-COINS ARM ONLY (K7, Dean 10/09/2026,
   * `docs/commons-coins-handoff-2026-09-10-v2.md`), and since 12/09/2026 the
   * Village Store.
   *
   * ⚠️ ABSENT UNDER THE SHIPPED GAME, and the absence is the same deliberate
   * register `noticeBoard` above is written in: a key
   * present-and-zero would change every serialised state, every capture and
   * every fixture replay for a currency the shipped game has no concept of. Six
   * of the nine fixtures in `packages/sim/fixtures/` replay byte-identically and
   * depend on it. `coinsOf` in query.ts is the one accessor and it THROWS when
   * the arm is on and this is missing, so the optionality never reaches a rule.
   *
   * ⛔ EXACTLY ONE MINT AND EXACTLY TWO SINKS, which is the whole of the
   * economy and the reason it is written down here rather than only in the
   * knob's description. The mint is clearing a central pile (K3/K8: one coin
   * per card, the cards to their own suits' discards). The sinks are the
   * Farmstead's coin-activated suit power (K10-K12) and the Endgame cards'
   * price (K15). Coins score nothing, break no ties, buy no ordinary card and
   * are minted by nothing but a pile; leftover coins are dead. Every earlier
   * coin economy in this project died of a second faucet or a pity rate, so a
   * future session adding a third use or a second mint is repeating that
   * failure rather than tuning this one.
   *
   * A plain integer, not the v31 wallet: `startingCoins`, the bank, the wage,
   * the GBP 5 = 1 VP pity rate, the coin tie-break and the market all went with
   * the currency on 02/09/2026 and none of them comes back with it.
   */
  coins?: number;
  /**
   * ⭐ HAS THIS SEAT ALREADY BEEN PAID A HOST DRAW SINCE ITS OWN LAST TURN -
   * THE HOST-DRAW CAP ONLY (`rules.turn.hostDrawCapPerRound`, 11/09/2026).
   *
   * ⚠️ **ABSENT UNLESS THE CAP IS ON**, and the absence is the same deliberate
   * register `noticeBoard` and `coins` above are written in: a key
   * present-and-false would change every serialised state, every capture and
   * every fixture replay for a rule the shipped game has no concept of, and six
   * of the nine fixtures in `packages/sim/fixtures/` replay byte-identically and
   * depend on that.
   *
   * ⛔ **IT LIVES ON THE SEAT AND NOT ON `TurnState`, AND THAT IS THE WHOLE
   * MECHANISM.** The quantity being capped is "once between the HOST's own
   * turns", so the latch has to survive every OTHER seat's turn and reset only
   * when this seat's turn begins - and `turn` is replaced wholesale by
   * `freshTurn()` at every turn boundary. A latch on `turn.firedThisTurn` would
   * cap the VISITOR's turn instead, which bites only when one visitor sends two
   * visits to one host in a single turn (two seats alone, via A Helping Hand)
   * and would leave four seats, the only breaching seat count, untouched.
   *
   * `hostDrewThisRound` in query.ts is the one accessor and it throws when the
   * cap is on and this is missing, so the optionality never reaches a rule.
   */
  hostDrewThisRound?: boolean;
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
   *
   * ⚠️ 14/09/2026: "THE ORDER IS THE PAYMENT" HOLDS ONLY WITHOUT THE SPACE
   * CHOICE. Under `rules.turn.deliverySpaceChoice` this is still the seats IN
   * ARRIVAL ORDER and its length is still the delivery count, but which space
   * (and so which VP and which meeple) each arrival took is `deliveredSpaces`.
   * Ask `deliverySpacesTaken(tile)` in `@gp/data`, never index this list.
   */
  deliveredBy: Seat[];
  /**
   * ⭐ THE SPACE EACH RECEIPT TOOK (Dean, ruled 14/09/2026), parallel to
   * `deliveredBy` by index: the seat at `deliveredBy[i]` took delivery space
   * `deliveredSpaces[i]`, so the 6 VP space is held by the seat whose entry
   * here is 0.
   *
   * ⛔ ABSENT UNLESS `rules.turn.deliverySpaceChoice` IS ON, and absent rather
   * than present-and-empty, because a key added to every tile would change
   * every serialised state and every fixture under the old rules. Without it
   * the i-th arrival took space i, which is what `deliverySpacesTaken` answers.
   */
  deliveredSpaces?: number[];
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
 * The halves of the bonus slot. Two under the shipped `'card'` game (`draw` and
 * `visit`) and two under the meeple-loop arm (`visit` and `collect`); `draw`
 * never appears under the arm and `collect` never under the default, so the
 * union is three values and a turn still spends one of them.
 *
 * One per turn by the printed rule;
 * `bonusUsed` records which have gone, so a card that grants a SECOND bonus
 * option (A Helping Hand: "you may take both") gives one of each rather than
 * two of the same.
 */
export type BonusOption = 'draw' | 'visit' | 'collect';

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
  /**
   * ⭐ THE MEEPLES SPENT THIS TURN, IN ORDER (M5 and C112, Dean 12/09/2026,
   * A151). The colours are what is stored, because two rules read this list and
   * they read different things: `meepleSpendPerTurn` reads `.length` (Dean's
   * "one per turn") and `meepleSpendDistinctColours` reads membership (C112's
   * "no two of the same colour"), and a bare counter cannot answer the second.
   *
   * ⛔ **ABSENT UNLESS ONE OF THOSE TWO RULES IS ON**, and the absence is the
   * same deliberate register `PlayerState.coins` and `PlayerState.hostDrewThisRound`
   * are written in: a key present-and-empty would change
   * every serialised state and every view for a rule the shipped game and all
   * three named controls have no concept of, and nine fixtures in
   * `packages/sim/fixtures/` replay byte-identically. `meepleSpendRationed` in
   * actions.ts is the one predicate that decides whether it is written, and
   * every reader takes `?? []`, so the optionality never reaches a rule.
   *
   * ⚠️ IT LIVES ON `TurnState` AND NOT ON THE SEAT, which is the OPPOSITE of
   * `hostDrewThisRound` and for the opposite reason: the quantity capped is "in
   * ONE TURN", and `freshTurn()` replacing the whole object at every boundary is
   * exactly the reset this rule wants. A latch on the seat would have to be
   * cleared by hand and would cap the wrong window.
   */
  meeplesSpent?: Suit[];
}

/**
 * ⭐ RECORD THAT A CARD'S PRINTED TEXT HAS FIRED THIS TURN - the write half of
 * the recursion guard above, and THE ONE IMPLEMENTATION of it.
 *
 * It lives here, on the leaf module that declares `TurnState`, since 10/09/2026
 * and for one reason: the notice-board visit's ONE-USE-PER-BOARD latch (S9) is
 * written from `actions.ts`, and `runtime.ts` - where `markFired` has always
 * lived - imports `actions.ts`, so `actions.ts` may not import it back.
 * `runtime.ts` still exports `markFired(fx, building)` and every handler still
 * calls that; it is now a one-line delegate to this, so there is still exactly
 * one place the dedupe happens.
 */
export function markFiredOnTurn(turn: TurnState, card: CardId): void {
  if (!turn.firedThisTurn.includes(card)) turn.firedThisTurn.push(card);
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
      /**
       * ⭐ S17, THE HOST DRAW (Dean, 11/09/2026): this draw is the payment the
       * OWNER of a visited Notice Board takes for being visited, and the field
       * exists so that the cards can be counted apart from every other card
       * that reaches a hand. It rides to the `cardsToHand` event through
       * `resolveTask`, which is the only thing that reads it.
       *
       * ⚠️ IT IS A LABEL AND NEVER A BEHAVIOUR. Nothing in `taskAnswers` or
       * `resolveTask` branches on it: a host draw is a plain see-N/keep-N draw
       * with the seat's own choice of deck, exactly as `rules.turn.baseDraw`
       * and every card ability's draw are, which is the whole of Dean's "no
       * rules exceptions" ruling on which deck a host draws from. Absent on
       * every other draw in the game, so the field is purely additive and the
       * event it feeds is unchanged for every producer but this one.
       *
       * ⭐ `'closingDraw'` (Dean, ruled 14/09/2026) is the second label, on the
       * same terms: the draw a seat takes for filling a tile's last delivery
       * space, one card per crate. Its named decks arrive pre-revealed and a
       * cornucopia is a deck pick, which is the ordinary draw task's ordinary
       * behaviour; the label only lets the cards be counted.
       */
      via?: 'hostDraw' | 'closingDraw';
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
      /**
       * ⭐ A FULL GROW ACTION MID-EFFECT - the Dairy board's follow-up Grow and
       * the afterAction apiary meeple (M7).
       *
       * Answers come from the same enumerator as the Grow move (`growOptions`),
       * so a door-bought Grow targets exactly what a played Grow targets: your
       * own non-full building with a printed activation type, paid with one
       * matching card from your hand, never the Notice Board, never a card whose
       * text has already fired this turn.
       *
       * ⚠️ CARD PAYMENTS ONLY. `growOptions` also enumerates meeple-paid Grows
       * (R15) and those carry placement riders that would have to ride on the
       * answer; the enumerator here takes the card-paid options and the rider
       * never has to exist. If a mode
       * ever pushes this task with `meepleAsCard` live, that is the line to
       * revisit - see the `build` answer's note on riders that must not be
       * dropped.
       */
      t: 'grow';
      pid: Seat;
      src: CardId | null;
      /** "You may GROW": a skip answer is offered. Nothing passes it today. */
      optional?: boolean;
      /** Dean's Dairy experiment (12/09/2026): the only legal target. */
      target?: CardId;
      /** Dean's Dairy experiment, 'paidWild': the activation card may be any crop. */
      wildActivation?: boolean;
      /**
       * ⭐ DEAN'S APIARY RETEXT (14/09/2026, `noticeBoardPower.apiaryPower`):
       * *"Grow a building using the top card of any deck."* The activation card
       * comes off the top of a deck in play and never out of the hand, so every
       * answer names a DECK and `payment` is null. 'match' keeps the printed
       * Grow rule (the deck's crop must pay the activation cost); 'wild' lets
       * any deck pay. Coin payments are not offered: the power names the deck.
       */
      fromDeck?: 'match' | 'wild';
    }
  | {
      /** A full Build action mid-effect (the Build Worker). Answers come from the same enumerator as the Build move. */
      t: 'build';
      pid: Seat;
      src: CardId | null;
      /**
       * ⭐ DEAN'S DAIRY EXPERIMENT (12/09/2026): what happens immediately after
       * this Build resolves. Absent under every shipped rule.
       */
      thenGrow?: 'paid' | 'paidWild' | 'free';
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
       * ⭐ THE VILLAGE STORE'S EXCHANGE (V1, Dean 12/09/2026, ledger A150):
       * *"when you make a delivery you may spend any number of ADDITIONAL cards
       * FROM YOUR BARN, taking £1 each"*.
       *
       * ⛔ **IT IS A REPEATED BINARY CHOICE AND IT MUST NEVER BECOME A SUBSET
       * ENUMERATION.** "Any number of cards from your barn" is the POWER SET of
       * the barn: an 11-card barn is 2,048 conversions offered in ONE task, at
       * EVERY delivery, which is the end-of-turn discard's C(n, k) failure
       * arriving through a new door. This project has been stopped dead twice by
       * exactly that - a 116,535-move position on 02/09/2026 and an 888,030-move
       * one on 05/09/2026 - so the task offers "convert ONE more, or stop" and is
       * re-offered while `remaining` holds. n sequential decisions instead of
       * 2^n, and it costs NOTHING in expressiveness: every subset is reachable,
       * by a different route.
       *
       * ⭐ **AND THE ANSWER NAMES A SUIT, NOT A CARD, WHICH IS THE SECOND HALF
       * OF THE BOUND.** Barn identity is inert - `fx.spendFromBarn` says so in
       * code, taking "the first matching id" for a per-suit tally - so two
       * wheat cards in a barn differ in nothing a rule or a player can read.
       * Answering by suit is the same reduction `stackGroupsOf` makes for a
       * build payment, and it caps the answer list at **FIVE SUITS PLUS ONE
       * SKIP, six, whatever the barn holds**. That bound is asserted by test.
       *
       * `remaining` is min(barn size, coins left in the supply) at the moment
       * the task is pushed, and it is re-bounded at every answer: V5's supply is
       * shared and finite, and D4 says an empty supply mid-conversion STOPS
       * rather than refusing the whole exchange.
       *
       * ⚠️ ALWAYS OPTIONAL, so no `optional` flag: D3 says declining is
       * EXPLICIT, so a `skip` is offered whenever anything is, and the turn
       * settles cleanly on it.
       *
       * ⛔ PUSHED FROM `finishDelivery` AND ONLY FROM THERE, which is V3: the
       * exchange resolves AFTER the crate is paid, so a player can never convert
       * the cards the delivery itself needs. That placement is also D2 for free -
       * every delivery reaches that tail, including one bought by a Notice Board
       * power - and it keeps the balloon's freight move out, which is a Deliver
       * ACTION but not a delivery.
       */
      t: 'mint';
      pid: Seat;
      remaining: number;
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
  /**
   * The `grow` task's answer: which of your buildings to activate, and the card
   * out of your hand that pays for it.
   *
   * Deliberately NOT `kind: 'building'` (which `chooseBuilding` reads as a
   * harvest) and not `kind: 'activate'` (which fires without placing): the
   * answer names two things and a different act, so it gets its own kind, on
   * exactly the reasoning written on `activate` just above.
   */
  /**
   * ⚠️ `payment` WENT NULLABLE ON 12/09/2026 (V8, A150). A bought Grow may
   * now be paid with ONE VILLAGE STORE COIN instead of a card, in which case
   * `payment` is null and `coinGrow` is set: nothing is placed, the stack does
   * not advance, and a FULL building is a legal target under
   * `rules.economy.coinGrowOnFullBuilding`. Every other answer of this kind is
   * unchanged, so a Store-off answer is byte-identical.
   *
   * ⭐ WHY A BOUGHT GROW GETS THE SINK AT ALL: V8 says a coin is a wild card
   * for GROW, and the Apiary board's bought Grow is a Grow. Coins still cannot
   * multiply ACTIONS - the standing fire-once-per-turn guard means two
   * coin-Grows a turn is the ceiling and never the same building twice.
   */
  | {
      kind: 'grow';
      building: CardId;
      payment: CardId | null;
      coinGrow?: true;
      /**
       * The Apiary retext's Grow (14/09/2026): the activation card is the top
       * of THIS deck. `payment` is null and `coinGrow` absent.
       */
      deckSuit?: Suit;
    }
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
      /** R17: where the paid meeples land, by seat, and the toll they owed. */
      placements?: Partial<Record<Suit, number>>[];
      paymentToll?: Partial<Record<Suit, number>>;
      /**
       * ⚠️ R15: meeples in the payment, as a count per colour, AND THEY
       * HAVE TO RIDE ON THE ANSWER. The same trap the deleted `head` rider
       * carried: an answer that dropped them is an answer that cannot pay, and
       * `doBuild` throws "costs N cards, got N-1" a long way from the seam that
       * lost them. Every route into a build - the action, the cream door, D7,
       * D10 - has to carry both fields or none.
       */
      meeples?: Partial<Record<Suit, number>>;
      wildPairs?: number;
      /**
       * ⭐ V6 (A150, 12/09/2026): coins in the payment, as a COUNT. It rides
       * on the answer for exactly the reason `meeples` does above - an answer
       * that dropped it is an answer that cannot pay, and `doBuild` throws
       * "costs N cards, got N-j" a long way from the seam that lost it. Every
       * route into a build has to carry it or none.
       */
      coins?: number;
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
      /** R15: the part of `spend` paid out of the supply. Rides for the same reason. */
      meeples?: Partial<Record<Suit, number>>;
      /** R17: where that share lands, by seat, and the toll it owed. */
      placements?: Partial<Record<Suit, number>>[];
      paymentToll?: Partial<Record<Suit, number>>;
      /**
       * The delivery space taken (Dean, 14/09/2026). Present only under
       * `rules.turn.deliverySpaceChoice`; absent is fill order.
       */
      space?: number;
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
  /**
   * ⭐ THE VILLAGE STORE'S SHARED COIN SUPPLY (V4, Dean 12/09/2026, ledger
   * A150): how many coins are still IN THE SUPPLY, waiting to be minted.
   *
   * `rules.economy.coinSupplyPerPlayer` x seats at setup - 10 at two seats and
   * 20 at four - SHARED across the table with NO per-player holding cap, so one
   * player may hold every one of them. Spent coins RETURN here and may be
   * minted again (V5), which makes this a recirculating pool rather than a
   * countdown: the sum of this and every seat's `PlayerState.coins` is
   * invariant for the whole game, and that identity is what the tests assert.
   * An empty supply mints nothing.
   *
   * ⚠️ **ABSENT UNLESS THE STORE IS ON**, in exactly the register
   * `PlayerState.coins` is written in: a key present-and-zero would
   * change every serialised state, every capture and every fixture replay for a
   * rule the shipped game has no concept of, and NINE fixtures in
   * `packages/sim/fixtures/` replay byte-identically and depend on the absence.
   * `coinSupplyLeft` in query.ts is the one accessor and it THROWS when the
   * Store is on and this is missing, so the optionality never reaches a rule.
   *
   * ⛔ IT IS NOT THE v31 BANK. There is no wage, no pity rate, no market and
   * no purchase from it: the ONE way a coin leaves this pool is V1's exchange at
   * a delivery, and the only two ways one comes back are the Build and Grow
   * sinks. Every coin economy this project has had died of a second faucet, so
   * a future session adding a second producer here is repeating that failure
   * rather than tuning this one.
   */
  coinSupply?: number;
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
  /**
   * Build a card from hand. `payment` is the chosen card ids - since v31 a build
   * costs cards and nothing else.
   *
   * ⭐ UNDER R15 (`rules.turn.meepleAsCard`) IT ALSO COSTS MEEPLES, and they
   * ride in a SEPARATE field as a COUNT PER COLOUR rather than in `payment`.
   * That separation is not tidiness, it is the performance rule the whole change
   * is gated on: meeples of a colour are interchangeable, so a payment is
   * decided by HOW MANY of each colour it spends and never by which, and putting
   * them in `payment` would drag them into `subsets()` and multiply the build
   * enumeration by every way of choosing identical tokens. See `meepleFills` in
   * actions.ts.
   *
   * `wildPairs` is how many of those meeples are spent two-as-one to fill the
   * built card's OWN-SUIT requirement (R10). It is a count and not a list for
   * the same reason, and it is always the minimum the cost needs.
   */
  | {
      type: 'build';
      seat: Seat;
      card: CardId;
      payment: CardId[];
      meeples?: Partial<Record<Suit, number>>;
      wildPairs?: number;
      /**
       * ⭐ V6 (A150, Dean 12/09/2026): coins in the payment, as a COUNT and
       * never a choice of which coins. Absent when none, so a Store-off move is
       * byte-identical. See `BuildOption.coins` in actions.ts for the branching
       * argument, which is the whole reason it is a number.
       */
      coins?: number;
    }
  /**
   * GROW: activate one of your own buildings, paying one card that matches its
   * activation cost into its stack.
   *
   * ⭐ UNDER R15 THE PAYMENT MAY BE A MEEPLE INSTEAD, AND THEN IT IS NOT A
   * PLACEMENT AT ALL (Dean, 04/09/2026 evening). `payment` is null and `meeples`
   * carries one meeple of the matching colour, or TWO of any colours spent as a
   * wild pair (R10). The meeple goes straight to the box: it never joins the
   * stack, never counts toward the threshold, and fires no `afterPlacement`.
   *
   * ⭐ SO A MEEPLE CAN ACTIVATE A BUILDING THAT IS ALREADY FULL. Nothing is
   * being placed, so the only reason a full building cannot be grown does not
   * apply. That is a PRICED CLOG BYPASS and it is deliberate. `atThreshold` on
   * the `meepleAsCard` event is how often it happens.
   */
  /**
   * ⭐ AND UNDER K10 THE PAYMENT MAY BE A COIN (Dean, 10/09/2026,
   * `rules.economy.farmsteadCoinPower`). `coin` is set, `payment` is null and
   * `meeples` is absent: the target is the seat's own FARMSTEAD, whose
   * activation cost is one coin, nothing is placed on it, and the suit power
   * on its face fires through the ordinary `activate` hook.
   *
   * ⛔ IT IS A MAIN-ACTION GROW AND ONLY A MAIN-ACTION GROW (builder default
   * D-C1, ruled 10/09/2026). The Apiary board's BOUGHT Grow pushes a `grow`
   * task, and that task's enumerator asks `growOptions` without
   * `mods.mainAction`, so the Farmstead is never among its answers: a bonus
   * may not buy a suit power.
   */
  | {
      type: 'grow';
      seat: Seat;
      building: CardId;
      payment: CardId | null;
      meeples?: Suit[];
      /** K10: this GROW is paid with ONE COIN and places nothing. */
      coin?: true;
      /**
       * ⭐ V8/V9 (A150, Dean 12/09/2026): this GROW is paid with ONE VILLAGE
       * STORE COIN, on ANY of the seat's buildings with an activation type, and
       * PLACES NOTHING - so the stack does not advance, the building never
       * clogs, and a FULL building is a legal target under
       * `rules.economy.coinGrowOnFullBuilding`. ⛔ NOT `coin` above, which is
       * K10's Farmstead power on the other coin arm: `observe.ts` counts
       * `move.coin === true` as a Farmstead firing, so merging them would put
       * every coin-Grow into a metric that means something else.
       */
      coinGrow?: true;
      /** R17: where the paid meeple(s) land, by seat, and the toll they owed. */
      placements?: Partial<Record<Suit, number>>[];
      paymentToll?: Partial<Record<Suit, number>>;
    }
  | { type: 'harvest'; seat: Seat; building: CardId }
  /**
   * Deliver from barn to an island tile. `spend` is a per-suit map - barn
   * identity is inert.
   *
   * ⭐ UNDER R15 `meeples` is the part of `spend` paid out of the SUPPLY
   * rather than the barn, per colour, and it is a subset of `spend` colour by
   * colour. It is boxed, never barned and never discarded.
   *
   * ⭐ NO WILD PAIR IS MODELLED HERE AND THAT IS NOT AN OMISSION. The island
   * already carries its own substitution at exactly the same rate - "any single
   * card it asks for may instead be paid with 2 cards of any crops" - so two
   * meeples paying one named crop is already reachable through
   * `cardsPerSubstitution`, and adding R10 beside it would be a second rate on
   * the same payment.
   */
  | {
      type: 'deliver';
      seat: Seat;
      tile: string;
      spend: Partial<Record<Suit, number>>;
      meeples?: Partial<Record<Suit, number>>;
      /** R17: where the crate's meeple share lands, and the toll it owed. */
      placements?: Partial<Record<Suit, number>>[];
      paymentToll?: Partial<Record<Suit, number>>;
      /**
       * ⭐ WHICH DELIVERY SPACE THIS RECEIPT TAKES (Dean, ruled 14/09/2026):
       * 0 is the 6 VP space, 1 the 3 VP space carrying the delivery meeple.
       * Present on every enumerated move under `rules.turn.deliverySpaceChoice`
       * and absent under fill order; `apply` rejects a space already taken.
       */
      space?: number;
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
      /**
       * The card placed on the host's board - the `'card'` game's whole
       * currency, and NULL under the meeple-loop arm, where no card is ever
       * placed on a board and none leaves the hand (R1).
       */
      fee: CardId | null;
      /**
       * ⭐ WHICH OF THE HOST'S NOTICE BOARDS THE FEE LANDS ON, and therefore
       * WHICH POWER IS BOUGHT (Dean's two-board fix, ruled 11/09/2026,
       * `rules.economy.noticeBoardsBySeats`). At two seats a host lays out
       * TWO - its own suit's board, plus one drawn at random from the suits
       * nobody is farming - so `host` alone stopped being enough information to
       * resolve the move.
       *
       * ⛔ PRESENT ONLY WHEN THE HOST HOLDS MORE THAN ONE, WHICH IS THE WHOLE
       * REASON IT IS OPTIONAL RATHER THAN REQUIRED. An absent key is what keeps
       * this arm's three-seat and four-seat games byte-identical to
       * `overlays/notice-board-visit-no-self-v1.overlay.json` on identical
       * seeds - the claim the whole variant is read through - and what keeps
       * every fixture in `packages/sim/fixtures/` replaying unchanged. It is
       * the same rule `fee2`, `coin` and `noticeBoard?` follow, and it means a
       * reader that has never heard of the fix reads `host` and is right about
       * every game but this one.
       *
       * ⚠️ `doNoticeBoardVisit` THROWS rather than defaulting when a host with
       * two boards is not given one: defaulting would put the fee on the wrong
       * building while the payoff still looked correct.
       */
      board?: CardId;
      /**
       * MEEPLE ARM ONLY: the meeples leaving the visitor's supply. One for a
       * plain visit; TWO for the wild spend (R10), which is why this is a list
       * and not a colour. Both land in the slot of `colour`, and the host takes
       * both back on their Collect.
       */
      meeples?: Suit[];
      /**
       * MEEPLE ARM ONLY: the SLOT bought, which is the door taken. Equal to the
       * single meeple's colour for a plain visit and to something neither meeple
       * is for a wild pair - under the cap you would never pay two for a colour
       * you already hold.
       */
      colour?: Suit;
      /**
       * ⭐ THE SLOT TOLL (R6 as amended, handoff v2). v1 REFUSED a slot that
       * already held a meeple; v2 prices it at `rules.turn.slotToll` extra
       * meeples per occupant and refuses nothing. These are the toll meeples -
       * any colours, NOT the acting meeple - and they go to the BOX rather than
       * into the slot. Absent or empty means the slot was free.
       */
      toll?: Suit[];
    }
  /**
   * COLLECT - the meeple-loop arm's other bonus option (R7), and the half of the
   * design that pays the HOST for being visited.
   *
   * Take EVERY meeple off your own Notice Board into your supply (the R4 cap
   * applies, and a duplicate is boxed), then Draw 1 - `rules.turn.bonusDraw`
   * cards off the top of any one deck in play, so the deck pick is the draw
   * task's own answer and nothing is named here.
   *
   * ⭐ COLLECTING AN EMPTY BOARD IS LEGAL and simply reads as Draw 1. That is
   * deliberate: it is the solitaire line, and the bonus mix has to be able to
   * count it separately from a collect that actually took meeples back, because
   * it is the line the free Draw 1 used to be.
   */
  | { type: 'collect'; seat: Seat }
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
  collect: true,
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
  /**
   * Cards entered a hand. `seat` is whose hand they entered.
   *
   * ⭐ `via` IS ONE PURELY ADDITIVE FIELD, ADDED FOR S17 (Dean, 11/09/2026),
   * AND IT IS THE ONLY WAY THE HOST DRAW CAN BE COUNTED APART FROM AN ORDINARY
   * ONE. `'hostDraw'` means these cards are the payment the OWNER of a visited
   * Notice Board took for being visited (`rules.turn.hostDrawOnVisit`); the
   * field is ABSENT on every other producer, of which there are many, so no
   * existing reader changes and no existing count moves. It is a new FIELD and
   * deliberately not a new EVENT: the sim's `EVENT_KINDS` is exhaustive over
   * this union and a sixth-of-its-kind event would be a change in a package
   * this pass may not touch, while the cards themselves must keep arriving on
   * `cardsToHand` so that everything already priced off a draw still prices
   * this one.
   *
   * ⚠️ IT SURVIVES REDACTION BY CONSTRUCTION (`redactEvents` spreads the event
   * and masks only `cards`), which is right: who was visited and what the rule
   * pays are public at a real table. Only the card identities are private, and
   * they are masked exactly as they are for any other seat's draw.
   */
  | { e: 'cardsToHand'; seat: Seat; cards: CardId[]; via?: 'hostDraw' | 'closingDraw' }
  | { e: 'cardsDiscarded'; suit: Suit; cards: CardId[] }
  | { e: 'deckToBarn'; seat: Seat; suit: Suit; card: CardId }
  /** One card lifted from a building's stack into its owner's barn (W14) - NOT a harvest, no on-harvest passives. */
  | { e: 'stackToBarn'; seat: Seat; building: CardId; card: CardId }
  /**
   * A HARVEST TOOK A STACK INTO A BARN. `seat` is always the HARVESTER, whose
   * barn the cards went into.
   *
   * `source` and `owner` were added with the commons (C5, 09/09/2026), when a
   * harvest could take a central pile. The commons was deleted on 13/09/2026, so
   * they are constants now ('tableau' and the harvester's own seat), kept so
   * serialised events stay identical.
   */
  | {
      e: 'harvested';
      seat: Seat;
      building: CardId;
      cards: CardId[];
      source: 'tableau';
      owner: Seat;
    }
  /**
   * A COIN CAME OUT OF THE SUPPLY.
   *
   * ⭐ `board` IS ALWAYS `'store'` SINCE 13/09/2026: the other mint (the
   * commons-with-coins arm's cleared central pile) was deleted with the
   * commons, and the field is kept so events stay identical. `'store'` is the VILLAGE STORE's exchange
   * (V1): one event per card converted, `coins` is
   * `rules.economy.storeCoinsPerCard`, and `card` names the barn card that paid
   * for it and therefore its suit and its discard pile.
   */
  | { e: 'coinsMinted'; seat: Seat; board: 'store'; coins: number; card?: CardId }
  /**
   * ⭐ COINS LEFT A SEAT'S PILE - one of the currency's EXACTLY TWO SINKS (K7,
   * Dean 10/09/2026). `on` says which:
   *
   *  - `'farmstead'`: the Farmstead's activation cost, one coin, spent as a
   *    MAIN-ACTION GROW that places nothing and fires the suit power (K10-K12).
   *  - `'endgame'`: an Endgame card's whole price, `rules.economy.endgameCoinCost`
   *    coins and ZERO CARDS (K15). The `built` event fires unchanged beside it,
   *    with an empty `payment`.
   *
   * ⚠️ THE UNION IS THE ECONOMY'S GUARD RAIL. A third member is a third use for
   * coins, which K7 rules out in so many words, so adding one is a design
   * decision and never an implementation detail. a19 reads the split.
   */
  /**
   * A COIN LEFT A WALLET. `on` says which sink took it.
   *
   * ⭐ TWO OF THE FOUR ARE THE VILLAGE STORE'S (V6 and V8, A150,
   * 12/09/2026): `'build'` is a coin paying any part of a build cost, emitted
   * ONCE for the whole coin component of one payment because coins are fungible
   * and a payment names a COUNT and never which coins; `'grow'` is a coin-Grow,
   * always exactly one coin, placing nothing. `'farmstead'` and `'endgame'` are
   * the separate commons-with-coins arm's two sinks (K10/K15, 10/09/2026) and
   * no overlay turns both economies on at once.
   *
   * ⚠️ UNDER THE STORE THE COIN GOES BACK TO THE SHARED SUPPLY (V5) and may
   * be minted again; under K7 there is no supply and it simply ceases. That
   * branch lives in `fx.spendCoins`, gated on the supply's presence.
   */
  | {
      e: 'coinsSpent';
      seat: Seat;
      on: 'farmstead' | 'endgame' | 'build' | 'grow';
      coins: number;
    }
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
  | {
      e: 'doorUsed';
      seat: Seat;
      colour: Suit;
      action: DoorAction;
      /**
       * ⭐ 'balloon' ADDED 12/09/2026 and it is a NAMED PASSENGER. Under an arm
       * whose balloons pay plain actions, a flight buys a door action and is
       * counted as one here, exactly as D4 made a commons play count as one.
       * ⛔ SO THE DOOR MIX AND ACTION INFLATION ON SUCH AN ARM ARE NOT
       * COMPARABLE WITH THE SHIPPED GAME'S, and no report may pool them. This
       * field is how a reader splits them; it produces nothing at all while
       * every balloon reward is a sized one, which is the shipped data.
       */
      via: 'visit' | 'meeple' | 'balloon';
    }
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
   *
   * ⭐ `action` IS A `DoorAction` AND NOT A `WorkerAction` SINCE 12/09/2026
   * (M7, A151): under `meepleSpendTiming: 'afterAction'` an apiary meeple buys
   * GROW, which is not in the roster's vocabulary. The widening matches
   * `doorUsed`, which has carried the wider type since the commons bought the
   * same action on 09/09/2026, and it means a reader tallying the colour mix of
   * what was spent sees the action that actually happened.
   */
  | { e: 'meepleSpent'; seat: Seat; colour: Suit; action: DoorAction }
  /**
   * ⭐ A MEEPLE WAS RETURNED TO THE BOX under the supply cap - the meeple-loop
   * arm's only leak, and the number that says whether the cap is doing work or
   * throwing the economy away (R4).
   *
   * Emitted INSTEAD of `meepleGained`, never beside it, so the two events
   * partition every meeple that was offered to a supply. `source` says which
   * faucet overflowed: `'collect'` is taking your own board back, `'island'` is
   * a delivery, `'balloon'` is the magenta balloon's bag draw.
   *
   * ⭐ HANDOFF v2 ADDS FOUR SOURCES AND THEY ARE NOT OVERFLOWS (R15, R16).
   * `'build'`, `'activation'` and `'delivery'` are a meeple SPENT AS A CARD of
   * its colour, and `'toll'` is a meeple burned to enter an occupied slot (R6).
   * Those four are emitted on their own, with no `meepleGained` to partition
   * against, because nothing was ever offered to a supply: the meeple left one.
   * ⚠️ So `meepleBoxed` stops being "the cap's leak" and becomes "every
   * meeple that left the game", and any reader that treated the event as a
   * measure of the cap must now split it by source. The first three sources
   * always arrive beside a `meepleAsCard` event, which carries the use and the
   * threshold flag; `'toll'` arrives beside `visitToll`.
   */
  | {
      e: 'meepleBoxed';
      seat: Seat;
      colour: Suit;
      source:
        | 'collect'
        | 'island'
        | 'balloon'
        | 'build'
        | 'activation'
        | 'delivery'
        | 'toll'
        | 'paymentToll';
    }
  /**
   * ⭐ A MEEPLE WAS SPENT AS A CARD OF ITS COLOUR (R15, handoff v2), which is
   * the whole of that rule's measurement surface. One event per meeple, so a
   * build paid with two meeples emits two, and each is followed by its own
   * `meepleBoxed` with the matching source.
   *
   * `use` is which payment it made. `atThreshold` is the one that matters and it
   * is only ever true on an `'activation'`: a meeple paid for a Grow goes
   * STRAIGHT TO THE BOX rather than onto the stack, so it never touches the
   * threshold, so it can activate a building that is ALREADY FULL. That is a
   * priced clog bypass and it is deliberate (Dean, 04/09/2026 evening). It is
   * counted apart from every other meeple exit because it is the one use a card
   * could never have made.
   *
   * `wild` says the meeple was half of a pair spent as one card of any colour
   * (R10), so two events with `wild` true are ONE resource, not two.
   */
  | {
      e: 'meepleAsCard';
      seat: Seat;
      colour: Suit;
      use: 'build' | 'activation' | 'delivery';
      atThreshold: boolean;
      wild: boolean;
    }
  /**
   * ⭐ A TOLL WAS PAID TO ENTER AN OCCUPIED SLOT (R6 as amended, handoff v2).
   *
   * v1 REFUSED an occupied slot; v2 prices it at `rules.turn.slotToll` extra
   * meeples per meeple already sitting there, and nothing is ever refused. The
   * toll meeples are any colours, they are NOT the acting meeple, and they go to
   * the box rather than into the slot - so a toll is a sink and the acting
   * meeple is still a loan to the host.
   *
   * `paid` is the toll only. `occupants` is how many meeples were in the slot
   * before this visit, which is what the toll was priced off.
   */
  | { e: 'visitToll'; seat: Seat; host: Seat; colour: Suit; paid: Suit[]; occupants: number }
  /**
   * ⭐ A MEEPLE SPENT AS A CARD LANDED ON A NEIGHBOUR'S BOARD (R17, Dean
   * 05/09/2026) rather than going to the box.
   *
   * It rides BESIDE `meepleAsCard`, which still carries the use and the
   * threshold flag, so a reader that wants "what did R15 pay for" reads that one
   * and a reader that wants "who got fed" reads this one. There is deliberately
   * no `visited` event and no `afterVisit` hook: this is a payment landing, not
   * a visit, and it buys the payer no door.
   */
  | {
      e: 'meepleplaced';
      seat: Seat;
      host: Seat;
      colour: Suit;
      use: 'build' | 'activation' | 'delivery';
    }
  /**
   * MEEPLES CAME OFF YOUR OWN NOTICE BOARD (the meeple arm's Collect, R7).
   * `kept` are the ones that reached the supply and `boxed` the duplicates the
   * cap refused - each of the latter also emits its own `meepleBoxed`, so this
   * event is the per-turn summary and those are the per-meeple record.
   *
   * An EMPTY collect still emits it, with both lists empty: "the seat took the
   * solitaire line" is a fact the bonus mix has to count, and inferring it from
   * the absence of an event is exactly the kind of silence that hides a metric.
   */
  | { e: 'boardCollected'; seat: Seat; kept: Suit[]; boxed: Suit[] }
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
      /**
       * The receipt taken: 6 for the first delivery space, 3 for the second.
       * ⚠️ Under the space choice (14/09/2026) that is the SPACE and not the
       * arrival order: a first arrival may take 3.
       */
      vp: number;
      spend: Partial<Record<Suit, number>>;
      /** The space taken. Present only under `rules.turn.deliverySpaceChoice`. */
      space?: number;
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
  /**
   * ⭐ THE EVENT NAME SURVIVES THE MEEPLE-LOOP ARM, AND THAT IS ON PURPOSE. A17
   * The Smoke Pot, O16 The Fruit Store and every future host-side or
   * visitor-side reactor key on `afterVisit` / `visited`; the arm changes what a
   * visit is PAID IN and never what it IS, so the name and the four shipped
   * fields are unchanged and the two arm-only fields are additive.
   *
   * `wild` and `meeples` are ABSENT under the `'card'` game - it has no meeples
   * to name and the control's event stream has to stay byte-identical. Under the
   * arm `meeples` is what left the visitor's supply (two for a wild pair) and
   * `colour` is the slot bought, which is the door taken. `self` is present
   * under both and is FALSE by construction under the arm (X5: no self-visit
   * under any flag), which is what `a08-the-hook` should assert rather than
   * assume.
   */
  | {
      e: 'visited';
      seat: Seat;
      host: Seat;
      self: boolean;
      colour: Suit;
      action: WorkerAction;
      wild?: boolean;
      meeples?: Suit[];
    }
  | { e: 'endTriggered'; seat: Seat }
  | { e: 'turnEnded'; seat: Seat; next: Seat }
  | { e: 'gameEnded' };
