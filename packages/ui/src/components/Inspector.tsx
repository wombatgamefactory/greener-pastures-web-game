/**
 * The rival inspector: the rail's compression, undone on demand.
 *
 * The rail deliberately carries only what a visit decision needs. Everything
 * else about a neighbour - their whole tableau at readable size, what is in
 * each stack, what they have banked - lives here, one click away.
 */

import { useEffect, useRef } from 'react';
import type { GameData } from '@gp/data';
import type { PlayerView, Seat } from '@gp/engine';

import { cropIcon, frame } from '../view/art';
import { SUIT_META, seatName } from '../view/suits';
import { doorOf, farmOf, noticeBoardOf, receiptTotal, seatSuits } from '../view/table';
import { DoorChip } from './Door';
import { Tableau } from './Farm';
import { FillBar } from './StackGauge';
import { MeepleSupply } from './Supply';
import type { Zoomer } from './Zoom';

export function Inspector({
  data,
  view,
  seat,
  cardWidth,
  zoom,
  onClose,
}: {
  data: GameData;
  view: PlayerView;
  seat: Seat;
  cardWidth: number;
  zoom: Zoomer;
  onClose(): void;
}) {
  const farm = farmOf(view, seat);
  const board = noticeBoardOf(data, farm);
  const suits = seatSuits(view);
  const meta = SUIT_META[farm.suit];
  const door = doorOf(data, farm.suit);

  /*
   * ⭐ WP5 item 1, 25/09/2026: A TRUE DIALOG, matching `Island.tsx`'s own B26
   * treatment (`role="dialog"` was already here; `aria-modal`, a focus TRAP and
   * focus RETURN were not). `Table.tsx`'s `overlaid` effect already answers
   * Escape for this overlay (`session/escape.ts`), so only Tab-trapping and
   * focus in/out are this component's own job.
   */
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      opener?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="inspector"
        style={{ ['--seat-ink' as string]: meta.ink }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${seatName(suits[seat], seat, view.seat)}'s farm`}
      >
        <header className="inspector-head">
          <img className="farm-crop" src={cropIcon(farm.suit)} alt="" />
          <h2>{seatName(suits[seat], seat, view.seat)}</h2>
          <span className="farm-vp">
            <img src={frame('vp')} alt="" />
            {receiptTotal(farm.receipts)} VP
          </span>
          {/* ⭐ Dean's ruling, 18/09/2026: there is no hand limit at the table
              (`session/table.ts` loads `rules.turn.handLimit: null`), so this
              is a plain count, for a rival exactly as it is for you. It used to
              print "hand n / 7" against `rules.turn.handLimit`, but that 7 was
              never a table rule - it is the engine's own simulator bound, kept
              so the bot's move enumeration stays inside a runtime budget (see
              the comment on the override in `session/table.ts`). If a bound
              like that is ever shown here again, it must say so and not read
              as a rule everyone at the table is playing to. */}
          <span>hand {farm.handCount}</span>
          <span>barn {farm.barnCount}</span>
          <button className="inspector-close" onClick={onClose} autoFocus>
            close
          </button>
        </header>

        <div className="inspector-visit">
          {board ? (
            <>
              <FillBar filled={board.filled} threshold={board.threshold} />
              {/* ⚠️ FIXED 18/09/2026: this used to say "Their board is full:
                  nobody can visit until they harvest it" once `filled` reached
                  `threshold` - false under S8 (13/09/2026), a Notice Board's
                  threshold is a minimum that never blocks. A visit is always
                  legal here; `harvestable` only says whether the OWNER could
                  harvest it right now, which never changes that. */}
              <span>
                One card on their Notice Board buys its power: {board.actionText}
                {board.harvestable
                  ? ' They could harvest it now, but that never stops a visit.'
                  : ''}
              </span>
            </>
          ) : (
            <span>This farm has no Notice Board, so it cannot be visited at all.</span>
          )}
        </div>

        {/* Their Workers, at full size: what free actions they are holding, and
            of which colours. On a rival's panel this is read-only - a Worker is
            spent by its owner, after their own main action. */}
        <MeepleSupply data={data} meeples={farm.meeples} label="Their Workers" />

        <div className="inspector-workers">
          <DoorChip data={data} door={door} owner="theirs" showMeeple />
        </div>

        <Tableau data={data} buildings={farm.tableau} cardWidth={cardWidth} zoom={zoom} />
      </div>
    </div>
  );
}
