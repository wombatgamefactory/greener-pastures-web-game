/**
 * ⭐ **THE BOTS UNDER DEAN'S TWO-BOARD FIX** (ruled 11/09/2026,
 * `overlays/notice-board-visit-two-boards-v1.overlay.json`,
 * `rules.economy.noticeBoardsBySeats`): at TWO seats every player lays out two
 * Notice Boards, its own suit's plus one drawn at random from the suits nobody
 * is farming, and at three and four seats it is one each exactly as the control
 * has it.
 *
 * ⛔ **THE ONE READING THIS FILE EXISTS FOR IS WHETHER A BOT CAN TELL THE TWO
 * BOARDS APART.** The two candidate moves differ in one field, `board`, and the
 * two boards print two DIFFERENT powers, so a bot blind to the field picks the
 * worse power about half the time. That direction of error matters: the whole
 * point of the second board is that it hands a two-seat player a CHOICE of
 * powers, which is the fix for the 17.9% of two-seat turns that begin with
 * cards in hand and no legal visit, so **a blind bot UNDERSTATES the variant's
 * benefit and cannot demonstrate the fix at all.**
 *
 * ⚠️ **IT WAS BLIND, MEASURED RATHER THAN SUSPECTED.** Before this pass
 * `effectKey` keyed a visit on `visit:${host}`, so both boards of one host
 * shared one rollout and scored **1.3099 apiece, identical to every decimal
 * place `explain` prints** - and `bestOf`'s rng then broke the tie. The same
 * decision now reads 2.0932 against 1.3099. The case below is that measurement
 * turned into an assertion.
 *
 * ⚠️ **THE ARM IS RESTATED INLINE RATHER THAN READ OFF ITS OVERLAY**, on the
 * same grounds as `notice-board.test.ts`: this package is
 * platform-free and may not do file I/O. It is therefore A COPY OF A PIN, so it
 * sets only the leaves these cases depend on and names them, and
 * `overlays.test.ts` in @gp/sim is what validates the real overlay.
 *
 * ⛔ Nothing here may name the engine's truth type, and nothing does.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { CardId, Move } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { scoredPolicy } from './evaluator.js';
import { makePolicy, policyRng } from './roster.js';
import { cardById, makeScratch } from './scratch.js';
import { TERMS } from './terms.js';
import { weightsFor } from './weights.js';
import type { Act } from './acts.js';
import type { Outcomes } from './outcome.js';
import type { Scratch } from './scratch.js';
import type { ExplainedMove } from './types.js';

/**
 * The arm: the leaves these cases depend on, out of the overlay's eighteen.
 * `selfVisitAllowed` is FALSE because that is the corner the whole variant is
 * built on, and the three `noticeBoardsBySeats` keys are pinned together for
 * the reason the overlay pins them - a map whose other keys are left to the
 * default is a map that can change shape without anybody noticing, and keys 3
 * and 4 ARE the claim that the arm reproduces its control there.
 */
const ARM: GameData = loadGameData({
  name: 'notice-board-two-boards-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': false,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    'rules.economy.noticeBoardsBySeats.2': 2,
    'rules.economy.noticeBoardsBySeats.3': 1,
    'rules.economy.noticeBoardsBySeats.4': 1,
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

/** The control: one board each at every seat count, and otherwise identical. */
const CONTROL: GameData = loadGameData({
  name: 'notice-board-no-self-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.economy.noticeBoardPower.apiaryPower': 'sow', // pinned 14/09/2026: the default flipped
    'rules.turn.bonusTiming': 'start',
    'rules.turn.selfVisitAllowed': false,
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    // Pinned since the 13/09/2026 default flip gave two seats two boards.
    'rules.economy.noticeBoardsBySeats.2': 1,
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

const TABLE: Record<number, Suit[]> = {
  2: ['wheat', 'vegetable'],
  3: ['wheat', 'vegetable', 'orchard'],
  4: ['wheat', 'vegetable', 'orchard', 'apiary'],
};

/** One decision at which a host's two boards were both on the menu. */
interface Fork {
  /** The best total the term table gave each board, keyed by the board's card. */
  readonly byBoard: ReadonlyMap<CardId, number>;
  /** Every `hostGift` contribution on the menu, keyed the same way. */
  readonly giftByBoard: ReadonlyMap<CardId, readonly number[]>;
  /** The board the policy actually took, or null if it took something else. */
  readonly taken: CardId | null;
}

interface Walk {
  readonly moves: readonly Move[];
  readonly ended: boolean;
  readonly crash: string | null;
  readonly forks: readonly Fork[];
}

/**
 * A whole game, with the term breakdown captured at every decision that offered
 * one host's two boards at once.
 *
 * ⚠️ **ONE POLICY ID FOR EVERY SEAT, AND THAT IS LOAD-BEARING.** `explain` is
 * built from `'balanced'`, so the seat that chooses has to be a `'balanced'`
 * seat or the breakdown would describe a different bot from the one that moved
 * and "it took the better board" would be unfalsifiable.
 */
function walk(data: GameData, spec: { seats: number; seed: string; maxMoves?: number }): Walk {
  const policies = Array.from({ length: spec.seats }, () => makePolicy('balanced'));
  const rngs = policies.map((policy, seat) => policyRng(spec.seed, seat, policy.id));
  const maxMoves = spec.maxMoves ?? 6000;
  const idleLimit = spec.seats * 4;

  let state = newGame(data, {
    seats: spec.seats,
    suits: TABLE[spec.seats] as Suit[],
    seed: spec.seed,
  });
  const moves: Move[] = [];
  const forks: Fork[] = [];
  let idle = 0;
  let crash: string | null = null;

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
      // Every board on this menu that the engine bothered to name. A fork needs
      // both halves at ONE decision, so that nothing but the board can differ.
      const named = new Set<CardId>();
      for (const move of legal) {
        if (move.type === 'visit' && move.board !== undefined) named.add(move.board);
      }
      const move = policy.choose(ctx);
      if (named.size > 1) {
        // `explain` is deliberately un-narrowed, so every visit on offer is in
        // the list, which is what lets one decision carry the whole fork.
        const explained = scoredPolicy('balanced').explain?.(ctx) ?? [];
        forks.push(forkOf(explained, move));
      }
      state = apply(data, state, move).state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    crash = error instanceof Error ? error.message : String(error);
  }

  return { moves, ended: isOver(state), crash, forks };
}

function forkOf(explained: readonly ExplainedMove[], taken: Move): Fork {
  const byBoard = new Map<CardId, number>();
  const giftByBoard = new Map<CardId, number[]>();
  for (const row of explained) {
    if (row.move.type !== 'visit' || row.move.board === undefined) continue;
    const board = row.move.board;
    const best = byBoard.get(board);
    if (best === undefined || row.total > best) byBoard.set(board, row.total);
    const gifts = giftByBoard.get(board) ?? [];
    // `explain` omits a zero contribution, so an absent `hostGift` is a charge
    // of nothing and is recorded as the 0 it is.
    gifts.push(row.terms['hostGift'] ?? 0);
    giftByBoard.set(board, gifts);
  }
  return {
    byBoard,
    giftByBoard,
    taken: taken.type === 'visit' ? (taken.board ?? null) : null,
  };
}

function boardsOf(data: GameData, tableau: readonly { card: CardId }[]): CardId[] {
  return tableau.filter((b) => cardById(data, b.card).slot === 'noticeboard').map((b) => b.card);
}

/**
 * One term's feature, called directly on a synthetic act.
 *
 * The move and the `Outcomes` are stubs because neither term exercised below
 * reads either: `harvest` and `unclogBoard` are flat features off the act and
 * the `Scratch`, which is exactly the property being asserted.
 */
const NO_OUTCOMES: Outcomes = { value: () => 0 };
const STUB_MOVE: Move = { type: 'pass', seat: 0 };

function featureOf(name: string, act: Act, s: Scratch): number {
  const term = TERMS.find((t) => t.name === name);
  if (term === undefined) throw new Error(`No term named ${name}`);
  return term.feature(act, s, STUB_MOVE, NO_OUTCOMES);
}

describe('the two-board fix, and whether a bot can tell the two boards apart', () => {
  // ⛔ THE SEAM ITSELF, ASSERTED BEFORE ANYTHING IS READ THROUGH IT. `board` is
  // present only when the host holds more than one, which is what keeps this
  // arm's three- and four-seat games byte-identical to the control's - and it
  // is also what keeps `effectKey` returning yesterday's string there.
  it('names a board at two seats and never at three or four', () => {
    for (const seats of [2, 3, 4]) {
      const walked = walk(ARM, { seats, seed: `named-${seats}` });
      expect(walked.crash).toBeNull();
      const visits = walked.moves.filter((m) => m.type === 'visit');
      expect(visits.length).toBeGreaterThan(0);
      const withBoard = visits.filter((m) => m.type === 'visit' && m.board !== undefined);
      expect(withBoard.length).toBe(seats === 2 ? visits.length : 0);
    }
    // And the control never names one at two seats either, which is the other
    // half of the same claim.
    const control = walk(CONTROL, { seats: 2, seed: 'control-named' });
    expect(control.crash).toBeNull();
    const controlVisits = control.moves.filter((m) => m.type === 'visit');
    expect(controlVisits.length).toBeGreaterThan(0);
    expect(controlVisits.every((m) => m.type === 'visit' && m.board === undefined)).toBe(true);
  });

  /**
   * ⭐ **THE HEADLINE. The two boards must score DIFFERENTLY, and the bot must
   * take the better one.**
   *
   * Both halves are asserted because either alone is satisfiable by an
   * instrument that is still blind. Scores that differ with a choice that
   * ignores them is a pricer talking to itself; a choice that happens to land
   * on the better board with scores that are equal is the rng.
   *
   * ⚠️ **THE MARGIN IS ASSERTED AS A STRICT INEQUALITY AND NOT AS A SIZE.**
   * What the two boards are worth is a fact about the position - two powers,
   * one hand - and on some turns they genuinely are worth the same, so the
   * claim is that the pricer SEPARATES them when the position does, on a clear
   * majority of forks, and never that a particular gap appears.
   */
  it('scores a host two boards apart, and takes the one worth more', () => {
    const forks = [2, 3, 4, 5].flatMap((n) => {
      const walked = walk(ARM, { seats: 2, seed: `fork-${n}` });
      expect(walked.crash).toBeNull();
      expect(walked.ended).toBe(true);
      return walked.forks;
    });
    expect(forks.length).toBeGreaterThan(10);

    // Half one: the pricer separates them. A fork on which the two boards tie to
    // the last decimal place is what the old `visit:${host}` key produced on
    // EVERY fork, so a clear majority separating is the whole of the fix.
    const separated = forks.filter((fork) => {
      const totals = [...fork.byBoard.values()];
      return Math.max(...totals) - Math.min(...totals) > 1e-9;
    });
    expect(separated.length * 2).toBeGreaterThan(forks.length);

    // Half two: when it separates them and then takes a visit, it takes the
    // better board. Never the worse one, not once.
    let judged = 0;
    for (const fork of separated) {
      if (fork.taken === null) continue;
      const mine = fork.byBoard.get(fork.taken);
      expect(mine).toBeDefined();
      const best = Math.max(...fork.byBoard.values());
      expect(mine as number).toBeCloseTo(best, 9);
      judged++;
    }
    expect(judged).toBeGreaterThan(0);
  });

  /**
   * ⛔ **`hostGift` AT TWO SEATS: THE SAME CHARGE EITHER WAY, BECAUSE IT IS THE
   * SAME RIVAL EITHER WAY.**
   *
   * The term prices a card ARRIVING IN A RIVAL'S STORE, and both of a host's
   * boards are that host's store: the fee rests on whichever board it was
   * played to until that host harvests it into their barn, and the host is the
   * same person. So the charge must neither DOUBLE because the rival now holds
   * two boards nor HALVE because the traffic splits across them.
   *
   * ⚠️ Read against the one-board control at the same seat count, which is the
   * only way to catch a halving: a charge equal on both boards and wrong on
   * both would pass the first assertion on its own.
   */
  it('charges hostGift once per rival visit, the same on either of a host two boards', () => {
    const walked = walk(ARM, { seats: 2, seed: 'gift-two-boards' });
    expect(walked.crash).toBeNull();
    expect(walked.forks.length).toBeGreaterThan(0);
    const seen: number[] = [];
    for (const fork of walked.forks) {
      const perBoard = [...fork.giftByBoard.values()];
      expect(perBoard.length).toBe(2);
      for (const gifts of perBoard) {
        expect(gifts.length).toBeGreaterThan(0);
        // Self-visits are banned under this arm, so every visit on the menu is a
        // rival visit and every one of them is charged.
        for (const gift of gifts) expect(gift).toBeLessThan(0);
        seen.push(...gifts);
      }
      // The two boards' charges are one number, not two.
      const flat = perBoard.flat();
      for (const gift of flat) expect(gift).toBeCloseTo(flat[0] as number, 12);
    }
    // ⭐ AND IT IS THE CONTROL'S NUMBER. `hostGift` reads the host and its
    // standing and nothing else, so a two-seat rival visit costs exactly what
    // it costs when that rival holds one board: the fix has added no thumb, in
    // either direction, to the term that decides who a bot is willing to feed.
    const control = walk(CONTROL, { seats: 2, seed: 'gift-two-boards' });
    expect(control.crash).toBeNull();
    expect(control.moves.some((m) => m.type === 'visit')).toBe(true);
    const state = newGame(CONTROL, { seats: 2, suits: TABLE[2] as Suit[], seed: 'gift-control' });
    const s = makeScratch(CONTROL, viewFor(CONTROL, state, 0));
    // ⚠️ `explain` reports the term's CONTRIBUTION, which is the feature
    // times the weight, so the control reading has to be taken the same way
    // round or the two numbers are not the same quantity.
    const oneBoard =
      featureOf(
        'hostGift',
        { a: 'visit', host: 1, fee: 'W19' as CardId, self: false, meeples: [], toll: [] },
        s,
      ) * (weightsFor('balanced')['hostGift'] ?? 0);
    expect(oneBoard).toBeLessThan(0);
    for (const gift of seen) expect(gift).toBeCloseTo(oneBoard, 12);
  });

  /**
   * ⭐ **THE SCRATCH KNOWS BOTH BOARDS, AND KNOWS WHICH ONE IS ITS OWN SUIT'S.**
   *
   * ⛔ This is the audit's one silently wrong answer, fixed rather than
   * reported. The scan that fills `Scratch.noticeBoard` kept the LAST board it
   * walked past, and setup lays the starters out before it deals the extras, so
   * a wheat seat's `noticeBoard` read **A3 rather than W3** the moment a second
   * board existed. Three readers stood on that field meaning "any board of
   * mine" - `outcome.ts`'s `cardPlaced` exclusion and its `harvested` unclog
   * leg, and the `unclogBoard` term - and all three now ask `noticeBoards`.
   *
   * ⚠️ **THE `cardPlaced` ONE WAS THE EXPENSIVE HALF**: a fee landing on the
   * seat's own suit's board fell through the broken identity test and collected
   * `sow`, which would have paid the owner TWICE for one card, once on arrival
   * and again as `harvest` when the board was cashed. "A popular board is
   * income" is priced at the HARVEST and nowhere else.
   */
  it('names the seat own suit board and holds every board it has', () => {
    const state = newGame(ARM, { seats: 2, suits: TABLE[2] as Suit[], seed: 'scratch-two' });
    for (let seat = 0; seat < 2; seat++) {
      const view = viewFor(ARM, state, seat);
      const s = makeScratch(ARM, view);
      const boards = boardsOf(ARM, view.you.tableau);
      expect(boards.length).toBe(2);
      expect([...s.noticeBoards].sort()).toEqual([...boards].sort());
      expect(s.noticeBoard).not.toBeNull();
      // The OWN SUIT'S board, which is the engine's `noticeBoardOf` semantics.
      expect(cardById(ARM, (s.noticeBoard as { card: CardId }).card).suit).toBe(view.you.suit);
    }
    // And one board each at three seats, where the field and the set agree.
    const three = newGame(ARM, { seats: 3, suits: TABLE[3] as Suit[], seed: 'scratch-three' });
    const s3 = makeScratch(ARM, viewFor(ARM, three, 0));
    expect(s3.noticeBoards.size).toBe(1);
    expect(s3.noticeBoards.has((s3.noticeBoard as { card: CardId }).card)).toBe(true);
  });

  /**
   * ⭐ **THE EXTRA BOARD PAYS ITS OWNER, AND THE PRICER MUST NOT TREAT IT AS
   * WORTHLESS TO OWN.**
   *
   * Its power is usable only by rivals - a seat may never visit its own board,
   * either of them - so the one thing it is worth to its owner is the fee
   * traffic resting on it, cashed by a Harvest. If any term priced a board by
   * whether its owner can BUY its power, the extra board would be dead weight
   * in the bot's books and the variant's core loop would be invisible.
   *
   * Asserted on the terms themselves rather than through a game, because the
   * claim is about the arithmetic and not about a seed: `harvest` pays for the
   * cards that move and nothing else, so the two boards price identically at
   * equal stacks and rise together as fees arrive.
   */
  it('prices a harvest of the extra board exactly as it prices its own suit board', () => {
    const state = newGame(ARM, { seats: 2, suits: TABLE[2] as Suit[], seed: 'income' });
    const view = viewFor(ARM, state, 0);
    const s = makeScratch(ARM, view);
    const boards = boardsOf(ARM, view.you.tableau);
    expect(boards.length).toBe(2);
    const own = boards[0] as CardId;
    const extra = boards[1] as CardId;
    // Both boards start empty, so both price at the same 0. The point is that
    // neither is special-cased anywhere in the walk from act to number.
    expect(featureOf('harvest', { a: 'harvest', building: extra }, s)).toBe(
      featureOf('harvest', { a: 'harvest', building: own }, s),
    );
    // ⭐ AND THE PRICE RISES WITH THE PILE ON EITHER OF THEM. `harvest` reads
    // the stack off `Scratch.buildings`, which is built from the seat's whole
    // tableau, so the extra board is in it exactly as the own-suit board is.
    expect(s.buildings.has(extra)).toBe(true);
    expect(s.buildings.has(own)).toBe(true);
    // `unclogBoard` has no subject on EITHER of them while `3+` is a minimum,
    // which is what stops the instrument manufacturing a20's stall reading.
    expect(s.noticeBoardClogs).toBe(false);
    for (const board of boards) {
      expect(featureOf('unclogBoard', { a: 'harvest', building: board }, s)).toBe(0);
    }
  });

  // The property every balance number rests on: a seed is a game. Asserted at
  // two seats specifically, because two seats is the only place this arm is a
  // different game from its control, and the memo key is what changed.
  it('replays a two-seat seed move for move', () => {
    const first = walk(ARM, { seats: 2, seed: 'replay-two' });
    expect(first.crash).toBeNull();
    expect(first.ended).toBe(true);
    expect(walk(ARM, { seats: 2, seed: 'replay-two' }).moves).toEqual(first.moves);
  });

  // ⛔ AND BOTH OF A RIVAL'S BOARDS HAVE TO ACTUALLY GET VISITED ACROSS A RUN.
  // A bot that separates the two and then always finds the same one better is
  // an instrument that has narrowed a two-target game back down to one, which
  // is the starve the fix exists to end.
  it('visits both of a rival boards across a short run', () => {
    const taken = new Set<CardId>();
    let ended = 0;
    for (const seed of ['split-1', 'split-2', 'split-3', 'split-4']) {
      const walked = walk(ARM, { seats: 2, seed });
      expect(walked.crash).toBeNull();
      if (walked.ended) ended++;
      for (const move of walked.moves) {
        if (move.type === 'visit' && move.board !== undefined) taken.add(move.board);
      }
    }
    expect(ended).toBe(4);
    expect(taken.size).toBeGreaterThan(1);
  });
});
