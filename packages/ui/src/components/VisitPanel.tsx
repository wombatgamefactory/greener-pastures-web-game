/**
 * Placing a card on a Notice Board: the hook, and the most important gesture in
 * the game.
 *
 * ⭐ SINCE v31 IT IS TWO GESTURES WEARING ONE MOVE, and this panel is where the
 * difference has to be unmistakable. `visit` carries a `host`, and the host may
 * be a neighbour or it may be you:
 *
 *   a NEIGHBOUR's board   the hook. Your card rides into their barn as exactly
 *                         the mixed colour the island will demand of them, and
 *                         you take their suit's action. Two farms are involved.
 *   your OWN board        solitaire, bought with the same currency. You take
 *                         your own action, and the card counts toward your own
 *                         threshold of two - so doing it twice clogs your board
 *                         and shuts every neighbour out of your suit's action
 *                         until you spend a Harvest clearing it.
 *
 * The v31 plan's risk 2 is that the second quietly crowds out the first, exactly
 * as every coin-bought solitaire option has in every previous version. The
 * interface cannot fix that and must not hide it: what it can do is make sure
 * nobody takes one thinking it was the other. So the panel changes its title,
 * its colour, its hint and its footer on the flag, and the self version states
 * the cost - the clog - as prominently as the payoff.
 *
 * The assembly itself got much smaller. A visit costs exactly one card, so there
 * is one choice left (which card) and the panel plays the move the moment it is
 * made rather than asking for a confirmation nobody would read.
 */

import type { GameData } from '@gp/data';
import type { Seat } from '@gp/engine';

import type { Play } from '../session/play';
import { visitFeeOptions } from '../view/intent';
import { cardName } from '../view/moveText';
import { SUIT_META, seatName } from '../view/suits';
import { farmOf, noticeBoardOf, seatSuits } from '../view/table';
import { FillBar } from './StackGauge';

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
  const self = host === view.seat;
  const farm = farmOf(view, host);
  const board = noticeBoardOf(data, farm);
  const name = seatName(seatSuits(view)[host], host, view.seat);
  const options = visitFeeOptions(play.moves, host);
  const chosen = fee !== null && options.has(fee) ? fee : null;

  return (
    <section
      className={`assembly assembly-visit ${self ? 'assembly-self' : 'assembly-hook'}`}
      aria-label={self ? 'use your own door' : `visit ${name}`}
    >
      <div className="assembly-body">
        <h3>
          {self ? 'Your own door' : `Visit ${name}`}
          {board && (
            <span className="assembly-board">
              <FillBar filled={board.filled} threshold={board.threshold} />
            </span>
          )}
        </h3>

        {/*
         * THE ONE LINE THAT MUST DIFFER. Same length, same place, opposite
         * content: one names the neighbour and what the card does for them, the
         * other names the clog. A player skimming will read exactly this.
         */}
        <p className={`assembly-hint ${self ? 'assembly-warn' : ''}`}>
          {self ? (
            <>
              <strong>No neighbour involved.</strong> The card lands on your own board and counts
              toward your own {board?.threshold ?? 2}, so filling it shuts your own door: nobody can
              take {board ? board.actionLabel : 'your action'} here, you included, until you spend a
              Harvest clearing it.
            </>
          ) : (
            <>
              <strong>{board ? board.actionLabel : 'Their action'}, for one card.</strong> Pick the
              card you are willing to lose: it rides into their barn as exactly the mixed colour the
              island will ask of them. Your junk, their treasure.
            </>
          )}
        </p>

        {options.size === 0 ? (
          <p className="assembly-hint">Nothing in your hand buys this door right now.</p>
        ) : (
          <div className="chips">
            {[...options].map((card) => (
              <button
                key={card}
                type="button"
                className={`chip${chosen === card ? ' chip-paid' : ''}`}
                onClick={() => play.hold(card)}
                title={
                  self
                    ? `Put ${cardName(data, card)} on your own Notice Board`
                    : `Put ${cardName(data, card)} on ${name}'s Notice Board`
                }
              >
                {cardName(data, card)}
              </button>
            ))}
          </div>
        )}

        <div className="assembly-actions">
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
          <span className="assembly-note">
            {self
              ? `Your own ${SUIT_META[farm.suit].label} farm. This spends your bonus slot exactly as a visit would.`
              : `Their farm is ${SUIT_META[farm.suit].label}. They pay nothing and gain a card on their board; the bank pays nobody.`}
          </span>
        </div>
      </div>
    </section>
  );
}
