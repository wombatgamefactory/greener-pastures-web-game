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

import {
  cardById,
  canTakeCard,
  coinsOf,
  centralPileSuit,
  commonsHarvestTake,
  commonsBoards,
  drawableSuits,
  noticeBoardSlots,
  player,
} from './query.js';
import { shuffle } from './rng.js';
import type {
  CardId,
  DoorAction,
  GameEvent,
  GameState,
  IslandTileState,
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
  // meeple; the island's delivery spaces are the only source, seeded once at
  // setup from a bag of 25.

  /**
   * Claim a meeple into a seat's supply: off an island delivery space
   * (`doDeliver`), out of the magenta balloon's bag, or off your own Notice
   * Board (`collectBoard` below routes through here).
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
    space: number | null,
    source: 'island' | 'collect' | 'balloon' = 'island',
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
    this.emit({ e: 'meepleGained', seat, colour, tile, space });
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
   * ⭐ `via` IS OPTIONAL AND ITS ONLY VALUE IS S17's (Dean, 11/09/2026): the
   * cards are the host draw, taken by the OWNER of a visited Notice Board. It
   * is passed through to the event and nothing else - the cards arrive in the
   * hand identically either way, which is the point. Omitted by every one of
   * the dozen other callers, so the emitted event is byte-identical to what it
   * was for all of them.
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

  /**
   * ⭐ THE COMMONS PLAY (C3): one card out of a hand and face up onto a central
   * board's pile.
   *
   * Deliberately NOT `placeOnBuilding`. A central board is not a building -
   * there is no threshold to check, no owner to touch and no clog to refuse (C4)
   * - and, crucially, `afterPlacement` MUST NOT FIRE: A16 The Beekeeper's Veil
   * reads a card landing on a building and a commons play is not one (C8). So
   * this is its own two-line primitive with its own event, and the absence of
   * the hook is the rule rather than an omission.
   */
  playOnCommons(seat: Seat, board: Suit, card: CardId): void {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    this.removeFromHand(seat, card);
    pile.push(card);
    this.emit({ e: 'commonsPlayed', seat, board, card, pileSize: pile.length });
  }

  /**
   * ⭐ DEAN'S VARIANTS (09/09/2026, `rules.turn.commonsTake: 'bonus'` OR
   * `'paid'`): take the WHOLE of one central pile, straight to the taker's
   * HAND.
   *
   * Deliberately NOT `harvest`: nothing here touches a barn, no `afterHarvest`
   * fires (there was no Harvest), and the destination is a hand rather than the
   * harvester's barn - "instead of going into the barn, they go into your
   * HAND", Dean's own words. Routed through `cardsToHand` so the gain is priced
   * exactly as a draw is (`outcome.ts`'s `cardsToHand` case), and its own
   * `commonsTaken` event carries the board and the cards for the sim to count.
   *
   * `fee` is present only under `'paid'`, where `doCommonsTake` has already
   * discarded it (`fx.discardFromHand`) before calling here - it is carried
   * through only so `commonsTaken` can report it, never spent twice.
   */
  takeCommons(seat: Seat, board: Suit, fee?: CardId): void {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    const cards = pile.splice(0);
    this.cardsToHand(seat, cards);
    this.emit(
      fee === undefined
        ? { e: 'commonsTaken', seat, board, cards }
        : { e: 'commonsTaken', seat, board, cards, fee },
    );
  }

  /**
   * ⭐ DEAN'S 'paid' VARIANT'S FEE (09/09/2026, `rules.turn.commonsTake:
   * 'paid'`): one card OUT OF A HAND, straight to its own suit's discard
   * pile. "The card you pay goes to the discard pile", Dean's own words - not
   * boxed, not onto the pile it is paying to take, and not routed through the
   * divert seam (`discardOrDivert`), which exists for the end-of-turn discard
   * and O17's family, not for a flat per-use fee. A build cost's overflow and
   * this fee both end up in the same place; this is the simplest path there.
   */
  discardFromHand(seat: Seat, card: CardId): void {
    this.removeFromHand(seat, card);
    this.discard([card]);
  }

  /**
   * ⭐ DEAN'S 'spend' VARIANT'S WHEAT LEG (09/09/2026, `rules.turn.commonsTake:
   * 'spend'`): take the WHOLE of one central pile, straight to the taker's
   * BARN. `takeCommons`'s sibling with a different destination and nothing
   * else changed: no `afterHarvest` fires here either - this is not a
   * Harvest, see `harvestOptions` - and the SAME `commonsTaken` event carries
   * it, told apart from a hand-bound take only by `board` (fixed to `'wheat'`
   * by the door table, C3), so nothing downstream has to learn a second event
   * shape for a second destination.
   */
  takeCommonsToBarn(seat: Seat, board: Suit): void {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    const cards = pile.splice(0);
    this.touch(seat);
    player(this.state, seat).barn.push(...cards);
    this.emit({ e: 'commonsTaken', seat, board, cards });
  }

  // --- coins (the commons-with-coins arm, K7-K15, Dean 10/09/2026) ---------
  //
  // ⛔ THIS IS NOT v31's `gainCoins` / `payCoins` COMING BACK, and the pair
  // above says why the meeples were not either. The old pair served a fungible
  // currency with a bank behind it, a wage, a pity rate and a market; this pair
  // serves ONE MINT (clearing a central pile) and TWO SINKS (the Farmstead's
  // activation and an Endgame card's price), and there is nothing else in the
  // game that can produce or consume a coin. Every earlier coin economy in this
  // project died of a second faucet, so the narrowness is the design.

  /**
   * ⭐ THE MINT (K3 second half / K8): clear the WHOLE of one central pile to
   * its cards' OWN suits' discard piles and pay the clearer one coin per card.
   *
   * Deliberately NOT `takeCommons` and deliberately NOT `harvest`: nothing
   * reaches a hand, a barn or a building, no `afterHarvest` fires, and the pile
   * LEAVES THE GAME (`commonsTakeLeavesTheGame` in @gp/data). That is the whole
   * difference between this arm and the three take variants of 09/09/2026,
   * every one of which handed the cards back to somebody and ran the bonus slot
   * at 74% to 89% of turns because the cards taken paid for the next play.
   *
   * ⚠️ TO THEIR OWN SUITS, NEVER TO THE BOARD'S. A pile holds whatever colours
   * were played onto it, which under `commonsColourMatch` is usually but not
   * always the board's colour - the wild pair (K3 first half) puts two cards of
   * ANY colours onto a board. `fx.discard` routes each card by its own suit and
   * emits one `cardsDiscarded` per card, so the deck accounting is exact
   * without this primitive knowing anything about colour.
   *
   * Two events, on the same reasoning `commonsPlayed` and `doorUsed` are two:
   * `commonsTaken` is what every reader of the centre's outflow already counts,
   * and `coinsMinted` carries only the half that is new.
   */
  clearCommonsForCoins(seat: Seat, board: Suit): void {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    const cards = pile.splice(0);
    this.discard(cards);
    this.gainCoins(seat, cards.length);
    this.emit({ e: 'commonsTaken', seat, board, cards });
    this.emit({ e: 'coinsMinted', seat, board, coins: cards.length });
  }

  /**
   * Add coins to a seat's pile. Private to the mint above by convention rather
   * than by keyword: nothing else in the game may call it, because K8 says the
   * only mint is clearing a pile, and a second caller here IS a second faucet.
   * `coinsOf` throws when the arm is off, so a stray call cannot quietly create
   * a wallet.
   */
  private gainCoins(seat: Seat, n: number): void {
    if (n <= 0) return;
    this.touch(seat);
    player(this.state, seat).coins = coinsOf(this.state, seat) + n;
  }

  /**
   * ⭐ A SINK (K10 or K15): take `n` coins off a seat and say which of the two
   * uses took them. The enumerators have already refused the move if the seat
   * cannot pay - a seat short of coins is never offered the Farmstead as a Grow
   * target or the Endgame card as a build - so a throw here is a funnel
   * catching a move `legalMoves` never made, which is the discipline the whole
   * file is written on.
   */
  spendCoins(seat: Seat, on: 'farmstead' | 'endgame', n: number): void {
    const held = coinsOf(this.state, seat);
    if (n <= 0) throw new Error(`A coin sink costs at least one coin, got ${n}`);
    if (held < n) throw new Error(`Seat ${seat} has ${held} coins, not ${n}`);
    this.touch(seat);
    player(this.state, seat).coins = held - n;
    this.emit({ e: 'coinsSpent', seat, on, coins: n });
  }

  /**
   * ⭐ DEAN'S 'spend' VARIANT'S DAIRY AND VEGETABLE LEGS: remove SPECIFIC cards
   * (by id) from a central pile, structural only - no discard, no event. The
   * caller decides where they go (a build payment's `divertOrDiscard`, a
   * delivery's `fx.discard`) and emits its own accounting.
   */
  takeFromCommonsPile(board: Suit, cards: readonly CardId[]): void {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    for (const id of cards) {
      const i = pile.indexOf(id);
      if (i < 0) throw new Error(`${id} is not on the ${board} pile`);
      pile.splice(i, 1);
    }
  }

  /**
   * ⭐ DEAN'S 'spend' VARIANT'S LEFTOVER HALF (D-S2): the REST of a central
   * pile, taken out whole and handed back - not discarded, not touched to any
   * zone. The dairy and vegetable legs call this after taking their payment,
   * and the apiary leg calls it once, at push time, to hold the whole pile in
   * the task's own limbo (`Task.commonsSpendSow.cards`) while it resolves one
   * card at a time.
   */
  clearCommonsPile(board: Suit): CardId[] {
    const pile = commonsBoards(this.state)[board];
    if (!pile) throw new Error(`There is no ${board} board in the commons`);
    return pile.splice(0);
  }

  /**
   * ⭐ DEAN'S 'spend' VARIANT'S APIARY LEG: a HELD card - already out of the
   * pile and in the `commonsSpendSow` task's own limbo, never in a hand -
   * landing on a building. `placeFromDiscard`'s sibling for a card that came
   * from neither a hand nor a discard: the same landing tail as
   * `placeOnBuilding` (so `afterPlacement` fires exactly as a real sow's
   * does), only the origin differs, and there is no origin pile to check the
   * card out of here.
   */
  placeHeldCard(from: Seat, onto: CardInPlay, card: CardId): void {
    const building = this.buildingDraft(onto);
    if (!canTakeCard(this.data, building)) {
      throw new Error(`${onto.card} cannot take a card (full or no stack)`);
    }
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
    // ⭐ A HARVEST MAY TAKE A CENTRAL PILE (C5, 09/09/2026), and the branch is
    // here rather than in the action so that every route reaches it - the
    // Harvest action, the Wheat board's bought Harvest through `chooseBuilding`,
    // and any card that harvests a chosen building. The cards go into the
    // HARVESTER's barn (D3: never to a discard, and a central pile is reset by
    // nothing else), the pile belongs to nobody (`owner: null`) and
    // `afterHarvest` fires exactly as it does for a building (D1: a Harvest is
    // a Harvest, so Wheat's riders fire). `centralPileSuit` answers null under
    // both controls whatever the id, so W3 in a Wheat tableau is still a
    // building there.
    // ⭐ AND IT IS `centralPileSuit` RATHER THAN `commonsBoardSuit` SINCE
    // 11/09/2026, because under Dean's unclaimed-boards variant THE SAME CARD
    // ID IS A CENTRAL PILE IN ONE GAME AND A SEAT'S OWN BUILDING IN THE NEXT:
    // W3 is ownerless in the middle when nobody farms Wheat, and is the Wheat
    // seat's own Notice Board when somebody does. Only the STATE can tell the
    // two apart, and a harvest routed down the wrong branch would either
    // silently empty a rival's board into your barn or throw looking for a pile
    // that is not there.
    // ⚠️ AND THE BRANCH IS UNREACHABLE UNDER EVERY `commonsTake` VALUE BUT THE
    // SHIPPED `'harvest'` (checked 10/09/2026 while building K4). Nothing needs
    // to be added here for 'bonus', 'spend', 'paid' or 'coins': the only routes
    // that name a building to harvest are `harvestOptions` and the tasks that
    // read it, and `commonsHarvestReachesCentre` drops every central pile out of
    // that set, so no caller can hand this a board card. It is left as it stands
    // rather than guarded, because a second gate here would be a second place
    // for the rule to live and the first one would stop being read.
    const board = centralPileSuit(this.data, this.state, buildingCard);
    if (board !== null) {
      const pile = commonsBoards(this.state)[board];
      // ⭐ HOW MANY COME OUT IS `commonsHarvestTake` (Dean, 09/09/2026). null
      // is the shipped C5 rule and takes the whole pile; a number n takes at
      // most the most recently played n - the TOP of the pile, which is its END
      // because `playOnCommons` pushes - and LEAVES THE REST STANDING. A pile
      // shallower than n gives up all of it: n caps the take and never demands
      // a depth, which is `commonsHarvestMin`'s job.
      //
      // ⭐ IT IS THE ONLY ONE OF THE THREE COMMONS KNOBS THAT CAN REDUCE THE
      // CENTRE'S OUTFLOW WITHOUT REDUCING PLAYS, because the remainder stays in
      // the centre rather than never arriving. The centre is closed - in by a
      // play, out by a harvest (D3) - so a18's conservation line is the reading
      // that says whether a share moved by leaving cards behind or by stranding
      // them at the end.
      const take = commonsHarvestTake(this.data);
      const cards =
        take === null || take >= pile.length ? pile.splice(0) : pile.splice(pile.length - take);
      player(this.state, seat).barn.push(...cards);
      this.emit({
        e: 'harvested',
        seat,
        building: buildingCard,
        cards,
        source: 'commons',
        owner: null,
        left: pile.length,
      });
      fireHook(this, 'afterHarvest', { seat, building: buildingCard, cards });
      return;
    }
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
  afterDeliver: {
    seat: Seat;
    island: boolean;
    tile?: string;
    cards: CardId[];
    /** R15: meeples that paid part of the crate, per colour. Boxed, never barned. */
    meeples?: Partial<Record<Suit, number>>;
  };
  /** A balloon changed Aerodrome. `from` is where it left - V17 draws when that was its owner's port. */
  afterBalloonMove: { seat: Seat; balloon: string; from: Seat | 'centre' };
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
  /**
   * ⚠️ `host` IS NULLABLE SINCE THE COMMONS (C3, 09/09/2026), and `board` is
   * the field that says why: a card played onto a CENTRAL Notice Board is a
   * VISIT for every card that keys on the word (C8), but there is no seat to
   * name as the host, so it fires with `host: null` and the board's colour.
   *
   * What that does to the three cards, WITHOUT a word of their text changing:
   * W17 The Pie Shop compares `event.host === self.seat` and can never match a
   * null, so it is dead under the commons exactly as C8 says; O16 The Fruit
   * Store and A17 The Smoke Pot compare `event.visitor` and fire. A host-side
   * listener written from here on has to answer the null rather than inherit an
   * answer, which is the same warning `self` carries below.
   */
  afterVisit: { visitor: Seat; host: Seat | null; self: boolean; board?: Suit };
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
    via: 'visit' | 'meeple' | 'commons';
  };
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
