/**
 * The gloss block: the half of the reading region that earns its width.
 *
 * The region was paid for by shrinking every other card on the screen. A bigger
 * picture of the same card was never worth that, and the research says why: Race
 * for the Galaxy's win was not the zoom, it was that a tap gives you the icon's
 * meaning in plain English. This is that tap.
 *
 * It sits UNDER the card and never repeats it. Three parts, in the order a
 * player needs them:
 *
 *   1. the keywords, expanded once each - GROW, SOW and VISIT are load-bearing
 *      and a new player has met none of them
 *   2. the cost, in words rather than a row of icons
 *   3. what you could do with it right now, off the live position
 *
 * The second face of an upgradable starter is folded in at the bottom rather
 * than left as the free-floating `zoom-other` paragraph it used to be. That
 * paragraph placed itself, and at 1366 "placing itself" meant printing across
 * the bottom of the card art; inside this block it is one more line in a column
 * that already knows how to run out of room.
 *
 * WHAT IT WILL NOT DO. Part 3 is the only text on this screen a player will act
 * on without checking it, so it is silent wherever it cannot be certain: no
 * `play` means no part 3 at all (the read-only render path and the rival
 * inspector both take that branch), and an unexplainable "no" is printed as a
 * plain "not yet" with no reason attached. A wrong reason is worse than none.
 */

import { Fragment } from 'react';
import type { GameData } from '@gp/data';

import type { Play } from '../session/play';
import { glossAbility, glossCost, glossNow } from '../view/moveText';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';

export function Reading({
  data,
  id,
  upgraded,
  play,
}: {
  data: GameData;
  id: string;
  upgraded: boolean;
  /** Absent on the read-only render path and in the rival inspector. */
  play?: Play | undefined;
}) {
  /*
   * A MASKED ID NAMES NO CARD. `W?` is a card whose crop is public and whose
   * identity is not - a rival's in-flight draw reveal, a card in limbo on its
   * way to a discard. `useZoom` already refuses to show one, so this branch is
   * belt and braces rather than a live path; it exists because the alternative
   * is `printedFace` throwing, and a white screen is a poor way to learn that
   * some surface started feeding masked ids to the region.
   */
  if (id.endsWith('?')) {
    const suit = data.cards.suits.find((s) => s.charAt(0).toUpperCase() === id.charAt(0));
    return (
      <div className="reading-gloss">
        <p className="gloss-masked">
          {suit ? `A ${SUIT_META[suit].label} card.` : 'A card.'} Its crop is public; which card it
          is stays hidden until it is played.
        </p>
      </div>
    );
  }

  const card = data.cards.catalogue.find((c) => c.id === id);
  if (!card) return null;

  const face = printedFace(data, id, upgraded);
  const other = card.faces ? printedFace(data, id, !upgraded) : null;

  const terms = glossAbility(data, face.abilityText);
  const cost = glossCost(data, face);
  const now = play ? glossNow(data, face, play.view, play.moves, play.active) : [];

  return (
    <div className="reading-gloss">
      {terms.length > 0 && (
        <dl className="gloss-terms">
          {terms.map((t) => (
            <Fragment key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.means}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {cost.length > 0 && (
        <ul className="gloss-cost">
          {cost.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {now.length > 0 && (
        <ul className="gloss-now">
          {now.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {other && (
        <p className="gloss-face">
          <b>
            {other.upgraded ? 'Upgraded' : 'Base'} face, {other.name}:
          </b>{' '}
          {other.abilityText}
        </p>
      )}
    </div>
  );
}
