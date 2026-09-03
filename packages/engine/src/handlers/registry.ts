/**
 * The handler registry: card id -> CardHandler. Handlers are static objects,
 * registered once at module load; state and tasks reference cards by id and
 * this registry does the lookup, which is what keeps every Task and Move
 * serialisable.
 *
 * Ticket 05 registers the spanning set only. The bulk card build fills this
 * in per suit; when it completes, a test asserts every enabled card in the
 * catalogue has a handler (registry completeness is a test concern, not a
 * runtime one - an unregistered card simply has no behaviour yet).
 */

import { wireHookBus } from '../fx.js';
import type { CardId } from '../state.js';
import {
  apiaristsGuild,
  apiaryBarn,
  apiaryFarmstead,
  apiaryNoticeBoard,
  beekeepersVeil,
  crossPollinator,
  foragingHive,
  gardenHive,
  herbHive,
  honeycombTower,
  honeyHall,
  honeyHut,
  meadowHive,
  pollinatorTrail,
  queensHive,
  royalApiary,
  smokePot,
  waxHall,
  waxWorkshop,
  wildHive,
} from './apiary.js';
import {
  abundantShed,
  butterFactory,
  cheeseHall,
  cheeseVault,
  churningShed,
  countingHouse,
  creamRefinery,
  dairyBarn,
  dairyFarmstead,
  dairyNoticeBoard,
  grandCreamery,
  heritageHouse,
  ledger,
  milkingShed,
  prosperityWagon,
  refinery,
  scoutsPost,
  strongbox,
  tradingShed,
  versatileShed,
} from './dairy.js';
import { helpingHand, wireHelpingHand } from './helpingHand.js';
import type { CardHandler } from './types.js';
import {
  appleOrchard,
  cherryOrchard,
  ciderHouse,
  conservatory,
  cropDiversity,
  fruitBasket,
  fruitHall,
  fruitPress,
  fruitStand,
  fruitStore,
  gardenLibrary,
  goldenOrchard,
  harvestFestival,
  harvestMarket,
  heritageOrchard,
  orchardBarn,
  orchardFarmstead,
  orchardNoticeBoard,
  pearOrchard,
  seedBank,
} from './orchard.js';
import {
  auctionHouse,
  coastalTradingDepot,
  distributionCenter,
  dockworkersUnion,
  exportDepot,
  grandMarketplace,
  harvestLedger,
  internationalPort,
  marketGazette,
  marketMaster,
  marketSignalTower,
  marketStallDepot,
  merchantGuild,
  regionalDepot,
  supplyHouse,
  tradeDepot,
  tradingCommission,
  vegetableBarn,
  vegetableFarmstead,
  vegetableNoticeBoard,
} from './vegetable.js';
import {
  bakehouse,
  bakery,
  barleyField,
  breadHall,
  cropRotation,
  furrow,
  goldenField,
  granary,
  grandGranary,
  heritageField,
  millHouse,
  patisserie,
  pieShop,
  pizzeria,
  ryeField,
  wheatBarn,
  wheatExchange,
  wheatFarmstead,
  wheatField,
  wheatNoticeBoard,
} from './wheat.js';

// ⛔ THE FIVE SERVICE STARTERS (W0/V0/O0/A0/D0) AND `service.ts` ARE GONE
// (v31). The card stopped existing on 20/08/2026, when change 6 merged the door
// into the Notice Board, but the five registrations outlived it because they
// cost nothing to leave in place. They are removed now for the reason the
// `actionMoves` tombstone in types.ts gives: a registration for a card the
// catalogue does not carry reads as an oversight rather than as a decision, and
// it is how a retired concept comes back one entry at a time with nobody
// choosing to bring it. `registeredCards()` is asserted against the live
// catalogue in vegetable.test.ts, which is what would have caught it.
const HANDLERS = new Map<CardId, CardHandler>([
  // Wheat - the full suit (ticket 18).
  ['W1', wheatBarn],
  ['W2', wheatFarmstead],
  ['W3', wheatNoticeBoard],
  ['W4', wheatField],
  ['W5', ryeField],
  ['W6', barleyField],
  ['W7', goldenField],
  ['W8', heritageField],
  ['W9', millHouse],
  ['W10', furrow],
  ['W11', bakehouse],
  ['W12', cropRotation],
  ['W13', bakery],
  ['W14', pizzeria],
  ['W15', patisserie],
  ['W16', granary],
  ['W17', pieShop],
  ['W19', wheatExchange],
  ['W20', grandGranary],
  ['W21', breadHall],
  // Vegetable - the full suit plus the Aerodrome module (ticket 19).
  ['V1', vegetableBarn],
  ['V2', vegetableFarmstead],
  ['V3', vegetableNoticeBoard],
  ['V4', marketStallDepot],
  ['V5', coastalTradingDepot],
  ['V6', tradeDepot],
  ['V7', exportDepot],
  ['V8', regionalDepot],
  ['V9', merchantGuild],
  ['V10', supplyHouse],
  ['V11', marketMaster],
  ['V12', auctionHouse],
  ['V13', grandMarketplace],
  ['V14', distributionCenter],
  ['V15', internationalPort],
  ['V16', marketSignalTower],
  ['V17', dockworkersUnion],
  ['V19', marketGazette],
  ['V20', tradingCommission],
  ['V21', harvestLedger],
  // Orchard - the full suit (ticket 20).
  ['O1', orchardBarn],
  ['O2', orchardFarmstead],
  ['O3', orchardNoticeBoard],
  ['O4', appleOrchard],
  ['O5', pearOrchard],
  ['O6', cherryOrchard],
  ['O7', goldenOrchard],
  ['O8', heritageOrchard],
  ['O9', fruitStand],
  ['O10', ciderHouse],
  ['O11', harvestMarket],
  ['O12', fruitPress],
  ['O13', seedBank],
  ['O14', conservatory],
  ['O15', gardenLibrary],
  ['O16', fruitStore],
  ['O17', fruitBasket],
  ['O19', fruitHall],
  ['O20', cropDiversity],
  ['O21', harvestFestival],
  // Apiary - the full suit (ticket 21; A4/A5 date from the spanning set).
  ['A1', apiaryBarn],
  ['A2', apiaryFarmstead],
  ['A3', apiaryNoticeBoard],
  ['A4', herbHive],
  ['A5', meadowHive],
  ['A6', gardenHive],
  ['A7', foragingHive],
  ['A8', wildHive],
  ['A9', pollinatorTrail],
  ['A10', crossPollinator],
  ['A11', waxWorkshop],
  ['A12', honeyHut],
  ['A13', queensHive],
  ['A14', honeycombTower],
  ['A15', royalApiary],
  ['A16', beekeepersVeil],
  ['A17', smokePot],
  ['A19', honeyHall],
  ['A20', apiaristsGuild],
  ['A21', waxHall],
  // Dairy - the full suit (ticket 22).
  ['D1', dairyBarn],
  ['D2', dairyFarmstead],
  ['D3', dairyNoticeBoard],
  ['D4', milkingShed],
  ['D5', churningShed],
  ['D6', tradingShed],
  ['D7', versatileShed],
  ['D8', abundantShed],
  ['D9', prosperityWagon],
  ['D10', scoutsPost],
  ['D11', heritageHouse],
  ['D12', butterFactory],
  ['D13', cheeseVault],
  ['D14', creamRefinery],
  ['D15', grandCreamery],
  ['D16', ledger],
  ['D17', strongbox],
  ['D19', cheeseHall],
  ['D20', countingHouse],
  ['D21', refinery],
  // One Power card per suit, shared name, identical text on all five copies -
  // one handler object, five registrations.
  ['W18', helpingHand],
  ['V18', helpingHand],
  ['O18', helpingHand],
  ['A18', helpingHand],
  ['D18', helpingHand],
]);

export function handlerFor(card: CardId): CardHandler | undefined {
  return HANDLERS.get(card);
}

export function registeredCards(): CardId[] {
  return [...HANDLERS.keys()];
}

// The hook bus lives in fx.ts (primitives fire hooks) but needs this lookup;
// wiring it here avoids a value cycle between the two modules.
wireHookBus(handlerFor);

// The same pattern, for the same reason: `bonusSlotsFor` (actions.ts) has to ask
// whether a seat has built A Helping Hand, and actions.ts may not import this
// registry - helpingHand.ts imports actions.ts, so a value cycle between the two
// would be fragile. Unwired, the printed one-bonus-a-turn rule stands on its own
// and every test that never builds a Helping Hand behaves identically.
wireHelpingHand();
