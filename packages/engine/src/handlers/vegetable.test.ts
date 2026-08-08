/**
 * Ticket 19: the Vegetable suit plus the Aerodrome module. The load-bearing
 * pieces are DL-12 (moving a balloon IS the Deliver action - one branch of the
 * main action, the Deliver Worker and every card-effect Deliver), the shared
 * afterDeliver hook (Farmstead coin, Barn freight refund, V16's island-only
 * gate) and the afterBalloonMove raid hook (V17).
 *
 * Testkit island at 2 seats (['vegetable', 'wheat']): every tile carries TWO
 * crates since the flat island, and the unshuffled pool order deals
 * A1/A2 = 2 vegetable crates each (4 veg cards), A5/B1 = 2 wheat crates,
 * B4/D1 = 2 apiary crates. Balloons all start at the centre (ruling J).
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { cardById, buildingOf, player } from '../query.js';
import type { CardId, GameState, Move, Seat, TaskAnswer } from '../state.js';
import { buildFor, dealTo, hireFor, loadStack, makeState } from '../testkit.js';
import { workOwnWorker } from '../runtime.js';
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

describe('the balloon move as the Deliver action (DL-12)', () => {
  it('offers each centre balloon at 2 differing barn cards, and applies cost + reward', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    const moves = balloonMoves(s);
    // 4 balloons x the one {vegetable: 1, wheat: 1} spend.
    expect(moves).toHaveLength(4);

    const coins = moves.find((m) => m.balloon === 'balloonCoins') as Move;
    const out = apply(data, s, coins);
    // £4 reward + £1 Vegetable Farmstead (a balloon move IS a Deliver).
    expect(player(out.state, VEG).coins).toBe(5);
    expect(player(out.state, VEG).barn).toHaveLength(0);
    expect(balloonAt(out.state, 'balloonCoins')).toBe(VEG);
    expect(out.state.discards.vegetable).toContain('V4');
    expect(out.state.discards.wheat).toContain('W4');
  });

  it('never offers two barn cards of one suit, and never your own balloon', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5'); // two vegetables - the suits must differ
    expect(balloonMoves(s)).toHaveLength(0);

    const t = base();
    barnTo(t, VEG, 'V4', 'W4');
    t.aerodrome!.balloons.forEach((b) => (b.at = VEG));
    expect(balloonMoves(t)).toHaveLength(0);
  });

  it('the red balloon draws 4 (see 4, keep 4)', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonDraw') as Move;
    const out = apply(data, s, move);
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', pid: VEG, see: 4, keep: 4 });
  });

  it('the cream balloon builds at a discount of 4: any-suit payment, coin prices waived', () => {
    const s = base();
    barnTo(s, VEG, 'V6', 'W4');
    dealTo(data, s, VEG, 'V13', 'W5'); // V13 costs 3 veg + 2 any; W5 is any-suit under the discount
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonBuild') as Move;
    const out = apply(data, s, move);
    const answers = pendingAnswers(data, out.state);
    // V13's 5 cards drop to 1, payable by the wheat card; V16 would be free (£2 waived).
    expect(answers).toContainEqual({ kind: 'build', card: 'V13', payment: ['W5'] });
    const built = answerTask(data, out.state, {
      kind: 'build',
      card: 'V13',
      payment: ['W5'],
    }).state;
    expect(buildingOf(built, VEG, 'V13')).toBeDefined();
    expect(player(built, VEG).coins).toBe(1); // the Farmstead's £1; nothing was paid
  });

  it('a £2 power card is free under the discount', () => {
    const s = base();
    barnTo(s, VEG, 'V6', 'W4');
    dealTo(data, s, VEG, 'V16');
    const move = balloonMoves(s).find((m) => m.balloon === 'balloonBuild') as Move;
    const out = apply(data, s, move);
    expect(pendingAnswers(data, out.state)).toContainEqual({
      kind: 'build',
      card: 'V16',
      payment: [],
    });
  });

  it('composes with the Deliver Worker (suit powers and freight both apply)', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'W4');
    hireFor(s, VEG, 'deliver');
    const out = workOwnWorker(data, s, VEG, 'deliver');
    const answers = pendingAnswers(data, out.state);
    expect(answers.filter((a) => a.kind === 'balloon')).toHaveLength(4);
  });
});

describe('V2 Farmstead - the deliver coin', () => {
  it('mints £1 on an island delivery, £2 upgraded, on top of the tile coins', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10');
    const out = apply(data, s, { type: 'deliver', seat: VEG, tile: 'A1', spend: { vegetable: 4 } });
    expect(player(out.state, VEG).coins).toBe(2); // £1 tile + £1 Farmstead
    expect(player(out.state, VEG).receipts).toEqual([6]); // first to A1

    const t = base();
    buildingOf(t, VEG, 'V2').upgraded = true;
    barnTo(t, VEG, 'V4', 'V5', 'V9', 'V10');
    const up = apply(data, t, { type: 'deliver', seat: VEG, tile: 'A1', spend: { vegetable: 4 } });
    expect(player(up.state, VEG).coins).toBe(3);
  });

  it('never fires for a non-vegetable deliverer', () => {
    const s = base();
    barnTo(s, WHEAT, 'W4', 'V4');
    s.turnPlayer = WHEAT;
    const out = apply(data, s, {
      type: 'moveBalloon',
      seat: WHEAT,
      balloon: 'balloonCoins',
      spend: { wheat: 1, vegetable: 1 },
    });
    expect(player(out.state, WHEAT).coins).toBe(4); // the reward only
  });
});

describe('V1 Barn - the upgraded freight refund', () => {
  it('returns one just-spent Vegetable from the discard to the barn', () => {
    const s = base();
    buildingOf(s, VEG, 'V1').upgraded = true;
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10');
    const out = apply(data, s, { type: 'deliver', seat: VEG, tile: 'A1', spend: { vegetable: 4 } });
    expect(player(out.state, VEG).barn).toHaveLength(1);
    expect(out.state.discards.vegetable).toHaveLength(3);
  });

  it('does nothing on the base face or when no Vegetable was spent', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10');
    const out = apply(data, s, { type: 'deliver', seat: VEG, tile: 'A1', spend: { vegetable: 4 } });
    expect(player(out.state, VEG).barn).toHaveLength(0);
  });
});

describe('the deliver cards', () => {
  it('V4 "Deliver." offers island and freight through one task', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'V5', 'W4');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V4', 'V6');
    const answers = pendingAnswers(data, out.state);
    expect(answers.some((a) => a.kind === 'balloon')).toBe(true);
    expect(answers.every((a) => a.kind === 'balloon' || a.kind === 'deliver')).toBe(true);
  });

  it('V5 moves a balloon at the printed cost', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    barnTo(s, VEG, 'V6', 'W4');
    dealTo(data, s, VEG, 'V7');
    const out = growBuilding(data, s, VEG, 'V5', 'V7');
    const state = answerAll(out.state, (a) => {
      const coins = a.find((x) => x.kind === 'balloon' && x.balloon === 'balloonCoins');
      return (coins ?? a[0]) as TaskAnswer;
    });
    expect(balloonAt(state, 'balloonCoins')).toBe(VEG);
    expect(player(state, VEG).barn).toHaveLength(0);
  });

  it('V6 delivers again when the delivery included a Vegetable, once, not chaining', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14');
    dealTo(data, s, VEG, 'V7');
    const out = growBuilding(data, s, VEG, 'V6', 'V7');
    // First deliver: A1 for 4 vegetables -> includes a Vegetable -> one more deliver.
    let state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    expect(state.tasks).toHaveLength(1);
    // Second deliver also spends vegetables, but "the delivery" was the first: no third.
    state = answerTask(data, state, {
      kind: 'deliver',
      tile: 'A2',
      spend: { vegetable: 4 },
    }).state;
    expect(state.tasks).toHaveLength(0);
  });

  it('V6 does not re-deliver off a vegetable-free spend', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'O4');
    dealTo(data, s, VEG, 'V7');
    const out = growBuilding(data, s, VEG, 'V6', 'V7');
    const state = answerTask(data, out.state, {
      kind: 'balloon',
      balloon: 'balloonCoins',
      spend: { wheat: 1, orchard: 1 },
    }).state;
    expect(state.tasks).toHaveLength(0);
  });

  it('V7 delivers up to twice and is skippable', () => {
    const s = base();
    buildFor(data, s, VEG, 'V7');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V7', 'V6');
    let state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    expect(pendingAnswers(data, state).some((a) => a.kind === 'skip')).toBe(true);
    state = answerTask(data, state, { kind: 'skip' }).state;
    expect(state.tasks).toHaveLength(0);
    expect(player(state, VEG).receipts).toEqual([6]); // first to A1
  });

  it('V8 prices the whole effect at £1 and runs both steps', () => {
    const broke = base();
    buildFor(data, broke, VEG, 'V8');
    dealTo(data, broke, VEG, 'V6');
    const nothing = growBuilding(data, broke, VEG, 'V8', 'V6');
    expect(nothing.state.tasks).toHaveLength(0);

    const s = base();
    buildFor(data, s, VEG, 'V8');
    player(s, VEG).coins = 1;
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10', 'W4', 'O4');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V8', 'V6');
    expect(player(out.state, VEG).coins).toBe(0);
    let state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    // "Then move a Balloon": the second task is balloon-only.
    const answers = pendingAnswers(data, state);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a.kind === 'balloon')).toBe(true);
    state = answerAll(state, (a) => a[0] as TaskAnswer);
    expect(state.aerodrome?.balloons.some((b) => b.at === VEG)).toBe(true);
  });

  it('V9 delivers then harvests a full building, even when the deliver auto-skips', () => {
    const s = base();
    buildFor(data, s, VEG, 'V9', 'V4');
    dealTo(data, s, VEG, 'V6');
    loadStack(data, s, VEG, 'V4', 4); // threshold 4 - full
    const out = growBuilding(data, s, VEG, 'V9', 'V6'); // empty barn: deliver dies
    const answers = pendingAnswers(data, out.state);
    expect(answers).toContainEqual({ kind: 'building', card: 'V4' });
    const state = answerTask(data, out.state, { kind: 'building', card: 'V4' }).state;
    expect(buildingOf(state, VEG, 'V4').stack).toHaveLength(0);
    expect(player(state, VEG).barn).toHaveLength(4);
  });

  it('V10 sows up to 2, skippable early', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10', 'V4');
    dealTo(data, s, VEG, 'V6', 'W4', 'W5');
    const out = growBuilding(data, s, VEG, 'V10', 'V6');
    let state = answerTask(data, out.state, { kind: 'sow', card: 'W4', onto: 'V4' }).state;
    expect(pendingAnswers(data, state).some((a) => a.kind === 'skip')).toBe(true);
    state = answerTask(data, state, { kind: 'skip' }).state;
    expect(state.tasks).toHaveLength(0);
  });

  it('V11 draws one per card delivered - island and freight alike', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V11', 'V6');
    const state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    expect(state.tasks[0]).toMatchObject({ t: 'draw', see: 4, keep: 4 });
  });

  it("V12 pays one Vegetable crate card with another suit ('treat as a Vegetable')", () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'W4'); // one veg short of A1's 4-veg demand
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V12', 'V6');
    const answers = pendingAnswers(data, out.state);
    const sub = answers.find((a) => a.kind === 'card');
    expect(sub).toMatchObject({
      kind: 'card',
      payload: { tile: 'A1', spend: { vegetable: 3, wheat: 1 }, sub: 'wheat' },
    });
    const state = answerTask(data, out.state, sub as TaskAnswer).state;
    expect(player(state, VEG).receipts).toEqual([6]); // first to A1
    expect(player(state, VEG).barn).toHaveLength(0);
  });

  it('V13 re-offers deliver steps inside the 4-card budget, then stops', () => {
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10', 'V11', 'V12');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V13', 'V6');
    const state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    // A tile costs 4 cards flat now, so one delivery eats the whole 4-card
    // budget and the re-offer stops after a single step.
    expect(state.tasks).toHaveLength(0);
    expect(player(state, VEG).receipts).toEqual([6]); // first to A1
  });

  it('V14 delivers once per built Depot', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14', 'V4', 'V5');
    barnTo(s, VEG, 'V6', 'V9', 'V10', 'V11', 'V12', 'V13', 'V15', 'V16');
    dealTo(data, s, VEG, 'V7');
    const out = growBuilding(data, s, VEG, 'V14', 'V7');
    expect(out.state.tasks).toHaveLength(2);
    let state = answerTask(data, out.state, {
      kind: 'deliver',
      tile: 'A1',
      spend: { vegetable: 4 },
    }).state;
    state = answerTask(data, state, { kind: 'deliver', tile: 'A2', spend: { vegetable: 4 } }).state;
    // First to BOTH tiles, so both pay the head of the schedule. Under the old
    // per-level queue the second was docked for being second to the level.
    expect(player(state, VEG).receipts).toEqual([6, 6]);
  });

  it('V15 raids one balloon from each neighbour, each raid skippable, paying per raid', () => {
    const s = base();
    buildFor(data, s, VEG, 'V15');
    s.aerodrome!.balloons.find((b) => b.id === 'balloonCoins')!.at = WHEAT;
    s.aerodrome!.balloons.find((b) => b.id === 'balloonDraw')!.at = WHEAT;
    barnTo(s, VEG, 'V4', 'W4', 'V5', 'O4');
    dealTo(data, s, VEG, 'V6');
    const out = growBuilding(data, s, VEG, 'V15', 'V6');
    expect(out.state.tasks).toHaveLength(1); // one neighbour holds balloons
    const answers = pendingAnswers(data, out.state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    // Only the neighbour's balloons are offered, never the centre's.
    expect(
      answers.every(
        (a) => a.kind === 'skip' || (a.kind === 'balloon' && a.balloon !== 'balloonSow'),
      ),
    ).toBe(true);
    const state = answerTask(data, out.state, {
      kind: 'balloon',
      balloon: 'balloonCoins',
      spend: { vegetable: 1, wheat: 1 },
    }).state;
    // One balloon from EACH neighbour: the host task is spent after one move.
    expect(state.tasks).toHaveLength(0);
    expect(balloonAt(state, 'balloonCoins')).toBe(VEG);
    expect(balloonAt(state, 'balloonDraw')).toBe(WHEAT);
  });

  it('V16 offers a free balloon move after an island delivery only', () => {
    const s = base();
    buildFor(data, s, VEG, 'V16');
    barnTo(s, VEG, 'V4', 'V5', 'V9', 'V10');
    const out = apply(data, s, { type: 'deliver', seat: VEG, tile: 'A1', spend: { vegetable: 4 } });
    expect(out.state.tasks[0]).toMatchObject({ t: 'card', kind: 'freeMove' });
    const answers = pendingAnswers(data, out.state);
    expect(answers.some((a) => a.kind === 'skip')).toBe(true);
    const free = answers.find(
      (a) => a.kind === 'card' && a.payload.balloon === 'balloonCoins',
    ) as TaskAnswer;
    const state = answerTask(data, out.state, free).state;
    expect(balloonAt(state, 'balloonCoins')).toBe(VEG);
    // £1 tile + £1 Farmstead (island) + £1 Farmstead (the free move is a Deliver too) + £4 reward.
    expect(player(state, VEG).coins).toBe(7);
    // The free move fired the ungated hook only: no second freeMove task (DL-15).
    expect(state.tasks).toHaveLength(0);
  });

  it('V16 does not fire off a balloon move', () => {
    const s = base();
    buildFor(data, s, VEG, 'V16');
    barnTo(s, VEG, 'V4', 'W4');
    const out = apply(data, s, {
      type: 'moveBalloon',
      seat: VEG,
      balloon: 'balloonCoins',
      spend: { vegetable: 1, wheat: 1 },
    });
    expect(out.state.tasks).toHaveLength(0);
  });

  it('V17 draws for the owner when a rival moves a balloon off their Aerodrome', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'V17');
    s.aerodrome!.balloons.find((b) => b.id === 'balloonCoins')!.at = WHEAT;
    barnTo(s, VEG, 'V4', 'W4');
    const out = apply(data, s, {
      type: 'moveBalloon',
      seat: VEG,
      balloon: 'balloonCoins',
      spend: { vegetable: 1, wheat: 1 },
    });
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', pid: WHEAT, see: 1, keep: 1 });
    const state = answerAll(out.state);
    expect(player(state, WHEAT).hand).toHaveLength(1);
  });

  it('V17 stays quiet for centre moves and own moves', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'V17');
    barnTo(s, VEG, 'V4', 'W4');
    const out = apply(data, s, {
      type: 'moveBalloon',
      seat: VEG,
      balloon: 'balloonCoins',
      spend: { vegetable: 1, wheat: 1 },
    });
    expect(out.state.tasks).toHaveLength(0);
  });
});

describe('the endgame cards', () => {
  it('V19 pays 5 only to the end-trigger seat', () => {
    const s = base();
    buildFor(data, s, VEG, 'V19');
    s.endTrigger = { seat: VEG };
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(5);
    s.endTrigger = { seat: WHEAT };
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(0);
  });

  it('V20 counts built Depots (V4-V8 by title keyword)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V20', 'V4', 'V5', 'V9'); // V9 is not a Depot
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(2);
    const depots = data.cards.catalogue.filter(
      (c) => c.suit === 'vegetable' && isDepotCard(data, c.id),
    );
    expect(depots.map((c) => c.id)).toEqual(['V4', 'V5', 'V6', 'V7', 'V8']);
  });

  it('V21 pays 2 per distinct barn suit', () => {
    const s = base();
    buildFor(data, s, VEG, 'V21');
    barnTo(s, VEG, 'V4', 'V5', 'W4', 'O4');
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(6);
  });
});

describe('registry and difficulty metadata', () => {
  it('every enabled Vegetable card has a handler', () => {
    const ids = data.cards.catalogue
      .filter((c) => c.suit === 'vegetable' && c.enabled)
      .map((c) => c.id);
    for (const id of ids) expect(registeredCards(), id).toContain(id);
  });

  it('derivable difficulty flags match the handler structure', () => {
    const ids = data.cards.catalogue.filter((c) => c.suit === 'vegetable').map((c) => c.id);
    for (const id of ids) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h!.difficulty.verified.endgame, id).toBe(typeof h!.gameEnd === 'function');
      expect(h!.difficulty.verified.addsMoves, id).toBe(typeof h!.moves === 'function');
    }
  });
});
