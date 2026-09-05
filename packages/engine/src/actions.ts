/**
 * The five main actions and the bonus slot: option ENUMERATORS and DO-funnels.
 *
 * The enumerators are the single source of legality. legalMoves maps them to
 * Moves, the Build/Deliver Worker tasks map them to task answers, and every
 * funnel re-validates the same predicates before mutating - so apply accepts
 * exactly what legalMoves offers, and a Worker performing an action obeys the
 * same rules as the action itself.
 *
 * ⛔ THE SUIT-POWER SEAMS ARE GONE (v31). The Farmstead powers - Wheat's relaxed
 * harvest, Orchard's draw modifier, Apiary's any-card Grow, Dairy's diversion,
 * Vegetable's deliver head - used to attach to these funnels. All five
 * Farmsteads print one end-game scorer and nothing else now, so the funnels are
 * the plain printed actions and a suit's identity lives entirely in its deck.
 * Nothing here hardcodes a tunable number - every dial reads from GameData.
 */

import type { GameData, Suit } from '@gp/data';
import {
  deliveriesPerTile,
  deliveryVp,
  isMeepleCurrency,
  meepleAsCardGoesToBoard,
  meepleIndexForSpace,
} from '@gp/data';

import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import {
  canTakeCard,
  cardById,
  doorOf,
  faceOf,
  drawableSuits,
  isFull,
  meeplesHeld,
  noticeBoardOf,
  noticeBoardSlots,
  player,
  visitTargetOf,
  workerData,
} from './query.js';
import type {
  AerodromeState,
  BonusOption,
  BuildingState,
  CardId,
  GameState,
  IslandTileState,
  Move,
  Seat,
  TaskAnswer,
} from './state.js';
import { rngInt } from './rng.js';
import { performDoorAction } from './workers.js';

/**
 * All k-card subsets, as a list. `k` is a build cost (at most 5 cards) or a hand
 * overflow; `items` is a hand.
 *
 * ⚠️ **WHAT BOUNDS THIS IS `rules.turn.handLimit`, AND NOTHING ELSE.** The
 * comment here used to say "hands are 6-8" as though that were a property of the
 * game. It was a property of ONE RULE - the hand limit - and when v31 deleted
 * that rule on 02/09/2026 this function silently became unbounded. It is
 * C(hand, k): at a hand of 33 and a cost of 4 that is 40,920 payments FOR ONE
 * BUILDABLE CARD, and the measured worst position offered 116,535 legal moves
 * and took a 2-seat game from about 0.1 seconds to minutes. The limit came back
 * the same day, at a flat 12, expressly to bound this - see
 * `RulesFile.turn.handLimit` for the full measurement.
 *
 * So: at the shipped limit of **7** (03/09/2026, down from 12) the worst payment
 * enumeration is C(6, 4) = 15, and it grows as C(limit - 1, 4) - 330 at 12, 70
 * at 9, 1 at 5. ANY CHANGE THAT LETS A HAND GROW PAST THE LIMIT - a new knob, a
 * card, a relaxation of the turn boundary - is a change to the branching factor
 * of the whole game, and belongs in a paired arm with the legal-move count read
 * off it.
 *
 * ⚠️ **THE WIDEST ENUMERATION IN THE GAME IS NO LONGER THIS ONE.** At a limit of
 * 7 the measured worst position offers 368 legal moves, and the widest single
 * answer list is the end-of-turn `discard` task at 330 - the OTHER C(n, k) in
 * the game, and the one that grows when a card effect stuffs a hand well past
 * the ceiling mid-turn. Whoever comes here next looking for the explosion should
 * look there first.
 */
export function subsets<T>(items: readonly T[], k: number): T[][] {
  // ⭐ REWRITTEN 03/09/2026, SAME OUTPUT, SAME ORDER, a third of the cost. The
  // previous body was the textbook two-line recursion - `[...subsets(rest, k-1)
  // .map(s => [head, ...s]), ...subsets(rest, k)]` - which builds and throws
  // away an intermediate array and a spread PER SUBTREE. A CPU profile of a
  // 2-seat game put 12.5% of the whole run inside this one function, more than
  // any other, and about half of that was allocation the answer never keeps.
  //
  // This walks index combinations in increasing order, which is EXACTLY the
  // order the recursion produced (subsets containing item 0 first, then those
  // without, applied recursively, is lexicographic by index). That equality is
  // load-bearing rather than tidy: enumeration order reaches the bots' tie-break
  // and the metric fold's `legal` list, so a reordering here would move balance
  // numbers without changing a single rule.
  const out: T[][] = [];
  if (k < 0 || k > items.length) return out;
  const pick: T[] = new Array<T>(k) as T[];
  const walk = (start: number, depth: number): void => {
    if (depth === k) {
      out.push(pick.slice());
      return;
    }
    // Stop early where too few items remain to finish the choice.
    const last = items.length - (k - depth);
    for (let i = start; i <= last; i++) {
      pick[depth] = items[i] as T;
      walk(i + 1, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

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

const NO_MEEPLES: MeepleFill[] = [{ counts: {}, total: 0 }];

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
function placementsFor(
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
function assertPlacementMatches(
  data: GameData,
  state: GameState,
  seat: Seat,
  meeples: Partial<Record<Suit, number>>,
  choice: { placements?: Partial<Record<Suit, number>>[]; paymentToll?: Partial<Record<Suit, number>> },
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
function fillsFor(data: GameData, state: GameState, seat: Seat): MeepleFill[] {
  if (!meepleAsCard(data)) return NO_MEEPLES;
  return meepleFills(data.cards.suits, player(state, seat).meeples);
}

/** Total meeples in a count vector. */
export function meepleCount(counts: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const v of Object.values(counts)) n += v ?? 0;
  return n;
}

// --- shared queries --------------------------------------------------------

/**
 * THE HAND LIMIT: cards a seat may still be holding when its turn ENDS, or null
 * for no limit at all.
 *
 * ⭐ **IT IS ONE GLOBAL RULE NOW, NOT A CARD VALUE** (Dean, 02/09/2026). For
 * three editions the Barn printed it per suit (5/5/5/6/6, 7 on a flipped face)
 * and this function read the showing face. v31 deleted the printed number and
 * the whole rule with it; the same day's simulator run reversed that, and the
 * reinstated rule is deliberately a different shape: `rules.turn.handLimit`, one
 * number on the player aid, with the Barn still printing nothing. The function
 * keeps its name and its signature so every seam that used to ask it still asks
 * it, and takes `state` it no longer reads for the same reason - a limit that
 * varies by seat again would change only this body.
 *
 * ## Why it came back - the measurement, because this is the paragraph the next
 * person to think "a hand limit is just a clock, delete it" needs to find
 *
 * The limit was ALSO the only bound on `subsets` above, and nothing in the
 * design knew that. With it gone hands reached 34 cards, one 2-seat position
 * offered 43,879 legal moves (43,845 of them build payments), a re-measurement
 * found a worse one at 116,535, and a 2-seat game went from ~0.1s to 1-15
 * minutes - which reduced the entire watch-list suite to n=8 and made every
 * conclusion from that run an anecdote. Behind the engineering sits the design
 * failure: with no ceiling a card in hand has no diminishing return, so the free
 * bonus Draw 1 became strictly dominant and beat a neighbour visit 3:1. The hook
 * lost to arithmetic. See `RulesFile.turn.handLimit` for the rest.
 */
export function handLimitOf(data: GameData, _state: GameState, _seat: Seat): number | null {
  return data.rules.turn.handLimit;
}

/**
 * A seat's free hand space (reference DL-63): limit minus hand size, floored at
 * 0, and `Infinity` when the limit is off.
 *
 * THE GIFT FAMILY'S CAPACITY RULE, and the reason it is back: a gift never
 * forces an out-of-turn discard, so a neighbour already at their limit cannot be
 * given anything. Without it the Orchard gift cards (O6, O9, O16) stop being
 * gifts and become a way to make a rival discard, which is a different card and
 * a much nastier one. v31 read this as moot rather than repealed and said so at
 * this seam; with the limit back it is live again.
 */
export function freeHandSpace(data: GameData, state: GameState, seat: Seat): number {
  const limit = handLimitOf(data, state, seat);
  if (limit === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - player(state, seat).hand.length);
}

/** The barn as the per-suit tally every rule reads it as - identity is inert there. */
export function barnTally(
  data: GameData,
  state: GameState,
  seat: Seat,
): Partial<Record<Suit, number>> {
  const tally: Partial<Record<Suit, number>> = {};
  for (const id of player(state, seat).barn) {
    const suit = cardById(data, id).suit;
    tally[suit] = (tally[suit] ?? 0) + 1;
  }
  return tally;
}

/**
 * The tile's printed row. LAYOUT ONLY since the flat island (2026-08-09) - it
 * exists for the UI and for setup's bookend rule, and no rule reads it. If a
 * rule ever needs it again, that is the hierarchy coming back and it should be
 * priced as a new rule rather than a restoration.
 */
export function tileLevel(data: GameData, tileId: string): 1 | 2 | 3 {
  const tile = data.island.tiles.find((t) => t.id === tileId);
  if (!tile) throw new Error(`Unknown island tile ${tileId}`);
  return tile.level;
}

// --- Build -----------------------------------------------------------------
//
// It had two branches until v31 and has none now: HIRE went with the Hiring
// Fair (2026-08-10) and the GBP 2 starter UPGRADE went with the upgraded faces.
// Build is the plain action again: pay cards, put a card in your tableau.

/**
 * Modifiers a Build runs under. Absent = the plain printed rules, so every
 * pre-Dairy call site keeps its behaviour. All of them compose.
 *
 * Two mods died with the Dairy rebuild (2026-08-10) and their deletion is a
 * DESIGN deletion rather than a tidy-up, so it is recorded here:
 *
 *  - `fromBarn` (the old D8) let barn cards join a payment. The barn is a dead
 *    end - nothing may move barn to hand or barn to stack - and barn to build
 *    was the same violation wearing a different hat: it is what let the barn
 *    accelerate an engine instead of only buying score.
 *  - `coinWild` (the old D7) let coins stand in for cards. Seats ended games on
 *    about GBP 1, so a coin-priced build option was dead text even before v31
 *    deleted the currency. The reading outlives it: a payment route nobody can
 *    afford is not a choice, it is a paragraph of teach for nothing.
 */
export interface BuildMods {
  /** Card count reduction (the cream balloon, the Builder's Yard, D4/D9/D11/D12). Waives the own-suit half. */
  discount?: number;
  /**
   * ANY CARD PAYS ANY SLOT: the own-suit minimum is waived and a hand card's
   * crop stops mattering. ⚠️ NOTHING IN THE SHIPPED DATA GRANTS IT since the v31
   * doors went plain - the Dairy door did - so it is currently a mod with no
   * producer, kept because it is the one expression of "crop requirements
   * waived" and the next card that prints those words needs it.
   */
  substitute?: boolean;
  /**
   * D7 The Versatile Shed: cards on ONE of the seat's own buildings may join the
   * payment. The one-building cap is the card's printed text since the Dairy
   * rebalance (2026-08-12) and is enforced in two places, `buildOptions` when
   * the options are generated and `doBuild` when one is played.
   */
  fromStacks?: boolean;
}

/**
 * A concrete, fully-chosen build. `payment` is hand cards; `stacks` is cards
 * lifted off the seat's own buildings (D7 only).
 *
 * The two are kept apart rather than pooled because two rules read the
 * difference: the Dairy Farmstead diverts cards spent FROM HAND and never a
 * stack card (or D2 + D7 is a free Harvest - stack to build cost to barn with
 * no Harvest action spent), and `doBuild` has to take them out of different
 * zones. `stacks` names cards by id, unlike the old barn payment's per-suit
 * tally, because a stack is public and ordered where a barn is anonymous.
 */
export interface BuildOption {
  card: CardId;
  payment: CardId[];
  stacks?: CardId[];
  /**
   * R15: meeples spent as cards of their colours, as a COUNT PER COLOUR. Kept
   * apart from `payment` because they are not card ids and have no identity -
   * see `MeepleFill`. Absent when none were spent, so an R15-off option is
   * byte-identical to a v1 one.
   */
  meeples?: Partial<Record<Suit, number>>;
  /**
   * How many of those meeples are spent TWO-AS-ONE to fill the built card's
   * own-suit half (R10). Always the minimum the cost needs: a pair buys one
   * own-suit resource for two meeples where a single own-colour meeple buys it
   * for one, so an unneeded pair is a strictly dominated payment and is never
   * offered.
   */
  wildPairs?: number;
  /**
   * ⭐ R17: where those meeples LAND, indexed by seat. Absent under
   * `meepleAsCardGoesTo: 'box'`, which is the handoff v2 arm and the default.
   * Summed over seats it equals `meeples` colour for colour.
   */
  placements?: Partial<Record<Suit, number>>[];
  /** R17: extra meeples burned to place onto occupied slots. Boxed, by colour. */
  paymentToll?: Partial<Record<Suit, number>>;
}

/**
 * THE DAIRY FARMSTEAD, rebuilt 2026-08-10: "When you Build, put 1 card you
 * spend from your hand into your barn instead of discarding it", and on the
 * upgraded face, up to 2.
 *
 * ⚠️ THE UPGRADED FACE WAS "EVERY CARD" UNTIL THE DAIRY REBALANCE (2026-08-12),
 * and this was the single largest lever in that pass. "Every card" meant a Build
 * cost NOTHING IN CARDS - the whole payment came back - and turned the spend
 * into island fuel at the same time, so the hand clock, which is the game's
 * master brake, simply did not apply to a Dairy seat. "Up to 2" reuses the
 * Vegetable Farmstead's existing upgrade grammar, so it costs no teach. The BASE
 * face is unchanged at 1.
 *
 * It replaces both of the old faces - permanent crop substitution from turn 1,
 * and a second Build ACTION every turn for £2 - and it is the suit's whole
 * compensation. Dairy measured 10.2 cards into its barn against Orchard's 25.7
 * because its cards left the pipeline into the tableau and never came back;
 * this is the line that puts them back. Substitution survives only as a mod the
 * Builder's Yard grants to whoever visits it, so a Dairy seat now matches crops
 * like everybody else - which is exactly what makes its own Service worth
 * buying.
 *
 * Returns the Farmstead's card id (the `src` the divert task is resolved by)
 * and how many spent cards it may take, or null for a seat without the power.
 */
/**
 * ⛔ `buildDivertPower` IS GONE (v31), and with it the last of the Dairy
 * Farmstead. It read "When you Build, put 1 card you spend from your hand into
 * your barn instead of discarding it" (2 on the flipped face) and returned the
 * Farmstead's id plus that limit.
 *
 * The ruling it encoded is worth keeping even though the card is not, because
 * anything that reaches into a build payment will meet it again: ONE DESTINATION
 * PER SPENT CARD, enforced by ORDERING rather than by three assertions. The
 * diversion was taken out BEFORE the discard, never reclaimed from the pile
 * afterwards, so that D5 (sow the cards this build spent) and D6 (give one away)
 * - which both reach into the discard on `afterBuild` - could never race it for
 * the same card. `divertOrDiscard` below is where that order lives, and it is
 * where O17's v31 text wants to hook.
 */

/** How many cards a build actually costs under its modifiers. Coins are gone (v31). */
function priceOf(
  data: GameData,
  card: CardId,
  mods: BuildMods,
): { cardsNeeded: number; ownSuitMin: number } | null {
  const cost = cardById(data, card).buildCost;
  if (!cost) return null;
  const discount = mods.discount ?? 0;
  const totalCards = cost.suit + cost.wild;
  const cardsNeeded = Math.max(0, totalCards - discount);
  // A discount waives the own-suit half (reference buildDiscount), and so does
  // the Builder's Yard's granted substitution.
  const ownSuitMin = discount > 0 || mods.substitute === true ? 0 : cost.suit;
  return { cardsNeeded, ownSuitMin };
}

/**
 * ONE building's stack as INTERCHANGEABILITY GROUPS, split by crop.
 *
 * Two wheat cards on the same stack differ in nothing a rule or a player can
 * read - same crop, same building freed, same discard - so a payment is decided
 * by HOW MANY come out of each group, never by which. Grouping and then filling
 * canonically (the first n of a group) is what keeps the option set finite: a
 * plain subset enumeration over stack ids would offer C(3,2) ways to take two
 * wheat off one building and call them three different builds.
 *
 * What genuinely varies survives intact: WHICH building loses cards (D7 is the
 * suit's only Tier 1 un-clog) and WHAT CROP they are (the own-suit minimum).
 * The first of those is now expressed by the CALLER rather than by pooling -
 * see `buildOptions`.
 */
function stackGroupsOf(data: GameData, building: BuildingState): CardId[][] {
  const byCrop = new Map<Suit, CardId[]>();
  for (const id of building.stack) {
    const suit = cardById(data, id).suit;
    byCrop.set(suit, [...(byCrop.get(suit) ?? []), id]);
  }
  return [...byCrop.values()];
}

/**
 * D7's payment sources, ONE PER BUILDING plus a hand-only option.
 *
 * ⚠️ THE ONE-BUILDING CAP IS THE WHOLE POINT (Dairy rebalance, 2026-08-12).
 * The Versatile Shed used to read "spend cards from your buildings", and every
 * building's stack was flattened into a single pool that `stackFills` combined
 * across freely - so a single payment could strip three buildings at once, which
 * is what opened the entire tableau as a second card pool and dissolved the hand
 * clock. It now reads "from ONE of your buildings", so the option set is
 * generated once per building and unioned rather than once across a flat pool.
 *
 * The leading `[]` is the hand-only payment and MUST SURVIVE: paying with no
 * stack card at all is legal and is often the right move. The option count goes
 * DOWN, not up - per-building is a strict subset of the old cross-building set -
 * so nothing about enumeration grows; the union just reaches a hand-only payment
 * once per building, which is why `buildOptions` dedupes.
 */
function stackSourcesFor(data: GameData, state: GameState, seat: Seat): CardId[][][] {
  return [[], ...player(state, seat).tableau.map((b) => stackGroupsOf(data, b))];
}

/** Which of the seat's buildings these stack cards sit on - D7's one-building check. */
function stackHomes(state: GameState, seat: Seat, stacks: readonly CardId[]): Set<CardId> {
  const homes = new Set<CardId>();
  for (const b of player(state, seat).tableau) {
    if (stacks.some((id) => b.stack.includes(id))) homes.add(b.card);
  }
  return homes;
}

/** Canonical selections of k cards across the groups - the first n of each. */
function stackFills(groups: readonly CardId[][], k: number): CardId[][] {
  if (k === 0) return [[]];
  if (groups.length === 0) return [];
  const [head, ...rest] = groups as [CardId[], ...CardId[][]];
  const out: CardId[][] = [];
  for (let n = Math.min(k, head.length); n >= 0; n--) {
    for (const tail of stackFills(rest, k - n)) out.push([...head.slice(0, n), ...tail]);
  }
  return out;
}

/**
 * Ways to pay for ONE named card under `mods`, out of `hand` and `groups`. The
 * inner half of `buildOptions`, split out because D10 The Scout's Post has to
 * price a card that is NOT in the hand - a revealed deck top - and must reach
 * exactly the same arithmetic rather than a second copy of it.
 *
 * ⚠️ D7's RATE (19/08/2026): a card off a building is worth
 * `STACK_WILD_VALUE` of the cost, where it used to be worth one. That is the
 * whole of the change - *"Build. You may spend cards from one of your buildings
 * as 2 wild resources"* - and the own-suit minimum still counts across BOTH
 * sources: a stack card of the built card's crop pays its crop requirement,
 * because the rule is about what the payment is made of and not where it came
 * from.
 *
 * ⭐ RULED 19/08/2026 BY DEAN, and the ruling is WIDER than what was first
 * built: *"the card counts as ANY card - including wild."* A card spent off a
 * building is a true WILDCARD. Its `STACK_WILD_VALUE` resources fill the
 * OWN-CROP half of a cost exactly as readily as the wild half, and the card's
 * printed suit does not matter. Hand cards are unchanged - they still have to
 * actually BE the crop.
 *
 * The reading this REPLACES (built 19/08, live for a few hours) counted a stack
 * card toward the own-crop minimum only if it happened to be that crop. The
 * reading it had already killed was the strict one - "wild" setting the KIND so
 * that a stack card fills ONLY the wild half - which is dead on the sheet's own
 * numbers: NO CARD IN THE GAME HAS A WILD HALF ABOVE 1 (55 print 0, 35 print
 * exactly 1, none print 2), so at 2 per stack card a wild-only stack card could
 * never be spent on anything and D7 would grant nothing.
 *
 * ⚠️ WHAT THE WIDER RULING CHANGES, and it is not small. Under the narrow
 * reading NO card in the game could be built entirely off stacks - a 2+0 cost
 * demands two of your crop and one stack card only counted once, a 3+1 cost
 * demands three and two stack cards only counted twice. Under the ruling both
 * are payable off the stack alone: 2+0 takes one stack card, 3+1 takes two. D7
 * becomes a way to build out of your buildings with NO hand card at all, on a
 * suit that already builds three times as much as any other. It is the single
 * biggest power increase in the v30 pass and it lands on the suit that the
 * 19/08 watchlist measured at a 66.4% win rate.
 */
const STACK_WILD_VALUE = 2;

function paymentsFor(
  data: GameData,
  card: CardId,
  hand: readonly CardId[],
  groups: readonly CardId[][],
  price: { cardsNeeded: number; ownSuitMin: number },
  fills: readonly MeepleFill[] = NO_MEEPLES,
  supply: Readonly<Record<Suit, number>> | null = null,
  place: ((counts: Partial<Record<Suit, number>>) => ResolvedPlacement[]) | null = null,
): BuildOption[] {
  const suit = cardById(data, card).suit;
  const out: BuildOption[] = [];
  // Each stack card pays for two, so the ceiling is the cost over the rate.
  // Anything above that overpays, and an overpayment is never offered: a card
  // thrown away for nothing is not a choice, it is a mistake the enumerator
  // would be inviting. An odd cost therefore always leaves one card of it for
  // the hand, which is the shape at 3-cost cards - the commonest in the game.
  const maxStacks = groups.length === 0 ? 0 : Math.floor(price.cardsNeeded / STACK_WILD_VALUE);
  for (let n = 0; n <= maxStacks; n++) {
    for (const stacks of stackFills(groups, n)) {
      const fromStacks = STACK_WILD_VALUE * n;
      // ⭐ R15's LOOP, AND WHEN R15 IS OFF IT COSTS ONE ITERATION OF ONE
      // ELEMENT. `fills` is `NO_MEEPLES` under v1 and under the `'card'` game,
      // so `fill.total` is 0, `pairs` is 0, `k` is the count this line always
      // asked for and the emitted ORDER is unchanged. That is what keeps the
      // control arm bit-reproducible rather than merely equivalent.
      for (const fill of fills) {
        const ownMeeples = fill.counts[suit] ?? 0;
        // A pair is two meeples spent as one card of ANY colour (R10), and it is
        // only ever worth forming out of colours that are NOT the built suit: an
        // own-colour meeple pays an own-suit slot singly, so pairing it would
        // buy the same resource at twice the price.
        const maxPairs = (fill.total - ownMeeples) >> 1;
        for (let pairs = 0; pairs <= maxPairs; pairs++) {
          // Every meeple spent pays one resource, except the paired ones, which
          // pay one between two.
          const k = price.cardsNeeded - fromStacks - (fill.total - pairs);
          if (k < 0 || k > hand.length) continue;
          for (const payment of subsets(hand, k)) {
            // RULED 19/08/2026 (Dean): "the card counts as ANY card - including
            // wild". So a stack card is a true wildcard - its STACK_WILD_VALUE
            // resources fill OWN-CROP slots exactly as readily as wild ones, and
            // its printed suit is irrelevant. Hand cards still have to actually
            // BE the crop; only the stack is wild. ⭐ AND SO DOES A MEEPLE
            // (R15): a yellow meeple is a WHEAT card and pays a Wheat
            // requirement, not an any-colour one. The wild half of the rule is
            // the PAIR, and it is counted separately below.
            // Counted rather than filtered: this runs once per enumerated
            // payment, and `filter().length` allocated an array per option for a
            // number.
            let own = fromStacks + ownMeeples + pairs;
            for (const c of payment) if (cardById(data, c).suit === suit) own += 1;
            if (own < price.ownSuitMin) continue;
            // ⭐ A PAIR IS OFFERED ONLY WHERE THE COST NEEDS IT. Drop one and
            // the own count falls by one while the payment gets one hand card
            // CHEAPER - so a pair that was not required is a strictly dominated
            // way to pay, and offering it would multiply the build list for a
            // choice no player would make. Given `own >= ownSuitMin`, minimality
            // is exactly `own === ownSuitMin`.
            if (pairs > 0 && own > price.ownSuitMin) continue;
            // ⭐ AND A PAIR IS THE LAST RESORT, on the same sentence
            // `enumerateMeepleVisits` and `growOptions` use: SPEND THE EXACT
            // COLOUR FIRST, pair only when you have run out of it. Without this
            // line a seat holding a yellow meeple is offered every way of
            // paying a Wheat slot with two OTHER meeples beside the obvious
            // one, which multiplies the build list by the supply for a payment
            // that costs two tokens to do one token's job. It is a real choice
            // in the abstract - you may want to keep the yellow for a door -
            // but it is not a choice worth the branching factor, and it is
            // recorded as a deliberate reduction rather than an oversight.
            if (pairs > 0 && supply !== null && ownMeeples < (supply[suit] ?? 0)) continue;
            const base: BuildOption =
              stacks.length > 0 ? { card, payment, stacks } : { card, payment };
            if (fill.total === 0) {
              out.push(base);
              continue;
            }
            base.meeples = fill.counts;
            if (pairs > 0) base.wildPairs = pairs;
            if (place === null) {
              out.push(base);
              continue;
            }
            // ⭐ R17 EXPANDS ONE PAYMENT INTO ONE OPTION PER SPREAD. The
            // meeples are the same; where they land is not, and Dean ruled the
            // host is chosen per meeple. A spread that cannot pay its own toll
            // out of what is left of the supply is simply not returned, which
            // is how "you may not place on top without the extra meeple"
            // becomes a legality rather than a check.
            for (const spot of place(fill.counts)) {
              out.push({ ...base, placements: spot.boards, paymentToll: spot.toll });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Every legal (card, payment) pair. A cost is n cards of the BUILT card's suit
 * plus m of any suit - the coin third of it went with the currency (v31), and
 * the 30 Power and Endgame cards that printed two coin icons now print two crop
 * icons of their own suit. The built card never pays for itself; own-suit cards
 * may fill the wild half. `hand` overrides the seat's hand for the post-fee
 * re-check a visit's door action needs.
 *
 * Under `mods` the price and the own-suit minimum move (see priceOf) and cards
 * on ONE of the seat's own buildings may join the payment (D7). The enumeration
 * stays exhaustive and concrete: one option per fully-decided way to pay, so
 * apply can re-validate exactly what was offered.
 */
export function buildOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  hand?: CardId[],
  mods: BuildMods = {},
): BuildOption[] {
  const p = player(state, seat);
  const cards = hand ?? p.hand;
  // D7 pays off ONE building. Enumerate per building and union, rather than
  // flattening the tableau into a single pool: a payment may mix hand cards with
  // cards from at most one stack.
  const sources = mods.fromStacks === true ? stackSourcesFor(data, state, seat) : [[]];
  // R15: the seat's meeple supply, as count vectors. `NO_MEEPLES` when the rule
  // is off, which is one element and no behaviour change.
  const fills = fillsFor(data, state, seat);
  // R17's placer, memoised on the payment vector: the same colour counts recur
  // across every buildable card in a position, and the spread does not depend
  // on which card is being bought.
  const rate = data.rules.turn.paymentSlotToll;
  const spreadCache = new Map<string, ResolvedPlacement[]>();
  const place = meepleAsCardGoesToBoard(data)
    ? (counts: Partial<Record<Suit, number>>): ResolvedPlacement[] => {
        const key = data.cards.suits.map((x) => counts[x] ?? 0).join(',');
        let hit = spreadCache.get(key);
        if (hit === undefined) {
          hit = placementsFor(data, state, seat, counts, rate);
          spreadCache.set(key, hit);
        }
        return hit;
      }
    : null;
  const out: BuildOption[] = [];
  // ⭐ THE DEDUPE IS SKIPPED WHEN THERE IS NOTHING TO DEDUPE (03/09/2026). It
  // exists because a hand-only payment is reachable once per BUILDING, so the
  // per-building union repeats it - which can only happen with more than one
  // source. Without D7 there is exactly one source, `[[]]`, and every option is
  // already unique, so the key-building was a sorted copy and a joined string
  // per enumerated payment for a Set that never fired. That was measurable: at
  // a hand of 12 it is a few hundred throwaway strings per buildable card, per
  // decision. Identical output either way; this only stops paying for the check
  // in the position where it cannot be needed.
  const seen = sources.length > 1 ? new Set<string>() : null;
  for (const id of cards) {
    const price = priceOf(data, id, mods);
    if (!price) continue;
    // Hoisted: the hand-minus-this-card list was rebuilt once per SOURCE.
    const rest = cards.filter((h) => h !== id);
    for (const groups of sources) {
      for (const option of paymentsFor(data, id, rest, groups, price, fills, p.meeples, place)) {
        if (seen !== null) {
          // Sorted because two sources can reach the same multiset by different
          // orders.
          const key = [
            option.card,
            [...option.payment].sort().join(','),
            [...(option.stacks ?? [])].sort().join(','),
            // R15: two payments that spend the same cards but different meeples
            // are different payments, so the meeple vector is part of the key.
            data.cards.suits.map((x) => option.meeples?.[x] ?? 0).join(''),
            option.wildPairs ?? 0,
            // R17: two payments that spend the same meeples on different boards
            // are different moves.
            (option.placements ?? [])
              .map((b) => data.cards.suits.map((x) => b[x] ?? 0).join(''))
              .join('/'),
            data.cards.suits.map((x) => option.paymentToll?.[x] ?? 0).join(''),
          ].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
        }
        out.push(option);
      }
    }
  }
  return out;
}

/**
 * Ways this seat could pay for a card that is NOT in their hand - D10's
 * revealed deck top, which is in limbo and never touches the hand. Returns []
 * when the card has no build cost.
 */
export function paymentOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  card: CardId,
  mods: BuildMods = {},
): { payment: CardId[]; meeples?: Partial<Record<Suit, number>>; wildPairs?: number }[] {
  const price = priceOf(data, card, mods);
  if (!price) return [];
  // R15 reaches D10 too, because D10 is a BUILD and R15 says build costs. It
  // is the cheapest case in the game - the discount waives the own-suit half -
  // so in practice a meeple only ever pays the wild half here.
  const p = player(state, seat);
  return paymentsFor(data, card, p.hand, [], price, fillsFor(data, state, seat), p.meeples).map(
    (o) => ({
      payment: o.payment,
      ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
      ...(o.wildPairs === undefined ? {} : { wildPairs: o.wildPairs }),
    }),
  );
}

/**
 * Early-exit form of buildOptions, for legality checks. `mods` is what the
 * BUILD itself carries - the Builder's Yard waives crop requirements AND takes
 * a card off the price for whoever buys it, and both halves have to be visible
 * here or the Service is offered when it is affordable and refused when it is
 * not.
 */
export function anyBuildOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  hand?: CardId[],
  mods: BuildMods = {},
): boolean {
  const p = player(state, seat);
  const cards = hand ?? p.hand;
  const asCard = meepleAsCard(data);
  return cards.some((id) => {
    const price = priceOf(data, id, mods);
    if (!price) return false;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    const own = others.filter((c) => cardById(data, c).suit === suit).length;
    if (others.length >= price.cardsNeeded && own >= price.ownSuitMin) return true;
    if (!asCard) return false;
    return payableWithMeeples(data, p.meeples, suit, price, others.length, own);
  });
}

/**
 * The fast path's R15 half: could this seat pay `price` if meeples joined in?
 *
 * ⚠️ IT MUST AGREE WITH `paymentsFor` EXACTLY, in both directions, and
 * that is not a style rule - `workerActionLegal`'s build branch calls this, and
 * a gate that says yes where the enumerator offers nothing hands a visitor a
 * door with no legal move behind it (the 19/08/2026 harvest bug, in a new
 * costume). So it is written as the same arithmetic reduced to its greedy
 * optimum rather than as a second, looser test.
 *
 * The greedy is exact because every route to one own-suit resource costs the
 * same except a pair, which costs two: fill the own-suit minimum from hand
 * cards first, then from own-colour meeples, and only then from pairs, and what
 * is left over is the widest possible wild pool.
 */
function payableWithMeeples(
  data: GameData,
  supply: Readonly<Record<Suit, number>>,
  suit: Suit,
  price: { cardsNeeded: number; ownSuitMin: number },
  handCount: number,
  ownHand: number,
): boolean {
  const ownMeeples = supply[suit] ?? 0;
  let otherMeeples = 0;
  for (const s of data.cards.suits) if (s !== suit) otherMeeples += supply[s] ?? 0;
  const fromHand = Math.min(ownHand, price.ownSuitMin);
  const fromOwn = Math.min(ownMeeples, price.ownSuitMin - fromHand);
  const pairs = price.ownSuitMin - fromHand - fromOwn;
  if (2 * pairs > otherMeeples) return false;
  const spentOnOwn = fromHand + fromOwn + pairs;
  if (spentOnOwn > price.cardsNeeded) return false;
  const wildAvailable =
    handCount - fromHand + (ownMeeples - fromOwn) + (otherMeeples - 2 * pairs);
  return wildAvailable >= price.cardsNeeded - spentOnOwn;
}

/**
 * Spend for a build and land it. `src` is the card whose ability caused this
 * build (null for the plain action), threaded through to the afterBuild hook so
 * a card can react to ITS OWN build (D5, D6) rather than to every build.
 */
export function doBuild(
  fx: Fx,
  seat: Seat,
  choice: BuildOption,
  mods: BuildMods = {},
  src: CardId | null = null,
): void {
  const { card, payment } = choice;
  const stacks = choice.stacks ?? [];
  const p = player(fx.state, seat);
  const c = cardById(fx.data, card);
  const price = priceOf(fx.data, card, mods);
  if (!price) throw new Error(`${card} has no build cost`);
  if (!p.hand.includes(card)) throw new Error(`${card} is not in seat ${seat}'s hand`);
  const spent = [...payment, ...stacks];
  if (spent.includes(card)) throw new Error(`${card} cannot pay for itself`);
  if (new Set(spent).size !== spent.length) throw new Error('Duplicate payment card');
  if (stacks.length > 0 && mods.fromStacks !== true) {
    throw new Error('This Build may not spend cards off your buildings');
  }
  // "from ONE of your buildings" - re-validated here and not only in the
  // enumerator, because apply must accept exactly what buildOptions offers.
  if (stacks.length > 0 && stackHomes(fx.state, seat, stacks).size > 1) {
    throw new Error('This Build may spend cards off only one of your buildings');
  }
  // R15: meeples in the payment, re-validated against the supply and against
  // the same arithmetic the enumerator used. `apply` must accept exactly what
  // `legalMoves` offered and nothing wider.
  const meeples = choice.meeples ?? {};
  const meepleTotal = meepleCount(meeples);
  const wildPairs = choice.wildPairs ?? 0;
  if (meepleTotal > 0 && !meepleAsCard(fx.data)) {
    throw new Error('A meeple pays for a build only under rules.turn.meepleAsCard');
  }
  for (const colour of fx.data.cards.suits) {
    const want = meeples[colour] ?? 0;
    if (want > 0 && p.meeples[colour] < want) {
      throw new Error(`Seat ${seat} has ${p.meeples[colour]} ${colour} meeples, not ${want}`);
    }
  }
  const ownMeeples = meeples[c.suit] ?? 0;
  // A pair is formed out of colours that are NOT the built suit (see
  // `paymentsFor`), so the meeples available to pair are the non-own ones.
  if (2 * wildPairs > meepleTotal - ownMeeples) {
    throw new Error(`${card} cannot form ${wildPairs} wild pairs from that payment`);
  }
  // D7's rate: a card off a building is worth STACK_WILD_VALUE of the cost.
  // A meeple is worth one, except a pair, which is worth one between two.
  const paid = payment.length + STACK_WILD_VALUE * stacks.length + (meepleTotal - wildPairs);
  if (paid !== price.cardsNeeded) {
    throw new Error(`${card} costs ${price.cardsNeeded} cards, got ${paid}`);
  }
  // ...and the own-crop minimum counts a stack card as WILD, at the same rate
  // it pays the total (ruled 19/08/2026 - see STACK_WILD_VALUE). A meeple of the
  // built card's own colour counts as an own card, and a pair counts as one
  // card of any colour and so fills an own slot too (R10, R15). Mirrors
  // `paymentsFor` exactly; apply must accept what the enumerator offers.
  const own =
    payment.filter((id) => cardById(fx.data, id).suit === c.suit).length +
    STACK_WILD_VALUE * stacks.length +
    ownMeeples +
    wildPairs;
  if (own < price.ownSuitMin) {
    throw new Error(`${card} needs ${price.ownSuitMin} ${c.suit} cards in payment`);
  }

  fx.removeFromHand(seat, card);
  for (const id of payment) fx.removeFromHand(seat, id);
  // ⭐ THE MEEPLES GO TO THE BOX AND NOWHERE ELSE (R15). They are taken out
  // BEFORE `divertOrDiscard`, so nothing downstream can mistake one for a spent
  // card: D5, D6, D11 and O17 all reach for the cards this build spent, and a
  // meeple was never in the discard for them to find.
  if (meepleTotal > 0) {
    // R17: the same payment, landing on the table instead of leaving it. The
    // enumerator decided where; this only re-checks that it decided legally.
    const placements = choice.placements;
    if (placements === undefined) {
      fx.payMeeplesAsCards(seat, meeples, 'build', { wildPairs });
    } else {
      if (!meepleAsCardGoesToBoard(fx.data)) {
        throw new Error('A paid meeple lands on a board only under meepleAsCardGoesTo "board"');
      }
      assertPlacementMatches(fx.data, fx.state, seat, meeples, choice);
      fx.placeMeeplesAsCards(seat, placements, choice.paymentToll ?? {}, 'build', { wildPairs });
    }
  }
  // SPENT, not harvested (D7's ruling): the cards come straight off the stack,
  // no afterHarvest fires, and they are not divertible.
  for (const id of stacks) fx.spendFromStack(seat, id);
  divertOrDiscard(fx, seat, payment);
  fx.discard(stacks);
  placeBuilt(fx, seat, card, spent, src);
}

/**
 * THE DIVERT SEAM FOR A BUILD PAYMENT: the one place a build's spent cards go,
 * and it sits BEFORE the discard rather than reclaiming from it afterwards.
 *
 * That placement is the whole design. D5 The Churning Shed sows the cards this
 * build spent and D6 The Trading Shed gives one away, and both reach into the
 * discard for them on `afterBuild`; anything that also reclaimed from the pile
 * would be a third consumer racing over one pile, which is how a card ends up in
 * two places. Taking a diversion out FIRST means the pile only ever holds what
 * nobody else claimed, so ONE DESTINATION PER SPENT CARD falls out of the
 * ordering instead of being asserted three times. Anything queued here must be
 * PREPENDED, so it resolves before whatever was already waiting (the second half
 * of D12's two builds, say) and `placeBuilt`'s reactors append behind it.
 *
 * ⚠️ IT CURRENTLY JUST DISCARDS, AND THAT IS A HOLE THE CARD PASS HAS TO FILL.
 * Its only diverter was the Dairy Farmstead, which is gone (v31). O17 The Fruit
 * Basket's v31 text - *"Instead of discarding a card you spend, you may put it
 * into your barn"* - is exactly this moment, moved off the draw discard where
 * the card used to live. The seam is kept, named and exported for that handler
 * to wire; deleting it and inlining `fx.discard` at the call site would lose the
 * ordering rule above, which is not re-derivable from the code that replaced it.
 */
export function divertOrDiscard(fx: Fx, _seat: Seat, payment: readonly CardId[]): void {
  if (payment.length === 0) return;
  fx.discard([...payment]);
}

/**
 * The build's landing half, shared with cost-waiving effects (W10's free
 * FIELD build, D10/D13's deck-top builds): the card enters the tableau and the
 * afterBuild reactors fire.
 *
 * It used to also check the Farmstead's free flip at the 3-own-crop-building
 * milestone. That rule went on 2026-08-12 (the Farmstead was bought for GBP 2
 * like its siblings), and v31 deleted the flip itself, so a build has not moved
 * a starter's face for two editions and never will again.
 */
export function placeBuilt(
  fx: Fx,
  seat: Seat,
  card: CardId,
  payment: CardId[],
  src: CardId | null = null,
): void {
  player(fx.state, seat).tableau.push({ card, stack: [] });
  fx.emit({ e: 'built', seat, card, payment });
  // `turn.buildSources` used to be recorded here, for D16 The Ledger's
  // once-per-build-SOURCE guard; the Dairy rebalance (2026-08-12) moved the
  // Ledger onto the general `turn.firedThisTurn` rule and the field lost its
  // only reader, so it is gone. `src` still travels to the hook, which is what
  // D5 and D6 read to react to their OWN build.
  fireHook(fx, 'afterBuild', { seat, card, payment, src });
}

/**
 * ⛔ `ownServiceCost` IS GONE (v31). It priced the bonus slot's other half -
 * activate your OWN Service, paid to the bank - and the rule it enforced was
 * that you never earn from your own farm, so running your own door had to cost
 * something. In v31 the owner places a card on their own board exactly as a
 * rival does, and the price is that card plus a step toward their own threshold
 * of 2. That is a sharper brake than a coin ever was, because it shuts the door
 * on everybody rather than emptying one wallet.
 *
 * ⛔ `apiaryGrowBonus` IS GONE (v31), and the convention it demonstrated is
 * worth keeping even though the card is not. It was the Apiary Farmstead's "When
 * you GROW, Draw 1", and it lived on the GROW ACTION branch in `game.ts` rather
 * than inside `doGrow` - because `doGrow` is also called by O13 The Grand
 * Orchard and by A6, so a seam inside it fires once per BUILDING grown and The
 * Honey Hut would have drawn three. The standing rule (how-to-design-a-suit §8)
 * is that a suit power modifies the ACTION, never card text that happens to use
 * the same word.
 *
 * ⛔ `upgradeOptions`, `upgradeTargets` and `doUpgrade` ARE GONE (v31). They
 * flipped a starter for GBP 2, and the flip was a bonus-slot option from
 * 19/08/2026 - a change that attacked a measured playtest failure (2026-07-14:
 * "nobody upgraded a starter and nobody bought an end-game card", every GBP 2
 * sink untouched, because an upgrade costing a whole main action was never going
 * to be taken in a game whose clock is cards). v31 deletes all fifteen upgraded
 * faces, so there is nothing to flip.
 *
 * ⚠️ ONE BUG FIX DIED WITH THEM AND ITS SHAPE RECURS, so it is recorded here.
 * `upgradeTargets` was split out of `upgradeOptions` because `apply` spends the
 * main action BEFORE it calls the doer, so under the control arm where the flip
 * was a main action again, `doUpgrade` re-validated through a gate
 * (`!turn.actionSpent`) that `apply` had just falsified - `legalMoves` offered
 * every upgrade and `apply` refused every one, and five of six seeds crashed.
 * THE RULE: a re-validation must check what the move NEEDS, never the window the
 * caller has already consumed. `doVisit`, `doBonusDraw` and `doSpendMeeple` all
 * obey it below.
 *
 * ⛔ `buyOptions`, `hasBuyOption` and `doBuy` ARE GONE (v31). The card BUY paid
 * the bank for the blind top card of a deck that was NOT your own suit, once a
 * turn, as a free action. Dean's own-suit exclusion (2026-08-03) was what kept
 * the two supply lines distinct - money bought VARIETY, your own crop came from
 * your own deck - and it is why the buy could not quietly become a second Draw.
 * With no coins there is nothing to pay with, and `rules.turn.bonusDraw` is what
 * a seat reaches for instead.
 */

// --- Draw ------------------------------------------------------------------

/**
 * The plain Draw ACTION: `rules.turn.baseDraw`, which is see 2 KEEP 2 since v31.
 *
 * ⭐ THE DRAW KEEPS BOTH CARDS AND DISCARDS NOTHING. It was see 2 keep 1 from
 * v13 until v31, and the change is not generosity: the discard was the last
 * piece of hidden bookkeeping in the core five actions and it bought nothing
 * measurable. The task machinery is unchanged - it is still the see-N/keep-K
 * task - so a `see > keep` card ability still opens a real choice; it is only
 * the printed action that no longer has one.
 *
 * ⚠️ WATCH THE INTERACTION WITH `bonusDraw`. The plain action and the free bonus
 * option are now the same verb at two sizes, so a seat that takes Draw as its
 * action and Draw 1 as its bonus nets three cards a turn with no interaction at
 * all. That is the shape action inflation shows up in first.
 *
 * No draw modifier is consulted: the Orchard Farmstead's `withDrawModifier` went
 * with the suit powers (v31), so the printed numbers are the numbers.
 */
export function doDraw(fx: Fx, seat: Seat): void {
  const { see, keep } = fx.data.rules.turn.baseDraw;
  fx.pushTask({ t: 'draw', pid: seat, src: null, see, keep, revealed: [] });
}

// --- Grow ------------------------------------------------------------------

export interface GrowOption {
  building: CardId;
  /** Null when a meeple paid (R15): nothing is placed, so nothing is named. */
  payment: CardId | null;
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
  const out: GrowOption[] = [];
  const asCard = meepleAsCard(data);
  for (const b of p.tableau) {
    if (cardById(data, b.card).slot === 'noticeboard') continue;
    if (state.turn.firedThisTurn.includes(b.card)) continue;
    if (mods.exclude?.includes(b.card)) continue;
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
      for (const card of p.hand) {
        if (mods.anyCrop === true || type === 'wild' || cardById(data, card).suit === type) {
          out.push({ building: b.card, payment: card });
        }
      }
    }
    if (!asCard) continue;
    const atThreshold = !open;
    const anyColour = mods.anyCrop === true || type === 'wild';
    if (anyColour) {
      // Any meeple pays a wild activation, so a pair never helps and is never
      // offered: two meeples for what one buys is a dominated payment.
      for (const colour of data.cards.suits) {
        if ((p.meeples[colour] ?? 0) < 1) continue;
        out.push({ building: b.card, payment: null, meeples: [colour], atThreshold });
      }
      continue;
    }
    // `type` is a Suit here: `anyColour` above already took the 'wild' case.
    const colour = type as Suit;
    if ((p.meeples[colour] ?? 0) > 0) {
      out.push({ building: b.card, payment: null, meeples: [colour], atThreshold });
      continue;
    }
    // ⭐ THE PAIR IS THE LAST RESORT AND ONLY THE LAST RESORT, on exactly the
    // rule `enumerateMeepleVisits` uses: a colour you hold you would always
    // spend singly, so a pair is enumerated only for a colour you do not hold.
    // Without that guard the option list carries every pair beside every single
    // for every building on the table.
    for (const pair of meeplePairs(data, p.meeples)) {
      out.push({ building: b.card, payment: null, meeples: pair, atThreshold });
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

// --- Harvest ---------------------------------------------------------------

/**
 * ⛔ THE WHEAT RELAXED-HARVEST GATE LEFT THIS FILE ON 19/08/2026 AND LEFT THE
 * GAME IN v31. It is worth two paragraphs because it moved twice.
 *
 * `WHEAT_RELAXED_MIN` and `wheatRelaxedMin` stood here and made "harvest a
 * building with 2+ cards even if it is not full" a property of the WHEAT SEAT.
 * On 19/08/2026 Dean confirmed the sheet had deliberately swapped W2 and W3's
 * powers and the engine had them the wrong way round, so the relaxation became
 * the Wheat DOOR's action - belonging to whoever WORKED that door rather than to
 * whoever owned it, which was the first time the suit's signature verb had been
 * rentable. In v31 the doors are PLAIN: every enhancement the doors carried is
 * gone, because a door now buys a whole core action for one card and stacking a
 * rider on top of it was pricing a sweetener into a deal that no longer needed
 * one.
 *
 * So a Wheat seat's Harvest is the strict printed rule like everybody else's,
 * and the only relaxations left in the game are the ones a CARD prints for
 * itself (W11, W12) plus the magenta balloon's "harvest any building, even if it
 * is not full".
 */

/**
 * The Harvest ACTION's targets: FULL buildings, and since v31 that is the whole
 * of the printed rule for every seat by every route.
 *
 * `relaxedMin` unions in any building at or above that many cards even when it
 * is not full, and the two gates genuinely cross - a threshold-1 building is
 * strict-harvestable at 1 card but never relaxed-harvestable at a floor of 2.
 *
 * ⚠️ NOTHING PASSES A FLOOR ANY MORE. The Wheat door did until v31 (via the
 * `chooseBuilding` task's `relaxedMin` rider, which the 'harvestable' filter
 * still routes through). The parameter stays because the balloon's `harvestAny`
 * and the printed exceptions need the same union, and because a gate and the
 * action it gates must be handed the SAME modifiers - a mismatch here refused a
 * perfectly legal harvest for a few hours on 19/08/2026 and was not local, it
 * reached five call sites.
 */
export function harvestOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  /**
   * Buildings holding at least this many cards are harvestable even when NOT
   * full. `Infinity` (the default) is the plain printed rule: full only.
   */
  relaxedMin: number = Infinity,
): CardId[] {
  return player(state, seat)
    .tableau.filter((b) => isFull(data, b) || b.stack.length >= relaxedMin)
    .map((b) => b.card);
}

/**
 * ⛔ `harvestAgainPower` AND THE WHOLE ActionAgain MACHINERY ARE GONE (v31).
 *
 * It was the upgraded Wheat Farmstead's "Harvest is 2 buildings": one optional
 * repeat of the Harvest ACTION, armed after the main action only and never after
 * a door's, held open by `turn.again`. The Wheat rebalance took the repeat off
 * the card on 2026-08-12 because Wheat came in first at 50.0% against an even
 * share of 36.4% and a free extra action on the suit's own core verb was the
 * largest single term in it; the Dairy "you may BUILD again" had already gone on
 * 2026-08-10 for the same reason at twice the price.
 *
 * It was left standing as a dead stub on the explicit grounds that ripping it
 * out changed the `GameState` shape and moved the serialisation and view tests,
 * which was noise inside a balance arm. v31 changes that shape anyway and the
 * arm is long since measured, so this is that separate commit: `turn.again`, the
 * repeat branch in `apply`, the hold in `settleTurn` and the `endTurn` decline
 * all go with it. Nothing in the catalogue has produced it for three weeks.
 *
 * ⚠️ IT IS NOT KNOB-CONTROLLED, which is the difference between this deletion
 * and the one `settleTurn` refuses to make. A branch whose only producer is a
 * card that no longer exists is dead; a branch whose only producer is a knob at
 * its shipped value is a control arm, and deleting it silently deletes the
 * measurement.
 */

export function doHarvestAction(fx: Fx, seat: Seat, building: CardId): void {
  if (!harvestOptions(fx.data, fx.state, seat).includes(building)) {
    throw new Error(`${building} is not harvestable by seat ${seat}`);
  }
  fx.harvest(seat, building);
}

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
function wildFills(suits: readonly Suit[], k: number): Suit[][] {
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
function namedDemand(
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

function tallyTotal(m: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const v of Object.values(m)) n += v ?? 0;
  return n;
}

/** Cards of `spend` that count against `need` directly, i.e. not as filler. */
function matchedAgainst(
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
function substitutedSpends(
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
function spendKey(tile: string, spend: Partial<Record<Suit, number>>): string {
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

export function deliverOptions(data: GameData, state: GameState, seat: Seat): DeliverOption[] {
  const barn = deliverTally(data, state, seat);
  const asCard = meepleAsCard(data);
  const demands = deliverDemands(data, state, seat);
  const out: DeliverOption[] = [];
  const seen = new Set<string>();
  for (const demand of demands) {
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
        continue;
      }
      const meeples = meepleShare(data, state, seat, spend);
      if (meeples === null) continue;
      out.push(
        meepleCount(meeples) === 0
          ? { tile: demand.tile, spend }
          : { tile: demand.tile, spend, meeples },
      );
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
  return state.island.tiles.some((tile) => payableBy(data, state, tile, barn));
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
  if (meepleTotal > 0) fx.payMeeplesAsCards(seat, meeples, 'delivery');
  const cards = fx.spendFromBarn(seat, fromBarn);
  // Read each VP and each MEEPLE off the space BEFORE the delivery joins the
  // tile, or the first deliverer would be paid the second deliverer's rate and
  // handed the second deliverer's meeple. The tile's own fill order is the whole
  // gradient: 6 for being first here, 3 for being second - so V14's "both
  // receipts" is 6 + 3 = 9 plus BOTH meeples, with no scoring rule of its own.
  //
  // ⭐ THE MEEPLE REPLACED THE COIN (v31). Every delivery used to also mint a
  // flat GBP 1 (`island.tileRule.coinsPerDelivery`, pinned at 0 as a tombstone
  // now). Both spaces on every tile carry one, and both are claimed - the 3 VP
  // space is not a consolation, it is 3 VP AND a free action.
  //
  // One `delivered` event per receipt, so nothing counting deliveries has to
  // learn that one of them can be double; only the first carries the spend,
  // because only one payment was made.
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
        }) as TaskAnswer,
    ),
    ...balloonMoveOptions(data, state, seat).map(
      (o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer,
    ),
  ];
}

// --- The five doors: shared action legality --------------------------------

/**
 * Can this DOOR's action do anything for this seat right now? Reuses the same
 * enumerators the action funnels enforce, so a door is never offered and then
 * wedged. `excludingHandCard` re-checks as if a card - the visit fee - had
 * already left the hand.
 *
 * ⚠️ THE GATE AND THE ACTION MUST BE HANDED THE SAME MODIFIERS. This is one
 * function gating three call sites (`visitOptions`, `doVisit`, `meepleOptions`)
 * and one mismatch is never local: for a few hours on 19/08/2026 the harvest
 * branch asked the strict full gate while the door it gated ran a relaxed one,
 * so a visitor whose only target was a 2-of-3 building was told the door had
 * nothing legal to do. In v31 the doors are PLAIN, which removes every modifier
 * that could disagree - but the rule survives the reason for it.
 *
 * ⭐ RULED (v31): A DOOR THAT CAN DO NOTHING IS NOT OFFERED. `workers.json`
 * flags this as an open question - "whether a door should ever refuse a visitor
 * who cannot use it" - and the engine rules it refuses. The visit costs a card
 * and returns an action, so a visit whose action is a no-op is a strictly
 * dominated move: no player would take it, and offering it would bloat every
 * bot's move list with choices it has to price and reject. It became a live case
 * in v31 rather than a rare one, because the plain doors no longer carry riders
 * that mostly applied. ⚠️ It has a cost worth knowing: a seat can be locked out
 * of the bonus slot's interaction half entirely (every board clogged, or every
 * door dead for them), which is what `bonusDraw` exists to backstop.
 */
export function workerActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  workerId: string,
  opts?: { excludingHandCard?: CardId },
): boolean {
  const door = workerData(data, workerId);
  const hand = opts?.excludingHandCard
    ? withoutFirst(player(state, seat).hand, opts.excludingHandCard)
    : player(state, seat).hand;
  switch (door.action) {
    case 'draw':
      return drawableSuits(data, state).length > 0;
    case 'harvest':
      return harvestOptions(data, state, seat).length > 0;
    case 'sow':
      // The Apiary door sows FROM THE HAND (v31), so it needs a card as well as
      // a target - which is exactly why it is the weakest door on the table:
      // two cards out, one threshold step in. `from: 'deck'` is the ruled fix if
      // the board takes no traffic, and this branch already handles it.
      return door.sow?.from === 'deck'
        ? drawableSuits(data, state).length > 0 &&
            player(state, seat).tableau.some((b) => canTakeCard(data, b))
        : hand.length > 0 && player(state, seat).tableau.some((b) => canTakeCard(data, b));
    case 'build':
      return anyBuildOption(data, state, seat, hand);
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
      return anyDeliverOption(data, state, seat) || anyBalloonMoveOption(data, state, seat);
    default:
      return door.action satisfies never;
  }
}

function withoutFirst(items: readonly CardId[], drop: CardId): CardId[] {
  const i = items.indexOf(drop);
  return i < 0 ? [...items] : [...items.slice(0, i), ...items.slice(i + 1)];
}

// --- The bonus slot --------------------------------------------------------

/**
 * EXTRA BONUS OPTIONS granted by card text, on top of
 * `rules.turn.bonusSlotsPerTurn`.
 *
 * Wired at import time by the handler registry, exactly as `wireHookBus` wires
 * the hook bus in fx.ts, and for the same reason: A Helping Hand's v31 text is
 * *"Each turn, you may take both bonus options: Draw 1 AND place a card on a
 * Notice Board"*, so the number of slots is a property of a BUILT CARD - but
 * actions.ts may not import the handler registry (the Helping Hand imports
 * actions.ts for `workerActionLegal`, and a value cycle between the two would be
 * fragile). An indirection, not laziness.
 *
 * Unwired it contributes nothing, so the printed rule stands on its own and
 * every test that never touches a Helping Hand behaves identically.
 */
type ExtraBonusLookup = (data: GameData, state: GameState, seat: Seat) => number;
let extraBonusLookup: ExtraBonusLookup | null = null;

export function wireExtraBonusSlots(lookup: ExtraBonusLookup): void {
  extraBonusLookup = lookup;
}

/** How many bonus options this seat may take this turn: the printed one, plus card text. */
export function bonusSlotsFor(data: GameData, state: GameState, seat: Seat): number {
  return data.rules.turn.bonusSlotsPerTurn + (extraBonusLookup?.(data, state, seat) ?? 0);
}

/**
 * THE BONUS WINDOW, three-state since 03/09/2026 (`rules.turn.bonusTiming`).
 *
 * ⭐ Dean, 03/09/2026, correcting the engine and both design docs: **the turn
 * is meeples, then your CORE ACTION, then the bonus.** `'end'` is the rule and
 * the shipped default; `!actionSpent` had been the predicate since 19/08/2026
 * and was measuring a game nobody was playing.
 *
 *   `'end'`    open once the action is spent. `pass` is in `MAIN_ACTIONS`, so a
 *              seat with no legal action still opens its window and cannot be
 *              stranded without a bonus.
 *   `'start'`  the old rule, open only while `!actionSpent`. The paired control.
 *   `'any'`    v14's "once per turn, at any point". Always open.
 *
 * With `option` given it also answers "is THIS half still available?", which is
 * what stops a seat holding a Helping Hand from taking Draw 1 twice: the card
 * grants both options, not two of either.
 *
 * ⭐ WHAT THE CORRECTION CHANGES, and it is not a power level. Under `'start'`
 * a door could FUEL the action after it (visit the Orchard door for Draw 3, then
 * Build with those cards) and nothing could inform the door. Under `'end'` the
 * action SETS THE DOOR UP: fill a building with a Grow, then Harvest it through
 * the Wheat door; harvest into your barn, then Deliver through the Vegetable
 * one. The doors whose worth is conditional on how the turn went are the ones
 * that gain, and Wheat and Vegetable are exactly the two the v10 door mix found
 * underused against Orchard's unconditional Draw 3.
 *
 * ⚠️ SLOT UNSPENT still reads this knob, and its absolute is still a rational
 * floor rather than a prediction: a bot never forgets a window and a human does.
 * Only the delta between the arms means anything.
 */
export function bonusOpen(data: GameData, state: GameState, option?: BonusOption): boolean {
  const turn = state.turn;
  if (turn.bonusUsed.length >= bonusSlotsFor(data, state, state.turnPlayer)) return false;
  if (option !== undefined && turn.bonusUsed.includes(option)) return false;
  // A knob and not a constant because this rule ships with others that all move
  // the visit rate, and the diagnosis needs them separable.
  switch (data.rules.turn.bonusTiming) {
    case 'any':
      return true;
    case 'start':
      return !turn.actionSpent;
    case 'end':
      return turn.actionSpent;
  }
}

/**
 * THE MEEPLE PHASE: the very start of your turn, before the bonus option and
 * before the core action.
 *
 * Both clauses are the rule and neither is redundant. `!actionSpent` is the
 * obvious half; `bonusUsed.length === 0` is the half that stops a meeple being
 * held back and spent after the bonus, which is what would turn the supply into
 * a hand of free reactive actions rather than a decision taken up front.
 *
 * ⚠️ THE SHIPPED `bonusTiming: 'end'` MAKES THIS CLAUSE REDUNDANT AND IT STAYS
 * ANYWAY. With the bonus after the action, `bonusUsed` is empty for as long as
 * `!actionSpent` is true, so the second clause can never be the binding one.
 * Under `'any'` it binds again - a seat that takes its bonus late would
 * otherwise keep the meeple phase open behind it - and under `'start'` it is the
 * original rule. Deleting a clause because the shipped knob value makes it
 * unreachable is the exact mistake `turnflow.ts` documents at its own
 * `bonusOpen` line, so it is not deleted here either.
 */
export function meepleOpen(state: GameState): boolean {
  return !state.turn.actionSpent && state.turn.bonusUsed.length === 0;
}

/**
 * The colours this seat may spend right now: held, and with something legal for
 * that colour's action to do.
 *
 * ⭐ A MEEPLE THAT CAN DO NOTHING IS NOT OFFERED, on the same ruling as a dead
 * door (see `workerActionLegal`), and it bites harder here: spending a meeple is
 * FREE, so a meeple spent for nothing is a pure loss of a stored action. The
 * consequence is deliberate and is one of the numbers the v31 plan wants
 * measured - a seat can be left holding meeples it can never legally spend, and
 * `meepleGained` minus `meepleSpent` is exactly that dead-component count.
 */
export function meepleOptions(data: GameData, state: GameState, seat: Seat): Suit[] {
  // ⛔ THE TURN-START MEEPLE SPEND IS DELETED BY THE MEEPLE-LOOP ARM (R8), and
  // this empty list is the whole of the deletion. The bonus visit becomes the
  // only way a meeple is ever spent, and a spent meeple moves to a neighbour's
  // board rather than leaving the game.
  //
  // ⚠️ IT ALSO CLOSES THE TURNFLOW GATE. `settleTurn` holds a turn open while
  // this is non-empty (turnflow.ts, the line after the bonus check); returning
  // [] here is what stops the arm's turns hanging on a phase that no longer
  // exists, so the two must never be reasoned about separately.
  if (isMeepleCurrency(data)) return [];
  if (!meepleOpen(state)) return [];
  const held = player(state, seat).meeples;
  return data.cards.suits.filter(
    (colour) =>
      (held[colour] ?? 0) > 0 && workerActionLegal(data, state, seat, doorOf(data, colour).id),
  );
}

/**
 * Spend one meeple: perform its colour's plain door action, free, and REMOVE IT
 * FROM THE GAME.
 *
 * It returns to no pool, which is the whole economy: the island is the only
 * source, 25 exist in the bag and 24 at most reach the table, so every meeple
 * spent is one fewer action left in the game for anybody. Nothing here spends
 * the bonus slot or the action - a meeple is neither - and `meepleOpen` is what
 * keeps it at the start of the turn.
 *
 * The action is taken as the SPENDER's, on the standing ruling that suit powers
 * apply to actions performed through a door or by a meeple: it is your action,
 * whatever wooden thing paid for it. A meeple of a suit nobody is farming works
 * exactly the same, which is why the colour is looked up in `workers.roster` and
 * never in `state.fair`.
 */
export function doSpendMeeple(fx: Fx, seat: Seat, colour: Suit): void {
  if (isMeepleCurrency(fx.data)) {
    throw new Error('The turn-start meeple spend is deleted under the meeple visit currency');
  }
  if (!meepleOpen(fx.state)) {
    throw new Error('Meeples are spent at the start of your turn, before your bonus and action');
  }
  if (!meepleOptions(fx.data, fx.state, seat).includes(colour)) {
    throw new Error(`Seat ${seat} has no ${colour} meeple that can do anything`);
  }
  const door = doorOf(fx.data, colour);
  fx.spendMeeple(seat, colour);
  fx.emit({ e: 'meepleSpent', seat, colour, action: door.action });
  performDoorAction(fx, seat, colour, 'meeple');
}

/**
 * The bonus slot's SOLITAIRE half: Draw `rules.turn.bonusDraw` off the top of
 * any one deck in play.
 *
 * Offered as a single move with no deck named, because the deck pick is the draw
 * task's own answer - the same see/keep machinery as the plain Draw, so
 * `afterDrawKeep` fires and any future draw reactor sees it. That is deliberate:
 * this is a real Draw, unlike the `buy` and `market` it replaced, both of which
 * were carefully NOT draws so that no draw modifier could reach them.
 */
export function bonusDrawOpen(data: GameData, state: GameState): boolean {
  // ⛔ CLOSED UNDER THE MEEPLE-LOOP ARM (R9): there is no standalone free Draw
  // 1, and the only card the bonus slot can draw is the one attached to Collect.
  // The NUMBER survives - `doCollect` draws `rules.turn.bonusDraw` - so the knob
  // still prices the solitaire line, which is now "collect an empty board".
  if (isMeepleCurrency(data)) return false;
  if (!bonusOpen(data, state, 'draw')) return false;
  if (data.rules.turn.bonusDraw <= 0) return false;
  return drawableSuits(data, state).length > 0;
}

export function doBonusDraw(fx: Fx, seat: Seat): void {
  if (!bonusDrawOpen(fx.data, fx.state)) {
    throw new Error('The bonus slot is shut, or no deck has a card left');
  }
  const n = fx.data.rules.turn.bonusDraw;
  fx.state.turn.bonusUsed.push('draw');
  fx.pushTask({ t: 'draw', pid: seat, src: null, see: n, keep: n, revealed: [] });
}

export type VisitOption = Extract<Move, { type: 'visit' }>;

/**
 * Every visit on offer: one card from hand onto ANY unclogged Notice Board,
 * your own included.
 *
 * ⭐ THE SELF-VISIT IS RISK 2 OF THE WHOLE PASS, and `rules.turn.selfVisitAllowed`
 * is its paired control. It replaces the old "activate your own Service for a
 * coin", and the difference is that the card now LANDS on the board: your own
 * traffic clogs your own door at threshold 2 exactly as a rival's does, so
 * feeding your board shuts it in two turns and locks every neighbour out of your
 * suit's action until you spend a Harvest clearing it. That structural brake is
 * the ONLY thing holding the solitaire option back, because both halves of the
 * slot now cost the same currency - one card - where every previous version had
 * the solitaire half bought with coins.
 *
 * A dead door is not offered (see `workerActionLegal`), so a visit always buys
 * something.
 */
export function visitOptions(data: GameData, state: GameState, seat: Seat): VisitOption[] {
  const out: VisitOption[] = [];
  enumerateVisits(data, state, seat, out);
  return out;
}

/**
 * IS ANY VISIT ON OFFER? Exactly `visitOptions(...).length > 0`, and it is the
 * same function saying so - `enumerateVisits` walks one list and stops at the
 * first hit when nobody wants the moves themselves.
 *
 * It exists because two callers only ever asked the QUESTION. `hasBonusOption`
 * (which `settleTurn` calls after every apply, the bots' speculative probe
 * applies included) and the sim's denial probe both built the whole list to read
 * `.length`, which under the meeple currency is up to (rival hosts x 5 colours x
 * 10 wild pairs) move objects thrown away unread. A shared enumerator rather
 * than a second predicate, deliberately: a predicate COPIED out of an enumerator
 * silently stops agreeing with it, which is a mistake the sim's own bonus-window
 * probe already made once.
 */
export function anyVisitOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateVisits(data, state, seat, null);
}

/**
 * The one walk behind both. `out === null` means "stop at the first legal
 * visit"; anything else collects every one of them, in enumeration order.
 */
function enumerateVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  if (!bonusOpen(data, state, 'visit')) return false;
  if (isMeepleCurrency(data)) return enumerateMeepleVisits(data, state, seat, out);
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat && !data.rules.turn.selfVisitAllowed) continue;
    if (isFull(data, noticeBoardOf(data, state, host))) continue;
    const doorId = doorOf(data, player(state, host).suit).id;
    // ONLY TWO OF THE FIVE DOORS READ THE HAND, so only two of them can give a
    // different answer for a different fee. Sow needs a card to sow and Build
    // needs cards to pay with; Draw, Harvest and Deliver ask about the decks,
    // the tableau and the barn and never look at the hand at all - see
    // `workerActionLegal`, where `hand` is touched in exactly those two
    // branches. Asking once for those three is the same answer as asking it once
    // per card in hand, minus a `withoutFirst` copy each time.
    const action = workerData(data, doorId).action;
    if (action !== 'sow' && action !== 'build') {
      if (!workerActionLegal(data, state, seat, doorId)) continue;
      if (out === null) return true;
      for (const fee of hand) out.push({ type: 'visit', seat, host, fee });
      any = true;
      continue;
    }
    for (const fee of hand) {
      if (!workerActionLegal(data, state, seat, doorId, { excludingHandCard: fee })) continue;
      if (out === null) return true;
      out.push({ type: 'visit', seat, host, fee });
      any = true;
    }
  }
  return any;
}

/**
 * EVERY MEEPLE VISIT ON OFFER, under the meeple-loop arm (R1, R7, R10, X5).
 *
 * One move per (rival host, colour) where the colour is one this seat HOLDS, the
 * host's slot of that colour is free, and the colour's door has something legal
 * for this seat to do. Plus the WILD SPEND: for a colour this seat does not
 * hold, one move per unordered PAIR of held colours, on the same two gates. Both
 * meeples of a pair land in the bought colour's slot.
 *
 * ⭐ NEVER YOUR OWN BOARD (X5), under any flag. `rules.turn.selfVisitAllowed` is
 * not consulted here and must not be: the arm's whole reason for existing is
 * that the solitaire option and the interaction option stopped competing in one
 * slot, and the solitaire option is now Collect. A self-visit would put them
 * back in the same slot at a lower price than the card fee ever charged.
 *
 * ⭐ THE DOOR IS THE SLOT'S COLOUR, NOT THE HOST'S SUIT. Every board has all
 * five slots, so what a visit buys is decided by the meeple you spend and not by
 * what your neighbour farms - which is the availability half of the fix. On more
 * than half of v31's turns no rival door offered an action the visitor could
 * use; here a host offers five, minus the ones already blocked.
 *
 * A DEAD DOOR IS STILL NOT OFFERED (`workerActionLegal`, Dean's standing ruling,
 * unchanged by the currency): a visit that buys a no-op is a dominated move, and
 * under the arm it would also strand a meeple on a rival's board for nothing.
 * `excludingHandCard` is gone with the fee - no card leaves the hand (R1).
 */
function enumerateMeepleVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  const held = meeplesHeld(data, state, seat);
  if (held.length === 0) return false;
  const supply = player(state, seat).meeples;
  // ⭐ R6 AS AMENDED (handoff v2): `toll` null is v1's rule - an occupied slot
  // is BLOCKED and refuses that colour - and a number is v2's: the slot is never
  // refused, it costs that many extra meeples per meeple already sitting in it,
  // and the extras go to the BOX rather than into the slot. Dean's reason for it
  // is a sink ("might be a good way of sinking surplus meeples"), and the design
  // reason is the Feld line the handoff quotes: state may price an option but
  // never remove it.
  const toll = slotTollOf(data);
  // WHETHER A COLOUR'S DOOR HAS ANYTHING FOR THIS SEAT DOES NOT DEPEND ON THE
  // HOST. The gate reads (data, state, seat, colour) and nothing else, so asking
  // it inside the host loop put the same question to `anyBuildOption` and
  // `anyDeliverOption` once per rival - three times over at four seats.
  // Memoised per colour and computed lazily, so a colour whose slot is blocked
  // at every host is still never asked about.
  const doorLegal = new Map<Suit, boolean>();
  const legalDoor = (colour: Suit): boolean => {
    let hit = doorLegal.get(colour);
    if (hit === undefined) {
      hit = workerActionLegal(data, state, seat, doorOf(data, colour).id);
      doorLegal.set(colour, hit);
    }
    return hit;
  };
  // The wild pair, and ONLY for a colour this seat does not hold: a colour you
  // hold you would always spend singly, so enumerating a pair for it would be a
  // strictly worse move wearing the same result. The pairs vary with neither the
  // host nor the colour bought, so they are built once.
  const pairs: [Suit, Suit][] = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const a = held[i];
      const b = held[j];
      if (a === undefined || b === undefined) continue;
      pairs.push([a, b]);
    }
  }
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat) continue;
    const slots = noticeBoardSlots(state, host);
    for (const colour of data.cards.suits) {
      const occupants = slots[colour]?.length ?? 0;
      // Under v1 an occupied slot is simply not a target. Under v2 it is a
      // target with a price, and `tollsFor` returns the ways to pay it.
      if (occupants > 0 && toll === null) continue;
      if (!legalDoor(colour)) continue;
      const owed = toll === null ? 0 : toll * occupants;
      if (held.includes(colour)) {
        if (owed === 0) {
          if (out === null) return true;
          out.push({ type: 'visit', seat, host, fee: null, meeples: [colour], colour });
          any = true;
          continue;
        }
        const after = { ...supply, [colour]: (supply[colour] ?? 0) - 1 };
        const ways = tollFills(data, after, owed);
        if (ways.length === 0) continue;
        if (out === null) return true;
        for (const paid of ways) {
          out.push({ type: 'visit', seat, host, fee: null, meeples: [colour], colour, toll: paid });
        }
        any = true;
        continue;
      }
      if (pairs.length === 0) continue;
      for (const pair of pairs) {
        if (owed === 0) {
          if (out === null) return true;
          out.push({ type: 'visit', seat, host, fee: null, meeples: [pair[0], pair[1]], colour });
          any = true;
          continue;
        }
        const after = { ...supply };
        after[pair[0]] = (after[pair[0]] ?? 0) - 1;
        after[pair[1]] = (after[pair[1]] ?? 0) - 1;
        const ways = tollFills(data, after, owed);
        if (ways.length === 0) continue;
        if (out === null) return true;
        for (const paid of ways) {
          out.push({
            type: 'visit',
            seat,
            host,
            fee: null,
            meeples: [pair[0], pair[1]],
            colour,
            toll: paid,
          });
        }
        any = true;
      }
    }
  }
  return any;
}

/**
 * The ways to pay a toll of `owed` meeples out of what is left of a supply,
 * as SORTED COLOUR LISTS in a fixed order.
 *
 * ⚠️ THIS IS THE ONE PLACE THE v2 CHANGE CAN BLOW UP THE MOVE LIST, and
 * it is bounded on purpose. A toll is a burn, so which colours go is a real
 * decision and is enumerated in full - but only as a MULTISET over colours,
 * never as a choice among identical tokens, exactly as `meepleFills` argues. At
 * `slotToll` 1 and one occupant it is at most five options; the arithmetic is
 * the same count-vector walk, reused, and the list is rebuilt as colours rather
 * than counts because the move carries the toll as a list.
 */
function tollFills(
  data: GameData,
  supply: Readonly<Record<Suit, number>>,
  owed: number,
): Suit[][] {
  if (owed <= 0) return [[]];
  const out: Suit[][] = [];
  for (const fill of meepleFills(data.cards.suits, supply)) {
    if (fill.total !== owed) continue;
    const paid: Suit[] = [];
    for (const colour of data.cards.suits) {
      for (let i = 0; i < (fill.counts[colour] ?? 0); i++) paid.push(colour);
    }
    out.push(paid);
  }
  return out;
}

export type CollectOption = Extract<Move, { type: 'collect' }>;

/**
 * COLLECT: the meeple-loop arm's other bonus option (R7) - take every meeple off
 * your OWN Notice Board into your supply, then Draw 1.
 *
 * ⭐ IT IS THE HALF OF THE DESIGN THAT PAYS THE HOST. Being visited was worth
 * nothing in v31 beyond a card you would eventually harvest; here it hands you
 * back stored actions, so a busy door is an asset rather than a clog.
 *
 * ⭐ COLLECTING AN EMPTY BOARD IS LEGAL and reads as a plain Draw 1 (R7,
 * explicitly). It is the solitaire line, and it is deliberately not priced out:
 * the bonus slot must never be dead. The bonus mix has to count it apart from a
 * collect that actually took meeples back, because it is what the free Draw 1
 * became - see the `boardCollected` event, whose `kept` list is that
 * distinction.
 *
 * ⛔ NO "DRAW 1 PER MEEPLE COLLECTED" (X6). Flat Draw 1, at
 * `rules.turn.bonusDraw`, however many came back.
 */
export function collectOpen(data: GameData, state: GameState, seat: Seat): boolean {
  if (!isMeepleCurrency(data)) return false;
  if (!bonusOpen(data, state, 'collect')) return false;
  const slots = noticeBoardSlots(state, seat);
  const holdsMeeple = data.cards.suits.some((colour) => (slots[colour]?.length ?? 0) > 0);
  // An empty board with every deck dry is the one case where Collect does
  // nothing at all, and a move that does nothing is not offered.
  return holdsMeeple || drawableSuits(data, state).length > 0;
}

export function collectOptions(data: GameData, state: GameState, seat: Seat): CollectOption[] {
  return collectOpen(data, state, seat) ? [{ type: 'collect', seat }] : [];
}

/**
 * Take the meeples back, then draw. The order is the printed order and it is
 * observable: a `boardCollected` event before the draw task means a UI can
 * animate the meeples home while the deck choice is still open.
 */
export function doCollect(fx: Fx, seat: Seat): void {
  if (!collectOpen(fx.data, fx.state, seat)) {
    throw new Error('Collect is shut: outside the bonus window, or nothing to take and no deck');
  }
  fx.collectBoard(seat);
  fx.state.turn.bonusUsed.push('collect');
  const n = fx.data.rules.turn.bonusDraw;
  if (n > 0) {
    fx.pushTask({ t: 'draw', pid: seat, src: null, see: n, keep: n, revealed: [] });
  }
}

/**
 * Is ANY bonus-slot option legal right now? Two of them since v31, and the
 * shrinking is the point: the slot held five options on 19/08/2026 (two visit
 * modes, your own Service, the market and the GBP 2 upgrade), four of which were
 * bought with coins. Deleting the currency deleted the competitors.
 *
 * Read by `settleTurn` and by the UI's bonus phase.
 */
export function hasBonusOption(data: GameData, state: GameState, seat: Seat): boolean {
  // Two options under either currency, and never four: `bonusDrawOpen` is false
  // under the meeple arm and `collectOpen` is false under the card game, so the
  // pair on offer is (Draw 1 | visit) or (Collect | visit).
  return (
    bonusDrawOpen(data, state) ||
    collectOpen(data, state, seat) ||
    anyVisitOption(data, state, seat)
  );
}

/**
 * THE VISIT: one card from your hand onto a Notice Board, then that board's suit
 * action, taken by YOU.
 *
 * The order is load-bearing and unchanged from v14: the fee LANDS first, then
 * `afterVisit` fires host-side, then the action runs. A host-side reactor
 * therefore sees the card on the board, and a door that clogged on this very
 * card is still the door that was bought.
 *
 * ⛔ NOTHING IS MINTED. In v14 this function paid the visitor for a coin visit
 * and the host a wage for a Service visit, and the whole design rested on
 * interaction MINTING money from the bank rather than moving it between players.
 * v31 keeps the shape and deletes the payment: what the visitor gets is the
 * ACTION, and what the host gets is a card on their board that they will harvest
 * into their own barn. "Your junk is their treasure" survives the currency.
 */
/**
 * What a visit is paid with. The `'card'` game fills `fee`; the meeple-loop arm
 * fills `meeples` and `colour` and leaves `fee` null. One shape rather than two
 * functions, because everything AFTER the payment - the host-side hook, the
 * `visited` event, the door action - is identical and must stay identical.
 */
export type VisitSpend = Pick<VisitOption, 'fee' | 'meeples' | 'colour' | 'toll'>;

export function doVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  if (isMeepleCurrency(fx.data)) {
    doMeepleVisit(fx, visitor, host, spend);
    return;
  }
  const state = fx.state;
  const fee = spend.fee;
  if (fee === null) throw new Error('A visit costs one card from your hand');
  if (visitor === host && !fx.data.rules.turn.selfVisitAllowed) {
    throw new Error('Self-visiting is switched off');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const target = visitTargetOf(fx.data, state, host);
  if (isFull(fx.data, target)) throw new Error(`${target.card} is full`);
  const colour = player(state, host).suit;
  const door = doorOf(fx.data, colour);
  if (!workerActionLegal(fx.data, state, visitor, door.id, { excludingHandCard: fee })) {
    throw new Error(`The ${colour} door has nothing legal to do for seat ${visitor}`);
  }

  fx.placeOnBuilding(visitor, { seat: host, card: target.card }, fee);
  state.turn.bonusUsed.push('visit');
  // Host-side reactors fire once per visit, after the fee lands and before the
  // payoff (the reference fires it here too).
  fireHook(fx, 'afterVisit', { visitor, host, self: visitor === host });
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: visitor === host,
    colour,
    action: door.action,
  });
  performDoorAction(fx, visitor, colour, 'visit');
}

/**
 * THE MEEPLE VISIT (R1, R2, R10, X5): one meeple - or a wild pair - from your
 * supply into the colour slot of a NEIGHBOUR's Notice Board, then that colour's
 * action, taken by you.
 *
 * The order is the same as the card visit's and for the same reason: the
 * payment LANDS first, then `afterVisit` fires host-side, then the action runs.
 * A17 The Smoke Pot and O16 The Fruit Store both key on that hook and neither
 * knows what paid.
 *
 * ⭐ NOTHING LEAVES THE GAME. The meeple sits in the host's slot until the host
 * spends a bonus option collecting it, which is the loop: your spent action
 * becomes their stored one. It is also the denial: while it sits there, that
 * colour of that neighbour is shut to the whole table.
 *
 * Every predicate below is the enumerator's, re-checked - a re-validation must
 * ask what the move NEEDS, never the window the caller has consumed.
 */
function doMeepleVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  const state = fx.state;
  if (visitor === host) {
    throw new Error('There is no self-visit under the meeple visit currency');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const colour = spend.colour;
  const meeples = spend.meeples ?? [];
  if (colour === undefined || meeples.length === 0) {
    throw new Error('A meeple visit names the slot colour and the meeple(s) spent');
  }
  if (meeples.length > 2) throw new Error('A visit spends one meeple, or two as a wild');
  const held = player(state, visitor).meeples;
  if (meeples.length === 1) {
    if (meeples[0] !== colour)
      throw new Error(`A ${meeples[0]} meeple buys the ${meeples[0]} slot`);
  } else {
    const [a, b] = meeples;
    if (a === undefined || b === undefined || a === b) {
      throw new Error('A wild spend is two meeples of different colours');
    }
    // The enumerator offers a pair only for a colour the seat does not hold, so
    // re-validating that keeps "apply accepts exactly what legalMoves offers".
    if ((held[colour] ?? 0) > 0) {
      throw new Error(`Seat ${visitor} holds a ${colour} meeple and must spend it singly`);
    }
  }
  // The acting meeple(s) and the toll come out of one supply, so they are
  // counted together before either is checked - two meeples of a colour cannot
  // be one spend and one toll when the seat holds only one.
  const toll = spend.toll ?? [];
  const wanted: Partial<Record<Suit, number>> = {};
  for (const m of [...meeples, ...toll]) wanted[m] = (wanted[m] ?? 0) + 1;
  for (const [m, n] of Object.entries(wanted) as [Suit, number][]) {
    if ((held[m] ?? 0) < n) throw new Error(`Seat ${visitor} has no ${m} meeple`);
  }
  // ⭐ R6 AS AMENDED: the slot is PRICED, not blocked. `slotToll` null keeps
  // v1's refusal; a number charges that many meeples per occupant, and both the
  // refusal and the price are re-validated here because `apply` must accept
  // exactly what the enumerator offered.
  const slotToll = slotTollOf(fx.data);
  const occupants = noticeBoardSlots(state, host)[colour]?.length ?? 0;
  if (occupants > 0 && slotToll === null) {
    throw new Error(`Seat ${host}'s ${colour} slot already holds a meeple`);
  }
  const owed = slotToll === null ? 0 : slotToll * occupants;
  if (toll.length !== owed) {
    throw new Error(`Seat ${host}'s ${colour} slot costs ${owed} extra meeples, got ${toll.length}`);
  }
  const door = doorOf(fx.data, colour);
  if (!workerActionLegal(fx.data, state, visitor, door.id)) {
    throw new Error(`The ${colour} door has nothing legal to do for seat ${visitor}`);
  }

  const wild = meeples.length > 1;
  // ⭐ THE TOLL IS BURNED BEFORE THE ACTING MEEPLE LANDS (R16). It goes to the
  // BOX and never into the slot, so it is a SINK and not a loan: the host
  // collects the acting meeple and nothing else, and the toll is the drain the
  // v1 loop did not have. `pool by round` is the line that says whether the
  // island can keep up with it.
  if (toll.length > 0) {
    for (const m of toll) fx.boxMeeple(visitor, m, 'toll');
    fx.emit({ e: 'visitToll', seat: visitor, host, colour, paid: [...toll], occupants });
  }
  fx.placeMeepleOnBoard(visitor, host, colour, meeples);
  state.turn.bonusUsed.push('visit');
  fireHook(fx, 'afterVisit', { visitor, host, self: false });
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: false,
    colour,
    action: door.action,
    wild,
    meeples: [...meeples],
  });
  performDoorAction(fx, visitor, colour, 'visit');
}

// --- The main-action umbrella ---------------------------------------------

/**
 * Is ANY main action legal? Decides whether `pass` is offered (and nothing else
 * is).
 *
 * It must list the MAIN actions and only those. The GBP 2 upgrade came out of
 * this list on 19/08/2026 when it moved into the bonus slot, because leaving it
 * in would suppress `pass` for a seat whose only remaining option was a bonus -
 * and that seat would then have no legal move at all. The same trap waits for
 * anything that is added here.
 */
export function hasMainOption(data: GameData, state: GameState, seat: Seat): boolean {
  return (
    drawableSuits(data, state).length > 0 ||
    anyBuildOption(data, state, seat) ||
    growOptions(data, state, seat).length > 0 ||
    harvestOptions(data, state, seat).length > 0 ||
    anyDeliverOption(data, state, seat) ||
    anyBalloonMoveOption(data, state, seat)
  );
}
