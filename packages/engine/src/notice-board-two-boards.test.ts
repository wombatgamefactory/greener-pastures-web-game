/**
 * ⭐ DEAN'S TWO-BOARD FIX FOR THE NOTICE BOARD VISIT (ruled 11/09/2026,
 * `overlays/notice-board-visit-two-boards-v1.overlay.json`, varying the design
 * in `docs/notice-board-visit-handoff-2026-09-10-v2.md`, S1-S16).
 *
 * ⛔ AN ARM AND NOT THE GAME, AND AN ARM OF AN ARM AT THAT. The shipped game is
 * still the commons; this is `visitCurrency: 'noticeBoardPower'` with
 * `selfVisitAllowed` false and `rules.economy.noticeBoardsBySeats` at 2 at two
 * seats, built to be measured against
 * `overlays/notice-board-visit-no-self-v1.overlay.json` on identical
 * `reference-v15` seeds. Nothing here may move a number in the shipped game or
 * in any control, which is why every case takes its data from
 * `noticeBoardTwoBoardsGame()` or `noticeBoardNoSelfGame()` and never from
 * `BASE_GAME_DATA`.
 *
 * THE RULE IN ONE LINE: self-visiting stays banned, and at TWO seats each
 * player lays out TWO Notice Boards - their own suit's, plus one more drawn at
 * random from the suits nobody is farming - with the fifth board unused. At
 * three and four seats it is one each, which is exactly the control.
 *
 * ⛔ THE FILE'S CENTRE OF GRAVITY IS THE IDENTITY GATE AT THE BOTTOM. At three
 * and four seats this arm is rule for rule its own control, so the same seeds
 * must produce the same games byte for byte; a difference there is a LEAK - a
 * setup draw that consumed an rng call it did not consume before, or a
 * predicate that learned to read the new knob when it should not - and never a
 * finding. The two-seat column is the only place this is a different game.
 *
 * ⚠️ AND THE SECOND-HEAVIEST CASE IS THE POWER'S SOURCE. A host's extra board
 * prints a DIFFERENT colour's power from the host's own suit, so reading the
 * power off `player(state, host).suit` sells the wrong action - invisibly, and
 * only ever at two seats. That is the one bug this variant can have.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { loadGameData } from '@gp/data';

import {
  apply,
  cardById,
  drainTasks,
  gameEndScores,
  harvestOptions,
  isHarvestable,
  legalMoves,
  newGame,
  noticeBoardOf,
  noticeBoardsOf,
  player,
  taskAnswers,
} from './index.js';
import { rngInt, seedRng } from './rng.js';
import type { CardId, GameState, Move, Seat } from './state.js';
import {
  buildFor,
  dealTo,
  loadStack,
  makeState,
  noticeBoardNoSelfGame,
  noticeBoardTwoBoardsGame,
} from './testkit.js';

const two: GameData = noticeBoardTwoBoardsGame();
const control: GameData = noticeBoardNoSelfGame();

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

function visit(seat: Seat, host: Seat, fee: CardId, board?: CardId): Move {
  return board === undefined
    ? { type: 'visit', seat, host, fee }
    : { type: 'visit', seat, host, fee, board };
}

/** The board cards in a seat's tableau, in tableau order. */
function boardCards(data: GameData, state: GameState, seat: Seat): CardId[] {
  return noticeBoardsOf(data, state, seat).map((b) => b.card);
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
// SETUP: two boards each at two seats, one each at three and four
// ---------------------------------------------------------------------------

describe('setup: how many boards a seat lays out, and which', () => {
  it('deals TWO boards to every seat at two seats: its own suit plus one unfarmed', () => {
    const s = newGame(two, { seats: 2, suits: ['wheat', 'orchard'], seed: 'tb-1' });
    for (const seat of [0, 1] as Seat[]) {
      const cards = boardCards(two, s, seat);
      expect(cards, `seat ${seat}`).toHaveLength(2);
      // The seat's OWN suit's board is the first, because setup builds the
      // starters before it deals the extras - which is what `noticeBoardOf`
      // now asks for by suit rather than by position.
      expect(cards[0]).toBe(BOARD[player(s, seat).suit]);
      expect(noticeBoardOf(two, s, seat).card).toBe(BOARD[player(s, seat).suit]);
    }
  });

  it('the extra board is never a suit anybody is farming, and the two seats differ', () => {
    // Every seed, not one: the draw is random and the two invariants are not.
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const s = newGame(two, { seats: 2, seed });
      const farmed = s.players.map((p) => p.suit);
      const extras = [0, 1].map((seat) => boardCards(two, s, seat as Seat)[1] as CardId);
      for (const extra of extras) {
        expect(farmed, seed).not.toContain(cardById(two, extra).suit);
      }
      expect(new Set(extras).size, seed).toBe(2);
    }
  });

  it('FOUR of the five boards are on the table and the fifth is unused', () => {
    const s = newGame(two, { seats: 2, suits: ['wheat', 'orchard'], seed: 'tb-2' });
    const onTable = [...boardCards(two, s, 0), ...boardCards(two, s, 1)];
    expect(new Set(onTable).size).toBe(4);
    const unused = Object.values(BOARD).filter((c) => !onTable.includes(c));
    expect(unused).toHaveLength(1);
  });

  it('ONE board each at three and four seats, which is the control unchanged', () => {
    for (const seats of [3, 4]) {
      const s = newGame(two, { seats, seed: `tb-${seats}` });
      for (let seat = 0; seat < seats; seat++) {
        expect(boardCards(two, s, seat as Seat), `${seats} seats, seat ${seat}`).toEqual([
          BOARD[player(s, seat as Seat).suit],
        ]);
      }
    }
  });

  it('the control lays out ONE board each at two seats: this is the whole difference', () => {
    const s = newGame(control, { seats: 2, suits: ['wheat', 'orchard'], seed: 'tb-1' });
    expect(boardCards(control, s, 0)).toEqual([BOARD.wheat]);
    expect(boardCards(control, s, 1)).toEqual([BOARD.orchard]);
  });

  it('and the drawn board is a POWER and not a deck: an unfarmed suit with no deck may come up', () => {
    // `island.decksInPlayBySeats` is 3 at two seats, so of the three unfarmed
    // suits only ONE has a deck on the table. The draw does NOT prefer it, and
    // this pins that choice rather than leaving it to be re-derived: a board
    // grants a POWER and never a deck, exactly as the commons put all five
    // actions on the table regardless of who farmed them.
    const drawn = new Set<Suit>();
    let deckless = 0;
    for (let i = 0; i < 20; i++) {
      const s = newGame(two, { seats: 2, suits: ['wheat', 'orchard'], seed: `deck-${i}` });
      for (const seat of [0, 1] as Seat[]) {
        const suit = cardById(two, boardCards(two, s, seat)[1] as CardId).suit;
        drawn.add(suit);
        if (!s.suitsInPlay.includes(suit)) deckless += 1;
      }
    }
    // All three unfarmed suits come up across the sample, and boards whose
    // deck is not even on the table are the common case rather than the
    // impossible one.
    expect(drawn).toEqual(new Set<Suit>(['apiary', 'dairy', 'vegetable']));
    expect(deckless).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC CEILING: what the engine does with an infeasible map value
// ---------------------------------------------------------------------------

describe('the arithmetic ceiling: seats * (n - 1) must be at most 5 - seats', () => {
  /** The arm with the map asking for two boards each at THREE seats: six out of five. */
  const infeasible: GameData = loadGameData({
    name: 'notice-board-visit-two-boards-infeasible',
    schemaVersion: 1,
    set: {
      'rules.economy.cropScorerOnBarn': false,
      // Pre-flip pins (12/09/2026): this is a named inline copy of a
      // committed overlay, and a copy of a pin stops being a pin.
      'aerodrome.moveCost.barnCards': 2,
      'aerodrome.alwaysInPlay': false,
      'aerodrome.flightMints': false,
      'aerodrome.balloons.balloonDraw.reward.type': 'draw',
      'aerodrome.balloons.balloonDraw.reward.amount': 4,
      'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
      'aerodrome.balloons.balloonBuild.reward.amount': 4,
      'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
      'aerodrome.balloons.balloonSow.reward.amount': 4,
      'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
      'rules.economy.storeCoinsPerCard': 0,
      'rules.economy.coinSupplyPerPlayer': 0,
      'rules.economy.coinPaysBuild': false,
      'rules.economy.coinPaysSuitCost': false,
      'rules.economy.coinPaysGrow': false,
      'rules.economy.coinGrowOnFullBuilding': false,
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.economy.noticeBoardsBySeats.2': 1, // pinned 13/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.3': 2,
    },
  });

  it('THROWS at setup with the arithmetic in the message, rather than dealing short', () => {
    expect(() => newGame(infeasible, { seats: 3, seed: 'x' })).toThrow(
      /only 2 suits are unfarmed at 3 seats/,
    );
  });

  it('and the same data is fine at the seat count the map can afford', () => {
    // The map names 3 alone, so two and four seats fall back to 1 board each.
    expect(() => newGame(infeasible, { seats: 2, seed: 'x' })).not.toThrow();
    expect(() => newGame(infeasible, { seats: 4, seed: 'x' })).not.toThrow();
  });

  it('a value below 1 throws too: a seat always lays out at least one board', () => {
    const none: GameData = loadGameData({
      name: 'notice-board-visit-no-boards',
      schemaVersion: 1,
      set: {
        'rules.economy.cropScorerOnBarn': false,
        // Pre-flip pins (12/09/2026): this is a named inline copy of a
        // committed overlay, and a copy of a pin stops being a pin.
        'aerodrome.moveCost.barnCards': 2,
        'aerodrome.alwaysInPlay': false,
        'aerodrome.flightMints': false,
        'aerodrome.balloons.balloonDraw.reward.type': 'draw',
        'aerodrome.balloons.balloonDraw.reward.amount': 4,
        'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
        'aerodrome.balloons.balloonBuild.reward.amount': 4,
        'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
        'aerodrome.balloons.balloonSow.reward.amount': 4,
        'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
        'rules.economy.storeCoinsPerCard': 0,
        'rules.economy.coinSupplyPerPlayer': 0,
        'rules.economy.coinPaysBuild': false,
        'rules.economy.coinPaysSuitCost': false,
        'rules.economy.coinPaysGrow': false,
        'rules.economy.coinGrowOnFullBuilding': false,
        'rules.turn.visitCurrency': 'noticeBoardPower',
        'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
        'rules.turn.selfVisitAllowed': true, // pinned 13/09/2026: the default flipped
        'rules.economy.noticeBoardsBySeats.2': 0,
      },
    });
    expect(() => newGame(none, { seats: 2, seed: 'x' })).toThrow(/at least one Notice Board/);
  });

  it('the knob has NO SUBJECT under any other currency, so nothing else can be broken by it', () => {
    // `extraNoticeBoardsPerSeat` gates on `isNoticeBoardPower`, so a sweep that
    // sets the map under the v31 card fee changes nothing at all rather than
    // building a game nobody designed.
    const cardWithMap: GameData = loadGameData({
      name: 'card-with-the-two-board-map',
      schemaVersion: 1,
      set: {
        'rules.turn.visitCurrency': 'card',
        'rules.turn.selfVisitAllowed': true,
        'rules.economy.noticeBoardsBySeats.2': 2,
      },
    });
    const s = newGame(cardWithMap, { seats: 2, suits: ['wheat', 'orchard'], seed: 'tb-1' });
    // Under the card fee every seat has exactly its own one board.
    for (const seat of [0, 1] as Seat[]) {
      expect(
        player(s, seat).tableau.filter((b) => cardById(cardWithMap, b.card).slot === 'noticeboard'),
      ).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE POWER COMES OFF THE BOARD, NOT OFF THE HOST'S SUIT
// ---------------------------------------------------------------------------

describe('the power is the BOARD’S and never the owner’s', () => {
  it('visiting a host’s EXTRA board buys that board’s power, not the host’s suit’s', () => {
    // Seats wheat + orchard, so the testkit deals the extras in catalogue
    // order: seat 0 (wheat) gets A3, seat 1 (orchard) gets D3.
    const s = position(two, ['wheat', 'orchard']);
    expect(boardCards(two, s, 1)).toEqual([BOARD.orchard, BOARD.dairy]);
    // Four payers plus the card to build, because the DAIRY power is a build
    // with the crops waived and D9 still needs three cards behind it.
    dealTo(two, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');

    const out = apply(two, s, visit(0, 1, 'W7', BOARD.dairy));
    // THE DAIRY POWER FIRED - a build with `substitute` - and NOT the Orchard
    // board's Draw 4, which is what reading the host's suit would have given.
    const build = out.state.tasks.find((t) => t.t === 'build');
    expect(build?.t === 'build' ? build.mods?.substitute : undefined).toBe(true);
    expect(build?.t === 'build' ? build.pid : null).toBe(0);
    expect(out.state.tasks.some((t) => t.t === 'draw')).toBe(false);
    // And the event names the BOARD's colour, so the door mix and the hook
    // count the action that was actually bought.
    expect(out.events).toContainEqual({
      e: 'visited',
      seat: 0,
      host: 1,
      self: false,
      colour: 'dairy',
      action: 'build',
    });
    expect(out.events).toContainEqual({
      e: 'doorUsed',
      seat: 0,
      colour: 'dairy',
      action: 'build',
      via: 'visit',
    });
  });

  it('visiting the same host’s OWN board buys the host’s suit’s power', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'W7');
    const out = apply(two, s, visit(0, 1, 'W7', BOARD.orchard));
    const draw = out.state.tasks.find((t) => t.t === 'draw');
    expect(draw?.t === 'draw' ? draw.pid : null).toBe(0);
    expect(draw?.t === 'draw' ? draw.see : null).toBe(
      two.rules.economy.noticeBoardPower.orchardDraw,
    );
  });

  it('the FEE lands on the board that was named, and the other board stays empty', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');
    const after = apply(two, s, visit(0, 1, 'W7', BOARD.dairy)).state;
    const boards = noticeBoardsOf(two, after, 1);
    expect(boards.find((b) => b.card === BOARD.dairy)?.stack).toEqual(['W7']);
    expect(boards.find((b) => b.card === BOARD.orchard)?.stack).toEqual([]);
    // ⭐ AND THE EXTRA BOARD PAYS ITS OWNER: the fee rests on seat 1's building
    // and seat 1 is the one who will harvest it, even though the power it
    // granted is one seat 1 can never buy for itself.
    expect(player(after, 1).hand).toEqual([]);
    expect(player(after, 1).barn).toEqual([]);
  });

  it('the owner harvests its extra board into its OWN barn', () => {
    const s = position(two, ['wheat', 'orchard']);
    loadStack(two, s, 1, BOARD.dairy, 3, 'dairy');
    const stacked = [
      ...(noticeBoardsOf(two, s, 1).find((b) => b.card === BOARD.dairy)?.stack ?? []),
    ];
    s.turnPlayer = 1;
    const after = autoResolve(
      two,
      apply(two, s, { type: 'harvest', seat: 1, building: BOARD.dairy }).state,
    );
    for (const card of stacked) expect(player(after, 1).barn).toContain(card);
  });
});

// ---------------------------------------------------------------------------
// THE ENUMERATOR: targets, the self ban, and the move's new field
// ---------------------------------------------------------------------------

describe('what the enumerator offers under two boards', () => {
  it('TWO targets at two seats, both of them the one rival’s boards', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');
    const visits = legalMoves(two, s).filter((m) => m.type === 'visit');
    const boards = new Set(visits.map((m) => (m.type === 'visit' ? m.board : undefined)));
    expect(boards).toEqual(new Set([BOARD.orchard, BOARD.dairy]));
    expect(visits.every((m) => m.type === 'visit' && m.host === 1)).toBe(true);
  });

  it('and the control offers ONE, which is the starve this arm was ruled to rescue', () => {
    const s = position(control, ['wheat', 'orchard']);
    dealTo(control, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');
    const visits = legalMoves(control, s).filter((m) => m.type === 'visit');
    expect(new Set(visits.map((m) => (m.type === 'visit' ? m.host : -1)))).toEqual(new Set([1]));
    expect(visits.every((m) => m.type === 'visit' && m.board === undefined)).toBe(true);
  });

  it('NEITHER of a seat’s own boards is ever a target', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'W7');
    const visits = legalMoves(two, s).filter((m) => m.type === 'visit');
    expect(visits.some((m) => m.type === 'visit' && m.host === 0)).toBe(false);
    expect(() => apply(two, s, visit(0, 0, 'W7', BOARD.wheat))).toThrow(/Self-visiting/);
    expect(() => apply(two, s, visit(0, 0, 'W7', BOARD.apiary))).toThrow(/Self-visiting/);
  });

  it('a move must NAME a board when the host holds two', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'W7');
    expect(() => apply(two, s, visit(0, 1, 'W7'))).toThrow(/must name one/);
  });

  it('and naming a board the host does not hold throws rather than falling back', () => {
    const s = position(two, ['wheat', 'orchard']);
    dealTo(two, s, 0, 'W7');
    // A3 is seat 0's own extra board, and V3 is the unused fifth.
    expect(() => apply(two, s, visit(0, 1, 'W7', BOARD.apiary))).toThrow(
      /is not a Notice Board of seat 1/,
    );
    expect(() => apply(two, s, visit(0, 1, 'W7', BOARD.vegetable))).toThrow(
      /is not a Notice Board of seat 1/,
    );
  });

  it('⛔ carries NO `board` key at three and four seats, which is what keeps the fixtures byte-identical', () => {
    for (const seats of [3, 4]) {
      const suits: Suit[] = ['wheat', 'orchard', 'dairy', 'apiary'].slice(0, seats) as Suit[];
      const s = position(two, suits);
      dealTo(two, s, 0, 'W7', 'W9', 'W10', 'W12');
      buildFor(two, s, 0, 'D9');
      const visits = legalMoves(two, s).filter((m) => m.type === 'visit');
      expect(visits.length, `${seats} seats`).toBeGreaterThan(0);
      for (const m of visits) expect('board' in m, `${seats} seats`).toBe(false);
    }
  });

  it('a board latched this turn falls out while its neighbour on the same farm stays', () => {
    const s = position(two, ['wheat', 'orchard']);
    // The surviving board is seat 1's DAIRY extra, whose power is a build with
    // the crops waived, so the hand has to be able to pay for one.
    dealTo(two, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12');
    s.turn.firedThisTurn.push(BOARD.orchard);
    const visits = legalMoves(two, s).filter((m) => m.type === 'visit');
    expect(visits.every((m) => m.type === 'visit' && m.board === BOARD.dairy)).toBe(true);
    expect(visits.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⭐ A HELPING HAND COMES ALIVE AT TWO SEATS FOR THE FIRST TIME
// ---------------------------------------------------------------------------

describe('A Helping Hand at two seats (S9’s latch, and what the arm changes)', () => {
  /** Seat 0 farms wheat and holds A Helping Hand; seat 1 farms dairy. */
  function helpingHandPosition(data: GameData): GameState {
    const s = position(data, ['wheat', 'dairy']);
    buildFor(data, s, 0, 'W18');
    dealTo(data, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12', 'W13', 'W14');
    return s;
  }

  it('the second play is REACHABLE, and it must go to the OTHER board', () => {
    const s = helpingHandPosition(two);
    // Seats wheat + dairy, so the testkit deals seat 1 the orchard board as
    // its extra: its own D3 plus O3.
    expect(boardCards(two, s, 1)).toEqual([BOARD.dairy, BOARD.orchard]);
    const first = apply(two, s, visit(0, 1, 'W7', BOARD.dairy));
    expect(first.state.turn.firedThisTurn).toContain(BOARD.dairy);
    const after = autoResolve(two, first.state);
    const second = legalMoves(two, after).filter((m) => m.type === 'visit');
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((m) => m.type === 'visit' && m.board === BOARD.orchard)).toBe(true);
    // And the latched board is refused by name, not merely unoffered.
    const fee = player(after, 0).hand[0] as CardId;
    expect(() => apply(two, after, visit(0, 1, fee, BOARD.dairy))).toThrow(/already been used/);
  });

  it('⛔ and under the CONTROL it can never be taken: one board, latched, nothing left', () => {
    const s = helpingHandPosition(control);
    expect(boardCards(control, s, 1)).toEqual([BOARD.dairy]);
    const first = apply(control, s, visit(0, 1, 'W7'));
    const after = autoResolve(control, first.state);
    expect(player(after, 0).hand.length).toBeGreaterThan(0);
    expect(legalMoves(control, after).filter((m) => m.type === 'visit')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TWO BOARDS IS TWO HARVESTS, AND A21 CAN COUNT BOTH
// ---------------------------------------------------------------------------

describe('two boards is two of everything the board is', () => {
  it('each board is harvestable on its own at `noticeBoardThreshold`', () => {
    const s = position(two, ['wheat', 'orchard']);
    const [own, extra] = boardCards(two, s, 0) as [CardId, CardId];
    loadStack(two, s, 0, own, 3, 'orchard');
    expect(harvestOptions(two, s, 0)).toEqual([own]);
    loadStack(two, s, 0, extra, 3, 'orchard');
    expect(new Set(harvestOptions(two, s, 0))).toEqual(new Set([own, extra]));
    // Harvesting one leaves the other loaded: they are two buildings, not one.
    const after = autoResolve(
      two,
      apply(two, s, { type: 'harvest', seat: 0, building: own }).state,
    );
    const boards = noticeBoardsOf(two, after, 0);
    expect(boards.find((b) => b.card === own)?.stack).toEqual([]);
    expect(boards.find((b) => b.card === extra)?.stack).toHaveLength(3);
    expect(isHarvestable(two, boards.find((b) => b.card === extra) as never)).toBe(true);
  });

  it('A21 The Wax Hall counts TWO Notice Boards at two seats, which is a card reading for Dean', () => {
    const s = position(two, ['apiary', 'wheat']);
    const [own, extra] = boardCards(two, s, 0) as [CardId, CardId];
    expect(own).toBe(BOARD.apiary);
    buildFor(two, s, 0, 'A21');
    const before = gameEndScores(two, s)[0]?.endgame ?? 0;
    loadStack(two, s, 0, own, 1, 'wheat');
    loadStack(two, s, 0, extra, 1, 'wheat');
    // ⚠️ A CARD READING AND NOT AN ENGINE CHOICE: A21 counts "your buildings
    // holding a card" over the whole tableau, so a second board is a second
    // point and nothing in the engine decided that.
    expect((gameEndScores(two, s)[0]?.endgame ?? 0) - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE HARD CORRECTNESS GATE: identical to the control at three and four seats
// ---------------------------------------------------------------------------

/**
 * A whole game played by taking a seeded-random legal move every time.
 *
 * ⭐ RANDOM AND NOT A BOT, DELIBERATELY. The gate is that two DATASETS produce
 * the same game, so the chooser only has to be a pure function of the position
 * and the seed - and @gp/bots is downstream of this package in any case. The
 * move list is compared as well as the state, because two runs could in
 * principle converge on the same position by different routes and that would
 * still be a leak.
 */
function playout(
  data: GameData,
  seats: number,
  seed: string,
  cap = 1500,
): { moves: Move[]; state: GameState } {
  let state = newGame(data, { seats, seed });
  const rng = seedRng(`playout:${seed}`);
  const moves: Move[] = [];
  for (let i = 0; i < cap && state.phase === 'playing'; i++) {
    const legal = legalMoves(data, state);
    if (legal.length === 0) break;
    const move = legal[rngInt(rng, legal.length)] as Move;
    moves.push(move);
    state = apply(data, state, move).state;
  }
  return { moves, state };
}

function transcript(run: { moves: Move[]; state: GameState }): string {
  return JSON.stringify(run);
}

describe('⛔ the identity gate: the arm IS its control at three and four seats', () => {
  it('plays byte-identical games on identical seeds at THREE seats', () => {
    for (const seed of ['gate-1', 'gate-2', 'gate-3']) {
      expect(transcript(playout(two, 3, seed)), seed).toBe(transcript(playout(control, 3, seed)));
    }
  });

  it('plays byte-identical games on identical seeds at FOUR seats', () => {
    for (const seed of ['gate-1', 'gate-2']) {
      expect(transcript(playout(two, 4, seed)), seed).toBe(transcript(playout(control, 4, seed)));
    }
  });

  it('and DIFFERS at two seats, which is the only column that may', () => {
    // Both halves matter: identical here would mean the knob is not wired at
    // all, and it is the two-seat column the whole arm exists to move.
    const armed = playout(two, 2, 'gate-1');
    const plain = playout(control, 2, 'gate-1');
    expect(transcript(armed)).not.toBe(transcript(plain));
    expect(boardCards(two, armed.state, 0)).toHaveLength(2);
    expect(boardCards(control, plain.state, 0)).toHaveLength(1);
  });

  it('the setup itself is identical at three and four seats, rng included', () => {
    // The narrower claim underneath the gate, and the one that fails FIRST if
    // a setup draw ever consumes an rng call the control did not: same decks,
    // same hands, same island, same rng state at move zero.
    for (const seats of [3, 4]) {
      for (const seed of ['setup-1', 'setup-2']) {
        expect(JSON.stringify(newGame(two, { seats, seed })), `${seats} seats, ${seed}`).toBe(
          JSON.stringify(newGame(control, { seats, seed })),
        );
      }
    }
  });
});
