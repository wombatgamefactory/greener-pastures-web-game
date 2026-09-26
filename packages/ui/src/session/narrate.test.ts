/**
 * The feed. Ticket 09 measured that a bot's turn is followable from this alone,
 * so two lines matter more than the rest.
 *
 * The redacted one: a card someone else drew or placed arrives as `W?`, and it
 * must read as "a Wheat card", never as a bare id.
 *
 * ⭐ And since v31, the VISIT line. A visit and a self-visit are one event with a
 * flag, and the feed is where a player at the table does the counting that
 * `a08-the-hook` does in the simulator - so the two must share no phrasing at
 * all. That assertion is the one in this file that is about the design rather
 * than about the code.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@gp/engine';

// ⛔ THE UI'S OWN DATA, NOT `BASE_GAME_DATA` (19/09/2026, 2.8.2): `dealTable`
// below deals off this `data`, so narrating the result with a separately
// imported `BASE_GAME_DATA` could silently disagree with what was dealt.
import { data, dealTable } from './table';
import { eventsSinceBaseline, narrate, narrateAll, summariseTurns } from './narrate';
import { seatSuits } from '../view/table';

const SUITS = ['wheat', 'vegetable', 'orchard', 'apiary'] as const;
const line = (event: GameEvent) => narrate(data, event, SUITS, 0);

describe('narrate', () => {
  it('names you as yourself and everyone else by their crop', () => {
    expect(line({ e: 'built', seat: 0, card: 'W18', payment: [] })?.text).toContain('You (Wheat)');
    expect(line({ e: 'built', seat: 2, card: 'O5', payment: [] })?.text).toContain('Orchard farm');
  });

  it('reads a masked card as its suit, which is the part that is public', () => {
    const text = line({ e: 'cardsToHand', seat: 1, cards: ['W?'] })?.text ?? '';
    expect(text).toContain('a Wheat card');
    expect(text).not.toContain('W?');
  });

  it('collapses a masked handful to a count rather than five identical phrases', () => {
    const text = line({ e: 'cardsToHand', seat: 1, cards: ['W?', 'O?', 'D?'] })?.text ?? '';
    expect(text).toContain('3 cards');
  });

  it('names a card you are entitled to see', () => {
    expect(line({ e: 'built', seat: 0, card: 'W18', payment: [] })?.text).toContain('Helping Hand');
  });

  it('distinguishes a card placed on your own board from one on a neighbour', () => {
    const own = line({
      e: 'cardPlaced',
      seat: 0,
      onto: { seat: 0, building: 'W3' },
      card: 'W7',
    })?.text;
    expect(own).toContain('their own');
    const away = line({
      e: 'cardPlaced',
      seat: 0,
      onto: { seat: 2, building: 'O3' },
      card: 'W7',
    })?.text;
    expect(away).toContain('Orchard farm');
  });

  /**
   * ⭐ THE LINE THE WHOLE v31 PASS TURNED ON, KEPT AS A REGRESSION CHECK ON A
   * DEAD BRANCH. Self-visiting is BANNED under the shipped rules (11/09/2026),
   * so `event.self` is never true under `visitCurrency: 'noticeBoardPower'` -
   * the branch survives only because the pre-ban `'card'` control still
   * replays it (`narrate.ts`, 18/09/2026 rewrite). It still must not share a
   * phrase with the neighbour visit, and only the neighbour one is the alarm:
   * the hook is the thing worth looking up from your own farm for.
   */
  it('never narrates a self-visit the way it narrates a neighbour visit', () => {
    const self = line({
      e: 'visited',
      seat: 1,
      host: 1,
      self: true,
      colour: 'vegetable',
      action: 'deliver',
    });
    const other = line({
      e: 'visited',
      seat: 1,
      host: 2,
      self: false,
      colour: 'orchard',
      action: 'draw',
    });
    expect(self?.text).toContain('own Notice Board');
    expect(self?.text).toContain('self-visiting is banned');
    expect(self?.text).not.toContain('visits');
    expect(other?.text).toContain('visits');
    expect(other?.text).not.toContain('own Notice Board');
    // And only the cross-table one is set apart: the hook is the thing worth
    // looking up from your own farm for.
    expect(other?.kind).toBe('alarm');
    expect(self?.kind).toBe('normal');
  });

  it('names the action a visit bought, whichever door it was', () => {
    expect(
      line({ e: 'visited', seat: 1, host: 2, self: false, colour: 'wheat', action: 'harvest' })
        ?.text,
    ).toContain('Harvest');
  });

  /**
   * The meeple's whole life, in two lines: it arrives off a named island tile
   * and it leaves the game. Both facts are load-bearing - the island is the only
   * source, and nothing returns a spent meeple to any pool - so both are said
   * out loud rather than left to be inferred from a count that moved.
   */
  it('narrates a meeple arriving off the island and leaving the game', () => {
    const gained = line({
      e: 'meepleGained',
      seat: 1,
      colour: 'dairy',
      tile: 'A3',
      vp: 4,
    })?.text;
    expect(gained).toContain('Dairy');
    expect(gained).toContain('A3');

    const spent = line({ e: 'meepleSpent', seat: 1, colour: 'dairy', action: 'build' })?.text;
    expect(spent).toContain('Build');
    expect(spent).toContain('leaves the game');
  });

  /**
   * ⚠️ `doorUsed` IS DELIBERATELY SILENT, and this is what keeps that deliberate
   * rather than forgotten. It fires alongside every `visited` and every
   * `meepleSpent`, both of which already name the action, so narrating it too
   * would print every door use twice - which on a four-seat table is half the
   * feed saying the same thing.
   */
  it('says nothing for doorUsed, because the thing that bought it already spoke', () => {
    expect(
      line({ e: 'doorUsed', seat: 1, colour: 'wheat', action: 'harvest', via: 'meeple' }),
    ).toBeNull();
  });

  it('marks the moments that change the game, not just the state', () => {
    expect(line({ e: 'endTriggered', seat: 1 })?.kind).toBe('alarm');
    expect(line({ e: 'turnEnded', seat: 1, next: 2 })?.kind).toBe('boundary');
    expect(line({ e: 'gameEnded' })?.kind).toBe('alarm');
  });

  it('reports a delivery as VP and a tile, with no coin left in it', () => {
    const text = line({
      e: 'delivered',
      seat: 1,
      tile: 'B2',
      vp: 6,
      crop: 'wheat',
      worker: null,
      spend: { wheat: 4 },
    })?.text;
    expect(text).toContain('6 VP');
    expect(text).toContain('B2');
    expect(text).not.toContain('£');
  });

  /**
   * B10 (25/09/2026): `doVisit` (`packages/engine/src/actions/bonus.ts`)
   * places the fee before it emits `visited` - `cardPlaced` then `visited`,
   * in that order, every time - which read straight told the reader the
   * effect ("places a card on Y's Notice Board") a line before the cause
   * ("X visits Y ... takes Deliver"). `narrateAll` now reorders that one
   * adjacent pair before narrating; a single `narrate()` call has no
   * neighbouring event to look at, so the fix has to be proved through
   * `narrateAll`, on the exact order the engine emits.
   */
  it('narrateAll puts the "visits" line before the "places" line it caused', () => {
    const events: GameEvent[] = [
      { e: 'cardPlaced', seat: 1, onto: { seat: 2, building: 'O3' }, card: 'W7' },
      { e: 'visited', seat: 1, host: 2, self: false, colour: 'orchard', action: 'draw' },
    ];
    const lines = narrateAll(data, events, SUITS, 0);
    expect(lines).toHaveLength(2);
    const visitsAt = lines.findIndex((l) => l.text.includes('visits'));
    const placesAt = lines.findIndex((l) => l.text.includes('places'));
    expect(visitsAt).toBeGreaterThanOrEqual(0);
    expect(placesAt).toBeGreaterThanOrEqual(0);
    expect(visitsAt).toBeLessThan(placesAt);
  });

  it('leaves an unrelated placement exactly where it was - only a visit fee reorders', () => {
    const events: GameEvent[] = [
      { e: 'cardPlaced', seat: 1, onto: { seat: 1, building: 'W4' }, card: 'W7' },
      { e: 'visited', seat: 3, host: 2, self: false, colour: 'orchard', action: 'draw' },
    ];
    const lines = narrateAll(data, events, SUITS, 0);
    expect(lines.map((l) => (l.text.includes('places') ? 'places' : 'visits'))).toEqual([
      'places',
      'visits',
    ]);
  });

  it('narrates a whole real game without producing an empty or id-shaped line', () => {
    const table = dealTable({
      seats: 4,
      suits: [...SUITS],
      seed: 'narrate',
      depth: 300,
      minHand: 3,
    });
    const lines = narrateAll(data, table.events, seatSuits(table.view), table.view.seat);
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) {
      expect(l.text.trim().length).toBeGreaterThan(4);
      expect(l.text).not.toMatch(/\b[WVOAD]\?/);
      // No stray currency anywhere in the feed: there is none in the game.
      expect(l.text).not.toContain('£');
      // B13 (25/09/2026): the piece is a Worker everywhere a player reads it,
      // and "door" is internal shorthand for a suit's plain action that a
      // player should never have to learn.
      expect(l.text.toLowerCase()).not.toContain('meeple');
      expect(l.text.toLowerCase()).not.toContain('door');
    }
  });
});

/**
 * B9 (25/09/2026): "while you were away". `summariseTurns` groups the raw
 * events between two of the human's own decisions into one plain-language
 * line per rival turn - see the long comment above its definition for why
 * this is not just `narrateAll`'s sentences stapled together.
 */
describe('summariseTurns', () => {
  const summarise = (events: GameEvent[]) => summariseTurns(data, events, SUITS, 0);

  it('writes one line combining a visit onto your board and the delivery it bought', () => {
    const lines = summarise([
      { e: 'cardPlaced', seat: 2, onto: { seat: 0, building: 'W3' }, card: 'O7' },
      { e: 'visited', seat: 2, host: 0, self: false, colour: 'wheat', action: 'deliver' },
      {
        e: 'delivered',
        seat: 2,
        tile: 'B2',
        vp: 6,
        crop: 'wheat',
        worker: null,
        spend: { wheat: 4 },
      },
      { e: 'turnEnded', seat: 2, next: 0 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.seat).toBe(2);
    expect(lines[0]?.text).toContain('Orchard farm');
    expect(lines[0]?.text).toContain('visited you');
    expect(lines[0]?.text).toContain('+1 card on your Notice Board');
    expect(lines[0]?.text).toContain('then delivered to island B2 for 6 VP');
    // The board's own suit (Wheat, yours) and the delivered crop (also Wheat
    // here) both land in the icon list, deduplicated.
    expect(lines[0]?.icons).toContain('orchard');
  });

  it('writes a build line', () => {
    const lines = summarise([
      { e: 'built', seat: 1, card: 'W18', payment: [] },
      { e: 'turnEnded', seat: 1, next: 0 },
    ]);
    expect(lines[0]?.text).toBe('Vegetable farm built Helping Hand.');
  });

  it('writes a harvest line with the card count', () => {
    const lines = summarise([
      {
        e: 'harvested',
        seat: 3,
        building: 'W11',
        cards: ['W1', 'W2', 'W3'],
        source: 'tableau',
        owner: 3,
      },
      { e: 'turnEnded', seat: 3, next: 0 },
    ]);
    expect(lines[0]?.text).toContain('harvested');
    expect(lines[0]?.text).toContain('(3 cards)');
  });

  it('writes a Worker-spend line, named for the action it bought', () => {
    const lines = summarise([
      { e: 'meepleSpent', seat: 2, colour: 'apiary', action: 'grow' },
      { e: 'turnEnded', seat: 2, next: 0 },
    ]);
    expect(lines[0]?.text).toContain('an Apiary Worker');
    expect(lines[0]?.text).toContain('Grow');
    expect(lines[0]?.text).not.toContain('meeple');
  });

  it('splits two rivals turns into two lines, in order', () => {
    const lines = summarise([
      { e: 'built', seat: 1, card: 'W18', payment: [] },
      { e: 'turnEnded', seat: 1, next: 2 },
      {
        e: 'delivered',
        seat: 2,
        tile: 'A1',
        vp: 3,
        crop: 'orchard',
        worker: null,
        spend: { orchard: 4 },
      },
      { e: 'turnEnded', seat: 2, next: 0 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.seat).toBe(1);
    expect(lines[1]?.seat).toBe(2);
  });

  it('never produces a line for your own turn', () => {
    const lines = summarise([
      { e: 'built', seat: 0, card: 'W18', payment: [] },
      { e: 'turnEnded', seat: 0, next: 1 },
    ]);
    expect(lines).toHaveLength(0);
  });

  it('drops a turn with nothing notable in it rather than printing an empty sentence', () => {
    const lines = summarise([
      { e: 'cardsDiscarded', suit: 'wheat', cards: ['W1'] },
      { e: 'turnEnded', seat: 1, next: 0 },
    ]);
    expect(lines).toHaveLength(0);
  });

  it('still shows a trailing turn with no closing turnEnded yet', () => {
    const lines = summarise([{ e: 'built', seat: 1, card: 'W18', payment: [] }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain('built Helping Hand');
  });
});

describe('eventsSinceBaseline', () => {
  it('returns everything after the baseline`s last event, by identity', () => {
    const a: GameEvent = { e: 'built', seat: 0, card: 'W18', payment: [] };
    const b: GameEvent = { e: 'turnEnded', seat: 0, next: 1 };
    const c: GameEvent = { e: 'built', seat: 1, card: 'O5', payment: [] };
    const d: GameEvent = { e: 'turnEnded', seat: 1, next: 0 };
    const baseline = [a, b];
    const current = [a, b, c, d];
    expect(eventsSinceBaseline(baseline, current)).toEqual([c, d]);
  });

  it('returns everything when the baseline is empty (the very first turn)', () => {
    const a: GameEvent = { e: 'built', seat: 0, card: 'W18', payment: [] };
    expect(eventsSinceBaseline([], [a])).toEqual([a]);
  });

  it('returns nothing new when nothing has happened since the baseline', () => {
    const a: GameEvent = { e: 'built', seat: 0, card: 'W18', payment: [] };
    expect(eventsSinceBaseline([a], [a])).toEqual([]);
  });

  it('falls back to everything current if the seam has fallen out of the window', () => {
    // The baseline's own tail is not found in `current` at all - the 160-event
    // window slid past it. Showing everything current is the safer failure.
    const gone: GameEvent = { e: 'built', seat: 0, card: 'W18', payment: [] };
    const c: GameEvent = { e: 'built', seat: 1, card: 'O5', payment: [] };
    expect(eventsSinceBaseline([gone], [c])).toEqual([c]);
  });
});
