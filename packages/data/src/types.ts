/**
 * The shape of everything in packages/data/data/*.json.
 *
 * These types are hand-written and the JSON is checked against them at load, in
 * `assertGameData`. Nothing here is inferred from the JSON, deliberately: the
 * extractor can be re-run at any time against a sheet that has moved, and a
 * silently-inferred type would absorb the change instead of failing on it.
 *
 * ⭐ v31 (02/09/2026, docs/design-changes-v31-2026-09-02-v1.md). Two structural
 * changes to read before anything else:
 *
 *   1. **There are no coins.** Not a currency at zero: no currency. Every coin
 *      field is gone from every file - `startingCoins`, `upgradeCostCoins`,
 *      `coinPityDivisor`, `visitPayout`, `giftDiscardCoins`, `buyCost`,
 *      `marketCost`, `BuildCost.coins`, `ownerActivationCost`, `visitWage`. The
 *      one survivor is `IslandTileRule.coinsPerDelivery`, pinned at 0 as a
 *      tombstone; see its doc comment.
 *   2. **Starters are single-faced.** `CardFace` and `Card.faces` are deleted,
 *      so every card in the catalogue is one flat object and a card knob is one
 *      path shorter. `handSize` went with them - and it has NOT come back. The
 *      hand limit returned on 02/09/2026, but as `RulesFile.turn.handLimit`, one
 *      global number on the player aid rather than five printed per-suit ones.
 *      The Barn still prints nothing. See that field for what the deletion
 *      measured and why the reinstatement is shaped differently.
 */

export type Suit = 'wheat' | 'vegetable' | 'orchard' | 'apiary' | 'dairy';

export const SUITS: readonly Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

export type CardType = 'starter' | 'tier1' | 'tier2' | 'tier3' | 'power' | 'endgame';

/**
 * Which of the THREE printed starters a starter card is. Absent on deck cards.
 *
 * `service` left the set on 20/08/2026 with the Service card itself, when the
 * door merged into the Notice Board. Nothing synthesises a fourth starter any
 * more: the catalogue is exactly the 105 rows of the sheet.
 */
export type StarterSlot = 'barn' | 'farmstead' | 'noticeboard';

/**
 * ⭐ WHEN THE BONUS OPTION MAY BE TAKEN. See `rules.turn.bonusTiming`.
 *
 * `'end'` is the rule (Dean, 03/09/2026): meeples, core action, then the bonus.
 * `'start'` is the 19/08/2026 rule it corrects and the paired control. `'any'`
 * is v14's "once per turn, at any point" and a superset of both.
 */
export type BonusTiming = 'start' | 'any' | 'end';

/**
 * ⭐ WHAT A VISIT IS PAID IN. See `rules.turn.visitCurrency`.
 *
 * `'card'` is the shipped v31 game and the DEFAULT: one card from your hand onto
 * any Notice Board, your own included, and that board is an ordinary building
 * with a threshold. `'meeple'` is the meeple-loop arm (Dean, 04/09/2026): one
 * meeple from your supply into the colour slot of a NEIGHBOUR's Notice Board,
 * which is not a building at all, with COLLECT as the other bonus option.
 *
 * It is a PAIRED ARM, so the two are never both true and `'card'` must stay
 * bit-reproducible. Under `'meeple'` the engine ignores `selfVisitAllowed` and
 * `economy.noticeBoardThreshold`, and `bonusDraw` survives only as the number
 * Collect draws.
 */
export type VisitCurrency = 'card' | 'meeple';

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
 * A build cost as printed in the icon columns: n cards of the card's own suit
 * and m cards of any suit.
 *
 * The `coins` third of this went with the currency (v31). The 30 Power and
 * Endgame cards that used to print two coin icons now print two crop icons of
 * their own suit, so they arrive here as `{ suit: 2, wild: 0 }` and are paid for
 * in the same resource as everything else.
 */
export interface BuildCost {
  readonly suit: number;
  readonly wild: number;
}

/**
 * One card. Flat since v31: starters print one face for the whole game, so there
 * is no `faces` block and no upgrade price, and every field below means the same
 * thing on a starter as on a deck card.
 */
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
  /** Null on the three starters, which are never built. */
  readonly buildCost: BuildCost | null;
  /** The crop a GROW must pay in, or `wild` for any card. Null: cannot be grown. */
  readonly activationType: string | null;
  /** Cards the building holds before it is full and clogged. Null: not a building. */
  readonly threshold: number | null;
  /** Scored at game end for having built it. 0 on all fifteen starters. */
  readonly printedVp: number;
  /** Empty string where the card prints nothing, which is the five Barns. */
  readonly abilityText: string;
  readonly abilityTrigger: readonly AbilityTrigger[];
  readonly needsDesignReview: boolean;
  /** Starters only; absent on the 90 deck cards. */
  readonly slot?: StarterSlot;
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
  /**
   * ⚰️ TOMBSTONE, PINNED AT 0. v31 deleted coins and the island pays a MEEPLE
   * instead, so this can never be anything but 0. It survives because the v31
   * plan named the key explicitly rather than deleting it, and because a visible
   * zero is a louder record than a silent removal for anybody arriving from a
   * pre-v31 report. It deliberately has no knob.
   */
  readonly coinsPerDelivery: number;
}

/**
 * The bag of meeples the island's delivery spaces are seeded from (v31).
 *
 * One is placed FACE UP on every delivery space at setup and is claimed with
 * that delivery; its owner spends it at the start of a later turn to perform its
 * colour's plain action, after which it leaves the game. The colour-to-action
 * map is NOT here: a meeple performs the same action as that colour's Notice
 * Board door, which is `workers.roster`. One map, one file.
 */
export interface MeeplePool {
  readonly perColour: number;
  readonly colours: readonly Suit[];
  /**
   * Stored rather than derived, so an overlay that moves `perColour` has to move
   * this too and cannot half-change the bag. `data.test.ts` asserts the two
   * agree, and that assertion is the whole reason it is not a computed getter.
   */
  readonly poolSize: number;
  readonly perDeliverySpace: number;
  /**
   * WHICH delivery spaces carry a meeple, as indices into `vpByDeliveryOrder`.
   * READ ONLY under `rules.turn.visitCurrency: 'meeple'`; the `'card'` game
   * keeps using `perDeliverySpace` and is untouched by this key.
   *
   * `[1]` is the rule (R12): the 3 VP second delivery carries the tile's only
   * meeple and the 6 VP first pays VP alone. `perDeliverySpace` could say how
   * many but never WHICH, and which is the whole design - under the arm meeples
   * recirculate (a spent one moves to a neighbour's board), so the island tops
   * the loop up on the slower half of the race rather than paying both spaces.
   * `[]` seeds none, which is the control for "does the island need to pay
   * meeples at all now they come back".
   */
  readonly seededSpaces: readonly number[];
  readonly faceUpAtSetup: boolean;
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
   * space means writing down what it pays, in the same edit - and since v31,
   * finding it a third meeple out of a bag that is only 25 deep.
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
  /** The v31 meeple bag: 5 of each of the 5 colours, one per delivery space. */
  readonly meeples: MeeplePool;
  readonly slotsBySeats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly levelThreeTilesBySeats: Readonly<Record<string, readonly string[]>>;
  readonly demandTokensBySeats: Readonly<Record<string, DemandTokenPool>>;
  readonly adjacency: null;
  readonly tiles: readonly IslandTile[];
}

export type WorkerAction = 'harvest' | 'deliver' | 'draw' | 'sow' | 'build';

/**
 * One suit's DOOR: the action its Notice Board grants to whoever places a card
 * on it, and the action a meeple of that colour performs when spent. `id` is the
 * action, so every existing "which worker" reference keeps working.
 *
 * ⭐ v31: the doors are PLAIN. Every enhancement the old Services carried (the
 * relaxed harvest, the hand card into the barn, the deck-sown card, the build at
 * a discount with crop requirements waived) is gone, because the bonus slot
 * itself became the enhancement - a door buys a whole core action for one card.
 * The `draw` and `sow` blocks below survive only because those two actions need
 * a size, not because they are riders.
 */
export interface SuitDoor {
  readonly id: WorkerAction;
  /**
   * Flavour only. These were the Service cards' printed names and nothing prints
   * them now; they are kept so the UI and the reports read better than an action
   * id would. See the note in workers.json.
   */
  readonly name: string;
  readonly action: WorkerAction;
  readonly actionText: string;
  /** Ownership of the BOARD, not of the meeple: the seat playing this suit owns this door. */
  readonly linkedSuit: Suit;
  /**
   * ⭐ THE ONE EXCEPTION IN THE SET, AND IT IS LOAD-BEARING. Draw 3, where a
   * plain door would be Draw 2. A visitor pays 1 card, and the bonus slot's
   * other option is a free Draw 1 (`rules.turn.bonusDraw`), so a Draw 2 door
   * nets +1 - exactly what the free option gives for nothing - and would be
   * strictly worse than its own alternative. Draw 3 nets +2. Tidy it to 2 for
   * consistency and the Orchard door dies silently.
   */
  readonly draw?: { readonly see: number; readonly keep: number };
  /**
   * THE SAME DOOR UNDER THE MEEPLE-LOOP ARM (`rules.turn.visitCurrency:
   * 'meeple'`), and a SECOND printed payload rather than an edit to the first,
   * so that the shipped game's Draw 3 cannot move when the arm does.
   *
   * 2 / 2 under the arm: the exception above exists only because a visit costs a
   * CARD and the slot's alternative is a free Draw 1. A meeple visit costs no
   * card and there is no standalone free Draw, so the self-cancellation law has
   * nothing to bite on and the door is the plain base action like the other
   * four. Absent on every other door, which simply keeps its one action.
   */
  readonly drawUnderMeepleCurrency?: { readonly see: number; readonly keep: number };
  /**
   * The Apiary door. `from: 'hand'` in v31 and RULED that way knowingly: it
   * makes this the weakest door on the table, because the visitor pays a card
   * onto the board and a second card into the sow for one threshold step.
   * `from: 'deck'` is the fix if the door takes no traffic - see workers.json.
   */
  readonly sow?: { readonly amount: number; readonly from?: 'hand' | 'deck' };
}

export interface WorkersFile {
  readonly meta: DataMeta;
  /** Named `roster` for the same reason `catalogue` is: no `workers.workers`. */
  readonly roster: readonly SuitDoor[];
}

/** @deprecated The Services are gone (v31). Alias kept so old imports fail loudly at review, not silently. */
export type SuitService = SuitDoor;

/** @deprecated The Hiring Fair is gone (2026-08-10). */
export type HiredWorker = SuitDoor;

/**
 * `harvestAny` replaced `gainCoins` on the magenta balloon (v31). It carries no
 * `amount`: "even if it is not full" is a permission, not a size.
 */
/**
 * ⭐ `meepleFromBag` ADDED 03/09/2026 (Dean): *"what if one power let you draw a
 * random meeple from a bag?"*
 *
 * It is the only balloon reward denominated in ACTIONS rather than in cards, and
 * that is the whole reason to try it. Every other reward hands you material and
 * the bots price material well; a meeple is a stored action, which is the thing
 * the bonus slot and the doors are also selling, so it is the one reward that
 * competes with them on their own terms.
 *
 * ⚠️ THE COMPONENT QUESTION IS NOT SETTLED. The island's bag of 25 is dealt out
 * at setup - 24 of 25 at four seats - so there is no meaningful remainder to
 * draw from at high seat counts, and drawing from it would make this balloon
 * nearly dead at 4p and strong at 2p. The implementation therefore draws a
 * uniform random colour from `island.meeples.colours`, which is a SEPARATE
 * supply in physical terms and would need its own small bag on the table. That
 * is a component addition and Dean's call.
 */
export type BalloonRewardType =
  'draw' | 'buildDiscount' | 'sowFromHand' | 'harvestAny' | 'meepleFromBag';

export interface Balloon {
  readonly id: string;
  readonly colour: string;
  readonly hex: string;
  readonly rewardText: string;
  readonly reward: { readonly type: BalloonRewardType; readonly amount?: number };
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
    /** 0 since v31: the barn starts empty. */
    readonly startingBarnCards: number;
  };
  readonly turn: {
    readonly actionsPerTurn: number;
    readonly bonusSlotsPerTurn: number;
    /**
     * The plain Draw action. `see` equals `keep` since v31 - Draw 2, keep both,
     * discard nothing. A door prints its own numbers (`workers.roster`).
     */
    readonly baseDraw: { readonly see: number; readonly keep: number };
    /**
     * The SOLITAIRE half of the bonus slot: this many cards off the top of any
     * one deck in play, taken instead of placing a card on a Notice Board.
     *
     * It exists so the bonus slot is never dead - an empty hand has no card to
     * place - and it is the yardstick every door has to beat. Raising it is the
     * cheapest way to kill all five doors at once, which is why the Orchard door
     * is Draw 3 rather than Draw 2.
     */
    readonly bonusDraw: number;
    /**
     * ⭐ THE HAND LIMIT, BACK AT A FLAT 12 AND AS ONE GLOBAL RULE (Dean,
     * 02/09/2026, reversing one v31 change on evidence).
     *
     * Cards you may still be holding when your turn ENDS. You may exceed it
     * mid-turn - several cards need you to (O14 sows a whole hand, W10 empties
     * one into the barn) - and the overflow is discarded at the turn boundary.
     * null disables the rule and restores v31's no-limit behaviour, which is the
     * control arm.
     *
     * ## Why it came back, and what the deletion measured
     *
     * v31 deleted the limit as a printed Barn value and expected to lose only a
     * clock. It also lost the bound on the LEGAL-MOVE ENUMERATOR, which nothing
     * else in the game was holding: `subsets` in the engine's `actions.ts`
     * carried the comment *"hands are 6-8"*, and that bound WAS the hand limit.
     * With hands reaching 34 cards, one 2-seat position offered 43,879 legal
     * moves, 43,845 of them build payments - C(33,4) is 40,920 ways to pay for
     * one buildable card - and a re-measurement found a worse position at
     * 116,535. A 2-seat game went from ~0.1s to 1-15 minutes, so the watch-list
     * suite could only be run at n=8 and every conclusion from that run is an
     * anecdote. The bots hoarded to a median hand of 18, the free bonus Draw 1
     * became strictly dominant (beating a neighbour visit 3:1, failing the hook
     * assertion), and the 2-seat game ran to 45 rounds.
     *
     * It is a DESIGN failure before it is an engineering one. A gateway player
     * choosing between forty thousand ways to pay for one build is not a
     * shippable turn, and a hand with no ceiling has no diminishing return - so
     * a free card always beats a neighbour, which is the hook losing to
     * arithmetic rather than to a design decision.
     *
     * ## The shape is deliberately NOT the old rule
     *
     * One global number, not five printed per-suit ones. The Barn prints nothing
     * and stays blank (v31 §1.4 is untouched): a rule that applies to everybody
     * belongs on the player aid, not on a card, and restoring the old
     * `Card.handSize` field would have restored the 5/5/5/4/5 table with it.
     *
     * ## ⭐ 12 -> 7 (Dean, 03/09/2026), and it is a design decision that happens
     * also to be the biggest speed lever in the project
     *
     * 12 was a guess - roughly three turns of accumulation above the 4-card
     * opening hand - and it bought correctness without buying much else. Two
     * arguments took it to 7, and the design one comes first:
     *
     *   - **THE DIMINISHING RETURN HAS TO BITE.** The hook assertion has been
     *     failing because the free bonus Draw 1 beats visiting a neighbour about
     *     3:1, and the standing hypothesis is that a free card is strictly
     *     dominant only while a hand can absorb it indefinitely. At 12 it very
     *     nearly can. At 7 - three above the opening hand - a draw starts
     *     costing you the card it displaces, which is the price a visit has to
     *     compete with. If the bonus mix moves toward the visit, that is this
     *     rule working, and it must NOT be read as an artefact of the same day's
     *     simulator optimisation.
     *   - **The worst build payment is C(limit - 1, 4)**: 330 at 12, 15 at 7.
     *     That is about 22x off the widest enumeration in the game, and it puts
     *     the branching factor back inside the 4-7 band where the suite used to
     *     run at 9.7 games per second.
     *
     * It is still a knob and still a guess, only a better-argued one. Sweep it
     * with `overlays/hand-limit.sweep.json`, whose ladder now brackets 7.
     */
    readonly handLimit: number | null;
    /**
     * ⭐ RISK 2 OF THE WHOLE v31 PASS, ARMED ON PURPOSE. True: you may place
     * your bonus card on your OWN Notice Board and take your own suit's action.
     *
     * Every previous version of this game has had the solitaire option crowd the
     * visit out when the two competed for one slot. The only brake is
     * structural: your own card counts toward your own threshold of 2, so
     * feeding your board clogs it in two turns and shuts your own door.
     * `a08-the-hook` must count self-visits SEPARATELY or it will report a
     * healthy hook while the table plays solitaire. False is the paired control.
     */
    readonly selfVisitAllowed: boolean;
    /**
     * ⭐ THE BONUS WINDOW, THREE-STATE SINCE 03/09/2026 (Dean). Replaces the
     * `bonusAtStartOnly` boolean, which could not express the shipped rule.
     *
     *   - `'end'`   THE RULE. Meeples, then your core action, then the bonus.
     *               The door cannot fuel your action; your action informs the
     *               door. Ruled by Dean on 03/09/2026 as a CORRECTION - the
     *               engine and both design docs had carried `'start'` since
     *               19/08/2026 and were wrong about the game.
     *   - `'start'` The old rule, kept as the paired control
     *               (overlays/bonus-first.overlay.json). The bonus commits
     *               before you act, so a door can fuel the action and nothing
     *               can inform the door.
     *   - `'any'`   v14's "once per turn, at any point", a superset of both
     *               (overlays/bonus-any-time.overlay.json).
     *
     * The three are NOT orderable by power. `'start'` is the only one where a
     * door can pay for the action that follows it (visit the Orchard door for
     * Draw 3, then Build with the cards); `'end'` is the only one where the
     * action can set the door up (fill a building, then Harvest it through the
     * Wheat door; harvest into the barn, then Deliver through the Vegetable
     * one). Expect the door mix to move, not just the visit rate.
     */
    readonly bonusTiming: BonusTiming;
    /**
     * ⭐ THE MEEPLE-LOOP ARM, BEHIND ONE KNOB (Dean, 04/09/2026,
     * docs/meeple-loop-visit-handoff-2026-09-04-v1.md). `'card'` is the shipped
     * v31 game and the default; `'meeple'` is the whole redesign of the visit.
     *
     * ## What `'meeple'` changes
     *
     *   - **The currency.** A visit costs one MEEPLE from your supply, placed in
     *     the colour slot of a NEIGHBOUR's Notice Board. No card is ever placed
     *     on a board and no card leaves your hand (R1).
     *   - **The board.** It is not a building: no threshold, no stack, no sow
     *     onto it, no harvest of it, five colour-keyed slots and nothing else
     *     (R5). A slot is blocked while a meeple sits in it (R6).
     *   - **The other bonus option.** COLLECT: take every meeple off your own
     *     board into your supply, then Draw 1 (R7). The standalone free Draw 1
     *     is gone (R9); its number survives as what Collect draws.
     *   - **The turn-start meeple spend is deleted** (R8), and a spent meeple is
     *     never removed from the game - it moves to the host's board and comes
     *     back to them on their Collect.
     *   - **Two meeples may be spent as one of any colour** (R10, the wild
     *     pair); both land in the slot of the action bought.
     *   - **No self-visit under any flag** (X5), so `selfVisitAllowed` is
     *     ignored, and `economy.noticeBoardThreshold` is ignored with it.
     *
     * ⚠️ `'card'` MUST STAY BIT-REPRODUCIBLE. It is the control every number
     * from the arm is a delta against, on identical seeds, so nothing above may
     * be "tidied" into the default path.
     */
    readonly visitCurrency: VisitCurrency;
    /**
     * Meeples of EACH colour a seat starts with (R3). Read only under
     * `visitCurrency: 'meeple'`; the `'card'` game starts every supply empty and
     * this key does not reach it.
     *
     * 1 primes the loop before anybody has delivered, so a visit is available on
     * the first turn at every seat. These are NOT drawn from the island bag -
     * five per player plus one per tile is 32 at four seats against a bag of 25,
     * and whether the physical bag grows is a component question for Dean, not a
     * simulation one. 0 is the control arm: it asks how much of the loop's
     * traffic is the starting hand of meeples rather than the rule.
     */
    readonly startingMeeplesPerColour: number;
    /**
     * ⭐ THE SUPPLY CAP (R4), and the answer to piles. Read only under
     * `visitCurrency: 'meeple'`.
     *
     * You may never HOLD more than this many meeples of one colour. A meeple you
     * would gain of a colour you are already at the cap on is returned to the
     * box - removed from the game - whether it came from collecting your own
     * board or from an island delivery, and the engine emits `meepleBoxed`
     * instead of `meepleGained` so the loss is countable by source.
     *
     * It exists because meeples now RECIRCULATE. In v31 a spent meeple left the
     * game, so the supply could only shrink; under the arm it moves to a
     * neighbour's board and returns on their Collect, and with no ceiling a seat
     * could bank a wall of stored actions. Sweep 1 against 2 with the median
     * supply held in the last third and the boxed-per-game count, never alone.
     */
    readonly meepleCapPerColour: number;
    /**
     * ⭐ R15, THE MEEPLE-AS-CARD ARM (Dean, 04/09/2026 evening,
     * docs/meeple-loop-visit-handoff-2026-09-04-v2.md). Read only under
     * `visitCurrency: 'meeple'`.
     *
     * `false` is the shipped v1 loop, unchanged: a meeple only ever performs
     * its colour's action through a neighbour's board (R7) and is never a
     * payment. **THIS IS THE DEFAULT, AND IT MUST STAY BIT-REPRODUCIBLE** -
     * v1 is the control every handoff-v2 arm is a delta against.
     *
     * `true` lets a meeple of a colour stand in for a card of that colour
     * anywhere a rule asks you to pay or spend one: build costs, including the
     * n-of-suit requirements and the 'any' slots, the 2-own-suit cost on Power
     * and Endgame cards, a Grow's activation payment, and a delivery crate. A
     * meeple spent this way goes STRAIGHT TO THE BOX, wherever the card it
     * stands in for would have gone - it never enters a hand, a barn, a
     * discard pile or a building's stack, and it never counts toward
     * `handLimit`. Two meeples of any colours still pay as one card of any
     * colour: R10's wild pair is reused rather than re-rated. A meeple paid
     * into a Grow does not join the stack and does not count toward the
     * threshold, so it can activate a building that is already full.
     *
     * Why the arm exists: under v1 a meeple with no competing use is a coupon,
     * not a cost, and spending one is not a decision. R15 gives it one.
     */
    readonly meepleAsCard: boolean;
    /**
     * ⭐ THE AMENDED R6, THE PRICED SLOT (Dean, 04/09/2026 evening,
     * docs/meeple-loop-visit-handoff-2026-09-04-v2.md). Read only under
     * `visitCurrency: 'meeple'`.
     *
     * `null` is the v1 rule, unchanged: a slot holding any meeple is BLOCKED
     * and refuses that colour outright until the owner Collects. **THIS IS
     * THE DEFAULT, AND IT MUST STAY BIT-REPRODUCIBLE** for the same reason as
     * `meepleAsCard` above.
     *
     * A number `n` turns the block into a price. Nothing is ever refused:
     * visiting a slot that already holds `k` meeples costs `n * k` EXTRA
     * meeples of ANY colours, on top of the acting meeple, and every one of
     * those extra meeples - the toll - goes STRAIGHT TO THE BOX, never to the
     * host. A slot already holding two meeples under `slotToll: 1` costs
     * three to visit: one joins the slot, two are boxed. A wild pair sitting
     * in a slot counts as two occupants, not one.
     *
     * ⚠️ The toll is a SINK, not a payment to the host - Dean's framing is
     * that it "might be a good way of sinking surplus meeples" once the cap
     * is loosened, so read it beside `meepleCapPerColour` and never alone.
     */
    readonly slotToll: number | null;
    /**
     * ⭐ R17, WHERE A MEEPLE SPENT AS A CARD GOES (Dean, 05/09/2026). Read
     * only under `meepleAsCard: true`.
     *
     * `'box'` is the handoff v2 arm and **it is the default, so it must stay
     * bit-reproducible**: a meeple spent as a card leaves the game.
     *
     * `'board'` closes that drain. The meeple is PLACED ON ANOTHER PLAYER'S
     * NOTICE BOARD, in its own colour's slot, exactly as a visit places one,
     * and the host takes it back on their Collect. It buys the payer nothing
     * beyond the thing it paid for: **no door action, and it is not a visit**,
     * so the bonus slot is untouched and one payment may spend any number of
     * meeples. The payer chooses a host PER MEEPLE (Dean, 05/09/2026), so one
     * payment may feed several neighbours.
     *
     * ⚠️ WHY IT EXISTS, in one line: the v2 measurement found meeples
     * leaving the game 18.27 times a game against 9.44 visits, the median
     * supply in the last third at 0.0 and the hook at 0.09. The resource use
     * was not competing with the loop, it was emptying it.
     */
    readonly meepleAsCardGoesTo: 'box' | 'board';
    /**
     * THE PAYMENT TOLL (Dean, 05/09/2026), read only under
     * `meepleAsCardGoesTo: 'board'`. Placing a paid meeple onto a slot that
     * already holds one costs this many extra meeples of any colour, boxed.
     *
     * ⚠️ IT IS FLAT, NOT PER OCCUPANT, and that is the one place it
     * differs from `slotToll`. A slot holding three still costs one extra to
     * place on. Dean ruled it flat so the rule is one sentence and a deep slot
     * can never make a build unpayable.
     */
    readonly paymentSlotToll: number;
    /**
     * WHO RECEIVES A MEEPLE PAYMENT (R17), read only under
     * `meepleAsCardGoesTo: 'board'`.
     *
     * `'perMeeple'` is Dean's ruling of 05/09/2026 and the default: a host is
     * chosen for EACH meeple, so one payment may feed several neighbours.
     *
     * ⚠️ IT IS ALSO THE BRANCHING FACTOR OF THE WHOLE ARM. A host per
     * meeple multiplies the build enumerator by roughly hosts^meeples: measured
     * at 25,827 ways to pay for one building at four seats, against 841 with
     * the box and 130 under the v1 loop. `'perPayment'` is the measured
     * alternative - the whole payment lands on ONE chosen host, which keeps the
     * decision of who to feed and collapses the factor to the host count.
     */
    readonly paymentHostChoice: 'perMeeple' | 'perPayment';
  };
  readonly economy: {
    /**
     * ⭐ THE ONLY ECONOMY NUMBER LEFT, AND THE BALANCE LEVER. How many cards a
     * Notice Board holds before it clogs and the farm shuts to visitors - and,
     * since v31, to its owner too.
     *
     * An OVERRIDE of the printed face, kept as an override because the value is
     * a ruling and the face is generated from the spreadsheet. Ruled 2 on
     * 20/08/2026; null hands the number back to the card. The v31 sheet prints
     * 2, so the long-standing 5-versus-2 drift is closed and this now agrees
     * with the print.
     *
     * The only lever ever measured to move the suit balance: on the older
     * two-building surface, t=4 gave Orchard 80.8%, t=3 62.8%, t=2 42.0% against
     * an even share of 36.4%; on the single-door surface, t=5 clogged 2.3% of
     * turn boundaries, t=3 5%, t=2 11%, with the spread most even at 2. In v31
     * it throttles self-visit traffic as well, so 2 is doing more work than any
     * arm has yet measured. Never raise it without re-running the suite.
     */
    readonly noticeBoardThreshold: number | null;
  };
  readonly endGame: {
    /**
     * The flat island's clock (2026-08-09): the end fires when one seat
     * completes its `deliveriesToTrigger`-th ISLAND delivery. Balloon moves are
     * Deliver actions but not island deliveries and never count.
     *
     * ⭐ THE FIRST KNOB TO SWEEP AFTER v31. The bonus slot now buys a whole core
     * action for one card and meeples add uncapped free ones, so the same 6
     * deliveries arrive sooner and turns are materially more powerful than
     * v30's. Expect a shorter game and higher scores before anything is dialled.
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
