/**
 * DELIVER, and everything the island asks for: the TOKEN ISLAND of 16/09/2026
 * (Dean, rulings R3, R6, R7 and R9; docs/vegetable-token-island-handoff-2026-09-16-v1.md).
 *
 * THE RULE, IN FULL:
 *
 *   - Every tile holds two TOKENS at setup. A token is a demand (2 cards of one
 *     crop, or WILD: any 2 cards), a VP value (3 to 6) and, on the 3 and 4 VP
 *     tokens, a WORKER (the delivery meeple).
 *   - A delivery is ALWAYS `deliveryCost` (4) barn cards, barn only, and there
 *     is no substitution (R4).
 *   - FIRST delivery on a tile: pay BOTH tokens' demands, then CHOOSE which
 *     token to take as the receipt, with its Worker.
 *   - SECOND delivery: pay the remaining token's demand plus 2 cards of ANY
 *     crops, and take it. The tile is finished.
 *   - The one payment rule is `tileDemand` in `@gp/data`: named crops plus the
 *     rest in any crops, always totalling `deliveryCost`.
 *   - THE VEGETABLE BOARD (R9) relaxes one delivery: up to `wildCards` of its
 *     cards may miss the named demand (`demandShortfall`). ⚠️ BUILDER DEFAULT:
 *     on a second delivery the relaxed cards may cover the token's pair too.
 *   - A receipt KEEPS ITS CROP (R7): `PlayerState.receipts` holds VP, crop and
 *     tile.
 *   - PAYING FOR A DELIVERY IS NOT A DISCARD (R6). The payment goes through
 *     `fx.spendFromBarn` and nothing else, and no "discard from your barn" hook
 *     may ever be fired from this file; when V17's hook lands it belongs to the
 *     card-effect discard step, not here.
 *
 * ⛔ DELETED WITH THE TOKEN ISLAND: the delivery SPACES (6 VP to the first
 * arrival, 3 VP to the second, and the 14/09/2026 space choice), the crates
 * and their demand tokens, and V6's face-down token. V5's swap survives as
 * `tokenSwapOptions` plus `fx.swapIslandTokens`.
 *
 * Split out of actions.ts on 2026-09-12.
 */

import type { Fx } from '../fx.js';
import { fireHook } from '../fx.js';
import { cardById, isHarvestable, player } from '../query.js';
import type { CardId, GameState, IslandTileState, Receipt, Seat, TaskAnswer } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import { deliveryCost, demandShortfall, meepleAsCardGoesToBoard, tileDemand } from '@gp/data';
import { assertPlacementMatches, meepleAsCard, meepleCount, placementsFor } from './meeples.js';
import { barnTally } from './shared.js';

// --- T4b (24/09/2026): two new, OFF-BY-DEFAULT payment sources -------------
//
// Sheet v48 gives two cards their own way to reach `deliveryCost` (4) cards
// beyond the plain barn (`tasks/v48-rulings-v2.md` R4, R8 for A8; the
// builder-defaults paragraph for O12; `tasks/v48-ambiguity-audit-v1.md` Q3
// and the O12 rows). NEITHER CARD'S HANDLER IS WIRED HERE - this file only
// grows the primitive two later tasks will call from `apiary.ts` (A8) and
// `orchard.ts` (O12), exactly as V14 already calls `doDeliver` directly with
// `takeAll: true` rather than going through the generic `t: 'deliver'` task.
//
//   - `fromFullBuildings` (A8 The Wild Hive, "Deliver, using cards from your
//     Barn and cards on full buildings"): every card on one of the SEAT'S
//     OWN full buildings joins the barn in one pool, no budget beyond what is
//     physically there (R8: "every card on a full building may pay"). It
//     merges straight into the same crop tally the barn already uses -
//     exactly how the meeple supply already joins it under R15 - so it costs
//     nothing extra in branching. "Full" is `isHarvestable`, not `isFull`:
//     that is deliberately the ONE reading under which a `3+` Notice Board
//     counts (R4), because `isFull` answers false for a Notice Board forever
//     (S8) and would silently drop the card's best target.
//   - `handCard` (O12 The Fruit Press, "you may spend 1 card from your hand
//     in the Delivery"): AT MOST ONE card, paying as its own crop (never
//     wild). A hand card cannot join the pooled tally the way barn, meeple
//     and building cards do: two different suits could each look one card
//     short and both get "topped up" by a merged tally, spending what would
//     read as two hand cards for a card that owns one. So `deliverOptions`
//     tries each crop the hand holds as its OWN one-card bump, one candidate
//     pool per crop (at most five), additive rather than multiplicative with
//     the barn/meeple/building enumeration - see the `candidates` loop below.
//     The literal card id is a follow-up choice, not part of the delivery
//     answer (`DeliverOption.handCrop` says which CROP; `DeliverChoice.
//     handCard` names the literal id at resolution), the same shape A8's
//     `buildingSpend` uses for which building loses which cards.
//
// Both default OFF (`false`), so every existing call site - the plain Deliver
// action, the Vegetable door, a Worker's Deliver, V14 - reads a tally and an
// option count byte-identical to before this pass.
//
// ⭐ FIXED 24/09/2026: `meepleShare` in `doDeliver` is now asked about the
// part of `spend` the BARN itself owes (`spend` minus `fromBuildings` minus
// `fromHand`), never the whole `spend`. It does not check
// `meepleAsCard(data)` on its own, only whether the supply happens to hold a
// card of the short colour - which it usually does in the shipped game, the
// delivery meeple being a normal component whether or not R15 is live - so
// handing it the FULL `spend` while A8's buildings or O12's hand card were
// already covering part of it made it see a barn "shortfall" that was really
// theirs, and misattribute it to the meeple supply. See `doDeliver`'s
// `barnOwed` for where this is computed, right before both `meepleShare`
// calls.

// --- Deliver ---------------------------------------------------------------

export interface DeliverOption {
  tile: string;
  /** ⭐ The token this option takes: an index into the tile's `tokens`. */
  token: number;
  spend: Partial<Record<Suit, number>>;
  /**
   * R15 (the meeple-as-card control): the part of `spend` paid out of the
   * SUPPLY rather than the barn, per colour. Absent when the barn covered it
   * all. Derived BARN FIRST, never enumerated: a barn card pays the island and
   * nothing else, a meeple is a stored action, so spending the barn first is the
   * better half of that trade bar the tie-break.
   */
  meeples?: Partial<Record<Suit, number>>;
  /** R17: where the paid meeples land, by seat, and the toll they owed. */
  placements?: Partial<Record<Suit, number>>[];
  paymentToll?: Partial<Record<Suit, number>>;
  /**
   * O12 (`handCard`, T4b): the ONE crop this option's extra hand card pays
   * as, present only when `spend` actually uses it (a spend `handCard` could
   * reach but does not need is offered once, with this absent, not twice).
   * Absent under every other option. The literal card id is a follow-up
   * choice: pass it as `DeliverChoice.handCard` to `doDeliver`.
   */
  handCrop?: Suit;
}

/**
 * How many island tokens this seat has taken: its receipt count, which is the
 * end trigger's clock. Read off the island's public record (`deliveredBy` holds
 * one entry per token taken), so V14's double take counts as two.
 */
export function islandDeliveriesBy(state: GameState, seat: Seat): number {
  let n = 0;
  for (const tile of state.island.tiles) {
    for (const who of tile.deliveredBy) if (who === seat) n += 1;
  }
  return n;
}

/**
 * Is this tile still open? A tile is finished exactly when its last token has
 * been taken. One place, because every route to a delivery has to agree.
 */
export function tileHasRoom(_data: GameData, tile: IslandTileState): boolean {
  return tile.tokens.length > 0;
}

/**
 * The token indices a delivery to this tile may take, in the order they are
 * offered: highest VP first, ties by index. Deterministic, so the answer list
 * is stable.
 */
export function tokenChoices(tile: IslandTileState): number[] {
  return tile.tokens
    .map((token, i) => ({ vp: token.vp, i }))
    .sort((a, b) => b.vp - a.vp || a.i - b.i)
    .map((x) => x.i);
}

// --- V5's token swap --------------------------------------------------------

/** A token on the island, addressed the way the swap and its event do. */
export interface TokenRef {
  tile: string;
  token: number;
}

/** @deprecated The crate island's name for a token reference (before 16/09/2026). */
export type DemandRef = TokenRef;

/**
 * ⭐ V5's TARGETS ON THE TOKEN ISLAND: every pair of tokens on two DIFFERENT
 * tiles that still hold them. A tile that is finished holds nothing, so a
 * delivery already made is never re-priced.
 *
 * ⚠️ BUILDER DEFAULT, NOT RULED (handoff §5 item 3): the lone token of a
 * half-finished tile may be swapped. A pair of IDENTICAL tokens (same demand,
 * VP and Worker) is a no-op and is never offered. Every other pair produces a
 * different island, because the token set holds no duplicates bar the wild
 * values a large wild count cycles.
 */
export function tokenSwapOptions(_data: GameData, state: GameState): [TokenRef, TokenRef][] {
  const refs: { ref: TokenRef; t: number; key: string }[] = [];
  state.island.tiles.forEach((tile, t) => {
    tile.tokens.forEach((token, i) => {
      refs.push({
        ref: { tile: tile.tile, token: i },
        t,
        key: `${token.demand}/${token.vp}/${token.worker ?? '-'}`,
      });
    });
  });
  const out: [TokenRef, TokenRef][] = [];
  for (let i = 0; i < refs.length; i++) {
    const a = refs[i] as (typeof refs)[number];
    for (let j = i + 1; j < refs.length; j++) {
      const b = refs[j] as (typeof refs)[number];
      if (a.t === b.t || a.key === b.key) continue;
      out.push([a.ref, b.ref]);
    }
  }
  return out;
}

// --- Paying a tile ----------------------------------------------------------

export function tallyTotal(m: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const v of Object.values(m)) n += v ?? 0;
  return n;
}

/**
 * Could this tally pay this demand, with up to `wildCards` cards missing the
 * named crops? Cheap - no enumeration: take every named card the tally holds,
 * and the rest of the cost from anything left, so the test is only the total
 * and the shortfall. This is what keeps `anyDeliverOption` a fast path.
 */
function canPay(
  base: Partial<Record<Suit, number>>,
  cost: number,
  tally: Partial<Record<Suit, number>>,
  wildCards: number,
): boolean {
  if (demandShortfall(base, tally) > wildCards) return false;
  return tallyTotal(tally) >= cost;
}

/** Multisets of size n over the suits, each suit capped by `cap`. */
function fillerSpends(
  suits: readonly Suit[],
  n: number,
  cap: Partial<Record<Suit, number>>,
): Partial<Record<Suit, number>>[] {
  if (n === 0) return [{}];
  if (suits.length === 0) return [];
  const [head, ...rest] = suits as [Suit, ...Suit[]];
  const out: Partial<Record<Suit, number>>[] = [];
  for (let take = Math.min(n, cap[head] ?? 0); take >= 0; take--) {
    for (const tail of fillerSpends(rest, n - take, cap)) {
      out.push(take === 0 ? tail : { ...tail, [head]: take });
    }
  }
  return out;
}

/**
 * ⭐ EVERY PAYMENT FOR ONE TILE, AS CROP MULTISETS AND NEVER AS CARD SUBSETS
 * (branching is this engine's main performance risk). With no relaxation a
 * payment is the named demand plus a filler of `any` cards from the surplus,
 * exactly as the crate island enumerated. With the Vegetable board's
 * relaxation it is every multiset of `cost` cards the tally holds whose
 * shortfall against the named demand is within the allowance.
 */
function tileSpends(
  base: Partial<Record<Suit, number>>,
  any: number,
  tally: Partial<Record<Suit, number>>,
  wildCards: number,
  suits: readonly Suit[],
): Partial<Record<Suit, number>>[] {
  if (wildCards <= 0) {
    const surplus: Partial<Record<Suit, number>> = {};
    for (const suit of suits) surplus[suit] = (tally[suit] ?? 0) - (base[suit] ?? 0);
    return fillerSpends(suits, any, surplus).map((filler) => {
      const spend: Partial<Record<Suit, number>> = { ...base };
      for (const [suit, n] of Object.entries(filler) as [Suit, number][]) {
        spend[suit] = (spend[suit] ?? 0) + n;
      }
      return spend;
    });
  }
  const cost = tallyTotal(base) + any;
  return fillerSpends(suits, cost, tally).filter(
    (spend) => demandShortfall(base, spend) <= wildCards,
  );
}

/**
 * A8 The Wild Hive (R4, R8): the crop tally of every card sitting on one of
 * the SEAT'S OWN full buildings right now. "Full" is `isHarvestable`, judged
 * ONCE here - never per card - so a whole clogged stack is available in one
 * go: that is the card's whole point, a release valve for a Notice Board or
 * any other building that has clogged. `isHarvestable` (not `isFull`) is
 * what makes a `3+` Notice Board count at 3 or more (R4): `isFull` answers
 * false for a Notice Board forever (S8), which would read as "never full"
 * and silently drop the card's best target. Power and End-game cards never
 * contribute: they print no threshold, so `isHarvestable` is false for them
 * (their `stack` stays empty) without any extra filter. Never a rival's
 * building: this only ever walks `seat`'s own tableau.
 */
function fullBuildingTally(
  data: GameData,
  state: GameState,
  seat: Seat,
): Partial<Record<Suit, number>> {
  const tally: Partial<Record<Suit, number>> = {};
  for (const building of player(state, seat).tableau) {
    if (!isHarvestable(data, building)) continue;
    for (const id of building.stack) {
      const suit = cardById(data, id).suit;
      tally[suit] = (tally[suit] ?? 0) + 1;
    }
  }
  return tally;
}

/**
 * WHAT THIS SEAT CAN PAY THE ISLAND WITH: the barn, plus the meeple supply when
 * R15 (the meeple-as-card control) is live, plus - only when `fromFullBuildings`
 * is true (A8, T4b) - every card on one of the seat's own full buildings.
 *
 * ⚠️ EVERY ROUTE THAT ASKS "CAN THIS SEAT DELIVER" MUST ASK THIS ONE, not
 * `barnTally`: a tally that disagreed between the gate and the enumerator
 * would offer a door with no legal move behind it.
 */
function deliverTally(
  data: GameData,
  state: GameState,
  seat: Seat,
  fromFullBuildings = false,
): Partial<Record<Suit, number>> {
  const barn = barnTally(data, state, seat);
  const out: Partial<Record<Suit, number>> = meepleAsCard(data) ? { ...barn } : barn;
  if (meepleAsCard(data)) {
    const supply = player(state, seat).meeples;
    for (const suit of data.cards.suits) out[suit] = (out[suit] ?? 0) + (supply[suit] ?? 0);
  }
  if (!fromFullBuildings) return out;
  const buildings = fullBuildingTally(data, state, seat);
  // A fresh copy when nothing has touched `out` yet (no meeples): mutating
  // `barn` itself would corrupt whatever else is holding that reference.
  const merged: Partial<Record<Suit, number>> = out === barn ? { ...barn } : out;
  for (const [suit, n] of Object.entries(buildings) as [Suit, number][]) {
    merged[suit] = (merged[suit] ?? 0) + n;
  }
  return merged;
}

/**
 * Split one spend into the barn's share and the supply's, BARN FIRST (see
 * `DeliverOption.meeples`). Returns null when the supply cannot cover what the
 * barn is short of.
 */
function meepleShare(
  data: GameData,
  state: GameState,
  seat: Seat,
  spend: Partial<Record<Suit, number>>,
): Partial<Record<Suit, number>> | null {
  const barn = barnTally(data, state, seat);
  const supply = player(state, seat).meeples;
  const out: Partial<Record<Suit, number>> = {};
  let any = false;
  for (const [suit, want] of Object.entries(spend) as [Suit, number][]) {
    const short = want - (barn[suit] ?? 0);
    if (short <= 0) continue;
    if (short > (supply[suit] ?? 0)) return null;
    out[suit] = short;
    any = true;
  }
  return any ? out : {};
}

export function deliverOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  /** Stop after this many. `anyDeliverOption` passes 1 - see `buildOptions`. */
  limit: number = Infinity,
  /** The Vegetable board's relaxation (R9): cards that may miss the named demand. */
  wildCards = 0,
  /** A8 (R4, R8, T4b): fold the seat's own full buildings into the payable pool. */
  fromFullBuildings = false,
  /** O12 (T4b): one card from hand, of its own crop, may join the payment. */
  handCard = false,
): DeliverOption[] {
  const tally = deliverTally(data, state, seat, fromFullBuildings);
  const asCard = meepleAsCard(data);
  const onBoard = meepleAsCardGoesToBoard(data);
  const rate = data.rules.turn.paymentSlotToll;
  const cost = deliveryCost(data);
  const out: DeliverOption[] = [];
  // Any-crop cards may be of ANY suit, including one outside
  // `state.suitsInPlay`: a meeple IS a card of its colour under R15. The suits
  // in play come first so the list order is stable; an out-of-play suit's
  // tally is 0 in any game without meeples in the tally.
  const suits = [
    ...state.suitsInPlay,
    ...data.cards.suits.filter((x) => !state.suitsInPlay.includes(x)),
  ];
  /** Push one option per token choice; true once `limit` is reached. */
  const push = (tile: IslandTileState, o: Omit<DeliverOption, 'token'>): boolean => {
    for (const token of tokenChoices(tile)) {
      out.push({ ...o, token });
      if (out.length >= limit) return true;
    }
    return false;
  };
  // O12: every crop the hand could supply the ONE extra card from, empty
  // when `handCard` is off. Read once - the same hand for every tile.
  const handCrops = handCard
    ? [...new Set(player(state, seat).hand.map((id) => cardById(data, id).suit))]
    : [];
  demandLoop: for (const tile of state.island.tiles) {
    if (!tileHasRoom(data, tile)) continue;
    const { base, any } = tileDemand(data, tile.tokens);
    // ⭐ ADDITIVE, NEVER MULTIPLICATIVE (T4b): the plain pool, plus - only
    // when `handCard` is on - one candidate pool per crop the hand holds,
    // each bumped by exactly one card of that crop. A spend drawn from a
    // bumped pool that never actually reaches past the plain pool's own cap
    // is dropped below (see `handCrop`'s check), so nothing is offered twice.
    const candidates: { pool: Partial<Record<Suit, number>>; handCrop?: Suit }[] = [
      { pool: tally },
      ...handCrops.map((crop) => ({
        pool: { ...tally, [crop]: (tally[crop] ?? 0) + 1 },
        handCrop: crop,
      })),
    ];
    for (const { pool, handCrop } of candidates) {
      if (!canPay(base, cost, pool, wildCards)) continue;
      for (const spend of tileSpends(base, any, pool, wildCards, suits)) {
        if (handCrop !== undefined && (spend[handCrop] ?? 0) <= (tally[handCrop] ?? 0)) {
          // This spend never touched the bumped card - the plain-pool pass
          // already offers it, so offering it again here would duplicate it.
          continue;
        }
        const handRider: Pick<DeliverOption, 'handCrop'> =
          handCrop === undefined ? {} : { handCrop };
        if (!asCard) {
          if (push(tile, { tile: tile.tile, spend, ...handRider })) break demandLoop;
          continue;
        }
        const meeples = meepleShare(data, state, seat, spend);
        if (meeples === null) continue;
        if (meepleCount(meeples) === 0) {
          if (push(tile, { tile: tile.tile, spend, ...handRider })) break demandLoop;
          continue;
        }
        if (!onBoard) {
          if (push(tile, { tile: tile.tile, spend, meeples, ...handRider })) break demandLoop;
          continue;
        }
        // ⭐ R17: the meeple share lands on a neighbour's board rather than in
        // the box, so one spend becomes one option per legal placement.
        for (const spot of placementsFor(data, state, seat, meeples, rate)) {
          const o = {
            tile: tile.tile,
            spend,
            meeples,
            placements: spot.boards,
            paymentToll: spot.toll,
            ...handRider,
          };
          if (push(tile, o)) break demandLoop;
        }
      }
    }
  }
  return out;
}

/**
 * Is ANY island delivery open to this seat? Kept as a fast path - it never
 * enumerates a filler, because `canPay` only needs the total and the
 * shortfall. Every route that can deliver must agree with this.
 */
export function anyDeliverOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  /** The Vegetable board's relaxation (R9). */
  wildCards = 0,
  /** A8 (T4b): fold the seat's own full buildings into the payable pool. */
  fromFullBuildings = false,
  /** O12 (T4b): one card from hand, of its own crop, may join the payment. */
  handCard = false,
): boolean {
  const tally = deliverTally(data, state, seat, fromFullBuildings);
  const fastPayable = state.island.tiles.some((tile) => payableBy(data, tile, tally, wildCards));
  // A tally-only "no" is final UNLESS `handCard` is on: the hand's budget is
  // ONE CARD TOTAL, never one per suit, so this per-suit tally cannot tell
  // "one crop short by one" (payable with the hand card) from "two crops
  // short by one each" (not payable with only one) - it can only ever
  // OVER-approximate. A `false` reading with `handCard` off is exact and
  // needs no further check.
  if (!fastPayable && !handCard) return false;
  // ⛔ R17, same seam as `anyBuildOption`: the tally says the tile is payable,
  // but the meeple half of the payment has to LAND somewhere. Ask the
  // enumerator, because a gate wider than its enumerator offers `pass` on an
  // empty list and `apply` throws.
  if (fastPayable && !meepleAsCardGoesToBoard(data) && !handCard) return true;
  return deliverOptions(data, state, seat, 1, wildCards, fromFullBuildings, handCard).length > 0;
}

/** Could this tally pay this open tile? */
function payableBy(
  data: GameData,
  tile: IslandTileState,
  tally: Partial<Record<Suit, number>>,
  wildCards = 0,
): boolean {
  if (!tileHasRoom(data, tile)) return false;
  const { base } = tileDemand(data, tile.tokens);
  return canPay(base, deliveryCost(data), tally, wildCards);
}

/**
 * DELIVERABILITY: how many open tiles this seat could pay for right now. The
 * bots' pricer needs a POSITION rather than a boolean, because V5's swap
 * changes exactly this number and nothing in the acting seat's own zones.
 */
export function payableTileCount(data: GameData, state: GameState, seat: Seat): number {
  const tally = deliverTally(data, state, seat);
  return state.island.tiles.filter((tile) => payableBy(data, tile, tally)).length;
}

/** How one delivery is taken, beyond the tile and the payment. */
export interface DeliverChoice {
  /**
   * Which token is the receipt: an index into the tile's `tokens`. Absent
   * takes the highest-VP token (the first of `tokenChoices`), a convenience
   * for hand-written callers; every enumerated move names it.
   */
  token?: number;
  /**
   * ⭐ V14 The Distribution Center (a later slice wires it): take EVERY token
   * the tile holds for the one payment. On a two-token tile that is both
   * receipts for the same 4 cards; on a one-token tile it is an ordinary
   * second delivery. `token` must be absent.
   */
  takeAll?: boolean;
  /** The Vegetable board's relaxation (R9): cards that may miss the named demand. */
  wildCards?: number;
  /**
   * R15: the part of `spend` paid out of the SUPPLY rather than the barn. Omit
   * and it is derived barn-first, which is what every enumerated option does;
   * pass it and it is validated against the same rule.
   */
  meepleSpend?: Partial<Record<Suit, number>>;
  /** R17: where the meeple share lands, and the toll it owed. */
  placement?: {
    placements?: Partial<Record<Suit, number>>[];
    paymentToll?: Partial<Record<Suit, number>>;
  };
  /**
   * A8 The Wild Hive (R4, R8, T4b): cards taken off the seat's OWN full
   * buildings to help pay, named by BUILDING and a crop tally per building -
   * never derived, unlike `meepleSpend`. Draining a clogged building on
   * purpose is the card's whole point, so the caller chooses which building
   * loses which cards rather than this primitive picking barn-first (which
   * would rarely touch a building at all). Fullness is re-checked here, once,
   * at the moment of payment (R8): a building `deliverOptions` offered as
   * full is still legal even if the `applied` choice leaves it far below
   * threshold afterwards. Absent = no building cards used.
   */
  buildingSpend?: { building: CardId; spend: Partial<Record<Suit, number>> }[];
  /**
   * O12 The Fruit Press (T4b): the ONE literal hand card paying as its own
   * crop (never wild) - a hand card carries an owner-visible identity a barn
   * or building card does not, so it is named directly rather than pooled by
   * crop. Its crop should be the `handCrop` `deliverOptions` named for this
   * spend; `doDeliver` re-checks it is still in hand and that every source
   * together does not claim more of a crop than `spend` asks for. Absent = no
   * hand card used.
   */
  handCard?: CardId;
}

export function doDeliver(
  fx: Fx,
  seat: Seat,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
  choice: DeliverChoice = {},
): void {
  const state = fx.state;
  const tile = state.island.tiles.find((t) => t.tile === tileId);
  if (!tile) throw new Error(`Tile ${tileId} is not in play`);
  if (tile.tokens.length === 0) throw new Error(`Tile ${tileId} has no tokens left`);
  // ⛔ THE TOKEN IS CHECKED BEFORE ANYTHING IS PAID, because `apply` does not
  // re-run `legalMoves` for a main action.
  let taken: number[];
  if (choice.takeAll === true) {
    if (choice.token !== undefined) throw new Error('A delivery taking every token names none');
    taken = tile.tokens.map((_, i) => i);
  } else {
    const token = choice.token ?? (tokenChoices(tile)[0] as number);
    if (!Number.isInteger(token) || token < 0 || token >= tile.tokens.length) {
      throw new Error(`Tile ${tileId} has no token ${token}`);
    }
    taken = [token];
  }

  // The payment: exactly `deliveryCost` cards, the named demand met but for at
  // most `wildCards` of them.
  const wildCards = choice.wildCards ?? 0;
  const { base } = tileDemand(fx.data, tile.tokens);
  const wildUsed = demandShortfall(base, spend);
  if (tallyTotal(spend) !== deliveryCost(fx.data) || wildUsed > wildCards) {
    throw new Error(
      `Spend does not pay ${tileId}: a delivery is ${deliveryCost(fx.data)} cards covering ` +
        `the tokens' demands${wildCards > 0 ? ` but for ${wildCards} of any crop` : ''}`,
    );
  }

  // A8 The Wild Hive (R4, R8, T4b): cards off the seat's OWN full buildings,
  // going wherever a spent delivery card normally goes (its crop's discard,
  // R6) - NEVER the barn, and never a Harvest (no When-Harvested hook, no
  // W16, no W18: taking cards off a building this way is not harvesting it).
  // "Full" is judged ONCE, right here, before anything moves (R8): a building
  // `deliverOptions` offered as full stays legal even though taking its
  // whole stack leaves it far below threshold - that release is the card's
  // whole point. Which building loses which cards is never derived (unlike
  // the meeple share below): the caller chose it.
  const buildingSpend = choice.buildingSpend ?? [];
  const fromBuildings: Partial<Record<Suit, number>> = {};
  const buildingCards: CardId[] = [];
  for (const { building, spend: take } of buildingSpend) {
    const b = player(state, seat).tableau.find((x) => x.card === building);
    if (!b) throw new Error(`${building} is not one of seat ${seat}'s buildings`);
    if (!isHarvestable(fx.data, b)) {
      throw new Error(`${building} is not full (a Notice Board counts as full at 3 or more, R4)`);
    }
    const left = [...b.stack];
    for (const [suit, n] of Object.entries(take) as [Suit, number][]) {
      for (let i = 0; i < n; i++) {
        const at = left.findIndex((id) => cardById(fx.data, id).suit === suit);
        if (at < 0) throw new Error(`${building} has no ${suit} card left to pay a delivery`);
        const [id] = left.splice(at, 1) as [CardId];
        buildingCards.push(id);
        fromBuildings[suit] = (fromBuildings[suit] ?? 0) + 1;
      }
    }
  }

  // O12 The Fruit Press (T4b): at most ONE card from hand, paying as its own
  // crop - never wild. A hand card carries an owner-visible identity a barn
  // card does not (R6 already treats the barn as anonymous even to its
  // owner), so it is named directly rather than pooled by crop.
  const handCard = choice.handCard;
  const fromHand: Partial<Record<Suit, number>> = {};
  if (handCard !== undefined) {
    if (!player(state, seat).hand.includes(handCard)) {
      throw new Error(`${handCard} is not in seat ${seat}'s hand`);
    }
    fromHand[cardById(fx.data, handCard).suit] = 1;
  }

  // Neither source may claim more of a crop than the delivery actually
  // spends: the barn covers whatever is left over below, and an over-claim
  // here would otherwise surface as `spendFromBarn` silently being asked for
  // a negative count instead of failing loudly at the source of the mistake.
  for (const suit of fx.data.cards.suits) {
    const claimed = (fromBuildings[suit] ?? 0) + (fromHand[suit] ?? 0);
    if (claimed > (spend[suit] ?? 0)) {
      throw new Error(`Delivery payment claims more ${suit} cards than it spends`);
    }
  }

  // ⭐ R15: THE MEEPLE HALF OF THE PAYMENT COMES OUT FIRST AND GOES TO THE
  // BOX, derived barn-first; a caller that names its own is held to the same
  // arithmetic, or one delivery would be payable two ways.
  //
  // ⭐ FIXED 24/09/2026 (T4b crash, `gp-bug-2026-09-24T14-3*`): `meepleShare`
  // must be asked about the part of `spend` the BARN actually owes, never the
  // whole `spend`. A8's building cards and O12's hand card already cover part
  // of `spend` before the barn is asked for anything, so handing `meepleShare`
  // the full `spend` made it see a "shortfall" that was really `fromBuildings`
  // or `fromHand`'s share, not the barn's - and `meepleShare` does not check
  // `meepleAsCard(data)` itself, only whether the supply happens to hold a
  // card of that colour, which it usually does in the shipped game (the
  // delivery meeple is a normal component here, on or off R15). So a plain A8
  // or O12 delivery with a non-empty meeple supply of the right colour threw
  // the R15 guard below even though no meeple was ever asked to pay anything.
  // `barnOwed` is exactly what `fromBarn` further down computes before the
  // meeple share is subtracted off it, just needed one statement earlier.
  const barnOwed: Partial<Record<Suit, number>> = { ...spend };
  for (const [suit, n] of Object.entries(fromBuildings) as [Suit, number][]) {
    barnOwed[suit] = (barnOwed[suit] ?? 0) - n;
    if ((barnOwed[suit] as number) <= 0) delete barnOwed[suit];
  }
  for (const [suit, n] of Object.entries(fromHand) as [Suit, number][]) {
    barnOwed[suit] = (barnOwed[suit] ?? 0) - n;
    if ((barnOwed[suit] as number) <= 0) delete barnOwed[suit];
  }
  const meeples = choice.meepleSpend ?? meepleShare(fx.data, state, seat, barnOwed) ?? {};
  const meepleTotal = meepleCount(meeples);
  if (meepleTotal > 0 && !meepleAsCard(fx.data)) {
    throw new Error('A meeple pays an island delivery only under rules.turn.meepleAsCard');
  }
  if (meepleTotal > 0) {
    const derived = meepleShare(fx.data, state, seat, barnOwed);
    if (derived === null) throw new Error('That spend is not payable from barn and supply');
    for (const suit of fx.data.cards.suits) {
      if ((meeples[suit] ?? 0) !== (derived[suit] ?? 0)) {
        throw new Error(`The ${suit} share of that delivery is not the barn-first split`);
      }
    }
  }
  const fromBarn: Partial<Record<Suit, number>> = { ...spend };
  for (const [suit, n] of Object.entries(meeples) as [Suit, number][]) {
    fromBarn[suit] = (fromBarn[suit] ?? 0) - n;
    if ((fromBarn[suit] as number) <= 0) delete fromBarn[suit];
  }
  for (const [suit, n] of Object.entries(fromBuildings) as [Suit, number][]) {
    fromBarn[suit] = (fromBarn[suit] ?? 0) - n;
    if ((fromBarn[suit] as number) <= 0) delete fromBarn[suit];
  }
  for (const [suit, n] of Object.entries(fromHand) as [Suit, number][]) {
    fromBarn[suit] = (fromBarn[suit] ?? 0) - n;
    if ((fromBarn[suit] as number) <= 0) delete fromBarn[suit];
  }
  if (meepleTotal > 0) {
    const placement = choice.placement;
    if (placement?.placements === undefined) {
      fx.payMeeplesAsCards(seat, meeples, 'delivery');
    } else {
      assertPlacementMatches(fx.data, state, seat, meeples, placement);
      fx.placeMeeplesAsCards(seat, placement.placements, placement.paymentToll ?? {}, 'delivery');
    }
  }
  // A8's cards leave their buildings and O12's leaves the hand BEFORE the
  // barn is touched, exactly the meeples' order above, so nothing downstream
  // can find a card in two places at once.
  for (const id of buildingCards) fx.spendFromStack(seat, id);
  if (buildingCards.length > 0) fx.discard(buildingCards);
  if (handCard !== undefined) {
    fx.removeFromHand(seat, handCard);
    fx.discard([handCard]);
  }
  // ⛔ R6: A DELIVERY PAYMENT IS NOT A DISCARD. `spendFromBarn` moves the cards
  // to their discard piles as a PAYMENT, and no "discard from your barn" hook
  // is fired here, now or when V17's hook lands.
  const cards = fx.spendFromBarn(seat, fromBarn);
  finishDelivery(
    fx,
    seat,
    tile,
    spend,
    [...cards, ...buildingCards, ...(handCard === undefined ? [] : [handCard])],
    taken,
    wildUsed,
    meepleTotal,
    meeples,
  );
}

/**
 * THE RECEIPT/WORKER/HOOK/CLOCK TAIL of every delivery, whatever paid for it.
 *
 * The chosen tokens LEAVE the tile and become receipts (VP, crop, tile), and a
 * token's Worker goes to the seat's supply. One `delivered` event per token,
 * so nothing counting receipts has to learn that V14's can be double; only the
 * first carries the spend, because only one payment was made. ONE
 * `afterDeliver` per delivery, carrying every receipt taken.
 */
export function finishDelivery(
  fx: Fx,
  seat: Seat,
  tile: IslandTileState,
  spend: Partial<Record<Suit, number>>,
  cards: CardId[],
  taken: readonly number[],
  wildUsed = 0,
  meepleTotal = 0,
  meeples: Partial<Record<Suit, number>> = {},
): void {
  const state = fx.state;
  const tileId = tile.tile;
  // The token-choice reading: on a two-token tile, did a single take choose
  // the higher VP? Read BEFORE the tokens leave. Absent on a tie.
  let tookHigher: boolean | undefined;
  if (tile.tokens.length === 2 && taken.length === 1) {
    const mine = tile.tokens[taken[0] as number]?.vp ?? 0;
    const other = tile.tokens[1 - (taken[0] as number)]?.vp ?? 0;
    if (mine !== other) tookHigher = mine > other;
  }
  const tokens = [...taken].sort((a, b) => a - b).map((i) => tile.tokens[i]);
  // Remove from the highest index down so the lower indices stay valid.
  for (const i of [...taken].sort((a, b) => b - a)) tile.tokens.splice(i, 1);
  const receipts: Receipt[] = [];
  for (const [n, token] of tokens.entries()) {
    if (token === undefined) throw new Error(`Tile ${tileId} lost a token mid-delivery`);
    const receipt: Receipt = { vp: token.vp, crop: token.demand, tile: tileId };
    player(state, seat).receipts.push(receipt);
    receipts.push(receipt);
    tile.deliveredBy.push(seat);
    fx.emit({
      e: 'delivered',
      seat,
      tile: tileId,
      vp: token.vp,
      crop: token.demand,
      worker: token.worker,
      spend: n === 0 ? spend : {},
      ...(n === 0 && tookHigher !== undefined ? { tookHigher } : {}),
      ...(n === 0 && wildUsed > 0 ? { wildUsed } : {}),
    });
    // The Worker goes through the supply cap (a no-op in the shipped game).
    if (token.worker !== null) fx.gainMeeple(seat, token.worker, tileId, token.vp, 'island');
  }
  fireHook(fx, 'afterDeliver', {
    seat,
    island: true,
    tile: tileId,
    cards,
    receipts,
    ...(meepleTotal > 0 ? { meeples } : {}),
  });
  // The clock: one seat's Nth receipt ends the game, counted off the island's
  // public record after every delivery (V14's two receipts are two).
  const target = fx.data.rules.endGame.deliveriesToTrigger;
  if (state.endTrigger === null && islandDeliveriesBy(state, seat) >= target) {
    state.endTrigger = { seat };
    fx.emit({ e: 'endTriggered', seat });
  }
}

/**
 * The Deliver action's full option set as task answers. The generic deliver
 * task and the Vegetable deliver cards both enumerate through here.
 */
export function deliverAnswers(
  data: GameData,
  state: GameState,
  seat: Seat,
  /** The Vegetable board's relaxation (R9). */
  wildCards = 0,
): TaskAnswer[] {
  return deliverOptions(data, state, seat, Infinity, wildCards).map(
    (o) =>
      ({
        kind: 'deliver',
        tile: o.tile,
        spend: o.spend,
        token: o.token,
        // R15: the supply's share rides on the answer, because `resolveTask`
        // re-applies exactly what was offered.
        ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
        ...(o.placements === undefined ? {} : { placements: o.placements }),
        ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
      }) as TaskAnswer,
  );
}
