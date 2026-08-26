/**
 * The gloss block is text a player will act on without checking, so it is
 * pinned.
 *
 * Three different kinds of risk, and the file is in three parts because of it:
 *
 *  - `glossAbility` is a keyword detector run over text a designer edits in a
 *    spreadsheet. Its failure is silent: a retyped card stops matching, the
 *    keyword goes unexplained, and nothing anywhere goes red. So the detection
 *    is pinned against real rows rather than against invented strings.
 *  - `glossCost` restates numbers that already exist elsewhere. Its failure is a
 *    disagreement with the card sitting directly above it, and the one that
 *    would actually happen is the Notice Board, whose printed threshold and
 *    enforced threshold are different numbers today.
 *  - `glossNow` makes claims about the live position. Its failure is the
 *    expensive one: a player told they can build something they cannot. Every
 *    assertion here is therefore a CROSS-CHECK against the engine's own move
 *    list, not a fixture.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';

import { Session } from '../session/table';
import { buildOffers } from './intent';
import { glossAbility, glossCost, glossNow } from './moveText';
import { printedFace } from './printed';

const terms = (text: string): string[] => glossAbility(data, text).map((t) => t.term);

/** A base face's printed ability, straight off the sheet. */
function ability(id: string, upgraded = false): string {
  return printedFace(data, id, upgraded).abilityText;
}

describe('glossAbility, against the sheet', () => {
  it('expands GROW where a card prints it', () => {
    // A5 The Meadow Hive - "GROW another of your buildings without placing a card."
    expect(terms(ability('A5'))).toEqual(['GROW']);
    expect(glossAbility(data, ability('A5'))[0]?.means).toContain('pay 1 card of its crop');
  });

  it('catches a keyword the sheet printed in lower case', () => {
    // A1 The Apiary Barn prints "sow the top card of any deck onto it". The
    // sheet is not consistent about capitals and a player cannot be expected to
    // notice which rows shout, so detection is case-insensitive.
    expect(ability('A1')).toContain('sow the top card');
    expect(terms(ability('A1'))).toEqual(['SOW']);
  });

  it('does not fire VISIT on VISITOR, which is the other side of the table', () => {
    // W3 The Wheat Notice Board - "VISITOR: Take £1 from bank / OR Harvest ..."
    expect(terms(ability('W3'))).toEqual(['VISITOR']);
    expect(glossAbility(data, ability('W3'))[0]?.means).toContain('never visit your own farm');
  });

  it('fires VISIT on the Helping Hand, which is the card that needs it most', () => {
    expect(terms(ability('A18'))).toEqual(['VISIT']);
    expect(glossAbility(data, ability('A18'))[0]?.means).toContain("neighbour's Notice Board");
  });

  it('reads the visit payout off the rules rather than printing a number', () => {
    const means = glossAbility(data, 'When you VISIT a neighbour, Draw 1.')[0]?.means ?? '';
    expect(means).toContain(`£${data.rules.economy.visitPayout.base}`);
  });

  it('says nothing about a card with no ability text', () => {
    expect(glossAbility(data, '')).toEqual([]);
    expect(glossAbility(data, '   ')).toEqual([]);
  });

  it('keeps one fixed order, whichever order the card printed them in', () => {
    expect(terms('SOW 1 card, then GROW that building.')).toEqual(['GROW', 'SOW']);
    expect(terms('GROW a building, then SOW 1 card onto it.')).toEqual(['GROW', 'SOW']);
  });

  it('expands HIRE and WORK, which no card in the current sheet prints', () => {
    expect(terms('HIRE the Draw Worker.')).toEqual(['HIRE']);
    expect(terms('WORK a rival Hired Worker.')).toEqual(['WORK']);
    // The half that makes the two entries above honest rather than decorative:
    // they are inert against today's data, and this is what would notice if a
    // re-text brought the words back without anybody rereading the gloss.
    const printed = data.cards.catalogue.flatMap((card) =>
      card.faces
        ? [ability(card.id), ability(card.id, true)]
        : [printedFace(data, card.id).abilityText],
    );
    expect(printed.filter((t) => /\bhires?\b|\bwork(s|ed|ing)?\b/i.test(t))).toEqual([]);
  });

  it('never invents a keyword: every term it returns is one it was asked about', () => {
    const known = new Set(['GROW', 'SOW', 'VISIT', 'VISITOR', 'HIRE', 'WORK']);
    for (const card of data.cards.catalogue) {
      const faces = card.faces ? [ability(card.id), ability(card.id, true)] : [ability(card.id)];
      for (const text of faces) {
        for (const t of terms(text)) expect(known, `${card.id}: ${t}`).toContain(t);
      }
    }
  });
});

describe('glossCost', () => {
  it('prices a starter as a FLIP, because a starter is never bought', () => {
    const lines = glossCost(data, printedFace(data, 'W1'));
    expect(lines).toContain(
      `To flip: £${data.rules.economy.upgradeCostCoins}, in your bonus slot. Once each, all game.`,
    );
    expect(lines.join(' ')).not.toContain('To build');
  });

  it('prices a deck card as a build, in words', () => {
    const card = data.cards.catalogue.find((c) => c.buildCost && c.buildCost.suit > 0);
    expect(card).toBeDefined();
    expect(glossCost(data, printedFace(data, card!.id))[0]).toMatch(/^To build: /);
  });

  it('names the GROW payment on a building that takes one', () => {
    const lines = glossCost(data, printedFace(data, 'A5'));
    expect(lines.some((l) => l.startsWith('To GROW:'))).toBe(true);
  });

  it('states the threshold the ENGINE enforces on a Notice Board, not the printed one', () => {
    const face = printedFace(data, 'W3');
    const override = data.rules.economy.noticeBoardThreshold;
    expect(override).not.toBeNull();
    // The two really do differ today - that is the whole reason for the line.
    expect(face.threshold).not.toBe(override);
    expect(glossCost(data, face)).toContain(
      `Neighbours fill it: ${override}, then it clogs until you harvest.`,
    );
  });

  it('offers no GROW on a Notice Board, which the engine never lets you grow', () => {
    expect(glossCost(data, printedFace(data, 'W3')).join(' ')).not.toContain('To GROW');
  });

  it('prices every buildable card in the set without falling back to "nothing"', () => {
    for (const card of data.cards.catalogue) {
      if (!card.buildCost) continue;
      const first = glossCost(data, printedFace(data, card.id))[0] ?? '';
      expect(first, card.id).toMatch(/^To build: /);
      expect(first, card.id).not.toContain('nothing');
    }
  });
});

/** A warmed session sitting on your turn, so `moves` is the engine's own list. */
function position(seed: string, depth = 220) {
  const session = new Session(data, {
    seats: 3,
    suits: ['wheat', 'vegetable', 'orchard'],
    seed,
    opponents: ['balanced', 'socialite', 'balanced'],
  });
  session.warmUp(depth, 4);
  let snap = session.snapshot();
  for (let i = 0; i < 40 && !snap.yours && !snap.over; i++) {
    session.stepBot();
    snap = session.snapshot();
  }
  return snap;
}

describe('glossNow, cross-checked against the move list', () => {
  const snap = position('gloss-a');

  it('found a position with a hand and a tableau to read', () => {
    expect(snap.yours).toBe(true);
    expect(snap.view.you.hand.length).toBeGreaterThan(0);
    expect(snap.view.you.tableau.length).toBeGreaterThan(0);
  });

  it('says "you can build this" exactly when the engine offers the build', () => {
    for (const id of snap.view.you.hand) {
      const face = printedFace(data, id);
      const lines = glossNow(data, face, snap.view, snap.moves, true);
      const legal = buildOffers(snap.moves, id).length > 0;
      expect(lines, id).toEqual(
        legal ? ['You can build this now.'] : [expect.stringMatching(/^You cannot build this yet/)],
      );
    }
  });

  it('never attaches a reason to a build that IS legal', () => {
    for (const id of snap.view.you.hand) {
      if (buildOffers(snap.moves, id).length === 0) continue;
      expect(
        glossNow(data, printedFace(data, id), snap.view, snap.moves, true).join(' '),
      ).not.toContain('short');
    }
  });

  it('reports a building fill that matches the view, and a GROW that matches the moves', () => {
    for (const b of snap.view.you.tableau) {
      const face = printedFace(data, b.card, b.upgraded);
      const lines = glossNow(data, face, snap.view, snap.moves, true);
      const growable = snap.moves.some((m) => m.type === 'grow' && m.building === b.card);
      expect(lines.join(' ').includes('You can GROW it now.'), b.card).toBe(growable);
      if (face.threshold !== null) {
        expect(lines[0], b.card).toMatch(new RegExp(`\\b${b.stack.length} of \\d+`));
      }
    }
  });

  it('passes no GROW verdict on a starter that can never be grown', () => {
    // The Barn and the Farmstead have no activation and the Notice Board is
    // excluded by slot. "No GROW here this turn" would be true of all three and
    // would teach a player to keep checking a door that does not exist.
    for (const b of snap.view.you.tableau) {
      const slot = data.cards.catalogue.find((c) => c.id === b.card)?.slot;
      if (slot === undefined) continue;
      const lines = glossNow(
        data,
        printedFace(data, b.card, b.upgraded),
        snap.view,
        snap.moves,
        true,
      );
      expect(lines.join(' '), b.card).not.toContain('GROW');
    }
  });

  it('says nothing at all about a card you neither hold nor own', () => {
    const held = new Set([...snap.view.you.hand, ...snap.view.you.tableau.map((b) => b.card)]);
    const stranger = data.cards.catalogue.find((c) => !held.has(c.id) && c.buildCost);
    expect(stranger).toBeDefined();
    expect(glossNow(data, printedFace(data, stranger!.id), snap.view, snap.moves, true)).toEqual(
      [],
    );
  });

  it('drops the GROW verdict when the decision is not yours', () => {
    const b = snap.view.you.tableau[0]!;
    const face = printedFace(data, b.card, b.upgraded);
    const idle = glossNow(data, face, snap.view, snap.moves, false);
    expect(idle.join(' ')).not.toContain('GROW');
  });
});
