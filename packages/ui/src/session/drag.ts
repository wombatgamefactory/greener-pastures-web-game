/**
 * Drag a card out of the hand, at equal status with clicking it.
 *
 * Pointer Events rather than HTML5 drag-and-drop, and the reason is the ticket's
 * own touch question: HTML5 `dragstart` never fires from a finger on any mobile
 * browser, so a drag layer built on it is a mouse-only feature wearing an
 * accessibility promise. Pointer events are one code path for mouse, pen and
 * touch, and they let a press stay a click until the pointer has actually
 * travelled.
 *
 * Three things keep this from becoming a second interaction layer:
 *
 *  1. **It makes no moves.** Arming a drag calls `play.hold`; dropping calls the
 *     zone's own click handler through `dispatchDrop`. Everything a drag can do,
 *     a click can do, and by the same code.
 *  2. **It re-renders once per drag**, at the moment the press becomes a drag.
 *     The ghost is positioned by writing a transform to a ref, and the zone
 *     under the pointer is marked with an attribute, so a pointermove costs a
 *     hit-test and two DOM writes rather than a React pass over the table.
 *  3. **It is additive.** Every click path, keyboard path and glow is untouched;
 *     remove this hook and the interface still plays. Nothing is drag-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { CardId } from '@gp/engine';

import { DROP_ATTR, dispatchDrop, dropAllowed, parseDrop } from '../view/drop';
import type { DropTarget } from '../view/drop';
import type { Play } from './play';

/**
 * How far the pointer must travel before a press becomes a drag. Below this the
 * gesture is still a click, which is what lets one handler serve both without
 * the hand needing a "drag mode".
 */
const THRESHOLD = 6;

/** Marks the zone under the pointer. Set on the element, not through React. */
const HOT_ATTR = 'data-drop-hot';

/** Marks the document while a card is in flight, for cursor and hover suppression. */
const DRAGGING_CLASS = 'is-dragging';

export interface Drag {
  /** The card in flight, or null. Drives the ghost and nothing else. */
  readonly card: CardId | null;
  readonly ghost: RefObject<HTMLDivElement | null>;
  /** Begin tracking a press on a hand card. It may still turn out to be a click. */
  start(card: CardId, e: ReactPointerEvent): void;
  /**
   * True exactly once after a real drag: the browser fires a click on release
   * and the hand must not also treat it as picking the card up.
   */
  consumeClick(): boolean;
}

interface Session {
  readonly card: CardId;
  readonly x0: number;
  readonly y0: number;
  armed: boolean;
  /** Whether we took the hold ourselves, and so own cancelling it. */
  tookHold: boolean;
  over: DropTarget | null;
  hot: Element | null;
}

export function useDrag(play?: Play | undefined): Drag {
  const [card, setCard] = useState<CardId | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const session = useRef<Session | null>(null);
  const clickPending = useRef(false);
  const playRef = useRef<Play | undefined>(play);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    const place = (e: PointerEvent) => {
      const el = ghost.current;
      if (el) el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };

    const markHot = (s: Session, el: Element | null) => {
      if (s.hot === el) return;
      s.hot?.removeAttribute(HOT_ATTR);
      el?.setAttribute(HOT_ATTR, '');
      s.hot = el;
    };

    /**
     * What is under the pointer, if it will take this card. The ghost is
     * `pointer-events: none` and so is the zoom panel, so neither hides a zone.
     */
    const hitTest = (
      s: Session,
      e: PointerEvent,
    ): { target: DropTarget | null; el: Element | null } => {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const zone = under?.closest(`[${DROP_ATTR}]`) ?? null;
      const target = parseDrop(zone?.getAttribute(DROP_ATTR));
      const p = playRef.current;
      if (!target || !zone || !p) return { target: null, el: null };
      if (!dropAllowed(p.live, p.intent, target, s.card)) return { target: null, el: null };
      return { target, el: zone };
    };

    const finish = (s: Session) => {
      markHot(s, null);
      document.body.classList.remove(DRAGGING_CLASS);
      session.current = null;
      setCard(null);
    };

    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      if (!s.armed) {
        if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < THRESHOLD) return;
        s.armed = true;
        const p = playRef.current;
        // Lifting the card out of the hand IS the click path's first half, so it
        // goes through the same call - except mid-assembly, where a hand card is
        // a payment and holding it would spend it before it has been dropped.
        if (p && p.intent.k !== 'build' && p.intent.k !== 'visit') {
          p.hold(s.card);
          s.tookHold = true;
        }
        document.body.classList.add(DRAGGING_CLASS);
        setCard(s.card);
      }
      place(e);
      const { target, el } = hitTest(s, e);
      s.over = target;
      markHot(s, el);
    };

    const onUp = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      if (!s.armed) {
        session.current = null;
        return; // never travelled: it was a click, and the click handler owns it
      }
      onMove(e); // resolve the zone under the final position, not the last move
      const target = s.over;
      const p = playRef.current;
      const held = s.card;
      const tookHold = s.tookHold;
      finish(s);
      clickPending.current = true;
      if (target && p) dispatchDrop(p, target, held);
      // Dropped on nothing. Only put the card back if this drag is what took it
      // out: abandoning a payment card must not throw the whole assembly away.
      else if (tookHold) p?.cancel();
    };

    const onCancel = () => {
      const s = session.current;
      if (!s) return;
      const tookHold = s.armed && s.tookHold;
      finish(s);
      if (tookHold) playRef.current?.cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      // `usePlay` already clears the intent on Escape; this only takes the card
      // out of the air so the two cannot disagree about what is in flight.
      if (e.key === 'Escape') onCancel();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove(DRAGGING_CLASS);
    };
  }, []);

  const start = useCallback((held: CardId, e: ReactPointerEvent) => {
    const p = playRef.current;
    if (!p?.active) return;
    // A keep or a discard is answered by toggling cards in place; there is
    // nowhere on the table to drop one, so the press stays a click.
    if (p.subsetKind !== null || p.intent.k === 'choose') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // A click always follows a press, so a press is the safe place to clear a
    // suppression that was never spent - a drag released over a different
    // element fires no click at all, and the flag would otherwise eat the next
    // real one.
    clickPending.current = false;
    session.current = {
      card: held,
      x0: e.clientX,
      y0: e.clientY,
      armed: false,
      tookHold: false,
      over: null,
      hot: null,
    };
  }, []);

  const consumeClick = useCallback(() => {
    const was = clickPending.current;
    clickPending.current = false;
    return was;
  }, []);

  return { card, ghost, start, consumeClick };
}
