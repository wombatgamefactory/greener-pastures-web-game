import { isMeepleCurrency } from '@gp/data';

import type { Assertion } from './types.js';
import { num, pct, sum } from '../stats.js';

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
 *
 * ## RE-CUT FOR THE MEEPLE-LOOP ARM (04/09/2026): THE COLOUR BOUGHT, AND THE WILD
 *
 * Under `rules.turn.visitCurrency: 'meeple'` a door is bought with a MEEPLE of
 * that colour placed in a neighbour's slot, so the question the mix answers
 * shifts underneath the same arithmetic. It used to be "which farm does the
 * table tramp to", because a board offered its owner's suit and nothing else.
 * It is now "which of the five ACTIONS does the table buy", because every board
 * offers all five colours and what you take is decided by the meeple you spend.
 * The 35% band is carried unchanged as the line between a magnet and a monopoly,
 * which is a claim about the ACTIONS being worth roughly comparable amounts and
 * is the same claim under either arm.
 *
 * ⭐ A WILD SPEND COUNTS UNDER THE COLOUR BOUGHT, NOT UNDER EITHER MEEPLE SPENT
 * (R10). Two meeples of colours you hold buy one action of a colour you do not,
 * and both land in the bought colour's slot, so the door that was used is the
 * door bought and the mix must say so. Counting a wild under its components
 * would credit traffic to doors nobody walked through.
 *
 * ⭐ AND THE WILD SHARE OF ALL SPENDS IS REPORTED SEPARATELY, because it decides
 * an open design question rather than a balance one (handoff sections 5 and 8):
 * under about a fifth and the colour keying is doing work, over about half and
 * the slots should probably be five unkeyed spaces instead. That is Dean's
 * ruling to make and the number is REPORTED, never judged - it carries no
 * verdict here and no threshold is invented for it.
 *
 * ⛔ THE ORCHARD DOOR IS PLAIN DRAW 2 UNDER THE ARM (R2), not Draw 3. The one
 * printed exception in the set existed because a visit cost a card and a Draw 2
 * door therefore handed back exactly what the free Draw 1 gave for nothing; a
 * visit costs no card here, so the self-cancellation reason is gone and the
 * exception goes with it. Expect Orchard LOWER than the control's 31%, and read
 * a fall as the exception being removed rather than as the door being unpopular.
 *
 * ⚠️ THE ROUTE SPLIT COLLAPSES TO ONE ROUTE. Self-visits are impossible (X5) and
 * the turn-start meeple spend is deleted (R8), so every door use under the arm
 * arrives by a rival visit and the rival / self / meeple line reads as a
 * tautology. It is still printed, because a non-zero self or meeple column would
 * be an engine bug and a printed zero is how anybody would notice.
 *
 * ⚠️ THE APIARY CAVEAT BELOW SURVIVES THE ARM UNCHANGED. Sow is still from
 * hand, the pricer still cannot see the second card, and the arm does not
 * pretend to fix the two card-spending doors - see assertion 15's dead-colour
 * line, which is the same problem seen from the meeple side.
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
    'on the table knowingly. [04/09/2026, the meeple loop] By colour; a wild spend counts under ' +
    'the colour BOUGHT and is also reported separately as the wild share of all spends. The ' +
    'Orchard door is plain Draw 2 under the arm: the self-cancellation reason for Draw 3 was ' +
    'that a visit cost a card, and it no longer does.',
  source:
    'docs/Unified Visit v14.md section 7.5 (as the Draw Worker), ' +
    'docs/design-changes-v31-2026-09-02-v1.md sections 1.2 and 4 (as the five doors), and ' +
    'docs/meeple-loop-visit-handoff-2026-09-04-v1.md sections 2, 4 and 5 (as the five colours)',
  shape:
    "The busiest door's share of all door uses, against an even 20%. Every route counted - a " +
    "rival's visit, a self-visit and a meeple all take the same door. Under visitCurrency " +
    '"meeple" a wild spend counts under the colour BOUGHT, and the wild share of all spends is ' +
    'reported separately.',
  threshold:
    `FAIL above ${pct(MONOPOLY, 0)} for any one colour, under either arm - it is a claim about ` +
    'the five ACTIONS being worth roughly comparable amounts, and that claim does not depend on ' +
    'what buys them. The WILD SHARE carries no threshold and never will: what it decides is ' +
    'colour-keyed slots against five unkeyed spaces, which is an open question for Dean ' +
    '(handoff section 8) and not a balance band. It is reported and not judged.',
  taste: false,
  remedy:
    'Under visitCurrency "card": ' +
    'npm run sim -- --watchlist --overlay=overlays/orchard-door-draw-two-v1.overlay.json   ' +
    '(the paired control for the one printed exception: the Orchard door made plain at Draw 2. ' +
    'The dial in the other direction is rules.turn.bonusDraw, NOT the door - raising the free ' +
    'draw to 2 kills the Orchard door at 3 by the same argument and kills the other four with ' +
    'it.) Under "meeple" the Orchard door is ALREADY plain Draw 2, so that overlay has nothing ' +
    'left to test; the paired arm in the other direction is ' +
    'overlays/meeple-loop-orchard-draw-three-v1.overlay.json, which restores Draw 3 as a ' +
    'control on whether the exception was ever about the card at all.',
  measure({ data, pooled }) {
    const arm = isMeepleCurrency(data);
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

    // THE WILD SHARE, of SPENDS rather than of door uses. The denominator is
    // visits and not `total`, because a wild pair is one visit buying one door
    // and the question - is the colour keying doing work - is asked of the
    // choices a player made, not of the actions that resulted.
    const wild = sum(pooled.ended.map((g) => sum(g.wildVisitsBySeat)));
    const spends = sum(pooled.ended.map((g) => sum(g.visitsBySeat)));

    const armDetail = arm
      ? [
          `⭐ THE WILD SHARE OF ALL SPENDS: ${wild} of ${spends} visits ` +
            `(${pct(spends === 0 ? NaN : wild / spends)}) were paid with a PAIR of meeples ` +
            'bought as one of another colour (R10), counted above under the colour BOUGHT. ' +
            'REPORTED, NOT JUDGED: under about a fifth the colour keying is doing work, over ' +
            'about half the slots should probably be five unkeyed spaces - and which of those ' +
            'is Dean’s ruling (handoff section 8), not a band this assertion may set.',
          '⛔ THE ORCHARD DOOR IS PLAIN DRAW 2 UNDER THIS ARM (R2). Draw 3 existed because a ' +
            'visit cost a card, so a Draw 2 door handed back exactly what the free Draw 1 gave ' +
            'for nothing; a visit costs no card here. Expect Orchard BELOW the control’s 31% ' +
            'and read the fall as the exception being removed, not as the door being unwanted.',
          '⚠️ THE ROUTE SPLIT ABOVE IS A TAUTOLOGY UNDER THIS ARM: every door use arrives by a ' +
            'rival visit, because X5 forbids the self-visit and R8 deletes the turn-start ' +
            'meeple spend. It is printed anyway - a non-zero self or meeple column would be an ' +
            'engine bug, and a printed zero is how anybody would notice.',
        ]
      : [];

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
        ...armDetail,
        '⚠️ DO NOT TRUST THE APIARY ROW. A sow from hand and a sow from a deck top emit the ' +
          'same event, so the pricer never charges the visitor the SECOND card the Apiary door ' +
          'costs. The design says that door should be the weakest here by some distance; if it ' +
          'reads as normal, that is the instrument.',
        arm
          ? 'The band is the line between a magnet and a monopoly, not a claim that the doors ' +
            'should be even - but the reason Orchard was EXPECTED to lead is gone under this ' +
            'arm, because its Draw 3 exception is gone. A colour leading here now leads on its ' +
            'own merits.'
          : 'The Orchard door is Draw 3 by design and is expected to lead. The band is the line ' +
            'between a magnet and a monopoly, not a claim that the doors should be even.',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > MONOPOLY ? 'FAIL' : 'PASS',
    };
  },
};
