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
 * committing - how many cards, which meeple was claimed, which building filled,
 * which tile opened - but never a card the probe itself just turned face up. A bot
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
import { handSpendCost, meepleWorth } from './scratch.js';
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

/**
 * The mean VP printed on a card that could be BUILT - the same blind trick
 * `meanCardValue` plays, for the same reason, one field along. 1.389 on the
 * shipped v31 catalogue.
 *
 * ⭐ ADDED IN v31 TO CLOSE A GAP THAT HAD BECOME LOAD-BEARING. A build inside a
 * rollout was priced `build - handSpend x cards`, which is NEGATIVE for every
 * card in the game (3 - 2.5 x 2 = -2 at the cheapest), while the same build as a
 * MOVE also collects `buildVp` and now `farmsteadVp` and comes out positive. So
 * the pricer and the move table disagreed about whether building is a good idea,
 * by about three points.
 *
 * That gap cost nothing while a probe only ever reached a build through a card
 * effect. v31 made it decisive: **the Dairy door and a Dairy meeple ARE a
 * build**, and a door is priced entirely by its rollout - so across 12 whole
 * smoke games the Dairy door was used exactly **0 times by any profile**, which
 * would have gone into the report as "the Build door is dead" when it is this
 * arithmetic.
 *
 * Only the printed-VP half is corrected. The Farmstead's own-suit VP needs the
 * built card's SUIT, which is card identity, which this file may never read - so
 * a probed build stays about one VP cheap, always in the same direction, and
 * that is stated at the `built` case rather than papered over with a guess about
 * how often a bot builds its own crop. Guessing THAT would put a thumb on risk
 * 3's own-crop build share, which is the one number the pass most needs clean.
 */
const MEAN_PRINTED_VP = new WeakMap<GameData, number>();

export function meanPrintedVp(data: GameData): number {
  let mean = MEAN_PRINTED_VP.get(data);
  if (mean === undefined) {
    // Deck cards only: the fifteen starters print 0 and are never built, so
    // including them would drag the mean down by a sixth for no reason.
    const cards = data.cards.catalogue.filter((card) => card.inDeck && card.enabled);
    let sum = 0;
    for (const card of cards) sum += card.printedVp;
    mean = cards.length === 0 ? 0 : sum / cards.length;
    MEAN_PRINTED_VP.set(data, mean);
  }
  return mean;
}

/**
 * ⭐ THE BLIND PRIOR THAT A PROBED BUILD IS OWN-CROP, and therefore that the
 * seat's Farmstead pays its 1 VP for it (Dean, 03/09/2026).
 *
 * The Farmstead's VP needs the built card's SUIT, and this pricer may never read
 * card identity - it may be looking at a card drawn inside its own probe. So the
 * VP is priced as a PROBABILITY instead, exactly as `meanPrintedVp` prices the
 * card's printed VP as a catalogue mean: blind, one number, no identity read.
 *
 * ⚠️ UNLIKE `meanPrintedVp` THIS IS A BEHAVIOURAL PRIOR, NOT A DATA PROPERTY.
 * 0.8 is the own-crop build share measured at 83.3% on reference-v10, and it is
 * the one constant in this file that a rules change can invalidate without
 * touching the catalogue. Risk 3 - the monoculture pull - is the reason it is so
 * high, and if that share ever falls this number has to fall with it or the
 * pricer starts paying for a Farmstead VP that is not arriving.
 *
 * What it fixes: before it, "a build reached through a door or a meeple is worth
 * one VP less to the bot than it really is, always in the same direction". That
 * bias fell hardest on the DAIRY DOOR, which IS a build, and which the v10 door
 * mix found on 7% - the lowest of the five doors in the game, for the most
 * powerful action any door grants.
 */
const OWN_CROP_BUILD_PRIOR = 0.8;

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
    /**
     * A MEEPLE CLAIMED OFF THE ISLAND - the busiest priced event in v31, and
     * the direct replacement for `coins`, which was the busiest in v30.
     *
     * It is NOT a rename. A coin was fungible, continuous and spendable on
     * anything; a meeple is one of five discrete colours, worth exactly one
     * specific action, and it leaves the game when used. So it is priced by
     * what that colour's door can do for THIS seat (`meepleWorth`) and never by
     * a count - a metric that averaged the five would be measuring nothing.
     *
     * Reached inside a rollout whenever a door's Deliver, or a card's, lands a
     * delivery. A delivery taken as the seat's OWN move is priced by the
     * `meepleGain` MOVE term instead, at the same weight; `deliver` is
     * deliberately not on `isProbed`, which is what keeps the two from ever
     * both firing for one decision.
     */
    case 'meepleGained':
      return event.seat === me ? weight(w, 'meepleGain') * meepleWorth(s, event.colour) : 0;

    /**
     * Priced at ZERO here on purpose: the `meepleSpend` MOVE term charges it,
     * so charging it again inside the rollout of the very move that spent it
     * would double the cost and the bots would hoard.
     *
     * ⚠️ That is only safe while `spendMeeple` is the ONLY thing that can spend
     * a meeple, which it is - no card in the 105 touches the supply. If one
     * ever does, this line becomes a silent hole and the charge has to move
     * here, exactly as the (deleted) balloon's freight did in ticket 49.
     */
    case 'meepleSpent':
      return 0;

    /**
     * A harvest is priced by what came out: `seat` is always the HARVESTER,
     * whose barn the cards went into, and the price is the count of them.
     *
     * The unclog leg is the meeple game's and the v31 game's: `s.noticeBoard` is
     * the seat's OWN board.
     *
     * ⛔ **A REAL BUG FIXED HERE ON 11/09/2026.** Under `visitCurrency:
     * 'noticeBoardPower'` the five boards come home to their owners' farms as
     * BUILDINGS, so `s.noticeBoard` is NOT null - and S8's `3+` is a MINIMUM
     * rather than a maximum, so the board cannot clog and there is no shut door
     * to reopen. A Harvest reached inside a rollout (the Wheat board's power is
     * a Harvest, and Wheat's riders fire on one) that took the seat's own
     * Notice Board was therefore paying the full `unclogBoard` weight of **6**,
     * the largest number in the table, for reopening a door that was never
     * shut.
     *
     * ⚠️ **IT IS THE EVENT-SIDE TWIN OF THE TWO MOVE TERMS**, which were guarded
     * on `Scratch.noticeBoardClogs` when the arm was built and are the reason
     * that boolean exists; this path was missed because it reads the weight
     * directly rather than through `TERMS`. So it now asks the same one
     * question, in the same spelling, and **no control moves**: the boolean is
     * true under the v31 `'card'` game, true under both meeple arms, and true
     * again under `-blocking-v1`, where a stall can actually happen and the
     * reward is real. It is false only under the notice-board family with
     * `noticeBoardBlocks` off.
     */
    case 'harvested': {
      if (event.seat !== me) return 0;
      // ⭐ ANY BOARD OF MINE, NOT JUST MY OWN SUIT'S (Dean's two-board fix,
      // 11/09/2026). At two seats this seat holds two, either of them can be
      // harvested, and either would reopen a door under `-blocking-v1` - so the
      // question is membership and never identity. `Scratch.noticeBoards` is
      // one entry in every other game, so this answers exactly what the old `=== s.noticeBoard.card` answered
      // everywhere that test was right.
      const unclog =
        s.noticeBoardClogs && s.noticeBoards.has(event.building) ? weight(w, 'unclogBoard') : 0;
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

    // Barn cards LEAVING a barn by discard. Charged at the same harvest rate a
    // card arriving is paid, so a discard is never free.
    // ⭐ v45 RETEXT (19/09/2026, tasks/v45-rulings-v1.md): V10 and V12 no
    // longer discard from the barn (R1, R4 - the barn is only counted, never
    // spent). V8 and V15 are this event's producers now; V6 no longer is
    // (see `barnToHand` below).
    // ⭐ v46 RETEXT (20/09/2026, tasks/v46-rulings-v1.md, R5-R7): V6 The Trade
    // Depot was this event's only producer and now goes BARN -> its own crop's
    // discard pile (`Fx.discardFromBarn`, priced by the `barnDiscarded` case
    // above) and DECK TOP -> barn (`Fx.deckTopToBarn`, priced by `deckToBarn`
    // above), never hand <-> barn any more. `barnToHand` therefore has NO
    // producer left in the engine; the case below is kept only so a future
    // card (or a restore-style knob, on the pattern of `supplyHouseBarnDrain`
    // and `dockworkersUnionDrawOnDiscard`) that reaches for the primitive is
    // priced rather than silently valued at 0.
    case 'barnDiscarded':
      return event.seat === me ? -weight(w, 'harvest') : 0;
    case 'barnToHand':
      return event.seat === me
        ? weight(w, 'keepValue') * meanCardValue(s.data) - weight(w, 'harvest')
        : 0;

    /**
     * ⛔ **AND SINCE S17 (Dean, 11/09/2026) THE `: 0` LEG HAS A BUSY NEW
     * PRODUCER, WHICH IS WHY IT IS WRITTEN OUT RATHER THAN LEFT TO THE FILE'S
     * STANDING RULE.**
     *
     * `rules.turn.hostDrawOnVisit` pays the HOST a card the moment a neighbour
     * visits them, and the engine labels it `via: 'hostDraw'`. So a visit's own
     * rollout now carries a `cardsToHand` for a RIVAL seat, every time, and
     * `redactEvents` masks the ids to `W?` while leaving the COUNT intact - the
     * rollout can see exactly how many cards the host was handed.
     *
     * **It is priced at ZERO all the same, and that is a decision.** This file
     * values what the probing seat gains and never what a rival gains, and the
     * ONE exception to that rule in the whole package is the `hostGift` MOVE
     * term, which is where C64 lives and which was re-measured to 2.7 on
     * 11/09/2026 to cover exactly this card. Charging it here as well would
     * charge one card twice, and it would break the promise `weights.ts` makes
     * about that term: that `hostGift: 0` reproduces the blind bot exactly and
     * is the control arm for every reading the charge moves. One exception, one
     * term, one control.
     *
     * ⚠️ **A SELF-VISIT NEVER PRODUCES ONE** (the engine refuses to pay the
     * draw when visitor and host are the same seat), so the `event.seat === me`
     * leg cannot be reached this way and a host draw can never be mistaken for
     * the visitor's own gain.
     */
    case 'cardsToHand':
      // The blind price: count times the catalogue mean, never these cards.
      return event.seat === me
        ? weight(w, 'keepValue') * event.cards.length * meanCardValue(s.data)
        : 0;

    case 'cardGifted':
      if (event.to === me) return weight(w, 'keepValue') * meanCardValue(s.data);
      // The giver is charged only when the card came OUT OF A HAND. ⚠️ v48
      // (`tasks/v48-rulings-v2.md`): O9 The Fruit Stand is the only card left
      // that gives at all. O6 The Cherry Grove retexted to "Draw 2, then
      // Deliver" and O15 The Garden Library to "Draw until you have 6 cards in
      // hand" - neither touches a neighbour's hand any more, so neither
      // reaches this case. D6 The Trading Shed stopped giving on v47 (its two
      // draws are ungated on the neighbour choice, not a gift of a spent
      // card), which still holds.
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

    /**
     * Only placements onto your OWN buildings are a gain. A fee landing on a
     * rival's Notice Board is the price of a visit, and `visitFeeJunk` has
     * already charged for it. Priced flat rather than with `sowCompletes`,
     * because `Scratch` holds the position BEFORE the move and a probe may
     * place several cards - the stack it would have to read has moved on.
     *
     * ⭐ YOUR OWN NOTICE BOARD IS THE ONE EXCLUSION, AND IT IS RISK 2 (v31).
     * A self-visit places the fee on the visitor's own board, so without this
     * line every self-visit would collect `sow` on top of its door action while
     * a neighbour visit collected nothing - a 1.5 thumb on the scale, pointing
     * at solitaire, in the exact place the plan says the game is most likely to
     * break. And the placement is not a gain in any case: a card on your own
     * board advances it toward CLOGGING, which shuts your own door. What that
     * costs is charged once, by the `clogOwnBoard` move term, at the moment the
     * board actually fills.
     *
     * ⚠️ **A KNOWN, ADMITTED OVER-VALUATION, AND IT LANDS ON THE APIARY DOOR.**
     * A sow FROM HAND and a sow from a DECK TOP emit the identical event, so
     * this cannot charge the hand card and does not: a sow inside a rollout is
     * worth a flat `sow` with nothing deducted, where the same sow answered as
     * a real task is charged 2.5 by `handSpend` and comes out roughly a point
     * NEGATIVE. Nothing in the event stream distinguishes the two sources, and
     * inventing the distinction from the card that granted it would be reading
     * identity.
     *
     * It matters because the Apiary door is Sow 1 from hand, and the plan says
     * outright that it is "the weakest door on the table by some distance" -
     * two cards out for one threshold step in. This pricer cannot see the second
     * card, so **it will report the Apiary door as healthier than it is.** If the
     * door mix comes back saying the Apiary board takes normal traffic, that is
     * the one door-mix reading not to trust.
     */
    case 'cardPlaced': {
      if (event.onto.seat !== me) return 0;
      // ⛔ **AND "MY NOTICE BOARD" IS A SET SINCE DEAN'S TWO-BOARD FIX
      // (11/09/2026), WHICH IS LOAD-BEARING RATHER THAN TIDYING.** At two seats
      // this seat holds two boards and a fee can land on either; the field this
      // line used to read held the seat's RANDOM EXTRA board (see
      // `Scratch.noticeBoard`), so a card arriving on the seat's OWN SUIT'S
      // board fell straight through to `sow` and collected 1.5 for advancing a
      // building toward a threshold that is a MINIMUM. Worse, it would have
      // been paid TWICE for one card: once here, and again as `harvest` when
      // the owner cashed the board - which is exactly the "a popular board is
      // income" loop the variant is built on, and it is priced at the HARVEST
      // and nowhere else.
      if (s.noticeBoards.has(event.onto.building)) return 0;
      return weight(w, 'sow');
    }

    case 'delivered': {
      if (event.seat !== me) return 0;
      // The freight, charged at the price the move table puts on a barn card
      // leaving (ticket 48). Without it a delivery inside a rollout - a rented
      // door's Deliver, a Vegetable card's own deliver - was free where the same
      // delivery as a move costs 4 cards, which is the split ticket 47 found in
      // `built` arriving on the other action. Blind: a count off the event's own
      // spend, never a card.
      const freight = weight(w, 'barnSpend') * spendSize(event.spend);
      // `event.vp` is the VP printed on the token taken (the token island,
      // 16/09/2026), so the receipt prices itself with no taste weight of its
      // own.
      //
      // The WORKER the same token carries arrives as its own `meepleGained`
      // event, above, so nothing about it is added here.
      return weight(w, 'deliver') * event.vp - freight;
    }

    case 'built':
      // Priced for happening plus the catalogue's MEAN printed VP, never for
      // what was actually built: the card's identity is off limits (it may have
      // been drawn inside this probe). See `meanPrintedVp` for why the mean is
      // there at all - without it a probed build was worth about three points
      // less than the identical build as a move, and the Dairy door, which IS a
      // build, went unused in every smoke game.
      //
      // The payment is charged at `handSpend`, the price the move terms put on a
      // card leaving hand, and no longer at `buildSpend` (ticket 47). Two
      // reasons: `buildSpend` now reads card identity, which this pricer may not
      // see; and the same weight was being used here against a raw count and
      // there against a negated one, so one of the two had to be reading it
      // backwards. It was charging a build's cards 0.2 each where the bot's own
      // table charges 2.5. Count only, so a barn card in the payment (D8) prices
      // as a hand card - blind, and the same direction.
      //
      // ⭐ THE FARMSTEAD'S 1 VP PER OWN-SUIT CARD IS NOW PRICED HERE, AS A
      // PROBABILITY (Dean, 03/09/2026). It used to be omitted, with the note
      // that reading it "needs the built card's SUIT, which is card identity,
      // which this pricer may never see" - true, and the wrong conclusion. The
      // blindness rule forbids reading the suit; it does not forbid pricing the
      // EXPECTED VP the way `meanPrintedVp` already prices the expected printed
      // one. The old omission left "a build reached through a door or a meeple
      // worth one VP less to the bot than it really is, ALWAYS IN THE SAME
      // DIRECTION", which is a bias and not a blindness.
      //
      // A build taken as the seat's own MOVE is still priced exactly by the
      // `farmsteadVp` move term reading the real card. This line only closes the
      // gap between that and the same build bought through a door or a meeple.
      if (event.seat !== me) return 0;
      return (
        weight(w, 'build') +
        weight(w, 'buildVp') * meanPrintedVp(s.data) +
        weight(w, 'farmsteadVp') * OWN_CROP_BUILD_PRIOR -
        weight(w, 'handSpend') * handSpendCost(s, event.payment.length)
      );

    // V5's TOKEN SWAP is priced POSITIONALLY, not here. Its whole effect is on
    // the shared board, so there is no delta in the acting seat's own
    // resources for an event price to read and it would score exactly zero -
    // see `deliverabilityValue` below and the note on `Probe.deliverable`.
    // ⛔ UNREACHABLE SINCE v47: V5 retexted off the token swap entirely
    // (tasks/v47-rulings-v1.md), so `demandSwapped` never fires any more.
    // Kept, not deleted - see the `deliverability` weight's note in
    // weights.ts for the full orphan chain this case is one link of.
    case 'demandSwapped':
      return 0;

    /**
     * ⭐ A MEEPLE RETURNED TO THE BOX BY THE SUPPLY CAP (the meeple-loop arm,
     * R4) - and it is worth ZERO rather than negative, which is the opposite of
     * what the name suggests and is the point.
     *
     * `meepleBoxed` is emitted INSTEAD of `meepleGained`, never beside it, so
     * the two partition every meeple ever offered to a supply. The seat did not
     * LOSE a meeple here: it was never handed one. Nothing left its stock,
     * nothing left its board that it wanted, and the cap simply refused a
     * duplicate it could not have held anyway. A negative price would charge the
     * seat for the difference between the meeple it got and the meeple it might
     * have got, which is a regret and not a resource - and would make an island
     * delivery LOOK worse for paying a colour you already hold than for paying
     * no meeple at all, which is false.
     *
     * ⭐ WHERE THE CAP IS ACTUALLY PRICED IS THE ABSENCE. A capped delivery
     * simply earns no `meepleGain`, and a Collect is priced by `s.collectKeeps`,
     * which counts only what survives. That is the honest reading of "worth
     * exactly 0" from the handoff, and it is why nothing here needs a weight.
     *
     * ⚠️ **HANDOFF v2 GAVE THIS EVENT FOUR MORE SOURCES AND THEY ARE NOT THE
     * CAP.** `'build'`, `'activation'` and `'delivery'` are a meeple SPENT as a
     * card of its colour (R15) and `'toll'` is one burned to enter an occupied
     * slot (R6); all four are a real resource leaving a real supply, which is
     * exactly what the paragraph above says the cap's three are NOT. They still
     * price at 0 HERE, and for the opposite reason: each of the four is already
     * charged once, by `meepleAsCard` below for the first three and by the
     * `meepleSpend` MOVE term for the toll. Splitting the case to charge them
     * here as well would double every one of them. **The reader to warn is the
     * one who deletes this case thinking it is only about the cap.**
     */
    case 'meepleBoxed':
      return 0;

    /**
     * ⭐ **A MEEPLE WAS SPENT AS A CARD OF ITS COLOUR (R15, handoff v2)** - the
     * new resource exit, and the half of this ticket that decides whether the
     * arm can be believed.
     *
     * It is charged at `meepleSpend` against `meepleWorth`, which is the same
     * price `meepleGain` credits when one arrives and the same price a visit
     * pays when one leaves for a neighbour's board. One meeple, one price, every
     * exit - the property the whole meeple economy in this package is built on,
     * and the reason no new weight arrives with R15.
     *
     * ⚠️ **WHICH MOVES REACH THIS LINE, BECAUSE THE ANSWER IS NOT "ALL OF
     * THEM".** Only acts on `isProbed` are rolled out, so a meeple charged here
     * is either a GROW's (probed, and charged ONLY here) or one spent by a build
     * or a delivery reached INSIDE a rollout - a Dairy door's Build, a Vegetable
     * door's Deliver. A build or a delivery taken as the seat's OWN move is not
     * probed at all, so its meeples never reach this pricer and are charged by
     * the `meepleSpend` MOVE term instead. That split is the same one `deliver`
     * and `collect` already live under, and `meeplesLeavingSupply` in `terms.ts`
     * is the other end of it. **Get it wrong in either direction and the arm
     * measures the instrument: charge a GROW in both places and meeple-paid
     * activations vanish; charge a build in neither and they are free.**
     *
     * ⭐ **`use === 'delivery'` REFUNDS THE FREIGHT, AND IT IS NOT AN
     * ADJUSTMENT FOR TASTE.** The `delivered` event carries the whole `spend` -
     * what the ISLAND was paid - with no way to see which suits came out of the
     * supply, so its own case has already charged `barnSpend` for a card the
     * barn never held. This gives that back, once per meeple, so that a
     * meeple-paid crate costs a meeple and not a meeple plus a phantom barn
     * card. `terms.ts` does the identical subtraction for the unprobed move, in
     * `barnCardsSpent`.
     *
     * `atThreshold` and `wild` are measurement fields and are deliberately NOT
     * priced. `atThreshold` marks the priced clog bypass - a Grow on a building
     * already full - whose VALUE arrives as the ability's own events one level
     * deeper, exactly as every other activation's does; pricing the flag as well
     * would be a taste for the bypass, and whether the bypass is worth its
     * meeple is precisely what section 3 of the handoff asks the arm to measure.
     * `wild` marks half of a pair (R10): two events with `wild` set are ONE
     * resource bought for TWO meeples, and both are charged, which is what makes
     * a pair cost twice - the same arithmetic the wild VISIT already used.
     */
    case 'meepleAsCard': {
      if (event.seat !== me) return 0;
      const refund = event.use === 'delivery' ? weight(w, 'barnSpend') : 0;
      return refund - weight(w, 'meepleSpend') * meepleWorth(s, event.colour);
    }

    /**
     * ⭐ A TOLL PAID TO ENTER AN OCCUPIED SLOT (R6 as amended), priced at ZERO
     * here because the `meepleSpend` MOVE term charges it.
     *
     * This is the same arrangement, for the same reason, as `meepleSpent` and
     * `visited` above: a visit is on `isProbed`, so charging the toll here as
     * well as on the move would double it and the bots would refuse to pay one.
     * The toll rides on the `visit` ACT (`act.toll`), which is where the move
     * term reads it.
     *
     * ⚠️ It is safe only while the visit MOVE is the only thing that can pay a
     * toll, which it is - no card in the 105 causes a visit - and it is the same
     * standing hole `meepleSpent` names. A card that ever causes a visit inside
     * a rollout makes this line a silent subsidy and the charge has to move
     * here.
     */
    case 'visitToll':
      return 0;

    /**
     * THE COLLECT SUMMARY (the meeple-loop arm, R7), priced at 0 because every
     * meeple it reports has ALREADY been priced one event earlier: each kept
     * meeple fires its own `meepleGained` (paid above at `meepleGain`) and each
     * refused one its own `meepleBoxed`. This event exists so the sim can count
     * an empty-board Collect - the arm's solitaire line - without inferring it
     * from a silence. Paying for it as well would double every Collect reached
     * inside a rollout.
     *
     * ⚠️ A COLLECT TAKEN AS THE SEAT'S OWN MOVE is priced by the `meepleGain`
     * and `bonusDraw` MOVE terms instead, and `collect` is deliberately NOT on
     * `isProbed` - the same arrangement, and the same reason, as `deliver`.
     */
    case 'boardCollected':
      return 0;

    // A door action's worth arrives as that action's own events, so scoring the
    // fact that a door ran would double count. Same for `visited`: the fee is
    // charged by `handSpend` and `visitFeeJunk`, the payoff is the door.
    //
    // ⚠️ UNDER THE MEEPLE-LOOP ARM `visited` CARRIES A REAL COST THAT IS PRICED
    // ELSEWHERE, exactly as the card fee was: the meeple leaves the visitor's
    // supply for the host's board, and the `meepleSpend` MOVE term charges it.
    // That is safe only while the bonus visit is the ONLY thing that can move a
    // meeple out of a supply, which it is - no card in the 105 touches the
    // supply - and it is the same standing hole `meepleSpent` names above. A
    // card that ever causes a visit inside a rollout makes this line a silent
    // subsidy and the charge has to move here.
    //
    // ⭐ AND WHAT THE HOST GAINS IS STILL 0. A meeple handed to a rival is a
    // stored action for them, but this pricer reads what the ACTING seat gains
    // and never rival benefit or rival harm (see the header on `priceEvent`).
    // The arm makes the visit generous in a way the card fee was not, and that
    // generosity is deliberately invisible here: pricing it would make the bots
    // altruistic, and `a02-generosity` measures what they give away instead.
    //
    // ⭐ `meepleplaced` - R17 (05/09/2026): a meeple spent as a card LANDING on
    // a neighbour's board is priced at ZERO HERE, and deliberately, on exactly
    // the reasoning `visitToll` already carries. The meeple leaving this seat's
    // supply is charged once by the `meepleSpend` MOVE term, which claims
    // 'build' and 'deliver'; charging it again on the event would double it.
    // What the HOST gains is invisible on purpose - the bot is self-regarding,
    // and pricing a rival's windfall is what would make it altruistic.
    // a02-generosity measures the gift instead. (The note sits above the group
    // rather than on its own case because eslint 10's `no-fallthrough` counts a
    // comment between two cases as a statement.)
    case 'doorUsed':
    case 'reshuffled':
    case 'cardsDiscarded':
    case 'visited':
    case 'meepleplaced':
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
 * Measured on the old Draw Service, the door the design calls a traffic magnet:
 * priced at **exactly zero in 82.2%** of the positions it was offered in,
 * against 0.0% for all four other doors. The Orchard door is Draw 3 in v31, so
 * the same trap is set one card deeper.
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
 * ⭐ **THE HAND-ROOM CAP IS BACK (02/09/2026), WITH THE HAND LIMIT ITSELF.**
 * Ticket 49 put it here because a card drawn into the end-of-turn discard is an
 * action thrown away, and measured it on the Draw 4 balloon: the bots took that
 * balloon **32.9% of the time with no room in hand at all**, and it widened the
 * UI's worst position from 792 legal moves to 8008 as C(hand, excess) discard
 * subsets piled up. v31 deleted the limit and the cap went with it, on the
 * correct reading that there was nothing left to cap against. What that removed
 * was a brake, and the consequence pointed exactly where the note predicted: a
 * draw could never be a bad move, every door and meeple that draws was worth
 * strictly more, and the free bonus Draw 1 came out dominant over a neighbour
 * visit 3:1. The rule is back at a flat `rules.turn.handLimit`, so this reads it
 * again.
 *
 * The room is read off the PROBE, not off `Scratch`, and that is not fussiness:
 * a visit pays a card out of hand FIRST, so a pre-move reading is short by
 * exactly one on the case that matters - and short by one at room 0 is the
 * difference between "worth a card" and "worth nothing". A null limit means no
 * limit, so nothing is capped there either.
 *
 * ⛔ **IT CAN NEVER PRICE A RIVAL'S DRAW AS THIS SEAT'S, AND UNDER S17 THAT
 * STOPPED BEING A HYPOTHETICAL** (Dean, 11/09/2026,
 * `rules.turn.hostDrawOnVisit`). The rule pushes an ordinary draw TASK for the
 * HOST in the middle of the visitor's turn, so the task this function would
 * read belongs to another seat - and `probe.pending` is set only when the head
 * task is the probing seat's own, so it comes back NULL and this returns null
 * with it. The guard is a line in @gp/engine's `probeAt` rather than a line
 * here, which is the sort of arrangement that stops being true quietly: if
 * `pending` is ever widened to rival tasks, THIS is the function that would
 * start paying a visitor `keepValue` for the card it just gave away, and the
 * sign would be the wrong way round on the busiest move in the arm.
 *
 * ⚠️ **THE SAME ENGINE LINE COSTS THIS FILE THE WHOLE OF A VISIT'S PAYOFF, AND
 * IT IS A DEFECT REPORTED RATHER THAN FIXED** (11/09/2026, engine-side, outside
 * this package's reach). The host's draw task is pushed BEFORE the visitor's
 * power resolves, so it sits at the head of the queue, `probe.next` comes back
 * empty and `rollout` stops before the power's own task is ever walked.
 * Measured at two seats: **99.6% of visit probes stop dead under the arm
 * against 0.0% under its paired control**, so `outcome` prices nearly every
 * visit at whatever the move emitted synchronously and `bonusAction` - which
 * pays only on a strictly positive rollout - barely fires at all:
 *
 *     mean `outcome` on a visit       `outcome` == 0     `bonusAction` paid
 *     2p  2.358 -> 0.003              18.9% -> 99.9%     80.6% ->  0.1%
 *     3p  3.367 -> 0.115               2.4% -> 89.4%     96.4% -> 10.6%
 *     4p  2.806 -> 0.240              13.3% -> 81.3%     86.4% -> 18.7%
 *
 * ⛔ **A VISIT UNDER THE ARM COSTS `handSpend` 2.5 PLUS `hostGift` 2.7 AND
 * EARNS, IN THE BOT'S BOOKS, ABOUT NOTHING.** Nothing in @gp/bots can step past
 * another seat's task, so no weight and no term here can correct it: the fix is
 * the queue position or the probe. Until it lands, **every bonus rate, door mix
 * and hook number off the host-draw arm is a reading about this defect and not
 * about S17.**
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
 * right rule for nearly every card and prices V5 at exactly zero: it swaps two
 * of the island's tokens (V6's face-down token was deleted on 16/09/2026), and
 * moves no card, meeple or receipt. Left alone, the bots would never
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
 * It is the `deliverability` weight - renamed from `marketPayability` in v31,
 * when the GBP 3 market that shared it was deleted and this became its only
 * reader. Nothing about the quantity changed: it is still "a tile that flipped
 * from unpayable to payable", converted into score.
 *
 * ⚠️ THE BOTS CANNOT JUDGE V5'S DENIAL USE, and no weight fixes that. This file
 * prices what a seat GAINS and never rival harm, so every swap a bot takes is
 * self-serving. Whether swapping a token out from under a rival's hoarded pair
 * lands as clever or as the predecessor's "reverse engine-building" resentment
 * is a table question and only a table question.
 *
 * ⛔ ALL OF THE ABOVE IS HISTORY SINCE v47. V5 The Coastal Trading Depot no
 * longer swaps a token at all ("Deliver. 1 of the cards may be any crop.",
 * tasks/v47-rulings-v1.md); `Probe.deliverable` and `deliverableBefore` are
 * gated on the `demandSwapped` event this retext removes the only producer
 * of, so this function now always returns 0. Kept as an orphan by decision -
 * see the `deliverability` weight's note in weights.ts.
 */
function deliverabilityValue(probe: ReturnType<Prober>, w: WeightTable): number {
  if (probe.truncated) return 0;
  return weight(w, 'deliverability') * (probe.deliverable - probe.deliverableBefore);
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
    // leading into a draw is not scored at zero against one that claims a
    // meeple -
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
 * The same holds across the bonus slot: a visit is determined by WHOSE board,
 * because the host's suit is the door, and never by which junk card pays the
 * fee (`visitFeeJunk` prices that), so every fee for a host shares one rollout.
 *
 * ⚠️ ONE KNOWN LEAK IN THAT COLLAPSE, unchanged from v30 and worth stating: the
 * fee does change what the door can do, because the engine gates a door on the
 * hand MINUS the fee. Pay away the only card a Build door could have built with
 * and the door is dead. The first enumerated fee's rollout stands for all of
 * them, which is the same bargain `grow` strikes with its payment card.
 */
function effectKey(move: Move, act: Act): string {
  switch (act.a) {
    case 'grow':
      return `grow:${act.building}`;
    // GROW WITHOUT PLACING: nothing is paid, so the building IS the whole
    // decision and there is nothing for the collapse to fold away.
    case 'activate':
      return `activate:${act.building}`;
    /**
     * ⭐ **THE VISIT, AND SINCE DEAN'S TWO-BOARD FIX (11/09/2026) THE HOST
     * IS NOT THE WHOLE OF IT.**
     *
     * `visit:${act.host}` was exactly right for every game this project has
     * shipped: a host held ONE Notice Board, so naming the host named the
     * building the fee landed on and the power that came back, and every fee
     * for that host legitimately shared one rollout (which is the collapse the
     * header describes, with `visitFeeJunk` pricing the fee in the open).
     *
     * ⛔ **AT TWO SEATS A HOST NOW HOLDS TWO BOARDS PRINTING TWO DIFFERENT
     * POWERS, AND THE OLD KEY COLLAPSED THEM INTO ONE.** Measured before the
     * fix, on the seed `notice-board-two-boards.test.ts` still uses: the two
     * candidate moves scored **1.3099 apiece, equal to every decimal place
     * `explain` prints**, because the first-enumerated board's rollout was
     * memoised and handed straight back for the second - and `bestOf` then
     * broke the tie on the policy's own rng. The bot was choosing between a
     * Draw and a waived Build by coin flip.
     *
     * ⚠️ **AND THE DIRECTION OF THAT ERROR IS THE ONE THAT MATTERS TO
     * THE MEASUREMENT.** The whole point of the second board is that it gives a
     * two-seat player a CHOICE of powers - the fix for the 17.9% of two-seat
     * turns that begin with cards in hand and nothing legal to do - so a bot
     * blind to the choice takes the worse power about half the time and
     * **understates the variant's benefit**. An instrument that cannot see a
     * fix cannot demonstrate one.
     *
     * ⭐ **THE KEY IS FINER, NEVER DIFFERENT.** `act.board` is present only
     * when the host holds more than one board (the engine omits it otherwise),
     * so at three and four seats, under every control, and for every fixture in
     * `packages/sim/fixtures/`, this returns the identical string it returned
     * yesterday. The FEE stays out of the key at both arities, so the collapse
     * the header argues for is untouched: what is added is the one thing that
     * genuinely changes the outcome, and nothing else.
     */
    case 'visit':
      return act.board === undefined ? `visit:${act.host}` : `visit:${act.host}:${act.board}`;
    // The colour IS the action, and nothing else about the move varies.
    case 'spendMeeple':
      return `meeple:${act.colour}`;
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
