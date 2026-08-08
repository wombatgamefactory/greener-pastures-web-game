/**
 * The feed. Ticket 09 measured that a bot's turn is followable from this alone,
 * so the line that matters most is the redacted one: a card someone else drew or
 * placed arrives as `W?`, and it must read as "a Wheat card", never as a bare id.
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
    expect(line({ e: 'coins', seat: 0, delta: 2, why: 'visit' })?.text).toContain('You (Wheat)');
    expect(line({ e: 'coins', seat: 2, delta: 2, why: 'visit' })?.text).toContain('Orchard farm');
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
    expect(line({ e: 'built', seat: 0, card: 'W18', payment: [], coins: 2 })?.text).toContain(
      'Helping Hand',
    );
  });

  it('distinguishes a visit on your own board from one on a neighbour', () => {
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

  it('marks the two moments that change the game, not just the state', () => {
    expect(line({ e: 'endTriggered', seat: 1 })?.kind).toBe('alarm');
    expect(line({ e: 'starterUpgraded', seat: 1, card: 'V2', free: true })?.kind).toBe('alarm');
    expect(line({ e: 'starterUpgraded', seat: 1, card: 'V1', free: false })?.kind).toBe('normal');
    expect(line({ e: 'turnEnded', seat: 1, next: 2 })?.kind).toBe('boundary');
  });

  it('names the Service used, and whether it was free', () => {
    // The wage is a plain `coins` event since the Working Week died, so there
    // is no wage line of its own to narrate any more.
    expect(
      line({ e: 'workerWorked', seat: 1, workerId: 'draw', owner: 0, free: false })?.text,
    ).toContain('draw Service');
    expect(
      line({ e: 'workerWorked', seat: 1, workerId: 'draw', owner: 0, free: true })?.text,
    ).toContain('for free');
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
    }
  });
});
