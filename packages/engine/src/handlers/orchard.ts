/**
 * Orchard handlers - all 21 cards (ticket 20). Card texts are quoted from
 * cards.json (the sheet is the single source of truth for wording).
 *
 * Suit identity: Draw. The load-bearing piece is the Farmstead as a DRAW
 * MODIFIER (query.ts withDrawModifier, attached in doDraw and the Draw
 * Worker's case): see +1 base, see +1 AND keep +1 upgraded, which reproduces
 * the printed "Draw 3, Keep 1 / Keep 2" on the base action and composes with
 * the Draw Worker - and deliberately never applies to card-ability draws
 * (reference DL-47), so every drawN below pushes its printed numbers.
 *
 * The gift family (O1 upgraded Barn / O10 / O14) follows the reference's
 * DL-63/DL-64/DL-81 rulings: a gift goes to a neighbour with FREE HAND SPACE
 * (limit minus hand size; never forces an out-of-turn discard), identity
 * travels with the card, and O10/O14's per-gift replacement draws are
 * choiceless own-suit-fallback autoDraws so a gift can never re-gift and O17
 * never fires on them. O1's £1 REPLACES the replacement draw (DL-81).
 *
 * ORCHARD is a sub-type derived from the whole-word title keyword, following
 * the reference (DL-42): O4-O8, O13, O16 and O20 - the Orchard Keeper and the
 * Orchard Archive included; the Fruit Stand / Cider House / Harvest Market /
 * Fruit Press / Conservatory / Garden Library / Fruit Basket are not.
 */

import type { GameData } from '@gp/data';

import { handLimitOf } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player, thresholdOf } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CardHandler, CustomTask } from './types.js';

const ORCHARD_NAME = /\bOrchard\b/;

/** ORCHARD sub-type membership, by whole-word title keyword (reference DL-42). */
export function isOrchardCard(data: GameData, id: CardId): boolean {
  return ORCHARD_NAME.test(cardById(data, id).name);
}

/** Every built ORCHARD sub-type card - O16/O20 included, no threshold filter (reference DL-68). */
function builtOrchardCount(data: GameData, state: GameState, seat: Seat): number {
  return player(state, seat).tableau.filter((b) => isOrchardCard(data, b.card)).length;
}

/**
 * The LOADABLE orchards - the sow-target set (reference DL-68): an ORCHARD
 * that prints a threshold (O4-O8, O13). The power/endgame orchards O16/O20
 * print none and are never sow targets.
 */
function loadableOrchards(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter(
    (b) => isOrchardCard(data, b.card) && thresholdOf(data, b) !== null,
  );
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck; no Farmstead modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** One optional sow per loadable orchard, targets snapshot now (the W12/A9 cascade pattern). */
function sowEachOrchard(fx: Fx, pid: Seat, src: CardId): void {
  for (const b of loadableOrchards(fx.data, fx.state, pid)) {
    fx.pushTask({ t: 'sow', pid, src, remaining: 1, targets: [b.card], optional: true });
  }
}

/** A neighbour's free hand space (reference DL-63): limit minus hand size, floored at 0. */
function freeHandSpace(data: GameData, state: GameState, seat: Seat): number {
  const limit = handLimitOf(data, state, seat);
  if (limit === null) return 0;
  return Math.max(0, limit - player(state, seat).hand.length);
}

/**
 * The shared `gift` task (O10/O14): give any number of hand cards to
 * neighbours, one card per answer, re-entrant; each recipient's live free
 * hand space caps what they can take. Skip finishes and draws one choiceless
 * own-suit-fallback replacement per gifted card ("Draw 1 for each" - DL-64;
 * autoDraw, so a replacement can never re-gift and O17 never fires).
 */
const giftTask: CustomTask = {
  answers(data, state, task) {
    const out: TaskAnswer[] = [];
    for (const card of player(state, task.pid).hand) {
      for (let seat = 0; seat < state.players.length; seat++) {
        if (seat === task.pid) continue;
        if (freeHandSpace(data, state, seat) < 1) continue;
        out.push({ kind: 'card', payload: { card, to: seat } });
      }
    }
    // Nothing giftable and nothing gifted: auto-skip (no refill owed).
    if (out.length === 0 && ((task.riders.gifted as number) ?? 0) === 0) return [];
    out.push({ kind: 'skip' });
    return out;
  },
  resolve(fx, task, answer) {
    if (answer.kind === 'skip') {
      fx.autoDraw(task.pid, (task.riders.gifted as number) ?? 0);
      return true;
    }
    if (answer.kind !== 'card') throw new Error('gift expects a card answer');
    fx.giveCard(task.pid, answer.payload.to as Seat, answer.payload.card as CardId);
    task.riders.gifted = ((task.riders.gifted as number) ?? 0) + 1;
    return false;
  },
};

/**
 * O1 Barn (starter) - "Hand size 4." / upgraded "Hand size 7. Once per turn:
 * gift 1 card from your hand, gain £1"
 */
export const orchardBarn: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Hand size is engine-read. The upgraded gift is a standing FREE action (reference ' +
      'DL-81): independent of the main action AND the bonus slot, once per turn (the ' +
      "turn.onceUsed flag it forced), any point in the owner's turn. Exactly 1 card, to a " +
      'neighbour with free hand space (never forces an out-of-turn discard), and the £1 ' +
      "REPLACES the gift family's replacement draw - no refill.",
  },
  moves(data, state, self) {
    if (state.turnPlayer !== self.seat) return [];
    if (state.turn.onceUsed.includes(self.card)) return [];
    const barn = player(state, self.seat).tableau.find((b) => b.card === self.card);
    if (!barn?.upgraded) return [];
    const out = [];
    for (const card of player(state, self.seat).hand) {
      for (let seat = 0; seat < state.players.length; seat++) {
        if (seat === self.seat) continue;
        if (freeHandSpace(data, state, seat) < 1) continue;
        out.push({
          type: 'cardMove' as const,
          seat: self.seat,
          card: self.card,
          kind: 'gift',
          payload: { card, to: seat },
        });
      }
    }
    return out;
  },
  applyMove(fx, self, move) {
    // Spend the once-per-turn use first (the reference commits the flag before the effect).
    fx.state.turn.onceUsed.push(self.card);
    fx.giveCard(self.seat, move.payload.to as Seat, move.payload.card as CardId);
    fx.gainCoins(self.seat, 1, 'O1');
  },
};

/** O2 Farmstead (starter) - "DRAW: Draw 3, Keep 1." / upgraded "DRAW: Draw 3, Keep 2." */
export const orchardFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in the engine seam, not this entry: withDrawModifier (query.ts) is ' +
      'the suit power as a MODIFIER - see +1 base, see +1 and keep +1 upgraded - attached ' +
      "where a Draw ACTION's numbers are set (doDraw, the Draw Worker's case), which " +
      'reproduces the printed absolute wording on the base draw ((2,1)->(3,1)/(3,2)) and ' +
      'composes with the Draw Worker ((3,2)->(4,2)/(4,3)) instead of colliding with it. ' +
      'Card-ability draws deliberately bypass it (reference DL-47).',
  },
};

/** O3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const orchardNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs (coin, ' +
      "worker, the upgraded face's 2-cards-take-£3 mode) and the wage minting - is " +
      'engine-level.',
  },
};

/** O4 The Apple Orchard - "Draw 1." */
export const appleOrchard: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
  },
};

/** O5 The Pear Orchard - "Draw 1, then SOW 1 onto one of your ORCHARDs" */
export const pearOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "One OPTIONAL sow over ALL loadable orchards (the reference's reading: pick the " +
      'orchard and the card, or skip). Sow is suit-free (2026-07-20 ruling); targets ' +
      'snapshot at activation, filtered live for fullness.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 1);
    fx.pushTask({
      t: 'sow',
      pid: self.seat,
      src: self.card,
      remaining: 1,
      targets: loadableOrchards(fx.data, fx.state, self.seat).map((b) => b.card),
      optional: true,
    });
  },
};

/** O6 The Cherry Orchard - "Draw 2, then gain £1." */
export const cherryOrchard: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes: '"Then gain £1" does not gate (the W15 reading): the £1 mints up front.',
  },
  activate(fx, self) {
    fx.gainCoins(self.seat, 1, 'O6');
    drawN(fx, self.seat, self.card, 2);
  },
};

/** O7 The Golden Orchard - "Draw 2" */
export const goldenOrchard: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
  },
};

/** O8 The Heritage Orchard - "Pay £1: Draw 4." */
export const heritageOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      "An OPTIONAL pay-gate (reference DL-66), unlike O13/O14's whole-effect price: pay " +
      '£1 then draw 4, or decline. Auto-skips when broke or no deck can be drawn, so the ' +
      '£1 is never wasted.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'payDraw', riders: {} });
  },
  tasks: {
    payDraw: {
      answers(data, state, task) {
        if (player(state, task.pid).coins < 1) return [];
        if (drawableSuits(data, state).length === 0) return [];
        return [{ kind: 'card', payload: { pay: true } }, { kind: 'skip' }];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        fx.payCoins(task.pid, 1, 'O8');
        drawN(fx, task.pid, task.src, 4);
        return true;
      },
    },
  },
};

/** O9 The Fruit Stand - "Draw 1 per empty ORCHARD you have. Then you may SOW onto all your ORCHARDs." */
export const fruitStand: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '"Empty ORCHARD" = a loadable orchard (prints a threshold) holding 0 cards - O16/O20 ' +
      'have no stack and never count (reference DL-68). Then one optional sow per loadable ' +
      'orchard, targets snapshot at activation (the A9 pattern).',
  },
  activate(fx, self) {
    const empty = loadableOrchards(fx.data, fx.state, self.seat).filter(
      (b) => b.stack.length === 0,
    ).length;
    drawN(fx, self.seat, self.card, empty);
    sowEachOrchard(fx, self.seat, self.card);
  },
};

/** O10 The Cider House - "Draw 2. You may give any number of cards to your neighbours; draw 1 for each." */
export const ciderHouse: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'The gift family (reference DL-63/64): a Draw 2, then the shared re-entrant gift ' +
      'task over the WHOLE post-draw hand - per-recipient capacity is live free hand ' +
      'space, and each gifted card is replaced on finish by a choiceless own-suit-fallback ' +
      'autoDraw (never a picker, never re-giftable, never fires O17).',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'gift', riders: { gifted: 0 } });
  },
  tasks: { gift: giftTask },
};

/** O11 The Harvest Market - "Draw 1 for each ORCHARD you have built." */
export const harvestMarket: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Counts ALL built ORCHARD sub-type cards - O16/O20 included, no threshold filter ' +
      '(reference DL-68). The Harvest Market itself is not an orchard.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, builtOrchardCount(fx.data, fx.state, self.seat));
  },
};

/** O12 The Fruit Press - "Draw 2 for every neighbour at their hand limit." */
export const fruitPress: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '"At their hand limit" = hand size >= the limit printed on their current Barn face ' +
      "(the reference's >= read). A pure read of public counts - no Fx contact with the " +
      'neighbours, so crossPlayer stays false in the audit.',
  },
  activate(fx, self) {
    let n = 0;
    for (let seat = 0; seat < fx.state.players.length; seat++) {
      if (seat === self.seat) continue;
      const limit = handLimitOf(fx.data, fx.state, seat);
      if (limit !== null && player(fx.state, seat).hand.length >= limit) n += 1;
    }
    drawN(fx, self.seat, self.card, 2 * n);
  },
};

/** O13 The Grand Orchard - "Pay £1: Draw 1 for each ORCHARD you have, then SOW onto each of your ORCHARDs." */
export const grandOrchard: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '"Pay £1:" prices the WHOLE effect (the V8/O14 reading): with <£1 the activation ' +
      'does nothing (the grow payment still landed). Draw N = built-orchard count ' +
      '(O16/O20 and itself included), then one optional sow per loadable orchard.',
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).coins < 1) return;
    fx.payCoins(self.seat, 1, 'O13');
    drawN(fx, self.seat, self.card, builtOrchardCount(fx.data, fx.state, self.seat));
    sowEachOrchard(fx, self.seat, self.card);
  },
};

/** O14 The Conservatory - "Pay £1: Draw up to your hand limit, then gift any number. Draw 1 for each card you gift." */
export const conservatory: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'The reference\'s hardest Orchard card. "Pay £1:" prices the whole effect (V8 ' +
      'reading). "Draw up to your hand limit" = fill-to-limit, N fixed at activation off ' +
      'the current hand (the drawn cards are then part of the hand the gift sees); an ' +
      'at-limit hand draws nothing but may still gift. Gift + per-gift autoDraw refill as ' +
      'on O10.',
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).coins < 1) return;
    fx.payCoins(self.seat, 1, 'O14');
    const limit = handLimitOf(fx.data, fx.state, self.seat);
    if (limit !== null) {
      drawN(fx, self.seat, self.card, Math.max(0, limit - player(fx.state, self.seat).hand.length));
    }
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'gift', riders: { gifted: 0 } });
  },
  tasks: { gift: giftTask },
};

/** O15 The Garden Library - "Draw 3, then immediately deliver." */
export const gardenLibrary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The deliver is the shared balloon-aware task (a balloon move IS a Deliver, DL-12) ' +
      'and is MANDATORY when an option exists (the follow-the-text convention); it ' +
      'auto-skips when nothing is deliverable.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 3);
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
};

/** O16 The Orchard Keeper - "When a neighbour VISITs, you draw 1 and they draw 1." */
export const orchardKeeper: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'The host-side visit reactor that forced the afterVisit hook: fires on ANY visit to ' +
      "the owner's board (coin, worker or the 2-card Special Orders mode), once per visit, " +
      'after the fee lands and before the payoff. Both draws are choiceless own-suit- ' +
      'fallback autoDraws (reference DL-67) - no picker, no O17, no recursion. A Helping ' +
      'Hand repeat is not a visit and never fires it. An ORCHARD by name (DL-42).',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.host !== self.seat) return;
      fx.autoDraw(event.host, 1);
      fx.autoDraw(event.visitor, 1);
    },
  },
};

/** O17 The Fruit Basket - "When you draw a card, you may pay £1 to place it directly into your barn." */
export const fruitBasket: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      "The only afterDrawKeep reactor (the hook it forced - the reference's onDraw " +
      'moment): fires when the owner KEEPS cards from any see/keep draw (action, Worker, ' +
      'card ability), never on autoDraws. Offers a per-card £1 divert of the just-kept ' +
      'ids still in hand, re-entrant, skip to stop; auto-skips when broke. The card goes ' +
      'hand -> own barn (the handToBarn primitive).',
  },
  on: {
    afterDrawKeep(fx, event, self) {
      if (event.seat !== self.seat) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'divert',
        riders: { cards: [...event.cards] },
      });
    },
  },
  tasks: {
    divert: {
      answers(_data, state, task) {
        const p = player(state, task.pid);
        if (p.coins < 1) return [];
        const divertable = (task.riders.cards as CardId[]).filter((c) => p.hand.includes(c));
        if (divertable.length === 0) return [];
        const out: TaskAnswer[] = divertable.map((card) => ({ kind: 'card', payload: { card } }));
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('divert expects a card answer');
        const card = answer.payload.card as CardId;
        fx.payCoins(task.pid, 1, 'O17');
        fx.handToBarn(task.pid, card);
        task.riders.cards = (task.riders.cards as CardId[]).filter((c) => c !== card);
        return (task.riders.cards as CardId[]).length === 0;
      },
    },
  },
};

/** O19 The Fruit Hall - "Score 1 VP for each empty space in your hand at game end. (max 4)" */
export const fruitHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Empty spaces = hand limit (current Barn face) minus hand size, floored at 0, capped at 4.',
  },
  gameEnd(data, state, seat) {
    const limit = handLimitOf(data, state, seat);
    if (limit === null) return 0;
    return Math.min(4, Math.max(0, limit - player(state, seat).hand.length));
  },
};

/** O20 The Orchard Archive - "Score 1 VP for each ORCHARD you have built." */
export const orchardArchive: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes: 'ORCHARD sub-type count - itself included (its name carries the word, DL-42).',
  },
  gameEnd(data, state, seat) {
    return builtOrchardCount(data, state, seat);
  },
};

/** O21 The Harvest Festival - "Score 1 VP for every 2 cards in other players' hands at game end." */
export const harvestFestival: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes: 'floor(total rival hand cards / 2) - one pool across all rivals, not per player.',
  },
  gameEnd(_data, state, seat) {
    const total = state.players.reduce((sum, p, s) => (s === seat ? sum : sum + p.hand.length), 0);
    return Math.floor(total / 2);
  },
};
