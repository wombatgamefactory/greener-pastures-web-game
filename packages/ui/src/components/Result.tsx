/**
 * The end of the game: who won, why, and where every point came from.
 *
 * Two jobs, and the second is why this is not just a totals table. It has to
 * TEACH the scoring architecture - four sources, all countable from public
 * state - so the breakdown shows its working: which receipts, which cards,
 * which coins. `view/scoring.ts` does the deriving and re-checks three of the
 * four sources against the engine's own totals; this file is the surface.
 *
 * It doubles as a design instrument. The island is meant to carry ~50%+ of a
 * winning score, so the island share is printed per seat rather than left to be
 * worked out, and the winner's share gets a line of its own. That is a number
 * Dean can read off a finished game without opening the simulator.
 *
 * Nothing here knows a rule constant. The coin column exists only while
 * `rules.json` prints a pity divisor - the rule is flagged OPEN in the design
 * and may be deleted - and the island's VP per level and the number of further
 * turns are read the same way.
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
              ? `${verdict.trigger.name} delivered to Level 3, which ended the game. Everyone else took ${verdict.furtherTurns === 1 ? 'one more turn' : `${verdict.furtherTurns} more turns`}.`
              : 'The game ended without a Level 3 delivery.'}
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
              {report.pityDivisor !== null && <th scope="col">coins ÷ {report.pityDivisor}</th>}
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
                {report.pityDivisor !== null && <td>{s.breakdown.coinPity}</td>}
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

        <Detail seat={detail} pityDivisor={report.pityDivisor} zoom={zoom} />

        {report.pityDivisor === null && (
          <p className="result-note">Leftover coins score nothing in this edition.</p>
        )}
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

/** One seat's working: the four sources, each traced to what it came from. */
function Detail({
  seat,
  pityDivisor,
  zoom,
}: {
  seat: SeatScore;
  pityDivisor: number | null;
  zoom: Zoomer;
}) {
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
        isEmpty={seat.levels.length === 0}
      >
        <span className="result-count">
          {seat.receiptCount} receipt{seat.receiptCount === 1 ? '' : 's'}:
        </span>
        {seat.levels.map((l) => (
          <span key={l.level} className="chip">
            Level {l.level}
            <b>{l.vp}</b>
            <small>
              {l.count} × {l.vpEach}
              {l.bonus > 0 && ` +${l.bonus} early`}
            </small>
          </span>
        ))}
      </Source>

      <Source
        label="VP printed on cards you built"
        vp={seat.breakdown.printed}
        icon={frame('vp')}
        empty="Nothing built yet prints VP."
        isEmpty={seat.built.length === 0 && seat.covered.length === 0}
      >
        {seat.built.map((c) => (
          <CardChip key={c.id} card={c} zoom={zoom} />
        ))}
        {seat.covered.map((c) => (
          <CardChip
            key={`covered-${c.id}`}
            card={c}
            zoom={zoom}
            note="built over - no longer a building, still scores its VP"
          />
        ))}
      </Source>

      <Source
        label="End-game cards"
        vp={seat.breakdown.endgame}
        icon={frame('game_end')}
        empty="No end-game card. They cost £2 and score once, at the end."
        isEmpty={seat.endgame.length === 0}
      >
        {seat.endgame.map((c) => (
          <EndgameChip key={c.id} card={c} zoom={zoom} />
        ))}
      </Source>

      {pityDivisor !== null && seat.pity && (
        <Source label="Coins left over" vp={seat.pity.vp} icon={token('coin')} isEmpty={false}>
          <span className="result-sum">
            {seat.pity.replacedBy === null
              ? `£${seat.pity.coins} ÷ ${seat.pity.divisor} = ${seat.pity.vp} VP, rounded down`
              : `£${seat.pity.coins}, scored above by ${seat.pity.replacedBy} at its own rate instead of ÷ ${seat.pity.divisor}`}
          </span>
        </Source>
      )}
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
      onMouseEnter={() => zoom.show(card.id, card.upgraded)}
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
