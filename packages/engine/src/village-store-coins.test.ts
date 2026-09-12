/**
 * ⭐ THE VILLAGE STORE COIN (V1 to V12, Dean 12/09/2026, ledger A150;
 * `docs/village-store-coins-handoff-2026-09-12-v1.md` section 2 and
 * `docs/village-store-coins-2026-09-12-v2.md` sections 2 to 4).
 *
 * THE RULE IN ONE LINE: when you make a delivery you may spend any number of
 * ADDITIONAL cards from your BARN, taking £1 each out of a shared, recirculating
 * supply of five coins per seat; a coin is then a wild card for BUILD (including
 * the n-of-suit requirement) and for GROW (placing nothing, so a FULL building
 * is a legal target); it may never pay a visit, a Harvest or a Deliver; it
 * scores nothing and breaks no ties.
 *
 * ⛔ **AN ARM ON TOP OF AN ARM, AND EVERY REPORT MUST SAY SO.** C100 is open: no
 * Notice Board configuration is ruled in as the shipped game. The arm here is
 * `villageStoreGame()` - the best-measured host-draw configuration plus six coin
 * leaves - and `BASE_GAME_DATA` appears only where the whole point is that the
 * shipped game does not move.
 *
 * ## What this file is guarding, in the order the traps were named
 *
 * ⛔ **1. THE MINT IS NOT A POWER SET, AND ONE CASE BELOW EXISTS TO PROVE IT.**
 * "Spend any number of cards from your barn" is 2^n conversions offered in one
 * task, at every delivery. This project has been stopped dead twice by exactly
 * that shape - a 116,535-move position on 02/09/2026 and an 888,030-move one on
 * 05/09/2026. The mint is a REPEATED BINARY CHOICE and its answer names a SUIT,
 * so the list is capped at five suits plus a skip whatever the barn holds. The
 * bound is asserted against a twenty-four-card barn, because an enumeration that
 * looks fine at three cards in a unit test is exactly how this fails.
 *
 * ⛔ **2. V3: THE EXCHANGE RESOLVES AFTER THE CRATE IS PAID.** It hangs off
 * `finishDelivery` and not `doDeliver`, so a player can never convert the cards
 * the delivery itself needs. The opposite rule is a delivery you can talk
 * yourself out of.
 *
 * ⛔ **3. ONE MINT AND TWO SINKS, AND NOTHING ELSE.** Every coin economy this
 * project has had died of a second faucet or a pity rate, and O17 The Fruit
 * Basket was one already: "instead of discarding a card you spend, put it into
 * your barn" would have returned a card paid into the exchange to its owner's
 * barn while they kept the coin. Dean restricted the card to a HAND discard on
 * 12/09/2026 and the cases below are that restriction.
 *
 * ⛔ **4. V5: THE SUPPLY RECIRCULATES AND THE TOTAL IS INVARIANT.** Supply plus
 * every wallet is `coinSupplyPerPlayer` x seats for the whole game, and D4 says
 * an empty supply mid-conversion STOPS rather than refusing the whole exchange.
 *
 * ⛔ **5. INERTNESS.** At `storeCoinsPerCard: 0` the game must play exactly as
 * it did, and `GameState.coinSupply` must be ABSENT rather than
 * present-and-zero. Nine fixtures replay byte-identically and depend on that
 * absence.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA, coinGrowReachesFullBuildings } from '@gp/data';

import { growOptions } from './actions.js';
import { apply, legalMoves, newGame, player, score, taskAnswers } from './index.js';
import { coinSupplyLeft, coinsOf, isFull, isHarvestable } from './query.js';
import type { CardId, GameState, Move, Seat, TaskAnswer } from './state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
  deliveredAt,
  giveCoins,
  loadStack,
  makeState,
  noticeBoardHostDrawBySeatsGame,
  villageStoreGame,
} from './testkit.js';

const SEAT = 0 as Seat;
const OTHER = 1 as Seat;

const arm = villageStoreGame();
const buildOnly = villageStoreGame('build');
const growOnly = villageStoreGame('grow');
const growOpen = villageStoreGame('growOpen');
const wildOnly = villageStoreGame('wild');
const control = noticeBoardHostDrawBySeatsGame();

/** Cards straight off a deck into a barn, by suit and count. */
function stockBarn(state: GameState, seat: Seat, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

/** A two-seat position, a stocked barn, and one delivery made onto tile A1. */
function afterDelivery(data: GameData, barn: Partial<Record<Suit, number>> = { wheat: 4 }) {
  const state = makeState(data, ['wheat', 'orchard']);
  for (const [suit, n] of Object.entries(barn) as [Suit, number][]) {
    stockBarn(state, SEAT, suit, n);
  }
  return apply(data, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
}

/** The head task's answers, exactly as the engine would offer them. */
function headAnswers(data: GameData, state: GameState): TaskAnswer[] {
  const head = state.tasks[0];
  if (!head) throw new Error('No pending task');
  return taskAnswers(data, state, head);
}

/** `remaining` on the head mint task, or -1 when there is no mint pending. */
function remaining(state: GameState): number {
  const head = state.tasks[0];
  return head?.t === 'mint' ? head.remaining : -1;
}

/** Answer the head task with "convert one card of this suit". */
function convert(data: GameData, state: GameState, suit: Suit) {
  return apply(data, state, {
    type: 'task',
    seat: SEAT,
    answer: { kind: 'card', payload: { suit } },
  });
}

describe('the Village Store coin: the mint (V1 to V5)', () => {
  /**
   * ⭐ V1 AND V3 IN ONE CASE. Four wheat pay the crate; the exchange is offered
   * AFTERWARDS, over what is left, so the six spare cards are convertible and
   * the four the island took are not.
   */
  it('offers the exchange after the crate is paid, over what is left of the barn', () => {
    const out = afterDelivery(arm, { wheat: 10 });
    expect(out.state.players[SEAT]?.barn).toHaveLength(6);
    expect(out.state.tasks[0]?.t).toBe('mint');
    // The ceiling is min(barn, supply): six cards against ten coins at two seats.
    expect(remaining(out.state)).toBe(6);
    expect(out.state.players[SEAT]?.coins).toBe(0);
  });

  /** V1: one card out of the barn, one coin in, and D1 sends the card to its own suit's discard. */
  it('takes one coin per card and sends the card to its suit discard (D1)', () => {
    const out = afterDelivery(arm, { wheat: 6 });
    const before = out.state.discards.wheat.length;
    const one = convert(arm, out.state, 'wheat');
    expect(one.state.players[SEAT]?.barn).toHaveLength(1);
    expect(coinsOf(one.state, SEAT)).toBe(1);
    // ⛔ THE DISCARD AND NEVER OUT OF THE GAME. Returning stranded cards to
    // circulation is the Store's whole argument; out of the game would do the
    // opposite, and reshuffles per played deck is the falsifiable prediction.
    expect(one.state.discards.wheat.length).toBe(before + 1);
    expect(one.events).toContainEqual(
      expect.objectContaining({ e: 'coinsMinted', seat: SEAT, board: 'store', coins: 1 }),
    );
  });

  /** V4 and V5: the supply is shared, sized by seats, and the total never changes. */
  it('sizes the supply by seats and keeps supply plus wallets invariant', () => {
    expect(makeState(arm, ['wheat', 'orchard']).coinSupply).toBe(10);
    expect(makeState(arm, ['wheat', 'orchard', 'apiary', 'dairy']).coinSupply).toBe(20);

    let state = afterDelivery(arm, { wheat: 6 }).state;
    for (let i = 0; i < 2; i++) state = convert(arm, state, 'wheat').state;
    const held = state.players.reduce((n, p) => n + (p.coins ?? 0), 0);
    expect(held).toBe(2);
    expect(coinSupplyLeft(state)).toBe(8);
    expect(coinSupplyLeft(state) + held).toBe(10);
  });

  /** D3: declining is EXPLICIT, so the turn settles cleanly on a skip. */
  it('always offers a skip and takes nothing when it is answered (D3)', () => {
    const out = afterDelivery(arm, { wheat: 6 });
    expect(headAnswers(arm, out.state)).toContainEqual({ kind: 'skip' });
    const done = apply(arm, out.state, { type: 'task', seat: SEAT, answer: { kind: 'skip' } });
    expect(done.state.tasks).toHaveLength(0);
    expect(done.state.players[SEAT]?.coins).toBe(0);
    expect(done.state.players[SEAT]?.barn).toHaveLength(2);
  });

  /**
   * ⛔ D4 AND V5's SECOND HALF: AN EMPTY SUPPLY MINTS NOTHING, and an exchange
   * that empties it mid-conversion STOPS rather than undoing what it already
   * did. Two seats share a supply of ten and the rival is holding nine.
   */
  it('stops when the supply runs out mid-exchange, keeping what it minted (D4)', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    giveCoins(state, OTHER, 9);
    stockBarn(state, SEAT, 'wheat', 8);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    // The ceiling is the SUPPLY and not the barn: four spare cards, one coin.
    expect(remaining(out.state)).toBe(1);
    const one = convert(arm, out.state, 'wheat');
    expect(coinsOf(one.state, SEAT)).toBe(1);
    expect(coinSupplyLeft(one.state)).toBe(0);
    // The task is gone rather than re-offered, and the three cards it could not
    // reach are still in the barn.
    expect(one.state.tasks).toHaveLength(0);
    expect(one.state.players[SEAT]?.barn).toHaveLength(3);
  });

  /** An empty supply at the moment of delivery queues nothing at all. */
  it('queues no exchange when the supply is already empty (V5)', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    giveCoins(state, OTHER, 10);
    stockBarn(state, SEAT, 'wheat', 6);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.tasks).toHaveLength(0);
  });

  /** V2: the BARN and never the hand. A full hand converts nothing. */
  it('never reaches the hand (V2)', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    stockBarn(state, SEAT, 'wheat', 4);
    // Three cards off the deck top rather than named ones: `stockBarn` has
    // already taken the four a test could name.
    for (let i = 0; i < 3; i++) state.players[SEAT]?.hand.push(state.decks.wheat.shift() as CardId);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    // The crate emptied the barn, so there is nothing to exchange even though
    // the hand is holding three cards.
    expect(out.state.players[SEAT]?.barn).toHaveLength(0);
    expect(out.state.players[SEAT]?.hand).toHaveLength(3);
    expect(out.state.tasks).toHaveLength(0);
  });

  /**
   * ⛔ THE BOUND, AND IT IS THE MOST IMPORTANT ASSERTION IN THIS FILE.
   *
   * A twenty-card barn is 2^20 = 1,048,576 subsets. The task offers SIX answers:
   * one per suit present, plus the skip. The bound is `suits + 1`, it does not
   * grow with the barn, and it holds at every step of the exchange rather than
   * being six once and a power set later.
   */
  it('offers at most one answer per suit plus a skip, whatever the barn holds', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    stockBarn(state, SEAT, 'wheat', 8);
    for (const suit of ['orchard', 'vegetable', 'apiary', 'dairy'] as Suit[]) {
      stockBarn(state, SEAT, suit, 4);
    }
    expect(state.players[SEAT]?.barn).toHaveLength(24);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    const answers = headAnswers(arm, out.state);
    expect(answers).toHaveLength(arm.cards.suits.length + 1);
    expect(answers.filter((a) => a.kind === 'skip')).toHaveLength(1);
    const next = convert(arm, out.state, 'dairy');
    expect(headAnswers(arm, next.state)).toHaveLength(arm.cards.suits.length + 1);
    // And the number of STEPS is bounded by the supply, not by the barn: twenty
    // cards left, ten coins in the pool, nine of them still there.
    expect(next.state.players[SEAT]?.barn).toHaveLength(19);
    expect(remaining(next.state)).toBe(9);
  });

  /** D2: any delivery mints, so a second receipt on a used tile mints too. */
  it('mints at a delivery onto a tile someone else has already used (D2)', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    deliveredAt(state, OTHER, 'A1');
    stockBarn(state, SEAT, 'wheat', 6);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.players[SEAT]?.receipts).toEqual([3]);
    expect(out.state.tasks[0]?.t).toBe('mint');
  });
});

describe('the Village Store coin: the Build sink (V6, V7)', () => {
  /** A two-seat position holding `coins`, with `hand` dealt to the acting seat. */
  function builder(data: GameData, coins: number, hand: CardId[]): GameState {
    const state = makeState(data, ['wheat', 'orchard']);
    if (coins > 0) giveCoins(state, SEAT, coins);
    dealTo(data, state, SEAT, ...hand);
    return state;
  }

  /** Every build move this seat is offered. */
  function builds(data: GameData, state: GameState): Extract<Move, { type: 'build' }>[] {
    return legalMoves(data, state).filter(
      (m): m is Extract<Move, { type: 'build' }> => m.type === 'build' && m.seat === SEAT,
    );
  }

  const w11 = BASE_GAME_DATA.cards.catalogue.find((c) => c.id === 'W11')?.buildCost;
  const W11_COST = (w11?.suit ?? 0) + (w11?.wild ?? 0);

  /**
   * V6: a coin pays any or all of a build cost. W11 The Bakehouse costs three
   * (two wheat and one wild), so a seat holding it and three coins builds it
   * with no other card at all.
   */
  it('lets coins pay a whole build cost, own-suit half included', () => {
    const state = builder(arm, 3, ['W11']);
    const allCoins = builds(arm, state).filter(
      (m) => m.card === 'W11' && m.payment.length === 0 && m.coins === W11_COST,
    );
    expect(allCoins).toHaveLength(1);
    const out = apply(arm, state, allCoins[0] as Move);
    expect(out.state.players[SEAT]?.tableau.some((b) => b.card === 'W11')).toBe(true);
    expect(coinsOf(out.state, SEAT)).toBe(0);
    // V5: the coins go straight back to the shared supply and may be minted again.
    expect(coinSupplyLeft(out.state)).toBe(10);
    expect(out.events).toContainEqual({
      e: 'coinsSpent',
      seat: SEAT,
      on: 'build',
      coins: W11_COST,
    });
  });

  /**
   * ⛔ COINS ARE A COUNT AND NEVER A CHOICE OF WHICH COINS. Five coins paying a
   * three-resource cost is ONE payment and not C(5, 3) = 10 of them. This is the
   * assertion that stands between the Build sink and the 888,030-move position.
   */
  it('offers one option per SPLIT and never one per choice of coins', () => {
    const state = builder(arm, 5, ['W11']);
    const forCard = builds(arm, state).filter((m) => m.card === 'W11');
    // The hand holds nothing but the card being built, so every payment is coins
    // alone: exactly ONE, at the full price.
    expect(forCard).toHaveLength(1);
    expect(forCard[0]?.coins).toBe(W11_COST);
    // And no two options for one card ever share a coin count, which is what
    // "one per split" means.
    expect(new Set(forCard.map((m) => m.coins ?? 0)).size).toBe(forCard.length);
  });

  /**
   * V6's second half is its own knob: with `coinPaysSuitCost` off a coin fills
   * only the WILD half of a cost, so a card printing an own-suit minimum can no
   * longer be bought in coins alone.
   */
  it('fills the n-of-suit half only under coinPaysSuitCost', () => {
    expect(w11?.suit).toBeGreaterThan(0);
    expect(builds(arm, builder(arm, 5, ['W11'])).some((m) => m.payment.length === 0)).toBe(true);
    expect(
      builds(wildOnly, builder(wildOnly, 5, ['W11'])).some((m) => m.payment.length === 0),
    ).toBe(false);
  });

  /**
   * ⭐ V7 NEEDS NO CODE AND THIS IS THE PROOF. A Power or Endgame card costs two
   * cards of its own suit (v31), and `coinPaysSuitCost` is what lets two coins
   * buy one. `rules.economy.endgameCoinCost` stays null in every Store arm, so
   * there is no second coin price anywhere in the game.
   */
  it('buys a Power or Endgame card for two coins (V7)', () => {
    expect(arm.rules.economy.endgameCoinCost).toBeNull();
    expect(BASE_GAME_DATA.cards.catalogue.find((c) => c.id === 'W19')?.buildCost).toEqual({
      suit: 2,
      wild: 0,
    });
    const state = builder(arm, 2, ['W19']);
    const move = builds(arm, state).find((m) => m.card === 'W19' && m.coins === 2);
    expect(move).toBeDefined();
    const out = apply(arm, state, move as Move);
    expect(out.state.players[SEAT]?.tableau.some((b) => b.card === 'W19')).toBe(true);
  });

  /** The sink is off in the Grow-only arm, so no build move carries a coin. */
  it('pays no build at all with coinPaysBuild off', () => {
    expect(
      builds(growOnly, builder(growOnly, 5, ['W11'])).every((m) => m.coins === undefined),
    ).toBe(true);
  });

  /** D6: a coin is not a card, so a payment of coins alone spends no cards. */
  it('never counts a coin as a card in the payment (D6)', () => {
    const state = builder(buildOnly, 5, ['W11']);
    const move = builds(buildOnly, state).find((m) => m.payment.length === 0);
    const out = apply(buildOnly, state, move as Move);
    const built = out.events.find((e) => e.e === 'built');
    expect(built?.e === 'built' ? built.payment : ['not a built event']).toEqual([]);
  });
});

describe('the Village Store coin: the Grow sink (V8, V9)', () => {
  const A5_THRESHOLD = BASE_GAME_DATA.cards.catalogue.find((c) => c.id === 'A5')
    ?.threshold as number;

  /**
   * A two-seat position with A5 The Meadow Hive built and `stack` cards on it,
   * plus A12 The Honey Hut beside it.
   *
   * A12 is there so that A5's printed ability - "GROW another of your buildings
   * without placing a card" - HAS a target: with nothing else on the table the
   * `activate` task it pushes has no legal answer and the drain loop silently
   * drops it, and a case asserting D5 off an ability that fired into nothing
   * would pass for the wrong reason.
   */
  function grower(data: GameData, coins: number, stack: number): GameState {
    const state = makeState(data, ['apiary', 'orchard']);
    if (coins > 0) giveCoins(state, SEAT, coins);
    buildFor(data, state, SEAT, 'A5', 'A12');
    if (stack > 0) loadStack(data, state, SEAT, 'A5', stack);
    return state;
  }

  function coinGrows(data: GameData, state: GameState): Extract<Move, { type: 'grow' }>[] {
    return legalMoves(data, state).filter(
      (m): m is Extract<Move, { type: 'grow' }> =>
        m.type === 'grow' && m.seat === SEAT && m.coinGrow === true,
    );
  }

  /** V8: a coin activates a building and PLACES NOTHING, so the stack does not move. */
  it('activates a building for one coin and places nothing (V8)', () => {
    const state = grower(arm, 2, 0);
    const move = coinGrows(arm, state).find((m) => m.building === 'A5');
    expect(move).toBeDefined();
    expect(move?.payment).toBeNull();
    const out = apply(arm, state, move as Move);
    // ⭐ NOTHING PLACED: the stack is exactly as it was, so the building does
    // not advance toward its threshold and never clogs. That is the whole of V8.
    expect(out.state.players[SEAT]?.tableau.find((x) => x.card === 'A5')?.stack).toEqual([]);
    expect(coinsOf(out.state, SEAT)).toBe(1);
    expect(coinSupplyLeft(out.state)).toBe(9);
    expect(out.events).toContainEqual({ e: 'coinsSpent', seat: SEAT, on: 'grow', coins: 1 });
    // ⭐ D5: THE "WHEN ACTIVATED" ABILITY FIRED, which is the whole point of a
    // Grow and is stated because V8 places no card and a reader may assume
    // otherwise. A5 prints "GROW another of your buildings without placing a
    // card", so a pending `activate` task naming A12 IS the ability firing.
    // (`turn.firedThisTurn` cannot be read here: with the task pending the turn
    // has not settled, and once it does the whole `TurnState` is replaced.)
    expect(out.state.tasks[0]?.t).toBe('activate');
  });

  /**
   * ⭐ V9: A FULL BUILDING IS A LEGAL TARGET, and it is the first clog bypass in
   * this game since the meeples. The gate reads `canTakeCard` - the CLOG
   * question - and not `isHarvestable`, which stopped being the same boolean on
   * 10/09/2026, and it asks `coinGrowReachesFullBuildings`, the COMBINING
   * accessor, never the raw leaf.
   */
  it('reaches a FULL building, and only under coinGrowOnFullBuilding (V9)', () => {
    const state = grower(arm, 2, A5_THRESHOLD);
    const b = state.players[SEAT]?.tableau.find((x) => x.card === 'A5');
    expect(isFull(arm, b as never)).toBe(true);
    expect(isHarvestable(arm, b as never)).toBe(true);
    expect(coinGrowReachesFullBuildings(arm)).toBe(true);
    const out = apply(arm, state, coinGrows(arm, state).find((m) => m.building === 'A5') as Move);
    expect(out.state.players[SEAT]?.tableau.find((x) => x.card === 'A5')?.stack).toHaveLength(
      A5_THRESHOLD,
    );
    expect(out.state.tasks[0]?.t).toBe('activate');

    // ⭐ AND THE CLAUSE IS ITS OWN LEAF. `growOpen` keeps the Grow sink and
    // turns V9 off: an OPEN building is still a coin-Grow target and a clogged
    // one is not.
    expect(coinGrowReachesFullBuildings(growOpen)).toBe(false);
    const clogged = coinGrows(growOpen, grower(growOpen, 2, A5_THRESHOLD));
    expect(clogged.filter((m) => m.building === 'A5')).toHaveLength(0);
    // A12 beside it is open, so the Grow SINK is plainly still on and it is V9
    // alone that has gone.
    expect(clogged.filter((m) => m.building === 'A12')).toHaveLength(1);
    expect(
      coinGrows(growOpen, grower(growOpen, 2, 0)).filter((m) => m.building === 'A5'),
    ).toHaveLength(1);
  });

  /** A card-paid Grow still refuses a full building: V9 is the coin's rule alone. */
  it('leaves the card-paid Grow refusing a full building', () => {
    const state = grower(arm, 0, A5_THRESHOLD);
    // An apiary card straight off the deck top, because `loadStack` has already
    // eaten the ones a test could name.
    const inHand = state.decks.apiary.shift() as CardId;
    state.players[SEAT]?.hand.push(inHand);
    expect(growOptions(arm, state, SEAT).filter((o) => o.building === 'A5')).toHaveLength(0);
    // And it is only A5 that is out of reach: A12 is open and takes the card.
    expect(growOptions(arm, state, SEAT).some((o) => o.building === 'A12')).toBe(true);
  });

  /**
   * ⛔ COINS CANNOT MULTIPLY ACTIONS, which is what makes the full-building
   * ruling safer than it reads: the standing fire-once-per-turn guard means the
   * same building can never be coin-grown twice in a turn.
   */
  it('never grows the same building twice in one turn', () => {
    const state = grower(arm, 5, 0);
    const out = apply(arm, state, coinGrows(arm, state).find((m) => m.building === 'A5') as Move);
    expect(coinGrows(arm, out.state).filter((m) => m.building === 'A5')).toHaveLength(0);
  });

  /** The sink is off in the Build-only arm, so no coin-Grow is ever offered. */
  it('offers no coin-Grow with coinPaysGrow off', () => {
    expect(coinGrows(buildOnly, grower(buildOnly, 5, 0))).toHaveLength(0);
  });
});

describe('the Village Store coin: what a coin may NOT do (V10 to V12)', () => {
  /**
   * ⛔ V10: NEVER A VISIT, A HARVEST OR A DELIVER. A seat with a full wallet and
   * an empty barn has exactly the options a broke one has on those three routes,
   * which is the only way to state a negative rule without naming every path
   * into it. The two SINKS are excluded from the comparison on purpose: they are
   * the rule rather than a breach of it.
   */
  it('buys no visit, no Harvest and no Deliver (V10)', () => {
    const kinds = (data: GameData, s: GameState): string[] =>
      legalMoves(data, s)
        .filter((m) => m.seat === SEAT)
        .filter((m) => m.type !== 'build' && m.type !== 'grow')
        .map((m) => m.type)
        .sort();
    const rich = makeState(arm, ['wheat', 'orchard']);
    giveCoins(rich, SEAT, 10);
    const poor = makeState(arm, ['wheat', 'orchard']);
    expect(kinds(arm, rich)).toEqual(kinds(arm, poor));
    expect(coinsOf(rich, SEAT)).toBe(10);
  });

  /**
   * V11 and V12: coins score nothing at any rate and do not reach the tie-break
   * of most cards in hand and barn combined. Two seats set up identically, one
   * of them holding the entire supply, score and rank identically.
   */
  it('scores nothing and does not reach the tie-break (V11, V12)', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    const plain = score(arm, state);
    giveCoins(state, SEAT, 10);
    const rich = score(arm, state);
    expect(rich.seats).toEqual(plain.seats);
    expect(rich.ranking).toEqual(plain.ranking);
    expect(rich.seats[SEAT]?.total).toBe(rich.seats[OTHER]?.total);
  });
});

describe('O17 The Fruit Basket: from your hand, and only from your hand (A150)', () => {
  /**
   * ⛔ THE LOOP THIS CLOSES. O17 read "instead of discarding a card you spend,
   * put it into your barn". A card paid into the exchange IS a card you spend,
   * so the card would have returned it to the barn while its owner kept the
   * coin: a SECOND MINT, once per turn, free, on every turn its owner delivers.
   *
   * The exchange deliberately does not route through `divertOrDiscard` or the
   * `afterBuild` hook at all, so this asserts the PROPERTY rather than the
   * mechanism - which is the right shape for a "must never happen" case.
   */
  it('never lifts a card back out of the exchange', () => {
    // Seat 0 is the WHEAT seat, because tile A1's demand follows the seats'
    // suits; O17 is simply built into that tableau, which needs no Orchard seat.
    const state = makeState(arm, ['wheat', 'orchard']);
    buildFor(arm, state, SEAT, 'O17');
    stockBarn(state, SEAT, 'wheat', 4);
    stockBarn(state, SEAT, 'orchard', 2);
    const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
    const one = convert(arm, out.state, 'orchard');
    expect(one.state.players[SEAT]?.barn).toHaveLength(1);
    expect(one.state.discards.orchard).toHaveLength(1);
    // Nothing but the mint itself is pending, so no divert can claim the card.
    expect(one.state.tasks.every((t) => t.t === 'mint')).toBe(true);
    expect(coinsOf(one.state, SEAT)).toBe(1);
  });

  /**
   * And the card still does its job on a BUILD payment, which IS a hand
   * discard: the restriction narrows O17, it does not delete it.
   */
  it('still takes a card out of a build payment, which is a hand spend', () => {
    const state = makeState(arm, ['wheat', 'orchard']);
    buildFor(arm, state, SEAT, 'O17');
    dealTo(arm, state, SEAT, 'O11', 'O12', 'O13', 'O14');
    const move = legalMoves(arm, state).find(
      (m): m is Extract<Move, { type: 'build' }> =>
        m.type === 'build' && m.seat === SEAT && m.payment.length > 0,
    );
    const out = apply(arm, state, move as Move);
    expect(out.state.tasks[0]?.t).toBe('card');
    expect(out.state.tasks[0]?.t === 'card' ? out.state.tasks[0].kind : '').toBe('basket');
  });
});

describe('the Village Store coin: inertness at the shipped values', () => {
  /**
   * ⛔ ABSENT AND NOT PRESENT-AND-ZERO. Nine fixtures replay byte-identically
   * and depend on the key being missing, which is the register
   * `GameState.commons` and `PlayerState.coins` are already written in.
   */
  it('carries no supply and no wallet in the shipped game or in either control', () => {
    for (const data of [BASE_GAME_DATA, control, cardVisitGame()]) {
      const state = newGame(data, { seats: 2, seed: 'inert' });
      expect(Object.hasOwn(state, 'coinSupply')).toBe(false);
      expect(Object.hasOwn(player(state, SEAT), 'coins')).toBe(false);
      expect(JSON.stringify(state).includes('coinSupply')).toBe(false);
    }
  });

  /** And the arm DOES carry both, or the mint would have nothing to draw on. */
  it('carries both under the arm, sized by seats', () => {
    const state = newGame(arm, { seats: 3, seed: 'inert' });
    expect(state.coinSupply).toBe(15);
    expect(player(state, SEAT).coins).toBe(0);
    expect(() => coinSupplyLeft(state)).not.toThrow();
  });

  /** The accessor throws rather than reading a silent zero. */
  it('throws rather than reading a silent zero', () => {
    const state = newGame(control, { seats: 2, seed: 'inert' });
    expect(() => coinSupplyLeft(state)).toThrow(/no Village Store supply/);
  });

  /**
   * With the Store off a delivery queues no task and no move carries a coin,
   * which is the one-line form of what the nine fixtures assert at length.
   */
  it('queues no exchange and offers no coin option with the Store off', () => {
    const state = makeState(control, ['wheat', 'orchard']);
    stockBarn(state, SEAT, 'wheat', 8);
    const out = apply(control, state, {
      type: 'deliver',
      seat: SEAT,
      tile: 'A1',
      spend: { wheat: 4 },
    });
    expect(out.state.tasks).toHaveLength(0);
    expect(
      legalMoves(control, out.state).every(
        (m) =>
          (m.type !== 'build' || m.coins === undefined) &&
          (m.type !== 'grow' || m.coinGrow === undefined),
      ),
    ).toBe(true);
  });
});
