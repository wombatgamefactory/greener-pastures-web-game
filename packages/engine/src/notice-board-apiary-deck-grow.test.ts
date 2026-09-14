/**
 * DEAN'S APIARY RETEXT (14/09/2026, `rules.economy.noticeBoardPower.apiaryPower`):
 * *"Grow a building using the top card of any deck."*
 *
 * Ruled in on 14/09/2026 with the deck card WILD ('deckGrowWild', the shipped
 * default). 'deckGrow' is the rejected literal reading and 'sow' the power it
 * replaced; both stay runnable, so both are exercised here.
 *
 * Three seats, so each host holds one board and a visit need not name it.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA, loadGameData } from '@gp/data';

import { apply, noticeBoardPowerLegal, player, taskAnswers } from './index.js';
import type { GameState, Move } from './state.js';
import { buildFor, dealTo, loadStack, makeState } from './testkit.js';

function armOf(power: 'sow' | 'deckGrow' | 'deckGrowWild'): GameData {
  return loadGameData({
    name: `apiary-${power}`,
    schemaVersion: 1,
    set: { 'rules.economy.noticeBoardPower.apiaryPower': power },
  });
}

const match = armOf('deckGrow');
const wild = armOf('deckGrowWild');

/** Seat 0 farms wheat and visits seat 1's Apiary board; D4's crop has no deck. */
function position(data: GameData): GameState {
  const suits: Suit[] = ['wheat', 'apiary', 'orchard'];
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  buildFor(data, s, 0, 'W4', 'D4');
  dealTo(data, s, 0, 'W7');
  s.decks.dairy = [];
  s.discards.dairy = [];
  return s;
}

const VISIT: Move = { type: 'visit', seat: 0, host: 1, fee: 'W7' };

describe('the Apiary board as a deck-paid Grow', () => {
  it('pushes a Grow off a deck, never a sow, and pays from the MATCHING deck', () => {
    const s = position(match);
    const out = apply(match, s, VISIT);
    const grow = out.state.tasks.find((t) => t.t === 'grow');
    expect(grow?.t === 'grow' ? grow.fromDeck : undefined).toBe('match');
    expect(out.state.tasks.filter((t) => t.t === 'sow')).toHaveLength(0);
    const answers = taskAnswers(match, out.state, grow!);
    // W4 is a wheat building and the wheat deck pays it; D4 needs dairy and the
    // dairy deck is empty, so it is not offered.
    expect(answers).toEqual([{ kind: 'grow', building: 'W4', payment: null, deckSuit: 'wheat' }]);
  });

  it('places the deck top on the stack, fires the building, and takes nothing from hand', () => {
    const s = position(match);
    const deckBefore = s.decks.wheat.length;
    const top = s.decks.wheat[0];
    let state = apply(match, s, VISIT).state;
    const grow = state.tasks.find((t) => t.t === 'grow')!;
    const [answer] = taskAnswers(match, state, grow);
    state = apply(match, state, { type: 'task', seat: 0, answer: answer! }).state;
    const w4 = player(state, 0).tableau.find((b) => b.card === 'W4');
    expect(w4?.stack).toEqual([top]);
    expect(state.decks.wheat.length).toBeLessThan(deckBefore);
    expect(state.turn.firedThisTurn).toContain('W4');
    expect(player(state, 0).hand).not.toContain(top);
  });

  it('under the wild reading, any drawable deck pays any building', () => {
    const s = position(wild);
    const out = apply(wild, s, VISIT);
    const grow = out.state.tasks.find((t) => t.t === 'grow')!;
    const answers = taskAnswers(wild, out.state, grow);
    const d4 = answers.filter((a) => a.kind === 'grow' && a.building === 'D4');
    expect(d4.length).toBeGreaterThan(0);
    expect(d4.every((a) => a.kind === 'grow' && a.deckSuit !== 'dairy')).toBe(true);
  });

  it('is not offered when no building of yours has room', () => {
    const s = position(match);
    loadStack(match, s, 0, 'W4', 2);
    loadStack(match, s, 0, 'D4', 2, 'wheat');
    expect(noticeBoardPowerLegal(match, s, 0, 'apiary', { excludingHandCard: 'W7' })).toBe(false);
    expect(noticeBoardPowerLegal(wild, s, 0, 'apiary', { excludingHandCard: 'W7' })).toBe(false);
  });

  it('the shipped default is the WILD deck-paid Grow', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardPower.apiaryPower).toBe('deckGrowWild');
    const out = apply(BASE_GAME_DATA, position(BASE_GAME_DATA), VISIT);
    const grow = out.state.tasks.find((t) => t.t === 'grow');
    expect(grow?.t === 'grow' ? grow.fromDeck : undefined).toBe('wild');
  });

  it("apiaryPower 'sow' still sows 2 from hand, for the overlays that pin it", () => {
    const sow = armOf('sow');
    const s = position(sow);
    dealTo(sow, s, 0, 'W9');
    const out = apply(sow, s, VISIT);
    expect(out.state.tasks.some((t) => t.t === 'sow')).toBe(true);
    expect(out.state.tasks.some((t) => t.t === 'grow')).toBe(false);
  });
});
