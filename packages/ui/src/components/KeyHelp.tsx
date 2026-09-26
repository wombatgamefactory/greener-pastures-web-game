/**
 * The shortcut sheet (WP5 item 2, 25/09/2026): what `?` opens, and what the
 * turn bar's own "?" button reaches too. A short, accessible dialog rather
 * than a tooltip - the same shape `HowToPlay.tsx` already uses (`role="dialog"`,
 * `aria-modal`, focus moves in on open and Tab is kept inside it, Escape
 * closes and focus goes back to whatever opened it), because a second dialog
 * idiom on the same page would be one more thing to get right rather than one
 * fewer.
 *
 * The table itself is `session/keys.ts`'s own `SHORTCUTS`, printed here rather
 * than retyped, so a shortcut added there is taught here for free.
 */

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { SHORTCUTS } from '../session/keys';
import { useEscapeKey } from '../session/escape';

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Rows this dialog prints beyond the one-key-per-family table. */
const EXTRA_ROWS: readonly { key: string; label: string }[] = [
  { key: 'Enter', label: 'Confirm the open assembly' },
  { key: 'Escape', label: 'Cancel, or close whatever dialog is open' },
  { key: 'Z', label: 'Undo your last step this turn' },
  { key: '?', label: 'This sheet' },
];

export function KeyHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  // Focus in on open, and back to the opener on close - the same pattern
  // `HowToPlay.tsx` uses, captured at open time for the same reason: by the
  // time this effect's cleanup runs, `opener.current` is still whatever was
  // focused the moment the dialog appeared.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>('.keyhelp-close');
    first?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open]);

  useEscapeKey(onClose, open);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="overlay keyhelp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="keyhelp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyhelp-title"
        onKeyDown={onKey}
      >
        <header className="keyhelp-head">
          <h2 id="keyhelp-title">Keyboard shortcuts</h2>
          <button type="button" className="keyhelp-close" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="keyhelp-note">
          Every shortcut does exactly what the matching button does, and does nothing when that
          button would be disabled.
        </p>
        <table className="keyhelp-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.key}>
                <td>
                  <kbd>{s.key.toUpperCase()}</kbd>
                </td>
                <td>{s.label}</td>
              </tr>
            ))}
            {EXTRA_ROWS.map((row) => (
              <tr key={row.key}>
                <td>
                  <kbd>{row.key}</kbd>
                </td>
                <td>{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
