/**
 * The Orchard suit, REBUILT (docs/orchard-suit-rebuild-v5.md), all 21 cards in
 * the spanning-test style.
 *
 * The load-bearing pieces this file exists to pin down:
 *
 *   - the D1 sub-type ruling (ORCHARD is the five Tier 1 cards, NOT the
 *     whole-word title keyword every other suit uses);
 *   - ⛔ the Farmstead as a see +1 / keep +1 modifier and the DISCARD DIVERT
 *     SEAM that was its other half: both gone in v31, and the block that
 *     replaced them records what they proved;
 *   - ⛔ that the seam scoped itself - a Draw with a discard gifted, a Draw 2
 *     with no discard did not, and the end-of-turn overflow reached O17 but
 *     never the Farmstead. The Farmstead's half is gone and O17 listens to build
 *     payments now, but the OVERFLOW IS LIVE AGAIN (the hand limit came back on
 *     02/09/2026), so the seam still reaches the turn boundary;
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
import { buildFor, dealTo, loadStack, makeState } from '../testkit.js';
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

/**
 * ⛔ THE ORCHARD FARMSTEAD HAD MORE MACHINERY THAN ANY OTHER CARD IN THE GAME
 * AND ALL OF IT IS GONE (v31, 02/09/2026). Two describe blocks - the draw
 * modifier and the discard divert seam - collapse to the one below, and what
 * they pinned is recorded here because two of the three findings are RULINGS
 * that outlive the card.
 *
 *   1. **`withDrawModifier`** (query.ts) was the numbers half: see +1 AND keep
 *      +1 on both faces, so the base Draw read (2,1) -> (3,2) and the Orchard
 *      door (3,3) -> (4,4). THE RULING THAT SURVIVES IT: a draw modifier
 *      attaches to the ACTION and never to card text that happens to say
 *      "Draw" (DL-47), or every ability in the suit fires it too. Four tests
 *      go, including the one that pinned DL-47 - and DL-47 itself is now
 *      unpinnable, because there is no modifier left for a card-ability draw to
 *      wrongly inherit.
 *   2. **`drawGiftPower` and the `divert` task's gift branch** were the other
 *      half: "when one of your draws discards a card, give it to a neighbour
 *      instead". THE RULING THAT SURVIVES IT is the best thing in the card:
 *      THE WORDING SCOPED ITSELF, with no exception list at all. A see-2-keep-1
 *      draw had exactly one discard to give; a keep-everything draw had none;
 *      the end-of-turn overflow was not a draw. That closed the
 *      give-four-cards-for-four-coins exploit for free. In v31 the base Draw
 *      keeps both cards, so there would have been nothing to give in any case.
 *   3. **DL-63**, "a gift never forces an out-of-turn discard", had one test
 *      here. It went moot when v31 deleted the hand limit and is LIVE AGAIN
 *      since 02/09/2026: a rival at `rules.turn.handLimit` drops out of every
 *      giveable list. The test for it is under O9, below.
 *
 * Six tests are deleted with the two mechanisms. The seam itself is not: the
 * `divert` task and `discardOrDivert` are still in the engine with no card
 * declaring `divertsDiscard`, waiting for the next card that prints "whenever
 * you discard".
 */
describe('the Orchard Farmstead (O2) - the own-crop end-game scorer', () => {
  /**
   * The plain printed numbers, for every seat alike. The Orchard seat's Draw
   * used to be (3,2) where everybody else's was (2,1); it is (2,2) now, like
   * everybody else's, and the equality between the two halves is what says the
   * modifier is gone rather than merely quiet.
   */
  it('an Orchard seat draws the plain base numbers, exactly like everybody else', () => {
    const s = base();
    expect(headDraw(apply(data, s, { type: 'draw', seat: ORCHARD }).state)).toMatchObject({
      see: 2,
      keep: 2,
    });

    const t = base();
    t.turnPlayer = WHEAT;
    expect(headDraw(apply(data, t, { type: 'draw', seat: WHEAT }).state)).toMatchObject({
      see: 2,
      keep: 2,
    });
  });

  /**
   * THE ORCHARD DOOR IS DRAW 3 AND IS THE ONE EXCEPTION IN AN OTHERWISE FLAT
   * SET (workers.json, v31). It is defended by arithmetic: the bonus slot's
   * other option is a free Draw 1, so a plain Draw 2 door would cost 1 card and
   * return 2 - exactly what the free option gives for nothing - and would be
   * strictly worse than its own alternative. Draw 3 nets +2.
   *
   * It used to compose with the Farmstead to (4,4). Nothing composes now, so
   * this is the printed number and only the printed number, which is precisely
   * the drift a "tidy it to 2 for consistency" edit would introduce silently.
   */
  it('the Orchard door is a flat Draw 3, keep 3, with nothing composing on top', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O4');
    const visited = apply(data, s, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O4' });
    expect(headDraw(visited.state)).toMatchObject({ see: 3, keep: 3 });
  });

  /**
   * ⛔ AND THE BASE DRAW THROWS NOTHING AWAY, which is what deleted the gift's
   * whole scoping argument. See 2, keep 2: the queue drains with no divert task
   * ever offered and nothing in any discard pile.
   */
  it('the base Draw keeps both cards, so no discard and no divert ever appears', () => {
    const s = base();
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    expect(drawn.state.tasks.some((t) => t.t === 'divert')).toBe(false);
    const state = answerAll(drawn.state);
    expect(player(state, ORCHARD).hand).toHaveLength(2);
    expect(player(state, WHEAT).hand).toHaveLength(0);
    const binned = Object.values(state.discards).reduce((n, pile) => n + pile.length, 0);
    expect(binned).toBe(0);
  });

  /**
   * THE SCORER, with the two readings that matter: starters count for nothing
   * (they print the generic starting-building icon, `query.cropOf`) and a
   * foreign crop counts for nothing either.
   */
  it('O2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O4', 'O9', 'W4');
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(2);
  });

  it('O2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[ORCHARD]?.endgame).toBe(0);
  });
});

/**
 * ⛔ THE BARN PRINTS NOTHING (v31), so the refund block becomes a block that
 * pins its absence. "When you build an ORCHARD, Draw 2" was the biggest of the
 * five Barn riders and it is what made a 2-cost ORCHARD card-neutral to build
 * and the 1-cost Apple card-POSITIVE. Every ORCHARD is card-negative to build
 * now, which is the first thing to look at if the suit reads slow.
 */
describe('O1 Barn - the ORCHARD build refund, deleted', () => {
  it('draws nothing when an ORCHARD is built', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    // O4 costs 1 orchard card.
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O4',
      payment: ['O5'],
    });
    expect(built.state.tasks.some((t) => t.t === 'draw')).toBe(false);
    expect(handlerFor('O1')?.on).toBeUndefined();
  });

  it('does not fire on a non-ORCHARD build either (O9 is a Tier 2, whatever it is called)', () => {
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

  /**
   * ⛔ The £1 is a Draw 1 (v31, plan section 3.3). The shape is unchanged - the
   * refund fires only when a card actually crosses - but the arithmetic is: the
   * give is now card-neutral rather than a real trade, so the cross-table half
   * costs its owner nothing at all.
   */
  it('O6 The Cherry Orchard gives a card across and draws 1 back for it', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O6');
    dealTo(data, s, ORCHARD, 'O7');
    const grown = growBuilding(data, s, ORCHARD, 'O6', 'O7');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2 });
    const given = answerAll(grown.state);
    expect(player(given, WHEAT).hand).toHaveLength(1);
    // Draw 2, give 1, draw 1 back: two in hand, not one.
    expect(player(given, ORCHARD).hand).toHaveLength(2);
  });

  /**
   * ⚠️ THIS TEST'S SUBJECT MOVED and then half of it moved back. It was
   * "auto-skips when every neighbour is FULL" - DL-63, a gift never forces an
   * out-of-turn discard - which went moot when v31 deleted the hand limit. The
   * limit is back (02/09/2026) and so is DL-63, but this test keeps the case it
   * was rewritten to cover: an empty HAND, which is the other way the target
   * list empties and the one that does not depend on a rule that has now been
   * deleted and restored once. The full-rivals case is tested under O9.
   */
  it('O6 auto-skips (and draws nothing back) with no card left to give', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O6');
    dealTo(data, s, ORCHARD, 'O7');
    // Empty every deck AFTER the payment is in hand: the Draw 2 finds nothing,
    // so the hand is empty when the give enumerates and the task drops itself.
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const state = answerAll(growBuilding(data, s, ORCHARD, 'O6', 'O7').state);
    expect(player(state, WHEAT).hand).toHaveLength(0);
    expect(player(state, ORCHARD).hand).toHaveLength(0);
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

  /**
   * ⛔ THE BARN NO LONGER RE-FIRES OFF IT (v31). This test was called "which
   * re-fires the Barn" and its last line was the point of it: a granted build
   * went through the same `afterBuild` funnel as the action, so O1's refund
   * paid out on it and the pair was the suit's opening engine. The Barn prints
   * nothing now, so what is left is the GRANT itself - optional, a real Build,
   * enumerated off the shared option set - and the assertion inverts to pin
   * that no refund arrives.
   */
  it('O8 The Heritage Orchard grants an optional Build; no Barn refund follows it', () => {
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
    expect(built.players[ORCHARD]?.tableau.some((b) => b.card === 'O4')).toBe(true);
    expect(built.tasks.some((t) => t.t === 'draw' && t.src === 'O1')).toBe(false);
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
   * table of rivals at their hand limits. Both are tested: this one is the empty
   * hand, and the one below it is DL-63.
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

  /**
   * ⭐ DL-63, LIVE AGAIN (02/09/2026): a gift never forces an out-of-turn
   * discard, so a rival already at `rules.turn.handLimit` is not a legal
   * recipient. With every rival full, O9 has nowhere to give and skips silently
   * by the same v30 §8.3 rule as the empty hand above.
   *
   * The rule is not politeness. Without it O6 and O9 stop being gifts and become
   * a way to make a neighbour discard at their own turn boundary, which is a
   * different card - and a much nastier one - than "your junk is their
   * treasure".
   */
  it('O9 gives nothing to a rival already at the hand limit (DL-63)', () => {
    const limit = data.rules.turn.handLimit as number;
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O9');
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    dealTo(data, s, WHEAT, ...s.decks.wheat.slice(0, limit));
    dealTo(data, s, 2, ...s.decks.vegetable.slice(0, limit));
    const grown = growBuilding(data, s, ORCHARD, 'O9', 'O4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, WHEAT).hand).toHaveLength(limit);
    expect(player(grown.state, 2).hand).toHaveLength(limit);
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

  /**
   * ⭐ RULED AND RETEXTED (Dean, v32): "then draw until your hand is full"
   * becomes a flat DRAW 4. The engine had had to pick a reading when v31 deleted
   * the hand limit, and refilled to `rules.setup.startingHand`.
   *
   * ⚠️ THE TWO ARE THE SAME NUMBER ONLY IN THIS FIXTURE, which is why the case
   * below it exists. Sowing the whole hand empties it, so "back up to 4" and
   * "draw 4" agree. They agree nowhere else.
   */
  it('O14 The Conservatory sows the whole hand, then draws 4', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14', 'O4', 'O5');
    dealTo(data, s, ORCHARD, 'O6', 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O6');
    const state = answerAll(grown.state);
    expect(player(state, ORCHARD).hand).toHaveLength(4);
    // The GROW payment on O14 plus the two cards left in hand, sown onto O4/O5.
    const onBuildings = player(state, ORCHARD).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onBuildings).toBe(3);
    // O14 fills itself to its threshold of 1 with the payment, so it is never
    // a target of its own sow.
    expect(buildingOf(state, ORCHARD, 'O14').stack).toHaveLength(1);
    // ⛔ The refill was an autoDraw, which by construction never fired
    // afterDrawKeep. A printed "Draw" goes through the see-N/keep-N task, so the
    // player picks the decks - and it still hands nothing to a neighbour,
    // because a keep-everything draw discards nothing.
    expect(player(state, WHEAT).hand).toHaveLength(0);
  });

  /**
   * ⭐ THE CASE THE v32 RULING ACTUALLY CHANGED, and the only one where the two
   * readings disagree: THE SOW CANNOT PLACE EVERYTHING.
   *
   * A refill drew fewer here, one short for every card the sow could not shift,
   * so a clogged farm punished the card twice over - it sowed less AND drew
   * less. A flat Draw 4 draws four regardless, which makes the Conservatory
   * STRONGEST in exactly the position where it used to be weakest.
   */
  it('O14 draws 4 even when the sow could not place a single card', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14', 'O4');
    // Deal BEFORE loading: loadStack eats deck tops.
    dealTo(data, s, ORCHARD, 'O6', 'O7', 'O8');
    // Clog every building that could have taken a card. O1 the Barn and O2 the
    // Farmstead print no threshold and were never targets; O3 the Notice Board
    // and O4 are, so both are filled.
    loadStack(data, s, ORCHARD, 'O3', 2, 'wheat');
    loadStack(data, s, ORCHARD, 'O4', 3, 'wheat');

    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O6');
    // O14 itself is full on the GROW payment, so there is nowhere at all to sow:
    // the task's only answer is the draw.
    expect(pendingAnswers(data, grown.state)).toEqual([{ kind: 'skip' }]);

    const state = answerAll(grown.state);
    // O7 and O8 never moved, and four more arrived on top of them. Under the old
    // refill this hand would have stopped at 4 in total, not 6.
    expect(player(state, ORCHARD).hand).toHaveLength(6);
    expect(player(state, ORCHARD).hand).toContain('O7');
    expect(player(state, ORCHARD).hand).toContain('O8');
  });

  /**
   * And the same four cards on a hand that is already large, which is the other
   * half of "the hand is not consulted": a refill to 4 would have drawn NOTHING
   * here.
   */
  it('O14 draws 4 on top of a hand that is already over four', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O14');
    dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6', 'O7', 'O8', 'O9');
    loadStack(data, s, ORCHARD, 'O3', 2, 'wheat'); // the last target, clogged
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O4');
    const state = answerAll(grown.state);
    // Five left in hand after the payment, plus four drawn.
    expect(player(state, ORCHARD).hand).toHaveLength(9);
  });

  it('O15 The Garden Library takes a deck top each, gives one per rival, draws 1 back each', () => {
    const s = makeState(data, ['orchard', 'wheat', 'vegetable']);
    buildFor(data, s, ORCHARD, 'O15');
    dealTo(data, s, ORCHARD, 'O4');
    const grown = growBuilding(data, s, ORCHARD, 'O15', 'O4');
    const state = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'card') ?? (a[0] as TaskAnswer),
    );
    // Five decks are on the table in the testkit: 5 taken, 2 given, 3 kept - and
    // 2 drawn back, one per gift, so the hand is 5 again.
    // ⚠️ THE CARD'S SELF-BALANCING PROPERTY WENT WITH THE COIN. At £1 a gift it
    // was worth about the same at every seat count (2 seats keep 4 and take £1,
    // 4 seats keep 2 and take £3); paying a CARD per gift makes it exactly
    // neutral instead, so the give is now free flavour on "keep the top of
    // every deck".
    expect(player(state, WHEAT).hand).toHaveLength(1);
    expect(player(state, 2).hand).toHaveLength(1);
    expect(player(state, ORCHARD).hand).toHaveLength(5);
  });

  /**
   * v30 made the give OPTIONAL ("You may give a card to every other player"),
   * so the skip is offered at every step and not only once the rivals have run
   * out. Declining keeps the lot and mints nothing - which is a real choice for
   * a suit whose whole thesis is cards through your hands.
   */
  it('O15 may decline the give entirely: keep every card, draw nothing back', () => {
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
    // All five kept and nothing drawn back - the same 5 as the give-everything
    // line above, which is exactly the point: the two branches are now equal in
    // cards and differ only in who holds them.
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
   * and O17 The Fruit Basket still cannot fire here, now for two independent
   * reasons: a draw that keeps everything discards nothing, and since v31 O17 is
   * not on the discard seam at all. The fear
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
    // The Wheat door is a Harvest, so the visitor needs a full building of their
    // own or the door is not offered at all (v31).
    buildFor(data, s, ORCHARD, 'O9');
    loadStack(data, s, ORCHARD, 'O9', 2, 'apiary');
    const applied = apply(data, s, { type: 'visit', seat: ORCHARD, host: WHEAT, fee: 'O4' });
    // Fee spent, keeper card drawn back (a choiceless autoDraw, so it resolves
    // inline and leaves no task), and the harvest the door bought still pending.
    expect(player(applied.state, ORCHARD).hand).toHaveLength(1);
    expect(player(applied.state, WHEAT).hand).toHaveLength(0);
  });

  it('does NOT fire when the owner is the one being visited', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, { type: 'visit', seat: WHEAT, host: ORCHARD, fee: 'W4' });
    expect(player(applied.state, ORCHARD).hand).toHaveLength(0);
  });

  /**
   * ⭐ NEW IN v31, AND IT IS RISK 2 OF THE WHOLE PASS. A seat may place its
   * bonus card on its OWN Notice Board, so "whenever you VISIT a NEIGHBOUR" is
   * a condition this card has to enforce for the first time - before v31 a
   * visitor and a host could never be the same seat, so the word did no work.
   * Without the `event.self` guard this card would draw on every bonus slot its
   * owner ever spends, with nobody else at the table involved at all.
   */
  it('does NOT fire on a SELF-visit: a neighbour means a neighbour', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O16');
    dealTo(data, s, ORCHARD, 'O4');
    const applied = apply(data, s, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O4' });
    // The Orchard door's Draw 3 is queued and nothing has been drawn yet: the
    // hand is empty, where a keeper draw would have left one card in it.
    expect(player(applied.state, ORCHARD).hand).toHaveLength(0);
    expect(applied.state.tasks.map((t) => t.t)).toEqual(['draw']);
  });
});

/**
 * O17 THE FRUIT BASKET, CAPPED RATHER THAN PRICED (Dean, v32). v31 moved the
 * card off the draw discard onto the build payment and deleted its £1, which
 * left it free and taken every time: a card in your barn is delivery fuel where
 * a card in the discard is nothing, so "you may" was a prompt with one sensible
 * answer. The plan named a price as the fix; the ruling is a ONCE-PER-TURN
 * limit, and "you may" goes with it.
 *
 * ⛔ SO THE DECISION IS WHICH SPENT CARD AND ON WHICH BUILD, NOT WHETHER. Both
 * halves are pinned below, and "which build" is a real question because a turn
 * can hold more than one: D12 builds two, D10 and D15 grant builds, and the
 * Dairy door is a Build alongside your own main action.
 */
describe('O17 The Fruit Basket - one spent card into the barn, once a turn', () => {
  it('offers each card a build spent, and puts the chosen one in the barn', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    dealTo(data, s, ORCHARD, 'O9', 'O4', 'O5', 'O6'); // O9 costs 2 orchard + 1 any
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O9',
      payment: ['O4', 'O5', 'O6'],
    });
    const answers = pendingAnswers(data, built.state);
    const offered = answers.flatMap((a) => (a.kind === 'card' ? [a.payload.card] : []));
    expect(offered.sort()).toEqual(['O4', 'O5', 'O6']);

    const taken = answerTask(data, built.state, {
      kind: 'card',
      payload: { card: 'O5' },
    } as TaskAnswer).state;
    expect(player(taken, ORCHARD).barn).toEqual(['O5']);
    expect(taken.discards.orchard).not.toContain('O5');
    // ONE card, and the task is done: the other two stay in the discard where
    // D5 could sow them or D6 give them away. It was re-entrant until v32.
    expect(taken.tasks).toEqual([]);
    expect(taken.discards.orchard.sort()).toEqual(['O4', 'O6']);
  });

  /**
   * ⛔ MANDATORY: "put", not "you may" (v32). Asserting the skip is ABSENT is
   * what stops it drifting back in as a courtesy, and the wording was changed
   * deliberately - with a cap there is no reason to decline, so a prompt that
   * offered one would be a prompt with one sensible answer all over again.
   */
  it('offers no skip: the decision is which card, not whether', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    dealTo(data, s, ORCHARD, 'O4', 'O5');
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O4',
      payment: ['O5'],
    });
    expect(pendingAnswers(data, built.state)).not.toContainEqual({ kind: 'skip' });
    expect(pendingAnswers(data, built.state)).toEqual([{ kind: 'card', payload: { card: 'O5' } }]);
  });

  /**
   * ⭐ THE CAP, AND IT DOES REAL WORK. D12 The Butter Factory builds TWO
   * buildings off one activation, so without the guard an Orchard seat holding a
   * Dairy Tier 2 would bank a card from each payment. The cap goes to the FIRST
   * build of the turn; the way to spend it on a later one is to take that build
   * first, so the choice is expressed in build ORDER rather than in a decline.
   */
  it('fires once a turn, however many builds the turn contains', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17', 'D12');
    // D12 prints activationType 'dairy', so the fee is a Dairy card; the rest
    // is Orchard stock for the two builds it grants.
    dealTo(data, s, ORCHARD, 'D4', 'O4', 'O5', 'O6', 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'D12', 'D4');
    const state = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'build') ?? (a[0] as TaskAnswer),
    );
    // Two buildings landed off one activation, and exactly ONE card reached the
    // barn between them. Without the cap it would have been one per payment.
    const landed = player(state, ORCHARD).tableau.filter((b) =>
      ['O4', 'O5', 'O6', 'O7', 'O8'].includes(b.card),
    );
    expect(landed.length).toBeGreaterThanOrEqual(2);
    expect(player(state, ORCHARD).barn).toHaveLength(1);
    expect(state.turn.firedThisTurn).toContain('O17');
  });

  it('a second Build in the same turn opens no prompt at all', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    dealTo(data, s, ORCHARD, 'O4', 'O5');
    const first = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O4',
      payment: ['O5'],
    });
    const banked = answerTask(data, first.state, {
      kind: 'card',
      payload: { card: 'O5' },
    } as TaskAnswer).state;
    expect(player(banked, ORCHARD).barn).toEqual(['O5']);

    // The guard is turn-scoped, so a hand-built second build inside the same
    // turn queues nothing. (The Build ACTION is spent by now, so this drives the
    // handler through the same hook a granted build would.)
    dealTo(data, banked, ORCHARD, 'O6', 'O7');
    const again = growBuilding(data, banked, ORCHARD, 'O4', 'O6');
    expect(again.state.tasks.filter((t) => t.t === 'card' && t.kind === 'basket')).toEqual([]);
  });

  /**
   * ⛔ THE DRAW'S DISCARD IS NO LONGER ITS BUSINESS, which is the half of the
   * v31 retext a "same seam, new wording" reading would have missed. A
   * see-3-keep-2 card ability throws one card away; under the old text O17 would
   * have bought it, and it must not now.
   */
  it('never reaches a draw discard: only a card you SPEND', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    const drawn = apply(data, s, { type: 'draw', seat: ORCHARD });
    const state = answerAll(drawn.state);
    // Draw 2 keep 2 discards nothing at all, and no divert task was ever
    // offered - the flag that would have produced one is off the card.
    expect(state.tasks).toHaveLength(0);
    expect(player(state, ORCHARD).barn).toEqual([]);
    expect(handlerFor('O17')?.divertsDiscard).toBeUndefined();
  });

  /**
   * ⚠️ A build that spends NOTHING queues nothing, which is the guard on the
   * free-build family (D10, D15, W10) and also what stops the cap being burned
   * by a build that had no payment to divert. There is no free build in the
   * Orchard suit to drive it from here; dairy.test.ts owns that case.
   */
  it('a build with a payment queues exactly one basket task', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O17');
    dealTo(data, s, ORCHARD, 'O9', 'O4', 'O5', 'O6');
    const built = apply(data, s, {
      type: 'build',
      seat: ORCHARD,
      card: 'O9',
      payment: ['O4', 'O5', 'O6'],
    });
    expect(built.state.tasks.filter((t) => t.t === 'card' && t.kind === 'basket')).toHaveLength(1);
  });
});

describe('the endgame cards - O19, O20, O21', () => {
  /**
   * ⛔ REPLACED (v31, plan section 3.2). It scored EMPTY HAND SPACES - "did you
   * convert" - and lost its referent with the hand limit; it now scores the
   * cards themselves, which is the mirror image and states the suit's identity
   * directly.
   *
   * ⚠️ THE DIVISOR IS THE DIAL AND THE PLAN NAMES IT AS THE FIRST THING TO
   * SWEEP. ⭐ Read it against the hand limit, back at a flat 12 since
   * 02/09/2026: the card is CAPPED AT 4 VP, because 12 is the most a seat can be
   * holding when the game is scored. The ramp below runs past that on purpose -
   * the handler must not learn the cap, because the cap is a rule and the card
   * is a division.
   */
  it('O19 The Fruit Hall scores 1 VP for every 3 cards in hand, rounding down', () => {
    const HAND = ['O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10'];
    const ramp: [number, number][] = [
      [0, 0],
      [2, 0],
      [3, 1],
      [5, 1],
      [6, 2],
      [7, 2],
    ];
    for (const [held, expected] of ramp) {
      const s = base();
      buildFor(data, s, ORCHARD, 'O19');
      dealTo(data, s, ORCHARD, ...HAND.slice(0, held));
      // O19's own line, plus O2 the Farmstead's 1 VP for the Orchard card built.
      expect(gameEndScores(data, s)[ORCHARD]?.endgame, `${held} in hand`).toBe(expected + 1);
    }
  });

  it('O20 Crop Diversity scores 2 per ORCHARD, and never counts itself', () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O20', 'O4', 'O5', 'O13', 'O16', 'O9');
    // O4 and O5 only. Under the title-keyword rule this would have been 10.
    // Plus O2 the Farmstead's 6, one per Orchard deck card built - which is
    // exactly the monoculture pull the plan flags as risk 3, visible in one
    // number beside the card that already rewards depth.
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(4 + 6);
  });

  it("O21 The Harvest Festival scores 1 per 2 cards in the rivals' hands", () => {
    const s = base();
    buildFor(data, s, ORCHARD, 'O21');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6', 'W7', 'W8');
    // O21's 2, plus O2's 1 for O21 itself being an Orchard card.
    expect(gameEndScores(data, s)[ORCHARD]?.endgame).toBe(3);
  });
});
