/**
 * Fx - the primitive vocabulary. Every card handler is written in these verbs
 * and nothing else; a handler never touches GameState fields directly. The bar
 * for adding a verb is high: a primitive only one card uses is not a primitive,
 * it is that card's handler being too clever.
 *
 * An Fx wraps a DRAFT state (the entry point cloned it), mutates it in place,
 * and accumulates the event stream. Choice points are never resolved here:
 * a primitive that needs an answer pushes a Task and returns.
 *
 * The audit block exists for the difficulty schema: tests verify a handler's
 * declared flags (prompts, crossPlayer) against what its primitives actually
 * did, so the flags cannot drift from the code.
 */

import type { GameData, Suit } from '@gp/data';

import { cardById, canTakeCard, player } from './query.js';
import { shuffle } from './rng.js';
import type { CardId, GameEvent, GameState, Seat, Task } from './state.js';

/** A built card owned by a seat - the `self` every handler callback receives. */
export interface CardInPlay {
  seat: Seat;
  card: CardId;
}

export interface FxAudit {
  tasksPushed: number;
  /** True once any primitive targeted a seat other than the actor. */
  crossSeat: boolean;
}

export class Fx {
  readonly data: GameData;
  readonly state: GameState;
  readonly events: GameEvent[] = [];
  /** The seat whose effect is running; used for the crossSeat audit only. */
  readonly actor: Seat;
  readonly audit: FxAudit = { tasksPushed: 0, crossSeat: false };

  constructor(data: GameData, draft: GameState, actor: Seat) {
    this.data = data;
    this.state = draft;
    this.actor = actor;
  }

  private touch(seat: Seat): void {
    if (seat !== this.actor) this.audit.crossSeat = true;
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  // --- coins -------------------------------------------------------------

  /** Mint from the bank. Coins are created, never moved between players. */
  gainCoins(seat: Seat, n: number, why: string): void {
    if (n <= 0) return;
    this.touch(seat);
    player(this.state, seat).coins += n;
    this.emit({ e: 'coins', seat, delta: n, why });
  }

  payCoins(seat: Seat, n: number, why: string): void {
    if (n <= 0) return;
    this.touch(seat);
    const p = player(this.state, seat);
    if (p.coins < n) throw new Error(`Seat ${seat} cannot pay £${n} (has £${p.coins})`);
    p.coins -= n;
    this.emit({ e: 'coins', seat, delta: -n, why });
  }

  // --- decks and discards ------------------------------------------------

  /**
   * Take the top card of a suit's deck, reshuffling that suit's discard into
   * the deck if the deck is empty (the natural reshuffle - decks never mix).
   * Returns null when both are empty.
   */
  takeDeckTop(suit: Suit): CardId | null {
    const deck = this.state.decks[suit];
    const discard = this.state.discards[suit];
    if (deck.length === 0 && discard.length > 0) {
      deck.push(...shuffle(this.state.rng, discard.splice(0)));
      this.emit({ e: 'reshuffled', suit, count: deck.length });
    }
    return deck.shift() ?? null;
  }

  discard(cards: CardId[]): void {
    for (const id of cards) {
      const suit = cardById(this.data, id).suit;
      this.state.discards[suit].push(id);
      this.emit({ e: 'cardsDiscarded', suit, cards: [id] });
    }
  }

  // --- hands and barns ---------------------------------------------------

  cardsToHand(seat: Seat, cards: CardId[]): void {
    if (cards.length === 0) return;
    this.touch(seat);
    player(this.state, seat).hand.push(...cards);
    this.emit({ e: 'cardsToHand', seat, cards });
  }

  removeFromHand(seat: Seat, card: CardId): void {
    this.touch(seat);
    const hand = player(this.state, seat).hand;
    const i = hand.indexOf(card);
    if (i < 0) throw new Error(`Card ${card} is not in seat ${seat}'s hand`);
    hand.splice(i, 1);
  }

  /**
   * Spend barn cards by per-suit tally (barn identity is inert): the first
   * matching ids leave the barn for their suits' discards. The Deliver funnel
   * and the balloon move both pay through here.
   */
  spendFromBarn(seat: Seat, spend: Partial<Record<Suit, number>>): CardId[] {
    this.touch(seat);
    const barn = player(this.state, seat).barn;
    const taken: CardId[] = [];
    for (const [suit, count] of Object.entries(spend) as [Suit, number][]) {
      for (let i = 0; i < count; i++) {
        const at = barn.findIndex((id) => cardById(this.data, id).suit === suit);
        if (at < 0) throw new Error(`Seat ${seat}'s barn has no ${suit} card left to spend`);
        taken.push(...barn.splice(at, 1));
      }
    }
    this.discard(taken);
    return taken;
  }

  /**
   * Lift ONE card out of a building's stack into its owner's barn (the
   * Pizzeria shape; the Dairy/Orchard stack-manipulation cards share it).
   * Not a harvest: the building may reopen, but no on-harvest passive fires.
   */
  stackCardToBarn(seat: Seat, building: CardId, card: CardId): void {
    this.touch(seat);
    const b = this.buildingDraft({ seat, card: building });
    const i = b.stack.indexOf(card);
    if (i < 0) throw new Error(`${card} is not on ${building}'s stack`);
    b.stack.splice(i, 1);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'stackToBarn', seat, building, card });
  }

  /** Top of a deck straight into a barn (the Patisserie / Meadow Hive shape). No-op when the suit is exhausted. */
  deckTopToBarn(seat: Seat, suit: Suit): void {
    const card = this.takeDeckTop(suit);
    if (card === null) return;
    this.touch(seat);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'deckToBarn', seat, suit, card });
  }

  // --- the placement funnel ----------------------------------------------

  /**
   * The one funnel every placement goes through - grow payments, sows, visit
   * fees. Ticket 03 found the reference gets its placement-reactive cards
   * (Beekeeper's Veil, W4 auto-harvest) right by having exactly one such
   * funnel; those tails attach here when their handlers land.
   */
  placeOnBuilding(from: Seat, onto: CardInPlay, card: CardId): void {
    const building = this.buildingDraft(onto);
    if (!canTakeCard(this.data, building)) {
      throw new Error(`${onto.card} cannot take a card (full or no stack)`);
    }
    this.removeFromHand(from, card);
    this.touch(onto.seat);
    building.stack.push(card);
    this.emit({
      e: 'cardPlaced',
      seat: from,
      onto: { seat: onto.seat, building: onto.card },
      card,
    });
    fireHook(this, 'afterPlacement', {
      seat: from,
      onto,
      card,
      stackSize: building.stack.length,
    });
  }

  // --- harvest -----------------------------------------------------------

  /**
   * Take a building's whole stack into its owner's barn. Harvest scores no VP
   * and is not gated on fullness here - card effects may harvest early (Wheat's
   * Farmstead); action-level "must be full" gating belongs to legalMoves.
   */
  harvest(seat: Seat, buildingCard: CardId): void {
    this.touch(seat);
    const building = this.buildingDraft({ seat, card: buildingCard });
    const cards = building.stack.splice(0);
    player(this.state, seat).barn.push(...cards);
    this.emit({ e: 'harvested', seat, building: buildingCard, cards });
    fireHook(this, 'afterHarvest', { seat, building: buildingCard, cards });
  }

  // --- tasks -------------------------------------------------------------

  /** Queue a choice for later. Only choices queue; immediate effects run inline. */
  pushTask(task: Task): void {
    this.audit.tasksPushed += 1;
    this.state.tasks.push(task);
  }

  /** Jump the queue - for gate-then-steps cards whose steps must run first. */
  prependTask(task: Task): void {
    this.audit.tasksPushed += 1;
    this.state.tasks.unshift(task);
  }

  // --- internals ---------------------------------------------------------

  private buildingDraft(ref: CardInPlay) {
    const b = player(this.state, ref.seat).tableau.find((x) => x.card === ref.card);
    if (!b) throw new Error(`Seat ${ref.seat} has not built ${ref.card}`);
    return b;
  }
}

// --- the hook bus ---------------------------------------------------------

/** Payloads for the passive-trigger hooks the primitives fire. */
export interface HookEvents {
  afterHarvest: { seat: Seat; building: CardId; cards: CardId[] };
  afterPlacement: { seat: Seat; onto: CardInPlay; card: CardId; stackSize: number };
}

export type HookName = keyof HookEvents;

/**
 * Broadcast a hook to every built card with a matching listener. Scope is the
 * LISTENER's job: a "whenever you harvest" card guards `e.seat === self.seat`
 * itself, because scopes vary per card (placer-scoped, owner-scoped,
 * target-scoped) and a clever bus would guess wrong.
 */
export function fireHook<K extends HookName>(fx: Fx, hook: K, event: HookEvents[K]): void {
  for (let seat = 0; seat < fx.state.players.length; seat++) {
    for (const building of player(fx.state, seat).tableau) {
      const handler = handlerLookup?.(building.card);
      const listener = handler?.on?.[hook];
      if (listener) listener(fx, event, { seat, card: building.card });
    }
  }
}

/**
 * Set by the handlers module at import time. Indirection, not laziness: the
 * hook bus needs the registry, the registry's handlers need Fx's types, and a
 * value cycle between the two modules would be fragile.
 */
type HandlerLookup = (card: CardId) => HookCapable | undefined;
interface HookCapable {
  on?: {
    [K in HookName]?: (fx: Fx, event: HookEvents[K], self: CardInPlay) => void;
  };
}
let handlerLookup: HandlerLookup | null = null;

export function wireHookBus(lookup: HandlerLookup): void {
  handlerLookup = lookup;
}
