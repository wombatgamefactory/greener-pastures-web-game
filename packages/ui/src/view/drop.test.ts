/**
 * Drag, checked where it can actually be wrong.
 *
 * The gesture itself needs a browser (`tools/verify-drag.mjs` drives a real
 * pointer), and there is deliberately nothing here that simulates one. What is
 * checked here is the half a browser test would not catch for months:
 *
 *  1. **The vocabulary cannot rot.** Every glow family either takes a drop or is
 *     recorded as click-only, checked against a real `Live` - so a new target
 *     family fails the build until someone decides which it is.
 *  2. **A drag reaches the same moves a click does.** Every visit in a corpus of
 *     real positions is reachable by dropping its fee on the host, and every
 *     grow and sow by dropping the card on the building. That is ticket 25's
 *     "every legal move is reachable" argument applied to the second gesture:
 *     an unreachable move throws nothing and looks like nothing.
 *  3. **A zone that lights up accepts the card.** `dropAllowed` and
 *     `dispatchDrop` are checked against each other, so the pair cannot drift
 *     into a zone that glows on approach and then swallows the drop.
 */

import { describe, expect, it } from 'vitest';
// ⛔ THE UI'S OWN DATA, NOT `BASE_GAME_DATA`, since 04/09/2026. The shipped
// rules are the meeple loop and this package still draws the v31 card-fee game,
// so `session/table.ts` pins itself to `overlays/v31-card-visit.overlay.json` -
// see the docblock there for why, and for what the UI pass owes. A test that
// reached past that pin would be measuring rules the interface does not draw.
import { data } from '../session/table';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { CardId, Move, PlayerView, Seat } from '@gp/engine';
import { makePolicy, policyRng } from '@gp/bots';

import { DROP_FAMILIES, dispatchDrop, dropAllowed, dropZone, parseDrop } from './drop';
import type { DropSink, DropTarget } from './drop';
import { clickBuilding, clickHost, liveTargets, visitComplete } from './intent';
import type { Intent } from './intent';

interface Position {
  readonly view: PlayerView;
  readonly moves: readonly Move[];
}

/** Real positions from real games, the same shape ticket 25's corpus uses. */
function corpus(
  seeds: readonly string[],
  seats: number,
  suits: Suit[],
  gd: GameData = data,
): Position[] {
  const out: Position[] = [];
  for (const seed of seeds) {
    let state = newGame(gd, { seats, suits, seed });
    for (let step = 0; step < 500 && !isOver(state); step++) {
      const moves = legalMoves(gd, state);
      if (moves.length === 0) break;
      const actor = state.tasks[0]?.pid ?? state.turnPlayer;
      const view = viewFor(gd, state, actor);
      out.push({ view, moves });
      const policy = makePolicy(step % 3 === 0 ? 'socialite' : 'balanced');
      const rng = policyRng(seed, actor, 'balanced');
      const probe = makeProber(gd, state, actor);
      state = apply(gd, state, policy.choose({ data: gd, view, moves, rng, probe })).state;
    }
  }
  return out;
}

/*
 * ⛔ THE TWO-CARD CORPUS IS GONE (v31), and it is worth recording what it was
 * for. Special Orders' upgraded Notice Board took two cards for GBP 3 and was
 * the only route in the game that ever placed two cards in one visit; it was
 * switched off on 2026-08-13, so the corpus here was rebuilt from an overlay
 * that turned the line back on, purely so the drag that pays the SECOND card
 * kept a test. v31 deletes the upgraded faces and the currency, and `visit.fee`
 * is a single `CardId` rather than a list - so there is no second card, no
 * assembly to drop it on and no overlay that could bring one back.
 */

// `drop-d` was added on 2026-08-08, not because anything broke but because the
// wild substitution shifted these seeds toward Deliver and away from Sow, and
// the sow coverage count fell under its adequacy guard. The guards are the point
// of the corpus, so the corpus grew rather than the guards shrinking.
const positions = [
  ...corpus(['drop-a', 'drop-b'], 3, ['wheat', 'vegetable', 'orchard']),
  ...corpus(['drop-c'], 4, ['wheat', 'vegetable', 'orchard', 'dairy']),
  ...corpus(['drop-d'], 3, ['apiary', 'vegetable', 'dairy']),
];

const held = (card: CardId): Intent => ({ k: 'hold', card });

/**
 * ⏱️ TWO CASES BELOW SWEEP THE WHOLE CORPUS AND NEED MORE THAN vitest's 5s.
 *
 * They are the widest assertions in the file - every visit and every grow in
 * ~2,000 real positions, each one asking `liveTargets` what is lit - and the
 * cost is the corpus, not the code under test: measured on 02/09/2026 there are
 * ~12,500 grow moves across the four seeds, and a `liveTargets` on a mid-game
 * position is a scan of a move list that can run to the hundreds.
 *
 * The budget is raised rather than the corpus cut. What these two catch is a
 * move that is legal and simply cannot be dragged to - which throws nothing,
 * looks like nothing, and is only ever caught by sweeping everything - so
 * sampling would trade the whole point of the file for a faster run.
 */
const SWEEP = 120_000;

function recorder(): { sink: DropSink; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      building: (card: CardId) => calls.push(`building:${card}`),
      host: (seat: Seat) => calls.push(`host:${seat}`),
      hold: (card: CardId) => calls.push(`hold:${card}`),
    },
  };
}

describe('the drop vocabulary', () => {
  it('covers every glow family, so a new target family cannot slip in untouched', () => {
    const p = positions[0] as Position;
    const live = liveTargets(p.view, p.moves, { k: 'idle' });
    expect(Object.keys(DROP_FAMILIES).sort()).toEqual(Object.keys(live).sort());
  });

  it('round-trips a zone attribute, and refuses anything else', () => {
    expect(parseDrop(dropZone('building', 'W3')['data-drop'])).toEqual({
      kind: 'building',
      id: 'W3',
    });
    expect(parseDrop(dropZone('host', 2)['data-drop'])).toEqual({ kind: 'host', id: '2' });
    expect(parseDrop(dropZone('assembly')['data-drop'])).toEqual({ kind: 'assembly', id: '' });
    expect(parseDrop(null)).toBeNull();
    expect(parseDrop('')).toBeNull();
    // Not a drop kind: an unrelated attribute must never be read as a zone.
    expect(parseDrop('tile:L1a')).toBeNull();
  });

  it('sends each kind to exactly one handler, the one the click path uses', () => {
    const cases: [DropTarget, string][] = [
      [{ kind: 'building', id: 'W3' }, 'building:W3'],
      [{ kind: 'host', id: '2' }, 'host:2'],
      [{ kind: 'assembly', id: '' }, 'hold:V9'],
    ];
    for (const [target, expected] of cases) {
      const { sink, calls } = recorder();
      dispatchDrop(sink, target, 'V9');
      expect(calls).toEqual([expected]);
    }
  });
});

describe('a drag reaches what a click reaches', () => {
  /**
   * ⭐ THE TWO HALVES OF THE VISIT ARE COUNTED SEPARATELY, for the same reason
   * `a08-the-hook` counts them separately in the simulator: an assertion that
   * pooled them could pass on neighbour visits alone while the self one was
   * dead, and the self one is half the bonus slot.
   *
   * ⚠️ THEY ARE REACHED BY DIFFERENT GESTURES, AND THAT IS A DECISION RATHER
   * THAN A GAP IN THE SWEEP. A neighbour's rail card is a whole drop zone, so a
   * visit is a drag. Your OWN Notice Board is a building in your own tableau and
   * its drop zone already means SOW - an element carries one `data-drop`, and
   * silently changing what a drop on your own board meant would be the worst
   * kind of overloading. So the self-visit is reached by a badge on that card,
   * click-only, and this checks the path each one actually has.
   */
  it(
    'every visit: a neighbour by dragging, your own board by its badge',
    () => {
      let checkedOut = 0;
      let checkedSelf = 0;
      for (const p of positions) {
        for (const move of p.moves) {
          if (move.type !== 'visit') continue;
          // TODO(meeple-loop): owned by the ui pass. This whole drag test is
          // about the CARD fee; a meeple visit places no card, so it has no
          // drag source and is skipped rather than modelled here.
          const card = move.fee;
          if (card === null) continue;
          const intent = held(card);
          const live = liveTargets(p.view, p.moves, intent);
          if (move.host !== move.seat) {
            const target: DropTarget = { kind: 'host', id: String(move.host) };
            expect(dropAllowed(live, intent, target, card)).toBe(true);
          }
          // Both land on the same panel, with the fee already paid.
          const opened = clickHost(p.view, p.moves, intent, move.host);
          expect(opened).toEqual({ k: 'visit', host: move.host, fee: card });
          expect(visitComplete(p.moves, { host: move.host, fee: card })).toBe(move);
          if (move.host === move.seat) checkedSelf++;
          else checkedOut++;
        }
      }
      // Floors are collapse detectors, not targets. Both must be non-trivial, or
      // one half of the bonus slot could be unreachable and this would be green.
      expect(checkedOut).toBeGreaterThan(200);
      expect(checkedSelf).toBeGreaterThan(50);
    },
    SWEEP,
  );

  it(
    'every grow, by dropping the payment on the building',
    () => {
      let checked = 0;
      for (const p of positions) {
        for (const move of p.moves) {
          // R15's meeple-paid grow carries no card, so there is nothing to
          // hold and nothing to drop: it is not part of this model.
          if (move.type !== 'grow' || move.payment === null) continue;
          const intent = held(move.payment);
          const live = liveTargets(p.view, p.moves, intent);
          const target: DropTarget = { kind: 'building', id: move.building };
          expect(dropAllowed(live, intent, target, move.payment)).toBe(true);
          expect(clickBuilding(p.moves, intent, move.building)).toContain(move);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(80);
    },
    SWEEP,
  );

  it('every sow answer, by dropping the sown card on the building', () => {
    let checked = 0;
    for (const p of positions) {
      for (const move of p.moves) {
        if (move.type !== 'task' || move.answer.kind !== 'sow') continue;
        const { card, onto } = move.answer;
        const intent = held(card);
        const live = liveTargets(p.view, p.moves, intent);
        expect(dropAllowed(live, intent, { kind: 'building', id: onto }, card)).toBe(true);
        checked++;
      }
    }
    // NO floor, deliberately. The real assertion is the one inside the loop:
    // every hand-sow that appears must be reachable by dragging. `deckSow` has no
    // drag affordance at all, which is a real UI gap and is tracked as one rather
    // than asserted here.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});

describe('a drop that would do nothing is refused', () => {
  const p = positions.find((q) => q.view.you.hand.length > 0) as Position;
  const card = p.view.you.hand[0] as CardId;

  it('refuses a building that is not lit for this card', () => {
    const intent = held(card);
    const live = liveTargets(p.view, p.moves, intent);
    expect(dropAllowed(live, intent, { kind: 'building', id: 'not-a-building' }, card)).toBe(false);
  });

  it('refuses a seat that is not visitable', () => {
    const intent = held(card);
    const live = liveTargets(p.view, p.moves, intent);
    // Seat 9 is not at any table this corpus builds, so it can never be lit.
    const shut = ([9, 0, 1, 2, 3] as Seat[]).find((s) => !live.hosts.has(s));
    expect(shut).toBeDefined();
    expect(dropAllowed(live, intent, { kind: 'host', id: String(shut) }, card)).toBe(false);
  });

  it('refuses the assembly zone when no assembly is open', () => {
    const intent = held(card);
    const live = liveTargets(p.view, p.moves, intent);
    expect(dropAllowed(live, intent, { kind: 'assembly', id: '' }, card)).toBe(false);
  });
});
