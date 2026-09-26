/**
 * The Apiary suit, all 21 cards, REBUILT (docs/apiary-suit-rebuild-v5.md, the
 * last of the five).
 *
 * The load-bearing pieces this file exists to pin down:
 *
 *   - HIVE is A4 to A8 and NOTHING else: A13 The Queen's Hive is named Hive and
 *     is Tier 3, so `isHiveCard` carries a tier guard;
 *   - an ACTIVATION WITH NO PLACEMENT (A5, A12) advances no stack, matches no
 *     crop, pays no surcharge, and MAY TARGET A FULL BUILDING - never your
 *     Notice Board and never your Service;
 *   - no card's text may fire twice in a turn (`turn.firedThisTurn`);
 *   - the Farmstead modifies the GROW ACTION, not card text that says GROW, so
 *     A5, A6 and A12 do not trigger it, and its draw is a card-ability draw;
 *   - the GROW payment card is ON THE STACK before the ability fires, so A4 and
 *     A15 both count it - the reading a table will ask about;
 *   - A8 pays no coins when there is no legal recipient.
 *
 * The two seams the old Farmstead owned - the suit-wide crop waiver and the
 * free follow-up sow - are both GONE, and the cases that asserted them with
 * them. The waiver survives only on A6; A7 prints the sow.
 *
 * ⛔ REWRITTEN IN PLACES ON 19/08/2026 (the v30 card pass). Two things moved
 * under this file at once. Dean retired the ACTION card - *"The concept of an
 * ACTION was never requested. They are all GROW."* - so A13, A14 and A15 are
 * ordinary GROW buildings and every case that drove them through a `cardMove`
 * now drives them through a GROW. And five Apiary cards changed text: A4 and
 * A15 became inward scalers, A14 became a bare coin scaler, A8's fee doubled
 * and A17 became the market on a card. The cross-table assertions that went
 * with the old A4, A14 and A15 went with them - THE SUIT NOW REACHES ANOTHER
 * SEAT'S ZONES THROUGH A8 AND NOTHING ELSE, and there is a case below that
 * says exactly that, because it is the kind of fact that should fail loudly if
 * anybody re-points a card back across the table without meaning to.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import type { GameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, noticeBoardsOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
  meepleEconomyGame,
  loadStack,
  makeState,
  noMeeples,
  visitMove,
} from '../testkit.js';
import { isHiveCard } from './apiary.js';
import { handlerFor } from './registry.js';

const APIARY = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['apiary', 'wheat']);
}

/**
 * THE MEEPLE ECONOMY, the game as it shipped from 05/09 to 09/09/2026 - and the
 * arm every case whose subject is a VISIT now runs on.
 *
 * ⭐ THE COMMONS HAS NO VISIT TO TEST (09/09/2026). There is no host, so the
 * cards that key on visiting a NEIGHBOUR - A16's rival placement, A17 The Smoke
 * Pot - can only be exercised on a control. That branch is live code and the
 * cards still print the text, so the cases move rather than going away. What a
 * play onto a CENTRAL board does to the same cards is `commons.test.ts`.
 */
const visitArm: GameData = meepleEconomyGame();

function armBase(): GameState {
  const s = makeState(visitArm, ['apiary', 'wheat']);
  // The meeple arm takes its bonus AFTER the action.
  s.turn.actionSpent = true;
  return s;
}

/** Answer pending tasks with a chosen (or the first legal) answer until the queue drains. */
function answerAll(
  state: GameState,
  pick?: (answers: TaskAnswer[]) => TaskAnswer,
  on: GameData = data,
): GameState {
  let s = state;
  for (let guard = 0; guard < 60 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(on, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(on, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function headDraw(state: GameState): Extract<Task, { t: 'draw' }> {
  const head = state.tasks[0];
  if (!head || head.t !== 'draw') throw new Error('Expected a draw task at the head');
  return head;
}

/**
 * Answer a head `draw` task down to nothing, picking the first legal answer
 * at each step (one `deck` per reveal, then one `keep`), and stop the moment
 * something else is at the head. Firing a building that draws (O4's "Draw 3")
 * queues that draw AHEAD of anything a caller pushes after it (`pushTask`
 * appends, so the two land in the order they were pushed), so a case that
 * wants to inspect what follows the draw has to clear it first.
 */
function drainDraw(state: GameState): GameState {
  let s = state;
  while (s.tasks[0]?.t === 'draw') {
    const answer = pendingAnswers(data, s)[0] as TaskAnswer;
    s = answerTask(data, s, answer).state;
  }
  return s;
}

/** How many draw tasks a given card has queued - the Farmstead's counter. */
function drawsFrom(state: GameState, src: string): number {
  return state.tasks.filter((t) => t.t === 'draw' && t.src === src).length;
}

/** Every queued task a given card pushed, whatever its type. */
function tasksFrom(state: GameState, src: string): Task[] {
  return state.tasks.filter((t) => 'src' in t && t.src === src);
}

/** The live activate task, which is the suit's signature seam. */
function activateTask(state: GameState): Extract<Task, { t: 'activate' }> {
  const task = state.tasks.find((t) => t.t === 'activate');
  if (!task || task.t !== 'activate') throw new Error('Expected an activate task');
  return task;
}

/**
 * The GROW move a built Tier 3 offers, if it is live.
 *
 * ⛔ This replaced `actionMoveFor`, which looked for the standing `cardMove` an
 * ACTION card used to contribute. A13, A14 and A15 are ordinary GROW buildings
 * since 19/08/2026, so the question "is this Tier 3 card playable right now" is
 * now answered by the plain GROW enumerator like any other building's.
 */
function growMoveFor(state: GameState, card: string): Move | undefined {
  return legalMoves(data, state).find((m) => m.type === 'grow' && m.building === card);
}

/** Card payloads offered by whatever card task is at the head. */
function offered(state: GameState): Record<string, unknown>[] {
  return pendingAnswers(data, state).flatMap((a) => (a.kind === 'card' ? [a.payload] : []));
}

describe('HIVE sub-type membership (title keyword AND a tier guard)', () => {
  /**
   * ⛔ THE RULING THIS FILE EXISTS TO WRITE DOWN. A13 The Queen's Hive carries
   * the word and is Tier 3, so under the bare keyword rule A10, A14 and A20
   * would all count it. The guard used to be doing a second job as well - A13
   * had no stack, so A9 and A11 would have targeted a building that could hold
   * no cards - and that half lapsed on 19/08/2026 when A13 became an ordinary
   * GROW building with a threshold. The guard stays for the counts.
   */
  it('is exactly A4-A8, and The Queen’s Hive is not one', () => {
    const hives = data.cards.catalogue
      .filter((c) => c.suit === 'apiary' && isHiveCard(data, c.id))
      .map((c) => c.id);
    expect(hives).toEqual(['A4', 'A5', 'A6', 'A7', 'A8']);
    expect(isHiveCard(data, 'A13'), 'A13 is named Hive but is not a HIVE').toBe(false);
  });

  it('every enabled Apiary card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'apiary' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });
});

/**
 * ⛔ THE BARN PRINTS NOTHING (v31), and this one was the odd rider of the five.
 * "When you build a HIVE, sow the top card of any deck onto it" paid in a
 * PLACEMENT rather than a draw, so a new HIVE arrived with a card already on it
 * and was worth firing on the turn it landed. That tempo is gone. Three tests
 * collapse to one that pins the absence.
 */
describe('A1 Barn - the HIVE build rider, deleted', () => {
  it('sows nothing when a HIVE lands', () => {
    const s = base();
    dealTo(data, s, APIARY, 'A4', 'A5', 'A6'); // A4 costs 2 apiary cards
    const built = apply(data, s, {
      type: 'build',
      seat: APIARY,
      card: 'A4',
      payment: ['A5', 'A6'],
    });
    expect(built.state.tasks.some((t) => t.t === 'sowFromDeck')).toBe(false);
    expect(buildingOf(built.state, APIARY, 'A4').stack).toEqual([]);
    expect(handlerFor('A1')?.on).toBeUndefined();
  });
});

/**
 * ⛔ THE APIARY FARMSTEAD'S GROW RIDER IS GONE (v31), and this is the third
 * mechanism the card has lost in three weeks. The base power waived the crop
 * match for the whole suit from turn 1 (Dean: it "trivialises the suit"); the
 * upgraded face queued a free second placement on every GROW, which A7 now
 * prints word for word; and what replaced both on 2026-08-11 was "When you
 * GROW, Draw 1".
 *
 * THE RULING THAT OUTLIVES ALL THREE is the one the deleted tests existed for,
 * so it is written here where the tests were: A SUIT POWER MODIFIES THE ACTION,
 * NEVER CARD TEXT THAT HAPPENS TO USE THE SAME WORD. The seam lived on the GROW
 * ACTION branch in game.ts and never inside `doGrow`, because `doGrow` is also
 * called by A6 The Garden Hive and O13 The Seed Bank - so a seam there would
 * fire once per building grown and The Honey Hut would draw three. Four tests
 * go, one of which was that assertion.
 *
 * ⚠️ AND THE HOLE IS REAL. The rider was "not a consolation prize but a
 * structural necessity": all five Tier 1 HIVEs are card-negative and nothing
 * else in the suit refills the hand. A8 and A14 both gained a Draw in the coin
 * conversion, which is where the refill now sits - on cards a seat has to build,
 * not on a starter live from turn 1.
 */
describe('A2 The Farmstead - the own-crop end-game scorer', () => {
  it('the GROW action draws nothing: the rider is gone', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11'); // no HIVE loaded, so A11 itself queues nothing
    dealTo(data, s, APIARY, 'A4');
    const grown = apply(data, s, {
      type: 'grow',
      seat: APIARY,
      building: 'A11',
      payment: 'A4',
    });
    expect(grown.state.tasks).toHaveLength(0);
    expect(drawsFrom(grown.state, 'A2')).toBe(0);
  });

  /**
   * ⛔ AND THE CROP MATCH IS BACK FOR EVERY APIARY BUILDING. The base power
   * waived it suit-wide from turn 1; since 2026-08-11 it survives on A6 alone,
   * and this pins that an ordinary Apiary building still demands its own crop.
   */
  it('a GROW still needs a matching crop: the suit-wide waiver is long gone', () => {
    const s = base();
    // ⚠️ CARD-ONLY BY CONSTRUCTION. Since 05/09/2026 a meeple of a colour pays
    // wherever a card of that colour would, and every seat starts holding one of
    // each, so the supply would answer the question this case is asking.
    noMeeples(s);
    buildFor(data, s, APIARY, 'A11'); // activationType 'apiary'
    dealTo(data, s, APIARY, 'W4'); // a wheat card, and nothing else
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'A11')).toBe(false);
  });

  it('A2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4', 'A11', 'W4');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(2);
  });

  it('A2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[APIARY]?.endgame).toBe(0);
  });
});

describe('A4 The Herb Hive - the scaler that counts its own stack', () => {
  /**
   * ⚠️ THE READING A TABLE WILL ASK ABOUT. `doGrow` places the payment card on
   * the stack and THEN calls the handler, in that order, so "every card on this
   * building" includes the card you just paid. A fresh Herb Hive draws 1, never
   * 0.
   */
  it('counts the GROW payment card, so a fresh Herb Hive draws 1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A5');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(buildingOf(grown.state, APIARY, 'A4').stack).toEqual(['A5']);
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A4' });
  });

  it('draws 1 for every card on it, the payment included', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A4', 2); // threshold 4, so the payment makes 3
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(buildingOf(grown.state, APIARY, 'A4').stack).toHaveLength(3);
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3, src: 'A4' });
  });

  /**
   * The threshold moved 3 to 4 with the re-point, and that is the whole balance
   * of the card: grown at 3 it pays 4 and clogs itself on the same activation.
   */
  it('threshold 4: grown on a stack of 3 it draws 4 and fills up', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A5', 'A6'); // A6 is the spare, so the hand is not the reason
    loadStack(data, s, APIARY, 'A4', 3);
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(headDraw(grown.state)).toMatchObject({ see: 4, keep: 4 });
    // Full and clogged: no further GROW until it is harvested.
    expect(growMoveFor(grown.state, 'A4')).toBeUndefined();
  });

  /**
   * ⚠️ Fired WITHOUT a placement (A5, A12) there is no payment card, so the
   * count is only what was already there - a real difference between the two
   * routes, and the first card in the suit where the signature "GROW without
   * placing" is WORSE than a plain GROW.
   */
  it('fired by A5 with no placement, it counts only what is already on it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A4');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A4', 2);
    const grown = growBuilding(data, s, APIARY, 'A5', 'A6');
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'A4' });
    expect(buildingOf(fired.state, APIARY, 'A4').stack).toHaveLength(2); // nothing placed
    expect(headDraw(fired.state)).toMatchObject({ see: 2, keep: 2, src: 'A4' });
  });

  /**
   * ⛔ THE SUIT'S ONLY TAKE-FROM-A-RIVAL CARD IS GONE. A4 used to pull a card
   * out of a neighbour's stack into your barn and sow a deck top in its place;
   * after 19/08/2026 it does not touch another seat at all.
   */
  it('never touches a neighbour, however loaded their farm is', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A5');
    loadStack(data, s, WHEAT, 'W4', 2, 'wheat');
    const before = [...buildingOf(s, WHEAT, 'W4').stack];

    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(grown.audit.crossSeat).toBe(false);
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual(before);
    expect(player(grown.state, APIARY).barn).toEqual([]);
    // One draw task and nothing else: no takeFromRival, no replacement sow.
    expect(tasksFrom(grown.state, 'A4').every((t) => t.t === 'draw')).toBe(true);
  });
});

describe('A5 The Meadow Hive - the activation with no placement, then an optional Harvest', () => {
  it('fires another of your buildings, placing nothing on it', () => {
    const s = base();
    // v48: the probe card was A10, whose Draw 3 went with its retext to a
    // visit; O4 The Apple Grove ("Draw 3.") is the same probe, a pure draw.
    buildFor(data, s, APIARY, 'A5', 'O4');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(pendingAnswers(data, grown.state)).toEqual([{ kind: 'activate', card: 'O4' }]);

    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'O4' });
    // O4 fired (Draw 3) with an empty stack, so it is not full: v49's Harvest
    // offer never appears and the draw task is the only thing left.
    expect(buildingOf(fired.state, APIARY, 'O4').stack).toEqual([]);
    expect(headDraw(fired.state)).toMatchObject({ see: 3, keep: 3, src: 'O4' });
  });

  /**
   * ⭐ v49 (24/09/2026, `tasks/v49-rulings-v1.md` R3, carried from A9 by the
   * builder default note): "If it is full, you may Harvest it." A5 places no
   * card, so the target can only be full because it was ALREADY full when
   * fired - which is exactly the FULL-building case the card exists to
   * reach. The offer names that ONE building only, never any other full
   * building the owner might hold.
   */
  it('a FULL building is a legal target, where a GROW refuses it, and firing it then offers to Harvest it', () => {
    const s = base();
    // ⚠️ CARD-ONLY: a meeple-paid GROW places nothing either, so it takes a full
    // building too (R15) and the contrast this case draws would vanish.
    noMeeples(s);
    buildFor(data, s, APIARY, 'A5', 'O4');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'O4', 3); // threshold 3: full and clogged
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'O4')).toBe(false);

    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(pendingAnswers(data, grown.state)).toEqual([{ kind: 'activate', card: 'O4' }]);
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'O4' });
    expect(buildingOf(fired.state, APIARY, 'O4').stack).toHaveLength(3); // no stack advance

    // O4's own ability (Draw 3) is queued first - `pushTask` appends, so what
    // this card's resolver pushes after firing lands BEHIND it - and only
    // once that drains does the optional Harvest offer, O4 only, follow.
    const drawn = drainDraw(fired.state);
    expect(pendingAnswers(data, drawn)).toEqual([
      { kind: 'building', card: 'O4' },
      { kind: 'skip' },
    ]);
    const harvested = answerTask(data, drawn, { kind: 'building', card: 'O4' });
    expect(buildingOf(harvested.state, APIARY, 'O4').stack).toEqual([]);
    expect(player(harvested.state, APIARY).barn).toHaveLength(3);
  });

  it('declining the Harvest offer leaves the building exactly as full as it was', () => {
    const s = base();
    noMeeples(s);
    buildFor(data, s, APIARY, 'A5', 'O4');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'O4', 3);
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'O4' });
    const drawn = drainDraw(fired.state);
    const declined = answerTask(data, drawn, { kind: 'skip' });
    expect(declined.state.tasks).toHaveLength(0);
    expect(buildingOf(declined.state, APIARY, 'O4').stack).toHaveLength(3);
  });

  /** ⛔ Never your Notice Board, never your Service: firing a Service would sell a bonus slot. */
  it('never offers the Notice Board or the Service', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    const targets = pendingAnswers(data, grown.state).flatMap((a) =>
      a.kind === 'activate' ? [a.card] : [],
    );
    expect(targets).toEqual(['A10']);
  });

  it('auto-skips with nothing to fire', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A6 The Garden Hive - the crop waiver, and the only place it survives; then an optional Harvest', () => {
  it('grows another of your buildings with a card of ANY crop', () => {
    const s = base();
    // v48: O4 (a pure Draw 3) replaces A10 as the probe; see A5's case.
    buildFor(data, s, APIARY, 'A6', 'O4');
    dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');

    const anyCrop = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'O4' && a.payload.payment === 'W4',
    );
    expect(anyCrop).toBeDefined();
    const fired = answerTask(data, grown.state, anyCrop as TaskAnswer);
    // A REAL grow: the card lands on the stack and the ability fires. O4's
    // threshold is 3, so one card leaves it not full: v49's Harvest offer
    // never appears here.
    expect(buildingOf(fired.state, APIARY, 'O4').stack).toEqual(['W4']);
    expect(headDraw(fired.state)).toMatchObject({ src: 'O4' });
  });

  /**
   * ⭐ v49 (24/09/2026, `tasks/v49-rulings-v1.md` R3, carried by the builder
   * default note): "If it is full, you may Harvest it." Unlike A5, this GROW
   * PLACES a card, so the target can become full only by this GROW's own
   * payment landing on it - checked once the grow's own ability has
   * resolved, against the ONE building A6 just grew.
   */
  it('offers to Harvest the grown building when the GROW payment fills it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A6', 'O4');
    dealTo(data, s, APIARY, 'A4', 'W4');
    loadStack(data, s, APIARY, 'O4', 2); // 2 of 3: one more card fills it
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');

    const anyCrop = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'O4' && a.payload.payment === 'W4',
    ) as TaskAnswer;
    const fired = answerTask(data, grown.state, anyCrop);
    expect(buildingOf(fired.state, APIARY, 'O4').stack).toHaveLength(3); // full

    // O4's own Draw 3 queues first (`pushTask` appends); only once it drains
    // does the optional Harvest offer, O4 only, follow.
    const drawn = drainDraw(fired.state);
    expect(pendingAnswers(data, drawn)).toEqual([
      { kind: 'building', card: 'O4' },
      { kind: 'skip' },
    ]);
    const harvested = answerTask(data, drawn, { kind: 'building', card: 'O4' });
    expect(buildingOf(harvested.state, APIARY, 'O4').stack).toEqual([]);
    expect(player(harvested.state, APIARY).barn).toHaveLength(3);
  });

  it('"another" excludes itself, and a full building drops out - this one places', () => {
    const s = base();
    // ⚠️ CARD-ONLY, and the consequence is worth naming: A6's nested GROW reaches
    // the same enumerator as any other, so under the shipped rules a MEEPLE pays
    // it and the full A11 comes back onto the list - a card-of-any-crop GROW that
    // places nothing. This case is about the card, so the supply is drained.
    noMeeples(s);
    buildFor(data, s, APIARY, 'A6', 'A10', 'A11');
    dealTo(data, s, APIARY, 'A4', 'W4');
    loadStack(data, s, APIARY, 'A11', 3); // v48: threshold 3 (was 2): full
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');
    const buildings = offered(grown.state).map((p) => p.building);
    expect(new Set(buildings)).toEqual(new Set(['A10']));
  });

  it('the base Farmstead no longer waives the crop for the whole suit', () => {
    const s = base();
    // ⚠️ CARD-ONLY BY CONSTRUCTION. Since 05/09/2026 a meeple of a colour pays
    // wherever a card of that colour would, and every seat starts holding one of
    // each, so the supply would answer the question this case is asking.
    noMeeples(s);
    buildFor(data, s, APIARY, 'A10');
    dealTo(data, s, APIARY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'A10')).toBe(false);
    expect(() => growBuilding(data, s, APIARY, 'A10', 'W4')).toThrow(/needs a apiary card/);
  });
});

describe('A7 The Foraging Hive - Draw 2, then the mandatory sow', () => {
  /**
   * ⭐ v48 retext (24/09/2026, `tasks/v48-ambiguity-audit-v1.md` row A7):
   * "Draw 2, then sow 1 card from your hand onto another of your buildings."
   * The draw is pushed FIRST, so it sits ahead of the sow in the task queue
   * and a card just drawn may be the one sown.
   */
  it('draws 2, then sows 1 card from hand onto ANOTHER of your buildings, suit-free', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7', 'A10');
    dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A7', 'A4');
    expect(grown.state.tasks.map((t) => t.t)).toEqual(['draw', 'sow']);
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2, src: 'A7' });

    const sow = grown.state.tasks[1];
    if (sow?.t !== 'sow') throw new Error('expected a sow task');
    expect(sow.optional).toBeUndefined(); // imperative = mandatory
    expect(sow.targets?.map((r) => r.card)).not.toContain('A7');
    // Your own starters are ordinary sow targets.
    expect(sow.targets?.map((r) => r.card)).toEqual(expect.arrayContaining(['A1', 'A10']));

    // Drain the draw, then aim the sow at A10 with the hand card already held.
    const done = answerAll(grown.state, (answers) => {
      const onto = answers.find((a) => a.kind === 'sow' && a.card === 'W4' && a.onto === 'A10');
      return onto ?? (answers[0] as TaskAnswer);
    });
    expect(buildingOf(done, APIARY, 'A10').stack).toEqual(['W4']);
  });

  it('the sow auto-skips with no other building to receive it, but the draw still fires', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7'); // no other building to sow onto
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A7', 'A4');
    const before = player(grown.state, APIARY).hand.length;
    const done = answerAll(grown.state);
    // -0 for the sow (nothing to place onto), +2 for the unconditional draw.
    expect(player(done, APIARY).hand.length).toBe(before + 2);
    // A7's own stack holds only its GROW payment - the sow itself never landed anywhere.
    expect(buildingOf(done, APIARY, 'A7').stack).toEqual(['A4']);
  });
});

describe('A8 The Wild Hive - Deliver from the barn and your own full buildings (v48)', () => {
  /**
   * ⭐ v48 (24/09/2026), `tasks/v48-rulings-v2.md` R4 and R8: "Deliver, using
   * cards from your Barn and cards on full buildings." Your OWN full buildings
   * only, fullness judged once at payment, whole stacks usable, and your Notice
   * Board counts as full at 3 or more. A real Deliver, never a Harvest.
   *
   * In this game tile A1 holds the apiary 6 and 5 tokens (the testkit deals
   * tokens crop by crop, the first seat's crop first), so its first delivery is
   * four apiary cards.
   */
  function wildTask(state: GameState): Extract<Task, { t: 'card' }> {
    const head = state.tasks[0];
    if (head?.t !== 'card' || head.kind !== 'wildDeliver') {
      throw new Error('expected the wildDeliver task at the head');
    }
    return head;
  }

  it("pays using a full building's stack and your own Notice Board at 3, with no harvest", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8', 'A5'); // A5: threshold 2
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2); // full
    loadStack(data, s, APIARY, 'A3', 3, 'apiary'); // the Notice Board at 3 (R4)
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    wildTask(grown.state);
    // STEP 1: the delivery itself, one answer per (tile, token, spend).
    const delivery = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    expect(delivery).toBeDefined();
    let out = answerTask(data, grown.state, delivery);
    const events = [...out.events];
    // STEP 2: 5 apiary cards on two full buildings for 4 needed is a real
    // choice, asked one card at a time: the barn is empty, so only buildings.
    const sources = (st: GameState) =>
      pendingAnswers(data, st).flatMap((a) => (a.kind === 'card' ? [a.payload.from] : []));
    expect(sources(out.state).sort()).toEqual(['A3', 'A5']);
    for (let i = 0; i < 3; i++) {
      out = answerTask(data, out.state, { kind: 'card', payload: { from: 'A3' } });
      events.push(...out.events);
    }
    // Only A5 still holds apiary, so its one card is sourced silently and the
    // delivery pays.
    const after = out.state;
    expect(after.tasks).toHaveLength(0);
    expect(buildingOf(after, APIARY, 'A3').stack).toEqual([]);
    expect(buildingOf(after, APIARY, 'A5').stack).toHaveLength(1);
    expect(player(after, APIARY).receipts).toHaveLength(1);
    expect(player(after, APIARY).barn).toEqual([]);
    // Not a Harvest: no harvested event, and the cards went to the discard.
    expect(events.some((e) => e.e === 'harvested')).toBe(false);
    expect(events.some((e) => e.e === 'delivered')).toBe(true);
    expect(after.discards.apiary.length).toBeGreaterThanOrEqual(4);
  });

  it("never pays from a rival's full building or your own building that is not full", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8', 'A7'); // A7: threshold 3
    buildFor(data, s, WHEAT, 'W4'); // threshold 2
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A7', 2, 'apiary'); // 2 of 3: not full
    loadStack(data, s, APIARY, 'A3', 2, 'apiary'); // Notice Board at 2: not full for A8 (R4)
    loadStack(data, s, WHEAT, 'W4', 2, 'apiary'); // a rival's full building
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    // Six apiary cards sit on buildings, none of them payable: nothing happens.
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, APIARY).receipts).toHaveLength(0);
  });

  it('forced sources are never asked: a barn-and-building split that is exact pays at once', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8', 'A5');
    dealTo(data, s, APIARY, 'A4', 'A6', 'A7');
    player(s, APIARY).barn.push(...player(s, APIARY).hand.splice(1, 2)); // 2 apiary in the barn
    loadStack(data, s, APIARY, 'A5', 2); // 2 apiary on a full building
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    const delivery = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    const out = answerTask(data, grown.state, delivery).state;
    expect(out.tasks).toHaveLength(0);
    expect(player(out, APIARY).barn).toEqual([]);
    expect(buildingOf(out, APIARY, 'A5').stack).toEqual([]);
    expect(player(out, APIARY).receipts).toHaveLength(1);
  });

  it('with nothing payable, the card does nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });

  it('mandatory: no skip answer is ever offered', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8', 'A5');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2);
    loadStack(data, s, APIARY, 'A3', 3, 'apiary');
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    expect(pendingAnswers(data, grown.state).some((a) => a.kind === 'skip')).toBe(false);
  });
});

describe('A9 The Pollinator Trail - a hand sow onto ONE other building, up to its threshold, then an optional Harvest', () => {
  /**
   * ⭐ v49 retext (24/09/2026, `tasks/v49-rulings-v1.md` R1-R3): the deck sow
   * plus Draw 2 of v47-v48 is GONE. R1: one or more HAND cards onto ONE other
   * building, up to the number that fills it, one card at a time ("sow one
   * more, or stop" - the builder default). R2: never A9 itself, never a
   * Notice Board. R3: a filled building offers an optional real Harvest.
   */
  it('sows hand cards one at a time onto the chosen building, and can stop early with no Harvest', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9', 'A5', 'A7'); // A5: threshold 2; A7: threshold 3
    dealTo(data, s, APIARY, 'A4', 'W4', 'W5'); // A4 pays A9's own GROW
    const grown = growBuilding(data, s, APIARY, 'A9', 'A4');

    // Round 1: MANDATORY - every hand card onto every legal other building,
    // no skip offered while a legal sow exists.
    const round1 = pendingAnswers(data, grown.state);
    expect(round1.some((a) => a.kind === 'skip')).toBe(false);
    const first = round1.find(
      (a) => a.kind === 'sow' && a.card === 'W4' && a.onto === 'A7',
    ) as TaskAnswer;
    expect(first).toBeDefined();
    const afterFirst = answerTask(data, grown.state, first).state;
    expect(buildingOf(afterFirst, APIARY, 'A7').stack).toEqual(['W4']);

    // Round 2: pinned to A7 (the building the first answer named) only, and
    // a skip is now offered - "sow one more, or stop".
    const round2 = pendingAnswers(data, afterFirst);
    expect(round2.every((a) => a.kind === 'skip' || (a.kind === 'sow' && a.onto === 'A7'))).toBe(
      true,
    );
    expect(round2.some((a) => a.kind === 'skip')).toBe(true);

    // Stopping early leaves A7 at 1 of 3: no Harvest offer follows.
    const stopped = answerTask(data, afterFirst, { kind: 'skip' }).state;
    expect(stopped.tasks).toHaveLength(0);
    expect(buildingOf(stopped, APIARY, 'A7').stack).toEqual(['W4']);
  });

  it('a card that fills the building ends the sow and offers to Harvest it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9', 'A5'); // A5: threshold 2
    dealTo(data, s, APIARY, 'A4', 'W4', 'W5');
    const grown = growBuilding(data, s, APIARY, 'A9', 'A4');

    const first = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'sow' && a.card === 'W4' && a.onto === 'A5',
    ) as TaskAnswer;
    const afterFirst = answerTask(data, grown.state, first).state;
    const second = pendingAnswers(data, afterFirst).find(
      (a) => a.kind === 'sow' && a.card === 'W5' && a.onto === 'A5',
    ) as TaskAnswer;
    expect(second).toBeDefined();
    const afterSecond = answerTask(data, afterFirst, second).state;
    // A5's threshold is 2: filled, and no further sow is offered, only the
    // Harvest.
    expect(buildingOf(afterSecond, APIARY, 'A5').stack).toEqual(['W4', 'W5']);
    expect(pendingAnswers(data, afterSecond)).toEqual([
      { kind: 'building', card: 'A5' },
      { kind: 'skip' },
    ]);
    const harvested = answerTask(data, afterSecond, { kind: 'building', card: 'A5' });
    expect(buildingOf(harvested.state, APIARY, 'A5').stack).toEqual([]);
    expect(player(harvested.state, APIARY).barn).toHaveLength(2);
  });

  it('never targets A9 itself or the Notice Board', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9', 'A5'); // A5: the one legal target
    dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A9', 'A4');
    const targets = new Set(
      pendingAnswers(data, grown.state).flatMap((a) => (a.kind === 'sow' ? [a.onto] : [])),
    );
    expect(targets).toEqual(new Set(['A5']));
  });

  it('auto-skips with an empty hand or no legal building', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9');
    dealTo(data, s, APIARY, 'A4'); // hand is empty once this pays A9's own GROW
    const grown = growBuilding(data, s, APIARY, 'A9', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe("A10 The Cross-Pollinator - a visit to a rival's Notice Board, paid with a deck card (v48)", () => {
  /**
   * ⭐ v48 (24/09/2026), `tasks/v48-rulings-v2.md` R2 (a real visit: W17, O16
   * and A17 fire) and R9 (an EXTRA visit with no per-board latch: not the
   * bonus visit, and it may visit the board the bonus slot just used).
   *
   * The Wheat board's power ("Harvest one of your buildings, even if it is 1
   * card short of full") is made live by leaving A5 (threshold 2) and A7
   * (threshold 3) each one card short.
   */
  function position(): GameState {
    const s = base();
    buildFor(data, s, APIARY, 'A10', 'A5', 'A7', 'O16');
    buildFor(data, s, WHEAT, 'W17');
    dealTo(data, s, APIARY, 'A4', 'A6');
    loadStack(data, s, APIARY, 'A5', 1);
    loadStack(data, s, APIARY, 'A7', 2);
    return s;
  }

  function visitAnswers(state: GameState): Record<string, unknown>[] {
    const head = state.tasks[0];
    if (head?.t !== 'card' || head.kind !== 'crossVisit') {
      throw new Error('expected the crossVisit task at the head');
    }
    return offered(state);
  }

  it('visits with a deck card: the card lands on the rival board, the power fires, W17 and O16 fire', () => {
    const s = position();
    const handBefore = player(s, APIARY).hand.length;
    const wheatTop = s.decks.wheat[0];
    const grown = growBuilding(data, s, APIARY, 'A10', 'A4');
    const answers = visitAnswers(grown.state);
    // Rivals only: never one of the owner's own boards.
    expect(answers.every((a) => a.host === WHEAT)).toBe(true);
    const out = answerTask(data, grown.state, {
      kind: 'card',
      payload: { host: WHEAT, board: 'W3', suit: 'wheat' },
    });
    // The deck top is the fee, on the host's board; the hand only paid A10's GROW.
    expect(buildingOf(out.state, WHEAT, 'W3').stack).toEqual([wheatTop]);
    expect(player(out.state, APIARY).hand).toHaveLength(handBefore - 1);
    expect(out.events).toContainEqual(
      expect.objectContaining({ e: 'visited', seat: APIARY, host: WHEAT, colour: 'wheat' }),
    );
    // R2: the visit hooks fire (W17 for the host, O16 for the visitor).
    expect(drawsFrom(out.state, 'W17')).toBe(1);
    expect(drawsFrom(out.state, 'O16')).toBe(1);
    // The Wheat power fired for the VISITOR: a harvest choice is queued for Apiary.
    expect(out.state.tasks.some((t) => t.t === 'chooseBuilding' && t.pid === APIARY)).toBe(true);
    // R9: not the bonus visit, and no latch on the board.
    expect(out.state.turn.bonusUsed).toEqual([]);
    expect(out.state.turn.firedThisTurn).not.toContain('W3');
  });

  it('works after a bonus visit to the SAME board, and does not consume the bonus', () => {
    const s = position();
    dealTo(data, s, APIARY, 'A12'); // the bonus fee
    expect(s.turn.actionSpent).toBe(false);
    const boards = noticeBoardsOf(data, s, WHEAT);
    const visit: Move =
      boards.length > 1
        ? { type: 'visit', seat: APIARY, host: WHEAT, fee: 'A12', board: 'W3' }
        : { type: 'visit', seat: APIARY, host: WHEAT, fee: 'A12' };
    let st = apply(data, s, visit).state;
    // Answer the bonus visit's Wheat power: harvest A5, leaving A7 for A10's visit.
    st = answerAll(
      st,
      (list) =>
        (list.find((a) => a.kind === 'building' && a.card === 'A5') ?? list[0]) as TaskAnswer,
    );
    expect(st.turn.bonusUsed).toEqual(['visit']);
    expect(st.turn.firedThisTurn).toContain('W3');
    const grown = apply(data, st, {
      type: 'grow',
      seat: APIARY,
      building: 'A10',
      payment: 'A4',
    }).state;
    // W3 is offered again although the bonus slot latched it (R9: no latch).
    const answers = visitAnswers(grown);
    expect(answers.some((a) => a.board === 'W3')).toBe(true);
    const out = answerTask(data, grown, {
      kind: 'card',
      payload: { host: WHEAT, board: 'W3', suit: 'wheat' },
    }).state;
    expect(buildingOf(out, WHEAT, 'W3').stack).toHaveLength(2);
    // Still exactly one bonus use: A10 neither needed the slot nor spent it.
    expect(out.turn.bonusUsed).toEqual(['visit']);
  });

  it('offers only boards whose power is legal right now (S10)', () => {
    // Fired from the hand through A15 (threshold 3, holding only its GROW
    // payment), so NOTHING of Apiary's is 1 card short of full and the Wheat
    // board's power is dead to it; grown directly, A10 itself (threshold 2,
    // holding its payment) would be the building that made it live.
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A13', 'A10', 'A4');
    const grown = growBuilding(data, s, APIARY, 'A15', 'A13').state;
    const fired = answerTask(data, grown, { kind: 'card', payload: { card: 'A10' } }).state;
    const answers = visitAnswers(fired);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.some((a) => a.board === 'W3')).toBe(false);
    expect(answers.every((a) => a.host === WHEAT)).toBe(true);
  });

  it('with every deck and discard dry, nothing happens', () => {
    const s = position();
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const grown = growBuilding(data, s, APIARY, 'A10', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A11 The Wax Workshop - a real Harvest, relaxed to 1 card', () => {
  /**
   * ⭐ v49 retext (sheet v49, 26/09/2026, `tasks/v49-sheet-a11-a17-pass.md`):
   * the minimum drops from 2 to 1 - "Harvest another of your buildings with
   * 1 or more cards on it, even if it is not full." Everything else from v48
   * R3 stands: a REAL Harvest of ONE building, the owner's choice.
   */
  it('harvests a building with exactly 1 card, even if not full', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5', 'A7'); // A5: threshold 2; A7: threshold 3
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2); // full at its own threshold
    loadStack(data, s, APIARY, 'A7', 1); // not full (needs 3), but 1 or more
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    const choose = grown.state.tasks[0];
    if (choose?.t !== 'chooseBuilding') throw new Error('expected a chooseBuilding task');
    expect(choose.filter).toBe('harvestable');
    expect(choose.relaxedMin).toBe(1);
    expect(choose.exclude).toBe('A11');
    const offered = pendingAnswers(data, grown.state)
      .flatMap((a) => (a.kind === 'building' ? [a.card] : []))
      .sort();
    expect(offered).toEqual(['A5', 'A7']);

    const harvested = answerTask(data, grown.state, { kind: 'building', card: 'A7' });
    // A REAL Harvest: the whole stack goes to the barn, not one card.
    expect(buildingOf(harvested.state, APIARY, 'A7').stack).toEqual([]);
    expect(player(harvested.state, APIARY).barn).toHaveLength(1);
    // The building never chosen is untouched.
    expect(buildingOf(harvested.state, APIARY, 'A5').stack).toHaveLength(2);
  });

  /** The owner's own Notice Board is a legal target at 1 card, never below (S8). */
  it("may harvest the owner's own Notice Board at 1 card", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A3', 1, 'wheat'); // the Notice Board, at 1
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    const offered = pendingAnswers(data, grown.state).flatMap((a) =>
      a.kind === 'building' ? [a.card] : [],
    );
    expect(offered).toEqual(['A3']);
    const harvested = answerTask(data, grown.state, { kind: 'building', card: 'A3' });
    expect(buildingOf(harvested.state, APIARY, 'A3').stack).toEqual([]);
    expect(player(harvested.state, APIARY).barn).toHaveLength(1);
  });

  /** A11 may never harvest itself, however loaded. */
  it('cannot harvest itself, even holding 1 or more cards', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11');
    dealTo(data, s, APIARY, 'A4', 'A5'); // A5 spare, so the hand is not the reason
    loadStack(data, s, APIARY, 'A11', 1); // 1 of its own threshold 3: not full, but 1+
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    // No other building holds any cards, and A11 may never target itself.
    expect(grown.state.tasks).toHaveLength(0);
  });

  /**
   * It prints "Harvest": the When-Harvested line fires, unlike the old skim.
   * ⚠️ `drawsFrom` cannot see this: W16's draw is a conditional `card` task
   * (`granaryDraw`, wheat.ts), not a plain `draw` task, so the proof is the
   * hand's net movement instead: -1 for A11's own GROW payment, +1 for W16.
   */
  it('is a REAL Harvest: When-Harvested lines fire, even at 1 card', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5', 'W16'); // W16: "whenever you harvest, if hand <=5, Draw 1"
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 1);
    const before = player(s, APIARY).hand.length;
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    const state = answerAll(grown.state);
    expect(player(state, APIARY).hand.length).toBe(before);
    expect(player(state, APIARY).barn).toHaveLength(1);
  });

  it('mandatory: with no building holding any cards, nothing happens', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A12 The Honey Hut - two firings for one card', () => {
  it('fires TWO DIFFERENT buildings, and never the same one twice', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A12', 'A10', 'A11');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A11', 1); // so A11 has something to skim
    const grown = growBuilding(data, s, APIARY, 'A12', 'A4');
    expect(activateTask(grown.state)).toMatchObject({ remaining: 2 });
    expect(new Set(activateTask(grown.state).targets)).toEqual(new Set(['A10', 'A11']));

    const first = answerTask(data, grown.state, { kind: 'activate', card: 'A10' });
    // A10 has fired, so the second pick can only be A11.
    expect(pendingAnswers(data, first.state).filter((a) => a.kind === 'activate')).toEqual([
      { kind: 'activate', card: 'A11' },
    ]);
    const state = answerAll(first.state);
    expect(state.turn.firedThisTurn.sort()).toEqual(['A10', 'A11', 'A12']);
  });

  it('auto-skips with only one thing to fire, having fired it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A12', 'A10');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A12', 'A4');
    const state = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'activate') ?? (a[0] as TaskAnswer),
    );
    expect(state.turn.firedThisTurn.sort()).toEqual(['A10', 'A12']);
  });
});

/**
 * ⛔ THE ACTION CARD IS RETIRED (19/08/2026). Every case in the next three
 * blocks used to open by finding a standing `cardMove` and applying it; they now
 * open with an ordinary GROW, because that is all a Tier 3 card is. The two
 * things worth watching in the conversion, and both are asserted below: the
 * handler no longer sets `turn.actionSpent` itself (the GROW runtime does it),
 * and each of the three now carries a threshold, so it CLOGS and has to be
 * harvested before it can fire again.
 */
describe("A13 The Queen's Hive - the swarm, straight into the barn", () => {
  it('banks any 3 deck cards, unconditionally - the v48 retext removes the gate', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13', 'A5', 'A9');
    dealTo(data, s, APIARY, 'A4');
    const tops = s.decks.dairy.slice(0, 3);
    const grown = growBuilding(data, s, APIARY, 'A13', 'A4');
    expect(grown.state.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['deckToBarn']);
    expect(new Set(offered(grown.state).map((p) => p.suit))).toEqual(new Set(data.cards.suits));
    const done = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'card' && x.payload.suit === 'dairy') as TaskAnswer,
    );
    expect(player(done, APIARY).barn).toEqual(tops);
  });

  /**
   * ⭐ v48 retext (24/09/2026, `tasks/v48-ambiguity-audit-v1.md` row A13): the
   * "3 or more Apiary buildings" gate is GONE. Built with no other Apiary
   * building at all - which would have been "below the gate" under every
   * earlier version - the three picks still fire. `cropBuildingsOf`, the
   * gate's counter, is no longer called from this file.
   */
  it('fires with no other Apiary building built at all', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13'); // A13 alone: the old gate needed 3
    dealTo(data, s, APIARY, 'A4');
    const tops = s.decks.wheat.slice(0, 3);
    const grown = growBuilding(data, s, APIARY, 'A13', 'A4');
    expect(grown.state.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['deckToBarn']);
    const done = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'card' && x.payload.suit === 'wheat') as TaskAnswer,
    );
    expect(player(done, APIARY).barn).toEqual(tops);
  });

  /**
   * It is a GROW, so the GROW runtime spends the action, not the handler.
   *
   * ⭐ v48: with the gate gone, `deckToBarn` is now ALWAYS pending after this
   * GROW (the decks are non-empty in this fixture), so the turn stays open
   * until it is answered - `settleTurn` will not pass it on with a task still
   * queued (and `answerTask`/`answerAll`, unlike `apply`, never call
   * `settleTurn` at all, so draining the picks by hand would not move
   * `turnPlayer` either). `actionSpent` is already true: the runtime spent
   * it, not the handler, which is the fact this case exists to pin down.
   */
  it('is an ordinary GROW: wild activation, and the action is spent by the runtime', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    dealTo(data, s, APIARY, 'W4'); // a WHEAT card: activationType is wild
    expect(growMoveFor(s, 'A13')).toBeDefined();
    const played = apply(data, s, { type: 'grow', seat: APIARY, building: 'A13', payment: 'W4' });
    expect(played.state.turn.actionSpent).toBe(true);
    expect(played.state.turnPlayer).toBe(APIARY); // held open by the pending deckToBarn task
    expect(played.state.tasks.map((t) => (t.t === 'card' ? t.kind : t.t))).toEqual(['deckToBarn']);
    expect(buildingOf(played.state, APIARY, 'A13').stack).toEqual(['W4']);
  });

  /** Threshold 1: the payment fills it, so it clogs on every single use. */
  it('clogs itself at threshold 1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    dealTo(data, s, APIARY, 'A4', 'A5');
    const grown = growBuilding(data, s, APIARY, 'A13', 'A4');
    expect(growMoveFor(grown.state, 'A13')).toBeUndefined();
  });

  /**
   * Mandatory effects skip silently rather than refusing the activation (plan
   * 8.3): with every deck dry, the GROW happens and nothing else does.
   */
  it('skips silently when every deck is dry', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    dealTo(data, s, APIARY, 'A4');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const grown = growBuilding(data, s, APIARY, 'A13', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, APIARY).barn).toEqual([]);
    expect(buildingOf(grown.state, APIARY, 'A13').stack).toEqual(['A4']);
  });
});

describe('A14 The Honeycomb Tower - up to 3, without placing a card', () => {
  /**
   * ⭐ v48 retext (24/09/2026, `tasks/v48-rulings-v2.md`, row A14 of
   * `tasks/v48-ambiguity-audit-v1.md`): "GROW up to 3 of your full buildings
   * (not Notice Board), without placing a card." Exactly A5/A12's signature
   * "GROW without placing a card" (docblock, top of file), restricted to full
   * buildings and offered up to three times, a decline available every round.
   */
  it('fires a full building without placing a card, so its stack stays full', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4'); // A4: threshold 4
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A4', 4); // full
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    const answers = pendingAnswers(data, grown.state);
    expect(answers).toEqual(
      expect.arrayContaining([{ kind: 'activate', card: 'A4' }, { kind: 'skip' }]),
    );
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'A4' });
    expect(buildingOf(fired.state, APIARY, 'A4').stack).toHaveLength(4); // nothing placed
    // A4 counts only what was already there (no payment card lands): the same
    // reading A5's own "fired without a placement" case gets it.
    const drawTask = tasksFrom(fired.state, 'A4').find((t) => t.t === 'draw');
    expect(drawTask).toMatchObject({ see: 4, keep: 4, src: 'A4' });
  });

  it('offers up to 3, one at a time, and a decline ends the sequence early', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4', 'A7'); // A4: threshold 4; A7: threshold 3
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A4', 4); // full
    loadStack(data, s, APIARY, 'A7', 3); // full
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    const round1 = pendingAnswers(data, grown.state);
    const targets1 = round1.flatMap((a) => (a.kind === 'activate' ? [a.card] : [])).sort();
    expect(targets1).toEqual(['A4', 'A7']);
    expect(round1.some((a) => a.kind === 'skip')).toBe(true);

    const firedA4 = answerTask(data, grown.state, { kind: 'activate', card: 'A4' });
    expect(buildingOf(firedA4.state, APIARY, 'A4').stack).toHaveLength(4); // nothing placed
    // Round 2: A4 fired this turn already, so only A7 and skip remain (its
    // own draw task sits queued behind the still-live honeycombGrow task).
    const round2 = pendingAnswers(data, firedA4.state);
    expect(round2.some((a) => a.kind === 'activate' && a.card === 'A4')).toBe(false);
    expect(round2).toEqual(
      expect.arrayContaining([{ kind: 'activate', card: 'A7' }, { kind: 'skip' }]),
    );

    const declined = answerTask(data, firedA4.state, { kind: 'skip' });
    // The sequence ends on the decline; A4's own draw is all that is left.
    expect(headDraw(declined.state)).toMatchObject({ see: 4, keep: 4, src: 'A4' });
    const done = answerAll(declined.state);
    expect(done.tasks).toHaveLength(0);
    // A7 was never fired: untouched stack, never joined firedThisTurn.
    expect(buildingOf(done, APIARY, 'A7').stack).toHaveLength(3);
    expect(done.turn.firedThisTurn).toEqual(expect.arrayContaining(['A14', 'A4']));
    expect(done.turn.firedThisTurn).not.toContain('A7');
  });

  /** ⛔ THE SOW IS GONE: no rival building is ever touched, on any board state. */
  it("never places a card on a neighbour's farm - the shared vocabulary is own-farm only", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A4', 4);
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(grown.audit.crossSeat).toBe(false);
    const onWheat = player(grown.state, WHEAT).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onWheat).toBe(0);
  });

  it('auto-ends at once with no full building to fire', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4'); // A4 built but not loaded: not full
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(grown.state.tasks).toHaveLength(0);
  });

  /** Never itself, even when its own GROW payment leaves it full. */
  it('never offers itself, even loaded to its own threshold', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14');
    dealTo(data, s, APIARY, 'A6', 'A7'); // A7 spare, so the hand is not the reason
    loadStack(data, s, APIARY, 'A14', 1); // + the payment card = 2: full at threshold 2
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(buildingOf(grown.state, APIARY, 'A14').stack).toHaveLength(2);
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A15 The Royal Apiary - discard a Tier card and fire its activated line (v48)', () => {
  /**
   * ⭐ v48 (24/09/2026), `tasks/v48-rulings-v2.md` R1, R6, R7: the discarded
   * card's ACTIVATED line fires with no cost and nothing placed; only Tier 1-3
   * cards may be chosen; "this building" is the discarded card and finds
   * nothing. Threshold 3 (R15), so a GROW payment never fills it.
   */
  function royal(...hand: string[]): GameState {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A13', ...hand); // A13 is the GROW payment
    return growBuilding(data, s, APIARY, 'A15', 'A13').state;
  }

  function discardAnswer(card: string): TaskAnswer {
    return { kind: 'card', payload: { card } };
  }

  it('offers only the Tier 1-3 cards in hand, never a Power or End-game card', () => {
    const s = royal('A4', 'D8', 'A16', 'A19');
    const head = s.tasks[0];
    expect(head?.t === 'card' && head.kind === 'royalDiscard').toBe(true);
    expect(
      offered(s)
        .map((p) => p.card)
        .sort(),
    ).toEqual(['A4', 'D8']);
    expect(pendingAnswers(data, s).some((a) => a.kind === 'skip')).toBe(false);
  });

  it('with only Power and End-game cards in hand, does nothing', () => {
    const s = royal('A16', 'A19');
    expect(s.tasks).toHaveLength(0);
    expect(player(s, APIARY).hand.sort()).toEqual(['A16', 'A19']);
  });

  it('fires D8 (Build, then Draw 2), and the discarded card sits in its discard pile', () => {
    const s = royal('D8', 'D4', 'D6');
    const out = answerTask(data, s, discardAnswer('D8')).state;
    expect(player(out, APIARY).hand).not.toContain('D8');
    expect(out.discards.dairy).toContain('D8');
    // The build is queued first, then the Draw 2, both sourced to D8.
    expect(tasksFrom(out, 'D8').map((t) => t.t)).toEqual(['build', 'draw']);
    expect(out.tasks.find((t) => t.t === 'draw' && t.src === 'D8')).toMatchObject({
      see: 2,
      keep: 2,
    });
    // It never landed on the farm, and nothing was placed on A15 beyond its payment.
    expect(player(out, APIARY).tableau.some((b) => b.card === 'D8')).toBe(false);
    expect(buildingOf(out, APIARY, 'A15').stack).toEqual(['A13']);
  });

  it('fires O11 through its own handler', () => {
    const s = royal('O11');
    const out = answerTask(data, s, discardAnswer('O11')).state;
    expect(out.discards.orchard).toContain('O11');
    expect(drawsFrom(out, 'O11')).toBe(1);
  });

  it('R7: A4 draws 0, because "this building" is not on the farm', () => {
    const s = royal('A4');
    const out = answerTask(data, s, discardAnswer('A4')).state;
    expect(out.discards.apiary).toContain('A4');
    expect(drawsFrom(out, 'A4')).toBe(0);
    expect(out.tasks).toHaveLength(0);
  });

  it('R7: V14 delivers but destroys nothing, and A15 stays built', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A13', 'V14', 'A4', 'A5', 'A6', 'A7');
    player(s, APIARY).barn.push(...player(s, APIARY).hand.splice(2, 4)); // 4 apiary to the barn
    const grown = growBuilding(data, s, APIARY, 'A15', 'A13').state;
    const fired = answerTask(data, grown, discardAnswer('V14')).state;
    const pick = pendingAnswers(data, fired).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    const out = answerTask(data, fired, pick);
    expect(player(out.state, APIARY).receipts.map((r) => r.vp)).toEqual([6, 5]);
    expect(player(out.state, APIARY).tableau.some((b) => b.card === 'A15')).toBe(true);
    expect(out.events.some((e) => e.e === 'demolished')).toBe(false);
    expect(out.state.discards.vegetable).toContain('V14');
  });

  it('the listener trap: a discarded D5 still gets its afterBuild sow (A15 forwards it)', () => {
    const s = royal('D5', 'D4', 'D6');
    let st = answerTask(data, s, discardAnswer('D5')).state;
    const build = pendingAnswers(data, st).find(
      (a) => a.kind === 'build' && a.card === 'D4',
    ) as TaskAnswer;
    expect(build).toBeDefined();
    st = answerTask(data, st, build).state;
    const sow = st.tasks[0];
    expect(sow?.t === 'card' && sow.src === 'D5' && sow.kind === 'sowSpent').toBe(true);
    st = answerAll(st);
    expect(buildingOf(st, APIARY, 'D4').stack).toHaveLength(1);
  });

  it('the listener trap: a discarded D11 draws 1 per card its Build spent', () => {
    const s = royal('D11', 'D4', 'D6');
    let st = answerTask(data, s, discardAnswer('D11')).state;
    const build = pendingAnswers(data, st).find(
      (a) => a.kind === 'build' && a.card === 'D4',
    ) as TaskAnswer;
    st = answerTask(data, st, build).state;
    expect(st.tasks.find((t) => t.t === 'draw' && t.src === 'D11')).toMatchObject({
      see: 1,
      keep: 1,
    });
  });

  it('no recursion: a discarded A5 cannot fire A15 again this turn', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15', 'A7');
    dealTo(data, s, APIARY, 'A13', 'A5');
    const grown = growBuilding(data, s, APIARY, 'A15', 'A13').state;
    const out = answerTask(data, grown, discardAnswer('A5')).state;
    // v49: A5's own choice is now a file-local `card` task (`meadowActivate`),
    // not the shared `t: 'activate'` one - its answers still carry `kind:
    // 'activate'` (A14's honeycombGrow precedent), so the targets read the
    // same way off `pendingAnswers`.
    const targets = pendingAnswers(data, out).flatMap((a) =>
      a.kind === 'activate' ? [a.card] : [],
    );
    expect(targets).not.toContain('A15');
    expect(targets).toContain('A7');
  });

  /**
   * THE SWEEP: every Tier card in the catalogue, discarded to A15 on a farm with
   * something on it, must resolve and drain without throwing. This is the
   * guard for R7's "that part finds nothing": a handler that looked itself up
   * on the farm and threw would fail here.
   */
  it('every Tier card fires from the hand without crashing', () => {
    const tier = data.cards.catalogue.filter(
      (c) => c.enabled && c.inDeck && c.activationType !== null && c.id !== 'A15',
    );
    expect(tier.length).toBeGreaterThan(50);
    const failures: string[] = [];
    for (const card of tier) {
      try {
        const s = base();
        buildFor(data, s, APIARY, 'A15', ...(card.id === 'A7' ? ['A9'] : ['A7']));
        const payment = card.id === 'A13' ? 'A14' : 'A13';
        const extra = ['D4', 'D6', 'W6', 'V5', 'O5'].filter((id) => id !== card.id);
        dealTo(data, s, APIARY, payment, card.id, ...extra);
        const grown = growBuilding(data, s, APIARY, 'A15', payment).state;
        const fired = answerTask(data, grown, discardAnswer(card.id)).state;
        answerAll(fired);
      } catch (err) {
        failures.push(`${card.id}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("A16 The Beekeeper's Veil - stack position 2, unchanged by the rebuild", () => {
  it('draws 1 when YOUR placement brings a stack to 2', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16', 'A5');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 1); // the grow payment makes it 2
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A16' });
  });

  /**
   * ⛔ THIS ROUTE IS GONE FROM THE SHIPPED GAME AND IS TESTED ON THE CONTROL. A
   * visit no longer places a card anywhere: it puts a meeple in a colour slot,
   * and the Notice Board is not a building, so a visit can never bring one of
   * the host's stacks to 2. The behaviour is unchanged where it can still
   * happen, which is overlays/v31-card-visit.overlay.json.
   */
  it("fires on a visit fee landing on a neighbour's board at 2, under the v31 control", () => {
    const control = cardVisitGame();
    const s = makeState(control, ['apiary', 'wheat']);
    buildFor(control, s, APIARY, 'A16');
    dealTo(control, s, APIARY, 'A4');
    loadStack(control, s, WHEAT, 'W3', 1, 'wheat');
    // The Wheat door is a Harvest, so the visitor needs a full building of their
    // own or the door is not offered at all.
    buildFor(control, s, APIARY, 'A5');
    loadStack(control, s, APIARY, 'A5', 2, 'orchard');
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(control, s, { type: 'visit', seat: APIARY, host: WHEAT, fee: 'A4' });
    expect(headDraw(applied.state)).toMatchObject({ see: 1, keep: 1, src: 'A16' });
  });

  /**
   * The rival route that DOES survive: the Apiary door sows from the visitor's
   * hand onto one of the VISITOR's buildings, so a meeple visit to an Apiary
   * seat is still a placement by somebody who is not A16's owner.
   */
  it('never fires when a RIVAL brings a building to 2', () => {
    const s = armBase();
    buildFor(visitArm, s, APIARY, 'A16');
    dealTo(visitArm, s, WHEAT, 'W5');
    buildFor(visitArm, s, WHEAT, 'W6');
    loadStack(visitArm, s, WHEAT, 'W6', 1, 'wheat'); // the sow takes it to 2
    s.turnPlayer = WHEAT;
    const applied = apply(visitArm, s, visitMove(WHEAT, APIARY, 'apiary'));
    const done = answerAll(applied.state, undefined, visitArm);
    expect(drawsFrom(done, 'A16')).toBe(0);
  });

  it('does not fire at stack position 3', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16', 'A4');
    dealTo(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A4', 2); // threshold 3: the payment makes it 3
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(drawsFrom(grown.state, 'A16')).toBe(0);
  });
});

/**
 * ⛔ A17 LOST ITS PRICE AND GAINED A GATE (v31, plan section 3.3), and the plan
 * says why the two had to move together: A17 priced a coin as a COST, and a cost
 * cannot be halved into a draw. So the £1 simply went, and what replaced it is
 * the word NEIGHBOUR.
 *
 * ⭐ THAT WORD IS THE WHOLE OF THE BALANCE. v31 lets a seat place its bonus card
 * on its OWN Notice Board, so without the guard this would be a free barn card
 * on every bonus slot a seat ever spends, needing nobody else at the table at
 * all. `afterVisit` carries a `self` boolean for exactly this, and A17 is its
 * first reader.
 *
 * Two tests are deleted with the price: "is never asked when the visitor
 * cannot afford £1" (there is no wallet to be empty), and "does not fire a
 * second time on a Helping Hand repeat" (A Helping Hand is a bonus-slot
 * modifier now and has no repeat). A THIRD test, "is optional - a skip is
 * offered and takes no coin", came back on 18/09/2026 for an unrelated
 * reason: every `sowFromDeck` push shipped declinable that day to fix a UI
 * dead end, so A17 offered a skip again, this time for free rather than as a
 * coin refusal. ⭐ RE-CONFIRMED CORRECT ON 19/09/2026, for its OWN reason
 * this time: THE PRINTED TEXT GOVERNS (Dean), and the v44 sheet retexted
 * this card to "you may SOW", so A17 stays declinable on its own merits
 * rather than as a side effect of the 18/09/2026 blanket fix, which is
 * reversed everywhere else (A8, W5, the generic Apiary door).
 */
describe('A17 The Smoke Pot - at the end of your turn, move 1 card off one of your Notice Boards to your Barn', () => {
  /**
   * v49 sheet retext (26/09/2026, `tasks/v49-sheet-a11-a17-pass.md`): the
   * SOURCE changes from any one of the owner's full buildings to any one of
   * the owner's Notice Boards, at any count. The trigger (`beforeTurnEnd`,
   * the fixed once-a-turn seam O17 The Fruit Basket, V17 and O18 already
   * use) and the destination (the Barn, via `stackCardToBarn`, no Harvest
   * hook) are unchanged.
   */
  function drainViaApply(state: GameState): GameState {
    let s = state;
    for (let guard = 0; guard < 20 && s.tasks.length > 0; guard++) {
      const head = s.tasks[0] as Task;
      const answers = pendingAnswers(data, s);
      const answer = (answers.find((a) => a.kind !== 'skip') ?? answers[0]) as TaskAnswer;
      s = apply(data, s, { type: 'task', seat: head.pid, answer }).state;
    }
    return s;
  }

  /**
   * ⭐ NAMED BY CROP, NEVER BY CARD ID (the hidden-information fix that
   * already held on the full-buildings version): `buildingView` (view.ts)
   * shows a stack, its owner's own and a Notice Board's included, as suit
   * letters only, so the answer cannot name a specific card - it names a
   * crop, and a mixed stack proves the answer is one PER CROP, never one
   * per card.
   */
  it("moves a card from the owner's Notice Board to the barn, one answer per crop", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    loadStack(data, s, APIARY, 'A3', 1, 'orchard');
    loadStack(data, s, APIARY, 'A3', 1, 'wheat'); // the owner's own Notice Board, two crops
    const [orchardCard, wheatCard] = buildingOf(s, APIARY, 'A3').stack;
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    expect(held.tasks).toEqual([
      { t: 'card', pid: APIARY, src: 'A17', kind: 'smokePotMove', riders: {} },
    ]);

    const answers = pendingAnswers(data, held);
    expect(answers).toContainEqual({ kind: 'skip' });
    expect(answers).toContainEqual({ kind: 'card', payload: { building: 'A3', crop: 'orchard' } });
    expect(answers).toContainEqual({ kind: 'card', payload: { building: 'A3', crop: 'wheat' } });
    expect(answers).toHaveLength(3);

    const move = apply(data, held, {
      type: 'task',
      seat: APIARY,
      answer: { kind: 'card', payload: { building: 'A3', crop: 'orchard' } },
    }).state;
    expect(buildingOf(move, APIARY, 'A3').stack).toEqual([wheatCard]);
    expect(player(move, APIARY).barn).toContain(orchardCard);
    expect(player(move, APIARY).barn).not.toContain(wheatCard);
    expect(move.turnPlayer).toBe(WHEAT);
  });

  it('a stack with two cards of the SAME crop offers just one answer for it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    loadStack(data, s, APIARY, 'A3', 2, 'orchard'); // the Notice Board, both orchard
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    const answers = pendingAnswers(data, held);
    expect(answers).toEqual([
      { kind: 'card', payload: { building: 'A3', crop: 'orchard' } },
      { kind: 'skip' },
    ]);
  });

  it('declining leaves the Notice Board exactly as loaded as it was', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    loadStack(data, s, APIARY, 'A3', 2, 'orchard');
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    const declined = apply(data, held, {
      type: 'task',
      seat: APIARY,
      answer: { kind: 'skip' },
    }).state;
    expect(buildingOf(declined, APIARY, 'A3').stack).toHaveLength(2);
    expect(declined.turnPlayer).toBe(WHEAT);
  });

  /** An ordinary building, full or not, is never a legal source any more. */
  it('never offers an ordinary full building', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17', 'A5', 'A7'); // A5: threshold 2, A7: threshold 3
    loadStack(data, s, APIARY, 'A5', 2, 'orchard'); // full
    loadStack(data, s, APIARY, 'A7', 3, 'orchard'); // full
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    expect(held.tasks).toEqual([]);
  });

  /**
   * Dean's two-board fix (11/09/2026): at two seats `base()` deals the
   * Apiary seat a second Notice Board, D3 (Dairy, the first unfarmed suit
   * in catalogue order - see `dealExtraNoticeBoards`, setup.ts). Either
   * board is a legal source.
   */
  it("at 2 players, either of the owner's two boards is offered", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    expect(
      noticeBoardsOf(data, s, APIARY)
        .map((b) => b.card)
        .sort(),
    ).toEqual(['A3', 'D3']);
    loadStack(data, s, APIARY, 'A3', 1, 'wheat');
    loadStack(data, s, APIARY, 'D3', 1, 'dairy');
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    const offered = pendingAnswers(data, held)
      .flatMap((a) => (a.kind === 'card' ? [(a.payload as { building: string }).building] : []))
      .sort();
    expect(offered).toEqual(['A3', 'D3']);
  });

  /**
   * The move is a placement into the Barn, NOT a Harvest: no When-Harvested
   * text fires. W16 The Granary ("whenever you harvest, if hand <=5, Draw 1")
   * is built and its hand would otherwise gain a card; it must not.
   */
  it('fires no Harvest hooks: W16 does not draw', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17', 'W16');
    loadStack(data, s, APIARY, 'A3', 1, 'wheat');
    const before = player(s, APIARY).hand.length;
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    const state = answerAll(held);
    expect(player(state, APIARY).hand.length).toBe(before);
    expect(player(state, APIARY).barn).toHaveLength(1);
  });

  it('never offers a rival building, and never fires on a rival turn end', () => {
    // Seats flipped from base(): seat 0 is Wheat, seat 1 is Apiary (A17's
    // owner), so ending seat 0's turn must never touch it.
    const s = makeState(data, ['wheat', 'apiary']);
    buildFor(data, s, 1, 'A17');
    loadStack(data, s, 1, 'A3', 2, 'orchard'); // 1's own Notice Board (Apiary suit)
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: 0 }).state;
    expect(out.tasks).toEqual([]);
    expect(player(out, 1).barn).toHaveLength(0);
  });

  it('not offered when no board of the owner holds a card', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17', 'A5');
    loadStack(data, s, APIARY, 'A5', 2, 'orchard'); // an ordinary full building: never a source
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    expect(held.tasks).toEqual([]);
    const state = drainViaApply(held);
    expect(player(state, APIARY).barn).toHaveLength(0);
  });

  /**
   * View-safety: the answer is `{ building, crop }` and never carries a card
   * id, exactly as the hidden-information fix requires (a stack is shown to
   * every seat, its owner included, as suit letters only).
   */
  it('answers carry no card id', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    loadStack(data, s, APIARY, 'A3', 1, 'wheat');
    s.turn.actionSpent = true;
    const held = apply(data, s, { type: 'endTurn', seat: APIARY }).state;
    const answers = pendingAnswers(data, held);
    for (const a of answers) {
      if (a.kind === 'card') {
        expect(Object.keys(a.payload as object).sort()).toEqual(['building', 'crop']);
      }
    }
  });
});

describe('the endgame cards - A19, A20, A21', () => {
  /**
   * ⭐ v48 retext (24/09/2026, R5, `tasks/v48-rulings-v2.md`): "tractor
   * building" = a Power card, of ANY suit, own suit included (unlike the old
   * card, which excluded Apiary). 2 VP each.
   */
  it('A19 scores 2 VP for each Power card built, of any suit', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A19', 'A16', 'W16', 'D16');
    // Three Power cards (A16 apiary, W16 wheat, D16 dairy) at 2 VP each = 6.
    // A2 the Farmstead's own-crop scorer adds 1 for A19 and 1 for A16 (both
    // apiary-suit deck cards) = 2.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(6 + 2);
  });

  /** Ordinary buildings (any tier, any suit) are never tractor buildings. */
  it('does not count ordinary buildings, only Power cards', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A19', 'A5', 'W5', 'O4');
    // A5, W5 and O4 are Tier 1 buildings, not Power cards: 0 tractor buildings.
    // A2 counts the apiary-suit deck cards built: A19 and A5 = 2.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(0 + 2);
  });

  /**
   * `rules.economy.honeyHallCap` is RE-POINTED, not replaced (v45 R9's knob,
   * re-read against the v48 rate): it caps the VP directly, shipped at 6 to
   * match the printed "(Max 6VP)" now that the rate is 2 VP per card. Four
   * Power cards at 2 VP each = 8, against the cap of 6.
   */
  it('A19 respects honeyHallCap, shipped at 6VP (capping VP, not the count)', () => {
    const uncapped = loadGameData({
      name: 'a19-cap-none',
      schemaVersion: 1,
      set: { 'rules.economy.honeyHallCap': null },
    });
    const powers = ['W16', 'W17', 'D16', 'D17'] as const; // four Power cards, 2VP each = 8
    const open = base();
    buildFor(uncapped, open, APIARY, 'A19', ...powers);
    const shut = base();
    buildFor(data, shut, APIARY, 'A19', ...powers);
    // A2's 1 for A19 itself (apiary suit; the four Power cards are all
    // foreign suits), plus A19's own count: 8 VP uncapped, against 6 VP
    // capped (shipped).
    expect(gameEndScores(uncapped, open)[APIARY]?.endgame).toBe(8 + 1);
    expect(gameEndScores(data, shut)[APIARY]?.endgame).toBe(6 + 1);
  });

  it('A20 scores 1 for each 1VP building built, of any suit (v42)', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A20', 'A4', 'A8', 'A13', 'A9', 'W4');
    // A20's 3 for A4, A8 and W4 (printed 1 VP); A13 prints 3 and A9 prints 2.
    // Plus A2's 5 for the five Apiary cards built.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(8);
  });

  /**
   * `rules.economy.apiaristsGuildCap` (v45, 19/09/2026, R9): the printed
   * "(Max 5)" is a tunable number on the `grandGranaryCap` pattern. Six 1VP
   * buildings against a cap of 5.
   */
  it('A20 respects apiaristsGuildCap, shipped at 5', () => {
    const uncapped = loadGameData({
      name: 'a20-cap-none',
      schemaVersion: 1,
      set: { 'rules.economy.apiaristsGuildCap': null },
    });
    // All six print exactly 1 VP.
    const oneVp = ['W4', 'W5', 'W6', 'W7', 'W8', 'D4'] as const;
    const open = base();
    buildFor(uncapped, open, APIARY, 'A20', ...oneVp);
    const shut = base();
    buildFor(data, shut, APIARY, 'A20', ...oneVp);
    // A2's 1 for A20 itself, plus A20's own count: 6 uncapped, against 5
    // capped (shipped).
    expect(gameEndScores(uncapped, open)[APIARY]?.endgame).toBe(7);
    expect(gameEndScores(data, shut)[APIARY]?.endgame).toBe(6);
  });

  /** ⚠️ STARTERS COUNT if they hold a card - a clogged Notice Board or Service included. */
  it('A21 scores 1 for each of your buildings with a card on it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A21', 'A5', 'A10');
    // A2's 3 for the three Apiary cards built is the floor every line below
    // sits on; A21 itself scores nothing while every stack is empty.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(3);
    loadStack(data, s, APIARY, 'A5', 1);
    // A starter holding a card - the Barn, since no seat has a Notice Board
    // under the commons (C1). ⭐ AND THAT IS THE CARD'S REAL LOSS, written down
    // rather than left in a comment nobody reads: A21 counts YOUR OWN tableau,
    // so the five central piles can never count for it however deep they get.
    loadStack(data, s, APIARY, 'A1', 1, 'wheat');
    // 2 loaded buildings, not 3: change 6 removed A0 the Service as one.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(3 + 2);
  });
});

describe('difficulty metadata stays honest for the Apiary suit', () => {
  it('the derivable flags match each handler structure', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'apiary' && x.enabled)) {
      const h = handlerFor(c.id);
      expect(h, c.id).toBeDefined();
      expect(h?.difficulty.verified.endgame, c.id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, c.id).toBe(typeof h?.moves === 'function');
    }
  });

  /**
   * ⛔ THE INVERSION. This case used to assert that A13, A14 and A15 printed no
   * threshold, no activation type, an `['action']` trigger and a handler
   * declaring `actionMoves`. Every one of those flipped on 19/08/2026: they are
   * GROW buildings with thresholds and a wild activation, and no handler in the
   * suit contributes a standing move at all.
   */
  it('the three Tier 3 cards are ordinary GROW buildings, not ACTIONs', () => {
    // v48: A15's threshold rises 1 to 3 (data only, R15); A13 and A14 are unmoved.
    const thresholds: Record<string, number> = { A13: 1, A14: 2, A15: 3 };
    for (const id of ['A13', 'A14', 'A15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).toBe(thresholds[id]);
      expect(card?.activationType, id).toBe('wild');
      expect(card?.abilityTrigger, id).toEqual(['onActivate']);
      // ⛔ `actionMoves` no longer EXISTS on CardHandler (19/08/2026), so this
      // reads the object rather than the type: a property that is gone cannot
      // be asserted undefined, and `in` is what still fails loudly if someone
      // puts the concept back.
      expect('actionMoves' in (handlerFor(id) as object), id).toBe(false);
      expect(typeof handlerFor(id)?.activate, id).toBe('function');
    }
  });

  /**
   * ⚠️ THE SUIT REACHES ANOTHER SEAT'S ZONES THROUGH A8 AND NOTHING ELSE. A4,
   * A14 and A15 all lost their cross-table halves in the same pass, taking
   * Apiary from four cross-table cards to one - which is the plan's balance
   * flags 8.1 and 8.2 seen from the engine's side, and the reason this case
   * asserts the FULL list rather than a sample.
   */
  it('the declared crossPlayer flags match live audits', () => {
    const cross = data.cards.catalogue
      .filter((c) => c.suit === 'apiary' && c.enabled)
      .filter((c) => handlerFor(c.id)?.difficulty.verified.crossPlayer === true)
      .map((c) => c.id);
    // ⛔ A18 A HELPING HAND HAS DROPPED OFF THIS LIST (v31). Its old text placed
    // a second card on a rival's board, so it crossed the table by construction;
    // its rewrite is a bonus-slot modifier that does nothing to anybody by
    // itself, and whether the extra option is spent on a neighbour is the
    // holder's choice. So the suit is down to ONE cross-table card, A8, out of
    // the 18 in the deck - the plan's balance flags 8.1 and 8.2 seen from the
    // engine's side.
    // ⭐ v42: A10 sows onto a neighbour's building again, so the list is two.
    // ⭐ v48: A8 is now an own-farm Deliver (R8) and A10 a visit paid with a
    // deck card (R2, R9). ⭐ A15 JOINS THE LIST THE SAME PASS: it dispatches a
    // discarded Tier card's own activated line directly (R1/R6), and when that
    // card is A10 the forwarded line is A10's own cross-table visit - a real
    // primitive targeting another seat, same as A10 firing on its own. So the
    // suit is back to TWO cross-table cards, not one, but for a different
    // reason than v42's: A15 crosses the table only through what it discards.
    expect(cross.sort()).toEqual(['A10', 'A15']);

    const s = base();
    buildFor(data, s, APIARY, 'A10', 'A5');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 1); // the Wheat board's power is live
    const grown = growBuilding(data, s, APIARY, 'A10', 'A4');
    const visited = answerTask(data, grown.state, {
      kind: 'card',
      payload: { host: WHEAT, board: 'W3', suit: 'wheat' },
    });
    expect(visited.audit.crossSeat).toBe(true);
  });

  /**
   * ⭐ v48: A15's OWN crossPlayer claim, proved live rather than trusted from
   * the declared flag above. A15 discards A10 from hand and runs A10's own
   * activated line (the visit) AS A10 - the listener-trap forwarding does not
   * apply here (that is `afterBuild`, for D5/D7's follow-up); a plain
   * `activate` call is enough, since A10's own `activate` pushes the
   * `crossVisit` task directly.
   */
  it('A15 crosses the table when the discarded card is A10', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15', 'A5'); // A5 auxiliary: see below
    dealTo(data, s, APIARY, 'A4', 'A10'); // A4 pays A15's wild GROW; A10 stays for the discard
    loadStack(data, s, APIARY, 'A5', 1); // A5 full, so the Wheat board's Harvest half is legal
    const grown = growBuilding(data, s, APIARY, 'A15', 'A4');
    const discarded = answerTask(data, grown.state, {
      kind: 'card',
      payload: { card: 'A10' },
    });
    const visited = answerTask(data, discarded.state, {
      kind: 'card',
      payload: { host: WHEAT, board: 'W3', suit: 'wheat' },
    });
    expect(visited.audit.crossSeat).toBe(true);
  });
});

describe('a full Apiary turn still settles', () => {
  it('grows, fires, sows and drains without wedging', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A12', 'A9', 'A5', 'A7', 'A16');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A4', 'A6', 'W5'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, WHEAT, 'W4', 1, 'wheat');
    const grown = apply(data, s, {
      type: 'grow',
      seat: APIARY,
      building: 'A12',
      payment: 'A4',
    });
    const state = answerAll(grown.state);
    expect(state.tasks).toHaveLength(0);
  });
});
