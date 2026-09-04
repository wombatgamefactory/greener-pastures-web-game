/**
 * Deterministic state builders for engine tests and, later, sim scenarios.
 * Not part of the play surface - newGame (with seeded shuffles) is the real
 * constructor; this kit builds exact positions so a test never depends on rng.
 *
 * Card conservation is respected: dealing or building moves ids out of the
 * decks, so a scenario can still assert that all 105 ids exist exactly once.
 */

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
import type { CardId, GameState, Seat } from './state.js';

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
