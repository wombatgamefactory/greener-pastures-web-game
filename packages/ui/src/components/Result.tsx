/**
 * The end of the game: who won, why, and where every point came from.
 *
 * Two jobs, and the second is why this is not just a totals table. It has to
 * TEACH the scoring architecture - THREE sources since v31, all countable from
 * public state - so the breakdown shows its working: which receipts, which
 * cards. `view/scoring.ts` does the deriving and re-checks two of the three
 * sources against the engine's own totals; this file is the surface.
 *
 * It doubles as a design instrument. The island is meant to carry ~50%+ of a
 * winning score, so the island share is printed per seat rather than left to be
 * worked out, and the winner's share gets a line of its own. That is a number
 * Dean can read off a finished game without opening the simulator.
 *
 * ⛔ THE COIN COLUMN IS GONE (v31), and with it the "leftover coins score
 * nothing" note that replaced it on 2026-08-03. There is no currency, so there
 * is nothing to reassure anybody about. What took its place is the FARMSTEAD:
 * its "1 VP for each CROP card you have built" is an ordinary `gameEnd`
 * handler, so it arrives in the end-game section like any other card and every
 * seat now has at least one line there.
 *
 * Nothing here knows a rule constant. The island's VP by arrival order, the
 * delivery count that ends the game and the number of further turns are all read
 * out of `GameData`.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GameData } from '@gp/data';
import type { GameScore, PlayerView } from '@gp/engine';

import { cropIcon, frame, token } from '../view/art';
import { scoreReport, verdictLine } from '../view/scoring';
import type { EndgameCard, ScoredCard, SeatScore } from '../view/scoring';
import { SUIT_META } from '../view/suits';
import { ZoomPanel, useZoom } from './Zoom';
import type { Zoomer } from './Zoom';

export function Result({
  data,
  view,
  score,
  onAgain,
}: {
  data: GameData;
  view: PlayerView;
  score: GameScore;
  onAgain(): void;
}) {
  const report = scoreReport(data, view, score);
  const { verdict } = report;
  const trigger = data.rules.endGame;
  const [open, setOpen] = useState(verdict.winner.seat);
  const zoom = useZoom();
  const detail = report.seats.find((s) => s.seat === open) ?? verdict.winner;
  const disagrees = report.seats.filter((s) => !s.agrees);

  return (
    <div className="overlay" role="dialog" aria-label="final scores">
      <div className="inspector result">
        <header className="result-head">
          <h2>
            <span style={{ color: SUIT_META[verdict.winner.suit].ink }}>{verdict.winner.name}</span>{' '}
            {verdictLine(verdict)}
          </h2>
          <p className="result-trigger">
            {verdict.trigger
              ? `${verdict.trigger.name} completed a ${trigger.deliveriesToTrigger}th island delivery, which ended the game. Everyone else took ${verdict.furtherTurns === 1 ? 'one more turn' : `${verdict.furtherTurns} more turns`}.`
              : 'The game ended before anyone completed their run of deliveries.'}
          </p>
        </header>

        <table className="result-table">
          <caption>
            Click a farm for its working. The island share sits under the island VP.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="result-rank">
                #
              </th>
              <th scope="col" className="result-farm-head">
                farm
              </th>
              <th scope="col">island</th>
              <th scope="col">built</th>
              <th scope="col">end-game</th>
              <th scope="col">total</th>
            </tr>
          </thead>
          <tbody>
            {report.seats.map((s) => (
              <tr
                key={s.seat}
                className={`${s.isYou ? 'result-you ' : ''}${s.seat === detail.seat ? 'result-open' : ''}`}
                onClick={() => setOpen(s.seat)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setOpen(s.seat);
                }}
                tabIndex={0}
                aria-label={`show ${s.name}'s working`}
              >
                <td className="result-rank">{s.rank}</td>
                <th scope="row" className="result-farm">
                  <img src={cropIcon(s.suit)} alt="" />
                  {s.name}
                </th>
                <td>
                  {s.breakdown.receipts}
                  <small>{Math.round(s.islandShare)}%</small>
                </td>
                <td>{s.breakdown.printed}</td>
                <td>{s.breakdown.endgame}</td>
                <td>
                  <b>{s.breakdown.total}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="result-share">
          The island paid <b>{Math.round(verdict.winner.islandShare)}%</b> of the winning score. The
          design aims for about half or more; well under that, and the farms are outscoring the
          thing everyone is supposed to be racing for.
        </p>

        <Detail seat={detail} zoom={zoom} />

        {/*
         * ⭐ THE DEAD-COMPONENT NUMBER, printed where a player can see it.
         *
         * A meeple is a stored action that leaves the game when spent, so one
         * still in a supply at the end was never used - and the v31 plan asks
         * the simulator to watch exactly that count, on the grounds that "a
         * meeple nobody spends is a dead component". It is NOT a score and the
         * line says so, because a number on a scoring screen that is not a score
         * will otherwise be read as one.
         */}
        <p className="result-note">
          {report.meeplesUnspent === 0
            ? 'Every meeple the island paid out was spent. None went to waste.'
            : `${report.meeplesUnspent} meeple${report.meeplesUnspent === 1 ? '' : 's'} left the game unspent, still in supplies. They score nothing: a meeple is a stored action, not a point.`}
        </p>
        {disagrees.length > 0 && (
          <p className="result-warn" role="alert">
            The working below does not add up to the engine&apos;s total for{' '}
            {disagrees.map((s) => s.name).join(', ')}. The totals in the table are the ones that
            decided the game; this is a bug in the breakdown.
          </p>
        )}

        <button className="primary" onClick={onAgain}>
          Another game
        </button>
        <ZoomPanel data={data} zoom={zoom} width={340} />
      </div>
    </div>
  );
}

/** One seat's working: the three sources, each traced to what it came from. */
function Detail({ seat, zoom }: { seat: SeatScore; zoom: Zoomer }) {
  return (
    <div className="result-detail" style={{ ['--seat-ink' as string]: SUIT_META[seat.suit].ink }}>
      <h3>
        <img src={cropIcon(seat.suit)} alt="" />
        {seat.name} - {seat.breakdown.total} VP, in full
      </h3>

      <Source
        label="Island receipts"
        vp={seat.breakdown.receipts}
        icon={token('receipt')}
        empty="No deliveries. Every point came from the farm."
        isEmpty={seat.arrivals.length === 0}
      >
        <span className="result-count">
          {seat.receiptCount} receipt{seat.receiptCount === 1 ? '' : 's'}:
        </span>
        {/* Grouped by who got there first, because that is the only thing that
            decides an island receipt's value now. "Level 2, 3 x 8" told a
            player about the board; "got there first, 4 x 6" tells them about
            their game. */}
        {seat.arrivals.map((a) => (
          <span key={a.order} className="chip">
            {a.order === 0
              ? 'Got there first'
              : a.order === 1
                ? 'Arrived second'
                : `Arrived ${a.order + 1}th`}
            <b>{a.vp}</b>
            <small>
              {a.count} × {a.vpEach}
            </small>
          </span>
        ))}
      </Source>

      <Source
        label="VP printed on cards you built"
        vp={seat.breakdown.printed}
        icon={frame('vp')}
        empty="Nothing built yet prints VP."
        isEmpty={seat.built.length === 0}
      >
        {seat.built.map((c) => (
          <CardChip key={c.id} card={c} zoom={zoom} />
        ))}
      </Source>

      {/*
       * ⭐ THE FARMSTEAD LANDS HERE, and that is why this section changed shape
       * rather than the screen gaining a fourth. All five Farmsteads print
       * "Game end: 1 VP for each CROP card you have built", which is five
       * ordinary `gameEnd` handlers - so the loyalty payoff shows its formula
       * and its number on the same list as a bought Endgame card, and the empty
       * state below is now unreachable in a normal game.
       */}
      <Source
        label="End-game cards"
        vp={seat.breakdown.endgame}
        icon={frame('game_end')}
        empty="Nothing scores at the end for this farm."
        isEmpty={seat.endgame.length === 0}
      >
        {seat.endgame.map((c) => (
          <EndgameChip key={c.id} card={c} zoom={zoom} />
        ))}
      </Source>

      {/* Not a source. The tie-break's second link and the dead-component count,
          side by side, because both are things a player will look for on this
          screen and neither is worth a section of its own. */}
      <p className="result-sum result-stock">
        Held at the end: <b>{seat.stock}</b> card{seat.stock === 1 ? '' : 's'} in hand and barn,
        which is the tie-break after VP.{' '}
        {seat.meeplesLeft === 0
          ? 'No meeples left over.'
          : `${seat.meeplesLeft} meeple${seat.meeplesLeft === 1 ? '' : 's'} unspent, worth nothing.`}
      </p>
    </div>
  );
}

function Source({
  label,
  vp,
  icon,
  children,
  empty,
  isEmpty,
}: {
  label: string;
  vp: number;
  icon: string;
  children?: ReactNode;
  empty?: string;
  isEmpty: boolean;
}) {
  return (
    <section className="result-source">
      <h4>
        {label}
        <span className="result-source-vp">
          <img src={icon} alt="" />
          {vp}
        </span>
      </h4>
      <div className="result-source-body">
        {isEmpty ? <span className="empty-note">{empty}</span> : children}
      </div>
    </section>
  );
}

function CardChip({ card, zoom, note }: { card: ScoredCard; zoom: Zoomer; note?: string }) {
  return (
    <span
      className={`chip${note ? ' chip-muted' : ''}`}
      title={note ?? 'hover to read the card'}
      onMouseEnter={() => zoom.show(card.id)}
      onMouseLeave={zoom.clear}
    >
      {card.name}
      <b>{card.vp}</b>
    </span>
  );
}

/**
 * An end-game card shows its formula beside its number. This is the one VP
 * source a player cannot recount off the table: the formulas run against the
 * true state, and two of them (V21's barn colours, O21's rival hands) read
 * information the interface keeps hidden right up to scoring. Printing the text
 * is what makes the number arguable rather than asserted.
 */
function EndgameChip({ card, zoom }: { card: EndgameCard; zoom: Zoomer }) {
  return (
    <span
      className="result-endgame"
      onMouseEnter={() => zoom.show(card.id)}
      onMouseLeave={zoom.clear}
    >
      <span className="chip">
        {card.name}
        <b>{card.vp}</b>
      </span>
      <small>{card.text}</small>
    </span>
  );
}
