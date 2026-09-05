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

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
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

function headDraw(state: GameState): Extract<Task, { t: 'draw' }> {
  const head = state.tasks[0];
  if (!head || head.t !== 'draw') throw new Error('Expected a draw task at the head');
  return head;
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

describe('A5 The Meadow Hive - the activation with no placement', () => {
  it('fires another of your buildings, placing nothing on it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(pendingAnswers(data, grown.state)).toEqual([{ kind: 'activate', card: 'A10' }]);

    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'A10' });
    // A10 fired (Draw 1 per HIVE, and A5 is the one HIVE) with an empty stack.
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toEqual([]);
    expect(headDraw(fired.state)).toMatchObject({ see: 1, keep: 1, src: 'A10' });
  });

  /** The target set is deliberately WIDER than a GROW's: nothing is being placed. */
  it('a FULL building is a legal target, where a GROW refuses it', () => {
    const s = base();
    // ⚠️ CARD-ONLY: a meeple-paid GROW places nothing either, so it takes a full
    // building too (R15) and the contrast this case draws would vanish.
    noMeeples(s);
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A10', 2); // threshold 2: full and clogged
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'A10')).toBe(false);

    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(pendingAnswers(data, grown.state)).toEqual([{ kind: 'activate', card: 'A10' }]);
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'A10' });
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toHaveLength(2); // no stack advance
  });

  /** ⛔ Never your Notice Board, never your Service: firing a Service would sell a bonus slot. */
  it('never offers the Notice Board or the Service', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(activateTask(grown.state).targets).toEqual(['A10']);
  });

  it('auto-skips with nothing to fire', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A6 The Garden Hive - the crop waiver, and the only place it survives', () => {
  it('grows another of your buildings with a card of ANY crop', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A6', 'A10');
    dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');

    const anyCrop = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'A10' && a.payload.payment === 'W4',
    );
    expect(anyCrop).toBeDefined();
    const fired = answerTask(data, grown.state, anyCrop as TaskAnswer);
    // A REAL grow: the card lands on the stack and the ability fires.
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toEqual(['W4']);
    expect(headDraw(fired.state)).toMatchObject({ src: 'A10' });
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
    loadStack(data, s, APIARY, 'A11', 2); // threshold 2: full
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

describe('A7 The Foraging Hive - the mandatory sow', () => {
  it('sows 1 card from hand onto ANOTHER of your buildings, suit-free', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7', 'A10');
    dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A7', 'A4');
    const sow = grown.state.tasks.find((t) => t.t === 'sow');
    if (sow?.t !== 'sow') throw new Error('expected a sow task');
    expect(sow.optional).toBeUndefined(); // imperative = mandatory
    expect(sow.targets?.map((r) => r.card)).not.toContain('A7');
    // Your own Notice Board and Service are ordinary sow targets.
    // A0 the Service is gone (change 6); the Notice Board A3 is still a target.
    expect(sow.targets?.map((r) => r.card)).toEqual(expect.arrayContaining(['A3', 'A10']));

    const wheatSow = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'sow' && a.card === 'W4' && a.onto === 'A10',
    );
    expect(wheatSow).toBeDefined();
    const sown = answerTask(data, grown.state, wheatSow as TaskAnswer);
    expect(buildingOf(sown.state, APIARY, 'A10').stack).toEqual(['W4']);
  });

  it('auto-skips with an empty hand', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A7', 'A10');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A7', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A8 The Wild Hive - the gift that pays, and the suit’s last cross-table card', () => {
  /**
   * ⛔ THE £2 IS A DRAW 1 (v31, plan section 3.3). The conversion rate is flat -
   * both £1 and £2 read Draw 1 - so in nominal terms this card was halved after
   * the 19/08/2026 pass had doubled it. In real terms it went up: a coin was
   * never worth a card here, and seats ended games on about £1.
   */
  it("puts a deck top into a neighbour's BARN and draws 1 back", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    const wheatTop = s.decks.wheat[0] as string;
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    const gift = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.seat === WHEAT && a.payload.suit === 'wheat',
    );
    const done = answerTask(data, grown.state, gift as TaskAnswer);
    // Straight into the barn: no threshold advanced, no clog caused.
    expect(player(done.state, WHEAT).barn).toEqual([wheatTop]);
    // ...and the payout is a card, queued as an ordinary card-ability draw.
    expect(headDraw(done.state)).toMatchObject({ see: 1, keep: 1, src: 'A8' });
  });

  /** ⚠️ NO ELIGIBLE RECIPIENT MEANS NO PAYOUT - it is paid for the gift. */
  it('draws nothing when every deck is dry', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, APIARY).hand).toEqual([]);
  });

  /**
   * ⛔ ITS £1 ACTIVATION SURCHARGE HAS BEEN GONE SINCE THE REBUILD, and since
   * v31 `activationSurchargeOf` is gone from the engine with the currency. The
   * PATTERN was right and is worth reusing if a toll ever returns priced in
   * cards: keyed on a data trigger so no funnel names a card, checked in the
   * enumerator so an unaffordable target is never offered, charged in the funnel
   * so the two cannot disagree.
   */
  it('costs nothing but the payment card to activate', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'A8')).toBe(true);
    for (const id of ['A8']) {
      expect(data.cards.catalogue.find((c) => c.id === id)?.abilityTrigger).not.toContain(
        'activationSurcharge',
      );
    }
  });
});

describe('A9 The Pollinator Trail - fuel the row', () => {
  it('queues one deck-sow per HIVE with room, each naming that HIVE alone', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A9', 'A5', 'A7', 'A11');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2); // threshold 2: full, so skipped
    const grown = growBuilding(data, s, APIARY, 'A9', 'A4');
    const sows = grown.state.tasks.filter((t) => t.t === 'sowFromDeck');
    // A7 only: A5 is full, A9 and A11 are not HIVEs.
    expect(sows.map((t) => (t.t === 'sowFromDeck' ? t.targets : null))).toEqual([
      [{ seat: APIARY, card: 'A7' }],
    ]);
    const state = answerAll(grown.state);
    expect(buildingOf(state, APIARY, 'A7').stack).toHaveLength(1);
  });
});

describe('A10 The Cross-Pollinator - feed the hand', () => {
  it('draws 1 for each HIVE BUILT, and The Queen’s Hive is not one', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A10', 'A4', 'A5', 'A13');
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A10', 'A6');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2, src: 'A10' });
  });

  it('queues nothing with no HIVE built', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A10');
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A10', 'A6');
    expect(grown.state.tasks).toHaveLength(0);
  });
});

describe('A11 The Wax Workshop - skim the row', () => {
  it('takes ONE card per loaded HIVE, not one per card on the stack', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5', 'A7');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2);
    loadStack(data, s, APIARY, 'A7', 1);
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    expect(grown.state.tasks.filter((t) => t.t === 'card')).toHaveLength(2);

    const state = answerAll(grown.state);
    expect(buildingOf(state, APIARY, 'A5').stack).toHaveLength(1); // reopened by one
    expect(buildingOf(state, APIARY, 'A7').stack).toHaveLength(0);
    expect(player(state, APIARY).barn).toHaveLength(2);
  });

  /** Not a harvest: stackCardToBarn, so no afterHarvest fires. */
  it('is not a harvest', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11', 'A5', 'W16'); // W16: "whenever you harvest, Draw 1"
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 2);
    const grown = growBuilding(data, s, APIARY, 'A11', 'A4');
    const state = answerAll(grown.state);
    expect(drawsFrom(state, 'W16')).toBe(0);
  });

  it('skips a HIVE with an empty stack', () => {
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
  it('puts the top card of EACH deck into your own barn, with nothing to choose', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    dealTo(data, s, APIARY, 'A4');
    const tops = data.cards.suits.map((suit) => s.decks[suit][0] as string);

    const grown = growBuilding(data, s, APIARY, 'A13', 'A4');
    // ⛔ ALL TARGETING IS DELETED: no sowFromDeck, no task of any kind.
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, APIARY).barn).toEqual(tops);
  });

  /**
   * It is a GROW now, so the GROW runtime spends the action, not the handler.
   *
   * ⚠️ THIS ASSERTION HAS NOW MOVED TWICE, BOTH TIMES FOR A RULE. It first read
   * `turn.actionSpent === true` after the apply; under the 19/08/2026
   * start-of-turn bonus slot, spending the action shut the bonus window too, so
   * `settleTurn` ENDED THE TURN in the same call and replaced the very turn
   * object being read - and the turn passing on became the observable instead.
   *
   * ⭐ Since 03/09/2026 (`rules.turn.bonusTiming: 'end'`) the action OPENS the
   * bonus window rather than shutting it, so the turn no longer ends here and
   * the flag survives the apply. The direct assertion is available again, and
   * the turn STAYING is now the second half of the same observable.
   */
  it('is an ordinary GROW: wild activation, and the action is spent by the runtime', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    dealTo(data, s, APIARY, 'W4'); // a WHEAT card: activationType is wild
    expect(growMoveFor(s, 'A13')).toBeDefined();
    const played = apply(data, s, { type: 'grow', seat: APIARY, building: 'A13', payment: 'W4' });
    expect(played.state.turn.actionSpent).toBe(true);
    expect(played.state.turnPlayer).toBe(APIARY); // the bonus slot is now open
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

describe('A14 The Honeycomb Tower - the faucet with its brake removed', () => {
  /**
   * ⚠️⚠️ BALANCE FLAG 8.1, REPOINTED RATHER THAN CLOSED. What it said in v30:
   * the game's only repeatable COIN faucet, with its throttling sow deleted and
   * its rate doubled to £2 per HIVE. v31 converts it to Draw 1 per HIVE, which
   * fixes one of those four things and makes one worse - the unbounded currency
   * is gone, but the faucet now pours into the resource the game actually clocks
   * on. `a14-coin-faucet` becomes `a14-card-faucet`, read against TOTAL CARDS
   * DRAWN and never against this card's own play rate.
   */
  it('draws 1 per HIVE and nothing else happens', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4', 'A5');
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(headDraw(grown.state)).toMatchObject({ see: 2, keep: 2, src: 'A14' }); // two HIVEs
    expect(grown.state.tasks).toHaveLength(1);
  });

  /** ⛔ THE SOW IS GONE: no rival building is touched, on any board state. */
  it("never places a card on a neighbour's farm any more", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4');
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(grown.audit.crossSeat).toBe(false);
    const onWheat = player(grown.state, WHEAT).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onWheat).toBe(0);
  });

  /**
   * It used to be gated on a legal rival target existing, so a clogged table
   * silenced it. Nothing gates it now - which IS the removed brake, stated as a
   * test rather than left as a comment.
   */
  it('fires with the whole table clogged, where the old version was not even offered', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4');
    dealTo(data, s, APIARY, 'A6');
    // Change 6: the Wheat seat has ONE rival-touchable building, so clogging the
    // whole table is clogging the Notice Board alone.
    loadStack(data, s, WHEAT, 'W3', 2, 'wheat');
    expect(growMoveFor(s, 'A14')).toBeDefined();
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A14' });
  });

  it('draws nothing with no HIVE built, and is still a legal GROW', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14');
    dealTo(data, s, APIARY, 'A6');
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(grown.state.tasks).toHaveLength(0);
  });

  /** Threshold 2, and that clog is now the only brake left on the card. */
  it('takes two cards to clog, which is the last brake it has', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14');
    dealTo(data, s, APIARY, 'A6', 'A7'); // A7 is the spare, so the hand is not the reason
    loadStack(data, s, APIARY, 'A14', 1);
    expect(growMoveFor(s, 'A14')).toBeDefined(); // one space left
    const grown = growBuilding(data, s, APIARY, 'A14', 'A6');
    expect(buildingOf(grown.state, APIARY, 'A14').stack).toHaveLength(2);
    expect(growMoveFor(grown.state, 'A14')).toBeUndefined();
  });
});

describe('A15 The Royal Apiary - the draw that counts your loaded buildings', () => {
  /**
   * ⚠️ RULED: A15 COUNTS ITSELF. Threshold 1, so the GROW payment lands on it
   * before `activate` runs and it is always one of the buildings with a card on
   * it. The floor is Draw 1, never Draw 0 - the same reading as A4, and the
   * same predicate A21 The Wax Hall scores on.
   */
  it('counts itself, so a bare farm still draws 1', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A15', 'A4');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A15' });
  });

  /** STARTERS COUNT if they hold a card - a visited Notice Board or Service included. */
  it('counts every loaded building, starters included', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15', 'A5', 'A10');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A5', 1);
    loadStack(data, s, APIARY, 'A3', 1, 'wheat'); // the Notice Board, visited once
    // A5, A3 and A15 itself; A10 is empty and does not count. Change 6 removed
    // A0 the Service, so this is 3 where it used to be 4.
    const grown = growBuilding(data, s, APIARY, 'A15', 'A4');
    expect(headDraw(grown.state)).toMatchObject({ see: 3, keep: 3, src: 'A15' });
  });

  /** Fired without a placement there is no payment, so it does not count itself. */
  it('fired by A5 with no placement, it does not count itself', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A15', 'A10');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, APIARY, 'A10', 1);
    const grown = growBuilding(data, s, APIARY, 'A5', 'A4');
    const fired = answerTask(data, grown.state, { kind: 'activate', card: 'A15' });
    // A5 holds the payment, A10 holds a card; A15 itself is empty.
    expect(headDraw(fired.state)).toMatchObject({ see: 2, keep: 2, src: 'A15' });
  });

  /** ⛔ THE CROSS-TABLE GIFT AND ITS £2-A-CARD FAUCET ARE BOTH GONE. */
  it('gives a neighbour nothing at all', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A15', 'A4');
    expect(grown.audit.crossSeat).toBe(false);
    expect(player(grown.state, WHEAT).barn).toEqual([]);
    expect(player(grown.state, WHEAT).hand).toEqual([]);
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
    const s = base();
    buildFor(data, s, APIARY, 'A16');
    loadStack(data, s, APIARY, 'A3', 1, 'apiary');
    dealTo(data, s, WHEAT, 'W5');
    buildFor(data, s, WHEAT, 'W6');
    loadStack(data, s, WHEAT, 'W6', 1, 'wheat'); // the sow takes it to 2
    s.turnPlayer = WHEAT;
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(data, s, visitMove(WHEAT, APIARY, 'apiary'));
    const done = answerAll(applied.state);
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
 * Three tests are deleted with the price: "is optional - a skip is offered and
 * takes no coin" (there is no cost left to decline, and the text prints "add",
 * not "you may"), "is never asked when the visitor cannot afford £1" (there is
 * no wallet to be empty), and "does not fire a second time on a Helping Hand
 * repeat" (A Helping Hand is a bonus-slot modifier now and has no repeat).
 */
describe('A17 The Smoke Pot - a free barn card for visiting a neighbour', () => {
  /**
   * A visit that is legal for the visitor: the Wheat door needs a full building.
   * Paid in a meeple since 04/09/2026, which is exactly what the card cannot
   * see - it reads `afterVisit`, and the currency change was built to leave that
   * hook alone.
   */
  function visitTheWheatSeat(s: GameState) {
    buildFor(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A5', 2, 'orchard');
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    return apply(data, s, visitMove(APIARY, WHEAT, 'wheat'));
  }

  it('adds the top card of a deck of your choice into your BARN, free', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    const wheatTop = s.decks.wheat[0] as string;

    const applied = visitTheWheatSeat(s);
    expect(tasksFrom(applied.state, 'A17')).toHaveLength(1);

    // The player chooses WHICH deck; the card is the top of it, not a choice.
    const decks = offered(applied.state).map((p) => p.suit);
    expect(new Set(decks)).toEqual(new Set(data.cards.suits));

    const buy = pendingAnswers(data, applied.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    );
    const state = answerTask(data, applied.state, buy as TaskAnswer).state;
    expect(player(state, APIARY).barn).toContain(wheatTop);
    // ⚠️ THE BARN, NOT A BUILDING: no threshold of the visitor's has moved.
    const onOwn = player(state, APIARY).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onOwn).toBe(2); // the two cards loaded onto A5 by the fixture, and no more
  });

  /**
   * ⛔ MANDATORY, NOT OPTIONAL. The printed text says "add", not "you may", and
   * with no price there is nothing to decline. The old card offered a skip
   * beside its £1; asserting the skip is ABSENT is what stops it drifting back
   * in as a courtesy.
   */
  it('offers no skip: the text says "add", not "you may"', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    const applied = visitTheWheatSeat(s);
    expect(pendingAnswers(data, applied.state)).not.toContainEqual({ kind: 'skip' });
  });

  /**
   * ⭐ THE SELF-VISIT GATE, and it is the single most important assertion in
   * this file after v31. Without it the card pays out on the SOLITAIRE half of
   * the bonus slot - which is risk 2 of the whole pass - and would need nobody
   * else at the table.
   */
  it('does NOT fire on a SELF-visit under the v31 control: a neighbour means a neighbour', () => {
    const control = cardVisitGame();
    const s = makeState(control, ['apiary', 'wheat']);
    buildFor(control, s, APIARY, 'A17', 'A11');
    dealTo(control, s, APIARY, 'A4', 'A5'); // the Apiary door sows a second card
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(control, s, { type: 'visit', seat: APIARY, host: APIARY, fee: 'A4' });
    expect(tasksFrom(applied.state, 'A17')).toEqual([]);
  });

  it('never fires when the owner is the one being VISITED', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    dealTo(data, s, WHEAT, 'W5');
    buildFor(data, s, WHEAT, 'W6'); // somewhere for the Apiary door to sow
    s.turnPlayer = WHEAT;
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(data, s, visitMove(WHEAT, APIARY, 'apiary'));
    expect(tasksFrom(applied.state, 'A17')).toEqual([]);
  });

  it('adds nothing when every deck is dry, and leaves no dead prompt', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    buildFor(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A5', 2, 'orchard');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(data, s, visitMove(APIARY, WHEAT, 'wheat'));
    // The task is pushed unconditionally and gated in the ENUMERATOR: with no
    // live deck it has no legal answer, so the drain loop inside `apply` drops
    // it and no dead prompt ever reaches a player.
    expect(tasksFrom(applied.state, 'A17')).toEqual([]);
    const state = answerAll(applied.state);
    // The barn holds only what the Wheat door's harvest put there - the two
    // cards the fixture loaded onto A5 - and nothing the Smoke Pot added.
    expect(player(state, APIARY).barn).toHaveLength(2);
  });
});

describe('the endgame cards - A19, A20, A21', () => {
  it('A19 scores 3 for each non-Apiary building built', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A19', 'A5', 'W5', 'O4');
    // A19's 6 for the two foreign cards, plus A2 the Farmstead's 2 for A19 and
    // A5. The two cards point in opposite directions on the same tableau, which
    // is the one place in the suit where breadth and loyalty are both paid.
    // ⛔ A starter can never count for either: it prints the generic
    // starting-building icon and belongs to no crop, and since v31 there is no
    // flipped face to give it one.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(8);
  });

  it('A20 scores 2 for each HIVE built, The Queen’s Hive excluded', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A20', 'A4', 'A8', 'A13', 'A9');
    // A20's 4 for A4 and A8, plus A2's 5 for the five Apiary cards built.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(9);
  });

  /** ⚠️ STARTERS COUNT if they hold a card - a clogged Notice Board or Service included. */
  it('A21 scores 1 for each of your buildings with a card on it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A21', 'A5', 'A10');
    // A2's 3 for the three Apiary cards built is the floor every line below
    // sits on; A21 itself scores nothing while every stack is empty.
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(3);
    loadStack(data, s, APIARY, 'A5', 1);
    loadStack(data, s, APIARY, 'A3', 1, 'wheat'); // the Notice Board, visited once
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
    const thresholds: Record<string, number> = { A13: 1, A14: 2, A15: 1 };
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
    expect(cross.sort()).toEqual(['A8']);

    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    const gifted = answerTask(
      data,
      grown.state,
      pendingAnswers(data, grown.state)[0] as TaskAnswer,
    );
    expect(gifted.audit.crossSeat).toBe(true);
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
