/**
 * The game-walking proofs behind the policy layer (wayfinder ticket 28).
 *
 * They live in @gp/sim rather than beside the bots because they need a
 * `GameState` and a driver, and the whole guarantee of @gp/bots is that nothing
 * in it can reach one.
 */

import { BASE_GAME_DATA as data } from '@gp/data';
import type { Suit } from '@gp/data';
import type { CardId, GameState, Move, PlayerView, Seat } from '@gp/engine';
import { apply, legalMoves, makeProber, newGame, tileLevel, viewFor } from '@gp/engine';
import type { PolicyId } from '@gp/bots';
import { TERMS, actOf, cardValue, makePolicy, policyRng, totalValue } from '@gp/bots';
import { describe, expect, it } from 'vitest';

import { assignProfiles, runGame } from './driver.js';

const SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

function mirror(id: PolicyId, seats: number) {
  return Array.from({ length: seats }, () => id);
}

/** A build in either spelling: the main move or its task-answer twin. */
interface BuildAct {
  readonly card: CardId;
  readonly payment: readonly CardId[];
  readonly coinWild: number;
  readonly barn: number;
}

function buildAct(move: Move): BuildAct | null {
  const act = actOf(move);
  return act.a === 'build'
    ? { card: act.card, payment: act.payment, coinWild: act.coinWild, barn: act.barn }
    : null;
}

/** Same card, and paid the same way - so only the cards themselves differ. */
function sameMethod(a: BuildAct, b: BuildAct): boolean {
  return a.card === b.card && a.coinWild === b.coinWild && a.barn === b.barn;
}

// --- view safety -----------------------------------------------------------

/**
 * Payload keys that hold something other than a card.
 *
 * Card ids and island tile ids share a namespace - `A5` is both the Apiary Barn
 * and a Level 1 tile - so an id alone cannot say which it is. Only V12's card
 * task carries a tile in a payload today; if another one appears, it lands here
 * rather than in the violation list.
 */
const NON_CARD_KEYS = new Set(['tile', 'balloon']);

/**
 * Card ids a move names, extracted structurally rather than by pattern, for the
 * reason above.
 */
function cardIdsIn(move: Move, catalogue: ReadonlySet<CardId>): CardId[] {
  const act = actOf(move);
  const fromPayload = (payload: Record<string, unknown>): CardId[] =>
    Object.entries(payload)
      .filter(([key]) => !NON_CARD_KEYS.has(key))
      .map(([, value]) => value)
      .filter((value): value is CardId => typeof value === 'string' && catalogue.has(value));
  switch (act.a) {
    case 'build':
      return [act.card, ...act.payment];
    case 'upgrade':
      return [act.card];
    case 'grow':
      return [act.building, act.payment];
    case 'harvest':
      return [act.building];
    case 'sow':
      return [act.card, act.onto];
    case 'keep':
    case 'discard':
      return [...act.cards];
    case 'visit':
      return [...act.fee];
    case 'cardMove':
      return [act.card, ...fromPayload(act.payload)];
    case 'cardTask':
      return fromPayload(act.payload);
    default:
      return [];
  }
}

/** Everything the acting seat is entitled to name: its own, or public. */
function knowableIds(view: PlayerView): Set<CardId> {
  const ok = new Set<CardId>(view.you.hand);
  for (const b of view.you.tableau) ok.add(b.card);
  for (const id of view.you.covered) ok.add(id);
  for (const rival of view.rivals) {
    for (const b of rival.tableau) ok.add(b.card);
    for (const id of rival.covered) ok.add(id);
  }
  for (const pile of Object.values(view.discards)) for (const id of pile) ok.add(id);
  // Your own in-flight draw: you have seen these, and `keep` answers name them.
  for (const task of view.tasks) {
    if (task.t === 'draw' && task.pid === view.seat) for (const id of task.revealed) ok.add(id);
  }
  return ok;
}

function walkForViewSafety(seed: string, seats: number, ids: PolicyId[]): number {
  const catalogue = new Set(data.cards.catalogue.map((c) => c.id));
  const policies = ids.map((id) => makePolicy(id));
  const rngs = policies.map((p, seat) => policyRng(seed, seat, p.id));
  let state: GameState = newGame(data, { seats, suits: SUITS.slice(0, seats), seed });
  let checked = 0;

  for (let step = 0; step < 900 && state.phase === 'playing'; step++) {
    const moves = legalMoves(data, state);
    if (moves.length === 0) break;
    const seat: Seat = (moves[0] as Move).seat;
    const view = viewFor(data, state, seat);
    const ok = knowableIds(view);
    for (const move of moves) {
      expect(move.seat).toBe(seat);
      for (const id of cardIdsIn(move, catalogue)) {
        if (!ok.has(id)) {
          throw new Error(
            `seat ${seat} was offered ${id} in ${JSON.stringify(move)} but cannot see it`,
          );
        }
        checked += 1;
      }
    }
    const policy = policies[seat];
    const rng = rngs[seat];
    if (!policy || !rng) throw new Error('missing policy');
    const probe = makeProber(data, state, seat);
    state = apply(data, state, policy.choose({ data, view, moves, rng, probe })).state;
  }
  return checked;
}

describe('view safety', () => {
  it('never offers a seat a card id it cannot see', () => {
    // Ticket 10 argued the Move union is view-safe by construction. This is
    // what stops that being an assumption: a barn spend that leaked ids, or a
    // task answer naming a rival's hand, fails here.
    let checked = 0;
    checked += walkForViewSafety('vs-2', 2, mirror('balanced', 2));
    checked += walkForViewSafety('vs-3', 3, mirror('greedy', 3));
    checked += walkForViewSafety('vs-4', 4, assignProfiles('vs-4', 4));
    expect(checked).toBeGreaterThan(5000);
  });
});

// --- termination -----------------------------------------------------------

describe('termination', () => {
  /**
   * A RATE, like the mixed-table test below and for the same ticket 47 reason:
   * one fixed seed per seat count is a coin toss away from red on any change
   * that moves a trajectory. Ticket 56 flipped it: shipping the market moved
   * seed `end-2` from ended to stalled while a 24-seed probe showed 24/24
   * finishing at every seat count in both the market-on and market-off arms -
   * the seed, not a regression.
   */
  it('finishes balanced mirrors at 2, 3 and 4 seats', () => {
    for (const seats of [2, 3, 4]) {
      let ended = 0;
      let hitLevelThree = false;
      for (let n = 0; n < 6; n++) {
        const result = runGame(data, {
          seed: `end-${seats}-${n}`,
          seats,
          suits: SUITS.slice(0, seats),
          policies: mirror('balanced', seats),
        });
        if (result.outcome === 'ended') ended += 1;
        // Off the island, not off the receipt values: a receipt now carries its
        // fill-order bonus, so a Level 3 delivery is not always worth 16.
        if (
          result.state.island.tiles.some(
            (t) => tileLevel(data, t.tile) === 3 && t.deliveredBy.length > 0,
          )
        ) {
          hitLevelThree = true;
        }
      }
      expect(ended, `${seats} seats`).toBeGreaterThanOrEqual(5);
      expect(hitLevelThree, `${seats} seats reached Level 3`).toBe(true);
    }
  });

  /**
   * A RATE rather than one seed per seat count, which is what this was until
   * ticket 47. About 2% of mixed games lock the card supply (assertion 13,
   * ticket 34), so a single fixed seed per seat count is a coin toss away from
   * red on any change that moves a trajectory - and the pressure that creates is
   * to pick a friendlier seed, which measures nothing. Six seeds with a floor of
   * five still fails loudly on a real regression (a table that stops
   * delivering), and rides out the background lock rate.
   */
  it('finishes a mixed table at 2, 3 and 4 seats', () => {
    for (const seats of [2, 3, 4]) {
      let ended = 0;
      for (let n = 0; n < 6; n++) {
        const seed = `mixed-${seats}-${n}`;
        const result = runGame(data, {
          seed,
          seats,
          suits: SUITS.slice(0, seats),
          policies: assignProfiles(seed, seats),
        });
        if (result.outcome === 'ended') ended += 1;
      }
      expect(ended, `${seats} seats`).toBeGreaterThanOrEqual(5);
    }
  });

  it('never leaves pulse running: every game ends or provably stalls', () => {
    // Ticket 10 expected `pulse` to finish every game. It does not, and the
    // reason is not the Deliver priority: an undirected table drains every
    // deck, discard and hand into buildings and barns, after which no player
    // can draw, build, grow or visit and only `pass` is legal. Measured at
    // 40-60% of mirrored pulse games. The regression this test guards is the
    // one that IS in the bot's gift - `pulse` must never wander to the move
    // ceiling; it either reaches the Level 3 trigger or locks the table.
    for (const seats of [2, 3, 4]) {
      const result = runGame(data, {
        seed: `pulse-${seats}`,
        seats,
        suits: SUITS.slice(0, seats),
        policies: mirror('pulse', seats),
        maxMoves: 4000,
      });
      expect(result.outcome).not.toBe('maxMoves');
      if (result.outcome === 'stalled') {
        // The lock has one signature, and this is it.
        for (const suit of SUITS) {
          expect(result.state.decks[suit].length + result.state.discards[suit].length).toBe(0);
        }
        for (const player of result.state.players) expect(player.hand).toEqual([]);
      }
    }
  });
});

// --- determinism -----------------------------------------------------------

describe('determinism', () => {
  it('reproduces a bit-identical game from (seed, suits, policy assignment)', () => {
    const spec = {
      seed: 'repro',
      seats: 3,
      suits: SUITS.slice(0, 3),
      policies: assignProfiles('repro', 3),
    };
    const a = runGame(data, spec);
    const b = runGame(data, spec);
    expect(JSON.stringify(b.moves)).toBe(JSON.stringify(a.moves));
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it('replays the move log back to the same final state', () => {
    const result = runGame(data, {
      seed: 'replay',
      seats: 2,
      suits: ['wheat', 'orchard'],
      policies: mirror('balanced', 2),
    });
    let replayed = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'replay' });
    for (const move of result.moves) replayed = apply(data, replayed, move).state;
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(result.state));
  });

  it('assigns profiles deterministically from the run seed', () => {
    expect(assignProfiles('x', 4)).toEqual(assignProfiles('x', 4));
    expect(assignProfiles('x', 4)).not.toEqual(assignProfiles('y', 4));
    expect(assignProfiles('x', 3)).toHaveLength(3);
  });

  it('gives each seat its own stream, so mirrored bots still diverge', () => {
    const result = runGame(data, {
      seed: 'streams',
      seats: 2,
      suits: ['wheat', 'orchard'],
      policies: mirror('random', 2),
      maxMoves: 400,
    });
    const bySeat = [0, 1].map((seat) =>
      JSON.stringify(result.moves.filter((m) => m.seat === seat).map((m) => m.type)),
    );
    expect(bySeat[0]).not.toBe(bySeat[1]);
  });
});

// --- the speed budget ------------------------------------------------------

describe('the decision budget', () => {
  it('builds the view exactly once per decision', () => {
    // `viewFor` costs 31us against `apply`'s 18us, so a second call site - or a
    // policy calling it itself - blows the 50us budget on its own.
    let views = 0;
    const counting = (d: typeof data, s: GameState, seat: Seat) => {
      views += 1;
      return viewFor(d, s, seat);
    };
    const result = runGame(
      data,
      {
        seed: 'views',
        seats: 3,
        suits: SUITS.slice(0, 3),
        policies: mirror('balanced', 3),
        maxMoves: 300,
      },
      counting,
    );
    expect(views).toBe(result.decisions);
    expect(result.views).toBe(result.decisions);
  });

  /**
   * The budget was 50us a decision, set in ticket 10 for an evaluator that did
   * arithmetic over a term table and nothing else. Ticket 40's probe cannot fit
   * in it and never could: pricing a move by applying it costs an `apply`, and
   * one `apply` is 18us on its own.
   *
   * So the guard is re-stated against the thing it was protecting - **the cost
   * of a whole game**, which is what a 1,510-game balance run actually pays.
   * Measured before and after, that number did not move: probes added ~35us to
   * a ~144us decision, and indexing the engine's `cardById` (a linear scan of
   * 105 cards, flagged as the cheapest single-core win since ticket 28) paid
   * for it. A 4-seat game runs in ~58ms, against ticket 28's published 12 games
   * a second at 4 seats.
   *
   * A regression here means the rollout has grown a branch, and the levers are
   * `DEPTH` and `BRANCH_CAP` in `outcome.ts`, in that order.
   *
   * **Both budgets are denominated in `apply`s, measured on the machine running
   * the test** (ticket 46 found this red on a laptop at 40% background load,
   * with an unchanged evaluator: the same numbers reproduce with the change
   * reverted, so an absolute millisecond threshold was measuring the machine).
   * The published pair - a 120us decision against an 18us `apply` - is the
   * RATIO this keeps, so a slower machine moves both sides together and only a
   * rollout that actually grew fails.
   *
   * The ratio is not perfectly machine-independent, though, and CI proved it
   * (run #12, 8 Aug 2026: `306us / 38.0us`, i.e. 8.04 against a gate of 8, on a
   * commit that reads 5.9-6.4 locally). The calibration loop replays one move
   * after another over a hot state, and the decision path does not, so slow
   * shared hardware inflates the decision side harder than the `apply` side and
   * the ratio drifts UP. Budget for that drift rather than measuring the
   * runner: see the gate below.
   */
  it('keeps a whole game inside the throughput a balance run is built on', () => {
    const spec = {
      seed: 'speed',
      seats: 4,
      suits: SUITS.slice(0, 4),
      policies: mirror('balanced', 4),
      maxMoves: 600,
    };
    const warm = runGame(data, spec); // the first game pays for compilation
    const started = performance.now();
    const result = runGame(data, spec);
    const wallMs = performance.now() - started;

    // This machine's `apply`, timed by replaying the warm-up game's own moves.
    // Median of five passes: one pass wanders 20-30us on a loaded laptop, and
    // the calibration must be quieter than the thing it is calibrating.
    const passes: number[] = [];
    for (let i = 0; i < 5; i++) {
      let state = newGame(data, { seed: spec.seed, seats: spec.seats, suits: spec.suits });
      const applyStarted = performance.now();
      for (const move of warm.moves) state = apply(data, state, move).state;
      passes.push(((performance.now() - applyStarted) * 1000) / warm.moves.length);
    }
    passes.sort((a, b) => a - b);
    const applyUs = passes[2] as number;

    expect(result.decisions).toBeGreaterThan(200);
    // Ticket 28 measured 12 games a second at 4 seats (83ms) against an 18us
    // apply: a whole game is ~4,600 applies. Measured here at 4,000-4,400, so
    // 8,300 fails on a real regression rather than on a busy machine.
    expect((wallMs * 1000) / applyUs, `whole game, in applies`).toBeLessThan(8300);
    // And the decision cost itself: ticket 40's published pair is a 120us
    // decision against an 18us apply, or 6.7. Live it reads 5.9-6.4, the
    // calibration carries about a tenth either way, and a GitHub runner adds
    // about 25% of CI drift on top (8.04 measured), so the gate is 10. What
    // this is guarding against is a grown rollout branch, and that arrives as
    // a multiple rather than a nudge: the 8,300 above is the tighter guard.
    const perDecision = (result.chooseMs * 1000) / result.decisions;
    expect(
      perDecision / applyUs,
      `${perDecision.toFixed(0)}us / ${applyUs.toFixed(1)}us`,
    ).toBeLessThan(10);
  });
});

// --- taste -----------------------------------------------------------------

describe('the archetypes', () => {
  it('gives the hermit control real teeth: it never visits', () => {
    // A hermit mirror SHOULD fail watch-list assertion 8 and mint nothing. If
    // this bot ever visits, the assertion has no control and the run that
    // "passes" it proves nothing.
    for (const seats of [2, 3]) {
      const result = runGame(data, {
        seed: `hermit-${seats}`,
        seats,
        suits: ['wheat', 'orchard', 'apiary'].slice(0, seats) as Suit[],
        policies: mirror('hermit', seats),
        maxMoves: 1500,
      });
      expect(result.moves.filter((m) => m.type === 'visit')).toEqual([]);
    }
  });

  /**
   * Ticket 45. `growSpend` was signed so the bot paid a GROW with the card it
   * valued MOST, against its own comment and against both correctly-signed
   * siblings. The sign alone is not the claim worth guarding - the claim is the
   * behaviour, so walk real games and check every GROW the bot actually took.
   *
   * This is not merely an ordering preference. `handSpend` charges by COUNT
   * (`cardsLeavingHand` returns a flat 1 for a grow), so `growSpend` is the only
   * term reading which card pays, and it therefore moves the argmax of the whole
   * grow family: the bug scored the best grow at `base + 0.3 x max(cardValue)`
   * rather than `base - 0.3 x min(cardValue)`, manufacturing GROW traffic
   * (measured: 8.9 activations a game against a true 6.9).
   */
  it('pays a GROW with the junkiest legal card, not the most valuable', () => {
    let checked = 0;
    let ties = 0;

    // Widened from six runs to nine on 2026-08-08. The wild substitution makes
    // more deliveries affordable, so the same seeds now spend more moves on
    // Deliver and fewer on Grow, and the sample fell under the adequacy guard
    // below. The guard is what makes this test mean anything, so the sample
    // moved rather than the bar.
    // `n` is a slice offset into SUITS, so it is bounded by 5 - seats: the extra
    // runs are the ones that leaves available.
    const runs: [number, number][] = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [3, 0],
      [3, 1],
      [3, 2],
      [4, 0],
      [4, 1],
    ];
    for (const [seats, n] of runs) {
      const seed = `growspend-${seats}-${n}`;
      const result = runGame(data, {
        seed,
        seats,
        suits: SUITS.slice(n, n + seats),
        policies: assignProfiles(seed, seats),
        maxMoves: 1500,
      });

      // Replay so each GROW can be judged against the alternatives it had.
      let state = newGame(data, { seed, seats, suits: SUITS.slice(n, n + seats) });
      for (const move of result.moves) {
        if (move.type === 'grow') {
          const alternatives = legalMoves(data, state).filter(
            (m): m is Extract<Move, { type: 'grow' }> =>
              m.type === 'grow' && m.seat === move.seat && m.building === move.building,
          );
          const cheapest = Math.min(...alternatives.map((m) => cardValue(data, m.payment)));
          const chosen = cardValue(data, move.payment);
          // `cardValue`'s tail key makes exact ties near-impossible, so an
          // equality here is the junkiest card, not a coincidence.
          expect(chosen, `${move.building} paid with ${move.payment}`).toBeCloseTo(cheapest, 9);
          if (alternatives.length === 1) ties += 1;
          checked += 1;
        }
        state = apply(data, state, move).state;
      }
    }

    // The check is worthless if most GROWs had only one legal payment.
    expect(checked).toBeGreaterThan(30);
    expect(ties).toBeLessThan(checked);
  });

  /**
   * Ticket 47. `buildSpend` read `-(payment.length + coinWild)`, and the engine
   * holds `payment.length + barn + coinWild === cardsNeeded` - so for one built
   * card that sum is a CONSTANT and the term could not order a build's payments
   * at all. Measured over 262 real builds it separated the alternatives twice,
   * both on D8's barn leg, while 23.7% of builds had a real choice of which
   * cards to burn. The pick was the evaluator's random tie-break.
   *
   * The claim guarded here is the behaviour, not the sign: given HOW it is
   * paying (same barn and coin legs), a build spends the junkiest cards it can.
   * Comparing across payment methods would be a different assertion - a barn or
   * coin payment is cheaper in hand cards by construction, and `barnSpend` and
   * `coinGain` are what price that trade.
   */
  it('pays a build with the junkiest legal cards, not the most valuable', () => {
    let checked = 0;

    const runs: [number, number][] = [];
    for (const seats of [2, 3, 4]) for (let n = 0; n < 5; n++) runs.push([seats, n]);
    for (const [seats, n] of runs) {
      const seed = `buildspend-${seats}-${n}`;
      const suits = Array.from({ length: seats }, (_, i) => SUITS[(n + i) % 5] as Suit);
      const result = runGame(data, {
        seed,
        seats,
        suits,
        policies: assignProfiles(seed, seats),
        maxMoves: 1500,
      });

      let state = newGame(data, { seed, seats, suits });
      for (const move of result.moves) {
        const chosen = buildAct(move);
        if (chosen) {
          const alternatives = legalMoves(data, state)
            .map((m) => (m.seat === move.seat ? buildAct(m) : null))
            .filter((a): a is BuildAct => a !== null && sameMethod(a, chosen));
          const cheapest = Math.min(...alternatives.map((a) => totalValue(data, a.payment)));
          const paid = totalValue(data, chosen.payment);
          expect(paid, `${chosen.card} paid with ${chosen.payment.join(', ')}`).toBeCloseTo(
            cheapest,
            9,
          );
          if (alternatives.length > 1) checked += 1;
        }
        state = apply(data, state, move).state;
      }
    }

    // Worthless unless builds really did have a choice of payment.
    expect(checked).toBeGreaterThan(30);
  });

  /**
   * Ticket 48's sign convention, asserted where it actually bites: the PRODUCT.
   *
   * `roster.test.ts` holds the weights positive; this holds the features
   * negative, over real positions rather than by reading the code. Together they
   * are the thing that was missing when `growSpend`, `buildSpend` and
   * `deliverCost` were each written as a negative weight against a negated
   * feature - three terms that paid the bot for spending more, none of which
   * looks wrong at its own call site.
   *
   * `explain` is used rather than the term functions directly because it returns
   * exactly what the scorer added up, so a term that is inverted only in the
   * profile's override is caught as well.
   */
  it('never lets a cost term pay a bot for spending', () => {
    const costTerms = new Set(TERMS.filter((term) => term.cost).map((term) => term.name));
    let checked = 0;
    let seen = 0;

    for (const id of ['balanced', 'racer', 'socialite'] as PolicyId[]) {
      const seed = `costsign-${id}`;
      const policy = makePolicy(id);
      let state = newGame(data, { seed, seats: 3, suits: SUITS.slice(0, 3) });
      const result = runGame(data, {
        seed,
        seats: 3,
        suits: SUITS.slice(0, 3),
        policies: mirror(id, 3),
        maxMoves: 400,
      });
      for (const move of result.moves) {
        const seat = state.turnPlayer;
        const rows = policy.explain?.({
          data,
          view: viewFor(data, state, seat),
          moves: legalMoves(data, state).filter((m) => m.seat === seat),
          rng: policyRng(seed, seat, id),
          probe: makeProber(data, state, seat),
        });
        for (const row of rows ?? []) {
          for (const [name, value] of Object.entries(row.terms)) {
            if (!costTerms.has(name)) continue;
            seen += 1;
            expect(value, `${id}: ${name} on ${JSON.stringify(row.move)}`).toBeLessThanOrEqual(0);
          }
        }
        checked += 1;
        state = apply(data, state, move).state;
      }
    }

    // Vacuous unless the cost terms really fired.
    expect(checked).toBeGreaterThan(200);
    expect(seen).toBeGreaterThan(500);
  });

  it('makes the socialite visit far more than the balanced reference', () => {
    const visits = (id: PolicyId) => {
      const result = runGame(data, {
        seed: `taste-${id}`,
        seats: 3,
        suits: SUITS.slice(0, 3),
        policies: mirror(id, 3),
        maxMoves: 1500,
      });
      return result.moves.filter((m) => m.type === 'visit').length / result.moves.length;
    };
    expect(visits('socialite')).toBeGreaterThan(visits('balanced'));
  });
});

// --- explain ---------------------------------------------------------------

describe('explain', () => {
  it('breaks a decision down into terms that sum to its total', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'explain' });
    const moves = legalMoves(data, state);
    const view = viewFor(data, state, state.turnPlayer);
    const policy = makePolicy('balanced');
    const probe = makeProber(data, state, state.turnPlayer);
    const rows = policy.explain?.({
      data,
      view,
      moves,
      rng: policyRng('explain', 0, 'balanced'),
      probe,
    });
    expect(rows).toBeDefined();
    expect(rows).toHaveLength(moves.length);
    for (const row of rows ?? []) {
      const summed = Object.values(row.terms).reduce((a, b) => a + b, 0);
      expect(summed).toBeCloseTo(row.total, 9);
    }
    // Best first, and the chosen move is one of the best.
    const best = (rows ?? [])[0];
    const chosen = policy.choose({
      data,
      view,
      moves,
      rng: policyRng('explain', 0, 'balanced'),
      probe: makeProber(data, state, state.turnPlayer),
    });
    const chosenRow = (rows ?? []).find((r) => JSON.stringify(r.move) === JSON.stringify(chosen));
    expect(chosenRow?.total).toBeCloseTo(best?.total ?? 0, 9);
  });
});
