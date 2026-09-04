/**
 * The scoring terms. `score(move) = sum over terms of weight[term] * feature(term)`.
 *
 * Ticket 10 chose a term table over a 1-ply state evaluator because `apply`
 * very often returns a mid-effect state with a pending task, so resulting
 * positions are not comparable across moves. The cost of that choice is that
 * the bot has an opinion about each MOVE, which rots when the rules move. Two
 * things hold it honest:
 *
 *   - every term declares the move types it `claims`, and a test asserts the
 *     union of claims is exactly the engine's `MOVE_TYPES`, so a rules change
 *     that adds a move type fails the build rather than scoring it 0 forever;
 *   - `--explain` prints the per-term breakdown behind a decision, so a weight
 *     can be argued with instead of believed.
 *
 * Three terms come straight from the reference implementation's `BotPolicy.php`
 * - `deliver` (DL-78 "Deliver is absolute"), `unclogBoard`, and the junk rank
 * behind `visitFeeJunk`. Everything else is ours.
 *
 * ## ⭐ v31 (02/09/2026) - what left, and the two things that arrived
 *
 * ELEVEN TERMS WENT, and every one of them priced money or a face that no
 * longer exists: `coinGain`, `buy`, `buyDemand`, `buyTargetCrop`, `buySaving`,
 * `marketGain`, `marketSaving`, `upgrade`, `workOwn`, `workerTask` and
 * `discardJunk` (the end-of-turn discard went with the hand limit).
 * `marketPayability` survives under its honest name, `deliverability` - the
 * market was never its only reader, V5 and V6 were.
 *
 * SIX ARRIVED, and the first four are the whole of this ticket:
 *
 *   - **`meepleGain` / `meepleSpend`** - the meeple is the game's second
 *     resource now, and a bot that does not price one will hoard it and report
 *     the mechanism dead. Both read `meepleWorth`, and they are pinned to the
 *     same weight so the bot's own books balance.
 *   - **`farmsteadVp`** - the Farmstead pays 1 VP per own-suit card built, on
 *     every build decision. Unpriced, risk 3 (the monoculture pull) would
 *     measure as absent when it was only invisible.
 *   - **`selfVisit`** - risk 2. The bonus slot's solitaire door and its
 *     interaction door cost the same currency, so they need separate weights or
 *     no arm can tell which one the table is taking.
 *   - **`clogOwnBoard`** - the only structural brake v31 puts on self-visiting.
 *   - **`bonusDraw`** - the slot's free Draw 1, the yardstick every door beats.
 *
 * ## ⭐ THE MEEPLE-LOOP ARM (04/09/2026) - NO NEW TERM AND NO NEW WEIGHT
 *
 * `rules.turn.visitCurrency: 'meeple'` re-cuts the bonus slot into VISIT (a
 * meeple onto a neighbour's board, never your own) and COLLECT (your own board
 * swept back into your supply, plus Draw 1). Five terms change what they read
 * and **not one constant moves**, which is deliberate: the arm has to be
 * readable as a delta against the control on identical seeds, and a repriced
 * table would make every delta a mixture of the rule and the instrument.
 *
 *   - **`handSpend`** loses the visit - no card is spent (R1).
 *   - **`visitFeeJunk` / `visitFeeOwnCrop`** lose their subject with it.
 *   - **`meepleSpend`** gains it: a visit costs one meeple, or TWO as a wild
 *     (R10), at the price a meeple has always carried.
 *   - **`meepleGain`** gains Collect, priced by the meeples that survive the
 *     one-per-colour cap and never by the meeples on the board.
 *   - **`bonusDraw`** gains Collect's draw, at the same rate the free Draw 1 had.
 *   - **`clogOwnBoard`** has no subject at all and is guarded off explicitly.
 *
 * `bonusAction` (the whole-extra-action premium), `visit` and `selfVisit` are
 * untouched, and `outcome` prices the door exactly as before, because what a
 * visit IS did not change - only what pays for it.
 *
 * ## ⭐ HANDOFF v2 (04/09/2026 evening) - AGAIN NO NEW TERM AND NO NEW WEIGHT
 *
 * R15 (`rules.turn.meepleAsCard`) makes a meeple a CARD of its colour, and the
 * amended R6 (`rules.turn.slotToll`) prices an occupied slot rather than
 * refusing it. Both default OFF, both are paired arms against the shipped loop,
 * and the same discipline applies: **not one constant in `weights.ts` moves.**
 * Four terms change what they READ and one constant in `scratch.ts` is new:
 *
 *   - **`meepleSpend`** gains three more exits - a meeple paid into a build, a
 *     meeple paid into an island crate, and a meeple burned as a slot toll - at
 *     the one price a meeple has always carried. It does NOT gain the GROW, and
 *     that omission is load-bearing: see `meeplesLeavingSupply`.
 *   - **`handSpend`** loses the GROW's card when a meeple pays for it.
 *   - **`growSpend`** loses its subject in the same case.
 *   - **`barnSpend`** stops charging the part of a delivery the SUPPLY paid.
 *   - **`MEEPLE_AS_CARD_FLOOR`** (scratch.ts) is the only new number: a meeple
 *     whose door is dead is now worth a CARD rather than 0.4 of a door, because
 *     under R15 that is what it is. It is set by ARGUMENT, like `MEEPLE_LATENT`
 *     and `meepleGain` before it, and it is not overlay-addressable.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveryVp } from '@gp/data';
import type { CardId, Move, MoveType } from '@gp/engine';

import type { Act } from './acts.js';
import { spendSize } from './acts.js';
import { cardValue, totalValue } from './junk.js';
import type { Outcomes } from './outcome.js';
import type { Scratch } from './scratch.js';
import { cardById, handSpendCost, meepleWorth, thresholdOfView } from './scratch.js';

export interface Term {
  readonly name: string;
  /** Move types this term can score. Asserted against the engine's MOVE_TYPES. */
  readonly claims: readonly MoveType[];
  /**
   * `act` is the move with its two spellings collapsed; `s` the per-decision
   * facts. `move` and `o` are for the one term that probes - everything else
   * ignores them, and should, because a term that reaches for the probe when a
   * cheap feature would do is spending an `apply` for nothing.
   */
  readonly feature: (act: Act, s: Scratch, move: Move, o: Outcomes) => number;
  /**
   * This term charges for something, so its product must never be positive.
   *
   * Three terms in a row were written as a negative WEIGHT against an already
   * negated FEATURE and therefore paid the bot for spending more - `growSpend`
   * (ticket 45), `buildSpend` (47) and `deliverCost` (48). Each read correctly
   * at its own call site and each was inverted where it counted, because the
   * sign of a product is not visible from either half.
   *
   * So the convention is declared rather than remembered: a cost term negates
   * in the FEATURE and its weight is POSITIVE in every profile. Both halves are
   * asserted - the weights in `roster.test.ts`, the features against real games
   * in @gp/sim's `bots.test.ts` - so a fourth one cannot be written the old way
   * without turning something red.
   */
  readonly cost?: true;
}

/** Both spellings of the same act: the main move and its task-answer twin. */
const ACTION_AND_TASK: readonly MoveType[] = ['task'];

function suitOf(data: GameData, id: CardId): Suit {
  return cardById(data, id).suit;
}

function stackOf(s: Scratch, building: CardId): number {
  return s.buildings.get(building)?.stack.length ?? 0;
}

function thresholdOf(s: Scratch, building: CardId): number | null {
  const view = s.buildings.get(building);
  return view ? thresholdOfView(s.data, view) : null;
}

function fillsBuilding(s: Scratch, building: CardId): boolean {
  const threshold = thresholdOf(s, building);
  return threshold !== null && stackOf(s, building) + 1 >= threshold;
}

function countOwnCrop(s: Scratch, ids: readonly CardId[]): number {
  let n = 0;
  for (const id of ids) if (suitOf(s.data, id) === s.mySuit) n += 1;
  return n;
}

function countTargetCrop(s: Scratch, ids: readonly CardId[]): number {
  if (s.targetSuit === null) return 0;
  let n = 0;
  for (const id of ids) if (suitOf(s.data, id) === s.targetSuit) n += 1;
  return n;
}

/** The card a standing move spends out of hand. */
function cardMoveSpend(payload: Record<string, unknown>): CardId | null {
  const fee = payload['fee'];
  if (typeof fee === 'string') return fee;
  const card = payload['card'];
  if (typeof card === 'string') return card;
  return null;
}

/**
 * The acts whose value is unknowable from their label (ticket 40).
 *
 * GROW fires a card's ability, and the ability is the entire value of the move.
 * A VISIT and a MEEPLE are the same shape one level up: both buy a DOOR ACTION,
 * and a Harvest door, a Draw 3 door and a Sow-from-hand door are three
 * completely different moves wearing one label. In v30 only the Service branch
 * of a visit was probed, because the other branch paid a flat coin; v31 deleted
 * the coin branch, so **every visit is now worth exactly what its door does**
 * and every one of them is rolled out.
 *
 * ⭐ `spendMeeple` IS ON THIS LIST FOR THE SAME REASON, and it is the single
 * most important entry for the v31 report. A meeple is a stored action; what it
 * is worth is what that action does in this position, and nothing else. A flat
 * weight would have the bots either dumping every meeple the turn they got it
 * or sitting on all of them, and either way the "meeples earned versus spent"
 * assertion would be reporting the weight rather than the rules.
 *
 * `cardMove` stays on the list although the catalogue currently has no producer
 * - the Helping Hand became a bonus-slot modifier with no handler body in v31 -
 * because the move type still exists and the next card to use it would
 * otherwise be priced at a flat weight in silence.
 *
 * The known understatements, unchanged:
 *
 * ⚠️ **W14 The Pizzeria**, whose payoff arrives only after rivals accept - and a
 * probe stops at a rival's task, by design.
 *
 * ⚠️ **D15 The Grand Creamery is understated on purpose**. Its value is an
 * EXPECTATION OVER A RANDOM RUN - reveal a deck top, build it free, reveal again
 * while each card costs more than the last - and a greedy one-decision-at-a-time
 * rollout cannot hold that: it walks the flips it can see inside `DEPTH` and
 * prices each `built` flat and blind, so what comes out is roughly the first
 * flip or two rather than the run. An under-valued D15 is a readable result (the
 * arm reports a low play rate and the card is suspected), where an over-valued
 * one is not. If the arm shows D15 never taken at all, suspect this before
 * suspecting the card.
 *
 * ⚠️ **A5 and A12**, grow-without-placing: A12's second pick is priced by the
 * same path one decision later, which is a beam of one over the two rather than
 * an exhaustive pair.
 *
 * Everything NOT in this set has a feature that already reads its own value -
 * a delivery's printed VP and its meeple, a harvest's stack size, a build's VP -
 * so probing it would spend an `apply` to learn what the table already knows.
 * ⚠️ `deliver` in particular must stay OFF this list: `meepleGain` prices its
 * meeple as a move term and `priceEvent` prices the same meeple as an event, and
 * only the fact that a delivery is never probed keeps those two from both firing.
 */
function isProbed(act: Act): boolean {
  switch (act.a) {
    case 'grow':
    case 'visit':
    case 'spendMeeple':
    case 'cardMove':
    case 'balloon':
    case 'activate':
      return true;
    default:
      return false;
  }
}

/**
 * The receipt a delivery to this tile would take, read off how many seats have
 * already delivered there. 0 for a tile with no room, which never reaches here
 * because a full tile offers no move.
 */
function deliverVpOf(s: Scratch, tileId: string): number {
  const tile = s.view.island.tiles.find((t) => t.tile === tileId);
  return tile ? deliveryVp(s.data, tile.deliveredBy.length) : 0;
}

/**
 * THE MEEPLE THIS DELIVERY WOULD CLAIM - the colour sitting face up on the next
 * free delivery space of this tile.
 *
 * Parallel arrays by index: entry i of `meeples` is the meeple on delivery space
 * i, and `deliveredBy.length` is the next free one. Face up from setup, so this
 * is public information and there is no sight question.
 *
 * ⚠️ IT READS ONE SPACE AND V14 CAN TAKE TWO. The Depot that claims BOTH
 * receipts on a tile also claims both meeples, and this returns only the first,
 * so a V14 delivery is under-priced by one meeple. Left as an understatement
 * rather than special-cased, on this file's standing rule that a term describes
 * a move and never a card - and the safe direction, since the alternative is a
 * bot that over-rates a card it happens to know about.
 */
function meepleAtTile(s: Scratch, tileId: string): Suit | null {
  const tile = s.view.island.tiles.find((t) => t.tile === tileId);
  return tile?.meeples[tile.deliveredBy.length] ?? null;
}

/**
 * Cards this act takes out of the seat's STORED FREIGHT, by whichever exit
 * (ticket 48).
 *
 * Three routes and one price. A tile's card cost is fixed by its crates
 * (`crates x cardsPerCrate`) and a wild crate changes which suit pays rather
 * than how many, so this cannot order the spends for one tile - measured over
 * 391 real (decision, tile) pairs it never once varied within a tile. What it
 * prices is the resource leaving.
 *
 * The build leg is D7 The Versatile Shed's stack payment. A card on one of your
 * own stacks is not in the barn yet, but it is freight in waiting - it goes
 * there on the next harvest and nowhere else - so spending it on a build costs
 * the seat the same thing, and D7's whole printed fork is that a stack card is
 * either freight or building material and never both.
 */
function barnCardsSpent(act: Act): number {
  switch (act.a) {
    // ⭐ R15: `spend` IS WHAT THE ISLAND WAS PAID AND NOT WHAT THE BARN PAID.
    // A meeple pays its share of a crate straight out of the supply, so the
    // barn is short by exactly the meeples in the spend and charging the whole
    // `spend` here would bill a meeple twice - once as freight and again as a
    // meeple, at `meepleSpend`. Zero under both knob-off games, where
    // `act.meeples` is always empty.
    case 'deliver':
      return spendSize(act.spend) - act.meeples.length;
    case 'build':
      return act.stacks;
    default:
      return 0;
  }
}

const NO_MEEPLES: readonly Suit[] = [];

/**
 * ⭐ MEEPLES THIS ACT TAKES OUT OF THE SEAT'S SUPPLY, by whichever exit - the
 * acting meeple of a visit (R1, R10), a meeple spent as a card of its colour
 * (R15), or a meeple burned as a slot toll (R6). Every one of them is a full
 * loss to this seat and every one of them is charged at the same price.
 *
 * ⚠️ **`grow` IS DELIBERATELY ABSENT AND THAT IS THE ONE THING TO GET RIGHT
 * IN THIS FUNCTION.** A GROW is on `isProbed`, so its meeple arrives inside the
 * rollout as a `meepleAsCard` event and `priceEvent` charges it there. Build and
 * Deliver are NOT probed - they never were, for the reasons written at
 * `isProbed` and at `meepleGain` - so their events never reach a pricer and
 * their meeples have to be charged here. Charge a Grow here as well and it pays
 * twice; charge a Build only in the pricer and it pays not at all. **The split
 * is exactly the probed / unprobed line and nothing else.**
 *
 * Two things are NOT returned here and both are handled inline by `meepleSpend`:
 * the v31 turn-start `spendMeeple`, whose single colour would cost an
 * allocation a decision to wrap in a list, and the visit's `toll`, which is a
 * second list on one act.
 */
function meeplesLeavingSupply(act: Act): readonly Suit[] {
  switch (act.a) {
    case 'visit':
    case 'build':
    case 'deliver':
      return act.meeples;
    default:
      return NO_MEEPLES;
  }
}

/** Cards this act takes OUT of the seat's hand. */
function cardsLeavingHand(act: Act): number {
  switch (act.a) {
    // The meeples are NOT here and must not be: `payment` is card ids only, and
    // a meeple never came out of a hand (R15 - it is a card of its colour, but
    // it was never in the hand and it never counts toward the hand limit).
    case 'build':
      return act.payment.length;
    // ⭐ A MEEPLE-PAID GROW SPENDS NO CARD (R15). The null payment is the rule
    // and not a sentinel - nothing is placed, so nothing left the hand - and it
    // is gated on the ACT rather than on the knob, for the reason the `visit`
    // case below states.
    case 'grow':
      return act.payment === null ? 0 : 1;
    // ⭐ A MEEPLE VISIT PAYS NO CARD (R1, the meeple-loop arm). The null fee is
    // the rule itself, not a sentinel: nothing is ever placed on a Notice Board
    // under the arm, so `handSpend` - the only price left in the v31 game -
    // simply has no subject here. Gated on the ACT rather than on the knob so
    // the two can never disagree.
    case 'visit':
      return act.fee === null ? 0 : 1;
    case 'sow':
      return 1;
    case 'cardMove':
      return cardMoveSpend(act.payload) === null ? 0 : 1;
    default:
      return 0;
  }
}

export const TERMS: readonly Term[] = [
  // --- what the move actually does ------------------------------------------
  {
    /**
     * **What a card in hand is worth, which is not nothing** (Dean, 2026-08-02).
     *
     * The other half of every exchange. It was written when `coinGain` priced
     * what a visit GETS and nothing priced what it PAYS, and the two constants
     * deciding a worthless visit were unrelated to each other. Measured at the
     * moment the seat's marginal coin was provably worth zero:
     *
     *     worthless coin visit  -1.95   {visitFeeJunk: -1.95}
     *     vs endTurn            -2.00   {endTurn: -2}
     *
     * The bot gave away a card for literally nothing, by 0.05, in 68% of those
     * positions - not because a card was priced at zero, but because the only
     * thing charging for it was `visitFeeJunk`, a JUNK ORDERING (its own header
     * says "not an economic estimate") that happened to land beside an
     * artificial -2 tax on ending your turn.
     *
     * ⭐ v31 MAKES THIS THE ONLY PRICE IN THE GAME. There is no currency any
     * more: a card is what a build costs, what a grow costs, what a visit costs
     * and what a Power card costs. Everything the bot spends, it spends here.
     */
    name: 'handSpend',
    claims: ['build', 'grow', 'visit', 'cardMove', ...ACTION_AND_TASK],
    feature: (act, s) => -handSpendCost(s, cardsLeavingHand(act)),
    cost: true,
  },
  {
    /**
     * `handSpend`'s twin for the other store: what a card leaving the BARN
     * costs, wherever it leaves for (ticket 48).
     *
     * It used to be two terms with two constants and a hole. `deliverCost` was
     * `-0.5` against a `-spendSize` feature, so the product paid the bot 0.5 a
     * card for delivering to the tile that ate MORE freight; `buildBarn` (ticket
     * 47) charged D8's barn leg properly but only there; and a balloon move's
     * two barn cards were charged nothing at all. One store, three exits, three
     * different answers.
     *
     * The third exit, the balloon, is charged at this same weight but not from
     * here: ticket 49 made a balloon move PROBED, so its freight is taken off
     * the `balloonMoved` event beside the reward that freight bought - which is
     * also where a balloon moved by a card effect INSIDE a rollout gets charged,
     * so one route serves both. Charging it here as well would take it twice.
     *
     * **It stays a COUNT, and it deliberately does not read `demandSuits`**
     * (ticket 51). The hand has an ordering sibling beside its count charge
     * (`visitFeeJunk`, `growSpend`, `buildSpend`) and the barn has none, so the
     * obvious repair is to make a barn card the island still wants dearer than one
     * it does not. Measured over 55 stratified games, that feature is not merely
     * small, it is UNINFORMATIVE:
     *
     *   - the island exit cannot use it at all. A delivery's spend is built from
     *     the tile's own crates, so 100% of the 1580 cards delivered were a suit
     *     an open tile wanted, and 0 of 1098 (decision, tile) pairs separate on it;
     *   - D8's build leg is a dead lane. Only 0.2% of 896 build groups offered a
     *     barn card at all and not one chosen move spent one;
     *   - the balloon is the only exit with a real choice (51.0% of 4604 pairs
     *     pick which two suits burn), and there the demand binary is a coin flip
     *     against what actually matters. Where the choice changes how many island
     *     tiles the barn can still PAY for (13.5% of pairs), burning the fewest
     *     demanded cards keeps the most tiles payable **53.4%** of the time.
     *
     * The reason is ticket 38's: the barn's block is MATCHING under an
     * all-or-nothing payment, not quantity. Burning 1 of 3 wheat when a tile wants
     * 3 is fatal and burning 1 of 6 is free, and a binary "is wheat wanted" cannot
     * tell those apart.
     *
     * **And it does not read PAYABILITY either, which is the feature 51 named as
     * the one that would work** (ticket 52). That feature is real - "would burning
     * these two cards cost me a delivery I could otherwise have made" separates
     * where demand cannot - but the prize is already collected by accident, and
     * the whole of it was measured before anything was written: nothing orders
     * these spends today, so the size of the prize is simply the REGRET the
     * random tie-break pays, and over 55 stratified games that is **9 tiles of
     * payability across 215 moves, 0.16 a game**. Both channels' ceilings are
     * below the noise floor a paired A/B could resolve, which is why one was
     * never run.
     */
    name: 'barnSpend',
    claims: ['deliver', 'build', ...ACTION_AND_TASK],
    feature: (act) => -barnCardsSpent(act),
    cost: true,
  },
  {
    /**
     * The probe term. Applies the move on a throwaway clone and prices what
     * came out, in this same weight table's currency - so a grow that harvests
     * a three-card stack is worth what harvesting that stack is worth, and a
     * grow that does nothing here is worth nothing here.
     *
     * Its default weight is 1 because the value arrives already denominated:
     * the pricer scored those events with the profile's OWN weights, so a
     * racer's rollout is priced through a racer's eyes. The weight stays
     * tunable for the one thing it can honestly express - how much a profile
     * trusts a rollout against a flat preference.
     *
     * ⭐ IT NOW CARRIES BOTH HALVES OF THE BONUS SLOT AND THE MEEPLE PHASE.
     * A visit is worth its door, a meeple is worth its door, and this is the
     * only term that can see either. Set `outcome` to 0 in a profile and that
     * profile goes blind to three of the five things v31 changed.
     */
    name: 'outcome',
    claims: ['grow', 'visit', 'spendMeeple', 'cardMove', 'moveBalloon', ...ACTION_AND_TASK],
    feature: (act, _s, move, o) => (isProbed(act) ? o.value(move) : 0),
  },

  // --- the island -----------------------------------------------------------
  {
    // DL-78. The one rule that makes a game terminate, so it carries the
    // biggest feature in the table: the VP this delivery would actually take.
    //
    // Since the flat island (2026-08-09) that is no longer a property of the
    // tile but of its fill order - 6 for arriving first, 3 for second - so this
    // one feature carries the whole race. It is why the bot prefers a fresh tile
    // to a half-taken one without any term saying so.
    name: 'deliver',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'deliver' ? deliverVpOf(s, act.tile) : 0),
  },
  {
    /**
     * ⭐ **THE MEEPLE THE ISLAND HANDS OVER** (v31), and the reason a delivery
     * is not simply worth its VP any more.
     *
     * The island's coin is gone; every delivery space carries a meeple instead,
     * face up from setup, so which colour a tile will pay is public all game and
     * choosing WHICH tile to deliver to is now partly a choice of which free
     * action to store. A bot blind to this would pick tiles on VP and freight
     * alone and the whole face-up-meeple design would measure as decorative -
     * the same failure mode the demand tokens hit before ticket 52.
     *
     * The feature is `meepleWorth`: 1 for a colour whose door this seat could
     * use, `MEEPLE_LATENT` for one it could not. See `scratch.ts` for why that
     * scale is deliberately FLAT across the five colours - a bot told in advance
     * that a Draw meeple beats a Sow meeple would hand the plan's door-mix
     * question back as an answer.
     *
     * Pinned to `meepleSpend` in `weights.ts`: one price for a meeple, whichever
     * direction it travels. If one moves, move both.
     *
     * ## ⭐ IT NOW ALSO PRICES **COLLECT** (the meeple-loop arm, R7)
     *
     * Collect is the arm's other bonus option and it pays in two currencies at
     * once: a flat Draw 1, which `bonusDraw` prices at the same rate it always
     * priced the free draw, and the meeples coming home off your own board,
     * which are stored actions and belong here at the island's own meeple price.
     * Nothing new is introduced for it - same weight, same `meepleWorth` scale -
     * because a meeple arriving from your own Notice Board and a meeple arriving
     * off a tile are the same object arriving in the same supply, and any
     * daylight between the two prices would be the instrument inventing a
     * preference between the arm's two faucets.
     *
     * ⭐ **THE CAP IS PRICED, AND IT IS THE SUBTLE HALF.** The feature reads
     * `s.collectKeeps` - the meeples that would SURVIVE the one-per-colour cap -
     * so a duplicate is worth exactly 0 and collecting a board full of colours
     * you already hold is worth precisely the draw and nothing else. That is the
     * whole shape of the cap as a rule, and a bot that counted meeples on the
     * board instead would over-rate the one position the cap exists to punish.
     *
     * ⚠️ **COLLECT MUST STAY OFF `isProbed`**, for the reason `deliver` is off
     * it: inside a rollout the same meeples arrive as `meepleGained` events and
     * `priceEvent` charges this same weight for each. Probing a Collect would
     * pay for it twice. No card in the 105 causes a Collect today, so the two
     * paths cannot both fire - but that is a fact about the catalogue and it is
     * written here because the next card to reach for one would break it
     * silently.
     */
    name: 'meepleGain',
    claims: ['deliver', 'collect', ...ACTION_AND_TASK],
    feature: (act, s) => {
      if (act.a === 'collect') {
        let worth = 0;
        for (const colour of s.collectKeeps) worth += meepleWorth(s, colour);
        return worth;
      }
      if (act.a !== 'deliver') return 0;
      const colour = meepleAtTile(s, act.tile);
      return colour === null ? 0 : meepleWorth(s, colour);
    },
  },
  {
    /**
     * The freight branch: a Deliver action that moves a balloon instead. Pays
     * 2 differing barn cards and is never an island delivery.
     *
     * The flat taste for taking one at all, and nothing more - ticket 49 moved
     * what the move is WORTH into the probe (its printed reward) and what it
     * COSTS into the pricer (its two barn cards), so this is the exact twin of
     * `grow`: a preference about the action, with the outcome priced where the
     * outcome is. Its default weight is 0; see `weights.ts`.
     */
    name: 'balloon',
    claims: ['moveBalloon', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'balloon' ? 1 : 0),
  },

  // --- the meeple supply ----------------------------------------------------
  {
    /**
     * ⭐ **WHAT SPENDING A MEEPLE COSTS** - the term that decides whether the
     * bots hoard, and therefore whether the v31 report can be believed on the
     * meeple economy at all.
     *
     * A meeple is spent for free at the start of a turn and then LEAVES THE
     * GAME. Nothing in the rules charges for that, so a naive evaluator sees an
     * unconditional free action and spends every meeple the instant it can,
     * which would report a healthy economy no matter how badly the colours were
     * distributed. The real cost is the one a person feels: the stored action is
     * gone, and it might have been worth more next turn.
     *
     * So it charges exactly what `meepleGain` credited - the same
     * `meepleWorth`, the same pinned weight - which gives the bot a balanced set
     * of books and reduces the whole decision to one honest question: **is what
     * this door does right now worth more than holding the meeple?** The answer
     * comes from the rollout (`outcome`), which is a measurement rather than a
     * taste, and the only thing this term contributes is the reserve price.
     *
     * ⚠️ TWO THINGS IT CANNOT SEE, both stated because either could show up as
     * a false finding:
     *
     *  1. **A meeple has no terminal value.** Holding one at the end of the game
     *     is worth zero VP - deliberately, per the scoring header - so an ideal
     *     player empties their supply before the end and this term will keep a
     *     bot holding one it should have burnt. Expect the dead-meeple count to
     *     be an OVER-estimate near the end trigger.
     *  2. **It cannot compare this turn with next turn.** The evaluator is
     *     myopic per decision, so "wait for a better moment" is expressed as a
     *     flat reserve price and nothing else.
     *
     * ## ⭐ IT NOW ALSO CHARGES THE **VISIT** (the meeple-loop arm, R1, R10)
     *
     * Under the arm a visit costs no card and one MEEPLE, so the term that
     * charged the turn-start spend is the term that charges this: same
     * `meepleWorth`, same pinned weight, one price for a meeple leaving a supply
     * whichever door it leaves by. `handSpend` used to charge 2.5 for the visit's
     * card and `meepleGain` prices a meeple at 2.5, which is not a coincidence -
     * `weights.ts` pinned them deliberately, on the reading that *"the two routes
     * to a door are a card and a meeple, so the bot should be roughly
     * indifferent between them"*. The arm deletes one route and the price of the
     * other is unchanged, so the bonus slot's whole arithmetic - a door's rollout
     * plus `bonusAction` 2.4 against the solitaire line's `bonusDraw` 1.2 -
     * survives the currency change intact.
     *
     * ⚠️ **A SPENT MEEPLE IS NOT DESTROYED UNDER THE ARM, AND IT IS STILL A FULL
     * LOSS TO THIS SEAT.** It moves to the host's board and the HOST collects it.
     * That is the loop, and it is the half of the design that pays for being
     * visited - but this bot is self-regarding by standing rule (`outcome.ts`),
     * so what the host gains prices at 0 here exactly as the card fee did. If
     * that rule is ever relaxed, this is one of the two places it lands.
     *
     * ⭐ **THE WILD SPEND IS CHARGED BY THE COUNT** (R10): two meeples buy one
     * door, so the sum runs over `act.meeples` and a wild costs twice what a
     * plain visit costs. That is the only thing separating the two in the bots'
     * eyes - the door bought is identical, the rollout is identical, the action
     * premium is identical - which is exactly the shape the wild-share metric
     * wants, because it makes a wild a move a bot takes when the door is worth
     * two meeples and never a move it takes for free.
     *
     * ⚠️ **THE HANDOFF SAID "MINUS TWO LATENT MEEPLES" AND THIS CHARGES
     * `meepleWorth` INSTEAD.** The two agree in the case the spec was describing
     * - the pair you spend as a wild is usually two colours whose own doors are
     * dead, which `meepleWorth` prices at `MEEPLE_LATENT` each - and they differ
     * when a live-door meeple goes into the pair, where a flat latent charge
     * would under-price a real loss. Charging the flat rate would also break the
     * pin: a meeple would cost less leaving than it credited arriving, and a bot
     * whose books do not balance on its second resource burns it. Sweeping the
     * flat-0.4 variant is a one-line change here if the wild share reads high.
     *
     * ## ⭐ HANDOFF v2: IT NOW ALSO CHARGES A MEEPLE SPENT AS A **CARD** (R15)
     * ## AND A MEEPLE BURNED AS A **TOLL** (R6 as amended)
     *
     * `rules.turn.meepleAsCard` lets a meeple pay a build cost, a Grow's
     * activation and an island crate; `rules.turn.slotToll` prices an occupied
     * slot in extra meeples instead of refusing it. **All four exits are one
     * price**, on the standing rule this term was written under - one price for
     * a meeple leaving a supply, whichever door it leaves by - and there is
     * therefore no new weight for either rule. What DID move is the FEATURE the
     * price multiplies: `meepleWorth`'s floor rises from `MEEPLE_LATENT` 0.4 to
     * `MEEPLE_AS_CARD_FLOOR` 1 under R15, because a meeple whose door is dead is
     * still a card. See `scratch.ts` for the argument and for what it costs.
     *
     * ⚠️ **A BOXED MEEPLE NEVER COMES BACK AND A VISITED ONE DOES, AND THIS
     * TERM DOES NOT DISTINGUISH THEM.** The acting meeple of a visit moves to
     * the host's board and the host collects it; a build payment and a toll go
     * to the box (R16). To a SELF-REGARDING bot both are gone, so both are a
     * full charge - the difference is entirely in what the RIVAL gets, which
     * `outcome.ts` prices at 0 by standing rule. If that rule is ever relaxed,
     * this is the term where the two stop being the same thing.
     *
     * ⚠️ **THE BUILD LEG IS DELIBERATELY NEUTRAL AGAINST A HAND CARD.** A
     * dead-door meeple prices at 1 x 2.5 and a hand card at `handSpend` 2.5, so
     * a bot paying a build is INDIFFERENT between them, and a live-door meeple
     * prices at 1.6 x 2.5 so it prefers to keep that one and pay with the card.
     * That ordering is the whole of the instrument's opinion about R15, and it
     * was chosen because it does not manufacture the number the arm is being run
     * to read: no taste for or against paying in meeples, only the door option
     * the payment gives up.
     *
     * ⛔ **`grow` IS NOT CLAIMED AND MUST NOT BE.** A GROW is probed, so its
     * meeple is charged by `priceEvent`'s `meepleAsCard` case inside the
     * rollout. Adding it to `claims` would charge it twice. `meeplesLeavingSupply`
     * carries the same warning at the other end.
     */
    name: 'meepleSpend',
    claims: ['spendMeeple', 'visit', 'build', 'deliver'],
    feature: (act, s) => {
      if (act.a === 'spendMeeple') return -meepleWorth(s, act.colour);
      // The meeple-loop arm's visit, R15's build and delivery payments, and the
      // amended R6's toll. Every one of these lists is EMPTY under the `'card'`
      // game and under `meepleAsCard: false` / `slotToll: null`, so the whole
      // term collapses to the v1 arithmetic without reading a knob.
      let cost = 0;
      for (const colour of meeplesLeavingSupply(act)) cost += meepleWorth(s, colour);
      if (act.a === 'visit') for (const colour of act.toll) cost += meepleWorth(s, colour);
      return -cost;
    },
    cost: true,
  },

  // --- the barn supply line -------------------------------------------------
  {
    name: 'harvest',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'harvest' ? stackOf(s, act.building) : 0),
  },
  {
    /**
     * The reference's second rule, and it is worth MORE in v31 than it was.
     * A clogged Notice Board used to shut the table's coin faucet; it now shuts
     * a DOOR - your suit's action, for every neighbour and, since self-visiting,
     * for you as well - and only a Harvest reopens it.
     *
     * It is also the pin for `clogOwnBoard` below: shutting your own door costs
     * exactly what reopening it pays.
     */
    name: 'unclogBoard',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'harvest' && s.noticeBoard !== null && act.building === s.noticeBoard.card ? 1 : 0,
  },
  {
    name: 'grow',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'grow' ? 1 : 0),
  },
  {
    name: 'growCompletes',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'grow' && fillsBuilding(s, act.building) ? 1 : 0),
  },
  {
    // GROW's card payment was the one main-action cost with no term against it:
    // Build pays `buildSpend`, Deliver pays `barnSpend`, and growing was free.
    // Reading the actual card (rather than a flat -1) is what makes the bot pay
    // its junk into the stack, the same principle as `visitFeeJunk`. Your own
    // hand card, so no probe and no sight question.
    name: 'growSpend',
    claims: ['grow', ...ACTION_AND_TASK],
    // ⭐ A MEEPLE-PAID GROW HAS NO CARD TO RANK (R15), so this junk ordering has
    // no subject and returns 0. What the meeple COSTS is charged inside the
    // rollout by `priceEvent`'s `meepleAsCard` case, because a GROW is probed -
    // see `meeplesLeavingSupply` for why that is the whole rule.
    feature: (act, s) =>
      act.a === 'grow' && act.payment !== null ? -cardValue(s.data, act.payment) : 0,
    cost: true,
  },
  {
    /**
     * GROW WITHOUT PLACING (A5, A12). A flat taste for firing something, and
     * deliberately SMALL: the real value comes through `outcome`, because
     * `isProbed` rolls the activation out. Nothing is spent - no card, no stack
     * - so there is no cost term to pair with it.
     *
     * ⚠️ Keep it low. A high flat weight here would have the bot picking a
     * target for the label rather than the payoff, which is the failure mode the
     * probe exists to prevent.
     */
    name: 'activate',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'activate' ? 1 : 0),
  },
  {
    /**
     * ⚠️ HAND SOWS ONLY, AND `deckSow` IS A STANDING BLIND SPOT. A sow off a
     * deck top (A13, W7, and a deck-sow door if the Apiary board is ever dialled
     * that way) scores nothing here and nothing anywhere else, so the bot takes
     * it over `skip` at -1 and then picks its target by random tie-break. That
     * predates v31 and is left alone on purpose: fixing it in the same pass as
     * the rules change would make the delta unattributable.
     */
    name: 'sow',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'sow' ? 1 : 0),
  },
  {
    name: 'sowCompletes',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'sow' && fillsBuilding(s, act.onto) ? 1 : 0),
  },

  // --- the tableau ----------------------------------------------------------
  {
    name: 'build',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'build' ? 1 : 0),
  },
  {
    name: 'buildVp',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' ? cardById(s.data, act.card).printedVp : 0),
  },
  {
    /**
     * ⭐ **THE FARMSTEAD'S OWN-SUIT VP** (v31) - *"Game end: 1 VP for each CROP
     * card you have built"*, printed on all five Farmsteads, on top of each
     * card's own printed VP.
     *
     * This is a STANDING TERM ON EVERY BUILD, not an end-game surprise, and that
     * is exactly why it needs a term: the payoff is decided at the moment a card
     * is chosen, and a bot that only met it at scoring time would never have
     * built toward it. Unpriced, **risk 3 of the whole pass - the monoculture
     * pull - would measure as ABSENT when it was only invisible**, and the
     * own-crop build share (82.6% before the change) would look like a bot taste
     * rather than a rule.
     *
     * ## What it reads, and why not `mySuit`
     *
     * The FARMSTEAD's printed crop, and only while the Farmstead is on the
     * table. The two cannot differ today - a Farmstead is a starter, so it is
     * only ever in front of the seat that plays its suit - and keying off the
     * card is what keeps that a fact rather than an assumption. Deck cards only:
     * `cropOf` says a starter prints no crop, so a starter counts neither for
     * its crop nor against it, and a build is never a starter anyway.
     *
     * Every deck card of the crop counts, not just the buildings - a Power card
     * and an Endgame card print their crop icon like anything else - because
     * that is what the handler does.
     *
     * ## The weight is a PIN, not a taste
     *
     * 1 VP through this door is 1 VP through any other, so it takes `buildVp`'s
     * weight and moves with it. That distinction is the whole point of splitting
     * it from `buildOwnCrop`, which sits right below and IS a taste: after this
     * change the reference bot's preference for its own crop is the rule's, and
     * a profile that wants more than the rule pays has to say so out loud.
     */
    name: 'farmsteadVp',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'build' && s.farmsteadCrop !== null && suitOf(s.data, act.card) === s.farmsteadCrop
        ? 1
        : 0,
  },
  {
    /**
     * A profile's loyalty to the crop it was DEALT, over and above what the
     * rules pay for it.
     *
     * ⚠️ **ZEROED IN THE REFERENCE TABLE FOR v31**, and that is a deliberate
     * change to the instrument rather than a tidy-up. Its comment has carried a
     * warning since 2026-08-12: the Farmstead's free flip was retired and this
     * weight was left "preferring something the rules no longer pay for". v31
     * makes the rules pay for it again - 1 VP a card - and `farmsteadVp` above
     * prices exactly that. Leaving 2 here as well would have the reference bot
     * chasing its own crop for a rule AND for a taste, and then reporting the
     * result as risk 3's own-crop build share. That is ticket 40's sin in one
     * line: a weight we chose manufacturing the number an assertion reports.
     *
     * Kept as a live knob rather than deleted, exactly as `visit: 0` is:
     * `loyalist` raises it to express a taste ABOVE the rule (the upper bound on
     * risk 3), and `magpie` vetoes it at -100 (the control that asks whether the
     * suit is load-bearing at all).
     */
    name: 'buildOwnCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' && suitOf(s.data, act.card) === s.mySuit ? 1 : 0),
  },
  {
    /**
     * The magpie's build: the strongest seated crop that is not its own.
     *
     * Weighted 0 everywhere but `magpie`, so it is inert in the reference and
     * the four archetype mirrors.
     */
    name: 'buildTargetCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'build' && s.targetSuit !== null && suitOf(s.data, act.card) === s.targetSuit
        ? 1
        : 0,
  },
  {
    /**
     * Which cards pay for a build - the junk ordering the build never had
     * (ticket 47).
     *
     * This used to read `-(payment.length + coinWild)`, which cannot order a
     * build's payments at all: the engine holds
     * `payment.length + stacks === cardsNeeded`, so for one built card that sum
     * is a CONSTANT. Measured over 262 real builds it varied across the
     * alternatives 2 times - so 23.7% of builds had a real choice of which cards
     * to burn and the term was blind to every one of them, leaving the pick to
     * the evaluator's random tie-break.
     *
     * So it becomes what its siblings already are - `visitFeeJunk`, `growSpend`,
     * `cardMoveSpend`, all `+0.3` on a `-value` feature - and the build's SIZE
     * stays charged where it always really was, by `handSpend`.
     *
     * Unlike a GROW's payment (which must match the activation suit, so every
     * legal payment is the same suit and differs only as cards), a build's wild
     * half takes any suit - so the alternatives here differ in suit as well as
     * value, and paying the junk is the whole of the choice.
     */
    name: 'buildSpend',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' ? -totalValue(s.data, act.payment) : 0),
    cost: true,
  },

  // --- the hand -------------------------------------------------------------
  {
    /**
     * The plain Draw action, worth the cards it ACTUALLY KEEPS - the printed
     * keep, capped by the room left under the hand limit.
     *
     * ⭐ **IT SCALES BY ROOM AGAIN (02/09/2026), AND THAT IS THE POINT OF THE
     * WHOLE CHANGE.** The absence of this cap is the bot-side half of why the
     * hand limit came back: with no ceiling a card in hand always priced at a
     * full card, so drawing never got worse and the free bonus Draw 1 became
     * strictly dominant, beating a neighbour visit 3:1 and failing the hook
     * assertion. A ceiling is what makes the tenth card worth less than the
     * second, and a diminishing return on drawing is what makes a neighbour's
     * farm worth walking to.
     *
     * ⚠️ **THE SHAPE IS NOT THE ONE THAT WAS DELETED, ON PURPOSE.** Before v31
     * this feature was the raw ROOM (0 up to the limit), which worked while
     * limits were 5-7 and the base Draw kept 1. The limit is 12 now and the base
     * Draw keeps 2, so raw room would price an empty-handed Draw at 12 x 1.2 =
     * 14.4 and drown every other move on the menu. `min(keep, room)` is the
     * honest statement instead - a draw is worth the cards that survive to your
     * next turn - and it agrees with `pendingDrawValue`, which caps the same way.
     *
     * ⚠️ **THE -1 FLOOR IS DELIBERATE AND IS NOT A TYPO.** It arrived on
     * 19/08/2026 as the fix for a real deadlock: two 2-seat games in six ran to
     * the 6000-move ceiling because a full hand priced a draw at 0, and zero is
     * not a penalty when every productive move on the menu is negative, it is
     * the argmax. From `--explain` on seed `end-2-5` at turn 241: a Wheat seat
     * holding five Tier 3 cards it could not afford, hand limit five, no
     * non-full building to GROW. Its whole menu priced out as `draw` 0.00, five
     * `grow`s at -0.60, five `visit`s at -1.60 - every one of them a way OUT of
     * the position. So it drew, kept one, discarded one at -2.20, and did it
     * again for a thousand turns. **It paid 2.20 to throw away the card it would
     * not pay 2.50 to spend.** The floor says "churning your hand is worse than
     * doing something", in the units this term already uses, and needs no new
     * weight. At a limit of 12 rather than 5 the deadlock is much further away,
     * but the floor costs nothing and its absence cost two games.
     */
    name: 'drawAction',
    claims: ['draw'],
    feature: (act, s) =>
      act.a === 'draw'
        ? s.handRoom > 0
          ? Math.min(s.data.rules.turn.baseDraw.keep, s.handRoom)
          : -1
        : 0,
  },
  {
    /**
     * THE BONUS SLOT'S SOLITAIRE HALF (v31): a free Draw 1, taken instead of
     * placing a card on a Notice Board.
     *
     * It is the yardstick every door has to beat, and pricing it wrong bends
     * risk 2 in whichever direction the error points, so the weight is PINNED to
     * `drawAction`: a card drawn is a card drawn, whichever door it came
     * through, and the only difference between this and the plain Draw is how
     * many cards arrive. Nothing here expresses a taste for the slot itself -
     * ticket 40 measured what a flat taste for spending the bonus slot does, and
     * it manufactured the exact traffic the hook assertion counts.
     *
     * ⭐ CAPPED BY ROOM IN HAND (02/09/2026), like `drawAction`, and for the
     * reason the hand limit came back at all: a free card into a hand that will
     * discard it at the boundary is not a free card. This is the term that
     * decides risk 2, so it is the one place the diminishing return matters most.
     *
     * ⚠️ NO -1 FLOOR HERE, and the asymmetry is deliberate. `drawAction`'s
     * floor exists because a MAIN ACTION must be spent on something, so 0 can be
     * an argmax in a position where every alternative is negative. A bonus slot
     * may simply be left unspent at 0, so a full hand already declines this
     * option without being pushed - and a negative would push the bot towards
     * SLOT UNSPENT, which is one of the four numbers the watch-list reads.
     *
     * ## ⭐ IT IS ALSO **COLLECT's** DRAW (the meeple-loop arm, R7, R9)
     *
     * The arm deletes the standalone free Draw 1 and attaches the same
     * `rules.turn.bonusDraw` cards to Collect instead, so the NUMBER survives
     * the rule and this term follows it. That is the honest mapping and not a
     * convenience: *"collect an empty board"* is Draw 1 wearing a different move
     * type, and the arm's own bonus mix counts it as the solitaire line for
     * exactly that reason. Pricing it at any other rate would put a thumb on the
     * one comparison the whole arm exists to make.
     *
     * ⭐ **IT IS ONLY HALF OF A COLLECT'S PRICE.** The other half - the meeples
     * coming home, after the cap - is `meepleGain`'s, and a Collect on a busy
     * board therefore beats a Collect on an empty one by exactly the stored
     * actions it recovers. The two terms together are what make "the host is
     * paid for being visited" visible to a bot at all; either one alone reports
     * the arm as half a design.
     *
     * ⚠️ THE HAND-ROOM CAP APPLIES TO BOTH AND IS THE ARM'S ONE ASYMMETRY: a
     * Collect into a full hand is worth its meeples and no draw, where a Collect
     * into an empty one is worth both. That is the right shape - the draw really
     * is worthless at the limit - but it means the arm's solitaire line goes to
     * zero at a full hand where the v31 free Draw 1 did too, so the two arms stay
     * comparable on that axis.
     */
    name: 'bonusDraw',
    claims: ['bonusDraw', 'collect'],
    feature: (act, s) =>
      act.a === 'bonusDraw' || act.a === 'collect'
        ? Math.min(s.data.rules.turn.bonusDraw, s.handRoom)
        : 0,
  },
  {
    name: 'deckOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && act.suit === s.mySuit ? 1 : 0),
  },
  {
    /** The magpie's acquisition lane. 0 in every other profile. */
    name: 'deckTargetCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) =>
      act.a === 'deckPick' && s.targetSuit !== null && act.suit === s.targetSuit ? 1 : 0,
  },
  {
    /**
     * **Measured dead** (ticket 53), and left in place.
     *
     * Deleting it outright changes the bot's top move in **0 of 4650** decisions
     * offering a deck pick, over 55 stratified games. It is 0.8 against
     * `deckOwnCrop`'s 1.0 and a seat's own deck is in play whenever the seat is,
     * so the own deck wins outright: taken on 83.9% of deck picks, with the own
     * deck on offer in exactly 83.9% - it is taken every single time it is
     * available. In the remaining 16.1% every deck still on offer is demanded,
     * so the term is uniform there too and cannot order those either.
     *
     * Not deleted, because the finding is not "this weight is wrong" but "the
     * Draw never varies", which is a question about the instrument's whole
     * acquisition lane. ⚠️ v31 gives it more to do than it had: the base Draw is
     * see 2 keep 2 off any two decks, so a draw is now purely a choice of WHICH
     * decks, with no keep decision behind it to absorb the error.
     */
    name: 'deckDemand',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && s.demandSuits.has(act.suit) ? 1 : 0),
  },
  {
    /**
     * Which cards a see/keep draw keeps.
     *
     * ⚠️ MOSTLY INERT IN v31 AND KEPT ANYWAY. The base Draw is see 2 keep 2 and
     * the Orchard door is see 3 keep 3, so almost every draw in the game now
     * keeps everything and offers exactly one keep answer. It still fires for
     * any card that reveals more than it keeps, and it is what the pricer uses
     * to value a pending draw analytically, which is a much hotter path.
     */
    name: 'keepValue',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? totalValue(s.data, act.cards) : 0),
  },
  {
    name: 'keepOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? countOwnCrop(s, act.cards) : 0),
  },
  {
    /**
     * The junk rank, negated: the cheapest discard scores highest. Back with the
     * turn-boundary overflow (02/09/2026).
     *
     * ⚠️ It orders the choice and must never price the EVENT. The seat has no
     * say in whether it discards, only in which cards go, so a term that made
     * discarding look expensive would be charging for something nobody chose -
     * and `drawAction`'s deadlock is what that did last time it happened by
     * accident.
     */
    name: 'discardJunk',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'discard' ? -totalValue(s.data, act.cards) : 0),
    cost: true,
  },
  {
    /** Which of a Draw's cards the magpie keeps. 0 in every other profile. */
    name: 'keepTargetCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? countTargetCrop(s, act.cards) : 0),
  },

  // --- the bonus slot: the two doors ----------------------------------------
  {
    /**
     * **A VISIT TO A NEIGHBOUR is worth its payoff and nothing else** (Dean,
     * ticket 40), which is why the default weight is 0 rather than absent.
     *
     * The flat 6 used to BE the visit's value, coin payoff included. `outcome`
     * now prices the payoff where the payoff is, and the first measured build
     * left 2 behind as an intrinsic taste for spending the free bonus slot. That
     * constant turned out to be doing real damage: at `visit: 2` the bots took
     * coin visits whose marginal coin they valued at exactly zero in **70.4%**
     * of cases - the slot is free, the fee is junk, so a worthless visit still
     * beat leaving the slot unused.
     *
     * Which made it the wrong number to leave in the instrument, because the
     * hook assertion counts visits per turn as the design's own "did players
     * watch each other" metric. A weight we chose was manufacturing the traffic
     * that metric measures. Measured at 0 against 2: visits/turn 0.443 -> 0.368,
     * and every remaining visit buying something.
     *
     * ⭐ **THAT ARGUMENT IS WHY `selfVisit` BELOW IS ALSO 0.** Risk 2 asks which
     * of the two doors a table takes when both cost one card out of one slot.
     * The only way the answer means anything is if the instrument has no
     * preference between them, so both flat tastes are zero and the whole
     * difference the bots see is the difference the rules make: which door the
     * board grants, and whether the card clogs a board you need.
     */
    name: 'visit',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' && !act.self ? 1 : 0),
  },
  {
    /**
     * ⭐ **THE SELF-VISIT - RISK 2 OF THE WHOLE PASS, ARMED ON PURPOSE.**
     *
     * v31 lets a seat place its bonus card on its OWN Notice Board and take its
     * own suit's action. That is a solitaire door bought with the same currency,
     * out of the same slot, as the interaction door - and the plan's own words
     * are that *"every previous version of this game has had the solitaire
     * option crowd out the visit when the two competed in one slot"*.
     *
     * It gets its own weight, separate from `visit`, for one reason: **the sim
     * must be able to tell them apart**. `a08-the-hook` counts self-visits
     * separately and must never credit one as interaction, and a bot that scored
     * both through one weight could not be pointed either way - there would be
     * no hermit control worth running.
     *
     * At 0 in the reference, for the reason spelled out on `visit` above. The
     * two things that actually separate the doors in the bots' eyes are both
     * rules: `outcome` prices whichever door the host's suit grants, and
     * `clogOwnBoard` charges for shutting your own.
     */
    name: 'selfVisit',
    claims: ['visit'],
    // ⛔ ALWAYS ZERO UNDER THE MEEPLE-LOOP ARM, BY THE RULE AND NOT BY A GUARD.
    // X5 removes the self-visit under any flag, so `act.self` is false for every
    // visit the engine will ever enumerate there and this feature never fires.
    // Left exactly as it is: the term is the CONTROL arm's instrument, and one
    // of the arm's own claims is that this reads 0 - which `a08-the-hook` should
    // assert rather than assume, and which a special case here would make
    // unfalsifiable.
    feature: (act) => (act.a === 'visit' && act.self ? 1 : 0),
  },
  {
    /**
     * ⭐ **THE DOOR IS A WHOLE EXTRA ACTION, AND UNTIL 03/09/2026 NOTHING PAID
     * FOR THAT** (Dean). This term reverses half of ticket 40 on purpose, and
     * the half it reverses is the half that was wrong.
     *
     * Ticket 40 ruled that "a visit is worth its payoff and nothing else" and
     * set `visit` and `selfVisit` to 0, because a FLAT taste for spending the
     * slot manufactured the very traffic `a08-the-hook` counts: at `visit: 2`
     * the bots took visits they valued at exactly zero in 70.4% of cases. That
     * finding stands and this term does not undo it.
     *
     * What ticket 40 got wrong is the arithmetic underneath. In the shipped
     * table a card leaving hand costs `handSpend` 2.5 and the free Draw 1 pays
     * `bonusDraw` 1.2, so a door had to roll out above **3.7** before a bot
     * would take it over the solitaire option - and a one-ply rollout prices
     * only the goods an action produces, never the fact that it IS an action.
     * Dean, 03/09/2026: *"there has to be a value placed on having an extra
     * action. This can be very powerful. Another way of looking at it is to see
     * that the Draw 1 option is only worth half an action."*
     *
     * So the anchor is his: `drawAction` pays 1.2 a card for a Draw 2, which is
     * **2.4 for one whole action**, and `bonusDraw` pays 1.2 for exactly half of
     * one. The default weight here is that same 2.4.
     *
     * ⚠️ **IT FIRES ONLY ON A DOOR THAT ACTUALLY DOES SOMETHING** - a strictly
     * positive rollout - which is the guard that keeps ticket 40's finding
     * intact. A Harvest door with nothing full, a Deliver door with an empty
     * barn and a Build door with nothing affordable all roll out at zero or
     * less, earn nothing here, and stay untaken. The flat taste ticket 40 killed
     * paid for those; this does not.
     *
     * ⚠️ **DELIBERATELY BLIND TO WHICH DOOR IT IS**, self or rival. Risk 2
     * asks which of the two a table takes when both cost one card out of one
     * slot, and that question only means anything if the instrument has no
     * preference between them. `visit` and `selfVisit` both stay at 0 above; the
     * whole difference the bots see is still the rules' - which door the board
     * grants, and whether the card shuts a board they need.
     *
     * ⚠️ **IT DOUBLE-COUNTS BY CONSTRUCTION AND THAT IS THE OPEN QUESTION.**
     * `outcome` already prices the door's goods; this pays the action premium on
     * top. The claim being tested is that a greedy one-ply rollout underprices
     * an action by about the value of an action, because it cannot see
     * compounding. The claim could be wrong, or 2.4 could simply be too much -
     * so the weight is a knob with a control arm at 0, which reproduces the
     * pre-03/09/2026 bots exactly. Sweep it before believing any hook number
     * that moves under it.
     */
    name: 'bonusAction',
    claims: ['visit'],
    // ⭐ UNCHANGED BY THE MEEPLE-LOOP ARM, ON PURPOSE. A visit still buys a
    // whole core action, whatever paid for it, so the premium still fires and
    // still only on a door that resolves something. It does NOT fire on Collect:
    // Collect buys a Draw 1, which is half an action by the same anchor Dean set
    // this weight with, and `bonusDraw` already pays exactly that half. Paying
    // an action premium on the arm's solitaire line would hand the bonus mix
    // back the answer it was built to measure.
    feature: (act, _s, move, o) =>
      act.a === 'visit' && isProbed(act) && o.value(move) > 0 ? 1 : 0,
  },
  {
    /**
     * ⭐ **THE ONLY BRAKE ON SELF-VISITING** - your own fee counts toward your
     * own threshold of 2, so the second card you feed your own board shuts your
     * own door, locks every neighbour out of your suit's action, and costs you a
     * whole Harvest action to reopen.
     *
     * The plan names this as the single structural check on risk 2, so a bot
     * that could not see it would over-self-visit and the arm would report a
     * hook failure the rules had actually guarded against. It fires only on the
     * card that FILLS the board, which is exactly when the door shuts: at
     * threshold 2, the first self-visit of a cycle really is free and the second
     * really is not.
     *
     * The weight is a PIN to `unclogBoard`: shutting your own door costs what
     * reopening it pays. No new constant, and the two move together.
     *
     * ⚠️ It fires on YOUR OWN BOARD ONLY, and the omission is deliberate.
     * Clogging a NEIGHBOUR's board denies them their own door, which is the
     * denial play v30's Helping Hand used to enable - but `outcome.ts`'s
     * standing rule is that this bot prices what it gains and never rival harm,
     * so the denial value of a visit is invisible here and always has been.
     * Whether that lands as clever or as the predecessor's "reverse
     * engine-building" resentment is a table question.
     */
    name: 'clogOwnBoard',
    claims: ['visit'],
    feature: (act, s) => {
      // ⛔ NO SUBJECT UNDER THE MEEPLE-LOOP ARM, AND THE GUARD IS EXPLICIT
      // RATHER THAN INCIDENTAL. Three separate things already make this dead
      // under the arm - there is no self-visit at all (X5, so `act.self` is
      // false by construction), no card is placed on a board, and the board is
      // not a building so `thresholdOfView` returns null and `fillsBuilding` is
      // false. Any ONE of them would be enough, which is exactly why the flag is
      // read here: a term whose zero depends on three coincidences is a term
      // that comes back to life the first time one of them is relaxed, and this
      // one is pinned to `unclogBoard` at 6, the largest cost in the table.
      if (s.meepleArm) return 0;
      if (act.a !== 'visit' || !act.self || s.noticeBoard === null) return 0;
      return fillsBuilding(s, s.noticeBoard.card) ? -1 : 0;
    },
    cost: true,
  },
  {
    // "Your junk is their treasure" made executable: of two identical visits,
    // take the one that pays with the card you least want. An ordering term and
    // nothing more - `handSpend` charges the card itself.
    name: 'visitFeeJunk',
    claims: ['visit'],
    // ⛔ NO FEE, NO ORDERING (the meeple-loop arm, R1). "Your junk is their
    // treasure" was a statement about a CARD changing hands and the arm stops
    // any card changing hands, so this term loses its subject outright rather
    // than changing rate. What replaces it as the ordering between two otherwise
    // equal visits is `meepleSpend`: of two doors worth the same, take the one
    // that costs the meeple you can least use. That is the same idea in the new
    // currency, and it needed no new term.
    feature: (act, s) => (act.a === 'visit' && act.fee !== null ? -cardValue(s.data, act.fee) : 0),
    cost: true,
  },
  {
    /**
     * The magpie's disposal lane, and it needs one: `visitFeeJunk` ranks a fee
     * by CARD VALUE, which is the right rank for everybody whose own crop is
     * worth something and the wrong one here. A magpie is dealt four own-crop
     * cards at setup and will never build one, so they are the only cards it can
     * spend at no cost at all - and without this term it pays its target crop
     * away instead, exactly the leak "your junk is their treasure" is about.
     *
     * 0 in every other profile: to a loyalist an own-crop card is the LAST thing
     * it wants to hand over, and this term must never quietly say otherwise.
     */
    name: 'visitFeeOwnCrop',
    claims: ['visit'],
    // ⛔ Null fee under the meeple-loop arm, so the magpie's disposal lane is
    // shut with the rest of the fee terms. ⚠️ THE MAGPIE IS THEREFORE A WEAKER
    // CONTROL UNDER THE ARM than it is under the shipped game: it can still
    // acquire a target crop and still refuses to build its own, but it has lost
    // the one move that let it dump own-crop cards for value. Read a magpie
    // number off the arm knowing that, or do not read one.
    feature: (act, s) => (act.a === 'visit' && act.fee !== null ? countOwnCrop(s, [act.fee]) : 0),
  },

  // --- positional, and the turn boundary ------------------------------------
  {
    /**
     * THE DELIVERABILITY TERM (the Vegetable rebuild, 2026-08-09), renamed from
     * `marketPayability` when v31 deleted the market that shared it.
     *
     * Its whole feature lives in `outcome.ts`'s `deliverabilityValue`, which is
     * why the entry here has none: V5 swaps two of the island's demand tokens
     * and V6 turns one face down, neither moves anything in the acting seat's
     * own zones, and both would price at exactly zero without a positional read
     * off the probe. This entry exists so the weight has a term to belong to and
     * `checkWeightTable` can see it.
     */
    name: 'deliverability',
    claims: ACTION_AND_TASK,
    feature: () => 0,
  },
  {
    /**
     * Standing moves offered by a built card.
     *
     * ⚠️ THE CATALOGUE HAS NO PRODUCER IN v31. A Helping Hand was the last one,
     * and its rewrite ("take both bonus options") needs no handler body at all,
     * so `handlerFor().moves` is currently unimplemented across all 105 cards.
     * The move type survives in the engine and so do these two terms: the next
     * card to print a standing move would otherwise be scored at 0 in silence,
     * which is the failure the claims test exists to prevent.
     */
    name: 'cardMove',
    claims: ['cardMove'],
    feature: (act) => (act.a === 'cardMove' ? 1 : 0),
  },
  {
    name: 'cardMoveSpend',
    claims: ['cardMove'],
    feature: (act, s) => {
      if (act.a !== 'cardMove') return 0;
      const spent = cardMoveSpend(act.payload);
      return spent === null ? 0 : -cardValue(s.data, spent);
    },
    cost: true,
  },
  {
    // Optional tasks: "you may". A negative weight means take the option.
    name: 'skip',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'skip' ? 1 : 0),
  },
  {
    /**
     * The card-task escape hatch, and since the Orchard rebuild it has a real
     * producer: the DIVERT seam answers `card` to put a limbo card into your own
     * barn instead of discarding it (O17 The Fruit Basket). Scored above `skip`
     * so the bot takes the barn card rather than binning it.
     */
    name: 'cardTask',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'cardTask' ? 1 : 0),
  },
  {
    // Only legal when no main action is, so the weight never picks between
    // moves - it just has to lose to any bonus-slot move that is still open.
    name: 'pass',
    claims: ['pass'],
    feature: (act) => (act.a === 'pass' ? 1 : 0),
  },
  {
    /**
     * Ending with the bonus slot unspent is the one thing a v31 bot should be
     * reluctant to do - but only reluctant, and the number is small on purpose.
     *
     * ⚠️ The plan asks the sim to tally SLOT UNSPENT as its own bucket, because
     * a rising unspent share is the start-of-turn restriction biting rather than
     * the visit being outcompeted. This -2 is the closest thing the bots have to
     * a thumb on that number, so it is left exactly where reference-v9 had it:
     * moving it in the same pass as the rule would confound the two readings.
     */
    name: 'endTurn',
    claims: ['endTurn'],
    feature: (act) => (act.a === 'endTurn' ? 1 : 0),
  },
];

export const TERM_NAMES: readonly string[] = TERMS.map((t) => t.name);
