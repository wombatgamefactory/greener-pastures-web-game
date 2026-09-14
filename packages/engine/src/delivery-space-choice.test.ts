/**
 * ⭐ THE SPACE CHOICE AND THE CLOSING DRAW (Dean, ruled 14/09/2026), shipped
 * beside the delivery meeple on the same day.
 *
 *   - **THE SPACE CHOICE** (`rules.turn.deliverySpaceChoice`, shipped `true`): a
 *     delivery names EITHER free space of its tile, the 6 VP space (index 0) or
 *     the 3 VP space carrying the meeple (index 1). A first deliverer may take
 *     the 3 VP and the meeple and leave the 6 VP for somebody else.
 *   - **THE CLOSING DRAW** (`rules.turn.closingDrawPerCrate`, shipped `1`): the
 *     delivery that fills a tile's LAST free space draws one card per crate
 *     token, from that token's suit; a cornucopia from any deck in play at the
 *     closer's choice. ⚠️ A face-down crate draws from its PRINTED suit, which is
 *     a builder default and not Dean's ruling.
 *
 * ⛔ AND INERTNESS: with all six leaves pinned at their pre-ruling values (the
 * `overlays/pre-delivery-meeple-v1.overlay.json` game) three seeded random
 * playouts digest to exactly the values the engine produced at commit f0a0658
 * with no overlay: every legal-move list, every event and the final state.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';

import { deliverAnswers, doDeliver } from './actions.js';
import { Fx } from './fx.js';
import { apply, legalMoves, newGame } from './game.js';
import { answerTask, pendingAnswers } from './runtime.js';
import { freshTurn } from './setup.js';
import type { GameState, Move, Seat, Task } from './state.js';
import { deliveredAt, makeState } from './testkit.js';

const WHEAT: Seat = 0;
const ORCHARD: Seat = 1;

/** The reference-v18 game: all six leaves at their pre-ruling values, as the control overlay pins them. */
const before: GameData = loadGameData({
  name: 'pre-delivery-meeple-v1',
  schemaVersion: 1,
  set: {
    'rules.turn.deliveryMeepleSpace': null,
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    'rules.turn.deliverySpaceChoice': false,
    'rules.turn.closingDrawPerCrate': 0,
  },
});

/** The shipped game with ONE of the two new rules switched off. */
const noChoice: GameData = loadGameData({
  name: 'no-space-choice',
  schemaVersion: 1,
  set: { 'rules.turn.deliverySpaceChoice': false },
});
const noDraw: GameData = loadGameData({
  name: 'no-closing-draw',
  schemaVersion: 1,
  set: { 'rules.turn.closingDrawPerCrate': 0 },
});

/** Move ids from a deck straight into a barn (testkit-style surgery). */
function stockBarn(state: GameState, seat: Seat, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

function tileOf(state: GameState, id: string) {
  const tile = state.island.tiles.find((t) => t.tile === id);
  if (!tile) throw new Error(`no tile ${id}`);
  return tile;
}

function delivers(g: GameData, state: GameState, tile: string) {
  return legalMoves(g, state).filter(
    (m): m is Extract<Move, { type: 'deliver' }> => m.type === 'deliver' && m.tile === tile,
  );
}

/** Clear the queue the way a player would, then hand the turn over. */
function nextTurn(g: GameData, state: GameState, seat: Seat): GameState {
  let s = state;
  for (let guard = 0; guard < 20 && s.tasks.length > 0; guard++) {
    const head = s.tasks[0] as Task;
    const answers = pendingAnswers(g, s);
    const skip = answers.find((a) => a.kind === 'skip');
    s = answerTask(g, s, head.t === 'mint' && skip ? skip : answers[0]!).state;
  }
  s.turn = freshTurn();
  s.turnPlayer = seat;
  return s;
}

function closingDraws(state: GameState) {
  return state.tasks.filter(
    (t): t is Extract<Task, { t: 'draw' }> => t.t === 'draw' && t.via === 'closingDraw',
  );
}

describe('the space choice (Dean, 14/09/2026)', () => {
  it('offers both spaces on an untouched tile, and every move names its space', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const moves = delivers(data, s, 'A1');
    expect(moves.map((m) => m.space).sort()).toEqual([0, 1]);
    // The same payment both times: the space is the only thing that differs.
    expect(new Set(moves.map((m) => JSON.stringify(m.spend))).size).toBe(1);
  });

  it('offers only the space left once one is taken, and refuses the taken one', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const three = delivers(data, s, 'A1').find((m) => m.space === 1)!;
    let g = nextTurn(data, apply(data, s, three).state, ORCHARD);
    stockBarn(g, ORCHARD, 'wheat', 8);
    expect(delivers(data, g, 'A1').map((m) => m.space)).toEqual([0]);
    const taken: Move = {
      type: 'deliver',
      seat: ORCHARD,
      tile: 'A1',
      spend: { wheat: 4 },
      space: 1,
    };
    expect(() => apply(data, g, taken)).toThrow(/space 1 on A1 is taken/);
    g = apply(data, g, { ...taken, space: 0 }).state;
    expect(tileOf(g, 'A1').deliveredBy).toEqual([WHEAT, ORCHARD]);
    expect(tileOf(g, 'A1').deliveredSpaces).toEqual([1, 0]);
  });

  it('pays the VP and the meeple of the space taken, not of the arrival', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const meeple = tileOf(s, 'A1').meeples[0]!;
    stockBarn(s, WHEAT, 'wheat', 4);
    // The FIRST arrival takes the 3 VP space, and with it the meeple.
    const first = apply(data, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 4 },
      space: 1,
    });
    expect(first.state.players[WHEAT]!.receipts).toEqual([3]);
    expect(first.events).toContainEqual({
      e: 'meepleGained',
      seat: WHEAT,
      colour: meeple,
      tile: 'A1',
      space: 1,
    });
    expect(first.events).toContainEqual({
      e: 'delivered',
      seat: WHEAT,
      tile: 'A1',
      vp: 3,
      spend: { wheat: 4 },
      space: 1,
    });
    // The SECOND arrival takes the 6 VP space that was left, and no meeple.
    const g = nextTurn(data, first.state, ORCHARD);
    stockBarn(g, ORCHARD, 'wheat', 4);
    const second = apply(data, g, {
      type: 'deliver',
      seat: ORCHARD,
      tile: 'A1',
      spend: { wheat: 4 },
      space: 0,
    });
    expect(second.state.players[ORCHARD]!.receipts).toEqual([6]);
    expect(second.events.some((e) => e.e === 'meepleGained')).toBe(false);
  });

  it('a move that names no space takes the lowest free one', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    deliveredAt(s, ORCHARD, 'A1');
    tileOf(s, 'A1').deliveredSpaces = [1];
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(data, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.players[WHEAT]!.receipts).toEqual([6]);
    expect(tileOf(out.state, 'A1').deliveredSpaces).toEqual([1, 0]);
  });

  it('carries the space on the deliver task answers too (a board power, a card, a meeple)', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const answers = deliverAnswers(data, s, WHEAT).filter(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    );
    expect(answers.map((a) => (a.kind === 'deliver' ? a.space : null)).sort()).toEqual([0, 1]);
  });

  it('V14 taking every receipt takes every free space and names none', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 8);
    const fx = new Fx(data, s, WHEAT);
    expect(() => doDeliver(fx, WHEAT, 'A1', { wheat: 4 }, undefined, 2, undefined, {}, 1)).toThrow(
      /several receipts cannot name a space/,
    );
    doDeliver(fx, WHEAT, 'A1', { wheat: 4 }, undefined, 2);
    expect(s.players[WHEAT]!.receipts).toEqual([6, 3]);
    expect(tileOf(s, 'A1').deliveredSpaces).toEqual([0, 1]);
  });

  it('is fill order exactly with the knob off: no space on any move, nothing stored', () => {
    const s = makeState(noChoice, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const moves = delivers(noChoice, s, 'A1');
    expect(moves).toHaveLength(1);
    expect(Object.hasOwn(moves[0]!, 'space')).toBe(false);
    expect(() => apply(noChoice, s, { ...moves[0]!, space: 1 })).toThrow(
      /only under rules.turn.deliverySpaceChoice/,
    );
    const out = apply(noChoice, s, moves[0]!);
    expect(out.state.players[WHEAT]!.receipts).toEqual([6]);
    expect(Object.hasOwn(tileOf(out.state, 'A1'), 'deliveredSpaces')).toBe(false);
    const delivered = out.events.find((e) => e.e === 'delivered')!;
    expect(Object.hasOwn(delivered, 'space')).toBe(false);
  });
});

describe('the closing draw (Dean, 14/09/2026)', () => {
  it('draws one card per crate from each crate suit when a tile fills, and not before', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    expect(tileOf(s, 'A1').crates).toEqual(['wheat', 'wheat']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const first = apply(
      data,
      s,
      delivers(data, s, 'A1').find((m) => m.space === 0)!,
    );
    expect(closingDraws(first.state)).toEqual([]);

    const g = nextTurn(data, first.state, ORCHARD);
    stockBarn(g, ORCHARD, 'wheat', 4);
    const tops = g.decks.wheat.slice(0, 2);
    const closed = apply(data, g, delivers(data, g, 'A1')[0]!);
    // Taken off the deck at once, held in the task, and QUEUED AHEAD of the Store.
    expect(closed.state.decks.wheat.slice(0, 2)).not.toEqual(tops);
    expect(closed.state.tasks[0]).toMatchObject({
      t: 'draw',
      pid: ORCHARD,
      see: 2,
      keep: 2,
      revealed: tops,
      via: 'closingDraw',
    });
    const kept = answerTask(data, closed.state, { kind: 'keep', cards: tops });
    expect(kept.state.players[ORCHARD]!.hand).toEqual(expect.arrayContaining(tops));
    expect(kept.events).toContainEqual({
      e: 'cardsToHand',
      seat: ORCHARD,
      cards: tops,
      via: 'closingDraw',
    });
  });

  it("draws a cornucopia's card from any deck in play, the closer's choice", () => {
    const s = makeState(data, ['wheat', 'orchard']);
    tileOf(s, 'A1').crates = ['wild', 'orchard'];
    deliveredAt(s, ORCHARD, 'A1');
    stockBarn(s, WHEAT, 'wheat', 2);
    stockBarn(s, WHEAT, 'orchard', 2);
    const orchardTop = s.decks.orchard[0]!;
    const out = apply(data, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 2, orchard: 2 },
      space: 1,
    });
    const task = closingDraws(out.state)[0]!;
    expect(task).toMatchObject({ see: 2, keep: 2, revealed: [orchardTop] });
    // The wild crate is a DECK PICK, over every deck with a card left.
    const picks = pendingAnswers(data, out.state);
    expect(picks.every((a) => a.kind === 'deck')).toBe(true);
    expect(picks).toContainEqual({ kind: 'deck', suit: 'dairy' });
    const dairyTop = out.state.decks.dairy[0]!;
    const picked = answerTask(data, out.state, { kind: 'deck', suit: 'dairy' }).state;
    const kept = answerTask(data, picked, { kind: 'keep', cards: [orchardTop, dairyTop] }).state;
    expect(kept.players[WHEAT]!.hand).toEqual(expect.arrayContaining([orchardTop, dairyTop]));
  });

  it('draws a face-down crate from its PRINTED suit (a builder default, not ruled)', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    tileOf(s, 'A1').faceDown = [true, false];
    deliveredAt(s, ORCHARD, 'A1');
    stockBarn(s, WHEAT, 'wheat', 4);
    const tops = s.decks.wheat.slice(0, 2);
    const out = apply(data, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(closingDraws(out.state)[0]).toMatchObject({ see: 2, revealed: tops });
  });

  it('closes the tile and draws when V14 takes both receipts at once', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    doDeliver(new Fx(data, s, WHEAT), WHEAT, 'A1', { wheat: 4 }, undefined, 2);
    expect(closingDraws(s)).toHaveLength(1);
    expect(closingDraws(s)[0]).toMatchObject({ pid: WHEAT, see: 2 });
  });

  it('draws nothing at closingDrawPerCrate 0', () => {
    const s = makeState(noDraw, ['wheat', 'orchard']);
    deliveredAt(s, ORCHARD, 'A1');
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(noDraw, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(tileOf(out.state, 'A1').deliveredBy).toHaveLength(2);
    expect(closingDraws(out.state)).toEqual([]);
  });
});

/**
 * A seeded random playout, digested: every legal-move list, every event and the
 * final state, FNV-1a over their JSON. The same function ran against commit
 * f0a0658 with no overlay (14/09/2026) and produced the constants below, which
 * is what makes this a proof that the six pinned leaves change nothing rather
 * than a snapshot of whatever the code does today.
 */
function playoutDigest(g: GameData, seats: number, seed: string, maxMoves: number): string {
  const fnv = (h: number, text: string): number => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  let state = newGame(g, { seats, seed });
  let h = fnv(2166136261, JSON.stringify(state));
  let x = 12345 + seats;
  let delivered = 0;
  for (let n = 0; n < maxMoves && state.phase === 'playing'; n++) {
    const moves = legalMoves(g, state);
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const move = moves[x % moves.length]!;
    h = fnv(h, JSON.stringify(moves));
    const out = apply(g, state, move);
    h = fnv(h, JSON.stringify(out.events));
    for (const e of out.events) if (e.e === 'delivered') delivered += 1;
    state = out.state;
  }
  h = fnv(h, JSON.stringify(state));
  return `${h.toString(16)} delivered=${delivered} phase=${state.phase}`;
}

describe('inertness: all six leaves pinned off is the reference-v18 game', () => {
  it.each([
    [2, '374b6ec0 delivered=8 phase=playing'],
    [3, 'fbdba7a5 delivered=13 phase=ended'],
    [4, 'fdf14240 delivered=15 phase=ended'],
  ])('replays a %ip random playout byte for byte against commit f0a0658', (seats, digest) => {
    expect(playoutDigest(before, seats, `inert-${seats}`, 3000)).toBe(digest);
  });

  it('seeds no meeple, stores no space and names no space under the pins', () => {
    const s = makeState(before, ['wheat', 'orchard']);
    expect(s.island.tiles.every((t) => t.meeples.length === 0)).toBe(true);
    deliveredAt(s, ORCHARD, 'A1');
    stockBarn(s, WHEAT, 'wheat', 4);
    const moves = delivers(before, s, 'A1');
    expect(moves.some((m) => Object.hasOwn(m, 'space'))).toBe(false);
    const out = apply(before, s, moves[0]!);
    expect(out.state.players[WHEAT]!.receipts).toEqual([3]);
    expect(Object.hasOwn(tileOf(out.state, 'A1'), 'deliveredSpaces')).toBe(false);
    expect(closingDraws(out.state)).toEqual([]);
  });
});
