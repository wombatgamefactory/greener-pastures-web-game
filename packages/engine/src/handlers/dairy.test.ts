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

import { Fx } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, canTakeCard, isFull, isHarvestable, player } from '../query.js';
import { revealedIn } from '../state.js';
import type { CardId, GameState, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState, noMeeples } from '../testkit.js';
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

/**
 * The same question for a task whose cards are in LIMBO - D10's and D15's deck
 * reveals - where the answers name a SLOT rather than a card id.
 *
 * They have to: a revealed deck top is in no hand, no pile and no stack, so no
 * PlayerView carries it, and `legalMoves` hands the move list to a policy
 * unredacted. Naming the id would put the deck order in the move list and in
 * the replayable move log. See REVEAL_RIDER in state.ts, and the walk in
 * view-safety.test.ts that keeps it honest. So a test that wants "build the
 * wheat top" resolves the slot through the task, exactly as the resolver does.
 */
function revealedOffers(state: GameState): { card: CardId; answer: TaskAnswer }[] {
  const head = state.tasks[0];
  if (!head || head.t !== 'card') throw new Error('Expected a card task');
  const reveal = revealedIn(head);
  return pendingAnswers(data, state).flatMap((answer) => {
    if (answer.kind !== 'card') return [];
    const pick = answer.payload.pick;
    if (typeof pick !== 'number') return [];
    const card = reveal[pick];
    return card === undefined ? [] : [{ card, answer }];
  });
}

/**
 * ⛔ THE `divert` HELPER IS GONE (v31). It answered the Dairy Farmstead's
 * divert-a-spent-card task, and every build test in this file had to step past
 * that prompt before it could assert anything. There is no prompt: a build's
 * payment goes straight to the discard, so the three D11 fixtures that called
 * `divert(state, null)` now read the state the build returned.
 */

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

/**
 * ⛔ THE DAIRY FARMSTEAD'S DIVERSION IS GONE (v31), AND IT WAS CALLED "THE
 * SUIT'S WHOLE COMPENSATION". Two describe blocks - the deleted powers and the
 * diversion itself - collapse to the one below. Six divert tests go with the
 * mechanism, and the four rulings they encoded are recorded here because
 * anything that ever reaches into a build payment will meet them again:
 *
 *   1. **Cards spent from your HAND only.** A card D7 lifted off a stack was
 *      never divertible, or D2 + D7 is a free Harvest - stack to build cost to
 *      barn with no Harvest action spent.
 *   2. **Once per Build, however many buildings that Build puts down**, with
 *      the COUNT per card spent - so D12 and D15 diverted more without the
 *      trigger re-firing.
 *   3. **A free build spends no cards and therefore diverts nothing.**
 *   4. **ONE DESTINATION PER SPENT CARD, enforced by ORDERING** rather than by
 *      three assertions: the diversion came out BEFORE the discard and was
 *      never reclaimed from the pile afterwards, so D5 (sow the cards this build
 *      spent) and D6 (give one away), which both reach into the discard on
 *      `afterBuild`, could never race it for the same card.
 *
 * Ruling 4 is the one still enforced in code: it lives in `divertOrDiscard`
 * (actions.ts), and it is what O17 The Fruit Basket obeys by PREPENDING its
 * choice. The other three have no holder left.
 *
 * ⚠️ AND NOTHING REPLACES IT. Dairy measured 10.2 cards into its barn against
 * Orchard's 25.7 because its cards left the pipeline into the tableau and never
 * came back; this was the line that put them back. Watch barn intake.
 */
describe('the deleted Farmstead powers', () => {
  it('a Dairy seat has to match crops like everybody else', () => {
    const s = base();
    // ⚠️ CARD-ONLY BY CONSTRUCTION. Since 05/09/2026 a meeple of a colour pays
    // wherever a card of that colour would (R15), and every seat starts holding one
    // of each, so the supply would answer the question this case asks.
    noMeeples(s);
    // W9 costs 3 wheat. A Dairy seat holding three dairy cards used to be able
    // to pay for it and now cannot: that is buildSubstitutePower, deleted.
    dealTo(data, s, DAIRY, 'W9', 'D4', 'D5', 'D6');
    expect(legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W9')).toEqual([]);
  });

  /**
   * ⛔ THE BUILDER'S YARD GRANTS NOTHING NOW (v31). It used to waive crop
   * requirements AND take 2 cards off a visitor's build cost - itself a
   * reversal of a documented ruling that Dean approved on the visitor side,
   * because Build took 5% of all rival door uses, last in the game. v31 makes
   * every door plain on an argument that outranks it: the bonus slot itself
   * became the enhancement, because a door buys a WHOLE CORE ACTION for one
   * card. The `build` block is off the roster entry entirely.
   */
  it('the Builder’s Yard is a plain Build: no substitution, no discount', () => {
    const door = data.workers.roster.find((w) => w.id === 'build');
    expect(door?.action).toBe('build');
    expect('build' in (door as object)).toBe(false);
  });

  /**
   * ⚠️ THE `substitute` MOD OUTLIVED ITS PRODUCER, deliberately. It is the one
   * expression of "crop requirements waived" in the engine and nothing in the
   * shipped data grants it, so this is the standing check that a card which
   * prints those words has somewhere to attach - and that nothing has quietly
   * started granting it again.
   */
  it('nothing in the shipped data grants crop substitution to anybody', () => {
    for (const door of data.workers.roster)
      expect('build' in (door as object), door.id).toBe(false);
  });

  /**
   * ⛔ THE D2 DIVERT BLOCK'S ONE SURVIVING ASSERTION: a build's payment goes
   * straight to the discard, with no limbo and no prompt in between. It used to
   * sit in limbo until the seat chose a destination, and the whole file was
   * written around answering that prompt.
   */
  it('a build payment goes straight to the discard: nothing is diverted', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    expect(built.state.discards.wheat.sort()).toEqual(['W4', 'W6']);
    expect(built.state.tasks.filter((t) => t.t === 'card')).toHaveLength(0);
    expect(player(built.state, DAIRY).barn).toEqual([]);
  });
});

describe('D2 The Farmstead - the own-crop end-game scorer', () => {
  it('D2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4', 'D8', 'W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });

  it('D2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[DAIRY]?.endgame).toBe(0);
  });

  /**
   * ⚠️ RISK 3 OF THE PASS, VISIBLE IN ONE NUMBER. D2 pays for own-suit density
   * and every Power and Endgame card costs 2 cards of its own suit, so both push
   * the same way - and Dairy already built 12.02 buildings a seat against a
   * field of about 5. The suit that builds most is the suit this line pays most.
   */
  it('D2 is the largest single scorer on a wide Dairy farm', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4', 'D5', 'D6', 'D7', 'D8', 'D20');
    // ⭐ v48 R13 (tasks/v48-rulings-v2.md): D20 now excludes ITSELF from its own
    // count (an Endgame card), so its divisor of 2 runs over the five Tier 1
    // sheds only - 2, not 3. D2's flat rate is unaffected: 6.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2 + 6);
  });
});

describe('the build-modifier vocabulary', () => {
  it('D4 grants a flat discount of 1, whatever is on its stack', () => {
    const s = base();
    // ⚠️ CARD-ONLY: the payment-length assertion below counts CARDS, and a meeple
    // may stand in for one of them since 05/09/2026.
    noMeeples(s);
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

  it('D9 counts crops on buildings BUILT, so a starter never adds one', () => {
    // Ruling M: W19 The Wheat Exchange prints the same eleven words. Before
    // v48 R13 it read a DIFFERENT set - the whole tableau through cropOf -
    // where the Wagon read builtBuildings; R13 makes the two agree (see the
    // R13 test right below), but a starter is outside both readings either
    // way.
    // ⛔ THE TEST USED TO FLIP ALL THREE STARTERS, because cropOf returned a
    // starter's suit once it was upgraded and this was the case where the two
    // readings could have disagreed. v31 deletes the flipped faces, so a starter
    // prints the generic starting-building icon for the whole game and the two
    // readings can no longer come apart on a starter at all.
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    // Dairy, off the Wagon itself and nothing else - so it still opens at 1.
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
  });

  /**
   * ⭐ R13 (tasks/v48-rulings-v2.md, 24/09/2026): a built Power card now counts
   * toward the crop-variety discount too, on top of Tier 1-3 buildings.
   */
  it('R13: a built Power card of a new crop widens the discount', () => {
    const s = base();
    // D9 alone: Dairy only, discount 1 (the Wagon itself).
    buildFor(data, s, DAIRY, 'D9');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const mono = growBuilding(data, s, DAIRY, 'D9', 'D5');
    expect(headBuild(mono.state).mods).toEqual({ discount: 1 });

    // Add W16 The Granary, a Power card: a second crop, never offered as a
    // Build or Grow target, but it counts for this discount since v48.
    const t = base();
    buildFor(data, t, DAIRY, 'D9', 'W16');
    dealTo(data, t, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const mixed = growBuilding(data, t, DAIRY, 'D9', 'D5');
    expect(headBuild(mixed.state).mods).toEqual({ discount: 2 });
  });
});

/**
 * ⭐ v48: D7 The Versatile Shed retexted from the stack-payment card ("Build.
 * You may spend cards from one of your buildings as 2 wild resources.") to a
 * plain placement, the D5 shape: "Build. Place 1 of the cards spent into your
 * Barn." Every test below that exercised `fromStacks` is gone with the mod -
 * see the handler's own notes in dairy.ts for the ruling and for the A15
 * coupling this shape carries forward from D5, unresolved on purpose.
 */
describe('D7 The Versatile Shed - one spent card, into the barn (v48)', () => {
  it('places exactly one spent card into the barn and leaves the rest discarded', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D7');
    dealTo(data, s, DAIRY, 'D6', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D6');
    const build = buildOffersOf(grown.state, 'W9').find((a) => a.payment.length === 3);
    expect(build).toBeDefined();
    const spent = (build as Extract<TaskAnswer, { kind: 'build' }>).payment;
    const built = answerTask(data, grown.state, build as TaskAnswer).state;
    expect(built.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['reclaimSpent']);

    const place = pendingAnswers(data, built).find((a) => a.kind === 'card');
    expect(place).toBeDefined();
    const placedCard = (place as Extract<TaskAnswer, { kind: 'card' }>).payload.card as CardId;
    const done = answerTask(data, built, place as TaskAnswer).state;

    // Single-shot, exactly like D5: the task is fully resolved after this one answer.
    expect(done.tasks).toHaveLength(0);
    expect(player(done, DAIRY).barn).toEqual([placedCard]);
    const stranded = spent.filter((c) => c !== placedCard);
    expect(stranded).toHaveLength(2);
    for (const card of stranded) expect(done.discards.wheat).toContain(card);
  });

  it('offers every spent card still face up in the discard, not only one', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D7');
    dealTo(data, s, DAIRY, 'D6', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D6');
    const build = buildOffersOf(grown.state, 'W9').find((a) => a.payment.length === 3);
    const spent = (build as Extract<TaskAnswer, { kind: 'build' }>).payment;
    const built = answerTask(data, grown.state, build as TaskAnswer).state;
    const offered = pendingAnswers(data, built).flatMap((a) =>
      a.kind === 'card' ? [a.payload.card as CardId] : [],
    );
    expect(offered.sort()).toEqual([...spent].sort());
  });

  it('is mandatory but auto-skips with no legal Build, so nothing is placed', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7');
    dealTo(data, s, DAIRY, 'D6');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D6');
    // The Build auto-skipped for lack of anything to pay with: no follow-up
    // task, and no barn card either - "if the Build could not happen ...
    // nothing is placed" (tasks/v48-ambiguity-audit-v1.md, resolved table).
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, DAIRY).barn).toEqual([]);
  });

  it('does not react to a build it did not grant (afterBuild guards on its own `src`)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7');
    const fx = new Fx(data, s, DAIRY);
    handlerFor('D7')?.on?.afterBuild?.(
      fx,
      { seat: DAIRY, card: 'W4', payment: ['W5', 'W6'], src: null, fromHand: true },
      { seat: DAIRY, card: 'D7' },
    );
    expect(fx.state.tasks.some((t) => t.t === 'card' && t.kind === 'reclaimSpent')).toBe(false);
    expect(player(fx.state, DAIRY).barn).toEqual([]);
  });
});

describe('D5 The Churning Shed - one spent card, single-shot (v47)', () => {
  /**
   * ⭐ v47: exactly ONE of the spent cards is sown, not every one of them, and
   * the task is done after that single answer - no more "stays for the next
   * card" loop.
   */
  it('sows exactly one spent card onto the new building and leaves the rest discarded', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = buildOffersOf(grown.state, 'W9').find((a) => a.payment.length === 3);
    expect(build).toBeDefined();
    const spent = (build as Extract<TaskAnswer, { kind: 'build' }>).payment;
    const built = answerTask(data, grown.state, build as TaskAnswer).state;
    expect(built.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['sowSpent']);

    const sow = pendingAnswers(data, built).find((a) => a.kind === 'card');
    expect(sow).toBeDefined();
    const done = answerTask(data, built, sow as TaskAnswer).state;

    // Single-shot: the task is fully resolved after this one answer.
    expect(done.tasks).toHaveLength(0);
    const w9 = buildingOf(done, DAIRY, 'W9');
    expect(w9.stack).toHaveLength(1);
    const stranded = spent.filter((c) => done.discards.wheat.includes(c));
    expect(stranded).toHaveLength(2);
  });

  /**
   * ⭐ v47: "even if the threshold is exceeded" is gone, and it does not need
   * to be replaced by anything - a freshly built stack is empty and every
   * threshold is at least 1, so one sown card can at most reach the
   * threshold exactly. W13 costs 4 (3 wheat + 1 wild) and prints threshold 1.
   */
  it('can fill a threshold-1 building exactly, leaving it full and harvestable', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W13', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = buildsOf(grown.state, 'W13').find((a) => a.kind === 'build');
    expect(build).toBeDefined();
    let state = answerTask(data, grown.state, build as TaskAnswer).state;
    const sow = pendingAnswers(data, state).find((a) => a.kind === 'card');
    expect(sow).toBeDefined();
    state = answerTask(data, state, sow as TaskAnswer).state;

    const w13 = buildingOf(state, DAIRY, 'W13');
    expect(w13.stack).toHaveLength(1);
    expect(isFull(data, w13)).toBe(true);
    expect(isHarvestable(data, w13)).toBe(true);
    expect(canTakeCard(data, w13)).toBe(false);
  });

  it('a Power card has no stack, so nothing is sown and the spent cards stay discarded', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W16', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = buildOffersOf(grown.state, 'W16')[0];
    expect(build).toBeDefined();
    const done = answerAll(answerTask(data, grown.state, build as TaskAnswer).state);
    expect(done.discards.wheat.length).toBeGreaterThan(0);
  });
});

describe('D6 The Trading Shed - hand-gated draw, no Build and no neighbour (v48)', () => {
  it('draws 1 per built building when the hand is 4 or fewer after the Grow payment', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6', 'D4');
    // D5 pays the Grow that activates D6; W4, W5, W6 are what is left, a hand
    // of 3 after payment - comfortably under the "less than 5" gate.
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const done = answerAll(grown.state);
    // D6 and D4 - two built buildings - so two cards drawn on top of the 3 left.
    expect(player(done, DAIRY).hand).toHaveLength(5);
  });

  it('the gate: a hand of exactly 4 after payment passes; a hand of 5 does not', () => {
    const under = base();
    buildFor(data, under, DAIRY, 'D6');
    dealTo(data, under, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grownUnder = growBuilding(data, under, DAIRY, 'D6', 'D5');
    // Hand of 4 after payment: "less than 5" passes, and D6 alone draws 1.
    const doneUnder = answerAll(grownUnder.state);
    expect(player(doneUnder, DAIRY).hand).toHaveLength(5);

    const at = base();
    buildFor(data, at, DAIRY, 'D6');
    dealTo(data, at, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7', 'W8');
    const grownAt = growBuilding(data, at, DAIRY, 'D6', 'D5');
    // Hand of 5 after payment: the gate fails outright, no draw task at all.
    expect(grownAt.state.tasks.some((t) => t.t === 'draw' && t.src === 'D6')).toBe(false);
    expect(player(grownAt.state, DAIRY).hand).toHaveLength(5);
  });

  /**
   * ⭐ v48: NO BUILD AND NO NEIGHBOUR ANY MORE. The old "Build. You and one
   * neighbour each Draw 1." shape - and its `neighbourDraw` task - is gone
   * outright; growing D6 never offers a Build and never touches another seat.
   */
  it('never offers a Build and never touches another seat', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5');
    const wheatBefore = player(s, WHEAT).hand.length;
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    expect(grown.state.tasks.some((t) => t.t === 'build')).toBe(false);
    const done = answerAll(grown.state);
    expect(player(done, WHEAT).hand.length).toBe(wheatBefore);
  });

  /**
   * ⭐ R13 (tasks/v48-rulings-v2.md, 24/09/2026): a built Power card now counts
   * as a building for D6's draw. `builtBuildingsAndPower` (buildings.ts) is a
   * counting-only helper - D16 is never offered as a sow, Grow or Harvest
   * target, it simply draws a card here.
   */
  it('R13: a built Power card counts toward the draw', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6', 'D16'); // D16 The Ledger, a Power card
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const done = answerAll(grown.state);
    // D6 and D16 - two built "buildings" once a Power card counts - drawn on
    // top of an empty hand (D5 paid the Grow).
    expect(player(done, DAIRY).hand).toHaveLength(2);
  });

  /** R13 does not reach Endgame cards: they still never count. */
  it('R13: a built Endgame card does NOT count toward the draw', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6', 'D19'); // D19 The Cheese Hall, an Endgame card
    dealTo(data, s, DAIRY, 'D5');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const done = answerAll(grown.state);
    // D6 only - D19 is Endgame and does not count - one card drawn.
    expect(player(done, DAIRY).hand).toHaveLength(1);
  });
});

/**
 * ⭐ v48 R14 (tasks/v48-rulings-v2.md): the sheet now prints Draw 2 (was Draw
 * 1) and Dean settled the order question in favour of the printed face -
 * Build, THEN Draw 2 - reversing the engine's old draw-first order, which
 * existed only because Draw 1 in printed order was card-negative. The draw is
 * UNCONDITIONAL (v47 R1): it fires whether or not the Build could happen.
 */
describe('D8 The Abundant Shed - Build then Draw 2, printed order (v48)', () => {
  it('D8 offers the Build before the Draw 2 (printed order, R14)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D8');
    // D4 pays the Grow; W9, W4, W5, W6 are what is left, plenty of build
    // options so the Build task is a real choice and stays queued rather
    // than auto-resolving.
    dealTo(data, s, DAIRY, 'D4', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D8', 'D4');
    // `activate` pushes the Build first and the Draw 2 second, and `pushTask`
    // appends - so the head of the queue is the Build, exactly the printed
    // order, not the engine's old draw-first reversal.
    expect(grown.state.tasks[0]?.t).toBe('build');
  });

  it('D8 still draws 2 when the Build cannot happen', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D8');
    // D4 pays the Grow and is the only card in hand, so nothing is left to
    // Build with.
    dealTo(data, s, DAIRY, 'D4');
    const grown = growBuilding(data, s, DAIRY, 'D8', 'D4');
    // The Build auto-skipped for lack of anything to pay with: no build task
    // pending, only the Draw.
    expect(grown.state.tasks.some((t) => t.t === 'build')).toBe(false);
    const before = player(grown.state, DAIRY).hand.length;
    const done = answerAll(grown.state);
    expect(player(done, DAIRY).hand.length).toBe(before + 2);
  });
});

describe("D10 The Scout's Post - choose the deck, then decide (v47)", () => {
  it("reveals the chosen deck's top card and builds it at a discount of 2", () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    // W9 costs 3 total (2 wheat + 1 wild); at a discount of 2 it costs 1.
    s.decks.wheat = ['W9', ...s.decks.wheat.filter((c) => c !== 'W9')];
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');

    // The deck is chosen FIRST, before anything is revealed - the new v47 step.
    const chooseWheat = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    expect(chooseWheat).toBeDefined();
    const revealed = answerTask(data, grown.state, chooseWheat as TaskAnswer).state;

    const offers = revealedOffers(revealed);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.card === 'W9')).toBe(true);
    const takeAt1 = offers.find((o) => {
      const payload = (o.answer as Extract<TaskAnswer, { kind: 'card' }>).payload;
      return Array.isArray(payload.payment) && payload.payment.length === 1;
    });
    expect(takeAt1).toBeDefined();

    const state = answerAll(answerTask(data, revealed, takeAt1?.answer as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W9')).toBe(true);
  });

  it('a declined reveal is discarded, never returned to the deck (R3)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    const wheatTop = s.decks.wheat[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const chooseWheat = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    expect(chooseWheat).toBeDefined();
    const revealed = answerTask(data, grown.state, chooseWheat as TaskAnswer).state;
    const skip = pendingAnswers(data, revealed).find((a) => a.kind === 'skip');
    expect(skip).toBeDefined();
    const done = answerTask(data, revealed, skip as TaskAnswer).state;

    // R3 overturns the old "back on top of its own deck" reading.
    expect(done.decks.wheat[0]).not.toBe(wheatTop);
    expect(done.discards.wheat).toContain(wheatTop);
    expect(done.tasks).toHaveLength(0);
  });

  it('an unaffordable reveal is discarded too, not returned (R3)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    // W13 costs 4; even at a discount of 2 it needs 2 payment cards, and the
    // Dairy hand is empty (D5's only card paid to grow it).
    s.decks.wheat = ['W13', ...s.decks.wheat.filter((c) => c !== 'W13')];
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const chooseWheat = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    const revealed = answerTask(data, grown.state, chooseWheat as TaskAnswer).state;
    expect(pendingAnswers(data, revealed).every((a) => a.kind === 'skip')).toBe(true);
    const done = answerAll(revealed);
    expect(done.decks.wheat).not.toContain('W13');
    expect(done.discards.wheat).toContain('W13');
  });
});

describe('D11 The Heritage House - draws for what it spent (v47)', () => {
  it('draws 1 for each card the build spent, and sows nothing', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    expect(headBuild(grown.state).mods).toEqual({});
    const w9 = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 3,
    );
    expect(w9).toBeDefined();
    const spent = (w9 as Extract<TaskAnswer, { kind: 'build' }>).payment;
    const built = answerTask(data, grown.state, w9 as TaskAnswer).state;

    // No task is left waiting for a sow answer - the draw is pushed straight
    // off the afterBuild event, sized to what was spent.
    const draw = built.tasks.find((t) => t.t === 'draw' && t.src === 'D11');
    expect(draw).toBeDefined();
    expect(draw && draw.t === 'draw' ? draw.see : -1).toBe(3);
    expect(draw && draw.t === 'draw' ? draw.keep : -1).toBe(3);

    const done = answerAll(built);
    // Nothing is sown any more: every spent card is still exactly where the
    // build's discard put it, and none of it ever reaches a stack.
    const onStacks = player(done, DAIRY).tableau.flatMap((b) => b.stack);
    for (const card of spent) {
      expect(onStacks).not.toContain(card);
      expect(done.discards.wheat).toContain(card);
    }
  });

  it('a bigger payment draws more: the count tracks the spend, not a flat rate', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    dealTo(data, s, DAIRY, 'D5', 'W13', 'W4', 'W5', 'W6', 'W7');
    // W13 costs 4 (3 wheat + 1 wild).
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const w13 = buildsOf(grown.state, 'W13').find((a) => a.kind === 'build');
    expect(w13).toBeDefined();
    const built = answerTask(data, grown.state, w13 as TaskAnswer).state;
    const draw = built.tasks.find((t) => t.t === 'draw' && t.src === 'D11');
    expect(draw && draw.t === 'draw' ? draw.see : -1).toBe(4);
  });

  /**
   * A free build cannot be reached through D11's OWN grant (it never carries a
   * discount and no card in the catalogue costs 0), so the `event.payment.length
   * === 0` guard is exercised directly against the afterBuild hook, exactly as
   * the printed rule reads it: 0 cards spent, 0 cards drawn. `drawN` itself
   * already no-ops at `n <= 0`; this is the standing check that D11 truly
   * passes it that value rather than skipping the call some other way.
   */
  it('draws 0 on a free build', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    const fx = new Fx(data, s, DAIRY);
    handlerFor('D11')?.on?.afterBuild?.(
      fx,
      { seat: DAIRY, card: 'W4', payment: [], src: 'D11', fromHand: true },
      { seat: DAIRY, card: 'D11' },
    );
    expect(fx.state.tasks.some((t) => t.t === 'draw' && t.src === 'D11')).toBe(false);
  });

  it("only fires on its own build, never on another card's", () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    const fx = new Fx(data, s, DAIRY);
    handlerFor('D11')?.on?.afterBuild?.(
      fx,
      { seat: DAIRY, card: 'W4', payment: ['W5', 'W6'], src: null, fromHand: true },
      { seat: DAIRY, card: 'D11' },
    );
    expect(fx.state.tasks.some((t) => t.t === 'draw' && t.src === 'D11')).toBe(false);
  });

  /**
   * ⛔ "A FREE BUILD SPENDS NOTHING, SO IT SOWS NOTHING" IS DELETED (v31), AND
   * IT IS THE CASE ITSELF THAT BECAME UNREACHABLE RATHER THAN THE RULE. Kept
   * here as the standing check that the `covered` zone the old build-on-top
   * used has not been quietly reintroduced.
   */
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
    // Seven buildings, so seven cards drawn on top of a hand of two, and no
    // rival gains anything. ⛔ THERE IS NO BRAKE LEFT AT ALL (v31): the hand
    // limit was already unenforced mid-turn, and the end-of-turn discard that
    // used to catch it afterwards has gone with the limit itself.
    expect(player(state, WHEAT).hand).toEqual([]);
    expect(player(state, DAIRY).hand.length).toBeGreaterThan(5);
  });

  it('is a GROW building now, not an ACTION', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13');
    dealTo(data, s, DAIRY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'cardMove' && m.card === 'D13')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D13')).toBe(true);
  });

  /** R13 (tasks/v48-rulings-v2.md, 24/09/2026): a built Power card now draws too. */
  it('R13: a built Power card counts toward the draw', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D16'); // D16 The Ledger, a Power card
    dealTo(data, s, DAIRY, 'W4');
    // D13, D4, D16 - three built "buildings" once a Power card counts - drawn
    // on top of an empty hand (W4 paid the Grow).
    const state = answerAll(growBuilding(data, s, DAIRY, 'D13', 'W4').state);
    expect(player(state, DAIRY).hand).toHaveLength(3);
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

describe('D15 The Grand Creamery - a free build off the hand (v47)', () => {
  it('builds a chosen hand card for free, paying nothing and ignoring the n-of-suit requirement', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    // W9 costs 2 wheat + 1 wild: normally unbuildable with zero wheat cards in
    // payment. D15's grow payment (D4) leaves the hand holding only W9 itself.
    dealTo(data, s, DAIRY, 'D4', 'W9');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'D4');
    const build = buildsOf(grown.state, 'W9').find((a) => a.kind === 'build');
    expect(build).toBeDefined();
    expect((build as Extract<TaskAnswer, { kind: 'build' }>).payment).toEqual([]);
    const state = answerAll(answerTask(data, grown.state, build as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W9')).toBe(true);
    expect(player(state, DAIRY).hand).toEqual([]);
  });

  it('builds a Power or Endgame card too, for the same free price', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'D4', 'W16');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'D4');
    const build = buildsOf(grown.state, 'W16').find((a) => a.kind === 'build');
    expect(build).toBeDefined();
    expect((build as Extract<TaskAnswer, { kind: 'build' }>).payment).toEqual([]);
    const state = answerAll(answerTask(data, grown.state, build as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W16')).toBe(true);
  });

  it('fires afterBuild reactors even though the payment is empty (D16 The Ledger still draws)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    dealTo(data, s, DAIRY, 'D4', 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'D4');
    const build = buildsOf(grown.state, 'W4').find((a) => a.kind === 'build');
    expect(build).toBeDefined();
    const built = answerTask(data, grown.state, build as TaskAnswer).state;
    expect(built.tasks.some((t) => t.t === 'draw' && t.src === 'D16')).toBe(true);
  });

  it('is mandatory with any card in hand, and does nothing with an empty hand', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'D4');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'D4');
    // The hand is empty after the grow payment leaves it: the build task has
    // nothing to offer and auto-skips, exactly like every other mandatory
    // "Build." in the suit.
    expect(grown.state.tasks).toHaveLength(0);
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

  /**
   * ⛔ D17'S SCOPE FLIPPED FROM RIVAL TO OWNER AND THE HANDLER HAD NOT FOLLOWED,
   * so this test inverts twice over. What it pinned: "whenever a NEIGHBOUR
   * builds, take £1" - the "materials yard", the purest statement of the suit
   * paying you for the village building rather than for building yourself, and
   * the number flagged as most likely wrong in the whole suit. The SHEET has
   * printed "When you build a card that is not Dairy" since v30 and the engine
   * was still running the older text; v31 converts the coin to a draw, and this
   * pass follows the print on both halves at once.
   *
   * ⚠️ SO THE SUIT LOST ITS SECOND CROSS-TABLE CARD IN ONE EDIT. With D2 an
   * end-game scorer and this owner-scoped, Dairy touches another seat in exactly
   * one place: D6. What the card pays for now is ANTI-MONOCULTURE, which is the
   * one thing in its favour - it fires only on a non-Dairy build, so it pulls
   * against D2 and against the own-suit Power price.
   */
  it('D17 draws when YOU build a non-Dairy card, and never on a Dairy one', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const foreign = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(foreign.state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17')).toHaveLength(1);

    const t = base();
    buildFor(data, t, DAIRY, 'D17');
    dealTo(data, t, DAIRY, 'D4', 'D5');
    const own = apply(data, t, { type: 'build', seat: DAIRY, card: 'D4', payment: ['D5'] });
    expect(own.state.tasks.some((x) => x.t === 'draw' && x.src === 'D17')).toBe(false);
  });

  it('D17 no longer fires on a RIVAL build at all', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const rival = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(rival.state.tasks.some((t) => t.t === 'draw' && t.src === 'D17')).toBe(false);
    expect(handlerFor('D17')?.difficulty.verified.crossPlayer).toBe(false);
  });

  /**
   * ⚠️ IT FIRES PER BUILDING, NOT PER BUILD ACTION, which is unchanged and is
   * the same reading D16 has: a Butter Factory run that lands two foreign cards
   * pays this twice.
   */
  it('D17 fires per BUILDING, so a Butter Factory pays it twice', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    let state = grown.state;
    let draws = 0;
    for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
      const before = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17').length;
      const answers = pendingAnswers(data, state);
      const build = answers.find((a) => a.kind === 'build');
      state = answerTask(data, state, (build ?? answers[0]) as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17').length;
      if (after > before) draws += after - before;
    }
    expect(draws).toBe(2);
  });
});

describe('the endgame cards - D19, D20, D21', () => {
  it('D19 scores 1 per building printing a non-Dairy crop icon', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W5', 'W6', 'D4');
    // D19's 2 for the two Wheat cards, plus D2 the Farmstead's 2 for D19 and D4
    // being Dairy. The two cards point in opposite directions on one tableau.
    // ⛔ Ticket 07's starter clause is now unconditional: a starter prints the
    // generic starting-building icon for the whole game, so it belongs to no
    // crop and there is no flipped face left to give it one.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(4);
  });

  /**
   * ⭐ R13 (tasks/v48-rulings-v2.md, 24/09/2026): a built Power card of a
   * foreign suit now counts for D19, on top of Tier 1-3 buildings; a built
   * Power card of D19's OWN suit still does not (same as a Tier 1-3 card of
   * your own suit never has).
   */
  it('R13: a foreign Power card counts for D19, an own-suit one does not', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W16', 'D16'); // W16 (Wheat Power) and D16 (Dairy Power)
    // D19's 1 for W16 only; D16 is Dairy and does not count for D19. D2 scores
    // 2 for the two Dairy deck cards built (D19, D16) - unaffected by R13, the
    // Barn's own-crop scorer counts every deck card regardless of type.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1 + 2);
  });

  it('D20 scores 1 for every 2 buildings BUILT - never a starter', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D10', 'D4');
    // D20, D10 and D4 built; D20 is itself an Endgame card and, both before
    // and after R13, never counts toward its own total - D10 and D4 are the
    // whole count (2), and the divisor of 2 the rebalance added rounds it to
    // 1. D2 adds its flat 3 for the three Dairy deck cards.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1 + 3);
    // A fourth Tier 1-3 building is what actually pays for the second point.
    buildFor(data, s, DAIRY, 'D5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1 + 4);
  });

  /** R13: a built Power card counts toward D20's total too. */
  it('R13: a built Power card counts toward D20', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D4', 'D16'); // D16 The Ledger, a Power card
    // D20 counts D4 and D16 - 2, divisor 2 - so 1; D2 scores 3 for the three
    // Dairy deck cards built.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1 + 3);
  });

  /**
   * ⭐ D21 IS RETEXTED AGAIN (v41): "3 VP for each 3VP building you have
   * built", of any suit. It used to count SHEDs at 2 VP each. Printed VP is
   * read off the card, buildings only.
   */
  it('D21 scores 3 for each 3VP building built, of any suit', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21');
    // D2's 1 for D21 itself, and no 3VP building yet.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
    buildFor(data, s, DAIRY, 'D13', 'W13', 'D4');
    // D21's 6 for D13 and W13 (D4 prints 1 VP), plus D2's 3 for D21, D13, D4.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(6 + 3);
  });

  it('D21: a 2VP building and a Power card score nothing for it', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D10', 'D16');
    // No 3VP building at all, so D21 contributes 0 and D2's 3 is the whole score.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(3);
  });

  /**
   * ⛔ A DEMOLISHED BUILDING STOPS COUNTING, which is the cost of demolishing and
   * the standing reading every "you have built" formula in the suit shares.
   */
  it('D21 does not count a demolished 3VP building', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D14');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(3 + 2);
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D14');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
  });

  /** A starter is never a building you have built, whatever it prints. */
  it('D21 never counts a starter', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1); // D2's own line only
  });
});

/**
 * ⭐ R13 (tasks/v48-rulings-v2.md, 24/09/2026): "a building you have built"
 * counts a built Power card for D6/D9/D13/D19/D20 (this file) and W19/W20
 * (wheat.test.ts) - COUNTS ONLY. `builtBuildingsAndPower` (buildings.ts) is a
 * deliberately separate helper from every TARGET list (`ownBuildings` and
 * everything built on it), so a Power card counted above must still never be
 * reachable as a sow, Grow, Harvest, activation or stack target.
 */
describe('R13: Power cards count, but only for counts', () => {
  it('a built Power card is never offered as a GROW target, even though it now counts elsewhere', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6', 'D16'); // D16 The Ledger, a Power card
    dealTo(data, s, DAIRY, 'W4');
    // D16 counts toward D6's draw (see the R13 test above), but a Power card
    // has no threshold and no stack, so it is never a legal GROW target.
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D16')).toBe(false);
  });

  /**
   * ⚠️ D14's own target list (the file-local `builtBuildings`, dairy.ts) is
   * DELIBERATELY left untouched by this pass - see that function's own doc
   * comment - so R13 does not WIDEN it. It is worth being honest about what
   * that preserves rather than fixes: `builtBuildings` already offered Power
   * AND Endgame cards as demolish targets BEFORE this pass (it filters only
   * `type !== 'starter'`), which is arguably its own gap against the rule
   * book's base definition of a building (never a Power or Endgame card) and
   * predates R13 entirely. Out of scope for this pass - D14 is not one of the
   * three retexted cards and R13 does not name it - and reported rather than
   * silently fixed or silently made worse.
   */
  it('D14 The Cream Refinery: R13 does not widen its target list further (still offers Power and Endgame cards, a pre-existing gap)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D16', 'D19'); // a Power card and an Endgame card
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const targets = pendingAnswers(data, grown.state).flatMap((a) =>
      a.kind === 'card' ? [a.payload.card as CardId] : [],
    );
    // Same set R13 finds it in: builtBuildings still reads `type !== 'starter'`
    // and nothing about that changed here.
    expect(targets.sort()).toEqual(['D14', 'D16', 'D19'].sort());
  });
});

describe('the SHED keyword - no card reads it since v41 (kept for the simulator)', () => {
  it('SHED means exactly the five Tier 1 cards', () => {
    const sheds = data.cards.catalogue
      .filter((c) => c.suit === 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(sheds).toEqual(['D4', 'D5', 'D6', 'D7', 'D8']);
    // ⚠️ The hazard the keyword reading carries: any future card named
    // "... Shed" joins the set silently. Nothing outside Dairy carries it today.
    // ⛔ THE READER CHANGED TWICE. D21 The Refinery read it until the rebalance
    // repointed it at upgraded starter faces (2026-08-12), leaving D1's build
    // rider as the only caller; v31 deletes the Barn rider and gives D21 the
    // SHED count back, so D21 is the single reader again.
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
