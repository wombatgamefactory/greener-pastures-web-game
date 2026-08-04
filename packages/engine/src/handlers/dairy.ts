/**
 * Dairy handlers - all 21 cards (ticket 22; D18 is the shared Helping Hand).
 * Card texts are quoted from cards.json (the sheet is the single source of
 * truth for wording), with ONE exception noted on D7.
 *
 * Suit identity: Build. Every tier card is a Build variant, so almost nothing
 * here is card-specific logic: the variants are expressed as `BuildMods` on the
 * shared build task (discount / substitute / coinWild / fromBarn) and the
 * enumerator does the rest. That is the whole design of this suit - if a Dairy
 * card needs its own build code, the mods are wrong.
 *
 * The Farmstead is engine seams like the other four: `buildSubstitutePower`
 * waives the own-suit minimum for a Dairy seat on EVERY build (base power, live
 * from turn 1), and `buildAgainPower` arms `turn.again = 'build'` after the main
 * Build action (upgraded face) - the same ActionAgain gate as the Wheat harvest
 * repeat, so a Worker's build never repeats.
 *
 * Coins never substitute for cards in the Farmstead power (DL-35, and the card
 * prints "not £"); D7 is the deliberate exception, by ticket 06 ruling H.
 */

import type { GameData, Suit } from '@gp/data';

import { placeBuilt } from '../actions.js';
import type { BuildMods } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, cropBuildings, drawableSuits, foreignCropBuildings, player } from '../query.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CardHandler } from './types.js';

/** The printed card price of a build cost, coins excluded (D20/D21 read it). */
function cardCostOf(data: GameData, id: CardId): number | null {
  const cost = cardById(data, id).buildCost;
  return cost ? cost.suit + cost.wild : null;
}

/**
 * Push a Build under `mods`, tagged with `src` so the card can react to its own
 * build (D5, D6). The seat's Farmstead substitution is NOT passed here - the
 * task layer folds it in centrally, so no Dairy card has to remember it.
 */
function buildWith(fx: Fx, seat: Seat, src: CardId, mods: BuildMods, optional = false): void {
  fx.pushTask({ t: 'build', pid: seat, src, mods, ...(optional ? { optional: true } : {}) });
}

/**
 * The cover (D11) and demolish (D14) target set: your empty NON-STARTER
 * buildings. Ticket 30 - a starter is never a target, upgraded or not, because
 * each of the three breaks the game a different way and none of the breakages
 * was ever ruled in:
 *
 * - the Notice Board is v14's only visit target, so covering it is a one-card
 *   permanent opt-out from the hook (and D11 covers at a DISCOUNT, making it
 *   cheaper than a normal build);
 * - the Barn prints the hand limit, and `handLimitOf` reads a missing Barn as
 *   NO limit, silently stopping the design's master clock;
 * - the Farmstead carries the suit power and the free-flip milestone;
 * - and `demolish` puts the card in the barn where `barnTally` reads its
 *   printed `suit`, so demolishing a base starter minted a free delivery good
 *   plus 2 deck cards for nothing.
 *
 * This is also what keeps `noticeBoardOf`'s throw an invariant rather than a
 * reachable crash - see the note there.
 */
function emptyBuildings(data: GameData, state: GameState, seat: Seat): CardId[] {
  return player(state, seat)
    .tableau.filter((b) => b.stack.length === 0 && cardById(data, b.card).type !== 'starter')
    .map((b) => b.card);
}

/** D1 Barn (starter) - "Hand size 6." / upgraded "Hand size 8." */
export const dairyBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes: 'Hand size is engine-read from the printed face. The biggest barn in the game, 6 -> 8.',
  },
};

/**
 * D2 Farmstead (starter) - "BUILD: Substitute any card for another (not £)." /
 * upgraded adds "BUILD: you may BUILD again."
 */
export const dairyFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'Behaviour lives in the engine seams. Base: buildSubstitutePower waives the own-suit ' +
      'MINIMUM on every build by a Dairy seat - any N cards pay any cost - and never ' +
      'touches coins (DL-35; the card prints "not £"). It composes with every card-granted ' +
      'build because buildModsFor folds it in centrally. Upgraded: buildAgainPower arms ' +
      "turn.again = 'build' after the MAIN Build action only, the same ActionAgain gate as " +
      "the Wheat harvest repeat, so a Worker's build never repeats and the repeat is " +
      'declinable by endTurn.',
  },
};

/** D3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const dairyNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit, including the upgraded ' +
      "face's 2-cards-take-£3 mode, is engine-level.",
  },
};

/** D4 The Milking Shed - "Build, paying 1 fewer resource for each card already on the Milking Shed." */
export const milkingShed: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'READING: "already on" is counted AFTER the grow payment lands, because every ' +
      'activation in this engine (and in the reference) fires once the payment has joined ' +
      'the stack - so the card you just paid always counts, and a first activation is ' +
      'discount 1, not 0. At threshold 4 the Shed tops out at discount 4. Flagged to ' +
      'ticket 07: the alternative reading is "already" = before this payment.',
  },
  activate(fx, self) {
    const shed = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
    buildWith(fx, self.seat, self.card, { discount: shed?.stack.length ?? 0 });
  },
};

/** D5 The Churning Shed - "Build. You may sow 1 card you spent onto the new building." */
export const churningShed: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      "Needed to know what its OWN build spent, which is what the afterBuild hook's `src` " +
      'field is for - the Ledger reacts to every build, this reacts only to the one it ' +
      'granted. The spent cards are in their discards by then, so the sow reclaims one via ' +
      'placeFromDiscard onto the just-built card. Never fires on another build; auto-skips ' +
      'when the build was free, or when the new building cannot take a card (no threshold, ' +
      'or a threshold-0 shape).',
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
        // face-up cards we discarded - no reaching into the pile's history.
        const spent = (task.riders.spent as CardId[]).filter((id) =>
          state.discards[cardById(data, id).suit]?.includes(id),
        );
        if (spent.length === 0) return [];
        const out: TaskAnswer[] = spent.map((card) => ({ kind: 'card', payload: { card } }));
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('sowSpent expects a card answer');
        fx.placeFromDiscard(
          task.pid,
          { seat: task.pid, card: task.riders.built as CardId },
          answer.payload.card as CardId,
        );
        return true;
      },
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D6 The Trading Shed - "Build. Gain £1 if you spend 2 or more different card types." */
export const tradingShed: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '"Card types" = suits (the only type a payment card has). Reads the payment off its ' +
      'OWN build via afterBuild\'s src, so a Ledger-style "any build" reading is ' +
      'structurally impossible. Barn cards spent by a D8-style build would count too - they ' +
      'are in the same payment list.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      const suits = new Set(event.payment.map((id) => cardById(fx.data, id).suit));
      if (suits.size >= 2) fx.gainCoins(self.seat, 1, 'D6');
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/**
 * D7 The Versatile Shed - ticket 06 ruling H retext: "Build. You may spend up
 * to £2 as wild resources." The SHEET still prints the old "spend your Dairy
 * cards as any suit", pending ticket 13.
 */
export const versatileShed: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'IMPLEMENTS THE RULING, NOT THE SHEET: ticket 06 ruling H retexts this to "you may ' +
      'spend up to £2 as wild resources" because the printed text is a strict subset of the ' +
      "Dairy Farmstead's substitution and was therefore dead in the hands most likely to " +
      'hold it. Ticket 13 applies the wording to v14.xlsm; until then cards.json is stale ' +
      'here. It forced coinWild - the ONE place coins buy cards, deliberately carved out of ' +
      'the Farmstead\'s "not £" so the two can never be redundant again. The coins are paid ' +
      "ON TOP of the built card's own printed coin price.",
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { coinWild: 2 });
  },
};

/** D8 The Abundant Shed - "Build at a discount of 1. You may spend cards from your Barn as well as your hand." */
export const abundantShed: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'Forced the fromBarn mod. Barn cards join the payment as a per-suit TALLY, never ids, ' +
      'because the barn is anonymous even to its owner (viewFor) - so a policy can only ' +
      'ever name a suit there. They leave through spendFromBarn, exactly as a delivery ' +
      'spends them, and they land in the afterBuild payment list so D6 can see them.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 1, fromBarn: true });
  },
};

/**
 * D9 The Prosperity Wagon - "Build at a discount of 1. You may then WORK a
 * Hired Worker, if you do, gain £2 from bank."
 */
export const prosperityWagon: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'Ticket 06 ruling E, in full: ANY Worker including your own (owned: any); no card ' +
      'goes on a Notice Board, so it is not a visit and does NOT consume the bonus slot; ' +
      'unlike the Herb Hive it does not say "for free", so the meeple ADVANCES and a rival ' +
      'owner takes the normal track wage; the £2 mints to the actor only if the work ' +
      'happened (the actorCoins rider, paid on resolve, never on the skip). A Helping Hand ' +
      'cannot fire off it (ruling A). The hermit battery - build, work your own Worker, ' +
      'mint £2, no cross-table contact - was consciously accepted and goes to the sim.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 1 });
    fx.pushTask({
      t: 'chooseWorker',
      pid: self.seat,
      src: self.card,
      owned: 'any',
      progress: true,
      ownerCoins: 0,
      actorCoins: 2,
      optional: true,
    });
  },
};

/** D10 The Scout's Post - "Pay £3: build the top card of any deck for free." */
export const scoutsPost: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '"Pay £3:" prices the WHOLE effect (the O13/O14/V8 reading): under £3 the activation ' +
      'does nothing and the £3 is never spent on a dead deck. Free = no cards, no coin ' +
      'price, landed through placeBuilt so the Farmstead milestone still counts it. The ' +
      'deck pick is the choice; the card is whatever is on top, sight unseen.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'deckBuild', riders: { n: 1 } });
  },
  tasks: {
    deckBuild: {
      answers(data, state, task) {
        if (player(state, task.pid).coins < 3) return [];
        return drawableSuits(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('deckBuild expects a card answer');
        fx.payCoins(task.pid, 3, 'D10');
        const card = fx.takeDeckTop(answer.payload.suit as Suit);
        if (card !== null) placeBuilt(fx, task.pid, card, [], 0, task.src);
        return true;
      },
    },
  },
};

/** D11 The Heritage House - "Build on top of one of your empty buildings (never a starter), at a discount of 2. The covered card scores its VP at game end." */
export const heritageHouse: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      'The hardest card in the suit and the only one that REMOVES a building. Forced the ' +
      'covered pile in PlayerState: the covered card stops being a building - invisible to ' +
      'every endgame formula, every sub-type count and every placement - but its printed VP ' +
      "still scores, as a bare sum folded into `printed` (the reference's cover " +
      'semantics). Empty stacks only, so cards are never buried. Two chained choices: pick ' +
      'the victim, then build at discount 2; the cover happens FIRST, so the freed slot ' +
      'cannot be re-picked and the new card lands in a tableau that has already shrunk.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'cover', riders: {} });
  },
  tasks: {
    cover: {
      answers(data, state, task) {
        // Never the Heritage House itself: the grow payment is sitting on it.
        return emptyBuildings(data, state, task.pid)
          .filter((card) => card !== task.src)
          .map((card) => ({ kind: 'card', payload: { card } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('cover expects a card answer');
        fx.coverBuilding(task.pid, answer.payload.card as CardId);
        buildWith(fx, task.pid, task.src, { discount: 2 });
        return true;
      },
    },
  },
};

/** D12 The Butter Factory - "Build up to 2 buildings, each at a discount of 1." */
export const butterFactory: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '"Up to" = two OPTIONAL builds, each independently skippable and each at discount 1. ' +
      'The second is enumerated after the first resolves, so a card built by the first can ' +
      'pay for nothing and the hand it sees is the real one.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 1 }, true);
    buildWith(fx, self.seat, self.card, { discount: 1 }, true);
  },
};

/** D13 The Cheese Vault - "Pay £3: build the top 2 cards of any decks, for free." */
export const cheeseVault: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'D10 twice for one £3: the gate charges once, then PREPENDS two independent deck ' +
      'picks so they resolve before anything already queued behind the activation ' +
      '(the reference\'s prepend-the-free-builds shape). "Any decks" is per pick, so the ' +
      'two may differ. Under £3 the whole effect does nothing.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'vaultGate', riders: {} });
  },
  tasks: {
    vaultGate: {
      answers(data, state, task) {
        if (player(state, task.pid).coins < 3) return [];
        if (drawableSuits(data, state).length === 0) return [];
        return [{ kind: 'card', payload: { pay: true } }];
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('vaultGate expects a card answer');
        fx.payCoins(task.pid, 3, 'D13');
        // Prepended, so both free builds run before anything queued behind us.
        fx.prependTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'freeDeckBuild',
          riders: {},
        });
        fx.prependTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'freeDeckBuild',
          riders: {},
        });
        return true;
      },
    },
    freeDeckBuild: {
      answers(data, state) {
        return drawableSuits(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('freeDeckBuild expects a card answer');
        const card = fx.takeDeckTop(answer.payload.suit as Suit);
        if (card !== null) placeBuilt(fx, task.pid, card, [], 0, task.src);
        return true;
      },
    },
  },
};

/** D14 The Cream Refinery - "Demolish one of your empty buildings (never a starter): put it and the top 2 cards of any decks into your barn." */
export const creamRefinery: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Forced the demolish primitive. Unlike a D11 cover, a demolished building scores ' +
      'NOTHING - it stops being a building and becomes barn stock, i.e. delivery freight. ' +
      'That is the card: it converts a dead building plus 2 deck cards into 3 crates of ' +
      'freight. Empty buildings only (its own stack holds the grow payment, so it can ' +
      'never eat itself); mandatory, auto-skips when nothing of yours is empty.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'demolish', riders: {} });
  },
  tasks: {
    demolish: {
      answers(data, state, task) {
        return emptyBuildings(data, state, task.pid)
          .filter((card) => card !== task.src)
          .map((card) => ({ kind: 'card', payload: { card } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('demolish expects a card answer');
        fx.demolish(task.pid, answer.payload.card as CardId);
        for (let i = 0; i < 2; i++) {
          fx.pushTask({
            t: 'card',
            pid: task.pid,
            src: task.src,
            kind: 'deckToBarn',
            riders: {},
          });
        }
        return true;
      },
    },
    deckToBarn: {
      answers(data, state) {
        return drawableSuits(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('deckToBarn expects a card answer');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/** D15 The Grand Creamery - "Build with a discount of 1 for every Dairy building you have built." */
export const grandCreamery: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '"Dairy building you have built" = buildings printing the Dairy crop icon (ticket 07), ' +
      'so BASE starters do not count and upgraded ones do. The Creamery itself counts, so a ' +
      'Dairy player opens at discount 1 and climbs with real Dairy builds and starter ' +
      'flips - not the discount 4 the base starters used to hand out for free.',
  },
  activate(fx, self) {
    const dairy = cropBuildings(fx.data, fx.state, self.seat, 'dairy').length;
    buildWith(fx, self.seat, self.card, { discount: dairy });
  },
};

/** D16 The Ledger - "Whenever you Build, Draw 1." */
export const ledger: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'The card that pays for the afterBuild hook being universal: it fires on EVERY build ' +
      'by its owner - the Build action, the Build Worker, a card-granted build, a free ' +
      "deck-top build, each of D12's two, and each half of a Farmstead Build-again. Not a " +
      "rival's (owner-scoped). A card-ability draw, so no Orchard modifier (DL-47).",
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      fx.pushTask({ t: 'draw', pid: self.seat, src: self.card, see: 1, keep: 1, revealed: [] });
    },
  },
};

/** D17 The Strongbox - "Gain £1 from the bank whenever you HIRE or WORK a Hired Worker." */
export const strongbox: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'Actor-scoped, and the mirror image of A17 The Smoke Pot on the same afterWork hook: ' +
      'the Pot pays the OWNER when a rival works, the Strongbox pays YOU whenever you work ' +
      "anyone's - your own Worker on the bonus slot, a rival's via a visit, a Helping Hand " +
      'repeat, a Herb Hive free work, a Prosperity Wagon work. Plus £1 on your own hire ' +
      '(the afterHire hook), which is a straight rebate on half the fee.',
  },
  on: {
    afterWork(fx, event, self) {
      if (event.actor !== self.seat) return;
      fx.gainCoins(self.seat, 1, 'D17');
    },
    afterHire(fx, event, self) {
      if (event.seat !== self.seat) return;
      fx.gainCoins(self.seat, 1, 'D17');
    },
  },
};

/** D19 The Cheese Hall - "Score 1 VP for each non-Dairy building in your tableau." */
export const cheeseHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Buildings printing SOME crop icon that is not Dairy (ticket 07). Not the complement ' +
      'of the D15 count: a base starter prints the starting-building icon, so it is neither ' +
      'a Dairy building nor a non-Dairy one and scores nothing either way. That also stops ' +
      'this card penalising a Dairy seat for upgrading. A D11-covered card is not in the ' +
      'tableau and never counts.',
  },
  gameEnd(data, state, seat) {
    return foreignCropBuildings(data, state, seat, 'dairy').length;
  },
};

/** D20 The Counting House - "Score 1 VP for each of your buildings with a build cost of 4 or more." */
export const countingHouse: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '"Build cost" = the printed CARD cost (suit + wild), following the reference\'s ' +
      '"card cost >= 4" gloss. Starters have no build cost and never count; the £2 ' +
      'Power/Endgame cards have a card cost of 0, so they never count either.',
  },
  gameEnd(data, state, seat) {
    return player(state, seat).tableau.filter((b) => (cardCostOf(data, b.card) ?? 0) >= 4).length;
  },
};

/** D21 The Refinery - "Score 1 VP for each Dairy building you have built with a build cost of 1 to 3." */
export const refinery: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The band is 1 TO 3, not "3 or less", and the lower bound is what does the excluding. ' +
      'A starter has no build cost and the £2 Power and Endgame cards have a card cost of 0, ' +
      'so "3 or less" would count every one of them - including this card itself and any ' +
      'Helping Hand - and score for buying cheap coin cards rather than for building a cheap ' +
      'Dairy engine. Ticket 13 closed that hole with the word "tier" on the card; ticket 39 ' +
      'took the word back off (it was the only printed "tier" in the game and is taught ' +
      'nowhere) and let the arithmetic do it instead, so the print and this filter are now ' +
      'the same sentence. Equivalence is machine-checked in dairy.test.ts.',
  },
  gameEnd(data, state, seat) {
    return player(state, seat).tableau.filter((b) => {
      const card = cardById(data, b.card);
      if (card.suit !== 'dairy') return false;
      const cost = cardCostOf(data, b.card) ?? 0;
      return cost >= 1 && cost <= 3;
    }).length;
  },
};
