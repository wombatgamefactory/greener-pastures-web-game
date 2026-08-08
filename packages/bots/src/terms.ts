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
 * behind `visitFeeJunk` / `discardJunk`. Everything else is ours: the reference
 * bot never hires, upgrades, visits or answers an optional task, and those are
 * precisely the mechanisms the watch-list has to measure.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveryVp } from '@gp/data';
import type { CardId, Move, MoveType } from '@gp/engine';

import type { Act } from './acts.js';
import { spendSize } from './acts.js';
import { cardValue, totalValue } from './junk.js';
import type { Outcomes } from './outcome.js';
import type { Scratch } from './scratch.js';
import { cardById, coinWorth, faceOfView, handSpendCost } from './scratch.js';

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
  return view ? faceOfView(s.data, view).threshold : null;
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

/**
 * The coins a visit would mint, from the host's showing Notice Board face.
 *
 * Special Orders' second line lives on the upgraded face only, so the three
 * payouts are exactly the three the card prints. Worker visits mint nothing to
 * the visitor - the wage goes to the host, from the bank - so they price at 0
 * here and are valued by the probe instead.
 */
function visitPayout(s: Scratch, act: Extract<Act, { a: 'visit' }>): number {
  const payout = s.data.rules.economy.visitPayout;
  if (act.payoff.mode === 'worker') return 0;
  if (act.payoff.mode === 'special') return payout.twoCard;
  const host = s.view.rivals.find((r) => r.seat === act.host);
  const board = host?.tableau.find((b) => cardById(s.data, b.card).slot === 'noticeboard');
  return board?.upgraded ? payout.upgraded : payout.base;
}

/** The card a standing move spends out of hand: the Helping Hand's fee, O1's gift. */
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
 * A Worker's action is likewise whatever that Worker does - renting a rival's
 * Draw Worker (Draw 3, keep 2) and their Sow Worker both scored a flat +2
 * before this. `cardMove` is the Helping Hand's repeat, which is worth exactly
 * what the repeated work is worth.
 *
 * A balloon move joined them in ticket 49. `grantBalloonReward` pushes a real
 * ability - Draw 4, Sow 4 from hand, a build at a discount, or £4 - and all four
 * scored the identical flat weight, which is precisely the shape ticket 40
 * deleted for GROW. Measured over 55 real games, the four price at 4.8 to 9.9
 * against a flat 2, so the weight was not merely imprecise: it was low almost
 * everywhere, and the balloon the bots took was not the balloon worth taking.
 *
 * Everything NOT in this set has a feature that already reads its own value -
 * a delivery's printed VP, a harvest's stack size, a visit's minted coin - so
 * probing it would spend an `apply` to learn what the table already knows.
 */
function isProbed(act: Act): boolean {
  switch (act.a) {
    case 'grow':
    case 'workOwn':
    case 'worker':
    case 'cardMove':
    case 'balloon':
      return true;
    case 'visit':
      return act.payoff.mode === 'worker';
    default:
      return false;
  }
}

/**
 * The acting seat's NET coin change, from the printed source.
 *
 * Spending is deliberately not run through here in general - a coin leaving for
 * a hire or an upgrade is already priced by the term that wanted the thing. D7's
 * coins-as-wilds are the exception (ticket 47), because there the coin is not
 * buying anything: it is standing in for a card, and the seat is choosing which
 * of the two to spend. That trade needs both sides in one currency, so it is
 * priced here rather than by a second weight that could drift from this one.
 */
/**
 * The receipt a delivery to this tile would take, read off how many seats have
 * already delivered there. 0 for a tile with no room, which never reaches here
 * because a full tile offers no move.
 */
function deliverVpOf(s: Scratch, tileId: string): number {
  const tile = s.view.island.tiles.find((t) => t.tile === tileId);
  return tile ? deliveryVp(s.data, tile.deliveredBy.length) : 0;
}

function coinsMinted(act: Act, s: Scratch): number {
  if (act.a === 'visit') return visitPayout(s, act);
  if (act.a === 'build') return -act.coinWild;
  if (act.a === 'deliver') return s.data.island.tileRule.coinsPerDelivery;
  // The market's fee (ticket 56), priced at the bot's ONE coin price like D7's
  // wilds: `coinWorth` signs a spend symmetrically, so a hoarder's £3 above the
  // runway costs nothing and a poor seat's £3 costs what it would have bought.
  if (act.a === 'market') return -(s.data.rules.turn.marketCost ?? 0);
  return 0;
}

/**
 * Cards this act takes out of the seat's BARN, by whichever exit (ticket 48).
 *
 * Three routes and one price. A tile's card cost is fixed by its crates
 * (`crates x cardsPerCrate`, ticket 14's 2 / 6 / 9) and a wild crate changes
 * which suit pays rather than how many, so this cannot order the spends for one
 * tile - measured over 391 real (decision, tile) pairs it never once varied
 * within a tile. What it prices is the resource leaving.
 */
function barnCardsSpent(act: Act): number {
  switch (act.a) {
    case 'deliver':
      return spendSize(act.spend);
    case 'build':
      return act.barn;
    default:
      return 0;
  }
}

/** Cards this act takes OUT of the seat's hand. The end-of-turn discard is forced, so it is not one. */
function cardsLeavingHand(act: Act): number {
  switch (act.a) {
    case 'build':
      return act.payment.length;
    case 'grow':
      return 1;
    case 'visit':
      return act.fee.length;
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
     * The other half of the exchange. `coinGain` priced what a visit GETS; this
     * prices what it PAYS, and until it existed the two constants deciding a
     * worthless visit were unrelated to each other. Measured at the moment the
     * seat's marginal coin is provably worth zero:
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
     * So the cost of a card leaving hand becomes its own term, uniform across
     * every way a card can leave, with the family terms left to do what they are
     * good at - choosing WHICH card. A card is fuel: it can be built, it can pay
     * a GROW and fire an ability, it can pay a visit later.
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
     * `-0.5` against a `-spendSize` feature, so the product paid the bot £0.5 a
     * card for delivering to the tile that ate MORE freight; `buildBarn` (ticket
     * 47) charged D8's barn leg properly but only there; and a balloon move's
     * two barn cards were charged nothing at all. One store, three exits, three
     * different answers.
     *
     * So the barn gets what the hand already has: one uniform charge in one
     * place, with the family terms left to order WHICH card goes. That is not a
     * tidy-up - it is what stops the NEXT exit route from arriving with a fourth
     * unrelated constant, which is exactly how the three-in-a-row happened.
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
     *     barn card at all and not one chosen move spent one, so this is a
     *     one-exit question rather than the three-exit one it looks like;
     *   - the balloon is the only exit with a real choice (51.0% of 4604 pairs
     *     pick which two suits burn), and there the demand binary is a coin flip
     *     against what actually matters. Where the choice changes how many island
     *     tiles the barn can still PAY for (13.5% of pairs), burning the fewest
     *     demanded cards keeps the most tiles payable **53.4%** of the time.
     *
     * The reason is ticket 38's: the barn's block is MATCHING under an
     * all-or-nothing payment, not quantity. Burning 1 of 3 wheat when a tile wants
     * 3 is fatal and burning 1 of 6 is free, and a binary "is wheat wanted" cannot
     * tell those apart. So a demand-scaled `barnSpend` would reorder 1.6% of
     * barn-exit decisions in a direction that is right about half the time, which
     * is the shape tickets 40 and 49 deleted weights for.
     *
     * **And it does not read PAYABILITY either, which is the feature 51 named as
     * the one that would work** (ticket 52). That feature is real - "would burning
     * these two cards cost me a delivery I could otherwise have made" separates
     * where demand cannot - but the prize is already collected by accident, and
     * the whole of it was measured before anything was written:
     *
     *   - nothing orders these spends today (the pricer collapses
     *     `balloon:${balloon}`, and this term does not claim `moveBalloon`), so
     *     the bot picks among them by random tie-break and the size of the prize
     *     is simply the REGRET that tie-break pays. Over 55 stratified games it
     *     is **9 tiles of payability across 215 moves, 0.16 a game** - and a tile
     *     that stops being payable is a delivery deferred, not one lost;
     *   - the mechanism is measured, not argued. The balloon is where the choice
     *     lives (51.0% of pairs) but a balloon needs two DIFFERING barn suits, so
     *     the bot takes one when its barn is fat - mean 7.1 cards at the chosen
     *     move against 5.6 at every offer - and a fat barn absorbs two cards
     *     without dropping a tile. Chosen balloon groups separate on payability
     *     **2.5%** of the time against 13.5% across all pairs;
     *   - it also corrects ticket 51's reading of the island exit. 51 called that
     *     exit immune because 0 of 1098 pairs separate on demand; on payability it
     *     separates in only 1.7% of pairs but **52.9% of the groups the bot
     *     actually delivers into** (the wild-crate assignment), and there it picks
     *     wrong 17.6% of the time. That is the sharpest case in the game and it is
     *     17 moves in 55 games, worth 4 tiles;
     *   - and at an ordering weight it does not do the job it was proposed for.
     *     At 0.3, its siblings' weight, it moves the argmax in 0.9% of barn-exit
     *     decisions - and **12 of those 19 change which TARGET is taken** rather
     *     than how it is paid for, which is the reward's job, not a tie-break's.
     *
     * So the barn keeps one uniform count charge and no ordering sibling, and the
     * reason is now the opposite of 51's: the demand feature was uninformative,
     * the payability feature is informative and there is nothing left for it to
     * win. Both channels' ceilings are below the noise floor a paired A/B could
     * resolve (0.16 tiles and 0.35 decisions a game), which is why one was not run.
     */
    name: 'barnSpend',
    claims: ['deliver', 'build', ...ACTION_AND_TASK],
    feature: (act) => -barnCardsSpent(act),
    cost: true,
  },
  {
    /**
     * What coins are worth to THIS seat right now: the part of a gain that
     * lands under its remaining runway of things to buy (ticket 40).
     *
     * The blind spot this closes was the widest one in the table. Nothing read
     * a seat's coin balance at all, so `visit` scored a flat 6 at £0 and at
     * £65 - and ticket 37 measured 73.3% of visits taking the coin payoff,
     * 50.9% of those by a seat already holding £10 or more, with 65.4% of every
     * coin minted never spent on anything. Since the pity went, a coin above
     * the runway buys nothing, so paying a card for one is strictly dominated.
     *
     * One coin price for the whole bot: the probe pricer values a `coins` event
     * through this same weight, so a wage a card mints and a wage the island
     * pays are worth the same thing - and so does the one place a coin is spent
     * INSTEAD of a card rather than to buy something (D7's wilds, ticket 47).
     */
    name: 'coinGain',
    claims: ['visit', 'deliver', 'build', 'market', ...ACTION_AND_TASK],
    feature: (act, s) => coinWorth(s, coinsMinted(act, s)),
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
     */
    name: 'outcome',
    claims: ['grow', 'visit', 'workOwnWorker', 'cardMove', 'moveBalloon', ...ACTION_AND_TASK],
    feature: (act, _s, move, o) => (isProbed(act) ? o.value(move) : 0),
  },

  // --- the island -----------------------------------------------------------
  {
    // DL-78. The one rule that makes a game terminate, so it carries the
    // biggest feature in the table: the VP this delivery would actually take.
    //
    // Since the flat island (2026-08-09) that is no longer a property of the
    // tile but of its fill order - 6 for arriving first, 3 for second - so this
    // one feature now carries the whole race that `deliverClimb` and the
    // fill-order bonus used to carry between them. It is why the bot prefers a
    // fresh tile to a half-taken one without any term saying so.
    name: 'deliver',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'deliver' ? deliverVpOf(s, act.tile) : 0),
  },
  {
    /**
     * The freight branch: a Deliver action that moves a balloon instead. Pays
     * 2 differing barn cards and is never an island delivery.
     *
     * The flat taste for taking one at all, and nothing more - ticket 49 moved
     * what the move is WORTH into the probe (its printed reward) and what it
     * COSTS into the pricer (its two barn cards), so this is now the exact twin
     * of `grow`: a preference about the action, with the outcome priced where
     * the outcome is. Its default weight is 0; see `weights.ts`.
     */
    name: 'balloon',
    claims: ['moveBalloon', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'balloon' ? 1 : 0),
  },

  // --- the barn supply line -------------------------------------------------
  {
    name: 'harvest',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'harvest' ? stackOf(s, act.building) : 0),
  },
  {
    // The reference's second rule: a clogged Notice Board shuts off the
    // table's coin faucet, so unclogging your own is worth more than the cards.
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
    feature: (act, s) => (act.a === 'grow' ? -cardValue(s.data, act.payment) : 0),
    cost: true,
  },
  {
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
    feature: (act, s) => (act.a === 'build' ? (cardById(s.data, act.card).printedVp ?? 0) : 0),
  },
  {
    // The Farmstead free-flip is the whole own-suit incentive, so a profile's
    // loyalty lives in this one weight.
    name: 'buildOwnCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' && suitOf(s.data, act.card) === s.mySuit ? 1 : 0),
  },
  {
    /**
     * Which cards pay for a build - the junk ordering the build never had
     * (ticket 47).
     *
     * This used to read `-(payment.length + coinWild)`, which cannot order a
     * build's payments at all: the engine holds
     * `payment.length + barn + coinWild === cardsNeeded`, so for one built card
     * that sum is a CONSTANT. Measured over 262 real builds it varied across the
     * alternatives 2 times, both of them D8's barn leg - so 23.7% of builds had a
     * real choice of which cards to burn and the term was blind to every one of
     * them, leaving the pick to the evaluator's random tie-break.
     *
     * So it becomes what its siblings already are - `visitFeeJunk`, `growSpend`,
     * `cardMoveSpend`, all `+0.3` on a `-value` feature - and the build's SIZE
     * stays charged where it always really was, by `handSpend` at 2.5 a card.
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
  {
    name: 'upgrade',
    claims: ['upgrade'],
    feature: (act) => (act.a === 'upgrade' ? 1 : 0),
  },
  {
    // Ticket 29's change with teeth: an upgraded starter prints its crop icon,
    // so a £2 flip can also be the third own-colour building that flips the
    // Farmstead free. The £2 sinks went unused in the 2026-07-14 playtest;
    // this is the term that decides whether a bot finds the double duty.
    name: 'upgradeMilestone',
    claims: ['upgrade'],
    feature: (act, s) =>
      act.a === 'upgrade' && !s.farmsteadUpgraded && s.ownCropBuildings + 1 >= s.flipAt ? 1 : 0,
  },

  // --- the hand -------------------------------------------------------------
  {
    // Scaled by room in hand: drawing into an end-of-turn discard is a wasted
    // action, and the base Draw only nets +1 card a turn.
    name: 'drawAction',
    claims: ['draw'],
    feature: (act, s) => (act.a === 'draw' ? s.handRoom : 0),
  },
  {
    /**
     * The card BUY (2026-08-03): £1, blind, off a deck that is not your own.
     *
     * Scaled by hand room for the same reason `drawAction` is - a card bought
     * into an end-of-turn discard is a coin thrown away - and by nothing else,
     * because the buy is blind. What suit it is is the only thing knowable in
     * advance, which is what `buyDemand` prices.
     */
    name: 'buy',
    claims: ['buy'],
    feature: (act, s) => (act.a === 'buy' && s.handRoom > 0 ? 1 : 0),
  },
  {
    // The one thing a blind buy DOES let you choose: which crop. An open tile
    // wants suits you cannot grow yourself, which is the whole reason the rule
    // points at a deck that is not your own.
    //
    // The only term separating one buy from another, and it earns its place -
    // just. Deleting it outright moves the argmax in 1.1% of the 7558 decisions
    // offering a buy (ticket 53). Its level gate is measured on `demandSuits`.
    name: 'buyDemand',
    claims: ['buy'],
    feature: (act, s) => (act.a === 'buy' && s.demandSuits.has(act.suit) ? 1 : 0),
  },
  {
    /**
     * The only saving instinct the bot has.
     *
     * The term table prices moves, not plans, so a seat on £1 with a £2 upgrade
     * in front of it will otherwise buy a card every single turn and never
     * flip it - an instrument artefact that would be read as a rule effect.
     *
     * The question is "would this leave me short of the cheapest thing I still
     * want", which is what a person at the table asks. It stops firing the
     * moment there is nothing left to save for, which is exactly when spare
     * coins should be turning into cards.
     *
     * Its weight has to clear the `endTurn` floor to do anything: a bot takes
     * the highest-scoring move, and declining costs -2, so a term that only
     * pulls the buy down to zero still buys. That is where the magnitude comes
     * from - the architecture, not a preference.
     */
    name: 'buySaving',
    claims: ['buy'],
    feature: (act, s) => {
      if (act.a !== 'buy' || s.sinkGap === null) return 0;
      return s.coins - (s.data.rules.turn.buyCost ?? 0) < s.sinkGap ? -1 : 0;
    },
    cost: true,
  },
  {
    /**
     * BUY AT MARKET's barn card (ticket 56): one card arriving in the barn,
     * priced at what this table already pays a card arriving in a barn - the
     * `harvest` rate, exactly as the probe pricer's `deckToBarn` case would
     * price the same event. It is a feature-of-1 deliberately NOT probed:
     * the probe would spend an apply to return this constant, which is the
     * shape the `outcome` term's own header warns against. The weight is
     * PINNED to `harvest` in `weights.ts` rather than free, so there is one
     * price for a barn arrival, not two that can drift.
     */
    name: 'marketGain',
    claims: ['market'],
    feature: (act) => (act.a === 'market' ? 1 : 0),
  },
  {
    /**
     * The market's ordering feature, and the whole reason a seat below its
     * runway ever takes one: the deliveries this card unlocks. Ticket 38
     * measured the barn's block as MATCHING (89% of blocked deliveries can
     * afford no open tile, 93% of near-misses short by 1-2 cards), and tickets
     * 51/52 established payability - not demand - as the feature that tracks
     * it. This is the acquisition side of that finding: +1 card of a chosen
     * suit, counted in tiles that flip from unpayable to payable.
     *
     * The weight converts an unlocked delivery into score. It cannot be
     * derived the way `marketGain`'s pin can, so it is set between
     * `sowCompletes` (2) and `deliverClimb` (5) and the delete test is run in
     * ticket 56's report rather than asserted here.
     */
    name: 'marketPayability',
    claims: ['market'],
    feature: (act, s) => (act.a === 'market' ? (s.marketPayability?.get(act.suit) ?? 0) : 0),
  },
  {
    /**
     * `buySaving`'s twin for the £3 sink (ticket 56): would this market buy
     * leave me short of the cheapest bounded thing I still want? `sinkGap`
     * deliberately excludes the market itself (a repeating sink in the gap
     * would suppress the market to save for the market), so this guards the
     * upgrades and the Power cards, nothing else. Same derived weight as `buySaving`:
     * it has to clear the `endTurn` floor to decide anything.
     */
    name: 'marketSaving',
    claims: ['market'],
    feature: (act, s) => {
      if (act.a !== 'market' || s.sinkGap === null) return 0;
      return s.coins - (s.data.rules.turn.marketCost ?? 0) < s.sinkGap ? -1 : 0;
    },
    cost: true,
  },
  {
    name: 'deckOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && act.suit === s.mySuit ? 1 : 0),
  },
  {
    /**
     * **Measured dead** (ticket 53), and left in place pending
     * [54](../../../.scratch/web-game/issues/54-draw-always-own-suit.md).
     *
     * Deleting it outright changes the bot's top move in **0 of 4650** decisions
     * offering a deck pick, over 55 stratified games. It is 0.8 against
     * `deckOwnCrop`'s 1.0 and a seat's own deck is in play whenever the seat is,
     * so the own deck wins outright: taken on 83.9% of deck picks, with the own
     * deck on offer in exactly 83.9% - it is taken every single time it is
     * available. In the remaining 16.1% every deck still on offer is demanded,
     * so the term is uniform there too and cannot order those either.
     *
     * Not deleted here, because the finding is not "this weight is wrong" but
     * "the Draw never varies", which is a question about the instrument's whole
     * acquisition lane and about whether a seat should ever draw a rival's crop.
     * That is ticket 54, and a weight change made ahead of it would mint a
     * reference for a number nobody has decided yet.
     */
    name: 'deckDemand',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && s.demandSuits.has(act.suit) ? 1 : 0),
  },
  {
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
    // The junk rank, negated: the least valuable discard scores highest.
    name: 'discardJunk',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'discard' ? -totalValue(s.data, act.cards) : 0),
    cost: true,
  },

  // --- the bonus slot -------------------------------------------------------
  {
    name: 'visit',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' ? 1 : 0),
  },
  {
    name: 'visitWorker',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' && act.payoff.mode === 'worker' ? 1 : 0),
  },
  {
    name: 'visitSpecial',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' && act.payoff.mode === 'special' ? 1 : 0),
  },
  {
    // "Your junk is their treasure" made executable: of two identical visits,
    // take the one that pays with the card you least want.
    name: 'visitFeeJunk',
    claims: ['visit'],
    feature: (act, s) => (act.a === 'visit' ? -totalValue(s.data, act.fee) : 0),
    cost: true,
  },
  {
    name: 'workOwn',
    claims: ['workOwnWorker'],
    feature: (act) => (act.a === 'workOwn' ? 1 : 0),
  },
  {
    // Answering a chooseWorker task: doing the work beats declining it. The
    // skip answer, where one is offered, is scored by `skip`.
    name: 'workerTask',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'worker' ? 1 : 0),
  },

  // --- standing moves and the turn boundary ---------------------------------
  {
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
    // The card-task escape hatch. No card in the 105 uses it, so this exists to
    // keep the coverage honest if one ever does - and to score it last.
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
    // Ending with the bonus slot unspent is the one thing a v14 bot must not
    // do: the free visit is where the money is minted.
    name: 'endTurn',
    claims: ['endTurn'],
    feature: (act) => (act.a === 'endTurn' ? 1 : 0),
  },
];

export const TERM_NAMES: readonly string[] = TERMS.map((t) => t.name);
