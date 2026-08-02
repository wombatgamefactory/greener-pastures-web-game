/**
 * The game-walking proofs behind the policy layer (wayfinder ticket 28).
 *
 * They live in @gp/sim rather than beside the bots because they need a
 * `GameState` and a driver, and the whole guarantee of @gp/bots is that nothing
 * in it can reach one.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import type { Suit } from '@gp/data';
import type { CardId, GameState, Move, PlayerView, Seat } from '@gp/engine';
import { apply, legalMoves, newGame, viewFor } from '@gp/engine';
import type { PolicyId } from '@gp/bots';
import { actOf, makePolicy, policyRng } from '@gp/bots';
import { describe, expect, it } from 'vitest';

import { assignProfiles, runGame } from './driver.js';

const SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

function mirror(id: PolicyId, seats: number) {
  return Array.from({ length: seats }, () => id);
}

// --- view safety -----------------------------------------------------------

/**
 * Payload keys that hold something other than a card.
 *
 * Card ids and island tile ids share a namespace - `A5` is both the Apiary Barn
 * and a Level 1 tile - so an id alone cannot say which it is. Only V12's card
 * task carries a tile in a payload today; if another one appears, it lands here
 * rather than in the violation list.
 */
const NON_CARD_KEYS = new Set(['tile', 'balloon']);

/**
 * Card ids a move names, extracted structurally rather than by pattern, for the
 * reason above.
 */
function cardIdsIn(move: Move, catalogue: ReadonlySet<CardId>): CardId[] {
  const act = actOf(move);
  const fromPayload = (payload: Record<string, unknown>): CardId[] =>
    Object.entries(payload)
      .filter(([key]) => !NON_CARD_KEYS.has(key))
      .map(([, value]) => value)
      .filter((value): value is CardId => typeof value === 'string' && catalogue.has(value));
  switch (act.a) {
    case 'build':
      return [act.card, ...act.payment];
    case 'upgrade':
      return [act.card];
    case 'grow':
      return [act.building, act.payment];
    case 'harvest':
      return [act.building];
    case 'sow':
      return [act.card, act.onto];
    case 'keep':
    case 'discard':
      return [...act.cards];
    case 'visit':
      return [...act.fee];
    case 'cardMove':
      return [act.card, ...fromPayload(act.payload)];
    case 'cardTask':
      return fromPayload(act.payload);
    default:
      return [];
  }
}

/** Everything the acting seat is entitled to name: its own, or public. */
function knowableIds(view: PlayerView): Set<CardId> {
  const ok = new Set<CardId>(view.you.hand);
  for (const b of view.you.tableau) ok.add(b.card);
  for (const id of view.you.covered) ok.add(id);
  for (const rival of view.rivals) {
    for (const b of rival.tableau) ok.add(b.card);
    for (const id of rival.covered) ok.add(id);
  }
  for (const pile of Object.values(view.discards)) for (const id of pile) ok.add(id);
  // Your own in-flight draw: you have seen these, and `keep` answers name them.
  for (const task of view.tasks) {
    if (task.t === 'draw' && task.pid === view.seat) for (const id of task.revealed) ok.add(id);
  }
  return ok;
}

function walkForViewSafety(seed: string, seats: number, ids: PolicyId[]): number {
  const catalogue = new Set(data.cards.catalogue.map((c) => c.id));
  const policies = ids.map((id) => makePolicy(id));
  const rngs = policies.map((p, seat) => policyRng(seed, seat, p.id));
  let state: GameState = newGame(data, { seats, suits: SUITS.slice(0, seats), seed });
  let checked = 0;

  for (let step = 0; step < 900 && state.phase === 'playing'; step++) {
    const moves = legalMoves(data, state);
    if (moves.length === 0) break;
    const seat: Seat = (moves[0] as Move).seat;
    const view = viewFor(data, state, seat);
    const ok = knowableIds(view);
    for (const move of moves) {
      expect(move.seat).toBe(seat);
      for (const id of cardIdsIn(move, catalogue)) {
        if (!ok.has(id)) {
          throw new Error(
            `seat ${seat} was offered ${id} in ${JSON.stringify(move)} but cannot see it`,
          );
        }
        checked += 1;
      }
    }
    const policy = policies[seat];
    const rng = rngs[seat];
    if (!policy || !rng) throw new Error('missing policy');
    state = apply(data, state, policy.choose({ data, view, moves, rng })).state;
  }
  return checked;
}

describe('view safety', () => {
  it('never offers a seat a card id it cannot see', () => {
    // Ticket 10 argued the Move union is view-safe by construction. This is
    // what stops that being an assumption: a barn spend that leaked ids, or a
    // task answer naming a rival's hand, fails here.
    let checked = 0;
    checked += walkForViewSafety('vs-2', 2, mirror('balanced', 2));
    checked += walkForViewSafety('vs-3', 3, mirror('greedy', 3));
    checked += walkForViewSafety('vs-4', 4, assignProfiles('vs-4', 4));
    expect(checked).toBeGreaterThan(5000);
  });
});

// --- termination -----------------------------------------------------------

describe('termination', () => {
  it('finishes balanced mirrors at 2, 3 and 4 seats', () => {
    for (const seats of [2, 3, 4]) {
      const result = runGame(data, {
        seed: `end-${seats}`,
        seats,
        suits: SUITS.slice(0, seats),
        policies: mirror('balanced', seats),
      });
      expect(result.outcome).toBe('ended');
      expect(result.state.players.some((p) => p.receipts.includes(16))).toBe(true);
    }
  });

  it('finishes a mixed table at 2, 3 and 4 seats', () => {
    for (const seats of [2, 3, 4]) {
      const seed = `mixed-${seats}`;
      const result = runGame(data, {
        seed,
        seats,
        suits: SUITS.slice(0, seats),
        policies: assignProfiles(seed, seats),
      });
      expect(result.outcome).toBe('ended');
    }
  });

  it('never leaves pulse running: every game ends or provably stalls', () => {
    // Ticket 10 expected `pulse` to finish every game. It does not, and the
    // reason is not the Deliver priority: an undirected table drains every
    // deck, discard and hand into buildings and barns, after which no player
    // can draw, build, grow or visit and only `pass` is legal. Measured at
    // 40-60% of mirrored pulse games. The regression this test guards is the
    // one that IS in the bot's gift - `pulse` must never wander to the move
    // ceiling; it either reaches the Level 3 trigger or locks the table.
    for (const seats of [2, 3, 4]) {
      const result = runGame(data, {
        seed: `pulse-${seats}`,
        seats,
        suits: SUITS.slice(0, seats),
        policies: mirror('pulse', seats),
        maxMoves: 4000,
      });
      expect(result.outcome).not.toBe('maxMoves');
      if (result.outcome === 'stalled') {
        // The lock has one signature, and this is it.
        for (const suit of SUITS) {
          expect(result.state.decks[suit].length + result.state.discards[suit].length).toBe(0);
        }
        for (const player of result.state.players) expect(player.hand).toEqual([]);
      }
    }
  });
});

// --- determinism -----------------------------------------------------------

describe('determinism', () => {
  it('reproduces a bit-identical game from (seed, suits, policy assignment)', () => {
    const spec = {
      seed: 'repro',
      seats: 3,
      suits: SUITS.slice(0, 3),
      policies: assignProfiles('repro', 3),
    };
    const a = runGame(data, spec);
    const b = runGame(data, spec);
    expect(JSON.stringify(b.moves)).toBe(JSON.stringify(a.moves));
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it('replays the move log back to the same final state', () => {
    const result = runGame(data, {
      seed: 'replay',
      seats: 2,
      suits: ['wheat', 'orchard'],
      policies: mirror('balanced', 2),
    });
    let replayed = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'replay' });
    for (const move of result.moves) replayed = apply(data, replayed, move).state;
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(result.state));
  });

  it('assigns profiles deterministically from the run seed', () => {
    expect(assignProfiles('x', 4)).toEqual(assignProfiles('x', 4));
    expect(assignProfiles('x', 4)).not.toEqual(assignProfiles('y', 4));
    expect(assignProfiles('x', 3)).toHaveLength(3);
  });

  it('gives each seat its own stream, so mirrored bots still diverge', () => {
    const result = runGame(data, {
      seed: 'streams',
      seats: 2,
      suits: ['wheat', 'orchard'],
      policies: mirror('random', 2),
      maxMoves: 400,
    });
    const bySeat = [0, 1].map((seat) =>
      JSON.stringify(result.moves.filter((m) => m.seat === seat).map((m) => m.type)),
    );
    expect(bySeat[0]).not.toBe(bySeat[1]);
  });
});

// --- the speed budget ------------------------------------------------------

describe('the decision budget', () => {
  it('builds the view exactly once per decision', () => {
    // `viewFor` costs 31us against `apply`'s 18us, so a second call site - or a
    // policy calling it itself - blows the 50us budget on its own.
    let views = 0;
    const counting = (d: typeof data, s: GameState, seat: Seat) => {
      views += 1;
      return viewFor(d, s, seat);
    };
    const result = runGame(
      data,
      {
        seed: 'views',
        seats: 3,
        suits: SUITS.slice(0, 3),
        policies: mirror('balanced', 3),
        maxMoves: 300,
      },
      counting,
    );
    expect(views).toBe(result.decisions);
    expect(result.views).toBe(result.decisions);
  });

  it('keeps the scored evaluator inside 50us a decision', () => {
    const spec = {
      seed: 'speed',
      seats: 4,
      suits: SUITS.slice(0, 4),
      policies: mirror('balanced', 4),
      maxMoves: 600,
    };
    runGame(data, spec); // warm the JIT; the first game pays for compilation
    const result = runGame(data, spec);
    const perDecision = (result.chooseMs * 1000) / result.decisions;
    expect(result.decisions).toBeGreaterThan(200);
    expect(perDecision).toBeLessThan(50);
  });
});

// --- taste -----------------------------------------------------------------

describe('the archetypes', () => {
  it('gives the hermit control real teeth: it never visits', () => {
    // A hermit mirror SHOULD fail watch-list assertion 8 and mint nothing. If
    // this bot ever visits, the assertion has no control and the run that
    // "passes" it proves nothing.
    for (const seats of [2, 3]) {
      const result = runGame(data, {
        seed: `hermit-${seats}`,
        seats,
        suits: ['wheat', 'orchard', 'apiary'].slice(0, seats) as Suit[],
        policies: mirror('hermit', seats),
        maxMoves: 1500,
      });
      expect(result.moves.filter((m) => m.type === 'visit')).toEqual([]);
    }
  });

  it('makes the socialite visit far more than the balanced reference', () => {
    const visits = (id: PolicyId) => {
      const result = runGame(data, {
        seed: `taste-${id}`,
        seats: 3,
        suits: SUITS.slice(0, 3),
        policies: mirror(id, 3),
        maxMoves: 1500,
      });
      return result.moves.filter((m) => m.type === 'visit').length / result.moves.length;
    };
    expect(visits('socialite')).toBeGreaterThan(visits('balanced'));
  });
});

// --- explain ---------------------------------------------------------------

describe('explain', () => {
  it('breaks a decision down into terms that sum to its total', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'explain' });
    const moves = legalMoves(data, state);
    const view = viewFor(data, state, state.turnPlayer);
    const policy = makePolicy('balanced');
    const rows = policy.explain?.({ data, view, moves, rng: policyRng('explain', 0, 'balanced') });
    expect(rows).toBeDefined();
    expect(rows).toHaveLength(moves.length);
    for (const row of rows ?? []) {
      const summed = Object.values(row.terms).reduce((a, b) => a + b, 0);
      expect(summed).toBeCloseTo(row.total, 9);
    }
    // Best first, and the chosen move is one of the best.
    const best = (rows ?? [])[0];
    const chosen = policy.choose({ data, view, moves, rng: policyRng('explain', 0, 'balanced') });
    const chosenRow = (rows ?? []).find((r) => JSON.stringify(r.move) === JSON.stringify(chosen));
    expect(chosenRow?.total).toBeCloseTo(best?.total ?? 0, 9);
  });
});
