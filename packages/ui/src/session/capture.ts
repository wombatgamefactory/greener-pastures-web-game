/**
 * The interface's half of a capture: what was on screen, married to the
 * session's (seed, move log).
 *
 * Ticket 31 ruled out a screenshot - a canvas grab needs a rasteriser, bloats
 * the payload past what a fixture wants, and cannot be replayed - but kept the
 * thing a screenshot was actually wanted for. The interaction layer's `Intent`
 * is already plain JSON, and it holds the one half a state replay genuinely
 * cannot reconstruct: which card was held, which assembly was open, what had
 * been picked. A replay puts the position back; this says where the hands were.
 *
 * `Session.capture` is what reaches the state, and it lives in `table.ts`
 * because that is the only module allowed to (see `boundary.test.ts`).
 */

import { captureFilename } from '@gp/engine';
import type { Capture, CaptureLabel, CaptureUi } from '@gp/engine';

import type { Play } from './play';
import type { Session } from './table';

export interface CaptureRequest {
  readonly label: CaptureLabel;
  readonly note: string;
}

export interface CaptureTaken {
  readonly capture: Capture;
  readonly filename: string;
}

/**
 * The interaction state, as JSON.
 *
 * `idle` is recorded as null rather than `{k:'idle'}` so a report that says
 * "on screen: idle" means it, and the shape stays the interface's own - the
 * engine deliberately types this field opaque so it never learns what a held
 * card is.
 */
export function uiStateOf(play: Pick<Play, 'intent' | 'picked'>): CaptureUi {
  return {
    intent: play.intent.k === 'idle' ? null : (play.intent as unknown as Record<string, unknown>),
    picked: [...play.picked],
    // Filled in by the session, which can see the pending task. Left null here
    // so there is one source for it rather than two that can disagree.
    task: null,
  };
}

export function takeCapture(
  session: Session,
  play: Pick<Play, 'intent' | 'picked'>,
  request: CaptureRequest,
  at: string,
): CaptureTaken {
  const capture = session.capture({
    label: request.label,
    note: request.note,
    at,
    ui: uiStateOf(play),
  });
  return { capture, filename: captureFilename(capture) };
}
