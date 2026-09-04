/**
 * newGame: the real constructor. Everything random consumes the seeded rng in
 * the state, so (data, seed, options) fully determines the setup and the
 * reproducibility contract starts at move zero.
 *
 * Setup follows rules.json and island.json: seats + 1 suit decks in play (one
 * passive), THREE starters pre-built per seat (Barn, Farmstead, Notice Board),
 * FOUR cards in hand off the seat's own deck and NOTHING IN THE BARN, the island
 * tiled by seat count with demand tokens dealt onto the crates AND A MEEPLE
 * DEALT FACE UP ONTO EVERY DELIVERY SPACE, balloons only when Vegetable is on
 * the table.
 *
 * ⭐ v31: no coins, no starting barn card, and the meeple deal is new. The barn
 * used to be seeded with 1 card; it now starts empty, because the barn is purely
 * a place to keep cards ready for delivery and the game no longer has a hand
 * limit for it to relieve.
 *
 * There is no Hiring Fair step any more: `state.fair` is written once here as the
 * suit-to-seat ownership index and never touched again.
 */

import type { GameData, Suit } from '@gp/data';
import { isMeepleCurrency, meeplesPerTile } from '@gp/data';

import { seedRng, shuffle } from './rng.js';
import type {
  AerodromeState,
  CardId,
  GameState,
  IslandTileState,
  NoticeBoardState,
  TurnState,
} from './state.js';

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
    bonusUsed: [],
    ending: false,
    onceUsed: [],
    firedThisTurn: [],
  };
}

/** An empty meeple supply - all five colours present at zero, so nothing has to test for a missing key. */
export function emptyMeeples(data: GameData): Record<Suit, number> {
  return Object.fromEntries(data.cards.suits.map((s) => [s, 0])) as Record<Suit, number>;
}

/**
 * THE STARTING SUPPLY. Empty under the shipped `'card'` game - the island is its
 * only source - and `rules.turn.startingMeeplesPerColour` of EACH colour under
 * the meeple-loop arm (R3).
 *
 * ⚠️ THE ARM'S STARTING MEEPLES ARE NOT DRAWN FROM THE ISLAND BAG. They are new
 * components, so the bag still seeds the island unchanged and `meeplePool` is
 * untouched. Five per player plus one per tile is 32 at four seats against a bag
 * of 25; whether the physical bag grows is a box question for Dean, not one the
 * simulator can answer.
 */
export function startingMeeples(data: GameData): Record<Suit, number> {
  const n = data.rules.turn.startingMeeplesPerColour;
  if (!isMeepleCurrency(data) || n <= 0) return emptyMeeples(data);
  return Object.fromEntries(data.cards.suits.map((s) => [s, n])) as Record<Suit, number>;
}

/**
 * An empty Notice Board: five colour slots, all clear (R5). Only ever called
 * under the meeple-loop arm - see the comment on `PlayerState.noticeBoard` for
 * why the shipped game carries no such field at all.
 */
export function freshNoticeBoard(data: GameData): NoticeBoardState {
  return {
    slots: Object.fromEntries(data.cards.suits.map((s) => [s, [] as Suit[]])) as Record<
      Suit,
      Suit[]
    >,
  };
}

/**
 * The player fields the meeple-loop arm adds, as a spread.
 *
 * ⭐ IT CONTRIBUTES NOTHING UNDER THE `'card'` GAME, and that is the point: the
 * key is ABSENT rather than present-and-undefined, so a serialised state, a
 * capture and a replay comparison are byte-identical to 03/09/2026. One function
 * so `newGame` and the testkit cannot disagree about it.
 */
export function meepleLoopPlayerFields(data: GameData): { noticeBoard?: NoticeBoardState } {
  return isMeepleCurrency(data) ? { noticeBoard: freshNoticeBoard(data) } : {};
}

/**
 * THE MEEPLE BAG: `perColour` of each of the five colours, in colour order, for
 * the caller to shuffle.
 *
 * ⚠️ ALL FIVE COLOURS REGARDLESS OF WHO IS AT THE TABLE. A meeple of a suit
 * nobody is farming still works - the five door actions exist independently of
 * which suits the seats chose - so the bag is not filtered by `suitsInPlay`, and
 * a 2-seat game can and will deal meeples for actions no Notice Board on the
 * table grants.
 *
 * ⚠️ THE BAG IS 25 AND A 4-SEAT BOARD NEEDS 24. That is a known property and not
 * a bug to fix: at 4 seats the draw is near-exhaustive, so the island's colours
 * are almost the whole bag every game and the variance lives entirely in WHICH
 * space gets which colour; at 2 seats only 12 of 25 come out and the mix is
 * genuinely random. An overlay arm is written for the pool composition, and
 * "fixing" the 24-of-25 would silently remove the thing that arm measures.
 */
export function meeplePool(data: GameData): Suit[] {
  const { perColour, colours } = data.island.meeples;
  const pool: Suit[] = [];
  for (const colour of colours) pool.push(...Array<Suit>(perColour).fill(colour));
  return pool;
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

/**
 * Deal a demand-token pool onto the in-play tiles' crates and a MEEPLE POOL onto
 * their delivery spaces. Both are dealt in the order given, so the caller
 * shuffles; both throw if their pool runs short.
 *
 * The two deals are in one function because they are one physical setup step -
 * you lay out the island, then seed it - and because a tile is not a legal tile
 * state without both. `deliveriesPerTile(data)` meeples per tile: at 4 seats
 * that is 12 tiles times 2, which is 24 of the bag's 25 (see `meeplePool`).
 */
export function buildIsland(
  data: GameData,
  seats: number,
  tokens: (Suit | 'wild')[],
  meeples: Suit[],
): IslandTileState[] {
  const crates = data.island.tileRule.crates;
  // ⭐ HOW MANY MEEPLES A TILE IS SEEDED WITH IS DATA (R12). The shipped game
  // seeds every delivery space; the meeple-loop arm seeds only the spaces named
  // in `island.meeples.seededSpaces` - [1], the 3 VP second delivery - so a tile
  // holds ONE meeple, stored densely, and `meepleIndexForSpace` is what maps a
  // space back to it.
  const spaces = meeplesPerTile(data);
  let next = 0;
  let nextMeeple = 0;
  return islandTilesInPlay(data, seats).map((tileId) => {
    if (next + crates > tokens.length) {
      throw new Error(
        `Demand pool ran out: ${tokens.length} tokens for at least ${next + crates} crates`,
      );
    }
    if (nextMeeple + spaces > meeples.length) {
      throw new Error(
        `Meeple bag ran out: ${meeples.length} meeples for at least ${nextMeeple + spaces} delivery spaces`,
      );
    }
    return {
      tile: tileId,
      crates: tokens.slice(next, (next += crates)),
      meeples: meeples.slice(nextMeeple, (nextMeeple += spaces)),
      deliveredBy: [],
    };
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

  const { startingHand, startingBarnCards } = data.rules.setup;
  const players = playerSuits.map((suit) => ({
    suit,
    hand: decks[suit].splice(0, startingHand),
    // 0 since v31. `splice(0, 0)` is a deliberate no-op rather than a branch, so
    // the knob still works if a starting barn is ever wanted back.
    barn: decks[suit].splice(0, startingBarnCards),
    meeples: startingMeeples(data),
    ...meepleLoopPlayerFields(data),
    tableau: data.cards.catalogue
      .filter((c) => c.suit === suit && c.type === 'starter' && c.enabled)
      .map((c) => ({ card: c.id, stack: [] as CardId[] })),
    receipts: [] as number[],
  }));

  // Two shuffles, two bags, one island. The demand tokens are drawn from the
  // in-play suits; the meeples are drawn from all five colours regardless of who
  // is at the table - see `meeplePool`.
  const island = {
    tiles: buildIsland(
      data,
      seats,
      shuffle(rng, demandPool(data, seats, suitsInPlay)),
      shuffle(rng, meeplePool(data)),
    ),
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
    // The DOORS, owned from setup by the suit that brought them and never
    // changing hands. A door whose suit is not at the table has no owner, so
    // nobody's Notice Board grants that action - which is how the table's menu
    // of buyable actions comes to be decided by which suits the seats chose.
    // ⚠️ A MEEPLE of that colour still works: a meeple's action is looked up in
    // `workers.roster`, never here.
    fair: data.workers.roster.map((w) => {
      const owner = playerSuits.indexOf(w.linkedSuit);
      return { id: w.id, owner: owner < 0 ? null : owner };
    }),
    island,
    aerodrome,
    turn: freshTurn(),
    tasks: [],
    resume: null,
  };
}
