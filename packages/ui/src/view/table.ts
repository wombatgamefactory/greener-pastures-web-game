/**
 * Derivations every panel needs, computed from the `PlayerView` only.
 *
 * The engine has query helpers for most of this, but they all take the full
 * table state, which the interface deliberately cannot see (see boundary.test).
 * So the view-side equivalents live here, once, rather than being re-derived in
 * four components.
 */

import type { GameData, Suit, WorkerAction } from '@gp/data';
import type { BuildingView, CardId, PlayerView, RivalView, Seat, WorkerState } from '@gp/engine';

import { printedFace } from './printed';

/**
 * ⭐ THE THRESHOLD SEAM. The number the ENGINE enforces, which is not always the
 * one the card prints.
 *
 * `rules.economy.noticeBoardThreshold` overrides the Notice Board's printed 5
 * with 2 (ruled 20/08/2026) until the sheet catches up - ten cells, five boards,
 * both faces - at which point the knob goes back to null and the printed value
 * takes over with no other change.
 *
 * The engine applies that override at exactly one seam, `thresholdOf` in
 * query.ts, so that `isFull`, `canTakeCard` and `roomOn` cannot disagree about
 * when a farm is shut. **This is the interface's matching seam, and it exists
 * for the same reason.** Every surface that draws a threshold reads through
 * here: the stack gauge on your own tableau, the Notice Board fill bar in the
 * rail, the inspector and the visit panel.
 *
 * It was not always so. Until 26/08/2026 the gauge and the fill bar read the
 * printed face directly, so the rail drew a neighbour's board as "1 / 5, visit
 * pays £2" while the engine considered it full at 2 and refused the visit. The
 * rail exists to answer "who should I visit"; it was answering it wrongly. An
 * interface may lag the sheet, but it may never contradict the engine about
 * whether a move is legal.
 *
 * ⚠️ ONE SURFACE DELIBERATELY DOES NOT READ THROUGH HERE: the number printed on
 * the card art itself (`Card.tsx`), which is generated from the spreadsheet and
 * still says 5. That is the sheet's debt to pay, not the renderer's - a card
 * that draws one number and the gauge beside it another is honest about the
 * disagreement, whereas a card face silently rewritten by a knob would hide it.
 */
export function liveThreshold(data: GameData, card: CardId, printed: number | null): number | null {
  if (printed === null) return null;
  const override = data.rules.economy.noticeBoardThreshold;
  if (override === null) return printed;
  return data.cards.catalogue.find((c) => c.id === card)?.slot === 'noticeboard'
    ? override
    : printed;
}

export interface Farm {
  readonly seat: Seat;
  readonly suit: Suit;
  readonly coins: number;
  readonly tableau: readonly BuildingView[];
  readonly receipts: readonly number[];
  readonly handCount: number;
  readonly barnCount: number;
}

/** One shape for "a farm", so the rail, the inspector and your own panel agree. */
export function farmOf(view: PlayerView, seat: Seat): Farm {
  if (seat === view.seat) {
    const barnCount = Object.values(view.you.barn).reduce((a, b) => a + (b ?? 0), 0);
    return {
      seat,
      suit: view.you.suit,
      coins: view.you.coins,
      tableau: view.you.tableau,
      receipts: view.you.receipts,
      handCount: view.you.hand.length,
      barnCount,
    };
  }
  const rival = view.rivals.find((r: RivalView) => r.seat === seat);
  if (!rival) throw new Error(`Seat ${seat} is not at this table`);
  return {
    seat,
    suit: rival.suit,
    coins: rival.coins,
    tableau: rival.tableau,
    receipts: rival.receipts,
    handCount: rival.handCount,
    barnCount: rival.barnCount,
  };
}

/** Every seat at the table in seating order, you included. */
export function seatSuits(view: PlayerView): (Suit | undefined)[] {
  const suits: (Suit | undefined)[] = [];
  suits[view.seat] = view.you.suit;
  for (const r of view.rivals) suits[r.seat] = r.suit;
  return suits;
}

export interface BoardState {
  readonly building: BuildingView;
  readonly filled: number;
  readonly threshold: number;
  readonly full: boolean;
  /** What a visitor is paid for one card: the printed face decides. */
  readonly payout: number;
  /** Special Orders' two-card line, on the upgraded face only. */
  readonly twoCard: number | null;
}

/**
 * A seat's FARMSTEAD: the card its suit power is printed on.
 *
 * It is the only building in the game that is live from turn one, has no stack
 * and is never a target of anything - so nothing in the interface had ever had
 * to find it before. What wants it now is the reading region's idle state: the
 * suit power is the most-forgotten rule at the table, and a region that would
 * otherwise be an empty rectangle can spend its time saying what yours does.
 *
 * Null is a reachable answer, not padding - D14 can demolish a building - and
 * the caller falls back to the old hint rather than assuming.
 */
export function farmsteadOf(data: GameData, tableau: readonly BuildingView[]): BuildingView | null {
  return (
    tableau.find((b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'farmstead') ??
    null
  );
}

/**
 * A seat's Notice Board - under v14 the only visit target in the game.
 *
 * Returns null rather than throwing when the seat has none. That is not
 * defensive padding: D14 can demolish a building, so a seat with no Notice
 * Board is a reachable position (ticket 30, where it hard-crashes the engine).
 * The interface must render that seat, not white-screen on it. D11 was the
 * second way in until 19/08/2026, when its build-on-top and the whole `covered`
 * zone were deleted.
 */
export function noticeBoardOf(data: GameData, farm: Farm): BoardState | null {
  const building = farm.tableau.find(
    (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard',
  );
  if (!building) return null;
  const face = printedFace(data, building.card, building.upgraded);
  // Through the seam, not off the face: this bar is what tells a player whether
  // a visit will be accepted, so it has to agree with the engine.
  const threshold = liveThreshold(data, building.card, face.threshold) ?? 0;
  return {
    building,
    filled: building.stack.length,
    threshold,
    full: threshold > 0 && building.stack.length >= threshold,
    payout: building.upgraded
      ? data.rules.economy.visitPayout.upgraded
      : data.rules.economy.visitPayout.base,
    twoCard: building.upgraded ? data.rules.economy.visitPayout.twoCard : null,
  };
}

/**
 * A Service as the interface needs it. The Working Week is gone (2026-08-10), so
 * there is no track to draw: what a player needs to see is what the Service
 * DOES, what it pays its owner when a rival buys it, and what it costs its owner
 * to run. The clog is already visible - the Service is an ordinary building in
 * the tableau with an ordinary stack.
 */
export interface WorkerTrack {
  readonly worker: WorkerState;
  readonly name: string;
  readonly actionText: string;
  /**
   * The action in ONE WORD, which is what the rail's compressed chip prints.
   *
   * `actionText` is a printed sentence ("Build at a discount of 2. Cards of any
   * crop may satisfy its crop requirements.") and a sentence does not compress -
   * it wraps to three lines in a 196px rail and turns a neighbour's panel into a
   * paragraph. But the FIRST question a visitor asks across three neighbours is
   * only ever "which of the five actions is that one", and that fits in a word.
   * The sentence is one click away in the inspector, which is the rail's
   * standing rule for everything it cannot print at a readable size.
   */
  readonly actionLabel: string;
  readonly linkedSuit: Suit;
  /** Minted by the bank to the OWNER when a RIVAL places a card here. */
  readonly wage: number;
  /** Paid to the bank by the OWNER to activate it from their own bonus slot. */
  readonly ownCost: number;
}

/** The five actions, named as the turn bar names them. Keyed by the enum, so a
    new action cannot be added without this failing to compile. */
const ACTION_LABEL: Readonly<Record<WorkerAction, string>> = {
  harvest: 'Harvest',
  deliver: 'Deliver',
  draw: 'Draw',
  sow: 'Sow',
  build: 'Build',
};

export function workerTrack(data: GameData, worker: WorkerState): WorkerTrack {
  const spec = data.workers.roster.find((w) => w.id === worker.id);
  if (!spec) throw new Error(`Unknown Service ${worker.id}`);
  return {
    worker,
    name: spec.name,
    actionText: spec.actionText,
    actionLabel: ACTION_LABEL[spec.action],
    linkedSuit: spec.linkedSuit,
    wage: data.workers.visitWage,
    ownCost: data.workers.ownerActivationCost,
  };
}

export function workersOwnedBy(view: PlayerView, seat: Seat): WorkerState[] {
  return view.fair.filter((w) => w.owner === seat);
}

export function receiptTotal(receipts: readonly number[]): number {
  return receipts.reduce((a, b) => a + b, 0);
}

/**
 * Tableau order for display: the three starters first, in printed order, then
 * everything built, oldest first. Buildings are stored in build order, which
 * puts a seat's own identity somewhere in the middle of the row after a few
 * turns - and the starters are the ones a visitor is looking for.
 */
const STARTER_ORDER: Record<string, number> = { farmstead: 0, barn: 1, noticeboard: 2 };

export function displayOrder(data: GameData, tableau: readonly BuildingView[]): BuildingView[] {
  const rank = (b: BuildingView): number => {
    const slot = data.cards.catalogue.find((c) => c.id === b.card)?.slot;
    return slot ? (STARTER_ORDER[slot] ?? 3) : 10;
  };
  return [...tableau].sort((a, b) => rank(a) - rank(b));
}

/** Workers whose action a visitor could rent here, ordered as printed. */
export const WORKER_ORDER: readonly WorkerAction[] = ['harvest', 'deliver', 'draw', 'sow', 'build'];
