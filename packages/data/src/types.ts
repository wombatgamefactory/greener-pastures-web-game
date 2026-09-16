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
 * ⭐ WHEN A HELD MEEPLE MAY BE SPENT. See `rules.turn.meepleSpendTiming`.
 *
 * `'start'` IS THE SHIPPED VALUE AND IT IS THE GAME AS IT IS PLAYED TODAY: the
 * v31 turn spends meeples one at a time BEFORE the bonus and the main action
 * (`turnflow.ts`'s own header, and `meepleOptions` in `actions.ts`).
 * `'afterAction'` is M4 of the delivery meeple (Dean, 12/09/2026): the spend
 * window moves to AFTER the main action. `'none'` deletes the phase outright and
 * is reachable but is NOT the shipped value.
 *
 * ⛔ THE ORDER OF THE THREE IS NOT A LADDER AND `'none'` IS NOT THE BASE. See
 * `rules.turn.meepleSpendTiming` for why shipping `'none'` would have silently
 * broken a named control and a fixture.
 */
export type MeepleSpendTiming = 'none' | 'start' | 'afterAction';

/**
 * ⭐ WHAT A VISIT IS PAID IN, AND WHOSE BOARD IT LANDS ON. See
 * `rules.turn.visitCurrency`.
 *
 * ⭐ `'noticeBoardPower'` IS THE SHIPPED GAME SINCE 13/09/2026, when the
 * commons was deleted (Dean). It is the notice-board visit of 10/09/2026
 * (`docs/notice-board-visit-handoff-2026-09-10-v2.md`, S1-S16): the five Notice
 * Board cards live on their owners' farms and are BUILDINGS, and the bonus is to
 * play one card from your hand onto a Notice Board and immediately take that
 * board's PRINTED POWER. The card stays on the host's board and the host
 * harvests it into their barn later. The board's threshold is `3+` - a MINIMUM
 * before the owner may harvest, never a maximum (`economy.noticeBoardThreshold`
 * 3 with `economy.noticeBoardBlocks` false). Each of the five boards prints a
 * DIFFERENT power (`economy.noticeBoardPower`). The bonus comes FIRST.
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
 * `bonusDraw` survives only as the number Collect draws.
 *
 * ⛔ `'noticeBoardPower'` IS NOT A REPOINTING OF `'card'`, DELIBERATELY.
 * `'card'` is the v31 control and carries three passengers this design does not
 * want: a BLOCKING Notice Board threshold of 2, the standalone free Draw 1 in
 * the bonus slot, and the turn-start meeple spend.
 */
export type VisitCurrency = 'card' | 'meeple' | 'noticeBoardPower';

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

/**
 * What every tile in play costs, identically. Since the token island
 * (16/09/2026) `crates` is the number of TOKENS dealt onto a tile and
 * `cardsPerCrate` the cards one token's demand asks for, so a delivery is always
 * their product: 2 x 2 = 4 barn cards. The names are kept from the crate island
 * because the arithmetic did not change.
 */
export interface IslandTileRule {
  readonly crates: number;
  readonly cardsPerCrate: number;
  /**
   * ⚰️ TOMBSTONE, PINNED AT 0. v31 deleted coins, so this can never be anything
   * but 0. Nothing reads it and it deliberately has no knob.
   */
  readonly coinsPerDelivery: number;
}

/**
 * ⭐ THE TOKEN SET (Dean, ruling R3, 16/09/2026; worksheet `island-tokens`).
 *
 * For each crop in play one token at each of `vpValues`, plus
 * `wildBySeats[seats]` WILD tokens (a wild demand takes any 2 cards). A token
 * whose VP is in `workerOnVp` also carries a WORKER drawn from the meeple bag.
 *
 * ⚠️ BUILDER DEFAULT: when `wildBySeats` is below `vpValues.length` (3 seats),
 * which wild values are used is drawn at random with the game's seeded RNG.
 */
export interface IslandTokenRule {
  /** One token per crop per value. Printed 6 / 5 / 4 / 3. */
  readonly vpValues: readonly number[];
  /** The VP values whose tokens carry a Worker. Printed 3 and 4; `[]` seeds none. */
  readonly workerOnVp: readonly number[];
  /** Wild tokens in the pool, by seat count: 0 / 2 / 4. */
  readonly wildBySeats: Readonly<Record<string, number>>;
}

/**
 * The bag of WORKERS (delivery meeples) the island's tokens are seeded from.
 *
 * A Worker sits face up on a 3 or 4 VP token (`IslandTokenRule.workerOnVp`) and
 * is claimed with that token. Its owner discards it after a later main action
 * for the plain action of its colour, and it then leaves the game. The
 * colour-to-action map is NOT here: it is `workers.roster` plus the engine's
 * `meepleActionOf`.
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
  /** Recorded (Workers are face up) and read by nothing. */
  readonly faceUpAtSetup: boolean;
}

export interface IslandTile {
  readonly id: string;
  readonly level: IslandLevel;
  readonly note: string | null;
}

export interface IslandFile {
  readonly meta: DataMeta;
  readonly seats: { readonly min: number; readonly max: number };
  readonly decksInPlayBySeats: Readonly<Record<string, number>>;
  /** What every tile costs: 2 tokens x 2 cards. */
  readonly tileRule: IslandTileRule;
  /** The token set and its seat scaling (16/09/2026). */
  readonly tokens: IslandTokenRule;
  /** The Worker bag: 5 of each of the 5 colours. */
  readonly meeples: MeeplePool;
  readonly slotsBySeats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly levelThreeTilesBySeats: Readonly<Record<string, readonly string[]>>;
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

export interface RulesFile {
  readonly meta: DataMeta;
  readonly setup: {
    readonly startingHand: number;
    /** 0 since v31: the barn starts empty. */
    readonly startingBarnCards: number;
    /**
     * ⭐ WHO TAKES THE FIRST TURN (Dean, 15/09/2026: "first player random").
     *
     * `'random'` is the shipped rule: `newGame` draws the seat from the game's
     * seeded RNG AFTER every setup shuffle, so a seed still names one game, and
     * records it as `GameState.firstPlayer`. `'seat0'` is every game before the
     * ruling: seat 0 opens, no RNG call is made and `firstPlayer` is absent, so
     * an overlay that pins it replays its old game move for move.
     */
    readonly firstPlayer: 'random' | 'seat0';
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
     * ⭐ ALIVE AGAIN AND RULED ON (Dean, 10/09/2026, S6), WHICH REVERSES THE
     * BAN OF 04/09/2026. Under `visitCurrency: 'noticeBoardPower'` every player
     * owns a Notice Board again and you MAY play your bonus card onto your own.
     *
     * WHY IT IS SAFE NOW AND WAS NOT IN v31, which is the whole of the
     * difference: in v31 every Notice Board printed the SAME thing, so a
     * self-visit was strictly better than a visit - same benefit, no gift, no
     * travel - and it took 22.2% of turns and was banned within two days. Here
     * the five boards print five DIFFERENT powers, so your own board is one
     * option of five and it is the one that never has what you have not got. It
     * also answers the predecessor's largest dislike cluster, *"reverse engine
     * building"*: a power you can use yourself cannot draw that charge.
     *
     * ⛔ AND IT IS THE HEADLINE RISK OF THE PASS. Paying a card to your own
     * board is cheaper than paying it to a rival's, because you harvest it
     * back, so if the self-visit share runs much above v31's 22.2% the variety
     * argument is wrong and the interaction is decoration.
     * `overlays/notice-board-visit-no-self-v1.overlay.json` is the control and
     * the single most important sub-arm in the plan.
     *
     * ⚠️ THE HANDOFF CALLS THIS `rules.turn.selfVisit` AND THE DATA HAS ALWAYS
     * CALLED IT `selfVisitAllowed`. The existing path stands; nothing is
     * renamed and no overlay has to be re-pinned.
     *
     * ⛔ DEAD FROM 04/09/2026 TO 10/09/2026, AND DEAD TWICE OVER FOR MOST OF
     * IT. The meeple loop made a self-visit impossible by construction (X5);
     * under the commons NOBODY OWNS A BOARD, so there was no such thing as
     * visiting yourself and nothing for the flag to permit. Under both of those
     * it stays `true` in the data and is read only by the v31 control.
     *
     * ⭐ `false` IS THE SHIPPED DEFAULT SINCE 13/09/2026, ruled when the commons
     * was deleted. The controls that relied on the old `true` pin it.
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
     * ⭐ WHICH OF THREE GAMES THIS IS. `'noticeBoardPower'` is the shipped
     * game since 13/09/2026, when the commons was deleted; `'card'` (v31) and
     * `'meeple'` (the loop and the economy) are the controls. See
     * `VisitCurrency` above for the whole of it.
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
     * ⭐ S17, THE HOST DRAW (Dean, ruled 11/09/2026), AND ITS PROVENANCE IS A
     * TABLE RATHER THAN A SIMULATION. **When a neighbour visits you, you draw
     * this many cards**, immediately, off a deck. Shipped at 0, which changes
     * nothing, and read ONLY under `visitCurrency: 'noticeBoardPower'`.
     * `overlays/notice-board-visit-host-draw-v1.overlay.json` sets 1 and is the
     * arm; `overlays/notice-board-visit-two-boards-v1.overlay.json` is its
     * control and its paired arm.
     *
     * ⭐ DEAN PLAYED THE TWO-BOARD ARM AT A TWO-PLAYER TABLE ON 11/09/2026 AND
     * HOUSE-RULED THIS IN DURING THE SESSION. His verdict: the visiting worked
     * well, everyone visited, every Notice Board was used at some stage, and
     * *"the rule that the person who gets visited draws a card led to a lot of
     * extra cards in play, which relieved the tightness of the game in a useful
     * way"*. He has now ruled it in.
     *
     * ⛔ IT AMENDS S7, WHICH SAID THE OPPOSITE IN AS MANY WORDS. S7 reads that
     * the card stays on the board it was played to and its owner harvests it
     * into their barn, *"and that is the payment and there is no other"*. Under
     * S17 there is now one other and it is paid INSTANTLY, so the host is paid
     * twice: once in a card drawn now, once in material harvested later. Do not
     * quote S7 forward without this amendment.
     *
     * ⭐ WHY IT IS DEFENSIBLE, AND BOTH HALVES ARE ON THE RECORD.
     *
     *   1. **It is the sanctioned shape rather than a banned one.** This project
     *      banned RESTOCK as *"a per-interaction bank faucet"*, and the standing
     *      rule beside that ban reads *"if a give-cards effect returns, it pays
     *      in draws"*. A host draw comes off a DECK and never off a bank.
     *   2. **The design lens predicts it.** The fault named in all seven previous
     *      versions of this bonus slot is *pay the giver in the same act, or the
     *      giver draws the charge*. S7 pays the host in DEFERRED material they
     *      must harvest and then deliver; S17 pays them in the same act, which is
     *      a closer fit to the lens than the rule it amends.
     *
     * ⚠️ AND THE COST IS REAL: EVERY VISIT NOW ADDS A CARD TO THE GAME. At two
     * seats under the control arm there are about 14.4 visits received per
     * player per game, so this is a substantial new faucet and it is the first
     * thing a run has to price.
     *
     * ⛔ A SELF-VISIT MUST NEVER PAY IT. `turn.selfVisitAllowed` is false on the
     * arm that matters, so it has no subject there, but the knob is defined for
     * the case and the rule is explicit: a card drawn for visiting yourself is a
     * PURE FAUCET, paid by nobody, and it would be the solitaire option eating
     * the bonus slot for the fourth time in this project.
     *
     * ⛔ AND THE SIMULATOR CANNOT MEASURE THE EFFECT DEAN ACTUALLY LIKED. The
     * engine caps hands at 7 as an INSTRUMENT BOUND (C7) while the table plays
     * with NO HAND LIMIT AT ALL, and this rule's principal effect is more cards
     * in hand, so the instrument clips exactly the thing the table enjoyed. A run
     * of the arm can honestly answer whether the bonus rate leaves Dean's 30% to
     * 60% band, and what happens to the barn glut, game length, deliveries and
     * the hook. IT CANNOT ANSWER WHETHER THE GAME FEELS LESS TIGHT, and no report
     * of this arm may be quoted as evidence that it does.
     *
     * ⚠️ AN INTEGER RATHER THAN A BOOLEAN, so the size can be swept later
     * without another knob, which is this project's established preference.
     *
     * ⚠️ TWO ENGINE RULINGS ARE OWED AND NEITHER IS A LEAF: WHICH DECK the host
     * draws from (their own suit's, or the top of any deck in play as a plain
     * Draw allows), and what happens when A Helping Hand sends a SECOND visit to
     * the same owner in one turn, which at two seats under the two-board arm is
     * reachable because the one rival holds two boards.
     */
    readonly hostDrawOnVisit: number;
    /**
     * ⭐ THE HOST-DRAW CAP: A HOST IS PAID AT MOST ONCE BETWEEN THEIR OWN TURNS,
     * however many neighbours visit them in the meantime. Shipped `false`, which
     * changes nothing, and read only when `hostDrawOnVisit` is above 0.
     *
     * ⛔ **IT IS A SECOND LEAF AND NOT A CHANGE OF `hostDrawOnVisit`'s MEANING,
     * AND THAT IS DELIBERATE.** Re-pointing the existing knob at a per-round
     * quantity would silently redefine every number already published against
     * it - the 17:23 report, `a21-host-draw`, the overlay's own description -
     * and this project has twice paid for a quantity that changed underneath a
     * published reading (a17 judged on plays per turn, 09/09/2026; the meeple
     * cap that shipped as a passenger, 05/09/2026). `hostDrawOnVisit` keeps
     * meaning CARDS PER PAYMENT. This says HOW OFTEN A PAYMENT MAY HAPPEN.
     *
     * ⚠️ **"PER ROUND" MEANS PER THE HOST'S OWN TURN CYCLE, NOT PER THE
     * VISITOR'S TURN, AND THE DISTINCTION IS THE WHOLE POINT OF THE KNOB.** A
     * cap on the visitor's turn would only ever bite when ONE visitor sends TWO
     * visits to the same host in a single turn, which is reachable at two seats
     * alone (A Helping Hand, against a rival holding two boards), and would
     * leave four seats - the only seat count that breaches - untouched. The
     * latch is therefore cleared when the HOST's own turn begins.
     *
     * ⛔ **WHY IT EXISTS: THE FOUR-SEAT BREACH.** With `hostDrawOnVisit` 1 the
     * bonus slot reads 64.9% of turns at four seats against Dean's 60% ceiling,
     * where its one-leaf control reads 59.9%
     * (`reports/watchlist-2026-09-11T17-23-27-...` against `...T17-20-12-...`).
     * The faucet scales with the number of rivals, and a cap per host per round
     * is the shape that stops it scaling.
     *
     * ⚠️ **AND IT IS EXPECTED TO BE INSUFFICIENT ON ITS OWN, WHICH IS WRITTEN
     * DOWN HERE BEFORE THE RUN SO THE PREDICTION CAN BE SCORED.** Measured host
     * draws per host per round are 0.489 / 0.553 / 0.787 by seat count, so a cap
     * of one can remove only the rounds that carried two or more: at most
     * 21% / 24% / 31% of the faucet on a Poisson upper bound, and less than that
     * in truth because bots spread visits across targets rather than piling on.
     * The faucet buys 5.0 points at four seats, so a 31% cut returns about 1.5
     * and lands near 63.4%, still over the ceiling. **If the run reads much
     * better than that, the arrival distribution is more clustered than Poisson
     * and THAT is the finding.**
     */
    readonly hostDrawCapPerRound: boolean;
    /**
     * ⭐ THE HOST DRAW BY SEAT COUNT: an OVERRIDE on `hostDrawOnVisit`, keyed by
     * seat count, in the idiom of `island.decksInPlayBySeats`,
     * `island.tokens.wildBySeats` and `rules.economy.noticeBoardsBySeats`.
     *
     * ⛔ **`null` IN A SLOT MEANS "DEFER TO THE SCALAR", AND EVERY SLOT SHIPS
     * `null`, SO THIS CHANGES NOTHING UNTIL A SLOT IS SET.** That is what keeps
     * every number already published against `hostDrawOnVisit` valid, and what
     * keeps `overlays/notice-board-visit-host-draw-v1.overlay.json` reading
     * exactly as it did: it sets the scalar to 1 and no slot here, so all three
     * seat counts still pay 1.
     *
     * ⛔ **WHY IT EXISTS: THE FOUR-SEAT BREACH, AND EVERY OTHER LEVER IS NOW
     * MEASURED AND DEAD.** S17 takes the bonus slot out of Dean's band at four
     * seats alone (64.9% of turns against a 60% ceiling) where its control reads
     * 59.9%. **Capping the faucet was built and run on 11/09/2026 and it did not
     * work**: a cap of one payment per host per round removed 28.7% of the
     * payments at four seats and returned only 0.5 points of rate, landing at
     * 64.4% and still out of band
     * (`reports/watchlist-2026-09-11T21-26-55-...-host-draw-capped-v1.txt`).
     *
     * ⭐ **THE FINDING THAT FORCED THIS SHAPE: THE RATE IS NEARLY INSENSITIVE TO
     * THE SIZE OF THE FAUCET.** Cutting 30% of it bought back a tenth of the
     * rise. Extrapolated, removing the faucet entirely recovers about 1.7 of the
     * 5.0 points, so **no version of "make the host draw smaller" reaches 60% at
     * four seats.** Pricing this faucet is a dead lever, measured rather than
     * argued. What is left is turning it OFF where there is no headroom, which
     * is what this map does.
     *
     * ⚠️ **AND THE COST IS A SEAT-COUNT-DEPENDENT RULE AT THE TABLE**, which is
     * a real teach cost against a five-minute target. It is not unprecedented in
     * this design - `noticeBoardsBySeats` already shapes the board count 2/1/1 -
     * but two seat-count-dependent rules in one bonus slot is a thing to look at
     * whole before ruling it in, not a thing to notice afterwards.
     */
    readonly hostDrawOnVisitBySeats: Readonly<Record<string, number | null>>;
    /**
     * ⭐ WHEN A HELD MEEPLE MAY BE SPENT (M4, Dean 12/09/2026, A151). The arm is
     * `'afterAction'`: after your main action you may discard one meeple to take
     * the PLAIN action of its colour, and the meeple then leaves the game.
     *
     * ⛔ **IT SHIPS `'start'`, NOT `'none'`, AND THAT DIFFERS FROM SECTION 3 OF
     * `docs/village-store-coins-handoff-2026-09-12-v1.md` DELIBERATELY.** The
     * handoff's `'none'` would DELETE A PHASE THAT IS LIVE IN A NAMED CONTROL:
     * `overlays/v31-card-visit.overlay.json` sets `startingMeeplesPerColour` 1
     * beside `visitCurrency: 'card'`, under which `meepleOptions`
     * (`packages/engine/src/actions.ts`) returns a real list and the turn-start
     * spend runs, exactly as `turnflow.ts`'s header documents the v31 turn:
     * *"spend any number of MEEPLES, one at a time"*. `packages/sim/fixtures/
     * 2p-v31-opening.json` replays against it. **`'start'` IS the current
     * behaviour and is therefore the inert value**; `'none'` stays reachable as
     * a third value for anybody who wants the phase gone. A shipped value that
     * silently changes a control is the 05/09/2026 passenger lesson in a new
     * costume, and a control that moves is not a control.
     *
     * ⛔ THE PLAIN ACTION AND NEVER THE NOTICE BOARD POWER (M6): the Orchard
     * board is Draw 4 where the plain action is Draw 2, and the two stopped
     * being the same thing on 10/09/2026. The colour mapping is wheat Harvest,
     * vegetable Deliver, orchard Draw 2 keep both, apiary GROW and dairy Build
     * (M7) - ⛔ GROW AND NOT SOW, because Sow is not a core action and orange
     * meaning one thing in one place and another elsewhere has cost this project
     * a day before.
     *
     * ⚠️ AND `'afterAction'` REVERSES THE REASON THE BONUS SITS AT THE FRONT.
     * The bonus was moved to the start of the turn on Dean's own reasoning that
     * a turn visibly ends on the main action (C2, 09/09/2026). Mild, because
     * most turns will have no meeple to spend, but it is a direct tension with a
     * deliberate ruling and it is recorded here rather than discovered later.
     *
     * ⚠️ TWO ENGINE RULINGS ARE OWED AND NEITHER IS A LEAF: whether the spend is
     * legal on a turn whose main action was PASSED rather than taken (D7), and
     * whether the standing rule that an illegal action is not offered applies
     * here, which would make a meeple UNDISCARDABLE (D8, "yes" indicated).
     */
    readonly meepleSpendTiming: MeepleSpendTiming;
    /**
     * ⭐ HOW MANY MEEPLES ONE SEAT MAY SPEND IN ONE TURN (M5, Dean 12/09/2026,
     * A151). The arm is `1`, which is Dean's ruling.
     *
     * ⛔ **`null` MEANS UNLIMITED AND IT IS THE SHIPPED VALUE, WHICH ALSO
     * DIFFERS FROM THE HANDOFF'S TABLE DELIBERATELY.** The handoff ships `0`,
     * and `0` would delete the phase: there is no per-turn cap in the game today
     * (`turnflow.ts` documents the v31 turn as *"spend any number of MEEPLES,
     * one at a time"*), so `null` is the value that changes nothing. It is the
     * established idiom of `commonsThreshold`, `commonsHarvestTake` and
     * `meepleCapPerColour`, where null is "no rule here" rather than "zero of
     * it".
     *
     * ⚠️ THE CAP OF 1 REMOVES THE THING DEAN'S OWN TABLE ENJOYED, WHICH IS WHY
     * C112 EXISTS. It was adopted against a branching-explosion worry, and the
     * worry shrank when it was measured: at about 1.8 meeples a player a game,
     * "as many as you like" almost never means more than two, while the combo
     * burst is what the 11/09/2026 table liked. `meepleSpendDistinctColours` is
     * the alternative rule, and the two are orthogonal on purpose - see it.
     */
    readonly meepleSpendPerTurn: number | null;
    /**
     * ⭐ C112'S ALTERNATIVE TO THE PER-TURN CAP: MAY NO TWO MEEPLES SPENT IN ONE
     * TURN SHARE A COLOUR? Shipped `false`, which is inert, because no such
     * restriction exists today.
     *
     * ⛔ **IT IS A SECOND LEAF RATHER THAN A MAGIC VALUE OF
     * `meepleSpendPerTurn`, AND THAT IS DELIBERATE.** "No two of the same
     * colour" is not expressible as an integer, so the cap alone cannot reach
     * it, and re-pointing the cap at a rule of a different shape would redefine
     * a published quantity underneath its own readings. This project has twice
     * paid for exactly that (a17 judged on plays per turn, 09/09/2026; the
     * meeple cap that shipped as a passenger, 05/09/2026). `meepleSpendPerTurn`
     * keeps meaning HOW MANY; this says WHICH ONES MAY BE COMBINED.
     *
     * ⭐ THE TWO ARMS C112 ASKS FOR, and they are one run apart:
     *
     *   - the rule as Dean ruled it: `meepleSpendPerTurn` 1, this `false`;
     *   - the C112 variant: `meepleSpendPerTurn` null, this `true`.
     *
     * ⚠️ WHY IT HAS TO BE MEASURED RATHER THAN ARGUED: the cap of 1 removes
     * exactly the combo burst Dean's own table enjoyed on 11/09/2026, and a
     * table finding discarded on a manager's say-so is worth less than a run.
     * Read it beside actions per turn, which passes at only 1.61 against a
     * target of 1.5 and to which every meeple spent adds an action.
     */
    readonly meepleSpendDistinctColours: boolean;
  };
  readonly economy: {
    /**
     * ⭐ 3 SINCE 10/09/2026, AND UNDER `visitCurrency: 'noticeBoardPower'` IT
     * IS A MINIMUM RATHER THAN A MAXIMUM (Dean, S8). Three is the fewest cards
     * a Notice Board may hold before its owner is allowed to harvest it; with
     * `noticeBoardBlocks` false the board goes on accepting cards for ever, so
     * `isFull` and `canTakeCard` stop being the same question for the first
     * time in this codebase. The face must print `3+`, because the plus sign is
     * the only thing that says floor rather than ceiling.
     *
     * ⛔ THE BASE MOVE FROM 2 TO 3 CHANGES THE v31 CONTROL UNLESS THE CONTROL
     * PINS IT, so `overlays/v31-card-visit.overlay.json` now sets this to 2 by
     * name. Under `'card'` the board is a BLOCKING building at 2 and that arm
     * has to stay bit-reproducible. ⚠️ The printed face still says 2 until
     * `Isle-of-Farms-v36.xlsm`, so override and print disagree again for the
     * first time since v31 closed the old 5-versus-2 drift; the face is what
     * has to catch up.
     *
     * ⭐ THE ORIGINAL NOTE, AND IT IS STILL WHAT THE NUMBER MEANS UNDER
     * `'card'`: how many cards a Notice Board holds before it clogs and the
     * farm shuts to visitors - and, since v31, to its owner too.
     *
     * An OVERRIDE of the printed face, kept as an override because the value is
     * a ruling and the face is generated from the spreadsheet. Ruled 2 on
     * 20/08/2026; null hands the number back to the card.
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
     * ⭐ THE `3+` RULE, AND THE FIRST TIME "harvestable" AND "accepts a card"
     * HAVE BEEN SEPARATE QUESTIONS IN THIS CODEBASE (Dean, 10/09/2026, S8).
     * Read only under `visitCurrency: 'noticeBoardPower'`.
     *
     * `false` IS THE SHIPPED VALUE AND THE RULE: `noticeBoardThreshold` is a
     * MINIMUM. The owner may harvest at or above it, cards may always be added,
     * nothing ever blocks and nobody can shut a board by declining to harvest.
     *
     * `true` IS THE PAIRED CONTROL: the Notice Board becomes an ordinary
     * clogging building, full at its threshold and refusing every card until
     * its owner harvests. It exists so that "does a board stall?" is MEASURED
     * rather than argued, and the question is not hypothetical - the stall is a
     * documented failure in the predecessor, where the game stops when nobody
     * wants to load. Read it hardest at two players, where there are only two
     * boards on the table.
     * `overlays/notice-board-visit-blocking-v1.overlay.json` is the arm.
     */
    readonly noticeBoardBlocks: boolean;
    /**
     * ⭐ DEAN'S TWO-BOARD FIX (ruled 11/09/2026): HOW MANY NOTICE BOARDS EACH
     * PLAYER LAYS OUT, keyed by seat count. Read ONLY under
     * `visitCurrency: 'noticeBoardPower'` with `turn.selfVisitAllowed` false.
     *
     * ⭐ `{ "2": 2, "3": 1, "4": 1 }` IS THE SHIPPED VALUE SINCE 13/09/2026, ruled
     * when the commons was deleted; the controls pin the old `"2": 1`.
     * `{ "2": 1, "3": 1, "4": 1 }` is one board each, the game as built on
     * 10/09/2026. `{ "2": 2, "3": 1, "4": 1 }` is the
     * arm, and at two seats each player lays out TWO boards - their own suit's,
     * plus one more drawn AT RANDOM from the suits nobody is farming. The fifth
     * board is not used. At three and four seats the arm IS
     * `overlays/notice-board-visit-no-self-v1.overlay.json`, so the two differ
     * at two seats only.
     *
     * ⭐ A MAP RATHER THAN A BOOLEAN, DELIBERATELY, in the idiom of
     * `island.decksInPlayBySeats` and `island.tokens.wildBySeats`: a later pass
     * can ask "what if three seats also got two?" without another knob.
     *
     * ⭐ WHY IT EXISTS, MEASURED RATHER THAN ARGUED. Four corners of a 2x2 ran
     * at 4,820 games each on 11/09/2026:
     *
     * | | self-visits ON | self-visits OFF |
     * | --- | --- | --- |
     * | no centre | rate 71.2%, hook 0.44 FAIL | rate 46.1%, hook 0.54 PASS |
     * | centre ON | rate 78.4%, hook 0.23 FAIL | rate 64.7%, hook 0.31 FAIL |
     *
     * The no-self, no-centre corner is the ONLY version in which the design's
     * own thesis works, and it STARVES AT TWO PLAYERS: the bonus is used on
     * 28.8% of turns against Dean's 30% floor, and 17.9% of two-player turns
     * begin with cards in hand and no legal visit, because with self-visiting
     * banned and one board each there is exactly ONE board a seat may visit.
     * Adding ownerless central boards (`unclaimedBoardsToCentre`) fixed the rate
     * and destroyed the cross-table traffic: at two players only 14.7% of plays
     * reached a person. ⛔ THE STRUCTURAL LESSON IT MEASURED IS THE REASON FOR
     * THIS KNOB: THERE ARE ONLY EVER FOUR TARGETS, AND EVERY TARGET ADDED THAT
     * IS NOT A PERSON DILUTES THE PERSON.
     *
     * ⭐ EVERY TARGET THIS ADDS IS A PERSON, which is the whole point and the
     * thing the central-boards variant got wrong. Targets by seat count:
     *
     * | seats | boards each | targets | all of them people |
     * | --- | --- | --- | --- |
     * | 2 | 2 | 2 | one rival holding two boards |
     * | 3 | 1 | 2 | two rivals holding one each |
     * | 4 | 1 | 3 | three rivals holding one each |
     *
     * A seat may still never visit its own board, either of them.
     *
     * ⭐ AND THE RANDOM BOARD PAYS ITS OWNER. Its power is usable only by
     * rivals, but every fee paid onto it rests there until its OWNER harvests it
     * into their barn, so a popular board is income. That is this design's core
     * loop arriving on a board whose power its owner can never use.
     *
     * ⚠️ AN ARITHMETIC CEILING NOBODY HAS PRICED: the suits nobody is farming
     * number `5 - seats`, so `n` boards each is only realisable where
     * `seats * (n - 1) <= 5 - seats`. That is 2 at two seats (2 drawn from 3,
     * one left over) and 1 at three and four seats. `{ "3": 2 }` asks for six
     * boards out of five; what an engine does with an infeasible value is an
     * ENGINE ruling and it has not been made.
     *
     * ⚠️ AND A REAL CONSEQUENCE NOBODY HAS PRICED: at two seats a player owns
     * TWO boards, so they have two income streams to harvest and twice the
     * harvesting to do, and A21 The Wax Hall (1 VP for each of your buildings
     * holding a card) can count TWO Notice Boards rather than one.
     * `noticeBoardThreshold` applies to each board separately, so a seat's fee
     * traffic is split across two boards and each fills at half the rate.
     * `overlays/notice-board-visit-two-boards-v1.overlay.json` is the arm.
     */
    readonly noticeBoardsBySeats: Readonly<Record<string, number>>;
    /**
     * ⭐ THE BARN AND THE FARMSTEAD SWAP ROLES (Dean, 13/09/2026, from the v39
     * sheet). true puts the own-crop end-game scorer - "Game end: 1 VP for each
     * <CROP> card you have built" - on the BARN, and the FARMSTEAD becomes the
     * tray that holds the island receipt tokens ("Store Receipts here. Collect 6
     * to trigger end of the game"). false is the scorer on the Farmstead, the
     * rule from 02/09/2026 until this ruling.
     *
     * It is score-neutral: the Barn scores exactly what the Farmstead scored,
     * so only the card that PRINTS the line moves. Every pre-ruling overlay
     * pins it false by name.
     *
     * ⚠️ The notice-board visit arm already moved the scorer to the Barn by
     * itself (S1, `isNoticeBoardPower`), and still does whatever this reads.
     */
    readonly cropScorerOnBarn: boolean;
    /**
     * ⭐ THE NUMBERS BEHIND THE FIVE NOTICE BOARD POWERS (Dean, 10/09/2026,
     * S12 as amended by rulings C88 and C89 the same evening). Read under
     * `visitCurrency: 'noticeBoardPower'`, and flat rather than per-suit-keyed
     * because each number belongs to exactly one suit and a `{suit}` wildcard
     * would expand five knobs into twenty-five, twenty of which mean nothing.
     *
     * ⛔ RENAMED FROM `farmsteadPower` RATHER THAN COPIED, on the handoff's own
     * reasoning: A KNOB WHOSE NAME NO LONGER DESCRIBES IT IS WORSE THAN A NEW
     * ONE. The block was written that morning for the coins arm's Farmstead
     * powers (deleted since); the Farmstead is now a token tray with no rules
     * text at all and the powers have moved to the Notice Boards, so the block
     * moved with them.
     *
     * ⭐ THE FIVE POWERS, EACH ITS OWN SUIT'S VERB AMPLIFIED, so a board is
     * guessable from its colour before it is read, and each worth roughly two
     * plain actions:
     *
     *   - **Orchard** *Draw 4.* (`orchardDraw`)
     *   - **Dairy** *Build. You may spend cards of any crops.* (`dairyWild`)
     *   - **Wheat** *Harvest one of your buildings, then put 1 card from your
     *     hand into your barn.* (`wheatBarn`)
     *   - **Apiary** *Sow 2 cards from your hand onto your buildings.*
     *     (`apiarySows`)
     *   - **Vegetable** *Deliver. If you cannot, put 2 cards from your hand
     *     into your barn.* (`vegetableFallback`)
     *
     * ⚠️ S13's PRECEDENT BINDS EVERY ONE OF THEM: a power that duplicates a
     * card word for word takes that card's identity away. The morning's Dairy
     * and Vegetable powers were killed for being D4 The Milking Shed and V15
     * The International Port, and ruling C88 killed S12's own Wheat power for
     * being W11 The Bakehouse. If a number here is ever raised, check the
     * sheet before the balance.
     */
    readonly noticeBoardPower: {
      /**
       * Cards the Orchard board draws: *"Draw 4."* 4 (Dean, 10/09/2026,
       * S12), up from the morning's 3. The decks are always there, so this is
       * the one power that can never be dead.
       */
      readonly orchardDraw: number;
      /**
       * Cards the Apiary board SOWS from your hand onto your buildings. 2
       * (Dean, 10/09/2026, S12). ⭐ A SOW AND NOT A GROW, which is why the key
       * is not `apiaryGrows` any more: nothing is activated and no ability
       * fires, so the power cannot become a better A12 The Honey Hut.
       * ⛔ RULING C89: ONTO YOUR OWN BUILDINGS ONLY. S12 said "onto any
       * buildings", which read literally reaches across the table; Dean ruled
       * it self-contained, so every power is solitaire and THE VISIT ITSELF
       * REMAINS THE ONLY CROSS-TABLE ACT IN THE DESIGN.
       */
      readonly apiarySows: number;
      /**
       * ⭐⭐ WHICH APIARY POWER THE BOARD PRINTS. RULED BY DEAN, 14/09/2026: THE
       * BASE IS 'deckGrowWild'. The Apiary board reads *"Grow a building using
       * the top card of any deck"*: GROW one of your own non-full buildings,
       * paying its activation card off the top of a deck in play instead of from
       * your hand, so the ability fires, the stack advances and the clog brake
       * survives. The deck card is WILD - Dean: "it's a way of bypassing the suit
       * requirements". 'deckGrow' is the rejected literal reading (the deck's
       * crop must match the activation cost). 'sow' is the S12 power of
       * 10-13/09/2026, *"Sow 2 cards from your hand onto your buildings"*, which
       * reads `apiarySows` and is PINNED by name in every overlay and test
       * helper that predates the ruling.
       */
      readonly apiaryPower: 'sow' | 'deckGrow' | 'deckGrowWild';
      /**
       * Cards the Vegetable board puts into your barn when you CANNOT deliver:
       * *"Deliver. If you cannot, put 2 cards from your hand into your barn."*
       * 2 (Dean, 10/09/2026, S12). ⚠️ NOT A COUNT OF DELIVERIES, which is why
       * the key is not `vegetableDeliveries` any more: delivering twice was
       * V15 The International Port word for word and was killed by S13. The
       * fallback is what makes the board never dead, and it sets up the next
       * delivery rather than making this one.
       */
      readonly vegetableFallback: number;
      /**
       * ⭐ THE VEGETABLE BOARD'S RELAXATION (Dean, ruling R9, 16/09/2026):
       * *"Deliver - 2 of the cards may be any crop. If you cannot, put 2 cards
       * from your hand into your Barn."* In that one delivery up to this many
       * of the 4 cards may be of ANY crop, whatever the tokens name. 0 is the
       * plain Deliver of 10-15/09/2026.
       *
       * ⚠️ BUILDER DEFAULT, NOT RULED (handoff §5 item 2): on a SECOND delivery
       * the relaxed cards may also cover the remaining token's pair, so all 4
       * cards may be any crop. The fallback applies only when no delivery can
       * be paid even with the relaxation.
       */
      readonly vegetableWildCards: number;
      /**
       * The Dairy board's crop waiver: *"Build, spending cards of any crops"*.
       * `true` (Dean, 10/09/2026, S12). Since 16/09/2026 the board also takes
       * `dairyDiscount` cards off the price (R10), and a discount above 0
       * waives the n-of-suit requirement by itself, so this flag decides
       * anything only at a discount of 0.
       *
       * ⚠️ NAME IT AS A PASSENGER IN EVERY WRITE-UP: this waives what CLAUDE.md
       * calls "the natural gate" on building, free, for every player, every
       * turn. Dean ruled on 10/09/2026 to KEEP it and MEASURE it, and the
       * reading that judges it is the own-crop build share, 82.6% to 83.3%
       * under v31 and never re-read since.
       */
      readonly dairyWild: boolean;
      /**
       * ⭐ THE DAIRY BOARD'S DISCOUNT (Dean, ruling R10, v41, 16/09/2026):
       * *"Build, spending cards of any crops, with a discount of 2."* The build
       * costs this many cards fewer, and a discount above 0 already waives the
       * n-of-suit requirement in the engine's pricer (`dairyWild` waives it at 0
       * too). 0 is the full-price waiver-only board of 10-15/09/2026.
       *
       * ⛔ IT REPLACES `dairyGrowsBuilt`, DELETED THE SAME DAY: the board no
       * longer Grows the building it builds, and the build task's `thenGrow`
       * rider went with it.
       */
      readonly dairyDiscount: number;
      /**
       * Cards the Wheat board puts into your barn AFTER its harvest: *"Harvest
       * one of your buildings, then put 1 card from your hand into your barn."*
       * 1 (Dean, 10/09/2026, ruling C88). ⛔ THE RULING IS WHY THIS KEY EXISTS
       * AT ALL: S12's Wheat power was *"Harvest any one of your buildings,
       * however many cards are on it"*, which is W11 The Bakehouse word for
       * word. Dean ruled that the POWER moves and the CARD keeps its identity,
       * applying S13's own precedent, so the board harvests plainly and pays a
       * card into the barn on top - and the barn card is what keeps the power
       * live for a seat with nothing full to harvest.
       */
      readonly wheatBarn: number;
    };
  };
  readonly endGame: {
    /**
     * The flat island's clock (2026-08-09): the end fires when one seat
     * completes its `deliveriesToTrigger`-th ISLAND delivery.
     *
     * ⭐ THE FIRST KNOB TO SWEEP AFTER v31. The bonus slot now buys a whole core
     * action for one card and meeples add uncapped free ones, so the same 6
     * deliveries arrive sooner and turns are materially more powerful than
     * v30's. Expect a shorter game and higher scores before anything is dialled.
     */
    readonly trigger: 'deliveryCount';
    readonly deliveriesToTrigger: number;
    /**
     * Turns each OTHER player takes after the trigger. Read only under
     * `endOfGame: 'oneMoreTurnEach'`, and only the value 1 is implemented.
     */
    readonly furtherTurnsEach: number;
    /**
     * ⭐ HOW THE GAME ENDS ONCE IT IS TRIGGERED (Dean, 15/09/2026: "finish the
     * round").
     *
     * `'finishRound'` is the shipped rule: play continues until the round is
     * complete, so the game ends when the seat about to play would be the
     * round's first player (`GameState.firstPlayer`). A trigger by the last
     * seat of a round therefore ends the game at once, and a trigger by the
     * first seat gives every other seat one more turn.
     *
     * `'oneMoreTurnEach'` is every game before the ruling: the game ends when
     * the seat about to play is the trigger seat again, so every other player
     * has had exactly `furtherTurnsEach` (1) more turn.
     */
    readonly endOfGame: 'finishRound' | 'oneMoreTurnEach';
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
  readonly rules: RulesFile;
}
