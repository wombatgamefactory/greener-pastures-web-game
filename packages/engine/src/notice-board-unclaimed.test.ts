/**
 * ⭐ DEAN'S UNCLAIMED-BOARDS VARIANT OF THE NOTICE BOARD VISIT (ruled
 * 11/09/2026, `overlays/notice-board-visit-unclaimed-v1.overlay.json`).
 *
 * ⛔ AN ARM AND NOT THE GAME, AND NOT EVEN THE ARM: it is one corner of a 2x2
 * built to be measured against the notice-board visit as built
 * (`overlays/notice-board-visit-v1.overlay.json`) and against the shipped
 * commons on identical `reference-v15` seeds. Nothing here may move a number in
 * the shipped game or in any of the named controls, which is why every case
 * takes its data from `noticeBoardUnclaimedGame()` and never from
 * `BASE_GAME_DATA`.
 *
 * THE RULE IN ONE SENTENCE: self-visiting is BANNED, and the Notice Board of
 * every suit NO PLAYER IS FARMING stands ownerless in the centre of the table
 * with a face-up public pile that anybody may play onto and that anybody may
 * harvest at three cards or more.
 *
 * ⭐ THE FILE'S CENTRE OF GRAVITY IS THE FOUR-TARGETS TEST, because four
 * targets at every seat count IS the variant's whole argument. The design it
 * varies starved at two players - 29.1% of turns, below Dean's own 30% floor -
 * because with self-visiting banned and only two suits in play a seat had
 * exactly ONE board to visit. Five boards exist, you may never visit your own,
 * and the unfarmed ones stand in the middle: (5 - seats) central plus
 * (seats - 1) rivals is FOUR at every player count, and that arithmetic is the
 * fix. It also restores the standing Dean ruling the built design silently
 * broke - all five actions must exist in every game.
 *
 * ⛔ AND THE SECOND THING IT GUARDS IS THE SHARED BONUS SLOT. Two move kinds
 * are producible in one turn for the first time in this codebase (`visit` onto
 * a rival's board, `commons` onto a central one), and the slot holds ONE play,
 * two with A Helping Hand and never three, with the second forced onto a
 * different board. A seat getting a visit AND a commons play as two separate
 * slots is the most likely silent bug in the design.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';

import {
  apply,
  centralBoardSuits,
  commonsBoards,
  drainTasks,
  freshCommons,
  harvestOptions,
  legalMoves,
  newGame,
  noticeBoardOf,
  player,
  taskAnswers,
} from './index.js';
import type { CardId, GameState, Move, Seat } from './state.js';
import {
  buildFor,
  dealTo,
  loadStack,
  makeState,
  noticeBoardUnclaimedGame,
  noticeBoardUnclaimedSelfGame,
  noticeBoardVisitGame,
} from './testkit.js';

/** Dean's variant: the ban AND the centre. */
const arm: GameData = noticeBoardUnclaimedGame();

/** The 2x2's other centre corner: the centre WITHOUT the ban. */
const armSelf: GameData = noticeBoardUnclaimedSelfGame();

/** The arm this variant is read against: the ban's sibling, with no centre at all. */
const noCentre: GameData = noticeBoardVisitGame();

const BOARD: Record<Suit, CardId> = {
  wheat: 'W3',
  vegetable: 'V3',
  orchard: 'O3',
  apiary: 'A3',
  dairy: 'D3',
};

const ALL: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

/**
 * A position with the bonus window OPEN (`bonusTiming` is `'start'`, so before
 * the main action) and the named seat to play.
 */
function position(data: GameData, suits: Suit[], turnPlayer: Seat = 0): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = turnPlayer;
  s.turn.actionSpent = false;
  return s;
}

/**
 * Make every one of the five powers LIVE for `seat`, so that a count of targets
 * is a count of BOARDS and never an accident of S10 ("a board whose power you
 * cannot perform is not offered").
 *
 * The building is what the Apiary power needs (somewhere of your own to sow,
 * C89, and never the Notice Board itself, S11); the four cards are what the
 * Dairy power needs (a payable build after the fee leaves the hand) and what
 * the Wheat and Vegetable powers fall back on (a card for the barn).
 */
function makeEveryPowerLive(data: GameData, state: GameState, seat: Seat): void {
  const suit = player(state, seat).suit;
  const tier1 = data.cards.catalogue.find(
    (c) => c.suit === suit && c.inDeck && c.type === 'tier1' && c.threshold !== null,
  );
  if (!tier1) throw new Error(`No Tier 1 building for ${suit}`);
  buildFor(data, state, seat, tier1.id);
  const hand = data.cards.catalogue
    .filter((c) => c.suit === suit && c.inDeck && c.id !== tier1.id)
    .slice(0, 4)
    .map((c) => c.id);
  dealTo(data, state, seat, ...hand);
}

/** Put cards straight onto a central pile, off their own decks. */
function seedPile(data: GameData, state: GameState, board: Suit, ...cards: CardId[]): void {
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the centre`);
  for (const card of cards) {
    const suit = data.cards.catalogue.find((c) => c.id === card)?.suit;
    if (!suit) throw new Error(`Unknown card ${card}`);
    const deck = state.decks[suit];
    const i = deck.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} deck`);
    deck.splice(i, 1);
    pile.push(card);
  }
}

/** n cards off a suit's deck top, as a plain list of ids. */
function deckTop(state: GameState, suit: Suit, n: number): CardId[] {
  return state.decks[suit].slice(0, n);
}

/** The distinct boards this seat may play onto, split by where they stand. */
function targetsFor(
  data: GameData,
  state: GameState,
): { rivals: Set<Seat>; central: Set<Suit>; total: number } {
  const moves = legalMoves(data, state);
  const rivals = new Set<Seat>();
  const central = new Set<Suit>();
  for (const m of moves) {
    if (m.type === 'visit') rivals.add(m.host);
    if (m.type === 'commons') central.add(m.board);
  }
  return { rivals, central, total: rivals.size + central.size };
}

/** Drain a settled position's task queue by taking the first answer at every step. */
function autoResolve(data: GameData, state: GameState): GameState {
  let out = state;
  for (let guard = 0; guard < 60 && out.tasks.length > 0; guard++) {
    drainTasks(data, out);
    const head = out.tasks[0];
    if (head === undefined) break;
    const first = taskAnswers(data, out, head)[0];
    if (first === undefined) break;
    out = apply(data, out, { type: 'task', seat: head.pid, answer: first }).state;
  }
  return out;
}

function play(seat: Seat, board: Suit, fee: CardId): Move {
  return { type: 'commons', seat, board, fee };
}

function visit(seat: Seat, host: Seat, fee: CardId): Move {
  return { type: 'visit', seat, host, fee };
}

// ---------------------------------------------------------------------------
// Setup: five boards, and each one is in exactly one place
// ---------------------------------------------------------------------------

describe('setup: the unfarmed suits go to the centre and nothing else does', () => {
  it.each([
    [2, ['wheat', 'dairy']],
    [3, ['wheat', 'dairy', 'orchard']],
    [4, ['wheat', 'dairy', 'orchard', 'vegetable']],
  ] as [number, Suit[]][])(
    'at $0 seats the centre is exactly the suits nobody is farming',
    (seats, suits) => {
      const s = newGame(arm, { seats, suits, seed: 'unclaimed' });
      const central = centralBoardSuits(arm, s);
      expect(new Set(central)).toEqual(new Set(ALL.filter((x) => !suits.includes(x))));
      expect(central).toHaveLength(5 - seats);
      // ... and every seat still keeps its OWN Notice Board as a building.
      for (let seat = 0; seat < seats; seat++) {
        const slots = player(s, seat).tableau.map(
          (b) => arm.cards.catalogue.find((c) => c.id === b.card)?.slot,
        );
        expect(slots.sort()).toEqual(['barn', 'farmstead', 'noticeboard']);
        expect(noticeBoardOf(arm, s, seat).card).toBe(BOARD[player(s, seat).suit]);
      }
    },
  );

  it('⛔ SELECTS ON THE SEATS AND NOT ON `suitsInPlay`, WHICH ARE DIFFERENT SETS', () => {
    // `suitsInPlay` is the player suits PLUS the neutral DECKS
    // (`island.decksInPlayBySeats`: 3 at two seats, 4 at three, 5 at four), and
    // a neutral deck is a crop nobody is FARMING - it has no Notice Board on
    // anybody's farm. Selecting on it would put 2 boards in the centre at two
    // seats and NONE at four, so a seat would face 3 targets and then 3 again,
    // and the variant's whole argument would be false. This is the one place
    // the build departed from its brief, so it is asserted rather than noted.
    const s = newGame(arm, { seats: 2, suits: ['wheat', 'dairy'], seed: 'unclaimed' });
    expect(s.suitsInPlay).toHaveLength(3);
    expect(centralBoardSuits(arm, s)).toHaveLength(3);
    expect(centralBoardSuits(arm, s).some((c) => s.suitsInPlay.includes(c))).toBe(true);
  });

  it('the no-centre arm it is read against still has no central state at all (S2)', () => {
    const s = newGame(noCentre, { seats: 2, suits: ['wheat', 'dairy'], seed: 'unclaimed' });
    expect(s.commons).toBeUndefined();
    expect(centralBoardSuits(noCentre, s)).toEqual([]);
    expect(legalMoves(noCentre, s).some((m) => m.type === 'commons')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE HEADLINE: FOUR TARGETS AT EVERY SEAT COUNT
// ---------------------------------------------------------------------------

describe('⛔ EXACTLY FOUR TARGETS AT EVERY SEAT COUNT, and the split is fixed', () => {
  it.each([
    [2, ['wheat', 'dairy'], 1, 3],
    [3, ['wheat', 'dairy', 'orchard'], 2, 2],
    [4, ['wheat', 'dairy', 'orchard', 'vegetable'], 3, 1],
  ] as [number, Suit[], number, number][])(
    'at $0 seats a seat faces $2 rival board(s) and $3 central one(s)',
    (seats, suits, rivals, central) => {
      const s = position(arm, suits);
      expect(s.players).toHaveLength(seats);
      makeEveryPowerLive(arm, s, 0);
      const t = targetsFor(arm, s);
      expect(t.rivals.size, 'rival boards').toBe(rivals);
      expect(t.central.size, 'central boards').toBe(central);
      expect(t.total, 'targets in total').toBe(4);
      // Never your own, at any seat count (the ban, asserted here as well as in
      // its own describe, because the COUNT is only four if the own board is out
      // of it - five boards minus one is the whole arithmetic).
      expect(t.rivals.has(0)).toBe(false);
    },
  );

  it('at ONE seat the arithmetic still reads four, taken off the selection itself', () => {
    // ⚠️ SOLO IS NOT MODELLED BY THIS ENGINE AND NEVER HAS BEEN:
    // `island.seats` is min 2 / max 4 and `island.demandTokensBySeats` has no
    // "1" row, so `newGame` refuses a single seat and no position can be built.
    // That is a pre-existing limit of the island data and not something this
    // variant introduces, so the 1-seat row of the overlay's own table is
    // asserted where it actually lives - in the SELECTION - rather than faked
    // through a state the engine cannot construct.
    expect(() => newGame(arm, { seats: 1, suits: ['wheat'], seed: 'solo' })).toThrow();
    const solo = freshCommons(arm, ['wheat']);
    expect(Object.keys(solo.boards)).toHaveLength(4);
    expect(Object.keys(solo.boards)).not.toContain('wheat');
    // 4 central + 0 rivals = 4, which is the table's first row.
  });

  it('and the arm WITHOUT the centre is the starve this variant was ruled to fix', () => {
    // The same two-seat position under `notice-board-visit-no-self-v1`'s rules:
    // one board, and one board only. 29.1% of turns at two players is what that
    // measured, below Dean's own 30% floor.
    const s = position(noCentre, ['wheat', 'dairy']);
    makeEveryPowerLive(noCentre, s, 0);
    const t = targetsFor(noCentre, s);
    expect(t.central.size).toBe(0);
    // The no-centre arm ships with self-visiting ON, so it reads two here; the
    // BAN is what takes it to one, and the centre is what takes it back to four.
    expect(t.rivals.size).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------
// The restored ruling: all five actions exist in every game
// ---------------------------------------------------------------------------

describe('all five powers are reachable in a TWO-player game', () => {
  it('every one of the five boards is on the table and buyable by somebody', () => {
    const suits: Suit[] = ['wheat', 'dairy'];
    const reached = new Set<Suit>();
    for (const seat of [0, 1] as Seat[]) {
      const s = position(arm, suits, seat);
      makeEveryPowerLive(arm, s, seat);
      for (const m of legalMoves(arm, s)) {
        if (m.type === 'commons') reached.add(m.board);
        if (m.type === 'visit') reached.add(player(s, m.host).suit);
      }
    }
    expect(reached).toEqual(new Set(ALL));
  });

  it('and the seat-level view is four of the five, never its own', () => {
    const s0 = position(arm, ['wheat', 'dairy'], 0);
    makeEveryPowerLive(arm, s0, 0);
    const t0 = targetsFor(arm, s0);
    expect(new Set([...t0.central, ...[...t0.rivals].map((h) => player(s0, h).suit)])).toEqual(
      new Set<Suit>(['dairy', 'vegetable', 'orchard', 'apiary']),
    );
  });
});

// ---------------------------------------------------------------------------
// ⭐ A CENTRAL BOARD GRANTS THE PRINTED POWER, NOT THE PLAIN COMMONS ACTION
// ---------------------------------------------------------------------------

describe('⭐ a central board grants the same printed power as an owned one', () => {
  it('the central ORCHARD board draws `orchardDraw` (4), not the commons Draw 2', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const out = apply(arm, s, play(0, 'orchard', fee));
    const draw = out.state.tasks.find((t) => t.t === 'draw');
    expect(draw?.t === 'draw' ? draw.see : null).toBe(
      arm.rules.economy.noticeBoardPower.orchardDraw,
    );
    expect(draw?.t === 'draw' ? draw.see : null).toBe(4);
    expect(draw?.t === 'draw' ? draw.keep : null).toBe(4);
    expect(draw?.t === 'draw' ? draw.pid : null).toBe(0);
    // The fee is on the pile, face up and belonging to nobody.
    expect(commonsBoards(out.state)['orchard']).toEqual([fee]);
  });

  it('the central APIARY board SOWS 2 (S12/C89) and never GROWS (the commons C3 rule)', () => {
    // ⛔ THIS IS THE PASSENGER THE DATA PASS FLAGGED, RESOLVED IN THE
    // DIRECTION THE RULING POINTS. `doorActionForSuit` substitutes
    // `workers.roster.sow.actionUnderCommons` - the Apiary board's GROW, C3 of
    // the commons - only while `isCommons` is true, and under this variant the
    // currency is `'noticeBoardPower'`, so it is FALSE and the board reads back
    // its printed SOW. That is the CORRECT answer here rather than a bug: the
    // GROW substitution is the commons' rule for a board granting a plain DOOR
    // action, and a board granting a printed POWER has no door action to
    // substitute.
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const out = apply(arm, s, play(0, 'apiary', fee));
    const sow = out.state.tasks.find((t) => t.t === 'sow');
    expect(sow, 'the Apiary board pushes a SOW task').toBeDefined();
    expect(sow?.t === 'sow' ? sow.remaining : null).toBe(
      arm.rules.economy.noticeBoardPower.apiarySows,
    );
    expect(out.state.tasks.some((t) => t.t === 'grow')).toBe(false);
  });

  it('the central VEGETABLE board falls back to the barn, which the plain Deliver never did', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const out = apply(arm, s, play(0, 'vegetable', fee));
    const fallback = out.state.tasks.find((t) => t.t === 'handToBarn');
    expect(fallback?.t === 'handToBarn' ? fallback.remaining : null).toBe(
      arm.rules.economy.noticeBoardPower.vegetableFallback,
    );
  });

  it('and `doorUsed` is still emitted with via `commons`, so a16 and a07 count it', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const out = apply(arm, s, play(0, 'orchard', fee));
    const used = out.events.find((e) => e.e === 'doorUsed');
    expect(used?.e === 'doorUsed' ? used.via : null).toBe('commons');
    expect(used?.e === 'doorUsed' ? used.colour : null).toBe('orchard');
    // ⚠️ The ACTION is the roster's printed verb. For the apiary that is SOW
    // and not GROW, which is the same seam as the test above.
    expect(used?.e === 'doorUsed' ? used.action : null).toBe('draw');
  });
});

// ---------------------------------------------------------------------------
// The `3+` rule on a central pile
// ---------------------------------------------------------------------------

describe('a central pile is harvestable by ANYBODY at 3, and by nobody at 2', () => {
  it('at 2 cards no seat may harvest it', () => {
    const s = position(arm, ['wheat', 'dairy', 'orchard']);
    seedPile(arm, s, 'apiary', ...deckTop(s, 'apiary', 2));
    expect(commonsBoards(s)['apiary']).toHaveLength(2);
    for (const seat of [0, 1, 2] as Seat[]) {
      expect(harvestOptions(arm, s, seat), `seat ${seat}`).not.toContain(BOARD.apiary);
    }
  });

  it('at 3 cards EVERY seat may harvest it, and the whole pile goes to their barn', () => {
    const s = position(arm, ['wheat', 'dairy', 'orchard']);
    const cards = deckTop(s, 'apiary', 3);
    seedPile(arm, s, 'apiary', ...cards);
    for (const seat of [0, 1, 2] as Seat[]) {
      expect(harvestOptions(arm, s, seat), `seat ${seat}`).toContain(BOARD.apiary);
    }
    // A rival seat - not the one whose turn it is by accident - takes it.
    s.turnPlayer = 2;
    s.turn.actionSpent = false;
    const out = apply(arm, s, { type: 'harvest', seat: 2, building: BOARD.apiary });
    expect(commonsBoards(out.state)['apiary']).toEqual([]);
    expect(player(out.state, 2).barn).toEqual(cards);
    const harvested = out.events.find((e) => e.e === 'harvested');
    expect(harvested?.e === 'harvested' ? harvested.source : null).toBe('commons');
    expect(harvested?.e === 'harvested' ? harvested.owner : null).toBeNull();
  });

  it('nothing ever refuses a play, however deep the pile (commonsThreshold null)', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    seedPile(arm, s, 'orchard', ...deckTop(s, 'orchard', 7));
    expect(legalMoves(arm, s).some((m) => m.type === 'commons' && m.board === 'orchard')).toBe(
      true,
    );
  });

  it("a seat's OWN board is never a central pile, so its `3+` is its own to harvest", () => {
    const s = position(arm, ['wheat', 'dairy']);
    expect(centralBoardSuits(arm, s)).not.toContain('wheat');
    expect(() => seedPile(arm, s, 'wheat', 'W7')).toThrow(/no wheat board in the centre/);
  });
});

// ---------------------------------------------------------------------------
// ⭐ A HARVEST IS A HARVEST: the Wheat power reaches the centre too
// ---------------------------------------------------------------------------

describe('⭐ the WHEAT power can take a central pile, under the same minimum', () => {
  it('takes a central pile once the fee has brought it to the minimum', () => {
    // Wheat is unfarmed, so the wheat board is CENTRAL and buying its power is
    // a `commons` play. The fee lands on the pile before the power runs, which
    // is the order every version of this bonus has used since v14.
    const s = position(arm, ['orchard', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    seedPile(arm, s, 'wheat', ...deckTop(s, 'wheat', 2));
    const fee = player(s, 0).hand[0] as CardId;
    const out = apply(arm, s, play(0, 'wheat', fee));
    expect(commonsBoards(out.state)['wheat']).toHaveLength(3);
    const head = out.state.tasks[0];
    expect(head?.t).toBe('chooseBuilding');
    const answers = taskAnswers(arm, out.state, head as NonNullable<typeof head>);
    expect(
      answers.some((a) => a.kind === 'building' && a.card === BOARD.wheat),
      'the central wheat pile is a legal target of the bought Harvest',
    ).toBe(true);
    const take = answers.find((a) => a.kind === 'building' && a.card === BOARD.wheat);
    if (take === undefined) throw new Error('no central answer');
    const done = apply(arm, out.state, { type: 'task', seat: 0, answer: take });
    expect(commonsBoards(done.state)['wheat']).toEqual([]);
    expect(player(done.state, 0).barn).toHaveLength(3);
  });

  it('and does NOT reach a pile below the minimum, so the power waives nothing', () => {
    const s = position(arm, ['orchard', 'dairy']);
    // A loaded building of the seat's own, so the `chooseBuilding` task
    // SURVIVES and its answer list can be read: a task with no answers at all
    // is dropped by the drain loop, which would have made this case pass for
    // the wrong reason.
    buildFor(arm, s, 0, 'O4');
    loadStack(arm, s, 0, 'O4', 1);
    dealTo(arm, s, 0, 'O7', 'O9');
    seedPile(arm, s, 'apiary', ...deckTop(s, 'apiary', 2));
    const out = apply(arm, s, play(0, 'wheat', 'O7'));
    const head = out.state.tasks[0];
    expect(head?.t).toBe('chooseBuilding');
    const answers = taskAnswers(arm, out.state, head as NonNullable<typeof head>);
    // The seat's own building is offered at ANY stack size (C88's `loaded`)...
    expect(answers.some((a) => a.kind === 'building' && a.card === 'O4')).toBe(true);
    // ... and the apiary pile sits at 2 and the wheat pile at 1 (the fee
    // alone), so neither is: the power reaches the centre but waives nothing.
    expect(answers.some((a) => a.kind === 'building' && a.card === BOARD.apiary)).toBe(false);
    expect(answers.some((a) => a.kind === 'building' && a.card === BOARD.wheat)).toBe(false);
  });

  it('⚠️ the card faces that also print `loaded` do NOT reach the centre', () => {
    // W11, W13 and O7 say "your buildings" and the `central` flag is set only
    // by the Wheat POWER, which is the whole reason it is a flag rather than a
    // sixth `filter` value. Asserted through the task's own answer set.
    const s = position(arm, ['orchard', 'dairy']);
    buildFor(arm, s, 0, 'O4');
    seedPile(arm, s, 'wheat', ...deckTop(s, 'wheat', 4));
    const plain = taskAnswers(arm, s, {
      t: 'chooseBuilding',
      pid: 0,
      src: null,
      filter: 'loaded',
      then: 'harvest',
    });
    expect(plain.some((a) => a.kind === 'building' && a.card === BOARD.wheat)).toBe(false);
    const powered = taskAnswers(arm, s, {
      t: 'chooseBuilding',
      pid: 0,
      src: null,
      filter: 'loaded',
      central: true,
      then: 'harvest',
    });
    expect(powered.some((a) => a.kind === 'building' && a.card === BOARD.wheat)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The ban: self-visiting is impossible, by two independent routes
// ---------------------------------------------------------------------------

describe('self-visiting is impossible, and so is reaching your own board sideways', () => {
  it.each([
    [2, ['wheat', 'dairy']],
    [3, ['wheat', 'dairy', 'orchard']],
    [4, ['wheat', 'dairy', 'orchard', 'vegetable']],
  ] as [number, Suit[]][])('at $0 seats no visit names the acting seat as host', (seats, suits) => {
    for (let seat = 0; seat < seats; seat++) {
      const s = position(arm, suits, seat as Seat);
      makeEveryPowerLive(arm, s, seat as Seat);
      const visits = legalMoves(arm, s).filter((m) => m.type === 'visit');
      expect(visits.length, `seat ${seat} has rivals to visit`).toBeGreaterThan(0);
      expect(visits.some((m) => m.type === 'visit' && m.host === seat)).toBe(false);
    }
  });

  it('and `apply` refuses one that was constructed by hand', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    expect(() => apply(arm, s, visit(0, 0, fee))).toThrow(/Self-visiting/);
  });

  it("no seat's own board ever appears as a CENTRAL target either", () => {
    for (const suits of [
      ['wheat', 'dairy'],
      ['wheat', 'dairy', 'orchard'],
      ['wheat', 'dairy', 'orchard', 'vegetable'],
    ] as Suit[][]) {
      const s = position(arm, suits);
      const central = centralBoardSuits(arm, s);
      for (const p of s.players) expect(central, p.suit).not.toContain(p.suit);
    }
  });

  it('⭐ and the 2x2 shows the two knobs are separable: the centre without the ban', () => {
    // `unclaimed-self-v1` is the same centre with `selfVisitAllowed` true, so a
    // seat faces FIVE boards there rather than four. This is what makes any
    // pair of the four arms attributable to ONE rule.
    const s = position(armSelf, ['wheat', 'dairy']);
    makeEveryPowerLive(armSelf, s, 0);
    const t = targetsFor(armSelf, s);
    expect(t.rivals.has(0)).toBe(true);
    expect(t.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE SHARED BONUS SLOT, ACROSS BOTH MOVE KINDS
// ---------------------------------------------------------------------------

describe('⛔ the bonus slot holds ONE play across BOTH kinds', () => {
  it('a commons play spends the whole slot: no second commons play AND no visit', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const after = autoResolve(arm, apply(arm, s, play(0, 'orchard', fee)).state);
    const moves = legalMoves(arm, after);
    expect(moves.some((m) => m.type === 'commons')).toBe(false);
    expect(moves.some((m) => m.type === 'visit')).toBe(false);
  });

  it('a visit spends the whole slot too: no commons play behind it', () => {
    const s = position(arm, ['wheat', 'dairy']);
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const after = autoResolve(arm, apply(arm, s, visit(0, 1, fee)).state);
    const moves = legalMoves(arm, after);
    expect(moves.some((m) => m.type === 'visit')).toBe(false);
    expect(moves.some((m) => m.type === 'commons')).toBe(false);
  });

  it('A Helping Hand grants a SECOND play, which may cross from one kind to the other', () => {
    const s = position(arm, ['wheat', 'dairy']);
    buildFor(arm, s, 0, 'W18');
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const after = autoResolve(arm, apply(arm, s, play(0, 'orchard', fee)).state);
    const moves = legalMoves(arm, after);
    // The second play exists...
    expect(moves.some((m) => m.type === 'visit' || m.type === 'commons')).toBe(true);
    // ... and S9 sends it to a DIFFERENT board: the orchard board is latched.
    expect(after.turn.firedThisTurn).toContain(BOARD.orchard);
    expect(moves.some((m) => m.type === 'commons' && m.board === 'orchard')).toBe(false);
    const fee2 = player(after, 0).hand[0] as CardId;
    expect(() => apply(arm, after, play(0, 'orchard', fee2))).toThrow(/already been used/);
  });

  it('and never a THIRD, whichever two kinds the first two were', () => {
    const s = position(arm, ['wheat', 'dairy']);
    buildFor(arm, s, 0, 'W18');
    makeEveryPowerLive(arm, s, 0);
    const fee = player(s, 0).hand[0] as CardId;
    const one = autoResolve(arm, apply(arm, s, play(0, 'orchard', fee)).state);
    const fee2 = player(one, 0).hand[0] as CardId;
    // A visit for the second half, so the pair spans both move kinds.
    const two = autoResolve(arm, apply(arm, one, visit(0, 1, fee2)).state);
    expect(two.turn.bonusUsed).toEqual(['commons', 'visit']);
    const moves = legalMoves(arm, two);
    expect(moves.some((m) => m.type === 'commons')).toBe(false);
    expect(moves.some((m) => m.type === 'visit')).toBe(false);
  });

  it('⭐ the latch is shared, so a rival board and a central one cannot be the same board', () => {
    // They never can be, and it is by CONSTRUCTION rather than by the latch: a
    // suit is EITHER one seat's or in the centre and never both, because
    // `newGame` refuses duplicate player suits and `freshCommons` takes exactly
    // the leftovers. So there is no rival Wheat board in a game where Wheat is
    // central, and the latch's card-id key and a suit key are the same
    // partition. Asserted so the reasoning cannot rot.
    const s = position(arm, ['wheat', 'dairy', 'orchard']);
    const central = new Set(centralBoardSuits(arm, s).map((c) => BOARD[c]));
    const owned = new Set(s.players.map((_, i) => noticeBoardOf(arm, s, i as Seat).card));
    expect([...central].filter((c) => owned.has(c))).toEqual([]);
    expect(central.size + owned.size).toBe(5);
  });
});
