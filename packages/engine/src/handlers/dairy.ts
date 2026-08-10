/**
 * Dairy handlers - all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md, landed
 * from docs/handoff-dairy-engine-build.md). Card texts are quoted from
 * cards.json (the sheet is the single source of truth for wording).
 *
 * Suit identity: Build. Every tier card is a Build variant, so almost nothing
 * here is card-specific logic: the variants are expressed as `BuildMods` on the
 * shared build task and the enumerator does the rest. That is still the whole
 * design of this suit - IF A DAIRY CARD NEEDS ITS OWN BUILD CODE, THE MODS ARE
 * WRONG - and the rebuild kept it while changing what the mods are: `discount`
 * and `substitute` survive, `coinWild` and `fromBarn` are deleted (see
 * `BuildMods`), and `fromStacks` is new for D7.
 *
 * ## Why the suit was rebuilt
 *
 * Dairy was last in the game on every channel: 10.6% win rate, 22.0 score, 2.0
 * deliveries, 10.2 cards into its barn, 2.8 rival cards onto its Service, and
 * 0.12 activations per Tier 1 card - the worst number in the game by a factor of
 * six. The cause of the last of those is one sentence: **Build is a free action
 * every turn, so a card that reads "Build" plus a small rider is worth minus one
 * card.** Every old Tier 1 read exactly that. So every number below is set above
 * the line where a modifier merely refunds the card that paid for it: a discount
 * of 1 against a 1-cost card is worth precisely nothing, which is what the old
 * Milking Shed printed.
 *
 * The deeper fault was not price at all. Dairy's cards moved cards OFF the
 * pipeline into the tableau, where they can never be delivered, and freight is
 * 80% of a winning score. That is what the Farmstead now fixes, in one line.
 *
 * ## The three seams that are not in this file
 *
 *   1. **The Farmstead diversion** (`actions.ts`: `buildDivertPower`,
 *      `divertOrDiscard`). "When you Build, put 1 card you spend from your hand
 *      into your barn instead of discarding it", every card on the upgraded
 *      face. It is a build-time seam and not a card handler because it has to
 *      act BEFORE the payment is discarded - D5 and D6 both reach into the
 *      discard for the same cards afterwards, and one destination per spent card
 *      falls out of that ordering. This entry contributes only the task that
 *      asks WHICH card (`divertSpent`, on D2).
 *      ⚠️ HAND CARDS ONLY. A card D7 lifted off a stack is not divertible, or
 *      D2 + D7 is a free Harvest - stack to build cost to barn, no action spent.
 *   2. **`BuildMods.fromStacks`** (`actions.ts`), D7's payment source.
 *   3. **The Tier 3 ACTION seam** (`handlers/actionCard.ts`), landed by Wheat
 *      and reused by Orchard: D13, D14 and D15 print no threshold and no
 *      activation type, so they can be neither grown nor sown, and they offer a
 *      standing MOVE that IS the main action. A GROW-gated Tier 3 fired 0.63
 *      times per card built; an action-gated one fires as often as its owner
 *      chooses.
 *
 * ## What went, and it was load-bearing
 *
 * `buildSubstitutePower` gave a Dairy seat permanent crop substitution from turn
 * 1 and `buildAgainPower` sold a second Build ACTION - the scarcest resource in
 * the game - for £2. Both are deleted. Substitution survives only as a mod the
 * BUILDER'S YARD grants to whoever visits it, which is what makes a Dairy seat's
 * own Service worth buying: 5% of rival Service uses and 2.8 rival cards a game
 * were both last in the game, and the traffic ranking is the win ranking in
 * exact order. Expect this to read as a Dairy nerf in the arm before the
 * diversion pays it back.
 *
 * SHED is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42) and matching `isFieldCard` in wheat.ts: D4-D8, and D4-D8
 * only. ⚠️ Any future card named "... Shed" joins the set silently.
 */

import type { GameData, Suit } from '@gp/data';

import { doBuild, freeHandSpace, handLimitOf, paymentOptions, placeBuilt } from '../actions.js';
import type { BuildMods } from '../actions.js';
import type { Fx } from '../fx.js';
import { buildingOf, cardById, drawableSuits, foreignCropBuildings, player } from '../query.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { actionMove, actionOpen } from './actionCard.js';
import type { CardHandler } from './types.js';

/** The printed card price of a build cost, coins excluded (D14 and D15 read it). */
function cardCostOf(data: GameData, id: CardId): number | null {
  const cost = cardById(data, id).buildCost;
  return cost ? cost.suit + cost.wild : null;
}

const SHED_NAME = /\bShed\b/;

/**
 * SHED sub-type membership, by whole-word title keyword (reference DL-42). The
 * Barn's build rider and D21 The Refinery both read it, so it is written once.
 */
export function isShedCard(data: GameData, id: CardId): boolean {
  return SHED_NAME.test(cardById(data, id).name);
}

/**
 * "BUILDINGS YOU HAVE BUILT": the non-starter cards in a seat's tableau.
 *
 * BUILT MEANS PAID FOR AND PUT DOWN. The four starters arrive pre-built and
 * nobody built them, so counting them would hand every holder a flat 4; that
 * holds whether or not they are flipped. A D11-covered card has left the tableau
 * and is already excluded; a D14-demolished one likewise, which is the cost of
 * demolishing. Equivalent to W20's `inDeck` reading and phrased as the starter
 * test instead, because the same set is also the TARGET SET for the two
 * primitives that remove a building - `fx.coverBuilding` and `fx.demolish` - and
 * `sim/starter-invariant.test.ts` reads this filter to prove no starter can
 * reach them.
 *
 * D9, D11, D13, D14 and D20 all read this noun.
 */
function builtBuildings(data: GameData, state: GameState, seat: Seat): CardId[] {
  return player(state, seat)
    .tableau.filter((b) => cardById(data, b.card).type !== 'starter')
    .map((b) => b.card);
}

/** Decks on the table with cards left - D10's "each deck" and D15's flip pool. */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/** Push a see-N/keep-N "Draw N" for a card ability (no Orchard modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Rivals who could physically accept a card right now (DL-63). D6 and D13. */
function giftableSeats(data: GameData, state: GameState, pid: Seat): Seat[] {
  const out: Seat[] = [];
  for (let seat = 0; seat < state.players.length; seat++) {
    if (seat === pid) continue;
    if (freeHandSpace(data, state, seat) < 1) continue;
    out.push(seat);
  }
  return out;
}

/**
 * Push a Build under `mods`, tagged with `src` so the card can react to its own
 * build (D5, D6). Nothing is folded in on top any more: what a build carries is
 * exactly what granted it.
 */
function buildWith(fx: Fx, seat: Seat, src: CardId, mods: BuildMods, optional = false): void {
  fx.pushTask({ t: 'build', pid: seat, src, mods, ...(optional ? { optional: true } : {}) });
}

/** Cards of `spent` still face up in their suits' discards - D5 and D6 both ask. */
function stillDiscarded(data: GameData, state: GameState, spent: readonly CardId[]): CardId[] {
  return spent.filter((id) => state.discards[cardById(data, id).suit]?.includes(id));
}

/** D1 Barn (starter) - "Hand size 6. When you build a SHED, Draw 2." / upgraded "Hand size 8. ..." */
export const dairyBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'W1/O1/V1 with one word changed, and the same three readings. The printed hand size is ' +
      'still engine-read (handLimitOf off the current face); what is new is the rider, and it ' +
      'is on BOTH faces deliberately, or paying £2 to upgrade would DELETE the power. It fires ' +
      "on any build path - the action, the Builder's Yard, a card-granted build, D10's " +
      'revealed deck top - because afterBuild is the one funnel every landing goes through, ' +
      "but NOT on D15's free builds, because a Grand Creamery card is not a SHED. A " +
      'card-ability draw, so no Orchard modifier (DL-47). The biggest barn in the game at ' +
      '6 -> 8, which is also what makes D13 The Cheese Vault a harder card than it looks: the ' +
      'bigger the hand, the less of the Vault leaks across the table.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (!isShedCard(fx.data, event.card)) return;
      drawN(fx, self.seat, self.card, 2);
    },
  },
};

/**
 * D2 Farmstead (starter) - "When you Build, put 1 card you spend from your hand
 * into your barn instead of discarding it." / upgraded "... put every card ..."
 */
export const dairyFarmstead: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      "THE SUIT'S WHOLE COMPENSATION, and the largest single change in the rebuild: a Dairy " +
      'card is now paid for once and counted twice. It is the direct answer to barn intake ' +
      "10.2 against Orchard's 25.7 - every other suit spends a card OR ships it, and Dairy " +
      'does both. The numbers half lives in actions.ts (buildDivertPower, divertOrDiscard) ' +
      "because it has to act BEFORE the build's payment is discarded; this entry contributes " +
      'the task that asks which card. FOUR RULINGS ARE ENCODED. (1) Cards spent from your ' +
      'HAND only: a card D7 lifted off a stack is not eligible, or the pair is a free ' +
      'Harvest. (2) Once per Build, however many buildings that Build puts down - the COUNT ' +
      'is per card spent, so D12 and D15 divert more without the trigger re-firing. (3) A ' +
      "free build spends no cards and therefore diverts nothing (D10's reveal is a paid " +
      "build and does divert; D15's run and the Builder's Yard's £1 mode feed nothing). " +
      '(4) ONE DESTINATION PER SPENT CARD, chosen by the player: skip is offered even though ' +
      'the card prints "put", because declining is how you leave a card in the discard for D5 ' +
      'to sow or D6 to give. ⚠️ Both old faces are GONE - turn-1 crop substitution and a ' +
      'second Build ACTION for £2 - and the suit still came last with them, because neither ' +
      'made a single card into freight.',
  },
  tasks: {
    /**
     * The divert choice. Re-entrant on the upgraded face (limit = the whole
     * payment) and one-shot on the base face; either way the resolver DISCARDS
     * WHATEVER IS LEFT before it finishes, so the limbo cards in `riders.cards`
     * can never outlive the task. `skip` is always offered while a card is
     * still held, for the same reason it is on the Orchard divert seam: the
     * drain loop drops a task with no legal answer, and a dropped task here
     * would take its cards out of the game.
     */
    divertSpent: {
      answers(_data, _state, task) {
        const cards = (task.riders.cards as CardId[]) ?? [];
        const remaining = (task.riders.remaining as number) ?? 0;
        if (cards.length === 0 || remaining <= 0) return [];
        const out: TaskAnswer[] = cards.map((card) => ({ kind: 'card', payload: { card } }));
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        const cards = (task.riders.cards as CardId[]) ?? [];
        if (answer.kind === 'skip') {
          fx.discard([...cards]);
          task.riders.cards = [];
          return true;
        }
        if (answer.kind !== 'card') throw new Error('divertSpent expects a card or skip answer');
        const card = answer.payload.card as CardId;
        fx.stashCard(task.pid, card);
        const left = cards.filter((c) => c !== card);
        const remaining = ((task.riders.remaining as number) ?? 0) - 1;
        task.riders.cards = left;
        task.riders.remaining = remaining;
        if (left.length === 0 || remaining <= 0) {
          fx.discard(left);
          return true;
        }
        return false;
      },
    },
  },
};

/**
 * D3 Notice Board (starter) - "VISITOR: Take £1 from bank / OR Build at a
 * discount of 1. Any crop may pay its crop costs."
 */
export const dairyNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs and the wage - ' +
      "is engine-level, and the Builder's Yard half is data (workers.json). ⚠️ THE DISCOUNT " +
      'OF 1 REVERSES A DOCUMENTED RULING (outstanding-rule-changes.md §5, which chose the ' +
      'crop waiver alone on owner-side grounds). Dean approved the reversal on the visitor ' +
      'side: the discount exactly refunds the card a visitor places, and Build took 5% of all ' +
      'rival Service uses, last in the game. The owner-side argument was not refuted, it was ' +
      'outweighed - and it is now weaker anyway, because the Dairy Farmstead no longer ' +
      'substitutes, so nothing stacks.',
  },
};

/** D4 The Milking Shed - "Build at a discount of 2." */
export const milkingShed: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Alters THE PRICE. The naked skeleton at half price, and the flat 2 is the point: the ' +
      'old card counted cards on its own stack and therefore opened at a discount of 1, which ' +
      'against a 1-cost activation is EXACTLY WORTHLESS. A discount of 2 against a cost of 1 ' +
      'is a straight +1 card, and the card that paid for it is banked in the stack as freight. ' +
      'The counting task is gone with the counting.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 2 });
  },
};

/** D5 The Churning Shed - "Build. SOW the cards you spend onto the new building." */
export const churningShed: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'Alters THE RESIDUE, at home, and it is the spiciest card in the tier: the cards you ' +
      'spend land on the thing you built, so a new building can ARRIVE FULL and be harvested ' +
      "next action. Needs to know what its OWN build spent, which is what afterBuild's `src` " +
      'is for - The Ledger reacts to every build, this reacts only to the one it granted. The ' +
      'spent cards are in their discards by then, so each sow reclaims one through ' +
      'placeFromDiscard. The only change from the old card is that it is PLURAL: the task ' +
      'stays for another round instead of resolving one and stopping. It self-terminates ' +
      'three ways and needs no counter for any of them - a card the Farmstead diverted is no ' +
      'longer in the discard, a sown card leaves it, and a full building stops enumerating - ' +
      'so ONE DESTINATION PER SPENT CARD holds without this card knowing the Farmstead exists. ' +
      'Never fires on another build; auto-skips on a free build, or when the new building ' +
      'cannot take a card.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'sowSpent',
        riders: { built: event.card, spent: [...event.payment] },
      });
    },
  },
  tasks: {
    sowSpent: {
      answers(data, state, task) {
        const built = task.riders.built as CardId;
        const target = player(state, task.pid).tableau.find((b) => b.card === built);
        if (!target) return [];
        const threshold = cardById(data, built).threshold;
        if (threshold === null || threshold === undefined) return [];
        if (target.stack.length >= threshold) return [];
        // Only the cards THIS build spent, and only while they are still the
        // face-up cards we discarded - no reaching into the pile's history, and
        // no reaching for one the Farmstead has already banked.
        const spent = stillDiscarded(data, state, task.riders.spent as CardId[]);
        if (spent.length === 0) return [];
        return spent.map((card) => ({ kind: 'card', payload: { card } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('sowSpent expects a card answer');
        fx.placeFromDiscard(
          task.pid,
          { seat: task.pid, card: task.riders.built as CardId },
          answer.payload.card as CardId,
        );
        // Plural: stay for the next card. The enumerator drops the task once
        // the building fills or nothing spent is left in the discard.
        return false;
      },
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D6 The Trading Shed - "Build. Give 1 card you spend to a neighbour and take £1 from the bank." */
export const tradingShed: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Alters THE RESIDUE, across the table. The only £ in the tier and the only card in it ' +
      'that crosses the table, and it is §7-legal by construction: the money appears at the ' +
      'moment a neighbour RECEIVES something, never on its own. The card handed over is one ' +
      'you were discarding anyway, so it costs nothing you wanted and arrives in their farm as ' +
      'exactly the mixed colour the island demands of them - "your junk is their treasure", ' +
      'printed. Forced the discardToHand primitive: giveCard takes a card OUT OF A HAND and ' +
      'this one is already spent. ⚠️ NO ELIGIBLE NEIGHBOUR MEANS NO COIN - the £1 is paid for ' +
      'the gift, not for the build - and a rival at their hand limit is not eligible (DL-63: ' +
      'a gift never forces an out-of-turn discard). Mandatory as printed, so it auto-skips ' +
      'rather than offering a decline; a card the Farmstead has already banked is no longer ' +
      'in the discard and cannot be given.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'give',
        riders: { spent: [...event.payment] },
      });
    },
  },
  tasks: {
    give: {
      answers(data, state, task) {
        const spent = stillDiscarded(data, state, task.riders.spent as CardId[]);
        if (spent.length === 0) return [];
        const seats = giftableSeats(data, state, task.pid);
        return spent.flatMap((card) =>
          seats.map((to) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('give expects a card answer');
        fx.discardToHand(task.pid, answer.payload.to as Seat, answer.payload.card as CardId);
        fx.gainCoins(task.pid, 1, 'D6');
        return true;
      },
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D7 The Versatile Shed - "Build. You may spend cards from your buildings as well as from your hand." */
export const versatileShed: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'Alters THE SOURCE, and forced the fromStacks mod. It is the reserved slot - the card ' +
      "that argues against the suit's own compensation - and the only Tier 1 un-clog, and it " +
      'prints the fork Dairy lives on: A CARD ON A STACK IS EITHER FREIGHT OR BUILDING ' +
      'MATERIAL AND NEVER BOTH. Easier than the fromBarn mod it replaces, because a stack is ' +
      'public and ordered where a barn is anonymous even to its owner, so a stack card is ' +
      'named by id like a hand card and the whole per-suit tally path is gone. THREE RULINGS: ' +
      'your own buildings only; the cards are SPENT, not harvested, so fx.spendFromStack and ' +
      'no afterHarvest anywhere; and they do NOT qualify for the Farmstead diversion, or D2 + ' +
      'D7 is a free Harvest. Its OWN stack is legal, including the card that just paid to grow ' +
      'it - not an oversight, but the alternative is a special case nobody at a table would ' +
      'guess. The option set is kept finite by collapsing stack cards to one per (building, ' +
      'crop); see stackPayables.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { fromStacks: true });
  },
};

/** D8 The Abundant Shed - "Build. Draw 2." */
export const abundantShed: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "Alters THE REFILL, and it is Dairy's card-neutrality guarantee: pay 1, draw 2, build. " +
      'Flat and unconditional on purpose - it is the card you can always take, and without it ' +
      'a Dairy hand empties into the tableau and nothing else in the suit ever fires. ' +
      '⚠️ ORDER IS LOAD-BEARING AND IT IS NOT THE SHEET\'S. The sheet prints "Build. Draw 2."; ' +
      'the design\'s justification is "pay 1, draw 2, build", which is the only order that ' +
      'makes the GROW card-neutral and is the entire reason the card exists. Building first ' +
      'and drawing after is a materially worse card, so the draw is pushed FIRST and the build ' +
      'enumerates against the refreshed hand. FLAGGED TO DEAN as a sheet edit: "Draw 2, then ' +
      'Build."',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D9 The Prosperity Wagon - "Build at a discount of 1 for every 2 buildings you have built." */
export const prosperityWagon: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "Alters THE PRICE, scaling: the tier's scaling noun and the suit's ramp stated as " +
      'arithmetic. "Buildings you have built" is the shared count - starters never count, ' +
      'covered and demolished cards no longer count - and the Wagon itself does, so it opens ' +
      'at a discount of at least 1 in any realistic tableau. The old chooseWorker task and its ' +
      '£2 rider are gone with the Hiring Fair; nothing in the suit works a Service any more.',
  },
  activate(fx, self) {
    const built = builtBuildings(fx.data, fx.state, self.seat).length;
    buildWith(fx, self.seat, self.card, { discount: Math.floor(built / 2) });
  },
};

/** D10 The Scout's Post - "Reveal the top card of each deck. You may build 1 of them at a discount of 2." */
export const scoutsPost: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'Alters THE TARGET. It loses the old £3 gate outright, because seats end games on about ' +
      '£1 and a card gated behind coins is dead text - and revealing every deck and choosing ' +
      'one is a better gamble than a blind single flip. ⚠️ RULING: THE REVEALED CARDS YOU DO ' +
      'NOT BUILD GO BACK ON TOP OF THEIR OWN DECKS. Discarding four cards an activation would ' +
      'make this the heaviest deck-top consumer in the game, next to two other cards in the ' +
      'same suit that pull off deck tops; returning them makes it a free look, which is what ' +
      '"Scout" means. The chosen card passes THROUGH THE HAND and is then built by the shared ' +
      'doBuild, which is not a detour: it is what makes the build a real Build - a real price ' +
      'at a discount of 2, the Farmstead diversion, the Barn rider, The Ledger, the Farmstead ' +
      'milestone - rather than a second copy of the build code this suit exists not to have. ' +
      "The payment is enumerated by paymentOptions, which is buildOptions' inner half, " +
      'because the card being priced is not in the hand when the choice is offered.',
  },
  activate(fx, self) {
    const revealed: CardId[] = [];
    for (const suit of liveDecks(fx.data, fx.state)) {
      const card = fx.takeDeckTop(suit);
      if (card !== null) revealed.push(card);
    }
    if (revealed.length === 0) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'scout', riders: { revealed } });
  },
  tasks: {
    scout: {
      answers(data, state, task) {
        const revealed = (task.riders.revealed as CardId[]) ?? [];
        if (revealed.length === 0) return [];
        const out: TaskAnswer[] = [];
        for (const card of revealed) {
          for (const pay of paymentOptions(data, state, task.pid, card, { discount: 2 })) {
            out.push({ kind: 'card', payload: { card, payment: pay.payment } });
          }
        }
        // "You may": declining is always available, and it is also what keeps
        // the task from being dropped with the revealed cards still in limbo.
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        const revealed = [...((task.riders.revealed as CardId[]) ?? [])];
        task.riders.revealed = [];
        let chosen: CardId | null = null;
        if (answer.kind === 'card') {
          chosen = answer.payload.card as CardId;
          fx.cardsToHand(task.pid, [chosen]);
          doBuild(
            fx,
            task.pid,
            { card: chosen, payment: answer.payload.payment as CardId[] },
            { discount: 2 },
            task.src,
          );
        }
        for (const card of revealed) {
          if (card === chosen) continue;
          fx.returnToDeckTop(cardById(fx.data, card).suit, card);
        }
        return true;
      },
    },
  },
};

/**
 * D11 The Heritage House - "Build on top of one of your buildings (never a
 * starter), at a discount of 2. Put every card on the covered building into your
 * barn. The covered card scores its VP at game end."
 */
export const heritageHouse: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'Alters THE SITE, and it is still the hardest card in the suit. The covered card stops ' +
      'being a building - invisible to every endgame formula, every count and every placement ' +
      '- but its printed VP still scores, as a bare sum folded into `printed` (the ' +
      "reference's cover semantics). THE TARGET SET WIDENED from EMPTY buildings to any " +
      'non-starter building, because under this suit a Dairy building is almost never empty - ' +
      'which is exactly how Wheat lost its "per empty building" noun - and the stack now ships ' +
      'to the barn instead of blocking the card. So it is an upgrade, a harvest and an un-clog ' +
      'in one action. ORDER MATTERS TWICE: the stack goes to the barn before the cover (or ' +
      'coverBuilding throws on a loaded stack, which is the assertion that keeps this order ' +
      'from reversing unnoticed), and the cover happens before the build, so the freed slot ' +
      'cannot be re-picked. ⛔ THE STARTER EXCLUSION IS NOT FLAVOUR AND MUST NOT BE RELAXED: ' +
      "the Notice Board is v14's only visit target, so covering it is a one-card permanent " +
      'opt-out from the hook (at a DISCOUNT, making it cheaper than a normal build); the Barn ' +
      'prints the hand limit, and handLimitOf reads a missing Barn as NO limit, silently ' +
      "stopping the design's master clock; the Farmstead carries the suit power and the free " +
      "flip; and the Service is the seat's whole cross-table surface. It is also what keeps " +
      "noticeBoardOf's throw an invariant rather than a reachable crash - 3 of 1510 reference " +
      'games died that way before ticket 30. Its own stack is a legal target, which is a real ' +
      'if strange line: the grow payment ships to the barn and the House buries itself.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'cover', riders: {} });
  },
  tasks: {
    cover: {
      answers(data, state, task) {
        return builtBuildings(data, state, task.pid).map((card) => ({
          kind: 'card',
          payload: { card },
        }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('cover expects a card answer');
        const building = answer.payload.card as CardId;
        for (const card of [...buildingOf(fx.state, task.pid, building).stack]) {
          fx.stackCardToBarn(task.pid, building, card);
        }
        fx.coverBuilding(task.pid, building);
        buildWith(fx, task.pid, task.src, { discount: 2 });
        return true;
      },
    },
  },
};

/** D12 The Butter Factory - "Build 2 buildings, each at a discount of 1." */
export const butterFactory: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Alters THE COUNT: the pure multiplier, nothing stapled on. Two OPTIONAL builds, each ' +
      'independently skippable and each at discount 1 - "optional" rather than forced because ' +
      'a build task with nothing affordable would drop itself anyway, and a player who wants ' +
      'only one should be able to say so. The second is enumerated after the first resolves, ' +
      'so a card built by the first can pay for nothing and the hand it sees is the real one. ' +
      "Two builds means TWO diversions (the Farmstead's count is per card spent) and ONE " +
      'Ledger draw (its guard is per build SOURCE per turn).',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 1 }, true);
    buildWith(fx, self.seat, self.card, { discount: 1 }, true);
  },
};

/**
 * D13 The Cheese Vault (ACTION) - "Draw a card for every building you have
 * built. Give any cards over your hand limit to other players, and take £1 from
 * the bank for each."
 */
export const cheeseVault: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      "THE CROSS-TABLE FAUCET, and the suit's hook printed on one card: THE HAND LIMIT IS THE " +
      'BRAKE, AND IT GROWS WITH THE PAYOUT. Every extra building converts one more of the draw ' +
      'from a card you keep into a card you must give away, so the bigger your farm the more ' +
      'of the payout leaks into the village - which is why it stayed a Tier 3 ACTION rather ' +
      'than becoming a threshold-1 GROW card: a threshold is a brake bolted on from outside, ' +
      'and this one is intrinsic. Always live and never zero-floored. TWO RULINGS. (1) THE ' +
      'DRAW IS NOT THE DRAW ACTION - it is a card ability, so the Orchard Farmstead modifier ' +
      'must not apply (DL-47), which drawN guarantees by pushing the printed numbers. (2) THE ' +
      'GIVEAWAY IS IMMEDIATE, comparing hand size to the limit at the moment the action ' +
      'resolves, NOT at the end-of-turn discard: without that a player simply holds everything ' +
      "and discards later, and the card's whole point evaporates. Mandatory (no skip), " +
      'auto-stopping when the hand is back at the limit; a rival at their own limit cannot ' +
      'receive (DL-63) and takes their £1 out of the total with them. ⚠️ It hands rivals up ' +
      'to five cards a firing and cards are the master brake - watch whether it is taken at ' +
      'all. The dial the design names is sending the overflow to your own barn at £0, which ' +
      'removes the gift and most of the point.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const live =
      actionOpen(state, self) &&
      builtBuildings(data, state, self.seat).length > 0 &&
      drawableSuits(data, state).length > 0;
    return actionMove(self, live);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    drawN(fx, self.seat, self.card, builtBuildings(fx.data, fx.state, self.seat).length);
    // Queued BEHIND the draw, and its size is computed when it resolves: the
    // overflow is whatever the hand holds once the cards have actually arrived.
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'overflow', riders: {} });
  },
  tasks: {
    overflow: {
      answers(data, state, task) {
        const limit = handLimitOf(data, state, task.pid);
        if (limit === null) return [];
        const hand = player(state, task.pid).hand;
        if (hand.length <= limit) return [];
        const seats = giftableSeats(data, state, task.pid);
        if (seats.length === 0) return [];
        return hand.flatMap((card) =>
          seats.map((to) => ({ kind: 'card', payload: { card, to } }) as TaskAnswer),
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('overflow expects a card answer');
        fx.giveCard(task.pid, answer.payload.to as Seat, answer.payload.card as CardId);
        fx.gainCoins(task.pid, 1, 'D13');
        // Stay: the enumerator drops the task the moment the hand is back at
        // its limit, or no rival can take another card.
        return false;
      },
    },
  },
};

/**
 * D14 The Cream Refinery (ACTION) - "Put one of your buildings, and every card
 * on it, into your barn. Then put the top card of any deck into your barn for
 * each card in its build cost."
 */
export const creamRefinery: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'THE REWRITE: the only card in the game that shrinks a tableau, and the payout SCALES ON ' +
      'BUILD COST - the one number Dairy is best at making large. A 3-cost Tier 2 with two ' +
      'cards on it is six cards in your barn for one action; a 1-cost shed is two. ⚠️ RULING: ' +
      'THE BUILDING GOES TO THE BARN AS AN ORDINARY CARD. It stops counting as built, it no ' +
      'longer scores its printed VP, its ability is gone, and it no longer counts for D13, D20 ' +
      'or D21. That is the whole decision and it is a real one - roughly 4 to 6 VP of tableau ' +
      'and an ability against 6 cards of freight, and freight is 80% of a winning score. ' +
      'Starters may never be chosen, for the four reasons spelled out on D11. Its own card IS ' +
      'a legal target, which is a genuine one-shot line: the Refinery refines itself for its ' +
      'own 4-card cost plus itself. The old "empty buildings only" restriction and the £-free ' +
      'gate are both gone. ⚠️ Watch whether it is STRICTLY CORRECT rather than a decision; ' +
      'the dial the design names is dropping the stack from the payout.',
  },
  actionMoves: true,
  moves(data, state, self) {
    return actionMove(
      self,
      actionOpen(state, self) && builtBuildings(data, state, self.seat).length > 0,
    );
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'refine', riders: {} });
  },
  tasks: {
    refine: {
      answers(data, state, task) {
        return builtBuildings(data, state, task.pid).map((card) => ({
          kind: 'card',
          payload: { card },
        }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('refine expects a card answer');
        const building = answer.payload.card as CardId;
        for (const card of [...buildingOf(fx.state, task.pid, building).stack]) {
          fx.stackCardToBarn(task.pid, building, card);
        }
        fx.demolish(task.pid, building);
        const n = cardCostOf(fx.data, building) ?? 0;
        for (let i = 0; i < n; i++) {
          fx.pushTask({ t: 'card', pid: task.pid, src: task.src, kind: 'deckToBarn', riders: {} });
        }
        return true;
      },
    },
    deckToBarn: {
      answers(data, state) {
        return liveDecks(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('deckToBarn expects a card answer');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/**
 * D15 The Grand Creamery (ACTION) - "Reveal deck tops one at a time and build
 * each one free. Each must cost more than the last, or it is discarded and you
 * stop."
 */
export const grandCreamery: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'THE GAMBLE, and the only card in the suit that turns an action into buildings at NO ' +
      'CARD COST AT ALL - which is precisely the constraint the old Tier 3 could not meet, ' +
      'because it was gated by the hand and the hand is the resource Dairy has least of. ' +
      "Can't Stop logic inside a Build, with no new number and no new component: every card " +
      'already prints its cost and the comparison is two printed numbers side by side. One ' +
      'task that carries the last cost forward and PREPENDS its own successor, so the next ' +
      'flip is offered before anything the last build queued behind it. THREE RULINGS. (1) ' +
      'The first flip has no predecessor, so any card builds; a COIN-PRICED Power or Endgame ' +
      'card has a CARD cost of 0, so it builds free on the first flip and the run then needs ' +
      '1 or more - that is the jackpot and it is intended. (2) The busting card is DISCARDED, ' +
      'not returned: it is the only thing the run costs beyond the action. (3) Free builds ' +
      'spend no cards, so the Farmstead diverts nothing and D5 sows nothing off this card. ' +
      'You may always stop. ⚠️ THE MEDIAN RUN LENGTH IS THE CARD: 1 is a disappointment ' +
      'machine, 3 is too strong, and the dial is whether a coin-priced card counts as 0 or ' +
      'busts the run. ⚠️ It is the heaviest deck-top consumer in the game and its cards never ' +
      'come back to the deck at all, so reshuffles per played deck is the number most likely ' +
      'to break.',
  },
  actionMoves: true,
  moves(data, state, self) {
    return actionMove(self, actionOpen(state, self) && liveDecks(data, state).length > 0);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'creameryFlip',
      riders: { last: null },
    });
  },
  tasks: {
    creameryFlip: {
      answers(data, state) {
        const out: TaskAnswer[] = liveDecks(data, state).map((suit) => ({
          kind: 'card',
          payload: { suit },
        }));
        if (out.length === 0) return [];
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('creameryFlip expects a card or skip answer');
        const card = fx.takeDeckTop(answer.payload.suit as Suit);
        if (card === null) return true;
        const last = task.riders.last as number | null;
        const cost = cardCostOf(fx.data, card) ?? 0;
        if (last !== null && cost <= last) {
          fx.discard([card]);
          return true;
        }
        // Free: no cards, no coin price, landed through placeBuilt so the
        // Farmstead milestone and every afterBuild reactor still count it.
        placeBuilt(fx, task.pid, card, [], 0, task.src);
        fx.prependTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'creameryFlip',
          riders: { last: cost },
        });
        return true;
      },
    },
  },
};

/** D16 The Ledger - "Whenever you Build, Draw 1." */
export const ledger: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'Kept word for word, and now the load-bearing Power card of the suit. ⚠️ RULING ' +
      '(decided): ONCE PER BUILD ACTION, not once per building - otherwise The Grand Creamery ' +
      'draws four and The Butter Factory two. W16 The Granary answers the same question by ' +
      "counting its own events inside one `apply`, and that shape CANNOT work here: D15's run " +
      "and D12's pair each place their buildings across several applies, one per player " +
      'decision. So the guard reads turn.buildSources, the generic record of what caused each ' +
      'build this turn: a card source that has already built this turn does not pay out again. ' +
      'A NULL SOURCE IS NEVER DEDUPED, deliberately - the plain Build action and the ' +
      "Builder's Yard on the bonus slot are genuinely two Build actions in one turn and " +
      "should draw twice. Owner-scoped, never a rival's. A card-ability draw, so no Orchard " +
      'modifier (DL-47).',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.src !== null) {
        const from = fx.state.turn.buildSources.filter((s) => s === event.src).length;
        // placeBuilt records this build before firing the hook, so 1 means it
        // is the first from this source and anything higher is a repeat.
        if (from !== 1) return;
      }
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** D17 The Strongbox - "Whenever a neighbour Builds, take £1 from the bank." */
export const strongbox: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Rebuilt because its printed text paid on HIRE or WORK and neither verb exists any more ' +
      '(the sheet edit was already owed in outstanding-rule-changes.md §5). The replacement is ' +
      'the "materials yard": §7-legal, the purest statement of the suit\'s identity - you are ' +
      'paid for the village building, not for building yourself - and it fires 3 to 9 times a ' +
      "game. Rival-scoped, and mid a rival's turn, so crossPlayer. ⚠️ IT FIRES PER BUILDING, " +
      'NOT PER BUILD ACTION, which is the handoff as written and NOT the same ruling D16 got: ' +
      'a rival Grand Creamery run pays this card up to four times. That is the number most ' +
      'likely to be wrong in the whole suit - up to £10 a game for £2, where seats END on £1 - ' +
      'and the dials, in order, are once per round, or only through your Service.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat === self.seat) return;
      fx.gainCoins(self.seat, 1, 'D17');
    },
  },
};

/** D19 The Cheese Hall - "Game end: 1 VP for each non-Dairy building you have built." */
export const cheeseHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Behaviour unchanged; the most important of the three endgame cards, because it is the ' +
      "one card in the suit that pays OUTWARD - and the Innovation lens's sharpest finding is " +
      'that our suit is our specialisation is our metric. It has just got much better, because ' +
      'The Grand Creamery hands you free buildings off every deck and almost none of them are ' +
      'Dairy. Buildings printing SOME crop icon that is not Dairy (ticket 07). Not the ' +
      'complement of a Dairy count: a base starter prints the starting-building icon, so it is ' +
      'neither a Dairy building nor a non-Dairy one and scores nothing either way, which also ' +
      'stops this card penalising a Dairy seat for upgrading. A D11-covered card is not in the ' +
      'tableau and never counts.',
  },
  gameEnd(data, state, seat) {
    return foreignCropBuildings(data, state, seat, 'dairy').length;
  },
};

/** D20 The Counting House - "Game end: 1 VP for each building you have built." */
export const countingHouse: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE SIZE OF THE FARM. It replaced "build cost of 4 or more", which under the compressed ' +
      'ladder counted only the three Tier 3s. "You have built" is the shared count: the four ' +
      'starters arrive pre-built and nobody built them, a covered card is not a building and a ' +
      'demolished one is stock. ⚠️ WORD FOR WORD W20 The Grand Granary. Flagged, not resolved, ' +
      'per Dean: cross-suit duplicates wait for one pass across all five suits. Dairy has the ' +
      'better claim on the noun - buildings are its ramp, and Wheat only landed here because ' +
      'the reseed killed its "per empty building". ⚠️ Anti-synergy with D14, deliberately: ' +
      'this pays for buildings and the Refinery destroys them.',
  },
  gameEnd(data, state, seat) {
    return builtBuildings(data, state, seat).length;
  },
};

/** D21 The Refinery - "Game end: 2 VP for each SHED you have built." */
export const refinery: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'DEPTH IN THE RAMP, and it matches W21 The Bread Hall and O20 The Orchard Archive in ' +
      'shape: 2 VP per Tier 1 card, capping at 10. It counts SHEDs rather than barn cards on ' +
      'purpose - a barn-counting endgame card pays you to hold freight back from the island, ' +
      'which is the one thing this rebuild is trying to stop. SHED is the title keyword, so ' +
      'D4 to D8 and nothing else; the old "build cost of 1 to 3" arithmetic is gone with the ' +
      'compressed ladder that made it ambiguous.',
  },
  gameEnd(data, state, seat) {
    return 2 * builtBuildings(data, state, seat).filter((card) => isShedCard(data, card)).length;
  },
};
