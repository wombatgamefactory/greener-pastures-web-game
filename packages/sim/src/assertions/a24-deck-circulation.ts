import type { GameData } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { NOISE_FLOOR, REFERENCE } from '../reference.js';
import { mean, median, num, sum } from '../stats.js';

/**
 * How big a crop's central deck is, read off the data rather than written as a
 * constant: `whole` is one suit's deck cards (the engine's own filter in
 * `setup.ts`), `hand` and `barn` are what setup deals a farming seat out of its
 * own suit's deck, and `played` is what that crop's central deck holds after the
 * deal. ⛔ THE PROSE SAID "12 CARDS (setup takes 6 of its 18 into a hand and a
 * barn)" FROM THE OLD 5-PLUS-1 SETUP UNTIL 13/09/2026; v31 deals 4 to the hand
 * and 0 to the barn, so a played deck holds 14. A neutral crop's deck is `whole`.
 */
export function deckSizes(data: GameData): {
  whole: number;
  hand: number;
  barn: number;
  played: number;
} {
  const suit = data.cards.suits[0];
  const whole = data.cards.catalogue.filter((c) => c.suit === suit && c.inDeck && c.enabled).length;
  const { startingHand: hand, startingBarnCards: barn } = data.rules.setup;
  return { whole, hand, barn, played: whole - hand - barn };
}

/**
 * NEW ON 12/09/2026 FOR DEAN'S CIRCULATION ARGUMENT (ledger row A150), and
 * ⭐ IT IS THE CLEANEST FALSIFIABLE PREDICTION IN THE WHOLE VILLAGE STORE PASS.
 *
 * ## ⭐ THE ARGUMENT, WHICH IS DEAN'S OWN AND IS THE BEST CASE FOR THE STORE
 *
 * Section 1 of `docs/village-store-coins-2026-09-12-v2.md`, in his words:
 * **cards locked in barns are cards out of the pool.** Played decks reshuffle
 * **7 / 6 / 4 times a game** at 2p / 3p / 4p off a twelve-card deck, so the
 * played half of the pool is being **CYCLED rather than sampled**, and about
 * **11 dead cards a player** is a large slice of what is missing. A card
 * converted at the Village Store goes to its suit's DISCARD and returns on the
 * next reshuffle, **so the exchange is the only thing proposed that puts
 * stranded cards back into circulation. It is a lubrication rule as much as a
 * sink.**
 *
 * ## ⛔⛔ THE DIRECTION, AND IT IS DOWN. THE ARITHMETIC IS PRINTED SO NOBODY
 * READS IT BACKWARDS
 *
 * **IF THE STORE WORKS, RESHUFFLES PER PLAYED DECK FALL. THEY DO NOT RISE.**
 * Section 7 of `docs/village-store-coins-handoff-2026-09-12-v1.md` says "if the
 * Store works, this should fall" in as many words, and the arithmetic behind it
 * is this:
 *
 *     reshuffles  is roughly  draws / pool
 *
 * Total draws over a game are roughly fixed by the game's length. A reshuffle
 * happens when a deck runs dry, so how OFTEN one happens is those draws against
 * the size of the circulating pool. **Cards stranded in a barn are cards OUT of
 * that pool**, so a stranded-heavy game runs a SMALLER pool and exhausts it MORE
 * often. The Store returns those cards to the discard, which makes the pool
 * BIGGER, which means FEWER reshuffles for the same drawing. **So 7 / 6 / 4 is
 * the number to beat DOWNWARD, and a reshuffle is not itself circulation: it is
 * the same cards being re-dealt.**
 *
 * ⚠️ **AND A BARE "LOWER IS BETTER" IS EXACTLY THE LINE A LATER READER INVERTS**,
 * which is why the ratio above is printed on the page and not only in this
 * comment.
 *
 * ## ⚠️ THE READING IS NOT WELL POSED ON THE RESHUFFLE COUNT ALONE
 *
 * If the Store both returns cards AND shortens the game, **reshuffles fall for
 * two entirely different reasons** and the headline cannot tell them apart. Both
 * terms of the ratio are therefore printed beside it:
 *
 * - **CARDS TAKEN OFF PLAYED DECKS**, the numerator. If this falls with the
 *   reshuffles, the game got SHORTER and the pool may not have moved at all.
 * - **THE MEAN POOL AT A RESHUFFLE**, the denominator, read off the `reshuffled`
 *   event's own `count`, which the engine sets to the deck's length the instant
 *   after the discard went in. **That is the circulating pool measured at the one
 *   moment it is exactly knowable**, and it is the term Dean's argument is
 *   actually about. If this RISES while the draws hold, the pool got bigger and
 *   the circulation argument is confirmed.
 *
 * ⭐ **Only "reshuffles fall AND draws hold AND the pool rises" is Dean's
 * argument coming true.** "Reshuffles fall and draws fall" is a shorter game
 * wearing the same number.
 *
 * ## ⛔ THE MECHANISM, PRINTED BESIDE THE SYMPTOM: THE BARN THAT NEVER EMPTIES
 *
 * The design's figure is about **11 cards per player per game** entering a barn
 * and never leaving it, off the measurement that **88.8% of the time a player
 * holds barn cards they cannot afford any open tile, and 84% of those are one or
 * two cards short.** That is the parity trap: a crate is two cards of one named
 * crop, all or nothing, so a single odd card of a crop is worth exactly zero and
 * can never combine. **The barn line is the cause and the reshuffle line is the
 * effect**, and a pass that moved one without the other has not done what it
 * claims.
 *
 * ⚠️ The barn figure here is the barn each seat still held at the stop, which is
 * an UPPER BOUND on stranding rather than the trap itself: a card sitting there
 * at the end may have been deliverable and simply not delivered before the
 * trigger fired.
 *
 * ⛔⛔ **AND IT IS NOT THE DESIGN'S 11, WHICH IS UNSOURCED.** The document gives
 * no report, no instrument and no counter for that figure, and the barn measured
 * at the stop reads FAR BELOW it, in agreement with the report's own "barn at
 * game end" median of 2 to 3 under the same control. **The two are different
 * operationalisations and must never be quoted as one.** Until somebody
 * re-derives the 11 and names what it counted - a mid-game snapshot, an
 * undeliverable PARITY residue rather than a barn total, or an older instrument
 * - the design's figure is unsourced and this one is the measured one.
 * ⚠️ **That bears directly on the Store's case**: the sink is aimed at the 11,
 * and if the real standing residue is a fifth of it then the circulation
 * argument is aimed at a smaller fault than the document claims.
 *
 * ## ⛔ WHERE THE 7 / 6 / 4 BASELINE CAME FROM, AND WHETHER IT IS COMPARABLE
 *
 * `reports/watchlist-2026-09-11T21-45-42-reference-v15-notice-board-visit-host-draw-by-seats-v1.txt`,
 * n=1580 per seat count (4,820 games) on **`reference-v15`**, under the
 * seat-shaped host-draw arm (A148) - **which is the named control of the
 * delivery-meeple and Village Store overlays.** So it is comparable as a level
 * in a way most levels in this project are not: same instrument, same control
 * arm. ⚠️ **It is still a LEVEL, and the reading that decides anything is a
 * PAIRED DELTA ON IDENTICAL SEEDS against that control.**
 *
 * ⛔ **IT IS NOT THE SHIPPED GAME'S FIGURE AND MUST NOT BE QUOTED AS ONE.** C100
 * is open, no Notice Board configuration is ruled in, and the shipped commons
 * default reads its own number. ⛔ **And it is not the same number as the first
 * record of this metric**, 09/08/2026 on `reference-v9` at n=1580, played
 * 6 / 5 / 5: five re-cuts sit between them and no `reference-v14` or earlier
 * level is comparable.
 *
 * ## ⚠️ THE NOISE FLOOR, WHICH IS HALF PRESENT AND THAT IS WORTH STATING EXACTLY
 *
 * "reshuffles, played crop" IS in `HEADLINE_METRICS`, so unlike most lines in
 * this pass it HAS a floor: `reports/noise-2026-09-11T18-18-25-reference-v15.txt`
 * read a movement of **0.00** on it, which the noise report itself defines as
 * BELOW THE METRIC'S RESOLUTION rather than noiseless - it is a median over
 * integers, so both arms land on the same whole number. **Read it as one unit.**
 * ⛔ **That floor was taken on the SHIPPED COMMONS and covers the POOLED median
 * only.** There is no floor for the per-seat rows, for the mean pool at a
 * reshuffle, for the draws per deck or for the barn at game end.
 *
 * ## ⛔ NO FAIL CONDITION, AND THE 7 / 6 / 4 IS A PREDICTION AND NOT A THRESHOLD
 *
 * The design names no number a reshuffle count must reach. It names a DIRECTION
 * and a mechanism, which is a prediction to be scored. A threshold taken off the
 * run that first measures a quantity is a snapshot test that can never fail
 * (ticket 11 section 2), and this project has been bitten by exactly that shape
 * twice: the cap-of-two lesson of 05/09/2026 and its repeat as
 * `commonsThreshold: 2` on 09/09/2026.
 *
 * ⭐ **THIS PAGE HAS NO MODE GATE**, which it shares only with a22: every
 * currency this codebase has shuffles decks and fills barns, so it never reports
 * NO SUBJECT and it outlives every rule in this pass.
 */
export const deckCirculation: Assertion = {
  id: 24,
  title: 'Deck circulation: reshuffles per played deck, and the barn that never empties (A150)',
  quote:
    'Cards locked in barns are cards out of the pool. Played decks reshuffle 7 / 6 / 4 times a ' +
    'game by seat count off a 12-card deck, so the played half of the pool is being CYCLED ' +
    'rather than sampled, and about 11 dead cards a player is a large slice of what is ' +
    'missing. A card converted at the Store goes to the discard and returns on the next ' +
    'reshuffle, so the exchange is the only thing proposed that puts stranded cards back into ' +
    'circulation. It is a lubrication rule as much as a sink. [and] if the Store works, this ' +
    'should fall.',
  source:
    'docs/village-store-coins-2026-09-12-v2.md section 1 and section 9 item 4, and ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md section 7 (Dean, 12/09/2026), carried ' +
    'as ledger row A150. The C1 metric itself has been tracked since 09/08/2026.',
  shape:
    'Reshuffles per PLAYED deck (a deck a seat is farming) by seat count, against the 7 / 6 / ' +
    '4 baseline, ⛔ with BOTH TERMS OF THE RATIO beside it because a reshuffle count alone ' +
    'cannot say which moved: cards taken off played decks (the draws) and the mean pool at a ' +
    'reshuffle (the circulating cards). Plus the mechanism rather than the symptom - the barn ' +
    'each player still held at game end, against the design’s figure of about 11.',
  threshold:
    'OBSERVE, NO FAIL CONDITION. ⛔ THE DIRECTION IS DOWN: reshuffles are roughly draws over ' +
    'pool, barn-locked cards are cards OUT of the pool, so a stranded-heavy game runs a ' +
    'SMALLER pool and exhausts it MORE often - and a Store that returns those cards makes the ' +
    'pool BIGGER and the reshuffles FEWER. 7 / 6 / 4 is the number to beat DOWNWARD and it is ' +
    'a PREDICTION being scored, never a threshold to fail against.',
  taste: false,
  remedy:
    `${NO_REMEDY}. ⭐ THIS IS A HYPOTHESIS TEST AND NOT A DIAL: it is the one number that can ` +
    'tell Dean whether his own best argument for the Village Store was right. Run ' +
    'overlays/village-store-coins-v1.overlay.json against its control ' +
    `overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json on identical ${REFERENCE.id} ` +
    'seeds and read the DELTA on all four lines together. ⛔ RESHUFFLES FALLING IS NOT ON ITS ' +
    'OWN THE FINDING: if the draws fell with them the game merely got shorter. Only ' +
    'reshuffles down AND draws roughly held AND the pool at a reshuffle up is the circulation ' +
    'argument coming true.',
  measure(ctx) {
    return circulation(ctx);
  },
};

interface DeckRows {
  /** One entry per played deck per game, in the same shape metrics.ts uses. */
  reshuffles: number[];
  pool: number[];
  draws: number[];
  poolAtEnd: number[];
}

/**
 * One row per deck per game, for the crops a seat is FARMING or for the ones
 * nobody is.
 *
 * ⚠️ THE SPLIT IS THE WHOLE POINT AND A POOLED FIGURE DESCRIBES NEITHER HALF: a
 * played crop's central deck is smaller than a neutral crop's by what setup deals
 * out of it (`deckSizes`: 14 against 18 since v31). ⚠️ AND A CROP FARMED BY
 * TWO SEATS CONTRIBUTES TWO ROWS, which is the convention metrics.ts already
 * uses for this metric and is kept so the two figures stay comparable.
 */
function deckRows(games: readonly GameMetrics[], which: 'played' | 'neutral'): DeckRows {
  const rows: DeckRows = { reshuffles: [], pool: [], draws: [], poolAtEnd: [] };
  for (const g of games) {
    for (const crop of which === 'played' ? g.suits : g.neutral) {
      const n = g.reshufflesByCrop[crop] ?? 0;
      rows.reshuffles.push(n);
      rows.draws.push(g.deckTopsTakenByCrop[crop] ?? 0);
      rows.poolAtEnd.push(g.poolAtEndByCrop[crop] ?? 0);
      // ⛔ A DECK THAT NEVER RAN DRY HAS NO POOL READING AND MUST NOT CONTRIBUTE
      // A ZERO. Zero reshuffles means the question was never asked, not that the
      // pool was empty, and a zero here would drag the mean toward exactly the
      // wrong conclusion.
      if (n > 0) rows.pool.push((g.reshuffledCardsByCrop[crop] ?? 0) / n);
    }
  }
  return rows;
}

function circulation({ data, pooled }: MeasureContext): Measurement {
  const decks = deckSizes(data);
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }

  const played = deckRows(games, 'played');
  const neutral = deckRows(games, 'neutral');
  // ⛔ THE SCALAR IS THE MEDIAN, matching `reshufflesPerDeck` in metrics.ts
  // exactly, so the headline here and the report's own C1 line are the same
  // number and cannot drift apart.
  const value = median(played.reshuffles);

  const seatGames = sum(games.map((g) => g.seats));
  const barnAtEnd = sum(games.map((g) => sum(g.barnAtEndBySeat)));
  const barnIn = sum(games.map((g) => sum(g.barnInBySeat)));
  const perPlayerBarn = seatGames === 0 ? NaN : barnAtEnd / seatGames;
  const perPlayerIn = seatGames === 0 ? NaN : barnIn / seatGames;
  const rounds = median(games.map((g) => g.rounds));

  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({
      seats: slice.seats,
      played: deckRows(slice.ended, 'played'),
      seatGames: sum(slice.ended.map((g) => g.seats)),
      barn: sum(slice.ended.map((g) => sum(g.barnAtEndBySeat))),
      rounds: median(slice.ended.map((g) => g.rounds)),
    }));

  const detail = [
    '⛔⛔ THE DIRECTION IS DOWN AND HERE IS THE ARITHMETIC, PRINTED RATHER THAN ASSERTED, ' +
      'BECAUSE THIS IS THE ONE NUMBER THAT CAN TELL DEAN WHETHER HIS OWN BEST ARGUMENT FOR THE ' +
      'VILLAGE STORE WAS RIGHT AND IT MUST BE IMPOSSIBLE TO READ BACKWARDS. Reshuffles are ' +
      'roughly DRAWS divided by POOL. Total draws over a game are roughly fixed by its length, ' +
      'and a reshuffle happens when a deck runs dry, so how often one happens is those draws ' +
      'against the size of the circulating pool. CARDS STRANDED IN A BARN ARE CARDS OUT OF ' +
      'THAT POOL, so a stranded-heavy game runs a SMALLER pool and exhausts it MORE often. The ' +
      'Store returns those cards to their suit’s discard, which makes the pool BIGGER, which ' +
      'means FEWER reshuffles for the same drawing. ⭐ SO 7 / 6 / 4 IS A NUMBER TO BEAT ' +
      'DOWNWARD, AND A RESHUFFLE IS NOT CIRCULATION: IT IS THE SAME CARDS BEING RE-DEALT.',
    `THE HEADLINE, RESHUFFLES PER PLAYED DECK (median over ${played.reshuffles.length} played ` +
      `decks in ${games.length} ended games): ${num(value, 2)}. By seat count: ${bySeat
        .map((s) => `${s.seats}p ${num(median(s.played.reshuffles), 2)}`)
        .join('  ')}. ⭐ THE BASELINE IS 7 / 6 / 4 at 2p / 3p / 4p, from ` +
      'reports/watchlist-2026-09-11T21-45-42-reference-v15-notice-board-visit-host-draw-by-seats-v1.txt ' +
      '(n=1580 per seat count, 4,820 games, reference-v15, the seat-shaped host-draw arm ' +
      'A148), which is the NAMED CONTROL of both the delivery-meeple and the Village Store ' +
      `overlays. ⛔ IT IS A reference-v15 LEVEL AND THIS RUN IS ${REFERENCE.id}, so it is NOT ` +
      'comparable as a level with anything on this page: it is kept as the record the ' +
      'prediction was written against. The reading that decides anything is a PAIRED DELTA ' +
      'ON IDENTICAL SEEDS against that control.',
    '⛔ THE RESHUFFLE COUNT ALONE CANNOT SAY WHICH TERM MOVED, SO BOTH ARE PRINTED. If the ' +
      'Store both returns cards AND shortens the game, reshuffles fall for two entirely ' +
      'different reasons. THE NUMERATOR, cards taken off a played deck per game: ' +
      `${num(mean(played.draws), 1)} (median ${num(median(played.draws), 1)}). ` +
      'THE DENOMINATOR, the mean pool at a reshuffle, read off the reshuffled event’s own ' +
      'count - the deck’s length the instant after the discard went in, which is every card of ' +
      `that crop not in a hand, on a table or locked in a barn: ${num(mean(played.pool), 2)} ` +
      `cards over ${played.pool.length} decks that ran dry at least once. ` +
      `Game length for scale: median ${num(rounds, 1)} rounds.`,
    `⭐ ONLY ONE COMBINATION IS DEAN’S ARGUMENT COMING TRUE: reshuffles DOWN and draws roughly ` +
      'HELD and the pool at a reshuffle UP. Reshuffles down WITH the draws down is a shorter ' +
      'game wearing the same number and says nothing about circulation. Reshuffles down with ' +
      'the pool flat is arithmetic nobody has explained and should be treated as a bug until ' +
      'somebody does.',
    `BY SEAT COUNT, ALL THREE TERMS TOGETHER: ${bySeat
      .map(
        (s) =>
          `${s.seats}p [reshuffles ${num(median(s.played.reshuffles), 2)}  draws ` +
          `${num(mean(s.played.draws), 1)}  pool ${num(mean(s.played.pool), 2)}  rounds ` +
          `${num(s.rounds, 1)}]`,
      )
      .join('  ')}. ⚠️ READ THE ROWS AND NOT THE POOLED FIGURE: the game is shorter at every ` +
      'extra seat, so the draws per deck fall with the seat count on arithmetic alone and a ' +
      'pooled reshuffle count averages over unlike games.',
    `THE NEUTRAL DECKS, FOR CONTRAST AND NEVER POOLED WITH THE ABOVE: ` +
      `${num(median(neutral.reshuffles), 2)} reshuffles per neutral deck, ` +
      `${num(mean(neutral.draws), 1)} cards taken. ⚠️ A PLAYED CROP’S CENTRAL DECK IS ` +
      `${decks.played} CARDS (setup deals ${decks.hand} of its ${decks.whole} to a hand and ` +
      `${decks.barn} to a barn) and a neutral crop’s is ${decks.whole} and loses none to ` +
      'setup, so the two churn at completely ' +
      'different rates and one pooled number describes neither. ⭐ THE NEUTRAL LINE IS ALSO ' +
      'THE CONTROL ON THE WHOLE READING: the Store converts BARN cards, and a neutral crop has ' +
      'no barn behind it, so a movement that shows up on both lines is not the Store.',
    `⛔ THE MECHANISM RATHER THAN THE SYMPTOM: ${num(perPlayerBarn, 2)} CARDS PER PLAYER PER ` +
      `GAME WERE STILL IN A BARN WHEN THE GAME STOPPED. Cards that reached a barn at all: ` +
      `${num(perPlayerIn, 1)} a player a game, so ` +
      `${num(perPlayerIn === 0 ? NaN : (100 * perPlayerBarn) / perPlayerIn, 1)}% of everything ` +
      `that entered a barn never left it. By seat count: ${bySeat
        .map((s) => `${s.seats}p ${num(s.seatGames === 0 ? NaN : s.barn / s.seatGames, 2)}`)
        .join('  ')}.`,
    '⛔⛔ AND THIS LINE IS NOT THE DESIGN’S "ABOUT 11 CARDS A PLAYER A GAME" FIGURE, WHICH IS ' +
      'STATED RATHER THAN QUIETLY COMPARED. Section 1 of ' +
      'docs/village-store-coins-2026-09-12-v2.md says about 11 cards a player a game enter a ' +
      'barn and never leave, and it gives no report, no instrument and no counter for that ' +
      'number. The figure above is a DIFFERENT OPERATIONALISATION - the barn each seat was ' +
      'still holding at the stop, read off the final state - and it reads far below 11 and ' +
      'agrees with the report’s own "barn at game end" median of 2 to 3 under the same control. ' +
      '⛔ SO THE TWO ARE NOT THE SAME MEASUREMENT AND MUST NOT BE QUOTED AS ONE. Until somebody ' +
      're-derives the 11 and names what it counted (a mid-game snapshot, an undeliverable ' +
      'PARITY residue rather than a barn total, or an older instrument), the design’s figure is ' +
      'unsourced and this one is the measured one. ⚠️ THAT MATTERS FOR THE STORE’S CASE: the ' +
      'sink is aimed at the 11, and if the real standing residue is a fifth of it the ' +
      'circulation argument is aimed at a smaller fault than the document claims.',
    '⭐ THAT BARN LINE IS THE PARITY TRAP AND IT IS THE CAUSE THE RESHUFFLE LINE IS THE EFFECT ' +
      'OF. A crate is two cards of one named crop, all or nothing, so a single odd card of a ' +
      'crop is worth exactly zero and can never combine: measured, 88.8% of the time a player ' +
      'holds barn cards they cannot afford any open tile and 84% of those are one or two cards ' +
      'short. ⚠️ THE FIGURE HERE IS AN UPPER BOUND ON STRANDING AND NOT THE TRAP ITSELF - a ' +
      'card sitting in a barn at the end may have been deliverable and simply not delivered ' +
      'before the trigger fired. ⛔ A PASS THAT MOVES ONE OF THESE TWO LINES WITHOUT THE OTHER ' +
      'HAS NOT DONE WHAT IT CLAIMS.',
    `WHAT IS STILL CIRCULATING AT THE STOP, as a cross-check that costs nothing: ` +
      `${num(mean(played.poolAtEnd), 1)} cards in a played crop’s deck and discard together ` +
      `(${num(mean(neutral.poolAtEnd), 1)} for a neutral crop). ⭐ It is the complement of the ` +
      'barn line: a crop’s 18 cards are in a hand, a tableau, a barn, a central pile or here. ' +
      '⚠️ Unlike the pool at a reshuffle it exists in every game including one where a deck ' +
      'never ran dry, and unlike it, it is measured at one arbitrary instant - the end - ' +
      'rather than at the moment the pool actually mattered.',
    '⚠️ THE NOISE FLOOR IS HALF PRESENT HERE, WHICH IS UNUSUAL IN THIS PASS AND IS STATED ' +
      'EXACTLY. "reshuffles, played crop" IS in HEADLINE_METRICS, so it HAS a floor: the ' +
      `${NOISE_FLOOR?.reference ?? 'current'} floor (measured ${NOISE_FLOOR?.measured ?? 'never'}) ` +
      `read a movement of ${num(NOISE_FLOOR?.movement['reshuffles, played crop'] ?? NaN, 2)} on it, ` +
      'which the noise report defines as BELOW THE METRIC’S RESOLUTION rather than noiseless (it is ' +
      'a median over integers, so both arms land on the same whole number). READ IT AS ONE ' +
      'UNIT, not as "any delta is real". ⛔ AND THAT FLOOR ' +
      'COVERS THE POOLED MEDIAN ONLY: there is no floor for the per-seat rows, for the ' +
      'mean pool at a reshuffle, for the draws per deck or for the barn at game end.',
    '⛔ NO FAIL CONDITION, AND THE 7 / 6 / 4 WILL NEVER BECOME ONE. The design names no number ' +
      'a reshuffle count must reach; it names a direction and a mechanism, which is a ' +
      'prediction to be scored. A threshold taken off the run that first measures a quantity ' +
      'is a snapshot test that can never fail (ticket 11 section 2), and this project has been ' +
      'bitten by that shape twice - the cap-of-two lesson of 05/09/2026 and its repeat as ' +
      'commonsThreshold: 2 on 09/09/2026, both of which set a guard at a number the thing ' +
      'already sat on.',
    `⛔ THE INSTRUMENT IS ${REFERENCE.id}. The Notice Board visit is the shipped game (ruled ` +
      '13/09/2026), and the 7 / 6 / 4 was read on reference-v15 under an ARM (the seat-shaped ' +
      'host draw), so it is not the shipped game’s figure and must not be quoted as one. ⛔ ' +
      'AND IT IS NOT THE SAME NUMBER AS THE ' +
      'FIRST RECORD OF THIS METRIC, 09/08/2026 on reference-v9 at n=1580, played 6 / 5 / 5 ' +
      'and neutral 0 / 0 / 0: re-cuts sit between them and no level from an earlier ' +
      'reference is comparable. ⭐ THIS PAGE HAS NO MODE GATE, which it shares only with a22 - ' +
      'every currency this codebase has shuffles decks and fills barns, so it never reports NO ' +
      'SUBJECT and it outlives every rule in this pass.',
  ];

  return {
    value,
    headline:
      `DECK CIRCULATION (A150): ${num(value, 2)} reshuffles per played deck, by seat count ` +
      `${bySeat.map((s) => `${s.seats}p ${num(median(s.played.reshuffles), 2)}`).join(' ')}, ` +
      'against a 7 / 6 / 4 baseline recorded on reference-v15 (a different instrument, so not ' +
      'comparable as a level). ' +
      `⛔ LOWER IS THE STORE WORKING: reshuffles are draws (${num(mean(played.draws), 1)} a ` +
      `played deck) over pool (${num(mean(played.pool), 2)} cards at a reshuffle), and ` +
      'barn-locked cards are cards out of the pool, so a bigger pool means fewer reshuffles. ' +
      `${num(perPlayerBarn, 2)} cards a player a game were still in a barn at the stop. ` +
      '⛔ THAT IS NOT THE DESIGN’S UNSOURCED "about 11 a player a game" and must not be quoted ' +
      'as it: it is a different operationalisation, and it reads far lower. ⚠️ Reshuffles ' +
      'falling WITH the draws is a shorter game and not circulation.',
    detail,
    verdict: 'OBSERVE',
  };
}
