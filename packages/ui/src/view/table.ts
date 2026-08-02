/**
 * Derivations every panel needs, computed from the `PlayerView` only.
 *
 * The engine has query helpers for most of this, but they all take the full
 * table state, which the interface deliberately cannot see (see boundary.test).
 * So the view-side equivalents live here, once, rather than being re-derived in
 * four components.
 */

import type { GameData, Suit, WorkerAction } from '@gp/data';
import type { BuildingView, PlayerView, RivalView, Seat, WorkerState } from '@gp/engine';

import { printedFace } from './printed';

export interface Farm {
  readonly seat: Seat;
  readonly suit: Suit;
  readonly coins: number;
  readonly tableau: readonly BuildingView[];
  readonly covered: readonly string[];
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
      covered: view.you.covered,
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
    covered: rival.covered,
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
 * A seat's Notice Board - under v14 the only visit target in the game.
 *
 * Returns null rather than throwing when the seat has none. That is not
 * defensive padding: D11 and D14 can cover or demolish a starter, so a seat
 * with no Notice Board is a reachable position (ticket 30, where it hard-crashes
 * the engine). The interface must render that seat, not white-screen on it.
 */
export function noticeBoardOf(data: GameData, farm: Farm): BoardState | null {
  const building = farm.tableau.find(
    (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard',
  );
  if (!building) return null;
  const face = printedFace(data, building.card, building.upgraded);
  const threshold = face.threshold ?? 0;
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

export interface WorkerTrack {
  readonly worker: WorkerState;
  readonly name: string;
  readonly actionText: string;
  readonly linkedSuit: Suit;
  /** Every space on the Working Week: the sun, then the paying spaces. */
  readonly spaces: readonly { readonly wage: number | null; readonly here: boolean }[];
  /** What the owner takes from the bank the next time a RIVAL works it. */
  readonly nextWage: number | null;
  /** True when one more use walks the meeple home and the card returns to the Fair. */
  readonly lastUse: boolean;
}

export function workerTrack(data: GameData, worker: WorkerState): WorkerTrack {
  const spec = data.workers.roster.find((w) => w.id === worker.id);
  if (!spec) throw new Error(`Unknown worker ${worker.id}`);
  const spaces = [
    { wage: null, here: worker.trackPos === 0 },
    ...spec.wages.map((wage, i) => ({ wage, here: worker.trackPos === i + 1 })),
  ];
  const next = spec.wages[worker.trackPos] ?? null;
  return {
    worker,
    name: spec.name,
    actionText: spec.actionText,
    linkedSuit: spec.linkedSuit,
    spaces,
    nextWage: next,
    lastUse: next === null,
  };
}

export function workersOwnedBy(view: PlayerView, seat: Seat): WorkerState[] {
  return view.fair.filter((w) => w.owner === seat);
}

export function workersForHire(view: PlayerView): WorkerState[] {
  return view.fair.filter((w) => w.owner === null);
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
