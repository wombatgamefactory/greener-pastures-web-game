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
 * ⚠️ THIS IS PRESENTATION ONLY. Every board's threshold still arrives through
 * the engine's own seam (`liveThreshold` in `view/table.ts`), read per board by
 * `railBoards` below rather than through `noticeBoardOf` (2.2.1 - see the next
 * banner). The interface may lag the sheet; it may never contradict the engine
 * about whether a move is legal.
 *
 * A seat with NO Notice Board renders as "closed to visitors" rather than
 * throwing. That is a reachable position - D11 and D14 can cover or demolish a
 * starter (ticket 30) - and the interface has to survive it.
 *
 * ⭐ 18/09/2026 (2.2.1, 2.2.8): PER-BOARD, NOT PER RIVAL. At two players a rival
 * farms TWO Notice Boards - their own suit's, plus the one drawn at random from
 * an unfarmed suit - and the two print different powers. `noticeBoardOf`
 * (`view/table.ts`) still resolves only the first board on a tableau (2.3.2 is
 * someone else's fix), so this file no longer calls it: `railBoards` below reads
 * every `noticeboard`-slot building straight off the farm's tableau and looks up
 * each one's OWN suit and OWN printed power - `doorOf(data, farm.suit)` would
 * silently label a two-player farm's second board with its owner's suit's verb,
 * which is exactly the wrong-board bug this ticket exists to kill.
 *
 * A single-board host (every seat but a two-board farm at 2p) renders exactly as
 * before: one row, the whole card a drop zone, `play.host(seat)` with no board
 * named - `clickHost`/`visitOffers` narrow to the one move that exists. A
 * two-board host gets one row per board, each its own click target and its own
 * drop zone (`dropZone('host', seat, boardId)`), because dropping a card on a
 * SPECIFIC board is now a real, distinct gesture rather than "on this farm
 * somewhere".
 *
 * A board that is not live states WHY rather than just going dim (2.2.8): the
 * public `turn.firedThisTurn` list says whether THIS board already paid out
 * this turn (S9, one use per board per turn); if it has not and the board still
 * offers no move, the standing door ruling (S10) is refusing it - its power is
 * not legal to take right now. Both facts are read straight off public state and
 * the engine's own move list, never re-derived.
 */

import type { GameData, Suit } from '@gp/data';
import type { CardId, PlayerView, Seat } from '@gp/engine';

import { mark } from '../session/play';
import type { Play } from '../session/play';
import { cropIcon } from '../view/art';
import { dropZone } from '../view/drop';
import { clickHost } from '../view/intent';
import { printedFace } from '../view/printed';
import { SUIT_META, seatName } from '../view/suits';
import { doorOf, farmOf, liveThreshold, receiptTotal, seatSuits } from '../view/table';
import type { Farm } from '../view/table';
import { FillBar } from './StackGauge';
import { MeepleSupply } from './Supply';

/** One of a farm's Notice Boards, resolved from ITS OWN suit - never the farm owner's. */
interface RailBoard {
  readonly boardId: CardId;
  readonly suit: Suit;
  readonly filled: number;
  readonly threshold: number;
  readonly actionLabel: string;
}

/** Every Notice Board this farm has on the table, in tableau order. Usually one; two at 2p. */
function railBoards(data: GameData, farm: Farm): RailBoard[] {
  return farm.tableau
    .filter((b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard')
    .map((b) => {
      const face = printedFace(data, b.card);
      const door = doorOf(data, face.suit);
      return {
        boardId: b.card,
        suit: face.suit,
        filled: b.stack.length,
        threshold: liveThreshold(data, b.card, face.threshold) ?? 0,
        actionLabel: door.actionLabel,
      };
    });
}

/** "used this turn" or "power not legal now" - the two ways a board can be dead right now. */
function boardUnavailableReason(view: PlayerView, board: RailBoard): string {
  return view.turn.firedThisTurn.includes(board.boardId) ? 'used this turn' : 'power not legal now';
}

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
        const boards = railBoards(data, farm);
        const twoBoards = boards.length > 1;
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
            /* The DROP zone is the whole neighbour, not a Notice Board button
               inside it, WHEN THERE IS ONLY ONE BOARD to name: the button is
               8px tall at the 1024 floor - a fine click target, since a click
               is aimed at rest, and a hopeless one for a moving pointer.
               Ticket 26 took the ticket's second option: a rival's rail card
               accepts the drop as a whole. A two-board host (2.2.1) breaks
               that shortcut - the drop has to say WHICH board - so each
               board row below stamps its own zone instead and the card is
               left unstamped. */
            {...(play && !twoBoards ? dropZone('host', rival.seat) : {})}
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

            {boards.length === 0 ? (
              <p className="rival-board rival-board-none">
                No Notice Board. This farm cannot be visited.
              </p>
            ) : (
              boards.map((board) => {
                const boardLive = play
                  ? clickHost(
                      view,
                      play.moves,
                      play.intent,
                      rival.seat,
                      twoBoards ? board.boardId : undefined,
                    ) !== null
                  : false;
                return (
                  /* The Notice Board is a visit target, and since 2.2.1 a
                     two-board farm offers two of them, each with its own
                     power - so each is its own click AND drop target. A
                     single-board farm keeps the one row it always had. */
                  <button
                    key={board.boardId}
                    className="rival-board rival-board-live"
                    disabled={!boardLive}
                    {...(play && twoBoards ? dropZone('host', rival.seat, board.boardId) : {})}
                    onClick={() => play?.host(rival.seat, twoBoards ? board.boardId : undefined)}
                  >
                    <span className="rival-board-head">
                      <span className="rival-board-name">
                        Notice Board{twoBoards ? ` (${SUIT_META[board.suit].label})` : ''}
                      </span>
                      {/* THE DOOR, IN ONE WORD, keyed to THIS board's own suit
                          - never the farm owner's, which is wrong on a
                          two-player farm's second board. A `3+` board never
                          clogs (S8), so an idle board always names its price;
                          when it is not live it says why (2.2.8): already
                          spent this turn, or its power is not legal right
                          now. */}
                      <span className="rival-payout">
                        {boardLive
                          ? `1 card, then ${board.actionLabel}`
                          : boardUnavailableReason(view, board)}
                      </span>
                    </span>
                    <FillBar filled={board.filled} threshold={board.threshold} />
                  </button>
                );
              })
            )}
          </article>
        );
      })}
    </div>
  );
}
