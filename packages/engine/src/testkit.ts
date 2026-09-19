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
  dealExtraNoticeBoards,
  freshTurn,
  hostDrawCapPlayerFields,
  meepleLoopPlayerFields,
  meeplePool,
  starterCardsFor,
  startingMeeples,
  tokenPool,
} from './setup.js';
import type { CardId, GameState, Move, Seat } from './state.js';

/**
 * A playable state: starters built, decks full (catalogue order), fair unhired,
 * island tiled with TOKENS dealt in pool order and WORKERS from the bag in colour
 * order - everything deterministic, nothing consumes the rng. Players start with an empty meeple
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
  const poolSuits = [...suits, ...data.cards.suits.filter((s) => !suits.includes(s))].slice(
    0,
    data.island.decksInPlayBySeats[String(seats)] ?? seats + 1,
  );
  // ⭐ THE EXTRA NOTICE BOARDS of Dean's two-board fix (11/09/2026), dealt in
  // CATALOGUE ORDER rather than shuffled: `newGame` draws them from the seed
  // and a scenario has to know which board it got. Empty in every game but that
  // arm - see `dealExtraNoticeBoards`, which is the one place the deal and its
  // arithmetic ceiling live, so the testkit and `newGame` cannot disagree about
  // either.
  const extraBoards = dealExtraNoticeBoards(
    data,
    seats,
    suits,
    data.cards.suits.filter((s) => !suits.includes(s)),
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
    players: suits.map((suit, seat) => ({
      suit,
      hand: [],
      barn: [],
      // Empty under the shipped game (`giveMeeples` seeds one); one of each
      // colour under the meeple-loop arm, which is that arm's printed setup
      // (R3) and not a convenience - a scenario that had to seed them by hand
      // would be testing a position no real game reaches.
      meeples: startingMeeples(data),
      ...meepleLoopPlayerFields(data),
      // ABSENT unless the HOST-DRAW CAP is on, same register again - see
      // `hostDrawCapPlayerFields`. The testkit must agree with `newGame` about
      // this or a scenario silently has no latch and the cap caps nothing.
      ...hostDrawCapPlayerFields(data),
      // Three starters - see `starterCardsFor`. The testkit takes every starter whether or not it is
      // enabled, which is the one way it has always differed from `newGame`.
      tableau: [...starterCardsFor(data, suit, false), ...(extraBoards[seat] ?? [])].map(
        (card) => ({ card, stack: [] }),
      ),
      receipts: [],
    })),
    decks,
    discards,
    fair: data.workers.roster.map((w) => ({ id: w.id, owner: null })),
    // The token pool and the Worker bag UNSHUFFLED, so a scenario knows exactly
    // what sits where: tokens crop by crop at 6 / 5 / 4 / 3 (so the first tile
    // holds the first crop's 6 and 5, the second its 4 and 3, which carry the
    // first two Workers in colour order), then the wilds. Nothing here consumes
    // the rng.
    island: {
      tiles: buildIsland(data, seats, tokenPool(data, seats, poolSuits), meeplePool(data)),
    },
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
    // ⚠️ SEVEN PINS, AND EVERY ONE OF THEM WAS ONCE THE DEFAULT. This was a
    // single `visitCurrency: 'card'` on 04/09/2026; the meeple economy of
    // 05/09/2026 added four knobs to pin, and the commons of 09/09/2026 added
    // the bonus TIMING, the starting supply and the Orchard door's size. An
    // unpinned leaf is how a control silently stops being the game it is named
    // after - the 05/09/2026 passenger lesson, arriving on schedule.
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'card',
      // Pinned 13/09/2026, when the shipped default flipped to false.
      'rules.turn.selfVisitAllowed': true,
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      'rules.turn.bonusTiming': 'end',
      'rules.turn.startingMeeplesPerColour': 1,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': 1,
      // The Orchard door is Draw 3 under a card fee: a door handing back 2 for
      // the 1 you placed is worth exactly the free Draw 1 beside it (the
      // self-cancellation law, which has a subject only in this game).
      'workers.roster.draw.draw.see': 3,
      'workers.roster.draw.draw.keep': 3,
      // ⛔ EIGHT SINCE 10/09/2026, AND THE NEW ONE IS THE BOARD'S OWN
      // THRESHOLD. The notice-board visit moved the BASE value of
      // `rules.economy.noticeBoardThreshold` from 2 to 3 (S8's `3+`), so a
      // control that did not pin it silently became a different game: under
      // `'card'` the board is a BLOCKING building, 2 is the brake on the
      // self-visit, it is what shuts a farm to the table in two placements,
      // and every v31 number in reports/ was measured with it.
      // `overlays/v31-card-visit.overlay.json` pins the same leaf; this is the
      // engine's own copy of that control and has to agree with it.
      'rules.economy.noticeBoardThreshold': 2,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
  return cardVisitCache;
}

/**
 * ⭐ THE NOTICE-BOARD VISIT - the arm of 10/09/2026
 * (`docs/notice-board-visit-handoff-2026-09-10-v2.md`, S1-S16 plus Dean's
 * rulings C88 and C89 the same evening), with one board each and self-visits
 * allowed - NOT the shipped two-board game of 13/09/2026.
 *
 * Every leaf `overlays/notice-board-visit-v1.overlay.json` pins is pinned here
 * too, for the reason the file above records eight times over: an unpinned
 * passenger is how a control silently stops being the game it is named after.
 *
 * Memoised and lazy for the same reason as `cardVisitGame`.
 */
let noticeBoardVisitCache: GameData | null = null;
export function noticeBoardVisitGame(): GameData {
  noticeBoardVisitCache ??= loadGameData({
    name: 'notice-board-visit-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': true,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
  return noticeBoardVisitCache;
}

/**
 * ⭐ DEAN'S TWO-BOARD FIX (ruled 11/09/2026), exactly as
 * `overlays/notice-board-visit-two-boards-v1.overlay.json` sets it, all
 * eighteen pinned leaves included.
 *
 * THE RULE IN ONE LINE: self-visiting stays banned, and AT TWO SEATS each
 * player lays out TWO Notice Boards - their own suit's, plus one more drawn at
 * random from the suits nobody is farming - with the fifth board unused. At
 * three and four seats it is one each, which is exactly
 * `noticeBoardNoSelfGame()` below, so the arm differs from its control AT TWO
 * SEATS ONLY.
 *
 * Memoised and lazy for the same reason as `cardVisitGame`.
 */
let noticeBoardTwoBoardsCache: GameData | null = null;
export function noticeBoardTwoBoardsGame(): GameData {
  noticeBoardTwoBoardsCache ??= loadGameData({
    name: 'notice-board-visit-two-boards-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
  return noticeBoardTwoBoardsCache;
}

/**
 * ⭐ S17, THE HOST DRAW (Dean, ruled 11/09/2026), exactly as
 * `overlays/notice-board-visit-host-draw-v1.overlay.json` sets it: all
 * eighteen leaves of the two-board arm above, unchanged, PLUS
 * `rules.turn.hostDrawOnVisit`.
 *
 * THE RULE IN ONE LINE: when a neighbour visits you, you draw a card, off a
 * deck, immediately. ⛔ **ITS CONTROL IS `noticeBoardTwoBoardsGame()` AND THE
 * TWO DIFFER IN EXACTLY ONE LEAF**, which is what makes the identity gate at
 * the bottom of `notice-board-host-draw.test.ts` readable: at `n` 0 the two
 * datasets must play byte-identical games and at 1 they must not.
 *
 * ⭐ ITS PROVENANCE IS A TABLE AND NOT A SIMULATION: Dean played the two-board
 * arm at a two-player table on 11/09/2026 and house-ruled this in during the
 * session.
 *
 * `n` is a parameter rather than a constant so that the zero column can be
 * asked for by name. Not memoised for that reason either; the arm itself is
 * cheap and every caller here builds it once.
 */
export function noticeBoardHostDrawGame(n = 1): GameData {
  return loadGameData({
    name: `notice-board-visit-host-draw-v1-${n}`,
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.hostDrawOnVisit': n,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * ⭐ THE HOST-DRAW CAP: S17 WITH A HOST PAID AT MOST ONCE BETWEEN THEIR OWN
 * TURNS, however many neighbours visit them in the meantime
 * (`rules.turn.hostDrawCapPerRound`,
 * `overlays/notice-board-visit-host-draw-capped-v1.overlay.json`).
 *
 * ⛔ **ITS CONTROL IS `noticeBoardHostDrawGame()` AND THE TWO DIFFER IN EXACTLY
 * ONE LEAF**, which is what makes the identity gate readable: with the cap off
 * the two datasets must play byte-identical games on identical seeds, and with
 * it on they must not.
 *
 * ⚠️ **THE CAP IS PER THE HOST'S OWN TURN CYCLE AND NOT PER THE VISITOR'S
 * TURN**, which is the distinction the whole knob exists for and the one a test
 * has to pin: a visitor-side cap bites only at two seats (A Helping Hand) and
 * would leave four seats, the only breaching seat count, untouched.
 *
 * `capped` is a parameter rather than a constant so the off column can be asked
 * for by name, exactly as `n` is on the builder above.
 */
export function noticeBoardHostDrawCappedGame(capped = true, n = 1): GameData {
  return loadGameData({
    name: `notice-board-visit-host-draw-capped-v1-${String(capped)}-${n}`,
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.hostDrawOnVisit': n,
      'rules.turn.hostDrawCapPerRound': capped,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * ⭐ THE HOST DRAW SHAPED BY SEAT COUNT: S17 PAYS AT TWO AND THREE SEATS AND NOT
 * AT FOUR (`rules.turn.hostDrawOnVisitBySeats.4` = 0,
 * `overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json`).
 *
 * ⛔ **ITS CONTROL IS `noticeBoardHostDrawGame()` AND THE TWO DIFFER IN EXACTLY
 * ONE LEAF.** The 2 and 3 slots are deliberately NOT set: they ship null, null
 * defers to the scalar, and setting them would make this a three-leaf arm and
 * break the identity gate that says two and three seats must play byte-identical
 * games to the control.
 *
 * ⛔ **WHY IT EXISTS: PRICING THE FAUCET IS A DEAD LEVER, MEASURED.** The cap
 * removed 28.7% of the payments at four seats and returned 0.5 points of rate,
 * so the bonus rate is nearly insensitive to the faucet's SIZE. Only its
 * PRESENCE is left to change.
 */
export function noticeBoardHostDrawBySeatsGame(): GameData {
  return loadGameData({
    name: 'notice-board-visit-host-draw-by-seats-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.hostDrawOnVisit': 1,
      'rules.turn.hostDrawOnVisitBySeats.4': 0,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * ⭐ THE DELIVERY MEEPLE (M1 to M8, Dean 12/09/2026, ledger A151), exactly as
 * `overlays/delivery-meeple-v1.overlay.json` sets it.
 *
 * THE RULE IN ONE LINE: a random meeple (a WORKER, since 16/09/2026) sits on
 * every 3 and 4 VP island token, claiming that token claims it, and AFTER
 * your main action you may discard ONE meeple to take the PLAIN action of its
 * colour - wheat Harvest, vegetable Deliver, orchard Draw 2 keep both, apiary
 * GROW, dairy Build. The meeple then leaves the game for good.
 *
 * ⛔ AN ARM ON TOP OF AN ARM, AND THAT MUST BE SAID EVERY TIME. C100 is open:
 * no Notice Board configuration is ruled in as the shipped game, so this pins
 * all twenty leaves of `noticeBoardHostDrawBySeatsGame()` - the best-measured
 * configuration - and differs from it in exactly THREE meeple leaves.
 *
 * ⚠️ `meepleSpendDistinctColours` STAYS FALSE HERE. It is C112's alternative to
 * Dean's cap of one, and `deliveryMeepleDistinctGame()` below is that arm.
 */
export function deliveryMeepleGame(): GameData {
  return loadGameData({
    name: 'delivery-meeple-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.hostDrawOnVisit': 1,
      'rules.turn.hostDrawOnVisitBySeats.4': 0,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      // The three spend leaves that ARE the rule (M4, M5).
      'rules.turn.meepleSpendTiming': 'afterAction',
      'rules.turn.meepleSpendPerTurn': 1,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * ⭐ C112's ALTERNATIVE TO DEAN'S CAP: no per-turn limit, but no two meeples
 * spent in one turn may share a colour. One leaf apart from
 * `deliveryMeepleGame()` in each direction (`meepleSpendPerTurn` null,
 * `meepleSpendDistinctColours` true), which is what makes the pair readable.
 *
 * ⚠️ IT EXISTS BECAUSE THE CAP REMOVES THE THING THE TABLE LIKED. Dean's own
 * 11/09/2026 session reported "some fun, powerful combos", and one-per-turn is
 * exactly what deletes them; the branching worry that produced the cap shrank
 * when it was measured (§6.1 of `docs/village-store-coins-2026-09-12-v2.md`).
 */
export function deliveryMeepleDistinctGame(): GameData {
  return loadGameData({
    name: 'delivery-meeple-distinct-colours-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.hostDrawOnVisit': 1,
      'rules.turn.hostDrawOnVisitBySeats.4': 0,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      'rules.economy.noticeBoardsBySeats.2': 2,
      'rules.economy.noticeBoardsBySeats.3': 1,
      'rules.economy.noticeBoardsBySeats.4': 1,
      'rules.turn.meepleSpendTiming': 'afterAction',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': true,
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * ⭐ S17 WITH SELF-VISITING PUT BACK ON, AND IT EXISTS FOR ONE TEST ONLY: that
 * a self-visit is never paid the host draw.
 *
 * ⛔ NOT AN ARM AND NEVER TO BE RUN AS ONE. No overlay sets this pair of leaves
 * together, deliberately - S17's own file says the ban is what keeps the rule
 * honest - so the only way to reach the guard in `payHostDrawOnVisit` is to
 * build the position it guards against and show that nothing is paid. A test
 * that cannot reach a branch cannot defend it.
 */
export function noticeBoardHostDrawSelfGame(): GameData {
  return loadGameData({
    name: 'notice-board-visit-host-draw-self-probe',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': true,
      'rules.turn.hostDrawOnVisit': 1,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
}

/**
 * THE CONTROL THE TWO-BOARD ARM IS READ AGAINST
 * (`overlays/notice-board-visit-no-self-v1.overlay.json`): the notice-board
 * visit with self-use BANNED, one board each, and nothing else different.
 *
 * ⛔ ITS THREE-SEAT AND FOUR-SEAT GAMES ARE THE SAME RULES AS THE ARM'S, NOT
 * MERELY SIMILAR ONES, which is what `notice-board-two-boards.test.ts` replays
 * on identical seeds and asserts byte for byte. Every leaf the arm pins is
 * pinned here bar the three `noticeBoardsBySeats` keys, which are the variant
 * itself and sit at their base value of 1 here.
 */
let noticeBoardNoSelfCache: GameData | null = null;
export function noticeBoardNoSelfGame(): GameData {
  noticeBoardNoSelfCache ??= loadGameData({
    name: 'notice-board-visit-no-self-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'noticeBoardPower',
      'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      'rules.turn.bonusTiming': 'start',
      'rules.turn.selfVisitAllowed': false,
      'rules.turn.startingMeeplesPerColour': 0,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': null,
      'rules.economy.noticeBoardThreshold': 3,
      'rules.economy.noticeBoardBlocks': false,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
      'island.tokens.workerOnVp': [],
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
  return noticeBoardNoSelfCache;
}

/**
 * THE MEEPLE ECONOMY - the game as it shipped from 05/09/2026 to 09/09/2026,
 * which is `reference-v14` and the default this engine had until the commons.
 *
 * R15 and R17 in full: a meeple pays wherever a card of its colour would, a
 * meeple spent that way lands on a neighbour's board, a slot is PRICED rather
 * than blocked, and there is no supply cap. Every knob is pinned, because all
 * seven of them moved when the commons became the default.
 *
 * It is the arm for every case whose subject is a MEEPLE VISIT: those cases test
 * card behaviour that the commons cannot reach (there is no host to visit), and
 * the branch they exercise is a live control rather than dead code.
 */
let meepleEconomyCache: GameData | null = null;
export function meepleEconomyGame(): GameData {
  meepleEconomyCache ??= loadGameData({
    name: 'meeple-economy-v1',
    schemaVersion: 1,
    set: {
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'meeple',
      // Pinned 13/09/2026, when the shipped default flipped to false.
      'rules.turn.selfVisitAllowed': true,
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      'rules.turn.bonusTiming': 'end',
      'rules.turn.startingMeeplesPerColour': 1,
      'rules.turn.meepleAsCard': true,
      'rules.turn.meepleAsCardGoesTo': 'board',
      'rules.turn.slotToll': 1,
      'rules.turn.meepleCapPerColour': null,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
    },
  });
  return meepleEconomyCache;
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

/**
 * The same data with `rules.turn.bonusSlotsPerTurn` set to `n`: TWO bonus plays
 * a turn by rule rather than by card.
 *
 * ⭐ ADDED 16/09/2026, WHEN THE OLD A HELPING HAND WAS RETIRED. That card was
 * the only thing that gave a seat a second play, and the tests of S9's
 * one-use-per-board latch, S17's once-per-visit payment and the visit reactors
 * that fire on both plays all built it to get one. They widen the slot through
 * the knob instead, which isolates the rule under test from any card. The
 * result is a plain copy, not frozen and not validated as an overlay.
 */
export function withBonusSlots(data: GameData, n = 2): GameData {
  return { ...data, rules: { ...data.rules, turn: { ...data.rules.turn, bonusSlotsPerTurn: n } } };
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
 * Record a free delivery by `seat` on each tile - no barn cards spent, no
 * Worker claimed, no receipt on the player. This is how a scenario fills the
 * island without playing the deliveries out.
 *
 * ⭐ ON THE TOKEN ISLAND (16/09/2026) it REMOVES the tile's highest-VP token,
 * as a real first delivery taking it would, so the next real delivery there is
 * a SECOND delivery (the last token's demand plus 2 any). A scenario testing a
 * first delivery must seed somewhere other than the tile it is testing. It also
 * counts toward the end trigger the moment a real delivery re-reads the island,
 * so seeding six tiles for one seat arms the clock.
 */
export function deliveredAt(state: GameState, seat: Seat, ...tiles: string[]): void {
  for (const id of tiles) {
    const tile = state.island.tiles.find((t) => t.tile === id);
    if (!tile) throw new Error(`Tile ${id} is not in play`);
    if (tile.tokens.length === 0) throw new Error(`Tile ${id} has no token left to seed`);
    let best = 0;
    tile.tokens.forEach((token, i) => {
      if (token.vp > (tile.tokens[best]?.vp ?? 0)) best = i;
    });
    tile.tokens.splice(best, 1);
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
      // ⛔ TURN ORDER PINNED 16/09/2026: Dean ruled a random first player and
      // finish-the-round on 15/09/2026; this game predates both.
      'rules.setup.firstPlayer': 'seat0',
      'rules.endGame.endOfGame': 'oneMoreTurnEach',
      'rules.economy.cropScorerOnBarn': false,
      // ⛔ PRE-FLIP PINS (12/09/2026). Every helper here reproduces a game that
      // predates a ruling, so each moved leaf is pinned BY NAME at its pre-flip
      // value (the balloon and Village Store leaves went with those systems on
      // 16/09/2026). ⚠️ These helpers are INLINE COPIES of committed overlays, and
      // `fixtures.test.ts` records why that is dangerous: a copy of a pin stops
      // being a pin.
      'rules.turn.visitCurrency': 'meeple',
      // Pinned 13/09/2026, when the shipped default flipped to false.
      'rules.turn.selfVisitAllowed': true,
      // Pinned 13/09/2026, when the shipped default flipped to 2.
      'rules.economy.noticeBoardsBySeats.2': 1,
      // Pinned with the commons (09/09/2026): the default turn is bonus-FIRST
      // and deals no starting meeples, and this arm is neither.
      'rules.turn.bonusTiming': 'end',
      'rules.turn.startingMeeplesPerColour': 1,
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': 1,
      // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
      // values ('start' and null). The space choice was deleted on 16/09/2026.
      'rules.turn.meepleSpendTiming': 'start',
      'rules.turn.meepleSpendPerTurn': null,
      'rules.turn.meepleSpendDistinctColours': false,
      // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
      'rules.economy.noticeBoardPower.vegetableWildCards': 0,
      'rules.economy.noticeBoardPower.dairyDiscount': 0,
      // ⛔ WHEAT BOARD RETEXT PINNED 19/09/2026, SAME REASON: V12 The
      // Auction House ("Discard a card from your Barn. Perform the Notice
      // Board action of that crop") reaches `fireNoticeBoardPower` as a card
      // effect under EVERY currency, so a game frozen before today's retext
      // needs these two leaves pinned by name exactly like the pair above.
      'rules.economy.noticeBoardPower.wheatBarn': 1,
      'rules.economy.noticeBoardPower.wheatHarvestGate': 'loaded',
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
