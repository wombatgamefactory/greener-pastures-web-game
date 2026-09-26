/**
 * Placing a card on a RIVAL's Notice Board: the hook, and the most important
 * gesture in the game.
 *
 * ⭐ REWRITTEN 18/09/2026 for the shipped rule (`selfVisitAllowed: false`,
 * ruled 11/09/2026): a visit is one card, onto a NEIGHBOUR's board, for that
 * board's printed power. There is no self-visit branch here any more - the
 * old "your own door" title, its clog warning and its `assembly-self` class
 * are gone, along with the language that called a `3+` board "clogged": S8
 * makes the threshold a minimum that never blocks, so a board is never full
 * and this panel never says it is.
 *
 * ⭐ 2.2.1, THE SAME EVENING: a two-player host farms TWO Notice Boards - their
 * own suit's, plus one drawn at random from an unfarmed suit - and the two
 * print different powers. `RivalRail.tsx` (owned by this pass too) is what
 * lets a player click or drag onto a SPECIFIC board, so by the time this panel
 * is open `play.intent.board` already names one for a two-board host. The one
 * case this panel still has to handle itself is the ambiguous middle: a drop
 * on the whole rail card, or any other route that opens the assembly before a
 * board is chosen, names a host with two boards on offer and no board yet - so
 * the panel asks, using each board's own printed text (`printedFace`, straight
 * off `cards.json`), before it ever shows a fee chip.
 *
 * The fee assembly itself stays small: a visit costs exactly one card, so
 * there is one choice left once the board is settled, and the panel plays the
 * move the moment a chip is clicked rather than asking for a confirmation
 * nobody would read.
 */

import type { GameData } from '@gp/data';
import type { CardId, Seat } from '@gp/engine';

import type { Play } from '../session/play';
import { visitBoards, visitFeeOptions } from '../view/intent';
import { cardName } from '../view/moveText';
import { printedFace } from '../view/printed';
import { SUIT_META, seatName } from '../view/suits';
import { farmOf, liveThreshold, noticeBoardOf, seatSuits } from '../view/table';
import type { Farm } from '../view/table';
import { FillBar } from './StackGauge';

/** Filled/threshold/power for one specific board on this farm, by its own card id. */
function boardInfo(data: GameData, farm: Farm, boardId: CardId) {
  const building = farm.tableau.find((b) => b.card === boardId);
  const face = printedFace(data, boardId);
  return {
    filled: building?.stack.length ?? 0,
    threshold: liveThreshold(data, boardId, face.threshold) ?? 0,
    suit: face.suit,
    actionText: face.abilityText,
  };
}

export function VisitPanel({
  data,
  play,
  host,
  fee,
}: {
  data: GameData;
  play: Play;
  host: Seat;
  fee: string | null;
}) {
  const view = play.view;
  const farm = farmOf(view, host);
  const name = seatName(seatSuits(view)[host], host, view.seat);

  // `visitBoards` is empty for every host but a two-board farm still offering
  // more than one - see the file banner. `play.intent.board` is the one this
  // panel (or the rail, or a drop) has already narrowed to, if any.
  const boardIds = visitBoards(play.moves, host);
  const board = play.intent.k === 'visit' ? play.intent.board : undefined;
  const needsBoardChoice = boardIds.length > 1 && board === undefined;

  // A single-board host never puts `board` on the move at all (2.2.1), so the
  // id still has to come from the farm's one Notice Board when nothing has
  // been chosen - `noticeBoardOf` finds the first (and only) one correctly in
  // that case.
  const boardId =
    board ?? (boardIds.length === 0 ? noticeBoardOf(data, farm)?.building.card : undefined);
  const info = boardId ? boardInfo(data, farm, boardId) : null;

  const options = visitFeeOptions(play.moves, host, undefined, undefined, board);
  const chosen = fee !== null && options.has(fee) ? fee : null;

  return (
    <section className="assembly assembly-visit assembly-hook" aria-label={`visit ${name}`}>
      <div className="assembly-body">
        <h3>
          Visit {name}
          {info && (
            <span className="assembly-board">
              <FillBar filled={info.filled} threshold={info.threshold} />
            </span>
          )}
        </h3>

        {needsBoardChoice ? (
          <>
            <p className="assembly-hint">
              <strong>{name} farms two Notice Boards.</strong> Pick which one your card buys - the
              card still only pays one of them.
            </p>
            <div className="chips">
              {boardIds.map((id) => {
                const face = printedFace(data, id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="chip"
                    onClick={() => play.setVisitFee(host, fee, id)}
                    title={face.abilityText}
                  >
                    {SUIT_META[face.suit].label}: {face.abilityText}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {/* THE BOARD'S OWN PRINTED POWER, read off `cards.json` - what a card
                spent here buys, in the host's own words rather than a generic
                one-word gloss. */}
            <p className="assembly-hint">
              {/* QA 26/09/2026: this said the card "rides into their barn as exactly the
                  mixed colour the island will ask of them" - wrong (it rests on their
                  Notice Board until they harvest it, as the note below says) and
                  designer jargon. */}
              {/* T10b (26/09/2026): the printed power text ends in its own full stop,
                  so appending ", for one card." printed "...into your Barn., for one
                  card." (QA D10). The price is its own sentence now. */}
              <strong>
                {info ? info.actionText.replace(/\.\s*$/, '') : "Their board's power"}.
              </strong>{' '}
              One card buys it. Pick the card you are willing to lose. Your junk, their treasure.
            </p>

            {options.size === 0 ? (
              <p className="assembly-hint">Nothing in your hand buys this board right now.</p>
            ) : (
              <div className="chips">
                {[...options].map((card) => (
                  <button
                    key={card}
                    type="button"
                    className={`chip${chosen === card ? ' chip-paid' : ''}`}
                    onClick={() => play.hold(card)}
                    title={`Put ${cardName(data, card)} on ${name}'s Notice Board`}
                  >
                    {cardName(data, card)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="assembly-actions">
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
          {/* ⭐ REWORDED 25/09/2026 (B13): "the bank pays nobody" was designer
              shorthand for "there is no currency in this game to mint" - true,
              but not a sentence a player needs to parse mid-turn. Said plainly:
              the card stays put until the owner acts on it. */}
          <span className="assembly-note">
            Their farm is {SUIT_META[farm.suit].label}. The card stays on their board. They keep it
            when they harvest.
          </span>
        </div>
      </div>
    </section>
  );
}
