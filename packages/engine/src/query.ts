/**
 * Read-only questions about a (data, state) pair. Everything here is derived on
 * demand - clogged-ness, thresholds, upgrade counts - because stored state is
 * only what a camera pointed at the table could not reconstruct.
 */

import type { Card, GameData, Suit, SuitDoor } from '@gp/data';
import {
  isCommons,
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardBlocks,
  unclaimedBoardsToCentre,
} from '@gp/data';

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

/**
 * ⭐ THE ONE SEAM THAT TURNS THE NOTICE BOARD FROM A BUILDING INTO A CARD WITH
 * FIVE SLOTS (the meeple-loop arm, R5).
 *
 * A null threshold IS "not a building" everywhere in this engine: `isFull` is
 * false, `canTakeCard` is false and `roomOn` is 0, so the board falls out of the
 * sow targets, the harvest targets, the Apiary door's legality check, `roomOn`'s
 * callers and A21 The Wax Hall's "a building with a card on it" all at once,
 * because every one of them reads through `thresholdOf`. Nothing may place a
 * card on it under the arm, so its stack stays empty for the whole game and A21
 * counts it at 0 without a special case.
 *
 * GROW and `activateOnly` exclude it by SLOT rather than by threshold and are
 * untouched - they refused it before the arm and they refuse it after.
 */
function noticeBoardIsBuilding(data: GameData): boolean {
  // ⭐ THE COMMONS ANSWERS FALSE TOO (C4, 09/09/2026), and for a second reason
  // on top of the meeple loop's: a central board has NO THRESHOLD, so it is
  // never full, never clogged and refuses nothing. It is also not in anybody's
  // tableau, so in practice the seam is belt and braces - but the two halves
  // must agree, because A21 The Wax Hall counts "a building with a card on it"
  // through `thresholdOf` and a central pile is deliberately not one (C8).
  //
  // ⭐ TWO VALUES ANSWER TRUE SINCE 10/09/2026, AND THE SECOND IS THE WHOLE
  // POINT OF THE NOTICE-BOARD VISIT (S2, S16). `'card'` is the v31 control, and
  // `'noticeBoardPower'` brings the five boards home to their owners' farms as
  // BUILDINGS again - which is what puts A21 The Wax Hall's counter back onto
  // the board and lets a visit fee land through `fx.placeOnBuilding` so that
  // A16 The Beekeeper's Veil sees it. Answering false here would have silently
  // undone both of S16's rulings.
  return !isMeepleCurrency(data) && !isCommons(data);
}

export function thresholdOf(data: GameData, building: BuildingState): number | null {
  const printed = faceOf(data, building).threshold;
  if (!noticeBoardIsBuilding(data) && cardById(data, building.card).slot === 'noticeboard') {
    return null;
  }
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

/**
 * ⛔ THE SEAM WHERE "harvestable" AND "accepts a card" STOP BEING THE SAME
 * QUESTION (S8, Dean 10/09/2026), and the reason the predicates below are four
 * rather than two.
 *
 * Everywhere in this codebase until 10/09/2026 a threshold was a CEILING: reach
 * it and a building is both harvestable and shut, so `isFull` and `canTakeCard`
 * were exact complements and it never mattered which one a caller asked. The
 * notice-board visit prints `3+` on the Notice Board and the plus sign is the
 * rule: three is the MINIMUM before the owner may harvest, never a maximum
 * load, so a board at five cards is harvestable AND still takes another.
 *
 * This answers "does the threshold SHUT this building?" and it is the one line
 * that knows the difference. True for every building in every mode bar one: the
 * OWNED Notice Board under `visitCurrency: 'noticeBoardPower'` with
 * `rules.economy.noticeBoardBlocks` false, which is the arm's shipped value.
 * `noticeBoardBlocks: true` is the paired control
 * (`overlays/notice-board-visit-blocking-v1.overlay.json`) and turns the board
 * back into an ordinary clogging building, so that "does a board stall?" is
 * measured rather than argued.
 *
 * ⚠️ IT IS NEVER ASKED OF A CENTRAL PILE. Under the commons a board has no
 * threshold at all (`thresholdOf` answers null), so nothing reaches here.
 */
function thresholdShuts(data: GameData, building: BuildingState): boolean {
  if (!isNoticeBoardPower(data)) return true;
  if (cardById(data, building.card).slot !== 'noticeboard') return true;
  return noticeBoardBlocks(data);
}

/**
 * ⭐ IS THE STACK AT OR ABOVE ITS THRESHOLD - the HARVEST question, and the
 * arithmetic `isFull` used to carry on its own.
 *
 * Split out on 10/09/2026 because the two halves diverged (see `thresholdShuts`
 * above). Every caller that meant "may this be harvested / is it at its printed
 * number" reads this; every caller that meant "does this refuse a card" reads
 * `isFull`. Under every mode but the notice-board visit the two are the same
 * boolean, so the split moves nothing for the commons or for either control.
 */
export function isHarvestable(data: GameData, building: BuildingState): boolean {
  const threshold = thresholdOf(data, building);
  return threshold !== null && building.stack.length >= threshold;
}

/**
 * Full = CLOGGED: this building refuses cards until its owner harvests it.
 *
 * ⚠️ NO LONGER THE SAME QUESTION AS `isHarvestable` (S8, 10/09/2026). A
 * `3+` Notice Board is harvestable at three cards and clogged at none, so this
 * answers false for it however deep the stack goes.
 */
export function isFull(data: GameData, building: BuildingState): boolean {
  return isHarvestable(data, building) && thresholdShuts(data, building);
}

/**
 * MAY A CARD BE PLACED HERE AT ALL - the physical capacity question, asked by
 * every placement funnel in `fx.ts` and by the enumerators that feed them.
 *
 * The exact complement of `isFull` among buildings that have a threshold, which
 * is what it has always been; what changed is `isFull`. A `3+` Notice Board
 * therefore answers true for ever, which is S8, and that is the answer the
 * VISIT needs.
 *
 * ⛔ IT IS NOT THE SOW QUESTION. S11 says the Notice Board is a building for
 * harvest and for nothing else - never a GROW target, never a sow target - so
 * an effect choosing somewhere to put a card asks `canSowOnto` below. Bending
 * this one instead would have refused the visit fee itself.
 */
export function canTakeCard(data: GameData, building: BuildingState): boolean {
  return thresholdOf(data, building) !== null && !isFull(data, building);
}

/**
 * ⭐ MAY AN EFFECT SOW OR PLACE A CARD HERE (S11, Dean 10/09/2026)?
 *
 * `canTakeCard` plus one exclusion: under `visitCurrency: 'noticeBoardPower'`
 * the Notice Board is a building for HARVEST and for nothing else, so a sow, a
 * deck-top placement or any card text that puts a card on a building of your
 * choice may not choose it. The only way a card arrives on a Notice Board is a
 * visit, and the only way one leaves is its owner's Harvest.
 *
 * ⚠️ IT IS A REAL RULES CHANGE AND ONLY UNDER THAT MODE. Under the v31
 * control a Notice Board IS a legal sow target and always has been (a clogged
 * one simply falls out through `canTakeCard`), so this answers exactly
 * `canTakeCard` in every other game and no control moves.
 *
 * GROW needs no equivalent: `growOptions` and `activateTargets` have excluded
 * the noticeboard slot by name since v31, on the grounds that the board's text
 * IS the bonus slot's payoff.
 */
export function canSowOnto(data: GameData, building: BuildingState): boolean {
  if (!canTakeCard(data, building)) return false;
  return !(isNoticeBoardPower(data) && cardById(data, building.card).slot === 'noticeboard');
}

/**
 * Spaces left under a building's threshold - 0 for a full one and for a
 * building with no stack at all. Special Orders' 2-card visit needed room for
 * BOTH cards before anything moved, which is the only place a count of one was
 * not the same question as canTakeCard.
 *
 * ⚠️ IT COUNTS TO THE THRESHOLD, AND A THRESHOLD IS NOT ALWAYS A CEILING
 * NOW (S8, 10/09/2026). On a `3+` Notice Board this is the room left below the
 * HARVEST MINIMUM rather than a capacity: the board takes cards for ever and
 * this still answers 0 once it holds three. Nothing reads it today - the last
 * caller went with Special Orders - and it is left as the printed arithmetic
 * rather than made mode-aware, because the next caller has to say which of the
 * two questions it means.
 */
export function roomOn(data: GameData, building: BuildingState): number {
  const threshold = thresholdOf(data, building);
  return threshold === null ? 0 : Math.max(0, threshold - building.stack.length);
}

/**
 * A seat's buildings at or above their thresholds - the HARVEST question, so it
 * reads `isHarvestable` and not `isFull` (10/09/2026). Its one consumer is the
 * `chooseBuilding` task's `'full'` filter, which is a harvest gate every time
 * it is pushed.
 */
export function fullBuildings(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isHarvestable(data, b));
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
 * THE FIVE COLOUR SLOTS of a seat's Notice Board, under the meeple-loop arm.
 *
 * Throws rather than returning a default, for the same reason `noticeBoardOf`
 * does: a seat without slots while the arm is on is a setup that never ran, and
 * a silent empty board would hand every rival a free visit and corrupt the hook
 * metric invisibly. `PlayerState.noticeBoard` is absent under the `'card'` game
 * by design - see its comment - so nothing on that path may call this.
 */
export function noticeBoardSlots(state: GameState, seat: Seat): Record<Suit, Suit[]> {
  const board = player(state, seat).noticeBoard;
  if (!board) throw new Error(`Seat ${seat} has no Notice Board slots`);
  return board.slots;
}

/** A slot refuses its colour while any meeple sits in it (R6). */
export function slotBlocked(state: GameState, seat: Seat, colour: Suit): boolean {
  return (noticeBoardSlots(state, seat)[colour]?.length ?? 0) > 0;
}

/**
 * A SEAT'S COINS, under the commons-with-coins arm (K7, Dean 10/09/2026).
 *
 * Throws rather than returning 0, for exactly the reason `noticeBoardSlots` and
 * `commonsBoards` do: a coin game with no wallet is a setup that never ran, and
 * a silent 0 would quietly make every Endgame card unbuildable and every
 * Farmstead power unusable for the whole run, which reads as a design finding
 * rather than as the bug it is. `PlayerState.coins` is absent by design under
 * the shipped game - see its comment - so nothing on that path may call this.
 */
export function coinsOf(state: GameState, seat: Seat): number {
  const coins = player(state, seat).coins;
  if (coins === undefined) throw new Error(`Seat ${seat} has no coins in this game`);
  return coins;
}

/**
 * ⭐ IS DEAN'S UNCLAIMED-BOARDS VARIANT LIVE (ruled 11/09/2026,
 * `overlays/notice-board-visit-unclaimed-v1.overlay.json`)?
 *
 * TWO knobs, read as one predicate and never separately, because either on its
 * own is a different game: the currency has to be `'noticeBoardPower'` (so the
 * five boards are OWNED buildings printing the S12 powers) AND
 * `rules.economy.unclaimedBoardsToCentre` has to be true (so the boards of the
 * suits no player is farming stand ownerless in the middle with a public pile).
 * Under `'commons'` all five are central already and none of them is owned,
 * which is a different rule that reads the same way round - so this is
 * deliberately FALSE there, and `hasCentre` below is the question a caller asks
 * when it means "is there a centre at all".
 *
 * ⚠️ IT IS RULED TOGETHER WITH `rules.turn.selfVisitAllowed` false, and the
 * pair is arithmetic rather than taste: five boards exist, you may never visit
 * your own, so every seat faces exactly FOUR targets at every player count. The
 * ban is enforced in `enumerateNoticeBoardVisits` and is NOT read here, because
 * the 2x2 of `overlays/notice-board-visit-unclaimed-self-v1.overlay.json` needs
 * the two knobs separable (the 05/09/2026 passenger lesson: ruling in a bundle
 * rules in the bundle).
 */
export function unclaimedCentre(data: GameData): boolean {
  return isNoticeBoardPower(data) && unclaimedBoardsToCentre(data);
}

/**
 * IS THERE A CENTRE ON THE TABLE AT ALL - ownerless piles that a card can be
 * played onto and a Harvest can reach?
 *
 * True under the commons (all five piles, C1) and under Dean's unclaimed-boards
 * variant (the unfarmed suits' piles only, 11/09/2026). One spelling, so that
 * every gate which used to read `isCommons` because the commons was the only
 * game with a centre now reads the QUESTION it actually meant. Where a gate
 * genuinely means "is this the commons" - the `commonsTake` variants, the free
 * Draw 1, the meeple phase - it still asks `isCommons` and must keep doing so.
 */
export function hasCentre(data: GameData): boolean {
  return isCommons(data) || unclaimedCentre(data);
}

/**
 * ⭐ WHICH SUITS HAVE A CENTRAL PILE, in catalogue order.
 *
 * Five under the commons (C1: all five whatever suits are in play). Under the
 * unclaimed-boards variant it is the suits NO PLAYER IS FARMING, which is what
 * `freshCommons` put in the zone at setup, so this reads the zone's own keys
 * rather than recomputing the selection: the seats cannot change mid-game, but
 * a second copy of a selection rule is how two halves of an engine come to
 * disagree about the same table.
 *
 * Filtered out of `data.cards.suits` rather than handed back as `Object.keys`,
 * so the order is the catalogue's and therefore identical for every seat,
 * every run and every serialisation - enumeration order is move order, and move
 * order is what a seeded bot's choice is indexed against.
 *
 * Empty (never throwing) outside a game with a centre, so a caller may loop it
 * unguarded.
 *
 * ⚠️ IT ALLOCATES, SO THE TWO HOT PATHS DO NOT CALL IT. `harvestOptions` runs
 * through `hasMainOption` on every settle and `anyCentralHarvestAfterFee` is
 * asked once per (board, card in hand) pair by the bonus enumerator; both walk
 * `data.cards.suits` and skip a colour whose pile is absent, which is this
 * function inlined and allocation-free. Memoising here was tried and is NOT
 * worth it: `clonePlain` builds a fresh zone object for every speculative
 * probe, so a cache keyed on it would miss exactly where the cost is. This is
 * for setup, the view and the tests, where one array is nothing.
 */
export function centralBoardSuits(data: GameData, state: GameState): Suit[] {
  const boards = state.commons?.boards;
  if (boards === undefined) return [];
  return data.cards.suits.filter((colour) => boards[colour] !== undefined);
}

/**
 * THE CENTRAL PILES. Throws rather than defaulting, for exactly the
 * reason `noticeBoardSlots` does: a commons game with no commons zone is a setup
 * that never ran, and an empty default would silently offer five boards that
 * cannot be harvested and corrupt the traffic metric invisibly.
 *
 * ⚠️ FIVE KEYS UNDER THE COMMONS AND FEWER UNDER THE UNCLAIMED-BOARDS
 * VARIANT (11/09/2026), where only the unfarmed suits have a pile: a missing
 * key means THERE IS NO SUCH BOARD, which is a different thing from a pile of
 * zero cards, and `boards[colour]?.length ?? 0` cannot tell them apart. Ask
 * `centralBoardSuits` above for the set; this hands back the piles themselves.
 */
export function commonsBoards(state: GameState): Record<Suit, CardId[]> {
  const zone = state.commons;
  if (!zone) throw new Error('There is no commons in this game');
  return zone.boards;
}

/**
 * The BOARD CARD for a colour: that colour's Notice Board starter (W3/V3/O3/A3/
 * D3). Indexed per GameData for the same reason `cardById` is - `harvestOptions`
 * asks for all five on every call and it is on the hot path through
 * `hasMainOption` and `workerActionLegal`.
 *
 * Derived from the catalogue's `slot === 'noticeboard'` rather than from a list
 * of ids, so the five faces are named in exactly one place in the project (the
 * sheet) and a renumbered starter cannot desync the engine from it.
 */
const COMMONS_BOARD_INDEX = new WeakMap<GameData, Map<Suit, CardId>>();

function commonsBoardIndex(data: GameData): Map<Suit, CardId> {
  let index = COMMONS_BOARD_INDEX.get(data);
  if (index === undefined) {
    index = new Map<Suit, CardId>();
    for (const card of data.cards.catalogue) {
      if (card.slot === 'noticeboard' && !index.has(card.suit)) index.set(card.suit, card.id);
    }
    COMMONS_BOARD_INDEX.set(data, index);
  }
  return index;
}

export function commonsBoardCard(data: GameData, colour: Suit): CardId {
  const card = commonsBoardIndex(data).get(colour);
  if (card === undefined) throw new Error(`No Notice Board card for suit ${colour}`);
  return card;
}

/**
 * Which central board an id names, or null for anything else.
 *
 * ⚠️ IT ANSWERS NULL OUTSIDE THE COMMONS, whatever the id. W3 is a building in
 * a Wheat seat's tableau under both controls, and a harvest of it there must
 * stay a tableau harvest - so the mode is part of the question and not a check
 * every caller has to remember to make first.
 */
export function commonsBoardSuit(data: GameData, id: CardId): Suit | null {
  if (!isCommons(data)) return null;
  for (const [colour, card] of commonsBoardIndex(data)) {
    if (card === id) return colour;
  }
  return null;
}

/**
 * ⭐ WHICH CENTRAL PILE AN ID NAMES IN THE GAME ON THE TABLE, or null for
 * anything else - the STATE-AWARE question, and the one every rule should ask
 * (11/09/2026).
 *
 * ⛔ IT EXISTS BECAUSE UNDER DEAN'S UNCLAIMED-BOARDS VARIANT THE SAME CARD ID
 * IS A CENTRAL PILE IN ONE GAME AND A SEAT'S OWN BUILDING IN THE NEXT. W3 is
 * ownerless in the middle when nobody farms Wheat and is the Wheat seat's own
 * Notice Board when somebody does, so `data` alone cannot answer it and
 * `commonsBoardSuit` above - which is `data`-only, and correct for the commons,
 * where all five are always central - would say "central" for a card sitting in
 * a tableau. The zone's own keys are the authority, which is why this reads
 * them rather than re-deriving which suits are unfarmed.
 *
 * ⚠️ `commonsBoardSuit` IS DELIBERATELY LEFT AS IT STANDS rather than given a
 * state parameter. It is public API, `packages/bots/src/terms.ts` calls it, and
 * this pass may not touch that package; it is right for the commons and answers
 * null under every other currency, so nothing it tells anybody is wrong - it is
 * simply BLIND to the variant's centre, which is reported to the bots pass
 * rather than patched from here.
 */
export function centralPileSuit(data: GameData, state: GameState, id: CardId): Suit | null {
  if (isCommons(data)) return commonsBoardSuit(data, id);
  if (!unclaimedCentre(data)) return null;
  const boards = state.commons?.boards;
  if (boards === undefined) return null;
  for (const [colour, card] of commonsBoardIndex(data)) {
    if (card === id) return boards[colour] === undefined ? null : colour;
  }
  return null;
}

/**
 * ⭐ HOW DEEP A CENTRAL PILE HAS TO BE BEFORE ANYBODY MAY HARVEST IT
 * (`rules.economy.commonsHarvestMin`, Dean 09/09/2026). 1 is the shipped C5
 * rule - any non-empty pile - and a number above it is the BUILDING semantic: a
 * pile is "full" at n and refuses a harvest below it.
 *
 * Answers 1 outside the commons, so a caller may compare against it unguarded;
 * no control has a central pile to gate.
 *
 * ⭐ AND IT IS READ UNDER DEAN'S UNCLAIMED-BOARDS VARIANT TOO (11/09/2026),
 * where `overlays/notice-board-visit-unclaimed-v1.overlay.json` pins it to 3:
 * that is the OUTFLOW half of the `3+` rule on a central pile - a pile below
 * three may be taken by nobody, a pile at three or more by ANYBODY - and the
 * INFLOW half is `commonsThreshold` null, which is what makes the plus sign
 * mean "and it still accepts cards". ⚠️ The variant's overlay pins it BY NAME
 * on purpose: an unpinned knob would have handed the centre the shipped
 * commons rule (any pile of one, harvestable by anybody), which is a different
 * game from the one Dean ruled.
 */
export function commonsHarvestMin(data: GameData): number {
  if (!hasCentre(data)) return 1;
  const n = data.rules.economy.commonsHarvestMin;
  return n === null || n < 1 ? 1 : n;
}

/**
 * ⭐ HOW MANY CARDS A CENTRAL HARVEST TAKES
 * (`rules.economy.commonsHarvestTake`, Dean 09/09/2026). null is the shipped C5
 * rule - the whole pile - and a number n takes at most the most recently played
 * n, the TOP of the pile, leaving the rest standing.
 *
 * "At most" is the whole of the rule for a short pile: a pile of one under
 * n = 2 gives up its one card, because n caps the take and never demands a
 * depth. `commonsHarvestMin` is the knob that demands a depth, and the two are
 * deliberately independent so that "may only be taken at 3, and then only 1
 * comes" is expressible.
 *
 * Answers null outside the commons for the same reason as `commonsHarvestMin`,
 * and is read under the unclaimed-boards variant for the same reason as well
 * (11/09/2026): that overlay pins it null by name, so a central harvest there
 * takes the WHOLE pile rather than a capped slice of it.
 */
export function commonsHarvestTake(data: GameData): number | null {
  if (!hasCentre(data)) return null;
  const n = data.rules.economy.commonsHarvestTake;
  return n === null || n < 1 ? null : n;
}

/** Meeples of every colour a seat is holding, in colour order. Duplicates are impossible under the cap. */
export function meeplesHeld(data: GameData, state: GameState, seat: Seat): Suit[] {
  const held = player(state, seat).meeples;
  return data.cards.suits.filter((colour) => (held[colour] ?? 0) > 0);
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
 *
 * ⭐ AND ON 11/09/2026 IT DID, SO THIS IS THAT SEAM BEING USED RATHER THAN A
 * NEW ONE BEING CUT. Dean's two-board fix (`rules.economy.noticeBoardsBySeats`,
 * 2 at two seats) lays out a SECOND Notice Board in front of every seat, drawn
 * from the suits nobody is farming, so "the host's Notice Board" stopped being
 * a definite description: a host may hold two and the fee lands on exactly the
 * one the visitor named. `board` is that name and it comes off the `visit`
 * move, which carries the field for precisely this reason (see
 * `Move`'s `visit` arm).
 *
 * ⛔ OMITTING IT IS LEGAL AND MEANS "THE HOST'S OWN SUIT'S BOARD", which is
 * every game but the two-board arm and is why no other caller had to change.
 * Naming a card that is not one of this host's Notice Boards THROWS: a visit
 * that lands its fee on the wrong building is the one bug this arm can have,
 * and it must never be papered over with a fallback.
 */
export function visitTargetOf(
  data: GameData,
  state: GameState,
  host: Seat,
  board?: CardId,
): BuildingState {
  if (board === undefined) return noticeBoardOf(data, state, host);
  const named = noticeBoardsOf(data, state, host).find((b) => b.card === board);
  if (!named) throw new Error(`${board} is not a Notice Board of seat ${host}`);
  return named;
}

/**
 * ⭐ EVERY NOTICE BOARD A SEAT HAS LAID OUT, in tableau order (Dean's two-board
 * fix, ruled 11/09/2026). ONE in every game this project has shipped, and TWO
 * per seat at two seats under `rules.economy.noticeBoardsBySeats`: the seat's
 * own suit's board first, because setup builds the starters before it deals the
 * extras, then the board drawn from the suits nobody is farming.
 *
 * ⛔ IT IS THE FUNCTION A CALLER WANTS WHENEVER THE QUESTION IS ABOUT BOARDS
 * RATHER THAN ABOUT A SEAT. `noticeBoardOf` below answers "your own suit's
 * board" and silently ignores the second one, which is right for a caller
 * asking whose farm this is and WRONG for an enumerator, a harvest, a stall
 * probe or a count of cards resting in public. The visit enumerator reads this
 * one.
 *
 * Throws on a seat with no board at all, exactly as `noticeBoardOf` does and
 * for the same reason: see the invariant note below.
 */
export function noticeBoardsOf(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  const boards = player(state, seat).tableau.filter(
    (x) => cardById(data, x.card).slot === 'noticeboard',
  );
  if (boards.length === 0) throw new Error(`Seat ${seat} has no Notice Board`);
  return boards;
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
 *
 * ⛔ IT IS THE SEAT'S OWN SUIT'S BOARD AND NOT "THE FIRST ONE IN THE TABLEAU"
 * (Dean's two-board fix, 11/09/2026). Those were the same building in every
 * game until that ruling, and the search was written as a `find` for the slot
 * alone; with a second board in the tableau a `find` answers whichever setup
 * happened to push first, which is a silent wrong answer rather than a loud
 * one. Asking for the suit says what every existing caller MEANT - the board
 * this seat's own farm prints, the one whose power is its own - and it is the
 * same building it always returned in every mode that lays out one board.
 *
 * ⚠️ A CALLER THAT MEANT "EVERY BOARD THIS SEAT HAS" MUST ASK
 * `noticeBoardsOf`, and a caller that meant "the board this visit named" must
 * ask `visitTargetOf`. Under the two-board arm this one is right for A21's
 * neighbours, for a rival-facing summary and for nothing else.
 */
export function noticeBoardOf(data: GameData, state: GameState, seat: Seat): BuildingState {
  const suit = player(state, seat).suit;
  const boards = noticeBoardsOf(data, state, seat);
  const own = boards.find((b) => cardById(data, b.card).suit === suit);
  if (!own) throw new Error(`Seat ${seat} has no Notice Board of its own suit`);
  return own;
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
