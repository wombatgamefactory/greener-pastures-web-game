/**
 * The meeple-as-card arm (R15). The rules are RETIRED - a table killed the
 * meeples on 09/09/2026 - but the knob survives as a pinned control arm, so the
 * code stays. A branch whose only producer is a knob at its shipped value is
 * not deleted.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { noticeBoardSlots, player } from '../query.js';
import type { GameState, Seat } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import { isMeepleCurrency } from '@gp/data';

// --- meeples as cards (R15, handoff v2) ------------------------------------

/**
 * ⭐ IS R15 LIVE? A meeple may be spent wherever a card of its colour would be
 * spent - a build cost including its own-suit half, a Grow's activation
 * payment, an island crate - and it goes STRAIGHT TO THE BOX rather than to the
 * stack, the barn or the discard.
 *
 * Gated on the meeple currency as well as its own knob, because the `'card'`
 * game has no recirculating supply to spend: under v31 a meeple is a scarce
 * one-shot action bought only off the island, and letting it pay a build there
 * would be a different rule change wearing this one's name.
 */
export function meepleAsCard(data: GameData): boolean {
  return isMeepleCurrency(data) && data.rules.turn.meepleAsCard === true;
}

/**
 * THE SLOT TOLL (R6 as amended). `null` is v1's rule - an occupied slot is
 * BLOCKED and refuses that colour - and a number is v2's: the slot is never
 * refused, it costs that many extra meeples per meeple already in it, and the
 * extra meeples go to the box.
 */
export function slotTollOf(data: GameData): number | null {
  if (!isMeepleCurrency(data)) return null;
  return data.rules.turn.slotToll;
}

/**
 * ONE WAY TO SPEND MEEPLES, as a COUNT PER COLOUR.
 *
 * ⛔ **THIS SHAPE IS THE PERFORMANCE RULE OF THE WHOLE CHANGE, AND IT IS NOT
 * A STYLE PREFERENCE.** The hand limit was cut from 12 to 7 on 03/09/2026
 * precisely because build payments are `C(hand, k)` and explode - a 12-card hand
 * put the balance suite at twelve hours. R15 hands the enumerator up to ten more
 * spendable tokens. If meeples were enumerated as INDIVIDUAL objects the way
 * hand cards are, `subsets()` would be asked for every way of choosing two
 * indistinguishable yellow meeples out of two, and the branching factor of the
 * whole game would go with it.
 *
 * They are not individual objects. Two meeples of a colour differ in nothing a
 * rule or a player can read - same colour, same door, same box - so a payment is
 * decided by HOW MANY of each colour it spends and never by which. That is
 * exactly the argument `stackGroupsOf` makes for a building's stack, applied to
 * a resource that genuinely has no identity at all.
 *
 * What DOES vary and is enumerated in full: which COLOURS go, because a colour
 * given up is a door you cannot buy next turn. That is the decision R15 exists
 * to create and it is not canonicalised away.
 */
export interface MeepleFill {
  counts: Partial<Record<Suit, number>>;
  total: number;
}

export const NO_MEEPLES: MeepleFill[] = [{ counts: {}, total: 0 }];

/**
 * Memoised on the supply vector alone. At `meepleCapPerColour` 2 there are at
 * most 3^5 = 243 distinct supplies and 243 fills, so the cache is bounded by the
 * rules rather than by the run, and every position that shares a supply shares
 * one list.
 */
const FILL_CACHE = new Map<string, MeepleFill[]>();

/**
 * Every subset of a supply, as count vectors, in a FIXED order: suit order
 * outermost, ascending count innermost.
 *
 * ⚠️ THE ORDER IS LOAD-BEARING, for the same reason `subsets()` says its
 * own is. Enumeration order reaches the bots' tie-break and the metric fold's
 * `legal` list, so a reordering here would move balance numbers without changing
 * a rule. The zero vector is always FIRST, which is what makes the R15-off arm
 * bit-identical to v1: with an empty supply the list is exactly `NO_MEEPLES` and
 * every loop below runs once with nothing in it.
 */
export function meepleFills(
  suits: readonly Suit[],
  supply: Readonly<Record<Suit, number>>,
): MeepleFill[] {
  let key = '';
  let held = 0;
  for (const s of suits) {
    const n = supply[s] ?? 0;
    held += n;
    key += `${n},`;
  }
  if (held === 0) return NO_MEEPLES;
  const hit = FILL_CACHE.get(key);
  if (hit) return hit;
  let out: MeepleFill[] = NO_MEEPLES;
  for (const suit of suits) {
    const cap = supply[suit] ?? 0;
    if (cap === 0) continue;
    const next: MeepleFill[] = [];
    for (const fill of out) {
      next.push(fill);
      for (let n = 1; n <= cap; n++) {
        next.push({ counts: { ...fill.counts, [suit]: n }, total: fill.total + n });
      }
    }
    out = next;
  }
  FILL_CACHE.set(key, out);
  return out;
}

/**
 * ⭐ R17: ONE WAY TO PLACE A MEEPLE PAYMENT ON THE TABLE (Dean, 05/09/2026).
 *
 * Under `meepleAsCardGoesTo: 'board'` a meeple spent as a card does not leave
 * the game: it lands on ANOTHER player's Notice Board, in its own colour's
 * slot, exactly as a visit places one, and the host takes it back on their
 * Collect. It buys the payer nothing else - no door action, and it is not a
 * visit - so the bonus slot is untouched.
 *
 * `boards` is indexed by SEAT and holds a colour count per board, which is the
 * same count-vector discipline `MeepleFill` argues for: two meeples of a colour
 * going to the same board differ in nothing anybody can read. What genuinely
 * varies and IS enumerated in full is WHICH board each meeple goes to, because
 * Dean ruled the payer chooses a host per meeple (05/09/2026), so one payment
 * may feed several neighbours.
 *
 * `toll` is the extra meeples burned to place onto an occupied slot, by colour.
 * They go to the BOX and are the only drain left once resource spends stop
 * being boxed.
 */
export interface MeeplePlacement {
  /** Indexed by SEAT. Entry i is the colour count landing on seat i's board. */
  boards: Partial<Record<Suit, number>>[];
  /** How many EXTRA meeples this spread costs, to be burned in any colours. */
  tollOwed: number;
}

/**
 * THE TOLL FOR ONE (host, colour) GROUP, and it is ORDER-INDEPENDENT on
 * purpose.
 *
 * Dean ruled the toll FLAT - "1 extra meeple to place it on top", however deep
 * the stack - so it is charged per MEEPLE placed on top of something, never per
 * occupant. A slot that was already occupied charges for every meeple in the
 * group; a slot that started empty gives the first one away and charges for the
 * rest, because the second meeple of a group lands on the first.
 *
 * ⚠️ READING IT PER GROUP RATHER THAN PER PLACEMENT IS WHAT MAKES IT
 * ORDER-INDEPENDENT, and that matters: a payment is a set of counts with no
 * sequence, so a toll that depended on the order the meeples were laid down
 * would not be a function of the move at all. It is the third small default of
 * this pass and it is flagged in the report.
 */
function groupToll(occupied: boolean, count: number, rate: number): number {
  if (count <= 0) return 0;
  return rate * (occupied ? count : count - 1);
}

/** Ways to split `n` identical things across `k` ordered buckets. */
function compositions(n: number, k: number): number[][] {
  if (k <= 1) return [[n]];
  const out: number[][] = [];
  for (let take = n; take >= 0; take--) {
    for (const tail of compositions(n - take, k - 1)) out.push([take, ...tail]);
  }
  return out;
}

/**
 * Every way to spread a meeple payment across the RIVAL boards, with the toll
 * each spread costs.
 *
 * ⛔ THIS IS THE BRANCHING RISK OF THE WHOLE R17 CHANGE, AND IT IS WHY THE
 * PERFORMANCE GATE IS MEASURED BEFORE THE SUITE RUNS. A host choice per meeple
 * multiplies the build enumerator by roughly hosts^meeples: at four seats a
 * three-meeple payment is up to 18 spreads on top of the colour vector it
 * already carries, and the build list was 4.6x the v1 arm under R15 alone.
 * Nothing is canonicalised away here, because Dean ruled the per-meeple choice
 * in on 05/09/2026; if it ever has to be bounded, this is the one function to
 * bound.
 */
function meepleSpreads(
  data: GameData,
  state: GameState,
  seat: Seat,
  counts: Partial<Record<Suit, number>>,
  rate: number,
): MeeplePlacement[] {
  const hosts: Seat[] = [];
  for (let i = 0; i < state.players.length; i++) if (i !== seat) hosts.push(i as Seat);
  // ⭐ NEVER YOUR OWN BOARD (X5's shape, applied to a payment): "you must
  // place them on other players' Notice Boards". With no rival there is nowhere
  // to put a paid meeple, so R17 simply offers no meeple payment.
  if (hosts.length === 0) return [];
  // Occupancy is read ONCE, at the start of the payment, and every group is
  // priced against that snapshot - see `groupToll`.
  const occupied = hosts.map((host) => {
    const slots = noticeBoardSlots(state, host);
    const by: Partial<Record<Suit, boolean>> = {};
    for (const colour of data.cards.suits) by[colour] = (slots[colour]?.length ?? 0) > 0;
    return by;
  });
  // ⭐ 'perPayment' IS THE BOUNDED ALTERNATIVE, and it is one loop rather than
  // a canonicalisation: the whole payment lands on ONE host, so the decision
  // "who do I feed, and how much" survives intact while the factor collapses
  // from hosts^meeples to hosts.
  if (data.rules.turn.paymentHostChoice === 'perPayment') {
    const whole: MeeplePlacement[] = [];
    for (let h = 0; h < hosts.length; h++) {
      const host = hosts[h] as Seat;
      const boards = state.players.map(() => ({}) as Partial<Record<Suit, number>>);
      let owed = 0;
      for (const colour of data.cards.suits) {
        const n = counts[colour] ?? 0;
        if (n === 0) continue;
        boards[host] = { ...(boards[host] ?? {}), [colour]: n };
        owed += groupToll(occupied[h]?.[colour] === true, n, rate);
      }
      whole.push({ boards, tollOwed: owed });
    }
    return whole;
  }
  let out: MeeplePlacement[] = [
    { boards: state.players.map(() => ({}) as Partial<Record<Suit, number>>), tollOwed: 0 },
  ];
  for (const colour of data.cards.suits) {
    const n = counts[colour] ?? 0;
    if (n === 0) continue;
    const next: MeeplePlacement[] = [];
    for (const base of out) {
      for (const split of compositions(n, hosts.length)) {
        const boards = base.boards.map((b) => ({ ...b }));
        let owed = base.tollOwed;
        for (let h = 0; h < hosts.length; h++) {
          const take = split[h] ?? 0;
          if (take === 0) continue;
          const host = hosts[h] as Seat;
          boards[host] = { ...(boards[host] ?? {}), [colour]: take };
          owed += groupToll(occupied[h]?.[colour] === true, take, rate);
        }
        next.push({ boards, tollOwed: owed });
      }
    }
    out = next;
  }
  return out;
}

/** A spread with its toll resolved into actual colours. */
export interface ResolvedPlacement {
  boards: Partial<Record<Suit, number>>[];
  toll: Partial<Record<Suit, number>>;
}

/**
 * Every legal way to place `counts` on the rival boards AND pay whatever toll
 * that spread owes, out of what is left of the supply.
 *
 * The toll colours are enumerated as a count vector over the REMAINING supply,
 * the same machinery `meepleFills` uses everywhere else: which colour you burn
 * is a real decision, two meeples of a colour are not.
 */
export function placementsFor(
  data: GameData,
  state: GameState,
  seat: Seat,
  counts: Partial<Record<Suit, number>>,
  rate: number,
): ResolvedPlacement[] {
  const supply = player(state, seat).meeples;
  // What is left to pay a toll with, once the payment itself is committed.
  const rest: Record<Suit, number> = { ...supply };
  for (const colour of data.cards.suits) {
    rest[colour] = (supply[colour] ?? 0) - (counts[colour] ?? 0);
  }
  const out: ResolvedPlacement[] = [];
  for (const spread of meepleSpreads(data, state, seat, counts, rate)) {
    if (spread.tollOwed === 0) {
      out.push({ boards: spread.boards, toll: {} });
      continue;
    }
    for (const fill of meepleFills(data.cards.suits, rest)) {
      if (fill.total !== spread.tollOwed) continue;
      out.push({ boards: spread.boards, toll: fill.counts });
    }
  }
  return out;
}

/**
 * R17's re-validation: the placement must spend exactly the meeples the payment
 * named, land only on rivals, and carry exactly the toll its own spread owes.
 *
 * ⚠️ `apply` MUST ACCEPT EXACTLY WHAT `legalMoves` OFFERED, so the toll
 * is RECOMPUTED here from the board rather than trusted from the move. A move
 * that under-declares its toll is a free placement onto an occupied slot, and
 * nothing else in the engine would notice.
 */
export function assertPlacementMatches(
  data: GameData,
  state: GameState,
  seat: Seat,
  meeples: Partial<Record<Suit, number>>,
  choice: {
    placements?: Partial<Record<Suit, number>>[];
    paymentToll?: Partial<Record<Suit, number>>;
  },
): void {
  const placements = choice.placements ?? [];
  const rate = data.rules.turn.paymentSlotToll;
  let owed = 0;
  const spent: Partial<Record<Suit, number>> = {};
  for (let host = 0; host < placements.length; host++) {
    const counts = placements[host];
    if (!counts) continue;
    // Indexed by seat, so the payer's own entry exists and is empty - see the
    // same guard in `Fx.placeMeeplesAsCards`.
    if (meepleCount(counts) === 0) continue;
    if (host === seat) throw new Error('A paid meeple never lands on your own board');
    const slots = noticeBoardSlots(state, host as Seat);
    for (const colour of data.cards.suits) {
      const n = counts[colour] ?? 0;
      if (n === 0) continue;
      spent[colour] = (spent[colour] ?? 0) + n;
      owed += groupToll((slots[colour]?.length ?? 0) > 0, n, rate);
    }
  }
  for (const colour of data.cards.suits) {
    if ((spent[colour] ?? 0) !== (meeples[colour] ?? 0)) {
      throw new Error(`The ${colour} half of that payment was not placed`);
    }
  }
  const toll = choice.paymentToll ?? {};
  if (meepleCount(toll) !== owed) {
    throw new Error(`That placement owes ${owed} toll meeples, got ${meepleCount(toll)}`);
  }
  const supply = player(state, seat).meeples;
  for (const colour of data.cards.suits) {
    const want = (meeples[colour] ?? 0) + (toll[colour] ?? 0);
    if (want > (supply[colour] ?? 0)) {
      throw new Error(`Seat ${seat} has ${supply[colour] ?? 0} ${colour} meeples, not ${want}`);
    }
  }
}

/** The fills this seat could pay a card cost with, or the zero fill when R15 is off. */
export function fillsFor(data: GameData, state: GameState, seat: Seat): MeepleFill[] {
  if (!meepleAsCard(data)) return NO_MEEPLES;
  return meepleFills(data.cards.suits, player(state, seat).meeples);
}

/** Total meeples in a count vector. */
export function meepleCount(counts: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const v of Object.values(counts)) n += v ?? 0;
  return n;
}
