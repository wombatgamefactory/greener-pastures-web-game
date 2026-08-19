/**
 * The Vegetable suit, REBUILT (docs/vegetable-suit-rebuild-v4.md).
 *
 * Three things are new to the engine and they are what this file is mostly
 * about:
 *
 *   1. **The island's demand tokens are mutable** - V5 swaps two, V6 turns one
 *      face down, and a face-down token pays like a cornucopia. In 105 cards
 *      nothing else writes to the shared board, so the tests check the rule from
 *      both ends: the token moves, AND a tile that could not be paid becomes
 *      payable.
 *   2. **A balloon may be paid for out of the HAND** (V4, V8), with no suit
 *      constraint - and the BASE rule, 2 barn cards of differing crops as the
 *      Deliver action, is unchanged for everybody including a Vegetable seat.
 *   3. **One delivery may take every receipt a tile has left** (V14): pay once,
 *      6 + 3 = 9 on a virgin tile, 3 on a half-claimed one, and two deliveries
 *      toward the six-delivery end trigger (ruling G).
 *
 * A fourth thing is new as of 19/08/2026 and it is a DELETION: the Tier 3 ACTION
 * card is gone (Dean: "The concept of an ACTION was never requested. They are
 * all GROW."). V13, V14 and V15 are ordinary owner-activated buildings now, so
 * every test below drives them through `grow` rather than through
 * `apply(... cardMove ...)`, and nothing in the suit spends the main action from
 * inside a handler any more.
 *
 * Testkit island at 2 seats (['vegetable', 'wheat']): every tile carries TWO
 * crates of 2 cards, and the unshuffled pool deals A1/A2 = vegetable, A5/B1 =
 * wheat, B4/D1 = apiary. First to a tile takes 6, second 3. Balloons all start
 * at the centre (ruling J).
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { cardById, buildingOf, player } from '../query.js';
import type { CardId, GameState, Move, Seat, TaskAnswer } from '../state.js';
import { buildFor, dealTo, deliveredAt, loadStack, makeState } from '../testkit.js';
import { registeredCards, handlerFor } from './registry.js';
import { isDepotCard } from './vegetable.js';

const VEG = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['vegetable', 'wheat']);
}

/** Move specific ids from their decks into a seat's barn. */
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

function balloonAt(state: GameState, id: string): Seat | 'centre' {
  const b = state.aerodrome?.balloons.find((x) => x.id === id);
  if (!b) throw new Error(`No balloon ${id}`);
  return b.at;
}

function balloonMoves(state: GameState): Extract<Move, { type: 'moveBalloon' }>[] {
  return legalMoves(data, state).filter((m) => m.type === 'moveBalloon');
}

function tile(state: GameState, id: string) {
  const t = state.island.tiles.find((x) => x.tile === id);
  if (!t) throw new Error(`Tile ${id} is not in play`);
  return t;
}

/**
 * Activate a building, having first put a matching payment card in hand. Every
 * Vegetable deck card below activates on a `vegetable` card, so one helper
 * serves the whole suit.
 */
function grow(state: GameState, seat: Seat, building: CardId, payment: CardId) {
  dealTo(data, state, seat, payment);
  return growBuilding(data, state, seat, building, payment);
}

// --- The base rule, unchanged for everybody ---------------------------------

describe('the balloon move as the Deliver action (DL-12)', () => {
  it('still costs 2 differing BARN cards, and the base rule is untouched', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    // 4 balloons x the one {vegetable: 1, wheat: 1} spend.
    expect(balloonMoves(s)).toHaveLength(4);

    const coins = balloonMoves(s).find((m) => m.balloon === 'balloonCoins') as Move;
    const out = apply(data, s, coins);
    // The £4 reward alone: the rebuilt Farmstead no longer mints on a Deliver.
    // It DOES fire on a balloon move since 19/08/2026, but only its upgraded
    // face does anything, and this seat's Farmstead is on its base side.
    expect(player(out.state, VEG).coins).toBe(4);
    expect(player(out.state, VEG).barn).toHaveLength(0);
    expect(balloonAt(out.state, 'balloonCoins')).toBe(VEG);
    expect(out.state.discards.vegetable).toContain('V4');
    expect(out.state.discards.wheat).toContain('W4');
  });

  it('never offers two barn cards of one suit, and never your own balloon', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5'); // two vegetables - the barn payment must differ
    expect(balloonMoves(s)).toHaveLength(0);

    const t = base();
    barnTo(t, VEG, 'V4', 'W4');
    t.aerodrome?.balloons.forEach((b) => (b.at = VEG));
    expect(balloonMoves(t)).toHaveLength(0);
  });

  it('the red balloon draws 4 (see 4, keep 4)', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonDraw') as Move;
    const out = apply(data, s, move);
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', pid: VEG, see: 4, keep: 4 });
  });
});

// --- The starters -----------------------------------------------------------

describe('V1 Barn - the DEPOT build refund', () => {
  it('draws 2 when its owner builds a DEPOT, on BOTH faces', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, VEG, 'V1').upgraded = upgraded;
      dealTo(data, s, VEG, 'V4', 'V5'); // V4 costs 1 vegetable; V5 pays for it
      const out = apply(data, s, { type: 'build', seat: VEG, card: 'V4', payment: ['V5'] });
      expect(out.state.tasks[0], `upgraded=${upgraded}`).toMatchObject({
        t: 'draw',
        pid: VEG,
        see: 2,
        keep: 2,
      });
    }
  });

  it("does not fire on a non-DEPOT build, or on a rival's DEPOT", () => {
    const s = base();
    dealTo(data, s, VEG, 'V9', 'V4', 'V5', 'V6'); // V9 The Merchant Guild is no Depot
    const out = apply(data, s, {
      type: 'build',
      seat: VEG,
      card: 'V9',
      payment: ['V4', 'V5', 'V6'],
    });
    expect(out.state.tasks.filter((t) => t.t === 'draw')).toHaveLength(0);

    // A rival building a Depot is a Depot built, but not YOUR Depot.
    const t = base();
    t.turnPlayer = WHEAT;
    dealTo(data, t, WHEAT, 'V4', 'V5');
    const rival = apply(data, t, { type: 'build', seat: WHEAT, card: 'V4', payment: ['V5'] });
    expect(rival.state.tasks.filter((x) => x.t === 'draw' && x.pid === VEG)).toHaveLength(0);
  });

  it('prints hand size 5 base and 7 upgraded', () => {
    const faces = cardById(data, 'V1').faces;
    expect(faces?.starter.handSize).toBe(5);
    expect(faces?.upgraded.handSize).toBe(7);
  });
});

describe('V2 Farmstead - the head, loaded BEFORE the payment', () => {
  /** Deliver moves offered to a seat, for a tile. */
  function deliversTo(state: GameState, seat: Seat, tile: string) {
    return legalMoves(data, state).filter(
      (m) => m.type === 'deliver' && m.seat === seat && m.tile === tile,
    ) as Extract<Move, { type: 'deliver' }>[];
  }

  it('makes a tile payable that the barn alone cannot pay', () => {
    const s = base();
    // A1 wants 4 vegetable. Three in the barn is one short, and the fourth is
    // in hand - which is exactly the position the word "first" exists for.
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    dealTo(data, s, VEG, 'V9');
    const offered = deliversTo(s, VEG, 'A1');
    expect(offered).toHaveLength(1);
    expect(offered[0]?.head).toEqual(['V9']);

    const done = apply(data, s, offered[0] as Move).state;
    expect(player(done, VEG).hand).toHaveLength(0);
    expect(player(done, VEG).barn).toHaveLength(0); // all four spent
    expect(player(done, VEG).receipts).toEqual([6]);
  });

  it('is never offered for a payment the barn already covers', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    dealTo(data, s, VEG, 'V9');
    // Loading a card you are not about to spend is the same move as loading it
    // on your next delivery instead, so the head is pruned where it buys
    // nothing. The plain payment is still there.
    const offered = deliversTo(s, VEG, 'A1');
    expect(offered.some((m) => m.head === undefined)).toBe(true);
    expect(offered.filter((m) => m.head !== undefined)).toHaveLength(0);
  });

  it('is exactly ONE hand card on the base face', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    dealTo(data, s, VEG, 'V9', 'V10');
    const offered = deliversTo(s, VEG, 'A1');
    // Three in the barn is one short of A1's four; one hand card closes it and a
    // second would buy nothing, so exactly one head is offered.
    expect(offered).toHaveLength(1);
    expect(offered[0]?.head).toHaveLength(1);
  });

  /**
   * ⚠️ SKIPPED, AND THE REASON IS A FILE THIS PASS DOES NOT OWN.
   *
   * The 19/08/2026 retext re-points the UPGRADED face from "put 1 card from your
   * hand into your barn, and you may swap 1 barn card for the top card of any
   * deck" to "you may first put 1 DECK card into your barn". The two faces are
   * alternatives read literally off the printed text: base loads a hand card,
   * upgraded loads a deck card. So the upgraded face should offer NO hand head
   * at all.
   *
   * `deliverHeadSize` in actions.ts still returns 2 on the upgraded face, which
   * is the OLD card, and actions.ts belongs to the shared-engine slice of this
   * pass. Un-skip this the moment it returns 0 upgraded (and 1 on the base face,
   * which is already right).
   */
  /**
   * ⚠️ The flip changes the head's SOURCE, not its size: a hand card becomes a
   * DECK card. That makes it a real trade rather than a straight upgrade - the
   * hand card is chosen and the deck card is not, but the deck card costs
   * nothing off the master clock - and it is why `deliverHeadSize` returns 0 on
   * this face. Leaving it at the old `upgraded ? 2 : 1` was the one bug this
   * rewrite could have shipped in silence: the flipped face would have taken two
   * hand cards AND a deck card, three cards of head on a card printing one.
   */
  it('the upgraded face loads NO hand card - the source moved to the deck', () => {
    const s = base();
    buildingOf(s, VEG, 'V2').upgraded = true;
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    dealTo(data, s, VEG, 'V9', 'V10');
    // Three in the barn is one short of A1's four. The hand cannot close it on
    // this face, however many vegetable cards are sitting in it...
    const offered = deliversTo(s, VEG, 'A1');
    expect(offered.every((m) => m.head === undefined)).toBe(true);
    // ...and the deck head is the only thing that can.
    expect(offered.every((m) => m.deckHead !== undefined)).toBe(true);
    expect(offered.length).toBeGreaterThan(0);
  });

  it('belongs to Vegetable and to nobody else', () => {
    const s = base();
    barnTo(s, WHEAT, 'W4', 'W5', 'W6');
    dealTo(data, s, WHEAT, 'W7');
    s.turnPlayer = WHEAT;
    // A5 wants 4 wheat and the Wheat seat is one short with the fourth in hand.
    expect(deliversTo(s, WHEAT, 'A5')).toHaveLength(0);
  });

  /**
   * The structural half of the 19/08/2026 change: the card went from "When you
   * Deliver to the island" to "When you Deliver", and a balloon move IS the
   * Deliver action (DL-12).
   *
   * It is asserted on the ENUMERATION and not on a hook, because that is where
   * the whole of the card's value lives. A flight costs 2 barn cards of
   * differing crops; one barn card plus the head is what makes it payable, and a
   * head that arrives after the payment could not have paid for it.
   */
  it('FIRES ON A BALLOON MOVE NOW - the trigger widened on 19/08/2026', () => {
    const upgraded = base();
    buildingOf(upgraded, VEG, 'V2').upgraded = true;
    barnTo(upgraded, VEG, 'V4'); // one crop in the barn: a flight needs two
    expect(balloonMoves(upgraded).some((m) => m.deckHead !== undefined)).toBe(true);
    // ...and the head is what unlocks it: no head, no flight.
    expect(balloonMoves(upgraded).some((m) => m.deckHead === undefined)).toBe(false);
  });

  /**
   * ⚠️ SKIPPED for the same reason as the head-size test above: the freight
   * branch is enumerated by `balloonMoveOptions` in actions.ts, which carries no
   * head. "When you Deliver" is one trigger, so once the deck head lands
   * upstream BOTH faces have to be offered their head on a flight as well as on
   * an island claim, or the widening only half arrives.
   */
  it('a balloon move carries the BASE face head too', () => {
    const s = base();
    barnTo(s, VEG, 'V4');
    dealTo(data, s, VEG, 'W4');
    // One barn card and one hand card: the flight needs two of differing crops
    // and the head is what makes it payable.
    const withHead = balloonMoves(s).filter((m) => m.head !== undefined);
    expect(withHead.length).toBeGreaterThan(0);
    const out = apply(data, s, withHead[0] as Move);
    // The hand card was loaded FIRST and then spent on the flight, so it is in
    // neither the hand nor the barn afterwards.
    expect(player(out.state, VEG).hand).toHaveLength(0);
    expect(player(out.state, VEG).barn).toHaveLength(0);
  });

  it('mints no coins at all, on either face', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, VEG, 'V2').upgraded = upgraded;
      barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
      const out = apply(data, s, {
        type: 'deliver',
        seat: VEG,
        tile: 'A1',
        spend: { vegetable: 4 },
      });
      // £1 from the tile and not a penny more: the old "gain £1 / £2" minted on
      // a solitaire action, which the coin rule forbids.
      expect(player(out.state, VEG).coins, `upgraded=${upgraded}`).toBe(1);
    }
  });

  it('upgraded, puts one DECK card of your choice into the barn FIRST', () => {
    const s = base();
    buildingOf(s, VEG, 'V2').upgraded = true;
    // A1 wants 4 vegetable. Three in the barn is one short, the hand cannot help
    // on this face, and the deck head is the only thing that closes the gap.
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    expect(deliversTo(s, VEG, 'A1').filter((m) => m.deckHead === undefined)).toHaveLength(0);

    const offered = deliversTo(s, VEG, 'A1').filter((m) => m.deckHead !== undefined);
    // One option per DECK, not per card: barn identity is inert, so the crop is
    // the whole of the choice, and only the vegetable deck can pay this tile.
    expect(offered.map((m) => m.deckHead)).toEqual(['vegetable']);

    const out = apply(data, s, offered[0] as Move);
    // THE BARN SWAP IS GONE. The upgrade used to read "and you may swap 1 barn
    // card for the top card of any deck", a recolouring power the wild
    // substitution took over on 8 August; what is left is a straight deposit.
    expect(out.state.tasks.some((t) => t.t === 'card' && t.kind === 'barnSwap')).toBe(false);
    // ⚠️ And it is NOT a task: a task would resolve after the payment, and a
    // card that arrives after the payment cannot help make it. The head is
    // enumerated upstream in actions.ts precisely so "first" means first.
    expect(out.state.tasks.some((t) => t.t === 'card' && t.kind === 'deckToBarn')).toBe(false);
    // Four vegetable spent, and the barn is empty: three of its own plus the one
    // the deck head put there.
    expect(player(out.state, VEG).barn).toHaveLength(0);
    expect(tile(out.state, 'A1').deliveredBy).toContain(VEG);
  });

  it('the BASE face pushes no deposit task - its card comes out of the hand', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    const out = apply(data, s, {
      type: 'deliver',
      seat: VEG,
      tile: 'A1',
      spend: { vegetable: 4 },
    });
    expect(out.state.tasks.some((t) => t.t === 'card' && t.kind === 'deckToBarn')).toBe(false);
  });
});

// --- The DEPOTs -------------------------------------------------------------

describe('the hand-paid flight (V4)', () => {
  it('V4 discards 1 hand card of ANY crop and takes the reward', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    // handMoveCost went 2 -> 1 on 2026-08-09: at 2 the printed route cost three
    // hand cards all in (the Grow's matching card plus two discards) against the
    // base rule's two barn cards, so it was a surcharge and went unused.
    dealTo(data, s, VEG, 'V9'); // no differing-suit rule on the hand route
    const out = grow(s, VEG, 'V4', 'V11');
    const answers = pendingAnswers(data, out.state);
    const pick = answers.find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonCoins',
    ) as TaskAnswer;
    expect(pick).toBeDefined();
    const done = answerTask(data, out.state, pick).state;
    expect(balloonAt(done, 'balloonCoins')).toBe(VEG);
    expect(player(done, VEG).hand).toHaveLength(0);
    expect(player(done, VEG).barn).toHaveLength(0); // the barn is untouched
    expect(player(done, VEG).coins).toBe(4);
    expect(done.discards.vegetable).toEqual(expect.arrayContaining(['V9']));
  });

  it('V4 auto-skips on an empty hand', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    // `grow` deals the payment and nothing else, so the hand is empty by the
    // time the flight asks for its fee.
    const out = grow(s, VEG, 'V4', 'V11');
    expect(out.state.tasks).toHaveLength(0);
  });
});

describe('V8 The Regional Depot - the FREE flight (retexted 19/08/2026)', () => {
  it("costs nothing at all and takes the moved balloon's OWN reward", () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    // No fee: the "Discard 1 card" clause is gone, so an empty hand and an empty
    // barn are both fine. `grow` deals the payment card and it goes straight
    // onto V8's own stack, so the hand is empty when the flight resolves.
    const out = grow(s, VEG, 'V8', 'V11');
    const answers = pendingAnswers(data, out.state);
    expect(answers).toHaveLength(4); // one per balloon, all at the centre

    const pick = answers.find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonCoins',
    ) as TaskAnswer;
    const done = answerTask(data, out.state, pick).state;
    expect(balloonAt(done, 'balloonCoins')).toBe(VEG);
    expect(player(done, VEG).coins).toBe(4);
    expect(player(done, VEG).hand).toHaveLength(0);
    expect(player(done, VEG).barn).toHaveLength(0);
    expect(done.discards.vegetable).not.toContain('V9');
  });

  it('no longer chooses a reward - "any Balloon" narrowed to "its"', () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    const out = grow(s, VEG, 'V8', 'V11');
    const flight = pendingAnswers(data, out.state).find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonDraw',
    ) as TaskAnswer;
    const moved = answerTask(data, out.state, flight).state;
    expect(balloonAt(moved, 'balloonDraw')).toBe(VEG);
    // The red balloon's OWN reward fires immediately. There is no anyReward task
    // any more, and with it goes the only thing in the game that severed
    // reachability from cargo: you get the reward of the balloon you could reach.
    expect(moved.tasks.some((t) => t.t === 'card' && t.kind === 'anyReward')).toBe(false);
    expect(moved.tasks[0]).toMatchObject({ t: 'draw', pid: VEG, see: 4, keep: 4 });
  });

  it('never offers a balloon already at your own Aerodrome', () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    s.aerodrome?.balloons.forEach((b) => (b.at = VEG));
    const out = grow(s, VEG, 'V8', 'V11');
    // Nothing to move, so the drain loop drops the task rather than wedging.
    expect(out.state.tasks).toHaveLength(0);
  });
});

describe('V5 The Coastal Trading Depot - SWAP two demand tokens', () => {
  it('makes an unpayable tile payable, and is skippable', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    // A barn of 4 vegetables can pay A1 (2 veg crates) but never A5 (2 wheat).
    barnTo(s, VEG, 'V4', 'V6', 'V7', 'V9');
    const out = grow(s, VEG, 'V5', 'V10');
    const answers = pendingAnswers(data, out.state);
    expect(answers).toContainEqual({ kind: 'skip' });

    // Swap A5's first wheat token for A1's first vegetable token.
    const pick = answers.find((a) => {
      if (a.kind !== 'card') return false;
      const { a: x, b: y } = a.payload as { a: { tile: string }; b: { tile: string } };
      return (x.tile === 'A1' && y.tile === 'A5') || (x.tile === 'A5' && y.tile === 'A1');
    }) as TaskAnswer;
    expect(pick).toBeDefined();
    const done = answerTask(data, out.state, pick).state;
    expect(tile(done, 'A1').crates.sort()).toEqual(['vegetable', 'wheat']);
    expect(tile(done, 'A5').crates.sort()).toEqual(['vegetable', 'wheat']);
  });

  it('never offers a pair of identical tokens - a no-op swap is not a choice', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    const out = grow(s, VEG, 'V5', 'V10');
    for (const answer of pendingAnswers(data, out.state)) {
      if (answer.kind !== 'card') continue;
      const { a, b } = answer.payload as {
        a: { tile: string; crate: number };
        b: { tile: string; crate: number };
      };
      expect(tile(out.state, a.tile).crates[a.crate]).not.toBe(
        tile(out.state, b.tile).crates[b.crate],
      );
    }
  });

  it('never touches a tile whose receipts are both taken', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    deliveredAt(s, WHEAT, 'A1', 'A1'); // A1 is finished
    const out = grow(s, VEG, 'V5', 'V10');
    for (const answer of pendingAnswers(data, out.state)) {
      if (answer.kind !== 'card') continue;
      const { a, b } = answer.payload as { a: { tile: string }; b: { tile: string } };
      expect([a.tile, b.tile]).not.toContain('A1');
    }
  });
});

describe('V6 The Trade Depot - turn a demand token FACE DOWN', () => {
  it('IS LIVE FROM TURN ONE now - the eligibility filter is gone', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    const out = grow(s, VEG, 'V6', 'V10');
    // The old text was "a demand token on a tile where a receipt has already
    // been taken", which was the TIMING DIAL: on turn one no tile had a receipt,
    // so the task dropped and the card was inert. The sheet dropped the clause
    // on 19/08/2026, so every open tile is a target from the first turn.
    expect(out.state.tasks[0]).toMatchObject({ t: 'card', kind: 'faceDown', pid: VEG });
    const answers = pendingAnswers(data, out.state);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a.kind === 'card')).toBe(true);
  });

  it('targets a VIRGIN tile, which the old text could never do', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    const out = grow(s, VEG, 'V6', 'V10');
    const virgin = new Set(
      out.state.island.tiles.filter((t) => t.deliveredBy.length === 0).map((t) => t.tile),
    );
    const answers = pendingAnswers(data, out.state);
    expect(answers.some((a) => a.kind === 'card' && virgin.has(a.payload.tile as string))).toBe(
      true,
    );
  });

  it('opens a half-run tile, and a face-down token then pays like a cornucopia', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    deliveredAt(s, WHEAT, 'A5'); // A5 (2 wheat crates) has one receipt taken
    // A5 wants 4 wheat. Two wheat and two vegetables cannot pay it: the two
    // unmatched wheat cost 2 cards each under the substitution, and there are
    // only two spare. The parity trap in miniature.
    barnTo(s, VEG, 'V4', 'V7', 'W4', 'W5');
    const before = legalMoves(data, s).filter((m) => m.type === 'deliver' && m.tile === 'A5');
    expect(before).toHaveLength(0);

    const out = grow(s, VEG, 'V6', 'V10');
    const answers = pendingAnswers(data, out.state);
    // A5 is no longer the ONLY target - the eligibility filter went on
    // 19/08/2026 and every open tile is offered now - so the test names it.
    const pick = answers.find((a) => a.kind === 'card' && a.payload.tile === 'A5') as TaskAnswer;
    expect(pick).toBeDefined();
    const done = answerTask(data, out.state, pick).state;
    expect(tile(done, 'A5').faceDown).toContain(true);
    // "THEN DELIVER" (2026-08-09): opening the crate and filling it is one
    // action now, so the delivery is queued behind the face-down and sees the
    // island it just changed. One crate takes any 2 cards, so the same barn
    // pays A5 exactly.
    expect(done.tasks[0]).toMatchObject({ t: 'deliver', pid: VEG });
    expect(pendingAnswers(data, done)).toContainEqual({
      kind: 'deliver',
      tile: 'A5',
      spend: { wheat: 2, vegetable: 2 },
    });
  });

  it('never targets a cornucopia, an already-blank token, or a finished tile', () => {
    // The three exclusions that SURVIVED the retext: turning a cornucopia or an
    // already-blank token buys nothing, and a tile with both receipts taken is
    // never re-priced retrospectively.
    const s = makeState(data, ['vegetable', 'wheat', 'orchard']);
    buildFor(data, s, VEG, 'V6');
    deliveredAt(s, WHEAT, 'C3'); // C3 is the pair of cornucopias
    deliveredAt(s, WHEAT, 'A1', 'A1'); // A1 is finished
    const out = grow(s, VEG, 'V6', 'V10');
    for (const answer of pendingAnswers(data, out.state)) {
      if (answer.kind !== 'card') continue;
      expect(answer.payload.tile).not.toBe('C3');
      expect(answer.payload.tile).not.toBe('A1');
    }
  });
});

describe('V7 The Export Depot - harvest, then Deliver', () => {
  it('harvests a FULL building of yours and then offers the full Deliver', () => {
    const s = base();
    buildFor(data, s, VEG, 'V7', 'V4');
    loadStack(data, s, VEG, 'V4', 2); // V4's threshold is 2, filled off the deck top
    barnTo(s, VEG, 'V11', 'V12');
    const out = grow(s, VEG, 'V7', 'V13');
    expect(out.state.tasks[0]).toMatchObject({ t: 'chooseBuilding', filter: 'full' });
    const harvested = answerTask(data, out.state, {
      kind: 'building',
      card: 'V4',
    }).state;
    expect(player(harvested, VEG).barn).toHaveLength(4);
    // The harvest lands BEFORE the delivery enumerates, so its cards can pay.
    expect(harvested.tasks[0]).toMatchObject({ t: 'deliver' });
    expect(pendingAnswers(data, harvested).some((a) => a.kind === 'deliver')).toBe(true);
  });

  it('the strict full gate: a partly-loaded building is not a target', () => {
    const s = base();
    buildFor(data, s, VEG, 'V7', 'V6'); // V6's threshold is 3
    loadStack(data, s, VEG, 'V6', 2);
    const out = grow(s, VEG, 'V7', 'V10');
    const building = out.state.tasks.find((t) => t.t === 'chooseBuilding');
    // No full building anywhere, so the harvest task drops and the Deliver runs.
    expect(building).toBeUndefined();
  });
});

// --- Tier 2 -----------------------------------------------------------------

describe('the Tier 2 counters', () => {
  it('V9 draws 2 and loads 1, flat, whatever the barn holds', () => {
    // DE-SCALED 2026-08-09: it used to read "Draw 1 for each different crop in
    // your barn" and fired 0.0 times a game, because the median barn is 2. The
    // replacement is flat and upstream and can never read zero.
    for (const barn of [[], ['V4', 'V5', 'V6', 'W4', 'O4']] as CardId[][]) {
      const s = base();
      buildFor(data, s, VEG, 'V9');
      barnTo(s, VEG, ...barn);
      const out = grow(s, VEG, 'V9', 'V10');
      expect(out.state.tasks[0], `barn=${barn.length}`).toMatchObject({
        t: 'draw',
        see: 2,
        keep: 2,
      });
      expect(out.state.tasks[1]).toMatchObject({ t: 'handToBarn', pid: VEG, remaining: 1 });
    }
  });

  it('V10 draws 1 per receipt taken, and is dead before the first delivery', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    const dead = grow(s, VEG, 'V10', 'V11');
    expect(dead.state.tasks).toHaveLength(0);

    const t = base();
    buildFor(data, t, VEG, 'V10');
    deliveredAt(t, VEG, 'A1', 'A2', 'A5');
    const out = grow(t, VEG, 'V10', 'V11');
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3 });
  });

  it('V11 sows one card per BARN card and it is MANDATORY (19/08/2026)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V6');
    barnTo(s, VEG, 'V4', 'V5');
    dealTo(data, s, VEG, 'W4', 'W5');
    const out = grow(s, VEG, 'V11', 'V10');
    // "SOW up to 1 ... for each card in your barn" lost its "up to" and Dean has
    // ruled that a deliberate power-up, so `optional` is off and no skip answer
    // is ever offered. You sow, and the only choice left is what goes where.
    expect(out.state.tasks[0]).toMatchObject({ t: 'sow', remaining: 2 });
    expect(out.state.tasks[0]).not.toHaveProperty('optional');
    expect(pendingAnswers(data, out.state)).not.toContainEqual({ kind: 'skip' });
  });

  it('V11 skips silently with no legal target (the §8.3 no-op convention)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11');
    barnTo(s, VEG, 'V4');
    // `grow` deals the payment card and it goes straight onto V11's own stack,
    // so the hand is empty when the sow asks for a card. The drain loop drops
    // the task: the activation is never refused and never wedges.
    const out = grow(s, VEG, 'V11', 'V10');
    expect(out.state.tasks).toHaveLength(0);
  });

  it('V12 puts one hand card into the barn per DEPOT built, MANDATORY', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12', 'V4', 'V5', 'V9'); // V9 is not a Depot
    dealTo(data, s, VEG, 'W4', 'W5', 'W6');
    const out = grow(s, VEG, 'V12', 'V10');
    expect(out.state.tasks[0]).toMatchObject({ t: 'handToBarn', remaining: 2 });
    expect(out.state.tasks[0]).not.toHaveProperty('optional');
    expect(pendingAnswers(data, out.state)).not.toContainEqual({ kind: 'skip' });
  });

  it('V12 does nothing with no DEPOT built, and skips silently on an empty hand', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    dealTo(data, s, VEG, 'W4');
    // No Depot: the zero-budget guard catches it before a task is ever pushed.
    expect(grow(s, VEG, 'V12', 'V10').state.tasks).toHaveLength(0);

    // A Depot but no cards: same observable outcome, one step later - the task
    // is pushed, enumerates nothing and is dropped by the drain loop.
    const t = base();
    buildFor(data, t, VEG, 'V12', 'V4');
    expect(grow(t, VEG, 'V12', 'V10').state.tasks).toHaveLength(0);
  });
});

// --- Tier 3, now ordinary GROW buildings ------------------------------------

/**
 * THE ACTION CARD LEFT THE GAME ON 19/08/2026 (Dean: "The concept of an ACTION
 * was never requested. They are all GROW."). Every test in here used to drive
 * its card through `apply(... cardMove ...)`, which spent the main action from
 * inside the handler; they now go through `grow`, which pays one card of any
 * crop into the building's own stack and fires `activate`. The sheet gives all
 * three threshold 1 and a wild activation type, so they clog after a single
 * card and cost a harvest to reuse.
 */
describe('the Tier 3 cards (converted from ACTION to GROW)', () => {
  it('V13 puts one deck top in the barn per DIFFERENT crop already there', () => {
    // REPOINTED 2026-08-09. It used to recolour the barn 1:1, a job the wild
    // substitution took over on 8 August; now it multiplies the barn and the
    // multiplier is its VARIETY. No choice and no task - the crop list decides
    // the decks. The 19/08/2026 conversion left the effect untouched: V13 is the
    // pure GROW conversion of the three, with no retext behind it.
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4', 'V5', 'W4'); // two crops, three cards
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(out.tasks).toHaveLength(0);

    const barn = player(out, VEG)
      .barn.map((id) => cardById(data, id).suit)
      .sort();
    // One vegetable and one wheat added, nothing discarded.
    expect(barn).toEqual(['vegetable', 'vegetable', 'vegetable', 'wheat', 'wheat']);
    // And the payment card is on the building, not in the barn: a GROW costs a
    // card as well as the action, which the ACTION shape never did.
    expect(buildingOf(out, VEG, 'V13').stack).toEqual(['V11']);
  });

  it('V13 reads the crop list ONCE, so an arriving card cannot extend the loop', () => {
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4'); // one crop
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(player(out, VEG).barn).toHaveLength(2);
  });

  it('V13 on an EMPTY barn is legal now and simply does nothing', () => {
    // The old standing move gated itself on "cropsToRefill > 0" and was not
    // offered at all. A GROW has no such gate - you may always pay a card into a
    // stack - so this is legal, does nothing, and advances the threshold. Not
    // worth a guard, but it is a behaviour change worth pinning.
    const s = base();
    buildFor(data, s, VEG, 'V13');
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(player(out, VEG).barn).toHaveLength(0);
    expect(out.tasks).toHaveLength(0);
    expect(buildingOf(out, VEG, 'V13').stack).toEqual(['V11']);
  });

  it('V14 pays once for a VIRGIN tile and sweeps BOTH receipts: 6 + 3', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;

    expect(player(out, VEG).receipts).toEqual([6, 3]);
    expect(tile(out, 'A1').deliveredBy).toEqual([VEG, VEG]);
    expect(player(out, VEG).barn).toHaveLength(0); // ONE payment
    expect(player(out, VEG).coins).toBe(2); // one coin per receipt
  });

  it('V14 takes ONE receipt from a half-claimed tile (Dean, 19/08/2026)', () => {
    // "Deliver and take every receipt on the island" is ruled as: whatever
    // receipts REMAIN ON THAT TILE. Two if nobody has delivered there, one if
    // somebody has - not "every receipt on the island", and not always "both".
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    deliveredAt(s, WHEAT, 'A1'); // A1 has one receipt left
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    expect(pick).toBeDefined();
    out = answerTask(data, out, pick).state;

    expect(player(out, VEG).receipts).toEqual([3]); // the second-deliverer rate
    expect(tile(out, 'A1').deliveredBy).toEqual([WHEAT, VEG]);
    expect(player(out, VEG).coins).toBe(1);
  });

  it('V14 OFFERS a tile somebody has already delivered to - the virgin gate is gone', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    deliveredAt(s, WHEAT, 'A1');
    const out = grow(s, VEG, 'V14', 'V11').state;
    const tiles = pendingAnswers(data, out)
      .filter((a) => a.kind === 'card')
      .map((a) => (a.kind === 'card' ? a.payload.tile : undefined));
    expect(tiles).toContain('A1');
  });

  it('V14 counts as TWO deliveries toward the end trigger (ruling G)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    // Four deliveries already banked; V14's two take the seat to six.
    deliveredAt(s, VEG, 'A2', 'A2', 'A5', 'A5');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;
    expect(data.rules.endGame.deliveriesToTrigger).toBe(6);
    expect(out.endTrigger).toEqual({ seat: VEG });
  });

  it('V15 is TWO separate Delivers, each paid and targeted on its own', () => {
    // "Deliver Twice" (19/08/2026). The cross-table consignment - a deck top
    // into every rival's barn, Draw 1 for each - is deleted outright, and with
    // it Vegetable's only card that put something on somebody else's side of
    // the table outside V16.
    const s = base();
    buildFor(data, s, VEG, 'V15');
    // Eight vegetables: enough for A1 and A2, which are two vegetable crates each.
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7', 'V9', 'V10', 'V11', 'V12');
    let out = grow(s, VEG, 'V15', 'V13').state;
    expect(out.tasks.filter((t) => t.t === 'deliver')).toHaveLength(2);
    expect(out.tasks.some((t) => t.t === 'card' && t.kind === 'consign')).toBe(false);

    const first = pendingAnswers(data, out).find(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, first).state;
    // The SECOND deliver enumerates against the barn the first one left, which
    // is why this is two tasks and not one task with a budget of 2.
    expect(out.tasks[0]).toMatchObject({ t: 'deliver', pid: VEG });
    const second = pendingAnswers(data, out).find(
      (a) => a.kind === 'deliver' && a.tile === 'A2',
    ) as TaskAnswer;
    out = answerTask(data, out, second).state;

    expect(player(out, VEG).receipts).toEqual([6, 6]); // one receipt each, two tiles
    expect(player(out, VEG).barn).toHaveLength(0);
    // Nothing crossed the table.
    expect(player(out, WHEAT).barn).toHaveLength(0);
    expect(player(out, WHEAT).hand).toHaveLength(0);
  });

  it('V15 takes the one delivery it can afford and drops the other', () => {
    const s = base();
    buildFor(data, s, VEG, 'V15');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7'); // exactly one tile's worth
    let out = grow(s, VEG, 'V15', 'V13').state;
    const first = pendingAnswers(data, out).find(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, first).state;
    // Mandatory as printed, but the drain loop drops a deliver task with no
    // payable answer - the section 8.3 convention, applied here for free.
    expect(out.tasks).toHaveLength(0);
    expect(player(out, VEG).receipts).toEqual([6]);
  });
});

// --- The Powers and the Endgame cards ---------------------------------------

describe('the Aerodrome Powers', () => {
  it('V16 pays its owner £2 when a NEIGHBOUR takes a balloon from their Aerodrome', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'V16');
    s.aerodrome?.balloons.forEach((b) => (b.at = WHEAT));
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonSow') as Move;
    const out = apply(data, s, move);
    expect(player(out.state, WHEAT).coins).toBe(2);
  });

  it("V16 never fires on its owner's own flight", () => {
    const s = base();
    buildFor(data, s, VEG, 'V16');
    s.aerodrome?.balloons.forEach((b) => (b.at = WHEAT));
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonSow') as Move;
    const out = apply(data, s, move);
    expect(player(out.state, VEG).coins).toBe(0);
  });

  it('V17 draws 1 whenever its owner moves a balloon, by EITHER route', () => {
    // The barn-paid Deliver action.
    const s = base();
    buildFor(data, s, VEG, 'V17');
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonSow') as Move;
    expect(apply(data, s, move).state.tasks[0]).toMatchObject({
      t: 'draw',
      pid: VEG,
      see: 1,
      keep: 1,
    });

    // And the hand-paid Depot flight, which is what makes the card load-bearing.
    const t = base();
    buildFor(data, t, VEG, 'V17', 'V4');
    dealTo(data, t, VEG, 'V9', 'V10');
    const grown = grow(t, VEG, 'V4', 'V11');
    const pick = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonSow',
    ) as TaskAnswer;
    const flown = answerTask(data, grown.state, pick).state;
    expect(flown.tasks.some((x) => x.t === 'draw' && x.pid === VEG)).toBe(true);
  });

  it("V17 does not fire on a rival's flight", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'V17');
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonSow') as Move;
    const out = apply(data, s, move);
    expect(out.state.tasks.filter((t) => t.t === 'draw' && t.pid === WHEAT)).toHaveLength(0);
  });
});

describe('the endgame cards', () => {
  it('V19 pays 2 per balloon parked at your Aerodrome', () => {
    const s = base();
    buildFor(data, s, VEG, 'V19');
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(0);
    s.aerodrome?.balloons.forEach((b, i) => (b.at = i < 3 ? VEG : WHEAT));
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(6);
  });

  it('V20 pays 2 per built DEPOT (V4-V8 by title keyword)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V20', 'V4', 'V5', 'V9'); // V9 is not a Depot
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(4);
    const depots = data.cards.catalogue.filter(
      (c) => c.suit === 'vegetable' && isDepotCard(data, c.id),
    );
    expect(depots.map((c) => c.id)).toEqual(['V4', 'V5', 'V6', 'V7', 'V8']);
  });

  it('V21 pays 1 per 2 cards in the barn, rounded down', () => {
    const s = base();
    buildFor(data, s, VEG, 'V21');
    barnTo(s, VEG, 'V4', 'V5', 'W4', 'O4', 'A4');
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(2);
  });
});

describe('difficulty metadata stays honest across the suit', () => {
  const VEG_IDS = Array.from({ length: 21 }, (_, i) => `V${i + 1}`) as CardId[];

  it('every Vegetable card has a handler with structurally-true flags', () => {
    for (const id of VEG_IDS) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h?.difficulty.verified.endgame, id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, id).toBe(typeof h?.moves === 'function');
    }
  });

  it('THE ACTION CARD IS GONE: no Vegetable handler declares actionMoves', () => {
    // 19/08/2026. V13, V14 and V15 were the three that did. If this ever goes
    // red, something has re-introduced a card whose standing move IS the main
    // action - which is the concept Dean retired.
    // ⛔ The property is GONE from CardHandler, so this reads the object rather
    // than the type: `in` is what still fails loudly if someone puts it back.
    for (const id of VEG_IDS) {
      expect('actionMoves' in (handlerFor(id) as object), id).toBe(false);
    }
    // The Tier 3 trio also lose their move pair outright. V18 The Helping Hand
    // keeps its `moves` / `applyMove` and always did: a standing move that is
    // NOT the main action is a different thing and was never an ACTION card.
    for (const id of ['V13', 'V14', 'V15'] as CardId[]) {
      expect(handlerFor(id)?.moves, id).toBeUndefined();
      expect(handlerFor(id)?.applyMove, id).toBeUndefined();
    }
  });

  it('the three Tier 3 cards print a threshold and a wild activation type', () => {
    // The sheet is what makes them growable; the handlers only supply `activate`.
    for (const id of ['V13', 'V14', 'V15'] as CardId[]) {
      const card = cardById(data, id);
      expect(card.threshold, id).toBe(1);
      expect(card.activationType, id).toBe('wild');
      expect(card.abilityTrigger, id).toEqual(['onActivate']);
      expect(handlerFor(id)?.activate, id).toBeTypeOf('function');
    }
  });
});

describe('registry coverage', () => {
  it('every enabled Vegetable card has a handler', () => {
    const registered = new Set(registeredCards());
    for (const card of data.cards.catalogue) {
      if (card.suit !== 'vegetable' || !card.enabled) continue;
      expect(registered.has(card.id), `${card.id} has no handler`).toBe(true);
      expect(handlerFor(card.id)).toBeDefined();
    }
  });
});
