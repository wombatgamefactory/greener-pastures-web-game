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

import { cardById, canTakeCard, drawableSuits, player } from './query.js';
import { shuffle } from './rng.js';
import type { CardId, GameEvent, GameState, IslandTileState, Seat, Task } from './state.js';

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

  /**
   * A choiceless draw straight to hand: the seat's own suit while it lasts,
   * else the first drawable suit (the reference's own-suit-fallback shape,
   * DL-64/DL-67). Used by effects whose draws must not open a picker or fire
   * the draw reactors - O16's keeper draws, the gift family's refills - so a
   * gift can never re-gift and O17 can never fire on them. Under-delivers
   * quietly when the table runs dry.
   */
  autoDraw(seat: Seat, n: number): void {
    for (let i = 0; i < n; i++) {
      const drawable = drawableSuits(this.data, this.state);
      if (drawable.length === 0) return;
      const own = player(this.state, seat).suit;
      const suit = drawable.includes(own) ? own : (drawable[0] as Suit);
      const card = this.takeDeckTop(suit);
      if (card === null) return;
      this.cardsToHand(seat, [card]);
    }
  }

  /**
   * Move one card OUT OF A HAND into another hand (O6, O9). Identity travels
   * with it, and so does the cost: `fromHand: true` is what tells a bot the
   * giver is genuinely a card down, unlike the divert seam's `passCard`.
   */
  giveCard(from: Seat, to: Seat, card: CardId): void {
    if (from === to) throw new Error('A gift goes to a neighbour, never yourself');
    this.removeFromHand(from, card);
    this.touch(to);
    player(this.state, to).hand.push(card);
    this.emit({ e: 'cardGifted', from, to, card, fromHand: true });
  }

  /**
   * The DIVERT SEAM's two destinations for a card in LIMBO - lifted out of a
   * reveal or out of a hand and not yet in any pile (see the `divert` task).
   *
   * Neither can reuse `giveCard` or `handToBarn`, which both start by removing
   * the card from a hand it is no longer in. The EVENTS are deliberately the
   * same ones: `cardGifted` still counts every card that crossed the table and
   * `handToBarn` still counts every card that reached a barn by a route other
   * than the harvest, so no metric has to learn a second name for the same
   * movement.
   */
  passCard(from: Seat, to: Seat, card: CardId): void {
    if (from === to) throw new Error('A gift goes to a neighbour, never yourself');
    this.touch(to);
    player(this.state, to).hand.push(card);
    this.emit({ e: 'cardGifted', from, to, card, fromHand: false });
  }

  /** A card in limbo straight into its holder's barn (O17's £1 divert). */
  stashCard(seat: Seat, card: CardId): void {
    this.touch(seat);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'handToBarn', seat, card });
  }

  /** Move one card from a seat's hand into their own barn (O12's press). */
  handToBarn(seat: Seat, card: CardId): void {
    this.removeFromHand(seat, card);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'handToBarn', seat, card });
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

  /**
   * D6 The Trading Shed: a face-up discarded card into a NEIGHBOUR's hand -
   * "give 1 card you spend to a neighbour".
   *
   * A sibling of `giveCard` rather than a branch inside it, for the same reason
   * `passCard` is: the card is not in anybody's hand by the time this runs (its
   * build already spent it), so the removal step would throw. The EVENT is the
   * shared one, with `fromHand: false` - the giver is genuinely not a card down,
   * because that card was on its way to a discard pile either way, and pricing
   * it as a loss is what would make the plain build strictly better and the
   * power never fire.
   */
  discardToHand(from: Seat, to: Seat, card: CardId): void {
    if (from === to) throw new Error('A gift goes to a neighbour, never yourself');
    const suit = cardById(this.data, card).suit;
    const pile = this.state.discards[suit];
    const i = pile.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} discard`);
    pile.splice(i, 1);
    this.touch(to);
    player(this.state, to).hand.push(card);
    this.emit({ e: 'cardGifted', from, to, card, fromHand: false });
  }

  /**
   * Pull a face-up card out of its suit's discard into a barn (the upgraded
   * Vegetable Barn's freight refund reclaims a just-spent delivery card).
   */
  reclaimDiscard(seat: Seat, card: CardId): void {
    this.touch(seat);
    const suit = cardById(this.data, card).suit;
    const pile = this.state.discards[suit];
    const i = pile.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} discard`);
    pile.splice(i, 1);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'discardToBarn', seat, card });
  }

  /**
   * Top of a deck straight onto one of the seat's own buildings - the Apiary
   * Service's sow. The sown card never passes through a hand, which is the whole
   * economic point: a hand-sow would cost a visitor the fee card AND the sown
   * card for one threshold step.
   *
   * Lands through the same tail as every other placement, so the placement
   * reactors fire identically. No-op when the suit is exhausted.
   */
  deckTopToBuilding(seat: Seat, suit: Suit, onto: CardId): void {
    const building = this.buildingDraft({ seat, card: onto });
    if (!canTakeCard(this.data, building)) {
      throw new Error(`${onto} cannot take a card (full or no stack)`);
    }
    const card = this.takeDeckTop(suit);
    if (card === null) return;
    this.land(seat, { seat, card: onto }, card);
  }

  /**
   * D10 The Scout's Post: a revealed-but-unbuilt deck top goes back where it
   * came from, face down on top of its own deck.
   *
   * RULED (2026-08-10): the Scout's Post reveals every deck and discards
   * nothing. Discarding four cards an activation would make it the heaviest
   * deck-top consumer in the game; returning them makes it a free look, which
   * is what the word "Scout" means. Silent, because a card going back to where
   * it was is not a movement anything downstream can act on.
   */
  returnToDeckTop(suit: Suit, card: CardId): void {
    this.state.decks[suit].unshift(card);
  }

  /**
   * D7 The Versatile Shed: lift a card off one of the seat's OWN stacks in
   * order to SPEND it on a build.
   *
   * Deliberately neither `stackCardToBarn` (which is freight, and this card's
   * whole point is the fork - a card on a stack is either freight or building
   * material and never both) nor `harvest` (which fires afterHarvest; these
   * cards are spent, not harvested, and no harvest hook may fire). The caller
   * discards them with the rest of the payment.
   */
  spendFromStack(seat: Seat, card: CardId): void {
    this.touch(seat);
    for (const b of player(this.state, seat).tableau) {
      const i = b.stack.indexOf(card);
      if (i >= 0) {
        b.stack.splice(i, 1);
        return;
      }
    }
    throw new Error(`${card} is not on any of seat ${seat}'s buildings`);
  }

  /** Top of a deck straight into a barn (the Patisserie / Meadow Hive shape). No-op when the suit is exhausted. */
  deckTopToBarn(seat: Seat, suit: Suit): void {
    const card = this.takeDeckTop(suit);
    if (card === null) return;
    this.touch(seat);
    player(this.state, seat).barn.push(card);
    this.emit({ e: 'deckToBarn', seat, suit, card });
  }

  // --- the island's demand tokens ----------------------------------------
  //
  // The first primitives in the game that write to the shared board rather than
  // to a player's own zones. Both are Vegetable's (V5 and V6) and nothing else
  // reaches them. Legality lives in actions.ts beside `tileHasRoom`, because it
  // is the same question every delivery path already asks; these two verbs do
  // the moving and say so in the event stream.

  /**
   * V5 The Coastal Trading Depot: exchange the demand tokens on two crates.
   *
   * The FACE-DOWN FLAG TRAVELS WITH THE TOKEN, because physically it is the
   * token that moves - a blank token swapped onto another tile is still blank
   * there. Same tile is legal (the crates just trade places, which is a no-op the
   * enumerator declines to offer).
   */
  swapDemandTokens(
    seat: Seat,
    a: { tile: string; crate: number },
    b: { tile: string; crate: number },
  ): void {
    const ta = this.tileDraft(a.tile);
    const tb = this.tileDraft(b.tile);
    const ca = ta.crates[a.crate];
    const cb = tb.crates[b.crate];
    if (ca === undefined) throw new Error(`Tile ${a.tile} has no crate ${a.crate}`);
    if (cb === undefined) throw new Error(`Tile ${b.tile} has no crate ${b.crate}`);
    const downA = ta.faceDown?.[a.crate] === true;
    const downB = tb.faceDown?.[b.crate] === true;
    ta.crates[a.crate] = cb;
    tb.crates[b.crate] = ca;
    this.setFaceDown(ta, a.crate, downB);
    this.setFaceDown(tb, b.crate, downA);
    this.emit({ e: 'demandSwapped', seat, a: { ...a }, b: { ...b } });
  }

  /**
   * V6 The Trade Depot: turn one demand token face down, after which it accepts
   * cards of any crops at the normal rate. Idempotence is not silently allowed -
   * turning an already-blank token is a wasted effect, so the enumerator never
   * offers it and this throws if it is asked for anyway.
   */
  turnDemandFaceDown(seat: Seat, tileId: string, crate: number): void {
    const tile = this.tileDraft(tileId);
    if (tile.crates[crate] === undefined) throw new Error(`Tile ${tileId} has no crate ${crate}`);
    if (tile.faceDown?.[crate] === true)
      throw new Error(`${tileId} crate ${crate} is already down`);
    this.setFaceDown(tile, crate, true);
    this.emit({ e: 'demandFaceDown', seat, tile: tileId, crate });
  }

  /** Write one entry of a tile's parallel flags, materialising the array on first use. */
  private setFaceDown(tile: IslandTileState, crate: number, down: boolean): void {
    if (!down && tile.faceDown === undefined) return;
    tile.faceDown ??= tile.crates.map(() => false);
    tile.faceDown[crate] = down;
  }

  private tileDraft(tileId: string): IslandTileState {
    const tile = this.state.island.tiles.find((t) => t.tile === tileId);
    if (!tile) throw new Error(`Tile ${tileId} is not in play`);
    return tile;
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
    this.land(from, onto, card);
  }

  /**
   * Sow a face-up discarded card onto a building - A6 The Garden Hive (the top
   * of any pile) and D5 The Churning Shed (a card it just spent). Same landing
   * tail as placeOnBuilding, so the placement reactors fire identically. The
   * CALLER decides which card qualifies, which is what keeps the
   * discard-ordering principle a card-text question and not an engine one.
   */
  placeFromDiscard(from: Seat, onto: CardInPlay, card: CardId): void {
    const building = this.buildingDraft(onto);
    if (!canTakeCard(this.data, building)) {
      throw new Error(`${onto.card} cannot take a card (full or no stack)`);
    }
    const suit = cardById(this.data, card).suit;
    const pile = this.state.discards[suit];
    const i = pile.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} discard`);
    pile.splice(i, 1);
    this.land(from, onto, card);
  }

  private land(from: Seat, onto: CardInPlay, card: CardId): void {
    const building = this.buildingDraft(onto);
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

  // --- tableau surgery (Dairy) -------------------------------------------

  /**
   * D11 The Heritage House: the covered card leaves the tableau for the
   * player's `covered` pile. It is no longer a building - invisible to every
   * endgame formula, every count, every placement - but its printed VP still
   * scores, as a bare sum (the reference's cover semantics).
   *
   * The empty-stack guard STAYS an assertion after the 2026-08-10 retext. D11
   * now targets a loaded building, but it ships that building's cards to the
   * barn before covering it, so nothing is ever buried; the throw is what keeps
   * that ordering from silently reversing.
   */
  coverBuilding(seat: Seat, building: CardId): void {
    this.touch(seat);
    const p = player(this.state, seat);
    const i = p.tableau.findIndex((b) => b.card === building);
    if (i < 0) throw new Error(`Seat ${seat} has not built ${building}`);
    const b = p.tableau[i] as { card: CardId; stack: CardId[]; upgraded: boolean };
    if (b.stack.length > 0) throw new Error(`${building} is not empty`);
    p.tableau.splice(i, 1);
    p.covered.push(building);
    this.emit({ e: 'covered', seat, card: building });
  }

  /**
   * D14 The Cream Refinery: a building of yours leaves the tableau for your
   * barn, where it becomes ordinary delivery freight. Unlike a cover it scores
   * no printed VP - it is not a building any more, it is stock, so it stops
   * counting for D13, D20 and D21 too.
   *
   * Same empty-stack assertion as `coverBuilding`, and same reason: D14 puts
   * the building's own cards into the barn first, and the throw is what stops
   * that order reversing unnoticed.
   */
  demolish(seat: Seat, building: CardId): void {
    this.touch(seat);
    const p = player(this.state, seat);
    const i = p.tableau.findIndex((b) => b.card === building);
    if (i < 0) throw new Error(`Seat ${seat} has not built ${building}`);
    const b = p.tableau[i] as { card: CardId; stack: CardId[]; upgraded: boolean };
    if (b.stack.length > 0) throw new Error(`${building} is not empty`);
    p.tableau.splice(i, 1);
    p.barn.push(building);
    this.emit({ e: 'demolished', seat, card: building });
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
  /**
   * Any Deliver: an island delivery (island: true, tile set) or a balloon move
   * (island: false) - both, because moving a balloon IS the Deliver action
   * (DL-12). `cards` are the ids actually spent ([] for a free card-effect
   * move), so the freight-refund family can reclaim one. Island-only cards
   * (V16) guard on `island`; the Vegetable Farmstead deliberately does not.
   */
  afterDeliver: { seat: Seat; island: boolean; tile?: string; cards: CardId[] };
  /** A balloon changed Aerodrome. `from` is where it left - V17 draws when that was its owner's port. */
  afterBalloonMove: { seat: Seat; balloon: string; from: Seat | 'centre' };
  /**
   * A visit landed on the host's Notice Board (fee placed, slot spent), fired
   * before the payoff resolves - O16 The Orchard Keeper reacts host-side in
   * every visit branch. Once per visit, so the 2-card `special` mode fires it
   * once, not twice. A Helping Hand repeat is not a visit and never fires this.
   */
  afterVisit: { visitor: Seat; host: Seat; mode: 'coin' | 'worker' | 'special' };
  /**
   * A see-N/keep-K draw finished and the kept cards entered the hand - the
   * reference's onDraw moment (keepFromReveal). Fires for the Draw action,
   * the Draw Worker and card-ability draws alike; autoDraw never fires it.
   */
  afterDrawKeep: { seat: Seat; cards: CardId[] };
  /**
   * A Service was ACTIVATED - any path: the bonus slot, a visit's payoff, a
   * Helping Hand repeat, a card-granted work (`free: true` when no card was
   * placed on it). A17 The Smoke Pot reacts owner-side when `actor !== owner`;
   * D17 The Strongbox reacts actor-side on every activation.
   */
  afterWork: { actor: Seat; owner: Seat; workerId: string; free: boolean };
  /**
   * A card landed in a tableau, by ANY path - the Build action, a Worker's
   * build, a card-granted or free build. `src` is the card whose ability caused
   * it (null for the plain action), which is how D5 and D6 react to their OWN
   * build while D16 The Ledger reacts to every one.
   */
  afterBuild: { seat: Seat; card: CardId; payment: CardId[]; src: CardId | null };
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
