/**
 * Ticket 17's proof: the full newGame / legalMoves / apply surface plays whole
 * games. Surgical tests pin each action funnel and the turn boundary; the
 * full-game tests drive seeded games to the delivery-count end trigger with a greedy
 * policy, assert apply accepts exactly what legalMoves offers, keep a ceiling
 * on the move list, check card conservation, and replay the move list to the
 * bit-identical final state.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import type { Overlay, Suit } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { anyDeliverOption, deliverOptions, islandDeliveriesBy, tileLevel } from './actions.js';
import { apply, isOver, legalMoves, newGame } from './game.js';
import { cardById } from './query.js';
import { seedRng, rngInt } from './rng.js';
import { score } from './runtime.js';
import { freshTurn, islandTilesInPlay } from './setup.js';
import type { GameEvent, GameState, Move } from './state.js';
import { buildFor, dealTo, deliveredAt, hireFor, makeState } from './testkit.js';
import { redactEvents, viewFor } from './view.js';

const WHEAT = 0;
const APIARY = 1;

function base(): GameState {
  return makeState(data, ['wheat', 'apiary']);
}

function noticeBoard(state: GameState, seat: number) {
  const board = state.players[seat]?.tableau.find(
    (b) => cardById(data, b.card).slot === 'noticeboard',
  );
  if (!board) throw new Error(`seat ${seat} has no Notice Board`);
  return board;
}

/** Flip a seat's Notice Board to its upgraded face without paying for it. */
function upgradeNoticeBoard(state: GameState, seat: number): void {
  noticeBoard(state, seat).upgraded = true;
}

/**
 * Special Orders' 2-card line is off in the shipped data - `twoCard` is null
 * since the 2026-08-13 upgraded face replaced that card - but the mode is still
 * in the engine, kept so switching it back on stays a data edit. Its tests
 * therefore run against an overlay that prints the line. Without this they
 * could only assert that the mode is unreachable, and the branch would rot
 * unwatched until somebody deleted it for the wrong reason.
 */
const twoCardData = loadGameData({
  name: 'two-card-visit',
  description: "guards Special Orders' switched-off 2-card mode",
  schemaVersion: 1,
  set: { 'rules.economy.visitPayout.twoCard': 3 },
} as unknown as Overlay);

function twoCardState(): GameState {
  return makeState(twoCardData, ['wheat', 'apiary']);
}

/** A Wheat delivery to A1, which the testkit island stocks with two wheat crates (4 wheat). */
function deliverA1(spend: Partial<Record<Suit, number>>): Move {
  return { type: 'deliver', seat: WHEAT, tile: 'A1', spend };
}

/** Move ids from a deck straight into a barn (testkit-style surgery). */
function stockBarn(state: GameState, seat: number, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

describe('newGame', () => {
  it('sets up a 2-seat game per the rules data', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'setup' });
    expect(state.suitsInPlay).toHaveLength(3);
    expect(state.suitsInPlay.slice(0, 2)).toEqual(['wheat', 'apiary']);
    for (const p of state.players) {
      expect(p.hand).toHaveLength(5);
      expect(p.barn).toHaveLength(1);
      expect(p.coins).toBe(0);
      // THREE starters since change 6 (20/08/2026): Barn, Farmstead, Notice
      // Board. The fourth was the Service and its door merged into the Board.
      expect(p.tableau).toHaveLength(3);
      // Own deck holds 12 after dealing hand + barn card.
      expect(state.decks[p.suit]).toHaveLength(12);
      for (const id of [...p.hand, ...p.barn]) expect(cardById(data, id).suit).toBe(p.suit);
    }
    const passive = state.suitsInPlay[2] as Suit;
    expect(state.decks[passive]).toHaveLength(18);
    // Bookend rule at 2 seats: A1 A2 A5 / B1 B4 / D1.
    expect(state.island.tiles.map((t) => t.tile)).toEqual(['A1', 'A2', 'A5', 'B1', 'B4', 'D1']);
    // 12 demand tokens over 12 crates - 6 tiles of 2 since the flat island -
    // only in-play suits and wilds.
    const tokens = state.island.tiles.flatMap((t) => t.crates);
    expect(tokens).toHaveLength(12);
    for (const tok of tokens) {
      expect(tok === 'wild' || state.suitsInPlay.includes(tok)).toBe(true);
    }
    // Every Service is owned from setup by the suit that brought it, and a
    // Service whose suit is absent has no owner at all.
    const owned = state.fair.filter((w) => w.owner !== null);
    expect(owned).toHaveLength(2);
    for (const w of state.fair) {
      const spec = data.workers.roster.find((r) => r.id === w.id)!;
      const seat = state.players.findIndex((p) => p.suit === spec.linkedSuit);
      expect(w.owner, w.id).toBe(seat < 0 ? null : seat);
    }
  });

  it('parks balloons only when Vegetable is on the table', () => {
    const withVeg = newGame(data, { seats: 2, suits: ['vegetable', 'dairy'], seed: 'v' });
    expect(withVeg.aerodrome?.balloons).toHaveLength(4);
    // Ruling J: all four start unowned in the centre - no per-seat parking.
    expect(withVeg.aerodrome?.balloons.filter((b) => b.at === 'centre')).toHaveLength(4);
    // At 4 seats all five decks are on the table, so the Aerodrome is always in play.
    const four = newGame(data, {
      seats: 4,
      suits: ['wheat', 'apiary', 'orchard', 'dairy'],
      seed: 'n',
    });
    expect(four.suitsInPlay).toContain('vegetable');
    expect(four.aerodrome).not.toBeNull();
    // At 2 seats the passive suit is random; find a seed that leaves Vegetable out.
    for (let i = 0; i < 20; i++) {
      const s = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: `n${i}` });
      if (!s.suitsInPlay.includes('vegetable')) {
        expect(s.aerodrome).toBeNull();
        return;
      }
    }
    throw new Error('no seed left Vegetable out in 20 tries');
  });

  it('tiles the island for every seat count', () => {
    expect(islandTilesInPlay(data, 3)).toEqual([
      'A1',
      'A2',
      'A3',
      'A5',
      'B1',
      'B2',
      'B4',
      'C1',
      'C3',
    ]);
    expect(islandTilesInPlay(data, 4)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'B1',
      'B2',
      'B3',
      'B4',
      'C1',
      'C2',
      'C3',
    ]);
  });
});

describe('main actions through apply', () => {
  it('draw is the base see-2-keep-1 task and spends the action', () => {
    const state = base();
    dealTo(data, state, WHEAT, 'W4'); // a fee card so the turn does not auto-end
    const applied = apply(data, state, { type: 'draw', seat: WHEAT });
    expect(applied.state.turn.actionSpent).toBe(true);
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 2, keep: 1, pid: WHEAT });
    const picks = legalMoves(data, applied.state);
    expect(picks.every((m) => m.type === 'task' && m.seat === WHEAT)).toBe(true);
  });

  it('build pays the printed cost and never flips the Farmstead - the milestone is retired', () => {
    // Until 2026-08-12 the third own-crop building flipped the Farmstead free.
    // Dean retired that: the Farmstead is bought for £2 like its siblings, so
    // three own-colour builds now leave it on its base face.
    let state = base();
    state.players[WHEAT]!.coins = 10;
    const events: GameEvent[] = [];
    for (let n = 0; n < 3; n++) {
      // Refill: enough wheat cards to cover any tier-1 cost.
      dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, 4));
      const builds = legalMoves(data, state).filter(
        (m): m is Extract<Move, { type: 'build' }> =>
          m.type === 'build' && cardById(data, m.card).suit === 'wheat',
      );
      expect(builds.length).toBeGreaterThan(0);
      const applied = apply(data, state, builds[0] as Move);
      events.push(...applied.events);
      state = applied.state;
      state.turn = freshTurn();
      state.turnPlayer = WHEAT;
      state.tasks = [];
    }
    const built = state.players[WHEAT]!.tableau.filter(
      (b) => cardById(data, b.card).type !== 'starter',
    );
    expect(built).toHaveLength(3);
    const wheatFarm = state.players[WHEAT]!.tableau.find(
      (b) => cardById(data, b.card).slot === 'farmstead',
    );
    expect(wheatFarm?.upgraded).toBe(false);
    expect(events.filter((e) => e.e === 'starterUpgraded')).toHaveLength(0);
  });

  /**
   * Dean, 19/08/2026: the starter flip *"is no longer considered a Build action
   * - instead it is one of the 4 bonus actions you may perform on your turn"*.
   * So the assertion that used to read "a Build-action branch" now has to read
   * the opposite in both directions: the slot is spent and the ACTION IS NOT.
   */
  it('upgrade spends the bonus slot, not the main action, and is priced from data', () => {
    const s2 = base();
    s2.players[WHEAT]!.coins = 2;
    const barnCard = s2.players[WHEAT]!.tableau.find(
      (b) => cardById(data, b.card).slot === 'barn',
    )!;
    const up = apply(data, s2, { type: 'upgrade', seat: WHEAT, card: barnCard.card });
    expect(up.state.players[WHEAT]!.tableau.find((b) => b.card === barnCard.card)?.upgraded).toBe(
      true,
    );
    expect(up.state.players[WHEAT]!.coins).toBe(0);
    expect(up.state.turn.bonusSpent).toBe(true);
    expect(up.state.turn.actionSpent).toBe(false);
    // And the slot is genuinely gone: no second bonus, of any kind.
    expect(legalMoves(data, up.state).some((m) => m.type === 'upgrade')).toBe(false);
    expect(legalMoves(data, up.state).some((m) => m.type === 'visit')).toBe(false);
  });

  /**
   * THE BONUS WINDOW (Dean, 19/08/2026): *"the bonus action can only be
   * performed at the start of your turn."* One predicate, `bonusOpen`, and the
   * whole of it is that the main action has not been taken.
   */
  it('the bonus slot shuts the moment the main action is taken', () => {
    const open = base();
    dealTo(data, open, WHEAT, 'W4'); // a visit needs a fee card in hand
    open.players[WHEAT]!.coins = 2;
    expect(legalMoves(data, open).some((m) => m.type === 'upgrade')).toBe(true);
    expect(legalMoves(data, open).some((m) => m.type === 'visit')).toBe(true);

    // `!actionSpent` IS "at the start of your turn" - there is no other thing a
    // turn can have done, which is why the rule needed no new state. Set here
    // rather than reached through a real action because every main action
    // pushes a task, and a pending task is the one thing that suppresses the
    // whole move list.
    const shut = base();
    dealTo(data, shut, WHEAT, 'W4');
    shut.players[WHEAT]!.coins = 2;
    shut.turn.actionSpent = true;
    expect(shut.turn.bonusSpent).toBe(false); // unspent, and still unreachable
    expect(legalMoves(data, shut).some((m) => m.type === 'upgrade')).toBe(false);
    expect(legalMoves(data, shut).some((m) => m.type === 'visit')).toBe(false);
    expect(legalMoves(data, shut).some((m) => m.type === 'workOwnWorker')).toBe(false);
  });

  it('deliver pays crates from the barn, mints coins, and takes the next receipt on the tile', () => {
    const state = base();
    // Testkit island at 2 seats: A1 holds [wheat, wheat], so 4 wheat.
    dealTo(data, state, WHEAT, 'W4'); // keep the bonus slot live so the turn does not auto-end
    stockBarn(state, WHEAT, 'wheat', 4);
    const applied = apply(data, state, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 4 },
    });
    // First to this tile, so the head of the schedule: 6 VP and a flat £1.
    expect(applied.state.players[WHEAT]!.receipts).toEqual([6]);
    expect(applied.state.players[WHEAT]!.coins).toBe(1);
    expect(applied.state.players[WHEAT]!.barn).toHaveLength(0);
    expect(applied.state.island.tiles.find((t) => t.tile === 'A1')?.deliveredBy).toEqual([WHEAT]);
    expect(applied.state.endTrigger).toBeNull();

    // Second to the SAME tile takes the second entry, whoever they are. The
    // whole time gradient is this: arriving first is worth double.
    const s2 = applied.state;
    s2.turn = freshTurn();
    s2.turnPlayer = APIARY;
    stockBarn(s2, APIARY, 'wheat', 4);
    const second = apply(data, s2, {
      type: 'deliver',
      seat: APIARY,
      tile: 'A1',
      spend: { wheat: 4 },
    });
    expect(second.state.players[APIARY]!.receipts).toEqual([3]);
    expect(second.state.players[APIARY]!.coins).toBe(1);
  });

  /**
   * The clock. One seat's Nth island delivery ends the game, counted across the
   * whole island and per seat - so a rival racing does not arm your trigger, and
   * the two receipts on one tile count as two.
   */
  it('the end fires on a sixth island delivery by ONE seat, not on six across the table', () => {
    const s = base();
    // Five for Wheat and five for Apiary, interleaved over the six 2-seat tiles.
    deliveredAt(s, WHEAT, 'A1', 'A2', 'A5', 'B1', 'B4');
    deliveredAt(s, APIARY, 'A1', 'A2', 'A5', 'B1', 'B4');
    expect(islandDeliveriesBy(s, WHEAT)).toBe(5);
    expect(s.endTrigger).toBeNull();

    stockBarn(s, WHEAT, 'dairy', 4);
    const out = apply(data, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'D1',
      spend: { dairy: 4 },
    });
    expect(islandDeliveriesBy(out.state, WHEAT)).toBe(6);
    expect(out.state.endTrigger).toEqual({ seat: WHEAT });
    expect(out.events.some((e) => e.e === 'endTriggered')).toBe(true);
  });

  it('rules.endGame.deliveriesToTrigger is the dial on the clock', () => {
    const quick = loadGameData({
      name: 'short-game',
      schemaVersion: 1,
      set: { 'rules.endGame.deliveriesToTrigger': 2 },
    });
    const s = makeState(quick, ['wheat', 'apiary']);
    deliveredAt(s, WHEAT, 'A2');
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(quick, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.endTrigger).toEqual({ seat: WHEAT });
  });

  it('a tile takes two deliveries and then refuses', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 12);
    const move: Move = { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } };
    let s = apply(data, state, move).state;
    s.turn = freshTurn();
    s.turnPlayer = WHEAT;
    s = apply(data, s, move).state;
    s.turn = freshTurn();
    s.turnPlayer = WHEAT;
    expect(legalMoves(data, s).some((m) => m.type === 'deliver' && m.tile === 'A1')).toBe(false);
    expect(() => apply(data, s, move)).toThrow(/no delivery slots/);
  });

  /**
   * The wild substitution: "when you pay the island, any single card it asks for
   * may instead be paid with 2 cards of any crops".
   *
   * The testkit island puts [wheat, wheat] on A1, so A1 wants 4 wheat. That
   * gives the payment shapes the rule creates - 4 wheat, 3 wheat + 2 anything,
   * and 8 anything - and lets the parity trap it exists to break be shown
   * directly: a barn holding THREE wheat used to be worth nothing against A1.
   */
  it('pays a demanded card with 2 of any crops, at every shape', () => {
    const exact = base();
    stockBarn(exact, WHEAT, 'wheat', 4);
    expect(apply(data, exact, deliverA1({ wheat: 4 })).state.players[WHEAT]!.barn).toHaveLength(0);

    // One card short, which is the 84% case, and it now delivers.
    const half = base();
    stockBarn(half, WHEAT, 'wheat', 3);
    stockBarn(half, WHEAT, 'apiary', 2);
    expect(anyDeliverOption(data, half, WHEAT)).toBe(true);
    apply(data, half, deliverA1({ wheat: 3, apiary: 2 }));

    // No wheat at all: every demanded card substituted, 8 of anything. The flat
    // island caps that at 8 - it used to be 12 at a Level 3 tile.
    const none = base();
    stockBarn(none, WHEAT, 'apiary', 6);
    stockBarn(none, WHEAT, 'orchard', 2);
    apply(data, none, deliverA1({ apiary: 6, orchard: 2 }));

    // And the rate is a real price, so short change is still refused.
    expect(() => apply(data, half, deliverA1({ wheat: 3, apiary: 1 }))).toThrow(/does not pay/);
  });

  it('offers substituted payments as real moves, deduped, and never over-substitutes', () => {
    const s = base();
    stockBarn(s, WHEAT, 'wheat', 3);
    stockBarn(s, WHEAT, 'apiary', 2);
    const spends = deliverOptions(data, s, WHEAT)
      .filter((o) => o.tile === 'A1')
      .map((o) => JSON.stringify(o.spend));
    // Exactly one: the minimum substitution, and the only surplus it can draw
    // filler from is the pair of apiary. Paying more when 5 cards will do is
    // legal but strictly worse, so it is not offered.
    expect(spends).toEqual([JSON.stringify({ wheat: 3, apiary: 2 })]);
    expect(new Set(spends).size).toBe(spends.length);
  });

  it('cardsPerSubstitution null restores exact matching - the control arm', () => {
    const strict = loadGameData({
      name: 'no-wild-substitution',
      schemaVersion: 1,
      set: { 'island.cardsPerSubstitution': null },
    });
    const s = makeState(strict, ['wheat', 'apiary']);
    stockBarn(s, WHEAT, 'wheat', 3);
    stockBarn(s, WHEAT, 'apiary', 2);
    expect(anyDeliverOption(strict, s, WHEAT)).toBe(false);
    expect(() =>
      apply(strict, s, {
        type: 'deliver',
        seat: WHEAT,
        tile: 'A1',
        spend: { wheat: 3, apiary: 2 },
      }),
    ).toThrow(/ONE suit/);
  });

  /**
   * The flat island's one gradient, and the properties that make it the rule
   * rather than an implementation detail:
   *  - it is PER TILE, so a rival taking your tile costs you 3 VP while a rival
   *    taking a different tile costs you nothing. That is what makes it a race
   *    over a specific square of board rather than a queue you join;
   *  - it is the WHOLE receipt, not a bonus on top of a printed value. There is
   *    nothing left to add it to;
   *  - it never runs out and never reaches zero, so no delivery is a dead move.
   */
  it('the receipt is decided by arrival order at that tile, per tile', () => {
    const s = base();
    stockBarn(s, WHEAT, 'wheat', 8);
    stockBarn(s, APIARY, 'wheat', 8);
    const deliver = (seat: number, tile: string) => ({
      type: 'deliver' as const,
      seat,
      tile,
      spend: { wheat: 4 },
    });
    const nextTurn = (state: GameState, seat: number) => {
      state.turn = freshTurn();
      state.turnPlayer = seat;
      return state;
    };

    // Wheat gets to A1 first: the head of the schedule.
    let g = apply(data, s, deliver(WHEAT, 'A1')).state;
    expect(g.players[WHEAT]!.receipts).toEqual([6]);

    // Apiary goes to a DIFFERENT tile and is first there, so it takes 6 too.
    // Under the old level queue this was the second delivery to Level 1 and
    // would have been docked; per tile, it is not.
    g = apply(data, nextTurn(g, APIARY), deliver(APIARY, 'A2')).state;
    expect(g.players[APIARY]!.receipts).toEqual([6]);

    // Apiary follows Wheat onto A1: second at that tile, so 3.
    g = apply(data, nextTurn(g, APIARY), deliver(APIARY, 'A1')).state;
    expect(g.players[APIARY]!.receipts).toEqual([6, 3]);

    // And Wheat following Apiary onto A2 is second there, also 3 - the schedule
    // is a property of the tile, not of the player or of how late it is.
    g = apply(data, nextTurn(g, WHEAT), deliver(WHEAT, 'A2')).state;
    expect(g.players[WHEAT]!.receipts).toEqual([6, 3]);
  });

  it('island.vpByDeliveryOrder is the schedule AND the capacity - the control arm', () => {
    const flat = loadGameData({
      name: 'flat-receipts',
      schemaVersion: 1,
      set: { 'island.vpByDeliveryOrder': [5, 4] },
    });
    const s = makeState(flat, ['wheat', 'apiary']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(flat, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.players[WHEAT]!.receipts).toEqual([5]);

    // Shortening the array closes a delivery space. There is no second knob to
    // keep in step, which is the reason it is one array.
    const single = loadGameData({
      name: 'one-delivery-per-tile',
      schemaVersion: 1,
      set: { 'island.vpByDeliveryOrder': [6] },
    });
    const t = makeState(single, ['wheat', 'apiary']);
    stockBarn(t, WHEAT, 'wheat', 8);
    const u = apply(single, t, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 4 },
    }).state;
    u.turn = freshTurn();
    u.turnPlayer = WHEAT;
    expect(legalMoves(single, u).some((m) => m.type === 'deliver' && m.tile === 'A1')).toBe(false);
  });

  /**
   * No hierarchy (2026-08-09). The level gate is deleted, not switched off, so
   * every tile on the board is deliverable from the first turn - which is the
   * change a player notices first.
   */
  it('every tile is open from the first turn, whatever its printed row', () => {
    // Testkit island at 2 seats: A1/A2/A5 row 1, B1/B4 row 2, D1 row 3. Stock
    // every demand, so the only thing that could refuse a tile is a rule.
    const s = base();
    stockBarn(s, WHEAT, 'wheat', 8);
    stockBarn(s, WHEAT, 'apiary', 8);
    stockBarn(s, WHEAT, 'dairy', 8);
    const rows = new Set(
      legalMoves(data, s)
        .filter((m) => m.type === 'deliver')
        .map((m) => tileLevel(data, m.tile)),
    );
    expect(rows).toEqual(new Set([1, 2, 3]));

    // Including the top row on a seat's very first delivery, which the gate
    // used to make impossible.
    const out = apply(data, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'D1',
      spend: { dairy: 4 },
    });
    expect(out.state.players[WHEAT]!.receipts).toEqual([6]);
  });

  it('a balloon move is not an island delivery, so it never arms the clock', () => {
    // The freight branch of Deliver (DL-12) never touches the island, so it
    // takes no receipt space and does not count toward the end trigger.
    const s = makeState(data, ['vegetable', 'wheat']);
    stockBarn(s, 0, 'wheat', 1);
    stockBarn(s, 0, 'apiary', 1);
    const move = legalMoves(data, s).find((m) => m.type === 'moveBalloon');
    expect(move).toBeDefined();
    const after = apply(data, s, move as Move).state;
    expect(after.island.tiles.every((t) => t.deliveredBy.length === 0)).toBe(true);
    expect(after.players[0]!.receipts).toEqual([]);
  });

  it('the Farmstead is bought for £2 like its siblings, and buying one flips only itself', () => {
    // The rule change of 2026-08-12: the Farmstead is on the upgrade menu at
    // the standard price, and nothing on the table flips it for free. The old
    // knock-on - a paid Barn flip printing the third crop icon and flipping the
    // Farmstead as well - is gone with the milestone that read it.
    const s = base();
    buildFor(data, s, WHEAT, 'W4', 'W5'); // two own-crop deck builds
    dealTo(data, s, WHEAT, 'W6'); // keep the turn from settling
    s.players[WHEAT]!.coins = 2;

    const offered = legalMoves(data, s)
      .filter((m): m is Extract<Move, { type: 'upgrade' }> => m.type === 'upgrade')
      .map((m) => m.card);
    expect(offered).toContain('W2');

    const up = apply(data, s, { type: 'upgrade', seat: WHEAT, card: 'W2' });
    const tableau = up.state.players[WHEAT]!.tableau;
    expect(tableau.find((b) => b.card === 'W2')?.upgraded).toBe(true);
    expect(tableau.find((b) => b.card === 'W1')?.upgraded).toBe(false);
    expect(up.state.players[WHEAT]!.coins).toBe(0);
    expect(up.events.filter((e) => e.e === 'starterUpgraded').map((e) => e.card)).toEqual(['W2']);
  });

  it('a paid Barn flip no longer flips the Farmstead with it', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4', 'W5'); // the old milestone's first two icons
    dealTo(data, s, WHEAT, 'W6');
    s.players[WHEAT]!.coins = 2;
    const up = apply(data, s, { type: 'upgrade', seat: WHEAT, card: 'W1' });
    expect(up.state.players[WHEAT]!.tableau.find((b) => b.card === 'W2')?.upgraded).toBe(false);
  });

  it('pass is offered only when no main action is legal', () => {
    const state = base();
    expect(legalMoves(data, state).some((m) => m.type === 'pass')).toBe(false);
    // Empty every deck and discard: no draw, and an empty hand allows nothing else.
    for (const suit of data.cards.suits) {
      state.decks[suit] = [];
      state.discards[suit] = [];
    }
    const moves = legalMoves(data, state);
    expect(moves.some((m) => m.type === 'pass')).toBe(true);
    expect(moves.filter((m) => m.type !== 'pass' && m.type !== 'visit')).toHaveLength(0);
  });
});

describe('the bonus slot through apply', () => {
  it('a coin visit places the fee and mints the printed payout to the visitor', () => {
    const state = base();
    dealTo(data, state, WHEAT, 'W4', 'W5');
    const applied = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(applied.state.players[WHEAT]!.coins).toBe(data.rules.economy.visitPayout.base);
    const board = applied.state.players[APIARY]!.tableau.find(
      (b) => cardById(data, b.card).slot === 'noticeboard',
    );
    expect(board?.stack).toEqual(['W4']);
    expect(applied.state.turn.bonusSpent).toBe(true);
    expect(applied.state.turn.visit).toBeNull(); // coin mode never arms the Helping Hand
  });

  it('a worker visit runs the action for the visitor and arms the gate', () => {
    const state = base();
    hireFor(state, APIARY, 'draw');
    dealTo(data, state, WHEAT, 'W4');
    const applied = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    expect(applied.state.turn.visit).toMatchObject({ host: APIARY, workerId: 'draw' });
    // Draw 3 since change 6: the Orchard door follows the sheet's O3.
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3, pid: WHEAT });
    // A BASE board pays the action branch nothing. That is what the upgrade buys.
    expect(applied.state.players[WHEAT]!.coins).toBe(0);
  });

  /**
   * The 2026-08-13 upgraded face: "VISIT: gain £2, OR gain £1 and do the special
   * action". The second half is the new one, and it is the whole card - it is
   * what stops a visitor swapping to the coin branch on the same farm instead of
   * choosing that farm over a neighbour's.
   */
  it('an upgraded board pays the action branch too, and the owner still gets nothing', () => {
    const state = base();
    upgradeNoticeBoard(state, APIARY);
    hireFor(state, APIARY, 'draw');
    dealTo(data, state, WHEAT, 'W4');
    const hostBefore = state.players[APIARY]!.coins;
    const applied = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'worker', workerId: 'draw' },
    });
    expect(applied.state.players[WHEAT]!.coins).toBe(data.rules.economy.visitPayout.upgradedAction);
    expect(applied.state.players[APIARY]!.coins).toBe(hostBefore);
    // The action still happens: the coin is on top of it, not instead of it.
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', pid: WHEAT });
  });

  it('an upgraded board still pays the coin branch its own bigger rate', () => {
    const state = base();
    upgradeNoticeBoard(state, APIARY);
    dealTo(data, state, WHEAT, 'W4');
    const applied = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4'],
      payoff: { mode: 'coin' },
    });
    expect(applied.state.players[WHEAT]!.coins).toBe(data.rules.economy.visitPayout.upgraded);
  });

  it("Special Orders' 2-card visit places both cards and mints the bigger payout", () => {
    const state = twoCardState();
    upgradeNoticeBoard(state, APIARY);
    dealTo(twoCardData, state, WHEAT, 'W4', 'W5', 'W6');
    const applied = apply(twoCardData, state, {
      type: 'visit',
      seat: WHEAT,
      host: APIARY,
      fee: ['W4', 'W5'],
      payoff: { mode: 'special' },
    });
    const visitor = applied.state.players[WHEAT] as GameState['players'][number];
    expect(visitor.coins).toBe(twoCardData.rules.economy.visitPayout.twoCard);
    expect(visitor.hand).toEqual(['W6']);
    expect(noticeBoard(applied.state, APIARY).stack).toEqual(['W4', 'W5']);
    expect(applied.state.turn.bonusSpent).toBe(true);
    // No Worker option, so the Helping Hand gate stays shut.
    expect(applied.state.turn.visit).toBeNull();
    expect(applied.events).toContainEqual({
      e: 'visited',
      seat: WHEAT,
      host: APIARY,
      mode: 'special',
    });
  });

  it('offers the 2-card mode only at an upgraded board, and never with a Worker', () => {
    const state = twoCardState();
    hireFor(state, APIARY, 'draw');
    dealTo(twoCardData, state, WHEAT, 'W4', 'W5');
    const plain = legalMoves(twoCardData, state).filter((m) => m.type === 'visit');
    expect(plain.some((m) => m.payoff.mode === 'special')).toBe(false);
    expect(() =>
      apply(twoCardData, state, {
        type: 'visit',
        seat: WHEAT,
        host: APIARY,
        fee: ['W4', 'W5'],
        payoff: { mode: 'special' },
      }),
    ).toThrow(/does not print/);

    upgradeNoticeBoard(state, APIARY);
    const special = legalMoves(twoCardData, state).filter(
      (m) => m.type === 'visit' && m.payoff.mode === 'special',
    );
    expect(special).toHaveLength(1); // C(2,2), one host
    expect(special[0]).toMatchObject({ fee: ['W4', 'W5'] });
    // A special visit is a pair of DISTINCT cards: no card is ever paid twice.
    expect(
      legalMoves(twoCardData, state).some(
        (m) => m.type === 'visit' && m.payoff.mode === 'special' && m.fee[0] === m.fee[1],
      ),
    ).toBe(false);
  });

  it('never offers the 2-card mode when the line is switched off', () => {
    const state = base();
    upgradeNoticeBoard(state, APIARY);
    dealTo(data, state, WHEAT, 'W4', 'W5');
    expect(data.rules.economy.visitPayout.twoCard).toBeNull();
    expect(
      legalMoves(data, state).some((m) => m.type === 'visit' && m.payoff.mode === 'special'),
    ).toBe(false);
    expect(() =>
      apply(data, state, {
        type: 'visit',
        seat: WHEAT,
        host: APIARY,
        fee: ['W4', 'W5'],
        payoff: { mode: 'special' },
      }),
    ).toThrow(/switched off/);
  });

  it('refuses the whole 2-card visit when the board has room for only one', () => {
    const state = twoCardState();
    upgradeNoticeBoard(state, APIARY);
    const board = noticeBoard(state, APIARY);
    board.stack = state.decks.apiary.splice(0, 4); // 4 of 5
    dealTo(twoCardData, state, WHEAT, 'W4', 'W5');
    const moves = legalMoves(twoCardData, state).filter((m) => m.type === 'visit');
    expect(moves.some((m) => m.payoff.mode === 'special')).toBe(false);
    expect(moves.some((m) => m.payoff.mode === 'coin')).toBe(true); // one card still fits
    expect(() =>
      apply(twoCardData, state, {
        type: 'visit',
        seat: WHEAT,
        host: APIARY,
        fee: ['W4', 'W5'],
        payoff: { mode: 'special' },
      }),
    ).toThrow(/no room/);
    expect(noticeBoard(state, APIARY).stack).toHaveLength(4); // nothing moved
  });

  it('holds every payoff to its printed card count', () => {
    const state = base();
    upgradeNoticeBoard(state, APIARY);
    dealTo(data, state, WHEAT, 'W4', 'W5');
    for (const move of [
      { fee: ['W4', 'W5'], payoff: { mode: 'coin' as const } },
      { fee: ['W4'], payoff: { mode: 'special' as const } },
    ]) {
      expect(() =>
        apply(data, state, { type: 'visit', seat: WHEAT, host: APIARY, ...move }),
      ).toThrow(/exactly/);
    }
  });

  it('working your own Worker uses the bonus slot and pays no wage', () => {
    const state = base();
    hireFor(state, WHEAT, 'harvest');
    // No full building: the Harvest Worker has nothing to do, so it is not offered.
    expect(legalMoves(data, state).some((m) => m.type === 'workOwnWorker')).toBe(false);
  });
});

describe('the turn boundary', () => {
  /**
   * ⚠️ INVERTED 19/08/2026, and the inversion is the point of the rule.
   *
   * This used to assert that the kept card funded a visit and so the turn WAITED
   * for the bonus slot to be spent or declined. With the slot start-of-turn only
   * (`bonusOpen` = unspent AND the action untaken), an unspent slot can no
   * longer hold anything open: past the action there is nothing to wait for, so
   * the turn settles on its own and `endTurn` is not needed.
   *
   * That is also why `settleTurn`'s `hasBonusOption` check was deleted rather
   * than tidied - it had become unreachable, not merely redundant.
   */
  it('ends the turn by itself once the action is done, because the slot is already shut', () => {
    const state = base();
    const applied = apply(data, state, { type: 'draw', seat: WHEAT });
    // Resolve the draw: pick a deck twice, then keep one.
    let s = applied.state;
    while (s.tasks.length > 0) {
      const moves = legalMoves(data, s);
      s = apply(data, s, moves[0] as Move).state;
    }
    // The kept card WOULD have funded a visit. It cannot now: the action is
    // spent, so the window is shut and the turn has already passed on.
    expect(s.turnPlayer).toBe(APIARY);
  });

  it('queues the end-of-turn discard down to the printed Barn size', () => {
    const state = base();
    dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, 7));
    state.turn.actionSpent = true;
    const applied = apply(data, state, { type: 'endTurn', seat: WHEAT });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'discard', pid: WHEAT, downTo: 5 });
    const options = legalMoves(data, applied.state);
    expect(options).toHaveLength(21); // C(7,2)
    const done = apply(data, applied.state, options[0] as Move);
    expect(done.state.players[WHEAT]!.hand).toHaveLength(5);
    expect(done.state.turnPlayer).toBe(APIARY);
  });
});

describe('the card buy', () => {
  /**
   * ⚠️ POLARITY FLIPPED 19/08/2026. The card buy is DELETED from the shipped
   * game - `rules.turn.buyCost` is null - so the whole of this suite now has to
   * switch the rule ON to describe it, and the "switched off" case at the
   * bottom is simply the base data.
   *
   * The suite is kept rather than deleted because the deletion is a knob and
   * not a revert: the engine treats null as "rule absent", every code path is
   * still standing, and `overlays/turn-structure-v14.overlay.json` turns the
   * rule back on as the paired control. If that arm sends the buy back, these
   * are the tests that say it still works. If it does not, this suite is
   * deleted with the code in the cleanup commit.
   */
  const buyOn = loadGameData({
    name: 'card-buy-on',
    schemaVersion: 1,
    set: { 'rules.turn.buyCost': 1 },
  });

  function withCoins(n: number): GameState {
    const state = base();
    state.players[WHEAT]!.coins = n;
    return state;
  }

  function buys(state: GameState): Move[] {
    return legalMoves(buyOn, state).filter((m) => m.type === 'buy');
  }

  it('offers every deck but your own, and only while you can pay', () => {
    expect(buys(withCoins(0))).toHaveLength(0);
    // Two seats: wheat, apiary and one passive deck. The Wheat seat may buy
    // from the other two and never from wheat.
    const offered = buys(withCoins(1));
    expect(offered.map((m) => (m.type === 'buy' ? m.suit : null)).sort()).toEqual(
      base()
        .suitsInPlay.filter((s) => s !== 'wheat')
        .sort(),
    );
  });

  it('pays the bank, takes the top card blind, and is once a turn', () => {
    const state = withCoins(3);
    const top = state.decks.apiary[0] as string;
    const applied = apply(buyOn, state, { type: 'buy', seat: WHEAT, suit: 'apiary' });
    const after = applied.state;
    expect(after.players[WHEAT]!.coins).toBe(2);
    expect(after.players[WHEAT]!.hand).toContain(top);
    expect(after.decks.apiary[0]).not.toBe(top);
    expect(after.turn.buyUsed).toBe(true);
    // Free: the main action and the bonus slot are both still there.
    expect(after.turn.actionSpent).toBe(false);
    expect(after.turn.bonusSpent).toBe(false);
    expect(buys(after)).toHaveLength(0);
    expect(() => apply(buyOn, after, { type: 'buy', seat: WHEAT, suit: 'apiary' })).toThrow();
  });

  it('is not a Draw: no reveal task, and the Orchard modifier never touches it', () => {
    const orchard = makeState(buyOn, ['orchard', 'wheat']);
    orchard.players[0]!.coins = 1;
    const farmstead = orchard.players[0]!.tableau.find(
      (b) => cardById(buyOn, b.card).slot === 'farmstead',
    );
    farmstead!.upgraded = true; // see +1 and keep +1 on every DRAW
    const applied = apply(buyOn, orchard, { type: 'buy', seat: 0, suit: 'wheat' });
    expect(applied.state.tasks).toHaveLength(0);
    expect(applied.state.players[0]!.hand).toHaveLength(1);
  });

  it('holds the turn open, so a seat with coins declines rather than running out', () => {
    const state = withCoins(1);
    // Hand is empty, so with the buy switched off the draw's turn settles by
    // itself once the kept card is spent. With it on, the free action is an
    // unspent option exactly like the bonus slot.
    state.turn.actionSpent = true;
    expect(legalMoves(buyOn, state).some((m) => m.type === 'endTurn')).toBe(true);
    expect(buys(state).length).toBeGreaterThan(0);
    const ended = apply(buyOn, state, { type: 'endTurn', seat: WHEAT });
    expect(ended.state.turnPlayer).toBe(APIARY);
  });

  it('is absent from the SHIPPED game, which is where the rule now stands', () => {
    const state = withCoins(5);
    expect(legalMoves(data, state).filter((m) => m.type === 'buy')).toHaveLength(0);
    expect(() => apply(data, state, { type: 'buy', seat: WHEAT, suit: 'apiary' })).toThrow();
  });
});

describe('buy at market (ticket 56)', () => {
  /**
   * ⚠️ POLARITY FLIPPED 19/08/2026. Buy-at-market is DELETED from the shipped
   * game - `rules.turn.marketCost` is null - so this suite switches the rule ON
   * to describe it, and the "switched off" case at the bottom is the base data.
   *
   * Kept for the same reason the card buy's suite is kept: the removal is a
   * knob, not a revert, and `overlays/turn-structure-v14.overlay.json` is the
   * control that turns it back on. Note what replaced the rule rather than
   * deleting the exchange - A17 The Smoke Pot now prints "whenever you VISIT a
   * neighbour, you may pay £1 to add a deck card into your barn", which is this
   * market at a third of the price and gated behind a visit.
   */
  const marketOn = loadGameData({
    name: 'market-on',
    schemaVersion: 1,
    set: { 'rules.turn.marketCost': 3 },
  });

  function withCoins(n: number): GameState {
    const state = base();
    state.players[WHEAT]!.coins = n;
    return state;
  }

  function markets(state: GameState): Move[] {
    return legalMoves(marketOn, state).filter((m) => m.type === 'market');
  }

  it('offers every deck in play, OWN SUIT INCLUDED, and only at the printed price', () => {
    expect(markets(withCoins(2))).toHaveLength(0);
    const offered = markets(withCoins(3));
    // Unlike the buy, the market may point at your own crop: the barn
    // destination makes it harmless colour for delivery.
    expect(offered.map((m) => (m.type === 'market' ? m.suit : null)).sort()).toEqual(
      [...base().suitsInPlay].sort(),
    );
  });

  it('pays the bank, puts the top card in the BARN revealed, and consumes the bonus slot', () => {
    const state = withCoins(3);
    const top = state.decks.apiary[0] as string;
    const applied = apply(marketOn, state, { type: 'market', seat: WHEAT, suit: 'apiary' });
    const after = applied.state;
    expect(after.players[WHEAT]!.coins).toBe(0);
    expect(after.players[WHEAT]!.barn).toContain(top);
    expect(after.players[WHEAT]!.hand).toHaveLength(0);
    // Revealed: the deckToBarn event carries the card, like the Patisserie.
    expect(applied.events).toContainEqual({
      e: 'deckToBarn',
      seat: WHEAT,
      suit: 'apiary',
      card: top,
    });
    // The bonus slot is spent - no visit, no second market - but the main
    // action is untouched.
    expect(after.turn.bonusSpent).toBe(true);
    expect(after.turn.actionSpent).toBe(false);
    expect(legalMoves(marketOn, after).some((m) => m.type === 'visit')).toBe(false);
    expect(markets(after)).toHaveLength(0);
  });

  it('is not a visit: no wage, no visited event, and it never arms a Helping Hand', () => {
    const state = withCoins(3);
    const applied = apply(marketOn, state, { type: 'market', seat: WHEAT, suit: 'wheat' });
    expect(applied.events.some((e) => e.e === 'visited')).toBe(false);
    expect(applied.state.turn.visit).toBeNull();
    // The only coins that moved were the fee to the bank.
    const coinEvents = applied.events.filter((e) => e.e === 'coins');
    expect(coinEvents).toEqual([{ e: 'coins', seat: WHEAT, delta: -3, why: 'market' }]);
  });

  it('is not a Draw: no task, and the Orchard modifier never touches it', () => {
    const orchard = makeState(marketOn, ['orchard', 'wheat']);
    orchard.players[0]!.coins = 3;
    const farmstead = orchard.players[0]!.tableau.find(
      (b) => cardById(marketOn, b.card).slot === 'farmstead',
    );
    farmstead!.upgraded = true; // see +1 and keep +1 on every DRAW
    const applied = apply(marketOn, orchard, { type: 'market', seat: 0, suit: 'wheat' });
    expect(applied.state.tasks).toHaveLength(0);
    expect(applied.state.players[0]!.hand).toHaveLength(0);
    expect(applied.state.players[0]!.barn).toHaveLength(1); // the bought card, nothing kept
  });

  it('reshuffles an empty deck, and an exhausted crop cannot be bought', () => {
    const state = withCoins(6);
    // Deck empty, discard holds one card: the buy reshuffles and delivers.
    const card = state.decks.apiary[0] as string;
    state.discards.apiary.push(...state.decks.apiary.splice(0));
    const applied = apply(marketOn, state, { type: 'market', seat: WHEAT, suit: 'apiary' });
    expect(applied.events.some((e) => e.e === 'reshuffled')).toBe(true);
    expect(applied.state.players[WHEAT]!.barn).toHaveLength(1);
    expect(card).toBeDefined();
    // Both empty: that crop is off the market entirely (the doc's ruling).
    const dry = withCoins(3);
    dry.decks.apiary.splice(0);
    expect(markets(dry).some((m) => m.type === 'market' && m.suit === 'apiary')).toBe(false);
  });

  /**
   * ⚠️ INVERTED 19/08/2026 by the start-of-turn rule. This used to assert that
   * a £3 seat with the action spent was still offered the market, so the turn
   * waited for an explicit decline. `bonusOpen` now requires the action
   * UNTAKEN, so the market is unreachable there and nothing waits. The second
   * half - a £2 seat is never held hostage by a price it cannot pay - is
   * unchanged and still worth pinning.
   */
  it('is unreachable once the action is spent, and never holds a £2 seat hostage', () => {
    const rich = withCoins(3);
    rich.turn.actionSpent = true;
    expect(markets(rich)).toHaveLength(0);
    const ended = apply(marketOn, rich, { type: 'endTurn', seat: WHEAT });
    expect(ended.state.turnPlayer).toBe(APIARY);
    // £2 under the market-only marketOn (the buy off): no market option exists, so
    // nothing offers and nothing waits.
    const marketOnly = loadGameData({
      name: 'market-not-buy',
      schemaVersion: 1,
      set: { 'rules.turn.buyCost': null },
    });
    const poor = withCoins(2);
    poor.turn.actionSpent = true;
    const moves = legalMoves(marketOnly, poor);
    expect(moves.filter((m) => m.type === 'market' || m.type === 'buy')).toHaveLength(0);
  });

  it('is absent from the SHIPPED game, which is where the rule now stands', () => {
    const state = withCoins(9);
    expect(legalMoves(data, state).filter((m) => m.type === 'market')).toHaveLength(0);
    expect(() => apply(data, state, { type: 'market', seat: WHEAT, suit: 'apiary' })).toThrow();
  });
});

describe('views and redaction', () => {
  it('viewFor hides rival hands, deck order and barn identity', () => {
    const state = base();
    dealTo(data, state, APIARY, 'A5', 'A6');
    stockBarn(state, APIARY, 'apiary', 2);
    const view = viewFor(data, state, WHEAT);
    expect(view.rivals[0]).toMatchObject({ seat: APIARY, handCount: 2, barnCount: 2 });
    // The rival panel carries no hand or barn card ids (A5/A6 are in the rival's hand).
    expect(JSON.stringify(view.rivals)).not.toContain('"A5"');
    expect(JSON.stringify(view.rivals)).not.toContain('"A6"');
    expect(view.decks.wheat).toBeTypeOf('number');
  });

  /**
   * A face-down demand token is PUBLIC. It sits on the board as a visible blank,
   * so it must cross the view boundary unredacted for every seat - and the
   * failure mode the Vegetable rebuild's ticket names is precisely a swap that
   * renders correctly for the acting seat and wrongly for everybody else.
   * `viewFor` spreads the tile, so this holds by construction; asserting it is
   * what stops a future redaction pass quietly dropping the flag.
   */
  it('shows a face-down demand token to every seat, not just the one who turned it', () => {
    const state = base();
    const tile = state.island.tiles[0]!;
    tile.faceDown = tile.crates.map((_, i) => i === 0);
    for (let seat = 0; seat < state.players.length; seat++) {
      const seen = viewFor(data, state, seat).island.tiles.find((t) => t.tile === tile.tile);
      expect(seen?.faceDown, `seat ${seat}`).toEqual(tile.faceDown);
      expect(seen?.crates, `seat ${seat}`).toEqual(tile.crates);
    }
  });

  it('redactEvents masks ids down to their suit letter for other seats', () => {
    const events: GameEvent[] = [
      { e: 'cardsToHand', seat: APIARY, cards: ['A5'] },
      { e: 'cardPlaced', seat: APIARY, onto: { seat: WHEAT, building: 'W3' }, card: 'A6' },
      { e: 'harvested', seat: WHEAT, building: 'W4', cards: ['W5'] },
    ];
    const mine = redactEvents(events, APIARY);
    expect(mine[0]).toMatchObject({ cards: ['A5'] });
    const theirs = redactEvents(events, WHEAT);
    expect(theirs[0]).toMatchObject({ cards: ['A?'] });
    expect(theirs[1]).toMatchObject({ card: 'A?' });
    expect(theirs[2]).toMatchObject({ cards: ['W?'] }); // barns are anonymous even to the owner
  });
});

describe('scoring', () => {
  /**
   * Ticket 37 deleted the coin pity, which this test had been using to BUILD
   * the VP tie. Coins now enter scoring only here, as the first tie-break, so
   * the tie is made out of receipts and the coins do nothing else.
   */
  it('ranks by VP, then coins, then receipts', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(4); // 4 VP
    state.players[APIARY]!.receipts.push(4); // 4 VP - tied
    state.players[APIARY]!.coins = 21; // worth 0 VP, breaks the tie
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(result.seats[APIARY]!.total);
    expect(result.seats[APIARY]!.coinPity).toBe(0);
    expect(result.ranking).toEqual([APIARY, WHEAT]);
  });

  it('falls through to receipt count when VP and coins both tie', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(8); // 8 VP from one receipt
    state.players[APIARY]!.receipts.push(4, 4); // 8 VP from two
    state.players[WHEAT]!.coins = 3;
    state.players[APIARY]!.coins = 3;
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(result.seats[APIARY]!.total);
    expect(result.ranking).toEqual([APIARY, WHEAT]);
  });
});

// --- full games ------------------------------------------------------------

const PRIORITY: Move['type'][] = [
  'task',
  'deliver',
  'harvest',
  'build',
  'upgrade',
  'grow',
  'draw',
  'visit',
  'workOwnWorker',
  'cardMove',
  'pass',
  'endTurn',
];

/** Greedy delivery-first policy over legal moves, seeded ties. */
function pickMove(rng: [number, number, number, number], moves: Move[]): Move {
  for (const type of PRIORITY) {
    const of = moves.filter((m) => m.type === type);
    if (of.length > 0) return of[rngInt(rng, of.length)] as Move;
  }
  throw new Error('no move to pick');
}

/**
 * Every card id the game still holds, wherever it is - including the two places
 * a card can be in LIMBO, out of every pile and not yet anywhere.
 *
 * The limbo holders are the point of this function and the reason it is not
 * just "the zones". A `draw` task holds what it has revealed; the `divert` seam
 * (the Orchard Farmstead, O17) holds the card a draw threw away; and the Dairy
 * rebuild added two more - D2's `divertSpent` holds a build's payment between
 * the build and the choice of what goes to the barn, and D10's `scout` holds
 * the revealed deck tops until one is built and the rest go back. A card task's
 * riders are untyped, so both are read by their rider names.
 *
 * `covered` used to be listed here - a zone rather than limbo, because D11
 * buried a card in it permanently. D11 stopped building on top of a building on
 * 19/08/2026 and the zone went with it, so there is nothing left to count.
 */
function inPlayCardIds(state: GameState): string[] {
  const ids: string[] = [];
  for (const suit of data.cards.suits) ids.push(...state.decks[suit], ...state.discards[suit]);
  for (const p of state.players) {
    ids.push(...p.hand, ...p.barn);
    for (const b of p.tableau) ids.push(b.card, ...b.stack);
  }
  for (const task of state.tasks) {
    if (task.t === 'draw') ids.push(...task.revealed);
    if (task.t === 'divert') ids.push(...task.cards);
    if (task.t === 'card') {
      for (const key of ['cards', 'revealed']) {
        const held = task.riders[key];
        if (Array.isArray(held)) ids.push(...(held as string[]));
      }
    }
  }
  return ids;
}

function playFullGame(seed: string, seats: number, suits: Suit[]) {
  let state = newGame(data, { seats, suits, seed });
  const expectedCards = inPlayCardIds(state).length;
  const rng = seedRng(`policy:${seed}`);
  const moveLog: Move[] = [];
  let maxMoves = 0;

  for (let step = 0; step < 6000; step++) {
    if (isOver(state)) {
      return { state, moveLog, maxMoves };
    }
    const moves = legalMoves(data, state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThan(4000);
    maxMoves = Math.max(maxMoves, moves.length);
    const move = pickMove(rng, moves);
    state = apply(data, state, move).state;
    moveLog.push(move);
    if (step % 50 === 0) {
      const ids = inPlayCardIds(state);
      expect(ids.length).toBe(expectedCards);
      expect(new Set(ids).size).toBe(expectedCards);
    }
  }
  throw new Error(`Game ${seed} did not reach the end trigger in 6000 moves`);
}

describe('full games', () => {
  it('plays a seeded 2-player game to the Level 3 end trigger', () => {
    const { state, maxMoves } = playFullGame('game-a', 2, ['wheat', 'orchard']);
    expect(state.phase).toBe('ended');
    expect(state.endTrigger).not.toBeNull();
    // Read the level off the island, not off the receipt values: a receipt now
    // carries its fill-order bonus, so 16 is only one of the numbers a Level 3
    // delivery can be worth.
    expect(
      state.island.tiles.some((t) => tileLevel(data, t.tile) === 3 && t.deliveredBy.length > 0),
    ).toBe(true);
    expect(legalMoves(data, state)).toEqual([]);
    expect(score(data, state).ranking).toHaveLength(2);
    expect(maxMoves).toBeLessThan(4000);
  });

  it('plays a 3-player game with Vegetable in play to the end', () => {
    const { state } = playFullGame('game-b', 3, ['vegetable', 'wheat', 'apiary']);
    expect(state.phase).toBe('ended');
    expect(state.aerodrome).not.toBeNull();
  });

  it('replays (seed, move list) to a bit-identical final state', () => {
    const { state, moveLog } = playFullGame('game-c', 2, ['dairy', 'apiary']);
    let replayed = newGame(data, { seats: 2, suits: ['dairy', 'apiary'], seed: 'game-c' });
    for (const move of moveLog) replayed = apply(data, replayed, move).state;
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));
  });

  it('rejects moves legalMoves does not offer', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'illegal' });
    expect(() =>
      apply(data, state, {
        type: 'visit',
        seat: 0,
        host: 0,
        fee: ['W4'],
        payoff: { mode: 'coin' },
      }),
    ).toThrow();
    expect(() => apply(data, state, { type: 'harvest', seat: 0, building: 'W4' })).toThrow();
    expect(() => apply(data, state, { type: 'endTurn', seat: 0 })).toThrow();
    expect(() =>
      apply(data, state, { type: 'deliver', seat: 0, tile: 'A1', spend: { wheat: 2 } }),
    ).toThrow();
  });
});
