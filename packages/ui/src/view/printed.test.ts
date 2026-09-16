/**
 * The web card and the printed card must not drift.
 *
 * `printed.ts` reproduces the sheet's `@` art columns as derivations. This file
 * pins those derivations against rows read straight out of the designer
 * spreadsheet (the eleven cards checked by hand while the module was written),
 * and then asserts the shape holds across all 105 - so a card added or retyped
 * in the sheet cannot quietly render with the wrong frame.
 *
 * ⭐ v31 HALVED THE COUNT AND THE HALF THAT WENT IS THE POINT. There were 120
 * faces: 105 cards plus a second printed face on each of the fifteen starters.
 * Starters are single-faced now, so the catalogue and the face list are the same
 * 105 things, and three properties that only ever described the upgrade layer -
 * the coin cost icon, the starter's crop-on-the-flipped-face rule, and the
 * printed hand size - have nothing left to describe.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';

import { data as control } from '../session/table';
import { printedFace } from './printed';

describe('printedFace, against the sheet', () => {
  it('W1 the Barn: starter icon, no cost bar, no threshold, and the own-crop scorer', () => {
    const face = printedFace(data, 'W1');
    expect(face.identityIcon).toBe('starter');
    expect(face.threshold).toBeNull();
    expect(face.convert).toBeNull();
    // Sheet v42: the Barn prints the own-crop scorer (moved off the Farmstead)
    // and still carries no cost bar.
    expect(face.abilityText).toBe('Game end: 1 VP for each Wheat card you have built.');
    expect(face.cost).toEqual([]);
    expect(face.costIcon).toBeNull();
  });

  /**
   * The starters used to print the GBP 2 that flipped them - all three of them
   * since 2026-08-12, when the Farmstead's milestone bar went with the free
   * flip. v31 deletes the flip, the second faces and the currency together, so a
   * starter prints NO cost bar at all. Asserted for all fifteen, because one
   * that quietly kept a price would be telling a publisher a rule the game does
   * not have.
   */
  it('no starter prints a cost bar, because none of them is ever bought or flipped', () => {
    const starters = data.cards.catalogue.filter(
      (c) => c.slot === 'barn' || c.slot === 'farmstead' || c.slot === 'noticeboard',
    );
    expect(starters).toHaveLength(15);
    for (const card of starters) {
      const face = printedFace(data, card.id);
      expect(face.cost, card.id).toEqual([]);
      expect(face.costIcon, card.id).toBeNull();
      expect(face.printedVp, card.id).toBe(0);
      // And no base face still promises a flip in words.
      expect(face.abilityText, card.id).not.toMatch(/flip|upgrade/i);
    }
  });

  it('W2 the Farmstead: the receipt tray, no stack, and no scoring', () => {
    const face = printedFace(data, 'W2');
    expect(face.threshold).toBeNull();
    expect(face.activation).toBeNull();
    expect(face.abilityText).toBe('Store Receipts here. Collect 6 to trigger end of the game.');
  });

  it('W3 Notice Board: wild activation, the CONVERT arrow, and the printed 3+', () => {
    const face = printedFace(data, 'W3');
    expect(face.activation).toBe('wild');
    expect(face.convert).toBe('convert');
    // The v31 sheet prints 2, and the second assertion is that the game this
    // package actually RENDERS agrees with the print.
    //
    // ⚠️ IT READS THE PIN AND NOT THE BASE VALUE SINCE 10/09/2026, which is
    // a real change of claim. The base `rules.economy.noticeBoardThreshold`
    // moved from 2 to 3 with the notice-board visit (S8's `3+`), so the two
    // stopped agreeing; the UI is pinned to the v31 control and pins that leaf
    // back to 2 by name, which is the number on screen and therefore the
    // number this print-versus-render file is about. Comparing against
    // BASE_GAME_DATA would now assert that the shipped ARM matches a v31 card
    // face, which is a claim nobody wants to be true.
    //
    // ⚠️ SHEET v42 (16/09/2026) PRINTS `3+`, extracted as 3, so the printed
    // face now matches the base rule and NOT the v31 control the UI is pinned
    // to (2). That divergence is the UI hybrid (C129), stated here so it
    // cannot be discovered by accident.
    expect(face.threshold).toBe(3);
    expect(face.threshold).toBe(data.rules.economy.noticeBoardThreshold);
    expect(control.rules.economy.noticeBoardThreshold).toBe(2);
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

  it('W18 Helping Hand: a Power card, so the caboose head and no stack', () => {
    const face = printedFace(data, 'W18');
    expect(face.costIcon).toBe('caboose');
    expect(face.threshold).toBeNull();
    expect(face.activation).toBeNull();
  });

  it('W19: an Endgame card takes the game-end head', () => {
    expect(printedFace(data, 'W19').costIcon).toBe('game_end');
  });

  /**
   * ⭐ THE 30 POWER AND ENDGAME CARDS COST CROPS NOW, not coins, and the icon
   * bar is where a player finds that out. Two coin icons became two crop icons
   * of the card's OWN suit, which is also one half of the v31 plan's risk 3 -
   * the monoculture pull - so it is worth pinning that the bar really does show
   * the card's own crop rather than a wild.
   */
  it('prices every Power and Endgame card in crops of its own suit', () => {
    const priced = data.cards.catalogue.filter((c) => c.type === 'power' || c.type === 'endgame');
    expect(priced).toHaveLength(30);
    for (const card of priced) {
      const face = printedFace(data, card.id);
      expect(face.cost.length, card.id).toBeGreaterThan(0);
      for (const icon of face.cost) {
        expect(icon, card.id).toEqual({ kind: 'crop', suit: card.suit });
      }
    }
  });
});

describe('printedFace, across the whole catalogue', () => {
  const every = data.cards.catalogue.map((card) => printedFace(data, card.id));

  it('covers all 105 cards, and exactly one face each', () => {
    expect(every).toHaveLength(105);
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
      expect([crops, wild]).toEqual([card.buildCost.suit, card.buildCost.wild]);
    }
  });

  it("follows ticket 07's crop rule: a starter belongs to no crop", () => {
    for (const card of data.cards.catalogue) {
      const face = printedFace(data, card.id);
      expect(face.identityIcon, card.id).toBe(card.type === 'starter' ? 'starter' : card.suit);
    }
  });

  /**
   * The bottom band is gone (2026-08-20): the printed template lays one band
   * across the top of every card. Nothing here selects a position any more, so
   * what is worth pinning is that every face still has a band to put text in -
   * i.e. that no card type quietly lost its ability line with the geometry.
   */
  it('gives every face an ability band to print into', () => {
    for (const face of every) {
      expect(typeof face.abilityText).toBe('string');
    }
    // And the ones that exist to carry text actually carry some.
    for (const card of data.cards.catalogue) {
      if (card.type !== 'power' && card.type !== 'endgame') continue;
      expect(printedFace(data, card.id).abilityText.length).toBeGreaterThan(0);
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
