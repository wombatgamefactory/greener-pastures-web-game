/**
 * Derivations every panel needs, computed from the `PlayerView` only.
 *
 * The engine has query helpers for most of this, but they all take the full
 * table state, which the interface deliberately cannot see (see boundary.test).
 * So the view-side equivalents live here, once, rather than being re-derived in
 * four components.
 */

import type { GameData, Suit, WorkerAction } from '@gp/data';
import { doorForSuit } from '@gp/data';
import type { BuildingView, CardId, PlayerView, RivalView, Seat, WorkerState } from '@gp/engine';

import { printedFace } from './printed';

/**
 * ⭐ THE THRESHOLD SEAM. The number the ENGINE enforces, which is not always the
 * one the card prints.
 *
 * The engine applies its override at exactly one seam, `thresholdOf` in
 * query.ts, so that `isFull`, `canTakeCard` and `roomOn` cannot disagree about
 * when a farm is shut. **This is the interface's matching seam, and it exists
 * for the same reason.** Every surface that draws a threshold reads through
 * here: the stack gauge on your own tableau, the Notice Board fill bar in the
 * rail, the inspector and the visit panel.
 *
 * It was not always so. Until 26/08/2026 the gauge and the fill bar read the
 * printed face directly, so the rail drew a neighbour's board as "1 / 5" while
 * the engine considered it full at 2 and refused the visit. The rail exists to
 * answer "who should I visit"; it was answering it wrongly. An interface may lag
 * the sheet, but it may never contradict the engine about whether a move is
 * legal.
 *
 * ⭐ THE DRIFT IT WAS BUILT FOR IS CLOSED (v31): the sheet prints 2 on all five
 * Notice Boards and `rules.economy.noticeBoardThreshold` is 2, so override and
 * print now agree and this function is currently the identity. It stays because
 * the knob stays - an overlay sweeping the threshold (2 versus 3 is a named arm
 * in the v31 plan) moves the engine, and this is what moves the interface with
 * it.
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
  /**
   * MEEPLES HELD, BY COLOUR (v31) - what replaced the coin count that used to
   * sit here. Fully public, like the coins were: they are claimed face up off
   * the island and sit in front of their owner, so knowing which free action a
   * neighbour is holding is part of reading the table.
   *
   * It is NOT a wallet. Each is one specific action, spent only at the start of
   * a turn, and it leaves the game when spent - so a surface that sums them into
   * a single number is drawing something the rules do not have.
   */
  readonly meeples: Readonly<Record<Suit, number>>;
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
      meeples: view.you.meeples,
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
    meeples: rival.meeples,
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

/** Meeples held, as colour/count pairs with the empty colours dropped. */
export function meepleTally(meeples: Readonly<Record<Suit, number>>): [Suit, number][] {
  return (Object.entries(meeples) as [Suit, number][]).filter(([, n]) => n > 0);
}

export function meepleCount(meeples: Readonly<Record<Suit, number>>): number {
  return meepleTally(meeples).reduce((sum, [, n]) => sum + n, 0);
}

export interface BoardState {
  readonly building: BuildingView;
  readonly filled: number;
  readonly threshold: number;
  readonly full: boolean;
  /**
   * WHAT A CARD PLACED HERE BUYS: this farm's suit door, in one word. Since v31
   * that is the whole payoff - no coins are minted, no wage is paid, and the
   * visitor takes the action. It is therefore the only thing on a rail card that
   * a visit decision actually turns on.
   */
  readonly action: WorkerAction;
  readonly actionLabel: string;
  /** The printed sentence, for a tooltip and the inspector. */
  readonly actionText: string;
}

/**
 * A seat's FARMSTEAD: the card its end-game scorer is printed on.
 *
 * It is the only building in the game that has no stack and is never a target of
 * anything - so nothing in the interface had ever had to find it before. What
 * wants it is the reading region's idle state: since v31 the Farmstead prints
 * *"Game end: 1 VP for each `<CROP>` card you have built"*, which is the standing
 * reason to build your own colour and the rule a table forgets first.
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
 * A seat's Notice Board - the only visit target in the game, and since v31 that
 * includes visits from its OWN owner.
 *
 * Returns null rather than throwing when the seat has none. That is not
 * defensive padding: D14 can demolish a building, so a seat with no Notice
 * Board is a reachable position (ticket 30, where it hard-crashes the engine).
 * The interface must render that seat, not white-screen on it.
 */
export function noticeBoardOf(data: GameData, farm: Farm): BoardState | null {
  const building = farm.tableau.find(
    (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot === 'noticeboard',
  );
  if (!building) return null;
  const face = printedFace(data, building.card);
  // Through the seam, not off the face: this bar is what tells a player whether
  // a visit will be accepted, so it has to agree with the engine.
  const threshold = liveThreshold(data, building.card, face.threshold) ?? 0;
  const door = doorOf(data, farm.suit);
  return {
    building,
    filled: building.stack.length,
    threshold,
    full: threshold > 0 && building.stack.length >= threshold,
    action: door.action,
    actionLabel: door.actionLabel,
    actionText: door.actionText,
  };
}

/**
 * A SUIT'S DOOR, as the interface needs it (v31).
 *
 * There are no Services, no Working Week, no wage and no owner activation cost.
 * A colour means exactly one thing now, and it means it in two places at once:
 * it is the action that colour's Notice Board grants to whoever places a card on
 * it, AND the action a MEEPLE of that colour performs when spent. One lookup for
 * both, because a second one is a second thing to keep in step.
 */
export interface Door {
  readonly id: WorkerAction;
  readonly action: WorkerAction;
  /** Flavour: the old Service card's printed name. Nothing prints it now. */
  readonly name: string;
  readonly actionText: string;
  /**
   * The action in ONE WORD, which is what a rail chip, a meeple tooltip and the
   * doors legend all print.
   *
   * `actionText` is a printed sentence ("Sow 1 card from your hand onto one of
   * your buildings.") and a sentence does not compress - it wraps to three lines
   * in a 196px rail and turns a neighbour's panel into a paragraph. The FIRST
   * question anybody asks of a colour is only ever "which of the five actions is
   * that one", and that fits in a word. The sentence is one hover away.
   */
  readonly actionLabel: string;
  readonly colour: Suit;
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

export function doorOf(data: GameData, colour: Suit): Door {
  const spec = doorForSuit(data, colour);
  if (!spec) throw new Error(`No door for ${colour}`);
  return {
    id: spec.id,
    action: spec.action,
    name: spec.name,
    actionText: spec.actionText,
    actionLabel: ACTION_LABEL[spec.action],
    colour: spec.linkedSuit,
  };
}

/** All five doors in printed order, which is also the meeple key. */
export function allDoors(data: GameData): Door[] {
  return data.workers.roster.map((spec) => doorOf(data, spec.linkedSuit));
}

/** Which seat, if any, owns the board granting this colour's action. */
export function doorOwner(view: PlayerView, colour: Suit): Seat | null {
  const seats = seatSuits(view);
  const seat = seats.findIndex((suit) => suit === colour);
  return seat < 0 ? null : seat;
}

/** The board this seat owns, as a `WorkerState`. Kept for the doors legend. */
export function boardsOwnedBy(view: PlayerView, seat: Seat): WorkerState[] {
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

/** The five colours in printed order. Doors, meeple key and legend all use it. */
export const DOOR_ORDER: readonly WorkerAction[] = ['harvest', 'deliver', 'draw', 'sow', 'build'];
