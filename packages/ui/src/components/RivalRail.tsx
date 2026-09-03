/**
 * The left rail: your neighbours, compressed to what a VISIT decision needs.
 *
 * Dean chose this layout in ticket 09 for one reason, and it is the reason the
 * rail must not drift into a general-purpose summary: it is a permanent "who
 * should I visit" scoreboard. Everything on a rail card answers that question -
 * can I get on their Notice Board (the fill bar), what would I get (their suit's
 * door, in one word), and are they winning (receipts, and what they are holding).
 * Anything else belongs in the inspector behind a click.
 *
 * ⭐ v31 CHANGED WHAT A VISIT BUYS AND THEREFORE WHAT THIS PANEL SAYS. There is
 * no payout and no wage: a card on their board buys their suit's ACTION, and
 * that action is now the single most decision-relevant fact on the card. The
 * coin count went with the currency; a MEEPLE row took its place, which carries
 * more than the coins did - a meeple's colour says which free action that farm
 * is sitting on, so the row is a read on what they can do next rather than a
 * bare number.
 *
 * ⭐ PHASE 4: TWO LINES AND A BAR, AND WHY THAT IS A DESIGN REQUIREMENT RATHER
 * THAN A POLISH ONE.
 *
 * Until 26/08/2026 this panel answered its own question in roughly 8px type: a
 * four-column `<dl>` with a micro-label over each number, plus a row of 9px dots
 * for the buildings, plus a worker chip with its wage line switched off. Every
 * fact was on screen and none of it was legible from a normal seating distance,
 * which for THIS panel is not a small fault. Watching your neighbours is the
 * game's hook; a scoreboard nobody reads is the hook switched off.
 *
 * So the shape is now fixed at:
 *
 *     (crop)  Orchard farm                          to play
 *             4 VP · 7 in hand · 6 in barn
 *             (pawn)(pawn)
 *             NOTICE BOARD                       Draw
 *             [========------]                   1/2
 *
 * Three moves paid for the size. The four columns became ONE INLINE RUN at
 * reading size - all four numbers are visit-relevant and all four stay, but a
 * number does not need its own column and its own caption to be read when the
 * unit is written into the value ("7 in hand" needs no label saying "hand").
 * The dot track is DELETED: at 9px it was decoration, and what it carried - what
 * they have built - is one click away in the inspector, which the panel header
 * already opens. And the worker chip dropped to the two facts a visit turns on,
 * the action offered and what the bank pays its owner.
 *
 * The fill bar is the one thing that got BIGGER. It is the most decision-
 * relevant object in the rail because it is the only one that says whether a
 * visit will be accepted at all.
 *
 * ⚠️ THIS IS PRESENTATION ONLY. The threshold still arrives through
 * `noticeBoardOf`, which reads the engine's seam (`liveThreshold` in
 * view/table.ts). The interface may lag the sheet; it may never contradict the
 * engine about whether a move is legal.
 *
 * A seat with NO Notice Board renders as "closed to visitors" rather than
 * throwing. That is a reachable position - D11 and D14 can cover or demolish a
 * starter (ticket 30) - and the interface has to survive it.
 */

import type { GameData } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon } from '../view/art';
import { dropZone } from '../view/drop';
import { SUIT_META, seatName } from '../view/suits';
import { farmOf, noticeBoardOf, receiptTotal, seatSuits } from '../view/table';
import { FillBar } from './StackGauge';
import { MeepleSupply } from './Supply';

export function RivalRail({
  data,
  view,
  onInspect,
  play,
}: {
  data: GameData;
  view: PlayerView;
  onInspect(seat: Seat): void;
  play?: Play | undefined;
}) {
  const suits = seatSuits(view);

  return (
    <div className="rail" aria-label="your neighbours">
      {view.rivals.map((rival) => {
        const farm = farmOf(view, rival.seat);
        const board = noticeBoardOf(data, farm);
        const meta = SUIT_META[farm.suit];
        const theirTurn = view.turnPlayer === rival.seat;
        const live = play?.live.hosts.has(rival.seat) ?? false;
        const visiting = play?.intent.k === 'visit' && play.intent.host === rival.seat;

        return (
          <article
            key={rival.seat}
            className={`rival${theirTurn ? ' rival-active' : ''}${mark(play, live)}${
              visiting ? ' rival-visiting' : ''
            }`}
            /* The DROP zone is the whole neighbour, not the Notice Board button
               inside it. The button is 8px tall at the 1024 floor - a fine click
               target, since a click is aimed at rest, and a hopeless one for a
               moving pointer. Ticket 26 took the ticket's second option: a
               rival's rail card accepts the drop as a whole. */
            {...(play ? dropZone('host', rival.seat) : {})}
            style={{ ['--seat-ink' as string]: meta.ink, ['--seat-pip' as string]: meta.pip }}
          >
            {/* The whole header is the way in to the inspector. A separate
                "look at their farm" button cost 24px per neighbour, which at
                three neighbours is the difference between all of them fitting
                above the fold at 1024x700 and one of them not. */}
            <button className="rival-head" onClick={() => onInspect(rival.seat)}>
              <img className="rival-crop" src={cropIcon(farm.suit)} alt="" />
              <h3>{seatName(suits[rival.seat], rival.seat, view.seat)}</h3>
              {theirTurn && <span className="rival-turn">to play</span>}
              <span className="rival-open" aria-hidden="true">
                look
              </span>
            </button>

            {/*
             * One run, not four columns. The unit travels with the value so no
             * caption is needed, which is the whole trick that bought the type
             * size: "7 in hand" is self-describing where a bare 7 under a 9px
             * "HAND" is not. The middots are drawn by CSS between the spans, so
             * the run re-flows to two lines at the 1024 floor without leaving a
             * dangling separator on the end of the first.
             */}
            <p className="rival-run">
              <span>{receiptTotal(farm.receipts)} VP</span>
              <span>{farm.handCount} in hand</span>
              <span>{farm.barnCount} in barn</span>
            </p>

            {/* What free actions this farm is sitting on. A meeple is spent at
                the start of ITS OWNER'S turn, so this is a read on what they are
                about to be able to do rather than on what they have. */}
            <MeepleSupply data={data} meeples={farm.meeples} size="rail" />

            {board ? (
              /* The Notice Board is the only visit target in the game (v14), so
                 it is the rail's click target too - not the whole panel, whose
                 header already opens the inspector. */
              <button
                className="rival-board rival-board-live"
                disabled={!live}
                onClick={() => play?.host(rival.seat)}
              >
                <span className="rival-board-head">
                  <span className="rival-board-name">Notice Board</span>
                  {/* THE DOOR, IN ONE WORD. Since v31 a visit pays nothing and
                      buys the host farm's suit action, so this word IS the
                      payoff and there is no second line to print. */}
                  <span className="rival-payout">
                    {board.full ? 'no room - visit blocked' : `1 card, then ${board.actionLabel}`}
                  </span>
                </span>
                <FillBar filled={board.filled} threshold={board.threshold} />
              </button>
            ) : (
              <p className="rival-board rival-board-none">
                No Notice Board. This farm cannot be visited.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
