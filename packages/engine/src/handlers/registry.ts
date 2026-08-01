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
import { herbHive, meadowHive } from './apiary.js';
import { helpingHand } from './helpingHand.js';
import type { CardHandler } from './types.js';
import { bakery, pieShop, wheatExchange } from './wheat.js';

const HANDLERS = new Map<CardId, CardHandler>([
  ['W13', bakery],
  ['W17', pieShop],
  ['W19', wheatExchange],
  ['A4', herbHive],
  ['A5', meadowHive],
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
