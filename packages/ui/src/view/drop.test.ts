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
import { BASE_GAME_DATA as data } from '@gp/data';
import type { Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { CardId, Move, PlayerView, Seat } from '@gp/engine';
import { makePolicy, policyRng } from '@gp/bots';

import { DROP_FAMILIES, dispatchDrop, dropAllowed, dropZone, parseDrop } from './drop';
import type { DropSink, DropTarget } from './drop';
import { clickBuilding, clickRival, liveTargets, visitPayoffs } from './intent';
import type { Intent } from './intent';

interface Position {
  readonly view: PlayerView;
  readonly moves: readonly Move[];
}

/** Real positions from real games, the same shape ticket 25's corpus uses. */
function corpus(seeds: readonly string[], seats: number, suits: Suit[]): Position[] {
  const out: Position[] = [];
  for (const seed of seeds) {
    let state = newGame(data, { seats, suits, seed });
    for (let step = 0; step < 500 && !isOver(state); step++) {
      const moves = legalMoves(data, state);
      if (moves.length === 0) break;
      const actor = state.tasks[0]?.pid ?? state.turnPlayer;
      const view = viewFor(data, state, actor);
      out.push({ view, moves });
      const policy = makePolicy(step % 3 === 0 ? 'socialite' : 'balanced');
      const rng = policyRng(seed, actor, 'balanced');
      const probe = makeProber(data, state, actor);
      state = apply(data, state, policy.choose({ data, view, moves, rng, probe })).state;
    }
  }
  return out;
}

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

function recorder(): { sink: DropSink; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      building: (card) => calls.push(`building:${card}`),
      rival: (seat) => calls.push(`rival:${seat}`),
      hold: (card) => calls.push(`hold:${card}`),
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
    expect(parseDrop(dropZone('rival', 2)['data-drop'])).toEqual({ kind: 'rival', id: '2' });
    expect(parseDrop(dropZone('assembly')['data-drop'])).toEqual({ kind: 'assembly', id: '' });
    expect(parseDrop(null)).toBeNull();
    expect(parseDrop('')).toBeNull();
    // Not a drop kind: an unrelated attribute must never be read as a zone.
    expect(parseDrop('tile:L1a')).toBeNull();
  });

  it('sends each kind to exactly one handler, the one the click path uses', () => {
    const cases: [DropTarget, string][] = [
      [{ kind: 'building', id: 'W3' }, 'building:W3'],
      [{ kind: 'rival', id: '2' }, 'rival:2'],
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
  it('every one-card visit, by dropping its fee on the host', () => {
    let checked = 0;
    for (const p of positions) {
      for (const move of p.moves) {
        if (move.type !== 'visit' || move.fee.length !== 1) continue;
        const card = move.fee[0] as CardId;
        const intent = held(card);
        const live = liveTargets(p.view, p.moves, intent);
        const target: DropTarget = { kind: 'rival', id: String(move.host) };
        expect(dropAllowed(live, intent, target, card)).toBe(true);
        // And the drop lands on the same panel, with the fee already paid.
        const opened = clickRival(p.moves, intent, move.host);
        expect(opened).toEqual({ k: 'visit', host: move.host, fee: [card] });
        expect(visitPayoffs(p.moves, { host: move.host, fee: [card] })).toContain(move);
        checked++;
      }
    }
    // ~1,180 in this corpus; the floor is a collapse detector, not a target.
    expect(checked).toBeGreaterThan(400);
  });

  it('the second card of a two-card visit, by dropping it on the open panel', () => {
    let checked = 0;
    for (const p of positions) {
      for (const move of p.moves) {
        if (move.type !== 'visit' || move.fee.length !== 2) continue;
        const [first, second] = move.fee as [CardId, CardId];
        const intent: Intent = { k: 'visit', host: move.host, fee: [first] };
        const live = liveTargets(p.view, p.moves, intent);
        expect(dropAllowed(live, intent, { kind: 'assembly', id: '' }, second)).toBe(true);
        checked++;
      }
    }
    // Special Orders needs an upgraded Notice Board with room for two, so this
    // is the thinnest of the four (~250 here) - but it must not be empty, or
    // the assertion is asserting nothing.
    expect(checked).toBeGreaterThan(50);
  });

  it('every grow, by dropping the payment on the building', () => {
    let checked = 0;
    for (const p of positions) {
      for (const move of p.moves) {
        if (move.type !== 'grow') continue;
        const intent = held(move.payment);
        const live = liveTargets(p.view, p.moves, intent);
        const target: DropTarget = { kind: 'building', id: move.building };
        expect(dropAllowed(live, intent, target, move.payment)).toBe(true);
        expect(clickBuilding(p.moves, intent, move.building)).toContain(move);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

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
    expect(checked).toBeGreaterThan(20);
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
    const shut = ([0, 1, 2, 3] as Seat[]).find((s) => !live.hosts.has(s));
    expect(shut).toBeDefined();
    expect(dropAllowed(live, intent, { kind: 'rival', id: String(shut) }, card)).toBe(false);
  });

  it('refuses the assembly zone when no assembly is open', () => {
    const intent = held(card);
    const live = liveTargets(p.view, p.moves, intent);
    expect(dropAllowed(live, intent, { kind: 'assembly', id: '' }, card)).toBe(false);
  });
});
