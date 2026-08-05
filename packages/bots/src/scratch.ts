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
 */

import type { Card, CardFace, GameData, Suit } from '@gp/data';
import type { BuildingView, CardId, PlayerView } from '@gp/engine';
import { activationSurchargeOf, harvestSurchargeOf, tileLevel } from '@gp/engine';

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

/** The face a building is showing. The view carries `upgraded`, which is all this needs. */
export function faceOfView(data: GameData, building: BuildingView): CardFace {
  const card = cardById(data, building.card);
  if (card.faces) return building.upgraded ? card.faces.upgraded : card.faces.starter;
  return {
    name: card.name,
    printedVp: card.printedVp ?? 0,
    threshold: card.threshold ?? null,
    activationType: card.activationType ?? null,
    abilityText: card.abilityText ?? null,
  };
}

/**
 * The crop a building prints, ticket 07's rule (mirrors the engine's `cropOf`,
 * which takes a GameState). A base starter prints the generic starting-building
 * icon and belongs to no crop; flipping it buys a crop icon.
 */
export function cropOfView(data: GameData, building: BuildingView): Suit | null {
  const card = cardById(data, building.card);
  if (card.type === 'starter') return building.upgraded ? card.suit : null;
  return card.suit;
}

export interface Scratch {
  readonly data: GameData;
  readonly view: PlayerView;
  readonly mySuit: Suit;
  /** Printed on the Barn's showing face. Null only if the Barn has somehow gone. */
  readonly handLimit: number | null;
  /** Cards you could draw before the end-of-turn discard bites. */
  readonly handRoom: number;
  readonly buildings: ReadonlyMap<CardId, BuildingView>;
  /** Buildings printing your own crop icon - the Farmstead free-flip counter. */
  readonly ownCropBuildings: number;
  readonly flipAt: number;
  readonly farmsteadUpgraded: boolean;
  readonly noticeBoard: BuildingView | null;
  /** Levels you already hold a receipt from. */
  readonly heldLevels: ReadonlySet<1 | 2 | 3>;
  /** Levels the island's per-player gate leaves open to you right now. */
  readonly openLevels: ReadonlySet<1 | 2 | 3>;
  /**
   * Suits an open, unfilled tile still wants. Wild crates count for every suit
   * in play, and the set is filtered by `openLevels` - the per-player level gate
   * - so a seat holding no Level 1 receipt sees Level 2 and Level 3 demand as
   * zero.
   *
   * **One set, gated, and the gate is measured rather than argued** (ticket 53).
   * `buyDemand` and `deckDemand` are the only two terms that read it. Dropping
   * the gate is not cosmetic - the gated and ungated sets are different sets in
   * 32.6% of the decisions offering a deck choice, and **72.4% before the seat
   * holds any receipt** - but over 55 stratified games it changes the bot's top
   * move **0 times in 12,208 decisions**, against a control at a 100x weight
   * that moves 19.0% of them. So there are not two readings to choose between;
   * there is one distinction the bot has never acted on.
   *
   * The arithmetic behind that zero is worth keeping, because it bounds what any
   * future gate change could do: the ungated set is a superset, so dropping the
   * gate can only ADD a term's own weight to an option - which lifts it to a TIE
   * with a leader that already has that weight, never past it. A gate reading
   * cannot move these terms without their weights moving first.
   */
  readonly demandSuits: ReadonlySet<Suit>;
  readonly ownsWorker: boolean;
  readonly coins: number;
  /**
   * Every coin this seat could still SPEND, from here (ticket 40).
   *
   * Coins are spend-only and, since ticket 37 deleted the pity, worth exactly
   * what they can still buy and nothing else - so a coin above the runway is
   * worth zero and a seat paying a card for one is making a dominated move.
   * Every component is a knob or a printed cost read from the data; nothing
   * here is a typed threshold.
   *
   * The card BUY is deliberately NOT in this sum - it is an unbounded repeating
   * sink, so adding it would make the runway meaningless. It is expressed as
   * `coinNeverDead` instead.
   */
  readonly coinRunway: number;
  /**
   * The cheapest thing this seat still wants to buy, affordable or not, or null
   * when it has bought everything it can reach.
   *
   * This is the whole of the bot's ability to SAVE. The term table prices moves,
   * not plans, so without it a seat buys a card every turn and never reaches the
   * £2 that hires a Worker - an instrument artefact that would be read as a rule
   * effect.
   *
   * Deliberately NOT filtered to what the seat cannot afford, which is the
   * version that was wrong: at exactly £2 the £2 Worker is affordable, so the
   * filtered gap read null, so the seat bought a card and dropped to £1 with the
   * Fair still open. The question a saver asks is "would this leave me short",
   * not "am I short now".
   */
  readonly sinkGap: number | null;
  /**
   * True while the card buy is switched on: a coin can always be turned into a
   * card, so a coin above the runway is no longer worth zero.
   *
   * This is the design claim being tested, stated in the one place that decides
   * what a coin is worth. It moves only when the rule moves, so the paired
   * `no-card-buy` run measures the rule and not a re-tuned bot.
   *
   * **Deliberately reads `buyCost` only, never `marketCost`** (ticket 56). The
   * buy converts a coin into a HAND card at £1, close enough to face value that
   * "a coin is a coin" holds. The market converts £3 into one BARN card - a
   * card `barnSpend` prices at a fifth of a hand card - so face value would
   * overprice a hoarder's pile and the market would never fire for exactly the
   * seats it exists to drain. The market's effect on a coin's worth arrives
   * through `coinRunway` instead: one market buy of headroom, below.
   */
  readonly coinNeverDead: boolean;
  /**
   * Island tiles that flip from unpayable to payable if ONE card of each suit
   * were added to this seat's barn - the market's ordering feature, and null
   * while the market is off.
   *
   * Ticket 56, standing on 51 and 52: DEMAND is uninformative for barn
   * decisions (right 53.4% of the time, chance) and PAYABILITY is the real
   * feature - ticket 38 measured the barn's whole block as matching under an
   * all-or-nothing payment, with 89% of blocked deliveries unable to afford any
   * open tile and 93% of near-misses short by 1-2 cards. A market card is worth
   * the deliveries it unlocks, so the feature counts exactly that, mirroring
   * the engine's own `anyDeliverOption` arithmetic from the view (wild crates
   * as capacity, the level gate applied - a tile you may not deliver to is not
   * a delivery unlocked).
   */
  readonly marketPayability: ReadonlyMap<Suit, number> | null;
}

/**
 * The sinks a seat can still reach, summed.
 *
 * Deliberately what is reachable NOW rather than what exists in the game: a
 * coin-priced card is only a sink while it is in your hand, which is what makes
 * the runway move with the position instead of sitting at a constant.
 */
function sinksOf(
  data: GameData,
  view: PlayerView,
  tableau: ReadonlyMap<CardId, BuildingView>,
): number[] {
  const you = view.you;
  const sinks: number[] = [];

  // Hiring: one Worker per player, and only while one is left in the Fair.
  const canHire =
    !view.fair.some((w) => w.owner === view.seat) && view.fair.some((w) => w.owner === null);
  if (canHire) sinks.push(data.workers.hireFee);

  for (const building of tableau.values()) {
    const card = cardById(data, building.card);
    // The Farmstead flips FREE at the own-crop milestone and can never be
    // bought (ticket 07), so its printed cost bar is not a sink.
    if (card.slot && card.slot !== 'farmstead' && !building.upgraded) {
      sinks.push(card.upgradeCostCoins ?? data.rules.economy.upgradeCostCoins);
    }
    // Surcharges are printed per card and keyed by data trigger, never by name.
    sinks.push(activationSurchargeOf(data, building.card));
    sinks.push(harvestSurchargeOf(data, building.card));
  }

  // The £2 Power and Endgame cards - a sink only while you hold one.
  for (const id of you.hand) sinks.push(cardById(data, id).buildCost?.coins ?? 0);

  return sinks.filter((n) => n > 0);
}

/**
 * The runway and the gap in ONE pass over the sinks. Both are read once per
 * decision and the pass walks the tableau and the hand, so deriving them
 * separately measurably cost the decision budget.
 */
function coinsOf(
  data: GameData,
  view: PlayerView,
  tableau: ReadonlyMap<CardId, BuildingView>,
): { runway: number; gap: number | null } {
  let runway = 0;
  let gap: number | null = null;
  for (const cost of sinksOf(data, view, tableau)) {
    runway += cost;
    if (gap === null || cost < gap) gap = cost;
  }
  // ONE market buy of headroom (ticket 56). The market is a repeating sink like
  // the card buy, so it can never join `sinksOf` wholesale - an unbounded sink
  // makes the runway meaningless, and a market entry in the GAP would make
  // `marketSaving` suppress the market to save for the market. But excluding it
  // entirely re-creates ticket 40's dead-coin blindness in the market-only arm:
  // a seat whose bounded sinks are spent would price every minted coin at zero
  // and never earn its way to £3, under-reporting the rule the arm exists to
  // measure. One buy ahead is a real purchasable thing, re-derived every
  // decision, so the runway sees the market without the gap ever doing so.
  const market = data.rules.turn.marketCost;
  if (market !== null) runway += market;
  return { runway, gap };
}

/**
 * What `n` more coins are actually worth to this seat: the part of the gain
 * that lands under the runway. Above it the marginal coin buys nothing.
 *
 * A NEGATIVE `n` is a spend, priced the same way and signed the other way: the
 * coins removed that were sitting under the runway, and so would have bought
 * something. Coins above it were worth nothing and are free to burn.
 *
 * Most spending never comes through here - a coin leaving for a hire or an
 * upgrade is already priced by the term that wanted the thing. The one caller
 * that does is D7's coins-as-wilds (ticket 47), where the coin buys nothing and
 * merely stands in for a card, so both sides of that trade have to be priced in
 * the same currency to be comparable.
 */
export function coinWorth(s: Scratch, n: number): number {
  if (n === 0) return 0;
  // With the buy live there is always something to spend on, so the cap goes.
  if (s.coinNeverDead) return n;
  if (n > 0) return Math.min(n, Math.max(0, s.coinRunway - s.coins));
  return -Math.max(0, Math.min(-n, s.coinRunway - (s.coins + n)));
}

/**
 * How many of `n` cards leaving this hand actually COST the seat anything.
 *
 * The other half of the exchange, and the half ticket 40 first shipped without
 * (Dean, 2026-08-02). A card in hand is not junk waiting to be dumped - it is
 * fuel. It can be built, it can pay a GROW and fire an ability, it can pay a
 * visit later. The design says so outright: *"cards are the scarce resource and
 * the master clock"*, and *"every turn you convert 1 spare card into either £1
 * or a second action"* - which prices one card at one coin, so a card must beat
 * a coin the seat cannot spend.
 *
 * The exemption is Dean's and it is the whole subtlety: **a card you are over
 * your hand limit with is free**, because the end-of-turn discard is going to
 * take it anyway. Cards above the limit are spent first and cost nothing; only
 * what a seat would otherwise have KEPT is charged.
 *
 * The forced end-of-turn discard is deliberately not run through here. You have
 * no choice there, so there is nothing to price - `discardJunk` only picks which.
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
 * The market's ordering feature (ticket 56): for each suit, how many open,
 * unfilled, level-open tiles flip from unpayable to payable with one more barn
 * card of that suit. Adding a card is monotone, so the count is a plain delta.
 *
 * On the decision budget: one working tally is mutated and restored rather
 * than copied per (tile, suit), and the caller only runs this at all when the
 * seat can afford a market buy - the first version computed it every decision
 * and pushed the whole-game gate from within budget to 9.5 applies a decision.
 */
function payabilityBySuit(
  data: GameData,
  view: PlayerView,
  openLevels: ReadonlySet<1 | 2 | 3>,
): Map<Suit, number> {
  const suits = view.suitsInPlay;
  const tally: Partial<Record<Suit, number>> = { ...view.you.barn };
  const out = new Map<Suit, number>();
  for (const suit of suits) out.set(suit, 0);
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= data.island.deliveriesPerTile) continue;
    const level = tileLevel(data, tile.tile);
    if (!openLevels.has(level)) continue;
    const rule = data.island.levelRules[String(level)];
    if (!rule) continue;
    const per = rule.cardsPerCrate;
    const base: Partial<Record<Suit, number>> = {};
    let wilds = 0;
    for (const crate of tile.crates) {
      if (crate === 'wild') wilds += 1;
      else base[crate] = (base[crate] ?? 0) + per;
    }
    if (tallyPays(suits, tally, base, wilds, per)) continue;
    for (const suit of suits) {
      tally[suit] = (tally[suit] ?? 0) + 1;
      if (tallyPays(suits, tally, base, wilds, per)) out.set(suit, (out.get(suit) ?? 0) + 1);
      tally[suit] = (tally[suit] as number) - 1;
    }
  }
  return out;
}

function levelsFor(
  data: GameData,
  view: PlayerView,
): { held: Set<1 | 2 | 3>; open: Set<1 | 2 | 3> } {
  const held = new Set<1 | 2 | 3>();
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.includes(view.seat)) held.add(tileLevel(data, tile.tile));
  }
  if (!data.island.levelGate) return { held, open: new Set<1 | 2 | 3>([1, 2, 3]) };
  const open = new Set<1 | 2 | 3>([1]);
  if (held.has(1)) open.add(2);
  if (held.has(2)) open.add(3);
  return { held, open };
}

export function makeScratch(data: GameData, view: PlayerView): Scratch {
  const you = view.you;
  const buildings = new Map<CardId, BuildingView>();
  let handLimit: number | null = null;
  let ownCropBuildings = 0;
  let farmsteadUpgraded = false;
  let noticeBoard: BuildingView | null = null;

  for (const building of you.tableau) {
    buildings.set(building.card, building);
    if (cropOfView(data, building) === you.suit) ownCropBuildings += 1;
    const slot = starterSlotOf(cardById(data, building.card));
    if (slot === 'barn') handLimit = faceOfView(data, building).handSize ?? null;
    if (slot === 'farmstead') farmsteadUpgraded = building.upgraded;
    if (slot === 'noticeboard') noticeBoard = building;
  }

  const purse = coinsOf(data, view, buildings);
  const { held: heldLevels, open: openLevels } = levelsFor(data, view);
  const demandSuits = new Set<Suit>();
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= data.island.deliveriesPerTile) continue;
    if (!openLevels.has(tileLevel(data, tile.tile))) continue;
    for (const crate of tile.crates) {
      if (crate === 'wild') for (const suit of view.suitsInPlay) demandSuits.add(suit);
      else demandSuits.add(crate);
    }
  }

  return {
    data,
    view,
    mySuit: you.suit,
    handLimit,
    handRoom: handLimit === null ? 0 : Math.max(0, handLimit - you.hand.length),
    buildings,
    ownCropBuildings,
    flipAt: data.rules.economy.farmsteadFlipAtOwnColourBuilds,
    farmsteadUpgraded,
    noticeBoard,
    heldLevels,
    openLevels,
    demandSuits,
    ownsWorker: view.fair.some((w) => w.owner === view.seat),
    coins: you.coins,
    coinRunway: purse.runway,
    sinkGap: purse.gap,
    coinNeverDead: data.rules.turn.buyCost !== null,
    // Null when the market is off OR unaffordable: no market move exists in
    // either case, so nothing reads it and the tile scan is never paid for.
    marketPayability:
      data.rules.turn.marketCost === null || you.coins < data.rules.turn.marketCost
        ? null
        : payabilityBySuit(data, view, openLevels),
  };
}
