/**
 * The weight tables. One reference table, five archetype overrides.
 *
 * Ticket 10's reason for archetypes over one heuristic: a card that only one
 * taste likes then reads as an archetype artefact rather than a card problem,
 * which is the difference between "cut this card" and "this card is for the
 * socialite". The balance runs seat mixed profiles by default for exactly that.
 *
 * ⭐ v31 (02/09/2026). The reference is being re-cut as **reference-v10** and
 * every historical number in `reports/` is incomparable, which is the one
 * chance this table gets to correct something without confounding a rules
 * change with a re-tune. Three numbers moved for reasons, and all three are
 * argued at their own entries rather than here:
 *
 *   - **`buildOwnCrop` 2 -> 0.** The rules pay for own-crop building again
 *     (the Farmstead's 1 VP a card), `farmsteadVp` prices exactly that, and
 *     leaving a taste on top would have the reference manufacturing risk 3's
 *     own-crop build share.
 *   - **`meepleGain` / `meepleSpend` arrive at 2.5**, pinned to each other.
 *   - **`selfVisit` arrives at 0**, matching `visit`, so risk 2 is measured and
 *     not chosen.
 *   - **`loyalist.buildOwnCrop` 6 -> 4**, which is arithmetic and not taste: the
 *     reference moved, so the archetype moves with it to keep its DISTANCE from
 *     the reference, exactly as `socialite` was re-pointed in ticket 40.
 *
 * Everything else is carried across at the number it already had. These are a
 * starting position, not a tuned one.
 */

import { TERM_NAMES } from './terms.js';

export type WeightTable = Readonly<Record<string, number>>;

/**
 * `balanced` - the reference table, and the `normal` rung of the ladder.
 *
 * Rough intended ordering at a typical decision: deliver a tile >
 * unclog your own Notice Board > build > harvest > spend a meeple > grow >
 * draw > end the turn. Deliver's feature is the receipt itself, flat since the
 * flat island (6 to the first delivery on a tile, 3 to the second), so its
 * weight of 3 puts a first delivery at 18 and a second at 9.
 */
export const BALANCED: WeightTable = {
  // Ticket 40's addition. `outcome` is 1 because the probe already priced its
  // events through this same table, so the value arrives denominated; the
  // weight expresses only how far a profile trusts a rollout over a flat
  // preference. In v31 it carries both halves of the bonus slot and the whole
  // meeple phase, so a profile that zeroes it goes blind to the pass.
  outcome: 1,
  /**
   * What one card leaving your hand costs you.
   *
   * Set on the design's own authority: *"cards are the scarce resource and the
   * master clock"*. In v30 that was an argument for pricing a card ABOVE a
   * coin; in v31 there is no coin, and a card is the only thing anything in the
   * game is bought with, so the claim is simply stronger and the number is
   * carried across unchanged.
   *
   * This is the only term charging real money for a card. `visitFeeJunk`,
   * `growSpend`, `buildSpend` and `cardMoveSpend` are tie-breaker weights that
   * pick WHICH card goes, which is the job the junk rank was written for and the
   * only one it is good at.
   */
  handSpend: 2.5,
  /**
   * What one card leaving your BARN costs you, wherever it leaves for.
   *
   * Set BELOW `handSpend` deliberately. A barn card is not fuel: the barn is a
   * dead end, so its card can be delivered or (on D8 alone) built with, and can
   * never be played, paid or grown with. It is worth less in options than a card
   * in hand, and the design says so - *"the barn is a dead end (barn -> island
   * only)"*.
   */
  barnSpend: 0.5,

  deliver: 3,
  /**
   * ⭐ **WHAT A MEEPLE IS WORTH**, and the single most consequential number in
   * this file for the v31 report.
   *
   * The feature is `meepleWorth`, which is 1 for a colour this seat could use
   * right now and 0.4 for one it could not, so 2.5 says **a meeple is worth
   * about one hand card** - which is exactly what it costs to buy the same door
   * action through a visit. That is the pin: the two routes to a door are a card
   * and a meeple, so the bot should be roughly indifferent between them, and any
   * daylight between the two should come from the rules rather than from here.
   *
   * It sits below a first delivery (18) by a factor of seven, so the meeple on a
   * tile can break a tie between tiles and can never decide whether to deliver.
   * That is the intended shape: the island is still a VP race.
   *
   * ⚠️ **THE HOARDING KNOB.** `meepleSpend` is pinned to this, so raising this
   * number makes meeples both more attractive to collect AND dearer to spend,
   * and the second effect is the one that shows up in the plan's dead-component
   * count. If the arm reports meeples piling up unspent, sweep this before
   * concluding anything about the rule - and sweep `MEEPLE_LATENT` in
   * `scratch.ts` immediately after.
   */
  meepleGain: 2.5,
  /**
   * PINNED to `meepleGain`. One price for a meeple, whichever direction it
   * travels, which is what makes the spend decision turn entirely on whether the
   * rolled-out door action beats holding it. If one moves, move both.
   */
  meepleSpend: 2.5,
  /**
   * **A balloon is worth its reward and nothing else** - the same sentence
   * ticket 40 applied to the visit, for the same measured reason (ticket 49).
   *
   * It was 2, and until this ticket that 2 was the WHOLE valuation of a balloon
   * move: all four balloons scored it, whether they granted Draw 4, GBP 4, Sow 4
   * or a discounted build. With the reward priced by probing it, the 2 became an
   * intrinsic taste sitting on top of a real payoff. Paired A/B over 1510 games:
   *
   *     balloon moves per game    8.4   -> 5.5     (take rate 27.7% -> 18.0%)
   *     raids per game            16.26 -> 11.61
   *
   * Nothing else moved (deliver take rate 81.5% -> 81.7%, visits per turn 0.55,
   * verdict unchanged), so the 2 was buying balloon traffic and paying for it
   * with a distorted instrument.
   *
   * Kept as a live knob rather than deleted, exactly as `visit: 0` is: a profile
   * that wants a taste for raiding the Aerodrome overrides it, and the pricer
   * never reads it, so a balloon inside a rollout and a balloon as a move are
   * valued the same way.
   */
  balloon: 0,

  harvest: 1.5,
  /**
   * Reopening your own door. ⚠️ `clogOwnBoard` is pinned to this and signed the
   * other way: shutting your own door costs exactly what reopening it pays. If
   * this moves, that moves.
   */
  unclogBoard: 6,
  // `grow` is the flat taste for activating at all; what the ability is
  // actually worth arrives through `outcome`. It stays non-zero so a profile
  // can still lean toward or away from the action itself.
  grow: 1,
  growCompletes: 3,
  /**
   * Ordering only: pick the junkiest legal payment. `handSpend` charges the
   * card (by COUNT, not identity), so this is the only term that reads which
   * card pays.
   *
   * Ticket 45: this was **-0.3**, and a negative weight times the negated
   * feature made it `+0.3 x cardValue` - the bot paid with the card it valued
   * MOST, against its own comment and against both correctly-signed siblings.
   * A GROW payment must match the building's activation suit, so every legal
   * payment for a given building is the same suit, and all of them are worth
   * the same downstream. Pay the junk.
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
  /**
   * PINNED to `buildVp`. The Farmstead's line is 1 VP for an own-crop card
   * built, which is the same currency as the VP printed on the card itself, so
   * it takes the same price. One VP, one weight, two doors.
   */
  farmsteadVp: 1.5,
  /**
   * ⭐ **WAS 2, NOW 0**, and this is a change to the instrument rather than a
   * tuning nudge - see the term's own comment in `terms.ts` for the argument.
   *
   * The short form: until v31 nothing in the rules paid a seat for building its
   * own crop (the Farmstead's free flip was retired on 2026-08-12) and this
   * weight was flagged at the time as "the bot preferring something the rules no
   * longer pay for". v31 pays for it again, and `farmsteadVp` above prices the
   * rule exactly. Leaving 2 here as well would have the reference bot chasing
   * its own crop twice over and then reporting the result as **risk 3's own-crop
   * build share** - a weight we chose manufacturing the number the assertion
   * reports, which is precisely what ticket 40 exists to have stopped.
   *
   * ⚠️ It is NOT deleted, and the two profiles that move it are the whole point:
   * `loyalist` raises it (a taste ABOVE what the rules pay - the upper bound on
   * risk 3) and `magpie` vetoes it at -100 (the control asking whether the suit
   * is load-bearing at all).
   */
  buildOwnCrop: 0,
  /**
   * The magpie's three terms, and the reason they are 0 here rather than absent:
   * `checkWeightTable` requires every term in every table, and a 0 keeps the
   * reference and the archetype mirrors free of them. Only `magpie` lifts them.
   */
  buildTargetCrop: 0,
  /**
   * Ordering only, like `growSpend` and `visitFeeJunk`, and at their weight.
   *
   * Ticket 47: this was **-0.2** against a `-(payment.length + coinWild)`
   * feature, which is not an ordering term at all - the engine holds
   * `payment.length + stacks === cardsNeeded`, so for one built card that sum is
   * a constant, and the term's actual effect was `+0.2 x cardsNeeded`: a
   * standing preference for the DEARER build.
   */
  buildSpend: 0.3,

  /**
   * The plain Draw, per card kept - so at `baseDraw` see 2 keep 2 a Draw scores
   * 2.4.
   *
   * ⚠️ The feature underneath it has now moved twice and the WEIGHT has not
   * moved at all, because "one card of draw is worth 1.2" is the reading it
   * always encoded. It was room left in hand floored at -1; v31 made it the flat
   * printed keep when the hand limit was deleted; 02/09/2026 made it
   * `min(keep, room)` with the floor restored when the limit came back. The
   * middle version is the one that failed: with no room to read, a draw could
   * never be a bad move, and the free bonus Draw 1 beat a neighbour visit 3:1.
   */
  drawAction: 1.2,
  /**
   * PINNED to `drawAction`: a card is a card whichever door it arrives through,
   * and the bonus slot's Draw 1 therefore scores 1.2 against the plain Draw's
   * 2.4. Nothing here expresses a taste for spending the bonus slot, on ticket
   * 40's finding that such a taste manufactures the traffic the hook assertion
   * counts.
   */
  bonusDraw: 1.2,
  deckOwnCrop: 1,
  deckTargetCrop: 0,
  deckDemand: 0.8,
  keepValue: 2,
  keepOwnCrop: 1.5,
  keepTargetCrop: 0,
  /**
   * Ordering only, at the same magnitude as the other junk ranks - it decides
   * WHICH cards the turn-boundary overflow throws away and never whether the
   * overflow is a good thing. Carried across unchanged from before v31, because
   * nothing about junk ordering moved when the limit went and came back.
   */
  discardJunk: 2,

  /**
   * ⭐ **BOTH DOORS OF THE BONUS SLOT AT ZERO, AND THAT IS RISK 2's WHOLE
   * INSTRUMENT.** A visit is worth its payoff and nothing else (ticket 40,
   * measured); a self-visit is worth its payoff and nothing else, for exactly
   * the same reason. Give either one an intrinsic taste and the arm reports the
   * taste. What separates them in the bots' eyes is entirely rules-derived:
   * which door the host's suit grants (`outcome`) and whether the fee shuts a
   * board you needed (`clogOwnBoard`).
   */
  visit: 0,
  selfVisit: 0,
  /**
   * ⭐ WHAT ONE WHOLE EXTRA ACTION IS WORTH (Dean, 03/09/2026), paid to a door
   * that actually resolves one. PINNED to `drawAction`: that term pays 1.2 a
   * card for a Draw 2, so one action is 2.4 and the free Draw 1 at `bonusDraw`
   * 1.2 is - in Dean's words - "only worth half an action".
   *
   * ⚠️ This is the ONE weight in the table that deliberately double-counts:
   * `outcome` prices what the door produces and this pays the action premium on
   * top, on the claim that a one-ply rollout cannot see an action compounding.
   * **0 is the control arm and reproduces the pre-03/09/2026 bots exactly.**
   * Never quote a hook or door-mix number that moved under this weight without
   * the 0 arm beside it.
   */
  bonusAction: 2.4,
  /**
   * PINNED to `unclogBoard`, signed the other way by its feature. Shutting your
   * own door costs what reopening it pays, which is the only structural brake
   * v31 puts on self-visiting.
   */
  clogOwnBoard: 6,
  // "Your junk is their treasure" as a TIE-BREAK between otherwise equal visits.
  // It used to be the visit's whole cost, which is what let a worthless visit
  // beat ending the turn by 0.05.
  visitFeeJunk: 0.3,
  visitFeeOwnCrop: 0,

  /**
   * A tile that flips from unpayable to payable, converted into score - V5's
   * and V6's whole worth. It was `marketPayability` until v31 deleted the market
   * that shared it. Set between `sowCompletes` (2) and a delivery, with the
   * delete test run in ticket 56's report rather than argued here.
   */
  deliverability: 4,

  cardMove: 2,
  cardMoveSpend: 0.3,
  skip: -1,
  cardTask: 1,
  pass: -50,
  endTurn: -2,
};

/**
 * The five archetypes, as partial overrides of the reference table.
 *
 * ⭐ v31 RE-POINTED EVERY ONE OF THEM, because several were defined in terms
 * that no longer exist - `upgrade`, `workOwn`, `visitWorker`, `visitSpecial`,
 * `buyTargetCrop` are all gone with the moves they scored. What each profile
 * MEANS is written at its own entry; the shared rule is that an archetype is a
 * TASTE laid over the reference, and a control is a veto (-100), and the two
 * are never mixed up.
 */
export const PROFILES: Readonly<Record<string, WeightTable>> = {
  balanced: {},
  /**
   * ⭐ `hermit` - **THE CONTROL FOR THE HOOK, AND v31 MADE IT SHARPER.**
   *
   * It used to mean "never spends the bonus slot on another player's farm",
   * which was the same thing as "never visits". v31 splits those: the bonus slot
   * now offers a SOLITAIRE door bought with the same card out of the same slot,
   * so a hermit that refused the slot entirely would be controlling for two
   * different things at once and `a08-the-hook` could not read it.
   *
   * So the veto is narrowed to exactly one thing: **it never visits a
   * NEIGHBOUR.** It self-visits as freely as any other bot - which is precisely
   * what a hermit would do, and which makes it the pure sample of risk 2's
   * solitaire branch. A run where a hermit mirror is not visibly more solitaire
   * than the reference means the assertion has no teeth.
   *
   * `visit: -100` is the veto idiom, not a taste: -100 beats `endTurn`'s -2 by
   * so much that a neighbour visit can never be the top move, so "never" means
   * never. `visitFeeJunk` and `visitFeeOwnCrop` go to 0 so nothing else can
   * accidentally rank one.
   *
   * ⛔ ITS `cardMove: -100` VETO IS GONE. That existed because the v30 Helping
   * Hand's standing move WAS a second visit to a neighbour; the v31 card is a
   * bonus-slot modifier that grants Draw 1 AND a placement, and a hermit would
   * happily take it and spend the placement on itself.
   */
  hermit: { visit: -100, visitFeeJunk: 0, visitFeeOwnCrop: 0 },
  /**
   * `socialite` - the only profile with an intrinsic taste for the cross-table
   * door, and now the only one that actively dislikes the solitaire one.
   *
   * Ticket 40 moved the visit's whole payoff out of the flat weight and into
   * `outcome`, taking `balanced` from 6 to 0; the socialite drops by the same 6
   * rather than being re-set, because preserving the DIFFERENCE from the
   * reference is what keeps an archetype recognisable across a retune. It still
   * likes visiting exactly 8 more than the reference does.
   *
   * ⭐ `selfVisit: -3` IS NEW AND IT IS THE HALF THAT MAKES IT MEAN ANYTHING IN
   * v31. Without it a socialite would be a bot that loves the bonus slot, not a
   * bot that loves its neighbours - and with self-visiting on the same slot,
   * those are no longer the same thing. -3 is a strong dislike rather than a
   * veto: this is a taste, and `hermit` is where the veto lives.
   */
  socialite: { visit: 8, selfVisit: -3 },
  /**
   * ⭐ `loyalist` - **THE NATURAL HOME OF THE FARMSTEAD'S OWN-SUIT PULL, AND
   * THE UPPER BOUND ON RISK 3.**
   *
   * v31 pays a seat 1 VP for every own-crop card it builds, and the 30 Power and
   * Endgame cards cost 2 cards of their own suit, so both rules push toward
   * monoculture - which the Innovation lens says is the one thing the metric
   * axis must not do. The reference bot now feels exactly what the rules pay
   * (`farmsteadVp`) and no more; this profile is the seat that leans into it
   * harder than the arithmetic justifies, so the pair of them bracket the
   * question: if the own-crop build share is high even at `buildOwnCrop: 0`, it
   * is the rules; if only the loyalist gets there, it is a taste.
   *
   * ⚠️ **`buildOwnCrop` IS 4, NOT THE 6 IT ALWAYS WAS**, and the change is
   * arithmetic rather than taste: the reference dropped from 2 to 0, so 6 would
   * have widened this archetype's deviation from +4 to +6 in the same edit that
   * moved the baseline. 4 preserves the DISTANCE from the reference, which is
   * the same rule `socialite` was re-pointed by, and keeping an archetype
   * recognisable across a re-mint is what that rule is for. Measured: at 6 a
   * 2-seat loyalist mirror built forever and ran to the move ceiling without
   * finishing, because the free bonus Draw feeds a taste that has nothing
   * competing with it. It lost `upgrade: 6` with the upgrade layer.
   */
  loyalist: { buildOwnCrop: 4, deckOwnCrop: 4, keepOwnCrop: 4 },
  /**
   * `racer` - gets to the island first and does not care what it costs.
   *
   * The flat island deleted `deliverClimb`, which was this profile's defining
   * taste, and nothing replaces it because nothing needs to: the `deliver`
   * feature is the receipt itself, 6 at a fresh tile against 3 at a half-taken
   * one, so a raised `deliver` weight IS a taste for getting there first.
   * `barnSpend` 0.3 below the reference says a racer discounts freight, because
   * freight in the barn does not win the race.
   *
   * ⭐ `meepleGain: 1.5` IS NEW. A racer delivers more than anybody, so it
   * collects more meeples than anybody, and leaving it at the reference would
   * have made it the profile most enthusiastic about the island's side payment
   * as well as its VP - two tastes in one archetype. Discounting the meeple
   * keeps it about the race. It is NOT matched on `meepleSpend`, deliberately:
   * a racer values a stored action less on the way in and burns it at the same
   * reserve price as everyone else, which makes it the profile most likely to
   * empty its supply. Untuned.
   */
  racer: { deliver: 6, barnSpend: 0.2, harvest: 2.5, drawAction: 0.8, meepleGain: 1.5 },
  /**
   * `magpie` - the control for the SUIT, and the exact counterpart of `hermit`.
   *
   * A hermit answers "is the cross-table visit load-bearing, or is it just a
   * weight we chose?" by refusing to take one. A magpie asks the same question
   * of the crop a seat was dealt: it **never builds its own suit** and chases the
   * strongest seated one instead (`magpie.ts` picks the mark). If it lands at or
   * above `loyalist`, the suit is decoration.
   *
   * ⚠️ **v31 MADE THIS BOT'S LIFE HARDER, WHICH IS WHY IT IS WORTH RUNNING.**
   * Two rules now punish it directly where v30 had none: the Farmstead pays 1 VP
   * per OWN-crop card built, which a magpie forfeits entirely, and the 30 Power
   * and Endgame cards cost 2 cards of the CARD's own suit, which a magpie has to
   * find in a deck it does not farm. Against that, one rule got easier: there is
   * no market to be barred from any more, and the base Draw takes the top of any
   * two decks in play, so its acquisition lane is unrestricted.
   *
   * `buildOwnCrop: -100` is hermit's veto idiom, not a taste. The rest are
   * ordinary preferences at loyalist magnitude, pointed at the target instead of
   * the own crop - deliberately the SAME numbers, so a magpie is a loyalist to
   * somebody else's colour and the comparison is about the crop rather than
   * about how hard each bot commits.
   *
   * ⛔ IT LOST `buyTargetCrop: 3` with the card buy. That was its best lane -
   * the one acquisition in the game that was foreign BY RULE - and its
   * replacement is nothing at all, so expect a weaker magpie than reference-v9's
   * and do not read the difference as a suit finding.
   */
  magpie: {
    buildOwnCrop: -100,
    buildTargetCrop: 6,
    deckOwnCrop: -4,
    deckTargetCrop: 4,
    keepOwnCrop: -2,
    keepTargetCrop: 4,
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
