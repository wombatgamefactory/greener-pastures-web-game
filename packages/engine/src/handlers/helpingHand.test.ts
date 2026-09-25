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
import { Fx, fireHook } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, pendingAnswers } from '../runtime.js';
import { player } from '../query.js';
import type { CardId, GameState, Move, Seat, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

/** V18's own no-chain marker (R11), a field on `TurnState` - see helpingHand.ts. */
function v18Chain(state: GameState): boolean | undefined {
  return state.turn.v18Chain;
}

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

describe('A18 - fill a building, you may put a deck card into your Barn (v46, R8/R9)', () => {
  function position(): GameState {
    const s = makeState(data, ['apiary', 'wheat']);
    // A5 threshold 2 holding 1; A6 threshold 3 holding 1.
    buildFor(data, s, 0, 'A18', 'A5', 'A6');
    loadStack(data, s, 0, 'A5', 1, 'orchard');
    loadStack(data, s, 0, 'A6', 1, 'orchard');
    return s;
  }

  it('fires when a placement brings a stack exactly to its threshold, and puts a deck card straight in the Barn - filling nothing', () => {
    const s = position();
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    const [task] = tasksFrom(s, 'A18');
    // R8: the shared deckToBarn primitive (A13, V16), not sowFromDeck. No
    // building target rides on the task any more.
    expect(task).toMatchObject({ t: 'card', pid: 0, kind: 'deckToBarn', riders: { remaining: 1 } });
    const answers = pendingAnswers(data, s);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const pick = answers.find((a) => a.kind === 'card' && a.payload.suit === 'dairy') as TaskAnswer;
    const before = player(s, 0).barn.length;
    const out = answerTask(data, s, pick).state;
    expect(player(out, 0).barn).toHaveLength(before + 1);
    expect(tasksFrom(out, 'A18')).toEqual([]);
    // Filling nothing: the building A18 sowed onto in the old text (A6) is untouched.
    const a6 = player(out, 0).tableau.find((b) => b.card === 'A6');
    expect(a6?.stack).toHaveLength(1);
  });

  it('does not fire on a placement that leaves the building short of full', () => {
    const s = position();
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A6' });
    expect(tasksFrom(s, 'A18')).toEqual([]);
  });

  it('does not fire off its owner turn', () => {
    const rival = position();
    rival.turnPlayer = 1;
    new Fx(data, rival, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(rival, 'A18')).toEqual([]);
  });

  it('fires with only one building on the farm (R9: the "another building with room" gate is gone)', () => {
    const alone = makeState(data, ['apiary', 'wheat']);
    buildFor(data, alone, 0, 'A18', 'A5');
    loadStack(data, alone, 0, 'A5', 1, 'orchard');
    new Fx(data, alone, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(alone, 'A18')).toHaveLength(1);
    expect(tasksFrom(alone, 'A18')[0]).toMatchObject({ t: 'card', kind: 'deckToBarn' });
  });

  it('fires when every building on the farm is already full (R9)', () => {
    const s = makeState(data, ['apiary', 'wheat']);
    buildFor(data, s, 0, 'A18', 'A5', 'A6');
    loadStack(data, s, 0, 'A6', 3, 'orchard'); // A6 (threshold 3) already full
    loadStack(data, s, 0, 'A5', 1, 'orchard');
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(s, 'A18')).toHaveLength(1);
  });

  it('still drops silently when every deck and discard is dry (the same dry-table guard V17 needed)', () => {
    const s = position();
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    expect(tasksFrom(s, 'A18')).toEqual([]);
  });

  it('cannot chain into itself: its own reward emits no cardPlaced and fills nothing to re-trigger on', () => {
    const s = position();
    new Fx(data, s, 0).deckTopToBuilding(0, 'dairy', { seat: 0, card: 'A5' });
    const answers = pendingAnswers(data, s);
    const pick = answers.find((a) => a.kind === 'card' && a.payload.suit === 'dairy') as TaskAnswer;
    const out = answerTask(data, s, pick).state;
    // One firing only - no second A18 task appears from its own placement.
    expect(tasksFrom(out, 'A18')).toEqual([]);
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
    // Dealt one card past `rules.turn.handLimit` (10 since 24/09/2026, was 7) so
    // this stays "over the limit" whatever the bound is set to.
    const s = makeState(data, ['orchard', 'wheat']);
    buildFor(data, s, 0, 'O18');
    const limit = data.rules.turn.handLimit as number;
    const pool = [
      'O4',
      'O5',
      'O6',
      'O7',
      'O8',
      'O9',
      'O10',
      'O11',
      'O12',
      'O13',
      'O14',
      'O15',
    ] as CardId[];
    dealTo(data, s, 0, ...pool.slice(0, limit + 1));
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: 0 }).state;
    expect(out.turn.endHooksDone).toBe(true);
    expect(out.tasks.map((t) => t.t)).toEqual(['discard']);
  });
});

describe(
  "V18 - after you Deliver, activate the base power of the receipt's suit " +
    '(RETEXTED v48, R10/R11)',
  () => {
    /** A vegetable seat with a real Deliver pending, for the end-to-end tests. */
    function deliverPosition(barn: CardId[]): { s: GameState; move: Move } {
      const s = makeState(data, ['vegetable', 'wheat']);
      buildFor(data, s, 0, 'V18');
      const tile = s.island.tiles[0];
      if (tile === undefined) throw new Error('no tile');
      tile.tokens = [
        { demand: 'vegetable', vp: 6, worker: null },
        { demand: 'vegetable', vp: 5, worker: null },
      ];
      barnTo(s, 0, ...barn);
      const move = legalMoves(data, s).find(
        (m) => m.type === 'deliver' && m.tile === tile.tile,
      ) as Move;
      expect(move).toBeDefined();
      return { s, move };
    }

    it('a Vegetable receipt grants a Deliver (R10) exactly like a Worker pays one, if the barn can still pay', () => {
      // 8 barn cards: the first payment leaves exactly 4, enough to pay again.
      const { s, move } = deliverPosition(['V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11']);
      const out = apply(data, s, move).state;
      expect(player(out, 0).barn).toHaveLength(4);
      // No task carries V18's own id: a granted plain action is pushed exactly
      // as `performDoorAction` pushes a Worker's (`src: null`), not as a task
      // of V18's own the way its `v18Crop` choice would be.
      expect(out.tasks).toEqual([{ t: 'deliver', pid: 0, src: null }]);
      expect(v18Chain(out)).toBe(true);
    });

    it('an empty barn leaves the granted Deliver illegal, so V18 does as much as it can - nothing', () => {
      // Exactly one crate's worth: the barn is empty after paying and cannot
      // pay a second delivery, so the Vegetable plain action is not legal.
      const { s, move } = deliverPosition(['V4', 'V5', 'V6', 'V7']);
      const out = apply(data, s, move).state;
      expect(player(out, 0).barn).toHaveLength(0);
      expect(out.tasks).toEqual([]);
      expect(v18Chain(out)).toBeUndefined();
    });

    it(
      "a Vegetable receipt's own granted Deliver does not re-trigger V18 (R11: one link at " +
        'most) - the second token pays through the SAME chain and grants nothing further',
      () => {
        const { s, move } = deliverPosition(['V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11']);
        const afterFirst = apply(data, s, move).state;
        expect(v18Chain(afterFirst)).toBe(true);
        // Resolve V18's own granted Deliver task by paying the tile's second
        // (also Vegetable) token with the remaining 4 barn cards.
        const answer = pendingAnswers(data, afterFirst).find(
          (a) => a.kind === 'deliver',
        ) as TaskAnswer;
        expect(answer).toBeDefined();
        const out = answerTask(data, afterFirst, answer).state;
        expect(player(out, 0).barn).toHaveLength(0);
        expect(player(out, 0).receipts).toHaveLength(2); // both tokens taken
        // R11: one link only - no third Deliver, and the marker is consumed.
        expect(out.tasks).toEqual([]);
        expect(v18Chain(out)).toBe(false);
      },
    );

    it('an Orchard receipt: Draw 2, keeping both (R10, the plain action a delivery Worker would buy)', () => {
      const s = makeState(data, ['vegetable', 'orchard']);
      buildFor(data, s, 0, 'V18');
      const fx = new Fx(data, s, 0);
      fireHook(fx, 'afterDeliver', {
        seat: 0,
        island: true,
        tile: 'A1',
        cards: [],
        receipts: [{ vp: 5, crop: 'orchard', tile: 'A1' }],
      });
      expect(s.tasks).toEqual([{ t: 'draw', pid: 0, src: null, see: 2, keep: 2, revealed: [] }]);
      expect(v18Chain(s)).toBeUndefined(); // only a Vegetable grant ever arms the marker
    });

    it('a Wheat receipt: Harvest, full buildings only (R10)', () => {
      const s = makeState(data, ['vegetable', 'wheat']);
      buildFor(data, s, 0, 'V18', 'W4');
      loadStack(data, s, 0, 'W4', 2, 'orchard'); // W4's threshold is 2: now full
      const fx = new Fx(data, s, 0);
      fireHook(fx, 'afterDeliver', {
        seat: 0,
        island: true,
        tile: 'A1',
        cards: [],
        receipts: [{ vp: 5, crop: 'wheat', tile: 'A1' }],
      });
      expect(s.tasks).toEqual([
        { t: 'chooseBuilding', pid: 0, src: null, filter: 'harvestable', then: 'harvest' },
      ]);
    });

    it('a Wheat receipt with no full building: nothing to Harvest, so it does as much as it can - nothing', () => {
      const s = makeState(data, ['vegetable', 'wheat']);
      buildFor(data, s, 0, 'V18', 'W4'); // W4 built but empty: not harvestable
      const fx = new Fx(data, s, 0);
      fireHook(fx, 'afterDeliver', {
        seat: 0,
        island: true,
        tile: 'A1',
        cards: [],
        receipts: [{ vp: 5, crop: 'wheat', tile: 'A1' }],
      });
      expect(s.tasks).toEqual([]);
    });

    it(
      'a wild receipt offers the owner a choice among every crop legally open right now ' +
        "(the audit's Q5, reading (i)): here, Orchard (always drawable) and Wheat (a full " +
        'building on hand)',
      () => {
        const s = makeState(data, ['vegetable', 'wheat']);
        buildFor(data, s, 0, 'V18', 'W4');
        loadStack(data, s, 0, 'W4', 2, 'orchard'); // Wheat's Harvest is legal too
        const fx = new Fx(data, s, 0);
        fireHook(fx, 'afterDeliver', {
          seat: 0,
          island: true,
          tile: 'A1',
          cards: [],
          receipts: [{ vp: 5, crop: 'wild', tile: 'A1' }],
        });
        const [task] = tasksFrom(s, 'V18');
        expect(task).toMatchObject({ t: 'card', pid: 0, kind: 'v18Crop' });
        const answers = pendingAnswers(data, s);
        const crops = answers
          .map((a) => (a.kind === 'card' ? (a.payload.suit as string) : null))
          .sort();
        expect(crops).toEqual(['orchard', 'wheat']);
        const pick = answers.find(
          (a) => a.kind === 'card' && a.payload.suit === 'wheat',
        ) as TaskAnswer;
        const out = answerTask(data, s, pick).state;
        expect(out.tasks).toEqual([
          { t: 'chooseBuilding', pid: 0, src: null, filter: 'harvestable', then: 'harvest' },
        ]);
      },
    );

    it(
      "still resolves before V16 The Market Signal Tower (v46 R10 kept, the audit's Q6 " +
        'reading (i)): V18 checks legality off the barn V16 has not touched yet, its task ' +
        'still pending',
      () => {
        const s = makeState(data, ['vegetable', 'wheat']);
        buildFor(data, s, 0, 'V16', 'V18');
        const tile = s.island.tiles[0];
        if (tile === undefined) throw new Error('no tile');
        tile.tokens = [
          { demand: 'vegetable', vp: 6, worker: null },
          { demand: 'vegetable', vp: 5, worker: null },
        ];
        barnTo(s, 0, 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11'); // 4 left after paying
        const move = legalMoves(data, s).find(
          (m) => m.type === 'deliver' && m.tile === tile.tile,
        ) as Move;
        expect(move).toBeDefined();
        const out = apply(data, s, move as Move).state;
        // V16 fires unconditionally and queues its own pick; V18's own granted
        // Deliver is legal because the barn it read (4 cards) is the one
        // straight after payment, not whatever V16's still-pending card would
        // make it.
        expect(tasksFrom(out, 'V16')).toEqual([
          { t: 'card', pid: 0, src: 'V16', kind: 'deckToBarn', riders: { remaining: 1 } },
        ]);
        expect(out.tasks.some((t) => t.t === 'deliver' && t.src === null)).toBe(true);
        expect(player(out, 0).barn).toHaveLength(4); // V16 has not resolved yet
      },
    );
  },
);

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
