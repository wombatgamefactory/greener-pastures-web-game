/**
 * The shape of everything in packages/data/data/*.json.
 *
 * These types are hand-written and the JSON is checked against them at load, in
 * `assertGameData`. Nothing here is inferred from the JSON, deliberately: the
 * extractor can be re-run at any time against a sheet that has moved, and a
 * silently-inferred type would absorb the change instead of failing on it.
 */

export type Suit = 'wheat' | 'vegetable' | 'orchard' | 'apiary' | 'dairy';

export const SUITS: readonly Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

export type CardType = 'starter' | 'tier1' | 'tier2' | 'tier3' | 'power' | 'endgame';

/** Which of the three printed starters a starter card is. Null for deck cards. */
export type StarterSlot = 'barn' | 'farmstead' | 'noticeboard';

/**
 * Trigger keywords detected in the printed text. This is keyword detection, not a
 * resolved ruling: `needsDesignReview` marks the cards where 0 or more than 1
 * matched and a human has to read the card.
 */
export type AbilityTrigger =
  | 'onActivate'
  | 'onHarvest'
  | 'autoHarvest'
  | 'onDeliver'
  | 'onDeliverIsland'
  | 'harvestSurcharge'
  | 'activationSurcharge'
  | 'passive'
  | 'gameEnd';

/**
 * A build cost as printed in the icon columns: n cards of the card's own suit,
 * m cards of any suit, and c coins.
 */
export interface BuildCost {
  readonly suit: number;
  readonly wild: number;
  readonly coins: number;
}

/** One printed face of a starter. Starters are double-sided; deck cards are not. */
export interface CardFace {
  readonly name: string;
  readonly printedVp: number;
  readonly threshold: number | null;
  readonly activationType: string | null;
  readonly abilityText: string | null;
  /** Absolute printed hand size. Barn faces only; null everywhere else. */
  readonly handSize?: number | null;
}

export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly type: CardType;
  readonly name: string;
  /** False for the three starters, true for the 18 shuffled cards. */
  readonly inDeck: boolean;
  /**
   * A tuning-overlay flag, not a printed property. Always true in the extract.
   * Switching a card off is how a paired comparison run asks whether the game is
   * better without it.
   */
  readonly enabled: boolean;
  readonly buildCost: BuildCost | null;
  readonly abilityTrigger: readonly AbilityTrigger[];
  readonly needsDesignReview: boolean;
  /** Starters only. */
  readonly slot?: StarterSlot;
  readonly upgradeCostCoins?: number;
  readonly faces?: { readonly starter: CardFace; readonly upgraded: CardFace };
  /** Deck cards only. */
  readonly activationType?: string | null;
  readonly threshold?: number | null;
  readonly printedVp?: number;
  readonly abilityText?: string | null;
}

export interface DataMeta {
  readonly schemaVersion: number;
  /** `generated` means the extractor wrote it; `authored` means a human did. */
  readonly kind: 'generated' | 'authored';
  readonly generatedBy: string | null;
  readonly sourceSheet: string | null;
  readonly sourceSha256?: string;
  readonly notes: readonly string[];
  readonly unresolved?: readonly string[];
}

export interface CardsFile {
  readonly meta: DataMeta;
  readonly suits: readonly Suit[];
  /**
   * Named `catalogue` rather than `cards` so a knob path reads
   * `cards.catalogue.W7.threshold` instead of stuttering `cards.cards.W7`.
   */
  readonly catalogue: readonly Card[];
}

export type IslandLevel = 1 | 2 | 3;

export interface IslandLevelRule {
  readonly vp: number;
  readonly coinsPerDelivery: number;
  readonly crates: number;
  readonly cardsPerCrate: number;
  readonly triggersGameEnd: boolean;
}

export interface IslandTile {
  readonly id: string;
  readonly level: IslandLevel;
  readonly note: string | null;
}

export interface DemandTokenPool {
  readonly crates: number;
  readonly suits: number;
  readonly perSuit: number;
  readonly wild: number;
}

export interface IslandFile {
  readonly meta: DataMeta;
  readonly seats: { readonly min: number; readonly max: number };
  readonly decksInPlayBySeats: Readonly<Record<string, number>>;
  readonly deliveriesPerTile: number;
  /**
   * The per-player level gate (ticket 07): deliver to a level only while
   * already holding a receipt from the level below. False removes the climb
   * entirely and every tile is deliverable at any time, which is what the
   * engine shipped before ticket 29.
   */
  readonly levelGate: boolean;
  readonly levelRules: Readonly<Record<string, IslandLevelRule>>;
  readonly slotsBySeats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly levelThreeTilesBySeats: Readonly<Record<string, readonly string[]>>;
  readonly demandTokensBySeats: Readonly<Record<string, DemandTokenPool>>;
  readonly adjacency: null;
  readonly tiles: readonly IslandTile[];
}

export type WorkerAction = 'harvest' | 'deliver' | 'draw' | 'sow' | 'build';

export interface HiredWorker {
  readonly id: WorkerAction;
  readonly name: string;
  readonly action: WorkerAction;
  readonly actionText: string;
  readonly linkedSuit: Suit;
  /**
   * Wages on the paying spaces after arrival, in order. Advancing onto paying
   * space i pays wages[i - 1]; advancing past the last one sends the Worker home.
   * A full track is therefore `wages.length + 1` uses.
   */
  readonly wages: readonly number[];
  readonly draw?: { readonly see: number; readonly keep: number };
  readonly sow?: { readonly amount: number };
}

export interface WorkersFile {
  readonly meta: DataMeta;
  readonly hireFee: number;
  readonly maxPerPlayer: number;
  /** Named `roster` for the same reason `catalogue` is: no `workers.workers`. */
  readonly roster: readonly HiredWorker[];
}

export type BalloonRewardType = 'draw' | 'buildDiscount' | 'sowFromHand' | 'gainCoins';

export interface Balloon {
  readonly id: string;
  readonly colour: string;
  readonly hex: string;
  readonly rewardText: string;
  readonly reward: { readonly type: BalloonRewardType; readonly amount: number };
}

export interface AerodromeFile {
  readonly meta: DataMeta;
  readonly port: {
    readonly name: string;
    readonly copies: number;
    readonly perPlayer: boolean;
    readonly inDeck: boolean;
  };
  readonly moveCost: {
    readonly barnCards: number;
    readonly mustDiffer: boolean;
    readonly differBy: 'suit';
  };
  readonly balloons: readonly Balloon[];
  readonly referencedBy: readonly string[];
}

export interface RulesFile {
  readonly meta: DataMeta;
  readonly setup: {
    readonly startingHand: number;
    readonly startingBarnCards: number;
    readonly startingCoins: number;
  };
  readonly turn: {
    readonly actionsPerTurn: number;
    readonly bonusSlotsPerTurn: number;
    /** The plain Draw action: see this many, keep this many. The Draw Worker prints its own numbers. */
    readonly baseDraw: { readonly see: number; readonly keep: number };
    /**
     * Coins for the once-per-turn free BUY: one card, blind, off the top of a
     * deck that is not your own suit. Null switches the rule off, which is the
     * paired control (`overlays/no-card-buy.overlay.json`).
     */
    readonly buyCost: number | null;
    /**
     * Coins for BUY AT MARKET (docs/Market Bonus Action 2026-08-03.md): a
     * bonus-slot option - top card of any one deck in play, own suit included,
     * into the BARN, revealed. Null deletes the rule. Independent of `buyCost`
     * so ticket 56's paired arms stay clean: they are two different rules.
     */
    readonly marketCost: number | null;
  };
  readonly economy: {
    readonly upgradeCostCoins: number;
    /** VP at game end is `floor(coins / divisor)`. Null disables the rule. */
    readonly coinPityDivisor: number | null;
    /**
     * What the bank pays a visitor who takes the money. `base` and `upgraded`
     * are the one-card payouts of the two Notice Board faces; `twoCard` is
     * Special Orders' second line ("2 cards, take £3"), which the upgraded face
     * prints and the base face does not.
     */
    readonly visitPayout: {
      readonly base: number;
      readonly upgraded: number;
      readonly twoCard: number;
    };
    /**
     * The Farmstead flips FREE at this many buildings printing the player's own
     * crop icon. Ticket 07: base starters print the starting-building icon and
     * do not count; upgraded ones print the crop icon and do.
     */
    readonly farmsteadFlipAtOwnColourBuilds: number;
  };
  readonly endGame: {
    readonly trigger: 'levelThreeDelivery';
    readonly furtherTurnsEach: number;
  };
}

/**
 * Everything the engine, the UI and the simulator read, after any tuning overlay
 * has been applied. Deep-frozen at load: a caller that mutates it is a bug, and
 * the freeze turns that bug into an exception rather than a balance mystery.
 */
export interface GameData {
  readonly cards: CardsFile;
  readonly island: IslandFile;
  readonly workers: WorkersFile;
  readonly aerodrome: AerodromeFile;
  readonly rules: RulesFile;
}
