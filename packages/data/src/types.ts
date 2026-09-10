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
 * ⭐ WHAT A VISIT IS PAID IN, AND WHOSE BOARD IT LANDS ON. See
 * `rules.turn.visitCurrency`.
 *
 * ⭐ `'commons'` IS THE SHIPPED GAME SINCE 09/09/2026 (Dean,
 * `docs/commons-handoff-2026-09-09-v1.md`). The five Notice Boards sit
 * OWNERLESS IN THE CENTRE of the table, all five whatever suits are in play, and
 * the bonus is to play any ONE card from your hand onto one of them and take
 * that board's action. No colour matching, no threshold, no slots, no meeples
 * anywhere, and the bonus is taken FIRST (`bonusTiming: 'start'`).
 *
 * The other two are the CONTROLS and their branches are not dead code:
 *
 *   - `'card'` is the v31 game of 02-04/09/2026: one card from your hand onto
 *     any Notice Board, your own included, and that board is an ordinary
 *     building with a threshold
 *     (`overlays/v31-card-visit.overlay.json`).
 *   - `'meeple'` is the meeple loop of 04-05/09/2026: one meeple from your
 *     supply into the colour slot of a NEIGHBOUR's board, which is not a
 *     building at all, with COLLECT as the other bonus option
 *     (`overlays/meeple-loop-v1.overlay.json` for the v1 loop,
 *     `overlays/meeple-economy-v1.overlay.json` for the reference-v14 game).
 *
 * All three must stay bit-reproducible: every delta this project has ever
 * measured is read against one of them on identical seeds. Under `'meeple'` the
 * engine ignores `selfVisitAllowed` and `economy.noticeBoardThreshold`, and
 * `bonusDraw` survives only as the number Collect draws; under `'commons'` all
 * three of those are subjectless, because the slot holds exactly one option and
 * nobody owns a board.
 */
export type VisitCurrency = 'card' | 'meeple' | 'commons';

/**
 * ⭐ WHAT A HARVEST OF THE CENTRE IS, UNDER THE COMMONS. See
 * `rules.turn.commonsTake`.
 *
 * Dean's variant, put to the engine session on 09/09/2026: *"Your bonus action
 * can be to place 1 card in the centre [and take that board's action], OR take
 * all the cards on one pile (without playing a card). If you take the pile of
 * cards, instead of going into the barn, they go into your HAND. So we remove
 * the rule that a harvest takes the cards from one central card. Effectively
 * we change the bonus action into a draw instead of a harvest."*
 *
 * `'harvest'` is the shipped rule (C5): a central pile is reached only by
 * Harvest, whole pile to the harvester's BARN, and `commonsHarvestMin` /
 * `commonsHarvestTake` ration it. `'bonus'` is Dean's take-to-hand variant:
 * Harvest never reaches the centre at all - the wheat board buys a Harvest of
 * an own full building only - and the bonus slot's second option becomes
 * `commonsTake`, a free draw of one whole pile straight into the taker's HAND.
 *
 * ⭐ `'spend'` IS THE THIRD VALUE (Dean, 09/09/2026), following exactly the
 * pattern `'bonus'` was added by. It reuses the SAME `commonsTake` move - no
 * fee, no card played - but the resolution now depends on WHICH BOARD is
 * taken, because Dean's own words describe five different fates, not one:
 * *"You can play a card to a centre card to do the bonus action. OR, you can
 * take all the cards from a central pile and then use those cards to pay for
 * a bonus action of the matching type. So, if you take all the cards from the
 * Draw card, they go into your hand. All the cards on the Harvest go into
 * your barn. All the cards on the Build action can be spent to do a Build.
 * All the cards on the Deliver action can immediately be used to deliver
 * (this is one to watch, this could be crazy). All the cards on the Grow
 * action are used to SOW (not grow, that would be crazy). Any cards that
 * cannot be used are discarded. So, if there are 3 cards on the build action
 * and you build a card that costs 1, the excess are discarded - they don't go
 * into your hand."*
 *
 * Orchard (Draw) to HAND, exactly as `'bonus'`. Wheat (Harvest) to BARN
 * instead of hand - Harvest still never reaches the centre (D-S4), this is
 * the take's own destination. Dairy (Build): ONE card from hand, paid FROM
 * THE PILE ONLY (D-S1: no top-up from hand). Vegetable (Deliver): ONE crate
 * to a tile with room, paid FROM THE PILE ONLY (D-S1 again; the wild
 * substitution applies within the pile). Apiary (Sow): every pile card sown,
 * one at a time in pile order, onto the taker's own non-full buildings: a
 * card with no legal building is discarded. Every card the chosen action does
 * not use - the whole pile under Draw/Harvest, whatever a build or delivery
 * payment leaves over, a sow with no building left to take it - is DISCARDED
 * to its own suit's discard pile (D-S2), never kept, never boxed.
 *
 * The builder's four defaults, none of them Dean's ruling: **D-S1** a
 * dairy/vegetable spend never tops up from hand or barn, pile only; **D-S2**
 * every unusable card is discarded, per its own suit; **D-S3** a board is
 * offered only if it can do something (the standing "a door that can do
 * nothing is not offered" ruling): orchard and wheat whenever their pile is
 * non-empty, dairy only if some hand card is payable from the pile, vegetable
 * only if the pile can pay a crate for a tile with a free space, apiary only
 * if the taker has a non-full building; **D-S4** Harvest, main or bought,
 * never reaches the centre under `'spend'`, exactly as under `'bonus'`.
 *
 * ⭐ `'paid'` IS THE FOURTH VALUE (Dean, 09/09/2026), Dean's own words: *"Play a
 * card to take a bonus action. Then play a card to take all the cards from a
 * pile. The take-a-pile action just gives you all the cards on a pile into
 * your hand. The card you pay goes to the discard pile."* It is `'bonus'`
 * EXACTLY - Harvest never reaches the centre, and a take always lands the
 * whole pile in the taker's HAND - with ONE change: the take is no longer
 * free. It COSTS one card from the taker's hand, discarded (D-P1) to ITS OWN
 * suit's discard pile rather than boxed or joining the pile it is paying to
 * take, and never the pile's own suit unless that happens to be the card
 * spent. This is the first PER-USE sink anywhere in the commons line: every
 * previous currency this project has shipped either kept the take free
 * (`'bonus'`) or paid in kind (`'spend'`'s own pile), and `'paid'` is the
 * first to burn a card that was never going to touch the centre at all.
 *
 * ⭐ `'coins'` IS THE FIFTH VALUE (Dean, 10/09/2026, K3/K4 of
 * `docs/commons-coins-handoff-2026-09-10-v2.md`), and it is the first one whose
 * take does NOT hand the cards to anybody. The bonus slot's second option
 * becomes *"discard every card on one central pile to their suits' discard
 * piles and take ONE COIN PER CARD"*: no card is paid, nothing enters a hand,
 * nothing enters a barn, and the pile simply leaves the game. Harvest never
 * reaches the centre under it either (K4, reversing C5), exactly as under
 * `'bonus'`, `'spend'` and `'paid'`, so the farm bypass reads 0% by
 * construction.
 *
 * ⛔ IT IS THE ONLY VALUE THAT MINTS A CURRENCY, and that is the whole reason
 * it is dangerous rather than merely different. Coins were deleted from this
 * game on 02/09/2026 (v31) and every earlier coin economy in the project died
 * of a second faucet or a pity rate, so the arm ships with EXACTLY ONE MINT
 * (this take) and EXACTLY TWO SINKS (`economy.farmsteadCoinPower` and
 * `economy.endgameCoinCost`). Coins score nothing, break no ties and buy no
 * ordinary card. `overlays/commons-coins-v1.overlay.json` is the arm.
 *
 * Read only under `visitCurrency: 'commons'`; subjectless under `'card'` and
 * `'meeple'`.
 */
export type CommonsTake = 'harvest' | 'bonus' | 'spend' | 'paid' | 'coins';

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
 * ⭐ WHAT A DOOR CAN BUY, WHICH IS ONE WIDER THAN THE FIVE CORE ACTIONS SINCE
 * 09/09/2026: the commons Apiary board buys a GROW, and GROW is not a
 * `WorkerAction` because no meeple and no v31 door ever bought one.
 *
 * It is a SEPARATE type rather than a sixth member of `WorkerAction` on purpose.
 * `WorkerAction` is the five-door set that the UI's `ACTION_LABEL`, `doorArt`
 * and `DOOR_ORDER` are exhaustive over, and widening it would silently oblige
 * every one of those to grow a sixth case for a door that only exists under one
 * currency. Anything that dispatches on what a door BUYS reads this; anything
 * that enumerates the five suit doors keeps reading `WorkerAction`.
 */
export type DoorAction = WorkerAction | 'grow';

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
  /**
   * ⭐ THE SAME DOOR UNDER THE COMMONS (`rules.turn.visitCurrency: 'commons'`),
   * and a SECOND printed payload rather than an edit to `action` above, exactly
   * as `drawUnderMeepleCurrency` sits beside `draw`. Absent on four of the five
   * doors, which keep the one action they have always had.
   *
   * Present on the APIARY door alone, at `'grow'` (Dean, 09/09/2026, C3 of
   * `docs/commons-handoff-2026-09-09-v1.md`): the central Apiary board buys a
   * plain GROW - pay the building's activation card into its stack, gain the
   * ability - where the v31 door and the meeple bought a SOW. The board's fee is
   * extra, and there is no clog bypass, which was the meeple-paid Grow of R15
   * and went with the meeples.
   *
   * ⚠️ IT IS A SECOND PAYLOAD SO THAT THE CONTROLS NEED NO PIN. `action` is not
   * in the knob registry, so `overlays/v31-card-visit.overlay.json` and
   * `overlays/meeple-loop-v1.overlay.json` could not pin a Sow back if the
   * commons had simply overwritten it - the 05/09/2026 passenger lesson arriving
   * one level down. This key IS a knob
   * (`workers.roster.{}.actionUnderCommons`), so a "Sow, not Grow" arm under the
   * commons is one overlay.
   */
  readonly actionUnderCommons?: DoorAction;
  readonly actionText: string;
  /** Ownership of the BOARD, not of the meeple: the seat playing this suit owns this door. */
  readonly linkedSuit: Suit;
  /**
   * The Orchard door's size, and the one number in the door set that has ever
   * been argued over.
   *
   * ⭐ 2 / 2 SINCE 09/09/2026 (Dean chose 2 over 3, C3): under the commons the
   * door is plain like the other four, and Draw 3 is the paired arm at
   * `overlays/commons-draw-three.overlay.json`. ⚠️ THE ARGUMENT IS NOT SETTLED
   * BY THAT CHOICE, because the commons puts a FEE back on the bonus: a play
   * costs one card, so Draw 2 returns 2 for 1 and nets +1 where every other
   * board hands back a whole action for the same card. That is the thinnest
   * return in the set, and whether it leaves the Orchard board dead is the
   * reading `commons-draw-three` exists to take.
   *
   * ⛔ 3 / 3 IS THE v31 RULE AND THE CONTROL PINS IT, so this doc keeps the
   * argument that made it: a visitor paid 1 card, and the bonus slot's other
   * option was a free Draw 1 (`rules.turn.bonusDraw`), so a Draw 2 door netted
   * +1 - exactly what the free option gave for nothing - and was strictly worse
   * than its own alternative. Draw 3 netted +2. That is the self-cancellation
   * law, and it has no subject in a game with no free draw; if a card price ever
   * comes back beside a free option, it does.
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
     *
     * ⛔ IT HAS NO SUBJECT IN THE SHIPPED GAME AND HAS NOT HAD ONE SINCE
     * 04/09/2026. Under `'meeple'` the standalone free Draw 1 was deleted and
     * this number survived as what COLLECT draws; under `'commons'`
     * (09/09/2026) there is no Collect either, so the bonus slot holds exactly
     * one option and it costs a card (C9). The value stays at 1 because the two
     * controls read it, not because anything in the shipped game does.
     */
    readonly bonusDraw: number;
    /**
     * ⭐ 7 IS THE SIMULATOR'S BOUND AND NOT A GAME RULE (Dean, 09/09/2026, C7).
     * READ THIS BEFORE QUOTING ANY HAND NUMBER MEASURED HERE.
     *
     * The table plays with NO hand limit and Dean found that positive. The
     * engine keeps 7 because the legal-move enumerator cannot cost an
     * end-of-turn discard without a ceiling - the history below is what happened
     * the one time it tried - so EVERY REPORT HEADER MUST SAY the limit is the
     * instrument's and not the game's. Nothing measured under it describes the
     * hand Dean is playing with. What a future session needs before it can
     * measure the table's hand is a bot-side discard heuristic in place of the
     * rule, and nobody has designed one.
     *
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
     *
     * ⛔ DEAD SINCE 04/09/2026 AND NOW DEAD TWICE OVER. The meeple loop made a
     * self-visit impossible by construction (X5); under the commons NOBODY OWNS
     * A BOARD, so there is no such thing as visiting yourself and nothing for
     * the flag to permit. It stays `true` in the data and is read only by the
     * v31 control, which is the only arm where it means anything.
     */
    readonly selfVisitAllowed: boolean;
    /**
     * ⭐ 'start' AGAIN SINCE 09/09/2026 (Dean, C2), AND THAT IS A REVERSAL OF
     * THE 03/09/2026 RULING BELOW, ON HIS OWN CALL. The bonus is taken FIRST
     * and the turn visibly ends on the main action, which is his reason in full.
     * `'end'` - the correction described below - is now the paired control at
     * `overlays/commons-bonus-last.overlay.json`, and
     * `overlays/bonus-first.overlay.json` became a no-op on the flip and is
     * retired.
     *
     * ⚠️ QUOTE THE TWO RULINGS TOGETHER OR NEITHER. This is a reversal, not a
     * drift, and the 03/09 reasoning is kept in full below because it is the
     * argument the control runs on: under `'end'` the action can set the door up
     * (fill a building, then Harvest it through the Wheat board), which is
     * exactly the thing `'start'` gives up. Whether that mattered is a
     * measurement nobody has taken under the commons.
     *
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
     * ⭐ WHICH OF THREE GAMES THIS IS. `'commons'` is the shipped game since
     * 09/09/2026; `'card'` (v31) and `'meeple'` (the loop and the economy) are
     * the controls. See `VisitCurrency` above for the whole of it.
     *
     * ## What `'commons'` changes (Dean, 09/09/2026, C1-C10)
     *
     *   - **The boards.** All five Notice Boards are dealt to the CENTRE at
     *     setup, whatever suits are in play, and nobody owns one. No player has
     *     a Notice Board: a farm is a Farmstead and a Barn.
     *   - **The bonus.** Play any ONE card from your hand onto one central board
     *     and take that board's action. Any card, no colour matching, and the
     *     fee is EXTRA in every case. Taken FIRST (`bonusTiming: 'start'`).
     *   - **The Apiary board buys a GROW**, not a Sow
     *     (`workers.roster.sow.actionUnderCommons`), and the Orchard board is a
     *     plain Draw 2.
     *   - **No threshold anywhere in the centre.** A pile takes any number of
     *     cards, is never full and never clogs; nothing in the game refuses a
     *     play. The two fallback knobs that could change that -
     *     `economy.commonsThreshold` and `economy.commonsColourMatch` - both
     *     ship off.
     *   - **Harvest reaches the centre.** One of your full buildings OR the
     *     whole pile from any central board holding at least one card, into your
     *     barn, including a board you played on this turn (C5).
     *   - **No meeples anywhere** (C6), so `startingMeeplesPerColour` is 0,
     *     `meepleAsCard` false, `slotToll` null, `meepleCapPerColour` null and
     *     the island seeds none.
     *   - **The slot holds one option** (C9): no free Draw 1, no Collect, no
     *     self-visit. An unspent slot is a turn that chose not to pay.
     *
     * ⭐ WHY: the meeple visit failed at the table. Dean, 09/09/2026 - *"with a
     * meeple always available the bonus was basically free"*.
     *
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
     * ⭐ 0 SINCE 09/09/2026, because there are no meeples in the shipped game at
     * all (C6) - not a supply of none, no component. The meeple controls pin 1,
     * and they have to: 1 is the loop's ignition and the arm with none reads a
     * hook of 0.09 against 0.37.
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
     * `visitCurrency: 'meeple'`, so SUBJECTLESS in the shipped commons game -
     * `null` there means "there is nothing to cap", not "the cap was removed".
     * The two readings arrive at the same value from opposite directions and a
     * report must say which it means.
     *
     * You may never HOLD more than this many meeples of one colour. A meeple you
     * would gain of a colour you are already at the cap on is returned to the
     * box - removed from the game - whether it came from collecting your own
     * board or from an island delivery, and the engine emits `meepleBoxed`
     * instead of `meepleGained` so the loss is countable by source.
     *
     * It exists because meeples now RECIRCULATE. In v31 a spent meeple left the
     * game, so the supply could only shrink; under the meeple economy it moves to
     * a neighbour's board and returns on their Collect.
     *
     * ⭐ **`null` IS THE SHIPPED RULE SINCE 05/09/2026 AND MEANS NO CAP AT ALL**
     * (Dean: *"let's just remove the cap completely - there is no limit to how
     * many or what colour meeple you can hold"*). A number is a ceiling per
     * colour, kept as a knob because it is the only way to ask what the ceiling
     * was doing. Read `null` beside the median supply held in the last third and
     * the meeples-boxed count, which under no cap can only be tolls.
     */
    readonly meepleCapPerColour: number | null;
    /**
     * ⭐ R15, THE MEEPLE-AS-CARD ARM (Dean, 04/09/2026 evening,
     * docs/meeple-loop-visit-handoff-2026-09-04-v2.md). Read only under
     * `visitCurrency: 'meeple'`.
     *
     * ⚠️ SUBJECTLESS SINCE 09/09/2026 and shipped `false`, because there are no
     * meeples in the commons. It was `true` and the shipped rule from
     * 05/09/2026 to 09/09/2026; `overlays/meeple-economy-v1.overlay.json` is
     * that game and turns it back on.
     *
     * `false` is the v1 loop: a meeple only ever performs its colour's action
     * through a neighbour's board (R7) and is never a payment. **IT MUST STAY
     * BIT-REPRODUCIBLE** - v1 is the control every handoff-v2 arm is a delta
     * against.
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
     * ⚠️ SUBJECTLESS SINCE 09/09/2026 and shipped `null`: a central board has no
     * slots, so nothing in the commons is ever priced or refused (C4). It was 1
     * and the shipped rule from 05/09/2026 to 09/09/2026.
     *
     * `null` is the v1 rule: a slot holding any meeple is BLOCKED and refuses
     * that colour outright until the owner Collects. **IT MUST STAY
     * BIT-REPRODUCIBLE** for the same reason as `meepleAsCard` above.
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
     * ⚠️ SUBJECTLESS SINCE 09/09/2026, and left at `'board'` rather than reset:
     * with `meepleAsCard` false nothing reads it, and leaving it means
     * `overlays/meeple-economy-v1.overlay.json` reproduces the reference-v14
     * game without having to pin it. `'board'` has been the ruled answer since
     * 05/09/2026 (R17) and this doc's claim that `'box'` is the default is kept
     * below only as the record of the arm it was written for.
     *
     * `'box'` is the handoff v2 arm and **must stay bit-reproducible**: a meeple
     * spent as a card leaves the game.
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
     * ⚠️ SUBJECTLESS SINCE 09/09/2026, and left at `'perPayment'` for the same
     * reason as `meepleAsCardGoesTo` above: it is the ruled answer of
     * 05/09/2026, so the meeple-economy control needs no pin for it.
     *
     * `'perMeeple'` was Dean's first ruling of 05/09/2026 and he ruled it back
     * the same day on the branching factor: a host is chosen for EACH meeple, so
     * one payment may feed several neighbours.
     *
     * ⚠️ IT IS ALSO THE BRANCHING FACTOR OF THE WHOLE ARM. A host per
     * meeple multiplies the build enumerator by roughly hosts^meeples: measured
     * at 25,827 ways to pay for one building at four seats, against 841 with
     * the box and 130 under the v1 loop. `'perPayment'` is the measured
     * alternative - the whole payment lands on ONE chosen host, which keeps the
     * decision of who to feed and collapses the factor to the host count.
     */
    readonly paymentHostChoice: 'perMeeple' | 'perPayment';
    /**
     * ⭐ DEAN'S VARIANT (09/09/2026): TURN THE COMMONS' HARVEST INTO A FREE
     * DRAW. Read only under `visitCurrency: 'commons'`; subjectless under
     * `'card'` and `'meeple'`. See `CommonsTake` for the ruling in full.
     *
     * `'harvest'` IS THE SHIPPED RULE (C5) AND MUST STAY BIT-REPRODUCIBLE: a
     * central pile is reached only through the Harvest action - own full
     * building or any non-empty central pile, whole pile to the harvester's
     * BARN - so nothing here moves the shipped game.
     *
     * `'bonus'` is Dean's variant, unrun before this pass
     * (`overlays/commons-take-to-hand-v1.overlay.json`). Two changes, not one:
     *
     *   1. **Harvest never reaches the centre.** `harvestOptions` returns own
     *      full buildings only, so the wheat board's action can do nothing
     *      that a full pile alone would enable - `commonsHarvestMin` and
     *      `commonsHarvestTake` have no subject, and the wheat board is
     *      offered only when the seat already has a full building of its own.
     *   2. **A new bonus move, `commonsTake`,** takes the WHOLE of one central
     *      pile straight into the taker's HAND, no card played, no action
     *      bought. It is the bonus slot's other half under `'bonus'`, exactly
     *      as Draw 1 is under `'card'` and Collect is under `'meeple'`: a
     *      free option sharing the slot with the paid `commons` play, so a17
     *      now watches three shares of a turn - PLAY, TAKE and SLOT UNSPENT -
     *      rather than two.
     *
     * Dean's own words for why: *"we change the bonus action into a draw
     * instead of a harvest"* - the take is a draw of a known, chosen pile
     * rather than the top of a random deck, and it competes with the paid
     * play on the same "is the free option crowding out the paid one" law
     * this project has measured under every currency it has shipped.
     *
     * `'spend'` is the third value (Dean, 09/09/2026), unrun before this pass
     * (`overlays/commons-take-to-spend-v1.overlay.json`). The SAME free
     * `commonsTake` move as `'bonus'`, but its resolution now depends on WHICH
     * BOARD is taken - orchard to hand, wheat to barn (still no Harvest, D-S4),
     * dairy a build paid from the pile alone, vegetable a delivery paid from
     * the pile alone, apiary the whole pile sown one card at a time - rather
     * than always landing in the hand. See `CommonsTake` for the ruling in
     * full and the four builder defaults D-S1 to D-S4.
     *
     * ⭐ `'paid'` IS THE FOURTH VALUE (Dean, 09/09/2026), unrun before this
     * pass (`overlays/commons-take-paid-v1.overlay.json`). Dean's own words:
     * *"Play a card to take a bonus action. Then play a card to take all the
     * cards from a pile. The take-a-pile action just gives you all the cards
     * on a pile into your hand. The card you pay goes to the discard pile."*
     * It is `'bonus'` exactly - Harvest never reaches the centre, a take
     * always lands the whole pile in the taker's hand - except the
     * `commonsTake` move now carries an optional `fee`, which under `'paid'`
     * is REQUIRED: one card from the taker's own hand, discarded to its own
     * suit's pile before the take resolves. It is the first PER-USE sink in
     * the commons line. See `CommonsTake` for the ruling in full.
     *
     * ⭐ `'coins'` IS THE FIFTH VALUE (Dean, 10/09/2026, K3/K4): the take
     * discards the WHOLE pile to its cards' own suit discards and mints ONE
     * COIN PER CARD for the taker. No card is paid, nothing reaches a hand or
     * a barn, and Harvest still never reaches the centre. It is the only
     * `commonsTake` value that creates a currency rather than moving cards, so
     * it is read beside `economy.farmsteadCoinPower` and
     * `economy.endgameCoinCost`, which are the only two things a coin buys.
     * See `CommonsTake` for the ruling in full.
     */
    readonly commonsTake: CommonsTake;
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
     *
     * ⛔ READ ONLY BY THE v31 CONTROL SINCE 04/09/2026. Under `'meeple'` the
     * Notice Board is not a building; under `'commons'` a central board has no
     * threshold at all (C4). Clog as a denial tool has had no subject in the
     * shipped game for two versions running.
     */
    readonly noticeBoardThreshold: number | null;
    /**
     * ⭐ THE FIRST FALLBACK KNOB OF THE COMMONS (Dean, 09/09/2026, C10). Read
     * only under `visitCurrency: 'commons'`.
     *
     * `null` IS THE SHIPPED RULE AND MEANS NO CAP: a central pile takes any
     * number of cards, is never full and never clogs, and NOTHING IN THE GAME
     * REFUSES A PLAY. A number `n` refuses a play onto a board already holding
     * `n` cards, which makes this the only rule in the commons that can refuse
     * anything - so turning it on is a real change to C4 and not a tuning.
     *
     * WHY IT EXISTS UNRUN. The failure mode the commons is most likely to have
     * is the one the meeple visit died of: the bonus reading AUTOMATIC. A meeple
     * visit at least needed a meeple; a card play needs a card, and a hand
     * almost always has one. Dean's band is that the bonus should be played on
     * 30% to 60% of turns, so if `a17` reads above 60% - at two players first -
     * this is the number that answers it without redesigning the slot.
     * `overlays/commons-threshold-2.overlay.json` is the arm.
     *
     * ⚠️ IT IS NOT THE v31 CLOG COMING BACK. A full central board shuts one of
     * five boards to EVERYBODY including the player who filled it, and any
     * player may empty it with a Harvest, which is the opposite of a board its
     * owner sat on to deny the table.
     */
    readonly commonsThreshold: number | null;
    /**
     * ⭐ THE SECOND FALLBACK KNOB OF THE COMMONS (Dean, 09/09/2026, C10). Read
     * only under `visitCurrency: 'commons'`.
     *
     * `false` IS THE SHIPPED RULE: any card from your hand pays for any board.
     * `true` demands the card MATCH the board's suit, with two cards of any
     * suits standing in for one of the board's colour - the island's wild
     * substitution rate, reused rather than re-rated (D5).
     *
     * It is the other half of the same worry as `commonsThreshold`, and it
     * prices the bonus differently: a threshold rations HOW OFTEN the centre can
     * be used, colour matching rations WHICH BOARD a given hand can afford. That
     * makes it the one to reach for if the bonus rate is fine but the DOOR MIX
     * is not - a hand of Wheat can buy any board today, so the mix is a taste
     * rather than a constraint. ⚠️ It also pushes hard against the monoculture
     * finding (v31 risk 3): under matching, an own-suit hand can only ever
     * afford its own board. `overlays/commons-colour-match-v1.overlay.json` is
     * the arm.
     */
    readonly commonsColourMatch: boolean;
    /**
     * ⭐ THE WILD PAIR, BUILT AT LAST (Dean, 10/09/2026, K3 of
     * `docs/commons-coins-handoff-2026-09-10-v2.md`). Read only under
     * `visitCurrency: 'commons'` AND `commonsColourMatch: true`; it means
     * nothing on its own, because there is no colour to stand in for when any
     * card already pays for any board.
     *
     * `false` IS THE SHIPPED VALUE and it is also how the colour-match arm was
     * actually MEASURED on 09/09/2026. That is the point of the knob: D5 said
     * two cards of any colours count as one card of the board's colour, at the
     * island's own substitution rate, and D7 recorded that the arm shipped
     * WITHOUT it - so the 34.4% of turns the colour-match arm read is that rule
     * at its HARSHEST, and the rule Dean would actually write reads somewhere
     * between 34.4% and the shipped 58.9%.
     *
     * `true` builds it: two cards of ANY colours pay for one board of any
     * colour, and BOTH cards land on that board's pile, so the pile grows by
     * two and the payer is down two cards. ⚠️ READ THE PAIR'S SHARE OF ALL
     * PLAYS as the pressure gauge, not the bonus rate alone: under about a
     * fifth and the colour keying is doing its work, over about half and the
     * matching rule is a tax everybody is paying around.
     * `overlays/commons-coins-v1.overlay.json` turns it on and
     * `overlays/commons-coins-no-wild-v1.overlay.json` is the paired arm that
     * says what the pair is worth.
     */
    readonly commonsWildPair: boolean;
    /**
     * ⭐ DEAN'S QUESTION OF 09/09/2026, HALF ONE: THE BUILDING SEMANTIC OF A
     * CENTRAL PILE. Read only under `visitCurrency: 'commons'`.
     *
     * *"I'm interested to see if we place a threshold on the centre cards if it
     * will reduce the number of cards going from the centre to the barns - my
     * target is about 30-40% of barn cards should come from the middle."*
     *
     * `null` IS THE SHIPPED RULE (C5): any central pile holding at least one
     * card may be harvested, by anybody, whole. A number `n` makes a pile
     * harvestable ONLY at `n` cards or more - a pile is "full" at `n`, exactly
     * as a building is full at its threshold, and nothing may take it before
     * then.
     *
     * ⚠️ IT IS NOT `commonsThreshold`, AND THE PAIR IS EASY TO CONFUSE.
     * `commonsThreshold` caps the INFLOW (a pile at its cap refuses a play);
     * this gates the OUTFLOW (a pile below `n` refuses a harvest). The inflow
     * cap measured NO change in the centre's share of barn cards at 2 - 63.1%
     * against 63.0% - because a central harvest already takes a median of two
     * cards and because every card played into the centre reaches a barn
     * eventually anyway.
     *
     * ⛔ D6 STOPS HOLDING UNDER THIS KNOB, and it is the one behaviour change
     * worth naming before a run. D6 is "the wheat board can never be dead": the
     * fee lands on the pile before the action runs, so the fee is itself
     * harvestable and the floor of the bonus slot is "one card from hand into
     * your barn". Under `commonsHarvestMin` that only holds if the pile the fee
     * lands on REACHES `n`, so at `n = 3` a play onto an empty wheat board buys
     * a Harvest of nothing and the wheat board is simply not offered unless some
     * pile is already deep enough or the seat has a full building.
     *
     * ⭐ HAS NO SUBJECT UNDER `commonsTake: 'bonus'` (Dean, 09/09/2026): Harvest
     * never reaches the centre under that knob, so there is no central harvest
     * left for this to ration.
     */
    readonly commonsHarvestMin: number | null;
    /**
     * ⭐ DEAN'S QUESTION OF 09/09/2026, HALF TWO, AND THE ONLY ONE OF THE THREE
     * THAT CAN REDUCE THE CENTRE'S OUTFLOW WITHOUT REDUCING PLAYS. Read only
     * under `visitCurrency: 'commons'`.
     *
     * `null` IS THE SHIPPED RULE (C5): a central harvest takes the WHOLE pile.
     * A number `n` takes at most the most recently played `n` cards - the top of
     * the pile - and leaves the rest standing in the centre. A pile holding
     * fewer than `n` gives up all of it, so the rule is "at most `n`" and never
     * a minimum.
     *
     * ⭐ WHY IT IS THE ONE THAT CAN WORK. The centre is a closed system: cards
     * only enter by a play (C3) and only leave by a harvest (D3), so
     * plays = harvested out + stranded at game end. A cap on plays
     * (`commonsThreshold`) or a gate on when a pile may be taken
     * (`commonsHarvestMin`) changes WHEN cards leave, not how many; leaving
     * cards behind is the only rule that changes the ratio itself, because the
     * remainder stays in the centre where it can still be taken later or stranded
     * at the end. Read it against a18's conservation line.
     *
     * ⭐ HAS NO SUBJECT UNDER `commonsTake: 'bonus'` (Dean, 09/09/2026): Harvest
     * never reaches the centre under that knob, so there is no central harvest
     * left for this to cap - `commonsTake` moves a whole pile at once, always.
     */
    readonly commonsHarvestTake: number | null;
    /**
     * ⭐ THE FIRST OF THE ARM'S TWO COIN SINKS (Dean, 10/09/2026, K15). Read
     * only under `commonsTake: 'coins'`, which is the only thing that mints a
     * coin.
     *
     * `null` IS THE SHIPPED RULE: the fifteen Endgame cards cost two cards of
     * their own suit, exactly as v31 priced them and exactly as the fifteen
     * Power cards still do. A number `n` prices an Endgame card at `n` COINS
     * and NO CARDS at all; the arm sets 3.
     *
     * ⛔ THE PRICE IS A RULES KNOB AND NEVER A CARD FIELD. `Card.buildCost`
     * has exactly `suit` and `wild` and must keep having exactly those two:
     * the coin third of that interface went with the currency on 02/09/2026,
     * and putting it back would mean a coin price could arrive from a
     * re-extract rather than from a ruling. `data.test.ts` asserts the shape.
     *
     * WHAT IT BUYS THE DESIGN: the second monoculture pull leaves with it. Under
     * v31 both the Farmstead's own-crop scorer and the Power/Endgame two-own-suit
     * cost pushed the same way, and the own-crop build share read 82.6% before
     * and 83.3% after. K13 moves the scorer to the Barn rather than deleting it,
     * so this cost is the ONLY pull that goes, and the prediction is a small
     * move off 83% rather than a large one.
     * `overlays/commons-coins-endgame-cards-v1.overlay.json` is the paired arm
     * that turns it back off, and
     * `overlays/commons-coins-endgame-price.sweep.json` prices it at 2, 3 and 4.
     */
    readonly endgameCoinCost: number | null;
    /**
     * ⭐ THE SECOND OF THE ARM'S TWO COIN SINKS, AND THE BIGGER RULES CHANGE
     * (Dean, 10/09/2026, K10-K14). Read only under `commonsTake: 'coins'`.
     *
     * `false` IS THE SHIPPED RULE: the Farmstead is an ordinary starter that
     * prints *"Game end: 1 VP for each `<CROP>` card you have built"* and does
     * nothing during play.
     *
     * `true` makes it a BUILDING WITH NO THRESHOLD whose activation cost is ONE
     * COIN. Using it is a GROW and it is your MAIN ACTION, once per turn, and
     * nothing is placed on it: *"spend a coin instead of a card"*. Each suit's
     * Farmstead has a unique power worth about two plain actions, because it
     * costs the action AND the coin - the four numbers behind them are
     * `farmsteadPower` below, and Wheat's power carries no number. ⛔ NO RENT
     * (K14): a rival can never use your Farmstead, because a reference card for
     * five rival powers is more than the five-minute teach can carry.
     *
     * ⚠️ TWO CONSEQUENCES TO NAME BEFORE ANY RUN. The Farmstead's own end-game
     * scorer MOVES TO THE BARN (K13) rather than being deleted, so the
     * monoculture pull does not leave with it and `gameEnd` must score exactly
     * what it scored before, off a different card. And all five powers are
     * SOLITAIRE, so the Farmstead adds nothing at all to the interaction budget
     * and the whole of this design's cross-table pressure sits in the middle of
     * the table.
     */
    readonly farmsteadCoinPower: boolean;
    /**
     * ⭐ THE FOUR NUMBERS BEHIND THE FIVE FARMSTEAD POWERS (Dean, 10/09/2026,
     * K12). Read only under `farmsteadCoinPower: true`, and flat rather than
     * per-suit-keyed because each number belongs to exactly one suit and a
     * `{suit}` wildcard would expand four knobs into twenty, nineteen of which
     * mean nothing.
     *
     * There are four and not five because WHEAT'S POWER HAS NO NUMBER: *"Harvest
     * every one of your buildings, however many cards are on them"* is a
     * quantity the board supplies, not a dial. If a fifth ever appears, it goes
     * here beside these.
     *
     * ⚠️ THREE OF THE FIVE POWERS COLLIDE WITH CARDS ALREADY ON THE SHEET
     * (§2.6 of the handoff), which is what makes these sweepable rather than
     * pinned: the Wheat power is W13 The Bakery word for word, the Vegetable
     * power is V15 The International Port, and the Dairy power strictly
     * dominates D4 The Milking Shed. Those are card-face questions rather than
     * knob questions, but a mispriced power shows up in the fires-by-suit
     * reading first, and these are the numbers to move when it does.
     */
    readonly farmsteadPower: {
      /** Cards the Orchard Farmstead draws. 3 (Dean, 10/09/2026). */
      readonly orchardDraw: number;
      /**
       * Cards the Dairy Farmstead takes off a build cost, with every crop
       * requirement treated as wild on top. 1 (Dean, 10/09/2026).
       */
      readonly dairyDiscount: number;
      /**
       * Buildings the Apiary Farmstead GROWS, paying each activation cost as
       * normal. 2 (Dean, 10/09/2026). ⚠️ Paying as normal is the whole of the
       * difference from A12 The Honey Hut and A5 The Meadow Hive, which grow
       * WITHOUT placing a card; the printed text has to keep saying so.
       */
      readonly apiaryGrows: number;
      /** Deliveries the Vegetable Farmstead makes. 2 (Dean, 10/09/2026). */
      readonly vegetableDeliveries: number;
    };
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
