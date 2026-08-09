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
 *   3. **One delivery may take BOTH receipts** (V14): pay once, 6 + 3 = 9, and
 *      two deliveries toward the six-delivery end trigger (ruling G).
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

/** Answer pending tasks with the first legal answer until the queue drains. */
function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 64 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function balloonAt(state: GameState, id: string): Seat | 'centre' {
  const b = state.aerodrome?.balloons.find((x) => x.id === id);
  if (!b) throw new Error(`No balloon ${id}`);
  return b.at;
}

function balloonMoves(state: GameState): Extract<Move, { type: 'moveBalloon' }>[] {
  return legalMoves(data, state).filter((m) => m.type === 'moveBalloon');
}

/** The one standing move a Tier 3 ACTION card offers its owner. */
function actionMoveOf(state: GameState, card: CardId): Move | undefined {
  return legalMoves(data, state).find((m) => m.type === 'cardMove' && m.card === card);
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
    // The £4 reward alone: the rebuilt Farmstead no longer mints on a Deliver,
    // and it would not fire on a balloon anyway (it guards on `island`).
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

  it('is one card on the base face and two on the upgraded one', () => {
    for (const upgraded of [false, true]) {
      const s = base();
      buildingOf(s, VEG, 'V2').upgraded = upgraded;
      barnTo(s, VEG, 'V4', 'V5');
      dealTo(data, s, VEG, 'V9', 'V10');
      const offered = deliversTo(s, VEG, 'A1');
      // Two in the barn, two in hand, and A1 wants four: only a head of two
      // reaches it, so the base face cannot deliver here at all.
      expect(offered.length, `upgraded=${upgraded}`).toBe(upgraded ? 1 : 0);
      if (upgraded) expect(offered[0]?.head).toHaveLength(2);
    }
  });

  it('belongs to Vegetable and to nobody else', () => {
    const s = base();
    barnTo(s, WHEAT, 'W4', 'W5', 'W6');
    dealTo(data, s, WHEAT, 'W7');
    s.turnPlayer = WHEAT;
    // A5 wants 4 wheat and the Wheat seat is one short with the fourth in hand.
    expect(deliversTo(s, WHEAT, 'A5')).toHaveLength(0);
  });

  it('does NOT fire on a balloon move - that is the whole difference from the old card', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    dealTo(data, s, VEG, 'V9');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonCoins') as Move;
    const out = apply(data, s, move);
    expect(out.state.tasks.filter((t) => t.t === 'handToBarn')).toHaveLength(0);
    // And the freight branch never carries one: a balloon move is a Deliver but
    // not a Deliver to the island.
    expect(balloonMoves(s).every((m) => !('head' in m))).toBe(true);
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

  it('upgraded, also offers a barn card swapped for a deck top', () => {
    const s = base();
    buildingOf(s, VEG, 'V2').upgraded = true;
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7', 'W4');
    const out = apply(data, s, {
      type: 'deliver',
      seat: VEG,
      tile: 'A1',
      spend: { vegetable: 4 },
    });
    // The head is gone from the task queue entirely - it is part of the move
    // now - so the swap is the only thing the delivery pushes.
    const swap = out.state.tasks.find((t) => t.t === 'card' && t.kind === 'barnSwap');
    expect(swap).toBeDefined();
    const answers = pendingAnswers(data, out.state);
    expect(answers).toContainEqual({ kind: 'skip' });
    // One wheat card in the barn goes out; an orchard card comes in.
    const pick = answers.find(
      (a) => a.kind === 'card' && a.payload.gone === 'wheat' && a.payload.into === 'orchard',
    ) as TaskAnswer;
    const done = answerTask(data, out.state, pick).state;
    expect(player(done, VEG).barn).not.toContain('W4');
    expect(player(done, VEG).barn.some((id) => cardById(data, id).suit === 'orchard')).toBe(true);
    expect(done.discards.wheat).toContain('W4');
  });
});

// --- The DEPOTs -------------------------------------------------------------

describe('the hand-paid flight (V4, V8)', () => {
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

  it("V8 suppresses the moved balloon's reward and grants ANY balloon's instead", () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    dealTo(data, s, VEG, 'V9');
    const out = grow(s, VEG, 'V8', 'V11');
    const flight = pendingAnswers(data, out.state).find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonSow',
    ) as TaskAnswer;
    const moved = answerTask(data, out.state, flight).state;
    expect(balloonAt(moved, 'balloonSow')).toBe(VEG);
    // The Sow reward did NOT fire; the choice of reward is the next task.
    expect(moved.tasks[0]).toMatchObject({ t: 'card', kind: 'anyReward' });
    const rewards = pendingAnswers(data, moved);
    expect(rewards).toHaveLength(4); // any balloon in the game, the moved one included
    const coins = rewards.find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonCoins',
    ) as TaskAnswer;
    const done = answerTask(data, moved, coins).state;
    expect(player(done, VEG).coins).toBe(4);
    expect(balloonAt(done, 'balloonCoins')).toBe('centre'); // its reward, not its position
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
  it('has no legal target until somebody has delivered', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    const out = grow(s, VEG, 'V6', 'V10');
    // The timing dial: it cannot fire on turn one, so the task simply drops -
    // and the Deliver behind it drops too, on an empty barn.
    expect(out.state.tasks).toHaveLength(0);
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
    expect(answers.every((a) => a.kind === 'card' && a.payload.tile === 'A5')).toBe(true);
    const done = answerTask(data, out.state, answers[0] as TaskAnswer).state;
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

  it('V11 sows up to one card per BARN card, skippable at every step', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V6');
    barnTo(s, VEG, 'V4', 'V5');
    dealTo(data, s, VEG, 'W4', 'W5');
    const out = grow(s, VEG, 'V11', 'V10');
    expect(out.state.tasks[0]).toMatchObject({ t: 'sow', remaining: 2, optional: true });
    expect(pendingAnswers(data, out.state)).toContainEqual({ kind: 'skip' });
  });

  it('V12 puts up to one hand card into the barn per DEPOT built', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12', 'V4', 'V5', 'V9'); // V9 is not a Depot
    dealTo(data, s, VEG, 'W4', 'W5', 'W6');
    const out = grow(s, VEG, 'V12', 'V10');
    expect(out.state.tasks[0]).toMatchObject({ t: 'handToBarn', remaining: 2, optional: true });
  });

  it('V12 does nothing with no DEPOT built', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    dealTo(data, s, VEG, 'W4');
    const out = grow(s, VEG, 'V12', 'V10');
    expect(out.state.tasks).toHaveLength(0);
  });
});

// --- Tier 3, the ACTION cards -----------------------------------------------

describe('the Tier 3 ACTION cards', () => {
  it('V13 puts one deck top in the barn per DIFFERENT crop already there', () => {
    // REPOINTED 2026-08-09. It used to recolour the barn 1:1, a job the wild
    // substitution took over on 8 August; now it multiplies the barn and the
    // multiplier is its VARIETY. No choice and no task - the crop list decides
    // the decks.
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4', 'V5', 'W4'); // two crops, three cards
    const move = actionMoveOf(s, 'V13') as Move;
    expect(move).toBeDefined();
    // A hand card so the bonus slot is still live and `settleTurn` does not
    // auto-end the turn out from under the assertion: the card asks nothing, so
    // there is no task left holding the turn open.
    dealTo(data, s, VEG, 'V11');
    const out = apply(data, s, move).state;
    expect(out.turn.actionSpent).toBe(true);
    expect(out.tasks).toHaveLength(0);

    const barn = player(out, VEG)
      .barn.map((id) => cardById(data, id).suit)
      .sort();
    // One vegetable and one wheat added, nothing discarded.
    expect(barn).toEqual(['vegetable', 'vegetable', 'vegetable', 'wheat', 'wheat']);
  });

  it('V13 reads the crop list ONCE, so an arriving card cannot extend the loop', () => {
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4'); // one crop
    const out = apply(data, s, actionMoveOf(s, 'V13') as Move).state;
    expect(player(out, VEG).barn).toHaveLength(2);
  });

  it('V13 is not offered with an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V13');
    expect(actionMoveOf(s, 'V13')).toBeUndefined();
  });

  it('V14 pays once for a VIRGIN tile and takes BOTH receipts: 6 + 3', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    const move = actionMoveOf(s, 'V14') as Move;
    expect(move).toBeDefined();
    let out = apply(data, s, move).state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;

    expect(player(out, VEG).receipts).toEqual([6, 3]);
    expect(tile(out, 'A1').deliveredBy).toEqual([VEG, VEG]);
    expect(player(out, VEG).barn).toHaveLength(0); // ONE payment
    expect(player(out, VEG).coins).toBe(2); // £1 per receipt
  });

  it('V14 counts as TWO deliveries toward the end trigger (ruling G)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    // Four deliveries already banked; V14's two take the seat to six.
    deliveredAt(s, VEG, 'A2', 'A2', 'A5', 'A5');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = apply(data, s, actionMoveOf(s, 'V14') as Move).state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;
    expect(data.rules.endGame.deliveriesToTrigger).toBe(6);
    expect(out.endTrigger).toEqual({ seat: VEG });
  });

  it('V14 refuses a tile somebody has already delivered to', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    deliveredAt(s, WHEAT, 'A1');
    const out = apply(data, s, actionMoveOf(s, 'V14') as Move).state;
    for (const answer of pendingAnswers(data, out)) {
      if (answer.kind !== 'card') continue;
      expect(answer.payload.tile).not.toBe('A1');
    }
  });

  it('V15 consigns a deck top to every rival, DRAWS 1 each, then Delivers', () => {
    const s = base();
    buildFor(data, s, VEG, 'V15');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = apply(data, s, actionMoveOf(s, 'V15') as Move).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'consign', pid: VEG });
    // The ACTING seat chooses the deck; no rival is ever asked anything.
    out = answerTask(data, out, { kind: 'deck', suit: 'orchard' }).state;
    expect(player(out, WHEAT).barn).toHaveLength(1);
    expect(cardById(data, player(out, WHEAT).barn[0] as CardId).suit).toBe('orchard');
    // THE £1 BECAME A DRAW 1 on 2026-08-09: at four seats the old card handed
    // the table three barn cards, worth about 1.5 VP each, for £3 in a game that
    // ends on a median of £1. The compensation is now the scarce resource.
    expect(player(out, VEG).coins).toBe(0);
    expect(out.tasks[0]).toMatchObject({ t: 'draw', pid: VEG, see: 1, keep: 1 });
    const drawn = answerAll(out, (answers) => answers[0] as TaskAnswer);
    expect(drawn.tasks).toHaveLength(0);
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
