/**
 * Ticket 21: the Apiary suit, all 21 cards. The load-bearing pieces are the
 * Farmstead as two engine seams (any-card GROW, and the upgraded follow-up
 * sow of ruling F), suit-free sow everywhere (porting hazard 2), the Veil's
 * stack-reaches-2 reactor (ruling G), A8's activation surcharge and the
 * afterWork hook A17 forced.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player, workerState } from '../query.js';
import type { GameState, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { isHiveCard } from './apiary.js';
import { handlerFor } from './registry.js';

const APIARY = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['apiary', 'wheat']);
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

describe('HIVE sub-type membership (whole-word title keyword, DL-42)', () => {
  it('is exactly A4-A8 and A13', () => {
    const hives = data.cards.catalogue
      .filter((c) => c.suit === 'apiary' && isHiveCard(data, c.id))
      .map((c) => c.id);
    expect(hives).toEqual(['A4', 'A5', 'A6', 'A7', 'A8', 'A13']);
  });

  it('every enabled Apiary card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'apiary' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });
});

describe('the Apiary Farmstead (A2) - the two engine seams', () => {
  it('base face: GROW may pay with any card, for an Apiary seat only', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);
    const grown = growBuilding(data, s, APIARY, 'A5', wheatCard);
    expect(buildingOf(grown.state, APIARY, 'A5').stack).toEqual([wheatCard]);

    // The same shape on a Wheat seat is refused: the power is the suit's, not the card's.
    const t = base();
    buildFor(data, t, WHEAT, 'W5');
    const apiaryCard = t.decks.apiary.shift() as string;
    player(t, WHEAT).hand.push(apiaryCard);
    expect(() => growBuilding(data, t, WHEAT, 'W5', apiaryCard)).toThrow(/needs a wheat card/);
  });

  it('the any-card power shows up in the offered Grow moves', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);
    const grows = legalMoves(data, s).filter((m) => m.type === 'grow');
    expect(grows.some((m) => m.type === 'grow' && m.payment === wheatCard)).toBe(true);
  });

  it('upgraded (ruling F): one optional sow onto ANOTHER of your buildings', () => {
    const s = base();
    buildingOf(s, APIARY, 'A2').upgraded = true;
    buildFor(data, s, APIARY, 'A5', 'A6');
    dealTo(data, s, APIARY, 'A7', 'A9');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A7');
    const sow = grown.state.tasks.find((t) => t.t === 'sow');
    expect(sow).toBeDefined();
    if (sow?.t !== 'sow') throw new Error('expected a sow task');
    expect(sow.optional).toBe(true);
    expect(sow.targets).not.toContain('A5'); // "another" excludes the grown building
    expect(sow.targets).toContain('A6');
    expect(sow.targets).toContain('A3'); // the Notice Board is a legal sow target

    // Suit-free: an apiary hand card lands on any of them, and does not activate.
    const answers = pendingAnswers(data, grown.state);
    const ontoA6 = answers.find((a) => a.kind === 'sow' && a.onto === 'A6');
    const sown = answerTask(data, grown.state, ontoA6 as TaskAnswer);
    expect(buildingOf(sown.state, APIARY, 'A6').stack).toHaveLength(1);
  });

  it('base face queues no follow-up sow', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A7');
    expect(grown.state.tasks.some((t) => t.t === 'sow')).toBe(false);
  });
});

describe('A6 The Garden Hive - the sow-from-discard', () => {
  it('takes the top of any discard pile onto one of your buildings', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A6', 'A5');
    dealTo(data, s, APIARY, 'A7');
    s.discards.wheat.push('W4', 'W5'); // W5 is the top

    const grown = growBuilding(data, s, APIARY, 'A6', 'A7');
    const answers = pendingAnswers(data, grown.state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const ontoA5 = answers.find(
      (a) => a.kind === 'card' && a.payload.card === 'W5' && a.payload.onto === 'A5',
    );
    const sown = answerTask(data, grown.state, ontoA5 as TaskAnswer);
    expect(buildingOf(sown.state, APIARY, 'A5').stack).toEqual(['W5']);
    expect(sown.state.discards.wheat).toEqual(['W4']);
  });

  it('auto-skips when every discard is empty', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A6');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A6', 'A7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A7 The Foraging Hive - hive sow then a draw', () => {
  it('sows onto a HIVE only, suit-free, then draws 1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7', 'A5', 'A9');
    dealTo(data, s, APIARY, 'A11');
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);

    const grown = growBuilding(data, s, APIARY, 'A7', 'A11');
    const sow = grown.state.tasks.find((t) => t.t === 'sow');
    if (sow?.t !== 'sow') throw new Error('expected a sow task');
    expect(sow.targets).toEqual(['A7', 'A5']); // A9 is not a HIVE
    expect(sow.optional).toBeUndefined(); // imperative = mandatory

    // A wheat card is a legal sow payment (porting hazard 2).
    const wheatSow = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'sow' && a.card === wheatCard,
    );
    expect(wheatSow).toBeDefined();
    const sown = answerTask(data, grown.state, wheatSow as TaskAnswer);
    expect(headDraw(sown.state)).toMatchObject({ see: 1, keep: 1, src: 'A7' });
  });

  it('still draws when no hive can take a card ("then" does not gate)', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7');
    dealTo(data, s, APIARY, 'A11');
    loadStack(data, s, APIARY, 'A7', 2); // threshold 3: the grow payment fills it
    const grown = growBuilding(data, s, APIARY, 'A7', 'A11');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1 });
  });
});

describe('A8 The Wild Hive - the £1 activation surcharge', () => {
  it('is not offered without the £1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A7');
    const grows = legalMoves(data, s).filter((m) => m.type === 'grow');
    expect(grows.some((m) => m.type === 'grow' && m.building === 'A8')).toBe(false);
    expect(() => growBuilding(data, s, APIARY, 'A8', 'A7')).toThrow(/needs £1/);
  });

  it('pays the £1 after the card lands and offers the optional self-harvest', () => {
    const s = base();
    player(s, APIARY).coins = 1;
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A8', 'A7');
    expect(player(grown.state, APIARY).coins).toBe(0);
    expect(buildingOf(grown.state, APIARY, 'A8').stack).toEqual(['A7']);

    const answers = pendingAnswers(data, grown.state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const harvest = answers.find((a) => a.kind === 'card');
    const done = answerTask(data, grown.state, harvest as TaskAnswer);
    expect(buildingOf(done.state, APIARY, 'A8').stack).toEqual([]);
    expect(player(done.state, APIARY).barn).toEqual(['A7']);
  });
});

describe('A9 The Pollinator Trail - a paid sow per hive', () => {
  it('mints £1 per card actually sown, never a flat payout', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9', 'A5', 'A6');
    dealTo(data, s, APIARY, 'A7', 'A11', 'A12');
    const grown = growBuilding(data, s, APIARY, 'A9', 'A7');
    // One task per open HIVE: A5 and A6 (A9 is not a HIVE).
    expect(grown.state.tasks.filter((t) => t.t === 'card')).toHaveLength(2);

    // Sow into the first, skip the second: exactly £1.
    let state = grown.state;
    const first = pendingAnswers(data, state).find((a) => a.kind === 'card');
    state = answerTask(data, state, first as TaskAnswer).state;
    expect(player(state, APIARY).coins).toBe(1);
    const skip = pendingAnswers(data, state).find((a) => a.kind === 'skip');
    state = answerTask(data, state, skip as TaskAnswer).state;
    expect(player(state, APIARY).coins).toBe(1);
    expect(state.tasks).toHaveLength(0);
  });
});

describe('A10 The Cross-Pollinator - hire at £1 off', () => {
  it('hires for hireFee - 1 through the real hire funnel', () => {
    const s = base();
    player(s, APIARY).coins = 1; // hireFee is £2; £1 is enough with the discount
    buildFor(data, s, APIARY, 'A10');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A10', 'A7');
    const answers = pendingAnswers(data, grown.state);
    expect(answers.length).toBe(data.workers.roster.length);
    const hired = answerTask(data, grown.state, answers[0] as TaskAnswer);
    expect(player(hired.state, APIARY).coins).toBe(0);
    expect(hired.state.fair.filter((w) => w.owner === APIARY)).toHaveLength(1);
  });

  it('auto-skips when the seat already has its one Worker', () => {
    const s = base();
    player(s, APIARY).coins = 5;
    hireFor(s, APIARY, 'draw');
    buildFor(data, s, APIARY, 'A10');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A10', 'A7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A11 The Wax Workshop - the 2+ gate ALONE', () => {
  it('harvests a hive with 2+ cards even if not full', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, APIARY, 'A5', 2); // threshold 3: not full
    const grown = growBuilding(data, s, APIARY, 'A11', 'A7');
    const answers = pendingAnswers(data, grown.state);
    expect(answers).toEqual([{ kind: 'building', card: 'A5' }]);
    const done = answerTask(data, grown.state, answers[0] as TaskAnswer);
    expect(buildingOf(done.state, APIARY, 'A5').stack).toEqual([]);
    expect(player(done.state, APIARY).barn).toHaveLength(2);
  });

  it('refuses a FULL threshold-1 hive (minLoadedOnly, not a union)', () => {
    const s = base();
    player(s, APIARY).coins = 5;
    buildFor(data, s, APIARY, 'A11', 'A8');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, APIARY, 'A8', 1); // A8's threshold is 1: full at 1
    const grown = growBuilding(data, s, APIARY, 'A11', 'A7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A12 The Honey Hut - the cross-table sow', () => {
  it("sows 1 card onto a rival's building, then draws 3", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A12');
    buildFor(data, s, WHEAT, 'W5');
    dealTo(data, s, APIARY, 'A7', 'A11');
    const grown = growBuilding(data, s, APIARY, 'A12', 'A7');

    const answers = pendingAnswers(data, grown.state);
    const ontoW5 = answers.find((a) => a.kind === 'card' && a.payload.onto === 'W5');
    expect(ontoW5).toBeDefined();
    const sown = answerTask(data, grown.state, ontoW5 as TaskAnswer);
    // The table is crossed on the RESOLVE, not the activation (the task only queues).
    expect(sown.audit.crossSeat).toBe(true);
    expect(buildingOf(sown.state, WHEAT, 'W5').stack).toEqual(['A11']);
    expect(headDraw(sown.state)).toMatchObject({ see: 3, keep: 3, src: 'A12' });
  });

  it('still draws 3 when every rival building is clogged', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A12');
    dealTo(data, s, APIARY, 'A7');
    // Hand is empty after the grow payment, so the sow has nothing to place.
    const grown = growBuilding(data, s, APIARY, 'A12', 'A7');
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3 });
  });
});

describe("A13 The Queen's Hive - sow all your hives", () => {
  it('queues one optional sow per open hive, itself included', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13', 'A5', 'A9');
    dealTo(data, s, APIARY, 'A7', 'A11', 'A12');
    const grown = growBuilding(data, s, APIARY, 'A13', 'A7');
    const sows = grown.state.tasks.filter((t) => t.t === 'sow');
    // A13 (1 of 2 after its own payment) and A5. A9 is not a HIVE.
    expect(sows.map((t) => t.t === 'sow' && t.targets)).toEqual([['A13'], ['A5']]);
    expect(sows.every((t) => t.t === 'sow' && t.optional === true)).toBe(true);
  });
});

describe('A14 The Honeycomb Tower - draw per full hive', () => {
  it('counts own HIVEs at their printed threshold', () => {
    const s = base();
    player(s, APIARY).coins = 5;
    buildFor(data, s, APIARY, 'A14', 'A5', 'A8', 'A6');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, APIARY, 'A5', 3); // threshold 3: full
    loadStack(data, s, APIARY, 'A8', 1); // threshold 1: full
    loadStack(data, s, APIARY, 'A6', 1); // threshold 4: not full
    const grown = growBuilding(data, s, APIARY, 'A14', 'A7');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 });
  });
});

describe('A15 The Royal Apiary - the optional deliver', () => {
  it('offers a skip alongside the deliver answers', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A7');
    // Stock the barn so at least one island tile is affordable.
    for (const suit of ['apiary', 'wheat', 'orchard'] as const) {
      for (let i = 0; i < 6; i++) {
        player(s, APIARY).barn.push(s.decks[suit].shift() as string);
      }
    }
    const grown = growBuilding(data, s, APIARY, 'A15', 'A7');
    const answers = pendingAnswers(data, grown.state);
    expect(answers.some((a) => a.kind === 'deliver')).toBe(true);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const skipped = answerTask(
      data,
      grown.state,
      answers.find((a) => a.kind === 'skip') as TaskAnswer,
    );
    expect(skipped.state.tasks).toHaveLength(0);
    expect(player(skipped.state, APIARY).receipts).toEqual([]);
  });

  it('auto-skips when nothing is deliverable (no skip answer shown)', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A15', 'A7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe("A16 The Beekeeper's Veil - stack position 2 (ruling G)", () => {
  it('draws 1 when YOUR placement brings a stack to 2, on any board', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16', 'A5');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, APIARY, 'A5', 1); // the grow payment makes it 2
    const grown = growBuilding(data, s, APIARY, 'A5', 'A7');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A16' });
  });

  it("fires on a visit fee landing on a neighbour's board at 2", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, WHEAT, 'W3', 1, 'wheat'); // the host's board holds 1
    const applied = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: WHEAT,
      fee: ['A7'],
      payoff: { mode: 'coin' },
    });
    expect(headDraw(applied.state)).toMatchObject({ see: 1, keep: 1, src: 'A16' });
  });

  it('never fires when a RIVAL brings your building to 2', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16');
    dealTo(data, s, WHEAT, 'W4');
    loadStack(data, s, APIARY, 'A3', 1, 'apiary'); // your board holds 1
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(applied.state.tasks).toHaveLength(0);
  });

  it('does not fire at stack position 3', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16', 'A5');
    dealTo(data, s, APIARY, 'A7');
    loadStack(data, s, APIARY, 'A5', 2);
    const grown = growBuilding(data, s, APIARY, 'A5', 'A7');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A17 The Smoke Pot - the rival-work reactor', () => {
  it("draws 1 when a rival works the owner's Worker, choicelessly", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    hireFor(s, APIARY, 'draw');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    // The owner's autoDraw landed without a picker; the visitor's Draw 3 waits.
    expect(player(applied.state, APIARY).hand).toHaveLength(1);
    expect(headDraw(applied.state).pid).toBe(WHEAT);
    // The wage still minted on top of it.
    expect(player(applied.state, APIARY).coins).toBe(1);
  });

  it("never fires on the owner's own work", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    hireFor(s, APIARY, 'draw');
    const applied = apply(data, s, { type: 'workOwnWorker', seat: APIARY, workerId: 'draw' });
    expect(player(applied.state, APIARY).hand).toHaveLength(0);
    expect(player(applied.state, APIARY).coins).toBe(0);
  });

  it("fires on the Herb Hive's free WORK (no wage, no meeple advance)", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'A17'); // the wheat seat owns the Pot and the Worker
    hireFor(s, WHEAT, 'draw');
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A7');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A7');
    const worked = answerTask(
      data,
      grown.state,
      pendingAnswers(data, grown.state)[0] as TaskAnswer,
    );
    expect(workerState(worked.state, 'draw').trackPos).toBe(0); // free: no advance
    expect(player(worked.state, WHEAT).coins).toBe(1); // A4's flat £1, not a wage
    expect(player(worked.state, WHEAT).hand).toHaveLength(1); // the Smoke Pot draw
  });
});

describe('the endgame cards - A19, A20, A21', () => {
  it('A19 scores 3 per upgraded building, capping at 9', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A19');
    buildingOf(s, APIARY, 'A1').upgraded = true;
    buildingOf(s, APIARY, 'A3').upgraded = true;
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(6);
    buildingOf(s, APIARY, 'A2').upgraded = true;
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(9);
  });

  it('A20 scores 2 per loaded building, the Notice Board included', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A20', 'A5');
    loadStack(data, s, APIARY, 'A5', 1);
    loadStack(data, s, APIARY, 'A3', 1, 'apiary');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(4);
  });

  it('A21 scores 2 per built HIVE, itself excluded', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A21', 'A5', 'A13', 'A9');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(4); // A5 + A13
  });
});

describe('difficulty metadata stays honest for the Apiary suit', () => {
  it('the derivable flags match each handler structure', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'apiary' && x.enabled)) {
      const h = handlerFor(c.id);
      expect(h, c.id).toBeDefined();
      expect(h?.difficulty.verified.endgame, c.id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, c.id).toBe(typeof h?.moves === 'function');
    }
  });

  it('the declared crossPlayer flags match live audits', () => {
    // A12 reaches across on the sow's RESOLVE (asserted in its scenario above);
    // A17 reaches across the moment a rival's work fires it.
    expect(handlerFor('A12')?.difficulty.verified.crossPlayer).toBe(true);
    expect(handlerFor('A17')?.difficulty.verified.crossPlayer).toBe(true);

    const s = base();
    buildFor(data, s, APIARY, 'A17');
    hireFor(s, APIARY, 'draw');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    expect(applied.audit.crossSeat).toBe(true);

    // The five cards that never touch another seat declare so.
    for (const id of ['A5', 'A6', 'A11', 'A14', 'A15'] as const) {
      expect(handlerFor(id)?.difficulty.verified.crossPlayer, id).toBe(false);
    }
  });
});

describe('a full Apiary turn still settles', () => {
  it('grows, sows and drains without wedging', () => {
    const s = base();
    player(s, APIARY).coins = 3;
    buildingOf(s, APIARY, 'A2').upgraded = true;
    buildFor(data, s, APIARY, 'A9', 'A5', 'A16');
    dealTo(data, s, APIARY, 'A7', 'A11', 'A12', 'A14');
    const grown = growBuilding(data, s, APIARY, 'A9', 'A7');
    const state = answerAll(grown.state);
    expect(state.tasks).toHaveLength(0);
  });
});
