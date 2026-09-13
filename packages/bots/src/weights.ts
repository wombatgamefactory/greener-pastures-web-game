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
 *
 * ## ⭐ THE MEEPLE-LOOP ARM (04/09/2026): NOT ONE NUMBER IN THIS FILE MOVES
 *
 * `rules.turn.visitCurrency: 'meeple'` re-cuts the bonus slot, and the pricing
 * pass that followed it changed only what five terms READ. That is a decision,
 * not an omission. The arm is a paired experiment against the shipped game on
 * identical seeds, and a weight moved in the same pass would make every delta a
 * mixture of the rule and the instrument - which is the failure `bonusAction`'s
 * own entry already warns about ("never quote a hook or door-mix number that
 * moved under this weight without the 0 arm beside it").
 *
 * What the arm does is REDISTRIBUTE the load across weights that already exist:
 *
 *   - `handSpend` 2.5 stops paying for a visit; `meepleGain` / `meepleSpend` 2.5
 *     start paying for it, at the number they were already pinned to. That is
 *     the pin doing exactly what its entry says it was set for - *"the two
 *     routes to a door are a card and a meeple, so the bot should be roughly
 *     indifferent between them"* - so the visit costs the same 2.5 under both
 *     currencies and the bonus slot's arithmetic survives the change.
 *   - `bonusDraw` 1.2 becomes Collect's draw, and `meepleGain` pays the rest of
 *     a Collect.
 *   - `clogOwnBoard` 6 and `visitFeeJunk` 0.3 lose their subjects entirely.
 *
 * ⚠️ **`meepleGain` AND `MEEPLE_LATENT` NOW CARRY FAR MORE THAN THEY WERE SET
 * FOR, AND NEITHER WAS SET BY MEASUREMENT.** Under v31 they priced one faucet
 * (the island) and one drain (the turn-start spend). Under the arm they price
 * the visit, the Collect, the cap and the island at once - they are most of the
 * bonus slot. They are still the hoarding dial, they are still a guess (see
 * `MEEPLE_LATENT`'s own entry, "the least defensible number in this file"), and
 * they are still deliberately unchanged. **Sweep them before drawing any
 * mechanism conclusion from an arm result, and sweep them together.**
 *
 * ## ⭐ HANDOFF v2 (04/09/2026 evening): AGAIN NOT ONE NUMBER IN THIS FILE MOVES
 *
 * R15 (`rules.turn.meepleAsCard`) makes a meeple a CARD of its colour, so it can
 * pay a build, a Grow and an island crate; the amended R6
 * (`rules.turn.slotToll`) prices an occupied slot in burned meeples instead of
 * refusing it. Both are paired arms against the shipped loop, both default OFF,
 * and the discipline is the one the section above set: a weight moved in the
 * same pass would make every delta a mixture of the rule and the instrument.
 *
 * `meepleSpend` 2.5 absorbs all three new exits at the price it already carried
 * - a meeple paid into a build, a meeple paid into a crate, a meeple burned as a
 * toll - on the standing rule that a meeple costs one thing whichever door it
 * leaves by. **What moved instead is a FEATURE, in `scratch.ts`:**
 * `meepleWorth`'s floor rises from `MEEPLE_LATENT` 0.4 to
 * `MEEPLE_AS_CARD_FLOOR` 1 under R15, because a meeple whose door is dead is
 * still a card and a card never goes dead. A meeple therefore prices flat at one
 * card under R15, which is exactly what R15 says it is.
 *
 * ⭐ **THE VISIT'S PRICE IS DELIBERATELY UNCHANGED BETWEEN THE ARMS**, and that
 * is this pass's one real judgement call. A plain visit always spends a meeple
 * whose door is LEGAL, so lifting the live-door worth would tax every visit in
 * the arm and none in the control - the exact mixture of rule and instrument the
 * paragraph above forbids. `MEEPLE_AS_CARD_DOOR_PREMIUM` therefore ships at 0,
 * and the argued alternative (0.6, the daylight v1 had between a live door and a
 * dead one) is one edit away. ⚠️ **It moves the arm's headline hook number by
 * 2.8x on a 12-game smoke sample** - 45 visits against 125 - so sweep it beside
 * `meepleGain` before quoting a hook figure off the R15 arm. Neither constant is
 * overlay-addressable, so sweeping either is an edit and a rebuild.
 *
 * ## ⭐ THE COINS (10/09/2026): TWO NEW WEIGHTS, AND NOTHING ELSE
 *
 * `docs/commons-coins-handoff-2026-09-10-v2.md`, K7-K15, measured under the
 * since-deleted commons. This is the first of
 * these passes where the discipline could NOT be "not one number moves", because
 * the arm puts a currency back in the game and a currency with no price is a
 * currency the bots mint and then abandon - which is precisely what ticket 37
 * measured of the v31 coin (65.4% of every coin minted never spent on
 * anything). So two weights arrive, `coinWorth` and `coinSpend`, pinned to each
 * other and MEASURED at their own entries.
 *
 * ⭐ **THEY SHIPPED AT 3.5 ON AN ARGUMENT AND WERE RE-CUT TO 1.2 ON A
 * MEASUREMENT THE SAME DAY**, which is the one thing to read before quoting
 * either. The argument was the design's own (K12: a Farmstead power is "worth
 * about two plain actions"); the measurement priced all five powers through the
 * rollout in 6,771 real positions and found the claim false - the power returns
 * about ZERO net over the action it displaces, not +2.4. **The gap is a finding
 * about the DESIGN and not about this table**, it is written out per suit at
 * `coinWorth`, and it is the first thing the measurement session should put in
 * front of Dean.
 *
 * ⛔ **EVERY OTHER NUMBER IS UNCHANGED, AND BOTH NEW ONES MULTIPLY A
 * STRUCTURAL ZERO WHEN NO COIN KNOB IS ON.** Nothing can mint or spend a coin
 * otherwise, so the v31 card visit and the meeple economy price exactly as they
 * did on 09/09/2026 - which the fixtures in @gp/sim assert byte for byte.
 *
 * ⚠️ **NO PROFILE OVERRIDES EITHER, DELIBERATELY.** The arm's own headline
 * readings were the Farmstead-against-Endgame spend split, and both are the shape of result a manufactured taste flips on its own.
 * A taste for hoarding coins belongs in a profile the day somebody wants to
 * bracket that reading the way `hermit` and `socialite` bracket the play rate;
 * until then the reference measures the rule.
 *
 * ## ⭐ THE NOTICE-BOARD VISIT (11/09/2026): ONE NEW WEIGHT, MEASURED, AND
 * TWO OLD ONES THAT LOSE THEIR SUBJECT
 *
 * `docs/notice-board-visit-handoff-2026-09-10-v2.md`, S1-S16. The five Notice
 * Boards come home as buildings, the bonus is a card onto ANY player's board -
 * your own included - for that board's printed power, and the card rests on the
 * host's board until the host harvests it. **This is the first design in the
 * project where a move pays somebody else**, so the discipline could not be
 * "not one number moves" any more than the coins pass could:
 *
 *   - **`hostGift` arrives at 1.5**, MEASURED over 32,478 rival placements and
 *     1,200 complete games, with the sweep of its own consequences at its entry.
 *     It is the ledger's C64, which has bitten three designs running, and it is
 *     the only reason a bot can now decline a visit because of who it feeds.
 *   - **`clogOwnBoard` 6 and `unclogBoard` 6 lose their subject under S8's `3+`
 *     rule and are guarded off in `terms.ts`, not zeroed here.** A board that
 *     never blocks has no door to shut and none to reopen. Both numbers stay
 *     where they are because the v31 control and the `-blocking-v1` sub-arm
 *     still need them, and a weight zeroed "for the arm" is a weight somebody
 *     has to put back by hand before the control can be re-run.
 *
 * ⛔ **AND `selfVisit`'s 0 IS LOAD-BEARING FOR THE FIRST TIME SINCE
 * 03/09/2026.** S6 rules self-use back in, so the term has a subject again and
 * the zero asserts that the bot is INDIFFERENT between its own board and a
 * rival's, deciding purely on which power it wants. The self-visit share is the
 * pass's headline risk; the argument for the zero, and the two readings that
 * would overturn it, are at the term's entry in `terms.ts`.
 *
 * ⚠️ **NOTHING ELSE MOVES, AND ALL THREE CONTROLS ARE UNTOUCHED.** `hostGift`
 * is structurally zero outside `visitCurrency: 'noticeBoardPower'` - including
 * under the v31 `'card'` game, where it has a genuine subject and is shut
 * anyway, because that control is what this arm's self-visit share is read
 * against.
 *
 * ## ⛔ S17, THE HOST DRAW (11/09/2026) - ONE NUMBER MOVES AND IT IS THE ONE
 * THAT HAD TO
 *
 * `rules.turn.hostDrawOnVisit`, Dean, from a TABLE rather than from a run:
 * **when a neighbour visits you, you draw a card.** It amends S7, which said
 * the fee resting on the host's board was the payment "and there is no other".
 * There is now one other and it is paid instantly, so a visit hands a rival
 * strictly more than it did yesterday.
 *
 *   - **`hostGift` 1.5 -> 2.7**, MEASURED over 15,288 rival placements and
 *     14,893 host draws across 450 complete games, with both legs, the band,
 *     the correction to the obvious sum and the consequence sweep at its own
 *     entry. It is `harvest` 1.5 plus `drawAction` 1.2: the two zones the two
 *     halves of the payment land in, each at the price this table already pays
 *     for a card arriving there.
 *   - ⛔ **AND IT IS KNOB-SENSITIVE, WHICH IS NEW FOR THIS TERM.** The weight is
 *     the whole S17 payment and the feature scales it back to the fee half when
 *     `hostDrawOnVisit` is 0, so **the paired control charges 1.5 exactly as it
 *     did** and the two overlays still differ in one leaf. The two halves are
 *     `HOST_GIFT_FEE` and `HOST_GIFT_DRAW` in `terms.ts` and this number must
 *     stay their sum.
 *
 * ⚠️ **NOTHING ELSE MOVES**, and two things that a reader will expect to have
 * moved deliberately did not: `outcome.ts` still prices a card reaching a
 * RIVAL's hand at zero (`hostGift` is the one place C64 is charged, and pricing
 * it twice would break the `hostGift: 0` control), and the charge does not
 * scale with the host's room in hand even though the host had none on 32.5% of
 * visits - because that bound is the simulator's and not the game's (C7).
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
   *
   * ⭐ **UNDER THE MEEPLE-LOOP ARM IT IS ALSO WHAT A COLLECT PAYS**, per meeple
   * that survives the one-per-colour cap - so this one number now sets how hard
   * a bot works to get its own board swept, which is the host side of the
   * design and the half v31 had nothing at all for. Unchanged at 2.5 on purpose:
   * see the file header. **It is the first number to sweep on any arm result
   * about the bonus mix, the hold-out rate or the supply held in the last
   * third**, because all three read off it.
   */
  meepleGain: 2.5,
  /**
   * PINNED to `meepleGain`. One price for a meeple, whichever direction it
   * travels, which is what makes the spend decision turn entirely on whether the
   * rolled-out door action beats holding it. If one moves, move both.
   *
   * ⭐ **UNDER THE MEEPLE-LOOP ARM IT IS THE PRICE OF A VISIT** - one meeple, or
   * two for a wild spend - which is the whole of what replaced `handSpend` 2.5
   * on that move. The two are equal, so a visit costs the same under either
   * currency and the arm's hook number is not a repricing artefact. A wild
   * therefore costs twice a plain visit, which is the only thing separating them
   * in the bots' eyes and is what makes the wild-share metric mean something.
   */
  meepleSpend: 2.5,
  /**
   * ⭐ **WHAT A COIN IS WORTH UNDER THE K7-K15 COIN ARM, AND
   * SINCE 10/09/2026 IT IS A MEASURED NUMBER RATHER THAN AN ARGUED ONE.**
   *
   * ⛔ **IT IS NOT THE v31 COIN EVALUATOR COMING BACK.** That machinery
   * (`coinWorth`, `coinRunway`, `sinkGap`, `coinNeverDead`, `marketPayability`)
   * priced a DIFFERENT CURRENCY IN A DIFFERENT GAME - a continuous, fungible
   * bank balance with a market, a card buy, a starter upgrade and a wage behind
   * it - and its numbers are void here. `scratch.ts`'s header keeps the reading
   * that outlived the rule; nothing else survives. This coin had exactly one
   * mint (clearing a central pile, K8, deleted with the commons) and two sinks
   * (the Farmstead's suit power and the fifteen Endgame cards, K7), and it scores nothing, breaks
   * no ties and buys no ordinary card.
   *
   * ## WHAT THE DESIGN CLAIMED, WHICH IS KEPT HERE SO THE GAP STAYS VISIBLE
   *
   * K12 (Dean, 10/09/2026) prices a Farmstead power at **"about two plain
   * actions"**, because it costs the ACTION as well as the coin. In this table
   * one whole action is `bonusAction` 2.4, so the claim is that a firing returns
   * about 4.8 gross and therefore about **+2.4 NET** over the action it
   * displaces - and the coin, buying exactly that difference, would be worth
   * about 3.5 once `handSpend` 2.5 and the `meepleGain`/`meepleSpend` precedent
   * are read beside it. **This weight shipped at 3.5 on that argument on
   * 10/09/2026 and the argument is wrong.**
   *
   * ## ⭐ WHAT THE ROLLOUT PRICER ACTUALLY MEASURES (10/09/2026)
   *
   * **6,771 positions in which the coin-activated Farmstead was legal**, over 45
   * games at 2, 3 and 4 seats under the since-deleted commons-coins arm,
   * with all five suits rotated through every seat count so no power is measured
   * only in the company of the same neighbours. Every candidate main action in
   * the SAME position was priced through the same rollout pricer, each on its
   * own fresh probe budget so nothing was truncated. ⚠️ **Taken with `coinSpend`
   * temporarily at 0**, because at 3.5 the bot will not fire the power often
   * enough to observe it.
   *
   *     (c) NET, power minus the best plain main action it displaces
   *         all suits pooled      mean -2.91   median -2.16   p10 -6.28   p90 0.00
   *         live fires only       mean about -1.6 by suit (see the table below)
   *     (c') NET against a plain DRAW 2, the action `bonusAction` 2.4 is anchored on
   *         wheat -0.52   vegetable -1.26   orchard +0.43   apiary -1.21   dairy -0.25
   *
   * **The design's +2.4 is not there. The measured net is about ZERO at best and
   * negative on the median**, and the only positions where a coin buys anything
   * at all are the top decile: the p90 of the live net, averaged over the five
   * suits, is **+1.32**. That is the whole of what a coin can be spent for.
   *
   * ## ⛔ AND THE REASON IS THE FIVE POWERS THEMSELVES, WHICH IS A DESIGN
   * FINDING AND NOT A WEIGHT ONE
   *
   * `live` is a position where the power prices above zero; the rest are DEAD
   * FIRES, positions where the Farmstead was offered and could do nothing.
   * "actions" reads the gross value against `bonusAction` 2.4, the anchor for
   * one whole plain action, so K12's target is **about 2.0 actions**:
   *
   *     suit        live    gross when live      actions   against K12's "two"
   *     wheat       18.9%   mean 4.48  med 3.66   1.9      ON TARGET, but dead 4 times in 5
   *     vegetable    5.2%   mean 10.09 med 15.00  4.2      4x OVER, and dead 19 times in 20
   *     orchard     63.2%   mean 2.65  med 3.25   1.1      HALF, and capped by the instrument
   *     apiary      44.1%   mean 1.99  med 1.50   0.8      A THIRD
   *     dairy       41.5%   mean 4.55  med 4.87   1.9      ON TARGET
   *
   * **Not one of the five hits "about two plain actions" as an EXPECTED value**
   * (unconditional means: dairy 1.88, orchard 1.67, apiary 0.88, wheat 0.85,
   * vegetable 0.52, against a target of 4.8), and when they do fire the spread
   * is FIVEFOLD, Vegetable 10.09 against Apiary 1.99.
   *
   * ⛔ **THE DOMINANT FAULT IS THE DEAD FIRE, AND IT IS THE STANDING DOOR RULING
   * NOT BEING APPLIED.** K5 says a central board whose action you cannot perform
   * is not offered; the Farmstead is offered whenever you hold a coin and have
   * not fired it this turn, whatever it can do. So Wheat harvests nothing when
   * nothing is full and Vegetable delivers nothing from an empty barn, and four
   * of the five powers are dead most of the time.
   *
   * ⚠️ **ORCHARD'S NUMBER IS THE INSTRUMENT'S AND NOT THE TABLE'S.** Its gross
   * is hard-capped at 3.25 because Draw 3 is capped by room in hand, and the
   * hand bound of 7 is the SIMULATOR'S BOUND rather than a rule of the game
   * (C7). At a real table with no hand limit the Orchard power is worth more
   * than this measures, and it is the only one of the five that bound touches.
   *
   * ## SO THE NUMBER IS 1.2, AND IT IS A PIN RATHER THAN A FIT
   *
   * The measured band is 0 to about 1.3, and rather than ship a fitted decimal
   * this takes `drawAction`'s **1.2** - "one card of draw" - which sits inside
   * the band and states the measurement in the table's own currency: **firing
   * the Farmstead is worth about the same as a plain Draw 2 and no more**, which
   * is exactly what (c') says (the median net against a Draw is 0.00 on wheat
   * and on orchard). ⚠️ It is a SOFT pin: no test asserts the two are equal, so
   * they can move apart - but if `drawAction` ever moves, re-read this.
   *
   * ⚠️ **A SWEEP OF THIS NUMBER IS AN EDIT AND A REBUILD, NOT AN OVERLAY.**
   * `weightsFor` takes a profile id and nothing else, so the weight table is not
   * overlay-addressable (the ledger's C45), and a run that wants a different
   * coin price has to change this line. Say so in any write-up that quotes a
   * coin number.
   *
   * ⛔ **STRUCTURALLY ZERO WHEN NO COIN KNOB IS ON.** Nothing mints or spends a
   * coin otherwise, so this weight multiplies a zero in the shipped game and
   * under both controls. That is what lets a nonzero weight land without moving
   * one fixture.
   *
   * ## ⛔ AND SINCE 12/09/2026 IT PRICES A SECOND, DIFFERENT COIN. 1.2 IS A
   * FLOOR THERE AND NOT A MEASUREMENT.
   *
   * **The Village Store's coin (V1 to V12, A150) is NOT the coin measured
   * above**, and every number in that measurement is about a currency this one
   * only shares a name with. Read the difference before quoting anything:
   *
   *                         K7 / K10 (measured)      V1 / V6 / V8 (this arm)
   *     mint                clear a central pile     a spare BARN card at a delivery
   *     sink 1              the Farmstead's power    any part of a BUILD cost
   *     sink 2              an Endgame card          a GROW that places nothing
   *     what a coin buys    a whole ACTION           one RESOURCE inside an action
   *                         you were not taking      you were taking anyway
   *
   * ⛔ **SO THE 6,771-POSITION MEASUREMENT DOES NOT TRANSFER, AND THE
   * HANDOFF SAYS SO IN AS MANY WORDS: "a coin is now worth MORE than it was,
   * because it pays a suit requirement."** The measured coin bought the NET of a
   * Farmstead power over the plain action it displaced, and four of the five
   * powers were dead most of the time - which is where the band of 0 to 1.3 came
   * from. **This coin cannot be dead in the same way.** V6 lets it pay any or all
   * of a build cost INCLUDING the n-of-suit half, so one coin displaces one card
   * of a payment the seat was making regardless, and a hand card is `handSpend`
   * **2.5** in this same table. V8 does the same to a Grow's activation card.
   *
   * ⛔ **1.2 IS THEREFORE CARRIED FORWARD AS A FLOOR, DELIBERATELY, AND THE
   * ARM UNDERSTATES THE STORE BECAUSE OF IT.** It was not re-measured on
   * 12/09/2026: the method above is a bespoke pass over thousands of positions
   * with `coinSpend` held at 0, no harness for it survives in the tree, and this
   * project's rule is that a weight is measured or declared rather than argued
   * into place. **The arithmetic above says the true value is nearer `handSpend`
   * 2.5 than 1.2, but that is an ARGUMENT and 2.4 to 3.5 is exactly the kind of
   * argued number the measurement above was run to refute.** So the floor ships
   * and the gap is written down.
   *
   * ⭐ **THE ERROR IS ONE-DIRECTIONAL AND ITS DIRECTION IS SAFE FOR THIS
   * PASS, WHICH IS THE WHOLE REASON THE FLOOR IS TOLERABLE.** `coinSpend` is
   * pinned to this, so an under-priced coin is one the bot SPENDS eagerly (1.2
   * charged against a 2.5 hand card saved) and MINTS less eagerly. Both sinks
   * therefore fire, and the failure this slice exists to prevent - an arm whose
   * new rule is never used, reading exactly like its control - cannot happen
   * because of this number.
   *
   * ⚠️ **WHAT IT DOES BIAS, AND WHAT MAY NOT BE QUOTED OFF IT:**
   *
   *   - **the conversion rate and C113.** A cheap coin is minted less often, so
   *     the Store's "does every player convert every spare card every time"
   *     reading is a FLOOR on conversion, not an estimate of it. If the arm
   *     shows heavy conversion at 1.2, C113's answer is safe; if it shows light
   *     conversion, re-measure before concluding anything.
   *   - **the build / grow sink split**, for the same reason the K7 arm's split was a
   *     reading of this table rather than of K15's appeal.
   *   - **the empty-supply share**, which moves with how eagerly coins are minted.
   *
   * ⚠️ **A SWEEP OF THIS NUMBER IS STILL AN EDIT AND A REBUILD** (C45):
   * `weightsFor` takes a profile id and nothing else, so the weight table is not
   * overlay-addressable and a run at a different coin price is a code change.
   * That is why a re-measurement is a session of its own and not a knob on an
   * arm, and it is the first thing to do if Dean wants the Store's numbers
   * tightened.
   */
  coinWorth: 1.2,
  /**
   * PINNED to `coinWorth`, on exactly the arrangement `meepleSpend` has with
   * `meepleGain`: one price for a coin whichever direction it travels, so the
   * bot's books balance and the decision to spend turns entirely on whether the
   * thing bought beats holding the coin. **If one moves, move both**, and
   * `roster.test.ts` asserts it.
   *
   * ## ⭐ WHAT EACH PRICE DOES, SWEPT ON IDENTICAL SEEDS (10/09/2026)
   *
   * 30 games, 2/3/4 seats, all five suits rotated, this pair of weights the ONLY
   * thing moved. Reported as the CONSEQUENCE of the number above rather than as
   * the reason for it - the number comes from (c), not from this table.
   *
   *     price   Farmstead fires   DEAD fires   coins spent   fires by suit (w/v/o/a/d)
   *             a game            of those     of minted
   *     0       43.67             66.3%        52.5%         11.3 / 7.3 / 7.4 / 7.5 / 10.2
   *     1.2      5.60              7.1%         6.9%          1.7 / 0.3 / 1.9 / 0.3 /  1.4
   *     2        3.23              1.0%         4.3%          1.7 / 0.0 / 0.3 / 0.2 /  1.1
   *     3.5      1.33              0.0%         1.9%          1.0 / 0.0 / 0.0 / 0.1 /  0.3
   *
   * ⛔ **AT 3.5 ONLY WHEAT EVER FIRES, SO "FARMSTEAD FIRES BY SUIT" - the
   * imbalance reading Dean raised by name - COULD NOT BE READ AT ALL.** At 1.2
   * every one of the five fires at least sometimes, which is the precondition
   * for that reading to mean anything, and the DEAD-fire share collapses from
   * 66.3% at a free coin to 7.1%: the bot stops firing a power that does nothing
   * and starts waiting for a position where it does. ⚠️ **0 IS NOT A CANDIDATE
   * PRICE**, and the dead-fire column is why: a free coin has the bot firing an
   * empty Harvest two turns in three.
   *
   * ⚠️ The spend share is still only 6.9% of coins minted, which is a finding
   * about the RULES rather than about this weight - 27 coins a player a game are
   * minted and there is almost nothing to spend them on.
   */
  coinSpend: 1.2,
  /**
   * ⛔ **THE VILLAGE STORE'S ONE ORDERING TERM (V1/V2, A150, 12/09/2026): DO
   * NOT CONVERT THE SECOND HALF OF A CRATE.** Charged when the barn card being
   * exchanged is one a currently payable tile needs, so that a bot converts what
   * is STRANDED and keeps what is spendable.
   *
   * ⛔ **IT IS A THRESHOLD, NOT AN ESTIMATE, AND THE BAND IS ARITHMETIC
   * RATHER THAN A MEASUREMENT.** The mint's standing net is `coinWorth` 1.2
   * minus `barnSpend` 0.5 = **+0.7**, against `skip` at **-1.0**, so the whole
   * job of this number is to push a stranding conversion below the skip:
   * **anything above 1.7 closes the option and anything below it does nothing at
   * all.** 3 is the smallest round number in the closed half that is not sitting
   * on the switch, and it is a number this table already uses twice for "one
   * whole structural step" (`build` 3, `growCompletes` 3):
   *
   *     conversion that strands nothing   +0.7   taken   (skip -1.0)
   *     conversion that costs a tile      -2.3   refused
   *
   * ⚠️ **PINNED TO NOTHING AND MEASURED BY NOTHING, SO SAY SO IN ANY WRITE-UP
   * THAT QUOTES A CONVERSION RATE.** A payable tile is not a delivery lost - the
   * barn refills - so 3 is not what a tile is worth. What it buys is that the
   * bot's conversion rate is a reading about SPARE cards rather than about all
   * cards, which is what C113 asks for.
   *
   * ⛔ **IF `coinWorth` MOVES, RE-READ THIS.** The switch sits at
   * `coinWorth - barnSpend - skip`, so a re-measured coin raises the floor of the
   * band; at a coin of 2.5 (the value `coinWorth`'s own note argues this coin is
   * really nearer) the floor would be 3.0 and this number would be ON the switch
   * rather than inside it.
   *
   * ⛔ **STRUCTURALLY ZERO WHEN THE STORE IS OFF.** Only `finishDelivery`
   * pushes a `mint` task and only under `rules.economy.storeCoinsPerCard > 0`,
   * so this multiplies a zero in the shipped game and under all three controls,
   * which is what lets a new weight land without moving one of the nine
   * fixtures.
   */
  mintStrands: 3,
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
  // ⛔ INERT UNDER THE MEEPLE-LOOP ARM: there is no self-visit (X5), no card is
  // placed on a board, and the board is not a building - so the term guards
  // itself off and this 6 buys nothing. Left at 6 because the control still
  // needs it and because a weight zeroed "for the arm" is a weight that has to
  // be put back by hand before the control can be re-run.
  clogOwnBoard: 6,
  // "Your junk is their treasure" as a TIE-BREAK between otherwise equal visits.
  // It used to be the visit's whole cost, which is what let a worthless visit
  // beat ending the turn by 0.05. ⛔ Also inert under the meeple-loop arm, where
  // no card is spent on a visit; `meepleSpend` becomes the tie-break instead.
  visitFeeJunk: 0.3,
  visitFeeOwnCrop: 0,
  /**
   * ⛔ **WHAT A CARD HANDED TO A HOST IS WORTH TO THAT HOST (the ledger's
   * C64, S7 of the notice-board visit), AND IT IS A MEASURED NUMBER RATHER
   * THAN AN ARGUED ONE (11/09/2026).** The handoff asked for it in those words
   * - *"set it by measurement rather than by argument, as `coinWorth` was on
   * 10/09/2026: price the host's eventual harvest through the rollout and
   * report the sample size"* - and the method below is that one, re-pointed.
   *
   * The subject: under `visitCurrency: 'noticeBoardPower'` the card you pay for
   * a visit rests on the HOST's Notice Board until the host harvests it into
   * their barn, and that is the host's entire payment. Nothing in this pricer
   * has ever known that a move pays somebody else.
   *
   * ## ⭐ WHAT THE ROLLOUT ACTUALLY MEASURES (11/09/2026)
   *
   * **32,478 rival placements and 19,678 Notice Board harvests, over 1,200
   * complete games at 2, 3 and 4 seats** under
   * `overlays/notice-board-visit-v1.overlay.json`, the five suits rotated
   * through every seat count so no board is measured only in the company of the
   * same neighbours, the five `BALANCE_PROFILES` seated from the game seed.
   * ⚠️ **Taken with this weight at 0**, for the reason `coinWorth` was taken
   * with `coinSpend` at 0: a charge on the thing being counted changes how often
   * it happens. Every game ended; none crashed.
   *
   * The card's whole journey, each leg counted off the event stream:
   *
   *     P(the fee reaches the host's barn)          0.836
   *     P(a barn card is spent on a delivery)       0.893
   *     what a delivered barn card pays             3.115  (deliver 3 x 5.01 VP / 4.82 cards)
   *
   *     (a) TERMINAL   0.836 x 0.893 x 3.115  =  2.32   what the card is finally turned into
   *     (b) TABLE PRICE 0.836 x harvest 1.5   =  1.25   what this table pays for a card
   *                                                     arriving in a barn
   *
   * ## SO THE NUMBER IS 1.5, AND IT IS A PIN RATHER THAN A FIT
   *
   * The measured band is **1.25 to 2.32**, and rather than ship a fitted decimal
   * this takes `harvest`'s own **1.5** - "one card into a barn" - which lies
   * between the two ends and states the result in the table's own currency:
   * **a card you hand a host is worth to them exactly what this table already
   * pays them for a card arriving in their barn.**
   *
   * ⛔ **WHY NOT THE TERMINAL 2.32, WHICH IS THE LARGER AND ARGUABLY TRUER
   * NUMBER: INTERNAL CONSISTENCY.** This table has never priced a barn card at
   * its terminal value anywhere else - it pays `harvest` 1.5 on the way in and
   * charges `barnSpend` 0.5 on the way out - so pricing the GIFT at 2.32 would
   * assert that a card is worth more in a rival's barn than in your own. The
   * gap between (a) and (b) is not noise about this term; it is the standing gap
   * between what this table pays for material and what material is finally worth,
   * and closing it is a repricing of `harvest` and `barnSpend` rather than of
   * this line.
   *
   * ⚠️ **IT IS A SOFT PIN.** No test asserts the two are equal, and they must
   * not be hard-pinned: `racer` already overrides `harvest` to 2.5, and a racer
   * has no reason to think a card is worth more to a RIVAL than a balanced bot
   * does. If `harvest` ever moves in the reference table, re-read this.
   *
   * ## ⭐ WHAT EACH PRICE DOES, SWEPT ON IDENTICAL SEEDS (11/09/2026)
   *
   * 600 games, 200 per seat count at 2/3/4, this weight the ONLY thing moved.
   * Reported as the CONSEQUENCE of the number above rather than as the reason
   * for it.
   *
   *     price   placements   SELF-VISIT SHARE          realisation
   *             per turn     all      2p     3p     4p  of rival fees
   *     0        0.882       37.4%   49.5%  38.3%  29.8%   83.6%
   *     1.2      0.868       42.5%   54.7%  43.7%  34.9%   84.3%
   *     1.5      0.839       45.3%   59.3%  45.8%  37.3%   84.7%
   *     2.3      0.824       48.7%   62.5%  50.4%  40.1%   84.2%
   *     3.5      0.785       52.8%   66.4%  54.4%  44.3%   85.0%
   *
   * ⛔ **READ THAT TABLE BEFORE QUOTING THE PASS'S HEADLINE. THIS WEIGHT MOVES
   * THE SELF-VISIT SHARE BY 15 POINTS ACROSS THE PLAUSIBLE RANGE, AND THE
   * SELF-VISIT SHARE IS THE HEADLINE RISK OF THE WHOLE DESIGN** (§2.4, §5
   * reading 2 of the handoff). The direction is the term doing its job - a
   * charge for feeding a rival makes your own board relatively cheaper - but the
   * SIZE of the number is this table's opinion and not the rules'. **`hostGift:
   * 0` is its control arm and it reproduces the blind bot exactly**; run it
   * beside the arm before anybody rules on the self-visit share, exactly as
   * `bonusAction: 0` is the control for the action premium.
   *
   * ⭐ **ONE CHECK THE SWEEP PASSES, AND IT IS THE ONE THAT MATTERS FOR THE
   * MEASUREMENT'S HONESTY**: the realisation rate is FLAT at 83.6% to 85.0%
   * across every price. The quantity being priced does not move when the price
   * moves, so (a) and (b) are not self-fulfilling and the band above is stable.
   *
   * ⚠️ **A SWEEP OF THIS NUMBER IS AN EDIT AND A REBUILD, NOT AN OVERLAY.**
   * `weightsFor` takes a profile id and nothing else (the ledger's C45).
   *
   * ⛔ **STRUCTURALLY ZERO WHEN THE ARM IS OFF**, and deliberately so even
   * under the v31 `'card'` control, which HAS a host and HAS the same subject.
   * See the term's own entry in `terms.ts`: a control that moves is not a
   * control, and 22.2% is the only prior self-visit number this project owns.
   *
   * ⭐ **UNCHANGED BY DEAN'S TWO-BOARD FIX, AND CHECKED RATHER THAN
   * ASSUMED** (11/09/2026). At two seats the one rival now holds TWO Notice
   * Boards, and the charge is the same on either of them because **it is the
   * same rival either way**: the fee rests on whichever board it was played to
   * until that host harvests it into their barn, and both boards are that
   * host's store. So the term neither DOUBLES because a rival holds two boards
   * nor HALVES because the traffic splits across them - it reads `act.host` and
   * that host's standing, and nothing about the board.
   * `notice-board-two-boards.test.ts` asserts both directions, and reads the
   * arm's number against the one-board control's to catch the halving that an
   * "equal on both boards" check alone would miss.
   *
   * ## ⛔ S17, THE HOST DRAW (Dean, 11/09/2026): 1.5 BECOMES 2.7, MEASURED
   *
   * `rules.turn.hostDrawOnVisit` amends S7: **when a neighbour visits you, you
   * draw a card, immediately, off a deck**, on top of the fee card that rests
   * on your board until you harvest it. So a visit hands a rival strictly more
   * than the 1.5 above priced, and the reasoning that set the 1.5 - "a card
   * handed to a host is worth what this table pays for a card arriving in their
   * barn" - is not wrong, it is INCOMPLETE. It now has a second half.
   *
   * ⛔ **THE WEIGHT IS THE WHOLE PAYMENT AND THE TERM SCALES IT BACK TO THE FEE
   * HALF WHEN THE RULE IS OFF.** `HOST_GIFT_FEE` (1.5) and `HOST_GIFT_DRAW`
   * (1.2) are the two halves, in `terms.ts`, and **this number must stay their
   * sum** - `notice-board-host-draw.test.ts` asserts it. The control
   * (`overlays/notice-board-visit-two-boards-v1.overlay.json`, the same design
   * with `hostDrawOnVisit` 0) therefore still charges 1.5 and its readings do
   * not move, which is the whole reason a knob-blind 2.7 was refused: **a
   * control that moves is not a control**, and this pair differ in exactly one
   * leaf.
   *
   * ## ⭐ WHAT THE ROLLOUT MEASURES (11/09/2026), SAME METHOD, RE-POINTED
   *
   * **15,288 rival placements and 14,893 host draws over 450 complete games**
   * at 2, 3 and 4 seats under the host-draw arm, the five suits rotated through
   * every seat count, 446 of 450 games ended and none crashed. ⚠️ **Taken with
   * this weight at 0**, for the reason the 1.5 was: a charge on the thing being
   * counted changes how often it happens.
   *
   * The card's whole journey, both legs, each counted off the event stream:
   *
   *     P(the fee reaches the host's barn)          0.887
   *     P(a barn card is spent on a delivery)       0.784
   *     what a delivered barn card pays             2.99   (deliver 3 x 1.00 VP a card)
   *     P(the host has ROOM for the drawn card)     0.675
   *     P(a host-drawn card is ever used)           0.545  (33.6% discarded, 11.9% stranded)
   *
   *     THE FEE HALF (S7, unchanged in kind)
   *     (a) TERMINAL   0.887 x 0.784 x 2.99   =  2.08
   *     (b) TABLE PRICE 0.887 x harvest 1.5   =  1.33
   *
   *     THE DRAW HALF (S17)
   *     (a) TERMINAL   0.545 x handSpend 2.5  =  1.36   what one card out of a hand buys
   *     (b) TABLE PRICE 0.675 x keepValue 2
   *                         x meanCardValue   =  0.73   (0.5411, so 1.08 a card undiscounted)
   *
   *     TOTAL          (b) 2.06          (a) 3.44
   *
   * ## SO THE NUMBER IS 2.7, AND IT IS A PIN RATHER THAN A FIT
   *
   * The measured band is **2.06 to 3.44**, and rather than ship a fitted
   * decimal this takes **`harvest` 1.5 plus `drawAction` 1.2**, which lies
   * between the two ends and states the result in the table's own currency:
   * **a card you hand a host is worth to them what this table already pays them
   * for a card arriving in their barn, PLUS what it pays for one card of draw.**
   * That is the same construction the 1.5 used - the undiscounted price of the
   * zone the card lands in - with one zone added, which is the amendment S17
   * makes to S7 written as arithmetic.
   *
   * ⛔ **AND IT CORRECTS THE OBVIOUS SUM, WHICH BRACKETED 2.7 TO 3.5 AND WAS
   * HALF WRONG.** The obvious sum reads `keepValue` as 2 and adds it to 1.5 for
   * 3.5. `keepValue` never stands alone: `cardsToHand` prices a card at
   * `keepValue x meanCardValue`, and **`meanCardValue` is 0.5411 on this
   * catalogue**, so a card arriving in a hand is worth **1.08** to this table
   * and not 2. The measurement puts the hand half at 0.73 discounted and 1.08
   * undiscounted, against `drawAction`'s 1.2 - so the sum's LOWER end was right
   * for a reason the sum could not have known, and its upper end prices a hand
   * card at nearly double what the table pays for one.
   *
   * ⚠️ **THE DISCOUNT ON THE DRAW HALF IS TWO THIRDS INSTRUMENT.** The host had
   * no room for the card on 32.5% of visits and 33.6% of host-drawn cards were
   * thrown away at a turn boundary, both against the engine's hand bound of
   * **7, which is the SIMULATOR'S bound and not a rule of the game** (C7). At a
   * table with no hand limit the draw half is the full 1.08 to 1.2 and the (b)
   * end of the band is about 2.4 rather than 2.06. Pinning to the undiscounted
   * 1.2 prices the rule as the table plays it rather than as the instrument
   * clips it, which is the right way round for the one rule in this project
   * whose provenance is a table.
   *
   * ⭐ **THE HONESTY CHECK PASSES, AND IT IS THE SAME ONE THE 1.5 PASSED**: the
   * realisation rates are FLAT across every price swept - the fee reaches a barn
   * 88.3% to 88.7% of the time and the host has room 66.0% to 67.8% of the time
   * at `hostGift` 0, 1.5, 2.1, 2.7 and 3.5. The quantities being priced do not
   * move when the price moves, so the band is stable and neither leg is
   * self-fulfilling.
   *
   * ## ⭐ THE CONSEQUENCE SWEEP, IN TWO COLUMNS BECAUSE ONE OF THEM LIES
   *
   * 450 games a column, identical seeds, this weight the only thing moved, the
   * host-draw arm throughout. The control row is the paired arm
   * (`hostDrawOnVisit` 0) at its own shipped charge.
   *
   *     price    bonus slot     visits received    hook
   *              (turn measure) per player/game
   *     control       73.6%          16.23         0.886
   *     0             38.2%          11.32         0.437
   *     1.5           30.8%          10.01         0.354
   *     2.1           30.8%          10.01         0.354
   *     2.7           29.9%           9.89         0.344
   *     3.5           28.9%           9.77         0.334
   *
   * ⛔ **READ THAT TABLE AS AN ARTEFACT BEFORE READING IT AS A RESULT.** Every
   * arm row sits 35 points of bonus rate and half a hook below its control, and
   * that gap is NOT the rule: **the engine pushes the host's draw task at the
   * head of the queue**, so the probing seat's own `next` comes back EMPTY and
   * the visitor's rollout is cut before the power it just bought resolves.
   * Measured at two seats: **99.6% of visit probes stop dead under the arm
   * against 0.0% under the control.** `outcome` therefore prices almost every
   * visit at nothing and `bonusAction`, which pays only on a strictly positive
   * rollout, never fires. It is an ENGINE defect - nothing in this package can
   * step past another seat's task - and it is written up at `pendingDrawValue`
   * in `outcome.ts`.
   *
   * ## ⭐ SO THE SENSITIVITY WAS TAKEN AGAIN ON THE CONTROL RULESET, WHERE THE
   * ROLLOUT STILL WORKS, AND THE TWO ANSWERS DISAGREE
   *
   * Same 450 games, same seeds, the paired control throughout (`hostDrawOnVisit`
   * 0, so the weight is swept at 1.8x to hold the EFFECTIVE charge at the value
   * named). This column is a bot that can still see what a visit buys:
   *
   *     effective charge   bonus slot      visits received   hook
   *                        (turn measure)  per player/game
   *     0                      73.6%           16.23         0.886
   *     1.5 (shipped)          66.5%           15.71         0.800
   *     2.7 (this change)      64.6%           15.39         0.770
   *     3.5                    49.9%           13.56         0.569
   *
   * ⛔ **ON A WORKING PRICER THIS WEIGHT IS LOAD-BEARING AGAIN, AND ABOUT AS
   * LOAD-BEARING AS IT WAS YESTERDAY: 16.6 points of bonus rate and 0.231 of
   * hook between 1.5 and 3.5**, against the 15 points of self-visit share the
   * entry above reports for the same range. The flatness of the arm column is
   * the truncation and not the term - a bot that already declines most visits
   * is a bot a charge cannot move much - so **that column must be re-run before
   * its flatness is quoted as anything.**
   *
   * ⭐ **WHAT THE CHANGE ACTUALLY COSTS IS SMALL EITHER WAY, AND THAT IS THE
   * USEFUL SENTENCE.** 1.5 to 2.7 is **1.9 points of bonus rate and 0.030 of
   * hook** on the working pricer, and 0.9 points and 0.010 on the truncated
   * one. The cliff is elsewhere: 0 to 1.5 costs 7.1 points on the control
   * column, which is the term EXISTING rather than its size, and 2.7 to 3.5
   * costs 14.7, which is where the charge starts refusing visits outright.
   * **2.7 sits on the flat part of the curve and 3.5 does not**, which is a
   * second, independent reason not to have taken the terminal end of the band.
   *
   * ⚠️ **A SWEEP OF THIS NUMBER IS AN EDIT AND A REBUILD, NOT AN OVERLAY**, as
   * before (`weightsFor` takes a profile id and nothing else, the ledger's C45).
   */
  hostGift: 2.7,

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
