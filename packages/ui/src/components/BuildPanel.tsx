/**
 * Assembling a Build.
 *
 * Build is the widest option family in the game - one enumerated move per way
 * to pay, which is `C(hand, k)` before Dairy's modifiers multiply it - so the
 * enumeration is a validator, not a menu (ticket 23 said it of the visit; it is
 * truer here). The panel narrows instead: name the card, then add payment one
 * click at a time, with the surviving candidates deciding what is still
 * addable. The move that finally goes to the engine is one the engine offered,
 * not one this file built.
 *
 * The one exotic payment is the same mechanism with a different chip: D7 The
 * Versatile Shed pays with cards off the player's OWN BUILDINGS. It replaced two
 * that were harder to draw (2026-08-10) - a per-suit tally from the barn, which
 * the view anonymises even to its owner, and coins standing in for cards - and it
 * is easier than either, because a stack is public and ordered so a stack card is
 * a card like any other. It only ever appears when a candidate offers it, so a
 * plain Build shows a hand and nothing else.
 */

import type { GameData } from '@gp/data';

import type { Play } from '../session/play';
import { buildAdditions, buildCandidates, buildComplete } from '../view/intent';
import type { BuildDraft } from '../view/intent';
import { printedFace } from '../view/printed';
import { cardName } from '../view/moveText';
import { Card } from './Card';
import { withPayment, withStackPayment } from '../view/intent';

export function BuildPanel({
  data,
  play,
  draft,
  cardWidth = 120,
}: {
  data: GameData;
  play: Play;
  draft: BuildDraft;
  cardWidth?: number;
}) {
  const additions = buildAdditions(play.moves, draft);
  const complete = buildComplete(play.moves, draft);
  const candidates = buildCandidates(play.moves, draft);

  const owed =
    additions.remaining.min === additions.remaining.max
      ? `${additions.remaining.min}`
      : `${additions.remaining.min}-${additions.remaining.max}`;

  return (
    <section className="assembly" aria-label="build a card">
      <div className="assembly-subject">
        <Card face={printedFace(data, draft.card)} width={cardWidth} />
      </div>

      <div className="assembly-body">
        <h3>Build {cardName(data, draft.card)}</h3>
        <p className="assembly-hint">
          {candidates.length === 0
            ? 'That payment cannot be finished. Take a card back off.'
            : additions.remaining.max === 0
              ? 'Paid. Confirm to build it.'
              : `Click cards in your hand to pay. ${owed} more to find.`}
        </p>

        <div className="chips">
          {draft.payment.map((card) => (
            <button
              key={card}
              className="chip chip-paid"
              onClick={() => play.setDraft(withPayment(draft, card))}
              title="take it back"
            >
              {cardName(data, card)} <span aria-hidden="true">x</span>
            </button>
          ))}
          {draft.stacks.map((card) => (
            <button
              key={card}
              className="chip chip-paid"
              onClick={() => play.setDraft(withStackPayment(draft, card))}
              title="put it back on the building"
            >
              {cardName(data, card)} (off a building) <span aria-hidden="true">x</span>
            </button>
          ))}
          {draft.payment.length + draft.stacks.length === 0 && (
            <span className="chip chip-empty">nothing paid yet</span>
          )}
        </div>

        {additions.stacks.size > 0 && (
          <div className="chips">
            <span className="chips-label">off your buildings:</span>
            {[...additions.stacks].map((card) => (
              <button
                key={card}
                className="chip"
                onClick={() => play.setDraft(withStackPayment(draft, card))}
              >
                + {cardName(data, card)}
              </button>
            ))}
          </div>
        )}

        <div className="assembly-actions">
          <button
            className="primary"
            disabled={!complete}
            onClick={() => complete && play.send(complete.move)}
          >
            Build it
          </button>
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
        </div>
      </div>
    </section>
  );
}
