/**
 * The roster: eight bots from two code paths, plus the difficulty ladder.
 */

import { seedRng } from '@gp/engine';
import type { RngState } from '@gp/engine';

import { scoredPolicy } from './evaluator.js';
import { greedy, pulse, random } from './simple.js';
import type { Policy } from './types.js';

export const POLICY_IDS = [
  'random',
  'pulse',
  'greedy',
  'balanced',
  'hermit',
  'socialite',
  'loyalist',
  'racer',
] as const;

export type PolicyId = (typeof POLICY_IDS)[number];

/**
 * The profiles a balance run seats by default - one per seat, assigned from the
 * run seed. Card economics measured against neighbours who all play the same
 * way are an artefact of that way of playing, so the mixed table is the
 * realistic one and a mirror is the diagnostic.
 */
export const BALANCE_PROFILES: readonly PolicyId[] = [
  'balanced',
  'socialite',
  'loyalist',
  'racer',
  'hermit',
];

/**
 * What `hard` resolves to. An alias, not a claim: with no search bot there is
 * no honestly strong opponent until something measures strength, so ticket 11
 * sets this from its win-rate table. Until then it points at the reference
 * profile and promises nothing.
 */
export const HARD_TIER: PolicyId = 'balanced';

export const LADDER: Readonly<Record<'easy' | 'normal' | 'hard', PolicyId>> = {
  easy: 'pulse',
  normal: 'balanced',
  hard: HARD_TIER,
};

export function isPolicyId(id: string): id is PolicyId {
  return (POLICY_IDS as readonly string[]).includes(id);
}

export function makePolicy(id: PolicyId): Policy {
  switch (id) {
    case 'random':
      return random;
    case 'pulse':
      return pulse;
    case 'greedy':
      return greedy;
    default:
      return scoredPolicy(id);
  }
}

/**
 * A policy's own rng stream, per ticket 10: seeded from the game seed, the seat
 * and the policy id, and carried across the whole game. Never `state.rng` - a
 * policy that read the game's stream would perturb the shuffles, and identical
 * seeds would stop reproducing.
 */
export function policyRng(gameSeed: string, seat: number, policyId: string): RngState {
  return seedRng(`${gameSeed}:policy:${seat}:${policyId}`);
}
