/**
 * The Dairy suit, all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md).
 *
 * Dairy is still the Build suit, so most of this file is really a test of the
 * shared `BuildMods` vocabulary - now `discount` / `substitute` / `fromStacks`,
 * with `coinWild` and `fromBarn` deleted - and of the seams that surround a
 * build: the Farmstead's diversion of a spent card into the barn, the Ledger's
 * once-per-TURN guard (once per Build ACTION until the rebalance moved it onto
 * the general rule), and the three cards that reach outside the vocabulary
 * (D11's cover, D14's demolish, D15's ascending-cost run).
 *
 * The two sentences this docblock used to carry are both false now and are
 * named so nobody looks for them: there is no `buildSubstitutePower` (a Dairy
 * seat matches crops like everybody else - substitution is the Builder's Yard's
 * to grant) and no `buildAgainPower` (nothing sells a second Build action).
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { doBuild } from '../actions.js';
import { Fx } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { CardId, GameState, Move, Task, TaskAnswer } from '../state.js';
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

/** The same answers, narrowed, because D7's cap is asserted against `stacks`. */
function buildOffersOf(state: GameState, card: string): Extract<TaskAnswer, { kind: 'build' }>[] {
  return pendingAnswers(data, state).flatMap((a) =>
    a.kind === 'build' && a.card === card ? [a] : [],
  );
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

  it('upgraded face: up to 2 spent cards may go to the barn, and no more', () => {
    const s = base();
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    dealTo(data, s, DAIRY, 'W9', 'W4', 'W5', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W9',
      payment: ['W4', 'W5', 'W6'],
    });
    const one = divert(built.state, 'W4');
    expect(one.tasks.length).toBeGreaterThan(0);
    const both = divert(one, 'W5');
    // The CAP is what stops it, not the size of the payment: W6 was spent on the
    // same build and stays in the discard. The face read "every card you spend"
    // until the rebalance, at which price a Dairy build cost nothing in cards at
    // all - the whole payment came back and the hand clock stopped applying.
    expect(player(both, DAIRY).barn.sort()).toEqual(['W4', 'W5']);
    expect(both.discards.wheat).toEqual(['W6']);
    expect(both.tasks).toHaveLength(0);
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
  it('D4 grants a flat discount of 1, whatever is on its stack', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'D6');
    const grown = growBuilding(data, s, DAIRY, 'D4', 'D5');
    // The rebalance (v21) took this from 2 to 1. Still flat and still
    // unconditional, which is the half of the card that was never in question.
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
    // W9 costs 3; at discount 1 it takes two cards, and either of them may be
    // any crop, because a discount waives the own-suit half.
    const w9 = buildsOf(grown.state, 'W9');
    expect(w9.length).toBeGreaterThan(0);
    expect(w9.every((a) => a.kind === 'build' && a.payment.length === 2)).toBe(true);
    expect(w9.some((a) => a.kind === 'build' && a.payment.includes('D6'))).toBe(true);
  });

  it('D9 discounts 1 per different CROP among the buildings BUILT, not 1 per building', () => {
    // Five buildings and one crop. The rebalance repointed the Wagon from volume
    // to variety, so a monoculture farm reads 1 however big it grows - it was
    // paying a discount of 6 at the measured 12.02 buildings a seat.
    const s = base();
    buildFor(data, s, DAIRY, 'D9', 'D4', 'D6', 'D7', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const mono = growBuilding(data, s, DAIRY, 'D9', 'D5');
    expect(headBuild(mono.state).mods).toEqual({ discount: 1 });

    // Three buildings and three crops: fewer buildings, a bigger discount.
    const t = base();
    buildFor(data, t, DAIRY, 'D9', 'W4', 'O4');
    dealTo(data, t, DAIRY, 'D5', 'W9', 'W5', 'W6');
    const mixed = growBuilding(data, t, DAIRY, 'D9', 'D5');
    expect(headBuild(mixed.state).mods).toEqual({ discount: 3 });
  });

  it('D9 counts crops on buildings BUILT, so a flipped starter never adds one', () => {
    // Ruling M: W19 The Wheat Exchange prints the same eleven words and reads a
    // DIFFERENT set - the whole tableau through cropOf, which returns a
    // starter's suit once it is flipped. The Wagon reads builtBuildings, the
    // noun the rest of the suit shares, and a starter is outside it either way.
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    for (const id of ['D1', 'D2', 'D3']) buildingOf(s, DAIRY, id).upgraded = true;
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    // Dairy, off the Wagon itself and nothing else - so it still opens at 1.
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
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

  it('D7 pays off ONE building: no option mixes cards from two stacks', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 2, 'wheat');
    const onD4 = [...buildingOf(s, DAIRY, 'D4').stack];
    const onD8 = [...buildingOf(s, DAIRY, 'D8').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');

    // W9 costs 3, and every card in reach is wheat, so before the cap the
    // enumerator would happily have taken two off D4 and one off D8.
    const offers = buildOffersOf(grown.state, 'W9');
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const stacks = offer.stacks ?? [];
      const mixed = stacks.some((c) => onD4.includes(c)) && stacks.some((c) => onD8.includes(c));
      expect(mixed, JSON.stringify(offer)).toBe(false);
    }
    // Both single-building payments survive, and so does the hand-only one: the
    // empty leading source is why the option set is a union and not a partition.
    expect(offers.some((o) => (o.stacks ?? []).some((c) => onD4.includes(c)))).toBe(true);
    expect(offers.some((o) => (o.stacks ?? []).some((c) => onD8.includes(c)))).toBe(true);
    expect(offers.some((o) => o.stacks === undefined && o.payment.length === 3)).toBe(true);
  });

  it('D7 re-validates the cap on the way in, not only in the enumerator', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 2, 'wheat');
    const onD4 = buildingOf(s, DAIRY, 'D4').stack as CardId[];
    const onD8 = buildingOf(s, DAIRY, 'D8').stack as CardId[];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');

    // buildOptions never offers this, so the second guard can only be reached by
    // calling doBuild - which is exactly the case it is there for, since apply
    // has to refuse a payment that was never on the menu. Nothing has moved when
    // it throws: every check in doBuild runs before the first mutation.
    const fx = new Fx(data, grown.state, DAIRY);
    expect(() =>
      doBuild(
        fx,
        DAIRY,
        {
          card: 'W9',
          payment: [],
          stacks: [onD4[0] as CardId, onD4[1] as CardId, onD8[0] as CardId],
        },
        { fromStacks: true },
      ),
    ).toThrow(/only one of your buildings/);
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
    // The build it grants is FULL PRICE since the rebalance: the discount of 2
    // was the clause that cut free cards and teach cost without touching the
    // idea, and an upgrade plus a harvest plus an un-clog is still the card.
    expect(headBuild(covered).mods).toEqual({});
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
    // Hand limit 5 since the rebalance took the Dairy Barn from 6 to the field's
    // number: seven buildings drawn into a hand of three leaves five to give
    // away, where the same fixture used to leak four. The brake got tighter and
    // the Vault got more generous, which is the whole reason the Barn moved.
    dealTo(data, s, DAIRY, 'W4', 'W5', 'W6');
    const move = actionMoveFor(s, 'D13') as Move;
    expect(move).toBeDefined();
    const fired = apply(data, s, move);
    expect(fired.state.turn.actionSpent).toBe(true);

    const state = answerAll(fired.state);
    expect(player(state, DAIRY).hand.length).toBe(5);
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

  it('D20 scores 1 for every 2 buildings BUILT - never a starter, however many are flipped', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D10', 'D4');
    for (const id of ['D1', 'D2', 'D3']) buildingOf(s, DAIRY, id).upgraded = true;
    // D20, D10 and D4 - the starters are not built - and the divisor of 2 the
    // rebalance added rounds three down to one.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
    // So the fourth building is what actually pays for the third.
    buildFor(data, s, DAIRY, 'D5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });

  it('D21 scores 2 for each of your starters showing its upgraded side', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(0);
    // Two flips, at £2 each.
    buildingOf(s, DAIRY, 'D1').upgraded = true;
    buildingOf(s, DAIRY, 'D3').upgraded = true;
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(4);
    // And the Farmstead counts, which is what makes the ceiling 6 rather than
    // 4. Ruling L is closed: it is a £2 purchase like the other two since
    // 2026-08-12, so the 6 VP now costs the full £6.
    buildingOf(s, DAIRY, 'D2').upgraded = true;
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(6);
  });

  it('D21 never counts a BUILDING, which is the trap builtBuildings sets', () => {
    // ⛔ builtBuildings - the noun D9, D11, D13, D14 and D20 all share - exists
    // precisely to EXCLUDE starters, so reaching for it here out of habit scores
    // 0 forever and no test of types or shapes would see it. Six built buildings
    // and no flip is the case that catches it both ways round: written on the
    // shared noun this reads 12, written on the starter faces it reads 0.
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D4', 'D5', 'D6', 'D7', 'D8');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(0);
  });
});

describe('the SHED keyword - the Barn rider is now its only reader', () => {
  it('SHED means exactly the five Tier 1 cards', () => {
    const sheds = data.cards.catalogue
      .filter((c) => c.suit === 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(sheds).toEqual(['D4', 'D5', 'D6', 'D7', 'D8']);
    // ⚠️ The hazard the keyword reading carries: any future card named
    // "... Shed" joins the set silently. Nothing outside Dairy carries it today.
    // D21 The Refinery read it until the rebalance repointed it at upgraded
    // starter faces, so D1's build rider is the last reader left - one caller is
    // exactly when a keyword is cheapest to get wrong.
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
