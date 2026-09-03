/**
 * Read-only questions about a (data, state) pair. Everything here is derived on
 * demand - clogged-ness, thresholds, upgrade counts - because stored state is
 * only what a camera pointed at the table could not reconstruct.
 */

import type { Card, GameData, Suit, SuitDoor } from '@gp/data';

import type { BuildingState, CardId, GameState, PlayerState, Seat, WorkerState } from './state.js';

/**
 * Card lookup, indexed per GameData.
 *
 * It was a linear scan of the 105-card catalogue, which was the right shape
 * while a rules engine read a handful of cards per `apply`. Ticket 28 measured
 * the scan costing a bot 30-54us a decision and indexed it inside @gp/bots;
 * ticket 40's probe made the engine itself the hot caller, since a decision now
 * runs several speculative applies. Indexing here retires both copies of the
 * problem and the sim's flagged "cheapest single-core throughput win".
 *
 * Keyed on the data object, so an overlay run gets its own index and each is
 * collected with the data it describes. Behaviour is unchanged, throw included.
 */
const CARD_INDEX = new WeakMap<GameData, Map<CardId, Card>>();

export function cardById(data: GameData, id: CardId): Card {
  let index = CARD_INDEX.get(data);
  if (index === undefined) {
    index = new Map(data.cards.catalogue.map((c) => [c.id, c]));
    CARD_INDEX.set(data, index);
  }
  const card = index.get(id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  return card;
}

/**
 * The asking form of `cardById`, for code that is handed an arbitrary string
 * and has to decide whether it is a card at all - today only the redaction of a
 * card task's untyped rider bag, which holds suits, seat numbers and tile ids
 * beside its card ids and must mask exactly one of those kinds.
 *
 * ⚠️ Card ids and ISLAND TILE ids share a namespace: `A5` is both the Apiary
 * Barn and a Level 1 tile, so a true answer here means "this could be a card",
 * never "this is one". No rider holds a tile today; a caller that might see one
 * has to disambiguate by key, exactly as the sim's view-safety walk does.
 */
export function isCardId(data: GameData, id: string): boolean {
  let index = CARD_INDEX.get(data);
  if (index === undefined) {
    index = new Map(data.cards.catalogue.map((c) => [c.id, c]));
    CARD_INDEX.set(data, index);
  }
  return index.has(id);
}

export function player(state: GameState, seat: Seat): PlayerState {
  const p = state.players[seat];
  if (!p) throw new Error(`No player in seat ${seat}`);
  return p;
}

export function buildingOf(state: GameState, seat: Seat, card: CardId): BuildingState {
  const b = player(state, seat).tableau.find((x) => x.card === card);
  if (!b) throw new Error(`Seat ${seat} has not built ${card}`);
  return b;
}

/**
 * The face a building is showing - which since v31 is simply its card.
 *
 * ⛔ THERE ARE NO FACES. This function existed to pick between `card.faces.starter`
 * and `card.faces.upgraded` off `building.upgraded`, and it was the one place
 * that knew a starter had two printed sides. v31 deletes all fifteen upgraded
 * faces along with the currency that bought them, `cards.json` is flat, and
 * `BuildingState.upgraded` is gone, so the choice has one arm.
 *
 * KEPT AS A NAMED FUNCTION rather than inlined into thirty call sites, for the
 * same reason `visitTargetOf` was kept when it collapsed: "what is this building
 * showing?" is a real question with a real answer, and if a printed face ever
 * varies again this is the one place that has to learn about it. It differs from
 * `cardById` only in taking a building rather than an id.
 */
export function faceOf(data: GameData, building: BuildingState): Card {
  return cardById(data, building.card);
}

export function thresholdOf(data: GameData, building: BuildingState): number | null {
  const printed = faceOf(data, building).threshold;
  // ⭐ THE DOOR'S THRESHOLD IS AN OVERRIDE (ruled 2, 20/08/2026). Applied at
  // this one seam deliberately: `isFull`, `canTakeCard` and `roomOn` all read
  // through here, so the visit, the Helping Hand, the sow targets and the clog
  // metric cannot disagree about when a farm is shut.
  //
  // ⚠️ Only the NOTICE BOARD, and only when the knob is non-null. Every other
  // building keeps its printed threshold, and when the sheet catches up (ten
  // cells, five boards, both faces) this knob goes back to null and the printed
  // value takes over with no other change.
  if (printed === null) return null;
  const override = data.rules.economy.noticeBoardThreshold;
  if (override === null) return printed;
  return cardById(data, building.card).slot === 'noticeboard' ? override : printed;
}

/** Full = clogged: at threshold, nothing may be placed until the owner harvests. */
export function isFull(data: GameData, building: BuildingState): boolean {
  const threshold = thresholdOf(data, building);
  return threshold !== null && building.stack.length >= threshold;
}

/** A building that accumulates cards and is not yet clogged. */
export function canTakeCard(data: GameData, building: BuildingState): boolean {
  const threshold = thresholdOf(data, building);
  return threshold !== null && building.stack.length < threshold;
}

/**
 * Spaces left under a building's threshold - 0 for a full one and for a
 * building with no stack at all. Special Orders' 2-card visit needs room for
 * BOTH cards before anything moves, which is the only place a count of one is
 * not the same question as canTakeCard.
 */
export function roomOn(data: GameData, building: BuildingState): number {
  const threshold = thresholdOf(data, building);
  return threshold === null ? 0 : Math.max(0, threshold - building.stack.length);
}

export function fullBuildings(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isFull(data, b));
}

/**
 * The CROP a building prints - ticket 07's rule for every "buildings of crop X"
 * count in the game, so it is never derived twice.
 *
 * A deck card prints its crop icon. A STARTER PRINTS NONE: all fifteen carry the
 * generic starting-building icon (verified in print by ticket 13), so a starter
 * counts neither for its crop nor against it. That used to be true only of the
 * BASE face - the GBP 2 flip bought a crop icon along with its rider - and since
 * v31 deleted the flip it is true for the whole game.
 *
 * ⭐ It agrees with the new Farmstead, which is the card that cares most: "Game
 * end: 1 VP for each CROP card you have built" is DECK CARDS ONLY, your three
 * starters do not count, and that reading falls straight out of this function
 * rather than needing a carve-out.
 *
 * Not the keyword sub-types - FIELD, DEPOT, ORCHARD, HIVE come from title
 * keywords and are untouched by this.
 */
export function cropOf(data: GameData, building: BuildingState): Suit | null {
  const card = cardById(data, building.card);
  return card.type === 'starter' ? null : card.suit;
}

/** Buildings in a seat's tableau printing this crop's icon. */
export function cropBuildings(
  data: GameData,
  state: GameState,
  seat: Seat,
  crop: Suit,
): BuildingState[] {
  return player(state, seat).tableau.filter((b) => cropOf(data, b) === crop);
}

/**
 * Buildings printing SOME crop icon other than this one. Deliberately not the
 * complement of cropBuildings: a base starter prints no crop, so it is not a
 * building of a foreign crop either.
 */
export function foreignCropBuildings(
  data: GameData,
  state: GameState,
  seat: Seat,
  crop: Suit,
): BuildingState[] {
  return player(state, seat).tableau.filter((b) => {
    const printed = cropOf(data, b);
    return printed !== null && printed !== crop;
  });
}

export function workerState(state: GameState, id: string): WorkerState {
  const w = state.fair.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown worker ${id}`);
  return w;
}

/** One door's printed row, by action id. Throws on an id the roster does not carry. */
export function workerData(data: GameData, id: string): SuitDoor {
  const w = data.workers.roster.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown door action ${id}`);
  return w;
}

/**
 * The DOOR a suit owns - its Notice Board's action, which is also what a meeple
 * of that colour does when spent. Throws rather than returning undefined: all
 * five entries are asserted present in `data.test.ts`, so an absent one is a
 * corrupt roster and not a state a caller should be handling.
 *
 * Wraps the data package's `doorForSuit` so the engine has one non-optional
 * answer, and so a colour with no seat behind it (a meeple of a suit nobody is
 * farming, which is legal) still resolves.
 */
export function doorOf(data: GameData, suit: Suit): SuitDoor {
  const door = data.workers.roster.find((w) => w.linkedSuit === suit);
  if (!door) throw new Error(`No door action for suit ${suit}`);
  return door;
}

/**
 * ⛔ `serviceOf` is GONE (change 6, 20/08/2026). There is no Service building:
 * the door merged into the Notice Board, so `noticeBoardOf` is the only answer
 * to "which building does a rival touch?" Call it directly.
 */

/**
 * The door ACTION a seat owns, from its suit. Every seat owns exactly one, and
 * this survived change 6 unchanged - it reads `workers.roster`, which describes
 * behaviour and never described a card.
 */
export function serviceIdOf(data: GameData, state: GameState, seat: Seat): string {
  return doorOf(data, player(state, seat).suit).id;
}

/**
 * The building a visit's fee lands on: the host's NOTICE BOARD, always.
 *
 * ⭐ CHANGE 6 (20/08/2026) is this function collapsing, and v31 finished the
 * job by deleting its `mode` argument. It used to send a `worker` visit to the
 * Service and a `coin` visit to the Notice Board - two rival-touchable buildings
 * that clogged INDEPENDENTLY, which is where the denial numbers came from
 * ("there was always another building to go to"). There is one door now, so
 * popularity clogs the whole cross-table surface of a farm at once - and since
 * v31, the owner's own traffic clogs it too.
 *
 * Kept as a named function rather than inlined: "the building a visit lands on"
 * is a real concept with a real invariant, and if a card ever adds a second
 * door this is the one place that has to learn about it.
 */
export function visitTargetOf(data: GameData, state: GameState, host: Seat): BuildingState {
  return noticeBoardOf(data, state, host);
}

/**
 * INVARIANT: every seat has a Notice Board for the whole game, so this throw is
 * an assertion, not a reachable error path.
 *
 * It used to be reachable - D11/D14 could cover or demolish a starter, and this
 * threw from `visitOptions` inside `legalMoves`, crashing the game for EVERY
 * seat (3 of 1510 reference games, and 2-4 in 12 for a Dairy-heavy seat). Ticket
 * 30 ruled starters out of that target set at the source, which is the whole
 * fix: nothing else in the game removes a building.
 *
 * Deliberately still throwing rather than returning null. A seat with no Notice
 * Board cannot be visited, so the graceful path is `visitOptions` silently
 * offering nothing - which in a 1510-game balance run corrupts the hook metrics
 * invisibly. Loud is right here: if this ever fires again, a new card has broken
 * the invariant and the sim must not average over it.
 */
export function noticeBoardOf(data: GameData, state: GameState, seat: Seat): BuildingState {
  const b = player(state, seat).tableau.find((x) => cardById(data, x.card).slot === 'noticeboard');
  if (!b) throw new Error(`Seat ${seat} has no Notice Board`);
  return b;
}

/**
 * ⛔ THE FIVE FARMSTEAD SUIT POWERS ARE GONE (v31, 02/09/2026), and this is the
 * largest single deletion in the pass, so the list is recorded here where four
 * of the five had a seam.
 *
 * All five Farmsteads now print ONE line and it is the same line bar the crop
 * name: *"Game end: 1 VP for each CROP card you have built."* No passive, no
 * modifier, no upgraded face. `cards.json` is the contract and it carries
 * exactly that text on W2/V2/O2/A2/D2.
 *
 * What died, and where its seam was:
 *
 *  - **`upgradedBuildingCount`** (here) counted starters showing their flipped
 *    side, for the old D21's "2 VP for each of your starters showing its
 *    upgraded side". Nothing flips; D21 is retexted to count SHEDs (v31 §3.2).
 *  - **`withDrawModifier`** (here) was Orchard's "your Draw sees and keeps 1
 *    extra", applied where a Draw ACTION's numbers were set - the base Draw and
 *    the Draw door - and deliberately never to card-ability draws (DL-47). That
 *    scoping rule is worth keeping in mind if a draw modifier ever returns: it
 *    has to attach to the ACTION, or a card that says "Draw" fires it too.
 *  - **`drawGiftPower`** (here) was the other half of the same card: "when one
 *    of your draws discards a card, give it to a neighbour instead". Its self-
 *    scoping was the clever part - the base Draw was see 2 keep 1 so it had one
 *    discard to give, a door's Draw kept everything so it had none, and the
 *    end-of-turn discard was not a draw - which closed the give-four-cards
 *    exploit with no special case at all. In v31 the base Draw keeps both cards,
 *    so there would have been nothing to give in any case.
 *  - **`deliverHeadSize` / `deliverDeckHead`** (actions.ts) were Vegetable's
 *    "you may FIRST put a card into your barn" before a delivery.
 *  - **`apiaryGrowBonus`** (actions.ts) was Apiary's "when you GROW, Draw 1".
 *  - **`buildDivertPower`** (actions.ts) was Dairy's "put 1 card you spend from
 *    your hand into your barn instead of discarding it".
 *
 * Wheat's had already left this file on 19/08/2026 when the relaxed harvest
 * moved onto the Notice Board door; in v31 the doors are plain, so that went too.
 */

/** Suits whose deck or discard still has cards - the drawable suits. */
export function drawableSuits(data: GameData, state: GameState): Suit[] {
  return data.cards.suits.filter(
    (s) => (state.decks[s]?.length ?? 0) + (state.discards[s]?.length ?? 0) > 0,
  );
}

/** Built copies of a card in a seat's tableau (Helping Hand duplicates stack). */
export function builtCopies(data: GameData, state: GameState, seat: Seat, name: string): number {
  return player(state, seat).tableau.filter((b) => cardById(data, b.card).name === name).length;
}
