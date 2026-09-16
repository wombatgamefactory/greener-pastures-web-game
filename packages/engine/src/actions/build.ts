/**
 * BUILD: cost, the payment enumerator and the funnel.
 *
 * ⚠️ THE WIDEST BRANCHING IN THE GAME IS HERE. `paymentsFor` is C(hand, k) and
 * it is bounded only by `rules.turn.handLimit`. See `subsets` in shared.ts.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import { fireHook } from '../fx.js';
import { cardById, player } from '../query.js';
import type { BuildingState, CardId, GameState, Seat } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import { meepleAsCardGoesToBoard } from '@gp/data';
import type { MeepleFill, ResolvedPlacement } from './meeples.js';
import {
  NO_MEEPLES,
  assertPlacementMatches,
  fillsFor,
  meepleAsCard,
  meepleCount,
  placementsFor,
} from './meeples.js';
import { subsets } from './shared.js';

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
  /** Card count reduction (the Builder's Yard, D4/D9/D11/D12). Waives the own-suit half. */
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

/** How many cards a build actually costs under its modifiers. */
export function priceOf(
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

export function paymentsFor(
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
          const paidBefore = fromStacks + (fill.total - pairs);
          const k = price.cardsNeeded - paidBefore;
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
): {
  payment: CardId[];
  meeples?: Partial<Record<Suit, number>>;
  wildPairs?: number;
}[] {
  const price = priceOf(data, card, mods);
  if (!price) return [];
  // R15 reaches D10 too, because D10 is a BUILD and R15 says build costs. It
  // is the cheapest case in the game - the discount waives the own-suit half -
  // so in practice a meeple only ever pays the wild half here.
  const p = player(state, seat);
  return paymentsFor(
    data,
    card,
    p.hand,
    [],
    price,
    fillsFor(data, state, seat),
    p.meeples,
    null,
  ).map((o) => ({
    payment: o.payment,
    ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
    ...(o.wildPairs === undefined ? {} : { wildPairs: o.wildPairs }),
  }));
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
  /**
   * ⭐ A150 (12/09/2026): did `payment` come out of the HAND? Defaults true,
   * which is every build in the game bar one - `doCommonsSpendBuild` pays out
   * of a central pile and passes false. It travels to the `afterBuild` hook,
   * where O17 The Fruit Basket reads it: the card was restricted to *"a
   * card you discard FROM YOUR HAND"* so that the Village Store's barn
   * exchange (deleted 16/09/2026) could never become a second mint. See the hook field's own comment.
   */
  paymentFromHand = true,
): void {
  player(fx.state, seat).tableau.push({ card, stack: [] });
  fx.emit({ e: 'built', seat, card, payment });
  // `turn.buildSources` used to be recorded here, for D16 The Ledger's
  // once-per-build-SOURCE guard; the Dairy rebalance (2026-08-12) moved the
  // Ledger onto the general `turn.firedThisTurn` rule and the field lost its
  // only reader, so it is gone. `src` still travels to the hook, which is what
  // D5 and D6 read to react to their OWN build.
  //
  // ⭐ D18's count (v42), kept before the hook so a listener reads this build
  // in it. Only the turn player's builds count: "on your turn, you Build".
  if (seat === fx.state.turnPlayer) {
    fx.state.turn.buildsThisTurn = (fx.state.turn.buildsThisTurn ?? 0) + 1;
  }
  fireHook(fx, 'afterBuild', { seat, card, payment, src, fromHand: paymentFromHand });
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
