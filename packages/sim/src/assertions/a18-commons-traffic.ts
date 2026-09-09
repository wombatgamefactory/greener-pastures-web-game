import { isCommons } from '@gp/data';

import type { Assertion, Measurement } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalTurns } from './lib.js';
import { median, num, pct, sum } from '../stats.js';

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
 * ## No subject under the controls
 *
 * Under `visitCurrency: 'card'` and `'meeple'` there is no commons at all: every
 * counter this reads is a structural zero and the assertion says so rather than
 * printing five zeroes that read as findings.
 */
export const commonsTraffic: Assertion = {
  id: 18,
  title: 'The commons traffic',
  quote:
    'a08-the-hook: no neighbour exists. Under commons it reports "no subject" and a new ' +
    'a18-commons-traffic carries the interaction readings: plays per player per turn, central ' +
    'harvests per player per game, median pile size at harvest, share of barn cards sourced ' +
    'from the centre against own buildings (OBSERVE, with the sentence "if the centre ' +
    'out-supplies the farm, the building engine is decoration" printed beside it), and the ' +
    'fee-suit mix.',
  source:
    'docs/commons-handoff-2026-09-09-v1.md section 2.7 and the measurement plan (section 3), ' +
    'readings 3, 4 and 7; C1, C3 and C5 of section 1',
  shape:
    'Plays per player per turn and per game; central harvests per player per game; the median ' +
    'and p90 pile size at harvest; barn cards from the CENTRE against barn cards off a seat’s ' +
    'own buildings; the fee-suit mix with the off-crop share; and the median size of the whole ' +
    'centre by game third. No subject under visitCurrency "card" or "meeple".',
  threshold:
    'OBSERVE, and there is NO FAIL CONDITION in this pass. The design names no number for any ' +
    'of these readings, the handoff names none, and one taken from the first commons run would ' +
    'be a snapshot test that can never fail (ticket 11 section 2). The one number Dean did set ' +
    'is the PLAY RATE band of 30%-60%, and that belongs to a17: it is repeated in the first ' +
    'line here as context and deliberately carries no verdict, because two assertions failing ' +
    'on one number would report a single finding twice.',
  taste: true,
  remedy:
    `${NO_REMEDY} in this pass - nothing here can fail, so nothing here prescribes. The two ` +
    'arms that move these numbers if a table says they are wrong are ' +
    'overlays/commons-threshold-2.overlay.json (rules.economy.commonsThreshold 2, which caps ' +
    'how fat a pile may get and therefore how big a harvest of the centre can be) and ' +
    'overlays/commons-colour-match-v1.overlay.json (rules.economy.commonsColourMatch true, ' +
    'which stops any card paying for any board and would change the fee-suit mix directly). ' +
    'Both are C10 fallbacks, built and shipped OFF so that the cap is one number away.',
  measure({ data, pooled }) {
    if (!isCommons(data)) return noSubject();
    const games = pooled.ended;
    const turns = totalTurns(games);
    const plays = sum(games.map((g) => sum(g.commonsPlaysBySeat)));
    const seatGames = sum(games.map((g) => g.seats));
    const harvests = sum(games.map((g) => sum(g.commonsHarvestsBySeat)));
    const fromCentre = sum(games.map((g) => sum(g.barnFromCommonsBySeat)));
    const fromOwn = sum(games.map((g) => sum(g.barnFromOwnBySeat)));
    const intoBarn = fromCentre + fromOwn;

    const piles = games.flatMap((g) => g.commonsPileSizeAtHarvest);
    const value = turns === 0 ? NaN : plays / turns;
    const centreShare = intoBarn === 0 ? NaN : fromCentre / intoBarn;

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
          `a median of ${num(median(piles), 1)} cards (p90 ${num(percentile(piles, 0.9), 1)}, ` +
          `max ${piles.length === 0 ? 'n/a' : Math.max(...piles)}). A pile only ever leaves by ` +
          'harvest (D3), so this is the whole of the centre’s outflow.',
        `⭐⭐ THE FARM BYPASS: ${fromCentre} barn cards came out of the CENTRE against ` +
          `${fromOwn} off a seat's OWN buildings (${pct(centreShare)} centre). ` +
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
      ],
      verdict: 'OBSERVE',
    };
  },
};

/** The p-th percentile by nearest rank. Small samples are the norm here, so no interpolation. */
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
