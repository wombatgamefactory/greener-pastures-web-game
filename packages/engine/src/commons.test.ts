/**
 * THE COMMONS (`rules.turn.visitCurrency: 'commons'`), Dean 09/09/2026,
 * docs/commons-handoff-2026-09-09-v1.md, rules C1-C10 and defaults D1-D5.
 *
 * ⭐ THE MODE IS THE SHIPPED DEFAULT, so this file runs on `BASE_GAME_DATA` and
 * never on an overlay - which is the mirror image of `meeple-loop.test.ts`,
 * written when the meeple loop was an arm. The first case asserts the default IS
 * the commons, so that a data pass which has not landed fails ONE legible case
 * rather than forty confusing ones.
 *
 * The last two blocks assert the CONTROLS from the other side: the v31 card
 * visit and the v1 meeple loop still play their own games, with no commons zone
 * anywhere in them and a Notice Board in every tableau. "The flag is where I
 * think it is" is a claim worth failing on, and those two branches are not dead
 * code - they are the baseline every commons delta will be read against.
 */

import { BASE_GAME_DATA, isCommons, loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { describe, expect, it } from 'vitest';

import {
  bonusDrawOpen,
  buildOptions,
  collectOptions,
  commonsOptions,
  commonsTakeOptions,
  growOptions,
  harvestOptions,
  meepleOptions,
  visitOptions,
} from './actions.js';
import { apply, isOver, legalMoves, newGame } from './game.js';
import { commonsBoardCard, commonsBoards, player } from './query.js';
import { rngInt, seedRng } from './rng.js';
import { gameEndScores } from './runtime.js';
import type { CardId, GameState, Move, Seat } from './state.js';
import { buildFor, dealTo, loadStack, makeState } from './testkit.js';
import { viewFor } from './view.js';

const data: GameData = BASE_GAME_DATA;

const WHEAT: Seat = 0;
const ORCHARD: Seat = 1;

/** The v31 card-fee game, as `overlays/v31-card-visit.overlay.json` sets it. */
const cardControl: GameData = loadGameData({
  name: 'v31-card-visit',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'card',
    'rules.turn.bonusTiming': 'end',
    'rules.turn.startingMeeplesPerColour': 1,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
    // ⛔ THE BOARD'S OWN THRESHOLD, PINNED SINCE 10/09/2026. The
    // notice-board visit moved the BASE value from 2 to 3 (S8's `3+`), and
    // under `'card'` the Notice Board is a BLOCKING building whose 2 is the
    // brake on the self-visit. The overlay file pins the same leaf.
    'rules.economy.noticeBoardThreshold': 2,
  },
});

/** The v1 meeple loop, as `overlays/meeple-loop-v1.overlay.json` sets it. */
const meepleControl: GameData = loadGameData({
  name: 'meeple-loop-v1',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'meeple',
    'rules.turn.bonusTiming': 'end',
    'rules.turn.startingMeeplesPerColour': 1,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
  },
});

/**
 * A 2-seat position with the bonus window OPEN.
 *
 * ⭐ NOTHING HAS TO BE SPENT TO OPEN IT, which is C2 in one line: `bonusTiming`
 * is 'start' under the commons, so the slot is open from the top of the turn and
 * SHUTS when the action is taken. That is the reverse of the meeple loop's
 * fixture, which had to spend the action first.
 */
function position(suits: Suit[] = ['wheat', 'orchard']): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = WHEAT;
  return s;
}

/** Answer whatever tasks are pending, taking the first legal answer each time. */
function settle(state: GameState, on: GameData = data): GameState {
  let out = state;
  for (let guard = 0; guard < 60 && out.tasks.length > 0; guard++) {
    const move = legalMoves(on, out)[0];
    if (!move) break;
    out = apply(on, out, move).state;
  }
  return out;
}

/** Put cards straight onto a central pile, off their own decks (C1: the pile is just cards). */
function seedPile(state: GameState, board: Suit, ...cards: CardId[]): void {
  const pile = commonsBoards(state)[board];
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

function play(seat: Seat, board: Suit, fee: CardId): Move {
  return { type: 'commons', seat, board, fee };
}

/** Dean's variant (09/09/2026): take the whole of one central pile to hand. */
function take(seat: Seat, board: Suit): Move {
  return { type: 'commonsTake', seat, board };
}

/** Dean's 'paid' variant (09/09/2026): the same take, with a required fee. */
function takePaid(seat: Seat, board: Suit, fee: CardId): Move {
  return { type: 'commonsTake', seat, board, fee };
}

describe('the commons is the shipped game', () => {
  /**
   * ⚠️ THE ONE CASE THAT SAYS WHICH GAME THIS FILE IS ABOUT. The data pass of
   * 09/09/2026 flips `rules.json`; if it has not landed, this fails here and
   * everything below fails for a reason that is not its own.
   */
  it('is the default, bonus first, and no starting meeples (C1, C2, C6)', () => {
    expect(isCommons(data)).toBe(true);
    expect(data.rules.turn.bonusTiming).toBe('start');
    expect(data.rules.turn.startingMeeplesPerColour).toBe(0);
  });
});

describe('setup (C1, C6)', () => {
  it('stands all five boards in the centre, empty, whatever suits are in play', () => {
    const s = newGame(data, {
      seats: 2,
      suits: ['wheat', 'orchard'],
      neutralSuits: ['vegetable'],
      seed: 'commons-setup',
    });
    const boards = commonsBoards(s);
    expect(Object.keys(boards).sort()).toEqual([...data.cards.suits].sort());
    for (const colour of data.cards.suits) expect(boards[colour], colour).toEqual([]);
    // C1's whole point: the dairy board is there for a table with no Dairy seat.
    expect(s.suitsInPlay).not.toContain('dairy');
    expect(boards['dairy']).toEqual([]);
  });

  it('deals no Notice Board into any tableau: a farm is Farmstead plus Barn', () => {
    const s = newGame(data, { seats: 4, seed: 'commons-tableaux' });
    for (const p of s.players) {
      expect(p.tableau).toHaveLength(2);
      for (const b of p.tableau) {
        expect(data.cards.catalogue.find((c) => c.id === b.card)?.slot).not.toBe('noticeboard');
      }
    }
  });

  it('has no meeple anywhere: none held, none on the island (C6)', () => {
    const s = newGame(data, { seats: 3, seed: 'commons-meeples' });
    for (const p of s.players) {
      for (const colour of data.cards.suits) expect(p.meeples[colour], colour).toBe(0);
      expect(Object.hasOwn(p, 'noticeBoard')).toBe(false);
    }
    for (const tile of s.island.tiles) expect(tile.meeples).toEqual([]);
  });

  it('offers no meeple spend, no Collect and no free Draw 1 (C6, C9)', () => {
    const s = position();
    expect(meepleOptions(data, s, WHEAT)).toEqual([]);
    expect(collectOptions(data, s, WHEAT)).toEqual([]);
    expect(bonusDrawOpen(data, s)).toBe(false);
    expect(visitOptions(data, s, WHEAT)).toEqual([]);
  });

  it('shows the central piles to everybody: they are face up and public', () => {
    const s = position();
    seedPile(s, 'wheat', 'W7');
    for (const seat of [WHEAT, ORCHARD]) {
      expect(viewFor(data, s, seat).commons?.boards['wheat']).toEqual(['W7']);
    }
  });
});

describe('the play (C3)', () => {
  it('takes the fee out of the hand, onto the chosen pile, and runs the action', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7');
    const out = apply(data, s, play(WHEAT, 'orchard', 'W7'));
    expect(player(out.state, WHEAT).hand).not.toContain('W7');
    expect(commonsBoards(out.state)['orchard']).toEqual(['W7']);
    // Any card onto any board: a Wheat card is a perfectly good orchard fee.
    expect(out.events.some((e) => e.e === 'commonsPlayed' && e.board === 'orchard')).toBe(true);
    // ⭐ THE ACTION IS THE PLAIN Draw 2 (C3, Dean's choice over Draw 3).
    const task = out.state.tasks[0];
    expect(task?.t).toBe('draw');
    expect(task?.t === 'draw' ? task.see : 0).toBe(2);
    expect(
      out.events.some((e) => e.e === 'doorUsed' && e.via === 'commons' && e.colour === 'orchard'),
    ).toBe(true);
  });

  it('reports the pile size after the card lands', () => {
    const s = position();
    seedPile(s, 'wheat', 'W7');
    dealTo(data, s, WHEAT, 'W8');
    const out = apply(data, s, play(WHEAT, 'wheat', 'W8'));
    const played = out.events.find((e) => e.e === 'commonsPlayed');
    expect(played?.e === 'commonsPlayed' ? played.pileSize : 0).toBe(2);
  });

  it('offers every card in hand on every board whose action is legal', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7', 'W8', 'O4');
    const fees = commonsOptions(data, s, WHEAT)
      .filter((m) => m.board === 'orchard')
      .map((m) => m.fee)
      .sort();
    expect(fees).toEqual(['O4', 'W7', 'W8']);
  });

  it('does not offer a board whose action can do nothing right now', () => {
    // No barn, no balloons (Vegetable is not at the table), so Deliver is dead.
    const s = position();
    dealTo(data, s, WHEAT, 'W7');
    expect(s.aerodrome).toBeNull();
    expect(commonsOptions(data, s, WHEAT).some((m) => m.board === 'vegetable')).toBe(false);
    // And the apiary board is dead too: a GROW needs a building with a printed
    // activation type, and a bare farm has only its two starters.
    expect(commonsOptions(data, s, WHEAT).some((m) => m.board === 'apiary')).toBe(false);
  });

  it('is offered before the main action and shut after it (C2)', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7');
    expect(commonsOptions(data, s, WHEAT).length).toBeGreaterThan(0);
    s.turn.actionSpent = true;
    expect(commonsOptions(data, s, WHEAT)).toEqual([]);
    expect(legalMoves(data, s).some((m) => m.type === 'commons')).toBe(false);
  });

  it('spends the bonus slot and not the action', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7');
    const out = apply(data, s, play(WHEAT, 'orchard', 'W7'));
    expect(out.state.turn.bonusUsed).toEqual(['commons']);
    expect(out.state.turn.actionSpent).toBe(false);
  });

  it('buys a GROW through the apiary board, paying the activation card as well (C3)', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W4');
    dealTo(data, s, WHEAT, 'W7', 'W8');
    expect(commonsOptions(data, s, WHEAT).some((m) => m.board === 'apiary')).toBe(true);
    const out = apply(data, s, play(WHEAT, 'apiary', 'W7'));
    const task = out.state.tasks[0];
    expect(task?.t).toBe('grow');
    const answers = legalMoves(data, out.state);
    // The fee has left the hand and cannot also pay the activation.
    expect(
      answers.every(
        (m) => m.type !== 'task' || m.answer.kind !== 'grow' || m.answer.payment !== 'W7',
      ),
    ).toBe(true);
    const done = settle(out.state);
    const field = player(done, WHEAT).tableau.find((b) => b.card === 'W4');
    expect(field?.stack).toEqual(['W8']);
  });

  it('never bypasses a clog: a full building is not a GROW target through the board', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W4');
    loadStack(data, s, WHEAT, 'W4', 2);
    dealTo(data, s, WHEAT, 'W7', 'W8');
    // W4's threshold is 2, so it is full: the apiary board has nothing to grow.
    expect(commonsOptions(data, s, WHEAT).some((m) => m.board === 'apiary')).toBe(false);
  });
});

describe('Harvest (C5, D1, D2, D3)', () => {
  it('still takes your own full building', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W4');
    loadStack(data, s, WHEAT, 'W4', 2);
    expect(harvestOptions(data, s, WHEAT)).toContain('W4');
  });

  it('takes any non-empty central pile, into the HARVESTER s barn', () => {
    const s = position();
    seedPile(s, 'dairy', 'D4', 'D5');
    const board = commonsBoardCard(data, 'dairy');
    expect(harvestOptions(data, s, WHEAT)).toContain(board);
    const out = apply(data, s, { type: 'harvest', seat: WHEAT, building: board });
    expect(player(out.state, WHEAT).barn).toEqual(['D4', 'D5']);
    expect(commonsBoards(out.state)['dairy']).toEqual([]);
    const harvested = out.events.find((e) => e.e === 'harvested');
    expect(harvested?.e === 'harvested' ? harvested.source : null).toBe('commons');
    expect(harvested?.e === 'harvested' ? harvested.owner : 0).toBeNull();
    // D3: to the barn, never to a discard.
    expect(out.state.discards['dairy']).toEqual([]);
  });

  it('offers an empty pile to nobody', () => {
    const s = position();
    expect(harvestOptions(data, s, WHEAT)).toEqual([]);
  });

  it('makes the pile you just fed harvestable in the same turn (C5)', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7');
    // The wheat board buys a Harvest, and its own fee is the thing to harvest.
    const out = apply(data, s, play(WHEAT, 'wheat', 'W7'));
    expect(commonsBoards(out.state)['wheat']).toEqual(['W7']);
    const task = out.state.tasks[0];
    expect(task?.t).toBe('chooseBuilding');
    const targets = legalMoves(data, out.state)
      .filter((m) => m.type === 'task' && m.answer.kind === 'building')
      .map((m) => (m.type === 'task' && m.answer.kind === 'building' ? m.answer.card : ''));
    expect(targets).toContain(commonsBoardCard(data, 'wheat'));
    const done = settle(out.state);
    expect(player(done, WHEAT).barn).toContain('W7');
  });

  it('reaches the centre through the wheat board even with a full building of your own', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W4');
    loadStack(data, s, WHEAT, 'W4', 2);
    seedPile(s, 'orchard', 'O4');
    dealTo(data, s, WHEAT, 'W7');
    const out = apply(data, s, play(WHEAT, 'wheat', 'W7'));
    const targets = legalMoves(data, out.state)
      .filter((m) => m.type === 'task' && m.answer.kind === 'building')
      .map((m) => (m.type === 'task' && m.answer.kind === 'building' ? m.answer.card : ''));
    expect(targets).toContain('W4');
    expect(targets).toContain(commonsBoardCard(data, 'wheat'));
    expect(targets).toContain(commonsBoardCard(data, 'orchard'));
  });

  it('fires afterHarvest on a central pile, so Wheat s riders still pay (D1)', () => {
    // W16 draws 1 on any harvest of its owner's, whatever was harvested.
    const s = position();
    buildFor(data, s, WHEAT, 'W16');
    seedPile(s, 'dairy', 'D4');
    const before = player(s, WHEAT).hand.length;
    const applied = apply(data, s, {
      type: 'harvest',
      seat: WHEAT,
      building: commonsBoardCard(data, 'dairy'),
    });
    // ⚠️ READ THE GUARD BEFORE THE DRAW DRAINS. Harvest is the MAIN action, so
    // once its draw task is answered the turn settles and `freshTurn` clears
    // `firedThisTurn` - the same trap `meeple-loop.test.ts` documents.
    expect(applied.state.turn.firedThisTurn).toContain('W16');
    const out = settle(applied.state);
    expect(player(out, WHEAT).hand.length).toBe(before + 1);
  });
});

describe('A Helping Hand (C8)', () => {
  it('buys a SECOND play in one turn, and never a third', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W18');
    seedPile(s, 'wheat', 'W9');
    dealTo(data, s, WHEAT, 'W7', 'W8', 'W10');
    let state = settle(apply(data, s, play(WHEAT, 'wheat', 'W7')).state);
    expect(state.turn.bonusUsed).toEqual(['commons']);
    expect(commonsOptions(data, state, WHEAT).length).toBeGreaterThan(0);
    state = settle(apply(data, state, play(WHEAT, 'wheat', 'W8')).state);
    expect(state.turn.bonusUsed).toEqual(['commons', 'commons']);
    expect(commonsOptions(data, state, WHEAT)).toEqual([]);
    expect(() => apply(data, state, play(WHEAT, 'wheat', 'W10'))).toThrow();
  });

  it('grants only one extra play without the card', () => {
    const s = position();
    dealTo(data, s, WHEAT, 'W7', 'W8');
    const state = settle(apply(data, s, play(WHEAT, 'wheat', 'W7')).state);
    expect(commonsOptions(data, state, WHEAT)).toEqual([]);
  });
});

describe('the four visit-keyed cards (C8)', () => {
  it('fires O16 The Fruit Store on a play: it draws its owner a card', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'O16');
    dealTo(data, s, WHEAT, 'W7');
    const before = player(s, WHEAT).hand.length;
    const out = apply(data, s, play(WHEAT, 'wheat', 'W7'));
    // One card out as the fee, one back from O16's autoDraw.
    expect(player(out.state, WHEAT).hand.length).toBe(before);
  });

  it('fires A17 The Smoke Pot on a play', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'A17');
    dealTo(data, s, WHEAT, 'W7');
    const out = apply(data, s, play(WHEAT, 'wheat', 'W7'));
    expect(out.state.tasks.some((t) => 'src' in t && t.src === 'A17')).toBe(true);
  });

  it('never fires W17 The Pie Shop: a central board has no host', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'W17');
    dealTo(data, s, WHEAT, 'W7');
    const out = settle(apply(data, s, play(WHEAT, 'wheat', 'W7')).state);
    expect(out.turn.firedThisTurn).not.toContain('W17');
  });

  it('never fires A16 The Beekeeper s Veil: a play is not a placement', () => {
    const s = position();
    buildFor(data, s, WHEAT, 'A16');
    seedPile(s, 'wheat', 'W9');
    dealTo(data, s, WHEAT, 'W7');
    // The pile reaches exactly 2, which is the stack size A16 keys on.
    const out = apply(data, s, play(WHEAT, 'wheat', 'W7'));
    expect(out.events.some((e) => e.e === 'cardPlaced')).toBe(false);
    expect(out.state.tasks.some((t) => 'src' in t && t.src === 'A16')).toBe(false);
  });

  it('makes A21 The Wax Hall blind to the centre', () => {
    const empty = position();
    buildFor(data, empty, WHEAT, 'A21');
    const before = gameEndScores(data, empty)[WHEAT]?.endgame;
    const fed = position();
    buildFor(data, fed, WHEAT, 'A21');
    seedPile(fed, 'wheat', 'W9');
    seedPile(fed, 'dairy', 'D4');
    expect(gameEndScores(data, fed)[WHEAT]?.endgame).toBe(before);
  });
});

describe('the two fallback knobs (C10)', () => {
  const capped: GameData = loadGameData({
    name: 'commons-threshold-2',
    schemaVersion: 1,
    set: { 'rules.economy.commonsThreshold': 2 },
  });

  const matched: GameData = loadGameData({
    name: 'commons-colour-match-v1',
    schemaVersion: 1,
    set: { 'rules.economy.commonsColourMatch': true },
  });

  it('refuses a board at its threshold', () => {
    const s = makeState(capped, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'wheat', 'W9', 'W10');
    dealTo(capped, s, WHEAT, 'W7');
    expect(commonsOptions(capped, s, WHEAT).some((m) => m.board === 'wheat')).toBe(false);
    expect(commonsOptions(capped, s, WHEAT).some((m) => m.board === 'orchard')).toBe(true);
    expect(() => apply(capped, s, play(WHEAT, 'wheat', 'W7'))).toThrow();
  });

  it('refuses a fee of the wrong colour under colour matching', () => {
    const s = makeState(matched, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    dealTo(matched, s, WHEAT, 'W7', 'O4');
    const boards = commonsOptions(matched, s, WHEAT);
    expect(boards.some((m) => m.board === 'wheat' && m.fee === 'W7')).toBe(true);
    expect(boards.some((m) => m.board === 'wheat' && m.fee === 'O4')).toBe(false);
    expect(boards.some((m) => m.board === 'orchard' && m.fee === 'O4')).toBe(true);
    expect(() => apply(matched, s, play(WHEAT, 'wheat', 'O4'))).toThrow();
  });
});

/**
 * ⭐ DEAN'S QUESTION OF 09/09/2026: "Can we measure how many cards are taken
 * when the Harvest is done against the centre cards? I'm interested to see if we
 * place a threshold on the centre cards if it will reduce the number of cards
 * going from the centre to the barns - my target is about 30-40% of barn cards
 * should come from the middle."
 *
 * `commonsThreshold` was the first answer and it measured nothing at 2 (63.1%
 * against 63.0%), so the other two threshold SEMANTICS are knobs too: a minimum
 * depth before a pile may be taken at all (the building semantic), and a cap on
 * how many come out (the only one that can leave cards in the centre).
 *
 * ⚠️ BOTH SHIP null, AND THE SHIPPED BEHAVIOUR IS ASSERTED BY EVERY CASE
 * ABOVE, not by a case of its own: the Harvest block runs on `BASE_GAME_DATA`
 * and would fail if either knob's null path were not the C5 rule exactly.
 */
describe('the two harvest knobs (Dean, 09/09/2026)', () => {
  const min3: GameData = loadGameData({
    name: 'commons-harvest-min-3',
    schemaVersion: 1,
    set: { 'rules.economy.commonsHarvestMin': 3 },
  });

  const take2: GameData = loadGameData({
    name: 'commons-take-2',
    schemaVersion: 1,
    set: { 'rules.economy.commonsHarvestTake': 2 },
  });

  it('refuses a pile below the minimum and accepts it at the minimum', () => {
    const s = makeState(min3, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    const board = commonsBoardCard(min3, 'dairy');
    seedPile(s, 'dairy', 'D4', 'D5');
    expect(harvestOptions(min3, s, WHEAT)).not.toContain(board);
    expect(() => apply(min3, s, { type: 'harvest', seat: WHEAT, building: board })).toThrow();
    seedPile(s, 'dairy', 'D6');
    expect(harvestOptions(min3, s, WHEAT)).toContain(board);
    const out = apply(min3, s, { type: 'harvest', seat: WHEAT, building: board });
    expect(player(out.state, WHEAT).barn).toEqual(['D4', 'D5', 'D6']);
  });

  it('takes the most recent N and leaves the rest standing', () => {
    const s = makeState(take2, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    const board = commonsBoardCard(take2, 'dairy');
    seedPile(s, 'dairy', 'D4', 'D5', 'D6', 'D7');
    const out = apply(take2, s, { type: 'harvest', seat: WHEAT, building: board });
    // The top of the pile is its end, because a play pushes.
    expect(player(out.state, WHEAT).barn).toEqual(['D6', 'D7']);
    expect(commonsBoards(out.state)['dairy']).toEqual(['D4', 'D5']);
    const harvested = out.events.find((e) => e.e === 'harvested');
    expect(harvested?.e === 'harvested' ? harvested.cards : []).toEqual(['D6', 'D7']);
    expect(harvested?.e === 'harvested' ? harvested.left : null).toBe(2);
  });

  /**
   * The decision the brief did not settle, recorded as a case rather than as a
   * sentence: n CAPS the take and never demands a depth, so a pile shallower
   * than n gives up all of it. `commonsHarvestMin` is the knob that demands a
   * depth, and the two are independent on purpose.
   */
  it('takes the whole of a pile shallower than N', () => {
    const s = makeState(take2, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    const board = commonsBoardCard(take2, 'dairy');
    seedPile(s, 'dairy', 'D4');
    const out = apply(take2, s, { type: 'harvest', seat: WHEAT, building: board });
    expect(player(out.state, WHEAT).barn).toEqual(['D4']);
    expect(commonsBoards(out.state)['dairy']).toEqual([]);
  });

  /**
   * ⛔ D6 STOPS HOLDING, which is the one behaviour change the minimum makes
   * that nothing else in the game makes. The wheat board is offered only when
   * the fee lands on a pile that REACHES the minimum, or some other pile
   * already has, or the seat has a full building of its own.
   */
  it('stops offering the wheat board when no pile can reach the minimum', () => {
    const s = makeState(min3, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    dealTo(min3, s, WHEAT, 'W7');
    expect(commonsOptions(min3, s, WHEAT).some((m) => m.board === 'wheat')).toBe(false);
    // Two already on the wheat pile: the fee makes it three, so the board is
    // offered again. The fee counts onto the pile it is played on and no other.
    seedPile(s, 'wheat', 'W9', 'W10');
    expect(commonsOptions(min3, s, WHEAT).some((m) => m.board === 'wheat')).toBe(true);
  });

  it('offers the wheat board when some OTHER pile is already deep enough', () => {
    const s = makeState(min3, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5', 'D6');
    dealTo(min3, s, WHEAT, 'W7');
    expect(commonsOptions(min3, s, WHEAT).some((m) => m.board === 'wheat')).toBe(true);
  });

  it('offers the wheat board on a full building of your own, whatever the centre holds', () => {
    const s = makeState(min3, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    buildFor(min3, s, WHEAT, 'W4');
    loadStack(min3, s, WHEAT, 'W4', 2);
    dealTo(min3, s, WHEAT, 'W7');
    expect(commonsOptions(min3, s, WHEAT).some((m) => m.board === 'wheat')).toBe(true);
  });
});

/**
 * ⭐ DEAN'S VARIANT (09/09/2026, `rules.turn.commonsTake: 'bonus'`),
 * `overlays/commons-take-to-hand-v1.overlay.json`: "Your bonus action can be
 * to place 1 card in the centre [and take that board's action], OR take all
 * the cards on one pile (without playing a card). If you take the pile of
 * cards, instead of going into the barn, they go into your HAND. So we
 * remove the rule that a harvest takes the cards from one central card.
 * Effectively we change the bonus action into a draw instead of a harvest."
 */
describe("Dean's variant: commonsTake 'bonus' (09/09/2026)", () => {
  const takeToHand: GameData = loadGameData({
    name: 'commons-take-to-hand-v1',
    schemaVersion: 1,
    set: { 'rules.turn.commonsTake': 'bonus' },
  });

  it('never offers a central board to Harvest', () => {
    const s = makeState(takeToHand, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    const board = commonsBoardCard(takeToHand, 'dairy');
    expect(harvestOptions(takeToHand, s, WHEAT)).not.toContain(board);
    expect(() => apply(takeToHand, s, { type: 'harvest', seat: WHEAT, building: board })).toThrow();
  });

  it('moves the whole pile to hand and uses the bonus, buying no action', () => {
    const s = makeState(takeToHand, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    const before = player(s, WHEAT).hand.length;
    const out = apply(takeToHand, s, take(WHEAT, 'dairy'));
    expect(player(out.state, WHEAT).hand.length).toBe(before + 2);
    expect(player(out.state, WHEAT).hand).toEqual(expect.arrayContaining(['D4', 'D5']));
    expect(commonsBoards(out.state)['dairy']).toEqual([]);
    expect(player(out.state, WHEAT).barn).toEqual([]);
    expect(out.state.turn.bonusUsed).toEqual(['commonsTake']);
    expect(out.state.turn.actionSpent).toBe(false);
    const taken = out.events.find((e) => e.e === 'commonsTaken');
    expect(taken?.e === 'commonsTaken' ? taken.board : null).toBe('dairy');
    expect(taken?.e === 'commonsTaken' ? taken.cards : []).toEqual(['D4', 'D5']);
    // No fee, no door action: no card left any hand and no door ran.
    expect(out.events.some((e) => e.e === 'commonsPlayed')).toBe(false);
    expect(out.events.some((e) => e.e === 'doorUsed')).toBe(false);
    expect(out.events.some((e) => e.e === 'harvested')).toBe(false);
  });

  it('is not offered on an empty pile', () => {
    const s = makeState(takeToHand, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    expect(commonsTakeOptions(takeToHand, s, WHEAT).some((m) => m.board === 'dairy')).toBe(false);
    expect(() =>
      apply(takeToHand, s, { type: 'commonsTake', seat: WHEAT, board: 'dairy' }),
    ).toThrow();
  });

  it('lets play and take share a turn only with A Helping Hand, never without it', () => {
    const bare = makeState(takeToHand, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    seedPile(bare, 'dairy', 'D4');
    dealTo(takeToHand, bare, WHEAT, 'W7');
    const afterPlay = settle(apply(takeToHand, bare, play(WHEAT, 'orchard', 'W7')).state);
    expect(commonsTakeOptions(takeToHand, afterPlay, WHEAT)).toEqual([]);
    expect(() => apply(takeToHand, afterPlay, take(WHEAT, 'dairy'))).toThrow();

    const helped = makeState(takeToHand, ['wheat', 'orchard']);
    helped.turnPlayer = WHEAT;
    buildFor(takeToHand, helped, WHEAT, 'W18');
    seedPile(helped, 'dairy', 'D4');
    dealTo(takeToHand, helped, WHEAT, 'W7');
    const afterHelpedPlay = settle(apply(takeToHand, helped, play(WHEAT, 'orchard', 'W7')).state);
    expect(commonsTakeOptions(takeToHand, afterHelpedPlay, WHEAT).length).toBeGreaterThan(0);
    const afterTake = apply(takeToHand, afterHelpedPlay, take(WHEAT, 'dairy'));
    expect(afterTake.state.turn.bonusUsed).toEqual(['commons', 'commonsTake']);
    // Never a third, whichever order the two arrive in.
    expect(commonsOptions(takeToHand, afterTake.state, WHEAT)).toEqual([]);
    expect(commonsTakeOptions(takeToHand, afterTake.state, WHEAT)).toEqual([]);
  });

  it('offers the wheat board only on a full building of your own (D6 does not hold)', () => {
    const bare = makeState(takeToHand, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    seedPile(bare, 'wheat', 'W9', 'W10');
    dealTo(takeToHand, bare, WHEAT, 'W7');
    expect(commonsOptions(takeToHand, bare, WHEAT).some((m) => m.board === 'wheat')).toBe(false);

    const full = makeState(takeToHand, ['wheat', 'orchard']);
    full.turnPlayer = WHEAT;
    buildFor(takeToHand, full, WHEAT, 'W4');
    loadStack(takeToHand, full, WHEAT, 'W4', 2);
    dealTo(takeToHand, full, WHEAT, 'W7');
    expect(commonsOptions(takeToHand, full, WHEAT).some((m) => m.board === 'wheat')).toBe(true);
  });

  it('enumerates nothing under the shipped default', () => {
    const s = position();
    seedPile(s, 'dairy', 'D4', 'D5');
    expect(commonsTakeOptions(data, s, WHEAT)).toEqual([]);
    expect(legalMoves(data, s).some((m) => m.type === 'commonsTake')).toBe(false);
    expect(() => apply(data, s, { type: 'commonsTake', seat: WHEAT, board: 'dairy' })).toThrow();
  });
});

/**
 * ⭐ DEAN'S 'spend' VARIANT (09/09/2026, `rules.turn.commonsTake: 'spend'`),
 * `overlays/commons-take-to-spend-v1.overlay.json`: "You can play a card to a
 * centre card to do the bonus action. OR, you can take all the cards from a
 * central pile and then use those cards to pay for a bonus action of the
 * matching type. So, if you take all the cards from the Draw card, they go
 * into your hand. All the cards on the Harvest go into your barn. All the
 * cards on the Build action can be spent to do a Build. All the cards on the
 * Deliver action can immediately be used to deliver. All the cards on the
 * Grow action are used to SOW. Any cards that cannot be used are discarded."
 *
 * REUSES THE SAME `commonsTake` MOVE AS 'bonus'; the resolution differs by
 * board (D-S1 to D-S4 - see the overlay's own description).
 */
describe("Dean's variant: commonsTake 'spend' (09/09/2026)", () => {
  const spend: GameData = loadGameData({
    name: 'commons-take-to-spend-v1',
    schemaVersion: 1,
    set: { 'rules.turn.commonsTake': 'spend' },
  });

  it('never offers a central board to Harvest (D-S4)', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    const board = commonsBoardCard(spend, 'dairy');
    expect(harvestOptions(spend, s, WHEAT)).not.toContain(board);
    expect(() => apply(spend, s, { type: 'harvest', seat: WHEAT, building: board })).toThrow();
  });

  it('orchard: the whole pile moves to hand, exactly as under bonus', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'orchard', 'O4', 'O5');
    const before = player(s, WHEAT).hand.length;
    const out = apply(spend, s, take(WHEAT, 'orchard'));
    expect(player(out.state, WHEAT).hand.length).toBe(before + 2);
    expect(player(out.state, WHEAT).hand).toEqual(expect.arrayContaining(['O4', 'O5']));
    expect(commonsBoards(out.state)['orchard']).toEqual([]);
    expect(out.state.turn.bonusUsed).toEqual(['commonsTake']);
    const taken = out.events.find((e) => e.e === 'commonsTaken');
    expect(taken?.e === 'commonsTaken' ? taken.cards : []).toEqual(['O4', 'O5']);
    const spent = out.events.find((e) => e.e === 'commonsSpent');
    expect(spent).toMatchObject({
      e: 'commonsSpent',
      board: 'orchard',
      taken: 2,
      used: 2,
      discarded: 0,
      deliveredFromCentre: false,
    });
  });

  it('wheat: the whole pile moves to the BARN, never to hand, and fires no afterHarvest', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'wheat', 'W9', 'W10');
    const handBefore = player(s, WHEAT).hand.length;
    const out = apply(spend, s, take(WHEAT, 'wheat'));
    expect(player(out.state, WHEAT).hand.length).toBe(handBefore);
    expect(player(out.state, WHEAT).barn).toEqual(expect.arrayContaining(['W9', 'W10']));
    expect(commonsBoards(out.state)['wheat']).toEqual([]);
    expect(out.events.some((e) => e.e === 'harvested')).toBe(false);
    const spent = out.events.find((e) => e.e === 'commonsSpent');
    expect(spent).toMatchObject({
      e: 'commonsSpent',
      board: 'wheat',
      taken: 2,
      used: 2,
      discarded: 0,
      deliveredFromCentre: false,
    });
  });

  it('dairy: builds one card paid from the pile only, discards the excess (D-S1, D-S2)', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    dealTo(spend, s, WHEAT, 'D4'); // costs 1 dairy card, nothing else
    seedPile(s, 'dairy', 'D8', 'D9', 'D10'); // three dairy-suit cards, only one needed
    const out = settle(apply(spend, s, take(WHEAT, 'dairy')).state, spend);
    expect(player(out, WHEAT).tableau.some((b) => b.card === 'D4')).toBe(true);
    expect(commonsBoards(out)['dairy']).toEqual([]);
    // The built card came from the HAND (not the pile); its payment came from
    // the PILE only - no top-up, so the hand never lost a second card.
    expect(player(out, WHEAT).hand).not.toContain('D4');
    // Only ONE of the three pile cards was needed to pay the build (D4 costs
    // 1); the other two are DISCARDED, not kept anywhere (D-S2) - EVERY pile
    // card ends up in the discard, whether it paid the build or was excess.
    expect(out.discards.dairy.filter((id) => ['D8', 'D9', 'D10'].includes(id))).toHaveLength(3);
    expect(player(out, WHEAT).hand.some((id) => ['D8', 'D9', 'D10'].includes(id))).toBe(false);
    expect(player(out, WHEAT).barn.some((id) => ['D8', 'D9', 'D10'].includes(id))).toBe(false);
  });

  it('is not offered when nothing in the pile pays for anything in hand (D-S3)', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    dealTo(spend, s, WHEAT, 'D4'); // needs a DAIRY card to pay its own-suit minimum
    seedPile(s, 'dairy', 'A4', 'A5'); // apiary cards on the dairy pile: no dairy suit at all
    expect(commonsTakeOptions(spend, s, WHEAT).some((m) => m.board === 'dairy')).toBe(false);
    expect(() => apply(spend, s, take(WHEAT, 'dairy'))).toThrow();
  });

  it('vegetable: delivers one crate paid from the pile with the wild substitution, and scores the tile', () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    const tile = s.island.tiles[0]!;
    tile.crates = ['vegetable']; // one crate, 2 cards of vegetable, per the printed rate
    // One vegetable card and three apiary fillers: the crate is short by one
    // vegetable card, so the wild substitution (2 any-crop cards per missing
    // named card) pays it - using two of the three apiary cards and leaving
    // one to be discarded (D-S2).
    seedPile(s, 'vegetable', 'V4', 'A4', 'A5', 'A6');
    const receiptsBefore = player(s, WHEAT).receipts.length;
    const out = settle(apply(spend, s, take(WHEAT, 'vegetable')).state, spend);
    const deliveredTile = out.island.tiles.find((t) => t.tile === tile.tile);
    expect(deliveredTile?.deliveredBy).toContain(WHEAT);
    expect(player(out, WHEAT).receipts.length).toBe(receiptsBefore + 1);
    expect(commonsBoards(out)['vegetable']).toEqual([]);
    expect(player(out, WHEAT).barn).toEqual([]); // the cards never touch the barn
    // All four pile cards end up discarded (the three used in the crate, the
    // same as any barn-paid delivery; the one excess apiary card, D-S2) -
    // none is kept anywhere.
    expect(out.discards.vegetable).toContain('V4');
    const apiaryDiscarded = out.discards.apiary.filter((id) => ['A4', 'A5', 'A6'].includes(id));
    expect(apiaryDiscarded).toHaveLength(3); // two spent on the crate, one excess (D-S2)
  });

  it("apiary: sows the whole pile in pile order onto the taker's own buildings, discarding a card with no building left", () => {
    const s = makeState(spend, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    buildFor(spend, s, WHEAT, 'W4'); // threshold 2, empty stack, the seat's only building
    seedPile(s, 'apiary', 'A4', 'A5', 'A6'); // three cards, room for only two
    const out = settle(apply(spend, s, take(WHEAT, 'apiary')).state, spend);
    const w4 = player(out, WHEAT).tableau.find((b) => b.card === 'W4');
    expect(w4?.stack).toEqual(['A4', 'A5']); // pile order, first two, then full
    expect(commonsBoards(out)['apiary']).toEqual([]);
    expect(out.discards.apiary).toContain('A6'); // the third card had nowhere to go
  });

  it('enumerates nothing under the shipped default', () => {
    const s = position();
    seedPile(s, 'dairy', 'D4', 'D5', 'D6');
    expect(commonsTakeOptions(data, s, WHEAT)).toEqual([]);
    expect(legalMoves(data, s).some((m) => m.type === 'commonsTake')).toBe(false);
  });
});

/**
 * ⭐ DEAN'S 'paid' VARIANT (09/09/2026, `rules.turn.commonsTake: 'paid'`),
 * `overlays/commons-take-paid-v1.overlay.json`: "Play a card to take a bonus
 * action. Then play a card to take all the cards from a pile. The
 * take-a-pile action just gives you all the cards on a pile into your hand.
 * The card you pay goes to the discard pile."
 *
 * `'bonus'` EXACTLY - a take always lands the whole pile in the taker's HAND,
 * Harvest never reaches the centre - except the `commonsTake` move now
 * carries a REQUIRED `fee`, discarded to its own suit's pile before the pile
 * moves.
 */
describe("Dean's variant: commonsTake 'paid' (09/09/2026)", () => {
  const paid: GameData = loadGameData({
    name: 'commons-take-paid-v1',
    schemaVersion: 1,
    set: { 'rules.turn.commonsTake': 'paid' },
  });

  it('never offers a central board to Harvest', () => {
    const s = makeState(paid, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    const board = commonsBoardCard(paid, 'dairy');
    expect(harvestOptions(paid, s, WHEAT)).not.toContain(board);
    expect(() => apply(paid, s, { type: 'harvest', seat: WHEAT, building: board })).toThrow();
  });

  it('costs one card, discarded to its own suit, and lands the whole pile in hand', () => {
    const s = makeState(paid, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    dealTo(paid, s, WHEAT, 'W7'); // the fee
    const handBefore = player(s, WHEAT).hand.length;
    const out = apply(paid, s, takePaid(WHEAT, 'dairy', 'W7'));
    // The fee left the hand (-1); the whole pile arrived (+2).
    expect(player(out.state, WHEAT).hand.length).toBe(handBefore + 1);
    expect(player(out.state, WHEAT).hand).toEqual(expect.arrayContaining(['D4', 'D5']));
    expect(player(out.state, WHEAT).hand).not.toContain('W7');
    expect(commonsBoards(out.state)['dairy']).toEqual([]);
    expect(out.state.discards.wheat).toContain('W7'); // its OWN suit, never the pile's
    expect(commonsBoards(out.state)['dairy']).not.toContain('W7');
    expect(out.state.turn.bonusUsed).toEqual(['commonsTake']);
    expect(out.state.turn.actionSpent).toBe(false);
    const taken = out.events.find((e) => e.e === 'commonsTaken');
    expect(taken?.e === 'commonsTaken' ? taken.cards : []).toEqual(['D4', 'D5']);
    expect(taken?.e === 'commonsTaken' ? taken.fee : null).toBe('W7');
    // No commons play, no door action: no fee joined a central board and no door ran.
    expect(out.events.some((e) => e.e === 'commonsPlayed')).toBe(false);
    expect(out.events.some((e) => e.e === 'doorUsed')).toBe(false);
    expect(out.events.some((e) => e.e === 'harvested')).toBe(false);
  });

  it('is not offered with an empty hand', () => {
    const s = makeState(paid, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    expect(player(s, WHEAT).hand).toEqual([]);
    expect(commonsTakeOptions(paid, s, WHEAT)).toEqual([]);
  });

  it('is not offered on an empty pile', () => {
    const s = makeState(paid, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    dealTo(paid, s, WHEAT, 'W7');
    expect(commonsTakeOptions(paid, s, WHEAT).some((m) => m.board === 'dairy')).toBe(false);
    expect(() => apply(paid, s, takePaid(WHEAT, 'dairy', 'W7'))).toThrow();
  });

  it("never counts the fee card among the taken cards, even when it shares the pile's suit", () => {
    const s = makeState(paid, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    seedPile(s, 'dairy', 'D4', 'D5');
    dealTo(paid, s, WHEAT, 'D9'); // a dairy-suit fee, same suit as the pile it pays to take
    const moves = commonsTakeOptions(paid, s, WHEAT).filter((m) => m.board === 'dairy');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.fee).not.toBe('D4');
      expect(m.fee).not.toBe('D5');
    }
    const out = apply(paid, s, takePaid(WHEAT, 'dairy', 'D9'));
    const taken = out.events.find((e) => e.e === 'commonsTaken');
    expect(taken?.e === 'commonsTaken' ? taken.cards : []).not.toContain('D9');
    expect(out.state.discards.dairy).toContain('D9');
  });

  it('lets play and take share a turn only with A Helping Hand, never without it', () => {
    const bare = makeState(paid, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    seedPile(bare, 'dairy', 'D4');
    dealTo(paid, bare, WHEAT, 'W7');
    dealTo(paid, bare, WHEAT, 'W8');
    const afterPlay = settle(apply(paid, bare, play(WHEAT, 'orchard', 'W7')).state, paid);
    expect(commonsTakeOptions(paid, afterPlay, WHEAT)).toEqual([]);
    expect(() => apply(paid, afterPlay, takePaid(WHEAT, 'dairy', 'W8'))).toThrow();

    const helped = makeState(paid, ['wheat', 'orchard']);
    helped.turnPlayer = WHEAT;
    buildFor(paid, helped, WHEAT, 'W18'); // A Helping Hand
    seedPile(helped, 'dairy', 'D4');
    dealTo(paid, helped, WHEAT, 'W7');
    dealTo(paid, helped, WHEAT, 'W8');
    const afterHelpedPlay = settle(apply(paid, helped, play(WHEAT, 'orchard', 'W7')).state, paid);
    expect(commonsTakeOptions(paid, afterHelpedPlay, WHEAT).length).toBeGreaterThan(0);
    const afterTake = apply(paid, afterHelpedPlay, takePaid(WHEAT, 'dairy', 'W8'));
    expect(afterTake.state.turn.bonusUsed).toEqual(['commons', 'commonsTake']);
    // Never a third, whichever order the two arrive in.
    expect(commonsOptions(paid, afterTake.state, WHEAT)).toEqual([]);
    expect(commonsTakeOptions(paid, afterTake.state, WHEAT)).toEqual([]);
  });

  it('offers the wheat board only on a full building of your own (D6 does not hold)', () => {
    const bare = makeState(paid, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    seedPile(bare, 'wheat', 'W9', 'W10');
    dealTo(paid, bare, WHEAT, 'W7');
    expect(commonsOptions(paid, bare, WHEAT).some((m) => m.board === 'wheat')).toBe(false);

    const full = makeState(paid, ['wheat', 'orchard']);
    full.turnPlayer = WHEAT;
    buildFor(paid, full, WHEAT, 'W4');
    loadStack(paid, full, WHEAT, 'W4', 2);
    dealTo(paid, full, WHEAT, 'W7');
    expect(commonsOptions(paid, full, WHEAT).some((m) => m.board === 'wheat')).toBe(true);
  });

  it('enumerates nothing under the shipped default', () => {
    const s = position();
    seedPile(s, 'dairy', 'D4', 'D5');
    dealTo(data, s, WHEAT, 'W7');
    expect(commonsTakeOptions(data, s, WHEAT)).toEqual([]);
    expect(legalMoves(data, s).some((m) => m.type === 'commonsTake')).toBe(false);
    expect(() =>
      apply(data, s, { type: 'commonsTake', seat: WHEAT, board: 'dairy', fee: 'W7' }),
    ).toThrow();
  });
});

/**
 * ⭐ THE COMMONS WITH COINS (`rules.turn.commonsTake: 'coins'`, Dean
 * 10/09/2026), `overlays/commons-coins-v1.overlay.json` and
 * `docs/commons-coins-handoff-2026-09-10-v2.md`, rules K1-K15.
 *
 * THE ARM IN ONE PARAGRAPH. The bonus slot is EITHER *"play a card OF THE
 * BOARD'S COLOUR onto it and take that board's plain action"* - with two cards
 * of any colours standing in as one, the WILD PAIR, both landing on the pile -
 * OR *"discard every card on one central pile and take ONE COIN PER CARD"*.
 * Harvest never reaches the centre at all (K4, reversing C5), so the farm-bypass
 * share reads 0% by construction. Coins have exactly one mint (a pile) and
 * exactly two sinks: the Farmstead, which becomes a coin-activated suit power
 * used as your MAIN action, and the fifteen Endgame cards, which cost coins
 * instead of two cards of their own suit.
 *
 * ⚠️ EVERY BLOCK BELOW RUNS ON AN OVERLAY AND NOT ON `BASE_GAME_DATA`. The arm
 * is OFF in the shipped game and each block asserts that from the other side
 * too, because "the flag is where I think it is" is a claim worth failing on -
 * and because six of the nine fixtures replay byte-identically only while every
 * one of these branches is unreachable at the default.
 */
describe("Dean's arm: the commons with coins (10/09/2026)", () => {
  /** The whole arm, exactly as `overlays/commons-coins-v1.overlay.json` pins it. */
  const coins: GameData = loadGameData({
    name: 'commons-coins-v1',
    schemaVersion: 1,
    set: {
      'rules.turn.visitCurrency': 'commons',
      'rules.turn.bonusTiming': 'start',
      'rules.turn.commonsTake': 'coins',
      'rules.economy.commonsColourMatch': true,
      'rules.economy.commonsWildPair': true,
      'rules.economy.endgameCoinCost': 3,
      'rules.economy.farmsteadCoinPower': true,
    },
  });

  /** The paired sub-arm: the same rules with the wild pair OFF. */
  const noPair: GameData = loadGameData({
    name: 'commons-coins-no-wild-v1',
    schemaVersion: 1,
    set: {
      'rules.turn.visitCurrency': 'commons',
      'rules.turn.bonusTiming': 'start',
      'rules.turn.commonsTake': 'coins',
      'rules.economy.commonsColourMatch': true,
      'rules.economy.commonsWildPair': false,
      'rules.economy.endgameCoinCost': 3,
      'rules.economy.farmsteadCoinPower': true,
    },
  });

  /** The paired sub-arm: the same rules with the Endgame cards back on cards. */
  const endgameOnCards: GameData = loadGameData({
    name: 'commons-coins-endgame-cards-v1',
    schemaVersion: 1,
    set: {
      'rules.turn.visitCurrency': 'commons',
      'rules.turn.bonusTiming': 'start',
      'rules.turn.commonsTake': 'coins',
      'rules.economy.commonsColourMatch': true,
      'rules.economy.commonsWildPair': true,
      'rules.economy.endgameCoinCost': null,
      'rules.economy.farmsteadCoinPower': true,
    },
  });

  /** `seedPile` reads the shipped catalogue; under an overlay the ids are the same. */
  function armState(on: GameData, suits: Suit[] = ['wheat', 'orchard']): GameState {
    const s = makeState(on, suits);
    s.turnPlayer = 0;
    return s;
  }

  /** Coins are minted only by a pile, so a scenario that wants some says so. */
  function giveCoins(state: GameState, seat: Seat, n: number): void {
    const p = state.players[seat];
    if (!p) throw new Error(`No player in seat ${seat}`);
    p.coins = (p.coins ?? 0) + n;
  }

  function pairPlay(seat: Seat, board: Suit, fee: CardId, fee2: CardId): Move {
    return { type: 'commons', seat, board, fee, fee2 };
  }

  function growCoin(seat: Seat, building: CardId): Move {
    return { type: 'grow', seat, building, payment: null, coin: true };
  }

  describe('setup and the wallet (K7)', () => {
    it('gives every seat a wallet at zero, and the shipped game none at all', () => {
      const armed = newGame(coins, { seats: 2, suits: ['wheat', 'orchard'], seed: 'coins-setup' });
      for (const p of armed.players) expect(p.coins).toBe(0);

      const shipped = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'coins-setup' });
      // ⛔ ABSENT, not present-and-zero. Six of the nine fixtures replay
      // byte-identically and this is the assertion that says why they can.
      for (const p of shipped.players) expect(Object.hasOwn(p, 'coins')).toBe(false);
      expect(Object.hasOwn(viewFor(data, shipped, 0).you, 'coins')).toBe(false);
    });

    it('shows coins in the view, your own and every rival s (they are public)', () => {
      const s = armState(coins);
      giveCoins(s, 0, 4);
      giveCoins(s, 1, 2);
      const view = viewFor(coins, s, 0);
      expect(view.you.coins).toBe(4);
      expect(view.rivals[0]?.coins).toBe(2);
    });
  });

  describe('K3 first half: the colour gate and the WILD PAIR', () => {
    // The ORCHARD board throughout, because it is the one door whose action is
    // legal from an empty position (Draw 2 needs only a deck with cards in it).
    // The wheat board is deliberately NOT used here: under K4 its Harvest needs
    // a full building of the seat's own, which is K4's own test below.
    it('offers a matching card and refuses an off-colour one', () => {
      const s = armState(coins);
      dealTo(coins, s, 0, 'O7', 'W7');
      const onto = commonsOptions(coins, s, 0).filter((m) => m.board === 'orchard');
      expect(onto.some((m) => m.fee === 'O7' && m.fee2 === undefined)).toBe(true);
      expect(onto.some((m) => m.fee === 'W7' && m.fee2 === undefined)).toBe(false);
      expect(() => apply(coins, s, play(0, 'orchard', 'W7'))).toThrow();
    });

    it('offers every unordered pair of two hand cards, of any colours, per board', () => {
      const s = armState(coins);
      dealTo(coins, s, 0, 'W7', 'V7');
      const onto = commonsOptions(coins, s, 0).filter((m) => m.board === 'orchard');
      // No orchard card in hand, so every orchard option is a pair - and there
      // is exactly one pair to make out of two cards, named once and not twice.
      expect(onto).toHaveLength(1);
      expect(onto[0]?.fee).toBe('W7');
      expect(onto[0]?.fee2).toBe('V7');
    });

    it('lands BOTH cards on the pile and emits one commonsPlayed per card', () => {
      const s = armState(coins);
      dealTo(coins, s, 0, 'W7', 'V7');
      const out = apply(coins, s, pairPlay(0, 'orchard', 'W7', 'V7'));
      expect(commonsBoards(out.state)['orchard']).toEqual(['W7', 'V7']);
      expect(player(out.state, 0).hand).not.toContain('W7');
      expect(player(out.state, 0).hand).not.toContain('V7');
      const played = out.events.filter((e) => e.e === 'commonsPlayed');
      expect(played).toHaveLength(2);
      expect(played.map((e) => (e.e === 'commonsPlayed' ? e.pileSize : 0))).toEqual([1, 2]);
      // One bonus, whatever it cost: the pair is a PRICE and never a second slot.
      expect(out.state.turn.bonusUsed).toEqual(['commons']);
      expect(out.events.filter((e) => e.e === 'doorUsed')).toHaveLength(1);
    });

    it('refuses a pair of one card named twice, and a pair with the knob off', () => {
      const s = armState(coins);
      dealTo(coins, s, 0, 'W7', 'V7');
      expect(() => apply(coins, s, pairPlay(0, 'orchard', 'W7', 'W7'))).toThrow();

      const off = armState(noPair);
      dealTo(noPair, off, 0, 'W7', 'V7');
      expect(commonsOptions(noPair, off, 0).filter((m) => m.board === 'orchard')).toEqual([]);
      expect(() => apply(noPair, off, pairPlay(0, 'orchard', 'W7', 'V7'))).toThrow();
    });

    it('takes BOTH fees out of the hand before asking whether the action is legal', () => {
      // Two cards in hand and both are the pair: the dairy board's Build has
      // nothing left to pay with, so the board is not offered as a pair at all.
      const s = armState(coins, ['dairy', 'orchard']);
      s.turnPlayer = 0;
      dealTo(coins, s, 0, 'W7', 'V7');
      expect(commonsOptions(coins, s, 0).some((m) => m.board === 'dairy')).toBe(false);
      // One more card, and the same pair now buys a Build it can afford - D4
      // costs one card of its own suit and D5 is one.
      dealTo(coins, s, 0, 'D4', 'D5');
      expect(
        commonsOptions(coins, s, 0).some(
          (m) => m.board === 'dairy' && m.fee === 'W7' && m.fee2 === 'V7',
        ),
      ).toBe(true);
    });

    it('enumerates no pair under the shipped default', () => {
      const s = position();
      dealTo(data, s, WHEAT, 'W7', 'V7');
      expect(commonsOptions(data, s, WHEAT).every((m) => m.fee2 === undefined)).toBe(true);
      expect(() => apply(data, s, pairPlay(WHEAT, 'orchard', 'W7', 'V7'))).toThrow();
    });
  });

  describe('K3 second half and K8: the coin take is the only mint', () => {
    it('discards the whole pile to its cards OWN suits and pays one coin per card', () => {
      const s = armState(coins);
      seedPile(s, 'wheat', 'O7', 'V7', 'W7');
      const out = apply(coins, s, take(0, 'wheat'));
      expect(player(out.state, 0).coins).toBe(3);
      expect(commonsBoards(out.state)['wheat']).toEqual([]);
      // ⛔ NEVER the board's suit: a pile holds whatever colours were played.
      expect(out.state.discards['orchard']).toContain('O7');
      expect(out.state.discards['vegetable']).toContain('V7');
      expect(out.state.discards['wheat']).toContain('W7');
      // Nothing playable comes back.
      expect(player(out.state, 0).hand).toEqual([]);
      expect(player(out.state, 0).barn).toEqual([]);
      expect(out.state.turn.bonusUsed).toEqual(['commonsTake']);
      expect(out.state.turn.actionSpent).toBe(false);
      const minted = out.events.find((e) => e.e === 'coinsMinted');
      expect(minted).toEqual({ e: 'coinsMinted', seat: 0, board: 'wheat', coins: 3 });
      const taken = out.events.find((e) => e.e === 'commonsTaken');
      expect(taken?.e === 'commonsTaken' ? taken.cards : []).toEqual(['O7', 'V7', 'W7']);
      expect(taken?.e === 'commonsTaken' ? taken.fee : 'x').toBeUndefined();
      // No fee and no action bought.
      expect(out.events.some((e) => e.e === 'commonsPlayed')).toBe(false);
      expect(out.events.some((e) => e.e === 'doorUsed')).toBe(false);
      expect(out.events.some((e) => e.e === 'harvested')).toBe(false);
    });

    it('is not offered on an empty pile (K5)', () => {
      const s = armState(coins);
      expect(commonsTakeOptions(coins, s, 0).some((m) => m.board === 'dairy')).toBe(false);
      expect(() => apply(coins, s, take(0, 'dairy'))).toThrow();
    });

    it('takes no fee, so no fee-bearing take is ever offered', () => {
      const s = armState(coins);
      seedPile(s, 'dairy', 'D4');
      dealTo(coins, s, 0, 'W7');
      expect(commonsTakeOptions(coins, s, 0).every((m) => m.fee === undefined)).toBe(true);
      expect(
        legalMoves(coins, s).some((m) => m.type === 'commonsTake' && m.fee !== undefined),
      ).toBe(false);
      // ⚠️ A `fee` handed to the funnel anyway is IGNORED rather than refused,
      // which is what `'bonus'` and `'spend'` already do and is documented on
      // `doCommonsTake`: the card stays in the hand and nothing is charged.
      const out = apply(coins, s, takePaid(0, 'dairy', 'W7'));
      expect(player(out.state, 0).hand).toContain('W7');
      expect(player(out.state, 0).coins).toBe(1);
    });

    it('spends the one bonus slot, so a play and a take share a turn only with A Helping Hand', () => {
      const bare = armState(coins);
      seedPile(bare, 'dairy', 'D5');
      dealTo(coins, bare, 0, 'W7');
      const afterTake = settle(apply(coins, bare, take(0, 'dairy')).state, coins);
      expect(commonsOptions(coins, afterTake, 0)).toEqual([]);

      const helped = armState(coins);
      buildFor(coins, helped, 0, 'W18');
      seedPile(helped, 'dairy', 'D5');
      // An ORCHARD card, so the play that follows the take has a legal board to
      // go to under the colour gate.
      dealTo(coins, helped, 0, 'O7');
      const after = settle(apply(coins, helped, take(0, 'dairy')).state, coins);
      expect(commonsOptions(coins, after, 0).length).toBeGreaterThan(0);
    });

    it('enumerates nothing under the shipped default', () => {
      const s = position();
      seedPile(s, 'dairy', 'D4', 'D5');
      expect(commonsTakeOptions(data, s, WHEAT)).toEqual([]);
      expect(() => apply(data, s, take(WHEAT, 'dairy'))).toThrow();
    });
  });

  describe('K4: Harvest never reaches the centre', () => {
    it('never offers a central board to Harvest, and refuses one asked for', () => {
      const s = armState(coins);
      seedPile(s, 'dairy', 'D4', 'D5');
      const board = commonsBoardCard(coins, 'dairy');
      expect(harvestOptions(coins, s, 0)).not.toContain(board);
      expect(() => apply(coins, s, { type: 'harvest', seat: 0, building: board })).toThrow();
    });

    it('offers the wheat board only on a full building of your own (D6 does not hold)', () => {
      const bare = armState(coins);
      seedPile(bare, 'wheat', 'W9', 'W10');
      dealTo(coins, bare, 0, 'W7');
      expect(commonsOptions(coins, bare, 0).some((m) => m.board === 'wheat')).toBe(false);

      const full = armState(coins);
      buildFor(coins, full, 0, 'W4');
      loadStack(coins, full, 0, 'W4', 2);
      dealTo(coins, full, 0, 'W7');
      expect(commonsOptions(coins, full, 0).some((m) => m.board === 'wheat')).toBe(true);
    });
  });

  describe('K10: the Farmstead is a coin-activated GROW, and it is your MAIN action', () => {
    /**
     * ⚠️ THE ORCHARD SEAT, BECAUSE THE TURN MUST NOT SETTLE UNDER US. `bonusTiming`
     * is 'start', so a turn whose action is spent and whose bonus slot is shut
     * ends immediately inside `apply` and `turn` is replaced by a fresh one -
     * which would make every assertion about `actionSpent` and `firedThisTurn`
     * read the NEXT seat's turn. The Orchard Farmstead's Draw 3 leaves a draw
     * task pending, which suspends the boundary and lets the turn be inspected.
     */
    function orchardSeat(): GameState {
      const s = armState(coins, ['orchard', 'wheat']);
      s.turnPlayer = 0;
      return s;
    }

    it('is offered with a coin, spends it, places nothing and spends the ACTION', () => {
      const s = orchardSeat();
      giveCoins(s, 0, 1);
      expect(
        legalMoves(coins, s).some(
          (m) => m.type === 'grow' && m.building === 'O2' && m.coin === true,
        ),
      ).toBe(true);
      const out = apply(coins, s, growCoin(0, 'O2'));
      expect(player(out.state, 0).coins).toBe(0);
      // Nothing is placed: no threshold, never full, never a sow target.
      expect(player(out.state, 0).tableau.find((b) => b.card === 'O2')?.stack).toEqual([]);
      // ⭐ THE MAIN ACTION AND NOT THE BONUS (K10): `actionSpent` goes, the
      // bonus slot is untouched.
      expect(out.state.turn.actionSpent).toBe(true);
      expect(out.state.turn.bonusUsed).toEqual([]);
      expect(out.state.turn.firedThisTurn).toContain('O2');
      const spent = out.events.find((e) => e.e === 'coinsSpent');
      expect(spent).toEqual({ e: 'coinsSpent', seat: 0, on: 'farmstead', coins: 1 });
    });

    it('is not offered once the main action is spent, because it IS the main action', () => {
      const s = orchardSeat();
      giveCoins(s, 0, 3);
      s.turn.actionSpent = true;
      expect(legalMoves(coins, s).some((m) => m.type === 'grow')).toBe(false);
      expect(() => apply(coins, s, growCoin(0, 'O2'))).toThrow();
    });

    it('is not offered without a coin, and the funnel refuses it', () => {
      const s = orchardSeat();
      expect(legalMoves(coins, s).some((m) => m.type === 'grow' && m.building === 'O2')).toBe(
        false,
      );
      expect(() => apply(coins, s, growCoin(0, 'O2'))).toThrow();
    });

    it('is once per turn: the latch drops it out of the enumerator rather than throwing', () => {
      const s = orchardSeat();
      giveCoins(s, 0, 3);
      const after = apply(coins, s, growCoin(0, 'O2')).state;
      // FILTERED, never thrown: bots probe by cloning and applying, so an
      // enumerator that throws surfaces as a crash in probe.ts. Coins are not
      // the binding constraint here - the seat still holds two.
      expect(after.turn.firedThisTurn).toContain('O2');
      expect(player(after, 0).coins).toBe(2);
      expect(growOptions(coins, after, 0, { mainAction: true }).some((o) => o.coin === true)).toBe(
        false,
      );
      expect(() => apply(coins, after, growCoin(0, 'O2'))).toThrow();
    });

    it('⛔ THE APIARY BOARD CANNOT BUY IT (D-C1): the task never offers a Farmstead', () => {
      const s = armState(coins, ['apiary', 'orchard']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 5);
      // A card of the board's colour to pay the bonus, plus a real Grow target
      // so the apiary board has something legal to do at all.
      buildFor(coins, s, 0, 'A4');
      dealTo(coins, s, 0, 'A5', 'A6');
      const out = apply(coins, s, play(0, 'apiary', 'A5'));
      const answers = legalMoves(coins, out.state).filter((m) => m.type === 'task');
      expect(answers.length).toBeGreaterThan(0);
      expect(
        answers.some(
          (m) => m.type === 'task' && m.answer.kind === 'grow' && m.answer.building === 'A2',
        ),
      ).toBe(false);
      // And the enumerator agrees when asked the way the task asks it.
      expect(growOptions(coins, out.state, 0).some((o) => o.coin === true)).toBe(false);
      expect(
        growOptions(coins, out.state, 0, { mainAction: true }).some((o) => o.coin === true),
      ).toBe(true);
    });

    it('is never offered under the shipped default, coins or no coins', () => {
      const s = position();
      expect(growOptions(data, s, WHEAT, { mainAction: true }).some((o) => o.coin === true)).toBe(
        false,
      );
      expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'W2')).toBe(false);
      expect(() => apply(data, s, growCoin(WHEAT, 'W2'))).toThrow();
    });
  });

  describe('K12: the five powers, each reading its own knob', () => {
    /**
     * ⛔ THESE ARE THE S12 POWERS, NOT THE MORNING'S, AND THE SET CHANGED
     * UNDER THIS ARM WITHOUT THE ARM BEING TOUCHED (10/09/2026 evening).
     *
     * `rules.economy.farmsteadPower` was RENAMED `noticeBoardPower` and
     * repointed to S12 as amended by Dean's rulings C88 and C89, on the
     * handoff's own reasoning that a knob whose name no longer describes it is
     * worse than a new one. The coins arm's Farmstead therefore now activates
     * into Draw 4 / build with the crops waived / SOW 2 / harvest ONE and bank
     * a card / deliver-or-bank-two, where that morning it was Draw 3 / build
     * at a discount of 1 / GROW 2 / harvest EVERY loaded building / deliver
     * twice.
     *
     * ⚠️ WHICH MEANS THE COINS ARM'S NUMBERS HAVE TO BE RE-ARGUED RATHER
     * THAN INHERITED IF IT IS EVER RE-RUN. These tests assert the shared
     * dispatch (`fireNoticeBoardPower` in workers.ts) through the one route
     * that reaches it without a visit; the notice-board visit's own route is
     * covered in `notice-board-visit.test.ts`.
     */
    it('Orchard draws rules.economy.noticeBoardPower.orchardDraw cards', () => {
      const s = armState(coins, ['orchard', 'wheat']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 1);
      const n = coins.rules.economy.noticeBoardPower.orchardDraw;
      const after = settle(apply(coins, s, growCoin(0, 'O2')).state, coins);
      expect(player(after, 0).hand).toHaveLength(n);
    });

    it('Dairy pushes a Build with the CROPS WAIVED and no discount (S13 killed D4)', () => {
      const s = armState(coins, ['dairy', 'wheat']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 1);
      // D9 costs 3 cards of which 2 must be DAIRY. The waiver takes the
      // own-suit half and NOT the card count, so three WHEAT cards pay for it
      // and two do not - which is the whole difference from the morning's
      // discount of 1, and the difference that gives D4 The Milking Shed its
      // identity back.
      dealTo(coins, s, 0, 'D9', 'W7', 'W9', 'W10');
      const out = apply(coins, s, growCoin(0, 'D2'));
      const build = out.state.tasks.find((t) => t.t === 'build');
      expect(build?.t === 'build' ? build.mods?.discount : undefined).toBeUndefined();
      expect(build?.t === 'build' ? build.mods?.substitute : undefined).toBe(
        coins.rules.economy.noticeBoardPower.dairyWild,
      );
      const answers = legalMoves(coins, out.state).filter((m) => m.type === 'task');
      const paid = answers.filter(
        (m) => m.type === 'task' && m.answer.kind === 'build' && m.answer.card === 'D9',
      );
      expect(paid.length).toBeGreaterThan(0);
      for (const m of paid) {
        if (m.type !== 'task' || m.answer.kind !== 'build') continue;
        expect(m.answer.payment).toHaveLength(3);
      }
      expect(
        paid.some(
          (m) =>
            m.type === 'task' &&
            m.answer.kind === 'build' &&
            m.answer.payment.every((id) => id.startsWith('W')),
        ),
      ).toBe(true);
    });

    it('Apiary pushes ONE sow task for apiarySows cards, and never a GROW (C89)', () => {
      const s = armState(coins, ['apiary', 'wheat']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 1);
      buildFor(coins, s, 0, 'A4', 'A7');
      dealTo(coins, s, 0, 'A5', 'A6');
      const out = apply(coins, s, growCoin(0, 'A2'));
      const sow = out.state.tasks.find((t) => t.t === 'sow');
      expect(sow?.t === 'sow' ? sow.remaining : null).toBe(
        coins.rules.economy.noticeBoardPower.apiarySows,
      );
      expect(out.state.tasks.filter((t) => t.t === 'grow')).toHaveLength(0);
      // ⛔ A SOW AND NOT A GROW (C89): nothing is activated, no ability
      // fires and no crop is matched, so the answers are sow answers and there
      // is no payment to name. That is the whole difference from the morning's
      // `apiaryGrows`, and from A12 The Honey Hut and A5 The Meadow Hive.
      const answers = legalMoves(coins, out.state).filter((m) => m.type === 'task');
      expect(answers.length).toBeGreaterThan(0);
      expect(answers.every((m) => m.type === 'task' && m.answer.kind === 'sow')).toBe(true);
    });

    it('Wheat harvests ONE building at any size, then banks wheatBarn cards (C88)', () => {
      const s = armState(coins, ['wheat', 'orchard']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 1);
      buildFor(coins, s, 0, 'W4', 'W6');
      loadStack(coins, s, 0, 'W4', 1); // one card, nowhere near its threshold of 2
      loadStack(coins, s, 0, 'W6', 2); // two, on a threshold of 3
      dealTo(coins, s, 0, 'W14');
      const out = settle(apply(coins, s, growCoin(0, 'W2')).state, coins);
      // ⛔ EXACTLY ONE of the two comes off - this is NOT W13 The Bakery's
      // cascade, which is what ruling C88 took away - and the relaxation is
      // real: the building emptied was one card into a threshold of 2.
      const emptied = ['W4', 'W6'].filter(
        (id) => player(out, 0).tableau.find((b) => b.card === id)?.stack.length === 0,
      );
      expect(emptied).toHaveLength(1);
      // And the tail: `wheatBarn` cards out of the hand and into the barn, on
      // top of whatever the harvest brought.
      expect(player(out, 0).barn.length).toBeGreaterThanOrEqual(
        coins.rules.economy.noticeBoardPower.wheatBarn,
      );
      expect(player(out, 0).barn).toContain('W14');
    });

    it('Vegetable delivers ONCE, or banks vegetableFallback cards when it cannot', () => {
      const s = armState(coins, ['vegetable', 'wheat']);
      s.turnPlayer = 0;
      giveCoins(s, 0, 1);
      // An empty barn and no balloon: the seat CANNOT deliver, so the fallback
      // is what fires. ⭐ That is S13's fix in one assertion - the morning's
      // power pushed two deliveries into a position with no payable answer and
      // the drain loop dropped both, which is how four of five powers came to
      // be dead most of the time.
      dealTo(coins, s, 0, 'V7', 'V9');
      const out = apply(coins, s, growCoin(0, 'V2'));
      const bank = out.state.tasks.find((t) => t.t === 'handToBarn');
      expect(bank?.t === 'handToBarn' ? bank.remaining : null).toBe(
        coins.rules.economy.noticeBoardPower.vegetableFallback,
      );
      expect(out.state.tasks.filter((t) => t.t === 'deliver')).toHaveLength(0);
    });

    it('fires none of them under the shipped default', () => {
      const s = position();
      // The shipped Farmstead has no activation type at all, so no route into
      // its text exists: `growOptions` skips it and the coin move is refused.
      expect(
        growOptions(data, s, WHEAT, { mainAction: true }).some((o) => o.building === 'W2'),
      ).toBe(false);
    });
  });

  describe('K13: the Farmstead s own scorer is OFF under the arm', () => {
    it('scores exactly the Farmstead term less than the shipped game, on the same tableau', () => {
      const build = (on: GameData): GameState => {
        const s = makeState(on, ['wheat', 'orchard']);
        buildFor(on, s, 0, 'W4', 'W5', 'W6');
        return s;
      };
      const shipped = gameEndScores(data, build(data))[0];
      const armed = gameEndScores(coins, build(coins))[0];
      expect(shipped?.endgame).toBe(3); // three built Wheat deck cards
      expect(armed?.endgame).toBe(0);
      // ⚠️ VISIBLE RATHER THAN SILENT: the difference is exactly the Farmstead
      // term. K13 moves that scorer to the BARN on the sheet, and the Barn has
      // no handler, so under the arm it does not fire at all - which is a real
      // scoring difference and is asserted here as one.
      expect((shipped?.total ?? 0) - (armed?.total ?? 0)).toBe(3);
    });
  });

  describe('K15: an Endgame card costs coins and no cards', () => {
    it('is offered with the coins, takes no cards, and charges them on the build', () => {
      const s = armState(coins);
      const price = coins.rules.economy.endgameCoinCost as number;
      giveCoins(s, 0, price);
      dealTo(coins, s, 0, 'W19');
      const offer = buildOptions(coins, s, 0).filter((o) => o.card === 'W19');
      expect(offer).toHaveLength(1);
      expect(offer[0]?.payment).toEqual([]);
      const out = apply(coins, s, { type: 'build', seat: 0, card: 'W19', payment: [] });
      expect(player(out.state, 0).coins).toBe(0);
      expect(player(out.state, 0).tableau.some((b) => b.card === 'W19')).toBe(true);
      const spent = out.events.find((e) => e.e === 'coinsSpent');
      expect(spent).toEqual({ e: 'coinsSpent', seat: 0, on: 'endgame', coins: price });
      const built = out.events.find((e) => e.e === 'built');
      expect(built?.e === 'built' ? built.payment : null).toEqual([]);
    });

    it('is not offered a coin short, even with a hand full of its own suit', () => {
      const s = armState(coins);
      giveCoins(s, 0, (coins.rules.economy.endgameCoinCost as number) - 1);
      dealTo(coins, s, 0, 'W19', 'W7', 'W9');
      expect(buildOptions(coins, s, 0).some((o) => o.card === 'W19')).toBe(false);
      expect(() => apply(coins, s, { type: 'build', seat: 0, card: 'W19', payment: [] })).toThrow();
      // And two Wheat cards do not buy it either: the price is coins, full stop.
      expect(() =>
        apply(coins, s, { type: 'build', seat: 0, card: 'W19', payment: ['W7', 'W9'] }),
      ).toThrow();
    });

    it('leaves the fifteen POWER cards on their two-own-suit price', () => {
      const s = armState(coins);
      giveCoins(s, 0, 9);
      dealTo(coins, s, 0, 'W16', 'W7', 'W9');
      const offer = buildOptions(coins, s, 0).filter((o) => o.card === 'W16');
      expect(offer.length).toBeGreaterThan(0);
      expect(offer.every((o) => o.payment.length === 2)).toBe(true);
      const out = apply(coins, s, { type: 'build', seat: 0, card: 'W16', payment: ['W7', 'W9'] });
      expect(player(out.state, 0).coins).toBe(9);
    });

    it('keeps the card price under the endgame-cards sub-arm and under the default', () => {
      const sub = armState(endgameOnCards);
      dealTo(endgameOnCards, sub, 0, 'W19', 'W7', 'W9');
      expect(
        buildOptions(endgameOnCards, sub, 0).some(
          (o) => o.card === 'W19' && o.payment.length === 2,
        ),
      ).toBe(true);

      const s = position();
      dealTo(data, s, WHEAT, 'W19', 'W7', 'W9');
      expect(
        buildOptions(data, s, WHEAT).some((o) => o.card === 'W19' && o.payment.length === 2),
      ).toBe(true);
    });
  });

  describe('whole games under the commons with coins', () => {
    /**
     * ⭐ THE POINT IS THE WEDGE, NOT THE OUTCOME, exactly as it is for the block
     * above. This arm narrows the bonus slot twice over - the colour gate can
     * make a play IMPOSSIBLE rather than merely expensive, and Harvest no longer
     * reaches the centre - and adds two coin-gated options that are legal only
     * sometimes. A position offering nothing legal would show up in a balance run
     * as a crash rather than as a number, so it is caught here.
     */
    const PRIORITY: Move['type'][] = [
      'task',
      'deliver',
      'harvest',
      'build',
      'grow',
      'draw',
      'commons',
      'commonsTake',
      'cardMove',
      'pass',
      'endTurn',
      // Last, and for the meeple file's reason: a balloon move IS the Deliver
      // action but never an island delivery, so preferring it stops the clock.
      'moveBalloon',
    ];

    function pick(rng: [number, number, number, number], moves: Move[]): Move {
      for (const type of PRIORITY) {
        const of = moves.filter((m) => m.type === type);
        if (of.length > 0) return of[rngInt(rng, of.length)] as Move;
      }
      throw new Error(`no move to pick: ${[...new Set(moves.map((m) => m.type))].join(', ')}`);
    }

    it.each([
      ['coins-2p', 2, ['wheat', 'orchard'] as Suit[]],
      ['coins-3p', 3, ['vegetable', 'wheat', 'apiary'] as Suit[]],
      ['coins-4p', 4, ['dairy', 'orchard', 'vegetable', 'wheat'] as Suit[]],
    ])('plays %s to the end trigger with a legal move at every step', (seed, seats, suits) => {
      let state = newGame(coins, { seats, suits, seed });
      const rng = seedRng(`policy:${seed}`);
      for (let step = 0; step < 6000; step++) {
        if (isOver(state)) break;
        const moves = legalMoves(coins, state);
        expect(moves.length, `step ${step}`).toBeGreaterThan(0);
        expect(moves.length).toBeLessThan(4000);
        state = apply(coins, state, pick(rng, moves)).state;
      }
      const dry =
        coins.cards.suits.every(
          (c) => state.decks[c].length === 0 && state.discards[c].length === 0,
        ) && state.players.every((p) => p.hand.length === 0);
      expect(state.phase === 'ended' || dry, `${seed}: neither ended nor supply-locked`).toBe(true);
      // Every coin ever minted came off a pile and every coin spent went to one
      // of the two sinks, so the wallet can never go negative or vanish.
      for (const p of state.players) expect(p.coins).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('whole games under the commons', () => {
  /**
   * ⭐ THE POINT IS THE WEDGE, NOT THE OUTCOME, exactly as it is for the meeple
   * loop's copy of this block. The commons removes the meeple phase, the free
   * Draw 1 and Collect all at once, so the bonus slot has ONE option and a
   * position that offers nothing legal is a real risk rather than a theoretical
   * one. `legalMoves` returning empty mid-game is the failure this catches, and
   * it would show up in a balance run as a crash rather than as a number.
   */
  const PRIORITY: Move['type'][] = [
    'task',
    'deliver',
    'harvest',
    'build',
    'grow',
    'draw',
    'commons',
    'cardMove',
    'pass',
    'endTurn',
    // Last, and for the meeple file's reason: a balloon move IS the Deliver
    // action but never an island delivery, so preferring it stops the clock.
    'moveBalloon',
  ];

  function pick(rng: [number, number, number, number], moves: Move[]): Move {
    for (const type of PRIORITY) {
      const of = moves.filter((m) => m.type === type);
      if (of.length > 0) return of[rngInt(rng, of.length)] as Move;
    }
    throw new Error(`no move to pick: ${[...new Set(moves.map((m) => m.type))].join(', ')}`);
  }

  it.each([
    ['commons-2p', 2, ['wheat', 'orchard'] as Suit[]],
    ['commons-3p', 3, ['vegetable', 'wheat', 'apiary'] as Suit[]],
    ['commons-4p', 4, ['dairy', 'orchard', 'vegetable', 'wheat'] as Suit[]],
  ])('plays %s to the end trigger with a legal move at every step', (seed, seats, suits) => {
    let state = newGame(data, { seats, suits, seed });
    const rng = seedRng(`policy:${seed}`);
    for (let step = 0; step < 6000; step++) {
      if (isOver(state)) break;
      const moves = legalMoves(data, state);
      expect(moves.length, `step ${step}`).toBeGreaterThan(0);
      expect(moves.length).toBeLessThan(4000);
      state = apply(data, state, pick(rng, moves)).state;
    }
    // Ended, or supply-locked: the same two terminal states the meeple file
    // documents, and for the same reason - the clock is a player action.
    const dry =
      data.cards.suits.every(
        (c) => state.decks[c].length === 0 && state.discards[c].length === 0,
      ) && state.players.every((p) => p.hand.length === 0);
    expect(state.phase === 'ended' || dry, `${seed}: neither ended nor supply-locked`).toBe(true);
  });
});

describe('the controls still play their own games', () => {
  it('v31: a Notice Board in every tableau, a card fee, a free Draw 1, no commons', () => {
    const s = newGame(cardControl, { seats: 2, suits: ['wheat', 'orchard'], seed: 'control-v31' });
    expect(Object.hasOwn(s, 'commons')).toBe(false);
    for (const p of s.players) {
      expect(p.tableau).toHaveLength(3);
      expect(
        p.tableau.some(
          (b) => cardControl.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard',
        ),
      ).toBe(true);
    }
    const bare = makeState(cardControl, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    bare.turn.actionSpent = true;
    dealTo(cardControl, bare, WHEAT, 'W7');
    const moves = legalMoves(cardControl, bare);
    expect(moves.some((m) => m.type === 'bonusDraw')).toBe(true);
    expect(moves.some((m) => m.type === 'visit' && m.fee === 'W7')).toBe(true);
    expect(moves.some((m) => m.type === 'commons')).toBe(false);
  });

  it('the v1 meeple loop: five colour slots, a meeple visit, Collect, no commons', () => {
    const s = newGame(meepleControl, { seats: 2, seed: 'control-loop' });
    expect(Object.hasOwn(s, 'commons')).toBe(false);
    for (const p of s.players) {
      expect(p.tableau).toHaveLength(3);
      expect(Object.hasOwn(p, 'noticeBoard')).toBe(true);
      for (const colour of meepleControl.cards.suits) expect(p.meeples[colour]).toBe(1);
    }
    const bare = makeState(meepleControl, ['wheat', 'orchard']);
    bare.turnPlayer = WHEAT;
    bare.turn.actionSpent = true;
    const moves = legalMoves(meepleControl, bare);
    expect(moves.some((m) => m.type === 'collect')).toBe(true);
    expect(moves.some((m) => m.type === 'visit')).toBe(true);
    expect(moves.some((m) => m.type === 'commons')).toBe(false);
  });

  it('harvests a control s Notice Board as a building, never as a central pile', () => {
    const s = makeState(cardControl, ['wheat', 'orchard']);
    // Two cards on the board is its threshold under v31, so it is harvestable.
    loadStack(cardControl, s, WHEAT, 'W3', 2);
    expect(harvestOptions(cardControl, s, WHEAT)).toContain('W3');
    const out = apply(cardControl, s, { type: 'harvest', seat: WHEAT, building: 'W3' });
    const harvested = out.events.find((e) => e.e === 'harvested');
    expect(harvested?.e === 'harvested' ? harvested.source : null).toBe('tableau');
    expect(harvested?.e === 'harvested' ? harvested.owner : null).toBe(WHEAT);
  });
});
