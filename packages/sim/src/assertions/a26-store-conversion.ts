import type { GameData } from '@gp/data';
import { coinSupplyPerPlayer, storeCoinsPerCard } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW ON 12/09/2026, AND IT IS LEDGER ROW C113: ⛔⛔ **DOES EVERY PLAYER CONVERT
 * EVERY SPARE CARD EVERY TIME?** This is the single most important line in the
 * Village Store pass, and it is the one page in the suite whose subject is a
 * PLACEMENT rather than a rule.
 *
 * ## ⛔ THE OBJECTION IS DEAN'S OWN AND IT IS OLDER THAN THE RULE
 *
 * `docs/village-store-2026-08-19-v1.md` section 1 tested where the Store should
 * sit and ruled this exact placement out, in these words:
 *
 * > **Free / a rider on Deliver.** ⛔ No cost, so it is always correct. Breaks
 * > everything.
 *
 * **The current design is a rider on Deliver.** Dean's answer of 12/09/2026 is
 * that you must first make a valid delivery, which is not free, and that a
 * capped, shared, contested supply of wilds that score nothing bounds the
 * reward. The differences from August are real: the reward then was GBP 1 from
 * an unbounded BANK under a coin economy since deleted, and the cost is no
 * longer zero, since cards converted are cards not delivered and the tie-break
 * drops.
 *
 * ⚠️ **THE CORE OF THE OBJECTION STILL STANDS AND IS A TEST FOR THIS RUN**, in
 * the design document's own words: *the cards converted are undeliverable
 * singletons that were worth nothing anyway, so converting is very nearly always
 * correct and there is little decision in it.* ⛔ **IF THE ARM SHOWS EVERY
 * PLAYER CONVERTING EVERY SPARE CARD EVERY TIME, THE AUGUST VERDICT WAS RIGHT
 * AND THE PLACEMENT IS WHAT TO CHANGE** - not the price, and not the supply.
 *
 * ## THE TWO SHARES, AND THE PAGE EXISTS TO PRINT BOTH
 *
 *  - **THE OFFER RATE.** Of the deliveries at which a conversion was POSSIBLE,
 *    what share converted at all. Near 100% means nobody ever declines.
 *  - **THE DEPTH.** Of the convertible cards available at those moments, what
 *    share were actually converted. Near 100% means nobody ever converts SOME.
 *
 * ⭐ **NEAR-100% ON BOTH IS THE AUGUST VERDICT CONFIRMED.** They are printed
 * separately because they can disagree, and the disagreement is the finding: a
 * high offer rate with a low depth is a table that always trades and chooses how
 * much, which is a decision; a high depth with a low offer rate is a table that
 * trades rarely but empties the barn when it does, which is a threshold effect.
 *
 * ⚠️ **A THIRD SHARE IS PRINTED BESIDE THEM AND IT IS THE SHARPEST OF THE
 * THREE**: the share of windows that converted EVERY convertible card. That is
 * C113's sentence taken literally - *every spare card, every time*.
 *
 * ## ⚠️⚠️ WHAT THIS PAGE CANNOT DO, STATED BEFORE ANY NUMBER
 *
 * ⛔ **A BOT THAT ALWAYS TAKES A FREE THING IS NOT PROOF A HUMAN WOULD.** The
 * pricer has no term for "this coin is worth less to me than the tie-break I am
 * giving up", and nothing in it models a player who simply does not bother. So
 * **THE READING IS A CEILING ON HOW AUTOMATIC THE DECISION IS, AND NOT A
 * MEASUREMENT OF THE DECISION'S WEIGHT.** A near-100% here says the rules make
 * declining pointless, which is exactly what C113 asks; it does not say a table
 * would feel it as a phase of the turn rather than a choice. ⭐ Only a table can
 * say that, which is the same sentence a18 and a23 carry, and it is why this
 * page is marked taste-sensitive: the mirror spread is the nearest thing the
 * instrument has to a second opinion.
 *
 * ⚠️ **AND THE FLOOR IS NOT WHERE A READER EXPECTS IT.** A window's ceiling is
 * `min(barn after the crate, coins left in the supply)`, so a conversion the
 * SUPPLY refused never appears as a decline. That is deliberate - a card you
 * cannot get a coin for is not convertible - and it means the depth share is
 * about CHOICE and the empty-supply share on a25 is about the CAP. Read the two
 * together or neither.
 *
 * ## ⛔ NO FAIL CONDITION, AND NOT EVEN AT 100%
 *
 * The design names no number. It names a direction and a consequence: if the
 * rate is very nearly total, the placement is what to change. That is a
 * prediction to be scored and a decision for Dean, not a threshold, and a
 * threshold taken off the run that FIRST measures a quantity is a snapshot test
 * that can never fail (ticket 11 section 2, and the cap-of-two lesson of
 * 05/09/2026 repeated as `commonsThreshold: 2` on 09/09/2026).
 *
 * ⛔ **THE INSTRUMENT IS `reference-v15` AND THIS IS AN ARM ON TOP OF AN ARM**
 * (C100 is open). No level here is comparable with a `reference-v14` or earlier
 * number, and there is no noise floor for any line on this page.
 */
export const storeConversion: Assertion = {
  id: 26,
  title: 'C113: does every player convert every spare card every time? (A150)',
  quote:
    'Free / a rider on Deliver. No cost, so it is always correct. Breaks everything. [and, ' +
    'twenty-four days later] The core of the objection still stands and is a test for the run: ' +
    'the cards converted are undeliverable singletons that were worth nothing anyway, so ' +
    'converting is very nearly always correct and there is little decision in it. The supply ' +
    'cap and the race for it have to carry the tension the placement does not. If the arm ' +
    'shows every player converting every spare card every time, the August verdict was right ' +
    'and the placement is what to change.',
  source:
    'docs/village-store-2026-08-19-v1.md section 1 (the original rejection of this placement, ' +
    'Dean, 19/08/2026) and docs/village-store-coins-2026-09-12-v2.md section 7 with ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md section 7 (Dean, 12/09/2026). Carried ' +
    'as ledger row C113 against A150.',
  shape:
    'Of the deliveries at which a conversion was POSSIBLE, the share that converted at all; of ' +
    'the convertible cards available at those moments, the share actually converted; and the ' +
    'share of those windows that converted EVERY convertible card, which is C113’s sentence ' +
    'taken literally. Beside them: the ceiling against the BARN behind it, so a reader can see ' +
    'whether the supply or the barn was binding, and the deliveries that could not convert at ' +
    'all, split by whether the barn or the SUPPLY was empty. NO SUBJECT wherever ' +
    'rules.economy.storeCoinsPerCard is 0.',
  threshold:
    'OBSERVE, NO FAIL CONDITION, and not even at 100%. The design names no number: it names a ' +
    'CONSEQUENCE, which is that a very nearly total rate means the August verdict was right ' +
    'and the PLACEMENT is what to change. That is a decision for Dean and a prediction to be ' +
    'scored, never a threshold, and one taken off the run that first measures a quantity is a ' +
    'snapshot test that can never fail (ticket 11 section 2). ⛔ AND THE READING IS A CEILING ' +
    'ON HOW AUTOMATIC THE DECISION IS RATHER THAN A MEASUREMENT OF ITS WEIGHT: a bot that ' +
    'always takes a free thing is not proof a human would, and nothing in the pricer models a ' +
    'player who does not bother.',
  taste: true,
  remedy:
    `${NO_REMEDY}, and the decision this feeds is a PLACEMENT decision rather than a dial. ` +
    '⛔ IF THE RATE IS NEARLY TOTAL, THE ANSWER THE DESIGN ITSELF NAMES IS TO MOVE THE ' +
    'EXCHANGE OFF THE DELIVERY RIDER, not to cut rules.economy.storeCoinsPerCard and not to ' +
    'shrink rules.economy.coinSupplyPerPlayer: section 1 of docs/village-store-2026-08-19-v1.md ' +
    'lists the placements that were considered instead, and none of them is built. ⭐ THE RUNS ' +
    'THAT INFORM IT, on identical reference-v15 seeds against the control ' +
    'overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json: ' +
    'overlays/village-store-coins-v1.overlay.json is the assembled arm, and ' +
    'overlays/village-store-coins-grow-only-v1.overlay.json is the same mint with only one ' +
    'sink behind it, which is the cleanest test of whether the conversion rate is about the ' +
    'exchange or about what the coins can buy.',
  measure(ctx) {
    if (storeCoinsPerCard(ctx.data) <= 0) return noSubject(ctx.data);
    return conversionMode(ctx);
  },
};

/** ⛔ NO SUBJECT WHEREVER THERE IS NO VILLAGE STORE, which is every mode this project has shipped. */
function noSubject(data: GameData): Measurement {
  return {
    value: NaN,
    headline:
      'NO SUBJECT: rules.economy.storeCoinsPerCard is 0, so no delivery offers an exchange and ' +
      'C113 has nothing to ask. a25-village-store-coin carries the whole coin balance sheet ' +
      'and says the same thing there; a19-coin-economy owns the SEPARATE commons-with-coins ' +
      'arm of 10/09/2026, whose mint clears a central pile and has no barn exchange in it at ' +
      'all.',
    detail: [
      'C113 is a question about a PLACEMENT and not about a currency: ' +
        'docs/village-store-2026-08-19-v1.md section 1 ruled a rider on Deliver out in August ' +
        '("no cost, so it is always correct, breaks everything") and the design of 12/09/2026 ' +
        'is a rider on Deliver. ⛔ So the page has a subject only where the rider exists.',
      `Setup on this run mints nothing: storeCoinsPerCard ${storeCoinsPerCard(data)} and ` +
        `coinSupplyPerPlayer ${coinSupplyPerPlayer(data)}. The arms are ` +
        'overlays/village-store-coins-v1.overlay.json and its three siblings, every one of ' +
        'them an ARM ON TOP OF AN ARM while C100 is open.',
    ],
    verdict: 'OBSERVE',
  };
}

interface Windows {
  seatGames: number;
  offered: number;
  ceiling: number;
  barn: number;
  used: number;
  emptied: number;
  converted: number;
  blocked: number;
  blockedSupply: number;
  blockedBarn: number;
  supplyTurns: number;
  supplyEmptyTurns: number;
}

function windows(games: readonly GameMetrics[]): Windows {
  const w: Windows = {
    seatGames: 0,
    offered: 0,
    ceiling: 0,
    barn: 0,
    used: 0,
    emptied: 0,
    converted: 0,
    blocked: 0,
    blockedSupply: 0,
    blockedBarn: 0,
    supplyTurns: 0,
    supplyEmptyTurns: 0,
  };
  for (const g of games) {
    w.seatGames += g.seats;
    w.offered += g.storeExchanges;
    w.ceiling += g.storeExchangeCeiling;
    w.barn += g.storeExchangeBarn;
    w.used += g.storeExchangesUsed;
    w.emptied += g.storeExchangesEmptied;
    w.converted += sum(g.storeCardsConvertedBySeat);
    w.blocked += g.storeDeliveriesNoExchange;
    w.blockedSupply += g.storeDeliveriesNoExchangeEmptySupply;
    w.blockedBarn += g.storeDeliveriesNoExchangeEmptyBarn;
    w.supplyTurns += g.coinSupplySampledTurns;
    w.supplyEmptyTurns += g.coinSupplyEmptyTurns;
  }
  return w;
}

function conversionMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const w = windows(games);
  if (w.offered === 0) {
    return {
      value: NaN,
      headline:
        'NOT MEASURED: the Village Store is ON and not one delivery ever offered an exchange. ' +
        '⛔ THAT IS A FINDING AND NOT AN ABSENCE - `pushStoreExchange` queues a task whenever ' +
        'min(barn after the crate, supply left) is above zero, so zero windows means either no ' +
        'delivery ever left a card in a barn or the supply was empty at every single one. ' +
        `${w.blocked} deliveries could not convert (${w.blockedSupply} on an empty supply, ` +
        `${w.blockedBarn} on an empty barn). Read a25’s supply line before anything else.`,
      verdict: 'OBSERVE',
    };
  }

  // ⛔ THE SCALAR IS THE DEPTH - the share of convertible cards actually
  // converted - because it is the closest single number to C113's sentence
  // "every spare card". The offer rate is its ceiling and is printed first in
  // the headline, because a reader who takes one number away should take the
  // one that says whether anybody ever declines at all.
  const value = w.ceiling === 0 ? NaN : w.converted / w.ceiling;
  const offerRate = w.used / w.offered;
  const emptiedRate = w.emptied / w.offered;

  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, w: windows(slice.ended) }));

  const detail = [
    '⛔⛔ THIS PAGE IS LEDGER ROW C113 AND IT IS THE PASS’S OWN TEST OF ITSELF. ' +
      'docs/village-store-2026-08-19-v1.md section 1 ruled this exact placement out on ' +
      '19/08/2026: "Free / a rider on Deliver. No cost, so it is always correct. Breaks ' +
      'everything." The design of 12/09/2026 IS a rider on Deliver. Dean’s answer is that a ' +
      'valid delivery is a precondition and a capped shared supply of wilds that score nothing ' +
      'bounds the reward. ⛔ THE OBJECTION SURVIVES AS A TEST: the cards converted are ' +
      'undeliverable singletons worth nothing anyway, so converting is very nearly always ' +
      'correct and there may be no decision in it. IF EVERY PLAYER CONVERTS EVERY SPARE CARD ' +
      'EVERY TIME, THE AUGUST VERDICT WAS RIGHT AND THE PLACEMENT IS WHAT TO CHANGE.',
    `⭐ 1. THE OFFER RATE - DOES ANYBODY EVER DECLINE? ${w.used} of ${w.offered} exchange ` +
      `windows converted at least one card, ${pct(offerRate)}. A window is one delivery at ` +
      'which a conversion was POSSIBLE, counted off the `mint` TASK the engine pushes and ' +
      'never off the `delivered` event, because V14 The Village Wagon emits a second ' +
      '`delivered` for the same payment and a delivery-keyed count would report one window as ' +
      'two.',
    `⭐⭐ 2. THE DEPTH - OF THE CARDS THEY COULD HAVE CONVERTED, HOW MANY DID THEY? ` +
      `${w.converted} of ${w.ceiling} convertible cards, ${pct(value)}. The ceiling of a ` +
      'window is min(barn after the crate was paid, coins left in the supply), which is ' +
      'exactly the cards a conversion was available for. ⚠️ V3 IS WHY IT IS "AFTER THE CRATE": ' +
      'the exchange resolves once the delivery is paid, so a player can never convert the ' +
      'cards the delivery itself needs, and the ceiling is the SPARE barn and not the barn.',
    `⛔⛔ 3. C113’s SENTENCE TAKEN LITERALLY - EVERY SPARE CARD, EVERY TIME: ${w.emptied} of ` +
      `${w.offered} windows converted EVERY convertible card they had, ${pct(emptiedRate)}. ` +
      '⭐ THIS IS THE SHARPEST OF THE THREE AND IT IS THE ONE TO QUOTE. An offer rate near ' +
      '100% says nobody declines; a depth near 100% says they take nearly everything; THIS ' +
      'says they take ALL of it, every time, which is the thing August predicted. ⚠️ Read the ' +
      'three together: a high offer rate with a middling depth is a table that always trades ' +
      'and chooses HOW MUCH, which is a decision, and it is a different game from one that ' +
      'empties the barn on sight.',
    `⭐ 4. WAS IT THE BARN OR THE SUPPLY THAT SET THE CEILING? The windows offered a mean ` +
      `ceiling of ${num(w.ceiling / w.offered, 2)} cards against a mean barn of ` +
      `${num(w.barn / w.offered, 2)} cards standing behind them, so the supply clipped ` +
      `${pct(w.barn === 0 ? NaN : 1 - w.ceiling / w.barn)} of what the barn could have offered. ` +
      '⛔ THIS IS THE WHOLE OF DEAN’S ANSWER TO THE AUGUST OBJECTION AS A NUMBER. He argued ' +
      'the capped, shared, contested supply bounds the reward where the August version’s ' +
      'unbounded bank did not. A clip near zero means the cap never bound and the reward is ' +
      'effectively unbounded, which is the August version wearing a supply.',
    `⭐ 5. THE DELIVERIES THAT COULD NOT CONVERT AT ALL: ${w.blocked} of them, ` +
      `${w.blockedSupply} because the SUPPLY was empty and ${w.blockedBarn} because the BARN ` +
      `was (${pct(w.offered + w.blocked === 0 ? NaN : w.blocked / (w.offered + w.blocked))} of ` +
      'every delivery). ⚠️ THE TWO MEAN OPPOSITE THINGS AND MUST NEVER BE POOLED. An empty ' +
      'barn is a seat with nothing stranded, so the Store had no fault to fix and the delivery ' +
      'is an ordinary one. An empty supply is V4’s cap actually biting - the pressure Dean’s ' +
      `answer rests on. The supply held nothing on ` +
      `${pct(w.supplyTurns === 0 ? NaN : w.supplyEmptyTurns / w.supplyTurns)} of turns ` +
      'sampled; a25 carries that line in full. ⛔ A SUPPLY THAT NEVER EMPTIES IS A SUPPLY ' +
      'RATIONING NOTHING.',
    `BY SEAT COUNT, ALL THREE SHARES TOGETHER: ${bySeat
      .map(
        (s) =>
          `${s.seats}p [offer ${pct(s.w.offered === 0 ? NaN : s.w.used / s.w.offered)}  depth ` +
          `${pct(s.w.ceiling === 0 ? NaN : s.w.converted / s.w.ceiling)}  all-of-it ` +
          `${pct(s.w.offered === 0 ? NaN : s.w.emptied / s.w.offered)}  windows ${s.w.offered}]`,
      )
      .join('  ')}. ⚠️ EXPECT THE SUPPLY TO BITE HARDER AT FEWER SEATS WITHOUT THAT BEING A ` +
      `FINDING: the pool is ${coinSupplyPerPlayer(data)} a seat, so it scales with the table, ` +
      'but the game ends on a sixth delivery by ANY player and is therefore longer per seat at ' +
      'two. Read the rows and never the pooled figure.',
    '⚠️⚠️ WHAT THIS PAGE CANNOT DO, AND IT IS THE LINE THAT MATTERS MOST HERE. ⛔ A BOT THAT ' +
      'ALWAYS TAKES A FREE THING IS NOT PROOF A HUMAN WOULD. Nothing in the pricer has a term ' +
      'for a coin being worth less than the tie-break it costs (most cards in hand and barn ' +
      'combined, V12), and nothing models a player who simply does not bother. SO THIS IS A ' +
      'CEILING ON HOW AUTOMATIC THE DECISION IS, NOT A MEASUREMENT OF THE DECISION’S WEIGHT. A ' +
      'near-total reading says the RULES make declining pointless, which is exactly what C113 ' +
      'asks; it does not say a table would experience it as a phase of the turn. ⭐ Only a ' +
      'table can say that, and the mirror spread beside this page is the nearest thing the ' +
      'instrument has to a second opinion, which is why it is marked taste-sensitive.',
    '⛔ NO FAIL CONDITION, AND NOT EVEN AT 100%. The design names no number here; it names a ' +
      'CONSEQUENCE, which is that a very nearly total rate means the placement is what to ' +
      'change. That is a decision for Dean, and a threshold taken off the run that FIRST ' +
      'measures a quantity is a snapshot test that can never fail (ticket 11 section 2, and ' +
      'the cap-of-two lesson of 05/09/2026 repeated as commonsThreshold: 2 on 09/09/2026). ' +
      '⛔ AND THE REMEDY IS NOT A PRICE. If the rate is total, cutting ' +
      'rules.economy.storeCoinsPerCard or shrinking rules.economy.coinSupplyPerPlayer makes ' +
      'the reward smaller without making the choice real; the design’s own answer is to move ' +
      'the exchange off the delivery rider.',
    '⛔ THE INSTRUMENT IS reference-v15 AND THIS IS AN ARM ON TOP OF AN ARM. C100 is open and ' +
      'no Notice Board configuration is ruled in as the shipped game, so the control is only ' +
      'the best-performing configuration measured ' +
      '(overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json, 5 PASS / 1 FAIL / 11 ' +
      'OBSERVE) and not a ruling. No level here is comparable with a reference-v14 or earlier ' +
      'number, and ⚠️ THERE IS NO NOISE FLOOR FOR ANY LINE ON THIS PAGE: nothing here is in ' +
      'HEADLINE_METRICS and --noise has never been run against a Store arm. ⚠️ ONE ' +
      'APPROXIMATION IS NAMED IN observe.ts rather than hidden here: two `mint` tasks queued ' +
      'back to back for the same seat, the second opening at exactly the first’s remaining ' +
      'minus one, are folded as one window. It needs two deliveries with no drain between and ' +
      'costs one window in the denominator when it happens.',
  ];

  return {
    value,
    headline:
      `C113, THE AUGUST OBJECTION AS A TEST: ${pct(offerRate)} of ${w.offered} exchange ` +
      `windows converted at all, ${pct(value)} of the ${w.ceiling} convertible cards on offer ` +
      `were converted, and ${pct(emptiedRate)} of windows took EVERY convertible card they ` +
      `had. The supply clipped ${pct(w.barn === 0 ? NaN : 1 - w.ceiling / w.barn)} of what the ` +
      `barn could have offered, and ${w.blocked} deliveries could not convert at all ` +
      `(${w.blockedSupply} on an empty supply). ⛔ NEAR-100% ON ALL THREE IS THE AUGUST ` +
      'VERDICT CONFIRMED AND THE PLACEMENT IS WHAT TO CHANGE. ⚠️ A bot that always takes a ' +
      'free thing is not proof a human would: this is a CEILING on how automatic the decision ' +
      'is, not a measurement of its weight.',
    detail,
    verdict: 'OBSERVE',
  };
}

/** Kept beside the metrics type so a future reader can see what this file reads. */
export type StoreConversionMetrics = Pick<
  GameMetrics,
  | 'storeExchanges'
  | 'storeExchangeCeiling'
  | 'storeExchangeBarn'
  | 'storeExchangesUsed'
  | 'storeExchangesEmptied'
  | 'storeDeliveriesNoExchange'
  | 'storeDeliveriesNoExchangeEmptySupply'
  | 'storeDeliveriesNoExchangeEmptyBarn'
>;
