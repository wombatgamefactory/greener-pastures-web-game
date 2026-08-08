/**
 * These tests are the drift guard.
 *
 * The sheet lives outside this repo and moves without warning, and the knob
 * registry names paths that a re-extract could delete. Both failure modes are
 * silent: the game still runs, it just runs on numbers nobody chose. Every test
 * here exists to make one of those loud.
 */

import { describe, expect, it } from 'vitest';

import {
  BASE_GAME_DATA,
  KNOB_TEMPLATES,
  OVERLAY_SCHEMA_VERSION,
  OverlayError,
  activeCards,
  applyOverlay,
  deadTemplates,
  deliveriesPerTile,
  deliveryCost,
  deliveryVp,
  expandSweep,
  flatten,
  listKnobs,
  loadGameData,
  validateOverlay,
} from './index.js';
import type { Overlay, SweepFile } from './index.js';

const overlay = (set: Overlay['set'], name = 'test'): Overlay => ({
  name,
  schemaVersion: OVERLAY_SCHEMA_VERSION,
  set,
});

describe('the extract', () => {
  it('holds 105 cards: 15 starters and 90 shuffled', () => {
    const cards = BASE_GAME_DATA.cards.catalogue;
    expect(cards).toHaveLength(105);
    expect(cards.filter((c) => c.inDeck)).toHaveLength(90);
    expect(cards.filter((c) => !c.inDeck)).toHaveLength(15);
  });

  it('gives every suit the same shape', () => {
    const expected = { starter: 3, tier1: 5, tier2: 4, tier3: 3, power: 3, endgame: 3 };
    for (const suit of BASE_GAME_DATA.cards.suits) {
      const ofSuit = BASE_GAME_DATA.cards.catalogue.filter((c) => c.suit === suit);
      for (const [type, count] of Object.entries(expected)) {
        expect(
          ofSuit.filter((c) => c.type === type),
          `${suit} ${type}`,
        ).toHaveLength(count);
      }
    }
  });

  it('gives every suit exactly one of each starter slot', () => {
    for (const suit of BASE_GAME_DATA.cards.suits) {
      const slots = BASE_GAME_DATA.cards.catalogue
        .filter((c) => c.suit === suit && c.type === 'starter')
        .map((c) => c.slot)
        .sort();
      expect(slots, suit).toEqual(['barn', 'farmstead', 'noticeboard']);
    }
  });

  it('has unique card ids', () => {
    const ids = BASE_GAME_DATA.cards.catalogue.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships every card enabled', () => {
    expect(activeCards()).toHaveLength(105);
  });

  it('is frozen, so a caller cannot mutate shared data', () => {
    expect(Object.isFrozen(BASE_GAME_DATA.cards.catalogue)).toBe(true);
    expect(() => {
      (BASE_GAME_DATA.rules.setup as { startingHand: number }).startingHand = 99;
    }).toThrow();
  });

  it('records provenance on every file', () => {
    for (const [name, file] of Object.entries(BASE_GAME_DATA)) {
      // A positive integer, not a fixed 1: island.json went to 2 when the flat
      // island (2026-08-09) changed its shape incompatibly - levelRules out,
      // tileRule and vpByDeliveryOrder in. Nothing reads the number, so it is a
      // signal to whoever opens the file, and a file whose shape breaks should
      // say so rather than keep a stamp that no longer means anything.
      expect(Number.isInteger(file.meta.schemaVersion), name).toBe(true);
      expect(file.meta.schemaVersion, name).toBeGreaterThan(0);
      expect(['generated', 'authored'], name).toContain(file.meta.kind);
    }
    // Only cards.json is machine-generated, and it fingerprints its source so a
    // stale extract can be spotted against the sheet it came from.
    expect(BASE_GAME_DATA.cards.meta.kind).toBe('generated');
    expect(BASE_GAME_DATA.cards.meta.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the island', () => {
  // The flat island (2026-08-09): every tile is 2 crates of 2 cards. The
  // RATE-not-total reading of the sheet's quantity label survives from ticket
  // 14; what went is the per-level chain (2 / 6 / 9, then 2 / 4 / 6).
  it('derives delivery cost from crates times cards-per-crate, the same at every tile', () => {
    expect(deliveryCost(BASE_GAME_DATA)).toBe(4);
  });

  it('lets one knob move the whole cost, because cost is never stored twice', () => {
    expect(deliveryCost(loadGameData(overlay({ 'island.tileRule.cardsPerCrate': 3 })))).toBe(6);
    expect(deliveryCost(loadGameData(overlay({ 'island.tileRule.crates': 3 })))).toBe(6);
    expect(deliveryCost(BASE_GAME_DATA)).toBe(4);
  });

  // The VP schedule is also the capacity rule, so there is no second number to
  // drift out of step with it. This is the invariant that replaces one.
  it('reads capacity off the VP schedule, so a tile can never pay a receipt it has no room for', () => {
    expect(deliveriesPerTile(BASE_GAME_DATA)).toBe(BASE_GAME_DATA.island.vpByDeliveryOrder.length);
    expect(BASE_GAME_DATA.island.vpByDeliveryOrder).toEqual([6, 3]);
    expect(deliveryVp(BASE_GAME_DATA, 0)).toBe(6);
    expect(deliveryVp(BASE_GAME_DATA, 1)).toBe(3);
    // Past the end: no VP, which is the same condition as no room.
    expect(deliveryVp(BASE_GAME_DATA, 2)).toBe(0);
    // Descending, or arriving first is not worth racing for.
    const vp = BASE_GAME_DATA.island.vpByDeliveryOrder;
    for (let i = 1; i < vp.length; i++) expect(vp[i]!).toBeLessThan(vp[i - 1]!);
  });

  it('names a level-3 tile for every seat count', () => {
    for (const seats of ['2', '3', '4']) {
      const named = BASE_GAME_DATA.island.levelThreeTilesBySeats[seats] ?? [];
      expect(named.length, seats).toBe(BASE_GAME_DATA.island.slotsBySeats[seats]?.['3']);
      for (const id of named) {
        expect(
          BASE_GAME_DATA.island.tiles.find((t) => t.id === id),
          id,
        ).toBeDefined();
      }
    }
  });

  it('gives the demand-token pool one token per crate in play', () => {
    for (const seats of ['2', '3', '4']) {
      const slots = BASE_GAME_DATA.island.slotsBySeats[seats];
      const pool = BASE_GAME_DATA.island.demandTokensBySeats[seats];
      if (!slots || !pool) throw new Error(`no data for ${seats} seats`);
      const tiles = ([1, 2, 3] as const).reduce((n, row) => n + (slots[String(row)] ?? 0), 0);
      const crates = tiles * BASE_GAME_DATA.island.tileRule.crates;
      expect(pool.crates, `${seats} seats`).toBe(crates);
      expect(pool.suits * pool.perSuit + pool.wild, `${seats} seats pool size`).toBe(crates);
    }
  });
});

describe('the Hired Workers', () => {
  it('has one Worker per core action', () => {
    const actions = BASE_GAME_DATA.workers.roster.map((w) => w.action).sort();
    expect(actions).toEqual(['build', 'deliver', 'draw', 'harvest', 'sow']);
  });

  it('gives the Draw Worker the shortest track, its only brake', () => {
    const tracks = new Map(BASE_GAME_DATA.workers.roster.map((w) => [w.id, w.wages.length]));
    const draw = tracks.get('draw');
    expect(draw).toBe(2);
    for (const [id, length] of tracks) {
      if (id !== 'draw') expect(length, id).toBeGreaterThan(draw!);
    }
  });

  it('keeps the Draw Worker over-delivering against a plain Draw', () => {
    // A rental is paid with a card. Keep must exceed the 1 card a plain Draw
    // keeps, or renting it is net zero and the Worker is pointless.
    const draw = BASE_GAME_DATA.workers.roster.find((w) => w.id === 'draw');
    expect(draw?.draw?.keep ?? 0).toBeGreaterThan(1);
    expect(draw?.draw?.see ?? 0).toBeGreaterThan(draw?.draw?.keep ?? 0);
  });
});

describe('the knob registry', () => {
  it('has no dead templates', () => {
    expect(deadTemplates(BASE_GAME_DATA)).toEqual([]);
  });

  it('addresses only leaves that exist', () => {
    const leaves = flatten(BASE_GAME_DATA);
    for (const knob of listKnobs(BASE_GAME_DATA)) {
      expect(leaves.has(knob.path), knob.path).toBe(true);
    }
  });

  it('gives each card its own knobs', () => {
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('cards.catalogue.W7.threshold');
    expect(knobs).toContain('cards.catalogue.W7.buildCost.suit');
    expect(knobs).toContain('cards.catalogue.W7.enabled');
    // Barn faces print a hand size; Farmstead faces do not, so no knob exists.
    expect(knobs).toContain('cards.catalogue.W1.faces.starter.handSize');
    expect(knobs).not.toContain('cards.catalogue.W2.faces.starter.handSize');
  });

  it('offers no way to change printed wording', () => {
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs.filter((p) => /\.(name|abilityText|actionText|rewardText)$/.test(p))).toEqual([]);
    expect(KNOB_TEMPLATES.some((t) => (t.type as string) === 'string')).toBe(false);
  });

  it('skips meta blocks, so prose never buries a real path', () => {
    expect([...flatten(BASE_GAME_DATA).keys()].some((p) => p.includes('.meta.'))).toBe(false);
  });
});

describe('applying an overlay', () => {
  it('replaces a leaf and leaves the rest alone', () => {
    const cheap = loadGameData(overlay({ 'workers.hireFee': 1 }));
    expect(cheap.workers.hireFee).toBe(1);
    expect(cheap.workers.maxPerPlayer).toBe(BASE_GAME_DATA.workers.maxPerPlayer);
    expect(BASE_GAME_DATA.workers.hireFee).toBe(2);
  });

  it('replaces an array whole rather than merging it', () => {
    const shortened = loadGameData(overlay({ 'workers.roster.harvest.wages': [1, 2] }));
    expect(shortened.workers.roster.find((w) => w.id === 'harvest')?.wages).toEqual([1, 2]);
  });

  it('switches a card out', () => {
    const withoutBreadHall = loadGameData(overlay({ 'cards.catalogue.W21.enabled': false }));
    expect(activeCards(withoutBreadHall)).toHaveLength(104);
    expect(activeCards(withoutBreadHall).some((c) => c.id === 'W21')).toBe(false);
  });

  it('accepts null where a knob nulls out a rule', () => {
    // The base rule is already null (ticket 37), so the null case is asserted
    // against the shipped data and the overlay proves the knob can put it back.
    expect(BASE_GAME_DATA.rules.economy.coinPityDivisor).toBeNull();
    const withPity = loadGameData(overlay({ 'rules.economy.coinPityDivisor': 5 }));
    expect(withPity.rules.economy.coinPityDivisor).toBe(5);
    const noPity = loadGameData(overlay({ 'rules.economy.coinPityDivisor': null }));
    expect(noPity.rules.economy.coinPityDivisor).toBeNull();
  });

  it('rejects an unknown path rather than silently doing nothing', () => {
    expect(() => validateOverlay(overlay({ 'workers.hireCost': 1 }), BASE_GAME_DATA)).toThrow(
      OverlayError,
    );
  });

  it('rejects a card the extract no longer has', () => {
    expect(() =>
      validateOverlay(overlay({ 'cards.catalogue.W99.threshold': 3 }), BASE_GAME_DATA),
    ).toThrow(/W99/);
  });

  it('rejects an attempt to override card text, and says why', () => {
    expect(() =>
      validateOverlay(overlay({ 'cards.catalogue.W7.abilityText': 'anything' }), BASE_GAME_DATA),
    ).toThrow(/single source of truth/);
  });

  it('rejects a type mismatch', () => {
    expect(() => validateOverlay(overlay({ 'workers.hireFee': 1.5 }), BASE_GAME_DATA)).toThrow(
      /is int/,
    );
  });

  it('rejects a stale schema version', () => {
    const stale: Overlay = { name: 'old', schemaVersion: 0, set: {} };
    expect(() => validateOverlay(stale, BASE_GAME_DATA)).toThrow(/schemaVersion/);
  });

  it('collects every problem in one throw', () => {
    let message = '';
    try {
      validateOverlay(overlay({ 'workers.nope': 1, 'island.nope': 2 }), BASE_GAME_DATA);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('workers.nope');
    expect(message).toContain('island.nope');
    expect(message).toContain('2 problem(s)');
  });

  it('does not mutate the data it was given', () => {
    const before = JSON.stringify(BASE_GAME_DATA.workers);
    applyOverlay(BASE_GAME_DATA, overlay({ 'workers.hireFee': 4 }));
    expect(JSON.stringify(BASE_GAME_DATA.workers)).toBe(before);
  });
});

describe('sweeps', () => {
  const sweep = (file: Partial<SweepFile>): SweepFile => ({
    name: 'sweep',
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    sweep: [],
    ...file,
  });

  it('turns twenty hire prices into twenty overlays from one file', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const cells = expandSweep(sweep({ sweep: [{ knob: 'workers.hireFee', values }] }));
    expect(cells).toHaveLength(20);
    expect(cells[0]?.overlay.set['workers.hireFee']).toBe(1);
    expect(cells[19]?.overlay.set['workers.hireFee']).toBe(20);
    expect(cells[19]?.label).toBe('workers.hireFee=20');
  });

  it('takes the cross product of several axes', () => {
    const cells = expandSweep(
      sweep({
        sweep: [
          { knob: 'workers.hireFee', values: [1, 2, 3] },
          { knob: 'rules.economy.visitPayout.base', values: [1, 2] },
        ],
      }),
    );
    expect(cells).toHaveLength(6);
    expect(new Set(cells.map((c) => c.label)).size).toBe(6);
  });

  it('applies the base set under every cell', () => {
    const cells = expandSweep(
      sweep({
        base: { 'rules.setup.startingCoins': 3 },
        sweep: [{ knob: 'workers.hireFee', values: [1, 2] }],
      }),
    );
    expect(cells.every((c) => c.overlay.set['rules.setup.startingCoins'] === 3)).toBe(true);
  });

  it('produces overlays that validate and apply', () => {
    for (const cell of expandSweep(
      sweep({ sweep: [{ knob: 'workers.hireFee', values: [1, 5] }] }),
    )) {
      expect(loadGameData(cell.overlay).workers.hireFee).toBe(cell.overlay.set['workers.hireFee']);
    }
  });

  it('refuses a sweep that quietly asks for too many runs', () => {
    const values = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(() =>
      expandSweep(
        sweep({
          sweep: [
            { knob: 'workers.hireFee', values },
            { knob: 'rules.setup.startingCoins', values },
          ],
        }),
      ),
    ).toThrow(/1600 cells/);
  });

  it('refuses an empty axis', () => {
    expect(() => expandSweep(sweep({ sweep: [{ knob: 'workers.hireFee', values: [] }] }))).toThrow(
      /no values/,
    );
  });
});
