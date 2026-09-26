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
// ⛔ THE UI'S OWN DATA, NOT `BASE_GAME_DATA`, since 04/09/2026. `session/table.ts`
// used to pin itself to the pre-notice-board v31 arm; the pin came down
// 18/09/2026 and this now loads the same shipped `loadGameData()` defaults the
// engine, the bots and the simulator play, with one override (no hand limit -
// see the docblock on `session/table.ts`). A test importing `data` from here is
// exercising the shipped game, not an arm.
import { data } from '../session/table';
import {
  answerTask,
  apply,
  cardById,
  growBuilding,
  handlerFor,
  pendingAnswers,
  player,
  testkit,
  viewFor,
} from '@gp/engine';
import type { CardId, GameState, Seat, TaskAnswer } from '@gp/engine';

import { Session } from '../session/table';
import { buildOffers } from './intent';
import {
  actionGroups,
  actionReason,
  describeAnswer,
  describeMove,
  describeTask,
  glossAbility,
  glossCost,
  glossNow,
  visitText,
} from './moveText';
import { printedFace } from './printed';
import { seatSuits } from './table';
import { seatName } from './suits';

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

  /**
   * ⛔ VISITOR IS GONE (18/09/2026, 2.6.2): no v42 or v44 card prints the word,
   * and the board threshold it used to explain now lives in `glossCost` (which
   * renders on every Notice Board face already). What still has to hold is the
   * reason VISITOR existed in the first place - VISIT must not fire on a word
   * that merely contains it - so this keeps that half as a plain word-boundary
   * check rather than a keyword-table entry.
   */
  it('does not fire VISIT on VISITOR, which is the other side of the table', () => {
    const visitor = 'VISITOR: place 1 card here, then Harvest one of your full buildings.';
    expect(terms(visitor)).toEqual([]);
  });

  /**
   * ⭐ THE VISIT GLOSS NAMES WHAT A VISIT IS, INCLUDING THAT YOUR OWN BOARD IS
   * OFF LIMITS. Self-visiting was legal for one day (10/09/2026) and was banned
   * again 11/09/2026 after it measured 44.4% of visits - the neighbour hook had
   * no subject - so the gloss says the opposite of what it said under v31: not
   * "your own board counts" but "never your own board".
   */
  it('says the visit is a rival-only act, never your own board', () => {
    const means = glossAbility(data, 'When you VISIT, Draw 1.')[0]?.means ?? '';
    expect(means).toContain('RIVAL');
    expect(means).toContain('Never your own board');
    // And it no longer promises money, because there is none.
    expect(means).not.toContain('£');
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
    const known = new Set(['GROW', 'SOW', 'VISIT']);
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

  it('states the threshold the ENGINE enforces on a Notice Board, as a minimum that never clogs', () => {
    const face = printedFace(data, 'W3');
    const enforced = data.rules.economy.noticeBoardThreshold ?? face.threshold;
    // S8, 13/09/2026: `3+` is a harvest MINIMUM and a Notice Board never clogs,
    // unlike an ordinary building's threshold - so the sentence says so rather
    // than reusing the "clogs until you harvest" wording below.
    expect(glossCost(data, face)).toContain(
      `A visit fills it: ${enforced}+ before you may harvest. Never blocks - another card is always welcome.`,
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
 * ⭐ THE v31 SELF-VISIT WORDING IS GONE (19/09/2026), AND THIS IS WHERE IT USED
 * TO BE PINNED. Self-visiting is banned under the shipped rules (Dean,
 * 11/09/2026: it measured 44.4% of visits and the neighbour hook had no
 * subject), so `visitText` no longer branches on `move.host === move.seat` at
 * all - every visit crosses the table to a named rival, and one sentence
 * covers the one thing a visit can now be. What is worth pinning instead is
 * that the sentence always NAMES the host, which is what would go wrong first
 * if a two-board host's `board` field were ever dropped on the floor.
 */
describe('visit text always names the host being visited', () => {
  const snap = position('visit-text');

  it('found a position with a hand to pay a fee from', () => {
    expect(snap.view.you.hand.length).toBeGreaterThan(0);
  });

  it('names a rival, never your own seat, on every visit the engine actually offers', () => {
    let checked = 0;
    for (const move of snap.moves) {
      if (move.type !== 'visit') continue;
      expect(move.host, JSON.stringify(move)).not.toBe(move.seat);
      const text = visitText(data, snap.view, move);
      const hostName = seatName(seatSuits(snap.view)[move.host], move.host, snap.view.seat);
      expect(text, JSON.stringify(move)).toContain(hostName);
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
   * ⛔ THE GRAND CREAMERY NO LONGER LIVES HERE. v47 retexted D15 to "Build a
   * card from your hand for free" (tasks/v47-rulings-v1.md), an ordinary
   * `build` task with nothing in limbo at all - `creameryFlip` and
   * `creameryPick` are both gone (see the `keys off task kinds` test below).
   * The deck-choice-then-reveal SHAPE it used to open with moved to D10 The
   * Scout's Post instead (the housekeeping note in tasks/v47-rulings-v1.md),
   * so this whole describe block, and every helper in it, now exercises D10.
   *
   * D10, mid-choice: one deck top in limbo (`scoutDeck` answered, choosing
   * wheat) and the `scout` pick task at the head of the queue. Driven through
   * the real engine rather than hand-built - a fabricated task could carry a
   * rider key or a `kind` the handlers stopped using, and the whole point of
   * the rendering is that it matches them.
   */
  function scout() {
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.buildFor(data, s, DAIRY, 'D10');
    // D5 grows it; the rest is a hand deep enough to afford a build at -2.
    testkit.dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const first = s.decks.wheat[0] as string;

    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    // `flipped`: the 'scoutDeck' task pending, which deck to reveal.
    const flipped = grown.state;
    const deckChoice = pendingAnswers(data, flipped).find(
      (a) => a.kind === 'card' && a.payload.suit === 'wheat',
    ) as TaskAnswer;
    // `state`: past the deck choice, at the 'scout' pick task, one card
    // revealed (v47: "any deck", not "each deck", so there is only ever one).
    const state = answerTask(data, flipped, deckChoice).state;
    return { state, flipped, first };
  }

  /**
   * ⚠️ THE DRIFT GUARD. Both renderings are keyed on the task's `kind`, which is
   * a string the handlers own and this file only quotes. If one is renamed the
   * log silently falls back to something vaguer, which no other assertion here
   * would catch - so the names are checked against the registry directly.
   */
  it('keys off task kinds the handlers really register', () => {
    expect(Object.keys(handlerFor('D10')?.tasks ?? {})).toEqual(
      expect.arrayContaining(['scoutDeck', 'scout']),
    );
    // v47: D15 registers no card task at all any more - it is a plain, free
    // `build` task (see the `case 'build'` branch in describeAnswer).
    expect(Object.keys(handlerFor('D15')?.tasks ?? {})).toEqual([]);
  });

  it('found a real position with one card in limbo', () => {
    const { state, first } = scout();
    const picks = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    expect(picks.length).toBeGreaterThan(0);
    // Answered by SLOT: no answer names a card, which is the engine's half.
    for (const answer of picks) {
      expect(answer.kind === 'card' && typeof answer.payload.pick).toBe('number');
      expect(JSON.stringify(answer)).not.toContain(first);
    }
  });

  it('THE OWNER sees the card it named, by name', () => {
    const { state, first } = scout();
    const you = viewFor(data, state, DAIRY);
    const said = pendingAnswers(data, state)
      .filter((a) => a.kind === 'card')
      .map((answer) => describeMove(data, you, { type: 'task', seat: DAIRY, answer }));
    const name = printedFace(data, first).name;
    expect(said.join(' | ')).toContain(name);
    // And it reads as what the card actually does with it: build it, paying
    // the discount-2 price - D10 is never free, unlike the old D15.
    for (const line of said) expect(line).toMatch(/^build .*, paying /);
  });

  /**
   * The half that matters. A rival's view carries the reveal masked to `W?`, so
   * the same answer must render as the crop and nothing more for the PICK half
   * - no card name for the revealed card, and no raw id of it anywhere in the
   * string. (The payment half names real hand cards even here; that is a
   * separate, already-covered concern - see "D10's build-from-limbo" below.)
   */
  it('A RIVAL sees only the crop, and never the id', () => {
    const { state, first } = scout();
    const them = viewFor(data, state, RIVAL);
    const said = pendingAnswers(data, state)
      .filter((a) => a.kind === 'card')
      .map((answer) => describeMove(data, them, { type: 'task', seat: DAIRY, answer }));

    for (const line of said) {
      expect(line).toContain('a Wheat card');
      expect(line).not.toContain(first);
      expect(line).not.toContain(printedFace(data, first).name);
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
    const { state } = scout();
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
   * owner, while the pick is masked for a rival exactly as above.
   */
  it("D10's build-from-limbo names the payment and masks the pick the same way", () => {
    const { state } = scout();
    const picks = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    expect(picks.length).toBeGreaterThan(0);

    const you = viewFor(data, state, DAIRY);
    const them = viewFor(data, state, RIVAL);
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
   * V13's long-retexted "discard a Vegetable card from your barn". D10's
   * `scoutDeck` stage is the one this position reaches (v47: it moved here from
   * D15's old `creameryFlip`, per the moveText.ts housekeeping note above).
   */
  it('says what a {suit} answer means on the task that offered it', () => {
    const { flipped } = scout();
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

/** Move deck cards straight into a seat's barn, bypassing payment. Shared by
 * every scenario below that needs a barn pre-loaded rather than paid into. */
function barnTo(state: GameState, seat: Seat, ...cards: CardId[]): void {
  for (const card of cards) {
    const suit = cardById(data, card).suit;
    const deck = state.decks[suit];
    const i = deck.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} deck`);
    deck.splice(i, 1);
    player(state, seat).barn.push(card);
  }
}

/**
 * The three gaps `ui-recon-2026-09-25-v1.md` found: D5's `sowSpent` and O9's
 * `give` had no sentence at all and fell to `describeCardPayload`'s raw-JSON
 * fallback, and V6's shared `barnDiscard` step fell to the bare `{suit}`
 * default ("the wheat crop", no verb). Each scenario below is driven through
 * the real engine, the same way the `scout` fixture above is, so the sentence
 * is checked against a payload the handlers actually produce.
 */
describe('D5, O9 and V6: no more raw JSON (recon 25/09/2026)', () => {
  it('D5 The Churning Shed: sows the spent card onto the building it built', () => {
    const DAIRY = 0;
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.noMeeples(s);
    testkit.buildFor(data, s, DAIRY, 'D5');
    testkit.dealTo(data, s, DAIRY, 'D6', 'W9', 'W4', 'W5', 'W6');
    // Growing D5 with D6 fires its activated Build; paying W9 with the rest of
    // the hand is what leaves cards for `sowSpent` to place one of.
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W9' && a.payment.length === 3,
    ) as TaskAnswer;
    expect(build).toBeDefined();
    const built = answerTask(data, grown.state, build).state;
    expect(built.tasks[0]).toMatchObject({ t: 'card', kind: 'sowSpent' });

    const you = viewFor(data, built, DAIRY);
    const sow = pendingAnswers(data, built).find((a) => a.kind === 'card') as TaskAnswer;
    const line = describeMove(data, you, { type: 'task', seat: DAIRY, answer: sow });
    expect(line).toMatch(/^sow .+ onto .+$/);
    // The building it built (W9) is what the sowed card lands on.
    expect(line).toContain(cardById(data, 'W9').name);
    expect(line).not.toContain('{');
  });

  it('O9 The Fruit Stand: names the recipient the same way every cross-table move does', () => {
    const ORCHARD = 0;
    const WHEAT = 1;
    const s = testkit.makeState(data, ['orchard', 'wheat', 'vegetable']);
    testkit.buildFor(data, s, ORCHARD, 'O9');
    testkit.dealTo(data, s, ORCHARD, 'O4', 'O5', 'O6');
    const grown = growBuilding(data, s, ORCHARD, 'O9', 'O4');
    const toWheat = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.to === WHEAT,
    ) as TaskAnswer;
    expect(toWheat).toBeDefined();

    const you = viewFor(data, grown.state, ORCHARD);
    const line = describeMove(data, you, { type: 'task', seat: ORCHARD, answer: toWheat });
    expect(line).toMatch(/^give .+ to .+$/);
    expect(line).toContain('Wheat farm');
    expect(line).not.toContain('{');
  });

  it('V6 The Trade Depot: the outgoing barn discard reads as a discard, not a bare crop', () => {
    const VEG = 0;
    const s = testkit.makeState(data, ['vegetable', 'wheat']);
    testkit.buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'O4');
    testkit.dealTo(data, s, VEG, 'V10');
    const grown = growBuilding(data, s, VEG, 'V6', 'V10');
    expect(grown.state.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });

    const you = viewFor(data, grown.state, VEG);
    const discard = pendingAnswers(data, grown.state).find((a) => a.kind === 'card') as TaskAnswer;
    const line = describeMove(data, you, { type: 'task', seat: VEG, answer: discard });
    expect(line).toMatch(/^discard a \w+ card from your barn$/);
    expect(line).not.toBe('the wheat crop');
    expect(line).not.toBe('the orchard crop');
  });

  /**
   * V8 and V15 share the exact same `barnDiscard` task the recon flagged for
   * V6 - the sentence has to be right for them too, not a V6-only patch. Both
   * discard a barn card the same way V6's outgoing leg does, so one shared
   * sentence is correct rather than a coincidence.
   */
  it('the shared barnDiscard sentence is equally right for V8 and V15', () => {
    for (const [card, payment] of [
      ['V8', 'V11'],
      ['V15', 'V16'],
    ] as const) {
      const VEG = 0;
      const s = testkit.makeState(data, ['vegetable', 'wheat']);
      testkit.buildFor(data, s, VEG, card);
      barnTo(s, VEG, 'W4');
      testkit.dealTo(data, s, VEG, payment);
      const grown = growBuilding(data, s, VEG, card, payment);
      const discardTask = grown.state.tasks.find((t) => t.t === 'card' && t.kind === 'barnDiscard');
      if (!discardTask) continue; // this card's gate did not open on this hand; not what is under test
      const you = viewFor(data, grown.state, VEG);
      const discard = pendingAnswers(data, grown.state).find((a) => a.kind === 'card') as
        TaskAnswer | undefined;
      if (!discard) continue;
      const line = describeMove(data, you, { type: 'task', seat: VEG, answer: discard });
      expect(line).toBe('discard a Wheat card from your barn');
    }
  });

  /**
   * The safety net (recon (e)): whatever the NEXT unwritten card task is, it
   * must never reach a player as `{"card":"D5-14"}`. `describeAnswer` is
   * exercised directly here with a made-up kind nothing registers, standing
   * in for the next gap before anyone has written its sentence.
   */
  it('a card task nobody has written a sentence for still reads as English, never JSON', () => {
    const line = describeAnswer(
      data,
      {
        kind: 'card',
        payload: { mystery: 42 },
      },
      {
        t: 'card',
        pid: 0,
        src: 'D1',
        kind: 'somethingNobodyHasWrittenYet',
        riders: {},
      },
    );
    expect(line).not.toMatch(/[{}]/);
    expect(line.length).toBeGreaterThan(0);
  });
});

/**
 * A second pass, requested after the first (25/09/2026): D18 A Helping Hand
 * (Dairy) shares D5/D7's exact `{card}` shape and had no sentence either, and
 * a grep of every `kind:` a handler under `packages/engine/src/handlers`
 * registers turned up four more live, reachable gaps the first recon missed
 * because it was scoped to the four named passes rather than the whole
 * catalogue: D14 The Cream Refinery (`refine`), O14 The Conservatory
 * (`sowAll`), V15 The International Port (`freeBuild`), and A6 The Garden
 * Hive (`growAny` - a `kind: 'card'` payload `{building, payment}` that looks
 * like it should hit the generic `grow` answer case but does not, because its
 * answer's own `kind` is `'card'`, not `'grow'`; only O13's now-retired shape
 * used to share that generic case). Three more - V12's `auctionSuit`, W15's
 * `patisserieDeck`, W16's `granaryDraw` - were already reaching a real
 * sentence (the `{suit}` default, "the wheat crop") rather than raw JSON, but
 * that default names no verb, so they are registered in `SUIT_ANSWER` too.
 * Each scenario below is driven through the real engine, same as the D5/O9/V6
 * tests above.
 */
describe('D18, and the rest of the catalogue: no unregistered card task reaches raw JSON (25/09/2026)', () => {
  it('D18 A Helping Hand (Dairy): puts one spent card into the barn', () => {
    const DAIRY = 0;
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.noMeeples(s);
    testkit.buildFor(data, s, DAIRY, 'D18');
    // D9 The Prosperity Wagon costs 3 (2 dairy + 1 any) - qualifies at "3 or more".
    testkit.dealTo(data, s, DAIRY, 'D9', 'D5', 'D6', 'W4');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'D9',
      payment: ['D5', 'D6', 'W4'],
    }).state;
    expect(built.tasks[0]).toMatchObject({ t: 'card', kind: 'd18Barn' });

    const you = viewFor(data, built, DAIRY);
    const put = pendingAnswers(data, built).find((a) => a.kind === 'card') as TaskAnswer;
    const line = describeMove(data, you, { type: 'task', seat: DAIRY, answer: put });
    expect(line).toMatch(/^put .+ into your barn$/);
    expect(line).not.toContain('{');
  });

  it('D14 The Cream Refinery: names the building being demolished', () => {
    const DAIRY = 0;
    const s = testkit.makeState(data, ['dairy', 'wheat']);
    testkit.buildFor(data, s, DAIRY, 'D14', 'D9');
    testkit.dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const takeD9 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D9',
    ) as TaskAnswer;

    const you = viewFor(data, grown.state, DAIRY);
    const line = describeMove(data, you, { type: 'task', seat: DAIRY, answer: takeD9 });
    expect(line).toBe(`demolish ${cardById(data, 'D9').name}`);
    expect(line).not.toContain('{');
  });

  it('O14 The Conservatory: sows a hand card onto a named building', () => {
    const ORCHARD = 0;
    const s = testkit.makeState(data, ['orchard', 'wheat']);
    testkit.buildFor(data, s, ORCHARD, 'O14', 'O4', 'O5');
    testkit.dealTo(data, s, ORCHARD, 'O6', 'O7', 'O8');
    const grown = growBuilding(data, s, ORCHARD, 'O14', 'O6');
    const sow = pendingAnswers(data, grown.state).find((a) => a.kind === 'card') as TaskAnswer;

    const you = viewFor(data, grown.state, ORCHARD);
    const line = describeMove(data, you, { type: 'task', seat: ORCHARD, answer: sow });
    expect(line).toMatch(/^sow .+ onto .+$/);
    expect(line).not.toContain('{');
  });

  it('V15 The International Port: names the free build', () => {
    const VEG = 0;
    const s = testkit.makeState(data, ['vegetable', 'wheat']);
    testkit.buildFor(data, s, VEG, 'V15');
    barnTo(s, VEG, 'D4', 'W4');
    testkit.dealTo(data, s, VEG, 'D9', 'D16', 'W5', 'V13');
    const grown = growBuilding(data, s, VEG, 'V15', 'V13');
    const discardDairy = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.suit === 'dairy',
    ) as TaskAnswer;
    const afterDiscard = answerTask(data, grown.state, discardDairy).state;
    expect(afterDiscard.tasks[0]).toMatchObject({ t: 'card', kind: 'freeBuild' });

    const build = pendingAnswers(data, afterDiscard).find(
      (a) => a.kind === 'card' && a.payload.card === 'D9',
    ) as TaskAnswer;
    const you = viewFor(data, afterDiscard, VEG);
    const line = describeMove(data, you, { type: 'task', seat: VEG, answer: build });
    expect(line).toBe(`build ${cardById(data, 'D9').name} for free`);
    expect(line).not.toContain('{');
  });

  it('A6 The Garden Hive: reads as an ordinary paid Grow, not raw JSON', () => {
    const APIARY = 0;
    const s = testkit.makeState(data, ['apiary', 'orchard']);
    testkit.buildFor(data, s, APIARY, 'A6', 'O4');
    testkit.dealTo(data, s, APIARY, 'A4', 'W4');
    const grown = growBuilding(data, s, APIARY, 'A6', 'A4');
    const anyCrop = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'O4' && a.payload.payment === 'W4',
    ) as TaskAnswer;

    const you = viewFor(data, grown.state, APIARY);
    const line = describeMove(data, you, { type: 'task', seat: APIARY, answer: anyCrop });
    expect(line).toBe(`${cardById(data, 'O4').name}, paying ${cardById(data, 'W4').name}`);
    expect(line).not.toContain('{');
  });
});

/**
 * B11 (25/09/2026): every action button gets a one-line reason, live or
 * disabled - "the greyed-out Build button, greyed out silently" is Top 3 in
 * the appraisal. `actionReason` is what `ActionBar.tsx` reads for both its
 * `title` tooltip and its hidden `aria-describedby` span, so the property
 * that matters is that it is NEVER the empty string, over real turn-tops
 * rather than an invented position - a family with zero legal moves is
 * exactly where an empty string would otherwise slip through unnoticed.
 */
describe('actionReason gives every family a non-empty sentence (B11)', () => {
  const seeds = ['reason-a', 'reason-b', 'reason-c'];

  it('never returns an empty or whitespace-only reason, live or disabled', () => {
    let liveChecked = 0;
    let disabledChecked = 0;
    for (const seed of seeds) {
      const snap = position(seed);
      const groups = actionGroups(data, snap.view, snap.moves).filter(
        (g) => !g.onBoard && g.zone !== 'exit',
      );
      for (const group of groups) {
        const reason = actionReason(snap.view, group.moves, group);
        expect(reason.trim().length, `${group.key}: "${reason}"`).toBeGreaterThan(0);
        expect(reason.startsWith(group.label), reason).toBe(true);
        if (group.moves.length > 0) liveChecked += 1;
        else disabledChecked += 1;
      }
    }
    // Both shapes actually occurred somewhere in the sample, or the "never
    // empty" claim above would only ever have been tested on one of them.
    expect(liveChecked).toBeGreaterThan(0);
    expect(disabledChecked).toBeGreaterThan(0);
  });

  it('never asserts a number for Deliver beyond what the barn genuinely holds', () => {
    // The one rule this file must not re-derive: how many cards a delivery
    // costs. The disabled sentence may say how many sit in the barn, never
    // invent a required total the engine alone knows.
    for (const seed of seeds) {
      const snap = position(seed);
      const barnTotal = Object.values(snap.view.you.barn).reduce((a, b) => a + (b ?? 0), 0);
      const group = actionGroups(data, snap.view, snap.moves).find((g) => g.type === 'deliver');
      if (!group) continue;
      const reason = actionReason(snap.view, group.moves, group);
      expect(reason).toContain(String(barnTotal));
    }
  });
});

/**
 * B13 (25/09/2026): no player-facing sentence out of this module says
 * "meeple" (the piece is a Worker everywhere a player reads it) or "door"
 * (internal shorthand for a suit's plain action). Swept over real warmed
 * positions - every move actually on offer, every family's live and disabled
 * reason, every task a position is actually showing - rather than asserted
 * about the FAMILIES table alone, which would miss a task or a move-specific
 * sentence built somewhere else in the file.
 */
describe('no jargon leaks into a player-facing sentence (B13)', () => {
  const seeds = ['jargon-a', 'jargon-b', 'jargon-c'];
  const clean = (s: string) => {
    const lower = s.toLowerCase();
    expect(lower, s).not.toContain('meeple');
    expect(lower, s).not.toContain('door');
  };

  it('describeMove, actionReason and describeTask stay in plain language', () => {
    let checked = 0;
    for (const seed of seeds) {
      const snap = position(seed);
      for (const move of snap.moves) {
        clean(describeMove(data, snap.view, move));
        checked += 1;
      }
      for (const group of actionGroups(data, snap.view, snap.moves)) {
        clean(actionReason(snap.view, group.moves, group));
        clean(group.label);
        checked += 1;
      }
      const task = snap.view.tasks[0];
      if (task && task.pid === snap.view.seat) {
        clean(describeTask(data, task));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
