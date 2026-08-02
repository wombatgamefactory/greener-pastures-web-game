/**
 * newGame: the real constructor. Everything random consumes the seeded rng in
 * the state, so (data, seed, options) fully determines the setup and the
 * reproducibility contract starts at move zero.
 *
 * Setup follows rules.json and island.json: seats + 1 suit decks in play (one
 * passive), 3 starters pre-built per seat, a hand and one face-down barn card
 * from the own deck, the island tiled by seat count with demand tokens dealt
 * onto the crates, five Workers in the Fair, balloons only when Vegetable is
 * on the table.
 */

import type { GameData, Suit } from '@gp/data';

import { levelRuleOf } from './actions.js';
import { seedRng, shuffle } from './rng.js';
import type { AerodromeState, CardId, GameState, IslandTileState, TurnState } from './state.js';

export interface NewGameOptions {
  seats: number;
  /** Player suits in seat order. Omit to deal random distinct suits. */
  suits?: Suit[];
  /**
   * The passive decks nobody farms - the crops on the table that no seat owns.
   * Omit and the rng deals them from whatever the seats did not take, which is
   * the game's own rule. Naming them is a HARNESS need: a balance run stratifies
   * across every legal (player suits + neutral decks) combination, and a cell it
   * cannot address is a cell it cannot sample evenly.
   */
  neutralSuits?: Suit[];
  seed: string;
  /** Names the overlay in the data fingerprint. Defaults to 'base'. */
  dataTag?: string;
}

export function freshTurn(): TurnState {
  return {
    actionSpent: false,
    bonusSpent: false,
    ending: false,
    visit: null,
    again: null,
    onceUsed: [],
  };
}

/**
 * The printed tile faces in play at this seat count. Bookend rule: a row of n
 * tiles uses the first (n - 1) printed faces plus the row-end face; level 3
 * comes from its own by-seats table (D1 replaces C1 at two seats).
 */
export function islandTilesInPlay(data: GameData, seats: number): string[] {
  const slots = data.island.slotsBySeats[String(seats)];
  if (!slots) throw new Error(`No island layout for ${seats} seats`);
  const out: string[] = [];
  for (const level of [1, 2] as const) {
    const faces = data.island.tiles.filter((t) => t.level === level).map((t) => t.id);
    const n = slots[String(level)] ?? 0;
    if (n > faces.length) throw new Error(`Level ${level} has ${faces.length} faces, need ${n}`);
    const rowEnd = faces[faces.length - 1] as string;
    out.push(...faces.slice(0, n - 1), rowEnd);
  }
  const levelThree = data.island.levelThreeTilesBySeats[String(seats)];
  if (!levelThree) throw new Error(`No level-3 tiles listed for ${seats} seats`);
  out.push(...levelThree);
  return out;
}

/**
 * The demand-token pool for this seat count: perSuit tokens for each in-play
 * suit plus the wilds. Dealt (in the order given, so the caller shuffles) onto
 * the crates tile by tile.
 */
export function demandPool(data: GameData, seats: number, suitsInPlay: Suit[]): (Suit | 'wild')[] {
  const spec = data.island.demandTokensBySeats[String(seats)];
  if (!spec) throw new Error(`No demand token pool for ${seats} seats`);
  if (suitsInPlay.length !== spec.suits) {
    throw new Error(`Pool spans ${spec.suits} suits, got ${suitsInPlay.length} in play`);
  }
  const pool: (Suit | 'wild')[] = [];
  for (const suit of suitsInPlay) pool.push(...Array<Suit>(spec.perSuit).fill(suit));
  pool.push(...Array<'wild'>(spec.wild).fill('wild'));
  return pool;
}

/** Deal a token pool onto the in-play tiles' crates. Throws if the pool runs short. */
export function buildIsland(
  data: GameData,
  seats: number,
  tokens: (Suit | 'wild')[],
): IslandTileState[] {
  let next = 0;
  return islandTilesInPlay(data, seats).map((tileId) => {
    const level = data.island.tiles.find((t) => t.id === tileId)?.level;
    if (!level) throw new Error(`Unknown island tile ${tileId}`);
    const crates = levelRuleOf(data, level).crates;
    if (next + crates > tokens.length) {
      throw new Error(
        `Demand pool ran out: ${tokens.length} tokens for at least ${next + crates} crates`,
      );
    }
    return { tile: tileId, crates: tokens.slice(next, (next += crates)), deliveredBy: [] };
  });
}

/**
 * All balloons start unowned in the centre - ticket 06 ruling J: no per-seat
 * parking and no draft. (The reference implementation and the rulebook park
 * one per seat; ruling J explicitly supersedes that, and the divergence is
 * flagged to the rulings audit, ticket 07.)
 */
export function parkBalloons(order: string[]): AerodromeState {
  return { balloons: order.map((id) => ({ id, at: 'centre' })) };
}

export function newGame(data: GameData, opts: NewGameOptions): GameState {
  const { seats } = opts;
  if (seats < data.island.seats.min || seats > data.island.seats.max) {
    throw new Error(
      `Seats must be ${data.island.seats.min}-${data.island.seats.max}, got ${seats}`,
    );
  }
  if (data.rules.endGame.furtherTurnsEach !== 1) {
    // The turn boundary implements "every other player takes 1 more turn" as a
    // seat comparison; a different knob value needs a counter first.
    throw new Error('furtherTurnsEach values other than 1 are not implemented');
  }

  const rng = seedRng(opts.seed);
  const allSuits = [...data.cards.suits];

  let playerSuits: Suit[];
  if (opts.suits) {
    if (opts.suits.length !== seats)
      throw new Error(`Need ${seats} suits, got ${opts.suits.length}`);
    if (new Set(opts.suits).size !== seats) throw new Error('Player suits must be distinct');
    for (const s of opts.suits) {
      if (!allSuits.includes(s)) throw new Error(`Unknown suit ${s}`);
    }
    playerSuits = [...opts.suits];
  } else {
    playerSuits = shuffle(rng, [...allSuits]).slice(0, seats);
  }
  const remaining = shuffle(
    rng,
    allSuits.filter((s) => !playerSuits.includes(s)),
  );
  const decksInPlay = data.island.decksInPlayBySeats[String(seats)] ?? seats + 1;
  const neutrals = opts.neutralSuits ?? remaining;
  if (opts.neutralSuits) {
    if (new Set(opts.neutralSuits).size !== opts.neutralSuits.length) {
      throw new Error('Neutral suits must be distinct');
    }
    for (const s of opts.neutralSuits) {
      if (!allSuits.includes(s)) throw new Error(`Unknown suit ${s}`);
      if (playerSuits.includes(s)) throw new Error(`${s} is a player suit, not a neutral one`);
    }
  }
  if (neutrals.length < decksInPlay - seats) {
    throw new Error(`Need ${decksInPlay - seats} neutral suits, got ${neutrals.length}`);
  }
  const suitsInPlay = [...playerSuits, ...neutrals.slice(0, decksInPlay - seats)];

  const decks = Object.fromEntries(
    allSuits.map((suit) => [
      suit,
      suitsInPlay.includes(suit)
        ? shuffle(
            rng,
            data.cards.catalogue
              .filter((c) => c.suit === suit && c.inDeck && c.enabled)
              .map((c) => c.id),
          )
        : ([] as CardId[]),
    ]),
  ) as GameState['decks'];
  const discards = Object.fromEntries(
    allSuits.map((s) => [s, [] as CardId[]]),
  ) as GameState['discards'];

  const { startingHand, startingBarnCards, startingCoins } = data.rules.setup;
  const players = playerSuits.map((suit) => ({
    suit,
    coins: startingCoins,
    hand: decks[suit].splice(0, startingHand),
    barn: decks[suit].splice(0, startingBarnCards),
    tableau: data.cards.catalogue
      .filter((c) => c.suit === suit && c.type === 'starter' && c.enabled)
      .map((c) => ({ card: c.id, stack: [] as CardId[], upgraded: false })),
    covered: [] as string[],
    receipts: [] as number[],
  }));

  const island = {
    tiles: buildIsland(data, seats, shuffle(rng, demandPool(data, seats, suitsInPlay))),
  };
  const aerodrome = suitsInPlay.includes('vegetable')
    ? parkBalloons(
        shuffle(
          rng,
          data.aerodrome.balloons.map((b) => b.id),
        ),
      )
    : null;

  return {
    schema: 1,
    dataFingerprint: `${data.cards.meta.sourceSha256 ?? 'unknown'}+${opts.dataTag ?? 'base'}`,
    rng,
    seats,
    suitsInPlay,
    turnPlayer: 0,
    phase: 'playing',
    endTrigger: null,
    players,
    decks,
    discards,
    fair: data.workers.roster.map((w) => ({ id: w.id, owner: null, trackPos: 0 })),
    island,
    aerodrome,
    turn: freshTurn(),
    tasks: [],
    resume: null,
  };
}
