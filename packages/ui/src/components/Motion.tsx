/**
 * The motion layer's mount point (B8, 25/09/2026).
 *
 * All of the actual work is `session/motion.ts`'s `CardMotion` class - this
 * component exists only to (1) give the ghost overlay a React-managed home,
 * so unmounting it cannot leave a stray fixed `<div>` behind, and (2) run the
 * one `useLayoutEffect` that calls `CardMotion.commit()` once per revision,
 * reading the rendered DOM AFTER React has committed the new state but
 * BEFORE the browser paints - exactly the seam FLIP needs.
 *
 * Renders nothing of its own: `App.tsx` mounts this once, alongside `<Table>`,
 * passing it the same `data`/`events`/`you`/`revision` it already has to hand.
 * It never touches a component this pass may not edit; everything it reads
 * back out of the DOM is through `[data-card]` and the small set of counter
 * selectors `session/motion.ts` documents.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { GameData } from '@gp/data';
import type { GameEvent, Seat } from '@gp/engine';

import type { CardMotion } from '../session/motion';

export function Motion({
  data,
  events,
  you,
  revision,
  motion,
}: {
  data: GameData;
  events: readonly GameEvent[];
  you: Seat;
  revision: number;
  motion: CardMotion;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    motion.setContainer(containerRef.current);
  }, [motion]);

  useLayoutEffect(() => {
    // Deliberately keyed on `revision` ALONE. `data` and `you` never change
    // within one session and `events` is a fresh array on every revision
    // anyway (`Session.snapshot()` slices a new one each call) - so this
    // still always reads the LATEST values through the closure, it just does
    // not re-run for a reason that was never a state change (see
    // `session/motion.ts`'s own header on why undo needs exactly one such
    // "run once, using latest props" commit rather than one per intermediate
    // move).
    motion.commit({ data, events, you });
  }, [motion, revision]);

  // Only on a genuine unmount (the table itself going away, e.g. "play
  // again"), never between revisions - an in-flight flight or ghost is not a
  // leak until nothing is left to finish watching it.
  useEffect(() => () => motion.dispose(), [motion]);

  return <div className="motion-ghosts" ref={containerRef} aria-hidden="true" />;
}
