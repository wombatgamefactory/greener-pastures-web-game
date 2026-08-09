/**
 * Pricing a probe - what a move's EFFECT is worth, in this position, right now.
 *
 * Ticket 40. A card's ability only fires on GROW, and every one of the 105 was
 * priced at a flat 2.5, so no bot could tell a good moment to activate from a
 * bad one. The fix is not a bigger table of per-card constants: it is to apply
 * the move and price what came out.
 *
 * ## The one rule
 *
 * **The pricer reads no card identity, ever.** Dean's ruling on this ticket:
 * a probe may price anything the seat would legitimately know before
 * committing - how many coins, how many cards, which building filled, which
 * tile opened - but never a card the probe itself just turned face up. A bot
 * that grows when the deck is kind and refuses when it is not is a bot that can
 * see the deck, and every card economic in the balance report would carry it.
 *
 * That rule is enforced structurally rather than by care: nothing below calls
 * `cardById`, so there is no path from a revealed id to a price. `n` cards are
 * worth `n` times the catalogue's mean card value, and that is all. Two happy
 * consequences fall out - `redactEvents` masks harvested and rival cards down
 * to `W?`, which would throw in `cardById`, so the blind pricer is also the only
 * one that works; and the rule is testable, as `outcome.test.ts` does: reshuffle
 * every deck and the same position must price identically.
 *
 * The cost is a small, known understatement. A build inside a probe is priced
 * for happening, not for the VP of the card built, because that card might have
 * been drawn during the probe. Erring blind is the right direction.
 *
 * ## The currency
 *
 * Prices come out of the SAME weight table the move terms use, so a grow that
 * harvests a three-card stack is worth what harvesting that stack is worth, and
 * the archetypes keep their taste inside their own valuations. No new tunable
 * is introduced beyond the `outcome` term's own multiplier.
 */

import type { GameData } from '@gp/data';
import type { GameEvent, Move, Prober, Seat } from '@gp/engine';

import type { Act } from './acts.js';
import { actOf, spendSize } from './acts.js';
import { cardValue } from './junk.js';
import type { Scratch } from './scratch.js';
import { coinWorth, handSpendCost } from './scratch.js';
import type { WeightTable } from './weights.js';

/**
 * How deep a rollout walks the task chain.
 *
 * An activation that pushes a task pushes one or two; three levels covers every
 * card in the catalogue and leaves headroom. Deeper is not obviously better
 * either - the further a greedy rollout walks, the more it is scoring its own
 * guesses about choices it has not had to make yet.
 */
const DEPTH = 3;

/**
 * Answers scored per task level.
 *
 * A `build` task can enumerate dozens of ways to pay and a `keep` task every
 * subset of a reveal. They are near-identical to a blind pricer, so the cap
 * costs little - but it IS a cap, and it takes the first N in enumeration
 * order, which is an artefact of the engine's code layout. `--explain` is where
 * to look if a valuation ever surprises.
 *
 * Set by measurement rather than taste. Once `handSpend` landed the bots took
 * far more of the actions that carry probe-worthy options, and `choose` became
 * 76% of a game's wall time at 4 seats. Sweeping the cap: 16 -> 9.6 games/s,
 * **8 -> 11.8**, 4 -> 13.9. Eight takes most of the win while still weighing a
 * generous set of answers, and four buys less than it costs in fidelity.
 */
const BRANCH_CAP = 8;

/** The catalogue's mean card value - what one unidentified card is worth. */
const MEAN_VALUE = new WeakMap<GameData, number>();

export function meanCardValue(data: GameData): number {
  let mean = MEAN_VALUE.get(data);
  if (mean === undefined) {
    const cards = data.cards.catalogue;
    let sum = 0;
    for (const card of cards) sum += cardValue(data, card.id);
    mean = cards.length === 0 ? 0 : sum / cards.length;
    MEAN_VALUE.set(data, mean);
  }
  return mean;
}

function weight(w: WeightTable, name: string): number {
  return w[name] ?? 0;
}

/**
 * One event's worth to the probing seat.
 *
 * Events about other seats price at zero rather than negative: the bot is
 * valuing what it gains, and a term table that also modelled rival harm would
 * be a different bot (and a different balance instrument). Events that only
 * bookkeep - reshuffles, turn ends, the discard pile - are worth nothing
 * because whatever they accompany is priced by its own event.
 */
function priceEvent(event: GameEvent, s: Scratch, w: WeightTable, me: Seat): number {
  switch (event.e) {
    case 'coins':
      if (event.seat !== me) return 0;
      // A spend is not a loss: it bought whatever the same effect is paying
      // for, and that arrives as its own event.
      return event.delta > 0 ? weight(w, 'coinGain') * coinWorth(s, event.delta) : 0;

    case 'harvested': {
      if (event.seat !== me) return 0;
      const board = s.noticeBoard;
      const unclog = board !== null && event.building === board.card ? weight(w, 'unclogBoard') : 0;
      return weight(w, 'harvest') * event.cards.length + unclog;
    }

    // Single cards reaching a barn by any of the non-harvest routes. Priced at
    // the harvest rate because that is what this table already pays for a card
    // arriving in the barn.
    case 'deckToBarn':
    case 'stackToBarn':
    case 'handToBarn':
    case 'discardToBarn':
      return event.seat === me ? weight(w, 'harvest') : 0;

    case 'demolished':
      // D14: the building leaves the tableau and becomes freight.
      return event.seat === me ? weight(w, 'harvest') : 0;

    case 'cardsToHand':
      // The blind price: count times the catalogue mean, never these cards.
      return event.seat === me
        ? weight(w, 'keepValue') * event.cards.length * meanCardValue(s.data)
        : 0;

    case 'cardGifted':
      if (event.to === me) return weight(w, 'keepValue') * meanCardValue(s.data);
      // The giver is charged only when the card came OUT OF A HAND (O6, O9).
      // The divert seam's gift hands over a card that was already on its way to
      // a discard pile, so there is nothing to charge - and charging it made the
      // plain discard strictly better and the rebuilt Farmstead never fire.
      // Priced at 0 rather than at what it does for the RECIPIENT, following
      // this file's one rule: the bot values what it gains and never rival harm,
      // so an acceptance rate here is an upper bound and the table decides.
      if (event.from === me && event.fromHand) {
        return -weight(w, 'keepValue') * meanCardValue(s.data);
      }
      return 0;

    // Only placements onto your OWN buildings are a gain. A fee landing on a
    // rival's Notice Board is the price of a visit, and `visitFeeJunk` has
    // already charged for it. Priced flat rather than with `sowCompletes`,
    // because `Scratch` holds the position BEFORE the move and a probe may
    // place several cards - the stack it would have to read has moved on.
    case 'cardPlaced':
      return event.onto.seat === me ? weight(w, 'sow') : 0;

    case 'delivered': {
      if (event.seat !== me) return 0;
      const coins = weight(w, 'coinGain') * coinWorth(s, event.coins);
      // The freight, charged at the price the move table puts on a barn card
      // leaving (ticket 48). Without it a delivery inside a rollout - a rented
      // Deliver Worker, a Vegetable card's own deliver - was free where the same
      // delivery as a move costs 4 cards, which is the split ticket 47 found in
      // `built` arriving on the other action. Blind: a count off the event's own
      // spend, never a card.
      const freight = weight(w, 'barnSpend') * spendSize(event.spend);
      // `event.vp` is already the fill-order gradient since the flat island - 6
      // for arriving first at this tile, 3 for second - so the race is priced by
      // the receipt itself with no taste weight of its own. That is deliberate:
      // a bot given a separate appetite for going first would be tuned to chase
      // the gradient rather than measuring whether the gradient is worth chasing.
      return weight(w, 'deliver') * event.vp + coins - freight;
    }

    case 'balloonMoved':
      // Ticket 49. The last barn exit that was free: a balloon eats 2 differing
      // barn cards, where the same cards delivered to the island are charged by
      // `barnSpend` (ticket 48) and burnt on a build are charged by it too (47).
      // Read off the event's own spend rather than the printed `moveCost`,
      // because V16 moves a balloon for nothing and an invented cost would price
      // that move as if it paid.
      //
      // Neither half of what the move is WORTH is here, and both omissions are
      // deliberate. The reward is a task `grantBalloonReward` pushes, so the
      // rollout walks it, which is the whole of this ticket; the flat `balloon`
      // taste stays a MOVE term, the way `grow`'s does, because a taste is a
      // thing a seat has about an action rather than a thing that happens in a
      // position - and paying it here as well would charge it twice.
      //
      // THE HAND LEG IS THE VEGETABLE REBUILD'S (2026-08-09) and it is not
      // optional. V4 and V8 pay for a flight out of the HAND, and nothing else
      // in the event stream charges for a card leaving a hand: `removeFromHand`
      // emits nothing and `cardsDiscarded` is priced at zero because whatever
      // sent the cards there is already paying for them. So without this a
      // hand-paid flight read as FREE - full balloon reward, no cost - and the
      // bots dumped their hands for balloons. Measured: it cost the Vegetable
      // seat 12 points of win rate. Charged at `handSpend` against a COUNT, the
      // same shape and the same weight the `built` event charges its payment at,
      // and blind for the same reason.
      if (event.seat !== me) return 0;
      return (
        -weight(w, 'barnSpend') * spendSize(event.spend) -
        weight(w, 'handSpend') * handSpendCost(s, event.hand)
      );

    case 'built':
      // Priced for happening, not for what was built: the card's identity is
      // off limits (it may have been drawn inside this probe).
      //
      // The payment is charged at `handSpend`, the price the move terms put on a
      // card leaving hand, and no longer at `buildSpend` (ticket 47). Two
      // reasons: `buildSpend` now reads card identity, which this pricer may not
      // see; and the same weight was being used here against a raw count and
      // there against a negated one, so one of the two had to be reading it
      // backwards. It was charging a build's cards 0.2 each where the bot's own
      // table charges 2.5. Count only, so a barn card in the payment (D8) prices
      // as a hand card - blind, and the same direction.
      if (event.seat !== me) return 0;
      return weight(w, 'build') - weight(w, 'handSpend') * handSpendCost(s, event.payment.length);

    case 'covered':
      return event.seat === me ? weight(w, 'build') : 0;

    case 'starterUpgraded':
      return event.seat === me ? weight(w, 'upgrade') : 0;

    // THE MUTABLE DEMAND TOKENS (V5, V6) are priced POSITIONALLY, not here.
    // Their whole effect is on the shared board, so there is no delta in the
    // acting seat's own resources for an event price to read and they would
    // score exactly zero - see `deliverabilityValue` below and the note on
    // `Probe.deliverable`.
    case 'demandSwapped':
    case 'demandFaceDown':
      return 0;

    // A Service's wage arrives as its own `coins` event and the action it
    // performs arrives as that action's events, so scoring the activation too
    // would double count.
    case 'workerWorked':
    case 'reshuffled':
    case 'cardsDiscarded':
    case 'visited':
    case 'endTriggered':
    case 'turnEnded':
    case 'gameEnded':
      return 0;

    default:
      event satisfies never;
      return 0;
  }
}

function priceEvents(events: readonly GameEvent[], s: Scratch, w: WeightTable, me: Seat): number {
  let total = 0;
  for (const event of events) total += priceEvent(event, s, w, me);
  return total;
}

/** A move's outcome value, memoised for the decision. */
export interface Outcomes {
  value(move: Move): number;
}

/**
 * A pending draw, priced without walking it (ticket 50).
 *
 * A `draw` task takes one `deck` answer per card REVEALED and only then a
 * `keep`, and `cardsToHand` - the only priced event in the whole effect - fires
 * on the keep. So a "Draw N" costs N+1 rollout levels against a DEPTH of 3, and
 * everything drawing 3 or more was worth exactly its flat weight and no more.
 * Measured on the Draw Worker, the one the design calls a traffic magnet and
 * watch-list assertion 7 exists to measure: priced at **exactly zero in 82.2%**
 * of the positions it was offered in, against 0.0% for all four other Workers.
 *
 * Walking further is the wrong fix. Every deck pick is an `apply` off a budget
 * shared by the whole decision (`PROBE_BUDGET`), and they carry no information
 * to walk BY - each reveal prices at zero, so the beam picks between them by
 * enumeration order. Raising DEPTH would spend the budget on that and risk
 * truncating the effects it was raised to reach.
 *
 * So a pending draw ENDS the rollout and is priced analytically instead: the
 * cards it will keep, at the same blind price `cardsToHand` pays. Cheaper than
 * before - the reveals are never applied at all - and blind by construction,
 * since only the counts are read and never `revealed`.
 *
 * **Capped by room in hand, and that half is ticket 49's** (2026-08-04). The
 * first version priced `keep x meanCardValue` flat, which says a Draw 4 into a
 * full hand is worth as much as a Draw 4 into an empty one - where the
 * move-level `drawAction` term has always scaled by exactly the room in hand,
 * because a card drawn into the end-of-turn discard is an action thrown away.
 * The understatement was invisible on the Draw Worker (keep 2) and decisive on
 * the Draw 4 balloon the moment ticket 49 let the bots see it: balloon moves
 * taken went 89 -> 414 over 55 games, 60.9% of them the Draw balloon, **32.9%
 * with no room in hand at all**, and the widest position in the UI's own corpus
 * went from 792 legal moves to 8008 - C(hand, excess) discard subsets, a seat
 * ending its turn seven cards over its limit.
 *
 * The room is read off the PROBE, not off `Scratch`, and that is not fussiness:
 * a rented Worker is reached by a VISIT, which pays a card out of hand first, so
 * a pre-move reading is short by exactly one on the case ticket 50 exists to
 * fix - and short by one at room 0 is the difference between "worth a card" and
 * "worth nothing". `handLimit` null means no Barn, which the engine reads as no
 * limit, so nothing is capped there either.
 */
function pendingDrawValue(probe: ReturnType<Prober>, s: Scratch, w: WeightTable): number | null {
  const task = probe.pending;
  if (task === null || task.t !== 'draw') return null;
  const room = s.handLimit === null ? task.keep : Math.max(0, s.handLimit - probe.handSize);
  const keep = Math.min(task.keep, task.see, room);
  return weight(w, 'keepValue') * keep * meanCardValue(s.data);
}

/**
 * THE DELIVERABILITY TERM (the Vegetable rebuild, 2026-08-09).
 *
 * `priceEvent` reads what happened to the acting seat's own zones, which is the
 * right rule for 103 of 105 cards and prices the other two at exactly zero: V5
 * swaps two of the island's demand tokens and V6 turns one face down, and
 * neither moves a card, a coin or a receipt. Left alone, the bots would never
 * play two of the five Depots, the arm would report them at ~0% and the report
 * would read as a design failure when it is a pricing gap. Change 8's log
 * records the identical trap on Orchard: *"the pricer had to be FIXED before the
 * power fired at all"*.
 *
 * The fix is a TERM, not a card-identity special case: the probe reports how
 * many open tiles this seat could pay for either side of the move, and the
 * difference is worth what an unlocked delivery is worth. A swap that turns an
 * unaffordable tile into an affordable one prices at roughly a delivery; a swap
 * that changes nothing prices at zero, which is correct and is also what makes
 * `skip` the right answer most of the time.
 *
 * It shares `marketPayability`'s weight, and that is exactness rather than
 * thrift: that term converts "a tile that flipped from unpayable to payable"
 * into score, and this is the same quantity arriving through a different door.
 * If one moves, move both.
 *
 * ⚠️ THE BOTS CANNOT JUDGE V5'S DENIAL USE, and no weight fixes that. This file
 * prices what a seat GAINS and never rival harm, so every swap a bot takes is
 * self-serving. Whether swapping a token out from under a rival's hoarded pair
 * lands as clever or as the predecessor's "reverse engine-building" resentment
 * is a table question and only a table question.
 */
function deliverabilityValue(probe: ReturnType<Prober>, w: WeightTable): number {
  if (probe.truncated) return 0;
  return weight(w, 'marketPayability') * (probe.deliverable - probe.deliverableBefore);
}

/**
 * Depth-limited rollout, beam of one: price what the move did, pick the single
 * most promising answer to the choice it stopped on, and walk into that.
 *
 * The beam is what keeps this affordable. Taking the max over a full branch at
 * every level is exponential - at the cap that is 16^3 speculative applies for
 * one valuation, and the first measured build spent 359us a decision against a
 * 50us budget. Ranking the answers by their own immediate events and following
 * the leader is linear: at worst `BRANCH_CAP` applies per level, and typically
 * a handful.
 *
 * The cost is myopia, and ticket 50 removed the sharpest case of it: an answer
 * whose value only shows up a step later ranks flat and loses the tie to
 * enumeration order. A deck pick was exactly that and is now never walked at
 * all - a pending draw is priced where it stands - but the shape survives for
 * any other multi-level effect. That is a valuation, not a decision: the bot
 * still answers the real task with the full term table when it gets there.
 */
function rollout(
  probe: ReturnType<Prober>,
  s: Scratch,
  w: WeightTable,
  me: Seat,
  depth: number,
): number {
  let total = priceEvents(probe.events, s, w, me) + deliverabilityValue(probe, w);
  const draw = pendingDrawValue(probe, s, w);
  if (draw !== null) return total + draw;
  if (depth <= 0 || probe.next.length === 0) return total;

  let leader: ReturnType<Prober> | null = null;
  let bestImmediate = -Infinity;
  const limit = Math.min(probe.next.length, BRANCH_CAP);
  for (let i = 0; i < limit; i++) {
    const stepped = probe.step(probe.next[i] as Move);
    // Ranked by the same valuation the rollout would give it, so an answer
    // leading into a draw is not scored at zero against one that pays a coin -
    // and so a demand-token swap, whose whole worth is positional, can win a
    // level it would otherwise tie flat and lose to enumeration order.
    const immediate =
      priceEvents(stepped.events, s, w, me) +
      deliverabilityValue(stepped, w) +
      (pendingDrawValue(stepped, s, w) ?? 0);
    if (immediate > bestImmediate) {
      bestImmediate = immediate;
      leader = stepped;
    }
  }
  if (leader !== null) total += rollout(leader, s, w, me, depth - 1);
  return total;
}

/**
 * What actually determines a move's outcome, as a memo key.
 *
 * Breadth, not depth, is where a decision's probes go: a seat with seven cards
 * and three activatable buildings is offered 21 grows, and all seven ways to pay
 * for a given building fire the same ability. Keying on the EFFECT rather than
 * the move collapses that to three probes. The payment card is not lost - it is
 * priced separately and per card by `growSpend`.
 *
 * The same holds across the bonus slot: a worker visit is determined by whose
 * Worker and which one, never by which junk card pays the fee (`visitFeeJunk`
 * prices that), so every fee for a host shares one rollout.
 */
function effectKey(move: Move, act: Act): string {
  switch (act.a) {
    case 'grow':
      return `grow:${act.building}`;
    case 'visit':
      return `visit:${act.host}:${JSON.stringify(act.payoff)}`;
    case 'workOwn':
    case 'worker':
      return `work:${act.workerId}`;
    /**
     * The same collapse, and it is what makes probing a balloon affordable
     * (ticket 49). A decision is offered 8.4 balloon moves on average and up to
     * 40 - every balloon crossed with every way to pick 2 differing barn suits -
     * against a whole-decision budget of 96 applies shared with the grows and
     * the Workers. All the ways to pay for one balloon grant the same reward, so
     * keying on the balloon collapses 8.4 probes to 3.2.
     *
     * The one thing that survives the collapse is measured rather than assumed:
     * over 4917 real (decision, balloon) pairs the spend moved the valuation in
     * 6.6%, by at most 2.50 - the upgraded Vegetable Barn, which hands back one
     * just-spent Vegetable. The first enumerated spend's rollout stands for all
     * of them, which is the same bargain `grow` strikes with its payment card.
     */
    case 'balloon':
      return `balloon:${act.balloon}`;
    case 'cardMove':
      return `cardMove:${act.card}:${act.kind}:${JSON.stringify(act.payload)}`;
    default:
      return JSON.stringify(move);
  }
}

export function makeOutcomes(s: Scratch, w: WeightTable, prober: Prober): Outcomes {
  const memo = new Map<string, number>();
  const me = s.view.seat;
  return {
    value(move: Move): number {
      const key = effectKey(move, actOf(move));
      let cached = memo.get(key);
      if (cached === undefined) {
        cached = rollout(prober(move), s, w, me, DEPTH);
        memo.set(key, cached);
      }
      return cached;
    },
  };
}
