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
 * unclog your own Notice Board > hire > visit > build > harvest > grow > draw >
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
  deliverClimb: 5,
  balloon: 2,

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
  sow: 1.5,
  sowCompletes: 2,

  build: 3,
  buildVp: 1.5,
  buildOwnCrop: 2,
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
  hire: 8,
  upgrade: 4,
  upgradeMilestone: 6,

  drawAction: 1.2,
  /**
   * The card buy (2026-08-03). `buy` + `buyDemand` peak at 3, which puts a
   * wanted crop just above a plain Draw's first card.
   *
   * `buySaving` at 6 is DERIVED, not chosen: a bot takes its highest-scoring
   * move and declining costs -2, so the saver only becomes a reachable decision
   * once `3 - buySaving < -2`. Measured on the ladder, and the difference is the
   * whole of watch-list assertion 3: at 4 the first hire lands on turn 8.0
   * (FAIL), at 6 on turn 3.0 (PASS) with 96.8% of seats hiring. Above 6 it
   * saturates - the term is binary and a negative buy already loses to
   * everything. A number below 6 measures the bot, not the rule.
   */
  buy: 2,
  buyDemand: 1,
  buySaving: 6,
  deckOwnCrop: 1,
  deckDemand: 0.8,
  keepValue: 2,
  keepOwnCrop: 1.5,
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
  loyalist: { buildOwnCrop: 6, deckOwnCrop: 4, keepOwnCrop: 4, upgradeMilestone: 10, upgrade: 6 },
  // Ticket 48: `deliverCost: -0.2` was a SMALLER REWARD for eating freight, not
  // the cheaper cost it reads as. Carried across as the same distance from the
  // reference it always had (0.3 below), which now says what it meant - a racer
  // discounts freight, because freight in the barn does not win the race.
  racer: { deliver: 6, deliverClimb: 10, barnSpend: 0.2, harvest: 2.5, drawAction: 0.8 },
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
