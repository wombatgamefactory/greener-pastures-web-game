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
import { BASE_GAME_DATA as data } from '@gp/data';
import type { GameEvent } from '@gp/engine';

import { dealTable } from './table';
import { narrate, narrateAll } from './narrate';
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
   * ⭐ THE LINE THE WHOLE v31 PASS TURNS ON. Same event, one flag, opposite acts.
   * They must not share a phrase, because the feed is how a player sees whether
   * the table is playing the hook or playing solitaire.
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
    expect(self?.text).toContain('OWN door');
    expect(self?.text).not.toContain('visits');
    expect(other?.text).toContain('visits');
    expect(other?.text).not.toContain('OWN');
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
      space: 0,
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
    const text = line({ e: 'delivered', seat: 1, tile: 'B2', vp: 6, spend: { wheat: 2 } })?.text;
    expect(text).toContain('6 VP');
    expect(text).toContain('B2');
    expect(text).not.toContain('£');
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
    }
  });
});
