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
import { helpingHand } from './helpingHand.js';
import type { CardHandler } from './types.js';
import {
  appleOrchard,
  cherryOrchard,
  ciderHouse,
  conservatory,
  fruitBasket,
  fruitHall,
  fruitPress,
  fruitStand,
  gardenLibrary,
  goldenOrchard,
  grandOrchard,
  harvestFestival,
  harvestMarket,
  heritageOrchard,
  orchardArchive,
  orchardBarn,
  orchardFarmstead,
  orchardKeeper,
  orchardNoticeBoard,
  pearOrchard,
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
  ['O13', grandOrchard],
  ['O14', conservatory],
  ['O15', gardenLibrary],
  ['O16', orchardKeeper],
  ['O17', fruitBasket],
  ['O19', fruitHall],
  ['O20', orchardArchive],
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
