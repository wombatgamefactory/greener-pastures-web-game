/**
 * THE NOTICE-BOARD VISIT (Dean, 10/09/2026,
 * `docs/notice-board-visit-handoff-2026-09-10-v2.md`, rules S1-S16, plus the
 * rulings C88 and C89 he made the same evening).
 *
 * ⛔ AN ARM AND NOT THE GAME. The shipped game is still the commons; this is
 * `rules.turn.visitCurrency: 'noticeBoardPower'`, built to be measured against
 * it on identical `reference-v15` seeds. Nothing here may move a number in the
 * shipped game or in any of the four controls, which is why every test below
 * takes its data from `noticeBoardVisitGame()` and never from `BASE_GAME_DATA`.
 *
 * THE DESIGN IN ONE SENTENCE: the centre is deleted, the five Notice Board
 * cards go home to their owners' farms as BUILDINGS again, and the bonus - the
 * first thing in the turn - is to play one card from your hand onto ANY
 * player's Notice Board, your own included, and immediately take that board's
 * printed power; the card rests on the host's board until the host harvests it
 * into their barn, and that is the host's whole payment.
 *
 * ⛔ THE FILE'S CENTRE OF GRAVITY IS THE THREE-SEAT TEST. The power fires for
 * the VISITOR and the card lands on the HOST, and getting those two seats the
 * wrong way round is the one bug this design can have - a self-visit hides it,
 * because both seats are the same.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';

import {
  anyVisitOption,
  canSowOnto,
  canTakeCard,
  harvestOptions,
  isFull,
  isHarvestable,
  legalMoves,
  apply,
  newGame,
  noticeBoardOf,
  noticeBoardPowerLegal,
  player,
  thresholdOf,
  gameEndScores,
  drainTasks,
  taskAnswers,
} from './index.js';
import type { CardId, GameState, Move, Seat } from './state.js';
import {
  buildFor,
  dealTo,
  loadStack,
  makeState,
  noticeBoardVisitGame,
  withBonusSlots,
} from './testkit.js';
import { loadGameData } from '@gp/data';

const arm: GameData = noticeBoardVisitGame();
/**
 * The arm with TWO bonus plays a turn, by rule. The old A Helping Hand was the
 * only card that granted a second play and it was retired on 16/09/2026, so the
 * cases whose subject is a two-play turn widen the slot through the knob.
 */
const wide: GameData = withBonusSlots(arm);

/** The arm with the `3+` rule taken away: an ordinary clogging board (S8's control). */
const blocking: GameData = loadGameData({
  name: 'notice-board-visit-blocking-v1',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.economy.noticeBoardsBySeats.2': 1, // pinned 13/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': true,
    'rules.turn.startingMeeplesPerColour': 0,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': null,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': true,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
    'island.tokens.workerOnVp': [],
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

/** The arm with self-use banned: the headline control of the whole pass (S6). */
const noSelf: GameData = loadGameData({
  name: 'notice-board-visit-no-self-v1',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.economy.noticeBoardsBySeats.2': 1, // pinned 13/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': false,
    'rules.turn.startingMeeplesPerColour': 0,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': null,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
    'island.tokens.workerOnVp': [],
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

const BOARD: Record<Suit, CardId> = {
  wheat: 'W3',
  vegetable: 'V3',
  orchard: 'O3',
  apiary: 'A3',
  dairy: 'D3',
};

/** A position with the bonus window OPEN: `bonusTiming` is 'start', so before the action. */
function position(data: GameData, suits: Suit[]): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  return s;
}

function visit(seat: Seat, host: Seat, fee: CardId): Move {
  return { type: 'visit', seat, host, fee };
}

function boardOf(data: GameData, state: GameState, seat: Seat): { card: CardId; stack: CardId[] } {
  return noticeBoardOf(data, state, seat);
}

/** Drain a settled position's task queue by taking the first answer at every step. */
function autoResolve(data: GameData, state: GameState): GameState {
  for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
    drainTasks(data, state);
    const head = state.tasks[0];
    if (head === undefined) break;
    const answers = taskAnswers(data, state, head);
    const first = answers[0];
    if (first === undefined) break;
    const out = apply(data, state, { type: 'task', seat: head.pid, answer: first });
    state = out.state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// S1, S2: the three starters come home and nothing stands in the centre
// ---------------------------------------------------------------------------

describe('S1/S2: three starters, and no centre at all', () => {
  it('lays out Farmstead, Barn and Notice Board for every seat', () => {
    const s = newGame(arm, { seats: 3, suits: ['wheat', 'orchard', 'dairy'], seed: 'nb' });
    for (let seat = 0; seat < 3; seat++) {
      const slots = player(s, seat).tableau.map(
        (b) => arm.cards.catalogue.find((c) => c.id === b.card)?.slot,
      );
      expect(slots.sort()).toEqual(['barn', 'farmstead', 'noticeboard']);
    }
  });

  it('closes the standalone free Draw 1: the slot holds ONE option (S5)', () => {
    const s = position(arm, ['wheat', 'orchard']);
    dealTo(arm, s, 0, 'W7');
    expect(legalMoves(arm, s).some((m) => m.type === 'bonusDraw')).toBe(false);
    expect(legalMoves(arm, s).some((m) => m.type === 'visit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S8: the isFull / canTakeCard split
// ---------------------------------------------------------------------------

describe('S8: `3+` is a MINIMUM, so harvestable and accepts-a-card are two questions', () => {
  it('a board over its threshold is harvestable AND still takes cards', () => {
    const s = position(arm, ['wheat', 'orchard']);
    const board = boardOf(arm, s, 0);
    loadStack(arm, s, 0, board.card, 5, 'orchard');
    expect(thresholdOf(arm, board)).toBe(3);
    expect(isHarvestable(arm, board)).toBe(true);
    expect(isFull(arm, board)).toBe(false);
    expect(canTakeCard(arm, board)).toBe(true);
  });

  it('under the threshold it is neither harvestable nor full', () => {
    const s = position(arm, ['wheat', 'orchard']);
    const board = boardOf(arm, s, 0);
    loadStack(arm, s, 0, board.card, 2, 'orchard');
    expect(isHarvestable(arm, board)).toBe(false);
    expect(isFull(arm, board)).toBe(false);
    expect(canTakeCard(arm, board)).toBe(true);
  });

  it('noticeBoardBlocks true is the paired control: the board clogs like any building', () => {
    const s = position(blocking, ['wheat', 'orchard']);
    const board = boardOf(blocking, s, 0);
    loadStack(blocking, s, 0, board.card, 3, 'orchard');
    expect(isHarvestable(blocking, board)).toBe(true);
    expect(isFull(blocking, board)).toBe(true);
    expect(canTakeCard(blocking, board)).toBe(false);
  });

  it('an ordinary building is untouched: the two answers still agree', () => {
    const s = position(arm, ['wheat', 'orchard']);
    buildFor(arm, s, 0, 'W4');
    const b = player(s, 0).tableau.find((x) => x.card === 'W4');
    if (!b) throw new Error('W4 not built');
    loadStack(arm, s, 0, 'W4', 2);
    expect(isHarvestable(arm, b)).toBe(true);
    expect(isFull(arm, b)).toBe(true);
    expect(canTakeCard(arm, b)).toBe(false);
  });

  it('S11: a Notice Board is never a SOW target, however much room it has', () => {
    const s = position(arm, ['wheat', 'orchard']);
    const board = boardOf(arm, s, 0);
    expect(canTakeCard(arm, board)).toBe(true);
    expect(canSowOnto(arm, board)).toBe(false);
    // ... and an ordinary building of the same seat still is one.
    buildFor(arm, s, 0, 'W4');
    const b = player(s, 0).tableau.find((x) => x.card === 'W4');
    if (!b) throw new Error('W4 not built');
    expect(canSowOnto(arm, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S6, S9, S10: the enumerator
// ---------------------------------------------------------------------------

describe('S5-S10: what the enumerator offers', () => {
  it('offers every board including your own, one move per card in hand (S6)', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    // Four cards, because two of the five powers read what is LEFT after the
    // fee: the Dairy board needs a payable build and the Wheat board needs
    // either a loaded building or a card still in hand.
    buildFor(arm, s, 0, 'D9');
    dealTo(arm, s, 0, 'W7', 'W9', 'W10', 'W12');
    const visits = legalMoves(arm, s).filter((m) => m.type === 'visit');
    expect(new Set(visits.map((m) => (m.type === 'visit' ? m.host : -1)))).toEqual(
      new Set([0, 1, 2]),
    );
    expect(visits.filter((m) => m.type === 'visit' && m.host === 1)).toHaveLength(4);
  });

  it('selfVisitAllowed false is the control: your own board falls out (S6)', () => {
    const s = position(noSelf, ['wheat', 'orchard', 'dairy']);
    dealTo(noSelf, s, 0, 'W7');
    const visits = legalMoves(noSelf, s).filter((m) => m.type === 'visit');
    expect(visits.some((m) => m.type === 'visit' && m.host === 0)).toBe(false);
    expect(visits.some((m) => m.type === 'visit' && m.host === 1)).toBe(true);
    expect(() => apply(noSelf, s, visit(0, 0, 'W7'))).toThrow(/Self-visiting/);
  });

  it('S9: a board may be used ONCE per turn, so the second bonus goes elsewhere', () => {
    // Two plays by rule: nothing in the v42 card set widens the slot.
    const s = position(wide, ['wheat', 'orchard', 'dairy']);
    dealTo(wide, s, 0, 'W7', 'W9');
    const first = apply(wide, s, visit(0, 1, 'W7'));
    expect(first.state.turn.firedThisTurn).toContain(BOARD.orchard);
    // The Orchard power leaves a draw task pending, so the queue has to drain
    // before `legalMoves` offers anything but task answers.
    const after = autoResolve(wide, first.state);
    const second = legalMoves(wide, after).filter((m) => m.type === 'visit');
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((m) => m.type === 'visit' && m.host === 1)).toBe(false);
    expect(() => apply(wide, after, visit(0, 1, 'W9'))).toThrow(/already been used/);
  });

  it('S8: a deep board is still offered, because nothing ever blocks', () => {
    const s = position(arm, ['wheat', 'orchard']);
    loadStack(arm, s, 1, BOARD.orchard, 6, 'orchard');
    dealTo(arm, s, 0, 'W7');
    expect(legalMoves(arm, s).some((m) => m.type === 'visit' && m.host === 1)).toBe(true);
  });

  it('and under the blocking control the same board refuses the visit', () => {
    const s = position(blocking, ['wheat', 'orchard']);
    loadStack(blocking, s, 1, BOARD.orchard, 3, 'orchard');
    dealTo(blocking, s, 0, 'W7');
    expect(legalMoves(blocking, s).some((m) => m.type === 'visit' && m.host === 1)).toBe(false);
    expect(() => apply(blocking, s, visit(0, 1, 'W7'))).toThrow(/is full/);
  });

  it('S10: a board whose power is illegal right now is not offered', () => {
    // The Apiary board sows onto YOUR OWN buildings, and a seat with only its
    // three starters has nowhere to sow: the Notice Board is excluded by S11,
    // the Farmstead and the Barn have no threshold at all.
    const s = position(arm, ['wheat', 'apiary']);
    dealTo(arm, s, 0, 'W7', 'W9');
    expect(noticeBoardPowerLegal(arm, s, 0, 'apiary', { excludingHandCard: 'W7' })).toBe(false);
    expect(legalMoves(arm, s).some((m) => m.type === 'visit' && m.host === 1)).toBe(false);
    // Build something with room and it becomes legal, with no other change.
    buildFor(arm, s, 0, 'W4');
    expect(noticeBoardPowerLegal(arm, s, 0, 'apiary', { excludingHandCard: 'W7' })).toBe(true);
    expect(legalMoves(arm, s).some((m) => m.type === 'visit' && m.host === 1)).toBe(true);
  });

  it('no hand, no visit', () => {
    const s = position(arm, ['wheat', 'orchard']);
    expect(anyVisitOption(arm, s, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE THREE-SEAT TEST: the power fires for the VISITOR, the card lands on
// the HOST. This is the one bug this design can have.
// ---------------------------------------------------------------------------

describe('S5/S7: the visitor takes the power, the host takes the card', () => {
  it('at THREE seats, with all four halves asserted separately', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    const VISITOR: Seat = 0;
    const HOST: Seat = 1;
    const BYSTANDER: Seat = 2;
    dealTo(arm, s, VISITOR, 'W7');
    dealTo(arm, s, HOST, 'O7', 'O9');
    dealTo(arm, s, BYSTANDER, 'D7');

    const hostHandBefore = [...player(s, HOST).hand];
    const bystanderHandBefore = [...player(s, BYSTANDER).hand];
    const out = apply(arm, s, visit(VISITOR, HOST, 'W7'));
    const after = out.state;

    // 1. THE HOST'S BOARD GAINED THE CARD.
    expect(boardOf(arm, after, HOST).stack).toEqual(['W7']);
    // 2. THE HOST'S HAND DID NOT MOVE - they paid nothing for being visited.
    expect(player(after, HOST).hand).toEqual(hostHandBefore);
    // 3. THE VISITOR'S HAND LOST THE CARD, and gained nothing else yet.
    expect(player(after, VISITOR).hand).not.toContain('W7');
    // 4. THE VISITOR RECEIVED THE POWER. The host farms Orchard, so the power
    //    is Draw 4, and the draw task belongs to the VISITOR's seat.
    const draw = after.tasks.find((t) => t.t === 'draw');
    expect(draw?.t === 'draw' ? draw.pid : null).toBe(VISITOR);
    expect(draw?.t === 'draw' ? draw.see : null).toBe(
      arm.rules.economy.noticeBoardPower.orchardDraw,
    );

    // Nothing reached the third seat at all.
    expect(boardOf(arm, after, BYSTANDER).stack).toEqual([]);
    expect(player(after, BYSTANDER).hand).toEqual(bystanderHandBefore);
    expect(player(after, VISITOR).tableau.every((b) => b.stack.length === 0)).toBe(true);

    // And the events name the two seats the same way round.
    expect(out.events).toContainEqual({
      e: 'visited',
      seat: VISITOR,
      host: HOST,
      self: false,
      colour: 'orchard',
      action: 'draw',
    });
    expect(out.events).toContainEqual({
      e: 'doorUsed',
      seat: VISITOR,
      colour: 'orchard',
      action: 'draw',
      via: 'visit',
    });
  });

  it('a self-visit puts the card on your own board and pays you the power', () => {
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    dealTo(arm, s, 0, 'O7');
    const out = apply(arm, s, visit(0, 0, 'O7'));
    expect(boardOf(arm, out.state, 0).stack).toEqual(['O7']);
    const draw = out.state.tasks.find((t) => t.t === 'draw');
    expect(draw?.t === 'draw' ? draw.pid : null).toBe(0);
    expect(out.events.some((e) => e.e === 'visited' && e.self)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S12 / C88 / C89: the five powers, through the visit route
// ---------------------------------------------------------------------------

describe('S12: the five powers, bought with a card', () => {
  it('Orchard: Draw 4 for the visitor', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    dealTo(arm, s, 0, 'W7');
    const after = autoResolve(arm, apply(arm, s, visit(0, 1, 'W7')).state);
    expect(player(after, 0).hand).toHaveLength(arm.rules.economy.noticeBoardPower.orchardDraw);
  });

  it('Dairy: a Build with the crops waived and NO discount (S13 gave D4 back its identity)', () => {
    const s = position(arm, ['wheat', 'dairy', 'orchard']);
    // Four payers plus the card to build: one of them leaves as the fee, and
    // D9 still needs THREE cards behind it, which is the waiver-not-discount
    // distinction under test.
    dealTo(arm, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');
    const out = apply(arm, s, visit(0, 1, 'W7'));
    const build = out.state.tasks.find((t) => t.t === 'build');
    expect(build?.t === 'build' ? build.mods?.substitute : undefined).toBe(true);
    expect(build?.t === 'build' ? build.mods?.discount : undefined).toBeUndefined();
    expect(build?.t === 'build' ? build.pid : null).toBe(0);
    // D9 costs 3 of which 2 must be Dairy. Waived, three Wheat cards pay it.
    const answers = legalMoves(arm, out.state).filter(
      (m) => m.type === 'task' && m.answer.kind === 'build' && m.answer.card === 'D9',
    );
    expect(answers.length).toBeGreaterThan(0);
    for (const m of answers) {
      if (m.type !== 'task' || m.answer.kind !== 'build') continue;
      expect(m.answer.payment).toHaveLength(3);
    }
  });

  it('Wheat: harvests ONE building at any stack size, then banks a card (C88)', () => {
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    buildFor(arm, s, 0, 'O4', 'O5');
    dealTo(arm, s, 0, 'O7', 'O9');
    // Loaded AFTER the hand is dealt, so the stack fillers come off the deck
    // top and cannot collide with the two named cards.
    loadStack(arm, s, 0, 'O4', 1);
    loadStack(arm, s, 0, 'O5', 1);
    const after = autoResolve(arm, apply(arm, s, visit(0, 1, 'O7')).state);
    // Exactly ONE of the two came off - not W13 The Bakery's cascade.
    const emptied = ['O4', 'O5'].filter(
      (id) => player(after, 0).tableau.find((b) => b.card === id)?.stack.length === 0,
    );
    expect(emptied).toHaveLength(1);
    // And a card left the hand for the barn.
    expect(player(after, 0).barn).toContain('O9');
  });

  it('Apiary: SOWS apiarySows cards from hand, never a GROW, never onto the board (C89)', () => {
    const s = position(arm, ['wheat', 'apiary', 'orchard']);
    buildFor(arm, s, 0, 'W4', 'W6');
    dealTo(arm, s, 0, 'W7', 'W9', 'W10');
    const out = apply(arm, s, visit(0, 1, 'W7'));
    const sow = out.state.tasks.find((t) => t.t === 'sow');
    expect(sow?.t === 'sow' ? sow.remaining : null).toBe(
      arm.rules.economy.noticeBoardPower.apiarySows,
    );
    expect(out.state.tasks.filter((t) => t.t === 'grow')).toHaveLength(0);
    // Every target is one of the visitor's own ORDINARY buildings: never the
    // host's, and never a Notice Board (S11).
    const answers = taskAnswers(arm, out.state, out.state.tasks[0] ?? sow!);
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      if (a.kind !== 'sow') throw new Error('expected sow answers');
      expect(['W4', 'W6']).toContain(a.onto);
      expect(a.ontoSeat ?? 0).toBe(0);
    }
  });

  it('Vegetable: delivers if it can, and banks vegetableFallback cards when it cannot', () => {
    const s = position(arm, ['wheat', 'vegetable', 'orchard']);
    dealTo(arm, s, 0, 'W7', 'W9', 'W10');
    // An empty barn: the fallback fires.
    const out = apply(arm, s, visit(0, 1, 'W7'));
    const bank = out.state.tasks.find((t) => t.t === 'handToBarn');
    expect(bank?.t === 'handToBarn' ? bank.remaining : null).toBe(
      arm.rules.economy.noticeBoardPower.vegetableFallback,
    );
    expect(bank?.t === 'handToBarn' ? bank.pid : null).toBe(0);
    expect(out.state.tasks.filter((t) => t.t === 'deliver')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S7: the host's payment
// ---------------------------------------------------------------------------

describe('S7: the host harvests the fee into their own barn, and that is the payment', () => {
  it('a board at its threshold is a Harvest target for its OWNER and nobody else', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    loadStack(arm, s, 1, BOARD.orchard, 3, 'wheat');
    expect(harvestOptions(arm, s, 1)).toContain(BOARD.orchard);
    expect(harvestOptions(arm, s, 0)).not.toContain(BOARD.orchard);
  });

  it('below the threshold it is nobody s target', () => {
    const s = position(arm, ['wheat', 'orchard']);
    loadStack(arm, s, 1, BOARD.orchard, 2, 'wheat');
    expect(harvestOptions(arm, s, 1)).not.toContain(BOARD.orchard);
  });

  it('the WHOLE stack goes to the owner s barn, as a tableau harvest', () => {
    const s = position(arm, ['orchard', 'wheat']);
    s.turnPlayer = 0;
    s.turn.actionSpent = false;
    loadStack(arm, s, 0, BOARD.orchard, 4, 'wheat');
    const stack = [...boardOf(arm, s, 0).stack];
    const out = apply(arm, s, { type: 'harvest', seat: 0, building: BOARD.orchard });
    expect(boardOf(arm, out.state, 0).stack).toEqual([]);
    expect(player(out.state, 0).barn).toEqual(expect.arrayContaining(stack));
    const harvested = out.events.find((e) => e.e === 'harvested');
    expect(harvested?.e === 'harvested' ? harvested.source : null).toBe('tableau');
    expect(harvested?.e === 'harvested' ? harvested.owner : null).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S3/S4: the Farmstead is inert, and the crop scorer moved to the Barn
// ---------------------------------------------------------------------------

describe('S1/S4: the Farmstead is inert and the Barn scores', () => {
  it('has no threshold, takes no card and is never a harvest or sow target', () => {
    const s = position(arm, ['wheat', 'orchard']);
    const farmstead = player(s, 0).tableau.find((b) => b.card === 'W2');
    if (!farmstead) throw new Error('W2 not laid out');
    expect(thresholdOf(arm, farmstead)).toBeNull();
    expect(canTakeCard(arm, farmstead)).toBe(false);
    expect(canSowOnto(arm, farmstead)).toBe(false);
    expect(isHarvestable(arm, farmstead)).toBe(false);
    expect(harvestOptions(arm, s, 0)).not.toContain('W2');
  });

  it('scores nothing, and the Barn scores the crop line instead (S1)', () => {
    const s = position(arm, ['wheat', 'orchard']);
    buildFor(arm, s, 0, 'W4', 'W6', 'O4');
    const scores = gameEndScores(arm, s);
    const byCard = new Map(scores[0]?.endgameCards.map((e) => [e.card, e.vp]));
    // Two Wheat deck cards built; the Orchard one does not count, and the three
    // starters never did.
    expect(byCard.get('W1')).toBe(2);
    expect(byCard.get('W2')).toBe(0);
  });

  /*
   * ⭐ INVERTED 13/09/2026: DEAN RULED THE SWAP INTO THE SHIPPED COMMONS (the v39
   * sheet, `rules.economy.cropScorerOnBarn`). The Barn now prints "Game end: 1 VP
   * for each <CROP> card you have built" and the Farmstead is the receipt tray,
   * in the shipped game as well as under the notice-board arm.
   */
  it('and under the shipped game the Barn scores the crop line too', () => {
    const shipped = loadGameData({ name: 'shipped', schemaVersion: 1, set: {} });
    const s = makeState(shipped, ['wheat', 'orchard']);
    buildFor(shipped, s, 0, 'W4', 'W6');
    const byCard = new Map(gameEndScores(shipped, s)[0]?.endgameCards.map((e) => [e.card, e.vp]));
    expect(byCard.get('W1')).toBe(2);
    expect(byCard.get('W2')).toBe(0);
  });

  /*
   * ⭐ AND THE SWAP IS SCORE-NEUTRAL, WHICH IS THE CLAIM THAT LET IT SHIP WITHOUT
   * A MEASUREMENT: the same position scored with the scorer on the Farmstead
   * (`cropScorerOnBarn` false, the rule until 13/09/2026) and on the Barn gives
   * the seat the SAME end-game total. Only the card that prints the line moved.
   */
  it('moves the line from the Farmstead to the Barn without moving the total', () => {
    // Asserted under the v31 card game since 13/09/2026: the shipped
    // notice-board visit silences the Farmstead whatever this knob says, and
    // the commons this was first written against is deleted.
    const card = {
      'rules.turn.visitCurrency': 'card',
      'rules.turn.selfVisitAllowed': true,
      'rules.economy.noticeBoardsBySeats.2': 1,
    } as const;
    const onBarn = loadGameData({ name: 'card-scorer-on-barn', schemaVersion: 1, set: card });
    const onFarmstead = loadGameData({
      name: 'scorer-on-farmstead',
      schemaVersion: 1,
      set: { ...card, 'rules.economy.cropScorerOnBarn': false },
    });
    const total = (data: typeof onBarn) => {
      const s = makeState(data, ['wheat', 'orchard']);
      buildFor(data, s, 0, 'W4', 'W6', 'O4');
      return gameEndScores(data, s)[0]?.endgame;
    };
    expect(total(onBarn)).toBe(total(onFarmstead));
    const s = makeState(onFarmstead, ['wheat', 'orchard']);
    buildFor(onFarmstead, s, 0, 'W4', 'W6');
    const byCard = new Map(
      gameEndScores(onFarmstead, s)[0]?.endgameCards.map((e) => [e.card, e.vp]),
    );
    expect(byCard.get('W2')).toBe(2);
    expect(byCard.get('W1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S16: the two cards the rejig revived
// ---------------------------------------------------------------------------

describe('S16: A21 counts the Notice Board, A16 fires on a visit placement', () => {
  it('A21 The Wax Hall counts a Notice Board holding a card', () => {
    const s = position(arm, ['apiary', 'wheat']);
    buildFor(arm, s, 0, 'A21');
    const bare = gameEndScores(arm, s)[0]?.endgameCards.find((e) => e.card === 'A21')?.vp;
    loadStack(arm, s, 0, BOARD.apiary, 1, 'wheat');
    const loaded = gameEndScores(arm, s)[0]?.endgameCards.find((e) => e.card === 'A21')?.vp;
    expect(loaded).toBe((bare ?? 0) + 1);
  });

  it('A16 The Beekeeper s Veil fires on the VISITOR s side of a visit placement', () => {
    const s = position(arm, ['apiary', 'wheat', 'dairy']);
    buildFor(arm, s, 0, 'A16');
    // The host's board already holds one card, so the visitor's fee brings it
    // to two - which is the card's printed trigger. ⭐ THIS IS S16's SECOND
    // RULING: the fee lands through `fx.placeOnBuilding`, which fires
    // `afterPlacement`, where the commons' `playOnCommons` deliberately did
    // not - so the card is alive again purely because the board is a building.
    loadStack(arm, s, 1, BOARD.wheat, 1, 'orchard');
    dealTo(arm, s, 0, 'A7', 'A9');
    const out = apply(arm, s, visit(0, 1, 'A7'));
    const drawn = out.state.tasks.filter((t) => t.t === 'draw' && t.src === 'A16');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.t === 'draw' ? drawn[0].pid : null).toBe(0);
  });

  it('and it does NOT fire when a rival brings the visitor s own board to two', () => {
    const s = position(arm, ['apiary', 'wheat', 'dairy']);
    // A16 belongs to the HOST this time: "whenever YOU place" is placer-scoped,
    // so a fee landing on their own board pays them nothing.
    buildFor(arm, s, 1, 'A16');
    loadStack(arm, s, 1, BOARD.wheat, 1, 'orchard');
    dealTo(arm, s, 0, 'A7', 'A9');
    const out = apply(arm, s, visit(0, 1, 'A7'));
    expect(out.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The fire-once guards (the audit's engine note 1, standing rule 11/08/2026)
// ---------------------------------------------------------------------------

describe('no card s text fires twice in a turn, now that a turn holds two visits', () => {
  /** A position where seat 0 may play twice (by rule) and can visit two boards. */
  function twoVisits(reactor: CardId, suits: Suit[]): GameState {
    const s = position(wide, suits);
    buildFor(wide, s, 0, reactor);
    dealTo(wide, s, 0, 'W7', 'W9');
    return s;
  }

  // ⭐ INVERTED (Dean, 15/09/2026): the fire-once rule is deleted. Card text
  // fires every time its trigger happens, so a visit reactor fires on BOTH
  // visits; the only per-turn cap left is one activation per building.
  //
  // ⛔ A17 THE SMOKE POT LEFT THIS DESCRIBE BLOCK ON v49 (24/09/2026,
  // `tasks/v49-rulings-v1.md` R4). It no longer reacts to a visit at all -
  // "At the end of your turn, you may move 1 card from any 1 of your full
  // buildings to your Barn" keys on `beforeTurnEnd`, the fixed once-a-turn
  // seam O17/V17/O18 already use, so there is no second visit for it to fire
  // on and this describe block's subject (two visits in one turn) no longer
  // applies to it. Its own tests live in `apiary.test.ts`.

  it('O16 The Fruit Store draws on both visits', () => {
    const s = twoVisits('O16', ['wheat', 'orchard', 'dairy']);
    const first = autoResolve(wide, apply(wide, s, visit(0, 1, 'W7')).state);
    expect(first.turn.firedThisTurn).not.toContain('O16');
    const second = apply(wide, first, visit(0, 2, 'W9'));
    // v42: an ordinary Draw 1 task with the player's choice of deck.
    expect(second.state.tasks.some((t) => t.t === 'draw' && t.src === 'O16')).toBe(true);
  });

  it('A16 The Beekeeper s Veil is deliberately NOT capped, and fires on both', () => {
    // Two hosts whose powers are never dead for this seat: Wheat (a card into
    // the barn) and Orchard (Draw 4).
    const s = position(wide, ['apiary', 'wheat', 'orchard']);
    buildFor(wide, s, 0, 'A16');
    loadStack(wide, s, 1, BOARD.wheat, 1, 'dairy');
    loadStack(wide, s, 2, BOARD.orchard, 1, 'dairy');
    dealTo(wide, s, 0, 'A7', 'A9', 'A11');
    const first = apply(wide, s, visit(0, 1, 'A7'));
    expect(first.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(true);
    // The first bonus's tasks are cleared rather than played out, so the second
    // visit reaches the same hand the first one left; what is under test is the
    // per-turn latch, not the queue.
    const mid = first.state;
    mid.tasks = [];
    expect(mid.turn.firedThisTurn).not.toContain('A16');
    const second = apply(wide, mid, visit(0, 2, 'A9'));
    // It fires a SECOND time in the same turn, which is the decision this test
    // pins: A16 is a placement reactor, not a visit reactor.
    expect(second.state.tasks.some((t) => t.t === 'draw' && t.src === 'A16')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// O17 The Fruit Basket: the manager's ruling of 10/09/2026
// ---------------------------------------------------------------------------

describe('O17 The Fruit Basket does NOT apply to a visit fee (ruled 10/09/2026)', () => {
  it('the fee rests on the host s board and never reaches the visitor s barn', () => {
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    buildFor(arm, s, 0, 'O17');
    dealTo(arm, s, 0, 'O7', 'O9');
    const out = apply(arm, s, visit(0, 1, 'O7'));
    // ⛔ THE WHOLE RULING IN TWO ASSERTIONS. A visit fee is not DISCARDED - it
    // rests on the host's board - so O17's "instead of discarding a card you
    // spend" has no subject, and the payment stays pointing at the host. The
    // alternative reading would invert the design: every fee would reach the
    // VISITOR's own barn instead of the host's, deleting the only payment to
    // the giver this design has.
    expect(boardOf(arm, out.state, 1).stack).toEqual(['O7']);
    expect(player(out.state, 0).barn).not.toContain('O7');
    // And no divert task was ever pushed: the fee left the hand through
    // `placeOnBuilding`, which is not `discardOrDivert`.
    expect(out.state.tasks.some((t) => t.t === 'divert')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S4: the receipts assertion
// ---------------------------------------------------------------------------

describe('S4: the Farmstead prints six receipt slots, and six is never exceeded', () => {
  it('no seat holds more than six receipts in a full game', () => {
    // The game ends when a player completes their SIXTH island delivery, so six
    // slots can never overflow. The six is a FACE and not a rule the engine
    // enforces, so this is the assertion that says the face is right.
    for (const seats of [2, 3, 4]) {
      const suits: Suit[] = (['wheat', 'orchard', 'dairy', 'apiary'] as Suit[]).slice(0, seats);
      let state = newGame(arm, { seats, suits, seed: `receipts-${seats}` });
      for (let step = 0; step < 4000 && state.phase !== 'ended'; step++) {
        const moves = legalMoves(arm, state);
        const move = moves[step % moves.length];
        if (move === undefined) break;
        state = apply(arm, state, move).state;
        for (const p of state.players) expect(p.receipts.length).toBeLessThanOrEqual(6);
      }
      expect(state.players.every((p) => p.receipts.length <= 6)).toBe(true);
    }
  });
});
