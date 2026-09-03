/**
 * Ticket 05's proof: the handler API expressed against a spanning set of six
 * cards deliberately chosen from easy to worst. If any of these cannot be
 * written cleanly, the API is wrong - so these tests double as the API's
 * acceptance criteria and the difficulty scale's first calibration points.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import {
  answerTask,
  gameEndScores,
  growBuilding,
  pendingAnswers,
  standingMoves,
  visitWork,
} from '../runtime.js';
import { growOptions } from '../actions.js';
import { buildingOf, cardById, player, noticeBoardOf, thresholdOf } from '../query.js';
import type { GameState, Move, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState } from '../testkit.js';
import { handlerFor } from './registry.js';

const WHEAT = 0;
const APIARY = 1;

function base(): GameState {
  return makeState(data, ['wheat', 'apiary']);
}

/** Answer pending tasks with the first legal answer until the queue drains. */
function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 32 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

/**
 * The Meadow Hive is the suit's signature since the Apiary rebuild, and a
 * better spanning case than it was: it is the only shape in the game where a
 * card's text FIRES a building without placing anything on it, so it is where
 * the API's newest seam (`activate`) is proved.
 */
describe('1. The Meadow Hive (A5) - an activation with no placement', () => {
  it('pays one matching card in, then fires another building placing nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A6');

    const { state, audit } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(buildingOf(state, APIARY, 'A5').stack).toEqual(['A6']);
    expect(audit).toEqual({ tasksPushed: 1, crossSeat: false });
    // Never the Notice Board and never the Service: firing your own Service is
    // bonus-slot option 1, and no card may sell a bonus slot.
    expect(pendingAnswers(data, state)).toEqual([{ kind: 'activate', card: 'A10' }]);

    const fired = answerTask(data, state, { kind: 'activate', card: 'A10' });
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toEqual([]); // no stack advance
    expect(fired.state.tasks[0]).toMatchObject({ t: 'draw', src: 'A10' });
  });

  it('rejects a non-matching payment (GROW matching is the payment rule)', () => {
    // Asserted on the APIARY seat again since the rebuild: the Farmstead's
    // suit-wide crop waiver is deleted, so an Apiary seat matches crops like
    // everybody else and the waiver survives only on A6 The Garden Hive.
    const s = base();
    buildFor(data, s, APIARY, 'A5');
    const wheatCard = s.decks.wheat.shift() as string;
    player(s, APIARY).hand.push(wheatCard);
    expect(() => growBuilding(data, s, APIARY, 'A5', wheatCard)).toThrow(/needs a apiary card/);
  });

  it('takes a FULL building, which is the whole point of placing nothing', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A5', 'A10');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A10', 2); // threshold 2: full and clogged
    expect(growOptions(data, s, APIARY).some((o) => o.building === 'A10')).toBe(false);

    const { state } = growBuilding(data, s, APIARY, 'A5', 'A6');
    expect(pendingAnswers(data, state)).toEqual([{ kind: 'activate', card: 'A10' }]);
    const fired = answerTask(data, state, { kind: 'activate', card: 'A10' });
    expect(buildingOf(fired.state, APIARY, 'A10').stack).toHaveLength(2);
  });
});

/**
 * ⛔ THE ACTION CARD IS DELETED (19/08/2026, v30 plan §2.2). Dean's ruling was
 * one sentence - "The concept of an ACTION was never requested. They are all
 * GROW." - and it took the whole shape with it: `actionMoves` came off the
 * handler API along with the fifteen Tier 3 `moves` / `applyMove` pairs, and so
 * did the two rules that existed only to police them (a printed action spent
 * `turn.actionSpent` itself, and it SUPPRESSED `pass`, because a seat with a
 * legal action must not be offered the do-nothing move beside it).
 *
 * W13 was the first card ever written in that shape, so this block is where the
 * subtraction is recorded. Three of the tests below are the same tests INVERTED
 * rather than deleted, because the inversion is the only written record that
 * the shape ever existed.
 *
 * It is still a spanning case, for a different reason. The Bakery is now an
 * ordinary GROW building at threshold 1 with a wild activation - one card fires
 * it - and its ability is the WIDEST activation in the game: every building the
 * seat owns, the starters and the Service included, and W13 ITSELF, because
 * `doGrow` places the payment on the stack before it calls the handler. So the
 * card harvests the very fee that paid to fire it. That is correct and it is
 * most of what the card is for (the whole farm unclogs at once), but it reads
 * like a bug the first time it is seen, which is why it is pinned here.
 */
describe('2. The Bakery (W13) - a Tier 3 GROW whose ability is a whole-farm cascade', () => {
  /**
   * W13 and W4 built, W4 loaded to `w4` cards, and two cards in hand: W6 pays
   * the GROW and W7 is a spare.
   *
   * ⚠️ THE SPARE IS LOAD-BEARING AND IT IS NEW (19/08/2026). W2 the Farmstead
   * now banks a hand card on every harvest its owner takes, and its listener
   * returns without pushing anything if the hand is empty. With W6 spent on the
   * GROW and nothing behind it, the whole queue drained inside `apply`,
   * `settleTurn` ENDED THE TURN in the same call - resetting `actionSpent` and
   * passing the seat on - and the assertions below were reading the next
   * player's turn. Exactly the trap wheat.test.ts records against W7 in its own
   * fixture note. One spare card leaves the Farmstead's deposit pending, the
   * turn stays open, and these tests measure what they claim to.
   */
  function bakeryState(w4: number): GameState {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W4');
    if (w4 > 0) loadStack(data, s, WHEAT, 'W4', w4, 'apiary');
    dealTo(data, s, WHEAT, 'W6', 'W7'); // W6 pays the wild GROW; W7 holds the turn open
    return s;
  }

  /** The GROW that fires it, as a real move rather than through the runtime helper. */
  function bakeryGrow(): Move {
    return { type: 'grow', seat: WHEAT, building: 'W13', payment: 'W6' };
  }

  it('has a threshold of 1 and grows like anything else, where the ACTION card had none', () => {
    const s = bakeryState(0);
    expect(thresholdOf(data, buildingOf(s, WHEAT, 'W13'))).toBe(1);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'W13')).toBe(true);
    // And no standing move: the card contributes nothing to `legalMoves` itself.
    expect(standingMoves(data, s, WHEAT).some((m) => m.card === 'W13')).toBe(false);
  });

  it('harvests every loaded building, however many cards are on it, and spends the action', () => {
    const s = bakeryState(1); // W4 holding 1 of 2: nowhere near full
    const applied = apply(data, s, bakeryGrow());
    // The action is spent by the GROW now, not by the card. Same end state,
    // different payer: a card and the turn, where the ACTION cost only the turn.
    expect(applied.state.turn.actionSpent).toBe(true);
    expect(buildingOf(applied.state, WHEAT, 'W4').stack).toEqual([]);
    // Its own stack is emptied too, and the fee is in the barn: the payment
    // lands before the ability fires, so the Bakery harvests it straight back.
    expect(buildingOf(applied.state, WHEAT, 'W13').stack).toEqual([]);
    expect(player(applied.state, WHEAT).barn).toContain('W6');
    expect(player(applied.state, WHEAT).barn).toHaveLength(2);
    // ⛔ A SECOND `handToBarn` USED TO SIT IN FRONT OF THIS ONE, from W2 the
    // Farmstead, and it was what held the turn open - once per harvest ACTION
    // and not once per building, which was the guard the case existed to pin.
    // W2 is an end-game scorer since v31, so the only deposit left is W4 Wheat
    // Field's own printed HARVEST line, and the whole task list is now the
    // assertion.
    expect(applied.state.tasks).toMatchObject([{ t: 'handToBarn', src: 'W4', remaining: 1 }]);
  });

  it('fires with nothing else loaded, and banks its own fee for it', () => {
    // The old ACTION was WITHHELD with no loaded building, so it could never
    // hold a turn open on an empty farm. A GROW is always on offer instead, and
    // it is not a wasted action even here: the fee on the stack is a loaded
    // building, so one card in, one card to the barn.
    const s = bakeryState(0);
    const applied = apply(data, s, bakeryGrow());
    expect(player(applied.state, WHEAT).barn).toEqual(['W6']);
  });

  it('no longer suppresses `pass`, because it is no longer a main action', () => {
    const s = bakeryState(1);
    // Strip the hand and empty every deck so no action of any kind is legal.
    // Under the ACTION card this state still offered W13 and refused `pass`;
    // now W13 has nothing to pay its GROW with and `pass` is the only move.
    player(s, WHEAT).hand = [];
    for (const suit of data.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const moves = legalMoves(data, s);
    expect(moves.some((m) => m.type === 'cardMove' && m.card === 'W13')).toBe(false);
    expect(moves.some((m) => m.type === 'grow' && m.building === 'W13')).toBe(false);
    expect(moves.some((m) => m.type === 'pass')).toBe(true);
  });

  /**
   * The cross-handler case the rebuild's ruling turns on: The Granary fires
   * ONCE per harvest action, not once per building, or a Bakery over eight
   * buildings draws eight cards.
   */
  it('fires The Granary (W16) once for the whole cascade, not once per building', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W13', 'W16', 'W4', 'W5');
    loadStack(data, s, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary');
    dealTo(data, s, WHEAT, 'W6');
    const applied = apply(data, s, bakeryGrow());

    expect(buildingOf(applied.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(applied.state, WHEAT, 'W5').stack).toEqual([]);
    // Three buildings harvested now, not two - W13's own fee is the third - so
    // the guard has MORE to stop than it did, and the number is unmoved. The
    // Granary contributes exactly one Draw 1; the rest of the queue is W4's and
    // W5's own harvest lines.
    const granaryDraws = applied.state.tasks.filter(
      (t) => t.t === 'draw' && t.src === 'W16' && t.see === 1,
    );
    expect(granaryDraws).toHaveLength(1);
  });
});

describe('3. The Pie Shop (W17) - "Draw 1 when a neighbour places a card on one of your buildings"', () => {
  it('pays its owner when a rival places, wherever the card lands', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17');
    dealTo(data, s, APIARY, 'A6');
    // The door belongs to the HOST's suit, so an Apiary seat visiting a Wheat
    // seat buys a Harvest - and a door with nothing legal to do is not offered
    // (v31), so the visitor needs a full building of their own.
    buildFor(data, s, APIARY, 'A5');
    loadStack(data, s, APIARY, 'A5', 2, 'orchard');
    s.turnPlayer = APIARY;
    const applied = apply(data, s, { type: 'visit', seat: APIARY, host: WHEAT, fee: 'A6' });
    expect(applied.audit.crossSeat).toBe(true); // it fired for somebody else
    expect(applied.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(true);
  });

  it("pays nothing for its OWNER's own placements (scope is the listener, not the bus)", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17', 'W4');
    dealTo(data, s, WHEAT, 'W5');
    const { state } = growBuilding(data, s, WHEAT, 'W4', 'W5');
    expect(state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(false);
  });

  /**
   * ⭐ AND A SELF-VISIT IS NOT A NEIGHBOUR (v31). The card's own guard -
   * `event.seat === self.seat` - was belt-and-braces beside the target check
   * until v31 let a seat place its bonus card on its own board; it is
   * load-bearing now, because a visitor and a host can be the same seat for the
   * first time in this game.
   */
  it('pays nothing on a SELF-visit, which is a placement by its own owner', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W17', 'W9');
    loadStack(data, s, WHEAT, 'W9', 2, 'apiary'); // a full building for the door
    dealTo(data, s, WHEAT, 'W5');
    const applied = apply(data, s, { type: 'visit', seat: WHEAT, host: WHEAT, fee: 'W5' });
    expect(applied.state.tasks.some((t) => t.t === 'draw' && t.src === 'W17')).toBe(false);
  });
});

/**
 * ⛔ RE-POINTED 19/08/2026 (v30 plan group E), AND IT IS A TOTAL RE-POINT. The
 * Herb Hive used to read "Put 1 card from a neighbour's building into your barn,
 * then sow a deck top back" and it was APIARY'S ONLY TAKE-FROM-A-RIVAL CARD. It
 * now reads *"Draw 1 for every card on this building."* and the suit has none -
 * the `takeFromRival` task, the cross-seat `stackCardToBarn` path and the
 * replacement sow onto a neighbour's farm are all deleted.
 *
 * ⛔ WHAT WAS LOST WITH THEM, recorded here because nothing else in the engine
 * can express it any more: the ONLY remaining cross-table placement in the whole
 * game is the VISIT fee landing on a host's Notice Board or Service. Grepping
 * all 105 printed texts on 19/08/2026 turns up no card that sows onto a rival's
 * building, so the two deleted cases below - a card effect that reaches into a
 * rival's tableau without harvesting it, and a card effect that crosses the
 * table without opening the Helping Hand's VISIT gate - have no driver left. If
 * a cross-table sow is ever printed again, both are worth writing back.
 *
 * It stays a spanning case because the count is now the interesting part: the
 * GROW PAYMENT IS ON THE STACK BEFORE THE ABILITY FIRES, so the card reads one
 * higher than the table thinks it does.
 */
describe('4. The Herb Hive (A4) - a count of its own stack, the fee included', () => {
  it('draws one for every card on the stack, counting the fee that paid to fire it', () => {
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A6');
    loadStack(data, s, APIARY, 'A4', 2, 'apiary'); // 2 of its threshold 4

    const grown = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(grown.audit.tasksPushed).toBe(1);
    expect(grown.audit.crossSeat).toBe(false); // it no longer reaches anywhere
    expect(buildingOf(grown.state, APIARY, 'A4').stack).toHaveLength(3);
    // Draw 3, not 2: `doGrow` calls `fx.placeOnBuilding` before the handler, in
    // that order and by design, so the payment is counted.
    expect(grown.state.tasks[0]).toMatchObject({ t: 'draw', src: 'A4', see: 3, keep: 3 });
  });

  it('draws 1 from a standing start rather than whiffing, for the same reason', () => {
    // The old text was SKIPPED cleanly when no rival stack held a card, so an
    // empty table made it a dead activation. The new one cannot whiff at all:
    // the fee is always there to count, so the floor is Draw 1.
    const s = base();
    buildFor(data, s, APIARY, 'A4');
    dealTo(data, s, APIARY, 'A6');
    const { state } = growBuilding(data, s, APIARY, 'A4', 'A6');
    expect(state.tasks[0]).toMatchObject({ t: 'draw', src: 'A4', see: 1 });
  });
});

/**
 * ⛔ A HELPING HAND IS A BONUS-SLOT MODIFIER NOW (v31, plan section 3.1), and
 * this block is the record of what it was, because THIS CARD IS WHY THE HANDLER
 * API HAS STANDING MOVES AT ALL.
 *
 * It read "When you VISIT a neighbour and use their Service, you may place a
 * second card on it to use it again", and it was the hardest card in the game to
 * implement: a standing MOVE offered between moves, a turn-scoped gate in
 * `turn.visit`, a re-entry into the visit funnel and a second wage. Its three
 * tests proved the gate opened after a real visit, stayed shut without one, and
 * re-validated a repeat that was never offered.
 *
 * ⛔ WHAT IS LOST WITH IT, recorded as a LOSS rather than a tidy-up: the DENIAL
 * PLAY. Repeating a visit drove the target toward its clog in half the turns,
 * and it was the one card in the game that let a player deliberately shut a
 * door. Nothing replaces it.
 *
 * The new text - "Each turn, you may take both bonus options: Draw 1 AND place a
 * card on a Notice Board" - needs no handler body at all. `bonusSlotsFor`
 * (actions.ts) reads the printed rule plus whatever card text grants, and
 * `bonusOpen(option)` already refuses a second Draw or a second placement, so
 * "one of each and never two of either" falls out of the existing `bonusUsed`
 * list. `standingMoves` is what proves the old shape is gone.
 */
describe('5. A Helping Hand (W18) - the bonus-slot modifier', () => {
  it('contributes no standing move at all, where it was the only card that did', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W18');
    dealTo(data, s, WHEAT, 'W4', 'W5', 'W6');
    expect(standingMoves(data, s, WHEAT)).toEqual([]);
    expect(handlerFor('W18')?.moves).toBeUndefined();
    expect(handlerFor('W18')?.applyMove).toBeUndefined();
  });

  it('grants a SECOND bonus option: Draw 1 and a placement in the same turn', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W18', 'W9');
    loadStack(data, s, WHEAT, 'W9', 2, 'apiary'); // a full building for the door
    dealTo(data, s, WHEAT, 'W4');

    // Without the card the slot holds one option; with it, both are still open
    // after the first has gone.
    const drawn = answerAll(apply(data, s, { type: 'bonusDraw', seat: WHEAT }).state);
    expect(drawn.turn.bonusUsed).toEqual(['draw']);
    const visits = legalMoves(data, drawn).filter((m) => m.type === 'visit');
    expect(visits.length).toBeGreaterThan(0);
  });

  it('never grants two of the SAME option: the card says both, not twice', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W18');
    const drawn = answerAll(apply(data, s, { type: 'bonusDraw', seat: WHEAT }).state);
    expect(drawn.turn.bonusUsed).toEqual(['draw']);
    expect(legalMoves(data, drawn).some((m) => m.type === 'bonusDraw')).toBe(false);
  });

  /**
   * ⚠️ DUPLICATES DO NOT STACK, and the cap is deliberate rather than emergent.
   * There are exactly two bonus options, so a second copy could only ever grant
   * a slot with nothing legal to spend it on; capping at 1 says that in the code
   * instead of relying on `bonusOpen` to refuse it one layer down. Under the old
   * text duplicates DID stack - two built copies allowed two repeats a visit -
   * so this is a real change, not a restatement.
   */
  it('a second copy grants nothing: two built Helping Hands are still two options', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W18', 'A18'); // one from each suit, same card
    const drawn = answerAll(apply(data, s, { type: 'bonusDraw', seat: WHEAT }).state);
    expect(legalMoves(data, drawn).some((m) => m.type === 'bonusDraw')).toBe(false);
  });

  it('a seat with no copy built gets exactly one bonus option', () => {
    const s = base();
    const drawn = answerAll(apply(data, s, { type: 'bonusDraw', seat: WHEAT }).state);
    expect(drawn.turn.bonusUsed).toEqual(['draw']);
    expect(legalMoves(data, drawn).filter((m) => m.type === 'visit')).toEqual([]);
    expect(legalMoves(data, drawn).some((m) => m.type === 'bonusDraw')).toBe(false);
  });
});

describe('6. The Wheat Exchange (W19) - end-game scoring', () => {
  it('scores 2 VP per different crop in the tableau, through the score breakdown', () => {
    const s = base();
    // W19 itself (wheat) plus an apiary and an orchard building: three crops.
    buildFor(data, s, WHEAT, 'W19', 'A9', 'O9');
    player(s, WHEAT).receipts.push(4, 8);

    const scores = gameEndScores(data, s);
    const wheat = scores[WHEAT]!;
    // Starters print the generic starting-building icon, so they belong to no
    // crop and add nothing here (ticket 07's cropOf rule).
    // ⛔ THE BREAKDOWN IS THREE SOURCES, NOT FOUR (v31): `coinPity` is gone with
    // the currency, and W2 the Farmstead's own line - 1 VP per Wheat card built,
    // which here is W19 alone - now rides in `endgame` beside W19's own 6.
    expect(wheat.endgame).toBe(6 + 1);
    expect(wheat.receipts).toBe(12);
    // Printed VP: W19 prints 0, A9 and O9 print their own.
    const printed = (cardById(data, 'A9').printedVp ?? 0) + (cardById(data, 'O9').printedVp ?? 0);
    expect(wheat.printed).toBe(printed);
    expect(wheat.total).toBe(7 + 12 + printed);
    expect(scores[APIARY]!.total).toBe(0);
  });

  /**
   * ⛔ INVERTED (v31). This was "an upgraded starter DOES print a crop, so a
   * flip can add to it": `cropOf` returned a starter's own suit once it was
   * flipped, and the case pinned that flipping one already-counted crop did not
   * move the count. There are no flipped faces, so a starter prints the generic
   * icon for the whole game and the rule has no exception left at all.
   */
  it('a starter never prints a crop, so W19 counts deck cards and nothing else', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W19');
    // W19's 2 for wheat, plus W2's 1 for W19 itself being a Wheat card.
    expect(gameEndScores(data, s)[WHEAT]!.endgame).toBe(3);
    // Three Wheat starters sit in the tableau and contribute to neither line.
    expect(player(s, WHEAT).tableau).toHaveLength(4);
  });
});

describe('difficulty metadata stays honest', () => {
  it('derivable flags match the handler structure for every registered card', () => {
    for (const id of ['W13', 'W17', 'W19', 'A4', 'A5', 'W18', 'A18'] as const) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h!.difficulty.verified.endgame, id).toBe(typeof h!.gameEnd === 'function');
      expect(h!.difficulty.verified.addsMoves, id).toBe(typeof h!.moves === 'function');
    }
  });

  it('observed audits match the declared prompts/crossPlayer flags', () => {
    // Meadow Hive: it PROMPTS since the rebuild (the activate task asks which
    // building to fire) and still never touches another seat.
    const a5 = handlerFor('A5')!.difficulty.verified;
    expect(a5.prompts).toBe(true);
    expect(a5.crossPlayer).toBe(false);

    // Herb Hive: still prompts - it pushes a draw task, and a draw is a choice
    // of deck - but it NO LONGER CROSSES THE TABLE. Re-pointed 19/08/2026 from
    // "take a card off a rival's building" to "Draw 1 for every card on this
    // building", which is why the flag flipped; the live audit in §4 above
    // asserts the same thing from the other end (`crossSeat: false`).
    const a4 = handlerFor('A4')!.difficulty.verified;
    expect(a4.prompts).toBe(true);
    expect(a4.crossPlayer).toBe(false);

    // ⛔ HELPING HAND: ALL THREE FLAGS FLIPPED OR STAYED FALSE (v31). It was
    // "no prompt (it is a standing MOVE), crosses the table" with addsMoves
    // true; the rewrite is a bonus-slot modifier with no body, so it adds no
    // moves and - the reading worth pausing on - it is no longer crossPlayer
    // either. The card does nothing to anybody by itself; whether the extra
    // option is spent on a neighbour is the holder's choice, so it points at
    // the hook only as strongly as the player does.
    const hand = handlerFor('W18')!.difficulty.verified;
    expect(hand.prompts).toBe(false);
    expect(hand.crossPlayer).toBe(false);
    expect(hand.addsMoves).toBe(false);
  });
});

/**
 * THE DAIRY REBUILD'S CROSS-HANDLER CASES (2026-08-10, extended by the rebalance
 * of 2026-08-12).
 *
 * Pairs whose interaction is decided by a RULING rather than by either card's
 * own text, so neither card's own test file can own them. They live here for the
 * same reason the spanning set does: what is being checked is that the seams
 * compose, not that a card works.
 *
 * The rebalance added three, and all three are The Ledger's or the Farmstead's.
 * D16 moved off the once-per-build-SOURCE guard onto the general once-per-turn
 * rule, which is a change only a TWO-BUILD TURN can see; and the Farmstead's
 * diversion cap became "up to 2" in the same pass that took The Butter
 * Factory's discount away, which is why keeping the diversion is what stops a
 * discountless D12 being worthless.
 *
 * ⛔ THREE OF THOSE RULINGS WERE REVERSED OR DISSOLVED ON 19/08/2026 (v30), and
 * the tests are inverted rather than deleted because the inversion is the
 * record. D16 The Ledger LOST its "Once per turn" clause on the sheet, so the
 * once-per-turn guard it was so carefully moved onto is gone and every Build in
 * a turn draws; D15 The Grand Creamery's escalating run became a flat "reveal 2,
 * build 1", so the pair that used to prove the guard now proves arithmetic; and
 * the `covered` zone was deleted with D11's build-on-top, which takes half of
 * the D11 + D14 case out of the game entirely.
 *
 * ⛔ AND `actionMoveFor` IS GONE FROM THIS FILE. It found the standing `cardMove`
 * a Tier 3 ACTION card contributed, and the ACTION concept was deleted with the
 * same pass (see §2 above). Every card it used to drive - D14, D15, A14, O13 -
 * is now an ordinary GROW at threshold 1 with a wild activation, so the driver
 * is `growBuilding(...)` or a plain `{ type: 'grow' }` move and one spare card
 * in hand to pay it.
 */
describe('the Dairy rebuild: rulings that live between two cards', () => {
  const DAIRY = 0;
  const RIVAL = 1;

  function dairyState(): GameState {
    return makeState(data, ['dairy', 'wheat']);
  }

  /**
   * Drain the queue, counting every Draw The Ledger pushes on the way through.
   * The draws are consumed as they are answered, so a before/after diff at each
   * step is the only honest count - a tally of what is left at the end would
   * read zero however many times the card fired.
   */
  function drainCountingLedger(
    state: GameState,
    pick?: (answers: TaskAnswer[]) => TaskAnswer,
  ): { state: GameState; draws: number } {
    const pending = (s: GameState) =>
      s.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
    let s = state;
    let draws = pending(s);
    for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
      const before = pending(s);
      const answers = pendingAnswers(data, s);
      const answer = pick ? pick(answers) : answers[0];
      if (!answer) throw new Error('No legal answer to a live task');
      s = answerTask(data, s, answer).state;
      const after = pending(s);
      if (after > before) draws += after - before;
    }
    expect(s.tasks).toHaveLength(0);
    return { state: s, draws };
  }

  /**
   * ⚠️ THE ASSERTION SURVIVED THE PASS AND ITS REASON DID NOT, which is the
   * whole point of leaving it here.
   *
   * It used to read "the Ledger draws ONCE for a whole Grand Creamery RUN": D15
   * was an escalating reveal that built card after card until it busted, and the
   * 1 was the once-per-turn guard holding a multi-build effect to a single draw.
   * On 19/08/2026 both halves changed and cancelled out. D15 now reads *"Reveal
   * 2 deck cards. Build 1 for free. Discard the other."*, so there is no run and
   * exactly one build; D16 lost "Once per turn", so there is no guard. One
   * build, one unguarded draw, still 1. If either card moves again this number
   * moves with it, so do not read it as a guard still working.
   */
  it('D15 + D16: one free Creamery build pays the Ledger once, for a new reason', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    dealTo(data, s, DAIRY, 'W4'); // the GROW fee: D15 is threshold 1, activation wild
    const before = player(s, DAIRY).tableau.length;
    let state = growBuilding(data, s, DAIRY, 'D15', 'W4').state;

    // Two deck choices, then the pick of the two revealed cards.
    let ledgerDraws = 0;
    for (let guard = 0; guard < 40 && state.tasks.length > 0; guard++) {
      const drawsBefore = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      const answers = pendingAnswers(data, state);
      const flip = answers.find((a) => a.kind === 'card') ?? answers[0];
      state = answerTask(data, state, flip as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      if (after > drawsBefore) ledgerDraws += after - drawsBefore;
    }
    // EXACTLY one card was built, where the old run built as many as its luck
    // allowed - that is the half of the change the count cannot see.
    expect(player(state, DAIRY).tableau.length).toBe(before + 1);
    expect(ledgerDraws).toBe(1);
  });

  /**
   * ⛔ INVERTED 19/08/2026, AND THIS TEST HAS NOW SWUNG BOTH WAYS - which is why
   * it is worth reading the history rather than just the assertion.
   *
   * Round 1 (2026-08-10): the guard deduped by build SOURCE and deliberately
   * EXEMPTED a null source, so a plain Build and a bonus-slot Build were two
   * genuine Build actions and drew TWICE. Round 2 (2026-08-12): the Apiary
   * rebuild's rule 12(c) - no card's text may fire twice in a turn - was applied
   * to D16 and the pair drew ONCE. Round 3 (19/08/2026, v30 group A): the SHEET
   * dropped "Once per turn" from The Ledger's printed text, so the guard has
   * nothing to enforce and the pair draws TWICE again.
   *
   * `firedThisTurn` no longer carries 'D16' at all, and that is asserted below
   * rather than left implicit: the handler now runs with no guard of any kind
   * (see its notes, and v30 balance flag 8.4 - D15 builds free, D11 launders the
   * payment back onto the board and D16 pays for every build, all in one suit).
   *
   * ⚠️ THE TURN ORDER IS FORCED NOW and the test had to be rewritten for it.
   * `bonusAtStartOnly` is true since v30 §5, so the bonus slot is open only
   * while the main action is unspent: the Service Build must be taken FIRST and
   * the main Build second. Under the old rule this test took them the other way
   * round. The two builds are what matter, not their order.
   */
  it('D16 + a two-Build turn: a bonus-slot Build and a plain Build now draw TWICE', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'W4', 'W6', 'W7', 'W8');

    // ⛔ THE BONUS-SLOT BUILD IS A SELF-VISIT NOW (v31). It used to be
    // `workOwnWorker` - activate your own Service, paid to the bank, placing no
    // card - and the standing law behind it was that you never earn from your
    // own farm, so running your own door had to cost something. The self-visit
    // replaces it and is a strictly harder deal: the fee card LANDS on your own
    // Notice Board and counts toward your own threshold of 2, so feeding your
    // board shuts your own door rather than emptying a wallet.
    //
    // The bonus slot goes first because it is start-of-turn only.
    const bonus = visitWork(data, s, DAIRY, DAIRY, 'W8');
    // The door's Build is a task, so the answer is chosen by hand: W6, paid with
    // W7, which leaves W5 and W4 for the main action below. Letting the drain
    // take `a[0]` spends whatever it likes and the main Build then throws.
    const doorBuild = pendingAnswers(data, bonus.state).find(
      (a) => a.kind === 'build' && a.card === 'W6' && a.payment.join() === 'W7',
    );
    expect(doorBuild).toBeDefined();
    const first = drainCountingLedger(answerTask(data, bonus.state, doorBuild as TaskAnswer).state);
    expect(first.draws).toBe(1);
    // No mark: with the printed clause gone the handler stopped writing to the
    // shared once-per-turn list at all.
    expect(first.state.turn.firedThisTurn).not.toContain('D16');

    // Then the main Build action, which pays again.
    const built = apply(data, first.state, {
      type: 'build',
      seat: DAIRY,
      card: 'W5',
      payment: ['W4'],
    });
    const second = drainCountingLedger(built.state);
    // Two buildings really did land, and BOTH of them drew.
    expect(player(second.state, DAIRY).tableau.some((b) => b.card === 'W5')).toBe(true);
    expect(player(second.state, DAIRY).tableau.some((b) => b.card === 'W6')).toBe(true);
    expect(second.draws).toBe(1);
  });

  /**
   * ⛔ INVERTED 19/08/2026 with the test above, and this is the shape that shows
   * what "Once per turn" was actually holding back: D12 is ONE activation that
   * builds TWO buildings, so under either of the old guards - per Build ACTION
   * or per card per turn - it drew 1. With no clause on the card it draws per
   * BUILD, which is 2 out of a single Tier 2 activation.
   */
  it('D16 + D12: the Butter Factory now draws TWICE, once for each building', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D16', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    const drained = drainCountingLedger(
      grown.state,
      (a) => a.find((x) => x.kind === 'build') ?? (a[0] as TaskAnswer),
    );
    expect(drained.draws).toBe(2);
    expect(drained.state.turn.firedThisTurn).not.toContain('D16');
  });

  /**
   * ⛔ "D2 + D12: TWO BUILDS DIVERT TWICE, AND EACH DIVERSION CAPS AT 2" IS
   * DELETED (v31): the Dairy Farmstead is an end-game scorer and there is no
   * diversion to count. The ruling it pinned is worth keeping in words, because
   * it was deliberately left alone when D12 lost its discount in the same
   * rebalance: the COUNT was per card SPENT, not per Build action, so a
   * two-building Build diverted twice and that is what stopped a discountless
   * Butter Factory being worthless. Anything that ever prices a per-build effect
   * has the same choice to make.
   *
   * What survives, and is worth pinning in its place: D12 really does put two
   * buildings down off one activation, and BOTH payments go straight to their
   * discards with no prompt in between.
   */
  it('D12: two builds off one activation, both payments straight to the discard', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'W4', 'W5', 'W11', 'W12');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    const drained = answerAll(
      grown.state,
      (a) => a.find((x) => x.kind === 'build') ?? (a[0] as TaskAnswer),
    );
    const built = player(drained, DAIRY).tableau.filter(
      (b) => !['D1', 'D2', 'D3'].includes(b.card),
    );
    // D12 itself plus what the hand could actually pay for: the point of the
    // case is that each build's payment goes STRAIGHT to a discard with no
    // prompt in between, which is what the empty barn says.
    expect(built.length).toBeGreaterThanOrEqual(2);
    expect(player(drained, DAIRY).barn).toEqual([]);
  });

  /**
   * ⛔ "D2 + D7: A CARD LIFTED OFF A STACK IS NOT DIVERTIBLE" IS DELETED (v31)
   * WITH THE DIVERSION, and its ruling is the one most worth keeping of the
   * four: cards spent from your HAND only, because a card D7 lifted off a stack
   * going to the barn is stack to build cost to barn - a free Harvest, with no
   * Harvest action spent.
   *
   * ⚠️ AND ITS OTHER FINDING IS ABOUT THE WHOLE CARD SHEET RATHER THAN THIS
   * PAIR, so it survives the deletion and is pinned below. D7 was re-rated in
   * the v30 pass to "spend cards from one of your buildings as 2 WILD
   * resources", and a pure off-stack payment needs `cardsNeeded` even AND
   * `ownSuitMin` at most half of it. No card in the game satisfies both: 55
   * print 0 wild, 35 print exactly 1 and none print 2, so the own-crop minimum
   * is always more than half the cost, and an overpayment is never offered
   * either. SO A BUILD PAID ENTIRELY OFF STACKS IS IMPOSSIBLE FOR EVERY CARD IN
   * THE GAME - a hand with nothing spare in it has no legal build at all where
   * it used to have one.
   */
  it('D7: no build in the game is payable off stacks alone, so a mixed payment is forced', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D7', 'D4');
    // W9 Mill House costs 3, 2 of them wheat. One stack card covers 2 of that
    // and W4 covers the third; both are wheat, so the own-crop minimum is met.
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');

    expect(
      pendingAnswers(data, grown.state).some(
        (a) => a.kind === 'build' && a.payment.length === 0 && (a.stacks?.length ?? 0) > 0,
      ),
    ).toBe(false);

    const mixed = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W9' && a.payment.length === 1,
    );
    expect(mixed).toBeDefined();
    expect((mixed as { stacks?: string[] }).stacks).toHaveLength(1);
    const done = answerTask(data, grown.state, mixed as TaskAnswer).state;

    // Every card spent goes to a discard, hand card and stack card alike, and
    // nothing reaches a barn: there is no diverter left to offer either of them
    // a second destination.
    expect(player(done, DAIRY).barn).toEqual([]);
    expect(done.discards.wheat).toContain('W4');
    for (const card of stacked) {
      expect(player(done, DAIRY).barn).not.toContain(card);
    }
  });

  /**
   * ⛔ "D2 + D5: ONE DESTINATION PER SPENT CARD, AND THE PLAYER CHOOSES" IS
   * DELETED (v31), and its ruling is the ONE OF THE FOUR STILL ENFORCED IN
   * CODE. Banking a card took it out of the discard, so D5 could never also sow
   * it; the ordering that made that true - the diversion comes out BEFORE the
   * discard, never reclaimed from the pile afterwards - lives in
   * `divertOrDiscard` (actions.ts) and is what O17 The Fruit Basket now obeys by
   * PREPENDING its choice. The pair is pinned again in orchard.test.ts, from
   * O17's side.
   *
   * What survives here is D5 alone, with the whole payment available to it
   * because nothing takes a card out of the pile first.
   */
  it('D5: with no diverter in play, every spent card is available to sow back', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D5');
    dealTo(data, s, DAIRY, 'D6', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D5', 'D6');
    const build = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'build' && a.card === 'W7',
    );
    const spent = (build as { payment: string[] }).payment;
    const state = answerAll(answerTask(data, grown.state, build as TaskAnswer).state);
    // Both spent cards went back onto the new building, and the barn is empty.
    expect(buildingOf(state, DAIRY, 'W7').stack.sort()).toEqual([...spent].sort());
    expect(player(state, DAIRY).barn).toEqual([]);
  });

  /**
   * ⛔ HALF OF THIS TEST IS GONE BECAUSE HALF OF THE GAME STATE IS (19/08/2026,
   * v30 plan §7.1). It used to be "D11 + D14: a covered card cannot be
   * demolished, and neither counts as built", and it was a genuine pair: D11 The
   * Heritage House built ON TOP of a building, which buried the covered card in
   * a fourth player zone (`GameState.covered`) that scored its printed VP but
   * was not a building - so D14 had to be stopped from demolishing something
   * that was no longer on the table.
   *
   * D11 now reads *"Build. Sow all the cards spent."* Nothing in the game
   * produces a covered card, so `GameState.covered`, the `cover` primitive, the
   * `covered` event, the extra term in end-game printed VP and the guards
   * threaded through D13, D20 and D21 were all deleted together. WHAT WAS LOST
   * WITH THEM: the one exception to "not in the tableau means no printed VP".
   * The rule now has none, which is why the demolish half below is worth more
   * than it was rather than less - it is the only remaining path by which a
   * built card leaves the count.
   *
   * ⛔ AND THE DEMOLISH ITSELF WAS NERFED IN THE SAME PASS (balance flag 8.5).
   * The building and its whole stack go to the DISCARD, where they used to
   * become barn freight, and the payout is a flat 3 deck cards rather than one
   * per point of the building's cost. That destination is Dean's, deliberately:
   * routing the stack to the barn would restore the un-clog the card is no
   * longer for. It is asserted below because it is the kind of thing a later
   * "tidy" would quietly put back.
   */
  it('D14: a demolished building leaves the built count, and its stack goes to the discard', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D14', 'D20', 'D4', 'D5');
    dealTo(data, s, DAIRY, 'W4'); // the GROW fee: D14 is threshold 1, activation wild
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    // D20 scores 1 for every 2 buildings built since the rebalance, so the
    // fixture carries FOUR: D14, D20, D4 and D5. Three would round down to the
    // same 1 as two and the demolish below would prove nothing. D2 the
    // Farmstead adds a flat 1 per Dairy card built on top of it (v31), which is
    // the same 4 - so the total moves by 1 when a building leaves, not by 0.
    expect(gameEndScores(data, s)[DAIRY]!.endgame).toBe(2 + 4);

    const fired = growBuilding(data, s, DAIRY, 'D14', 'W4').state;
    const takeD4 = pendingAnswers(data, fired).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    expect(takeD4).toBeDefined();
    const gone = answerTask(data, fired, takeD4 as TaskAnswer).state;

    // Out of the tableau, so out of the count: four built become three, and
    // three rounds down to 1.
    expect(player(gone, DAIRY).tableau.some((b) => b.card === 'D4')).toBe(false);
    // 1 from D20 (three built, rounded down) and 3 from D2: a demolished
    // building leaves BOTH counts, which is the cost of demolishing.
    expect(gameEndScores(data, gone)[DAIRY]!.endgame).toBe(1 + 3);
    // The stack is DISCARDED, not banked. The only things that reach the barn
    // are the flat 3 deck cards, which arrive as their own tasks.
    for (const card of stacked) {
      expect(player(gone, DAIRY).barn).not.toContain(card);
      expect(gone.discards[cardById(data, card).suit]).toContain(card);
    }
    const drained = answerAll(gone, (a) => a[0] as TaskAnswer);
    expect(player(drained, DAIRY).barn).toHaveLength(3);
  });

  /**
   * ⛔ INVERTED (v31). D17's SCOPE FLIPPED FROM RIVAL TO OWNER, and the engine
   * had been running the older text: the card this file tested was "whenever a
   * NEIGHBOUR builds, take £1", the "materials yard", and the SHEET has printed
   * "When you build a card that is not Dairy" since v30. v31 converts the coin
   * to a draw and the handler follows the print on both halves at once.
   *
   * So the asymmetry with D16 survives - both fire per BUILDING rather than per
   * Build action - but they now fire for the same seat, and what separates them
   * is the crop: D16 pays for every build, D17 only for a foreign one.
   */
  it('the Strongbox pays per BUILDING and only for a FOREIGN one - the D16 asymmetry', () => {
    const s = dairyState();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const foreign = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(foreign.state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17')).toHaveLength(1);

    // A RIVAL's build pays nothing at all now: the suit is down to one
    // cross-table card, D6 The Trading Shed.
    const t = dairyState();
    buildFor(data, t, DAIRY, 'D17');
    dealTo(data, t, RIVAL, 'W5', 'W4');
    t.turnPlayer = RIVAL;
    const rival = apply(data, t, { type: 'build', seat: RIVAL, card: 'W5', payment: ['W4'] });
    expect(rival.state.tasks.some((x) => x.t === 'draw' && x.src === 'D17')).toBe(false);
  });
});

/**
 * THE APIARY REBUILD'S CROSS-HANDLER CASES (2026-08-11).
 *
 * Seven pairs whose interaction is settled by a RULING rather than by either
 * card's own text, so neither card's own test file can own them. Two of them -
 * the recursion guard and the Farmstead's scope - are the only reason the suit
 * terminates and the only reason The Honey Hut does not draw three.
 *
 * ⛔ THE SUIT STOPPED CROSSING THE TABLE ON 19/08/2026 (v30 group E), and three
 * of the seven pairs went with it. A4 The Herb Hive's take-from-a-rival, A14 The
 * Honeycomb Tower's sow onto a neighbour's building and A15 The Royal Apiary's
 * gift were all re-pointed inward on the same day, and `rivalSowTargets` - the
 * helper that enumerated a neighbour's buildings with room - was deleted with
 * them. Grepping all 105 printed texts afterwards leaves NO card in the game
 * that places a card on another seat's building; the visit fee is the only
 * cross-table placement left, which is what the surviving A16 case below now
 * uses as its driver. Two of the three deleted cases are named where they went.
 */
describe('the Apiary rebuild: rulings that live between two cards', () => {
  const SEAT = 0;
  const RIVAL = 1;

  function apiaryState(): GameState {
    return makeState(data, ['apiary', 'wheat']);
  }

  /** Prefer firing something: the drain loop otherwise answers draws forever. */
  function fireEverything(state: GameState): GameState {
    return answerAll(state, (a) => a.find((x) => x.kind === 'activate') ?? (a[0] as TaskAnswer));
  }

  /**
   * ⛔ THE RECURSION GUARD. A12 fires two buildings, one of which may be A5; A5
   * fires one, which may be A12. The ruling that closes it is "no card's text
   * may fire twice in a turn", held in `turn.firedThisTurn` and enforced by
   * FILTERING THE OPTION OUT rather than by throwing.
   */
  it('A12 + A5 does not loop, and neither does A5 + A12 + A5', () => {
    const viaHut = apiaryState();
    buildFor(data, viaHut, SEAT, 'A12', 'A5', 'A10');
    dealTo(data, viaHut, SEAT, 'A4');
    const hut = fireEverything(growBuilding(data, viaHut, SEAT, 'A12', 'A4').state);
    // Three cards fired, each exactly once - A5 could not reach back into A12.
    expect([...hut.turn.firedThisTurn].sort()).toEqual(['A10', 'A12', 'A5']);

    const viaMeadow = apiaryState();
    buildFor(data, viaMeadow, SEAT, 'A5', 'A12', 'A10');
    dealTo(data, viaMeadow, SEAT, 'A4');
    const meadow = fireEverything(growBuilding(data, viaMeadow, SEAT, 'A5', 'A4').state);
    expect([...meadow.turn.firedThisTurn].sort()).toEqual(['A10', 'A12', 'A5']);
  });

  /** The target set is WIDER than a GROW's: nothing is being placed, so a clog is irrelevant. */
  it('A12 fires a FULL building, and the stack does not grow', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A12', 'A10', 'A11');
    dealTo(data, s, SEAT, 'A4');
    loadStack(data, s, SEAT, 'A10', 2); // threshold 2: full and clogged
    loadStack(data, s, SEAT, 'A11', 2);
    expect(growOptions(data, s, SEAT).some((o) => o.building === 'A10')).toBe(false);

    const grown = growBuilding(data, s, SEAT, 'A12', 'A4');
    expect(
      pendingAnswers(data, grown.state)
        .flatMap((a) => (a.kind === 'activate' ? [a.card] : []))
        .sort(),
    ).toEqual(['A10', 'A11']);
    const state = fireEverything(grown.state);
    expect(buildingOf(state, SEAT, 'A10').stack).toHaveLength(2);
    expect([...state.turn.firedThisTurn].sort()).toEqual(['A10', 'A11', 'A12']);
  });

  /**
   * ⛔ THE FARMSTEAD'S GROW DRAW IS GONE (v31), so this test keeps the half
   * that is still observable and records the half that is not.
   *
   * THE RULING IT PROVED IS THE THING TO KEEP: a suit power modifies the GROW
   * ACTION, never card text that happens to say GROW. The seam lived on the
   * action branch in game.ts and never inside `doGrow`, because `doGrow` is also
   * called by A6 and O13 - so a seam there would have fired once per building
   * grown and The Honey Hut would have drawn three off one action.
   *
   * What is still testable is the recursion guard underneath it, which is the
   * only reason the suit terminates: A12 fires two OTHER buildings, each of them
   * exactly once, and every card that fires is marked.
   */
  it('A12 fires two buildings once each, and the Farmstead adds nothing to either', () => {
    const s = apiaryState();
    buildFor(data, s, SEAT, 'A12', 'A10', 'A11');
    dealTo(data, s, SEAT, 'A4');
    const hut = apply(data, s, { type: 'grow', seat: SEAT, building: 'A12', payment: 'A4' });
    expect(hut.state.tasks.filter((t) => t.t === 'draw' && t.src === 'A2')).toHaveLength(0);
    const fired = fireEverything(hut.state);
    expect([...fired.turn.firedThisTurn].sort()).toEqual(['A10', 'A11', 'A12']);

    const plain = apiaryState();
    buildFor(data, plain, SEAT, 'A11');
    dealTo(data, plain, SEAT, 'A4');
    const grown = apply(data, plain, { type: 'grow', seat: SEAT, building: 'A11', payment: 'A4' });
    // ...and a plain GROW action adds nothing either, which is what says the
    // seam is gone rather than merely bypassed by A12.
    expect(grown.state.tasks.filter((t) => t.t === 'draw' && t.src === 'A2')).toHaveLength(0);
  });

  /**
   * The guard lives in the SHARED path (`growOptions`), not in apiary.ts, which
   * is what stops O13 re-entering a card A6 The Garden Hive has already grown in
   * a mixed tableau.
   *
   * ⚠️ O13 IS THE SEED BANK NOW, not The Grand Orchard (v30 group C, a rename
   * only: the export moved `grandOrchard` -> `seedBank` and the text still reads
   * "GROW each of your ORCHARDs"). And it is a GROW rather than an ACTION, so it
   * is fired here by a plain grow move with a fee in hand - which incidentally
   * makes the fixture more honest than it was, because the fee lands on O13's
   * own stack and O13 is itself an ORCHARD, so the guard has one more card to
   * exclude than it used to.
   */
  it('A6 + O13: doGrow re-entry stays guarded in a mixed tableau', () => {
    const s = makeState(data, ['orchard', 'wheat']);
    buildFor(data, s, SEAT, 'O13', 'O4', 'O5', 'A6');
    dealTo(data, s, SEAT, 'A4', 'O6', 'O7', 'W4', 'W5');

    // A6 grows O4 with a card of ANY crop - a REAL grow, through doGrow.
    const grown = apply(data, s, { type: 'grow', seat: SEAT, building: 'A6', payment: 'A4' });
    const growO4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.building === 'O4' && a.payload.payment === 'W4',
    );
    expect(growO4).toBeDefined();
    const state = answerAll(answerTask(data, grown.state, growO4 as TaskAnswer).state);
    expect(buildingOf(state, SEAT, 'O4').stack).toEqual(['W4']);
    expect([...state.turn.firedThisTurn].sort()).toEqual(['A6', 'O4']);
    expect(growOptions(data, state, SEAT).map((o) => o.building)).not.toContain('O4');

    // Unspend the action so the same TURN can take O13's - the guard is what is
    // under test, not the one-action rule.
    state.turn.actionSpent = false;
    const run = apply(data, state, { type: 'grow', seat: SEAT, building: 'O13', payment: 'W5' });
    const offered = pendingAnswers(data, run.state).flatMap((a) =>
      a.kind === 'card' ? [a.payload.building] : [],
    );
    // O4 is excluded because A6 already grew it, and O13 because growing it is
    // what fired the run.
    expect(new Set(offered)).toEqual(new Set(['O5']));
  });

  /**
   * ⛔ TWO CASES WERE DELETED HERE ON 19/08/2026, and this is the note that says
   * what went with them, because nothing else in the engine can express either
   * one any more.
   *
   * 'A4 does not fire afterHarvest on the rival' pinned that A4's card was TAKEN
   * and not harvested, so no harvest hook fired on the seat it was taken from -
   * the rival's own Granary stayed silent and the card never reached their hand.
   * A4 now reads "Draw 1 for every card on this building" and touches no other
   * seat at all, so there is nothing left to take and nothing to fire.
   *
   * "A14 onto a rival's Notice Board clogs it, and the next visit offer says so"
   * pinned the clog watch from the other side: A14 sowed onto a neighbour's
   * board and a full board refuses the whole coin visit. A14 now reads "Gain £2
   * for each of your HIVEs" and places nothing. The ENGINE half of that case
   * survives elsewhere and was checked before deleting this one -
   * `game.test.ts`, "refuses the whole 2-card visit when the board has room for
   * only one" - so what is lost is the cross-handler half: no card in the game
   * can fill a rival's building any more, which means a leader can no longer be
   * clogged out of their own board by anyone but themselves.
   */

  /**
   * `afterPlacement` is placer-agnostic and the LISTENER guards (ruling G), so a
   * card that lands on your building from across the table never pays your Veil.
   *
   * ⚠️ THE DRIVER CHANGED, THE RULING DID NOT (19/08/2026). This used to be
   * driven by A14 sowing onto the rival's building. With every cross-table sow
   * deleted from the game, the VISIT FEE is the only placement one seat can make
   * on another's building, so that is what drives it now - and it is a better
   * probe than the sow was, because the visit is the shape the rule actually has
   * to survive in play. A neighbour's fee landing on your Notice Board takes it
   * to two cards and your Veil must stay silent.
   */
  it("A16 does not fire off a visitor's fee landing on its owner's board, only off its own placements", () => {
    const s = apiaryState();
    buildFor(data, s, RIVAL, 'A16', 'W6'); // the rival owns the Veil
    dealTo(data, s, SEAT, 'A4'); // the visit fee
    dealTo(data, s, RIVAL, 'W4'); // deal before loading: loadStack eats deck tops
    loadStack(data, s, RIVAL, 'W3', 1, 'wheat'); // their Notice Board holds 1 of 5
    loadStack(data, s, RIVAL, 'W6', 1, 'wheat');

    // The Wheat door is a Harvest, so the visitor needs a full building of
    // their own or the door is not offered at all (v31).
    buildFor(data, s, SEAT, 'A5');
    loadStack(data, s, SEAT, 'A5', 2, 'orchard');
    const visited = apply(data, s, { type: 'visit', seat: SEAT, host: RIVAL, fee: 'A4' });
    expect(buildingOf(visited.state, RIVAL, 'W3').stack).toHaveLength(2);
    expect(visited.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(false);

    // The same stack position, placed by the OWNER: it fires.
    const own = growBuilding(data, visited.state, RIVAL, 'W6', 'W4');
    expect(buildingOf(own.state, RIVAL, 'W6').stack).toHaveLength(2);
    expect(own.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(true);
  });
});

/**
 * THE WHEAT REBALANCE'S CROSS-HANDLER CASES (2026-08-12), RE-POINTED BY THE
 * W2/W3 SWAP (19/08/2026).
 *
 * Two seams came down in the rebalance and neither is visible from inside one
 * card. One of them has since been taken out of the game entirely.
 *
 * W16 The Granary moved off an event-stream guard ("fire only if this is the
 * first `harvested` of this apply") onto the shared `turn.firedThisTurn` guard,
 * which is a change only a harvest CHAINED THROUGH A TASK ANSWER can see - a
 * chained harvest is a separate apply, so it used to draw again. Rule change
 * 12(c) says no card's text may fire twice in a turn; this is that alignment.
 * That seam is untouched and its two tests still hold.
 *
 * ⛔ THE OTHER SEAM IS GONE. The rebalance had DEEPENED the W2 Farmstead's
 * relaxed harvest gate (2+ base, 1+ upgraded, where the flip used to buy a
 * whole second Harvest action), and the last two tests here were the loudest in
 * the file because that gate multiplied what the 2026-08-09 suit-power ruling
 * was worth. The sheet then transposed W2 and W3: the relaxation is the VISITOR
 * DOOR's printed action now, `relaxedMin: 2` on the Harvest Service, and W2
 * prints a barn deposit instead. So `wheatRelaxedMin` is deleted, the ruling
 * has no Wheat instance left to be proved on, and the two tests are re-pointed
 * at what DID change - the Service carrying a flat gate on both faces, and a
 * RIVAL renting it. Both say in their own comments what they used to assert.
 */
describe('the Wheat rebalance: rulings that live between two cards', () => {
  function wheatState(): GameState {
    return makeState(data, ['wheat', 'apiary']);
  }

  /**
   * Drain the queue, counting every Draw The Granary pushes on the way through.
   * The same shape as `drainCountingLedger` above and for the same reason: the
   * draws are consumed as they are answered, so a before/after diff at each step
   * is the only honest count - a tally of what is left at the end would read
   * zero however many times the card fired.
   */
  function drainCountingGranary(
    state: GameState,
    pick?: (answers: TaskAnswer[]) => TaskAnswer,
  ): { state: GameState; draws: number } {
    const pending = (s: GameState) =>
      s.tasks.filter((t) => t.t === 'draw' && t.src === 'W16').length;
    let s = state;
    let draws = pending(s);
    for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
      const before = pending(s);
      const answers = pendingAnswers(data, s);
      const answer = pick ? pick(answers) : answers[0];
      if (!answer) throw new Error('No legal answer to a live task');
      s = answerTask(data, s, answer).state;
      const after = pending(s);
      if (after > before) draws += after - before;
    }
    expect(s.tasks).toHaveLength(0);
    return { state: s, draws };
  }

  /**
   * The wheat seat's own door, reached by a SELF-VISIT and paid for with a card.
   *
   * ⛔ `workOwnWorker` AND `withHarvestService` ARE GONE (v31). The bonus slot's
   * other half used to be "activate your OWN Service, paid to the bank, placing
   * no card", and the standing law it enforced was that you never earn from your
   * own farm - so running your own door had to cost something. In v31 the owner
   * places a card on their own board exactly as a rival does, and the price is
   * that card plus a step toward their own threshold of 2. That is a sharper
   * brake than a coin ever was, because it shuts the door on everybody rather
   * than emptying one wallet.
   */
  function selfVisit(state: GameState, fee: string) {
    return visitWork(data, state, WHEAT, WHEAT, fee);
  }

  /**
   * ⛔ THE BEHAVIOURAL CHANGE OF THE REBALANCE, and the shape that can see it.
   * W8's second harvest arrives as the answer to a `chooseBuilding` task, which
   * is a separate apply from the action that started it, so the old event-stream
   * guard saw a fresh event stream and fired again. Two harvests, two cards. The
   * turn-scoped guard sees one turn and pays once.
   */
  it('W16 + W8: a harvest CHAINED through a task answer draws ONCE, where it drew twice', () => {
    const s = wheatState();
    buildFor(data, s, WHEAT, 'W16', 'W8', 'W5');
    loadStack(data, s, WHEAT, 'W8', 2, 'apiary'); // threshold 2: full
    loadStack(data, s, WHEAT, 'W5', 2, 'apiary'); // full, so W8's chooser has a target

    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W8' });
    const drained = drainCountingGranary(applied.state);

    // Both buildings really were harvested - two cards each - so the 1 below is
    // the guard biting and not a chain that never happened.
    //
    // ⛔ THE FIFTH CARD WAS W2 THE FARMSTEAD'S AND IT IS GONE (v31). The note
    // it carried is worth keeping because it was the sharpest example of the
    // guard's shape: the fixture deals nothing, so the hand was EMPTY when the
    // first harvest fired and the Farmstead skipped silently WITHOUT marking
    // itself fired; the Granary's draw then put a card in hand, and the chained
    // harvest found one there and banked it. The deposit and the draw sat on
    // opposite sides of the same guard question and gave opposite answers - a
    // no-op is not a firing.
    expect(player(drained.state, WHEAT).barn).toHaveLength(4);
    expect(drained.state.turn.firedThisTurn).toContain('W16');
    expect(drained.state.turn.firedThisTurn).not.toContain('W2');
    expect(drained.draws).toBe(1);
  });

  /**
   * The cascades, which the OLD guard already handled correctly (one apply, one
   * event stream, one draw). Pinned because the answer must not have moved when
   * the reason for it did: what used to be "the first harvested event of this
   * apply" is now "this card has fired this turn", and these two are where the
   * two rules agree.
   */
  it('W16 + W12 / W13: a cascade over several buildings still draws ONCE', () => {
    // W12 Crop Rotation, fired by a GROW: both FIELDs harvested inside one apply.
    const rotation = wheatState();
    buildFor(data, rotation, WHEAT, 'W16', 'W12', 'W4', 'W5');
    dealTo(data, rotation, WHEAT, 'W7');
    loadStack(data, rotation, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, rotation, WHEAT, 'W5', 2, 'apiary');
    loadStack(data, rotation, WHEAT, 'W12', 1, 'apiary'); // threshold 2: the payment fills it
    const grown = drainCountingGranary(growBuilding(data, rotation, WHEAT, 'W12', 'W7').state);
    // Both FIELDs emptied, so the cascade really did run: two cards each into
    // the barn, plus the one W4's own harvest line banks out of hand (the
    // Granary's draw resolves ahead of it, so there is a card there to bank).
    //
    // ⚠️ ONLY W5 RESEEDS NOW (19/08/2026). W4 lost the seed line from its
    // handler when the sheet's print lost it, so an emptied W4 stays empty and
    // the two FIELDs no longer answer alike - which is precisely the clause
    // W12 prints ("every FIELD with 1 or more cards on it") earning its words
    // back. W2 the Farmstead adds nothing here: the fee was the seat's only
    // card, so its listener saw an empty hand at both harvests and skipped
    // silently both times, before the Granary's draw had been answered.
    expect(buildingOf(grown.state, WHEAT, 'W4').stack).toEqual([]);
    expect(buildingOf(grown.state, WHEAT, 'W5').stack).toHaveLength(1);
    expect(grown.state.turn.firedThisTurn).not.toContain('W2');
    expect(player(grown.state, WHEAT).barn).toHaveLength(5);
    expect(grown.draws).toBe(1);

    // W13 The Bakery. Its own spanning case is §2 above; what is added here is
    // that the number survived the guard swap - and, since 19/08/2026, that it
    // survived the ACTION card being deleted underneath it too. The card is
    // fired by a GROW now, so the fee on its own stack is a THIRD building in
    // the cascade and the answer is still 1.
    const bakery = wheatState();
    buildFor(data, bakery, WHEAT, 'W16', 'W13', 'W4', 'W5');
    loadStack(data, bakery, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, bakery, WHEAT, 'W5', 2, 'apiary');
    dealTo(data, bakery, WHEAT, 'W6');
    const baked = drainCountingGranary(growBuilding(data, bakery, WHEAT, 'W13', 'W6').state);
    expect(baked.draws).toBe(1);
  });

  /**
   * ⚠️ AN OPEN QUESTION, ANSWERED BY MEASUREMENT RATHER THAN FORCED, and written
   * down here because the ticket asked for the answer whichever way it fell:
   *
   *     A SERVICE HARVEST IS INSIDE THE ONCE-PER-TURN BUDGET.
   *
   * `turn.firedThisTurn` is turn-scoped and nothing on the Service path clears
   * it, so a seat that takes the Harvest ACTION and then spends its bonus slot
   * on its own Harvest Service draws ONE card between the two, not one each.
   * Alone, the Service harvest pays normally.
   *
   * That is the reading the printed text supports ("Whenever you harvest, Draw
   * 1. Once per turn." - the turn is the unit on the card) and it costs nothing
   * to teach.
   *
   * ⚠️ THE SUBTLETY THIS COMMENT USED TO WARN ABOUT HAS BEEN CLOSED BY A RULE
   * CHANGE RATHER THAN BY A FIX (19/08/2026, v30 §5). It used to read: "it makes
   * the Service harvest worth strictly less AFTER a main harvest than before
   * one, so the order a Wheat seat takes its two harvests in is silently free".
   * The bonus slot is now START-OF-TURN ONLY (`rules.turn.bonusAtStartOnly`),
   * open only while the main action is unspent, so THE PLAYER NO LONGER CHOOSES
   * THE ORDER - the Service harvest must come first and the main harvest second.
   * The free choice is gone, and with it the reason the ordering mattered.
   *
   * The test is written in that order because the old order now THROWS ("the
   * bonus slot is shut"), and that throw is a rules statement, not a bug. The
   * ruling itself is untouched: one turn, one Granary draw, whichever harvest
   * gets there first. If Dean rules the other way the fix is still a per-source
   * guard and this test still flips.
   */
  it('W16 + the Wheat door: a door harvest is INSIDE the once-per-turn budget', () => {
    // On its own it is a harvest like any other, and it pays.
    const alone = wheatState();
    buildFor(data, alone, WHEAT, 'W16', 'W4');
    dealTo(data, alone, WHEAT, 'W20'); // the visit fee
    loadStack(data, alone, WHEAT, 'W4', 2, 'apiary');
    const solo = drainCountingGranary(selfVisit(alone, 'W20').state);
    expect(solo.draws).toBe(1);

    // The bonus slot first, then the main action - the only order the turn
    // structure now allows. The door harvest pays; the main one does not.
    const both = wheatState();
    buildFor(data, both, WHEAT, 'W16', 'W4', 'W5');
    dealTo(data, both, WHEAT, 'W20');
    loadStack(data, both, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, both, WHEAT, 'W5', 2, 'apiary');
    const door = drainCountingGranary(selfVisit(both, 'W20').state);
    expect(door.draws).toBe(1);
    const main = drainCountingGranary(
      apply(data, door.state, { type: 'harvest', seat: WHEAT, building: 'W5' }).state,
    );
    expect(main.draws).toBe(0);
    // And the second harvest genuinely happened: W5 emptied and reseeded. The 0
    // is the guard, not an action that found nothing to take.
    expect(buildingOf(main.state, WHEAT, 'W5').stack).toHaveLength(1);

    // The old order is now illegal, and that is the rule rather than an
    // accident: the bonus slot shuts the moment the main action is taken.
    const reversed = wheatState();
    buildFor(data, reversed, WHEAT, 'W16', 'W4', 'W5');
    dealTo(data, reversed, WHEAT, 'W20');
    loadStack(data, reversed, WHEAT, 'W4', 2, 'apiary');
    loadStack(data, reversed, WHEAT, 'W5', 2, 'apiary');
    const first = apply(data, reversed, { type: 'harvest', seat: WHEAT, building: 'W4' });
    expect(() => selfVisit(first.state, 'W20')).toThrow(/bonus slot is shut/);
  });

  /**
   * ⛔ THE RELAXED HARVEST HAS LEFT THE GAME, AND THIS TEST HAS NOW INVERTED
   * TWICE. It was "W2 + the Harvest Service: the Service inherits the gate at
   * BOTH depths", and it proved the permissive half of the locked ruling - suit
   * powers DO apply to an action performed through a door, it is your action
   * done on someone else's premises - by watching the gate MOVE with the
   * Farmstead's flip, 2+ unflipped and 1+ upgraded. On 19/08/2026 the sheet
   * swapped W2 and W3, so the relaxation became the DOOR's own printed action at
   * a flat 2+ and the seat had no gate left to inherit.
   *
   * v31 makes every door plain, on the argument that the bonus slot itself
   * became the enhancement: a door buys a WHOLE CORE ACTION for one card, which
   * is a far bigger prize than any rider was. So there is no relaxation
   * anywhere - not on the card, not on the door - and the only gates left in
   * the game are the ones a CARD prints for itself (W8, W11, W12, W13) plus the
   * magenta balloon's "harvest any building, even if it is not full".
   *
   * ⚠️ THE RULING IS NOT REFUTED, IT IS UNEMPLOYED, and now completely so:
   * Wheat was its instance, the Orchard draw modifier where it was last proved
   * went with the Farmsteads, and nothing in v31 grants a modifier for a door
   * action to carry. It still governs anything a card grants, which is why the
   * sentence is kept rather than deleted.
   */
  it('W2 + the Wheat door: the door is the PLAIN Harvest, full buildings only', () => {
    const s = wheatState();
    buildFor(data, s, WHEAT, 'W7', 'W9'); // W7 threshold 3, W9 threshold 2
    dealTo(data, s, WHEAT, 'W20'); // the visit fee
    loadStack(data, s, WHEAT, 'W7', 2, 'apiary'); // 2 of 3: relaxed only, so OUT
    loadStack(data, s, WHEAT, 'W9', 2, 'apiary'); // full, so IN
    const out = selfVisit(s, 'W20');
    const offered = pendingAnswers(data, out.state)
      .flatMap((a) => (a.kind === 'building' ? [a.card] : []))
      .sort();
    // The old assertion was `['W7']` - the 2-of-3 relaxed target and nothing
    // else. It is exactly the other way round now.
    expect(offered).toEqual(['W9']);
  });

  /**
   * ⛔ AND A DOOR WITH NOTHING LEGAL TO DO IS NOT OFFERED AT ALL (ruled v31).
   * With no full building the Wheat door is a no-op, and the engine declines to
   * sell it: a visit costs a card and returns an action, so a visit whose action
   * is a no-op is a strictly dominated move. ⚠️ It has a cost worth knowing - a
   * seat can be locked out of the bonus slot's interaction half entirely - and
   * `bonusDraw` is what backstops it.
   */
  it('a Wheat door with no full building is not offered, and the free Draw 1 backstops it', () => {
    const s = wheatState();
    buildFor(data, s, WHEAT, 'W7');
    dealTo(data, s, WHEAT, 'W20');
    loadStack(data, s, WHEAT, 'W7', 2, 'apiary'); // 2 of 3: nothing to harvest
    expect(legalMoves(data, s).filter((m) => m.type === 'visit')).toEqual([]);
    expect(legalMoves(data, s).some((m) => m.type === 'bonusDraw')).toBe(true);
  });

  /**
   * ⛔ "A RIVAL VISITING A WHEAT FARM RENTS THE 2+ GATE" IS DELETED (v31), and
   * with it the thing the 19/08/2026 swap was worth doing FOR: the suit's
   * signature verb crossing the table. A non-Wheat seat placed a card on a Wheat
   * farm's door and harvested one of THEIR OWN buildings at 2+, with nothing
   * about the host consulted - the gate travelled with the action because it was
   * printed on the action. v31's flat doors delete the gate, so what a visitor
   * rents is the plain Harvest.
   *
   * ⚠️ ONE FINDING FROM IT SURVIVES AND IS PINNED BELOW, because it was a
   * disagreement between two pieces of the engine rather than a property of the
   * card. The visit's legality gate is `workerActionLegal`, whose harvest branch
   * called `harvestOptions` with NO `relaxedMin` - so a visitor whose only
   * 2-loaded building was not full was told the door had nothing legal to do and
   * the visit was refused, EVEN THOUGH the action it would have granted had a
   * target. The gate and the action disagreed, and it was flagged to Dean on
   * 19/08/2026. v31 closes it by removing every modifier that could disagree,
   * which is a cure by amputation: THE STANDING RULE IS THAT A GATE AND THE
   * ACTION IT GATES MUST BE HANDED THE SAME MODIFIERS, and the next rider
   * printed on a door will meet it again.
   *
   * What is still true, and worth a test of its own: THE ACTION IS THE
   * VISITOR'S. It reads and empties the visitor's own tableau, and the host gets
   * nothing but the card on their board.
   */
  it('a rival visiting a Wheat farm harvests THEIR OWN full building, not the host’s', () => {
    const s = wheatState();
    dealTo(data, s, APIARY, 'A4'); // the visitor's fee card
    buildFor(data, s, APIARY, 'A7', 'A9');
    const partial = thresholdOf(data, buildingOf(s, APIARY, 'A7')) as number;
    expect(partial).toBeGreaterThan(2); // A7 prints 3: 2 cards leave it NOT full
    loadStack(data, s, APIARY, 'A7', 2, 'wheat');
    const strict = thresholdOf(data, buildingOf(s, APIARY, 'A9')) as number;
    loadStack(data, s, APIARY, 'A9', strict, 'wheat');

    // The host has a full building of its own, which must NOT be offered: the
    // door is the host's, the action is the visitor's.
    buildFor(data, s, WHEAT, 'W9');
    loadStack(data, s, WHEAT, 'W9', 2, 'apiary');

    const visited = visitWork(data, s, APIARY, WHEAT, 'A4');
    expect(noticeBoardOf(data, visited.state, WHEAT).stack).toEqual(['A4']);
    const offered = pendingAnswers(data, visited.state)
      .flatMap((a) => (a.kind === 'building' ? [a.card] : []))
      .sort();
    // A9 alone: the visitor's full building. Not A7 (2 of 3, and nothing relaxes
    // any more) and not W9 (the host's).
    expect(offered).toEqual(['A9']);

    const done = answerTask(data, visited.state, { kind: 'building', card: 'A9' }).state;
    expect(buildingOf(done, APIARY, 'A9').stack).toEqual([]);
    expect(player(done, APIARY).barn).toHaveLength(strict);
    expect(player(done, WHEAT).barn).toEqual([]);
  });

  /**
   * ⛔ THE RULING THIS BLOCK EXISTS TO PROTECT (decided 2026-08-09) IS UNCHANGED:
   * A SUIT POWER MODIFIES THE ACTION, NEVER CARD TEXT THAT HAPPENS TO USE THE
   * SAME WORD. WHAT INVERTED IS THE CARD (19/08/2026, v30 group D), and the two
   * must not be confused, because the assertion below is now the opposite of
   * what it used to be while the rule behind it has not moved a word.
   *
   * W8 Heritage Field used to say plain "Harvest another of your buildings" and
   * print no exception, which was the STRICT full gate precisely BECAUSE W11 and
   * W13 spelled their exception out in words ("however many cards are on it")
   * and W12 in numbers ("1 or more") and W8 did neither. The v30 pass simplified
   * the card - the GROW-time barn deposit and the deck seed both went - and the
   * harvest line GAINED "even if not full". So W8 has joined the other three: it
   * takes any building holding 1 or more, because ITS OWN TEXT SAYS SO.
   *
   * ⚠️ AND THE RULING IS NOW STRUCTURALLY TRIVIAL, WHICH THIS TEST HAS TO SAY
   * OUT LOUD RATHER THAN GO ON PRETENDING (19/08/2026, the W2/W3 swap). It used
   * to be a real comparison: W2 relaxed the HARVEST ACTION to 2+ base and 1+
   * upgraded, so if W8 were inheriting the suit power its gate would MOVE with
   * the flip, and running both faces and demanding an identical offered set was
   * the proof that it did not. W2 HAS NO GATE ANY MORE. There is nothing for
   * W8 to inherit, from either face or from any face, so the loop below can no
   * longer fail for the reason it was written for and must not be read as
   * evidence for the ruling. `wheatRelaxedMin` is deleted; the only relaxation
   * left in the game is the Harvest Service's, and a Service never touches a
   * card effect.
   *
   * WHAT IT STILL PROVES, and what is worth keeping it for: W8's own printed
   * "even if not full" reaches a 1-loaded and a 2-of-3 building identically on
   * both faces of W2, while THE PLAIN HARVEST ACTION REACHES NEITHER on either
   * face. That second assertion is the new one, and it is the load-bearing
   * half: it pins the absence of the suit power from the side an accidental
   * reinstatement would show up on first.
   */
  it('W8 harvests at its own printed 1+ gate, and no seat has a gate left to leak', () => {
    const RULING =
      'RULING (2026-08-09, unchanged but now unemployed everywhere): a suit power modifies ' +
      'the ACTION, never card text that happens to use the same word. W8 PRINTS "even if ' +
      'not full", so its gate is 1+ - fixed by its own text - and since v31 there is no ' +
      'Farmstead power and no door rider left to be moved by in the first place.';

    const s = wheatState();
    buildFor(data, s, WHEAT, 'W8', 'W5', 'W7');
    loadStack(data, s, WHEAT, 'W8', 2, 'apiary'); // threshold 2: FULL, so the action is legal
    loadStack(data, s, WHEAT, 'W5', 1, 'apiary'); // 1 of 2
    loadStack(data, s, WHEAT, 'W7', 2, 'apiary'); // 2 of 3

    // ⛔ INVERTED TWICE OVER. The ACTION gate used to differ between W2's two
    // faces - W5 at 1 card was a target upgraded and not base, W7 at 2 was a
    // target on both - and that difference was the whole comparison. It became
    // the strict full gate on both faces on 19/08/2026, and v31 deletes the
    // faces, so there is one answer and no loop: the only target is the full W8.
    const actionTargets = legalMoves(data, s)
      .filter((m) => m.type === 'harvest')
      .map((m) => (m.type === 'harvest' ? m.building : ''));
    expect(actionTargets, 'the action gate is strict for every seat').toEqual(['W8']);

    // W8's own chooser, by contrast, does not move: both partials.
    const applied = apply(data, s, { type: 'harvest', seat: WHEAT, building: 'W8' });
    expect(
      applied.state.tasks.filter((t) => t.t === 'chooseBuilding'),
      RULING,
    ).toMatchObject([{ filter: 'loaded', exclude: 'W8', then: 'harvest' }]);

    // ⛔ THE QUEUE-WALK IS GONE WITH THE FARMSTEAD. W2's barn deposit used to be
    // pushed AHEAD of W8's chooser - the starters sit earlier in the tableau
    // than anything built - so reading `pendingAnswers` straight off the harvest
    // read the Farmstead's prompt and found no buildings at all. The chooser is
    // the head task now.
    expect(applied.state.tasks[0]?.t).toBe('chooseBuilding');
    const offered = pendingAnswers(data, applied.state)
      .flatMap((a) => (a.kind === 'building' ? [a.card] : []))
      .sort();
    expect(offered, RULING).toEqual(['W5', 'W7']);
  });
});
