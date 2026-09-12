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
import {
  endgameCoinCost,
  farmsteadCoinPower,
  hostDrawCapPerRound,
  isCommons,
  isCommonsTakeCoins,
  isMeepleCurrency,
  isNoticeBoardPower,
  meeplesPerTile,
  noticeBoardsPerSeat,
  unclaimedBoardsToCentre,
} from '@gp/data';

import { commonsBoardCard, hasCentre } from './query.js';
import { seedRng, shuffle } from './rng.js';
import type {
  AerodromeState,
  CardId,
  CommonsState,
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
 * ⭐ IS THERE A COIN ECONOMY IN THIS GAME AT ALL? (K7, Dean 10/09/2026.)
 *
 * True when ANY of the arm's three knobs is on, rather than on
 * `isCommonsTakeCoins` alone, and the OR is the point: the mint and the two
 * sinks are separate knobs, and a sub-arm that turns one of them off must still
 * have a wallet to read. `commons-coins-endgame-cards-v1` is exactly that case
 * (the Endgame cards keep their card price while the Farmstead still eats
 * coins), and a sweep that turned the mint off while leaving a sink on would
 * otherwise crash in `coinsOf` rather than simply reading zero for ever.
 *
 * ⚠️ IT IS NOT A RULES QUESTION AND MUST NEVER BECOME ONE. Nothing about play
 * branches on this: it decides only whether the integer EXISTS, which is a
 * serialisation question (see `PlayerState.coins`). The rules branch on the
 * three knobs themselves.
 */
export function coinEconomy(data: GameData): boolean {
  return isCommonsTakeCoins(data) || farmsteadCoinPower(data) || endgameCoinCost(data) !== null;
}

/**
 * The player field the coin arm adds, as a spread - the exact counterpart of
 * `meepleLoopPlayerFields` above and absent for the same reason: the key is
 * MISSING rather than present-and-zero under the shipped game, so its
 * serialised states, captures and fixtures stay byte-identical. Starts at 0
 * (K7: nothing but a pile mints a coin, so nobody starts with one).
 */
export function coinPlayerFields(data: GameData): { coins?: number } {
  return coinEconomy(data) ? { coins: 0 } : {};
}

/**
 * The player field the HOST-DRAW CAP adds, as a spread - the exact counterpart
 * of `coinPlayerFields` above and absent for the same reason: the key is
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
 * ⭐ WHICH SUITS' NOTICE BOARDS STAND OWNERLESS IN THE CENTRE AT SETUP.
 *
 * ALL FIVE under the commons (C1): every colour is a key regardless of who is at
 * the table, because C1's whole point is that every action is available in every
 * game and the wheat board grants Harvest to a table with no Wheat seat on it.
 *
 * ⭐ THE SUITS NO PLAYER IS FARMING under Dean's unclaimed-boards variant
 * (ruled 11/09/2026): a seat's own Notice Board is a building in that seat's
 * tableau, so only what is left over goes to the middle.
 *
 * ⛔ THE SELECTION IS `data.cards.suits` MINUS THE SEATS' OWN SUITS, AND
 * DELIBERATELY *NOT* MINUS `state.suitsInPlay`, WHICH IS THE ONE PLACE THIS
 * BUILD DEPARTED FROM ITS BRIEF. `suitsInPlay` is player suits PLUS the neutral
 * DECKS (`island.decksInPlayBySeats`: 3 decks at two seats, 4 at three, 5 at
 * four), and a neutral deck is a crop nobody is FARMING - it has no Notice
 * Board on anybody's farm, so under `suitsInPlay` its board would exist nowhere
 * at all. Reading it that way gives 2 central boards at two seats and 0 at
 * four, so a seat faces 3 targets and then 3 again, and the variant's entire
 * argument - and its restored ruling that all five actions exist in every game
 * - would be false. Read off the SEATS it is exactly (5 - seats) central plus
 * (seats - 1) rivals = FOUR targets at every player count, solo included, which
 * is the table in `rules.economy.unclaimedBoardsToCentre`'s own description and
 * the thing `notice-board-unclaimed.test.ts` asserts first.
 *
 * ⚠️ The seats' suits are distinct by construction (`newGame` refuses a
 * duplicate), so this never has to de-duplicate and a suit is EITHER one seat's
 * or central, never both - which is what makes the S9 latch's card-id key and a
 * suit key the same partition. See `enumerateCommons`.
 */
export function freshCommons(data: GameData, seatSuits: readonly Suit[]): CommonsState {
  const central = unclaimedBoardsToCentre(data)
    ? data.cards.suits.filter((s) => !seatSuits.includes(s))
    : data.cards.suits;
  return {
    boards: Object.fromEntries(central.map((s) => [s, [] as CardId[]])) as Record<Suit, CardId[]>,
  };
}

/**
 * The state field the commons adds, as a spread - the exact counterpart of
 * `meepleLoopPlayerFields` above, and absent for the same reason: the key is
 * MISSING rather than present-and-undefined under the two controls, so their
 * serialised states, captures and fixtures stay byte-identical.
 *
 * ⭐ TWO GAMES PUT A ZONE HERE SINCE 11/09/2026 and `hasCentre` is the one
 * question both are asked through. The commons fills it with all five piles;
 * Dean's unclaimed-boards variant fills it with the unfarmed suits' piles only.
 * Every other game - the v31 control, the meeple loop, the meeple economy and
 * the notice-board visit WITHOUT the variant's knob - still gets `{}`.
 */
export function commonsZone(
  data: GameData,
  seatSuits: readonly Suit[],
): { commons?: CommonsState } {
  // ⛔ AND THE NOTICE-BOARD VISIT AS BUILT ON 10/09/2026 HAS NO CENTRAL STATE
  // AT ALL (S2): the centre is DELETED, the five board cards go home to their
  // owners' farms, and there is nothing in the middle of the table but the
  // island. That is still true whenever `unclaimedBoardsToCentre` is false,
  // which is its shipped value and the value both no-centre arms of the 2x2
  // pin - so the arm this variant is read against is untouched, and it is
  // worth saying out loud because "no central state" is a rule of that design
  // rather than an accident of a predicate.
  return hasCentre(data) ? { commons: freshCommons(data, seatSuits) } : {};
}

/**
 * The starters a seat lays out. THREE under the controls (Farmstead, Barn,
 * Notice Board) and TWO under the commons (C1): the five Notice Boards stand in
 * the centre and no player has one, so a farm is Farmstead plus Barn.
 *
 * ⭐ AND THREE AGAIN UNDER THE NOTICE-BOARD VISIT (S1/S2, Dean 10/09/2026),
 * where each of the three does exactly one thing: the NOTICE BOARD prints your
 * suit's power and holds the cards visitors play onto it (threshold `3+`), the
 * BARN holds your harvested cards and prints the crop scorer, and the FARMSTEAD
 * holds your six island receipt tokens and prints no rules text at all. The
 * filter below is keyed on `isCommons` alone, so that arm needs no clause here:
 * three starters is the DEFAULT and the commons is the exception.
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
    .filter((c) => !(isCommons(data) && c.slot === 'noticeboard'))
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
 * Under the commons no seat has a Notice Board at all (C1) and under the v31
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
  // ⚠️ `commonsBoardCard` DESPITE THE NAME, and it is the right function: it
  // answers "that colour's Notice Board starter (W3/V3/O3/A3/D3)" off the
  // catalogue's `slot`, which is the question here and has nothing to do with
  // the commons beyond where it was first needed. One spelling, so the five
  // faces stay named in exactly one place - the sheet.
  return seatSuits.map(() =>
    drawable.slice(next, (next += extra)).map((suit) => commonsBoardCard(data, suit)),
  );
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
  // ⛔ NO MEEPLE ANYWHERE UNDER THE COMMONS (C6). The data pass makes
  // `meeplesPerTile` answer 0 for the mode; this says so in the engine as well,
  // so that the island is seedless the moment the knob flips and never depends
  // on the two packages landing in the same commit. Under `'meeple'` it is the
  // 3 VP space alone and under `'card'` every delivery space, and those two
  // branches are the controls.
  const spaces = isCommons(data) ? 0 : meeplesPerTile(data);
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
    // The coin wallet at 0, present only under the commons-with-coins arm (K7)
    // and ABSENT otherwise - see `coinPlayerFields`.
    ...coinPlayerFields(data),
    ...hostDrawCapPlayerFields(data),
    // ⭐ THE STARTERS FIRST AND THE EXTRA BOARD(S) AFTER, which is the order
    // `noticeBoardOf` and the report lines both read through: a seat's OWN
    // suit's board is the one its starters brought, and everything appended
    // here is a board whose power only its rivals can buy.
    tableau: [...starterCardsFor(data, suit, true), ...(extraBoards[seat] ?? [])].map((card) => ({
      card,
      stack: [] as CardId[],
    })),
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
    ...commonsZone(data, playerSuits),
    turn: freshTurn(),
    tasks: [],
    resume: null,
  };
}
