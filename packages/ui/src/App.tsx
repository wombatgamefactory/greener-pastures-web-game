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
import type { Move } from '@gp/engine';

import { gameFinished, gameStarted } from './session/analytics';
import { CapturePanel } from './components/CapturePanel';
import { Result } from './components/Result';
import { Start } from './components/Start';
import { Table } from './components/Table';
import { takeCapture } from './session/capture';
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
}

export function readOptions(search: string): Boot | null {
  const q = new URLSearchParams(search);
  if (q.get('autostart') === null && q.get('seats') === null) return null;
  const seats = Math.min(4, Math.max(2, Number(q.get('seats') ?? 4) || 4));
  const asked = (q.get('suits') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Suit => (ALL_SUITS as string[]).includes(s));
  // Vegetable is in by default so the Aerodrome is on the table: worst-case
  // density is the honest case to design against.
  const suits = asked.length === seats ? asked : ALL_SUITS.slice(0, seats);
  // `finish` reuses the warm-up walk rather than adding a driver: given a depth
  // no game reaches, it plays every seat out to the end trigger and the app
  // opens on the scoring screen. That is how ticket 27's surface is measured in
  // a real browser (`verify:layout --result`), and it needs no seed to be lucky.
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
    s.warmUp(boot.depth, boot.minHand);
    return s;
  });
  const [revision, setRevision] = useState(0);
  const [pace, setPace] = useState<Pace>('normal');
  const [stalled, setStalled] = useState(false);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  // The session is mutable by design - it is the one thing holding the truth -
  // so `revision` is what tells React the snapshot is stale. It is a dependency
  // that is deliberately not read inside the callback.
  const snapshot = useMemo(
    () => (session === null || revision < 0 ? null : session.snapshot()),
    [session, revision],
  );

  const send = useCallback(
    (move: Move) => {
      session?.send(move);
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
          setSession(new Session(data, options));
          setStalled(false);
          setRevision(0);
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

  return (
    <>
      <Table
        data={data}
        view={snapshot.view}
        events={snapshot.events}
        play={play}
        canUndo={snapshot.canUndo}
        onUndo={() => {
          session.undo();
          setStalled(false);
          bump();
        }}
        waitingOn={waitingOn}
      />

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

      {/* Ticket 31. Live at every moment - mid-task, on a rival's turn, and
          over the scoring screen, which is why it is NOT inside the pace strip:
          that strip sits at z-index 60 and the result overlay's scrim is at 90,
          so a button parked in there would be unreachable on exactly the screen
          whose numbers you would most want to query. Taking a capture applies
          no move, so being live everywhere costs nothing. */}
      <CapturePanel
        take={(request) => takeCapture(session, play, request, new Date().toISOString())}
      />

      {stalled && !snapshot.over && (
        <p className="end-banner" role="status">
          Nobody can move: the card supply is locked. That is a known open question, not a crash.
        </p>
      )}

      {snapshot.over && snapshot.score && (
        <Result
          data={data}
          view={snapshot.view}
          score={snapshot.score}
          onAgain={() => {
            setSession(null);
            setRevision(0);
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
  you: { suit: 'wheat', coins: 0, hand: [], barn: {}, tableau: [], covered: [], receipts: [] },
  rivals: [],
  decks: {},
  discards: {},
  fair: [],
  island: { tiles: [] },
  aerodrome: null,
  turn: {
    actionSpent: false,
    bonusSpent: false,
    ending: false,
    visit: null,
    again: null,
    onceUsed: [],
  },
  tasks: [],
  resume: null,
} as unknown as Parameters<typeof usePlay>[0]['view'];
