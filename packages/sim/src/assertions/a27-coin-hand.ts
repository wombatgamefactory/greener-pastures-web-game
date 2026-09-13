import type { GameData } from '@gp/data';
import { coinPaysBuild, coinPaysGrow, isNoticeBoardPower, storeCoinsPerCard } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { REFERENCE } from '../reference.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW ON 12/09/2026, AND ⛔ **THE HANDOFF DOES NOT ASK FOR IT. THE BUILD
 * DISCOVERED IT.**
 *
 * ## ⭐ THE MECHANISM, IN ONE SENTENCE: A COIN SINK PAYS NO CARD
 *
 * A card-Grow spends a card out of the hand. A coin-Grow (V8) spends a coin and
 * **places nothing**, and a coin-paid build (V6) spends coins in place of cards
 * that would otherwise have left the hand. So under the coin arms **CARDS STOP
 * LEAVING THE HAND**, and the hand grows.
 *
 * Measured at the bench during the build: **worst hand 11 under the control
 * against 15 under `grow-only`**, which drove the end-of-turn discard
 * enumeration to **C(15, 8) = 6,435 legal moves against the control's 789.**
 * ⛔ A 12-GAME BENCH IS NOT A READING AND MUST NOT BE QUOTED AS ONE; it is
 * recorded here so a real run has something written down beforehand to be
 * compared against, which is the same standard a23 holds its own probe to.
 *
 * ## ⭐⭐ THIS IS THE SHAPE THAT BROKE THE PROJECT ON 02/09/2026
 *
 * v31 deleted the hand limit on the reading that it was "the master clock" and
 * therefore redundant. **The reading was wrong about the engine.** Measured,
 * paired, same seeds: the worst single two-seat position offered **116,535 legal
 * moves**, of which 116,503 were build payments, at a hand of 41; the worst
 * payment enumeration for one card was 15,260; and a two-seat game took **91.5
 * seconds** against 0.1s before. Three apparently separate failures - an
 * unrunnable simulator, a failed hook assertion and a 45-round two-player game -
 * all traced to that one deletion. The limit came back at 12 the next day and
 * was cut to 7 for runtime the same day.
 *
 * ⭐ **THE COIN ARMS PUSH ON EXACTLY THAT MECHANISM FROM A NEW DIRECTION**, and
 * it deserves saying rather than being discovered a second time at n=1580.
 *
 * ## ⛔⛔ AND THE INSTRUMENT UNDERSTATES IT. C7 IS ON EVERY LINE OF THIS PAGE
 *
 * The engine's `rules.turn.handLimit` is **the SIMULATOR'S bound and not a rule
 * of the game**: it exists because the simulator cannot enumerate an unbounded
 * hand, and **the table plays with no hand limit at all** (ruled at the table on
 * 09/09/2026, C7). So the engine's end-of-turn discard task is the only thing
 * bringing a hand back down, **and at a table nothing does.**
 *
 * ⛔ **THE CONSEQUENCE IS THE OPPOSITE OF THE USUAL CAVEAT.** Every number on
 * this page is a FLOOR on what the rule does to a hand: the instrument clips the
 * growth and then reports the clipped figure. A mean that barely moves while the
 * share of turns AT THE BOUND climbs is the clipping, not the absence of an
 * effect, which is why those two lines are printed together and never apart.
 *
 * ## ⚠️ THIS PAGE, a21 AND a22 ALL READ THE SAME FOUR COUNTERS
 *
 * They are not three findings. `handSampledTurns`, `handSizeSum`,
 * `handAtBoundTurns` and `handSizeMax` are folded once, at the first decision of
 * every turn, and split three ways:
 *
 *  - **a21-host-draw** asks what S17's faucet does to a hand, and reports NO
 *    SUBJECT wherever the host draw is off. **It carries the CONTROL's hand
 *    numbers**, because the control is the seat-shaped host-draw arm.
 *  - **a22-crop-diagnosis** splits the same counters BY CROP, for the Orchard
 *    liquidity chain, and has no mode gate at all.
 *  - **this page** asks what a sink that pays NO CARD does to a hand, and
 *    reports NO SUBJECT wherever no coin sink exists.
 *
 * ⛔ Quoting two of the three as independent evidence is double-counting one
 * sample.
 *
 * ## ⛔ NO FAIL CONDITION
 *
 * The design names no number for a hand size, and it could not: the quantity
 * belongs to the instrument rather than to the game. A threshold taken off the
 * run that FIRST measures a quantity is a snapshot test that can never fail
 * (ticket 11 section 2). ⛔ The instrument is `reference-v15`, this is an arm on
 * top of an arm (C100 is open), and **the noise floor covers nothing here**.
 */
export const coinHand: Assertion = {
  id: 27,
  title: 'The hand under a sink that pays no card, and what it does to the decision space',
  quote:
    'A coin-Grow PAYS NO CARD, so cards stop leaving the hand. Measured at the bench: worst ' +
    'hand 11 under the control against 15 under grow-only, which drove the end-of-turn discard ' +
    'enumeration to C(15,8) = 6435 legal moves against the control’s 789. ⚠️ The instrument ' +
    'UNDERSTATES this: the engine’s discard task is what caps the hand at 7, and that limit is ' +
    'the SIMULATOR’S bound (C7) while the table plays with none, so at a table nothing brings ' +
    'the hand back down. ⭐ This is the same shape that broke the project on 02/09/2026, when ' +
    'deleting the hand limit produced a 116,535-move position.',
  source:
    'The Village Store build of 12/09/2026 (ledger row A150, V6 and V8), which discovered it; ' +
    'C7 and section 2.3 of CLAUDE.md for the bound; and the v31 hand-limit measurement of ' +
    '02/09/2026 for the shape. ⛔ NOT ASKED FOR by section 7 of ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md, which is why it is recorded here with ' +
    'its provenance rather than folded into a line on a25.',
  shape:
    'Mean and PEAK hand at the start of a turn under the coin arms, pooled and by seat count, ' +
    'with the share of turns already AT the engine’s bound beside them, because the bound is ' +
    'what makes the mean understate. Plus the decision space the hand feeds: the worst ' +
    'end-of-turn discard enumeration and the worst position of any kind. Every line carries ' +
    'C7 - the limit is the SIMULATOR’S bound and the table plays with none. NO SUBJECT ' +
    'wherever no coin sink exists, where a21-host-draw and a22-crop-diagnosis carry the hand ' +
    'instead.',
  threshold:
    'OBSERVE, NO FAIL CONDITION. The design names no number for a hand size and could not: ' +
    'under C7 the quantity belongs to the INSTRUMENT and not to the game, so a guard here ' +
    'would be a guard on the simulator. ⛔ AND THE READINGS ARE A FLOOR RATHER THAN AN ' +
    'ESTIMATE: the engine clips the hand at rules.turn.handLimit and then reports the clipped ' +
    'figure, so a mean that barely moves while the share of turns at the bound climbs is the ' +
    'clipping and not the absence of an effect. A threshold taken off the run that first ' +
    'measures a quantity is a snapshot test that can never fail (ticket 11 section 2).',
  taste: true,
  remedy:
    `${NO_REMEDY} for the hand itself, because there is nothing here to fix in the design: the ` +
    'growth is a consequence of V8 that Dean ruled in, and the clipping is the simulator. ' +
    '⭐ WHAT THE NUMBERS ARE FOR IS THE BRANCHING GATE, and the pairs that read it are ' +
    'overlays/village-store-coins-grow-only-v1.overlay.json (the Grow bet alone, which is the ' +
    'arm that pays no card at all) and overlays/village-store-coins-build-only-v1.overlay.json ' +
    'against the control overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json on ' +
    `identical ${REFERENCE.id} seeds. ⛔ IF THE DISCARD ENUMERATION CLIMBS FAR ENOUGH TO COST ` +
    'RUNTIME, THE ANSWER IS AN INSTRUMENT CHANGE AND NEVER A RULES CHANGE: a bot-side discard ' +
    'heuristic in place of the task is what CLAUDE.md section 2.3 already names as the missing ' +
    'piece, and nobody has designed one.',
  measure(ctx) {
    if (!coinPaysBuild(ctx.data) && !coinPaysGrow(ctx.data)) return noSubject(ctx.data);
    if (storeCoinsPerCard(ctx.data) <= 0) return noSubject(ctx.data);
    return handMode(ctx);
  },
};

/**
 * ⛔ NO SUBJECT WHEREVER NO COIN SINK EXISTS, and the gate is deliberately BOTH
 * halves: a sink with no mint behind it spends nothing, and a mint with no sink
 * takes no card out of a hand's future either.
 */
function noSubject(data: GameData): Measurement {
  const elsewhere = isNoticeBoardPower(data)
    ? 'a21-host-draw carries the hand under this mode and it is the CONTROL’s reading, which ' +
      'is the number a coin arm is paired against.'
    : 'a22-crop-diagnosis carries the hand under every mode, split by crop, and it is the only ' +
      'assertion in the suite with no mode gate.';
  return {
    value: NaN,
    headline:
      'NO SUBJECT: there is no coin sink in this game, so nothing pays for anything without ' +
      'taking a card out of a hand. The page exists for V6 and V8 of the Village Store ' +
      `(rules.economy.coinPaysBuild ${coinPaysBuild(data)}, rules.economy.coinPaysGrow ` +
      `${coinPaysGrow(data)}, rules.economy.storeCoinsPerCard ${storeCoinsPerCard(data)}). ` +
      elsewhere,
    detail: [
      '⛔ THE HAND IS MEASURED IN THREE PLACES OFF ONE SAMPLE AND THEY ARE NOT THREE FINDINGS. ' +
        'handSampledTurns, handSizeSum, handAtBoundTurns and handSizeMax are folded once, at ' +
        'the first decision of every turn: a21 asks what S17’s faucet does to a hand, a22 ' +
        'splits the same counters by crop for the Orchard liquidity chain, and this page asks ' +
        'what a sink that pays NO CARD does. Quoting two of the three as independent evidence ' +
        'is double-counting one sample.',
      '⚠️ AND THE BOUND IS THE SIMULATOR’S (C7). rules.turn.handLimit exists because the ' +
        'engine cannot enumerate an unbounded hand; the table plays with no hand limit at all, ' +
        'ruled at the table on 09/09/2026. Every hand number this suite prints, on every page, ' +
        'is a reading about the instrument.',
    ],
    verdict: 'OBSERVE',
  };
}

interface HandRow {
  turns: number;
  held: number;
  atBound: number;
  peak: number;
  discardMoves: number;
  legalMoves: number;
  coinGrows: number;
  coinBuilds: number;
}

function handRow(games: readonly GameMetrics[]): HandRow {
  const r: HandRow = {
    turns: 0,
    held: 0,
    atBound: 0,
    peak: 0,
    discardMoves: 0,
    legalMoves: 0,
    coinGrows: 0,
    coinBuilds: 0,
  };
  for (const g of games) {
    r.turns += g.handSampledTurns;
    r.held += g.handSizeSum;
    r.atBound += g.handAtBoundTurns;
    r.peak = Math.max(r.peak, g.handSizeMax);
    r.discardMoves = Math.max(r.discardMoves, g.maxDiscardMoves);
    r.legalMoves = Math.max(r.legalMoves, g.maxLegalMovesSeen);
    r.coinGrows += sum(g.coinGrowsBySeat);
    r.coinBuilds += sum(g.coinBuildsBySeat);
  }
  return r;
}

function handMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const r = handRow(games);
  if (r.turns === 0) {
    return { value: NaN, headline: 'not measured: no turns sampled', verdict: 'OBSERVE' };
  }
  // ⛔ THE SCALAR IS THE MEAN HAND AT THE START OF A TURN, because it is the
  // quantity the mechanism moves and the one a paired delta is taken on. ⚠️ IT
  // IS THE MOST CLIPPED OF THE THREE lines on this page, which is why the peak
  // and the at-bound share are printed beside it in the headline and not below.
  const value = r.held / r.turns;
  const bound = data.rules.turn.handLimit;

  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, r: handRow(slice.ended) }));

  const detail = [
    '⛔⛔ THE MECHANISM, IN ONE SENTENCE: A COIN SINK PAYS NO CARD, SO CARDS STOP LEAVING THE ' +
      'HAND. A card-Grow spends a card out of the hand; a coin-Grow (V8) spends a coin and ' +
      'PLACES NOTHING, and a coin-paid build (V6) spends coins in place of cards that would ' +
      'otherwise have gone. ⛔ SECTION 7 OF THE HANDOFF DOES NOT ASK FOR THIS READING - THE ' +
      'BUILD DISCOVERED IT - and it is recorded with that provenance rather than folded quietly ' +
      'into the coin balance sheet.',
    `THE HAND AT THE START OF A TURN, over ${r.turns} turns sampled in ${games.length} ended ` +
      `games: mean ${num(value, 2)} cards, PEAK ${r.peak}, and ` +
      `${pct(r.atBound / r.turns)} of turns began ALREADY AT the engine’s bound of ` +
      `${bound === null ? 'none' : bound}. ⛔ THE THREE ARE ONE READING AND MUST NOT BE ` +
      'SEPARATED: the bound is what makes the mean understate, so a mean that barely moves ' +
      'while the at-bound share climbs is the CLIPPING and not the absence of an effect.',
    `⛔⛔ AND THE BOUND IS THE SIMULATOR’S AND NOT A RULE OF THE GAME (C7). ` +
      `rules.turn.handLimit is ${bound === null ? 'null' : bound} here because the engine ` +
      'cannot enumerate an unbounded hand; THE TABLE PLAYS WITH NO HAND LIMIT AT ALL, ruled at ' +
      'the table on 09/09/2026 and unchanged since. ⛔ SO EVERY NUMBER ON THIS PAGE IS A FLOOR ' +
      'ON WHAT THE RULE DOES TO A HAND: the instrument clips the growth and then reports the ' +
      'clipped figure. At a table nothing brings the hand back down at all, and the effect ' +
      'this page is measuring would run further than anything printed here.',
    `⛔ THE DECISION SPACE THE HAND FEEDS, WHICH IS WHY THIS IS A PAGE AND NOT A FOOTNOTE: the ` +
      `worst END-OF-TURN DISCARD enumeration in the pass offered ${r.discardMoves} legal ` +
      `moves, and the worst position of any kind offered ${r.legalMoves}. The discard task ` +
      'enumerates every subset of the overflow, so its width is C(hand, hand - limit) and it ' +
      'climbs like a binomial and not like a hand. ⭐ THE BENCH FIGURE WRITTEN DOWN DURING THE ' +
      'BUILD, FOR COMPARISON AND NOT AS A READING: worst hand 11 under the control against 15 ' +
      'under grow-only, driving C(15,8) = 6,435 moves against the control’s 789. ⛔ A 12-GAME ' +
      'BENCH IS NOT A READING AND MUST NOT BE QUOTED AS ONE.',
    '⭐⭐ THIS IS THE SAME SHAPE THAT BROKE THE PROJECT ON 02/09/2026 AND IT DESERVES SAYING. ' +
      'v31 deleted the hand limit on the reading that it was "the master clock" and therefore ' +
      'redundant, and the reading was wrong about the engine: the worst single two-seat ' +
      'position offered 116,535 legal moves, 116,503 of them build payments, at a hand of 41; ' +
      'the worst payment enumeration for one card was 15,260; and a two-seat game took 91.5 ' +
      'seconds against 0.1 before. An unrunnable simulator, a failed hook assertion and a ' +
      '45-round two-player game all traced to that one deletion. The limit came back at 12 the ' +
      'next day and was cut to 7 the same day for runtime. ⚠️ THE COIN ARMS PUSH ON EXACTLY ' +
      'THAT MECHANISM FROM A NEW DIRECTION, and the point of printing it is that nobody should ' +
      'have to discover it a second time at n=1580.',
    `BY SEAT COUNT, ALL FOUR TOGETHER: ${bySeat
      .map(
        (s) =>
          `${s.seats}p [mean ${num(s.r.turns === 0 ? NaN : s.r.held / s.r.turns, 2)}  peak ` +
          `${s.r.peak}  at bound ${pct(s.r.turns === 0 ? NaN : s.r.atBound / s.r.turns)}  worst ` +
          `discard ${s.r.discardMoves}]`,
      )
      .join('  ')}. ⚠️ READ THE ROWS AND NOT THE POOLED FIGURE: a two-player game is longer ` +
      'per seat, so a hand has more turns in which to grow, and the worst position of the pass ' +
      'is a single game and not a distribution.',
    `THE SINKS THAT PRODUCED IT, so the mechanism is beside the symptom: ${r.coinGrows} ` +
      `coin-Grows and ${r.coinBuilds} coin-paid builds over the same games ` +
      `(rules.economy.coinPaysGrow ${coinPaysGrow(data)}, rules.economy.coinPaysBuild ` +
      `${coinPaysBuild(data)}). ⭐ THE GROW SINK IS THE PURE CASE and the build sink is the ` +
      'mixed one: a coin-Grow pays no card at all, where a coin-paid build may still spend ' +
      'cards alongside the coins. a25-village-store-coin carries both in full. ⚠️ IF THE HAND ' +
      'MOVES UNDER build-only AND NOT UNDER grow-only, THE DIAGNOSIS IN THIS PAGE’S HEADER IS ' +
      'WRONG and should be rewritten rather than explained away.',
    '⚠️ THIS PAGE, a21-host-draw AND a22-crop-diagnosis ALL READ THE SAME FOUR COUNTERS AND ' +
      'ARE NOT THREE FINDINGS. The sample is folded once, at the first decision of every turn. ' +
      'a21 asks what S17’s faucet does to a hand, and on a run with the host draw off (the ' +
      'shipped game) it carries the same hand this page reads; a22 splits the same counters by crop for ' +
      'the Orchard liquidity chain and has no mode gate; this page asks what a sink that pays ' +
      'no card does. ⛔ Quoting two of the three as independent evidence is double-counting one ' +
      'sample.',
    '⛔ NO FAIL CONDITION, AND THERE CANNOT BE ONE. The design names no number for a hand ' +
      'size, and under C7 it could not: the quantity belongs to the instrument rather than to ' +
      `the game, so a guard here would be a guard on the simulator. ⛔ THE INSTRUMENT IS ` +
      `${REFERENCE.id}. The Notice Board visit is the shipped game (ruled 13/09/2026) and the ` +
      'Village Store coin is live in it; the Village Store and delivery-meeple overlays are ' +
      'arms on the shipped game. No level here is comparable with an earlier reference, and ' +
      `⚠️ THE NOISE FLOOR COVERS NOTHING ON THIS PAGE: no hand line is in HEADLINE_METRICS, so ` +
      `the ${REFERENCE.id} floor says nothing about any of them.`,
  ];

  return {
    value,
    headline:
      `THE HAND UNDER A SINK THAT PAYS NO CARD: mean ${num(value, 2)} cards at the start of a ` +
      `turn, PEAK ${r.peak}, and ${pct(r.atBound / r.turns)} of turns began already at the ` +
      `engine’s bound of ${bound === null ? 'none' : bound}; the worst end-of-turn discard ` +
      `enumeration offered ${r.discardMoves} legal moves (worst position of any kind ` +
      `${r.legalMoves}). ⛔ THE BOUND IS THE SIMULATOR’S (C7) AND THE TABLE PLAYS WITH NONE, ` +
      'so these are a FLOOR on what the rule does and not an estimate. ⭐ It is the same shape ' +
      'that produced a 116,535-move position on 02/09/2026.',
    detail,
    verdict: 'OBSERVE',
  };
}

/** Kept beside the metrics type so a future reader can see what this file reads. */
export type CoinHandMetrics = Pick<
  GameMetrics,
  | 'handSampledTurns'
  | 'handSizeSum'
  | 'handAtBoundTurns'
  | 'handSizeMax'
  | 'maxDiscardMoves'
  | 'maxLegalMovesSeen'
>;
