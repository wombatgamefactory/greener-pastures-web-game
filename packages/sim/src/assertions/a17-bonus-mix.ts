import {
  commonsTakeGoesToHand,
  commonsWildPair,
  isCommons,
  isCommonsTakeCoins,
  isCommonsTakePaid,
  isCommonsTakeToHand,
  isCommonsTakeToSpend,
  isMeepleCurrency,
  hostDrawOnVisit,
  isNoticeBoardPower,
  noticeBoardsPerSeat,
  unclaimedBoardsToCentre,
} from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * NEW IN v31 (02/09/2026), and the direct successor to the retired assertion 14
 * (see `tombstones.ts`). New id rather than a re-point, because every column of
 * the old five-way tally named a currency and all of them are gone.
 *
 * THE BONUS SLOT IS THE INTERACTION SLOT, and the number that decides every
 * version of this rule set is the visit's share of it.
 *
 * ## ⭐ TWO ARMS, FOUR COLUMNS EACH, AND THE SAME SENTENCE UNDER BOTH
 *
 * `rules.turn.visitCurrency` decides which four columns this tally has, and the
 * columns are NOT comparable across the knob - only the verdict rule is. Under
 * the shipped `'card'` game (the control, and every report in `reports/` before
 * 04/09/2026):
 *
 *   Draw 1         the free solitaire card - the yardstick every door must beat
 *   visit RIVAL    a card on somebody else's board: the hook
 *   visit SELF     a card on your own board: solitaire, same slot, same price
 *   SLOT UNSPENT   turns minus bonus turns, derived where it is read
 *
 * Under the meeple-loop arm (Dean, 04/09/2026):
 *
 *   COLLECT EMPTY  your own board had nothing on it, so Collect was a Draw 1
 *   visit RIVAL    a meeple onto a neighbour's slot: the hook, and the only
 *                  kind of visit there is (X5 rules out the self-visit)
 *   COLLECT MEEPLES  your own board paid you back - the host side of the loop
 *   SLOT UNSPENT   as before
 *
 * ⭐⭐ THE EMPTY-BOARD COLLECT IS THE FREE DRAW 1 UNDER A NEW NAME, and getting
 * that right is most of the point of the re-cut. R9 deletes the standalone bonus
 * draw; the only card the slot can still draw is the one attached to Collect;
 * and Collect on an empty board is explicitly legal (R7) precisely so the slot
 * is never dead. So the solitaire option did not go away - it changed its
 * spelling, and an assertion that counted "collects" as one column would report
 * the solitaire line as host-side payment and call the hook healthy.
 *
 * ⭐ A COLLECT THAT TOOK MEEPLES HOME IS NOT SOLITAIRE AND IS NOT IN THE
 * VERDICT. It is the return leg of somebody else's visit: it exists only
 * because a rival spent a meeple on you, and the meeples it banks are what you
 * spend visiting back. Counting it against the hook would score the loop's
 * second half as evidence against the loop.
 *
 * ## The verdict, and what is deliberately kept out of it
 *
 * The design's own sentence has always been about one option OUTCOMPETING the
 * visit - "if market outnumbers visit, the hook is losing" - so the rule
 * restated over each menu is: the visit to a RIVAL must not be outnumbered by
 * the largest single SOLITAIRE option. That is Draw 1 or the self-visit under
 * the control, and the empty-board collect under the arm. It is a restatement of
 * the design's sentence and not a number taken from our own output, which is the
 * bar ticket 11 section 2 sets.
 *
 * ⛔ SLOT UNSPENT IS NOT IN THE VERDICT, and that is a ruling carried whole
 * from assertion 14. A forfeited slot did not outcompete anything - the plan
 * names it a different disease in as many words - and an assertion that can
 * only ever fail measures nothing.
 *
 * ## ⚠️⚠️ THE UNSPENT NUMBER IS THE RATIONAL FLOOR, NOT A PREDICTION
 *
 * This caveat must travel with the number wherever it is printed, and it is in
 * the detail lines rather than a footnote for that reason. The bonus slot is a
 * window that shuts the moment the seat has spent it, and a term-table argmax
 * always prefers the big main action, so the evaluator had to be taught to take
 * a closing window rather than let it lapse. What the sim therefore measures is
 * a player who never forgets. The plan wants unspent tallied because a HUMAN
 * "gets forgotten", and forgetting is a human failure a bot cannot model.
 *
 * **A low unspent share here is NOT evidence that the restriction is harmless at
 * a table.** It is evidence that a perfectly attentive player loses nothing to
 * it. The only honest reading is the DELTA against
 * `overlays/bonus-any-time.overlay.json`, and even that bounds the rational cost
 * rather than the real one.
 *
 * ⚠️ UNDER THE ARM THE UNSPENT FLOOR IS STRUCTURALLY LOWER AND THAT IS NOT A
 * RESULT. Collect is legal on an empty board with any deck alive, so the slot is
 * almost never dead; under the control a seat with an empty hand and no draw had
 * nothing to spend it on at all. Expect unspent to fall between the arms for
 * that reason alone, and do not read the fall as engagement.
 *
 * ## ⭐⭐ THE COMMONS (09/09/2026): TWO COLUMNS, AND A BAND INSTEAD OF THE LAW
 *
 * Under `rules.turn.visitCurrency: 'commons'` the slot holds exactly ONE option
 * (C9): play a card onto a central board and take that board's action. There is
 * no free Draw 1, no Collect and no self-visit, so the tally is
 *
 *   COMMONS PLAY  a card onto one of the five central boards - by board, since
 *                 the board IS the action bought
 *   SLOT UNSPENT  turns minus bonus turns, derived where it is read, as always
 *
 * ⛔ **AND THE SOLITAIRE LAW HAS NO SUBJECT.** Every verdict this assertion has
 * ever carried was "the visit must not be outnumbered by the largest single
 * SOLITAIRE option", and under the commons there is no other option in the slot
 * at all - nothing to be outnumbered BY. Ratio, largest-solitaire and the
 * early/late split all go with it. Keeping the law here and reading it against
 * zero would return a triumphant PASS on a table that never plays a card, which
 * is the exact failure mode the law itself was written to stop.
 *
 * ⭐ **WHAT REPLACES IT IS DEAN'S BAND, AND IT IS A NUMBER HE SET RATHER THAN
 * ONE TAKEN FROM OUR OWN OUTPUT** - which is the bar ticket 11 section 2 sets,
 * and the first time this assertion has had a threshold that clears it cleanly.
 * Dean, 09/09/2026, on how often the bonus should be taken: *"30%-60% of the
 * time... earned, not automatic."* Both ends are live and they fail for
 * opposite reasons:
 *
 *   BELOW 30%  the fee is too dear, or the boards buy too little, and the
 *              commons is decoration. A card for an action is a trade nobody is
 *              making.
 *   ABOVE 60%  the bonus is AUTOMATIC. Dean's own word: a slot taken on three
 *              turns in five is a choice, one taken on four is a phase of the
 *              turn wearing a choice's clothes, and `rules.economy.
 *              commonsThreshold` is the one number that pulls it back (C10).
 *
 * ⚠️ **THE BAND IS READ PER SEAT COUNT AS WELL AS POOLED, AND THE PER-SEAT
 * READING IS THE ONE THAT CARRIES THE VERDICT.** The handoff's measurement plan
 * asks the question that way round - "above 60% at two players means the
 * threshold knob is the next run" - because the pool is dominated by whichever
 * seat count happens to have the most turns in it, and a 2-player game running
 * hot could hide inside a healthy pooled number. Any seat count outside the
 * band fails the assertion; the pooled figure is the headline.
 *
 * ⚠️ AND THE UNSPENT CAVEAT BELOW APPLIES WITH MORE FORCE, NOT LESS. Under the
 * commons a play COSTS A CARD, so an unspent slot is a seat that declined to pay
 * rather than one that had nothing to spend (C9's own wording). It is still the
 * rational floor and still not a prediction: a bot never forgets the slot and
 * never mis-prices a card it will want next turn.
 *
 * ## ⭐⭐ THE COMMONS WITH COINS (10/09/2026): A FOURTH THREE-COLUMN ARM, AND
 * ## THREE QUANTITIES THAT MUST NEVER BE CONFLATED AGAIN
 *
 * `rules.turn.commonsTake: 'coins'` (K3/K4, Dean 10/09/2026) puts a second
 * option back in the slot: discard every card on one central pile to its cards'
 * own suit discards and take ONE COIN PER CARD. It counts here exactly as
 * `'bonus'` and `'paid'` do - PLAY / COIN TAKE / SLOT UNSPENT as shares of every
 * turn played, the verdict on the slot's TOTAL use against Dean's band - and it
 * differs only in what the taker receives and where the cards go, which is a18's
 * and a19's business rather than this file's.
 *
 * ⛔ **WHAT IS THIS FILE'S BUSINESS IS THE DENOMINATOR, BECAUSE THE ARM BREAKS IT
 * FOR THE SECOND TIME.** `rules.economy.commonsWildPair` (K3) lets two cards of
 * any colours pay for one board, and the engine emits one `commonsPlayed` per
 * CARD, so under this arm there are THREE different numbers where the shipped
 * game has two:
 *
 *   TURNS THAT USED THE SLOT  at most one per turn - **THE VERDICT QUANTITY**,
 *                             and the only one Dean's 30-60% band is written in
 *   PLAYS                     one per `commons` MOVE - A Helping Hand can put
 *                             two in one turn (C8)
 *   CARDS INTO THE CENTRE     one per `commonsPlayed` EVENT - a wild pair puts
 *                             TWO cards in for ONE play
 *
 * ⚠️ **THIS IS THE 09/09/2026 TRAP ARRIVING A SECOND TIME.** That day the band
 * was judged on plays per turn (68.5%) where the turn share read 58.9%, a FAIL
 * was reported that was not one, and all five arms had to be re-run on corrected
 * counters. A 30-game smoke run of the coin arm on 10/09/2026 printed "plays per
 * turn 67.8%" when the number was cards per turn. **Any rule that grants a second
 * one of the thing being counted breaks the denominator**, and this design now
 * has two such rules. All three quantities are printed side by side under the
 * arm, with the reconciliation (plays + wild-pair plays = cards) printed beside
 * them so a reader can check it rather than trust it.
 *
 * ## ⭐⭐ THE NOTICE-BOARD VISIT (10/09/2026): THREE COLUMNS, THE SAME BAND,
 * ## AND THE SPLIT THAT DECIDES THE DESIGN
 *
 * Under `rules.turn.visitCurrency: 'noticeBoardPower'` the centre is deleted and
 * the five Notice Boards go home to their owners as buildings. The slot holds
 * exactly ONE option again (S5) - play one card from your hand onto ANY
 * player's Notice Board and take that board's printed power - so the tally is
 *
 *   visit a NEIGHBOUR  a card onto somebody else's board: the hook, and the
 *                      card becomes their payment (S7)
 *   visit YOURSELF     a card onto your own board: solitaire, same slot, same
 *                      price, and RULED IN (S6)
 *   SLOT UNSPENT       turns minus bonus turns, derived where it is read
 *
 * ⛔ **THE VERDICT IS DEAN'S BAND AND NOT THE SOLITAIRE LAW, AND THAT IS A
 * CHOICE RATHER THAN AN INHERITANCE.** The `'card'` branch reads the law - the
 * visit must not be outnumbered by the largest single solitaire option - because
 * v31's slot held a free Draw 1 beside the visit. This slot holds no free
 * option at all: `bonusDrawOpen` is shut under this currency, there is no
 * Collect and there is no take, so the only thing the neighbour visit could be
 * outnumbered BY is the self-visit, which costs exactly the same card and is
 * ruled in on purpose. The question the design actually asks of this slot is
 * the one the commons asked: is the bonus earned or is it a phase of the turn?
 * That is Dean's band of 30% to 60% of TURNS, and it is read here exactly as it
 * is read under the commons. **The self share is reported as the headline risk
 * beside it and carries no verdict of its own**, because the design names a
 * number for the slot's use rate and names none for the split.
 *
 * ⛔⛔ **AND THE QUANTITY IS TURNS. IT IS THE ONE THING THIS FILE MUST NOT GET
 * WRONG AND IT HAS BEEN GOT WRONG BEFORE.** A Helping Hand grants a SECOND
 * bonus action (S9, to a different board), so a turn can contain two visits and
 * PLAYS PER TURN runs above the share of turns that used the slot. On
 * 09/09/2026 the band was judged on plays per turn (68.5%) where the turn share
 * read 58.9%, a FAIL was reported that was not one, and all five arms had to be
 * re-run on corrected counters. Both numbers are printed under this mode, each
 * labelled with its own denominator, and **only the turn share carries the
 * verdict**. Slot used plus slot unspent is every turn played and the two sum
 * to 100%; the three columns above do not, and the detail says so.
 *
 * ## The early/late split
 *
 * Kept from assertion 14 because the lesson it encodes was expensive: a CAPPED
 * option should spike early and then stop, and that shape is a PASS. Nothing in
 * either menu is capped - every option is repeatable every turn - so the split
 * now answers a different question. Under the control it is whether the
 * self-visit is an opening convenience or a whole-game strategy. Under the arm
 * the self-visit does not exist, so what the split asks is whether the visit is
 * front-loaded (everybody starts holding five meeples, R3, so the opening is
 * artificially rich) or sustained once the loop has to feed itself.
 */
/**
 * ⭐ DEAN'S BAND, 09/09/2026, and the only threshold in this file that was set
 * by the designer rather than restated from a design sentence: *"30%-60% of the
 * time... earned, not automatic."* Both ends fail, for opposite reasons - see
 * the header. Named as constants so the report prints the same two numbers the
 * verdict is taken against.
 */
const PLAY_FLOOR = 0.3;
const PLAY_CEILING = 0.6;

export const bonusMix: Assertion = {
  id: 17,
  title: 'The bonus mix, four ways',
  quote:
    'The bonus mix - Draw 1 / visit a neighbour / visit yourself / slot unspent. The visit ' +
    'share is still the number that decides it. A rising SLOT UNSPENT share is the ' +
    'restriction biting, and it is a different disease: the visit is not being outcompeted, it ' +
    'is being missed. [04/09/2026, the meeple loop] Re-cut four ways: visit a rival / collect ' +
    'with meeples / collect an empty board / slot unspent. The empty-board collect is the ' +
    'solitaire line to watch. [09/09/2026, the commons, Dean] The bonus should be taken ' +
    '"30%-60% of the time... earned, not automatic."',
  source:
    'docs/design-changes-v31-2026-09-02-v1.md part 4 (the suite) and part 1.1; CLAUDE.md ' +
    'watch-list item 0; docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 4 and 5; ' +
    'docs/commons-handoff-2026-09-09-v1.md section 2.7 and the measurement plan (section 3), ' +
    'carrying Dean’s band of 09/09/2026',
  shape:
    'The four-way tally as shares of every turn played. Under visitCurrency "card": Draw 1 / ' +
    'visit a rival / visit yourself / slot unspent, plus the self-visit share early against ' +
    'late. Under "meeple": visit a rival / collect with meeples / collect an EMPTY board / slot ' +
    'unspent, plus the rival visit early against late. Re-cut for handoff v2 (04/09/2026) with ' +
    'the toll line: the share of rival visits that paid a toll to enter an occupied slot (R6 ' +
    'amended), the mean toll paid, and the most-visited seat’s share of a game’s rival visits. ' +
    'Under "commons" it is TWO columns - commons play / slot unspent - as shares of every turn ' +
    'played, split by BOARD (the board is the action bought) and reported per seat count as ' +
    'well as pooled. Under rules.turn.commonsTake "bonus", "spend", "paid" or "coins" it is ' +
    'THREE - play / take / slot unspent - and under "coins" (10/09/2026) it also prints the ' +
    'three quantities the wild pair separates: turns that used the slot (the verdict), plays ' +
    'per turn and CARDS per turn, with plays + wild-pair plays = cards as the reconciliation. ' +
    '⭐ Under "noticeBoardPower" (10/09/2026, re-cut 11/09/2026) it is FOUR columns as shares ' +
    'of every turn played - visit your OWN board / visit a RIVAL / play the CENTRE / slot ' +
    'unspent - printed with the OWN / RIVAL / CENTRAL split BY SEAT COUNT and with the ' +
    'cross-table share of every play beside it, and with the verdict on the share ' +
    'of TURNS that used the slot against the same 30%-60% band, pooled and by seat count, ' +
    'plays per turn printed beside it, the board mix across all five boards wherever they sit ' +
    '(the board is the power bought) split OWNED against CENTRAL, and the self-visit early ' +
    'against late. ⛔ THE CENTRAL COLUMN IS A STRUCTURAL ZERO WHERE ' +
    'rules.economy.unclaimedBoardsToCentre IS FALSE AND IS PRINTED ANYWAY, because it is one ' +
    'of the two knobs the 2x2 of 11/09/2026 separates and a column that came and went could ' +
    'not be diffed across the four corners. Under Dean’s variant the OWN column is 0 by ' +
    'construction (self-visiting banned) and under the paired -unclaimed-self-v1 arm it is ' +
    'not, which is why both columns exist under both.',
  threshold:
    `Under "commons": FAIL if the PLAY RATE - the share of turns that play a card onto a ` +
    `central board - falls outside ${pct(PLAY_FLOOR, 0)} to ${pct(PLAY_CEILING, 0)} at ANY ` +
    'seat count or pooled. Dean set that band on 09/09/2026 ("30%-60% of the time... earned, ' +
    'not automatic"): below it the fee is too dear and the commons is decoration, above it the ' +
    'bonus is automatic and rules.economy.commonsThreshold is the number that pulls it back. ' +
    'The solitaire law has NO SUBJECT under the commons - the slot holds one option (C9), so ' +
    'there is nothing for the play to be outnumbered by, and reading the law against zero ' +
    'would return a PASS on a table that never played a card. ' +
    'FAIL if the visit to a RIVAL is outnumbered by the largest single SOLITAIRE option. Under ' +
    '"card" that is Draw 1 or the self-visit; under "meeple" it is the empty-board collect, ' +
    'which is what the free Draw 1 became (R9 deletes the standalone draw, R7 keeps the one ' +
    'attached to Collect). A collect that took meeples home is the host side of the loop and is ' +
    'NOT counted as solitaire. SLOT UNSPENT is reported but never carries the verdict: a ' +
    'forfeited slot did not outcompete anything, and the bots forfeit it whenever a big action ' +
    'is live. ' +
    '⭐ Under "noticeBoardPower": FAIL if the share of TURNS THAT USED THE SLOT falls outside ' +
    `${pct(PLAY_FLOOR, 0)} to ${pct(PLAY_CEILING, 0)} at ANY seat count or pooled - Dean’s ` +
    'same band, read on the same quantity. ⛔ THE QUANTITY IS TURNS AND NOT PLAYS PER TURN: A ' +
    'Helping Hand grants a second play (S9), and since 11/09/2026 a rival visit and a central ' +
    'play share the one slot, so plays per turn runs above the turn share and judging the band ' +
    'on it cost this project a re-run of five arms on 09/09/2026. ⛔ AND THE OWN / RIVAL / ' +
    'CENTRAL SPLIT CARRIES NO VERDICT EITHER, for the same reason the self share never did: ' +
    'the design names a number for the slot’s use rate and names none for where the play ' +
    'lands. It is the FIRST thing to read on this page all the same, because the rate can sit ' +
    'inside the band while the design has quietly stopped being about neighbours. THE ' +
    'SOLITAIRE LAW HAS NO SUBJECT THERE EITHER: the slot holds one option (the free Draw 1 is ' +
    'shut under this currency), so there is nothing for the neighbour visit to be outnumbered ' +
    'by except the self-visit, which costs the same card and is RULED IN (S6). The SELF SHARE ' +
    'is reported as the headline risk of the pass and carries no verdict, because the design ' +
    'names a number for the slot’s use rate and names none for the split.',
  taste: true,
  remedy:
    `${NO_REMEDY} - and the remedy depends on WHICH column won. Under "card": a SELF-VISIT ` +
    'share that beats the rival visit is risk 2, whose control is rules.turn.selfVisitAllowed ' +
    'false and whose brake is rules.economy.noticeBoardThreshold; a DRAW 1 share that beats it ' +
    'is the free option being too good, whose dial is rules.turn.bonusDraw. Under "meeple": an ' +
    'EMPTY-BOARD COLLECT share that beats the rival visit says the loop is not feeding itself, ' +
    'and the dials are rules.turn.bonusDraw (the draw attached to Collect - the same knob, now ' +
    'pricing the same solitaire line under a new name) and rules.turn.startingMeeplesPerColour ' +
    '(overlays/meeple-loop-no-starting-meeples-v1.overlay.json). A high UNSPENT share under ' +
    'either is the bonus window, whose control is overlays/bonus-any-time.overlay.json. ' +
    'Under "commons" the band has a knob at each end. ABOVE 60%: ' +
    'npm run sim -- --watchlist --overlay=overlays/commons-threshold-2.overlay.json   ' +
    '(rules.economy.commonsThreshold 2, which refuses a play onto a pile already that deep - ' +
    'C10, built for exactly this reading). BELOW 30%: the fee is buying too little, and the ' +
    'arm is overlays/commons-draw-three.overlay.json (the one contested door choice, Draw 3 ' +
    'against the shipped Draw 2); the turn-order control beside it is ' +
    'overlays/commons-bonus-last.overlay.json, because a bonus taken BEFORE the main action ' +
    'is a different offer from one taken after (C2). ' +
    '⭐ Under "noticeBoardPower" the band has a knob at each end too, and one of them is a ' +
    'STRUCTURE rather than a price, which is L3’s standing finding: ABOVE 60%, ' +
    'rules.economy.commonsColourMatch true is the strongest rate lever this project has ' +
    'measured (58.9% to 34.4% under the commons) and §5 of the handoff keeps it as a knob ' +
    'here rather than a rule, on the argument that the target set is already limited by player ' +
    'count. BELOW 30%, the five powers are the dial: rules.economy.noticeBoardPower is where ' +
    'each one’s size lives, and S13’s own lesson is that AVAILABILITY moves this number ' +
    'further than power does. ⛔ AND THE SELF SHARE HAS ITS OWN CONTROL, WHICH IS NOT A RATE ' +
    'LEVER: overlays/notice-board-visit-no-self-v1.overlay.json.',
  measure(ctx) {
    if (isCommons(ctx.data)) return commonsMode(ctx);
    // ⭐ ASKED BEFORE THE MEEPLE TEST AND BY NAME (10/09/2026). The
    // notice-board visit is not a meeple currency, so without this line it
    // would fall through to `cardGame`, which reads the SOLITAIRE LAW against a
    // free Draw 1 that this mode does not have - a ratio over a structural zero,
    // which returns a triumphant PASS on a table that never visits anybody.
    if (isNoticeBoardPower(ctx.data)) return noticeBoardMode(ctx);
    return isMeepleCurrency(ctx.data) ? meepleArm(ctx) : cardGame(ctx);
  },
};

/**
 * ⭐ DEAN'S VARIANTS' OTHER FREE OPTION (09/09/2026, `commonsTake: 'bonus'` OR
 * `'spend'`): how much of the SLOT'S ACTUAL USE was the free take rather than
 * the paid play. Not part of the verdict - see `commonsMode`'s own comment on
 * why - printed as the line that watches the solitaire law under a new name.
 */
function freeShareLine(plays: number, takes: number, modeName: string): string {
  const used = plays + takes;
  return (
    `⭐ THE FREE OPTION'S SHARE OF USED SLOTS: ${pct(used === 0 ? NaN : takes / used)} ` +
    `(${takes} takes of ${used} used slots, plays and takes together). This is the solitaire ` +
    'law arriving under a new name: every currency this project has shipped has watched whether ' +
    'a free option sharing the bonus slot with a paid one crowds it out (Draw 1 against the ' +
    `card visit, the empty-board Collect against the meeple visit), and commonsTake: '${modeName}' ` +
    'puts a free option back in the slot beside the paid commons play. ' +
    "⚠️ OBSERVE, NOT FAIL: Dean set a band for the slot's OVERALL use " +
    'rate (play or take together), not for the split between the two, so a high free share is a ' +
    'reading to watch rather than a threshold this assertion can fail on.' +
    (modeName === 'coins'
      ? " ⭐ AND IT IS SHARPER UNDER 'coins' THAN UNDER ANY EARLIER VARIANT, because the coin " +
        'take is the ONLY free option in the game and it hands back no cards at all (K4: the ' +
        'pile goes to its suits’ discards and leaves the game). Every earlier free take ' +
        'refilled the hand that pays for the next play, which is why they ran the slot at 74% ' +
        'to 89% of turns; this one cannot, so a high free share here is a table choosing a ' +
        'currency over an action rather than a table financing itself.'
      : '')
  );
}

/**
 * ⭐ THE COMMONS (C1-C10, 09/09/2026): two columns and Dean's band.
 *
 * The per-seat-count rows are computed first and the pooled figure second, and
 * the verdict reads BOTH: any seat count outside the band fails, because the
 * handoff's own measurement plan asks the question per seat count ("above 60% at
 * two players means the threshold knob is the next run") and a pooled number
 * hides a hot 2-player table inside a healthy average.
 */
function commonsMode({ data, pooled }: MeasureContext): Measurement {
  const takeToHand = isCommonsTakeToHand(data);
  const takeToSpend = isCommonsTakeToSpend(data);
  // ⭐ DEAN'S 'paid' VARIANT (09/09/2026): the SAME to-hand shape as `'bonus'`,
  // so it is folded into every place below that already asks "does a take
  // land in the hand" (`commonsTakeGoesToHand`) - it differs from `'bonus'`
  // only in whether it is FREE, which only the wording, never the counting,
  // has to know about.
  const takePaid = isCommonsTakePaid(data);
  // ⭐ THE COMMONS WITH COINS (K3/K4, Dean 10/09/2026): the FOURTH `commonsTake`
  // value and the fourth three-column arm. It counts exactly as `'bonus'` and
  // `'paid'` do - a `commonsTake` move sharing the slot with the paid play, one
  // `commonsTaken` event per take, all five boards - and differs only in what the
  // taker receives (one coin per card) and where the cards go (their suits'
  // discards, out of the game). a17 needs to know neither; a18 and a19 do.
  const takeCoins = isCommonsTakeCoins(data);
  const toHandOrPaid = commonsTakeGoesToHand(data);
  // Every take that emits `commonsTaken` for all five boards - the three
  // to-a-player values plus the coin mint. `'spend'` is the exception and reads
  // `commonsSpendTakesByBoard` instead, for the reason its own comment gives.
  const takesOffTakenEvent = toHandOrPaid || takeCoins;
  // The take column's name, declared here because the headline is built before the
  // detail lines are. 'COIN TAKE' rather than 'TAKE' under the arm because the two
  // words are the whole difference: nothing is taken to a hand.
  const takeLabel = takeCoins ? 'COIN TAKE' : 'TAKE';
  // ⭐ ALL THREE VARIANTS PRINT THE SAME THREE-COLUMN SHAPE (Dean, 09/09/2026):
  // a `commonsTake` sharing the slot with the paid `commons` play. They differ
  // only in what a take's cards then DO and whether the take itself costs
  // anything, which a17 does not need to know beyond the wording - see a18 for
  // the traffic and the sink.
  const threeColumn = takeToHand || takeToSpend || takePaid || takeCoins;
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);
  // ⛔ PLAYS, AND SINCE 10/09/2026 THAT IS NOT THE SAME QUANTITY AS CARDS. The
  // wild pair (K3) pays for one board with two cards, so `commonsPlaysBySeat` is
  // folded off the `commons` MOVE and `commonsCardsIntoCentreBySeat` off the
  // `commonsPlayed` EVENT. Under every knob but the pair the two are equal. See
  // the caveat line in the detail below, which is the same shape as A Helping
  // Hand's and is there for the same reason.
  const plays = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
  const cards = sum(games.map((g) => sum(g.commonsCardsIntoCentreBySeat)));
  const wildPairPlays = sum(games.map((g) => sum(g.commonsWildPairPlaysBySeat)));
  // ⭐ THE OTHER HALF OF THE SLOT. 0 by construction under the shipped
  // `'harvest'` rule, where `commonsTake` moves are never enumerated. Under
  // `'bonus'` and `'paid'` every take lands in a hand and `commonsTakesBySeat`
  // (off `commonsTaken`) counts all five boards; under `'spend'` that same
  // counter sees ONLY the orchard and wheat legs (the two
  // `commonsTaken`-emitting ones), so the total has to come off
  // `commonsSpendTakesByBoard` instead - a MOVE-level count that sees all five
  // boards a take can choose.
  const takes = takesOffTakenEvent
    ? sum(games.map((g) => sum(g.commonsTakesBySeat)))
    : takeToSpend
      ? sum(games.map((g) => sum(Object.values(g.commonsSpendTakesByBoard))))
      : 0;
  const unspent = Math.max(0, turns - bonusTurns);

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  // THE VERDICT IS TAKEN ON TURNS THAT USED THE SLOT, not on plays per turn.
  // Dean's band is "gives you a bonus action 30%-60% of the time", which is a
  // share of TURNS. A Helping Hand grants a second play (C8), so plays per turn
  // runs above it - 68.5% against 58.9% on the reference-v15 baseline of
  // 09/09/2026 - and judging plays per turn would fail a table for owning a card.
  // Both are printed; only the turn share carries the verdict (corrected
  // 09/09/2026, after the first baseline was read on the wrong quantity).
  //
  // ⭐ AND UNDER commonsTake: 'bonus' "USED" MEANS PLAY OR TAKE, NOT PLAY
  // ALONE: `bonusTurnsBySeat` counts a turn as a bonus turn on EITHER move
  // (see observe.ts's `turnEnded` fold), so this ratio and the band it is
  // read against are unchanged in shape - only the menu behind "used" grew a
  // free half.
  const value = bonusTurns / turns;
  const playsPerTurn = plays / turns;
  const cardsPerTurn = cards / turns;

  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const t = totalTurns(slice.ended);
      const p = sum(slice.ended.map((g) => sum(g.commonsPlaysBySeat)));
      const k = takesOffTakenEvent
        ? sum(slice.ended.map((g) => sum(g.commonsTakesBySeat)))
        : takeToSpend
          ? sum(slice.ended.map((g) => sum(Object.values(g.commonsSpendTakesByBoard))))
          : 0;
      const b = totalBonusTurns(slice.ended);
      return {
        seats: slice.seats,
        turns: t,
        rate: t === 0 ? NaN : b / t,
        playsPerTurn: t === 0 ? NaN : p / t,
        takesPerTurn: t === 0 ? NaN : k / t,
        unspent: t === 0 ? NaN : Math.max(0, t - b) / t,
      };
    });

  // By BOARD, which under the commons is by ACTION: the board decides what the
  // play buys (C3), so this row is the door mix asked of the plays rather than
  // of the door uses. a07 owns the door mix itself and reads a different table.
  // ⚠️ PAID PLAYS ONLY, even under `commonsTake: 'bonus'` - a take buys no
  // action (it is a free draw of a chosen pile), so it has no door to mix into.
  const byBoard = new Map<string, number>();
  for (const g of games) {
    for (const [board, n] of Object.entries(g.commonsPlaysByBoard)) {
      byBoard.set(board, (byBoard.get(board) ?? 0) + n);
    }
  }
  const boardLine = [...byBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(plays === 0 ? NaN : n / plays, 0)}`)
    .join('  ');

  const outOfBand = rows.filter((r) => Number.isFinite(r.rate) && outside(r.rate));
  const verdict: Measurement['verdict'] = !Number.isFinite(value)
    ? 'OBSERVE'
    : outside(value) || outOfBand.length > 0
      ? 'FAIL'
      : 'PASS';

  const headline = threeColumn
    ? `the bonus slot is used on ${pct(value)} of ${turns} turns ` +
      `(Dean's band ${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)}); ` +
      `PLAY ${share(plays)}, ${takeLabel} ${share(takes)}, SLOT UNSPENT ${share(unspent)}` +
      (outOfBand.length === 0
        ? ''
        : `; OUT OF BAND at ${outOfBand.map((r) => `${r.seats}p ${pct(r.rate)}`).join(', ')}`)
    : `the bonus slot is used on ${pct(value)} of ${turns} turns ` +
      `(Dean's band ${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)}); plays per turn ${pct(playsPerTurn)} ` +
      `(A Helping Hand's second play is the difference); SLOT UNSPENT ${share(unspent)}` +
      (outOfBand.length === 0
        ? ''
        : `; OUT OF BAND at ${outOfBand.map((r) => `${r.seats}p ${pct(r.rate)}`).join(', ')}`);

  // ⭐ DEAN'S 'spend' VARIANT'S OWN LINE (09/09/2026): takes by board, off
  // `commonsSpendTakesByBoard` - the only counter that sees all five boards a
  // `commonsTake` move can choose under this knob, where `commonsTaken` (and
  // so the "by BOARD PLAYED" line's sibling) only ever fires for orchard and
  // wheat. a18 carries what each board's take then DID with its pile.
  const spendTakesByBoard = new Map<string, number>();
  if (takeToSpend) {
    for (const g of games) {
      for (const [board, n] of Object.entries(g.commonsSpendTakesByBoard)) {
        spendTakesByBoard.set(board, (spendTakesByBoard.get(board) ?? 0) + n);
      }
    }
  }
  const spendTakesByBoardLine = [...spendTakesByBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(takes === 0 ? NaN : n / takes, 0)}`)
    .join('  ');

  // ⭐ THE COIN TAKE'S OWN BOARD MIX (K3, 10/09/2026), off `commonsTakesByBoard`
  // - which pile was worth clearing. It is a different question from the PAID
  // half's board mix above: that one says which action a table wanted to buy,
  // this one says which pile a table wanted gone (and paid for in coins).
  const coinTakesByBoard = new Map<string, number>();
  if (takeCoins) {
    for (const g of games) {
      for (const [board, n] of Object.entries(g.commonsTakesByBoard)) {
        coinTakesByBoard.set(board, (coinTakesByBoard.get(board) ?? 0) + n);
      }
    }
  }
  const coinTakesByBoardLine = [...coinTakesByBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(takes === 0 ? NaN : n / takes, 0)}`)
    .join('  ');

  const modeName = takeToHand ? 'bonus' : takePaid ? 'paid' : takeCoins ? 'coins' : 'spend';
  const takeDescription = takeToHand
    ? 'a whole central pile taken free to hand - no card, no fee'
    : takePaid
      ? "a whole central pile taken to hand for one card, discarded to its own suit's pile - " +
        'the take itself, never the pile'
      : takeCoins
        ? "every card on one central pile discarded to its own suit's pile and ONE COIN PER " +
          'CARD taken - no card paid, and the cards LEAVE THE GAME (K4)'
        : "one board's action bought from what its pile holds - no card, no fee";

  const detail = threeColumn
    ? [
        `⭐ DEAN'S VARIANT (rules.turn.commonsTake: '${modeName}', ` +
          `${takeCoins ? '10/09/2026' : '09/09/2026'}): THREE columns rather than two, as a ` +
          `share of every turn played: PLAY ` +
          `${share(plays)} (a card paid, a board's action bought), ${takeLabel} ${share(takes)} (${takeDescription}), ` +
          `SLOT UNSPENT ${share(unspent)}.`,
        ...(takeCoins
          ? [
              `⛔ THREE QUANTITIES, AND THE VERDICT IS ON THE FIRST OF THEM. TURNS THAT USED ` +
                `THE SLOT ${pct(value)} - play or coin take, at most one per turn, and THE ONLY ` +
                `ONE THE BAND IS READ AGAINST. PLAYS PER TURN ${pct(playsPerTurn)} - one per ` +
                `commons MOVE, so A Helping Hand can put two in one turn. CARDS PER TURN ` +
                `${pct(cardsPerTurn)} - one per card that landed on a pile, and THE WILD PAIR ` +
                `(K3) PUTS TWO CARDS IN FOR ONE PLAY. ${cards} cards entered the centre on ` +
                `${plays} plays, of which ${wildPairPlays} were paid with a pair ` +
                `(${pct(plays === 0 ? NaN : wildPairPlays / plays)} of plays); ` +
                `${plays} + ${wildPairPlays} = ${cards} exactly, or the fold is wrong. ` +
                `⚠️ THIS IS THE SAME TRAP A HELPING HAND SPRANG ON 09/09/2026, when the band was ` +
                'judged on plays per turn (68.5%) where the turn share read 58.9% and all five ' +
                'arms had to be re-run. Any rule that grants a second one of the thing being ' +
                'counted breaks the denominator, and the wild pair is the second such rule this ' +
                'design has had. Quote the measure with the number, every time.' +
                (commonsWildPair(data)
                  ? ''
                  : ' (rules.economy.commonsWildPair is OFF in this run, so plays and cards ' +
                    'are equal here by construction.)'),
              `⚠️ AND THE THREE COLUMNS DO NOT SUM TO 100%, WHICH IS NOT AN ARITHMETIC ` +
                `ERROR. A Helping Hand grants a SECOND bonus action of either kind (K2/C75), ` +
                `so one turn can both PLAY and take and is counted in both columns while being ` +
                `ONE turn that used the slot. PLAY ${share(plays)} + ${takeLabel} ` +
                `${share(takes)} + SLOT UNSPENT ${share(unspent)} therefore overshoots. ` +
                `⛔ THE TWO NUMBERS THAT DO SUM TO EVERY TURN PLAYED ARE SLOT USED ${pct(value)} ` +
                `AND SLOT UNSPENT ${share(unspent)}, and the first of those is the one the band ` +
                `is read against.`,
            ]
          : []),
        `by seat count, and THIS is the reading the verdict is taken on (slot used = play or ` +
          `take; play/take per turn in brackets): ${rows
            .map(
              (r) =>
                `${r.seats}p ${pct(r.rate)} (${pct(r.playsPerTurn)} play, ${pct(r.takesPerTurn)} take) of ${r.turns} turns`,
            )
            .join('   ')}. The handoff asks the question this way round because a hot ` +
          '2-player table hides inside a healthy pool.',
        `slot unspent by seat count: ${rows.map((r) => `${r.seats}p ${pct(r.unspent)}`).join('  ')}`,
        `by BOARD PLAYED (the PAID half only, C3): ${boardLine || 'no plays'}. ${plays} plays ` +
          `over ${games.length} games, ${num(games.length === 0 ? NaN : plays / games.length, 1)} ` +
          'a game.' +
          (toHandOrPaid
            ? ' A take buys no action, so it has no board mix of its own - a18 carries the ' +
              'take-size distribution instead.'
            : '') +
          (takeCoins
            ? ' ⭐ IT IS A COUNT OF PLAYS AND NOT OF CARDS: a wild pair buys ONE board action ' +
              'however many cards land on the pile, so the rows and their denominator are both ' +
              'in plays and the mix is not skewed by whichever board attracts the pairs.'
            : ''),
        ...(takeCoins
          ? [
              `⭐ COIN TAKES BY BOARD (rules.turn.commonsTake: 'coins', 10/09/2026), which pile ` +
                `was worth clearing: ${coinTakesByBoardLine || 'no takes'}. ${takes} takes over ` +
                `${games.length} games, ${num(games.length === 0 ? NaN : takes / games.length, 1)} ` +
                'a game. It is a different question from the board mix above: that one says ' +
                'which ACTION a table wanted to buy, this one says which PILE a table wanted ' +
                'gone. a18 carries the take-size distribution and a19 the coins it minted.',
            ]
          : []),
        ...(takeToSpend
          ? [
              `⭐ TAKES BY BOARD (rules.turn.commonsTake: 'spend', 09/09/2026), ALL FIVE, not the ` +
                `PAID half above: ${spendTakesByBoardLine || 'no takes'}. ${takes} takes over ` +
                `${games.length} games, ${num(games.length === 0 ? NaN : takes / games.length, 1)} ` +
                'a game. Orchard takes go to hand and wheat takes to barn exactly as under ' +
                "'bonus'; dairy, vegetable and apiary each spend the pile on that board's own " +
                'action instead - a18 carries what each one did with it (used / discarded / ' +
                'stranded).',
            ]
          : []),
        `⭐ DEAN'S BAND, 09/09/2026, AND IT IS HIS NUMBER RATHER THAN ONE READ OFF OUR OWN ` +
          `OUTPUT: the bonus should be taken "${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)} of ` +
          'the time... earned, not automatic". It is read on the slot\'s TOTAL use (play plus ' +
          "take), because Dean's sentence is about the slot being spent at all, not about which " +
          'half of it did the spending.',
        takePaid
          ? '⭐ THE TAKE IS PAID (one card to the discard) SO THERE IS NO FREE OPTION IN THE ' +
            'SLOT (Dean, 09/09/2026). Every previous currency this project has shipped, and both ' +
            "of commonsTake's other values, has had to watch whether a free option sharing the " +
            "bonus slot with a paid one crowds it out; 'paid' is the first arm where neither half " +
            'of the slot is free, so that law has no subject here and PLAY/TAKE is a choice ' +
            'between two prices rather than a price and a freebie.'
          : freeShareLine(plays, takes, modeName),
        UNSPENT_CAVEAT,
        takePaid
          ? '⚠️ AND UNDER THE COMMONS THE UNSPENT COLUMN MEANS THE SAME THING IT DOES UNDER THE ' +
            'PAID CONTROL: BOTH options cost a card, so an unspent slot here is a seat that ' +
            "declined to pay for either one, exactly as under the shipped `harvest` rule's single " +
            'paid option.'
          : '⚠️ AND UNDER THE COMMONS THE UNSPENT COLUMN MEANS SOMETHING SHARPER THAN UNDER ' +
            'EITHER CONTROL: a PLAY costs a card, though a TAKE costs nothing at all - so an ' +
            'unspent slot here is a seat that declined even the free option, which is a stronger ' +
            'finding than declining a paid one.',
        perGameLine(games.length, bonusTurns, turns),
      ]
    : [
        `the two-column tally, as a share of every turn played: SLOT USED ${pct(value)} ` +
          `(${share(plays)} plays per turn), SLOT UNSPENT ${share(unspent)}. There is no third column: the slot holds one option ` +
          '(C9) - no free Draw 1, no Collect, no self-visit - so an unspent slot is a turn that ' +
          'chose not to pay a card, and nothing else.',
        `by seat count, and THIS is the reading the verdict is taken on (slot used; plays per turn in brackets): ${rows
          .map((r) => `${r.seats}p ${pct(r.rate)} (${pct(r.playsPerTurn)}) of ${r.turns} turns`)
          .join('   ')}. The handoff asks the question this way round because a hot 2-player ` +
          'table hides inside a healthy pool.',
        `slot unspent by seat count: ${rows.map((r) => `${r.seats}p ${pct(r.unspent)}`).join('  ')}`,
        `by BOARD, which is by ACTION (C3): ${boardLine || 'no plays'}. ` +
          `${plays} plays over ${games.length} games, ` +
          `${num(games.length === 0 ? NaN : plays / games.length, 1)} a game. Watch Deliver ` +
          '(vegetable took 8% of door uses under the meeples) and whether Draw 2 (orchard) is ' +
          'dead now that the fee is a card and the board hands back two.',
        `⭐ DEAN'S BAND, 09/09/2026, AND IT IS HIS NUMBER RATHER THAN ONE READ OFF OUR OWN ` +
          `OUTPUT: the bonus should be taken "${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)} of ` +
          'the time... earned, not automatic". BELOW the floor the fee is too dear or the boards ' +
          'buy too little and the commons is decoration; ABOVE the ceiling the bonus is a phase ' +
          'of the turn rather than a choice, and rules.economy.commonsThreshold (C10) is the one ' +
          'number that pulls it back.',
        '⛔ THE SOLITAIRE LAW HAS NO SUBJECT HERE, and that is why this arm reports a BAND rather ' +
          'than a ratio. Every previous verdict in this file was "the visit must not be ' +
          'outnumbered by the largest single SOLITAIRE option"; the commons slot has no second ' +
          'option to be outnumbered by, so the law would read against zero and hand a table that ' +
          'never plays a card a triumphant PASS. The early/late split goes with it for the same ' +
          'reason: it asked whether a solitaire alternative was an opening convenience. ⭐ IT ' +
          "COMES BACK UNDER commonsTake: 'bonus' OR 'spend' - see that arm's own detail lines.",
        '⚠️ A TURN CAN PLAY TWICE. A Helping Hand grants a second play onto a central board (C8), ' +
          'so PLAYS PER TURN runs above the share of turns that used the slot. The VERDICT is ' +
          'taken on the turn share (slot used plus slot unspent is every turn); plays per turn ' +
          'is printed beside it so a Helping Hand cannot fail the band on its own. Corrected ' +
          '09/09/2026: the first reference-v15 baseline was judged on plays per turn (68.5%) ' +
          'when the turn share read 58.9%.',
        UNSPENT_CAVEAT,
        '⚠️ AND UNDER THE COMMONS THE UNSPENT COLUMN MEANS SOMETHING SHARPER THAN UNDER EITHER ' +
          'CONTROL: a play COSTS A CARD, so an unspent slot is a seat that declined to pay rather ' +
          'than one that had nothing to spend. It is still the rational floor - a bot never ' +
          'forgets a slot and never mis-prices a card it will want next turn - so read it as the ' +
          'cheapest the restriction can possibly be, never as what a table will do.',
        perGameLine(games.length, bonusTurns, turns),
      ];

  return { value, headline, detail, verdict };
}

/**
 * ⭐ THE NOTICE-BOARD VISIT (S5-S11, Dean 10/09/2026): three columns, Dean's
 * band, and the self split that decides whether the design works at all.
 *
 * The shape is the commons' - one paid option in the slot, a band rather than
 * the solitaire law - and the columns are the v31 control's, because a visit is
 * a card onto a person's board again. What is new is that BOTH halves of the
 * visit are the same price, so the self share is a pure preference reading
 * rather than a price reading, and that is exactly why it is the headline risk.
 *
 * ⛔ THE VERDICT READS `bonusTurns / turns`, WHICH IS THE SHARE OF TURNS THAT
 * USED THE SLOT. It is not `visits / turns`. A Helping Hand puts a second visit
 * in one turn (S9), so the two differ, and the one Dean's sentence is written
 * in is the first. Both are printed, each labelled with its denominator.
 */
function noticeBoardMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);

  const all = sum(games.map((g) => sum(g.visitsBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const neighbours = all - selves;
  // ⭐ THE FOURTH COLUMN, AND IT IS NEW ON 11/09/2026 WITH DEAN'S
  // UNCLAIMED-BOARDS VARIANT. A play onto a CENTRAL pile is the `commons` MOVE
  // and emits `commonsPlayed`; a play onto a person's board is the `visit` MOVE
  // and emits `visited`. The two live at once under
  // `rules.economy.unclaimedBoardsToCentre` and SHARE ONE BONUS SLOT, so a
  // tally that counted only the visits would have reported a slot used on 68%
  // of turns with visits on 27% of them and left the gap unexplained. It is
  // read off `commonsPlaysBySeat` - one per MOVE, the same denominator
  // `visitsBySeat` uses - and is a structural zero on every arm with no centre.
  const centre = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
  const hasCentre = unclaimedBoardsToCentre(data);
  // Turns minus bonus turns, and never stored anywhere: a remainder that is
  // counted separately is a remainder that can drift out of step with the count
  // it is a remainder OF.
  const unspent = Math.max(0, turns - bonusTurns);

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  // ⛔ THE VERDICT QUANTITY. Turns, not plays.
  const value = bonusTurns / turns;
  // ⛔ EVERY PLAY THE SLOT BOUGHT, WHEREVER IT LANDED. It was `all / turns`
  // until 11/09/2026, which was right while a visit was the only thing the slot
  // could buy and became wrong the moment a central pile could be paid instead.
  const playsPerTurn = (all + centre) / turns;
  const visitsPerTurn = all / turns;
  // ⭐ S17, THE HOST DRAW (11/09/2026), asked of the KNOB: a card handed back
  // on every visit makes the NEXT visit easier to afford, so this is the one
  // rule in the family that is expected to push this assertion's own number UP.
  const hostDraw = hostDrawOnVisit(data);
  // ⭐ IS THIS DEAN'S TWO-BOARD ARM? Asked of the KNOB and never of the sample,
  // so the divergence line fires on a run with no two-seat games in it too.
  const twoBoards = [1, 2, 3, 4].some((n) => noticeBoardsPerSeat(data, n) > 1);

  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const t = totalTurns(slice.ended);
      const b = totalBonusTurns(slice.ended);
      const v = sum(slice.ended.map((g) => sum(g.visitsBySeat)));
      const s = sum(slice.ended.map((g) => sum(g.selfVisitsBySeat)));
      const c = sum(slice.ended.map((g) => sum(g.commonsPlaysBySeat)));
      return {
        seats: slice.seats,
        turns: t,
        rate: t === 0 ? NaN : b / t,
        playsPerTurn: t === 0 ? NaN : (v + c) / t,
        visitsPerTurn: t === 0 ? NaN : v / t,
        selfShare: v + c === 0 ? NaN : s / (v + c),
        ownShare: t === 0 ? NaN : s / t,
        rivalShare: t === 0 ? NaN : (v - s) / t,
        centralShare: t === 0 ? NaN : c / t,
        // ⛔ THE SPLIT DEAN'S VARIANT IS DECIDED ON, and it is a share of the
        // PLAYS rather than of the turns: of everything the slot bought, how
        // much of it crossed the table to a named person. A central pile is
        // socially free and a rival's board is not, so this falling as the
        // centre opens is the variant recreating the village green with an
        // extra step.
        crossTableShare: v + c === 0 ? NaN : (v - s) / (v + c),
        neighboursPerTurn: t === 0 ? NaN : (v - s) / t,
        unspent: t === 0 ? NaN : Math.max(0, t - b) / t,
        // ⭐ THE DIVERGENCE, IN POINTS OF TURNS, AND IT IS A READING IN ITS OWN
        // RIGHT SINCE DEAN'S TWO-BOARD FIX (11/09/2026). Plays per turn minus
        // the share of turns that used the slot is EXACTLY A Helping Hand's
        // second play (S9), because nothing else in the game can put two plays
        // in one turn. The latch is on the board's CARD ID, so the second play
        // must go to a DIFFERENT board - which is why this gap is WELDED SHUT
        // AT ZERO at two seats in the control, where a seat with self-visiting
        // banned faces exactly one board, and opens here for the first time.
        gap: t === 0 ? NaN : (v + c) / t - b / t,
        // How many Notice Boards each seat lays out at this seat count, read off
        // the knob rather than off the games, so the row is honest on a thin
        // sample.
        boards: noticeBoardsPerSeat(data, slice.seats),
      };
    });

  // BY THE HOST'S SUIT, WHICH UNDER THIS MODE IS BY POWER (S12): the board
  // decides what the visit buys, so this is the door mix asked of the visits
  // rather than of the door uses. Folded off the two door counters, which
  // `visited` feeds with the HOST's colour on both halves - `neighbourDoorByColour`
  // for a visit out and `selfDoorByColour` for a visit to your own board - so
  // the two are added rather than one of them taken for the whole.
  // ⚠️ READ AVAILABILITY BEFORE CALLING A POWER MISPRICED. On 10/09/2026 the
  // fires-by-suit spread turned out to be availability rather than power, and
  // that is the handoff's own warning on reading 4.
  //
  // ⭐ AND SINCE 11/09/2026 IT COUNTS THE CENTRAL PILES TOO, wherever they sit.
  // Under `rules.economy.unclaimedBoardsToCentre` the same five colours are on
  // the table in every game - some owned, some ownerless - so the mix is taken
  // across all five and printed a second time SPLIT owned against central,
  // because a central board leading the table is the headline risk arriving as
  // a number rather than as an argument.
  const byBoard = new Map<string, number>();
  const ownedByBoard = new Map<string, number>();
  const centralByBoard = new Map<string, number>();
  const bump = (m: Map<string, number>, colour: string, n: number) =>
    m.set(colour, (m.get(colour) ?? 0) + n);
  for (const g of games) {
    for (const [colour, n] of Object.entries(g.neighbourDoorByColour)) {
      bump(byBoard, colour, n);
      bump(ownedByBoard, colour, n);
    }
    for (const [colour, n] of Object.entries(g.selfDoorByColour)) {
      bump(byBoard, colour, n);
      bump(ownedByBoard, colour, n);
    }
    for (const [colour, n] of Object.entries(g.commonsPlaysByBoard)) {
      bump(byBoard, colour, n);
      bump(centralByBoard, colour, n);
    }
  }
  const boardTotal = sum([...byBoard.values()]);
  const boardLine = [...byBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([colour, n]) => `${colour} ${pct(boardTotal === 0 ? NaN : n / boardTotal, 0)}`)
    .join('  ');
  const ownedTotal = sum([...ownedByBoard.values()]);
  const centralTotal = sum([...centralByBoard.values()]);
  const splitBoardLine =
    `OWNED ${pct(boardTotal === 0 ? NaN : ownedTotal / boardTotal, 0)} (` +
    ([...ownedByBoard.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([colour, n]) => `${colour} ${n}`)
      .join('  ') || 'none') +
    `)  CENTRAL ${pct(boardTotal === 0 ? NaN : centralTotal / boardTotal, 0)} (` +
    ([...centralByBoard.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([colour, n]) => `${colour} ${n}`)
      .join('  ') || 'none') +
    ')';

  const split = earlyLate(games, (g) => g.selfVisitRounds);
  const rivalSplit = earlyLate(games, (g) => g.neighbourVisitRounds);

  const outOfBand = rows.filter((r) => Number.isFinite(r.rate) && outside(r.rate));
  const verdict: Measurement['verdict'] = !Number.isFinite(value)
    ? 'OBSERVE'
    : outside(value) || outOfBand.length > 0
      ? 'FAIL'
      : 'PASS';

  const detail = [
    // ⛔ THE FOUR-WAY TALLY, RE-CUT 11/09/2026 FOR DEAN'S UNCLAIMED-BOARDS
    // VARIANT. It was three columns while the slot could only buy a visit. The
    // centre gave it a fourth, and the fourth is the one the variant is decided
    // on: a play onto a central pile is paid to NOBODY.
    `⛔ THE FOUR-WAY TALLY, AS A SHARE OF EVERY TURN PLAYED, AND THE SPLIT IS THE READING: ` +
      `visit your OWN board ${share(selves)}, visit a RIVAL ${share(neighbours)}, ` +
      `play the CENTRE ${share(centre)}, SLOT UNSPENT ${share(unspent)}. ` +
      (hasCentre
        ? '⭐ A CENTRAL BOARD IS SOCIALLY FREE AND A RIVAL BOARD IS NOT, WHICH IS THE WHOLE ' +
          'OF THE HEADLINE RISK: the card you pay onto a rival’s board is material that ' +
          'rival harvests into their barn, and the card you pay onto a central pile is paid to ' +
          'nobody. There is therefore a standing incentive to prefer the centre, strongest at ' +
          'TWO players where three of the four targets are central. ⛔ IF THE RIVAL COLUMN ' +
          'FALLS RATHER THAN RISES AS THE CENTRE OPENS, THE VARIANT HAS RECREATED THE VILLAGE ' +
          'GREEN WITH AN EXTRA STEP and the neighbour has been designed out for the second ' +
          'time in three days. Read this line and a18 before reading the rate at all.'
        : '⚠️ THE CENTRAL COLUMN IS A STRUCTURAL ZERO ON THIS ARM, not a finding: ' +
          'rules.economy.unclaimedBoardsToCentre is false, so there is no centre and every ' +
          'Notice Board is owned. The column is printed under both settings on purpose - it is ' +
          'the one the 2x2 of 11/09/2026 separates, and a column that appeared and disappeared ' +
          'could not be diffed across the four corners.') +
      ' There is no free option and no fifth column: the slot holds one thing (S5), the ' +
      'standalone Draw 1 is shut under this currency, and all three paid options cost the ' +
      'same one card - so an unspent slot is a seat that declined to pay, and the split ' +
      'between the three is a pure preference rather than a price.',
    `⛔ THE FOUR SHARES SUM TO ${pct((selves + neighbours + centre + unspent) / turns)} RATHER ` +
      `THAN TO 100%, AND THE REMAINDER IS A HELPING HAND. Slot used ${pct(value)} plus slot ` +
      `unspent ${share(unspent)} IS every turn played, exactly; the three paid columns come to ` +
      `${share(selves + neighbours + centre)} against a slot used on ${pct(value)}, and the ` +
      `${share(Math.max(0, selves + neighbours + centre - bonusTurns))} of turns between them ` +
      'is the second play A Helping Hand grants (S9) landing in one of the three columns a ' +
      'second time. Read the three against each other, never as slices of a pie.',
    `⛔ TWO QUANTITIES, AND THE VERDICT IS ON THE FIRST. TURNS THAT USED THE SLOT ${pct(value)} ` +
      `- at most one per turn, and THE ONLY ONE DEAN'S BAND IS READ AGAINST. PLAYS PER TURN ` +
      `${pct(playsPerTurn)} - one per play MOVE of either kind, visits ${pct(visitsPerTurn)} ` +
      `plus central plays ${pct(turns === 0 ? NaN : centre / turns)}, and A Helping Hand can ` +
      `put two in one turn (S9). ⚠️ THIS IS THE 09/09/2026 TRAP: that day the band was judged ` +
      'on plays per turn (68.5%) where the turn share read 58.9%, a FAIL was reported that was ' +
      'not one, and all five arms had to be re-run. Any rule that grants a second one of the ' +
      'thing being counted breaks the denominator. Quote the measure with the number, every time.',
    `⛔ THE TWO NUMBERS THAT DO SUM TO EVERY TURN PLAYED ARE SLOT USED ${pct(value)} AND SLOT ` +
      `UNSPENT ${share(unspent)}.`,
    // ⭐⭐ THE DIVERGENCE, PRINTED AS ITS OWN LINE RATHER THAN LEFT IN BRACKETS
    // (11/09/2026), because under Dean's two-board fix it is a FINDING at two
    // seats and not bookkeeping. See `gap` above for why the control welds it
    // shut at two seats and this arm does not.
    `⭐ THE GAP BETWEEN THE TWO MEASURES, IN POINTS OF TURNS, AND IT IS A HELPING HAND AND ` +
      `NOTHING ELSE: pooled ${num(100 * (playsPerTurn - value), 1)} points ` +
      `(plays per turn ${pct(playsPerTurn)} against slot used ${pct(value)}). By seat count: ` +
      `${rows
        .map(
          (r) =>
            `${r.seats}p ${num(100 * r.gap, 1)}pt (${r.boards} board${r.boards === 1 ? '' : 's'} a seat)`,
        )
        .join('  ')}. ` +
      (twoBoards
        ? '⛔⛔ EXPECT THE TWO MEASURES TO DIVERGE AT TWO SEATS HERE FOR THE FIRST TIME, AND ' +
          'IT IS AN ENGINE CONSEQUENCE NOBODY HAD NAMED UNTIL THE CODE WAS READ. S9 is one use ' +
          'per board per turn, latched on the BOARD’S CARD ID, so A Helping Hand’s ' +
          'second play must land on a DIFFERENT board. Under the no-self control at two seats a ' +
          'seat faces exactly ONE legal board, so the second play CAN NEVER BE TAKEN and the ' +
          'gap is welded shut at zero. Under this arm the one rival holds TWO boards, so it ' +
          'can, and A Helping Hand comes alive at two seats for the first time. ⚠️ A GAP THAT ' +
          'OPENS AT TWO SEATS IS THEREFORE THE ARM WORKING AND NOT A LEAK; a gap that opens at ' +
          'THREE or FOUR seats is a leak, because those columns are rule-for-rule the control. ' +
          '⛔ AND IT CHANGES NOTHING ABOUT THE VERDICT, WHICH READS THE TURN SHARE: judging ' +
          "Dean's band on plays cost this project a re-run of five arms on 09/09/2026, and a " +
          'card that grants a second one of the thing being counted is exactly what breaks the ' +
          'denominator.'
        : '⚠️ ONE BOARD A SEAT ON THIS RUN, so at two seats a seat with self-visiting banned ' +
          'faces exactly ONE legal board and S9’s per-board latch makes A Helping Hand’s ' +
          'second play IMPOSSIBLE there: a two-seat gap of zero is the latch and not a card ' +
          'nobody held. overlays/notice-board-visit-two-boards-v1.overlay.json is the arm that ' +
          'gives the second play somewhere to go.'),
    `by seat count, and THIS is the reading the verdict is taken on (slot used; PLAYS per turn ` +
      `in brackets): ${rows
        .map((r) => `${r.seats}p ${pct(r.rate)} (${pct(r.playsPerTurn)}) of ${r.turns} turns`)
        .join('   ')}. The pool is dominated by whichever seat count has the most turns in ` +
      'it, so a hot 2-player table hides inside a healthy average. ⭐ TWO PLAYERS FIRST AND ' +
      'THE POOLED FIGURE SECOND: the number this variant was ruled to rescue is the 29.1% the ' +
      'no-self control read at TWO players, where a seat with self-visiting banned and no ' +
      'centre had exactly ONE board it could visit.',
    `⛔ THE OWN / RIVAL / CENTRAL SPLIT BY SEAT COUNT, AS SHARES OF TURNS, AND IT IS THE FIRST ` +
      `THING TO READ ON THIS PAGE: ${rows
        .map(
          (r) =>
            `${r.seats}p own ${pct(r.ownShare)} / rival ${pct(r.rivalShare)} / central ` +
            `${pct(r.centralShare)}`,
        )
        .join('   ')}. ⭐ AND THE SAME SPLIT AS A SHARE OF THE PLAYS THEMSELVES - what share of ` +
      `everything the slot bought CROSSED THE TABLE to a named person: ${rows
        .map((r) => `${r.seats}p ${pct(r.crossTableShare)}`)
        .join('  ')}, pooled ` +
      `${pct(all + centre === 0 ? NaN : neighbours / (all + centre))} of ${all + centre} plays. ` +
      '⛔ EVERY SEAT FACES EXACTLY FOUR TARGETS AT EVERY PLAYER COUNT under this variant (1 ' +
      'player 0 rival / 4 central, 2 players 1 / 3, 3 players 2 / 2, 4 players 3 / 1), so the ' +
      'central share SHOULD fall as seats rise on availability alone. What decides the variant ' +
      'is whether the cross-table share rises with it, and whether two players - three of four ' +
      'targets central - still pay a person at all.',
    `⛔ THE OWN COLUMN, WHICH IS 0 BY CONSTRUCTION UNDER DEAN'S VARIANT: ${selves} self-visits ` +
      `over ${turns} turns (${share(selves)}). ${
        selves === 0
          ? 'rules.turn.selfVisitAllowed is false and the enumerator never offers your own ' +
            'board, so the zero is the ban working rather than a preference. ⚠️ A NON-ZERO ' +
            'NUMBER HERE WOULD BE A BUG IN THE BAN AND NOT A FINDING.'
          : 'rules.turn.selfVisitAllowed is TRUE on this run, so this is the paired corner ' +
            '(overlays/notice-board-visit-unclaimed-self-v1.overlay.json) and the column is a ' +
            "real preference reading. ⭐ THE LEVEL TO READ IT AGAINST IS v31's 22.2%, measured " +
            'when every Notice Board printed the SAME thing.'
      }`,
    `slot unspent by seat count: ${rows.map((r) => `${r.seats}p ${pct(r.unspent)}`).join('  ')}`,
    `⛔ THE SELF SHARE, MEASURED AGAINST EVERY PLAY AND NOT ONLY AGAINST THE VISITS: ` +
      `${pct(all + centre === 0 ? NaN : selves / (all + centre))} of ${all + centre} plays went ` +
      `to the player's OWN board (${share(selves)} of turns). By seat count: ${rows
        .map((r) => `${r.seats}p ${pct(r.selfShare)}`)
        .join('  ')}. ⭐ THE NUMBER TO READ IT AGAINST IS v31's 22.2%, measured when every ` +
      'Notice Board printed the SAME thing so that a self-visit was strictly better than a ' +
      "visit, and the built design's 44.4% of 10/09/2026, which is the reading the ban answers. " +
      '⚠️ THE DENOMINATOR MOVED ON 11/09/2026 AND NEITHER OF THOSE TWO LEVELS SHARES IT: both ' +
      'were self-visits over VISITS, and a central play was not a thing that could happen. ' +
      'Compare the two arms of the 2x2 on identical seeds, never a level across the change.',
    `neighbour visits per turn by seat count: ${rows
      .map((r) => `${r.seats}p ${num(r.neighboursPerTurn, 2)}`)
      .join('  ')}. a08-the-hook carries the floor of 0.5 on that quantity and HAS A SUBJECT ` +
      'AGAIN under this mode; this row is here so the two readings can be checked against each ' +
      'other without opening two pages.',
    `by BOARD PLAYED ON, which under this mode is by POWER (S12) and since 11/09/2026 counts ` +
      `the CENTRAL piles too: ${boardLine || 'no plays'}. ⛔ SPLIT BY WHERE THE BOARD SITS: ` +
      `${splitBoardLine}. ⭐ THIS IS THE HEADLINE RISK ARRIVING AS A NUMBER: a central board ` +
      'has no owner to pay, so a central board leading the table is the centre eating the ' +
      'neighbour. ⚠️ AND THE AVAILABILITY CORRECTION CUTS BOTH WAYS - at two players three of ' +
      'the four targets are central and at four players only one is, so read the split by seat ' +
      'count in the line above before reading this pooled one. ' +
      `${boardTotal} plays over ${games.length} games, ` +
      `${num(games.length === 0 ? NaN : boardTotal / games.length, 1)} a game. ⚠️ CHECK ` +
      'AVAILABILITY AGAINST VALUE BEFORE CALLING A POWER MISPRICED: on 10/09/2026 the ' +
      'fires-by-suit spread turned out to be availability and not power, and S13 fixed ' +
      'availability first for exactly that reason. A board is offered only when its power is ' +
      'legal for the visitor (S10) and only once per turn (S9), so a thin row can be a ' +
      'rationing rule rather than a weak power.',
    hostDraw > 0
      ? `⛔⛔ S17, THE HOST DRAW, IS ON (rules.turn.hostDrawOnVisit ${hostDraw}), AND THIS IS ` +
        'THE READING IT IS MOST LIKELY TO MOVE. When a neighbour visits you, you draw a card - ' +
        'so A CARD HANDED BACK ON EVERY VISIT MAKES THE NEXT VISIT EASIER TO AFFORD, and the ' +
        'rate is EXPECTED TO RISE rather than merely to change. The one-leaf control is ' +
        'overlays/notice-board-visit-two-boards-v1.overlay.json and it PASSES at 51.7% of turns ' +
        'pooled (2p 44.0 / 3p 49.2 / 4p 59.9), so ⚠️ FOUR SEATS IS ALREADY ONE TENTH OF A POINT ' +
        `INSIDE THE 60% CEILING. This run reads ${pct(value)} pooled (${rows
          .map((r) => `${r.seats}p ${pct(r.rate)}`)
          .join('  ')}). ⛔ THE VERDICT IS STILL THE SHARE OF TURNS AND NOT PLAYS PER TURN: ` +
        'judging the band on plays cost this project a re-run of five arms on 09/09/2026. ' +
        '⚠️ AND THE RATE IS THE ONLY THING THIS PAGE CAN SAY ABOUT S17 - whether the extra ' +
        'cards make the game feel less tight is the effect Dean named and the effect the ' +
        'instrument cannot see, because the hand limit is the simulator’s bound and the table ' +
        'plays with none (C7). a21-host-draw carries the faucet and the caveat.'
      : '⚠️ S17, THE HOST DRAW, IS OFF ON THIS RUN (rules.turn.hostDrawOnVisit 0), so nothing ' +
        'is handed back to a host and the rate is the S7 game. If this is the CONTROL half of ' +
        'that pair, the arm is overlays/notice-board-visit-host-draw-v1.overlay.json, ONE LEAF ' +
        'away, and the rate is expected to be HIGHER there.',
    `⭐ DEAN'S BAND, 09/09/2026, CARRIED ACROSS UNCHANGED BECAUSE IT IS A SENTENCE ABOUT THE ` +
      `SLOT AND NOT ABOUT THE CENTRE: the bonus should be taken "${pct(PLAY_FLOOR, 0)}-` +
      `${pct(PLAY_CEILING, 0)} of the time... earned, not automatic". The seven-version record ` +
      'it joins, all on the turn measure: v31 67.6%, the meeple loop 54.2%, the meeple economy ' +
      'rejected at a table, the commons 58.9%, colour matching 34.4%, the coins arm 60.6%, the ' +
      'coins arm without the wild pair 46.5%.',
    '⛔ THE SOLITAIRE LAW HAS NO SUBJECT HERE, which is why this mode reports a BAND rather than ' +
      'a ratio. The law is "the visit must not be outnumbered by the largest single SOLITAIRE ' +
      'option", and this slot has no free option in it at all - the standalone Draw 1 is shut ' +
      'under this currency, there is no Collect and there is no take. ' +
      (selves > 0
        ? 'The only thing the neighbour visit can be outnumbered by is the self-visit, which ' +
          'costs the identical card and is ruled in on purpose (S6), so it is reported as a ' +
          'risk above rather than folded into a verdict that would fail the design for obeying ' +
          'its own ruling.'
        : 'The self-visit is BANNED on this run (rules.turn.selfVisitAllowed false), so the ' +
          'law has no subject on that side either. ⚠️ AND THE CENTRAL PLAY IS NOT A SOLITAIRE ' +
          'OPTION UNDER THE LAW AS WRITTEN, WHICH IS WORTH SAYING RATHER THAN ASSUMING: it ' +
          'costs the identical card and buys the identical power, so it is not free and not a ' +
          'yardstick the visit has to beat. What it IS is a play that pays nobody, and that ' +
          'question is the OWN / RIVAL / CENTRAL split above rather than this law.'),
    UNSPENT_CAVEAT,
    `the self-visit, early against late: ${split.early} before each game's midgame, ` +
      `${split.late} after (neighbour visits ${rivalSplit.early} / ${rivalSplit.late}). ` +
      'Front-loaded is a bootstrap - a seat with nothing worth visiting yet, and nobody else ' +
      'holding a board worth paying for. Flat or rising is the self-visit as a whole-game ' +
      'strategy, which is the shape v31 died of.',
    perGameLine(games.length, bonusTurns, turns),
  ];

  return {
    value,
    headline:
      `the bonus slot is used on ${pct(value)} of ${turns} turns ` +
      `(Dean's band ${pct(PLAY_FLOOR, 0)}-${pct(PLAY_CEILING, 0)}, READ ON TURNS); plays per ` +
      `turn ${pct(playsPerTurn)} (A Helping Hand's second play is the difference); OWN ` +
      `${share(selves)} / RIVAL ${share(neighbours)} / CENTRAL ${share(centre)} / UNSPENT ` +
      `${share(unspent)}` +
      (twoBoards
        ? `; ⭐ THE TWO MEASURES DIVERGE AT TWO SEATS FOR THE FIRST TIME - the gap reads ` +
          `${num(100 * (rows.find((r) => r.seats === 2)?.gap ?? NaN), 1)}pt there, where the ` +
          'control welds it to ZERO, because one rival holding two boards gives A Helping ' +
          "Hand's second play somewhere to go (3p " +
          `${num(100 * (rows.find((r) => r.seats === 3)?.gap ?? NaN), 1)}pt, 4p ` +
          `${num(100 * (rows.find((r) => r.seats === 4)?.gap ?? NaN), 1)}pt, both unchanged ` +
          'from the control)'
        : '') +
      (hostDraw > 0
        ? '; ⛔ S17 THE HOST DRAW IS ON, so a card is handed back on every visit and the rate ' +
          'was EXPECTED to rise - the one-leaf control reads 51.7% pooled (2p 44.0 / 3p 49.2 / ' +
          '4p 59.9) and four seats was already a tenth of a point inside the ceiling'
        : '') +
      (outOfBand.length === 0
        ? ''
        : `; OUT OF BAND at ${outOfBand.map((r) => `${r.seats}p ${pct(r.rate)}`).join(', ')}`),
    detail,
    verdict,
  };
}

function outside(rate: number): boolean {
  return rate < PLAY_FLOOR || rate > PLAY_CEILING;
}

/** The shipped v31 game, unchanged since 02/09/2026 and deliberately not re-derived. */
function cardGame({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);

  const draws = sum(games.map((g) => sum(g.bonusDrawBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const all = sum(games.map((g) => sum(g.visitsBySeat)));
  const rivals = all - selves;
  // Turns minus bonus turns, and never stored anywhere: a remainder that is
  // counted separately is a remainder that can drift out of step with the
  // count it is a remainder OF.
  const unspent = Math.max(0, turns - bonusTurns);

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  const solitaire: [string, number][] = [
    ['Draw 1', draws],
    ['visit yourself', selves],
  ];
  const [worstName, worst] = solitaire.reduce((a, b) => (b[1] > a[1] ? b : a));
  const value = rivals === 0 ? (worst > 0 ? Infinity : NaN) : worst / rivals;

  const split = earlyLate(games, (g) => g.selfVisitRounds);
  const rivalSplit = earlyLate(games, (g) => g.neighbourVisitRounds);

  return {
    value,
    headline:
      `visit a rival takes ${share(rivals)} of ${turns} turns, biggest solitaire option ` +
      `${worstName} at ${share(worst)}; SLOT UNSPENT ${share(unspent)}`,
    detail: [
      `the four-way tally, as a share of every turn played: Draw 1 ${share(draws)}, ` +
        `visit a rival ${share(rivals)}, visit YOURSELF ${share(selves)}, ` +
        `SLOT UNSPENT ${share(unspent)}`,
      `visit share of the slots that WERE spent: ` +
        `${pct(bonusTurns === 0 ? NaN : rivals / bonusTurns)} of ${bonusTurns} ` +
        `(self-visits take a further ${pct(bonusTurns === 0 ? NaN : selves / bonusTurns)})`,
      UNSPENT_CAVEAT,
      `the self-visit, early against late: ${split.early} before each game's midgame, ` +
        `${split.late} after (rival visits ${rivalSplit.early} / ${rivalSplit.late}). ` +
        'Front-loaded is a bootstrap - a seat with nothing worth visiting yet. Flat or rising ' +
        'is risk 2 landing.',
      perGameLine(games.length, bonusTurns, turns),
    ],
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
  };
}

/** The meeple-loop arm (04/09/2026). Same sentence, different menu. */
function meepleArm({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const bonusTurns = totalBonusTurns(games);

  const rivals = sum(games.map((g) => sum(g.visitsBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const withMeeples = sum(games.map((g) => sum(g.collectsWithMeeplesBySeat)));
  const empty = sum(games.map((g) => sum(g.collectsEmptyBySeat)));
  const unspent = Math.max(0, turns - bonusTurns);
  const wild = sum(games.map((g) => sum(g.wildVisitsBySeat)));
  // ⭐ THE TOLL LINE (R6 amended, handoff v2 section 3.7): what share of every
  // rival visit paid something to enter an already-occupied slot. Zero by
  // construction whenever `rules.turn.slotToll` is null (the v1 default),
  // because `visitToll` never fires there and an occupied slot still refuses
  // the colour outright instead.
  const tollVisits = sum(games.map((g) => sum(g.tollVisitsBySeat)));
  const tollPaid = sum(games.map((g) => sum(g.tollMeeplesPaidBySeat)));
  const toll = data.rules.turn.slotToll;

  if (turns === 0) {
    return { value: NaN, headline: 'not measured: no turns were played', verdict: 'OBSERVE' };
  }

  const share = (n: number) => pct(n / turns);
  // ONE solitaire column under the arm, and naming it in a list of one is
  // deliberate: it keeps the verdict's shape identical to the control's, so a
  // second solitaire option (a knob that made an empty collect draw more, say)
  // is added to the list rather than rewritten around.
  const solitaire: [string, number][] = [['collect an EMPTY board', empty]];
  const [worstName, worst] = solitaire.reduce((a, b) => (b[1] > a[1] ? b : a));
  const value = rivals === 0 ? (worst > 0 ? Infinity : NaN) : worst / rivals;
  const split = earlyLate(games, (g) => g.neighbourVisitRounds);

  const detail = [
    `the four-way tally, as a share of every turn played: visit a rival ${share(rivals)}, ` +
      `collect WITH meeples ${share(withMeeples)}, collect an EMPTY board ${share(empty)}, ` +
      `SLOT UNSPENT ${share(unspent)}`,
    `visit share of the slots that WERE spent: ` +
      `${pct(bonusTurns === 0 ? NaN : rivals / bonusTurns)} of ${bonusTurns}; collects take ` +
      `${pct(bonusTurns === 0 ? NaN : (withMeeples + empty) / bonusTurns)}, of which ` +
      `${pct(withMeeples + empty === 0 ? NaN : empty / (withMeeples + empty))} were empty boards`,
    '⚠️ THESE FOUR SHARES DO NOT SUM TO 100% AND ARE NOT MEANT TO. A Helping Hand (R11) grants ' +
      'BOTH bonus options in one turn - one Visit and one Collect - so a turn can appear in two ' +
      'columns at once, while SLOT UNSPENT is one per turn. The columns are shares of TURNS, ' +
      'not slices of a pie, and the same is true of the control arm’s four. Read each against ' +
      'the others, never as parts of a whole.',
    '⭐ THE EMPTY-BOARD COLLECT IS THE FREE DRAW 1 UNDER A NEW NAME (R9 deletes the standalone ' +
      'draw, R7 keeps the one attached to Collect and makes collecting nothing explicitly ' +
      'legal), which is why it and not "collects" carries the verdict. A collect that took ' +
      'meeples home is the return leg of a rival’s visit and is NOT solitaire.',
    `${wild} of ${rivals} visits were paid with a WILD PAIR ` +
      `(${pct(rivals === 0 ? NaN : wild / rivals)}); assertion 7 owns that number and the ` +
      'open question it decides - colour-keyed slots against five unkeyed spaces.',
    toll === null
      ? '⭐ TOLL VISITS (R6 amended, handoff v2 section 3.7): 0, by construction - ' +
        '`rules.turn.slotToll` is null under this run, so an occupied slot still refuses that ' +
        'colour outright (v1) rather than pricing it, and `visitToll` never fires.'
      : `⭐ TOLL VISITS (R6 amended, handoff v2 section 3.7): ${tollVisits} of ${rivals} rival ` +
        `visits paid a toll (${pct(rivals === 0 ? NaN : tollVisits / rivals)}), ${tollPaid} ` +
        `toll meeples in all (mean ${num(tollVisits === 0 ? NaN : tollPaid / tollVisits, 2)} ` +
        `per toll visit, against a printed rate of ${toll} extra meeple(s) per occupant). The ` +
        'toll is a SINK, not a payment to the host - it goes to the box, never into the slot - ' +
        'so a rising toll share is the amended R6 doing its job, not a second solitaire option. ' +
        'Assertion 15 carries the same meeples counted from the payer’s side and the pool line ' +
        'they drain into.',
    receivedSpreadLine(games, rivals),
    UNSPENT_CAVEAT,
    '⚠️ AND UNDER THIS ARM THE UNSPENT FLOOR IS STRUCTURALLY LOWER, which is not a result. ' +
      'Collect is legal on an empty board whenever any deck is alive, so the slot is almost ' +
      'never dead; under the control a seat with an empty hand and nothing to draw had no ' +
      'option at all. Expect unspent to fall between the arms for that reason alone.',
    `the rival visit, early against late: ${split.early} before each game's midgame, ` +
      `${split.late} after. Every seat starts holding one meeple of each colour (R3), so the ` +
      'opening is artificially rich; front-loaded says the loop is not feeding itself once the ' +
      'starting five have been spent, which is the same finding as a high empty-collect share ' +
      'arriving from the other direction.',
    `⭐ SELF-VISITS: ${selves}, and anything but 0 is an engine bug (X5 rules out the ` +
      'self-visit under any flag). Assertion 8 owns that invariant and fails on it.',
    perGameLine(games.length, bonusTurns, turns),
  ];

  return {
    value,
    headline:
      `visit a rival takes ${share(rivals)} of ${turns} turns, biggest solitaire option ` +
      `${worstName} at ${share(worst)}; SLOT UNSPENT ${share(unspent)}`,
    detail,
    verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 1 ? 'FAIL' : 'PASS',
  };
}

const UNSPENT_CAVEAT =
  '⚠️ SLOT UNSPENT IS THE RATIONAL FLOOR, NOT A PREDICTION. The bonus slot is a window that ' +
  'shuts when it is spent, and the evaluator was taught to take a closing window rather than ' +
  'let it lapse - so this measures a player who never forgets. The plan wants it tallied ' +
  'because a HUMAN forgets, and forgetting is a failure a bot cannot model. A LOW share here ' +
  'is NOT evidence that the restriction is harmless at a table; it says only that a perfectly ' +
  'attentive player loses nothing to it. Read the DELTA against ' +
  'overlays/bonus-any-time.overlay.json, never the absolute.';

function perGameLine(games: number, bonusTurns: number, turns: number): string {
  return (
    `mean bonus spends per game: ${num(games === 0 ? NaN : bonusTurns / games, 1)} ` +
    `of ${num(games === 0 ? NaN : turns / games, 1)} turns`
  );
}

/**
 * ⭐ THE SPREAD OF VISITS RECEIVED, BY SEAT (handoff v2 section 3.7: "does the
 * popular farm change hands"). For each game, the MOST-visited seat's share of
 * that game's rival visits, against an even share (1 / seat count). Pooled
 * across games, mean and even-share side by side.
 *
 * ⚠️ THIS MEASURES CONCENTRATION, NOT ROTATION, and that limit is honest
 * rather than hidden: a share sitting near even could still be the SAME seat
 * being visited most every game (a stable favourite) or a DIFFERENT seat each
 * game (a genuinely changing hand) - `visitsReceivedBySeat` alone cannot tell
 * the two apart, and neither reading is invented here. A share sitting well
 * ABOVE even is the one thing this line can say cleanly: some seat's board is
 * a materially more popular target than the rest, whoever it is.
 */
function receivedSpreadLine(games: readonly GameMetrics[], rivals: number): string {
  const shares: number[] = [];
  const evenShares: number[] = [];
  for (const g of games) {
    const received = g.visitsReceivedBySeat.slice(0, g.seats);
    const total = received.reduce((a, b) => a + b, 0);
    if (total === 0 || g.seats === 0) continue;
    shares.push(Math.max(...received) / total);
    evenShares.push(1 / g.seats);
  }
  const meanShare = shares.length === 0 ? NaN : shares.reduce((a, b) => a + b, 0) / shares.length;
  const meanEven =
    evenShares.length === 0 ? NaN : evenShares.reduce((a, b) => a + b, 0) / evenShares.length;
  return (
    `the most-visited seat's share of its own game's rival visits, mean across ${shares.length} ` +
    `games with at least one: ${pct(meanShare)} (an even share at this table size would be ` +
    `${pct(meanEven)}, of ${rivals} rival visits pooled). Read as CONCENTRATION, not rotation - ` +
    'see the field comment for the distinction this line cannot make on its own.'
  );
}

/** Rounds before and after each game's own midgame, so games of different lengths pool. */
function earlyLate(
  games: readonly GameMetrics[],
  pick: (g: GameMetrics) => readonly number[],
): { early: number; late: number } {
  let early = 0;
  let late = 0;
  for (const g of games) {
    const mid = g.rounds / 2;
    for (const round of pick(g)) {
      if (round <= mid) early += 1;
      else late += 1;
    }
  }
  return { early, late };
}
