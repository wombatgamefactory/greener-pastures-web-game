/**
 * Assembling a VISIT: the hook, and the most important gesture in the game.
 *
 * Ticket 23's instruction, verbatim: "build a visit, do not render the
 * enumeration". `legalMoves` offers one move per unordered PAIR of hand cards
 * per upgraded host - up to ~90 at four seats - so the panel takes the fee one
 * card at a time and lights the payoffs the price has actually bought. Two
 * details it makes explicit because a player cannot see them otherwise: a board
 * at 4-of-5 refuses the two-card visit outright while still taking one card,
 * and the two-card mode is the only visit that cannot arm a Helping Hand.
 *
 * The wage is stated as what it does - the BANK pays your neighbour - because
 * that is the whole v14 pivot. Interaction mints money rather than moving it,
 * and a visitor who thinks they are handing over their own coins will not
 * visit twice.
 */

import type { GameData } from '@gp/data';
import type { Seat } from '@gp/engine';

import type { Play } from '../session/play';
import { visitFeeAdditions, visitPayoffs } from '../view/intent';
import { cardName, workerName } from '../view/moveText';
import { SUIT_META, seatName } from '../view/suits';
import { farmOf, noticeBoardOf, seatSuits, workerTrack, workersOwnedBy } from '../view/table';
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
  fee: readonly string[];
}) {
  const view = play.view;
  const farm = farmOf(view, host);
  const board = noticeBoardOf(data, farm);
  const name = seatName(seatSuits(view)[host], host, view.seat);
  const payoffs = visitPayoffs(play.moves, { host, fee });
  const more = visitFeeAdditions(play.moves, { host, fee });
  const workers = workersOwnedBy(view, host);

  const coin = payoffs.find((m) => m.payoff.mode === 'coin');
  const special = payoffs.find((m) => m.payoff.mode === 'special');

  return (
    <section className="assembly assembly-visit" aria-label={`visit ${name}`}>
      <div className="assembly-body">
        <h3>
          Visit {name}
          {board && (
            <span className="assembly-board">
              <FillBar filled={board.filled} threshold={board.threshold} />
            </span>
          )}
        </h3>

        <p className="assembly-hint">
          {fee.length === 0
            ? 'Pick the card you are willing to lose. It rides into their barn - your junk, their treasure.'
            : more.size > 0
              ? 'Take the payoff, or add a second card for the Special Orders prize.'
              : 'Take the payoff.'}
        </p>

        <div className="chips">
          {fee.map((card) => (
            <button
              key={card}
              className="chip chip-paid"
              onClick={() =>
                play.setVisitFee(
                  host,
                  fee.filter((c) => c !== card),
                )
              }
              title="take it back"
            >
              {cardName(data, card)} <span aria-hidden="true">x</span>
            </button>
          ))}
          {fee.length === 0 && <span className="chip chip-empty">no card chosen yet</span>}
        </div>

        {payoffs.length > 0 && (
          <div className="payoffs">
            {coin && (
              <button className="payoff" onClick={() => play.send(coin)}>
                <b>Take £{board?.payout ?? '?'}</b>
                <span>from the bank, to you</span>
              </button>
            )}
            {special && (
              <button className="payoff" onClick={() => play.send(special)}>
                <b>Special Orders: £{data.rules.economy.visitPayout.twoCard}</b>
                <span>two cards, the bigger prize - and no Helping Hand</span>
              </button>
            )}
            {payoffs
              .filter((m) => m.payoff.mode === 'worker')
              .map((m) => {
                const workerId = m.payoff.mode === 'worker' ? m.payoff.workerId : null;
                const worker = workers.find((w) => w.id === workerId);
                const track = worker ? workerTrack(data, worker) : null;
                return (
                  <button key={workerId} className="payoff" onClick={() => play.send(m)}>
                    <b>Work their {workerName(data, workerId ?? 'draw')}</b>
                    <span>
                      {track?.actionText}
                      {' - '}
                      {(track?.wage ?? 0) > 0
                        ? `your card lands on it, and the bank pays them £${track?.wage}`
                        : 'your card lands on it, and rides into their barn'}
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {more.size > 0 && (
          <p className="assembly-hint assembly-more">
            A second card is worth £{data.rules.economy.visitPayout.twoCard}: click another card in
            your hand.
          </p>
        )}
        {board && !board.full && board.twoCard !== null && more.size === 0 && fee.length === 1 && (
          <p className="assembly-hint">
            Their board has room for one more card only, so the two-card prize is off.
          </p>
        )}

        <div className="assembly-actions">
          <button className="ghost" onClick={play.cancel}>
            cancel
          </button>
          <span className="assembly-note">
            Their farm is {SUIT_META[farm.suit].label}, and they hold £{farm.coins}.
          </span>
        </div>
      </div>
    </section>
  );
}
