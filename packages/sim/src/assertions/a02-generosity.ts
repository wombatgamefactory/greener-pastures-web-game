import { isMeepleCurrency } from '@gp/data';
import type { PolicyId } from '@gp/bots';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { seatRows } from './lib.js';
import type { SeatRow } from './lib.js';
import { num, pct, proportion, separated, sum } from '../stats.js';

/**
 * Watch-list 2, flagged in the design as "the number one thing to watch", and
 * RE-POINTED FOR v31 (02/09/2026) onto the only half of it that survives.
 *
 * ⛔ THE WAGE IS GONE, AND WITH IT THE RATIO THIS ASSERTION USED TO BE. Under
 * v14 a visit paid the HOST coins the bank minted and the VISITOR an action,
 * and the whole difficulty was finding one currency to compare them in - which
 * the old version solved by pricing the visitor's gain as what they GAVE UP
 * (the coin payoff the same board would have paid them for the same card, a
 * price the table itself set). v31 mints nothing at all. A visit is one card in
 * and one action out.
 *
 * So what is left of the generosity problem is exactly the card, which is what
 * the design always said was the load-bearing half: "if it bites, shrink the
 * wage - never remove the card". Your fee lands on a rival's Notice Board, they
 * Harvest it into their barn, and it arrives as the mixed colour the island
 * demands of them. Three numbers say whether that transfer is real:
 *
 *   PAID     fees placed on a rival's board - the gift as it leaves
 *   BANKED   fees the host actually harvested - the gift as it arrives
 *   LEADER   fees that went to the seat already ahead on VP
 *
 * The gap between paid and banked is the only thing that makes the transfer
 * less than total, and it is not a rounding error: a fee that dies on a board
 * nobody ever clears was never received. A HIGH banked share is the design
 * working as written ("your junk is their treasure") and simultaneously the
 * shape the BGG research flagged as the predecessor's number one dislike. This
 * instrument can measure the transfer; it cannot measure the resentment.
 *
 * ⚠️ IT IS OBSERVE NOW, and that is a demotion made on purpose rather than a
 * threshold left off. The old FAIL at 2.0x was a ratio of two coin figures and
 * both are deleted; the design names no number for the card, and inventing one
 * from this run's own output is the snapshot test ticket 11 section 2 forbids.
 *
 * **The leader half does not survive contact, and is deliberately excluded from
 * the verdict** - unchanged from the v14 version, because the confound is
 * structural rather than economic. Stratifying by bot profile removes the
 * obvious one (a `hermit` never visits anybody and wins a large share of its
 * games), but a seat that is winning IS the leader and you cannot visit
 * yourself, so "never visited the leader" is close to "led from the front" and
 * the negative that falls out is reverse causation wearing a measurement's
 * clothes. Answering it properly needs randomised visit targeting, which is an
 * experiment and not a metric.
 *
 * ## RE-CUT FOR THE MEEPLE-LOOP ARM (04/09/2026): THE GIFT IS A MEEPLE
 *
 * Under `rules.turn.visitCurrency: 'meeple'` no card is ever placed on a Notice
 * Board (R1), so `RivalFreight` reads a flat zero and the generosity question
 * has to be asked of the thing that IS given: a meeple into a rival's colour
 * slot. The arithmetic is the same shape and the meaning is not, which is why
 * the two are counted into two structures and never pooled:
 *
 *   GIVEN     meeples placed on rivals' boards - the gift as it leaves. A wild
 *             pair (R10) is ONE visit and TWO meeples, so this is not a visit
 *             count.
 *   HOME      of the meeples that landed on a seat's own board, the ones that
 *             survived the supply cap when that seat Collected. The parallel to
 *             BANKED, and it is the honest one: a card that dies on a board
 *             nobody clears was never received, and a meeple the cap refuses at
 *             the door was never received either.
 *   LEADER    meeples given to the seat that was already the sole VP leader.
 *
 * ⭐ AND WHAT IS GIVEN IS A DIFFERENT KIND OF THING. A card fee was freight -
 * the mixed colour the island demands, arriving in a rival's barn. A meeple is a
 * stored ACTION, and it arrives with a cost attached: while it sits in the slot
 * it shuts that colour of the host's farm to the whole table, so the same act is
 * a payment and a denial at once. `given - home` is the part of the payment the
 * cap ate, which has no analogue in the card game at all and is the one number
 * here that could argue the cap is set too tight.
 *
 * ⚠️ THE BGG RESENTMENT RISK IS NOT THE SAME RISK UNDER THE ARM, and nobody has
 * tested which way it cuts. "Reverse engine-building" was about handing a rival
 * a card that improves their farm. Handing them a stored action is more direct
 * and more visible, and it is also the only way anybody gets a second action at
 * all. The instrument can measure the transfer; it cannot measure the
 * resentment, under either arm.
 */
export const generosity: Assertion = {
  id: 2,
  title: 'The generosity problem',
  quote:
    'You give a rival a card. This is the exact shape the BGG research flagged as the ' +
    'predecessor\'s #1 dislike - "reverse engine-building" resentment. It is the number one ' +
    'thing to watch. If it bites, shrink the wage - NEVER remove the card. [02/09/2026] There ' +
    'is no wage left to shrink: the card is the whole of it.',
  source:
    'docs/Unified Visit v14.md section 7.2, re-pointed onto the card by ' +
    'docs/design-changes-v31-2026-09-02-v1.md (no coins) and onto the meeple by ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md section 4',
  shape:
    "Under visitCurrency 'card': fees paid onto rivals' Notice Boards per game, the share of " +
    'them the host actually harvested into their own barn, and the share that went to the seat ' +
    'already leading. Under "meeple": MEEPLES given to rivals per game (a wild pair is two), ' +
    "the share of those received that survived the cap on the owner's Collect, and the share " +
    'given to the sole VP leader. The leader line is reported and does NOT trigger the verdict ' +
    '- see below.',
  threshold:
    'OBSERVE under both arms. The wage the old 2.0x ratio was built on does not exist, and ' +
    'neither the design nor the handoff names a number for the card or for the meeple, so this ' +
    'reports the transfer and does not judge it.',
  taste: true,
  remedy:
    `${NO_REMEDY}. The design forbids the one obvious lever in as many words - never remove ` +
    'the card - and the wage it prescribes shrinking is deleted. Under "card", if the transfer ' +
    'reads as too generous the levers are rules.economy.noticeBoardThreshold (a tighter board ' +
    'banks fewer fees) and rules.turn.selfVisitAllowed (which decides how much traffic crosses ' +
    'the table at all). Under "meeple" the transfer IS the loop and cannot be shrunk without ' +
    'deleting the arm; the only knob that touches it is rules.turn.meepleCapPerColour ' +
    '(overlays/meeple-loop-cap-two-v1.overlay.json), which decides how much of the gift the ' +
    'host is allowed to keep.',
  measure(ctx) {
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/** The shipped v31 game, unchanged since 02/09/2026. */
function cardGame({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const paid = sum(games.map((g) => sum(g.freight.paidBySeat)));
  const banked = sum(games.map((g) => sum(g.freight.bankedBySeat)));
  const toLeader = sum(games.map((g) => sum(g.freight.toLeaderBySeat)));
  const perGame = games.length === 0 ? NaN : paid / games.length;
  const bankedShare = paid === 0 ? NaN : banked / paid;

  const leader = leaderPenalty(seatRows(games));
  return {
    value: perGame,
    headline:
      `${num(perGame, 2)} fees a game land on a rival's board, ` +
      `${pct(bankedShare)} of them reach the host's barn ` +
      `(${paid} paid, ${banked} banked over ${games.length} games)`,
    detail: [
      `${pct(paid === 0 ? NaN : toLeader / paid)} of fees went to the seat that was ` +
        'already the sole VP leader at that moment',
      'The banked share is the transfer made real: a fee that dies on a board nobody clears ' +
        'was never received. A high share is "your junk is their treasure" working, and it ' +
        'is the same shape the BGG research named as the resentment risk. The instrument can ' +
        'see the transfer; only a table can see the resentment.',
      `visiting the leader moves the win rate by ${leader.delta >= 0 ? '+' : ''}` +
        `${pct(leader.delta)}, stratified by bot profile - REPORTED, NOT JUDGED: a seat that ` +
        'is winning IS the leader and so cannot visit one, which makes this variable close to ' +
        '"was ever behind" and its sign reverse causation rather than a finding',
      ...leader.strata,
    ],
    verdict: 'OBSERVE',
  };
}

/**
 * The meeple-loop arm: the same three questions asked of a meeple.
 *
 * `value` stays "the gift per game" so the two arms' headline number is at least
 * the same KIND of thing, but they are not comparable and no report may subtract
 * one from the other: a fee was a card and this is a stored action.
 */
function meepleArm({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const given = sum(games.map((g) => sum(g.meepleGift.givenBySeat)));
  const received = sum(games.map((g) => sum(g.meepleGift.receivedBySeat)));
  // ⛔ R17 BROKE THIS RATIO AND THE FIRST RUN PRINTED 328.4%. `given` and
  // `received` count meeples arriving by a VISIT; `home` counts every meeple
  // that reached a supply off a board, and since 05/09/2026 a board also
  // receives meeples spent as CARDS (R17). So the numerator gained a source the
  // denominator never had. `placed` is that source, and adding it is what makes
  // the line mean "of every meeple that landed on somebody's board, how many
  // survived the cap" again - which is the question the assertion was always
  // asking, now that a board has two inlets instead of one.
  const placed = sum(games.map((g) => sum(g.meeplesPlacedBySeat)));
  const landed = received + placed;
  const home = sum(games.map((g) => sum(g.meepleGift.homeBySeat)));
  const toLeader = sum(games.map((g) => sum(g.meepleGift.toLeaderBySeat)));
  // Two different fates for a meeple that never reached its host's supply, and
  // only one of them is the cap's doing: BOXED means the host collected it and
  // the cap refused it at the door; STRANDED means the game stopped with it
  // still sitting in the slot, which is the exact analogue of a card fee that
  // dies on a board nobody ever clears. Pooling them would blame the cap for
  // the ending.
  const boxedOnCollect = sum(games.map((g) => g.meeplesBoxedBySource.collect ?? 0));
  const stranded = Math.max(0, received - home - boxedOnCollect);
  const wild = sum(games.map((g) => sum(g.wildVisitsBySeat)));
  const visits = sum(games.map((g) => sum(g.visitsBySeat)));
  const perGame = games.length === 0 ? NaN : given / games.length;

  const leader = leaderPenalty(seatRows(games));
  return {
    value: perGame,
    headline:
      `${num(perGame, 2)} meeples a game are given to a rival's board, ` +
      `${pct(landed === 0 ? NaN : home / landed)} of everything that lands on a board survives ` +
      `the cap and reaches the host's supply (${given} given by visit, ${placed} placed as ` +
      `payment under R17, ${home} kept over ${games.length} games)`,
    detail: [
      `${pct(given === 0 ? NaN : toLeader / given)} of meeples went to the seat that was ` +
        'already the sole VP leader at that moment',
      `${given} meeples over ${visits} visits, of which ${wild} were WILD PAIRS: a pair is one ` +
        'visit and two meeples, so this line is a component count and never a visit count.',
      `of ${landed} meeples landed on a board (${received} by visit, ${placed} as payment), ` +
      `${home} were kept, ${boxedOnCollect} were BOXED by the ` +
        `supply cap at the moment of collecting, and ${stranded} were still sitting in a slot ` +
        'when the game stopped. The boxed ones are the arm’s sharpest number: the host got the ' +
        'denial - a shut colour - and none of the payment, which is the case that ' +
        'rules.turn.meepleCapPerColour is set too tight (assertion 15 splits it by source and ' +
        'colour). The stranded ones are the exact analogue of a card fee dying on a board ' +
        'nobody ever cleared, and they are the ending’s doing rather than the cap’s.',
      '⭐ WHAT IS GIVEN HERE IS A STORED ACTION, NOT FREIGHT, and it arrives with a cost ' +
        'attached: while your meeple sits in their slot it shuts that colour of their farm to ' +
        'the whole table. The same act is a payment and a denial, which is exactly what the ' +
        'card fee never was. Read this line beside assertion 5’s blocked-want rate before ' +
        'calling any of it generous.',
      `visiting the leader moves the win rate by ${leader.delta >= 0 ? '+' : ''}` +
        `${pct(leader.delta)}, stratified by bot profile - REPORTED, NOT JUDGED: a seat that ` +
        'is winning IS the leader and so cannot visit one, which makes this variable close to ' +
        '"was ever behind" and its sign reverse causation rather than a finding',
      ...leader.strata,
    ],
    verdict: 'OBSERVE',
  };
}

/**
 * The leader-visit comparison, STRATIFIED BY BOT PROFILE.
 *
 * The unstratified version is worthless and the first real run proved it: a
 * `hermit` never visits anybody and wins a large share of its games, so
 * "visited the leader" and "is a hermit" are the same variable, and the raw
 * comparison reported an enormous, entirely spurious penalty. Comparing only
 * within a profile removes the confound at the cost of some power, and the
 * per-stratum lines are printed so the reader can see which profiles carry the
 * effect. A penalty counts only if EVERY stratum with a usable sample shows a
 * separated negative - one stratum is a coin flip, all of them is a signal.
 */
function leaderPenalty(rows: readonly SeatRow[]): {
  delta: number;
  penalty: boolean;
  strata: string[];
} {
  const byProfile = new Map<PolicyId, SeatRow[]>();
  for (const row of rows) {
    const profile = row.game.profiles[row.seat];
    if (!profile) continue;
    byProfile.set(profile, [...(byProfile.get(profile) ?? []), row]);
  }

  const strata: string[] = [];
  let weighted = 0;
  let weight = 0;
  let usable = 0;
  let negative = 0;
  for (const [profile, group] of [...byProfile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const did = group.filter((r) => (r.game.visitsToLeaderBySeat[r.seat] ?? 0) > 0);
    const not = group.filter((r) => (r.game.visitsToLeaderBySeat[r.seat] ?? 0) === 0);
    if (did.length < 10 || not.length < 10) {
      strata.push(`  ${profile}: too few of one kind (${did.length} did, ${not.length} did not)`);
      continue;
    }
    const a = proportion(did.filter((r) => r.won).length, did.length);
    const b = proportion(not.filter((r) => r.won).length, not.length);
    const clear = separated(a.interval, b.interval);
    usable += 1;
    if (clear && a.rate < b.rate) negative += 1;
    weighted += (a.rate - b.rate) * group.length;
    weight += group.length;
    strata.push(
      `  ${profile}: ${pct(a.rate)} (n=${a.trials}) against ${pct(b.rate)} (n=${b.trials})` +
        `, delta ${a.rate - b.rate >= 0 ? '+' : ''}${pct(a.rate - b.rate)}` +
        (clear ? ' SEPARATED' : ' overlapping'),
    );
  }
  if (usable === 0) strata.push(`  no profile had enough of both kinds; delta is ${num(NaN)}`);
  return {
    delta: weight === 0 ? NaN : weighted / weight,
    penalty: usable > 0 && negative === usable,
    strata,
  };
}
