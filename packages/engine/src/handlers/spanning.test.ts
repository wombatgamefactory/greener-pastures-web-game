/**
 * Ticket 05's proof: the handler API expressed against a spanning set of six
 * cards deliberately chosen from easy to worst. If any of these cannot be
 * written cleanly, the API is wrong - so these tests double as the API's
 * acceptance criteria and the difficulty scale's first calibration points.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  applyCardMove,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  standingMoves,
  visitWork,
} from '../runtime.js';
import { buildingOf, cardById, player, serviceOf, thresholdOf, workerState } from '../query.js';
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
    // Asserted on the WHEAT seat since ticket 21: the Apiary Farmstead's base
    // power ("GROW: You may use any card") waives the match for an Apiary seat,
    // so A5 is no longer a valid subject for the general rule.
    const s = base();
    buildFor(data, s, WHEAT, 'W5');
    const apiaryCard = s.decks.apiary.shift() as string;
    player(s, WHEAT).hand.push(apiaryCard);
    expect(() => growBuilding(data, s, WHEAT, 'W5', apiaryCard)).toThrow(/needs a wheat card/);
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

/**
 * The Bakery moved from a GROW-fired Tier 3 to a printed ACTION with the Wheat
 * rebuild, which makes it a BETTER spanning case than it was: it is now the only
 * shape in the game where a card's standing move IS the main action.
 */
describe('2. The Bakery (W13) - a printed ACTION, taken instead of a main action', () => {
  /** W13 built, W4 loaded to `w4` cards, the Bakery's own stack irrelevant (it has none). */
  function bakeryState(w4: number): GameState {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4');
    if (w4 > 0) loadStack(data, s, WHEAT, 'W4', w4, 'apiary');
    return s;
  }

  function bakeryMove(state: GameState) {
    return standingMoves(data, state, WHEAT).find((m) => m.card === 'W13');
  }

  it('has no threshold, so it can be neither grown nor sown', () => {
    const s = bakeryState(0);
    expect(thresholdOf(data, buildingOf(s, WHEAT, 'W13'))).toBeNull();
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'W13')).toBe(false);
  });

  it('harvests every loaded building, however many cards are on it, and spends the action', () => {
    const s = bakeryState(1); // 1 of 2: nowhere near full
    const move = bakeryMove(s);
    expect(move).toBeDefined();

    const applied = apply(data, s, move as Move);
    expect(applied.state.turn.actionSpent).toBe(true);
    expect(buildingOf(applied.state, WHEAT, 'W4').stack).toEqual([]);
    expect(player(applied.state, WHEAT).barn).toHaveLength(1);
    // Spent: the action is gone and the Bakery offers nothing more this turn.
    expect(bakeryMove(applied.state)).toBeUndefined();
  });

  it('offers nothing with no loaded building, so it never holds a turn open', () => {
    expect(bakeryMove(bakeryState(0))).toBeUndefined();
  });

  it('suppresses `pass`, because it IS a main action', () => {
    const s = bakeryState(1);
    // Strip the hand and empty every deck so no printed action is legal: only
    // the Bakery is left, and `pass` must not be offered beside it.
    player(s, WHEAT).hand = [];
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const moves = legalMoves(data, s);
    expect(moves.some((m) => m.type === 'cardMove' && m.card === 'W13')).toBe(true);
    expect(moves.some((m) => m.type === 'pass')).toBe(false);
    expect(() => apply(data, s, { type: 'pass', seat: WHEAT })).toThrow(/only when no main action/);
  });

  /**
   * The cross-handler case the rebuild's ruling turns on: The Granary fires
   * ONCE per harvest action, not once per building, or a Bakery over eight
   * buildings draws eight cards.
   */
  it('fires The Granary (W16) once for the whole cascade, not once per building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W16', 'W4', 'W5');
    loadStack(data, s, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary');
    const applied = apply(data, s, bakeryMove(s) as Move);

    expect(buildingOf(applied.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(applied.state, WHEAT, 'W5').stack).toEqual([]);
    // Two buildings harvested. The Granary contributes exactly one Draw 1; the
    // rest of the queue is W4's and W5's own harvest lines.
    const granaryDraws = applied.state.tasks.filter(
      (t) => t.t === 'draw' && t.src === 'W16' && t.see === 1,
    );
    expect(granaryDraws).toHaveLength(1);
  });
});

describe('3. The Pie Shop (W17) - "gain £1 when a neighbour places a card on one of your buildings"', () => {
  it('pays its owner when a rival places, wherever the card lands', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17');
    dealTo(data, s, APIARY, 'A6');
    s.turnPlayer = APIARY;
    // A plain coin visit: the fee lands on the Wheat seat's Notice Board.
    const applied = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: WHEAT,
      fee: ['A6'],
      payoff: { mode: 'coin' },
    });
    expect(applied.audit.crossSeat).toBe(true); // it minted for somebody else
    expect(player(applied.state, WHEAT).coins).toBe(1);
  });

  it("pays nothing for its OWNER's own placements (scope is the listener, not the bus)", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17', 'W4');
    dealTo(data, s, WHEAT, 'W5');
    const { state } = growBuilding(data, s, WHEAT, 'W4', 'W5');
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
    // "Do not progress the worker": no card lands on the Service, so its
    // threshold does not move and the visit wage never fires.
    expect(workerState(state, 'draw').owner).toBe(WHEAT);
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

  it('offers the repeat after a rival-Service visit, prices it in cards, pays the host', () => {
    const s = visitScenario();
    const visited = visitWork(data, s, WHEAT, APIARY, 'draw', 'W4');
    expect(visited.state.turn.visit).toMatchObject({ host: APIARY, workerId: 'draw', repeats: 0 });
    // visitWage is 0 since 2026-08-10: a rival's use pays the owner the CARD
    // that lands on their Service and nothing else.
    expect(player(visited.state, APIARY).coins).toBe(0);
    let state = answerAll(visited.state, (a) => a[0] as TaskAnswer); // resolve draw 3 keep 2

    const offers = standingMoves(data, state, WHEAT);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((m) => m.card === 'W18' && m.kind === 'repeatWork')).toBe(true);

    const fee = offers[0]!.payload.fee as string;
    const repeated = applyCardMove(data, state, offers[0]!);
    state = answerAll(repeated.state, (a) => a[0] as TaskAnswer);

    expect(repeated.audit.crossSeat).toBe(true);
    // A repeat is a second CARD on their Service, and that is the entire
    // reward - twice the freight, twice the clog, no coins either time.
    expect(player(state, APIARY).coins).toBe(0);
    // Both cards land on the SERVICE, not the Notice Board: the repeat is a
    // second use of the building the visit targeted.
    expect(serviceOf(data, state, APIARY).stack).toContain(fee);
    expect(serviceOf(data, state, APIARY).stack).toHaveLength(2);
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
  it('scores 2 VP per different crop in the tableau, through the four-source breakdown', () => {
    const s = base();
    // W19 itself (wheat) plus an apiary and an orchard building: three crops.
    buildFor(data, s, WHEAT, 'W19', 'A9', 'O9');
    player(s, WHEAT).coins = 7;
    player(s, WHEAT).receipts.push(4, 8);

    const scores = gameEndScores(data, s);
    const wheat = scores[WHEAT]!;
    // Base starters print the generic starting-building icon, so they belong to
    // no crop and add nothing here (ticket 07's cropOf rule).
    expect(wheat.endgame).toBe(6);
    expect(wheat.receipts).toBe(12);
    expect(wheat.coinPity).toBe(0); // ticket 37: coins are worth no VP at all
    // Printed VP: W19 prints 0, A9 and O9 print their own.
    const printed = (cardById(data, 'A9').printedVp ?? 0) + (cardById(data, 'O9').printedVp ?? 0);
    expect(wheat.printed).toBe(printed);
    expect(wheat.total).toBe(6 + 12 + printed);
    expect(scores[APIARY]!.total).toBe(0);
  });

  it('an upgraded starter DOES print a crop, so a flip can add to it', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W19');
    expect(gameEndScores(data, s)[WHEAT]!.endgame).toBe(2); // wheat, from W19 itself
    // Flipping a starter prints the wheat icon - a crop already counted, so the
    // count does not move. This is the rule, not an accident of the fixture.
    buildingOf(s, WHEAT, 'W1').upgraded = true;
    expect(gameEndScores(data, s)[WHEAT]!.endgame).toBe(2);
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

/**
 * THE DAIRY REBUILD'S CROSS-HANDLER CASES (2026-08-10).
 *
 * Four pairs whose interaction is decided by a RULING rather than by either
 * card's own text, so neither card's own test file can own them. They live here
 * for the same reason the spanning set does: what is being checked is that the
 * seams compose, not that a card works.
 */
describe('the Dairy rebuild: rulings that live between two cards', () => {
  const DAIRY = 0;
  const RIVAL = 1;

  function dairyState(): GameState {
    return makeState(data, ['dairy', 'wheat']);
  }

  function actionMoveFor(state: GameState, card: string): Move {
    const move = legalMoves(data, state).find((m) => m.type === 'cardMove' && m.card === card);
    if (!move) throw new Error(`${card} offers no ACTION move`);
    return move;
  }

  it('D15 + D16: the Ledger draws ONCE for a whole Grand Creamery run', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    let state = apply(data, s, actionMoveFor(s, 'D15')).state;

    // Flip until the run busts or the queue empties, answering every choice
    // with a deck pick so the run goes as far as its luck allows.
    let ledgerDraws = 0;
    for (let guard = 0; guard < 40 && state.tasks.length > 0; guard++) {
      const before = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      const answers = pendingAnswers(data, state);
      const flip = answers.find((a) => a.kind === 'card') ?? answers[0];
      state = answerTask(data, state, flip as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      if (after > before) ledgerDraws += after - before;
    }
    // The run built at least one card, and the Ledger paid for the ACTION once.
    expect(player(state, DAIRY).tableau.length).toBeGreaterThan(6);
    expect(ledgerDraws).toBe(1);
  });

  it('D2 + D7: a card lifted off a stack is not divertible', () => {
    const s = dairyState();
    buildingOf(s, DAIRY, 'D2').upgraded = true; // "every card you spend"
    buildFor(data, s, DAIRY, 'D7', 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    const offStacks = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W9' && a.payment.length === 0,
    );
    expect(offStacks).toBeDefined();
    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    // No divert task, and nothing in the barn: stack to build cost to barn would
    // be a free Harvest, which is the whole reason the ruling exists.
    expect(done.tasks.filter((t) => t.t === 'card' && t.kind === 'divertSpent')).toEqual([]);
    expect(player(done, DAIRY).barn).toEqual([]);
  });

  it('D2 + D5: one destination per spent card, and the player chooses', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W7',
    );
    const spent = (build as { payment: string[] }).payment;
    let state = answerTask(data, grown.state, build as TaskAnswer).state;

    // Bank one: it leaves the discard, so D5 can never also sow it.
    const banked = spent[0] as string;
    const take = pendingAnswers(data, state).find(
      (a) => a.kind === 'card' && a.payload.card === banked,
    );
    state = answerTask(data, state, take as TaskAnswer).state;
    state = answerAll(state);
    expect(player(state, DAIRY).barn).toEqual([banked]);
    expect(buildingOf(state, DAIRY, 'W7').stack).toEqual([spent[1]]);
  });

  it('D11 + D14: a covered card cannot be demolished, and neither counts as built', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D14', 'D20', 'D4');
    // D20 scores 1 per building built: D14, D20 and D4 make three.
    expect(gameEndScores(data, s)[DAIRY]!.endgame).toBe(3);

    // Cover D4 by hand (D11's primitive), then ask D14 for its targets.
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    player(s, DAIRY).covered.push('D4');
    expect(gameEndScores(data, s)[DAIRY]!.endgame).toBe(2);

    const fired = apply(data, s, actionMoveFor(s, 'D14')).state;
    const targets = pendingAnswers(data, fired)
      .filter((a) => a.kind === 'card')
      .map((a) => a.payload.card);
    expect(targets).not.toContain('D4');

    // And demolishing takes the card out of the count too - it is stock now.
    const takeD20 = pendingAnswers(data, fired).find(
      (a) => a.kind === 'card' && a.payload.card === 'D20',
    );
    const gone = answerTask(data, fired, takeD20 as TaskAnswer).state;
    expect(gameEndScores(data, gone)[DAIRY]!.endgame).toBe(0);
  });

  it('a rival Strongbox pays per BUILDING, which is the flagged asymmetry with D16', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, RIVAL, 'W5', 'W4');
    s.turnPlayer = RIVAL;
    const built = apply(data, s, { type: 'build', seat: RIVAL, card: 'W5', payment: ['W4'] });
    expect(player(built.state, DAIRY).coins).toBe(1);
  });
});
