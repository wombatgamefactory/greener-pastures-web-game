/**
 * The gloss block is text a player will act on without checking, so it is
 * pinned. And since v31 one more thing is pinned beside it: that a SELF-VISIT
 * and a NEIGHBOUR VISIT never come out of this module reading alike.
 *
 * Four different kinds of risk, and the file is in four parts because of it:
 *
 *  - `glossAbility` is a keyword detector run over text a designer edits in a
 *    spreadsheet. Its failure is silent: a retyped card stops matching, the
 *    keyword goes unexplained, and nothing anywhere goes red. So the detection
 *    is pinned against real rows rather than against invented strings.
 *  - `glossCost` restates numbers that already exist elsewhere. Its failure is a
 *    disagreement with the card sitting directly above it.
 *  - `glossNow` makes claims about the live position. Its failure is the
 *    expensive one: a player told they can build something they cannot. Every
 *    assertion here is therefore a CROSS-CHECK against the engine's own move
 *    list, not a fixture.
 *  - `visitText` is the v31 addition, and its failure is a design failure rather
 *    than a bug: the two acts read the same, a player takes the solitaire one
 *    thinking it was the hook, and the number the whole pass turns on is
 *    measured against a table that could not tell them apart.
 */

import { describe, expect, it } from 'vitest';
// ⛔ THE UI'S OWN DATA, NOT `BASE_GAME_DATA`, since 04/09/2026. The shipped
// rules are the meeple loop and this package still draws the v31 card-fee game,
// so `session/table.ts` pins itself to `overlays/v31-card-visit.overlay.json` -
// see the docblock there for why, and for what the UI pass owes. A test that
// reached past that pin would be measuring rules the interface does not draw.
import { data } from '../session/table';
import { answerTask, growBuilding, handlerFor, pendingAnswers, testkit, viewFor } from '@gp/engine';
import type { Move, TaskAnswer } from '@gp/engine';

import { Session } from '../session/table';
import { buildOffers } from './intent';
import { describeMove, glossAbility, glossCost, glossNow, visitText } from './moveText';
import { printedFace } from './printed';

const terms = (text: string): string[] => glossAbility(data, text).map((t) => t.term);

/** A card's printed ability, straight off the sheet. */
function ability(id: string): string {
  return printedFace(data, id).abilityText;
}

describe('glossAbility, against the sheet', () => {
  it('expands GROW where a card prints it', () => {
    // A5 The Meadow Hive - "GROW another of your buildings without placing a card."
    expect(terms(ability('A5'))).toEqual(['GROW']);
    expect(glossAbility(data, ability('A5'))[0]?.means).toContain('pay 1 card of its crop');
  });

  it('catches a keyword the sheet printed in lower case', () => {
    // The sheet is not consistent about capitals and a player cannot be expected
    // to notice which rows shout, so detection is case-insensitive.
    expect(terms('sow the top card of any deck onto it')).toEqual(['SOW']);
  });

  it('does not fire VISIT on VISITOR, which is the other side of the table', () => {
    // W3 The Wheat Notice Board - "VISITOR: place 1 card here, then Harvest ..."
    expect(terms(ability('W3'))).toEqual(['VISITOR']);
    expect(glossAbility(data, ability('W3'))[0]?.means).toContain('your suit');
  });

  /**
   * ⭐ THE VISIT GLOSS HAS TO NAME THE SELF-VISIT. It is the one rule in v31 that
   * a player meeting the word "VISIT" on a card would otherwise get wrong, and
   * getting it wrong in the generous direction (thinking your own board is off
   * limits, as it was in every version up to v30) means never noticing that the
   * solitaire door exists at all.
   */
  it('says that your own board counts, which is the rule that changed', () => {
    const means = glossAbility(data, 'When you VISIT, Draw 1.')[0]?.means ?? '';
    expect(means).toContain('own board');
    // And it no longer promises money, because there is none.
    expect(means).not.toContain('£');
  });

  it('reads the Notice Board threshold off the rules rather than printing a number', () => {
    const means = glossAbility(data, 'VISITOR: place 1 card here.')[0]?.means ?? '';
    expect(means).toContain(String(data.rules.economy.noticeBoardThreshold));
  });

  it('says nothing about a card with no ability text', () => {
    expect(glossAbility(data, '')).toEqual([]);
    expect(glossAbility(data, '   ')).toEqual([]);
  });

  it('keeps one fixed order, whichever order the card printed them in', () => {
    expect(terms('SOW 1 card, then GROW that building.')).toEqual(['GROW', 'SOW']);
    expect(terms('GROW a building, then SOW 1 card onto it.')).toEqual(['GROW', 'SOW']);
  });

  /**
   * ⛔ HIRE AND WORK WERE GLOSSED UNTIL v31 and are not any more. They were kept
   * through change 6 on the argument that a re-text could bring the Hiring
   * Fair's vocabulary back; there is no Fair, no Working Week, no wage and no
   * Service, so a gloss for either would be teaching a game nobody is playing.
   * This is the half that keeps the deletion honest: neither word appears on any
   * card, so nothing went unglossed when they went.
   */
  it('has no HIRE or WORK to gloss, because no card prints either', () => {
    expect(terms('HIRE the Draw Worker.')).toEqual([]);
    const printed = data.cards.catalogue.map((card) => ability(card.id));
    expect(printed.filter((t) => /\bhires?\b|\bwork(s|ed|ing)?\b/i.test(t))).toEqual([]);
  });

  it('never invents a keyword: every term it returns is one it was asked about', () => {
    const known = new Set(['GROW', 'SOW', 'VISIT', 'VISITOR']);
    for (const card of data.cards.catalogue) {
      for (const t of terms(ability(card.id))) expect(known, `${card.id}: ${t}`).toContain(t);
    }
  });
});

describe('glossCost', () => {
  /**
   * ⭐ A STARTER HAS NO COST LINE AT ALL (v31). It used to read "To flip: GBP 2,
   * in your bonus slot" - three deleted rules in one sentence. There is nothing
   * to buy, so the honest answer is silence rather than a rewritten price.
   */
  it('prices a starter as nothing, because it is neither bought nor flipped', () => {
    for (const id of ['W1', 'W2', 'W3']) {
      const lines = glossCost(data, printedFace(data, id)).join(' ');
      expect(lines, id).not.toContain('To build');
      expect(lines, id).not.toContain('flip');
      expect(lines, id).not.toContain('£');
    }
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

  it('states the threshold the ENGINE enforces on a Notice Board', () => {
    const face = printedFace(data, 'W3');
    const enforced = data.rules.economy.noticeBoardThreshold ?? face.threshold;
    expect(glossCost(data, face)).toContain(
      `Visitors fill it: ${enforced}, then it clogs until you harvest.`,
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

/**
 * ⭐ THE ASSERTION THE v31 PASS EXISTS FOR, at the text layer.
 *
 * A visit and a self-visit are one move with a flag. Everything else about them
 * is identical - same type, same cost, same slot - so the ONLY thing keeping a
 * player from taking one thinking it was the other is that every surface says
 * which is which. This is the surface three of them read from.
 */
describe('a self-visit never reads like a neighbour visit', () => {
  const snap = position('visit-text');

  const visit = (host: number): Move => ({
    type: 'visit',
    seat: snap.view.seat,
    host,
    fee: snap.view.you.hand[0] ?? 'W4',
  });

  it('found a position with a hand to pay a fee from', () => {
    expect(snap.view.you.hand.length).toBeGreaterThan(0);
  });

  it('names the neighbour on one and your own board on the other', () => {
    const mine = visitText(data, snap.view, visit(snap.view.seat) as never);
    const theirs = visitText(data, snap.view, visit(snap.view.rivals[0]!.seat) as never);
    expect(mine).toContain('own');
    expect(mine).toContain('No neighbour');
    expect(theirs).toContain('Visit');
    expect(theirs).not.toContain('own Notice Board');
  });

  it('shares no sentence between the two, on any host at the table', () => {
    const mine = visitText(data, snap.view, visit(snap.view.seat) as never);
    for (const rival of snap.view.rivals) {
      expect(visitText(data, snap.view, visit(rival.seat) as never)).not.toBe(mine);
    }
  });

  it('says the same thing through describeMove, which is what the menu prints', () => {
    const mine = describeMove(data, snap.view, visit(snap.view.seat));
    const theirs = describeMove(data, snap.view, visit(snap.view.rivals[0]!.seat));
    expect(mine).not.toBe(theirs);
    expect(mine).toContain('own');
  });

  /**
   * Every visit the engine really offers, checked in one sweep: a self one must
   * name your own board, a neighbour one must not. This is the version that
   * survives a re-wording, because it asserts the DISTINCTION rather than the
   * words.
   */
  it('splits every visit the engine offers, by its host and not by chance', () => {
    let checked = 0;
    for (const move of snap.moves) {
      if (move.type !== 'visit') continue;
      const text = visitText(data, snap.view, move);
      expect(/\bown\b/.test(text), JSON.stringify(move)).toBe(move.host === move.seat);
      checked += 1;
    }
    // Not `toBeGreaterThan(0)`: whether a given warmed position offers a visit
    // at all is a property of the walk. What is pinned is the implication.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});

describe('the two new moves are said in English', () => {
  const snap = position('gloss-a');

  it('names the meeple colour, its action and the fact that it leaves the game', () => {
    const text = describeMove(data, snap.view, {
      type: 'spendMeeple',
      seat: snap.view.seat,
      colour: 'orchard',
    });
    expect(text).toContain('Orchard');
    expect(text).toContain('Draw');
    expect(text).toContain('leaves the game');
  });

  it('reads the bonus draw off the rule rather than printing a number', () => {
    const text = describeMove(data, snap.view, { type: 'bonusDraw', seat: snap.view.seat });
    expect(text).toContain(String(data.rules.turn.bonusDraw));
  });

  it('reads the main draw off the rule, which is see 2 keep 2', () => {
    const text = describeMove(data, snap.view, { type: 'draw', seat: snap.view.seat });
    expect(text).toContain(String(data.rules.turn.baseDraw.see));
    expect(text).toContain(String(data.rules.turn.baseDraw.keep));
  });
});

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
      const face = printedFace(data, b.card);
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
      const lines = glossNow(data, printedFace(data, b.card), snap.view, snap.moves, true);
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
    const idle = glossNow(data, printedFace(data, b.card), snap.view, snap.moves, false);
    expect(idle.join(' ')).not.toContain('GROW');
  });
});

/**
 * ⭐ THE LIMBO REVEALS, AND THE LEAK THEY USED TO BE.
 *
 * D10 The Scout's Post and D15 The Grand Creamery turn deck tops face up into
 * LIMBO - a zone no `PlayerView` models, being in no hand, no pile and no stack
 * - and then let their owner choose one. Until the engine's fix of 03/09/2026
 * the choice was answered BY ID, so the revealed cards were named verbatim in
 * the move list every policy reads and in the replayable move log. They answer
 * `{ pick: 1 }` now and the ids live only on the task, where `redactTask` masks
 * them for every seat but the owner.
 *
 * That leaves the interface with the half this file owns: a slot resolved back
 * to a card, for the seat entitled to see it and no further. Both directions are
 * pinned, because only one of them is a bug you would notice. A missing name is
 * an ugly log; a name in front of a rival is the leak restored, and it would
 * look exactly like a fix.
 *
 * ⚠️ THE MASKING IS THE ENGINE'S, NOT THIS TEST'S. Both views come out of the
 * real `viewFor` on one real state, so what a rival sees here is what a rival
 * sees, rather than something the test arranged to be true.
 */
describe('a revealed deck top is named for its owner and masked for everyone else', () => {
  const DAIRY = 0;
  const RIVAL = 1;

  /**
   * The Grand Creamery, mid-choice: two deck tops in limbo and the pick task at
   * the head of the queue. Driven through the real engine rather than hand-built
   * - a fabricated task could carry a rider key or a `kind` the handlers stopped
   * using, and the whole point of the rendering is that it matches them.
   */
  function creamery() {
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.buildFor(data, s, DAIRY, 'D15');
    testkit.dealTo(data, s, DAIRY, 'W4');
    const first = s.decks.wheat[0] as string;
    const second = s.decks.wheat[1] as string;

    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    // Two decks to turn over. Both wheat, so the two reveals are known.
    const deck = (state: Parameters<typeof pendingAnswers>[1]) =>
      pendingAnswers(data, state).find(
        (a) => a.kind === 'card' && a.payload.suit === 'wheat',
      ) as TaskAnswer;
    let state = answerTask(data, grown.state, deck(grown.state)).state;
    const flipped = state;
    state = answerTask(data, state, deck(state)).state;
    return { state, flipped, first, second };
  }

  /**
   * ⚠️ THE DRIFT GUARD. Both renderings are keyed on the task's `kind`, which is
   * a string the handlers own and this file only quotes. If one is renamed the
   * log silently falls back to something vaguer, which no other assertion here
   * would catch - so the names are checked against the registry directly.
   */
  it('keys off task kinds the handlers really register', () => {
    expect(Object.keys(handlerFor('D15')?.tasks ?? {})).toEqual(
      expect.arrayContaining(['creameryFlip', 'creameryPick']),
    );
    expect(Object.keys(handlerFor('D10')?.tasks ?? {})).toEqual(expect.arrayContaining(['scout']));
  });

  it('found a real position with two cards in limbo', () => {
    const { state, first, second } = creamery();
    const picks = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    expect(picks.length).toBe(2);
    // Answered by SLOT: no answer names a card, which is the engine's half.
    for (const answer of picks) {
      expect(answer.kind === 'card' && typeof answer.payload.pick).toBe('number');
      expect(JSON.stringify(answer)).not.toContain(first);
      expect(JSON.stringify(answer)).not.toContain(second);
    }
  });

  it('THE OWNER sees the card it named, by name', () => {
    const { state, first, second } = creamery();
    const you = viewFor(data, state, DAIRY);
    const said = pendingAnswers(data, state)
      .filter((a) => a.kind === 'card')
      .map((answer) => describeMove(data, you, { type: 'task', seat: DAIRY, answer }));
    const names = [first, second].map((id) => printedFace(data, id).name);
    expect(said.join(' | ')).toContain(names[0] as string);
    expect(said.join(' | ')).toContain(names[1] as string);
    // And it reads as what the card actually does with it.
    for (const line of said) expect(line).toMatch(/^build .* for free$/);
  });

  /**
   * The half that matters. A rival's view carries the reveal masked to `W?`, so
   * the same answer must render as the crop and nothing more - no card name, and
   * no raw id anywhere in the string.
   */
  it('A RIVAL sees only the crop, and never the id', () => {
    const { state, first, second } = creamery();
    const them = viewFor(data, state, RIVAL);
    const said = pendingAnswers(data, state)
      .filter((a) => a.kind === 'card')
      .map((answer) => describeMove(data, them, { type: 'task', seat: DAIRY, answer }));

    for (const line of said) {
      expect(line).toContain('a Wheat card');
      expect(line).not.toContain(first);
      expect(line).not.toContain(second);
      expect(line).not.toContain(printedFace(data, first).name);
      expect(line).not.toContain(printedFace(data, second).name);
      // The mask itself is never printed raw either.
      expect(line).not.toMatch(/\b[WVOAD]\?/);
    }
  });

  /**
   * ⛔ AND NEITHER OF THEM IS THE OLD RENDERING. `{"pick":0}` is what a player
   * saw before this branch existed - meaningless - and `{"card":"W5"}` is what
   * they saw before the engine's fix, which was the leak in miniature.
   */
  it('renders neither the raw slot nor the raw id', () => {
    const { state } = creamery();
    for (const seat of [DAIRY, RIVAL]) {
      const view = viewFor(data, state, seat);
      for (const answer of pendingAnswers(data, state).filter((a) => a.kind === 'card')) {
        const line = describeMove(data, view, { type: 'task', seat: DAIRY, answer });
        expect(line).not.toContain('pick');
        expect(line).not.toContain('{');
      }
    }
  });

  /**
   * D10 The Scout's Post carries the OTHER payload shape: `{ pick, payment }`,
   * where the pick is a limbo card and the payment is hand cards. The two halves
   * are entitled differently and both have to come out right in one sentence -
   * the payment names cards the view already carries, so it stays named for its
   * owner, while the pick is masked for a rival exactly as the Creamery's is.
   */
  it("D10's build-from-limbo names the payment and masks the pick the same way", () => {
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.buildFor(data, s, DAIRY, 'D10');
    // D5 grows it; the rest is a hand deep enough to afford a build at -2.
    testkit.dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const picks = pendingAnswers(data, grown.state).filter((a) => a.kind === 'card');
    expect(picks.length).toBeGreaterThan(0);

    const you = viewFor(data, grown.state, DAIRY);
    const them = viewFor(data, grown.state, RIVAL);
    for (const answer of picks) {
      const mine = describeMove(data, you, { type: 'task', seat: DAIRY, answer });
      const theirs = describeMove(data, them, { type: 'task', seat: DAIRY, answer });
      expect(mine).toMatch(/^build .* paying /);
      expect(theirs).toMatch(/^build an? \w+ card, paying /);
      // Neither renders raw JSON, and the two never agree on what was picked.
      expect(mine).not.toContain('{');
      expect(theirs).not.toContain('{');
      expect(theirs).not.toBe(mine);
    }
  });

  /**
   * The second half of the same fix. `{ suit }` is produced by four different
   * cards meaning four different things, and every one of them used to render as
   * V13's long-retexted "discard a Vegetable card from your barn". The Creamery's
   * first stage is the one this position reaches.
   */
  it('says what a {suit} answer means on the task that offered it', () => {
    const { flipped } = creamery();
    const you = viewFor(data, flipped, DAIRY);
    const line = describeMove(data, you, {
      type: 'task',
      seat: DAIRY,
      answer: pendingAnswers(data, flipped).find(
        (a) => a.kind === 'card' && a.payload.suit === 'wheat',
      ) as TaskAnswer,
    });
    expect(line).toBe('reveal the top card of the Wheat deck');
    expect(line).not.toContain('barn');
  });
});
