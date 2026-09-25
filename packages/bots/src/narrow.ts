/**
 * THE OPTION COLLAPSE: 2,700 legal moves down to the ones that are actually
 * different decisions (03/09/2026).
 *
 * ## The finding this exists for
 *
 * Measured on the worst 2-seat position at a hand limit of 12: **2,734 legal
 * moves, of which 2,707 were build payments.** Twenty-seven distinct choices
 * wearing two and a half thousand costumes. `scoreAll` ran the whole TERMS
 * table over every one of them, and the balance suite fell from reference-v9's
 * 9.7 games per second to 0.2 - a five-hour arm, which is not an instrument, it
 * is a wait.
 *
 * ## Why the costumes are not choices
 *
 * A build cost is *n cards of the built card's crop plus m of any crop*. The
 * engine enumerates every concrete way to pay it because it must: `apply`
 * re-validates exactly what `legalMoves` offered, and a human at the table gets
 * to choose which of three identical-looking wheat cards leaves their hand. But
 * **no rule in the game can tell two payments apart once they spend the same
 * multiset of crops.** The cards go to their crops' discards; the built card
 * lands the same way; every downstream reader - the own-crop minimum, the
 * discard piles, the barn, a stack's interchangeability groups - reads crops
 * and counts, never identity.
 *
 * So the multiset of crops is the equivalence class, and everything inside one
 * class differs only in TASTE: which of your wheat cards you would rather keep.
 * That is a preference, and the codebase already has one answer to it -
 * `cardValue` in junk.ts, "your junk is their treasure", the same ordering the
 * visit fee, the gift and the overflow discard all use. So each class collapses
 * to its junkiest member and the bot sees one move per genuinely different way
 * to pay.
 *
 * ## Why this is bot-side and not engine-side
 *
 * ⚠️ **Deliberately here and not in `actions.ts`.** The engine keeps offering
 * every legal payment, because two consumers need them: `apply` validates
 * against the full set, and the UI hands a human the real choice. Collapsing in
 * the enumerator would take the choice away from the player to make the
 * simulator quick, which is the wrong trade in a game whose whole subject is
 * which card you part with. The bots are the only consumer that cannot use the
 * distinction, so the bots are where it is dropped.
 *
 * ## What it is guaranteed NOT to change, and this is the load-bearing claim
 *
 * The scored evaluator's price for a build reads the payment through exactly
 * two features - `handSpend`'s `payment.length` (constant across a class, since
 * every payment for one card costs the same number of cards) and `buildSpend`'s
 * `-totalValue(payment)`. The second is a sum of `cardValue`s, so **the highest
 * scoring payment in a class is exactly its junkiest member**, and the highest
 * scoring payment overall is the junkiest member of some class. Keeping the
 * junkiest of every class therefore keeps the argmax intact: the move the bot
 * picks is the move it would have picked from the full list.
 *
 * The one place it can differ is the tie-break. `bestOf` gathers every move
 * within `TIE_EPSILON` of the best and rolls its own rng over them, so dropping
 * dominated moves changes the SIZE of a tied top set on the rare positions
 * where two different payments sum to the same value (the `tail` term in
 * `cardValue` makes exact collisions uncommon but not impossible). That is a
 * re-roll of an arbitrary choice among equals, not a change of policy, and it
 * is measured rather than assumed - see the bench in `.probe/bench-balance.mts`.
 *
 * ## ⚠️ THE EXCEPTION, and it is the one that would mis-price Dairy in silence
 *
 * "Spend your junk" is only right when a spent card is LOST. Cards in the
 * catalogue make a spent card something you keep:
 *
 *   - **D5 The Churning Shed** - one card this build spent is sown onto the
 *     building it just built.
 *   - **D7 The Versatile Shed** (since v48) - one card this build spent is
 *     placed into your barn. Same shape as D5, same reason.
 *
 * With one of those in your tableau the junkiest payment is no longer
 * obviously the best one, so the class keeps TWO representatives, its junkiest
 * and its best, and a term that learns to price the diversion has both to
 * choose from.
 *
 * ⚠️ **D11 The Heritage House left this set on v47's retext.** It used to sow
 * every spent card back onto its own building (identity mattered: a card
 * headed back onto the board is a card you would rather it were your best,
 * not your junkiest). The v47 face is "Draw 1 for each card you spent" - a
 * plain refund by COUNT, not by identity, straight off `event.payment.length`.
 * The count is already invariant across an equivalence class (every payment in
 * one class spends the same number of cards), so the junkiest representative
 * scores exactly as well as any other member and there is nothing left for a
 * second representative to buy. D11 stays in `READS_BUILD_PAYMENT` (its
 * `afterBuild` still reads `event.payment`, for its length) but is gone from
 * `KEEPS_SPENT_CARDS`.
 *
 * ⚠️ **D6 The Trading Shed was already deliberately NOT in that set, and on
 * v47 it stopped reading the payment at all.** The v46 face gave away one of
 * the spent cards, which was a reason to spend your junk, not your treasure -
 * the ordinary representative was already the right one. The v47 face, "Build.
 * You and one neighbour each Draw 1", no longer touches what was spent (R1,
 * `tasks/v47-rulings-v1.md`: the draws are the owner's own residue for naming
 * a neighbour, ungated and unrelated to the payment), so its `afterBuild`
 * listener is deleted along with it. D6 has left `READS_BUILD_PAYMENT`
 * entirely, not moved to `IGNORES_BUILD_PAYMENT`: it is no longer a build
 * payment reader of any kind, because it no longer listens to `afterBuild`.
 *
 * ⚠️ **O17 The Fruit Basket left `READS_BUILD_PAYMENT` on v48's retext**, and
 * did not move to `IGNORES_BUILD_PAYMENT` either: it no longer listens to
 * `afterBuild` at all. The v48 face ("Once per turn, if you have 6 or more
 * cards in hand, add 1 to your Barn") reads the END-OF-TURN HAND, not a build
 * payment, and fires off `beforeTurnEnd` (`tasks/v48-rulings-v2.md` R12). It is
 * gone from `afterBuildCards()` and gone from every list here.
 *
 * ⭐ **A15 The Royal Apiary joins both sets on v48, and it is not a build
 * payment reader in its own right - it is a FORWARDER.** A15 discards a Tier
 * card from hand and runs that card's activated line directly
 * (`tasks/v48-rulings-v2.md` R1/R6); when the discarded card is D5 or D7, whose
 * activated line finishes in their own `on.afterBuild` listener, A15 carries a
 * listener of its own that relays the event so the forwarded listener sees it
 * (`apiary.ts`, "THE LISTENER TRAP"). So a build in reach of a Royal Apiary can
 * pay the SAME class of card in two different ways worth pricing - discard a
 * D5 or D7 into A15's forward, or leave the payment alone - and `keepsSpent`
 * reads the whole tableau for `KEEPS_SPENT_CARDS`, so a seat that has BUILT A15
 * keeps two payment representatives on every build it makes this turn, not
 * only on builds through D5 or D7 itself. **That is the branching cost**: one
 * seat holding A15 doubles the priced payments for every build it takes, for
 * as long as A15 sits on its farm, whether or not this build ever touches A15.
 * D11's shape (reads a payment, never keeps it) does not fit A15, because
 * which card A15 discards is a choice the forwarded D5/D7 listener prices by
 * identity, exactly as if D5 or D7 sat on the farm itself.
 *
 * ⚠️ A card that declares `divertsDiscard` would put the end-of-turn overflow in
 * the same position, so `discard` answers ask the same question. Nothing
 * declares it as of v31; the check is written anyway, because the failure mode
 * is silence.
 *
 * `narrow.test.ts` walks every registered handler with an `afterBuild` listener
 * and fails if one of them is not classified here, so the next card to reach
 * into a build payment cannot be added without somebody deciding which side of
 * this line it falls on.
 */

import type { GameData } from '@gp/data';
import type { CardId, Move, PlayerView, TaskAnswer } from '@gp/engine';
import { handlerFor } from '@gp/engine';

import { cardValue } from './junk.js';
import { cardById } from './scratch.js';

/**
 * Built cards that turn a spent card into something its owner KEEPS, so paying
 * with a good card can be right.
 *
 * A literal list rather than a handler flag: the engine has no declaration for
 * "reaches into a build payment and hands it back", inventing one would be a
 * rules-package change made for the simulator's convenience, and the guard test
 * (`narrow.test.ts`) makes an omission loud rather than silent. See the file
 * header for what each of them does and why D6, (since v47) D11 and (since
 * v48) O17 are not here, and why A15 is here despite reading no payment of its
 * own.
 */
export const KEEPS_SPENT_CARDS: readonly CardId[] = ['D5', 'D7', 'A15'];

/**
 * Every card with an `afterBuild` listener, split by whether it makes a spent
 * card's IDENTITY worth choosing. The guard test asserts this covers the
 * registry exactly, so a new listener fails the build rather than quietly
 * inheriting "spend your junk".
 */
export const READS_BUILD_PAYMENT: readonly CardId[] = ['D5', 'D7', 'D11', 'A15'];
// D18 A Helping Hand (v42) counts builds and never reads what paid for them.
// V17 The Dockworker's Union moved off `afterBarnDiscard` on sheet v45 (it now
// listens on `beforeTurnEnd`, gated on the Barn's size, not on any discard) and
// never read a build payment even under the old wiring, so it needs no list of
// its own here either way.
export const IGNORES_BUILD_PAYMENT: readonly CardId[] = ['D16', 'D17', 'D18'];

/**
 * THE PAIRED-ARM SWITCH. Off, `narrowMoves` returns its input untouched and the
 * bots see the raw enumeration again.
 *
 * A test seam in the same spirit as the driver's injectable `ViewFn`, and it is
 * here because the collapse is a CLAIM about rules-equivalence. The only way to
 * check a claim like that is to run both arms on the same seeds and diff the
 * outcomes, and without this the two arms are two git revisions, which is not a
 * thing a bench can hold at once. Default on; nothing in the shipped run ever
 * turns it off.
 */
let enabled = true;

export function setNarrowing(on: boolean): void {
  enabled = on;
}

/** Does this seat hold a card that makes a SPENT card worth keeping? */
function keepsSpent(view: PlayerView): boolean {
  return view.you.tableau.some((b) => KEEPS_SPENT_CARDS.includes(b.card));
}

/**
 * Does this seat hold a card that makes a DISCARDED card worth keeping? The
 * end-of-turn overflow's twin of `keepsSpent`, read off the engine's own flag
 * rather than a list because that flag exists and is the whole declaration.
 */
function keepsDiscarded(view: PlayerView): boolean {
  return view.you.tableau.some((b) => handlerFor(b.card)?.divertsDiscard === true);
}

/**
 * The crops a set of cards spends, as ONE NUMBER - the equivalence class's whole
 * identity.
 *
 * A count per crop packed six bits apiece, which is exact for any hand this game
 * can hold and order-free by construction, so it needs no sort. It was a sorted
 * array joined into a string until a CPU profile put that at 3.8% of a whole
 * game: this runs once per enumerated payment, which is the very thing there are
 * thousands of.
 */
const CROP_SLOT: Readonly<Record<string, number>> = {
  wheat: 0,
  vegetable: 6,
  orchard: 12,
  apiary: 18,
  dairy: 24,
};

function cropKey(data: GameData, cards: readonly CardId[]): number {
  let key = 0;
  for (const id of cards) key += 1 << (CROP_SLOT[cardById(data, id).suit] ?? 30);
  return key;
}

function totalOf(data: GameData, cards: readonly CardId[]): number {
  let sum = 0;
  for (const id of cards) sum += cardValue(data, id);
  return sum;
}

/**
 * One equivalence class: the cheapest member seen, and the dearest, kept as
 * indices into the caller's move list so nothing is copied.
 */
interface Class {
  junkiest: number;
  junkiestValue: number;
  best: number;
  bestValue: number;
}

/**
 * The collapse.
 *
 * Returns the caller's own array untouched when there was nothing to collapse -
 * the common case by a wide margin, since most positions offer a handful of
 * builds and no overflow - so a narrow position pays one pass and no allocation.
 *
 * ORDER IS PRESERVED. The kept moves come back in the order the engine
 * enumerated them, which matters because `bestOf`'s tie-break rolls over a list
 * and a reordering would be an invisible change of bot.
 */
export function narrowMoves(
  data: GameData,
  view: PlayerView,
  moves: readonly Move[],
): readonly Move[] {
  if (!enabled) return moves;
  // Two collapsible families, and both are C(hand, k). Nothing else in the
  // move union grows with the hand, so a position with neither is left alone.
  let collapsible = false;
  for (const move of moves) {
    if (move.type === 'build') {
      collapsible = true;
      break;
    }
    if (move.type === 'task' && (move.answer.kind === 'build' || move.answer.kind === 'discard')) {
      collapsible = true;
      break;
    }
  }
  if (!collapsible) return moves;

  const both = keepsSpent(view);
  const bothOnDiscard = keepsDiscarded(view);
  const classes = new Map<string, Class>();
  const dropped = new Set<number>();

  const consider = (key: string, index: number, value: number, keepBest: boolean): void => {
    const seen = classes.get(key);
    if (seen === undefined) {
      classes.set(key, { junkiest: index, junkiestValue: value, best: index, bestValue: value });
      return;
    }
    if (value < seen.junkiestValue) {
      dropped.add(seen.junkiest);
      seen.junkiest = index;
      seen.junkiestValue = value;
    } else if (keepBest && value > seen.bestValue) {
      dropped.add(seen.best);
      seen.best = index;
      seen.bestValue = value;
    } else {
      dropped.add(index);
      return;
    }
    // The two representatives may have just converged on one move; never drop a
    // move that is still standing for its class.
    dropped.delete(seen.junkiest);
    if (keepBest) dropped.delete(seen.best);
  };

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i] as Move;
    if (move.type === 'build') {
      // ⭐ R15: THE MEEPLE VECTOR JOINS THE KEY, VERBATIM, exactly as the stack
      // selection does on the task branch below (⚠️ v48: no card in the game
      // still populates `stacks` - see that branch's own note) - and for the
      // same reason. Two builds that spend the same cards but different
      // MEEPLES are not
      // rules-equivalent: they spend the same number of resources but give up
      // different DOORS, which is the one decision R15 exists to create. Collapse
      // them by crop alone and the arm would enumerate the colour choice and
      // then throw all but one of them away before a bot ever scored it.
      //
      // ⚠️ The suffix is appended ONLY when a meeple actually paid, so under
      // `meepleAsCard: false` every key is byte-identical to the one this line
      // built before handoff v2 and the classes partition exactly as they did.
      const meeples =
        move.meeples === undefined
          ? ''
          : `|m${data.cards.suits.map((s) => move.meeples?.[s] ?? 0).join('')}.${move.wildPairs ?? 0}`;
      consider(
        `b|${move.card}|${cropKey(data, move.payment)}${meeples}`,
        i,
        totalOf(data, move.payment),
        both,
      );
      continue;
    }
    if (move.type !== 'task') continue;
    const answer: TaskAnswer = move.answer;
    if (answer.kind === 'build') {
      // ⚠️ v48: D7 The Versatile Shed, the whole printed fork this branch was
      // built for, lost its stack payment on retext (`tasks/v48-rulings-v2.md`)
      // and `BuildMods.fromStacks` lost its only caller - no card in the game
      // still asks `stackFills` for a stack-paid answer, so `answer.stacks` is
      // never populated by a real legal move any more. The branch is kept: the
      // schema still carries `stacks` (`actions/build.ts`, orphaned code kept
      // per the v46/v47 housekeeping decision), and if it is ever populated
      // again which building loses cards must join the key verbatim rather
      // than collapse by crop, for the same reason a future D7-shaped card
      // would want.
      const stacks = [...(answer.stacks ?? [])].sort().join(',');
      const key = `t|${answer.card}|${cropKey(data, answer.payment)}|${stacks}`;
      consider(key, i, totalOf(data, answer.payment), both);
      continue;
    }
    if (answer.kind === 'discard') {
      consider(`d|${cropKey(data, answer.cards)}`, i, totalOf(data, answer.cards), bothOnDiscard);
    }
  }

  if (dropped.size === 0) return moves;
  const out: Move[] = [];
  for (let i = 0; i < moves.length; i++) if (!dropped.has(i)) out.push(moves[i] as Move);
  return out;
}
