/**
 * Read-only questions about a (data, state) pair. Everything here is derived on
 * demand - clogged-ness, thresholds, upgrade counts - because stored state is
 * only what a camera pointed at the table could not reconstruct.
 */

import type { Card, CardFace, GameData, HiredWorker, Suit } from '@gp/data';

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

/** The face currently showing: starters flip, deck cards have one printed side. */
export function faceOf(data: GameData, building: BuildingState): CardFace {
  const card = cardById(data, building.card);
  if (card.faces) return building.upgraded ? card.faces.upgraded : card.faces.starter;
  return {
    name: card.name,
    printedVp: card.printedVp ?? 0,
    threshold: card.threshold ?? null,
    activationType: card.activationType ?? null,
    abilityText: card.abilityText ?? null,
  };
}

export function thresholdOf(data: GameData, building: BuildingState): number | null {
  return faceOf(data, building).threshold;
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
 * The CROP a building prints on its showing face - ticket 07's rule for every
 * "buildings of crop X" count in the game, so it is never derived twice.
 *
 * A deck card prints its crop icon. A starter prints the generic
 * starting-building icon on its base face and its crop icon only once flipped
 * (verified in print by ticket 13: all 15 base faces carry `card_starter.png`,
 * all 15 upgraded faces carry `suit_<crop>.png`). So a BASE starter belongs to
 * no crop at all: it counts neither for its crop nor against it, and the £2
 * upgrade sinks buy a crop icon as well as their printed rider.
 *
 * Not the keyword sub-types - FIELD, DEPOT, ORCHARD, HIVE come from title
 * keywords and are untouched by this.
 */
export function cropOf(data: GameData, building: BuildingState): Suit | null {
  const card = cardById(data, building.card);
  if (card.type === 'starter') return building.upgraded ? card.suit : null;
  return card.suit;
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

export function workerData(data: GameData, id: string): HiredWorker {
  const w = data.workers.roster.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown worker ${id}`);
  return w;
}

/**
 * A seat's SERVICE building - its fourth starter, the one a rival may place a
 * card on to buy its action.
 *
 * Throws for the same reason noticeBoardOf does: every seat has one for the
 * whole game (nothing in the game removes a starter since ticket 30), so a miss
 * is a broken invariant and must not be averaged over by a balance run.
 */
export function serviceOf(data: GameData, state: GameState, seat: Seat): BuildingState {
  const b = player(state, seat).tableau.find((x) => cardById(data, x.card).slot === 'service');
  if (!b) throw new Error(`Seat ${seat} has no Service`);
  return b;
}

/** The Service action a seat owns, from its suit. Every seat owns exactly one. */
export function serviceIdOf(data: GameData, state: GameState, seat: Seat): string {
  const suit = player(state, seat).suit;
  const svc = data.workers.roster.find((w) => w.linkedSuit === suit);
  if (!svc) throw new Error(`No Service for suit ${suit}`);
  return svc.id;
}

/**
 * The building a visit's fee lands on. The payoff mode picks it: a Service visit
 * puts the card on the Service (so popularity clogs the thing being bought), a
 * coin visit puts it on the Notice Board. They clog independently, which is the
 * whole reason there are two.
 */
export function visitTargetOf(
  data: GameData,
  state: GameState,
  host: Seat,
  mode: 'coin' | 'worker' | 'special',
): BuildingState {
  return mode === 'worker' ? serviceOf(data, state, host) : noticeBoardOf(data, state, host);
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
 * Only the three starters upgrade (Barn, Farmstead, Notice Board; the free
 * Farmstead flip counts) - ticket 06 ruling C, so endgame "upgraded buildings"
 * counts cap at 9 VP.
 */
export function upgradedBuildingCount(state: GameState, seat: Seat): number {
  return player(state, seat).tableau.filter((b) => b.upgraded).length;
}

/**
 * The Orchard Farmstead suit power as a DRAW MODIFIER (the reference's
 * `Farmstead::orchardDraw`, DL-34), REBUILT 2026-08-09.
 *
 * Both faces now read "Your Draw is Draw 3, discard 1", so the modifier is
 * `see +1, keep +1` on BOTH - the upgrade stopped being a bigger number and
 * became £1 per card given away, which lives in the divert seam and not here.
 * Applied where a Draw ACTION's numbers are set - the base Draw and the Draw
 * Service (suit powers apply to Service actions) - so it composes:
 * (2,1)->(3,2), Draw Service (2,2)->(3,3). Deliberately NOT applied to
 * card-ability draws (DL-47); handlers push their printed numbers directly.
 *
 * ⚠️ This makes the BASE Farmstead strictly stronger than it was (a keep of 2
 * from turn 1 where it used to be a keep of 1). Expected, and it is exactly why
 * the upgrade had to stop being a bigger number.
 */
export function withDrawModifier(
  data: GameData,
  state: GameState,
  seat: Seat,
  spec: { see: number; keep: number },
): { see: number; keep: number } {
  const p = player(state, seat);
  if (p.suit !== 'orchard') return spec;
  const farmstead = p.tableau.find((b) => cardById(data, b.card).slot === 'farmstead');
  if (!farmstead) return spec;
  return { see: spec.see + 1, keep: spec.keep + 1 };
}

/**
 * The OTHER half of the rebuilt Orchard Farmstead: "when one of your draws
 * discards a card, give it to a neighbour instead", and on the upgraded face
 * "and take £1 from the bank".
 *
 * Returns the coins the giver mints per card given (0 base, 1 upgraded), or
 * null when the seat has no such power.
 *
 * THE WORDING SCOPES ITSELF, which is why there is no exception list. The base
 * Draw is see 2 keep 1, which with the modifier becomes see 3 keep 2 - one
 * discard, one gift. A Service's Draw 2 is see 2 keep 2, which becomes see 3
 * keep 3 - no discard, so there is nothing to give. Card-ability draws already
 * bypass the modifier under DL-47. And the end-of-turn discard to hand limit is
 * not a draw, which closes the four-cards-for-£4 exploit with no special case at
 * all: `discardOrDivert` passes `fromDraw: false` there and this power is not
 * offered.
 */
export function drawGiftPower(data: GameData, state: GameState, seat: Seat): number | null {
  const p = player(state, seat);
  if (p.suit !== 'orchard') return null;
  const farmstead = p.tableau.find((b) => cardById(data, b.card).slot === 'farmstead');
  if (!farmstead) return null;
  return farmstead.upgraded ? data.rules.economy.giftDiscardCoins : 0;
}

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
