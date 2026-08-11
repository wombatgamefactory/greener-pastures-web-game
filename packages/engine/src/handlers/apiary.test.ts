/**
 * The Apiary suit, all 21 cards, REBUILT (docs/apiary-suit-rebuild-v5.md, the
 * last of the five).
 *
 * The load-bearing pieces this file exists to pin down:
 *
 *   - HIVE is A4 to A8 and NOTHING else: A13 The Queen's Hive is named Hive and
 *     is a Tier 3 ACTION, so `isHiveCard` carries a tier guard;
 *   - an ACTIVATION WITH NO PLACEMENT (A5, A12) advances no stack, matches no
 *     crop, pays no surcharge, and MAY TARGET A FULL BUILDING - never your
 *     Notice Board and never your Service;
 *   - no card's text may fire twice in a turn (`turn.firedThisTurn`);
 *   - the Farmstead modifies the GROW ACTION, not card text that says GROW, so
 *     A5, A6 and A12 do not trigger it, and its draw is a card-ability draw;
 *   - a sow onto a neighbour's farm is NOT a visit (no bonus slot, no wage, no
 *     afterVisit) but it does fire afterPlacement, and a neighbour's Notice
 *     Board and Service are legal targets;
 *   - A4's card is TAKEN, not harvested, and the take resolves before the
 *     replacement lands;
 *   - A8, A14 and A15 pay no coins when there is no legal recipient.
 *
 * The two seams the old Farmstead owned - the suit-wide crop waiver and the
 * free follow-up sow - are both GONE, and the cases that asserted them with
 * them. The waiver survives only on A6; A7 prints the sow.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  applyCardMove,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  standingMoves,
} from '../runtime.js';
import { buildingOf, player } from '../query.js';
import type { GameState, Move, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
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

/** The standing ACTION move a built Tier 3 offers, if it is live. */
function actionMoveFor(state: GameState, card: string): Move | undefined {
  return legalMoves(data, state).find((m) => m.type === 'cardMove' && m.card === card);
}

/** Card payloads offered by whatever card task is at the head. */
function offered(state: GameState): Record<string, unknown>[] {
  return pendingAnswers(data, state).flatMap((a) => (a.kind === 'card' ? [a.payload] : []));
}

describe('HIVE sub-type membership (title keyword AND a tier guard)', () => {
  /**
   * ⛔ THE RULING THIS FILE EXISTS TO WRITE DOWN. A13 The Queen's Hive carries
   * the word and is a Tier 3 ACTION with no stack, so under the bare keyword
   * rule A9 and A11 would target a building that cannot hold cards and A10, A14
   * and A20 would count it.
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

describe('A1 Barn - the HIVE build rider', () => {
  it('sows a deck top onto the HIVE that just landed, on BOTH faces', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, APIARY, 'A1').upgraded = upgraded;
      dealTo(data, s, APIARY, 'A4', 'A5', 'A6'); // A4 costs 2 apiary cards
      const built = apply(data, s, {
        type: 'build',
        seat: APIARY,
        card: 'A4',
        payment: ['A5', 'A6'],
      });
      const sow = built.state.tasks.find((t) => t.t === 'sowFromDeck');
      expect(sow, `upgraded=${upgraded}`).toMatchObject({
        src: 'A1',
        targets: [{ seat: APIARY, card: 'A4' }],
      });
      const state = answerAll(built.state);
      expect(buildingOf(state, APIARY, 'A4').stack, `upgraded=${upgraded}`).toHaveLength(1);
    }
  });

  it('does not fire on a non-HIVE build', () => {
    const s = base();
    dealTo(data, s, APIARY, 'A9', 'A10', 'A11', 'A12'); // A9 costs 2 apiary + 1 wild
    const built = apply(data, s, {
      type: 'build',
      seat: APIARY,
      card: 'A9',
      payment: ['A10', 'A11', 'A12'],
    });
    expect(built.state.tasks.some((t) => t.t === 'sowFromDeck')).toBe(false);
  });

  it('does not fire on a RIVAL building a HIVE', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'A4', 'A5', 'A6');
    s.turnPlayer = WHEAT;
    const built = apply(data, s, { type: 'build', seat: WHEAT, card: 'A4', payment: ['A5', 'A6'] });
    expect(built.state.tasks.some((t) => t.t === 'sowFromDeck' && t.src === 'A1')).toBe(false);
  });
});

describe('A2 The Farmstead - a modifier on the GROW ACTION', () => {
  /** A2's draw hangs off apply()'s grow branch, so the ACTION is the only route to it. */
  function growAction(state: GameState, building: string, payment: string) {
    return apply(data, state, { type: 'grow', seat: APIARY, building, payment });
  }

  it('base face: the GROW action draws 1, as a card-ability draw', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A11'); // no HIVE loaded, so A11 itself queues nothing
    dealTo(data, s, APIARY, 'A4');
    const grown = growAction(s, 'A11', 'A4');
    expect(headDraw(grown.state)).toMatchObject({ see: 1, keep: 1, src: 'A2' });
    expect(grown.state.tasks.filter((t) => t.t === 'handToBarn')).toHaveLength(0);
  });

  it('upgraded face: the same draw plus one OPTIONAL card into the barn', () => {
    const s = base();
    buildingOf(s, APIARY, 'A2').upgraded = true;
    buildFor(data, s, APIARY, 'A11');
    dealTo(data, s, APIARY, 'A4', 'A5');
    const grown = growAction(s, 'A11', 'A4');
    expect(drawsFrom(grown.state, 'A2')).toBe(1);
    expect(grown.state.tasks.find((t) => t.t === 'handToBarn')).toMatchObject({
      src: 'A2',
      remaining: 1,
      optional: true,
    });
  });

  it('a non-Apiary seat never gets it', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, WHEAT, 'W5');
    s.turnPlayer = WHEAT;
    const grown = apply(data, s, {
      type: 'grow',
      seat: WHEAT,
      building: 'W4',
      payment: 'W5',
    });
    expect(drawsFrom(grown.state, 'A2')).toBe(0);
  });

  /**
   * RULED: the Farmstead modifies the GROW ACTION, not card text that says
   * GROW. Three activations in one action still draw exactly one card, or The
   * Honey Hut would draw three.
   */
  it('A5, A6 and A12 do not each trigger it', () => {
    const withA5 = (() => {
      const s = base();
      buildFor(data, s, APIARY, 'A5', 'A11');
      dealTo(data, s, APIARY, 'A4');
      const grown = growAction(s, 'A5', 'A4');
      return answerAll(
        grown.state,
        (a) => a.find((x) => x.kind === 'activate') ?? (a[0] as TaskAnswer),
      );
    })();
    expect(player(withA5, APIARY).hand).toHaveLength(1); // one card, from one draw

    const s = base();
    buildFor(data, s, APIARY, 'A12', 'A10', 'A11');
    dealTo(data, s, APIARY, 'A4');
    const grown = growAction(s, 'A12', 'A4');
    expect(drawsFrom(grown.state, 'A2')).toBe(1);
    const fired = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'activate') ?? (a[0] as TaskAnswer),
    );
    expect(fired.turn.firedThisTurn.sort()).toEqual(['A10', 'A11', 'A12']);

    const t = base();
    buildFor(data, t, APIARY, 'A6', 'A11');
    dealTo(data, t, APIARY, 'A4', 'W4');
    const viaA6 = growAction(t, 'A6', 'A4');
    expect(drawsFrom(viaA6.state, 'A2')).toBe(1);
  });
});

describe('A4 The Herb Hive - the card taken from across the table', () => {
  it('takes a card into your barn and sows a deck top in its place', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A5');
    loadStack(data, s, WHEAT, 'W4', 2, 'wheat'); // threshold 2: FULL
    const loaded = [...buildingOf(s, WHEAT, 'W4').stack];

    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    const targets = offered(grown.state);
    expect(targets).toHaveLength(2); // one per card on the rival's only loaded stack
    expect(targets[0]).toMatchObject({ seat: WHEAT, building: 'W4' });

    const taken = answerTask(data, grown.state, pendingAnswers(data, grown.state)[0] as TaskAnswer);
    const card = loaded[0] as string;
    expect(taken.audit.crossSeat).toBe(true);
    expect(player(taken.state, APIARY).barn).toEqual([card]);
    // The take resolves BEFORE the replacement lands, which is the only reason a
    // full building has room for one.
    expect(buildingOf(taken.state, WHEAT, 'W4').stack).toEqual([loaded[1]]);

    const state = answerAll(taken.state);
    expect(buildingOf(state, WHEAT, 'W4').stack).toHaveLength(2);
    expect(buildingOf(state, WHEAT, 'W4').stack).not.toContain(card);
  });

  /** ⚠️ TAKEN, NOT HARVESTED: no harvest event and no harvest hook of any kind. */
  it('never harvests: the rival sees no harvest event', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, APIARY, 'A5');
    loadStack(data, s, WHEAT, 'W4', 1, 'wheat');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    const taken = answerTask(data, grown.state, pendingAnswers(data, grown.state)[0] as TaskAnswer);
    expect(taken.events.some((e) => e.e === 'harvested')).toBe(false);
    expect(taken.events.some((e) => e.e === 'stackToBarn')).toBe(true);
  });

  it('auto-skips when no rival stack holds a card', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A5');
    const grown = growBuilding(data, s, APIARY, 'A4', 'A5');
    expect(grown.state.tasks).toHaveLength(0);
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
    buildFor(data, s, APIARY, 'A6', 'A10', 'A11');
    dealTo(data, s, APIARY, 'A4', 'W4');
    loadStack(data, s, APIARY, 'A11', 2); // threshold 2: full
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');
    const buildings = offered(grown.state).map((p) => p.building);
    expect(new Set(buildings)).toEqual(new Set(['A10']));
  });

  it('the base Farmstead no longer waives the crop for the whole suit', () => {
    const s = base();
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
    expect(sow.targets?.map((r) => r.card)).toEqual(expect.arrayContaining(['A0', 'A3', 'A10']));

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

describe('A8 The Wild Hive - the gift that pays', () => {
  it("puts a deck top into a neighbour's BARN and mints £1", () => {
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
    expect(player(done.state, APIARY).coins).toBe(1);
  });

  /** ⚠️ NO ELIGIBLE RECIPIENT MEANS NO COIN - the £1 is paid for the gift. */
  it('mints nothing when every deck is dry', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const grown = growBuilding(data, s, APIARY, 'A8', 'A4');
    expect(grown.state.tasks).toHaveLength(0);
    expect(player(grown.state, APIARY).coins).toBe(0);
  });

  /** ⛔ Its £1 activation surcharge is gone; nothing in the catalogue prints one. */
  it('costs no coins to activate', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A8');
    dealTo(data, s, APIARY, 'A4');
    expect(player(s, APIARY).coins).toBe(0);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'A8')).toBe(true);
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

describe("A13 The Queen's Hive (ACTION) - the swarm", () => {
  it('queues one deck-sow per drawable deck, with the deck FIXED', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    const move = actionMoveFor(s, 'A13');
    expect(move).toBeDefined();
    const fired = apply(data, s, move as Move);
    expect(fired.state.turn.actionSpent).toBe(true);
    const sows = fired.state.tasks.filter((t) => t.t === 'sowFromDeck');
    expect(sows.map((t) => (t.t === 'sowFromDeck' ? t.suit : null))).toEqual([...data.cards.suits]);
  });

  /** ⚠️ A deck with no room anywhere WHIFFS rather than banking. */
  it('whiffs the decks it has no room for', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    loadStack(data, s, APIARY, 'A0', 2); // the Service: threshold 2, now full
    loadStack(data, s, APIARY, 'A3', 4); // the Notice Board: 1 space left of 5
    const fired = apply(data, s, actionMoveFor(s, 'A13') as Move);
    const state = answerAll(fired.state);
    expect(buildingOf(state, APIARY, 'A3').stack).toHaveLength(5);
    expect(state.tasks).toHaveLength(0);
  });

  it('is not offered with no room anywhere', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A13');
    loadStack(data, s, APIARY, 'A0', 2);
    loadStack(data, s, APIARY, 'A3', 5);
    expect(actionMoveFor(s, 'A13')).toBeUndefined();
  });
});

describe('A14 The Honeycomb Tower (ACTION) - the round', () => {
  it("sows a deck top onto a neighbour's building and mints £1 per HIVE", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4', 'A5');
    const fired = apply(data, s, actionMoveFor(s, 'A14') as Move);
    expect(player(fired.state, APIARY).coins).toBe(2); // two HIVEs built

    const targets = pendingAnswers(data, fired.state).flatMap((a) =>
      a.kind === 'deckSow' ? [a.onto] : [],
    );
    // A neighbour's Notice Board and Service ARE legal targets (the denial watch).
    expect(new Set(targets)).toEqual(new Set(['W0', 'W3']));
    const ontoBoard = pendingAnswers(data, fired.state).find(
      (a) => a.kind === 'deckSow' && a.onto === 'W3',
    );
    const state = answerTask(data, fired.state, ontoBoard as TaskAnswer).state;
    expect(buildingOf(state, WHEAT, 'W3').stack).toHaveLength(1);
  });

  /** ⚠️ A sow onto a neighbour's farm is NOT a visit: no bonus slot, no wage. */
  it('is not a visit', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14');
    const fired = apply(data, s, actionMoveFor(s, 'A14') as Move);
    const state = answerAll(fired.state);
    expect(state.turn.bonusSpent).toBe(false);
    expect(state.turn.visit).toBeNull();
    expect(player(state, APIARY).coins).toBe(0); // no HIVE, so no coins either
    expect(player(state, WHEAT).coins).toBe(0);
  });

  it('is not offered with no legal rival building, so it mints nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A14', 'A4');
    loadStack(data, s, WHEAT, 'W0', 2, 'wheat');
    loadStack(data, s, WHEAT, 'W3', 5, 'wheat');
    expect(actionMoveFor(s, 'A14')).toBeUndefined();
    expect(player(s, APIARY).coins).toBe(0);
  });
});

describe('A15 The Royal Apiary (ACTION) - the cross-table faucet', () => {
  it('puts a deck top into a neighbour’s barn per deck, at £2 each', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    const fired = apply(data, s, actionMoveFor(s, 'A15') as Move);
    expect(fired.state.tasks.filter((t) => t.t === 'card')).toHaveLength(data.cards.suits.length);
    const state = answerAll(fired.state);
    expect(player(state, WHEAT).barn).toHaveLength(data.cards.suits.length);
    expect(player(state, APIARY).coins).toBe(2 * data.cards.suits.length);
  });

  it('"any neighbour" is PER CARD, so the five may be split', () => {
    const s = makeState(data, ['apiary', 'wheat', 'orchard']);
    buildFor(data, s, APIARY, 'A15');
    const fired = apply(data, s, actionMoveFor(s, 'A15') as Move);
    const seats = offered(fired.state).map((p) => p.seat);
    expect(new Set(seats)).toEqual(new Set([1, 2]));
  });

  it('no drawable deck means no card and no coins', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A15');
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    expect(actionMoveFor(s, 'A15')).toBeUndefined();
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

  it("fires on a visit fee landing on a neighbour's board at 2", () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16');
    dealTo(data, s, APIARY, 'A4');
    loadStack(data, s, WHEAT, 'W3', 1, 'wheat');
    const applied = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: WHEAT,
      fee: ['A4'],
      payoff: { mode: 'coin' },
    });
    expect(headDraw(applied.state)).toMatchObject({ see: 1, keep: 1, src: 'A16' });
  });

  it('never fires when a RIVAL brings your building to 2', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A16');
    dealTo(data, s, WHEAT, 'W4');
    loadStack(data, s, APIARY, 'A3', 1, 'apiary');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(drawsFrom(applied.state, 'A16')).toBe(0);
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

describe('A17 The Smoke Pot - visitor-side, where O16 is host-side', () => {
  it('sows a deck top onto one of YOUR buildings when you visit', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    dealTo(data, s, APIARY, 'A4');
    const applied = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: WHEAT,
      fee: ['A4'],
      payoff: { mode: 'coin' },
    });
    expect(tasksFrom(applied.state, 'A17')).toHaveLength(1);
    const state = answerAll(applied.state);
    const onOwn = player(state, APIARY).tableau.reduce((n, b) => n + b.stack.length, 0);
    expect(onOwn).toBe(1);
  });

  it('never fires when the owner is the one being VISITED', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A17');
    dealTo(data, s, WHEAT, 'W4');
    s.turnPlayer = WHEAT;
    const applied = apply(data, s, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(tasksFrom(applied.state, 'A17')).toEqual([]);
  });

  /** A Helping Hand repeat is not a visit and never fires afterVisit. */
  it('does not fire a second time on a Helping Hand repeat', () => {
    const s = makeState(data, ['apiary', 'orchard']);
    const RIVAL = 1;
    buildFor(data, s, APIARY, 'A17', 'A18');
    hireFor(s, RIVAL, 'draw'); // the host's Service: The Nursery
    dealTo(data, s, APIARY, 'A4', 'A5');

    const visited = apply(data, s, {
      type: 'visit',
      seat: APIARY,
      host: RIVAL,
      fee: ['A4'],
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    expect(tasksFrom(visited.state, 'A17')).toHaveLength(1);
    const state = answerAll(visited.state);

    const offers = standingMoves(data, state, APIARY);
    expect(offers.every((m) => m.card === 'A18' && m.kind === 'repeatWork')).toBe(true);
    expect(offers.length).toBeGreaterThan(0);
    const repeated = applyCardMove(data, state, offers[0]!);
    expect(tasksFrom(repeated.state, 'A17')).toEqual([]);
  });
});

describe('the endgame cards - A19, A20, A21', () => {
  it('A19 scores 3 for each non-Apiary building built', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A19', 'A5', 'W5', 'O4');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(6);
    // A base starter prints the generic starting-building icon, so it belongs to
    // no crop; flipping one makes it APIARY and still never counts here.
    buildingOf(s, APIARY, 'A1').upgraded = true;
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(6);
  });

  it('A20 scores 2 for each HIVE built, The Queen’s Hive excluded', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A20', 'A4', 'A8', 'A13', 'A9');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(4);
  });

  /** ⚠️ STARTERS COUNT if they hold a card - a clogged Notice Board or Service included. */
  it('A21 scores 1 for each of your buildings with a card on it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A21', 'A5', 'A10');
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(0);
    loadStack(data, s, APIARY, 'A5', 1);
    loadStack(data, s, APIARY, 'A3', 1, 'wheat'); // the Notice Board, visited once
    loadStack(data, s, APIARY, 'A0', 1, 'wheat'); // the Service, visited once
    expect(gameEndScores(data, s)[APIARY]?.endgame).toBe(3);
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

  it('the three Tier 3 cards print an ACTION and declare it', () => {
    for (const id of ['A13', 'A14', 'A15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).toBeNull();
      expect(card?.activationType, id).toBeNull();
      expect(card?.abilityTrigger, id).toEqual(['action']);
      expect(handlerFor(id)?.actionMoves, id).toBe(true);
    }
  });

  it('the declared crossPlayer flags match live audits', () => {
    // A4, A8, A14 and A15 all reach a neighbour's zones; nothing else in the
    // suit does, A17 included - it reacts to a visit but only ever sows at home.
    for (const id of ['A4', 'A8', 'A14', 'A15'] as const) {
      expect(handlerFor(id)?.difficulty.verified.crossPlayer, id).toBe(true);
    }
    for (const id of ['A5', 'A6', 'A9', 'A10', 'A11', 'A12', 'A13', 'A16', 'A17'] as const) {
      expect(handlerFor(id)?.difficulty.verified.crossPlayer, id).toBe(false);
    }

    const s = base();
    buildFor(data, s, APIARY, 'A14');
    const fired = apply(data, s, actionMoveFor(s, 'A14') as Move);
    const sown = answerTask(data, fired.state, pendingAnswers(data, fired.state)[0] as TaskAnswer);
    expect(sown.audit.crossSeat).toBe(true);
  });
});

describe('a full Apiary turn still settles', () => {
  it('grows, fires, sows and drains without wedging', () => {
    const s = base();
    buildingOf(s, APIARY, 'A2').upgraded = true;
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
