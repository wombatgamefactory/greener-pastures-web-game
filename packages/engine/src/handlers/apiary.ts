/**
 * Apiary handlers - all 21 cards, REBUILT (docs/apiary-suit-rebuild-v5.md, the
 * last of the five). Card texts are quoted from cards.json; the JSON leads and
 * the sheet follows for this one rebuild, which is the reverse of the standing
 * rule and is called out in the handoff.
 *
 * Suit identity, in one line:
 *
 *     Everybody else pays a card into a building to fire THAT building.
 *     Apiary pays a card into a building to fire a DIFFERENT one.
 *
 * There is no third keyword. The cards print "GROW another of your buildings
 * without placing a card", which SUBTRACTS from a verb the table already knows,
 * and that subtraction is the one genuinely new engine capability in the suit:
 *
 *   - no card is paid, so nothing lands and `afterPlacement` never fires
 *   - no crop is matched, because there is nothing to match it against
 *   - nothing advances, so the target's stack is untouched
 *   - a FULL building is a legal target, because the only reason a full
 *     building cannot be grown is that no card may be placed on it
 *
 * That last line is the whole design. 45.4% of turn boundaries find a seat's
 * Service clogged and a full building is dead weight to every other suit; to
 * Apiary it is a button, which is why this suit ships with no harvest valve at
 * all. The seam is `activateTargets` (actions.ts) and `activateOnly`
 * (runtime.ts); the task is `{ t: 'activate' }`.
 *
 * ⛔ THE RECURSION GUARD. A12 fires two buildings, one of which may be A5; A5
 * fires one, which may be A12. The ruling that closes it is `no card's text may
 * fire twice in a turn`, held in `turn.firedThisTurn` and enforced by FILTERING
 * THE OPTION OUT rather than by throwing - the bots probe by cloning and
 * replaying, so a guard that threw would surface as a crash inside probe.ts.
 *
 * ⛔ THE FARMSTEAD IS NOT HANDLER CODE, and both of the seams it used to own are
 * GONE (2026-08-11). The base power waived the crop match for every Apiary seat
 * from turn 1 - Dean: it "trivialises the suit" - and survives only as A6's
 * `anyCrop`. The upgraded face queued a free second placement on every GROW, and
 * A7's new text is word for word what that did, so it had to move: a starter may
 * not be a rung on its own tier cards' ladder. What replaced it is not a
 * consolation prize but a structural necessity - after A7's change all five
 * Tier 1 HIVEs are card-negative and nothing else in the suit refills the hand -
 * and it lives in `apiaryGrowBonus` (actions.ts), called from the GROW ACTION
 * branch in game.ts and nowhere else. A5, A6 and A12 do not trigger it, or The
 * Honey Hut draws three.
 *
 * HIVE is a sub-type derived from the whole-word title keyword (reference
 * DL-42) AND A TIER GUARD: **A4 to A8 and nothing else**. ⚠️ A13 The Queen's
 * Hive is named Hive and is NOT one - it is a Tier 3 ACTION with no stack, so
 * A9 and A11 would reach a building that cannot hold cards, and A10, A14 and
 * A20 would count it. The collision is known and Dean has been told; a rename
 * is a later theme pass, because `@building` derives the art filename from the
 * Name and every existing render resolves off it.
 */

import type { GameData, Suit } from '@gp/data';

import { activateTargets, growOptions } from '../actions.js';
import type { Fx } from '../fx.js';
import { canTakeCard, cardById, drawableSuits, foreignCropBuildings, player } from '../query.js';
import { doGrow } from '../runtime.js';
import type { BuildingRef, BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { actionMove, actionOpen } from './actionCard.js';
import type { CardHandler } from './types.js';

const HIVE_NAME = /\bHive\b/;

/**
 * HIVE sub-type membership: the whole-word title keyword AND Tier 1, so the set
 * is exactly A4 to A8. The Queen's Hive (A13) is a Tier 3 ACTION and is not a
 * HIVE; see the docblock.
 */
export function isHiveCard(data: GameData, id: CardId): boolean {
  const c = cardById(data, id);
  return c.type === 'tier1' && HIVE_NAME.test(c.name);
}

function hives(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isHiveCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (no draw modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Every seat but this one, in seat order. */
function rivals(state: GameState, seat: Seat): Seat[] {
  return state.players.map((_, s) => s).filter((s) => s !== seat);
}

/**
 * A NEIGHBOUR's buildings that can still take a card - the cross-table sow
 * target set (A4's replacement, A14's placement).
 *
 * ⚠️ A neighbour's Notice Board and Service ARE legal targets. They are
 * buildings, and the design says so with the denial watch attached: if
 * assertion 5 (clog as denial) moves off 0.5% / 0.1% / 0.0%, the dial is to
 * exclude them, so the filter is written once, here.
 */
function rivalSowTargets(data: GameData, state: GameState, seat: Seat): BuildingRef[] {
  return rivals(state, seat).flatMap((s) =>
    player(state, s)
      .tableau.filter((b) => canTakeCard(data, b))
      .map((b) => ({ seat: s, card: b.card })),
  );
}

/**
 * A1 Barn (starter) - "Hand size 5. When you build a HIVE, sow the top card of
 * any deck onto it." / upgraded "Hand size 7." plus the same rider.
 */
export const apiaryBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The printed hand size is still engine-read (handLimitOf off the current face). The ' +
      'rider mirrors W1 and O1 - on BOTH faces deliberately, or paying £2 to upgrade would ' +
      'delete it - but the payload is a PLACEMENT rather than a draw, which is the suit ' +
      'talking: a new HIVE arrives with a card already on it, so it is worth firing on the ' +
      'turn it lands. It fires on any build path, because afterBuild is the one funnel ' +
      'every landing goes through. Auto-skips when every deck is dry.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (!isHiveCard(fx.data, event.card)) return;
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: event.card }],
      });
    },
  },
};

/**
 * A2 Farmstead (starter) - "When you GROW, Draw 1." / upgraded "When you GROW,
 * Draw 1 and you may put 1 card from your hand into your barn."
 */
export const apiaryFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in an engine seam, not this entry: apiaryGrowBonus (actions.ts), ' +
      "called from apply()'s GROW ACTION branch in game.ts. ⛔ It must never move into " +
      'doGrow, which O13 The Grand Orchard and A6 The Garden Hive also call - a seam there ' +
      'would fire once per building grown and The Honey Hut would draw three. RULED: the ' +
      'Farmstead modifies the GROW ACTION, not card text that says GROW, so A5, A6 and A12 ' +
      'do not trigger it. Its draw is a card-ability draw, so no draw modifier applies ' +
      "(DL-47), and the upgraded face's handToBarn is optional and may whiff on an empty " +
      "hand, which is legal and silent. It is the suit's card-neutrality guarantee: after " +
      'the rebuild all five Tier 1 HIVEs are card-negative and nothing else refills the hand. ' +
      '⛔ BOTH OLD SEAMS ARE DELETED - the base crop waiver in growOptions/doGrow (it now ' +
      'lives on A6 alone) and the upgraded free sow (A7 prints that sentence now).',
  },
};

/** A3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const apiaryNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs (coin, ' +
      "Service, the upgraded face's 2-cards-take-£3 mode) and the wage minting - is " +
      'engine-level.',
  },
};

/**
 * A4 The Herb Hive - "GROW: Put 1 card from a neighbour's building into your
 * barn, and sow the top card of any deck in its place."
 */
export const herbHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Take the nectar, leave the pollen: their stack keeps the same NUMBER of cards, one ' +
      'of which becomes your barn freight. ⚠️ The card is TAKEN, NOT HARVESTED - no ' +
      'afterHarvest and no harvest hook of any kind - and the take resolves BEFORE the ' +
      'replacement lands, which is the only reason a full building has room for one. It ' +
      'forced stackCardToBarn to grow a `to` seat. The replacement is a sow onto a ' +
      "neighbour's farm, which is NOT a visit: no bonus slot, no Service, no wage, no " +
      "afterVisit - but it does fire afterPlacement, so a rival Beekeeper's Veil may draw " +
      'off it. Mandatory; auto-skips when no rival stack holds a card. ⚠️ The only card in ' +
      'the suit that TAKES: they get a fresh card back and their count does not change, but ' +
      'the card they lose is one they chose. Dial: restrict it to a building already full.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'takeFromRival', riders: {} });
  },
  tasks: {
    takeFromRival: {
      answers(_data, state, task) {
        const out: TaskAnswer[] = [];
        for (const seat of rivals(state, task.pid)) {
          for (const b of player(state, seat).tableau) {
            for (const card of b.stack) {
              out.push({ kind: 'card', payload: { seat, building: b.card, card } });
            }
          }
        }
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('takeFromRival expects a card answer');
        const seat = answer.payload.seat as Seat;
        const building = answer.payload.building as CardId;
        fx.stackCardToBarn(seat, building, answer.payload.card as CardId, task.pid);
        // Queued, not inline: the deck is the player's choice. The gap the take
        // just opened is what the enumerator will find.
        fx.pushTask({
          t: 'sowFromDeck',
          pid: task.pid,
          src: task.src,
          remaining: 1,
          targets: [{ seat, card: building }],
        });
        return true;
      },
    },
  },
};

/** A5 The Meadow Hive - "GROW another of your buildings without placing a card." */
export const meadowHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      "One half of the suit's signature and the card that forced the activate seam. The " +
      "target set is deliberately WIDER than a GROW's: a FULL building fires perfectly " +
      'well, because nothing is being placed on it. ⚠️ It clogs ITSELF at threshold 2 and ' +
      'that is a feature - A12 can still fire it, which is the loop the suit is built on ' +
      'and the way the trick teaches itself at the table. Auto-skips with nothing to fire, ' +
      "which is risk 1 (the cold start): measure the turn of a seat's first activation, and " +
      'if it is turn 8 or later the floor is to let this sow onto itself instead.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'activate',
      pid: self.seat,
      src: self.card,
      remaining: 1,
      targets: activateTargets(fx.data, fx.state, self.seat, [self.card]),
    });
  },
};

/** A6 The Garden Hive - "GROW another of your buildings with a card of any crop." */
export const gardenHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      'A REAL GROW through doGrow - a card paid onto the stack, the ability, the whole ' +
      'funnel - with one modifier, `anyCrop`, which is where the deleted Farmstead crop ' +
      'waiver now lives and the only place in the game it survives. The grown building IS ' +
      'marked fired, so it cannot be fired again this turn, and its own activation resolves ' +
      'normally (A6 into A12 is the best turn in the suit: three activations for three ' +
      'cards). "Another" excludes this card, and O13\'s task at orchard.ts is the ' +
      'enumeration precedent. Full buildings drop out - unlike A5, this one places.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'growAny', riders: {} });
  },
  tasks: {
    growAny: {
      answers(data, state, task) {
        return growOptions(data, state, task.pid, {
          anyCrop: true,
          exclude: [task.src],
        }).map(
          (o) =>
            ({ kind: 'card', payload: { building: o.building, payment: o.payment } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('growAny expects a card answer');
        doGrow(fx, task.pid, answer.payload.building as CardId, answer.payload.payment as CardId, {
          anyCrop: true,
        });
        return true;
      },
    },
  },
};

/** A7 The Foraging Hive - "GROW: Sow 1 card from your hand onto another of your buildings." */
export const foragingHive: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "The tier's floor and its first build, at a cost of 1: it touches no deck, takes " +
      'nothing from anybody, and does the one thing a new Apiary player must do before any ' +
      'of the rest works - get cards onto buildings so there is something worth firing. ' +
      'Imperative sow = mandatory (the ticket 18/19 convention), suit-free, "another" ' +
      'excludes this card, targets snapshot at activation and re-checked live. ⚠️ Its text ' +
      'is word for word what the upgraded Farmstead used to do, which is why the Farmstead ' +
      "moved: a starter may not be a rung on its own tier cards' ladder.",
  },
  activate(fx, self) {
    const targets = player(fx.state, self.seat)
      .tableau.filter((b) => b.card !== self.card)
      .map((b) => ({ seat: self.seat, card: b.card }));
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets });
  },
};

/**
 * A8 The Wild Hive - "GROW: Put the top card of any deck into a neighbour's
 * barn and take £1 from the bank."
 */
export const wildHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The only £ in the tier, and the gift goes STRAIGHT INTO THEIR BARN: no threshold ' +
      'advanced, no clog caused, no argument about whether it helped. ⚠️ NO ELIGIBLE ' +
      'NEIGHBOUR MEANS NO COIN - the coin is paid for the gift, so it lives in the resolver ' +
      'and the whole task auto-skips when every deck is dry. ⛔ Its £1 activation surcharge ' +
      'and its needsDesignReview flag are both GONE; activationSurchargeOf stays in the ' +
      'engine, data-driven, with nothing in the catalogue using it.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'giftDeckTop', riders: {} });
  },
  tasks: {
    giftDeckTop: {
      answers(data, state, task) {
        const out: TaskAnswer[] = [];
        for (const seat of rivals(state, task.pid)) {
          for (const suit of drawableSuits(data, state)) {
            out.push({ kind: 'card', payload: { seat, suit } });
          }
        }
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('giftDeckTop expects a card answer');
        fx.deckTopToBarn(answer.payload.seat as Seat, answer.payload.suit as Suit);
        fx.gainCoins(task.pid, 1, 'A8');
        return true;
      },
    },
  },
};

/** A9 The Pollinator Trail - "GROW: Sow the top card of any deck onto each of your HIVEs." */
export const pollinatorTrail: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'FUEL THE ROW: one sowFromDeck task per HIVE with room, each naming that HIVE alone, ' +
      "so the deck is the player's choice and the target is not. Full HIVEs are skipped " +
      'rather than banked. Targets snapshot at activation. ⚠️ Its closest relative is now ' +
      "A13 The Queen's Hive, one tier up - sow a deck top onto each HIVE against sow each " +
      "deck top onto your buildings; flagged as the suit's tightest internal pair.",
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (!canTakeCard(fx.data, b)) continue;
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: b.card }],
      });
    }
  },
};

/** A10 The Cross-Pollinator - "GROW: Draw 1 for each of your HIVEs." */
export const crossPollinator: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "FEED THE HAND, and it is the tier's answer to its own problem: the whole of Tier 1 " +
      'spends cards and this is where they come back. Counts HIVEs BUILT (A4-A8), not full ' +
      'ones, so five is the ceiling and the hand limit caps it below that anyway - Draw 5 ' +
      'into a hand of 5 cannot run away. ⛔ RETEXTED: it printed a HIRE discount, then a ' +
      'Service discount named by id in actions.ts; both are gone and ownServiceDiscount ' +
      'with them.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, hives(fx.data, fx.state, self.seat).length);
  },
};

/** A11 The Wax Workshop - "GROW: Put 1 card from each of your HIVEs into your barn." */
export const waxWorkshop: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'SKIM THE ROW. ⚠️ ONE CARD PER HIVE, not one per card on the stack: a task per loaded ' +
      'HIVE, each choosing which of that stack goes. Not a harvest - stackCardToBarn, so no ' +
      'afterHarvest fires and the HIVE reopens by one rather than emptying. With the colour ' +
      'harvest gone this is one of only four routes Apiary has to the barn (with A4, the ' +
      "upgraded Farmstead and the plain Harvest), which is risk 4: read the suit's " +
      'cards-into-barn against the set. ⚠️ Deliberate anti-synergy with A21, which pays for ' +
      'leaving stacks loaded.',
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (b.stack.length === 0) continue;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'skimHive',
        riders: { target: b.card },
      });
    }
  },
  tasks: {
    skimHive: {
      answers(_data, state, task) {
        const target = player(state, task.pid).tableau.find(
          (b) => b.card === (task.riders.target as CardId),
        );
        if (!target) return [];
        return target.stack.map((card) => ({ kind: 'card', payload: { card } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('skimHive expects a card answer');
        fx.stackCardToBarn(task.pid, task.riders.target as CardId, answer.payload.card as CardId);
        return true;
      },
    },
  },
};

/** A12 The Honey Hut - "GROW 2 of your other buildings without placing a card." */
export const honeyHut: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      'The strongest single action in the deck: two firings for one card where everybody ' +
      'else gets one for one. ⚠️ TWO DIFFERENT BUILDINGS, never the same one twice - the ' +
      'enumerator drops anything in turn.firedThisTurn, which is also what makes A12 -> A5 ' +
      '-> A12 terminate. Full buildings are legal, and firing a clogged A5 is the loop the ' +
      'suit is built on. ⚠️ Dean\'s own note is "may be too strong, but ok for now"; the ' +
      'dial, written down so it is not re-derived later, is ONE activation plus Draw 1. ' +
      'A5 and A12 are a deliberate two-rung ladder on one verb, allowed because the ladder ' +
      'IS the suit and no Tier 3 sits on it.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'activate',
      pid: self.seat,
      src: self.card,
      remaining: 2,
      targets: activateTargets(fx.data, fx.state, self.seat, [self.card]),
    });
  },
};

/** A13 The Queen's Hive (ACTION) - "Sow the top card of each deck onto your buildings." */
export const queensHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE SWARM: the quantifier is EACH DECK, so it is one sowFromDeck task per drawable ' +
      'suit with the suit FIXED - the choice left is which of your buildings each card ' +
      'lands on. ⚠️ Fixed order, one per deck, and a deck with no room anywhere WHIFFS ' +
      'rather than banking. ⚠️ NOT a HIVE despite the name (the tier guard on isHiveCard), ' +
      'so it never counts for A10, A20 or its own targets - it has no stack at all. ⚠️ Five ' +
      'deck tops in one action, so it is deck-top pressure: read reshuffles per played deck ' +
      'before anything else. If the arm says Apiary is freight-starved, the colour harvest ' +
      'comes back HERE.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const room = player(state, self.seat).tableau.some((b) => canTakeCard(data, b));
    return actionMove(
      self,
      actionOpen(state, self) && room && drawableSuits(data, state).length > 0,
    );
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    const own = player(fx.state, self.seat).tableau.map((b) => ({
      seat: self.seat,
      card: b.card,
    }));
    for (const suit of drawableSuits(fx.data, fx.state)) {
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: own,
        suit,
      });
    }
  },
};

/**
 * A14 The Honeycomb Tower (ACTION) - "Sow the top card of any deck onto a
 * neighbour's building. Take £1 from the bank for each of your HIVEs."
 */
export const honeycombTower: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'THE ROUND, and a build-around: at two HIVEs it is not worth an action, at five it is ' +
      'the best action in the game. ⚠️ THE FIRST REPEATABLE COIN FAUCET IN THE GAME (risk ' +
      '2) - every other Tier 3 pays in a resource with a natural cap and coins have none. ' +
      'THE METER IS THE SOW: every use hands a rival a card of freight and advances one of ' +
      'their thresholds, so a seat printing £5 a turn is feeding the table 25 cards a game ' +
      'and eventually the legal targets clog. A real brake at two seats, a weak one at four. ' +
      'The £1 rate is the first sweep in the arm; read it against total coins in play and ' +
      "the market's play rate, never against this card's own. ⚠️ No legal rival building " +
      'means no sow and no coins: `moves` gates on a target existing, which is why the coins ' +
      'may be minted before the task resolves.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const live =
      drawableSuits(data, state).length > 0 && rivalSowTargets(data, state, self.seat).length > 0;
    return actionMove(self, actionOpen(state, self) && live);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    const wage = hives(fx.data, fx.state, self.seat).length;
    if (wage > 0) fx.gainCoins(self.seat, wage, 'A14');
    fx.pushTask({
      t: 'sowFromDeck',
      pid: self.seat,
      src: self.card,
      remaining: 1,
      targets: rivalSowTargets(fx.data, fx.state, self.seat),
    });
  },
};

/**
 * A15 The Royal Apiary (ACTION) - "Put the top card of each deck into any
 * neighbour's barn. Take £2 from the bank for each."
 */
export const royalApiary: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'THE CROSS-TABLE FAUCET. "Any neighbour" means PER CARD, so the five may be split ' +
      'however you like - one task per drawable deck, each choosing who receives. £10 to ' +
      'you, five cards of freight out. ⚠️ Coins score nothing and the market sits at 0.1 ' +
      'buys a game because nobody ever has £3 spare; this card and A14 are the only reason ' +
      'the market has ever had to exist, so READ ITS PLAY RATE AGAINST MARKET BUYS and not ' +
      'on its own. ⚠️ Duplicates V15 The International Port in shape (V15 gives one card to ' +
      'every player at £1 then Delivers); flagged, not resolved, until a pass across all ' +
      'five suits. No recipient means no card and no coins.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const live = drawableSuits(data, state).length > 0 && rivals(state, self.seat).length > 0;
    return actionMove(self, actionOpen(state, self) && live);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    for (const suit of drawableSuits(fx.data, fx.state)) {
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'consign',
        riders: { suit },
      });
    }
  },
  tasks: {
    consign: {
      answers(data, state, task) {
        const suit = task.riders.suit as Suit;
        if (!drawableSuits(data, state).includes(suit)) return [];
        return rivals(state, task.pid).map(
          (seat) => ({ kind: 'card', payload: { seat } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('consign expects a card answer');
        fx.deckTopToBarn(answer.payload.seat as Seat, task.riders.suit as Suit);
        fx.gainCoins(task.pid, 2, 'A15');
        return true;
      },
    },
  },
};

/**
 * A16 The Beekeeper's Veil - "Whenever you place a card that brings a building's
 * stack to 2 cards, Draw 1." UNCHANGED by the rebuild, text and handler: the one
 * row in the suit that survives untouched.
 */
export const beekeepersVeil: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Placer-scoped placement reactor (ruling G): stack POSITION 2, any board - your own ' +
      'grow payment or sow, or your visit fee landing on a Notice Board holding one card. ' +
      'Never fires when a rival brings YOUR building to 2. No per-turn limit. It pairs ' +
      'properly with this rebuild without a word changing: A7, A9, A13, A17, A14 and the ' +
      'Barn rider all place cards.',
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.stackSize !== 2) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/**
 * A17 The Smoke Pot - "Whenever you VISIT a neighbour, sow the top card of any
 * deck onto one of your buildings."
 */
export const smokePot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⚠️ VISITOR-SIDE, where O16 The Orchard Keeper is host-side on the same hook - that ' +
      'is the guard, `event.visitor === self.seat`. Dean\'s "draw a card every time you ' +
      'visit" paid in this suit\'s currency, because O16 already prints the literal ' +
      'sentence; the revert is one word if Apiary should take the draw and Orchard move. ' +
      'A Helping Hand repeat is not a visit and never fires afterVisit, so it never fires ' +
      'this. ⛔ RETEXTED: it paid on WORK, a verb that no longer exists. The afterWork hook ' +
      'itself stays - D17 and the Service metrics use it.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.visitor !== self.seat) return;
      fx.pushTask({ t: 'sowFromDeck', pid: self.seat, src: self.card, remaining: 1 });
    },
  },
};

/** A19 The Honey Hall - "Game end: 3 VP for each non-Apiary building you have built." */
export const honeyHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE MANY FLOWERS, and it pays for your own decision on the mechanism: Apiary pays no ' +
      'crop cost to fire a building, so a foreign Tier 2 or Tier 3 in an Apiary tableau is ' +
      'a better card than it is in the tableau of the suit that printed it. Buildings ' +
      'printing SOME crop icon that is not Apiary (ticket 07) - a base starter prints the ' +
      'starting-building icon, so it is neither, which stops this penalising an upgrade. ' +
      '⚠️ Duplicates D19 The Cheese Hall in shape at three times the rate; the two rates ' +
      "should be set together, later. ⚠️ Watch for an Apiary seat building somebody else's " +
      'Tier 3 and firing it every turn (risk 5).',
  },
  gameEnd(data, state, seat) {
    return 3 * foreignCropBuildings(data, state, seat, 'apiary').length;
  },
};

/** A20 The Apiarist's Guild - "Game end: 2 VP for each HIVE you have built." */
export const apiaristsGuild: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE DEPTH OF THE APIARY: the HIVE sub-type count, which under the tier guard is A4 ' +
      "to A8 and nothing else, capping at 10 VP. ⚠️ A13 The Queen's Hive is named Hive and " +
      'does NOT count. Matches W21, O20 and D21 - a house convention.',
  },
  gameEnd(data, state, seat) {
    return 2 * hives(data, state, seat).length;
  },
};

/** A21 The Wax Hall - "Game end: 1 VP for each of your buildings that has a card on it." */
export const waxHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "THE FARM STILL IN USE, and the suit's identity as a scoring condition: every other " +
      'seat ends the game trying to empty its farm, and Apiary is the only one that can ' +
      'leave the stacks loaded and still have used them. ⚠️ STARTERS COUNT if they hold a ' +
      'card, which includes a clogged Notice Board or Service - intended, and a real ' +
      'interaction with being visited a lot. Powers and endgame cards have no stack and ' +
      'never count. ⚠️ Deliberate anti-synergy with A11, which exists to empty them.',
  },
  gameEnd(_data, state, seat) {
    return player(state, seat).tableau.filter((b) => b.stack.length >= 1).length;
  },
};
