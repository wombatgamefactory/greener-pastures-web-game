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
 * "Spend your junk" is only right when a spent card is LOST. Three cards in the
 * catalogue make a spent card something you keep:
 *
 *   - **O17 The Fruit Basket** - one card you spend goes into your barn.
 *   - **D5 The Churning Shed** - the cards this build spent are sown onto the
 *     building it just built.
 *   - **D11 The Heritage House** - Build, then sow all the cards spent.
 *
 * With any of those in your tableau the junkiest payment is no longer obviously
 * the best one, so the class keeps TWO representatives, its junkiest and its
 * best, and a term that learns to price the diversion has both to choose from.
 *
 * ⚠️ **D6 The Trading Shed is deliberately NOT in that set.** It gives a spent
 * card to a rival, which is a reason to spend your junk, not your treasure - the
 * ordinary representative is already the right one.
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
 * header for what each of them does and why D6 is not here.
 */
export const KEEPS_SPENT_CARDS: readonly CardId[] = ['O17', 'D5', 'D11'];

/**
 * Every card with an `afterBuild` listener, split by whether it makes a spent
 * card's IDENTITY worth choosing. The guard test asserts this covers the
 * registry exactly, so a new listener fails the build rather than quietly
 * inheriting "spend your junk".
 */
export const READS_BUILD_PAYMENT: readonly CardId[] = ['O17', 'D5', 'D6', 'D11'];
export const IGNORES_BUILD_PAYMENT: readonly CardId[] = ['D16', 'D17'];

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
      // ⭐ R15: THE MEEPLE VECTOR JOINS THE KEY, VERBATIM, exactly as D7's stack
      // selection does on the task branch below - and for the same reason. Two
      // builds that spend the same cards but different MEEPLES are not
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
      // The stack half is NOT collapsed by crop: which building loses cards is
      // D7 The Versatile Shed's whole printed fork, and `stackFills` has already
      // made the choice within one building canonical. So the stack selection
      // joins the key verbatim and only the hand payment collapses.
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
