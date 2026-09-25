/**
 * The Vegetable suit, REBUILT (docs/vegetable-suit-rebuild-v4.md).
 *
 * ⭐ SHEET v42 (16/09/2026, R8): VEGETABLE IS THE BARN SUIT. Every card below is
 * tested against its v42 text; the builder defaults are those of
 * docs/vegetable-token-island-handoff-2026-09-16-v1.md §5. Things new to the
 * engine that this file is mostly about:
 *
 *   1. **The island's tokens are mutable** - V5 swaps two. In 105 cards nothing
 *      else writes to the shared board, so the tests check the rule from both
 *      ends: the token moves, AND a tile that could not be paid becomes payable.
 *   2. **One delivery may take every receipt a tile has left** (V14): pay once,
 *      take both tokens on a virgin tile, then the building is destroyed.
 *   3. **"Discard a card from your Barn"** (V8, V10, V12, V15) and the hook it
 *      fires (V17), which a delivery payment never fires (R6).
 *   4. **Receipts by crop and value** (V19, V20, V21).
 *
 * A fifth thing is new as of 19/08/2026 and it is a DELETION: the Tier 3 ACTION
 * card is gone (Dean: "The concept of an ACTION was never requested. They are
 * all GROW."). V13, V14 and V15 are ordinary owner-activated buildings now, so
 * every test below drives them through `grow` rather than through
 * `apply(... cardMove ...)`, and nothing in the suit spends the main action from
 * inside a handler any more.
 *
 * Testkit island at 2 seats (['vegetable', 'wheat']): the token island, dealt
 * unshuffled, so A1 holds the vegetable 6 and 5, A2 the vegetable 4 and 3, and
 * the wheat tokens follow on A5. A delivery is always 4 cards.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import type { GameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { deliverOptions } from '../actions.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { cardById, buildingOf, player } from '../query.js';
import type { CardId, GameState, Move, Seat, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, deliveredAt, loadStack, makeState, noMeeples } from '../testkit.js';
import type { Applied } from '../runtime.js';
import { registeredCards, handlerFor } from './registry.js';

const VEG = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['vegetable', 'wheat']);
}

/** Move specific ids from their decks into a seat's barn. */
function barnTo(state: GameState, seat: Seat, ...cards: CardId[]): void {
  for (const card of cards) {
    const suit = cardById(data, card).suit;
    const deck = state.decks[suit];
    const i = deck.indexOf(card);
    if (i < 0) throw new Error(`${card} is not in the ${suit} deck`);
    deck.splice(i, 1);
    player(state, seat).barn.push(card);
  }
}

function tile(state: GameState, id: string) {
  const t = state.island.tiles.find((x) => x.tile === id);
  if (!t) throw new Error(`Tile ${id} is not in play`);
  return t;
}

/**
 * Activate a building, having first put a matching payment card in hand. Every
 * Vegetable deck card below activates on a `vegetable` card, so one helper
 * serves the whole suit.
 */
function grow(state: GameState, seat: Seat, building: CardId, payment: CardId) {
  dealTo(data, state, seat, payment);
  return growBuilding(data, state, seat, building, payment);
}

// --- The starters -----------------------------------------------------------

/**
 * ⭐ THE BARN PRINTS THE OWN-CROP SCORER (v42): "Game end: 1 VP for each
 * Vegetable card you have built." Before v42 it printed nothing (v31), which
 * took the old "When you build a DEPOT, Draw 2" with it; that rider is still
 * gone, so a build draws nothing.
 */
describe('V1 Barn - the own-crop scorer, and no DEPOT build refund', () => {
  it('draws nothing when its owner builds a Tier 1 card, and prints the v42 scorer', () => {
    const s = base();
    dealTo(data, s, VEG, 'V4', 'V5'); // V4 costs 1 vegetable; V5 pays for it
    const out = apply(data, s, { type: 'build', seat: VEG, card: 'V4', payment: ['V5'] });
    expect(out.state.tasks.some((t) => t.t === 'draw')).toBe(false);
    expect(cardById(data, 'V1').abilityText).toBe(
      'Game end: 1 VP for each Vegetable card you have built.',
    );
    expect(handlerFor('V1')?.on).toBeUndefined();
    expect(handlerFor('V1')?.gameEnd).toBeTypeOf('function');
  });
});

/**
 * ⛔ THE VEGETABLE FARMSTEAD'S HEAD IS GONE (v31), AND IT TOOK THE LARGEST PIECE
 * OF ENGINE SURFACE ANY SUIT POWER OWNED WITH IT: `deliverHeadSize`,
 * `deliverDeckHead`, `deckHeadCandidates`, `headCandidates`, `withHead` and the
 * `head` / `deckHead` fields on every deliver option, move and task answer. Ten
 * tests go with it, and TWO FINDINGS FROM THEM OUTLIVE THE CARD:
 *
 *   1. **The word "first" WAS the card.** Until 2026-08-09 it fired on
 *      `afterDeliver`, which fires AFTER the payment, so the card it moved could
 *      not help pay for the delivery that triggered it. You had to already be
 *      able to deliver in order to earn the fuel for the next delivery, which is
 *      a circle, and it is why the card was worth 1.5 VP a game in a suit that
 *      needed four. A SUIT POWER BELONGS UPSTREAM OF THAT SUIT'S BOTTLENECK.
 *   2. **A head had to ride on the ANSWER, not be re-derived at resolution.** It
 *      was loaded before the payment and was frequently the only reason the
 *      payment was affordable, so an answer that dropped it was an answer the
 *      barn could not pay. V14's `sweepDeliver` - which builds its own `card`
 *      payload by hand rather than getting the wiring for free - shipped that bug.
 *
 * The pruning rule they shared is general and is still in the code: a rider is
 * only worth offering when it CHANGES WHAT YOU CAN PAY.
 */
describe('V2 Farmstead - the own-crop end-game scorer', () => {
  /** Deliver moves offered to a seat, for a tile. */
  function deliversTo(state: GameState, seat: Seat, tile: string) {
    return legalMoves(data, state).filter(
      (m) => m.type === 'deliver' && m.seat === seat && m.tile === tile,
    ) as Extract<Move, { type: 'deliver' }>[];
  }

  /**
   * ⛔ THE HEAD IS GONE, STATED AS THE CASE IT USED TO PASS. A1 wants 4
   * vegetable; three in the barn and a fourth in hand was exactly the position
   * the word "first" existed for, and it was payable. It is not payable now, by
   * any seat, and the hand might as well be empty.
   */
  it('a tile the barn cannot pay stays unpayable, whatever the hand holds', () => {
    const s = base();
    // ⚠️ CARD-ONLY: since 05/09/2026 a meeple pays an island CRATE as well (R15),
    // so the five a seat starts with would pay the tile this case says is
    // unpayable. The claim under test is about the BARN and the hand.
    noMeeples(s);
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    dealTo(data, s, VEG, 'V9', 'V10');
    expect(deliversTo(s, VEG, 'A1')).toHaveLength(0);
  });

  /**
   * ...and the barn alone still pays it, which is what says the tile itself is
   * unchanged and only the head has gone.
   */
  it('the barn alone still pays a tile it covers', () => {
    const s = base();
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    // ⭐ The token island (16/09/2026): one payment is offered once per token,
    // so an untouched tile offers it twice and this takes the 6 VP token.
    const offered = deliversTo(s, VEG, 'A1');
    expect(offered).toHaveLength(2);
    const six = offered.find((m) => m.token === 0);
    const done = apply(data, s, six as Move).state;
    expect(player(done, VEG).barn).toHaveLength(0);
    expect(player(done, VEG).receipts).toEqual([{ vp: 6, crop: 'vegetable', tile: 'A1' }]);
  });

  /**
   * THE SCORER, with the two readings that matter: a starter counts for nothing
   * (it prints the generic starting-building icon) and a foreign crop counts for
   * nothing either.
   */
  it('V2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4', 'V9', 'W4');
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(2);
  });

  it('V2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[VEG]?.endgame).toBe(0);
  });

  it('belongs to the Vegetable seat and to nobody else', () => {
    const s = base();
    buildFor(data, s, WHEAT, 'W4', 'W5');
    // The Wheat seat holds no Vegetable Farmstead, so its two Wheat cards score
    // nothing here - W2's own line is a Wheat one and lives in wheat.test.ts.
    expect(gameEndScores(data, s)[VEG]?.endgame).toBe(0);
  });
});

// --- The DEPOTs -------------------------------------------------------------

/** The card a task came from, or null for a task that names none. */
function srcOf(task: Task): CardId | null {
  return 'src' in task ? task.src : null;
}

/** Answer the head task with the first answer matching a payload. */
function answerWith(state: GameState, match: Record<string, unknown>): Applied {
  const pick = pendingAnswers(data, state).find(
    (a) => a.kind === 'card' && Object.entries(match).every(([k, v]) => a.payload[k] === v),
  );
  if (pick === undefined) throw new Error(`No answer matching ${JSON.stringify(match)}`);
  return answerTask(data, state, pick);
}

/** The crops in a seat's barn, sorted. */
function barnCrops(state: GameState, seat: Seat): string[] {
  return player(state, seat)
    .barn.map((id) => cardById(data, id).suit)
    .sort();
}

/**
 * Answer the head task with the first answer matching a payload, against a
 * NAMED game data - for the `supplyHouseBarnDrain` and
 * `dockworkersUnionDrawOnDiscard` knob tests below, where the state was built
 * off a `loadGameData` variant rather than the module-level `data`.
 */
function pickWith(gd: GameData, state: GameState, match: Record<string, unknown>): GameState {
  const found = pendingAnswers(gd, state).find(
    (a) => a.kind === 'card' && Object.entries(match).every(([k, v]) => a.payload[k] === v),
  );
  if (found === undefined) throw new Error(`No answer matching ${JSON.stringify(match)}`);
  return answerTask(gd, state, found).state;
}

describe('V4 The Market Stall Depot - a hand card into a small barn (RETEXTED v48, R10)', () => {
  it('with 3 or fewer barn cards, places a chosen hand card into the barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'W4', 'W5', 'W6'); // barn at 3
    dealTo(data, s, VEG, 'O4'); // a hand card besides the activation payment
    const out = grow(s, VEG, 'V4', 'V10').state; // V10 pays the GROW and leaves the hand
    expect(out.tasks[0]).toMatchObject({ t: 'handToBarn', pid: VEG, src: 'V4', remaining: 1 });
    expect(player(out, VEG).hand).toEqual(['O4']);
    const done = answerTask(data, out, { kind: 'handToBarn', card: 'O4' }).state;
    expect(player(done, VEG).barn).toHaveLength(4);
    expect(player(done, VEG).barn).toContain('O4');
    expect(player(done, VEG).hand).toEqual([]);
    expect(done.tasks).toHaveLength(0);
  });

  it('with 4 barn cards, does nothing at all', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'W4', 'W5', 'W6', 'W7'); // barn at 4, one over the threshold
    dealTo(data, s, VEG, 'O4');
    const out = grow(s, VEG, 'V4', 'V10').state;
    expect(out.tasks).toHaveLength(0);
    expect(player(out, VEG).barn).toHaveLength(4);
    expect(player(out, VEG).hand).toEqual(['O4']); // untouched
  });

  it('with an empty hand (the activation payment was the only card), does nothing', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'W4', 'W5', 'W6'); // barn at 3, so the condition is met
    const out = grow(s, VEG, 'V4', 'V10').state; // 'V10' was the only hand card, now spent
    expect(player(out, VEG).hand).toEqual([]);
    // The handToBarn task offers no answer on an empty hand and drains itself.
    expect(out.tasks).toHaveLength(0);
    expect(player(out, VEG).barn).toHaveLength(3);
  });
});

describe('V6 The Trade Depot - discard 2 Barn cards, THEN add 2 deck tops, THEN Draw 2 (v47, R4)', () => {
  it('with a Barn of 0 or 1, does nothing at all - no discard, no add, no Draw 2', () => {
    for (const barn of [[], ['W4']] as CardId[][]) {
      const s = base();
      buildFor(data, s, VEG, 'V6');
      barnTo(s, VEG, ...barn);
      const out = grow(s, VEG, 'V6', 'V10').state;
      expect(out.tasks, `barn=${barn.length}`).toHaveLength(0);
      expect(barnCrops(out, VEG), `barn=${barn.length}`).toEqual(barn.map(() => 'wheat'));
      expect(out.discards.wheat, `barn=${barn.length}`).not.toContain('W4');
    }
  });

  it('with a Barn of 2+, discards both first, THEN adds 2 deck tops, THEN draws 2, in that printed order', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'O4');
    let out = grow(s, VEG, 'V6', 'V10').state;
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });
    // R6: mandatory once legal - no skip is ever offered.
    expect(pendingAnswers(data, out)).not.toContainEqual({ kind: 'skip' });

    const first = answerWith(out, { suit: 'wheat' });
    out = first.state;
    expect(out.discards.wheat).toContain('W4');
    expect(first.events).toContainEqual({
      e: 'barnDiscarded',
      seat: VEG,
      suit: 'wheat',
      card: 'W4',
      src: 'V6',
    });
    expect(barnCrops(out, VEG)).toEqual(['orchard']);
    // Neither the deck-to-barn adds nor the draw appear until BOTH discards
    // have landed.
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });

    const second = answerWith(out, { suit: 'orchard' });
    out = second.state;
    expect(out.discards.orchard).toContain('O4');
    expect(barnCrops(out, VEG)).toEqual([]);
    // Both discards done: the adds are queued next, THEN the draw behind them.
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'deckToBarn' });
    expect(out.tasks[1]).toMatchObject({ t: 'draw', src: 'V6', see: 2, keep: 2 });

    // R7: each incoming card names its own deck freely, not tied to what left.
    out = answerWith(out, { suit: 'dairy' }).state;
    out = answerWith(out, { suit: 'apiary' }).state;
    expect(barnCrops(out, VEG)).toEqual(['apiary', 'dairy']);
    expect(out.tasks[0]).toMatchObject({ t: 'draw', src: 'V6', see: 2, keep: 2 });
  });

  it('the two incoming cards may come from two different decks, freely chosen (R7, no pairing)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'W5'); // two barn cards of the SAME crop
    let out = grow(s, VEG, 'V6', 'V10').state;
    out = answerWith(out, { suit: 'wheat' }).state;
    out = answerWith(out, { suit: 'wheat' }).state;
    // Both discards give up 'wheat' (the only crop in the barn), but the two
    // incoming decks are different - the outgoing crop never ties the hand
    // on the incoming one.
    out = answerWith(out, { suit: 'dairy' }).state;
    out = answerWith(out, { suit: 'orchard' }).state;
    expect(barnCrops(out, VEG)).toEqual(['dairy', 'orchard']);
    expect(out.discards.wheat).toEqual(expect.arrayContaining(['W4', 'W5']));
  });

  /**
   * R4's whole point: because the outgoing cards land in the discard BEFORE
   * the incoming step is offered, and a discard pile reshuffles into its own
   * deck the moment that deck is empty, the deck-to-barn step can never be
   * short of an answer once the discard step has completed - even on a table
   * where every deck and every other discard is bone dry. The old
   * `totalDrawable(...) < 2` pre-check that used to refuse this position is
   * gone (Q4/R4); `barn.length < 2` is the only gate left.
   */
  it('works even when the two named crops are bone dry beforehand, off the reshuffle of what V6 itself just discarded', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'O4');
    dealTo(data, s, VEG, 'V10'); // the GROW payment, dealt before the table runs dry
    // Drain wheat and orchard's decks AND discards to nothing: the only wheat
    // or orchard cards left anywhere on the table are the two V6 is about to
    // discard. Dairy is left alone so the trailing Draw 2 still has a supply -
    // this test is about the deck-to-barn step never being short, not about
    // starving the whole table.
    s.decks.wheat = [];
    s.discards.wheat = [];
    s.decks.orchard = [];
    s.discards.orchard = [];
    let out = growBuilding(data, s, VEG, 'V6', 'V10').state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });
    out = answerWith(out, { suit: 'wheat' }).state;
    out = answerWith(out, { suit: 'orchard' }).state;
    // Both discards landed; wheat and orchard's ONLY supply is what was just
    // discarded, and the deck-to-barn step still has a legal answer for both -
    // the old `totalDrawable(...) < 2` pre-check would have refused this
    // whole activation before anything moved; R4 removes it.
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'deckToBarn' });
    const onto = new Set(
      pendingAnswers(data, out).flatMap((a) => (a.kind === 'card' ? [a.payload.suit] : [])),
    );
    expect(onto.has('wheat')).toBe(true);
    expect(onto.has('orchard')).toBe(true);
    out = answerWith(out, { suit: 'wheat' }).state;
    out = answerWith(out, { suit: 'orchard' }).state;
    // Each reshuffled deck held exactly the card V6 had just discarded, so it
    // comes right back into the barn.
    expect(barnCrops(out, VEG)).toEqual(['orchard', 'wheat']);
    expect(out.discards.wheat).toEqual([]);
    expect(out.discards.orchard).toEqual([]);
    // The trailing Draw 2 is still queued and still runs, off the untouched
    // dairy supply.
    expect(out.tasks[0]).toMatchObject({ t: 'draw', src: 'V6', see: 2, keep: 2 });
    const dairyDeck = (a: TaskAnswer) => a.kind === 'deck' && a.suit === 'dairy';
    out = answerTask(data, out, pendingAnswers(data, out).find(dairyDeck) as TaskAnswer).state;
    out = answerTask(data, out, pendingAnswers(data, out).find(dairyDeck) as TaskAnswer).state;
    const revealed = out.tasks[0]?.t === 'draw' ? out.tasks[0].revealed : [];
    expect(revealed).toHaveLength(2);
    const drawn = answerTask(data, out, { kind: 'keep', cards: revealed }).state;
    expect(player(drawn, VEG).hand).toHaveLength(2);
    expect(drawn.tasks).toHaveLength(0);
  });
});

describe('V8 The Regional Depot - discard a barn card, Draw 4 of that crop', () => {
  it('discards the named crop and draws four cards of it', () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    barnTo(s, VEG, 'W4', 'V5');
    const grown = grow(s, VEG, 'V8', 'V10').state;
    const answers = pendingAnswers(data, grown);
    // Mandatory: no skip, one answer per crop in the barn.
    expect(answers).not.toContainEqual({ kind: 'skip' });
    expect(answers).toHaveLength(2);
    const after = answerWith(grown, { suit: 'wheat' });
    const out = after.state;
    expect(barnCrops(out, VEG)).toEqual(['vegetable']);
    expect(out.discards.wheat).toContain('W4');
    expect(after.events).toContainEqual({
      e: 'barnDiscarded',
      seat: VEG,
      suit: 'wheat',
      card: 'W4',
      src: 'V8',
    });
    const draw = out.tasks[0];
    expect(draw).toMatchObject({ t: 'draw', src: 'V8', see: 4, keep: 4 });
    const revealed = draw?.t === 'draw' ? draw.revealed : [];
    expect(revealed.map((id) => cardById(data, id).suit)).toEqual([
      'wheat',
      'wheat',
      'wheat',
      'wheat',
    ]);
    const kept = answerTask(data, out, { kind: 'keep', cards: revealed }).state;
    expect(player(kept, VEG).hand).toEqual(revealed);
  });

  it('does nothing on an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V8');
    const out = grow(s, VEG, 'V8', 'V10').state;
    expect(out.tasks).toHaveLength(0);
  });
});

/**
 * V5 The Coastal Trading Depot - v47 (22/09/2026, `tasks/v47-rulings-v1.md` housekeeping):
 * "Deliver. 1 of the cards may be any crop." The token swap is retired; V5 is now a bare Deliver
 * pushed with `wildCards: 1`, the V3 board-power relaxation (R9) at strength 1.
 */
describe('V5 The Coastal Trading Depot - Deliver with 1 wild card (v47)', () => {
  it('delivers to a tile that needs an off-crop card, using its 1 relaxed slot', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    // Testkit island for ['vegetable', 'wheat']: A1 holds two vegetable tokens
    // (vegetable x4 demand). 3 vegetable + 1 off-crop cannot pay it plain.
    barnTo(s, VEG, 'V4', 'V6', 'V7'); // 3 vegetable cards
    barnTo(s, VEG, 'W4'); // 1 off-crop card
    expect(deliverOptions(data, s, VEG).some((o) => o.tile === 'A1')).toBe(false);
    // With the 1 wild slot the same barn CAN pay it.
    expect(deliverOptions(data, s, VEG, Infinity, 1).some((o) => o.tile === 'A1')).toBe(true);

    const out = grow(s, VEG, 'V5', 'V10');
    expect(out.state.tasks).toHaveLength(1);
    expect(out.state.tasks[0]).toMatchObject({ t: 'deliver', pid: VEG, wildCards: 1 });
    const pick = pendingAnswers(data, out.state).find(
      (a) => a.kind === 'deliver' && a.tile === 'A1',
    );
    expect(pick).toBeDefined();
    const done = answerTask(data, out.state, pick as TaskAnswer).state;
    expect(player(done, VEG).receipts).toHaveLength(1);
    expect(player(done, VEG).barn).toEqual([]);
  });

  it('is mandatory, doing as much as it can: with no payable tile even under the relaxation, nothing happens', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    // An empty barn cannot pay any tile, wild slot or not.
    const out = grow(s, VEG, 'V5', 'V10');
    expect(out.state.tasks).toHaveLength(0);
  });

  it('retires the token swap entirely: no swapDemand task, no demand change from this card', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    barnTo(s, VEG, 'V4', 'V6', 'V7', 'V9'); // a full 4-vegetable delivery, no wild needed
    const demands = (state: GameState, id: string) =>
      tile(state, id)
        .tokens.map((t) => t.demand)
        .sort();
    const before = { A1: demands(s, 'A1'), A5: demands(s, 'A5') };
    const out = grow(s, VEG, 'V5', 'V10');
    expect(out.state.tasks.every((t) => !(t.t === 'card' && t.kind === 'swapDemand'))).toBe(true);
    expect(demands(out.state, 'A1')).toEqual(before.A1);
    expect(demands(out.state, 'A5')).toEqual(before.A5);
  });
});

describe('V7 The Export Depot - harvest, then Deliver', () => {
  it('harvests a FULL building of yours and then offers the full Deliver', () => {
    const s = base();
    buildFor(data, s, VEG, 'V7', 'V4');
    loadStack(data, s, VEG, 'V4', 2); // V4's threshold is 2, filled off the deck top
    barnTo(s, VEG, 'V11', 'V12');
    const out = grow(s, VEG, 'V7', 'V13');
    expect(out.state.tasks[0]).toMatchObject({ t: 'chooseBuilding', filter: 'full' });
    const harvested = answerTask(data, out.state, {
      kind: 'building',
      card: 'V4',
    }).state;
    expect(player(harvested, VEG).barn).toHaveLength(4);
    // The harvest lands BEFORE the delivery enumerates, so its cards can pay.
    expect(harvested.tasks[0]).toMatchObject({ t: 'deliver' });
    expect(pendingAnswers(data, harvested).some((a) => a.kind === 'deliver')).toBe(true);
  });

  it('the strict full gate: a partly-loaded building is not a target', () => {
    const s = base();
    buildFor(data, s, VEG, 'V7', 'V6'); // V6's threshold is 3
    loadStack(data, s, VEG, 'V6', 2);
    const out = grow(s, VEG, 'V7', 'V10');
    const building = out.state.tasks.find((t) => t.t === 'chooseBuilding');
    // No full building anywhere, so the harvest task drops and the Deliver runs.
    expect(building).toBeUndefined();
  });
});

// --- Tier 2 -----------------------------------------------------------------

describe('the Tier 2 counters', () => {
  it('V9 draws 2 and loads 1, flat, whatever the barn holds', () => {
    // DE-SCALED 2026-08-09: it used to read "Draw 1 for each different crop in
    // your barn" and fired 0.0 times a game, because the median barn is 2. The
    // replacement is flat and upstream and can never read zero.
    for (const barn of [[], ['V4', 'V5', 'V6', 'W4', 'O4']] as CardId[][]) {
      const s = base();
      buildFor(data, s, VEG, 'V9');
      barnTo(s, VEG, ...barn);
      const out = grow(s, VEG, 'V9', 'V10');
      expect(out.state.tasks[0], `barn=${barn.length}`).toMatchObject({
        t: 'draw',
        see: 2,
        keep: 2,
      });
      expect(out.state.tasks[1]).toMatchObject({ t: 'handToBarn', pid: VEG, remaining: 1 });
    }
  });
});

describe('V10 The Supply House - draw 1 per barn card, mandatory and uncapped (v45, R1-R3)', () => {
  it('draws once per barn card, one draw task per crop present, and nothing leaves the barn (R1)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'O5', 'D4');
    const out = grow(s, VEG, 'V10', 'V11').state;
    // No task of its own: there is no choice left for the barn to decide. One
    // draw task per crop present - `data.cards.suits` order (dairy before
    // orchard), not barn order.
    expect(out.tasks.map((t) => [t.t, srcOf(t)])).toEqual([
      ['draw', 'V10'],
      ['draw', 'V10'],
    ]);
    const sizes = out.tasks.map((t) => (t.t === 'draw' ? t.see : -1)).sort();
    expect(sizes).toEqual([1, 2]); // 1 dairy card, 2 orchard cards
    for (const t of out.tasks) {
      if (t.t !== 'draw') continue;
      const suits = t.revealed.map((id) => cardById(data, id).suit);
      expect(new Set(suits).size).toBe(1); // each task is a single crop
    }
    // R1: the barn cards STAY, so the card can fire again next turn.
    expect(barnCrops(out, VEG)).toEqual(['dairy', 'orchard', 'orchard']);
  });

  it('the draw is mandatory: no skip is ever offered (R2)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4');
    const out = grow(s, VEG, 'V10', 'V11').state;
    expect(pendingAnswers(data, out)).not.toContainEqual({ kind: 'skip' });
  });

  it('a barn of six draws six, uncapped (R3)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'O5', 'O6', 'O7', 'O8', 'O9');
    const out = grow(s, VEG, 'V10', 'V11').state;
    expect(out.tasks).toHaveLength(1);
    const draw = out.tasks[0];
    expect(draw).toMatchObject({ t: 'draw', src: 'V10', see: 6, keep: 6 });
    const revealed = draw?.t === 'draw' ? draw.revealed : [];
    expect(revealed).toHaveLength(6);
    expect(revealed.every((id) => cardById(data, id).suit === 'orchard')).toBe(true);
    expect(barnCrops(out, VEG)).toHaveLength(6); // R1: still all six, untouched
  });

  it('a crop whose deck has run dry draws only what is left', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'O5');
    s.decks.orchard = []; // deck AND discard both empty: nothing left to draw
    const out = grow(s, VEG, 'V10', 'V11').state;
    expect(out.tasks).toHaveLength(0); // drawFromCropDeck pushes nothing on zero cards taken
    expect(barnCrops(out, VEG)).toEqual(['orchard', 'orchard']);
  });

  it('does nothing on an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    const out = grow(s, VEG, 'V10', 'V11').state;
    expect(out.tasks).toHaveLength(0);
  });
});

/**
 * ⭐ `rules.economy.supplyHouseBarnDrain`, added 20/09/2026 to measure how much
 * of the reference-v21 barn glut is V10 losing its drain (the arm in
 * overlays/pre-v45-barn-drains-v1.overlay.json). false is the shipped v45
 * shape proved by the describe block above; these tests prove true restores
 * the pre-v45 "discard up to 2, a plain action per crop" shape exactly, off
 * `git show e6b459c`.
 */
describe('rules.economy.supplyHouseBarnDrain (20/09/2026): the V10 knob', () => {
  it('defaults to false, the shipped v45 no-drain shape (R1-R3)', () => {
    expect(data.rules.economy.supplyHouseBarnDrain).toBe(false);
  });

  it("true discards up to 2 barn cards and queues each one's base action, in discard order", () => {
    const old = loadGameData({
      name: 'supply-house-old-drain',
      schemaVersion: 1,
      set: { 'rules.economy.supplyHouseBarnDrain': true },
    });
    const s = base();
    buildFor(old, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'D4', 'W4');
    dealTo(old, s, VEG, 'V11');
    let out = growBuilding(old, s, VEG, 'V10', 'V11').state;
    // "Up to": a skip is offered from the first answer, unlike the mandatory v45 draw.
    expect(pendingAnswers(old, out)).toContainEqual({ kind: 'skip' });
    out = pickWith(old, out, { suit: 'orchard' });
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });
    dealTo(old, out, VEG, 'D5', 'D6'); // something to build with
    out = pickWith(old, out, { suit: 'dairy' });
    // Orchard's base action is Draw 2, Dairy's is Build - the restored plain-action mapping.
    expect(out.tasks.map((t) => [t.t, srcOf(t)])).toEqual([
      ['draw', 'V10'],
      ['build', 'V10'],
    ]);
    // The two discarded crops left the barn; wheat (never offered) stays - a
    // real drain, unlike the false shape where nothing ever leaves (R1).
    expect(barnCrops(out, VEG)).toEqual(['wheat']);
  });

  it('true: a skip after one discard performs exactly one action ("up to")', () => {
    const old = loadGameData({
      name: 'supply-house-old-drain-skip',
      schemaVersion: 1,
      set: { 'rules.economy.supplyHouseBarnDrain': true },
    });
    const s = base();
    buildFor(old, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'D4');
    dealTo(old, s, VEG, 'V11');
    let out = growBuilding(old, s, VEG, 'V10', 'V11').state;
    out = pickWith(old, out, { suit: 'orchard' });
    out = answerTask(old, out, { kind: 'skip' }).state;
    expect(out.tasks.map((t) => [t.t, srcOf(t)])).toEqual([['draw', 'V10']]);
    expect(barnCrops(out, VEG)).toEqual(['dairy']);
  });

  it('true: an empty barn discards nothing, exactly like the false shape', () => {
    const old = loadGameData({
      name: 'supply-house-old-drain-empty',
      schemaVersion: 1,
      set: { 'rules.economy.supplyHouseBarnDrain': true },
    });
    const s = base();
    buildFor(old, s, VEG, 'V10');
    dealTo(old, s, VEG, 'V11');
    const out = growBuilding(old, s, VEG, 'V10', 'V11').state;
    expect(out.tasks).toHaveLength(0);
  });
});

describe('V11 The Market Master - a real Harvest per distinct Barn suit (v46, R1-R4)', () => {
  it('harvests the WHOLE stack of a full building, not one card (R1)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 2); // V4 is full at 2
    barnTo(s, VEG, 'V13'); // opens the 'vegetable' suit
    const grown = grow(s, VEG, 'V11', 'V10').state;
    const pick = pendingAnswers(data, grown).find((a) => a.kind === 'building') as TaskAnswer;
    expect(pick).toMatchObject({ kind: 'building', card: 'V4' });
    const harvested = answerTask(data, grown, pick);
    const out = harvested.state;
    expect(buildingOf(out, VEG, 'V4').stack).toHaveLength(0); // the WHOLE stack, not 1 card
    expect(player(out, VEG).barn).toHaveLength(3); // the original V13 plus both harvested cards
    const ev = harvested.events.find((e) => e.e === 'harvested');
    expect(ev).toMatchObject({ e: 'harvested', seat: VEG, building: 'V4' });
    expect(ev && 'cards' in ev ? ev.cards : []).toHaveLength(2);
    expect(harvested.events.some((e) => e.e === 'stackToBarn')).toBe(false); // a Harvest, not the old move
    expect(out.tasks).toHaveLength(0); // only one suit was in the barn
  });

  it('fires a real harvested event that W16 The Granary can see, off the same primitive a plain Harvest uses', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4', 'W16');
    loadStack(data, s, VEG, 'V4', 2);
    barnTo(s, VEG, 'V13');
    const grown = grow(s, VEG, 'V11', 'V10').state;
    const harvested = answerTask(data, grown, { kind: 'building', card: 'V4' });
    expect(harvested.events.some((e) => e.e === 'harvested')).toBe(true);
    // W16 listens on `afterHarvest` for ANY harvest of its owner's, suit unconditional.
    expect(harvested.state.tasks).toContainEqual(
      expect.objectContaining({ src: 'W16', kind: 'granaryDraw' }),
    );
  });

  it("counts toward W18 A Helping Hand's harvestsThisTurn across two suits' harvests", () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4', 'D4', 'W18');
    barnTo(s, VEG, 'V13', 'D5'); // opens BOTH 'vegetable' and 'dairy', before the stacks eat the deck tops
    loadStack(data, s, VEG, 'V4', 2);
    loadStack(data, s, VEG, 'D4', 2);
    let out = grow(s, VEG, 'V11', 'V10').state;
    expect(out.tasks.filter((t) => t.t === 'chooseBuilding')).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const pick = pendingAnswers(data, out).find((a) => a.kind === 'building') as TaskAnswer;
      out = answerTask(data, out, pick).state;
    }
    expect(out.turn.harvestsThisTurn).toBe(2);
    // W18's own condition, "Harvest two or more of your buildings", is met.
    expect(out.tasks).toContainEqual(
      expect.objectContaining({ t: 'draw', src: 'W18', see: 3, keep: 3 }),
    );
  });

  it('skips a building that is not full - the suit drops silently, no partial harvest (R2, R4)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 1); // threshold 2, not full
    barnTo(s, VEG, 'V13');
    const out = grow(s, VEG, 'V11', 'V10').state;
    expect(out.tasks.some((t) => t.t === 'chooseBuilding')).toBe(false);
    expect(buildingOf(out, VEG, 'V4').stack).toHaveLength(1); // untouched
  });

  it('harvests its own Notice Board once it holds 3 or more cards (R2)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11');
    loadStack(data, s, VEG, 'V3', 3, 'vegetable'); // V3 is VEG's own board, threshold 3
    barnTo(s, VEG, 'V13');
    const grown = grow(s, VEG, 'V11', 'V10').state;
    const pick = pendingAnswers(data, grown).find((a) => a.kind === 'building') as TaskAnswer;
    expect(pick).toMatchObject({ kind: 'building', card: 'V3' });
    const out = answerTask(data, grown, pick).state;
    expect(buildingOf(out, VEG, 'V3').stack).toHaveLength(0);
    expect(player(out, VEG).barn).toHaveLength(4); // V13 plus the board's 3 cards
  });

  it('never harvests its own Notice Board below 3 cards (R2, S8)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11');
    loadStack(data, s, VEG, 'V3', 2, 'vegetable'); // below the 3+ minimum
    barnTo(s, VEG, 'V13');
    const out = grow(s, VEG, 'V11', 'V10').state;
    // Nothing of the 'vegetable' suit is full - V11 holds 1 (its own GROW
    // payment), the board holds 2 - so the task drops silently.
    expect(out.tasks.some((t) => t.t === 'chooseBuilding')).toBe(false);
    expect(buildingOf(out, VEG, 'V3').stack).toHaveLength(2); // untouched
  });

  it("counts the barn ONCE, by distinct suit, so a card arriving from its own harvest can't open a new suit (R3)", () => {
    const s = base();
    // A Dairy building on the Vegetable seat, its STACK loaded with VEGETABLE
    // cards (loadStack's suit override) - the printed crop that matters is
    // D4's own ('dairy'), never what happens to sit on its stack.
    buildFor(data, s, VEG, 'V11', 'D4');
    loadStack(data, s, VEG, 'D4', 2, 'vegetable');
    barnTo(s, VEG, 'D5'); // only 'dairy' is in the barn at activation
    let out = grow(s, VEG, 'V11', 'V10').state;
    expect(out.tasks.filter((t) => t.t === 'chooseBuilding')).toHaveLength(1); // one suit snapshotted
    out = answerTask(data, out, { kind: 'building', card: 'D4' }).state;
    // The harvest lands 2 vegetable cards in the barn - which now DOES hold a
    // vegetable suit - but nothing re-reads the barn, so no new task appears.
    expect(barnCrops(out, VEG)).toEqual(['dairy', 'vegetable', 'vegetable']);
    expect(out.tasks).toHaveLength(0);
  });

  it('cannot be declined - no skip is ever offered once a suit has a legal target (R4)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 2);
    barnTo(s, VEG, 'V13');
    const out = grow(s, VEG, 'V11', 'V10').state;
    expect(pendingAnswers(data, out)).not.toContainEqual({ kind: 'skip' });
  });

  it('does nothing on an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 1);
    expect(grow(s, VEG, 'V11', 'V10').state.tasks).toHaveLength(0);
  });
});

describe('V12 The Auction House - the Notice Board action of a suit in your Barn, for free (v45, R4)', () => {
  it("an Orchard card is the Orchard board's Draw 4, with no visit and no discard", () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'O4');
    const after = answerWith(grow(s, VEG, 'V12', 'V10').state, { suit: 'orchard' });
    expect(after.state.tasks[0]).toMatchObject({
      t: 'draw',
      src: 'V12',
      see: data.rules.economy.noticeBoardPower.orchardDraw,
    });
    // Not a visit: no fee placed, no visited event, no board latched.
    expect(after.events.some((e) => e.e === 'visited' || e.e === 'cardPlaced')).toBe(false);
    expect(after.state.turn.bonusUsed).toEqual([]);
    // R4: the barn only named the suit. Nothing was discarded.
    expect(after.events.some((e) => e.e === 'barnDiscarded')).toBe(false);
    expect(barnCrops(after.state, VEG)).toEqual(['orchard']);
  });

  it('names a suit in the Barn for free: nothing is discarded, spent or moved (R4)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'O4', 'O5');
    const after = answerWith(grow(s, VEG, 'V12', 'V10').state, { suit: 'orchard' });
    expect(barnCrops(after.state, VEG)).toEqual(['orchard', 'orchard']);
    expect(after.events.some((e) => e.e === 'barnDiscarded')).toBe(false);
  });

  it('offers one answer per suit present in the Barn, and no skip (mandatory choice)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'O4', 'D4');
    const out = grow(s, VEG, 'V12', 'V10').state;
    const answers = pendingAnswers(data, out);
    expect(answers).not.toContainEqual({ kind: 'skip' });
    expect(answers.filter((a) => a.kind === 'card')).toHaveLength(2);
  });

  it('does nothing on an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    const out = grow(s, VEG, 'V12', 'V10').state;
    expect(out.tasks).toHaveLength(0);
  });

  it('a Vegetable card asks "can you deliver" when the power fires: the fallback', () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'V5');
    dealTo(data, s, VEG, 'W4', 'W5');
    const out = answerWith(grow(s, VEG, 'V12', 'V10').state, { suit: 'vegetable' }).state;
    expect(out.tasks[0]).toMatchObject({
      t: 'handToBarn',
      src: 'V12',
      remaining: data.rules.economy.noticeBoardPower.vegetableFallback,
    });
  });

  it("a Dairy card is the Dairy board's discounted any-crop Build", () => {
    const s = base();
    buildFor(data, s, VEG, 'V12');
    barnTo(s, VEG, 'D4');
    dealTo(data, s, VEG, 'W4');
    const out = answerWith(grow(s, VEG, 'V12', 'V10').state, { suit: 'dairy' }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'build', src: 'V12' });
  });
});

// --- Tier 3, now ordinary GROW buildings ------------------------------------

/**
 * THE ACTION CARD LEFT THE GAME ON 19/08/2026 (Dean: "The concept of an ACTION
 * was never requested. They are all GROW."). Every test in here used to drive
 * its card through `apply(... cardMove ...)`, which spent the main action from
 * inside the handler; they now go through `grow`, which pays one card of any
 * crop into the building's own stack and fires `activate`. The sheet gives all
 * three threshold 1 and a wild activation type, so they clog after a single
 * card and cost a harvest to reuse.
 */
describe('the Tier 3 cards (converted from ACTION to GROW)', () => {
  it('V13 puts one deck top in the barn per DIFFERENT crop already there', () => {
    // REPOINTED 2026-08-09. It used to recolour the barn 1:1; now it multiplies the barn and the
    // multiplier is its VARIETY. No choice and no task - the crop list decides
    // the decks. The 19/08/2026 conversion left the effect untouched: V13 is the
    // pure GROW conversion of the three, with no retext behind it.
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4', 'V5', 'W4'); // two crops, three cards
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(out.tasks).toHaveLength(0);

    const barn = player(out, VEG)
      .barn.map((id) => cardById(data, id).suit)
      .sort();
    // One vegetable and one wheat added, nothing discarded.
    expect(barn).toEqual(['vegetable', 'vegetable', 'vegetable', 'wheat', 'wheat']);
    // And the payment card is on the building, not in the barn: a GROW costs a
    // card as well as the action, which the ACTION shape never did.
    expect(buildingOf(out, VEG, 'V13').stack).toEqual(['V11']);
  });

  it('V13 reads the crop list ONCE, so an arriving card cannot extend the loop', () => {
    const s = base();
    buildFor(data, s, VEG, 'V13');
    barnTo(s, VEG, 'V4'); // one crop
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(player(out, VEG).barn).toHaveLength(2);
  });

  it('V13 on an EMPTY barn is legal now and simply does nothing', () => {
    // The old standing move gated itself on "cropsToRefill > 0" and was not
    // offered at all. A GROW has no such gate - you may always pay a card into a
    // stack - so this is legal, does nothing, and advances the threshold. Not
    // worth a guard, but it is a behaviour change worth pinning.
    const s = base();
    buildFor(data, s, VEG, 'V13');
    const out = grow(s, VEG, 'V13', 'V11').state;
    expect(player(out, VEG).barn).toHaveLength(0);
    expect(out.tasks).toHaveLength(0);
    expect(buildingOf(out, VEG, 'V13').stack).toEqual(['V11']);
  });

  it('V14 pays once for a VIRGIN tile and takes BOTH tokens: 6 + 5', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;

    expect(player(out, VEG).receipts.map((r) => r.vp)).toEqual([6, 5]);
    expect(tile(out, 'A1').deliveredBy).toEqual([VEG, VEG]);
    expect(tile(out, 'A1').tokens).toEqual([]);
    expect(player(out, VEG).barn).toHaveLength(0); // ONE payment of 4 cards
  });

  it('V14 then DESTROYS itself (v42): stack and card discarded, no VP, not a barn discard', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14', 'V17');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    const grown = grow(s, VEG, 'V14', 'V11').state;
    const after = answerWith(grown, { tile: 'A1' });
    const out = after.state;
    expect(player(out, VEG).tableau.some((b) => b.card === 'V14')).toBe(false);
    expect(out.discards.vegetable).toEqual(expect.arrayContaining(['V14', 'V11']));
    expect(after.events).toContainEqual({ e: 'demolished', seat: VEG, card: 'V14' });
    // Not a barn discard either way (R6), and moot for V17 since v45: it no
    // longer reads discards at all, and mid-turn it has no chance to fire.
    expect(after.events.some((e) => e.e === 'barnDiscarded')).toBe(false);
    expect(out.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);
    // It scores nothing now: the printed 3 is gone, and so is its Barn-scorer line.
    const printed = gameEndScores(data, out)[VEG]?.printed;
    expect(printed).toBe(cardById(data, 'V17').printedVp);
  });

  it('V14 with nothing payable does nothing and stays built (builder default)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    const out = grow(s, VEG, 'V14', 'V11').state;
    expect(out.tasks).toHaveLength(0);
    expect(buildingOf(out, VEG, 'V14').stack).toEqual(['V11']);
  });

  it('V14 takes the ONE token left on a half-finished tile (Dean, 19/08/2026)', () => {
    // "Deliver and take every receipt on the island" is ruled as: whatever
    // receipts REMAIN ON THAT TILE. Two if nobody has delivered there, one if
    // somebody has - not "every receipt on the island", and not always "both".
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    deliveredAt(s, WHEAT, 'A1'); // A1 has its 5 VP token left
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    expect(pick).toBeDefined();
    out = answerTask(data, out, pick).state;

    // An ordinary second delivery (BUILDER DEFAULT): 2 vegetables plus 2 any.
    expect(player(out, VEG).receipts.map((r) => r.vp)).toEqual([5]);
    expect(tile(out, 'A1').deliveredBy).toEqual([WHEAT, VEG]);
  });

  it('V14 OFFERS a tile somebody has already delivered to - the virgin gate is gone', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    deliveredAt(s, WHEAT, 'A1');
    const out = grow(s, VEG, 'V14', 'V11').state;
    const tiles = pendingAnswers(data, out)
      .filter((a) => a.kind === 'card')
      .map((a) => (a.kind === 'card' ? a.payload.tile : undefined));
    expect(tiles).toContain('A1');
  });

  it('V14 counts as TWO deliveries toward the end trigger (ruling G)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V14');
    // Four deliveries already banked; V14's two take the seat to six.
    deliveredAt(s, VEG, 'A2', 'A2', 'A5', 'A5');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    let out = grow(s, VEG, 'V14', 'V11').state;
    const pick = pendingAnswers(data, out).find(
      (a) => a.kind === 'card' && a.payload.tile === 'A1',
    ) as TaskAnswer;
    out = answerTask(data, out, pick).state;
    expect(data.rules.endGame.deliveriesToTrigger).toBe(6);
    expect(out.endTrigger).toEqual({ seat: VEG });
  });

  it('V15 discards a barn card, then builds a card of that crop FREE', () => {
    const s = base();
    buildFor(data, s, VEG, 'V15');
    barnTo(s, VEG, 'D4', 'W4');
    dealTo(data, s, VEG, 'D9', 'D16', 'W5'); // D16 is a Power card
    let out = grow(s, VEG, 'V15', 'V13').state;
    expect(pendingAnswers(data, out)).not.toContainEqual({ kind: 'skip' });
    out = answerWith(out, { suit: 'dairy' }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V15', kind: 'freeBuild' });
    const offered = pendingAnswers(data, out).map((a) =>
      a.kind === 'card' ? a.payload.card : null,
    );
    // Only the dairy cards in hand, Power included.
    expect(offered.sort()).toEqual(['D16', 'D9']);
    const built = answerWith(out, { card: 'D9' });
    expect(buildingOf(built.state, VEG, 'D9').stack).toEqual([]);
    expect(player(built.state, VEG).hand.sort()).toEqual(['D16', 'W5']);
    expect(built.events).toContainEqual({ e: 'built', seat: VEG, card: 'D9', payment: [] });
    expect(barnCrops(built.state, VEG)).toEqual(['wheat']);
  });

  it('V15 with no card of that crop in hand: the discard stands, nothing is built', () => {
    const s = base();
    buildFor(data, s, VEG, 'V15');
    barnTo(s, VEG, 'O4');
    dealTo(data, s, VEG, 'W5');
    const out = answerWith(grow(s, VEG, 'V15', 'V13').state, { suit: 'orchard' }).state;
    expect(out.tasks).toHaveLength(0);
    expect(player(out, VEG).barn).toHaveLength(0);
    expect(player(out, VEG).hand).toEqual(['W5']);
  });
});

describe('V16 and V17, the Power cards', () => {
  /** A Vegetable seat with 4 vegetables in the barn, delivering to A1 for 6. */
  function deliverA1(s: GameState): Applied {
    const move = legalMoves(data, s).find(
      (m) => m.type === 'deliver' && m.seat === VEG && m.tile === 'A1' && m.token === 0,
    );
    if (move === undefined) throw new Error('A1 is not payable');
    return apply(data, s, move);
  }

  it('V16 puts a chosen deck top into the barn on every delivery of its owner', () => {
    const s = base();
    buildFor(data, s, VEG, 'V16');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7', 'W4');
    const out = deliverA1(s).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V16', kind: 'deckToBarn' });
    const done = answerWith(out, { suit: 'apiary' }).state;
    expect(barnCrops(done, VEG)).toEqual(['apiary', 'wheat']);
  });

  it(
    'V16 and V18 (RETEXTED v48): V18 still checks legality off the barn BEFORE ' +
      "V16's pending card lands, so an empty barn leaves its granted Deliver illegal and " +
      'nothing fires, while V16 fires regardless',
    () => {
      const s = base();
      buildFor(data, s, VEG, 'V16', 'V18');
      barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7'); // exactly the crate; barn is empty after paying
      const out = deliverA1(s).state;
      // A Vegetable receipt would grant a Deliver (R10), but the barn V18 reads is the
      // one straight after payment - empty - so that Deliver is not legal right now and
      // V18 does as much as it can, which is nothing. V16's own pick still queues; V18
      // is not fooled into firing by the card V16 has not added yet.
      expect(out.tasks.map((t) => srcOf(t))).toEqual(['V16']);
    },
  );
});

/**
 * V17 The Dockworker's Union - v45 (19/09/2026, R5): "If, at the end of your
 * turn, your Barn is empty, place any deck card into your Barn." The card no
 * longer listens on `afterBarnDiscard` at all (V8 and V15 keep that hook), so
 * it is tested through the turn boundary rather than through a discard.
 */
describe("V17 The Dockworker's Union - Barn of 3 or fewer at end of turn (v46, R11.3-R11.4)", () => {
  it('fires at the end of a turn with an empty Barn, and the only choice is the deck', () => {
    const s = base();
    buildFor(data, s, VEG, 'V17');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.resume).toBe('turnflow'); // beforeTurnEnd suspended the boundary
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V17', kind: 'deckToBarn' });
    expect(pendingAnswers(data, out)).not.toContainEqual({ kind: 'skip' }); // mandatory
    const done = answerWith(out, { suit: 'wheat' }).state;
    expect(barnCrops(done, VEG)).toEqual(['wheat']);
  });

  it('fires on the very first turn, before the Barn has ever been touched', () => {
    // The game starts with an empty barn, so this is the common case rather
    // than an edge case (the audit's "resolved without asking" answer).
    const s = base();
    buildFor(data, s, VEG, 'V17');
    expect(player(s, VEG).barn).toHaveLength(0);
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V17', kind: 'deckToBarn' });
  });

  it('fires at a Barn of exactly 3 cards (v46: "3 or fewer")', () => {
    const s = base();
    buildFor(data, s, VEG, 'V17');
    barnTo(s, VEG, 'V4', 'V5', 'V6');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V17', kind: 'deckToBarn' });
  });

  it('does not fire at a Barn of 4 cards - strictly more than the v46 threshold', () => {
    const s = base();
    buildFor(data, s, VEG, 'V17');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);
    expect(barnCrops(out, VEG)).toHaveLength(4);
  });

  it("never fires on a rival's turn end", () => {
    const s = base();
    buildFor(data, s, WHEAT, 'V17');
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);
    expect(out.turnPlayer).toBe(WHEAT);
  });

  it('drops silently, like V4 and V16, when every deck and discard is dry', () => {
    // Regression for the 2026-09-19 crash on reference-v21:3:VOD+W:17, turn
    // 70: V17 pushed a mandatory deckToBarn task with nothing left to draw
    // anywhere, and deckToBarnTask.answers() returned [], leaving a task with
    // no legal answer - the sim driver's "no legal moves and the game is not
    // over". V4 (marketStallDepot) and V16 (marketSignalTower) already guard
    // the same shared task with drawableSuits(...).length === 0; V17 lacked
    // the guard. This does not touch R5 (the draw is still the top card of a
    // deck of choice when one exists): it only stops an unanswerable task
    // from reaching the stack.
    const s = base();
    buildFor(data, s, VEG, 'V17');
    for (const suit of Object.keys(s.decks) as (keyof typeof s.decks)[]) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    s.turn.actionSpent = true;
    const out = apply(data, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);
    // And the game is not left holding an unanswerable task of any kind.
    expect(legalMoves(data, out).length).toBeGreaterThan(0);
  });
});

/**
 * ⭐ `rules.economy.dockworkersUnionDrawOnDiscard`, added 20/09/2026 alongside
 * `supplyHouseBarnDrain` for the same reference-v21 barn-glut question. false
 * is the shipped v45 `beforeTurnEnd` shape proved by the describe block
 * above; these tests prove true restores the pre-v45 `afterBarnDiscard`
 * listener exactly, off `git show e6b459c`, and that the two shapes are
 * mutually exclusive rather than both live at once. V8 The Regional Depot
 * (`regionalDepot`) is the trigger: a mandatory, non-optional one-card barn
 * discard untouched by either knob, so it fires `afterBarnDiscard` under both
 * values.
 */
describe('rules.economy.dockworkersUnionDrawOnDiscard (20/09/2026): the V17 knob', () => {
  it('defaults to false, the shipped v45 end-of-turn-refill shape (R5)', () => {
    expect(data.rules.economy.dockworkersUnionDrawOnDiscard).toBe(false);
  });

  it('false: a barn discard from V8 does not draw for V17 (no listener on afterBarnDiscard)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V17', 'V8');
    barnTo(s, VEG, 'O4');
    let out = grow(s, VEG, 'V8', 'V11').state;
    out = answerWith(out, { suit: 'orchard' }).state;
    // V8's own draw fires; V17 does not.
    expect(out.tasks.map((t) => srcOf(t))).toEqual(['V8']);
  });

  it('true restores "whenever you discard a card from your Barn, Draw 1", firing off V8\'s discard', () => {
    const old = loadGameData({
      name: 'dockworkers-union-old-drain',
      schemaVersion: 1,
      set: { 'rules.economy.dockworkersUnionDrawOnDiscard': true },
    });
    const s = base();
    buildFor(old, s, VEG, 'V17', 'V8');
    barnTo(s, VEG, 'O4');
    dealTo(old, s, VEG, 'V11');
    let out = growBuilding(old, s, VEG, 'V8', 'V11').state;
    out = pickWith(old, out, { suit: 'orchard' });
    // V8's Draw 4 (of the discarded crop) and V17's restored Draw 1, both live.
    const tasks = out.tasks.map((t) => [t.t, srcOf(t)]);
    expect(tasks).toContainEqual(['draw', 'V8']);
    expect(tasks).toContainEqual(['draw', 'V17']);
    expect(tasks).toHaveLength(2);
  });

  it('true: the end-of-turn empty-Barn refill goes silent (the two shapes never both fire)', () => {
    const old = loadGameData({
      name: 'dockworkers-union-old-drain-turn-end',
      schemaVersion: 1,
      set: { 'rules.economy.dockworkersUnionDrawOnDiscard': true },
    });
    const s = base();
    buildFor(old, s, VEG, 'V17');
    s.turn.actionSpent = true;
    const out = apply(old, s, { type: 'endTurn', seat: VEG }).state;
    expect(out.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);
  });
});

// --- The Powers and the Endgame cards ---------------------------------------

describe('the endgame cards, read off the receipts (R7)', () => {
  function withReceipts(card: CardId, receipts: [number, string][]): number | undefined {
    const s = base();
    buildFor(data, s, VEG, card);
    for (const [vp, crop] of receipts) {
      player(s, VEG).receipts.push({ vp, crop: crop as 'wild', tile: 'A1' });
    }
    return gameEndScores(data, s)[VEG]?.endgame;
  }

  it('V19 pays 3 per disjoint same-crop pair; a wild pairs only with a wild', () => {
    const receipts: [number, string][] = [
      [6, 'vegetable'],
      [5, 'vegetable'],
      [4, 'vegetable'],
      [3, 'wheat'],
      [6, 'wild'],
      [5, 'wild'],
    ];
    // Two pairs (vegetable, wild), plus V1's 1 for V19 itself.
    expect(withReceipts('V19', receipts)).toBe(3 * 2 + 1);
    expect(withReceipts('V19', [])).toBe(1);
  });

  it('V20 pays 2 per receipt worth 4 or less', () => {
    const receipts: [number, string][] = [
      [3, 'wheat'],
      [4, 'wild'],
      [5, 'vegetable'],
      [6, 'dairy'],
    ];
    expect(withReceipts('V20', receipts)).toBe(2 * 2 + 1);
  });

  it('V21 pays 3 per vegetable receipt, and a wild does not count', () => {
    const receipts: [number, string][] = [
      [6, 'vegetable'],
      [3, 'vegetable'],
      [4, 'wild'],
      [5, 'wheat'],
    ];
    expect(withReceipts('V21', receipts)).toBe(3 * 2 + 1);
  });
});

describe('difficulty metadata stays honest across the suit', () => {
  const VEG_IDS = Array.from({ length: 21 }, (_, i) => `V${i + 1}`) as CardId[];

  it('every Vegetable card has a handler with structurally-true flags', () => {
    for (const id of VEG_IDS) {
      const h = handlerFor(id);
      expect(h, id).toBeDefined();
      expect(h?.difficulty.verified.endgame, id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, id).toBe(typeof h?.moves === 'function');
    }
  });

  it('THE ACTION CARD IS GONE: no Vegetable handler declares actionMoves', () => {
    // 19/08/2026. V13, V14 and V15 were the three that did. If this ever goes
    // red, something has re-introduced a card whose standing move IS the main
    // action - which is the concept Dean retired.
    // ⛔ The property is GONE from CardHandler, so this reads the object rather
    // than the type: `in` is what still fails loudly if someone puts it back.
    for (const id of VEG_IDS) {
      expect('actionMoves' in (handlerFor(id) as object), id).toBe(false);
    }
    // The Tier 3 trio also lose their move pair outright. V18 The Helping Hand
    // keeps its `moves` / `applyMove` and always did: a standing move that is
    // NOT the main action is a different thing and was never an ACTION card.
    for (const id of ['V13', 'V14', 'V15'] as CardId[]) {
      expect(handlerFor(id)?.moves, id).toBeUndefined();
      expect(handlerFor(id)?.applyMove, id).toBeUndefined();
    }
  });

  it('the three Tier 3 cards print a threshold and a wild activation type', () => {
    // The sheet is what makes them growable; the handlers only supply `activate`.
    // v45 (19/09/2026): V13 and V15 rose from threshold 1 to 2; V14 stayed at 1.
    const thresholds: Partial<Record<CardId, number>> = { V13: 2, V14: 1, V15: 2 };
    for (const id of ['V13', 'V14', 'V15'] as CardId[]) {
      const card = cardById(data, id);
      expect(card.threshold, id).toBe(thresholds[id]);
      expect(card.activationType, id).toBe('wild');
      expect(card.abilityTrigger, id).toEqual(['onActivate']);
      expect(handlerFor(id)?.activate, id).toBeTypeOf('function');
    }
  });
});

describe('registry coverage', () => {
  it('every enabled Vegetable card has a handler', () => {
    const registered = new Set(registeredCards());
    for (const card of data.cards.catalogue) {
      if (card.suit !== 'vegetable' || !card.enabled) continue;
      expect(registered.has(card.id), `${card.id} has no handler`).toBe(true);
      expect(handlerFor(card.id)).toBeDefined();
    }
  });
});
