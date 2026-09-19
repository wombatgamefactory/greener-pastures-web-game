/**
 * The Wheat suit, all 21 cards, REBUILT (docs/wheat-suit-rebuild-v5.md), in the
 * spanning-test style.
 *
 * The load-bearing pieces are new. The FIELDs' two-line shape - GROW draws, the
 * HARVEST pays - is what the rebuild is for, so every Tier 1 test asserts BOTH
 * lines. The Farmstead seams are tested first, as they always have been, though
 * since 19/08/2026 they are a different set of seams entirely.
 *
 * V30, 19/08/2026. Three things this file used to pin are gone, and their tests
 * now pin their absence instead:
 *
 *   1. **The Tier 3 ACTION seam.** W13/W14/W15 are ordinary GROW buildings on
 *      Dean's ruling, so every test that drove them through a `cardMove` now
 *      drives them through `growBuilding`, and the "no threshold, no activation
 *      type, trigger 'action'" assertions invert into their opposites.
 *   2. **The seed line on four of the five FIELDs.** Only W5 prints it now - W4
 *      lost the reseed from its handler too, on the second ruling of 19/08/2026
 *      - so the group D tests assert that the harvest pushes ONE task list and
 *      no `sowFromDeck` beside it, which is the assertion shape that catches a
 *      reseed creeping back.
 *   3. **The Wheat relaxed-harvest gate, as a SUIT POWER.** W2 and W3 swapped
 *      printed powers on the sheet and the engine has followed. There is no
 *      `wheatRelaxedMin` any more: a Wheat seat's plain Harvest ACTION is the
 *      strict full gate like everybody else's, and the relaxation is the
 *      Harvest Service's own action at a flat 2+. The first block below is the
 *      record of that, and it is mostly the old tests inverted.
 *
 * ⚠️ ONE INDIRECT CONSEQUENCE RUNS THROUGH THE WHOLE FILE. W2's new power
 * pushes a task on EVERY harvest its owner takes, so any test that harvests as
 * a Wheat seat and then reads the task queue sees a `handToBarn` (or, on the
 * upgraded face, a `barnFromDeck`) in front of whatever it was looking for.
 * That is correct behaviour and not noise: the fixtures below answer or drain
 * the deposit rather than filtering it out of the assertion, because a
 * filtered assertion would stop noticing if the deposit ever fired twice.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import type { GameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { Fx, fireHook } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, cardById, player, thresholdOf } from '../query.js';
import type { GameState, Move, TaskAnswer } from '../state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
  loadStack,
  makeState,
  meepleEconomyGame,
  visitMove,
} from '../testkit.js';
import { handlerFor } from './registry.js';

const WHEAT = 0;
const APIARY = 1;

function base(): GameState {
  return makeState(data, ['wheat', 'apiary']);
}

/**
 * THE MEEPLE ECONOMY, the game as it shipped from 05/09 to 09/09/2026, and the
 * arm every case whose subject is a VISIT now runs on.
 *
 * ⭐ THE COMMONS HAS NO VISIT TO TEST (09/09/2026, C1): the Notice Boards stand
 * in the centre and belong to nobody, so there is no host and W17 The Pie Shop -
 * the game's only host-side payment - has no subject at all. C8 says so in as
 * many words, and `commons.test.ts` asserts the card stays silent there. These
 * cases move onto the control rather than going away: the branch is live code
 * and the card still prints the text.
 */
const visitArm: GameData = meepleEconomyGame();

function armBase(): GameState {
  const s = makeState(visitArm, ['wheat', 'apiary']);
  // The meeple arm takes its bonus AFTER the action.
  s.turn.actionSpent = true;
  return s;
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
function fill(s: GameState, card: string, seat: number = WHEAT): void {
  const threshold = thresholdOf(data, buildingOf(s, seat, card)) as number;
  loadStack(data, s, seat, card, threshold, 'apiary');
}

/**
 * ⛔ W2 IS AN END-GAME SCORER NOW (v31, 02/09/2026), AND THAT ENDS A LINE OF
 * TESTS THAT RAN FOR THREE EDITIONS. This block used to be this file's headline
 * and it is worth saying what it pinned before it went, because two of the three
 * are RULINGS rather than cards and the next Wheat pass will meet them again.
 *
 *   1. **The relaxed harvest as a SUIT POWER** - "harvest a building with 2+
 *      cards even if it is not full", held in `wheatRelaxedMin` (actions.ts) and
 *      read by `harvestOptions`, deepening to 1+ on the flipped face. On
 *      19/08/2026 the sheet swapped W2 and W3, so the relaxation became the
 *      Wheat DOOR's action - belonging to whoever WORKED it rather than to
 *      whoever owned it, the first time the suit's signature verb was rentable.
 *      v31's doors are plain, so it is gone from both places. THE FIRST TEST
 *      BELOW SURVIVES AS THE RECORD: a Wheat seat's Harvest is the strict full
 *      gate, and so is the Wheat door's.
 *   2. **The barn deposit** - "Harvest: add a card to the barn", from the hand
 *      on one face and off a deck top on the other. Its six tests are deleted:
 *      the mandatory-but-silently-skipping convention, the once-per-turn
 *      `firedThisTurn` guard against W13's whole-farm cascade, and the two
 *      sources. THE GUARD ITSELF IS STILL PINNED, by W16 The Granary, which was
 *      moved onto the same seam for the same reason.
 *   3. **`turn.again`** - the upgraded face's "Harvest is 2 buildings", taken
 *      88.4% of the time and the largest single term in Wheat finishing first at
 *      50.0%. It came off the card on 2026-08-12 and its machinery came out of
 *      the engine in v31. Two tests go with it, and nothing is left to invert
 *      them against: `TurnState` has no `again` field to assert null.
 *
 * What replaces all of it is one line, identical on all five Farmsteads bar the
 * crop: *"Game end: 1 VP for each Wheat card you have built."*
 */
describe('the Wheat Farmstead (W2) - the own-crop end-game scorer', () => {
  /**
   * ⛔ THE SURVIVOR OF THE OLD BLOCK, kept because it is the only written
   * record that the relaxation was ever a suit power at all. It was "offers a
   * 2+-loaded not-full building to the Harvest ACTION, wheat seat only"; it was
   * inverted on 19/08/2026 when the gate moved to the door, and v31 extends it
   * to the DOOR as well, which is the half that is new.
   */
  it('nothing relaxes the harvest: 2 of 3 is no target, by action or by door', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W7'); // threshold 3, holding 2: not full
    loadStack(data, s, WHEAT, 'W7', 2);
    expect(harvestMoves(s)).toEqual([]);

    // ...and the Wheat DOOR, reached by a self-visit, offers nothing either.
    // Before v31 the door printed a flat 2+ gate and W7 would have been legal
    // here; that rider went with the flat doors.
    // (Since 13/09/2026 the shipped game offers visits onto a RIVAL's board,
    // which buy that board's power; only the self-visit is the Wheat door here.)
    dealTo(data, s, WHEAT, 'W20');
    const visits = legalMoves(data, s).filter((m) => m.type === 'visit' && m.host === WHEAT);
    expect(visits).toEqual([]);

    // The same position for the apiary seat, which never had a suit power: both
    // halves give the same answer, which is what "there is no suit power any
    // more" looks like from the action's side. The foil used to be A9; the
    // Apiary rebuild cut its threshold to 2, which would have made it FULL here
    // and harvestable for the ordinary reason, so the guard below is what
    // catches the next such edit.
    const t = base();
    buildFor(data, t, APIARY, 'A7');
    const foilThreshold = thresholdOf(data, buildingOf(t, APIARY, 'A7')) as number;
    expect(foilThreshold).toBeGreaterThan(2);
    loadStack(data, t, APIARY, 'A7', 2);
    t.turnPlayer = APIARY;
    expect(harvestMoves(t)).toEqual([]);
  });

  /**
   * The Wheat door IS the plain Harvest, so a FULL building is a legal target
   * through it. Paired with the test above, the two together say exactly where
   * the line now falls: full yes, 2-of-3 no, by either route.
   */
  it('the Wheat door harvests a FULL building and nothing else', () => {
    const s = armBase();
    // The door harvests the VISITOR's own full building, not the host's, and
    // there is no self-visit any more (X5) - so the Apiary seat is the one that
    // buys the Wheat door, and W9 has to belong to it.
    buildFor(visitArm, s, APIARY, 'W9'); // threshold 2
    for (let i = 0; i < 2; i++) {
      const top = s.decks.wheat.shift();
      if (top) buildingOf(s, APIARY, 'W9').stack.push(top);
    }
    s.turnPlayer = APIARY;
    const applied = apply(visitArm, s, visitMove(APIARY, WHEAT, 'wheat'));
    expect(pendingAnswers(visitArm, applied.state)).toContainEqual({
      kind: 'building',
      card: 'W9',
    });
  });

  /**
   * THE SCORER. Deck cards of your own crop, and the two readings that matter
   * are both about what does NOT count.
   *
   * ⚠️ STARTERS DO NOT COUNT, and that is the reading with teeth: a starter
   * prints the generic starting-building icon and belongs to no crop
   * (`query.cropOf`), so without it every seat would collect a flat 3 for
   * turning up. A foreign-crop building does not count either, which is the pull
   * toward monoculture the plan names as risk 3.
   */
  it('W2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    // Two Wheat deck cards, one Apiary. The three Wheat starters are already in
    // the tableau and must contribute nothing.
    buildFor(data, s, WHEAT, 'W4', 'W9', 'A9');
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(2);
  });

  /**
   * Every deck card of the crop counts, not only the buildings with thresholds:
   * a Power card and an Endgame card print their crop icon like anything else.
   * That is deliberate and it is the half most likely to be re-read if risk 3
   * bites - the own-suit Power price points the same way, so a Wheat Power card
   * is paid for twice.
   */
  it('W2 counts Power and Endgame cards of the crop, not just buildings', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W20'); // a Power card and an Endgame card
    // W2's 2, plus W20 The Grand Granary's own count of the 2 deck-built cards.
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(4);
  });

  /**
   * `rules.economy.grandGranaryCap` is SHIPPED 5 as of the v44 sheet
   * (18/09/2026: the cap is now printed on the card face, "Max 5VP"), so
   * `data` (BASE_GAME_DATA) already caps W20. `uncapped` is the v42 control,
   * the card as printed before the cap. W20 stops at the cap while the Barn
   * scorer beside it keeps counting.
   */
  it('W20 respects grandGranaryCap, shipped at 5', () => {
    const uncapped = loadGameData({
      name: 'w20-cap-none',
      schemaVersion: 1,
      set: { 'rules.economy.grandGranaryCap': null },
    });
    const cards = ['W4', 'W5', 'W6', 'W7', 'W8', 'W16', 'W20'] as const;
    const open = base();
    buildFor(uncapped, open, WHEAT, ...cards);
    const shut = base();
    buildFor(data, shut, WHEAT, ...cards);
    // Barn 7 plus W20 7 uncapped, against Barn 7 plus W20 capped at 5 (shipped).
    expect(gameEndScores(uncapped, open)[WHEAT]?.endgame).toBe(14);
    expect(gameEndScores(data, shut)[WHEAT]?.endgame).toBe(12);
  });

  /** An empty farm scores nothing, and the starters are what makes that a real assertion. */
  it('W2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[WHEAT]?.endgame).toBe(0);
  });

  /**
   * ⛔ AND IT HAS NO OTHER BEHAVIOUR, which is the assertion that catches the
   * old power creeping back. Harvesting used to push a `handToBarn` from W2 on
   * every single harvest this seat took, in front of whatever the test was
   * actually looking for; the whole file was written around that. Now a Wheat
   * harvest queues exactly what the harvested card prints.
   */
  it('W2 rides on no harvest: a harvest queues only what the building prints', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W9'); // the one Wheat building with no harvest line
    dealTo(data, s, WHEAT, 'W20');
    fill(s, 'W9');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W9' });
    expect(applied.state.tasks).toEqual([]);
    expect(player(applied.state, WHEAT).hand).toEqual(['W20']);
    expect(player(applied.state, WHEAT).barn).toHaveLength(2);
  });
});

describe('Tier 1 - the five FIELDs, both printed lines each', () => {
  /**
   * ⛔ THE RESEED IS GONE (19/08/2026 off W4, and 19/09/2026 off W5 too, v45 -
   * see the `reseed()` deletion note in wheat.ts). The sheet reads "Draw 1. /
   * HARVEST: Put 1 card from your hand into your barn." and stops there; the
   * handler went on calling `reseed` for a week after the line came off the
   * print for W4, and Dean ruled the sheet correct.
   *
   * It is not housekeeping. The reseed is what kept every FIELD at 1 card or
   * more, which is what made the old relaxed harvest gate legal essentially
   * always. With the gate gone from the suit too (see the W2 block above),
   * Wheat's harvest is now genuinely gated on filling a building. `reseed`
   * no longer exists at all: W5 Rye Field was the last card calling it and the
   * v45 sheet dropped the seed line from W5 as well.
   */
  it('W4 Wheat Field: GROW draws 1; HARVEST banks a hand card and no longer reseeds', () => {
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
    // ONE deposit and no seed. It used to be two: W2 the Farmstead rode on every
    // harvest this seat took and was pushed AHEAD of W4's own, because the
    // starters sit earlier in the tableau than anything built. W2 is an end-game
    // scorer since v31, so the queue is now exactly what W4 prints.
    expect(applied.state.tasks.map((x) => x.t === 'handToBarn' && x.src)).toEqual(['W4']);
    expect(applied.state.tasks.some((x) => x.t === 'sowFromDeck')).toBe(false);

    const done = answerAll(applied.state);
    // W7 is the only card in hand, and W4's line banks it: 2 harvested cards
    // plus the one banked.
    expect(player(done, WHEAT).barn).toContain('W7');
    expect(player(done, WHEAT).barn).toHaveLength(3);
  });

  /** v45 (19/09/2026): the seed line is gone and the draw moves 2 to 3. */
  it('W5 Rye Field: HARVEST draws 3, and no reseed rides along', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W5');
    fill(s, 'W5');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W5' });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3, src: 'W5' });
    expect(applied.state.tasks.some((t) => t.t === 'sowFromDeck')).toBe(false);
  });

  it('W6 Barley Field: HARVEST sows one HAND card onto each of your FIELDs', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W6', 'W4'); // W6 threshold 3, W4 threshold 2
    dealTo(data, s, WHEAT, 'W7', 'W8');
    fill(s, 'W6');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W6' });
    // One sow task per FIELD owned - W6 itself included, since it just emptied -
    // and nothing else at all: the trailing deck sow went in the v30
    // simplification, so the whole task list is the assertion rather than a
    // filtered subset of it. ⛔ A `handToBarn` used to sit AT THE HEAD of this
    // list, from W2 the Farmstead's harvest deposit (19/08/2026 to v31), and its
    // absence is now part of what the equality pins.
    expect(applied.state.tasks.map((t) => t.t)).toEqual(['sow', 'sow']);
    expect(applied.state.tasks.some((t) => t.t === 'sowFromDeck')).toBe(false);
    const sows = applied.state.tasks.filter((t) => t.t === 'sow');
    expect(sows.map((t) => (t.t === 'sow' ? t.targets : null))).toEqual([own('W6'), own('W4')]);
    // Mandatory as printed, so no skip answer while a hand card and a target
    // both exist.
    expect(pendingAnswers(data, applied.state).some((a) => a.kind === 'skip')).toBe(false);
  });

  /**
   * ⭐ v42: "each of your Wheat buildings", so a Wheat Tier 2 takes a sow too,
   * and a foreign building and the Notice Board do not.
   */
  it('W6 Barley Field (v42): one sow per Wheat building of any tier, never a foreign one', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W6', 'W9', 'A9');
    dealTo(data, s, WHEAT, 'W7', 'W8');
    fill(s, 'W6');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W6' });
    const sows = applied.state.tasks.filter((t) => t.t === 'sow');
    expect(sows.map((t) => (t.t === 'sow' ? t.targets : null))).toEqual([own('W6'), own('W9')]);
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
    // W8 costs 2 wheat and is free at a discount of 2. W10 was here only as a
    // decoy: W2's harvest deposit used to resolve first and would otherwise have
    // banked the very card this test wants to build with. That deposit is gone
    // (v31), so the decoy is now simply a second card in hand and the build is
    // the only task.
    dealTo(data, s, WHEAT, 'W8', 'W10');
    fill(s, 'W7');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W7' });
    // The build, and nothing either side of it: no deposit in front, no reseed
    // behind.
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
  /**
   * ⭐ v42: "Sow a deck card on up to 3 of your buildings that are empty." One
   * deck and one building per answer, a stop answer, each building at most once,
   * and only a stack that is empty when the card lands. Never the Notice Board.
   */
  it('W9 Mill House (v42): up to three EMPTY buildings of any suit, one deck card each', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W9', 'W4', 'W5', 'A9');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W5', 1, 'apiary'); // not empty: never a target
    const grown = growBuilding(data, s, WHEAT, 'W9', 'W6');
    expect(grown.state.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['deckSow']);

    const answers = pendingAnswers(data, grown.state);
    const onto = new Set(
      answers.flatMap((a) => (a.kind === 'card' ? [a.payload.card as string] : [])),
    );
    // W9 holds its own payment and W5 a card; W3 is a Notice Board (S11).
    expect([...onto].sort()).toEqual(['A9', 'W4']);
    expect(answers).toContainEqual({ kind: 'skip' });

    const pick = (list: TaskAnswer[]) =>
      list.find((a) => a.kind === 'card') ?? (list[0] as TaskAnswer);
    const done = answerAll(grown.state, pick);
    expect(buildingOf(done, WHEAT, 'W4').stack).toHaveLength(1);
    expect(buildingOf(done, WHEAT, 'A9').stack).toHaveLength(1);
    expect(buildingOf(done, WHEAT, 'W5').stack).toHaveLength(1);
    expect(buildingOf(done, WHEAT, 'W3').stack).toHaveLength(0);
  });

  it('W9 Mill House (v42): the stop answer ends it after one card', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W9', 'W4', 'W5');
    dealTo(data, s, WHEAT, 'W6');
    const grown = growBuilding(data, s, WHEAT, 'W9', 'W6');
    const first = pendingAnswers(data, grown.state).find((a) => a.kind === 'card') as TaskAnswer;
    const one = answerTask(data, grown.state, first).state;
    expect(one.tasks).toHaveLength(1);
    const stopped = answerTask(data, one, { kind: 'skip' }).state;
    expect(stopped.tasks).toHaveLength(0);
    const loaded =
      buildingOf(stopped, WHEAT, 'W4').stack.length + buildingOf(stopped, WHEAT, 'W5').stack.length;
    expect(loaded).toBe(1);
  });

  it('W10 The Furrow (v42): exactly three hand cards of your choosing, no stop answer', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W10');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8');
    loadStack(data, s, WHEAT, 'W10', 1, 'apiary'); // threshold 2
    const grown = growBuilding(data, s, WHEAT, 'W10', 'W8');
    expect(grown.state.tasks).toEqual([{ t: 'handToBarn', pid: WHEAT, src: 'W10', remaining: 3 }]);
    expect(pendingAnswers(data, grown.state).some((a) => a.kind === 'skip')).toBe(false);
    const done = answerAll(grown.state);
    expect(player(done, WHEAT).barn).toHaveLength(3);
    expect(player(done, WHEAT).hand).toHaveLength(1);
  });

  it('W10 The Furrow (v42): a hand of fewer than three banks what it has', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W10');
    dealTo(data, s, WHEAT, 'W4', 'W8');
    const grown = growBuilding(data, s, WHEAT, 'W10', 'W8');
    expect(grown.state.tasks).toEqual([{ t: 'handToBarn', pid: WHEAT, src: 'W10', remaining: 1 }]);
    const done = answerAll(grown.state);
    expect(player(done, WHEAT).barn).toEqual(['W4']);
    expect(player(done, WHEAT).hand).toEqual([]);
  });

  /**
   * ⛔ THE DELIVER IS GONE (ruling F, closed by Dean 2026-08-12, applied to the
   * engine 19/08/2026, and this test's name went with it).
   *
   * The card used to read "Harvest one of your buildings, however many cards are
   * on it, THEN DELIVER", and the tail handed Wheat the Vegetable suit's core
   * verb for free - it was the one card in Wheat that SHIPPED freight, which was
   * exactly the argument for keeping it (2026-08-09, on the O15 precedent). Dean
   * reversed that: the Deliver belongs to Vegetable. The sheet dropped the
   * clause the same day and the engine kept pushing the task for a week.
   *
   * WHAT IS LOST WITH IT: Wheat now manufactures barn stock and has nothing
   * anywhere in the suit that moves any, so its freight has to leave through the
   * plain Deliver action or the Deliver Service like everybody else's. V7 The
   * Export Depot keeps the harvest-then-deliver pairing.
   */
  it('W11 The Bakehouse: harvests a LOADED building, and no longer Delivers', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W11', 'W4');
    dealTo(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // 1 of 2: nowhere near full
    loadStack(data, s, WHEAT, 'W11', 1, 'apiary'); // threshold 2: the payment fills it
    const grown = growBuilding(data, s, WHEAT, 'W11', 'W6');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['chooseBuilding']);
    expect(grown.state.tasks.some((t) => t.t === 'deliver')).toBe(false);
    const chooser = grown.state.tasks[0];
    expect(chooser).toMatchObject({ filter: 'loaded' });
    // The half-full W4 is a legal target, which the strict gate would refuse.
    // "However many cards are on it" is the card's OWN printed exception, and it
    // is the reason W11 still reaches a partial now that the suit power that
    // used to do the same job has gone.
    expect(pendingAnswers(data, grown.state)).toContainEqual({ kind: 'building', card: 'W4' });
  });

  /**
   * ⭐ v42: "every Wheat building", so W12 is one of its own targets (its grow
   * payment is on it), and a foreign building is not.
   */
  it('W12 Crop Rotation (v42): every loaded Wheat building, itself included, never a foreign one', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W12', 'W4', 'W5', 'W6', 'A9');
    dealTo(data, s, WHEAT, 'W7');
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // partial
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary'); // full
    loadStack(data, s, WHEAT, 'A9', 1, 'orchard'); // foreign: stays
    // W6 left empty: nothing to harvest there.
    loadStack(data, s, WHEAT, 'W12', 1, 'apiary'); // threshold 2
    const grown = growBuilding(data, s, WHEAT, 'W12', 'W7');
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W5').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W12').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'A9').stack).toHaveLength(1);
    // 1 + 2 + W12's own 2.
    expect(player(grown.state, WHEAT).barn).toHaveLength(5);
  });
});

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

  /**
   * v45 RETEXT (19/09/2026, R6 and R10): "each of your OTHER buildings ...
   * not this one". W13's own fee therefore stays on its own stack - a
   * deliberate self-clog, not a bug (the old face scooped it straight back;
   * this one no longer harvests itself at all, so an ordinary Harvest is
   * needed before W13 can fire again).
   */
  it('W13 The Bakery (v45): one GROW empties every OTHER loaded building, never itself', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4', 'W5'); // W13 threshold 1
    loadStack(data, s, WHEAT, 'W4', 1, 'apiary'); // 1 of 2: not full, harvested anyway
    fill(s, 'W5');
    const grown = growTier3(s, 'W13');
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W5').stack).toEqual([]);
    // R10: its own fee is NOT harvested back - the whole point of the retext.
    expect(buildingOf(grown.state, WHEAT, 'W13').stack).toEqual(['W20']);
    expect(player(grown.state, WHEAT).barn).toHaveLength(3); // 1 (W4) + 2 (W5)
  });

  /**
   * v45 RETEXT (19/09/2026, R6): "with at least 1 card on it" replaces v42's
   * "however many cards ... (including 0)", so an EMPTY building is no longer
   * harvested; a Notice Board still needs 3+ (the standing rule, unchanged).
   */
  it('W13 The Bakery (v45): an empty building is skipped, a Notice Board only at 3+', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W5'); // W5 empty
    loadStack(data, s, WHEAT, 'W3', 2, 'apiary'); // the Notice Board, below 3
    const grown = growTier3(s, 'W13');
    const harvested = grown.events.flatMap((e) => (e.e === 'harvested' ? [e.building] : []));
    // Nothing at all: not W13 (excludes itself), not the empty W5, not the
    // sub-3 Notice Board.
    expect(harvested).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W13').stack).toEqual(['W20']);
    expect(buildingOf(grown.state, WHEAT, 'W3').stack).toHaveLength(2);

    const t = base();
    buildFor(data, t, WHEAT, 'W13');
    loadStack(data, t, WHEAT, 'W3', 3, 'apiary');
    const full = growTier3(t, 'W13');
    expect(buildingOf(full.state, WHEAT, 'W3').stack).toEqual([]);
  });

  /**
   * ⛔ THE PAYOUT IS A DRAW AND IT NO LONGER PAYS THE OWNER FOR THEIR OWN CARD
   * (v31, plan section 3.3). The sheet reads "Every player, including you, may
   * Draw 1. Then Draw 1 for each card ANOTHER player drew", so the OFFER is
   * unchanged - the owner is still offered a draw of their own, which is what
   * stops the card being dead in a position where every rival declines - but the
   * owner's own acceptance pays nothing. Under the old £1-per-card text it paid,
   * and the difference is the whole conversion: a card that paid itself would be
   * a naked Draw 2 for its owner with the rivals as decoration.
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
    expect(player(declined, WHEAT).hand).toEqual([]);
    expect(player(declined, APIARY).hand).toEqual([]);

    // Everybody accepts: the owner takes their own offered card AND one for the
    // rival's acceptance, so 2 in hand against the rival's 1.
    const accepted = answerAll(grown.state, (answers) => answers[0] as TaskAnswer);
    expect(player(accepted, WHEAT).hand).toHaveLength(2);
    expect(player(accepted, APIARY).hand).toHaveLength(1);
  });

  /**
   * THE OWNER'S OWN ACCEPTANCE PAYS NOTHING - the half of the conversion a
   * one-sided fixture would miss. With the rival declining, the owner's yes buys
   * exactly the one card the offer itself hands over.
   */
  it('W14 The Pizzeria: the owner is paid for a RIVAL card drawn, never their own', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W14');
    const grown = growTier3(s, 'W14');

    // The owner accepts and the rival declines. The acceptance pushes the
    // owner's own Draw 1 and nothing else - a rival acceptance would push a
    // SECOND draw task behind it, and that is the whole of the difference.
    const accepted = answerTask(data, grown.state, {
      kind: 'card',
      payload: { take: true },
    } as TaskAnswer).state;
    const declined = answerTask(data, accepted, { kind: 'skip' } as TaskAnswer).state;
    expect(declined.tasks.filter((t) => t.t === 'draw')).toHaveLength(1);
    const done = answerAll(declined, (answers) => answers[0] as TaskAnswer);
    expect(player(done, WHEAT).hand).toHaveLength(1);
  });

  it('W14 The Pizzeria: an acceptance banks nothing out of the OWNER’s hand', () => {
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
    // W5 and W6 still in hand, plus the owner's own card and the one the
    // rival's acceptance paid for.
    expect(player(done, WHEAT).hand).toContain('W5');
    expect(player(done, WHEAT).hand).toContain('W6');
    expect(player(done, WHEAT).hand).toHaveLength(4);
  });

  it('W15 The Patisserie (v42): one deck chosen, its top three cards to the barn', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W15');
    const tops = s.decks.dairy.slice(0, 3);
    const grown = growTier3(s, 'W15');
    expect(grown.state.tasks).toHaveLength(1);
    const answers = pendingAnswers(data, grown.state);
    expect(answers).toHaveLength(data.cards.suits.length);
    const done = answerTask(data, grown.state, {
      kind: 'card',
      payload: { suit: 'dairy' },
    } as TaskAnswer).state;
    // The fee is on the stack, never in the barn: only the deck cards arrive.
    expect(player(done, WHEAT).barn).toEqual(tops);
    expect(done.tasks).toEqual([]);
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
   * ⛔ THE BARN PRINTS NOTHING (v31), so its two tests become one that pins the
   * absence. What went was "When you build a FIELD, Draw 1" (2 on the flipped
   * face, which the 2026-08-12 rebalance had cut and Dean then restored on the
   * paid-for face alone) and the printed hand size beside it.
   *
   * ⚠️ THE REASONING THAT KILLED THE WHOLE FAMILY is worth keeping, because it
   * is about SHARED LINES rather than about this number. The rider was printed
   * identically on all five Barns but paid out per BUILD, and Dairy builds 12.02
   * buildings a seat against a field of about 5 - so a line the sheet treated as
   * shared paid one suit 2.4x what it paid anybody else. A shared line on an
   * unshared metric is a hidden per-suit faucet.
   */
  it('W1 Barn: building a FIELD draws nothing - the rider is gone', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'W4', 'W5'); // W4 costs 1 wheat, paid with W5
    const applied = apply(data, s, {
      type: 'build',
      seat: WHEAT,
      card: 'W4',
      payment: ['W5'],
    });
    expect(applied.state.tasks.filter((t) => t.t === 'draw' && t.src === 'W1')).toEqual([]);
    // v42 prints the own-crop scorer on the Barn (A105) and nothing else.
    expect(cardById(data, 'W1').abilityText).toBe(
      'Game end: 1 VP for each Wheat card you have built.',
    );
    expect(handlerFor('W1')?.on).toBeUndefined();
  });

  it('W1 Barn: building a non-FIELD draws nothing either', () => {
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

  /**
   * ⭐ THE ONCE-PER-TURN GUARD IS GONE (Dean, 15/09/2026): card text fires every
   * time its trigger happens, and each building harvested is its own trigger.
   *
   * v45 (19/09/2026, R7/R8): the push itself is still unconditional - one
   * `granaryDraw` task per building harvested, queued regardless of hand size.
   * The condition ("5 or fewer cards") is evaluated when each task is
   * actually RESOLVED, not when it is pushed, which is what lets a cascade
   * stop paying part way through (see the two tests below).
   */
  it('W16 The Granary: queues a draw check for EVERY building harvested', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W12', 'W4', 'W5');
    dealTo(data, s, WHEAT, 'W7');
    loadStack(data, s, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W12', 1, 'apiary');
    const grown = growBuilding(data, s, WHEAT, 'W12', 'W7');
    const granary = grown.state.tasks.filter(
      (t) => t.t === 'card' && t.kind === 'granaryDraw' && t.src === 'W16',
    );
    // W4, W5 and W12 itself (v42: W12 is a Wheat building).
    expect(granary).toHaveLength(3);
    expect(grown.state.turn.firedThisTurn).not.toContain('W16');
  });

  /** R7: the condition is the owner's HAND ONLY, and it fires at 5 or fewer. */
  it('W16 The Granary: fires when the hand is 5 or fewer cards', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W9'); // W9: no harvest-time text of its own
    dealTo(data, s, WHEAT, 'A4', 'A5', 'A6', 'A7', 'A8'); // hand of 5, right at the floor
    fill(s, 'W9');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W9' });
    expect(pendingAnswers(data, applied.state).length).toBeGreaterThan(0);
    const done = answerAll(applied.state);
    expect(player(done, WHEAT).hand).toHaveLength(6); // the 5 kept, plus the draw
  });

  /** R7: over 5 and the draw is silent, dropped by the engine's own drain loop. */
  it('W16 The Granary: stays silent when the hand is more than 5 cards', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W16', 'W9');
    dealTo(data, s, WHEAT, 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'); // hand of 6
    fill(s, 'W9');
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W9' });
    expect(applied.state.tasks).toEqual([]);
    expect(player(applied.state, WHEAT).hand).toHaveLength(6);
  });

  /**
   * R8: the count is taken FRESH each time this card's draw would happen, not
   * once per turn - so a cascade (here W13's, excluding itself since v45)
   * stops paying part way through as the hand fills. All three `granaryDraw`
   * tasks are pushed together, synchronously, during W13's own cascade,
   * before any of them resolve - it is resolving the FIRST one that fills the
   * hand and turns the other two silent, exactly as the ruling describes.
   */
  it('W16 The Granary: a cascade stops paying part way through as the hand fills', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W16', 'W9', 'W10', 'W11');
    loadStack(data, s, WHEAT, 'W9', 1, 'orchard');
    loadStack(data, s, WHEAT, 'W10', 1, 'orchard');
    loadStack(data, s, WHEAT, 'W11', 1, 'orchard');
    dealTo(data, s, WHEAT, 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'); // hand of 6
    const grown = growBuilding(data, s, WHEAT, 'W13', 'A4'); // pays 1: hand -> 5
    expect(player(grown.state, WHEAT).hand).toHaveLength(5);
    expect(
      grown.state.tasks.filter((t) => t.t === 'card' && t.kind === 'granaryDraw'),
    ).toHaveLength(3);

    // Resolving the first (hand 5, live) fills the hand to 6; the drain loop
    // then re-checks the next task fresh at 6, finds nothing legal, and drops
    // it silently - and the one after that too.
    const answer = pendingAnswers(data, grown.state)[0] as TaskAnswer;
    const done = answerTask(data, grown.state, answer).state;
    expect(done.tasks).toEqual([]);
    expect(player(done, WHEAT).hand).toHaveLength(6); // exactly ONE draw fired
    expect(player(done, WHEAT).barn).toHaveLength(3); // W9, W10, W11's single cards
  });

  /**
   * W17 THE PIE SHOP, RE-KEYED 04/09/2026 onto the `visited` event: "Whenever a
   * neighbour visits you, Draw 1" (v33 sheet).
   *
   * ⛔ THE OLD HANDLER WAS A DEAD CARD. It listened on `afterPlacement` for a
   * rival placing a card on one of the owner's buildings, and the meeple loop
   * places no card on any board at all - so the card printed text the engine
   * could not deliver. It is the game's only host-side payment, which is half
   * the thing the meeple-loop diagnosis said the v31 hook was missing.
   *
   * ⚠️ cards.json STILL CARRIES THE OLD WORDING; the divergence is deliberate
   * and lives in the ledger, because the sheet is the source of truth for text.
   */
  it('W17 The Pie Shop: Draw 1 whenever a NEIGHBOUR visits you', () => {
    const s = armBase();
    buildFor(visitArm, s, WHEAT, 'W17');
    // The door belongs to the HOST's suit, so an Apiary seat visiting a Wheat
    // seat buys a Harvest - and a door with nothing legal to do is not offered,
    // so the visitor needs a full building of their own to harvest.
    buildFor(visitArm, s, APIARY, 'A5'); // threshold 2
    loadStack(visitArm, s, APIARY, 'A5', 2, 'orchard');
    s.turnPlayer = APIARY;
    const applied = apply(visitArm, s, visitMove(APIARY, WHEAT, 'wheat'));
    expect(applied.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(true);
    expect(applied.audit.crossSeat).toBe(true);
  });

  /**
   * ⭐ IT PAYS FOR BEING VISITED, NOT FOR VISITING, and that one-word guard
   * (`event.host === self.seat`) is the whole of the retext. O16 The Fruit Store
   * is the visitor-side card on the same hook; the two must never collapse into
   * each other.
   */
  it('W17 The Pie Shop: pays nothing when its OWNER is the one going out', () => {
    const s = armBase();
    buildFor(visitArm, s, WHEAT, 'W17');
    // The slot bought is a COLOUR, not the host's suit: every board carries all
    // five, so red is legal on an Apiary neighbour and Draw 2 is always live.
    const applied = apply(visitArm, s, visitMove(WHEAT, APIARY, 'orchard'));
    expect(applied.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(false);
  });

  /**
   * ⭐ THE ONCE-A-TURN GUARD IS GONE (Dean, 15/09/2026): a second visit in the
   * same turn draws a second card. Driven through the hook directly, as the old
   * guard test was.
   */
  it('W17 The Pie Shop: fires on every visit, a second one in the same turn included', () => {
    const s = armBase();
    buildFor(visitArm, s, WHEAT, 'W17');
    buildFor(visitArm, s, APIARY, 'A5');
    loadStack(visitArm, s, APIARY, 'A5', 2, 'orchard');
    s.turnPlayer = APIARY;
    const once = apply(visitArm, s, visitMove(APIARY, WHEAT, 'wheat'));
    expect(once.state.turn.firedThisTurn).not.toContain('W17');
    const again = { ...once.state, tasks: [] };
    const fx = new Fx(visitArm, again, APIARY);
    fireHook(fx, 'afterVisit', { visitor: APIARY, host: WHEAT, self: false });
    expect(fx.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(true);
  });

  /**
   * ⚠️ A SELF-VISIT IS NOT A NEIGHBOUR, and the guard is only reachable on the
   * control: the shipped game deletes the self-visit at the enumerator (X5), so
   * `event.self` is false by construction there. Under
   * overlays/v31-card-visit.overlay.json it is live, and without the guard a
   * seat would pay itself a card for every bonus slot it ever spent.
   */
  it('W17 The Pie Shop: a SELF-visit is not a neighbour, under the v31 control', () => {
    const control = cardVisitGame();
    const s = makeState(control, ['wheat', 'apiary']);
    buildFor(control, s, WHEAT, 'W17', 'W9');
    for (let i = 0; i < 2; i++) {
      const top = s.decks.apiary.shift();
      if (top) s.players[WHEAT]!.tableau.find((b) => b.card === 'W9')!.stack.push(top);
    }
    dealTo(control, s, WHEAT, 'W20');
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(control, s, { type: 'visit', seat: WHEAT, host: WHEAT, fee: 'W20' });
    expect(applied.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(false);
  });
});

describe('the Endgame cards - three shapes of tableau', () => {
  it('W19 The Wheat Exchange: 2 VP per different crop built', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W19', 'W4', 'W5', 'A9'); // wheat + apiary = 2 crops
    // W19's 4, plus W2's 3 for the three Wheat cards built (W19, W4, W5). The
    // Apiary card counts for W19's variety and never for W2's loyalty, which is
    // the one place in the suit where the two endgame axes disagree.
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(7);
  });

  it('W20 The Grand Granary: 1 VP per DECK-built building, never a starter', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W20', 'W4', 'W5');
    // W20, W4, W5 = 3, and W2 scores the same three for being Wheat. The
    // starters arrive pre-built and nobody built them, so neither card counts
    // them - which is the shared reading both formulas turn on.
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(6);
  });

  /**
   * ⭐ RETEXTED ON v41 (15/09/2026): *"Game end: 2 VP for each different RECEIPT
   * suit you have delivered."* A receipt keeps its token's crop (R7). The old
   * FIELD count and its cap of 6 are gone with the text. The W2 line every
   * Wheat tableau scores rides beside it, which is what catches the Farmstead
   * being counted twice or not at all.
   */
  it('W21 The Bread Hall: 2 VP per DIFFERENT receipt crop, beside the Farmstead line', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W21', 'W4', 'W5'); // FIELDs no longer count
    player(s, WHEAT).receipts.push(
      { vp: 6, crop: 'wheat', tile: 'A1' },
      { vp: 3, crop: 'wheat', tile: 'A2' },
      { vp: 5, crop: 'apiary', tile: 'A5' },
    );
    // W21's 2 x 2 distinct crops, plus W2's 1 per Wheat deck card built (3).
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(4 + 3);
  });

  it('W21 The Bread Hall: a WILD receipt is a suit of its own (builder default)', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W21');
    player(s, WHEAT).receipts.push(
      { vp: 4, crop: 'wild', tile: 'A1' },
      { vp: 6, crop: 'wild', tile: 'A2' },
      { vp: 5, crop: 'dairy', tile: 'A5' },
    );
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(4 + 1);
  });

  it('W21 The Bread Hall: no receipts, no VP', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W21');
    expect(gameEndScores(data, s)[WHEAT]?.endgame).toBe(0 + 1);
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
      // ⛔ NO WHEAT CARD CONTRIBUTES STANDING MOVES ANY MORE. Three were the
      // Tier 3 ACTION cards, retired on 19/08/2026; the fourth was W18 A
      // Helping Hand, whose second-card repeat was the card that forced
      // `moves`/`applyMove` into the handler API in the first place. Its v31
      // rewrite is a bonus-slot modifier with no body at all. This assertion is
      // what stops either concept creeping back one handler at a time.
      expect(typeof h?.moves === 'function', id).toBe(false);
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
