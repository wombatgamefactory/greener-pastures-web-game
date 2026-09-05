/**
 * Deterministic state builders for engine tests and, later, sim scenarios.
 * Not part of the play surface - newGame (with seeded shuffles) is the real
 * constructor; this kit builds exact positions so a test never depends on rng.
 *
 * Card conservation is respected: dealing or building moves ids out of the
 * decks, so a scenario can still assert that all 105 ids exist exactly once.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';

import { seedRng } from './rng.js';
import {
  buildIsland,
  demandPool,
  freshTurn,
  meepleLoopPlayerFields,
  meeplePool,
  parkBalloons,
  startingMeeples,
} from './setup.js';
import type { CardId, GameState, Move, Seat } from './state.js';

/**
 * A playable state: starters built, decks full (catalogue order), fair unhired,
 * island tiled with demand tokens AND MEEPLES dealt in pool order - everything
 * deterministic, nothing consumes the rng. Players start with an empty meeple
 * supply; `giveMeeples` seeds one.
 */
export function makeState(data: GameData, suits: Suit[]): GameState {
  const decks = Object.fromEntries(
    data.cards.suits.map((s) => [
      s,
      data.cards.catalogue.filter((c) => c.suit === s && c.inDeck).map((c) => c.id),
    ]),
  ) as GameState['decks'];
  const discards = Object.fromEntries(
    data.cards.suits.map((s) => [s, [] as CardId[]]),
  ) as GameState['discards'];

  const seats = suits.length;
  const poolSpec = data.island.demandTokensBySeats[String(seats)];
  const poolSuits = [...suits, ...data.cards.suits.filter((s) => !suits.includes(s))].slice(
    0,
    poolSpec?.suits ?? seats + 1,
  );

  return {
    schema: 1,
    dataFingerprint: `${data.cards.meta.sourceSha256 ?? 'unknown'}+testkit`,
    rng: seedRng('testkit'),
    seats,
    // Every deck is on the table in the testkit, so scenarios can pull any card.
    suitsInPlay: [...data.cards.suits],
    turnPlayer: 0,
    phase: 'playing',
    endTrigger: null,
    players: suits.map((suit) => ({
      suit,
      hand: [],
      barn: [],
      // Empty under the shipped game (`giveMeeples` seeds one); one of each
      // colour under the meeple-loop arm, which is that arm's printed setup
      // (R3) and not a convenience - a scenario that had to seed them by hand
      // would be testing a position no real game reaches.
      meeples: startingMeeples(data),
      ...meepleLoopPlayerFields(data),
      tableau: data.cards.catalogue
        .filter((c) => c.suit === suit && c.type === 'starter')
        .map((c) => ({ card: c.id, stack: [] })),
      receipts: [],
    })),
    decks,
    discards,
    fair: data.workers.roster.map((w) => ({ id: w.id, owner: null })),
    // The meeple bag UNSHUFFLED, so a scenario knows exactly which colour sits
    // on which delivery space: colour order, `perColour` of each. Nothing here
    // consumes the rng.
    island: {
      tiles: buildIsland(data, seats, demandPool(data, seats, poolSuits), meeplePool(data)),
    },
    aerodrome: suits.includes('vegetable')
      ? parkBalloons(data.aerodrome.balloons.map((b) => b.id))
      : null,
    turn: freshTurn(),
    tasks: [],
    resume: null,
  };
}

function pullFromDeck(data: GameData, state: GameState, card: CardId): CardId {
  const suit = data.cards.catalogue.find((c) => c.id === card)?.suit;
  if (!suit) throw new Error(`Unknown card ${card}`);
  const deck = state.decks[suit];
  const i = deck.indexOf(card);
  if (i < 0) throw new Error(`${card} is not in the ${suit} deck`);
  deck.splice(i, 1);
  return card;
}

/**
 * THE v31 CARD-VISIT CONTROL, as `overlays/v31-card-visit.overlay.json` sets it.
 *
 * The meeple loop is the shipped game since Dean ruled it in on 04/09/2026, so
 * `BASE_GAME_DATA` is the meeple currency and the card-fee visit lives behind
 * one flag. This is that flag, for the tests whose SUBJECT is the v31 game: the
 * card fee on a Notice Board, the board as a building with a threshold of 2,
 * self-visiting, the standalone free Draw 1, the turn-start meeple spend and the
 * Orchard door at Draw 3. None of it is dead code - the overlay is a live arm
 * and the control for every future comparison - so it has to stay covered.
 *
 * Memoised and lazy on purpose: `testkit` is reachable from the engine's public
 * index, and a second `loadGameData` at module load would cost every consumer
 * that never asks for it.
 */
let cardVisitCache: GameData | null = null;
export function cardVisitGame(): GameData {
  cardVisitCache ??= loadGameData({
    name: 'v31-card-visit',
    schemaVersion: 1,
    set: { 'rules.turn.visitCurrency': 'card' },
  });
  return cardVisitCache;
}

/**
 * A MEEPLE VISIT as a move, for the tests that only want to reach the far side
 * of one (a door action, `afterVisit`, the `visited` event).
 *
 * The seat must actually hold a `colour` meeple, the host's slot of that colour
 * must be free and the door's action must be legal for the visitor - "a door
 * that can do nothing is not offered" is Dean's standing ruling and it survived
 * the currency change - so this is a constructor and not a shortcut past the
 * rules. Every seat starts holding one of each colour (R3), so in a fresh
 * position the supply half is already true.
 */
export function visitMove(seat: Seat, host: Seat, colour: Suit): Move {
  return { type: 'visit', seat, host, fee: null, meeples: [colour], colour };
}

/** Move a specific card from its deck into a hand. */
export function dealTo(data: GameData, state: GameState, seat: Seat, ...cards: CardId[]): void {
  for (const card of cards) {
    state.players[seat]?.hand.push(pullFromDeck(data, state, card));
  }
}

/** Build a specific deck card straight into a tableau (no cost paid). */
export function buildFor(data: GameData, state: GameState, seat: Seat, ...cards: CardId[]): void {
  for (const card of cards) {
    state.players[seat]?.tableau.push({ card: pullFromDeck(data, state, card), stack: [] });
  }
}

/**
 * Record a free delivery by `seat` on each tile - no barn cards spent, no MEEPLE
 * claimed, no receipt VP on the player. This is how a scenario fills the island
 * without playing the deliveries out.
 *
 * It DOES take the tile's delivery space, and since the flat island the space
 * taken is what the VP schedule pays: seeding a tile makes the next real
 * delivery there worth 3 rather than 6. A scenario testing the first-deliverer
 * rate must seed somewhere other than the tile it is testing. It also counts
 * toward the end trigger the moment a real delivery re-reads the island, so
 * seeding six tiles for one seat arms the clock.
 */
export function deliveredAt(state: GameState, seat: Seat, ...tiles: string[]): void {
  for (const id of tiles) {
    const tile = state.island.tiles.find((t) => t.tile === id);
    if (!tile) throw new Error(`Tile ${id} is not in play`);
    tile.deliveredBy.push(seat);
  }
}

/**
 * Force a DOOR's ownership. Setup already assigns every door from its suit, so
 * this is only for tests that want an ownership the suits do not give - it can
 * no longer happen in a real game.
 */
export function hireFor(state: GameState, seat: Seat, workerId: string): void {
  const w = state.fair.find((x) => x.id === workerId);
  if (!w) throw new Error(`Unknown door ${workerId}`);
  w.owner = seat;
}

/** Put meeples in a seat's supply, for scenarios that test the meeple phase. */
export function giveMeeples(state: GameState, seat: Seat, colour: Suit, n = 1): void {
  const p = state.players[seat];
  if (!p) throw new Error(`No player in seat ${seat}`);
  p.meeples[colour] += n;
}

/**
 * THE v1 MEEPLE LOOP, as `overlays/meeple-loop-v1.overlay.json` sets it: the
 * game as it stood from 04/09 to 05/09/2026, before a meeple could pay for
 * anything.
 *
 * Dean ruled the meeple ECONOMY in on 05/09/2026, so `BASE_GAME_DATA` now
 * carries R15 and R17 - a meeple pays wherever a card of its colour would, and
 * a meeple spent that way lands on a neighbour's board - a PRICED slot rather
 * than a blocked one, and a cap of two. This is the flag back to the loop
 * before all of that, for the cases whose SUBJECT is one of those three rules
 * in its old form: the slot that REFUSES, the cap that boxes at one, and the
 * meeple that is only ever a visit.
 *
 * Memoised and lazy for the same reason as `cardVisitGame`.
 */
let meepleLoopCache: GameData | null = null;
export function meepleLoopGame(): GameData {
  meepleLoopCache ??= loadGameData({
    name: 'meeple-loop-v1',
    schemaVersion: 1,
    set: {
      'rules.turn.visitCurrency': 'meeple',
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': 1,
    },
  });
  return meepleLoopCache;
}

/**
 * EMPTY EVERY SEAT'S MEEPLE SUPPLY, for the cases that ask what a CARD can pay
 * for.
 *
 * Since 05/09/2026 a seat starts holding one meeple of each colour and a meeple
 * of a colour pays wherever a card of that colour would, so a case that deals a
 * hand of the wrong crop and then asserts a GROW is illegal is no longer asking
 * its own question: the orange meeple in the supply pays the apiary activation
 * the hand could not. Draining the supply keeps the question the case was
 * written to ask. ⚠️ Use it ONLY for that. A case about the shipped game's
 * legality surface must run with the supply the shipped game deals, or it is
 * measuring a position no real game reaches after turn one.
 */
export function noMeeples(state: GameState, ...seats: Seat[]): void {
  const targets = seats.length > 0 ? seats : state.players.map((_, i) => i as Seat);
  for (const seat of targets) {
    const p = state.players[seat];
    if (!p) throw new Error(`No player in seat ${seat}`);
    for (const colour of Object.keys(p.meeples) as Suit[]) p.meeples[colour] = 0;
  }
}

/** Fill a building's stack from its own suit's deck top (testing clogs and harvests). */
export function loadStack(
  data: GameData,
  state: GameState,
  seat: Seat,
  building: CardId,
  count: number,
  fromSuit?: Suit,
): void {
  const b = state.players[seat]?.tableau.find((x) => x.card === building);
  if (!b) throw new Error(`Seat ${seat} has not built ${building}`);
  const suit = fromSuit ?? data.cards.catalogue.find((c) => c.id === building)?.suit;
  if (!suit) throw new Error(`Unknown card ${building}`);
  for (let i = 0; i < count; i++) {
    const top = state.decks[suit].shift();
    if (!top) throw new Error(`The ${suit} deck ran out while loading ${building}`);
    b.stack.push(top);
  }
}
