/**
 * The Wheat suit, all 21 cards, REBUILT (docs/wheat-suit-rebuild-v5.md), in the
 * spanning-test style.
 *
 * The load-bearing pieces are new. The FIELDs' two-line shape - GROW draws, the
 * HARVEST pays and reseeds - is what the rebuild is for, so every Tier 1 test
 * asserts BOTH lines and the reseed. The Tier 3 ACTION seam is tested where it
 * bites (spending the main action, holding nothing open, suppressing `pass`) in
 * spanning.test.ts §2, and here for what each card actually does. The Farmstead
 * seams are unchanged and still tested first.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  standingMoves,
  workOwnWorker,
} from '../runtime.js';
import { buildingOf, cardById, player, thresholdOf } from '../query.js';
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
  for (let guard = 0; guard < 64 && s.tasks.length > 0; guard++) {
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

/** The one standing move a Tier 3 ACTION card offers, if it is offering one. */
function actionMoveFor(state: GameState, card: string): Move | undefined {
  return standingMoves(data, state, WHEAT).find((m) => m.card === card);
}

/**
 * Sow targets are `BuildingRef`s since the Apiary rebuild - a seat as well as a
 * card, because A4 and A14 place on a neighbour. Every Wheat sow is still onto
 * the wheat seat's own tableau, which is what this spells out.
 */
function own(...cards: string[]): { seat: number; card: string }[] {
  return cards.map((card) => ({ seat: WHEAT, card }));
}

/** Fill a building to its printed threshold from the apiary deck (keeps wheat ids free). */
function fill(s: GameState, card: string): void {
  const threshold = thresholdOf(data, buildingOf(s, WHEAT, card)) as number;
  loadStack(data, s, WHEAT, card, threshold, 'apiary');
}

/**
 * REBALANCED 2026-08-12, and this block carries the headline. W2 used to be two
 * unrelated powers - a flat 2+ relaxation on both faces, plus "Harvest is 2
 * buildings" on the upgraded one. The second is gone. The flip now DEEPENS the
 * first, 2+ to 1+, so the card does one thing on both faces and the milestone
 * buys flexibility rather than tempo.
 */
describe('the Wheat Farmstead (W2) - one relaxed harvest gate, two depths', () => {
  it('offers a 2+-loaded not-full building to the Harvest ACTION, wheat seat only', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7'); // threshold 3
    loadStack(data, s, WHEAT, 'W7', 2);
    expect(harvestMoves(s).map((m) => m.type === 'harvest' && m.building)).toContain('W7');

    // The same position for the apiary seat: 2-loaded, not full, NOT harvestable.
    // The foil used to be A9; the Apiary rebuild cut its threshold to 2, which
    // would have made it FULL here and harvestable for the ordinary reason. A7
    // still prints 3, and the guard below is what catches the next such edit.
    const t = base();
    buildFor(data, t, APIARY, 'A7');
    const foilThreshold = thresholdOf(data, buildingOf(t, APIARY, 'A7')) as number;
    expect(foilThreshold).toBeGreaterThan(2);
    loadStack(data, t, APIARY, 'A7', 2);
    t.turnPlayer = APIARY;
    expect(harvestMoves(t)).toEqual([]);
  });

  it('composes with the Harvest Service (suit powers apply to Service actions)', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7');
    loadStack(data, s, WHEAT, 'W7', 2);
    hireFor(s, WHEAT, 'harvest');
    player(s, WHEAT).coins += data.workers.ownerActivationCost;
    const out = workOwnWorker(data, s, WHEAT, 'harvest');
    expect(pendingAnswers(data, out.state)).toContainEqual({ kind: 'building', card: 'W7' });
  });

  /**
   * ⛔ THE NEW BEHAVIOUR, and the reason `wheatRelaxedMin` became face-aware.
   * Before the rebalance the 2+ relaxation applied to ANY Wheat seat, flipped or
   * not, so a 1-loaded building was never a Harvest ACTION target on either
   * face. It now is, on the upgraded face only - the milestone's whole payoff.
   */
  it('base: a 1-loaded building is no target; upgraded: it is', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, WHEAT, 'W2').upgraded = upgraded;
      buildFor(data, s, WHEAT, 'W7'); // threshold 3, so 1 card is nowhere near full
      loadStack(data, s, WHEAT, 'W7', 1, 'apiary');
      const targets = harvestMoves(s).map((m) => m.type === 'harvest' && m.building);
      expect(targets.includes('W7'), `upgraded=${upgraded}`).toBe(upgraded);
    }
  });

  /**
   * ⛔ WHAT THE FLIP NO LONGER BUYS (rebalance, 2026-08-12). The upgraded face
   * used to print "Harvest is 2 buildings" and arm `turn.again` - a free extra
   * main action on the suit's own core verb, taken 88.4% of the time, and the
   * largest single term in Wheat finishing first at 50.0%. `harvestAgainPower`
   * is stubbed to false, and W2 was the engine's ONLY producer of `turn.again`
   * (Dairy's "you may BUILD again" went on 2026-08-10), so the flag is now
   * armed by nothing at all. That is what this pins: not "the repeat is
   * declinable" but "there is no repeat".
   */
  it('upgraded: the second Harvest action is gone, not merely optional', () => {
    const s = base();
    buildingOf(s, WHEAT, 'W2').upgraded = true;
    buildFor(data, s, WHEAT, 'W4', 'W7');
    fill(s, 'W4');
    fill(s, 'W7');

    const first = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W7' });
    expect(first.state.turn.again).toBeNull();
    // W7's harvest queued a build and a reseed; drain them, and the full W4 is
    // still sitting there with no action left to take it.
    const cleared = answerAll(first.state);
    expect(cleared.turn.again).toBeNull();
    expect(cleared.turn.actionSpent).toBe(true);
    expect(harvestMoves(cleared)).toEqual([]);
    expect(buildingOf(cleared, WHEAT, 'W4').stack).toHaveLength(2);
  });

  /**
   * Kept, though the rebalance made it trivially true - nothing arms the repeat
   * any more, so this can no longer fail for the reason it was written for. The
   * live half of the suit-power ruling is now the GATE, and it is pinned in
   * spanning.test.ts: a card-effect harvest inherits neither face of W2.
   */
  it('a card-effect harvest never arms the repeat (the suit-power ruling)', () => {
    const s = base();
    buildingOf(s, WHEAT, 'W2').upgraded = true;
    buildFor(data, s, WHEAT, 'W13', 'W4');
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary');
    const applied = apply(data, s, actionMoveFor(s, 'W13') as Move);
    expect(applied.state.turn.again).toBeNull();
  });
});

describe('the shared FIELD line - "Sow 1 FIELD from the deck"', () => {
  it("reseeds the just-harvested FIELD off a deck of the owner's choosing", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5'); // threshold 2
    fill(s, 'W5');
    const expected = s.decks.orchard[0];

    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    expect(buildingOf(applied.state, WHEAT, 'W5').stack).toEqual([]);
    const reseed = applied.state.tasks.find((t) => t.t === 'sowFromDeck');
    expect(reseed).toMatchObject({ src: 'W5', remaining: 1, targets: own('W5') });

    // Answer the Draw 2 first (it was queued ahead), then the reseed.
    let state = answerAll(applied.state, (answers) => {
      const seed = answers.find((a) => a.kind === 'deckSow' && a.suit === 'orchard');
      return (seed ?? answers[0]) as TaskAnswer;
    });
    expect(buildingOf(state, WHEAT, 'W5').stack).toEqual([expected]);
    // Which is the whole point: with the seed down, ONE grow refills it.
    const pay = state.decks.wheat[0] as string;
    dealTo(data, state, WHEAT, pay);
    state = growBuilding(data, state, WHEAT, 'W5', pay).state;
    expect(buildingOf(state, WHEAT, 'W5').stack).toHaveLength(2);
  });

  /**
   * ⛔ NARROWED BY THE REBALANCE (2026-08-12), and this is the shape that can
   * see it: a second FIELD, owned, empty and with room to spare. The seed used
   * to be aimable at ANY FIELD the seat owned, which let a wide farm point every
   * harvest's seed at whichever FIELD was closest to full and turn one harvest
   * into the next one. The target is now fixed at push time to the building that
   * just harvested, so the number of FIELDs stops multiplying the line - and the
   * task drops from a two-part choice (which FIELD, which deck) to a one-part
   * one, which is teach cost going down as well as power coming off.
   */
  it('never lands on another FIELD, however much room that FIELD has', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5', 'W4'); // both threshold 2; W4 left empty
    fill(s, 'W5');

    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    const reseed = applied.state.tasks.find((t) => t.t === 'sowFromDeck');
    // EXACTLY one target, asserted as the whole array: this is the assertion
    // the narrowing is about, so a `toMatchObject` subset would not hold it.
    expect(reseed?.t === 'sowFromDeck' && reseed.targets).toEqual(own('W5'));
    // And the choice actually OFFERED is only ever "which deck". Walk the queue
    // to the reseed (W5's own Draw 2 was pushed ahead of it) and read it there:
    // a target the enumerator would still accept is the only way this could rot.
    let queued = applied.state;
    for (let guard = 0; guard < 8 && queued.tasks[0]?.t !== 'sowFromDeck'; guard++) {
      queued = answerTask(data, queued, pendingAnswers(data, queued)[0] as TaskAnswer).state;
    }
    const seeds = pendingAnswers(data, queued);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every((a) => a.kind === 'deckSow' && a.onto === 'W5')).toBe(true);

    // Where the card actually went, not just where it was aimed.
    const done = answerAll(applied.state, (a) => a[0] as TaskAnswer);
    expect(buildingOf(done, WHEAT, 'W5').stack).toHaveLength(1);
    expect(buildingOf(done, WHEAT, 'W4').stack).toEqual([]);
  });

  it('skips silently when no FIELD has room', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4', 'W5');
    fill(s, 'W4');
    fill(s, 'W5'); // both FIELDs full; W5 empties on harvest, W4 stays clogged
    // Empty every deck so the reseed has nothing to draw either.
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    expect(answerAll(applied.state).tasks).toEqual([]);
  });
});

describe('Tier 1 - the five FIELDs, both printed lines each', () => {
  it('W4 Wheat Field: GROW draws 1; HARVEST banks a hand card, then reseeds', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, WHEAT, 'W6');
    const grown = growBuilding(data, s, WHEAT, 'W4', 'W6');
    expect(grown.state.tasks[0]).toMatchObject({ t: 'draw', see: 1, keep: 1 });
    // No auto-harvest any more: the stack holds the payment.
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual(['W6']);

    const t = base();
    buildFor(data, t, WHEAT, 'W4');
    dealTo(data, t, WHEAT, 'W7');
    fill(t, 'W4');
    const applied = apply(data, t, { type: 'harvest', seat: WHEAT, building: 'W4' });
    expect(applied.state.tasks.map((x) => x.t)).toEqual(['handToBarn', 'sowFromDeck']);
    const done = answerAll(applied.state);
    // 2 harvested cards plus the banked hand card, and no coin: W4's old £1 is gone.
    expect(player(done, WHEAT).barn).toContain('W7');
    expect(player(done, WHEAT).coins).toBe(0);
  });

  it('W5 Rye Field: HARVEST draws 2', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5');
    fill(s, 'W5');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 2, keep: 2, src: 'W5' });
  });

  it('W6 Barley Field: HARVEST sows one HAND card onto each of your FIELDs', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W6', 'W4'); // W6 threshold 3, W4 threshold 2
    dealTo(data, s, WHEAT, 'W7', 'W8');
    fill(s, 'W6');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W6' });
    // One sow task per FIELD owned - W6 itself included, since it just emptied.
    const sows = applied.state.tasks.filter((t) => t.t === 'sow');
    expect(sows).toHaveLength(2);
    expect(sows.map((t) => (t.t === 'sow' ? t.targets : null))).toEqual([own('W6'), own('W4')]);
    // Mandatory as printed: no skip answer while a hand card and a target exist.
    expect(pendingAnswers(data, applied.state).some((a) => a.kind === 'skip')).toBe(false);
  });

  it('W7 Golden Field: GROW adds a deck card too, so one activation fills it from the seed', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7'); // threshold 3
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W7', 1, 'apiary'); // the seed from a previous harvest
    const grown = growBuilding(data, s, WHEAT, 'W7', 'W6');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['draw', 'sowFromDeck']);
    const sow = grown.state.tasks[1];
    expect(sow).toMatchObject({ targets: own('W7') });
    const done = answerAll(grown.state);
    // seed + payment + deck card = 3: full.
    expect(buildingOf(done, WHEAT, 'W7').stack).toHaveLength(3);
  });

  it('W7 Golden Field: HARVEST is a real Build at a discount of 1', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7');
    dealTo(data, s, WHEAT, 'W8'); // costs 2 wheat, so 1 at a discount of 1 - but the
    dealTo(data, s, WHEAT, 'W6'); // discount waives the own-suit half, so W6 can pay.
    fill(s, 'W7');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W7' });
    const build = applied.state.tasks.find((t) => t.t === 'build');
    expect(build).toMatchObject({ src: 'W7', mods: { discount: 1 } });
    const answers = pendingAnswers(data, applied.state);
    expect(
      answers.some((a) => a.kind === 'build' && a.card === 'W8' && a.payment.length === 1),
    ).toBe(true);
  });

  it('W8 Heritage Field: GROW banks a hand card; HARVEST harvests another building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W8', 'W5');
    dealTo(data, s, WHEAT, 'W6', 'W7');
    loadStack(data, s, WHEAT, 'W8', 1, 'apiary');
    const grown = growBuilding(data, s, WHEAT, 'W8', 'W6');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['draw', 'handToBarn']);

    const t = base();
    buildFor(data, t, WHEAT, 'W8', 'W5');
    fill(t, 'W8');
    fill(t, 'W5');
    const applied = apply(data, t, { type: 'harvest', seat: WHEAT, building: 'W8' });
    const chooser = applied.state.tasks.find((x) => x.t === 'chooseBuilding');
    // The STRICT full gate, and never itself.
    expect(chooser).toMatchObject({ filter: 'full', exclude: 'W8', then: 'harvest' });
    expect(pendingAnswers(data, applied.state)).toEqual([{ kind: 'building', card: 'W5' }]);
    // No surcharge left on this card: the £1 is gone from the design.
    expect(cardById(data, 'W8').abilityTrigger).not.toContain('harvestSurcharge');
  });
});

describe('Tier 2', () => {
  it('W9 Mill House: one deck-top sow per FIELD you own', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W9', 'W4', 'W5');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W9', 1, 'apiary'); // threshold 2: the payment fills it
    const grown = growBuilding(data, s, WHEAT, 'W9', 'W6');
    const sows = grown.state.tasks.filter((t) => t.t === 'sowFromDeck');
    expect(sows).toHaveLength(2);
    expect(sows.map((t) => (t.t === 'sowFromDeck' ? t.targets : null))).toEqual([
      own('W4'),
      own('W5'),
    ]);
    const done = answerAll(grown.state);
    expect(buildingOf(done, WHEAT, 'W4').stack).toHaveLength(1);
    expect(buildingOf(done, WHEAT, 'W5').stack).toHaveLength(1);
  });

  it('W10 The Furrow: the entire hand into the barn, with no choice at all', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W10');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7');
    loadStack(data, s, WHEAT, 'W10', 1, 'apiary'); // threshold 2
    const grown = growBuilding(data, s, WHEAT, 'W10', 'W7');
    expect(grown.audit.tasksPushed).toBe(0);
    expect(player(grown.state, WHEAT).hand).toEqual([]);
    expect(player(grown.state, WHEAT).barn).toEqual(['W4', 'W5', 'W6']);
  });

  it('W11 The Bakehouse: harvest a LOADED building, then Deliver', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11', 'W4');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // 1 of 2: nowhere near full
    loadStack(data, s, WHEAT, 'W11', 1, 'apiary'); // threshold 2: the payment fills it
    const grown = growBuilding(data, s, WHEAT, 'W11', 'W6');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['chooseBuilding', 'deliver']);
    const chooser = grown.state.tasks[0];
    expect(chooser).toMatchObject({ filter: 'loaded' });
    // The half-full W4 is a legal target, which the strict gate would refuse.
    expect(pendingAnswers(data, grown.state)).toContainEqual({ kind: 'building', card: 'W4' });
  });

  it('W12 Crop Rotation: every FIELD with 1 or more cards, never itself', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W12', 'W4', 'W5', 'W6');
    dealTo(data, s, WHEAT, 'W7');
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // partial
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary'); // full
    // W6 left empty: nothing to harvest there.
    loadStack(data, s, WHEAT, 'W12', 1, 'apiary'); // threshold 2
    const grown = growBuilding(data, s, WHEAT, 'W12', 'W7');
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W5').stack).toEqual([]);
    expect(player(grown.state, WHEAT).barn).toHaveLength(3);
    // W12 is not a FIELD: its own stack survives its own cascade.
    expect(buildingOf(grown.state, WHEAT, 'W12').stack).toHaveLength(2);
  });
});

describe('Tier 3 - the ACTION cards', () => {
  it('all three print no threshold and no activation type, so none can be grown', () => {
    for (const id of ['W13', 'W14', 'W15']) {
      expect(cardById(data, id).threshold, id).toBeNull();
      expect(cardById(data, id).activationType, id).toBeNull();
      expect(cardById(data, id).abilityTrigger, id).toEqual(['action']);
      expect(handlerFor(id)?.actionMoves, id).toBe(true);
    }
  });

  it('W14 The Pizzeria: every rival is OFFERED a draw, and each may decline', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14');
    const applied = apply(data, s, actionMoveFor(s, 'W14') as Move);
    expect(applied.state.turn.actionSpent).toBe(true);
    const offer = applied.state.tasks[0];
    expect(offer).toMatchObject({ t: 'card', kind: 'offerDraw', pid: APIARY, src: 'W14' });
    // A real decision: take the card, or refuse and keep the baker poor.
    expect(pendingAnswers(data, applied.state)).toEqual([
      { kind: 'card', payload: { take: true } },
      { kind: 'skip' },
    ]);

    const declined = answerTask(data, applied.state, { kind: 'skip' } as TaskAnswer);
    expect(player(declined.state, WHEAT).coins).toBe(0);
    expect(player(declined.state, APIARY).hand).toEqual([]);

    const accepted = answerAll(applied.state, (answers) => answers[0] as TaskAnswer);
    expect(player(accepted, WHEAT).coins).toBe(1);
    expect(player(accepted, APIARY).hand).toHaveLength(1);
  });

  /**
   * RAISED 2026-08-12, the one card in the rebalance pointing UP: an acceptance
   * now also moves a card out of the OWNER's hand into their barn. ⚠️ It is
   * CONVERSION, NOT CREATION - it costs the owner a card - which is the only
   * reason a raise is allowed in a pass whose thesis is that Wheat gets too many
   * free cards. The decline is untouched and still does nothing at all, which is
   * what makes the rival's consent the binding constraint rather than the price.
   */
  it('W14 The Pizzeria: an acceptance banks a card of the OWNER’s; a decline does nothing', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14');
    dealTo(data, s, WHEAT, 'W5', 'W6');
    const applied = apply(data, s, actionMoveFor(s, 'W14') as Move);

    const declined = answerTask(data, applied.state, { kind: 'skip' } as TaskAnswer);
    expect(declined.state.tasks).toEqual([]);
    expect(player(declined.state, WHEAT).coins).toBe(0);
    expect(player(declined.state, WHEAT).barn).toEqual([]);
    expect(player(declined.state, WHEAT).hand).toEqual(['W5', 'W6']);

    const accepted = answerTask(data, applied.state, {
      kind: 'card',
      payload: { take: true },
    } as TaskAnswer);
    // Pushed for the OWNER while a RIVAL's answer resolves, which is only safe
    // because W14 is an ACTION on the owner's turn: every offer resolves inside
    // it, so the owner's handToBarn does too.
    expect(accepted.state.tasks.some((t) => t.t === 'handToBarn' && t.pid === WHEAT)).toBe(true);
    const done = answerAll(accepted.state);
    expect(player(done, WHEAT).coins).toBe(1);
    expect(player(done, WHEAT).barn).toHaveLength(1);
    expect(player(done, WHEAT).hand).toHaveLength(1);
    expect(player(done, APIARY).hand).toHaveLength(1);
  });

  it('W15 The Patisserie: the top card of every live deck, straight to the barn', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    const tops = data.cards.suits.map((suit) => s.decks[suit][0]);
    const applied = apply(data, s, actionMoveFor(s, 'W15') as Move);
    expect(applied.audit.tasksPushed).toBe(0);
    expect(player(applied.state, WHEAT).barn).toEqual(tops);
  });

  it('W15 offers nothing once every deck is dry', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    expect(actionMoveFor(s, 'W15')).toBeUndefined();
  });
});

describe('the Power cards', () => {
  /**
   * CUT TO DRAW 1 BY THE REBALANCE (2026-08-12). At Draw 2 a 1-cost FIELD was
   * card-POSITIVE to build - a build that paid for itself - and Wheat finished
   * first at 50.0% on the most cards into the barn in the game. At Draw 1 the
   * build is card-NEUTRAL: still the turn-1 instruction to build your own suit,
   * no longer a card faucet bolted to it. BOTH FACES still, which is the part
   * that must not drift: without the rider on the upgraded face, paying £2 to
   * upgrade would delete the power.
   */
  it('W1 Barn: building a FIELD draws 1, on both faces', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, WHEAT, 'W1').upgraded = upgraded;
      dealTo(data, s, WHEAT, 'W4', 'W5'); // W4 costs 1 wheat, paid with W5
      const applied = apply(data, s, {
        type: 'build',
        seat: WHEAT,
        card: 'W4',
        payment: ['W5'],
      });
      const draw = applied.state.tasks.find((t) => t.t === 'draw');
      expect(draw, String(upgraded)).toMatchObject({ src: 'W1', see: 1, keep: 1 });
    }
  });

  it('W1 Barn: building a non-FIELD draws nothing', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'W9', 'W5', 'W6', 'W7'); // W9 costs 2 wheat + 1 any
    const applied = apply(data, s, {
      type: 'build',
      seat: WHEAT,
      card: 'W9',
      payment: ['W5', 'W6', 'W7'],
    });
    expect(applied.state.tasks.filter((t) => t.t === 'draw' && t.src === 'W1')).toEqual([]);
  });

  it('W16 The Granary: once per harvest ACTION, not once per building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W12', 'W4', 'W5');
    dealTo(data, s, WHEAT, 'W7');
    loadStack(data, s, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W12', 1, 'apiary');
    const grown = growBuilding(data, s, WHEAT, 'W12', 'W7');
    const granary = grown.state.tasks.filter((t) => t.t === 'draw' && t.src === 'W16');
    expect(granary).toHaveLength(1);
  });

  it('W17 The Pie Shop: £1 whenever a NEIGHBOUR places on one of your buildings', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17');
    dealTo(data, s, APIARY, 'A6');
    s.turnPlayer = APIARY;
    const applied = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: WHEAT,
      fee: ['A6'],
      payoff: { mode: 'coin' },
    });
    expect(player(applied.state, WHEAT).coins).toBe(1);
    expect(applied.audit.crossSeat).toBe(true);
  });
});

describe('the Endgame cards - three shapes of tableau', () => {
  it('W19 The Wheat Exchange: 2 VP per different crop built', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W19', 'W4', 'W5', 'A9'); // wheat + apiary = 2 crops
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(4);
  });

  it('W20 The Grand Granary: 1 VP per DECK-built building, never a starter', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W20', 'W4', 'W5');
    // W20, W4, W5 = 3. The four starters arrive pre-built and nobody built them.
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(3);
  });

  it('W21 The Bread Hall: 2 VP per FIELD, and no longer a coin rate', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W21', 'W4', 'W5', 'W9'); // two FIELDs; W9 is not one
    player(s, WHEAT).coins = 7;
    const scores = gameEndScores(data, s);
    expect(scores[WHEAT]?.endgame).toBe(4);
    // The coin-pity replacement is gone with the coin rate.
    expect(scores[WHEAT]?.coinPityReplacedBy).toBeNull();
    expect(handlerFor('W21')?.replacesCoinPity).toBeUndefined();
  });

  /**
   * CAPPED AT 6 by the rebalance (2026-08-12), which is a TEMPLATE fix rather
   * than a balance one: an uncapped "for each" on the very axis the suit
   * specialises in is the shape docs/innovation.md warns about, and every other
   * endgame scaler in the game carries a cap or a divisor. There are five FIELDs
   * in the suit, so the cap is reachable and this walks the whole ramp - the 3rd
   * FIELD is where the rate and the cap agree, and the 4th is where they part.
   */
  it('W21 The Bread Hall: 2 VP per FIELD up to the cap, then 6 whatever you own', () => {
    const FIELDS = ['W4', 'W5', 'W6', 'W7', 'W8'];
    const ramp: [number, number][] = [
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 6],
      [5, 6],
    ];
    for (const [count, expected] of ramp) {
      const s = base();
      buildFor(data, s, WHEAT, 'W21', ...FIELDS.slice(0, count));
      expect(gameEndScores(data, s)[WHEAT]?.endgame, `${count} FIELDs`).toBe(expected);
    }
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
      // Only an ACTION card declares actionMoves, and only a card with moves may.
      if (h?.actionMoves) expect(typeof h.moves, id).toBe('function');
    }
  });

  it('the FIELD keyword matches exactly W4-W8', () => {
    const fields = data.cards.catalogue.filter((c) => /\bField\b/.test(c.name)).map((c) => c.id);
    expect(fields).toEqual(['W4', 'W5', 'W6', 'W7', 'W8']);
    expect(cardById(data, 'W9').name).toBe('Mill House');
  });

  it('no Wheat card prints a harvest surcharge any more', () => {
    for (const id of WHEAT_IDS) {
      expect(cardById(data, id).abilityTrigger, id).not.toContain('harvestSurcharge');
      expect(cardById(data, id).abilityTrigger, id).not.toContain('autoHarvest');
    }
  });
});
