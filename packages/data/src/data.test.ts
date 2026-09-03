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
  SUITS,
  activeCards,
  applyOverlay,
  deadTemplates,
  deliveriesPerTile,
  deliveryCost,
  deliveryVp,
  doorForSuit,
  expandSweep,
  flatten,
  listKnobs,
  loadGameData,
  meepleAction,
  meeplesDealt,
  validateOverlay,
} from './index.js';
import type { Overlay, SweepFile } from './index.js';

const overlay = (set: Overlay['set'], name = 'test'): Overlay => ({
  name,
  schemaVersion: OVERLAY_SCHEMA_VERSION,
  set,
});

describe('the extract', () => {
  // 105, not 110. The five SERVICE starters used to be synthesised into the
  // catalogue; the door merged into the Notice Board (change 6, 20/08/2026), so
  // the catalogue is now exactly the sheet - 15 starters (Barn, Farmstead,
  // Notice Board) and 90 deck cards.
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

  // ⭐ v31: starters print ONE face. `faces`, `handSize` and `upgradeCostCoins`
  // left the schema together with the upgrade layer, and a re-extract that
  // brought any of them back would silently restore a rule the game does not
  // have. Assert on the shape, not on a version number.
  it('prints one face per card, with no upgrade layer left anywhere', () => {
    for (const card of BASE_GAME_DATA.cards.catalogue) {
      const shape = card as unknown as Record<string, unknown>;
      expect(shape['faces'], card.id).toBeUndefined();
      expect(shape['handSize'], card.id).toBeUndefined();
      expect(shape['upgradeCostCoins'], card.id).toBeUndefined();
    }
  });

  it('prints 0 VP on all fifteen starters', () => {
    for (const card of BASE_GAME_DATA.cards.catalogue.filter((c) => c.type === 'starter')) {
      expect(card.printedVp, card.id).toBe(0);
    }
  });

  // The Barn is the one card in the game that prints nothing at all. It stopped
  // printing a hand size in v31 (there is no hand limit) and its build rider was
  // deleted rather than moved, so an empty string here is the correct state and
  // any text arriving in it is a card change nobody declared.
  it('leaves every Barn blank', () => {
    const barns = BASE_GAME_DATA.cards.catalogue.filter((c) => c.slot === 'barn');
    expect(barns).toHaveLength(5);
    for (const barn of barns) expect(barn.abilityText, barn.id).toBe('');
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
      // A positive integer, not a fixed 1: the authored files bump when their
      // shape changes incompatibly (island.json went to 2 for the flat island
      // and to 3 for the meeples; rules, workers and aerodrome went to 2 for
      // v31). Nothing reads the number - it is a signal to whoever opens the
      // file, and a file whose shape breaks should say so rather than keep a
      // stamp that no longer means anything.
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

// ⭐ THE v31 DRIFT GUARD, and the most valuable test in this file for the next
// few months. Coins were removed from the game on 02/09/2026, and the way they
// come back is not a decision - it is one key surviving a merge, or an old
// overlay being restored, or a re-extract from a sheet that still prints a coin
// icon. So assert on the whole tree rather than on a list of known keys.
describe('there are no coins', () => {
  const COIN = /coin/i;

  // Two paths are allowed to say "coin" and neither is a currency:
  //  - island.tileRule.coinsPerDelivery is a TOMBSTONE pinned at 0, kept because
  //    the v31 plan named the key rather than deleting it;
  //  - the magenta balloon keeps the id `balloonCoins` on purpose, because V19
  //    The Sky Market scores by balloon COUNT and a rename would have to be
  //    chased through the handler, the art and the reports for no gain.
  // Anything else matching is a currency creeping back in.
  const BALLOON_ID = 'aerodrome.balloons.balloonCoins.';

  it('names no coin anywhere in the data, bar two declared tombstones', () => {
    const offenders = [...flatten(BASE_GAME_DATA).keys()]
      .filter((path) => COIN.test(path))
      .filter((path) => !path.startsWith(BALLOON_ID))
      .sort();
    expect(offenders).toEqual(['island.tileRule.coinsPerDelivery']);
    expect(BASE_GAME_DATA.island.tileRule.coinsPerDelivery).toBe(0);
    // And the balloon that keeps the name has stopped paying money.
    expect(
      BASE_GAME_DATA.aerodrome.balloons.find((b) => b.id === 'balloonCoins')?.reward.type,
    ).toBe('harvestAny');
  });

  it('offers no knob that could mint one', () => {
    expect(KNOB_TEMPLATES.filter((t) => COIN.test(t.template))).toEqual([]);
  });

  it('prices no build in coins', () => {
    for (const card of BASE_GAME_DATA.cards.catalogue) {
      if (!card.buildCost) continue;
      expect(Object.keys(card.buildCost).sort(), card.id).toEqual(['suit', 'wild']);
    }
  });
});

describe('the turn', () => {
  // Draw 2, keep both. The discard was the last piece of hidden bookkeeping in
  // the core five actions and v31 deleted it; `keep` below `see` would restore
  // it silently.
  it('keeps every card a plain Draw reveals', () => {
    const { see, keep } = BASE_GAME_DATA.rules.turn.baseDraw;
    expect(see).toBe(2);
    expect(keep).toBe(see);
  });

  it('starts a seat with four cards and an empty barn', () => {
    expect(BASE_GAME_DATA.rules.setup.startingHand).toBe(4);
    expect(BASE_GAME_DATA.rules.setup.startingBarnCards).toBe(0);
  });

  it('arms the self-visit, which is risk 2 and must be visible in the data', () => {
    expect(BASE_GAME_DATA.rules.turn.selfVisitAllowed).toBe(true);
    const solitaire = loadGameData(overlay({ 'rules.turn.selfVisitAllowed': false }));
    expect(solitaire.rules.turn.selfVisitAllowed).toBe(false);
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

describe('the meeples', () => {
  // poolSize is stored rather than derived precisely so that an overlay moving
  // perColour has to move it too. This assertion is the whole reason it is not
  // a computed getter: half-changing the bag fails here rather than in a run.
  it('keeps the stated pool size and the composition in agreement', () => {
    const { perColour, colours, poolSize } = BASE_GAME_DATA.island.meeples;
    expect(poolSize).toBe(perColour * colours.length);
    expect([...colours].sort()).toEqual([...SUITS].sort());
  });

  // The bag is dealt from all five colours whatever the seat count, because a
  // meeple's action exists whether or not its suit is at the table. That is a
  // ruling, and it is the reason `colours` is not derived from the decks in play.
  it('deals from all five colours regardless of the decks in play', () => {
    expect(BASE_GAME_DATA.island.meeples.colours).toHaveLength(5);
    for (const colour of BASE_GAME_DATA.island.meeples.colours) {
      expect(meepleAction(BASE_GAME_DATA, colour), colour).toBeDefined();
    }
  });

  // 12 / 18 / 24 against a bag of 25. The 4-seat board draws 24 of 25, which is
  // why its colour mix is near-deterministic and the 2-seat one is not - see the
  // note in island.json and overlays/meeple-pool-deep-v1.overlay.json.
  it('has a bag deep enough for the biggest board', () => {
    expect(meeplesDealt(BASE_GAME_DATA, 2)).toBe(12);
    expect(meeplesDealt(BASE_GAME_DATA, 3)).toBe(18);
    expect(meeplesDealt(BASE_GAME_DATA, 4)).toBe(24);
    for (const seats of [2, 3, 4]) {
      expect(meeplesDealt(BASE_GAME_DATA, seats), `${seats} seats`).toBeLessThanOrEqual(
        BASE_GAME_DATA.island.meeples.poolSize,
      );
    }
  });

  it('seeds one meeple per delivery space, face up', () => {
    expect(BASE_GAME_DATA.island.meeples.perDeliverySpace).toBe(1);
    expect(BASE_GAME_DATA.island.meeples.faceUpAtSetup).toBe(true);
  });
});

describe('the five doors', () => {
  it('has one door per core action', () => {
    const actions = BASE_GAME_DATA.workers.roster.map((w) => w.action).sort();
    expect(actions).toEqual(['build', 'deliver', 'draw', 'harvest', 'sow']);
  });

  it('gives every suit exactly one door, and every door one suit', () => {
    const suits = BASE_GAME_DATA.workers.roster.map((w) => w.linkedSuit).sort();
    expect(suits).toEqual([...BASE_GAME_DATA.cards.suits].sort());
    for (const suit of BASE_GAME_DATA.cards.suits) {
      expect(doorForSuit(BASE_GAME_DATA, suit), suit).toBeDefined();
    }
  });

  // There is no Service CARD and nothing may synthesise one back. The door lives
  // on a Notice Board, which is a real extracted row with a real printed
  // threshold, and it is never a Grow target - guarded by its SLOT rather than
  // by a null activation type, because the Board prints `wild` (it takes any
  // crop as a visit fee).
  it('has no Service card, and every door is a Notice Board', () => {
    expect(
      BASE_GAME_DATA.cards.catalogue.filter((c) => (c.slot as string | undefined) === 'service'),
    ).toHaveLength(0);
    for (const door of BASE_GAME_DATA.workers.roster) {
      const board = BASE_GAME_DATA.cards.catalogue.find(
        (c) => c.suit === door.linkedSuit && c.slot === 'noticeboard',
      );
      expect(board, door.id).toBeDefined();
      expect(board?.threshold, door.id).toBeGreaterThan(0);
      expect(board?.activationType, door.id).toBe('wild');
      expect(board?.slot, door.id).toBe('noticeboard');
    }
  });

  // ⭐ THE ONE EXCEPTION, AND THE REASON IT EXISTS. A visitor pays 1 card, and
  // the bonus slot's other option is a free Draw of `bonusDraw`. A door that
  // nets no more than the free option is strictly worse than its own
  // alternative and takes no traffic. Draw 3 nets +2 against the free +1.
  it('keeps the Orchard door card-POSITIVE against the free bonus draw', () => {
    const door = BASE_GAME_DATA.workers.roster.find((w) => w.id === 'draw');
    const fee = 1;
    const net = (door?.draw?.keep ?? 0) - fee;
    expect(net).toBeGreaterThan(BASE_GAME_DATA.rules.turn.bonusDraw);
    // See can equal keep (a plain draw); it may never be less.
    expect(door?.draw?.see ?? 0).toBeGreaterThanOrEqual(door?.draw?.keep ?? 0);
  });

  // The other four doors are PLAIN. Every enhancement went in v31, because the
  // bonus slot itself became the enhancement, and a rider quietly reappearing
  // here is a design change nobody declared.
  it('carries no enhancement on any door but the Orchard one', () => {
    for (const door of BASE_GAME_DATA.workers.roster) {
      const shape = door as unknown as Record<string, unknown>;
      expect(shape['relaxedMin'], door.id).toBeUndefined();
      expect(shape['handToBarn'], door.id).toBeUndefined();
      expect(shape['build'], door.id).toBeUndefined();
      if (door.id !== 'draw') expect(shape['draw'], door.id).toBeUndefined();
    }
  });

  // Ruled knowingly (02/09/2026) and recorded as the weakest door on the table:
  // the visitor pays a card onto the board and a second into the sow. If this
  // ever goes back to 'deck', it is the fix being applied and not a typo.
  it('sows the Apiary door from the hand', () => {
    const sow = BASE_GAME_DATA.workers.roster.find((w) => w.id === 'sow');
    expect(sow?.sow).toEqual({ amount: 1, from: 'hand' });
  });
});

describe('the aerodrome', () => {
  it('gives the magenta balloon a harvest instead of coins, keeping its id for V19', () => {
    const balloon = BASE_GAME_DATA.aerodrome.balloons.find((b) => b.id === 'balloonCoins');
    expect(balloon?.reward.type).toBe('harvestAny');
    // A permission has no size. An `amount` appearing here means somebody has
    // quietly turned it back into a quantity.
    expect(balloon?.reward.amount).toBeUndefined();
    expect(BASE_GAME_DATA.aerodrome.balloons).toHaveLength(4);
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

  it('gives each card its own knobs, one path shorter than it used to be', () => {
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('cards.catalogue.W7.threshold');
    expect(knobs).toContain('cards.catalogue.W7.buildCost.suit');
    expect(knobs).toContain('cards.catalogue.W7.enabled');
    // The Notice Board's threshold is now an ordinary card knob with no face
    // segment, because starters are single-faced.
    expect(knobs).toContain('cards.catalogue.W3.threshold');
    expect(knobs.some((p) => p.includes('.faces.'))).toBe(false);
  });

  it('exposes the levers v31 introduced', () => {
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    for (const path of [
      'rules.turn.bonusDraw',
      'rules.turn.selfVisitAllowed',
      'rules.economy.noticeBoardThreshold',
      'rules.endGame.deliveriesToTrigger',
      'rules.setup.startingHand',
      'island.meeples.perColour',
      'island.meeples.poolSize',
      'workers.roster.draw.draw.keep',
    ]) {
      expect(knobs, path).toContain(path);
    }
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
    const loose = loadGameData(overlay({ 'rules.economy.noticeBoardThreshold': 4 }));
    expect(loose.rules.economy.noticeBoardThreshold).toBe(4);
    expect(loose.rules.turn.bonusDraw).toBe(BASE_GAME_DATA.rules.turn.bonusDraw);
    expect(BASE_GAME_DATA.rules.economy.noticeBoardThreshold).toBe(2);
  });

  it("reaches the door's threshold on the Notice Board's printed face", () => {
    const tight = loadGameData(overlay({ 'cards.catalogue.W3.threshold': 3 }));
    expect(tight.cards.catalogue.find((c) => c.id === 'W3')?.threshold).toBe(3);
    expect(BASE_GAME_DATA.cards.catalogue.find((c) => c.id === 'W3')?.threshold).not.toBe(3);
  });

  it('switches a card out', () => {
    const withoutBreadHall = loadGameData(overlay({ 'cards.catalogue.W21.enabled': false }));
    expect(activeCards(withoutBreadHall)).toHaveLength(104);
    expect(activeCards(withoutBreadHall).some((c) => c.id === 'W21')).toBe(false);
  });

  it('accepts null where a knob nulls out a rule', () => {
    // The wild substitution is the surviving intOrNull rule switch: null
    // restores exact matching at the island, which is its control arm.
    expect(BASE_GAME_DATA.island.cardsPerSubstitution).toBe(2);
    const exact = loadGameData(overlay({ 'island.cardsPerSubstitution': null }));
    expect(exact.island.cardsPerSubstitution).toBeNull();
    const loose = loadGameData(overlay({ 'island.cardsPerSubstitution': 3 }));
    expect(loose.island.cardsPerSubstitution).toBe(3);
  });

  it('rejects an unknown path rather than silently doing nothing', () => {
    expect(() => validateOverlay(overlay({ 'workers.hireCost': 1 }), BASE_GAME_DATA)).toThrow(
      OverlayError,
    );
  });

  // Every one of these was a real knob before 02/09/2026. An old overlay that
  // still names one must fail loudly, because applying it silently would measure
  // a game that no longer exists.
  it('rejects every knob v31 deleted', () => {
    for (const path of [
      'rules.setup.startingCoins',
      'rules.turn.buyCost',
      'rules.turn.marketCost',
      'rules.turn.upgradeIsBonus',
      'rules.economy.upgradeCostCoins',
      'rules.economy.coinPityDivisor',
      'rules.economy.visitPayout.base',
      'rules.economy.giftDiscardCoins',
      'workers.serviceThreshold',
      'workers.ownerActivationCost',
      'workers.visitWage',
      'workers.roster.deliver.handToBarn',
    ]) {
      expect(() => validateOverlay(overlay({ [path]: 1 }), BASE_GAME_DATA), path).toThrow(
        OverlayError,
      );
    }
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
    expect(() => validateOverlay(overlay({ 'rules.turn.bonusDraw': 1.5 }), BASE_GAME_DATA)).toThrow(
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
    applyOverlay(BASE_GAME_DATA, overlay({ 'workers.roster.draw.draw.keep': 4 }));
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

  it('turns twenty end triggers into twenty overlays from one file', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const cells = expandSweep(
      sweep({ sweep: [{ knob: 'rules.endGame.deliveriesToTrigger', values }] }),
    );
    expect(cells).toHaveLength(20);
    expect(cells[0]?.overlay.set['rules.endGame.deliveriesToTrigger']).toBe(1);
    expect(cells[19]?.overlay.set['rules.endGame.deliveriesToTrigger']).toBe(20);
    expect(cells[19]?.label).toBe('rules.endGame.deliveriesToTrigger=20');
  });

  it('takes the cross product of several axes', () => {
    const cells = expandSweep(
      sweep({
        sweep: [
          { knob: 'rules.endGame.deliveriesToTrigger', values: [5, 6, 7] },
          { knob: 'rules.turn.bonusDraw', values: [1, 2] },
        ],
      }),
    );
    expect(cells).toHaveLength(6);
    expect(new Set(cells.map((c) => c.label)).size).toBe(6);
  });

  it('applies the base set under every cell', () => {
    const cells = expandSweep(
      sweep({
        base: { 'rules.setup.startingHand': 3 },
        sweep: [{ knob: 'rules.turn.bonusDraw', values: [1, 2] }],
      }),
    );
    expect(cells.every((c) => c.overlay.set['rules.setup.startingHand'] === 3)).toBe(true);
  });

  it('produces overlays that validate and apply', () => {
    for (const cell of expandSweep(
      sweep({ sweep: [{ knob: 'island.meeples.perColour', values: [4, 6] }] }),
    )) {
      expect(loadGameData(cell.overlay).island.meeples.perColour).toBe(
        cell.overlay.set['island.meeples.perColour'],
      );
    }
  });

  it('refuses a sweep that quietly asks for too many runs', () => {
    const values = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(() =>
      expandSweep(
        sweep({
          sweep: [
            { knob: 'rules.endGame.deliveriesToTrigger', values },
            { knob: 'rules.setup.startingHand', values },
          ],
        }),
      ),
    ).toThrow(/1600 cells/);
  });

  it('refuses an empty axis', () => {
    expect(() =>
      expandSweep(sweep({ sweep: [{ knob: 'rules.turn.bonusDraw', values: [] }] })),
    ).toThrow(/no values/);
  });
});
