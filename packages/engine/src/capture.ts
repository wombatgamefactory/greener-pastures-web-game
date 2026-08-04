/**
 * The capture envelope: a problem observed while playing, turned into a
 * reproducible artifact rather than a memory of one. Wayfinder ticket 31.
 *
 * It lives in the engine because it is ticket 04's save format wearing a label:
 * `(data fingerprint, seed, move list)` replays to a bit-identical final state
 * and event stream, and ticket 04 names bug reports as one of the four things
 * standing on that contract. So a capture carries no description of what went
 * wrong and no state dump. It carries the seed and the log, and the bug happens
 * again, every time.
 *
 * Two writers and one reader share this module, which is the whole reason it is
 * here rather than in either of them:
 *
 *   @gp/ui   the capture button, mid-game, with a human's note attached.
 *   @gp/sim  a balance run whose game threw, emitted automatically.
 *   @gp/sim  the replay CLI, which reads either and reproduces it.
 *
 * Nothing in here does I/O or knows a date - the engine may do neither. The
 * caller supplies the timestamp and writes the bytes.
 *
 * The `policies` field is typed as plain strings on purpose. A policy id belongs
 * to @gp/bots, replay does not need one (a bot's move is in the log like any
 * other), and the engine must not learn what a bot is to carry a label.
 */

import type { Suit } from '@gp/data';

import { clonePlain } from './clone.js';
import { apply, isOver, legalMoves } from './game.js';
import { newGame } from './setup.js';
import type { GameState, Move, Seat } from './state.js';
import { ENGINE_VERSION, RULES_EDITION } from './version.js';

/** Bumped when the envelope's shape changes in a way a reader must notice. */
export const CAPTURE_FORMAT = 1;

/**
 * Two labels, one gesture, one payload. `design-note` is the solo playtest log:
 * "the Draw Worker feels too strong" is worth far more with the exact position
 * attached, and it feeds the same loop as the watch-list assertions.
 */
export type CaptureLabel = 'bug' | 'design-note';

export type CaptureOrigin = 'ui' | 'sim';

/** Everything `newGame` needs to deal the identical table. */
export interface CaptureSetup {
  readonly seed: string;
  readonly seats: number;
  readonly suits: readonly Suit[];
  /**
   * The passive decks, when the writer chose them. The UI lets the seed deal
   * them, so this is absent there and present for every simulator capture.
   */
  readonly neutralSuits?: readonly Suit[];
}

/**
 * What the interface was in the middle of. Ticket 31 settled "no screenshot,
 * but record the UI intent": a canvas grab cannot be replayed and needs a
 * rasteriser, while the interaction state is already plain JSON and is the one
 * half a state replay genuinely cannot reconstruct - which card was held, which
 * assembly was open, what had been picked.
 *
 * `intent` is deliberately opaque here. Its shape belongs to @gp/ui, and an
 * engine that knew about held cards and open panels would have a second job.
 */
export interface CaptureUi {
  readonly intent: Record<string, unknown> | null;
  readonly picked: readonly string[];
  /** The pending task's type, if the position was mid-effect. */
  readonly task: string | null;
}

export interface Capture {
  readonly format: number;
  readonly label: CaptureLabel;
  /** Free text. Never leaves the private side: a fixture drops it (see `toFixture`). */
  readonly note: string;
  /** ISO 8601, supplied by the caller. The engine has no clock. */
  readonly at: string;
  readonly origin: CaptureOrigin;
  readonly engineVersion: string;
  readonly rulesEdition: string;
  /** Build or commit id, when the writer knows one. */
  readonly appVersion: string | null;
  /** `cards.meta.sourceSha256 + overlay tag`. A v15 sheet moves this. */
  readonly dataFingerprint: string;
  /** The overlay in use, by path or name. Metadata: the fingerprint is the gate. */
  readonly overlay: string | null;
  readonly setup: CaptureSetup;
  readonly policies: readonly string[];
  readonly moves: readonly Move[];
  /** Whose chair the capture was taken from. Seat 0 in a UI capture. */
  readonly seat: Seat;
  /**
   * Which turn the game was on.
   *
   * Counted by the writer, which can see `turnPlayer` change - NOT derived from
   * the log here, and the difference is not academic. A log's `seat` field
   * changes on every cross-player task answer as well as on a turn boundary
   * (ticket 04 supports cross-player tasks), so counting seat changes overstates
   * a real 3-seat game by about 10%. Measured, on the first capture ever
   * replayed: 147 against a true 133.
   */
  readonly turn: number;
  readonly ui: CaptureUi | null;
  /** The engine's message, when the capture was emitted by a throw. */
  readonly error: string | null;
}

export interface CaptureInput {
  readonly label: CaptureLabel;
  readonly note: string;
  readonly at: string;
  readonly origin: CaptureOrigin;
  readonly dataFingerprint: string;
  readonly setup: CaptureSetup;
  readonly policies: readonly string[];
  readonly moves: readonly Move[];
  readonly seat: Seat;
  readonly turn: number;
  readonly appVersion?: string | null;
  readonly overlay?: string | null;
  readonly ui?: CaptureUi | null;
  readonly error?: string | null;
}

/**
 * The one place the envelope is written. Thin by design: everything a reader
 * needs comes from the caller except the stamps, and having a single
 * constructor is what stops the UI and the simulator drifting into two formats.
 */
export function makeCapture(input: CaptureInput): Capture {
  return {
    format: CAPTURE_FORMAT,
    label: input.label,
    note: input.note,
    at: input.at,
    origin: input.origin,
    engineVersion: ENGINE_VERSION,
    rulesEdition: RULES_EDITION,
    appVersion: input.appVersion ?? null,
    dataFingerprint: input.dataFingerprint,
    overlay: input.overlay ?? null,
    setup: {
      seed: input.setup.seed,
      seats: input.setup.seats,
      suits: [...input.setup.suits],
      ...(input.setup.neutralSuits ? { neutralSuits: [...input.setup.neutralSuits] } : {}),
    },
    policies: [...input.policies],
    moves: input.moves.map((m) => clonePlain(m)),
    seat: input.seat,
    turn: input.turn,
    ui: input.ui ?? null,
    error: input.error ?? null,
  };
}

/**
 * A filename that sorts by time and says what it is at a glance. The suffix is
 * a cheap hash of (seed, length) so two captures taken in the same second from
 * different games cannot collide.
 */
export function captureFilename(capture: Capture): string {
  const stamp = capture.at.replace(/[:.]/g, '-').replace(/z$/i, '');
  return `gp-${capture.label}-${stamp}-${shortHash(capture)}.json`;
}

function shortHash(capture: Capture): string {
  const text = `${capture.setup.seed}|${capture.setup.seats}|${capture.moves.length}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 4);
}

// --- reading ----------------------------------------------------------------

/**
 * Validate the envelope of an arbitrary JSON blob, and nothing deeper.
 *
 * Moves are checked only for the shape a reader indexes on (`type` and `seat`).
 * Validating the whole union here would be a second source of truth for what a
 * legal move looks like, and it is not needed: `apply` re-validates everything
 * and throws, so a malformed move surfaces during replay as exactly the failure
 * the file is claiming to reproduce.
 */
export function parseCapture(input: unknown): Capture {
  const bad = (why: string): never => {
    throw new Error(`Not a capture file: ${why}`);
  };
  if (typeof input !== 'object' || input === null) return bad('not an object');
  const raw = input as Record<string, unknown>;
  if (typeof raw.format !== 'number') return bad('no format field');
  if (raw.format > CAPTURE_FORMAT) {
    return bad(`format ${raw.format} is newer than this engine reads (${CAPTURE_FORMAT})`);
  }
  if (raw.label !== 'bug' && raw.label !== 'design-note') return bad(`unknown label ${raw.label}`);
  const setup = raw.setup as Record<string, unknown> | undefined;
  if (!setup || typeof setup.seed !== 'string') return bad('no setup.seed');
  if (typeof setup.seats !== 'number') return bad('no setup.seats');
  if (!Array.isArray(setup.suits)) return bad('no setup.suits');
  if (!Array.isArray(raw.moves)) return bad('no move log');
  raw.moves.forEach((move, i) => {
    const m = move as Record<string, unknown> | null;
    if (typeof m !== 'object' || m === null || typeof m.type !== 'string') {
      bad(`move ${i} is not a move`);
    }
  });

  return {
    format: raw.format,
    label: raw.label,
    note: typeof raw.note === 'string' ? raw.note : '',
    at: typeof raw.at === 'string' ? raw.at : '',
    origin: raw.origin === 'sim' ? 'sim' : 'ui',
    engineVersion: typeof raw.engineVersion === 'string' ? raw.engineVersion : 'unknown',
    rulesEdition: typeof raw.rulesEdition === 'string' ? raw.rulesEdition : 'unknown',
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : null,
    dataFingerprint: typeof raw.dataFingerprint === 'string' ? raw.dataFingerprint : 'unknown',
    overlay: typeof raw.overlay === 'string' ? raw.overlay : null,
    setup: {
      seed: setup.seed,
      seats: setup.seats,
      suits: setup.suits as Suit[],
      ...(Array.isArray(setup.neutralSuits) ? { neutralSuits: setup.neutralSuits as Suit[] } : {}),
    },
    policies: Array.isArray(raw.policies) ? (raw.policies as string[]) : [],
    moves: raw.moves as Move[],
    seat: typeof raw.seat === 'number' ? raw.seat : 0,
    turn: typeof raw.turn === 'number' ? raw.turn : 0,
    ui: (raw.ui as CaptureUi | null) ?? null,
    error: typeof raw.error === 'string' ? raw.error : null,
  };
}

/**
 * The readable record, which is what a capture degrades to when it can no
 * longer replay.
 *
 * Ticket 31 settled that a stale report is not dead: the numbers a design note
 * was written about may have moved, but "the Draw Worker feels too strong on
 * turn 12 of a 3-seat game" keeps every bit of its value when the sheet is
 * re-extracted. Only the replay dies, and it says so.
 */
export function describeCapture(capture: Capture): string {
  const lines = [
    `${capture.label === 'bug' ? 'BUG' : 'DESIGN NOTE'}  ${capture.at}  (${capture.origin})`,
    '',
    `  seed        ${capture.setup.seed}`,
    `  table       ${capture.setup.seats} seats, ${capture.setup.suits.join(' / ')}` +
      (capture.setup.neutralSuits ? ` (neutral: ${capture.setup.neutralSuits.join(', ')})` : ''),
    `  seat        ${capture.seat}${capture.origin === 'ui' ? ' (yours)' : ''}`,
    `  turn        ${capture.turn}, after ${capture.moves.length} moves`,
    `  policies    ${capture.policies.length ? capture.policies.join(', ') : '(none recorded)'}`,
    `  engine      ${capture.engineVersion}, rules ${capture.rulesEdition}` +
      (capture.appVersion ? `, build ${capture.appVersion}` : ''),
    `  data        ${capture.dataFingerprint}${capture.overlay ? ` + overlay ${capture.overlay}` : ''}`,
  ];
  if (capture.error) lines.push('', `  threw       ${capture.error}`);
  if (capture.ui) {
    const intent = capture.ui.intent ? JSON.stringify(capture.ui.intent) : 'idle';
    lines.push(
      '',
      `  on screen   intent ${intent}` +
        (capture.ui.picked.length ? `, picked ${capture.ui.picked.join(', ')}` : '') +
        (capture.ui.task ? `, mid-task '${capture.ui.task}'` : ''),
    );
  }
  if (capture.note.trim()) {
    lines.push('', '  note', ...capture.note.split('\n').map((l) => `    ${l}`));
  }
  return lines.join('\n');
}

// --- replay -----------------------------------------------------------------

export interface ReplayThrow {
  /** Index into the move log. The move at this index is the one that threw. */
  readonly at: number;
  readonly move: Move;
  readonly error: string;
  /** What was legal in the position the throwing move was offered to. */
  readonly legal: readonly Move[];
}

export interface ReplayResult {
  /** False when the data has moved on since the capture. */
  readonly fingerprintMatches: boolean;
  readonly expectedFingerprint: string;
  readonly actualFingerprint: string;
  /** Null only when a mismatch stopped the replay before it started. */
  readonly state: GameState | null;
  /** Moves successfully applied. Equals the log length on a clean replay. */
  readonly applied: number;
  /** Completed turns reached. */
  readonly turns: number;
  readonly threw: ReplayThrow | null;
  /** True when the log ran out because the game had already ended. */
  readonly endedEarly: boolean;
  /**
   * What the game offered NEXT, once the log ran out without throwing.
   *
   * Not decoration: a crash can come from `legalMoves` rather than from a move,
   * and such a capture has no throwing move to append to its log. Its log
   * replays perfectly and the bug is one enumeration past the end. Without this
   * probe that report reads "replayed clean", which is the opposite of the
   * truth. Null when the replay threw, or the game had already ended.
   */
  readonly next: { readonly count: number; readonly error: string | null } | null;
}

export interface ReplayOptions {
  /**
   * Replay anyway on a fingerprint mismatch.
   *
   * Ticket 04 asked for a stale save to fail LOUDLY, not fatally, and the
   * distinction earns its keep: the fingerprint moves on every sheet edit, so
   * without this a capture would die for a reason unrelated to the bug it was
   * taken for. The caller is told what it is doing; the result still reports
   * the mismatch.
   */
  readonly force?: boolean;
}

/**
 * Re-deal the table and walk the log. The whole reproducibility contract in one
 * function: nothing here is a special replay mode, it is `newGame` and `apply`.
 */
export function replayCapture(
  data: Parameters<typeof newGame>[0],
  capture: Capture,
  opts: ReplayOptions = {},
): ReplayResult {
  let state = newGame(data, {
    seats: capture.setup.seats,
    suits: [...capture.setup.suits],
    ...(capture.setup.neutralSuits ? { neutralSuits: [...capture.setup.neutralSuits] } : {}),
    seed: capture.setup.seed,
  });
  const matches = state.dataFingerprint === capture.dataFingerprint;
  const head = {
    fingerprintMatches: matches,
    expectedFingerprint: capture.dataFingerprint,
    actualFingerprint: state.dataFingerprint,
  };
  if (!matches && !opts.force) {
    return {
      ...head,
      state: null,
      applied: 0,
      turns: 0,
      threw: null,
      endedEarly: false,
      next: null,
    };
  }

  let turns = 1;
  let applied = 0;
  for (const move of capture.moves) {
    if (isOver(state)) {
      return { ...head, state, applied, turns, threw: null, endedEarly: true, next: null };
    }
    const before = state;
    try {
      state = apply(data, state, move).state;
    } catch (error) {
      return {
        ...head,
        state: before,
        applied,
        turns,
        threw: {
          at: applied,
          move,
          error: error instanceof Error ? error.message : String(error),
          legal: probeLegalMoves(data, before).moves,
        },
        endedEarly: false,
        next: null,
      };
    }
    if (state.turnPlayer !== before.turnPlayer) turns += 1;
    applied += 1;
  }
  const probe = isOver(state) ? null : probeLegalMoves(data, state);
  return {
    ...head,
    state,
    applied,
    turns,
    threw: null,
    endedEarly: false,
    next: probe === null ? null : { count: probe.moves.length, error: probe.error },
  };
}

/**
 * `legalMoves` can itself be the thing that throws, and a replay that died
 * while explaining a death would report the wrong bug. So it is caught, and the
 * error is carried out rather than swallowed.
 */
function probeLegalMoves(
  data: Parameters<typeof newGame>[0],
  state: GameState,
): { moves: readonly Move[]; error: string | null } {
  try {
    return { moves: legalMoves(data, state), error: null };
  } catch (error) {
    return { moves: [], error: error instanceof Error ? error.message : String(error) };
  }
}

// --- fixtures ---------------------------------------------------------------

/**
 * A capture with everything private removed: the setup and the log, and not one
 * byte more.
 *
 * This is the half that makes the button worth having. A fixture is committed
 * on the PUBLIC side of the disclosure boundary and replayed by the test suite,
 * so a fixed bug stays fixed - but a capture also carries Dean's note and the
 * design material in it, and neither may cross. Stripping is done by
 * construction here (the fields are named, not deleted) rather than by
 * remembering to delete them.
 */
export interface Fixture {
  readonly format: number;
  /** Why this game is worth replaying. Written by hand, never copied from a note. */
  readonly why: string;
  readonly setup: CaptureSetup;
  readonly moves: readonly Move[];
  /**
   * What the capture did when it was taken. `throws` means the fixture is a
   * red test until the bug is fixed; `plays` means it is a regression guard.
   */
  readonly expect: 'plays' | 'throws';
  /**
   * The data the log was recorded against. NOT a gate - a fixture always
   * replays - but the first thing to read when one goes red. A log is legal
   * against the numbers it was captured under, so a sheet edit that moves a
   * build cost can make an old log illegal at some move, and that failure is a
   * stale fixture rather than a regression. Printing both fingerprints is what
   * tells the two apart in one glance.
   */
  readonly dataFingerprint: string;
}

export function toFixture(capture: Capture, why: string): Fixture {
  return {
    format: CAPTURE_FORMAT,
    why,
    setup: {
      seed: capture.setup.seed,
      seats: capture.setup.seats,
      suits: [...capture.setup.suits],
      ...(capture.setup.neutralSuits ? { neutralSuits: [...capture.setup.neutralSuits] } : {}),
    },
    moves: capture.moves.map((m) => clonePlain(m)),
    expect: capture.error === null ? 'plays' : 'throws',
    dataFingerprint: capture.dataFingerprint,
  };
}

/**
 * A fixture replays through the same path a capture does, minus the metadata.
 * Forced, so the replay is always actually attempted; the result still carries
 * the mismatch for the test to print.
 */
export function replayFixture(data: Parameters<typeof newGame>[0], fixture: Fixture): ReplayResult {
  return replayCapture(
    data,
    makeCapture({
      label: 'bug',
      note: '',
      at: '',
      origin: 'sim',
      dataFingerprint: fixture.dataFingerprint,
      setup: fixture.setup,
      policies: [],
      moves: fixture.moves,
      seat: 0,
      turn: 0,
    }),
    { force: true },
  );
}
