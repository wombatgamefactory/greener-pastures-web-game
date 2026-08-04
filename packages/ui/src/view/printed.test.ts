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
   * Ticket 46, Dean's call. The Farmstead is the one building never for sale, so
   * the slot every other card prints a PRICE in prints the MILESTONE that flips
   * it free: one own-crop icon per building of your own crop. Read from the rule
   * rather than typed, so the card and the knob cannot disagree - and asserted
   * for all five, because a starter that quietly went back to two coins would be
   * telling a publisher the Farmstead costs £2.
   */
  it('every Farmstead prints its milestone in the cost bar, never a price', () => {
    const flipAt = data.rules.economy.farmsteadFlipAtOwnColourBuilds;
    for (const card of data.cards.catalogue.filter((c) => c.slot === 'farmstead')) {
      const face = printedFace(data, card.id);
      expect(card.upgradeCostCoins, `${card.id} carries a price`).toBeUndefined();
      expect(face.costMeaning).toBe('milestone');
      expect(face.cost, card.id).toEqual(
        Array.from({ length: flipAt }, () => ({ kind: 'crop', suit: card.suit })),
      );
      expect(face.costIcon).toBe('build');
      // And the base face says so in words, because three crop icons alone read
      // like a payment.
      expect(face.abilityText, card.id).toMatch(/Flips free when you have \d+ \w+ buildings\./);
    }
    // Its neighbours still print the £2 they really do cost.
    for (const id of ['W1', 'W3']) {
      expect(printedFace(data, id).cost).toEqual([{ kind: 'coin' }, { kind: 'coin' }]);
      expect(printedFace(data, id).costMeaning).toBe('price');
    }
  });

  it('W3 Notice Board: wild activation, the CONVERT arrow rather than a harvest', () => {
    const face = printedFace(data, 'W3');
    expect(face.activation).toBe('wild');
    expect(face.convert).toBe('convert');
    expect(face.threshold).toBe(5);
  });

  it('W10 The Furrow: three wheat and a cornucopia, in that order', () => {
    const face = printedFace(data, 'W10');
    expect(face.cost).toEqual([
      { kind: 'crop', suit: 'wheat' },
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

  it('covers all 105 cards and both faces of the 15 starters', () => {
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
