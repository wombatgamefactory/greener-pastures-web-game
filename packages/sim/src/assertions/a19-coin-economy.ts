import type { Suit } from '@gp/data';
import { endgameCoinCost, farmsteadCoinPower, isCommonsTakeCoins } from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, median, num, pct, sum } from '../stats.js';

/**
 * NEW ON 10/09/2026 WITH THE COMMONS-WITH-COINS ARM, and it exists because the
 * arm puts a CURRENCY back in a game that deleted one eight days earlier.
 *
 * ## What it is for
 *
 * `rules.turn.commonsTake: 'coins'` (K3/K4, Dean 10/09/2026) gives the bonus
 * slot a second option: discard every card on one central pile to those cards'
 * own suit discards and take ONE COIN PER CARD. The cards leave the game. The
 * coins have exactly TWO uses - the Farmstead's coin-paid suit power (K10-K14)
 * and the fifteen Endgame cards at `rules.economy.endgameCoinCost` (K15) - and
 * they score nothing, break no ties and buy no ordinary card.
 *
 * ⛔ **ONE MINT AND TWO SINKS IS THE WHOLE ARITHMETIC (K7), AND THAT IS WHY THIS
 * FILE EXISTS RATHER THAN A LINE IN a18.** Every coin economy this project has
 * ever shipped died of a second faucet or a pity rate: the visit wage the bank
 * minted from nothing, the GBP 5 = 1 VP pity rate, the market, the card buy.
 * v31 deleted all of it on 02/09/2026. An arm that brings a currency back owes
 * the reader the whole balance sheet on one page - what is minted, what is
 * spent, on which sink, and what is left dead in a wallet at the end - so that
 * a second faucet arriving in some later pass is visible as one rather than
 * being inferred from a win rate three assertions away.
 *
 * ## ⛔ IT HAS NO FAIL CONDITION IN THIS PASS, AND THAT IS DELIBERATE
 *
 * Every number below is OBSERVE. The design names no figure for any of them.
 * The handoff names a SHAPE for exactly one - *"if dead coins exceed about two
 * a player the sinks are too dear"* - and that sentence is printed as CONTEXT
 * beside the number rather than turned into a threshold, because it is an aim
 * Dean stated while asking for a measurement and not a design threshold
 * expressed as shape. The project's own bar (ticket 11 section 2) is that a
 * threshold comes from design intent and NEVER from our own output: the arm has
 * been run zero times, every number here is about to be measured for the first
 * time, and `reference-v15` has no noise floor for any of it. A threshold taken
 * off the run that first measures something is a snapshot test that can never
 * fail.
 *
 * ## ⭐⭐ THE READING DEAN RAISED BY NAME: THE FARMSTEAD FIRES BY SUIT
 *
 * The Farmstead becomes a building with no threshold whose activation cost is
 * one coin, used as a GROW that is your MAIN action, once per turn, with a
 * DIFFERENT power on each of the five (K12). Dean's own framing of the risk, on
 * 10/09/2026, was Orchard against Vegetable: **if one suit fires twice as often
 * as another, the POWERS are mispriced rather than the coins.** That is a
 * different diagnosis from anything the coin lines can produce, and it is the
 * reason the firing count is reported per suit and not only per player. It is
 * keyed off the seat's suit through `suits` rather than folded as a second
 * table, on the `visitsPerTurnBySuit` precedent: a seat's suit is fixed for the
 * whole game, so seat is a strictly finer key and folding both would let the two
 * drift.
 *
 * ## ⚠️ THE OWN-CROP BUILD SHARE, AND THE CORRECTION v2 OF THE HANDOFF MADE
 *
 * The Innovation lens's standing constraint is that the metric axis must not be
 * the specialisation axis, and this game pushes on it from two directions: the
 * Farmstead pays 1 VP per own-crop card built, and the Power and Endgame cards
 * cost two cards of their own suit. The share was **82.6% before v31 and 83.3%
 * after**, over 38,012 builds, and has not been re-read under any pass since.
 *
 * ⛔ **ONLY ONE OF THE TWO PULLS ACTUALLY LEAVES UNDER THE ARM.** K15 re-prices
 * the fifteen Endgame cards in coins, so their two-own-suit cost goes; but K13
 * MOVES the Farmstead's own-crop scorer to the BARN rather than deleting it, so
 * the scoring pull stays exactly where it was and only its source card changes.
 * The prediction is therefore a SMALL move off 82.6-83.3%, and **a large move is
 * the coin economy talking rather than the price**. The clean pairing is
 * `overlays/commons-coins-endgame-cards-v1.overlay.json`, which is this arm with
 * `endgameCoinCost` null and nothing else moved.
 *
 * ## No subject where there are no coins
 *
 * Under every other value of `rules.turn.commonsTake` and under both controls
 * there is no currency in the game at all: `PlayerState.coins` is ABSENT rather
 * than zero (a serialisation question, not a rules one), every counter this
 * reads is a structural zero, and the assertion says NO SUBJECT rather than
 * printing seven zeroes that read as findings about an economy nobody built.
 */
export const coinEconomy: Assertion = {
  id: 19,
  title: 'The coin economy',
  quote:
    'Coins minted per player per game (prediction 7-9), spent on the Farmstead against on ' +
    'Endgame cards, and HELD AT GAME END - if dead coins exceed about two a player the sinks ' +
    'are too dear. FARMSTEAD FIRES BY SUIT, which is the imbalance reading Dean raised by name: ' +
    'if one suit fires twice as often as another the POWERS are mispriced, not the coins. ' +
    '[10/09/2026, the commons with coins]',
  source:
    'docs/commons-coins-handoff-2026-09-10-v2.md section 3.4 and the measurement plan ' +
    '(section 4), readings 2, 3, 6 and 7; K3, K4, K7, K10-K15 of section 2',
  shape:
    'Coins minted per player per game, pooled and by seat count and by the BOARD whose pile was ' +
    'cleared; coins spent, split Farmstead against Endgame cards, with the share of the mint ' +
    'each sink absorbed; coins HELD at game end (dead coins) per player, beside the handoff’s ' +
    'own "about two a player" sentence as context; the Farmstead’s firings per player per game ' +
    'BY SUIT, with the spread between the busiest and the quietest suit named; Endgame cards ' +
    'built per player and by the card’s own suit; the own-crop build share against its 82.6-83.3% ' +
    'v31 reading; and the round on which a seat first minted a coin. NO SUBJECT under every ' +
    'value of rules.turn.commonsTake but "coins", where there is no currency in the game at all.',
  threshold:
    'OBSERVE, and there is NO FAIL CONDITION in this pass. The design names no number for any ' +
    'of these readings. The handoff names a SHAPE for exactly one - "if dead coins exceed about ' +
    'two a player the sinks are too dear" - and that is printed as CONTEXT beside the number ' +
    'rather than enforced, because it is an aim stated while asking for a measurement and not a ' +
    'design threshold expressed as shape. The arm has been run zero times, reference-v15 has no ' +
    'noise floor for any line here, and a threshold taken from the run that FIRST measures ' +
    'something is a snapshot test that can never fail (ticket 11 section 2). ⭐ THE SAME GOES ' +
    'FOR THE 7-9 COINS A PLAYER PREDICTION AND FOR THE 82.6-83.3% OWN-CROP SHARE: the first is ' +
    'a prediction to be checked, the second a reading from a different instrument ' +
    '(reference-v10 and earlier), and neither is a level this run may be failed against.',
  taste: true,
  remedy:
    `${NO_REMEDY} in this pass - nothing here can fail, so nothing here prescribes. The three ` +
    'arms that move these numbers are overlays/commons-coins-endgame-cards-v1.overlay.json ' +
    '(rules.economy.endgameCoinCost null: the same arm with ONE sink instead of two, which is ' +
    'the clean read on both the dead-coin line and the own-crop share), ' +
    'overlays/commons-coins-endgame-price.sweep.json (the same card at 2, 3 and 4 coins) and ' +
    'overlays/commons-coins-no-wild-v1.overlay.json (the wild pair off, which changes how often ' +
    'the slot can be played at all and therefore how fast the piles fatten). ' +
    '⛔ IF A READING HERE LOOKS WRONG, THE ANSWER IS NEVER A SECOND MINT OR A THIRD USE (K7). ' +
    'Every coin economy this project has shipped died of exactly that, and adding one would be ' +
    'the old failure repeating rather than a tuning.',
  measure(ctx) {
    if (!isCommonsTakeCoins(ctx.data)) return noSubject();
    return coinsMode(ctx);
  },
};

function coinsMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const seatGames = sum(games.map((g) => g.seats));

  if (games.length === 0 || seatGames === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }

  const minted = sum(games.map((g) => sum(g.coinsMintedBySeat)));
  const onFarmstead = sum(games.map((g) => sum(g.coinsSpentFarmsteadBySeat)));
  const onEndgame = sum(games.map((g) => sum(g.coinsSpentEndgameBySeat)));
  const spent = onFarmstead + onEndgame;
  const dead = sum(games.map((g) => sum(g.coinsHeldAtEndBySeat)));

  const mintedPerPlayer = minted / seatGames;
  const deadPerPlayer = dead / seatGames;

  // READING 1: the mint, pooled, by seat count and by the pile that paid for it.
  const mintBySeats = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const sg = sum(slice.ended.map((g) => g.seats));
      const m = sum(slice.ended.map((g) => sum(g.coinsMintedBySeat)));
      return `${slice.seats}p ${num(sg === 0 ? NaN : m / sg, 2)}`;
    });
  const mintByBoard = new Map<string, number>();
  for (const g of games) {
    for (const [board, n] of Object.entries(g.coinsMintedByBoard)) {
      mintByBoard.set(board, (mintByBoard.get(board) ?? 0) + n);
    }
  }
  const mintByBoardLine = [...mintByBoard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([board, n]) => `${board} ${pct(minted === 0 ? NaN : n / minted, 0)}`)
    .join('  ');

  // READING 4: the Farmstead by SUIT, keyed off the seat's suit through `suits`
  // for the reason the header gives. Both halves - the firings and the
  // seat-games that could have produced them - have to be pooled per suit, or a
  // suit that happened to be dealt more often would read as a busier power.
  const firesBySuit = new Map<Suit, number>();
  const seatGamesBySuit = new Map<Suit, number>();
  const endgameBySeatSuit = new Map<Suit, number>();
  for (const g of games) {
    g.suits.forEach((suit, seat) => {
      firesBySuit.set(suit, (firesBySuit.get(suit) ?? 0) + (g.farmsteadFiresBySeat[seat] ?? 0));
      seatGamesBySuit.set(suit, (seatGamesBySuit.get(suit) ?? 0) + 1);
      endgameBySeatSuit.set(
        suit,
        (endgameBySeatSuit.get(suit) ?? 0) + (g.endgameBuiltBySeat[seat] ?? 0),
      );
    });
  }
  const perSuit = [...seatGamesBySuit.entries()]
    .map(([suit, sg]) => ({ suit, rate: sg === 0 ? NaN : (firesBySuit.get(suit) ?? 0) / sg }))
    .sort((a, b) => b.rate - a.rate);
  const perSuitLine = perSuit.map((r) => `${r.suit} ${num(r.rate, 2)}`).join('  ');
  const live = perSuit.filter((r) => Number.isFinite(r.rate));
  const busiest = live[0];
  const quietest = live[live.length - 1];
  // ⚠️ A QUIETEST OF ZERO IS NOT "not measurable", IT IS THE SHARPEST POSSIBLE
  // READING OF DEAN'S SENTENCE, and printing NaN there would hide the one result
  // the line exists to find. A suit whose power NEVER fires is a card face that
  // is not worth a main action to anybody, which is a stronger finding than any
  // ratio - so the spread is reported in words when the denominator is zero.
  const suitSpread =
    busiest === undefined || quietest === undefined || quietest.rate === 0
      ? NaN
      : busiest.rate / quietest.rate;
  const spreadPhrase =
    busiest === undefined || quietest === undefined
      ? 'not measurable'
      : Number.isFinite(suitSpread)
        ? `${num(suitSpread, 2)}x (${busiest.suit} ${num(busiest.rate, 2)} against ` +
          `${quietest.suit} ${num(quietest.rate, 2)})`
        : `UNBOUNDED - ${quietest.suit} NEVER FIRED AT ALL, against ${busiest.suit} at ` +
          `${num(busiest.rate, 2)} per player per game`;

  const fires = sum(games.map((g) => sum(g.farmsteadFiresBySeat)));

  // READING 5: the Endgame cards, by the seat that built them and by the CARD's
  // own suit. Two different questions - how many a player reaches, and whose
  // cards get reached for - and the second is the one that bears on the pull.
  const endgameBuilt = sum(games.map((g) => sum(g.endgameBuiltBySeat)));
  const endgameByCardSuit = new Map<string, number>();
  for (const g of games) {
    for (const [suit, n] of Object.entries(g.endgameBuiltByCardSuit)) {
      endgameByCardSuit.set(suit, (endgameByCardSuit.get(suit) ?? 0) + n);
    }
  }
  const endgameByCardSuitLine = [...endgameByCardSuit.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([suit, n]) => `${suit} ${pct(endgameBuilt === 0 ? NaN : n / endgameBuilt, 0)}`)
    .join('  ');
  const endgameBySeatSuitLine = [...endgameBySeatSuit.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([suit, n]) =>
        `${suit} ${num((seatGamesBySuit.get(suit) ?? 0) === 0 ? NaN : n / (seatGamesBySuit.get(suit) as number), 2)}`,
    )
    .join('  ');

  // READING 6: the own-crop build share, already folded since the Dairy rebuild
  // and deliberately NOT re-counted here - one counter, one number.
  const ownBuilds = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
  const foreignBuilds = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
  const allBuilds = ownBuilds + foreignBuilds;

  // READING 7: the arc. Seats that never minted are counted as their own line
  // rather than folded into the median as a large number, which would report a
  // seat that never opened an economy as one that opened it late.
  const firstRounds = games.flatMap((g) =>
    g.firstCoinRoundBySeat.filter((r): r is number => r !== null),
  );
  const neverMinted = seatGames - firstRounds.length;

  const price = endgameCoinCost(data);
  const farmsteadOn = farmsteadCoinPower(data);

  return {
    value: mintedPerPlayer,
    headline:
      `${num(mintedPerPlayer, 2)} coins minted per player per game; spent ` +
      `${pct(minted === 0 ? NaN : onFarmstead / minted)} on the Farmstead and ` +
      `${pct(minted === 0 ? NaN : onEndgame / minted)} on Endgame cards; ` +
      `${num(deadPerPlayer, 2)} dead in a wallet at game end`,
    detail: [
      `⭐ 1. THE MINT (K3), THE ARM'S ONLY FAUCET: ${minted} coins over ${games.length} ended ` +
        `games, ${num(mintedPerPlayer, 2)} per player per game. BY SEAT COUNT: ` +
        `${mintBySeats.join('  ')}. BY THE BOARD WHOSE PILE WAS CLEARED: ` +
        `${mintByBoardLine || 'no coins minted'} - a share of COINS, and so of CARDS CLEARED, ` +
        `rather than of TAKES, so it does not match a17's take-by-board line unless every pile ` +
        `happened to be the same depth. ⚠️ THE HANDOFF PREDICTED 7-9 A PLAYER and ` +
        'that is a prediction to be checked rather than a level this can be failed against. ' +
        'One coin per card cleared, so this is also the count of cards that LEFT THE GAME ' +
        'through the centre - a18 carries the same quantity as cards.',
      `⭐ 2. THE TWO SINKS (K7): ${spent} of ${minted} coins were spent ` +
        `(${pct(minted === 0 ? NaN : spent / minted)} of the mint). THE FARMSTEAD took ` +
        `${onFarmstead} (${pct(minted === 0 ? NaN : onFarmstead / minted)} of the mint, ` +
        `${num(onFarmstead / seatGames, 2)} per player per game, always one coin apiece); ` +
        `THE ENDGAME CARDS took ${onEndgame} ` +
        `(${pct(minted === 0 ? NaN : onEndgame / minted)}, ${num(onEndgame / seatGames, 2)} per ` +
        `player per game, at ${price === null ? 'no coin price - endgameCoinCost is null in this run' : `${price} coins a card`}). ` +
        (farmsteadOn
          ? ''
          : '⚠️ rules.economy.farmsteadCoinPower is OFF in this run, so the Farmstead sink does ' +
            'not exist and the whole mint has one place to go. ') +
        '⛔ THERE IS NO THIRD USE AND THERE MUST NEVER BE ONE (K7): coins score nothing, break ' +
        'no ties, buy no ordinary card and are minted by nothing but a pile.',
      `⭐ 3. DEAD COINS: ${dead} still held when the game ended, ${num(deadPerPlayer, 2)} per ` +
        `player (median across seat-games ` +
        `${num(median(games.flatMap((g) => g.coinsHeldAtEndBySeat)), 1)}). ` +
        `⚠️ THE HANDOFF'S OWN SENTENCE, PRINTED AS CONTEXT AND NOT AS A VERDICT: "if dead coins ` +
        'exceed about two a player the sinks are too dear". This assertion cannot fail on it - ' +
        'it is an aim stated while asking for a measurement, not a threshold expressed as ' +
        'shape - so the reading is left where a designer can take it. ' +
        `THE BALANCE SHEET CLOSES: ${minted} minted = ${spent} spent + ${dead} dead ` +
        `(${minted === spent + dead ? 'exact' : `⛔ OUT BY ${minted - spent - dead}, which is a fold bug and not a reading`}).`,
      `⭐⭐ 4. THE FARMSTEAD FIRES BY SUIT, WHICH IS THE IMBALANCE READING DEAN RAISED BY NAME ` +
        `(10/09/2026): firings per player per game, ${perSuitLine || 'no firings'}. ` +
        `${fires} firings in all, ${num(fires / seatGames, 2)} per player per game. ` +
        `BUSIEST AGAINST QUIETEST: ${spreadPhrase}. ` +
        '⭐ DEAN\'S OWN SENTENCE: "if one suit fires twice as often as another the POWERS are ' +
        'mispriced, not the coins", and Orchard against Vegetable was the pair he named. Read ' +
        'this line BEFORE any coin line, because a spread here is a card-face problem that no ' +
        'amount of re-pricing the mint or the sinks can reach. ⚠️ It is a MAIN action (K10) ' +
        'and once a turn, so the ceiling is one firing per turn and a suit near it is a suit ' +
        'whose whole turn the power is worth taking.',
      `⭐ 5. ENDGAME CARDS BUILT (K15): ${endgameBuilt} in all, ` +
        `${num(endgameBuilt / seatGames, 2)} per player per game. BY THE CARD'S OWN SUIT: ` +
        `${endgameByCardSuitLine || 'none built'}. BY THE BUILDER'S SUIT, per player per game: ` +
        `${endgameBySeatSuitLine || 'none built'}. The two are different questions and the gap ` +
        'between them is the point: a table that builds its own suit’s Endgame cards is ' +
        'still specialising whatever the price is denominated in.',
      `⭐⭐ 6. THE OWN-CROP BUILD SHARE: ${pct(allBuilds === 0 ? NaN : ownBuilds / allBuilds)} ` +
        `(${ownBuilds} of ${allBuilds} builds). ⛔ ONLY ONE OF THE TWO MONOCULTURE PULLS LEAVES ` +
        'UNDER THIS ARM, and the handoff corrected itself on exactly this point: K15 takes away ' +
        'the Endgame cards’ two-own-suit cost, but K13 MOVES the Farmstead’s own-crop ' +
        'scorer to the BARN rather than deleting it, so the scoring pull is untouched and only ' +
        'its source card changes. **THE PREDICTION IS THEREFORE A SMALL MOVE OFF 82.6-83.3%, ' +
        'AND A LARGE ONE IS THE COIN ECONOMY TALKING RATHER THAN THE PRICE.** ' +
        '⛔ AND 82.6-83.3% IS A reference-v10-AND-EARLIER LEVEL, so it is context and never a ' +
        'threshold: the clean comparison is the paired run against ' +
        'overlays/commons-coins-endgame-cards-v1.overlay.json on identical seeds.',
      `⭐ 7. THE ARC - THE ROUND A SEAT FIRST MINTED A COIN: mean ` +
        `${num(mean(firstRounds), 1)}, median ${num(median(firstRounds), 1)} ` +
        `(${firstRounds.length} of ${seatGames} seat-games minted at all; ${neverMinted} ` +
        `NEVER DID, ${pct(seatGames === 0 ? NaN : neverMinted / seatGames)}). The mint is the ` +
        'only faucet, so this is the earliest either sink could open for that seat. ⚠️ A seat ' +
        'that never minted is counted on its own line rather than folded into the median as a ' +
        'large round number, because a seat with no economy at all is a different finding from ' +
        'a seat that opened one late.',
      '⛔ NO FAIL CONDITION IN THIS PASS. Every line above is OBSERVE, because the design names ' +
        'no number for any of them and one taken from this run - the run that first measures ' +
        'them - would be a snapshot test that can never fail. reference-v15 has no noise floor ' +
        'for any of these readings either, so a delta in one is not yet formally readable.',
      '⚠️ AND THE BOTS HAVE A COIN WEIGHT THAT SOMEBODY CHOSE. A coin has no intrinsic worth ' +
        'to a rollout, so the evaluator prices one by an argument rather than by measurement, ' +
        'and every number on this page is downstream of that choice. It is the same shape of ' +
        'caveat a18 carries about the fee and the board: these are the RULES speaking through ' +
        'one pricing, not a taste.',
    ],
    verdict: 'OBSERVE',
  };
}

/**
 * No subject wherever the arm is off, and the same pattern a18 uses under the
 * controls: `PlayerState.coins` is ABSENT rather than zero under every other
 * mode, so every counter here is a structural zero and printing seven of them
 * would read as findings about an economy nobody built.
 */
function noSubject(): Measurement {
  return {
    value: NaN,
    headline:
      'NO SUBJECT: there are no coins in this game. A coin exists only under ' +
      'rules.turn.commonsTake "coins" (K3, 10/09/2026), which is the arm ' +
      'overlays/commons-coins-v1.overlay.json and nothing else; coins were deleted from the ' +
      'shipped game with v31 on 02/09/2026 and nothing has minted one since. a17-bonus-mix ' +
      'owns the bonus slot here and a18-commons-traffic owns the centre.',
    verdict: 'OBSERVE',
  };
}

/** Kept beside the metrics type so a future reader can see what this file reads. */
export type CoinMetrics = Pick<
  GameMetrics,
  | 'coinsMintedBySeat'
  | 'coinsMintedByBoard'
  | 'coinsSpentFarmsteadBySeat'
  | 'coinsSpentEndgameBySeat'
  | 'coinsHeldAtEndBySeat'
  | 'farmsteadFiresBySeat'
  | 'endgameBuiltBySeat'
  | 'endgameBuiltByCardSuit'
  | 'firstCoinRoundBySeat'
>;
