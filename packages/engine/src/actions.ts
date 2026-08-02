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

import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import {
  canTakeCard,
  cardById,
  faceOf,
  drawableSuits,
  isFull,
  noticeBoardOf,
  player,
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

export function tileLevel(data: GameData, tileId: string): 1 | 2 | 3 {
  const tile = data.island.tiles.find((t) => t.id === tileId);
  if (!tile) throw new Error(`Unknown island tile ${tileId}`);
  return tile.level;
}

export function levelRuleOf(data: GameData, level: 1 | 2 | 3) {
  const rule = data.island.levelRules[String(level)];
  if (!rule) throw new Error(`No island level rules for level ${level}`);
  return rule;
}

// --- Build (and its branches: hire, upgrade) -------------------------------

export interface BuildOption {
  card: CardId;
  payment: CardId[];
}

/**
 * Every legal (card, payment) pair. A cost is n cards of the BUILT card's suit
 * plus m of any suit plus c coins; the built card never pays for itself; own-
 * suit cards may fill the wild half. `hand` overrides the seat's hand for the
 * post-fee re-check a visit's worker payoff needs.
 *
 * `discount` is the cream balloon's "Build, with a discount of 4" (reference
 * buildDiscount): the card count drops by the discount (min 0), the remaining
 * payment is ANY suit (the own-suit half is waived), and a coin price is
 * waived when the leftover discount covers it.
 */
export function buildOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  hand?: CardId[],
  discount = 0,
): BuildOption[] {
  const p = player(state, seat);
  const cards = hand ?? p.hand;
  const out: BuildOption[] = [];
  for (const id of cards) {
    const cost = cardById(data, id).buildCost;
    if (!cost) continue;
    const totalCards = cost.suit + cost.wild;
    const cardsNeeded = Math.max(0, totalCards - discount);
    const coinsNeeded = discount - totalCards >= cost.coins ? 0 : cost.coins;
    if (p.coins < coinsNeeded) continue;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    for (const payment of subsets(others, cardsNeeded)) {
      const own = payment.filter((c) => cardById(data, c).suit === suit).length;
      if (discount > 0 || own >= cost.suit) out.push({ card: id, payment });
    }
  }
  return out;
}

/** Early-exit form of buildOptions, for legality checks. */
export function anyBuildOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  hand?: CardId[],
): boolean {
  const p = player(state, seat);
  const cards = hand ?? p.hand;
  return cards.some((id) => {
    const cost = cardById(data, id).buildCost;
    if (!cost || p.coins < cost.coins) return false;
    const suit = cardById(data, id).suit;
    const others = cards.filter((h) => h !== id);
    const own = others.filter((c) => cardById(data, c).suit === suit).length;
    return others.length >= cost.suit + cost.wild && own >= cost.suit;
  });
}

export function doBuild(fx: Fx, seat: Seat, card: CardId, payment: CardId[], discount = 0): void {
  const p = player(fx.state, seat);
  const c = cardById(fx.data, card);
  const cost = c.buildCost;
  if (!cost) throw new Error(`${card} has no build cost`);
  if (!p.hand.includes(card)) throw new Error(`${card} is not in seat ${seat}'s hand`);
  if (payment.includes(card)) throw new Error(`${card} cannot pay for itself`);
  if (new Set(payment).size !== payment.length) throw new Error('Duplicate payment card');
  const totalCards = cost.suit + cost.wild;
  const cardsNeeded = Math.max(0, totalCards - discount);
  const coinsNeeded = discount - totalCards >= cost.coins ? 0 : cost.coins;
  if (payment.length !== cardsNeeded) {
    throw new Error(`${card} costs ${cardsNeeded} cards, got ${payment.length}`);
  }
  if (discount === 0) {
    const own = payment.filter((id) => cardById(fx.data, id).suit === c.suit).length;
    if (own < cost.suit) throw new Error(`${card} needs ${cost.suit} ${c.suit} cards in payment`);
  }

  if (coinsNeeded > 0) fx.payCoins(seat, coinsNeeded, `build:${card}`);
  fx.removeFromHand(seat, card);
  for (const id of payment) fx.removeFromHand(seat, id);
  fx.discard(payment);
  placeBuilt(fx, seat, card, payment, coinsNeeded);
}

/**
 * The build's landing half, shared with cost-waiving effects (W10's free
 * FIELD build): the card enters the tableau and the Farmstead milestone is
 * checked. The Farmstead flips FREE at the milestone (own-colour deck
 * builds) - the design docs win over the reference's paid flip, per ticket 04.
 */
export function placeBuilt(
  fx: Fx,
  seat: Seat,
  card: CardId,
  payment: CardId[],
  coins: number,
): void {
  const p = player(fx.state, seat);
  p.tableau.push({ card, stack: [], upgraded: false });
  fx.emit({ e: 'built', seat, card, payment, coins });

  if (cardById(fx.data, card).suit === p.suit) {
    const ownBuilds = p.tableau.filter(
      (b) => cardById(fx.data, b.card).inDeck && cardById(fx.data, b.card).suit === p.suit,
    ).length;
    const milestone = fx.data.rules.economy.farmsteadFlipAtOwnColourBuilds;
    const farmstead = p.tableau.find((b) => cardById(fx.data, b.card).slot === 'farmstead');
    if (farmstead && !farmstead.upgraded && ownBuilds >= milestone) {
      farmstead.upgraded = true;
      fx.emit({ e: 'starterUpgraded', seat, card: farmstead.card, free: true });
    }
  }
}

export function hireOptions(data: GameData, state: GameState, seat: Seat): WorkerAction[] {
  const p = player(state, seat);
  if (p.coins < data.workers.hireFee) return [];
  const owned = state.fair.filter((w) => w.owner === seat).length;
  if (owned >= data.workers.maxPerPlayer) return [];
  return state.fair.filter((w) => w.owner === null).map((w) => w.id);
}

export function doHire(fx: Fx, seat: Seat, workerId: WorkerAction): void {
  if (!hireOptions(fx.data, fx.state, seat).includes(workerId)) {
    throw new Error(`Seat ${seat} cannot hire ${workerId}`);
  }
  fx.payCoins(seat, fx.data.workers.hireFee, `hire:${workerId}`);
  const ws = workerState(fx.state, workerId);
  ws.owner = seat;
  ws.trackPos = 0;
  fx.emit({ e: 'hired', seat, workerId });
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
}

// --- Draw ------------------------------------------------------------------

/** The plain Draw action: push the see-N/keep-K task with the printed base numbers. */
export function doDraw(fx: Fx, seat: Seat): void {
  const spec = fx.data.rules.turn.baseDraw;
  fx.pushTask({ t: 'draw', pid: seat, src: null, see: spec.see, keep: spec.keep, revealed: [] });
}

// --- Grow ------------------------------------------------------------------

export interface GrowOption {
  building: CardId;
  payment: CardId;
}

/**
 * Own non-full buildings with a printed activation type, never the Notice
 * Board (porting guard: it passes the placement check but is not a Grow
 * target), paid with a matching hand card ('wild' takes any).
 */
export function growOptions(data: GameData, state: GameState, seat: Seat): GrowOption[] {
  const p = player(state, seat);
  const out: GrowOption[] = [];
  for (const b of p.tableau) {
    if (!canTakeCard(data, b)) continue;
    if (cardById(data, b.card).slot === 'noticeboard') continue;
    const type = faceOf(data, b).activationType;
    if (type === null) continue;
    for (const card of p.hand) {
      if (type === 'wild' || cardById(data, card).suit === type) {
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
  const rule = levelRuleOf(data, tileLevel(data, tile.tile));
  const base: Partial<Record<Suit, number>> = {};
  let wilds = 0;
  for (const crate of tile.crates) {
    if (crate === 'wild') wilds += 1;
    else base[crate] = (base[crate] ?? 0) + rule.cardsPerCrate;
  }
  return { base, wilds, cardsPerCrate: rule.cardsPerCrate };
}

/**
 * Demand-side spends per open tile (wild crates resolved to a suit each),
 * BEFORE affordability. V12's treat-one-card-as-Vegetable enumerates against
 * these; everything else goes through deliverOptions.
 */
export function deliverDemands(data: GameData, state: GameState): DeliverOption[] {
  const out: DeliverOption[] = [];
  for (const tile of state.island.tiles) {
    if (tile.deliveredBy.length >= data.island.deliveriesPerTile) continue;
    const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
    for (const fill of wildFills(state.suitsInPlay, wilds)) {
      const spend: Partial<Record<Suit, number>> = { ...base };
      for (const s of fill) spend[s] = (spend[s] ?? 0) + cardsPerCrate;
      out.push({ tile: tile.tile, spend });
    }
  }
  return out;
}

export function deliverOptions(data: GameData, state: GameState, seat: Seat): DeliverOption[] {
  const tally = barnTally(data, state, seat);
  return deliverDemands(data, state).filter((o) =>
    (Object.entries(o.spend) as [Suit, number][]).every(([s, n]) => (tally[s] ?? 0) >= n),
  );
}

export function anyDeliverOption(data: GameData, state: GameState, seat: Seat): boolean {
  const tally = barnTally(data, state, seat);
  return state.island.tiles.some((tile) => {
    if (tile.deliveredBy.length >= data.island.deliveriesPerTile) return false;
    const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
    let wildCapacity = 0;
    for (const suit of state.suitsInPlay) {
      const surplus = (tally[suit] ?? 0) - (base[suit] ?? 0);
      if (surplus < 0) return false;
      wildCapacity += Math.floor(surplus / cardsPerCrate);
    }
    for (const [suit, need] of Object.entries(base) as [Suit, number][]) {
      if ((tally[suit] ?? 0) < need) return false;
    }
    return wildCapacity >= wilds;
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
  if (tile.deliveredBy.length >= fx.data.island.deliveriesPerTile) {
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
  const { base, wilds, cardsPerCrate } = namedDemand(fx.data, tile);
  let wildsPaid = 0;
  for (const suit of fx.data.cards.suits) {
    const paid = virtual[suit] ?? 0;
    const surplus = paid - (base[suit] ?? 0);
    if (surplus < 0) throw new Error(`Spend does not cover the ${suit} crates of ${tileId}`);
    if (surplus % cardsPerCrate !== 0) {
      throw new Error(`A crate is paid in ${cardsPerCrate} cards of ONE suit`);
    }
    wildsPaid += surplus / cardsPerCrate;
  }
  if (wildsPaid !== wilds) {
    throw new Error(`${tileId} has ${wilds} wild crates; spend covers ${wildsPaid}`);
  }

  const cards = fx.spendFromBarn(seat, spend);
  const rule = levelRuleOf(fx.data, tileLevel(fx.data, tileId));
  player(state, seat).receipts.push(rule.vp);
  tile.deliveredBy.push(seat);
  fx.gainCoins(seat, rule.coinsPerDelivery, `deliver:${tileId}`);
  fx.emit({ e: 'delivered', seat, tile: tileId, vp: rule.vp, coins: rule.coinsPerDelivery, spend });
  fireHook(fx, 'afterDeliver', { seat, island: true, tile: tileId, cards });
  if (rule.triggersGameEnd && state.endTrigger === null) {
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
      fx.pushTask({ t: 'build', pid: seat, src: null, discount: amount });
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
      // harvestOptions, not fullBuildings: suit powers apply to Worker actions.
      return harvestOptions(data, state, seat).length > 0;
    case 'sow':
      return hand.length > 0 && player(state, seat).tableau.some((b) => canTakeCard(data, b));
    case 'build':
      return anyBuildOption(data, state, seat, hand);
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
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

export function visitOptions(data: GameData, state: GameState, seat: Seat): VisitOption[] {
  if (state.turn.bonusSpent) return [];
  const out: VisitOption[] = [];
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat) continue;
    const board = noticeBoardOf(data, state, host);
    if (isFull(data, board)) continue;
    const workers = state.fair.filter((w) => w.owner === host);
    for (const fee of player(state, seat).hand) {
      out.push({ type: 'visit', seat, host, fee, payoff: { mode: 'coin' } });
      for (const w of workers) {
        if (workerActionLegal(data, state, seat, w.id, { excludingHandCard: fee })) {
          out.push({ type: 'visit', seat, host, fee, payoff: { mode: 'worker', workerId: w.id } });
        }
      }
    }
  }
  return out;
}

export function workOwnOptions(data: GameData, state: GameState, seat: Seat): WorkerAction[] {
  if (state.turn.bonusSpent) return [];
  return state.fair
    .filter((w) => w.owner === seat && workerActionLegal(data, state, seat, w.id))
    .map((w) => w.id);
}

export function hasBonusOption(data: GameData, state: GameState, seat: Seat): boolean {
  return visitOptions(data, state, seat).length > 0 || workOwnOptions(data, state, seat).length > 0;
}

/**
 * The unified visit: 1 card from hand onto the host's Notice Board, then
 * either the printed coins (to the VISITOR) or one of the host's Workers
 * (wage minted to the HOST). A full board refuses the whole visit.
 */
export function doVisit(
  fx: Fx,
  visitor: Seat,
  host: Seat,
  fee: CardId,
  payoff: { mode: 'coin' } | { mode: 'worker'; workerId: WorkerAction },
): void {
  if (visitor === host) throw new Error('You may never visit your own farm');
  const state = fx.state;
  if (state.turn.bonusSpent) throw new Error('Bonus slot already spent this turn');
  const board = noticeBoardOf(fx.data, state, host);

  if (payoff.mode === 'worker') {
    const worker = workerState(state, payoff.workerId);
    if (worker.owner !== host) throw new Error(`Worker ${payoff.workerId} is not the host's`);
    if (!workerActionLegal(fx.data, state, visitor, payoff.workerId, { excludingHandCard: fee })) {
      throw new Error(`Worker ${payoff.workerId} has nothing legal to do for seat ${visitor}`);
    }
  }

  fx.placeOnBuilding(visitor, { seat: host, card: board.card }, fee);
  state.turn.bonusSpent = true;

  if (payoff.mode === 'coin') {
    const rates = fx.data.rules.economy.visitPayout;
    fx.gainCoins(visitor, board.upgraded ? rates.upgraded : rates.base, 'visit');
    fx.emit({ e: 'visited', seat: visitor, host, mode: 'coin' });
  } else {
    state.turn.visit = { host, workerId: payoff.workerId, repeats: 0 };
    fx.emit({ e: 'visited', seat: visitor, host, mode: 'worker' });
    workWorker(fx, visitor, payoff.workerId, { progress: true });
  }
}

/** The bonus slot's other half: work your own Worker. Free, no wage. */
export function doWorkOwn(fx: Fx, seat: Seat, workerId: WorkerAction): void {
  if (fx.state.turn.bonusSpent) throw new Error('Bonus slot already spent this turn');
  if (workerState(fx.state, workerId).owner !== seat) {
    throw new Error(`Worker ${workerId} is not yours`);
  }
  fx.state.turn.bonusSpent = true;
  workWorker(fx, seat, workerId, { progress: true });
}

// --- The main-action umbrella ---------------------------------------------

/** Is ANY main action legal? Decides whether `pass` is offered (and nothing else is). */
export function hasMainOption(data: GameData, state: GameState, seat: Seat): boolean {
  return (
    drawableSuits(data, state).length > 0 ||
    anyBuildOption(data, state, seat) ||
    hireOptions(data, state, seat).length > 0 ||
    upgradeOptions(data, state, seat).length > 0 ||
    growOptions(data, state, seat).length > 0 ||
    harvestOptions(data, state, seat).length > 0 ||
    anyDeliverOption(data, state, seat) ||
    anyBalloonMoveOption(data, state, seat)
  );
}
