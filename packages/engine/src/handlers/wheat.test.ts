/**
 * Ticket 18: the Wheat suit, all 21 cards, in the spanning-test style. The
 * load-bearing pieces are the Farmstead seams (the relaxed harvest gate as a
 * modifier the action AND the Harvest Worker compose with, and the upgraded
 * face's one optional repeat), W4's auto-harvest on the placement funnel, and
 * W8's surcharge on every harvest path.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  workOwnWorker,
} from '../runtime.js';
import { buildingOf, cardById, player, thresholdOf, workerState } from '../query.js';
import type { GameState, Move, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

const WHEAT = 0;
const APIARY = 1;

function base(): GameState {
  return makeState(data, ['wheat', 'apiary']);
}

/** Answer pending tasks with the first legal answer until the queue drains. */
function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 32 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function harvestMoves(state: GameState): Move[] {
  return legalMoves(data, state).filter((m) => m.type === 'harvest');
}

describe('the Wheat Farmstead (W2) - the relaxed harvest gate', () => {
  it('offers a 2+-loaded not-full building to the Harvest ACTION, wheat seat only', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11'); // threshold 4
    loadStack(data, s, WHEAT, 'W11', 2);
    expect(harvestMoves(s).map((m) => m.type === 'harvest' && m.building)).toContain('W11');

    // The same position for the apiary seat: 2-loaded, not full, NOT harvestable.
    const t = base();
    buildFor(data, t, APIARY, 'A9');
    const a9Threshold = thresholdOf(data, buildingOf(t, APIARY, 'A9')) as number;
    expect(a9Threshold).toBeGreaterThan(2);
    loadStack(data, t, APIARY, 'A9', 2);
    t.turnPlayer = APIARY;
    expect(harvestMoves(t)).toEqual([]);
  });

  it('the gates cross: a full threshold-1 building harvests strictly, never relaxed', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5'); // threshold 1
    loadStack(data, s, WHEAT, 'W5', 1);
    expect(harvestMoves(s).map((m) => m.type === 'harvest' && m.building)).toContain('W5');
  });

  it('composes with the Harvest Worker (suit powers apply to Worker actions)', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11');
    loadStack(data, s, WHEAT, 'W11', 2);
    hireFor(s, WHEAT, 'harvest');
    const out = workOwnWorker(data, s, WHEAT, 'harvest');
    const answers = pendingAnswers(data, out.state);
    expect(answers).toContainEqual({ kind: 'building', card: 'W11' });
  });

  it('upgraded: one optional repeat of the main Harvest action, then no more', () => {
    const s = base();
    buildingOf(s, WHEAT, 'W2').upgraded = true;
    buildFor(data, s, WHEAT, 'W4', 'W11');
    loadStack(data, s, WHEAT, 'W4', 2);
    loadStack(data, s, WHEAT, 'W11', 4);

    const first = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W11' });
    expect(first.state.turn.again).toBe('harvest');
    const repeats = harvestMoves(first.state);
    expect(repeats.length).toBeGreaterThan(0);

    const second = apply(data, first.state, repeats[0] as Move);
    // Consumed: no third harvest, and the gate is closed.
    expect(second.state.turn.again).toBeNull();
    expect(harvestMoves(second.state)).toEqual([]);
  });

  it('a Worker harvest never arms the repeat', () => {
    const s = base();
    buildingOf(s, WHEAT, 'W2').upgraded = true;
    buildFor(data, s, WHEAT, 'W11');
    loadStack(data, s, WHEAT, 'W11', 4);
    hireFor(s, WHEAT, 'harvest');
    const moved = apply(data, s, { type: 'workOwnWorker', seat: WHEAT, workerId: 'harvest' });
    const done = answerAll(moved.state);
    expect(done.turn.again).toBeNull();
  });
});

describe('W4 Wheat Field - auto-harvest at the placement funnel', () => {
  it('harvests itself for its owner the moment a placement fills it, and pays the £1', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4'); // threshold 2
    loadStack(data, s, WHEAT, 'W4', 1);
    dealTo(data, s, WHEAT, 'W6');
    // The GROW payment is a placement like any other and fills W4. (A rival's
    // sow through A12 fills it the same way - same funnel, ticket 21.)
    const { state } = growBuilding(data, s, WHEAT, 'W4', 'W6');
    expect(buildingOf(state, WHEAT, 'W4').stack).toEqual([]);
    expect(player(state, WHEAT).barn).toHaveLength(2);
    expect(player(state, WHEAT).coins).toBe(1); // "When this card is harvested: gain £1"
  });
});

describe('W5 Rye Field - "Harvest another card"', () => {
  it('draws 1 and harvests a full building other than itself', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5', 'W4');
    dealTo(data, s, WHEAT, 'W6'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, WHEAT, 'W4', 2);
    const grown = growBuilding(data, s, WHEAT, 'W5', 'W6');
    // First task: the Draw 1. Then the harvest picker.
    const afterDraw = answerAll(grown.state, (a) => a[0] as TaskAnswer);
    // W5 itself became full (threshold 1) but is excluded; W4 was the only target.
    expect(buildingOf(afterDraw, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(afterDraw, WHEAT, 'W5').stack).toHaveLength(1);
    // W4's harvest paid its own £1; W5 was not harvested so no W5 coin.
    expect(player(afterDraw, WHEAT).coins).toBe(1);
  });
});

describe('W6 / W7 - on-harvest draws and the build', () => {
  it('W6 draws 2 for its owner when harvested', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W6', 1); // threshold 1: full
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W6' });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 2, keep: 2, pid: WHEAT });
    const done = answerAll(applied.state, (a) => a[0] as TaskAnswer);
    expect(player(done, WHEAT).hand).toHaveLength(2);
  });

  it('W7 draws 1 and offers a PAID build when harvested', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7');
    // A buildable position: W4 costs 1 wheat card, so hold W4 + one payment card.
    dealTo(data, s, WHEAT, 'W4', 'W5');
    loadStack(data, s, WHEAT, 'W7', 1);
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W7' });
    expect(applied.state.tasks.map((t) => t.t)).toEqual(['draw', 'build']);
    let state = applied.state;
    // Resolve the draw (keep whatever), then take the first build option.
    state = answerAll(state, (answers) => answers[0] as TaskAnswer);
    const built = player(state, WHEAT).tableau.map((b) => b.card);
    expect(built).toContain('W4');
    // The build was paid: the payment card left the hand for the discard.
    expect(state.discards.wheat.length).toBeGreaterThan(0);
  });
});

describe('W8 Heritage Field - the £1 harvest surcharge', () => {
  function w8Full(coins: number): GameState {
    const s = base();
    buildFor(data, s, WHEAT, 'W8');
    // Load from apiary so the wheat deck keeps its ids for dealTo.
    loadStack(data, s, WHEAT, 'W8', 1, 'apiary'); // threshold 1: full
    player(s, WHEAT).coins = coins;
    return s;
  }

  it('is not offered to the action (or the Worker) when the £1 is unaffordable', () => {
    const s = w8Full(0);
    expect(harvestMoves(s)).toEqual([]);
    hireFor(s, WHEAT, 'harvest');
    // The Worker has nothing legal to do either.
    expect(legalMoves(data, s).some((m) => m.type === 'workOwnWorker')).toBe(false);
  });

  it('charges the £1 before the stack moves, then draws 3', () => {
    const s = w8Full(1);
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W8' });
    expect(player(applied.state, WHEAT).coins).toBe(0);
    expect(player(applied.state, WHEAT).barn).toHaveLength(1);
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3 });
  });

  it('becomes a pay-or-skip task inside the Bakery cascade', () => {
    const s = w8Full(1);
    buildFor(data, s, WHEAT, 'W13', 'W4');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W4', 2);
    loadStack(data, s, WHEAT, 'W13', 1);
    const grown = growBuilding(data, s, WHEAT, 'W13', 'W6');
    // W4 and W13 harvested inline; W8 deferred to its surcharge task.
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W8').stack).toHaveLength(1);
    const surcharge = grown.state.tasks.find((t) => t.t === 'card' && t.kind === 'surcharge');
    expect(surcharge).toMatchObject({ src: 'W8' });

    // Skipping leaves W8 loaded and the £1 unspent.
    const skipped = answerAll(grown.state, (answers) => {
      const skip = answers.find((a) => a.kind === 'skip');
      return (skip ?? answers[0]) as TaskAnswer;
    });
    expect(buildingOf(skipped, WHEAT, 'W8').stack).toHaveLength(1);
    // The £1 started with, plus W4's on-harvest £1; nothing paid for W8.
    expect(player(skipped, WHEAT).coins).toBe(2);
  });
});

describe('W9 Mill House - loaded-FIELD count and the per-FIELD sows', () => {
  it('pays £1 per card on your FIELDs and offers one optional sow per FIELD', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W9', 'W4', 'W11');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W9', 2); // threshold 2: full
    loadStack(data, s, WHEAT, 'W4', 1); // 1 FIELD card
    loadStack(data, s, WHEAT, 'W11', 3); // not a FIELD: never counted
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W9' });
    expect(player(applied.state, WHEAT).coins).toBe(1); // W4's single loaded card
    // One sow task per FIELD (W4), optional.
    const sows = applied.state.tasks.filter((t) => t.t === 'sow');
    expect(sows).toHaveLength(1);
    expect(sows[0]).toMatchObject({ targets: ['W4'], optional: true });
    const answers = pendingAnswers(data, applied.state);
    expect(answers).toContainEqual({ kind: 'skip' });
    // Sow the held card onto W4 - it fills to 2 and AUTO-HARVESTS (W4's tail).
    const sown = answerTask(data, applied.state, {
      kind: 'sow',
      card: 'W6',
      onto: 'W4',
    } as TaskAnswer);
    expect(buildingOf(sown.state, WHEAT, 'W4').stack).toEqual([]);
  });
});

describe('W10 The Furrow - harvest, £1, and the £1 FIELD build', () => {
  it('runs the full chain and the free build counts toward the Farmstead milestone', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W10', 'W6');
    dealTo(data, s, WHEAT, 'W4', 'W5');
    loadStack(data, s, WHEAT, 'W6', 1);
    loadStack(data, s, WHEAT, 'W10', 1); // threshold 2: the grow payment fills it
    const grown = growBuilding(data, s, WHEAT, 'W10', 'W5');
    // Tasks: chooseBuilding (harvest), then the fieldBuild gate. The £1 paid inline.
    let state = grown.state;
    // Pick W10 itself (now full) to harvest.
    state = answerTask(data, state, { kind: 'building', card: 'W10' } as TaskAnswer).state;
    // W6's on-harvest? W6 was not harvested. Now the fieldBuild: W4 is in hand.
    const buildAnswers = pendingAnswers(data, state);
    expect(buildAnswers.some((a) => a.kind === 'card')).toBe(true);
    state = answerTask(data, state, {
      kind: 'card',
      payload: { card: 'W4' },
    } as TaskAnswer).state;
    const tableau = player(state, WHEAT).tableau.map((b) => b.card);
    expect(tableau).toContain('W4');
    // £1 gained, £1 spent on the field build.
    expect(player(state, WHEAT).coins).toBe(0);
    // Third own-colour deck build (W10, W6, W4): the Farmstead flipped free.
    expect(buildingOf(state, WHEAT, 'W2').upgraded).toBe(true);
  });
});

describe('W11 The Bakehouse - the cross-player harvest', () => {
  it("harvests a neighbour's full building to THEIR barn, pays the activator per card", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W11', 3); // threshold 4: the grow payment must still fit
    buildFor(data, s, APIARY, 'A5');
    const a5Threshold = thresholdOf(data, buildingOf(s, APIARY, 'A5')) as number;
    loadStack(data, s, APIARY, 'A5', a5Threshold);
    const grown = growBuilding(data, s, WHEAT, 'W11', 'W6');
    const answers = pendingAnswers(data, grown.state);
    expect(answers).toContainEqual({
      kind: 'card',
      payload: { seat: APIARY, building: 'A5' },
    });
    const done = answerTask(data, grown.state, {
      kind: 'card',
      payload: { seat: APIARY, building: 'A5' },
    } as TaskAnswer);
    expect(done.audit.crossSeat).toBe(true);
    expect(player(done.state, APIARY).barn).toHaveLength(a5Threshold);
    expect(player(done.state, WHEAT).coins).toBe(a5Threshold);
  });

  it('auto-skips with no full neighbour building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W11', 3);
    const grown = growBuilding(data, s, WHEAT, 'W11', 'W6');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('W12 Crop Rotation - the FIELD cascade', () => {
  it('harvests all full FIELDs and offers a sow on every FIELD', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W12', 'W4', 'W6');
    dealTo(data, s, WHEAT, 'W5');
    loadStack(data, s, WHEAT, 'W4', 2); // full FIELD
    loadStack(data, s, WHEAT, 'W6', 1); // full FIELD (threshold 1)
    loadStack(data, s, WHEAT, 'W12', 3); // threshold 4: fills with the payment
    const grown = growBuilding(data, s, WHEAT, 'W12', 'W5');
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W6').stack).toEqual([]);
    // W12 is not a FIELD: not harvested by its own cascade.
    expect(buildingOf(grown.state, WHEAT, 'W12').stack).toHaveLength(4);
    // W4 paid £1 on harvest; W6 queued its Draw 2; a sow task waits per FIELD.
    expect(player(grown.state, WHEAT).coins).toBe(1);
    const kinds = grown.state.tasks.map((t) => t.t);
    expect(kinds.filter((k) => k === 'sow')).toHaveLength(2);
    expect(kinds).toContain('draw');
  });
});

describe('W14 The Pizzeria - take up to 4', () => {
  it('takes chosen stack cards to the barn, stops on skip, and is not a harvest', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14', 'W16', 'W11');
    loadStack(data, s, WHEAT, 'W11', 3, 'apiary');
    loadStack(data, s, WHEAT, 'W14', 1); // threshold 2: payment fills it
    dealTo(data, s, WHEAT, 'W6');
    const grown = growBuilding(data, s, WHEAT, 'W14', 'W6');
    let state = grown.state;
    // Every card on every stack is on offer (W14's own included); take 2 of
    // the 3 apiary cards off W11 specifically, then stop.
    const offW11 = () =>
      pendingAnswers(data, state).find(
        (a) => a.kind === 'card' && a.payload.building === 'W11',
      ) as TaskAnswer;
    state = answerTask(data, state, offW11()).state;
    state = answerTask(data, state, offW11()).state;
    state = answerTask(data, state, { kind: 'skip' } as TaskAnswer).state;
    expect(player(state, WHEAT).barn).toHaveLength(2);
    expect(buildingOf(state, WHEAT, 'W11').stack).toHaveLength(1);
    // NOT a harvest: the Granary (W16) never drew.
    expect(state.tasks).toHaveLength(0);
  });
});

describe('W15 / W16 - Patisserie and Granary', () => {
  it('W15 banks a chosen deck top and the £1 pays regardless', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    loadStack(data, s, WHEAT, 'W15', 1);
    dealTo(data, s, WHEAT, 'W6');
    const expected = s.decks.apiary[0];
    const grown = growBuilding(data, s, WHEAT, 'W15', 'W6');
    expect(player(grown.state, WHEAT).coins).toBe(1);
    const done = answerTask(data, grown.state, {
      kind: 'card',
      payload: { suit: 'apiary' },
    } as TaskAnswer);
    expect(player(done.state, WHEAT).barn).toEqual([expected]);
  });

  it('W16 draws once per building harvested, owner-scoped', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W6');
    loadStack(data, s, WHEAT, 'W6', 1);
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W6' });
    // W6's own Draw 2 plus the Granary's Draw 1.
    const draws = applied.state.tasks.filter((t) => t.t === 'draw');
    expect(draws).toHaveLength(2);
  });
});

describe('endgame cards - W20 and W21', () => {
  it('W20 scores 2 per empty deck-built threshold building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W20', 'W4', 'W6', 'W16');
    loadStack(data, s, WHEAT, 'W6', 1); // loaded: does not count
    // W4 empty (counts), W6 loaded (no), W16 no threshold (no), starters (no).
    const scores = gameEndScores(data, s);
    expect(scores[WHEAT]?.endgame).toBe(2);
  });

  /**
   * Ticket 37 deleted the coin pity (`coinPityDivisor: null`), so W21 is no
   * longer a better rate than everybody else's - it is the only rate. Both
   * halves are worth holding: the live rule, and the knob still doing its job
   * if the pity is ever switched back on.
   */
  it('W21 is the only way coins score at all, now the pity is off', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W21');
    player(s, WHEAT).coins = 7;
    player(s, APIARY).coins = 7;
    const scores = gameEndScores(data, s);
    // Holder: floor(7/2) = 3, all of it from the card.
    expect(scores[WHEAT]?.endgame).toBe(3);
    expect(scores[WHEAT]?.coinPity).toBe(0);
    // Non-holder: £7 is worth nothing.
    expect(scores[APIARY]?.coinPity).toBe(0);
    expect(scores[APIARY]?.endgame).toBe(0);
  });

  it("W21 still replaces its holder's pity when the knob is switched back on", () => {
    const pity = loadGameData({
      name: 'pity-on',
      schemaVersion: 1,
      set: { 'rules.economy.coinPityDivisor': 5 },
    });
    const s = makeState(pity, ['wheat', 'apiary']);
    buildFor(pity, s, WHEAT, 'W21');
    player(s, WHEAT).coins = 7;
    player(s, APIARY).coins = 7;
    const scores = gameEndScores(pity, s);
    // Holder: floor(7/2) = 3 from the card, and its pity line is zeroed rather
    // than added on top (ticket 27 - the screen must reconcile).
    expect(scores[WHEAT]?.endgame).toBe(3);
    expect(scores[WHEAT]?.coinPity).toBe(0);
    expect(scores[WHEAT]?.coinPityReplacedBy).toBe('W21');
    // Non-holder: plain pity, floor(7/5) = 1.
    expect(scores[APIARY]?.coinPity).toBe(1);
  });
});

describe('difficulty metadata stays honest across the suit', () => {
  const WHEAT_IDS = Array.from({ length: 21 }, (_, i) => `W${i + 1}`);

  it('every enabled Wheat card has a handler with structurally-true flags', () => {
    for (const id of WHEAT_IDS) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h?.difficulty.verified.endgame, id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, id).toBe(typeof h?.moves === 'function');
    }
  });

  it('workers stay consistent: a wheat Harvest Worker use advances the meeple', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11');
    loadStack(data, s, WHEAT, 'W11', 2); // relaxed-gate target only
    hireFor(s, WHEAT, 'harvest');
    const out = workOwnWorker(data, s, WHEAT, 'harvest');
    const done = answerAll(out.state);
    expect(player(done, WHEAT).barn).toHaveLength(2);
    expect(workerState(done, 'harvest').trackPos).toBe(1);
  });

  it('the FIELD keyword matches exactly W4-W8', () => {
    const fields = data.cards.catalogue.filter((c) => /\bField\b/.test(c.name)).map((c) => c.id);
    expect(fields).toEqual(['W4', 'W5', 'W6', 'W7', 'W8']);
    expect(cardById(data, 'W9').name).toBe('Mill House');
  });
});
