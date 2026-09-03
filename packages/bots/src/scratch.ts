/**
 * The per-decision facts every scoring term wants, derived once.
 *
 * Terms run once per move per decision, so anything that scans the tableau or
 * the island belongs here rather than inside a feature function. The speed
 * budget is 50us per decision (ticket 10) against a mean branching factor of
 * 4-5, and `viewFor` at 31us has already been spent by the driver before a
 * policy is called - so a term that re-derives the island per move is the one
 * thing that could blow it.
 *
 * Everything here reads the VIEW. No GameState, and no engine function that
 * takes one.
 *
 * ## ⛔ THE COIN VALUATION SUBSYSTEM IS GONE (v31, 02/09/2026), AND WHAT IT TAUGHT
 *
 * Three fields and two functions left this file together: `coins`,
 * `coinRunway`, `sinkGap`, `coinNeverDead`, `marketPayability`, and the
 * `coinWorth` / `sinksOf` / `coinsOf` machinery behind them. They were the
 * answer to one question - *what is a coin worth when you may never get to
 * spend it* - and the answer was measured rather than argued, so the reading
 * outlives the rule:
 *
 *   - Nothing in the bot read a seat's balance at all before ticket 40, so a
 *     visit scored a flat 6 at GBP 0 and at GBP 65. Ticket 37 measured **73.3%
 *     of visits taking the coin payoff, 50.9% of those by a seat already
 *     holding GBP 10 or more, and 65.4% of every coin minted never spent on
 *     anything.** The money was being made and then abandoned.
 *   - Pricing a coin by the seat's remaining RUNWAY - the bounded, once-only
 *     things it could still buy from here - fixed that, and exposed a second
 *     fault under it: at `visit: 2` the bots were taking coin visits whose
 *     marginal coin they valued at provably zero in **70.4%** of cases, because
 *     a free slot plus a junk fee still beat leaving the slot unused.
 *   - The standing conclusion, and the reason v31 deleted the currency rather
 *     than re-tuning it: **money is what buys SOLITAIRE in this game.** A visit
 *     was bought with a card and every other bonus option was bought with a
 *     coin, so a coin sink in the bonus slot crowded the visit out all game.
 *
 * ⚠️ THE SAME TRAP IS NOW SET FOR MEEPLES, one shape further on, which is why
 * `meepleWorth` below is an adaptation of `coinWorth` rather than a fresh idea.
 * A meeple is a stored ACTION, it scores nothing at game end, and a meeple
 * whose action this seat can never use is worth exactly zero - the dead coin,
 * in wood. The number the plan asks the sim to watch (`meepleGained` minus
 * `meepleSpent`) is 65.4% wearing a different hat, and a bot that cannot price
 * a meeple will produce it whatever the rules do.
 */

import type { Card, GameData, Suit, WorkerAction } from '@gp/data';
import type { BuildingView, CardId, PlayerView } from '@gp/engine';
import { deliveriesPerTile, doorForSuit } from '@gp/data';

import { magpieTarget } from './magpie.js';

/**
 * Card lookup by id, indexed per GameData.
 *
 * The engine's `cardById` is a linear scan of the 105-card catalogue, which is
 * the right shape for a rules engine that reads a handful of cards per apply.
 * A policy reads one card per card id per scoring term per move - measured at
 * 30-54us a decision against a 50us budget - and the scan was all of it. Keyed
 * on the data object so an overlay run gets its own index and both are
 * collected with the data they describe.
 */
const CARD_INDEX = new WeakMap<GameData, Map<CardId, Card>>();

export function cardIndex(data: GameData): ReadonlyMap<CardId, Card> {
  let index = CARD_INDEX.get(data);
  if (!index) {
    index = new Map(data.cards.catalogue.map((card) => [card.id, card]));
    CARD_INDEX.set(data, index);
  }
  return index;
}

/** Same contract as the engine's `cardById`, including throwing on an unknown id. */
export function cardById(data: GameData, id: CardId): Card {
  const card = cardIndex(data).get(id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  return card;
}

/**
 * A building's printed threshold, or null when it is not a building.
 *
 * This replaces `faceOfView`, which picked between a card's two printed faces.
 * Starters are single-faced since v31, so the pick is a plain card lookup and
 * the CardFace type has left the data package entirely.
 */
export function thresholdOfView(data: GameData, building: BuildingView): number | null {
  return cardById(data, building.card).threshold;
}

/**
 * The crop a building prints - the view's copy of the engine's `cropOf`. A
 * starter prints the generic starting-building icon and belongs to no crop,
 * which is the rule the Farmstead's own scorer reads (deck cards only, so a
 * seat cannot collect a flat 3 for turning up).
 */
export function cropOfView(data: GameData, building: BuildingView): Suit | null {
  const card = cardById(data, building.card);
  return card.type === 'starter' ? null : card.suit;
}

/**
 * What a meeple whose door can do NOTHING for this seat right now is worth,
 * against 1 for one it can use immediately.
 *
 * ⚠️ **THE LEAST defensible NUMBER IN THIS FILE, AND IT IS STATED RATHER THAN
 * BURIED.** It is not zero, because a meeple is spent on a FUTURE turn and
 * almost every door that is dead now (no full building to harvest, nothing the
 * barn can pay for) comes back within a turn or two. It is not 1, because a
 * seat that will plainly never use a colour - the Harvest door with no
 * buildings, the Deliver door with an empty barn and a game about to end -
 * should prefer a colour it can. There is no measurement behind 0.4: it is a
 * guess that says "usually usable later, but worth less than one I can use
 * now", and it is the first thing to sweep if the meeple assertion reads oddly.
 */
export const MEEPLE_LATENT = 0.4;

export interface Scratch {
  readonly data: GameData;
  readonly view: PlayerView;
  readonly mySuit: Suit;
  /**
   * The magpie's mark: the strongest SEATED crop that is not `mySuit` (see
   * `magpie.ts`). Derived for every profile because it costs one array scan,
   * and read only by the `*TargetCrop` terms - which every profile but `magpie`
   * weights at 0, so nothing else changes behaviour because of it.
   */
  readonly targetSuit: Suit | null;
  /**
   * ⭐ THE HAND LIMIT, one global number off `rules.turn.handLimit`, or null when
   * the rule is switched off. Restored 02/09/2026 with the rule itself.
   *
   * It is read from the data rather than off the seat's Barn, and that is the
   * whole shape of the reinstated rule: the limit is the same for everybody and
   * the Barn prints nothing. A per-seat limit would change only this line.
   */
  readonly handLimit: number | null;
  /**
   * Cards this seat could still draw before the end-of-turn discard bites, and
   * `Infinity` when there is no limit.
   *
   * ⚠️ THIS IS THE DIMINISHING RETURN ON DRAWING, and its absence is half of why
   * the limit came back. With no ceiling a card in hand is always worth a card,
   * so the free bonus Draw 1 is never a worse move than it was last turn - and
   * in the v31 run it became strictly dominant and beat a neighbour visit 3:1,
   * which is the hook losing to arithmetic. Every draw-valuing term reads this.
   */
  readonly handRoom: number;
  readonly buildings: ReadonlyMap<CardId, BuildingView>;
  readonly noticeBoard: BuildingView | null;
  /**
   * The crop this seat's FARMSTEAD prints, or null if it somehow has none.
   *
   * ⭐ v31: the Farmstead is an end-game scorer - *"1 VP for each CROP card you
   * have built"* - so this is the crop every build decision has to be measured
   * against. It is read off the card rather than off `mySuit` because printing
   * is the thing the card does: the two cannot differ today (a Farmstead is a
   * starter, so it is only ever in front of the seat that plays its suit) and
   * keying off the card is what keeps that a fact rather than an assumption.
   */
  readonly farmsteadCrop: Suit | null;
  /**
   * Suits a tile with a free receipt space still wants. Wild crates count for
   * every suit in play.
   *
   * It used to be filtered by the per-player level gate, and ticket 53 measured
   * that filter rather than arguing it: gated and ungated were different sets in
   * 32.6% of the decisions offering a deck choice, and 72.4% before the seat held
   * any receipt, yet over 55 stratified games the distinction changed the bot's
   * top move 0 times in 12,208 decisions. The flat island (2026-08-09) deleted
   * the gate, so this is now simply the ungated set - and that measurement is why
   * the deletion could not have moved these terms.
   */
  readonly demandSuits: ReadonlySet<Suit>;
  /**
   * WHAT ONE MEEPLE OF EACH COLOUR IS WORTH TO THIS SEAT, in ACTION UNITS: 1
   * for a door this seat could use right now, `MEEPLE_LATENT` for one it could
   * not, 0 for a colour with no door at all (unreachable in shipped data).
   *
   * ## Why the scale is flat across the five colours
   *
   * Every door grants exactly ONE core action - that is the v31 design's own
   * claim about the bonus slot, *"a door now buys a WHOLE CORE ACTION for one
   * card"* - so the honest base is the same for all five, and the only thing
   * separating them is whether this seat can use it. Inventing a per-action
   * value table here would have been the ticket 40 sin in its purest form: the
   * plan asks the sim to measure the DOOR MIX, and a bot told in advance that a
   * Draw door beats a Sow door would hand that answer back as a measurement.
   *
   * What the flat scale gives up is real and is named here so nobody rediscovers
   * it as a bug: the Orchard door is Draw 3 and the Apiary door is Sow 1 from
   * hand, and the plan says outright that the second is the weakest door on the
   * table. This model cannot see that difference. It sees only that both are
   * usable. If the door mix comes out suspiciously even, suspect this before
   * suspecting the doors.
   *
   * Read through `meepleWorth`, never directly, so the fallback lives in one
   * place.
   */
  readonly meepleWorth: ReadonlyMap<Suit, number>;
}

/**
 * What ONE more meeple of `colour` is worth to this seat, and equally what one
 * leaving costs it - the direct descendant of `coinWorth`, and the same idea:
 * a stored resource is worth what this seat can still turn it into, and nothing
 * at all above that.
 *
 * The two callers are deliberately symmetrical. `meepleGain` credits this when
 * a delivery hands a meeple over; `meepleSpend` charges exactly the same number
 * when one is spent, so a meeple is neither created nor destroyed by the bot's
 * own accounting and the decision to spend one turns entirely on whether the
 * rolled-out action beats the stock. That is the property that keeps the
 * hoarding question honest: raise this and the bots hoard, lower it and they
 * dump, and neither is hidden inside a term.
 */
export function meepleWorth(s: Scratch, colour: Suit): number {
  return s.meepleWorth.get(colour) ?? MEEPLE_LATENT;
}

/**
 * How many of `n` cards leaving this hand actually COST the seat anything.
 *
 * The standing half first, because it decides most cases and a refactor would
 * lose it: a card in hand is not junk waiting to be dumped, it is fuel. It can
 * be built, it can pay a GROW and fire an ability, it can pay a visit. The
 * design says so outright - *"cards are the scarce resource and the master
 * clock"* - and with the currency gone a card is the ONLY thing anything in this
 * game is bought with, so the claim is stronger than when it was written.
 *
 * ⭐ THE HAND-LIMIT EXEMPTION IS BACK WITH THE HAND LIMIT (02/09/2026), and it
 * is Dean's ruling and the whole subtlety: **a card you are over your hand limit
 * with is free**, because the end-of-turn discard is going to take it anyway.
 * Cards above the limit are spent first and cost nothing; only what a seat would
 * otherwise have KEPT is charged. v31 deleted the limit and this exemption went
 * with it, which quietly made every visit fee cost full price at any hand size -
 * so a seat drowning in cards priced a visit exactly as dearly as a seat holding
 * three, and the bots hoarded.
 *
 * The FORCED end-of-turn discard is deliberately not run through here. There is
 * no choice at that seam, so there is nothing to price - `discardJunk` only
 * picks which cards go.
 */
export function handSpendCost(s: Scratch, n: number): number {
  if (n <= 0) return 0;
  const limit = s.handLimit;
  const excess = limit === null ? 0 : Math.max(0, s.view.you.hand.length - limit);
  return Math.max(0, n - excess);
}

function starterSlotOf(card: Card): string | null {
  return card.slot ?? null;
}

/**
 * Can this barn tally pay for this tile? The engine's `anyDeliverOption`
 * arithmetic, re-stated over the view: named crates covered outright, then
 * every crate-sized block of surplus in one suit covers one wild. Demand
 * tokens are dealt from in-play suits only, so one pass over `suits` both
 * checks coverage and counts wild capacity.
 */
function tallyPays(
  suits: readonly Suit[],
  tally: Partial<Record<Suit, number>>,
  base: Partial<Record<Suit, number>>,
  wilds: number,
  per: number,
): boolean {
  let wildCapacity = 0;
  for (const suit of suits) {
    const surplus = (tally[suit] ?? 0) - (base[suit] ?? 0);
    if (surplus < 0) return false;
    wildCapacity += Math.floor(surplus / per);
  }
  return wildCapacity >= wilds;
}

/**
 * A tile's demand, over the view: named crates as cards, plus a count of the
 * crates that will take anything.
 *
 * THE FACE-DOWN TOKENS BELONG HERE (the Vegetable rebuild, 2026-08-09). V6 turns
 * a demand token blank and a blank token accepts any crops at the normal rate,
 * which is exactly what a cornucopia does - so both must count as wild capacity
 * or the bots would keep reading a tile as unpayable after somebody opened it.
 * Mirrors the engine's `namedDemand`, and both readers below go through it so
 * the two cannot learn the rule separately.
 */
function demandOf(
  tile: { crates: readonly (Suit | 'wild')[]; faceDown?: readonly boolean[] },
  per: number,
): { base: Partial<Record<Suit, number>>; wilds: number } {
  const base: Partial<Record<Suit, number>> = {};
  let wilds = 0;
  for (const [i, crate] of tile.crates.entries()) {
    if (crate === 'wild' || tile.faceDown?.[i] === true) wilds += 1;
    else base[crate] = (base[crate] ?? 0) + per;
  }
  return { base, wilds };
}

/** Could this seat pay for ANY tile with a free receipt space, out of its barn? */
function canDeliverNow(data: GameData, view: PlayerView): boolean {
  const per = data.island.tileRule.cardsPerCrate;
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= deliveriesPerTile(data)) continue;
    const { base, wilds } = demandOf(tile, per);
    if (tallyPays(view.suitsInPlay, view.you.barn, base, wilds, per)) return true;
  }
  return false;
}

/** Two differing barn suits and a balloon that is not already on your Aerodrome. */
function canMoveBalloonNow(view: PlayerView): boolean {
  if (view.aerodrome === null) return false;
  if (!view.aerodrome.balloons.some((b) => b.at !== view.seat)) return false;
  let suits = 0;
  for (const count of Object.values(view.you.barn)) if ((count ?? 0) > 0) suits += 1;
  return suits >= 2;
}

/**
 * Is this door's action legal for this seat right now? The view's approximation
 * of the engine's `workerActionLegal`, which is what gates both routes to a
 * door - a visit and a meeple.
 *
 * ⚠️ IT IS AN APPROXIMATION AND THE BUILD BRANCH IS WHERE IT IS LOOSEST. The
 * engine asks `anyBuildOption`, a real affordability scan over the hand against
 * every card in it; this asks only whether the hand is non-empty, because the
 * scan needs the crop requirements of every held card and is far too heavy for
 * a per-decision derivation. The error is one-directional - this says yes where
 * the engine would say no, never the reverse - so a Dairy meeple can be
 * OVER-valued and never under-valued. That is the safe direction for the
 * hoarding question (an over-valued meeple gets spent, and a spend the engine
 * refuses is simply not offered) and the wrong direction for the door mix, so
 * it is written down here rather than left to be discovered in a report.
 */
function doorReady(
  data: GameData,
  view: PlayerView,
  action: WorkerAction,
  buildings: ReadonlyMap<CardId, BuildingView>,
): boolean {
  const you = view.you;
  switch (action) {
    case 'draw':
      return view.suitsInPlay.some((suit) => (view.decks[suit] ?? 0) > 0);
    case 'harvest':
      for (const building of buildings.values()) {
        const threshold = thresholdOfView(data, building);
        if (threshold !== null && building.stack.length >= threshold) return true;
      }
      return false;
    case 'sow': {
      if (you.hand.length === 0) return false;
      for (const building of buildings.values()) {
        const threshold = thresholdOfView(data, building);
        if (threshold !== null && building.stack.length < threshold) return true;
      }
      return false;
    }
    case 'build':
      // See the warning above: hand-non-empty stands in for the affordability
      // scan, and errs generous.
      return you.hand.length > 0;
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
      return canDeliverNow(data, view) || canMoveBalloonNow(view);
    default:
      return action satisfies never;
  }
}

/**
 * One entry per colour, whatever is at the table - a meeple of a suit NOBODY is
 * farming still works, because the five door actions exist independently of who
 * farms what, so this may never be filtered by `suitsInPlay`.
 */
function meepleWorthByColour(
  data: GameData,
  view: PlayerView,
  buildings: ReadonlyMap<CardId, BuildingView>,
): Map<Suit, number> {
  const out = new Map<Suit, number>();
  for (const colour of data.cards.suits) {
    const door = doorForSuit(data, colour);
    if (!door) {
      out.set(colour, 0);
      continue;
    }
    out.set(colour, doorReady(data, view, door.action, buildings) ? 1 : MEEPLE_LATENT);
  }
  return out;
}

export function makeScratch(data: GameData, view: PlayerView): Scratch {
  const you = view.you;
  const buildings = new Map<CardId, BuildingView>();
  let noticeBoard: BuildingView | null = null;
  let farmsteadCrop: Suit | null = null;

  for (const building of you.tableau) {
    buildings.set(building.card, building);
    const card = cardById(data, building.card);
    const slot = starterSlotOf(card);
    if (slot === 'noticeboard') noticeBoard = building;
    if (slot === 'farmstead') farmsteadCrop = card.suit;
  }

  const demandSuits = new Set<Suit>();
  const per = data.island.tileRule.cardsPerCrate;
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= deliveriesPerTile(data)) continue;
    const { base, wilds } = demandOf(tile, per);
    if (wilds > 0) for (const suit of view.suitsInPlay) demandSuits.add(suit);
    for (const suit of Object.keys(base) as Suit[]) demandSuits.add(suit);
  }

  const handLimit = data.rules.turn.handLimit;

  return {
    data,
    view,
    mySuit: you.suit,
    targetSuit: magpieTarget(you.suit, view.suitsInPlay),
    handLimit,
    handRoom:
      handLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, handLimit - you.hand.length),
    buildings,
    noticeBoard,
    farmsteadCrop,
    demandSuits,
    meepleWorth: meepleWorthByColour(data, view, buildings),
  };
}
