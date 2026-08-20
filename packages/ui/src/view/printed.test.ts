/**
 * The web card and the printed card must not drift.
 *
 * `printed.ts` reproduces the sheet's `@` art columns as derivations. This file
 * pins those derivations against rows read straight out of the designer
 * spreadsheet (the eleven cards checked by hand while the module was written),
 * and then asserts the shape holds across all 105 - so a card added or retyped
 * in the sheet cannot quietly render with the wrong frame.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';

import { printedFace } from './printed';

describe('printedFace, against the sheet', () => {
  it('W1 base Barn: starter icon, build head, two coins, no threshold', () => {
    const face = printedFace(data, 'W1');
    expect(face.identityIcon).toBe('starter');
    expect(face.costIcon).toBe('build');
    expect(face.cost).toEqual([{ kind: 'coin' }, { kind: 'coin' }]);
    expect(face.threshold).toBeNull();
    expect(face.convert).toBeNull();
    expect(face.handSize).toBe(5);
    expect(face.bandPosition).toBe('top');
  });

  it('W1 upgraded Barn: crop icon, no cost bar, prints VP', () => {
    const face = printedFace(data, 'W1', true);
    expect(face.identityIcon).toBe('wheat');
    expect(face.cost).toEqual([]);
    expect(face.costIcon).toBeNull();
    expect(face.printedVp).toBe(2);
    expect(face.handSize).toBe(7);
  });

  /**
   * The Farmstead used to be the one building never for sale: its cost bar
   * printed the MILESTONE that flipped it free (three own-crop icons, ticket
   * 46) rather than a price. Dean retired that on 2026-08-12, so all three
   * starters now print the same £2 - asserted for all five Farmsteads, because
   * one that quietly kept the crop icons would be telling a publisher a rule
   * the game no longer has.
   */
  it('every starter prints the same £2 upgrade price, the Farmstead included', () => {
    const price = data.rules.economy.upgradeCostCoins;
    const starters = data.cards.catalogue.filter(
      (c) => c.slot === 'barn' || c.slot === 'farmstead' || c.slot === 'noticeboard',
    );
    expect(starters).toHaveLength(15);
    for (const card of starters) {
      const face = printedFace(data, card.id);
      expect(face.cost, card.id).toEqual(Array.from({ length: price }, () => ({ kind: 'coin' })));
      expect(face.costIcon, card.id).toBe('build');
    }
    // And no base face still promises the free flip in words.
    for (const card of starters) {
      expect(printedFace(data, card.id).abilityText, card.id).not.toMatch(/Flips free/);
    }
  });

  it('W3 Notice Board: wild activation, the CONVERT arrow rather than a harvest', () => {
    const face = printedFace(data, 'W3');
    expect(face.activation).toBe('wild');
    expect(face.convert).toBe('convert');
    expect(face.threshold).toBe(5);
  });

  it('W10 The Furrow: two wheat and a cornucopia, in that order', () => {
    const face = printedFace(data, 'W10');
    expect(face.cost).toEqual([
      { kind: 'crop', suit: 'wheat' },
      { kind: 'crop', suit: 'wheat' },
      { kind: 'wild' },
    ]);
    expect(face.costIcon).toBe('build');
    expect(face.activation).toBe('wheat');
    expect(face.convert).toBe('harvest');
    expect(face.threshold).toBe(2);
  });

  it('W18 Helping Hand: a Power card, so the caboose head and the BOTTOM band', () => {
    const face = printedFace(data, 'W18');
    expect(face.costIcon).toBe('caboose');
    expect(face.bandPosition).toBe('bottom');
    expect(face.threshold).toBeNull();
    expect(face.activation).toBeNull();
  });

  it('W19: an Endgame card takes the game-end head', () => {
    expect(printedFace(data, 'W19').costIcon).toBe('game_end');
  });
});

describe('printedFace, across the whole catalogue', () => {
  const every = data.cards.catalogue.flatMap((card) =>
    card.faces
      ? [printedFace(data, card.id), printedFace(data, card.id, true)]
      : [printedFace(data, card.id)],
  );

  it('covers all 105 cards and both faces of the 15 flipping starters', () => {
    expect(every).toHaveLength(105 + 15);
  });

  it('never asks for a cost bar art the export does not have', () => {
    // The sheet prints cost_bg_1 .. cost_bg_6 and nothing else.
    for (const face of every) {
      expect(face.cost.length).toBeLessThanOrEqual(6);
      if (face.cost.length > 0) expect(face.costIcon).not.toBeNull();
      if (face.cost.length === 0) expect(face.costIcon).toBeNull();
    }
  });

  it('spends the printed build cost exactly, icon for icon', () => {
    for (const card of data.cards.catalogue) {
      if (!card.buildCost) continue;
      const face = printedFace(data, card.id);
      const crops = face.cost.filter((c) => c.kind === 'crop').length;
      const wild = face.cost.filter((c) => c.kind === 'wild').length;
      const coins = face.cost.filter((c) => c.kind === 'coin').length;
      expect([crops, wild, coins]).toEqual([
        card.buildCost.suit,
        card.buildCost.wild,
        card.buildCost.coins,
      ]);
    }
  });

  it("follows ticket 07's crop rule: a base starter belongs to no crop", () => {
    for (const card of data.cards.catalogue) {
      if (card.type !== 'starter') {
        expect(printedFace(data, card.id).identityIcon).toBe(card.suit);
        continue;
      }
      expect(printedFace(data, card.id).identityIcon).toBe('starter');
      expect(printedFace(data, card.id, true).identityIcon).toBe(card.suit);
    }
  });

  it('puts Power and Endgame text in the bottom band and everything else on top', () => {
    for (const card of data.cards.catalogue) {
      const expected = card.type === 'power' || card.type === 'endgame' ? 'bottom' : 'top';
      expect(printedFace(data, card.id).bandPosition).toBe(expected);
    }
  });

  it('only prints the CONVERT arrow on a Notice Board', () => {
    for (const face of every) {
      if (face.convert !== 'convert') continue;
      const card = data.cards.catalogue.find((c) => c.id === face.id);
      expect(card?.slot).toBe('noticeboard');
    }
  });

  it('gives a threshold exactly to the faces that stack', () => {
    for (const face of every) {
      // A face with a threshold must say what reaching it does, and vice versa.
      expect(face.threshold === null).toBe(face.convert === null);
    }
  });

  it('rejects an unknown id rather than rendering a blank card', () => {
    expect(() => printedFace(data, 'Z99')).toThrow(/Unknown card/);
  });
});
