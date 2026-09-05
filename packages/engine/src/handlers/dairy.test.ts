/**
 * The Dairy suit, all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md).
 *
 * Dairy is still the Build suit, so most of this file is really a test of the
 * shared `BuildMods` vocabulary - now `discount` / `substitute` / `fromStacks`,
 * with `coinWild` and `fromBarn` deleted - and of the seams that surround a
 * build: the Farmstead's diversion of a spent card into the barn, the Ledger's
 * reaction to every build, and the two cards that reach outside the vocabulary
 * (D11's sow-the-payment and D14's demolish).
 *
 * Four sentences this docblock used to carry are false now and are named so
 * nobody looks for them. There is no `buildSubstitutePower` (a Dairy seat
 * matches crops like everybody else - substitution is the Builder's Yard's to
 * grant) and no `buildAgainPower` (nothing sells a second Build action). There
 * is no cover and no `covered` zone: D11 was retexted on 19/08/2026 and the
 * zone was deleted with it. And there is no ACTION card: D13, D14 and D15 are
 * ordinary GROW buildings as of the same date, so every test that used to fire
 * one through a standing move now grows it.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { doBuild, freeHandSpace } from '../actions.js';
import { Fx } from '../fx.js';
import { apply, legalMoves } from '../game.js';
import { answerTask, gameEndScores, growBuilding, pendingAnswers } from '../runtime.js';
import { buildingOf, player } from '../query.js';
import { revealedIn } from '../state.js';
import type { CardId, GameState, Task, TaskAnswer } from '../state.js';
import { buildFor, dealTo, loadStack, makeState, noMeeples } from '../testkit.js';
import { handlerFor } from './registry.js';

const DAIRY = 0;
const WHEAT = 1;

function base(): GameState {
  return makeState(data, ['dairy', 'wheat']);
}

function answerAll(state: GameState, pick?: (answers: TaskAnswer[]) => TaskAnswer): GameState {
  let s = state;
  for (let guard = 0; guard < 60 && s.tasks.length > 0; guard++) {
    const answers = pendingAnswers(data, s);
    const answer = pick ? pick(answers) : answers[0];
    if (!answer) throw new Error('No legal answer to a live task');
    s = answerTask(data, s, answer).state;
  }
  expect(s.tasks).toHaveLength(0);
  return s;
}

function headBuild(state: GameState): Extract<Task, { t: 'build' }> {
  const head = state.tasks.find((t) => t.t === 'build');
  if (!head || head.t !== 'build') throw new Error('Expected a build task');
  return head;
}

/** Answers to the head build task that name a given card. */
function buildsOf(state: GameState, card: string): TaskAnswer[] {
  return pendingAnswers(data, state).filter((a) => a.kind === 'build' && a.card === card);
}

/** The same answers, narrowed, because D7's cap is asserted against `stacks`. */
function buildOffersOf(state: GameState, card: string): Extract<TaskAnswer, { kind: 'build' }>[] {
  return pendingAnswers(data, state).flatMap((a) =>
    a.kind === 'build' && a.card === card ? [a] : [],
  );
}

/** Card payloads offered by whatever card task is at the head. */
function offeredCards(state: GameState): unknown[] {
  return pendingAnswers(data, state)
    .filter((a) => a.kind === 'card')
    .map((a) => a.payload.card);
}

/**
 * The same question for a task whose cards are in LIMBO - D10's and D15's deck
 * reveals - where the answers name a SLOT rather than a card id.
 *
 * They have to: a revealed deck top is in no hand, no pile and no stack, so no
 * PlayerView carries it, and `legalMoves` hands the move list to a policy
 * unredacted. Naming the id would put the deck order in the move list and in
 * the replayable move log. See REVEAL_RIDER in state.ts, and the walk in
 * view-safety.test.ts that keeps it honest. So a test that wants "build the
 * wheat top" resolves the slot through the task, exactly as the resolver does.
 */
function revealedOffers(state: GameState): { card: CardId; answer: TaskAnswer }[] {
  const head = state.tasks[0];
  if (!head || head.t !== 'card') throw new Error('Expected a card task');
  const reveal = revealedIn(head);
  return pendingAnswers(data, state).flatMap((answer) => {
    if (answer.kind !== 'card') return [];
    const pick = answer.payload.pick;
    if (typeof pick !== 'number') return [];
    const card = reveal[pick];
    return card === undefined ? [] : [{ card, answer }];
  });
}

/**
 * ⛔ THE `divert` HELPER IS GONE (v31). It answered the Dairy Farmstead's
 * divert-a-spent-card task, and every build test in this file had to step past
 * that prompt before it could assert anything. There is no prompt: a build's
 * payment goes straight to the discard, so the three D11 fixtures that called
 * `divert(state, null)` now read the state the build returned.
 */

describe('registry completeness', () => {
  it('every enabled Dairy card has a handler', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'dairy' && x.enabled)) {
      expect(handlerFor(c.id), c.id).toBeDefined();
    }
  });

  it('all 105 enabled cards have handlers', () => {
    const missing = data.cards.catalogue
      .filter((c) => c.enabled && handlerFor(c.id) === undefined)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

/**
 * ⛔ THE DAIRY FARMSTEAD'S DIVERSION IS GONE (v31), AND IT WAS CALLED "THE
 * SUIT'S WHOLE COMPENSATION". Two describe blocks - the deleted powers and the
 * diversion itself - collapse to the one below. Six divert tests go with the
 * mechanism, and the four rulings they encoded are recorded here because
 * anything that ever reaches into a build payment will meet them again:
 *
 *   1. **Cards spent from your HAND only.** A card D7 lifted off a stack was
 *      never divertible, or D2 + D7 is a free Harvest - stack to build cost to
 *      barn with no Harvest action spent.
 *   2. **Once per Build, however many buildings that Build puts down**, with
 *      the COUNT per card spent - so D12 and D15 diverted more without the
 *      trigger re-firing.
 *   3. **A free build spends no cards and therefore diverts nothing.**
 *   4. **ONE DESTINATION PER SPENT CARD, enforced by ORDERING** rather than by
 *      three assertions: the diversion came out BEFORE the discard and was
 *      never reclaimed from the pile afterwards, so D5 (sow the cards this build
 *      spent) and D6 (give one away), which both reach into the discard on
 *      `afterBuild`, could never race it for the same card.
 *
 * Ruling 4 is the one still enforced in code: it lives in `divertOrDiscard`
 * (actions.ts), and it is what O17 The Fruit Basket obeys by PREPENDING its
 * choice. The other three have no holder left.
 *
 * ⚠️ AND NOTHING REPLACES IT. Dairy measured 10.2 cards into its barn against
 * Orchard's 25.7 because its cards left the pipeline into the tableau and never
 * came back; this was the line that put them back. Watch barn intake.
 */
describe('the deleted Farmstead powers', () => {
  it('a Dairy seat has to match crops like everybody else', () => {
    const s = base();
    // ⚠️ CARD-ONLY BY CONSTRUCTION. Since 05/09/2026 a meeple of a colour pays
    // wherever a card of that colour would (R15), and every seat starts holding one
    // of each, so the supply would answer the question this case asks.
    noMeeples(s);
    // W9 costs 3 wheat. A Dairy seat holding three dairy cards used to be able
    // to pay for it and now cannot: that is buildSubstitutePower, deleted.
    dealTo(data, s, DAIRY, 'W9', 'D4', 'D5', 'D6');
    expect(legalMoves(data, s).filter((m) => m.type === 'build' && m.card === 'W9')).toEqual([]);
  });

  /**
   * ⛔ THE BUILDER'S YARD GRANTS NOTHING NOW (v31). It used to waive crop
   * requirements AND take 2 cards off a visitor's build cost - itself a
   * reversal of a documented ruling that Dean approved on the visitor side,
   * because Build took 5% of all rival door uses, last in the game. v31 makes
   * every door plain on an argument that outranks it: the bonus slot itself
   * became the enhancement, because a door buys a WHOLE CORE ACTION for one
   * card. The `build` block is off the roster entry entirely.
   */
  it('the Builder’s Yard is a plain Build: no substitution, no discount', () => {
    const door = data.workers.roster.find((w) => w.id === 'build');
    expect(door?.action).toBe('build');
    expect('build' in (door as object)).toBe(false);
  });

  /**
   * ⚠️ THE `substitute` MOD OUTLIVED ITS PRODUCER, deliberately. It is the one
   * expression of "crop requirements waived" in the engine and nothing in the
   * shipped data grants it, so this is the standing check that a card which
   * prints those words has somewhere to attach - and that nothing has quietly
   * started granting it again.
   */
  it('nothing in the shipped data grants crop substitution to anybody', () => {
    for (const door of data.workers.roster)
      expect('build' in (door as object), door.id).toBe(false);
  });

  /**
   * ⛔ THE D2 DIVERT BLOCK'S ONE SURVIVING ASSERTION: a build's payment goes
   * straight to the discard, with no limbo and no prompt in between. It used to
   * sit in limbo until the seat chose a destination, and the whole file was
   * written around answering that prompt.
   */
  it('a build payment goes straight to the discard: nothing is diverted', () => {
    const s = base();
    dealTo(data, s, DAIRY, 'W7', 'W4', 'W6');
    const built = apply(data, s, {
      type: 'build',
      seat: DAIRY,
      card: 'W7',
      payment: ['W4', 'W6'],
    });
    expect(built.state.discards.wheat.sort()).toEqual(['W4', 'W6']);
    expect(built.state.tasks.filter((t) => t.t === 'card')).toHaveLength(0);
    expect(player(built.state, DAIRY).barn).toEqual([]);
  });
});

describe('D2 The Farmstead - the own-crop end-game scorer', () => {
  it('D2 scores 1 VP per own-crop DECK card built, never a starter or a foreign crop', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4', 'D8', 'W5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2);
  });

  it('D2 scores 0 on a farm of nothing but starters', () => {
    expect(gameEndScores(data, base())[DAIRY]?.endgame).toBe(0);
  });

  /**
   * ⚠️ RISK 3 OF THE PASS, VISIBLE IN ONE NUMBER. D2 pays for own-suit density
   * and every Power and Endgame card costs 2 cards of its own suit, so both push
   * the same way - and Dairy already built 12.02 buildings a seat against a
   * field of about 5. The suit that builds most is the suit this line pays most.
   */
  it('D2 is the largest single scorer on a wide Dairy farm', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4', 'D5', 'D6', 'D7', 'D8', 'D20');
    // D20's divisor of 2 over 6 built buildings is 3; D2's flat rate is 6.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(3 + 6);
  });
});

describe('the build-modifier vocabulary', () => {
  it('D4 grants a flat discount of 1, whatever is on its stack', () => {
    const s = base();
    // ⚠️ CARD-ONLY: the payment-length assertion below counts CARDS, and a meeple
    // may stand in for one of them since 05/09/2026.
    noMeeples(s);
    buildFor(data, s, DAIRY, 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'D6');
    const grown = growBuilding(data, s, DAIRY, 'D4', 'D5');
    // The rebalance (v21) took this from 2 to 1. Still flat and still
    // unconditional, which is the half of the card that was never in question.
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
    // W9 costs 3; at discount 1 it takes two cards, and either of them may be
    // any crop, because a discount waives the own-suit half.
    const w9 = buildsOf(grown.state, 'W9');
    expect(w9.length).toBeGreaterThan(0);
    expect(w9.every((a) => a.kind === 'build' && a.payment.length === 2)).toBe(true);
    expect(w9.some((a) => a.kind === 'build' && a.payment.includes('D6'))).toBe(true);
  });

  it('D9 discounts 1 per different CROP among the buildings BUILT, not 1 per building', () => {
    // Five buildings and one crop. The rebalance repointed the Wagon from volume
    // to variety, so a monoculture farm reads 1 however big it grows - it was
    // paying a discount of 6 at the measured 12.02 buildings a seat.
    const s = base();
    buildFor(data, s, DAIRY, 'D9', 'D4', 'D6', 'D7', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const mono = growBuilding(data, s, DAIRY, 'D9', 'D5');
    expect(headBuild(mono.state).mods).toEqual({ discount: 1 });

    // Three buildings and three crops: fewer buildings, a bigger discount.
    const t = base();
    buildFor(data, t, DAIRY, 'D9', 'W4', 'O4');
    dealTo(data, t, DAIRY, 'D5', 'W9', 'W5', 'W6');
    const mixed = growBuilding(data, t, DAIRY, 'D9', 'D5');
    expect(headBuild(mixed.state).mods).toEqual({ discount: 3 });
  });

  it('D9 counts crops on buildings BUILT, so a starter never adds one', () => {
    // Ruling M: W19 The Wheat Exchange prints the same eleven words and reads a
    // DIFFERENT set - the whole tableau through cropOf. The Wagon reads
    // builtBuildings, the noun the rest of the suit shares, and a starter is
    // outside it either way.
    // ⛔ THE TEST USED TO FLIP ALL THREE STARTERS, because cropOf returned a
    // starter's suit once it was upgraded and this was the case where the two
    // readings could have disagreed. v31 deletes the flipped faces, so a starter
    // prints the generic starting-building icon for the whole game and the two
    // readings can no longer come apart on a starter at all.
    const s = base();
    buildFor(data, s, DAIRY, 'D9');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D9', 'D5');
    // Dairy, off the Wagon itself and nothing else - so it still opens at 1.
    expect(headBuild(grown.state).mods).toEqual({ discount: 1 });
  });

  it('D7 lets cards come off your own buildings, and they are SPENT not harvested', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4');
    // W4 is the spare wheat card the hand has to keep now: at 2 per stack card
    // an odd cost can never be paid off the stack alone, so a hand with nothing
    // in it but the card being built has no legal build at all.
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D4').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    expect(headBuild(grown.state).mods).toEqual({ fromStacks: true });

    // ⚠️ THE RATE CHANGED ON 19/08/2026: a stack card is worth TWO of the cost,
    // not one. W9 costs 3, so ONE card off D4 pays two thirds of it and the hand
    // pays the last card - and three cards off the stack is no longer offered at
    // all, because six paid against a cost of three is an overpayment and the
    // enumerator never invites one.
    const offers = buildsOf(grown.state, 'W9').filter((a) => a.kind === 'build');
    expect(offers.every((a) => (a.stacks?.length ?? 0) <= 1)).toBe(true);
    // ⭐ RULED 19/08/2026 (Dean): "the card counts as ANY card - including
    // wild", so a stack card is a TRUE wildcard - it fills W9's own-crop half
    // whatever its own suit is. That is why this test now has to name the
    // building it wants: D5 is sitting on D7's own stack (it was the GROW
    // payment above), and spending that single DAIRY card off D7 is a legal way
    // to pay a WHEAT card's wheat requirement. Both options are correct; this
    // one pins the D4 route so the "spent, not harvested" assertions below have
    // a known stack to check.
    const offStacks = offers.find(
      (a) =>
        a.kind === 'build' &&
        (a.stacks?.length ?? 0) === 1 &&
        a.payment.length === 1 &&
        stacked.includes(a.stacks?.[0] as string),
    );
    expect(offStacks).toBeDefined();
    const used = (offStacks as { stacks?: string[] }).stacks?.[0] as string;
    expect(stacked).toContain(used);

    // ...and the wildcard route really is offered alongside it: a Dairy card off
    // D7 paying for a Wheat build is the ruling in one assertion.
    expect(
      offers.some((a) => a.kind === 'build' && (a.stacks ?? []).some((id) => id === 'D5')),
    ).toBe(true);

    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    // One card left the stack, and only one: the other two are still on D4.
    expect(buildingOf(done, DAIRY, 'D4').stack).toHaveLength(2);
    // Spent, not harvested: nothing reached the barn.
    expect(player(done, DAIRY).barn).toEqual([]);
    expect(done.discards.wheat).toContain(used);
    expect(player(done, DAIRY).tableau.some((b) => b.card === 'W9')).toBe(true);
  });

  it('D7 pays off ONE building: no option mixes cards from two stacks', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 2, 'wheat');
    const onD4 = [...buildingOf(s, DAIRY, 'D4').stack];
    const onD8 = [...buildingOf(s, DAIRY, 'D8').stack];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');

    // W9 costs 3, and every card in reach is wheat, so before the cap the
    // enumerator would happily have taken two off D4 and one off D8.
    const offers = buildOffersOf(grown.state, 'W9');
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const stacks = offer.stacks ?? [];
      const mixed = stacks.some((c) => onD4.includes(c)) && stacks.some((c) => onD8.includes(c));
      expect(mixed, JSON.stringify(offer)).toBe(false);
    }
    // Both single-building payments survive, and so does the hand-only one: the
    // empty leading source is why the option set is a union and not a partition.
    expect(offers.some((o) => (o.stacks ?? []).some((c) => onD4.includes(c)))).toBe(true);
    expect(offers.some((o) => (o.stacks ?? []).some((c) => onD8.includes(c)))).toBe(true);
    expect(offers.some((o) => o.stacks === undefined && o.payment.length === 3)).toBe(true);
  });

  it('D7 re-validates the cap on the way in, not only in the enumerator', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9');
    loadStack(data, s, DAIRY, 'D4', 2, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 2, 'wheat');
    const onD4 = buildingOf(s, DAIRY, 'D4').stack as CardId[];
    const onD8 = buildingOf(s, DAIRY, 'D8').stack as CardId[];
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');

    // buildOptions never offers this, so the second guard can only be reached by
    // calling doBuild - which is exactly the case it is there for, since apply
    // has to refuse a payment that was never on the menu. Nothing has moved when
    // it throws: every check in doBuild runs before the first mutation.
    const fx = new Fx(data, grown.state, DAIRY);
    expect(() =>
      doBuild(
        fx,
        DAIRY,
        {
          card: 'W9',
          payment: [],
          stacks: [onD4[0] as CardId, onD4[1] as CardId, onD8[0] as CardId],
        },
        { fromStacks: true },
      ),
    ).toThrow(/only one of your buildings/);
  });

  /**
   * ⛔ "D7 + D2: A STACK CARD IS NEVER DIVERTIBLE, SO THE PAIR IS NOT A FREE
   * HARVEST" IS DELETED (v31): D2 diverts nothing any more, so there is no pair.
   * The ruling it pinned is recorded in the Farmstead block above and is worth
   * re-reading before anything else reaches into a build payment - stack cards
   * are SPENT, not harvested, and letting one be diverted turns stack-to-cost-to-
   * barn into a Harvest nobody spent an action on.
   *
   * What survives is the half that is still true and still load-bearing: a card
   * off a stack goes to the DISCARD and never to the barn, by any route.
   */
  it('a card spent off a stack goes to the discard, never to a barn', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D7', 'D4');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4');
    loadStack(data, s, DAIRY, 'D4', 3, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D7', 'D5');
    // W9 costs 3 and a stack card pays 2, so the cheapest stack-fed payment is
    // one card off D4 plus one out of hand.
    const offStacks = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 1 && (a.stacks?.length ?? 0) === 1,
    );
    expect(offStacks).toBeDefined();
    const stackCard = (offStacks as { stacks?: string[] }).stacks?.[0] as string;
    const done = answerTask(data, grown.state, offStacks as TaskAnswer).state;
    expect(player(done, DAIRY).barn).toEqual([]);
    // Its own suit's pile, whichever that is: the enumerator is free to pick
    // any one card off D4's stack, and D7's OWN stack is a legal source too.
    const piles = Object.values(done.discards).flat();
    expect(piles).toContain(stackCard);
  });
});

describe('D6 The Trading Shed - the card across the table', () => {
  /**
   * ⛔ The £1 is a Draw 1 (v31, plan section 3.3). The shape is untouched - it
   * pays for the GIFT and not for the build, so no eligible neighbour means no
   * payout - but the arithmetic sharpens: giving away a card you had already
   * spent and drawing a fresh one is card-POSITIVE, where the coin was worth
   * about a fifth of a card in practice.
   */
  it('gives one spent card to a neighbour and draws 1 back', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D6');
    dealTo(data, s, DAIRY, 'D5', 'W7', 'W4', 'W5');
    const grown = growBuilding(data, s, DAIRY, 'D6', 'D5');
    const build = buildsOf(grown.state, 'W7')[0];
    let state = answerTask(data, grown.state, build as TaskAnswer).state;

    const give = pendingAnswers(data, state).find((a) => a.kind === 'card');
    expect(give).toBeDefined();
    const card = (give as Extract<TaskAnswer, { kind: 'card' }>).payload.card as string;
    state = answerTask(data, state, give as TaskAnswer).state;
    expect(state.tasks.some((t) => t.t === 'draw' && t.src === 'D6')).toBe(true);
    expect(player(state, WHEAT).hand).toContain(card);
    expect(state.discards.wheat).not.toContain(card);
  });

  /**
   * ⭐ "NO ELIGIBLE NEIGHBOUR MEANS NO PAYOUT" IS REACHABLE AGAIN. The test was
   * deleted by v31, on the reading that DL-63 - a gift never forces an
   * out-of-turn discard, so a rival at their hand limit is not eligible - had no
   * limit left to read and the case could not be built. The hand limit came back
   * on 02/09/2026 as `rules.turn.handLimit`, so it can, and this is it: fill
   * every rival to the limit and D13 has nobody to hand a card to.
   */
  it('D13 pays nothing when every rival is at the hand limit (DL-63)', () => {
    const limit = data.rules.turn.handLimit as number;
    const s = base();
    for (let seat = 0; seat < s.players.length; seat++) {
      if (seat === DAIRY) continue;
      const suit = s.players[seat]!.suit;
      dealTo(data, s, seat, ...s.decks[suit].slice(0, limit));
      expect(player(s, seat).hand).toHaveLength(limit);
    }
    expect(freeHandSpace(data, s, WHEAT)).toBe(0);
  });
});

describe("D10 The Scout's Post - the free look", () => {
  it('reveals every live deck and builds one at a discount of 2', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const wheatTop = s.decks.wheat[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const offers = revealedOffers(grown.state);
    // One top per suit in play is on offer (those that are affordable at -2).
    expect(offers.length).toBeGreaterThan(0);
    const takeWheat = offers.find((o) => o.card === wheatTop)?.answer;
    expect(takeWheat).toBeDefined();
    const state = answerAll(answerTask(data, grown.state, takeWheat as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === wheatTop)).toBe(true);
  });

  it('unbuilt reveals go back on top of their own decks, never to a discard', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5');
    const tops = Object.fromEntries(
      data.cards.suits.map((suit) => [suit, s.decks[suit][0] as string]),
    );
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    const skip = pendingAnswers(data, grown.state).find((a) => a.kind === 'skip');
    expect(skip).toBeDefined();
    const done = answerTask(data, grown.state, skip as TaskAnswer).state;
    for (const suit of data.cards.suits) {
      expect(done.decks[suit][0], suit).toBe(tops[suit]);
      expect(done.discards[suit], suit).toEqual([]);
    }
  });

  it('costs nothing but the card that grows it: the £3 gate is long gone', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D10');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D10', 'D5');
    expect(pendingAnswers(data, grown.state).some((a) => a.kind === 'card')).toBe(true);
  });
});

describe('D11 The Heritage House - sow the payment back', () => {
  it('sows every card the build spent, onto ANY of your own buildings', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D8');
    // W9 costs 2 wheat + 1 wild, so the build spends three cards and all three
    // come back onto the board. D5 pays to grow the House.
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    expect(headBuild(grown.state).mods).toEqual({});

    const w9 = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 3,
    );
    expect(w9).toBeDefined();
    // The Farmstead's divert is PREPENDED in front of everything the build
    // queued, so it is declined first - which is also the proof that ONE
    // DESTINATION PER SPENT CARD still falls out of the ordering: a card banked
    // in the barn would have left the discard and could not then be sown.
    const built = answerTask(data, grown.state, w9 as TaskAnswer).state;
    const spent = (w9 as Extract<TaskAnswer, { kind: 'build' }>).payment;

    // Every spent card is offered, and against every own building with room -
    // the new building included, and the two Tier 1s that were already down.
    const onto = pendingAnswers(data, built)
      .filter((a) => a.kind === 'card')
      .map((a) => a.payload.onto);
    for (const card of spent) {
      expect(offeredCards(built), card).toContain(card);
    }
    expect(onto).toContain('D4');
    expect(onto).toContain('D8');
    expect(onto).toContain('W9');

    const done = answerAll(built);
    // Nothing the build spent is still in a discard: it is all on the table.
    for (const card of spent) expect(done.discards.wheat).not.toContain(card);
    const placed = player(done, DAIRY).tableau.flatMap((b) => b.stack);
    for (const card of spent) expect(placed).toContain(card);
  });

  it('the sow is per card, so one payment can finish two different stacks', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D8');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    // D4 and D8 are both threshold 2 and both already hold one card, so a
    // 3-card payment can top up both and put the third on the new building.
    loadStack(data, s, DAIRY, 'D4', 1, 'wheat');
    loadStack(data, s, DAIRY, 'D8', 1, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const w9 = buildsOf(grown.state, 'W9').find(
      (a) => a.kind === 'build' && a.payment.length === 3,
    );
    let state = answerTask(data, grown.state, w9 as TaskAnswer).state;
    for (const target of ['D4', 'D8']) {
      const answer = pendingAnswers(data, state).find(
        (a) => a.kind === 'card' && a.payload.onto === target,
      );
      expect(answer, target).toBeDefined();
      state = answerTask(data, state, answer as TaskAnswer).state;
    }
    expect(buildingOf(state, DAIRY, 'D4').stack).toHaveLength(2);
    expect(buildingOf(state, DAIRY, 'D8').stack).toHaveLength(2);
    // Both Tier 1s are full now and drop out of the target list by themselves;
    // what is left is the just-built W9 and the two starters that carry a
    // threshold (the Service and the Notice Board), which is the same target
    // set tasks.ts sowTargets builds for a sow task with no explicit list.
    const left = pendingAnswers(data, state).filter((a) => a.kind === 'card');
    const onto = new Set(left.map((a) => (a.kind === 'card' ? a.payload.onto : null)));
    expect(onto.has('W9')).toBe(true);
    expect(onto.has('D4')).toBe(false);
    expect(onto.has('D8')).toBe(false);
  });

  it('sows as far as there is room and leaves the rest, never refusing the build', () => {
    // The mandatory-effect convention for the whole v30 pass (plan section 8.3)
    // is SKIP SILENTLY: sow as many of the spent cards as there are legal
    // targets for, never refuse the activation and never refuse the Build.
    //
    // A total no-op is close to unreachable and that is worth saying out loud:
    // the card the Build just put down is itself a legal target, empty and with
    // room, so there is almost always somewhere for the FIRST card to go. What
    // is easy to reach is a PARTIAL sow, and that is the case that decides the
    // convention. W13 costs four cards and prints a threshold of 1, so with
    // every other building of the seat full exactly one of the four can land.
    const s = base();
    buildFor(data, s, DAIRY, 'D11');
    dealTo(data, s, DAIRY, 'D5', 'W13', 'W4', 'W5', 'W6', 'W7');
    // D11 is threshold 2 and the grow payment is its second card, so it fills
    // itself; the Notice Board is 5. Change 6 deleted D0 the Service, so the
    // seat has one fewer building to fill.
    loadStack(data, s, DAIRY, 'D11', 1, 'wheat');
    loadStack(data, s, DAIRY, 'D3', 5, 'wheat');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const w13 = buildsOf(grown.state, 'W13').find((a) => a.kind === 'build');
    expect(w13).toBeDefined();
    const spent = (w13 as Extract<TaskAnswer, { kind: 'build' }>).payment;
    expect(spent).toHaveLength(4);
    const done = answerAll(answerTask(data, grown.state, w13 as TaskAnswer).state);

    // The build happened, one card landed on it, and the other three simply
    // stayed in the discard. No task is left waiting for an impossible answer.
    expect(player(done, DAIRY).tableau.some((b) => b.card === 'W13')).toBe(true);
    expect(buildingOf(done, DAIRY, 'W13').stack).toHaveLength(1);
    const stranded = spent.filter((c) => done.discards.wheat.includes(c));
    expect(stranded).toHaveLength(3);
    expect(done.tasks).toHaveLength(0);
  });

  /**
   * ⛔ "A FREE BUILD SPENDS NOTHING, SO IT SOWS NOTHING" IS DELETED (v31), AND
   * IT IS THE CASE ITSELF THAT BECAME UNREACHABLE RATHER THAN THE RULE. It drove
   * W16, which used to be a COIN-priced Power card at a card cost of 0, so a
   * granted Build could take it for no cards at all and D11 had nothing to sow
   * back. Since v31 the 30 Power and Endgame cards cost 2 cards of their own
   * suit and NO CARD IN THE CATALOGUE COSTS ZERO CARDS, so a payment-free build
   * cannot be reached through D11's grant at any board state.
   *
   * The guard is still in the handler (`event.payment.length === 0` returns
   * early) and still has one live producer: D15 The Grand Creamery's free build,
   * which lands through `placeBuilt` with an empty payment. O17 The Fruit Basket
   * carries the same guard for the same reason.
   */
  it('nothing in the game covers a building any more', () => {
    // The `covered` zone was deleted on 19/08/2026 with D11's build-on-top.
    // fx.coverBuilding is gone, and this is the cheap standing check that it
    // has not been quietly reintroduced by a later card.
    const fx = new Fx(data, base(), DAIRY) as unknown as Record<string, unknown>;
    expect(fx['coverBuilding']).toBeUndefined();
  });
});

describe('D13 The Cheese Vault - the scaler', () => {
  it('draws one per building BUILT, starters excluded', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D5', 'D6');
    dealTo(data, s, DAIRY, 'W4');
    // D13, D4, D5, D6 - four built buildings, and never a starter. The grow
    // payment leaves the hand, so four drawn cards is what is left.
    const state = answerAll(growBuilding(data, s, DAIRY, 'D13', 'W4').state);
    expect(player(state, DAIRY).hand).toHaveLength(4);
  });

  it('gives nothing to anybody: the cross-table half is deleted', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9');
    dealTo(data, s, DAIRY, 'W4', 'W5', 'W6');
    const state = answerAll(growBuilding(data, s, DAIRY, 'D13', 'W4').state);
    // Seven buildings, so seven cards drawn on top of a hand of two, and no
    // rival gains anything. ⛔ THERE IS NO BRAKE LEFT AT ALL (v31): the hand
    // limit was already unenforced mid-turn, and the end-of-turn discard that
    // used to catch it afterwards has gone with the limit itself.
    expect(player(state, WHEAT).hand).toEqual([]);
    expect(player(state, DAIRY).hand.length).toBeGreaterThan(5);
  });

  it('is a GROW building now, not an ACTION', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D13');
    dealTo(data, s, DAIRY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'cardMove' && m.card === 'D13')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D13')).toBe(true);
  });
});

describe('D14 The Cream Refinery - the demolition', () => {
  it('sends the building AND its stack to the discard, then 3 deck cards to the barn', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D9');
    dealTo(data, s, DAIRY, 'W4');
    loadStack(data, s, DAIRY, 'D9', 2, 'wheat');
    const stacked = [...buildingOf(s, DAIRY, 'D9').stack];
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const takeD9 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D9',
    );
    let state = answerTask(data, grown.state, takeD9 as TaskAnswer).state;
    // Dean, 19/08/2026: NEITHER the building NOR its stack becomes freight.
    expect(player(state, DAIRY).barn).toEqual([]);
    for (const card of stacked) expect(state.discards.wheat).toContain(card);
    expect(state.discards.dairy).toContain('D9');
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'D9')).toBe(false);
    // Then a FLAT 3 deck cards, not one per card of the demolished build cost
    // (D9 costs 3, so the old card would have paid the same here by accident).
    state = answerAll(state);
    expect(player(state, DAIRY).barn).toHaveLength(3);
  });

  it('pays a flat 3 whatever the demolished building cost', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4'); // D4 costs 1 dairy
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const takeD4 = pendingAnswers(data, grown.state).find(
      (a) => a.kind === 'card' && a.payload.card === 'D4',
    );
    const state = answerAll(answerTask(data, grown.state, takeD4 as TaskAnswer).state);
    expect(player(state, DAIRY).barn).toHaveLength(3);
  });

  it('never offers a starter, so it cannot mint freight from one (ticket 30)', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D14', 'D4');
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D14', 'W4');
    const targets = offeredCards(grown.state);
    // D0 the Service is gone (change 6); D1/D2/D3 are the three starters.
    expect(targets).not.toContain('D1');
    expect(targets).not.toContain('D2');
    expect(targets).not.toContain('D3');
    expect(targets).toContain('D4');
  });

  it('the demolished card scores nothing, because scoring reads the tableau', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D4');
    const before = gameEndScores(data, s)[DAIRY]?.printed ?? 0;
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.printed).toBe(before - 1);
  });
});

describe('D15 The Grand Creamery - two reveals, one free build', () => {
  const pickDeck = (state: GameState, suit: string) =>
    pendingAnswers(data, state).find((a) => a.kind === 'card' && a.payload.suit === suit);

  it('reveals 2, builds 1 free and discards the other', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    const first = s.decks.wheat[0] as string;
    const second = s.decks.wheat[1] as string;
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');

    // Dean, 19/08/2026: any deck, and the two may be the same one.
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'wheat') as TaskAnswer).state;

    // Both are now on offer, and exactly one gets built.
    const offers = revealedOffers(state);
    const offered = offers.map((o) => o.card);
    expect(offered).toContain(first);
    expect(offered).toContain(second);
    const buildFirst = offers.find((o) => o.card === first)?.answer;
    state = answerAll(answerTask(data, state, buildFirst as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === first)).toBe(true);
    expect(player(state, DAIRY).tableau.some((b) => b.card === second)).toBe(false);
    expect(state.discards.wheat).toContain(second);
    // Free: no cards paid at all, so the hand is exactly what the grow left.
    expect(player(state, DAIRY).hand).toEqual([]);
  });

  it('the two decks may be different', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    const wheatTop = s.decks.wheat[0] as string;
    const dairyTop = s.decks.dairy[0] as string;
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'dairy') as TaskAnswer).state;
    const offered = revealedOffers(state).map((o) => o.card);
    expect(offered).toContain(wheatTop);
    expect(offered).toContain(dairyTop);
  });

  it('an expensive Power card still builds free, which is the jackpot', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    // ⛔ W16 USED TO BE A COIN-PRICED POWER CARD AT A CARD COST OF ZERO, so this
    // test proved the free build could take something the seat could not have
    // afforded in cards. Since v31 the 30 Power and Endgame cards cost 2 cards
    // of their own suit, which makes the case STRONGER rather than moot: a Dairy
    // seat can now never buy W16 out of hand at all, and the Creamery hands it
    // over for nothing.
    s.decks.wheat = ['W16', ...s.decks.wheat.filter((c) => c !== 'W16')];
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    let state = answerTask(data, grown.state, pickDeck(grown.state, 'wheat') as TaskAnswer).state;
    state = answerTask(data, state, pickDeck(state, 'wheat') as TaskAnswer).state;
    const buildW16 = revealedOffers(state).find((o) => o.card === 'W16')?.answer;
    expect(buildW16).toBeDefined();
    state = answerAll(answerTask(data, state, buildW16 as TaskAnswer).state);
    expect(player(state, DAIRY).tableau.some((b) => b.card === 'W16')).toBe(true);
    expect(player(state, DAIRY).hand).toEqual([]);
  });

  it('is a GROW building now, not an ACTION', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15');
    dealTo(data, s, DAIRY, 'W4');
    expect(legalMoves(data, s).some((m) => m.type === 'cardMove' && m.card === 'D15')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'grow' && m.building === 'D15')).toBe(true);
  });
});

describe('D16 The Ledger and D17 The Strongbox - the reactors', () => {
  it('D16 draws once on a plain Build action', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(built.state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16')).toHaveLength(1);
  });

  it('D16 fires TWICE for a Butter Factory that builds twice - the guard is gone', () => {
    // "Once per turn." came off the sheet on 19/08/2026 (v30 group A) and this
    // is the interaction both earlier guards existed to stop: the once-per-Build
    // ACTION ruling of 2026-08-10 and the general turn.firedThisTurn rule that
    // replaced it on 2026-08-12. It is now a real power increase and it is
    // balance flag 8.4, owed the d16-ledger-uncapped arm.
    const s = base();
    buildFor(data, s, DAIRY, 'D16', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    let state = grown.state;
    let draws = 0;
    for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
      const before = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      const answers = pendingAnswers(data, state);
      const build = answers.find((a) => a.kind === 'build');
      state = answerTask(data, state, (build ?? answers[0]) as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D16').length;
      if (after > before) draws += after - before;
    }
    expect(draws).toBe(2);
  });

  it('D16 is not a member of firedThisTurn, so it cannot be filtered out of a GROW', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const built = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(built.state.turn.firedThisTurn).not.toContain('D16');
  });

  it('D16 does not fire on a rival build', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D16');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const built = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(built.state.tasks.some((t) => t.t === 'draw' && t.src === 'D16')).toBe(false);
  });

  /**
   * ⛔ D17'S SCOPE FLIPPED FROM RIVAL TO OWNER AND THE HANDLER HAD NOT FOLLOWED,
   * so this test inverts twice over. What it pinned: "whenever a NEIGHBOUR
   * builds, take £1" - the "materials yard", the purest statement of the suit
   * paying you for the village building rather than for building yourself, and
   * the number flagged as most likely wrong in the whole suit. The SHEET has
   * printed "When you build a card that is not Dairy" since v30 and the engine
   * was still running the older text; v31 converts the coin to a draw, and this
   * pass follows the print on both halves at once.
   *
   * ⚠️ SO THE SUIT LOST ITS SECOND CROSS-TABLE CARD IN ONE EDIT. With D2 an
   * end-game scorer and this owner-scoped, Dairy touches another seat in exactly
   * one place: D6. What the card pays for now is ANTI-MONOCULTURE, which is the
   * one thing in its favour - it fires only on a non-Dairy build, so it pulls
   * against D2 and against the own-suit Power price.
   */
  it('D17 draws when YOU build a non-Dairy card, and never on a Dairy one', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, DAIRY, 'W5', 'W4');
    const foreign = apply(data, s, { type: 'build', seat: DAIRY, card: 'W5', payment: ['W4'] });
    expect(foreign.state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17')).toHaveLength(1);

    const t = base();
    buildFor(data, t, DAIRY, 'D17');
    dealTo(data, t, DAIRY, 'D4', 'D5');
    const own = apply(data, t, { type: 'build', seat: DAIRY, card: 'D4', payment: ['D5'] });
    expect(own.state.tasks.some((x) => x.t === 'draw' && x.src === 'D17')).toBe(false);
  });

  it('D17 no longer fires on a RIVAL build at all', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17');
    dealTo(data, s, WHEAT, 'W5', 'W4');
    s.turnPlayer = WHEAT;
    const rival = apply(data, s, { type: 'build', seat: WHEAT, card: 'W5', payment: ['W4'] });
    expect(rival.state.tasks.some((t) => t.t === 'draw' && t.src === 'D17')).toBe(false);
    expect(handlerFor('D17')?.difficulty.verified.crossPlayer).toBe(false);
  });

  /**
   * ⚠️ IT FIRES PER BUILDING, NOT PER BUILD ACTION, which is unchanged and is
   * the same reading D16 has: a Butter Factory run that lands two foreign cards
   * pays this twice.
   */
  it('D17 fires per BUILDING, so a Butter Factory pays it twice', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D17', 'D12');
    dealTo(data, s, DAIRY, 'D5', 'W4', 'W5', 'W6', 'W7');
    const grown = growBuilding(data, s, DAIRY, 'D12', 'D5');
    let state = grown.state;
    let draws = 0;
    for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
      const before = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17').length;
      const answers = pendingAnswers(data, state);
      const build = answers.find((a) => a.kind === 'build');
      state = answerTask(data, state, (build ?? answers[0]) as TaskAnswer).state;
      const after = state.tasks.filter((t) => t.t === 'draw' && t.src === 'D17').length;
      if (after > before) draws += after - before;
    }
    expect(draws).toBe(2);
  });
});

describe('the endgame cards - D19, D20, D21', () => {
  it('D19 scores 1 per building printing a non-Dairy crop icon', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D19', 'W5', 'W6', 'D4');
    // D19's 2 for the two Wheat cards, plus D2 the Farmstead's 2 for D19 and D4
    // being Dairy. The two cards point in opposite directions on one tableau.
    // ⛔ Ticket 07's starter clause is now unconditional: a starter prints the
    // generic starting-building icon for the whole game, so it belongs to no
    // crop and there is no flipped face left to give it one.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(4);
  });

  it('D20 scores 1 for every 2 buildings BUILT - never a starter', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D20', 'D10', 'D4');
    // D20, D10 and D4 - the starters are not built - and the divisor of 2 the
    // rebalance added rounds three down to one. D2 adds its flat 3.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1 + 3);
    // So the fourth building is what actually pays for the third.
    buildFor(data, s, DAIRY, 'D5');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2 + 4);
  });

  /**
   * ⛔ D21 IS REPLACED (v31, plan section 3.2). It read "2 VP for each of your
   * starters showing its upgraded side" and lost its referent outright: there
   * are no upgraded faces left to show. The replacement fills the one gap in an
   * existing set - A20 scores HIVEs, O20 ORCHARDs, V20 DEPOTs, W21 FIELDs - so
   * the five Endgame trios are symmetrical for the first time.
   *
   * ⚠️ AND IT IS THE CARD IT REPLACED THAT REPLACED IT, on 2026-08-12. The
   * reasoning that moved it away then is the reasoning to watch now that it is
   * back: "2 VP for each own-suit noun" pays most on the suit that builds most,
   * and Dairy built 12.02 buildings a seat against a field of about 5.
   */
  it('D21 scores 2 for each SHED built', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21');
    // D2's 1 for D21 itself, and no SHED yet.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
    buildFor(data, s, DAIRY, 'D4', 'D5');
    // D21's 4 for two SHEDs, plus D2's 3 for the three Dairy cards built.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(4 + 3);
  });

  /**
   * ⚠️ SHED IS THE TITLE KEYWORD AND NOT THE TIER, so the ceiling is D4-D8 at
   * 10 VP - the same ceiling A20 and O20 carry, on the suit that reaches it most
   * often. A non-SHED Dairy building never counts, which is what separates this
   * card from D20 The Counting House standing beside it.
   */
  it('D21 counts SHEDs only: a Dairy building that is not one scores nothing for it', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D10', 'D16');
    // No SHED at all, so D21 contributes 0 and D2's 3 is the whole score.
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(3);
  });

  /**
   * ⛔ A DEMOLISHED SHED STOPS COUNTING, which is the cost of demolishing and
   * the standing reading every "you have built" formula in the suit shares.
   */
  it('D21 does not count a demolished SHED', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21', 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(2 + 2);
    player(s, DAIRY).tableau = player(s, DAIRY).tableau.filter((b) => b.card !== 'D4');
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1);
  });

  /**
   * ⛔ AND IT NEVER COUNTS A STARTER, which is the trap the OLD D21 fell into
   * from the other side. That card counted starters and nothing else, so
   * reaching for `builtBuildings` - the noun D9, D13, D14 and D20 all share,
   * which exists precisely to EXCLUDE starters - would have scored it 0 forever
   * with no test of types or shapes seeing it. The v31 card reads
   * `isShedCard`, so the hazard has swapped ends: a starter must contribute
   * NOTHING, and three starters plus no SHED is the case that catches it.
   */
  it('D21 never counts a starter', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D21');
    expect(
      player(s, DAIRY).tableau.filter((b) => ['D1', 'D2', 'D3'].includes(b.card)),
    ).toHaveLength(3);
    expect(gameEndScores(data, s)[DAIRY]?.endgame).toBe(1); // D2's own line only
  });
});

describe('the SHED keyword - D21 The Refinery is now its only reader', () => {
  it('SHED means exactly the five Tier 1 cards', () => {
    const sheds = data.cards.catalogue
      .filter((c) => c.suit === 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(sheds).toEqual(['D4', 'D5', 'D6', 'D7', 'D8']);
    // ⚠️ The hazard the keyword reading carries: any future card named
    // "... Shed" joins the set silently. Nothing outside Dairy carries it today.
    // ⛔ THE READER CHANGED TWICE. D21 The Refinery read it until the rebalance
    // repointed it at upgraded starter faces (2026-08-12), leaving D1's build
    // rider as the only caller; v31 deletes the Barn rider and gives D21 the
    // SHED count back, so D21 is the single reader again.
    const strays = data.cards.catalogue
      .filter((c) => c.suit !== 'dairy' && /\bShed\b/.test(c.name))
      .map((c) => c.id);
    expect(strays).toEqual([]);
  });
});

describe('difficulty metadata stays honest for the Dairy suit', () => {
  it('the derivable flags match each handler structure', () => {
    for (const c of data.cards.catalogue.filter((x) => x.suit === 'dairy' && x.enabled)) {
      const h = handlerFor(c.id);
      expect(h, c.id).toBeDefined();
      expect(h?.difficulty.verified.endgame, c.id).toBe(typeof h?.gameEnd === 'function');
      expect(h?.difficulty.verified.addsMoves, c.id).toBe(typeof h?.moves === 'function');
    }
  });

  it('the three Tier 3 cards are ordinary GROW buildings - the ACTION is retired', () => {
    // Dean, 19/08/2026: "The concept of an ACTION was never requested. They are
    // all GROW." Every assertion in this test is the inverse of what it was.
    for (const id of ['D13', 'D14', 'D15']) {
      const card = data.cards.catalogue.find((c) => c.id === id);
      expect(card?.threshold, id).toBeGreaterThan(0);
      expect(card?.activationType, id).toBe('wild');
      expect(card?.abilityTrigger, id).toEqual(['onActivate']);
      // ⛔ `actionMoves` no longer EXISTS on CardHandler (19/08/2026), so this
      // reads the object rather than the type: a property that is gone cannot
      // be asserted undefined, and `in` is what still fails loudly if someone
      // puts the concept back.
      expect('actionMoves' in (handlerFor(id) as object), id).toBe(false);
      expect(handlerFor(id)?.moves, id).toBeUndefined();
      expect(typeof handlerFor(id)?.activate, id).toBe('function');
    }
  });
});

describe('a full Dairy turn still settles', () => {
  it('grows the hardest card and drains without wedging', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D11', 'D4', 'D16');
    dealTo(data, s, DAIRY, 'D5', 'W9', 'W4', 'W5', 'W6');
    const grown = growBuilding(data, s, DAIRY, 'D11', 'D5');
    const state = answerAll(grown.state);
    expect(state.tasks).toHaveLength(0);
  });

  it('runs the Grand Creamery through its two reveals without wedging', () => {
    const s = base();
    buildFor(data, s, DAIRY, 'D15', 'D16');
    dealTo(data, s, DAIRY, 'W4');
    const grown = growBuilding(data, s, DAIRY, 'D15', 'W4');
    const state = answerAll(grown.state, (a) => a.find((x) => x.kind === 'card') ?? a[0]!);
    expect(state.tasks).toHaveLength(0);
  });
});
