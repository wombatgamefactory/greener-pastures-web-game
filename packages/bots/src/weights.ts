/**
 * The weight tables. One reference table, four archetype overrides.
 *
 * Ticket 10's reason for archetypes over one heuristic: a card that only one
 * taste likes then reads as an archetype artefact rather than a card problem,
 * which is the difference between "cut this card" and "this card is for the
 * socialite". The balance runs seat mixed profiles by default for exactly that.
 *
 * These numbers are a starting position, not a tuned one - tuning cannot begin
 * before ticket 11 has win rates to tune against. They were set so that every
 * mechanism the v14 watch-list needs measured actually gets exercised: hiring,
 * the £2 upgrade sinks, renting a rival's Worker, and the optional tasks the
 * reference bot skips wholesale.
 */

import { TERM_NAMES } from './terms.js';

export type WeightTable = Readonly<Record<string, number>>;

/**
 * `balanced` - the reference table, and the `normal` rung of the ladder.
 *
 * Rough intended ordering at a typical decision: deliver a Level 2/3 tile >
 * unclog your own Notice Board > visit > build > harvest > grow > draw >
 * end the turn. Deliver's feature is the tile's printed VP (4 / 8 / 16), so its
 * weight of 3 puts a Level 1 delivery at 12 and a Level 3 at 48.
 */
export const BALANCED: WeightTable = {
  // Ticket 40's two additions. `outcome` is 1 because the probe already priced
  // its events through this same table, so the value arrives denominated; the
  // weight expresses only how far a profile trusts a rollout over a flat
  // preference. `coinGain` is the price of one SPENDABLE coin - coins above the
  // seat's runway are worth literally nothing and the feature returns 0 there.
  outcome: 1,
  coinGain: 1.5,
  /**
   * What one card leaving your hand costs you.
   *
   * Set ABOVE `coinGain` on the design's own authority: *"cards are the scarce
   * resource and the master clock"*, and *"every turn you convert 1 spare card
   * into either £1 or a second action"*. That prices a card at least at a coin;
   * calling it scarcer than a coin is what the design says in as many words.
   *
   * This is now the only term charging real money for a card. `visitFeeJunk`,
   * `growSpend`, `buildSpend` and `cardMoveSpend` drop to tie-breaker weights
   * that pick WHICH card goes, which is the job the junk rank was written for
   * and the only one it is good at.
   */
  handSpend: 2.5,
  /**
   * What one card leaving your BARN costs you, wherever it leaves for.
   *
   * Ticket 48. This was `deliverCost: -0.5` against a `-spendSize` feature, so
   * the product paid the bot 0.5 a card for delivering to the tile that ate MORE
   * freight - the third term in a row (after `growSpend` and `buildSpend`) whose
   * weight and feature were both negative. It absorbs ticket 47's `buildBarn`,
   * which was already charging 0.5 for the same thing on the other exit.
   *
   * Set BELOW `handSpend` deliberately. A barn card is not fuel: the barn is a
   * dead end, so its card can be delivered or (on D8 alone) built with, and can
   * never be played, paid or grown with. It is worth less in options than a card
   * in hand, and the design says so - *"the barn is a dead end (barn -> island
   * only)"*. Kept at ticket 47's number rather than re-derived, so the build leg
   * of the merge changes nothing and the delta is attributable to the delivery.
   */
  barnSpend: 0.5,

  deliver: 3,
  /**
   * **A balloon is worth its reward and nothing else** - the same sentence
   * ticket 40 applied to the visit, for the same measured reason (ticket 49).
   *
   * It was 2, and until this ticket that 2 was the WHOLE valuation of a balloon
   * move: all four balloons scored it, whether they granted Draw 4, £4, Sow 4 or
   * a discounted build. With the reward priced by probing it, the 2 became an
   * intrinsic taste sitting on top of a real payoff - and a taste we chose was
   * inflating the number watch-list assertion 12 exists to measure. Paired A/B
   * over 1510 games:
   *
   *     balloon moves per game    8.4   -> 5.5     (take rate 27.7% -> 18.0%)
   *     raids per game            16.26 -> 11.61
   *     assertion 1 steepest      £3.75 -> £2.00
   *     end coins by seat count   £8/£14/£15 -> £8/£11/£12
   *
   * Nothing else moved (deliver take rate 81.5% -> 81.7%, visits per turn 0.55,
   * verdict unchanged), so the 2 was buying balloon traffic and a coin flood and
   * paying for neither.
   *
   * Kept as a live knob rather than deleted, exactly as `visit: 0` is: a profile
   * that wants a taste for raiding the Aerodrome overrides it, and the pricer
   * never reads it, so a balloon inside a rollout and a balloon as a move are
   * valued the same way.
   */
  balloon: 0,

  harvest: 1.5,
  unclogBoard: 6,
  // `grow` is now the flat taste for activating at all; what the ability is
  // actually worth arrives through `outcome`. It stays non-zero so a profile
  // can still lean toward or away from the action itself.
  grow: 1,
  growCompletes: 3,
  /**
   * Ordering only now: pick the junkiest legal payment. `handSpend` charges the
   * card (by COUNT, not identity - `cardsLeavingHand` returns a flat 1 for a
   * grow - so this is the only term that reads which card pays).
   *
   * Ticket 45: this was **-0.3**, and negative weight times the negated feature
   * made it `+0.3 x cardValue` - the bot paid with the card it valued MOST,
   * against its own comment and against both correctly-signed siblings
   * (`visitFeeJunk` and `cardMoveSpend`, each `+0.3` on a `-value` feature).
   *
   * The argument FOR the old behaviour is refuted by the rules rather than by
   * taste: a GROW payment must match the building's activation suit, so every
   * legal payment for a given building is the same suit; a card in a stack
   * becomes barn freight on the next harvest; and `barnTally` reduces the barn
   * to a suit count, so freight is worth its suit and nothing else. All legal
   * payments therefore have identical downstream value and differ only in what
   * they were worth as cards. Pay the junk.
   */
  growSpend: 0.3,
  // A flat taste only - the value of an activation is what it fires, which
  // arrives through `outcome`. Deliberately below `sow`: a sow at least advances
  // a threshold, and this is picked for the payoff or not at all.
  activate: 1,
  sow: 1.5,
  sowCompletes: 2,

  build: 3,
  buildVp: 1.5,
  buildOwnCrop: 2,
  /**
   * The magpie's three terms, and the reason they are 0 here rather than absent:
   * `checkWeightTable` requires every term in every table, and a 0 keeps the
   * reference and the four archetype mirrors bit-identical to reference-v9. Only
   * `magpie` lifts them.
   */
  buildTargetCrop: 0,
  /**
   * Ordering only, like `growSpend` and `visitFeeJunk`, and at their weight.
   *
   * Ticket 47: this was **-0.2** against a `-(payment.length + coinWild)`
   * feature, which is not an ordering term at all. The engine holds
   * `payment.length + barn + coinWild === cardsNeeded`, so for one built card
   * that sum is a constant - measured over 262 real builds it separated the
   * alternatives twice, both times on D8's barn leg. So the bot had no opinion
   * about which cards paid for a build (23.7% of them had a real choice) and
   * took the evaluator's random tie-break, while the term's actual effect was
   * `+0.2 x cardsNeeded`: a standing preference for the DEARER build, which
   * `handSpend`'s 2.5 a card outweighs only while the seat is under its hand
   * limit. Over the limit, where `handSpend` exempts the excess, it was the only
   * term left and the bot preferred to spend more.
   */
  buildSpend: 0.3,
  /**
   * RE-PRICED 4 -> 5 on 19/08/2026, because the rule under it moved.
   *
   * The flip used to cost a whole MAIN ACTION, so 4 was priced against what a
   * main action is otherwise worth here - `build` 3, `harvest` 1.5, `grow` 1,
   * `drawAction` 1.2 a card of hand room - and it sat near break-even. What
   * that bought is on the record: the flip fell from 73-99% by round 6 to
   * 6-41% around round 17 when the Farmstead went on sale, and the table said
   * the same thing louder on 2026-07-14 - "nobody upgraded a starter and nobody
   * bought an end-game card", every GBP 2 sink untouched.
   *
   * It is now a BONUS-SLOT option, so its real price is the slot, and the slot
   * is worth roughly `workOwn` 5 or a `visitWorker` 2 plus its `coinGain`. A
   * term left at 4 would price the old cost against the new competition and
   * UNDER-take the move, which biases the very arm this change exists to be
   * read by. 5 says a starter flip is worth about what running your own Service
   * once is worth, which is legible and is the number the arm can argue with.
   *
   * ⚠️ THIS IS THE ARM'S MOST SENSITIVE NUMBER. The thing being measured is the
   * visit's share of bonus slots, and this weight competes directly for that
   * slot: too high and the instrument manufactures the displacement it is
   * looking for, too low and it hides it. Two things keep it honest. The option
   * is CAPPED at three flips a seat, so a high weight buys an opening-round
   * spike and then nothing, which the plan names as a PASS rather than a fail.
   * And `overlays/upgrade-main-action.overlay.json` puts the rule back under
   * the main action, so the arm can be read against a control where this weight
   * means what it used to.
   *
   * ⚠️ STILL FLAT, and the note below still stands: a bot is indifferent
   * between the three GBP 2 flips and takes them in tableau order, which is a
   * systematic artefact rather than noise, and the Farmstead is the flip that
   * doubles a suit power.
   */
  upgrade: 5,

  drawAction: 1.2,
  /**
   * The card buy (2026-08-03). `buy` + `buyDemand` peak at 3, which puts a
   * wanted crop just above a plain Draw's first card.
   *
   * `buySaving` at 6 is DERIVED, not chosen: a bot takes its highest-scoring
   * move and declining costs -2, so the saver only becomes a reachable decision
   * once `3 - buySaving < -2`. Measured on the ladder, and the difference is the
   * whole of what watch-list assertion 3 used to measure, when there was a hire
   * to save for: at 4 the first hire landed on turn 8.0, at 6 on turn 3.0. Above 6 it
   * saturates - the term is binary and a negative buy already loses to
   * everything. A number below 6 measures the bot, not the rule.
   */
  buy: 2,
  buyDemand: 1,
  buyTargetCrop: 0,
  buySaving: 6,
  /**
   * The market's three terms (ticket 56), live only while `rules.turn.marketCost`
   * is set - their features are all 0 otherwise, which is what keeps the
   * market-off arm bit-identical to reference-v8.
   *
   * `marketGain` is PINNED to `harvest`: one card arriving in a barn has one
   * price in this table, whichever gate it came through. If `harvest` moves,
   * move this with it. `marketPayability` converts a delivery unlocked by the
   * bought card into score - set between `sowCompletes` (2) and `deliverClimb`
   * (5), with the delete test run in ticket 56's report rather than argued.
   * `marketSaving` is `buySaving`'s twin at the same derived magnitude: it must
   * clear the -2 `endTurn` floor to decide anything.
   */
  marketGain: 1.5,
  marketPayability: 4,
  marketSaving: 6,
  deckOwnCrop: 1,
  deckTargetCrop: 0,
  deckDemand: 0.8,
  keepValue: 2,
  keepOwnCrop: 1.5,
  keepTargetCrop: 0,
  discardJunk: 2,

  /**
   * **A visit is worth its payoff and nothing else** (Dean, ticket 40).
   *
   * The flat 6 used to BE the visit's value, coin payoff included. `coinGain`
   * and `outcome` now price the payoff where the payoff is, and the first
   * measured build left 2 behind as an intrinsic taste for spending the free
   * bonus slot. That constant turned out to be doing real damage: at `visit: 2`
   * the bots take coin visits whose marginal coin they can be shown to value at
   * exactly zero in **70.4%** of cases - the slot is free, the fee is junk, so a
   * worthless visit still beat leaving the slot unused.
   *
   * Which made it the wrong number to leave in the instrument, because watch-list
   * assertion 8 counts visits per turn as the design's own "did players watch
   * each other" metric. A weight we chose was manufacturing the traffic that
   * metric measures, and ticket 35's rule applies: a report that will be believed
   * must not hand a made-up number the authority of a measurement.
   *
   * Measured at 0 against 2: visits/turn 0.443 -> 0.368, and the payoff split
   * moves coin 72.4% -> 63.7% (worker 25.7% -> 34.5%). Fewer visits, all of them
   * buying something.
   */
  visit: 0,
  visitWorker: 2,
  visitSpecial: 1.5,
  // "Your junk is their treasure" as a TIE-BREAK between otherwise equal visits.
  // It used to be the visit's whole cost, which is what let a worthless visit
  // beat ending the turn by 0.05.
  visitFeeJunk: 0.3,
  visitFeeOwnCrop: 0,
  workOwn: 5,
  workerTask: 3,

  cardMove: 2,
  cardMoveSpend: 0.3,
  skip: -1,
  cardTask: 1,
  pass: -50,
  endTurn: -2,
};

/**
 * The four archetypes, as partial overrides of the reference table.
 *
 * `hermit` is the control for watch-list assertion 8 ("did players watch each
 * other"): a hermit mirror SHOULD report solitaire, and a run where it does not
 * means the assertion has no teeth. Its visit weight is prohibitive rather than
 * literally 0, and ticket 40 made that MORE load-bearing, not less: the
 * reference's own `visit` is now 0, but `coinGain` and `outcome` price the
 * payoff, so a worker visit that does something real scores well above zero on
 * its own. Only the veto still makes "never" mean never.
 */
export const PROFILES: Readonly<Record<string, WeightTable>> = {
  balanced: {},
  hermit: { visit: -100, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0, cardMove: -100 },
  // Ticket 40 moved the visit's whole payoff out of the flat weight and into
  // `coinGain` / `outcome`, taking `balanced` from 6 to 0. `socialite` drops by
  // the same 6 rather than being re-set: preserving the DIFFERENCE from the
  // reference is what keeps an archetype recognisable across a retune, so a
  // socialite still likes visiting exactly 8 more than the reference does, as
  // it did before. It is now the only profile with an intrinsic taste for it -
  // which is precisely what "a socialite" was supposed to mean.
  socialite: { visit: 8, visitWorker: 5, visitSpecial: 4, workOwn: 2, cardMove: 5 },
  // Lost `upgradeMilestone: 10` with the free flip it chased (2026-08-12). The
  // profile keeps its raised `upgrade`, so a loyalist still buys the upgrade
  // layer sooner than the reference - it just has no reason to prefer one
  // starter over another any more.
  loyalist: { buildOwnCrop: 6, deckOwnCrop: 4, keepOwnCrop: 4, upgrade: 6 },
  // Ticket 48: `deliverCost: -0.2` was a SMALLER REWARD for eating freight, not
  // the cheaper cost it reads as. Carried across as the same distance from the
  // reference it always had (0.3 below), which now says what it meant - a racer
  // discounts freight, because freight in the barn does not win the race.
  // The flat island deleted `deliverClimb`, which was this profile's defining
  // taste. Nothing replaces it, because nothing needs to: the `deliver` feature
  // is now the receipt itself, 6 at a fresh tile against 3 at a half-taken one,
  // so a raised `deliver` weight IS a taste for getting there first. Untuned -
  // carried across at the number it already had.
  racer: { deliver: 6, barnSpend: 0.2, harvest: 2.5, drawAction: 0.8 },
  /**
   * `magpie` - the control for the SUIT, and the exact counterpart of `hermit`.
   *
   * A hermit answers "is the visit load-bearing, or is `visit` just a weight we
   * chose?" by refusing to visit at all. A magpie asks the same question of the
   * crop a seat was dealt: it **never builds its own suit** and chases the
   * strongest seated one instead (`magpie.ts` picks the mark). If it lands at or
   * above `loyalist`, the suit is decoration and the 82.8% own-crop build rate
   * on reference-v9 was ours, not the game's.
   *
   * `buildOwnCrop: -100` is hermit's veto idiom, not a taste: -100 beats
   * `endTurn`'s -2 by so much that an own-crop build is never the top move, so
   * "never" means never and the control has teeth. The rest are ordinary
   * preferences at loyalist magnitude, pointed at the target instead of the own
   * crop - deliberately the SAME numbers, so a magpie is a loyalist to somebody
   * else's colour and the comparison is about the crop rather than about how
   * hard each bot commits.
   *
   * ⚠️ Two rules make this strategy cheaper than it sounds, and both are why the
   * arm is worth running: the market may not buy your OWN suit, so a magpie's
   * £3 buys are aimed exactly where it wants them; and a Farmstead's suit power
   * modifies its owner's actions rather than their cards, so the magpie keeps
   * every bit of its dealt suit's power while building none of its cards.
   */
  magpie: {
    buildOwnCrop: -100,
    buildTargetCrop: 6,
    deckOwnCrop: -4,
    deckTargetCrop: 4,
    keepOwnCrop: -2,
    keepTargetCrop: 4,
    // Set above `buyDemand`'s 1 so the mark outranks the island's appetite when
    // the two disagree; a magpie that bought for the island would be a balanced
    // bot with a build ban.
    buyTargetCrop: 3,
    // Above `visitFeeJunk`'s 0.3, so "it is my own crop" outranks "it is cheap"
    // when the two disagree about which card to hand over.
    visitFeeOwnCrop: 2,
  },
};

export function weightsFor(profile: string): WeightTable {
  const override = PROFILES[profile];
  if (!override) throw new Error(`Unknown weight profile ${profile}`);
  return { ...BALANCED, ...override };
}

/**
 * Every weight names a real term and every term has a weight. Cheap, but it is
 * what stops a renamed term from silently scoring 0 in every profile.
 */
export function checkWeightTable(table: WeightTable): string[] {
  const problems: string[] = [];
  const known = new Set(TERM_NAMES);
  for (const name of Object.keys(table)) {
    if (!known.has(name)) problems.push(`weight for unknown term "${name}"`);
  }
  for (const name of TERM_NAMES) {
    if (!(name in table)) problems.push(`term "${name}" has no weight`);
  }
  return problems;
}
