/**
 * Assembling a Build - and, since 18/09/2026 (2.5.1, 2.5.2), assembling a
 * Deliver. Both live here because they are the same mechanism with a
 * different chip: name the subject (a card, or a tile), then add payment one
 * click at a time, with the surviving candidates deciding what is still
 * addable. The move that finally goes to the engine is one the engine
 * offered, not one this file built.
 *
 * Build is the widest option family in the game - one enumerated move per way
 * to pay, which is `C(hand, k)` before Dairy's modifiers multiply it - so the
 * enumeration is a validator, not a menu (ticket 23 said it of the visit; it is
 * truer here). The panel narrows instead: name the card, then add payment one
 * click at a time, with the surviving candidates deciding what is still
 * addable.
 *
 * The one exotic payment is the same mechanism with a different chip: D7 The
 * Versatile Shed pays with cards off the player's OWN BUILDINGS. It replaced two
 * that were harder to draw (2026-08-10) - a per-suit tally from the barn, which
 * the view anonymises even to its owner, and coins standing in for cards - and it
 * is easier than either, because a stack is public and ordered so a stack card is
 * a card like any other. It only ever appears when a candidate offers it, so a
 * plain Build shows a hand and nothing else.
 *
 * `DeliverPanel`, below, is the same narrowing idea applied to a delivery: a
 * TOKEN (when the tile still offers a choice) and a crop-count payment, never
 * a card id - a barn's identity is inert (`deliver.ts`, the engine), so the
 * chips are "+1 wheat" rather than a specific card. That is also why the
 * any-crop relaxation (a second delivery's two loose cards, the Vegetable
 * board's two) needs no special UI: `deliverAdditions` already only offers a
 * suit the surviving candidates could still pay with, wildcards included.
 */

import type { GameData, Suit } from '@gp/data';

import type { Play } from '../session/play';
import {
  buildAdditions,
  buildCandidates,
  buildComplete,
  deliverAdditions,
  deliverCandidates,
  deliverComplete,
  withDeliverCard,
  withDeliverToken,
  withoutDeliverCard,
} from '../view/intent';
import type { BuildDraft, DeliverDraft } from '../view/intent';
import { printedFace } from '../view/printed';
import { cardName, spendText } from '../view/moveText';
import { SUIT_META } from '../view/suits';
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

/**
 * Assembling a Deliver (2.5.1, 2.5.2). See the module doc above for why this
 * sits beside `BuildPanel` rather than in its own file: same narrowing idea,
 * a crop-count chip standing in for the card-id chip a build payment uses.
 *
 * A PLACEHOLDER STRING, FLAGGED FOR THE WORDING PASS: "which token" / "from
 * your barn" / "Deliver it" below are plain and functional, not polished
 * copy - this file does the click routing, not the prose.
 */
export function DeliverPanel({ play, draft }: { play: Play; draft: DeliverDraft }) {
  const additions = deliverAdditions(play.moves, draft);
  const complete = deliverComplete(play.moves, draft);
  const candidates = deliverCandidates(play.moves, draft);
  const tile = play.view.island.tiles.find((t) => t.tile === draft.tile);

  const owed =
    additions.remaining.min === additions.remaining.max
      ? `${additions.remaining.min}`
      : `${additions.remaining.min}-${additions.remaining.max}`;

  return (
    <section className="assembly assembly-deliver" aria-label={`deliver to island ${draft.tile}`}>
      <div className="assembly-body">
        <h3>Deliver to island {draft.tile}</h3>

        {/*
         * ⭐ THE TOKEN PICKER (2.5.1). Only shown when the tile still offers a
         * choice - a second delivery leaves one token, so `additions.tokens`
         * comes back with exactly one and there is nothing to ask. This is the
         * click the bots cannot make (§0 of CLAUDE.md: they take the
         * higher-VP token on every first delivery), so a human choosing the
         * lower-VP, Worker-carrying token is the one trade this panel exists
         * to make real.
         */}
        {additions.tokens.length > 1 && (
          <div className="chips">
            <span className="chips-label">which token:</span>
            {additions.tokens.map((t) => {
              const token = tile?.tokens[t];
              const label = token
                ? `${token.demand === 'wild' ? 'any crop' : SUIT_META[token.demand].label}, ${token.vp} VP${token.worker ? ' + a Worker' : ''}`
                : `token ${t}`;
              return (
                <button
                  key={t}
                  type="button"
                  className={`chip${draft.token === t ? ' chip-paid' : ''}`}
                  onClick={() => play.setDeliverDraft?.(withDeliverToken(draft, t))}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <p className="assembly-hint">
          {candidates.length === 0
            ? 'That payment cannot be finished. Take a card back off.'
            : additions.remaining.max === 0
              ? 'Paid. Confirm to deliver.'
              : `Spending ${spendText(draft.spend)}. ${owed} more to find, from your barn.`}
        </p>

        <div className="chips">
          {(Object.entries(draft.spend) as [Suit, number][])
            .filter(([, n]) => n > 0)
            .map(([suit, n]) => (
              <button
                key={suit}
                type="button"
                className="chip chip-paid"
                onClick={() => play.setDeliverDraft?.(withoutDeliverCard(draft, suit))}
                title="take it back"
              >
                {n} {SUIT_META[suit].label} <span aria-hidden="true">x</span>
              </button>
            ))}
          {Object.keys(draft.spend).length === 0 && (
            <span className="chip chip-empty">nothing paid yet</span>
          )}
        </div>

        {additions.suits.size > 0 && (
          <div className="chips">
            <span className="chips-label">from your barn:</span>
            {[...additions.suits].map((suit) => (
              <button
                key={suit}
                type="button"
                className="chip"
                onClick={() => play.setDeliverDraft?.(withDeliverCard(draft, suit))}
              >
                + {SUIT_META[suit].label}
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
            Deliver it
          </button>
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
        </div>
      </div>
    </section>
  );
}
