/**
 * Dean's two turn-order rulings of 15/09/2026 (Rule book v3):
 *
 *  - `rules.setup.firstPlayer: 'random'`: the opening seat is drawn from the
 *    seeded RNG after every setup shuffle and recorded as `firstPlayer`;
 *  - `rules.endGame.endOfGame: 'finishRound'`: once the end is triggered, the
 *    round is finished and the game ends before the first player would play.
 *
 * Both old rules (`'seat0'`, `'oneMoreTurnEach'`) must keep replaying their
 * games, so each is tested beside its replacement.
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import type { GameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { clonePlain } from './clone.js';
import { apply } from './game.js';
import { newGame } from './setup.js';
import type { GameState, Seat } from './state.js';
import { makeState } from './testkit.js';
import { firstPlayerOf } from './turnflow.js';
import { viewFor } from './view.js';

const oldRules: GameData = loadGameData({
  name: 'pre-15-09-turn-order',
  schemaVersion: 1,
  set: {
    'rules.setup.firstPlayer': 'seat0',
    'rules.endGame.endOfGame': 'oneMoreTurnEach',
  },
});

/** End the current seat's turn with nothing else to do. */
function pass(data: GameData, s: GameState): GameState {
  const seat = s.turnPlayer;
  const draft = clonePlain(s);
  draft.turn.actionSpent = true;
  return apply(data, draft, { type: 'endTurn', seat }).state;
}

/** The seats that still play after `trigger` sets the end, starting with the trigger seat's turn. */
function turnsAfterTrigger(data: GameData, first: Seat, trigger: Seat, seats = 3): Seat[] {
  let s = makeState(data, (['wheat', 'orchard', 'dairy', 'apiary'] as const).slice(0, seats));
  if (first !== 0) s.firstPlayer = first;
  s.turnPlayer = trigger;
  s.endTrigger = { seat: trigger };
  const played: Seat[] = [];
  for (let guard = 0; guard < 10; guard++) {
    s = pass(data, s);
    if (s.phase === 'ended') return played;
    played.push(s.turnPlayer);
  }
  throw new Error('the game never ended');
}

describe('first player (ruled random, 15/09/2026)', () => {
  it('ships random and records the seat; a seed always names the same seat', () => {
    expect(BASE_GAME_DATA.rules.setup.firstPlayer).toBe('random');
    const seen = new Set<Seat>();
    for (let i = 0; i < 40; i++) {
      const g = newGame(BASE_GAME_DATA, { seats: 4, seed: `first-${i}` });
      expect(g.firstPlayer, `first-${i}`).toBeDefined();
      expect(g.turnPlayer).toBe(g.firstPlayer);
      expect(newGame(BASE_GAME_DATA, { seats: 4, seed: `first-${i}` })).toEqual(g);
      seen.add(g.turnPlayer);
    }
    // Forty seeds over four seats: every seat opens somewhere.
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it('draws the seat LAST: the deal is the deal the old rule made on the same seed', () => {
    const shipped = newGame(BASE_GAME_DATA, { seats: 3, seed: 'same-deal' });
    const old = newGame(oldRules, { seats: 3, seed: 'same-deal' });
    expect(shipped.decks).toEqual(old.decks);
    expect(shipped.players).toEqual(old.players);
    expect(shipped.island).toEqual(old.island);
  });

  it("'seat0' opens with seat 0, draws nothing and leaves the field absent", () => {
    const old = newGame(oldRules, { seats: 3, seed: 'seat0' });
    expect(old.turnPlayer).toBe(0);
    expect('firstPlayer' in old).toBe(false);
    expect(firstPlayerOf(old)).toBe(0);
  });

  it('is public in every seat view', () => {
    const g = newGame(BASE_GAME_DATA, { seats: 2, seed: 'view' });
    expect(viewFor(BASE_GAME_DATA, g, 1).firstPlayer).toBe(g.firstPlayer);
    const old = newGame(oldRules, { seats: 2, seed: 'view' });
    expect('firstPlayer' in viewFor(oldRules, old, 1)).toBe(false);
  });
});

describe('game end (ruled finish the round, 15/09/2026)', () => {
  it('ships finishRound', () => {
    expect(BASE_GAME_DATA.rules.endGame.endOfGame).toBe('finishRound');
  });

  it('finishes the round: seat 0 opened, seat 1 triggers, only seat 2 plays on', () => {
    expect(turnsAfterTrigger(BASE_GAME_DATA, 0, 1)).toEqual([2]);
  });

  it('a trigger by the first player gives every other seat one more turn', () => {
    expect(turnsAfterTrigger(BASE_GAME_DATA, 0, 0)).toEqual([1, 2]);
  });

  it('a trigger by the last seat of the round ends the game at once', () => {
    expect(turnsAfterTrigger(BASE_GAME_DATA, 0, 2)).toEqual([]);
    // With seat 2 opening, seat 1 closes the round.
    expect(turnsAfterTrigger(BASE_GAME_DATA, 2, 1)).toEqual([]);
    expect(turnsAfterTrigger(BASE_GAME_DATA, 2, 0)).toEqual([1]);
  });

  it("'oneMoreTurnEach' is the old rule: every other seat plays once more", () => {
    expect(turnsAfterTrigger(oldRules, 0, 1)).toEqual([2, 0]);
    expect(turnsAfterTrigger(oldRules, 0, 2)).toEqual([0, 1]);
  });

  it('does not end an untriggered game at the round boundary', () => {
    let s = makeState(BASE_GAME_DATA, ['wheat', 'orchard']);
    for (let i = 0; i < 4; i++) s = pass(BASE_GAME_DATA, s);
    expect(s.phase).toBe('playing');
    expect(s.turnPlayer).toBe(0);
  });

  it('rejects furtherTurnsEach other than 1 only where it is read', () => {
    const two = { 'rules.endGame.furtherTurnsEach': 2 };
    expect(() =>
      newGame(
        loadGameData({
          name: 'x',
          schemaVersion: 1,
          set: { ...two, 'rules.endGame.endOfGame': 'oneMoreTurnEach' },
        }),
        { seats: 2, seed: 'x' },
      ),
    ).toThrow(/furtherTurnsEach/);
    expect(() =>
      newGame(loadGameData({ name: 'x', schemaVersion: 1, set: two }), { seats: 2, seed: 'x' }),
    ).not.toThrow();
  });
});
