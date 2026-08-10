/**
 * The Dairy suit, all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md).
 *
 * Dairy is still the Build suit, so most of this file is really a test of the
 * shared `BuildMods` vocabulary - now `discount` / `substitute` / `fromStacks`,
 * with `coinWild` and `fromBarn` deleted - and of the seams that surround a
 * build: the Farmstead's diversion of a spent card into the barn, the Ledger's
 * once-per-Build-action guard, and the three cards that reach outside the
 * vocabulary (D11's cover, D14's demolish, D15's ascending-cost run).
 *
 * The two sentences this docblock used to carry are both false now and are
 * named so nobody looks for them: there is no `buildSubstitutePower` (a Dairy
 * seat matches crops like everybody else - substitution is the Builder's Yard's
 * to grant) and no `buildAgainPower` (nothing sells a second Build action).
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

const DAIRY = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['dairy', 'wheat']);
}

function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 60 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function headBuild(state: GameState): Extract<Task, { t: 'build' }> {
  const head = state.tasks.find((t) => t.t === 'build');
  if (!head || head.t !== 'build') throw new Error('Expected a build task');
  return head;
}

/** Answers to the head build task that name a given card. */
function buildsOf(state: GameState, card: string): TaskAnswer[] {
  return pendingAnswers(data, state).filter((a) => a.kind === 'build' && a.card === card);
}

/** Card payloads offered by whatever card task is at the head. */
function offeredCards(state: GameState): unknown[] {
  return pendingAnswers(data, state)
    .filter((a) => a.kind === 'card')
    .map((a) => a.payload.card);
}

/** The standing ACTION move a built Tier 3 offers, if it is live. */
function actionMoveFor(state: GameState, card: string): Move | undefined {
  return legalMoves(data, state).find((m) => m.type === 'cardMove' && m.card === card);
}

/** Take the divert answer that banks `card`, or the skip when `card` is null. */
function divert(state: GameState, card: string | null): GameState {
  const answers = pendingAnswers(data, state);
  const wanted =
    card === null
      ? answers.find((a) => a.kind === 'skip')
      : answers.find((a) => a.kind === 'card' && a.payload.card === card);
  if (!wanted) throw new Error(`No divert answer for ${card ?? 'skip'}`);
  return answerTask(data, state, wanted).state;
}

describe('registry completeness', () => {
  it('every enabled Dairy card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'dairy' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });

  it('all 105 enabled cards have handlers', () => {
    const missing = data.cards.catalogue
      .filter((c) => c.enabled && handlerFor(c.id) === undefined)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe('the deleted Farmstead powers', () => {
  it('a Dairy seat has to match crops like everybody else', () => {
    const s = base();
    // W9 costs 3 wheat. A Dairy seat holding three dairy cards used to be able
    // to pay for it and now cannot: that is buildSubstitutePower, deleted.
    dealTo(data, s, DAIRY, 'W9', 'D4', 'D5', 'D6');
    expect(legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W9')).toEqual([]);
  });

  it('the Builder’s Yard still grants substitution - and now a discount too', () => {
    const svc = data.workers.roster.find((w) => w.id === 'build');
    expect(svc?.build).toEqual({ substitute: true, discount: 1 });
  });

  it('no build arms an ActionAgain repeat, on either Farmstead face', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, DAIRY, 'D2').upgraded = upgraded;
      dealTo(data, s, DAIRY, 'W5', 'W4');
      const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
      expect(built.state.turn.actionSpent).toBe(true);
      expect(built.state.turn.again, `upgraded=${upgraded}`).toBeNull();
    }
  });
});

describe('D2 The Farmstead - the diversion', () => {
  it('base face: one spent card goes to the barn instead of the discard', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    // The payment is in limbo until the choice is answered - neither in the
    // discard nor in the barn.
    expect(built.state.discards.wheat).toEqual([]);
    expect(offeredCards(built.state).sort()).toEqual(['W4', 'W6']);

    const done = divert(built.state, 'W4');
    expect(player(done, DAIRY).barn).toEqual(['W4']);
    expect(done.discards.wheat).toEqual(['W6']);
  });

  it('base face: exactly one, and the rest are discarded', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    const done = divert(built.state, 'W4');
    expect(done.tasks).toHaveLength(0);
    expect(player(done, DAIRY).barn).toHaveLength(1);
  });

  it('upgraded face: every spent card may go to the barn', () => {
    const s = base();
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    const one = divert(built.state, 'W4');
    expect(one.tasks.length).toBeGreaterThan(0);
    const both = divert(one, 'W6');
    expect(player(both, DAIRY).barn.sort()).toEqual(['W4', 'W6']);
    expect(both.discards.wheat).toEqual([]);
  });

  it('declining leaves the whole payment in the discard', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    const done = divert(built.state, null);
    expect(player(done, DAIRY).barn).toEqual([]);
    expect(done.discards.wheat.sort()).toEqual(['W4', 'W6']);
  });

  it('a FREE build spends no cards, so it diverts nothing', () => {
    const s = base();
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    buildFor(data, s, DAIRY, 'D15');
    const move = actionMoveFor(s, 'D15') as Move;
    const fired = apply(data, s, move);
    // The Creamery's flip is the head task, not a divert.
    expect(fired.state.tasks[0]?.t).toBe('card');
    expect((fired.state.tasks[0] as Extract<Task, { t: 'card' }>).kind).toBe('creameryFlip');
  });

  it('only a Dairy seat diverts', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const built = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    // W5 is a FIELD, so the Wheat Barn's own rider queues a Draw 2 - what must
    // be absent is the divert, and the payment must already be in the discard.
    expect(built.state.tasks.filter((t) => t.t === 'card')).toHaveLength(0);
    expect(built.state.discards.wheat).toEqual(['W4']);
  });
});

describe('the build-modifier vocabulary', () => {
  it('D4 grants a flat discount of 2, whatever is on its stack', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D4', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ discount: 2 });
    // W9 costs 3; at discount 2 it takes one card, and any card, because a
    // discount waives the own-suit half.
    const w9 = buildsOf(grown.state, 'W9');
    expect(w9.length).toBeGreaterThan(0);
    expect(w9.every((a) => a.kind === 'build' && a.payment.length === 1)).toBe(true);
  });

  it('D9 discounts 1 for every 2 buildings BUILT - starters never count', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    // One building built (D9 itself) despite four starters: floor(1/2) = 0.
    const alone = growBuilding(data, s, DAIRY, 'D9', 'D5');
    expect(headBuild(alone.state).mods).toEqual({ discount: 0 });

    const t = base();
    buildFor(data, t, DAIRY, 'D9', 'D4', 'D6', 'D7', 'D8');
    dealTo(data, t, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const wide = growBuilding(data, t, DAIRY, 'D9', 'D5');
    expect(headBuild(wide.state).mods).toEqual({ discount: 2 });
  });

  it('D7 lets cards come off your own buildings, and they are SPENT not harvested', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ fromStacks: true });

    // W9 costs 2 wheat + 1 wild and the hand holds nothing spare, so the whole
    // price can come off D4's stack - which is also the proof that several cards
    // of one crop on ONE building are all reachable, not collapsed to one.
    const offStacks = buildsOf(grown.state, 'W9').find(
      (a) =>
        a.kind === 'build' && a.payment.length === 0 && stacked.every((c) => a.stacks?.includes(c)),
    );
    expect(offStacks).toBeDefined();
    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    expect(buildingOf(done, DAIRY, 'D4').stack).toEqual([]);
    // Spent, not harvested: nothing reached the barn.
    expect(player(done, DAIRY).barn).toEqual([]);
    for (const card of stacked) expect(done.discards.wheat).toContain(card);
    expect(player(done, DAIRY).tableau.some((b) => b.card === 'W9')).toBe(true);
  });

  it('D7 + D2: a stack card is never divertible, so the pair is not a free Harvest', () => {
    const s = base();
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    buildFor(data, s, DAIRY, 'D7', 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    const offStacks = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 0 && (a.stacks?.length ?? 0) === 3,
    );
    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    // No divert task at all: the whole payment came off stacks.
    expect(done.tasks.filter((t) => t.t === 'card' && t.kind === 'divertSpent')).toHaveLength(0);
    expect(player(done, DAIRY).barn).toEqual([]);
  });

  it('a build may not spend stack cards without the mod', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    dealTo(data, s, DAIRY, 'W9', 'W4', 'W5', 'W6');
    loadStack(data, s, DAIRY, 'D4', 1, 'wheat');
    const onStack = buildingOf(s, DAIRY, 'D4').stack[0] as string;
    const offered = legalMoves(data, s).filter((m) => m.type === 'build');
    expect(offered.every((m) => m.type === 'build' && !m.payment.includes(onStack))).toBe(true);
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

describe('D5 The Churning Shed - sowing the cards it just spent', () => {
  it('sows EVERY spent card, one after another, onto the new building', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    // W7 costs 2 wheat and its threshold is 3, so both spent cards fit on it.
    const build = buildsOf(grown.state, 'W7')[0];
    expect(build).toBeDefined();
    const spent = (build as { payment: string[] }).payment;
    let state = answerTask(data, grown.state, build as TaskAnswer).state;

    // Decline the Farmstead's diversion so the whole payment is available.
    state = divert(state, null);
    expect(new Set(offeredCards(state))).toEqual(new Set(spent));

    state = answerAll(state);
    expect(buildingOf(state, DAIRY, 'W7').stack.sort()).toEqual([...spent].sort());
  });

  it('D5 + D2: one destination per card - a diverted card cannot also be sown', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = buildsOf(grown.state, 'W7')[0];
    const spent = (build as { payment: string[] }).payment;
    const banked = spent[0] as string;
    let state = answerTask(data, grown.state, build as TaskAnswer).state;

    state = divert(state, banked);
    expect(player(state, DAIRY).barn).toEqual([banked]);
    // The banked card is out of the discard, so D5 can never reach it.
    expect(offeredCards(state)).not.toContain(banked);
    state = answerAll(state);
    expect(buildingOf(state, DAIRY, 'W7').stack).not.toContain(banked);
    expect(player(state, DAIRY).barn).toEqual([banked]);
  });

  it('does not fire on a build it did not grant', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    const kinds = built.state.tasks.filter((t) => t.t === 'card').map((t) => t.kind);
    expect(kinds).not.toContain('sowSpent');
  });
});

describe('D6 The Trading Shed - the card across the table', () => {
  it('gives one spent card to a neighbour and mints £1', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const build = buildsOf(grown.state, 'W7')[0];
    let state = answerTask(data, grown.state, build as TaskAnswer).state;
    state = divert(state, null);

    const give = pendingAnswers(data, state).find((a) => a.kind === 'card');
    expect(give).toBeDefined();
    const card = (give as Extract<TaskAnswer, { kind: 'card' }>).payload.card as string;
    state = answerTask(data, state, give as TaskAnswer).state;
    expect(player(state, DAIRY).coins).toBe(1);
    expect(player(state, WHEAT).hand).toContain(card);
    expect(state.discards.wheat).not.toContain(card);
  });

  it('no eligible neighbour means NO COIN - the £1 pays for the gift', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'W4', 'W5');
    // Fill the Wheat seat's hand to its printed limit: it cannot receive (DL-63).
    const wheatBarn = buildingOf(s, WHEAT, 'W1');
    const limit = data.cards.catalogue.find((c) => c.id === 'W1')?.faces?.starter.handSize ?? 5;
    expect(wheatBarn).toBeDefined();
    for (let i = 0; i < limit; i++) {
      player(s, WHEAT).hand.push(s.decks.orchard.shift() as string);
    }
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const build = buildsOf(grown.state, 'W7')[0];
    let state = answerTask(data, grown.state, build as TaskAnswer).state;
    state = divert(state, null);
    state = answerAll(state);
    expect(player(state, DAIRY).coins).toBe(0);
  });
});

describe("D10 The Scout's Post - the free look", () => {
  it('reveals every live deck and builds one at a discount of 2', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const wheatTop = s.decks.wheat[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const offers = pendingAnswers(data, grown.state).filter((a) => a.kind === 'card');
    // One top per suit in play is on offer (those that are affordable at -2).
    expect(offers.length).toBeGreaterThan(0);
    const takeWheat = offers.find((a) => a.payload.card === wheatTop);
    expect(takeWheat).toBeDefined();
    const state = answerAll(answerTask(data, grown.state, takeWheat as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === wheatTop)).toBe(true);
  });

  it('unbuilt reveals go back on top of their own decks, never to a discard', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    const tops = Object.fromEntries(
      data.cards.suits.map((suit) => [suit, s.decks[suit][0] as string]),
    );
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const skip = pendingAnswers(data, grown.state).find((a) => a.kind === 'skip');
    expect(skip).toBeDefined();
    const done = answerTask(data, grown.state, skip as TaskAnswer).state;
    for (const suit of data.cards.suits) {
      expect(done.decks[suit][0], suit).toBe(tops[suit]);
      expect(done.discards[suit], suit).toEqual([]);
    }
  });

  it('costs no coins: the £3 gate is gone', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    expect(player(s, DAIRY).coins).toBe(0);
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    expect(pendingAnswers(data, grown.state).some((a) => a.kind === 'card')).toBe(true);
  });
});

describe('D11 The Heritage House - the cover-build', () => {
  it('ships the covered building’s stack to the barn, then covers, then builds', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');

    const coverD4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    expect(coverD4).toBeDefined();
    const covered = answerTask(data, grown.state, coverD4 as TaskAnswer).state;
    expect(player(covered, DAIRY).barn.sort()).toEqual([...stacked].sort());
    expect(player(covered, DAIRY).tableau.some((b) => b.card === 'D4')).toBe(false);
    expect(player(covered, DAIRY).covered).toEqual(['D4']);
    expect(gameEndScores(data, covered)[DAIRY]?.printed).toBeGreaterThanOrEqual(1);
    expect(headBuild(covered).mods).toEqual({ discount: 2 });
  });

  it('a LOADED building is a legal target now, and a starter never is', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D6');
    dealTo(data, s, DAIRY, 'D5');
    loadStack(data, s, DAIRY, 'D6', 1);
    buildingOf(s, DAIRY, 'D3').upgraded = true;
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const targets = offeredCards(grown.state);
    expect(targets).toContain('D6'); // loaded, and now allowed
    expect(targets).toContain('D4');
    expect(targets).not.toContain('D1'); // Barn
    expect(targets).not.toContain('D2'); // Farmstead
    expect(targets).not.toContain('D3'); // Notice Board, upgraded
    expect(targets).not.toContain('D0'); // the Service
  });

  it('a covered card is invisible to endgame formulas', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'W5');
    player(s, DAIRY).covered.push('W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(0);
  });
});

describe('D13 The Cheese Vault (ACTION) - the overflow', () => {
  it('draws one per building BUILT, and gives the excess away for £1 each', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9');
    // Hand limit 6, seven buildings built - so one card must cross the table.
    dealTo(data, s, DAIRY, 'W4', 'W5', 'W6');
    const move = actionMoveFor(s, 'D13') as Move;
    expect(move).toBeDefined();
    const fired = apply(data, s, move);
    expect(fired.state.turn.actionSpent).toBe(true);

    const state = answerAll(fired.state);
    expect(player(state, DAIRY).hand.length).toBe(6);
    expect(player(state, WHEAT).hand.length).toBeGreaterThan(0);
    expect(player(state, DAIRY).coins).toBe(player(state, WHEAT).hand.length);
  });

  it('gives nothing away when the draw fits inside the hand limit', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4');
    const move = actionMoveFor(s, 'D13') as Move;
    const state = answerAll(apply(data, s, move).state);
    expect(player(state, DAIRY).hand.length).toBe(2);
    expect(player(state, WHEAT).hand).toEqual([]);
    expect(player(state, DAIRY).coins).toBe(0);
  });

  it('is not offered with nothing built', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13');
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D13');
    expect(actionMoveFor(s, 'D13')).toBeUndefined();
  });
});

describe('D14 The Cream Refinery (ACTION) - the demolition', () => {
  it('takes the building and its stack into the barn, then a deck top per cost card', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D9'); // D9 costs 2 dairy + 1 wild = 3 cards
    loadStack(data, s, DAIRY, 'D9', 2, 'wheat');
    const move = actionMoveFor(s, 'D14') as Move;
    const fired = apply(data, s, move);
    const takeD9 = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D9',
    );
    let state = answerTask(data, fired.state, takeD9 as TaskAnswer).state;
    // 2 stack cards + the building itself, then 3 deck tops.
    expect(player(state, DAIRY).barn).toHaveLength(3);
    state = answerAll(state);
    expect(player(state, DAIRY).barn).toHaveLength(6);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'D9')).toBe(false);
  });

  it('never offers a starter, so it cannot mint freight from one (ticket 30)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4');
    buildingOf(s, DAIRY, 'D3').upgraded = true;
    const fired = apply(data, s, actionMoveFor(s, 'D14') as Move);
    const targets = offeredCards(fired.state);
    expect(targets).not.toContain('D0');
    expect(targets).not.toContain('D1');
    expect(targets).not.toContain('D2');
    expect(targets).not.toContain('D3');
    expect(targets).toContain('D4');
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

describe('D15 The Grand Creamery (ACTION) - the ascending-cost run', () => {
  it('builds a first flip free, whatever it costs', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    const top = s.decks.wheat[0] as string;
    const fired = apply(data, s, actionMoveFor(s, 'D15') as Move);
    const wheat = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    const state = answerTask(data, fired.state, wheat as TaskAnswer).state;
    expect(player(state, DAIRY).tableau.some((b) => b.card === top)).toBe(true);
    // The run continues: a fresh flip is offered.
    expect(pendingAnswers(data, state).some((a) => a.kind === 'card')).toBe(true);
  });

  it('a cheaper-or-equal second flip busts: the card is discarded and the run ends', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    // Wheat's deck runs W4 (cost 1) then W5 (cost 1): equal, so the second busts.
    const first = s.decks.wheat[0] as string;
    const second = s.decks.wheat[1] as string;
    const fired = apply(data, s, actionMoveFor(s, 'D15') as Move);
    const pickWheat = (state: GameState) =>
      pendingAnswers(data, state).find((a) => a.kind === 'card' && a.payload.suit === 'wheat');
    let state = answerTask(data, fired.state, pickWheat(fired.state) as TaskAnswer).state;
    state = answerTask(data, state, pickWheat(state) as TaskAnswer).state;
    expect(player(state, DAIRY).tableau.some((b) => b.card === first)).toBe(true);
    expect(player(state, DAIRY).tableau.some((b) => b.card === second)).toBe(false);
    expect(state.discards.wheat).toContain(second);
    expect(state.tasks).toHaveLength(0);
  });

  it('you may always stop', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    const fired = apply(data, s, actionMoveFor(s, 'D15') as Move);
    const skip = pendingAnswers(data, fired.state).find((a) => a.kind === 'skip');
    expect(skip).toBeDefined();
    const state = answerTask(data, fired.state, skip as TaskAnswer).state;
    expect(state.tasks).toHaveLength(0);
  });

  it('a coin-priced card counts as cost 0, so it builds free and the run goes on', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    // Put a £2 Power card (card cost 0) on top of the wheat deck.
    s.decks.wheat = ['W16', ...s.decks.wheat.filter((c) => c !== 'W16')];
    const fired = apply(data, s, actionMoveFor(s, 'D15') as Move);
    const wheat = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    const state = answerTask(data, fired.state, wheat as TaskAnswer).state;
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W16')).toBe(true);
    expect(player(state, DAIRY).coins).toBe(0); // free: no coin price paid
    expect(pendingAnswers(data, state).some((a) => a.kind === 'card')).toBe(true);
  });
});

describe('D16 The Ledger and D17 The Strongbox - the reactors', () => {
  it('D16 draws once on a plain Build action', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(built.state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16')).toHaveLength(1);
  });

  it('D16 fires ONCE for a Butter Factory that builds twice', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    let state = grown.state;
    let draws = 0;
    for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
      const before = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      const answers = pendingAnswers(data, state);
      const build = answers.find((a) => a.kind === 'build');
      state = answerTask(data, state, (build ?? answers[0]) as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      if (after > before) draws += after - before;
    }
    expect(draws).toBe(1);
  });

  it('D16 does not fire on a rival build', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const built = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(built.state.tasks.some((t) => t.t === 'draw' && t.src === 'D16')).toBe(false);
  });

  it('D17 pays £1 whenever a NEIGHBOUR builds, and never for your own', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const rival = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(player(rival.state, DAIRY).coins).toBe(1);

    const t = base();
    buildFor(data, t, DAIRY, 'D17');
    dealTo(data, t, DAIRY, 'W5', 'W4');
    const own = apply(data, t, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(player(own.state, DAIRY).coins).toBe(0);
  });
});

describe('the endgame cards - D19, D20, D21', () => {
  it('D19 scores 1 per building printing a non-Dairy crop icon', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W5', 'W6', 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
    // Ticket 07: a base starter prints no crop, and flipping it makes it a
    // DAIRY one - so this card never pays a Dairy seat for its own starters.
    buildingOf(s, DAIRY, 'D1').upgraded = true;
    buildingOf(s, DAIRY, 'D3').upgraded = true;
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });

  it('D20 scores 1 per building BUILT - never a starter, however many are flipped', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D10', 'D4');
    for (const id of ['D1', 'D2', 'D3']) buildingOf(s, DAIRY, id).upgraded = true;
    // D20, D10 and D4 - the four starters are not built.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(3);
  });

  it('D21 scores 2 per SHED, which is D4 to D8 and nothing else', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D4', 'D8', 'D9', 'D11');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(4);
  });

  it('SHED means exactly the five Tier 1 cards', () => {
    const sheds = data.cards.catalogue
      .filter((c) => c.suit === 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(sheds).toEqual(['D4', 'D5', 'D6', 'D7', 'D8']);
    // ⚠️ The hazard the keyword reading carries: any future card named
    // "... Shed" joins the set silently. Nothing outside Dairy carries it today.
    const strays = data.cards.catalogue
      .filter((c) => c.suit !== 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(strays).toEqual([]);
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

  it('the three Tier 3 cards print an ACTION and declare it', () => {
    for (const id of ['D13', 'D14', 'D15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).toBeNull();
      expect(card?.activationType, id).toBeNull();
      expect(card?.abilityTrigger, id).toEqual(['action']);
      expect(handlerFor(id)?.actionMoves, id).toBe(true);
      expect(typeof handlerFor(id)?.moves, id).toBe('function');
    }
  });
});

describe('a full Dairy turn still settles', () => {
  it('grows the hardest card and drains without wedging', () => {
    const s = base();
    player(s, DAIRY).coins = 5;
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D16');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const state = answerAll(grown.state);
    expect(state.tasks).toHaveLength(0);
  });

  it('runs the Grand Creamery to exhaustion without wedging', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    const fired = apply(data, s, actionMoveFor(s, 'D15') as Move);
    const state = answerAll(fired.state, (a) => a.find((x) => x.kind === 'card') ?? a[0]!);
    expect(state.tasks).toHaveLength(0);
  });
});
