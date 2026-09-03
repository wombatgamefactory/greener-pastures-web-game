/**
 * Where a dragged card may be dropped, and what dropping it means.
 *
 * The whole of ticket 26 rests on one decision: a drop is not a second way to
 * make a move, it is a second way to perform the SAME two clicks. Starting a
 * drag calls `hold`, and releasing over a zone calls the very click handler the
 * zone already has. So "a visit dropped on a neighbour's Notice Board must land
 * on the same payoff prompt" is true by construction rather than by a parallel
 * implementation that has to be kept in step - and ticket 25's constraint (the
 * interaction layer holds no rules, it only filters the engine's move list)
 * survives untouched, because nothing here knows a rule either.
 *
 * A drop zone is therefore always a subset of what is already clickable, never
 * a superset. The families that take a drop are the ones where the physical
 * gesture is "put this card there"; the rest stay click-only, which is a
 * decision recorded in `DROP_FAMILIES` rather than an omission.
 */

import type { CardId, Seat } from '@gp/engine';

import type { Intent, Live } from './intent';

/**
 * ⭐ `rival` BECAME `host` (v31), and the rename is a rule. A Notice Board drop
 * target used to be a NEIGHBOUR by definition; since v31 your own board is a
 * legal visit target too, so a zone called `rival` would be lying about half the
 * boards it now covers. What it means is "a farm's Notice Board", whoever farms
 * it, and the components that stamp it are the rail's neighbour cards and your
 * own Notice Board's badge.
 */
export type DropKind = 'building' | 'host' | 'assembly';

export interface DropTarget {
  readonly kind: DropKind;
  /** The building's card id, the host seat, or '' for the assembly panel. */
  readonly id: string;
}

/** The attribute a component stamps on a zone. Read back by hit-testing. */
export const DROP_ATTR = 'data-drop';

/**
 * Every glow family in `Live`, and the drop kind that accepts a hand card.
 *
 * The `null`s are the interesting half and each one is a judgement:
 *  - **tiles** take barn cards, not hand cards. A delivery is chosen, not carried.
 *  - **balloons** are freight moved by the Deliver action; nothing is placed on them.
 *  - **meeples** are wooden pieces in your own supply, spent by clicking them.
 *    Nothing is placed on a meeple and nothing ever will be.
 *  - **decks** are where cards come FROM.
 *  - **hand** is the source itself.
 *
 * `drop.test.ts` checks these keys against a real `Live`, so adding a target
 * family to the glow fails the build until someone decides whether it takes a
 * drop. Same anti-rot chain as `MOVE_ROUTES` and the bots' scoring terms.
 */
export const DROP_FAMILIES = {
  buildings: 'building',
  hosts: 'host',
  tiles: null,
  balloons: null,
  meeples: null,
  decks: null,
  hand: null,
} satisfies Record<keyof Live, DropKind | null>;

/** The props that make an element a drop zone. Spread into the element. */
export function dropZone(kind: DropKind, id: string | number = ''): Record<string, string> {
  return { [DROP_ATTR]: id === '' ? kind : `${kind}:${id}` };
}

export function parseDrop(value: string | null | undefined): DropTarget | null {
  if (!value) return null;
  const at = value.indexOf(':');
  const kind = at === -1 ? value : value.slice(0, at);
  if (kind !== 'building' && kind !== 'host' && kind !== 'assembly') return null;
  return { kind, id: at === -1 ? '' : value.slice(at + 1) };
}

/**
 * Would releasing here do anything? The same question the glow asks, asked of
 * the same sets - so a zone that lights up on approach and then swallows the
 * card is not a state this can reach.
 *
 * The assembly is the one zone whose test is about the hand rather than the
 * target: mid-build and mid-visit `live.hand` is "what could still join this
 * payment", which is exactly the set of cards the panel will accept.
 */
export function dropAllowed(live: Live, intent: Intent, target: DropTarget, card: CardId): boolean {
  switch (target.kind) {
    case 'building':
      return live.buildings.has(target.id);
    case 'host':
      return live.hosts.has(Number(target.id) as Seat);
    case 'assembly':
      return (intent.k === 'build' || intent.k === 'visit') && live.hand.has(card);
  }
}

/**
 * The click handlers a drop reaches. Structural rather than the `Play` type, so
 * this module stays a leaf: `Play` already imports the resolvers this sits
 * beside, and a type-only cycle is still a cycle to read.
 */
export interface DropSink {
  building(card: CardId): void;
  host(seat: Seat): void;
  hold(card: CardId): void;
}

/**
 * Perform the drop. Every branch is a call the click path already makes, which
 * is the ticket's "same move, same confirmation surface" reduced to code: a drop
 * on a building can open the same disambiguation menu a click would, and a drop
 * on a neighbour opens the same visit panel with the fee already paid.
 */
export function dispatchDrop(sink: DropSink, target: DropTarget, card: CardId): void {
  switch (target.kind) {
    case 'building':
      sink.building(target.id);
      return;
    case 'host':
      sink.host(Number(target.id) as Seat);
      return;
    case 'assembly':
      // Mid-assembly `hold` means "add this to the price", which is what the
      // panel's own hand clicks do.
      sink.hold(card);
      return;
  }
}
