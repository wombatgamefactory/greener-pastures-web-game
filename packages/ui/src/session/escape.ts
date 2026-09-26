/**
 * Escape, made robust against CookieYes (WP5 item 3, 25/09/2026).
 *
 * `index.html` loads a CookieYes consent script (via the `gp-analytics` Vite
 * plugin, production builds only) that installs its own capture-phase
 * `document` keydown listener for its banner. It fails to load fully offline
 * and errors on every page in a test rig with no network, but it still
 * attaches that listener first - and if it calls `stopPropagation()` (as
 * `TurnSummary.tsx`'s dated 25/09/2026 comment, now replaced by this file,
 * found by testing), a REAL, OS-level Escape never reaches a plain
 * `window`-level BUBBLE listener, because the event's capture phase already
 * stopped it before the bubble phase could begin.
 *
 * The fix is not a bubble-phase workaround, it is winning the race outright.
 * The DOM's capture phase always runs OUTSIDE IN: `window` before `document`
 * before `html` before the target, whatever order any two listeners on
 * DIFFERENT nodes were registered in (registration order only matters between
 * two listeners on the SAME node). A capture-phase listener on `window`
 * therefore always fires before ANY capture-phase listener CookieYes can put
 * on `document`, with no dependency on load timing, mount order or network
 * conditions.
 *
 * `useEscapeKey` is a small LIFO stack rather than one flat listener. Several
 * of this app's own dialogs are never open at once, but a Build/Visit/Deliver
 * assembly's own cancel and a dialog opened on top of it (say `?`'s shortcut
 * sheet, mid-assembly) both want Escape, and only the topmost one should
 * answer - the assembly must not also cancel itself the same keypress closed
 * the dialog with. Each call pushes its handler while `active` is true and
 * pops it on unmount or when `active` goes false; only the LAST active entry
 * runs, and it stops the event so nothing further down the stack (or a stray
 * page listener) reacts to the same press.
 */
import { useEffect, useRef } from 'react';

type Handler = () => void;

const stack: Handler[] = [];
let installed = false;

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      const top = stack.at(-1);
      if (!top) return;
      // Stop it here, at the very first capture-phase listener the event
      // meets, so CookieYes's own `document` listener never gets a look in
      // and nothing else on the page double-handles the same press.
      e.preventDefault();
      e.stopPropagation();
      top();
    },
    true,
  );
}

/**
 * Register `handler` for Escape while `active` is true. Mount order among
 * simultaneously-active callers is a stack: the most recently activated wins,
 * matching "the dialog on top answers, not the assembly underneath it".
 */
export function useEscapeKey(handler: () => void, active: boolean): void {
  // A ref so the stack always calls the latest closure without having to
  // re-push/re-pop on every render that only changed what `handler` closes
  // over (e.g. a fresh `onDismiss` identity from a parent that re-renders
  // often, such as the app root).
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return;
    ensureInstalled();
    const entry: Handler = () => ref.current();
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
    // `ref.current` always holds the latest `handler`, so `active` is the only
    // real dependency - there is no react-hooks plugin in this project's
    // eslint config to argue otherwise (see eslint.config.js).
  }, [active]);
}
