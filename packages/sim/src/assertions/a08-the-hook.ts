import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { totalBonusTurns, totalTurns, visitsPerTurnBySuit } from './lib.js';
import { num, pct, sum } from '../stats.js';

/**
 * Watch-list 8: the cross-farm circuit versus solitaire test, made numeric.
 * The assertion that matters most, and the one with no remedy - because this
 * one IS the design. A failure here is not a knob to turn.
 *
 * ⭐⭐ THE ONE THING THIS ASSERTION MUST GET RIGHT IN v31, AND THE REASON IT
 * WAS REWRITTEN ON 02/09/2026: **A SELF-VISIT IS NOT INTERACTION.**
 *
 * v31 lets a seat place its bonus card on its OWN Notice Board and take its own
 * suit's action. That is a solitaire door bought with the interaction door's
 * own currency, sitting in the same slot, and every previous version of this
 * game has had the solitaire option crowd the visit out when the two competed
 * for one slot. The plan (risk 2) states the failure mode in as many words: an
 * assertion that pools the two "will report a healthy hook while the table
 * plays solitaire". So the value this assertion returns, and the number its
 * threshold is read against, is NEIGHBOUR visits per turn and nothing else. The
 * self-visit share is printed beside it as the counterweight, never added to
 * it.
 *
 * The threshold comes straight out of the clock the design describes: base
 * Draw nets spare cards, and a spare card funds one visit a turn. Half of the
 * design's own intended rate is the floor; below it the spare card is going
 * somewhere other than a neighbour's farm.
 *
 * ⚠️ THE FLOOR IS CARRIED FROM v14 AND THE CLOCK UNDER IT HAS LOOSENED. Draw is
 * now 2-keep-2 and the bonus slot offers a free Draw 1, so cards are more
 * plentiful than they were when 0.5 was set, and a fixed floor gets EASIER to
 * clear as the card supply loosens. Read a bare pass here with that in mind:
 * the number to watch is the neighbour share against the self share, which is
 * scale-free, rather than the absolute rate against a floor set under a
 * tighter clock.
 *
 * Ticket 10's control applies here and must be read as intended: a HERMIT
 * MIRROR SHOULD FAIL THIS. Four bots with prohibitive visit weight visit nobody
 * and the run correctly reports solitaire. That is the proof the assertion has
 * teeth, not a bug to chase - which is why this one reports the mirror spread.
 */
export const theHook: Assertion = {
  id: 8,
  title: 'The hook',
  quote:
    "You can't run your farm alone - your neighbours power your engine, so the whole island " +
    'competes to be the farm everyone needs. [02/09/2026, risk 2] Self-visiting is a SOLITAIRE ' +
    'door bought with the same currency as the interaction door. a08-the-hook must count ' +
    'self-visits separately, or the assertion will report a healthy hook while the table plays ' +
    'solitaire.',
  source:
    'CLAUDE.md (the hook, and the clock); docs/design-changes-v31-2026-09-02-v1.md part 4, risk 2',
  shape:
    'NEIGHBOUR visits per player per turn - self-visits excluded from the value and printed ' +
    'beside it; share of turns using the bonus slot; own-crop against foreign-crop builds.',
  threshold:
    "FAIL if NEIGHBOUR visits per turn fall below 0.5 - half the design's own stated rate of " +
    'one. A self-visit never counts toward it.',
  taste: true,
  remedy:
    `${NO_REMEDY} - this one is the design. The nearest thing to a lever is ` +
    'rules.turn.selfVisitAllowed: setting it false restores the v30 rule that a visit is always ' +
    "somebody else's board, and it is the paired control for risk 2 rather than a fix.",
  measure({ pooled }) {
    const games = pooled.ended;
    const turns = totalTurns(games);
    const all = sum(games.map((g) => sum(g.visitsBySeat)));
    const selves = sum(games.map((g) => sum(g.selfVisitsBySeat)));
    const neighbours = all - selves;
    const bonus = totalBonusTurns(games);
    const own = sum(games.map((g) => sum(g.ownCropBuildsBySeat)));
    const foreign = sum(games.map((g) => sum(g.foreignCropBuildsBySeat)));
    const value = turns === 0 ? NaN : neighbours / turns;
    return {
      value,
      headline:
        `${num(value, 2)} NEIGHBOUR visits per player per turn ` +
        `(${neighbours} of ${all} visits over ${turns} turns)`,
      detail: [
        `⭐ SELF-VISITS, COUNTED APART AND NEVER CREDITED: ${selves} of ${all} visits ` +
          `(${pct(all === 0 ? NaN : selves / all)} of all visits, ` +
          `${num(turns === 0 ? NaN : selves / turns, 2)} per turn). A self-visit is a ` +
          'solitaire door bought with the interaction door’s currency. If this share ' +
          'climbs while the neighbour line falls, risk 2 has landed and the fix named in the ' +
          'design is rules.turn.selfVisitAllowed false or a sharper clog brake.',
        `bonus slot used on ${pct(turns === 0 ? NaN : bonus / turns)} of turns`,
        // Per suit, because the table average cannot answer a per-suit question
        // and every suit change asks one: does this engine pull its player away
        // from their neighbours? Reported, not judged - the threshold above is
        // the table's, and a suit below it is a thing to look at, not a failure.
        `NEIGHBOUR visits per turn by suit: ${[...visitsPerTurnBySuit(games)]
          .sort((a, b) => b[1] - a[1])
          .map(([suit, rate]) => `${suit} ${num(rate, 2)}`)
          .join('  ')}`,
        `builds: ${pct(own + foreign === 0 ? NaN : own / (own + foreign))} own crop, ` +
          `${pct(own + foreign === 0 ? NaN : foreign / (own + foreign))} foreign crop ` +
          `(${own + foreign} builds). ⚠️ RISK 3, the monoculture pull: the Farmstead pays 1 VP ` +
          'per own-suit card built and every Power and Endgame card costs 2 cards of its own ' +
          'suit, so both push this the same way. It was 82.6% before v31 and can only go up; ' +
          'neither pull is a knob, so undoing either is a card change.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < 0.5 ? 'FAIL' : 'PASS',
    };
  },
};
