/**
 * THE HIDDEN-INFORMATION BOUNDARY, tested from inside the engine.
 *
 * The proof of this property has always lived in `packages/sim/src/bots.test.ts`
 * ("view safety"), because walking whole games needs a driver and a bot roster
 * and neither may be reached from here. That test is worth its cost and is not
 * replaced by this file - but it is a WALK, so it only proves what its seeds
 * happen to reach, and it is trajectory-dependent by construction: ticket 42
 * recorded the same guard passing and failing across an unrelated change to the
 * bots, with no change at all to the defect underneath.
 *
 * That is exactly how the leak this file exists to pin stayed hidden. D15 The
 * Grand Creamery and D10 The Scout's Post named a REVEALED DECK TOP in their
 * task answers, and a revealed deck top is in LIMBO - in no hand, no pile and no
 * stack, so no PlayerView carries it. `legalMoves` hands the move list to a
 * policy unredacted (ticket 10: "the Move union is view-safe by construction"),
 * so the move list itself said which card was on top of which deck, and so did
 * the replayable move log. The same missing model leaked the other way too:
 * `redactTask` had no branch for a card task, so its untyped `riders` bag went
 * to EVERY rival unmasked - deck tops from those two cards, and the drawing
 * seat's own hand ids from O15 The Lending Library.
 *
 * So: two deterministic scenarios that pin the cards, and a walk that is the net
 * for the next card to use the same bag.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves, newGame } from './game.js';
import { isCardId } from './query.js';
import { rngInt, seedRng } from './rng.js';
import { answerTask, growBuilding, pendingAnswers } from './runtime.js';
import type { CardId, GameState, Move, Seat, TaskAnswer } from './state.js';
import { revealedIn } from './state.js';
import { buildFor, dealTo, makeState } from './testkit.js';
import type { PlayerView } from './view.js';
import { viewFor } from './view.js';

const DAIRY = 0;
const WHEAT = 1;

/**
 * Payload keys that hold something other than a card. Card ids and island tile
 * ids share a namespace - `A5` is both the Apiary Barn and a Level 1 tile - so
 * an id alone cannot say which it is.
 *
 * Kept in step with `packages/sim/src/bots.test.ts`, deliberately: two copies of
 * one rule is the price of the engine owning a guard it cannot import.
 */
const NON_CARD_KEYS = new Set(['tile', 'balloon']);

/**
 * Every card id a payload names, structurally rather than by pattern.
 *
 * ⭐ STRICTER THAN THE SIM'S COPY ON PURPOSE: this one walks INTO arrays and
 * nested objects, and the sim's stops at top-level strings. A payload that
 * carried its ids in a list - D10's `payment` does - would slip past the walk
 * over there entirely, which is not a leak today (a payment comes out of the
 * seat's own hand) but is a hole in the guard rather than in the rules.
 */
function idsInPayload(payload: Record<string, unknown>): CardId[] {
  const out: CardId[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (!NON_CARD_KEYS.has(key) && isCardId(data, value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  for (const [key, value] of Object.entries(payload)) walk(value, key);
  return out;
}

/**
 * The card ids a move names out loud.
 *
 * ⚠️ A BUILD'S `stacks` IS DELIBERATELY NOT HERE, and the omission mirrors the
 * sim's. D7 pays out of the seat's own building stacks by id, and `viewFor`
 * renders every stack as suits ("identity dies on placement"), so counting them
 * would fail this guard on a rules question rather than on a bug: ticket 42
 * asks whether a stack has identity to its owner and is still open. When it is
 * ruled, this line and the sim's move with it.
 */
function cardIdsIn(move: Move): CardId[] {
  switch (move.type) {
    case 'build':
      return [move.card, ...move.payment];
    case 'grow':
      // R15: `payment` is null when a meeple paid, and a meeple is not a card.
      return move.payment === null ? [move.building] : [move.building, move.payment];
    case 'harvest':
      return [move.building];
    case 'visit':
      // Null under the meeple-loop arm: the visit names meeples, not a card, so
      // there is no id in the move for a view to have to carry.
      return move.fee === null ? [] : [move.fee];
    case 'cardMove':
      return [move.card, ...idsInPayload(move.payload)];
    case 'task': {
      const a: TaskAnswer = move.answer;
      switch (a.kind) {
        case 'building':
        case 'activate':
        case 'handToBarn':
          return [a.card];
        case 'sow':
          return [a.card, a.onto];
        case 'keep':
        case 'discard':
          return [...a.cards];
        case 'build':
          return [a.card, ...a.payment];
        case 'card':
          return idsInPayload(a.payload);
        default:
          return [];
      }
    }
    default:
      return [];
  }
}

/**
 * Everything a seat is entitled to NAME: its own hand, any tableau (public),
 * any discard (face up), and its own in-flight draw or divert - cards it has
 * seen, held in a limbo the view models and redacts.
 *
 * A card task's riders are NOT in here, and that is the whole point. Limbo in an
 * untyped bag is a zone no view models, so an answer may only reach it BY SLOT.
 */
function knowableIds(view: PlayerView): Set<CardId> {
  const ok = new Set<CardId>(view.you.hand);
  for (const b of view.you.tableau) ok.add(b.card);
  for (const rival of view.rivals) for (const b of rival.tableau) ok.add(b.card);
  for (const pile of Object.values(view.discards)) for (const id of pile) ok.add(id);
  for (const task of view.tasks) {
    if (task.pid !== view.seat) continue;
    if (task.t === 'draw') for (const id of task.revealed) ok.add(id);
    if (task.t === 'divert') for (const id of task.cards) ok.add(id);
  }
  return ok;
}

/**
 * Ids the move list names that the acting seat's own view cannot justify.
 *
 * Violations are COLLECTED rather than asserted one at a time: a step can offer
 * hundreds of moves and `expect` is far too dear to call per id - which matters,
 * because the walk below is only worth having while it is cheap enough to run on
 * every commit. `checked` comes back so a test can prove the guard actually
 * looked at something.
 */
function moveViolations(state: GameState, where: string): { bad: string[]; checked: number } {
  const moves = legalMoves(data, state);
  const bad: string[] = [];
  if (moves.length === 0) return { bad, checked: 0 };
  const seat = (moves[0] as Move).seat;
  const ok = knowableIds(viewFor(data, state, seat));
  let checked = 0;
  for (const move of moves) {
    for (const id of cardIdsIn(move)) {
      checked += 1;
      if (!ok.has(id))
        bad.push(`${where}: seat ${seat} was offered ${id} in ${JSON.stringify(move)}`);
    }
  }
  return { bad, checked };
}

/** Every card id anywhere in a view, by structural walk. */
function idsInView(view: PlayerView): CardId[] {
  const out: CardId[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (!NON_CARD_KEYS.has(key) && isCardId(data, value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(view, '');
  return out;
}

/**
 * The other direction, which the sim's walk cannot see because it only ever
 * builds the ACTING seat's view: nothing in a seat's own PlayerView is an id it
 * has no right to. A seat's own pending card task is allowed its riders - that
 * is where its own reveal lives - and nobody else's is.
 */
function redactionViolations(state: GameState, where: string): string[] {
  const bad: string[] = [];
  for (let seat = 0 as Seat; seat < state.players.length; seat++) {
    const view = viewFor(data, state, seat);
    const ok = knowableIds(view);
    for (const task of view.tasks) {
      if (task.pid !== seat || task.t !== 'card') continue;
      for (const id of idsInPayload(task.riders)) ok.add(id);
      for (const id of revealedIn(task)) ok.add(id);
    }
    for (const id of idsInView(view)) {
      if (!ok.has(id)) bad.push(`${where}: seat ${seat}'s own view carries ${id}`);
    }
  }
  return bad;
}

function base(): GameState {
  return makeState(data, ['dairy', 'wheat']);
}

describe('a card task may not name its limbo cards', () => {
  /**
   * D15 The Grand Creamery: "Reveal the top two deck cards. Build 1 for free."
   * Two flips, then the pick - the moment the leak lived in.
   */
  function creameryAtThePick(): { state: GameState; revealed: CardId[] } {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    const first = s.decks.wheat[0] as CardId;
    const second = s.decks.wheat[1] as CardId;
    const flip = (state: GameState): GameState => {
      const answer = pendingAnswers(data, state).find(
        (a) => a.kind === 'card' && a.payload.suit === 'wheat',
      );
      if (!answer) throw new Error('no wheat flip on offer');
      return answerTask(data, state, answer).state;
    };
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    return { state: flip(flip(grown.state)), revealed: [first, second] };
  }

  it('D15 offers a slot, not a deck top, and the slot still builds the right card', () => {
    const { state, revealed } = creameryAtThePick();
    const answers = pendingAnswers(data, state);
    expect(answers).toHaveLength(2);
    // The pick is an index into the reveal the task carries, and the move names
    // nothing else - so the move list, and the move log with it, say only "the
    // second one".
    expect(answers.map((a) => (a.kind === 'card' ? a.payload : null))).toEqual([
      { pick: 0 },
      { pick: 1 },
    ]);
    const { bad, checked } = moveViolations(state, 'D15 pick');
    expect(bad).toEqual([]);
    // Nothing at all to check, which IS the property: the two moves on offer
    // name no card id whatsoever.
    expect(checked).toBe(0);
    expect(revealedIn(state.tasks[0] as never)).toEqual(revealed);

    // Slot 1 is the SECOND card revealed, not the first: the index is load
    // bearing, not decorative.
    const built = answerTask(data, state, answers[1] as TaskAnswer).state;
    expect(built.players[DAIRY]?.tableau.some((b) => b.card === revealed[1])).toBe(true);
    expect(built.discards.wheat).toContain(revealed[0]);
  });

  it("D10 offers a slot per revealed deck top, priced from the seat's own hand", () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const wheatTop = s.decks.wheat[0] as CardId;
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const state = grown.state;

    const answers = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    expect(answers.length).toBeGreaterThan(0);
    // Every answer names a slot and a payment out of the hand. No deck top.
    for (const a of answers) {
      if (a.kind !== 'card') continue;
      expect(typeof a.payload.pick).toBe('number');
      expect(a.payload.card).toBeUndefined();
    }
    expect(moveViolations(state, 'D10 scout').bad).toEqual([]);

    const reveal = revealedIn(state.tasks[0] as never);
    // A payment, when the discount does not make the card free, names cards out
    // of the seat's own hand - which its view carries. What no answer may name
    // is a card still in limbo.
    const named = answers.flatMap((a) => (a.kind === 'card' ? idsInPayload(a.payload) : []));
    expect(named.filter((id) => reveal.includes(id))).toEqual([]);
    const wheatSlot = reveal.indexOf(wheatTop);
    expect(wheatSlot).toBeGreaterThanOrEqual(0);
    const take = answers.find((a) => a.kind === 'card' && a.payload.pick === wheatSlot);
    expect(take).toBeDefined();
    const built = answerTask(data, state, take as TaskAnswer).state;
    expect(built.players[DAIRY]?.tableau.some((b) => b.card === wheatTop)).toBe(true);
  });

  it("hides a card task's riders from every seat but its owner", () => {
    const { state, revealed } = creameryAtThePick();
    expect(redactionViolations(state, 'D15 pick')).toEqual([]);

    // Concretely: the owner reads its own reveal, the rival gets suit letters.
    const owner = viewFor(data, state, DAIRY).tasks[0];
    expect(owner?.t === 'card' ? revealedIn(owner) : null).toEqual(revealed);
    const rival = viewFor(data, state, WHEAT).tasks[0];
    expect(rival?.t === 'card' ? revealedIn(rival) : null).toEqual(['W?', 'W?']);
  });
});

/**
 * THE NET. A seeded random walk is a poor player and a good fuzzer: it reaches
 * task shapes a weighted bot avoids, and it costs nothing to run. It proves
 * nothing about a card it never draws - the scenarios above are what pin D10 and
 * D15 - but it is what catches the NEXT card to put an id somewhere no view
 * models, which is the failure this whole file is about.
 */
describe('a full game never offers an id the acting seat cannot see', () => {
  it('holds across seeded random walks at 2, 3 and 4 seats', () => {
    const suits = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'] as const;
    const bad: string[] = [];
    let checked = 0;
    for (const seats of [2, 3, 4]) {
      for (let n = 0; n < 2; n++) {
        const seed = `view-safety-${seats}-${n}`;
        const rng = seedRng(`${seed}:policy`);
        let state = newGame(data, { seats, suits: suits.slice(0, seats), seed });
        for (let step = 0; step < 250 && state.phase === 'playing'; step++) {
          const moves = legalMoves(data, state);
          if (moves.length === 0) break;
          const where = `${seed} step ${step}`;
          const seen = moveViolations(state, where);
          bad.push(...seen.bad);
          checked += seen.checked;
          bad.push(...redactionViolations(state, where));
          state = apply(data, state, moves[rngInt(rng, moves.length)] as Move).state;
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(5000);
  });
});
