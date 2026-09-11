/**
 * The scoring terms. `score(move) = sum over terms of weight[term] * feature(term)`.
 *
 * Ticket 10 chose a term table over a 1-ply state evaluator because `apply`
 * very often returns a mid-effect state with a pending task, so resulting
 * positions are not comparable across moves. The cost of that choice is that
 * the bot has an opinion about each MOVE, which rots when the rules move. Two
 * things hold it honest:
 *
 *   - every term declares the move types it `claims`, and a test asserts the
 *     union of claims is exactly the engine's `MOVE_TYPES`, so a rules change
 *     that adds a move type fails the build rather than scoring it 0 forever;
 *   - `--explain` prints the per-term breakdown behind a decision, so a weight
 *     can be argued with instead of believed.
 *
 * Three terms come straight from the reference implementation's `BotPolicy.php`
 * - `deliver` (DL-78 "Deliver is absolute"), `unclogBoard`, and the junk rank
 * behind `visitFeeJunk`. Everything else is ours.
 *
 * ## ⭐ v31 (02/09/2026) - what left, and the two things that arrived
 *
 * ELEVEN TERMS WENT, and every one of them priced money or a face that no
 * longer exists: `coinGain`, `buy`, `buyDemand`, `buyTargetCrop`, `buySaving`,
 * `marketGain`, `marketSaving`, `upgrade`, `workOwn`, `workerTask` and
 * `discardJunk` (the end-of-turn discard went with the hand limit).
 * `marketPayability` survives under its honest name, `deliverability` - the
 * market was never its only reader, V5 and V6 were.
 *
 * SIX ARRIVED, and the first four are the whole of this ticket:
 *
 *   - **`meepleGain` / `meepleSpend`** - the meeple is the game's second
 *     resource now, and a bot that does not price one will hoard it and report
 *     the mechanism dead. Both read `meepleWorth`, and they are pinned to the
 *     same weight so the bot's own books balance.
 *   - **`farmsteadVp`** - the Farmstead pays 1 VP per own-suit card built, on
 *     every build decision. Unpriced, risk 3 (the monoculture pull) would
 *     measure as absent when it was only invisible.
 *   - **`selfVisit`** - risk 2. The bonus slot's solitaire door and its
 *     interaction door cost the same currency, so they need separate weights or
 *     no arm can tell which one the table is taking.
 *   - **`clogOwnBoard`** - the only structural brake v31 puts on self-visiting.
 *   - **`bonusDraw`** - the slot's free Draw 1, the yardstick every door beats.
 *
 * ## ⭐ THE MEEPLE-LOOP ARM (04/09/2026) - NO NEW TERM AND NO NEW WEIGHT
 *
 * `rules.turn.visitCurrency: 'meeple'` re-cuts the bonus slot into VISIT (a
 * meeple onto a neighbour's board, never your own) and COLLECT (your own board
 * swept back into your supply, plus Draw 1). Five terms change what they read
 * and **not one constant moves**, which is deliberate: the arm has to be
 * readable as a delta against the control on identical seeds, and a repriced
 * table would make every delta a mixture of the rule and the instrument.
 *
 *   - **`handSpend`** loses the visit - no card is spent (R1).
 *   - **`visitFeeJunk` / `visitFeeOwnCrop`** lose their subject with it.
 *   - **`meepleSpend`** gains it: a visit costs one meeple, or TWO as a wild
 *     (R10), at the price a meeple has always carried.
 *   - **`meepleGain`** gains Collect, priced by the meeples that survive the
 *     one-per-colour cap and never by the meeples on the board.
 *   - **`bonusDraw`** gains Collect's draw, at the same rate the free Draw 1 had.
 *   - **`clogOwnBoard`** has no subject at all and is guarded off explicitly.
 *
 * `bonusAction` (the whole-extra-action premium), `visit` and `selfVisit` are
 * untouched, and `outcome` prices the door exactly as before, because what a
 * visit IS did not change - only what pays for it.
 *
 * ## ⭐ HANDOFF v2 (04/09/2026 evening) - AGAIN NO NEW TERM AND NO NEW WEIGHT
 *
 * R15 (`rules.turn.meepleAsCard`) makes a meeple a CARD of its colour, and the
 * amended R6 (`rules.turn.slotToll`) prices an occupied slot rather than
 * refusing it. Both default OFF, both are paired arms against the shipped loop,
 * and the same discipline applies: **not one constant in `weights.ts` moves.**
 * Four terms change what they READ and one constant in `scratch.ts` is new:
 *
 *   - **`meepleSpend`** gains three more exits - a meeple paid into a build, a
 *     meeple paid into an island crate, and a meeple burned as a slot toll - at
 *     the one price a meeple has always carried. It does NOT gain the GROW, and
 *     that omission is load-bearing: see `meeplesLeavingSupply`.
 *   - **`handSpend`** loses the GROW's card when a meeple pays for it.
 *   - **`growSpend`** loses its subject in the same case.
 *   - **`barnSpend`** stops charging the part of a delivery the SUPPLY paid.
 *   - **`MEEPLE_AS_CARD_FLOOR`** (scratch.ts) is the only new number: a meeple
 *     whose door is dead is now worth a CARD rather than 0.4 of a door, because
 *     under R15 that is what it is. It is set by ARGUMENT, like `MEEPLE_LATENT`
 *     and `meepleGain` before it, and it is not overlay-addressable.
 *
 * ## ⭐ THE COMMONS (09/09/2026) - ONE CLAIM ADDED TO FIVE TERMS, NO NEW TERM
 *
 * `rules.turn.visitCurrency: 'commons'` is the shipped default and it is the
 * FIRST of these passes that is not an arm: the meeple game and the v31 card
 * visit are the controls now. The bonus slot holds one option, a card from hand
 * onto one of the five central boards (C3), and the striking thing from this
 * file's side is how little it asks for. A commons play is a v31 visit with the
 * host deleted: a card leaves the hand, a door runs, and the whole-extra-action
 * premium is due. So the terms that priced THAT price this, by claiming one more
 * move type:
 *
 *   - **`handSpend`** charges the fee, at the same 2.5 it charged a v31 visit's.
 *   - **`visitFeeJunk`** orders WHICH card pays it. "Your junk is their
 *     treasure" becomes "your junk is the table's treasure", which is a better
 *     fit than it was: the pile is public and anybody may harvest it (C5).
 *   - **`outcome`** rolls the board's action out, which is the only way to tell
 *     a Harvest board from a Draw board.
 *   - **`bonusAction`** pays the action premium when the board resolves
 *     something.
 *   - **`visit`** claims it, at weight 0 in the reference and moved only by the
 *     `hermit` and `socialite` controls - see `weights.ts`.
 *
 * ⭐ **AND `harvest` LEARNED TO SEE THE CENTRE, WHICH IS THE ONE CHANGE THE
 * HANDOFF DID NOT ASK FOR.** A harvest may now take a whole central pile (C5),
 * and `stackOf` reads the seat's own tableau - so without a fallback every
 * central harvest scored a flat 0, the bots would never have taken one, and
 * a18's "barn cards from the centre" would have read zero as a fact about the
 * instrument. `commonsPileSize` is that fallback and it is gated by the engine's
 * own `commonsBoardSuit`, which answers null outside the commons, so both
 * controls are untouched.
 *
 * ⛔ **THREE TERMS LOSE THEIR SUBJECT AND ARE LEFT EXACTLY AS THEY ARE**:
 * `selfVisit` (no host, so no solitaire branch to separate), `clogOwnBoard` (no
 * board is yours and none can ever fill, C4) and `visitFeeOwnCrop` (the
 * magpie's disposal lane - see its own entry, because that one is a real cost).
 *
 * ## ⭐ THE NOTICE-BOARD VISIT (11/09/2026) - ONE NEW TERM, AND IT IS THE FIRST
 * TIME THIS PACKAGE HAS PRICED SOMETHING A RIVAL GETS
 *
 * `rules.turn.visitCurrency: 'noticeBoardPower'` (S1-S16,
 * `docs/notice-board-visit-handoff-2026-09-10-v2.md`). The five Notice Boards
 * come home to their owners' farms as BUILDINGS, and the bonus is to play one
 * card from your hand onto ANY player's board - your own included - and take
 * that board's printed POWER. The card rests on the host's board until the host
 * harvests it into their barn, **and that is the host's entire payment.**
 *
 * It reuses the v31 `{ type: 'visit', seat, host, fee }` move, so most of this
 * file needed nothing at all. **Five terms fire for the new arm with no change,
 * and that was VERIFIED rather than assumed**: `handSpend` (a card leaves the
 * hand - `cardsLeavingHand` reads the act's non-null `fee`), `outcome` (the
 * board's power, rolled out - `visit` is on `isProbed`), `bonusAction` (the
 * whole-extra-action premium, still guarded on a strictly positive rollout),
 * `visitFeeJunk` (which card pays) and `visit` / `selfVisit` (the two halves of
 * the slot, `act.self` being live again for the first time since 03/09/2026).
 *
 * ⭐ **`visitFeeOwnCrop` IS RE-OPENED**, which is a comment change and not a
 * code one: it never stopped claiming `'visit'`, it simply had no fee to rank
 * under the meeple arm and was deliberately not extended to the commons. See
 * its own entry.
 *
 * ⛔ **`clogOwnBoard` AND `unclogBoard` ARE GUARDED OFF BY S8, AND THAT IS A
 * REAL CHANGE.** The Notice Board's threshold is `3+`: three is the minimum
 * before the owner may harvest and never a maximum load, so nothing clogs and
 * there is no door to reopen. Both weights are 6, the largest cost in the
 * table, and left firing they would have decided the two readings the pass
 * exists to take - a 6-point charge on the self-visit that filled a board, and
 * a 6-point reward for the owner's harvest that a20 counts. `Scratch`'s
 * `noticeBoardClogs` is the one boolean both read, and it is TRUE under the v31
 * control and under `-blocking-v1`, so neither moves.
 *
 * ⛔ **AND THE ONE GENUINELY NEW TERM IS `hostGift`** - what a card handed to a
 * rival is worth to that rival. Nothing in this pricer has ever known that, it
 * is the ledger's C64, and it has bitten three designs running. Its weight is
 * MEASURED and not argued; the method and the sample are at its entry in
 * `weights.ts`.
 *
 * ## ⭐ DEAN'S UNCLAIMED-BOARDS VARIANT (ruled 11/09/2026) - NO NEW TERM, NO
 * NEW WEIGHT, AND ONE REAL BUG FIXED IN EACH OF TWO FILES
 *
 * `overlays/notice-board-visit-unclaimed-v1.overlay.json`:
 * `rules.turn.selfVisitAllowed` false AND
 * `rules.economy.unclaimedBoardsToCentre` true. Self-visiting is banned, and the
 * Notice Board of every suit NO PLAYER IS FARMING stands ownerless in the middle
 * with a public pile, so **every seat faces exactly FOUR targets at every player
 * count** - (seats - 1) rivals' boards plus (5 - seats) central ones.
 *
 * ⛔ **THE ONE THING THAT MAKES THIS PASS DIFFERENT FROM YESTERDAY'S IS THAT
 * BOTH MOVE KINDS ARE LIVE AT ONCE**, sharing one bonus slot: a play onto a
 * RIVAL's board is the v31 `visit` move, and a play onto a CENTRAL board is the
 * `commons` move that has been in the engine since 09/09/2026. A central board
 * grants the same amplified printed S12 power its owned twin grants (the
 * manager's ruling of 11/09/2026: same card, same power, no rules exception),
 * and any seat may Harvest a central pile at `commonsHarvestMin` (3) or more.
 *
 * ⭐ **SO THE DECISIVE NUMBER OF THE WHOLE PASS IS THE CENTRAL-VERSUS-RIVAL
 * SPLIT, AND THIS FILE IS WHERE IT IS PRICED.** Five terms fire identically on
 * the two kinds and are what makes them comparable at all - `handSpend` (2.5 for
 * the one card either way; a wild pair cannot exist here, `doCommons` throws),
 * `visitFeeJunk` (0.3, which card pays), `outcome` (the power, rolled out),
 * `bonusAction` (2.4, and only on a rollout that resolves something) and `visit`
 * (0 in the reference, and it counts BOTH kinds as one, so `socialite` at 8 and
 * `hermit` at -100 push on the slot rather than on the split). **The only term
 * that separates them is `hostGift`, at -1.5 on a rival visit and structurally
 * zero on a central play, because a central board has no host and nothing is
 * handed to anybody.** That is the honest arithmetic of the variant's own
 * headline risk - a central board is socially free and a rival's board is not -
 * and it is left standing rather than neutered. See its entry.
 *
 * ⛔ **THE ONE GENUINE BUG IN THIS FILE WAS `commonsPileSize`**, which asked a
 * `data`-only question and therefore priced every central pile at ZERO under
 * this variant. See its own entry: it is the 09/09/2026 village-green defect
 * returning in a new place, and **every reading about the centre in this pass
 * depends on the fix.** Its twin in `outcome.ts` is the `harvested` event's
 * unclog leg, which was paying 6 for an owner's harvest of a board that cannot
 * clog - guarded there on the same `noticeBoardClogs` boolean this file's two
 * move terms already read.
 *
 * ⚠️ **`selfVisit` AND `clogOwnBoard` HAVE NO SUBJECT AND ARE NOT TOUCHED**:
 * the ban means the engine never enumerates a self-visit, so `act.self` is false
 * for every visit in the game, and `clogOwnBoard` is off the `noticeBoardClogs`
 * boolean as it is under the whole notice-board family.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveryVp, endgameCoinCost, hostDrawOnVisit } from '@gp/data';
import type { CardId, Move, MoveType } from '@gp/engine';
import { commonsBoardCard, hasCentre } from '@gp/engine';

import type { Act } from './acts.js';
import { spendSize } from './acts.js';
import { cardValue, totalValue } from './junk.js';
import type { Outcomes } from './outcome.js';
import type { Scratch } from './scratch.js';
import { cardById, handSpendCost, meepleWorth, thresholdOfView } from './scratch.js';

export interface Term {
  readonly name: string;
  /** Move types this term can score. Asserted against the engine's MOVE_TYPES. */
  readonly claims: readonly MoveType[];
  /**
   * `act` is the move with its two spellings collapsed; `s` the per-decision
   * facts. `move` and `o` are for the one term that probes - everything else
   * ignores them, and should, because a term that reaches for the probe when a
   * cheap feature would do is spending an `apply` for nothing.
   */
  readonly feature: (act: Act, s: Scratch, move: Move, o: Outcomes) => number;
  /**
   * This term charges for something, so its product must never be positive.
   *
   * Three terms in a row were written as a negative WEIGHT against an already
   * negated FEATURE and therefore paid the bot for spending more - `growSpend`
   * (ticket 45), `buildSpend` (47) and `deliverCost` (48). Each read correctly
   * at its own call site and each was inverted where it counted, because the
   * sign of a product is not visible from either half.
   *
   * So the convention is declared rather than remembered: a cost term negates
   * in the FEATURE and its weight is POSITIVE in every profile. Both halves are
   * asserted - the weights in `roster.test.ts`, the features against real games
   * in @gp/sim's `bots.test.ts` - so a fourth one cannot be written the old way
   * without turning something red.
   */
  readonly cost?: true;
}

/** Both spellings of the same act: the main move and its task-answer twin. */
const ACTION_AND_TASK: readonly MoveType[] = ['task'];

function suitOf(data: GameData, id: CardId): Suit {
  return cardById(data, id).suit;
}

function stackOf(s: Scratch, building: CardId): number {
  return s.buildings.get(building)?.stack.length ?? 0;
}

/**
 * ⭐ **CARDS ON A CENTRAL PILE, OR 0 FOR ANYTHING THAT IS NOT ONE** (C5,
 * 09/09/2026) - the commons' half of `stackOf`, kept separate from it because
 * only ONE term may read it.
 *
 * A central board is not in anybody's tableau, so `stackOf` answers 0 for all
 * five and every term built on it (`fillsBuilding`, `growCompletes`,
 * `sowCompletes`) stays correct by construction: nothing is ever sown onto a
 * central board and none of them has a threshold to fill (C4). The one term that
 * WOULD be wrong is `harvest`, because a harvest may take a whole pile, and a
 * flat 0 there is not a small mispricing - it is a bot that never harvests the
 * centre at all, reporting the centre as unused when the instrument simply could
 * not see it.
 *
 * ⛔ **IT USED TO ASK THE ENGINE'S `commonsBoardSuit`, WHICH IS `data`-ONLY AND
 * ANSWERS NULL OUTSIDE `visitCurrency: 'commons'` - AND THAT WENT BLIND ON
 * 11/09/2026.** Under Dean's unclaimed-boards variant there is a centre under
 * `'noticeBoardPower'` as well, so every central pile priced at a flat 0 and
 * **the bots would never have harvested one**: the farm-bypass split, the
 * central piles' median size at harvest and a20's stall would all have read the
 * instrument rather than the rules. ⚠️ **This is the EXACT defect that was
 * found and fixed for the village green on 09/09/2026, returning in a new
 * place** - the bots knew how to value emptying their own building and had
 * never seen a pile with no owner.
 *
 * ⭐ **IT IS NOW THE VIEW-SIDE TWIN OF THE ENGINE'S `centralPileSuit`
 * (query.ts, 11/09/2026), WHICH IS THE STATE-AWARE QUESTION AND THE ONE EVERY
 * RULE SHOULD ASK.** It cannot simply CALL it: that function takes a
 * `GameState`, and this package may not see one (see `index.ts` - a policy gets
 * a `PlayerView` and a `Prober` and nothing else). So the logic is mirrored
 * here off the one authority both halves agree on, **the commons zone's own
 * keys**, which is exactly what `centralPileSuit` reads rather than
 * re-deriving which suits are unfarmed:
 *
 *   - under the commons the zone carries all five colours (C1), so walking its
 *     keys gives the same answer `commonsBoardSuit` gave, id for id;
 *   - under the unclaimed-boards variant it carries only the suits NO SEAT IS
 *     FARMING, so W3 answers `wheat` when nobody farms Wheat and **null when
 *     somebody does** - because then it is that seat's own building and a
 *     harvest of it must stay a tableau harvest priced off the tableau;
 *   - under every other currency there is no zone at all (`commonsZone` returns
 *     `{}`), so `view.commons` is absent and this answers null for every id,
 *     which is what keeps the v31 and meeple controls byte-identical.
 *
 * `hasCentre` is belt and braces rather than the gate - the zone's presence is
 * already the same predicate - and it is read anyway so that the question this
 * asks has the engine's own spelling.
 *
 * The piles are fully public in the view (they were played face up), so there
 * is no sight question either.
 */
function centralPileSuitOfView(s: Scratch, building: CardId): Suit | null {
  const boards = s.view.commons?.boards;
  if (boards === undefined || !hasCentre(s.data)) return null;
  // The catalogue's order, so the walk is identical for every seat and every
  // run, exactly as `centralBoardSuits` is. An ABSENT key is a board that is
  // not in the centre at all; the two are never conflated.
  for (const colour of s.data.cards.suits) {
    if (boards[colour] === undefined) continue;
    if (commonsBoardCard(s.data, colour) === building) return colour;
  }
  return null;
}

function commonsPileSize(s: Scratch, building: CardId): number {
  const colour = centralPileSuitOfView(s, building);
  if (colour === null) return 0;
  return s.view.commons?.boards[colour]?.length ?? 0;
}

function thresholdOf(s: Scratch, building: CardId): number | null {
  const view = s.buildings.get(building);
  return view ? thresholdOfView(s.data, view) : null;
}

function fillsBuilding(s: Scratch, building: CardId): boolean {
  const threshold = thresholdOf(s, building);
  return threshold !== null && stackOf(s, building) + 1 >= threshold;
}

function countOwnCrop(s: Scratch, ids: readonly CardId[]): number {
  let n = 0;
  for (const id of ids) if (suitOf(s.data, id) === s.mySuit) n += 1;
  return n;
}

function countTargetCrop(s: Scratch, ids: readonly CardId[]): number {
  if (s.targetSuit === null) return 0;
  let n = 0;
  for (const id of ids) if (suitOf(s.data, id) === s.targetSuit) n += 1;
  return n;
}

/** The card a standing move spends out of hand. */
function cardMoveSpend(payload: Record<string, unknown>): CardId | null {
  const fee = payload['fee'];
  if (typeof fee === 'string') return fee;
  const card = payload['card'];
  if (typeof card === 'string') return card;
  return null;
}

/**
 * The acts whose value is unknowable from their label (ticket 40).
 *
 * GROW fires a card's ability, and the ability is the entire value of the move.
 * A VISIT and a MEEPLE are the same shape one level up: both buy a DOOR ACTION,
 * and a Harvest door, a Draw 3 door and a Sow-from-hand door are three
 * completely different moves wearing one label. In v30 only the Service branch
 * of a visit was probed, because the other branch paid a flat coin; v31 deleted
 * the coin branch, so **every visit is now worth exactly what its door does**
 * and every one of them is rolled out.
 *
 * ⭐ `commons` IS ON IT FOR EXACTLY THE VISIT'S REASON (09/09/2026). A commons
 * play buys a DOOR ACTION, and a Harvest board, a Draw 2 board and a Build board
 * are three completely different moves wearing one label. It is the ONLY bonus
 * option the shipped game has (C9), so the whole of the bonus slot's arithmetic
 * now runs through this rollout - which also makes `outcome` the one term that
 * can tell a board worth playing to from a board that would do nothing.
 *
 * ⭐ `spendMeeple` IS ON THIS LIST FOR THE SAME REASON, and it is the single
 * most important entry for the v31 report. A meeple is a stored action; what it
 * is worth is what that action does in this position, and nothing else. A flat
 * weight would have the bots either dumping every meeple the turn they got it
 * or sitting on all of them, and either way the "meeples earned versus spent"
 * assertion would be reporting the weight rather than the rules.
 *
 * `cardMove` stays on the list although the catalogue currently has no producer
 * - the Helping Hand became a bonus-slot modifier with no handler body in v31 -
 * because the move type still exists and the next card to use it would
 * otherwise be priced at a flat weight in silence.
 *
 * The known understatements, unchanged:
 *
 * ⚠️ **W14 The Pizzeria**, whose payoff arrives only after rivals accept - and a
 * probe stops at a rival's task, by design.
 *
 * ⚠️ **D15 The Grand Creamery is understated on purpose**. Its value is an
 * EXPECTATION OVER A RANDOM RUN - reveal a deck top, build it free, reveal again
 * while each card costs more than the last - and a greedy one-decision-at-a-time
 * rollout cannot hold that: it walks the flips it can see inside `DEPTH` and
 * prices each `built` flat and blind, so what comes out is roughly the first
 * flip or two rather than the run. An under-valued D15 is a readable result (the
 * arm reports a low play rate and the card is suspected), where an over-valued
 * one is not. If the arm shows D15 never taken at all, suspect this before
 * suspecting the card.
 *
 * ⚠️ **A5 and A12**, grow-without-placing: A12's second pick is priced by the
 * same path one decision later, which is a beam of one over the two rather than
 * an exhaustive pair.
 *
 * Everything NOT in this set has a feature that already reads its own value -
 * a delivery's printed VP and its meeple, a harvest's stack size, a build's VP -
 * so probing it would spend an `apply` to learn what the table already knows.
 * ⚠️ `deliver` in particular must stay OFF this list: `meepleGain` prices its
 * meeple as a move term and `priceEvent` prices the same meeple as an event, and
 * only the fact that a delivery is never probed keeps those two from both firing.
 */
// ⭐ DEAN'S VARIANT (09/09/2026, commonsTake: 'bonus') PUTS `commonsTake` ON
// THIS LIST TOO: what a take is worth is a fact about the position - which
// cards sit in that pile right now - not a fixed count the way
// `rules.turn.bonusDraw` is, so it rolls out through the same `outcome` term
// rather than a flat feature.
function isProbed(act: Act): boolean {
  switch (act.a) {
    case 'grow':
    case 'visit':
    case 'commons':
    case 'commonsTake':
    case 'spendMeeple':
    case 'cardMove':
    case 'balloon':
    case 'activate':
      return true;
    default:
      return false;
  }
}

/**
 * The receipt a delivery to this tile would take, read off how many seats have
 * already delivered there. 0 for a tile with no room, which never reaches here
 * because a full tile offers no move.
 */
function deliverVpOf(s: Scratch, tileId: string): number {
  const tile = s.view.island.tiles.find((t) => t.tile === tileId);
  return tile ? deliveryVp(s.data, tile.deliveredBy.length) : 0;
}

/**
 * THE MEEPLE THIS DELIVERY WOULD CLAIM - the colour sitting face up on the next
 * free delivery space of this tile.
 *
 * Parallel arrays by index: entry i of `meeples` is the meeple on delivery space
 * i, and `deliveredBy.length` is the next free one. Face up from setup, so this
 * is public information and there is no sight question.
 *
 * ⚠️ IT READS ONE SPACE AND V14 CAN TAKE TWO. The Depot that claims BOTH
 * receipts on a tile also claims both meeples, and this returns only the first,
 * so a V14 delivery is under-priced by one meeple. Left as an understatement
 * rather than special-cased, on this file's standing rule that a term describes
 * a move and never a card - and the safe direction, since the alternative is a
 * bot that over-rates a card it happens to know about.
 */
function meepleAtTile(s: Scratch, tileId: string): Suit | null {
  const tile = s.view.island.tiles.find((t) => t.tile === tileId);
  return tile?.meeples[tile.deliveredBy.length] ?? null;
}

/**
 * Cards this act takes out of the seat's STORED FREIGHT, by whichever exit
 * (ticket 48).
 *
 * Three routes and one price. A tile's card cost is fixed by its crates
 * (`crates x cardsPerCrate`) and a wild crate changes which suit pays rather
 * than how many, so this cannot order the spends for one tile - measured over
 * 391 real (decision, tile) pairs it never once varied within a tile. What it
 * prices is the resource leaving.
 *
 * The build leg is D7 The Versatile Shed's stack payment. A card on one of your
 * own stacks is not in the barn yet, but it is freight in waiting - it goes
 * there on the next harvest and nowhere else - so spending it on a build costs
 * the seat the same thing, and D7's whole printed fork is that a stack card is
 * either freight or building material and never both.
 */
function barnCardsSpent(act: Act): number {
  switch (act.a) {
    // ⭐ R15: `spend` IS WHAT THE ISLAND WAS PAID AND NOT WHAT THE BARN PAID.
    // A meeple pays its share of a crate straight out of the supply, so the
    // barn is short by exactly the meeples in the spend and charging the whole
    // `spend` here would bill a meeple twice - once as freight and again as a
    // meeple, at `meepleSpend`. Zero under both knob-off games, where
    // `act.meeples` is always empty.
    case 'deliver':
      return spendSize(act.spend) - act.meeples.length;
    case 'build':
      return act.stacks;
    default:
      return 0;
  }
}

const NO_MEEPLES: readonly Suit[] = [];

/**
 * ⭐ MEEPLES THIS ACT TAKES OUT OF THE SEAT'S SUPPLY, by whichever exit - the
 * acting meeple of a visit (R1, R10), a meeple spent as a card of its colour
 * (R15), or a meeple burned as a slot toll (R6). Every one of them is a full
 * loss to this seat and every one of them is charged at the same price.
 *
 * ⚠️ **`grow` IS DELIBERATELY ABSENT AND THAT IS THE ONE THING TO GET RIGHT
 * IN THIS FUNCTION.** A GROW is on `isProbed`, so its meeple arrives inside the
 * rollout as a `meepleAsCard` event and `priceEvent` charges it there. Build and
 * Deliver are NOT probed - they never were, for the reasons written at
 * `isProbed` and at `meepleGain` - so their events never reach a pricer and
 * their meeples have to be charged here. Charge a Grow here as well and it pays
 * twice; charge a Build only in the pricer and it pays not at all. **The split
 * is exactly the probed / unprobed line and nothing else.**
 *
 * Two things are NOT returned here and both are handled inline by `meepleSpend`:
 * the v31 turn-start `spendMeeple`, whose single colour would cost an
 * allocation a decision to wrap in a list, and the visit's `toll`, which is a
 * second list on one act.
 */
function meeplesLeavingSupply(act: Act): readonly Suit[] {
  switch (act.a) {
    case 'visit':
    case 'build':
    case 'deliver':
      return act.meeples;
    default:
      return NO_MEEPLES;
  }
}

/** Cards this act takes OUT of the seat's hand. */
function cardsLeavingHand(act: Act): number {
  switch (act.a) {
    // The meeples are NOT here and must not be: `payment` is card ids only, and
    // a meeple never came out of a hand (R15 - it is a card of its colour, but
    // it was never in the hand and it never counts toward the hand limit).
    case 'build':
      return act.payment.length;
    // ⭐ A MEEPLE-PAID GROW SPENDS NO CARD (R15). The null payment is the rule
    // and not a sentinel - nothing is placed, so nothing left the hand - and it
    // is gated on the ACT rather than on the knob, for the reason the `visit`
    // case below states.
    case 'grow':
      return act.payment === null ? 0 : 1;
    // ⭐ A MEEPLE VISIT PAYS NO CARD (R1, the meeple-loop arm). The null fee is
    // the rule itself, not a sentinel: nothing is ever placed on a Notice Board
    // under the arm, so `handSpend` - the only price left in the v31 game -
    // simply has no subject here. Gated on the ACT rather than on the knob so
    // the two can never disagree.
    case 'visit':
      return act.fee === null ? 0 : 1;
    // ⭐ THE COMMONS FEE (C3): always exactly one card, never null, and the fee
    // is EXTRA in every case - a Build board still pays the build's own cost on
    // top, which arrives through the rollout as the `built` event's payment.
    //
    // ⭐ **UNLESS IT IS A WILD PAIR, WHICH IS TWO (K3, 10/09/2026).** This line
    // hard-coded `return 1` until the pair was built, and the comment beside
    // `commonsPlayed` in `outcome.ts` said the fee was "charged once by the
    // `handSpend` MOVE term" - both were right about a slot that could only ever
    // take one card. Two cards of any colours now stand in for one of the
    // board's colour and BOTH leave the hand, so a pair that read 1 here would
    // be half price to the bot and it would take pairs it should have refused.
    // Gated on the ACT's shape (`fee2` present) rather than on the two knobs, so
    // the two can never disagree.
    case 'commons':
      return act.fee2 === undefined ? 1 : 2;
    // ⭐ DEAN'S 'paid' VARIANT (09/09/2026): `fee` is present only under that
    // value, exactly as `visit`'s fee is present only under 'card' - gated on
    // the ACT rather than on the knob so the two can never disagree. `'bonus'`
    // and `'spend'` pay no fee, so a take there spends no hand card.
    case 'commonsTake':
      return act.fee !== undefined ? 1 : 0;
    case 'sow':
      return 1;
    case 'cardMove':
      return cardMoveSpend(act.payload) === null ? 0 : 1;
    default:
      return 0;
  }
}

/**
 * ⚠️ **THE STANDING-SENSITIVE HALF OF `hostGift`, AND IT SHIPS AT ZERO. READ
 * THIS BEFORE TURNING IT ON: THE PREDECESSOR'S PUBLIC RECORD SAYS IT MAY
 * DESTROY THE DYNAMIC THE DESIGN IS TRYING TO BUY.**
 *
 * The refinement is obvious and it is probably right about the arithmetic:
 * helping the leader is worse than helping the last-placed player, so the gift
 * should cost more when the host is ahead. At a tilt of `t` and a host `L`
 * clocks ahead of the table's mean, the charge is `1 + t*L` gifts rather than
 * one, where `L` runs about -1 to +1 (see `leadOfHost`).
 *
 * ⛔ **WHY IT IS OFF.** The whole reason this design exists is the 887-comment
 * BGG record on the predecessor's LOAD mechanic, and that record says two things
 * that bear directly on this constant. **Kingmaking draws exactly one complaint
 * in 887.** And **paid helping reads as a CATCH-UP VALVE that players LIKE** -
 * routing help to whoever is behind is called *"my favourite catch-up
 * mechanic"*. The handoff's own §4 reading 8 asks for the last player as a
 * percentage of the winner precisely because this design may have restored that
 * valve for free, now that the island's second-delivery meeple has gone and
 * taken the game's only catch-up term with it.
 *
 * **A bot that refuses to feed the leader would suppress exactly the traffic
 * that reading is trying to detect**, and it would do it in the direction that
 * flatters the design: standings would compress because the instrument
 * compressed them, and "the notice-board visit restored a catch-up term" would
 * be a statement about this line. That is the `visit: 2` failure wearing a
 * cleverer hat.
 *
 * ⭐ **SO THE SHIPPED DEFAULT IS THE SIMPLER, STANDING-BLIND TERM**, and the
 * measurement did not argue against it: the value handed over was measured
 * without reference to who received it (`weights.ts`, `hostGift`), and nothing
 * in that measurement asked for a standings term. **Turn this on only to
 * BRACKET a reading**, never to ship, and only after the standing-blind arm has
 * been run - and if it is ever turned on, say in the write-up that the
 * catch-up reading is void for that column.
 *
 * ⚠️ Set by ARGUMENT, like `MEEPLE_AS_CARD_DOOR_PREMIUM`, and NOT
 * overlay-addressable: it is a constant in this file, so a sweep of it is an
 * edit and a rebuild (the ledger's C45).
 */
const HOST_GIFT_LEADER_TILT = 0;

/**
 * ⭐ **THE TWO HALVES OF WHAT A VISIT HANDS A HOST, EACH AT THE PRICE THIS
 * TABLE ALREADY CARRIES FOR THE ZONE THE CARD LANDS IN** (S7 and S17,
 * 11/09/2026). They exist as constants rather than as one number in
 * `weights.ts` because **S17 is a KNOB and the control is the same design
 * without it**, so the charge has to be able to say which of the two halves a
 * given run actually pays.
 *
 *   - `HOST_GIFT_FEE` is `harvest`'s own 1.5 - "one card into a barn" - and it
 *     is S7's whole payment: the fee rests on the host's Notice Board until the
 *     host harvests it. It is the number this term shipped at on 11/09/2026 and
 *     it has not moved.
 *   - `HOST_GIFT_DRAW` is `drawAction`'s own 1.2 - "one card of draw" - and it
 *     is S17: when a neighbour visits you, you draw a card, immediately, off a
 *     deck. It is paid PER VISIT and never per turn, so a host visited twice in
 *     one turn is handed it twice and this term fires twice, once per move.
 *
 * ⛔ **`hostGift` IN `weights.ts` IS THEIR SUM AND MUST STAY THEIR SUM.** The
 * weight is the whole payment under S17 and the feature below scales it back
 * down to the fee half when the rule is off, which is the only arrangement that
 * lets ONE weight price TWO rulesets. `notice-board-host-draw.test.ts` asserts
 * the sum, because a weight edited here and not there would silently reprice
 * both arms at once.
 *
 * ⚠️ **THE CONTROL'S CHARGE IS 1.5 TO FIFTEEN DECIMAL PLACES AND NOT TO
 * SIXTEEN** (`(1.5 / 2.7) * 2.7` is 1.4999999999999998), which is stated rather
 * than hidden. Nothing in this project asserts a notice-board number byte for
 * byte - the nine @gp/sim fixtures are the shipped commons, the v31 card visit
 * and the meeple arms, where this whole term is structurally zero - so the
 * residue reaches no fixture. If a notice-board fixture is ever minted, mint it
 * after this line and not before.
 */
const HOST_GIFT_FEE = 1.5;
const HOST_GIFT_DRAW = 1.2;

/** The whole S17 payment. `weights.ts` carries this number as `hostGift`. */
export const HOST_GIFT_TOTAL = HOST_GIFT_FEE + HOST_GIFT_DRAW;

/** What is left of the charge when S17 is off: the fee card and nothing else. */
const HOST_GIFT_FEE_SHARE = HOST_GIFT_FEE / HOST_GIFT_TOTAL;

/**
 * How far ahead of the table this host is, on the one public monotone clock the
 * design has: **island receipts**, six of which end the game (S4, and the
 * Farmstead prints exactly six slots so the clock is readable across the
 * table). Roughly -1 when the host is as far behind as the spread allows and
 * +1 when as far ahead, 0 at the mean.
 *
 * Receipts and not VP, deliberately. VP would need the built tableau, the
 * end-game handlers and a scoring pass the view cannot cheaply do; receipts are
 * public, they are what the game ENDS on, and the design's own legibility claim
 * is that a row of filled slots is how a player reads the standings.
 *
 * ⚠️ Its only reader is `HOST_GIFT_LEADER_TILT`, which is 0, so this function
 * multiplies out of the shipped table. It is live rather than commented out for
 * the reason the file states elsewhere: a branch whose only producer is a knob
 * at its shipped value is not deleted.
 */
function leadOfHost(s: Scratch, host: number): number {
  const you = s.view.you.receipts.length;
  let total = you;
  let seats = 1;
  let theirs = you;
  for (const rival of s.view.rivals) {
    total += rival.receipts.length;
    seats += 1;
    if (rival.seat === host) theirs = rival.receipts.length;
  }
  // Six deliveries ends the game, so six receipts is the whole of the clock and
  // the widest a gap can honestly be.
  return (theirs - total / seats) / 6;
}

export const TERMS: readonly Term[] = [
  // --- what the move actually does ------------------------------------------
  {
    /**
     * **What a card in hand is worth, which is not nothing** (Dean, 2026-08-02).
     *
     * The other half of every exchange. It was written when `coinGain` priced
     * what a visit GETS and nothing priced what it PAYS, and the two constants
     * deciding a worthless visit were unrelated to each other. Measured at the
     * moment the seat's marginal coin was provably worth zero:
     *
     *     worthless coin visit  -1.95   {visitFeeJunk: -1.95}
     *     vs endTurn            -2.00   {endTurn: -2}
     *
     * The bot gave away a card for literally nothing, by 0.05, in 68% of those
     * positions - not because a card was priced at zero, but because the only
     * thing charging for it was `visitFeeJunk`, a JUNK ORDERING (its own header
     * says "not an economic estimate") that happened to land beside an
     * artificial -2 tax on ending your turn.
     *
     * ⭐ v31 MAKES THIS THE ONLY PRICE IN THE GAME. There is no currency any
     * more: a card is what a build costs, what a grow costs, what a visit costs
     * and what a Power card costs. Everything the bot spends, it spends here.
     */
    name: 'handSpend',
    // ⭐ `commonsTake` JOINS THE LIST (09/09/2026, `commonsTake: 'paid'`): the
    // only thing that prices the fee's cost, exactly as it does `commons`'s -
    // `cardsLeavingHand` reads 0 for a take under `'bonus'`/`'spend'`, so this
    // is a no-op there.
    claims: ['build', 'grow', 'visit', 'commons', 'commonsTake', 'cardMove', ...ACTION_AND_TASK],
    feature: (act, s) => -handSpendCost(s, cardsLeavingHand(act)),
    cost: true,
  },
  {
    /**
     * `handSpend`'s twin for the other store: what a card leaving the BARN
     * costs, wherever it leaves for (ticket 48).
     *
     * It used to be two terms with two constants and a hole. `deliverCost` was
     * `-0.5` against a `-spendSize` feature, so the product paid the bot 0.5 a
     * card for delivering to the tile that ate MORE freight; `buildBarn` (ticket
     * 47) charged D8's barn leg properly but only there; and a balloon move's
     * two barn cards were charged nothing at all. One store, three exits, three
     * different answers.
     *
     * The third exit, the balloon, is charged at this same weight but not from
     * here: ticket 49 made a balloon move PROBED, so its freight is taken off
     * the `balloonMoved` event beside the reward that freight bought - which is
     * also where a balloon moved by a card effect INSIDE a rollout gets charged,
     * so one route serves both. Charging it here as well would take it twice.
     *
     * **It stays a COUNT, and it deliberately does not read `demandSuits`**
     * (ticket 51). The hand has an ordering sibling beside its count charge
     * (`visitFeeJunk`, `growSpend`, `buildSpend`) and the barn has none, so the
     * obvious repair is to make a barn card the island still wants dearer than one
     * it does not. Measured over 55 stratified games, that feature is not merely
     * small, it is UNINFORMATIVE:
     *
     *   - the island exit cannot use it at all. A delivery's spend is built from
     *     the tile's own crates, so 100% of the 1580 cards delivered were a suit
     *     an open tile wanted, and 0 of 1098 (decision, tile) pairs separate on it;
     *   - D8's build leg is a dead lane. Only 0.2% of 896 build groups offered a
     *     barn card at all and not one chosen move spent one;
     *   - the balloon is the only exit with a real choice (51.0% of 4604 pairs
     *     pick which two suits burn), and there the demand binary is a coin flip
     *     against what actually matters. Where the choice changes how many island
     *     tiles the barn can still PAY for (13.5% of pairs), burning the fewest
     *     demanded cards keeps the most tiles payable **53.4%** of the time.
     *
     * The reason is ticket 38's: the barn's block is MATCHING under an
     * all-or-nothing payment, not quantity. Burning 1 of 3 wheat when a tile wants
     * 3 is fatal and burning 1 of 6 is free, and a binary "is wheat wanted" cannot
     * tell those apart.
     *
     * **And it does not read PAYABILITY either, which is the feature 51 named as
     * the one that would work** (ticket 52). That feature is real - "would burning
     * these two cards cost me a delivery I could otherwise have made" separates
     * where demand cannot - but the prize is already collected by accident, and
     * the whole of it was measured before anything was written: nothing orders
     * these spends today, so the size of the prize is simply the REGRET the
     * random tie-break pays, and over 55 stratified games that is **9 tiles of
     * payability across 215 moves, 0.16 a game**. Both channels' ceilings are
     * below the noise floor a paired A/B could resolve, which is why one was
     * never run.
     */
    name: 'barnSpend',
    claims: ['deliver', 'build', ...ACTION_AND_TASK],
    feature: (act) => -barnCardsSpent(act),
    cost: true,
  },
  {
    /**
     * The probe term. Applies the move on a throwaway clone and prices what
     * came out, in this same weight table's currency - so a grow that harvests
     * a three-card stack is worth what harvesting that stack is worth, and a
     * grow that does nothing here is worth nothing here.
     *
     * Its default weight is 1 because the value arrives already denominated:
     * the pricer scored those events with the profile's OWN weights, so a
     * racer's rollout is priced through a racer's eyes. The weight stays
     * tunable for the one thing it can honestly express - how much a profile
     * trusts a rollout against a flat preference.
     *
     * ⭐ IT NOW CARRIES BOTH HALVES OF THE BONUS SLOT AND THE MEEPLE PHASE.
     * A visit is worth its door, a meeple is worth its door, and this is the
     * only term that can see either. Set `outcome` to 0 in a profile and that
     * profile goes blind to three of the five things v31 changed.
     */
    name: 'outcome',
    claims: [
      'grow',
      'visit',
      // ⭐ THE COMMONS (09/09/2026). Under the shipped default this term is the
      // ONLY thing that can see what the bonus slot buys, because the slot holds
      // exactly one option and its whole value is the board's action.
      'commons',
      // ⭐ DEAN'S VARIANT'S TAKE (09/09/2026, commonsTake: 'bonus'): the only
      // thing that can see what a take is actually worth, on the same footing
      // as `commons` above - a rollout, priced through `cardsToHand`.
      'commonsTake',
      'spendMeeple',
      'cardMove',
      'moveBalloon',
      ...ACTION_AND_TASK,
    ],
    feature: (act, _s, move, o) => (isProbed(act) ? o.value(move) : 0),
  },

  // --- the island -----------------------------------------------------------
  {
    // DL-78. The one rule that makes a game terminate, so it carries the
    // biggest feature in the table: the VP this delivery would actually take.
    //
    // Since the flat island (2026-08-09) that is no longer a property of the
    // tile but of its fill order - 6 for arriving first, 3 for second - so this
    // one feature carries the whole race. It is why the bot prefers a fresh tile
    // to a half-taken one without any term saying so.
    name: 'deliver',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'deliver' ? deliverVpOf(s, act.tile) : 0),
  },
  {
    /**
     * ⭐ **THE MEEPLE THE ISLAND HANDS OVER** (v31), and the reason a delivery
     * is not simply worth its VP any more.
     *
     * The island's coin is gone; every delivery space carries a meeple instead,
     * face up from setup, so which colour a tile will pay is public all game and
     * choosing WHICH tile to deliver to is now partly a choice of which free
     * action to store. A bot blind to this would pick tiles on VP and freight
     * alone and the whole face-up-meeple design would measure as decorative -
     * the same failure mode the demand tokens hit before ticket 52.
     *
     * The feature is `meepleWorth`: 1 for a colour whose door this seat could
     * use, `MEEPLE_LATENT` for one it could not. See `scratch.ts` for why that
     * scale is deliberately FLAT across the five colours - a bot told in advance
     * that a Draw meeple beats a Sow meeple would hand the plan's door-mix
     * question back as an answer.
     *
     * Pinned to `meepleSpend` in `weights.ts`: one price for a meeple, whichever
     * direction it travels. If one moves, move both.
     *
     * ## ⭐ IT NOW ALSO PRICES **COLLECT** (the meeple-loop arm, R7)
     *
     * Collect is the arm's other bonus option and it pays in two currencies at
     * once: a flat Draw 1, which `bonusDraw` prices at the same rate it always
     * priced the free draw, and the meeples coming home off your own board,
     * which are stored actions and belong here at the island's own meeple price.
     * Nothing new is introduced for it - same weight, same `meepleWorth` scale -
     * because a meeple arriving from your own Notice Board and a meeple arriving
     * off a tile are the same object arriving in the same supply, and any
     * daylight between the two prices would be the instrument inventing a
     * preference between the arm's two faucets.
     *
     * ⭐ **THE CAP IS PRICED, AND IT IS THE SUBTLE HALF.** The feature reads
     * `s.collectKeeps` - the meeples that would SURVIVE the one-per-colour cap -
     * so a duplicate is worth exactly 0 and collecting a board full of colours
     * you already hold is worth precisely the draw and nothing else. That is the
     * whole shape of the cap as a rule, and a bot that counted meeples on the
     * board instead would over-rate the one position the cap exists to punish.
     *
     * ⚠️ **COLLECT MUST STAY OFF `isProbed`**, for the reason `deliver` is off
     * it: inside a rollout the same meeples arrive as `meepleGained` events and
     * `priceEvent` charges this same weight for each. Probing a Collect would
     * pay for it twice. No card in the 105 causes a Collect today, so the two
     * paths cannot both fire - but that is a fact about the catalogue and it is
     * written here because the next card to reach for one would break it
     * silently.
     */
    name: 'meepleGain',
    claims: ['deliver', 'collect', ...ACTION_AND_TASK],
    feature: (act, s) => {
      if (act.a === 'collect') {
        let worth = 0;
        for (const colour of s.collectKeeps) worth += meepleWorth(s, colour);
        return worth;
      }
      if (act.a !== 'deliver') return 0;
      const colour = meepleAtTile(s, act.tile);
      return colour === null ? 0 : meepleWorth(s, colour);
    },
  },
  {
    /**
     * The freight branch: a Deliver action that moves a balloon instead. Pays
     * 2 differing barn cards and is never an island delivery.
     *
     * The flat taste for taking one at all, and nothing more - ticket 49 moved
     * what the move is WORTH into the probe (its printed reward) and what it
     * COSTS into the pricer (its two barn cards), so this is the exact twin of
     * `grow`: a preference about the action, with the outcome priced where the
     * outcome is. Its default weight is 0; see `weights.ts`.
     */
    name: 'balloon',
    claims: ['moveBalloon', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'balloon' ? 1 : 0),
  },

  // --- the meeple supply ----------------------------------------------------
  {
    /**
     * ⭐ **WHAT SPENDING A MEEPLE COSTS** - the term that decides whether the
     * bots hoard, and therefore whether the v31 report can be believed on the
     * meeple economy at all.
     *
     * A meeple is spent for free at the start of a turn and then LEAVES THE
     * GAME. Nothing in the rules charges for that, so a naive evaluator sees an
     * unconditional free action and spends every meeple the instant it can,
     * which would report a healthy economy no matter how badly the colours were
     * distributed. The real cost is the one a person feels: the stored action is
     * gone, and it might have been worth more next turn.
     *
     * So it charges exactly what `meepleGain` credited - the same
     * `meepleWorth`, the same pinned weight - which gives the bot a balanced set
     * of books and reduces the whole decision to one honest question: **is what
     * this door does right now worth more than holding the meeple?** The answer
     * comes from the rollout (`outcome`), which is a measurement rather than a
     * taste, and the only thing this term contributes is the reserve price.
     *
     * ⚠️ TWO THINGS IT CANNOT SEE, both stated because either could show up as
     * a false finding:
     *
     *  1. **A meeple has no terminal value.** Holding one at the end of the game
     *     is worth zero VP - deliberately, per the scoring header - so an ideal
     *     player empties their supply before the end and this term will keep a
     *     bot holding one it should have burnt. Expect the dead-meeple count to
     *     be an OVER-estimate near the end trigger.
     *  2. **It cannot compare this turn with next turn.** The evaluator is
     *     myopic per decision, so "wait for a better moment" is expressed as a
     *     flat reserve price and nothing else.
     *
     * ## ⭐ IT NOW ALSO CHARGES THE **VISIT** (the meeple-loop arm, R1, R10)
     *
     * Under the arm a visit costs no card and one MEEPLE, so the term that
     * charged the turn-start spend is the term that charges this: same
     * `meepleWorth`, same pinned weight, one price for a meeple leaving a supply
     * whichever door it leaves by. `handSpend` used to charge 2.5 for the visit's
     * card and `meepleGain` prices a meeple at 2.5, which is not a coincidence -
     * `weights.ts` pinned them deliberately, on the reading that *"the two routes
     * to a door are a card and a meeple, so the bot should be roughly
     * indifferent between them"*. The arm deletes one route and the price of the
     * other is unchanged, so the bonus slot's whole arithmetic - a door's rollout
     * plus `bonusAction` 2.4 against the solitaire line's `bonusDraw` 1.2 -
     * survives the currency change intact.
     *
     * ⚠️ **A SPENT MEEPLE IS NOT DESTROYED UNDER THE ARM, AND IT IS STILL A FULL
     * LOSS TO THIS SEAT.** It moves to the host's board and the HOST collects it.
     * That is the loop, and it is the half of the design that pays for being
     * visited - but this bot is self-regarding by standing rule (`outcome.ts`),
     * so what the host gains prices at 0 here exactly as the card fee did. If
     * that rule is ever relaxed, this is one of the two places it lands.
     *
     * ⭐ **THE WILD SPEND IS CHARGED BY THE COUNT** (R10): two meeples buy one
     * door, so the sum runs over `act.meeples` and a wild costs twice what a
     * plain visit costs. That is the only thing separating the two in the bots'
     * eyes - the door bought is identical, the rollout is identical, the action
     * premium is identical - which is exactly the shape the wild-share metric
     * wants, because it makes a wild a move a bot takes when the door is worth
     * two meeples and never a move it takes for free.
     *
     * ⚠️ **THE HANDOFF SAID "MINUS TWO LATENT MEEPLES" AND THIS CHARGES
     * `meepleWorth` INSTEAD.** The two agree in the case the spec was describing
     * - the pair you spend as a wild is usually two colours whose own doors are
     * dead, which `meepleWorth` prices at `MEEPLE_LATENT` each - and they differ
     * when a live-door meeple goes into the pair, where a flat latent charge
     * would under-price a real loss. Charging the flat rate would also break the
     * pin: a meeple would cost less leaving than it credited arriving, and a bot
     * whose books do not balance on its second resource burns it. Sweeping the
     * flat-0.4 variant is a one-line change here if the wild share reads high.
     *
     * ## ⭐ HANDOFF v2: IT NOW ALSO CHARGES A MEEPLE SPENT AS A **CARD** (R15)
     * ## AND A MEEPLE BURNED AS A **TOLL** (R6 as amended)
     *
     * `rules.turn.meepleAsCard` lets a meeple pay a build cost, a Grow's
     * activation and an island crate; `rules.turn.slotToll` prices an occupied
     * slot in extra meeples instead of refusing it. **All four exits are one
     * price**, on the standing rule this term was written under - one price for
     * a meeple leaving a supply, whichever door it leaves by - and there is
     * therefore no new weight for either rule. What DID move is the FEATURE the
     * price multiplies: `meepleWorth`'s floor rises from `MEEPLE_LATENT` 0.4 to
     * `MEEPLE_AS_CARD_FLOOR` 1 under R15, because a meeple whose door is dead is
     * still a card. See `scratch.ts` for the argument and for what it costs.
     *
     * ⚠️ **A BOXED MEEPLE NEVER COMES BACK AND A VISITED ONE DOES, AND THIS
     * TERM DOES NOT DISTINGUISH THEM.** The acting meeple of a visit moves to
     * the host's board and the host collects it; a build payment and a toll go
     * to the box (R16). To a SELF-REGARDING bot both are gone, so both are a
     * full charge - the difference is entirely in what the RIVAL gets, which
     * `outcome.ts` prices at 0 by standing rule. If that rule is ever relaxed,
     * this is the term where the two stop being the same thing.
     *
     * ⚠️ **THE BUILD LEG IS DELIBERATELY NEUTRAL AGAINST A HAND CARD.** A
     * dead-door meeple prices at 1 x 2.5 and a hand card at `handSpend` 2.5, so
     * a bot paying a build is INDIFFERENT between them, and a live-door meeple
     * prices at 1.6 x 2.5 so it prefers to keep that one and pay with the card.
     * That ordering is the whole of the instrument's opinion about R15, and it
     * was chosen because it does not manufacture the number the arm is being run
     * to read: no taste for or against paying in meeples, only the door option
     * the payment gives up.
     *
     * ⛔ **`grow` IS NOT CLAIMED AND MUST NOT BE.** A GROW is probed, so its
     * meeple is charged by `priceEvent`'s `meepleAsCard` case inside the
     * rollout. Adding it to `claims` would charge it twice. `meeplesLeavingSupply`
     * carries the same warning at the other end.
     */
    name: 'meepleSpend',
    claims: ['spendMeeple', 'visit', 'build', 'deliver'],
    feature: (act, s) => {
      if (act.a === 'spendMeeple') return -meepleWorth(s, act.colour);
      // The meeple-loop arm's visit, R15's build and delivery payments, and the
      // amended R6's toll. Every one of these lists is EMPTY under the `'card'`
      // game and under `meepleAsCard: false` / `slotToll: null`, so the whole
      // term collapses to the v1 arithmetic without reading a knob.
      let cost = 0;
      for (const colour of meeplesLeavingSupply(act)) cost += meepleWorth(s, colour);
      if (act.a === 'visit') for (const colour of act.toll) cost += meepleWorth(s, colour);
      return -cost;
    },
    cost: true,
  },

  // --- the coins (the commons-with-coins arm, K7-K15, 10/09/2026) -----------
  {
    /**
     * ⭐ **WHAT A COIN IS WORTH, AND THIS TERM'S MOVE-SIDE FEATURE IS ZERO ON
     * PURPOSE** (K3/K8, Dean 10/09/2026).
     *
     * The only mint in the game is clearing a central pile: `commonsTake` under
     * `rules.turn.commonsTake: 'coins'` discards the whole pile to its suits'
     * discards and pays one coin per card. That move is on `isProbed`, so what
     * it is worth arrives INSIDE THE ROLLOUT as `coinsMinted`, priced at this
     * weight by `outcome.ts`. Charging it here as well would pay the seat twice
     * for one pile - which is the exact trap `meepleSpent` names in that file,
     * and the same probed / unprobed split `meeplesLeavingSupply` is built on.
     *
     * So why does the term exist at all? Because `checkWeightTable` holds both
     * ways: every weight must name a real term and every term must have a
     * weight, and the pricer reads its numbers out of the same table by term
     * name (`weight(w, 'coinWorth')`). A term is how a number gets INTO that
     * table. It claims `commonsTake` rather than nothing, because that is the
     * move the number is about, and a reader who greps for where a coin is
     * earned should land on the mint's own move type.
     *
     * ⚠️ **IF A SECOND MINT IS EVER ADDED, THIS IS WHERE IT GOES** - and read
     * K7 first, because every earlier coin economy in this project died of a
     * second faucet.
     */
    name: 'coinWorth',
    claims: ['commonsTake'],
    feature: () => 0,
  },
  {
    /**
     * ⭐ **THE ENDGAME CARD'S COIN PRICE (K15, Dean 10/09/2026), AND IT IS
     * CHARGED HERE RATHER THAN IN THE PRICER FOR ONE REASON: A BUILD IS NOT
     * PROBED.**
     *
     * Under `rules.economy.endgameCoinCost` the fifteen Endgame cards cost that
     * many COINS and ZERO CARDS, so a build move for one carries an EMPTY
     * payment - and `handSpend`, `buildSpend` and `barnSpend` all read a payment
     * by count, so every one of them prices it at nothing. Left alone, an
     * Endgame card would be free to a bot holding three coins, it would take
     * every one it was offered, and a19's "coins spent on the Farmstead against
     * on Endgame cards" would be reporting this omission rather than the rules.
     *
     * The COIN-ACTIVATED FARMSTEAD (K10) is deliberately NOT charged here, and
     * the split is exactly the probed / unprobed line and nothing else - the
     * same rule `meeplesLeavingSupply` states in the other direction. A Grow is
     * on `isProbed`, so its `coinsSpent` event reaches `priceEvent` inside the
     * rollout of the very move that spent it and is charged there; charge it
     * here as well and the Farmstead would cost two coins in the bot's books
     * and never fire. A build is NOT on `isProbed`, so its `coinsSpent` never
     * reaches a pricer at all and this is the only place left to charge it.
     *
     * ⚠️ **THE TWO ROUTES ARE DISJOINT, WHICH IS WHY "EXACTLY ONCE" HOLDS.** A
     * build reached INSIDE a rollout (the dairy board's Build door, or the
     * Dairy Farmstead's own power) is a task resolved during another move's
     * probe, and its coin is charged by the event; a build chosen AS THE MOVE -
     * either spelling, the main action or the task answer - is scored by this
     * term and never rolled out. No decision can see both.
     *
     * ⛔ **STRUCTURALLY ZERO WHEN THE ARM IS OFF**: `endgameCoinCost` is null in
     * the shipped game and under both controls, so the guard returns before it
     * reads a card and the term cannot move a fixture.
     */
    name: 'coinSpend',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => {
      if (act.a !== 'build') return 0;
      const coins = endgameCoinCost(s.data);
      if (coins === null) return 0;
      return cardById(s.data, act.card).type === 'endgame' ? -coins : 0;
    },
    cost: true,
  },

  // --- the barn supply line -------------------------------------------------
  {
    /**
     * Cards into the barn, and since 09/09/2026 from either of two places.
     *
     * ⭐ **A CENTRAL PILE COUNTS EXACTLY AS A STACK DOES (C5)**, which is the
     * ruling stated in the bots' own currency: a harvest is worth the cards it
     * moves, and where they came from changes nothing about how many arrive. The
     * fallback runs only when `stackOf` finds nothing, so a building in the
     * seat's own tableau can never be double-read, and `commonsPileSize` is null
     * outside the commons so both controls price this line exactly as they did.
     *
     * ⚠️ **IT DELIBERATELY DOES NOT PREFER THE CENTRE, OR THE FARM.** A18 asks
     * whether the centre out-supplies the farm ("if the centre out-supplies the
     * building engine, the building engine is decoration"), and an instrument
     * with a taste either way would answer its own question. What separates the
     * two here is only the pile sizes, which is the rule.
     *
     * ⭐ **AND SINCE 11/09/2026 THE FALLBACK RUNS UNDER DEAN'S UNCLAIMED-BOARDS
     * VARIANT TOO, WHICH IS THE WHOLE REASON `commonsPileSize` WAS RE-POINTED.**
     * A central pile there may only be taken at `commonsHarvestMin` (3) or more,
     * by ANYBODY, so the engine simply does not offer a shallower one and this
     * feature never has to know the floor - it prices what the harvest moves,
     * which at three or more is three or more. ⚠️ **An owned Notice Board is
     * still a tableau harvest priced off `stackOf`**, and the two can never
     * collide: a suit is either one seat's or central, never both.
     */
    name: 'harvest',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'harvest' ? stackOf(s, act.building) || commonsPileSize(s, act.building) : 0,
  },
  {
    /**
     * The reference's second rule, and it is worth MORE in v31 than it was.
     * A clogged Notice Board used to shut the table's coin faucet; it now shuts
     * a DOOR - your suit's action, for every neighbour and, since self-visiting,
     * for you as well - and only a Harvest reopens it.
     *
     * It is also the pin for `clogOwnBoard` below: shutting your own door costs
     * exactly what reopening it pays.
     *
     * ⛔ **AND IT LOSES ITS SUBJECT UNDER THE `3+` RULE (S8, 11/09/2026), FOR
     * THE SAME REASON `clogOwnBoard` DOES AND OFF THE SAME BOOLEAN.** A board
     * that never blocks has no shut door to reopen: an owner's harvest of it is
     * an ordinary harvest, worth the cards it moves and nothing more, which
     * `harvest` above already pays at 1.5 a card. ⚠️ Leaving 6 here would have
     * been the instrument answering the design's own question - **a20, the
     * stall reading, counts how often a board sits at or above its threshold
     * unharvested**, and it is the reading S8's plus sign exists to earn. A
     * six-point standing reward for clearing your own board would have made the
     * stall rate a statement about this weight. Live again under
     * `-blocking-v1`, which is where a stall can actually happen.
     */
    name: 'unclogBoard',
    claims: ['harvest', ...ACTION_AND_TASK],
    // ⭐ **ANY BOARD OF THIS SEAT'S, NOT JUST ITS OWN SUIT'S** (Dean's
    // two-board fix, 11/09/2026). At two seats a seat holds two boards, either
    // can clog under `-blocking-v1` and either is reopened by harvesting it, so
    // this is a membership question. It was written as an identity test against
    // `s.noticeBoard` when that field named the only board there was; that
    // field now names the seat's OWN SUIT'S board specifically, so left alone
    // this term would have paid 6 for one of the two and nothing for the other.
    // `noticeBoards` holds one entry in every other game and none under the
    // commons, so no control moves.
    feature: (act, s) =>
      s.noticeBoardClogs && act.a === 'harvest' && s.noticeBoards.has(act.building) ? 1 : 0,
  },
  {
    name: 'grow',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'grow' ? 1 : 0),
  },
  {
    name: 'growCompletes',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'grow' && fillsBuilding(s, act.building) ? 1 : 0),
  },
  {
    // GROW's card payment was the one main-action cost with no term against it:
    // Build pays `buildSpend`, Deliver pays `barnSpend`, and growing was free.
    // Reading the actual card (rather than a flat -1) is what makes the bot pay
    // its junk into the stack, the same principle as `visitFeeJunk`. Your own
    // hand card, so no probe and no sight question.
    name: 'growSpend',
    claims: ['grow', ...ACTION_AND_TASK],
    // ⭐ A MEEPLE-PAID GROW HAS NO CARD TO RANK (R15), so this junk ordering has
    // no subject and returns 0. What the meeple COSTS is charged inside the
    // rollout by `priceEvent`'s `meepleAsCard` case, because a GROW is probed -
    // see `meeplesLeavingSupply` for why that is the whole rule.
    feature: (act, s) =>
      act.a === 'grow' && act.payment !== null ? -cardValue(s.data, act.payment) : 0,
    cost: true,
  },
  {
    /**
     * GROW WITHOUT PLACING (A5, A12). A flat taste for firing something, and
     * deliberately SMALL: the real value comes through `outcome`, because
     * `isProbed` rolls the activation out. Nothing is spent - no card, no stack
     * - so there is no cost term to pair with it.
     *
     * ⚠️ Keep it low. A high flat weight here would have the bot picking a
     * target for the label rather than the payoff, which is the failure mode the
     * probe exists to prevent.
     */
    name: 'activate',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'activate' ? 1 : 0),
  },
  {
    /**
     * ⚠️ HAND SOWS ONLY, AND `deckSow` IS A STANDING BLIND SPOT. A sow off a
     * deck top (A13, W7, and a deck-sow door if the Apiary board is ever dialled
     * that way) scores nothing here and nothing anywhere else, so the bot takes
     * it over `skip` at -1 and then picks its target by random tie-break. That
     * predates v31 and is left alone on purpose: fixing it in the same pass as
     * the rules change would make the delta unattributable.
     */
    name: 'sow',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'sow' ? 1 : 0),
  },
  {
    name: 'sowCompletes',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'sow' && fillsBuilding(s, act.onto) ? 1 : 0),
  },

  // --- the tableau ----------------------------------------------------------
  {
    name: 'build',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'build' ? 1 : 0),
  },
  {
    name: 'buildVp',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' ? cardById(s.data, act.card).printedVp : 0),
  },
  {
    /**
     * ⭐ **THE FARMSTEAD'S OWN-SUIT VP** (v31) - *"Game end: 1 VP for each CROP
     * card you have built"*, printed on all five Farmsteads, on top of each
     * card's own printed VP.
     *
     * This is a STANDING TERM ON EVERY BUILD, not an end-game surprise, and that
     * is exactly why it needs a term: the payoff is decided at the moment a card
     * is chosen, and a bot that only met it at scoring time would never have
     * built toward it. Unpriced, **risk 3 of the whole pass - the monoculture
     * pull - would measure as ABSENT when it was only invisible**, and the
     * own-crop build share (82.6% before the change) would look like a bot taste
     * rather than a rule.
     *
     * ## What it reads, and why not `mySuit`
     *
     * The FARMSTEAD's printed crop, and only while the Farmstead is on the
     * table. The two cannot differ today - a Farmstead is a starter, so it is
     * only ever in front of the seat that plays its suit - and keying off the
     * card is what keeps that a fact rather than an assumption. Deck cards only:
     * `cropOf` says a starter prints no crop, so a starter counts neither for
     * its crop nor against it, and a build is never a starter anyway.
     *
     * Every deck card of the crop counts, not just the buildings - a Power card
     * and an Endgame card print their crop icon like anything else - because
     * that is what the handler does.
     *
     * ## The weight is a PIN, not a taste
     *
     * 1 VP through this door is 1 VP through any other, so it takes `buildVp`'s
     * weight and moves with it. That distinction is the whole point of splitting
     * it from `buildOwnCrop`, which sits right below and IS a taste: after this
     * change the reference bot's preference for its own crop is the rule's, and
     * a profile that wants more than the rule pays has to say so out loud.
     */
    name: 'farmsteadVp',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'build' && s.farmsteadCrop !== null && suitOf(s.data, act.card) === s.farmsteadCrop
        ? 1
        : 0,
  },
  {
    /**
     * A profile's loyalty to the crop it was DEALT, over and above what the
     * rules pay for it.
     *
     * ⚠️ **ZEROED IN THE REFERENCE TABLE FOR v31**, and that is a deliberate
     * change to the instrument rather than a tidy-up. Its comment has carried a
     * warning since 2026-08-12: the Farmstead's free flip was retired and this
     * weight was left "preferring something the rules no longer pay for". v31
     * makes the rules pay for it again - 1 VP a card - and `farmsteadVp` above
     * prices exactly that. Leaving 2 here as well would have the reference bot
     * chasing its own crop for a rule AND for a taste, and then reporting the
     * result as risk 3's own-crop build share. That is ticket 40's sin in one
     * line: a weight we chose manufacturing the number an assertion reports.
     *
     * Kept as a live knob rather than deleted, exactly as `visit: 0` is:
     * `loyalist` raises it to express a taste ABOVE the rule (the upper bound on
     * risk 3), and `magpie` vetoes it at -100 (the control that asks whether the
     * suit is load-bearing at all).
     */
    name: 'buildOwnCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' && suitOf(s.data, act.card) === s.mySuit ? 1 : 0),
  },
  {
    /**
     * The magpie's build: the strongest seated crop that is not its own.
     *
     * Weighted 0 everywhere but `magpie`, so it is inert in the reference and
     * the four archetype mirrors.
     */
    name: 'buildTargetCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'build' && s.targetSuit !== null && suitOf(s.data, act.card) === s.targetSuit
        ? 1
        : 0,
  },
  {
    /**
     * Which cards pay for a build - the junk ordering the build never had
     * (ticket 47).
     *
     * This used to read `-(payment.length + coinWild)`, which cannot order a
     * build's payments at all: the engine holds
     * `payment.length + stacks === cardsNeeded`, so for one built card that sum
     * is a CONSTANT. Measured over 262 real builds it varied across the
     * alternatives 2 times - so 23.7% of builds had a real choice of which cards
     * to burn and the term was blind to every one of them, leaving the pick to
     * the evaluator's random tie-break.
     *
     * So it becomes what its siblings already are - `visitFeeJunk`, `growSpend`,
     * `cardMoveSpend`, all `+0.3` on a `-value` feature - and the build's SIZE
     * stays charged where it always really was, by `handSpend`.
     *
     * Unlike a GROW's payment (which must match the activation suit, so every
     * legal payment is the same suit and differs only as cards), a build's wild
     * half takes any suit - so the alternatives here differ in suit as well as
     * value, and paying the junk is the whole of the choice.
     */
    name: 'buildSpend',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' ? -totalValue(s.data, act.payment) : 0),
    cost: true,
  },

  // --- the hand -------------------------------------------------------------
  {
    /**
     * The plain Draw action, worth the cards it ACTUALLY KEEPS - the printed
     * keep, capped by the room left under the hand limit.
     *
     * ⭐ **IT SCALES BY ROOM AGAIN (02/09/2026), AND THAT IS THE POINT OF THE
     * WHOLE CHANGE.** The absence of this cap is the bot-side half of why the
     * hand limit came back: with no ceiling a card in hand always priced at a
     * full card, so drawing never got worse and the free bonus Draw 1 became
     * strictly dominant, beating a neighbour visit 3:1 and failing the hook
     * assertion. A ceiling is what makes the tenth card worth less than the
     * second, and a diminishing return on drawing is what makes a neighbour's
     * farm worth walking to.
     *
     * ⚠️ **THE SHAPE IS NOT THE ONE THAT WAS DELETED, ON PURPOSE.** Before v31
     * this feature was the raw ROOM (0 up to the limit), which worked while
     * limits were 5-7 and the base Draw kept 1. The limit is 12 now and the base
     * Draw keeps 2, so raw room would price an empty-handed Draw at 12 x 1.2 =
     * 14.4 and drown every other move on the menu. `min(keep, room)` is the
     * honest statement instead - a draw is worth the cards that survive to your
     * next turn - and it agrees with `pendingDrawValue`, which caps the same way.
     *
     * ⚠️ **THE -1 FLOOR IS DELIBERATE AND IS NOT A TYPO.** It arrived on
     * 19/08/2026 as the fix for a real deadlock: two 2-seat games in six ran to
     * the 6000-move ceiling because a full hand priced a draw at 0, and zero is
     * not a penalty when every productive move on the menu is negative, it is
     * the argmax. From `--explain` on seed `end-2-5` at turn 241: a Wheat seat
     * holding five Tier 3 cards it could not afford, hand limit five, no
     * non-full building to GROW. Its whole menu priced out as `draw` 0.00, five
     * `grow`s at -0.60, five `visit`s at -1.60 - every one of them a way OUT of
     * the position. So it drew, kept one, discarded one at -2.20, and did it
     * again for a thousand turns. **It paid 2.20 to throw away the card it would
     * not pay 2.50 to spend.** The floor says "churning your hand is worse than
     * doing something", in the units this term already uses, and needs no new
     * weight. At a limit of 12 rather than 5 the deadlock is much further away,
     * but the floor costs nothing and its absence cost two games.
     */
    name: 'drawAction',
    claims: ['draw'],
    feature: (act, s) =>
      act.a === 'draw'
        ? s.handRoom > 0
          ? Math.min(s.data.rules.turn.baseDraw.keep, s.handRoom)
          : -1
        : 0,
  },
  {
    /**
     * THE BONUS SLOT'S SOLITAIRE HALF (v31): a free Draw 1, taken instead of
     * placing a card on a Notice Board.
     *
     * It is the yardstick every door has to beat, and pricing it wrong bends
     * risk 2 in whichever direction the error points, so the weight is PINNED to
     * `drawAction`: a card drawn is a card drawn, whichever door it came
     * through, and the only difference between this and the plain Draw is how
     * many cards arrive. Nothing here expresses a taste for the slot itself -
     * ticket 40 measured what a flat taste for spending the bonus slot does, and
     * it manufactured the exact traffic the hook assertion counts.
     *
     * ⭐ CAPPED BY ROOM IN HAND (02/09/2026), like `drawAction`, and for the
     * reason the hand limit came back at all: a free card into a hand that will
     * discard it at the boundary is not a free card. This is the term that
     * decides risk 2, so it is the one place the diminishing return matters most.
     *
     * ⚠️ NO -1 FLOOR HERE, and the asymmetry is deliberate. `drawAction`'s
     * floor exists because a MAIN ACTION must be spent on something, so 0 can be
     * an argmax in a position where every alternative is negative. A bonus slot
     * may simply be left unspent at 0, so a full hand already declines this
     * option without being pushed - and a negative would push the bot towards
     * SLOT UNSPENT, which is one of the four numbers the watch-list reads.
     *
     * ## ⭐ IT IS ALSO **COLLECT's** DRAW (the meeple-loop arm, R7, R9)
     *
     * The arm deletes the standalone free Draw 1 and attaches the same
     * `rules.turn.bonusDraw` cards to Collect instead, so the NUMBER survives
     * the rule and this term follows it. That is the honest mapping and not a
     * convenience: *"collect an empty board"* is Draw 1 wearing a different move
     * type, and the arm's own bonus mix counts it as the solitaire line for
     * exactly that reason. Pricing it at any other rate would put a thumb on the
     * one comparison the whole arm exists to make.
     *
     * ⭐ **IT IS ONLY HALF OF A COLLECT'S PRICE.** The other half - the meeples
     * coming home, after the cap - is `meepleGain`'s, and a Collect on a busy
     * board therefore beats a Collect on an empty one by exactly the stored
     * actions it recovers. The two terms together are what make "the host is
     * paid for being visited" visible to a bot at all; either one alone reports
     * the arm as half a design.
     *
     * ⚠️ THE HAND-ROOM CAP APPLIES TO BOTH AND IS THE ARM'S ONE ASYMMETRY: a
     * Collect into a full hand is worth its meeples and no draw, where a Collect
     * into an empty one is worth both. That is the right shape - the draw really
     * is worthless at the limit - but it means the arm's solitaire line goes to
     * zero at a full hand where the v31 free Draw 1 did too, so the two arms stay
     * comparable on that axis.
     */
    name: 'bonusDraw',
    claims: ['bonusDraw', 'collect'],
    feature: (act, s) =>
      act.a === 'bonusDraw' || act.a === 'collect'
        ? Math.min(s.data.rules.turn.bonusDraw, s.handRoom)
        : 0,
  },
  {
    name: 'deckOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && act.suit === s.mySuit ? 1 : 0),
  },
  {
    /** The magpie's acquisition lane. 0 in every other profile. */
    name: 'deckTargetCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) =>
      act.a === 'deckPick' && s.targetSuit !== null && act.suit === s.targetSuit ? 1 : 0,
  },
  {
    /**
     * **Measured dead** (ticket 53), and left in place.
     *
     * Deleting it outright changes the bot's top move in **0 of 4650** decisions
     * offering a deck pick, over 55 stratified games. It is 0.8 against
     * `deckOwnCrop`'s 1.0 and a seat's own deck is in play whenever the seat is,
     * so the own deck wins outright: taken on 83.9% of deck picks, with the own
     * deck on offer in exactly 83.9% - it is taken every single time it is
     * available. In the remaining 16.1% every deck still on offer is demanded,
     * so the term is uniform there too and cannot order those either.
     *
     * Not deleted, because the finding is not "this weight is wrong" but "the
     * Draw never varies", which is a question about the instrument's whole
     * acquisition lane. ⚠️ v31 gives it more to do than it had: the base Draw is
     * see 2 keep 2 off any two decks, so a draw is now purely a choice of WHICH
     * decks, with no keep decision behind it to absorb the error.
     */
    name: 'deckDemand',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && s.demandSuits.has(act.suit) ? 1 : 0),
  },
  {
    /**
     * Which cards a see/keep draw keeps.
     *
     * ⚠️ MOSTLY INERT IN v31 AND KEPT ANYWAY. The base Draw is see 2 keep 2 and
     * the Orchard door is see 3 keep 3, so almost every draw in the game now
     * keeps everything and offers exactly one keep answer. It still fires for
     * any card that reveals more than it keeps, and it is what the pricer uses
     * to value a pending draw analytically, which is a much hotter path.
     */
    name: 'keepValue',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? totalValue(s.data, act.cards) : 0),
  },
  {
    name: 'keepOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? countOwnCrop(s, act.cards) : 0),
  },
  {
    /**
     * The junk rank, negated: the cheapest discard scores highest. Back with the
     * turn-boundary overflow (02/09/2026).
     *
     * ⚠️ It orders the choice and must never price the EVENT. The seat has no
     * say in whether it discards, only in which cards go, so a term that made
     * discarding look expensive would be charging for something nobody chose -
     * and `drawAction`'s deadlock is what that did last time it happened by
     * accident.
     */
    name: 'discardJunk',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'discard' ? -totalValue(s.data, act.cards) : 0),
    cost: true,
  },
  {
    /** Which of a Draw's cards the magpie keeps. 0 in every other profile. */
    name: 'keepTargetCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? countTargetCrop(s, act.cards) : 0),
  },

  // --- the bonus slot: the two doors ----------------------------------------
  {
    /**
     * **A VISIT TO A NEIGHBOUR is worth its payoff and nothing else** (Dean,
     * ticket 40), which is why the default weight is 0 rather than absent.
     *
     * The flat 6 used to BE the visit's value, coin payoff included. `outcome`
     * now prices the payoff where the payoff is, and the first measured build
     * left 2 behind as an intrinsic taste for spending the free bonus slot. That
     * constant turned out to be doing real damage: at `visit: 2` the bots took
     * coin visits whose marginal coin they valued at exactly zero in **70.4%**
     * of cases - the slot is free, the fee is junk, so a worthless visit still
     * beat leaving the slot unused.
     *
     * Which made it the wrong number to leave in the instrument, because the
     * hook assertion counts visits per turn as the design's own "did players
     * watch each other" metric. A weight we chose was manufacturing the traffic
     * that metric measures. Measured at 0 against 2: visits/turn 0.443 -> 0.368,
     * and every remaining visit buying something.
     *
     * ⭐ **THAT ARGUMENT IS WHY `selfVisit` BELOW IS ALSO 0.** Risk 2 asks which
     * of the two doors a table takes when both cost one card out of one slot.
     * The only way the answer means anything is if the instrument has no
     * preference between them, so both flat tastes are zero and the whole
     * difference the bots see is the difference the rules make: which door the
     * board grants, and whether the card clogs a board you need.
     */
    name: 'visit',
    // ⭐ IT CLAIMS THE COMMONS PLAY TOO (09/09/2026), and the claim is what
    // makes `hermit` and `socialite` mean anything under the shipped default.
    // A commons play is this term's subject in every sense that survived the
    // host: it is the cross-table half of the bonus slot, it is the move
    // `a18-commons-traffic` counts, and it is the only thing a profile with a
    // taste for using the table could have a taste FOR.
    claims: ['visit', 'commons'],
    // ⚠️ `!act.self` HAS NO COMMONS TWIN AND NEEDS NONE. There is no host, so
    // there is no solitaire branch sharing the slot to exclude - the whole of
    // C9 is that the slot holds one option. A commons play is therefore always
    // "the cross-table one" and always scores 1.
    feature: (act) => (act.a === 'commons' || (act.a === 'visit' && !act.self) ? 1 : 0),
  },
  {
    /**
     * ⭐ **THE SELF-VISIT - RISK 2 OF THE WHOLE PASS, ARMED ON PURPOSE.**
     *
     * v31 lets a seat place its bonus card on its OWN Notice Board and take its
     * own suit's action. That is a solitaire door bought with the same currency,
     * out of the same slot, as the interaction door - and the plan's own words
     * are that *"every previous version of this game has had the solitaire
     * option crowd out the visit when the two competed in one slot"*.
     *
     * It gets its own weight, separate from `visit`, for one reason: **the sim
     * must be able to tell them apart**. `a08-the-hook` counts self-visits
     * separately and must never credit one as interaction, and a bot that scored
     * both through one weight could not be pointed either way - there would be
     * no hermit control worth running.
     *
     * At 0 in the reference, for the reason spelled out on `visit` above. The
     * two things that actually separate the doors in the bots' eyes are both
     * rules: `outcome` prices whichever door the host's suit grants, and
     * `clogOwnBoard` charges for shutting your own.
     *
     * ## ⛔ THE ZERO IS LOAD-BEARING AGAIN (11/09/2026), AND THIS IS WHAT IT
     * ASSERTS
     *
     * It was a dead knob under the commons: no board belongs to anybody, so
     * "your own board" named nothing and `act.self` was false for every visit
     * the engine could enumerate. S6 rules self-use back IN - you may play your
     * card onto your OWN Notice Board and take your own board's power - so the
     * term has a subject for the first time since 03/09/2026, and a weight of 0
     * is now an assertion about how the arm's headline number gets made.
     *
     * **WHAT THE ZERO ASSERTS: the bot is INDIFFERENT between visiting itself
     * and visiting a rival, and decides purely on which power it wants.** Every
     * self-visit in the report is therefore a seat that wanted the Draw 4, or
     * the waived Build, or the Harvest-plus-a-card, and found it on its own
     * board; not one of them is a taste this file put there.
     *
     * ⚠️ **AND THAT MATTERS MORE HERE THAN IT HAS EVER MATTERED, BECAUSE THE
     * SELF-VISIT SHARE IS THE HEADLINE RISK OF THE ENTIRE PASS** (§2.4, §5 of
     * the handoff). v31 read 22.2% of turns when every board printed the SAME
     * thing, and self-visiting was banned within two days. S6's whole argument
     * for reversing that ban is VARIETY: five boards print five different
     * powers, so your own board is one option of five and it is the one that
     * never has what you have not got. **If the share runs high anyway, the
     * variety argument is wrong, the interaction is decoration and the design
     * has failed in the way v31 failed.** A bot with a thumb on either side of
     * that scale corrupts the one number the pass is for - a positive weight
     * manufactures the failure, a negative one hides it - so the weight is 0 and
     * `overlays/notice-board-visit-no-self-v1.overlay.json` is the control that
     * answers the question with a RULE instead.
     *
     * ## WHY 0 IS DEFENSIBLE AS A *STARTING* POSITION AND NOT AS A FINDING
     *
     * Because it is the only value that lets the rules speak. It is the same
     * argument ticket 40 made for `visit`, measured rather than asserted: at
     * `visit: 2` the bots took visits whose payoff they valued at exactly zero
     * in 70.4% of cases, and the hook assertion was counting traffic the weight
     * table had manufactured. A flat taste in the bonus slot has been measured
     * to lie once, and the reading it lied about is this one.
     *
     * ⚠️ **WHAT WOULD OVERTURN IT, and it is a real asymmetry the zero does NOT
     * model: a self-visit is CHEAPER than a rival visit, because you harvest
     * your own fee back.** `handSpend` charges 2.5 for the card either way and
     * nothing credits the return leg, so the bots currently under-rate the
     * self-visit by roughly what `hostGift` charges a rival one - about 1.3
     * points, measured. Two readings would overturn the zero and both are
     * runs rather than arguments:
     *
     *   - **the self-visit share against the `-no-self-v1` control.** If the arm
     *     and the control read the SAME on interaction (visits received per
     *     player, the visit spread, the bonus rate, game length), self-use is
     *     costing the table nothing and the zero stands. If the arm's
     *     interaction collapses against the control, the bots are already
     *     self-visiting more than the design can afford and the question of a
     *     taste weight does not arise - the RULE is what needs changing.
     *   - **a paired sweep of this weight** at, say, -1 / 0 / +1 with nothing
     *     else moved, read on the self-visit share. If the share barely moves,
     *     the zero is free and the rules are deciding; if it swings the way
     *     `coinWorth` swung the Farmstead's fire rate (32x), then this table -
     *     not the design - owns the pass's headline, and the number has to be
     *     measured the way `hostGift` and `coinWorth` were.
     *
     * ⚠️ A sweep of it is an EDIT AND A REBUILD, not an overlay: `weightsFor`
     * takes a profile id and nothing else (the ledger's C45). `socialite`
     * already carries `selfVisit: -3` and `visit: 8`, which brackets the
     * reading from one side; nothing brackets it from the other.
     */
    name: 'selfVisit',
    claims: ['visit'],
    // ⛔ NO SUBJECT AT ALL UNDER THE COMMONS (09/09/2026), and one step further
    // gone than it is under the meeple arm. There a self-visit is a shape the
    // rules refuse (X5); here the boards belong to nobody, so "your own board"
    // names nothing in the game and the ACT does not carry a `self` flag to
    // read. Left claiming `visit` only: risk 2 is a question about a game with
    // hosts, and the term is the CONTROLS' instrument now.
    // ⭐ AND IT HAS A SUBJECT AGAIN UNDER THE NOTICE-BOARD VISIT (S6,
    // 11/09/2026) WITH NO CHANGE TO EITHER LINE. The arm reuses the `visit`
    // move and `actOf` derives `self` from `host === seat` exactly as it did
    // under v31, so the claim and the feature were already right; what changed
    // is that the engine enumerates a self-visit again. VERIFIED by running the
    // arm rather than by reading the code.
    // ⛔ ALWAYS ZERO UNDER THE MEEPLE-LOOP ARM, BY THE RULE AND NOT BY A GUARD.
    // X5 removes the self-visit under any flag, so `act.self` is false for every
    // visit the engine will ever enumerate there and this feature never fires.
    // Left exactly as it is: the term is the CONTROL arm's instrument, and one
    // of the arm's own claims is that this reads 0 - which `a08-the-hook` should
    // assert rather than assume, and which a special case here would make
    // unfalsifiable.
    feature: (act) => (act.a === 'visit' && act.self ? 1 : 0),
  },
  {
    /**
     * ⭐ **THE DOOR IS A WHOLE EXTRA ACTION, AND UNTIL 03/09/2026 NOTHING PAID
     * FOR THAT** (Dean). This term reverses half of ticket 40 on purpose, and
     * the half it reverses is the half that was wrong.
     *
     * Ticket 40 ruled that "a visit is worth its payoff and nothing else" and
     * set `visit` and `selfVisit` to 0, because a FLAT taste for spending the
     * slot manufactured the very traffic `a08-the-hook` counts: at `visit: 2`
     * the bots took visits they valued at exactly zero in 70.4% of cases. That
     * finding stands and this term does not undo it.
     *
     * What ticket 40 got wrong is the arithmetic underneath. In the shipped
     * table a card leaving hand costs `handSpend` 2.5 and the free Draw 1 pays
     * `bonusDraw` 1.2, so a door had to roll out above **3.7** before a bot
     * would take it over the solitaire option - and a one-ply rollout prices
     * only the goods an action produces, never the fact that it IS an action.
     * Dean, 03/09/2026: *"there has to be a value placed on having an extra
     * action. This can be very powerful. Another way of looking at it is to see
     * that the Draw 1 option is only worth half an action."*
     *
     * So the anchor is his: `drawAction` pays 1.2 a card for a Draw 2, which is
     * **2.4 for one whole action**, and `bonusDraw` pays 1.2 for exactly half of
     * one. The default weight here is that same 2.4.
     *
     * ⚠️ **IT FIRES ONLY ON A DOOR THAT ACTUALLY DOES SOMETHING** - a strictly
     * positive rollout - which is the guard that keeps ticket 40's finding
     * intact. A Harvest door with nothing full, a Deliver door with an empty
     * barn and a Build door with nothing affordable all roll out at zero or
     * less, earn nothing here, and stay untaken. The flat taste ticket 40 killed
     * paid for those; this does not.
     *
     * ⚠️ **DELIBERATELY BLIND TO WHICH DOOR IT IS**, self or rival. Risk 2
     * asks which of the two a table takes when both cost one card out of one
     * slot, and that question only means anything if the instrument has no
     * preference between them. `visit` and `selfVisit` both stay at 0 above; the
     * whole difference the bots see is still the rules' - which door the board
     * grants, and whether the card shuts a board they need.
     *
     * ⚠️ **IT DOUBLE-COUNTS BY CONSTRUCTION AND THAT IS THE OPEN QUESTION.**
     * `outcome` already prices the door's goods; this pays the action premium on
     * top. The claim being tested is that a greedy one-ply rollout underprices
     * an action by about the value of an action, because it cannot see
     * compounding. The claim could be wrong, or 2.4 could simply be too much -
     * so the weight is a knob with a control arm at 0, which reproduces the
     * pre-03/09/2026 bots exactly. Sweep it before believing any hook number
     * that moves under it.
     */
    name: 'bonusAction',
    claims: ['visit', 'commons'],
    // ⭐ AND IT IS DUE ON A COMMONS PLAY (09/09/2026), for the reason it is due
    // on a visit: the board buys a whole core action, the fee is EXTRA in every
    // case (C3), and a one-ply rollout prices the goods an action produces and
    // never the fact that it IS one. The guard is the same and does the same
    // work - a Harvest board with nothing full, a Deliver board with an empty
    // barn and a Build board with nothing affordable roll out at zero or less,
    // earn nothing, and stay untaken. ⚠️ That guard is now load-bearing on
    // Dean's own verdict band (a17 FAILs outside 30-60% of turns): this is the
    // one weight in the table that could manufacture a play rate, and 0 is its
    // control arm.
    // ⭐ UNCHANGED BY THE MEEPLE-LOOP ARM, ON PURPOSE. A visit still buys a
    // whole core action, whatever paid for it, so the premium still fires and
    // still only on a door that resolves something. It does NOT fire on Collect:
    // Collect buys a Draw 1, which is half an action by the same anchor Dean set
    // this weight with, and `bonusDraw` already pays exactly that half. Paying
    // an action premium on the arm's solitaire line would hand the bonus mix
    // back the answer it was built to measure.
    feature: (act, _s, move, o) =>
      (act.a === 'visit' || act.a === 'commons') && isProbed(act) && o.value(move) > 0 ? 1 : 0,
  },
  {
    /**
     * ⭐ **THE ONLY BRAKE ON SELF-VISITING** - your own fee counts toward your
     * own threshold of 2, so the second card you feed your own board shuts your
     * own door, locks every neighbour out of your suit's action, and costs you a
     * whole Harvest action to reopen.
     *
     * The plan names this as the single structural check on risk 2, so a bot
     * that could not see it would over-self-visit and the arm would report a
     * hook failure the rules had actually guarded against. It fires only on the
     * card that FILLS the board, which is exactly when the door shuts: at
     * threshold 2, the first self-visit of a cycle really is free and the second
     * really is not.
     *
     * The weight is a PIN to `unclogBoard`: shutting your own door costs what
     * reopening it pays. No new constant, and the two move together.
     *
     * ⚠️ It fires on YOUR OWN BOARD ONLY, and the omission is deliberate.
     * Clogging a NEIGHBOUR's board denies them their own door, which is the
     * denial play v30's Helping Hand used to enable - but `outcome.ts`'s
     * standing rule is that this bot prices what it gains and never rival harm,
     * so the denial value of a visit is invisible here and always has been.
     * Whether that lands as clever or as the predecessor's "reverse
     * engine-building" resentment is a table question.
     */
    name: 'clogOwnBoard',
    claims: ['visit'],
    // ⛔ NO SUBJECT UNDER THE COMMONS EITHER, and this time by TWO rules rather
    // than a coincidence: no board is yours (C1) and no board can ever fill (C4,
    // "no threshold, never full, never clogged"). `s.noticeBoard` is null there
    // because no Notice Board is dealt into a tableau at all, so the existing
    // null guard already answers 0 - it is named here so that a future session
    // reading "the only brake on self-visiting" does not go looking for the
    // brake in a game with nothing to brake.
    feature: (act, s) => {
      // ⛔ NO SUBJECT UNDER THE MEEPLE-LOOP ARM, AND THE GUARD IS EXPLICIT
      // RATHER THAN INCIDENTAL. Three separate things already make this dead
      // under the arm - there is no self-visit at all (X5, so `act.self` is
      // false by construction), no card is placed on a board, and the board is
      // not a building so `thresholdOfView` returns null and `fillsBuilding` is
      // false. Any ONE of them would be enough, which is exactly why the flag is
      // read here: a term whose zero depends on three coincidences is a term
      // that comes back to life the first time one of them is relaxed, and this
      // one is pinned to `unclogBoard` at 6, the largest cost in the table.
      if (s.meepleArm) return 0;
      // ⛔ NO SUBJECT UNDER THE `3+` RULE EITHER (S8, 11/09/2026), AND THIS
      // GUARD IS THE MOST CONSEQUENTIAL LINE THE NOTICE-BOARD PASS ADDED TO
      // THIS FILE. Three is the MINIMUM before the owner may harvest and never
      // a maximum load: cards may always be added, nothing ever blocks, and no
      // owner can shut a board by declining to harvest. So the card that brings
      // your own board to three shuts NOTHING - it makes the board harvestable,
      // which is a good thing for you - and charging 6 for it would have put
      // the largest cost in the table on exactly the move whose share is the
      // pass's headline reading. The bots would have refused self-visits for a
      // reason the rules deleted, and the report would have read "self-use is
      // rare" as a fact about this line.
      // ⭐ TRUE UNDER `-blocking-v1`, WHERE THE BRAKE IS REAL AGAIN. That
      // sub-arm sets `noticeBoardBlocks: true` and asks whether a clogging
      // board stalls the way the predecessor's did; the whole point of it is
      // that the board behaves like v31's, and this term is half of what v31
      // meant by that.
      if (!s.noticeBoardClogs) return 0;
      if (act.a !== 'visit' || !act.self) return 0;
      // ⭐ **THE BOARD THE FEE ACTUALLY LANDS ON** (Dean's two-board fix,
      // 11/09/2026). `act.board` is present only when the host holds more than
      // one, so at three and four seats and under every control this is
      // `s.noticeBoard` exactly as it was; at two seats a self-visit may fill
      // EITHER of the seat's boards and only the named one is the one that
      // shuts. Reading the field instead would have charged the cost against
      // the wrong stack and, at the wrong moment, against the wrong threshold.
      const target = act.board ?? s.noticeBoard?.card;
      if (target === undefined) return 0;
      return fillsBuilding(s, target) ? -1 : 0;
    },
    cost: true,
  },
  {
    /**
     * ⛔ **WHAT THE HOST GETS - THE LEDGER'S C64, AND THE FIRST TIME THIS
     * PRICER HAS EVER KNOWN THAT A MOVE PAYS SOMEBODY ELSE** (11/09/2026, S7).
     *
     * The standing rule in `outcome.ts` is that this bot prices what it gains
     * and never rival harm, and the whole file has been built on it. That rule
     * is exactly right for a game where the cross-table act is a denial, and it
     * is exactly WRONG for this one: **the card you pay rests on the host's
     * Notice Board until the host harvests it into their barn, and that is the
     * host's entire payment.** A pricer blind to it takes every visit whose
     * power it wants and never once asks who it is feeding - which is the
     * sentence the watch-list has carried through three designs running: *"no
     * bot has ever declined to help a leader."* Until this term existed, every
     * "would a human decline this visit?" reading was a reading about a blind
     * bot.
     *
     * ## WHAT IT IS, AND THE THREE THINGS IT DELIBERATELY IS NOT
     *
     * A flat COST of one gift per visit to a RIVAL, and nothing on a self-visit
     * (S6): your own fee lands on your own board and you harvest it back, so
     * nobody is fed.
     *
     * ⚠️ **IT DOES NOT DOUBLE-COUNT `visitFeeJunk` OR `handSpend`, AND THE
     * SPLIT IS THE TWO ENDS OF ONE CARD.** `handSpend` charges 2.5 for the card
     * LEAVING YOUR HAND, which is a loss you take whichever board it goes to;
     * `visitFeeJunk` only ORDERS which of your cards goes (its own header:
     * "not an economic estimate"). This charges the card ARRIVING IN A RIVAL'S
     * STORE, which is a separate fact about a separate seat, and it is zero on
     * the one move - the self-visit - where the card arrives nowhere but home.
     *
     * ⛔ **IT DOES NOT SCALE WITH THE HOST'S BOARD SIZE, AND THAT IS MEASURED
     * RATHER THAN CHOSEN.** The obvious refinement is that a card added to a
     * board sitting at 2 completes the `3+` minimum and can be cashed at once,
     * where a card added to an empty board may never be cashed at all. Over
     * **32,478 rival placements** the realisation rate is FLAT: **82.4%** onto
     * an empty board, **84.5%** onto one card, **85.7%** onto two and **83.4%**
     * onto three or more.
     * The reason is S8 - a board never blocks, so a fee is never stranded by a
     * clog, and what strands one is the game ending rather than where it
     * landed. A scaling factor would have added a feature the rules do not
     * have. (Under `-blocking-v1` that may stop being true, and the bucket
     * table is the reading that would say so.)
     *
     * ⚠️ **AND IT IS NOT STANDING-SENSITIVE, WHICH IS A JUDGEMENT AND IS
     * FLAGGED AS ONE.** See `HOST_GIFT_LEADER_TILT` below.
     *
     * ⛔ **STRUCTURALLY ZERO OUTSIDE THE ARM, AND THAT COSTS SOMETHING REAL.**
     * The v31 `'card'` visit ALSO puts a card on a neighbour's board that the
     * neighbour harvests, so this term has a genuine subject there and is shut
     * anyway. The reason is the standing rule that a weight moved in the same
     * pass as a rule makes every delta a mixture of the two:
     * `overlays/v31-card-visit.overlay.json` is the control this arm's
     * self-visit share is read against (22.2% is the only prior number there
     * is), and a control that moves is not a control. ⚠️ **So the v31 column
     * of any comparison is a BLIND bot and the notice-board column is not.**
     * Say so in the write-up. Re-arming it for `'card'` is one `||` away the
     * day somebody wants the control re-cut deliberately.
     *
     * ## ⛔ WHAT IT DOES ON EACH OF THE TWO MOVE KINDS UNDER DEAN'S
     * UNCLAIMED-BOARDS VARIANT (11/09/2026), STATED EXACTLY
     *
     * Both kinds are live at once under
     * `overlays/notice-board-visit-unclaimed-v1.overlay.json` and they share one
     * bonus slot, so this is the term that decides the pass's headline split:
     *
     *   - **on a `visit` move (a play onto a RIVAL's board): it charges -1.5,
     *     exactly once, on every one of them.** `s.noticeBoardArm` is true
     *     (`isNoticeBoardPower`), `act.self` is false for every visit the engine
     *     will ever enumerate because `rules.turn.selfVisitAllowed` is false, and
     *     `act.fee` is non-null because a notice-board visit always pays a card.
     *     So the self-visit branch, which was half of this term's shape
     *     yesterday, has **no subject** here and the term reduces to a flat
     *     charge per rival visit.
     *   - **on a `commons` move (a play onto a CENTRAL board): it reads exactly
     *     ZERO, on the `act.a !== 'visit'` line, and that is the RULE rather
     *     than a guard.** A central board is in nobody's tableau, belongs to
     *     nobody and is harvestable by anybody at three or more, so the card is
     *     handed to no seat and there is nothing for a gift term to price. ⚠️
     *     `claims` is deliberately NOT widened to `'commons'`: claims are a
     *     documentation contract asserted against `MOVE_TYPES`, not a runtime
     *     gate (every feature runs on every move, see `evaluator.ts`), and a
     *     claim for a move type this term scores zero on would be a lie in the
     *     one place a reader checks first.
     *
     * ⭐ **AND IT MUST NOT BE NEUTERED TO MAKE THE DESIGN LOOK BETTER.** The
     * -1.5 asymmetry IS the variant's headline risk expressed as arithmetic: a
     * central board is socially free and a rival's board is not, so a bot with
     * this term standing has a 1.5-point standing preference for the centre.
     * **That is the incentive the rules create and the instrument's job is to
     * feel it**, not to be talked out of it - and `hostGift: 0` is its control
     * arm, which reproduces the blind bot exactly, for anybody who wants the
     * split read with the thumb removed. ⚠️ Read the sweep table in
     * `weights.ts` before quoting any split: that table was taken on the
     * self-visit share of a design with no centre, so its numbers do not
     * transfer, but its lesson does - this weight moves the reading it prices.
     *
     * ⭐ **AND IT IS THE SAME CHARGE ON EITHER OF A HOST'S TWO BOARDS**
     * (Dean's two-board fix, 11/09/2026, `rules.economy.noticeBoardsBySeats`).
     * At two seats the one rival lays out two, and this term reads `act.host`
     * and that host's standing and **nothing about `act.board`** - correctly,
     * because it is the same rival either way: a fee rests on whichever board
     * it was played to until that host harvests it into their barn, and both
     * boards are that host's store. So the charge neither DOUBLES because a
     * rival holds two boards nor HALVES because the traffic splits across them.
     * ⚠️ `notice-board-two-boards.test.ts` asserts both directions and reads
     * the arm's number against the ONE-BOARD control's, because a charge that
     * is equal on both boards and wrong on both would pass an "equal" check on
     * its own.
     *
     * ⛔ **WHICH BOARD IS PRICED SOMEWHERE ELSE ENTIRELY, AND HAS TO BE.** The
     * two boards print two different POWERS, and what a power is worth is a
     * fact about the position rather than about the host, so it is `outcome`'s
     * rollout that separates them - keyed on `visit:${host}:${board}` since the
     * fix. See `effectKey` in `outcome.ts` for what the old host-only key cost.
     *
     * ## ⛔ S17, THE HOST DRAW (Dean, 11/09/2026): THE HOST IS NOW PAID TWICE
     * AND THIS CHARGE IS THE ONLY PLACE EITHER HALF IS PRICED
     *
     * `rules.turn.hostDrawOnVisit` amends S7 in as many words. S7 said the fee
     * resting on the host's board "is the payment and there is no other"; under
     * S17 there is one other and it is paid INSTANTLY - **the host draws a card
     * off a deck the moment a neighbour visits them, on top of the fee card
     * they must still harvest and then deliver.** So a visit hands a rival
     * strictly more than it did under the control, and the two halves are
     * `HOST_GIFT_FEE` and `HOST_GIFT_DRAW` above.
     *
     * ⭐ **PER VISIT AND NOT PER TURN**, exactly as the engine pays it. A
     * Helping Hand sending a second visit to the same host in one turn is a
     * second move, scored separately, and this term fires on each - which is
     * right, because the host is handed a second fee card and a second draw.
     *
     * ⛔ **IT IS THE ONLY PLACE THE HOST'S DRAW IS PRICED, AND THAT IS A
     * DECISION RATHER THAN AN OVERSIGHT.** The visitor's rollout SEES the
     * host's draw - `cardsToHand` with `via: 'hostDraw'` reaches
     * `priceEvent` with the ids masked and the count intact - and prices it at
     * ZERO, on this project's standing rule that a bot values what it gains and
     * never what a rival gains. Pricing it there as well would charge one card
     * twice and, worse, would break the promise `weights.ts` makes about this
     * term: that **`hostGift: 0` reproduces the blind bot exactly** and is the
     * control arm for every reading the charge moves. One exception to the
     * standing rule, in one term, with one control.
     *
     * ⛔ **AND IT DOES NOT SCALE WITH THE HOST'S ROOM IN HAND, WHICH IS THE
     * REFINEMENT THE MEASUREMENT MOST INVITES AND THE ONE IT MOST FORBIDS.**
     * Measured over 15,288 rival placements, the host had NO ROOM for the card
     * on 32.5% of visits and 33.6% of host-drawn cards were thrown away at a
     * turn boundary. A charge that read the host's hand would therefore move a
     * third of the time - but **the bound it would be reading is the
     * SIMULATOR'S and not the game's** (C7: the engine caps hands at 7 and the
     * table plays with none), so a bot declining a visit because a rival's hand
     * was full would be playing the instrument. The 32.5% is carried in the
     * band at `weights.ts` instead, where it belongs: in the reading, not in
     * the behaviour.
     */
    name: 'hostGift',
    claims: ['visit'],
    feature: (act, s) => {
      if (!s.noticeBoardArm) return 0;
      // ⛔ THE `act.a !== 'visit'` CLAUSE IS WHAT ZEROES A CENTRAL PLAY UNDER
      // THE UNCLAIMED-BOARDS VARIANT, and it is the first of the three tests
      // for that reason: a `commons` act never reaches the charge below.
      if (act.a !== 'visit' || act.self || act.fee === null) return 0;
      // ⭐ **S17, AND IT IS THE ONE LINE IN THIS FILE THAT READS THE RULE**
      // (Dean, 11/09/2026, `rules.turn.hostDrawOnVisit`). A visit under the
      // rule hands the host BOTH halves and the weight is their sum; a visit
      // under the control hands over the fee alone, so the charge scales back
      // to `HOST_GIFT_FEE_SHARE` of it. ⛔ The knob rather than the ACT,
      // deliberately and against this file's usual preference: the host's draw
      // leaves no mark on the visitor's own move, so there is no field on the
      // act to gate on. It is read through the accessor, which is the one
      // spelling @gp/data owns.
      const share = hostDrawOnVisit(s.data) > 0 ? 1 : HOST_GIFT_FEE_SHARE;
      // CLAMPED AT ZERO so the standing tilt can never turn a cost term into a
      // reward. It cannot at 0, but a tilt above 1 would pay a bot for feeding
      // the last-placed seat, and the two invariants that catch an inverted
      // cost (`roster.test.ts` on the weight's sign, `bots.test.ts` on the
      // product's) would then fail for a reason nobody reading this line would
      // guess. Helping the trailer is worth LESS than helping the field, never
      // worth something.
      return -share * Math.max(0, 1 + HOST_GIFT_LEADER_TILT * leadOfHost(s, act.host));
    },
    cost: true,
  },
  {
    // "Your junk is their treasure" made executable: of two identical visits,
    // take the one that pays with the card you least want. An ordering term and
    // nothing more - `handSpend` charges the card itself.
    name: 'visitFeeJunk',
    // ⭐ AND IT IS THE COMMONS' FEE ORDERING TOO (09/09/2026, L5). "Your junk is
    // their treasure" becomes "your junk is the TABLE's treasure", and the idea
    // survives the loss of the host intact: of two plays worth the same, pay
    // with the card you least want. It matters more here than it did under v31,
    // because the fee-suit mix is one of the readings the pass asks for - are
    // players paying junk? - and an instrument with no ordering at all would
    // answer that question with a random tie-break.
    // ⭐ AND `commonsTake` JOINS IT (09/09/2026, `commonsTake: 'paid'`): the
    // same "pay with the card you least want" ordering, for the one fee the
    // take can carry. `'bonus'` and `'spend'` pay no fee, so this is a no-op
    // there (`act.fee` is `undefined`).
    claims: ['visit', 'commons', 'commonsTake'],
    // ⛔ NO FEE, NO ORDERING (the meeple-loop arm, R1). "Your junk is their
    // treasure" was a statement about a CARD changing hands and the arm stops
    // any card changing hands, so this term loses its subject outright rather
    // than changing rate. What replaces it as the ordering between two otherwise
    // equal visits is `meepleSpend`: of two doors worth the same, take the one
    // that costs the meeple you can least use. That is the same idea in the new
    // currency, and it needed no new term.
    // ⭐ AND IT RANKS **BOTH** CARDS OF A WILD PAIR (K3, 10/09/2026). A pair is
    // one fee paid with two cards, so "pay with the card you least want" becomes
    // "pay with the two cards you least want" - and it has to, because without
    // the second card in the rank the bot would pay its junk and then whichever
    // card enumeration happened to put beside it. The engine offers every
    // C(hand, 2) pair per board, so this term is the only thing that separates
    // them: `handSpend` charges a pair by COUNT (2) and prices every pair the
    // same, and `outcome`'s memo collapses them to one rollout per board
    // deliberately (see `effectKey`), which leaves this ordering carrying the
    // whole of the choice.
    feature: (act, s) => {
      if (act.a === 'commons') {
        const first = cardValue(s.data, act.fee);
        return act.fee2 === undefined ? -first : -(first + cardValue(s.data, act.fee2));
      }
      if (act.a === 'commonsTake') {
        return act.fee !== undefined ? -cardValue(s.data, act.fee) : 0;
      }
      return act.a === 'visit' && act.fee !== null ? -cardValue(s.data, act.fee) : 0;
    },
    cost: true,
  },
  {
    /**
     * The magpie's disposal lane, and it needs one: `visitFeeJunk` ranks a fee
     * by CARD VALUE, which is the right rank for everybody whose own crop is
     * worth something and the wrong one here. A magpie is dealt four own-crop
     * cards at setup and will never build one, so they are the only cards it can
     * spend at no cost at all - and without this term it pays its target crop
     * away instead, exactly the leak "your junk is their treasure" is about.
     *
     * 0 in every other profile: to a loyalist an own-crop card is the LAST thing
     * it wants to hand over, and this term must never quietly say otherwise.
     */
    name: 'visitFeeOwnCrop',
    claims: ['visit', 'commons'],
    // ⭐ **RE-OPENED FOR THE NOTICE-BOARD VISIT (11/09/2026), AND THE OPENING
    // COST NO CODE.** The comment that stood here said the lane was shut on the
    // commons handoff's explicit instruction (§2.6) so that the commons' first
    // measurement was taken with a KNOWN-WEAK magpie: the term was never
    // extended to claim `'commons'`, so a magpie paying a central pile ranked
    // its fee by plain junk value like everybody else, and every magpie number
    // off the commons has to be read knowing it. **That instruction has expired
    // with its design.** The notice-board visit reuses the `'visit'` move, the
    // fee lands on a person's Notice Board and the host harvests it into their
    // barn (S7), so "your junk is their treasure" - L5, and this term is its
    // only executable half - HAS A SUBJECT AGAIN and the magpie is a real
    // control once more. VERIFIED by running the arm: the claim and the
    // feature already fired for a `'visit'` act with a non-null fee, so nothing
    // below needed changing and only this note did.
    // ⚠️ **IT STILL DOES NOT CLAIM `'commons'`**, deliberately. The commons is
    // a shipped control now, and re-arming a magpie lane inside it would move a
    // control in the same pass as a rule - which is the one thing this project's
    // paired-arm method depends on not happening. The weakness recorded above
    // stands for every commons number ever taken.
    // ⛔ Null fee under the meeple-loop arm, so the magpie's disposal lane is
    // shut with the rest of the fee terms. ⚠️ THE MAGPIE IS THEREFORE A WEAKER
    // CONTROL UNDER THE ARM than it is under the shipped game: it can still
    // acquire a target crop and still refuses to build its own, but it has lost
    // the one move that let it dump own-crop cards for value. Read a magpie
    // number off the arm knowing that, or do not read one.
    // ⭐ **AND IT REACHES A CENTRAL PLAY UNDER DEAN'S UNCLAIMED-BOARDS VARIANT,
    // GATED ON `noticeBoardArm`, WHICH IS THE ONE CODE CHANGE THAT PASS MADE TO
    // A FEE TERM (11/09/2026).** Left as it stood it fired on a play onto a
    // RIVAL's board and not on a play onto a CENTRAL one, and under that
    // variant the two kinds share ONE bonus slot and their split is the
    // decisive number of the whole pass - so a magpie mirror would have carried
    // a +2 thumb toward the rival side of exactly the reading being taken. The
    // lane is symmetric by the rules' own logic: an own-crop card is worthless
    // to a magpie wherever it goes, and "spend the card you can least use" does
    // not care who ends up harvesting it.
    // ⛔ **IT STILL DOES NOT FIRE ON A `commons` PLAY UNDER THE SHIPPED COMMONS
    // ITSELF**, which is what the `noticeBoardArm` gate buys: the commons is a
    // shipped control, re-arming a magpie lane inside it would move a control in
    // the same pass as a rule, and the known weakness recorded above stands for
    // every commons number ever taken. ⚠️ A wild pair cannot exist under the
    // variant (`doCommons` throws on `fee2`), so one card is the whole fee.
    feature: (act, s) => {
      if (act.a === 'commons') return s.noticeBoardArm ? countOwnCrop(s, [act.fee]) : 0;
      return act.a === 'visit' && act.fee !== null ? countOwnCrop(s, [act.fee]) : 0;
    },
  },

  // --- positional, and the turn boundary ------------------------------------
  {
    /**
     * THE DELIVERABILITY TERM (the Vegetable rebuild, 2026-08-09), renamed from
     * `marketPayability` when v31 deleted the market that shared it.
     *
     * Its whole feature lives in `outcome.ts`'s `deliverabilityValue`, which is
     * why the entry here has none: V5 swaps two of the island's demand tokens
     * and V6 turns one face down, neither moves anything in the acting seat's
     * own zones, and both would price at exactly zero without a positional read
     * off the probe. This entry exists so the weight has a term to belong to and
     * `checkWeightTable` can see it.
     */
    name: 'deliverability',
    claims: ACTION_AND_TASK,
    feature: () => 0,
  },
  {
    /**
     * Standing moves offered by a built card.
     *
     * ⚠️ THE CATALOGUE HAS NO PRODUCER IN v31. A Helping Hand was the last one,
     * and its rewrite ("take both bonus options") needs no handler body at all,
     * so `handlerFor().moves` is currently unimplemented across all 105 cards.
     * The move type survives in the engine and so do these two terms: the next
     * card to print a standing move would otherwise be scored at 0 in silence,
     * which is the failure the claims test exists to prevent.
     */
    name: 'cardMove',
    claims: ['cardMove'],
    feature: (act) => (act.a === 'cardMove' ? 1 : 0),
  },
  {
    name: 'cardMoveSpend',
    claims: ['cardMove'],
    feature: (act, s) => {
      if (act.a !== 'cardMove') return 0;
      const spent = cardMoveSpend(act.payload);
      return spent === null ? 0 : -cardValue(s.data, spent);
    },
    cost: true,
  },
  {
    // Optional tasks: "you may". A negative weight means take the option.
    name: 'skip',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'skip' ? 1 : 0),
  },
  {
    /**
     * The card-task escape hatch, and since the Orchard rebuild it has a real
     * producer: the DIVERT seam answers `card` to put a limbo card into your own
     * barn instead of discarding it (O17 The Fruit Basket). Scored above `skip`
     * so the bot takes the barn card rather than binning it.
     */
    name: 'cardTask',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'cardTask' ? 1 : 0),
  },
  {
    // Only legal when no main action is, so the weight never picks between
    // moves - it just has to lose to any bonus-slot move that is still open.
    name: 'pass',
    claims: ['pass'],
    feature: (act) => (act.a === 'pass' ? 1 : 0),
  },
  {
    /**
     * Ending with the bonus slot unspent is the one thing a v31 bot should be
     * reluctant to do - but only reluctant, and the number is small on purpose.
     *
     * ⚠️ The plan asks the sim to tally SLOT UNSPENT as its own bucket, because
     * a rising unspent share is the start-of-turn restriction biting rather than
     * the visit being outcompeted. This -2 is the closest thing the bots have to
     * a thumb on that number, so it is left exactly where reference-v9 had it:
     * moving it in the same pass as the rule would confound the two readings.
     */
    name: 'endTurn',
    claims: ['endTurn'],
    feature: (act) => (act.a === 'endTurn' ? 1 : 0),
  },
];

export const TERM_NAMES: readonly string[] = TERMS.map((t) => t.name);
