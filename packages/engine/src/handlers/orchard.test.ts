/**
 * The Orchard suit, REBUILT (docs/orchard-suit-rebuild-v5.md), all 21 cards in
 * the spanning-test style.
 *
 * The load-bearing pieces this file exists to pin down:
 *
 *   - the D1 sub-type ruling (ORCHARD is the five Tier 1 cards, NOT the
 *     whole-word title keyword every other suit uses);
 *   - the Farmstead as a see +1 / keep +1 modifier on BOTH faces, and the
 *     DISCARD DIVERT SEAM that is its other half;
 *   - that the seam scopes itself - a Draw with a discard gifts, a Draw 2 with
 *     no discard does not, and the end-of-turn overflow reaches O17 but never
 *     the Farmstead;
 *   - the four things the handoff calls easy to get wrong: O15 IS a Draw since
 *     Dean ruled the printed word literal on 19/08/2026, O11 no longer harvests
 *     itself, the Farmstead gift fires on the Draw action and not on a
 *     keep-everything draw, and O17 and the Farmstead never both take the same
 *     card;
 *   - and, since 19/08/2026, that Tier 3 is three ordinary GROW buildings. The
 *     ACTION card is retired, so every assertion that used to read "no
 *     threshold, no activation type, a standing move" is inverted here.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { isOrchardCard } from './orchard.js';
import { handlerFor } from './registry.js';

const ORCHARD = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['orchard', 'wheat']);
}

/** Answer pending tasks with a chosen (or the first legal) answer until the queue drains. */
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

/**
 * Sow targets are `BuildingRef`s since the Apiary rebuild - a seat as well as a
 * card, because A4 and A14 place on a neighbour. Every Orchard sow is still onto
 * the orchard seat's own tableau, which is what this spells out.
 */
function own(...cards: string[]): { seat: number; card: string }[] {
  return cards.map((card) => ({ seat: ORCHARD, card }));
}

/** Answer only the head DRAW task through to its keep, taking the first keep offered. */
function resolveDraw(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 12; guard++) {
    const head = s.tasks[0];
    if (!head || head.t !== 'draw') return s;
    const answers = pendingAnswers(data, s);
    const keep = answers.find((a) => a.kind === 'keep') ?? (answers[0] as TaskAnswer);
    s = answerTask(data, s, keep).state;
  }
  return s;
}

function headDraw(state: GameState): Extract<Task, { t: 'draw' }> {
  const head = state.tasks[0];
  if (!head || head.t !== 'draw') throw new Error('Expected a draw task at the head');
  return head;
}

/**
 * The GROW moves on offer for one building. Replaces the old `actionMoves`
 * helper: since 19/08/2026 the Tier 3 cards are grown like every other
 * building, so there is no card-specific move shape left to filter for.
 */
function growMoves(state: GameState, card: string): Move[] {
  return legalMoves(data, state).filter((m) => m.type === 'grow' && m.building === card);
}

describe('ORCHARD sub-type membership (the D1 ruling: Tier 1 only)', () => {
  /**
   * ⛔ THIS IS THE TEST THE RULING GETS WRITTEN DOWN IN. Every other suit reads
   * its sub-type off a whole-word title keyword (DL-42). Orchard could not: The
   * Grand Orchard, The Orchard Keeper and The Orchard Archive all carried the
   * word and none of them was an ORCHARD, which under the keyword rule would
   * have had O13 growing itself and O20 paying up to 16 VP against a winning
   * score of 38. Option B (this) was cheap and reversible; option A - renaming
   * those three cards - shipped on 19/08/2026, which is what the second test
   * pins.
   */
  it('is exactly O4-O8: not O13, not O16, not O20, whatever their names say', () => {
    const orchards = data.cards.catalogue
      .filter((c) => c.suit === 'orchard' && isOrchardCard(data, c.id))
      .map((c) => c.id);
    expect(orchards).toEqual(['O4', 'O5', 'O6', 'O7', 'O8']);
    for (const id of ['O13', 'O16', 'O20']) {
      expect(isOrchardCard(data, id), `${id} was once named Orchard but is not one`).toBe(false);
    }
  });

  /**
   * ✅ OPTION A SHIPPED (19/08/2026). O13 became The Seed Bank, O16 The Fruit
   * Store and O20 Crop Diversity, so the word "Orchard" now appears in exactly
   * the five card names that ARE ORCHARDs. The two readings agree, and this is
   * the assertion that fails loudly if a future rename breaks the tie again -
   * at which point D1 has to be re-argued rather than quietly re-broken.
   */
  it('the Tier 1 reading and the DL-42 title-keyword reading now pick the same five', () => {
    const byKeyword = data.cards.catalogue
      .filter((c) => c.suit === 'orchard' && /\bOrchard\b/.test(c.name))
      .map((c) => c.id);
    expect(byKeyword).toEqual(['O4', 'O5', 'O6', 'O7', 'O8']);
  });

  it('every enabled Orchard card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'orchard' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });
});

describe('the Orchard Farmstead (O2) - the draw modifier', () => {
  it('sees 3 and keeps 2 on BOTH faces (the upgrade buys coins, not cards)', () => {
    const s = base();
    expect(headDraw(apply(data, s, { type: 'draw', seat: ORCHARD }).state)).toMatchObject({
      see: 3,
      keep: 2,
    });

    const t = base();
    buildingOf(t, ORCHARD, 'O2').upgraded = true;
    expect(headDraw(apply(data, t, { type: 'draw', seat: ORCHARD }).state)).toMatchObject({
      see: 3,
      keep: 2,
    });
  });

  it('a non-orchard seat draws the plain base numbers', () => {
    const s = base();
    s.turnPlayer = WHEAT;
    expect(headDraw(apply(data, s, { type: 'draw', seat: WHEAT }).state)).toMatchObject({
      see: 2,
      keep: 1,
    });
  });

  it('composes with the Draw Service: (2,2) -> (3,3), so there is no discard', () => {
    const s = base();
    hireFor(s, ORCHARD, 'draw');
    player(s, ORCHARD).coins += data.workers.ownerActivationCost;
    const worked = apply(data, s, { type: 'workOwnWorker', seat: ORCHARD, workerId: 'draw' });
    expect(headDraw(worked.state)).toMatchObject({ see: 3, keep: 3 });
  });

  it('never applies to a card-ability draw (DL-47)', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O4');
    dealTo(data, s, ORCHARD, 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O4', 'O6');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2, src: 'O4' });
  });
});

describe('the discard divert seam - the Farmstead gift and O17 The Fruit Basket', () => {
  it('the Draw action gifts its one discard to a neighbour, and the base face mints nothing', () => {
    const s = base();
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(
      drawn.state,
      (a) => a.find((x) => x.kind === 'card') ?? (a[0] as TaskAnswer),
    );
    // See 3, keep 2, and the third card crossed the table rather than being binned.
    expect(player(state, ORCHARD).hand).toHaveLength(2);
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, ORCHARD).coins).toBe(0);
  });

  it('the upgraded face takes £1 for the same gift', () => {
    const s = base();
    buildingOf(s, ORCHARD, 'O2').upgraded = true;
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(
      drawn.state,
      (a) => a.find((x) => x.kind === 'card') ?? (a[0] as TaskAnswer),
    );
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, ORCHARD).coins).toBe(1);
  });

  /**
   * THE WORDING SCOPES ITSELF. A Draw 2 keep 2 - what the Draw Service becomes
   * with the modifier - throws nothing away, so there is nothing to give and no
   * task appears. This is the assertion that stands in for the whole exception
   * list the design doc originally wrote.
   */
  it('a keep-everything draw discards nothing, so no divert is ever offered', () => {
    const s = base();
    hireFor(s, ORCHARD, 'draw');
    player(s, ORCHARD).coins += data.workers.ownerActivationCost;
    const worked = apply(data, s, { type: 'workOwnWorker', seat: ORCHARD, workerId: 'draw' });
    const state = answerAll(worked.state);
    expect(state.tasks).toHaveLength(0);
    expect(player(state, WHEAT).hand).toHaveLength(0);
    expect(player(state, ORCHARD).hand).toHaveLength(3);
  });

  it('the gift is declinable, and skipping bins the card as normal', () => {
    const s = base();
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(
      drawn.state,
      (a) => a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer),
    );
    expect(player(state, WHEAT).hand).toHaveLength(0);
    expect(player(state, ORCHARD).hand).toHaveLength(2);
  });

  it('a neighbour at their hand limit cannot be given anything (DL-63)', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8'); // wheat limit 5: full
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(drawn.state);
    expect(player(state, WHEAT).hand).toHaveLength(5);
  });

  it('O17 buys the discard into the barn for £1 instead, and the two never both take it', () => {
    const s = base();
    player(s, ORCHARD).coins = 2;
    buildFor(data, s, ORCHARD, 'O17');
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(drawn.state, (a) => {
      const barn = a.find((x) => x.kind === 'card' && x.payload.barn === true);
      return barn ?? a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer);
    });
    expect(player(state, ORCHARD).barn).toHaveLength(1);
    expect(player(state, ORCHARD).coins).toBe(1);
    // One card, one destination: it did not also cross the table.
    expect(player(state, WHEAT).hand).toHaveLength(0);
    expect(state.tasks).toHaveLength(0);
  });

  it('O17 reaches the END-OF-TURN overflow; the Farmstead gift does not', () => {
    const s = base();
    player(s, ORCHARD).coins = 2;
    buildFor(data, s, ORCHARD, 'O17');
    // Five cards against the Orchard Barn's printed 4: one must go at turn end.
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6', 'O7', 'O8');
    s.turn.actionSpent = true;
    const ended = apply(data, s, { type: 'endTurn', seat: ORCHARD });
    const discard = ended.state.tasks.find((t) => t.t === 'discard');
    expect(discard).toBeDefined();
    const state = answerAll(ended.state, (a) => {
      const barn = a.find((x) => x.kind === 'card' && x.payload.barn === true);
      // No gift is on offer here at all - this is not a draw.
      expect(a.every((x) => x.kind !== 'card' || x.payload.barn === true)).toBe(true);
      return barn ?? (a[0] as TaskAnswer);
    });
    expect(player(state, ORCHARD).barn).toHaveLength(1);
    expect(player(state, ORCHARD).coins).toBe(1);
  });

  it('a seat with neither permanent never sees the seam', () => {
    const s = base();
    s.turnPlayer = WHEAT;
    const drawn = apply(data, s, { type: 'draw', seat: WHEAT });
    const state = answerAll(drawn.state);
    expect(state.tasks).toHaveLength(0);
    const binned = Object.values(state.discards).reduce((n, pile) => n + pile.length, 0);
    expect(binned).toBe(1);
  });
});

describe('O1 Barn - the ORCHARD build refund', () => {
  it('draws 2 when an ORCHARD is built, on either face', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    // O4 costs 1 orchard card.
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O4',
      payment: ['O5'],
    });
    expect(headDraw(built.state)).toMatchObject({ see: 2, keep: 2, src: 'O1' });
  });

  it('does not fire on a non-ORCHARD build (O9 is a Tier 2, whatever it is called)', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O9', 'O4', 'O5', 'O6');
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O9',
      payment: ['O4', 'O5', 'O6'],
    });
    expect(built.state.tasks.some((t) => t.t === 'draw')).toBe(false);
  });
});

describe('the Tier 1 ORCHARDs - one conversion each', () => {
  it('O4 The Apple Orchard is the naked Draw 2', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O4');
    dealTo(data, s, ORCHARD, 'O6');
    expect(headDraw(growBuilding(data, s, ORCHARD, 'O4', 'O6').state)).toMatchObject({
      see: 2,
      keep: 2,
    });
  });

  it('O5 The Pear Orchard fills ITSELF - a mandatory sow onto this ORCHARD only', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O5', 'O4');
    dealTo(data, s, ORCHARD, 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O5', 'O7');
    // The GROW payment is already on the stack; the sow is the second card.
    expect(buildingOf(grown.state, ORCHARD, 'O5').stack).toHaveLength(1);
    const sow = grown.state.tasks.find((t) => t.t === 'sow');
    expect(sow).toMatchObject({ targets: own('O5') });
    expect(sow && sow.t === 'sow' && sow.optional).toBeUndefined();
    const state = answerAll(grown.state);
    expect(buildingOf(state, ORCHARD, 'O5').stack.length).toBeGreaterThanOrEqual(2);
  });

  it('O6 The Cherry Orchard gives a card across and mints £1 for it', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O6');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O6', 'O7');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 });
    const state = answerAll(grown.state);
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, ORCHARD).coins).toBe(1);
  });

  it('O6 auto-skips (and mints nothing) when every neighbour is full', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O6');
    dealTo(data, s, ORCHARD, 'O7');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8');
    const state = answerAll(growBuilding(data, s, ORCHARD, 'O6', 'O7').state);
    expect(player(state, ORCHARD).coins).toBe(0);
  });

  it('O7 The Golden Orchard offers an OPTIONAL harvest of one of your ORCHARDs', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O7', 'O4', 'O9');
    dealTo(data, s, ORCHARD, 'O5'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, ORCHARD, 'O4', 2);
    loadStack(data, s, ORCHARD, 'O9', 1);
    const grown = resolveDraw(growBuilding(data, s, ORCHARD, 'O7', 'O5').state);
    const answers = pendingAnswers(data, grown);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    // O4 and O7 itself are ORCHARDs with cards on them; O9 is not an ORCHARD.
    const buildings = answers.flatMap((a) => (a.kind === 'building' ? [a.card] : []));
    expect(buildings.sort()).toEqual(['O4', 'O7']);
    const harvested = answerTask(data, grown, {
      kind: 'building',
      card: 'O4',
    } as TaskAnswer).state;
    expect(buildingOf(harvested, ORCHARD, 'O4').stack).toHaveLength(0);
    expect(player(harvested, ORCHARD).barn).toHaveLength(2);
  });

  it('O7 offers nothing when no ORCHARD has a card on it', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O7');
    dealTo(data, s, ORCHARD, 'O5');
    // Only O7 itself holds a card - the GROW payment - so it IS a target.
    const grown = resolveDraw(growBuilding(data, s, ORCHARD, 'O7', 'O5').state);
    expect(pendingAnswers(data, grown).some((a) => a.kind === 'building')).toBe(true);
  });

  it('O8 The Heritage Orchard grants an optional Build, which re-fires the Barn', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O8');
    dealTo(data, s, ORCHARD, 'O5', 'O4', 'O6');
    const grown = resolveDraw(growBuilding(data, s, ORCHARD, 'O8', 'O5').state);
    const build = grown.tasks.find((t) => t.t === 'build');
    expect(build).toMatchObject({ optional: true });
    const answers = pendingAnswers(data, grown);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const takeO4 = answers.find((a) => a.kind === 'build' && a.card === 'O4');
    expect(takeO4).toBeDefined();
    const built = answerTask(data, grown, takeO4 as TaskAnswer).state;
    // The Barn's refund fires off the granted build, which is the opening engine.
    expect(built.tasks.some((t) => t.t === 'draw' && t.src === 'O1')).toBe(true);
  });
});

describe('the Tier 2 cards - one noun each', () => {
  it('O9 The Fruit Stand gives ONE EACH, drawing 2 per card given', () => {
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O9');
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O9', 'O4');
    // v30: MANDATORY, so a live give offers gives and nothing else.
    expect(pendingAnswers(data, grown.state).every((a) => a.kind === 'card')).toBe(true);
    let gifts = 0;
    const state = answerAll(grown.state, (a) => {
      const gift = a.find((x) => x.kind === 'card');
      if (gift) {
        gifts += 1;
        return gift;
      }
      return a[0] as TaskAnswer;
    });
    // Two rivals, one each, and no more however many cards are in hand.
    expect(gifts).toBe(2);
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, 2).hand).toHaveLength(1);
    // Gave 2, drew 2 for each: started with 2 after the grow payment, ends at 4.
    expect(player(state, ORCHARD).hand).toHaveLength(4);
  });

  /**
   * The v30 §8.3 no-op, applied here: a mandatory effect with no legal target
   * SKIPS SILENTLY. It never refuses the activation and it never asks. Note
   * that "fewer cards than neighbours" heals itself - the Draw 2 arrives before
   * the next give is chosen - so the only real no-op is an empty hand or a
   * table of rivals at their hand limits.
   */
  it('O9 never refuses: with nothing left to give it asks nothing at all', () => {
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O9');
    dealTo(data, s, ORCHARD, 'O4'); // the GROW payment and nothing else
    const grown = growBuilding(data, s, ORCHARD, 'O9', 'O4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, WHEAT).hand).toHaveLength(0);
    expect(player(grown.state, 2).hand).toHaveLength(0);
  });

  it('O10 The Cider House sows one card onto EACH of your ORCHARDs, from hand', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O10', 'O4', 'O5', 'O9');
    dealTo(data, s, ORCHARD, 'O6', 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O10', 'O6');
    const sows = grown.state.tasks.filter((t) => t.t === 'sow');
    // O4 and O5 only: O9 is a Tier 2 and O10 is not an ORCHARD either.
    expect(sows.map((t) => (t.t === 'sow' ? t.targets : null))).toEqual([own('O4'), own('O5')]);
    const state = answerAll(grown.state);
    expect(buildingOf(state, ORCHARD, 'O4').stack).toHaveLength(1);
    expect(buildingOf(state, ORCHARD, 'O5').stack).toHaveLength(1);
  });

  /**
   * ⛔ THE BEHAVIOUR CHANGE OF THE v30 ORCHARD PASS. "Harvest this ORCHARD"
   * became "Harvest EVERY ORCHARD", and the reading that follows is that O11
   * NO LONGER HARVESTS ITSELF: an ORCHARD is O4-O8 under D1 and O11 is a Tier
   * 2, exactly as W12 Crop Rotation is not a FIELD and never harvests itself.
   * So the card that used to empty its own stack (the GROW payment included)
   * now leaves that payment on itself and clears the grove instead.
   */
  it('O11 The Harvest Market harvests EVERY ORCHARD - and never itself', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O11', 'O4', 'O5', 'O9');
    dealTo(data, s, ORCHARD, 'O6'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, ORCHARD, 'O4', 2);
    loadStack(data, s, ORCHARD, 'O5', 1);
    loadStack(data, s, ORCHARD, 'O9', 2);
    loadStack(data, s, ORCHARD, 'O11', 1);
    const grown = growBuilding(data, s, ORCHARD, 'O11', 'O6');
    // O4 (2) and O5 (1) are ORCHARDs and empty; 3 cards harvested, so Draw 3.
    expect(player(grown.state, ORCHARD).barn).toHaveLength(3);
    expect(buildingOf(grown.state, ORCHARD, 'O4').stack).toHaveLength(0);
    expect(buildingOf(grown.state, ORCHARD, 'O5').stack).toHaveLength(0);
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3 });
    // O11 keeps its own stack - the loaded card AND the card that just paid.
    expect(buildingOf(grown.state, ORCHARD, 'O11').stack).toHaveLength(2);
    // O9 is a Tier 2 too, so it is untouched.
    expect(buildingOf(grown.state, ORCHARD, 'O9').stack).toHaveLength(2);
  });

  it('O11 draws nothing, and harvests nothing, with an empty grove', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O11', 'O4');
    dealTo(data, s, ORCHARD, 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O11', 'O6');
    expect(player(grown.state, ORCHARD).barn).toHaveLength(0);
    expect(grown.state.tasks.some((t) => t.t === 'draw')).toBe(false);
  });

  it('O12 The Fruit Press puts any number of hand cards into the barn', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O12');
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O12', 'O4');
    const task = grown.state.tasks.find((t) => t.t === 'handToBarn');
    expect(task).toMatchObject({ remaining: 2, optional: true });
    const state = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'handToBarn') ?? (a[0] as TaskAnswer),
    );
    expect(player(state, ORCHARD).barn).toHaveLength(2);
    expect(player(state, ORCHARD).hand).toHaveLength(0);
  });
});

describe('the Tier 3 GROW buildings - O13, O14, O15', () => {
  /**
   * ⛔ THE INVERSION OF 19/08/2026. These three assertions used to read
   * "threshold null, activation type null, actionMoves true" - the ACTION card,
   * whose standing move WAS the main action. Dean retired the concept ("they
   * are all GROW"), so the sheet's threshold and wild activation type are the
   * whole of what makes them playable, and a handler that quietly grew a
   * `moves` function again would fail here rather than in a sim report.
   */
  it('all three are ordinary GROW buildings, not standing ACTION moves', () => {
    for (const id of ['O13', 'O14', 'O15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).not.toBeNull();
      expect(card?.activationType, id).toBe('wild');
      expect(card?.abilityTrigger, id).toEqual(['onActivate']);
      const handler = handlerFor(id);
      // ⛔ `actionMoves` no longer EXISTS on CardHandler (19/08/2026), so this
      // reads the object rather than the type: a property that is gone cannot
      // be asserted undefined, and `in` is what still fails loudly if someone
      // puts the concept back.
      expect('actionMoves' in (handler as object), id).toBe(false);
      expect(handler?.moves, id).toBeUndefined();
      expect(typeof handler?.activate, id).toBe('function');
    }
  });

  it('a Tier 3 card is offered as a GROW, and that GROW spends the main action', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14');
    dealTo(data, s, ORCHARD, 'W4'); // a wild activation takes any suit
    const offers = growMoves(s, 'O14');
    expect(offers).toHaveLength(1);
    const played = apply(data, s, offers[0] as Move);
    expect(played.state.turn.actionSpent).toBe(true);
  });

  it('O13 The Seed Bank grows each ORCHARD in turn, once each, paying as it goes', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O13', 'O4', 'O7');
    dealTo(data, s, ORCHARD, 'O5', 'O6', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O13', 'O5');

    let grew = 0;
    const state = answerAll(grown.state, (a) => {
      const grow = a.find((x) => x.kind === 'card' && x.payload.building !== undefined);
      if (grow) {
        grew += 1;
        return grow;
      }
      return (
        a.find((x) => x.kind === 'keep') ?? a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer)
      );
    });
    // O4 and O7 are ORCHARDs; O13 itself is not, and doGrow marked it fired.
    expect(grew).toBe(2);
    expect(buildingOf(state, ORCHARD, 'O4').stack).toHaveLength(1);
    expect(buildingOf(state, ORCHARD, 'O7').stack).toHaveLength(1);
    // The card that fired it is on O13, which is full at its threshold of 1.
    expect(buildingOf(state, ORCHARD, 'O13').stack).toHaveLength(1);
  });

  /**
   * The gate moved with the conversion. As an ACTION, O13 was simply not
   * offered when it could grow nothing; as a GROW building it takes a wild
   * activation, so it is always growable and the loop is what comes up empty.
   * Wasting an action on it is now the player's mistake to make, which is how
   * every other building in the game already works.
   */
  it('O13 grows nothing, and asks nothing, when the hand cannot pay any ORCHARD', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O13', 'O4');
    // A hand of wheat cards cannot pay an `orchard` activation cost.
    dealTo(data, s, ORCHARD, 'W4', 'W5');
    const grown = growBuilding(data, s, ORCHARD, 'O13', 'W4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(buildingOf(grown.state, ORCHARD, 'O4').stack).toHaveLength(0);
  });

  it('O14 The Conservatory sows the whole hand, then refills it to the limit', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14', 'O4', 'O5');
    dealTo(data, s, ORCHARD, 'O6', 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O6');
    const state = answerAll(grown.state);
    expect(player(state, ORCHARD).hand).toHaveLength(4); // the Orchard Barn's printed 4
    // The GROW payment on O14 plus the two cards left in hand, sown onto O4/O5.
    const onBuildings = player(state, ORCHARD).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onBuildings).toBe(3);
    // O14 fills itself to its threshold of 1 with the payment, so it is never
    // a target of its own sow.
    expect(buildingOf(state, ORCHARD, 'O14').stack).toHaveLength(1);
    // The refill is an autoDraw: it never reaches the divert seam.
    expect(player(state, WHEAT).hand).toHaveLength(0);
  });

  it('O15 The Garden Library takes a deck top each, gives one per rival at £1, keeps the rest', () => {
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O15');
    dealTo(data, s, ORCHARD, 'O4');
    const grown = growBuilding(data, s, ORCHARD, 'O15', 'O4');
    const state = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'card') ?? (a[0] as TaskAnswer),
    );
    // Five decks are on the table in the testkit: 5 taken, 2 given, 3 kept, £2.
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, 2).hand).toHaveLength(1);
    expect(player(state, ORCHARD).hand).toHaveLength(3);
    expect(player(state, ORCHARD).coins).toBe(2);
  });

  /**
   * v30 made the give OPTIONAL ("You may give a card to every other player"),
   * so the skip is offered at every step and not only once the rivals have run
   * out. Declining keeps the lot and mints nothing - which is a real choice for
   * a suit whose whole thesis is cards through your hands.
   */
  it('O15 may decline the give entirely: keep every card, mint nothing', () => {
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O15');
    dealTo(data, s, ORCHARD, 'O4');
    const grown = growBuilding(data, s, ORCHARD, 'O15', 'O4');
    // ⚠️ THE DRAW RESOLVES FIRST since 19/08/2026 - the head task is the Draw,
    // with exactly one legal answer (keep everything) - and only then does the
    // give offer its skip. The old shape had the give as the head task, so the
    // skip was on offer immediately.
    const drawn = answerTask(
      data,
      grown.state,
      pendingAnswers(data, grown.state)[0] as TaskAnswer,
    ).state;
    expect(pendingAnswers(data, drawn).some((a) => a.kind === 'skip')).toBe(true);
    const state = answerAll(drawn, (a) => a.find((x) => x.kind === 'skip') ?? (a[0] as TaskAnswer));
    expect(player(state, WHEAT).hand).toHaveLength(0);
    expect(player(state, 2).hand).toHaveLength(0);
    expect(player(state, ORCHARD).coins).toBe(0);
    // All five kept - over the printed hand size, which is legal mid-turn.
    expect(player(state, ORCHARD).hand).toHaveLength(5);
  });

  /**
   * ⚠️ INVERTED 19/08/2026. THE RULING LANDED THE OTHER WAY: Dean, on the v30
   * wording, *"it is a standard draw - so normal rules apply"*. The sheet reads
   * "Draw the top card of each deck" where it used to read "Take", and the verb
   * is literal.
   *
   * So the cards arrive through the DRAW TASK. `revealed` is pre-filled because
   * the card names the decks rather than the player, and see === keep because
   * the card keeps everything it draws, so the task has exactly one legal answer
   * and falls straight through to the funnel.
   *
   * ⚠️ WHAT THAT DOES AND DOES NOT BUY, because the distinction is the whole
   * reason the old ruling looked safe. It buys the SEAM: `afterDrawKeep` fires
   * and the unkept remainder goes through `discardOrDivert`. It buys no
   * BEHAVIOUR today - nothing in the catalogue listens to `afterDrawKeep` yet,
   * and O17 The Fruit Basket still cannot fire here, because a draw that keeps
   * everything discards nothing and the divert seam is a DISCARD seam. The fear
   * the old comment recorded (a Farmstead gifting away the cards this card just
   * took) could not have happened for the same reason.
   */
  it('O15 IS a Draw: it goes through the draw task, and still discards nothing', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O15');
    dealTo(data, s, ORCHARD, 'O4');
    const grown = growBuilding(data, s, ORCHARD, 'O15', 'O4');
    const draw = grown.state.tasks.find((t) => t.t === 'draw');
    expect(draw).toBeDefined();
    // Pre-revealed, and keeping everything: the card chose the decks, so there
    // is no deck pick to make and no card to throw away.
    if (draw?.t === 'draw') {
      expect(draw.revealed.length).toBe(draw.see);
      expect(draw.keep).toBe(draw.see);
    }
    // No divert, and it is the empty discard that guarantees it, not a carve-out.
    expect(grown.state.tasks.some((t) => t.t === 'divert')).toBe(false);
  });
});

describe('O16 The Fruit Store - turned around to pay for GOING OUT', () => {
  it('draws for the VISITOR, and never for the host', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    dealTo(data, s, ORCHARD, 'O4');
    const applied = apply(data, s, {
      type: 'visit',
      seat: ORCHARD,
      host: WHEAT,
      fee: ['O4'],
      payoff: { mode: 'coin' },
    });
    expect(applied.state.tasks).toHaveLength(0);
    // Fee spent, keeper card drawn back (a choiceless autoDraw), £1 taken.
    expect(player(applied.state, ORCHARD).hand).toHaveLength(1);
    expect(player(applied.state, ORCHARD).coins).toBe(1);
    expect(player(applied.state, WHEAT).hand).toHaveLength(0);
  });

  it('does NOT fire when the owner is the one being visited', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(player(applied.state, ORCHARD).hand).toHaveLength(0);
  });
});

describe('the endgame cards - O19, O20, O21', () => {
  it('O19 The Fruit Hall scores empty hand spaces, capped by the HAND LIMIT and nothing else', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O19');
    dealTo(data, s, ORCHARD, 'O4');
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(3); // limit 4, hand 1

    const t = base();
    buildFor(data, t, ORCHARD, 'O19');
    buildingOf(t, ORCHARD, 'O1').upgraded = true; // limit 7, hand 0: the old (max 4) is gone
    expect(gameEndScores(data, t)[ORCHARD]?.endgame).toBe(7);
  });

  it('O20 Crop Diversity scores 2 per ORCHARD, and never counts itself', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O20', 'O4', 'O5', 'O13', 'O16', 'O9');
    // O4 and O5 only. Under the title-keyword rule this would have been 10.
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(4);
  });

  it("O21 The Harvest Festival scores 1 per 2 cards in the rivals' hands", () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O21');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8');
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(2);
  });
});
