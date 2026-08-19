/**
 * The Wheat suit, all 21 cards, REBUILT (docs/wheat-suit-rebuild-v5.md), in the
 * spanning-test style.
 *
 * The load-bearing pieces are new. The FIELDs' two-line shape - GROW draws, the
 * HARVEST pays - is what the rebuild is for, so every Tier 1 test asserts BOTH
 * lines. The Farmstead seams are unchanged and still tested first.
 *
 * V30, 19/08/2026. Two things this file used to pin are gone, and their tests
 * now pin their absence instead:
 *
 *   1. **The Tier 3 ACTION seam.** W13/W14/W15 are ordinary GROW buildings on
 *      Dean's ruling, so every test that drove them through a `cardMove` now
 *      drives them through `growBuilding`, and the "no threshold, no activation
 *      type, trigger 'action'" assertions invert into their opposites.
 *   2. **The seed line on four of the five FIELDs.** Only W5 prints it now (and
 *      W4's handler still calls it against a printed text that no longer says
 *      so - see the ⚠️ in wheat.ts). So the group D tests assert that the
 *      harvest pushes ONE task list and no `sowFromDeck` beside it, which is
 *      the assertion shape that catches a reseed creeping back.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  gameEndScores,
  growBuilding,
  pendingAnswers,
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

/**
 * GROW a Tier 3 card for the wheat seat, dealing it the fee first.
 *
 * All three print `activationType: "wild"`, so the fee can be any card at all -
 * W20 is used because it is an endgame card no Tier 3 test ever wants in play,
 * and because a wild activation that quietly started demanding wheat would fail
 * here rather than pass by luck.
 */
function growTier3(s: GameState, card: string) {
  dealTo(data, s, WHEAT, 'W20');
  return growBuilding(data, s, WHEAT, card, 'W20');
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
    buildFor(data, s, WHEAT, 'W4', 'W5');
    fill(s, 'W4');
    fill(s, 'W5');

    // ⚠️ THE FIXTURE MOVED FROM W7 TO W5 (v30, 19/08/2026), and the reason is
    // worth writing down because it will catch somebody else. W7's harvest used
    // to leave a task pending whatever the hand held (the seed), so the turn
    // could not settle inside `apply`. With the seed gone, an empty hand makes
    // its Build undoable, the queue empties, and `settleTurn` ENDS THE TURN
    // inside the same call - which resets `actionSpent` and passes the seat on,
    // so the assertions below were reading the next player's turn and one of
    // them was passing for the wrong reason. W5's Draw 2 always survives the
    // drain, so the turn stays open and the test measures what it claims to.
    const first = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    expect(first.state.turn.again).toBeNull();
    // W5's harvest queued a Draw 2 and its seed; drain them, and the full W4 is
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
    const applied = growTier3(s, 'W13');
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
    // One sow task per FIELD owned - W6 itself included, since it just emptied -
    // and NOTHING ELSE: the trailing deck sow went in the v30 simplification, so
    // the whole task list is the assertion rather than a filtered subset of it.
    expect(applied.state.tasks.map((t) => t.t)).toEqual(['sow', 'sow']);
    const sows = applied.state.tasks.filter((t) => t.t === 'sow');
    expect(sows.map((t) => (t.t === 'sow' ? t.targets : null))).toEqual([own('W6'), own('W4')]);
    // Mandatory as printed: no skip answer while a hand card and a target exist.
    expect(pendingAnswers(data, applied.state).some((a) => a.kind === 'skip')).toBe(false);
  });

  /**
   * ⛔ SIMPLIFIED 19/08/2026 (v30, group D). The GROW used to add TWO cards -
   * your payment plus the top of a deck - which is what made threshold 3 fill in
   * one activation from a seed. Both the deck sow and the seed are gone, so the
   * GROW is now the plainest line in the suit and the FIELD takes three of them
   * from empty. That is the interval question this whole file was rebuilt around,
   * back on the table for one card; wheat.ts's note names the threshold as the
   * dial if it measures badly.
   */
  it('W7 Golden Field: GROW draws and nothing else - the deck sow is gone', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7'); // threshold 3
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W7', 1, 'apiary');
    const grown = growBuilding(data, s, WHEAT, 'W7', 'W6');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['draw']);
    const done = answerAll(grown.state);
    // One card down plus the payment = 2 of 3. It no longer fills itself.
    expect(buildingOf(done, WHEAT, 'W7').stack).toHaveLength(2);
  });

  /**
   * ⛔ THE ONE DELIBERATE POWER INCREASE IN THE WHEAT BLOCK (v30, 19/08/2026):
   * the discount goes 1 to 2, which is what the card is paid for losing its two
   * free cards a cycle. At a discount of 2 a 2-cost Tier 1 is FREE, and the
   * discount already waived the own-suit half, so the payment is the empty array
   * - the assertion below is the difference between the two numbers, not just a
   * mods field being echoed back.
   */
  it('W7 Golden Field: HARVEST is a real Build at a discount of 2', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7');
    dealTo(data, s, WHEAT, 'W8'); // costs 2 wheat: free at a discount of 2
    fill(s, 'W7');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W7' });
    // The build and nothing after it: no reseed rides along any more.
    expect(applied.state.tasks.map((t) => t.t)).toEqual(['build']);
    expect(applied.state.tasks[0]).toMatchObject({ src: 'W7', mods: { discount: 2 } });
    const answers = pendingAnswers(data, applied.state);
    expect(
      answers.some((a) => a.kind === 'build' && a.card === 'W8' && a.payment.length === 0),
    ).toBe(true);
  });

  it('W8 Heritage Field: GROW just draws; HARVEST harvests another building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W8', 'W5');
    dealTo(data, s, WHEAT, 'W6', 'W7');
    loadStack(data, s, WHEAT, 'W8', 1, 'apiary');
    const grown = growBuilding(data, s, WHEAT, 'W8', 'W6');
    // The GROW-time barn deposit is gone with v30: one line, one task.
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['draw']);
    expect(player(grown.state, WHEAT).barn).toEqual([]);

    const t = base();
    buildFor(data, t, WHEAT, 'W8', 'W5');
    fill(t, 'W8');
    fill(t, 'W5');
    const applied = apply(data, t, { type: 'harvest', seat: WHEAT, building: 'W8' });
    // The chooser and nothing after it: the seed line is gone here too.
    expect(applied.state.tasks.map((x) => x.t)).toEqual(['chooseBuilding']);
    expect(applied.state.tasks[0]).toMatchObject({
      filter: 'loaded',
      exclude: 'W8',
      then: 'harvest',
    });
    expect(pendingAnswers(data, applied.state)).toEqual([{ kind: 'building', card: 'W5' }]);
    // No surcharge left on this card: the £1 is gone from the design.
    expect(cardById(data, 'W8').abilityTrigger).not.toContain('harvestSurcharge');
  });

  /**
   * ⛔ THE READING INVERTED (v30, 19/08/2026). "Another of your buildings" used
   * to be the STRICT full gate, on the reasoning that W11/W12/W13 spelled their
   * exception out in words and this card did not. It now prints "even if not
   * full", so a half-loaded building is a legal target - which is the whole of
   * the change and cannot be seen from the `filter` field alone, since the
   * strict gate would offer W5 too once W5 were full.
   */
  it('W8 Heritage Field: the chained harvest now reaches a building that is NOT full', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W8', 'W7'); // W7 threshold 3
    fill(s, 'W8');
    loadStack(data, s, WHEAT, 'W7', 1, 'apiary'); // 1 of 3: nowhere near full
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W8' });
    expect(pendingAnswers(data, applied.state)).toContainEqual({ kind: 'building', card: 'W7' });
    const done = answerAll(applied.state);
    expect(buildingOf(done, WHEAT, 'W7').stack).toEqual([]);
    // W8's own 2 cards plus W7's 1: everything harvested lands in the barn.
    expect(player(done, WHEAT).barn).toHaveLength(3);
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

/**
 * ⛔ THE ACTION CARD IS GONE (19/08/2026). Dean's ruling - "The concept of an
 * ACTION was never requested. They are all GROW." - turns all three of these
 * into ordinary owner-activated buildings, so the first test in this block is
 * the old one with every assertion inverted, and the rest drive the cards
 * through a GROW instead of a `cardMove`. What each card DOES is unchanged
 * except on W14, which was separately rewritten to its printed text.
 */
describe('Tier 3 - three ordinary GROW buildings', () => {
  it('all three print a threshold and a wild activation, so all three are grown', () => {
    for (const id of ['W13', 'W14', 'W15']) {
      expect(cardById(data, id).threshold, id).toEqual(expect.any(Number));
      expect(cardById(data, id).activationType, id).toBe('wild');
      expect(cardById(data, id).abilityTrigger, id).toEqual(['onActivate']);
      expect(typeof handlerFor(id)?.activate, id).toBe('function');
      expect(handlerFor(id)?.moves, id).toBeUndefined();
    }
  });

  it('W13 The Bakery: one GROW empties every loaded building, itself included', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4', 'W5'); // W13 threshold 1
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // 1 of 2: not full, harvested anyway
    fill(s, 'W5');
    const grown = growTier3(s, 'W13');
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W5').stack).toEqual([]);
    // Its own fee is on its own stack when the ability fires, so the cascade
    // takes it straight back off again and into the barn. Correct, not a bug.
    expect(buildingOf(grown.state, WHEAT, 'W13').stack).toEqual([]);
    expect(player(grown.state, WHEAT).barn).toContain('W20');
    expect(player(grown.state, WHEAT).barn).toHaveLength(4); // 1 + 2 + its own fee
  });

  /**
   * ⛔ REWRITTEN TO THE PRINTED TEXT (19/08/2026). The sheet reads "Every player,
   * INCLUDING YOU, may Draw 1. For each card drawn, gain £1" and had done since
   * before the v30 pass; the handler was still running "every OTHER player", with
   * a hand-to-barn rider the sheet no longer prints. Both halves are pinned here:
   * the owner gets an offer of their own, and an acceptance moves nothing out of
   * the owner's hand.
   */
  it('W14 The Pizzeria: everyone including the owner is OFFERED a draw, and each may decline', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14'); // threshold 2, so the fee does not fill it
    const grown = growTier3(s, 'W14');
    const offers = grown.state.tasks.filter((t) => t.t === 'card' && t.kind === 'offerDraw');
    expect(offers.map((t) => t.pid)).toEqual([WHEAT, APIARY]);
    expect(offers.every((t) => t.t === 'card' && t.riders.owner === WHEAT)).toBe(true);
    // A real decision, for the rival and for the owner alike.
    expect(pendingAnswers(data, grown.state)).toEqual([
      { kind: 'card', payload: { take: true } },
      { kind: 'skip' },
    ]);

    // Everybody declines: the card does nothing at all, which is what makes
    // consent the binding constraint rather than the price.
    const declined = answerAll(grown.state, () => ({ kind: 'skip' }) as TaskAnswer);
    expect(player(declined, WHEAT).coins).toBe(0);
    expect(player(declined, WHEAT).hand).toEqual([]);
    expect(player(declined, APIARY).hand).toEqual([]);

    // Everybody accepts: two cards drawn, so the baker mints £2 - and one of
    // those cards is the baker's own, which is the whole of the rewrite.
    const accepted = answerAll(grown.state, (answers) => answers[0] as TaskAnswer);
    expect(player(accepted, WHEAT).coins).toBe(2);
    expect(player(accepted, WHEAT).hand).toHaveLength(1);
    expect(player(accepted, APIARY).hand).toHaveLength(1);
  });

  it('W14 The Pizzeria: an acceptance no longer banks a card of the OWNER’s', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14');
    dealTo(data, s, WHEAT, 'W5', 'W6');
    const grown = growTier3(s, 'W14');

    const accepted = answerTask(data, grown.state, {
      kind: 'card',
      payload: { take: true },
    } as TaskAnswer);
    expect(accepted.state.tasks.some((t) => t.t === 'handToBarn')).toBe(false);
    const done = answerAll(accepted.state, (answers) => answers[0] as TaskAnswer);
    expect(player(done, WHEAT).barn).toEqual([]);
    // W5 and W6 still in hand, plus the two cards the two acceptances drew.
    expect(player(done, WHEAT).hand).toContain('W5');
    expect(player(done, WHEAT).hand).toContain('W6');
    expect(player(done, WHEAT).coins).toBe(2);
  });

  it('W15 The Patisserie: the top card of every live deck, straight to the barn', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    const tops = data.cards.suits.map((suit) => s.decks[suit][0]);
    const grown = growTier3(s, 'W15');
    expect(grown.audit.tasksPushed).toBe(0);
    // The fee is on the stack, never in the barn: only the deck tops arrive.
    expect(player(grown.state, WHEAT).barn).toEqual(tops);
  });

  /**
   * The live-deck gate went with the standing move it used to gate. A dry table
   * no longer withholds the card, it just makes the activation a no-op - the
   * same answer one step later, and the assertion moves with it.
   */
  it('W15 does nothing at all once every deck is dry', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    dealTo(data, s, WHEAT, 'W20');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const grown = growBuilding(data, s, WHEAT, 'W15', 'W20');
    expect(player(grown.state, WHEAT).barn).toEqual([]);
    expect(grown.state.tasks).toEqual([]);
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
      // ⛔ W18 The Helping Hand is now the ONLY Wheat card contributing standing
      // moves. The other three were the Tier 3 ACTION cards, and the concept
      // left the game on 19/08/2026 - this is what stops it creeping back in.
      // W18 is a different shape and always was: it enumerates one move per fee
      // card because the fee IS the decision, and it never spent the action.
      expect(typeof h?.moves === 'function', id).toBe(id === 'W18');
    }
  });

  it('no Wheat card prints an ACTION trigger any more', () => {
    for (const id of WHEAT_IDS) {
      expect(cardById(data, id).abilityTrigger, id).not.toContain('action');
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
