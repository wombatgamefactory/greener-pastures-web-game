/**
 * The keyboard layer (WP5 item 2, 25/09/2026): one key per turn action, going
 * through the exact same `Play` calls the turn bar's buttons make
 * (`activateGroup`, this package's `session/play.ts`) - never constructing a
 * move of its own, and doing nothing when the family it names has no legal
 * move right now.
 *
 * ⭐ DELIBERATELY IGNORES `ActionBar.tsx`'s OWN "bonus phase" (the greyed main
 * row while the bonus slot sits open, tracked by that component's own local
 * `skipped` state). That phase is a TEACHING shape, not a second source of
 * legality: `group.moves` already reflects the true rule (the engine only
 * ever offers a `visit` or `bonusDraw` move while the window the rulebook
 * calls "first" is genuinely open), so a shortcut can read `actionGroups`
 * straight and skip re-deriving which shape the bar happens to be drawn in.
 * The practical effect: pressing V for a visit works whether or not the bar
 * is currently showing its bonus-phase greyed row, exactly as clicking the
 * (always-present, sometimes-disabled) Visit button already does once its
 * phase arrives.
 *
 * A key does nothing while the caret is in a text input (the capture note's
 * textarea is the one that exists today) and nothing while a modifier is held
 * (Ctrl/Cmd/Alt-anything is left to the browser or the OS).
 */
import { useEffect, useRef } from 'react';
import type { GameData } from '@gp/data';
import type { MoveType } from '@gp/engine';

import { activateGroup } from './play';
import type { Play } from './play';
import { actionGroups } from '../view/moveText';

/** One row per letter, bonus first then the five actions then the exit - the
    turn's own order (CLAUDE.md §2.1), so `KeyHelp.tsx` can print this table
    verbatim rather than keeping a second copy of the shape. */
export const SHORTCUTS: readonly { key: string; type: MoveType; label: string }[] = [
  { key: 'v', type: 'visit', label: 'Visit a neighbour' },
  { key: 'd', type: 'draw', label: 'Draw' },
  { key: 'b', type: 'build', label: 'Build' },
  { key: 'g', type: 'grow', label: 'Grow' },
  { key: 'h', type: 'harvest', label: 'Harvest' },
  { key: 'l', type: 'deliver', label: 'Deliver' },
  { key: 'e', type: 'endTurn', label: 'End turn' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export interface KeyboardShortcutsHost {
  readonly data: GameData;
  readonly play: Play;
  /** Z: repeat the same "undo last step" the exit row's own button sends. */
  onUndo(): void;
  /** Gates Z exactly as the exit row's own `disabled` prop gates its click. */
  canUndo: boolean;
  /** ?: open the shortcut sheet. */
  onOpenKeyHelp(): void;
  /**
   * True while a dialog with its own keyboard handling (the shortcut sheet
   * itself, How to play, the island overlay) is on screen, so a letter typed
   * there - `HowToPlay`'s own Left/Right paging, say - is never ALSO read as
   * a second, unrelated shortcut underneath it.
   */
  suspended: boolean;
}

/**
 * D / B / G / H / L / V / E play the named family exactly as its button would;
 * Enter confirms whichever assembly is docked open; Escape is NOT handled
 * here - it already has its own app-wide answer (`session/escape.ts`), and
 * duplicating it here would fight that stack rather than joining it; Z repeats
 * Undo; ? opens the shortcut sheet.
 */
export function useKeyboardShortcuts(host: KeyboardShortcutsHost): void {
  const ref = useRef(host);
  ref.current = host;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      if (h.suspended) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === '?') {
        e.preventDefault();
        h.onOpenKeyHelp();
        return;
      }

      if (!h.play.active) return;

      if (e.key === 'Enter') {
        /*
         * Confirm the open assembly. The primary button IS the confirm - "Build
         * it", "Deliver it", the visit's fee button, the keep/discard count
         * (`Prompt.tsx`'s own `.primary`) - so this presses the one already on
         * screen rather than inventing a second path to the same move. Scoped
         * to `.prompt-dock` (`Table.tsx`'s own name for the row the assemblies
         * dock into) so an unrelated primary button elsewhere on the page -
         * the start screen's "Start the game", say - can never be reached by a
         * mid-turn Enter.
         *
         * T10b (26/09/2026): `.task-tray` too - a task's keep/discard button
         * now lives in the tray under the decks (`Prompt.tsx`), not in the
         * dock, so it would otherwise have fallen out of Enter's reach.
         */
        const confirm = document.querySelector<HTMLButtonElement>(
          '.prompt-dock button.primary:not([disabled]), .task-tray button.primary:not([disabled])',
        );
        if (confirm) {
          e.preventDefault();
          confirm.click();
        }
        return;
      }

      if (e.key.toLowerCase() === 'z') {
        if (h.canUndo) {
          e.preventDefault();
          h.onUndo();
        }
        return;
      }

      const lower = e.key.toLowerCase();
      const shortcut = SHORTCUTS.find((s) => s.key === lower);
      if (!shortcut) return;
      const groups = actionGroups(h.data, h.play.view, h.play.moves);
      const group = groups.find((g) => g.type === shortcut.type && g.moves.length > 0);
      if (!group) return; // silently: exactly what a disabled button does
      e.preventDefault();
      activateGroup(h.play, group);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
