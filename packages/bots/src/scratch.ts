/**
 * The per-decision facts every scoring term wants, derived once.
 *
 * Terms run once per move per decision, so anything that scans the tableau or
 * the island belongs here rather than inside a feature function. The speed
 * budget is 50us per decision (ticket 10) against a mean branching factor of
 * 4-5, and `viewFor` at 31us has already been spent by the driver before a
 * policy is called - so a term that re-derives the island per move is the one
 * thing that could blow it.
 *
 * Everything here reads the VIEW. No GameState, and no engine function that
 * takes one.
 */

import type { Card, CardFace, GameData, Suit } from '@gp/data';
import type { BuildingView, CardId, PlayerView } from '@gp/engine';
import { tileLevel } from '@gp/engine';

/**
 * Card lookup by id, indexed per GameData.
 *
 * The engine's `cardById` is a linear scan of the 105-card catalogue, which is
 * the right shape for a rules engine that reads a handful of cards per apply.
 * A policy reads one card per card id per scoring term per move - measured at
 * 30-54us a decision against a 50us budget - and the scan was all of it. Keyed
 * on the data object so an overlay run gets its own index and both are
 * collected with the data they describe.
 */
const CARD_INDEX = new WeakMap<GameData, Map<CardId, Card>>();

export function cardIndex(data: GameData): ReadonlyMap<CardId, Card> {
  let index = CARD_INDEX.get(data);
  if (!index) {
    index = new Map(data.cards.catalogue.map((card) => [card.id, card]));
    CARD_INDEX.set(data, index);
  }
  return index;
}

/** Same contract as the engine's `cardById`, including throwing on an unknown id. */
export function cardById(data: GameData, id: CardId): Card {
  const card = cardIndex(data).get(id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  return card;
}

/** The face a building is showing. The view carries `upgraded`, which is all this needs. */
export function faceOfView(data: GameData, building: BuildingView): CardFace {
  const card = cardById(data, building.card);
  if (card.faces) return building.upgraded ? card.faces.upgraded : card.faces.starter;
  return {
    name: card.name,
    printedVp: card.printedVp ?? 0,
    threshold: card.threshold ?? null,
    activationType: card.activationType ?? null,
    abilityText: card.abilityText ?? null,
  };
}

/**
 * The crop a building prints, ticket 07's rule (mirrors the engine's `cropOf`,
 * which takes a GameState). A base starter prints the generic starting-building
 * icon and belongs to no crop; flipping it buys a crop icon.
 */
export function cropOfView(data: GameData, building: BuildingView): Suit | null {
  const card = cardById(data, building.card);
  if (card.type === 'starter') return building.upgraded ? card.suit : null;
  return card.suit;
}

export interface Scratch {
  readonly data: GameData;
  readonly view: PlayerView;
  readonly mySuit: Suit;
  /** Printed on the Barn's showing face. Null only if the Barn has somehow gone. */
  readonly handLimit: number | null;
  /** Cards you could draw before the end-of-turn discard bites. */
  readonly handRoom: number;
  readonly buildings: ReadonlyMap<CardId, BuildingView>;
  /** Buildings printing your own crop icon - the Farmstead free-flip counter. */
  readonly ownCropBuildings: number;
  readonly flipAt: number;
  readonly farmsteadUpgraded: boolean;
  readonly noticeBoard: BuildingView | null;
  /** Levels you already hold a receipt from. */
  readonly heldLevels: ReadonlySet<1 | 2 | 3>;
  /** Levels the island's per-player gate leaves open to you right now. */
  readonly openLevels: ReadonlySet<1 | 2 | 3>;
  /** Suits an open, unfilled tile still wants. Wild crates count for every suit in play. */
  readonly demandSuits: ReadonlySet<Suit>;
  readonly ownsWorker: boolean;
}

function starterSlotOf(card: Card): string | null {
  return card.slot ?? null;
}

function levelsFor(
  data: GameData,
  view: PlayerView,
): { held: Set<1 | 2 | 3>; open: Set<1 | 2 | 3> } {
  const held = new Set<1 | 2 | 3>();
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.includes(view.seat)) held.add(tileLevel(data, tile.tile));
  }
  if (!data.island.levelGate) return { held, open: new Set<1 | 2 | 3>([1, 2, 3]) };
  const open = new Set<1 | 2 | 3>([1]);
  if (held.has(1)) open.add(2);
  if (held.has(2)) open.add(3);
  return { held, open };
}

export function makeScratch(data: GameData, view: PlayerView): Scratch {
  const you = view.you;
  const buildings = new Map<CardId, BuildingView>();
  let handLimit: number | null = null;
  let ownCropBuildings = 0;
  let farmsteadUpgraded = false;
  let noticeBoard: BuildingView | null = null;

  for (const building of you.tableau) {
    buildings.set(building.card, building);
    if (cropOfView(data, building) === you.suit) ownCropBuildings += 1;
    const slot = starterSlotOf(cardById(data, building.card));
    if (slot === 'barn') handLimit = faceOfView(data, building).handSize ?? null;
    if (slot === 'farmstead') farmsteadUpgraded = building.upgraded;
    if (slot === 'noticeboard') noticeBoard = building;
  }

  const { held: heldLevels, open: openLevels } = levelsFor(data, view);
  const demandSuits = new Set<Suit>();
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= data.island.deliveriesPerTile) continue;
    if (!openLevels.has(tileLevel(data, tile.tile))) continue;
    for (const crate of tile.crates) {
      if (crate === 'wild') for (const suit of view.suitsInPlay) demandSuits.add(suit);
      else demandSuits.add(crate);
    }
  }

  return {
    data,
    view,
    mySuit: you.suit,
    handLimit,
    handRoom: handLimit === null ? 0 : Math.max(0, handLimit - you.hand.length),
    buildings,
    ownCropBuildings,
    flipAt: data.rules.economy.farmsteadFlipAtOwnColourBuilds,
    farmsteadUpgraded,
    noticeBoard,
    heldLevels,
    openLevels,
    demandSuits,
    ownsWorker: view.fair.some((w) => w.owner === view.seat),
  };
}
