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
 * The three exotic payments are the same mechanism with a different chip. D8
 * pays from the BARN, which the view anonymises even to its owner, so the chip
 * is a suit and a count rather than a card. D7 spends coins AS cards. Both only
 * ever appear when a candidate offers them, so a plain Build shows neither.
 */

import type { GameData, Suit } from '@gp/data';

import type { Play } from '../session/play';
import { buildAdditions, buildCandidates, buildComplete } from '../view/intent';
import type { BuildDraft } from '../view/intent';
import { printedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { cardName } from '../view/moveText';
import { Card } from './Card';
import { withPayment } from '../view/intent';

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
  const barnTotal = Object.values(draft.barn).reduce((a: number, b) => a + (b ?? 0), 0);

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
          {(Object.entries(draft.barn) as [Suit, number][]).map(([suit, n]) => (
            <button
              key={suit}
              className="chip chip-paid"
              onClick={() => play.payWithBarn(suit, -1)}
              title="take it back"
            >
              {n} {SUIT_META[suit].label} from the barn <span aria-hidden="true">x</span>
            </button>
          ))}
          {draft.coinWild > 0 && (
            <span className="chip chip-paid">£{draft.coinWild} standing in for cards</span>
          )}
          {draft.payment.length + barnTotal + draft.coinWild === 0 && (
            <span className="chip chip-empty">nothing paid yet</span>
          )}
        </div>

        {additions.barn.size > 0 && (
          <div className="chips">
            <span className="chips-label">from the barn:</span>
            {[...additions.barn].map((suit) => (
              <button key={suit} className="chip" onClick={() => play.payWithBarn(suit, 1)}>
                + {SUIT_META[suit].label}
              </button>
            ))}
          </div>
        )}

        {additions.coins && (
          <div className="chips">
            <span className="chips-label">coins as cards:</span>
            <button
              className="chip"
              onClick={() => play.setDraft({ ...draft, coinWild: draft.coinWild + 1 })}
            >
              + £1
            </button>
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
