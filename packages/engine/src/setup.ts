/**
 * newGame: the real constructor. Everything random consumes the seeded rng in
 * the state, so (data, seed, options) fully determines the setup and the
 * reproducibility contract starts at move zero.
 *
 * Setup follows rules.json and island.json: seats + 1 suit decks in play (one
 * passive), THREE starters pre-built per seat (Barn, Farmstead, Notice Board),
 * FOUR cards in hand off the seat's own deck and NOTHING IN THE BARN, and the
 * island tiled by seat count with TWO TOKENS dealt onto every tile, a WORKER
 * face up on each 3 and 4 VP token (the token island, 16/09/2026). (The
 * balloons and the Aerodrome were deleted on 16/09/2026.)
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
import {
  hostDrawCapPerRound,
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardsPerSeat,
  tokenCarriesWorker,
  tokensPerTile,
  wildTokensAt,
} from '@gp/data';

import { noticeBoardCardForSuit } from './query.js';
import { rngInt, seedRng, shuffle } from './rng.js';
import type { RngState } from './rng.js';
import type {
  CardId,
  GameState,
  IslandTileState,
  IslandToken,
  NoticeBoardState,
  Receipt,
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
 * The player field the HOST-DRAW CAP adds, as a spread - the exact counterpart
 * of `meepleLoopPlayerFields` above and absent for the same reason: the key is
 * MISSING rather than present-and-false under every game that does not run the
 * cap, so serialised states, captures and fixtures stay byte-identical.
 *
 * ⭐ **STARTS FALSE, AND THE FIRST ROUND IS THEREFORE NOT A SPECIAL CASE**:
 * every seat is owed its one payment from the moment the game begins, exactly as
 * it is owed one after each of its own turns.
 *
 * ⚠️ Gated on the CAP and not on `hostDrawOnVisit`, so a run with the draw on
 * and the cap off carries no latch at all and cannot accidentally consult one.
 */
export function hostDrawCapPlayerFields(data: GameData): { hostDrewThisRound?: boolean } {
  return hostDrawCapPerRound(data) ? { hostDrewThisRound: false } : {};
}

/**
 * The starters a seat lays out: THREE in every game (Farmstead, Barn, Notice
 * Board).
 *
 * ⭐ UNDER THE NOTICE-BOARD VISIT (S1/S2, Dean 10/09/2026),
 * where each of the three does exactly one thing: the NOTICE BOARD prints your
 * suit's power and holds the cards visitors play onto it (threshold `3+`), the
 * BARN holds your harvested cards and prints the crop scorer, and the FARMSTEAD
 * holds your six island receipt tokens and prints no rules text at all.
 *
 * One function so `newGame` and the testkit cannot disagree about it, exactly as
 * `meepleLoopPlayerFields` exists so they cannot disagree about the slots.
 * ⚠️ Nothing REMOVES a board from a tableau - they are never dealt into one -
 * so the starter invariant (`packages/sim/src/starter-invariant.test.ts`) is
 * untouched by this.
 */
export function starterCardsFor(data: GameData, suit: Suit, requireEnabled: boolean): CardId[] {
  return data.cards.catalogue
    .filter((c) => c.suit === suit && c.type === 'starter' && (!requireEnabled || c.enabled))
    .map((c) => c.id);
}

/**
 * ⭐ HOW MANY NOTICE BOARDS A SEAT LAYS OUT BEYOND ITS OWN (Dean's two-board
 * fix, ruled 11/09/2026, `rules.economy.noticeBoardsBySeats`). ZERO in every
 * game this project has shipped, and ONE per seat at two seats under
 * `overlays/notice-board-visit-two-boards-v1.overlay.json`.
 *
 * ⛔ READ ONLY UNDER `visitCurrency: 'noticeBoardPower'`, which is the gate the
 * knob's own description states and the reason this returns a flat 0 elsewhere.
 * Under the v31
 * card fee and the meeple loop a board is a different object with a different
 * payoff, so a second one would be a rule nobody has written. A sweep that sets
 * the map under any of those three therefore changes NOTHING rather than
 * building a game that was never designed.
 *
 * ⚠️ THE KNOB IS A FREE MAP, SO IT IS VALIDATED HERE AND NOWHERE ELSE.
 * `noticeBoardsPerSeat` in @gp/data answers what the map says and deliberately
 * does not police it; a value below 1 would leave a seat with no board and
 * break the invariant every `noticeBoardOf` caller stands on, so it throws at
 * setup rather than producing a game that crashes on its first visit.
 */
export function extraNoticeBoardsPerSeat(data: GameData, seats: number): number {
  if (!isNoticeBoardPower(data)) return 0;
  const n = noticeBoardsPerSeat(data, seats);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `rules.economy.noticeBoardsBySeats.${seats} is ${n}: a seat lays out at least one Notice Board`,
    );
  }
  return n - 1;
}

/**
 * ⭐ THE EXTRA NOTICE BOARDS, DEALT: one list of board cards per seat, in seat
 * order, taken from `pool` without replacement (Dean's two-board fix, ruled
 * 11/09/2026).
 *
 * `pool` is THE SUITS NOBODY IS FARMING, in the order they are to be dealt.
 * `newGame` hands it a fresh `shuffle(rng, ...)` so the draw is random and
 * reproducible from the seed alone; the testkit hands it catalogue order so a
 * scenario knows exactly which board it got. Neither of them may deal a suit a
 * seat is farming, which is what makes every extra board one whose POWER ITS
 * OWNER CAN NEVER USE - the whole point of the ruling, since a popular board is
 * then income rather than a handicap.
 *
 * ⛔ THE TWO SEATS GET DIFFERENT BOARDS, which falls out of dealing from one
 * pool without replacement rather than out of a check.
 *
 * ⚠️ THE CEILING IS ARITHMETIC AND THIS IS WHERE THE ENGINE RULES ON IT. There
 * are `5 - seats` unfarmed suits, so `n` boards each needs
 * `seats * (n - 1) <= 5 - seats`: two at two seats (2 drawn from 3, one left
 * over) and one at three and four. A map asking `{"3": 2}` wants six boards out
 * of five and there is no sensible engine answer - dealing fewer would make the
 * seats asymmetric in a way nobody ruled, and reusing a board would put one
 * card in two tableaux and break card conservation - so it THROWS at setup with
 * the arithmetic in the message. The data agent flagged the ceiling and left
 * the ruling to the engine; this is the ruling.
 *
 * ⚠️ THE DRAW DOES NOT PREFER A SUIT WHOSE DECK IS IN PLAY, and that is a
 * choice rather than an oversight. `island.decksInPlayBySeats` is 3 at two
 * seats, so of the three unfarmed suits only one has a deck on the table; a
 * board grants a POWER and never a deck, exactly as the commons put all five
 * actions on the table regardless of who farmed them, so all three are equally
 * drawable. Preferring the in-play deck would also weld the extra board to the
 * neutral-deck choice, which is a correlation no reading could then unpick.
 */
export function dealExtraNoticeBoards(
  data: GameData,
  seats: number,
  seatSuits: readonly Suit[],
  pool: readonly Suit[],
): CardId[][] {
  const extra = extraNoticeBoardsPerSeat(data, seats);
  if (extra === 0) return seatSuits.map(() => []);
  const drawable = pool.filter((s) => !seatSuits.includes(s));
  const wanted = seats * extra;
  if (wanted > drawable.length) {
    throw new Error(
      `rules.economy.noticeBoardsBySeats.${seats} asks ${seats} seats for ${extra} extra ` +
        `Notice Board(s) each, which is ${wanted} boards, and only ${drawable.length} suits ` +
        `are unfarmed at ${seats} seats: seats * (n - 1) must be at most 5 - seats`,
    );
  }
  let next = 0;
  // `noticeBoardCardForSuit` answers "that colour's Notice Board starter
  // (W3/V3/O3/A3/D3)" off the catalogue's `slot`, so the five faces stay named
  // in exactly one place - the sheet.
  return seatSuits.map(() =>
    drawable.slice(next, (next += extra)).map((suit) => noticeBoardCardForSuit(data, suit)),
  );
}

/**
 * THE WORKER BAG: `perColour` of each of the five colours, in colour order, for
 * the caller to shuffle.
 *
 * ⚠️ ALL FIVE COLOURS REGARDLESS OF WHO IS AT THE TABLE. A Worker of a suit
 * nobody is farming still works - the five plain actions exist independently of
 * which suits the seats chose - so the bag is not filtered by `suitsInPlay`.
 * At most 12 of the 25 are dealt (4 seats), so the island's colours are a
 * genuine random sample at every seat count.
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
 * ⭐ THE TOKEN POOL FOR THIS SEAT COUNT (Dean, ruling R3, 16/09/2026): one token
 * per crop in play per `island.tokens.vpValues`, in that order, then the wild
 * tokens. Workers are NOT on these yet: `buildIsland` deals them onto the
 * tokens as it lays them out. The caller shuffles.
 *
 * ⚠️ BUILDER DEFAULT, NOT RULED (handoff §5 item 8): when the seat count uses
 * fewer wild tokens than there are VP values (3 seats: 2 of 4), WHICH values
 * are drawn at random with `rng`. With no `rng` (a test harness) the first
 * values are taken, 6 and 5. A wild count above the value count cycles the
 * values.
 */
export function tokenPool(
  data: GameData,
  seats: number,
  cropsInPlay: readonly Suit[],
  rng?: RngState,
): IslandToken[] {
  const values = data.island.tokens.vpValues;
  const pool: IslandToken[] = [];
  for (const crop of cropsInPlay) {
    for (const vp of values) pool.push({ demand: crop, vp, worker: null });
  }
  const wild = wildTokensAt(data, seats);
  let wildValues: number[];
  if (wild >= values.length) {
    wildValues = Array.from({ length: wild }, (_, i) => values[i % values.length] as number);
  } else if (wild > 0 && rng !== undefined) {
    wildValues = shuffle(rng, [...values]).slice(0, wild);
  } else {
    wildValues = values.slice(0, wild);
  }
  for (const vp of wildValues) pool.push({ demand: 'wild', vp, worker: null });
  return pool;
}

/**
 * Lay the island out: `tokensPerTile` tokens per in-play tile, dealt in the
 * order given (so the caller shuffles), and a WORKER from `workers` (also in
 * the order given) onto every token whose VP carries one, in deal order. Both
 * throw if their pool runs short.
 *
 * ⚠️ BUILDER DEFAULT: nothing stops one tile being dealt two tokens of the
 * same crop; it then asks 4 cards of that crop on its first delivery.
 */
export function buildIsland(
  data: GameData,
  seats: number,
  tokens: readonly IslandToken[],
  workers: readonly Suit[],
): IslandTileState[] {
  const perTile = tokensPerTile(data);
  let next = 0;
  let nextWorker = 0;
  return islandTilesInPlay(data, seats).map((tileId) => {
    if (next + perTile > tokens.length) {
      throw new Error(`Token pool ran out: ${tokens.length} tokens for at least ${next + perTile}`);
    }
    const dealt = tokens.slice(next, (next += perTile)).map((token) => {
      if (!tokenCarriesWorker(data, token.vp)) return { ...token, worker: null };
      const worker = workers[nextWorker];
      if (worker === undefined) {
        throw new Error(`Worker bag ran out: ${workers.length} Workers for more tokens`);
      }
      nextWorker += 1;
      return { ...token, worker };
    });
    return { tile: tileId, tokens: dealt, deliveredBy: [] };
  });
}

export function newGame(data: GameData, opts: NewGameOptions): GameState {
  const { seats } = opts;
  if (seats < data.island.seats.min || seats > data.island.seats.max) {
    throw new Error(
      `Seats must be ${data.island.seats.min}-${data.island.seats.max}, got ${seats}`,
    );
  }
  if (
    data.rules.endGame.endOfGame === 'oneMoreTurnEach' &&
    data.rules.endGame.furtherTurnsEach !== 1
  ) {
    // The turn boundary implements "every other player takes 1 more turn" as a
    // seat comparison; a different knob value needs a counter first. Under
    // 'finishRound' (shipped 15/09/2026) the knob is not read at all.
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

  // ⭐ DEAN'S TWO-BOARD FIX (11/09/2026): the SECOND Notice Board each seat
  // lays out at two seats, drawn at random from the suits nobody is farming.
  //
  // ⛔ THE GUARD IS WHAT KEEPS THE ARM IDENTICAL TO ITS CONTROL AT THREE AND
  // FOUR SEATS, AND IT IS A GUARD ON THE RNG RATHER THAN ON THE DEAL. The
  // overlay pins the map to 1 at three and four seats, so `extra` is 0 there
  // and this line must not touch `rng` at all: one shuffle consumed here would
  // reorder every deck below it and produce a DIFFERENT GAME on the same seed,
  // which is exactly the "setup draw consuming an rng call it did not consume
  // before" leak the arm's own description warns about. Hence the branch, and
  // hence `notice-board-two-boards.test.ts` replaying both datasets on
  // identical seeds and asserting byte-identical games at three and four.
  //
  // ⚠️ A FRESH SHUFFLE AND NOT `remaining`, WHICH IS ALREADY TO HAND AND WOULD
  // BE WRONG. `remaining` is the order the NEUTRAL DECKS are dealt from, so
  // reusing it would give seat 0 the board of the one unfarmed suit whose deck
  // is on the table, every game, for ever - a fixed structural asymmetry that
  // no reading of the arm could afterwards separate from the rule itself.
  const extraBoardsPerSeat = extraNoticeBoardsPerSeat(data, seats);
  const extraBoards =
    extraBoardsPerSeat === 0
      ? playerSuits.map(() => [] as CardId[])
      : dealExtraNoticeBoards(
          data,
          seats,
          playerSuits,
          shuffle(
            rng,
            allSuits.filter((s) => !playerSuits.includes(s)),
          ),
        );

  const { startingHand, startingBarnCards } = data.rules.setup;
  const players = playerSuits.map((suit, seat) => ({
    suit,
    hand: decks[suit].splice(0, startingHand),
    // 0 since v31. `splice(0, 0)` is a deliberate no-op rather than a branch, so
    // the knob still works if a starting barn is ever wanted back.
    barn: decks[suit].splice(0, startingBarnCards),
    meeples: startingMeeples(data),
    ...meepleLoopPlayerFields(data),
    ...hostDrawCapPlayerFields(data),
    // ⭐ THE STARTERS FIRST AND THE EXTRA BOARD(S) AFTER, which is the order
    // `noticeBoardOf` and the report lines both read through: a seat's OWN
    // suit's board is the one its starters brought, and everything appended
    // here is a board whose power only its rivals can buy.
    tableau: [...starterCardsFor(data, suit, true), ...(extraBoards[seat] ?? [])].map((card) => ({
      card,
      stack: [] as CardId[],
    })),
    receipts: [] as Receipt[],
  }));

  // Two bags, one island. The tokens are drawn from the in-play crops (plus
  // the wilds, whose values are drawn first when only some are used); the
  // Workers from all five colours regardless of who is at the table - see
  // `meeplePool`.
  const pool = tokenPool(data, seats, suitsInPlay, rng);
  const island = {
    tiles: buildIsland(data, seats, shuffle(rng, pool), shuffle(rng, meeplePool(data))),
  };
  // ⭐ THE FIRST PLAYER (Dean, 15/09/2026: random). Drawn LAST, after every
  // shuffle above, so a seed deals exactly the cards, boards and island it
  // dealt before the ruling and only the opening seat (and the RNG state that
  // follows it) differs. Under 'seat0' no RNG call is made and the field is
  // left absent, so an older game is byte-identical.
  const firstPlayer = data.rules.setup.firstPlayer === 'random' ? rngInt(rng, seats) : null;
  return {
    schema: 1,
    dataFingerprint: `${data.cards.meta.sourceSha256 ?? 'unknown'}+${opts.dataTag ?? 'base'}`,
    rng,
    seats,
    suitsInPlay,
    turnPlayer: firstPlayer ?? 0,
    ...(firstPlayer === null ? {} : { firstPlayer }),
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
    turn: freshTurn(),
    tasks: [],
    resume: null,
  };
}
