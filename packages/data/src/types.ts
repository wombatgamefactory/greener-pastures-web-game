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

/**
 * Which of the FOUR printed starters a starter card is. Null for deck cards.
 *
 * `service` joined the set on 2026-08-10 with the suit Services. It is the only
 * starter the extractor does not produce: the sheet has no Service row yet, so
 * the five Service cards are synthesised from workers.json at load (see
 * `withServices` in index.ts) and cards.json stays a faithful extract.
 */
export type StarterSlot = 'barn' | 'farmstead' | 'noticeboard' | 'service';

/**
 * Trigger keywords detected in the printed text. This is keyword detection, not a
 * resolved ruling: `needsDesignReview` marks the cards where 0 or more than 1
 * matched and a human has to read the card.
 */
export type AbilityTrigger =
  | 'onActivate'
  /**
   * The card prints an ACTION: on your turn you may take it INSTEAD of Draw,
   * Build, Grow, Harvest or Deliver. Detected structurally rather than by
   * keyword - a deck card with no threshold and no activation type cannot be
   * grown or sown, so its text has to fire some other way - which is what keeps
   * the extract free of a printed prefix the sheet does not carry.
   *
   * Nearly documentation, with one real consumer: the sim's action-mix note
   * counts `onActivate` cards to say how much of the set is GROW-gated, and an
   * ACTION card must not be counted there.
   */
  | 'action'
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

/**
 * A tile's printed row. LAYOUT ONLY since the flat island (2026-08-09): it picks
 * which faces are on the table and how the pyramid is built, and no rule reads
 * it. See the LEVEL IS NOW ART note in island.json.
 */
export type IslandLevel = 1 | 2 | 3;

/** What every tile in play costs and pays, identically. Replaced levelRules. */
export interface IslandTileRule {
  readonly crates: number;
  readonly cardsPerCrate: number;
  readonly coinsPerDelivery: number;
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
  /**
   * The flat island's VP schedule AND its capacity rule, in one array
   * (2026-08-09). Entry i is the VP the (i+1)th delivery to a tile takes, and
   * `length` is how many deliveries a tile accepts before it closes. Printed
   * `[6, 3]`: first deliverer 6, second 3, third illegal.
   *
   * There is no separate deliveriesPerTile, on purpose. Opening a third delivery
   * space means writing down what it pays, in the same edit.
   */
  readonly vpByDeliveryOrder: readonly number[];
  /**
   * The wild substitution (2026-08-08): paying the island, any ONE card it asks
   * for may instead be paid with this many cards of any crops. null switches the
   * rule off and restores exact matching. Island delivery only - see the scope
   * warning in island.json, which is the part that must not drift.
   */
  readonly cardsPerSubstitution: number | null;
  /** What every tile costs and pays. Flat since 2026-08-09; was levelRules. */
  readonly tileRule: IslandTileRule;
  readonly slotsBySeats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly levelThreeTilesBySeats: Readonly<Record<string, readonly string[]>>;
  readonly demandTokensBySeats: Readonly<Record<string, DemandTokenPool>>;
  readonly adjacency: null;
  readonly tiles: readonly IslandTile[];
}

export type WorkerAction = 'harvest' | 'deliver' | 'draw' | 'sow' | 'build';

/**
 * One suit's SERVICE: the fourth starter, owned by whoever plays that suit and
 * by nobody else. `id` is still the action it performs, so every existing
 * "which worker" reference keeps working.
 *
 * Each Service performs an ENHANCED version of its action. The optional blocks
 * below are that enhancement, and which of them a Service carries is set by how
 * card-hungry its action is - see the note block in workers.json.
 */
export interface SuitService {
  readonly id: WorkerAction;
  readonly name: string;
  readonly action: WorkerAction;
  readonly actionText: string;
  /** Ownership, not flavour: the seat playing this suit owns this Service. */
  readonly linkedSuit: Suit;
  /** Draw's printed see/keep. Never the base action's - see the self-cancellation note. */
  readonly draw?: { readonly see: number; readonly keep: number };
  /** `from: 'deck'` is the Apiary Service: the sown card comes off a deck top, not the hand. */
  readonly sow?: { readonly amount: number; readonly from?: 'hand' | 'deck' };
  /** The Dairy Service: crop requirements waived, price unchanged. */
  readonly build?: { readonly substitute?: boolean; readonly discount?: number };
  /**
   * Wheat and Vegetable: this many OPTIONAL hand cards into your own barn,
   * after the harvest and before the delivery respectively.
   */
  readonly handToBarn?: number;
}

export interface WorkersFile {
  readonly meta: DataMeta;
  /** Cards a Service holds before it clogs. Printed on the card; a knob here. */
  readonly serviceThreshold: number;
  /** What the OWNER pays the bank to activate their own Service from the bonus slot. */
  readonly ownerActivationCost: number;
  /** What the bank mints to the OWNER when a RIVAL activates their Service. 0 switches the wage off. */
  readonly visitWage: number;
  /** Named `roster` for the same reason `catalogue` is: no `workers.workers`. */
  readonly roster: readonly SuitService[];
}

/** @deprecated The Hiring Fair is gone (2026-08-10). Alias kept so old imports fail loudly at review, not silently. */
export type HiredWorker = SuitService;

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
  /**
   * Cards discarded FROM HAND by the alternative payment Vegetable's Depots
   * print (V4, V8). The base `moveCost` above is unchanged for everybody; this
   * is a second entry point, not an edit to the first, and nothing outside those
   * cards may use it. No suit constraint by design - see the note in
   * aerodrome.json.
   */
  readonly handMoveCost: number;
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
    /**
     * THE BONUS WINDOW (Dean, 19/08/2026): true means the bonus slot may be
     * taken only at the START of your turn, before the main action. False is
     * the v14 rule it replaced, "once per turn, any point".
     *
     * A knob rather than a constant because the change ships alongside three
     * others that all move the same number - the visit rate - and the plan is
     * explicit that they arm together but must be separable when the arm is
     * DIAGNOSED. This is the one of the four with no precedent in the reports,
     * and it points down: a bonus you must commit to before you act is a bonus
     * that gets forgotten.
     */
    readonly bonusAtStartOnly: boolean;
    /**
     * THE STARTER UPGRADE'S SLOT (Dean, 19/08/2026): true means flipping a
     * starter for £2 is one of the four BONUS actions. False is the old rule,
     * where it cost the whole main action - which is why the 2026-07-14 table
     * left every £2 sink untouched.
     */
    readonly upgradeIsBonus: boolean;
  };
  readonly economy: {
    /**
     * What it costs to flip a starter, and since 2026-08-12 that is ALL THREE of
     * them: the Farmstead's free flip at the own-crop milestone is retired and
     * it is bought like its siblings. A per-card `upgradeCostCoins` still
     * overrides this.
     */
    readonly upgradeCostCoins: number;
    /** VP at game end is `floor(coins / divisor)`. Null disables the rule. */
    readonly coinPityDivisor: number | null;
    /**
     * What the bank pays a VISITOR, by which face the host's Notice Board is
     * showing and which branch the visitor took. The card prints exactly this:
     *
     *   base face        VISIT: gain `base`, or take the action.
     *   upgraded face    VISIT: gain `upgraded`, or gain `upgradedAction` AND
     *                    take the action.
     *
     * `upgradedAction` is the half added on 2026-08-13 and it is the whole
     * point of the card. Sweetening only the coin branch (which is what shipped
     * before it) was measured to move visitors from the host's action branch to
     * their coin branch rather than from another farm to this one - a swap of
     * doors on the same farm, worth nothing to the owner once change 6 merges
     * the two doors into one building. Paying both branches equally removes the
     * reason to switch and puts the pull where the traffic actually is: per
     * offer, a visitor takes the action about three times as often as the coin.
     * Setting it to 0 is the paired control, and restores the old behaviour.
     *
     * The OWNER is paid nothing, on either face. Their return is the freight -
     * one more card landing on their farm per visit they win - which is the
     * standing "your junk is their treasure" rule and the reason `visitWage`
     * sits at 0.
     *
     * `twoCard` was Special Orders' second line ("2 cards, take £3"). Change 6
     * retired Special Orders and the 2026-08-13 card replaces its face, so the
     * line is no longer printed anywhere: NULL switches it off and is what
     * ships. The mode survives in the engine so switching it back on is a data
     * edit, not a rebuild.
     */
    readonly visitPayout: {
      readonly base: number;
      readonly upgraded: number;
      readonly upgradedAction: number;
      readonly twoCard: number | null;
    };
    /**
     * The coin the UPGRADED Orchard Farmstead mints per card it gives away at
     * the discard divert seam. 0 leaves the gift free, which is the paired
     * control (`overlays/orchard-farmstead-coin.overlay.json`). The base face
     * never pays it; the coin is the whole of what the upgrade buys.
     */
    readonly giftDiscardCoins: number;
  };
  readonly endGame: {
    /**
     * The flat island's clock (2026-08-09): the end fires when one seat
     * completes its `deliveriesToTrigger`-th ISLAND delivery. Balloon moves are
     * Deliver actions but not island deliveries and never count.
     */
    readonly trigger: 'deliveryCount';
    readonly deliveriesToTrigger: number;
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
