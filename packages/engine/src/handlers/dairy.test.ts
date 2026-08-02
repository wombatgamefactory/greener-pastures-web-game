/**
 * Ticket 22: the Dairy suit, all 21 cards. Dairy is the Build suit, so almost
 * every test here is really a test of the shared BuildMods vocabulary
 * (discount / substitute / coinWild / fromBarn) and of the two Farmstead
 * engine seams, plus the three cards that reach outside it: D11's cover, D14's
 * demolish and D9's card-granted work.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player, workerState } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

const DAIRY = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['dairy', 'wheat']);
}

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

function headBuild(state: GameState): Extract<Task, { t: 'build' }> {
  const head = state.tasks[0];
  if (!head || head.t !== 'build') throw new Error('Expected a build task at the head');
  return head;
}

/** Answers to the head build task that name a given card. */
function buildsOf(state: GameState, card: string): TaskAnswer[] {
  return pendingAnswers(data, state).filter((a) => a.kind === 'build' && a.card === card);
}

describe('registry completeness', () => {
  it('every enabled Dairy card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'dairy' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });

  it('all 105 enabled cards now have handlers - the bulk card build is complete', () => {
    const missing = data.cards.catalogue
      .filter((c) => c.enabled && handlerFor(c.id) === undefined)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe('the Dairy Farmstead (D2) - the two engine seams', () => {
  it('base face: any card pays any slot, but never coins', () => {
    const s = base();
    // W9 costs 3 wheat. A Dairy seat pays with any three cards.
    dealTo(data, s, DAIRY, 'W9', 'D4', 'D5', 'D6');
    const builds = legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W9');
    expect(builds.length).toBeGreaterThan(0);

    // The wheat seat, holding exactly the same cards, cannot.
    const t = base();
    dealTo(data, t, WHEAT, 'W9', 'D4', 'D5', 'D6');
    t.turnPlayer = WHEAT;
    expect(legalMoves(data, t).filter((m) => m.type === 'build' && m.card === 'W9')).toEqual([]);
  });

  it('substitution never pays a coin price (the printed "not £")', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W16', 'D4', 'D5'); // W16 is a £2 Power card
    expect(legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W16')).toEqual([]);
    player(s, DAIRY).coins = 2;
    expect(
      legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W16').length,
    ).toBeGreaterThan(0);
  });

  it('upgraded face: one optional Build-again off the MAIN action, declinable', () => {
    const s = base();
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    dealTo(data, s, DAIRY, 'W5', 'W6', 'D4', 'D5');
    const first = legalMoves(data, s).find((m) => m.type === 'build' && m.card === 'W5');
    const built = apply(data, s, first as Move);
    expect(built.state.turn.actionSpent).toBe(true);
    expect(built.state.turn.again).toBe('build');

    // A second Build is on offer, and taking it consumes the one repeat.
    const second = legalMoves(data, built.state).find((m) => m.type === 'build');
    expect(second).toBeDefined();
    const twice = apply(data, built.state, second as Move);
    expect(twice.state.turn.again).toBeNull();
    expect(player(twice.state, DAIRY).tableau.filter((b) => b.stack.length === 0).length).toBe(5);
  });

  it('the repeat is declined by endTurn, and never armed on the base face', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W5', 'D4');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W5',
      payment: ['D4'],
    });
    expect(built.state.turn.again).toBeNull(); // base face: no repeat
  });
});

describe('the build-modifier vocabulary', () => {
  it('D4 counts the grow payment already on the Shed (discount 1 on a first activation)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'D6', 'D7');
    const grown = growBuilding(data, s, DAIRY, 'D4', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
    // W9 costs 3; at discount 1 it takes 2 cards.
    const w9 = buildsOf(grown.state, 'W9');
    expect(w9.length).toBeGreaterThan(0);
    expect(w9.every((a) => a.kind === 'build' && a.payment.length === 2)).toBe(true);
  });

  it('D8 lets barn cards join the payment, as a suit tally', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    player(s, DAIRY).barn.push(s.decks.wheat.shift() as string, s.decks.wheat.shift() as string);
    const grown = growBuilding(data, s, DAIRY, 'D8', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ discount: 1, fromBarn: true });

    // W9 at discount 1 needs 2 cards; the hand holds none spare, so both come from the barn.
    const fromBarn = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 0 && a.barn?.wheat === 2,
    );
    expect(fromBarn).toBeDefined();
    const done = answerTask(data, grown.state, fromBarn as TaskAnswer);
    expect(player(done.state, DAIRY).barn).toHaveLength(0);
    expect(player(done.state, DAIRY).tableau.some((b) => b.card === 'W9')).toBe(true);
  });

  it('D7 spends up to £2 as wild cards, on top of the printed coin price (ruling H)', () => {
    const s = base();
    player(s, DAIRY).coins = 2;
    buildFor(data, s, DAIRY, 'D7');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'D6');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ coinWild: 2 });

    // With one spare card, £2 covers the other two.
    const t = base();
    player(t, DAIRY).coins = 2;
    buildFor(data, t, DAIRY, 'D7');
    dealTo(data, t, DAIRY, 'D5', 'W9', 'D6');
    const grownT = growBuilding(data, t, DAIRY, 'D7', 'D5');
    const paid = buildsOf(grownT.state, 'W9').find((a) => a.kind === 'build' && a.coinWild === 2);
    expect(paid).toBeDefined();
    const done = answerTask(data, grownT.state, paid as TaskAnswer);
    expect(player(done.state, DAIRY).coins).toBe(0);
  });

  it('D15 discounts 1 per Dairy building, starters included', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'D5');
    // D1 + D2 + D3 + D15 = 4.
    expect(headBuild(grown.state).mods).toEqual({ discount: 4 });
  });

  it('D12 offers two independent optional builds at discount 1', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    const builds = grown.state.tasks.filter((t) => t.t === 'build');
    expect(builds).toHaveLength(2);
    expect(builds.every((t) => t.t === 'build' && t.optional === true)).toBe(true);
    expect(pendingAnswers(data, grown.state).some((a) => a.kind === 'skip')).toBe(true);
  });
});

describe('D5 The Churning Shed - sowing a card it just spent', () => {
  it('offers only the cards ITS build spent, onto the new building', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W9', 'D7', 'D8', 'D10');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    // Build W9 (3 cards, substituted) - pick any offered payment.
    const build = buildsOf(grown.state, 'W9')[0];
    expect(build).toBeDefined();
    const spent = (build as { payment: string[] }).payment;
    const afterBuild = answerTask(data, grown.state, build as TaskAnswer);

    const offers = pendingAnswers(data, afterBuild.state);
    expect(offers.some((a) => a.kind === 'skip')).toBe(true);
    const cards = offers.filter((a) => a.kind === 'card').map((a) => a.payload.card);
    expect(new Set(cards)).toEqual(new Set(spent));

    const sown = answerTask(data, afterBuild.state, offers[0] as TaskAnswer);
    expect(buildingOf(sown.state, DAIRY, 'W9').stack).toHaveLength(1);
  });

  it('does not fire on a build it did not grant', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'W5', 'D6');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['D6'] });
    expect(built.state.tasks).toHaveLength(0);
  });
});

describe('D6 The Trading Shed - £1 for a mixed payment', () => {
  it('pays only when its own build spent 2+ suits', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'D7', 'W4'); // W7 costs 2 cards
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const mixed = buildsOf(grown.state, 'W7').find(
      (a) => a.kind === 'build' && new Set(a.payment.map((c) => c[0])).size >= 2,
    );
    expect(mixed).toBeDefined();
    const done = answerTask(data, grown.state, mixed as TaskAnswer);
    expect(player(done.state, DAIRY).coins).toBe(1);
  });

  it('pays nothing for a single-suit payment', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const oneSuit = buildsOf(grown.state, 'W7').find(
      (a) => a.kind === 'build' && new Set(a.payment.map((c) => c[0])).size === 1,
    );
    expect(oneSuit).toBeDefined();
    const done = answerTask(data, grown.state, oneSuit as TaskAnswer);
    expect(player(done.state, DAIRY).coins).toBe(0);
  });
});

describe('D9 The Prosperity Wagon - the card-granted work (ruling E)', () => {
  it('works ANY worker including your own, keeps the bonus slot, mints £2', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    hireFor(s, DAIRY, 'draw');
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    // The build auto-skips (empty hand); the worker choice is next, and optional.
    const state = answerAll(grown.state, (a) => a.find((x) => x.kind === 'worker') ?? a[0]!);
    expect(player(state, DAIRY).coins).toBe(2); // the £2, no wage on your own worker
    expect(workerState(state, 'draw').trackPos).toBe(1); // the meeple DID advance
    expect(state.turn.bonusSpent).toBe(false); // not a visit: the slot survives
  });

  it('pays the rival owner the normal track wage, and the £2 to the actor', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    hireFor(s, WHEAT, 'draw');
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    const state = answerAll(grown.state, (a) => a.find((x) => x.kind === 'worker') ?? a[0]!);
    expect(player(state, DAIRY).coins).toBe(2);
    expect(player(state, WHEAT).coins).toBe(1); // wage space 1
  });

  it('mints nothing when the work is declined', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    hireFor(s, DAIRY, 'draw');
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    const skip = pendingAnswers(data, grown.state).find((a) => a.kind === 'skip');
    expect(skip).toBeDefined();
    const done = answerTask(data, grown.state, skip as TaskAnswer);
    expect(player(done.state, DAIRY).coins).toBe(0);
    expect(workerState(done.state, 'draw').trackPos).toBe(0);
  });
});

describe('the deck-top builds - D10 and D13', () => {
  it('D10 pays £3 and builds the top card of a chosen deck for free', () => {
    const s = base();
    player(s, DAIRY).coins = 3;
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    const top = s.decks.wheat[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const wheat = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    const done = answerTask(data, grown.state, wheat as TaskAnswer);
    expect(player(done.state, DAIRY).coins).toBe(0);
    expect(player(done.state, DAIRY).tableau.some((b) => b.card === top)).toBe(true);
  });

  it('D10 does nothing under £3 (the gate prices the whole effect)', () => {
    const s = base();
    player(s, DAIRY).coins = 2;
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, DAIRY).coins).toBe(2);
  });

  it('D13 pays £3 once and builds two deck tops, which may differ', () => {
    const s = base();
    player(s, DAIRY).coins = 3;
    buildFor(data, s, DAIRY, 'D13');
    dealTo(data, s, DAIRY, 'D5');
    const wheatTop = s.decks.wheat[0] as string;
    const orchardTop = s.decks.orchard[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D13', 'D5');

    let state = answerTask(
      data,
      grown.state,
      pendingAnswers(data, grown.state)[0] as TaskAnswer,
    ).state;
    const pickWheat = pendingAnswers(data, state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    state = answerTask(data, state, pickWheat as TaskAnswer).state;
    const pickOrchard = pendingAnswers(data, state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'orchard',
    );
    state = answerTask(data, state, pickOrchard as TaskAnswer).state;

    expect(player(state, DAIRY).coins).toBe(0);
    const tableau = player(state, DAIRY).tableau.map((b) => b.card);
    expect(tableau).toContain(wheatTop);
    expect(tableau).toContain(orchardTop);
  });
});

describe('D11 The Heritage House - the cover-build', () => {
  it('removes the covered card from the tableau but keeps its printed VP', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4'); // D4 is an empty tier 1, 1 VP
    dealTo(data, s, DAIRY, 'D5', 'W9', 'D6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');

    const coverD4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    expect(coverD4).toBeDefined();
    const covered = answerTask(data, grown.state, coverD4 as TaskAnswer);
    expect(player(covered.state, DAIRY).tableau.some((b) => b.card === 'D4')).toBe(false);
    expect(player(covered.state, DAIRY).covered).toEqual(['D4']);
    // D4's 1 VP still scores, as part of `printed`.
    expect(gameEndScores(data, covered.state)[DAIRY]?.printed).toBeGreaterThanOrEqual(1);

    // Then a discount-2 build follows.
    expect(headBuild(covered.state).mods).toEqual({ discount: 2 });
  });

  it('never offers a loaded building, nor itself', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D6');
    dealTo(data, s, DAIRY, 'D5'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, DAIRY, 'D6', 1);
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const targets = pendingAnswers(data, grown.state)
      .filter((a) => a.kind === 'card')
      .map((a) => a.payload.card);
    expect(targets).not.toContain('D6'); // loaded
    expect(targets).not.toContain('D11'); // holds its own grow payment
    expect(targets).toContain('D4');
  });

  it('a covered card is invisible to endgame formulas', () => {
    const s = base();
    // D19 scores 1 per non-Dairy building; cover the wheat card and it stops counting.
    buildFor(data, s, DAIRY, 'D19', 'W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'W5');
    player(s, DAIRY).covered.push('W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(0);
  });
});

describe('D14 The Cream Refinery - demolish into the barn', () => {
  it('moves an empty building plus two deck tops into the barn', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4');
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'D5');
    const takeD4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    let state = answerTask(data, grown.state, takeD4 as TaskAnswer).state;
    expect(player(state, DAIRY).barn).toEqual(['D4']);
    state = answerAll(state);
    expect(player(state, DAIRY).barn).toHaveLength(3);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'D4')).toBe(false);
  });

  it('scores nothing for the demolished card, unlike a cover', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    const before = gameEndScores(data, s)[DAIRY]?.printed ?? 0;
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    player(s, DAIRY).barn.push('D4');
    expect(gameEndScores(data, s)[DAIRY]?.printed).toBe(before - 1);
  });
});

describe('D16 The Ledger and D17 The Strongbox - the reactors', () => {
  it('D16 draws on every build by its owner, including a free one', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'D4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['D4'] });
    expect(built.state.tasks.some((t) => t.t === 'draw' && t.src === 'D16')).toBe(true);
  });

  it('D16 does not fire on a rival build', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const built = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(built.state.tasks.some((t) => t.t === 'draw' && t.src === 'D16')).toBe(false);
  });

  it('D17 pays £1 on your own hire and £1 on every work you make', () => {
    const s = base();
    player(s, DAIRY).coins = data.workers.hireFee;
    buildFor(data, s, DAIRY, 'D17');
    const hired = apply(data, s, { type: 'hire', seat: DAIRY, workerId: 'draw' });
    expect(player(hired.state, DAIRY).coins).toBe(1); // fee paid, £1 rebated

    const worked = apply(data, hired.state, {
      type: 'workOwnWorker',
      seat: DAIRY,
      workerId: 'draw',
    });
    expect(player(worked.state, DAIRY).coins).toBe(2);
  });

  it("D17 does not pay when a RIVAL works its owner's worker", () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    hireFor(s, DAIRY, 'draw');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: DAIRY,
      fee: 'W4',
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    // Only the £1 track wage - the Strongbox is actor-scoped, and the actor is Wheat.
    expect(player(applied.state, DAIRY).coins).toBe(1);
  });
});

describe('the endgame cards - D19, D20, D21', () => {
  it('D19 scores 1 per non-Dairy building', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W5', 'W6', 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });

  it('D20 scores 1 per building with a printed card cost of 4+', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D10', 'D4'); // D10 costs 3+1 = 4; D4 costs 1
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
  });

  it('D21 scores 1 per Dairy TIER card costing 3 or less', () => {
    const s = base();
    // D4 (1) and D9 (3) count; D10 (4) does not; D21 itself is an endgame card,
    // not a tier, so it never scores itself. Nothing else with a gameEnd is
    // built here - `endgame` is the sum over every handler in the tableau.
    buildFor(data, s, DAIRY, 'D21', 'D4', 'D9', 'D10');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });
});

describe('difficulty metadata stays honest for the Dairy suit', () => {
  it('the derivable flags match each handler structure', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'dairy' && x.enabled)) {
      const h = handlerFor(c.id);
      expect(h, c.id).toBeDefined();
      expect(h?.difficulty.verified.endgame, c.id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, c.id).toBe(typeof h?.moves === 'function');
    }
  });
});

describe('a full Dairy turn still settles', () => {
  it('grows the hardest card and drains without wedging', () => {
    const s = base();
    player(s, DAIRY).coins = 5;
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D16');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'D6', 'D7');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const state = answerAll(grown.state);
    expect(state.tasks).toHaveLength(0);
  });
});
