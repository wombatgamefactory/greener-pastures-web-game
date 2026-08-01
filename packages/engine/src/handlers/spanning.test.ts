/**
 * Ticket 05's proof: the handler API expressed against a spanning set of six
 * cards deliberately chosen from easy to worst. If any of these cannot be
 * written cleanly, the API is wrong - so these tests double as the API's
 * acceptance criteria and the difficulty scale's first calibration points.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import {
  answerTask,
  applyCardMove,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  standingMoves,
  visitWork,
  workOwnWorker,
} from '../runtime.js';
import { buildingOf, noticeBoardOf, player, thresholdOf, workerState } from '../query.js';
import type { GameState, TaskAnswer } from '../state.js';
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

describe('1. The Meadow Hive (A5) - plain activate-and-gain', () => {
  it('pays one matching card in, banks a deck-top honey card and £1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A6');
    const expectedBarnCard = s.decks.apiary[0];

    const { state, audit } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(buildingOf(state, APIARY, 'A5').stack).toEqual(['A6']);
    expect(player(state, APIARY).barn).toEqual([expectedBarnCard]);
    expect(player(state, APIARY).coins).toBe(1);
    expect(state.tasks).toHaveLength(0);
    expect(audit).toEqual({ tasksPushed: 0, crossSeat: false });
  });

  it('rejects a non-matching payment (GROW matching is the payment rule)', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A6');
    // Steal a wheat card into hand to try paying with the wrong suit.
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);
    expect(() => growBuilding(data, s, APIARY, 'A5', wheatCard)).toThrow(/needs a apiary card/);
  });

  it('still pays the £1 when the apiary deck and discard are empty', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A6');
    s.decks.apiary = [];
    const { state } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(player(state, APIARY).barn).toEqual([]);
    expect(player(state, APIARY).coins).toBe(1);
  });
});

describe('2. The Bakery (W13) - "Harvest all your full buildings"', () => {
  it('harvests every full building, including itself when the payment fills it', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4');
    dealTo(data, s, WHEAT, 'W5');
    const w4Threshold = thresholdOf(data, buildingOf(s, WHEAT, 'W4')) as number;
    loadStack(data, s, WHEAT, 'W4', w4Threshold);
    // W13 threshold is 2: load 1, so the grow payment fills it.
    loadStack(data, s, WHEAT, 'W13', 1);

    const { state } = growBuilding(data, s, WHEAT, 'W13', 'W5');
    expect(buildingOf(state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(state, WHEAT, 'W13').stack).toEqual([]);
    expect(player(state, WHEAT).barn).toHaveLength(w4Threshold + 2);
  });

  it('does not harvest buildings that are not full', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4');
    dealTo(data, s, WHEAT, 'W5');
    loadStack(data, s, WHEAT, 'W13', 1);
    // W4 stays empty: not full, not harvested.
    const { state } = growBuilding(data, s, WHEAT, 'W13', 'W5');
    expect(buildingOf(state, WHEAT, 'W4').stack).toEqual([]);
    expect(player(state, WHEAT).barn).toHaveLength(2); // only the Bakery's own stack
  });
});

describe('3. The Pie Shop (W17) - "£1 per non-wheat card in the harvest"', () => {
  it('counts non-wheat cards on any harvest by its owner, however triggered', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17', 'W4');
    const w4Threshold = thresholdOf(data, buildingOf(s, WHEAT, 'W4')) as number;
    // Fill W4 entirely with apiary cards (sow is suit-free, so this is a real position).
    loadStack(data, s, WHEAT, 'W4', w4Threshold, 'apiary');
    hireFor(s, WHEAT, 'harvest');

    // Harvest through the Harvest Worker: chooseBuilding task -> pick W4.
    const out = workOwnWorker(data, s, WHEAT, 'harvest');
    const state = answerAll(out.state);
    expect(player(state, WHEAT).coins).toBe(w4Threshold); // every card was non-wheat
    expect(player(state, WHEAT).barn).toHaveLength(w4Threshold);
    // Own use: meeple advanced, no wage minted for anyone.
    expect(workerState(state, 'harvest').trackPos).toBe(1);
  });

  it('pays nothing when a RIVAL harvests (scope is the listener, not the bus)', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17');
    buildFor(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A5', thresholdOf(data, buildingOf(s, APIARY, 'A5')) as number);
    hireFor(s, APIARY, 'harvest');
    const out = workOwnWorker(data, s, APIARY, 'harvest');
    const state = answerAll(out.state);
    expect(player(state, WHEAT).coins).toBe(0);
  });
});

describe('4. The Herb Hive (A4) - cross-player free WORK', () => {
  it('works a rival Worker with no meeple advance, no wage, owner +£1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A6');
    hireFor(s, WHEAT, 'draw'); // the rival's Draw Worker

    const grown = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(grown.audit.tasksPushed).toBe(1);
    expect(grown.state.tasks[0]).toMatchObject({ t: 'chooseWorker', owned: 'rival' });

    // Only the rival's worker qualifies; resolve it.
    const answers = pendingAnswers(data, grown.state);
    expect(answers).toEqual([{ kind: 'worker', workerId: 'draw' }]);
    const worked = answerTask(data, grown.state, answers[0] as TaskAnswer);
    expect(worked.audit.crossSeat).toBe(true); // the owner's £1 crossed the table

    // Draw 3 keep 2 runs for the ACTIVATOR, not the owner.
    const state = answerAll(worked.state, (a) => a[0] as TaskAnswer);
    expect(player(state, APIARY).hand).toHaveLength(2);
    expect(player(state, WHEAT).coins).toBe(1); // the owner's rider
    const ws = workerState(state, 'draw');
    expect(ws.trackPos).toBe(0); // "Do not progress the worker"
    expect(ws.owner).toBe(WHEAT);
  });

  it('is skipped cleanly when no rival has a hired Worker', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A6');
    hireFor(s, APIARY, 'draw'); // only the activator's OWN worker - not a target
    const { state } = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(state.tasks).toHaveLength(0); // auto-skipped, no dead picker
  });

  it('never opens the Helping Hand gate (ruling A: the trigger is the visit)', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4', 'A18');
    dealTo(data, s, APIARY, 'A6', 'A7');
    hireFor(s, WHEAT, 'draw');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A6');
    const state = answerAll(grown.state, (a) => a[0] as TaskAnswer);
    expect(state.turn.visit).toBeNull();
    expect(standingMoves(data, state, APIARY)).toEqual([]);
  });
});

describe('5. A Helping Hand (W18) - the standing repeat gate', () => {
  function visitScenario() {
    const s = base();
    buildFor(data, s, WHEAT, 'W18');
    hireFor(s, APIARY, 'draw'); // the host's worker
    // Fee cards for the visit and the repeat.
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6');
    return s;
  }

  it('offers the repeat after a rival-Worker visit, prices it in cards, pays the host', () => {
    const s = visitScenario();
    const visited = visitWork(data, s, WHEAT, APIARY, 'draw', 'W4');
    expect(visited.state.turn.visit).toMatchObject({ host: APIARY, workerId: 'draw', repeats: 0 });
    expect(player(visited.state, APIARY).coins).toBe(1); // wage space 1, minted by the bank
    let state = answerAll(visited.state, (a) => a[0] as TaskAnswer); // resolve draw 3 keep 2

    const offers = standingMoves(data, state, WHEAT);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((m) => m.card === 'W18' && m.kind === 'repeatWork')).toBe(true);

    const fee = offers[0]!.payload.fee as string;
    const repeated = applyCardMove(data, state, offers[0]!);
    state = answerAll(repeated.state, (a) => a[0] as TaskAnswer);

    expect(repeated.audit.crossSeat).toBe(true);
    expect(player(state, APIARY).coins).toBe(3); // wage space 2 minted on top
    expect(noticeBoardOf(data, state, APIARY).stack).toContain(fee);
    expect(noticeBoardOf(data, state, APIARY).stack).toHaveLength(2);
    expect(state.turn.visit?.repeats).toBe(1);
    // One copy built = one repeat: the gate closes.
    expect(standingMoves(data, state, WHEAT)).toEqual([]);
  });

  it('offers nothing without a visit in flight', () => {
    const s = visitScenario();
    expect(standingMoves(data, s, WHEAT)).toEqual([]);
  });

  it('re-validates: a repeat that was never offered is rejected', () => {
    const s = visitScenario();
    expect(() =>
      applyCardMove(data, s, {
        type: 'cardMove',
        seat: WHEAT,
        card: 'W18',
        kind: 'repeatWork',
        payload: { fee: 'W5' },
      }),
    ).toThrow(/not offered/);
  });
});

describe('6. The Wheat Exchange (W19) - end-game scoring', () => {
  it('scores 3 VP per upgraded building through the four-source breakdown', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W19');
    for (const b of player(s, WHEAT).tableau.slice(0, 2)) b.upgraded = true;
    player(s, WHEAT).coins = 7;
    player(s, WHEAT).receipts.push(4, 8);

    const scores = gameEndScores(data, s);
    const wheat = scores[WHEAT]!;
    expect(wheat.endgame).toBe(6);
    expect(wheat.receipts).toBe(12);
    expect(wheat.coinPity).toBe(1); // £7 at the £5 pity divisor
    // Printed VP includes the two upgraded starter faces (2 VP each).
    expect(wheat.printed).toBe(4);
    expect(wheat.total).toBe(23);
    expect(scores[APIARY]!.total).toBe(0);
  });
});

describe('difficulty metadata stays honest', () => {
  it('derivable flags match the handler structure for every registered card', () => {
    for (const id of ['W13', 'W17', 'W19', 'A4', 'A5', 'W18', 'A18'] as const) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h!.difficulty.verified.endgame, id).toBe(typeof h!.gameEnd === 'function');
      expect(h!.difficulty.verified.addsMoves, id).toBe(typeof h!.moves === 'function');
    }
  });

  it('observed audits match the declared prompts/crossPlayer flags', () => {
    // Meadow Hive: no prompt, no cross-table contact.
    const a5 = handlerFor('A5')!.difficulty.verified;
    expect(a5.prompts).toBe(false);
    expect(a5.crossPlayer).toBe(false);

    // Herb Hive: prompts (chooseWorker) and crosses the table (owner's £1) -
    // asserted against live audits in the scenario tests above.
    const a4 = handlerFor('A4')!.difficulty.verified;
    expect(a4.prompts).toBe(true);
    expect(a4.crossPlayer).toBe(true);

    // Helping Hand: no prompt (it is a standing MOVE), crosses the table.
    const hand = handlerFor('W18')!.difficulty.verified;
    expect(hand.prompts).toBe(false);
    expect(hand.crossPlayer).toBe(true);
    expect(hand.addsMoves).toBe(true);
  });
});
