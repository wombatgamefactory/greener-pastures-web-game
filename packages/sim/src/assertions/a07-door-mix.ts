import type { Assertion } from './types.js';
import { num, pct } from '../stats.js';

/**
 * Watch-list 7, RE-POINTED FOR v31 (02/09/2026) and renamed with the thing it
 * measures.
 *
 * It was `a07-draw-worker`: the Draw Worker's share of all rival Worker uses,
 * against an even fifth, failing above 35%. The Worker was the design's named
 * traffic magnet - "exactly the scene we want: everyone tramping to one farm" -
 * and the only one that refunded its own fee, so it had no natural brake and
 * the dial was its track length. Last read on reference-v9: FAIL at 35.6%
 * (draw 36% / build 24% / deliver 18% / sow 12% / harvest 10%).
 *
 * There is no Worker, no track and no fee refund. What replaced all of it is
 * FIVE DOORS, one per suit, each granting that suit's plain action, and the
 * question survives the mechanism intact: does the table tramp to one farm, and
 * is that charming or oppressive? So this is the DOOR MIX - every door use, by
 * the door's colour, against an even fifth - and it counts all three routes to
 * a door, because a meeple of a colour does exactly what that colour's door
 * does.
 *
 * THE ORCHARD DOOR IS THE MAGNET BY CONSTRUCTION and that is not the failure.
 * It is the one printed exception in the set: Draw 3 where plain would be Draw
 * 2, ruled that way because a Draw 2 door hands back 2 cards for the 1 you
 * place on it, which is exactly what the free Draw 1 gives for nothing - a rule
 * worth precisely its own alternative is a rule nobody takes. So Orchard is
 * expected high; the 35% band is carried over from the Draw Worker unchanged,
 * as the line between a magnet and a monopoly.
 *
 * ⚠️⚠️ THE APIARY READING IS THE ONE NOT TO TRUST, AND IT IS A PRICER DEFECT.
 * The v31 plan says outright that the Apiary door should be the WEAKEST on the
 * table by some distance: it is Sow 1 FROM YOUR HAND, so a visitor pays 2 cards
 * for 1 threshold step, which is the self-cancellation problem in its purest
 * form. The bots cannot see that. A sow from hand and a sow from a deck top
 * emit the same event, so the pricer never charges the visitor the second card.
 * IF THIS TABLE SAYS THE APIARY BOARD TAKES NORMAL TRAFFIC, THAT IS THE PRICER
 * TALKING AND NOT THE GAME. The design's own remedy if a table confirms it is
 * to move the sown card back to a deck top, not to make the door cheaper.
 */
const MONOPOLY = 0.35;

export const doorMix: Assertion = {
  id: 7,
  title: 'The door mix',
  quote:
    'Cheapest door to visit -> most traffic -> everyone tramping to one farm. That is exactly ' +
    "the scene we want; check it's charming, not oppressive. [02/09/2026] The Orchard door is " +
    'Draw 3 and not Draw 2 on purpose, because a plain Draw 2 door is worth exactly the free ' +
    'Draw 1 it competes with. The Apiary door is Sow 1 from your hand and was ruled the weakest ' +
    'on the table knowingly.',
  source:
    'docs/Unified Visit v14.md section 7.5 (as the Draw Worker) and ' +
    'docs/design-changes-v31-2026-09-02-v1.md sections 1.2 and 4 (as the five doors)',
  shape:
    "The busiest door's share of all door uses, against an even 20%. Every route counted - a " +
    "rival's visit, a self-visit and a meeple all take the same door.",
  threshold: `FAIL above ${pct(MONOPOLY, 0)} for any one colour`,
  taste: false,
  remedy:
    'npm run sim -- --watchlist --overlay=overlays/orchard-door-draw-two-v1.overlay.json   ' +
    '(the paired control for the one printed exception: the Orchard door made plain at Draw 2. ' +
    'The dial in the other direction is rules.turn.bonusDraw, NOT the door - raising the free ' +
    'draw to 2 kills the Orchard door at 3 by the same argument and kills the other four with ' +
    'it.)',
  measure({ pooled }) {
    const uses = new Map<string, number>();
    const neighbour = new Map<string, number>();
    const self = new Map<string, number>();
    const meeple = new Map<string, number>();
    const add = (m: Map<string, number>, table: Record<string, number>) => {
      for (const [colour, n] of Object.entries(table)) m.set(colour, (m.get(colour) ?? 0) + n);
    };
    for (const g of pooled.ended) {
      add(uses, g.doorUsesByColour);
      add(neighbour, g.neighbourDoorByColour);
      add(self, g.selfDoorByColour);
      add(meeple, g.meepleDoorByColour);
    }
    const total = [...uses.values()].reduce((a, b) => a + b, 0);
    const ranked = [...uses.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const value = total === 0 || top === undefined ? NaN : top[1] / total;
    const share = (n: number) => pct(total === 0 ? NaN : n / total, 0);

    return {
      value,
      headline:
        `${top?.[0] ?? 'no'} door takes ${pct(value)} of ${total} door uses (even share 20%)` +
        `; all colours: ${ranked.map(([c, n]) => `${c} ${share(n)}`).join('  ')}`,
      detail: [
        `by route: ${ranked
          .map(
            ([colour]) =>
              `${colour} rival ${neighbour.get(colour) ?? 0} / self ${self.get(colour) ?? 0}` +
              ` / meeple ${meeple.get(colour) ?? 0}`,
          )
          .join('   ')}`,
        `door uses per ended game: ${num(
          pooled.ended.length === 0 ? NaN : total / pooled.ended.length,
          2,
        )}`,
        '⚠️ DO NOT TRUST THE APIARY ROW. A sow from hand and a sow from a deck top emit the ' +
          'same event, so the pricer never charges the visitor the SECOND card the Apiary door ' +
          'costs. The design says that door should be the weakest here by some distance; if it ' +
          'reads as normal, that is the instrument.',
        'The Orchard door is Draw 3 by design and is expected to lead. The band is the line ' +
          'between a magnet and a monopoly, not a claim that the doors should be even.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > MONOPOLY ? 'FAIL' : 'PASS',
    };
  },
};
