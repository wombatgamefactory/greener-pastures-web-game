import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns, totalVisits } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * Watch-list 8: the cross-farm circuit versus solitaire test, made numeric.
 * The assertion that matters most, and the one with no remedy - because this
 * one IS the design. A failure here is not a knob to turn.
 *
 * The threshold comes straight out of the clock the design describes: base
 * Draw nets +1 card a turn, and that card funds exactly one visit a turn. Half
 * of the design's own intended rate is the floor; below it the spare card is
 * going somewhere other than a neighbour's farm.
 *
 * Ticket 10's control applies here and must be read as intended: a HERMIT
 * MIRROR SHOULD FAIL THIS. Four bots with prohibitive visit weight mint nothing
 * and the run correctly reports solitaire. That is the proof the assertion has
 * teeth, not a bug to chase - which is why this one reports the mirror spread.
 */
export const theHook: Assertion = {
  id: 8,
  title: 'The hook',
  quote:
    "You can't run your farm alone - your neighbours power your engine. Every turn you convert " +
    '1 spare card into either £1 or a second action ... funding exactly one visit per turn. ' +
    "Soft metric that decides it: did players watch each other's turns, and was there table talk?",
  source: 'CLAUDE.md (the hook, and the clock), docs/Unified Visit v14.md section 7.7',
  shape:
    'Visits per player per turn; share of turns using the bonus slot; own-crop against ' +
    'foreign-crop builds.',
  threshold: "FAIL if visits per turn fall below 0.5 - half the design's own stated rate of one",
  taste: true,
  remedy: `${NO_REMEDY} - this one is the design.`,
  measure({ pooled }) {
    const games = pooled.ended;
    const turns = totalTurns(games);
    const visits = totalVisits(games);
    const bonus = totalBonusTurns(games);
    const own = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
    const foreign = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
    const value = turns === 0 ? NaN : visits / turns;
    return {
      value,
      headline: `${num(value, 2)} visits per player per turn (${visits} visits over ${turns} turns)`,
      detail: [
        `bonus slot used on ${pct(turns === 0 ? NaN : bonus / turns)} of turns`,
        `builds: ${pct(own + foreign === 0 ? NaN : own / (own + foreign))} own crop, ` +
          `${pct(own + foreign === 0 ? NaN : foreign / (own + foreign))} foreign crop ` +
          `(${own + foreign} builds)`,
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < 0.5 ? 'FAIL' : 'PASS',
    };
  },
};
