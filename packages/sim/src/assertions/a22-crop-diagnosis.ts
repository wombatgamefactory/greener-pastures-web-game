import type { GameData, Suit } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { REFERENCE } from '../reference.js';
import { num, pct } from '../stats.js';

/**
 * NEW ON 12/09/2026 FOR LEDGER ROW C114, and it is TWO READINGS THAT WERE OWED
 * BEFORE THE VILLAGE STORE COIN WAS DRAFTED, not readings about the coin.
 *
 * ## ⛔ THE QUESTION, AND THE TWO HALVES POINT OPPOSITE WAYS
 *
 * Orchard wins **17.4%** against Wheat's **41.9%** on an even share of 36.2%
 * (A148, `reports/watchlist-2026-09-11T21-45-42-reference-v15-notice-board-visit-host-draw-by-seats-v1.txt`),
 * and **it is not the Orchard cards**: the same cards won 34.5% under the
 * commons. The standing diagnosis is a LIQUIDITY one. Orchard owns the Draw 4
 * board, the only power that is always legal and always wanted, so its farm
 * takes 20.98 fee cards a game against Wheat's 13.64; it may never visit its own
 * board; and the fees arrive as BARN material, which can pay neither a fee nor a
 * build. It leads on deliveries (5.36) and barn intake (32.2) and trails on hand
 * liquidity, visits made (0.48 against 0.62) and buildings built (2.84 against
 * 5.25).
 *
 * ⛔ **THAT DIAGNOSIS HAS A HOLE IN IT AND THE COIN IS AIMED THROUGH THE HOLE.**
 * Nobody has measured whether a crop's deliveries are FIRST to a tile (6 VP) or
 * SECOND (3 VP). Table-wide the split is 62.5% / 37.5% and it has never been
 * broken down. **If Orchard's harvest-and-clear loop makes it arrive second more
 * often than the others, the island is where it loses, the delivery COUNT was
 * never the right number to lead with, and the Village Store coin (A150) is
 * pointed at the wrong fault.** That is reading 1.
 *
 * ⛔ **AND HAND SIZE BY CROP IS THE ONE LINK IN THE LIQUIDITY CHAIN THAT IS
 * INFERRED RATHER THAN MEASURED.** Every other term in it is a counted number;
 * "the Orchard player has nothing in hand" is an argument. That is reading 2.
 *
 * ## ⛔⛔ EVERY HAND LINE ON THIS PAGE IS A READING ABOUT THE INSTRUMENT
 *
 * The engine bounds the hand at `rules.turn.handLimit` because it cannot
 * enumerate an unbounded one (C7). **THE TABLE PLAYS WITH NO HAND LIMIT AT ALL**
 * and has since v31 was played on 09/09/2026. So a mean hand size here is a mean
 * under a rule the game does not have, and the caveat is printed ON EVERY HAND
 * LINE rather than only in the header, deliberately: a number quoted out of a
 * report loses its header first, and this page exists to be quoted.
 *
 * ⭐ **THE CLIPPING IS THEREFORE PRINTED PER CROP, AND IT IS THE LINE THAT MAKES
 * THE OTHER TWO SAFE.** If one crop begins a far larger share of its turns AT
 * the bound than another, that crop is being measured through a narrower window,
 * and the gap between their mean hands is partly the instrument rather than the
 * game. Nobody can tell from the mean alone, which is why the two are never
 * printed apart.
 *
 * ## What the numbers are made of, exactly
 *
 * ⭐ **READING 1 NEEDED NO NEW COUNTER, WHICH IS WHY IT IS CHEAP.**
 * `receiptsByOrderBySeat` has been folded since the Vegetable rebuild of
 * 09/08/2026: index 0 is arriving first at a tile, index 1 second, read off the
 * receipt's own VP against `island.vpByDeliveryOrder` so it survives a knob on
 * the VP schedule. All this page does is split it by the seat's crop and
 * multiply by the schedule. **So the reading is available on every report in
 * `reports/` retrospectively, and it was simply never asked for.**
 *
 * ⚠️ **THE VP HERE IS ISLAND RECEIPT VP AND NOT A SCORE.** It excludes printed
 * VP on built cards, the Farmstead's per-own-crop VP and every Endgame card, so
 * a crop can lead this line and lose the game. It is the island's contribution
 * alone, which is the term C114 asks about and roughly half a winning score.
 *
 * ⚠️ **V14 THE DISTRIBUTION CENTER MAKES THE VEGETABLE ROW A DIFFERENT SHAPE.**
 * It reads "Deliver and take every receipt on the island", so one activation
 * emits several `delivered` events, each with an empty spend and each a real
 * receipt. A Vegetable seat's counts are therefore right as RECEIPTS and wrong
 * as DELIVERY ACTIONS, and a first/second split for that crop is a split of a
 * sweep as much as of a race. ⛔ **No other crop has this and nothing corrects
 * for it.**
 *
 * ⚠️ **READING 2 NEEDED FOUR NEW BY-SEAT COUNTERS** (`handSampledTurnsBySeat`,
 * `handSizeSumBySeat`, `handAtBoundTurnsBySeat`, `handEmptyTurnsBySeat`), folded
 * at the same clean turn-start moment the game-level hand fields a21 prints have
 * used since 11/09/2026, so the by-seat sums are those scalars SPLIT and never a
 * second sample.
 *
 * ⚠️ **THE EMPTY HAND IS A FLOOR ON ILLIQUIDITY AND NOT AN ESTIMATE OF IT.** It
 * is the sharpest case of "no card this seat could legally spend as a fee", and
 * the only case that is exact under every currency this codebase has: a fee is a
 * card out of the hand under `'card'`, `'commons'` and `'noticeBoardPower'`
 * alike, so a hand of nothing cannot pay one whatever the colour rule says. With
 * `rules.economy.commonsColourMatch` on, a NON-empty hand can also fail to hold
 * a legal fee, and this counter cannot see that. Read it as the bottom of the
 * range.
 *
 * ## ⛔ NO FAIL CONDITION, AND NO NUMBER TAKEN FROM THIS RUN WILL EVER BECOME ONE
 *
 * The design names no number for a crop's share of first deliveries and none for
 * a crop's hand size. A threshold invented here, off the run that FIRST measures
 * the quantity, is a snapshot test that can never fail (ticket 11 section 2),
 * and this project has been bitten by exactly that shape twice: the cap-of-two
 * lesson of 05/09/2026 and its repeat as `commonsThreshold: 2` on 09/09/2026,
 * both of which set a guard at a number the thing already sat on. **What decides
 * anything here is the SPREAD BETWEEN CROPS on one run, which needs no
 * threshold at all, and after that a delta against a paired arm on identical
 * seeds.**
 *
 * ⛔ **THE INSTRUMENT IS `reference-v15` AND NO LEVEL ON THIS PAGE IS COMPARABLE
 * WITH ONE FROM `reference-v14` OR EARLIER.** Five re-cuts sit between the
 * current numbers and the archive. A delta paired on identical seeds is sound; a
 * level quoted across a re-cut is not. ⚠️ **And there is no noise floor for any
 * line here.** The floor recorded in `reference.ts` covers `HEADLINE_METRICS`
 * only, and even after C115's extension it will cover the bonus rate, the door
 * mix and the farm bypass rather than these. Read a crop-to-crop gap of a point
 * or two as nothing.
 */
export const cropDiagnosis: Assertion = {
  id: 22,
  title: 'The crop diagnosis: delivery value and hand size by crop (C114)',
  quote:
    'Orchard leads on the NUMBER of deliveries; nobody has measured their VALUE. First to a ' +
    'tile pays 6 VP and second pays 3, and table-wide the split is 62.5% / 37.5%, but not by ' +
    'crop. If Orchard’s harvest-and-clear loop makes them arrive second more often, the island ' +
    'is where they lose and the coin is aimed at the wrong thing. Take that reading in the same ' +
    'pass. [and] Hand size by crop: the one link in the Orchard diagnosis that is inferred ' +
    'rather than measured.',
  source:
    'docs/village-store-coins-2026-09-12-v2.md section 1 and ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md section 7 (Dean, 12/09/2026), carried as ' +
    'ledger row C114 against A150 and A151',
  shape:
    'Per crop, pooled and by seat count. READING 1, delivery value: deliveries per player per ' +
    'game, the first/second split of the receipts taken, and the island receipt VP that ' +
    'results. READING 2, hand: the mean hand at turn start, the share of turns that began AT ' +
    'the simulator’s bound, and the share that began with an EMPTY hand. ⛔ Every line of ' +
    'reading 2 is a reading about the INSTRUMENT and says so on the line.',
  threshold:
    'OBSERVE, NO FAIL CONDITION, and none will be taken from this run: the design names no ' +
    'number for a crop’s share of first deliveries and none for a crop’s hand size, and a ' +
    'threshold set off the run that first measures a quantity is a snapshot test that can never ' +
    'fail (ticket 11 section 2). The verdicts this feeds are elsewhere: the suit table’s win ' +
    'rates, a17 (the bonus rate against Dean’s 30%-60% band of TURNS) and a06 (the barn glut).',
  taste: false,
  remedy:
    `${NO_REMEDY}. ⛔ THE READING IS THE POINT AND IT DECIDES A DESIGN, NOT A DIAL: if the ` +
    'first-delivery share is FLAT across crops, the island is not where Orchard loses, the ' +
    'liquidity diagnosis stands and the Village Store coin (A150) is aimed at the right fault. ' +
    'If Orchard’s share is materially the lowest, the coin is aimed at the wrong one and C114 ' +
    'reopens before anything is built. ⚠️ Read the two halves TOGETHER or not at all - they ' +
    'point opposite ways, which is why C114 asks for both in one pass. After that the reading ' +
    `that decides anything is a delta against a paired arm on identical ${REFERENCE.id} seeds, ` +
    'never a level: no number here is comparable with one from an earlier reference.',
  measure(ctx) {
    return cropMode(ctx);
  },
};

interface CropRow {
  suit: Suit;
  seatGames: number;
  deliveries: number;
  /** Receipts taken, by fill order: index 0 is first to a tile, index 1 second. */
  byOrder: number[];
  receipts: number;
  /** Island receipt VP only. Never a score. */
  vp: number;
  handSampled: number;
  handSum: number;
  atBound: number;
  empty: number;
}

function cropRows(games: readonly GameMetrics[], data: GameData): CropRow[] {
  const schedule = data.island.vpByDeliveryOrder;
  const rows = new Map<Suit, CropRow>();
  const row = (suit: Suit): CropRow => {
    const found = rows.get(suit);
    if (found !== undefined) return found;
    const made: CropRow = {
      suit,
      seatGames: 0,
      deliveries: 0,
      byOrder: schedule.map(() => 0),
      receipts: 0,
      vp: 0,
      handSampled: 0,
      handSum: 0,
      atBound: 0,
      empty: 0,
    };
    rows.set(suit, made);
    return made;
  };

  for (const g of games) {
    g.suits.forEach((suit, seat) => {
      const r = row(suit);
      r.seatGames += 1;
      r.deliveries += g.deliveriesBySeat[seat] ?? 0;
      // ⚠️ SPARSE BY CONSTRUCTION: the fold in observe.ts writes only the orders
      // a seat actually reached, so an unvisited index is `undefined` and not 0.
      const orders = g.receiptsByOrderBySeat[seat] ?? [];
      schedule.forEach((vp, i) => {
        const n = orders[i] ?? 0;
        r.byOrder[i] = (r.byOrder[i] ?? 0) + n;
        r.receipts += n;
        r.vp += n * vp;
      });
      r.handSampled += g.handSampledTurnsBySeat[seat] ?? 0;
      r.handSum += g.handSizeSumBySeat[seat] ?? 0;
      r.atBound += g.handAtBoundTurnsBySeat[seat] ?? 0;
      r.empty += g.handEmptyTurnsBySeat[seat] ?? 0;
    });
  }

  // In the catalogue's own suit order, so a reader can diff two reports line for
  // line. A crop nobody farmed in the sample has no row at all rather than a row
  // of zeroes: an empty denominator reads as "not measured", which is the truth,
  // where a zero over a real denominator would read as a finding.
  return data.cards.suits.flatMap((suit) => {
    const found = rows.get(suit);
    return found === undefined ? [] : [found];
  });
}

const firstShare = (r: CropRow): number =>
  r.receipts === 0 ? NaN : (r.byOrder[0] ?? 0) / r.receipts;

function cropMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const bound = data.rules.turn.handLimit;
  const schedule = data.island.vpByDeliveryOrder;
  const rows = cropRows(games, data);

  const shares = rows.map(firstShare).filter(Number.isFinite);
  // ⛔ THE ONE SCALAR, AND IT IS A SPREAD RATHER THAN A LEVEL, BECAUSE THE
  // QUESTION IS COMPARATIVE. C114 does not ask what the first-delivery share IS
  // (table-wide it is already known, 62.5%); it asks whether ONE CROP arrives
  // second more often than the others. The widest gap between any two crops
  // answers that in one number and needs no threshold to be read: near zero and
  // the island is not where any crop loses, wide and the row at the bottom of
  // the first/second line below is the finding. ⚠️ A SPREAD HIDES WHICH CROP,
  // deliberately - the detail lines carry that and a scalar cannot.
  const value = shares.length < 2 ? NaN : Math.max(...shares) - Math.min(...shares);

  const lowest = rows
    .filter((r) => Number.isFinite(firstShare(r)))
    .sort((a, b) => firstShare(a) - firstShare(b))[0];
  const highest = rows
    .filter((r) => Number.isFinite(firstShare(r)))
    .sort((a, b) => firstShare(b) - firstShare(a))[0];

  const per = (n: number, seatGames: number) => (seatGames === 0 ? NaN : n / seatGames);
  const orderLabel = (i: number) => `${i === 0 ? 'first' : i === 1 ? 'second' : `#${i + 1}`}`;

  const bySeatRows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, rows: cropRows(slice.ended, data) }));

  const detail = [
    `⛔⛔ READ BOTH HALVES OF THIS PAGE OR NEITHER, BECAUSE THEY POINT OPPOSITE WAYS AND THAT ` +
      'IS WHY C114 ASKS FOR THEM IN ONE PASS. Reading 1 (delivery VALUE by crop) tests whether ' +
      'the island is where a crop loses; reading 2 (hand size by crop) tests the liquidity ' +
      'story that says the island is NOT where it loses. ⭐ IF THE FIRST-DELIVERY SHARE IS ' +
      'FLAT ACROSS CROPS, the delivery COUNT was the right number to lead with after all, the ' +
      'liquidity diagnosis stands, and the Village Store coin (A150) is aimed at the right ' +
      'fault. ⛔ IF ONE CROP’S SHARE IS MATERIALLY THE LOWEST, the island is where that crop ' +
      'loses and the coin is aimed at the wrong one.',
    `⛔ READING 1, DELIVERY VALUE BY CROP, POOLED (${games.length} ended games). The VP ` +
      `schedule on this run is ${schedule.map((vp, i) => `${orderLabel(i)} ${vp} VP`).join(' / ')}` +
      `. Per crop, as deliveries a player a game / first-arrival share of receipts taken / ` +
      `island receipt VP a player a game: ${rows
        .map(
          (r) =>
            `${r.suit} ${num(per(r.deliveries, r.seatGames), 2)} / ${pct(firstShare(r))} / ` +
            `${num(per(r.vp, r.seatGames), 1)}`,
        )
        .join('   ')}.` +
      (lowest !== undefined && highest !== undefined && shares.length > 1
        ? ` ⛔ THE SPREAD IS ${pct(value)} OF RECEIPTS, ${highest.suit} highest at ` +
          `${pct(firstShare(highest))} and ${lowest.suit} lowest at ${pct(firstShare(lowest))}.`
        : ''),
    `⚠️ THE VP ON THAT LINE IS ISLAND RECEIPT VP AND IT IS NOT A SCORE. It excludes printed VP ` +
      'on built cards, the Farmstead’s 1 VP per own-crop card built and every Endgame card, so ' +
      'a crop can lead it and still lose the game - which is exactly the comparison worth ' +
      'making against the suit table’s win rates further up this report. The island carries ' +
      'roughly half a winning score by design, so a crop that leads on deliveries, leads on ' +
      'receipt VP and still loses is losing everywhere ELSE, and a crop that leads on ' +
      'deliveries but NOT on receipt VP is losing the race for the 6 VP space.',
    `⚠️ THE RECEIPT COUNT AND THE DELIVERY COUNT ARE NOT THE SAME NUMBER AND THE GAP IS ` +
      `PRINTED SO NOBODY HAS TO ASSUME IT IS ZERO: ${rows
        .map((r) => `${r.suit} ${r.receipts} receipts of ${r.deliveries} deliveries`)
        .join('   ')}. A delivery whose VP is not on the schedule above cannot be placed in ` +
      'the order and is counted in the second column only. ⛔ AND V14 THE DISTRIBUTION CENTER ' +
      'MAKES THE VEGETABLE ROW A DIFFERENT SHAPE: it reads "Deliver and take every receipt on ' +
      'the island", so one activation emits several `delivered` events, each a real receipt ' +
      'with an empty spend. The vegetable numbers are right as RECEIPTS and wrong as DELIVERY ' +
      'ACTIONS, and its first/second split is a split of a sweep as much as of a race. No other ' +
      'crop has this and nothing here corrects for it.',
    `READING 1 BY SEAT COUNT, because this project has been burnt by a pooled figure hiding a ` +
      `seat count (the first/second split is a RACE, and a race with three rivals is not the ` +
      `race with one). First-arrival share per crop: ${bySeatRows
        .map(
          (s) => `${s.seats}p [${s.rows.map((r) => `${r.suit} ${pct(firstShare(r))}`).join(' ')}]`,
        )
        .join('  ')}.`,
    `READING 1 BY SEAT COUNT, ISLAND RECEIPT VP A PLAYER A GAME: ${bySeatRows
      .map(
        (s) =>
          `${s.seats}p [${s.rows
            .map((r) => `${r.suit} ${num(per(r.vp, r.seatGames), 1)}`)
            .join(' ')}]`,
      )
      .join('  ')}. ⚠️ EXPECT IT TO FALL WITH THE SEAT COUNT WITHOUT THAT BEING A FINDING: the ` +
      'island is the same size at every seat count in tiles per player only approximately, and ' +
      'the game ends on the sixth delivery by ANY player, so more rivals is a shorter game each.',
    `⛔ READING 2, HAND SIZE BY CROP, AND EVERY NUMBER IN IT IS A READING ABOUT THE INSTRUMENT ` +
      `AND NOT ABOUT THE DESIGN (hand limit ${bound === null ? 'NONE on this run' : bound}, THE ` +
      `SIMULATOR’S BOUND, C7 - the table plays with none and has since v31 was played on ` +
      `09/09/2026). Mean hand at the start of a turn, per crop, INSTRUMENT reading, bound ` +
      `${bound === null ? 'none' : bound}: ${rows
        .map((r) => `${r.suit} ${num(r.handSampled === 0 ? NaN : r.handSum / r.handSampled, 2)}`)
        .join('   ')}.`,
    `⛔ THE CLIPPING, PER CROP, AND IT IS THE LINE THAT MAKES THE ONE ABOVE SAFE TO READ ` +
      `(still an INSTRUMENT reading, bound ${bound === null ? 'none' : bound}): share of turns ` +
      `that began AT the bound: ${rows
        .map((r) => `${r.suit} ${pct(r.handSampled === 0 ? NaN : r.atBound / r.handSampled)}`)
        .join('   ')}. ⭐ A CROP CLIPPED MORE OFTEN THAN ANOTHER IS A CROP MEASURED THROUGH A ` +
      'NARROWER WINDOW, so part of any gap in the means above is the engine and not the game, ' +
      'and NOBODY CAN TELL WHICH FROM THE MEAN ALONE. ⛔ If the crop with the highest mean is ' +
      'also the crop clipped most, treat the gap as a lower bound on the real one and quote ' +
      'neither number without this line beside it.',
    `⭐ THE LIQUIDITY FLOOR, PER CROP: the share of turns that began with an EMPTY HAND, which ` +
      `is the sharpest case of "no card this seat could legally spend as a fee": ${rows
        .map((r) => `${r.suit} ${pct(r.handSampled === 0 ? NaN : r.empty / r.handSampled)}`)
        .join('   ')}. ⚠️ IT IS A FLOOR ON ILLIQUIDITY AND NOT AN ESTIMATE OF IT. It is exact ` +
      'under every currency this codebase has, because a fee is a card out of the hand under ' +
      '"card", "commons" and "noticeBoardPower" alike, so a hand of nothing cannot pay one ' +
      'whatever the colour rule says - but with rules.economy.commonsColourMatch ON a NON-empty ' +
      'hand can also fail to hold a legal fee, and this counter cannot see that. ⭐ IT IS ALSO ' +
      'A FLOOR ON THE BUILD SIDE, and worth reading against a11’s no-build rate: a Build spends ' +
      'cards out of the hand, so an empty hand is the sharpest case of "no legal Build" too.',
    `READING 2 BY SEAT COUNT (mean hand, INSTRUMENT reading, bound ${
      bound === null ? 'none' : bound
    }): ${bySeatRows
      .map(
        (s) =>
          `${s.seats}p [${s.rows
            .map(
              (r) => `${r.suit} ${num(r.handSampled === 0 ? NaN : r.handSum / r.handSampled, 2)}`,
            )
            .join(' ')}]`,
      )
      .join('  ')}. Empty-hand share: ${bySeatRows
      .map(
        (s) =>
          `${s.seats}p [${s.rows
            .map((r) => `${r.suit} ${pct(r.handSampled === 0 ? NaN : r.empty / r.handSampled)}`)
            .join(' ')}]`,
      )
      .join('  ')}.`,
    `⭐ WHAT IS SAMPLED, EXACTLY, SO NOBODY RE-DERIVES IT: one sample per turn, taken at the ` +
      `first decision of the turn - no pending task, nothing spent - which is the same clean ` +
      `moment a11’s no-build probe uses. ${rows.reduce((n, r) => n + r.handSampled, 0)} turns ` +
      'were sampled across every crop, and the by-crop sums are the game-level hand fields a21 ' +
      'prints SPLIT rather than a second sample.',
    `⭐ READING 1 NEEDED NO NEW COUNTER AND THAT IS WORTH KNOWING BEFORE ANYBODY RE-RUNS ` +
      'ANYTHING. `receiptsByOrderBySeat` has been folded since the Vegetable rebuild of ' +
      '09/08/2026, read off the receipt’s own VP against island.vpByDeliveryOrder so it ' +
      'survives a knob on the VP schedule; this page only splits it by the seat’s crop. ⚠️ ' +
      'Reading 2 DID need four new by-seat counters (12/09/2026), so it exists on no report ' +
      'before this one.',
    '⛔ NO FAIL CONDITION ON ANY LINE ABOVE AND NO NUMBER HERE WILL EVER BECOME ONE. The design ' +
      'names no number for a crop’s share of first deliveries and none for a crop’s hand size, ' +
      'and a threshold taken off the run that FIRST measures a quantity is a snapshot test that ' +
      'can never fail (ticket 11 section 2). ⚠️ This project has been bitten by exactly that ' +
      'shape twice - the cap-of-two lesson of 05/09/2026 and its repeat as commonsThreshold: 2 ' +
      'on 09/09/2026, both of which set a guard at a number the thing already sat on. The ' +
      'verdicts these readings feed are the suit table’s win rates, a17 and a06.',
    `⛔ THE INSTRUMENT IS ${REFERENCE.id} AND NO LEVEL ON THIS PAGE IS COMPARABLE WITH ONE ` +
      'FROM AN EARLIER REFERENCE. A delta paired on identical seeds is sound and a level ' +
      'quoted across a re-cut is not. ' +
      '⚠️ AND THERE IS NO NOISE FLOOR FOR ANY LINE HERE: the floor recorded in reference.ts ' +
      'covers HEADLINE_METRICS only, and C115’s extension adds the bonus rate, the door mix and ' +
      'the farm bypass rather than these. Read a crop-to-crop gap of a point or two as nothing.',
  ];

  return {
    value,
    headline:
      rows.length === 0
        ? 'no ended games, so neither reading could be taken'
        : `DELIVERY VALUE BY CROP (C114): first-arrival share spreads ${pct(value)} across the ` +
          `crops` +
          (lowest !== undefined && highest !== undefined
            ? `, ${highest.suit} highest at ${pct(firstShare(highest))} and ${lowest.suit} ` +
              `lowest at ${pct(firstShare(lowest))}`
            : '') +
          `; island receipt VP a player a game ${rows
            .map((r) => `${r.suit} ${num(per(r.vp, r.seatGames), 1)}`)
            .join(' ')}. HAND BY CROP, ⛔ AN INSTRUMENT READING (bound ${
            bound === null ? 'none' : bound
          }, C7, the table plays with none): mean ${rows
            .map(
              (r) => `${r.suit} ${num(r.handSampled === 0 ? NaN : r.handSum / r.handSampled, 2)}`,
            )
            .join(' ')}, empty-handed turns ${rows
            .map((r) => `${r.suit} ${pct(r.handSampled === 0 ? NaN : r.empty / r.handSampled)}`)
            .join(' ')}`,
    detail,
    verdict: 'OBSERVE',
  };
}
