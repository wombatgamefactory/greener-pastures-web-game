/**
 * `reference-v1` - the frozen instrument.
 *
 * Ticket 11's first decision, and the reason this file is committed rather than
 * assembled from CLI flags: the bots are the subject as well as the instrument.
 * The same engine and the same cards gave end-game coin piles of £63/£159/£220
 * under a `pulse` mirror and £46/£33/£31 under a mixed scored table - climb
 * versus plateau, assertion 1 passing or failing purely on who sat in the
 * chairs. So one configuration is named, frozen and printed in every report
 * header, and every card economic and every watch-list threshold is defined
 * against it and is meaningless without it.
 *
 * Retuning a weight profile does not silently move the numbers. It mints
 * `reference-v2`, and the old report stays readable because it names what
 * produced it.
 */

import type { Suit } from '@gp/data';
import { SUITS } from '@gp/data';
import type { PolicyId } from '@gp/bots';
import { BALANCE_PROFILES } from '@gp/bots';

export interface ReferenceConfig {
  readonly id: string;
  readonly description: string;
  /** The profile pool seats are drawn from, one per seat, from the run seed. */
  readonly pool: readonly PolicyId[];
  /** Target games per seat count. Rounded UP to a whole number of cells. */
  readonly targetGames: Readonly<Record<number, number>>;
  readonly seatCounts: readonly number[];
  /** Move ceiling per game. A game that hits it is `maxMoves`, never thrown. */
  readonly maxMoves: number;
  /** The default run seed. A different seed is a different sample, not a different reference. */
  readonly seed: string;
}

/**
 * The instrument ticket 35's run was measured with. Kept because a report that
 * names what produced it stays readable after the instrument changes, and
 * ticket 40's deltas are read against this.
 *
 * Its known blind spots, which are why there is a v2: nothing in it read a
 * seat's coin balance, and all 105 card abilities were priced at one flat
 * constant. Do not compare a per-card economic across the two.
 */
export const REFERENCE_V1: ReferenceConfig = {
  id: 'reference-v1',
  description:
    'Mixed scored profiles, one per seat from the run seed; suits stratified through every ' +
    'legal (player suits + neutral deck) combination; 2, 3 and 4 seats.',
  pool: BALANCE_PROFILES,
  targetGames: { 2: 500, 3: 500, 4: 500 },
  seatCounts: [2, 3, 4],
  maxMoves: 6000,
  seed: 'reference-v1',
};

/**
 * `reference-v2` - the current instrument, minted by ticket 40.
 *
 * The sampling plan is deliberately IDENTICAL to v1: same pool, same targets,
 * same seat counts, same stratification. Only the evaluator changed, so holding
 * everything else still is what makes a delta between the two runs readable as
 * the instrument gaining sight rather than as a different experiment.
 *
 * What changed inside the bots:
 *   - `coinGain`, which prices a coin at what the seat can still SPEND. Nothing
 *     read a coin balance before; `visit` scored a flat 6 at £0 and at £65.
 *   - `outcome`, which prices GROW, a Worker's action and the Helping Hand's
 *     repeat by applying them on a throwaway clone and pricing what came out.
 *     All 105 abilities scored a flat 2.5 before.
 *   - `growSpend`, GROW's card payment, which had no cost term at all.
 *   - The visit's flat weight came down from 6 to 2, because its payoff is now
 *     priced where the payoff actually is.
 *
 * The seed changes with the id: the same seed against a different evaluator is
 * a different trajectory anyway, so naming it after the reference keeps the
 * pairing honest.
 */
export const REFERENCE_V2: ReferenceConfig = {
  id: 'reference-v2',
  description:
    'As reference-v1 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats - with the ' +
    'ticket 40 evaluator: coins priced by what the seat can still spend, and card abilities, ' +
    'Worker actions and the Helping Hand priced by probing what they actually do in position.',
  pool: BALANCE_PROFILES,
  targetGames: { 2: 500, 3: 500, 4: 500 },
  seatCounts: [2, 3, 4],
  maxMoves: 6000,
  seed: 'reference-v2',
};

/**
 * `reference-v3` - superseded by v4, kept because ticket 43's card-buy A/B and
 * every report between 2026-08-02 and 2026-08-04 name it.
 *
 * v2 priced what a move GETS and left what it PAYS on a junk ORDERING, so at the
 * moment a seat's marginal coin was provably worth zero the arithmetic read:
 *
 *     worthless coin visit  -1.95   {visitFeeJunk: -1.95}
 *     vs endTurn            -2.00   {endTurn: -2}
 *
 * The bot gave a card away for nothing, by 0.05, in 68% of those positions - two
 * unrelated constants deciding a real trade. Dean's correction (2026-08-02): a
 * card in hand is not junk waiting to be dumped, it is fuel that can be built,
 * can pay a GROW and fire an ability, or can pay a visit later - so it must be
 * worth more than a coin that buys nothing.
 *
 * `handSpend` is that price, charged uniformly wherever a card leaves a hand,
 * with Dean's exemption: a card you are over your hand limit with is free,
 * because the end-of-turn discard was going to take it anyway. The family spend
 * terms drop to tie-breaker weights and go back to their real job, choosing
 * WHICH card. Sampling plan is unchanged from v1 and v2.
 */
export const REFERENCE_V3: ReferenceConfig = {
  id: 'reference-v3',
  description:
    'As reference-v2 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend and card abilities priced by probing them - plus the other half ' +
    'of the exchange: a card leaving your hand is charged its option value as fuel, except when you ' +
    'are over your hand limit and the discard was going to take it anyway.',
  pool: BALANCE_PROFILES,
  targetGames: { 2: 500, 3: 500, 4: 500 },
  seatCounts: [2, 3, 4],
  maxMoves: 6000,
  seed: 'reference-v3',
};

/**
 * `reference-v4` - the current instrument. Minted by ticket 45.
 *
 * One weight changed sign, and it is minted rather than absorbed because this
 * file's own rule says a weight change never silently moves the numbers - and
 * this one moves the number the open question is ABOUT.
 *
 * `growSpend` was `-0.3` against a `-cardValue` feature, so the product was
 * `+0.3 x cardValue` and the bot paid a GROW with the card it valued MOST -
 * against its own comment and against both correctly-signed siblings. That is
 * not the ordering-only slip it looks like: `handSpend` charges by COUNT, so
 * `growSpend` is the only term reading which card pays, and it therefore sets
 * the argmax of the whole grow family. The bug scored the best grow at
 * `base + 0.3 x max(cardValue)` instead of `base - 0.3 x min(cardValue)`, and
 * was manufacturing GROW traffic:
 *
 *     GROW take rate   23.0% -> 16.9%
 *     GROW per game    8.9   -> 6.9
 *
 * Everything else held (visit 38.9 -> 39.0, harvest and deliver unmoved, build
 * 8.1 -> 8.9, draw 22.7 -> 24.0), the verdict stayed 6 PASS / 2 FAIL, and no
 * bot or suit win rate moved outside its interval. Sampling plan unchanged from
 * v1, v2 and v3.
 *
 * Do not compare a per-card economic across v3 and v4: GROW is what fires a
 * card's ability, so a 22% swing in it re-baselines the whole funnel.
 */
export const REFERENCE_V4: ReferenceConfig = {
  ...REFERENCE_V3,
  id: 'reference-v4',
  description:
    'As reference-v3 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend, card abilities priced by probing them, and a card leaving ' +
    'hand charged its option value as fuel - with growSpend re-signed so a GROW is paid with the ' +
    'junkiest legal card rather than the most valuable.',
  seed: 'reference-v4',
};

/**
 * `reference-v5` - superseded by v6, which re-baselines nothing: the two are
 * comparable, uniquely so far. Minted by ticket 47.
 *
 * `buildSpend` was `-0.2` against a `-(payment.length + coinWild)` feature, and
 * unlike ticket 45's `growSpend` that is not an ordering term with the wrong
 * sign - it is not an ordering term at all. The engine holds
 * `payment.length + barn + coinWild === cardsNeeded`, so for one built card the
 * sum is a CONSTANT: measured over 262 real builds it separated the
 * alternatives twice, both times on D8's rare barn leg, while 23.7% of builds
 * had a genuine choice of which cards to burn and the pick fell to the
 * evaluator's random tie-break. What the term did instead was `+0.2 x
 * cardsNeeded` - a standing preference for the dearer build, uncontested
 * whenever the seat was over its hand limit and `handSpend` exempted the excess.
 *
 * Three changes, one meaning: the term becomes the junk ordering its siblings
 * already are (`+0.3` on `-totalValue(payment)`); D7's coins-as-wilds are priced
 * through `coinGain`, the bot's single coin price, because there a coin buys
 * nothing and merely stands in for a card; and D8's barn cards are charged at
 * `deliverCost`'s rate, since a barn card burnt on a build is freight not
 * delivered. The probe pricer had the SAME weight against a raw count, so a
 * build inside a rollout was charged 0.2 a card where the move table charges
 * 2.5; it now charges `handSpend`.
 *
 *     build take rate  22.7% -> 21.4%   (9.1 a game, unmoved)
 *     GROW per game     7.2  ->  6.5
 *     end coins         £9 / £8 / £10 -> £9 / £9 / £9
 *
 * Verdict held at 6 PASS / 2 FAIL / 5 OBSERVE and visits per turn at 0.56.
 * Sampling plan unchanged from v1 through v4.
 *
 * Do not compare a per-card economic across v4 and v5: GROW fires a card's
 * ability and it moved 10%.
 */
export const REFERENCE_V5: ReferenceConfig = {
  ...REFERENCE_V4,
  id: 'reference-v5',
  description:
    'As reference-v4 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend, card abilities priced by probing them, and a card leaving ' +
    'hand charged its option value as fuel - with a build now paid with the junkiest legal cards, ' +
    "its coins-as-wilds priced at the bot's one coin price, its barn cards charged as undelivered " +
    'freight, and a build inside a probe charged what a card leaving hand actually costs.',
  seed: 'reference-v5',
};

/**
 * `reference-v6` - superseded by v7. Minted by ticket 48.
 *
 * The third and last of the inverted spend terms. `deliverCost` was `-0.5`
 * against a `-spendSize` feature, so the product PAID the bot 0.5 a card for
 * delivering to the tile that ate more freight; it merges with ticket 47's
 * `buildBarn` into one `barnSpend`, the barn's answer to `handSpend` - one
 * uniform charge for a card leaving the store, wherever it leaves for - and the
 * probe pricer charges a delivery inside a rollout the same way.
 *
 * **This is the first minting that re-baselines nothing, and that is measured
 * rather than hoped.** The paired arms on v5's own seed came back with the
 * verdict unchanged at 7 PASS / 1 FAIL / 5 OBSERVE and every headline inside
 * noise (deliver 8.0 a game and 85.6% -> 85.5%, GROW 6.7, visits per turn 0.54,
 * end coins £8/£9/£8), and the probe leg was bit-identical to the term leg over
 * 1510 games. So per-card economics DO carry across v5 and v6.
 *
 * It is minted anyway, on the naming invariant rather than on the numbers: the
 * evaluator changed, so a report produced by it must not go out under the name
 * of the one that came before. The reason the id moves and the numbers do not
 * is that the term could never order anything - a tile's card cost is fixed by
 * its crates, and at these weights the 4-point swing between levels sits under
 * a 12-point gap in printed VP. Sampling plan unchanged from v1 through v5.
 */
export const REFERENCE_V6: ReferenceConfig = {
  ...REFERENCE_V5,
  id: 'reference-v6',
  description:
    'As reference-v5 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend, card abilities priced by probing them, and a card leaving ' +
    'hand charged its option value as fuel - with the barn given the same treatment as the hand: ' +
    'one uniform charge for a card leaving it, whether for the island or for a build, and the ' +
    'same charge inside a probe.',
  seed: 'reference-v6',
};

/**
 * `reference-v7` - superseded by v8. Minted by ticket 50.
 *
 * The probe could not see a draw. A `draw` task takes one `deck` answer per card
 * REVEALED and only then a `keep`, and `cardsToHand` - the only priced event in
 * the whole effect - fires on the keep, so a "Draw N" costs N+1 rollout levels
 * against a DEPTH of 3. Everything drawing 3 or more was worth its flat weight
 * and nothing else, and the worst case was the one the design cares most about:
 * the **Draw Worker, priced at exactly zero in 82.2%** of the positions it was
 * offered in, against 0.0% for all four other Workers.
 *
 * A pending draw now ends the rollout and is priced analytically - the cards it
 * will keep, at the same blind price `cardsToHand` pays - which reproduces what
 * walking would have found (a DEPTH=8 control prices the Draw Worker at 5.11
 * mean against the fix's 4.87) while spending FEWER applies, because the reveals
 * are never applied at all.
 *
 * Unlike v6 this one really does re-baseline, and in the direction the design
 * was afraid of:
 *
 *     Draw Worker share of rival Worker uses   15.9% -> 23.7%  (even share 20%)
 *     rival Worker uses per run                23835 -> 26990
 *     GROW per game                            6.4   -> 7.2
 *     main-action Draw per game                24.1  -> 22.8
 *     wage income per game, by suit            ~£7.7 -> ~£8.6
 *
 * Verdict held at 7 PASS / 1 FAIL / 5 OBSERVE. Sampling plan unchanged from v1
 * through v6.
 *
 * **Do not compare a per-card economic across v6 and v7**, and note the reason
 * is not only GROW this time: the Orchard suit and every card that draws were
 * being valued blind at the moment the bot decided whether to fire them.
 */
export const REFERENCE_V7: ReferenceConfig = {
  ...REFERENCE_V6,
  id: 'reference-v7',
  description:
    'As reference-v6 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend, card abilities priced by probing them, cards leaving a hand ' +
    'or a barn charged what they cost - with a draw inside a probe finally visible: a pending ' +
    'draw is priced as the cards it will keep rather than walked past by a depth limit.',
  seed: 'reference-v7',
};

/**
 * `reference-v8` - the current instrument. Minted by ticket 49.
 *
 * The last flat constant standing where a real ability lives. A balloon move
 * grants Draw 4, Sow 4 from hand, a build at a discount or £4, and all four
 * scored one weight - `balloon: 2` - which is exactly the shape ticket 40
 * deleted for GROW and ticket 50 for the draw. Its freight was free too: two
 * differing barn cards, the one barn exit neither 47 nor 48 had charged.
 *
 * Three changes, and the second was forced by the first rather than planned:
 *
 *   1. **The balloon is probed.** The reward is a task, so the rollout walks it,
 *      and `effectKey` collapses a balloon's C(suits, 2) ways to pay into one
 *      probe the way a GROW's payments collapse - 8.4 offered options become 3.2
 *      probes, measured, against a 96-apply budget the whole decision shares.
 *   2. **A pending draw is capped by ROOM IN HAND.** Ticket 50 priced it at
 *      `keep x meanCardValue` flat, which the Draw Worker (keep 2) hid and the
 *      Draw 4 balloon exposed the moment the bots could see it: balloon takes
 *      went 89 -> 414 over 55 games, 60.9% of them the Draw balloon, 32.9% with
 *      a full hand, and the widest position in the UI's own corpus went from 792
 *      legal moves to 8008 - discard subsets, a seat seven cards over its limit.
 *      The room is read off the probe rather than off `Scratch`, because a
 *      rented Worker is reached by a visit that pays a card first.
 *   3. **`balloon` goes 2 -> 0.** "A balloon is worth its reward and nothing
 *      else", the sentence ticket 40 applied to the visit, for the same measured
 *      reason: with the payoff priced, the constant was inflating the number
 *      watch-list assertion 12 exists to measure.
 *
 * Against v7, and this one re-baselines hard:
 *
 *     balloon moves per game       0.7   -> 5.5   (take rate 2.3% -> 18.0%)
 *     raids per game (assertion 12) 6.91 -> 11.61
 *     end coins by seat count       £7/£8/£9 -> £8/£11/£12
 *     assertion 1, steepest climb   £1.25 -> £2.00
 *     orchard suit win rate         40.9% -> 44.5%
 *     racer / hermit                45.0 / 40.6 -> 38.6 / 38.3
 *
 * Verdict held at 6 PASS / 2 FAIL / 5 OBSERVE. Sampling plan unchanged from v1
 * through v7.
 *
 * **Do not compare a per-card economic across v7 and v8.** The Aerodrome module
 * is in play whenever Vegetables are at the table, and the bots went from
 * ignoring it to using it eight times a game.
 */
export const REFERENCE_V8: ReferenceConfig = {
  ...REFERENCE_V7,
  id: 'reference-v8',
  description:
    'As reference-v7 - mixed scored profiles one per seat from the run seed, suits stratified ' +
    'through every legal (player suits + neutral deck) combination, 2/3/4 seats, coins priced by ' +
    'what the seat can still spend, card abilities priced by probing them, cards leaving a hand ' +
    'or a barn charged what they cost - with the Aerodrome finally visible: a balloon move is ' +
    'priced by the reward it grants rather than by one flat weight, its two barn cards are ' +
    'charged like every other barn exit, and a draw is worth only the cards there is room to keep.',
  seed: 'reference-v8',
};

/**
 * `reference-v9` - the current instrument. Minted 2026-08-08.
 *
 * **The first minting in the file's history that changes the SAMPLING PLAN
 * rather than the evaluator.** v1 through v8 all end with "sampling plan
 * unchanged"; this one does not, and it is the more serious kind of re-baseline
 * because it moves what was measured rather than who was measuring.
 *
 * The defect: `cellsFor` seats a cell's chosen suits in canonical `SUITS` order,
 * so seat index was tied to suit for every run this project has ever done.
 * Measured over 763 ended games at v8:
 *
 *     suit         seat 0   seat 1   seat 2   seat 3
 *     wheat          100%       0%       0%       0%
 *     vegetable       44%      56%       0%       0%
 *     orchard         17%      55%      27%       0%
 *     apiary           6%      34%      49%      11%
 *     dairy            0%      23%      33%      44%
 *
 * Wheat had never once been seated anywhere but the start player's chair, and
 * dairy had never once sat in it. That would be a small bias if the chair were
 * worth nothing. It is not: two independent 1510-game arms put the LAST SEAT at
 * -10.1 and -9.8 win-share points at 3 seats, a movement of 0.3 between arms,
 * against a band of about +/-3. The last seat delivers 3.13 against the start
 * player's 4.16 and takes 6 VP less in island receipts, on a winning score
 * around 40 - the island is a race for tiles and the last chair loses it.
 *
 * So every per-suit win rate in every report up to and including v8 is a mixture
 * of "how good is this suit" and "what is this chair worth", and the two cannot
 * be separated from those runs. `docs/Card Analysis v14.md` reads them as suit
 * strength.
 *
 * The correction is `seatingFor`: the suit set rotates around the table by game
 * index within each cell, so each suit sits in each chair equally often. The old
 * comment on `cellsFor` said seat order was not a stratification axis because
 * "the profile assignment already rotates who sits where" - true of the
 * PROFILES, false of the SUITS, and that is what hid it.
 *
 * `gamesPerCell` now rounds up to a whole multiple of the seat count as well as
 * to a whole cell, for the same reason it already rounded up to a whole cell: a
 * cell running 17 games at 2 seats would give one rotation 9 games and the other
 * 8, quietly weighting one seating above the other in every pooled number.
 *
 * **Nothing in the bots changed.** The evaluator is v8's exactly.
 *
 * **Do not compare ANY per-suit or per-seat number across v8 and v9.** Per-card
 * economics are also affected wherever a card's suit correlates with position.
 */
export const REFERENCE_V9: ReferenceConfig = {
  ...REFERENCE_V8,
  id: 'reference-v9',
  description:
    'As reference-v8 - the same evaluator throughout: coins priced by what the seat can still ' +
    'spend, card abilities and balloon rewards priced by probing them, cards leaving a hand or a ' +
    'barn charged what they cost, a draw worth only the cards there is room to keep - with the ' +
    'sampling plan corrected for the first time since v1: a cell rotates its suits around the ' +
    'table by game index, so seat index is no longer tied to canonical suit order and a suit win ' +
    'rate is no longer confounded with what the chair is worth.',
  seed: 'reference-v9',
};

/**
 * `reference-v10` - the current instrument, cut 02/09/2026 for v31.
 *
 * ⛔⛔ **NOTHING IN `reports/` IS COMPARABLE ACROSS THIS BOUNDARY.** Not a suit
 * win rate, not a per-card economic, not a headline metric, not an assertion
 * value. This is the largest re-baseline in the file's history and it is the
 * only one where the reason is the GAME rather than the instrument.
 *
 * ## What changed, and why none of it can be held still
 *
 * v9 through v1 all measured a game with a CURRENCY in it. v31 deletes coins
 * outright, and with them: the wage a visit minted, the GBP 2 starter upgrades
 * and all fifteen upgraded faces, the market, the card buy, the coin tie-break
 * and the coin-priced half of thirty Power and Endgame cards. It also deletes
 * the hand limit, makes the plain Draw 2-keep-2, gives the bonus slot a free
 * Draw 1 and a self-visit, and hands the island's reward over to MEEPLES - a
 * stored free action that leaves the game when spent.
 *
 * Every previous minting in this file could say "sampling plan unchanged" or
 * "only the evaluator changed", and the honest ones said which numbers survived
 * and which did not. This one can say neither. The rules, the cards, the
 * evaluator and the metric set all moved together, because they had to:
 *
 *   - **The bots** lost `coinWorth`, `coinGain`, `coinRunway`, `sinkGap` and
 *     the hand-limit exemption in `handSpendCost`, and gained `meepleGain` /
 *     `meepleSpend` (pinned to each other at 2.5), `meepleWorth`, a spend-meeple
 *     act, a self-visit act priced apart from a visit, and a Farmstead own-suit
 *     VP term. The evaluator also had to be taught to take a CLOSING WINDOW
 *     before acting, because a term-table argmax always prefers the big main
 *     action and would otherwise forfeit the bonus slot on every turn.
 *   - **The metrics** lost the end-coin series, the wage income line, the
 *     five-way bonus tally, the Farmstead flip timing and the per-card coin
 *     column, and gained the meeple series, the door mix, actions resolved and
 *     the four-way bonus tally.
 *   - **The suite** retired four assertions whose subject no longer exists and
 *     wrote three new ones (see `tombstones.ts` and `assertions/index.ts`).
 *
 * ## The two numbers with no measurement behind them
 *
 * Stated here rather than buried, because they are the instrument's own
 * uncertainty and they sit directly under the newest assertion. `meepleGain`
 * (2.5) and `MEEPLE_LATENT` (0.4) were pinned by argument. They are the
 * HOARDING DIAL: raise them and the bots hoard meeples, lower them and they
 * dump. Sweep both before drawing any conclusion about the meeple economy in
 * either direction.
 *
 * ## What did NOT change
 *
 * The sampling plan, exactly - the same mixed profile pool one per seat from
 * the run seed, the same stratification through every legal (player suits +
 * neutral deck) combination, the same 2/3/4 seat counts, the same rotation of
 * suits around the table by game index that v9 introduced. That is deliberate
 * and is the one thing holding the two eras in the same shape: the sample is
 * drawn the same way, so a v10 number is at least ASKING the same question of
 * the same population. It is answering it about a different game.
 */
export const REFERENCE_V10: ReferenceConfig = {
  ...REFERENCE_V9,
  id: 'reference-v10',
  description:
    'The v31 game and the v31 evaluator. Sampling plan identical to reference-v9 - mixed scored ' +
    'profiles one per seat from the run seed, suits stratified through every legal (player ' +
    'suits + neutral deck) combination and rotated around the table by game index, 2/3/4 ' +
    'seats - measuring a game with NO CURRENCY: coins, wages, starter upgrades, the market and ' +
    'the card buy are all deleted, the island pays a meeple instead of a coin, the bonus slot ' +
    'offers a free Draw 1 or a card on any Notice Board including your own, and the bots price ' +
    'a meeple by the action it buys rather than a coin by what it can still be spent on. The ' +
    'hand limit is a single global rules.turn.handLimit, checked once at the turn ' +
    'boundary, after v31 deleted the per-Barn one and the simulator measured what that cost - ' +
    'reinstated at 12 on 02/09/2026 and cut to the shipped 7 the same day. ' +
    'NO NUMBER IN ANY EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v10',
};

/**
 * ⚠️ ONE THING INSIDE reference-v10 MOVED, AND THE REPORTS THAT STRADDLE IT SAY
 * `REDUCED` IN THEIR FILENAMES.
 *
 * v31 shipped on 02/09/2026 with NO hand limit at all. The first run of this
 * instrument measured what that did to the game tree - hands to 34 cards, one
 * position enumerating 43,879 legal moves of which 43,845 were build payments,
 * and a 2-seat game costing 91.5 seconds against reference-v9's 0.1 - and a
 * single global `rules.turn.handLimit: 12` went back in the same day. The
 * before-and-after is paired and measured: worst legal moves 116,535 -> 2,788,
 * worst payment enumeration for one card 15,260 -> 495, median/max hand 11/41
 * -> 7/16, seconds per 2-seat game 91.5 -> 0.91.
 *
 * The reference id did NOT move for it, and that is a deliberate call rather
 * than an oversight: no reference-scale run ever completed in the no-limit
 * tree, because none could. The only numbers taken there are the five
 * `-REDUCED` reports of 02/09/2026, 8 games each at 2 seats, and their
 * filenames carry the warning. Everything at n=1580 under this id is the
 * limit-12 game.
 *
 * `rules.turn.handLimit: null` reproduces the no-limit tree exactly, as the
 * control arm. It is not a cell in `overlays/hand-limit.sweep.json` on purpose:
 * a ladder that includes it spends most of its wall time on the one rung the
 * project has already rejected.
 */

/**
 * `reference-v11` - the current instrument, cut 03/09/2026 for the turn-order
 * correction and the bonus-slot repricing.
 *
 * ⭐ TWO THINGS MOVED AT ONCE AND BOTH MOVE THE SAME NUMBER, which is why this
 * is a new reference rather than an arm. **No number in any reference-v10 report
 * is comparable with a reference-v11 one.**
 *
 *   1. **THE RULE.** `rules.turn.bonusTiming` is `'end'`: the turn is meeples,
 *      then the CORE ACTION, then the bonus. The engine and both design docs had
 *      carried `'start'` since 19/08/2026 and were wrong about the game (Dean,
 *      03/09/2026). This is a CORRECTION, not an experiment - v10 was measuring
 *      a turn order nobody was playing. `'start'` survives as
 *      `overlays/bonus-first.overlay.json`, which is the arm that says what the
 *      error was worth.
 *
 *   2. **THE BOTS.** Two changes to how a door is priced, both aimed at the same
 *      acknowledged bias:
 *      - a probed build now carries the Farmstead's own-suit VP as a blind
 *        probability (`OWN_CROP_BUILD_PRIOR`). It used to carry none, so "a
 *        build reached through a door or a meeple was worth one VP less to the
 *        bot than it really is, always in the same direction" - and the Dairy
 *        door, which IS a build, sat at 7% of door traffic, the lowest of five.
 *      - the new `bonusAction` term pays a door for BEING a whole extra action
 *        and not only for the goods it produces (Dean: *"the Draw 1 option is
 *        only worth half an action"*). Weight 2.4, pinned to `drawAction`'s 1.2
 *        a card. **0 is the control arm and reproduces the v10 bots exactly.**
 *
 * ⚠️ THE SECOND ONE DELIBERATELY DOUBLE-COUNTS, and that is the open question
 * this reference exists to answer: `outcome` already prices the door's goods.
 * The claim is that a greedy one-ply rollout underprices an action by about the
 * value of an action, because it cannot see compounding. It may be wrong, or
 * 2.4 may simply be too much. Never quote a hook or door-mix number off this
 * reference without the `bonusAction: 0` arm beside it.
 *
 * The sampling plan is, again, the one thing held still.
 */
export const REFERENCE_V11: ReferenceConfig = {
  ...REFERENCE_V10,
  id: 'reference-v11',
  description:
    'The turn-order correction and the bonus-slot repricing. Sampling plan identical to ' +
    'reference-v9 and v10 - mixed scored profiles one per seat from the run seed, suits ' +
    'stratified through every legal (player suits + neutral deck) combination and rotated ' +
    'around the table by game index, 2/3/4 seats. TWO THINGS MOVED AT ONCE AND BOTH MOVE THE ' +
    'BONUS SLOT. (1) THE RULE: rules.turn.bonusTiming is now "end" - meeples, then the CORE ' +
    'ACTION, then the bonus - correcting a turn order the engine and both design docs had ' +
    'carried wrongly since 19/08/2026. Under it a door can no longer fuel the action that ' +
    'follows it, and the action can now set the door up, so the DOOR MIX is expected to move ' +
    'and not only the visit rate. (2) THE BOTS: a probed build now carries the Farmstead ' +
    'own-suit VP as a blind probability, closing a one-directional underpricing that fell ' +
    'hardest on the Dairy door, and the new bonusAction term pays a door for being a whole ' +
    'extra action rather than only for the goods it produces. The second deliberately ' +
    'double-counts against outcome and its control arm is bonusAction 0. ' +
    'NO NUMBER IN ANY reference-v10 REPORT IS COMPARABLE.',
  seed: 'reference-v11',
};

/**
 * `reference-v12` - the current instrument, cut 04/09/2026 for the meeple loop.
 *
 * ⛔⛔ **NO NUMBER IN ANY `reference-v11` OR EARLIER REPORT IS COMPARABLE.** Not
 * a hook value, not a bonus-mix share, not a door mix, not a suit win rate, not
 * a per-card economic, not a game length, not an assertion verdict. This is the
 * second-largest re-baseline in the file's history, behind only v10's deletion
 * of the currency, and like that one the reason is the GAME rather than the
 * instrument.
 *
 * ## What moved, in one list, because "the visit changed" understates it
 *
 * Dean ruled the meeple loop in on 04/09/2026
 * (`docs/meeple-loop-visit-handoff-2026-09-04-v1.md` is the design,
 * `docs/meeple-loop-measurement-2026-09-04-v1.md` is what it measured), so
 * `rules.turn.visitCurrency` is `'meeple'` in the shipped data. Seven rules go
 * with that flag and every one of them moves numbers this file's readers quote:
 *
 *   1. **The visit is paid in MEEPLES, not cards.** One meeple from your supply
 *      into the colour slot of a neighbour's Notice Board, and you take that
 *      colour's plain action. No card leaves any hand, so about 29 fee cards a
 *      game stop flowing into barns and the whole `handSpend` half of the bot's
 *      visit arithmetic has no subject. Two meeples may be spent as one of any
 *      colour, which is a move shape v11 had no vocabulary for.
 *   2. **Self-visiting is IMPOSSIBLE**, by construction rather than by weight
 *      (rule X5). It took 22.2% of turns under v11. The `self` line on
 *      `a08-the-hook` should now read exactly 0, and that is a claim to assert
 *      rather than an assumption to inherit.
 *   3. **The Notice Board is not a building.** No threshold, no stack, nothing
 *      may ever be placed on it, and it cannot clog or be harvested. It is five
 *      colour-keyed slots, and what shuts a door is a meeple sitting in one
 *      until its owner collects. The clog assertions lost their referent and
 *      the blocked-want rate replaced them.
 *   4. **The standalone free Draw 1 is gone.** `rules.turn.bonusDraw` survives
 *      only as the draw attached to COLLECT, so the bonus slot is Visit or
 *      Collect and never four options.
 *   5. **The turn-start meeple spend is gone.** A meeple is spent in the bonus
 *      slot and only there, one a turn, and a spent meeple is never removed
 *      from the game: it moves to the neighbour's board and comes home on their
 *      Collect. The faucet-and-drain economy became a loop, which is why
 *      "meeples spent versus gained" is not a question any more.
 *   6. **The Orchard door is Draw 2.** The one printed exception in the door set
 *      is retired: it existed because a v31 visit cost a card and the slot's
 *      other option was a free Draw 1, and neither half of that argument has a
 *      subject now. Measured inert (hook 0.37 either way), so it was taken for
 *      the flat rule rather than for the number.
 *   7. **The island seeds ONE meeple per tile, on the 3 VP space.** Not two per
 *      tile on both. The bag is drawn 6 / 9 / 12 deep instead of 12 / 18 / 24,
 *      and the 6 VP first delivery pays VP alone. Every seat also STARTS holding
 *      one meeple of each colour, from outside the bag.
 *
 * ## The one thing that did not change, again
 *
 * The sampling plan, exactly: the same mixed profile pool one per seat from the
 * run seed, the same stratification through every legal (player suits + neutral
 * deck) combination, the same 2/3/4 seat counts, the same rotation of suits
 * around the table by game index that v9 introduced. Held still on purpose, for
 * the same reason as every minting since: the sample is drawn the same way, so a
 * v12 number is at least ASKING the same question of the same population. It is
 * answering it about a different game.
 *
 * ## Two honesties this reference has to carry
 *
 * ⚠️ **IT WAS RULED IN ON A MEASUREMENT THAT WENT THE WRONG WAY ON ITS OWN
 * HEADLINE.** Paired on v11 seeds, the hook FELL - 0.41 to 0.37 rival visits per
 * player per turn, against a floor of 0.5 - and the game got 35-43% longer. What
 * moved in its favour: the two dead meeple colours came back to life (Apiary and
 * Dairy take 46% of door uses against 32%, and the door-mix assertion goes FAIL
 * to PASS), self-visiting became impossible, and rival visits PER GAME rose 21%
 * even as visits per turn fell. Whether the hook is a per-turn or a per-game
 * quantity is a design decision nobody has made, and until somebody makes it,
 * `a08-the-hook` is measuring a quantity that has not been defined.
 *
 * ⚠️ **THE BOTS WERE NOT RE-TUNED FOR ANY OF THIS.** `meepleGain` (2.5) and
 * `MEEPLE_LATENT` (0.4) are still set by argument rather than measurement, and
 * still not overlay-addressable. Under v10 and v11 they priced one faucet and
 * one drain; they now price the visit, the Collect, the supply cap and the
 * island, which is most of the bonus slot. Anything this instrument says about
 * the meeple economy is partly a report of the bots' opinion of what a stored
 * meeple is worth. `bonusAction: 2.4` and its deliberate double-count against
 * `outcome` are inherited from v11 unchanged, and its control arm is still
 * `bonusAction: 0`.
 *
 * The control is `overlays/v31-card-visit.overlay.json`, which reproduces the
 * v11 RULES under the v12 bots and the v12 seeds. It is not a way to recover a
 * v11 number - the evaluator and the sample both moved - it is the arm to run
 * beside the default when a question needs the old game.
 */
export const REFERENCE_V12: ReferenceConfig = {
  ...REFERENCE_V11,
  id: 'reference-v12',
  description:
    'The meeple loop as the shipped game (Dean, 04/09/2026). Sampling plan identical to ' +
    'reference-v9, v10 and v11 - mixed scored profiles one per seat from the run seed, suits ' +
    'stratified through every legal (player suits + neutral deck) combination and rotated ' +
    'around the table by game index, 2/3/4 seats. SEVEN RULES MOVED TOGETHER, all behind ' +
    'rules.turn.visitCurrency "meeple": the visit is paid in MEEPLES rather than cards and no ' +
    'card is ever placed on a board; SELF-VISITING IS IMPOSSIBLE by construction, where it took ' +
    '22.2% of turns under v11; the Notice Board is NOT A BUILDING at all, so it has no ' +
    'threshold, cannot clog and cannot be harvested; the standalone free Draw 1 is DELETED and ' +
    'survives only as the draw attached to COLLECT; the turn-start meeple spend is DELETED, so ' +
    'a meeple is spent once a turn in the bonus slot and moves to the neighbour rather than ' +
    'leaving the game; the Orchard door is a plain DRAW 2 and the door set has no exception ' +
    'left; and the island seeds ONE meeple per tile on the 3 VP space rather than one on each ' +
    'of two, while every seat starts holding one of each colour from outside the bag. The bots ' +
    'were NOT re-tuned: meepleGain and MEEPLE_LATENT are still set by argument and now price ' +
    'most of the bonus slot. The v31 rules survive as overlays/v31-card-visit.overlay.json, ' +
    'which is the control for every future comparison. ' +
    'NO NUMBER IN ANY reference-v11 OR EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v12',
};

/** The instrument every current number is defined against. */
export const REFERENCE = REFERENCE_V12;

/**
 * The noise floor, measured once and quoted constantly.
 *
 * The method document's section 8 opens with this and the project had no answer
 * until 2026-08-08: without it, every delta table in `reports/` is unreadable in
 * principle, because nothing says how big a difference has to be to be real.
 *
 * These are the observed movements between TWO IDENTICAL RUNS on two seeds -
 * same rules, same plan, same bots, different sample. A difference smaller than
 * the figure here is not a finding, whatever else the report says about it.
 *
 * Re-measure with `npm run sim -- --noise` after minting a reference, and paste
 * the new numbers back here. They are quoted in the sweep header and the report
 * footer, so a stale value here is worse than none.
 */
export interface NoiseFloor {
  /** The reference these were measured against. A mismatch is printed, not hidden. */
  readonly reference: string;
  /** Games per seat count in each arm. */
  readonly games: number;
  readonly measured: string;
  /** Metric label -> largest observed |arm A - arm B|, in the metric's own units. */
  readonly movement: Readonly<Record<string, number>>;
}

/**
 * Measured 2026-08-08, `reference-v9`, 1580 games per arm.
 *
 * Read the seat figure carefully, because it is the one that matters and it is
 * the one most easily over-read. `seat deviation` here is the WORST chair at any
 * seat count, which is a maximum over nine chairs and therefore biased upward by
 * construction. Chair by chair the movement was 0.2 / 1.2 / 3.8 / 4.8 at 4
 * seats, 3.6 / 0.3 / 3.9 at 3, and 4.9 at 2. So a single chair sitting 4 points
 * off an even split is unremarkable; the +/-3 band is a design target, not a
 * detection threshold, and at this `n` the instrument cannot resolve it.
 *
 * **A movement of exactly 0 means "below this metric's own resolution", never
 * "noiseless".** Six of these are medians over discrete quantities - rounds,
 * VP, cards - so both arms land on the same integer and the difference is
 * floored at zero. Treating that as licence to call a 1-point delta real is the
 * obvious way to misuse this table. Where a metric reads 0 the honest floor is
 * one unit of whatever it counts.
 */
/**
 * ⛔ NOT MEASURED FOR `reference-v10`, and deliberately left null at the time
 * rather than carried over. Kept as a paragraph because the reasoning is the
 * method and it applies at every boundary: the floor is a function of the
 * INSTRUMENT, v10 changed the rules, the cards, the evaluator AND the metric set
 * at once, and three of the eleven metrics it had been recorded against no
 * longer existed under their old names. A carried-over table would have quoted a
 * floor for a metric it never watched while leaving the newest numbers with none
 * at all. A stale floor is worse than an absent one, because it licenses a claim
 * about a run it did not see.
 *
 * The v9 values, for the record and NOT for use: end coins 0, barn at game end
 * 0, game length 1 round, visits per turn 0.003, unfinished games 0.005,
 * winning score 1, last as % of winner 0.003, tied top score 0.004, deck
 * reshuffles 1, reshuffles per played crop 0, seat deviation 6.255 (measured
 * 2026-08-19 at n=500 per arm).
 *
 * Two readings survive every boundary because they are about the METHOD rather
 * than about this game:
 *
 *   - **A movement of exactly 0 means "below this metric's own resolution",
 *     never "noiseless".** Most of these are medians over discrete quantities,
 *     so both arms land on the same integer and the difference is floored at
 *     zero. Where a metric reads 0, the honest floor is one unit of whatever it
 *     counts.
 *   - **The seat figure is the WORST chair at any seat count**, a maximum over
 *     nine chairs, so it runs high by construction. The +/-3 band is a design
 *     target, not a detection threshold.
 *
 * Re-measure with `npm run sim -- --noise --n=<the reference n>` and paste the
 * literal it prints back in here. A small run overstates the floor enormously
 * and is worse than not measuring it at all.
 */

/**
 * ⭐ MEASURED FOR `reference-v12` ON 04/09/2026, at the reference n of 500 games
 * per seat count per arm (1,580 games each, 3,160 in total). The run took **69
 * seconds** end to end, which is what a `--noise` costs now: it plays the whole
 * plan twice.
 *
 * ⚠️ **DO NOT READ THESE AGAINST THE v11 TABLE.** Four things make the two
 * incomparable and each is a fact rather than a caveat.
 *
 *   - `self-visit share of visits` reads **0.0% in both arms** and its movement
 *     is **0** because the rule is gone (X5), not because the sample was quiet.
 *     Anything that "moves" it is a bug in the counter.
 *   - `meeple spend rate` reads **131.5% and 132.2%**, which is not a percentage
 *     that has escaped: meeples RECIRCULATE now, so a seat can spend more of a
 *     colour over a game than it ever gained. Over 100% is the loop turning.
 *     Under v11 the same metric was a faucet-and-drain ratio capped at 100.
 *   - `deck reshuffles per game` is **39.00 in both arms** against v11's floor
 *     of 1. The game is 35-43% longer and no card is spent on a visit, so the
 *     decks turn over far more often. The 0 movement is two arms landing on the
 *     same integer, which is this table's usual "one unit" case.
 *   - `seat deviation` reads **1.4 points** against v11's 10.358, and that is the
 *     single most useful number in the table. It is still the WORST chair at any
 *     seat count - a maximum over nine chairs, biased upward by construction -
 *     and it has come down sevenfold. Chair by chair the movement was 7.8 at 2
 *     seats, 4.3 / 3.7 / 0.6 at 3 and 3.9 / 0.7 / 1.9 / 6.5 at 4. So the +/-3
 *     design band is now inside the instrument's reach at 3 and 4 seats and is
 *     still not at 2, where one chair moved 7.8 points on seed alone.
 *
 * The two metrics that matter most to the design both sit very low: `visits per
 * turn` moves **0.002** and `actions per turn` **0.005**, so the hook and the
 * inflation reading can resolve differences an order of magnitude smaller than
 * the deltas anybody is arguing about. A delta under the figure here is not a
 * finding, whatever else the report says about it.
 */
export const NOISE_FLOOR: NoiseFloor | null = {
  reference: 'reference-v12',
  games: 500,
  measured: '2026-09-04',
  movement: {
    'meeples held at game end': 0,
    'barn at game end': 0,
    'game length, rounds': 1,
    'visits per turn': 0.002,
    'actions per turn': 0.005,
    'meeple spend rate': 0.007,
    'self-visit share of visits': 0,
    'unfinished games': 0.001,
    'winning score': 1,
    'last as % of winner': 0.006,
    'tied top score': 0.006,
    'deck reshuffles per game': 0,
    'reshuffles, played crop': 0,
    'seat deviation': 1.4,
  },
};
/**
 * One stratified cell: the suits at the table.
 *
 * Ticket 07 put exactly (seats + 1) decks in play with unchosen crops out of
 * the game entirely, so a fixed suit set gives 42 cards n = 0. Rotating
 * deterministically through every legal combination gives uniform per-card
 * coverage when pooled, and a suit-matchup table for free when split.
 */
export interface Cell {
  readonly seats: number;
  /** Player suits, in seat order (canonical SUITS order within the cell). */
  readonly suits: readonly Suit[];
  /** The passive decks nobody farms. */
  readonly neutral: readonly Suit[];
  readonly label: string;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * Every legal cell at this seat count: 30 at 2 seats, 20 at 3, 5 at 4.
 *
 * A cell is an unordered SET of player suits. Treating (wheat, dairy) and
 * (dairy, wheat) as different cells would double the cell count for no extra
 * suit coverage, so the seating is handled inside the cell instead, by
 * `seatingFor` rotating the set by game index. `cell.suits` is therefore the
 * canonical order and NOT the order anybody sat in - ask `seatingFor`.
 */
export function cellsFor(seats: number, decksInPlay: number): Cell[] {
  const neutralCount = decksInPlay - seats;
  const out: Cell[] = [];
  for (const suits of combinations(SUITS, seats)) {
    const rest = SUITS.filter((s) => !suits.includes(s));
    for (const neutral of combinations(rest, neutralCount)) {
      out.push({
        seats,
        suits,
        neutral,
        label: `${suits.map(short).join('')}+${neutral.map(short).join('') || '-'}`,
      });
    }
  }
  return out;
}

export function short(suit: Suit): string {
  return suit === 'wheat'
    ? 'W'
    : suit === 'vegetable'
      ? 'V'
      : suit === 'orchard'
        ? 'O'
        : suit === 'apiary'
          ? 'A'
          : 'D';
}

/**
 * Who sits where, for game `index` of a cell: the cell's suits rotated left by
 * `index % seats`.
 *
 * This is the whole of reference-v9's correction. Rotation rather than a shuffle
 * because rotation is EXACT - over any whole multiple of the seat count every
 * suit sits in every chair the same number of times, where a shuffle would only
 * get there in the limit and would leave a residual confound at the sizes this
 * harness actually runs.
 *
 * It also keeps the seat-to-seat relationships varied: at 3 seats, wheat is
 * upstream of vegetable in one rotation and downstream in another, which matters
 * for a game whose central mechanism is visiting the neighbour.
 */
export function seatingFor(cell: Cell, index: number): Suit[] {
  const n = cell.suits.length;
  const shift = ((index % n) + n) % n;
  return cell.suits.map((_, i) => cell.suits[(i + shift) % n] as Suit);
}

/**
 * Games per cell at this seat count: the target rounded UP so every cell gets
 * the same number, and up again to a whole multiple of `seats`.
 *
 * Rounding up rather than down keeps the stratification exact at the cost of a
 * few extra games, and an uneven cell would quietly weight one suit matchup
 * above another in every pooled number in the report.
 *
 * The second rounding is reference-v9's, and it is the same argument applied to
 * the rotation: 500 games over 30 cells at 2 seats is 17 a cell, and 17 is odd,
 * so one seating would get 9 games and the other 8. That is a 6% weighting on
 * exactly the axis the rotation exists to balance. Rounding 17 to 18 costs 30
 * extra games out of 510 and makes the balance exact.
 */
export function gamesPerCell(target: number, cellCount: number, seats: number): number {
  const perCell = Math.max(1, Math.ceil(target / cellCount));
  return Math.ceil(perCell / seats) * seats;
}
