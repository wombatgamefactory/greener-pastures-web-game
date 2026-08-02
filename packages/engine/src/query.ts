/**
 * Read-only questions about a (data, state) pair. Everything here is derived on
 * demand - clogged-ness, thresholds, upgrade counts - because stored state is
 * only what a camera pointed at the table could not reconstruct.
 */

import type { Card, CardFace, GameData, HiredWorker, Suit } from '@gp/data';

import type { BuildingState, CardId, GameState, PlayerState, Seat, WorkerState } from './state.js';

export function cardById(data: GameData, id: CardId): Card {
  const card = data.cards.catalogue.find((c) => c.id === id);
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

export function fullBuildings(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isFull(data, b));
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
