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
  workOwnWorker,
} from '../runtime.js';
import { growOptions } from '../actions.js';
import { buildingOf, cardById, player, serviceOf, thresholdOf } from '../query.js';
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

/**
 * The Meadow Hive is the suit's signature since the Apiary rebuild, and a
 * better spanning case than it was: it is the only shape in the game where a
 * card's text FIRES a building without placing anything on it, so it is where
 * the API's newest seam (`activate`) is proved.
 */
describe('1. The Meadow Hive (A5) - an activation with no placement', () => {
  it('pays one matching card in, then fires another building placing nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A6');

    const { state, audit } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(buildingOf(state, APIARY, 'A5').stack).toEqual(['A6']);
    expect(audit).toEqual({ tasksPushed: 1, crossSeat: false });
    // Never the Notice Board and never the Service: firing your own Service is
    // bonus-slot option 1, and no card may sell a bonus slot.
    expect(pendingAnswers(data, state)).toEqual([{ kind: 'activate', card: 'A10' }]);

    const fired = answerTask(data, state, { kind: 'activate', card: 'A10' });
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toEqual([]); // no stack advance
    expect(fired.state.tasks[0]).toMatchObject({ t: 'draw', src: 'A10' });
  });

  it('rejects a non-matching payment (GROW matching is the payment rule)', () => {
    // Asserted on the APIARY seat again since the rebuild: the Farmstead's
    // suit-wide crop waiver is deleted, so an Apiary seat matches crops like
    // everybody else and the waiver survives only on A6 The Garden Hive.
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);
    expect(() => growBuilding(data, s, APIARY, 'A5', wheatCard)).toThrow(/needs a apiary card/);
  });

  it('takes a FULL building, which is the whole point of placing nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A10', 2); // threshold 2: full and clogged
    expect(growOptions(data, s, APIARY).some((o) => o.building === 'A10')).toBe(false);

    const { state } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(pendingAnswers(data, state)).toEqual([{ kind: 'activate', card: 'A10' }]);
    const fired = answerTask(data, state, { kind: 'activate', card: 'A10' });
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toHaveLength(2);
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

describe('4. The Herb Hive (A4) - a card taken from across the table', () => {
  it('takes one card off a rival stack into your barn, then sows a deck top back', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, WHEAT, 'W4', 2, 'wheat'); // threshold 2: FULL
    const loaded = [...buildingOf(s, WHEAT, 'W4').stack];

    const grown = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(grown.audit.tasksPushed).toBe(1);
    expect(grown.state.tasks[0]).toMatchObject({ t: 'card', kind: 'takeFromRival' });

    const answers = pendingAnswers(data, grown.state);
    expect(answers).toHaveLength(2); // one per card on the rival's only loaded stack
    const taken = answerTask(data, grown.state, answers[0] as TaskAnswer);
    expect(taken.audit.crossSeat).toBe(true); // it reached into their tableau

    // The take resolves BEFORE the replacement lands, which is the only reason a
    // FULL building has room for one.
    expect(player(taken.state, APIARY).barn).toEqual([loaded[0]]);
    expect(buildingOf(taken.state, WHEAT, 'W4').stack).toEqual([loaded[1]]);
    const state = answerAll(taken.state, (a) => a[0] as TaskAnswer);
    expect(buildingOf(state, WHEAT, 'W4').stack).toHaveLength(2);
    expect(buildingOf(state, WHEAT, 'W4').stack).not.toContain(loaded[0]);
  });

  it('is skipped cleanly when no rival stack holds a card', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A6');
    const { state } = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(state.tasks).toHaveLength(0); // auto-skipped, no dead picker
  });

  it('never opens the Helping Hand gate: a cross-table sow is not a VISIT', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4', 'A18');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A6', 'A7');
    loadStack(data, s, WHEAT, 'W4', 1, 'wheat');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A6');
    const state = answerAll(grown.state, (a) => a[0] as TaskAnswer);
    // No bonus slot, no wage, no afterVisit - and so no repeat gate.
    expect(state.turn.visit).toBeNull();
    expect(state.turn.bonusSpent).toBe(false);
    expect(player(state, WHEAT).coins).toBe(0);
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
    // Meadow Hive: it PROMPTS since the rebuild (the activate task asks which
    // building to fire) and still never touches another seat.
    const a5 = handlerFor('A5')!.difficulty.verified;
    expect(a5.prompts).toBe(true);
    expect(a5.crossPlayer).toBe(false);

    // Herb Hive: prompts (which rival card to take) and crosses the table -
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
 * THE DAIRY REBUILD'S CROSS-HANDLER CASES (2026-08-10, extended by the rebalance
 * of 2026-08-12).
 *
 * Pairs whose interaction is decided by a RULING rather than by either card's
 * own text, so neither card's own test file can own them. They live here for the
 * same reason the spanning set does: what is being checked is that the seams
 * compose, not that a card works.
 *
 * The rebalance added three, and all three are The Ledger's or the Farmstead's.
 * D16 moved off the once-per-build-SOURCE guard onto the general once-per-turn
 * rule, which is a change only a TWO-BUILD TURN can see; and the Farmstead's
 * diversion cap became "up to 2" in the same pass that took The Butter
 * Factory's discount away, which is why keeping the diversion is what stops a
 * discountless D12 being worthless.
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

  /**
   * Drain the queue, counting every Draw The Ledger pushes on the way through.
   * The draws are consumed as they are answered, so a before/after diff at each
   * step is the only honest count - a tally of what is left at the end would
   * read zero however many times the card fired.
   */
  function drainCountingLedger(
    state: GameState,
    pick?: (answers: TaskAnswer[]) => TaskAnswer,
  ): { state: GameState; draws: number } {
    const pending = (s: GameState) =>
      s.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
    let s = state;
    let draws = pending(s);
    for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
      const before = pending(s);
      const answers = pendingAnswers(data, s);
      const answer = pick ? pick(answers) : answers[0];
      if (!answer) throw new Error('No legal answer to a live task');
      s = answerTask(data, s, answer).state;
      const after = pending(s);
      if (after > before) draws += after - before;
    }
    expect(s.tasks).toHaveLength(0);
    return { state: s, draws };
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

  /**
   * ⛔ THE BEHAVIOURAL CHANGE OF THE REBALANCE, and the only shape that can see
   * it. The old guard deduped by build SOURCE and DELIBERATELY EXEMPTED A NULL
   * SOURCE, so a plain Build action and a bonus-slot Build were two genuine
   * Build actions and drew twice. That carve-out was decided on 2026-08-10; on
   * 2026-08-11 the Apiary rebuild adopted the general rule that no card's text
   * may fire twice in a turn, and this pair is the whole of the difference.
   */
  it('D16 + a two-Build turn: a plain Build and a bonus-slot Build draw ONCE between them', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D16');
    hireFor(s, DAIRY, 'build'); // the Builder's Yard: this seat's own Service
    player(s, DAIRY).coins = 1; // workers.ownerActivationCost
    dealTo(data, s, DAIRY, 'W5', 'W4', 'W7', 'W6');

    // The main action, and the Ledger pays for it.
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    const first = drainCountingLedger(built.state);
    expect(first.draws).toBe(1);
    expect(first.state.turn.firedThisTurn).toContain('D16');

    // The bonus slot: activate your own Service, which grants a second Build.
    const bonus = workOwnWorker(data, first.state, DAIRY, 'build');
    const second = drainCountingLedger(
      bonus.state,
      (a) => a.find((x) => x.kind === 'build' && x.card === 'W7') ?? (a[0] as TaskAnswer),
    );
    // Two buildings really did land, and the second one drew nothing.
    expect(player(second.state, DAIRY).tableau.some((b) => b.card === 'W5')).toBe(true);
    expect(player(second.state, DAIRY).tableau.some((b) => b.card === 'W7')).toBe(true);
    expect(second.draws).toBe(0);
  });

  it('D16 + D12: the Butter Factory still draws ONCE, now for the once-per-turn reason', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D16', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    const drained = drainCountingLedger(
      grown.state,
      (a) => a.find((x) => x.kind === 'build') ?? (a[0] as TaskAnswer),
    );
    // The number is what it always was. What changed is why: the old guard said
    // "one Build ACTION, however many buildings", and the new one says "this
    // card has fired", which is the same answer here and a different one above.
    expect(drained.draws).toBe(1);
    expect(drained.state.turn.firedThisTurn).toContain('D16');
  });

  it('D2 + D12: two builds divert twice, and each diversion caps at 2', () => {
    const s = dairyState();
    buildingOf(s, DAIRY, 'D2').upgraded = true; // "up to 2 cards you spend"
    buildFor(data, s, DAIRY, 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W7', 'W4', 'W5', 'W6', 'W11', 'W12');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');

    /** Bank the head divert task's first two offers, which is the cap. */
    function bankTwo(state: GameState): GameState {
      let out = state;
      for (let i = 0; i < 2; i++) {
        out = answerTask(data, out, pendingAnswers(data, out)[0] as TaskAnswer).state;
      }
      return out;
    }

    // W9 costs three cards, so the first build is where the cap bites: two go to
    // the barn and the third is discarded.
    const big = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W9' && [...a.payment].sort().join() === 'W4,W5,W6',
    );
    expect(big).toBeDefined();
    let state = answerTask(data, grown.state, big as TaskAnswer).state;
    expect(state.tasks[0]).toMatchObject({ kind: 'divertSpent', riders: { remaining: 2 } });
    state = bankTwo(state);
    expect(player(state, DAIRY).barn).toHaveLength(2);

    // The second build is a second, independent diversion. The Farmstead's
    // trigger does not re-fire; the COUNT is per card spent, which is the ruling
    // the rebalance deliberately left alone when D12 lost its discount.
    const second = pendingAnswers(data, state).find(
      (a) => a.kind === 'build' && a.card === 'W7' && [...a.payment].sort().join() === 'W11,W12',
    );
    expect(second).toBeDefined();
    state = answerTask(data, state, second as TaskAnswer).state;
    expect(state.tasks[0]).toMatchObject({ kind: 'divertSpent', riders: { remaining: 2 } });
    state = bankTwo(state);
    expect(player(state, DAIRY).barn).toHaveLength(4);
  });

  it('D2 + D7: a card lifted off a stack is not divertible', () => {
    const s = dairyState();
    buildingOf(s, DAIRY, 'D2').upgraded = true; // "up to 2 cards you spend"
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
    buildFor(data, s, DAIRY, 'D14', 'D20', 'D4', 'D5');
    // D20 scores 1 for every 2 buildings built since the rebalance, so the
    // fixture carries FOUR: D14, D20, D4 and D5. Three would round down to the
    // same 1 as two and the cover below would prove nothing.
    expect(gameEndScores(data, s)[DAIRY]!.endgame).toBe(2);

    // Cover D4 by hand (D11's primitive), then ask D14 for its targets.
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    player(s, DAIRY).covered.push('D4');
    expect(gameEndScores(data, s)[DAIRY]!.endgame).toBe(1);

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

/**
 * THE APIARY REBUILD'S CROSS-HANDLER CASES (2026-08-11).
 *
 * Seven pairs whose interaction is settled by a RULING rather than by either
 * card's own text, so neither card's own test file can own them. Two of them -
 * the recursion guard and the Farmstead's scope - are the only reason the suit
 * terminates and the only reason The Honey Hut does not draw three.
 */
describe('the Apiary rebuild: rulings that live between two cards', () => {
  const SEAT = 0;
  const RIVAL = 1;

  function apiaryState(): GameState {
    return makeState(data, ['apiary', 'wheat']);
  }

  function actionMoveFor(state: GameState, card: string): Move {
    const move = legalMoves(data, state).find((m) => m.type === 'cardMove' && m.card === card);
    if (!move) throw new Error(`${card} offers no ACTION move`);
    return move;
  }

  /** Prefer firing something: the drain loop otherwise answers draws forever. */
  function fireEverything(state: GameState): GameState {
    return answerAll(state, (a) => a.find((x) => x.kind === 'activate') ?? (a[0] as TaskAnswer));
  }

  /**
   * ⛔ THE RECURSION GUARD. A12 fires two buildings, one of which may be A5; A5
   * fires one, which may be A12. The ruling that closes it is "no card's text
   * may fire twice in a turn", held in `turn.firedThisTurn` and enforced by
   * FILTERING THE OPTION OUT rather than by throwing.
   */
  it('A12 + A5 does not loop, and neither does A5 + A12 + A5', () => {
    const viaHut = apiaryState();
    buildFor(data, viaHut, SEAT, 'A12', 'A5', 'A10');
    dealTo(data, viaHut, SEAT, 'A4');
    const hut = fireEverything(growBuilding(data, viaHut, SEAT, 'A12', 'A4').state);
    // Three cards fired, each exactly once - A5 could not reach back into A12.
    expect([...hut.turn.firedThisTurn].sort()).toEqual(['A10', 'A12', 'A5']);

    const viaMeadow = apiaryState();
    buildFor(data, viaMeadow, SEAT, 'A5', 'A12', 'A10');
    dealTo(data, viaMeadow, SEAT, 'A4');
    const meadow = fireEverything(growBuilding(data, viaMeadow, SEAT, 'A5', 'A4').state);
    expect([...meadow.turn.firedThisTurn].sort()).toEqual(['A10', 'A12', 'A5']);
  });

  /** The target set is WIDER than a GROW's: nothing is being placed, so a clog is irrelevant. */
  it('A12 fires a FULL building, and the stack does not grow', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A12', 'A10', 'A11');
    dealTo(data, s, SEAT, 'A4');
    loadStack(data, s, SEAT, 'A10', 2); // threshold 2: full and clogged
    loadStack(data, s, SEAT, 'A11', 2);
    expect(growOptions(data, s, SEAT).some((o) => o.building === 'A10')).toBe(false);

    const grown = growBuilding(data, s, SEAT, 'A12', 'A4');
    expect(
      pendingAnswers(data, grown.state)
        .flatMap((a) => (a.kind === 'activate' ? [a.card] : []))
        .sort(),
    ).toEqual(['A10', 'A11']);
    const state = fireEverything(grown.state);
    expect(buildingOf(state, SEAT, 'A10').stack).toHaveLength(2);
    expect([...state.turn.firedThisTurn].sort()).toEqual(['A10', 'A11', 'A12']);
  });

  /**
   * The Farmstead modifies the GROW ACTION, not card text that says GROW. Two
   * activations off one action still draw one card.
   */
  it('A12 does not trigger the Farmstead draw, where a plain GROW action does', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A12', 'A10', 'A11');
    dealTo(data, s, SEAT, 'A4');
    const hut = apply(data, s, { type: 'grow', seat: SEAT, building: 'A12', payment: 'A4' });
    expect(hut.state.tasks.filter((t) => t.t === 'draw' && t.src === 'A2')).toHaveLength(1);
    const fired = fireEverything(hut.state);
    expect([...fired.turn.firedThisTurn].sort()).toEqual(['A10', 'A11', 'A12']);

    const plain = apiaryState();
    buildFor(data, plain, SEAT, 'A11');
    dealTo(data, plain, SEAT, 'A4');
    const grown = apply(data, plain, { type: 'grow', seat: SEAT, building: 'A11', payment: 'A4' });
    expect(grown.state.tasks.filter((t) => t.t === 'draw' && t.src === 'A2')).toHaveLength(1);
  });

  /**
   * The guard lives in the SHARED path (`growOptions`), not in apiary.ts, which
   * is what stops O13 The Grand Orchard re-entering a card A6 The Garden Hive
   * has already grown in a mixed tableau.
   */
  it('A6 + O13: doGrow re-entry stays guarded in a mixed tableau', () => {
    const s = makeState(data, ['orchard', 'wheat']);
    buildFor(data, s, SEAT, 'O13', 'O4', 'O5', 'A6');
    dealTo(data, s, SEAT, 'A4', 'O6', 'O7', 'W4');

    // A6 grows O4 with a card of ANY crop - a REAL grow, through doGrow.
    const grown = apply(data, s, { type: 'grow', seat: SEAT, building: 'A6', payment: 'A4' });
    const growO4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'O4' && a.payload.payment === 'W4',
    );
    expect(growO4).toBeDefined();
    const state = answerAll(answerTask(data, grown.state, growO4 as TaskAnswer).state);
    expect(buildingOf(state, SEAT, 'O4').stack).toEqual(['W4']);
    expect([...state.turn.firedThisTurn].sort()).toEqual(['A6', 'O4']);
    expect(growOptions(data, state, SEAT).map((o) => o.building)).not.toContain('O4');

    // Unspend the action so the same TURN can take O13's - the guard is what is
    // under test, not the one-action rule.
    state.turn.actionSpent = false;
    const run = apply(data, state, actionMoveFor(state, 'O13'));
    const offered = pendingAnswers(data, run.state).flatMap((a) =>
      a.kind === 'card' ? [a.payload.building] : [],
    );
    expect(new Set(offered)).toEqual(new Set(['O5']));
  });

  /** ⚠️ A4's card is TAKEN, not harvested: no harvest hook of any kind fires. */
  it('A4 does not fire afterHarvest on the rival', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A4');
    buildFor(data, s, RIVAL, 'W16', 'W4'); // W16: "whenever you harvest, Draw 1"
    dealTo(data, s, SEAT, 'A6');
    loadStack(data, s, RIVAL, 'W4', 1, 'wheat');

    const grown = growBuilding(data, s, SEAT, 'A4', 'A6');
    const taken = answerTask(data, grown.state, pendingAnswers(data, grown.state)[0] as TaskAnswer);
    expect(taken.events.some((e) => e.e === 'harvested')).toBe(false);
    expect(taken.state.tasks.some((t) => t.t === 'draw' && t.src === 'W16')).toBe(false);
    expect(player(taken.state, RIVAL).hand).toEqual([]);
  });

  /**
   * The clog watch, from the other side: A14 can fill a rival's Notice Board,
   * and a full Notice Board refuses the whole coin visit.
   */
  it("A14 onto a rival's Notice Board clogs it, and the next visit offer says so", () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A14');
    dealTo(data, s, SEAT, 'A4'); // a fee card, so a visit is on offer at all
    loadStack(data, s, RIVAL, 'W3', 4, 'wheat'); // 1 space left of 5
    const coinVisits = (state: GameState) =>
      legalMoves(data, state).filter((m) => m.type === 'visit' && m.payoff.mode === 'coin').length;
    expect(coinVisits(s)).toBeGreaterThan(0);

    const fired = apply(data, s, actionMoveFor(s, 'A14'));
    const ontoBoard = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'deckSow' && a.onto === 'W3',
    );
    expect(ontoBoard).toBeDefined();
    const state = answerTask(data, fired.state, ontoBoard as TaskAnswer).state;
    expect(buildingOf(state, RIVAL, 'W3').stack).toHaveLength(5); // clogged
    expect(coinVisits(state)).toBe(0);
    // And it was never a visit itself: the bonus slot is still unspent.
    expect(state.turn.bonusSpent).toBe(false);
  });

  /**
   * `afterPlacement` is placer-agnostic and the LISTENER guards (ruling G), so
   * a rival's cross-table sow onto your building never pays your Veil.
   */
  it('A16 does not fire off a rival sow onto its owner’s building, only off its own', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A14');
    buildFor(data, s, RIVAL, 'A16', 'W6', 'W7'); // the rival owns the Veil
    dealTo(data, s, RIVAL, 'W4'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, RIVAL, 'W6', 1, 'wheat');
    loadStack(data, s, RIVAL, 'W7', 1, 'wheat');

    const fired = apply(data, s, actionMoveFor(s, 'A14'));
    const ontoW6 = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'deckSow' && a.onto === 'W6',
    );
    const sown = answerTask(data, fired.state, ontoW6 as TaskAnswer);
    expect(buildingOf(sown.state, RIVAL, 'W6').stack).toHaveLength(2);
    expect(sown.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(false);

    // The same building at the same stack position, placed by the OWNER: it fires.
    const own = growBuilding(data, sown.state, RIVAL, 'W7', 'W4');
    expect(own.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(true);
  });
});
