import { hostDrawOnVisit, isNoticeBoardPower } from '@gp/data';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { thirdMedian } from './lib.js';
import { median, num } from '../stats.js';

/**
 * Watch-list 6, and the assertion whose framing has already been corrected once.
 *
 * Ticket 14 raised the island cost to 2/6/9 partly on the argument that a
 * dearer island drains barns. A probe said the opposite: median barn at game
 * end went 5 -> 9 at 2p under the dearer cost, because seats HOARD toward a
 * 9-card Level 3 instead of spending down. So the endpoint is the wrong
 * measurement and the design's own instruction is a series: the 2026-07-14 game
 * stopped before the delivery phase that exists to drain barns, and the answer
 * was "play a full game before designing anything".
 *
 * Hence a within-game comparison, final third against middle third. The claim
 * under test is not "barns are small" - it is "the delivery phase drains them".
 *
 * Ticket 38 then took the measurement further and found the hoard story is also
 * wrong. The barn rises MONOTONICALLY from round one (1 -> 5 -> 9, peak 12), so
 * there is no delivery phase to drain anything: delivery is continuous, taken
 * at a 97.9% rate, and losing to harvest by about half a card a round all game.
 * Both named causes are falsified - switching island.levelGate off leaves this
 * assertion at exactly 4.00, and cutting the chain to 2/4/6 moved it to 3.50.
 * What actually blocks a delivery is assembling NAMED SUITS in exact multiples
 * under an all-or-nothing payment. The window comparison still holds as the
 * shape to test; only the diagnosis behind it has moved.
 */
export const barnGlut: Assertion = {
  id: 6,
  title: 'The barn glut',
  quote:
    'Too much stuff in your barn is a problem, but a hard cap might not be the answer. The ' +
    '2026-07-14 game stopped 3-4 rounds early - before the delivery phase that exists to drain ' +
    'barns. Play a full game before designing anything.',
  source: 'docs/Unified Visit v14.md section 7.6',
  shape:
    'Median barn size across the last third of the game against the middle third - the drain, ' +
    'not the endpoint.',
  threshold: 'FAIL if the final-third median exceeds the middle-third median',
  taste: false,
  remedy:
    `${NO_REMEDY}. The design rules out a hard cap and lists only candidates (a County Show barn ` +
    'sink, wider island appetite, more barn-eating endgame cards). Ticket 38 killed two of them ' +
    'by measurement: appetite is NOT the constraint (the island still wants more than the barns ' +
    'hold, in every suit), and no cardsPerCrate dial will do it either - 88.8% of barn-holding ' +
    'decisions cannot afford any open tile and 84% of those are 1-2 cards short, so the block is ' +
    'MATCHING under an all-or-nothing payment, not quantity. Cutting the chain from 2/6/9 to ' +
    '2/4/6 moved this assertion 4.00 -> 3.50 and it still FAILs. The live levers all change the ' +
    'SHAPE of the payment: partial delivery, more wilds, fewer suits per tile, or a no-matching ' +
    'sink. Doing nothing is also live and unargued.',
  measure({ data, pooled }) {
    const middle = median(
      pooled.ended.map((g) => thirdMedian(g.barnByRound, 'middle')).filter(Number.isFinite),
    );
    const last = median(
      pooled.ended.map((g) => thirdMedian(g.barnByRound, 'last')).filter(Number.isFinite),
    );
    const value = last - middle;
    const bySeat = pooled.bySeats.map((s) => {
      const m = median(
        s.ended.map((g) => thirdMedian(g.barnByRound, 'middle')).filter(Number.isFinite),
      );
      const l = median(
        s.ended.map((g) => thirdMedian(g.barnByRound, 'last')).filter(Number.isFinite),
      );
      return `${s.seats}p ${num(m, 1)} -> ${num(l, 1)}`;
    });
    return {
      value,
      headline: `median barn ${num(middle, 1)} in the middle third, ${num(last, 1)} in the last (${
        value > 0 ? '+' : ''
      }${num(value, 1)})`,
      detail: [
        `by seat count, middle -> last: ${bySeat.join('  ')}`,
        ...(isNoticeBoardPower(data)
          ? [
              '⭐⭐ A TABLE HAS NOW SEEN THIS READING CLEAR ITSELF, AND IT IS THE FIRST TIME IN ' +
                'THIS PROJECT’S HISTORY THAT A HUMAN OBSERVATION CAN BE SET BESIDE THIS NUMBER. ' +
                'Dean played overlays/notice-board-visit-two-boards-v1.overlay.json at a ' +
                'two-player table on 11/09/2026 and reported that a player had a large barn at ' +
                'one stage and "managed to deliver just about all of them". ⚠️ THE ASSERTION ' +
                'FAILS AT ABOUT +0.5 ON EVERY ARM IN THIS FAMILY, so read the failure against ' +
                'that observation rather than in isolation: the shape under test is not "barns ' +
                'are small", it is "the delivery phase drains them", and a table has now watched ' +
                'one drain. ⛔ ONE SESSION IS NOT A MEASUREMENT AND DOES NOT RETIRE THE FAILURE ' +
                '- it is one table, at one seat count, on one arm - but a metric that fails ' +
                'where the table does not is a metric to re-read before it is a design problem ' +
                'to fix.',
              hostDrawOnVisit(data) > 0
                ? '⚠️ AND S17 THE HOST DRAW IS ON (rules.turn.hostDrawOnVisit ' +
                  `${hostDrawOnVisit(data)}), WHICH POINTS AT THIS READING FROM BOTH SIDES AT ` +
                  'ONCE: every visit now adds a card to the game, and more cards in hand is more ' +
                  'cards reaching a barn as well as more cards to pay a delivery with. Whether ' +
                  'that DRAINS the barn or FEEDS it is exactly what the pair answers, and the ' +
                  'pair is overlays/notice-board-visit-two-boards-v1.overlay.json, ONE LEAF ' +
                  'away, on identical seeds. a21-host-draw carries the faucet.'
                : '⚠️ S17 THE HOST DRAW IS OFF ON THIS RUN, so this is the column the arm is ' +
                  'read against. The arm is overlays/notice-board-visit-host-draw-v1.overlay.json ' +
                  'and it adds a card to the game on every visit, which may drain this barn or ' +
                  'feed it; the pair on identical seeds is the only thing that can say which.',
            ]
          : []),
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 0 ? 'FAIL' : 'PASS',
    };
  },
};
