/**
 * THE GUIDED FIRST TURN (25/09/2026, UI polish WP4, item B14b).
 *
 * Coach marks for a player's first game: a ring around the ONE thing to click
 * next, and a short bubble saying why. The sequence is the turn itself - Visit a
 * neighbour, pick a rival's Notice Board, pay a card from your hand, finish the
 * power, take one action (Draw 2 is suggested because it is always safe), then
 * End turn - and it stops for good when that turn is done or the player says
 * "Skip the tour". Either outcome is remembered in localStorage, every access
 * wrapped, so a blocked or private-mode store simply means the tour may show
 * again, never that the page breaks.
 *
 * ⭐ IT READS THE PAGE, NOT THE SESSION, AND THAT IS DELIBERATE. The WP4 brief
 * forbids hooks in other components, so every fact here comes off the DOM the
 * table already draws: the zone heads (`.zone-head.zone-go` / `zone-spent`) say
 * which beat of the turn is open, the engine's own glow classes (`is-target`,
 * `is-live`, from `session/play.ts`'s `mark`) say what is clickable, and the
 * assemblies and prompts say what is half-done. Nothing is guessed that the
 * interface is not already showing, so the coach can never point at a move the
 * engine would refuse: it only ever points at something the legal-move filter
 * has already lit.
 *
 * ⚠️ SELECTORS ARE A CONTRACT WITH FILES THIS PACKAGE DOES NOT OWN
 * (`ActionBar.tsx`, `RivalRail.tsx`, `Farm.tsx`, `Commons.tsx`, `Prompt.tsx`,
 * `VisitPanel.tsx`). They are collected in `SEL` below so a rename is one edit
 * here. When the coach cannot find its target it degrades to a bubble with no
 * ring ("follow the glow"), never to an error.
 *
 * ⭐ IT MOUNTS ITSELF (`startCoach`). `App.tsx` swaps the start screen for the
 * table, so nothing inside `Start.tsx` survives into play; rather than ask for
 * a line in `App.tsx`, `startCoach` renders into its own root on `document.body`
 * and tears itself down when the tour ends or the start screen comes back.
 *
 * The highlighted element also carries `data-coach-target`, which is how the
 * scripted check clicks "only the highlighted element" at every step.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

const STORE_KEY = 'gp.coach.v1';

/** 'done' or 'dismissed' once the tour has run; null for a first-time player. */
export function coachRecord(): string | null {
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function remember(outcome: 'done' | 'dismissed'): void {
  try {
    window.localStorage.setItem(STORE_KEY, outcome);
  } catch {
    /* A store we cannot write only means the tour may show again. */
  }
}

/** True when this browser has not yet finished or dismissed the tour. */
export function isFirstGame(): boolean {
  return coachRecord() === null;
}

const SEL = {
  table: '.actionbar',
  start: '.start',
  bonusGo: '.zone-bonus .zone-head.zone-go',
  actionGo: '.zone-action .zone-head.zone-go',
  actionSpent: '.zone-action .zone-head.zone-spent',
  visitButton: '.zone-bonus button.action-hook:not([disabled])',
  skipBonus: '.zone-bonus .bonus-exits button',
  rivalBoards: '.rival-board-live:not([disabled])',
  visitPanel: '.assembly-visit',
  visitBoardChips: '.assembly-visit .chips .chip',
  handTarget: '.hand-card.is-target',
  handLive: '.hand-card.is-live',
  actionButtons: '.zone-action button.action:not([disabled])',
  exitButtons: '.zone-exit button.exit:not([disabled])',
  // T10b (26/09/2026): a menu's answers and a task's confirm are portalled
  // into the task tray under the decks (`Prompt.tsx`), so both selectors
  // reach there too.
  menuAnswer: '.prompt-menu .answer, .task-tray .answer',
  revealed: '.revealed-card:not(.is-picked)',
  deck: '.deck.is-target, .deck.is-live',
  tile: '.island-tile.is-target',
  confirm:
    '.prompt .primary:not([disabled]), .assembly .primary:not([disabled]), .task-tray .primary:not([disabled])',
  chip: '.assembly .chip:not(.chip-paid):not(.chip-empty)',
  building: '.building.is-target',
  meeple: '.supply-meeple.is-target',
  pendingPrompt: '.prompt:not(.prompt-quiet)',
  waiting: '.waiting-on',
} as const;

interface Step {
  /** The element to ring, or null for a bubble on its own. */
  readonly target: HTMLElement | null;
  readonly title: string;
  readonly text: string;
  /** Which beat of the turn this is, for the progress dots. */
  readonly beat: 0 | 1 | 2 | 3;
}

const q = (s: string): HTMLElement | null => document.querySelector<HTMLElement>(s);
const qa = (s: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(s)];
const visible = (el: HTMLElement | null): el is HTMLElement =>
  el !== null && el.getClientRects().length > 0;
const firstVisible = (s: string): HTMLElement | null => qa(s).find(visible) ?? null;
const byText = (s: string, text: RegExp): HTMLElement | null =>
  qa(s).find((el) => visible(el) && text.test(el.textContent ?? '')) ?? null;

/**
 * Whatever a half-finished move is waiting for, in the order a player would
 * meet it. Shared by the bonus and the action beats: after a visit the bought
 * power may still want decks or cards, and so may Draw or Build.
 */
function pending(beat: Step['beat'], doing: string): Step | null {
  const answer = firstVisible(SEL.menuAnswer);
  if (answer) return { target: answer, beat, title: doing, text: 'Choose one of these.' };
  // Decks BEFORE the turned-over cards: a see-N draw shows each card as it
  // is turned over, but only takes a keep click once every deck pick is made.
  // A deck that is a TARGET (Draw armed) always counts; a merely live one only
  // while a prompt is asking for a deck, since at rest every deck is live.
  const deck =
    firstVisible('.deck.is-target') ?? (q(SEL.pendingPrompt) ? firstVisible(SEL.deck) : null);
  if (deck)
    return {
      target: deck,
      beat,
      title: doing,
      text: 'Pick a deck to draw from. Any deck in play will do; the number is how many are left.',
    };
  const revealed = firstVisible(SEL.revealed);
  if (revealed)
    return {
      target: revealed,
      beat,
      title: doing,
      text: 'Click each card you turned over to take it into your hand.',
    };
  const tile = firstVisible(SEL.tile);
  if (tile) return { target: tile, beat, title: doing, text: 'Choose an island card.' };
  const building = firstVisible(SEL.building);
  if (building) return { target: building, beat, title: doing, text: 'Choose a building.' };
  const chip = firstVisible(SEL.chip);
  if (chip) return { target: chip, beat, title: doing, text: 'Choose what pays.' };
  const hand =
    firstVisible(SEL.handTarget) ?? (q(SEL.pendingPrompt) ? firstVisible(SEL.handLive) : null);
  if (hand) return { target: hand, beat, title: doing, text: 'Choose a card from your hand.' };
  const confirm = firstVisible(SEL.confirm);
  if (confirm) return { target: confirm, beat, title: doing, text: 'Confirm it.' };
  // An armed action with nothing ringable yet (or a prompt we cannot place)
  // still gets a word, and never a ring back on the button that armed it,
  // which would toggle it off again.
  if (q(SEL.pendingPrompt) || q('.zone-action button.action-armed'))
    return { target: null, beat, title: doing, text: 'Follow the glow on the table to finish it.' };
  return null;
}

/** Read the page and decide the one next thing to click. Null: nothing to say. */
export function nextStep(): Step | null {
  if (!q(SEL.table)) return null;
  if (visible(q(SEL.waiting)))
    return {
      target: null,
      beat: 0,
      title: 'Your neighbours go first',
      text: 'Watch the table talk on the left. Your turn comes round in a moment.',
    };

  if (q(SEL.bonusGo)) {
    const panel = q(SEL.visitPanel);
    if (panel) {
      const boardChip = firstVisible(SEL.visitBoardChips);
      if (boardChip && /two Notice Boards/.test(panel.textContent ?? ''))
        return {
          target: boardChip,
          beat: 1,
          title: 'Pick one of their two boards',
          text: 'At two players every farm has two Notice Boards. Each has its own power.',
        };
      const hand = firstVisible(SEL.handTarget) ?? firstVisible(SEL.handLive);
      if (hand)
        return {
          target: hand,
          beat: 1,
          title: 'Pay with a card from your hand',
          text: 'Any card pays. It stays pinned on their board, and when they harvest it, it is theirs. Pick the one you need least.',
        };
    }
    const boards = qa(SEL.rivalBoards).filter(visible);
    const armed = qa('.rival.is-target').length > 0;
    if (armed && boards.length > 0) {
      // Draw 4 (the Orchard board) is the gentlest first power: it asks for
      // nothing but decks. Otherwise the first board the rail lights.
      const easy = boards.find((b) => /Draw/.test(b.textContent ?? '')) ?? boards[0]!;
      return {
        target: easy,
        beat: 1,
        title: "Choose a neighbour's Notice Board",
        text: 'Its printed power is what your card buys, used at once as if it were yours.',
      };
    }
    const visit = firstVisible(SEL.visitButton);
    if (visit)
      return {
        target: visit,
        beat: 1,
        title: 'First, visit a neighbour',
        text: "Your turn starts with a bonus: pay one card onto a rival's Notice Board and take its power. You cannot run your farm alone.",
      };
    const skip = firstVisible(SEL.skipBonus);
    if (skip)
      return {
        target: skip,
        beat: 1,
        title: 'No visit this turn',
        text: 'No neighbour has a power you can use right now, so skip the bonus.',
      };
  }

  if (q(SEL.actionGo)) {
    // With the action still open, a half-done move is either the power the
    // visit bought (nothing armed on the bar) or the action being assembled.
    const armed = q('.zone-action button.action-armed') !== null;
    const doing = pending(armed ? 2 : 1, armed ? 'Finish your action' : 'Now use their power');
    if (doing) return doing;
    const draw = byText(SEL.actionButtons, /Draw/) ?? firstVisible(SEL.actionButtons);
    if (draw)
      return {
        target: draw,
        beat: 2,
        title: 'Now take one action',
        text: 'Draw 2 is always safe on a first turn. Build, Grow, Harvest and Deliver are here too.',
      };
  }

  if (q(SEL.actionSpent)) {
    const doing = pending(2, 'Finish your action');
    if (doing) return doing;
    const end = byText(SEL.exitButtons, /End turn/);
    if (end)
      return {
        target: end,
        beat: 3,
        title: "That's a whole turn",
        text: 'If you held a Worker you could spend one now. Otherwise end your turn.',
      };
  }
  return null;
}

/** Rings and bubble, positioned against the target's box every frame. */
export function Coach({ onFinish }: { onFinish(): void }) {
  const [step, setStep] = useState<Step | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [finished, setFinished] = useState(false);
  const seenSpent = useRef(false);
  const seenMine = useRef(false);
  const seenTable = useRef(false);
  const tagged = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (!q(SEL.table) || q(SEL.start)) {
        // Back at the start screen (the result screen's "New setup"): the tour
        // has nothing to point at any more. ⚠️ Only once the table has been
        // seen - `startCoach` runs from the start button's click, so the first
        // ticks still find the start screen on its way out.
        if (seenTable.current && q(SEL.start)) onFinish();
        return;
      }
      seenTable.current = true;
      const next = nextStep();
      // The tour is complete once the action has been spent and the turn has
      // then moved on (the action zone is no longer spent). ⚠️ Not "once End
      // turn is clicked": with no Worker to spend the engine ends the turn by
      // itself, so the End turn step is often never shown.
      // ⚠️ Both facts are read only on the PLAYER'S turn: the zone heads
      // describe whoever is moving, so a bot's spent action reads "spent" too.
      const mine = !visible(q(SEL.waiting));
      if (mine && q(SEL.bonusGo)) seenMine.current = true;
      if (mine && seenMine.current && q(SEL.actionSpent)) seenSpent.current = true;
      else if (seenSpent.current && !q(SEL.actionSpent)) {
        remember('done');
        tagged.current?.removeAttribute('data-coach-target');
        tagged.current = null;
        setFinished(true);
        setStep(null);
        setRect(null);
        return;
      }
      const target = next?.target ?? null;
      if (tagged.current !== target) {
        tagged.current?.removeAttribute('data-coach-target');
        target?.setAttribute('data-coach-target', '');
        tagged.current = target;
      }
      setStep((prev) =>
        prev?.target === target && prev?.title === next?.title && prev?.text === next?.text
          ? prev
          : next,
      );
      const r = target?.getBoundingClientRect() ?? null;
      setRect((prev) =>
        prev &&
        r &&
        prev.x === r.x &&
        prev.y === r.y &&
        prev.width === r.width &&
        prev.height === r.height
          ? prev
          : r,
      );
    };
    const id = window.setInterval(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }, 120);
    tick();
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf);
      tagged.current?.removeAttribute('data-coach-target');
    };
  }, [onFinish]);

  const skip = () => {
    remember('dismissed');
    tagged.current?.removeAttribute('data-coach-target');
    onFinish();
  };

  if (finished)
    return (
      <div className="coach-bubble coach-bubble-free coach-done" role="status">
        <p className="coach-title">You played your first turn</p>
        <p className="coach-text">
          Visit, one action, then a Worker if you have one. The How to play pages on the start
          screen have the rest.
        </p>
        <button type="button" className="primary coach-ok" onClick={onFinish}>
          Got it
        </button>
      </div>
    );
  if (step === null) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 6;
  const bubbleW = Math.min(vw >= 2400 ? 460 : 340, vw - 24);
  let style: CSSProperties | undefined;
  if (rect) {
    const below = rect.bottom + 14;
    const aboveRoom = rect.top - 14;
    // Prefer above the target (the turn bar and hand sit low on the screen),
    // then below, then beside; always clamped inside the viewport.
    const left = Math.max(
      12,
      Math.min(rect.left + rect.width / 2 - bubbleW / 2, vw - bubbleW - 12),
    );
    style =
      aboveRoom > 190
        ? { left, bottom: vh - aboveRoom, width: bubbleW }
        : below + 190 < vh
          ? { left, top: below, width: bubbleW }
          : {
              top: Math.max(12, Math.min(rect.top, vh - 220)),
              left: rect.left > vw / 2 ? Math.max(12, rect.left - bubbleW - 14) : rect.right + 14,
              width: bubbleW,
            };
  }

  return (
    <>
      {rect && (
        <div
          className="coach-ring"
          aria-hidden="true"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div
        className={`coach-bubble${rect ? '' : ' coach-bubble-free'}`}
        style={style}
        role="status"
        aria-live="polite"
      >
        <ol className="coach-beats" aria-label="the turn">
          {['Visit', 'Action', 'End'].map((b, i) => (
            <li
              key={b}
              className={
                step.beat > i + 1 ? 'coach-beat-done' : step.beat === i + 1 ? 'coach-beat-on' : ''
              }
            >
              {b}
            </li>
          ))}
        </ol>
        <p className="coach-title">{step.title}</p>
        <p className="coach-text">{step.text}</p>
        <button type="button" className="coach-skip" onClick={skip}>
          Skip the tour
        </button>
      </div>
    </>
  );
}

let mounted: { root: Root; host: HTMLElement } | null = null;

/**
 * Mount the tour for this game, outside the app's own tree (see the banner).
 * `force` runs it even for a returning player, from the start screen's
 * "Guide my first turn" option. A second call while one is running is a no-op.
 */
export function startCoach(force = false): void {
  if (typeof document === 'undefined' || mounted !== null) return;
  if (!force && !isFirstGame()) return;
  const host = document.createElement('div');
  host.className = 'coach-host';
  document.body.appendChild(host);
  const root = createRoot(host);
  const stop = () => {
    // Deferred: a root cannot unmount itself synchronously mid-render.
    window.setTimeout(() => {
      if (mounted?.root !== root) return;
      root.unmount();
      host.remove();
      mounted = null;
    }, 0);
  };
  mounted = { root, host };
  root.render(<Coach onFinish={stop} />);
}
