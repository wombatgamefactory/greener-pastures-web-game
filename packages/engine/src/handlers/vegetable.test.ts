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

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

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

describe('V4 The Market Stall Depot - a deck card into a small barn', () => {
  it('with 3 or fewer barn cards, puts the top card of a chosen deck into the barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'W4', 'W5', 'W6');
    const out = grow(s, VEG, 'V4', 'V10').state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', src: 'V4', kind: 'deckToBarn' });
    const done = answerWith(out, { suit: 'orchard' }).state;
    expect(barnCrops(done, VEG)).toEqual(['orchard', 'wheat', 'wheat', 'wheat']);
    expect(done.tasks).toHaveLength(0);
  });

  it('with 4 barn cards, does nothing at all', () => {
    const s = base();
    buildFor(data, s, VEG, 'V4');
    barnTo(s, VEG, 'W4', 'W5', 'W6', 'W7');
    const out = grow(s, VEG, 'V4', 'V10').state;
    expect(out.tasks).toHaveLength(0);
    expect(player(out, VEG).barn).toHaveLength(4);
  });
});

describe('V6 The Trade Depot - swap up to 2 hand and barn cards, then Draw 1', () => {
  it('swaps one for one, twice at most, then draws', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4', 'O4');
    dealTo(data, s, VEG, 'A4');
    let out = grow(s, VEG, 'V6', 'V10').state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'tradeSwap' });
    expect(out.tasks[1]).toMatchObject({ t: 'draw', src: 'V6', see: 1, keep: 1 });
    const answers = pendingAnswers(data, out);
    // One answer per (hand card, barn crop), plus a skip.
    expect(answers).toContainEqual({ kind: 'skip' });
    expect(answers.filter((a) => a.kind === 'card')).toHaveLength(2);

    out = answerWith(out, { give: 'A4', take: 'wheat' }).state;
    expect(barnCrops(out, VEG)).toEqual(['apiary', 'orchard']);
    expect(player(out, VEG).hand).toEqual(['W4']);
    // A second swap is still offered.
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'tradeSwap' });
    out = answerWith(out, { give: 'W4', take: 'orchard' }).state;
    expect(barnCrops(out, VEG)).toEqual(['apiary', 'wheat']);
    expect(player(out, VEG).hand).toEqual(['O4']);
    // Two swaps done: the draw is next.
    expect(out.tasks[0]).toMatchObject({ t: 'draw', src: 'V6' });
  });

  it('may swap nothing and still draws 1', () => {
    const s = base();
    buildFor(data, s, VEG, 'V6');
    barnTo(s, VEG, 'W4');
    dealTo(data, s, VEG, 'A4');
    const out = answerTask(data, grow(s, VEG, 'V6', 'V10').state, { kind: 'skip' }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'draw', src: 'V6', see: 1 });
    expect(barnCrops(out, VEG)).toEqual(['wheat']);
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

describe('V5 The Coastal Trading Depot - SWAP two island tokens', () => {
  it('makes an unpayable tile payable, and is skippable', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    // A barn of 4 vegetables can pay A1 (two vegetable tokens) but never A5
    // (two wheat tokens).
    barnTo(s, VEG, 'V4', 'V6', 'V7', 'V9');
    const out = grow(s, VEG, 'V5', 'V10');
    const answers = pendingAnswers(data, out.state);
    expect(answers).toContainEqual({ kind: 'skip' });

    // Swap one of A5's wheat tokens for one of A1's vegetable tokens. Each token
    // carries its VP and its Worker with it.
    const pick = answers.find((a) => {
      if (a.kind !== 'card') return false;
      const { a: x, b: y } = a.payload as { a: { tile: string }; b: { tile: string } };
      return (x.tile === 'A1' && y.tile === 'A5') || (x.tile === 'A5' && y.tile === 'A1');
    }) as TaskAnswer;
    expect(pick).toBeDefined();
    const vpBefore = [...tile(out.state, 'A1').tokens, ...tile(out.state, 'A5').tokens]
      .map((t) => t.vp)
      .sort();
    const done = answerTask(data, out.state, pick).state;
    const demands = (id: string) =>
      tile(done, id)
        .tokens.map((t) => t.demand)
        .sort();
    expect(demands('A1')).toEqual(['vegetable', 'wheat']);
    expect(demands('A5')).toEqual(['vegetable', 'wheat']);
    expect(
      [...tile(done, 'A1').tokens, ...tile(done, 'A5').tokens].map((t) => t.vp).sort(),
    ).toEqual(vpBefore);
    expect(done.tasks[0]).toMatchObject({ t: 'deliver', pid: VEG });
  });

  it('never offers a pair of identical tokens - a no-op swap is not a choice', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    const out = grow(s, VEG, 'V5', 'V10');
    for (const answer of pendingAnswers(data, out.state)) {
      if (answer.kind !== 'card') continue;
      const { a, b } = answer.payload as {
        a: { tile: string; token: number };
        b: { tile: string; token: number };
      };
      expect(a.tile).not.toBe(b.tile);
      expect(tile(out.state, a.tile).tokens[a.token]).not.toEqual(
        tile(out.state, b.tile).tokens[b.token],
      );
    }
  });

  it('never touches a finished tile', () => {
    const s = base();
    buildFor(data, s, VEG, 'V5');
    deliveredAt(s, WHEAT, 'A1', 'A1'); // A1 is finished
    const out = grow(s, VEG, 'V5', 'V10');
    for (const answer of pendingAnswers(data, out.state)) {
      if (answer.kind !== 'card') continue;
      const { a, b } = answer.payload as { a: { tile: string }; b: { tile: string } };
      expect([a.tile, b.tile]).not.toContain('A1');
    }
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

describe('V10 The Supply House - discard up to 2, a plain action for each', () => {
  it("discards two, then queues each crop's plain action in discard order", () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'D4', 'W4');
    let out = grow(s, VEG, 'V10', 'V11').state;
    // "Up to": a skip is offered from the first answer.
    expect(pendingAnswers(data, out)).toContainEqual({ kind: 'skip' });
    out = answerWith(out, { suit: 'orchard' }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'card', kind: 'barnDiscard' });
    dealTo(data, out, VEG, 'D5', 'D6'); // something to build with
    out = answerWith(out, { suit: 'dairy' }).state;
    expect(barnCrops(out, VEG)).toEqual(['wheat']);
    // Orchard is Draw 2 (the plain Draw), Dairy is the plain Build.
    expect(out.tasks.map((t) => [t.t, srcOf(t)])).toEqual([
      ['draw', 'V10'],
      ['build', 'V10'],
    ]);
    expect(out.tasks[0]).toMatchObject({ see: 2, keep: 2 });
  });

  it('a skip after one discard performs one action', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4', 'D4');
    let out = grow(s, VEG, 'V10', 'V11').state;
    out = answerWith(out, { suit: 'orchard' }).state;
    out = answerTask(data, out, { kind: 'skip' }).state;
    expect(out.tasks.map((t) => [t.t, srcOf(t)])).toEqual([['draw', 'V10']]);
    expect(barnCrops(out, VEG)).toEqual(['dairy']);
  });

  it('an Apiary card is a GROW, and the barn emptying ends the step', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10', 'V4');
    barnTo(s, VEG, 'A4');
    let out = grow(s, VEG, 'V10', 'V11').state;
    dealTo(data, out, VEG, 'V9');
    out = answerWith(out, { suit: 'apiary' }).state;
    expect(out.tasks[0]).toMatchObject({ t: 'grow', src: 'V10' });
    // V10 has already activated this turn, so only V4 can be grown.
    const targets = pendingAnswers(data, out).map((a) => (a.kind === 'grow' ? a.building : null));
    expect(targets).toContain('V4');
    expect(targets).not.toContain('V10');
  });

  it('skipping at once does nothing', () => {
    const s = base();
    buildFor(data, s, VEG, 'V10');
    barnTo(s, VEG, 'O4');
    const out = answerTask(data, grow(s, VEG, 'V10', 'V11').state, { kind: 'skip' }).state;
    expect(out.tasks).toHaveLength(0);
    expect(barnCrops(out, VEG)).toEqual(['orchard']);
  });
});

describe('V11 The Market Master - move stack cards to the barn, per barn card', () => {
  it('moves a card of a counted crop off a building, and it is not a harvest', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 2); // V4 is full at 2
    barnTo(s, VEG, 'V13', 'W4');
    let out = grow(s, VEG, 'V11', 'V10').state;
    const answers = pendingAnswers(data, out);
    expect(answers).toContainEqual({ kind: 'skip' });
    // Only vegetable is movable: nothing wheat sits on a stack.
    expect(
      answers.every(
        (a) => a.kind === 'skip' || (a.kind === 'card' && a.payload.suit === 'vegetable'),
      ),
    ).toBe(true);
    const moved = answerWith(out, { building: 'V4', suit: 'vegetable' });
    out = moved.state;
    expect(buildingOf(out, VEG, 'V4').stack).toHaveLength(1); // unclogged
    expect(player(out, VEG).barn).toHaveLength(3);
    expect(moved.events.some((e) => e.e === 'harvested')).toBe(false);
    expect(moved.events.some((e) => e.e === 'stackToBarn')).toBe(true);
    // The one vegetable in the barn bought one move; the wheat has no source.
    expect(out.tasks).toHaveLength(0);
  });

  it('counts the barn BEFORE moving, so an arriving card does not add a move', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 2);
    barnTo(s, VEG, 'V13');
    let out = grow(s, VEG, 'V11', 'V10').state;
    out = answerWith(out, { building: 'V4', suit: 'vegetable' }).state;
    expect(out.tasks).toHaveLength(0);
    expect(buildingOf(out, VEG, 'V4').stack).toHaveLength(1);
  });

  it('never takes a card off a Notice Board (builder default, S11)', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11');
    loadStack(data, s, VEG, 'V3', 1, 'vegetable');
    barnTo(s, VEG, 'V13');
    const out = grow(s, VEG, 'V11', 'V10').state;
    for (const a of pendingAnswers(data, out)) {
      if (a.kind === 'card') expect(a.payload.building).not.toBe('V3');
    }
  });

  it('does nothing on an empty barn', () => {
    const s = base();
    buildFor(data, s, VEG, 'V11', 'V4');
    loadStack(data, s, VEG, 'V4', 1);
    expect(grow(s, VEG, 'V11', 'V10').state.tasks).toHaveLength(0);
  });
});

describe("V12 The Auction House - discard a barn card, that crop's board power", () => {
  it("an Orchard card is the Orchard board's Draw 4, with no visit", () => {
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
  });

  it('a Vegetable card asks "can you deliver" AFTER the discard: the fallback', () => {
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
    // V17 does not fire: neither the payment nor the demolition is a barn discard.
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

  it("V16 and V18: V18 reads the barn before V16's card lands (fixed order)", () => {
    const s = base();
    buildFor(data, s, VEG, 'V16', 'V18');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    const out = deliverA1(s).state;
    // The barn is empty after paying, so V18 draws 3 whatever V16 then adds.
    expect(out.tasks.map((t) => srcOf(t)).sort()).toEqual(['V16', 'V18']);
    expect(out.tasks.find((t) => srcOf(t) === 'V18')).toMatchObject({ t: 'draw', see: 3 });
  });

  it("V17 draws 1 for every barn discard of its owner, beside the card's own effect", () => {
    const s = base();
    buildFor(data, s, VEG, 'V17', 'V10');
    barnTo(s, VEG, 'O4', 'O5');
    let out = grow(s, VEG, 'V10', 'V11').state;
    out = answerWith(out, { suit: 'orchard' }).state;
    out = answerWith(out, { suit: 'orchard' }).state;
    const draws = out.tasks.filter((t) => t.t === 'draw');
    expect(draws.filter((t) => t.src === 'V17')).toHaveLength(2);
    expect(draws.filter((t) => t.src === 'V10')).toHaveLength(2);
    expect(out.tasks.find((t) => srcOf(t) === 'V17')).toMatchObject({ see: 1, keep: 1 });
  });

  it("V17 never fires on a delivery payment (R6), nor on a rival's discard", () => {
    const s = base();
    buildFor(data, s, VEG, 'V17');
    barnTo(s, VEG, 'V4', 'V5', 'V6', 'V7');
    const out = deliverA1(s);
    expect(out.events.some((e) => e.e === 'barnDiscarded')).toBe(false);
    expect(out.state.tasks.some((t) => srcOf(t) === 'V17')).toBe(false);

    const t = base();
    buildFor(data, t, VEG, 'V17');
    buildFor(data, t, WHEAT, 'V8');
    barnTo(t, WHEAT, 'W4');
    dealTo(data, t, WHEAT, 'V9');
    const rival = growBuilding(data, t, WHEAT, 'V8', 'V9').state;
    const after = answerWith(rival, { suit: 'wheat' }).state;
    expect(after.tasks.some((x) => srcOf(x) === 'V17')).toBe(false);
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
    for (const id of ['V13', 'V14', 'V15'] as CardId[]) {
      const card = cardById(data, id);
      expect(card.threshold, id).toBe(1);
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
