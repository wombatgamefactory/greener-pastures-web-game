/**
 * The anti-rot tests. Everything here runs without walking a game: the
 * game-walking proofs (view safety, determinism, the speed budget) need a
 * GameState and so live with the driver in @gp/sim.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { MOVE_TYPES } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { cardValue, lowestValueCard } from './junk.js';
import {
  BALANCE_PROFILES,
  LADDER,
  POLICY_IDS,
  isPolicyId,
  makePolicy,
  policyRng,
} from './roster.js';
import { GREEDY_PRIORITY } from './simple.js';
import { TERMS, TERM_NAMES } from './terms.js';
import { PROFILES, checkWeightTable, weightsFor } from './weights.js';

describe('scoring coverage', () => {
  it('claims every move type, and no move type that does not exist', () => {
    const claimed = new Set(TERMS.flatMap((term) => term.claims));
    // Set equality both ways: a new move type is unscored until a term claims
    // it, and a claim for a deleted move type is a stale term.
    expect([...claimed].sort()).toEqual([...MOVE_TYPES].sort());
  });

  it('gives the greedy baseline an exhaustive priority list', () => {
    expect([...GREEDY_PRIORITY].sort()).toEqual([...MOVE_TYPES].sort());
  });

  it('has no duplicate term names', () => {
    expect(new Set(TERM_NAMES).size).toBe(TERM_NAMES.length);
  });
});

describe('weight tables', () => {
  it('weights every term, in every profile, and nothing else', () => {
    for (const profile of Object.keys(PROFILES)) {
      expect(checkWeightTable(weightsFor(profile))).toEqual([]);
    }
  });

  it('rejects an unknown profile', () => {
    expect(() => weightsFor('nope')).toThrow();
  });

  it('keeps the hermit control incapable of visiting', () => {
    // The control for watch-list assertion 8 only has teeth if it is absolute.
    expect(weightsFor('hermit')['visit']).toBeLessThan(0);
  });
});

describe('the roster', () => {
  it('builds every id, and each policy reports the id it was asked for', () => {
    for (const id of POLICY_IDS) {
      expect(makePolicy(id).id).toBe(id);
      expect(isPolicyId(id)).toBe(true);
    }
    expect(isPolicyId('mcts')).toBe(false);
  });

  it('resolves every ladder tier and every balance profile to a real bot', () => {
    for (const id of Object.values(LADDER)) expect(isPolicyId(id)).toBe(true);
    for (const id of BALANCE_PROFILES) expect(isPolicyId(id)).toBe(true);
  });

  it('gives only the scored bots an explain', () => {
    expect(makePolicy('balanced').explain).toBeTypeOf('function');
    expect(makePolicy('random').explain).toBeUndefined();
  });

  it('streams a policy rng per (seed, seat, id), reproducibly', () => {
    expect(policyRng('s', 0, 'balanced')).toEqual(policyRng('s', 0, 'balanced'));
    expect(policyRng('s', 0, 'balanced')).not.toEqual(policyRng('s', 1, 'balanced'));
    expect(policyRng('s', 0, 'balanced')).not.toEqual(policyRng('s', 0, 'racer'));
    expect(policyRng('s', 0, 'balanced')).not.toEqual(policyRng('t', 0, 'balanced'));
  });
});

describe('the junk rank', () => {
  it('ranks a coin-priced card above a cheap one', () => {
    // W20 Wheat Exchange (endgame, £2) against W4, a Tier 1 field.
    expect(cardValue(data, 'W20')).toBeGreaterThan(cardValue(data, 'W4'));
  });

  it('picks the junkiest card of a hand as the fee', () => {
    const hand = ['W20', 'W4', 'V6'];
    const junk = lowestValueCard(data, hand);
    expect(junk).not.toBeNull();
    for (const id of hand) {
      expect(cardValue(data, junk as string)).toBeLessThanOrEqual(cardValue(data, id));
    }
  });

  it('has nothing to choose from an empty hand', () => {
    expect(lowestValueCard(data, [])).toBeNull();
  });

  it('throws on a masked id rather than quietly valuing it at zero', () => {
    expect(() => cardValue(data, 'W?')).toThrow();
  });
});
