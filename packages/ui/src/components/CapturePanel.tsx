/**
 * The capture gesture (ticket 31): a problem observed while playing becomes a
 * reproducible artifact rather than a memory of one.
 *
 * Three things about the shape are deliberate.
 *
 * **It never blocks play.** The trigger is one small pinned button beside the
 * pace control, and the panel it opens is a popover you can Escape out of.
 * Nothing here sends a move, so opening it cannot change the game - which is
 * what makes the next point safe.
 *
 * **It fires mid-task.** Ticket 31 asked whether a capture should be possible
 * part-way through a draw or a choice, and the answer is that mid-effect states
 * are precisely where the bugs live. So the button is live at every moment,
 * including while a task is pending and including on a rival's turn, and the
 * pending task's type is recorded.
 *
 * **Two labels, one payload.** `bug` and `design-note` differ by an enum field
 * and nothing else. The design-note channel is the solo playtest log: "the Draw
 * Worker feels too strong" is worth far more with the exact position attached.
 */

import { useEffect, useState } from 'react';

import { downloadJson } from '../session/download';
import type { CaptureRequest, CaptureTaken } from '../session/capture';

const LABELS = [
  { id: 'bug', label: 'Bug', hint: 'Something the game did wrong.' },
  { id: 'design-note', label: 'Design note', hint: 'Something the game did that felt wrong.' },
] as const;

export function CapturePanel({ take }: { take(request: CaptureRequest): CaptureTaken }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<'bug' | 'design-note'>('bug');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const save = () => {
    // The position is read at the moment of the click, not when the panel was
    // opened. A bot may have moved while the note was being typed, and the
    // report must describe the table as it stands.
    const taken = take({ label, note });
    downloadJson(taken.filename, taken.capture);
    setSaved(taken.filename);
    setNote('');
    setOpen(false);
  };

  return (
    <div className="capture">
      <button
        className={`ghost${open ? ' ghost-on' : ''}`}
        onClick={() => {
          setSaved(null);
          setOpen((o) => !o);
        }}
        title="Save this exact game as a replayable report"
      >
        report
      </button>

      {saved && !open && (
        <span className="capture-saved" role="status">
          saved {saved}
        </span>
      )}

      {open && (
        <div className="capture-panel" role="dialog" aria-label="Capture a report">
          <div className="capture-labels">
            {LABELS.map((l) => (
              <button
                key={l.id}
                className={`ghost${label === l.id ? ' ghost-on' : ''}`}
                onClick={() => setLabel(l.id)}
                title={l.hint}
              >
                {l.label}
              </button>
            ))}
          </div>

          <textarea
            className="capture-note"
            value={note}
            autoFocus
            rows={4}
            placeholder={
              label === 'bug'
                ? 'What happened, and what you expected instead.'
                : 'What felt off. The exact position is attached either way.'
            }
            onChange={(e) => setNote(e.target.value)}
          />

          <p className="capture-hint">
            Saves the seed and every move played, so this game replays exactly. Nothing is sent
            anywhere.
          </p>

          <div className="capture-actions">
            <button className="ghost" onClick={() => setOpen(false)}>
              cancel
            </button>
            <button className="ghost ghost-on" onClick={save}>
              save file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
