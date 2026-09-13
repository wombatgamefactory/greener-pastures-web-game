import { isNoticeBoardPower } from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalTurns } from './lib.js';
import { REFERENCE } from '../reference.js';
import { mean, median, num, pct, sum } from '../stats.js';

/**
 * The farm traffic under the notice-board visit (S2, S5, S7, 10/09/2026). The
 * file name and the id are kept from the commons, which is deleted; a08 carries
 * the RATE and its floor, and this file carries the SHAPE of the traffic, which
 * a rate cannot show. Four readings, the handoff's own numbers 4 and 5:
 *
 *   - **VISITS RECEIVED PER PLAYER.** Being visited is the payment at the host,
 *     and only this side says whether it arrives evenly or lands on one farm.
 *   - **THE SPREAD BETWEEN THE BUSIEST AND THE QUIETEST BOARD.** ⚠️ Check
 *     availability against value before calling a power mispriced: S10 and S9
 *     both ration a board before its power is ever priced.
 *   - **CARDS RESTING ON BOARDS BY GAME THIRD.** A series that climbs and never
 *     falls is boards nobody clears, which is a20's question from the other side.
 *   - **THE FARM BYPASS.** Barn cards that arrived as SOMEBODY ELSE'S FEE,
 *     counted when banked rather than when they land, because a gift that dies on
 *     a board nobody clears was never received.
 *
 * ⛔ **NO FAIL CONDITION.** The design names no number for any of them, and one
 * taken from the first run of an arm nobody has played would be a snapshot test.
 * a17 owns the one number Dean did set.
 *
 * ## No subject under the controls
 *
 * Under `visitCurrency: 'card'` and `'meeple'` the assertion says so rather than
 * printing zeroes that read as findings.
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
    return noSubject();
  },
};

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
function farmTraffic({ pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const turns = totalTurns(games);
  const seatGames = sum(games.map((g) => g.seats));

  if (games.length === 0 || seatGames === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }

  const all = sum(games.map((g) => sum(g.visitsBySeat)));
  const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
  const neighbours = all - selves;
  // A16 The Beekeeper's Veil fires on a placement that brings a building's
  // stack to 2, so a fee landing on a RIVAL'S Notice Board can fire it.
  // ⚠️ The printed line still names central plays: the commons is deleted, so
  // that count is the literal 0 it always was under every surviving mode.
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

  // READING 5, SPLIT BY SOURCE. A card reaches a barn by a harvest either off
  // one of your own ordinary buildings (OWN FARM) or off your own Notice Board,
  // which holds what rivals paid you (RIVAL'S FEE): `freight.bankedBySeat` is
  // the cross-table part of it and `barnFromOwnBoardBySeat` the whole stack, so
  // the gap is your own self-visit fees coming home (0 under the ban).
  // ⛔ `barnFromOwnBySeat` COUNTS THE TWO TOGETHER, because the engine rightly
  // calls a Notice Board harvest `source: 'tableau'`. Subtracting is the split.
  // The printed line keeps a third "central pile" column, which is the literal
  // 0 it always was under every surviving mode now the commons is deleted.
  const fromOwnAll = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
  const fromOwnBoard = sum(games.map((g) => sum(g.barnFromOwnBoardBySeat)));
  const fromFarm = Math.max(0, fromOwnAll - fromOwnBoard);
  const harvested = fromFarm + fromOwnBoard;
  const shareOfHarvest = (n: number) => pct(harvested === 0 ? NaN : n / harvested);

  const bypassRows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const b = sum(slice.ended.map((g) => sum(g.freight.bankedBySeat)));
      const inn = sum(slice.ended.map((g) => sum(g.barnInBySeat)));
      const rec = sum(slice.ended.map((g) => sum(g.freight.receivedBySeat)));
      const seats = sum(slice.ended.map((g) => g.seats));
      const ownAll = sum(slice.ended.map((g) => sum(g.barnFromOwnBySeat)));
      const ownBoard = sum(slice.ended.map((g) => sum(g.barnFromOwnBoardBySeat)));
      const farm = Math.max(0, ownAll - ownBoard);
      const h = farm + ownBoard;
      return {
        seats: slice.seats,
        share: inn === 0 ? NaN : b / inn,
        perPlayer: seats === 0 ? NaN : rec / seats,
        received: rec,
        farmShare: h === 0 ? NaN : farm / h,
        feeShare: h === 0 ? NaN : ownBoard / h,
        centreShare: h === 0 ? NaN : 0,
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
  const busiestIsExtra: boolean[] = [];
  const ownShares: number[] = [];
  const extraShares: number[] = [];
  for (const g of games) {
    const placements = new Map<string, { n: number; extra: boolean }>();
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
        extra: false,
      });
      for (const extra of g.extraBoardsBySeat[seat] ?? []) {
        placements.set(extra, { n: byColour(extra), extra: true });
      }
    }
    const entries = [...placements.values()];
    const total = sum(entries.map((e) => e.n));
    if (total === 0 || entries.length === 0) continue;
    const top = entries.reduce((a, b) => (b.n > a.n ? b : a));
    busiest.push(top.n / total);
    quietest.push(Math.min(...entries.map((e) => e.n)) / total);
    evens.push(1 / entries.length);
    if (!dealtExtras) continue;
    busiestIsExtra.push(top.extra);
    for (const e of entries) {
      (e.extra ? extraShares : ownShares).push(e.n / total);
    }
  }
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

  const detail = [
    `⭐ THIS PAGE IS ABOUT THE FARM AND NOT THE CENTRE (S2, 10/09/2026). There is no ` +
      'commons: it was deleted on 13/09/2026, so every Notice Board is an owned building and ' +
      'every centre line on this page has no subject. ⛔ NO ' +
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
      'same figure is a fat board and a slow one.',
    `⛔ READING 5, THE FARM BYPASS, AND IT HAS THREE SOURCES SINCE 11/09/2026 RATHER THAN ONE. ` +
      `Of the ${harvested} cards a HARVEST put in a barn: YOUR OWN FARM ` +
      `${shareOfHarvest(fromFarm)} (${fromFarm}), A RIVAL'S FEE OFF YOUR OWN NOTICE BOARD ` +
      `${shareOfHarvest(fromOwnBoard)} (${fromOwnBoard}), A CENTRAL PILE YOU WON ` +
      `${shareOfHarvest(0)} (0). By seat count, farm / fee / centre: ` +
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
      `⛔ AND CENTRAL PLAYS CAUSED 0 OF THEM, WHICH IS STRUCTURAL AND NOT A SAMPLE: 0 ` +
      'central plays were made and not one could fire this card, because fx.playOnCommons does ' +
      'not fire afterPlacement at all - a central board is in the tableau of nobody at all and is not a ' +
      'building. ⚠️ SO THE CATALOGUE ITSELF PAYS A SMALL BONUS FOR PREFERRING THE CROSS-TABLE ' +
      'PLAY, and the split above is therefore not a pure preference reading. The size of the ' +
      `thumb is ${pct(all === 0 ? NaN : a16Rival / all)} of every play the ` +
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
      `THE ${REFERENCE.id} NOISE FLOOR COVERS ONE LINE HERE, the fee column of reading 5 ` +
      '("farm bypass share"); every other line has no floor, so a delta in it is not yet ' +
      'formally readable.',
  ];

  return {
    value,
    headline:
      `THE FARM, NOT THE CENTRE (S2, 10/09/2026): ${pct(value)} of barn cards arrived as ` +
      `somebody else's fee (${banked} of ${barnIn}); visits received per player per game ` +
      `${num(seatGames === 0 ? NaN : received / seatGames, 2)}; busiest board ` +
      `${pct(mean(busiest))} of its game's placements against an even ${pct(mean(evens))}; ` +
      `cards resting on boards by third ${thirds.map((t) => num(t, 1)).join(' / ')}`,
    detail,
    verdict: 'OBSERVE',
  };
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
