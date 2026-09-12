import type { GameData } from '@gp/data';
import {
  hostDrawCapPerRound,
  hostDrawOnVisit,
  hostDrawOnVisitAt,
  isCommons,
  isMeepleCurrency,
  isNoticeBoardPower,
} from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalTurns } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW ON 11/09/2026 WITH S17, THE HOST DRAW, and it is the faucet's own page.
 *
 * ## ⭐ THE RULE, AND ITS PROVENANCE IS A TABLE RATHER THAN A RUN
 *
 * S17, Dean, 11/09/2026: **when a neighbour visits you, you draw 1 card.**
 * `rules.turn.hostDrawOnVisit`, shipped at 0 and 1 under
 * `overlays/notice-board-visit-host-draw-v1.overlay.json`. Never on a
 * self-visit, and **per VISIT rather than per turn**.
 *
 * ⭐ **NOTHING ELSE IN THIS SUITE HAS THAT PROVENANCE.** Dean played
 * `overlays/notice-board-visit-two-boards-v1.overlay.json` at a two-player table
 * on 11/09/2026, house-ruled this in mid-session, and reported that the visiting
 * worked well, that everyone visited, that every Notice Board was used at some
 * stage, and that *"the rule that the person who gets visited draws a card led
 * to a lot of extra cards in play, which relieved the tightness of the game in a
 * useful way"*. The simulator is here to find what the table could not see in
 * one session, and it is not here to second-guess what the table did see.
 *
 * ⛔ **IT AMENDS S7**, which said in as many words that the fee resting on the
 * host's board "is the payment and there is no other". There is now one other
 * and it is paid INSTANTLY: **the host is paid twice**, once in a card drawn now
 * and once in material they must still harvest and then deliver. Do not quote S7
 * forward without S17 beside it.
 *
 * ## ⛔⛔ THE MEASUREMENT CAVEAT, AND IT IS THE MOST IMPORTANT THING ON THIS PAGE
 *
 * **THE SIMULATOR CANNOT MEASURE THE EFFECT DEAN ACTUALLY LIKED.** The engine
 * caps hands at `rules.turn.handLimit` as an INSTRUMENT BOUND (C7) while the
 * table plays with NO HAND LIMIT AT ALL, and this rule's principal effect is
 * MORE CARDS IN HAND - **so the instrument clips exactly the thing the table
 * enjoyed.**
 *
 * A run of this arm can honestly answer: does the bonus rate leave Dean's 30% to
 * 60% band (a17), what happens to the barn glut (a06), to game length, to
 * deliveries per player and to the hook (a08). **IT CANNOT ANSWER WHETHER THE
 * GAME FEELS LESS TIGHT.** ⛔ **No report of this arm may be quoted as evidence
 * about tightness, in either direction.** Every hand-size line below carries the
 * caveat and the bound on the same line, deliberately, because a number quoted
 * out of a report loses its header first.
 *
 * ## What it counts, and that the count is exact
 *
 * Host draws are `cardsToHand` events carrying **`via: 'hostDraw'`**, which is a
 * purely additive field the engine sets on this one producer and no other. So
 * the count is the cards that ACTUALLY REACHED A HAND and never the visits that
 * promised one - which is the right quantity rather than an approximation of a
 * better one: a draw task with no drawable deck has no legal answer and is
 * dropped, so **a dry table pays nothing**, and the gap between the payments and
 * the visits received is exactly how often that happened.
 *
 * ## ⚠️ W17 THE PIE SHOP NOW PAYS ITS OWNER TWICE, AND IT CAN BE SEPARATED
 *
 * W17 reads *"Whenever a neighbour visits you, Draw 1"*, which under S17 is a
 * duplicate of the rule in words - and the two STACK, because the card is a card
 * and the rule is a rule. **A W17 owner visited once draws two.** ⚠️ And they are
 * ASYMMETRIC: W17 carries the once-a-turn latch every card's text carries
 * (11/08/2026) and the rule does not, so **a W17 owner visited twice in one turn
 * draws THREE and not four.**
 *
 * ⭐ **THE DUPLICATION CAN BE READ AS A NUMBER**, which was not obvious: W17's
 * cards arrive on an ordinary unlabelled `cardsToHand`, so the event stream
 * alone cannot tell them from any other draw. The draw TASK carries `src:
 * 'W17'`, so the count is folded at the keep answer instead, and it is exact.
 * ⛔ **The retext is a SHEET decision Dean has not made**, so nothing here
 * prescribes one; this page is the reading it needs when he does.
 *
 * ## ⛔ NO FAIL CONDITION, AND THAT IS THE POINT RATHER THAN A GAP
 *
 * The design names no number for a faucet. It names a rate band for the bonus
 * slot (a17 carries it), a drain shape for the barn (a06), and a floor for the
 * hook (a08) - and this rule is expected to move all three. A threshold invented
 * here off the first run of an arm nobody has simulated would be a snapshot test
 * that can never fail (ticket 11 section 2). **The reading that decides anything
 * is the DELTA against
 * `overlays/notice-board-visit-two-boards-v1.overlay.json`, which is ONE LEAF
 * away** - `rules.turn.hostDrawOnVisit`, 0 against 1 - on identical
 * `reference-v15` seeds.
 */
export const hostDraw: Assertion = {
  id: 21,
  title: 'The host draw (S17)',
  quote:
    'The rule that the person who gets visited draws a card led to a lot of extra cards in ' +
    'play, which relieved the tightness of the game in a useful way.',
  source: 'Dean, at a two-player table, 11/09/2026 (S17, rules.turn.hostDrawOnVisit)',
  shape:
    'The faucet: host draws per player per game and per turn by seat count, the share of ' +
    'visits that actually paid one, and the cards this rule adds as a share of every card ' +
    'drawn. W17 The Pie Shop counted apart, because the card and the rule both fire.',
  threshold:
    'OBSERVE, no fail condition: the design names no number for a faucet. The readings that ' +
    'carry a verdict are a17 (the rate, against Dean’s 30%-60% band of TURNS) and a06 (the ' +
    'barn glut). ⛔ AND THE ONE EFFECT DEAN NAMED - that the game felt less tight - IS ' +
    'UNMEASURABLE HERE, because the hand limit is the simulator’s bound and the table has none.',
  taste: false,
  remedy:
    `${NO_REMEDY}. The rule came off a table and not off a run, so the instrument's job is to ` +
    'say what it costs elsewhere rather than to price it. The pair is ' +
    'overlays/notice-board-visit-two-boards-v1.overlay.json, ONE LEAF away ' +
    '(rules.turn.hostDrawOnVisit 0 against 1), on identical reference-v15 seeds: run both and ' +
    'read the delta on a17, a06, a08, the game length and the deliveries per player. ' +
    '⛔ DO NOT READ THE HAND-SIZE LINES AS EVIDENCE ABOUT TIGHTNESS IN EITHER DIRECTION.',
  measure(ctx) {
    if (!isNoticeBoardPower(ctx.data)) return noSubject(ctx.data);
    return hostDrawMode(ctx);
  },
};

function hostDrawMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const n = hostDrawOnVisit(data);
  const capOn = hostDrawCapPerRound(data);
  const bound = data.rules.turn.handLimit;

  const cards = sum(games.map((g) => sum(g.hostDrawCardsBySeat)));
  const payments = sum(games.map((g) => sum(g.hostDrawPaymentsBySeat)));
  // ⭐ THE DENOMINATOR FOR "DID IT PAY", AND IT IS ALREADY IN THE FOLD: every
  // NON-SELF visit received, by host. A self-visit never pays the draw, so the
  // two populations match exactly and no correction is needed.
  const received = sum(games.map((g) => sum(g.visitsReceivedBySeat)));
  const drawn = sum(games.map((g) => g.cardsToHandTotal));
  const w17Cards = sum(games.map((g) => sum(g.w17DrawCardsBySeat)));
  const w17Fires = sum(games.map((g) => sum(g.w17DrawFiresBySeat)));

  const seats = sum(games.map((g) => g.seats));
  const handSampled = sum(games.map((g) => g.handSampledTurns));
  const handSum = sum(games.map((g) => g.handSizeSum));
  const handAtBound = sum(games.map((g) => g.handAtBoundTurns));
  const handMax = games.length === 0 ? NaN : Math.max(...games.map((g) => g.handSizeMax));

  // ⛔ THE HEADLINE QUANTITY: cards this rule added as a share of every card
  // drawn. It is the faucet's size expressed against the thing it is a faucet
  // OF, which is the only framing that survives a change of game length.
  const value = drawn === 0 ? NaN : cards / drawn;

  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const t = totalTurns(slice.ended);
      const c = sum(slice.ended.map((g) => sum(g.hostDrawCardsBySeat)));
      const p = sum(slice.ended.map((g) => sum(g.hostDrawPaymentsBySeat)));
      const r = sum(slice.ended.map((g) => sum(g.visitsReceivedBySeat)));
      const d = sum(slice.ended.map((g) => g.cardsToHandTotal));
      const st = sum(slice.ended.map((g) => g.seats));
      const hs = sum(slice.ended.map((g) => g.handSampledTurns));
      const hm = sum(slice.ended.map((g) => g.handSizeSum));
      const hb = sum(slice.ended.map((g) => g.handAtBoundTurns));
      const w = sum(slice.ended.map((g) => sum(g.w17DrawCardsBySeat)));
      return {
        seats: slice.seats,
        perPlayerGame: st === 0 ? NaN : c / st,
        perTurn: t === 0 ? NaN : c / t,
        paidShare: r === 0 ? NaN : p / r,
        shareOfDraws: d === 0 ? NaN : c / d,
        received: r === 0 ? NaN : r / Math.max(1, st),
        hand: hs === 0 ? NaN : hm / hs,
        atBound: hs === 0 ? NaN : hb / hs,
        w17: w,
      };
    });

  // ⭐ THE RULE CAN NOW BE ON AT ONE SEAT COUNT AND OFF AT ANOTHER
  // (`rules.turn.hostDrawOnVisitBySeats`, 11/09/2026), so "is it on" is a
  // question per seat count and the scalar `n` is only the BASE.
  const bySeats = [2, 3, 4].map((seats) => ({ seats, n: hostDrawOnVisitAt(data, seats) }));
  const shaped = bySeats.some((r) => r.n !== n);
  // ⛔ OFF means off EVERYWHERE. A run that pays at two and three seats and not
  // at four is emphatically not "the rule off", and reporting it as such would
  // hide the only arm that reaches the four-seat breach.
  const off = n <= 0 && bySeats.every((r) => r.n <= 0);

  const detail = [
    `⛔⛔ THE MEASUREMENT CAVEAT, FIRST AND NOT LAST, BECAUSE IT IS WHAT THIS PAGE IS MOST ` +
      'LIKELY TO BE QUOTED PAST: THE SIMULATOR CANNOT MEASURE THE EFFECT DEAN ACTUALLY LIKED. ' +
      `The engine bounds the hand at ${bound === null ? 'nothing on this run' : bound} as an ` +
      'INSTRUMENT bound (C7) and THE TABLE PLAYS WITH NO HAND LIMIT AT ALL. This rule’s ' +
      'principal effect is MORE CARDS IN HAND, so the instrument clips exactly the thing the ' +
      'table enjoyed. A run can honestly answer whether the bonus rate leaves Dean’s 30%-60% ' +
      'band (a17), what happens to the barn glut (a06), to game length, to deliveries per ' +
      'player and to the hook (a08). ⛔ IT CANNOT ANSWER WHETHER THE GAME FEELS LESS TIGHT, AND ' +
      'NO REPORT OF THIS ARM MAY BE QUOTED AS EVIDENCE ABOUT TIGHTNESS IN EITHER DIRECTION.',
    `⭐ THE RULE, AND ITS PROVENANCE IS A TABLE RATHER THAN A RUN, which nothing else in this ` +
      'suite can say. S17, Dean, 11/09/2026: when a neighbour visits you, you draw 1 card. ' +
      'Never on a self-visit, and PER VISIT rather than per turn - so A Helping Hand sending a ' +
      'second visit to the same owner pays them twice, because they also receive two fee cards ' +
      'and the payment is for the fee rather than for the turn. ⛔ IT AMENDS S7, under which ' +
      'the fee card resting on the host’s board was the host’s ENTIRE payment: THE HOST IS NOW ' +
      'PAID TWICE, a card now and the fee card later, and S7 must never be quoted forward ' +
      'without S17 beside it.',
    off
      ? `⛔ THE RULE IS OFF ON THIS RUN (rules.turn.hostDrawOnVisit ${n}), SO EVERY NUMBER BELOW ` +
        'IS A STRUCTURAL ZERO AND NOT A FINDING. This is the CONTROL column, ' +
        'overlays/notice-board-visit-two-boards-v1.overlay.json and its own control, where the ' +
        'fee resting on the board is the host’s whole payment (S7 unamended). The page is ' +
        'printed anyway so that the pair can be diffed line for line: a column that appeared ' +
        'and disappeared could not be.'
      : `⭐ THE RULE IS ON: rules.turn.hostDrawOnVisit ${n}.${
          shaped
            ? ' ⛔⛔ AND IT IS SHAPED BY SEAT COUNT ON THIS RUN ' +
              `(rules.turn.hostDrawOnVisitBySeats): ${bySeats
                .map((r) => `${r.seats}p pays ${r.n}`)
                .join('  ')}. ` +
              'A SEAT COUNT PAYING 0 CONTRIBUTES NOTHING TO ANY POOLED NUMBER ON THIS PAGE, so ' +
              'read every pooled figure below as an average over UNLIKE seat counts and quote ' +
              'the per-seat rows instead. ⭐ THE ARM EXISTS BECAUSE PRICING THE FAUCET IS A DEAD ' +
              'LEVER, MEASURED: a cap of one payment per host per round removed 28.7% of the ' +
              'payments at four seats and returned 0.5 points of rate (64.9% to 64.4%, still ' +
              'out of band), so the rate is nearly insensitive to the faucet’s SIZE and ' +
              'only its PRESENCE is left to change.'
            : ''
        } Its control is ` +
        'overlays/notice-board-visit-two-boards-v1.overlay.json and THE TWO DIFFER IN EXACTLY ' +
        'ONE LEAF, so every delta between the two columns is this rule and nothing else. Run ' +
        'them paired on identical reference-v15 seeds.',
    `THE FAUCET: ${cards} cards were drawn by hosts over ${games.length} games, ` +
      `${num(seats === 0 ? NaN : cards / seats, 2)} PER PLAYER PER GAME and ` +
      `${num(turns === 0 ? NaN : cards / turns, 3)} per turn. By seat count (per player per ` +
      `game / per turn): ${rows
        .map((r) => `${r.seats}p ${num(r.perPlayerGame, 2)} / ${num(r.perTurn, 3)}`)
        .join('  ')}. ⚠️ READ IT BESIDE THE VISITS RECEIVED, which is what it is a rate ON: ` +
      `${rows.map((r) => `${r.seats}p ${num(r.received, 2)} received a player`).join('  ')}.`,
    `⭐ THE SHARE OF VISITS THAT ACTUALLY PAID ONE: ${payments} payments over ${received} ` +
      `non-self visits received (${pct(received === 0 ? NaN : payments / received)}). By seat ` +
      `count: ${rows.map((r) => `${r.seats}p ${pct(r.paidShare)}`).join('  ')}. ⛔ IT CAN BE ` +
      'BELOW 100% AND THAT IS THE RULE DEGRADING GRACEFULLY RATHER THAN A BUG: a draw with no ' +
      'drawable deck has no legal answer and the engine drops the task, so A DRY TABLE PAYS ' +
      'NOTHING. This counter is CARDS ACTUALLY DRAWN and never visits promised, which is the ' +
      'right quantity - a faucet that cannot run is not a faucet - and the shortfall against ' +
      '100% is exactly how often the decks had nothing left to give. ' +
      (capOn
        ? '⛔⛔ THE HOST-DRAW CAP IS ON (rules.turn.hostDrawCapPerRound), SO THE SENTENCE ABOVE ' +
          'IS NO LONGER THE WHOLE STORY AND THIS LINE MUST NOT BE READ AS A DECK READING. A ' +
          'host is paid AT MOST ONCE between their own turns, so the shortfall now has TWO ' +
          'causes - a dry table, and a payment the cap refused - and NOTHING IN THE EVENT ' +
          'STREAM SEPARATES THEM, because a refusal pushes no task and emits nothing. ⭐ THE ' +
          'SEPARATION IS THE PAIR AND NOT THIS PAGE: the one-leaf control is ' +
          'overlays/notice-board-visit-host-draw-v1.overlay.json, whose shortfall is dry decks ' +
          'ALONE, so THE DIFFERENCE BETWEEN THE TWO SHORTFALLS ON IDENTICAL SEEDS IS THE CAP ' +
          'AND NOTHING ELSE. ⚠️ Read it that way round and never as an absolute. ⛔ AND THE ' +
          'ORDER INSIDE THE ENGINE IS THE REASON THE PAIRING IS SOUND: a dry table returns ' +
          'BEFORE the latch is set, so a payment nobody could take never burns the entitlement ' +
          'and the two causes do not compound. '
        : '') +
      '⚠️ THE DENOMINATOR IS ' +
      'NON-SELF VISITS BY CONSTRUCTION: a self-visit never pays the draw (it would be a pure ' +
      'faucet with no giver, the shape the RESTOCK ban closed), so the two populations match ' +
      'and no correction is applied.',
    `⛔ WHAT THE RULE ADDED TO THE GAME, AS A SHARE OF EVERY CARD DRAWN: ${pct(value)} - ` +
      `${cards} of ${drawn} cards that reached a hand on a draw. By seat count: ${rows
        .map((r) => `${r.seats}p ${pct(r.shareOfDraws)}`)
        .join('  ')}. ⚠️ THE DENOMINATOR IS EVERY \`cardsToHand\` CARD - the base Draw, the ` +
      'bonus Draw, every card ability’s draw and the host draw itself - and it deliberately ' +
      'EXCLUDES the starting hand, a gift (`cardGifted`) and a take of a central pile, because ' +
      'the question is what share of the DRAWING this rule accounts for and none of those three ' +
      'is a draw. ⭐ THIS IS THE LINE TO QUOTE FOR "how big is the new faucet", because it ' +
      'survives a change in game length where a per-game count does not: the arm is expected to ' +
      'shorten or lengthen the game and a raw count would move for that reason alone.',
    w17Fires === 0
      ? `⚠️ W17 THE PIE SHOP: 0 firings on this run, so the DUPLICATION HAS NO SUBJECT IN THIS ` +
        'SAMPLE and the separation below is untested rather than absent. W17 reads "Whenever a ' +
        'neighbour visits you, Draw 1", which under S17 says the same thing the rule says, and ' +
        'THE TWO STACK: the card is a card and the rule is a rule, they are pushed as two ' +
        'separate tasks and nothing suppresses either. It fires only where a seat has BUILT ' +
        'W17, so a zero here is a card nobody built rather than a rule that did not fire.'
      : `⚠️ W17 THE PIE SHOP PAYS ITS OWNER A SECOND CARD, AND THE DUPLICATION IS ` +
        `${w17Cards} CARDS OVER ${w17Fires} FIRINGS - a further ` +
        `${pct(drawn === 0 ? NaN : w17Cards / drawn)} of every card drawn, against the rule’s ` +
        `own ${pct(value)}. By seat count (W17 cards): ${rows
          .map((r) => `${r.seats}p ${r.w17}`)
          .join('  ')}. ⭐ YES, IT CAN BE SEPARATED, AND IT IS EXACT. W17’s cards arrive on an ` +
        'ordinary unlabelled `cardsToHand`, so the EVENT stream alone cannot tell them from any ' +
        'other draw; the draw TASK carries `src: "W17"`, so the count is folded at the keep ' +
        'answer instead. ⚠️ AND THE TWO ARE ASYMMETRIC, which is worth knowing before any ' +
        'retext: W17 carries the once-a-turn latch every card’s text carries (11/08/2026) and ' +
        'THE RULE DOES NOT, so a W17 owner visited ONCE draws two and one visited TWICE in a ' +
        'turn draws THREE rather than four. ⛔ THE RETEXT IS A SHEET DECISION DEAN HAS NOT ' +
        'MADE, and nothing here prescribes one.',
    `⛔ HAND SIZE, AND EVERY NUMBER IN THIS LINE IS A READING ABOUT THE INSTRUMENT AND NOT ` +
      `ABOUT THE DESIGN (hand limit ${bound === null ? 'NONE on this run' : bound}, THE ` +
      `SIMULATOR’S BOUND, C7 - the table plays with none): mean hand at the start of a turn ` +
      `${num(handSampled === 0 ? NaN : handSum / handSampled, 2)} over ${handSampled} sampled ` +
      `turns, deepest ${num(handMax, 0)}. By seat count (mean hand, INSTRUMENT reading, ` +
      `bound ${bound === null ? 'none' : bound}): ${rows
        .map((r) => `${r.seats}p ${num(r.hand, 2)}`)
        .join('  ')}.`,
    `⛔ THE CLIPPING, AS A NUMBER, AND IT IS STILL A READING ABOUT THE INSTRUMENT (bound ` +
      `${bound === null ? 'none' : bound}): ${pct(handSampled === 0 ? NaN : handAtBound / handSampled)} ` +
      `of ${handSampled} turns began AT the bound. By seat count: ${rows
        .map((r) => `${r.seats}p ${pct(r.atBound)}`)
        .join('  ')}. ⭐ THIS IS THE ONE HAND LINE WORTH READING ACROSS THE PAIR, and it is ` +
      'read as a measure of HOW MUCH THE INSTRUMENT IS CLIPPING rather than of how full a hand ' +
      'got: a turn that begins at the bound is a turn where the engine, and not the game, ' +
      'decided what happened to the next card. ⛔ IF IT RISES UNDER THE ARM, THE ARM IS BEING ' +
      'MEASURED THROUGH A NARROWER WINDOW THAN THE CONTROL WAS, which weakens every other ' +
      'number on the pair and is a reason to distrust a small delta rather than a reason to ' +
      'quote this one.',
    '⛔ NO FAIL CONDITION ON ANY LINE ABOVE, AND THE COMPARISON IS THE READING. The design ' +
      'names no number for a faucet; what it names are a band for the bonus rate (a17, on the ' +
      'share of TURNS), a drain shape for the barn (a06) and a floor for the hook (a08), and ' +
      'this rule is expected to move all three. ⚠️ EXPECT THE RATE TO RISE: a card handed back ' +
      'on every visit makes the next visit easier to afford, the control PASSES at 51.7% of ' +
      'turns pooled (2p 44.0 / 3p 49.2 / 4p 59.9), and FOUR SEATS IS ALREADY ONE TENTH OF A ' +
      'POINT INSIDE THE 60% CEILING. If any seat count leaves the band, that is the finding and ' +
      'a17 is the headline rather than this page.',
    '⭐ WHY THE SHAPE IS DEFENSIBLE, RECORDED BECAUSE IT WILL BE ASKED AGAIN. This project ' +
      'banned RESTOCK as "a per-interaction bank faucet", and the standing rule beside that ban ' +
      'reads: if a give-cards effect returns, it pays in DRAWS. A host draw comes off a DECK ' +
      'and never off a bank, so it is the shape the ban left open rather than the shape the ban ' +
      'closed. ⚠️ AND THE COST IS REAL RATHER THAN ARGUED AWAY: every visit paid this way ADDS ' +
      'A CARD TO THE GAME, which is why the barn glut (a06) and the game length have to be read ' +
      'beside the rate rather than after it.',
  ];

  return {
    value,
    headline: off
      ? `NO HOST DRAW ON THIS RUN (rules.turn.hostDrawOnVisit 0) - the S7 game, where the fee ` +
        `resting on the board is the host's whole payment. This is the CONTROL column of the ` +
        `one-leaf pair; ${received} non-self visits were received and none of them paid a card.`
      : `THE FAUCET: ${num(seats === 0 ? NaN : cards / seats, 2)} host draws per player per ` +
        `game (${num(turns === 0 ? NaN : cards / turns, 3)} a turn), paid on ` +
        `${pct(received === 0 ? NaN : payments / received)} of ${received} visits received, ` +
        `adding ${pct(value)} of every card drawn` +
        (w17Fires > 0
          ? `; W17 The Pie Shop adds a further ${pct(drawn === 0 ? NaN : w17Cards / drawn)} on ` +
            `top of it (${w17Cards} cards, separated exactly off the draw task's own src)`
          : '') +
        `. ⛔ AND THE ONE EFFECT DEAN NAMED IS UNMEASURABLE HERE: the hand limit of ` +
        `${bound === null ? 'none' : bound} is the SIMULATOR'S bound (C7) and the table plays ` +
        `with none, so this page cannot say whether the game feels less tight`,
    detail,
    verdict: 'OBSERVE',
  };
}

/**
 * ⭐ NO SUBJECT, naming the mode and pointing somewhere rather than printing a
 * blank - the pattern a08, a18, a19 and a20 all use.
 *
 * The rule pays a HOST, and only one game in this codebase has one. Under the
 * commons every board is ownerless (C1), so there is nobody to pay; under the
 * meeple loop the host is paid in meeples collected back off their own board;
 * under the v31 card game the fee rides to the host's barn on their Harvest,
 * which is the S7 shape S17 amends and not a thing S17 was ever written against.
 */
function noSubject(data: GameData): Measurement {
  const why = isCommons(data)
    ? 'NO SUBJECT UNDER THE COMMONS: the five boards are ownerless (C1), so a play is paid to ' +
      'nobody and there is no host to draw. a18-commons-traffic carries the centre’s flows.'
    : isMeepleCurrency(data)
      ? 'NO SUBJECT UNDER THE MEEPLE LOOP: the host is paid in the meeples they Collect back ' +
        'off their own board, which is a different payment in a different currency. ' +
        'a15-meeple-economy carries it.'
      : 'NO SUBJECT UNDER THE v31 CARD GAME: the fee rides to the host’s barn on their own ' +
        'Harvest, which is the S7 shape S17 amends rather than a thing S17 competes with. ' +
        'a02-generosity carries that transfer.';
  return {
    value: NaN,
    headline: why,
    detail: [
      '⭐ THIS ASSERTION IS FOR ONE RULE AND ONE MODE: S17, the host draw of the notice-board ' +
        'visit (rules.turn.visitCurrency "noticeBoardPower", rules.turn.hostDrawOnVisit, Dean ' +
        '11/09/2026), where a Notice Board has an OWNER and a visit therefore has a person on ' +
        'the receiving end of it.',
      '⛔ ITS COUNTERS ARE NOT SAMPLED UNDER THE OTHER MODES, which is deliberate rather than ' +
        'lazy: an empty denominator reads as "not measured", which is the truth, where a zero ' +
        'over a real denominator would read as "the faucet never ran", which is a finding about ' +
        'a rule that is not in the game.',
    ],
    verdict: 'OBSERVE',
  };
}
