import type { GameData } from '@gp/data';
import {
  coinGrowReachesFullBuildings,
  coinPaysBuild,
  coinPaysGrow,
  coinPaysSuitCost,
  coinSupplyPerPlayer,
  isCommonsTakeCoins,
  isNoticeBoardPower,
  storeCoinsPerCard,
} from '@gp/data';

import type { GameMetrics } from '../observe.js';
import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, median, num, pct, sum } from '../stats.js';

/**
 * NEW ON 12/09/2026 WITH THE VILLAGE STORE COIN (V1 to V12, ledger row A150),
 * and it is the BALANCE SHEET: one mint, two sinks, one shared supply, and what
 * is left dead in a wallet at the end.
 *
 * ## ⛔ WHY IT IS A PAGE AND NOT A LINE, WHICH IS a19's ARGUMENT ARRIVING AGAIN
 *
 * Every coin economy this project has shipped died of a SECOND FAUCET or a pity
 * rate: the visit wage the bank minted from nothing, the GBP 5 = 1 VP rate, the
 * market, the card buy. v31 deleted all of it on 02/09/2026. An arm that brings
 * a currency back owes the reader the whole balance sheet on ONE page - what is
 * minted, what is spent, on which sink, and what is left dead - so that a third
 * use arriving in some later pass is visible as one rather than being inferred
 * from a win rate three assertions away. ⭐ O17 The Fruit Basket was restricted
 * to a hand discard on 12/09/2026 for exactly that reason: as written it would
 * have returned a card paid into the exchange to its owner's barn while they
 * kept the coin, a second mint, once a turn, free.
 *
 * ## ⛔ THE TWO COIN ECONOMIES IN THIS CODEBASE ARE NOT THE SAME ECONOMY
 *
 * `coinsMinted` and `coinsSpent` are shared, and the sharing is deliberate: the
 * builder widened the existing events rather than adding new ones, because a new
 * event name breaks `observe.ts`'s exhaustive `Record<GameEvent['e'], boolean>`.
 * So the split has to be read off the fields.
 *
 *  - **The Village Store (V1, this page)** mints ONE CARD AT A TIME out of a
 *    BARN at a delivery: `coinsMinted.board === 'store'`, one event per card,
 *    with `card` naming the barn card that paid. Its sinks are
 *    `coinsSpent.on === 'build'` and `'grow'`.
 *  - **The commons with coins (K3, a19)** mints by clearing a central PILE:
 *    `coinsMinted.board` is a `Suit`. Its sinks are `'farmstead'` and
 *    `'endgame'`.
 *
 * ⛔ NO OVERLAY TURNS BOTH ON, and the two arms pin each other's leaves off by
 * name. a19 is gated on `isCommonsTakeCoins` and this page on
 * `storeCoinsPerCard`, so each says NO SUBJECT where the other is live. ⚠️ If
 * both ever read live at once, this page says so in its first line and every
 * number under it is a fold of two economies.
 *
 * ## ⛔ NO FAIL CONDITION ANYWHERE, AND NONE WILL BE TAKEN FROM THIS RUN
 *
 * The design names no number for the mint, for either sink, for the dead coins
 * or for the supply. Two SHAPES exist and both are printed as CONTEXT and
 * enforced nowhere:
 *
 *  - *"if dead coins exceed about two a player the sinks are too dear"*, and
 *  - *"7-9 coins minted a player a game"*,
 *
 * and ⛔ **BOTH BELONG TO THE OTHER COIN ARM.** They are section 3.4 and
 * reading 2 of `docs/commons-coins-handoff-2026-09-10-v2.md`, written about a
 * mint that clears a central pile, not about a barn exchange. They are printed
 * here because Dean asked for them to be scored, and they are printed with that
 * provenance attached, because a shape borrowed from another economy is context
 * at best and a category error at worst.
 *
 * A threshold taken off the run that FIRST measures a quantity is a snapshot
 * test that can never fail (ticket 11 section 2), and this project has been
 * bitten by that exact shape twice: the cap-of-two lesson of 05/09/2026 and its
 * repeat as `commonsThreshold: 2` on 09/09/2026, both of which set a guard at a
 * number the thing already sat on.
 *
 * ## ⛔ THE INSTRUMENT, AND THIS IS AN ARM ON TOP OF AN ARM
 *
 * `reference-v15`. C100 is open and no Notice Board configuration is ruled in as
 * the shipped game, so the control is only the best-performing configuration
 * measured (`overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json`,
 * 5 PASS / 1 FAIL / 11 OBSERVE) and not a ruling. No level here is comparable
 * with a `reference-v14` or earlier number, and ⚠️ THERE IS NO NOISE FLOOR FOR
 * ANY LINE ON THIS PAGE: nothing here is in `HEADLINE_METRICS` and `--noise` has
 * never been run against a Store arm.
 */
export const villageStoreCoin: Assertion = {
  id: 25,
  title: 'The Village Store coin: one mint, two sinks and a shared supply (A150)',
  quote:
    'When you make a delivery you may spend any number of additional cards from your barn, ' +
    'taking £1 for each. The supply is 5 coins per player, shared, with no per-player holding ' +
    'cap; spent coins return to the supply and may be minted again; an empty supply mints ' +
    'nothing. A coin is a wild card for BUILD, paying any or all of a cost including the ' +
    'n-of-suit requirement, and a wild card for GROW, where it places nothing so the building ' +
    'never clogs and A FULL BUILDING IS A LEGAL TARGET. A coin may never pay a visit, a ' +
    'Harvest or a Deliver, and coins score nothing at any rate.',
  source:
    'docs/village-store-coins-2026-09-12-v2.md sections 2, 3 and 4, and ' +
    'docs/village-store-coins-handoff-2026-09-12-v1.md section 2 (V1 to V12) and section 7 ' +
    '(Dean, 12/09/2026), carried as ledger row A150. ⚠️ The "7-9 coins a player" and "about ' +
    'two dead coins a player" shapes printed on this page are NOT from either of those: they ' +
    'are docs/commons-coins-handoff-2026-09-10-v2.md, written about the OTHER coin arm.',
  shape:
    'The faucet: barn cards converted and coins minted per player per game, per DELIVERY, and ' +
    'by the converted card’s own suit. The supply: the pool’s size, the share of turns it held ' +
    'nothing, and the deliveries that could not convert because it was empty. The two sinks ' +
    'split by name: coins on BUILD (and the builds they paid for), and coin-GROWS split from ' +
    'card-Grows with the ones that fired on a FULL building (V9) on their own line. Dead coins ' +
    'held at game end, which score nothing (V11). The pool identity, printed so a leak is ' +
    'legible. And the own-crop build share, which belongs to coinPaysSuitCost and to no other ' +
    'leaf. NO SUBJECT wherever rules.economy.storeCoinsPerCard is 0, which is every mode this ' +
    'project has ever shipped.',
  threshold:
    'OBSERVE, NO FAIL CONDITION, on every line. The design names no number for the mint, for ' +
    'either sink, for the dead coins or for the supply. ⛔ THE TWO SHAPES THIS PAGE PRINTS - ' +
    '"if dead coins exceed about two a player the sinks are too dear" and "7-9 minted a player ' +
    'a game" - ARE THE OTHER COIN ARM’S, from docs/commons-coins-handoff-2026-09-10-v2.md, ' +
    'written about a mint that clears a central pile rather than a barn exchange. They are ' +
    'printed as CONTEXT with that provenance attached and are enforced nowhere. A threshold ' +
    'taken off the run that FIRST measures a quantity is a snapshot test that can never fail ' +
    '(ticket 11 section 2, and the cap-of-two lesson of 05/09/2026 repeated as ' +
    'commonsThreshold: 2 on 09/09/2026). ⚠️ The 82.6-83.3% own-crop share is a reference-v10 ' +
    'and earlier level and is not comparable as a level at all.',
  taste: true,
  remedy:
    `${NO_REMEDY} - nothing here can fail, so nothing here prescribes. ⭐ THE ARMS THAT MOVE ` +
    'THESE NUMBERS, all four against the control ' +
    'overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json on identical reference-v15 ' +
    'seeds: overlays/village-store-coins-v1.overlay.json is the assembled coin, ' +
    'overlays/village-store-coins-build-only-v1.overlay.json and ' +
    'overlays/village-store-coins-grow-only-v1.overlay.json hold the two bets apart, and ' +
    'overlays/village-store-coins-wild-only-v1.overlay.json turns the n-of-suit half off, ' +
    'which is the arm the own-crop line belongs to. ⛔ IF A READING HERE LOOKS WRONG, THE ' +
    'ANSWER IS NEVER A SECOND MINT OR A THIRD USE. Every coin economy this project has shipped ' +
    'died of exactly that, and O17 The Fruit Basket had already opened one loop before the ' +
    'rule was a day old.',
  measure(ctx) {
    if (storeCoinsPerCard(ctx.data) <= 0) return noSubject(ctx.data);
    return storeMode(ctx);
  },
};

/**
 * ⛔ NO SUBJECT WHEREVER `rules.economy.storeCoinsPerCard` IS 0, which is every
 * mode this project has ever shipped, both controls included.
 *
 * `PlayerState.coins` and `GameState.coinSupply` are both ABSENT rather than
 * zero there (a serialisation question and not a rules one, and nine fixtures
 * replay byte-identically because of it), so every counter this page reads is a
 * structural zero and printing a dozen of them would read as findings about an
 * economy nobody built.
 */
function noSubject(data: GameData): Measurement {
  const other = isCommonsTakeCoins(data)
    ? '⚠️ THERE ARE COINS IN THIS GAME BUT THEY ARE NOT THESE ONES: ' +
      'rules.turn.commonsTake is "coins", which is the SEPARATE commons-with-coins arm of ' +
      '10/09/2026 (K3/K7) whose mint clears a central pile and whose sinks are the Farmstead ' +
      'and the Endgame cards. a19-coin-economy owns that whole balance sheet.'
    : 'There is no currency in this game at all. Coins were deleted from the shipped game with ' +
      'v31 on 02/09/2026 and the only two things that have minted one since are arms: ' +
      'rules.turn.commonsTake "coins" (a19) and this one.';
  return {
    value: NaN,
    headline:
      'NO SUBJECT: rules.economy.storeCoinsPerCard is 0, so there is no Village Store in this ' +
      `game (V1, ledger A150). ${other}`,
    detail: [
      'The arms are overlays/village-store-coins-v1.overlay.json (both sinks), ' +
        'overlays/village-store-coins-build-only-v1.overlay.json, ' +
        'overlays/village-store-coins-grow-only-v1.overlay.json and ' +
        'overlays/village-store-coins-wild-only-v1.overlay.json. ⛔ Every one of them is an ARM ' +
        'ON TOP OF AN ARM: C100 is open and no Notice Board configuration is ruled in as the ' +
        'shipped game.',
      '⚠️ THE MINT IS THE OFF SWITCH AND THE SINKS ARE NOT. rules.economy.coinPaysBuild and ' +
        'rules.economy.coinPaysGrow can be true with no mint behind them and the game is still ' +
        'coinless, so this page gates on storeCoinsPerCard and on nothing else. ' +
        'a26-store-conversion and a27-coin-hand gate the same way, and a26 carries C113.',
    ],
    verdict: 'OBSERVE',
  };
}

interface Totals {
  seatGames: number;
  games: number;
  cards: number;
  coins: number;
  deliveries: number;
  onBuild: number;
  builds: number;
  coinGrows: number;
  coinGrowsBought: number;
  coinGrowsOfFull: number;
  grows: number;
  dead: number;
  supplyLeft: number;
  supplyTurns: number;
  supplyEmptyTurns: number;
  supplySum: number;
}

function totals(games: readonly GameMetrics[]): Totals {
  const t: Totals = {
    seatGames: 0,
    games: games.length,
    cards: 0,
    coins: 0,
    deliveries: 0,
    onBuild: 0,
    builds: 0,
    coinGrows: 0,
    coinGrowsBought: 0,
    coinGrowsOfFull: 0,
    grows: 0,
    dead: 0,
    supplyLeft: 0,
    supplyTurns: 0,
    supplyEmptyTurns: 0,
    supplySum: 0,
  };
  for (const g of games) {
    t.seatGames += g.seats;
    t.cards += sum(g.storeCardsConvertedBySeat);
    t.coins += sum(g.storeCoinsMintedBySeat);
    t.deliveries += sum(g.deliveriesBySeat);
    t.onBuild += sum(g.coinsSpentBuildBySeat);
    t.builds += sum(g.coinBuildsBySeat);
    t.coinGrows += sum(g.coinGrowsBySeat);
    t.coinGrowsBought += sum(g.coinGrowsBoughtBySeat);
    t.coinGrowsOfFull += sum(g.coinGrowsOfFullBySeat);
    t.grows += sum(g.growsBySeat);
    t.dead += sum(g.coinsHeldAtEndBySeat);
    t.supplyLeft += g.coinSupplyAtEnd;
    t.supplyTurns += g.coinSupplySampledTurns;
    t.supplyEmptyTurns += g.coinSupplyEmptyTurns;
    t.supplySum += g.coinSupplySum;
  }
  return t;
}

/** A tally as shares of the whole, in a fixed order so two reports diff cleanly. */
function mix(counts: ReadonlyMap<string, number>, order: readonly string[]): string {
  const all = [...counts.values()].reduce((a, b) => a + b, 0);
  if (all === 0) return 'nothing to split';
  const known = order.filter((k) => counts.has(k));
  const rest = [...counts.keys()].filter((k) => !order.includes(k));
  return [...known, ...rest].map((k) => `${k} ${pct((counts.get(k) ?? 0) / all)}`).join('  ');
}

function storeMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  if (games.length === 0) {
    return { value: NaN, headline: 'not measured: no games ended', verdict: 'OBSERVE' };
  }
  const t = totals(games);
  if (t.seatGames === 0) {
    return { value: NaN, headline: 'not measured: no seat-games', verdict: 'OBSERVE' };
  }
  const per = (n: number) => n / t.seatGames;
  // ⛔ THE ONE SCALAR IS THE MINT PER PLAYER PER GAME, because it is the faucet
  // and because everything else on the page is a share of it. The conversion
  // RATE, which is the pass's real question, is a26's scalar and not this one.
  const value = per(t.cards);

  const convertedBySuit = new Map<string, number>();
  for (const g of games) {
    for (const [suit, n] of Object.entries(g.storeConvertedByCardSuit)) {
      if (n > 0) convertedBySuit.set(suit, (convertedBySuit.get(suit) ?? 0) + n);
    }
  }

  const ownBuilds = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
  const foreignBuilds = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
  const allBuilds = ownBuilds + foreignBuilds;

  const firstRounds = games.flatMap((g) =>
    g.firstCoinRoundBySeat.filter((r): r is number => r !== null),
  );
  const neverMinted = t.seatGames - firstRounds.length;

  const spent = t.onBuild + t.coinGrows;
  const pool = coinSupplyPerPlayer(data);
  const bySeat = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => ({ seats: slice.seats, t: totals(slice.ended) }));
  const seatLine = (f: (x: Totals) => number) =>
    bySeat.map((s) => `${s.seats}p ${num(s.t.seatGames === 0 ? NaN : f(s.t), 2)}`).join('  ');

  const bothEconomies = isCommonsTakeCoins(data);

  const detail = [
    ...(bothEconomies
      ? [
          '⛔⛔ BOTH COIN ECONOMIES ARE LIVE IN THIS RUN AND THAT IS NOT A CONFIGURATION ANY ' +
            'OVERLAY SHIPS. rules.economy.storeCoinsPerCard is above 0 AND rules.turn.commonsTake ' +
            'is "coins", so `coinsMinted` and the wallet are carrying two different mints at ' +
            'once. a19 and this page are both reading, and every shared counter below (the dead ' +
            'coins above all) is a fold of two economies. DO NOT QUOTE ANY NUMBER ON EITHER PAGE ' +
            'UNTIL THE OVERLAY IS FIXED.',
        ]
      : []),
    `⭐ 1. THE MINT (V1), AND IT IS THE ONLY FAUCET IN THE GAME: ${t.cards} barn cards ` +
      `converted over ${games.length} ended games, ${num(per(t.cards), 2)} per player per ` +
      `game, paying ${num(per(t.coins), 2)} coins per player per game at ` +
      `${storeCoinsPerCard(data)} a card. PER DELIVERY: ${num(t.deliveries === 0 ? NaN : t.cards / t.deliveries, 2)} ` +
      `cards over ${t.deliveries} deliveries (${num(per(t.deliveries), 2)} deliveries a player ` +
      `a game). BY SEAT COUNT, cards a player a game: ${seatLine((x) => x.cards / x.seatGames)}. ` +
      '⚠️ THE DELIVERY DENOMINATOR IS EVERY `delivered` EVENT, and V14 The Village Wagon emits ' +
      'a SECOND one with an empty spend for the same payment, so it runs very slightly high. ' +
      'The exchange count itself does not: a26 takes it off the `mint` TASK.',
    `⚠️ 1a. THE "7-9 COINS A PLAYER A GAME" PREDICTION, SCORED HERE BECAUSE DEAN ASKED FOR IT ` +
      `AND CAVEATED BECAUSE IT IS NOT THIS RULE'S: this run reads ${num(per(t.coins), 2)}. ` +
      '⛔ THE FIGURE IS reading 2 of docs/commons-coins-handoff-2026-09-10-v2.md, written about ' +
      'the OTHER coin arm, whose mint clears a whole central pile in one go and pays one coin ' +
      'per card in it. The Village Store mints one card at a time out of a barn at a delivery. ' +
      'The two are different quantities produced by different rules, so this is CONTEXT and ' +
      'never a threshold, and a Store number far from 7-9 says nothing about either.',
    `⭐ 2. WHAT WAS CONVERTED, BY THE CARD'S OWN SUIT: ${mix(convertedBySuit, data.cards.suits)}. ` +
      '⭐ THIS IS THE PARITY TRAP NAMED RATHER THAN INFERRED. A crate is two cards of one crop, ' +
      'all or nothing, so a single odd card of a crop is worth exactly zero: 88.8% of the time ' +
      'a player holds barn cards they cannot afford any open tile and 84% of those are one or ' +
      'two cards short. A suit heavy on this line is a suit that strands. ⛔ D1: every one of ' +
      'these cards went to its OWN suit’s discard and never out of the game, which is Dean’s ' +
      'circulation argument and is a24-deck-circulation’s subject, not this page’s.',
    `⭐ 3. THE SHARED SUPPLY (V4/V5), WHICH IS THE HALF OF THE DESIGN THAT DOES THE RATIONING: ` +
      `${pool} coins a seat, so ${bySeat.map((s) => `${s.seats}p ${pool * s.seats}`).join('  ')} ` +
      `in the pool. IT HELD NOTHING ON ${pct(t.supplyTurns === 0 ? NaN : t.supplyEmptyTurns / t.supplyTurns)} ` +
      `OF ${t.supplyTurns} TURNS SAMPLED (mean ${num(t.supplyTurns === 0 ? NaN : t.supplySum / t.supplyTurns, 2)} ` +
      `coins standing in it), and ${num(t.games === 0 ? NaN : t.supplyLeft / t.games, 2)} coins ` +
      `were still unspent in it when the game ended. BY SEAT COUNT, the empty share: ${bySeat
        .map(
          (s) =>
            `${s.seats}p ${pct(s.t.supplyTurns === 0 ? NaN : s.t.supplyEmptyTurns / s.t.supplyTurns)}`,
        )
        .join('  ')}. ⛔ THIS IS C113’s OTHER HALF AND IT IS NOT AN EXHAUSTION READING: spent ` +
      'coins return to the supply (V5), so the pool recirculates and an empty supply means ' +
      'every coin is in somebody’s hand right now. ⚠️ A SUPPLY THAT NEVER EMPTIES IS A SUPPLY ' +
      'RATIONING NOTHING, which is the whole of Dean’s answer to the August objection. a26 ' +
      'carries the conversion rate this must be read beside.',
    `⭐ 4. SINK ONE, THE BUILD (V6/V7): ${t.onBuild} coins over ${t.builds} builds any part of ` +
      `which was paid in coins - ${num(per(t.onBuild), 2)} coins and ${num(per(t.builds), 2)} ` +
      `builds a player a game, ${num(t.builds === 0 ? NaN : t.onBuild / t.builds, 2)} coins a ` +
      `build. ${coinPaysBuild(data) ? '' : '⚠️ rules.economy.coinPaysBuild IS OFF IN THIS RUN, so this sink does not exist and the whole mint has one place to go. '}` +
      `rules.economy.coinPaysSuitCost is ${coinPaysSuitCost(data)}, which is V6’s n-of-suit ` +
      'half and the ONLY leaf that makes off-crop building cheap. ⭐ ONE `coinsSpent` EVENT PER ' +
      'BUILD FOR THE WHOLE COIN COMPONENT, because coins are fungible and a payment names a ' +
      'COUNT and never which coins - getting that wrong is the single easiest way to blow up ' +
      'the payment enumerator, and it is why the coins and the builds are two tallies.',
    `⭐⭐ 5. SINK TWO, THE GROW (V8), SPLIT FROM CARD-GROWS BECAUSE THAT IS THE READING: ` +
      `${t.coinGrows} coin-Grows against ${t.grows - t.coinGrows} card-Grows, so ` +
      `${pct(t.grows === 0 ? NaN : t.coinGrows / t.grows)} of all ${t.grows} Grows were paid ` +
      `with a coin (${num(per(t.coinGrows), 2)} a player a game). OF THOSE, ` +
      `${t.coinGrowsBought} were BOUGHT Grows through the Apiary door rather than a main ` +
      'action, which is the half that makes the design’s stated ceiling of two coin-Grows in ' +
      'one turn reachable. ' +
      (isNoticeBoardPower(data)
        ? '⛔ AND UNDER THIS MODE A BOUGHT GROW HAS NO SUBJECT, SO A ZERO THERE IS STRUCTURAL ' +
          'AND NOT A FINDING: the workers roster’s apiary door buys SOW, and GROW is its ' +
          '`actionUnderCommons`, which only the commons reads. The ceiling under a Notice Board ' +
          'visit is therefore ONE coin-Grow a turn and not two. '
        : '') +
      `${coinPaysGrow(data) ? '' : '⚠️ rules.economy.coinPaysGrow IS OFF IN THIS RUN. '}` +
      '⛔ A COIN-GROW PLACES NOTHING, so the building does not advance toward its threshold, ' +
      'placement triggers do not fire (A16 The Beekeeper’s Veil is the obvious one) and A21 ' +
      'The Wax Hall does not count a building held empty this way - all ruled in with eyes ' +
      'open on 12/09/2026. ⚠️ IT ALSO PAYS NO CARD, which is a27-coin-hand’s whole subject.',
    `⛔⛔ 6. V9, THE STRONGEST SINGLE CLAUSE IN THE PACKAGE, ON ITS OWN LINE: ` +
      `${t.coinGrowsOfFull} coin-Grows fired on a building that was ALREADY FULL, which is ` +
      `${pct(t.coinGrows === 0 ? NaN : t.coinGrowsOfFull / t.coinGrows)} of every coin-Grow and ` +
      `${num(per(t.coinGrowsOfFull), 2)} a player a game. ` +
      `rules.economy.coinGrowOnFullBuilding resolves to ${coinGrowReachesFullBuildings(data)} ` +
      'through coinGrowReachesFullBuildings, which is the accessor carrying the precedence - ' +
      'V9 is meaningless without V8 and no branch of play may read the raw leaf. ⭐ THIS IS ' +
      'THE FIRST CLOG BYPASS IN THIS GAME SINCE THE MEEPLES, ruled in deliberately by Dean on ' +
      '12/09/2026. ⛔ AND IT IS WHY C110 EXISTS: the cost/threshold curve is inverse ON ' +
      'PURPOSE, expensive low-threshold buildings are strong BECAUSE clog is their brake, and ' +
      'a repeatable currency that removes the brake changes what every Tier 3 is worth. That ' +
      'is card-balance work and not a reason to reopen the rule. ⭐ THE SELF-LIMIT TO WATCH ' +
      'FOR, which is the design’s best claim about itself: a building you only ever coin-Grow ' +
      'never fills, so it is never harvested, so it never puts cards in your barn, and barn ' +
      'cards are what make coins. If coin-Grows rise while the mint falls, the self-limit is ' +
      'real; if both rise together it is not.',
    `⭐ 7. DEAD COINS (V11): ${t.dead} still held when the game ended, ${num(per(t.dead), 2)} ` +
      `per player (median across seat-games ${num(median(games.flatMap((g) => g.coinsHeldAtEndBySeat)), 1)}). ` +
      '⛔ THEY SCORE NOTHING AT ANY RATE and they do not count toward the tie-break of most ' +
      'cards in hand and barn combined (V12), so a coin held at the end is a barn card ' +
      'converted for nothing at all. ⚠️ THE SHAPE THE OTHER ARM’S HANDOFF NAMES, PRINTED AS ' +
      'CONTEXT AND NOT AS A VERDICT: "if dead coins exceed about two a player the sinks are ' +
      'too dear". It is section 3.4 of docs/commons-coins-handoff-2026-09-10-v2.md, written ' +
      'about a mint that clears a pile, and this page cannot fail on it. ⭐ Note the ' +
      'countervailing design intent: coins being worthless at game end is what makes the coin ' +
      'game taper naturally, at the cost of an incentive to deliver early, and games already ' +
      'run 23 / 20 / 18 rounds.',
    `⭐ 8. THE POOL IDENTITY, PRINTED SO A LEAK IS LEGIBLE RATHER THAN HUNTED. Minted ` +
      `${t.coins} - spent ${spent} (${t.onBuild} on builds + ${t.coinGrows} on Grows) = ` +
      `${t.coins - spent}, against ${t.dead} actually held at the end ` +
      `(${t.coins - spent === t.dead ? 'exact' : `⛔ OUT BY ${t.coins - spent - t.dead}, WHICH IS A FOLD BUG OR AN UNNAMED DRAIN AND NOT A READING - do not read another line until it is explained`}). ` +
      `And the pool: ${t.supplyLeft} left in the supply + ${t.dead} in wallets = ` +
      `${t.supplyLeft + t.dead}, against ${pool} x seats = ${sum(games.map((g) => pool * g.seats))} ` +
      `dealt (${t.supplyLeft + t.dead === sum(games.map((g) => pool * g.seats)) ? 'exact' : '⛔ OUT, AND V5 SAYS IT CANNOT BE: a spent coin returns to the supply, so the supply plus every wallet is invariant for the whole game'}).`,
    `⚠️ 9. THE OWN-CROP BUILD SHARE: ${pct(allBuilds === 0 ? NaN : ownBuilds / allBuilds)} ` +
      `(${ownBuilds} of ${allBuilds} builds). ⭐ SECTION 3 OF THE DESIGN ARGUES THE COIN IS THE ` +
      'FIRST DEVICE THAT MAKES OFF-CROP BUILDING CHEAP: the Innovation lens’s standing ' +
      'constraint is that the metric axis must not be the specialisation axis, this game pushes ' +
      'on it from two directions (the Farmstead pays 1 VP per own-crop card built, and Powers ' +
      'and Endgame cards cost two cards of their own suit), and a wild that pays a SUIT ' +
      `REQUIREMENT is the first thing proposed that relieves either. ⛔ IT BELONGS TO ` +
      `rules.economy.coinPaysSuitCost, WHICH IS ${coinPaysSuitCost(data)} HERE. ` +
      (coinPaysSuitCost(data)
        ? 'The leaf is on, so this line is the reading. '
        : '⛔ THE LEAF IS OFF, so a flat share here is the ABSENCE of that leaf and not a ' +
          'finding about the coin: the clean pairing is ' +
          'overlays/village-store-coins-wild-only-v1.overlay.json against ' +
          'overlays/village-store-coins-v1.overlay.json. ') +
      '⛔ AND THE STANDING 82.6% TO 83.3% IS A reference-v10-AND-EARLIER LEVEL, over 38,012 ' +
      'builds, so it is context and never a level this run may be compared with. The only ' +
      'sound reading is a paired delta on identical seeds against the named control.',
    `⭐ 10. THE ARC - THE ROUND A SEAT FIRST HELD A COIN: mean ${num(mean(firstRounds), 1)}, ` +
      `median ${num(median(firstRounds), 1)} (${firstRounds.length} of ${t.seatGames} ` +
      `seat-games minted at all; ${neverMinted} NEVER DID, ` +
      `${pct(neverMinted / t.seatGames)}). ⭐ THE MINT IS A RIDER ON A DELIVERY AND NOT AN ` +
      'ACTION, so this is bounded below by the round of a seat’s first delivery: it says when ' +
      'either sink could first open for that seat, and a late one is a seat whose whole coin ' +
      'game happened in the last third. ⚠️ A seat that never minted is counted on its own line ' +
      'rather than folded into the median as a large round, because no economy at all is a ' +
      'different finding from a late one.',
    '⛔ NO FAIL CONDITION ON ANY LINE ABOVE AND NONE WILL BE TAKEN FROM THIS RUN. The design ' +
      'names no number for the mint, either sink, the dead coins or the supply, and the two ' +
      'shapes printed as context belong to the OTHER coin arm. A threshold taken off the run ' +
      'that first measures a quantity is a snapshot test that can never fail (ticket 11 ' +
      'section 2), and this project has been bitten by that shape twice - the cap-of-two ' +
      'lesson of 05/09/2026 and its repeat as commonsThreshold: 2 on 09/09/2026.',
    '⛔ THE INSTRUMENT IS reference-v15 AND THIS IS AN ARM ON TOP OF AN ARM. C100 is open and ' +
      'no Notice Board configuration is ruled in as the shipped game, so the control is only ' +
      'the best-performing configuration measured ' +
      '(overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json, 5 PASS / 1 FAIL / 11 ' +
      'OBSERVE) and not a ruling. No level here is comparable with a reference-v14 or earlier ' +
      'number; a delta paired on identical seeds is sound and a level across a re-cut is not. ' +
      '⚠️ AND THERE IS NO NOISE FLOOR FOR ANY LINE ON THIS PAGE: nothing here is in ' +
      'HEADLINE_METRICS and --noise has never been run against a Store arm.',
    '⚠️ AND EVERY NUMBER HERE IS DOWNSTREAM OF WHAT THE BOTS THINK A COIN IS WORTH. The ' +
      'pricing was measured rather than argued for the other arm on 10/09/2026, and a Store ' +
      'coin is worth MORE than that one because it pays a suit requirement. ⛔ Weights are not ' +
      'overlay-addressable (C45), so moving a coin price is an edit and a rebuild and never an ' +
      'arm: these numbers are the RULES speaking through one pricing, not a taste.',
  ];

  return {
    value,
    headline:
      `THE VILLAGE STORE COIN (A150): ${num(per(t.cards), 2)} barn cards converted and ` +
      `${num(per(t.coins), 2)} coins minted per player per game ` +
      `(${num(t.deliveries === 0 ? NaN : t.cards / t.deliveries, 2)} a delivery); the shared ` +
      `supply of ${pool} a seat held NOTHING on ` +
      `${pct(t.supplyTurns === 0 ? NaN : t.supplyEmptyTurns / t.supplyTurns)} of turns; spent ` +
      `${pct(t.coins === 0 ? NaN : t.onBuild / t.coins)} on builds and ` +
      `${pct(t.coins === 0 ? NaN : t.coinGrows / t.coins)} on Grows, of which ` +
      `${t.coinGrowsOfFull} fired on a FULL building (V9); ${num(per(t.dead), 2)} dead in a ` +
      'wallet at the end, scoring nothing. ⛔ OBSERVE ONLY: the design names no number for any ' +
      'of it, and both shapes printed beside these are the OTHER coin arm’s.',
    detail,
    verdict: 'OBSERVE',
  };
}

/** Kept beside the metrics type so a future reader can see what this file reads. */
export type StoreCoinMetrics = Pick<
  GameMetrics,
  | 'storeCardsConvertedBySeat'
  | 'storeCoinsMintedBySeat'
  | 'storeConvertedByCardSuit'
  | 'coinSupplySampledTurns'
  | 'coinSupplyEmptyTurns'
  | 'coinSupplySum'
  | 'coinSupplyAtEnd'
  | 'coinsSpentBuildBySeat'
  | 'coinBuildsBySeat'
  | 'coinGrowsBySeat'
  | 'coinGrowsBoughtBySeat'
  | 'coinGrowsOfFullBySeat'
  | 'growsBySeat'
  | 'coinsHeldAtEndBySeat'
>;
