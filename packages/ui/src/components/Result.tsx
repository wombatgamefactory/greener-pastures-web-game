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
 * is nothing to reassure anybody about. What took its place is the own-crop
 * scorer - printed on the Barn since 10/09/2026 (it was the Farmstead before
 * that; ledger A105): "1 VP for each CROP card you have built" is an ordinary
 * `gameEnd` handler, so it arrives in the end-game section like any other
 * card and every seat now has at least one line there.
 *
 * ⭐ 25/09/2026 (UI polish WP4, item B5): THE SCREEN NOW TALKS TO THE PLAYER.
 * It opens with where YOU finished ("You came 2nd of 3, 7 VP behind Orchard
 * farm", or a win line), each seat's score is drawn as a three-colour bar by
 * source, and the design-instrument sentences (the island's share of the winning
 * score against the ~50% target) moved behind `?debug=1`, where Dean can still
 * read them off a finished game. "Meeple" is gone from every line a player sees:
 * the component is a Worker everywhere else in the interface and the rule book.
 * Two ways out instead of one: "Play again (same seats)" and "New setup".
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
import type { EndgameCard, ScoreReport, ScoredCard, SeatScore } from '../view/scoring';
import { SUIT_META } from '../view/suits';
import { ZoomPanel, useZoom } from './Zoom';
import type { Zoomer } from './Zoom';

/**
 * `?debug=1` shows the designer's readings (25/09/2026). Read per render rather
 * than threaded through as a prop, because it is a property of the page a
 * designer opened, not of the game; guarded for the test renderer, which has no
 * `window`.
 */
function debugMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/**
 * THE PLAYER'S OWN LINE, first on the screen (25/09/2026, B5). A player who has
 * just spent forty minutes on a game wants to know where THEY came before they
 * want the winner's margin, so this leads and `verdictLine` follows it.
 *
 * Ties are said honestly: two farms level on VP are separated by the tie-break
 * chain (cards held, then receipts), and "0 VP behind" would be nonsense, so a
 * level score names the tie-break instead of a margin.
 */
export function standingLine(report: ScoreReport): { head: string; sub: string } {
  const seats = report.seats;
  const you = seats.find((s) => s.isYou);
  const of = `of ${seats.length}`;
  if (!you) return { head: `${report.verdict.winner.name} wins`, sub: '' };
  const total = you.breakdown.total;
  if (you.rank === 1) {
    const next = seats[1];
    const by = next ? total - next.breakdown.total : 0;
    return {
      head: 'You won!',
      sub:
        next === undefined
          ? `1st ${of}, with ${total} VP.`
          : by > 0
            ? `1st ${of}, with ${total} VP: ${by} VP ahead of ${next.name}.`
            : `1st ${of}, level with ${next.name} on ${total} VP and ahead on the tie-break.`,
    };
  }
  const winner = seats[0]!;
  const behind = winner.breakdown.total - total;
  return {
    head: `You came ${ordinal(you.rank)} ${of}`,
    sub:
      behind > 0
        ? `${total} VP, ${behind} VP behind ${winner.name}.`
        : `${total} VP, level with ${winner.name}, who takes it on the tie-break.`,
  };
}

/** One seat's three sources as a bar, so the shape of a score reads at a glance. */
function SourceBar({ seat, scale }: { seat: SeatScore; scale: number }) {
  const { receipts, printed, endgame, total } = seat.breakdown;
  const pct = (n: number) => `${scale > 0 ? (Math.max(0, n) / scale) * 100 : 0}%`;
  return (
    <span
      className="result-bar"
      role="img"
      aria-label={`${receipts} island, ${printed} printed, ${endgame} end-game, ${total} in all`}
    >
      <span className="result-bar-island" style={{ width: pct(receipts) }} />
      <span className="result-bar-built" style={{ width: pct(printed) }} />
      <span className="result-bar-endgame" style={{ width: pct(endgame) }} />
    </span>
  );
}

export function Result({
  data,
  view,
  score,
  onAgain,
  onReplay,
}: {
  data: GameData;
  view: PlayerView;
  score: GameScore;
  /** "New setup": back to the start screen. */
  onAgain(): void;
  /**
   * "Play again (same seats)": the same farmers and crops, a fresh deal. Wired
   * by `App.tsx` when it can rebuild the session; until then the fallback below
   * reloads the page on a query string that seats the same crops.
   */
  onReplay?: () => void;
}) {
  const report = scoreReport(data, view, score);
  const debug = debugMode();
  const standing = standingLine(report);
  const scale = Math.max(1, ...report.seats.map((s) => s.breakdown.total));
  const replay =
    onReplay ??
    (() => {
      // ⚠️ FALLBACK ONLY (25/09/2026). `readOptions` in `App.tsx` seats these
      // crops in this order with `depth=0` (a fresh deal, no warm-up walk). The
      // bots' temperaments do not survive a reload; `onReplay` keeps them.
      if (typeof window === 'undefined') return;
      const suits = [...report.seats].sort((a, b) => a.seat - b.seat).map((s) => s.suit);
      const q = new URLSearchParams({
        seats: String(suits.length),
        suits: suits.join(','),
        seed: `replay-${Date.now().toString(36)}`,
        depth: '0',
        minHand: '0',
      });
      window.location.search = q.toString();
    });
  const { verdict } = report;
  const trigger = data.rules.endGame;
  // ⭐ 25/09/2026: the working opens on YOUR farm (the question a player asks
  // first is "where did my points come from"), falling back to the winner's.
  const [open, setOpen] = useState(report.seats.find((s) => s.isYou)?.seat ?? verdict.winner.seat);
  const zoom = useZoom();
  const detail = report.seats.find((s) => s.seat === open) ?? verdict.winner;
  const disagrees = report.seats.filter((s) => !s.agrees);

  return (
    <div className="overlay" role="dialog" aria-label="final scores">
      <div className="inspector result">
        <header className="result-head">
          {/* ⭐ 25/09/2026: your own standing leads; the winner's line follows. */}
          <p className="result-standing">{standing.head}</p>
          <p className="result-standing-sub">{standing.sub}</p>
          <h2>
            <span style={{ color: SUIT_META[verdict.winner.suit].ink }}>{verdict.winner.name}</span>{' '}
            {verdictLine(verdict)}
          </h2>
          <p className="result-trigger">
            {/* ⭐ 15/09/2026: DEAN RULED THE ROUND IS FINISHED, not "everyone else
                gets N more turns" as a fact about their own clock - the engine
                still grants exactly that (`furtherTurnsEach`), so the number is
                unchanged, but the sentence now says what the table rule IS
                rather than reporting it as bookkeeping. */}
            {verdict.trigger
              ? `${verdict.trigger.name} completed a ${trigger.deliveriesToTrigger}th island delivery, which ends the game. The round finishes: every other player gets ${verdict.furtherTurns === 1 ? 'one more turn' : `${verdict.furtherTurns} more turns`} to close it out.`
              : 'The game ended before anyone completed their run of deliveries.'}
          </p>
        </header>

        <table className="result-table">
          <caption>
            Where every point came from. Click a farm to see its working.
            {debug ? ' The island share sits under the island VP.' : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="result-rank">
                #
              </th>
              <th scope="col" className="result-farm-head">
                farm
              </th>
              <th scope="col" className="result-bar-head">
                <span className="result-key result-key-island">island</span>
                <span className="result-key result-key-built">printed</span>
                <span className="result-key result-key-endgame">end-game</span>
              </th>
              <th scope="col">island receipts</th>
              <th scope="col">printed on cards</th>
              <th scope="col">end-game cards</th>
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
                <td className="result-bar-cell">
                  <SourceBar seat={s} scale={scale} />
                </td>
                <td>
                  {s.breakdown.receipts}
                  {debug && <small>{Math.round(s.islandShare)}%</small>}
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

        {/* ⭐ 25/09/2026: THE DESIGN INSTRUMENT MOVED BEHIND `?debug=1`. It is a
            question for the designer (is the island carrying half the winning
            score?), and a player reading it on a scoring screen was being told
            the game might be broken. The number is unchanged. */}
        {debug && (
          <p className="result-share">
            The island paid <b>{Math.round(verdict.winner.islandShare)}%</b> of the winning score.
            The design aims for about half or more; well under that, and the farms are outscoring
            the thing everyone is supposed to be racing for.
          </p>
        )}

        <Detail seat={detail} zoom={zoom} />

        {/*
         * ⭐ THE DEAD-COMPONENT NUMBER, printed where a player can see it.
         * (25/09/2026: worded as Workers, the component's name at the table.)
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
            ? 'Every Worker the island paid out was spent. None went to waste.'
            : `${report.meeplesUnspent} Worker${report.meeplesUnspent === 1 ? ' was' : 's were'} never spent. Workers score nothing: each one is a stored action, not a point.`}
        </p>
        {disagrees.length > 0 && (
          <p className="result-warn" role="alert">
            The working below does not add up to the engine&apos;s total for{' '}
            {disagrees.map((s) => s.name).join(', ')}. The totals in the table are the ones that
            decided the game; this is a bug in the breakdown.
          </p>
        )}

        <div className="result-actions">
          <button className="primary result-again" onClick={replay}>
            Play again (same seats)
          </button>
          <button className="result-setup" onClick={onAgain}>
            New setup
          </button>
        </div>
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
          <span key={`${a.order}:${a.vpEach}`} className="chip">
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
       * ⭐ THE BARN LANDS HERE, and that is why this section changed shape
       * rather than the screen gaining a fourth. All five Barns print
       * "Game end: 1 VP for each CROP card you have built", which is five
       * ordinary `gameEnd` handlers - so the loyalty payoff shows its formula
       * and its number on the same list as a bought Endgame card, and the empty
       * state below is now unreachable in a normal game.
       *
       * ⭐ 10/09/2026: this used to say "Farmstead" - the scorer moved off it
       * and onto the Barn (ledger A105). Nothing in this component's own logic
       * changed: `view/scoring.ts` reads the `gameEnd` handler off whichever
       * card carries it, so the fix was the data (`cards.json` v44) and this
       * comment catching up to it, not the code.
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
          ? 'No Workers left over.'
          : `${seat.meeplesLeft} Worker${seat.meeplesLeft === 1 ? '' : 's'} unspent, worth nothing.`}
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
