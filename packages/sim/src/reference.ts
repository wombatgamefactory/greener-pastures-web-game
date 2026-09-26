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
 *      a turn order nobody was playing. `'start'` survived at the time as
 *      `overlays/bonus-first.overlay.json`, which was the arm that said what the
 *      error was worth.
 *
 *      ⛔ **THAT FILE IS IN `overlays/retired/` SINCE 09/09/2026 AND IS NOT
 *      RUNNABLE**, because `'start'` became the DEFAULT with the commons (C2,
 *      and Dean's reversal of the 03/09/2026 ruling) - an overlay whose one
 *      number is the shipped value is not an arm. The paired control now points
 *      the other way and is `overlays/commons-bonus-last.overlay.json`
 *      (`bonusTiming: 'end'`). Read `overlays/retired/README.md` before moving
 *      anything back out of that folder.
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

/**
 * `reference-v13` - the meeple ECONOMY as the shipped game (Dean, 05/09/2026).
 *
 * The rules moved, the sample did not. Sampling plan, bots, evaluator and
 * stratification are `reference-v12`'s unchanged; four knobs in
 * `rules.turn` flipped together and they are one design, R15 plus R17, ruled in
 * as measured:
 *
 *  - `meepleAsCard` **true**: a meeple of a colour pays wherever a card of that
 *    colour would - build costs including the n-of-suit requirements and the
 *    2-own-suit Power/Endgame cost, a Grow's activation payment, a delivery
 *    crate. Not a Sow, not a balloon move (C62).
 *  - `meepleAsCardGoesTo` **'board'**: and this is the one that matters. The
 *    meeple is PLACED on another player's Notice Board rather than boxed, and
 *    the host collects it. It buys the payer nothing else.
 *  - `slotToll` **1**: a slot is priced, not blocked.
 *  - `meepleCapPerColour` **2**: and this one arrived as a passenger. Dean ruled
 *    the cap at ONE on 04/09/2026 against its own sweep, on teach simplicity;
 *    the amended R4 was built into the handoff v2 arm, carried into R17 and
 *    ruled in with it. Nobody re-argued the teach cost.
 *
 * ⛔ **NO reference-v12 NUMBER SURVIVES THIS BOUNDARY**, and the reason is not
 * the sample - it is that a meeple now has two uses and the pool recirculates,
 * so half the metric set is measuring a different quantity under the same name.
 * `meepleBoxed` in particular has seven sources and no longer means "the cap
 * refused one".
 *
 * WHAT IT WAS RULED IN ON, stated with its costs, because a reference that
 * flatters its own rules is worse than none. Measured at n=1580 per seat count
 * with mirrors, 4820 games an arm, on pinned `reference-v11` seeds against both
 * the v1 loop and the box arm: the bonus slot came level. The rival visit takes
 * **30.9%** of turns and the largest solitaire line **31.9%**, a gap of ONE
 * point where v31 read +27.0, the v1 loop +20.9 and the box arm +75.5. The hook
 * recovered 0.09 to **0.31**, the door mix PASSED at its most even ever
 * (29/29/23/12/8), and the game got SHORTER, 3p 35.4 to 26.5 rounds. ⚠️ Against
 * that: 2-player blocked-want tripled to **7.7%** (C65, which reopens C57), the
 * barn glut DOUBLED to **+1.0** and is the first movement in that number across
 * four arms (C66), and the suite runs **2.6x slower**.
 *
 * ⚠️ **THE BOTS WERE NOT RE-TUNED, AGAIN, AND R17 ADDED A DECISION THEY CANNOT
 * SEE.** `meepleGain` and `MEEPLE_LATENT` are still set by argument (C50), and
 * on top of them `MEEPLE_AS_CARD_DOOR_PREMIUM` ships at 0, so a meeple whose
 * door is live prices the same as one whose door is dead. Worse for R17
 * specifically: a placement prices at ZERO to the receiver and the same to the
 * payer whichever host gets it, so **no bot has ever chosen to feed the player
 * who is behind, or refused to feed the leader** (C64). At a table that choice
 * is the whole of R17's new decision, and this instrument is blind to it.
 *
 * The controls, and there are now three rather than one:
 * `overlays/meeple-as-card-v1.overlay.json` is R17's own control (the same
 * rules with the box as the destination), `overlays/meeple-loop-v1.overlay.json`
 * is the loop before R15, and `overlays/v31-card-visit.overlay.json` is still
 * the v31 game and now pins four knobs rather than one.
 */
export const REFERENCE_V13: ReferenceConfig = {
  ...REFERENCE_V12,
  id: 'reference-v13',
  description:
    'The meeple ECONOMY as the shipped game (Dean, 05/09/2026). Sampling plan identical to ' +
    'reference-v9 through v12 - mixed scored profiles one per seat from the run seed, suits ' +
    'stratified through every legal (player suits + neutral deck) combination and rotated ' +
    'around the table by game index, 2/3/4 seats. FOUR KNOBS MOVED TOGETHER AS ONE DESIGN, ' +
    'R15 plus R17: a meeple of a colour PAYS wherever a card of that colour would ' +
    '(meepleAsCard true) - build costs, a Grow activation, a delivery crate, but never a Sow ' +
    "and never a balloon move; a meeple spent that way is PLACED ON ANOTHER PLAYER'S NOTICE " +
    'BOARD rather than boxed (meepleAsCardGoesTo board), in its own colour slot, and the host ' +
    'collects it, and it buys the payer NOTHING else - no door, not a visit, the bonus slot ' +
    'untouched; the whole payment goes to ONE chosen host and landing on an occupied slot costs ' +
    'one FLAT extra meeple to the box; a Notice Board slot is PRICED rather than blocked ' +
    '(slotToll 1); and the supply cap is TWO per colour (meepleCapPerColour 2), which arrived ' +
    "as a passenger and overturned Dean's teach-simplicity ruling of 04/09/2026 without " +
    'anybody re-arguing it. A meeple paid into a Grow places nothing, so it can activate a ' +
    'building already at its threshold: a priced clog bypass, deliberate. WHAT IT WAS RULED IN ' +
    'ON: the bonus slot came LEVEL, rival visit 30.9% of turns against the largest solitaire ' +
    'line 31.9%, where every previous version sat 21 to 75 points apart; the hook recovered to ' +
    '0.31; the door mix PASSED at 29/29/23/12/8; and the game got SHORTER. WHAT IT COST: ' +
    '2-player blocked-want tripled to 7.7%, the barn glut doubled to +1.0, and the suite runs ' +
    "2.6x slower. The bots were NOT re-tuned and are blind to R17's own new decision - who to " +
    'feed - because a placement prices at zero to the receiver. Three controls: ' +
    'overlays/meeple-as-card-v1.overlay.json (R17 with the box), ' +
    'overlays/meeple-loop-v1.overlay.json (the loop before R15) and ' +
    'overlays/v31-card-visit.overlay.json (the v31 game). ' +
    'NO NUMBER IN ANY reference-v12 OR EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v13',
};

/**
 * `reference-v14` - the meeple economy WITHOUT A SUPPLY CAP (Dean, 05/09/2026).
 *
 * One knob against `reference-v13`: `rules.turn.meepleCapPerColour` **2 to
 * null**, which is no cap at all. *"Let's just remove the cap completely -
 * there is no limit to how many or what colour meeple you can hold."*
 *
 * ⛔ **IT IS A RE-CUT AND NOT A SWEEP, because it is the shipped rule.** The
 * cap moved three times in two days and the middle move was an accident: Dean
 * ruled ONE on 04/09 on teach simplicity, the amended R4 put TWO inside the
 * handoff v2 arm as a processing bound, R17 was ruled in as measured on 05/09
 * and the two shipped as a passenger, and Dean removed the cap outright the same
 * day once that was pointed out.
 *
 * WHAT IT MEASURED, paired at n=4820 against v13's own baseline
 * (`reports/watchlist-2026-09-05T15-14-10-reference-v13-meeple-no-cap-v1.txt`):
 *
 *  - ⭐ **The bonus mix CROSSED THE LINE.** Rival visit **31.3%** of turns
 *    against the empty-board Collect's **31.1%**, so assertion 17 goes FAIL to
 *    PASS and the verdict reads **2 PASS / 3 FAIL / 8 OBSERVE**. ⚠️ **Read it
 *    honestly: 0.2 points is not a win, it is level**, and v13 had no noise
 *    floor to say otherwise. The design's own solitaire option is still taking
 *    as many turns as its hook.
 *  - **Everything else held**: hook 0.31, door mix PASS at 29/28/23/12/8, barn
 *    glut +1.0 FAIL, actions per turn 1.31, game length unchanged.
 *  - **The suite got FASTER**, 220.3s against 266.7s.
 *  - ⭐ **THE ANTI-PILE FEAR IS DEAD, MEASURED.** With no cap at all the largest
 *    supply any seat reached over twelve 4-seat games was NINE meeples in total,
 *    never more than THREE of one colour, and the median supply in the last
 *    third is still 1.0. **The cap of two was sitting just above what players
 *    actually accumulate**, which is why removing it changed so little.
 *
 * ⚠️ **THE ONE COST, AND IT IS AN INSTRUMENT COST RATHER THAN A DESIGN ONE.**
 * The worst single position at four seats went from 7,586 legal moves to
 * **888,030**, and it is NOT the meeple payments: it is the end-of-turn hand
 * limit. A seat reached 27 cards and the discard task enumerates C(27, 20).
 * Meeples paying for builds means cards stop leaving the hand, so hands grow and
 * `subsets(hand, excess)` in `tasks.ts` is where it lands. Median, p95 and p99
 * branching are unchanged, so it is a rare and very expensive tail rather than a
 * general slowdown - which is why the wall clock still fell. **If the suite ever
 * needs speed again, that discard is the first place to look, and it is a
 * pre-existing shape rather than anything the cap did.**
 *
 * ⛔ **NO NOISE FLOOR HAS BEEN MEASURED FOR v13 OR v14.** Until
 * `npm run sim -- --noise --n=1580` has been run there is no published threshold
 * below which a delta is not a result, and the 0.2-point bonus-mix gap above is
 * exactly the size of reading that needs one.
 */
export const REFERENCE_V14: ReferenceConfig = {
  ...REFERENCE_V13,
  id: 'reference-v14',
  description:
    'The meeple economy with NO SUPPLY CAP (Dean, 05/09/2026). One knob against reference-v13: ' +
    'rules.turn.meepleCapPerColour 2 to null, so a seat may hold any number of meeples of any ' +
    'colour and nothing it gains is ever refused. The only things that remove a meeple from the ' +
    'game are the two tolls. Everything else is reference-v13: a meeple of a colour pays wherever ' +
    "a card of that colour would, a meeple spent that way is placed on ONE chosen neighbour's " +
    'Notice Board rather than boxed, a slot is priced rather than blocked, and the bonus slot is ' +
    'Visit or Collect. WHAT THE CAP REMOVAL MEASURED: the bonus mix CROSSED THE LINE (rival visit ' +
    '31.3% of turns against the empty-board Collect 31.1%), so the verdict reads 2 PASS / 3 FAIL / ' +
    '8 OBSERVE; the hook (0.31), the door mix (29/28/23/12/8), the barn glut (+1.0), actions per ' +
    'turn (1.31) and game length all held; and the suite got FASTER on the same seeds, 220.3s ' +
    'against 266.7s. ⚠️ This instrument own baseline reads 342.6s on its own seeds ' +
    '(reports/watchlist-2026-09-05T15-25-25-reference-v14.txt), and the 1.56x between two runs of ' +
    'the SAME rules is the machine rather than the game: quote the range, 3.7 to 5.7 minutes. ' +
    '⚠️ 0.2 points is LEVEL, not a win, and there is no noise floor to say otherwise. ' +
    '⭐ The anti-pile fear is dead: with no cap the largest supply any seat reached was nine ' +
    'meeples in total and never more than three of one colour, so the cap of two sat just above ' +
    'what players actually accumulate. ⚠️ The one cost is an instrument cost: the worst position ' +
    'at four seats went 7,586 to 888,030 legal moves, and it is the END-OF-TURN DISCARD - a hand ' +
    'of 27 choosing which 20 to throw - because meeples paying for builds stop cards leaving the ' +
    'hand. Median, p95 and p99 branching are unchanged. ' +
    'NO NUMBER IN ANY reference-v13 OR EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v14',
};

/**
 * `reference-v15` - **THE COMMONS** (Dean, 09/09/2026), and the largest re-cut
 * since v31 deleted the currency.
 *
 * ⛔ **NO NUMBER IN ANY `reference-v14` OR EARLIER REPORT IS COMPARABLE WITH A
 * `reference-v15` ONE.** Not the hook, not the bonus mix, not the door mix, not
 * the barn glut, not a suit win rate, not a per-card economic. This is not a
 * sampling change and not an evaluator change: the RULES moved, the bonus slot
 * moved, a whole component left the game and two watch-list assertions changed
 * what they are counting. The sampling plan is, as always, the one thing held
 * still.
 *
 * ## What the game is now (C1-C10 of the handoff, all ruled by Dean on 09/09/2026)
 *
 *  - **C1. Five central Notice Boards.** W3, V3, O3, A3 and D3 stand in the
 *    CENTRE of the table, all five regardless of which suits are in play, each
 *    with a face-up public pile. **No player has a Notice Board**: a farm is a
 *    Farmstead and a Barn.
 *  - **C2. Bonus FIRST, then the main action.** `rules.turn.bonusTiming` is
 *    `'start'`. ⚠️ **THIS REVERSES THE RULING OF 03/09/2026** - "the bonus comes
 *    last, and that is a correction" - on Dean's own call, and his reason is that
 *    a turn visibly ends on its main action. `'end'` is the paired control at
 *    `overlays/commons-bonus-last.overlay.json`. Do not quote the 03/09 ruling
 *    forward: `reference-v11` was cut FOR it and `reference-v15` is cut against
 *    it, and both are correct about their own game.
 *  - **C3. The bonus is one card onto one central board**, and you take that
 *    board's action: wheat Harvest, vegetable Deliver, orchard **Draw 2** (Dean
 *    chose 2 over 3; `overlays/commons-draw-three.overlay.json` is the arm),
 *    apiary **GROW**, dairy Build. Any card, no colour matching, and the fee is
 *    extra in every case.
 *  - **C4. A central board has no threshold.** Any number of cards, never full,
 *    never clogged. **Nothing in the game refuses a play**, which is what takes
 *    the subject away from a04 and a05.
 *  - **C5. Harvest takes one of your full buildings OR the whole pile from any
 *    central board**, into your barn - main action or bought through W3,
 *    including a board you fed this very turn.
 *  - **C6. No meeples anywhere.** No starting meeples, no meeple on the island's
 *    3 VP space, no spend, no Collect, no supply. a15 has no subject.
 *  - **C7. Hand limit 7, as an INSTRUMENT BOUND AND NOT A RULE.** ⭐ The table
 *    plays with NO hand limit and found that positive; the simulator cannot
 *    enumerate an unbounded hand (see CLAUDE.md section 2.3, and the 888,030-move
 *    position `reference-v14` measured), so the engine keeps 7 and **every report
 *    header says it is the simulator's bound**. Any reading about hand size under
 *    this instrument is a reading about the instrument.
 *  - **C8. The four visit-keyed cards.** O16 and A17 fire on a central play;
 *    W17 The Pie Shop has no host and is DEAD in this game; A Helping Hand
 *    becomes a second play; A16 does not fire (a play is not a placement on a
 *    building); A21 counts the tableau only.
 *  - **C9. The slot holds ONE option.** No free Draw 1, no Collect, no
 *    self-visit. An unspent slot is a turn that chose not to pay.
 *  - **C10. Two fallback knobs, both OFF**: `rules.economy.commonsThreshold`
 *    (null) and `rules.economy.commonsColourMatch` (false), so that if the bonus
 *    reads automatic the cap is one number away.
 *
 * ## What moved in the instrument, and it is why this is a re-cut
 *
 *  - **a08-the-hook has NO SUBJECT.** The boards are ownerless, so there is no
 *    neighbour to visit and the quantity the assertion counts cannot occur.
 *  - **a18-commons-traffic is NEW** and carries the interaction readings, with no
 *    fail condition in this pass.
 *  - **a17-bonus-mix carries a BAND rather than the solitaire law**: Dean's
 *    30%-60% play rate, "earned, not automatic". It is the first threshold in the
 *    suite set by the designer rather than restated from a design sentence.
 *  - **a04, a05, a15 and a02 report NO SUBJECT.** a07 and a16 count a play as a
 *    bought door (D4) and their arithmetic is untouched.
 *
 * ⛔ **NO NOISE FLOOR EXISTS FOR THIS INSTRUMENT.** None has existed since
 * `reference-v12`, and the floor is a function of the instrument, so nothing
 * carries across. `npm run sim -- --noise --n=1580` is step 6 of the handoff's
 * own measurement plan and has NOT been run. Until it has, **no delta under this
 * reference is formally readable** - which matters here more than usual, because
 * the pass's headline reading is a play rate against a 30-point band and its
 * second reading is a barn-source share, and both are the size of thing a floor
 * exists to adjudicate.
 *
 * The three controls, each pinning its own knobs so that ruling this arm in did
 * not rule its passengers in with it (the 05/09/2026 lesson):
 * `overlays/v31-card-visit.overlay.json` (the v31 card game),
 * `overlays/meeple-loop-v1.overlay.json` (the loop of 04/09/2026) and
 * `overlays/meeple-economy-v1.overlay.json` (the `reference-v14` game, new on
 * 09/09/2026 because the shipped default is no longer that game).
 */
export const REFERENCE_V15: ReferenceConfig = {
  ...REFERENCE_V14,
  id: 'reference-v15',
  description:
    'THE COMMONS (Dean, 09/09/2026). The five Notice Boards stand OWNERLESS in the centre of ' +
    'the table, all five whatever suits are in play, each with a public face-up pile (C1); no ' +
    'player has a board. The bonus slot holds ONE option (C9) and it comes FIRST, before the ' +
    'main action (C2, which REVERSES the ruling of 03/09/2026 on Dean’s own call): play one ' +
    'card from your hand onto one central board and take that board’s action - wheat ' +
    'Harvest, vegetable Deliver, orchard Draw 2, apiary GROW, dairy Build - any card, no ' +
    'colour matching, fee extra (C3). A central board has NO THRESHOLD and can never clog, so ' +
    'nothing in the game refuses a play (C4). A Harvest takes one of your full buildings OR the ' +
    'whole pile from any central board into your barn, including a board you fed this turn ' +
    '(C5). THERE ARE NO MEEPLES AT ALL: no starting five, no island seed, no spend, no Collect, ' +
    'no supply (C6). O16 and A17 fire on a play, W17 has no host and is dead, A Helping Hand is ' +
    'a second play, A16 does not fire and A21 counts the tableau only (C8). Two fallback knobs ' +
    'ship OFF, rules.economy.commonsThreshold (null) and rules.economy.commonsColourMatch ' +
    '(false), so the cap is one number away if the bonus reads automatic (C10). ' +
    '\u26a0\ufe0f THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME (C7): ' +
    'the table plays with no hand limit and found that positive, and the engine keeps 7 only ' +
    'because an unbounded hand cannot be enumerated. Any reading about hand size under this ' +
    'instrument is a reading about the instrument. ' +
    'WHAT MOVED IN THE SUITE: a08-the-hook has NO SUBJECT (there is no neighbour), the new ' +
    'a18-commons-traffic carries the interaction readings with no fail condition in this pass, ' +
    'a17-bonus-mix carries DEAN’S BAND instead of the solitaire law (a play rate of 30%-60% ' +
    'of turns, "earned, not automatic"), a04, a05, a15 and a02 report no subject, and a07 and ' +
    'a16 count a play as a bought door (D4) with their arithmetic untouched. ' +
    'The controls each pin their own knobs: overlays/v31-card-visit.overlay.json, ' +
    'overlays/meeple-loop-v1.overlay.json and overlays/meeple-economy-v1.overlay.json (new, ' +
    'the reference-v14 game). ' +
    '\u26d4 NO NOISE FLOOR EXISTS FOR reference-v15 - none has existed since reference-v12 and a ' +
    'floor does not carry across a re-cut; npm run sim -- --noise --n=1580 is a later step, and ' +
    'until it runs no delta under this reference is formally readable. ' +
    'NO NUMBER IN ANY reference-v14 OR EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v15',
};

/**
 * ⭐ reference-v16, cut 12/09/2026 for Dean's balloon and Village Store ruling.
 *
 * The commons of reference-v15 is unchanged. On top of it, sixteen shipped
 * leaves moved at once, and every level in the suite moves with them:
 *
 *  - THE BALLOONS GIVE ONE BONUS ACTION EACH, the plain core action of their
 *    colour, through the same `performDoorAction` a central board uses. Four
 *    balloons in the four core-action colours - wheat Harvest, orchard Draw 2,
 *    apiary GROW, dairy Build. There is NO purple balloon and NO vegetable one.
 *  - A FLIGHT COSTS ONE BARN CARD OF ANY CROP, taken as the Deliver action. It is
 *    aimed at the parity trap: a crate is 2 cards of one crop, all or nothing, so
 *    a single odd barn card was worth exactly zero, and now it buys an action.
 *  - THE AERODROME IS IN EVERY GAME, on C1's own argument that a module granting
 *    core actions should exist whatever suits are dealt.
 *  - THE VILLAGE STORE IS LIVE (A150): a mint after every delivery AND every
 *    flight, a shared supply of 5 coins a player, and both sinks.
 *  - THE BARN AND FARMSTEAD SWAP ROLES (13/09/2026, `cropScorerOnBarn`): the
 *    Barn prints the own-crop end-game scorer and the Farmstead holds the
 *    receipts. Score-neutral under the commons, proven by test, so it moves no
 *    level on its own.
 *
 * ⛔ WHAT A READER MUST NOT DO: quote a v15 level against a v16 one. The seed is
 * new, the rules are new, and a07 and a16 now count a flight as a bought door
 * (`doorUsed` with `via: 'balloon'`). The pre-flip game survives as
 * `overlays/commons-pre-balloons-v1.overlay.json`, proven by the three
 * `-commons-pre-balloons-` fixtures replaying against it byte-identically.
 */
export const REFERENCE_V16: ReferenceConfig = {
  ...REFERENCE_V15,
  id: 'reference-v16',
  description:
    'THE COMMONS WITH DEAN’S BALLOONS AND THE VILLAGE STORE (12/09/2026). Everything in ' +
    'reference-v15 stands - five ownerless central Notice Boards, the bonus first, any card onto ' +
    'any board, no threshold, no meeples - and sixteen leaves moved on top of it. THE BALLOONS ' +
    'GIVE ONE BONUS ACTION EACH: four balloons in the four core-action colours, each paying the ' +
    'plain action of its colour (wheat Harvest, orchard Draw 2, apiary GROW, dairy Build); there ' +
    'is no purple balloon and no vegetable one, because a flight IS the Deliver action and a ' +
    'Deliver balloon would self-cancel. A FLIGHT COSTS ONE BARN CARD OF ANY CROP, which makes a ' +
    'single odd barn card worth an action for the first time. THE AERODROME IS IN EVERY GAME. THE ' +
    'VILLAGE STORE IS LIVE: after every delivery and every flight you may sell spare barn cards ' +
    'for £1 each from a shared supply of 5 a player, and a coin pays a build (including the ' +
    'n-of-suit half) or a GROW (a full building a legal target). ⚠️ a07 AND a16 COUNT A ' +
    'FLIGHT AS A BOUGHT DOOR (via "balloon"), so the door mix is not comparable with v15. ' +
    '⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME ' +
    '(C7). THE BARN NOW PRINTS THE OWN-CROP END-GAME SCORER AND THE FARMSTEAD IS THE RECEIPT TRAY ' +
    '(rules.economy.cropScorerOnBarn, 13/09/2026); under the commons that swap is SCORE-NEUTRAL, so ' +
    'it moves no total. ⛔ THE NOISE FLOOR IS RE-MEASURED FOR THIS REFERENCE AND DOES NOT CARRY ' +
    'FROM v15. ' +
    'The pre-flip game is overlays/commons-pre-balloons-v1.overlay.json. NO NUMBER IN ANY ' +
    'reference-v15 OR EARLIER REPORT IS COMPARABLE.',
  seed: 'reference-v16',
};

/**
 * ⭐ reference-v17, cut 13/09/2026 when Dean ruled the commons dead and its code
 * was deleted (commits 5781679, cbad33d, f7e0cde).
 *
 * The shipped game is the two-board Notice Board visit with no host draw:
 *
 *  - `visitCurrency: 'noticeBoardPower'`: the Notice Boards are BUILDINGS on
 *    their owners' farms again, and the bonus (first, before the main action) is
 *    one card from hand onto a RIVAL's board for that board's printed power.
 *    `selfVisitAllowed` false; `noticeBoardsBySeats` {2: 2, 3: 1, 4: 1}, so every
 *    target is a person; `hostDrawOnVisit` 0.
 *  - Board threshold 3 as a harvest MINIMUM, never blocking, with the enhanced
 *    powers and `dairyGrowsBuilt: 'paidWild'`.
 *  - The one-card `plainAction` balloons, the Aerodrome in every game, and
 *    `flightMints` true.
 *  - The Village Store coin live, and `cropScorerOnBarn` true.
 *
 * ⛔ A level from `reference-v16` or earlier is not comparable: the visit, the
 * seed and half the metric subjects all changed at once. The three historical
 * controls now pin `selfVisitAllowed` and `noticeBoardsBySeats.2` as well, so
 * they still replay their own games.
 */
export const REFERENCE_V17: ReferenceConfig = {
  ...REFERENCE_V16,
  id: 'reference-v17',
  description:
    'THE TWO-BOARD NOTICE BOARD VISIT, NO HOST DRAW (Dean, 13/09/2026, when the commons was ruled ' +
    'dead and deleted). The Notice Boards are buildings on their owners’ farms; the bonus comes ' +
    'FIRST and is one card from your hand onto a RIVAL’s board for that board’s printed power ' +
    '(visitCurrency "noticeBoardPower", selfVisitAllowed false, hostDrawOnVisit 0). Boards per ' +
    'seat are 2 at two players and 1 at three and four (noticeBoardsBySeats), so every target is ' +
    'a person. A board’s threshold of 3 is a harvest minimum and never blocks; the powers are ' +
    'the enhanced set, and the Dairy board may GROW what it just built with a card of any crop ' +
    '(dairyGrowsBuilt "paidWild"). THE BALLOONS each give one plain core action for one barn ' +
    'card, the Aerodrome is in every game and a flight mints. THE VILLAGE STORE COIN IS LIVE. ' +
    'THE BARN PRINTS THE OWN-CROP SCORER (cropScorerOnBarn). ' +
    '⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME: the ' +
    'table plays with none, and any reading about hand size is a reading about the instrument. ' +
    'The historical controls, each now also pinning selfVisitAllowed and noticeBoardsBySeats.2: ' +
    'overlays/v31-card-visit.overlay.json, overlays/meeple-loop-v1.overlay.json and ' +
    'overlays/meeple-economy-v1.overlay.json. ' +
    '⛔ THE NOISE FLOOR IS RE-MEASURED FOR THIS REFERENCE (13/09/2026) AND DOES NOT CARRY FROM ' +
    'v16. NO NUMBER IN ANY reference-v16 OR EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v17',
};

/**
 * ⭐ reference-v18, cut 14/09/2026 when Dean ruled in the Apiary board's retext:
 * *"Grow a building using the top card of any deck"*, the deck card WILD
 * (`noticeBoardPower.apiaryPower: 'deckGrowWild'`). Everything else is
 * reference-v17.
 *
 * ⛔ A level from `reference-v17` is not comparable: the seed moved with the
 * rule. The v17 game survives as `overlays/notice-board-apiary-sow-v1`, and every
 * older overlay on the notice-board visit pins `apiaryPower: 'sow'` by name.
 */
export const REFERENCE_V18: ReferenceConfig = {
  ...REFERENCE_V17,
  id: 'reference-v18',
  description:
    'THE TWO-BOARD NOTICE BOARD VISIT WITH THE APIARY RETEXT (Dean, 14/09/2026). reference-v17 ' +
    'stands - the Notice Boards are buildings on their owners’ farms, the bonus comes FIRST and ' +
    'is one card from your hand onto a RIVAL’s board for its printed power, two boards a seat at ' +
    'two players and one at three and four, no host draw, the plain-action balloons, the Village ' +
    'Store and the Barn scorer - and ONE leaf moved: THE APIARY BOARD NOW READS "Grow a building ' +
    'using the top card of any deck", the deck card paying ANY activation cost (apiaryPower ' +
    '"deckGrowWild"), in place of "Sow 2 cards from your hand onto your buildings". ⚠️ THE HAND ' +
    'LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME. The v17 game is ' +
    'overlays/notice-board-apiary-sow-v1.overlay.json. ⛔ NO NUMBER IN ANY reference-v17 OR ' +
    'EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v18',
};

/**
 * ⭐ reference-v19, cut 14/09/2026 when Dean ruled in the delivery meeple, the
 * delivery space choice and the closing draw. Everything else is reference-v18.
 * Six leaves moved: `rules.turn.deliveryMeepleSpace` 1 (a random meeple on
 * every tile's 3 VP space), `meepleSpendTiming` 'afterAction', `meepleSpendPerTurn`
 * 1 (M1, M4, M5 - `meepleSpendDistinctColours` stays false, unchanged),
 * `rules.turn.deliverySpaceChoice` true (a delivery names either free space) and
 * `rules.turn.closingDrawPerCrate` 1 (the delivery that fills a tile's last
 * space draws one card per crate token from that suit's deck, a cornucopia from
 * any deck in play at the closer's choice).
 *
 * ⚠️ THE HAND LIMIT OF 7 IS STILL THE SIMULATOR'S BOUND AND NOT A RULE OF THE
 * GAME (C7, 09/09/2026): the table plays with no hand limit at all.
 *
 * ⛔ A level from `reference-v18` is not comparable: the seed moved with the
 * rule. The v18 game survives as `overlays/pre-delivery-meeple-v1.overlay.json`,
 * and every overlay and test helper on the notice-board visit that predates
 * this ruling pins the six leaves by name at their old inert values
 * (deliveryMeepleSpace null, meepleSpendTiming 'start', meepleSpendPerTurn
 * null, meepleSpendDistinctColours false, deliverySpaceChoice false,
 * closingDrawPerCrate 0). NO NUMBER IN ANY `reference-v18` OR EARLIER REPORT IS
 * COMPARABLE AS A LEVEL.
 */
export const REFERENCE_V19: ReferenceConfig = {
  ...REFERENCE_V18,
  id: 'reference-v19',
  description:
    'THE TWO-BOARD NOTICE BOARD VISIT WITH THE DELIVERY MEEPLE, THE SPACE CHOICE AND THE ' +
    'CLOSING DRAW (Dean, 14/09/2026). reference-v18 stands - the Notice Boards are buildings on ' +
    'their owners’ farms, the bonus comes FIRST and is one card from your hand onto a RIVAL’s ' +
    'board for its printed power, two boards a seat at two players and one at three and four, no ' +
    'host draw, the plain-action balloons, the Village Store, the Barn scorer and the Apiary ' +
    'retext (apiaryPower "deckGrowWild") - and THREE RULES SHIP WITH IT, SIX LEAVES IN ALL. (1) ' +
    'THE DELIVERY MEEPLE (M1-M8): a random meeple sits on every tile’s 3 VP space, claiming the ' +
    'receipt claims it, and after your main action you may discard ONE for the PLAIN action of ' +
    'its colour (deliveryMeepleSpace 1, meepleSpendTiming "afterAction", meepleSpendPerTurn 1, ' +
    'meepleSpendDistinctColours false, unchanged). (2) THE DELIVERY SPACE CHOICE ' +
    '(deliverySpaceChoice true): a delivery to a tile names EITHER free space, the 6 VP space or ' +
    'the 3 VP space with the meeple, rather than fill order. (3) THE CLOSING DRAW ' +
    '(closingDrawPerCrate 1): the delivery that fills a tile’s LAST free space draws one card per ' +
    'crate token on the tile from that token’s suit, a cornucopia from any deck in play at the ' +
    'closer’s choice. ⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME. ' +
    'The v18 game is overlays/pre-delivery-meeple-v1.overlay.json. ⛔ NO NUMBER IN ANY ' +
    'reference-v18 OR EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v19',
};

export const REFERENCE_V20: ReferenceConfig = {
  ...REFERENCE_V19,
  id: 'reference-v20',
  description:
    'THE TOKEN ISLAND AND SHEET v42 (Dean, 15-16/09/2026; ' +
    'docs/vegetable-token-island-handoff-2026-09-16-v1.md). The Notice Board visit stands - ' +
    'rival boards only, bonus first, two boards a seat at two players, no host draw - and the ' +
    'Worker (the delivery meeple) is still spent after the main action, one a turn. DELETED: the ' +
    'balloons and the Aerodrome, the Village Store coin, the closing draw and the island wild ' +
    'substitution. THE TOKEN ISLAND: two tokens a tile (a crop or wild demand, 3 to 6 VP, a ' +
    'Worker on the 3 and 4 VP tokens); a delivery is always 4 barn cards; the first pays both ' +
    'demands and chooses a token, the second pays the last demand plus 2 of any crops; receipts ' +
    'keep their crop. The Vegetable board lets 2 of the 4 cards be any crop; the Dairy board ' +
    'builds with any crops at a discount of 2 and no longer Grows. cards.json is sheet v42: the ' +
    'Vegetable barn suit, the five per-suit Helping Hands in place of the second bonus play, no ' +
    'VP on Power cards, crop-worded buildings. Whenever triggers fire every time. A random first ' +
    'player, and the round is finished at game end. ⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S ' +
    'BOUND AND NOT A RULE OF THE GAME. ⚠️ THE ENGINE FILLS SEVERAL UNRULED BUILDER DEFAULTS ' +
    '(handoff section 5). ⛔ NO NUMBER IN ANY reference-v19 OR EARLIER REPORT IS COMPARABLE AS A ' +
    'LEVEL.',
  seed: 'reference-v20',
};

/**
 * ⭐ reference-v21, cut 19/09/2026 when sheet `Isle-of-Farms-v45.xlsm` retexted
 * 13 card faces (Dean's rulings R1-R10, `tasks/v45-rulings-v1.md`). Everything
 * else is reference-v20: the token island, no balloons, no Aerodrome, no
 * Village Store coin, no closing draw, no island wild substitution, the
 * Vegetable barn suit, the five per-suit Helping Hands, a random first player,
 * the round finished at game end.
 *
 * The 13 faces, by suit:
 *
 *   - **W5 Rye Field**: Harvest reward becomes Draw 3; the sow-back line is
 *     deleted.
 *   - **W13 The Bakery**: retexted to "Harvest each of your OTHER buildings
 *     (not this one) with at least 1 card on it" (R6, R10). It no longer
 *     harvests itself, so it now clogs on its own activation fee every use -
 *     an intended brake, not a bug.
 *   - **W16 The Granary**: gains "Whenever you harvest, if you have 5 or fewer
 *     cards, Draw 1" (R7, R8). The count is the owner's HAND ONLY, taken
 *     FRESH at the moment each draw would fire, so a W13-plus-W16 cascade can
 *     stop paying part way through as the hand fills.
 *   - **A19 The Honey Hall** and **A20 The Apiarist's Guild**: each gains a
 *     "(Max 5)" cap, on the `grandGranaryCap` pattern (R9) as two SEPARATE new
 *     knobs, `rules.economy.honeyHallCap` and `rules.economy.apiaristsGuildCap`,
 *     both shipped at 5, because the three capped cards count different
 *     things.
 *   - **V6 The Trade Depot**: the trailing draw becomes Draw 2.
 *   - **V10 The Supply House**: completely retexted to "For each card in your
 *     Barn, draw 1 of that suit" (R1-R3) - the barn is only COUNTED, nothing
 *     is discarded or moved, the draw is MANDATORY and UNCAPPED.
 *   - **V11**: threshold 2 to 3, no change to its printed effect.
 *   - **V12 The Auction House**: completely retexted to "Perform the Notice
 *     Board action of any suit you have in your Barn" (R4) - FREE, no
 *     discard, the barn only names which powers are on offer; threshold 2 to
 *     3 alongside the retext.
 *   - **V13**: threshold 1 to 2, no change to its printed effect.
 *   - **V15**: threshold 1 to 2, no change to its printed effect.
 *   - **V16 The Market Signal Tower**: text tidied to "any deck card" (R5);
 *     behaviour unchanged, since it already meant the top card of a deck of
 *     your choice.
 *   - **V17 The Dockworker's Union**: completely retexted to "If, at the end
 *     of your turn, your Barn is empty, place any deck card into your Barn"
 *     (R5) - a new end-of-turn trigger (`beforeTurnEnd`), moved off the old
 *     "draw 1 whenever you discard a barn card" and off `afterBarnDiscard`,
 *     which V8 and V15 still fire.
 *
 * ⚠️ **A BOT GAP, PRE-EXISTING AND NOT A v45 REGRESSION: V12's new
 * `auctionSuit` choice is answerable but not differentiated.** The choice of
 * which suit's Notice Board power to take is a `card` task, priced only
 * through the flat `cardTask` term (`packages/bots/src/terms.ts`, feature
 * `act.a === 'cardTask' ? 1 : 0`), which is not on `isProbed` and so never
 * looks ahead to what the power itself is worth. Every legal suit therefore
 * scores identically and ties break at random, so a bot fires a weak Notice
 * Board power (say, a suit with an unusable Grow) as often as the strongest
 * one on offer. `isProbed` never covering `cardTask` is the same gap V8's and
 * V15's barn-discard crop choice already sit in. **`reference-v21` will
 * therefore UNDERSTATE V12**: any reading of its win rate, its buildings
 * count or its share of the bonus economy is a floor, not the card's true
 * value at a table where a human always names the best suit. Do not "fix" the
 * bot for this cut; the gap is recorded here so a future reader does not
 * mistake a flat V12 number for the card being weak.
 *
 * ⛔ A level from `reference-v20` is not comparable: the seed moved with the
 * sheet. NO NUMBER IN ANY `reference-v20` OR EARLIER REPORT IS COMPARABLE AS A
 * LEVEL.
 */
export const REFERENCE_V21: ReferenceConfig = {
  ...REFERENCE_V20,
  id: 'reference-v21',
  description:
    'SHEET v45: 13 CARD FACES RETEXTED (Dean, 19/09/2026; tasks/v45-rulings-v1.md, R1-R10; ' +
    'cards.json re-extracted off Isle-of-Farms-v45.xlsm). reference-v20 stands - the token ' +
    'island, no balloons, no Aerodrome, no Village Store coin, no closing draw, no island wild ' +
    'substitution, the Vegetable barn suit, the five per-suit Helping Hands, a random first ' +
    'player, the round finished at game end - and THIRTEEN FACES MOVE. W5 Rye Field: Harvest is ' +
    'Draw 3, the sow-back line is gone. W13 The Bakery: Harvests every OTHER building of yours ' +
    'with at least 1 card, so it no longer scoops its own fee and now clogs on its own ' +
    'activation every use. W16 The Granary: Whenever you harvest, if your HAND is 5 or fewer, ' +
    'Draw 1, checked fresh each time, so a harvest cascade can stop paying part way through. A19 ' +
    'The Honey Hall and A20 The Apiarist’s Guild: each capped at 5 (honeyHallCap, ' +
    'apiaristsGuildCap, both shipped at 5). V6 The Trade Depot: the trailing draw is Draw 2. V10 ' +
    'The Supply House: For each card in your Barn, draw 1 of that suit - mandatory, uncapped, ' +
    'nothing leaves the barn. V11, V13, V15: threshold only, 2 to 3 / 1 to 2 / 1 to 2. V12 The ' +
    'Auction House: Perform the Notice Board action of any suit you have in your Barn, FREE, no ' +
    'discard, threshold 2 to 3. V16: text tidied to "any deck card", behaviour unchanged. V17 ' +
    'The Dockworker’s Union: If, at the end of your turn, your Barn is empty, place any deck ' +
    'card into your Barn - a new end-of-turn trigger. ⚠️ V12’S AUCTIONSUIT CHOICE IS PRICED FLAT ' +
    '(cardTask, not on isProbed) SO THIS INSTRUMENT UNDERSTATES V12: see the block comment above ' +
    'this config. ⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME. ' +
    '⛔ NO NUMBER IN ANY reference-v20 OR EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v21',
};

/**
 * ⭐ reference-v22, cut 20/09/2026 when sheet `Isle-of-Farms-v46.xlsm` retexted
 * seven card faces (Dean's rulings R1-R11, `tasks/v46-rulings-v1.md`).
 * Everything else is reference-v21: the token island, no balloons, no
 * Aerodrome, no Village Store coin, no closing draw, no island wild
 * substitution, the Vegetable barn suit, the five per-suit Helping Hands, a
 * random first player, the round finished at game end, and the thirteen v45
 * retexts (W5, W13, W16, A19, A20, V6's trailing draw, V10, V11's threshold,
 * V12, V13's threshold, V15's threshold, V16, V17) all stand.
 *
 * The seven faces, by suit:
 *
 *   - **A13 The Queen's Hive**: wording only, "if you have BUILT 3 or more
 *     Apiary buildings". A confirmed no-op (R11.1) - the engine already
 *     counted built buildings only.
 *   - **A18 Helping Hand**: retexted from "sow a deck card onto another of
 *     your buildings" to "sow a deck card into your Barn" (R8, R9). Despite
 *     the word "sow" on the face, it is NOT a sow: a plain placement of the
 *     top card of a deck of your choice into your own barn, on the same
 *     primitive as V16 and A13. It fills nothing, emits no `cardPlaced`, and
 *     cannot re-trigger itself. The old "another building with room" gate is
 *     gone, so the only remaining condition is the fill.
 *   - **V6 The Trade Depot**: retexted from "Swap up to 2 cards between your
 *     hand and your Barn, then Draw 2" to "Swap 2 cards between your Barn and
 *     any Deck, then Draw 2" (R5-R7). The two outgoing barn cards go to their
 *     own crops' discard piles; the two incoming cards are deck tops, chosen
 *     freely per card with no pairing to what left. ALL OR NOTHING: fewer
 *     than 2 barn cards, or a table that cannot supply 2, means nothing swaps
 *     AND the trailing Draw 2 does not fire either.
 *   - **V11 The Market Master**: THE BIGGEST CHANGE IN THE PASS. Retexted
 *     from "For every card in your Barn, move a card of the same crop from
 *     any of your buildings into your Barn" to "For each suit in your Barn,
 *     Harvest a card of that crop" (R1-R4). This is a REAL Harvest of a whole
 *     building, routed through the ordinary Harvest primitive: for each
 *     DISTINCT suit in the barn (snapshotted ONCE at activation, so at most
 *     five and never extended by cards the cascade itself deposits) it
 *     harvests one full building of that printed crop, firing `afterHarvest`,
 *     W16 The Granary and W18 A Helping Hand. Only FULL buildings are legal
 *     targets; the owner's own Notice Boards are in scope at 3+ cards and
 *     never taken below 3. It is MANDATORY - no "may" on the face - and can
 *     dismantle its own owner's farm against their will. Dean was shown the
 *     consequence and chose it deliberately; it is not softened here.
 *   - **V15 The International Port**: build cost drops from 3 suit + 1 wild
 *     to 2 suit + 1 wild. Data only (R11.2).
 *   - **V17 The Dockworker's Union**: the end-of-turn condition loosens from
 *     "your Barn is empty" (0 cards) to "your Barn has 3 or fewer cards"
 *     (R11.3), so it fires on most turns rather than rarely. Its dry-table
 *     guard is unchanged and still load-bearing (R11.4).
 *   - **V18 Helping Hand**: the barn threshold for its Draw 3 rises from "1
 *     or fewer cards" to "3 or fewer" (R10). Its fixed resolution order
 *     ahead of V16 - it judges the barn you delivered FROM, before V16's own
 *     card lands - is now a ruling on the record rather than an incidental
 *     behaviour.
 *
 * ⚠️ **THE BOTS WILL UNDERSTATE V11.** Each of its up to five harvest
 * sub-choices is priced correctly through the same `harvest` term every
 * ordinary Harvest choice uses, so nothing crashes or scores zero, but each
 * sub-choice is scored independently against the stack it moves RIGHT NOW,
 * with no look-ahead within the cascade and no visibility of the downstream
 * triggers it feeds - W16's fresh-hand gate, W18's harvest count. The bots do
 * not reason about the compounding at all, so any reading of V11's value,
 * its buildings count or its share of the bonus economy is a floor on what a
 * human playing the cascade deliberately would get from it.
 *
 * ⚠️ **A18's CHOICE IS ANSWERABLE BUT NOT DIFFERENTIATED.** Its answers
 * collapse into the catch-all `cardTask` act, which is not on `isProbed` in
 * `packages/bots/src/terms.ts`, so any non-skip answer beats skip by a flat
 * +2 with no read of the position and no way to prefer one drawable suit over
 * another. This is pre-existing architecture, shared with V8, V12 and V15's
 * crop choices, and is not introduced by this pass - recorded here so a flat
 * A18 number is not mistaken for the card being weak.
 *
 * ⛔ A level from `reference-v21` is not comparable: the seed moves with the
 * sheet. NO NUMBER IN ANY `reference-v21` OR EARLIER REPORT IS COMPARABLE AS A
 * LEVEL.
 */
export const REFERENCE_V22: ReferenceConfig = {
  ...REFERENCE_V21,
  id: 'reference-v22',
  description:
    'SHEET v46: SEVEN CARD FACES RETEXTED (Dean, 20/09/2026; tasks/v46-rulings-v1.md, R1-R11; ' +
    'cards.json re-extracted off Isle-of-Farms-v46.xlsm). reference-v21 stands - the token ' +
    'island, no balloons, no Aerodrome, no Village Store coin, no closing draw, no island wild ' +
    'substitution, the Vegetable barn suit, the five per-suit Helping Hands, a random first ' +
    'player, the round finished at game end, and the thirteen v45 retexts - and SEVEN FACES ' +
    'MOVE. A13 The Queen’s Hive: wording only, a confirmed no-op. A18 Helping Hand: sow a deck ' +
    'card into your Barn, NOT a sow, a plain placement that fills nothing and cannot ' +
    're-trigger itself; the old building-with-room gate is gone. V6 The Trade Depot: Swap 2 ' +
    'cards between your Barn and any Deck, then Draw 2 - barn cards to their own discard piles, ' +
    'deck tops in, freely chosen; ALL OR NOTHING, so under 2 barn cards or an empty table kills ' +
    'the swap AND the trailing Draw 2. V11 The Market Master, THE BIGGEST CHANGE IN THE PASS: ' +
    'For each suit in your Barn, Harvest a card of that crop - a REAL Harvest of a whole full ' +
    'building per distinct suit, snapshotted once at activation (max five), firing ' +
    'afterHarvest/W16/W18, MANDATORY, able to dismantle its own owner’s farm. V15 The ' +
    'International Port: build cost 3 suit + 1 wild to 2 suit + 1 wild, data only. V17 The ' +
    'Dockworker’s Union: end-of-turn trigger loosens from Barn empty to Barn 3 or fewer cards, ' +
    'so it fires most turns; the dry-table guard stands. V18 Helping Hand: Draw 3 threshold ' +
    'rises from Barn 1 or fewer to 3 or fewer, resolving before V16 by a fixed order. ⚠️ THE ' +
    'BOTS UNDERSTATE V11: each harvest sub-choice is priced with no look-ahead within the ' +
    'cascade and no visibility of W16/W18 downstream, so its reading is a floor. ⚠️ A18’S ' +
    'CHOICE IS PRICED FLAT (cardTask, not on isProbed) SO ANY ANSWER BEATS SKIP BY A FLAT +2 ' +
    'WITH NO READ OF THE POSITION - pre-existing, shared with V8/V12/V15, not new to this pass. ' +
    '⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME. ⛔ NO NUMBER IN ' +
    'ANY reference-v21 OR EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v22',
};

/**
 * ⭐ reference-v23, cut 22/09/2026 when sheet `Isle-of-Farms-v47.xlsm` retexted
 * fifteen card faces, ability text only (no cost, threshold, VP, trigger or
 * suit field moved), ruled R1-R5 in `tasks/v47-rulings-v1.md`. Everything else
 * is reference-v22: the token island, no balloons, no Aerodrome, no Village
 * Store coin, no closing draw, no island wild substitution, the Vegetable barn
 * suit, the five per-suit Helping Hands, a random first player, the round
 * finished at game end, the thirteen v45 retexts and the seven v46 retexts
 * (A13, A18, V6's swap-with-any-deck, V11's real Harvest cascade, V15, V17,
 * V18) all stand.
 *
 * The fifteen faces, by suit:
 *
 *   - **A8 The Wild Hive**: the sow onto a neighbour's building drops from 2
 *     cards to 1 (`remaining: 1`); the trailing 2 cards into your Barn is
 *     unchanged. R2: the 19/09/2026 gate survives the retext - if no
 *     neighbour building can take the sow, no barn cards are placed either.
 *   - **A9 The Pollinator Trail**: retexted from "Sow 1 deck card on up to 2
 *     of your other buildings" to "Sow 1 deck card onto another of your
 *     buildings, then Draw 1" - one mandatory sow (down from up-to-2), plus
 *     an unconditional Draw 1 that fires whether or not the sow could happen
 *     (R1).
 *   - **D5 The Churning Shed**: retexted from sowing every spent card onto
 *     the new building (even past threshold) to sowing exactly 1 of the
 *     spent cards, an ordinary `placeFromDiscard` with no threshold
 *     exception.
 *   - **D6 The Trading Shed**: retexted from "give 1 spent card to a
 *     neighbour, Draw 1" to "you and one neighbour each Draw 1" - the give
 *     machinery is gone; both draws fire whether or not the Build could
 *     happen (R1), each drawer choosing their own deck.
 *   - **D10 The Scout's Post**: retexted from revealing the top card of EACH
 *     deck to revealing the top card of ONE chosen deck, buildable at a
 *     discount of 2. **R3, against the audit's recommendation: a declined or
 *     unaffordable reveal is DISCARDED**, not returned to its deck - D10 now
 *     burns a deck top on every scout that does not build.
 *   - **D11 The Heritage House**: retexted from sowing every spent card to
 *     "Draw 1 for each card you spent" - a straight `drawN(payment.length)`.
 *   - **D15 The Grand Creamery**: retexted from reveal-2-build-1-discard-1 to
 *     "Build a card from your hand for free" - a `buildWith` at the
 *     `FREE_BUILD_DISCOUNT` (99), which zeroes the n-of-suit requirement as
 *     well as the cost.
 *   - **O9 The Fruit Stand**: retexted from "give 1 card to each neighbour,
 *     Draw 2 for each" to "give another player 1 card, then Draw 4" - one
 *     mandatory give whose resolve pushes the Draw 4, so **no give means no
 *     draw** (R1). Engine-only caveat: the simulator's hand bound can refuse
 *     a give a table would allow, so O9 is slightly understated here.
 *   - **O13 The Seed Bank**: retexted from "GROW up to 2 of your other
 *     buildings, using any suit" (hand-paid) to "GROW 2 of your other
 *     buildings, each with the top card of any deck" - a mandatory,
 *     deck-paid re-entrant Grow (`remaining: 2` over `deckGrowOptions`, the
 *     Apiary board primitive), no skip.
 *   - **O15 The Garden Library**: the draw-the-top-of-each-deck half is
 *     unchanged; the old "give to every other player, Draw 1 per card given"
 *     becomes a single mandatory give of any hand card to one neighbour, no
 *     refund.
 *   - **V5 The Coastal Trading Depot**: retexted from the demand-token swap
 *     to "Deliver. 1 of the cards may be any crop" - a bare `deliver` call
 *     with `wildCards: 1`; the token-swap path is orphaned, not deleted
 *     (R1's housekeeping note).
 *   - **V6 The Trade Depot**: retexted from "swap up to 2 cards between your
 *     hand and your Barn, then Draw 2" to "swap 2 cards between your Barn and
 *     any Deck, then Draw 2" - the v46 retext's wording tightened to the
 *     sheet's own (typo'd) phrasing, no behaviour change. **R4: reference-v22's
 *     R6 stands in full** - a Barn under 2 cards means nothing swaps and the
 *     trailing Draw 2 does not fire either; order is barn discards first
 *     (each to its own crop's pile), then 2 deck tops in (freely chosen per
 *     card), then Draw 2.
 *   - **W8 Heritage Field**: the When-Harvested trigger drops "even if not
 *     full" - it now only harvests another FULL building of yours
 *     (`filter: 'full'`).
 *   - **W9 Mill House**: retexted from "up to 3 of your buildings that are
 *     empty" to "each of your empty buildings (max 3)" - the sow is now
 *     mandatory over every empty building up to 3, not optional.
 *   - **W14 The Pizzeria**: retexted from an opt-in draw-matching round to
 *     "every other player Draws 1, then Draw 4" (owner's draw). **R5: the
 *     owner's Draw 4 is queued FIRST**, then each other player draws 1 in
 *     seat order - off the printed order, chosen so the bots' look-ahead
 *     (which stops at a rival's task) can see and price the Draw 4.
 *
 * ⚠️ **MEASUREMENT CAVEATS CARRIED FROM T5, for T7's report.** O9 is
 * understated (the sim hand bound can refuse a give a table allows, R1's own
 * caveat, same shape as `reference-v22`'s A17/O16 gifting gap). A9 and W9 are
 * now mandatory deck-sows whose targets the bots pick blind (the standing
 * `deckSow` gap this instrument has carried since the delivery-meeple era).
 * D10's deck choice is effectively random (the same V8/V15 gap `reference-v21`
 * already carried). O13 moved from hand-paid to deck-paid, so its cost
 * structure changed and its `reference-v22`-era pricing does not carry over.
 * W14 should be priced fairly for the first time thanks to R5's fixed order.
 *
 * ⛔ A level from `reference-v22` is not comparable: the seed moves with the
 * sheet. NO NUMBER IN ANY `reference-v22` OR EARLIER REPORT IS COMPARABLE AS A
 * LEVEL.
 */
export const REFERENCE_V23: ReferenceConfig = {
  ...REFERENCE_V22,
  id: 'reference-v23',
  description:
    'SHEET v47: FIFTEEN CARD FACES RETEXTED, ABILITY TEXT ONLY (Dean, 22/09/2026; ' +
    'tasks/v47-rulings-v1.md, R1-R5; cards.json re-extracted off Isle-of-Farms-v47.xlsm). ' +
    'reference-v22 stands - the token island, no balloons, no Aerodrome, no Village Store coin, ' +
    'no closing draw, no island wild substitution, the Vegetable barn suit, the five per-suit ' +
    'Helping Hands, a random first player, the round finished at game end, the thirteen v45 ' +
    'retexts and the seven v46 retexts - and FIFTEEN FACES MOVE. A8 The Wild Hive: sow drops ' +
    'from 2 cards to 1, the 19/09/2026 no-target gate survives. A9 The Pollinator Trail: 1 ' +
    'mandatory sow onto another building, then an unconditional Draw 1. D5 The Churning Shed: ' +
    'sows exactly 1 spent card, no threshold exception. D6 The Trading Shed: give machinery ' +
    'gone, you and one neighbour each Draw 1 regardless of whether the Build happens. D10 The ' +
    "Scout's Post: one chosen deck revealed, build at a discount of 2; A DECLINED OR " +
    'UNAFFORDABLE REVEAL IS DISCARDED (R3, against the audit recommendation). D11 The Heritage ' +
    'House: Draw 1 for each card spent, sow machinery gone. D15 The Grand Creamery: Build a ' +
    'card from your hand for free, at a discount that also waives the n-of-suit requirement. O9 ' +
    'The Fruit Stand: one mandatory give, then Draw 4 - no give means no draw. O13 The Seed ' +
    'Bank: GROW 2 of your other buildings, each deck-paid and wild, mandatory, no skip. O15 The ' +
    'Garden Library: draw-each-deck-top unchanged, the give-to-everyone half becomes one ' +
    'mandatory give to a neighbour. V5 The Coastal Trading Depot: a bare Deliver with 1 wild ' +
    'card, the token-swap path retired. V6 The Trade Depot: swap 2 cards between your Barn and ' +
    'any Deck then Draw 2, all-or-nothing under a 2-card Barn stands unchanged from ' +
    'reference-v22 (R4). W8 Heritage Field: When-Harvested now targets a FULL other building ' +
    'only. W9 Mill House: sows every empty building up to 3, mandatory. W14 The Pizzeria: the ' +
    "owner's Draw 4 resolves FIRST, then each other player Draws 1 (R5). ⚠️ O9, A9, W9 and D10 " +
    'ARE BOT-BLIND CHOICES (understated); O13 changed cost structure so its reference-v22 ' +
    'pricing does not carry over; W14 should price fairly for the first time. ⚠️ THE HAND LIMIT ' +
    "OF 7 IS THE SIMULATOR'S BOUND AND NOT A RULE OF THE GAME. ⛔ NO NUMBER IN ANY reference-v22 " +
    'OR EARLIER REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v23',
};

/**
 * ⭐ reference-v24, cut 24/09/2026 when sheet `Isle-of-Farms-v48.xlsm` (SHA-256
 * `53a973c7...`) retexted twenty card faces (22 fields), ruled in
 * `tasks/v48-rulings-v1.md` R1-R4 and `tasks/v48-rulings-v2.md` R5-R15.
 * Everything else is reference-v23 - the token island, no balloons, no
 * Aerodrome, no Village Store coin, no closing draw, no island wild
 * substitution, the Vegetable barn suit, the five per-suit Helping Hands, a
 * random first player, the round finished at game end, and the thirteen v45,
 * seven v46 and fifteen v47 retexts all stand - and TWENTY FACES MOVE, plus
 * one cross-cutting ruling.
 *
 * The twenty faces, by suit:
 *
 *   - **A7 The Beekeeper's Hut**: gains a leading Draw 2 before its existing
 *     mandatory sow onto another of your buildings.
 *   - **A8 The Wild Hive**: retexted from a neighbour-sow-plus-Barn-fill to
 *     "Deliver, using cards from your Barn and cards on full buildings" - a
 *     new `wildDeliver` two-step task pooling the Barn with cards on full
 *     buildings (a Notice Board included, at 3+), each card's source chosen
 *     only where a real choice exists.
 *   - **A9 The Pollinator Trail**: its trailing draw rises from Draw 1 to
 *     Draw 2; the mandatory sow onto another building is unchanged.
 *   - **A10 The Queen's Escort**: retexted from a neighbour-sow-plus-Draw-3 to
 *     "Visit another player's Notice Board, using a deck card" - a new
 *     deck-paid card visit (`doCardVisit`) that never touches `bonusUsed` or
 *     the once-per-board latch (R9), so it stacks with the ordinary bonus
 *     visit.
 *   - **A11 The Bee Yard**: retexted from "put 1 card from each of your full
 *     buildings into your Barn" (threshold 2) to "Harvest another of your
 *     buildings with 2 or more cards on it, even if it is not full"
 *     (threshold 3) - a real Harvest at a relaxed minimum of 2, never itself.
 *   - **A13 The Queen's Hive**: the "3 or more Apiary buildings" gate is
 *     dropped; it now places 3 deck cards into the Barn unconditionally.
 *   - **A14 The Hive Mind**: retexted from "Draw 1 per Apiary building, max 5"
 *     to "GROW up to 3 of your full buildings (not the Notice Board), without
 *     placing a card" - a new re-entrant, live-rechecked Grow with no card
 *     placed, skippable each round.
 *   - **A15 The Swarm Call**: retexted from "Draw 1 per building with a card
 *     on it" (threshold 1) to "Discard a crop card from your hand and
 *     activate that card's ability" (threshold 3) - a new engine shape, Tier
 *     cards only, that activates the discarded card AS ITSELF; the D5/D7/D11
 *     listener trap (their second halves are `afterBuild` listeners) is
 *     solved inside A15 by forwarding the trigger when the source card sits
 *     on no farm.
 *   - **A19 The Hive Council**: retexted from "1 VP per non-Apiary building
 *     built (max 5)" to "2 VP per tractor building built (max 6 VP)". Ruled
 *     24/09/2026: a tractor building is any POWER card, of any suit (the
 *     printed tractor icon, e.g. A16-A18).
 *   - **D6 The Trading Shed**: retexted from "Build, you and one neighbour
 *     each Draw 1" to "If you have fewer than 5 cards in hand, Draw 1 for
 *     each building you have built" - no Build, no crossing the table, a
 *     hand-gated count draw.
 *   - **D7 The Milking Parlour**: retexted from spending a building's cards
 *     as 2 wild resources to "Build. Place 1 of the cards spent into your
 *     Barn" - the D5 sowing pattern, as an `afterBuild` listener.
 *   - **D8 The Creamery**: its trailing draw rises from Draw 1 to Draw 2,
 *     queued after the Build.
 *   - **O6 The Fruit Vendor**: retexted from "Draw 2, then give 1 card to a
 *     neighbour and Draw 1" to "Draw 2, then Deliver" - the give-and-draw
 *     machinery is gone, replaced by a generic Deliver call.
 *   - **O11 The Orchard Keeper**: retexted from "Harvest one of your
 *     buildings, then Draw 1 per card harvested" to "Harvest one of your
 *     buildings, then Draw 2" - the harvest-size-scaled draw is gone.
 *   - **O12 The Fruit Press**: retexted from "put up to 4 cards from your
 *     hand into your Barn" to "Deliver, you may spend 1 card from your hand
 *     in the delivery" - a new `handCard` Deliver option (T4b), at most 1
 *     card, spent as its own crop.
 *   - **O13 The Seed Bank**: the deck-paid wild Grow (v47) loses its "top
 *     card of any deck" wording and reverts to a hand-paid `growOptions`
 *     re-entrant Grow of 2 of your other buildings, self-excluded via
 *     `markFired`.
 *   - **O15 The Garden Library**: retexted from "draw the top card of each
 *     deck, then give 1 card to a neighbour" to "Draw until you have 6 cards
 *     in hand" - the deck-draw and give machinery are both gone.
 *   - **O17 The Fruit Basket**: retexted from a once-per-turn discard
 *     redirect to "Once per turn, if you have 6 or more cards in hand, add 1
 *     to your Barn" - no longer tied to a discard event, a `beforeTurnEnd`
 *     check.
 *   - **V4 The Market Stall Depot**: its Barn-refill trigger (Barn 3 or
 *     fewer) now places a card from your HAND into the Barn, not a deck
 *     card.
 *   - **V18 Helping Hand**: retexted from "if your Barn has 3 or fewer cards
 *     after a Delivery, Draw 3" to "After you Deliver, activate the base
 *     power of the receipt's suit" - the receipt's plain action (a wild
 *     receipt expands to all five crops, filtering to legal actions now);
 *     ruled 24/09/2026 the plain action, not the Notice Board power (R5),
 *     and a one-shot `turn.v18Chain` flag stops it re-triggering itself
 *     (R6), R10's fixed order against V16 carried forward unchanged.
 *
 * ⭐ **R13, ruled 24/09/2026, the widest cross-cutting change in the pass:
 * Power cards now count as buildings in every "buildings you have built"
 * count** (D6, D9, D13, D19, D20, W19, W20), through a new shared
 * `builtBuildingsAndPower` helper - counts only, never offered as a sow,
 * Grow or Harvest target. Riding along and checked against the printed
 * words: W19, W20, D19 and D20 previously also counted End-game cards (so a
 * card counted itself); **they no longer do**, a correctness fix rather than
 * a design choice.
 *
 * ⚠️ **MEASUREMENT CAVEATS CARRIED FROM T5, for T7's report.** The bots are
 * blind (priced through the flat, unprobed `cardTask` term) on A8's both
 * steps, O12's whole delivery choice, A10's board-and-deck choice, A15's
 * discard choice and V18's crop choice, so **A8, O12, A10, A15 and V18 are
 * all likely UNDERSTATED on reference-v24**. O13's hand-paid re-entrant Grow
 * and A14's building choice are properly rolled out and should price fairly.
 *
 * ⛔ A level from `reference-v23` is not comparable: the seed moves with the
 * sheet. NO NUMBER IN ANY `reference-v23` OR EARLIER REPORT IS COMPARABLE AS A
 * LEVEL.
 */
export const REFERENCE_V24: ReferenceConfig = {
  ...REFERENCE_V23,
  id: 'reference-v24',
  description:
    'SHEET v48: TWENTY CARD FACES RETEXTED (22 fields; Dean, 24/09/2026; ' +
    'tasks/v48-rulings-v1.md R1-R4, tasks/v48-rulings-v2.md R5-R15; cards.json re-extracted off ' +
    'Isle-of-Farms-v48.xlsm, sha 53a973c7). reference-v23 stands - the token island, no ' +
    'balloons, no Aerodrome, no Village Store coin, no closing draw, no island wild ' +
    'substitution, the Vegetable barn suit, the five per-suit Helping Hands, a random first ' +
    'player, the round finished at game end, the thirteen v45, seven v46 and fifteen v47 ' +
    'retexts - and TWENTY FACES MOVE plus R13. A7: leading Draw 2 before its sow. A8: now a ' +
    'wild Deliver off the Barn plus cards on full buildings. A9: trailing draw rises to Draw 2. ' +
    "A10: now a deck-paid VISIT of another player's Notice Board, stacking with the ordinary " +
    'bonus visit (no board latch, R9). A11: now a relaxed-minimum-2 Harvest of another building ' +
    '(threshold 3, was 2). A13: the 3-Apiary-buildings gate is gone. A14: now an unplaced ' +
    "GROW of up to 3 full buildings. A15: now discard-and-activate-that-card's-ability " +
    '(threshold 3, was 1), a new engine shape with the D5/D7/D11 listener trap solved inside ' +
    'it. A19: now 2 VP per POWER card built (any suit), max 6 VP - ruled 24/09/2026 a tractor ' +
    'building means a Power card. D6: no Build, a hand-gated (below 5) count draw over every ' +
    'building built. D7: now places 1 spent card into the Barn on Build (the D5 pattern). D8: ' +
    'trailing draw rises to Draw 2. O6: the give is gone, now Draw 2 then a generic Deliver. ' +
    'O11: the harvest-size scaling is gone, now a flat Draw 2. O12: now a Deliver with up to 1 ' +
    'hand card spendable in it. O13: reverts from deck-paid wild to hand-paid, 2 of your other ' +
    'buildings. O15: the deck-draw and give are both gone, now Draw to 6 in hand. O17: no ' +
    'longer discard-triggered, now a beforeTurnEnd check at hand 6+. V4: Barn-refill now takes ' +
    "a HAND card, not a deck card. V18: now activates the DELIVERED RECEIPT crop's plain " +
    'action (R5), not a draw, with a one-shot no-chain guard (R6). R13: Power cards count as ' +
    'buildings in every "buildings you have built" count (D6, D9, D13, D19, D20, W19, W20), ' +
    'counts only, never a sow/Grow/Harvest target; W19/W20/D19/D20 also stop counting End-game ' +
    'cards (a correctness fix). ⚠️ A8, O12, A10, A15 AND V18 ARE BOT-BLIND (understated); O13 ' +
    "and A14's building choice roll out properly. ⚠️ THE HAND LIMIT OF 7 IS THE SIMULATOR'S " +
    'BOUND AND NOT A RULE OF THE GAME. ⛔ NO NUMBER IN ANY reference-v23 OR EARLIER REPORT IS ' +
    'COMPARABLE AS A LEVEL.',
  seed: 'reference-v24',
};

/**
 * `reference-v25`: THE HAND BOUND RAISED FROM 7 TO 10, AND NOTHING ELSE
 * (Dean, 24/09/2026).
 *
 * ⭐ The bound is an INSTRUMENT bound, never a table rule (CLAUDE.md 2.3): the
 * simulator cannot enumerate an unbounded hand, so it clips one at a fixed
 * size, and every reading that touches hand size is a reading about the
 * instrument rather than the design. A paired arm at v48
 * (`overlays/hand-limit-10-v48-v1.overlay.json`, report
 * `reports/watchlist-2026-09-24T15-20-10-reference-v24-hand-limit-10-v48-v1.txt`)
 * showed the bound of 7 read Orchard about 10 points low on identical games
 * (26.1% at 7, 36.1% at 10), so Dean's aim of equal suit win rates was being
 * measured through a ruler that itself leaned on one suit. `rules.json`'s
 * `meta.notes` carries the full reasoning and the cost figures: a full
 * watchlist rises from about 31s to about 50s, and the worst end-of-turn
 * discard enumeration rises from 50,388 to 92,378 moves.
 *
 * This reference also carries the Apiary barn pass ruled the same day: A5,
 * A6, A9 and A17 retexted (`tasks/v49-rulings-v1.md`), off sheet
 * `Isle-of-Farms-v48.xlsm` re-saved in place, SHA-256 `f23474d4...`. On
 * identical games those four cards moved Apiary from 20.2% to 19.9% (report
 * `reports/watchlist-2026-09-24T16-26-46-reference-v24-hand-limit-10-v48-v1.txt`).
 * ⚠️ A17's choice is priced blind, through the flat, unprobed `cardTask`
 * term, the same bot-blind shape as A8, O12, A10, A15 and V18 on
 * `reference-v24` above - so A17 is likely UNDERSTATED on `reference-v25`.
 *
 * `overlays/hand-limit-10-v48-v1.overlay.json` is now a no-op against this
 * default (it sets the same value the base game already carries) and is
 * kept for its measurement record rather than deleted.
 *
 * ⛔ A level from `reference-v24` is not comparable: the bound moves with
 * the instrument, not just the cards. NO NUMBER IN ANY `reference-v24` OR
 * EARLIER REPORT IS COMPARABLE AS A LEVEL.
 */
export const REFERENCE_V25: ReferenceConfig = {
  ...REFERENCE_V24,
  id: 'reference-v25',
  description:
    "THE SIMULATOR'S HAND BOUND RAISED FROM 7 TO 10 (Dean, 24/09/2026; " +
    'rules.json meta.notes). reference-v24 stands - the token island, no balloons, no ' +
    'Aerodrome, no Village Store coin, no closing draw, no island wild substitution, the ' +
    'Vegetable barn suit, the five per-suit Helping Hands, a random first player, the ' +
    'round finished at game end, and every v45/v46/v47/v48 card retext including R13 - and ' +
    'ONE LEAF MOVES: rules.turn.handLimit 7 to 10. A paired arm ' +
    '(overlays/hand-limit-10-v48-v1.overlay.json, now a no-op against this default) showed ' +
    'the old bound of 7 read Orchard about 10 points low on identical games (26.1% at 7, ' +
    '36.1% at 10), because the hand was being clipped before it could be spent; Dean raised ' +
    'the shipped default itself rather than leave the ruler bent. This reference also ' +
    'carries the same-day Apiary barn pass (A5, A6, A9, A17 retexted, tasks/v49-rulings-v1.md, ' +
    'sheet Isle-of-Farms-v48.xlsm re-saved in place, SHA-256 f23474d4...), which on identical ' +
    'games moved Apiary from 20.2% to 19.9%. ⚠️ A17 IS BOT-BLIND (priced through the flat, ' +
    'unprobed cardTask term) and likely UNDERSTATED, the same shape as A8, O12, A10, A15 and ' +
    'V18 carried from reference-v24. Cost: a full watchlist rises from about 31s to about ' +
    '50s, and the worst end-of-turn discard enumeration rises from 50,388 to 92,378 moves. ' +
    "⛔ THE HAND LIMIT IS THE SIMULATOR'S BOUND AND NOT A RULE OF THE GAME - the table plays " +
    'with no hand limit (CLAUDE.md 2.3). ⛔ NO NUMBER IN ANY reference-v24 OR EARLIER REPORT ' +
    'IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v25',
};

/**
 * `reference-v26`: SHEET v49, TWO APIARY CARDS RETEXTED, NO MEASURABLE EFFECT
 * (Dean, 26/09/2026).
 *
 * A11 The Wax Workshop now Harvests another of your buildings at 1 or more
 * cards (was 2). A17 The Smoke Pot now moves 1 card from one of your Notice
 * Boards to your Barn at the end of your turn (was from any full building).
 * Both are already built.
 *
 * A paired run on reference-v25 seeds
 * (`reports/watchlist-2026-09-26T13-43-04-reference-v25-v49-a11-a17-paired-v1.txt`
 * against control `reports/watchlist-2026-09-24T16-56-40-reference-v25.txt`)
 * moved Apiary from 20.4% to 20.5%: no measurable effect.
 *
 * The instrument is re-cut every time cards change, whether or not a change
 * moves a number, so this reference exists to keep every subsequent report
 * naming the sheet it was actually run against.
 *
 * ⛔ NO NUMBER IN ANY reference-v25 OR EARLIER REPORT IS COMPARABLE AS A LEVEL.
 */
export const REFERENCE_V26: ReferenceConfig = {
  ...REFERENCE_V25,
  id: 'reference-v26',
  description:
    'SHEET v49: TWO APIARY CARDS RETEXTED (Dean, 26/09/2026). reference-v25 stands - the ' +
    'token island, no balloons, no Aerodrome, no Village Store coin, no closing draw, no ' +
    'island wild substitution, the Vegetable barn suit, the five per-suit Helping Hands, a ' +
    'random first player, the round finished at game end, every v45/v46/v47/v48 card retext ' +
    'including R13, and the hand bound of 10 - and TWO FACES MOVE. A11 The Wax Workshop now ' +
    'Harvests another of your buildings at 1 or more cards (was 2). A17 The Smoke Pot now ' +
    "moves 1 card from one of your Notice Boards to your Barn at the end of the owner's turn " +
    '(was from any full building). Both are already built. A paired run on reference-v25 ' +
    'seeds (reports/watchlist-2026-09-26T13-43-04-reference-v25-v49-a11-a17-paired-v1.txt ' +
    'against control reports/watchlist-2026-09-24T16-56-40-reference-v25.txt) moved Apiary ' +
    'from 20.4% to 20.5%: NO MEASURABLE EFFECT. ⛔ NO NUMBER IN ANY reference-v25 OR EARLIER ' +
    'REPORT IS COMPARABLE AS A LEVEL.',
  seed: 'reference-v26',
};

/** The instrument every current number is defined against. */
export const REFERENCE = REFERENCE_V26;

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
/**
 * 09/09/2026: re-measured on `reference-v15` (the commons) at n=1580 per seat
 * count, 4820 games per arm, two seeds, from
 * `reports/noise-2026-09-09T15-59-21-reference-v15.txt`. reference-v13 and v14
 * never had a floor. `meeple spend rate` and `self-visit share` are NaN because
 * there are no meeples and no visits under the commons: no subject, not zero.
 * ⚠️ This floor covers HEADLINE_METRICS only. There is NO measured floor for the
 * a17 play rate, the door mix, the farm-bypass share, the off-crop share or the
 * barn-glut medians, which are the readings the commons pass turns on.
 *
 * ⛔ AND THE MOVEMENT TABLE BELOW IS NOW SHORTER THAN THE METRIC LIST, WHICH IS
 * A FACT ABOUT THIS FLOOR AND NOT A BUG. `HEADLINE_METRICS` gained three entries
 * on 12/09/2026 for ledger row C115 - `bonus slot used, share of turns`,
 * `door mix, busiest board share` and `farm bypass share` - and NONE of them has
 * a recorded movement, because this floor was measured on 09/09/2026 before they
 * existed. A metric with no key here is simply not quoted by the sweep header or
 * the report footer, which is the honest behaviour: ⛔ THE ONE THAT MATTERS MOST
 * IS THE FIRST OF THE THREE, because Dean's 30%-60% band is a share of TURNS and
 * the entry above it, `visits per turn`, is the PLAYS measure and a different
 * quantity. Until `--noise` is re-run, the band comparison every arm in this
 * family is judged on still has nothing to be read against.
 */
/*
 * ⭐ reference-v16's FLOOR, measured 12/09/2026 at n=1580 per seat count, and
 * the first floor to carry the three C115 metrics (the bonus rate as a share of
 * TURNS, the door mix and the farm bypass). ⛔ TWO OF ITS LINES ARE FINDINGS AND
 * NOT JUST RESOLUTIONS: SEAT DEVIATION MOVED 4.781 POINTS between two identical
 * runs, against 0.927 under reference-v15 - five times noisier, so the +/-3 seat
 * band can no longer be detected at this n - and LAST AS % OF WINNER read 35.4%
 * against about 57% under v15, which is a much bigger gap between the winner and
 * the last seat. Both are what a longer game with a stronger engine loop does.
 */
/*
 * The v16 values, for the record and NOT for use (measured 12/09/2026 on the
 * commons): actions per turn 0.004, bonus slot used 0.004, door mix 0, farm
 * bypass 0.002, winning score 1, last as % of winner 0.008, tied top score
 * 0.002, deck reshuffles 1, seat deviation 4.781, every other line 0 or NaN.
 *
 * ⭐ reference-v17's FLOOR, measured 13/09/2026 at n=1580 per seat count, two
 * seeds, from `reports/noise-2026-09-13T09-15-27-reference-v17.txt`. Seat
 * deviation moved 0.388 points, against 4.781 under v16, so the +/-3 seat band
 * is back inside the instrument's reach. `farm bypass share` is the rival-fee
 * share of HARVESTED barn cards under this game and is not the commons ratio.
 * `meeple spend rate` is NaN: there are no meeples, so no subject, not zero.
 *
 * The v17 values, for the record and NOT for use: game length 1 round, visits
 * per turn 0.004, actions per turn 0.005, bonus slot used 0.001, door mix 0.002,
 * farm bypass 0.001, unfinished games 0.001, winning score 0, last as % of
 * winner 0.006, tied top score 0.006, seat deviation 0.388, every other line 0
 * or NaN.
 *
 * ⭐ reference-v18's FLOOR, measured 14/09/2026 at n=1580 per seat count, two
 * seeds, from `reports/noise-2026-09-14T14-52-50-reference-v18.txt`. Seat
 * deviation moved 0.876 points (the worst chair, 2p, moved 3.6), so the +/-3
 * seat band is still inside the instrument's reach at three and four seats.
 *
 * The v18 values, for the record and NOT for use: meeple spend rate NaN (no
 * delivery meeple), visits per turn 0.002, actions per turn 0.003, bonus slot
 * used 0.002, door mix 0.005, farm bypass 0, unfinished games 0.001, winning
 * score 1, last as % of winner 0.008, tied top score 0.003, seat deviation
 * 0.876, every other line 0.
 *
 * ⭐ reference-v19's FLOOR, measured 14/09/2026 at n=1580 per seat count, two
 * seeds, from `reports/noise-2026-09-14T22-13-53-reference-v19.txt`. `meeple
 * spend rate` has a subject again (the delivery meeple) and moved 0.9%; seat
 * deviation moved 0.489 points, so the +/-3 seat band stays inside the
 * instrument's reach.
 *
 * ⭐ reference-v20's FLOOR, measured 16/09/2026 at n=1580 per seat count, two
 * seeds, from `reports/noise-2026-09-16T13-38-16-reference-v20.txt` (the token
 * island, sheet v42). ⚠️ SEAT DEVIATION MOVED 3.647 POINTS, against 0.489 on
 * v19: the first player is now drawn at random, so a seat index no longer
 * means an opening position, and the +/-3 seat band sits inside the noise
 * until the seat reading is re-keyed to turn order.
 *
 * The v20 values, for the record and NOT for use: meeples held at game end 0,
 * barn at game end 0, game length 0, visits per turn 0.005, actions per turn
 * 0.004, meeple spend rate 0.01, self-visit share of visits 0, bonus slot used
 * 0.005, door mix (busiest board share) 0.004, farm bypass share 0.005,
 * unfinished games 0.001, winning score 0, last as % of winner 0.021, tied top
 * score 0.001, deck reshuffles per game 0, reshuffles per played crop 0, seat
 * deviation 3.647.
 */
/**
 * ⭐ reference-v21's FLOOR, measured 19/09/2026 at n=1580 per seat count, two
 * seeds, from `reports/noise-2026-09-19T22-52-24-reference-v21.txt`.
 *
 * The v21 values: meeples held at game end 0, barn at game end 0, game
 * length 0, visits per turn 0.004, actions per turn 0.004, meeple spend rate
 * 0.004, self-visit share of visits 0, bonus slot used 0.004, door mix
 * (busiest board share) 0.001, farm bypass share 0.004, unfinished games
 * 0.001, winning score 0, last as % of winner 0.004, tied top score 0.006,
 * deck reshuffles per game 0, reshuffles per played crop 0, seat deviation
 * 5.407. ⚠️ SEAT DEVIATION MOVED 5.407 POINTS, against 3.647 on v20: the
 * +/-3 seat band sits inside the noise until the seat reading is re-keyed.
 */
/**
 * ⭐ reference-v22's FLOOR, measured 20/09/2026 at n=1580 per seat count, from
 * `reports/noise-2026-09-20T13-16-11-reference-v22.txt`.
 *
 * The v22 values: meeples held at game end 0, barn at game end 0, game
 * length 0, visits per turn 0.002, actions per turn 0.003, meeple spend rate
 * 0.001, self-visit share of visits 0, bonus slot used 0.002, door mix
 * (busiest board share) 0, farm bypass share 0.002, unfinished games 0.001,
 * winning score 0, last as % of winner 0.012, tied top score 0.014, deck
 * reshuffles per game 0, reshuffles per played crop 0, seat deviation 0.949.
 */
/**
 * ⭐ reference-v23's FLOOR, measured 22/09/2026 at n=1580 per seat count, from
 * `reports/noise-2026-09-22T17-26-23-reference-v23.txt`.
 *
 * ⚠️ SEAT DEVIATION MOVED 3.417 POINTS, against 0.949 on reference-v22, so the
 * +/-3 seat band has little room left to fail on this instrument.
 *
 * The v22 values, for the record and NOT for use (measured 20/09/2026, from
 * `reports/noise-2026-09-20T13-16-11-reference-v22.txt`): meeples held at
 * game end 0, barn at game end 0, game length 0, visits per turn 0.002,
 * actions per turn 0.003, meeple spend rate 0.001, self-visit share of visits
 * 0, bonus slot used 0.002, door mix (busiest board share) 0, farm bypass
 * share 0.002, unfinished games 0.001, winning score 0, last as % of winner
 * 0.012, tied top score 0.014, deck reshuffles per game 0, reshuffles per
 * played crop 0, seat deviation 0.949.
 */
/*
 * The v23 values, for the record and NOT for use (measured 22/09/2026, from
 * `reports/noise-2026-09-22T17-26-23-reference-v23.txt`): meeples held at
 * game end 0, barn at game end 0.5, game length 0, visits per turn 0, actions
 * per turn 0, meeple spend rate 0.003, self-visit share of visits 0, bonus
 * slot used 0, door mix (busiest board share) 0.001, farm bypass share
 * 0.001, unfinished games 0.002, winning score 0, last as % of winner 0.007,
 * tied top score 0.003, deck reshuffles per game 0, reshuffles per played
 * crop 1, seat deviation 3.417.
 */
/**
 * ⭐ reference-v24's FLOOR, measured 24/09/2026 at n=1580 per seat count, from
 * `reports/noise-2026-09-24T14-47-06-reference-v24.txt`.
 *
 * ⚠️ SEAT DEVIATION MOVED 3.277 POINTS, against 3.417 on reference-v23, so the
 * +/-3 seat band still has little room to fail on this instrument.
 *
 * The v23 values, for the record and NOT for use (measured 22/09/2026, from
 * `reports/noise-2026-09-22T17-26-23-reference-v23.txt`): meeples held at
 * game end 0, barn at game end 0.5, game length 0, visits per turn 0, actions
 * per turn 0, meeple spend rate 0.003, self-visit share of visits 0, bonus
 * slot used 0, door mix (busiest board share) 0.001, farm bypass share
 * 0.001, unfinished games 0.002, winning score 0, last as % of winner 0.007,
 * tied top score 0.003, deck reshuffles per game 0, reshuffles per played
 * crop 1, seat deviation 3.417.
 */
/**
 * ⛔ NOT MEASURED FOR `reference-v25`, and deliberately left null rather than
 * carried over. The floor is a function of the INSTRUMENT, and v25 changed
 * the instrument itself - the hand bound the discard enumeration and the
 * Apiary hand-holding metrics are read against moved from 7 to 10 - so a
 * v24 floor quoted against a v25 run would be describing a different ruler.
 *
 * The v24 values, for the record and NOT for use (measured 24/09/2026, from
 * `reports/noise-2026-09-24T14-47-06-reference-v24.txt`): meeples held at
 * game end 0, barn at game end 0.5, game length 0, visits per turn 0.002,
 * actions per turn 0.003, meeple spend rate 0.001, self-visit share of
 * visits 0, bonus slot used 0.003, door mix (busiest board share) 0.001,
 * farm bypass share 0, unfinished games 0.001, winning score 0, last as %
 * of winner 0.008, tied top score 0.013, deck reshuffles per game 0,
 * reshuffles per played crop 0, seat deviation 3.277.
 *
 * Re-measure with `npm run sim -- --noise --n=1580` and paste the literal it
 * prints back in here.
 *
 * Pasted from reports/noise-2026-09-24T16-58-19-reference-v25.txt (24/09/2026):
 * seat deviation fell from 3.277 to 0.412, so the seat-fairness check can fail again.
 */
/**
 * MEASURED FOR `reference-v26` on 26/09/2026, pasted below from
 * `reports/noise-2026-09-26T13-56-20-reference-v26.txt`. ⚠️ Seat deviation
 * rises from 0.412 on v25 to 5.086, so the seat-fairness check has little room
 * to fail on this instrument. A v25 floor quoted against a v26 run would
 * describe a different instrument.
 *
 * The v25 values, for the record and NOT for use (measured 24/09/2026, from
 * `reports/noise-2026-09-24T16-58-19-reference-v25.txt`): meeples held at
 * game end 0, barn at game end 0, game length 0, visits per turn 0.003,
 * actions per turn 0.002, meeple spend rate 0.004, self-visit share of visits
 * 0, bonus slot used 0.003, door mix (busiest board share) 0.003, farm bypass
 * share 0, unfinished games 0.001, winning score 0, last as % of winner
 * 0.005, tied top score 0.002, deck reshuffles per game 0, reshuffles per
 * played crop 0, seat deviation 0.412.
 *
 * Re-measure with `npm run sim -- --noise --n=1580` and paste the literal it
 * prints back in here.
 */
export const NOISE_FLOOR: NoiseFloor | null = {
  reference: 'reference-v26',
  games: 1580,
  measured: '2026-09-26',
  movement: {
    'meeples held at game end': 0,
    'barn at game end': 0,
    'game length, rounds': 0,
    'visits per turn': 0.005,
    'actions per turn': 0.006,
    'meeple spend rate': 0.004,
    'self-visit share of visits': 0,
    'bonus slot used, share of turns': 0.004,
    'door mix, busiest board share': 0.003,
    'farm bypass share': 0,
    'unfinished games': 0.002,
    'winning score': 0,
    'last as % of winner': 0.002,
    'tied top score': 0.015,
    'deck reshuffles per game': 0,
    'reshuffles, played crop': 0,
    'seat deviation': 5.086,
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
