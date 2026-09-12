/**
 * GROW: activate your own building by paying its activation cost into its stack.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { canTakeCard, cardById, coinsOf, faceOf, player } from '../query.js';
import type { CardId, GameState, Seat } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import {
  coinGrowReachesFullBuildings,
  coinPaysGrow,
  farmsteadCoinPower,
  meepleAsCardGoesToBoard,
} from '@gp/data';
import { meepleAsCard, placementsFor } from './meeples.js';
import { withoutFirst } from './shared.js';

// --- Grow ------------------------------------------------------------------

/**
 * ⭐ WHAT THE FARMSTEAD'S ACTIVATION COSTS (K10, Dean 10/09/2026): ONE COIN.
 *
 * A constant rather than a knob, deliberately, and the handoff's knob list
 * agrees: `rules.economy.farmsteadPower.*` carries the four numbers behind the
 * POWERS, which are what a sweep would move, and the price is the rule - "spend
 * a coin instead of a card", Dean's own words. If it ever becomes a dial it
 * goes in `rules.economy` beside those four, and this constant is the one place
 * to re-point.
 */
const FARMSTEAD_COIN_COST = 1;

/**
 * ⭐ WHAT A VILLAGE STORE COIN-GROW COSTS (V8, Dean 12/09/2026, ledger A150):
 * ONE COIN.
 *
 * A constant and not a knob, on exactly the reasoning `FARMSTEAD_COIN_COST`
 * above carries: "a coin is a wild CARD for GROW" is the rule, and a Grow is
 * paid with one card, so the price is one. The dials this package DOES sweep are
 * the mint rate, the supply per player and the four on/off leaves. If a rate for
 * this ever becomes a question it goes in `rules.economy` and this is the one
 * line to re-point.
 */
const COIN_GROW_COST = 1;

export interface GrowOption {
  building: CardId;
  /** Null when a meeple paid (R15) or a coin did (K10): nothing is placed. */
  payment: CardId | null;
  /**
   * ⭐ K10: this GROW is paid with ONE COIN and the target is the seat's own
   * FARMSTEAD. Mutually exclusive with `payment` and with `meeples`; nothing is
   * placed, so the Farmstead's stack stays empty for the whole game and its
   * "no threshold" is the printed rule rather than a special case.
   */
  coin?: true;
  /**
   * ⭐ V8/V9 (A150, Dean 12/09/2026): THIS GROW IS PAID WITH ONE VILLAGE STORE
   * COIN. `payment` is null and nothing is placed, so the building does not
   * advance toward its threshold and never clogs; a FULL building is a legal
   * target under `coinGrowReachesFullBuildings`.
   *
   * ⛔ IT IS NOT `coin` ABOVE, AND THE TWO MUST NOT BE MERGED. `coin` is K10,
   * the OTHER coin arm's Farmstead suit power: a different knob, a different
   * target (the Farmstead alone), a different sink label on `coinsSpent`, and
   * `observe.ts` counts `move.coin === true` as a Farmstead firing. Folding V8
   * into that flag would silently add every coin-Grow to a metric that means
   * something else. The two are mutually exclusive by construction - no overlay
   * turns both economies on - and each says so.
   *
   * ⭐ D5: A COIN-GROW FIRES "WHEN ACTIVATED" ABILITIES. That is the whole
   * point of a Grow, and it is stated because V8 places no card and a reader may
   * assume otherwise. ⚠️ What does NOT fire is anything keyed on a PLACEMENT -
   * A16 The Beekeeper's Veil is the obvious one - because a coin places nothing.
   */
  coinGrow?: true;
  /**
   * R15: the meeple that paid, or the two meeples spent as a wild pair (R10).
   * It goes STRAIGHT TO THE BOX - never onto the stack, never toward the
   * threshold - which is why `atThreshold` below can ever be true.
   */
  meeples?: Suit[];
  /**
   * True when the building was ALREADY AT ITS THRESHOLD and only a meeple could
   * have activated it. Carried on the option rather than re-derived, because it
   * is the measurement v2 section 3 asks for by name: the priced clog bypass,
   * counted apart from every other meeple exit.
   */
  atThreshold?: boolean;
  /** R17: where the paid meeple(s) land, by seat, and the toll they owed. */
  placements?: Partial<Record<Suit, number>>[];
  paymentToll?: Partial<Record<Suit, number>>;
}

/**
 * ⛔ `activationSurchargeOf` AND `harvestSurchargeOf` ARE GONE (v31). Both read
 * a printed GBP 1 toll off a data trigger - `activationSurcharge` ("You must pay
 * £1 to activate this card", A8 The Wild Hive) and `harvestSurcharge` ("You must
 * pay £1 to Harvest this Field", W8) - and both were checked at legality and
 * paid after the card landed.
 *
 * They go with the currency, and the v31 extract confirms it: NO card in the
 * catalogue carries either trigger any more. The pattern is worth remembering
 * though, because it is the right one for a printed toll: keyed on a DATA
 * TRIGGER so no funnel names a card, checked in the enumerator so an unaffordable
 * target is never offered, and charged in the funnel so the two cannot disagree.
 * If a toll returns it will be priced in cards or in a discard, which is the
 * only currency left.
 */

/** What a caller may relax about a GROW's targeting. */
export interface GrowOptionMods {
  /** A6 The Garden Hive: pay with a card of any crop. */
  anyCrop?: boolean;
  /** Never these buildings (A6's "ANOTHER of your buildings"). */
  exclude?: readonly CardId[];
  /**
   * Ask as if this card had already left the hand - the commons FEE (C3), which
   * lands before the action it buys and so cannot also pay for it.
   *
   * It is `workerActionLegal`'s `excludingHandCard` arriving at the one action
   * that had no way to take it, and the gate and the action must be handed the
   * same modifiers or a door is offered and then wedged (see that function's
   * own warning, which cost hours on 19/08/2026).
   */
  excludeHandCard?: CardId;
  /**
   * The WILD PAIR's second fee (K3, 10/09/2026): the same rule as
   * `excludeHandCard`, for the second of the two cards paying one board. Set
   * only by `doorActionLegal`, and only under `commonsWildPair`.
   */
  excludeHandCard2?: CardId;
  /**
   * ⭐ IS THIS THE MAIN-ACTION GROW? (Builder default D-C1, ruled by Dean on
   * 10/09/2026.)
   *
   * It gates ONE THING, in one place: the coin-activated FARMSTEAD (K10) is a
   * Grow target only when this is true. `legalMoves`'s Grow branch is the only
   * caller that sets it. The Apiary board's BOUGHT Grow pushes a `grow` TASK
   * whose answers come from this same enumerator WITHOUT it, so a bonus can
   * never buy a suit power - which is Dean's ruling that the Farmstead is your
   * main action, expressed as one flag rather than as a second enumerator.
   *
   * ⚠️ THE GATE AND THE ACTION MUST AGREE, as ever: `doorActionLegal`'s
   * `'grow'` branch omits it too, so the Apiary board is never OFFERED on the
   * strength of a Farmstead the task could not then fire.
   */
  mainAction?: boolean;
  /**
   * ⭐ DEAN'S DAIRY EXPERIMENT (12/09/2026): the GROW may target ONLY this
   * building, the one the Dairy board's own Build just made.
   */
  onlyBuilding?: CardId;
}

/**
 * Own non-full buildings with a printed activation type, never the Notice
 * Board (porting guard: it passes the placement check but is not a Grow
 * target), paid with a matching hand card ('wild' takes any). Surcharged
 * buildings drop out when the seat cannot pay.
 *
 * ⛔ THE APIARY CROP WAIVER IS GONE (2026-08-11). It used to be the Apiary
 * Farmstead's base power, live from turn 1 for a whole suit; it now survives
 * only as `mods.anyCrop`, which one card - A6 The Garden Hive - pays for.
 *
 * A card whose text has already FIRED this turn drops out, which is the shared
 * half of the Apiary recursion guard: the ruling is that no card's text may
 * fire twice in a turn, and it holds for a real GROW as well as for A5/A12's
 * activation with no placement. In ordinary play it is not binding - the GROW
 * action is the first thing that fires anything - and it is what stops O13 The
 * Grand Orchard re-entering an Apiary card in a mixed tableau.
 */
export function growOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  mods: GrowOptionMods = {},
): GrowOption[] {
  const p = player(state, seat);
  const withoutFee =
    mods.excludeHandCard === undefined ? p.hand : withoutFirst(p.hand, mods.excludeHandCard);
  const hand =
    mods.excludeHandCard2 === undefined
      ? withoutFee
      : withoutFirst(withoutFee, mods.excludeHandCard2);
  const out: GrowOption[] = [];
  const only = mods.onlyBuilding;
  const asCard = meepleAsCard(data);
  const onBoard = meepleAsCardGoesToBoard(data);
  const rate = data.rules.turn.paymentSlotToll;
  // ⭐ THE COIN-ACTIVATED FARMSTEAD (K10, Dean 10/09/2026), and it is false in
  // the shipped game twice over: the knob is off, and `mods.mainAction` is set
  // by exactly one caller. Hoisted so the loop below is byte-identical when it
  // is false.
  const farmsteadCoin = farmsteadCoinPower(data) && mods.mainAction === true;
  for (const b of p.tableau) {
    // Dean's Dairy experiment: one legal target, the building just built.
    if (only !== undefined && b.card !== only) continue;
    if (cardById(data, b.card).slot === 'noticeboard') continue;
    if (state.turn.firedThisTurn.includes(b.card)) continue;
    if (mods.exclude?.includes(b.card)) continue;
    // ⭐ K10: THE FARMSTEAD IS A BUILDING WITH NO THRESHOLD WHOSE ACTIVATION
    // COST IS ONE COIN, used as a GROW that is your MAIN action, once per turn,
    // with NOTHING PLACED ON IT.
    //
    // ⚠️ IT IS FOUND BY SLOT AND NOT BY `activationType`. The v35 sheet prints
    // the Farmstead's activation cost as `coin`, but `cards.json` is pinned at
    // v32 (which prints `null`) and the arm is measured on handlers alone, so
    // the engine may not read a coin off a card face that does not yet carry
    // one. `slot === 'farmstead'` is the same rule the sheet states and it
    // needs no re-extract; if a `coin` activation type ever lands in the data,
    // this is the line that reads it instead.
    //
    // ⭐ AND IT IS FILTERED, NEVER THROWN. Both gates - the coin and the
    // once-per-turn latch (`firedThisTurn`, the guard just above, which is
    // shared with every other fire-once rule) - drop the option out of the list
    // rather than refusing it later: bots probe by cloning and applying, so a
    // throw from an enumerator surfaces as a crash in probe.ts rather than as a
    // move nobody chose.
    if (farmsteadCoin && cardById(data, b.card).slot === 'farmstead') {
      if (coinsOf(state, seat) >= FARMSTEAD_COIN_COST) {
        out.push({ building: b.card, payment: null, coin: true });
      }
      continue;
    }
    const type = faceOf(data, b).activationType;
    if (type === null) continue;
    // ⭐ THE FULL-BUILDING GATE MOVED OFF THE TOP OF THIS LOOP (R15). It used
    // to be the first line, and it belonged there while every Grow placed a
    // card. A meeple-paid Grow places NOTHING, so the only reason a full
    // building cannot be grown does not apply to it, and Dean ruled the
    // consequence in on 04/09/2026 evening: a meeple can activate a building
    // already at its threshold, the ability fires, nothing is added, the
    // building stays as it was. It is a PRICED CLOG BYPASS and it is deliberate.
    const open = canTakeCard(data, b);
    if (open) {
      for (const card of hand) {
        if (mods.anyCrop === true || type === 'wild' || cardById(data, card).suit === type) {
          out.push({ building: b.card, payment: card });
        }
      }
    }
    // ⭐ V8/V9's OPTION (A150, Dean 12/09/2026): ONE COIN, NOTHING PLACED.
    //
    // ⛔ THE FULL-BUILDING GATE READS `canTakeCard` AND NOT `isHarvestable`,
    // and the two stopped being the same boolean on 10/09/2026 (query.ts:182).
    // "Full" in V9 means CLOGGED - the building refuses a card - which is
    // exactly `!canTakeCard`, and it is the right half because the ONLY reason a
    // full building cannot be grown is that no card may be placed on it. A
    // `3+` Notice Board is harvestable at three cards and clogged at none, so
    // reading `isHarvestable` here would refuse a coin-Grow on a board that
    // happily takes cards.
    //
    // ⛔ AND IT ASKS `coinGrowReachesFullBuildings`, THE COMBINING ACCESSOR,
    // NEVER THE RAW `coinGrowOnFullBuilding` LEAF. A full building is reachable
    // only if a coin pays a Grow AT ALL, and that precedence lives in one place
    // in @gp/data - the `hostGift` seam of 12/09/2026 was a term reading a rule
    // off the wrong accessor and pricing a decision that could not happen.
    //
    // ⚠️ IT IS THE FIRST CLOG BYPASS SINCE THE MEEPLES AND IT IS DELIBERATE.
    // Its brake is that it is self-limiting: a building you only ever coin-Grow
    // never fills, so it is never harvested, so it never puts cards in your
    // barn - and barn cards are what make coins. Spending coins to dodge clog
    // starves the supply of the material that makes coins. ⛔ C110 records the
    // consequence: the Tier 3 layer was priced with clog as its brake and needs
    // re-pricing. That is card-balance work and not a reason to reopen the rule.
    const coinGrows = coinPaysGrow(data) && coinsOf(state, seat) >= COIN_GROW_COST;
    if (coinGrows && (open || coinGrowReachesFullBuildings(data))) {
      out.push({
        building: b.card,
        payment: null,
        coinGrow: true,
        // The clog bypass, counted apart from every other Grow: `atThreshold`
        // is the measurement v2 section 3 asks for by name and V9 is the
        // strongest clause in the package, so it must be readable on its own.
        ...(open ? {} : { atThreshold: true }),
      });
    }
    if (!asCard) continue;
    const atThreshold = !open;
    const anyColour = mods.anyCrop === true || type === 'wild';
    // ⭐ R17: a meeple paid for a Grow LANDS ON A NEIGHBOUR'S BOARD like any
    // other payment. `emit` is the one seam: with R17 off it pushes the option
    // as v2 had it, and with R17 on it pushes one option per legal placement.
    const emit = (meeples: Suit[]): void => {
      if (!onBoard) {
        out.push({ building: b.card, payment: null, meeples, atThreshold });
        return;
      }
      const counts: Partial<Record<Suit, number>> = {};
      for (const m of meeples) counts[m] = (counts[m] ?? 0) + 1;
      for (const spot of placementsFor(data, state, seat, counts, rate)) {
        out.push({
          building: b.card,
          payment: null,
          meeples,
          atThreshold,
          placements: spot.boards,
          paymentToll: spot.toll,
        });
      }
    };
    if (anyColour) {
      // Any meeple pays a wild activation, so a pair never helps and is never
      // offered: two meeples for what one buys is a dominated payment.
      for (const colour of data.cards.suits) {
        if ((p.meeples[colour] ?? 0) < 1) continue;
        emit([colour]);
      }
      continue;
    }
    // `type` is a Suit here: `anyColour` above already took the 'wild' case.
    const colour = type as Suit;
    if ((p.meeples[colour] ?? 0) > 0) {
      emit([colour]);
      continue;
    }
    // ⭐ THE PAIR IS THE LAST RESORT AND ONLY THE LAST RESORT, on exactly the
    // rule `enumerateMeepleVisits` uses: a colour you hold you would always
    // spend singly, so a pair is enumerated only for a colour you do not hold.
    // Without that guard the option list carries every pair beside every single
    // for every building on the table.
    for (const pair of meeplePairs(data, p.meeples)) {
      emit([pair[0], pair[1]]);
    }
  }
  return out;
}

/**
 * Unordered PAIRS out of a supply, as colour lists, including two of one colour
 * where the cap allows it.
 *
 * A count vector would be the shape everywhere else in this file, but a pair is
 * always exactly two meeples and never more, so the list is its own canonical
 * form and short enough to read at a call site. Suit order, then ascending, so
 * the enumeration order is fixed.
 */
export function meeplePairs(
  data: GameData,
  supply: Readonly<Record<Suit, number>>,
): [Suit, Suit][] {
  const out: [Suit, Suit][] = [];
  const suits = data.cards.suits;
  for (let i = 0; i < suits.length; i++) {
    const a = suits[i];
    if (a === undefined || (supply[a] ?? 0) < 1) continue;
    if ((supply[a] ?? 0) >= 2) out.push([a, a]);
    for (let j = i + 1; j < suits.length; j++) {
      const b = suits[j];
      if (b === undefined || (supply[b] ?? 0) < 1) continue;
      out.push([a, b]);
    }
  }
  return out;
}

/**
 * "ANOTHER OF YOUR BUILDINGS" - the target set for an activation that places no
 * card (A5 The Meadow Hive, A12 The Honey Hut).
 *
 * Deliberately WIDER than `growOptions`: a FULL building is legal, because the
 * only reason a full building cannot be grown is that no card may be placed on
 * it, and nothing is being placed. It is also deliberately narrower in one
 * place: the NOTICE BOARD is never a target, because its text is a VISITOR
 * ability. ⚠️ That exclusion is load-bearing rather than tidiness, and more so
 * in v31 than before: the board's text IS the bonus slot's payoff, so a card
 * that reached it would be handing out a free bonus option. (The `service` slot
 * used to be excluded on the same grounds; it stopped existing on 20/08/2026.)
 *
 * `exclude` is the card doing the firing; `turn.firedThisTurn` is everything
 * that has already fired, and filtering it here rather than throwing at
 * resolution is what keeps the bots' speculative replays from crashing.
 */
export function activateTargets(
  data: GameData,
  state: GameState,
  seat: Seat,
  exclude: readonly CardId[] = [],
): CardId[] {
  return player(state, seat)
    .tableau.filter((b) => faceOf(data, b).activationType !== null)
    .filter((b) => cardById(data, b.card).slot !== 'noticeboard')
    .filter((b) => !exclude.includes(b.card))
    .filter((b) => !state.turn.firedThisTurn.includes(b.card))
    .map((b) => b.card);
}
