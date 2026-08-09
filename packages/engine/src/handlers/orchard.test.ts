/**
 * Ticket 20: the Orchard suit, all 21 cards, in the spanning-test style. The
 * load-bearing pieces are the Farmstead as a DRAW MODIFIER (composing with the
 * base Draw and the Draw Worker, never card-ability draws - DL-47), the gift
 * family's capacity rules and choiceless refills, O16's afterVisit reactor and
 * O17's afterDrawKeep divert.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { isOrchardCard } from './orchard.js';
import { handlerFor } from './registry.js';

const ORCHARD = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['orchard', 'wheat']);
}

/** Answer pending tasks with the first legal answer until the queue drains. */
function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function headDraw(state: GameState): Extract<Task, { t: 'draw' }> {
  const head = state.tasks[0];
  if (!head || head.t !== 'draw') throw new Error('Expected a draw task at the head');
  return head;
}

function giftMoves(state: GameState): Move[] {
  return legalMoves(data, state).filter((m) => m.type === 'cardMove' && m.kind === 'gift');
}

describe('ORCHARD sub-type membership (whole-word title keyword, DL-42)', () => {
  it('is exactly O4-O8, O13, O16 and O20', () => {
    const orchards = data.cards.catalogue
      .filter((c) => c.suit === 'orchard' && isOrchardCard(data, c.id))
      .map((c) => c.id);
    expect(orchards).toEqual(['O4', 'O5', 'O6', 'O7', 'O8', 'O13', 'O16', 'O20']);
  });

  it('every enabled Orchard card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'orchard' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });
});

describe('the Orchard Farmstead (O2) - the draw modifier', () => {
  it('base face: the Draw action sees 3 keeps 1; upgraded sees 3 keeps 2', () => {
    const s = base();
    const first = apply(data, s, { type: 'draw', seat: ORCHARD });
    expect(headDraw(first.state)).toMatchObject({ see: 3, keep: 1 });

    const t = base();
    buildingOf(t, ORCHARD, 'O2').upgraded = true;
    const second = apply(data, t, { type: 'draw', seat: ORCHARD });
    expect(headDraw(second.state)).toMatchObject({ see: 3, keep: 2 });
  });

  it('a non-orchard seat draws the plain base numbers', () => {
    const s = base();
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, { type: 'draw', seat: WHEAT });
    expect(headDraw(applied.state)).toMatchObject({ see: 2, keep: 1 });
  });

  it('composes with the Draw Service: (2,2) -> (3,2) base, (3,3) upgraded', () => {
    const s = base();
    hireFor(s, ORCHARD, 'draw');
    // The bonus slot's own-Service option is no longer free: pay the bank.
    player(s, ORCHARD).coins += data.workers.ownerActivationCost;
    const worked = apply(data, s, { type: 'workOwnWorker', seat: ORCHARD, workerId: 'draw' });
    // The Orchard seat is the ONLY one who gets any selection on a Draw 2.
    expect(headDraw(worked.state)).toMatchObject({ see: 3, keep: 2 });

    const t = base();
    buildingOf(t, ORCHARD, 'O2').upgraded = true;
    hireFor(t, ORCHARD, 'draw');
    player(t, ORCHARD).coins += data.workers.ownerActivationCost;
    const upgraded = apply(data, t, { type: 'workOwnWorker', seat: ORCHARD, workerId: 'draw' });
    expect(headDraw(upgraded.state)).toMatchObject({ see: 3, keep: 3 });
  });

  it('never applies to a card-ability draw (DL-47)', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O4');
    dealTo(data, s, ORCHARD, 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O4', 'O6');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'O4' });
  });
});

describe('O1 upgraded Barn - the once-per-turn gift as a standing free action', () => {
  it('gifts 1 card to a neighbour with space, mints £1, and is spent for the turn', () => {
    const s = base();
    buildingOf(s, ORCHARD, 'O1').upgraded = true;
    dealTo(data, s, ORCHARD, 'O4');

    const offers = giftMoves(s);
    expect(offers.length).toBeGreaterThan(0);
    const applied = apply(data, s, offers[0] as Move);
    expect(player(applied.state, WHEAT).hand).toContain('O4');
    expect(player(applied.state, ORCHARD).hand).toHaveLength(0);
    expect(player(applied.state, ORCHARD).coins).toBe(1);
    expect(applied.state.turn.onceUsed).toContain('O1');
    expect(giftMoves(applied.state)).toEqual([]);
  });

  it('is not offered on the base face, and not to a neighbour at their hand limit', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O4');
    expect(giftMoves(s)).toEqual([]); // base face

    const t = base();
    buildingOf(t, ORCHARD, 'O1').upgraded = true;
    dealTo(data, t, ORCHARD, 'O4');
    dealTo(data, t, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8'); // wheat limit 5: full
    expect(giftMoves(t)).toEqual([]);
  });
});

describe('the plain draws - O4, O6, O7, O11, O12', () => {
  it('O6 mints the £1 up front and draws 2', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O6');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O6', 'O7');
    expect(player(grown.state, ORCHARD).coins).toBe(1);
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 });
  });

  it('O11 draws 1 per built ORCHARD - O16 and O20 count, the Market itself does not', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O11', 'O4', 'O16', 'O20');
    dealTo(data, s, ORCHARD, 'O5');
    const grown = growBuilding(data, s, ORCHARD, 'O11', 'O5');
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3 });
  });

  it('O12 draws 2 per neighbour at their hand limit', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O12');
    dealTo(data, s, ORCHARD, 'O5');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8'); // at the printed 5
    const grown = growBuilding(data, s, ORCHARD, 'O12', 'O5');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 });

    const t = base();
    buildFor(data, t, ORCHARD, 'O12');
    dealTo(data, t, ORCHARD, 'O5');
    const idle = growBuilding(data, t, ORCHARD, 'O12', 'O5');
    expect(idle.state.tasks).toHaveLength(0); // no neighbour at limit: no draw
  });
});

describe('O5 The Pear Orchard - draw then one optional orchard sow', () => {
  it('offers one sow across all loadable orchards, skippable', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O5', 'O4');
    dealTo(data, s, ORCHARD, 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O5', 'O7');
    // Head: the Draw 1. Keep it, then the sow picker follows.
    let state = answerTask(data, grown.state, pendingAnswers(data, grown.state)[0]!).state;
    state = answerTask(data, state, pendingAnswers(data, state)[0]!).state;
    const answers = pendingAnswers(data, state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const ontoO4 = answers.find((a) => a.kind === 'sow' && a.onto === 'O4');
    expect(ontoO4).toBeDefined();
    const sown = answerTask(data, state, ontoO4 as TaskAnswer);
    expect(buildingOf(sown.state, ORCHARD, 'O4').stack).toHaveLength(1);
  });
});

describe('O8 The Heritage Orchard - the optional pay-gate', () => {
  it('pays £1 and draws 4, or declines', () => {
    const s = base();
    player(s, ORCHARD).coins = 1;
    buildFor(data, s, ORCHARD, 'O8');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O8', 'O7');
    const answers = pendingAnswers(data, grown.state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const pay = answers.find((a) => a.kind === 'card');
    const paid = answerTask(data, grown.state, pay as TaskAnswer);
    expect(player(paid.state, ORCHARD).coins).toBe(0);
    expect(headDraw(paid.state)).toMatchObject({ see: 4, keep: 4 });
  });

  it('auto-skips when broke - the £1 is never wasted', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O8');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O8', 'O7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('O9 The Fruit Stand - empty-orchard draws, then sows', () => {
  it('draws per EMPTY loadable orchard (O16/O20 never count) and offers per-orchard sows', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O9', 'O4', 'O5', 'O16');
    loadStack(data, s, ORCHARD, 'O5', 1);
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O9', 'O7');
    // O4 is empty; O5 is loaded; O16 has no stack. One draw.
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1 });
    // After the draw: one optional sow task per loadable orchard (O4, O5).
    const sowTasks = grown.state.tasks.filter((t) => t.t === 'sow');
    expect(sowTasks.map((t) => t.t === 'sow' && t.targets)).toEqual([['O4'], ['O5']]);
    expect(sowTasks.every((t) => t.t === 'sow' && t.optional === true)).toBe(true);
  });
});

describe('the gift family - O10 The Cider House and O14 The Conservatory', () => {
  it('O10: draw 2, gift any number, refill 1 per gift (choiceless, own suit first)', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O10');
    dealTo(data, s, ORCHARD, 'O4', 'O5');
    const grown = growBuilding(data, s, ORCHARD, 'O10', 'O4');
    // Keep the Draw 2 (hand: O5 + 2 drawn = 3).
    const state = answerAll(grown.state, (a) => {
      const gift = a.find(
        (x) => x.kind === 'card' && (x.payload as { card?: string }).card === 'O5',
      );
      return gift ?? a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer);
    });
    // O5 travelled to the wheat neighbour, identity intact.
    expect(player(state, WHEAT).hand).toContain('O5');
    // Giver: 2 kept, gifted 1 (O5), refilled 1 (own-suit autoDraw) = 3.
    expect(player(state, ORCHARD).hand).toHaveLength(3);
  });

  it("the gift respects a recipient's free hand space", () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O10');
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6', 'O7');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7'); // wheat limit 5: space for exactly 1
    const grown = growBuilding(data, s, ORCHARD, 'O10', 'O4');
    // Resolve the Draw 2, then gift greedily: after 1 gift the neighbour is full.
    let gifts = 0;
    const state = answerAll(grown.state, (a) => {
      const gift = a.find((x) => x.kind === 'card');
      if (gift && gifts < 5) {
        gifts += 1;
        return gift;
      }
      return a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer);
    });
    expect(gifts).toBe(1);
    expect(player(state, WHEAT).hand).toHaveLength(5);
  });

  it('O14: pays £1, draws to the hand limit (N fixed at activation), then gifts', () => {
    const s = base();
    player(s, ORCHARD).coins = 1;
    buildFor(data, s, ORCHARD, 'O14');
    dealTo(data, s, ORCHARD, 'O4', 'O5');
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O4');
    expect(player(grown.state, ORCHARD).coins).toBe(0);
    // Hand after paying: O5 alone; Orchard Barn base limit is 4 -> draw 3.
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3, src: 'O14' });
    // A gift task follows.
    expect(grown.state.tasks.some((t) => t.t === 'card' && t.kind === 'gift')).toBe(true);
  });

  it('O14 does nothing without the £1 (the whole effect is priced)', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14');
    dealTo(data, s, ORCHARD, 'O4', 'O5');
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, ORCHARD).coins).toBe(0);
  });
});

describe('O13 The Grand Orchard - pay £1, draw per orchard, sow each', () => {
  it('pays, draws the built-orchard count (itself included) and queues per-orchard sows', () => {
    const s = base();
    player(s, ORCHARD).coins = 2;
    buildFor(data, s, ORCHARD, 'O13', 'O4');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O13', 'O7');
    expect(player(grown.state, ORCHARD).coins).toBe(1);
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 }); // O13 + O4
    const sowTasks = grown.state.tasks.filter((t) => t.t === 'sow');
    expect(sowTasks).toHaveLength(2); // O4 and O13 are loadable orchards
  });

  it('does nothing without the £1', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O13', 'O4');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O13', 'O7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('O15 The Garden Library - draw 3, then immediately deliver', () => {
  it('draws 3 then auto-skips the deliver when the barn is empty', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O15');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O15', 'O7');
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3 });
    expect(grown.state.tasks.some((t) => t.t === 'deliver')).toBe(true);
    const state = answerAll(grown.state);
    expect(player(state, ORCHARD).hand.length).toBeGreaterThanOrEqual(3);
  });
});

describe('O16 The Orchard Keeper - the host-side visit reactor', () => {
  it('a coin visit draws 1 for the host and 1 for the visitor, no picker', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(applied.state.tasks).toHaveLength(0);
    expect(player(applied.state, ORCHARD).hand).toHaveLength(1); // own-suit autoDraw
    // Visitor: fee left, keeper draw arrived, plus the £1 payout.
    expect(player(applied.state, WHEAT).hand).toHaveLength(1);
    expect(player(applied.state, WHEAT).coins).toBe(1);
  });

  it('fires on the worker payoff too', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    hireFor(s, ORCHARD, 'harvest');
    buildFor(data, s, WHEAT, 'W6');
    dealTo(data, s, WHEAT, 'W4'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, WHEAT, 'W6', 3); // threshold 3, full: the Harvest Service has work
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: ['W4'],
      payoff: { mode: 'worker', workerId: 'harvest' },
    });
    expect(player(applied.state, ORCHARD).hand).toHaveLength(1);
    // The visitor's keeper card arrived on top of the worker's harvest flow.
    expect(player(applied.state, WHEAT).hand.length).toBeGreaterThanOrEqual(1);
  });

  it("fires once, not twice, on Special Orders' 2-card visit", () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    const board = player(s, ORCHARD).tableau.find((b) => b.card === 'O3');
    if (board) board.upgraded = true;
    dealTo(data, s, WHEAT, 'W4', 'W5');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: ['W4', 'W5'],
      payoff: { mode: 'special' },
    });
    expect(player(applied.state, ORCHARD).hand).toHaveLength(1); // one keeper draw, not two
    expect(player(applied.state, WHEAT).hand).toHaveLength(1); // both fees spent, one drawn back
    expect(player(applied.state, WHEAT).coins).toBe(data.rules.economy.visitPayout.twoCard);
  });
});

describe('O17 The Fruit Basket - the on-draw divert', () => {
  it('offers a £1 divert of just-kept cards, re-entrant, skippable', () => {
    const s = base();
    player(s, ORCHARD).coins = 2;
    buildFor(data, s, ORCHARD, 'O17');
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    // See 3 (modifier), keep 1.
    let state = drawn.state;
    for (let i = 0; i < 3; i++) {
      state = answerTask(data, state, pendingAnswers(data, state)[0]!).state;
    }
    const keeps = pendingAnswers(data, state);
    expect(keeps[0]?.kind).toBe('keep');
    state = answerTask(data, state, keeps[0] as TaskAnswer).state;
    // The divert task fires for the kept card.
    const offers = pendingAnswers(data, state);
    expect(offers.some((a) => a.kind === 'skip')).toBe(true);
    const divert = offers.find((a) => a.kind === 'card');
    const done = answerTask(data, state, divert as TaskAnswer).state;
    expect(player(done, ORCHARD).coins).toBe(1);
    expect(player(done, ORCHARD).barn).toHaveLength(1);
    expect(player(done, ORCHARD).hand).toHaveLength(0);
    expect(done.tasks).toHaveLength(0); // every kept card diverted: task complete
  });

  it('auto-skips when broke, and never fires on a keeper autoDraw', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(drawn.state);
    expect(player(state, ORCHARD).barn).toHaveLength(0);

    // An O16+O17 host: a neighbour's visit autoDraws for the host - no divert.
    const t = base();
    player(t, ORCHARD).coins = 5;
    buildFor(data, t, ORCHARD, 'O16', 'O17');
    dealTo(data, t, WHEAT, 'W4');
    t.turnPlayer = WHEAT;
    const visited = apply(data, t, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(visited.state.tasks).toHaveLength(0);
  });
});

describe('the endgame cards - O19, O20, O21', () => {
  it('O19 scores empty hand spaces, capped at 4', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O19');
    dealTo(data, s, ORCHARD, 'O4');
    // Orchard Barn base limit 4, hand 1 -> 3 VP.
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(3);

    const t = base();
    buildFor(data, t, ORCHARD, 'O19');
    buildingOf(t, ORCHARD, 'O1').upgraded = true; // limit 7, hand 0 -> capped at 4
    expect(gameEndScores(data, t)[ORCHARD]?.endgame).toBe(4);
  });

  it('O20 scores 1 per built ORCHARD, itself included', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O20', 'O4', 'O9');
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(2); // O20 + O4; O9 is not an orchard
  });

  it("O21 scores 1 per 2 cards in the rivals' hands", () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O21');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8');
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(2);
  });
});
