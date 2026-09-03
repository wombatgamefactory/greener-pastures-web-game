/**
 * The anti-rot tests. Everything here runs without walking a game: the
 * game-walking proofs (view safety, determinism, the speed budget) need a
 * GameState and so live with the driver in @gp/sim.
 */

import { BASE_GAME_DATA as data, SUITS } from '@gp/data';
import type { Suit } from '@gp/data';
import { MOVE_TYPES } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { cardValue, lowestValueCard } from './junk.js';
import { SUIT_STRENGTH, magpieTarget } from './magpie.js';
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

  it('keeps the hermit control incapable of visiting a NEIGHBOUR', () => {
    // The control for the hook assertion only has teeth if it is absolute.
    expect(weightsFor('hermit')['visit']).toBeLessThan(0);
  });

  it('leaves the hermit free to self-visit, which is the v31 narrowing', () => {
    // ⭐ A hermit that refused the bonus slot outright would control for two
    // things at once - the cross-table door AND the solitaire one - and risk 2
    // is exactly the question of which of those a table takes. So the veto is
    // narrowed to neighbours and the solitaire door is left alone.
    expect(weightsFor('hermit')['selfVisit']).toBeGreaterThanOrEqual(0);
  });

  it('gives neither bonus-slot door an intrinsic taste in the reference', () => {
    // Risk 2 is measured, not chosen: a weight on either door would have the
    // instrument reporting its own preference as the table's behaviour.
    expect(weightsFor('balanced')['visit']).toBe(0);
    expect(weightsFor('balanced')['selfVisit']).toBe(0);
  });

  it('pins the meeple price to itself in both directions', () => {
    // One price for a meeple whichever way it travels, so the bot's books
    // balance and the spend decision turns entirely on the rolled-out action.
    const table = weightsFor('balanced');
    expect(table['meepleSpend']).toBe(table['meepleGain']);
  });

  it('pins the Farmstead VP to the printed VP it sits beside', () => {
    // 1 VP through the Farmstead is 1 VP through the card, so one weight.
    const table = weightsFor('balanced');
    expect(table['farmsteadVp']).toBe(table['buildVp']);
  });

  it('pins shutting your own door to the price of reopening it', () => {
    const table = weightsFor('balanced');
    expect(table['clogOwnBoard']).toBe(table['unclogBoard']);
  });

  it('leaves the reference no taste for its own crop beyond what the rules pay', () => {
    // ⚠️ The v31 instrument change. `farmsteadVp` prices the rule; a taste on
    // top of it would have the reference manufacturing risk 3's own-crop build
    // share. `loyalist` is where a taste above the rule lives.
    expect(weightsFor('balanced')['buildOwnCrop']).toBe(0);
    expect(weightsFor('loyalist')['buildOwnCrop']).toBeGreaterThan(0);
  });

  it('keeps the magpie control incapable of building its own crop', () => {
    // Same reasoning as the hermit above: a control that merely dislikes the
    // thing it is controlling for measures a preference, not the rule.
    const magpie = weightsFor('magpie');
    expect(magpie['buildOwnCrop']).toBeLessThan(0);
    expect(magpie['buildTargetCrop']).toBeGreaterThan(0);
  });

  it('leaves the magpie terms inert in every other profile', () => {
    // The whole reason reference-v9 survives this bot's arrival.
    const targetTerms = ['buildTargetCrop', 'deckTargetCrop', 'keepTargetCrop', 'visitFeeOwnCrop'];
    for (const profile of Object.keys(PROFILES)) {
      if (profile === 'magpie') continue;
      for (const name of targetTerms) {
        expect(weightsFor(profile)[name], `${profile}.${name}`).toBe(0);
      }
    }
  });

  /**
   * Half of ticket 48's sign convention; @gp/sim's `bots.test.ts` asserts the
   * other half (the feature itself, over real games).
   *
   * `growSpend`, `buildSpend` and `deliverCost` were each written as a negative
   * weight against an already negated feature, and each therefore PAID the bot
   * for spending more. Three in a row is a shape, not three slips: a product's
   * sign is invisible from either half on its own, so it gets asserted rather
   * than reviewed.
   */
  it('gives every cost term a positive weight, in every profile', () => {
    const costTerms = TERMS.filter((term) => term.cost).map((term) => term.name);
    // Vacuous if the flag ever gets dropped in a refactor.
    expect(costTerms.length).toBeGreaterThan(5);
    for (const profile of Object.keys(PROFILES)) {
      const table = weightsFor(profile);
      for (const name of costTerms) {
        expect(table[name], `${profile}.${name}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the magpie target', () => {
  it('ranks every suit exactly once', () => {
    // A ranking that dropped a suit would silently send a magpie to whichever
    // crop happened to be next in the list.
    expect([...SUIT_STRENGTH].sort()).toEqual([...SUITS].sort());
  });

  it('never picks its own crop, and prefers the strongest that is seated', () => {
    expect(magpieTarget('orchard', SUITS)).toBe('wheat');
    // A wheat seat takes the next one down rather than itself.
    expect(magpieTarget('wheat', SUITS)).toBe('dairy');
  });

  it('only ever picks a suit that is actually at the table', () => {
    // Both acquisition lanes filter to suitsInPlay, so an unseated target would
    // starve the bot rather than test the strategy.
    const seated: Suit[] = ['orchard', 'vegetable'];
    expect(magpieTarget('orchard', seated)).toBe('vegetable');
    expect(magpieTarget('vegetable', seated)).toBe('orchard');
  });

  it('has no target when nothing else is seated', () => {
    expect(magpieTarget('wheat', ['wheat'])).toBeNull();
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
  it('ranks a dearer card above a cheaper one', () => {
    // W20 The Grand Granary (endgame, 2 own-suit cards) against W4, a Tier 1
    // field at 1. The COIN leg of this rank went with the currency (v31) and
    // the order survived it: what used to sort as "priced in money, therefore
    // precious" now sorts as "costs two cards, therefore dear".
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
