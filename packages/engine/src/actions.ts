/**
 * The five main actions and the bonus slot: option ENUMERATORS and DO-funnels.
 *
 * The enumerators are the single source of legality. legalMoves maps them to
 * Moves, the Build/Deliver Worker tasks map them to task answers, and every
 * funnel re-validates the same predicates before mutating - so apply accepts
 * exactly what legalMoves offers, and a Worker performing an action obeys the
 * same rules as the action itself.
 *
 * Suit-power seams: the Farmstead powers (Wheat's relaxed harvest, Orchard's
 * draw modifier, Apiary's any-card Grow, Dairy's substitution, Vegetable's
 * deliver coin) attach to these funnels when their suit tickets land. Nothing
 * here hardcodes a tunable number - every dial reads from GameData.
 */

import type { GameData, Suit, WorkerAction } from '@gp/data';
import { deliveriesPerTile, deliveryVp } from '@gp/data';

import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import {
  canTakeCard,
  cardById,
  cropBuildings,
  faceOf,
  drawableSuits,
  isFull,
  noticeBoardOf,
  player,
  roomOn,
  serviceIdOf,
  serviceOf,
  visitTargetOf,
  withDrawModifier,
  workerData,
  workerState,
} from './query.js';
import type { CardId, GameState, IslandTileState, Move, Seat, TaskAnswer } from './state.js';
import { workWorker } from './workers.js';

/** All k-card subsets. Bounded: hands are 6-8, costs at most 5 cards. */
export function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}

// --- shared queries --------------------------------------------------------

/** The absolute hand limit printed on the seat's current Barn face. */
export function handLimitOf(data: GameData, state: GameState, seat: Seat): number | null {
  const barn = player(state, seat).tableau.find((b) => cardById(data, b.card).slot === 'barn');
  if (!barn) return null;
  return faceOf(data, barn).handSize ?? null;
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

// --- Build (and its branches: hire, upgrade) -------------------------------

/**
 * Modifiers a Build runs under. Absent = the plain printed rules, so every
 * pre-Dairy call site keeps its behaviour. All of them compose.
 */
export interface BuildMods {
  /** Card count reduction (the cream balloon, D4/D8/D9/D12/D15). Waives the own-suit half. */
  discount?: number;
  /** The Dairy Farmstead: any card pays any slot - the own-suit minimum is waived, never coins. */
  substitute?: boolean;
  /** D7 The Versatile Shed (ruling H): up to N coins each stand in for one required card. */
  coinWild?: number;
  /** D8 The Abundant Shed: barn cards may join the payment, by suit tally. */
  fromBarn?: boolean;
}

/**
 * A concrete, fully-chosen build. `payment` is hand cards; `barn` is a per-suit
 * tally (barn identity is inert, and views anonymise it, so a policy can only
 * ever name a suit there); `coinWild` is coins spent AS CARDS, on top of the
 * card's printed coin price.
 */
export interface BuildOption {
  card: CardId;
  payment: CardId[];
  barn?: Partial<Record<Suit, number>>;
  coinWild?: number;
}

/** The Dairy Farmstead's base power, live from turn 1: substitution on every Build. */
export function buildSubstitutePower(state: GameState, seat: Seat): boolean {
  return player(state, seat).suit === 'dairy';
}

/**
 * The upgraded Dairy Farmstead's "BUILD: you may BUILD again" - one optional
 * repeat of the Build ACTION, the same `turn.again` gate the Wheat harvest
 * repeat uses. Main action only, following the reference's afterMainAction.
 */
export function buildAgainPower(data: GameData, state: GameState, seat: Seat): boolean {
  const p = player(state, seat);
  if (p.suit !== 'dairy') return false;
  const farmstead = p.tableau.find((b) => cardById(data, b.card).slot === 'farmstead');
  return farmstead?.upgraded ?? false;
}

/** How many cards and coins a build actually costs under its modifiers. */
function priceOf(
  data: GameData,
  card: CardId,
  mods: BuildMods,
): { cardsNeeded: number; coinsNeeded: number; ownSuitMin: number } | null {
  const cost = cardById(data, card).buildCost;
  if (!cost) return null;
  const discount = mods.discount ?? 0;
  const totalCards = cost.suit + cost.wild;
  const cardsNeeded = Math.max(0, totalCards - discount);
  const coinsNeeded = discount - totalCards >= cost.coins ? 0 : cost.coins;
  // A discount waives the own-suit half (reference buildDiscount), and so does
  // the Dairy Farmstead's substitution.
  const ownSuitMin = discount > 0 || mods.substitute === true ? 0 : cost.suit;
  return { cardsNeeded, coinsNeeded, ownSuitMin };
}

/** Multisets of size k over the suits a seat's barn can actually cover. */
function barnFills(
  tally: Partial<Record<Suit, number>>,
  suits: readonly Suit[],
  k: number,
): Partial<Record<Suit, number>>[] {
  if (k === 0) return [{}];
  if (suits.length === 0) return [];
  const [head, ...rest] = suits as [Suit, ...Suit[]];
  const out: Partial<Record<Suit, number>>[] = [];
  const max = Math.min(k, tally[head] ?? 0);
  for (let n = max; n >= 0; n--) {
    for (const tail of barnFills(tally, rest, k - n)) {
      out.push(n > 0 ? { [head]: n, ...tail } : tail);
    }
  }
  return out;
}

/**
 * Every legal (card, payment) pair. A cost is n cards of the BUILT card's suit
 * plus m of any suit plus c coins; the built card never pays for itself; own-
 * suit cards may fill the wild half. `hand` overrides the seat's hand for the
 * post-fee re-check a visit's worker payoff needs.
 *
 * Under `mods` the price and the own-suit minimum move (see priceOf), coins may
 * stand in for cards (D7) and barn cards may join the payment (D8). The
 * enumeration stays exhaustive and concrete: one option per fully-decided way
 * to pay, so apply can re-validate exactly what was offered.
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
  const tally = mods.fromBarn === true ? barnTally(data, state, seat) : {};
  const out: BuildOption[] = [];
  for (const id of cards) {
    const price = priceOf(data, id, mods);
    if (!price) continue;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    const maxCoinWild = Math.min(mods.coinWild ?? 0, price.cardsNeeded);
    for (let coinWild = 0; coinWild <= maxCoinWild; coinWild++) {
      const coinsSpent = price.coinsNeeded + coinWild;
      if (p.coins < coinsSpent) continue;
      const cardsLeft = price.cardsNeeded - coinWild;
      // A coin is a wild card, so it can never satisfy the own-suit minimum.
      for (let fromHand = cardsLeft; fromHand >= 0; fromHand--) {
        const fromBarn = cardsLeft - fromHand;
        if (fromBarn > 0 && mods.fromBarn !== true) continue;
        for (const payment of subsets(others, fromHand)) {
          const own = payment.filter((c) => cardById(data, c).suit === suit).length;
          if (own < price.ownSuitMin) continue;
          for (const barn of barnFills(tally, state.suitsInPlay, fromBarn)) {
            const option: BuildOption = { card: id, payment };
            if (fromBarn > 0) option.barn = barn;
            if (coinWild > 0) option.coinWild = coinWild;
            out.push(option);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Early-exit form of buildOptions, for legality checks. `granted` is a
 * substitution the BUILD itself carries (the Dairy Service waives crop
 * requirements for whoever buys it), ORed with the seat's own Farmstead power.
 */
export function anyBuildOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  hand?: CardId[],
  granted = false,
): boolean {
  const p = player(state, seat);
  const cards = hand ?? p.hand;
  const substitute = granted || buildSubstitutePower(state, seat);
  return cards.some((id) => {
    const cost = cardById(data, id).buildCost;
    if (!cost || p.coins < cost.coins) return false;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    const own = others.filter((c) => cardById(data, c).suit === suit).length;
    return others.length >= cost.suit + cost.wild && (substitute || own >= cost.suit);
  });
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
  const barn = choice.barn ?? {};
  const coinWild = choice.coinWild ?? 0;
  const p = player(fx.state, seat);
  const c = cardById(fx.data, card);
  const price = priceOf(fx.data, card, mods);
  if (!price) throw new Error(`${card} has no build cost`);
  if (!p.hand.includes(card)) throw new Error(`${card} is not in seat ${seat}'s hand`);
  if (payment.includes(card)) throw new Error(`${card} cannot pay for itself`);
  if (new Set(payment).size !== payment.length) throw new Error('Duplicate payment card');
  if (coinWild > (mods.coinWild ?? 0))
    throw new Error(`${card} may not spend £${coinWild} as cards`);
  const fromBarn = (Object.values(barn) as number[]).reduce((a, b) => a + b, 0);
  if (fromBarn > 0 && mods.fromBarn !== true)
    throw new Error('This Build may not spend barn cards');
  if (payment.length + fromBarn + coinWild !== price.cardsNeeded) {
    throw new Error(
      `${card} costs ${price.cardsNeeded} cards, got ${payment.length + fromBarn + coinWild}`,
    );
  }
  const own = payment.filter((id) => cardById(fx.data, id).suit === c.suit).length;
  if (own < price.ownSuitMin) {
    throw new Error(`${card} needs ${price.ownSuitMin} ${c.suit} cards in payment`);
  }

  const coinsSpent = price.coinsNeeded + coinWild;
  if (coinsSpent > 0) fx.payCoins(seat, coinsSpent, `build:${card}`);
  fx.removeFromHand(seat, card);
  for (const id of payment) fx.removeFromHand(seat, id);
  fx.discard(payment);
  // Barn cards leave for their suits' discards through the shared funnel, so
  // they are spent exactly as a delivery spends them.
  const barnCards = fromBarn > 0 ? fx.spendFromBarn(seat, barn) : [];
  placeBuilt(fx, seat, card, [...payment, ...barnCards], coinsSpent, src);
}

/**
 * The build's landing half, shared with cost-waiving effects (W10's free
 * FIELD build, D10/D13's deck-top builds): the card enters the tableau, the
 * Farmstead milestone is checked, and the afterBuild reactors fire. The
 * Farmstead flips FREE at the milestone (own-colour deck builds) - the design
 * docs win over the reference's paid flip, per ticket 04.
 */
export function placeBuilt(
  fx: Fx,
  seat: Seat,
  card: CardId,
  payment: CardId[],
  coins: number,
  src: CardId | null = null,
): void {
  player(fx.state, seat).tableau.push({ card, stack: [], upgraded: false });
  fx.emit({ e: 'built', seat, card, payment, coins });
  checkFarmsteadFlip(fx, seat);
  fireHook(fx, 'afterBuild', { seat, card, payment, src });
}

/**
 * The Farmstead's FREE flip at the milestone: your Nth building printing your
 * OWN crop icon. Ticket 07 made this a printed-crop count like every other
 * building count, which means an upgraded Barn or Notice Board now counts
 * toward it - the change with teeth, because it makes the £2 upgrade sinks pull
 * double duty and gives the 2026-07-14 coin drought somewhere to spend.
 *
 * So it is checked after everything that can put a crop icon on the table: a
 * build (of any suit - the count decides, not the card) and a paid starter
 * flip. The base Farmstead prints no crop, so it never counts toward its own
 * milestone; once flipped it counts for everything else.
 */
export function checkFarmsteadFlip(fx: Fx, seat: Seat): void {
  const p = player(fx.state, seat);
  const farmstead = p.tableau.find((b) => cardById(fx.data, b.card).slot === 'farmstead');
  if (!farmstead || farmstead.upgraded) return;
  const own = cropBuildings(fx.data, fx.state, seat, p.suit).length;
  if (own < fx.data.rules.economy.farmsteadFlipAtOwnColourBuilds) return;
  farmstead.upgraded = true;
  fx.emit({ e: 'starterUpgraded', seat, card: farmstead.card, free: true });
}

/**
 * A10 The Cross-Pollinator, retexted when hiring died (2026-08-10): "Your
 * Service costs £1 less to activate." The one card id named in a funnel rather
 * than in a handler, for the same reason W8's surcharge is: it modifies a PRICE
 * the legality check reads, and a handler cannot reach into a cost lookup. The
 * £1 is printed text, exactly like every ability number in a handler.
 */
const CROSS_POLLINATOR = 'A10';

export function ownServiceDiscount(state: GameState, seat: Seat): number {
  return player(state, seat).tableau.filter((b) => b.card === CROSS_POLLINATOR).length;
}

/**
 * What it costs this seat to activate their OWN Service from the bonus slot.
 * Floors at 0.
 */
export function ownServiceCost(data: GameData, discount = 0): number {
  return Math.max(0, data.workers.ownerActivationCost - discount);
}

/** Starters a seat can pay to flip: Barn and Notice Board only - the Farmstead flips free. */
export function upgradeOptions(data: GameData, state: GameState, seat: Seat): CardId[] {
  const p = player(state, seat);
  return p.tableau
    .filter((b) => {
      const card = cardById(data, b.card);
      if (card.slot !== 'barn' && card.slot !== 'noticeboard') return false;
      if (b.upgraded) return false;
      const cost = card.upgradeCostCoins ?? data.rules.economy.upgradeCostCoins;
      return p.coins >= cost;
    })
    .map((b) => b.card);
}

export function doUpgrade(fx: Fx, seat: Seat, card: CardId): void {
  if (!upgradeOptions(fx.data, fx.state, seat).includes(card)) {
    throw new Error(`Seat ${seat} cannot upgrade ${card}`);
  }
  const building = player(fx.state, seat).tableau.find((b) => b.card === card);
  if (!building) throw new Error(`Seat ${seat} has not built ${card}`);
  const cost = cardById(fx.data, card).upgradeCostCoins ?? fx.data.rules.economy.upgradeCostCoins;
  fx.payCoins(seat, cost, `upgrade:${card}`);
  building.upgraded = true;
  fx.emit({ e: 'starterUpgraded', seat, card, free: false });
  // The flipped face prints a crop icon, so a paid flip can BE the Farmstead
  // milestone (ticket 07). Paying £2 can therefore buy two upgrades at once.
  checkFarmsteadFlip(fx, seat);
}

// --- Draw ------------------------------------------------------------------

/**
 * The plain Draw action: push the see-N/keep-K task with the printed base
 * numbers, through the Orchard Farmstead's draw modifier (see +1 base, see +1
 * keep +1 upgraded - never for card-ability draws, DL-47).
 */
export function doDraw(fx: Fx, seat: Seat): void {
  const spec = withDrawModifier(fx.data, fx.state, seat, fx.data.rules.turn.baseDraw);
  fx.pushTask({ t: 'draw', pid: seat, src: null, see: spec.see, keep: spec.keep, revealed: [] });
}

// --- Buy (the once-per-turn free action) -----------------------------------

/**
 * The suits a seat may BUY from right now: every deck on the table except its
 * OWN, while that suit still has cards (the discard reshuffles, as everywhere).
 *
 * Not your own suit, by Dean's rule (2026-08-03). It is what keeps the two
 * supply lines distinct - money buys VARIETY, your own crop comes from your own
 * deck - and it is why the buy cannot quietly become a second Draw.
 *
 * `rules.turn.buyCost` of null switches the whole rule off, which is what the
 * paired overlay run turns on and off.
 */
export function buyOptions(data: GameData, state: GameState, seat: Seat): Suit[] {
  const cost = data.rules.turn.buyCost;
  if (cost === null) return [];
  if (state.turn.buyUsed) return [];
  const p = player(state, seat);
  if (p.coins < cost) return [];
  return drawableSuits(data, state).filter((s) => s !== p.suit && state.suitsInPlay.includes(s));
}

export function hasBuyOption(data: GameData, state: GameState, seat: Seat): boolean {
  return buyOptions(data, state, seat).length > 0;
}

/** Pay the bank, take the top card of that suit's deck into hand. Blind, and never a Draw. */
export function doBuy(fx: Fx, seat: Seat, suit: Suit): void {
  if (!buyOptions(fx.data, fx.state, seat).includes(suit)) {
    throw new Error(`Seat ${seat} cannot buy from the ${suit} deck`);
  }
  const cost = fx.data.rules.turn.buyCost;
  if (cost === null) throw new Error('The card buy is switched off');
  const card = fx.takeDeckTop(suit);
  if (card === null) throw new Error(`The ${suit} deck is empty`);
  fx.payCoins(seat, cost, 'buy');
  fx.state.turn.buyUsed = true;
  fx.cardsToHand(seat, [card]);
}

// --- Grow ------------------------------------------------------------------

export interface GrowOption {
  building: CardId;
  payment: CardId;
}

/**
 * The activation surcharge a card prints ("You must pay £1 to activate this
 * card", A8 The Wild Hive), keyed by the data trigger like the harvest
 * surcharge: checked at legality, paid in doGrow after the card lands.
 */
export function activationSurchargeOf(data: GameData, card: CardId): number {
  return cardById(data, card).abilityTrigger.includes('activationSurcharge') ? 1 : 0;
}

/**
 * Own non-full buildings with a printed activation type, never the Notice
 * Board (porting guard: it passes the placement check but is not a Grow
 * target), paid with a matching hand card ('wild' takes any). The Apiary
 * Farmstead's base power (live from turn 1) waives the match entirely -
 * the reference's `Placement::checkNoType` in the Grow funnel. Surcharged
 * buildings (A8) drop out when the seat cannot pay.
 */
export function growOptions(data: GameData, state: GameState, seat: Seat): GrowOption[] {
  const p = player(state, seat);
  const anyCard = p.suit === 'apiary';
  const out: GrowOption[] = [];
  for (const b of p.tableau) {
    if (!canTakeCard(data, b)) continue;
    if (cardById(data, b.card).slot === 'noticeboard') continue;
    const type = faceOf(data, b).activationType;
    if (type === null) continue;
    if (activationSurchargeOf(data, b.card) > p.coins) continue;
    for (const card of p.hand) {
      if (anyCard || type === 'wild' || cardById(data, card).suit === type) {
        out.push({ building: b.card, payment: card });
      }
    }
  }
  return out;
}

// --- Harvest ---------------------------------------------------------------

/**
 * The harvest surcharge a card prints ("You must pay £1 to Harvest this
 * Field", W8), keyed by the data trigger so nothing here names a card. The £1
 * is printed text, like every ability number in a handler.
 */
export function harvestSurchargeOf(data: GameData, card: CardId): number {
  return cardById(data, card).abilityTrigger.includes('harvestSurcharge') ? 1 : 0;
}

/** Printed on the Wheat Farmstead: "Harvest: Any card with 2+ cards on it, even if not full." */
const WHEAT_RELAXED_MIN = 2;

/**
 * The Harvest ACTION's targets. Strict gate: full buildings. The Wheat
 * Farmstead's base power (live from turn 1) adds any building with 2+ cards
 * even if not full - a true union, and the gates genuinely cross: a
 * threshold-1 building is strict-harvestable at 1 card but never
 * relaxed-harvestable. Surcharged buildings (W8) drop out when the seat
 * cannot pay. Card-effect harvests do NOT inherit the relaxation; the Harvest
 * Worker does (suit powers apply to Worker actions - the 'harvestable' task
 * filter routes through here).
 */
export function harvestOptions(data: GameData, state: GameState, seat: Seat): CardId[] {
  const p = player(state, seat);
  const relaxed = p.suit === 'wheat';
  return p.tableau
    .filter((b) => isFull(data, b) || (relaxed && b.stack.length >= WHEAT_RELAXED_MIN))
    .filter((b) => harvestSurchargeOf(data, b.card) <= p.coins)
    .map((b) => b.card);
}

/**
 * The upgraded Wheat Farmstead's "Harvest is 2 buildings": one optional
 * repeat of the Harvest ACTION (the `turn.again` gate). Main action only,
 * following the reference - a Worker's harvest never offers the repeat.
 */
export function harvestAgainPower(data: GameData, state: GameState, seat: Seat): boolean {
  const p = player(state, seat);
  if (p.suit !== 'wheat') return false;
  const farmstead = p.tableau.find((b) => cardById(data, b.card).slot === 'farmstead');
  return farmstead?.upgraded ?? false;
}

export function doHarvestAction(fx: Fx, seat: Seat, building: CardId): void {
  if (!harvestOptions(fx.data, fx.state, seat).includes(building)) {
    throw new Error(`${building} is not harvestable by seat ${seat}`);
  }
  const fee = harvestSurchargeOf(fx.data, building);
  if (fee > 0) fx.payCoins(seat, fee, `surcharge:${building}`);
  fx.harvest(seat, building);
}

// --- Deliver ---------------------------------------------------------------

export interface DeliverOption {
  tile: string;
  spend: Partial<Record<Suit, number>>;
}

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

/** The demand a tile's crates make, before wild choices: suit -> cards. */
function namedDemand(
  data: GameData,
  tile: IslandTileState,
): { base: Partial<Record<Suit, number>>; wilds: number; cardsPerCrate: number } {
  const { cardsPerCrate } = data.island.tileRule;
  const base: Partial<Record<Suit, number>> = {};
  let wilds = 0;
  for (const crate of tile.crates) {
    if (crate === 'wild') wilds += 1;
    else base[crate] = (base[crate] ?? 0) + cardsPerCrate;
  }
  return { base, wilds, cardsPerCrate };
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
export function deliverOptions(data: GameData, state: GameState, seat: Seat): DeliverOption[] {
  const tally = barnTally(data, state, seat);
  const out: DeliverOption[] = [];
  const seen = new Set<string>();
  const add = (tile: string, spend: Partial<Record<Suit, number>>) => {
    const key = spendKey(tile, spend);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ tile, spend });
  };
  for (const demand of deliverDemands(data, state, seat)) {
    const affordable = (Object.entries(demand.spend) as [Suit, number][]).every(
      ([s, n]) => (tally[s] ?? 0) >= n,
    );
    if (affordable) add(demand.tile, demand.spend);
    else {
      for (const spend of substitutedSpends(data, state.suitsInPlay, demand.spend, tally)) {
        add(demand.tile, spend);
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
  const tally = barnTally(data, state, seat);
  return state.island.tiles.some((tile) => {
    if (!tileHasRoom(data, tile)) return false;
    const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
    return wildFills(state.suitsInPlay, wilds).some((fill) => {
      const need: Partial<Record<Suit, number>> = { ...base };
      for (const s of fill) need[s] = (need[s] ?? 0) + cardsPerCrate;
      return canPay(data, need, tally);
    });
  });
}

export function doDeliver(
  fx: Fx,
  seat: Seat,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
  /** V12's "treat any 1 card as a Vegetable": each entry relabels one spent card for validation only. */
  countAs?: { from: Suit; to: Suit }[],
): void {
  const state = fx.state;
  const tile = state.island.tiles.find((t) => t.tile === tileId);
  if (!tile) throw new Error(`Tile ${tileId} is not in play`);
  if (!tileHasRoom(fx.data, tile)) {
    throw new Error(`Tile ${tileId} has no delivery slots left`);
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

  const cards = fx.spendFromBarn(seat, spend);
  const coins = fx.data.island.tileRule.coinsPerDelivery;
  // Read the VP BEFORE this delivery joins the tile, or the first deliverer
  // would be paid the second deliverer's rate. The tile's own fill order is the
  // whole gradient now: 6 for being first here, 3 for being second.
  const vp = deliveryVp(fx.data, tile.deliveredBy.length);
  player(state, seat).receipts.push(vp);
  tile.deliveredBy.push(seat);
  fx.gainCoins(seat, coins, `deliver:${tileId}`);
  fx.emit({ e: 'delivered', seat, tile: tileId, vp, coins, spend });
  fireHook(fx, 'afterDeliver', { seat, island: true, tile: tileId, cards });
  // The clock: one seat's Nth ISLAND delivery ends the game. Counted after the
  // push, and off the island rather than off `receipts`, because receipts is a
  // VP list that other rules could one day write to and the trigger must stay a
  // count of things visible on the board.
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
  const spends = balloonSpends(data, state, seat);
  return movable.flatMap((b) => spends.map((spend) => ({ balloon: b.id, spend })));
}

export function anyBalloonMoveOption(data: GameData, state: GameState, seat: Seat): boolean {
  const aero = state.aerodrome;
  if (!aero || !aero.balloons.some((b) => b.at !== seat)) return false;
  return balloonSpends(data, state, seat).length > 0;
}

/**
 * Move a balloon to your Aerodrome and collect its reward. `spend` is the
 * printed cost; null is a card effect's FREE move (V16 - no cards, but still a
 * balloon move, so the raid hook and the deliver hook both fire). The raided
 * player is not compensated (ruling J - on the sim watch list).
 */
export function doMoveBalloon(
  fx: Fx,
  seat: Seat,
  balloonId: string,
  spend: Partial<Record<Suit, number>> | null,
): void {
  const aero = fx.state.aerodrome;
  if (!aero) throw new Error('The Aerodrome module is not in play');
  const balloon = aero.balloons.find((b) => b.id === balloonId);
  if (!balloon) throw new Error(`Unknown balloon ${balloonId}`);
  if (balloon.at === seat) throw new Error('A balloon is never moved from your own Aerodrome');

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

  const from = balloon.at;
  balloon.at = seat;
  fx.emit({
    e: 'balloonMoved',
    seat,
    balloon: balloonId,
    from,
    spend: spend ?? {},
    free: spend === null,
  });
  fireHook(fx, 'afterBalloonMove', { seat, balloon: balloonId, from });
  fireHook(fx, 'afterDeliver', { seat, island: false, cards });
  grantBalloonReward(fx, seat, balloonId);
}

/** The reward printed under the balloon, from aerodrome.json (overlay-tunable). */
export function grantBalloonReward(fx: Fx, seat: Seat, balloonId: string): void {
  const balloon = fx.data.aerodrome.balloons.find((b) => b.id === balloonId);
  if (!balloon) throw new Error(`No balloon ${balloonId} in the data`);
  const { type: reward, amount } = balloon.reward;
  switch (reward) {
    case 'draw':
      // A card-ability draw: the Orchard Farmstead modifier does not apply (DL-47).
      fx.pushTask({ t: 'draw', pid: seat, src: null, see: amount, keep: amount, revealed: [] });
      break;
    case 'buildDiscount':
      fx.pushTask({ t: 'build', pid: seat, src: null, mods: { discount: amount } });
      break;
    case 'sowFromHand':
      // "Sow 4 cards from your hand" reads as up-to: skippable, stops early.
      fx.pushTask({ t: 'sow', pid: seat, src: null, remaining: amount, optional: true });
      break;
    case 'gainCoins':
      fx.gainCoins(seat, amount, `balloon:${balloonId}`);
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
      (o) => ({ kind: 'deliver', tile: o.tile, spend: o.spend }) as TaskAnswer,
    ),
    ...balloonMoveOptions(data, state, seat).map(
      (o) => ({ kind: 'balloon', balloon: o.balloon, spend: o.spend }) as TaskAnswer,
    ),
  ];
}

// --- Workers: shared action legality --------------------------------------

/**
 * Can this Worker's action do anything for this seat right now? Reuses the
 * same enumerators the action funnels enforce, so a Worker is never offered
 * and then wedged. `excludingHandCard` re-checks as if a card (the visit fee)
 * had already left the hand.
 */
export function workerActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  workerId: string,
  opts?: { excludingHandCard?: CardId },
): boolean {
  const worker = workerData(data, workerId);
  const hand = opts?.excludingHandCard
    ? withoutFirst(player(state, seat).hand, opts.excludingHandCard)
    : player(state, seat).hand;
  switch (worker.action) {
    case 'draw':
      return drawableSuits(data, state).length > 0;
    case 'harvest':
      // harvestOptions, not fullBuildings: suit powers apply to Service actions.
      // The handToBarn tail is optional, so it never gates legality.
      return harvestOptions(data, state, seat).length > 0;
    case 'sow':
      // The deck-sowing Service needs a live deck, not a hand card - which is
      // exactly what makes it worth a visitor's card instead of costing them two.
      return worker.sow?.from === 'deck'
        ? drawableSuits(data, state).length > 0 &&
            player(state, seat).tableau.some((b) => canTakeCard(data, b))
        : hand.length > 0 && player(state, seat).tableau.some((b) => canTakeCard(data, b));
    case 'build':
      return anyBuildOption(data, state, seat, hand, worker.build?.substitute === true);
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12). The
      // handToBarn head is optional, so a seat with a payable barn qualifies
      // whether or not it wants to top it up first.
      return anyDeliverOption(data, state, seat) || anyBalloonMoveOption(data, state, seat);
    default:
      return worker.action satisfies never;
  }
}

function withoutFirst(items: readonly CardId[], drop: CardId): CardId[] {
  const i = items.indexOf(drop);
  return i < 0 ? [...items] : [...items.slice(0, i), ...items.slice(i + 1)];
}

// --- The bonus slot --------------------------------------------------------

export type VisitOption = Extract<Move, { type: 'visit' }>;

/**
 * Every visit on offer. Since the Services (2026-08-10) a host has TWO
 * targetable buildings and they clog independently:
 *
 *   their NOTICE BOARD -> the printed coins, to the VISITOR.
 *   their SERVICE      -> its action for the visitor, and `visitWage` minted to
 *                         the HOST by the bank.
 *
 * A clogged Notice Board no longer locks a rival out of the host's action, which
 * was the denial worry (v14 watch-list 5) and is now structurally halved.
 */
export function visitOptions(data: GameData, state: GameState, seat: Seat): VisitOption[] {
  if (state.turn.bonusSpent) return [];
  const out: VisitOption[] = [];
  const hand = player(state, seat).hand;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat) continue;
    const board = noticeBoardOf(data, state, host);
    const service = serviceOf(data, state, host);
    const serviceId = serviceIdOf(data, state, host);
    const boardOpen = !isFull(data, board);
    const serviceOpen = !isFull(data, service);
    for (const fee of hand) {
      if (boardOpen) {
        out.push({ type: 'visit', seat, host, fee: [fee], payoff: { mode: 'coin' } });
      }
      if (
        serviceOpen &&
        workerActionLegal(data, state, seat, serviceId, { excludingHandCard: fee })
      ) {
        out.push({
          type: 'visit',
          seat,
          host,
          fee: [fee],
          payoff: { mode: 'worker', workerId: serviceId as WorkerAction },
        });
      }
    }
    // Special Orders' second line, upgraded face only: two distinct cards for a
    // bigger payout, gated up front on room for BOTH (a board at 4-of-5 refuses
    // the whole visit rather than taking one card and paying the smaller rate).
    if (boardOpen && board.upgraded && roomOn(data, board) >= 2) {
      for (const pair of subsets(hand, 2)) {
        out.push({ type: 'visit', seat, host, fee: pair, payoff: { mode: 'special' } });
      }
    }
  }
  return out;
}

/**
 * Activating your OWN Service: one option, always your suit's, and only when you
 * can pay the bank for it. A seat with no coins simply has no own-Service
 * option, which is the rule doing its job - the money to run your farm comes
 * from your neighbours or it does not come.
 */
export function workOwnOptions(data: GameData, state: GameState, seat: Seat): WorkerAction[] {
  if (state.turn.bonusSpent) return [];
  if (player(state, seat).coins < ownServiceCost(data, ownServiceDiscount(state, seat))) return [];
  const id = serviceIdOf(data, state, seat);
  return workerActionLegal(data, state, seat, id) ? [id as WorkerAction] : [];
}

/**
 * BUY AT MARKET's deck choices (docs/Market Bonus Action 2026-08-03.md). A
 * bonus-slot option, so it gates on `bonusSpent` like the visit - competing
 * with the visit is the entire point of the rule. Any deck in play, OWN SUIT
 * INCLUDED (legal here and illegal at the card buy, both deliberate: the barn
 * destination makes own-suit harmless colour for delivery, the hand destination
 * made it a second Draw). A suit whose deck and discard are both empty cannot
 * be bought (the doc's ruling); the reshuffle happens in the funnel as usual.
 *
 * A seat that cannot afford the fee simply has no market option, so the turn is
 * never held open waiting for a market it cannot take - the `settleTurn`
 * decline behaviour falls out of `hasBonusOption` reading this.
 */
export function marketOptions(data: GameData, state: GameState, seat: Seat): Suit[] {
  const cost = data.rules.turn.marketCost;
  if (cost === null) return [];
  if (state.turn.bonusSpent) return [];
  if (player(state, seat).coins < cost) return [];
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

export function hasBonusOption(data: GameData, state: GameState, seat: Seat): boolean {
  return (
    visitOptions(data, state, seat).length > 0 ||
    workOwnOptions(data, state, seat).length > 0 ||
    marketOptions(data, state, seat).length > 0
  );
}

/**
 * Pay the bank, top card of that deck straight into the barn, revealed (the
 * `deckToBarn` event carries it - the Patisserie / Meadow Hive primitive, so
 * the narrator and redaction inherit it). Consumes the bonus slot and nothing
 * else: `turn.visit` stays null, so a Helping Hand never arms, and no
 * `afterVisit` fires - the ticket 23 precedent. Never a Draw: no task, no
 * keep, and `withDrawModifier` is never consulted.
 */
export function doMarket(fx: Fx, seat: Seat, suit: Suit): void {
  if (!marketOptions(fx.data, fx.state, seat).includes(suit)) {
    throw new Error(`Seat ${seat} cannot buy the ${suit} crop at market`);
  }
  const cost = fx.data.rules.turn.marketCost;
  if (cost === null) throw new Error('The market is switched off');
  fx.payCoins(seat, cost, 'market');
  fx.state.turn.bonusSpent = true;
  fx.deckTopToBarn(seat, suit);
}

/**
 * The unified visit: cards from hand onto ONE of the host's two targetable
 * buildings, then that building's printed payoff.
 *
 *   coin / special -> the NOTICE BOARD; the bank pays the VISITOR.
 *   worker         -> the SERVICE;      the bank pays the HOST `visitWage`.
 *
 * The mode picks the building, so the two clog independently and a leader
 * sitting on a full Notice Board no longer denies access to their action.
 *
 * The wage is paid HERE rather than inside workWorker, because since the Working
 * Week died the card landing on the Service IS the use being paid for - a Herb
 * Hive free work places no card and correctly mints nothing.
 */
export function doVisit(
  fx: Fx,
  visitor: Seat,
  host: Seat,
  fee: CardId[],
  payoff: { mode: 'coin' } | { mode: 'worker'; workerId: WorkerAction } | { mode: 'special' },
): void {
  if (visitor === host) throw new Error('You may never visit your own farm');
  const state = fx.state;
  if (state.turn.bonusSpent) throw new Error('Bonus slot already spent this turn');
  const target = visitTargetOf(fx.data, state, host, payoff.mode);

  const cards = payoff.mode === 'special' ? 2 : 1;
  if (fee.length !== cards) {
    throw new Error(`A ${payoff.mode} visit places exactly ${cards} card(s), not ${fee.length}`);
  }
  if (isFull(fx.data, target)) throw new Error(`${target.card} is full`);

  if (payoff.mode === 'special') {
    if (!target.upgraded) throw new Error(`${target.card} does not print the 2-card visit`);
    if (new Set(fee).size !== fee.length) throw new Error('The two cards must be distinct');
    // Room for BOTH, checked before anything moves.
    if (roomOn(fx.data, target) < cards) {
      throw new Error(`${target.card} has no room for ${cards} cards`);
    }
  }

  if (payoff.mode === 'worker') {
    if (workerState(state, payoff.workerId).owner !== host) {
      throw new Error(`Service ${payoff.workerId} is not the host's`);
    }
    const spent = fee[0] as CardId;
    if (
      !workerActionLegal(fx.data, state, visitor, payoff.workerId, { excludingHandCard: spent })
    ) {
      throw new Error(`Service ${payoff.workerId} has nothing legal to do for seat ${visitor}`);
    }
  }

  for (const card of fee) fx.placeOnBuilding(visitor, { seat: host, card: target.card }, card);
  state.turn.bonusSpent = true;
  // O16 The Orchard Keeper reacts host-side in every branch, once per visit,
  // after the fee lands and before the payoff (the reference fires it here too).
  fireHook(fx, 'afterVisit', { visitor, host, mode: payoff.mode });

  if (payoff.mode === 'worker') {
    state.turn.visit = { host, workerId: payoff.workerId, repeats: 0 };
    fx.emit({ e: 'visited', seat: visitor, host, mode: 'worker' });
    payServiceWage(fx, visitor, host, payoff.workerId);
    workWorker(fx, visitor, payoff.workerId, { progress: true });
  } else {
    const rates = fx.data.rules.economy.visitPayout;
    const paid =
      payoff.mode === 'special' ? rates.twoCard : target.upgraded ? rates.upgraded : rates.base;
    fx.gainCoins(visitor, paid, 'visit');
    fx.emit({ e: 'visited', seat: visitor, host, mode: payoff.mode });
  }
}

/**
 * The bank mints `visitWage` to a Service's owner, and only for a RIVAL's use -
 * the standing law that you never earn from your own farm. Shared by the visit
 * and by a Helping Hand repeat, since a repeat is another card on the Service.
 */
export function payServiceWage(fx: Fx, actor: Seat, owner: Seat, workerId: string): void {
  if (actor === owner) return;
  const wage = fx.data.workers.visitWage;
  if (wage > 0) fx.gainCoins(owner, wage, `wage:${workerId}`);
}

/**
 * The bonus slot's other half: activate your OWN Service. Pay the bank, take the
 * action, place NOTHING - so an owner never clogs their own Service, never
 * advances it toward a harvest, and never earns from it.
 */
export function doWorkOwn(fx: Fx, seat: Seat, workerId: WorkerAction): void {
  if (fx.state.turn.bonusSpent) throw new Error('Bonus slot already spent this turn');
  if (workerState(fx.state, workerId).owner !== seat) {
    throw new Error(`Service ${workerId} is not yours`);
  }
  const cost = ownServiceCost(fx.data, ownServiceDiscount(fx.state, seat));
  if (cost > 0) fx.payCoins(seat, cost, `service:${workerId}`);
  fx.state.turn.bonusSpent = true;
  workWorker(fx, seat, workerId, { progress: true });
}

// --- The main-action umbrella ---------------------------------------------

/** Is ANY main action legal? Decides whether `pass` is offered (and nothing else is). */
export function hasMainOption(data: GameData, state: GameState, seat: Seat): boolean {
  return (
    drawableSuits(data, state).length > 0 ||
    anyBuildOption(data, state, seat) ||
    upgradeOptions(data, state, seat).length > 0 ||
    growOptions(data, state, seat).length > 0 ||
    harvestOptions(data, state, seat).length > 0 ||
    anyDeliverOption(data, state, seat) ||
    anyBalloonMoveOption(data, state, seat)
  );
}
