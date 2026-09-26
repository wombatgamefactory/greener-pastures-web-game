/**
 * The motion layer (B8, 25/09/2026): a small FLIP animator, no library.
 *
 * The appraisal's finding (`.scratch/ui-appraisal-2026-09-25-v1.md`, B8): only
 * four `@keyframes` existed anywhere in the interface, cards teleported on
 * every action, and a bot's turn was announced only in text. This file is the
 * whole mechanism; `components/Motion.tsx` is the thin React wrapper that
 * mounts it and `App.tsx` is the one place it is wired in.
 *
 * WHAT IT WATCHES: every `[data-card]` element the rest of the UI already
 * carries (buildings and hand cards by their real card id, barn piles as
 * `barn-<suit>`, rival Notice Boards by board id, island tiles by tile id -
 * all added by WP1's day-one scaffolding, none of it added here) plus a small,
 * hand-picked set of counter elements found by their existing CSS class,
 * because no counter carries a `data-*` hook of its own and `Farm.tsx` is not
 * a file this pass may edit. Both are read from the outside, the way the
 * brief asks for when a hook cannot be added at the source: nothing here
 * changes what any other component renders.
 *
 * HOW IT ANIMATES:
 *
 *   moved      the classic FLIP trick. The element's rect from the PREVIOUS
 *              commit and its rect NOW are compared by `data-card` key; if
 *              they differ, a `transform: translate()` runs from the old
 *              delta down to `none` over `motionDurationMs()`. This alone is
 *              everything a card built from hand needs (`data-card` is the
 *              same id in both places), because FLIP does not care whether
 *              the DOM node is literally the same one - only that the KEY is.
 *   arrived    a key present now that was not present before fades and
 *              scales in.
 *   left       a key that was present and now is not gets a cloned ghost
 *              (`cloneNode(true)` on the retained element reference, which
 *              still carries its last rendered content even once React has
 *              unmounted the original) that fades out where it was. Some
 *              departures get a BETTER destination than "fade in place" -
 *              see the event-driven pass below.
 *   event-driven ghosts   FLIP-by-key only works when the same id reappears
 *              somewhere else, which a Build reuses (the built card's id
 *              becomes the building's `data-card`) but a Visit, a Sow, a
 *              Harvest, a Deliver and a Draw do not: a visit fee's card id
 *              never reappears (it is folded into the host's board), a
 *              harvested stack collapses into a per-suit barn PILE with a
 *              different key, an island delivery spends barn cards that were
 *              never given ids at all, and a drawn card's id did not exist a
 *              moment ago. For these five the fresh `GameEvent`s since the
 *              last commit are read directly (`cardPlaced`, `harvested`,
 *              `delivered`, `cardsToHand`) and a ghost is flown from a known
 *              source to a known destination by hand. This is also what
 *              makes a bot's visit onto YOUR OWN board watchable even though
 *              your board's own element never moves or disappears: the
 *              landing pulse on `cardPlaced`'s destination fires regardless
 *              of whether a source ghost could be found at all.
 *   counters   `.strip-title em` (your hand count, your Farmstead receipts,
 *              your barn total) and `.rival-run span` (a rival's VP, hand and
 *              barn line) are text-diffed against the last commit and pulse
 *              on a change. Your own VP already pulses through an existing,
 *              unrelated mechanism (`Farm.tsx`'s `farm-vp`/`count-moved`,
 *              `styles/farm.css:505`) built before this pass, so it is left
 *              alone rather than double-animated.
 *
 * UNDO AND THE FIRST PAINT: `Session.undo()` (`session/table.ts`) replays a
 * whole prefix of the move log from the deal, which can move dozens of
 * `data-card` elements in the single commit that follows - animating all of
 * them would look like the bots playing the whole game back at speed, not an
 * undo. `App.tsx` calls `CardMotion.notifySnapNext()` right before it calls
 * `session.undo()`; the very next `commit()` then resyncs its position map
 * SILENTLY (no animation at all) instead of diffing against the pre-undo
 * positions. The very first commit after mount does the same, unconditionally
 * - there is nothing to animate FROM before the first paint has happened once.
 *
 * REDUCED MOTION: every transform-based animation above has a plain,
 * opacity-only twin, chosen by `prefersReducedMotion()` at the moment each
 * one is scheduled (not baked in once), so a viewer who changes the OS
 * setting mid-game is honoured on their very next move.
 */

import type { GameData, Suit } from '@gp/data';
import type { GameEvent, Seat } from '@gp/engine';

import { eventsSinceBaseline } from './narrate';
import { SUIT_META } from '../view/suits';

/** Falls back to this if the CSS custom property cannot be read (SSR, a test). */
const DEFAULT_DURATION_MS = 300;

/**
 * ⚠️ NOT `--motion-state`. That name already belongs to `styles/base.css`
 * (600ms, guarded by its own `prefers-reduced-motion` block) and drives every
 * ordinary hover/press transition in the interface; redefining it here would
 * change every one of THOSE transitions as a side effect of this pass, since
 * a later `@import` wins the cascade for a plain custom property. This is a
 * new, unrelated token, set in `styles/motion.css`, timed for a FLIP flight
 * rather than a hover (250-350ms per the brief; 300ms is the midpoint).
 */
const DURATION_PROPERTY = '--motion-card-duration';

const SUIT_BY_LETTER: Readonly<Record<string, Suit>> = {
  W: 'wheat',
  V: 'vegetable',
  O: 'orchard',
  A: 'apiary',
  D: 'dairy',
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function motionDurationMs(): number {
  if (typeof document === 'undefined') return DEFAULT_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(DURATION_PROPERTY).trim();
  const match = /^([\d.]+)(ms|s)?$/.exec(raw);
  if (!match?.[1]) return DEFAULT_DURATION_MS;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DURATION_MS;
  return match[2] === 's' ? value * 1000 : value;
}

/** Every `[data-card]` element on screen right now, keyed by its own attribute value. */
function measureCards(): { rects: Map<string, DOMRect>; elements: Map<string, Element> } {
  const rects = new Map<string, DOMRect>();
  const elements = new Map<string, Element>();
  document.querySelectorAll('[data-card]').forEach((el) => {
    const key = el.getAttribute('data-card');
    if (key) {
      rects.set(key, el.getBoundingClientRect());
      elements.set(key, el);
    }
  });
  return { rects, elements };
}

/** The counters this pass watches from the outside. See the file header. */
const COUNTER_SELECTORS = ['.strip-title em', '.rival-run span'];

function measureCounters(): Map<Element, string> {
  const out = new Map<Element, string>();
  for (const selector of COUNTER_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => out.set(el, el.textContent ?? ''));
  }
  return out;
}

/**
 * A deck, found by its printed label - no deck carries a `data-*` hook (the
 * day-one scaffolding stopped at `[data-card]`, and `SharedTable.tsx` is not
 * a file this pass may edit to add one).
 */
function findDeckElement(suit: Suit): Element | null {
  const label = SUIT_META[suit].label;
  for (const deck of Array.from(document.querySelectorAll('.deck'))) {
    const found = deck.querySelector('.deck-label');
    if (found?.textContent?.trim() === label) return deck;
  }
  return null;
}

export class CardMotion {
  private rects = new Map<string, DOMRect>();
  private elements = new Map<string, Element>();
  private counters = new Map<Element, string>();
  private prevEvents: readonly GameEvent[] = [];
  private initialised = false;
  private skipNext = false;
  private container: HTMLElement | null = null;
  private readonly animations = new Set<Animation>();
  private readonly ghosts = new Set<HTMLElement>();

  /** Where a ghost is appended. Defaults to `document.body` if never set. */
  setContainer(el: HTMLElement | null): void {
    this.container = el;
  }

  /** Called from `App.tsx` right before `session.undo()`: the next commit snaps instead of animating. */
  notifySnapNext(): void {
    this.skipNext = true;
  }

  /**
   * Run once per revision. `events` is the session's FULL redacted event log
   * (`Snapshot.events`, already windowed to the last 160 by `session/table.ts`);
   * this diffs it against what it saw last time to find what is fresh, the
   * same trick `session/narrate.ts`'s `eventsSinceBaseline` was written for.
   */
  commit(opts: { data: GameData; events: readonly GameEvent[]; you: Seat }): void {
    const after = measureCards();
    const afterCounters = measureCounters();
    const fresh = eventsSinceBaseline(this.prevEvents, opts.events);
    this.prevEvents = opts.events;

    const skip = this.skipNext || !this.initialised;
    this.skipNext = false;
    this.initialised = true;

    if (skip) {
      this.rects = after.rects;
      this.elements = after.elements;
      this.counters = afterCounters;
      return;
    }

    const reduced = prefersReducedMotion();
    const before = this.rects;
    const beforeElements = this.elements;
    const handled = new Set<string>();

    for (const event of fresh) {
      this.animateEvent(
        opts.data,
        event,
        opts.you,
        before,
        beforeElements,
        after,
        reduced,
        handled,
      );
    }

    after.elements.forEach((el, key) => {
      if (handled.has(key)) return;
      const b = before.get(key);
      if (!b) {
        this.fadeIn(el, reduced);
        return;
      }
      const a = after.rects.get(key);
      if (!a) return;
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      this.flip(el, dx, dy, reduced);
    });

    before.forEach((rect, key) => {
      if (handled.has(key) || after.rects.has(key)) return;
      const el = beforeElements.get(key);
      if (el) this.ghostFadeOut(el, rect, reduced);
    });

    for (const [el, text] of afterCounters) {
      const prev = this.counters.get(el);
      if (prev !== undefined && prev !== text) this.pulse(el, reduced);
    }

    this.rects = after.rects;
    this.elements = after.elements;
    this.counters = afterCounters;
  }

  /**
   * B9's "outline changed objects for about 2s", called by `TurnSummary`'s
   * mount effect in `App.tsx` with the `data-card` keys the away-summary
   * names (a board that was visited, an island tile that was delivered to).
   * A plain class toggle rather than a WAAPI animation, since 2s is well past
   * a single `.animate()` call's natural home and a lingering ring is a
   * static state, not a motion - `styles/motion.css` owns the look.
   */
  outline(keys: readonly string[], ms = 2000): void {
    if (prefersReducedMotion()) return; // a static ring needs no reduction, but nothing new is owed here either
    const wanted = new Set(keys);
    if (wanted.size === 0) return;
    document.querySelectorAll('[data-card]').forEach((el) => {
      const key = el.getAttribute('data-card');
      if (key === null || !wanted.has(key) || !(el instanceof HTMLElement)) return;
      el.classList.add('motion-outline');
      setTimeout(() => el.classList.remove('motion-outline'), ms);
    });
  }

  /** Cancel every running animation and remove every ghost. Called on unmount only. */
  dispose(): void {
    for (const anim of this.animations) anim.cancel();
    this.animations.clear();
    for (const ghost of this.ghosts) ghost.remove();
    this.ghosts.clear();
  }

  // --- event-driven ghosts, for the four moves FLIP-by-key cannot see -----

  private animateEvent(
    data: GameData,
    event: GameEvent,
    you: Seat,
    before: Map<string, DOMRect>,
    beforeElements: Map<string, Element>,
    after: { rects: Map<string, DOMRect>; elements: Map<string, Element> },
    reduced: boolean,
    handled: Set<string>,
  ): void {
    switch (event.e) {
      // A visit fee or a sow: `onto.building` is a Notice Board's or a
      // building's own `data-card` id (the same string either way, S8/S11),
      // so this is what makes a rival's visit onto YOUR board watchable even
      // though your board's own element never moves.
      case 'cardPlaced': {
        const dest = after.elements.get(event.onto.building);
        if (!dest) break;
        this.pulse(dest, reduced);
        const srcRect = before.get(event.card);
        const srcEl = beforeElements.get(event.card);
        if (srcRect && srcEl) {
          this.flyGhost(srcEl, srcRect, dest.getBoundingClientRect(), reduced);
          handled.add(event.card);
        }
        break;
      }
      // The building stays put and just empties (S8: never below 3, and
      // nothing about a harvest removes the building itself), so this is a
      // flourish layered on top of the generic "no move" case, not a
      // substitute for the departure pass.
      case 'harvested': {
        const suit = data.cards.catalogue.find((c) => c.id === event.building)?.suit;
        const dest = suit ? after.elements.get(`barn-${suit}`) : undefined;
        const srcRect = before.get(event.building);
        const srcEl = beforeElements.get(event.building);
        if (dest) {
          if (srcRect && srcEl)
            this.flyGhost(srcEl, srcRect, dest.getBoundingClientRect(), reduced);
          this.pulse(dest, reduced);
        }
        break;
      }
      // Barn cards have no ids at all (the file header explains why), so the
      // ghost flies off the per-suit PILE rather than an individual card.
      // Only your own barn is ever rendered - a rival's delivery still lands
      // watchably because the destination tile always pulses regardless.
      case 'delivered': {
        const dest = after.elements.get(event.tile);
        if (!dest) break;
        for (const suit of Object.keys(event.spend) as Suit[]) {
          const key = `barn-${suit}`;
          const srcRect = before.get(key);
          const srcEl = beforeElements.get(key);
          if (srcRect && srcEl)
            this.flyGhost(srcEl, srcRect, dest.getBoundingClientRect(), reduced);
        }
        // Always pulses, even with no visible barn source (a rival's own
        // delivery, whose barn is never rendered): still watchable.
        this.pulse(dest, reduced);
        break;
      }
      // A rival's hand is never rendered, so only your own draws get a
      // flight; the destination is the new hand card's OWN rect, already
      // sitting in `after` under its real id (masking only ever hides a
      // RIVAL's card, never your own, `session/table.ts`'s `redactEvents`).
      case 'cardsToHand': {
        if (event.seat !== you) break;
        for (const card of event.cards) {
          const suit = SUIT_BY_LETTER[card.charAt(0)];
          if (!suit) continue;
          const deckEl = findDeckElement(suit);
          const destRect = after.rects.get(card);
          if (deckEl && destRect) {
            this.flyGhost(deckEl, deckEl.getBoundingClientRect(), destRect, reduced);
            handled.add(card);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // --- the small animation primitives -------------------------------------

  private flip(el: Element, dx: number, dy: number, reduced: boolean): void {
    if (!(el instanceof HTMLElement)) return;
    const duration = motionDurationMs();
    const anim = reduced
      ? el.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration, easing: 'ease-out' })
      : el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        );
    this.track(anim);
  }

  private fadeIn(el: Element, reduced: boolean): void {
    if (!(el instanceof HTMLElement)) return;
    const duration = motionDurationMs();
    const keyframes = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'scale(0.85)' },
          { opacity: 1, transform: 'scale(1)' },
        ];
    this.track(el.animate(keyframes, { duration, easing: 'ease-out' }));
  }

  private pulse(el: Element, reduced: boolean): void {
    if (!(el instanceof HTMLElement)) return;
    const duration = motionDurationMs() * 1.1;
    const keyframes = reduced
      ? [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }]
      : [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }];
    this.track(el.animate(keyframes, { duration, easing: 'ease-in-out' }));
  }

  private ghostFadeOut(sourceEl: Element, rect: DOMRect, reduced: boolean): void {
    const ghost = this.cloneGhost(sourceEl, rect);
    if (!ghost) return;
    const duration = motionDurationMs();
    const keyframes = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.8)' },
        ];
    this.trackGhost(ghost, ghost.animate(keyframes, { duration, easing: 'ease-in' }));
  }

  private flyGhost(
    sourceEl: Element,
    sourceRect: DOMRect,
    destRect: DOMRect,
    reduced: boolean,
  ): void {
    const ghost = this.cloneGhost(sourceEl, sourceRect);
    if (!ghost) return;
    const duration = motionDurationMs() * (reduced ? 1 : 1.15);
    if (reduced) {
      this.trackGhost(
        ghost,
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' }),
      );
      return;
    }
    const dx = destRect.left - sourceRect.left;
    const dy = destRect.top - sourceRect.top;
    const sx = sourceRect.width > 0 ? clamp(destRect.width / sourceRect.width, 0.35, 1.4) : 1;
    const sy = sourceRect.height > 0 ? clamp(destRect.height / sourceRect.height, 0.35, 1.4) : 1;
    this.trackGhost(
      ghost,
      ghost.animate(
        [
          { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.1 },
        ],
        { duration, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' },
      ),
    );
  }

  private cloneGhost(sourceEl: Element, rect: DOMRect): HTMLElement | null {
    if (!(sourceEl instanceof HTMLElement)) return null;
    const ghost = sourceEl.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.removeAttribute('data-card');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.classList.add('motion-ghost');
    (this.container ?? document.body).appendChild(ghost);
    this.ghosts.add(ghost);
    return ghost;
  }

  private track(anim: Animation): void {
    this.animations.add(anim);
    void anim.finished.catch(() => {}).finally(() => this.animations.delete(anim));
  }

  private trackGhost(ghost: HTMLElement, anim: Animation): void {
    this.animations.add(anim);
    void anim.finished
      .catch(() => {})
      .finally(() => {
        this.animations.delete(anim);
        ghost.remove();
        this.ghosts.delete(ghost);
      });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
