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

/** The instrument every current number is defined against. */
export const REFERENCE = REFERENCE_V8;

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
 * Player suits are taken as an unordered SET and seated in canonical order.
 * Seat order is not a stratification axis - the profile assignment already
 * rotates who sits where, and treating (wheat, dairy) and (dairy, wheat) as
 * different cells would double the run for no extra coverage.
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
 * Games per cell at this seat count: the target rounded UP so every cell gets
 * the same number. Rounding up rather than down keeps the stratification exact
 * at the cost of a few extra games, and an uneven cell would quietly weight one
 * suit matchup above another in every pooled number in the report.
 */
export function gamesPerCell(target: number, cellCount: number): number {
  return Math.max(1, Math.ceil(target / cellCount));
}
