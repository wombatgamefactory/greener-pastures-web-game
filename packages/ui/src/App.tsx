/**
 * The app: a start screen, a live table, and the loop that lets the bots play.
 *
 * Ticket 24 rendered a walked position and nothing was clickable. Ticket 25
 * makes it a game, and the whole of that change is here plus `session/play.ts`:
 * the component tree below still only ever receives a `PlayerView`, a move list
 * and callbacks.
 *
 * Bot turns are played one move at a time on a timer rather than resolved in a
 * burst. Ticket 09 measured that the narrated feed makes a bot's turn
 * followable with no animation at all - but only if it arrives at a human rate,
 * which is what the pacing is for. The step control is beside the feed for
 * anyone who disagrees.
 *
 * Query string, for looking at the interface under different loads and for
 * `verify:layout`:
 *   ?autostart=1  ?seats=2..4  ?suits=wheat,vegetable  ?seed=x  ?depth=n  ?bots=balanced
 *   ?finish=1     walk the whole game out, so the scoring screen can be looked at
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Suit } from '@gp/data';
import { isPolicyId } from '@gp/bots';
import type { PolicyId } from '@gp/bots';
import type { GameEvent, Move } from '@gp/engine';

import { gameFinished, gameStarted } from './session/analytics';
import { CapturePanel } from './components/CapturePanel';
import { HowToPlay } from './components/HowToPlay';
import { KeyHelp } from './components/KeyHelp';
import { Motion } from './components/Motion';
import { Result } from './components/Result';
import { Start } from './components/Start';
import { Table } from './components/Table';
import { TurnSummary } from './components/TurnSummary';
import { UiScaleControl, useUiScale } from './components/UiScale';
import { takeCapture } from './session/capture';
import { useKeyboardShortcuts } from './session/keys';
import { CardMotion } from './session/motion';
import { eventsSinceBaseline, summariseTurns } from './session/narrate';
import type { TurnSummaryLine } from './session/narrate';
import { usePlay } from './session/play';
import { Session, YOU, data } from './session/table';
import type { SessionOptions } from './session/table';
import { seatName } from './view/suits';
import { seatSuits } from './view/table';

const ALL_SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

/** How long a bot's move sits on screen before the next one. */
const PACE = { slow: 900, normal: 420, fast: 60 } as const;
type Pace = keyof typeof PACE;

export interface Boot {
  readonly options: SessionOptions;
  readonly depth: number;
  readonly minHand: number;
  /** Play the game OUT rather than stop at a playable turn-top. See `warmUp`. */
  readonly finish: boolean;
}

export function readOptions(search: string): Boot | null {
  const q = new URLSearchParams(search);
  if (q.get('autostart') === null && q.get('seats') === null) return null;
  const seats = Math.min(4, Math.max(2, Number(q.get('seats') ?? 4) || 4));
  const asked = (q.get('suits') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Suit => (ALL_SUITS as string[]).includes(s));
  // The first suits of the list by default, Vegetable among them: worst-case
  // density is the honest case to design against.
  const suits = asked.length === seats ? asked : ALL_SUITS.slice(0, seats);
  // `finish` reuses the warm-up walk rather than adding a driver: given a depth
  // no game reaches, it plays every seat out to the end trigger and the app
  // opens on the scoring screen. That is how ticket 27's surface is measured in
  // a real browser (`verify:layout --result`), and it needs no seed to be lucky.
  //
  // ⚠️ The depth alone was never enough, and said so for a long time without
  // anyone noticing: the walk's own guard against handing over a finished board
  // rewound every one of these games back to a mid-game turn-top, so the
  // scoring screen never appeared and both verifiers hung. The `toEnd` argument
  // below is the missing half. Fixed 26/08/2026.
  const finish = q.get('finish') !== null;
  const depth = finish ? 100_000 : Number(q.get('depth') ?? 320);
  const minHand = finish ? 0 : Number(q.get('minHand') ?? 4);
  const bot = q.get('bots');
  const opponents: PolicyId[] = Array.from({ length: seats }, () =>
    bot !== null && isPolicyId(bot) ? bot : 'balanced',
  );
  return {
    options: { seats, suits, seed: q.get('seed') ?? 'greener-pastures', opponents },
    depth: Number.isFinite(depth) && depth >= 0 ? depth : 320,
    minHand: Number.isFinite(minHand) && minHand >= 0 ? minHand : 4,
    finish,
  };
}

export function App() {
  const boot = useMemo(
    () => readOptions(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );
  const [session, setSession] = useState<Session | null>(() => {
    if (boot === null) return null;
    const s = new Session(data, boot.options);
    s.warmUp(boot.depth, boot.minHand, boot.finish);
    return s;
  });
  const [revision, setRevision] = useState(0);
  const [pace, setPace] = useState<Pace>('normal');
  /* Above the early return for the start screen, so the saved preference is in
     force from the first frame rather than snapping in when a game begins. */
  const ui = useUiScale();
  const [stalled, setStalled] = useState(false);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  /*
   * B8 (25/09/2026): one `CardMotion` for the whole app's life, not one per
   * game. `useState`'s lazy initialiser runs exactly once, so this is the
   * same object across every re-render and every "Play again" - which is
   * exactly why every place below that hands the table a BRAND NEW `Session`
   * also calls `motion.notifySnapNext()` first: without it, `CardMotion`
   * would diff a fresh deal's positions against the previous game's final
   * ones and animate a meaningless flood of "moves" across two unrelated
   * boards.
   */
  const [motion] = useState(() => new CardMotion());

  /*
   * B9 (25/09/2026): "while you were away". `awayBaseline` holds the events
   * as they stood the LAST time the decision was yours - captured the instant
   * it stops being yours - so that the instant it becomes yours again,
   * `eventsSinceBaseline` names exactly the events the bots produced in
   * between. See `session/narrate.ts`'s `summariseTurns` for why this is not
   * simply "the last N events": a bot round can be any number of moves.
   */
  const [awayLines, setAwayLines] = useState<TurnSummaryLine[] | null>(null);
  const awayBaseline = useRef<readonly GameEvent[] | null>(null);
  const wasYours = useRef<boolean | null>(null);

  // The session is mutable by design - it is the one thing holding the truth -
  // so `revision` is what tells React the snapshot is stale. It is a dependency
  // that is deliberately not read inside the callback.
  const snapshot = useMemo(
    () => (session === null || revision < 0 ? null : session.snapshot()),
    [session, revision],
  );

  const send = useCallback(
    (move: Move) => {
      session?.play(move);
      bump();
    },
    [session, bump],
  );

  const play = usePlay({
    view: snapshot?.view ?? EMPTY_VIEW,
    moves: snapshot?.moves ?? [],
    active: snapshot?.yours === true && snapshot.over === false,
    revision,
    send,
  });

  // Lifted out of the `<Table onUndo={...}>` prop below (WP5 item 2, 25/09/2026)
  // so the keyboard layer's Z shortcut can send exactly the same thing a click
  // on "Undo last step" does, rather than a second copy of what undoing costs.
  //
  // B8: `session.undo()` replays a whole prefix of the move log from the deal
  // in one synchronous call (`session/table.ts`), so the commit that follows
  // can move dozens of `[data-card]` elements at once. Telling `CardMotion` to
  // skip the next one is what keeps that a silent snap rather than the bots'
  // whole game replaying at speed - see `session/motion.ts`'s own header.
  const handleUndo = useCallback(() => {
    if (!session) return;
    motion.notifySnapNext();
    session.undo();
    setStalled(false);
    setAwayLines(null);
    bump();
  }, [session, motion, bump]);

  /*
   * WP5 items 1 and 2 (25/09/2026): the "?" shortcut sheet and the How to
   * play dialog, both reachable mid-game from the turn bar's own "?" menu
   * (`ActionBar.tsx`) as well as by keyboard. Owned here, not by `Table` or
   * `ActionBar`, because `HowToPlay` and `KeyHelp` are both top-level dialogs
   * - the same reason `TurnSummary` and `Result` are siblings of `<Table>`
   * rather than its children.
   */
  const [howToOpen, setHowToOpen] = useState(false);
  const [keyHelpOpen, setKeyHelpOpen] = useState(false);

  useKeyboardShortcuts({
    data,
    play,
    onUndo: handleUndo,
    canUndo: snapshot?.canUndo ?? false,
    onOpenKeyHelp: () => setKeyHelpOpen(true),
    // Neither dialog's own Tab-trap should also feed the game a shortcut -
    // `?` opening on top of itself, or a letter typed while reading How to
    // play landing on a building underneath it.
    suspended: howToOpen || keyHelpOpen,
  });

  // One bot move per tick. The timer is torn down and rebuilt on every
  // snapshot, so the loop stops the moment the decision comes back to you.
  const stepping = useRef(false);
  useEffect(() => {
    if (session === null || snapshot === null) return;
    if (snapshot.yours || snapshot.over || stepping.current) return;
    const timer = setTimeout(() => {
      stepping.current = true;
      const moved = session.stepBot();
      stepping.current = false;
      if (moved) bump();
      // A table nobody can move in is ticket 34's supply lock, not a bug here.
      else setStalled(true);
    }, PACE[pace]);
    return () => clearTimeout(timer);
  }, [session, snapshot, pace, bump]);

  /*
   * B9: catch the two edges of a bot round. The moment it STOPS being yours,
   * `snapshot.events` (already the redacted, up-to-160 window `Session`
   * hands out) is the baseline everything after it will be measured against.
   * The moment it BECOMES yours again, `eventsSinceBaseline` names the events
   * in between and `summariseTurns` turns them into one line per rival turn.
   *
   * Deliberately reads `snapshot` alone as its dependency (not `session`,
   * `data` or `YOU`, none of which ever change mid-session) so this fires on
   * every revision exactly once, in the order the transitions actually
   * happened - a `useMemo`'d derivation would recompute on the same schedule
   * but could not tell "just arrived" from "already true", which is the
   * whole distinction this effect exists to catch.
   */
  useEffect(() => {
    if (snapshot === null) return;
    const was = wasYours.current;
    if (was === true && !snapshot.yours) {
      awayBaseline.current = snapshot.events;
    } else if (was !== true && snapshot.yours && awayBaseline.current !== null) {
      const fresh = eventsSinceBaseline(awayBaseline.current, snapshot.events);
      awayBaseline.current = null;
      const lines = summariseTurns(data, fresh, seatSuits(snapshot.view), YOU);
      if (lines.length > 0) {
        setAwayLines(lines);
        // The "outline changed objects for about 2s" half of B9: a board that
        // was visited and an island tile that was delivered to, read straight
        // off the same event window rather than re-derived from the prose
        // above. A rival's VP already pulses live as the bots play, through
        // `CardMotion`'s own counter watch (`.rival-run span`), so it needs
        // no separate treatment here.
        const targets = new Set<string>();
        for (const event of fresh) {
          if (event.e === 'cardPlaced') targets.add(event.onto.building);
          if (event.e === 'delivered') targets.add(event.tile);
        }
        motion.outline([...targets]);
      }
    }
    wasYours.current = snapshot.yours;
  }, [snapshot, motion]);

  // Report the finished table once. `over` stays true for every frame the
  // scoring screen is up, and `gameFinished` is paired with a `gameStarted`
  // that a query-string session never fires, so the ref is only guarding
  // against re-renders, not against the warm-up walk.
  const reported = useRef(false);
  useEffect(() => {
    if (snapshot === null || !snapshot.over || snapshot.score === null) return;
    if (reported.current) return;
    reported.current = true;
    gameFinished({
      seats: snapshot.view.seats,
      suit: snapshot.view.you.suit,
      moves: snapshot.played,
      rank: snapshot.score.ranking.indexOf(YOU) + 1,
      vp: snapshot.score.seats[YOU]?.total ?? 0,
    });
  }, [snapshot]);

  if (session === null || snapshot === null) {
    return (
      <Start
        onStart={(options) => {
          // B8: a brand new deal has nothing in common with whatever was on
          // screen a moment ago (the start screen itself, or a finished
          // game's result), so the next commit must resync silently rather
          // than animate every card into existence from wherever it used to
          // be.
          motion.notifySnapNext();
          setSession(new Session(data, options));
          setStalled(false);
          setRevision(0);
          setAwayLines(null);
          awayBaseline.current = null;
          wasYours.current = null;
          reported.current = false;
          gameStarted({
            seats: options.seats,
            suit: options.suits[YOU] ?? 'wheat',
            bots: options.opponents[1] ?? 'balanced',
          });
        }}
      />
    );
  }

  const suits = seatSuits(snapshot.view);
  const waitingOn =
    snapshot.over || snapshot.yours || snapshot.actor === null
      ? null
      : `${seatName(suits[snapshot.actor], snapshot.actor, YOU)} is thinking.`;
  // ⭐ Dean's ruling, 15/09/2026: the first player is now random, keeping the
  // Setup aid (`rules.setup.firstPlayer: 'random'`), so a seat can no longer
  // assume seat 0 opened. `PlayerView.firstPlayer` is absent only when it
  // genuinely is seat 0 (`packages/engine/src/view.ts`), so the fallback below
  // is a real reading of the state, not a guess.
  const firstPlayerSeat = snapshot.view.firstPlayer ?? 0;
  const firstPlayerName = seatName(suits[firstPlayerSeat], firstPlayerSeat, YOU);

  return (
    <>
      {/*
       * THE SKIP LINK (WP5 item 2, 25/09/2026): the first focusable element on
       * the table screen, before the rail and the shared table a keyboard user
       * would otherwise have to Tab through every turn just to reach the bar
       * that plays it. `.turn-zone` carries `id="turn-zone"` and `tabIndex={-1}`
       * for exactly this (`Table.tsx`) - focusing a non-interactive element by
       * id is the standard skip-link shape, but the first real button inside it
       * is a more useful landing spot than the wrapper itself, so this reaches
       * for that first and only falls back to the zone when the turn bar has
       * genuinely nothing enabled (a rival's turn: `.turn-zone` is not even
       * rendered then, and the query returns nothing to focus at all).
       */}
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          const zone = document.querySelector<HTMLElement>('.turn-zone');
          const target = zone?.querySelector<HTMLElement>('button:not([disabled])') ?? zone;
          target?.focus();
        }}
      >
        Go to your turn
      </button>
      <Table
        data={data}
        view={snapshot.view}
        events={snapshot.events}
        play={play}
        canUndo={snapshot.canUndo}
        onUndo={handleUndo}
        onShowHowToPlay={() => setHowToOpen(true)}
        onShowKeyHelp={() => setKeyHelpOpen(true)}
        waitingOn={waitingOn}
        /* The supply lock is a table-wide notice like the end trigger, so it
           goes through the same strip rather than getting a floating banner of
           its own. Both used to be `position: fixed` at the top centre, where
           they printed straight across the DECKS and THE ISLAND captions - the
           captions lost their panels in phase 2, so what had been an overlap was
           now text on text. */
        notice={
          stalled && !snapshot.over
            ? 'Nobody can move: the card supply is locked. That is a known open question, not a crash.'
            : null
        }
        /* THE QUIET CORNER (phase 4). Both of these were `position: fixed` in
           the bottom-left of the viewport, which is where the event feed's last
           line is drawn, so both printed across it in every screenshot since
           phase 0. They go into the table's rail column instead, where they get
           a row of their own and cannot overlap anything.

           Ticket 31's capture button is still live at every moment - mid-task,
           on a rival's turn, and over the scoring screen. What kept it reachable
           over the result overlay was never being a separate FIXED element, it
           was its z-index; that is unchanged and `verify:capture` proves it by
           clicking the button on a finished game. */
        corner={
          <>
            {/* ⭐ Dean's ruling, 15/09/2026: the first player is random, so it
                is worth saying who it was rather than leaving it to be read off
                the seating order. Plain text in the rail's foot, alongside the
                other small controls - no styling of its own, so it reads as an
                ordinary line rather than a badge that needs `table.css` work. */}
            <span>First to play: {firstPlayerName}</span>
            <CapturePanel
              take={(request) => takeCapture(session, play, request, new Date().toISOString())}
            />
            {/* ⚠️ THE SLIDER SITS BEFORE THE PACE STRIP, and the reason is
                packing rather than taste. `.rail-foot` wraps, and it wraps in
                source order: at the 1024 floor the row has about 180px, the
                capture button takes 55 and the three pace buttons take 130 as
                one indivisible group, so `report` and `pace` can never share a
                line. Putting the 82px slider between them fills the first line
                (55 + 82) and leaves the pace strip the second - two lines
                instead of three, and the line saved comes off the 1fr row above,
                which is where the three neighbour panels live. */}
            <UiScaleControl ui={ui} />
            <div className="pace" aria-label="how fast your neighbours play">
              {(Object.keys(PACE) as Pace[]).map((p) => (
                <button
                  key={p}
                  className={`ghost${pace === p ? ' ghost-on' : ''}`}
                  onClick={() => setPace(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        }
      />

      {/* B8: reads exactly what `<Table>` above already has - no new prop
          reaches into `session/table.ts` or `session/play.ts` for this. */}
      <Motion data={data} events={snapshot.events} you={YOU} revision={revision} motion={motion} />

      {/* B9: dismissible on Escape or its own close button; covers no live
          click target (`tools/verify-motion.mjs` hit-tests this for real). */}
      <TurnSummary lines={awayLines} onDismiss={() => setAwayLines(null)} />

      {/* WP5 items 1 and 2 (25/09/2026): mid-game How to play and the
          shortcut sheet, reachable from `ActionBar.tsx`'s "?" menu or by
          pressing `?`. Both are real dialogs (`session/escape.ts` for the
          Escape half); mounting them here rather than inside `Table` keeps
          them siblings of it exactly as `Result` and `TurnSummary` already
          are. */}
      <HowToPlay data={data} open={howToOpen} onClose={() => setHowToOpen(false)} />
      <KeyHelp open={keyHelpOpen} onClose={() => setKeyHelpOpen(false)} />

      {snapshot.over && snapshot.score && (
        <Result
          data={data}
          view={snapshot.view}
          score={snapshot.score}
          onAgain={() => {
            motion.notifySnapNext();
            setSession(null);
            setRevision(0);
            setAwayLines(null);
            awayBaseline.current = null;
            wasYours.current = null;
          }}
          /*
           * "Play again (same seats)" (manager note, 25/09/2026, wiring
           * `Result.tsx`'s `onReplay`, added by the onboarding pass). Same
           * seats, same crops, same bot temperaments - `session.options`
           * spread as-is - with a fresh deal: the seed is derived rather than
           * reused outright, so clicking it twice in a row does not deal the
           * identical game twice. Without this the component falls back to a
           * page reload that reseats the crops but starts every bot's
           * temperament over.
           */
          onReplay={() => {
            motion.notifySnapNext();
            setSession(
              new Session(data, {
                ...session.options,
                seed: `${session.options.seed}-replay-${Date.now().toString(36)}`,
              }),
            );
            setStalled(false);
            setRevision(0);
            setAwayLines(null);
            awayBaseline.current = null;
            wasYours.current = null;
            reported.current = false;
          }}
        />
      )}
    </>
  );
}

/**
 * A view-shaped placeholder for the frames before a session exists. `usePlay`
 * is a hook and cannot be called conditionally; nothing renders from this.
 */
const EMPTY_VIEW = {
  seat: 0,
  seats: 0,
  suitsInPlay: [],
  turnPlayer: 0,
  phase: 'playing',
  endTrigger: null,
  you: {
    suit: 'wheat',
    meeples: { wheat: 0, vegetable: 0, orchard: 0, apiary: 0, dairy: 0 },
    hand: [],
    barn: {},
    tableau: [],
    receipts: [],
  },
  rivals: [],
  decks: {},
  discards: {},
  fair: [],
  island: { tiles: [] },
  turn: {
    actionSpent: false,
    bonusUsed: [],
    ending: false,
    onceUsed: [],
    firedThisTurn: [],
  },
  tasks: [],
  resume: null,
} as unknown as Parameters<typeof usePlay>[0]['view'];
