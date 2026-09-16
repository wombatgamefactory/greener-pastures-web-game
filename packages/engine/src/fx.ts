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
import { isMeepleCurrency } from '@gp/data';

import { cardById, canTakeCard, drawableSuits, noticeBoardSlots, player } from './query.js';
import { shuffle } from './rng.js';
import type {
  CardId,
  DoorAction,
  GameEvent,
  GameState,
  IslandTileState,
  Receipt,
  Seat,
  Task,
} from './state.js';

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

  // --- meeples -----------------------------------------------------------
  //
  // ⛔ `gainCoins` and `payCoins` stood here and are GONE (v31). They were the
  // busiest pair of primitives in the file. The pair below is NOT their
  // replacement in kind: coins were fungible, continuous and could be saved
  // indefinitely, while a meeple is one of five colours, buys exactly one
  // specific action, and leaves the game when it is used. Nothing mints a
  // meeple; the island's 3 and 4 VP tokens are the only source (a WORKER on
  // each, since 16/09/2026), seeded once at setup from a bag of 25.

  /**
   * Claim a meeple into a seat's supply: a Worker off an island token
   * (`finishDelivery`, with the token's VP) or off your own Notice Board
   * (`collectBoard` below routes through here, with no tile and no VP).
   *
   * ⭐ THE SUPPLY CAP IS APPLIED HERE AND NOWHERE ELSE (R4). A meeple of a
   * colour the seat is already at the cap on is RETURNED TO THE BOX and
   * `meepleBoxed` is emitted INSTEAD of `meepleGained`, so the two events
   * partition every meeple ever offered to a supply and the leak is countable by
   * source. Returns true when the meeple was kept.
   *
   * ⭐ **THE SHIPPED RULE IS `null`, NO CAP AT ALL (Dean, 05/09/2026)**, so in
   * the shipped game this branch never fires and every meeple offered is kept.
   * The code stays because the cap is still one flag away and both the v1 loop
   * and the v31 control pin a number.
   *
   * ⚠️ THE CAP DOES NOT APPLY UNDER THE `'card'` GAME, whatever
   * `meepleCapPerColour` says. That is not an oversight and not a knob bug: in
   * v31 a spent meeple LEAVES the game, so the supply only ever shrinks and a
   * ceiling would be a rule change to the control arm. The cap exists because
   * the arm made meeples recirculate.
   */
  gainMeeple(
    seat: Seat,
    colour: Suit,
    tile: string | null,
    vp: number | null,
    source: 'island' | 'collect' = 'island',
  ): boolean {
    this.touch(seat);
    const p = player(this.state, seat);
    if (isMeepleCurrency(this.data)) {
      const cap = this.data.rules.turn.meepleCapPerColour;
      // `null` is NO CAP, shipped 05/09/2026: nothing a seat gains is ever
      // refused, and `meepleBoxed` from this source stops existing.
      if (cap !== null && p.meeples[colour] >= cap) {
        this.emit({ e: 'meepleBoxed', seat, colour, source });
        return false;
      }
    }
    p.meeples[colour] += 1;
    this.emit({ e: 'meepleGained', seat, colour, tile, vp });
    return true;
  }

  /**
   * THE MEEPLE VISIT (R1, R10): move one meeple - or a wild PAIR - out of the
   * visitor's supply and into the `colour` slot of the host's Notice Board.
   *
   * Both meeples of a pair land in the slot of the action bought, not in their
   * own colours' slots, which is what makes the wild spend cost the host
   * nothing extra to collect and keeps "a slot is blocked while a meeple sits in
   * it" a single-slot rule. Nothing leaves the game: the host takes them back.
   */
  placeMeepleOnBoard(visitor: Seat, host: Seat, colour: Suit, meeples: readonly Suit[]): void {
    this.touch(visitor);
    this.touch(host);
    const from = player(this.state, visitor);
    const slots = noticeBoardSlots(this.state, host);
    const slot = slots[colour];
    if (!slot) throw new Error(`Seat ${host} has no ${colour} slot`);
    for (const m of meeples) {
      if (from.meeples[m] < 1) throw new Error(`Seat ${visitor} has no ${m} meeple`);
      from.meeples[m] -= 1;
      slot.push(m);
    }
  }

  /**
   * COLLECT (R7): every meeple off this seat's own Notice Board into their
   * supply, through the cap.
   *
   * ⚠️ THE SLOTS ARE EMPTIED WHETHER OR NOT THE MEEPLE FITS. A boxed duplicate
   * still comes off the board, because the rule is "take the meeples off", not
   * "take the ones you can use" - leaving a refused meeple in the slot would
   * keep the host's own door shut for a colour they can never clear.
   */
  collectBoard(seat: Seat): { kept: Suit[]; boxed: Suit[] } {
    this.touch(seat);
    const slots = noticeBoardSlots(this.state, seat);
    const kept: Suit[] = [];
    const boxed: Suit[] = [];
    for (const colour of this.data.cards.suits) {
      const slot = slots[colour];
      if (!slot) continue;
      for (const meeple of slot.splice(0)) {
        if (this.gainMeeple(seat, meeple, null, null, 'collect')) kept.push(meeple);
        else boxed.push(meeple);
      }
    }
    this.emit({ e: 'boardCollected', seat, kept, boxed });
    return { kept, boxed };
  }

  /**
   * Spend a meeple: it leaves the supply and LEAVES THE GAME. There is no pool
   * to return it to, deliberately - it is a stored action, used once.
   *
   * ⚠️ THE `'card'` GAME'S PRIMITIVE ONLY. Its one caller is `doSpendMeeple`,
   * the turn-start spend, which the meeple-loop arm deletes outright (R8): under
   * the arm a meeple is spent by MOVING to a neighbour's board and never by
   * leaving the game, which is `placeMeepleOnBoard` above.
   *
   * The `meepleSpent` event is emitted by `doSpendMeeple` rather than here, so
   * that it carries the ACTION the colour bought alongside the colour itself.
   */
  spendMeeple(seat: Seat, colour: Suit): void {
    this.touch(seat);
    const p = player(this.state, seat);
    if (p.meeples[colour] < 1) throw new Error(`Seat ${seat} has no ${colour} meeple`);
    p.meeples[colour] -= 1;
  }

  /**
   * ⭐ BOX ONE MEEPLE (R15, R16, handoff v2): out of the supply and out of
   * the game, for a reason that is NOT the cap.
   *
   * This is the second half of the meeple economy and the half v1 did not have.
   * v1's loop was closed - a spent meeple moved to a neighbour and came back to
   * them on their Collect - and the only leak was the cap. v2 opens it: a meeple
   * spent as a card of its colour goes to the box wherever the card would have
   * gone, and a meeple paid as a slot toll goes to the box too. The island is
   * the faucet, this is the drain, and `pool by round` is the line that says
   * whether the two balance.
   *
   * ⚠️ IT EMITS `meepleBoxed` WITH A NON-CAP SOURCE AND NO `meepleGained`
   * BESIDE IT. Under v1 those two events partitioned every meeple offered to a
   * supply; they no longer do, and a reader that counts `meepleBoxed` without
   * splitting by source is now counting two different things at once.
   */
  boxMeeple(
    seat: Seat,
    colour: Suit,
    source: 'build' | 'activation' | 'delivery' | 'toll' | 'paymentToll',
  ): void {
    this.touch(seat);
    const p = player(this.state, seat);
    if (p.meeples[colour] < 1) throw new Error(`Seat ${seat} has no ${colour} meeple`);
    p.meeples[colour] -= 1;
    this.emit({ e: 'meepleBoxed', seat, colour, source });
  }

  /**
   * ⭐ R17 (Dean, 05/09/2026): A WHOLE MEEPLE PAYMENT, PLACED ON THE TABLE
   * RATHER THAN BOXED.
   *
   * The counterpart of `payMeeplesAsCards`, and the whole of the change. Under
   * handoff v2 a meeple spent as a card LEFT THE GAME, and the measurement
   * found that is what killed the loop: 18.27 meeples a game drained out
   * against 9.44 visits and the median supply in the last third hit 0.0. Here
   * the same meeple lands on ANOTHER player's Notice Board, in its own colour's
   * slot, and the host takes it back on their Collect - so the resource use
   * costs the payer a stored action and GIVES one to a neighbour, instead of
   * costing the table a component.
   *
   * ⛔ IT IS NOT A VISIT AND IT BUYS NO DOOR. `afterVisit` does not fire, no
   * `visited` event is emitted and the bonus slot is untouched (Dean,
   * 05/09/2026). The only thing that reaches the host is the meeple.
   *
   * `toll` is the extra meeples the placement owed for landing on occupied
   * slots. They are BOXED, and once resource spends stop being boxed they are
   * the only drain left in the game bar the supply cap.
   */
  placeMeeplesAsCards(
    seat: Seat,
    placements: readonly Partial<Record<Suit, number>>[],
    toll: Partial<Record<Suit, number>>,
    use: 'build' | 'activation' | 'delivery',
    opts: { wildPairs?: number; atThreshold?: boolean } = {},
  ): void {
    this.touch(seat);
    const from = player(this.state, seat);
    const atThreshold = opts.atThreshold === true;
    let wildLeft = 2 * (opts.wildPairs ?? 0);
    for (let host = 0; host < placements.length; host++) {
      const counts = placements[host];
      if (!counts) continue;
      // The array is indexed by SEAT and every seat has an entry, so the payer's
      // own is an EMPTY object rather than a hole. Emptiness has to be checked
      // before ownership or a payer's own zero entry reads as an illegal
      // self-placement.
      let placed = 0;
      for (const colour of this.data.cards.suits) placed += counts[colour] ?? 0;
      if (placed === 0) continue;
      if (host === seat) throw new Error('A paid meeple never lands on your own board');
      const slots = noticeBoardSlots(this.state, host as Seat);
      for (const colour of this.data.cards.suits) {
        const n = counts[colour] ?? 0;
        for (let i = 0; i < n; i++) {
          if (from.meeples[colour] < 1) throw new Error(`Seat ${seat} has no ${colour} meeple`);
          const slot = slots[colour];
          if (!slot) throw new Error(`Seat ${host} has no ${colour} slot`);
          from.meeples[colour] -= 1;
          slot.push(colour);
          this.touch(host as Seat);
          const wild = wildLeft > 0;
          if (wild) wildLeft -= 1;
          this.emit({ e: 'meepleAsCard', seat, colour, use, atThreshold, wild });
          this.emit({ e: 'meepleplaced', seat, host: host as Seat, colour, use });
        }
      }
    }
    for (const colour of this.data.cards.suits) {
      const n = toll[colour] ?? 0;
      for (let i = 0; i < n; i++) this.boxMeeple(seat, colour, 'paymentToll');
    }
  }

  /**
   * A whole meeple payment, boxed, with the R15 measurement events beside it.
   *
   * `counts` is a per-colour count and not a list, which is the shape the
   * enumerator uses all the way through. `wildPairs` is how many of those
   * meeples were spent two-as-one (R10), reported on each event so that a reader
   * can tell two meeples that bought two resources from two that bought one.
   * `atThreshold` is only ever true for an activation that a card could not have
   * made at all - a Grow on a building already at its threshold.
   */
  payMeeplesAsCards(
    seat: Seat,
    counts: Partial<Record<Suit, number>>,
    use: 'build' | 'activation' | 'delivery',
    opts: { wildPairs?: number; atThreshold?: boolean } = {},
  ): void {
    const atThreshold = opts.atThreshold === true;
    // The pair flag is per MEEPLE, and a pair is two of them, so the first
    // 2 * wildPairs meeples boxed carry it. Which colours they are is not a
    // decision the enumerator made - it made a count vector - so this is a
    // deterministic walk in suit order and nothing reads the pairing back.
    let wildLeft = 2 * (opts.wildPairs ?? 0);
    for (const colour of this.data.cards.suits) {
      const n = counts[colour] ?? 0;
      for (let i = 0; i < n; i++) {
        const wild = wildLeft > 0;
        if (wild) wildLeft -= 1;
        this.emit({ e: 'meepleAsCard', seat, colour, use, atThreshold, wild });
        this.boxMeeple(seat, colour, use);
      }
    }
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

  /**
   * Cards into a hand.
   *
   * ⭐ `via` IS OPTIONAL AND IS A LABEL: `'hostDraw'` is S17's (Dean,
   * 11/09/2026), the cards the OWNER of a visited Notice Board takes. It is
   * passed through to the event and nothing else - the
   * cards arrive in the hand identically either way, which is the point.
   * Omitted by every one of the dozen other callers, so the emitted event is
   * byte-identical to what it was for all of them.
   */
  cardsToHand(seat: Seat, cards: CardId[], via?: 'hostDraw'): void {
    if (cards.length === 0) return;
    this.touch(seat);
    player(this.state, seat).hand.push(...cards);
    // The key is ABSENT rather than present-and-undefined for an ordinary
    // draw, so a serialised event stream is byte-identical to what it was.
    this.emit(
      via === undefined
        ? { e: 'cardsToHand', seat, cards }
        : { e: 'cardsToHand', seat, cards, via },
    );
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
   * pays through here.
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
   * ⭐ "DISCARD A CARD FROM YOUR BARN" (v42, 16/09/2026: V8, V10, V12, V15).
   *
   * The player names a CROP, never a card: a barn is anonymous even to its
   * owner (see view.ts), so barn cards of one crop are interchangeable and the
   * first matching id goes. It lands face up on its own suit's discard, and
   * then `afterBarnDiscard` fires, which is what V17 The Dockworker's Union
   * listens to ("Whenever you discard a card from your Barn, Draw 1").
   *
   * ⛔ R6 (Dean, 15-16/09/2026): A DELIVERY PAYMENT IS NOT A DISCARD, so
   * `spendFromBarn` never comes through here, and neither does V14's
   * demolition (which discards a building's STACK, not a barn card). Only a
   * card effect that prints "discard ... from your Barn" calls this.
   *
   * `src` is the card whose text caused it, carried on the event and the hook.
   */
  discardFromBarn(seat: Seat, suit: Suit, src: CardId | null): CardId {
    this.touch(seat);
    const barn = player(this.state, seat).barn;
    const at = barn.findIndex((id) => cardById(this.data, id).suit === suit);
    if (at < 0) throw new Error(`Seat ${seat}'s barn has no ${suit} card to discard`);
    const [card] = barn.splice(at, 1) as [CardId];
    this.discard([card]);
    this.emit({ e: 'barnDiscarded', seat, suit, card, src });
    fireHook(this, 'afterBarnDiscard', { seat, suit, card, src });
    return card;
  }

  /**
   * ⭐ ONE BARN CARD OF A NAMED CROP INTO ITS OWNER'S HAND (V6 The Trade Depot,
   * v42: "Swap up to 2 cards between your hand and your Barn"). By crop, for
   * the reason `discardFromBarn` gives; the card's identity becomes known to
   * its owner as it arrives in the hand, and to nobody else (`redactEvents`).
   * Not a draw: no `afterDrawKeep`, and not a discard.
   */
  barnToHand(seat: Seat, suit: Suit): CardId {
    this.touch(seat);
    const p = player(this.state, seat);
    const at = p.barn.findIndex((id) => cardById(this.data, id).suit === suit);
    if (at < 0) throw new Error(`Seat ${seat}'s barn has no ${suit} card to take`);
    const [card] = p.barn.splice(at, 1) as [CardId];
    p.hand.push(card);
    this.emit({ e: 'barnToHand', seat, suit, card });
    return card;
  }

  /**
   * Lift ONE card out of a building's stack into a barn (the Pizzeria shape;
   * the Dairy/Orchard stack-manipulation cards share it).
   *
   * Not a harvest: the building may reopen, but NO on-harvest passive fires.
   * That is load-bearing for A4 The Herb Hive, which takes a card off a
   * NEIGHBOUR's stack - `to` is the barn it lands in, defaulting to the stack's
   * own owner, so every pre-Apiary caller is unchanged. The rival's stack
   * shrinks before anything is sown back into the gap, which is what leaves room
   * on a building that was full.
   */
  stackCardToBarn(from: Seat, building: CardId, card: CardId, to: Seat = from): void {
    this.touch(from);
    const b = this.buildingDraft({ seat: from, card: building });
    const i = b.stack.indexOf(card);
    if (i < 0) throw new Error(`${card} is not on ${building}'s stack`);
    b.stack.splice(i, 1);
    this.touch(to);
    player(this.state, to).barn.push(card);
    this.emit({ e: 'stackToBarn', seat: to, building, card });
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
   * Top of a deck straight onto a building - the Apiary Service's sow. The sown
   * card never passes through a hand, which is the whole economic point: a
   * hand-sow would cost a visitor the fee card AND the sown card for one
   * threshold step.
   *
   * `onto` carries its owner's seat, so A4 and A14 reach a NEIGHBOUR's building
   * through the same verb. That is a placement and not a visit: it fires
   * `afterPlacement` like any other card landing (a rival's Beekeeper's Veil may
   * draw off it) and nothing else.
   *
   * Lands through the same tail as every other placement, so the placement
   * reactors fire identically. No-op when the suit is exhausted.
   */
  deckTopToBuilding(from: Seat, suit: Suit, onto: CardInPlay): void {
    const building = this.buildingDraft(onto);
    if (!canTakeCard(this.data, building)) {
      throw new Error(`${onto.card} cannot take a card (full or no stack)`);
    }
    const card = this.takeDeckTop(suit);
    if (card === null) return;
    this.land(from, onto, card);
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

  // --- the island's tokens ------------------------------------------------
  //
  // The one primitive that writes to the shared board rather than to a
  // player's own zones. V5 is its caller. Legality lives in
  // actions/deliver.ts (`tokenSwapOptions`); this verb does the moving and says
  // so in the event stream.

  /**
   * ⭐ V5's SWAP ON THE TOKEN ISLAND (16/09/2026): exchange two tokens between
   * two DIFFERENT tiles. Each token carries its demand, its VP and its Worker,
   * because physically it is the token that moves. `token` is an index into
   * each tile's `tokens`.
   */
  swapIslandTokens(
    seat: Seat,
    a: { tile: string; token: number },
    b: { tile: string; token: number },
  ): void {
    if (a.tile === b.tile) throw new Error('A token swap needs two different island cards');
    const ta = this.tileDraft(a.tile);
    const tb = this.tileDraft(b.tile);
    const xa = ta.tokens[a.token];
    const xb = tb.tokens[b.token];
    if (xa === undefined) throw new Error(`Tile ${a.tile} has no token ${a.token}`);
    if (xb === undefined) throw new Error(`Tile ${b.tile} has no token ${b.token}`);
    ta.tokens[a.token] = xb;
    tb.tokens[b.token] = xa;
    this.emit({ e: 'demandSwapped', seat, a: { ...a }, b: { ...b } });
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

  /**
   * D5 The Churning Shed (v42): sow a face-up discarded card onto a building
   * "even if the threshold is exceeded". `placeFromDiscard` with the one check
   * the card waives, fullness, taken out; everything else still refuses. A card
   * with no threshold has no stack, and a Notice Board is never a sow target
   * (S11). A stack pushed past its threshold is full and harvestable, because
   * both predicates read `>=`. Same landing tail, so placement reactors fire.
   */
  placeFromDiscardPastThreshold(from: Seat, onto: CardInPlay, card: CardId): void {
    const printed = cardById(this.data, onto.card);
    if (printed.threshold === null || printed.slot === 'noticeboard') {
      throw new Error(`${onto.card} cannot be sown onto`);
    }
    this.buildingDraft(onto);
    const pile = this.state.discards[cardById(this.data, card).suit];
    const i = pile.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in its discard`);
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
   * Clear a building's whole stack into the suits' discards - D14 The Cream
   * Refinery, and nothing else.
   *
   * Deliberately not `harvest` (that is the barn, and it fires afterHarvest)
   * and deliberately not a loop of `stackCardToBarn` (that is freight, which is
   * what the Refinery stopped producing on 19/08/2026). A demolition destroys
   * the cards on the building as well as the building, so they go where spent
   * cards go. Silent apart from the discard event: nothing on-harvest fires,
   * because nothing was harvested.
   */
  discardStack(seat: Seat, building: CardId): void {
    const b = this.buildingDraft({ seat, card: building });
    const cards = b.stack.splice(0);
    if (cards.length > 0) this.discard(cards);
  }

  /**
   * D14 The Cream Refinery: a building of yours leaves the tableau for its own
   * suit's DISCARD. It scores no printed VP, its ability is gone, and it stops
   * counting for D20 and D21 - it is not a building any more, and since Dean's
   * ruling of 19/08/2026 it is not stock either.
   *
   * ⚠️ THE DESTINATION CHANGED ON 19/08/2026 AND IT IS THE WHOLE NERF. The
   * demolished building used to land in its owner's barn as ordinary delivery
   * freight, which made the Refinery a converter: tableau VP in, freight out.
   * It now converts to nothing at all, and the payout beside it is a flat 3 deck
   * cards rather than a sum scaling on build cost. See D14's notes in dairy.ts
   * and balance flag 8.5 of the v30 plan - the card may now be strictly worse
   * than not building it, which is the thing the arm has to answer.
   *
   * The empty-stack assertion STAYS. D14 clears the building's own stack into
   * the discard first, and the throw is what stops that order reversing
   * unnoticed. `coverBuilding`, which shared this assertion for D11's
   * build-on-top, is gone with the `covered` zone (19/08/2026).
   */
  demolish(seat: Seat, building: CardId): void {
    this.touch(seat);
    const p = player(this.state, seat);
    const i = p.tableau.findIndex((b) => b.card === building);
    if (i < 0) throw new Error(`Seat ${seat} has not built ${building}`);
    const b = p.tableau[i] as { card: CardId; stack: CardId[] };
    if (b.stack.length > 0) throw new Error(`${building} is not empty`);
    p.tableau.splice(i, 1);
    this.discard([building]);
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
    this.emit({
      e: 'harvested',
      seat,
      building: buildingCard,
      cards,
      source: 'tableau',
      owner: seat,
    });
    // ⭐ W18's count (v42), kept before the hook so a listener reads this
    // harvest in it. Only the turn player's own buildings count: "on your turn,
    // you Harvest ... your buildings".
    if (seat === this.state.turnPlayer) {
      this.state.turn.harvestsThisTurn = (this.state.turn.harvestsThisTurn ?? 0) + 1;
    }
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
   * Any Deliver. `island` is always true since the balloons were deleted
   * (16/09/2026) and `tile` is always set; both are kept so the payload shape
   * does not move under the handlers. `cards` are the ids actually spent.
   */
  afterDeliver: {
    seat: Seat;
    island: boolean;
    tile?: string;
    cards: CardId[];
    /**
     * ⭐ THE RECEIPT(S) THIS DELIVERY TOOK (the token island, 16/09/2026): one
     * for an ordinary delivery, two for V14's "take every receipt". The hook
     * still fires ONCE per delivery.
     */
    receipts: Receipt[];
    /** R15: meeples that paid part of the payment, per colour. Boxed, never barned. */
    meeples?: Partial<Record<Suit, number>>;
  };
  /**
   * A visit landed on the host's Notice Board (fee placed, slot spent), fired
   * before the door action resolves - O16 The Orchard Keeper reacts host-side.
   * Once per visit.
   *
   * ⚠️ `self` IS TRUE FOR A SELF-VISIT (v31), and a host-side listener has to
   * decide what it means for that card rather than inherit an answer. Before
   * v31 a visitor and a host were always different seats, so "whenever a
   * neighbour visits you" needed no guard; now it needs `!e.self`. The `mode`
   * field it replaces distinguished the coin, Service and 2-card visits, none of
   * which exist.
   */
  afterVisit: { visitor: Seat; host: Seat; self: boolean };
  /**
   * A see-N/keep-K draw finished and the kept cards entered the hand - the
   * reference's onDraw moment (keepFromReveal). Fires for the Draw action, the
   * bonus Draw, a door's Draw and card-ability draws alike; autoDraw never fires
   * it.
   */
  afterDrawKeep: { seat: Seat; cards: CardId[] };
  /**
   * A DOOR ACTION RAN, by either route: a card placed on a Notice Board
   * (`via: 'visit'`) or a meeple spent (`via: 'meeple'`).
   *
   * ⚠️ IT NO LONGER TELLS YOU WHOSE FARM WAS USED. `owner` and `free` described
   * the Service economy - who collected the wage, and whether the use was the
   * Herb Hive's off-the-books one - and both are gone. A card that has to react
   * to being VISITED listens to `afterVisit`, which carries the host; a card
   * that reacts to taking an action listens here.
   */
  afterWork: {
    actor: Seat;
    colour: Suit;
    action: DoorAction;
    via: 'visit' | 'meeple';
  };
  /**
   * A card landed in a tableau, by ANY path - the Build action, a Worker's
   * build, a card-granted or free build. `src` is the card whose ability caused
   * it (null for the plain action), which is how D5 and D6 react to their OWN
   * build while D16 The Ledger reacts to every one.
   */
  afterBuild: {
    seat: Seat;
    card: CardId;
    payment: CardId[];
    src: CardId | null;
    /**
     * ⭐ DID THE PAYMENT COME OUT OF THE HAND (A150, Dean 12/09/2026)?
     *
     * True for every build, because `doBuild` takes the payment off the hand
     * card by card. Its one false producer (the commons 'spend' variant's Dairy
     * leg) was deleted with the commons on 13/09/2026.
     *
     * ⛔ IT EXISTS FOR O17 THE FRUIT BASKET. O17 was restricted on 12/09/2026
     * to *"a card you discard FROM YOUR HAND"*, so that the Village Store's
     * barn exchange (deleted 16/09/2026) could never become a second mint. A
     * future route that pays a build out of a barn would land here and be
     * refused rather than quietly re-open a loop.
     *
     * ⚠️ D5 The Churning Shed and D6 The Trading Shed read the same payment
     * and are DELIBERATELY NOT gated on it: Dean ruled O17's face, not theirs.
     */
    fromHand: boolean;
  };
  /**
   * ⭐ THE TURN IS ABOUT TO END (16/09/2026, for O18 A Helping Hand: *"At the
   * end of your turn, Draw until you have at least 3 cards in hand."*).
   *
   * Fired by `finishTurn` (turnflow.ts) ONCE per turn, latched on
   * `turn.endHooksDone`, and BEFORE the hand-limit discard, so a card it draws
   * is counted against the limit. A listener that pushes a task suspends the
   * boundary, which resumes on the next settle and skips the hook. `seat` is
   * the seat whose turn is ending; the listener guards its own scope.
   */
  beforeTurnEnd: { seat: Seat };
  /**
   * ⭐ A CARD EFFECT DISCARDED A CARD FROM A BARN (v42, 16/09/2026, for V17 The
   * Dockworker's Union). Fired by `Fx.discardFromBarn` and nothing else, once
   * per card. ⛔ Never by a delivery payment (R6) and never by V14's
   * demolition. `seat` is the barn's owner; `src` the card whose text did it.
   */
  afterBarnDiscard: { seat: Seat; suit: Suit; card: CardId; src: CardId | null };
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
