/**
 * GROW: activate your own building by paying its activation cost into its stack.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { canTakeCard, cardById, drawableSuits, faceOf, player } from '../query.js';
import type { CardId, GameState, Seat } from '../state.js';
import type { GameData, Suit } from '@gp/data';
import { meepleAsCardGoesToBoard } from '@gp/data';
import { meepleAsCard, placementsFor } from './meeples.js';
import { withoutFirst } from './shared.js';

// --- Grow ------------------------------------------------------------------

export interface GrowOption {
  building: CardId;
  /** Null when a meeple paid (R15): nothing is placed. */
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
   * Ask as if this card had already left the hand - a visit FEE, which lands
   * before the action it buys and so cannot also pay for it.
   *
   * It is `workerActionLegal`'s `excludingHandCard` arriving at the one action
   * that had no way to take it, and the gate and the action must be handed the
   * same modifiers or a door is offered and then wedged (see that function's
   * own warning, which cost hours on 19/08/2026).
   */
  excludeHandCard?: CardId;
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
  const hand =
    mods.excludeHandCard === undefined ? p.hand : withoutFirst(p.hand, mods.excludeHandCard);
  const out: GrowOption[] = [];
  const only = mods.onlyBuilding;
  const asCard = meepleAsCard(data);
  const onBoard = meepleAsCardGoesToBoard(data);
  const rate = data.rules.turn.paymentSlotToll;
  for (const b of p.tableau) {
    // Dean's Dairy experiment: one legal target, the building just built.
    if (only !== undefined && b.card !== only) continue;
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

/** One Grow paid off the top of a deck: which building, and which deck pays. */
export interface DeckGrowOption {
  building: CardId;
  suit: Suit;
}

/**
 * ⭐ DEAN'S APIARY RETEXT (14/09/2026, `noticeBoardPower.apiaryPower`): *"Grow
 * a building using the top card of any deck."* Every (building, deck) pair the
 * power could resolve into, and THE ONE LIST BOTH THE GATE AND THE TASK READ, so
 * the board is never offered on a Grow the task could not then answer.
 *
 * The targets are exactly a card-paid Grow's: your own building, never a Notice
 * Board, not already fired this turn, a printed activation type, and ROOM for a
 * card (a card is placed, so a full building is refused and the clog brake
 * stands). The deck must be drawable. Under `wild` false the deck's crop must
 * pay the activation cost ('wild' activation takes any deck), which is the
 * printed Grow rule with the choice of deck standing in for the choice of card.
 *
 * Hand-blind by construction: nothing is paid from the hand.
 */
export function deckGrowOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  wild: boolean,
): DeckGrowOption[] {
  const suits = drawableSuits(data, state);
  if (suits.length === 0) return [];
  const out: DeckGrowOption[] = [];
  for (const b of player(state, seat).tableau) {
    if (cardById(data, b.card).slot === 'noticeboard') continue;
    if (state.turn.firedThisTurn.includes(b.card)) continue;
    const type = faceOf(data, b).activationType;
    if (type === null) continue;
    if (!canTakeCard(data, b)) continue;
    for (const suit of suits) {
      if (wild || type === 'wild' || type === suit) out.push({ building: b.card, suit });
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
