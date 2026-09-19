/**
 * The five Helping Hands (W18, A18, D18, O18, V18), built 16/09/2026 off the
 * v42 sheet; D18 RETEXTED on v44 (18/09/2026).
 *
 * Each card is tested on the route its trigger actually arrives by: W18
 * through the engine's own per-turn count (`Fx.harvest`), D18 through
 * `placeBuilt` directly with the spent cards staged in their suits' discards
 * first (`fx.discard`) exactly as `divertOrDiscard` would leave them, A18
 * through a real placement, O18 through the turn boundary, and V18 through a
 * real delivery, so the barn it reads is the barn AFTER the crate was paid.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { placeBuilt } from '../actions/build.js';
import { Fx } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, pendingAnswers } from '../runtime.js';
import { player } from '../query.js';
import type { CardId, GameState, Move, Seat, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

function tasksFrom(state: GameState, src: CardId): Task[] {
  return state.tasks.filter((t) => 'src' in t && t.src === src);
}

/** Move specific deck cards straight into a barn. */
function barnTo(state: GameState, seat: Seat, ...cards: CardId[]): void {
  dealTo(data, state, seat, ...cards);
  const p = player(state, seat);
  p.hand = p.hand.filter((c) => !cards.includes(c));
  p.barn.push(...cards);
}

/** Answer head tasks with their first legal answer until the queue is empty. */
function drain(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
    const head = s.tasks[0] as Task;
    const answer = pendingAnswers(data, s)[0] as TaskAnswer;
    s = apply(data, s, { type: 'task', seat: head.pid, answer }).state;
  }
  return s;
}

describe('W18 - Harvest two or more of your buildings, Draw 3', () => {
  function position(): GameState {
    const s = makeState(data, ['wheat', 'apiary']);
    buildFor(data, s, 0, 'W18', 'W4', 'W5', 'W6');
    for (const b of ['W4', 'W5', 'W6'] as CardId[]) loadStack(data, s, 0, b, 2, 'orchard');
    return s;
  }

  it('draws 3 on the SECOND harvest of the turn, and not on the first or the third', () => {
    const s = position();
    const fx = new Fx(data, s, 0);
    fx.harvest(0, 'W4');
    expect(s.turn.harvestsThisTurn).toBe(1);
    expect(tasksFrom(s, 'W18')).toEqual([]);
    fx.harvest(0, 'W5');
    expect(s.turn.harvestsThisTurn).toBe(2);
    expect(tasksFrom(s, 'W18')).toEqual([
      { t: 'draw', pid: 0, src: 'W18', see: 3, keep: 3, revealed: [] },
    ]);
    fx.harvest(0, 'W6');
    expect(tasksFrom(s, 'W18')).toHaveLength(1);
  });

  it('counts a harvest made before W18 was built (the engine keeps the count)', () => {
    const s = makeState(data, ['wheat', 'apiary']);
    buildFor(data, s, 0, 'W4', 'W5');
    loadStack(data, s, 0, 'W4', 2, 'orchard');
    loadStack(data, s, 0, 'W5', 2, 'orchard');
    const fx = new Fx(data, s, 0);
    fx.harvest(0, 'W4');
    buildFor(data, s, 0, 'W18');
    fx.harvest(0, 'W5');
    expect(tasksFrom(s, 'W18')).toHaveLength(1);
  });

  it('never counts off its owner turn', () => {
    const s = position();
    s.turnPlayer = 1;
    const fx = new Fx(data, s, 1);
    fx.harvest(0, 'W4');
    fx.harvest(0, 'W5');
    expect(s.turn.harvestsThisTurn).toBeUndefined();
    expect(tasksFrom(s, 'W18')).toEqual([]);
  });

  it('is absent from a fresh turn', () => {
    expect('harvestsThisTurn' in makeState(data, ['wheat', 'apiary']).turn).toBe(false);
  });
});

describe('A18 - fill one of your buildings, sow a deck top onto another', () => {
  function position(): GameState {
    const s = makeState(data, ['apiary', 'wheat']);
    // A5 threshold 2 holding 1; A6 threshold 3 holding 1.
    buildFor(data, s, 0, 'A18', 'A5', 'A6');
    loadStack(data, s, 0, 'A5', 1, 'orchard');
    loadStack(data, s, 0, 'A6', 1, 'orchard');
    return s;
  }

  it('fires when a placement brings a stack exactly to its threshold', () => {
    const s = position();
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    const [task] = tasksFrom(s, 'A18');
    expect(task).toMatchObject({ t: 'sowFromDeck', pid: 0, remaining: 1 });
    // Any of your buildings bar the one just filled, and never a Notice Board.
    const targets = task?.t === 'sowFromDeck' ? (task.targets ?? []).map((r) => r.card) : [];
    expect(targets).toEqual(['A6']);
  });

  it('does not fire on a placement that leaves the building short of full', () => {
    const s = position();
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A6' });
    expect(tasksFrom(s, 'A18')).toEqual([]);
  });

  it('does not fire off its owner turn, nor with nowhere to sow', () => {
    const rival = position();
    rival.turnPlayer = 1;
    new Fx(data, rival, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(rival, 'A18')).toEqual([]);

    const alone = makeState(data, ['apiary', 'wheat']);
    buildFor(data, alone, 0, 'A18', 'A5');
    loadStack(data, alone, 0, 'A5', 1, 'orchard');
    new Fx(data, alone, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(alone, 'A18')).toEqual([]);
  });

  it('chains (builder default): its own sow can fill another building and fire again', () => {
    const s = position();
    loadStack(data, s, 0, 'A6', 1, 'orchard'); // A6 now 2 of 3
    buildFor(data, s, 0, 'A4'); // threshold 4, empty: the chain's second landing
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    const onto = pendingAnswers(data, s).find(
      (a) => a.kind === 'deckSow' && a.onto === 'A6' && a.suit === 'dairy',
    );
    expect(onto).toBeDefined();
    const out = answerTask(data, s, onto as TaskAnswer).state;
    const again = tasksFrom(out, 'A18');
    expect(again).toHaveLength(1);
    const targets =
      again[0]?.t === 'sowFromDeck' ? (again[0].targets ?? []).map((r) => r.card) : [];
    // A5 is full and A6 has just filled, so only A4 is left to take the card.
    expect(targets).toEqual(['A4']);
  });
});

describe('D18 - whenever you build a card that costs 3+ resources, add 1 spent card to your Barn (RETEXTED v44, 18/09/2026)', () => {
  it('fires on a 3-resource build, offers every spent card, and moves the chosen one to the barn', () => {
    const s = makeState(data, ['dairy', 'wheat']);
    buildFor(data, s, 0, 'D18');
    const fx = new Fx(data, s, 0);
    // D9 The Prosperity Wagon costs 3 (2 dairy + 1 any) - qualifies at "3 or more".
    const spent: CardId[] = ['D5', 'D6', 'W4'];
    fx.discard(spent);
    placeBuilt(fx, 0, 'D9', spent);
    expect(tasksFrom(s, 'D18')).toHaveLength(1);

    const answers = pendingAnswers(data, s);
    expect(answers).toEqual(spent.map((card) => ({ kind: 'card', payload: { card } })));
    const pick = answers.find((a) => a.kind === 'card' && a.payload.card === 'W4') as TaskAnswer;
    const out = answerTask(data, s, pick).state;
    expect(player(out, 0).barn).toEqual(['W4']);
    expect(out.discards.wheat).toEqual([]);
    expect(out.discards.dairy.sort()).toEqual(['D5', 'D6']);
    expect(out.tasks).toEqual([]);
  });

  it('does not fire on a build costing fewer than 3 resources', () => {
    const s = makeState(data, ['dairy', 'wheat']);
    buildFor(data, s, 0, 'D18');
    const fx = new Fx(data, s, 0);
    // D4 The Milking Shed costs 1.
    fx.discard(['D7']);
    placeBuilt(fx, 0, 'D4', ['D7']);
    expect(tasksFrom(s, 'D18')).toEqual([]);
  });

  it('fires TWICE in one turn on two qualifying builds - the fire-once rule is deleted', () => {
    const s = makeState(data, ['dairy', 'wheat']);
    buildFor(data, s, 0, 'D18');
    const fx = new Fx(data, s, 0);
    fx.discard(['D5', 'D6', 'W4']);
    placeBuilt(fx, 0, 'D9', ['D5', 'D6', 'W4']); // D9: 2 dairy + 1 any, cost 3
    fx.discard(['D7', 'D8', 'W5']);
    placeBuilt(fx, 0, 'D11', ['D7', 'D8', 'W5']); // D11 The Heritage House: also cost 3
    expect(tasksFrom(s, 'D18')).toHaveLength(2);
  });

  it('is owner-scoped, never a rival\'s build: unlike the old card this has no "on your turn" gate (matches D16 The Ledger)', () => {
    const s = makeState(data, ['dairy', 'wheat']);
    buildFor(data, s, 0, 'D18');
    const fx = new Fx(data, s, 1);
    fx.discard(['D5', 'D6', 'W4']);
    placeBuilt(fx, 1, 'D9', ['D5', 'D6', 'W4']);
    expect(tasksFrom(s, 'D18')).toEqual([]);
  });

  it('has nothing to add when the build spent no cards', () => {
    const s = makeState(data, ['dairy', 'wheat']);
    buildFor(data, s, 0, 'D18');
    const fx = new Fx(data, s, 0);
    placeBuilt(fx, 0, 'D9', []);
    expect(tasksFrom(s, 'D18')).toEqual([]);
  });
});

describe('O18 - at the end of your turn, Draw up to 3 cards in hand', () => {
  function endOfTurn(hand: CardId[]): GameState {
    const s = makeState(data, ['orchard', 'wheat']);
    buildFor(data, s, 0, 'O18');
    dealTo(data, s, 0, ...hand);
    s.turn.actionSpent = true;
    return apply(data, s, { type: 'endTurn', seat: 0 }).state;
  }

  it('suspends the turn end with a Draw for the shortfall, then ends the turn', () => {
    const held = endOfTurn(['O4']);
    expect(held.turnPlayer).toBe(0);
    expect(held.resume).toBe('turnflow');
    expect(tasksFrom(held, 'O18')).toEqual([
      { t: 'draw', pid: 0, src: 'O18', see: 2, keep: 2, revealed: [] },
    ]);
    const after = drain(held);
    expect(after.turnPlayer).toBe(1);
    expect(player(after, 0).hand).toHaveLength(3);
    // Fired once: the second pass through the boundary skipped the hook.
    expect(after.tasks).toEqual([]);
  });

  it('draws 3 from an empty hand and nothing from a hand of 3', () => {
    expect(tasksFrom(endOfTurn([]), 'O18')[0]).toMatchObject({ see: 3, keep: 3 });
    const full = endOfTurn(['O4', 'O5', 'O6']);
    expect(full.tasks).toEqual([]);
    expect(full.turnPlayer).toBe(1);
  });

  it('never fires on a rival turn end', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    buildFor(data, s, 1, 'O18');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: 0 }).state;
    expect(out.tasks).toEqual([]);
    expect(out.turnPlayer).toBe(1);
  });

  it('runs before the hand-limit discard, which still follows it', () => {
    // A hand already over the limit: O18 draws nothing, the discard still comes.
    const s = makeState(data, ['orchard', 'wheat']);
    buildFor(data, s, 0, 'O18');
    dealTo(data, s, 0, 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10', 'O11');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: 0 }).state;
    expect(out.turn.endHooksDone).toBe(true);
    expect(out.tasks.map((t) => t.t)).toEqual(['discard']);
  });
});

describe('V18 - after you Deliver, with 1 or fewer barn cards, Draw 3', () => {
  function deliverPosition(extra: CardId[]): { s: GameState; move: Move } {
    const s = makeState(data, ['vegetable', 'wheat']);
    buildFor(data, s, 0, 'V18');
    const tile = s.island.tiles[0];
    if (tile === undefined) throw new Error('no tile');
    tile.tokens = [
      { demand: 'wheat', vp: 6, worker: null },
      { demand: 'orchard', vp: 5, worker: null },
    ];
    barnTo(s, 0, 'W4', 'W5', 'O4', 'O5', ...extra);
    const move = legalMoves(data, s).find(
      (m) => m.type === 'deliver' && m.tile === tile.tile,
    ) as Move;
    expect(move).toBeDefined();
    return { s, move };
  }

  it('reads the barn AFTER the crate is paid: one card left, Draw 3', () => {
    const { s, move } = deliverPosition(['A4']);
    const out = apply(data, s, move).state;
    expect(player(out, 0).barn).toEqual(['A4']);
    expect(tasksFrom(out, 'V18')).toEqual([
      { t: 'draw', pid: 0, src: 'V18', see: 3, keep: 3, revealed: [] },
    ]);
  });

  it('does nothing with two barn cards left', () => {
    const { s, move } = deliverPosition(['A4', 'A5']);
    expect(tasksFrom(apply(data, s, move).state, 'V18')).toEqual([]);
  });

  it('fires on an empty barn too', () => {
    const { s, move } = deliverPosition([]);
    expect(tasksFrom(apply(data, s, move).state, 'V18')).toHaveLength(1);
  });
});

describe('the five share a name and nothing else', () => {
  it('registers five different handlers, none granting a move or a bonus slot', () => {
    const ids: CardId[] = ['W18', 'A18', 'D18', 'O18', 'V18'];
    const handlers = ids.map((id) => handlerFor(id));
    expect(new Set(handlers).size).toBe(5);
    for (const [i, h] of handlers.entries()) {
      expect(h, ids[i]).toBeDefined();
      expect(h?.moves, ids[i]).toBeUndefined();
      expect(h?.difficulty.verified.prompts, ids[i]).toBe(true);
    }
  });

  it('a seat holding all five still has one bonus play', () => {
    const s = makeState(data, ['wheat', 'orchard', 'dairy']);
    buildFor(data, s, 0, 'W18', 'A18', 'D18', 'O18', 'V18');
    dealTo(data, s, 0, 'W7', 'W9');
    const visit = legalMoves(data, s).find((m) => m.type === 'visit') as Move;
    expect(visit).toBeDefined();
    const after = drain(apply(data, s, visit).state);
    expect(after.turn.bonusUsed).toHaveLength(1);
    expect(legalMoves(data, after).some((m) => m.type === 'visit')).toBe(false);
  });
});
