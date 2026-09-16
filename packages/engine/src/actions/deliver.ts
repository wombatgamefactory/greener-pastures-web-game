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
import { player } from '../query.js';
import type { CardId, GameState, IslandTileState, Receipt, Seat, TaskAnswer } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import { deliveryCost, demandShortfall, meepleAsCardGoesToBoard, tileDemand } from '@gp/data';
import { assertPlacementMatches, meepleAsCard, meepleCount, placementsFor } from './meeples.js';
import { barnTally } from './shared.js';

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
 * WHAT THIS SEAT CAN PAY THE ISLAND WITH: the barn, plus the meeple supply when
 * R15 (the meeple-as-card control) is live.
 *
 * ⚠️ EVERY ROUTE THAT ASKS "CAN THIS SEAT DELIVER" MUST ASK THIS ONE, not
 * `barnTally`: a tally that disagreed between the gate and the enumerator
 * would offer a door with no legal move behind it.
 */
function deliverTally(data: GameData, state: GameState, seat: Seat): Partial<Record<Suit, number>> {
  const barn = barnTally(data, state, seat);
  if (!meepleAsCard(data)) return barn;
  const supply = player(state, seat).meeples;
  const out: Partial<Record<Suit, number>> = { ...barn };
  for (const suit of data.cards.suits) out[suit] = (out[suit] ?? 0) + (supply[suit] ?? 0);
  return out;
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
): DeliverOption[] {
  const tally = deliverTally(data, state, seat);
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
  demandLoop: for (const tile of state.island.tiles) {
    if (!tileHasRoom(data, tile)) continue;
    const { base, any } = tileDemand(data, tile.tokens);
    if (!canPay(base, cost, tally, wildCards)) continue;
    for (const spend of tileSpends(base, any, tally, wildCards, suits)) {
      if (!asCard) {
        if (push(tile, { tile: tile.tile, spend })) break demandLoop;
        continue;
      }
      const meeples = meepleShare(data, state, seat, spend);
      if (meeples === null) continue;
      if (meepleCount(meeples) === 0) {
        if (push(tile, { tile: tile.tile, spend })) break demandLoop;
        continue;
      }
      if (!onBoard) {
        if (push(tile, { tile: tile.tile, spend, meeples })) break demandLoop;
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
        };
        if (push(tile, o)) break demandLoop;
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
): boolean {
  const tally = deliverTally(data, state, seat);
  if (!state.island.tiles.some((tile) => payableBy(data, tile, tally, wildCards))) return false;
  if (!meepleAsCardGoesToBoard(data)) return true;
  // ⛔ R17, same seam as `anyBuildOption`: the tally says the tile is payable,
  // but the meeple half of the payment has to LAND somewhere. Ask the
  // enumerator, because a gate wider than its enumerator offers `pass` on an
  // empty list and `apply` throws.
  return deliverOptions(data, state, seat, 1, wildCards).length > 0;
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

  // ⭐ R15: THE MEEPLE HALF OF THE PAYMENT COMES OUT FIRST AND GOES TO THE
  // BOX, derived barn-first; a caller that names its own is held to the same
  // arithmetic, or one delivery would be payable two ways.
  const meeples = choice.meepleSpend ?? meepleShare(fx.data, state, seat, spend) ?? {};
  const meepleTotal = meepleCount(meeples);
  if (meepleTotal > 0 && !meepleAsCard(fx.data)) {
    throw new Error('A meeple pays an island delivery only under rules.turn.meepleAsCard');
  }
  if (meepleTotal > 0) {
    const derived = meepleShare(fx.data, state, seat, spend);
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
  if (meepleTotal > 0) {
    const placement = choice.placement;
    if (placement?.placements === undefined) {
      fx.payMeeplesAsCards(seat, meeples, 'delivery');
    } else {
      assertPlacementMatches(fx.data, state, seat, meeples, placement);
      fx.placeMeeplesAsCards(seat, placement.placements, placement.paymentToll ?? {}, 'delivery');
    }
  }
  // ⛔ R6: A DELIVERY PAYMENT IS NOT A DISCARD. `spendFromBarn` moves the cards
  // to their discard piles as a PAYMENT, and no "discard from your barn" hook
  // is fired here, now or when V17's hook lands.
  const cards = fx.spendFromBarn(seat, fromBarn);
  finishDelivery(fx, seat, tile, spend, cards, taken, wildUsed, meepleTotal, meeples);
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
