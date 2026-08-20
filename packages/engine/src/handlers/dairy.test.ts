/**
 * The Dairy suit, all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md).
 *
 * Dairy is still the Build suit, so most of this file is really a test of the
 * shared `BuildMods` vocabulary - now `discount` / `substitute` / `fromStacks`,
 * with `coinWild` and `fromBarn` deleted - and of the seams that surround a
 * build: the Farmstead's diversion of a spent card into the barn, the Ledger's
 * reaction to every build, and the two cards that reach outside the vocabulary
 * (D11's sow-the-payment and D14's demolish).
 *
 * Four sentences this docblock used to carry are false now and are named so
 * nobody looks for them. There is no `buildSubstitutePower` (a Dairy seat
 * matches crops like everybody else - substitution is the Builder's Yard's to
 * grant) and no `buildAgainPower` (nothing sells a second Build action). There
 * is no cover and no `covered` zone: D11 was retexted on 19/08/2026 and the
 * zone was deleted with it. And there is no ACTION card: D13, D14 and D15 are
 * ordinary GROW buildings as of the same date, so every test that used to fire
 * one through a standing move now grows it.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { doBuild } from '../actions.js';
import { Fx } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { CardId, GameState, Task, TaskAnswer } from '../state.js';
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

  it('the Builder’s Yard grants substitution and a discount of 2', () => {
    // D3 the Dairy Notice Board prints the VISITOR text on both faces and the
    // number lives in workers.json. It went 1 -> 2 on 19/08/2026 (v30 group A):
    // at 1 the discount exactly refunded the card the visitor placed, which is
    // worth precisely nothing, so at 2 the visit is card-positive.
    const svc = data.workers.roster.find((w) => w.id === 'build');
    expect(svc?.build).toEqual({ substitute: true, discount: 2 });
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
    dealTo(data, s, DAIRY, 'W4');
    // The Creamery is a GROW building since 19/08/2026, so the grow's own
    // payment is the only card that moves; its flip is the head task, and the
    // free build it ends in still puts no divert in front of it.
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    expect(grown.state.tasks[0]?.t).toBe('card');
    expect((grown.state.tasks[0] as Extract<Task, { t: 'card' }>).kind).toBe('creameryFlip');
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
    // W4 is the spare wheat card the hand has to keep now: at 2 per stack card
    // an odd cost can never be paid off the stack alone, so a hand with nothing
    // in it but the card being built has no legal build at all.
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ fromStacks: true });

    // ⚠️ THE RATE CHANGED ON 19/08/2026: a stack card is worth TWO of the cost,
    // not one. W9 costs 3, so ONE card off D4 pays two thirds of it and the hand
    // pays the last card - and three cards off the stack is no longer offered at
    // all, because six paid against a cost of three is an overpayment and the
    // enumerator never invites one.
    const offers = buildsOf(grown.state, 'W9').filter((a) => a.kind === 'build');
    expect(offers.every((a) => (a.stacks?.length ?? 0) <= 1)).toBe(true);
    // ⭐ RULED 19/08/2026 (Dean): "the card counts as ANY card - including
    // wild", so a stack card is a TRUE wildcard - it fills W9's own-crop half
    // whatever its own suit is. That is why this test now has to name the
    // building it wants: D5 is sitting on D7's own stack (it was the GROW
    // payment above), and spending that single DAIRY card off D7 is a legal way
    // to pay a WHEAT card's wheat requirement. Both options are correct; this
    // one pins the D4 route so the "spent, not harvested" assertions below have
    // a known stack to check.
    const offStacks = offers.find(
      (a) =>
        a.kind === 'build' &&
        (a.stacks?.length ?? 0) === 1 &&
        a.payment.length === 1 &&
        stacked.includes(a.stacks?.[0] as string),
    );
    expect(offStacks).toBeDefined();
    const used = (offStacks as { stacks?: string[] }).stacks?.[0] as string;
    expect(stacked).toContain(used);

    // ...and the wildcard route really is offered alongside it: a Dairy card off
    // D7 paying for a Wheat build is the ruling in one assertion.
    expect(
      offers.some((a) => a.kind === 'build' && (a.stacks ?? []).some((id) => id === 'D5')),
    ).toBe(true);

    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    // One card left the stack, and only one: the other two are still on D4.
    expect(buildingOf(done, DAIRY, 'D4').stack).toHaveLength(2);
    // Spent, not harvested: nothing reached the barn.
    expect(player(done, DAIRY).barn).toEqual([]);
    expect(done.discards.wheat).toContain(used);
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
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    // W9 costs 3 and a stack card now pays 2, so the cheapest stack-fed payment
    // is one card off D4 plus one out of hand. The DIVERT is the point of the
    // test and it is unchanged: D2 may divert the hand card, never the stack
    // card, so the pair is still not a free Harvest.
    const offStacks = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 1 && (a.stacks?.length ?? 0) === 1,
    );
    expect(offStacks).toBeDefined();
    const stackCard = (offStacks as { stacks?: string[] }).stacks?.[0] as string;
    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    const divert = done.tasks.find((t) => t.t === 'card' && t.kind === 'divertSpent');
    expect(divert).toBeDefined();
    // Whatever the divert offers, it is never the card that came off the stack.
    // The divert is PREPENDED, so it is the head and `pendingAnswers` reads it.
    for (const answer of pendingAnswers(data, done)) {
      expect(JSON.stringify(answer)).not.toContain(stackCard);
    }
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

describe('D11 The Heritage House - sow the payment back', () => {
  it('sows every card the build spent, onto ANY of your own buildings', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D8');
    // W9 costs 2 wheat + 1 wild, so the build spends three cards and all three
    // come back onto the board. D5 pays to grow the House.
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    expect(headBuild(grown.state).mods).toEqual({});

    const w9 = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 3,
    );
    expect(w9).toBeDefined();
    // The Farmstead's divert is PREPENDED in front of everything the build
    // queued, so it is declined first - which is also the proof that ONE
    // DESTINATION PER SPENT CARD still falls out of the ordering: a card banked
    // in the barn would have left the discard and could not then be sown.
    const built = divert(answerTask(data, grown.state, w9 as TaskAnswer).state, null);
    const spent = (w9 as Extract<TaskAnswer, { kind: 'build' }>).payment;

    // Every spent card is offered, and against every own building with room -
    // the new building included, and the two Tier 1s that were already down.
    const onto = pendingAnswers(data, built)
      .filter((a) => a.kind === 'card')
      .map((a) => a.payload.onto);
    for (const card of spent) {
      expect(offeredCards(built), card).toContain(card);
    }
    expect(onto).toContain('D4');
    expect(onto).toContain('D8');
    expect(onto).toContain('W9');

    const done = answerAll(built);
    // Nothing the build spent is still in a discard: it is all on the table.
    for (const card of spent) expect(done.discards.wheat).not.toContain(card);
    const placed = player(done, DAIRY).tableau.flatMap((b) => b.stack);
    for (const card of spent) expect(placed).toContain(card);
  });

  it('the sow is per card, so one payment can finish two different stacks', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    // D4 and D8 are both threshold 2 and both already hold one card, so a
    // 3-card payment can top up both and put the third on the new building.
    loadStack(data, s, DAIRY, 'D4', 1, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 1, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const w9 = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 3,
    );
    let state = divert(answerTask(data, grown.state, w9 as TaskAnswer).state, null);
    for (const target of ['D4', 'D8']) {
      const answer = pendingAnswers(data, state).find(
        (a) => a.kind === 'card' && a.payload.onto === target,
      );
      expect(answer, target).toBeDefined();
      state = answerTask(data, state, answer as TaskAnswer).state;
    }
    expect(buildingOf(state, DAIRY, 'D4').stack).toHaveLength(2);
    expect(buildingOf(state, DAIRY, 'D8').stack).toHaveLength(2);
    // Both Tier 1s are full now and drop out of the target list by themselves;
    // what is left is the just-built W9 and the two starters that carry a
    // threshold (the Service and the Notice Board), which is the same target
    // set tasks.ts sowTargets builds for a sow task with no explicit list.
    const left = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    const onto = new Set(left.map((a) => (a.kind === 'card' ? a.payload.onto : null)));
    expect(onto.has('W9')).toBe(true);
    expect(onto.has('D4')).toBe(false);
    expect(onto.has('D8')).toBe(false);
  });

  it('sows as far as there is room and leaves the rest, never refusing the build', () => {
    // The mandatory-effect convention for the whole v30 pass (plan section 8.3)
    // is SKIP SILENTLY: sow as many of the spent cards as there are legal
    // targets for, never refuse the activation and never refuse the Build.
    //
    // A total no-op is close to unreachable and that is worth saying out loud:
    // the card the Build just put down is itself a legal target, empty and with
    // room, so there is almost always somewhere for the FIRST card to go. What
    // is easy to reach is a PARTIAL sow, and that is the case that decides the
    // convention. W13 costs four cards and prints a threshold of 1, so with
    // every other building of the seat full exactly one of the four can land.
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    dealTo(data, s, DAIRY, 'D5', 'W13', 'W4', 'W5', 'W6', 'W7');
    // D11 is threshold 2 and the grow payment is its second card, so it fills
    // itself; the Notice Board is 5. Change 6 deleted D0 the Service, so the
    // seat has one fewer building to fill.
    loadStack(data, s, DAIRY, 'D11', 1, 'wheat');
    loadStack(data, s, DAIRY, 'D3', 5, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const w13 = buildsOf(grown.state, 'W13').find((a) => a.kind === 'build');
    expect(w13).toBeDefined();
    const spent = (w13 as Extract<TaskAnswer, { kind: 'build' }>).payment;
    expect(spent).toHaveLength(4);
    const done = answerAll(divert(answerTask(data, grown.state, w13 as TaskAnswer).state, null));

    // The build happened, one card landed on it, and the other three simply
    // stayed in the discard. No task is left waiting for an impossible answer.
    expect(player(done, DAIRY).tableau.some((b) => b.card === 'W13')).toBe(true);
    expect(buildingOf(done, DAIRY, 'W13').stack).toHaveLength(1);
    const stranded = spent.filter((c) => done.discards.wheat.includes(c));
    expect(stranded).toHaveLength(3);
    expect(done.tasks).toHaveLength(0);
  });

  it('a FREE build spends nothing, so it sows nothing', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    dealTo(data, s, DAIRY, 'D5', 'W16'); // W16 is a coin-priced Power card: 0 cards
    player(s, DAIRY).coins = 2;
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const free = buildsOf(grown.state, 'W16').find(
      (a) => a.kind === 'build' && a.payment.length === 0,
    );
    expect(free).toBeDefined();
    const done = answerTask(data, grown.state, free as TaskAnswer).state;
    expect(done.tasks.filter((t) => t.t === 'card' && t.kind === 'sowAnywhere')).toHaveLength(0);
  });

  it('nothing in the game covers a building any more', () => {
    // The `covered` zone was deleted on 19/08/2026 with D11's build-on-top.
    // fx.coverBuilding is gone, and this is the cheap standing check that it
    // has not been quietly reintroduced by a later card.
    const fx = new Fx(data, base(), DAIRY) as unknown as Record<string, unknown>;
    expect(fx['coverBuilding']).toBeUndefined();
  });
});

describe('D13 The Cheese Vault - the scaler', () => {
  it('draws one per building BUILT, starters excluded', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D5', 'D6');
    dealTo(data, s, DAIRY, 'W4');
    // D13, D4, D5, D6 - four built buildings, and never a starter. The grow
    // payment leaves the hand, so four drawn cards is what is left.
    const state = answerAll(growBuilding(data, s, DAIRY, 'D13', 'W4').state);
    expect(player(state, DAIRY).hand).toHaveLength(4);
  });

  it('gives nothing to anybody: the cross-table half is deleted', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9');
    dealTo(data, s, DAIRY, 'W4', 'W5', 'W6');
    const state = answerAll(growBuilding(data, s, DAIRY, 'D13', 'W4').state);
    // Seven buildings, so seven cards drawn on top of a hand of two: the hand
    // limit is not enforced here at all any more, no rival gains a card and no
    // coin is minted. The end-of-turn discard is the only brake left.
    expect(player(state, WHEAT).hand).toEqual([]);
    expect(player(state, DAIRY).coins).toBe(0);
    expect(player(state, DAIRY).hand.length).toBeGreaterThan(5);
  });

  it('is a GROW building now, not an ACTION', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13');
    dealTo(data, s, DAIRY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'cardMove' && m.card === 'D13')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D13')).toBe(true);
  });
});

describe('D14 The Cream Refinery - the demolition', () => {
  it('sends the building AND its stack to the discard, then 3 deck cards to the barn', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D9');
    dealTo(data, s, DAIRY, 'W4');
    loadStack(data, s, DAIRY, 'D9', 2, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D9').stack];
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const takeD9 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D9',
    );
    let state = answerTask(data, grown.state, takeD9 as TaskAnswer).state;
    // Dean, 19/08/2026: NEITHER the building NOR its stack becomes freight.
    expect(player(state, DAIRY).barn).toEqual([]);
    for (const card of stacked) expect(state.discards.wheat).toContain(card);
    expect(state.discards.dairy).toContain('D9');
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'D9')).toBe(false);
    // Then a FLAT 3 deck cards, not one per card of the demolished build cost
    // (D9 costs 3, so the old card would have paid the same here by accident).
    state = answerAll(state);
    expect(player(state, DAIRY).barn).toHaveLength(3);
  });

  it('pays a flat 3 whatever the demolished building cost', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4'); // D4 costs 1 dairy
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const takeD4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    const state = answerAll(answerTask(data, grown.state, takeD4 as TaskAnswer).state);
    expect(player(state, DAIRY).barn).toHaveLength(3);
  });

  it('never offers a starter, so it cannot mint freight from one (ticket 30)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4');
    dealTo(data, s, DAIRY, 'W4');
    buildingOf(s, DAIRY, 'D3').upgraded = true;
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const targets = offeredCards(grown.state);
    // D0 the Service is gone (change 6); D1/D2/D3 are the three starters.
    expect(targets).not.toContain('D1');
    expect(targets).not.toContain('D2');
    expect(targets).not.toContain('D3');
    expect(targets).toContain('D4');
  });

  it('the demolished card scores nothing, because scoring reads the tableau', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    const before = gameEndScores(data, s)[DAIRY]?.printed ?? 0;
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.printed).toBe(before - 1);
  });
});

describe('D15 The Grand Creamery - two reveals, one free build', () => {
  const pickDeck = (state: GameState, suit: string) =>
    pendingAnswers(data, state).find((a) => a.kind === 'card' && a.payload.suit === suit);

  it('reveals 2, builds 1 free and discards the other', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    const first = s.decks.wheat[0] as string;
    const second = s.decks.wheat[1] as string;
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');

    // Dean, 19/08/2026: any deck, and the two may be the same one.
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'wheat') as TaskAnswer).state;

    // Both are now on offer, and exactly one gets built.
    const offered = offeredCards(state);
    expect(offered).toContain(first);
    expect(offered).toContain(second);
    const buildFirst = pendingAnswers(data, state).find(
      (a) => a.kind === 'card' && a.payload.card === first,
    );
    state = answerAll(answerTask(data, state, buildFirst as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === first)).toBe(true);
    expect(player(state, DAIRY).tableau.some((b) => b.card === second)).toBe(false);
    expect(state.discards.wheat).toContain(second);
    expect(player(state, DAIRY).coins).toBe(0); // free: no card and no coin paid
  });

  it('the two decks may be different', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    const wheatTop = s.decks.wheat[0] as string;
    const dairyTop = s.decks.dairy[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'dairy') as TaskAnswer).state;
    const offered = offeredCards(state);
    expect(offered).toContain(wheatTop);
    expect(offered).toContain(dairyTop);
  });

  it('a coin-priced card still builds free, which is the jackpot', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    // W16 is a coin-priced Power card: card cost 0, so it is buildable for
    // nothing here, and the run has no ascending-cost rule left to bust on.
    s.decks.wheat = ['W16', ...s.decks.wheat.filter((c) => c !== 'W16')];
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'wheat') as TaskAnswer).state;
    const buildW16 = pendingAnswers(data, state).find(
      (a) => a.kind === 'card' && a.payload.card === 'W16',
    );
    expect(buildW16).toBeDefined();
    state = answerAll(answerTask(data, state, buildW16 as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W16')).toBe(true);
    expect(player(state, DAIRY).coins).toBe(0);
  });

  it('is a GROW building now, not an ACTION', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'cardMove' && m.card === 'D15')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D15')).toBe(true);
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

  it('D16 fires TWICE for a Butter Factory that builds twice - the guard is gone', () => {
    // "Once per turn." came off the sheet on 19/08/2026 (v30 group A) and this
    // is the interaction both earlier guards existed to stop: the once-per-Build
    // ACTION ruling of 2026-08-10 and the general turn.firedThisTurn rule that
    // replaced it on 2026-08-12. It is now a real power increase and it is
    // balance flag 8.4, owed the d16-ledger-uncapped arm.
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
    expect(draws).toBe(2);
  });

  it('D16 is not a member of firedThisTurn, so it cannot be filtered out of a GROW', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(built.state.turn.firedThisTurn).not.toContain('D16');
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
    // ⛔ builtBuildings - the noun D9, D13, D14 and D20 all share - exists
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

  it('the three Tier 3 cards are ordinary GROW buildings - the ACTION is retired', () => {
    // Dean, 19/08/2026: "The concept of an ACTION was never requested. They are
    // all GROW." Every assertion in this test is the inverse of what it was.
    for (const id of ['D13', 'D14', 'D15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).toBeGreaterThan(0);
      expect(card?.activationType, id).toBe('wild');
      expect(card?.abilityTrigger, id).toEqual(['onActivate']);
      // ⛔ `actionMoves` no longer EXISTS on CardHandler (19/08/2026), so this
      // reads the object rather than the type: a property that is gone cannot
      // be asserted undefined, and `in` is what still fails loudly if someone
      // puts the concept back.
      expect('actionMoves' in (handlerFor(id) as object), id).toBe(false);
      expect(handlerFor(id)?.moves, id).toBeUndefined();
      expect(typeof handlerFor(id)?.activate, id).toBe('function');
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

  it('runs the Grand Creamery through its two reveals without wedging', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    const state = answerAll(grown.state, (a) => a.find((x) => x.kind === 'card') ?? a[0]!);
    expect(state.tasks).toHaveLength(0);
  });
});
