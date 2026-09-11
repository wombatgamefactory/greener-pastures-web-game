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

import type { GameData, Suit, SuitDoor, WorkerAction } from '@gp/data';
import {
  commonsHarvestReachesCentre,
  commonsWildPair,
  deliveriesPerTile,
  deliveryVp,
  endgameCoinCost,
  farmsteadCoinPower,
  hostDrawOnVisit,
  isCommons,
  isCommonsTakeCoins,
  isCommonsTakePaid,
  isCommonsTakeToHand,
  isCommonsTakeToSpend,
  isMeepleCurrency,
  isNoticeBoardPower,
  meepleAsCardGoesToBoard,
  meepleIndexForSpace,
} from '@gp/data';

import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import {
  canSowOnto,
  canTakeCard,
  cardById,
  coinsOf,
  commonsBoardCard,
  commonsBoards,
  commonsHarvestMin,
  doorOf,
  faceOf,
  drawableSuits,
  hasCentre,
  isFull,
  isHarvestable,
  meeplesHeld,
  noticeBoardOf,
  noticeBoardSlots,
  noticeBoardsOf,
  player,
  unclaimedCentre,
  visitTargetOf,
  workerData,
} from './query.js';
import type {
  AerodromeState,
  BonusOption,
  BuildingState,
  CardId,
  DoorAction,
  GameState,
  IslandTileState,
  Move,
  Seat,
  TaskAnswer,
} from './state.js';
import { markFiredOnTurn } from './state.js';
import { rngInt } from './rng.js';
import { doorActionOf, fireNoticeBoardPower, performDoorAction } from './workers.js';

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

/**
 * How many cards a build actually costs under its modifiers - and, under K15
 * alone, how many COINS instead.
 *
 * ⭐ THE COIN PRICE IS A RULES KNOB AND NEVER A CARD FIELD (K15, Dean
 * 10/09/2026). `rules.economy.endgameCoinCost` re-prices the fifteen Endgame
 * cards at that many COINS and ZERO CARDS; the fifteen Power cards keep their
 * two-own-suit cost, so each currency buys one kind of card. `Card.buildCost`
 * holds exactly `suit` and `wild` - its coin third went with the currency on
 * 02/09/2026 - and `data.test.ts` asserts that on purpose, because a coin price
 * arriving from a re-extract rather than from a ruling is exactly the drift
 * that guard exists to catch. So the branch is HERE, in the one function every
 * build route prices through, and not in the catalogue.
 *
 * ⚠️ A DISCOUNT CANNOT TOUCH A COIN PRICE, and the early return is how that is
 * said. A discount is measured in cards ("Build at a discount of 1"), a coin
 * price has no cards in it, and D4 The Milking Shed taking a coin off an
 * Endgame card would be a rate nobody wrote. The own-suit minimum goes to 0 for
 * the same reason: there is no payment for it to constrain.
 */
function priceOf(
  data: GameData,
  card: CardId,
  mods: BuildMods,
): { cardsNeeded: number; ownSuitMin: number; coins?: number } | null {
  const cost = cardById(data, card).buildCost;
  if (!cost) return null;
  const coins = endgameCoinCost(data);
  if (coins !== null && cardById(data, card).type === 'endgame') {
    return { cardsNeeded: 0, ownSuitMin: 0, coins };
  }
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
  price: { cardsNeeded: number; ownSuitMin: number; coins?: number },
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
 * Can this seat pay a coin price at all? True for every card in the shipped
 * game, where `price.coins` is never set. K15's one gate, asked wherever a
 * build is enumerated or probed.
 */
function coinsAffordable(state: GameState, seat: Seat, price: { coins?: number }): boolean {
  return price.coins === undefined || coinsOf(state, seat) >= price.coins;
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
  /**
   * ⭐ STOP AFTER THIS MANY OPTIONS. `anyBuildOption` passes 1, which is the
   * whole reason this exists: under R17 the gate has to ask the enumerator
   * (a payable cost is not necessarily a PLACEABLE one), and building the
   * entire list to answer a yes/no put a 2-seat game from 0.056s to 0.171s.
   * The same trick `enumerateVisits` already uses when `out` is null.
   */
  limit: number = Infinity,
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
  cardLoop: for (const id of cards) {
    const price = priceOf(data, id, mods);
    if (!price) continue;
    // ⭐ K15: AN ENDGAME CARD COSTS COINS, so a seat short of them is never
    // offered it - the gate is a filter here rather than a throw in `doBuild`,
    // on the file's standing rule that the enumerators are the single source of
    // legality. `coinsAffordable` reads `coinsOf`, which throws when the arm is
    // off, so it is only ever asked when `price.coins` is set and the wallet
    // therefore exists.
    if (!coinsAffordable(state, seat, price)) continue;
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
        if (out.length >= limit) break cardLoop;
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
  // K15: a coin-priced Endgame card revealed off a deck top is buildable only
  // by a seat holding the coins, exactly as one in the hand is. D10 The Scout's
  // Post is the only caller and its build runs through `doBuild` like any
  // other, so the price is charged there; this is the offer half.
  if (!coinsAffordable(state, seat, price)) return [];
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
    // K15, and the gate has to be here as well as in `buildOptions`: a gate
    // that asks a WIDER question than its enumerator says yes where no move
    // exists, which is the failure this function's own comment below records
    // costing two crashed games on 04/09/2026.
    if (!coinsAffordable(state, seat, price)) return false;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    const own = others.filter((c) => cardById(data, c).suit === suit).length;
    if (others.length >= price.cardsNeeded && own >= price.ownSuitMin) return true;
    if (!asCard) return false;
    if (!payableWithMeeples(data, p.meeples, suit, price, others.length, own)) return false;
    // ⛔ R17 CAN MAKE A PAYABLE COST UNPLACEABLE, and the gate has to know.
    // A meeple payment now has to LAND on a rival's board, and the toll for
    // landing on an occupied slot comes out of the same supply - so a seat can
    // afford a build in meeples and still have no legal way to put them down.
    // `payableWithMeeples` is pure arithmetic on the supply and cannot see any
    // of that.
    //
    // ⚠️ SO THE GATE ASKS THE ENUMERATOR, which is the rule this file already
    // states: the enumerators are the single source of legality, and a gate
    // that asks a wider question than its enumerator says yes where no move
    // exists. That crashed 2 games in 4820 on 04/09/2026 through exactly this
    // seam on the delivery side. It is only reached when the CARDS alone cannot
    // pay, which is the rare half of the branch, so the fast path stays fast in
    // the common case.
    // ⚠️ AND ONLY UNDER R17. With the box as the destination the arithmetic
    // above IS exact - nothing has to land anywhere - so the control arms must
    // return here and never pay for the enumeration. Forgetting this guard cost
    // the v2 box arm nothing in behaviour and about 4x in wall clock.
    if (!meepleAsCardGoesToBoard(data)) return true;
    // The arithmetic says the cost is affordable in meeples. Under R17 that is
    // not the same as PAYABLE, so the answer comes from the enumerator itself.
    return (
      placementOpen(data, state, seat) && buildOptions(data, state, seat, hand, mods, 1).length > 0
    );
  });
}

/**
 * Is there anywhere at all to put a paid meeple right now? A cheap necessary
 * condition for R17: at least one rival board must be able to receive a single
 * meeple of some colour the seat holds, toll included.
 *
 * ⚠️ NECESSARY, NOT SUFFICIENT, and deliberately so. A payment of three meeples
 * may still be unplaceable when a payment of one is fine, and the full check is
 * `placementsFor`. This exists to keep the gate CONSERVATIVE in the right
 * direction: it can only ever turn a yes into a no where nothing at all can be
 * placed, and the enumerator is what decides the rest.
 */
function placementOpen(data: GameData, state: GameState, seat: Seat): boolean {
  if (!meepleAsCardGoesToBoard(data)) return true;
  const supply = player(state, seat).meeples;
  for (const colour of data.cards.suits) {
    if ((supply[colour] ?? 0) < 1) continue;
    if (
      placementsFor(data, state, seat, { [colour]: 1 }, data.rules.turn.paymentSlotToll).length > 0
    ) {
      return true;
    }
  }
  return false;
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
  const wildAvailable = handCount - fromHand + (ownMeeples - fromOwn) + (otherMeeples - 2 * pairs);
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

  // ⭐ K15's PRICE, CHARGED IN THE FUNNEL: the coins come off before the card
  // lands, and `fx.spendCoins` re-checks the balance, so an Endgame card the
  // enumerator would not have offered cannot be built through a task answer or
  // a hand-rolled move. The `built` event is UNCHANGED and its `payment` is
  // simply empty - a coin price is zero cards - so nothing downstream that
  // counts builds or reads what a build spent has to learn a second shape.
  if (price.coins !== undefined) fx.spendCoins(seat, 'endgame', price.coins);
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
  const asCard = meepleAsCard(data);
  const onBoard = meepleAsCardGoesToBoard(data);
  const rate = data.rules.turn.paymentSlotToll;
  // ⭐ THE COIN-ACTIVATED FARMSTEAD (K10, Dean 10/09/2026), and it is false in
  // the shipped game twice over: the knob is off, and `mods.mainAction` is set
  // by exactly one caller. Hoisted so the loop below is byte-identical when it
  // is false.
  const farmsteadCoin = farmsteadCoinPower(data) && mods.mainAction === true;
  for (const b of p.tableau) {
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
  // ⚠️ `isHarvestable` AND NOT `isFull` SINCE 10/09/2026, and the two stopped
  // being the same boolean that day (S8, see `query.thresholdShuts`). This is
  // the HARVEST question - is the stack at or above its threshold - where
  // `isFull` now answers the CLOG question, and a `3+` Notice Board is
  // harvestable at three cards while never clogging at all. Asking `isFull`
  // here would have made the owned Notice Board unharvestable under the arm,
  // which is the whole of the host's payment (S7).
  const own = player(state, seat)
    .tableau.filter((b) => isHarvestable(data, b) || b.stack.length >= relaxedMin)
    .map((b) => b.card);
  // ⭐ AND, UNDER THE COMMONS, EVERY CENTRAL PILE DEEP ENOUGH TO TAKE (C5).
  // Not your buildings and not anybody's: a pile with a card on it is
  // harvestable by whoever's turn it is, into THEIR barn, and the whole pile
  // comes.
  //
  // ⭐ "DEEP ENOUGH" IS ONE CARD UNLESS `commonsHarvestMin` SAYS OTHERWISE
  // (Dean, 09/09/2026). At null - the shipped rule - the gate is >= 1 and this
  // is byte-identical to the rule as ruled; a number n imports the BUILDING
  // semantic into the centre, so a pile is "full" at n and refuses a harvest
  // below it. `commonsHarvestTake` is the other half of the same question and
  // lives in `fx.harvest`, because it changes what comes out rather than
  // whether anything may.
  //
  // ⭐ INCLUDING THE PILE YOU JUST FED THIS TURN, which is Dean's ruling and
  // not an accident of ordering: the commons play lands the fee BEFORE the
  // action it buys, so buying a Harvest through the wheat board can take back
  // the card that paid for it plus everything under it. "A good turn, not a
  // loop" - the fee is only ever ONE card and the pile it joins is whatever the
  // table left there.
  //
  // ⚠️ `relaxedMin` IS IRRELEVANT HERE (D2). A central pile has no threshold,
  // so it is never "not full"; the magenta balloon's harvest-any and the plain
  // action see exactly the same central targets, and the union above is where
  // the two gates still differ for BUILDINGS.
  // ⭐ TWO GAMES HAVE A CENTRE SINCE 11/09/2026, AND A HARVEST IS A HARVEST IN
  // BOTH (D1, reaffirmed by Dean that day, in his words "to prevent any rules
  // exceptions"). The commons puts all five piles in the middle; Dean's
  // unclaimed-boards variant puts the unfarmed suits' boards there and leaves
  // the rest as owned buildings. The gate is the same either way and so is the
  // minimum, which is why this reads `hasCentre` rather than growing a second
  // branch: the variant's overlay pins `commonsHarvestMin` to 3, so a pile
  // below three may be taken by nobody and a pile at three or more by ANYBODY.
  if (!hasCentre(data)) return own;
  // ⭐ DEAN'S VARIANTS: HARVEST NEVER REACHES THE CENTRE AT ALL under any
  // `commonsTake` value but the shipped `'harvest'`. Under 'bonus', 'spend'
  // and 'paid' (09/09/2026) a central pile is taken by the `commonsTake` bonus
  // move instead - to hand, to barn or per-board (D-S4); under 'coins'
  // (10/09/2026, K4, reversing C5) it is DISCARDED for one coin per card and
  // nothing playable comes back at all. In every one of the four the Harvest
  // action stops at own full buildings, commonsHarvestMin and
  // commonsHarvestTake have no subject, and the farm-bypass share reads 0% BY
  // CONSTRUCTION - which is why this returns before either knob is read.
  //
  // ⭐ ONE HELPER RATHER THAN A DISJUNCTION THAT GROWS BY ONE TERM PER VARIANT
  // (10/09/2026). `commonsHarvestReachesCentre` is written in @gp/data against
  // the shipped value, so a FIFTH `commonsTake` gets this rule right by
  // default instead of by somebody remembering to widen an `||` in two files.
  if (!commonsHarvestReachesCentre(data)) {
    return own;
  }
  return [...own, ...centralHarvestTargets(data, state)];
}

/**
 * ⭐ EVERY CENTRAL PILE DEEP ENOUGH FOR ANYBODY TO TAKE, as board card ids.
 *
 * Split out of `harvestOptions` on 11/09/2026 because a SECOND route now needs
 * exactly the same set: the Wheat Notice Board's power, which Dean ruled must
 * reach the centre under the unclaimed-boards variant "to prevent any rules
 * exceptions". A second copy of the depth test in `tasks.ts` is how a gate and
 * the action it gates come to disagree, which this file has already paid for
 * once (19/08/2026, five call sites).
 *
 * ⛔ IT WALKS `centralBoardSuits` AND NOT `data.cards.suits`. Under the commons
 * those are the same five; under the variant only the unfarmed suits have a
 * pile at all, and a colour with no board must not be offered as a pile of zero
 * - `commonsBoardCard` would happily hand back a card id that is sitting in a
 * rival's tableau.
 *
 * ⚠️ `relaxedMin` HAS NO SUBJECT HERE (D2). A central pile has no threshold, so
 * it is never "not full": the magenta balloon's harvest-any and the plain action
 * see exactly the same central targets, and the only gate is
 * `commonsHarvestMin`.
 */
export function centralHarvestTargets(data: GameData, state: GameState): CardId[] {
  if (!hasCentre(data) || !commonsHarvestReachesCentre(data)) return [];
  const boards = commonsBoards(state);
  const min = commonsHarvestMin(data);
  const out: CardId[] = [];
  // ⚠️ ONE WALK AND ONE ARRAY, RATHER THAN `centralBoardSuits().filter().map()`.
  // This runs through `hasMainOption` on every settle and through the bots'
  // speculative applies on top of that, and three throwaway arrays a call is
  // exactly the per-decision allocation ticket 28 went hunting for. An ABSENT
  // pile is a board that is not in the centre at all (a seat is farming that
  // suit); an EMPTY one is a board with nothing on it, and `>= min` refuses it
  // anyway - but the two are still checked separately, because conflating them
  // is how a rival's board would come to be offered as a harvest target.
  for (const colour of data.cards.suits) {
    const pile = boards[colour];
    if (pile === undefined || pile.length < min) continue;
    out.push(commonsBoardCard(data, colour));
  }
  return out;
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
function finishDelivery(
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
  opts?: { excludingHandCard?: CardId; excludingHandCard2?: CardId },
): boolean {
  return doorActionLegal(data, state, seat, workerData(data, workerId).action, opts);
}

/**
 * The same gate keyed on the ACTION rather than on a roster id, because the
 * commons buys one action the roster does not name (GROW, C3).
 *
 * `workerActionLegal` above is this function with the roster lookup in front of
 * it and is still the only way the two visit routes ask the question; the
 * commons asks here, through `commonsDoorAction`. One switch, so a door can
 * never be offered by one route and refused by the other.
 */
export function doorActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  action: DoorAction,
  /**
   * ⭐ `excludingHandCard2` IS THE WILD PAIR'S SECOND FEE (K3, 10/09/2026) and
   * nothing else ever sets it. Two optional fields rather than one `CardId[]`,
   * because every shipped call site passes exactly one card and must keep
   * passing one: an array would rewrite four call sites and both visit routes
   * for a knob that ships off.
   */
  opts?: { excludingHandCard?: CardId; excludingHandCard2?: CardId },
): boolean {
  const door = doorForAction(data, action);
  const withoutFee = opts?.excludingHandCard
    ? withoutFirst(player(state, seat).hand, opts.excludingHandCard)
    : player(state, seat).hand;
  const hand = opts?.excludingHandCard2
    ? withoutFirst(withoutFee, opts.excludingHandCard2)
    : withoutFee;
  switch (action) {
    case 'draw':
      return drawableSuits(data, state).length > 0;
    case 'harvest':
      return harvestOptions(data, state, seat).length > 0;
    case 'sow':
      // The Apiary door sows FROM THE HAND (v31), so it needs a card as well as
      // a target - which is exactly why it is the weakest door on the table:
      // two cards out, one threshold step in. `from: 'deck'` is the ruled fix if
      // the board takes no traffic, and this branch already handles it.
      // ⚠️ `canSowOnto` AND NOT `canTakeCard` (S11, 10/09/2026): a sow may
      // never choose a Notice Board under the notice-board visit, so the gate
      // and `sowTargets` have to ask the same question or a door is offered
      // with nothing to do. Identical to `canTakeCard` in every other game.
      return door.sow?.from === 'deck'
        ? drawableSuits(data, state).length > 0 &&
            player(state, seat).tableau.some((b) => canSowOnto(data, b))
        : hand.length > 0 && player(state, seat).tableau.some((b) => canSowOnto(data, b));
    case 'build':
      return anyBuildOption(data, state, seat, hand);
    case 'grow':
      // ⭐ THE COMMONS APIARY BOARD (C3). The Grow ACTION's own enumerator, with
      // the fee taken out of the hand first - which is what `excludeHandCard`
      // is for, and why it had to be added to `GrowOptionMods`: a hand of one
      // card cannot both pay the board and pay the activation.
      return (
        growOptions(data, state, seat, {
          ...(opts?.excludingHandCard === undefined
            ? {}
            : { excludeHandCard: opts.excludingHandCard }),
          ...(opts?.excludingHandCard2 === undefined
            ? {}
            : { excludeHandCard2: opts.excludingHandCard2 }),
        }).length > 0
      );
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
      return anyDeliverOption(data, state, seat) || anyBalloonMoveOption(data, state, seat);
    default:
      return action satisfies never;
  }
}

/**
 * The roster entry behind a door action. GROW has no entry of its own - it is
 * the commons re-reading the Apiary board's printed SOW (C3) - so it borrows
 * that one; the only thing `doorActionLegal` reads off an entry is the sow's
 * size and source, which a Grow never asks about.
 *
 * By ACTION rather than by id: the two happen to be spelled the same in
 * `workers.json` today and nothing should depend on their staying that way.
 */
function doorForAction(data: GameData, action: DoorAction): SuitDoor {
  const wanted: WorkerAction = action === 'grow' ? 'sow' : action;
  const door = data.workers.roster.find((w) => w.action === wanted);
  if (!door) throw new Error(`No door in the roster performs ${wanted}`);
  return door;
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
  // ⭐ THE COMMONS IS EXEMPT FROM "ONE OF EACH" (C8, 09/09/2026), and it has to
  // be: its slot holds ONE option, so refusing a second use of it would make A
  // Helping Hand grant a seat nothing at all. Under the commons the rule is "up
  // to `bonusSlotsFor` plays" - two with the card, one without, never three -
  // and the count above is the whole of the bound.
  //
  // ⭐ `commonsTake` CARRIES THE SAME EXEMPTION (Dean's variant, 09/09/2026):
  // under `commonsTake: 'bonus'` the slot holds ONE free option (the take)
  // beside the paid `commons` play, so a seat may play twice, take twice, or
  // one of each with A Helping Hand - never three - on exactly the reasoning
  // above.
  //
  // Keyed on the OPTION and not on the mode, because `'commons'` and
  // `'commonsTake'` are each producible only under their own knob; the
  // two-option slot the controls play keeps the per-option refusal that stops
  // a seat taking Draw 1 twice.
  //
  // ⭐ AND THE NOTICE-BOARD VISIT CARRIES IT TOO (S9, 10/09/2026), for
  // exactly the commons' reason: its slot holds ONE option, the visit, so
  // refusing a second use of it would make A Helping Hand grant a seat nothing
  // at all. What stops the two plays being the same play is not this rule but
  // S9's ONE-USE-PER-BOARD latch in `enumerateNoticeBoardVisits`, which sends
  // the second bonus to a DIFFERENT board. The exemption is keyed on the mode
  // as well as the option, because `'visit'` is producible under three
  // currencies and only this one widens the slot.
  //
  // ⛔ AND SINCE 11/09/2026 BOTH EXEMPTIONS CAN BE LIVE AT ONCE, WHICH IS THE
  // ONE CASE TO REASON ABOUT BEFORE TOUCHING THIS FUNCTION. Under Dean's
  // unclaimed-boards variant a seat may produce a `visit` (onto a rival's
  // board) AND a `commons` play (onto an ownerless one) in the same turn, so
  // for the first time two exempt options share one slot.
  //
  // ⭐ THEY DO NOT ADD UP TO TWO SLOTS, AND THE LINE THAT GUARANTEES IT IS THE
  // COUNT AT THE TOP OF THIS FUNCTION, NOT THE EXEMPTION BELOW.
  // `turn.bonusUsed.length >= bonusSlotsFor(...)` is a count of PLAYS and is
  // blind to which kind each one was: one slot means one play, whichever kind;
  // A Helping Hand means two, of any mix; and there is never a third. The
  // exemption only ever says "a second play may be the same KIND as the first",
  // which is what makes the card grant anything at all. What stops the two
  // plays being the same BOARD is S9's latch, and under the variant that latch
  // is written by `doNoticeBoardVisit` and `doCommons` into the same
  // `turn.firedThisTurn` list, so it spans both halves of the slot.
  // `notice-board-unclaimed.test.ts` asserts all four of those separately.
  if (
    option !== undefined &&
    option !== 'commons' &&
    option !== 'commonsTake' &&
    !(option === 'visit' && isNoticeBoardPower(data)) &&
    turn.bonusUsed.includes(option)
  ) {
    return false;
  }
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
  // ⛔ AND NO MEEPLES AT ALL UNDER THE COMMONS (C6): no starting supply, no
  // island seed, no spend and no Collect. The supply is all zeros there, so this
  // line changes no answer - it is here for the same reason the line above it
  // is, because `settleTurn` holds a turn open while this is non-empty and
  // "empty by construction" is exactly the claim that stops being true quietly.
  if (isCommons(data)) return [];
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
  // ⛔ AND CLOSED UNDER THE COMMONS (C9): the slot holds one option, the
  // commons play, and an unspent slot is a turn that chose not to pay. The
  // number survives here too, unread - there is no Collect under the commons
  // for it to price either.
  if (isCommons(data)) return false;
  // ⛔ AND CLOSED UNDER THE NOTICE-BOARD VISIT (S5, 10/09/2026), which is a
  // PASSENGER THE HANDOFF DID NOT PIN and had to be named rather than
  // inherited. S5 says the bonus action IS the visit, one per turn, optional -
  // the slot holds one option - and the standalone free Draw 1 is one of the
  // three things `'card'` carries that this arm explicitly does not want. It
  // is also the thing that killed v31: the free Draw ate the slot at 67.6%,
  // and leaving it open here would have measured that failure a second time
  // under a different name. The NUMBER survives, unread, exactly as it does
  // under the commons and the meeple loop.
  if (isNoticeBoardPower(data)) return false;
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
 * ⭐ THREE ENUMERATORS BEHIND ONE MOVE TYPE SINCE 10/09/2026, and the note
 * below describes the FIRST of them. `enumerateVisits` dispatches on the
 * currency: the v31 card fee (this note), the meeple loop
 * (`enumerateMeepleVisits`) and the notice-board visit
 * (`enumerateNoticeBoardVisits`), which buys a board's PRINTED POWER rather
 * than its suit's plain door and rations boards by a per-turn latch rather than
 * by a clog.
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
  // ⛔ THERE IS NO `visit` MOVE UNDER THE COMMONS (C6/C9). A play onto a
  // central board IS the visit for every card that keys on the word (C8), but
  // it is its own move with no host, so the visit enumerator answers nothing -
  // and it must answer BEFORE the card branch below, which would otherwise ask
  // `noticeBoardOf` for a board that is not in anybody's tableau and throw from
  // inside `legalMoves`.
  if (isCommons(data)) return false;
  if (isMeepleCurrency(data)) return enumerateMeepleVisits(data, state, seat, out);
  // ⛔ AND A CENTRAL BOARD IS NEVER A `visit` TARGET UNDER DEAN'S
  // UNCLAIMED-BOARDS VARIANT (11/09/2026). A play onto an OWNERLESS board is
  // the `commons` move; a `visit` names a HOST SEAT, which is the whole of what
  // the two moves are for - the visit's fee rests on a person's board as
  // material they must harvest (S7, "pay the giver in the same act"), and a
  // central fee is paid to nobody. It falls out of the enumerator below looping
  // `state.players` rather than needing a filter: a board with no owner has no
  // seat index to be `host`, so it cannot be produced here at all.
  if (isNoticeBoardPower(data)) return enumerateNoticeBoardVisits(data, state, seat, out);
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat && !data.rules.turn.selfVisitAllowed) continue;
    // ⚠️ ONE BOARD PER SEAT HERE, DELIBERATELY, and `noticeBoardOf` is the
    // right function rather than a first-match accident. Dean's two-board fix
    // (`rules.economy.noticeBoardsBySeats`, 11/09/2026) is read ONLY under
    // `visitCurrency: 'noticeBoardPower'` - `extraNoticeBoardsPerSeat` returns
    // 0 for every other currency - so under the v31 card fee no seat has a
    // second board and this line has no second board to miss. If that gate ever
    // widens, this is one of the two enumerators that has to learn to loop.
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
 * ⭐ IS THIS BOARD'S POWER LEGAL FOR THIS SEAT RIGHT NOW (S10, Dean
 * 10/09/2026)? The standing door ruling - a board whose power you cannot
 * perform is not offered - asked of the five S12 powers rather than of the five
 * plain doors.
 *
 * ⚠️ IT IS A DIFFERENT QUESTION FROM `doorActionLegal` AND HAS TO BE. Three
 * of the five powers are wider than the plain action they are named after: the
 * Dairy board waives the crop requirement, so it is legal where a plain Build
 * is not; the Wheat board harvests a building at ANY stack size and banks a
 * card besides, so it is legal where a plain Harvest has no full building; and
 * the Vegetable board has a fallback, so it is legal with an empty barn.
 * Asking the plain gate would refuse boards the arm exists to keep alive - S13
 * fixed availability first, and four of the morning's five powers were dead
 * most of the time.
 *
 * ⭐ IT SHOULD ALMOST NEVER BITE, which is §2.3's whole purpose: with a card
 * in hand only the Orchard board can be dead (every deck exhausted), and even
 * the Apiary board needs only one building with room.
 *
 * `excludingHandCard` is the FEE, which has left the hand by the time the power
 * runs, so every hand-reading leg has to be asked without it - the same rule
 * `doorActionLegal` follows and for the same reason: a hand of one card cannot
 * both pay the board and feed the power.
 */
export function noticeBoardPowerLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  colour: Suit,
  opts?: {
    excludingHandCard?: CardId;
    /**
     * ⭐ THE CENTRAL BOARD THE FEE IS ABOUT TO LAND ON, under Dean's
     * unclaimed-boards variant (11/09/2026). Present only on the `commons`
     * route - a play onto an OWNERLESS board - and never on the `visit` route,
     * where the fee lands on a rival's building instead and no pile moves.
     *
     * ⛔ ONLY THE WHEAT BRANCH READS IT, and it is the same question
     * `commonsHarvestLegalAfterFee` asks under the commons: the fee joins the
     * pile BEFORE the power runs, so a play onto the wheat board can be what
     * takes its own pile to `commonsHarvestMin`. Asking the position as it
     * stands rather than as the fee makes it is how an enumerator and its
     * funnel come to disagree.
     */
    feeOntoCentral?: Suit;
  },
): boolean {
  const p = player(state, seat);
  const hand =
    opts?.excludingHandCard === undefined ? p.hand : withoutFirst(p.hand, opts.excludingHandCard);
  const numbers = data.rules.economy.noticeBoardPower;
  switch (colour) {
    case 'orchard':
      // "Draw 4." Dead only when every deck in play is exhausted.
      return drawableSuits(data, state).length > 0;
    case 'dairy':
      // "Build. You may spend cards of any crops." The waiver is part of the
      // gate, not just of the resolution: a hand that cannot pay the own-suit
      // half can still pay this build, and offering it is the point.
      return anyBuildOption(data, state, seat, hand, numbers.dairyWild ? { substitute: true } : {});
    case 'wheat':
      // "Harvest one of your buildings, then put 1 card from your hand into
      // your barn." EITHER leg makes it live: a building with a card on it
      // (`filter: 'loaded'`, any stack size), or a card left in hand for the
      // barn. That second leg is ruling C88's whole purpose.
      //
      // ⭐ AND A THIRD LEG SINCE 11/09/2026, UNDER DEAN'S UNCLAIMED-BOARDS
      // VARIANT: ANY CENTRAL PILE AT `commonsHarvestMin`. "A Harvest is a
      // Harvest" (D1, reaffirmed that day, and his explicit reason was "to
      // prevent any rules exceptions"), so the Wheat power reaches the centre
      // exactly as the main Harvest action does and under exactly the same
      // minimum. Without this leg the bought Harvest would be the one Harvest
      // in the game that could not take a pile, which is the rules exception
      // the ruling forbids.
      return (
        p.tableau.some((b) => b.stack.length >= 1) ||
        anyCentralHarvestAfterFee(data, state, opts?.feeOntoCentral) ||
        (numbers.wheatBarn > 0 && hand.length > 0)
      );
    case 'apiary':
      // "Sow 2 cards from your hand onto your buildings." A card to sow and
      // somewhere of your OWN to put it (C89) - and never the Notice Board
      // itself (S11), which is why this reads `canSowOnto`.
      return (
        numbers.apiarySows > 0 && hand.length > 0 && p.tableau.some((b) => canSowOnto(data, b))
      );
    case 'vegetable':
      // "Deliver. If you cannot, put 2 cards from your hand into your barn."
      // Island claim or balloon move (DL-12), else the fallback - so it is
      // dead only for a seat that can do neither AND holds nothing.
      return (
        doorActionLegal(data, state, seat, 'deliver') ||
        (numbers.vegetableFallback > 0 && hand.length > 0)
      );
    default:
      return colour satisfies never;
  }
}

/**
 * EVERY NOTICE-BOARD VISIT ON OFFER (S5-S11, Dean 10/09/2026): one card from
 * your hand onto ANY player's Notice Board, your own included, for that board's
 * printed power.
 *
 * ⭐ THE THREE RULES THAT ARE NOT THE v31 ENUMERATOR'S, in the order they are
 * applied:
 *
 *  - **S6, self-use is back**, reversing the ban of 04/09/2026, gated by
 *    `rules.turn.selfVisitAllowed` as it was in v31.
 *    `overlays/notice-board-visit-no-self-v1.overlay.json` is the control and
 *    the single most important sub-arm in the plan. Why it is safe now and was
 *    not then: in v31 every board printed the SAME thing, so a self-visit was
 *    strictly better than a visit and took 22.2% of turns; here the five
 *    boards print five DIFFERENT powers, so your own board is one option of
 *    five and it is the one that never has what you have not got.
 *  - **S9, ONE USE PER BOARD PER TURN.** A Helping Hand's second bonus must go
 *    to a DIFFERENT board. The corpus records a chaining blow-up in the
 *    predecessor where five or six loads in one turn drew most of the deck.
 *  - **S8, nothing ever blocks.** `isFull` answers false for a `3+` board
 *    however deep the stack, so this filter bites only under the paired
 *    control `noticeBoardBlocks: true` - where it is exactly the v31 rule and
 *    exactly the stall being measured.
 *
 * ⛔ THE LATCH IS `turn.firedThisTurn`, KEYED BY THE BOARD'S CARD ID, and the
 * choice is worth the sentence it takes. That list means "this card's printed
 * text has fired this turn" and a Notice Board's power IS its printed text, so
 * the semantics fit rather than being borrowed. It identifies the HOST
 * uniquely because `newGame` refuses duplicate player suits, so W3 is one
 * seat's board and no other's. And nothing else reads it in a way that could
 * change: `growOptions` and `activateTargets` are the only two filters over
 * that list and both have excluded the noticeboard slot by name since v31. The
 * alternative - a parallel per-turn list - would have added a `TurnState`
 * field, and an added field is a serialisation change every fixture in
 * `packages/sim/fixtures/` would have had to absorb.
 *
 * ⚠️ ONLY THE DAIRY BOARD IS ASKED ONCE PER FEE. Four of the five powers
 * read the hand for its SIZE alone after the fee leaves it, and that is
 * `hand.length - 1` whichever card pays; the Dairy board's waived build reads
 * WHICH cards are left, so it and only it can answer differently for different
 * fees. Same reduction the v31 enumerator makes for its three hand-blind doors,
 * and it saves a `withoutFirst` copy per card in hand on four boards out of
 * five.
 *
 * ⭐ AND SINCE DEAN'S TWO-BOARD FIX (11/09/2026) IT WALKS BOARDS RATHER THAN
 * SEATS, WHICH IS THE WHOLE OF THE VARIANT IN THIS FUNCTION. A host may hold
 * TWO Notice Boards at two seats - its own suit's, and one drawn from the suits
 * nobody is farming - so the inner loop is over `noticeBoardsOf(host)` and a
 * seat now faces 2 / 2 / 3 targets by seat count instead of 1 / 2 / 3.
 *
 * ⛔ AND THE POWER COMES OFF THE BOARD'S OWN SUIT, NEVER OFF
 * `player(state, host).suit`. That was the same thing in every game until the
 * fix and is the silent bug the variant can have: a host's SECOND board prints
 * a different colour's power, so reading the owner's suit would sell a wheat
 * visitor the apiary board's Grow, invisibly, and only ever at two seats.
 *
 * ⭐ S9'S LATCH IS STILL A CORRECT PARTITION AND NEEDED NO CHANGE, because it
 * is keyed on the BOARD'S CARD ID: no suit's board is ever on the table twice
 * (a seat's own suit is its own board and the extras are dealt from the
 * unfarmed suits without replacement), so W3 still identifies one board on one
 * farm. What changes is that A Helping Hand's second play finally has somewhere
 * to go at two seats - the rival's other board - where under the control the
 * one legal target was latched by the first play and the card granted nothing.
 */
function enumerateNoticeBoardVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  // The stand-in fee for the four hand-blind powers: they read the hand's SIZE
  // after the fee leaves it, which is the same for every card in it.
  const probeFee = hand[0] as CardId;
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat && !data.rules.turn.selfVisitAllowed) continue;
    const boards = noticeBoardsOf(data, state, host);
    // ⭐ THE FIELD IS OMITTED WHEN THE HOST HAS ONE BOARD, which is what keeps
    // every move this enumerator produces byte-identical to the control's at
    // three and four seats - and to the shipped game's, and to every fixture
    // in `packages/sim/fixtures/`. See the `visit` move's own docblock.
    const named = boards.length > 1;
    for (const board of boards) {
      if (state.turn.firedThisTurn.includes(board.card)) continue;
      if (isFull(data, board)) continue;
      const colour = cardById(data, board.card).suit;
      const tag = named ? { board: board.card } : {};
      if (colour !== 'dairy') {
        if (!noticeBoardPowerLegal(data, state, seat, colour, { excludingHandCard: probeFee })) {
          continue;
        }
        if (out === null) return true;
        for (const fee of hand) out.push({ type: 'visit', seat, host, fee, ...tag });
        any = true;
        continue;
      }
      for (const fee of hand) {
        if (!noticeBoardPowerLegal(data, state, seat, colour, { excludingHandCard: fee })) continue;
        if (out === null) return true;
        out.push({ type: 'visit', seat, host, fee, ...tag });
        any = true;
      }
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
function tollFills(data: GameData, supply: Readonly<Record<Suit, number>>, owed: number): Suit[][] {
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
  // Already false under the commons (C6) and under the v31 card game: Collect is
  // the meeple loop's own half of the slot and has no subject in either. One
  // predicate rather than three, so the two modes that have no Collect cannot
  // drift apart.
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

// --- THE COMMONS (C1-C10, 09/09/2026) --------------------------------------

/**
 * C10's TWO FALLBACK KNOBS, both OFF by default, so that if the bonus reads
 * automatic at the table the cap is one number away.
 *
 * `commonsThreshold` (int or null): a board holding at least this many cards
 * refuses further plays. `commonsColourMatch` (boolean): the fee must be a card
 * of the board's own colour.
 *
 * ⭐ THE OTHER TWO COMMONS KNOBS ARE NOT HERE, AND THAT IS THE SEAM RATHER
 * THAN AN OVERSIGHT. `commonsHarvestMin` and `commonsHarvestTake` (Dean,
 * 09/09/2026) ration the HARVEST rather than the play, so they are read where a
 * harvest is decided - `harvestOptions` and `fx.harvest` - through
 * `query.ts`'s two helpers. The only place all four meet is
 * `commonsActionLegal`, because the wheat board buys a Harvest and a board
 * whose action can do nothing is not offered.
 */
interface CommonsKnobs {
  threshold: number | null;
  colourMatch: boolean;
}

function commonsKnobs(data: GameData): CommonsKnobs {
  const { commonsThreshold, commonsColourMatch } = data.rules.economy;
  return { threshold: commonsThreshold, colourMatch: commonsColourMatch };
}

export type CommonsOption = Extract<Move, { type: 'commons' }>;

/**
 * ⭐ CAN THIS BOARD'S ACTION DO ANYTHING, GIVEN THAT THE FEE LANDS FIRST?
 *
 * The order in `doCommons` is load-bearing (C3, and the card visit's own order
 * since v14): the fee leaves the hand and joins the pile BEFORE the action runs.
 * So the gate has to be asked of the position AFTER it lands, or the enumerator
 * and the funnel disagree - which is the exact failure `workerActionLegal`'s
 * warning describes, arriving from a new direction.
 *
 * Two consequences, and both are rules rather than implementation:
 *
 *  - the hand-reading actions (Build and GROW, plus Sow if a roster ever prints
 *    one here) are asked WITHOUT the fee, so a hand of one card can pay the
 *    board or pay the build, never both;
 *  - ⭐ THE WHEAT BOARD CAN NEVER BE DEAD, WHICH IS D6 - AND `commonsHarvestMin`
 *    IS THE ONE KNOB THAT TAKES IT AWAY. Its action is Harvest and every
 *    central pile deep enough to take is a target (C5), so under the shipped
 *    rules the fee that buys the Harvest is itself a legal thing to harvest: a
 *    seat with no full building can still play a card onto the wheat board and
 *    take it, and anything under it, straight into their barn. That is Dean's
 *    "a good turn, not a loop" read literally, and it makes the floor of the
 *    bonus slot "one card from hand to barn" rather than "nothing".
 *
 * ⛔ UNDER `commonsHarvestMin` (Dean, 09/09/2026) THE WHEAT BOARD IS AN
 * ORDINARY BOARD AGAIN. A pile below the minimum refuses a harvest, so the fee
 * only makes its OWN pile harvestable if that pile REACHES the minimum once the
 * fee has landed - which is why the probe below counts the fee onto the board
 * being played and asks the rest of the position as it stands. At n = 3 a play
 * onto an empty wheat board buys a Harvest of nothing, so the board is not
 * offered at all unless some other pile is already deep enough or the seat has
 * a full building of its own. That is a real change of rule, not a tuning, and
 * it is named on the knob's own description.
 */
function commonsActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
  fee: CardId,
  /**
   * ⭐ THE WILD PAIR'S SECOND CARD (K3, 10/09/2026). It lands on the pile
   * exactly as `fee` does, so it has to leave the hand for this probe exactly as
   * `fee` does: a hand of two cards can pay a pair OR pay a build, never both.
   * Leaving it in would offer a dairy board the seat cannot then afford to use,
   * which is the enumerator-and-funnel disagreement `workerActionLegal`'s own
   * warning describes, arriving from a third direction.
   */
  fee2?: CardId,
): boolean {
  // ⭐ A CENTRAL BOARD GRANTS THE SAME PRINTED POWER AS AN OWNED ONE UNDER
  // DEAN'S UNCLAIMED-BOARDS VARIANT (ruled 11/09/2026 on his standing
  // principle that there are no rules exceptions). It is the SAME CARD - O3 is
  // O3 whether it sits in an Orchard seat's farm or in the middle of the table
  // - and a card prints what it does, so a central Orchard board is *Draw 4*
  // and not the commons' plain Draw 2, and a central Apiary board is *Sow 2
  // cards from your hand onto your buildings* (S12 as amended by C89) and not
  // the commons' GROW substitution.
  //
  // ⛔ SO THE GATE IS `noticeBoardPowerLegal` AND NOT `doorActionLegal`, and
  // the difference is not cosmetic: three of the five powers are WIDER than
  // the plain action they are named after (the Dairy board waives the crop
  // requirement, the Wheat board harvests at any stack size and banks a card,
  // the Vegetable board has a fallback), so asking the plain door gate would
  // refuse central boards the variant exists to keep alive.
  //
  // ⛔ AND IT RESOLVES THE PASSENGER THE DATA PASS FLAGGED, IN THE DIRECTION
  // THE RULING POINTS. `doorActionForSuit` substitutes
  // `workers.roster.sow.actionUnderCommons` (the Apiary board's GROW, C3 of the
  // commons) only while `isCommons` is true, and under this variant the
  // currency is `'noticeBoardPower'`, so it is FALSE and the Apiary board reads
  // back its printed SOW. That is the CORRECT answer here rather than a bug to
  // fix: the GROW substitution is the commons' own rule for a board that grants
  // a plain door action, and a board that grants a printed power has no door
  // action to substitute. Nothing below reads `doorActionOf` on this path.
  if (unclaimedCentre(data)) {
    return noticeBoardPowerLegal(data, state, seat, board, {
      excludingHandCard: fee,
      feeOntoCentral: board,
    });
  }
  const action = doorActionOf(data, board);
  if (action === 'harvest') return commonsHarvestLegalAfterFee(data, state, seat, board);
  return doorActionLegal(data, state, seat, action, {
    excludingHandCard: fee,
    ...(fee2 === undefined ? {} : { excludingHandCard2: fee2 }),
  });
}

/**
 * Would a Harvest have a target, in the position the fee makes?
 *
 * The one gate in the file that has to look at the position AFTER a card it has
 * not yet played, and it exists because `harvestOptions` cannot be asked the
 * question: the fee is still in the hand when the enumerator runs, and the
 * board being played on is one card shallower than it will be. Counting the fee
 * here rather than mutating a copy of the state keeps the probe cheap enough to
 * run five times per card in hand.
 */
function commonsHarvestLegalAfterFee(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  // The HARVEST question, so `isHarvestable` (10/09/2026); commons-only, where
  // the two predicates are still the same boolean, but the reading has to say
  // which one it meant.
  if (player(state, seat).tableau.some((b) => isHarvestable(data, b))) return true;
  // ⭐ UNDER EVERY `commonsTake` VALUE BUT THE SHIPPED ONE THE WHEAT BOARD IS AN
  // ORDINARY BOARD AGAIN, exactly as under commonsHarvestMin (D6 stops
  // holding): Harvest never reaches the centre (D-S4 under 'bonus', 'spend'
  // and 'paid'; K4 under 'coins'), so the fee just played can never be what
  // makes this Harvest legal. Without a full building of their own, this seat
  // has nothing for the wheat board's action to do. Read through the same
  // helper `harvestOptions` uses, so the gate and the action cannot disagree.
  return anyCentralHarvestAfterFee(data, state, board);
}

/**
 * ⭐ WOULD ANY CENTRAL PILE BE DEEP ENOUGH TO HARVEST ONCE THE FEE HAS LANDED?
 *
 * The tail of `commonsHarvestLegalAfterFee`, lifted out on 11/09/2026 because
 * the Wheat Notice Board's POWER now asks the identical question under Dean's
 * unclaimed-boards variant (`noticeBoardPowerLegal`, case `'wheat'`). One
 * helper rather than two copies of a depth test: the commons already paid once
 * for a gate and its action drifting apart.
 *
 * `feeOnto` is the board the fee is about to join, or undefined when the fee is
 * not going to the centre at all - a visit to a rival's board, or a gate asked
 * about the position as it stands. It counts for ONE card, because a fee is one
 * card; the wild pair (two cards onto one pile) is `commonsWildPair`, which is
 * pinned false under both games that have a centre today, and if it is ever
 * turned on beside a `commonsHarvestMin` above 1 this is the line to widen.
 *
 * Answers false where Harvest cannot reach the centre at all
 * (`commonsHarvestReachesCentre`), so the four `commonsTake` variants read a
 * farm bypass of 0% by construction exactly as `harvestOptions` does.
 */
function anyCentralHarvestAfterFee(data: GameData, state: GameState, feeOnto?: Suit): boolean {
  if (!hasCentre(data) || !commonsHarvestReachesCentre(data)) return false;
  const min = commonsHarvestMin(data);
  const boards = commonsBoards(state);
  // Allocation-free for the reason `centralHarvestTargets` above gives: the
  // bonus enumerator asks this once per (board, card in hand) pair.
  for (const colour of data.cards.suits) {
    const pile = boards[colour];
    if (pile === undefined) continue;
    const depth = pile.length + (colour === feeOnto ? 1 : 0);
    if (depth >= min) return true;
  }
  return false;
}

/**
 * EVERY COMMONS PLAY ON OFFER (C3): one move per (central board, card in hand)
 * whose board's action this seat can legally perform right now.
 *
 * Any card onto any board is the printed rule - the fee is a fee and not a
 * payment in kind - so the list is (5 boards x hand), which is where the bonus
 * slot's whole branching factor now lives. It REPLACES the meeple visit's
 * (rival hosts x 5 colours x wild pairs), so the count should fall rather than
 * rise.
 *
 * ⛔ A BOARD WHOSE ACTION YOU CANNOT PERFORM IS NOT OFFERED, which is Dean's
 * standing ruling and unchanged since the doors were introduced. Under the
 * commons it bites less often than it ever has: the wheat board is always live
 * (see `commonsActionLegal`) and the orchard board is live whenever a deck has a
 * card, so a seat is essentially never locked out of the slot - which matters,
 * because the commons has no free Draw 1 to backstop it (C9).
 */
export function commonsOptions(data: GameData, state: GameState, seat: Seat): CommonsOption[] {
  const out: CommonsOption[] = [];
  enumerateCommons(data, state, seat, out);
  return out;
}

/** Is ANY commons play on offer? The same walk, stopping at the first hit. */
export function anyCommonsOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateCommons(data, state, seat, null);
}

/**
 * The one walk behind both, exactly as `enumerateVisits` is for the visit:
 * `out === null` means "stop at the first legal play". A predicate COPIED out of
 * an enumerator silently stops agreeing with it, and `settleTurn` asks the
 * question after every apply.
 */
function enumerateCommons(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: CommonsOption[] | null,
): boolean {
  // ⭐ TWO GAMES PRODUCE A `commons` MOVE SINCE 11/09/2026. The commons itself
  // (all five piles, C1) and Dean's unclaimed-boards variant, where the piles
  // are the boards of the suits nobody is farming and a play onto a RIVAL's
  // board is the `visit` move instead. One enumerator for both, deliberately:
  // the move's shape, its fee, its slot accounting and its pile are identical,
  // and the manager's ruling of 11/09/2026 was "do NOT invent a third move
  // shape".
  if (!hasCentre(data)) return false;
  if (!bonusOpen(data, state, 'commons')) return false;
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  const boards = commonsBoards(state);
  const knobs = commonsKnobs(data);
  // ⭐ S9's ONE-USE-PER-BOARD LATCH REACHES THE CENTRE (11/09/2026). Under the
  // variant A Helping Hand's second play must go to a DIFFERENT board, and the
  // two halves of the slot - a rival's board and a central one - have to share
  // one latch or a seat could play onto central Wheat and then rival Wheat and
  // take the same power twice.
  //
  // ⛔ THE LATCH IS PER CARD ID, NOT PER SUIT, AND UNDER THIS VARIANT THE TWO
  // ARE THE SAME PARTITION, WHICH IS WHY THE CHOICE IS SAFE. A suit is EITHER
  // one seat's or in the centre and never both: `newGame` refuses duplicate
  // player suits, and `freshCommons` puts exactly the leftovers in the middle.
  // So "central Wheat then rival Wheat" is not a loophole this closes, it is a
  // position that cannot exist - there is no rival Wheat board in a game where
  // Wheat is central. Per card id is kept because that is what
  // `turn.firedThisTurn` already means ("this card's printed text has fired
  // this turn") and a Notice Board's power IS its printed text, whichever side
  // of the table the card is on; a parallel per-suit list would have added a
  // `TurnState` field and moved every fixture in `packages/sim/fixtures/`.
  const latched = unclaimedCentre(data);
  let any = false;
  for (const board of data.cards.suits) {
    // ⭐ AN ABSENT PILE IS A BOARD THAT IS NOT IN THE CENTRE (11/09/2026): some
    // seat is farming that suit, so their board is a building and the way to it
    // is the `visit` move. All five keys are present under the commons, so this
    // skips nothing there and the walk is the one it always was.
    const pile = boards[board];
    if (pile === undefined) continue;
    // C10, off by default: a board at its cap refuses the play outright. It is
    // the one thing in the commons that ever refuses anything, which is why it
    // is a knob and not a rule - C4 says a central board never refuses a play.
    if (knobs.threshold !== null && pile.length >= knobs.threshold) continue;
    if (latched && state.turn.firedThisTurn.includes(commonsBoardCard(data, board))) continue;
    for (const fee of hand) {
      // C10 again: the fee must match the board's colour.
      if (knobs.colourMatch && cardById(data, fee).suit !== board) continue;
      if (!commonsActionLegal(data, state, seat, board, fee)) continue;
      if (out === null) return true;
      out.push({ type: 'commons', seat, board, fee });
      any = true;
    }
    // ⭐ THE WILD PAIR (D5 of the commons pass, left unbuilt on 09/09/2026 by
    // D7, ruled back in by K3 on 10/09/2026): TWO cards of ANY colours pay for
    // one board of any colour, and BOTH land on its pile.
    //
    // ⚠️ ONLY UNDER COLOUR MATCHING, and the guard is a rule rather than an
    // optimisation: with any card already paying for any board there is no
    // colour for a pair to stand in for, so every pair would be a strictly
    // dominated way to pay - two cards out for what one buys - and offering
    // them would multiply the bonus slot's branching by C(hand, 2) for a choice
    // no player would ever make.
    //
    // ⚠️ BRANCHING: C(h, 2) MORE OPTIONS PER BOARD, which at the engine's
    // hand bound of 7 (C7, an instrument bound and not a rule of the game) is 21
    // a board and 105 a turn, well under the build enumerator. Unordered and
    // distinct - `j` starts at `i + 1` - because a pair is a pair whichever card
    // is named first and both go to the same place, so (a, b) and (b, a) are the
    // same move.
    //
    // ⭐ AND THE PAIR IS OFFERED WHEREVER IT IS LEGAL, never only as a last
    // resort. That is the OPPOSITE of the meeple wild pair's rule in
    // `paymentsFor` and `growOptions`, and deliberately so: a meeple pair was
    // strictly dominated by spending the exact colour singly, whereas a seat
    // holding one matching card AND two off-colour cards has a real choice
    // between paying its good card and paying two junk ones (L5, "your junk is
    // their treasure"). Suppressing it would make that decision for the player.
    //
    // ⛔ AND NEVER UNDER DEAN'S UNCLAIMED-BOARDS VARIANT (11/09/2026), which is
    // a fail-closed guard rather than a rule. `commonsWildPair` is pinned false
    // in both of that variant's overlays and means nothing without
    // `commonsColourMatch`, which is pinned false beside it; but the gate this
    // variant's play is asked through - `noticeBoardPowerLegal` - takes ONE
    // `excludingHandCard`, so a pair would be priced with its second card still
    // notionally in hand and could offer a Dairy board the seat cannot then
    // afford to use. Turning the pair on here is therefore a second change and
    // not a knob flip: widen the power gate first.
    if (unclaimedCentre(data)) continue;
    if (!knobs.colourMatch || !commonsWildPair(data)) continue;
    for (let i = 0; i < hand.length; i++) {
      const fee = hand[i] as CardId;
      for (let j = i + 1; j < hand.length; j++) {
        const fee2 = hand[j] as CardId;
        if (!commonsActionLegal(data, state, seat, board, fee, fee2)) continue;
        if (out === null) return true;
        out.push({ type: 'commons', seat, board, fee, fee2 });
        any = true;
      }
    }
  }
  return any;
}

/**
 * ⭐ THE COMMONS PLAY (C3): one card from your hand onto one of the five central
 * Notice Boards, then that board's action, taken by you.
 *
 * ⭐ AND SINCE 11/09/2026 IT IS ALSO DEAN'S UNCLAIMED-BOARDS VARIANT'S PLAY,
 * onto one of the boards of the suits nobody is farming. Same move, same fee,
 * same slot accounting, same pile - what differs is that the board grants its
 * PRINTED POWER rather than the plain door action (see the branch at the foot
 * of this function) and that S9's one-use-per-board latch applies, shared with
 * `doNoticeBoardVisit` through `turn.firedThisTurn`.
 *
 * THE ORDER IS LOAD-BEARING and is the card visit's, unchanged since v14: the
 * fee LANDS first, then `afterVisit` fires, then the action runs.
 *
 *  - the fee first, so a Harvest bought through the wheat board can take the
 *    pile it has just fed (C5) - the one place the order is visible in the rules
 *    rather than only in a hook;
 *  - `afterVisit` before the action, so O16 The Fruit Store and A17 The Smoke
 *    Pot fire off a play with no host at all (C8), which is what `host: null` on
 *    that hook is for. W17 The Pie Shop compares the host to its own seat and
 *    can never match, so it is dead under the commons exactly as C8 says.
 *
 * ⛔ `afterPlacement` IS NOT FIRED (C8). A central board is not a building, so
 * A16 The Beekeeper's Veil does not see a play - `fx.playOnCommons` is a
 * separate primitive from `fx.placeOnBuilding` for that reason alone.
 *
 * ⚠️ AND UNDER DEAN'S UNCLAIMED-BOARDS VARIANT THAT MAKES AN ASYMMETRY WORTH
 * FLAGGING RATHER THAN FIXING (11/09/2026): the same bonus slot fires A16 when
 * the card lands on a RIVAL's board (`doNoticeBoardVisit` places it through
 * `fx.placeOnBuilding`) and does not when it lands on a CENTRAL one. It is the
 * physical truth - a central board is in nobody's tableau and A21 The Wax Hall
 * cannot count it either - and it follows from S16's two rulings rather than
 * contradicting them, but it does mean A16 quietly prefers cross-table plays.
 * That is a CARD reading for Dean and a number for the pass to take, not an
 * engine choice to make here.
 *
 * Every predicate the enumerator checked is re-checked here, because a
 * re-validation must ask what the move NEEDS and never trust the window the
 * caller consumed.
 */
export function doCommons(fx: Fx, seat: Seat, board: Suit, fee: CardId, fee2?: CardId): void {
  const { data, state } = fx;
  // ⭐ TWO GAMES, ONE MOVE (11/09/2026). Under Dean's unclaimed-boards variant
  // a play onto an ownerless board is this same `commons` move; what differs is
  // what it BUYS (the board's printed S12 power rather than the plain door
  // action) and that S9's one-use-per-board latch applies to it.
  const variant = unclaimedCentre(data);
  if (!hasCentre(data)) {
    throw new Error(
      'There is no centre unless rules.turn.visitCurrency is commons, or is ' +
        'noticeBoardPower with rules.economy.unclaimedBoardsToCentre',
    );
  }
  if (!bonusOpen(data, state, 'commons')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  if (!player(state, seat).hand.includes(fee)) {
    throw new Error(`Card ${fee} is not in seat ${seat}'s hand`);
  }
  const knobs = commonsKnobs(data);
  const pile = commonsBoards(state)[board];
  // ⚠️ UNDER THE VARIANT THIS IS ALSO THE "IS THAT BOARD OWNED?" CHECK, and it
  // has to be: a colour with no key in the zone is a colour some SEAT is
  // farming, whose board is a building in their tableau and is reached by the
  // `visit` move instead. A missing key is never an empty pile here.
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  // S9, ONE USE PER BOARD PER TURN, shared with `doNoticeBoardVisit` through
  // `turn.firedThisTurn`. Thrown here and FILTERED in the enumerator, which is
  // this file's standing division of labour.
  const boardCard = commonsBoardCard(data, board);
  if (variant && state.turn.firedThisTurn.includes(boardCard)) {
    throw new Error(`${boardCard} has already been used this turn`);
  }
  if (variant && fee2 !== undefined) {
    throw new Error('There is no wild pair under rules.economy.unclaimedBoardsToCentre');
  }
  if (knobs.threshold !== null && pile.length >= knobs.threshold) {
    throw new Error(`The ${board} board is at its threshold of ${knobs.threshold}`);
  }
  // ⭐ THE WILD PAIR (K3, 10/09/2026): two cards of ANY colours in place of one
  // card of the board's colour, both landing on the pile. Everything the
  // enumerator checked is re-checked here, on the file's standing discipline -
  // a re-validation asks what the move NEEDS and never trusts the window the
  // caller consumed - and the colour gate is the one predicate the pair
  // REPLACES rather than adds to, which is exactly what the pair is.
  if (fee2 !== undefined) {
    if (!knobs.colourMatch || !commonsWildPair(data)) {
      throw new Error(
        'A second fee is a wild pair and needs both commonsColourMatch and commonsWildPair',
      );
    }
    if (fee2 === fee) throw new Error('A wild pair is two DIFFERENT cards');
    if (!player(state, seat).hand.includes(fee2)) {
      throw new Error(`Card ${fee2} is not in seat ${seat}'s hand`);
    }
  } else if (knobs.colourMatch && cardById(data, fee).suit !== board) {
    throw new Error(`The ${board} board takes a ${board} card under commonsColourMatch`);
  }
  if (!commonsActionLegal(data, state, seat, board, fee, fee2)) {
    throw new Error(`The ${board} board has nothing legal to do for seat ${seat}`);
  }

  // ⭐ ONE `commonsPlayed` PER CARD, which is builder's choice and is recorded
  // as one: `fx.playOnCommons` is called twice for a pair, so `pileSize` is
  // right on each event and the count of cards ENTERING the centre is simply
  // the number of `commonsPlayed` events - never a field somebody has to
  // remember to add. That keeps a18's conservation identity (in = discarded by
  // takes + stranded) exact arithmetic rather than a special case, and it keeps
  // the fee-suit mix reading one row per card, which is what the pair is FOR
  // (two junk cards instead of one matching one, L5).
  //
  // ⚠️ IT ALSO MEANS PLAYS PER TURN AND CARDS INTO THE CENTRE STOP BEING THE
  // SAME NUMBER under this arm, exactly as A Helping Hand made plays per turn
  // and the share of turns that used the slot stop being the same number on
  // 09/09/2026 - which cost a re-run. a17 counts TURNS, a18 counts CARDS, and
  // under the pair one bonus can put two cards in.
  fx.playOnCommons(seat, board, fee);
  if (fee2 !== undefined) fx.playOnCommons(seat, board, fee2);
  state.turn.bonusUsed.push('commons');
  fireHook(fx, 'afterVisit', { visitor: seat, host: null, self: false, board });
  if (!variant) {
    performDoorAction(fx, seat, board, 'commons');
    return;
  }
  // ⭐ AND UNDER DEAN'S UNCLAIMED-BOARDS VARIANT THE BOARD GRANTS ITS PRINTED
  // POWER, NOT THE PLAIN DOOR ACTION (manager's ruling, 11/09/2026, on Dean's
  // standing principle of no rules exceptions). O3 is O3 wherever it sits, so a
  // central Orchard board is *Draw 4* and a central Apiary board *Sows 2 from
  // your hand onto your buildings* - never the commons' Draw 2 and never its
  // GROW substitution. This is the line that makes a centre worth what a rival's
  // board is worth, which is the headline risk the overlay names: a central
  // board is SOCIALLY FREE and a rival's is not, so if the two also differed in
  // POWER the comparison would be measuring two things at once.
  //
  // ⛔ THE LATCH IS SET HERE AND NOT INSIDE THE POWER, exactly as
  // `doNoticeBoardVisit` sets it, so both halves of the slot write the same
  // list and A Helping Hand's second play is forced onto a different board.
  markFiredOnTurn(state.turn, boardCard);
  // ⭐ `doorUsed` IS EMITTED HERE RATHER THAN INSIDE THE POWER, on D4's
  // reasoning and word for word as the visit does it: action inflation (a16)
  // and the door mix (a07) count a bought action off one field and must count
  // this exactly as they counted a commons play, so `via` stays `'commons'`.
  // ⚠️ THE ROSTER'S PRINTED ACTION AND NOT `doorActionOf`, for the visit
  // branch's reason and one of this variant's own: `doorActionForSuit`
  // substitutes the Apiary GROW only while `isCommons` is true, which it is not
  // here, so the two agree - and reading it off the override would widen a
  // field typed `WorkerAction` to `DoorAction` for a sixth value this mode can
  // never produce.
  const action = doorOf(data, board).action;
  fx.emit({ e: 'doorUsed', seat, colour: board, action, via: 'commons' });
  fireNoticeBoardPower(fx, seat, board, {
    src: null,
    deliverLegal: doorActionLegal(data, state, seat, 'deliver'),
  });
  fireHook(fx, 'afterWork', { actor: seat, colour: board, action, via: 'commons' });
}

export type CommonsTakeOption = Extract<Move, { type: 'commonsTake' }>;

/**
 * ⭐ DEAN'S VARIANTS' SHARED MOVE (`rules.turn.commonsTake: 'bonus'`, `'spend'`
 * or `'paid'`, 09/09/2026, and `'coins'`, 10/09/2026): every legal
 * `commonsTake` move, one per central pile this seat may legally take right now
 * (or, under `'paid'`, one per (pile, fee card) pair).
 *
 * Never producible under the shipped `'harvest'` rule - `enumerateCommonsTake`
 * checks the knob first, exactly as `enumerateCommons` checks `isCommons`
 * first, so the two enumerators fail closed the same way. Under `'bonus'`
 * every non-empty pile qualifies; under `'spend'` a board also has to have
 * something for its action to do (D-S3), which is `commonsSpendTakeLegal`;
 * under `'paid'` a board qualifies whenever it is non-empty AND the seat has
 * at least one card in hand to pay with (D-P1's other half - see
 * `enumerateCommonsTake`); under `'coins'` (K3/K5) every non-empty pile
 * qualifies and nothing else is asked, because a coin take buys no action.
 */
export function commonsTakeOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
): CommonsTakeOption[] {
  const out: CommonsTakeOption[] = [];
  enumerateCommonsTake(data, state, seat, out);
  return out;
}

/** Is ANY commonsTake on offer? The same walk, stopping at the first hit. */
export function anyCommonsTakeOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateCommonsTake(data, state, seat, null);
}

/**
 * The one walk behind both, exactly as `enumerateCommons` is for the play:
 * `out === null` means "stop at the first legal take".
 *
 * ⭐ UNDER `'paid'` (09/09/2026) THE SHAPE CHANGES: `enumerateCommons` walks
 * (board, fee) pairs because a commons PLAY needs a fee card, and a paid take
 * now needs one too, so this branch walks the same product - one move per
 * non-empty board per card in hand. The fee can never be one of the taken
 * cards: it comes out of the hand, the taken cards come out of the pile, and
 * the two pools never overlap.
 */
function enumerateCommonsTake(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: CommonsTakeOption[] | null,
): boolean {
  const toHand = isCommonsTakeToHand(data);
  const toSpend = isCommonsTakeToSpend(data);
  const toPaid = isCommonsTakePaid(data);
  // ⭐ THE COIN TAKE (K3 second half / K8, Dean 10/09/2026): "discard every card
  // on one central pile and take one coin per card". It needs NO branch of its
  // own down the walk - no fee to choose (unlike 'paid') and no per-board
  // legality to ask (unlike 'spend', whose action has to have something to do,
  // D-S3) - because a coin take buys no action at all. So it is one more term
  // in the fail-closed guard and one more mode the plain loop below serves, and
  // K5's "not offered on an empty pile" is the loop's own existing check.
  const toCoins = isCommonsTakeCoins(data);
  // ⚠️ `isCommons` AND NOT `hasCentre`, DELIBERATELY (11/09/2026). Dean's
  // unclaimed-boards variant pins `commonsTake: 'harvest'` by name, so all four
  // flags above are false there and this would fail closed anyway; the narrow
  // predicate is kept because the four take VARIANTS are rules of the commons
  // and were each ruled against a centre of five ownerless boards. Pairing one
  // of them with a centre of two would be a new design rather than a knob, and
  // it is `hasCentre` here that would make it look like a knob.
  if (!isCommons(data) || (!toHand && !toSpend && !toPaid && !toCoins)) return false;
  if (!bonusOpen(data, state, 'commonsTake')) return false;
  const boards = commonsBoards(state);
  let any = false;
  if (toPaid) {
    const hand = player(state, seat).hand;
    if (hand.length === 0) return false;
    for (const board of data.cards.suits) {
      if ((boards[board]?.length ?? 0) === 0) continue;
      for (const fee of hand) {
        if (out === null) return true;
        out.push({ type: 'commonsTake', seat, board, fee });
        any = true;
      }
    }
    return any;
  }
  for (const board of data.cards.suits) {
    if ((boards[board]?.length ?? 0) === 0) continue;
    if (toSpend && !commonsSpendTakeLegal(data, state, seat, board)) continue;
    if (out === null) return true;
    out.push({ type: 'commonsTake', seat, board });
    any = true;
  }
  return any;
}

/**
 * ⭐ DEAN'S 'spend' VARIANT'S LEGALITY (D-S3, 09/09/2026): "a door that can do
 * nothing is not offered", the standing ruling, read per board. Orchard and
 * wheat are the uncomplicated whole-pile legs and are legal whenever their
 * pile is non-empty (already checked by the caller); dairy, vegetable and
 * apiary each ask whether their action has anything to do.
 */
function commonsSpendTakeLegal(data: GameData, state: GameState, seat: Seat, board: Suit): boolean {
  switch (board) {
    case 'orchard':
    case 'wheat':
      return true;
    case 'dairy':
      return anyCommonsSpendBuildOption(data, state, seat, board);
    case 'vegetable':
      return anyCommonsSpendDeliverOption(data, state, seat, board);
    case 'apiary':
      return player(state, seat).tableau.some((b) => canTakeCard(data, b));
    default:
      return board satisfies never;
  }
}

/**
 * ⭐ DEAN'S VARIANTS' TAKE, DISPATCHED BY commonsTake: take the whole of one
 * central pile. Under `'bonus'` and `'paid'` it always goes straight to hand
 * (`Fx.takeCommons`); under `'spend'` its fate depends on `board` -
 * `doCommonsSpendTake` is where the five legs live; under `'coins'` (K3/K8,
 * 10/09/2026) it goes to the suits' DISCARDS and pays one coin per card, which
 * is the one value where the pile leaves the game rather than reaching anybody.
 *
 * Every predicate the enumerator checked is re-checked here, on the same
 * discipline `doCommons` follows. `fee` is read only under `'paid'`, where it
 * is required; it is ignored (and should be `undefined`, as `legalMoves`
 * never sets it) under the other three.
 */
export function doCommonsTake(fx: Fx, seat: Seat, board: Suit, fee?: CardId): void {
  const { data, state } = fx;
  const toHand = isCommonsTakeToHand(data);
  const toSpend = isCommonsTakeToSpend(data);
  const toPaid = isCommonsTakePaid(data);
  const toCoins = isCommonsTakeCoins(data);
  if (!isCommons(data) || (!toHand && !toSpend && !toPaid && !toCoins)) {
    throw new Error(
      "commonsTake is legal only under rules.turn.commonsTake: 'bonus', 'spend', 'paid' or 'coins'",
    );
  }
  if (!bonusOpen(data, state, 'commonsTake')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  if (pile.length === 0) throw new Error(`The ${board} board is empty`);

  if (toCoins) {
    // ⭐ THE MINT (K3/K8, Dean 10/09/2026): NO FEE IS PAID, so `fee` is ignored
    // here exactly as it is under 'bonus' and 'spend' - `legalMoves` never sets
    // it under this value. The pile goes to its cards' OWN suits' discard piles
    // (a pile holds any colours, and the wild pair puts two of any colours on
    // one board) and the taker is paid one coin per card. Marked spent BEFORE
    // the resolution, on the same rule `'spend'` states: the slot goes the
    // moment the board is chosen.
    state.turn.bonusUsed.push('commonsTake');
    fx.clearCommonsForCoins(seat, board);
    return;
  }

  if (toPaid) {
    if (fee === undefined) {
      throw new Error("commonsTake needs a fee card under rules.turn.commonsTake: 'paid'");
    }
    if (!player(state, seat).hand.includes(fee)) {
      throw new Error(`Card ${fee} is not in seat ${seat}'s hand`);
    }
    // ⭐ DEAN'S 'paid' VARIANT (09/09/2026): the fee is discarded FIRST, to its
    // OWN suit's discard pile - "the card you pay goes to the discard pile",
    // never onto the pile it is paying to take and never boxed. Only once it
    // is gone does the pile move, so the fee can never be counted among the
    // cards taken.
    fx.discardFromHand(seat, fee);
    fx.takeCommons(seat, board, fee);
    state.turn.bonusUsed.push('commonsTake');
    return;
  }

  if (toSpend) {
    if (!commonsSpendTakeLegal(data, state, seat, board)) {
      throw new Error(`The ${board} board has nothing legal to take right now`);
    }
    // Marked BEFORE the resolution, exactly as `doCommons` marks `'commons'`
    // before `performDoorAction` pushes its task: the slot is spent the
    // moment the board is chosen, not when its (possibly multi-step)
    // resolution finishes.
    state.turn.bonusUsed.push('commonsTake');
    doCommonsSpendTake(fx, seat, board);
    return;
  }

  fx.takeCommons(seat, board);
  state.turn.bonusUsed.push('commonsTake');
}

// --- Dean's 'spend' variant (09/09/2026, commonsTake: 'spend') -------------
//
// One pile, five fates, dispatched by board (C3's door table): orchard to
// hand, wheat to barn (both uncomplicated whole-pile moves, resolved inline),
// dairy/vegetable/apiary each a multi-step choice resolved through its own
// task. See `CommonsTake` in @gp/data for Dean's words and the four builder
// defaults D-S1 to D-S4.

/** How many cards of each suit sit on a central pile - the payment pool for the dairy and vegetable legs. */
function pileTally(data: GameData, pile: readonly CardId[]): Partial<Record<Suit, number>> {
  const tally: Partial<Record<Suit, number>> = {};
  for (const id of pile) {
    const suit = cardById(data, id).suit;
    tally[suit] = (tally[suit] ?? 0) + 1;
  }
  return tally;
}

function doCommonsSpendTake(fx: Fx, seat: Seat, board: Suit): void {
  switch (board) {
    case 'orchard': {
      const taken = commonsBoards(fx.state)[board]?.length ?? 0;
      fx.takeCommons(seat, board);
      fx.emit({
        e: 'commonsSpent',
        seat,
        board,
        taken,
        used: taken,
        discarded: 0,
        deliveredFromCentre: false,
      });
      return;
    }
    case 'wheat': {
      const taken = commonsBoards(fx.state)[board]?.length ?? 0;
      fx.takeCommonsToBarn(seat, board);
      fx.emit({
        e: 'commonsSpent',
        seat,
        board,
        taken,
        used: taken,
        discarded: 0,
        deliveredFromCentre: false,
      });
      return;
    }
    case 'dairy':
      fx.pushTask({ t: 'commonsSpendBuild', pid: seat, src: null, board });
      return;
    case 'vegetable':
      fx.pushTask({ t: 'commonsSpendDeliver', pid: seat, src: null, board });
      return;
    case 'apiary': {
      const cards = fx.clearCommonsPile(board);
      fx.pushTask({
        t: 'commonsSpendSow',
        pid: seat,
        src: null,
        board,
        cards,
        taken: cards.length,
        used: 0,
        discarded: 0,
      });
      return;
    }
    default:
      board satisfies never;
  }
}

/**
 * ⭐ THE DAIRY LEG'S PAYMENTS (D-S1): every (hand card, pile payment) pair,
 * reusing `paymentsFor` exactly as `paymentOptions` does for D10's revealed
 * deck top - the built card is priced against the pile as its payment pool
 * instead of the hand, with no stacks and no meeples (there are none under
 * the commons, C6), so the default `fills`/`supply`/`place` arguments already
 * say the right thing.
 */
export function commonsSpendBuildOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): { card: CardId; payment: CardId[] }[] {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return [];
  const hand = player(state, seat).hand;
  const out: { card: CardId; payment: CardId[] }[] = [];
  for (const id of hand) {
    const price = priceOf(data, id, {});
    if (!price) continue;
    for (const option of paymentsFor(data, id, pile, [], price)) {
      out.push({ card: option.card, payment: option.payment });
    }
  }
  return out;
}

export function anyCommonsSpendBuildOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return false;
  const hand = player(state, seat).hand;
  return hand.some((id) => {
    const price = priceOf(data, id, {});
    if (!price) return false;
    return paymentsFor(data, id, pile, [], price).length > 0;
  });
}

/**
 * ⭐ THE DAIRY LEG'S RESOLUTION: build ONE card from hand, paid FROM THE PILE
 * ONLY. `payment` is validated against `board`'s pile exactly as `doBuild`
 * validates a hand payment - same cost arithmetic, same own-suit minimum -
 * and then taken out of the pile rather than the hand. Whatever the pile does
 * not use is discarded (D-S2), the payment itself included, on the SAME
 * divert seam a normal build payment uses (so O17's "put a spent card in your
 * barn instead" still fires here).
 */
export function doCommonsSpendBuild(
  fx: Fx,
  seat: Seat,
  board: Suit,
  card: CardId,
  payment: readonly CardId[],
): void {
  const { data, state } = fx;
  const p = player(state, seat);
  if (!p.hand.includes(card)) throw new Error(`${card} is not in seat ${seat}'s hand`);
  const price = priceOf(data, card, {});
  if (!price) throw new Error(`${card} has no build cost`);
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  if (payment.includes(card)) throw new Error(`${card} cannot pay for itself`);
  if (new Set(payment).size !== payment.length) throw new Error('Duplicate payment card');
  for (const id of payment) {
    if (!pile.includes(id)) throw new Error(`${id} is not on the ${board} pile`);
  }
  if (payment.length !== price.cardsNeeded) {
    throw new Error(`${card} costs ${price.cardsNeeded} cards, got ${payment.length}`);
  }
  const suit = cardById(data, card).suit;
  const own = payment.filter((id) => cardById(data, id).suit === suit).length;
  if (own < price.ownSuitMin) {
    throw new Error(`${card} needs ${price.ownSuitMin} ${suit} cards in payment`);
  }

  fx.removeFromHand(seat, card);
  fx.takeFromCommonsPile(board, payment);
  divertOrDiscard(fx, seat, [...payment]);
  const leftover = fx.clearCommonsPile(board);
  fx.discard(leftover);
  placeBuilt(fx, seat, card, [...payment], null);
  fx.emit({
    e: 'commonsSpent',
    seat,
    board,
    taken: payment.length + leftover.length,
    used: payment.length,
    discarded: leftover.length,
    deliveredFromCentre: false,
  });
}

/**
 * ⭐ THE VEGETABLE LEG'S CRATES (D-S1): every (tile, spend) pair payable out
 * of `board`'s pile, read as a tally exactly as a barn would be - the wild
 * substitution (`substitutedSpends`) and the demand machinery
 * (`deliverDemands`/`namedDemand`) neither know nor care which pool they are
 * reading. There are no meeples under the commons (C6), so this is the plain
 * card arithmetic `deliverOptions` runs before R15 ever joins it.
 */
export function commonsSpendDeliverOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
  /** Stop after this many. `anyCommonsSpendDeliverOption` passes 1. */
  limit: number = Infinity,
): { tile: string; spend: Partial<Record<Suit, number>> }[] {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return [];
  const tally = pileTally(data, pile);
  const demands = deliverDemands(data, state, seat);
  const fillerSuits = [
    ...state.suitsInPlay,
    ...data.cards.suits.filter((x) => !state.suitsInPlay.includes(x)),
  ];
  const out: { tile: string; spend: Partial<Record<Suit, number>> }[] = [];
  const seen = new Set<string>();
  demandLoop: for (const demand of demands) {
    const affordable = (Object.entries(demand.spend) as [Suit, number][]).every(
      ([s, n]) => (tally[s] ?? 0) >= n,
    );
    const spends = affordable
      ? [demand.spend]
      : substitutedSpends(data, fillerSuits, demand.spend, tally);
    for (const spend of spends) {
      const key = spendKey(demand.tile, spend);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tile: demand.tile, spend });
      if (out.length >= limit) break demandLoop;
    }
  }
  return out;
}

export function anyCommonsSpendDeliverOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  return commonsSpendDeliverOptions(data, state, seat, board, 1).length > 0;
}

/**
 * ⭐ THE VEGETABLE LEG'S RESOLUTION: deliver ONE crate to `tileId`, paid FROM
 * THE PILE ONLY. Validated against the same wild-substitution arithmetic
 * `doDeliver` uses; the specific cards are then picked off the pile (deepest
 * first is not a rule - any matching cards will do, since barn identity is
 * inert the same way `spendFromBarn`'s is) and discarded, exactly what a barn
 * payment's cards would have done. Scores through the shared `finishDelivery`
 * tail, so a pile-paid crate reads on the board exactly as a barn-paid one
 * does. Unused pile cards are discarded (D-S2); nothing reaches the barn.
 */
export function doCommonsSpendDeliver(
  fx: Fx,
  seat: Seat,
  board: Suit,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
): void {
  const { data, state } = fx;
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  const tile = state.island.tiles.find((t) => t.tile === tileId);
  if (!tile) throw new Error(`Tile ${tileId} is not in play`);
  if (!tileHasRoom(data, tile)) throw new Error(`Tile ${tileId} has no delivery slots left`);

  const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
  const rate = data.island.cardsPerSubstitution;
  const paid = tallyTotal(spend);
  const legal = wildFills(data.cards.suits, wilds).some((fill) => {
    const need: Partial<Record<Suit, number>> = { ...base };
    for (const s of fill) need[s] = (need[s] ?? 0) + cardsPerCrate;
    const matched = matchedAgainst(need, spend);
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

  const used: CardId[] = [];
  for (const [suit, count] of Object.entries(spend) as [Suit, number][]) {
    let taken = 0;
    for (let i = pile.length - 1; i >= 0 && taken < count; i--) {
      if (cardById(data, pile[i] as CardId).suit === suit) {
        used.push(...pile.splice(i, 1));
        taken += 1;
      }
    }
    if (taken < count) throw new Error(`The ${board} pile has no ${suit} card left to spend`);
  }
  const leftover = fx.clearCommonsPile(board);
  fx.discard(used);
  finishDelivery(fx, seat, tile, tileId, spend, used, 1);
  fx.discard(leftover);
  fx.emit({
    e: 'commonsSpent',
    seat,
    board,
    taken: used.length + leftover.length,
    used: used.length,
    discarded: leftover.length,
    deliveredFromCentre: true,
  });
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
  // Two options under either control and never four: `bonusDrawOpen` is false
  // under the meeple arm and `collectOpen` is false under the card game, so the
  // pair on offer is (Draw 1 | visit) or (Collect | visit).
  //
  // ⭐ AND EXACTLY ONE UNDER THE TWO NEWEST DESIGNS. The commons offers the
  // central play alone (C9), and the notice-board visit offers the visit alone
  // (S5) - `bonusDrawOpen` closes under both, and `collectOpen` has no meeples
  // to collect - so the disjunction below is one live term in each.
  return (
    bonusDrawOpen(data, state) ||
    collectOpen(data, state, seat) ||
    anyVisitOption(data, state, seat) ||
    anyCommonsOption(data, state, seat) ||
    anyCommonsTakeOption(data, state, seat)
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
 *
 * ⭐ `board` IS WHICH OF THE HOST'S NOTICE BOARDS THE FEE LANDS ON, and it is
 * present only where a host has more than one to choose between - Dean's
 * two-board fix at two seats (11/09/2026). It is a spend in the strict sense:
 * it names the building the payment goes to, so it belongs here beside the fee
 * rather than beside the payoff.
 */
export type VisitSpend = Pick<VisitOption, 'fee' | 'meeples' | 'colour' | 'toll' | 'board'>;

export function doVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  if (isMeepleCurrency(fx.data)) {
    doMeepleVisit(fx, visitor, host, spend);
    return;
  }
  if (isNoticeBoardPower(fx.data)) {
    doNoticeBoardVisit(fx, visitor, host, spend);
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
 * ⭐ S17, THE HOST DRAW: **WHEN A NEIGHBOUR VISITS YOU, YOU DRAW 1 CARD.**
 * (Dean, ruled 11/09/2026, `rules.turn.hostDrawOnVisit`.)
 *
 * ⭐ ITS PROVENANCE IS A TABLE AND NOT A SIMULATION, which is rare enough in
 * this project to be the first thing recorded about it. Dean played the
 * two-board arm at a two-player table on 11/09/2026, house-ruled this in during
 * the session, and reported that the visiting worked well, that everyone
 * visited, that every Notice Board was used at some stage, and that "the rule
 * that the person who gets visited draws a card led to a lot of extra cards in
 * play, which relieved the tightness of the game in a useful way".
 *
 * ⛔ **IT AMENDS S7** (`docs/notice-board-visit-handoff-2026-09-10-v2.md`),
 * which said in as many words that the fee resting on the host's board "is the
 * payment and there is no other". There is now one other and it is paid
 * INSTANTLY: the host is paid twice, once in a card drawn now and once in
 * material they must still harvest and then deliver. Do not quote S7 forward
 * without S17 beside it.
 *
 * ⛔ **THE DRAW GOES TO THE HOST, WHO IS NOT THE ACTIVE PLAYER**, and that is
 * the one bug this rule can have. It is the same class of mistake as the
 * power-firing-for-the-visitor orientation twenty lines below: the visitor is
 * paid in the POWER, the host in the CARD, and swapping them turns a payment to
 * the giver into a second payment to the taker. A self-visit would hide it,
 * which is one of two reasons the guard below exists.
 *
 * ⛔ **AND A SELF-VISIT NEVER PAYS IT.** `selfVisitAllowed` is false on every
 * arm this rule is measured under, so the guard is unreachable there, and it is
 * written anyway because the reason is a rule rather than a configuration: a
 * card drawn for visiting yourself is a pure faucet with no giver, minted by
 * nobody, and the standing ban on RESTOCK was exactly a ban on that shape. The
 * knob is an integer and `'card'`-currency overlays can put self-visiting back
 * on the table, so the guard is the thing that stops the two ever meeting.
 *
 * ⭐ **THE HOST DRAWS FROM ANY DECK IN PLAY, EXACTLY AS EVERY OTHER DRAW IN
 * THIS GAME DOES** (Dean's standing principle of no rules exceptions). So this
 * pushes the ordinary see-N/keep-N draw TASK, whose answers are deck picks -
 * the same machinery as the plain Draw action, the bonus Draw and W17's - and
 * the host makes the choice themselves in the middle of the visitor's turn,
 * which W17 The Pie Shop has done since 04/09/2026. It is NOT `autoDraw`:
 * `autoDraw` prefers the seat's own suit, fires no draw reactors, and would be
 * a sixth kind of draw invented for one rule.
 *
 * ⛔ **AND IT DRAWS `hostDrawOnVisit` CARDS AND NEVER `baseDraw`'s.** The plain
 * Draw action is see 2 / KEEP 2 since v31, so reusing `doDraw` would hand the
 * host TWO cards where the knob asks for one - the trap the overlay names by
 * name. `see` and `keep` are both the knob. ⛔ And `rules.turn.bonusDraw` is
 * NOT this number: it is 1, it is the v31 standalone free Draw 1 deleted on
 * 04/09/2026, it is subjectless under this currency, and a stray read of it
 * would look right and be wrong.
 *
 * ⚠️ **ONCE PER VISIT AND NOT ONCE PER TURN**, which is the second engine
 * ruling the overlay left owed. At two seats the single rival holds two boards,
 * so A Helping Hand can send a SECOND visit to the same owner in one turn and
 * they are paid for both - because they also receive two fee cards, and the
 * payment is for the fee rather than for the turn. There is deliberately no
 * latch on `turn.firedThisTurn` here: a latch belongs to a CARD's text (the
 * standing rule of 11/08/2026 that no card's text fires twice in a turn) and
 * this is a rule of the game.
 *
 * ⚠️ **W17 THE PIE SHOP IS NOW A DUPLICATE OF THIS RULE IN WORDS** ("Whenever a
 * neighbour visits you, Draw 1") **AND THE TWO STACK: A W17 OWNER VISITED ONCE
 * DRAWS TWO.** That is deliberate rather than emergent - the card is a card and
 * the rule is a rule, they are pushed as two separate tasks, and nothing here
 * suppresses either. It is also ASYMMETRIC in a way worth knowing before the
 * retext: W17 carries a once-a-turn latch and this rule does not, so a W17
 * owner visited twice in one turn draws THREE and not four. ⛔ The retext is a
 * SHEET decision Dean has not made, so no card changes in this pass; when he
 * makes it, this note is the reading it needs.
 *
 * It degrades gracefully with the table: a draw task with no drawable deck has
 * no legal answer and `drainTasks` drops it, so a dry table pays nothing rather
 * than throwing. The `drawableSuits` check below is the same statement made
 * early, so that no empty task is ever pushed at all.
 */
function payHostDrawOnVisit(fx: Fx, visitor: Seat, host: Seat): void {
  // ⛔ A SELF-VISIT NEVER PAYS IT: a faucet with no giver. See the block above.
  if (visitor === host) return;
  const n = hostDrawOnVisit(fx.data);
  if (n <= 0) return;
  // ⭐ THE CORRECTNESS GATE IN ONE LINE: at the shipped 0 nothing is pushed, no
  // task is created, no rng call is consumed and no event is emitted, so the
  // engine behaves exactly as it did before this rule existed.
  if (drawableSuits(fx.data, fx.state).length === 0) return;
  fx.pushTask({ t: 'draw', pid: host, src: null, see: n, keep: n, revealed: [], via: 'hostDraw' });
}

/**
 * ⛔ THE NOTICE-BOARD VISIT (S5-S11, Dean 10/09/2026), AND THE ONE BUG THIS
 * DESIGN CAN HAVE IS IN THESE TWENTY LINES.
 *
 * **THE POWER FIRES FOR THE VISITOR AND THE CARD LANDS ON THE HOST.** The
 * visitor is paid instantly with the power; the host is paid in material they
 * still have to harvest and deliver, and that is the host's whole payment (S7).
 * Swap the two seats and the design inverts into paying the giver nothing,
 * which is the fault the Lopiano lens names in all seven previous versions of
 * this bonus action - so `fx.placeOnBuilding` is handed `{ seat: host }` and
 * `fireNoticeBoardPower` is handed `visitor`, and those two arguments are the
 * design.
 *
 * ⚠️ A SELF-VISIT HIDES THE MISTAKE, because both seats are the same, which
 * is why the test for it is written at THREE seats and asserts all four halves
 * separately: the host's board gained the card, the host's HAND did not move,
 * the visitor's hand lost the card, and the visitor got the payoff.
 *
 * The ORDER is the v31 branch's, unchanged and load-bearing: the fee LANDS
 * first, then `afterVisit` fires host-side, then the power runs. So a host-side
 * reactor (W17 The Pie Shop, alive again now that there is a host) sees the
 * card on the board, and A16 The Beekeeper's Veil sees the placement that
 * brought the board to two - which is S16's second ruling and falls out of
 * `placeOnBuilding` firing `afterPlacement`, where the commons' `playOnCommons`
 * deliberately did not.
 *
 * ⭐ `doorUsed` IS EMITTED HERE RATHER THAN INSIDE THE POWER, on D4's
 * reasoning: action inflation (a16) and the door mix (a07) count a bought
 * action off one field, and they must count this exactly as they counted a v31
 * visit and a commons play. `via` stays `'visit'`, and the ACTION is the
 * board's own suit verb (`doorActionOf`), which is what each power amplifies -
 * Orchard draw, Dairy build, Wheat harvest, Apiary sow, Vegetable deliver.
 *
 * Every predicate the enumerator applied is re-asked, including S9's latch:
 * a re-validation must ask what the move NEEDS and never trust the window the
 * caller consumed.
 */
function doNoticeBoardVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  const state = fx.state;
  const fee = spend.fee;
  if (fee === null) throw new Error('A visit costs one card from your hand');
  if (spend.meeples !== undefined && spend.meeples.length > 0) {
    throw new Error('There are no meeples under the notice-board visit');
  }
  if (visitor === host && !fx.data.rules.turn.selfVisitAllowed) {
    throw new Error('Self-visiting is switched off');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  // ⭐ WHICH BOARD, AND THE ONE LINE THAT WOULD PUT THE FEE ON THE WRONG
  // BUILDING IF IT WERE WRONG (Dean's two-board fix, 11/09/2026). `spend.board`
  // is the move's own answer and `visitTargetOf` refuses a card that is not one
  // of this host's boards; with the field absent it is the host's own suit's
  // board, which is every game but the two-board arm.
  //
  // ⛔ AND A HOST WITH TWO BOARDS MUST BE TOLD WHICH ONE. Defaulting would
  // silently send every fee to the seat's own suit's board and leave the second
  // one empty for the whole game, which is a wrong answer that no test of the
  // payoff would ever catch - the power would be right, the card would be on
  // the wrong building, and the owner would harvest the same income either way.
  if (spend.board === undefined && noticeBoardsOf(fx.data, state, host).length > 1) {
    throw new Error(`Seat ${host} has more than one Notice Board: the visit must name one`);
  }
  const target = visitTargetOf(fx.data, state, host, spend.board);
  // S9, ONE USE PER BOARD PER TURN. Thrown here and FILTERED in the
  // enumerator, which is this file's standing division of labour.
  if (state.turn.firedThisTurn.includes(target.card)) {
    throw new Error(`${target.card} has already been used this turn`);
  }
  // S8: false for a `3+` board however deep the stack, so this bites only
  // under the `noticeBoardBlocks: true` control.
  if (isFull(fx.data, target)) throw new Error(`${target.card} is full`);
  // ⛔ THE BOARD'S SUIT AND NOT THE HOST'S. They are the same for a seat's own
  // board and differ on every board the two-board fix deals, and this is the
  // line that decides WHICH POWER IS BOUGHT - see the enumerator, which reads
  // the same field for the same reason.
  const colour = cardById(fx.data, target.card).suit;
  if (!noticeBoardPowerLegal(fx.data, state, visitor, colour, { excludingHandCard: fee })) {
    throw new Error(`The ${colour} Notice Board has nothing legal to do for seat ${visitor}`);
  }

  // THE CARD LEAVES THE VISITOR'S HAND AND LANDS ON THE HOST'S BOARD. Read the
  // two seat arguments together: `visitor` is who is paying, `{ seat: host }`
  // is whose building it lands on.
  fx.placeOnBuilding(visitor, { seat: host, card: target.card }, fee);
  state.turn.bonusUsed.push('visit');
  markFiredOnTurn(state.turn, target.card);
  fireHook(fx, 'afterVisit', { visitor, host, self: visitor === host });
  // ⚠️ THE ROSTER'S PRINTED ACTION AND NOT `doorActionOf`. The two agree
  // under this mode - the Apiary re-read to GROW is the commons' and only the
  // commons' (C3) - but `visited.action` is typed `WorkerAction`, the five-door
  // set, and reading it off the override would widen it to `DoorAction` for a
  // sixth value this mode can never produce.
  const action = doorOf(fx.data, colour).action;
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: visitor === host,
    colour,
    action,
  });
  fx.emit({ e: 'doorUsed', seat: visitor, colour, action, via: 'visit' });
  // AND THE POWER FIRES FOR THE VISITOR.
  fireNoticeBoardPower(fx, visitor, colour, {
    src: null,
    deliverLegal: doorActionLegal(fx.data, state, visitor, 'deliver'),
  });
  fireHook(fx, 'afterWork', { actor: visitor, colour, action, via: 'visit' });
  // ⭐ S17 IS PAID LAST, AND THE QUEUE POSITION IS THE WHOLE POINT (the probe
  // truncation defect, found and fixed 11/09/2026).
  //
  // ⛔ **THE DEFECT.** S17 pushes a draw TASK for the HOST in the middle of the
  // VISITOR's turn. Pushed before `fireNoticeBoardPower`, as it was when the
  // rule was first written, it sat at the HEAD of the queue while the visitor's
  // own bought power sat behind it - and `probeAt` in `probe.ts` returns
  // `next: []` and `pending: null` the moment the head task is not the probing
  // seat's own, deliberately, because a rollout may not answer for a rival. So
  // a bot evaluating a visit had its rollout cut before the power it had just
  // paid for was ever walked. Measured over real decisions on the arm against
  // its paired control:
  //
  //     seats   mean rollout value of a visit   probes cut dead   bonus premium
  //     2p      2.358 -> 0.003                  18.9% -> 99.9%    80.6% -> 0.1%
  //     3p      3.367 -> 0.115                   2.4% -> 89.4%    96.4% -> 10.6%
  //     4p      2.806 -> 0.240                  13.3% -> 81.3%    86.4% -> 18.7%
  //
  // A visit cost the bot a card plus the gift to the host and earned, in its
  // books, nothing, so it stopped visiting: every bonus rate, door mix and hook
  // number taken off the arm before this fix describes the defect and not S17.
  //
  // ⭐ **THE FIX, AND THE PRINCIPLE UNDER IT: a visit's rollout must always be
  // able to see what the visitor bought.** The two payments are independent -
  // the visitor is paid in the power, the host in a card off a deck - so the
  // order between them is free, and free order must never be spent on blinding
  // the seat whose turn it is. The visitor's whole purchase is queued first
  // (the power's own tasks, and anything `afterWork` adds), then the host's
  // draw. It is also the more natural table order: nobody waits for the host to
  // pick a deck before the visitor resolves what they just bought.
  //
  // ⛔ **THIS SUPERSEDES THE COMMENT THAT USED TO STAND AT THE OLD CALL SITE**,
  // which argued S17 belonged immediately after `afterVisit` "so that W17 The
  // Pie Shop's task keeps the queue position it has always had". That reasoning
  // was written before the defect was known and it was the wrong trade: it
  // protected a card's queue position at the cost of every bot valuation of the
  // move. ⚠️ **W17's OWN TASK HAS NOT MOVED** - it is still pushed inside
  // `afterVisit`, ahead of the power - so no existing card's behaviour changes
  // and every control arm stays byte-identical. That leaves W17 truncating the
  // rollout of a visit to a W17 owner exactly as it always has (9.9% to 13.4%
  // of probes at three and four seats), which is a REPORTED residue and not an
  // oversight: moving it would move recorded games in the controls too.
  //
  // ⭐ **NOTHING MOVES AT THE SHIPPED 0.** `payHostDrawOnVisit` pushes no task,
  // emits no event and consumes no rng when the knob is 0, so the correctness
  // gate in `notice-board-host-draw.test.ts` - the arm at 0 against
  // `overlays/notice-board-visit-two-boards-v1.overlay.json` - is untouched by
  // where it is called from. It emits no events at any value either, so the
  // EVENT stream of a visit is unchanged and only the task order moves.
  payHostDrawOnVisit(fx, visitor, host);
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
    throw new Error(
      `Seat ${host}'s ${colour} slot costs ${owed} extra meeples, got ${toll.length}`,
    );
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
