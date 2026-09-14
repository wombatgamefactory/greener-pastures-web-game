/**
 * What a move DOES, with the two spellings of the same act collapsed.
 *
 * The engine deliberately offers a Deliver twice - as the `deliver` MOVE and as
 * the `deliver` ANSWER to a door's Deliver task - because both go through one
 * enumerator (ticket 19). A scoring term that only knew about the move type
 * would value the door's delivery at zero, so every term reads an `Act`
 * instead: normalise once here, and "Deliver is absolute" holds wherever a
 * delivery appears.
 *
 * ⛔ FOUR ACTS LEFT WITH v31 (02/09/2026) AND ALL FOUR WERE BOUGHT WITH MONEY:
 * `buy` (GBP 1 for a blind deck top into hand), `market` (GBP 3 for a deck top
 * into the barn), `upgrade` (GBP 2 to flip a starter) and `workOwn` (activate
 * your own Service, paid to the bank). The `worker` task answer went with the
 * `chooseWorker` task, and `discard` went with the hand limit. Two arrive to
 * replace them - `bonusDraw` and `spendMeeple` - and the visit changes shape.
 *
 * ⭐ THE VISIT CARRIES `self`, AND THAT FLAG IS RISK 2 OF THE WHOLE PASS. In
 * v31 a seat may place its bonus card on its OWN Notice Board and take its own
 * suit's action, so the same act, the same currency and the same slot buy
 * either a cross-table visit or a solitaire one. Collapsing the two into one
 * undifferentiated `visit` act would leave the bots unable to prefer either and
 * the report unable to tell them apart - which is precisely the failure the
 * plan warns about, "a healthy hook while the table plays solitaire". So the
 * distinction is carried on the act, priced by two separate weights (`visit`
 * and `selfVisit`), and read once off `host === seat` rather than re-derived at
 * every call site.
 *
 * ## ⭐ THE MEEPLE-LOOP ARM (04/09/2026) - one new act, and one changed one
 *
 * `rules.turn.visitCurrency: 'meeple'` re-cuts the bonus slot: the free Draw 1
 * becomes COLLECT (a new act) and the visit stops costing a card and starts
 * costing a MEEPLE, or two of them as a wild. So the visit act grows two shapes
 * rather than splitting into two acts - `fee` goes nullable and `meeples`
 * arrives - and that is deliberate. **Everything about a visit except what pays
 * for it is unchanged**: the door still runs, `outcome` still prices it,
 * `bonusAction` still pays the action premium, and `host === seat` still
 * separates the interaction door from the solitaire one (it is simply always
 * false under the arm, by rule X5). Splitting the act would have forced every
 * one of those terms to learn about the arm to keep doing the thing it already
 * does.
 *
 * ⚠️ THE `'card'` GAME IS THE CONTROL AND MUST NOT MOVE. Under it `fee` is a
 * CardId and `meeples` is empty, so every arm-gated branch below reduces to the
 * pre-04/09/2026 arithmetic exactly - which is the property `bots.test.ts` and
 * the reference reports both depend on.
 *
 * ## ⭐ HANDOFF v2 (04/09/2026 evening) - NO NEW ACT, FOUR NEW FIELDS
 *
 * R15 (`rules.turn.meepleAsCard`) makes a meeple a CARD of its colour, so it
 * can pay a build cost, a Grow's activation and an island crate; the amended R6
 * (`rules.turn.slotToll`) stops refusing an occupied slot and prices it in
 * burned meeples instead. Neither is a new kind of thing a seat can DO - a
 * build is still a build - so neither gets an act. What they add is a second
 * currency to four acts that already existed:
 *
 *   - `build.meeples` and `deliver.meeples` - meeples spent as cards,
 *   - `grow.meeples`, with `grow.payment` going NULLABLE beside it,
 *   - `visit.toll` - meeples burned to enter an occupied slot.
 *
 * ⚠️ **BOTH KNOBS DEFAULT OFF AND EVERY ONE OF THOSE FIELDS IS EMPTY OR NULL
 * UNTIL THEY ARE ON.** The engine cannot produce a meeple payment with
 * `meepleAsCard` false, or a toll with `slotToll` null, so the gate is the
 * ACT's own shape rather than a knob read - which is the rule `Scratch.meepleArm`
 * states and the only gate that cannot drift from the rule it stands for.
 *
 * ## ⭐ THE COIN-ACTIVATED FARMSTEAD (10/09/2026) - NO NEW ACT, ONE NEW FIELD
 *
 *   - `grow.coin` - the COIN-ACTIVATED FARMSTEAD (K10). A main-action Grow that
 *     places nothing and costs one coin instead of a card.
 *
 * ⚠️ **ABSENT OR FALSE UNTIL ITS KNOB IS ON**, so every other game reduces to
 * exactly the pre-10/09/2026 arithmetic, which the fixtures in @gp/sim assert.
 *
 * ## ⭐ THE VILLAGE STORE (12/09/2026) - NO NEW ACT, TWO NEW FIELDS
 *
 * `docs/village-store-coins-2026-09-12-v2.md`, rules V1 to V12, ledger A150,
 * built as an ARM and not as the default. The Store mints a coin per spare barn
 * card at a delivery and the coin is a wild card for exactly two things, and
 * neither of them is a new kind of thing a seat can DO:
 *
 *   - `build.coins` - the BUILD sink (V6). Coins in a build payment, as a COUNT.
 *   - `grow.coinGrow` - the GROW sink (V8/V9). A Grow paid with one coin that
 *     PLACES NOTHING, so the building never advances and a FULL one is a legal
 *     target.
 *
 * ⚠️ **THE MINT NEEDS NOTHING HERE AND THAT IS WORTH SAYING SO NOBODY GOES
 * LOOKING.** It is a `mint` TASK whose answers name a SUIT (five plus a skip,
 * whatever the barn holds), so it arrives as the `cardTask` act that already
 * exists. What it is WORTH is priced in `terms.ts`, off the head task rather
 * than off the payload, because three other cards already answer `card` with a
 * `suit`.
 *
 * ⚠️ **AND NEITHER FIELD IS THE MEEPLE'S.** M8 says a MEEPLE Grow places its
 * activation card as normal and CAN clog; V8 says a COIN Grow places nothing.
 * The two new rules of 12/09/2026 differ there on purpose, which is why
 * `coinGrow` is its own flag and not a widening of `meeples`.
 *
 * ⚠️ **BOTH FIELDS ARE 0 OR FALSE UNTIL THE STORE'S OWN LEAVES ARE ON**, and
 * each of the six is independently switchable, so `-build-only-v1` produces no
 * `coinGrow` and `-grow-only-v1` produces no `coins`. Gate on the ACT's shape
 * and never on a knob, and never on the assembled arm.
 */

import type { Suit } from '@gp/data';
import type { CardId, Move, Seat, TaskAnswer } from '@gp/engine';

type Spend = Partial<Record<Suit, number>>;

export type Act =
  /** The plain Draw action: `rules.turn.baseDraw`, see 2 keep 2 since v31. */
  | { a: 'draw' }
  /**
   * THE SOLITAIRE HALF OF THE BONUS SLOT: `rules.turn.bonusDraw` cards off the
   * top of any one deck in play, free. It is the yardstick every door has to
   * beat, and it is why the Orchard door prints Draw 3 rather than Draw 2.
   */
  | { a: 'bonusDraw' }
  /**
   * SPEND ONE MEEPLE: perform its colour's plain door action free, at the very
   * start of your turn, after which the meeple LEAVES THE GAME.
   *
   * `colour` is the whole act. What it is WORTH is what that door does in this
   * position, which is why it is on the probe path (`isProbed`) rather than
   * carrying a flat weight; what it COSTS is a stored action that never comes
   * back, which is `meepleSpend`.
   */
  | { a: 'spendMeeple'; colour: Suit }
  /**
   * `payment` is hand cards and `stacks` cards lifted off the seat's OWN
   * buildings (D7 The Versatile Shed). The engine holds
   * `payment.length + stacks.length === cardsNeeded`, so the two are ways of
   * paying ONE price and a term reading only their sum can never tell them
   * apart - which is what ticket 47 found `buildSpend` doing.
   *
   * `stacks` is a COUNT. Unlike the old barn leg, which ticket 51 measured as
   * dead (0.2% of 896 build groups offered one and no chosen move ever spent
   * one), a stack card is a REAL alternative to a hand card, so it is charged
   * as one.
   */
  | {
      a: 'build';
      card: CardId;
      payment: readonly CardId[];
      stacks: number;
      /**
       * ⭐ R15: MEEPLES SPENT AS CARDS OF THEIR COLOURS, EXPANDED INTO A LIST
       * OF COLOURS. The move carries a count vector, because the engine's
       * enumerator must never treat two meeples of a colour as distinguishable;
       * a term wants the same thing every other meeple term wants, which is
       * something to sum `meepleWorth` over. Expanding is bounded by the cap
       * (ten meeples at `meepleCapPerColour` 2) and costs nothing at all when
       * R15 is off, where the shared `NO_MEEPLES` is returned unallocated.
       *
       * ⚠️ It does NOT include the hand `payment`, and the two are priced by
       * different terms - `handSpend` for the cards, `meepleSpend` for these.
       * A wild pair (R10) is simply two entries here, which is what makes a pair
       * cost twice what a single meeple costs, exactly as it does on a visit.
       */
      meeples: readonly Suit[];
      /**
       * ⭐ **THE VILLAGE STORE'S BUILD SINK, AS A COUNT** (V6, A150, Dean
       * 12/09/2026): how many of this payment's resources were paid in COINS
       * rather than in cards. 0 in every game with `rules.economy.coinPaysBuild`
       * off, and 0 on every build a seat paid entirely in cards.
       *
       * ⛔ **A COUNT AND NEVER A LIST, WHICH IS THE ENGINE'S RULE REPEATED
       * HERE RATHER THAN A CONVENIENCE.** Coins are fungible, so a payment names
       * HOW MANY and never WHICH, and `BuildOption.coins` carries the branching
       * argument in full: enumerating them by identity would multiply an
       * already-`C(hand, k)` list by a second binomial. Nothing downstream may
       * expand this the way `meepleList` expands a meeple vector.
       *
       * ⛔ **AND IT IS WHY `handSpend` CANNOT BE THE ONLY CHARGE ON A
       * BUILD.** `cardsLeavingHand` counts `payment.length`, so a build paid
       * with three coins and no cards reads as FREE and a bot holding coins
       * would take every card it was offered. `coinSpend` charges this and is
       * the only thing that does: a build is not on `isProbed`, so its
       * `coinsSpent` event never reaches `priceEvent`.
       *
       * ⚠️ **DISJOINT FROM K15's ENDGAME COIN PRICE, WHICH IS WHAT LETS ONE
       * TERM CHARGE BOTH.** `priceOf` puts K15's coins on the PRICE and never on
       * the option, so this field is set by V6's loop alone; and no overlay
       * turns `endgameCoinCost` and `storeCoinsPerCard` on together, because
       * that would be a second mint beside a second sink.
       */
      coins: number;
    }
  /**
   * ⭐ `payment` IS NULL WHEN A MEEPLE PAID (R15), AND THAT IS NOT A SENTINEL -
   * it is the rule. A meeple-paid GROW places nothing: the meeple goes straight
   * to the box, never onto the stack, so there is no card to name, no
   * `cardPlaced`, no threshold step, and a building ALREADY AT ITS THRESHOLD is
   * a legal target. Every term that reads `payment` has to gate on the null,
   * and the two that do are `handSpend` (no card leaves the hand) and
   * `growSpend` (there is no card to junk-rank).
   */
  /**
   * ⭐ **`coin` IS THE COIN-ACTIVATED FARMSTEAD (K10, Dean 10/09/2026), AND IT
   * IS A THIRD WAY FOR `payment` TO BE NULL.**
   *
   * Under `rules.economy.farmsteadCoinPower` the Farmstead is a building with
   * no threshold whose activation cost is ONE COIN, fired as your MAIN action,
   * once per turn, with nothing placed on it. So `payment` is null for the same
   * reason R15's meeple-paid Grow has a null payment - no card left the hand -
   * and every term that already gates on that null keeps working unchanged
   * (`handSpend` charges nothing, `growSpend` has no card to rank).
   *
   * ⚠️ **THE FLAG IS CARRIED ANYWAY, AND THE REASON IS THAT THE NULL IS NOW
   * AMBIGUOUS.** `payment === null` used to mean exactly one thing (a meeple
   * paid); it now means "a meeple paid OR a coin paid", and the two cost
   * different currencies at different weights. Nothing in the shipped table has
   * to tell them apart yet - the two knobs are mutually exclusive in every
   * overlay anybody has written, and the coin's price is charged inside the
   * rollout rather than by a move term (see `priceEvent`'s `coinsSpent`) - but a
   * term that ever needs to should read this flag rather than re-derive it from
   * a knob, which is the same rule `Scratch.meepleArm` states.
   *
   * `false` on every task-answer Grow and under both controls, so the arm is
   * gated by the ACT's own shape.
   */
  /**
   * ⭐ **`coinGrow` IS THE VILLAGE STORE'S GROW SINK (V8/V9, A150, Dean
   * 12/09/2026), AND IT IS THE FOURTH WAY FOR `payment` TO BE NULL** - after a
   * card, a meeple (R15) and K10's Farmstead coin.
   *
   * ⛔ **IT IS NOT `coin` ABOVE AND THE TWO MUST NEVER BE MERGED.** K10's
   * `coin` is the coin-activated Farmstead suit power, a main action
   * on ONE named building, and `observe.ts` counts `move.coin === true` as a
   * Farmstead firing; folding V8's coin-Grow into it would put every coin-Grow
   * in the game into a metric that means something else. The two knobs are
   * mutually exclusive in every overlay anybody has written.
   *
   * ⛔ **WHAT THE FLAG IS ACTUALLY FOR, AND IT IS ONE TERM:
   * `growCompletes`.** V8 says the coin PLACES NOTHING, so the stack does not
   * advance, the building never fills and never clogs, and under V9 a building
   * that is ALREADY full is a legal target. `fillsBuilding` asks
   * `stack + 1 >= threshold` and knows nothing about what paid, so without this
   * flag a coin-Grow would collect the +3 for completing a building it does not
   * touch - and worst of all it would collect it on the V9 clog bypass, where
   * `stack >= threshold` already. Every other term is right by construction: the
   * null payment already zeroes `handSpend` and `growSpend`, and what the coin
   * COSTS arrives inside the rollout as `coinsSpent` (a Grow is on `isProbed`).
   *
   * ⚠️ **THERE IS NO CLOG COST TO REMOVE IN THIS TABLE, WHICH IS THE
   * THING TO UNDERSTAND BEFORE ADDING ONE.** Filling a building is scored
   * POSITIVE here (`growCompletes` +3), because a full building is a Harvest
   * waiting to happen and a harvest is barn cards at `harvest` 1.5 each. So "a
   * coin-Grow has no clog cost" is priced by DECLINING THAT CREDIT and by
   * nothing else, and the design's own self-limiting property falls out of the
   * same arithmetic: a building you only ever coin-Grow never fills, so it is
   * never harvested, so it never puts cards in your barn, and barn cards are
   * what make coins.
   *
   * `false` on every task-answer Grow that predates the Store and under every
   * control, so the sink is gated by the ACT's own shape.
   */
  | {
      a: 'grow';
      building: CardId;
      payment: CardId | null;
      meeples: readonly Suit[];
      coin: boolean;
      coinGrow: boolean;
    }
  | { a: 'harvest'; building: CardId }
  /**
   * `spend` is what the ISLAND was paid, in suits, and `meeples` is the part of
   * it that came out of the SUPPLY rather than the barn (R15). The two overlap
   * by construction, so `barnSpend` must charge `spend` MINUS these or a
   * meeple-paid crate is charged twice, once as freight and once as a meeple.
   */
  | { a: 'deliver'; tile: string; spend: Spend; meeples: readonly Suit[] }
  | { a: 'balloon'; balloon: string; spend: Spend }
  /**
   * THE INTERACTION HALF OF THE BONUS SLOT: one card from hand onto a Notice
   * Board, then that board's suit action. `self` is `host === seat` - see the
   * file header; it is the flag the whole pass turns on.
   */
  | {
      a: 'visit';
      host: Seat;
      fee: CardId | null;
      self: boolean;
      /**
       * ⭐ **WHICH OF THE HOST'S NOTICE BOARDS THE FEE LANDS ON, AND
       * THEREFORE WHICH POWER IS BOUGHT** (Dean's two-board fix, ruled
       * 11/09/2026, `rules.economy.noticeBoardsBySeats`). At TWO seats a host
       * lays out two boards - its own suit's, plus one drawn at random from the
       * suits nobody is farming - so `host` alone stopped naming a building and
       * stopped naming a power.
       *
       * ⛔ **PRESENT ONLY WHEN THE HOST HOLDS MORE THAN ONE**, which is the
       * engine's own rule (see the `visit` move's `board` field) and is what
       * keeps this arm's three- and four-seat games byte-identical to
       * `overlays/notice-board-visit-no-self-v1.overlay.json`. An ABSENT key
       * means "the host's own suit's board", which is every other game this
       * package has ever scored.
       *
       * ⛔ **AND IT IS THE FIELD `effectKey` PARTITIONS ON.** Until it was
       * carried here the memo key was `visit:${host}`, so the two boards of one
       * host collapsed to ONE rollout, scored identically to the last decimal
       * place, and `bestOf`'s rng tie-break picked between two different powers
       * at random - which is the instrument unable to demonstrate the very
       * CHOICE the fix exists to create. See `outcome.ts`'s `effectKey`.
       *
       * ⚠️ Nothing else reads it. Which card pays is `visitFeeJunk`'s
       * question and who is fed is `hostGift`'s, and neither changes with the
       * board: it is the same rival either way.
       */
      board?: CardId;
      meeples: readonly Suit[];
      /**
       * ⭐ THE SLOT TOLL (R6 as amended, `rules.turn.slotToll`): extra meeples
       * burned to enter a slot that already holds some. Empty under v1, where an
       * occupied slot is refused outright rather than priced.
       *
       * ⚠️ IT IS A SINK AND THE ACTING MEEPLE IS NOT. The acting `meeples` move
       * to the host's board and the host collects them; these go to the BOX and
       * never come back to anybody. Both are a full loss to THIS seat, which is
       * why one term charges both - the difference is invisible to a
       * self-regarding bot and is deliberately left that way.
       */
      toll: readonly Suit[];
    }
  /**
   * THE OTHER HALF OF THE BONUS SLOT UNDER THE MEEPLE-LOOP ARM
   * (`rules.turn.visitCurrency: 'meeple'`, Dean 04/09/2026): sweep every meeple
   * off your OWN Notice Board back into your supply, then Draw 1.
   *
   * It carries no fields, and it does not need any: WHICH meeples come back is
   * a fact about the seat's own board, not about the move, so the two halves of
   * its price are read off `Scratch` (`collectKeeps`, the meeples the cap will
   * actually let through) rather than off the act. There is exactly one Collect
   * on offer at a time - `collectOptions` returns a singleton - so there is
   * nothing here for a term to order either.
   *
   * ⭐ IT IS THE ARM'S SOLITAIRE LINE, and therefore the direct heir of
   * `bonusDraw`: an empty-board Collect IS a free Draw 1, and the bonus mix
   * counts it as such. What makes it more than that is the other half - the
   * stored actions a busy board hands back - which is why it is priced by two
   * terms and not one.
   */
  | { a: 'collect' }
  | { a: 'cardMove'; card: CardId; kind: string; payload: Record<string, unknown> }
  | { a: 'pass' }
  | { a: 'endTurn' }
  /** Task answers with no main-move twin. */
  | { a: 'deckPick'; suit: Suit }
  | { a: 'keep'; cards: readonly CardId[] }
  | { a: 'sow'; card: CardId; onto: CardId }
  /** Sow the top card of a DECK, never a hand card (A13, W7, a deck-sow door). */
  | { a: 'deckSow'; suit: Suit; onto: CardId }
  /**
   * GROW WITHOUT PLACING (A5 The Meadow Hive, A12 The Honey Hut): which of your
   * buildings to FIRE, with nothing paid and nothing placed.
   *
   * Its own act rather than `harvest`, even though the answer carries the same
   * one field, because the two are opposites: a harvest empties a stack and
   * this does not touch it. Priced by ROLLING IT OUT (`isProbed`), because the
   * value of an activation is entirely the value of what it fires - a flat
   * weight would have the bot either never taking A5 or always taking it.
   */
  | { a: 'activate'; building: CardId }
  /** An optional hand card into your own barn (the divert seam, W4's harvest). */
  | { a: 'handToBarn'; card: CardId }
  /**
   * The turn-boundary overflow: which cards go, when the hand is over
   * `rules.turn.handLimit`. Back with the limit on 02/09/2026.
   *
   * ⚠️ There is NO choice about whether to discard, only about which cards - so
   * this act must never be priced as a loss. `discardJunk` ranks the cards
   * instead, and `handSpendCost` is where the "a card over the limit is free"
   * ruling lives.
   */
  | { a: 'discard'; cards: readonly CardId[] }
  | { a: 'skip' }
  | { a: 'cardTask'; payload: Record<string, unknown> };

/**
 * The empty meeple list, shared. Every act carries one, and under the `'card'`
 * game and under R15-off every act carries THIS one - so the arm's new fields
 * cost the control a pointer copy and never an allocation.
 */
const NO_MEEPLES: readonly Suit[] = [];

/**
 * A count-per-colour vector, expanded into a colour list.
 *
 * The ORDER of the list is the object's own key order and nothing reads it:
 * every consumer sums `meepleWorth` across the whole list, which is
 * order-free. That is stated rather than assumed, because enumeration order IS
 * load-bearing elsewhere in this package and a reader is right to check.
 *
 * ⚠️ The engine deliberately carries meeple payments as counts and never as
 * lists, because two meeples of a colour are indistinguishable and enumerating
 * them individually is what would blow up the build enumerator (see
 * `meepleFills` in the engine's actions.ts). Nothing here re-introduces that:
 * this is one deterministic expansion of an ALREADY CHOSEN payment, so it can
 * never multiply the move list. It exists so that `meepleSpend` can sum
 * `meepleWorth` over an act's meeples in one shape, whichever act it is.
 */
function meepleList(counts: Partial<Record<Suit, number>> | undefined): readonly Suit[] {
  if (counts === undefined) return NO_MEEPLES;
  const out: Suit[] = [];
  for (const [suit, n] of Object.entries(counts) as [Suit, number][]) {
    for (let i = 0; i < n; i++) out.push(suit);
  }
  return out.length === 0 ? NO_MEEPLES : out;
}

function actOfAnswer(answer: TaskAnswer): Act {
  switch (answer.kind) {
    case 'deck':
      return { a: 'deckPick', suit: answer.suit };
    case 'keep':
      return { a: 'keep', cards: answer.cards };
    // chooseBuilding's only `then` is 'harvest', so this IS a harvest.
    case 'building':
      return { a: 'harvest', building: answer.card };
    case 'activate':
      return { a: 'activate', building: answer.card };
    case 'sow':
      return { a: 'sow', card: answer.card, onto: answer.onto };
    // ⚠️ A TASK ANSWER CANNOT CARRY MEEPLES AND THAT IS THE ENGINE'S SHAPE, NOT
    // AN OMISSION HERE. `TaskAnswer`'s build and deliver kinds have no meeple
    // field, so a build bought through a door and a delivery made by a card
    // effect are card-paid by construction, even under R15. If either answer
    // ever grows one, these two lines are where it arrives - and `meepleSpend`
    // already claims `task`, so the price would follow without a term change.
    // ⭐ V6 (12/09/2026): the answer carries `coins` for exactly the reason
    // it carries `meeples` - every route into a build has to carry the whole
    // payment or none - so the act reads it here as well. A dairy door's Build
    // and D7's are both this line.
    case 'build':
      return {
        a: 'build',
        card: answer.card,
        payment: answer.payment,
        stacks: (answer.stacks ?? []).length,
        meeples: NO_MEEPLES,
        coins: answer.coins ?? 0,
      };
    // A Grow answered through a task is the same act as a Grow played as a
    // move. `meeples` is always empty and `coin` is false by rule (K10: the
    // coin-activated Farmstead is a main action only).
    //
    // ⭐ `coinGrow` RIDES ACROSS HERE, WHICH `coin` DOES NOT (V8, A150,
    // 12/09/2026): a task-bought Grow IS coin-payable.
    //
    // The Apiary retext's deck-paid Grow (14/09/2026) arrives as `payment` null
    // and `coinGrow` false: no hand card leaves, so `handSpend` and `growSpend`
    // charge nothing, and the Grow is probed like every other.
    case 'grow':
      return {
        a: 'grow',
        building: answer.building,
        payment: answer.payment,
        meeples: NO_MEEPLES,
        coin: false,
        coinGrow: answer.coinGrow === true,
      };
    case 'deliver':
      return { a: 'deliver', tile: answer.tile, spend: answer.spend, meeples: NO_MEEPLES };
    case 'balloon':
      return { a: 'balloon', balloon: answer.balloon, spend: answer.spend };
    case 'deckSow':
      return { a: 'deckSow', suit: answer.suit, onto: answer.onto };
    case 'handToBarn':
      return { a: 'handToBarn', card: answer.card };
    case 'discard':
      return { a: 'discard', cards: answer.cards };
    case 'skip':
      return { a: 'skip' };
    case 'card':
      return { a: 'cardTask', payload: answer.payload };
    default:
      answer satisfies never;
      throw new Error(`Unknown task answer ${JSON.stringify(answer)}`);
  }
}

export function actOf(move: Move): Act {
  switch (move.type) {
    case 'task':
      return actOfAnswer(move.answer);
    case 'cardMove':
      return { a: 'cardMove', card: move.card, kind: move.kind, payload: move.payload };
    case 'draw':
      return { a: 'draw' };
    case 'bonusDraw':
      return { a: 'bonusDraw' };
    case 'spendMeeple':
      return { a: 'spendMeeple', colour: move.colour };
    case 'build':
      return {
        a: 'build',
        card: move.card,
        payment: move.payment,
        stacks: 0,
        meeples: meepleList(move.meeples),
        // ⭐ V6: a COUNT, absent on the move when none was paid, and never
        // expanded into a list - see the field's own note.
        coins: move.coins ?? 0,
      };
    case 'grow':
      return {
        a: 'grow',
        building: move.building,
        payment: move.payment,
        meeples: move.meeples ?? NO_MEEPLES,
        // ⭐ K10: `true` or ABSENT on the move, never `false`, so the read is a
        // strict comparison and the act carries a plain boolean either way.
        coin: move.coin === true,
        // ⭐ V8/V9, spelled the same way and kept strictly apart from it.
        coinGrow: move.coinGrow === true,
      };
    case 'harvest':
      return { a: 'harvest', building: move.building };
    case 'deliver':
      return {
        a: 'deliver',
        tile: move.tile,
        spend: move.spend,
        meeples: meepleList(move.meeples),
      };
    case 'moveBalloon':
      return { a: 'balloon', balloon: move.balloon, spend: move.spend };
    case 'visit':
      // ⭐ `meeples` IS THE ARM'S CURRENCY MADE VISIBLE TO THE TERM TABLE, and
      // the empty array is the `'card'` game. One meeple for a plain visit, TWO
      // for a wild spend (R10) - and the COUNT is the whole reason it is carried
      // here rather than derived: a wild buys the same door for twice the stock,
      // so a term that could only see "a visit happened" would price the two
      // identically and the bots would burn pairs they should have held.
      // ⭐ `board` RIDES ACROSS ONLY WHEN THE ENGINE NAMED ONE (Dean's
      // two-board fix, 11/09/2026) - present or absent, never null - so every term
      // and `effectKey` gate on the ACT's shape rather than on the knob that
      // produced it. Absent is the definite description the engine falls back
      // on: the host's own suit's board.
      return {
        a: 'visit',
        host: move.host,
        fee: move.fee,
        self: move.host === move.seat,
        ...(move.board === undefined ? {} : { board: move.board }),
        meeples: move.meeples ?? NO_MEEPLES,
        // R6 as amended: the meeples burned to enter an occupied slot. Absent
        // under v1, where an occupied slot is refused and there is nothing to
        // price.
        toll: move.toll ?? NO_MEEPLES,
      };
    case 'collect':
      return { a: 'collect' };
    case 'pass':
      return { a: 'pass' };
    case 'endTurn':
      return { a: 'endTurn' };
    default:
      move satisfies never;
      throw new Error(`Unknown move ${JSON.stringify(move)}`);
  }
}

/** Total cards a spend map costs, across suits. */
export function spendSize(spend: Spend): number {
  let n = 0;
  for (const value of Object.values(spend)) n += value ?? 0;
  return n;
}
