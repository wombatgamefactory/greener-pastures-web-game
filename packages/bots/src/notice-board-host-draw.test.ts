/**
 * ⭐ **THE BOTS UNDER S17, THE HOST DRAW** (Dean, ruled 11/09/2026,
 * `rules.turn.hostDrawOnVisit`,
 * `overlays/notice-board-visit-host-draw-v1.overlay.json`): **when a neighbour
 * visits you, you draw a card**, immediately, off a deck.
 *
 * ⛔ **IT AMENDS S7, AND THAT AMENDMENT IS THE WHOLE OF WHAT THIS FILE
 * ASSERTS.** S7 said the fee resting on the host's Notice Board was the payment
 * "and there is no other". There is now one other and it is paid instantly, so
 * **the host is paid twice** - once in a card drawn now, once in material they
 * must still harvest and then deliver - and `hostGift` is the one term in this
 * package that prices what a move hands somebody else. It rose from 1.5 to 2.7
 * on 11/09/2026, measured, and the derivation is at its entry in `weights.ts`.
 *
 * ⛔ **THE CASE THAT MATTERS MOST IS THE CONTROL ONE.** The arm and its paired
 * control (`overlays/notice-board-visit-two-boards-v1.overlay.json`) differ in
 * exactly one leaf, so a weight that rose for BOTH would charge the control's
 * visitor 2.7 for handing over 1.5 - and every notice-board number taken before
 * today would silently move. The weight is the whole S17 payment and the term
 * scales it back to the fee half when the rule is off; these cases are what
 * hold the two apart.
 *
 * ⚠️ **THE ARM IS RESTATED INLINE RATHER THAN READ OFF ITS OVERLAY**, on the
 * same grounds as `notice-board.test.ts` and `notice-board-two-boards.test.ts`:
 * this package is platform-free and may not do file I/O, so this is A COPY OF A
 * PIN, it sets only the leaves these cases depend on, and `overlays.test.ts` in
 * @gp/sim is what validates the real overlay.
 *
 * ⚠️ **WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, BECAUSE IT IS AN ENGINE
 * DEFECT AND NOT A BOTS ONE (11/09/2026).** The engine pushes the host's draw
 * TASK at the head of the queue, before the visitor's power resolves, so
 * `probe.next` comes back empty for the probing seat and the rollout is cut
 * before the power it just bought is walked. Measured at two seats: 99.6% of
 * visit probes stop dead under the arm against 0.0% under the control, which
 * costs `outcome` almost the whole of a visit's payoff and stops `bonusAction`
 * firing at all. Nothing in @gp/bots can step past another seat's task, so an
 * assertion here would pin a defect rather than a contract. It is written up at
 * `pendingDrawValue` in `outcome.ts` and reported to the engine instead.
 *
 * ⛔ Nothing here may name the engine's truth type, and nothing does.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { Move } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { scoredPolicy } from './evaluator.js';
import { makePolicy, policyRng } from './roster.js';
import { HOST_GIFT_TOTAL } from './terms.js';
import { BALANCED, weightsFor } from './weights.js';
import type { PolicyId } from './roster.js';
import type { ExplainedMove } from './types.js';

/**
 * The arm: the leaves these cases depend on, out of the overlay's nineteen.
 * `selfVisitAllowed` is FALSE because that is the corner S17 is measured in,
 * and it is also what keeps the rule honest - a card drawn for visiting
 * yourself is a faucet paid by nobody, so the engine never pays it.
 */
const ARM: GameData = loadGameData({
  name: 'notice-board-host-draw-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'aerodrome.moveCost.barnCards': 2,
    'aerodrome.alwaysInPlay': false,
    'aerodrome.flightMints': false,
    'aerodrome.balloons.balloonDraw.reward.type': 'draw',
    'aerodrome.balloons.balloonDraw.reward.amount': 4,
    'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
    'aerodrome.balloons.balloonBuild.reward.amount': 4,
    'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
    'aerodrome.balloons.balloonSow.reward.amount': 4,
    'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
    'rules.economy.storeCoinsPerCard': 0,
    'rules.economy.coinSupplyPerPlayer': 0,
    'rules.economy.coinPaysBuild': false,
    'rules.economy.coinPaysSuitCost': false,
    'rules.economy.coinPaysGrow': false,
    'rules.economy.coinGrowOnFullBuilding': false,
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': false,
    'rules.turn.hostDrawOnVisit': 1,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    'rules.economy.noticeBoardsBySeats.2': 2,
    'rules.economy.noticeBoardsBySeats.3': 1,
    'rules.economy.noticeBoardsBySeats.4': 1,
  },
});

/** The paired control: the same design, one leaf apart, the host paid once. */
const CONTROL: GameData = loadGameData({
  name: 'notice-board-two-boards-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'aerodrome.moveCost.barnCards': 2,
    'aerodrome.alwaysInPlay': false,
    'aerodrome.flightMints': false,
    'aerodrome.balloons.balloonDraw.reward.type': 'draw',
    'aerodrome.balloons.balloonDraw.reward.amount': 4,
    'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
    'aerodrome.balloons.balloonBuild.reward.amount': 4,
    'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
    'aerodrome.balloons.balloonSow.reward.amount': 4,
    'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
    'rules.economy.storeCoinsPerCard': 0,
    'rules.economy.coinSupplyPerPlayer': 0,
    'rules.economy.coinPaysBuild': false,
    'rules.economy.coinPaysSuitCost': false,
    'rules.economy.coinPaysGrow': false,
    'rules.economy.coinGrowOnFullBuilding': false,
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': false,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    'rules.economy.noticeBoardsBySeats.2': 2,
    'rules.economy.noticeBoardsBySeats.3': 1,
    'rules.economy.noticeBoardsBySeats.4': 1,
  },
});

/** The v31 card visit, where this whole term is shut and must stay at zero. */
const CARD_VISIT: GameData = loadGameData({
  name: 'card-visit-control-test',
  schemaVersion: 1,
  set: { 'rules.turn.visitCurrency': 'card', 'rules.turn.selfVisitAllowed': true },
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
  /** The `balanced` breakdown at the FIRST decision that offered a rival visit. */
  readonly firstVisit: ExplainedMove[] | null;
  /** Every card handed to a host by the rule, with the seat it went to. */
  readonly hostDraws: { seat: number; cards: number }[];
  /**
   * One row per visit to a rival: who paid, who was visited, and **whose
   * decision the engine handed back**. The rule pushes the host's draw as an
   * ordinary task, so the seat that moves next IS the orientation.
   */
  readonly afterVisit: {
    visitor: number;
    host: number;
    next: number | null;
    drawPid: number | null;
  }[];
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
  const hostDraws: { seat: number; cards: number }[] = [];
  const afterVisit: {
    visitor: number;
    host: number;
    next: number | null;
    drawPid: number | null;
  }[] = [];
  let idle = 0;
  let crash: string | null = null;
  let firstVisit: ExplainedMove[] | null = null;

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
      if (firstVisit === null && legal.some((m) => m.type === 'visit' && m.host !== m.seat)) {
        // `explain` is deliberately un-narrowed, so every visit on offer is in
        // the list rather than one representative of each class.
        firstVisit = scoredPolicy('balanced').explain?.(ctx) ?? null;
      }
      const move = policy.choose(ctx);
      const out = apply(data, state, move);
      for (const e of out.events) {
        if (e.e === 'cardsToHand' && e.via === 'hostDraw') {
          hostDraws.push({ seat: e.seat, cards: e.cards.length });
        }
      }
      if (move.type === 'visit' && move.host !== move.seat) {
        // Read BEFORE anything else moves: the head task is whatever the visit
        // pushed, and whose it is is the whole of S17's orientation.
        const next = isOver(out.state) ? null : (legalMoves(data, out.state)[0]?.seat ?? null);
        // ⛔ WHERE THE ORIENTATION ACTUALLY LIVES. The rule's cards do not
        // arrive during this apply: the visit PUSHES a draw task and the host
        // answers it on their own decision later, at which point the event's
        // seat and the mover are the same seat and prove nothing. The task's
        // `pid`, read here, is the only bots-side witness to who was paid.
        const pushed = out.state.tasks.find((t) => t.t === 'draw' && t.via === 'hostDraw');
        afterVisit.push({
          visitor: move.seat,
          host: move.host,
          next,
          drawPid: pushed?.t === 'draw' ? pushed.pid : null,
        });
      }
      state = out.state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    crash = error instanceof Error ? error.message : String(error);
  }

  return { moves, ended: isOver(state), crash, firstVisit, hostDraws, afterVisit };
}

function giftsIn(explained: ExplainedMove[] | null): number[] {
  const rows = (explained ?? []).filter((e) => e.move.type === 'visit');
  // `explain` omits a zero contribution, so an absent `hostGift` is a charge of
  // nothing and has to read as 0 rather than as a missing row.
  return rows.map((row) => row.terms['hostGift'] ?? 0);
}

describe('S17, the host draw, as the bots price it', () => {
  // ⛔ THE PIN, AND THE REASON IT IS A TEST RATHER THAN A COMMENT. The weight is
  // the WHOLE S17 payment and the term divides it back down by the fee half, so
  // a hand-edit of either number alone would reprice both arms at once and in
  // opposite directions. One assertion closes that door.
  it('carries hostGift as the sum of its two measured halves', () => {
    expect(BALANCED['hostGift']).toBe(HOST_GIFT_TOTAL);
    expect(HOST_GIFT_TOTAL).toBeCloseTo(2.7, 10);
    // No profile overrides it: the charge is a rules price, not a taste, and a
    // socialite has no more reason than anybody else to be wrong about what a
    // rival was handed.
    for (const id of MIXED) expect(weightsFor(id)['hostGift']).toBe(HOST_GIFT_TOTAL);
  });

  // ⭐ THE AMENDMENT ITSELF, READ OFF ONE DECISION IN EACH RULESET. The two
  // games are identical up to the first visit - the rule cannot have fired yet,
  // because nobody has visited - so the same seed reaches the same position and
  // the only thing that may differ in the books is what that visit hands over.
  it('charges the whole payment under the rule and the fee half without it', () => {
    const spec = { seats: 3, seed: 'host-draw-gift', policies: MIXED.slice(0, 3) };
    const arm = walk(ARM, spec);
    const control = walk(CONTROL, spec);
    expect(arm.crash).toBeNull();
    expect(control.crash).toBeNull();

    const armGifts = giftsIn(arm.firstVisit);
    const controlGifts = giftsIn(control.firstVisit);
    expect(armGifts.length).toBeGreaterThan(0);
    expect(armGifts.length).toBe(controlGifts.length);
    for (const gift of armGifts) expect(gift).toBeCloseTo(-2.7, 10);
    for (const gift of controlGifts) expect(gift).toBeCloseTo(-1.5, 10);
    // ⛔ AND THE RATIO, WHICH IS THE CLAIM STATED AS ONE NUMBER: a visit under
    // S17 hands a host 1.8 times what the same visit hands them without it.
    // A test on the two levels alone would pass if both were wrong by the same
    // factor.
    for (let i = 0; i < armGifts.length; i++) {
      expect((armGifts[i] as number) / (controlGifts[i] as number)).toBeCloseTo(1.8, 10);
    }
  });

  // ⛔ THE ORIENTATION, WHICH IS THE ONE BUG THIS RULE CAN HAVE: the visitor is
  // paid in the POWER and the host in the CARD. Asserted bots-side as well as
  // engine-side because it is the premise the whole charge rests on - a draw
  // that reached the VISITOR would make `hostGift` a charge for a gift to
  // oneself, and no term in this package would notice.
  it('never pays the draw to the seat that moved, and never on a self-visit', () => {
    const walked = walk(ARM, { seats: 3, seed: 'orientation', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    expect(walked.ended).toBe(true);
    expect(walked.hostDraws.length).toBeGreaterThan(0);
    expect(walked.afterVisit.length).toBeGreaterThan(0);
    for (const row of walked.afterVisit) {
      // ⛔ THE VISIT IS ORIENTED HOST-WARD, and it is asserted on the DRAW
      // rather than on whose decision comes next. 11/09/2026: the engine now
      // queues the visitor's bought power AHEAD of the host's S17 draw, so
      // that a visit's rollout can see what it bought - before that fix 94.1%
      // of visit probes at two seats were cut dead and the bots priced a visit
      // at nothing. "Whose decision comes back" was only ever a PROXY for the
      // orientation and the fix deliberately inverts it; the orientation
      // itself is unchanged and is asserted on `hostDraws` below.
      expect(row.visitor).not.toBe(row.host);
      // ⛔ THE ORIENTATION ITSELF: the task the visit pushed belongs to the
      // HOST and never to the payer. A draw that reached the visitor would
      // make `hostGift` a charge for a gift to oneself, and no term in this
      // package would notice.
      expect(row.drawPid).toBe(row.host);
      expect(row.drawPid).not.toBe(row.visitor);
    }
    for (const draw of walked.hostDraws) {
      // The knob is 1, and `baseDraw` is see 2 / keep 2 - a host handed two
      // cards would be the engine reading the wrong draw-sized number. W17 The
      // Pie Shop stacks with the rule but is a SECOND task and a second event,
      // so it never widens this one.
      expect(draw.cards).toBe(1);
    }
    // Self-visiting is banned on the arm, so the rule can never meet a
    // self-visit at all; this is the ban doing that work.
    expect(walked.moves.filter((m) => m.type === 'visit' && m.host === m.seat)).toHaveLength(0);
  });

  // The game still has to finish, at every seat count, with a faucet running.
  for (const seats of [2, 3, 4]) {
    it(`still ends at ${seats} seats with the rule on`, () => {
      const walked = walk(ARM, {
        seats,
        seed: `host-draw-${seats}`,
        policies: MIXED.slice(0, seats),
      });
      expect(walked.crash).toBeNull();
      expect(walked.ended).toBe(true);
      expect(walked.hostDraws.length).toBeGreaterThan(0);
    });
  }

  // The property every balance number rests on: a seed is a game.
  it('replays a seed move for move', () => {
    const spec = { seats: 3, seed: 'host-draw-replay', policies: MIXED.slice(0, 3) };
    const first = walk(ARM, spec);
    expect(first.crash).toBeNull();
    expect(walk(ARM, spec).moves).toEqual(first.moves);
  });

  // ⛔ AND THE TERM IS STILL STRUCTURALLY ZERO WHERE IT ALWAYS WAS. S17 widened
  // what the charge covers; it did not widen where the charge applies, and the
  // v31 card visit is outside the notice-board family.
  it('stays silent under the v31 card visit', () => {
    const walked = walk(CARD_VISIT, {
      seats: 3,
      seed: 'card-visit-control',
      policies: MIXED.slice(0, 3),
    });
    expect(walked.crash).toBeNull();
    expect(walked.moves.filter((m) => m.type === 'visit').length).toBeGreaterThan(0);
    expect(walked.hostDraws).toHaveLength(0);
    for (const row of walked.firstVisit ?? []) expect(row.terms['hostGift']).toBeUndefined();
  });
});
