/**
 * ⭐ THE TOKEN ISLAND AND THE TWO BOARD RETEXTS (Dean, rulings R3, R6, R7, R9
 * and R10 of 16/09/2026; docs/vegetable-token-island-handoff-2026-09-16-v1.md).
 *
 * The first and second delivery, the token choice, wild tokens, the end
 * trigger and scoring live in `game.test.ts` beside the rest of the island.
 * This file carries the primitives later slices build on and the two board
 * powers:
 *
 *   - the TOKEN CHOICE on the deliver task's answers;
 *   - V14's `takeAll` (one payment, every token on the tile);
 *   - V5's token SWAP primitive;
 *   - R9: the Vegetable board's delivery, "2 of the cards may be any crop", and
 *     its fallback;
 *   - R10: the Dairy board's build, "spending cards of any crops, with a
 *     discount of 1" (cut from 2 to 1 on the v44 sheet, 18/09/2026).
 *
 * It replaces `delivery-space-choice.test.ts`, whose subject (the delivery
 * spaces and the 14/09/2026 space choice) was deleted with the crate island.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';

import { deliverAnswers, deliverOptions, doDeliver, tokenSwapOptions } from './actions.js';
import { Fx } from './fx.js';
import { apply, legalMoves } from './game.js';
import { pendingAnswers } from './runtime.js';
import type { CardId, GameEvent, GameState, Move, Seat, TaskAnswer } from './state.js';
import { dealTo, deliveredAt, makeState } from './testkit.js';

const VISITOR: Seat = 0;
const HOST: Seat = 1;

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

/** Visit the host's board for `board`, paying `fee` from hand. */
function visit(board: CardId, fee: CardId): Move {
  return { type: 'visit', seat: VISITOR, host: HOST, fee, board };
}

/** Answer the head task with `answer`. */
function answer(g: GameData, state: GameState, a: TaskAnswer): GameState {
  return apply(g, state, { type: 'task', seat: VISITOR, answer: a }).state;
}

describe('the token choice on the task answers', () => {
  it('names the token on every answer, highest VP first', () => {
    // Testkit island for these seats: A1 [wheat 6, wheat 5].
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, 0, 'wheat', 4);
    const answers = deliverAnswers(data, s, 0).filter(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    );
    expect(answers).toEqual([
      { kind: 'deliver', tile: 'A1', spend: { wheat: 4 }, token: 0 },
      { kind: 'deliver', tile: 'A1', spend: { wheat: 4 }, token: 1 },
    ]);
  });

  it('refuses a token the tile does not hold, before anything is paid', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, 0, 'wheat', 4);
    const move: Move = { type: 'deliver', seat: 0, tile: 'A1', spend: { wheat: 4 }, token: 2 };
    expect(() => apply(data, s, move)).toThrow(/has no token 2/);
    expect(s.players[0]!.barn).toHaveLength(4);
  });
});

describe("V14's primitive: take every token for one payment", () => {
  it('takes both tokens of a virgin tile for the same 4 cards, one event each', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, 0, 'wheat', 8);
    const fx = new Fx(data, s, 0);
    expect(() => doDeliver(fx, 0, 'A1', { wheat: 4 }, { takeAll: true, token: 0 })).toThrow(
      /names none/,
    );
    doDeliver(fx, 0, 'A1', { wheat: 4 }, { takeAll: true });
    expect(s.players[0]!.receipts).toEqual([
      { vp: 6, crop: 'wheat', tile: 'A1' },
      { vp: 5, crop: 'wheat', tile: 'A1' },
    ]);
    expect(s.players[0]!.barn).toHaveLength(4);
    expect(tileOf(s, 'A1').tokens).toEqual([]);
    expect(tileOf(s, 'A1').deliveredBy).toEqual([0, 0]);
    const delivered = fx.events.filter(
      (e): e is Extract<GameEvent, { e: 'delivered' }> => e.e === 'delivered',
    );
    expect(delivered.map((e) => e.spend)).toEqual([{ wheat: 4 }, {}]);
  });

  it('is an ordinary second delivery on a one-token tile', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    deliveredAt(s, 1, 'A1');
    stockBarn(s, 0, 'wheat', 2);
    stockBarn(s, 0, 'dairy', 2);
    const fx = new Fx(data, s, 0);
    doDeliver(fx, 0, 'A1', { wheat: 2, dairy: 2 }, { takeAll: true });
    expect(s.players[0]!.receipts.map((r) => r.vp)).toEqual([5]);
  });
});

describe("V5's primitive: swap two tokens between two island cards", () => {
  it('offers only pairs on DIFFERENT tiles, never an identical pair, and a lone token too', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    deliveredAt(s, 1, 'A1'); // A1 keeps its lone 5 VP token (builder default: swappable)
    deliveredAt(s, 1, 'A2', 'A2'); // A2 is finished
    const pairs = tokenSwapOptions(data, s);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) {
      expect(a.tile).not.toBe(b.tile);
      expect([a.tile, b.tile]).not.toContain('A2');
      expect(tileOf(s, a.tile).tokens[a.token]).not.toEqual(tileOf(s, b.tile).tokens[b.token]);
    }
    expect(pairs.some(([a, b]) => a.tile === 'A1' || b.tile === 'A1')).toBe(true);
  });

  it('moves each token whole, VP and Worker with it, and refuses one tile', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    // A1 [wheat 6, wheat 5]; B1 [orchard 4 + Worker, orchard 3 + Worker].
    const six = tileOf(s, 'A1').tokens[0]!;
    const four = tileOf(s, 'B1').tokens[0]!;
    const fx = new Fx(data, s, 0);
    fx.swapIslandTokens(0, { tile: 'A1', token: 0 }, { tile: 'B1', token: 0 });
    expect(tileOf(s, 'A1').tokens[0]).toEqual(four);
    expect(tileOf(s, 'B1').tokens[0]).toEqual(six);
    expect(fx.events).toContainEqual({
      e: 'demandSwapped',
      seat: 0,
      a: { tile: 'A1', token: 0 },
      b: { tile: 'B1', token: 0 },
    });
    expect(() =>
      fx.swapIslandTokens(0, { tile: 'A1', token: 0 }, { tile: 'A1', token: 1 }),
    ).toThrow(/two different island cards/);
  });
});

describe('R9: the Vegetable board, "2 of the cards may be any crop"', () => {
  // Orchard visits Vegetable. The testkit island for these seats: A1 [orchard
  // 6, orchard 5], A5 [vegetable 6, vegetable 5], B1 [vegetable 4, 3], and so on.
  const seats: Suit[] = ['orchard', 'vegetable'];
  const plain: GameData = loadGameData({
    name: 'no-vegetable-wild-cards',
    schemaVersion: 1,
    set: { 'rules.economy.noticeBoardPower.vegetableWildCards': 0 },
  });

  function position(g: GameData): GameState {
    const s = makeState(g, seats);
    s.turnPlayer = VISITOR;
    dealTo(g, s, VISITOR, 'O4', 'O5');
    return s;
  }

  it('delivers with up to 2 cards off the named demand, and only through the board', () => {
    const s = position(data);
    stockBarn(s, VISITOR, 'orchard', 3);
    stockBarn(s, VISITOR, 'wheat', 1);
    // The plain Deliver cannot pay A1 (orchard x4): one card is off demand.
    expect(deliverOptions(data, s, VISITOR).some((o) => o.tile === 'A1')).toBe(false);
    const after = apply(data, s, visit('V3', 'O4')).state;
    expect(after.tasks[0]).toMatchObject({ t: 'deliver', pid: VISITOR, wildCards: 2 });
    const pick = pendingAnswers(data, after).find(
      (a) => a.kind === 'deliver' && a.tile === 'A1' && a.token === 0,
    );
    expect(pick).toEqual({
      kind: 'deliver',
      tile: 'A1',
      spend: { orchard: 3, wheat: 1 },
      token: 0,
    });
    const out = apply(data, after, { type: 'task', seat: VISITOR, answer: pick as TaskAnswer });
    expect(out.state.players[VISITOR]!.receipts).toEqual([{ vp: 6, crop: 'orchard', tile: 'A1' }]);
    expect(out.events.find((e) => e.e === 'delivered')).toMatchObject({ wildUsed: 1 });
  });

  it('never allows more than 2 cards off demand', () => {
    const s = position(data);
    stockBarn(s, VISITOR, 'orchard', 1);
    stockBarn(s, VISITOR, 'wheat', 3);
    const after = apply(data, s, visit('V3', 'O4')).state;
    // No delivery is payable, so the board fires its fallback instead.
    expect(after.tasks[0]).toMatchObject({ t: 'handToBarn', pid: VISITOR, remaining: 2 });
  });

  /** ⚠️ BUILDER DEFAULT: on a second delivery all 4 cards may be of any crop. */
  it('lets the 2 any-crop cards cover the last token pair too (builder default)', () => {
    const s = position(data);
    deliveredAt(s, HOST, 'A1'); // A1 keeps orchard 5: orchard x2 plus 2 any
    stockBarn(s, VISITOR, 'wheat', 4);
    const after = apply(data, s, visit('V3', 'O4')).state;
    const answers = pendingAnswers(data, after).filter(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    );
    expect(answers).toEqual([{ kind: 'deliver', tile: 'A1', spend: { wheat: 4 }, token: 0 }]);
    const done = answer(data, after, answers[0] as TaskAnswer);
    expect(done.players[VISITOR]!.receipts.map((r) => r.vp)).toEqual([5]);
  });

  it('with the leaf at 0 the same barn gets the fallback, not a delivery', () => {
    const s = position(plain);
    stockBarn(s, VISITOR, 'orchard', 3);
    stockBarn(s, VISITOR, 'wheat', 1);
    const after = apply(plain, s, visit('V3', 'O4')).state;
    expect(after.tasks[0]).toMatchObject({ t: 'handToBarn', pid: VISITOR, remaining: 2 });
  });

  it('falls back to 2 hand cards into the barn with an empty barn', () => {
    const s = position(data);
    dealTo(data, s, VISITOR, 'O6');
    const after = apply(data, s, visit('V3', 'O4')).state;
    expect(after.tasks[0]).toMatchObject({ t: 'handToBarn', pid: VISITOR, remaining: 2 });
    const one = answer(data, after, pendingAnswers(data, after)[0] as TaskAnswer);
    const two = answer(data, one, pendingAnswers(data, one)[0] as TaskAnswer);
    expect(two.players[VISITOR]!.barn).toHaveLength(2);
  });
});

describe('R10: the Dairy board, "any crops, with a discount of 1" (CUT from 2 to 1 on v44, 18/09/2026)', () => {
  // Orchard visits Dairy.
  const seats: Suit[] = ['orchard', 'dairy'];

  it('builds a 3-cost card for 2 cards of any crop, and grows nothing after', () => {
    const s = makeState(data, seats);
    s.turnPlayer = VISITOR;
    // A9 costs 3 (2 apiary + 1 any). The hand holds two non-apiary cards to pay with.
    dealTo(data, s, VISITOR, 'O4', 'A9', 'W4', 'W5');
    const after = apply(data, s, visit('D3', 'O4')).state;
    expect(after.tasks[0]).toMatchObject({
      t: 'build',
      pid: VISITOR,
      mods: { discount: 1, substitute: true },
    });
    expect(after.tasks[0]).not.toHaveProperty('thenGrow');
    const build = pendingAnswers(data, after).find(
      (a) => a.kind === 'build' && a.card === 'A9',
    ) as TaskAnswer;
    expect(build).toEqual({ kind: 'build', card: 'A9', payment: ['W4', 'W5'] });
    const done = answer(data, after, build);
    expect(done.players[VISITOR]!.tableau.some((b) => b.card === 'A9')).toBe(true);
    expect(done.players[VISITOR]!.hand).toEqual([]);
    expect(done.tasks).toEqual([]);
  });

  it('is not offered when no build is payable even at the discount', () => {
    const s = makeState(data, seats);
    s.turnPlayer = VISITOR;
    // A9 still costs 2 after the discount, and the fee leaves no card to pay it.
    dealTo(data, s, VISITOR, 'O4', 'A9');
    const moves = legalMoves(data, s).filter(
      (m) => m.type === 'visit' && m.host === HOST && m.board === 'D3' && m.fee === 'O4',
    );
    expect(moves).toEqual([]);
  });
});
