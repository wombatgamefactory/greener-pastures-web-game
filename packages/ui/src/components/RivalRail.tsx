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
import { useRovingTabIndex } from '../session/rovingTabIndex';
import { cropIcon, frame } from '../view/art';
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

  /*
   * ⭐ ROVING TABINDEX ACROSS THE WHOLE RAIL, NOT PER NEIGHBOUR (25/09/2026,
   * item 4 of the WP1b layout pass).
   *
   * A rival's Notice Board button used to be a native `<button disabled>`
   * whenever its power was not live right now - which is most boards, most
   * turns. A `disabled` button is pulled out of the tab order entirely, so a
   * keyboard user could never reach it to read what it offers or why it is
   * shut; only the boards that happened to be live at that moment were ever
   * reachable, and which those are changes turn to turn. Every board is now a
   * stop in ONE roving group that spans every rival - `useRovingTabIndex` is
   * the exact same hook `Farm.tsx` uses for the tableau and the hand, shared
   * from `session/rovingTabIndex.ts` so the arrow-key behaviour is identical
   * everywhere it appears. Tab enters and leaves the rail in one stop each way;
   * the arrow keys move between boards within it, live or not.
   *
   * `boardEntries` flattens every rival's boards into one ordered list before
   * render, purely so each board can be handed its position in that shared
   * group - the visual grouping by neighbour is unchanged, only the tab order
   * numbering is now computed across all of them at once.
   */
  const boardEntries = view.rivals.map((rival) => {
    const farm = farmOf(view, rival.seat);
    return { rival, farm, boards: railBoards(data, farm) };
  });
  const totalBoards = boardEntries.reduce((n, e) => n + e.boards.length, 0);
  const rove = useRovingTabIndex(totalBoards);
  let boardIndex = 0;

  return (
    <div className="rail">
      {/*
       * B21, 25/09/2026, REDESIGNED after review (attempt 2): THE STANDINGS
       * STRIP IS THE FIRST THING IN THE RAIL, NOT A FOOTER UNDER IT.
       *
       * Attempt 1 put it after the neighbour list, which read as a debug line
       * pinned to the bottom of a mostly-empty column at 1600px and up. It is
       * a scoreboard, so it goes where a scoreboard goes: the top of the rail,
       * ahead of the individual neighbour cards, as its own small card rather
       * than a strip of text. This also keeps the DOM order matching the
       * visual order (WCAG 1.3.2), which a CSS-only `order` trick would not
       * have. `.rail-neighbours` still carries the `overflow-y: auto` `.rail`
       * used to have on itself, so a table with more neighbours than fit can
       * still scroll to read one, independently of the strip above it.
       */}
      <StandingsStrip data={data} view={view} />
      <div className="rail-neighbours" aria-label="your neighbours">
        {boardEntries.map(({ rival, farm, boards }) => {
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
              /* `--seat-edge` (25/09/2026, WP2 coordination): rail.css's left
               border and fill bars key off this rather than `--seat-pip`,
               which is now near-invisible on paper for Wheat and Dairy. */
              style={{
                ['--seat-ink' as string]: meta.ink,
                ['--seat-pip' as string]: meta.pip,
                ['--seat-edge' as string]: meta.edge,
              }}
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
                  // Captured before the increment below so this board's own slot
                  // in the shared roving group does not shift under it.
                  const i = boardIndex;
                  boardIndex += 1;
                  const activate = () =>
                    play?.host(rival.seat, twoBoards ? board.boardId : undefined);
                  return (
                    /* The Notice Board is a visit target, and since 2.2.1 a
                     two-board farm offers two of them, each with its own
                     power - so each is its own click AND drop target. A
                     single-board farm keeps the one row it always had.
                     ⭐ 25/09/2026 (item 4): `disabled` REPLACED WITH
                     `aria-disabled` PLUS A CLICK/KEYDOWN GUARD. A native
                     `disabled` button cannot be focused or read by a screen
                     reader, so most boards, most turns, were invisible to a
                     keyboard user rather than merely inert. `aria-disabled`
                     keeps the semantics ("this control exists and is
                     currently unavailable") without removing the control -
                     its own text content (name, payout or reason, fill bar)
                     is the button's accessible name, so a screen reader that
                     lands on it, and a sighted keyboard user who tabs to it,
                     both get exactly what the eye already sees. */
                    <button
                      key={board.boardId}
                      data-card={board.boardId}
                      ref={rove.setRef(i)}
                      className="rival-board rival-board-live"
                      aria-disabled={!boardLive}
                      {...(play && twoBoards ? dropZone('host', rival.seat, board.boardId) : {})}
                      onClick={boardLive ? activate : undefined}
                      onFocus={() => rove.setActive(i)}
                      tabIndex={i === rove.activeIndex ? 0 : -1}
                      onKeyDown={(e) => {
                        rove.onKeyDown(i)(e);
                        if (boardLive && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          activate();
                        }
                      }}
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
    </div>
  );
}

/**
 * B21, 25/09/2026, ATTEMPT 2 (redesigned after review): A SMALL SCOREBOARD,
 * NOT A DEBUG FOOTER.
 *
 * Attempt 1 was a strip of abbreviated text ("12VP·2/6·4h") pinned under the
 * neighbour list, which read as a debug line rather than furniture that
 * belongs on this table - and the abbreviations were exactly the kind of
 * jargon the rest of this pass exists to remove. This is a real card, at the
 * TOP of the rail (see the banner on the caller), built the way the rest of
 * the game already tells a number apart from another: an ICON says what a
 * number IS, so the number itself never has to (the VP ring is the same icon
 * `Farm.tsx`'s header wears; the receipts are the same six-slot idea the
 * Farmstead's own tray prints, drawn small; the hand gets a plain card glyph
 * rather than inventing a fourth icon language).
 *
 * Every seat, you included, in turn order (`view.turnPlayer` cycles seats
 * 0..seats-1, so that is the reading order here too - not "you first"). A
 * seat's colour swatch and crop icon are the same two things `Farm.tsx` and
 * this file's own rival cards already use to say whose row this is, so nobody
 * has to learn a second way to recognise a seat. The current player's row is
 * washed the same way an active neighbour already is; the leader (by VP, ties
 * share it) gets a small star rather than a text chip; and the seat that
 * triggered the end gets ONE line above the list ("Final round...") instead
 * of a chip repeated on its own row.
 *
 * ⚠️ IT READS THE SAME "VP" `RivalRail` AND THE FARM HEADER ALREADY DO
 * (`receiptTotal`, island receipts only, NOT the full end-of-game score - see
 * the reasoning on `farm-vp` in `Farm.tsx`), on purpose: this is the public
 * session view, which cannot see a rival's hand contents or run the end-game
 * formulas that need the true state (`view/scoring.ts` is the FINAL-score
 * module and only runs off `GameScore`, at game end). A live standings card
 * has to read off the SAME public numbers the rest of the table already
 * shows, or it would disagree with the rail's own rival rows mid-game, which
 * is worse than a card that only ever shows part of the score.
 *
 * Names drop "farm" and "You (...)" - a crop icon plus the crop's own label
 * ("Wheat", "Orchard") says whose row it is exactly as well, in less width,
 * and the row highlight plus an underline on your own name (`.standing-you`)
 * carry the rest. `title`/`aria-label` on every row still spell the whole
 * thing out for a screen reader or a hover, "You: 10 VP, 2 of 6 island
 * deliveries, 2 cards in hand", never abbreviated.
 */
function StandingsStrip({ data, view }: { data: GameData; view: PlayerView }) {
  const suits = seatSuits(view);
  const target = data.rules.endGame.deliveriesToTrigger;
  const rows = Array.from({ length: view.seats }, (_, i) => i as Seat).map((seat) => {
    const farm = farmOf(view, seat);
    return { seat, farm, vp: receiptTotal(farm.receipts), receipts: farm.receipts.length };
  });
  const topVp = Math.max(0, ...rows.map((r) => r.vp));

  return (
    <div className="standings" aria-label="standings">
      {/* Hidden at the floor (`rail.css`'s own media query): the icons on
          each row already say what the numbers are, so the title is a
          1600px-and-up affordance ("this is a card") rather than information
          the floor can spend its few spare px on. */}
      <h3 className="standings-title">Standings</h3>
      {view.endTrigger !== null && (
        // One short line rather than a repeated per-row chip, per the
        // review. `Table.tsx`'s own end-trigger banner already states the
        // mechanic in full elsewhere on screen, so this only needs to say
        // THAT the last round is on; the rest is on its `title`.
        <p
          className="standings-final"
          title={`${seatName(suits[view.endTrigger.seat], view.endTrigger.seat, view.seat)} reached ${target} deliveries. One more turn each, then the game ends.`}
        >
          Final round
        </p>
      )}
      <ul className="standings-list">
        {rows.map((row) => {
          const isYou = row.seat === view.seat;
          const isTurn = view.turnPlayer === row.seat;
          const isLeader = topVp > 0 && row.vp === topVp;
          const suit = suits[row.seat];
          const label = suit ? SUIT_META[suit].label : `Seat ${row.seat}`;
          // The full sentence lives in `title` and `aria-label`, for a mouse
          // hover and for a screen reader; the icons beside the numbers carry
          // the same meaning for a sighted reader without spelling it out in
          // words on every row (that was attempt 1's "12VP·2/6·4h").
          const detail =
            `${isYou ? 'You: ' : ''}${row.vp} VP, ${row.receipts} of ${target} island deliveries, ${row.farm.handCount} card${row.farm.handCount === 1 ? '' : 's'} in hand` +
            (isLeader ? '. Leading on VP' : '');
          return (
            <li
              key={row.seat}
              className={`standing${isTurn ? ' standing-turn' : ''}${isYou ? ' standing-you' : ''}`}
              title={detail}
              aria-label={detail}
            >
              <span
                className="standing-swatch"
                aria-hidden="true"
                style={{ background: suit ? SUIT_META[suit].edge : 'var(--ink-line)' }}
              />
              {suit && <img className="standing-crop" src={cropIcon(suit)} alt="" />}
              <span className="standing-name">{label}</span>
              {isLeader && <LeaderStar />}
              <span className="standing-stat standing-vp" aria-hidden="true">
                <img src={frame('vp')} alt="" />
                {row.vp}
              </span>
              <span className="standing-stat standing-receipts" aria-hidden="true">
                {Array.from({ length: target }, (_, i) => (
                  <i
                    key={i}
                    className={`standing-pip${i < row.receipts ? ' standing-pip-filled' : ''}`}
                  />
                ))}
              </span>
              <span className="standing-stat standing-hand" aria-hidden="true">
                <HandGlyph />
                {row.farm.handCount}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The leader's mark: a small drawn star rather than emoji, so it never
    depends on a font's symbol coverage (the same reason `suits.ts` draws
    every pip and `Meeple.tsx` draws every Worker rather than painting one). */
function LeaderStar() {
  return (
    <svg
      className="standing-crown"
      viewBox="0 0 24 24"
      width="11"
      height="11"
      aria-hidden="true"
      focusable="false"
    >
      <title>Leading on VP</title>
      <path
        d="M12 1.5l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.8 7.1-.7z"
        fill="currentColor"
      />
    </svg>
  );
}

/** A plain playing-card glyph for "cards in hand" - one shape rather than a
    fourth icon family, so it reads as "a card" without competing with the VP
    ring or the receipt pips for attention. */
function HandGlyph() {
  return (
    <svg
      className="standing-hand-icon"
      viewBox="0 0 16 20"
      width="10"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="14" height="18" rx="2" fill="none" stroke="currentColor" />
    </svg>
  );
}
