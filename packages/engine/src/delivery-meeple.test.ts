/**
 * ⭐ THE DELIVERY MEEPLE (M1 to M8, Dean 12/09/2026, ledger A151;
 * `docs/village-store-coins-handoff-2026-09-12-v1.md` section 2, and section 5
 * of `docs/village-store-coins-2026-09-12-v2.md`).
 *
 * ⭐ **ITS PROVENANCE IS A TABLE**, which is rare enough in this project to be
 * the first thing recorded. Dean played it on 11/09/2026 and liked it, reporting
 * that it allowed "some fun, powerful combos". THE RULE: a random meeple sits on
 * every tile's 3 VP delivery space, claiming that receipt claims the meeple, and
 * AFTER your main action you may discard ONE meeple for the PLAIN action of its
 * colour. The meeple then leaves the game.
 *
 * ⛔ **AN ARM ON TOP OF AN ARM, AND EVERY REPORT MUST SAY SO.** C100 is open:
 * no Notice Board configuration is ruled in as the shipped game. The arm here is
 * `deliveryMeepleGame()` - the best-measured host-draw configuration plus three
 * meeple leaves - and `BASE_GAME_DATA` appears only in the cases whose whole
 * point is that the shipped game does not move.
 *
 * ## What this file is guarding, in the order the traps were named
 *
 * ⛔ **1. M6: THE PLAIN ACTION AND NEVER THE NOTICE BOARD POWER.** Under
 * `visitCurrency: 'noticeBoardPower'` a VISIT buys the board's printed power,
 * and the Orchard board is "Draw 4" where the plain action is Draw 2. They
 * stopped being the same thing on 10/09/2026 and no design document says so
 * twice. `doSpendMeeple` routes through `performDoorAction`, the plain path;
 * `fireNoticeBoardPower` is the other one and no meeple may ever reach it. The
 * cases below read `rules.economy.noticeBoardPower` in the assertion itself, so
 * the trap is visible in the test and not only in a comment.
 *
 * ⛔ **2. M7: AN APIARY MEEPLE BUYS GROW AND NEVER SOW.** Sow is not one of the
 * five core actions, and "orange means Grow here and Sow there" has cost this
 * project a day before. The roster prints `sow` on that door, so this is the one
 * mapping the engine has to make (`meepleActionOf`), and the v31 control's
 * apiary meeple must go on buying its Sow.
 *
 * ⛔ **3. M1: SPACE 1 AND NEVER SPACE 0**, plus the dense slot that goes with
 * it. `meeplesPerTile` and `meepleIndexForSpace` DISAGREED about
 * `'noticeBoardPower'` until 12/09/2026 - one said "no meeples", the other
 * answered the identity - which was harmless only while nothing seeded a meeple
 * there. This rule is exactly what seeds one, so both are asserted.
 *
 * ⛔ **4. D8: A MEEPLE CAN BE UNDISCARDABLE.** An action you cannot legally
 * perform is not offered, which has survived every currency this game has had,
 * and it means a stored action can die in a supply. `meepleGained` minus
 * `meepleSpent` is that dead-component count, and it is a reading the instrument
 * owes rather than a bug to fix.
 *
 * ⛔ **5. INERTNESS.** At `deliveryMeepleSpace: null` and `meepleSpendTiming:
 * 'start'` the game must play exactly as it did, which is what the v31 control
 * cases at the bottom are for. Nine fixtures replay byte-identically and this
 * file is the argument for why.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA, meepleIndexForSpace, meeplesPerTile, tileMeepleSpaces } from '@gp/data';

import { hasMainOption, meepleSpendOpen } from './actions.js';
import { apply, drainTasks, legalMoves, newGame, player, taskAnswers } from './index.js';
import type { GameState, Move, Seat } from './state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
  deliveredAt,
  deliveryMeepleDistinctGame,
  deliveryMeepleGame,
  giveMeeples,
  loadStack,
  makeState,
  noticeBoardHostDrawBySeatsGame,
} from './testkit.js';

/** The arm: the by-seats host-draw game plus M1, M4 and M5. */
const arm: GameData = deliveryMeepleGame();
/** Its control: the same twenty leaves, the three meeple ones absent. */
const control: GameData = noticeBoardHostDrawBySeatsGame();
/** C112's alternative to Dean's cap: unlimited, but no two of a colour in a turn. */
const distinct: GameData = deliveryMeepleDistinctGame();
/** The v31 game, whose turn-START meeple spend is the thing that must not move. */
const v31: GameData = cardVisitGame();

const SEAT: Seat = 0;
const OTHER: Seat = 1;

/**
 * A position with the ACTION ALREADY SPENT, which is M4's window. Nothing is
 * played to get there: the window is a property of `turn.actionSpent`, and D7
 * says so in as many words - it is the window that matters and never how it
 * closed.
 */
function afterAction(data: GameData, suits: Suit[] = ['wheat', 'orchard']): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = SEAT;
  s.turn.actionSpent = true;
  return s;
}

/** Move ids from a deck straight into a barn (testkit-style surgery). */
function stockBarn(state: GameState, seat: Seat, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

/** The colours `legalMoves` is offering this seat right now. */
function spendable(data: GameData, state: GameState, seat: Seat = SEAT): Suit[] {
  return legalMoves(data, state)
    .filter((m): m is Extract<Move, { type: 'spendMeeple' }> => m.type === 'spendMeeple')
    .filter((m) => m.seat === seat)
    .map((m) => m.colour);
}

function spend(colour: Suit, seat: Seat = SEAT): Move {
  return { type: 'spendMeeple', seat, colour };
}

/**
 * Drain a position by taking the first answer at every step. A meeple spend
 * always pushes a task, so a case that wants to see the turn AFTER the spend has
 * to answer it first - and whether the turn then ends is itself one of the
 * things asserted below.
 */
function settle(data: GameData, state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 40 && s.tasks.length > 0; guard++) {
    drainTasks(data, s);
    const head = s.tasks[0];
    if (head === undefined) break;
    const first = taskAnswers(data, s, head)[0];
    if (first === undefined) break;
    s = apply(data, s, { type: 'task', seat: head.pid, answer: first }).state;
  }
  return s;
}

describe('M1: a meeple on the 3 VP space of every tile', () => {
  it('seeds exactly one meeple per tile, and the control seeds none', () => {
    const armGame = newGame(arm, { seats: 2, suits: ['wheat', 'orchard'], seed: 'm1' });
    for (const tile of armGame.island.tiles) expect(tile.meeples).toHaveLength(1);
    expect(meeplesPerTile(arm)).toBe(1);
    // ⛔ SPACE 1, NEVER SPACE 0. Being first at a tile is 6 VP flat; the meeple
    // is the thing that makes taking SECOND a real choice, and it restores the
    // only catch-up term this design ever had.
    expect(tileMeepleSpaces(arm)).toEqual([1]);

    const off = newGame(control, { seats: 2, suits: ['wheat', 'orchard'], seed: 'm1' });
    for (const tile of off.island.tiles) expect(tile.meeples).toEqual([]);
    expect(meeplesPerTile(control)).toBe(0);
    expect(tileMeepleSpaces(control)).toEqual([]);
  });

  /**
   * ⛔ THE INCONSISTENCY THE DATA SLICE LEFT OWED, FIXED 12/09/2026.
   * `meepleIndexForSpace` used to answer the IDENTITY for every currency but
   * `'meeple'`, so under `'noticeBoardPower'` it claimed a meeple lived at index
   * 1 of a tile that held none - and under M1 it would have looked past the
   * tile's single meeple, which is stored densely at index 0. Both functions now
   * read `tileMeepleSpaces` and cannot disagree.
   */
  it('maps space 1 to the dense slot 0, and space 0 to nothing at all', () => {
    expect(meepleIndexForSpace(arm, 0)).toBe(-1);
    expect(meepleIndexForSpace(arm, 1)).toBe(0);
    // The control seeds nothing, so no space maps anywhere. It answered 0 and 1
    // before the fix.
    expect(meepleIndexForSpace(control, 0)).toBe(-1);
    expect(meepleIndexForSpace(control, 1)).toBe(-1);
    // The v31 control seeds both spaces, so the identity still holds there -
    // arrived at by derivation now rather than by assumption.
    expect(meepleIndexForSpace(v31, 0)).toBe(0);
    expect(meepleIndexForSpace(v31, 1)).toBe(1);
  });

  /** M3: claiming the 3 VP token claims the meeple, and the 6 VP one claims none. */
  it('pays the meeple to the SECOND deliverer and nothing to the first', () => {
    const first = makeState(arm, ['wheat', 'orchard']);
    stockBarn(first, SEAT, 'wheat', 4);
    const one = apply(arm, first, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(one.state.players[SEAT]?.receipts).toEqual([6]);
    expect(one.events.some((e) => e.e === 'meepleGained')).toBe(false);

    const second = makeState(arm, ['wheat', 'orchard']);
    const meeple = second.island.tiles.find((t) => t.tile === 'A1')?.meeples[0] as Suit;
    deliveredAt(second, OTHER, 'A1');
    stockBarn(second, SEAT, 'wheat', 4);
    const two = apply(arm, second, {
      type: 'deliver',
      seat: SEAT,
      tile: 'A1',
      spend: { wheat: 4 },
    });
    expect(two.state.players[SEAT]?.receipts).toEqual([3]);
    expect(two.state.players[SEAT]?.meeples[meeple]).toBe(1);
    expect(two.events).toContainEqual({
      e: 'meepleGained',
      seat: SEAT,
      colour: meeple,
      tile: 'A1',
      space: 1,
    });
  });
});

describe('M4 and D7: the spend window is after the main action', () => {
  it('offers nothing before the action and the meeple after it', () => {
    const before = makeState(arm, ['wheat', 'orchard']);
    before.turnPlayer = SEAT;
    giveMeeples(before, SEAT, 'orchard');
    expect(spendable(arm, before)).toEqual([]);

    const after = afterAction(arm);
    giveMeeples(after, SEAT, 'orchard');
    expect(spendable(arm, after)).toEqual(['orchard']);
  });

  /**
   * ⭐ D7, RULED BY DEAN ON 12/09/2026: the spend is legal on ANY turn once the
   * action window has closed, whether the main action was taken or PASSED. His
   * reasoning, which is the part worth keeping: gating it on a real action would
   * create a perverse incentive to take a pointless one first, and D8 already
   * makes a meeple undiscardable when its colour's action is illegal, so
   * stranding is a real risk and not one to compound.
   *
   * `pass` is in `MAIN_ACTIONS`, so it closes the window exactly as an action
   * does and the rule needs no second clause.
   *
   * ⚠️ **AND THE PASSED BRANCH IS UNREACHABLE IN PLAY TODAY, WHICH IS A FINDING
   * RATHER THAN A DEFECT.** `pass` is offered only when `hasMainOption` is
   * false, and every action a meeple can buy - Draw, Build, Grow, Harvest,
   * Deliver - is one of the options that predicate asks about. So a turn on
   * which pass is legal is a turn on which D8 refuses every meeple, and the two
   * rulings meet exactly. The window still OPENS, which is what D7 says and what
   * this case pins: the moment either predicate changes (a bot-side discard, a
   * card that makes a meeple's action legal without making the main one legal)
   * the branch is live, and it must not have to be re-ruled then.
   */
  it('opens the window on a PASSED turn, where D8 then offers nothing (D7)', () => {
    const s = makeState(arm, ['wheat', 'orchard']);
    s.turnPlayer = SEAT;
    giveMeeples(s, SEAT, 'orchard');
    // A position with NO main action at all: every deck out, nothing in hand or
    // barn, no loaded building and no aerodrome (Vegetable is not at the table).
    for (const suit of arm.cards.suits) s.decks[suit] = [];
    expect(hasMainOption(arm, s, SEAT)).toBe(false);
    expect(meepleSpendOpen(arm, s)).toBe(false);

    // The passed turn as the state machine leaves it, one instant before
    // `settleTurn` runs. D7: the window is OPEN.
    const passed = { ...s, turn: { ...s.turn, actionSpent: true } };
    expect(meepleSpendOpen(arm, passed)).toBe(true);
    // D8: and the orchard meeple is still undiscardable, because there is no
    // deck left to draw from. The two rulings meet exactly here.
    expect(spendable(arm, passed)).toEqual([]);
    // ⚠️ SO IN PLAY THE PASS SIMPLY SETTLES THE TURN, and the passed branch of
    // D7 is not observable from outside `apply` at all: nothing holds the turn
    // open, so the seat advances in the same call.
    const out = apply(arm, s, { type: 'pass', seat: SEAT });
    expect(out.state.turnPlayer).toBe(OTHER);
  });

  it('refuses a spend before the action, by the funnel and not only the enumerator', () => {
    const s = makeState(arm, ['wheat', 'orchard']);
    s.turnPlayer = SEAT;
    giveMeeples(s, SEAT, 'orchard');
    expect(() => apply(arm, s, spend('orchard'))).toThrow(/after your main action/);
  });

  /** The meeple leaves the game: no pool, no board, nothing to collect it back. */
  it('removes the meeple from the supply for good', () => {
    const s = afterAction(arm);
    giveMeeples(s, SEAT, 'orchard');
    const out = apply(arm, s, spend('orchard'));
    expect(player(out.state, SEAT).meeples['orchard']).toBe(0);
    expect(out.events).toContainEqual({
      e: 'meepleSpent',
      seat: SEAT,
      colour: 'orchard',
      action: 'draw',
    });
  });

  /**
   * ⭐ THE TURNFLOW GATE, WHICH NEEDED NO NEW CODE AND HAS TO BE PROVED ANYWAY.
   * `settleTurn` holds a turn open while `meepleOptions` is non-empty; that line
   * was written for the START-of-turn phase and it is the whole of what holds a
   * turn open for M4's window too. With a meeple still spendable the turn must
   * NOT settle; with none it must.
   */
  it('holds the turn open while a meeple is still spendable, and ends it when none is', () => {
    const held = afterAction(distinct);
    giveMeeples(held, SEAT, 'orchard');
    giveMeeples(held, SEAT, 'wheat');
    buildFor(distinct, held, SEAT, 'W4');
    loadStack(distinct, held, SEAT, 'W4', 2);
    const open = settle(distinct, apply(distinct, held, spend('orchard')).state);
    expect(open.turnPlayer).toBe(SEAT);
    expect(spendable(distinct, open)).toEqual(['wheat']);

    const last = afterAction(distinct);
    giveMeeples(last, SEAT, 'orchard');
    const closed = settle(distinct, apply(distinct, last, spend('orchard')).state);
    expect(closed.turnPlayer).toBe(OTHER);
  });
});

describe('M5 and C112: how many meeples one turn may spend', () => {
  it('allows exactly one per turn (M5)', () => {
    const s = afterAction(arm);
    giveMeeples(s, SEAT, 'orchard', 2);
    expect(spendable(arm, s)).toEqual(['orchard']);
    const out = apply(arm, s, spend('orchard'));
    expect(out.state.turn.meeplesSpent).toEqual(['orchard']);
    expect(spendable(arm, out.state)).toEqual([]);
    // ⚠️ THE PENDING DRAW IS CLEARED SO THE CAP'S OWN REFUSAL IS WHAT ANSWERS.
    // A spend always pushes a task, and `apply` refuses any turn move while one
    // is outstanding, so without this the funnel would never be reached and the
    // assertion would be testing the task check instead of M5.
    const idle = { ...out.state, tasks: [] };
    expect(() => apply(arm, idle, spend('orchard'))).toThrow(/this turn has none left/);
    // The second meeple is still HELD - the cap rations the turn, not the supply.
    expect(player(out.state, SEAT).meeples['orchard']).toBe(1);
    // And the turn settles rather than hanging on a phase the cap has closed.
    expect(settle(arm, out.state).turnPlayer).toBe(OTHER);
  });

  /**
   * ⭐ C112's ALTERNATIVE, AND THE REASON THE RECORD IS A LIST OF COLOURS
   * RATHER THAN A COUNTER. "No two of the same colour" is not expressible as an
   * integer, and Dean's cap of 1 is exactly what deletes the combo burst his own
   * table enjoyed on 11/09/2026, so the two have to be measured against each
   * other rather than argued about.
   */
  it('under the distinct-colours variant, bars the colour and not the turn', () => {
    const s = afterAction(distinct);
    giveMeeples(s, SEAT, 'orchard', 2);
    giveMeeples(s, SEAT, 'wheat');
    buildFor(distinct, s, SEAT, 'W4');
    loadStack(distinct, s, SEAT, 'W4', 2);
    expect(spendable(distinct, s).sort()).toEqual(['orchard', 'wheat']);
    const out = settle(distinct, apply(distinct, s, spend('orchard')).state);
    expect(out.turn.meeplesSpent).toEqual(['orchard']);
    expect(spendable(distinct, out)).toEqual(['wheat']);
  });
});

describe('M6, M7 and M8: the plain action of the colour', () => {
  /**
   * ⛔ THE ONE THAT MATTERS MOST. `rules.economy.noticeBoardPower.orchardDraw`
   * is 4 and the plain Draw is 2, so a meeple routed through
   * `fireNoticeBoardPower` instead of `performDoorAction` would double its own
   * payout and nothing would error.
   */
  it('an orchard meeple draws the PLAIN 2 and not the board power 4 (M6)', () => {
    expect(arm.rules.economy.noticeBoardPower.orchardDraw).toBe(4);
    const s = afterAction(arm);
    giveMeeples(s, SEAT, 'orchard');
    const out = apply(arm, s, spend('orchard'));
    const draw = out.state.tasks.find((t) => t.t === 'draw');
    expect(draw).toBeDefined();
    if (draw?.t === 'draw') {
      expect(draw.see).toBe(2);
      expect(draw.keep).toBe(2);
    }
  });

  /**
   * The Wheat BOARD's power is "Harvest one of your buildings, THEN put 1 card
   * from your hand into your barn", on C88's relaxed `loaded` gate. A meeple
   * buys the plain Harvest: `harvestable`, one task, no second leg.
   */
  it('a wheat meeple buys the plain Harvest with no hand-to-barn leg (M6)', () => {
    expect(arm.rules.economy.noticeBoardPower.wheatBarn).toBe(1);
    const s = afterAction(arm);
    giveMeeples(s, SEAT, 'wheat');
    buildFor(arm, s, SEAT, 'W4');
    loadStack(arm, s, SEAT, 'W4', 2);
    expect(spendable(arm, s)).toContain('wheat');
    const out = apply(arm, s, spend('wheat'));
    expect(out.state.tasks.some((t) => t.t === 'handToBarn')).toBe(false);
    expect(
      out.state.tasks.some((t) => t.t === 'chooseBuilding' && t.filter === 'harvestable'),
    ).toBe(true);
  });

  /**
   * The Vegetable BOARD's power is "Deliver. If you cannot, put 2 cards from
   * your hand into your barn." A meeple buys the Deliver and never the fallback:
   * D8 refuses the meeple outright when a Deliver is illegal, which is this
   * design's own answer to a dead option and not a consolation leg.
   */
  it('a vegetable meeple buys the plain Deliver with no fallback leg (M6)', () => {
    expect(arm.rules.economy.noticeBoardPower.vegetableFallback).toBe(2);
    const s = afterAction(arm, ['vegetable', 'orchard']);
    giveMeeples(s, SEAT, 'vegetable');
    stockBarn(s, SEAT, 'vegetable', 4);
    expect(spendable(arm, s)).toContain('vegetable');
    const out = apply(arm, s, spend('vegetable'));
    expect(out.state.tasks.some((t) => t.t === 'deliver')).toBe(true);
    expect(out.state.tasks.some((t) => t.t === 'handToBarn')).toBe(false);
  });

  /**
   * ⛔ M7's WHOLE COLOUR MAP: wheat Harvest, vegetable Deliver, orchard Draw 2
   * keep both, apiary GROW, dairy Build. The apiary line is the one the roster
   * disagrees with - it prints `sow` - and the EVENT has to carry what actually
   * happened, or an instrument tallying the colour mix reports a Sow that never
   * occurred.
   */
  it('an apiary meeple buys a GROW and never a SOW (M7)', () => {
    const s = afterAction(arm, ['apiary', 'orchard']);
    giveMeeples(s, SEAT, 'apiary');
    buildFor(arm, s, SEAT, 'A5');
    dealTo(arm, s, SEAT, 'A6', 'A7');
    expect(spendable(arm, s)).toContain('apiary');
    const out = apply(arm, s, spend('apiary'));
    expect(out.events).toContainEqual({
      e: 'meepleSpent',
      seat: SEAT,
      colour: 'apiary',
      action: 'grow',
    });
    expect(out.state.tasks.some((t) => t.t === 'grow')).toBe(true);
    expect(out.state.tasks.some((t) => t.t === 'sow')).toBe(false);
  });

  it('a dairy meeple buys the plain Build (M7)', () => {
    const s = afterAction(arm, ['dairy', 'orchard']);
    giveMeeples(s, SEAT, 'dairy');
    dealTo(arm, s, SEAT, 'D4', 'D5', 'D6', 'D7');
    expect(spendable(arm, s)).toContain('dairy');
    const out = apply(arm, s, spend('dairy'));
    expect(out.events).toContainEqual({
      e: 'meepleSpent',
      seat: SEAT,
      colour: 'dairy',
      action: 'build',
    });
    // ⛔ NO `substitute` MOD: that is the Dairy BOARD's wild waiver, not the
    // plain Build's, and the two must not be confused (M6).
    const build = out.state.tasks.find((t) => t.t === 'build');
    expect(build?.t === 'build' ? build.mods : undefined).toBeUndefined();
  });

  /**
   * ⭐ M8: A MEEPLE GROW PLACES ITS ACTIVATION CARD AS NORMAL AND CAN CLOG,
   * which differs ON PURPOSE from V8's coin-Grow, where the coin places nothing
   * and the building never advances toward its threshold. Nothing in this slice
   * builds the coin; the assertion is here so the difference is on the record
   * from the meeple side before the other half is written.
   */
  it('a meeple Grow places its activation card, so it can clog (M8)', () => {
    const s = afterAction(arm, ['apiary', 'orchard']);
    giveMeeples(s, SEAT, 'apiary');
    buildFor(arm, s, SEAT, 'A5');
    dealTo(arm, s, SEAT, 'A6', 'A7');
    const bought = apply(arm, s, spend('apiary')).state;
    const before = player(bought, SEAT).tableau.find((b) => b.card === 'A5')?.stack.length ?? -1;
    expect(before).toBe(0);
    const grown = settle(arm, bought);
    const after = grown.players[SEAT]?.tableau.find((b) => b.card === 'A5')?.stack.length ?? -1;
    expect(after).toBe(1);
  });

  it('does not offer an apiary meeple when every building is already full (M8)', () => {
    const s = afterAction(arm, ['apiary', 'orchard']);
    giveMeeples(s, SEAT, 'apiary');
    buildFor(arm, s, SEAT, 'A5');
    dealTo(arm, s, SEAT, 'A6', 'A7');
    // A5's threshold is 2; a full building is not a legal target for a Grow that
    // places a card, and the meeple has no clog bypass.
    loadStack(arm, s, SEAT, 'A5', 2);
    expect(spendable(arm, s)).not.toContain('apiary');
  });
});

describe('D8: a meeple can be undiscardable', () => {
  /**
   * ⛔ RULED (D8, indicated by the handoff and taken 12/09/2026): a meeple's
   * plain action is subject to the standing rule that an action you cannot
   * legally perform right now is not offered. So a stored action CAN die in a
   * supply, and `meepleGained` minus `meepleSpent` is exactly that
   * dead-component count - a reading the instrument owes rather than a bug.
   */
  it('does not offer a vegetable meeple with an empty barn, and refuses the move', () => {
    const s = afterAction(arm, ['wheat', 'orchard']);
    giveMeeples(s, SEAT, 'vegetable');
    expect(player(s, SEAT).barn).toHaveLength(0);
    expect(spendable(arm, s)).not.toContain('vegetable');
    expect(() => apply(arm, s, spend('vegetable'))).toThrow(/no vegetable meeple that can do/);
  });
});

describe('inertness: nothing moves at the shipped values', () => {
  /**
   * ⛔ THE GATE THIS SLICE EXISTS TO PASS. `deliveryMeepleSpace` null,
   * `meepleSpendTiming` 'start' and `meepleSpendPerTurn` null ARE the current
   * behaviour and not an off switch: the v31 control spends meeples at the START
   * of its turn, unlimited, and four fixtures replay it.
   */
  it('leaves the v31 control spending at the start of the turn, unlimited', () => {
    const s = makeState(v31, ['apiary', 'orchard']);
    s.turnPlayer = SEAT;
    giveMeeples(s, SEAT, 'apiary');
    giveMeeples(s, SEAT, 'orchard');
    buildFor(v31, s, SEAT, 'A5');
    dealTo(v31, s, SEAT, 'A6', 'A7');
    expect(spendable(v31, s).sort()).toEqual(['apiary', 'orchard']);
    const out = apply(v31, s, spend('apiary'));
    // ⛔ ABSENT AND NOT EMPTY. A key present-and-empty would move every
    // serialised state and every view for a rule nothing is running.
    expect('meeplesSpent' in out.state.turn).toBe(false);
    // Unlimited: the second colour is still on offer once the first has resolved.
    expect(spendable(v31, settle(v31, out.state))).toEqual(['orchard']);
  });

  /** And the v31 apiary meeple still buys the SOW its roster prints: M7 rides with M4's timing. */
  it('leaves the v31 apiary meeple buying a Sow', () => {
    const s = makeState(v31, ['apiary', 'orchard']);
    s.turnPlayer = SEAT;
    giveMeeples(s, SEAT, 'apiary');
    buildFor(v31, s, SEAT, 'A5');
    dealTo(v31, s, SEAT, 'A6', 'A7');
    const out = apply(v31, s, spend('apiary'));
    expect(out.events).toContainEqual({
      e: 'meepleSpent',
      seat: SEAT,
      colour: 'apiary',
      action: 'sow',
    });
  });

  /** And the v31 window still SHUTS once the action is spent. */
  it('leaves the v31 window shut after the action', () => {
    const s = makeState(v31, ['wheat', 'orchard']);
    s.turnPlayer = SEAT;
    s.turn.actionSpent = true;
    giveMeeples(s, SEAT, 'orchard');
    expect(spendable(v31, s)).toEqual([]);
  });

  /** The shipped notice-board visit has no meeples at all. */
  it('seeds no meeple in the shipped game', () => {
    expect(meeplesPerTile(BASE_GAME_DATA)).toBe(0);
    expect(tileMeepleSpaces(BASE_GAME_DATA)).toEqual([]);
    expect(meepleIndexForSpace(BASE_GAME_DATA, 1)).toBe(-1);
  });
});
