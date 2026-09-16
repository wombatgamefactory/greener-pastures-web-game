/**
 * THE BOTS UNDER THE NOTICE-BOARD VISIT (S1-S16,
 * `docs/notice-board-visit-handoff-2026-09-10-v2.md`, 11/09/2026), and under
 * the v31 control the arm must not have moved.
 *
 * ⚠️ **THIS FILE WALKS WHOLE GAMES, WHICH THE REST OF THIS PACKAGE'S TESTS
 * DELIBERATELY DO NOT.** The arm reuses the v31 `visit` move,
 * so almost every term in `terms.ts` fires for it WITHOUT ANY CHANGE - and a
 * claim that something already works is worth nothing until something has run
 * it. The loop below is a minimal copy of @gp/sim's `runGame`.
 *
 * ⛔ Nothing here may name the engine's truth type, and nothing does.
 *
 * ⚠️ **THE ARM IS RESTATED INLINE RATHER THAN READ OFF ITS OVERLAY**, because
 * this package is
 * platform-free and may not do file I/O. That makes it a COPY OF A PIN, which
 * this project has learned stops being a pin the moment a default moves under
 * it - so it sets only the leaves these cases actually depend on and names them,
 * and `overlays.test.ts` in @gp/sim is what validates the real overlay.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { Move } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { scoredPolicy } from './evaluator.js';
import { makePolicy, policyRng } from './roster.js';
import { cardById, makeScratch, thresholdOfView } from './scratch.js';
import type { PolicyId } from './roster.js';
import type { ExplainedMove } from './types.js';

/** The arm: the five leaves these cases depend on, out of the overlay's fourteen. */
const ARM: GameData = loadGameData({
  name: 'notice-board-visit-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': true,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
    'island.tokens.workerOnVp': [],
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

/** S8's paired control: the board clogs again, so both 6-point terms come back. */
const BLOCKING: GameData = loadGameData({
  name: 'notice-board-visit-blocking-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': true,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': true,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ TOKEN ISLAND PINNED 16/09/2026: this game had no island meeple.
    'island.tokens.workerOnVp': [],
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

/** The v31 card visit, which is what this arm's self-visit share is read against. */
const V31: GameData = loadGameData({
  name: 'v31-card-visit-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'card',
    'rules.turn.bonusTiming': 'end',
    'rules.turn.selfVisitAllowed': true,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
    'rules.turn.startingMeeplesPerColour': 1,
    'rules.economy.noticeBoardThreshold': 2,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

const TABLE: Record<number, Suit[]> = {
  2: ['wheat', 'vegetable'],
  3: ['wheat', 'vegetable', 'orchard'],
  4: ['wheat', 'vegetable', 'orchard', 'apiary'],
};

const MIXED: PolicyId[] = ['balanced', 'socialite', 'loyalist', 'racer'];

interface Walk {
  readonly moves: readonly Move[];
  readonly ended: boolean;
  readonly crash: string | null;
  /**
   * The term breakdown at the FIRST decision that offered both a self-visit and
   * a visit to a rival. That is the only position in which `hostGift`'s
   * asymmetry can be read off one decision rather than compared across two.
   */
  readonly bothOnOffer: ExplainedMove[] | null;
}

function walk(
  data: GameData,
  spec: { seats: number; seed: string; policies: readonly PolicyId[]; maxMoves?: number },
): Walk {
  const policies = spec.policies.map((id) => makePolicy(id));
  const rngs = policies.map((policy, seat) => policyRng(spec.seed, seat, policy.id));
  const maxMoves = spec.maxMoves ?? 6000;
  const idleLimit = spec.seats * 4;

  let state = newGame(data, {
    seats: spec.seats,
    suits: TABLE[spec.seats] as Suit[],
    seed: spec.seed,
  });
  const moves: Move[] = [];
  let idle = 0;
  let crash: string | null = null;
  let bothOnOffer: ExplainedMove[] | null = null;

  try {
    while (!isOver(state) && moves.length < maxMoves && idle < idleLimit) {
      const legal = legalMoves(data, state);
      if (legal.length === 0) throw new Error('No legal moves and the game is not over');
      const seat = (legal[0] as Move).seat;
      const policy = policies[seat];
      const rng = rngs[seat];
      if (!policy || !rng) throw new Error(`No policy for seat ${seat}`);
      const ctx = {
        data,
        view: viewFor(data, state, seat),
        moves: legal,
        rng,
        probe: makeProber(data, state, seat),
      };
      const visits = legal.filter((m) => m.type === 'visit');
      if (
        bothOnOffer === null &&
        visits.some((m) => m.host === m.seat) &&
        visits.some((m) => m.host !== m.seat)
      ) {
        // `explain` is deliberately un-narrowed, so every visit on offer is in
        // the list - which is what lets one decision carry both halves.
        bothOnOffer = scoredPolicy('balanced').explain?.(ctx) ?? null;
      }
      const move = policy.choose(ctx);
      state = apply(data, state, move).state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    crash = error instanceof Error ? error.message : String(error);
  }

  return { moves, ended: isOver(state), crash, bothOnOffer };
}

function visitsIn(moves: readonly Move[]) {
  const visits = moves.filter((m) => m.type === 'visit');
  return {
    all: visits.length,
    self: visits.filter((m) => m.host === m.seat).length,
    rival: visits.filter((m) => m.host !== m.seat).length,
  };
}

describe('the notice-board visit, the arm', () => {
  // ⭐ THE READING THAT WOULD HAVE MADE EVERY OTHER NUMBER MEANINGLESS. The
  // visit is the whole of the bonus slot under this arm (S5), so a bot that
  // never takes one is a bot playing a strictly smaller game, and the pass's
  // headline is the bonus rate against Dean's 30-60% band. BOTH halves have to
  // appear: S6 rules self-use in and the self-visit share is the headline risk,
  // so a run in which one of the two never happens is measuring the instrument.
  for (const seats of [2, 3, 4]) {
    it(`takes both self and rival visits, and the game still ends at ${seats} seats`, () => {
      const walked = walk(ARM, {
        seats,
        seed: `notice-board-${seats}`,
        policies: MIXED.slice(0, seats),
      });
      expect(walked.crash).toBeNull();
      expect(walked.ended).toBe(true);
      const visits = visitsIn(walked.moves);
      expect(visits.self).toBeGreaterThan(0);
      expect(visits.rival).toBeGreaterThan(0);
      // There are no meeples (S14), so a stray move of either of these types
      // would mean a mode gate leaked.
      expect(walked.moves.filter((m) => m.type === 'spendMeeple')).toHaveLength(0);
      expect(walked.moves.filter((m) => m.type === 'collect')).toHaveLength(0);
    });
  }

  // ⛔ THE LEDGER'S C64, ASSERTED IN ONE DECISION. `hostGift` is the first term
  // in this package that prices something a RIVAL gets, and the whole of its
  // shape is that it charges a visit to somebody else and not a visit to
  // yourself. Read off one position rather than two so nothing else can differ.
  it('charges hostGift on a rival visit and never on a self-visit', () => {
    const walked = walk(ARM, { seats: 3, seed: 'host-gift', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    const explained = walked.bothOnOffer;
    expect(explained).not.toBeNull();
    const visits = (explained as ExplainedMove[]).filter((e) => e.move.type === 'visit');
    const self = visits.filter((e) => e.move.type === 'visit' && e.move.host === e.move.seat);
    const rival = visits.filter((e) => e.move.type === 'visit' && e.move.host !== e.move.seat);
    expect(self.length).toBeGreaterThan(0);
    expect(rival.length).toBeGreaterThan(0);
    // `explain` omits zero contributions, so "absent" IS "scored nothing".
    for (const e of self) expect(e.terms['hostGift']).toBeUndefined();
    for (const e of rival) expect(e.terms['hostGift']).toBeLessThan(0);
  });

  // ⛔ S8: three is a MINIMUM and never a maximum, so nothing clogs and there is
  // no door to reopen. Both of these weights are 6, the largest cost in the
  // table, and left firing they would have decided the two readings the pass is
  // for - the self-visit share and a20's stall rate.
  it('never scores clogOwnBoard or unclogBoard while the board cannot clog', () => {
    const walked = walk(ARM, { seats: 3, seed: 'no-clog', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    const explained = walked.bothOnOffer as ExplainedMove[];
    for (const e of explained) {
      expect(e.terms['clogOwnBoard']).toBeUndefined();
      expect(e.terms['unclogBoard']).toBeUndefined();
    }
  });

  // The property every balance number rests on: a seed is a game.
  it('replays a seed move for move', () => {
    const spec = { seats: 3, seed: 'same-seed', policies: MIXED.slice(0, 3) };
    const first = walk(ARM, spec);
    expect(first.crash).toBeNull();
    expect(walk(ARM, spec).moves).toEqual(first.moves);
  });

  // S8's paired control has to actually differ, or `-blocking-v1` measures one
  // game twice. The board clogs at 3 again, so the two guarded terms come back.
  it('brings both 6-point terms back under noticeBoardBlocks', () => {
    const walked = walk(BLOCKING, { seats: 3, seed: 'blocking', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    expect(walked.ended).toBe(true);
    expect(visitsIn(walked.moves).all).toBeGreaterThan(0);
    const board = ARM.cards.catalogue.find((c) => c.slot === 'noticeboard');
    expect(board).toBeDefined();
    // The threshold the BOTS read has to be the one the engine enforces, which
    // is the `noticeBoardThreshold` override and never the printed number.
    // ⚠️ Since the v42 extract (16/09/2026) the sheet PRINTS 3 (`3+`), where the
    // v33 sheet printed 2, so the arm's override and the print now agree and
    // only the v31 control (override 2) still tells the two readings apart.
    expect(thresholdOfView(BLOCKING, { card: (board as { id: string }).id, stack: [] })).toBe(3);
    expect(thresholdOfView(V31, { card: (board as { id: string }).id, stack: [] })).toBe(2);
    expect(cardById(ARM, (board as { id: string }).id).threshold).toBe(3);
  });
});

describe('the v31 control, which this arm is read against', () => {
  // ⛔ A CONTROL THAT MOVES IS NOT A CONTROL. The v31 visit ALSO puts a card on
  // a neighbour's board that the neighbour harvests, so `hostGift` has a real
  // subject there and is shut anyway - see its entry in `terms.ts`. This is the
  // case that would fail the day somebody widens the gate by accident.
  it('never scores hostGift', () => {
    const walked = walk(V31, { seats: 3, seed: 'v31-control', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    expect(visitsIn(walked.moves).all).toBeGreaterThan(0);
    const explained = walked.bothOnOffer;
    expect(explained).not.toBeNull();
    for (const e of explained as ExplainedMove[]) {
      expect(e.terms['hostGift']).toBeUndefined();
    }
  });

  // And the mode flag itself, read the way every gated term reads it.
  it('leaves the notice board able to clog', () => {
    const state = newGame(V31, { seats: 2, suits: TABLE[2] as Suit[], seed: 'flags' });
    const scratch = makeScratch(V31, viewFor(V31, state, 0));
    expect(scratch.noticeBoardArm).toBe(false);
    expect(scratch.noticeBoardClogs).toBe(true);
    const armState = newGame(ARM, { seats: 2, suits: TABLE[2] as Suit[], seed: 'flags' });
    const armScratch = makeScratch(ARM, viewFor(ARM, armState, 0));
    expect(armScratch.noticeBoardArm).toBe(true);
    expect(armScratch.noticeBoardClogs).toBe(false);
  });
});
