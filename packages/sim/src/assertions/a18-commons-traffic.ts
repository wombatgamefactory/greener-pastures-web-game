import {
  commonsWildPair,
  isCommons,
  isNoticeBoardPower,
  isCommonsTakeCoins,
  isCommonsTakePaid,
  isCommonsTakeToHand,
  isCommonsTakeToSpend,
  unclaimedBoardsToCentre,
} from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalTurns } from './lib.js';
import { mean, median, num, pct, sum } from '../stats.js';

/**
 * NEW ON 09/09/2026 WITH THE COMMONS, and it exists because `a08-the-hook` lost
 * its subject rather than because a new question appeared.
 *
 * ## What it is for
 *
 * The commons (C1) puts the five Notice Boards in the CENTRE of the table,
 * ownerless. Nobody has a board, so nobody can be visited: `visited` never
 * fires and a08's "NEIGHBOUR visits per player per turn" is a rate over an event
 * that cannot happen. **The interaction did not go away, it changed shape** -
 * every player feeds the same five public piles and every player may harvest one
 * (C5) - so the readings that used to sit under a08 have to sit somewhere, and
 * this is where.
 *
 * ## ⛔ IT HAS NO FAIL CONDITION IN THIS PASS, AND THAT IS DELIBERATE
 *
 * Every number below is OBSERVE. The design names no figure for any of them, the
 * handoff names none, and the project's own bar (ticket 11 section 2) is that a
 * threshold comes from design intent expressed as shape and NEVER from our own
 * first run, because a threshold set from a first run is a snapshot test that
 * can never fail. The commons has been run zero times; every number here is
 * about to be measured for the first time on `reference-v15`, which does not yet
 * have a noise floor either.
 *
 * ⭐ **THE ONE NUMBER DEAN DID SET IS THE PLAY RATE, AND IT BELONGS TO a17**
 * ("30%-60% of the time... earned, not automatic"). It is repeated here as the
 * first line because everything else on this page is read against it, but the
 * VERDICT on it is a17's and must not be duplicated: two assertions failing on
 * one number would double-count a single finding, which is exactly the trap a16
 * documents about its own relationship with a08.
 *
 * ## ⭐⭐ THE READING THIS FILE EXISTS FOR: THE FARM BYPASS
 *
 * **"If the centre out-supplies the farm, the building engine is decoration."**
 * That sentence is printed beside the number in the report, not only here.
 *
 * The mechanism is legible and it is new. A card played onto a central board
 * costs its payer a card and buys an action; it then SITS in a public pile until
 * somebody harvests the whole pile into their barn (C5). So the centre is a barn
 * faucet that nobody had to grow anything to fill. The game the design wants is
 * sow -> grow -> clog -> harvest -> deliver, a gestation the original's
 * load-and-deliver pattern deliberately lacks; if a seat can instead wait for a
 * pile to get fat and take five cards in one action, the whole building layer -
 * thresholds, clog, the harvest valve every suit needs - is a scenic route to a
 * barn that has a shortcut. `barnFromCommonsBySeat` against `barnFromOwnBySeat`
 * is that question in one ratio.
 *
 * ⚠️ **A HIGH CENTRE SHARE IS NOT AUTOMATICALLY A FAULT**, which is the other
 * half of why this ships as OBSERVE. Harvesting a fat pile is one action for a
 * pile several rivals paid to fill, so it is also the only place in this design
 * where somebody else's spending pays you - the host-side payment the meeple
 * loop kept failing to find. The same number is the design working and the
 * design hollowed out, and only a table can say which. What the instrument can
 * do is put it beside the pile depth and the harvest rate so the shape is
 * visible.
 *
 * ## ⭐⭐ DEAN'S QUESTION OF 09/09/2026, AND THE FOUR READINGS ADDED FOR IT
 *
 * *"Can we measure how many cards are taken when the Harvest is done against the
 * centre cards? I'm interested to see if we place a threshold on the centre
 * cards if it will reduce the number of cards going from the centre to the barns
 * - my target is about 30-40% of barn cards should come from the middle."*
 *
 * The share read **63.1%** on the shipped rules, and the first answer -
 * `commonsThreshold`, a cap on the INFLOW - measured nothing at all at 2 (63.1%
 * against 63.0%). The reason is in two of the numbers below, which is why they
 * are now printed rather than derivable:
 *
 *   - **THE DISTRIBUTION OF CARDS TAKEN.** A central harvest already takes a
 *     MEDIAN OF TWO cards, so a cap of two caps almost nothing. The histogram
 *     (1 / 2 / 3 / 4 / 5+) says how much of the outflow a given cap could ever
 *     have reached, and it is the reading that would have predicted the null
 *     result before the run rather than after it.
 *   - **THE CONSERVATION LINE.** The centre is CLOSED: cards enter only by a
 *     play (C3) and leave only by a harvest (D3), so `plays = harvested out +
 *     stranded at game end`, exactly, in every game. All three are printed so a
 *     reader can check the arithmetic. ⭐ **It is also the answer to why an
 *     inflow cap cannot move the share**: every card played into the centre
 *     reaches somebody's barn unless the game ends first, so capping plays
 *     changes WHEN cards leave and not how many. The only rule that can change
 *     the ratio without changing the play rate is one that leaves cards behind -
 *     `commonsHarvestTake` - and the stranded column is where its cost shows up.
 *
 * ⚠️ **THE TARGET IS PRINTED AND CARRIES NO VERDICT.** 30-40% is Dean's aim
 * and not a design threshold expressed as shape, and this assertion cannot fail
 * (see the section above). The share is reported pooled AND by seat count,
 * because a share that sits inside the band at four seats and far outside it at
 * two is a different finding from one that misses everywhere.
 *
 * ## The fee-suit mix (L5)
 *
 * Any card pays for any board (C3), so which card a seat burns is a free choice
 * and the off-crop share says what kind of choice it is. A farm feeding the
 * centre with its OWN suit is burning its engine to buy an action; a farm
 * feeding it with somebody else's is clearing junk, which is what L5 wants and
 * what makes the fee cheap enough to pay often. ⚠️ It reads CARD IDENTITY off
 * the catalogue, which the bots may never do and the fold may - see
 * `commonsPlaysByFeeSuit`.
 *
 * ⚠️ **THE BOTS ARE NOT PRICED FOR ANY OF THIS.** They pick a fee by
 * `visitFeeJunk` and a board by what its action is worth to them alone; nothing
 * in the pricer knows that a card played onto a pile is a card a RIVAL may
 * harvest, and no bot has ever declined to fatten a pile the leader was about to
 * take. That is the same shape of blindness ledger C64 records about R17's
 * host choice, arriving one design later, and it means the readings below are
 * the RULES speaking rather than a taste.
 *
 * ## ⭐⭐ AND ON 10/09/2026 THIS FILE GAINED A SECOND SUBJECT: THE FARM
 *
 * The notice-board visit (S2, S5, S7) deletes the centre and sends the five
 * Notice Boards home to their owners as buildings. The interaction did not go
 * away and it did not go back to being nothing - it went back to being
 * PERSONAL: a visit is one card from your hand onto a named player's board, and
 * that card rests there until its owner harvests it into their barn, which is
 * the host's whole payment and there is no other.
 *
 * ⚠️ **SO a08 IS RESTORED AND THIS FILE DOES NOT GO QUIET.** The two are not
 * duplicates and the division is the same one that has always held here: a08
 * carries the RATE and its floor, and this file carries the SHAPE of the
 * traffic, which a rate cannot show. Four readings, and they are the handoff's
 * own numbers 4 and 5:
 *
 *   - **VISITS RECEIVED PER PLAYER.** The hook is a rate at the payer; being
 *     visited is the payment at the host, and only this side says whether the
 *     payment arrives evenly or lands on one farm.
 *   - **THE SPREAD BETWEEN THE BUSIEST AND THE QUIETEST BOARD.** ⚠️ The
 *     handoff's own warning rides with it: CHECK AVAILABILITY AGAINST VALUE
 *     BEFORE CALLING A POWER MISPRICED. On 10/09/2026 the fires-by-suit spread
 *     turned out to be availability rather than power, and S10 and S9 both
 *     ration a board before its power is ever priced.
 *   - **CARDS RESTING ON BOARDS BY GAME THIRD.** The farm's answer to the
 *     centre's size by third. A series that climbs and never falls is boards
 *     nobody clears, which is a20's question arriving from the other side; one
 *     that sits near zero is a payment that is being collected the moment it
 *     lands.
 *   - **THE FARM BYPASS, REDEFINED.** Under the commons it meant barn cards
 *     that came out of the CENTRE. Here it means barn cards that arrived as
 *     SOMEBODY ELSE'S FEE: the host's payment, counted at the moment it is
 *     banked rather than at the moment it lands, because a gift that dies on a
 *     board nobody clears was never received. ⭐ The v31 comparison is the one
 *     to hold it against - about 29 fee cards a game reached barns that way and
 *     the barn glut did not move when the flow stopped - and it is a DIFFERENT
 *     ratio from the commons' 63.0%, so the two must never be diffed as levels.
 *
 * ⛔ **STILL NO FAIL CONDITION, FOR THE IDENTICAL REASON.** The design names no
 * number for any of the four, the handoff names none, and one taken from the
 * first run of an arm nobody has played would be a snapshot test. a17 owns the
 * one number Dean did set.
 *
 * ## No subject under the controls
 *
 * Under `visitCurrency: 'card'` and `'meeple'` there is no commons at all: every
 * counter this reads is a structural zero and the assertion says so rather than
 * printing five zeroes that read as findings.
 */
export const commonsTraffic: Assertion = {
  id: 18,
  // ⭐ RETITLED 10/09/2026 WHEN THE FILE GAINED ITS SECOND SUBJECT. The id and
  // the question are unchanged - where does the traffic go, and what share of a
  // barn did somebody else pay for - and only the surface it happens on moved.
  title: 'The traffic, centre or farm',
  quote:
    'a08-the-hook: no neighbour exists. Under commons it reports "no subject" and a new ' +
    'a18-commons-traffic carries the interaction readings: plays per player per turn, central ' +
    'harvests per player per game, median pile size at harvest, share of barn cards sourced ' +
    'from the centre against own buildings (OBSERVE, with the sentence "if the centre ' +
    'out-supplies the farm, the building engine is decoration" printed beside it), and the ' +
    'fee-suit mix. [10/09/2026, the notice-board visit] a18 becomes a farm-traffic reading: ' +
    'visits received per player, the spread between the busiest and quietest board, cards ' +
    'resting on boards by game third, and the farm-bypass share, which now means cards that ' +
    'reached a barn as somebody else’s fee.',
  source:
    'docs/commons-handoff-2026-09-09-v1.md section 2.7 and the measurement plan (section 3), ' +
    'readings 3, 4 and 7; C1, C3 and C5 of section 1; ' +
    'docs/notice-board-visit-handoff-2026-09-10-v2.md section 3.4 and readings 4 and 5 of ' +
    'section 4; S2, S5 and S7 of section 2',
  shape:
    'Plays per player per turn and per game; central harvests per player per game, split by ' +
    'whether they were the MAIN Harvest or one BOUGHT through the wheat board; the mean, ' +
    'median, p90, max and full 1/2/3/4/5+ distribution of cards taken per central harvest; the ' +
    'conservation line (plays into the centre = cards harvested out + cards stranded at game ' +
    'end); barn cards from the CENTRE against barn cards off a seat’s own buildings, pooled ' +
    "AND by seat count, with Dean's 30-40% target printed beside it; the fee-suit mix with the " +
    'off-crop share; and the median size of the whole centre by game third. No subject under ' +
    'visitCurrency "card" or "meeple". ' +
    "⭐ UNDER DEAN'S VARIANT (rules.turn.commonsTake: 'bonus', 09/09/2026) THE HARVEST-SIDE " +
    'READINGS ARE REPLACED WHOLE: central harvests, the harvest histogram and the wheat-board ' +
    "split all read 0 or 'no subject' by construction - Harvest never reaches the centre under " +
    'that knob - and are printed instead as central TAKES per player per game, the take-size ' +
    'distribution, the conservation line re-derived as plays = taken out + stranded, and the ' +
    'farm bypass moved from the barn to the HAND (cards taken to hand from the centre, against ' +
    "deck draws where that count exists). ⭐ UNDER commonsTake: 'spend' (09/09/2026) THE " +
    'HARVEST-SIDE READINGS ARE ALSO REPLACED, but five ways rather than one free draw: takes per ' +
    'player per game by BOARD; cards taken/used/discarded per game, with the discard named as ' +
    'the first SINK the commons line has had; deliveries paid straight from the vegetable pile, ' +
    'against every delivery in the game; the conservation line re-derived as plays = to hand + ' +
    'to barn + spent + discarded + stranded; and the farm bypass moved to the WHEAT leg alone ' +
    '(barn cards from a wheat take against a seat’s own buildings), beside the same 30-40% target. ' +
    "⭐ UNDER commonsTake: 'coins' (10/09/2026) THE FARM BYPASS IS A STRUCTURAL 0% and says so " +
    'rather than printing a zero: Harvest never reaches the centre and no take puts a card in a ' +
    'hand or a barn, so the centre’s only exit leads OUT OF THE GAME. The conservation line is ' +
    're-derived as cards into the centre = cards discarded by coin takes + cards stranded at ' +
    'game end, in CARDS rather than plays because the wild pair puts two cards in for one play, ' +
    'and the take-size distribution doubles as the distribution of coins minted per take. ' +
    '⭐ UNDER visitCurrency "noticeBoardPower" (10/09/2026) IT IS A FARM READING AND NOT A ' +
    'CENTRE ONE: visits received per player per game, pooled and by seat count; the spread ' +
    'between the busiest and the quietest BOARD, as each one’s share of its own game’s ' +
    'placements against an even share; cards resting on all the boards by game third; and the ' +
    'farm bypass REDEFINED as the share of barn cards that arrived as somebody else’s fee, ' +
    'counted when the host banks it rather than when it lands. ' +
    "⭐ UNDER rules.economy.unclaimedBoardsToCentre (Dean's variant, 11/09/2026) IT CARRIES " +
    'BOTH SURFACES AT ONCE, and the decisive line is printed FIRST: CENTRAL PLAYS AGAINST ' +
    'RIVAL VISITS by seat count, with the cross-table share of every play the slot bought; ' +
    'visits RECEIVED per player by seat count; the busiest-against-quietest spread taken ' +
    'across ALL FIVE boards wherever they sit, with the share of games a CENTRAL board led the ' +
    'table; cards resting on owned boards AND on central piles by game third, side by side and ' +
    'never pooled; the farm bypass split THREE ways (your own farm / a rival’s fee off your ' +
    'own board / a central pile you won); and A16 The Beekeeper’s Veil’s fires split by which ' +
    'kind of play caused them, because a central play can never fire it. ' +
    "⭐ AND UNDER rules.economy.noticeBoardsBySeats (Dean's two-board fix, 11/09/2026) THE " +
    'SPREAD IS SPLIT A SECOND WAY, BY WHICH KIND OF BOARD IT IS: reading 4d gives an own-suit ' +
    'board’s mean share of its game’s placements against a RANDOMLY DRAWN board’s, and the ' +
    'share of games in which the busiest board on the table was a random one. OBSERVE, no fail ' +
    'condition: the extra board’s power is usable only by its owner’s rivals and which one you ' +
    'get is luck, so this is the reading that says whether a table would call the draw unfair.',
  threshold:
    'OBSERVE, and there is NO FAIL CONDITION in this pass. The design names no number for any ' +
    'of these readings, the handoff names none, and one taken from the first commons run would ' +
    'be a snapshot test that can never fail (ticket 11 section 2). The one number Dean did set ' +
    'is the PLAY RATE band of 30%-60%, and that belongs to a17: it is repeated in the first ' +
    'line here as context and deliberately carries no verdict, because two assertions failing ' +
    'on one number would report a single finding twice. ⭐ DEAN’S 30-40% TARGET FOR THE ' +
    "CENTRE'S SHARE OF BARN CARDS (09/09/2026) IS PRINTED AND ALSO CARRIES NO VERDICT: it is an " +
    'aim he stated while asking for a measurement, not a threshold expressed as shape, and ' +
    'turning an aim into a fail condition on the run that first measures it is the same trap. ' +
    '⭐ OBSERVE UNDER "noticeBoardPower" TOO, and the handoff says so in as many words. ' +
    'Neither Dean’s 30-40% target nor the commons’ 63.0% may be read against the farm bypass ' +
    'there: it is a different ratio over a different denominator - somebody else’s fee against ' +
    'every card that entered a barn - and the only level it can honestly be held against is ' +
    'v31’s roughly 29 fee cards a game, which is a count and not a share. ' +
    '⛔ AND THE THREE-WAY SPLIT OF 11/09/2026 IS A THIRD RATIO AGAIN, comparable with NEITHER ' +
    'of those two: it is over the HARVEST routes alone rather than over every route into a ' +
    'barn, and it has three columns rather than two. The commons’ 63.0% and the notice-board ' +
    'visit’s 27.7% of 10/09/2026 are both quoted on this page as the things it is NOT. Pair ' +
    'the four corners of the 2x2 on identical seeds; never quote a level across the change.',
  taste: true,
  remedy:
    `${NO_REMEDY} in this pass - nothing here can fail, so nothing here prescribes. The two ` +
    'arms that move these numbers if a table says they are wrong are ' +
    'overlays/commons-threshold-2.overlay.json (rules.economy.commonsThreshold 2, which caps ' +
    'how fat a pile may get and therefore how big a harvest of the centre can be) and ' +
    'overlays/commons-colour-match-v1.overlay.json (rules.economy.commonsColourMatch true, ' +
    'which stops any card paying for any board and would change the fee-suit mix directly). ' +
    'Both are C10 fallbacks, built and shipped OFF so that the cap is one number away. ' +
    '⭐ AND SINCE 09/09/2026 THERE ARE TWO MORE, BUILT FOR DEAN’S 30-40% TARGET, because the ' +
    'first one measured nothing: rules.economy.commonsHarvestMin (overlays/commons-harvest-min-2, ' +
    '-3, -4) gates the OUTFLOW - a pile may not be harvested below n, the building semantic - and ' +
    'rules.economy.commonsHarvestTake (overlays/commons-take-1, -2) caps how many cards come out ' +
    'and leaves the rest standing, which is the ONLY one of the three that can reduce the ' +
    "centre's outflow without reducing plays. Sweep them one at a time and read each against the " +
    'conservation line. ' +
    `${NO_REMEDY} under "noticeBoardPower" either, and nothing here can fail, so nothing here ` +
    'prescribes. The arms that move these numbers are ' +
    'overlays/notice-board-visit-no-self-v1.overlay.json (which is the one that can move the ' +
    'RECEIVED side, because a self-visit pays its own host), the threshold sweep ' +
    '-threshold-2-v1 and -threshold-4-v1 (which move what a board is worth clearing and ' +
    'therefore how long a fee rests before it is banked), and -blocking-v1. a20-board-stall ' +
    'reads the resting half of this page from the owner’s side.',
  measure({ data, pooled }) {
    // ⭐ ASKED FIRST AND BY NAME (10/09/2026). Without it the notice-board
    // visit lands on `noSubject`, which says "the boards belong to players in
    // both controls and a08 carries the interaction readings there" - true of
    // the two controls and only half true here, because the boards DO belong to
    // players and a08 IS restored, but the four readings below have no other
    // home and would simply vanish.
    if (isNoticeBoardPower(data)) return farmTraffic({ data, pooled });
    if (!isCommons(data)) return noSubject();
    const games = pooled.ended;
    const turns = totalTurns(games);
    const plays = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
    // ⛔ CARDS, NOT PLAYS, AND THE CONSERVATION IDENTITY IS WRITTEN IN CARDS.
    // `rules.economy.commonsWildPair` (K3, 10/09/2026) lets two cards pay for one
    // board, so a play count cannot balance a centre that is counted in cards. The
    // two are equal under every knob but the pair, which is why every identity below
    // reads this one and every rate reads `plays`.
    const cards = sum(games.map((g) => sum(g.commonsCardsIntoCentreBySeat)));
    const wildPairPlays = sum(games.map((g) => sum(g.commonsWildPairPlaysBySeat)));
    const seatGames = sum(games.map((g) => g.seats));

    const feeTotal = sum(games.map((g) => sum(Object.values(g.commonsPlaysByFeeSuit))));
    const feeMix = new Map<string, number>();
    for (const g of games) {
      for (const [suit, n] of Object.entries(g.commonsPlaysByFeeSuit)) {
        feeMix.set(suit, (feeMix.get(suit) ?? 0) + n);
      }
    }
    const offCrop = sum(games.map((g) => g.commonsPlaysOffCrop));

    // The centre's size by third, pooled as the MEDIAN OF PER-GAME MEDIANS.
    // Each game computes its own thirds in `finish` for the reason that field's
    // comment gives: games are different lengths, so a series aligned on round 1
    // would compare one game's endgame with another's midgame.
    const thirds = [0, 1, 2].map((i) =>
      median(
        games.flatMap((g) => {
          const v = g.commonsPileSizeByRoundThird[i];
          return v === undefined || !Number.isFinite(v) ? [] : [v];
        }),
      ),
    );

    const feeSuitLines = [
      `THE FEE-SUIT MIX (L5), what the table actually burns: ${[...feeMix.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([suit, n]) => `${suit} ${pct(feeTotal === 0 ? NaN : n / feeTotal, 0)}`)
        .join('  ')}`,
      `OFF-CROP SHARE: ${pct(feeTotal === 0 ? NaN : offCrop / feeTotal)} of plays paid with a ` +
        `card that was NOT the payer's own suit (${offCrop} of ${feeTotal}). A farm feeding ` +
        'the centre with its OWN suit is burning its engine to buy an action; one feeding it ' +
        'with somebody else’s is clearing junk, which is what L5 wants. Any card pays for ' +
        'any board by default (C3); overlays/commons-colour-match-v1.overlay.json is the arm ' +
        'that removes the choice.',
      `THE CENTRE'S SIZE BY GAME THIRD, median cards standing on all five piles: ` +
        `${thirds.map((t, i) => `${['first', 'middle', 'last'][i]} ${num(t, 1)}`).join('  ')}. ` +
        'A series that climbs and never falls is a centre nobody bothers to harvest, which ' +
        'is a different failure from one that empties every round.',
      '⚠️ THE BOTS ARE NOT PRICED FOR ANY OF THIS. A fee is picked by visitFeeJunk and a ' +
        'board by what its action is worth to the payer alone; nothing in the pricer knows ' +
        'that a card played onto a pile is a card a RIVAL may harvest, and no bot has ever ' +
        'declined to fatten a pile the leader was about to take. That is ledger C64’s ' +
        'blindness arriving one design later: these numbers are the RULES speaking, not a ' +
        'taste.',
      '⛔ NO FAIL CONDITION IN THIS PASS. Every line above is OBSERVE, because the design ' +
        'names no number for any of them and one taken from this run would be a snapshot ' +
        'test. reference-v15 has no noise floor either, so a delta in any of these is not ' +
        'yet formally readable.',
    ];

    // ⭐ DEAN'S VARIANT (09/09/2026, `rules.turn.commonsTake: 'bonus'`): Harvest
    // never reaches the centre under this knob (see `harvestOptions`), so the
    // whole harvest-side half of this file - central harvests, the pile-depth
    // histogram, the wheat-board split, the farm bypass into the BARN - reads 0
    // or has no subject BY CONSTRUCTION. The bypass moved from the barn to the
    // HAND instead: a `commonsTake` move carries the whole of it, so this
    // branch reports takes where the shipped branch below reports harvests.
    if (isCommonsTakeToHand(data)) {
      const takes = sum(games.map((g) => sum(g.commonsTakesBySeat)));
      const stranded = sum(games.map((g) => g.commonsStrandedAtEnd));
      const takenCards = sum(games.map((g) => sum(g.commonsTakenCardsBySeat)));
      const sizes = games.flatMap((g) => g.commonsTakeSizes);
      const value = turns === 0 ? NaN : plays / turns;

      const buckets = [1, 2, 3, 4].map((n) => sizes.filter((x) => x === n).length);
      const big = sizes.filter((x) => x >= 5).length;
      const histogram = [...buckets.map((c, i) => [`${i + 1}`, c] as const), ['5+', big] as const]
        .map(
          ([label, count]) =>
            `${label}: ${count} ${pct(sizes.length === 0 ? NaN : count / sizes.length, 0)}`,
        )
        .join('   ');

      return {
        value,
        headline:
          `${num(value, 2)} plays per player per turn (${plays} plays over ${turns} turns); ` +
          `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} central takes per player ` +
          `per game; central harvests read 0 by construction under commonsTake: 'bonus'`,
        detail: [
          `⭐ DEAN'S VARIANT (rules.turn.commonsTake: 'bonus', 09/09/2026): CENTRAL HARVESTS ` +
            'READ 0 BY CONSTRUCTION. harvestOptions never returns a central board under this ' +
            'knob, so the wheat board buys an own-building Harvest or nothing at all - a central ' +
            'pile is reached only through the new `commonsTake` bonus move, which is reported ' +
            'here instead. `commonsHarvestMin` and `commonsHarvestTake` have no subject.',
          `⚠️ THE PLAY RATE IS a17'S NUMBER AND ITS VERDICT IS a17'S: ` +
            `${pct(value)} of turns play a card, against Dean's band of 30%-60% ("earned, not ` +
            'automatic", 09/09/2026). It is repeated here because everything else on this page ' +
            'is read against it, and it deliberately carries no verdict here.',
          `plays per game: ${num(games.length === 0 ? NaN : plays / games.length, 1)} across ` +
            `${games.length} ended games, ${num(seatGames === 0 ? NaN : plays / seatGames, 1)} ` +
            'per player per game.',
          `CENTRAL TAKES: ${takes} in all, ` +
            `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} per player per game, taking ` +
            `a mean of ${num(mean(sizes), 2)} and a median of ${num(median(sizes), 1)} cards ` +
            `(p90 ${num(percentile(sizes, 0.9), 1)}, ` +
            `max ${sizes.length === 0 ? 'n/a' : sizes.reduce((a, b) => (b > a ? b : a), 0)}). A ` +
            "pile only ever leaves by a take (Dean's variant) or by sitting stranded at game " +
            'end - never by Harvest.',
          `⭐ CARDS TAKEN PER CENTRAL TAKE, the distribution: ${histogram}.`,
          `⭐⭐ THE CONSERVATION LINE, per game, RE-DERIVED FOR THE VARIANT: ` +
            `${num(games.length === 0 ? NaN : cards / games.length, 1)} cards played INTO the ` +
            `centre = ${num(games.length === 0 ? NaN : takenCards / games.length, 1)} TAKEN OUT ` +
            `+ ${num(games.length === 0 ? NaN : stranded / games.length, 1)} STRANDED at game ` +
            `end (${cards} = ${takenCards} + ${stranded} over ${games.length} ended games; ` +
            `stranded is ${pct(cards === 0 ? NaN : stranded / cards)} of cards). The shipped ` +
            'line reads plays = harvested out + stranded; under this variant nothing is ever ' +
            'harvested out of the centre, so the line becomes plays = TAKEN out + stranded, and ' +
            'the same closed-system arithmetic still has to balance.',
          `⭐⭐ THE FARM BYPASS MOVED FROM THE BARN TO THE HAND. It reads 0% CENTRE-TO-BARN BY ` +
            "CONSTRUCTION - no harvest of a central pile is possible under commonsTake: 'bonus', " +
            'so `barnFromCommonsBySeat` is a structural zero and the old ratio has no subject. ' +
            `THE NUMBER TO READ INSTEAD: ${takenCards} cards moved to a HAND from the centre ` +
            `(${num(games.length === 0 ? NaN : takenCards / games.length, 1)} a game, ` +
            `${num(seatGames === 0 ? NaN : takenCards / seatGames, 1)} per player per game) ` +
            'against cards drawn from decks per game - which this instrument does not currently ' +
            'total, so only the centre-to-hand count is printed. **IF THAT COUNT DWARFS A ' +
            "SEAT'S DECK DRAWS, THE SAME QUESTION APPLIES UNDER A NEW NAME: is the hand being " +
            "filled by the table's own discipline (grow, harvest, deliver) or by a free lucky " +
            'dip into whichever pile got fat?**',
          ...feeSuitLines,
        ],
        verdict: 'OBSERVE',
      };
    }

    // ⭐ DEAN'S 'paid' VARIANT (09/09/2026, `rules.turn.commonsTake: 'paid'`):
    // `'bonus'` exactly - Harvest never reaches the centre, a take always
    // lands the whole pile in the taker's HAND, and `commonsTakesBySeat` /
    // `commonsTakeSizes` / `commonsTakenCardsBySeat` are read the same way -
    // except the take now costs a card, off `commonsTakeFeesBySeat`, which
    // `'bonus'` never populates. That fee is THE FIRST PER-USE SINK anywhere
    // in the commons line: `'spend'`'s own discard sink only ever catches
    // cards that were already in the centre and had nowhere left to go, where
    // this fee is a card that never touched the centre at all, burned on
    // every single take.
    if (isCommonsTakePaid(data)) {
      const takes = sum(games.map((g) => sum(g.commonsTakesBySeat)));
      const stranded = sum(games.map((g) => g.commonsStrandedAtEnd));
      const takenCards = sum(games.map((g) => sum(g.commonsTakenCardsBySeat)));
      const feesPaid = sum(games.map((g) => sum(g.commonsTakeFeesBySeat)));
      const sizes = games.flatMap((g) => g.commonsTakeSizes);
      const value = turns === 0 ? NaN : plays / turns;

      const buckets = [1, 2, 3, 4].map((n) => sizes.filter((x) => x === n).length);
      const big = sizes.filter((x) => x >= 5).length;
      const histogram = [...buckets.map((c, i) => [`${i + 1}`, c] as const), ['5+', big] as const]
        .map(
          ([label, count]) =>
            `${label}: ${count} ${pct(sizes.length === 0 ? NaN : count / sizes.length, 0)}`,
        )
        .join('   ');

      return {
        value,
        headline:
          `${num(value, 2)} plays per player per turn (${plays} plays over ${turns} turns); ` +
          `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} central takes per player ` +
          `per game, each PAID (${feesPaid} fees discarded, ` +
          `${num(games.length === 0 ? NaN : feesPaid / games.length, 1)} a game); central ` +
          `harvests read 0 by construction under commonsTake: 'paid'`,
        detail: [
          `⭐ DEAN'S 'paid' VARIANT (rules.turn.commonsTake: 'paid', 09/09/2026): CENTRAL HARVESTS ` +
            "READ 0 BY CONSTRUCTION, exactly as under 'bonus' - harvestOptions never returns a " +
            'central board under this knob, so the wheat board buys an own-building Harvest or ' +
            'nothing at all. `commonsHarvestMin` and `commonsHarvestTake` have no subject.',
          `⚠️ THE PLAY RATE IS a17'S NUMBER AND ITS VERDICT IS a17'S: ` +
            `${pct(value)} of turns play a card, against Dean's band of 30%-60% ("earned, not ` +
            'automatic", 09/09/2026). It is repeated here because everything else on this page ' +
            'is read against it, and it deliberately carries no verdict here.',
          `plays per game: ${num(games.length === 0 ? NaN : plays / games.length, 1)} across ` +
            `${games.length} ended games, ${num(seatGames === 0 ? NaN : plays / seatGames, 1)} ` +
            'per player per game.',
          `CENTRAL TAKES: ${takes} in all, ` +
            `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} per player per game, taking ` +
            `a mean of ${num(mean(sizes), 2)} and a median of ${num(median(sizes), 1)} cards ` +
            `(p90 ${num(percentile(sizes, 0.9), 1)}, ` +
            `max ${sizes.length === 0 ? 'n/a' : sizes.reduce((a, b) => (b > a ? b : a), 0)}). A ` +
            "pile only ever leaves by a take (Dean's variant) or by sitting stranded at game " +
            'end - never by Harvest.',
          `⭐ CARDS TAKEN PER CENTRAL TAKE, the distribution: ${histogram}.`,
          `⭐⭐ TAKE FEES DISCARDED: ${feesPaid} per game across ${games.length} games ` +
            `(${num(games.length === 0 ? NaN : feesPaid / games.length, 1)} a game, ` +
            `${num(seatGames === 0 ? NaN : feesPaid / seatGames, 2)} per player per game) - THE ` +
            "FIRST PER-USE SINK IN THE COMMONS LINE. Every take under 'paid' costs exactly one " +
            'fee (an enumerated take always carries one, D-P1), so this count and the take count ' +
            'above move together by construction: it exists as its own line so a reader does not ' +
            'have to infer the sink from the take rate.',
          `⭐⭐ THE CONSERVATION LINE, per game, RE-DERIVED FOR THE VARIANT: ` +
            `${num(games.length === 0 ? NaN : cards / games.length, 1)} cards played ONTO boards ` +
            `= ${num(games.length === 0 ? NaN : takenCards / games.length, 1)} TAKEN TO HAND ` +
            `+ ${num(games.length === 0 ? NaN : stranded / games.length, 1)} STRANDED at game ` +
            `end (${cards} = ${takenCards} + ${stranded} over ${games.length} ended games; ` +
            `stranded is ${pct(cards === 0 ? NaN : stranded / cards)} of cards). The fee never ` +
            'joins this identity at all - it never touches a central pile - which is exactly why ' +
            'it needs a SECOND identity of its own: cards paid as take fees = cards discarded ' +
            `(${feesPaid} = ${feesPaid}, by construction - fx.discardFromHand discards the same ` +
            'card `doCommonsTake` just charged, one for one, before the pile ever moves).',
          `⭐⭐ THE FARM BYPASS MOVED FROM THE BARN TO THE HAND. It reads 0% CENTRE-TO-BARN BY ` +
            "CONSTRUCTION - no harvest of a central pile is possible under commonsTake: 'paid', " +
            'so `barnFromCommonsBySeat` is a structural zero and the old ratio has no subject. ' +
            `THE NUMBER TO READ INSTEAD: ${takenCards} cards moved to a HAND from the centre ` +
            `(${num(games.length === 0 ? NaN : takenCards / games.length, 1)} a game, ` +
            `${num(seatGames === 0 ? NaN : takenCards / seatGames, 1)} per player per game) ` +
            'against cards drawn from decks per game - which this instrument does not currently ' +
            'total, so only the centre-to-hand count is printed. Read it beside the fee: a seat ' +
            'nets `takenCards - feesPaid` cards from a run of takes, never the raw pile size, ' +
            'because every take costs one to gain however many the pile held.',
          ...feeSuitLines,
        ],
        verdict: 'OBSERVE',
      };
    }

    // ⭐ THE COMMONS WITH COINS (K3/K4, Dean 10/09/2026, `rules.turn.commonsTake:
    // 'coins'`): the fourth branch, and the first one where the centre's outflow
    // leaves THE GAME rather than moving to a player. A take discards every card
    // on one pile to those cards' own suit discards and mints one coin per card;
    // Harvest never reaches the centre at all (K4, reversing C5). So the whole
    // harvest-side half of this file has no subject, exactly as under 'bonus',
    // 'paid' and 'spend' - but this time the farm bypass does not MOVE anywhere
    // either. It is a structural 0%, and it says so.
    if (isCommonsTakeCoins(data)) {
      const takes = sum(games.map((g) => sum(g.commonsTakesBySeat)));
      const stranded = sum(games.map((g) => g.commonsStrandedAtEnd));
      // Cards cleared OUT of the centre by a coin take. Under this knob they go
      // to their suits' discard piles rather than to anybody, so this counter is
      // the DISCARDED column of the conservation line rather than a hand's
      // intake. It equals the coins minted, card for card (K3), and a19 reads
      // the same quantity as a currency.
      const discardedByTakes = sum(games.map((g) => sum(g.commonsTakenCardsBySeat)));
      const coinsMinted = sum(games.map((g) => sum(g.coinsMintedBySeat)));
      const sizes = games.flatMap((g) => g.commonsTakeSizes);
      const fromOwn = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
      const value = turns === 0 ? NaN : plays / turns;

      const buckets = [1, 2, 3, 4].map((n) => sizes.filter((x) => x === n).length);
      const big = sizes.filter((x) => x >= 5).length;
      const histogram = [...buckets.map((c, i) => [`${i + 1}`, c] as const), ['5+', big] as const]
        .map(
          ([label, count]) =>
            `${label}: ${count} ${pct(sizes.length === 0 ? NaN : count / sizes.length, 0)}`,
        )
        .join('   ');

      return {
        value,
        headline:
          `${num(value, 2)} plays per player per turn (${plays} plays, ${cards} cards, over ` +
          `${turns} turns); ${num(seatGames === 0 ? NaN : takes / seatGames, 2)} coin takes per ` +
          `player per game; the farm bypass is 0% BY CONSTRUCTION under commonsTake: 'coins'`,
        detail: [
          `⭐ THE COMMONS WITH COINS (rules.turn.commonsTake: 'coins', 10/09/2026): CENTRAL ` +
            'HARVESTS READ 0 BY CONSTRUCTION (K4, reversing C5). harvestOptions never returns a ' +
            'central board under this knob, so the wheat board buys an own-building Harvest or ' +
            'nothing at all, and `commonsHarvestMin` and `commonsHarvestTake` have no subject. ' +
            'The centre is emptied only by the coin take, which is reported here instead.',
          `⚠️ THE PLAY RATE IS a17'S NUMBER AND ITS VERDICT IS a17'S: ` +
            `${pct(value)} of turns play a card, against Dean's band of 30%-60% ("earned, not ` +
            'automatic", 09/09/2026). It is repeated here because everything else on this page ' +
            'is read against it, and it deliberately carries no verdict here. ⛔ AND THE BAND IS ' +
            'READ ON TURNS THAT USED THE SLOT, not on this rate: a17 owns that number and this ' +
            'page must not be quoted for it.',
          `⛔ PLAYS AND CARDS ARE TWO NUMBERS UNDER THIS ARM. ${plays} plays put ${cards} cards ` +
            `into the centre, because ${wildPairPlays} of those plays were paid with a WILD ` +
            `PAIR (K3: two cards of any colours as one card of the board's colour, both landing ` +
            `on the pile). ${plays} + ${wildPairPlays} = ${cards}, exactly, or the fold is ` +
            'wrong. Every RATE on this page is per play; every IDENTITY is in cards, because ' +
            'the centre is counted in cards.' +
            (commonsWildPair(data)
              ? ''
              : ' (rules.economy.commonsWildPair is OFF in this run, so the two are equal here ' +
                'by construction.)'),
          `plays per game: ${num(games.length === 0 ? NaN : plays / games.length, 1)} across ` +
            `${games.length} ended games, ${num(seatGames === 0 ? NaN : plays / seatGames, 1)} ` +
            'per player per game.',
          `COIN TAKES: ${takes} in all, ` +
            `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} per player per game, clearing ` +
            `a mean of ${num(mean(sizes), 2)} and a median of ${num(median(sizes), 1)} cards ` +
            `(p90 ${num(percentile(sizes, 0.9), 1)}, ` +
            `max ${sizes.length === 0 ? 'n/a' : sizes.reduce((a, b) => (b > a ? b : a), 0)}). A ` +
            'pile leaves only by a coin take or by sitting stranded at game end - never by ' +
            'Harvest, and never to a hand.',
          `⭐ CARDS CLEARED PER COIN TAKE, the distribution: ${histogram}. It is also the ` +
            'distribution of COINS PAID PER TAKE, one for one (K3), so the tail is what decides ' +
            'whether the mint is a trickle or a windfall: a19 reads the same numbers as a ' +
            'currency.',
          `⭐⭐ THE CONSERVATION LINE, per game, RE-DERIVED FOR THE ARM: ` +
            `${num(games.length === 0 ? NaN : cards / games.length, 1)} cards played INTO the ` +
            `centre = ${num(games.length === 0 ? NaN : discardedByTakes / games.length, 1)} ` +
            `DISCARDED BY COIN TAKES + ` +
            `${num(games.length === 0 ? NaN : stranded / games.length, 1)} STRANDED at game end ` +
            `(${cards} = ${discardedByTakes} + ${stranded} over ${games.length} ended games; ` +
            `stranded is ${pct(cards === 0 ? NaN : stranded / cards)} of cards). ⛔ NOTHING ` +
            'REACHES A BARN OR A HAND FROM THE CENTRE UNDER THIS ARM, which is what makes the ' +
            'identity two-term rather than three: the centre is still a closed system, but its ' +
            'only exit now leads OUT OF THE GAME. The coins are the receipt: ' +
            `${coinsMinted} minted against ${discardedByTakes} cards discarded, one for one, ` +
            'and a disagreement between those two is a fold bug rather than a reading.',
          `⭐⭐ THE FARM BYPASS READS 0% BY CONSTRUCTION AND THAT IS NOT A ZERO TO READ. No ` +
            "harvest of a central pile is possible under commonsTake: 'coins' (K4) and no take " +
            'puts a card into a hand or a barn either, so `barnFromCommonsBySeat` is a ' +
            'STRUCTURAL zero and the ratio the shipped rule fails on has no subject at all. ' +
            `Every one of the ${fromOwn} harvested barn cards in this run came off a seat's OWN ` +
            'buildings. ⭐ THAT IS THE WHOLE POINT OF THE ARM: the shipped commons sent 63.0% of ' +
            'harvested barn cards through the middle and every rule ON the piles failed to move ' +
            'it, so this one stops the flow at the source and pays for the clearing in a ' +
            'currency instead. **THE QUESTION IT REPLACES THE OLD ONE WITH IS WHETHER THE PILES ' +
            'ARE STILL WORTH CLEARING**, which is the take rate above and the mint in a19, not ' +
            'a bypass share.',
          `⚠️ AND THE PRICE OF THAT IS PRINTED HERE RATHER THAN LEFT TO BE INFERRED: ` +
            `${discardedByTakes} cards a run (` +
            `${num(games.length === 0 ? NaN : discardedByTakes / games.length, 1)} a game, ` +
            `${num(seatGames === 0 ? NaN : discardedByTakes / seatGames, 1)} per player per ` +
            'game) LEAVE THE GAME through the coin take. Every earlier variant handed those ' +
            'cards back to somebody - to a hand, to a barn, to an action - and all three ran ' +
            'the bonus slot at 74% to 89% of turns because the cards taken paid for the next ' +
            'play. This is the arm that does not, so read the deck pressure beside the ' +
            'reshuffle count: a mint that eats the decks is a different failure from one that ' +
            'floods the wallets.',
          ...feeSuitLines,
          `⚠️ AND THE FEE-SUIT MIX ABOVE COUNTS **CARDS**, NOT PLAYS, under this arm: both ` +
            'halves of a wild pair are tested for the payer’s own crop and counted separately, ' +
            'so its rows and its denominator are both in cards and every share it prints is ' +
            `sound. ${cards} fee cards against ${plays} plays is the gap, and it is the wild ` +
            'pair.',
        ],
        verdict: 'OBSERVE',
      };
    }

    // ⭐ DEAN'S 'spend' VARIANT (09/09/2026, `rules.turn.commonsTake: 'spend'`):
    // Harvest never reaches the centre under this knob either (D-S4), so the
    // harvest-side readings below still have no subject - but unlike 'bonus'
    // the take's fate now depends on WHICH BOARD, so the replacement reading
    // is five-way rather than one free draw. Off `commonsSpent` (taken / used
    // / discarded per board) and `commonsSpendTakesByBoard` (how often each
    // board was chosen).
    if (isCommonsTakeToSpend(data)) {
      const takenByBoard = new Map<string, number>();
      const usedByBoard = new Map<string, number>();
      const discardedByBoard = new Map<string, number>();
      const takesByBoard = new Map<string, number>();
      for (const g of games) {
        for (const [board, n] of Object.entries(g.commonsSpendTakenByBoard)) {
          takenByBoard.set(board, (takenByBoard.get(board) ?? 0) + n);
        }
        for (const [board, n] of Object.entries(g.commonsSpendUsedByBoard)) {
          usedByBoard.set(board, (usedByBoard.get(board) ?? 0) + n);
        }
        for (const [board, n] of Object.entries(g.commonsSpendDiscardedByBoard)) {
          discardedByBoard.set(board, (discardedByBoard.get(board) ?? 0) + n);
        }
        for (const [board, n] of Object.entries(g.commonsSpendTakesByBoard)) {
          takesByBoard.set(board, (takesByBoard.get(board) ?? 0) + n);
        }
      }
      const takes = sum([...takesByBoard.values()]);
      const takenTotal = sum([...takenByBoard.values()]);
      const usedTotal = sum([...usedByBoard.values()]);
      const discardedTotal = sum([...discardedByBoard.values()]);
      const stranded = sum(games.map((g) => g.commonsStrandedAtEnd));
      const toHand = takenByBoard.get('orchard') ?? 0;
      const toBarn = usedByBoard.get('wheat') ?? 0;
      const spent = usedTotal - toHand - toBarn;
      const deliveriesFromCentre = sum(games.map((g) => g.commonsSpendDeliveriesFromCentre));
      const deliveriesTotal = sum(games.map((g) => sum(g.deliveriesBySeat)));
      const barnFromWheatSpend = sum(games.map((g) => sum(g.commonsSpendBarnBySeat)));
      const barnFromOwn = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
      const barnTotal = barnFromWheatSpend + barnFromOwn;
      const barnShare = barnTotal === 0 ? NaN : barnFromWheatSpend / barnTotal;
      const value = turns === 0 ? NaN : plays / turns;

      const takesLine = [...takesByBoard.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([board, n]) => `${board} ${num(seatGames === 0 ? NaN : n / seatGames, 2)}/player/game`,
        )
        .join('  ');
      const takenUsedDiscardedLine = ['orchard', 'wheat', 'dairy', 'vegetable', 'apiary']
        .map((board) => {
          const t = takenByBoard.get(board) ?? 0;
          const u = usedByBoard.get(board) ?? 0;
          const dcd = discardedByBoard.get(board) ?? 0;
          return `${board} taken ${t} used ${u} discarded ${dcd}`;
        })
        .join('   ');

      const barnShareBySeats = pooled.bySeats.map((slice) => {
        const wheatCentre = sum(slice.ended.map((g) => sum(g.commonsSpendBarnBySeat)));
        const own = sum(slice.ended.map((g) => sum(g.barnFromOwnBySeat)));
        const total = wheatCentre + own;
        return `${slice.seats}p ${pct(total === 0 ? NaN : wheatCentre / total)}`;
      });

      return {
        value,
        headline:
          `${num(value, 2)} plays per player per turn (${plays} plays over ${turns} turns); ` +
          `${num(seatGames === 0 ? NaN : takes / seatGames, 2)} central takes per player per ` +
          `game across all five boards; central harvests read 0 by construction under ` +
          `commonsTake: 'spend'`,
        detail: [
          `⭐ DEAN'S 'spend' VARIANT (rules.turn.commonsTake: 'spend', 09/09/2026): CENTRAL ` +
            "HARVESTS READ 0 BY CONSTRUCTION, exactly as under 'bonus' (D-S4) - the wheat " +
            "board's take goes straight to the taker's BARN instead, which is reported below.",
          `⚠️ THE PLAY RATE IS a17'S NUMBER AND ITS VERDICT IS a17'S: ` +
            `${pct(value)} of turns play a card, against Dean's band of 30%-60% ("earned, not ` +
            'automatic", 09/09/2026). It is repeated here because everything else on this page ' +
            'is read against it, and it deliberately carries no verdict here.',
          `plays per game: ${num(games.length === 0 ? NaN : plays / games.length, 1)} across ` +
            `${games.length} ended games, ${num(seatGames === 0 ? NaN : plays / seatGames, 1)} ` +
            'per player per game.',
          `⭐ TAKES PER PLAYER PER GAME, BY BOARD: ${takesLine || 'no takes'}. ${takes} takes in ` +
            `all over ${games.length} games. Orchard and wheat are the uncomplicated whole-pile ` +
            "legs; dairy, vegetable and apiary each spend the pile on that board's own action.",
          `⭐⭐ CARDS TAKEN / USED / DISCARDED, BY BOARD: ${takenUsedDiscardedLine}. Orchard and ` +
            'wheat always read used = taken, discarded 0 - nothing is left over from a plain ' +
            'draw or a plain barn move. ⭐ THE DISCARD IS THE FIRST SINK IN THE COMMONS LINE: ' +
            `${discardedTotal} of ${takenTotal} cards taken (${pct(takenTotal === 0 ? NaN : discardedTotal / takenTotal)}) ` +
            'never reached a hand, a barn or an action - a build payment or a crate the pile ' +
            'could not exactly fill, or a card with nowhere left to sow (D-S2). It is a genuine ' +
            "exit from the game (to a suit's discard pile), the first this design has had since " +
            'the two tolls left with the meeple economy, and it is worth watching beside the ' +
            'barn glut: a pile that discards heavily is feeding the discard rather than either ' +
            'store.',
          `⭐⭐ DELIVERIES STRAIGHT FROM THE CENTRE: ${deliveriesFromCentre} of ${deliveriesTotal} ` +
            `deliveries (${pct(deliveriesTotal === 0 ? NaN : deliveriesFromCentre / deliveriesTotal)}) ` +
            "paid their crate from the vegetable pile rather than the barn - Dean's own " +
            '"this is one to watch, this could be crazy" line about this leg specifically. A high ' +
            'share here is a delivery pipeline that skips the barn (and therefore the building ' +
            'layer) altogether.',
          `⭐⭐ THE CONSERVATION LINE, per game, RE-DERIVED FOR THE VARIANT: ` +
            `${num(games.length === 0 ? NaN : cards / games.length, 1)} cards played INTO the ` +
            `centre = ${num(games.length === 0 ? NaN : toHand / games.length, 1)} TO HAND (orchard) ` +
            `+ ${num(games.length === 0 ? NaN : toBarn / games.length, 1)} TO BARN (wheat) ` +
            `+ ${num(games.length === 0 ? NaN : spent / games.length, 1)} SPENT (dairy/vegetable/apiary) ` +
            `+ ${num(games.length === 0 ? NaN : discardedTotal / games.length, 1)} DISCARDED ` +
            `+ ${num(games.length === 0 ? NaN : stranded / games.length, 1)} STRANDED at game end ` +
            `(${cards} = ${toHand} + ${toBarn} + ${spent} + ${discardedTotal} + ${stranded} over ` +
            `${games.length} ended games). The shipped line reads plays = harvested out + ` +
            'stranded; this variant has no single "out", so the line splits into every fate a ' +
            'card can meet.',
          `⭐⭐ THE FARM BYPASS, MOVED TO THE WHEAT LEG: ${barnFromWheatSpend} barn cards came ` +
            `from a wheat TAKE against ${barnFromOwn} off a seat's OWN buildings ` +
            `(${pct(barnShare)} centre). BY SEAT COUNT: ${barnShareBySeats.join('   ')}. ` +
            "⭐ DEAN'S TARGET IS 30-40% FROM THE MIDDLE (09/09/2026), printed here as an OBSERVE " +
            'line and carrying NO verdict, exactly as under the shipped rule. **IF THE CENTRE ' +
            'OUT-SUPPLIES THE FARM, THE BUILDING ENGINE IS DECORATION.**',
          '⚠️ AND THE ORCHARD/DAIRY/APIARY LEGS ARE NOT IN THAT RATIO AT ALL: a hand card (orchard), ' +
            'a build (dairy) or a sow (apiary) reaches its own event stream - cardsToHand, built, ' +
            'cardPlaced - and is priced and counted there, exactly as a plain draw, build or sow ' +
            'would be. Only the wheat leg bypasses a building with no Harvest at all, which is ' +
            "why it alone is the farm-bypass reading's subject.",
          ...feeSuitLines,
        ],
        verdict: 'OBSERVE',
      };
    }

    const harvests = sum(games.map((g) => sum(g.commonsHarvestsBySeat)));
    const bought = sum(games.map((g) => sum(g.commonsHarvestsBoughtBySeat)));
    const fromCentre = sum(games.map((g) => sum(g.barnFromCommonsBySeat)));
    const fromOwn = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
    const intoBarn = fromCentre + fromOwn;
    const stranded = sum(games.map((g) => g.commonsStrandedAtEnd));

    const piles = games.flatMap((g) => g.commonsPileSizeAtHarvest);
    const value = turns === 0 ? NaN : plays / turns;
    const centreShare = intoBarn === 0 ? NaN : fromCentre / intoBarn;

    // Dean's histogram: how many cards a central harvest actually takes. The
    // 5+ bucket is open because the tail is the whole question a cap asks - a
    // cap of 2 can only ever reach what sits above 2.
    const buckets = [1, 2, 3, 4].map((n) => piles.filter((x) => x === n).length);
    const big = piles.filter((x) => x >= 5).length;
    const histogram = [...buckets.map((c, i) => [`${i + 1}`, c] as const), ['5+', big] as const]
      .map(
        ([label, count]) =>
          `${label}: ${count} ${pct(piles.length === 0 ? NaN : count / piles.length, 0)}`,
      )
      .join('   ');

    // The centre's share of harvested barn cards BY SEAT COUNT, beside the
    // pooled figure, because a share inside Dean's band at four seats and far
    // outside it at two is a different finding from one that misses everywhere.
    const shareBySeats = pooled.bySeats.map((slice) => {
      const centre = sum(slice.ended.map((g) => sum(g.barnFromCommonsBySeat)));
      const own = sum(slice.ended.map((g) => sum(g.barnFromOwnBySeat)));
      const total = centre + own;
      return `${slice.seats}p ${pct(total === 0 ? NaN : centre / total)}`;
    });

    return {
      value,
      headline:
        `${num(value, 2)} plays per player per turn (${plays} plays over ${turns} turns); ` +
        `${num(seatGames === 0 ? NaN : harvests / seatGames, 2)} central harvests per player ` +
        `per game; ${pct(centreShare)} of harvested barn cards came from the CENTRE`,
      detail: [
        `⚠️ THE PLAY RATE IS a17'S NUMBER AND ITS VERDICT IS a17'S: ` +
          `${pct(value)} of turns play a card, against Dean's band of 30%-60% ("earned, not ` +
          'automatic", 09/09/2026). It is repeated here because everything else on this page ' +
          'is read against it, and it deliberately carries no verdict here - two assertions ' +
          'failing on one number would report a single finding twice.',
        `plays per game: ${num(games.length === 0 ? NaN : plays / games.length, 1)} across ` +
          `${games.length} ended games, ${num(seatGames === 0 ? NaN : plays / seatGames, 1)} ` +
          'per player per game.',
        `CENTRAL HARVESTS: ${harvests} in all, ` +
          `${num(seatGames === 0 ? NaN : harvests / seatGames, 2)} per player per game, taking ` +
          `a mean of ${num(mean(piles), 2)} and a median of ${num(median(piles), 1)} cards ` +
          `(p90 ${num(percentile(piles, 0.9), 1)}, ` +
          `max ${piles.length === 0 ? 'n/a' : piles.reduce((a, b) => (b > a ? b : a), 0)}). A pile only ever leaves by ` +
          'harvest (D3), so this is the whole of the centre’s outflow.',
        `⭐ CARDS TAKEN PER CENTRAL HARVEST, the distribution (Dean, 09/09/2026): ${histogram}. ` +
          '⚠️ THIS IS WHY A CAP ON THE INFLOW DID NOTHING. rules.economy.commonsThreshold at 2 ' +
          'moved the centre share by 0.1 points (63.1% to 63.0%) because a central harvest was ' +
          'already taking a median of two cards, so the cap could only ever reach the tail above ' +
          'it. Read the 3 / 4 / 5+ buckets as the whole of what any cap has to work with.',
        `⭐⭐ THE CONSERVATION LINE, per game: ${num(games.length === 0 ? NaN : cards / games.length, 1)} ` +
          `cards played INTO the centre = ${num(games.length === 0 ? NaN : fromCentre / games.length, 1)} ` +
          `harvested OUT + ${num(games.length === 0 ? NaN : stranded / games.length, 1)} STRANDED ` +
          `at game end (${cards} = ${fromCentre} + ${stranded} over ${games.length} ended games; ` +
          `stranded is ${pct(cards === 0 ? NaN : stranded / cards)} of cards). The centre is a ` +
          'CLOSED system - in by a play (C3), out by a harvest (D3) - so the three columns must ' +
          'balance exactly and a disagreement is a fold bug, not a reading. ⭐ IT IS ALSO THE ' +
          'ANSWER TO WHY AN INFLOW CAP CANNOT MOVE THE SHARE: every card played into the centre ' +
          'reaches somebody’s barn unless the game ends first, so capping plays changes WHEN ' +
          'cards leave and not how many. rules.economy.commonsHarvestTake is the only one of the ' +
          'three knobs that leaves cards behind, and its cost shows up in the stranded column.',
        `THE ROUTE INTO THE CENTRE'S OUTFLOW: ${bought} of ${harvests} central harvests ` +
          `(${pct(harvests === 0 ? NaN : bought / harvests)}) were BOUGHT through the wheat ` +
          `board, ${harvests - bought} were the MAIN Harvest action. The bought half is D6 - the ` +
          'fee lands before the action runs, so a play onto the wheat board is always a legal ' +
          'Harvest of at least that card - and it is the half rules.economy.commonsHarvestMin ' +
          'would take away, since a pile below the minimum refuses a harvest whether or not the ' +
          'fee just landed on it. ⚠️ THE SPLIT IS ATTRIBUTED, NOT CARRIED ON THE EVENT: a ' +
          'bought Harvest resolves through a task in a later decision, so the fold latches the ' +
          'seat on the doorUsed that paid and spends the latch on that seat’s next harvest.',
        `⭐⭐ THE FARM BYPASS: ${fromCentre} barn cards came out of the CENTRE against ` +
          `${fromOwn} off a seat's OWN buildings (${pct(centreShare)} centre). ` +
          `BY SEAT COUNT: ${shareBySeats.join('   ')}. ` +
          "⭐ DEAN'S TARGET IS 30-40% FROM THE MIDDLE (09/09/2026), printed here as an OBSERVE " +
          'line and carrying NO verdict: it is an aim rather than a design threshold expressed ' +
          'as shape, and nothing on this page can fail. ' +
          '**IF THE CENTRE OUT-SUPPLIES THE FARM, THE BUILDING ENGINE IS DECORATION.** The ' +
          'design wants sow -> grow -> clog -> harvest -> deliver; a fat public pile is a barn ' +
          'faucet nobody had to grow anything to fill.',
        '⚠️ AND A HIGH CENTRE SHARE IS NOT AUTOMATICALLY A FAULT, which is half of why this ' +
          'assertion cannot fail. A fat pile is a pile several rivals PAID to fill, so ' +
          'harvesting it is the one place in this design where somebody else’s spending pays ' +
          'you - the host-side payment the meeple loop never found. The same number is the ' +
          'design working and the design hollowed out, and only a table can say which.',
        `⚠️ BOTH COLUMNS ARE A SUBSET OF THE BARN'S TOTAL INTAKE, never the whole of it: the ` +
          'deck, hand, stack and discard shortcuts fill a barn too and are counted in ' +
          'barnInByRoute. The share above is of HARVESTED cards, which is the comparison the ' +
          'question asks for.',
        ...feeSuitLines,
      ],
      verdict: 'OBSERVE',
    };
  },
};

/** The p-th percentile by nearest rank. Small samples are the norm here, so no interpolation. */
/**
 * ⭐ THE FARM TRAFFIC (S2, S5, S7, Dean 10/09/2026), and the four readings the
 * handoff asks for by name.
 *
 * ⛔ EVERY LINE IS OBSERVE. Nothing here can fail, for the reason the header
 * gives: the design names no number for any of it and one taken from the first
 * run of an arm nobody has played would be a snapshot test.
 *
 * ⚠️ A NOTE ON WHICH VISITS EACH LINE COUNTS, because the two are not the same
 * question and mixing them is the easy mistake. `visitsReceivedBySeat` counts
 * NEIGHBOUR visits only - the `visited` fold returns early on the self flag -
 * so it is the PAYMENT that crossed the table. Total placements on a board are
 * that plus the owner's own self-visits, and that is the traffic the board
 * carried. The received line reads the first; the spread reads the second,
 * because a board fattened by its own owner is still a board holding cards.
 */
function farmTraffic({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const seatGames = sum(games.map((g) => g.seats));

  if (games.length === 0 || seatGames === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }

  const all = sum(games.map((g) => sum(g.visitsBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const neighbours = all - selves;
  // ⭐ THE CENTRE, WHICH THIS PAGE HAD NO SUBJECT FOR UNTIL 11/09/2026. Dean's
  // unclaimed-boards variant puts the Notice Board of every unfarmed suit in
  // the middle, ownerless, so a bonus slot can buy a rival's board OR a central
  // pile and this page has to carry both halves of that choice.
  const withCentre = unclaimedBoardsToCentre(data);
  const centre = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
  const centreHarvests = sum(games.map((g) => sum(g.commonsHarvestsBySeat)));
  const centreStranded = sum(games.map((g) => g.commonsStrandedAtEnd));
  // ⭐ A16 THE BEEKEEPER'S VEIL, ASKED FOR BY NAME BY THE ENGINE PASS
  // (11/09/2026). It fires on a placement that brings a building's stack to 2.
  // A fee landing on a RIVAL'S Notice Board is such a placement; a fee landing
  // on a CENTRAL pile is not, because `fx.playOnCommons` deliberately does not
  // fire `afterPlacement` - a central board is in nobody's tableau and is not a
  // building. So ONE CARD IN THE CATALOGUE QUIETLY PAYS A BONUS FOR PREFERRING
  // THE CROSS-TABLE PLAY, which is a thumb on the scale of the exact question
  // this arm was ruled to answer, and it is worth knowing which way it leans
  // before anybody reads the split above as pure taste.
  const a16Rival = sum(games.map((g) => g.a16FiresRivalBoard));
  const a16Own = sum(games.map((g) => g.a16FiresOwnBoard));
  const a16Ordinary = sum(games.map((g) => g.a16FiresOrdinary));
  const a16Held = sum(games.map((g) => g.a16PlacementsWhileHeld));
  const a16All = a16Rival + a16Own + a16Ordinary;

  // READING 5, THE FARM BYPASS REDEFINED. `freight.bankedBySeat` is a fee that
  // a RIVAL paid onto this seat's board and that this seat later harvested into
  // their own barn, matched by card id at the harvest rather than credited when
  // it landed - because a gift that dies on a board nobody clears was never
  // received, which is the same rule a02 has always applied to it.
  // `barnInBySeat` is every card that entered a barn by any route at all
  // (harvest, deck, stack, hand, discard), so the ratio is honest as a share of
  // the whole barn rather than of one route.
  const banked = sum(games.map((g) => sum(g.freight.bankedBySeat)));
  const received = sum(games.map((g) => sum(g.freight.receivedBySeat)));
  const barnIn = sum(games.map((g) => sum(g.barnInBySeat)));
  const value = barnIn === 0 ? NaN : banked / barnIn;

  // ⭐ READING 5 HAS THREE SOURCES SINCE 11/09/2026 AND MUST BE SPLIT THREE
  // WAYS. A card reaches a barn by a harvest from one of three places now:
  //
  //   OWN FARM      one of your own ordinary buildings - the engine the design
  //                 is supposed to be about
  //   RIVAL'S FEE   your own Notice Board, which holds what rivals paid you -
  //                 `freight.bankedBySeat` is the cross-table part of it and
  //                 `barnFromOwnBoardBySeat` the whole stack, so the gap is
  //                 your own self-visit fees coming home (0 under the ban)
  //   THE CENTRE    a central pile you won, `barnFromCommonsBySeat`
  //
  // ⛔ `barnFromOwnBySeat` COUNTS THE FIRST TWO TOGETHER, because the engine
  // rightly calls a Notice Board harvest `source: 'tableau'` - it IS a building
  // in a tableau under this currency. Subtracting is the whole of the split.
  const fromOwnAll = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
  const fromOwnBoard = sum(games.map((g) => sum(g.barnFromOwnBoardBySeat)));
  const fromCentre = sum(games.map((g) => sum(g.barnFromCommonsBySeat)));
  const fromFarm = Math.max(0, fromOwnAll - fromOwnBoard);
  const harvested = fromFarm + fromOwnBoard + fromCentre;
  const shareOfHarvest = (n: number) => pct(harvested === 0 ? NaN : n / harvested);

  const bypassRows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const b = sum(slice.ended.map((g) => sum(g.freight.bankedBySeat)));
      const inn = sum(slice.ended.map((g) => sum(g.barnInBySeat)));
      const rec = sum(slice.ended.map((g) => sum(g.freight.receivedBySeat)));
      const seats = sum(slice.ended.map((g) => g.seats));
      const t = totalTurns(slice.ended);
      const ownAll = sum(slice.ended.map((g) => sum(g.barnFromOwnBySeat)));
      const ownBoard = sum(slice.ended.map((g) => sum(g.barnFromOwnBoardBySeat)));
      const fromCtr = sum(slice.ended.map((g) => sum(g.barnFromCommonsBySeat)));
      const farm = Math.max(0, ownAll - ownBoard);
      const h = farm + ownBoard + fromCtr;
      const v = sum(slice.ended.map((g) => sum(g.visitsBySeat)));
      const sv = sum(slice.ended.map((g) => sum(g.selfVisitsBySeat)));
      const c = sum(slice.ended.map((g) => sum(g.commonsPlaysBySeat)));
      return {
        seats: slice.seats,
        share: inn === 0 ? NaN : b / inn,
        perPlayer: seats === 0 ? NaN : rec / seats,
        received: rec,
        farmShare: h === 0 ? NaN : farm / h,
        feeShare: h === 0 ? NaN : ownBoard / h,
        centreShare: h === 0 ? NaN : fromCtr / h,
        rivalVisits: v - sv,
        centralPlays: c,
        rivalPerTurn: t === 0 ? NaN : (v - sv) / t,
        centralPerTurn: t === 0 ? NaN : c / t,
        crossTableShare: v + c === 0 ? NaN : (v - sv) / (v + c),
      };
    });

  // READING 4, THE SPREAD. Per GAME, each board's share of that game's own
  // placements, so games of different lengths and seat counts pool: the busiest
  // board's share and the quietest board's share, each against the even share
  // of 1 / seats. ⚠️ A RATIO OF THE TWO IS NOT PRINTED AS A PER-GAME MEAN,
  // because the quietest board is routinely zero and a mean over infinities
  // measures nothing. The two shares side by side say the same thing and can
  // always be read.
  //
  // ⭐ AND SINCE 11/09/2026 IT IS TAKEN ACROSS ALL FIVE BOARDS WHEREVER THEY
  // SIT, not across the owned ones alone. Under
  // `rules.economy.unclaimedBoardsToCentre` five boards are on the table in
  // every game at every seat count - the farmed suits' owned, the rest
  // ownerless in the middle - so the even share is 1/5 and not 1/seats, and a
  // spread taken over the owned boards only would have hidden the very thing
  // the variant is being tested for: a CENTRAL board leading the table.
  //
  // ⭐⭐ AND SINCE DEAN'S TWO-BOARD FIX (11/09/2026) IT IS SPLIT A SECOND WAY,
  // BY WHETHER A BOARD IS ITS OWNER'S OWN SUIT'S OR THE ONE THEY DREW. That is
  // OPEN RISK 1 OF THE ARM ARRIVING AS A NUMBER: at two seats every player lays
  // out a second board drawn AT RANDOM from the suits nobody is farming, its
  // power is usable only by their rivals, and WHICH ONE YOU GET IS LUCK. The
  // defence is that a popular board is INCOME - every fee paid onto it rests
  // there until its owner banks it - so drawing the board your opponent most
  // wants is drawing an income stream rather than a handicap. That is an
  // argument and this is the reading: if the random boards carry the traffic and
  // the own-suit boards sit empty, a table will read the draw as the thing that
  // decided the game.
  //
  // ⚠️ THE PER-BOARD COUNT IS TAKEN OFF THE COLOUR COUNTERS AND NOT OFF THE
  // PER-SEAT ONES, because `visitsReceivedBySeat` pools a host's boards and
  // cannot be unpooled. It is read that way ONLY in a game that dealt extras, so
  // every number this block has ever printed is byte-identical: with one board a
  // seat the two are the same arithmetic (a visit's colour IS the board's suit,
  // and one seat owns each suit), and the conditional is there so nobody has to
  // take that on trust.
  const busiest: number[] = [];
  const quietest: number[] = [];
  const evens: number[] = [];
  const busiestIsCentral: boolean[] = [];
  const busiestIsExtra: boolean[] = [];
  const ownShares: number[] = [];
  const extraShares: number[] = [];
  for (const g of games) {
    const placements = new Map<string, { n: number; central: boolean; extra: boolean }>();
    const byColour = (colour: string) =>
      (g.neighbourDoorByColour[colour] ?? 0) + (g.selfDoorByColour[colour] ?? 0);
    const dealtExtras = g.extraBoardsBySeat.some((b) => b.length > 0);
    for (let seat = 0; seat < g.seats; seat++) {
      const suit = g.suits[seat];
      if (suit === undefined) continue;
      placements.set(suit, {
        n: dealtExtras
          ? byColour(suit)
          : (g.visitsReceivedBySeat[seat] ?? 0) + (g.selfVisitsBySeat[seat] ?? 0),
        central: false,
        extra: false,
      });
      for (const extra of g.extraBoardsBySeat[seat] ?? []) {
        placements.set(extra, { n: byColour(extra), central: false, extra: true });
      }
    }
    if (withCentre) {
      for (const suit of g.neutral) {
        placements.set(suit, { n: g.commonsPlaysByBoard[suit] ?? 0, central: true, extra: false });
      }
    }
    const entries = [...placements.values()];
    const total = sum(entries.map((e) => e.n));
    if (total === 0 || entries.length === 0) continue;
    const top = entries.reduce((a, b) => (b.n > a.n ? b : a));
    busiest.push(top.n / total);
    quietest.push(Math.min(...entries.map((e) => e.n)) / total);
    evens.push(1 / entries.length);
    busiestIsCentral.push(top.central);
    if (!dealtExtras) continue;
    busiestIsExtra.push(top.extra);
    for (const e of entries) {
      if (e.central) continue;
      (e.extra ? extraShares : ownShares).push(e.n / total);
    }
  }
  const centralLed =
    busiestIsCentral.length === 0
      ? NaN
      : busiestIsCentral.filter(Boolean).length / busiestIsCentral.length;
  const extraLed =
    busiestIsExtra.length === 0
      ? NaN
      : busiestIsExtra.filter(Boolean).length / busiestIsExtra.length;
  // ⭐ READING 4d, NEW ON 11/09/2026, AND IT IS OPEN RISK 1 OF DEAN'S TWO-BOARD
  // FIX. OBSERVE, no fail condition, like everything else on this page: the
  // design names no number for it and one taken from the first run of an arm
  // nobody has played would be a snapshot test.
  const extraBoards = busiestIsExtra.length > 0;
  const extraBoardLine =
    `⭐ READING 4d, THE SAME SPREAD SPLIT BY WHICH KIND OF BOARD IT IS - OWN SUIT AGAINST THE ` +
    `ONE DRAWN AT RANDOM (Dean's two-board fix, 11/09/2026, and this is OPEN RISK 1 arriving ` +
    `as a number). Over ${busiestIsExtra.length} games that dealt an extra board: an OWN-SUIT ` +
    `board took ${pct(mean(ownShares))} of its game's placements on average over ` +
    `${ownShares.length} boards, a RANDOM board ${pct(mean(extraShares))} over ` +
    `${extraShares.length}, against an even share of ${pct(mean(evens))}; and THE BUSIEST ` +
    `BOARD ON THE TABLE WAS A RANDOM ONE IN ${pct(extraLed)} OF THEM. ⭐ WHY IT IS ASKED: the ` +
    'extra board is drawn AT RANDOM from the suits nobody is farming, its power is usable only ' +
    'by its owner’s RIVALS, and which one you get is LUCK. The defence is that A POPULAR BOARD ' +
    'IS INCOME - every fee paid onto it rests there until its owner banks it - so drawing the ' +
    'board your opponent most wants is drawing an income stream and not a handicap. ⚠️ THAT IS ' +
    'AN ARGUMENT AND THIS IS THE READING, AND THE TWO CAN DISAGREE: at two seats there is one ' +
    'opponent and NOWHERE FOR THE LUCK TO AVERAGE OUT, so a table may simply read the draw as ' +
    'the thing that decided the game. ⚠️ AND IT MEASURES CONCENTRATION AND NOT FAIRNESS: a ' +
    'random board far above the even share is a board whose owner was paid for a card they ' +
    'never chose, which is the design working and the design feeling arbitrary in the same ' +
    'number. ⛔ NO FAIL CONDITION. The control is ' +
    'overlays/notice-board-visit-no-self-v1.overlay.json on identical seeds, where every board ' +
    'is its owner’s own suit and this line has no subject.';

  // READING 4's other half: cards resting on all the boards, by game third,
  // pooled as the median of per-game medians for the reason
  // `noticeBoardCardsByRoundThird` gives - each game computes its own thirds in
  // `finish`, so a series aligned on round 1 would compare one game's endgame
  // with another's midgame.
  const thirds = [0, 1, 2].map((i) =>
    median(
      games.flatMap((g) => {
        const v = g.noticeBoardCardsByRoundThird[i];
        return v === undefined || !Number.isFinite(v) ? [] : [v];
      }),
    ),
  );
  const strandedAtEnd = sum(games.map((g) => sum(g.boardCardsAtEndBySeat)));
  // ⭐ THE SAME SERIES FOR THE CENTRE (11/09/2026), so the two stocks can be
  // read side by side: cards resting on OWNED boards waiting for a named owner
  // to bank them, against cards resting on CENTRAL piles waiting for anybody at
  // all. Same shape, and still not the same quantity.
  const centreThirds = [0, 1, 2].map((i) =>
    median(
      games.flatMap((g) => {
        const v = g.commonsPileSizeByRoundThird[i];
        return v === undefined || !Number.isFinite(v) ? [] : [v];
      }),
    ),
  );

  const detail = [
    withCentre
      ? `⛔ THE DECISIVE READING OF DEAN'S VARIANT, PRINTED FIRST BECAUSE THE RATE CAN LAND ` +
        `INSIDE THE BAND WHILE THE DESIGN HAS STOPPED BEING ABOUT NEIGHBOURS. CENTRAL PLAYS ` +
        `AGAINST RIVAL VISITS, BY SEAT COUNT: ${bypassRows
          .map(
            (r) =>
              `${r.seats}p central ${r.centralPlays} (${num(r.centralPerTurn, 2)}/turn) v ` +
              `rival ${r.rivalVisits} (${num(r.rivalPerTurn, 2)}/turn), cross-table share ` +
              `${pct(r.crossTableShare)}`,
          )
          .join('   ')}; pooled central ${centre} against rival ${neighbours}, cross-table ` +
        `${pct(all + centre === 0 ? NaN : neighbours / (all + centre))} of ${all + centre} ` +
        'plays. ⭐ A CENTRAL BOARD IS SOCIALLY FREE AND A RIVAL BOARD IS NOT: the card you pay ' +
        'onto a rival board is material that named rival harvests into their barn, which is ' +
        'the whole of what this design is for, and the card you pay onto a central pile is paid to nobody. ' +
        'So there is a standing incentive to prefer the centre at every seat count and it is ' +
        'STRONGEST AT TWO PLAYERS, where three of the four targets are central and the one ' +
        'rival board is the only place a gift can land. ⛔ IF CROSS-TABLE VISITS FALL RATHER ' +
        'THAN RISE, THE VARIANT HAS RECREATED THE VILLAGE GREEN WITH AN EXTRA STEP and the ' +
        'neighbour has been designed out for the second time in three days. ⚠️ EVERY SEAT ' +
        'FACES EXACTLY FOUR TARGETS AT EVERY PLAYER COUNT (2p 1 rival / 3 central, 3p 2 / 2, ' +
        '4p 3 / 1), so a falling central share as seats rise is availability and not taste; ' +
        'what is NOT availability is whether two players pay a person at all. The control is ' +
        'overlays/notice-board-visit-no-self-v1.overlay.json on identical seeds.'
      : `⭐ THIS PAGE IS ABOUT THE FARM AND NOT THE CENTRE (S2, 10/09/2026). There is no ` +
        'commons under this run: rules.economy.unclaimedBoardsToCentre is false, so all five ' +
        'Notice Boards are owned buildings and every centre line above has no subject. ⛔ NO ' +
        'NUMBER HERE IS COMPARABLE WITH A COMMONS ONE AS A LEVEL, including the farm bypass, ' +
        'which is a different ratio over a different denominator.',
    `READING 4a, VISITS RECEIVED PER PLAYER PER GAME: ` +
      `${num(seatGames === 0 ? NaN : received / seatGames, 2)} (${received} neighbour visits ` +
      `over ${seatGames} seat-games, ${num(games.length === 0 ? NaN : received / games.length, 1)} ` +
      `a game). By seat count: ${bypassRows
        .map((r) => `${r.seats}p ${num(r.perPlayer, 2)}`)
        .join('  ')}. ⭐ THIS IS THE PAYMENT SIDE OF THE HOOK and a08 carries the paying side; ` +
      'self-visits are deliberately not in it, because a card you pay onto your own board is ' +
      'not a payment to anybody. a17 owns the self share.',
    `READING 4b, THE SPREAD BETWEEN THE BUSIEST AND THE QUIETEST BOARD, ACROSS ALL FIVE ` +
      `WHEREVER THEY SIT, as each one's share of its own game's placements (self-visits ` +
      `included here, because a board fattened by its own owner is still a board holding ` +
      `cards): busiest ${pct(mean(busiest))}, quietest ${pct(mean(quietest))}, against an even ` +
      `share of ${pct(mean(evens))}, over ${busiest.length} games with at least one placement.` +
      (withCentre
        ? ` ⛔ AND THE BUSIEST BOARD WAS A CENTRAL ONE IN ${pct(centralLed)} OF THOSE GAMES. ` +
          'A central board has no owner to pay, so a central board leading the table is the ' +
          'headline risk arriving as a number rather than as an argument. ⚠️ Read it against ' +
          'availability before reading it as taste: at two players three of the five boards ' +
          'are central and at four players only one is, so some of this is arithmetic. a17 ' +
          'carries the same traffic cut by POWER and split owned against central.'
        : '') +
      ' ⚠️ CHECK AVAILABILITY ' +
      'AGAINST VALUE BEFORE CALLING A POWER MISPRICED: on 10/09/2026 the fires-by-suit spread ' +
      'turned out to be availability rather than power, and two rules ration a board before ' +
      'its power is ever priced - S10 does not offer a board whose power you cannot legally ' +
      'perform, and S9 allows one use per board per turn. ⚠️ AND IT MEASURES CONCENTRATION, ' +
      'NOT ROTATION: a busiest share near even could be the same seat every game or a ' +
      'different one each game, and these counters cannot tell the two apart. a17 carries the ' +
      'mix by the board POWER, which is the other way of cutting the same traffic.',
    ...(extraBoards ? [extraBoardLine] : []),
    `READING 4c, CARDS RESTING ON ALL THE BOARDS BY GAME THIRD, median: ` +
      `${thirds.map((t, i) => `${['first', 'middle', 'last'][i]} ${num(t, 1)}`).join('  ')}. ` +
      'A series that climbs and never falls is boards nobody bothers to clear, which is ' +
      "a20-board-stall's question arriving from the other side; one that sits near zero is a " +
      'payment collected the moment it lands, which makes the host-side reward instant and the ' +
      'gestation the design wants shorter than it looks. ⚠️ IT IS A STOCK AND NOT A FLOW: the ' +
      'same figure is a fat board and a slow one.' +
      (withCentre
        ? ` ⭐ AND THE CENTRE'S OWN SERIES BESIDE IT, median cards standing on all the CENTRAL ` +
          `piles: ${centreThirds
            .map((t, i) => `${['first', 'middle', 'last'][i]} ${num(t, 1)}`)
            .join('  ')}, with ${centreStranded} cards still in the middle when the games ` +
          `ended and ${centreHarvests} central harvests taken. ⛔ THE TWO STOCKS ARE NOT THE ` +
          'SAME QUANTITY AND MUST NOT BE POOLED: a card resting on an OWNED board has a named ' +
          'owner waiting to bank it, and a card resting on a CENTRAL pile is a standing offer ' +
          'anybody may take at three or more. a20 reads the two waits apart for the same ' +
          'reason.'
        : ''),
    `⛔ READING 5, THE FARM BYPASS, AND IT HAS THREE SOURCES SINCE 11/09/2026 RATHER THAN ONE. ` +
      `Of the ${harvested} cards a HARVEST put in a barn: YOUR OWN FARM ` +
      `${shareOfHarvest(fromFarm)} (${fromFarm}), A RIVAL'S FEE OFF YOUR OWN NOTICE BOARD ` +
      `${shareOfHarvest(fromOwnBoard)} (${fromOwnBoard}), A CENTRAL PILE YOU WON ` +
      `${shareOfHarvest(fromCentre)} (${fromCentre}). By seat count, farm / fee / centre: ` +
      `${bypassRows
        .map((r) => `${r.seats}p ${pct(r.farmShare)} / ${pct(r.feeShare)} / ${pct(r.centreShare)}`)
        .join('   ')}. ⛔ THIS IS NOT COMPARABLE TO THE VILLAGE GREEN'S 63.0% AND NOT ` +
      "COMPARABLE TO YESTERDAY'S 27.7% EITHER, AND BOTH ARE DIFFERENT RATIOS RATHER THAN THE " +
      'SAME RATIO MOVED. The commons 63.0% was centre-against-own-buildings, over two sources, ' +
      'on a table where nobody owned a board. Yesterday 27.7% was somebody-else’s-fee over ' +
      'EVERY route into a barn, deck and hand and stack included, over one source. This is a ' +
      'three-way split of the HARVEST routes alone. ⚠️ Quote it with all three columns or not ' +
      'at all: a single percentage off this line is the exact shape of mistake that has to be ' +
      'un-made afterwards.',
    `⚠️ AND THE FEE COLUMN ABOVE IS THE WHOLE OF YOUR OWN BOARD'S STACK, NOT ONLY THE ` +
      `CROSS-TABLE PART OF IT. ${banked} of those ${fromOwnBoard} cards were fees a RIVAL paid ` +
      `(${pct(fromOwnBoard === 0 ? NaN : banked / fromOwnBoard)}); the rest are the owner's ` +
      'own self-visit cards coming home, which is 0 by construction wherever ' +
      'rules.turn.selfVisitAllowed is false and is not under ' +
      'overlays/notice-board-visit-unclaimed-self-v1.overlay.json. ⭐ THE CROSS-TABLE HALF ON ' +
      `ITS OWN, over EVERY route into a barn, which is the 10/09/2026 definition kept alive so ` +
      `the two arms can still be paired: ${pct(value)} of ${barnIn} (${banked}). By seat ` +
      `count: ${bypassRows.map((r) => `${r.seats}p ${pct(r.share)}`).join('  ')}. ⚠️ IT IS ` +
      'THE HOST’S WHOLE PAYMENT (S7), so a low number is not automatically good: it says the ' +
      'giver is being paid little, which is the fault the Lopiano lens names in all seven ' +
      'previous versions of this bonus action.',
    `⚠️ AND THE PAYMENT IS COUNTED WHEN IT IS BANKED, NEVER WHEN IT LANDS. ${received} fees ` +
      `were paid onto rivals' boards and ${banked} of them reached the host's barn ` +
      `(${pct(received === 0 ? NaN : banked / received)}); ${strandedAtEnd} cards were still ` +
      'sitting on boards when the games ended, which includes fees nobody ever collected and ' +
      "the owner's own self-visit cards alike. A gift that dies on a board nobody clears was " +
      'never received, which is the rule a02 has always applied to freight and the reason the ' +
      'two numbers are printed apart. a20-board-stall reads the same fact from the owner’s ' +
      'side: how long a board sits harvestable and uncleared.',
    `for scale, the whole table: ${all} visits over ${turns} turns, of which ${neighbours} ` +
      `crossed the table and ${selves} did not. a17 carries the rate and the band, a08 the ` +
      'neighbour rate and its floor of 0.5, and a20 the stall.',
    `⭐ A16 THE BEEKEEPER'S VEIL, AND IT IS A THUMB ON THE SCALE OF THE READING ABOVE ` +
      `(11/09/2026, asked for by name). ${a16All} fires in all: ${a16Rival} caused by a card ` +
      `landing on a RIVAL'S Notice Board, ${a16Own} by a card landing on the placer's OWN ` +
      `board, ${a16Ordinary} by an ordinary placement (a GROW payment, a sow, a build rider). ` +
      `⛔ AND CENTRAL PLAYS CAUSED 0 OF THEM, WHICH IS STRUCTURAL AND NOT A SAMPLE: ${centre} ` +
      'central plays were made and not one could fire this card, because fx.playOnCommons does ' +
      'not fire afterPlacement at all - a central board is in the tableau of nobody at all and is not a ' +
      'building. ⚠️ SO THE CATALOGUE ITSELF PAYS A SMALL BONUS FOR PREFERRING THE CROSS-TABLE ' +
      'PLAY, and the split above is therefore not a pure preference reading. The size of the ' +
      `thumb is ${pct(all + centre === 0 ? NaN : a16Rival / (all + centre))} of every play the ` +
      `slot bought. ⚠️ AVAILABILITY FIRST, AS EVER: ${a16Held} placements were made by a seat ` +
      `that actually held A16 (${pct(a16Held === 0 ? NaN : a16All / a16Held)} of them landed ` +
      'at stack position 2), so a small count can be a card nobody built rather than a card ' +
      'that never fires. ⛔ OBSERVE, no fail condition, and NO ENGINE CHANGE WAS MADE FOR IT: ' +
      'there is no abilityFired event, so a fire is reconstructed off cardPlaced and the ' +
      'post-state stack index. It is a FLOOR - a placement whose stack lost a card beneath it ' +
      'inside the same decision is missed - and it can never invent a fire.',
    '⚠️ THE BOTS ARE NOT PRICED FOR THE ONE DECISION THIS DESIGN ADDS. Nothing in the pricer ' +
      'knows that a card played onto a rival’s board is a card that rival will harvest, which ' +
      'is ledger C64 arriving for the fourth design running: no bot has ever declined to pay ' +
      'the leader. Whether the bots’ host term was measured in this pass is the bots’ ' +
      'question and not this file’s, but until it exists every reading above is the RULES ' +
      'speaking rather than a taste.',
    '⛔ NO FAIL CONDITION IN THIS PASS. Every line is OBSERVE, because the design names no ' +
      'number for any of them and one taken from this run would be a snapshot test. ' +
      'reference-v15 has no noise floor either, so a delta in any of these is not yet formally ' +
      'readable.',
  ];

  return {
    value,
    headline: withCentre
      ? `⛔ CENTRAL ${centre} PLAYS AGAINST ${neighbours} RIVAL VISITS, cross-table ` +
        `${pct(all + centre === 0 ? NaN : neighbours / (all + centre))} of ${all + centre} ` +
        `plays (by seat count ${bypassRows
          .map((r) => `${r.seats}p ${pct(r.crossTableShare)}`)
          .join('  ')}); visits RECEIVED per player per game ` +
        `${num(seatGames === 0 ? NaN : received / seatGames, 2)} (${bypassRows
          .map((r) => `${r.seats}p ${num(r.perPlayer, 2)}`)
          .join('  ')}); the barn three ways, farm / fee / centre ` +
        `${shareOfHarvest(fromFarm)} / ${shareOfHarvest(fromOwnBoard)} / ` +
        `${shareOfHarvest(fromCentre)}`
      : `THE FARM, NOT THE CENTRE (S2, 10/09/2026): ${pct(value)} of barn cards arrived as ` +
        `somebody else's fee (${banked} of ${barnIn}); visits received per player per game ` +
        `${num(seatGames === 0 ? NaN : received / seatGames, 2)}; busiest board ` +
        `${pct(mean(busiest))} of its game's placements against an even ${pct(mean(evens))}; ` +
        `cards resting on boards by third ${thirds.map((t) => num(t, 1)).join(' / ')}`,
    detail,
    verdict: 'OBSERVE',
  };
}

function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] as number;
}

/**
 * No subject under the two controls, and the same pattern a08 uses in the other
 * direction: the counters exist, they are structural zeroes, and printing them
 * as zeroes would read as findings about a thing that is not in the game.
 */
function noSubject(): Measurement {
  return {
    value: NaN,
    headline:
      'NO SUBJECT: there is no commons under visitCurrency "card" or "meeple". The five Notice ' +
      'Boards belong to players in both controls, and a08-the-hook carries the interaction ' +
      'readings there.',
    verdict: 'OBSERVE',
  };
}
