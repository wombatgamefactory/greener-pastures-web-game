import { meepleSpendDistinctColours, meepleSpendPerTurn, meepleSpendTiming } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { meepleActionOf } from '@gp/engine';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { REFERENCE } from '../reference.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW ON 12/09/2026 WITH THE DELIVERY MEEPLE (M1 to M8, ledger row A151), and
 * it is the page that asks whether the component earns its place a SECOND time.
 *
 * ## ⭐ THE RULE, AND ITS PROVENANCE IS A TABLE
 *
 * M1 to M8, Dean, 12/09/2026, section 5 of
 * `docs/village-store-coins-2026-09-12-v2.md`, as moved onto the TOKEN ISLAND
 * on 16/09/2026 (R3): a random meeple, now called a WORKER, sits on every 3
 * and 4 VP island token (`island.tokens.workerOnVp`); taking that token claims
 * it; **after your main action** you may discard **one** of them to take the
 * **plain action** of its colour, and it then leaves the game. Dean played it at
 * a table on 11/09/2026 and reported that it allowed some fun, powerful combos.
 * **That outranks every number below**, and the instrument's job here is to say
 * what it costs and how much of it is dead weight, not to price what the table
 * already liked.
 *
 * ⭐ **WHY IT EXISTS: IT GIVES THE ISLAND A DECISION.** On the token island a
 * first delivery chooses between two tokens, and the Worker is what makes a
 * lower-VP token worth taking. This page carries that choice's readings too
 * (`islandRuleLines`), because both are one decision at one tile.
 *
 * ## ⛔⛔ THE STRANDED COUNT IS D8 ARRIVING AS A NUMBER, AND IT IS THE LINE THIS
 * PAGE EXISTS FOR
 *
 * D8, named as a builder default rather than discovered: **the meeple's plain
 * action IS subject to the standing rule that an action you cannot legally
 * perform is not offered**, which has survived every currency this game has had.
 * ⛔ **So a meeple can be UNDISCARDABLE.** A Harvest meeple in a seat with
 * nothing full, a Deliver meeple in a seat with an empty barn and a Build meeple
 * in a seat that can afford nothing are all legal to hold and impossible to
 * spend, and the component then sits in front of a player for the rest of the
 * game doing nothing at all.
 *
 * `meepleGained` minus `meepleSpent` is exactly that dead-component count,
 * because a spent meeple leaves the game and returns to no pool.
 *
 * ⚠️ **A HIGH STRANDED SHARE IS THE RULE WORKING AS RULED AND THE COMPONENT NOT
 * EARNING ITS PLACE, AT THE SAME TIME, AND ONLY A TABLE CAN SAY WHICH.** D8 is
 * deliberate: the alternative is a meeple that buys an illegal action, which no
 * currency in this game has ever allowed. So the number cannot fail against the
 * rule. What it can do is say how much cardboard is inert, and that is a
 * component decision rather than a rules one.
 *
 * ⭐ **AND IT IS THE NUMBER THAT BEARS ON WHETHER THE MEEPLE SURVIVES A SECOND
 * TIME.** A meeple died at a table on 09/09/2026 for exactly this class of
 * reason, in Dean's words: with a meeple always available the bonus was
 * basically free, and the meeples did not add enough interest to earn their
 * place as a component. ⚠️ **BUT THE TWO ECONOMIES ARE NOT THE SAME AND THE
 * DIFFERENCE MUST BE STATED WHEREVER THIS IS QUOTED.** That version seeded FIVE
 * PER PLAYER AT SETUP and was ambient; this one is EARNED, one at a time, by
 * deliberately taking second place at a tile. Two earned, scarce, visible tokens
 * is a different economy wearing the same component, and a stranded share here
 * is evidence about THIS one only.
 *
 * ## ⛔ THE PREDICTION THIS RUN SCORES, WRITTEN DOWN BEFORE THE RUN
 *
 * Section 5 of the design document, from numbers taken before anything was
 * built (on the space island of 12/09/2026, before the token island moved the
 * Worker onto the 3 and 4 VP tokens): second deliveries are 37.5% of all
 * receipts and players make about 4.7 deliveries a game, so the rule should
 * mint roughly **1.8 meeples per player per game**. ⚠️ On the token island half
 * of all tokens carry a Worker, so expect more. That is this project's own standard, a prediction recorded before
 * the measurement, and the page prints the prediction beside the reading so it
 * can be scored rather than quietly forgotten.
 *
 * ⛔ **A 12-GAME PROBE DURING THE BUILD IS NOT A READING AND MUST NOT BE QUOTED
 * AS ONE.** It read about 2.0 a player a game with 21 of 73 stranded (29%), at
 * n=12, which is a number with no interval worth printing. It is recorded here
 * for one reason only: so that a real run can be compared against something
 * written down beforehand.
 *
 * ## ⚠️ READ THE ACTION OFF THE EVENT AND NEVER OFF THE COLOUR
 *
 * `meepleSpent.action` was widened to `DoorAction` at commit `1b60def` and now
 * carries **the action actually bought**. Under **M7** an apiary meeple buys
 * **GROW** where the workers roster's apiary door buys SOW, and under **M6** an
 * orchard meeple buys the **plain Draw 2** where the Notice Board power is
 * Draw 4. Re-deriving the action from the colour would report a Sow that never
 * happened, so `meeplesSpentByAction` is folded straight off the event.
 *
 * ## ⚠️ THIS PAGE AND a15 READ THE SAME COUNTERS AND ARE NOT TWO FINDINGS
 *
 * a15-meeple-economy is not mode-gated away here: the delivery meeple's currency
 * is `'noticeBoardPower'`, which is neither the commons nor the meeple loop, so
 * a15 falls to its `'card'` branch and applies its floor, **FAIL below half of
 * all meeples gained ever being spent**. ⛔ **That floor was written for the v31
 * ISLAND MEEPLE and Dean has not ruled it onto this component.** It is left
 * exactly as it is, because changing an assertion's threshold to suit a new arm
 * is how a suite stops being an instrument. a15 carries the verdict, this page
 * carries the diagnosis, and quoting the two as independent findings would be
 * double-counting one set of counters.
 *
 * ## ⛔ NO FAIL CONDITION ON ANY LINE, AND NONE WILL BE TAKEN FROM THIS RUN
 *
 * The design names no number for a mint rate, none for a spend rate and none for
 * a stranded share. **The 1.8 figure is a PREDICTION TO BE SCORED, not a
 * threshold to fail against**, and a threshold taken off the run that FIRST
 * measures a quantity is a snapshot test that can never fail (ticket 11 section
 * 2). This project has been bitten by that exact shape twice: the cap-of-two
 * lesson of 05/09/2026 and its repeat as `commonsThreshold: 2` on 09/09/2026,
 * both of which set a guard at a number the thing already sat on.
 *
 * ⛔ **THE INSTRUMENT IS `reference-v15` AND THIS IS AN ARM ON TOP OF AN ARM.**
 * C100 is open and no Notice Board configuration is ruled in as the shipped
 * game, so the control is the best-performing configuration measured
 * (`overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json`) and not a
 * ruling. No level here is comparable with a `reference-v14` or earlier number,
 * and **there is no noise floor for any line on this page**: the floor recorded
 * in `reference.ts` covers `HEADLINE_METRICS`, whose only meeple entry is
 * "meeples held at game end" as a median over a whole game.
 */
export const deliveryMeeple: Assertion = {
  id: 23,
  title: 'The delivery meeple: minted, spent and stranded (A151)',
  quote:
    'Second deliveries are 37.5% of all receipts and players make about 4.7 deliveries a game, ' +
    'so this mints roughly 1.8 meeples per player per game, each earned by deliberately taking ' +
    'second at a tile. The version rejected at a table in September seeded FIVE PER PLAYER at ' +
    'setup and was ambient - the complaint was precisely that the bonus was always available. ' +
    '[and, as builder default D8] the meeple’s plain action IS subject to the standing rule ' +
    'that an action you cannot legally perform is not offered, and it means a meeple can be ' +
    'undiscardable.',
  source:
    'docs/village-store-coins-2026-09-12-v2.md sections 5 and 6, and ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md sections 2 (M1-M8), 6 (D7-D8) and 7 ' +
    '(Dean, 12/09/2026), carried as ledger row A151. ⭐ Provenance is a TABLE: Dean played it ' +
    'on 11/09/2026 and reported that it allowed some fun, powerful combos.',
  shape:
    'Meeples minted, spent and STRANDED at game end, per player per game, pooled and by seat ' +
    'count, against the design’s written prediction of about 1.8 minted. The colour mix of ' +
    'what was SPENT and, separately, of what was STRANDED. What the spends actually BOUGHT, ' +
    'read off the event rather than derived from the colour (M6, M7). And when the mints and ' +
    'the spends fell, because a meeple minted in the last round could never have been spent.',
  threshold:
    'OBSERVE, NO FAIL CONDITION, and none will be taken from this run. The design names no ' +
    'number for a mint rate, a spend rate or a stranded share; the 1.8 figure is a PREDICTION ' +
    'written down before the build and is scored here, never failed against. ⛔ A high ' +
    'stranded share is D8 working as ruled AND the component not earning its place, at once, ' +
    'and only a table can separate them. ⚠️ a15-meeple-economy reads the same counters through ' +
    'its "card" branch and DOES carry a floor (half of all meeples gained ever spent) - that ' +
    'floor was written for the v31 island meeple and has not been ruled onto this component.',
  taste: false,
  remedy:
    `${NO_REMEDY}, and the decision this feeds is a COMPONENT decision rather than a dial. ` +
    `⭐ THE PAIRS THAT DECIDE ANYTHING, both on identical ${REFERENCE.id} seeds: the control ` +
    'overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json, which is this arm with ' +
    'the meeple leaves off, for what the rule costs elsewhere (a16 action inflation passes at ' +
    'only 1.61 against a target of 1.5 and every meeple spent adds an action); and ' +
    'overlays/delivery-meeple-distinct-colours-v1.overlay.json, which is C112 - the cap of one ' +
    'per turn against no-two-of-the-same-colour, because the cap removes the combo burst ' +
    'Dean’s own table enjoyed and the branching worry that produced it shrank when it was ' +
    'measured.',
  // ⭐ 16/09/2026: THE TOKEN ISLAND. The island readings (the token choice,
  // receipts by value, wild tokens, the Vegetable board's relaxation) are
  // printed on every run; the Worker lines only where a token carries one.
  measure(ctx) {
    return deliveryMeepleMode(ctx);
  },
};

/**
 * ⭐ THE TOKEN ISLAND'S READINGS (Dean, R3, R9, 16/09/2026). Readings only, no
 * fail condition, and no noise floor.
 *
 *   - THE TOKEN CHOICE: of FIRST deliveries that took one of two tokens with
 *     different VP, the share that took the HIGHER-VP token, and the
 *     VP-for-Worker trades (the lower token taken because only it carried a
 *     Worker), pooled and by seat count.
 *   - RECEIPTS BY TOKEN VALUE and deliveries per player.
 *   - WILD-TOKEN RECEIPTS and the VEGETABLE BOARD'S RELAXATION in use.
 */
function islandRuleLines({ data, pooled }: MeasureContext): { lines: string[]; headline: string } {
  const lines: string[] = [];
  const slices = [...pooled.bySeats].sort((a, b) => a.seats - b.seats);
  const games = pooled.ended;
  const choicesOf = (gs: readonly GameMetrics[]) => sum(gs.map((g) => sum(g.firstChoicesBySeat)));
  const higherOf = (gs: readonly GameMetrics[]) => sum(gs.map((g) => sum(g.firstTookHigherBySeat)));
  const tradesOf = (gs: readonly GameMetrics[]) =>
    sum(gs.map((g) => sum(g.firstLowerForWorkerBySeat)));
  const seatGamesOf = (gs: readonly GameMetrics[]) => sum(gs.map((g) => g.suits.length));
  const shareOf = (gs: readonly GameMetrics[]) => {
    const c = choicesOf(gs);
    return c === 0 ? NaN : higherOf(gs) / c;
  };
  const choices = choicesOf(games);
  const share = shareOf(games);
  const headline =
    `${pct(share)} of first-delivery token choices took the higher-VP token ` +
    `(${tradesOf(games)} VP-for-Worker trades)`;
  lines.push(
    '⭐ THE TOKEN CHOICE (Dean, R3, 16/09/2026): of ' +
      `${choices} FIRST deliveries that took one of two tokens with different VP, ${pct(share)} ` +
      `took the HIGHER-VP token and ${tradesOf(games)} took the lower token because only it ` +
      `carried a Worker. By seat count: ${slices
        .map((x) => `${x.seats}p ${pct(shareOf(x.ended))} (${tradesOf(x.ended)} trades)`)
        .join('  ')}. ⚠️ READ IT AS A READING ABOUT THE BOTS AS MUCH AS THE RULE: the ` +
      'pricer weighs a token at the deliver weight times its VP plus meepleGain for its ' +
      'Worker, which prices a Worker at about 0.83 VP, below the token set’s smallest 1 VP ' +
      'gap (terms.ts, tokenWorkerWorth). Nobody has measured what a human does with the ' +
      'choice. No fail condition and no noise floor.',
  );
  const values = data.island.tokens.vpValues;
  const byVp = (vp: number) =>
    sum(games.map((g) => sum(g.receiptsByVpBySeat.map((r) => r[String(vp)] ?? 0))));
  const receipts = sum(values.map(byVp));
  const seatGames = seatGamesOf(games);
  lines.push(
    `RECEIPTS BY TOKEN VALUE, pooled: ${values
      .map((vp) => `${vp} VP ${pct(receipts === 0 ? NaN : byVp(vp) / receipts)}`)
      .join(' / ')} of ${receipts} receipts. Deliveries per player per game: ${slices
      .map(
        (x) =>
          `${x.seats}p ${num(
            seatGamesOf(x.ended) === 0
              ? NaN
              : sum(x.ended.map((g) => sum(g.deliveriesBySeat))) / seatGamesOf(x.ended),
            2,
          )}`,
      )
      .join('  ')}. Receipts off a WILD token (any 2 cards): ${num(
      seatGames === 0 ? NaN : sum(games.map((g) => sum(g.wildTokenReceiptsBySeat))) / seatGames,
      2,
    )} per player per game.`,
  );
  const vegDeliveries = sum(games.map((g) => sum(g.vegetableWildDeliveriesBySeat)));
  const vegCards = sum(games.map((g) => sum(g.vegetableWildCardsBySeat)));
  lines.push(
    `⭐ THE VEGETABLE BOARD'S RELAXATION (R9, noticeBoardPower.vegetableWildCards ` +
      `${data.rules.economy.noticeBoardPower.vegetableWildCards}): ${vegDeliveries} deliveries ` +
      `in ${games.length} ended games used it, paying ${vegCards} cards that missed the ` +
      'tokens’ named demand. ⚠️ BUILDER DEFAULT: on a second delivery those cards may cover ' +
      'the token’s pair too.',
  );
  return { lines, headline };
}

interface MeepleTotals {
  seatGames: number;
  minted: number;
  spent: number;
  /** Read off the FINAL STATE, never derived as minted minus spent. */
  stranded: number;
  heldTurns: number;
  turns: number;
}

function totals(games: readonly GameMetrics[]): MeepleTotals {
  const t: MeepleTotals = {
    seatGames: 0,
    minted: 0,
    spent: 0,
    stranded: 0,
    heldTurns: 0,
    turns: 0,
  };
  for (const g of games) {
    t.seatGames += g.seats;
    t.minted += sum(g.meeplesGainedBySeat);
    t.spent += sum(g.meeplesSpentBySeat);
    t.stranded += sum(g.meeplesUnspentBySeat);
    t.heldTurns += sum(g.meepleHeldTurnsBySeat);
    t.turns += sum(g.turnsBySeat);
  }
  return t;
}

/** A colour or action mix as shares of the whole, in a fixed order so two reports diff. */
function mix(counts: ReadonlyMap<string, number>, order: readonly string[]): string {
  const all = [...counts.values()].reduce((a, b) => a + b, 0);
  if (all === 0) return 'nothing to split';
  const known = order.filter((k) => counts.has(k));
  const rest = [...counts.keys()].filter((k) => !order.includes(k));
  return [...known, ...rest].map((k) => `${k} ${pct((counts.get(k) ?? 0) / all)}`).join('  ');
}

/**
 * ⭐ WHICH WORKER COLOUR ACTUALLY GETS USED, most-used first (Dean, 18/09/2026).
 *
 * The three colour mixes beside this one each divide by a different whole -
 * spends, strandings, mints - so none of them is a RATE for a colour, and
 * "orchard is 30.2% of spends but 3.6% of strandings" needs the raw counts
 * recovered before it means anything. This divides each colour by ITS OWN mint,
 * which is the one denominator that answers the question Dean asked: when a
 * player earned this Worker, did it ever do anything?
 *
 * ⛔ THE ACTION LABEL COMES FROM `meepleActionOf` AND NEVER FROM THE ROSTER.
 * Under M4's `'afterAction'` an apiary Worker buys GROW where `workers.json`
 * prints SOW (M7, 12/09/2026), so a label read off `linkedSuit` would print a
 * Sow that never happened - the same trap the spends-by-action line below
 * carries a warning about. One source, and it is the engine's.
 */
function workerUse(
  minted: ReadonlyMap<string, number>,
  spent: ReadonlyMap<string, number>,
  suits: readonly Suit[],
  data: GameData,
): string {
  const rows = suits
    .map((suit) => {
      const m = minted.get(suit) ?? 0;
      return {
        suit,
        action: meepleActionOf(data, suit),
        minted: m,
        spent: spent.get(suit) ?? 0,
        used: m === 0 ? NaN : (spent.get(suit) ?? 0) / m,
      };
    })
    .filter((r) => r.minted > 0)
    .sort((a, b) => b.used - a.used);
  if (rows.length === 0) return 'none minted';
  return rows
    .map(
      (r) =>
        `${r.suit} (${r.action}) ${pct(r.used)} of ${r.minted} minted` +
        ` [${r.spent} used, ${r.minted - r.spent} wasted]`,
    )
    .join('  ·  ');
}

function tally(
  games: readonly GameMetrics[],
  of: (g: GameMetrics) => Record<string, number>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of games) {
    for (const [k, n] of Object.entries(of(g))) if (n > 0) m.set(k, (m.get(k) ?? 0) + n);
  }
  return m;
}

function deliveryMeepleMode(ctx: MeasureContext): Measurement {
  const { data, pooled } = ctx;
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const island = islandRuleLines(ctx);
  const suits = data.cards.suits;
  const workerOn = data.island.tokens.workerOnVp;
  // ⭐ NO WORKER ON ANY TOKEN (`island.tokens.workerOnVp` []): the island lines
  // only, rather than a page of zeroes reading as a finding. ⚠️ Meeples under
  // the meeple-loop control come from elsewhere too; a15 owns those.
  if (workerOn.length === 0) {
    return {
      value: NaN,
      headline: `NO WORKER ON THIS RUN (island.tokens.workerOnVp []). ${island.headline}.`,
      detail: [
        ...island.lines,
        `⛔ THE INSTRUMENT IS ${REFERENCE.id}; no level here is comparable across a re-cut.`,
      ],
      verdict: 'OBSERVE',
    };
  }
  const cap = meepleSpendPerTurn(data);
  const timing = meepleSpendTiming(data);
  const distinct = meepleSpendDistinctColours(data);

  const t = totals(games);
  const per = (n: number) => (t.seatGames === 0 ? NaN : n / t.seatGames);
  // ⛔ THE ONE SCALAR IS THE STRANDED SHARE, because it is the question the page
  // was written for: how much of this component never did anything. A mint rate
  // is a prediction being scored and a spend rate is its complement, but neither
  // says on its own whether the cardboard earned its place.
  const value = t.minted === 0 ? NaN : t.stranded / t.minted;
  const derived = t.minted - t.spent;

  const spentByColour = tally(games, (g) => g.meeplesSpentByColour);
  const strandedByColour = tally(games, (g) => g.meeplesUnspentByColour);
  const mintedByColour = tally(games, (g) => g.meeplesGainedByColour);
  const spentByAction = tally(games, (g) => g.meeplesSpentByAction);

  const lateMints = sum(
    games.map((g) => g.meepleGainedRounds.filter((r) => r >= g.rounds - 1).length),
  );
  const lastRoundMints = sum(
    games.map((g) => g.meepleGainedRounds.filter((r) => r >= g.rounds).length),
  );
  const lateSpends = sum(
    games.map((g) => g.meepleSpentRounds.filter((r) => r >= g.rounds - 1).length),
  );

  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, t: totals(slice.ended) }));
  const seatLine = (f: (x: MeepleTotals) => number) =>
    bySeat.map((s) => `${s.seats}p ${num(f(s.t), 2)}`).join('  ');
  const perSeat = (f: (x: MeepleTotals) => number) => (x: MeepleTotals) =>
    x.seatGames === 0 ? NaN : f(x) / x.seatGames;

  const detail = [
    '⛔⛔ THE STRANDED COUNT IS D8 ARRIVING AS A NUMBER AND IT HAS NO FAIL CONDITION, ' +
      'DELIBERATELY. The meeple’s plain action is subject to the standing rule that an action ' +
      'you cannot legally perform is not offered (D8, named as a builder default on ' +
      '12/09/2026), so A MEEPLE CAN BE UNDISCARDABLE: a Harvest meeple in a seat with nothing ' +
      'full, a Deliver meeple in a seat with an empty barn and a Build meeple in a seat that ' +
      'can afford nothing are all legal to hold and impossible to spend. ⚠️ A HIGH STRANDED ' +
      'SHARE IS THEREFORE THE RULE WORKING AS RULED AND THE COMPONENT NOT EARNING ITS PLACE AT ' +
      'THE SAME TIME, AND ONLY A TABLE CAN SAY WHICH.',
    `THE BALANCE SHEET, per player per game over ${games.length} ended games ` +
      `(${t.seatGames} seat-games): ${num(per(t.minted), 2)} MINTED, ${num(per(t.spent), 2)} ` +
      `SPENT, ${num(per(t.stranded), 2)} STRANDED at game end. The stranded share is ` +
      `${pct(value)} of ${t.minted} meeples minted.`,
    '⭐ THE PREDICTION THIS SCORES, WRITTEN DOWN BEFORE THE BUILD: about 1.8 minted a player a ' +
      'game, made on the space island of 12/09/2026 (second deliveries were 37.5% of receipts), ' +
      'before the token island put a Worker on half of all tokens; ' +
      'section 5 of docs/village-store-coins-2026-09-12-v2.md. This run reads ' +
      `${num(per(t.minted), 2)}. ⛔ IT IS A PREDICTION BEING SCORED AND NEVER A THRESHOLD: ` +
      'nothing here fails against it, and no number on this page will become a threshold ' +
      'later, because a guard taken off the run that first measures a quantity is a snapshot ' +
      'test that can never fail (ticket 11 section 2, and the cap-of-two lesson of 05/09/2026 ' +
      'repeated as commonsThreshold: 2 on 09/09/2026). ⛔ AND THE 12-GAME PROBE TAKEN DURING ' +
      'THE BUILD - about 2.0 a player with 21 of 73 stranded - IS NOT A READING AND MUST NOT ' +
      'BE QUOTED AS ONE. It is recorded only so that a real run has something written down ' +
      'beforehand to be compared with.',
    `BY SEAT COUNT, per player per game. Minted: ${seatLine(perSeat((x) => x.minted))}. ` +
      `Spent: ${seatLine(perSeat((x) => x.spent))}. ` +
      `Stranded: ${seatLine(perSeat((x) => x.stranded))}. Stranded share: ${bySeat
        .map((s) => `${s.seats}p ${pct(s.t.minted === 0 ? NaN : s.t.stranded / s.t.minted)}`)
        .join('  ')}. ⚠️ EXPECT THE MINT TO FALL WITH THE SEAT COUNT WITHOUT THAT BEING A ` +
      'FINDING: the game ends on a sixth delivery by ANY player, so more rivals is a shorter ' +
      'game each and fewer second places to take.',
    '⭐ THE IDENTITY, PRINTED SO A DISAGREEMENT IS VISIBLE RATHER THAN HUNTED: stranded read ' +
      `off the FINAL STATE is ${t.stranded}; minted minus spent is ${derived}. ` +
      (t.stranded === derived
        ? 'They agree, which is what a game where a spent meeple leaves and nothing else ' +
          'drains the supply should show.'
        : `⛔ THEY DISAGREE BY ${Math.abs(t.stranded - derived)}, WHICH IS AN ENGINE BUG OR A ` +
          'DRAIN NOBODY NAMED (a boxed meeple, a cap refusing a gain). Do not read any other ' +
          'line on this page until it is explained.'),
    // ⭐ WHICH WORKER IS POPULAR, asked for by Dean on 18/09/2026, and the
    // reason it is its own line rather than arithmetic the reader does. The
    // three mixes below each divide by a DIFFERENT total - spends, strandings,
    // mints - so "orchard 30.2% of spends against 3.6% of strandings" cannot be
    // read as a rate without first recovering the counts. This line divides
    // each colour by ITS OWN mint, which is the only denominator that answers
    // "when a player got this Worker, did it ever do anything".
    //
    // ⚠️ IT IS A READING ABOUT D8 AND NOT ABOUT TASTE. An action you cannot
    // legally perform is never offered, so a low share here is a colour a seat
    // could not spend as often as one it did not want to, and the two are not
    // separated by anything on this page. Read it beside the stranded mix.
    `⭐ WHICH WORKER GETS USED, each colour against ITS OWN mint (the one denominator the ` +
      `three mixes below do not give you): ${workerUse(mintedByColour, spentByColour, suits, data)}.` +
      ' ⚠️ A LOW SHARE IS D8 AS MUCH AS TASTE: a Worker whose action is illegal right now is ' +
      'never offered, so this cannot separate "could not spend it" from "did not want it".',
    `THE COLOUR MIX OF WHAT WAS SPENT (${t.spent} spends): ${mix(spentByColour, suits)}.`,
    `THE COLOUR MIX OF WHAT WAS STRANDED (${t.stranded} left dead): ` +
      `${mix(strandedByColour, suits)}. ⭐ READ THE TWO MIXES AGAINST EACH OTHER AND AGAINST ` +
      `WHAT WAS MINTED (${mix(mintedByColour, suits)}), WHICH IS THE WHOLE POINT OF PRINTING ` +
      'THREE. The mint is random and should be flat across the five; a colour heavy in the ' +
      'stranded mix and light in the spent mix is a colour whose action a seat could not ' +
      'perform or did not want, which is D8 pointing at one specific board rather than at the ' +
      'component in general.',
    '⛔ WHAT THE SPENDS ACTUALLY BOUGHT, READ OFF THE EVENT AND NEVER DERIVED FROM THE COLOUR: ' +
      `${mix(spentByAction, ['harvest', 'deliver', 'draw', 'build', 'grow', 'sow'])}. ` +
      'meepleSpent.action was widened to DoorAction at commit 1b60def for this line. Under M7 ' +
      'an APIARY meeple buys GROW where the workers roster’s apiary door buys SOW, and under ' +
      'M6 an ORCHARD meeple buys the PLAIN Draw 2 where the Notice Board power is Draw 4, so ' +
      'a colour-derived action would report a Sow that never happened. ⚠️ IF "sow" EVER ' +
      'APPEARS ON THIS LINE, M7 HAS BEEN BROKEN IN THE ENGINE.',
    `⭐ THE D8 DENOMINATOR: ${t.spent} spends over ${t.heldTurns} turns begun holding at least ` +
      `one meeple, of ${t.turns} turns in all, which is ` +
      `${pct(t.heldTurns === 0 ? NaN : t.spent / t.heldTurns)} of the turns on which a spend ` +
      `was possible at all, and ${pct(t.turns === 0 ? NaN : t.heldTurns / t.turns)} of every ` +
      'turn played began with a meeple in front of the player. ⚠️ IT COUNTS TURNS AND NEVER ' +
      'MEEPLES: a seat holding three for one turn adds one, which is the right shape for "how ' +
      'many chances did this seat have" and the wrong one for "how long did a meeple sit". ' +
      '⛔ THE SECOND FIGURE IS THE AMBIENCE READING and it is the one that bears on the ' +
      '09/09/2026 table verdict: the economy that died had FIVE PER PLAYER FROM SETUP, so a ' +
      'bonus was available on very nearly every turn. This one is earned one at a time.',
    '⭐ WHEN THEY ARRIVED, WHICH SEPARATES "IT CAME TOO LATE" FROM "NOBODY WANTED IT": ' +
      `${pct(t.minted === 0 ? NaN : lateMints / t.minted)} of mints fell in the FINAL TWO ` +
      `ROUNDS of their own game and ${pct(t.minted === 0 ? NaN : lastRoundMints / t.minted)} ` +
      `in the final round; ${pct(t.spent === 0 ? NaN : lateSpends / t.spent)} of spends fell ` +
      'in the final two rounds. ⛔ THIS IS STRUCTURAL AND NOT A TASTE: the Worker’s only ' +
      'source is an island token and the game ENDS on a SIXTH receipt by anybody, so the ' +
      'last meeples a seat earns are minted on the turns it has fewest left. A stranded share ' +
      'that is mostly late mints is the END TRIGGER; a stranded share spread evenly across the ' +
      'game is the COMPONENT. They call for different answers and the raw stranded count ' +
      'cannot tell them apart.',
    `THE RULES IN FORCE ON THIS RUN, named rather than assumed: Workers on the ` +
      `${workerOn.join(' and ')} VP tokens (M1 on the token island, 16/09/2026), ` +
      `meepleSpendTiming "${timing}" (M4), meepleSpendPerTurn ${cap === null ? 'none' : cap} ` +
      `(M5) and meepleSpendDistinctColours ${distinct} (C112). ` +
      `⚠️ M4’s "after your main action" REVERSES THE REASON THE BONUS ` +
      'SITS AT THE FRONT: the bonus was moved to the start of the turn on Dean’s own reasoning ' +
      'that a turn visibly ends on the main action (C2, 09/09/2026), and a meeple spend after ' +
      'it means the turn can end on a bonus again. That is a teach cost rather than a number ' +
      'and no line here can see it.',
    '⚠️ THIS PAGE AND a15-meeple-economy READ THE SAME COUNTERS AND ARE NOT TWO FINDINGS. The ' +
      'delivery meeple’s currency is "noticeBoardPower", which is neither the commons nor the ' +
      'meeple loop, so a15 falls to its "card" branch and applies its floor: FAIL below half ' +
      'of all meeples gained ever being spent. ⛔ THAT FLOOR WAS WRITTEN FOR THE v31 ISLAND ' +
      'MEEPLE AND DEAN HAS NOT RULED IT ONTO THIS COMPONENT. It is left untouched, because ' +
      'moving an assertion’s threshold to suit a new arm is how a suite stops being an ' +
      'instrument. a15 carries the verdict, this page carries the diagnosis, and quoting both ' +
      'as independent evidence is double-counting one set of counters.',
    `⛔ THE INSTRUMENT IS ${REFERENCE.id}. Since 14/09/2026 the delivery meeple is the ` +
      'SHIPPED game (Dean), and since 16/09/2026 it sits on the island tokens; ' +
      'overlays/pre-delivery-meeple-v1.overlay.json is the game without it (workerOnVp []). ' +
      'The space-choice decomposition arms were retired with the delivery spaces. ' +
      'No reference cut before 16/09/2026 describes the token island. ' +
      'No level here is comparable with an earlier reference; a delta paired on identical ' +
      'seeds is sound and a level across a re-cut is not. ' +
      '⚠️ AND THERE IS NO NOISE FLOOR FOR ANY LINE ON THIS PAGE: the floor in reference.ts ' +
      'covers HEADLINE_METRICS, whose only meeple entry is "meeples held at game end" as a ' +
      'median over a whole game. Read a difference of a tenth of a meeple as nothing.',
    ...island.lines,
  ];

  return {
    value,
    headline:
      `THE DELIVERY MEEPLE (A151): ${num(per(t.minted), 2)} MINTED, ${num(per(t.spent), 2)} ` +
      `SPENT and ${num(per(t.stranded), 2)} STRANDED per player per game, so ${pct(value)} of ` +
      'every meeple minted died in front of its owner. Against the design’s written prediction ' +
      `of about 1.8 minted. Spent mix ${mix(spentByColour, suits)}; stranded mix ` +
      `${mix(strandedByColour, suits)}. ⛔ THE STRANDED SHARE IS D8 AS A NUMBER and has no ` +
      'fail condition: it is the rule working as ruled and the component not earning its ' +
      'place, at once, and only a table can say which.' +
      (island.headline === '' ? '' : ` ${island.headline}.`),
    detail,
    verdict: 'OBSERVE',
  };
}
