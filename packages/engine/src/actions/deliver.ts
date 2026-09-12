/**
 * DELIVER, and everything the island asks for: crates and receipts, the mutable
 * demand tokens, the wild substitution (2 cards for 1, ISLAND DELIVERY ONLY) and
 * the Aerodrome's freight branch. The four are one unit because the substitution
 * prices a crate and the crate is what a delivery is.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import { fireHook } from '../fx.js';
import { coinSupplyLeft, player } from '../query.js';
import { rngInt } from '../rng.js';
import type {
  AerodromeState,
  CardId,
  GameState,
  IslandTileState,
  Seat,
  TaskAnswer,
} from '../state.js';
import type { GameData, Suit } from '@gp/data';
import {
  deliveriesPerTile,
  deliveryVp,
  meepleAsCardGoesToBoard,
  meepleIndexForSpace,
  storeCoinsPerCard,
} from '@gp/data';
import { assertPlacementMatches, meepleAsCard, meepleCount, placementsFor } from './meeples.js';
import { barnTally, subsets } from './shared.js';

// --- Deliver ---------------------------------------------------------------

export interface DeliverOption {
  tile: string;
  spend: Partial<Record<Suit, number>>;
  /**
   * R15: the part of `spend` paid out of the SUPPLY rather than the barn, per
   * colour. Absent when the barn covered it all.
   *
   * ⭐ IT IS DERIVED, NOT ENUMERATED, AND THAT IS A DELIBERATE REDUCTION.
   * The split is BARN FIRST: a meeple pays only what the barn cannot, colour by
   * colour. The alternative - offering every way of splitting a crate between
   * barn cards and meeples - multiplies the delivery list by a power of the
   * supply for a choice that is dominated in one direction: a barn card is a
   * DEAD END (it pays the island and nothing else, which is the barn glut), a
   * meeple is a stored action, so spending the barn first is the better half of
   * that trade every time bar the tie-break. It is the same argument
   * `substitutedSpends` already makes when it offers only the MINIMUM number of
   * substitutions. ⚠️ The cost of the reduction, stated so it is not
   * forgotten: a seat can never choose to burn a meeple to KEEP a barn card for
   * the tie-break.
   */
  meeples?: Partial<Record<Suit, number>>;
  /** R17: where the paid meeples land, by seat, and the toll they owed. */
  placements?: Partial<Record<Suit, number>>[];
  paymentToll?: Partial<Record<Suit, number>>;
}

/**
 * ⛔ THE VEGETABLE FARMSTEAD'S HEAD IS GONE (v31), and with it
 * `deliverHeadSize`, `deliverDeckHead`, `deckHeadCandidates`, `headCandidates`,
 * `withHead` and the `head` / `deckHead` fields on every deliver option, move
 * and task answer.
 *
 * It read "When you Deliver, you may FIRST put 1 card from your hand into your
 * barn" (upgraded: 1 card off a deck top instead). Two things it taught are
 * worth carrying, because the next card that touches a delivery will meet both:
 *
 *  1. **The word "first" was the whole card.** Until 2026-08-09 the Farmstead
 *     fired on `afterDeliver`, so the card it moved could not help pay for the
 *     delivery that triggered it - you had to already be able to deliver in
 *     order to earn the fuel for the next delivery, which is a circle. Moving it
 *     upstream of the payment is what made it a card. Wheat's Farmstead relaxed
 *     the harvest and Orchard's modified the draw for the same reason: a suit
 *     power belongs UPSTREAM of that suit's bottleneck.
 *  2. **A head had to ride on the ANSWER, not be re-derived at resolution.** It
 *     was loaded before the payment and was frequently the only reason the
 *     payment was affordable, so an answer that dropped it was an answer the
 *     barn could not pay. `deliverAnswers` shipped exactly that bug on the day
 *     the balloon heads landed.
 *
 * The enumeration also carried a pruning rule that is general and outlives the
 * card: a head is only ever worth offering when it CHANGES WHAT YOU CAN PAY,
 * because loading a card you are not about to spend is the same move as loading
 * it on your next delivery instead. `deliverOptions` still de-dupes on that
 * principle for the wild substitution.
 */

/**
 * Levels this seat already holds a receipt from. Derived from the island, never
 * stored: ticket 07's gate is "which levels have I delivered to", and
 * `tile.deliveredBy` is exactly that record, so there is no flag to keep in
 * step. Note it reads the seat's OWN deliveries only - whose token sits where
 * is not part of the rule.
 */
export function islandDeliveriesBy(state: GameState, seat: Seat): number {
  let n = 0;
  for (const tile of state.island.tiles) {
    for (const who of tile.deliveredBy) if (who === seat) n += 1;
  }
  return n;
}

/**
 * Is this tile still open? The VP schedule's length is the capacity rule, so a
 * tile closes exactly when there is no VP left to pay for the next delivery.
 * One place, because every route to a delivery has to agree with it.
 */
export function tileHasRoom(data: GameData, tile: IslandTileState): boolean {
  return tile.deliveredBy.length < deliveriesPerTile(data);
}

/** Multisets of size k over the suits - one suit choice per wild crate. */
export function wildFills(suits: readonly Suit[], k: number): Suit[][] {
  if (k === 0) return [[]];
  if (suits.length === 0) return [];
  const [head, ...rest] = suits as [Suit, ...Suit[]];
  const out: Suit[][] = [];
  for (let n = k; n >= 0; n--) {
    for (const tail of wildFills(rest, k - n)) out.push([...Array<Suit>(n).fill(head), ...tail]);
  }
  return out;
}

/**
 * The demand a tile's crates make, before wild choices: suit -> cards.
 *
 * THE WHOLE OF THE FACE-DOWN RULE IS THE ONE DISJUNCTION BELOW. A token turned
 * face down by V6 The Trade Depot accepts cards of any crops at the normal rate,
 * which is exactly what a cornucopia does, so it counts as a wild crate here and
 * `deliverDemands`, `deliverOptions`, `substitutedSpends`, `canPay`,
 * `anyDeliverOption` and `doDeliver`'s validation all inherit it for free. It is
 * a separate flag from `'wild'` rather than a rewrite of the crate because the
 * two are different objects on the table: V6 may never target a cornucopia, and
 * the UI has to draw a blank differently from a horn of plenty.
 */
export function namedDemand(
  data: GameData,
  tile: IslandTileState,
): { base: Partial<Record<Suit, number>>; wilds: number; cardsPerCrate: number } {
  const { cardsPerCrate } = data.island.tileRule;
  const base: Partial<Record<Suit, number>> = {};
  let wilds = 0;
  for (const [i, crate] of tile.crates.entries()) {
    if (crate === 'wild' || tile.faceDown?.[i] === true) wilds += 1;
    else base[crate] = (base[crate] ?? 0) + cardsPerCrate;
  }
  return { base, wilds, cardsPerCrate };
}

// --- Mutable demand tokens (the Vegetable rebuild, 2026-08-09) --------------
//
// Two verbs, one card each, and they are the reason the suit exists: in 105
// cards nothing else touches the island's colour puzzle after setup.
//
// The shared gate is `tileHasRoom`. A tile whose receipts are both taken is
// FINISHED, and re-pricing a delivery somebody has already paid for is the one
// thing neither verb may ever do.

/** A crate on the island, addressed the way both verbs and both events do. */
export interface DemandRef {
  tile: string;
  crate: number;
}

/** What a crate is asking for right now: its suit, or 'down' once turned. */
function tokenValue(tile: IslandTileState, crate: number): Suit | 'wild' | 'down' {
  return tile.faceDown?.[crate] === true ? 'down' : (tile.crates[crate] as Suit | 'wild');
}

/**
 * V5's targets: every pair of crates on tiles that still have a receipt space.
 *
 * De-duped by the island configuration each swap would produce, so a pair of
 * identical tokens is never offered (it is a no-op) and neither are two ways of
 * reaching the same board. Both tiles must have room, including when they are
 * the same tile.
 */
export function demandSwapOptions(data: GameData, state: GameState): [DemandRef, DemandRef][] {
  const open = state.island.tiles.filter((t) => tileHasRoom(data, t));
  // ⭐ THE TOKEN VALUES ARE READ ONCE PER CRATE (04/09/2026), not once per pair.
  // This enumerator is O(refs squared) - 24 refs at four seats is 276 pairs -
  // and it runs inside `taskAnswers`, which `apply` calls to re-validate EVERY
  // move, including the bots' speculative probe applies. A CPU profile put it
  // and its key builder at ~15% of a whole game. Nothing below changes what is
  // enumerated, what is de-duped or the order it comes out in: the same key
  // strings are built, by a route that stops rebuilding the parts that did not
  // move.
  const values = open.map((t) => t.crates.map((_, i) => tokenValue(t, i)));
  const refTile: number[] = [];
  const refs: DemandRef[] = [];
  for (let t = 0; t < open.length; t++) {
    const tile = open[t] as IslandTileState;
    for (let i = 0; i < tile.crates.length; i++) {
      refTile.push(t);
      refs.push({ tile: tile.tile, crate: i });
    }
  }
  // WHAT A SWAP LEAVES BEHIND ON ONE TILE, as an integer.
  //
  // The de-dupe asks one question: would these two swaps leave the island in the
  // same configuration? A configuration is the UNORDERED PAIR of (tile, that
  // tile's tokens afterwards), which is exactly what the old key string spelled
  // out, so any INJECTIVE naming of a (tile, tokens-afterwards) gives the same
  // equivalence classes, the same survivors and the same order. Interning that
  // name as an integer is what takes the string building out of a loop that is
  // O(refs squared) - 24 refs at four seats is 276 pairs, every one of which was
  // building three strings.
  //
  // The interner is per tile with one shared counter, so an id names the pair
  // and not just the tokens: two tiles left holding the same tokens are two
  // different configurations.
  const ids: Map<string, number>[] = open.map(() => new Map<string, number>());
  let nextId = 0;
  const idFor = (t: number, tokens: string): number => {
    const interner = ids[t] as Map<string, number>;
    let id = interner.get(tokens);
    if (id === undefined) {
      id = nextId++;
      interner.set(tokens, id);
    }
    return id;
  };
  // The state one tile is left in once one of its crates has been replaced,
  // memoised per (tile, crate, replacement): a few dozen distinct triples across
  // a whole pass, against several hundred pairs asking for them.
  const afterCache = values.map((v) => v.map(() => new Map<string, number>()));
  const afterOne = (t: number, crate: number, replacement: string): number => {
    const cache = (afterCache[t] as Map<string, number>[])[crate] as Map<string, number>;
    let hit = cache.get(replacement);
    if (hit === undefined) {
      const parts = (values[t] as string[]).slice();
      parts[crate] = replacement;
      hit = idFor(t, parts.sort().join(','));
      cache.set(replacement, hit);
    }
    return hit;
  };
  const out: [DemandRef, DemandRef][] = [];
  // The unordered pair of ids, as a bucket per low id. Nested rather than
  // arithmetic on one number, so nothing has to bound the id count to stay
  // collision-free.
  const seen = new Map<number, Set<number>>();
  for (let i = 0; i < refs.length; i++) {
    const ti = refTile[i] as number;
    const a = refs[i] as DemandRef;
    const va = (values[ti] as string[])[a.crate] as string;
    for (let j = i + 1; j < refs.length; j++) {
      const tj = refTile[j] as number;
      const b = refs[j] as DemandRef;
      const vb = (values[tj] as string[])[b.crate] as string;
      if (va === vb) continue;
      let sideA: number;
      let sideB: number;
      if (ti === tj) {
        // Both crates are on ONE tile, so the swap rewrites two positions of the
        // same token string and both sides of the pair read it.
        const parts = (values[ti] as string[]).slice();
        parts[a.crate] = vb;
        parts[b.crate] = va;
        sideA = idFor(ti, parts.sort().join(','));
        sideB = sideA;
      } else {
        sideA = afterOne(ti, a.crate, vb);
        sideB = afterOne(tj, b.crate, va);
      }
      const lo = sideA <= sideB ? sideA : sideB;
      const hi = sideA <= sideB ? sideB : sideA;
      let bucket = seen.get(lo);
      if (bucket === undefined) {
        bucket = new Set<number>();
        seen.set(lo, bucket);
      }
      if (bucket.has(hi)) continue;
      bucket.add(hi);
      out.push([a, b]);
    }
  }
  return out;
}

/**
 * V6's targets: one token per open tile where a receipt has ALREADY been taken.
 *
 * That gate is the timing dial, not flavour - it is what replaced promoting the
 * card to Tier 2, so it is enumerated here rather than merely asserted in the
 * verb. The card cannot fire at all until somebody has delivered, and it opens
 * only the half-run tiles: "the second buyer isn't fussy".
 *
 * A cornucopia and an already-blank token are both skipped, because turning
 * either buys nothing. De-duped by token value per tile for the same reason
 * `demandSwapOptions` is.
 */
export function demandFaceDownOptions(data: GameData, state: GameState): DemandRef[] {
  const out: DemandRef[] = [];
  for (const tile of state.island.tiles) {
    if (tile.deliveredBy.length < 1) continue;
    if (!tileHasRoom(data, tile)) continue;
    const seen = new Set<string>();
    for (let i = 0; i < tile.crates.length; i++) {
      const value = tokenValue(tile, i);
      if (value === 'wild' || value === 'down') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ tile: tile.tile, crate: i });
    }
  }
  return out;
}

/**
 * Demand-side spends per tile this seat may deliver to (wild crates resolved to
 * a suit each), BEFORE affordability. Since the flat island the only demand-side
 * gate left is whether the tile has a free receipt space - `seat` is taken but
 * unused, kept because every caller has one and a future rule that does look at
 * the seat should not have to re-thread it. V12's treat-one-card-as-Vegetable
 * enumerates against these; everything else goes through deliverOptions.
 */
export function deliverDemands(data: GameData, state: GameState, _seat: Seat): DeliverOption[] {
  const out: DeliverOption[] = [];
  for (const tile of state.island.tiles) {
    if (!tileHasRoom(data, tile)) continue;
    const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
    for (const fill of wildFills(state.suitsInPlay, wilds)) {
      const spend: Partial<Record<Suit, number>> = { ...base };
      for (const s of fill) spend[s] = (spend[s] ?? 0) + cardsPerCrate;
      out.push({ tile: tile.tile, spend });
    }
  }
  return out;
}

// --- The wild substitution -------------------------------------------------
//
// "When you pay the island, any single card it asks for may instead be paid
// with `cardsPerSubstitution` cards of any crops." Island delivery only: the
// balloon move, build costs and everything else that spends barn cards are
// untouched, and must stay that way or the barn stops being a dead end.
//
// The whole rule reduces to one piece of arithmetic. Against a concrete demand
// `need`, let M be the cards of the spend that land on a suit the demand named
// (capped at what it named). Then `totalNeed - M` cards had to be substituted,
// and the spend's remaining `totalSpend - M` cards are what pays for them. So a
// spend is legal exactly when those two balance at the substitution rate. With
// the rule off, that collapses to the old exact-match test, which is why there
// is no second code path for it.

export function tallyTotal(m: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const v of Object.values(m)) n += v ?? 0;
  return n;
}

/** Cards of `spend` that count against `need` directly, i.e. not as filler. */
export function matchedAgainst(
  need: Partial<Record<Suit, number>>,
  spend: Partial<Record<Suit, number>>,
): number {
  let m = 0;
  for (const [suit, want] of Object.entries(need) as [Suit, number][]) {
    m += Math.min(spend[suit] ?? 0, want);
  }
  return m;
}

/**
 * Could this barn pay this demand at all? Cheap - no enumeration, because the
 * filler is any-suit, so only the TOTAL surplus matters. This is what keeps
 * `anyDeliverOption` a fast path rather than a hidden full enumeration.
 */
function canPay(
  data: GameData,
  need: Partial<Record<Suit, number>>,
  tally: Partial<Record<Suit, number>>,
): boolean {
  const matched = matchedAgainst(need, tally);
  const short = tallyTotal(need) - matched;
  if (short === 0) return true;
  const rate = data.island.cardsPerSubstitution;
  if (rate === null) return false;
  return tallyTotal(tally) - matched >= rate * short;
}

/** Multisets of size n over the suits, each suit capped by what the barn holds. */
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
 * Substituted spends for one demand this barn cannot pay exactly.
 *
 * Only the MINIMUM number of substitutions is offered. Substituting a card you
 * could have supplied is legal and `doDeliver` accepts it, but it is strictly
 * worse - it costs an extra card and buys nothing, because the barn is a dead
 * end and no rule pays you for emptying it. Offering those shapes would multiply
 * the move list for choices no player would make. The genuine decision that IS
 * offered is which crops the filler comes out of.
 */
export function substitutedSpends(
  data: GameData,
  suits: readonly Suit[],
  need: Partial<Record<Suit, number>>,
  tally: Partial<Record<Suit, number>>,
): Partial<Record<Suit, number>>[] {
  const rate = data.island.cardsPerSubstitution;
  if (rate === null) return [];
  const matched: Partial<Record<Suit, number>> = {};
  for (const [suit, want] of Object.entries(need) as [Suit, number][]) {
    matched[suit] = Math.min(tally[suit] ?? 0, want);
  }
  const short = tallyTotal(need) - tallyTotal(matched);
  if (short === 0) return [];
  const surplus: Partial<Record<Suit, number>> = {};
  for (const suit of suits) surplus[suit] = (tally[suit] ?? 0) - (matched[suit] ?? 0);
  return fillerSpends(suits, rate * short, surplus).map((filler) => {
    const spend: Partial<Record<Suit, number>> = { ...matched };
    for (const [suit, n] of Object.entries(filler) as [Suit, number][]) {
      spend[suit] = (spend[suit] ?? 0) + n;
    }
    for (const suit of Object.keys(spend) as Suit[]) {
      if (spend[suit] === 0) delete spend[suit];
    }
    return spend;
  });
}

/** Stable key for de-duping spends that differ only in how they were derived. */
export function spendKey(tile: string, spend: Partial<Record<Suit, number>>): string {
  const parts = (Object.entries(spend) as [Suit, number][])
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([s, n]) => `${s}${n}`);
  return `${tile}|${parts.join(',')}`;
}

/**
 * Every payment this seat could actually make, exact and substituted.
 *
 * Substituted spends are generated barn-aware rather than filtered afterwards,
 * because the filler is drawn from surplus and enumerating it blind would be a
 * combinatorial explosion for shapes the barn cannot cover anyway. The result is
 * de-duped: two different wild-crate fills collapse to the same spend once
 * enough of the tile is paid in filler.
 */
/**
 * WHAT THIS SEAT CAN PAY THE ISLAND WITH: the barn, plus the meeple supply when
 * R15 is live.
 *
 * ⚠️ EVERY ROUTE THAT ASKS "CAN THIS SEAT DELIVER" MUST ASK THIS ONE,
 * not `barnTally`. `anyDeliverOption` gates the green door through
 * `workerActionLegal`, `payableTileCount` prices it for the bots, and
 * `deliverOptions` enumerates it; a tally that disagreed between them would
 * offer a door with no legal move behind it.
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
 * barn is short of, which cannot happen for a spend derived from
 * `deliverTally` but is re-checked because `doDeliver` accepts a spend it did
 * not generate.
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
): DeliverOption[] {
  const barn = deliverTally(data, state, seat);
  const asCard = meepleAsCard(data);
  const onBoard = meepleAsCardGoesToBoard(data);
  const rate = data.rules.turn.paymentSlotToll;
  const demands = deliverDemands(data, state, seat);
  const out: DeliverOption[] = [];
  const seen = new Set<string>();
  demandLoop: for (const demand of demands) {
    const affordable = (Object.entries(demand.spend) as [Suit, number][]).every(
      ([s, n]) => (barn[s] ?? 0) >= n,
    );
    // ⛔ THE FILLER IS DRAWN FROM EVERY SUIT, NOT ONLY THE SUITS IN PLAY, AND
    // THAT IS A BUG FIX RATHER THAN A WIDENING (04/09/2026). `canPay` - the fast
    // path behind `anyDeliverOption`, which GATES the green door - has always
    // measured the surplus over the WHOLE tally, while this line could only
    // spend it from `state.suitsInPlay`. The two agreed by accident for as long
    // as the tally was the barn alone, because a barn card can only ever arrive
    // from a deck in play.
    //
    // ⚠️ R15 ENDED THE ACCIDENT. The delivery tally now includes the MEEPLE
    // SUPPLY, and every seat holds meeples in all five colours whether or not
    // anybody farms them (R3), so a colour outside `suitsInPlay` reached the
    // tally for the first time: the gate said "payable", this line offered
    // nothing, `legalMoves` fell through to `pass` on an empty list and `apply`
    // re-checked with the gate and threw. It cost 2 games in 4820 on the first
    // meeple-as-card run.
    //
    // Widening THIS side rather than narrowing the gate is what keeps the rule
    // true: a meeple IS a card of its colour (R15) and the island's own
    // substitution takes "2 cards of any crops", so an unfarmed colour is a
    // legal filler and refusing it would be a second rule nobody wrote. It
    // cannot move the controls: with no meeples in the tally the surplus of an
    // out-of-play suit is 0, `fillerSpends` caps every take at the surplus, and
    // a capped-at-zero suit contributes one pass-through iteration and the same
    // list in the same order.
    // ⚠️ THE ORDER OF THIS LIST IS LOAD-BEARING, and getting it wrong moved
    // the CONTROL arm without changing a rule - 17,715 positions became 17,878
    // over 40 games when this passed `data.cards.suits` outright. `fillerSpends`
    // recurses in the order it is handed, that order reaches the bots'
    // tie-break, and `state.suitsInPlay` is NOT catalogue order (it is the
    // players' suits, then the neutral decks). So the suits in play come FIRST,
    // exactly as before, and the rest are APPENDED: their surplus is 0 in any
    // game without meeples in the tally, a zero-capped suit is a single
    // pass-through iteration, and the list that comes back is identical
    // element for element.
    const fillerSuits = [
      ...state.suitsInPlay,
      ...data.cards.suits.filter((x) => !state.suitsInPlay.includes(x)),
    ];
    const spends = affordable
      ? [demand.spend]
      : substitutedSpends(data, fillerSuits, demand.spend, barn);
    for (const spend of spends) {
      const key = spendKey(demand.tile, spend);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!asCard) {
        out.push({ tile: demand.tile, spend });
        if (out.length >= limit) break demandLoop;
        continue;
      }
      const meeples = meepleShare(data, state, seat, spend);
      if (meeples === null) continue;
      if (meepleCount(meeples) === 0) {
        out.push({ tile: demand.tile, spend });
        if (out.length >= limit) break demandLoop;
        continue;
      }
      if (!onBoard) {
        out.push({ tile: demand.tile, spend, meeples });
        if (out.length >= limit) break demandLoop;
        continue;
      }
      // ⭐ R17: the crate's meeple share lands on a neighbour's board rather
      // than in the box, so one spend becomes one option per legal placement.
      for (const spot of placementsFor(data, state, seat, meeples, rate)) {
        out.push({
          tile: demand.tile,
          spend,
          meeples,
          placements: spot.boards,
          paymentToll: spot.toll,
        });
        if (out.length >= limit) break demandLoop;
      }
    }
  }
  return out;
}

/**
 * Is ANY island delivery open to this seat? Kept as a fast path - it walks the
 * wild-crate fills but never enumerates a filler, because `canPay` only needs
 * the total surplus. Every route that can deliver must agree with this, so it
 * has to see the substitution too: a seat holding a payable-by-substitution
 * barn is not a seat with no deliveries.
 */
export function anyDeliverOption(data: GameData, state: GameState, seat: Seat): boolean {
  const barn = deliverTally(data, state, seat);
  if (!state.island.tiles.some((tile) => payableBy(data, state, tile, barn))) return false;
  if (!meepleAsCardGoesToBoard(data)) return true;
  // ⛔ R17, same seam as `anyBuildOption`: the tally says the crate is payable,
  // but the meeple half of the payment has to LAND somewhere and the toll comes
  // out of the same supply. If the barn alone could pay there is nothing to
  // place and the fast answer stands; otherwise the gate asks the enumerator,
  // because a gate wider than its enumerator offers `pass` on an empty list and
  // `apply` throws.
  return deliverOptions(data, state, seat, 1).length > 0;
}

/** Could this barn pay this open tile, by any nomination of its wild crates? */
function payableBy(
  data: GameData,
  state: GameState,
  tile: IslandTileState,
  tally: Partial<Record<Suit, number>>,
): boolean {
  if (!tileHasRoom(data, tile)) return false;
  const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
  return wildFills(state.suitsInPlay, wilds).some((fill) => {
    const need: Partial<Record<Suit, number>> = { ...base };
    for (const s of fill) need[s] = (need[s] ?? 0) + cardsPerCrate;
    return canPay(data, need, tally);
  });
}

/**
 * DELIVERABILITY: how many open tiles this seat could pay for right now.
 *
 * `anyDeliverOption` asks the same question and stops at the first yes; this
 * counts, because the bots' pricer needs a POSITION rather than a boolean. It
 * exists for the mutable demand tokens (V5, V6), whose whole effect is to change
 * this number and which produce no delta at all in the acting seat's own
 * resources - so a pricer that reads only its own zones values them at zero.
 *
 * Reads through `namedDemand`, so face-down tokens and the wild substitution are
 * both already in it.
 */
export function payableTileCount(data: GameData, state: GameState, seat: Seat): number {
  const tally = deliverTally(data, state, seat);
  return state.island.tiles.filter((tile) => payableBy(data, state, tile, tally)).length;
}

export function doDeliver(
  fx: Fx,
  seat: Seat,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
  /** V12's "treat any 1 card as a Vegetable": each entry relabels one spent card for validation only. */
  countAs?: { from: Suit; to: Suit }[],
  /**
   * V14 The Distribution Center: "take BOTH of its receipts" - receipts taken
   * for ONE payment. Defaults to 1, which is every other delivery in the game.
   * The tile must have room for all of them, so V14's own "where nobody has
   * delivered" gate falls out of the capacity check below rather than being
   * asserted twice.
   */
  receipts = 1,
  /**
   * R15: the part of `spend` paid out of the SUPPLY rather than the barn. Omit
   * and it is derived barn-first, which is what every enumerated option does;
   * pass it and it is validated against the same rule.
   */
  meepleSpend?: Partial<Record<Suit, number>>,
  /** R17: where the crate's meeple share lands, and the toll it owed. */
  placement?: {
    placements?: Partial<Record<Suit, number>>[];
    paymentToll?: Partial<Record<Suit, number>>;
  },
): void {
  const state = fx.state;
  const tile = state.island.tiles.find((t) => t.tile === tileId);
  if (!tile) throw new Error(`Tile ${tileId} is not in play`);
  if (receipts < 1) throw new Error('A delivery takes at least one receipt');
  if (tile.deliveredBy.length + receipts > deliveriesPerTile(fx.data)) {
    throw new Error(
      receipts === 1
        ? `Tile ${tileId} has no delivery slots left`
        : `Tile ${tileId} has no delivery slots left for ${receipts} receipts at once`,
    );
  }
  const virtual: Partial<Record<Suit, number>> = { ...spend };
  for (const sub of countAs ?? []) {
    if ((virtual[sub.from] ?? 0) < 1) {
      throw new Error(`No ${sub.from} card in the spend to count as ${sub.to}`);
    }
    virtual[sub.from] = (virtual[sub.from] as number) - 1;
    virtual[sub.to] = (virtual[sub.to] ?? 0) + 1;
  }
  // Validate against every way the wild crates could have been nominated, and
  // accept if any of them balances. A search rather than arithmetic on `base`
  // alone, because once a card is paid in filler the crate that wanted it no
  // longer pins a suit, so there is no closed form over the unfilled demand.
  const { base, wilds, cardsPerCrate } = namedDemand(fx.data, tile);
  const rate = fx.data.island.cardsPerSubstitution;
  const paid = tallyTotal(virtual);
  const legal = wildFills(fx.data.cards.suits, wilds).some((fill) => {
    const need: Partial<Record<Suit, number>> = { ...base };
    for (const s of fill) need[s] = (need[s] ?? 0) + cardsPerCrate;
    const matched = matchedAgainst(need, virtual);
    const substituted = tallyTotal(need) - matched;
    if (substituted === 0) return paid === matched;
    if (rate === null) return false;
    return paid - matched === rate * substituted;
  });
  if (!legal) {
    throw new Error(
      rate === null
        ? `Spend does not pay ${tileId}: a crate is ${cardsPerCrate} cards of ONE suit`
        : `Spend does not pay ${tileId}: unmatched cards cost ${rate} of any crop each`,
    );
  }

  // ⭐ R15: THE MEEPLE HALF OF THE PAYMENT COMES OUT FIRST AND GOES TO THE
  // BOX. `spend` is what the ISLAND was paid, in suits; `meeples` is which of
  // it came out of the supply, and the barn pays the rest. The split is derived
  // barn-first (see `DeliverOption.meeples`), and a caller that names its own
  // is held to the same arithmetic - it may never claim a meeple for a suit the
  // barn could have covered, or the same delivery would be payable two ways and
  // `apply` would accept a move `legalMoves` never offered.
  const meeples = meepleSpend ?? meepleShare(fx.data, state, seat, spend) ?? {};
  const meepleTotal = meepleCount(meeples);
  if (meepleTotal > 0 && !meepleAsCard(fx.data)) {
    throw new Error('A meeple pays an island crate only under rules.turn.meepleAsCard');
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
    if (placement?.placements === undefined) {
      fx.payMeeplesAsCards(seat, meeples, 'delivery');
    } else {
      assertPlacementMatches(fx.data, state, seat, meeples, placement);
      fx.placeMeeplesAsCards(seat, placement.placements, placement.paymentToll ?? {}, 'delivery');
    }
  }
  const cards = fx.spendFromBarn(seat, fromBarn);
  finishDelivery(fx, seat, tile, tileId, spend, cards, receipts, meepleTotal, meeples);
}

/**
 * THE RECEIPT/SCORE/HOOK/CLOCK TAIL EVERY DELIVERY SHARES, whatever paid for
 * the crate. Extracted 09/09/2026 so Dean's 'spend' variant's vegetable leg
 * (`doCommonsSpendDeliver`, paid from a central pile rather than a barn) can
 * score "exactly as a barn delivery" - the brief's own words - by calling the
 * SAME tail rather than a second copy of it. `doDeliver` is a pure extraction
 * around this call and its behaviour is unchanged.
 *
 * Read each VP and each MEEPLE off the space BEFORE the delivery joins the
 * tile, or the first deliverer would be paid the second deliverer's rate and
 * handed the second deliverer's meeple. The tile's own fill order is the whole
 * gradient: 6 for being first here, 3 for being second - so V14's "both
 * receipts" is 6 + 3 = 9 plus BOTH meeples, with no scoring rule of its own.
 *
 * ⭐ THE MEEPLE REPLACED THE COIN (v31). Every delivery used to also mint a
 * flat GBP 1 (`island.tileRule.coinsPerDelivery`, pinned at 0 as a tombstone
 * now). Both spaces on every tile carry one, and both are claimed - the 3 VP
 * space is not a consolation, it is 3 VP AND a free action.
 *
 * One `delivered` event per receipt, so nothing counting deliveries has to
 * learn that one of them can be double; only the first carries the spend,
 * because only one payment was made.
 */
export function finishDelivery(
  fx: Fx,
  seat: Seat,
  tile: IslandTileState,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
  cards: CardId[],
  receipts: number,
  meepleTotal = 0,
  meeples: Partial<Record<Suit, number>> = {},
): void {
  const state = fx.state;
  for (let i = 0; i < receipts; i++) {
    const space = tile.deliveredBy.length;
    const vp = deliveryVp(fx.data, space);
    player(state, seat).receipts.push(vp);
    tile.deliveredBy.push(seat);
    fx.emit({ e: 'delivered', seat, tile: tileId, vp, spend: i === 0 ? spend : {} });
    // ⭐ WHICH SPACES CARRY A MEEPLE IS DATA, NOT ARITHMETIC (R12). Under the
    // shipped game every space does and `meepleIndexForSpace` is the identity;
    // under the meeple arm only `island.meeples.seededSpaces` do - [1], the 3 VP
    // second delivery - and the tile stores its one meeple densely at index 0.
    // A -1 is a space that was never seeded, which is a legal delivery paying VP
    // alone. The gain goes through the supply cap and boxes a duplicate.
    const slot = meepleIndexForSpace(fx.data, space);
    const meeple = slot < 0 ? undefined : tile.meeples[slot];
    if (meeple !== undefined) fx.gainMeeple(seat, meeple, tileId, space, 'island');
  }
  // ONE Deliver, so one afterDeliver: the rebuilt Farmstead puts one card in the
  // barn for a delivery, not one per receipt taken.
  // ⭐ THE HOOK CARRIES THE MEEPLES TOO (v2 section 5, default: a meeple in a
  // crate is a card of its colour in all ways). NO CARD IN THE CATALOGUE READS
  // `afterDeliver` TODAY, so the field is a promise rather than a behaviour: the
  // next card that fires on cards delivered has to decide, and this is where it
  // will find them.
  fireHook(fx, 'afterDeliver', {
    seat,
    island: true,
    tile: tileId,
    cards,
    ...(meepleTotal > 0 ? { meeples } : {}),
  });
  // The clock: one seat's Nth ISLAND delivery ends the game. Counted after every
  // push (RULING G, recommended: V14's two receipts are two deliveries toward
  // the trigger), and off the island rather than off `receipts`, because
  // receipts is a VP list that other rules could one day write to and the
  // trigger must stay a count of things visible on the board.
  const target = fx.data.rules.endGame.deliveriesToTrigger;
  if (state.endTrigger === null && islandDeliveriesBy(state, seat) >= target) {
    state.endTrigger = { seat };
    fx.emit({ e: 'endTriggered', seat });
  }
  pushStoreExchange(fx, seat);
}

/**
 * ⭐ THE VILLAGE STORE'S EXCHANGE, QUEUED (V1 to V5, Dean 12/09/2026, ledger
 * A150): *"when you make a delivery you may spend any number of ADDITIONAL
 * cards from your barn, taking £1 each"*.
 *
 * ⛔ IT HANGS OFF `finishDelivery` AND NOTHING ELSE, WHICH SETTLES THREE RULES
 * AT ONCE AND IS WHY IT IS HERE RATHER THAN IN `doDeliver`.
 *
 *   - **V3, the important one**: `finishDelivery` runs AFTER `spendFromBarn`,
 *     so the crate is already paid and a player can never convert the cards the
 *     delivery itself needs. Queued from `doDeliver` it would be the opposite
 *     rule, and the opposite rule is a delivery you can talk yourself out of.
 *   - **D2**: EVERY delivery mints, not only a main-action Deliver, because
 *     `finishDelivery` is the tail every delivery shares - a Notice Board
 *     power's, a card effect's and Dean's 'spend' variant's vegetable leg
 *     included. V1 says "a delivery" and this is what that sentence costs.
 *   - **And the balloon stays out**, which is right: a freight move is the
 *     DELIVER ACTION's other branch and never a delivery. It has its own tail
 *     and never reaches this one.
 *
 * ⭐ APPENDED RATHER THAN PREPENDED. The receipts, the `afterDeliver` hook and
 * the end-of-game trigger have all resolved by the time this is asked, which is
 * the order a player would describe: deliver, score it, then trade at the store.
 * A prepend would interleave the exchange with a card's reaction to the
 * delivery, which is a rule nobody wrote.
 *
 * `remaining` is min(barn size, coins left) and it is a CEILING rather than a
 * demand: the task is optional at every step (D3) and re-bounded at each answer
 * against the shared supply (D4). Nothing is pushed when either is zero, so the
 * shipped game - `storeCoinsPerCard` 0 - queues nothing at all and every
 * delivery is byte-identical to 11/09/2026.
 */
function pushStoreExchange(fx: Fx, seat: Seat): void {
  if (storeCoinsPerCard(fx.data) <= 0) return;
  const barn = player(fx.state, seat).barn.length;
  const remaining = Math.min(barn, coinSupplyLeft(fx.state));
  if (remaining <= 0) return;
  fx.pushTask({ t: 'mint', pid: seat, remaining });
}

// --- The Aerodrome: the Deliver action's freight branch ---------------------

export interface BalloonMoveOption {
  balloon: string;
  spend: Partial<Record<Suit, number>>;
}

/**
 * The printed move cost as concrete spends: `barnCards` cards, one per suit
 * when `mustDiffer` (the 2-with-a-slash icon). Data-driven so the overlay's
 * barnCards knob composes.
 */
function balloonSpends(
  data: GameData,
  state: GameState,
  seat: Seat,
): Partial<Record<Suit, number>>[] {
  const cost = data.aerodrome.moveCost;
  if (!cost.mustDiffer) throw new Error('Only the printed different-suits move cost is modelled');
  const tally = barnTally(data, state, seat);
  const suits = state.suitsInPlay.filter((s) => (tally[s] ?? 0) >= 1);
  return subsets(suits, cost.barnCards).map(
    (pick) => Object.fromEntries(pick.map((s) => [s, 1])) as Partial<Record<Suit, number>>,
  );
}

/** Every legal (balloon, spend) pair. Source is the centre or a rival's Aerodrome, never your own. */
export function balloonMoveOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
): BalloonMoveOption[] {
  const aero = state.aerodrome;
  if (!aero) return [];
  const movable = aero.balloons.filter((b) => b.at !== seat);
  if (movable.length === 0) return [];
  return movable.flatMap((b) =>
    balloonSpends(data, state, seat).map((spend) => ({ balloon: b.id, spend })),
  );
}

export function anyBalloonMoveOption(data: GameData, state: GameState, seat: Seat): boolean {
  const aero = state.aerodrome;
  if (!aero || !aero.balloons.some((b) => b.at !== seat)) return false;
  return balloonSpends(data, state, seat).length > 0;
}

/**
 * The four steps every balloon move shares, whatever paid for it: the balloon
 * changes Aerodrome, the raid hook fires, the deliver hook fires, the reward is
 * granted. Factored out so the barn-paid and hand-paid entry points cannot
 * drift - the two differ ONLY in what they take off the payer.
 *
 * `grantReward: false` is V8 The Regional Depot, which takes the reward of a
 * balloon of its choosing instead: suppressed here rather than granted twice.
 */
function landBalloon(
  fx: Fx,
  seat: Seat,
  balloonId: string,
  spend: Partial<Record<Suit, number>>,
  cards: CardId[],
  /** Cards of the payment that came out of the HAND rather than the barn. */
  hand: number,
  free: boolean,
  grantReward = true,
): void {
  const aero = fx.state.aerodrome as AerodromeState;
  const balloon = aero.balloons.find((b) => b.id === balloonId) as {
    id: string;
    at: Seat | 'centre';
  };
  const from = balloon.at;
  balloon.at = seat;
  fx.emit({ e: 'balloonMoved', seat, balloon: balloonId, from, spend, hand, free });
  fireHook(fx, 'afterBalloonMove', { seat, balloon: balloonId, from });
  fireHook(fx, 'afterDeliver', { seat, island: false, cards });
  if (grantReward) grantBalloonReward(fx, seat, balloonId);
}

/** The shared source rule: the centre or a rival's Aerodrome, never your own. */
function movableBalloon(fx: Fx, seat: Seat, balloonId: string): void {
  const aero = fx.state.aerodrome;
  if (!aero) throw new Error('The Aerodrome module is not in play');
  const balloon = aero.balloons.find((b) => b.id === balloonId);
  if (!balloon) throw new Error(`Unknown balloon ${balloonId}`);
  if (balloon.at === seat) throw new Error('A balloon is never moved from your own Aerodrome');
}

/**
 * Move a balloon to your Aerodrome and collect its reward. `spend` is the
 * printed BARN cost; null is a card effect's FREE move (no cards, but still a
 * balloon move, so the raid hook and the deliver hook both fire). The raided
 * player is not compensated (ruling J - on the sim watch list).
 *
 * This is the base rule and it is UNCHANGED for everybody, including Vegetable:
 * 2 barn cards of differing crops, spent as the Deliver action. It is what keeps
 * the balloon the table's orphan sink.
 */
export function doMoveBalloon(
  fx: Fx,
  seat: Seat,
  balloonId: string,
  spend: Partial<Record<Suit, number>> | null,
): void {
  movableBalloon(fx, seat, balloonId);

  let cards: CardId[] = [];
  if (spend !== null) {
    const cost = fx.data.aerodrome.moveCost;
    const counts = Object.values(spend) as number[];
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== cost.barnCards) {
      throw new Error(`A balloon move costs ${cost.barnCards} barn cards, got ${total}`);
    }
    if (cost.mustDiffer && counts.some((n) => n > 1)) {
      throw new Error('The balloon move cards must differ in suit');
    }
    cards = fx.spendFromBarn(seat, spend);
  }

  landBalloon(fx, seat, balloonId, spend ?? {}, cards, 0, spend === null);
}

/**
 * THE HAND-PAID FLIGHT (the Vegetable rebuild, 2026-08-09). A sibling of
 * doMoveBalloon, not a branch inside it: the base rule is untouched for everyone
 * and Vegetable's Depots simply print a second way in.
 *
 * Two differences from the barn payment, both deliberate:
 *
 *  - The cards come out of the HAND. That is the whole change. In the v3 draft
 *    both of the suit's outlets ate barn cards, so a Vegetable seat chose every
 *    turn between flying freight and scoring it; moving flights onto the hand
 *    removes the choice, and the island keeps the barn to itself.
 *  - NO SUIT CONSTRAINT. The differing-crops rule belongs to the barn payment,
 *    where it is what makes the balloon a sink for odd cards. Vegetable's route
 *    is deliberately unfussy, so the fee is the worst two cards in hand.
 *
 * ⚠️ It fires `afterDeliver` with `island: false`, exactly as the barn payment
 * does, on the grounds that one funnel is worth more than the purity - see the
 * handler notes on V4. The rebuilt Vegetable Farmstead guards on `island` and is
 * unaffected, and nothing else in the catalogue reads a non-island deliver.
 */
export function doMoveBalloonFromHand(
  fx: Fx,
  seat: Seat,
  balloonId: string,
  cards: CardId[],
  opts?: { grantReward?: boolean },
): void {
  movableBalloon(fx, seat, balloonId);
  const cost = fx.data.aerodrome.handMoveCost;
  if (cards.length !== cost) {
    throw new Error(`A hand-paid balloon move costs ${cost} cards, got ${cards.length}`);
  }
  if (new Set(cards).size !== cards.length) throw new Error('Duplicate card in the flight fee');
  for (const card of cards) fx.removeFromHand(seat, card);
  fx.discard(cards);
  landBalloon(fx, seat, balloonId, {}, cards, cards.length, false, opts?.grantReward ?? true);
}

/**
 * The hand-paid flights on offer: every balloon not already yours, against every
 * way to pay for it out of hand. Enumerated concretely, like every other option
 * set, so `apply` re-validates exactly what was offered.
 *
 * Bounded by the HAND LIMIT and by nothing else - `subsets(hand, 2)` is C(hand,
 * 2), which is 66 fee choices per balloon at the shipped limit of 12 and 561 at
 * a hand of 34. See the warning on `subsets` itself: this comment used to quote
 * "a hand of 5-7" as though that were a fact about the game, and it was a fact
 * about `rules.turn.handLimit`.
 */
export function handBalloonMoveOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
): { balloon: string; cards: CardId[] }[] {
  const aero = state.aerodrome;
  if (!aero) return [];
  const movable = aero.balloons.filter((b) => b.at !== seat);
  if (movable.length === 0) return [];
  const fees = subsets(player(state, seat).hand, data.aerodrome.handMoveCost);
  return movable.flatMap((b) => fees.map((cards) => ({ balloon: b.id, cards })));
}

/** The reward printed under the balloon, from aerodrome.json (overlay-tunable). */
export function grantBalloonReward(fx: Fx, seat: Seat, balloonId: string): void {
  const balloon = fx.data.aerodrome.balloons.find((b) => b.id === balloonId);
  if (!balloon) throw new Error(`No balloon ${balloonId} in the data`);
  const { type: reward } = balloon.reward;
  // `harvestAny` prints no size, so `amount` is optional on the type and every
  // sized reward has to say what it does without one. 1 is the floor rather than
  // a default worth tuning: a balloon with no printed number is a data error.
  const amount = balloon.reward.amount ?? 1;
  switch (reward) {
    case 'draw':
      // A card-ability draw, and since v31 there is no draw modifier at all for
      // it to skip (DL-47 kept it clear of the Orchard Farmstead's; that power
      // is gone).
      fx.pushTask({ t: 'draw', pid: seat, src: null, see: amount, keep: amount, revealed: [] });
      break;
    case 'buildDiscount':
      fx.pushTask({ t: 'build', pid: seat, src: null, mods: { discount: amount } });
      break;
    case 'sowFromHand':
      // "Sow 4 cards from your hand" reads as up-to: skippable, stops early.
      fx.pushTask({ t: 'sow', pid: seat, src: null, remaining: amount, optional: true });
      break;
    case 'meepleFromBag':
      // ⭐ DEAN'S BALLOON (03/09/2026): "draw a random meeple from a bag".
      //
      // The ONLY reward in the module denominated in actions rather than cards,
      // which is the point of testing it: the other three hand over material,
      // and material is what the Vegetable seat already has most of.
      //
      // ⚠️ RANDOM, AND THE RANDOMNESS IS NOT DECORATION. Two of the five colours
      // are measured dead - Apiary and Dairy meeples are spent about 10% of the
      // time against Wheat's 78% - because Harvest, Deliver and Draw GAIN you
      // cards while Sow and Build SPEND them. So a random meeple is worth
      // roughly three fifths of a chosen one, and this balloon is self-limiting
      // in a way a chosen-colour version would not be. If it reads too weak, the
      // first thing to try is letting the player choose, NOT raising `amount`.
      //
      // ⚠️ Drawn uniformly from the five colours and NOT from the island's bag
      // of 25: that bag is 24/25 dealt at four seats, so drawing from it would
      // make this balloon nearly dead at 4p and strong at 2p. See the note on
      // `BalloonRewardType` for the component question that leaves open.
      {
        const colours = fx.data.island.meeples.colours;
        for (let i = 0; i < amount; i++) {
          const colour = colours[rngInt(fx.state.rng, colours.length)];
          // The supply cap (R4) applies to a balloon meeple exactly as it does
          // to an island one, under the meeple arm only; `gainMeeple` boxes the
          // duplicate and says which faucet overflowed.
          if (colour !== undefined) fx.gainMeeple(seat, colour, null, null, 'balloon');
        }
      }
      break;
    case 'harvestAny':
      // ⭐ THE MAGENTA BALLOON, REPOINTED IN v31. It read "Gain £4" and was the
      // last coin faucet on the board; it now reads "Harvest any building, even
      // if it is not full."
      //
      // `filter: 'loaded'` is that sentence: any building of yours with 1 or
      // more cards on it, however far off its threshold. It carries no `amount`
      // - "even if it is not full" is a permission, not a size - and it is NOT
      // optional, because a seat with nothing loaded has no legal answer and the
      // drain loop drops the task, which is the printed "whiffs" reading and
      // needs no skip.
      fx.pushTask({ t: 'chooseBuilding', pid: seat, src: null, filter: 'loaded', then: 'harvest' });
      break;
    default:
      reward satisfies never;
  }
}

/**
 * The Deliver action's full option set as task answers - island deliveries
 * AND balloon moves (a balloon move IS a Deliver, DL-12). The generic deliver
 * task and the Vegetable deliver cards both enumerate through here.
 */
export function deliverAnswers(data: GameData, state: GameState, seat: Seat): TaskAnswer[] {
  return [
    ...deliverOptions(data, state, seat).map(
      (o) =>
        ({
          kind: 'deliver',
          tile: o.tile,
          spend: o.spend,
          // R15: the supply's share rides on the answer. The doc comment on the
          // deleted `head` rider one screen up is about exactly this trap.
          ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
          ...(o.placements === undefined ? {} : { placements: o.placements }),
          ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
        }) as TaskAnswer,
    ),
    ...balloonMoveOptions(data, state, seat).map(
      (o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer,
    ),
  ];
}
