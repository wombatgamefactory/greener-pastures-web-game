/**
 * These tests are the drift guard.
 *
 * The sheet lives outside this repo and moves without warning, and the knob
 * registry names paths that a re-extract could delete. Both failure modes are
 * silent: the game still runs, it just runs on numbers nobody chose. Every test
 * here exists to make one of those loud.
 */

import { describe, expect, it } from 'vitest';

/**
 * ⭐ THE COMMITTED OVERLAYS, IMPORTED RATHER THAN RESTATED INLINE (10/09/2026),
 * for the reason `packages/sim/src/fixtures.test.ts` records at length: A COPY
 * OF A PIN STOPS BEING A PIN THE MOMENT THE DEFAULT MOVES UNDER IT. An arm
 * asserted from an inline copy of its own overlay would pass while the file on
 * disk had silently stopped being that arm, which is exactly what
 * `rules.economy.noticeBoardThreshold` did to the v31 control on this pass.
 *
 * ⛔ IMPORTED AND NOT READ FROM DISK, WHICH IS NOT A STYLE CHOICE. This package
 * is platform-free by construction - `types: []` in its tsconfig, and every JSON
 * file is imported rather than loaded - so that the browser UI and Node get the
 * same bytes with no loader to keep in sync. `packages/sim` reads the same
 * folder with `node:fs` because it is a Node program; this one may not, and a
 * test reaching for `node:fs` would be the first crack in that.
 */
import v31Json from '../../../overlays/v31-card-visit.overlay.json' with { type: 'json' };
import armJson from '../../../overlays/notice-board-visit-v1.overlay.json' with { type: 'json' };
import noSelfJson from '../../../overlays/notice-board-visit-no-self-v1.overlay.json' with { type: 'json' };
import blockingJson from '../../../overlays/notice-board-visit-blocking-v1.overlay.json' with { type: 'json' };
import threshold2Json from '../../../overlays/notice-board-visit-threshold-2-v1.overlay.json' with { type: 'json' };
import threshold4Json from '../../../overlays/notice-board-visit-threshold-4-v1.overlay.json' with { type: 'json' };
import twoBoardsJson from '../../../overlays/notice-board-visit-two-boards-v1.overlay.json' with { type: 'json' };
import hostDrawJson from '../../../overlays/notice-board-visit-host-draw-v1.overlay.json' with { type: 'json' };

import {
  BASE_GAME_DATA,
  KNOB_TEMPLATES,
  OVERLAY_SCHEMA_VERSION,
  OverlayError,
  SUITS,
  activeCards,
  applyOverlay,
  deadTemplates,
  cardsPerToken,
  dairyDiscount,
  deliveryCost,
  demandShortfall,
  doorActionForSuit,
  doorForSuit,
  expandSweep,
  flatten,
  hostDrawOnVisit,
  isMeepleCurrency,
  isNoticeBoardPower,
  listKnobs,
  loadGameData,
  meepleAction,
  meepleSpendDistinctColours,
  meepleSpendPerTurn,
  meepleSpendTiming,
  noticeBoardBlocks,
  noticeBoardsPerSeat,
  tileDemand,
  tilesInPlayCount,
  tokenCarriesWorker,
  tokenPoolSize,
  tokensPerTile,
  validateOverlay,
  vegetableWildCards,
  wildTokensAt,
} from './index.js';
import type { Overlay, SweepFile } from './index.js';

const overlay = (set: Overlay['set'], name = 'test'): Overlay => ({
  name,
  schemaVersion: OVERLAY_SCHEMA_VERSION,
  set,
});

/** The committed arm and its four sub-arms, keyed by filename for the report. */
const COMMITTED: Readonly<Record<string, Overlay>> = {
  'notice-board-visit-v1': armJson as unknown as Overlay,
  'notice-board-visit-no-self-v1': noSelfJson as unknown as Overlay,
  'notice-board-visit-blocking-v1': blockingJson as unknown as Overlay,
  'notice-board-visit-threshold-2-v1': threshold2Json as unknown as Overlay,
  'notice-board-visit-threshold-4-v1': threshold4Json as unknown as Overlay,
};

const V31_CONTROL = v31Json as unknown as Overlay;

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

  // Sheet v42: the Barn prints the own-crop scorer (moved off the Farmstead,
  // A105) and the Farmstead prints the six-receipt-slot line and no scoring.
  it('prints the own-crop scorer on every Barn and no scoring on any Farmstead', () => {
    const barns = BASE_GAME_DATA.cards.catalogue.filter((c) => c.slot === 'barn');
    expect(barns).toHaveLength(5);
    for (const barn of barns) {
      const crop = barn.suit.charAt(0).toUpperCase() + barn.suit.slice(1);
      const scorer = `Game end: 1 VP for each ${crop} card you have built.`;
      expect(barn.abilityText, barn.id).toBe(scorer);
    }
    const farmsteads = BASE_GAME_DATA.cards.catalogue.filter((c) => c.slot === 'farmstead');
    expect(farmsteads).toHaveLength(5);
    for (const farmstead of farmsteads) {
      expect(farmstead.abilityText, farmstead.id).toMatch(/Receipts/);
      expect(farmstead.abilityText, farmstead.id).not.toMatch(/VP/);
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
      // A positive integer, not a fixed 1: the authored files bump when their
      // shape changes incompatibly (island.json went to 2 for the flat island
      // and to 3 for the meeples; rules and workers went to 2 for
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

// ⭐ THE v31 DRIFT GUARD.
//
// Coins were removed from the game on 02/09/2026 (v31), came back as two arms
// (the commons coins of 10/09/2026 and the Village Store of 12/09/2026) and were
// deleted again with both (13/09/2026 and 16/09/2026, Dean). The way they come
// back is not a decision - it is one key surviving a merge, or an old overlay
// being restored, or a re-extract from a sheet that still prints a coin icon. So
// this asserts on the WHOLE TREE rather than on a list of known keys. Every coin
// economy in this project died of a SECOND FAUCET or a PITY RATE, and each of
// those arrived as an addition nobody re-derived the arithmetic for.
describe('there are no coins', () => {
  const COIN = /coin/i;

  // Listed LITERALLY: the one survivor is a tombstone pinned at 0.
  it('names no coin anywhere in the data, bar the tombstone', () => {
    const offenders = [...flatten(BASE_GAME_DATA).keys()].filter((path) => COIN.test(path)).sort();
    expect(offenders).toEqual(['island.tileRule.coinsPerDelivery']);
    expect(BASE_GAME_DATA.island.tileRule.coinsPerDelivery).toBe(0);
  });

  it('offers no coin knob', () => {
    expect(KNOB_TEMPLATES.filter((t) => COIN.test(t.template)).map((t) => t.template)).toEqual([]);
  });

  // ⛔ A COIN PRICE MUST NEVER ARRIVE AS A CARD FIELD. `BuildCost` lost its
  // `coins` third with the currency on 02/09/2026; if it came back it would
  // arrive from a re-extract of a sheet nobody had read.
  it('prices no build in coins', () => {
    for (const card of BASE_GAME_DATA.cards.catalogue) {
      if (!card.buildCost) continue;
      expect(Object.keys(card.buildCost).sort(), card.id).toEqual(['suit', 'wild']);
    }
  });

  // ⭐ 16/09/2026 (Dean, R1, R2, R4, R5): the balloons, the Aerodrome, the
  // Village Store, the closing draw and the wild substitution are DELETED, not
  // parked, so every one of their leaves must now fail validation loudly.
  it('rejects every knob of the systems deleted on 16/09/2026', () => {
    expect('aerodrome' in BASE_GAME_DATA).toBe(false);
    for (const [path, value] of [
      ['aerodrome.moveCost.barnCards', 1],
      ['aerodrome.alwaysInPlay', true],
      ['aerodrome.flightMints', true],
      ['rules.turn.closingDrawPerCrate', 1],
      ['island.cardsPerSubstitution', 2],
      ['rules.economy.storeCoinsPerCard', 1],
      ['rules.economy.coinSupplyPerPlayer', 5],
      ['rules.economy.coinPaysBuild', true],
      ['rules.economy.coinPaysSuitCost', true],
      ['rules.economy.coinPaysGrow', true],
      ['rules.economy.coinGrowOnFullBuilding', true],
      ['rules.economy.endgameCoinCost', null],
      ['rules.economy.farmsteadCoinPower', false],
    ] as const) {
      expect(() => validateOverlay(overlay({ [path]: value }), BASE_GAME_DATA), path).toThrow(
        OverlayError,
      );
    }
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs.filter((k) => /aerodrome|balloon|closingDraw|Substitution/i.test(k))).toEqual([]);
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

  // ⭐ 13/09/2026: shipped false since the commons was deleted.
  it('bans the self-visit in the shipped data, and offers it as a knob', () => {
    expect(BASE_GAME_DATA.rules.turn.selfVisitAllowed).toBe(false);
    const self = loadGameData(overlay({ 'rules.turn.selfVisitAllowed': true }));
    expect(self.rules.turn.selfVisitAllowed).toBe(true);
  });
});

/**
 * ⭐ THE SHIPPED GAME SINCE 13/09/2026 (Dean): the commons is dead and its code
 * deleted, and the game is the two-board Notice Board visit with no host draw.
 *
 * These assertions are the passenger guard. The flip moved three leaves -
 * the currency, the self-visit and the two-seat board count - so each control
 * is loaded here as the overlay file loads it and asked which game it is.
 */
describe('the shipped game', () => {
  it('ships the two-board notice-board visit, with every meeple leaf at its no-subject value', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('noticeBoardPower');
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(true);
    expect(isMeepleCurrency(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.turn.selfVisitAllowed).toBe(false);
    expect(BASE_GAME_DATA.rules.economy.noticeBoardsBySeats).toEqual({ '2': 2, '3': 1, '4': 1 });
    expect(BASE_GAME_DATA.rules.turn.hostDrawOnVisit).toBe(0);
    expect(hostDrawOnVisit(BASE_GAME_DATA)).toBe(0);
    expect(BASE_GAME_DATA.rules.turn.bonusTiming).toBe('start');
    expect(BASE_GAME_DATA.rules.turn.startingMeeplesPerColour).toBe(0);
    expect(BASE_GAME_DATA.rules.turn.meepleAsCard).toBe(false);
    expect(BASE_GAME_DATA.rules.turn.slotToll).toBeNull();
    expect(BASE_GAME_DATA.rules.turn.meepleCapPerColour).toBeNull();
    // The limit stays 7, and it is the simulator's bound rather than a rule.
    expect(BASE_GAME_DATA.rules.turn.handLimit).toBe(7);
  });

  // ⛔ THE COMMONS IS DELETED, NOT MERELY OFF: its currency word and every one
  // of its knobs must now fail validation loudly.
  it("rejects 'commons' and every deleted commons knob", () => {
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.visitCurrency': 'commons' }), BASE_GAME_DATA),
    ).toThrow(/visitCurrency/);
    for (const [path, value] of [
      ['rules.turn.commonsTake', 'harvest'],
      ['rules.economy.commonsThreshold', null],
      ['rules.economy.commonsColourMatch', false],
      ['rules.economy.commonsWildPair', false],
      ['rules.economy.commonsHarvestMin', null],
      ['rules.economy.commonsHarvestTake', null],
      ['rules.economy.unclaimedBoardsToCentre', false],
      ['workers.roster.sow.actionUnderCommons', 'grow'],
    ] as const) {
      expect(() => validateOverlay(overlay({ [path]: value }), BASE_GAME_DATA), path).toThrow(
        OverlayError,
      );
    }
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs.filter((k) => /commons|unclaimed/i.test(k))).toEqual([]);
  });

  // ⚠️ THE CONTROLS ARE THE POINT OF THE FLIP. Neither the v31 nor the meeple
  // branch may become unreachable.
  it('leaves both controls reachable', () => {
    const v31 = loadGameData(overlay({ 'rules.turn.visitCurrency': 'card' }, 'v31-card-visit'));
    expect(isNoticeBoardPower(v31)).toBe(false);
    expect(isMeepleCurrency(v31)).toBe(false);

    const loop = loadGameData(overlay({ 'rules.turn.visitCurrency': 'meeple' }, 'meeple-loop-v1'));
    expect(isNoticeBoardPower(loop)).toBe(false);
    expect(isMeepleCurrency(loop)).toBe(true);
  });

  // The Apiary door's commons GROW override went with the commons: every door
  // buys its printed action in every game.
  it('buys every door action as printed', () => {
    for (const suit of ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy']) {
      expect(doorActionForSuit(BASE_GAME_DATA, suit), suit).toBe(
        doorForSuit(BASE_GAME_DATA, suit)?.action,
      );
    }
    expect(doorActionForSuit(BASE_GAME_DATA, 'apiary')).toBe('sow');
  });

  // ⭐ 19/09/2026: the roster's PRINTED SENTENCE must describe what an Apiary
  // Worker actually buys (a GROW, since M7/M8, computed by
  // `meepleActionOf` in packages/engine/src/workers.ts), even though `action`
  // stays `sow` for the reasons workers.json's dated note gives - the two are
  // allowed to differ, but the text a player reads must not lie.
  it("prints the Apiary door's actionText as a Grow, not a Sow", () => {
    const apiary = doorForSuit(BASE_GAME_DATA, 'apiary');
    expect(apiary?.actionText.toLowerCase()).toContain('grow');
    expect(apiary?.actionText.toLowerCase()).not.toContain('sow');
  });

  // ⛔ AND THE OLD NAMES MUST FAIL LOUDLY. A rename is the one registry edit
  // that can break a saved overlay, which is the point of preferring it to a
  // copy: an overlay still naming `farmsteadPower` would otherwise set a number
  // the game has stopped reading and report a baseline as an arm.
  it('rejects the power block under its old name, because a rename must be loud', () => {
    for (const path of [
      'rules.economy.farmsteadPower.orchardDraw',
      'rules.economy.farmsteadPower.dairyDiscount',
      'rules.economy.farmsteadPower.apiaryGrows',
      'rules.economy.farmsteadPower.vegetableDeliveries',
    ]) {
      expect(() => validateOverlay(overlay({ [path]: 2 }), BASE_GAME_DATA), path).toThrow(
        OverlayError,
      );
    }
  });
});

/**
 * ⭐ THE NOTICE BOARD VISIT (Dean, 10/09/2026; THE SHIPPED GAME SINCE 13/09/2026,
 * docs/notice-board-visit-handoff-2026-09-10-v2.md, S1-S16). The centre is
 * deleted, the five Notice Board cards go home to their owners' farms and are
 * buildings again, and the bonus is to play one card onto ANY player's board -
 * your own included - and take that board's printed power.
 *
 * These assertions are the passenger guard for a flip that has not happened.
 * Two of them are about a BASE VALUE that moved without any flip at all:
 * `rules.economy.noticeBoardThreshold` is 3 where it was 2, and the v31 control
 * is the arm that had to pin the old number to stay itself.
 */
describe('the notice board visit', () => {
  // S8: three is the MINIMUM before the owner may harvest, never a maximum, so
  // `noticeBoardBlocks` false is the plus sign in `3+`. The base data carries
  // both, because the arm is one overlay away and neither is a rule of the
  // shipped commons.
  it('ships a threshold of 3 and a board that never blocks', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardThreshold).toBe(3);
    expect(BASE_GAME_DATA.rules.economy.noticeBoardBlocks).toBe(false);
    expect(noticeBoardBlocks(BASE_GAME_DATA)).toBe(false);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.economy.noticeBoardBlocks');

    const clogging = loadGameData(overlay({ 'rules.economy.noticeBoardBlocks': true }));
    expect(clogging.rules.economy.noticeBoardBlocks).toBe(true);
    expect(noticeBoardBlocks(clogging)).toBe(true);
  });

  // ⛔ THE REGRESSION TEST FOR THE ONE PASSENGER THIS PASS CREATED. The base
  // threshold moved 2 to 3 for S8, and under `'card'` the Notice Board is a
  // BLOCKING building whose 2 is the brake on the self-visit and the thing that
  // shuts a farm in two placements. A control that moves is not a control, so
  // the overlay FILE is loaded rather than an inline copy of it.
  it('leaves the v31 control on a Notice Board threshold of 2', () => {
    const v31 = loadGameData(V31_CONTROL);
    expect(v31.rules.economy.noticeBoardThreshold).toBe(2);
    expect(v31.rules.turn.visitCurrency).toBe('card');
  });

  // A fourth game, not a repointing of `'card'`: that control carries a blocking
  // board at 2, the standalone free Draw 1 and the turn-start meeple spend, and
  // none of the three named controls may move under an arm it is read against.
  it("reads 'noticeBoardPower' as its own currency, and still refuses an unknown word", () => {
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(true);

    const arm = loadGameData(
      overlay({ 'rules.turn.visitCurrency': 'noticeBoardPower' }, 'notice-board-visit-v1'),
    );
    expect(isNoticeBoardPower(arm)).toBe(true);
    expect(isMeepleCurrency(arm)).toBe(false);

    // A closed set: a game may never be named by a word nothing dispatches on.
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.visitCurrency': 'noticeboard' }), BASE_GAME_DATA),
    ).toThrow(/visitCurrency/);
  });

  // S12, as amended by rulings C88 (Wheat) and C89 (Apiary) the same evening.
  // Asserted WHOLE rather than key by key: a new one arriving unnoticed is
  // exactly the drift this file exists to make loud.
  //
  // ⭐ 16/09/2026 (R9, R10): `vegetableWildCards` is new and `dairyDiscount`
  // replaces `dairyGrowsBuilt`, so the count moved from seven to eight
  // DELIBERATELY, and the test failing first is the mechanism working.
  //
  // ⭐ 19/09/2026: `wheatHarvestGate` is new, for Dean's Wheat board retext,
  // sheet v44: *"Harvest one of your buildings, even if it is 1 card short of
  // full."* It shipped its FIRST commit at 'loaded' (the pre-existing
  // behaviour ledger C97 flagged, so adding the key alone moved no measured
  // number - eight to nine, deliberately) and RULED IN THE SAME DAY at
  // 'nearFull' - full, or one card from full, which reaches a `3+` Notice
  // Board at 2 cards rather than 1 (⭐⭐ THE NOTICE-BOARD-AT-2 REVERSAL: this
  // is narrower than 'loaded' for ordinary buildings but still reaches the
  // board C97 flagged, so C97 stays open). `wheatBarn` IS RETIRED THE SAME
  // DAY: the new text prints no hand-to-barn clause, so it ships at 0 and
  // survives only for the overlays and testkit helpers that pin 1 to keep
  // replaying the pre-19/09 game (see `packages/engine/src/testkit.ts`).
  it('carries the nine Notice Board power leaves, and offers all nine as knobs', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardPower).toEqual({
      orchardDraw: 4,
      apiarySows: 2,
      apiaryPower: 'deckGrowWild',
      vegetableFallback: 2,
      vegetableWildCards: 2,
      dairyWild: true,
      dairyDiscount: 1,
      wheatBarn: 0,
      wheatHarvestGate: 'nearFull',
    });
    expect(dairyDiscount(BASE_GAME_DATA)).toBe(1);
    expect(vegetableWildCards(BASE_GAME_DATA)).toBe(2);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    for (const key of [
      'orchardDraw',
      'apiarySows',
      'apiaryPower',
      'vegetableFallback',
      'vegetableWildCards',
      'dairyWild',
      'dairyDiscount',
      'wheatBarn',
      'wheatHarvestGate',
    ]) {
      expect(knobs, key).toContain(`rules.economy.noticeBoardPower.${key}`);
    }

    const tuned = loadGameData(
      overlay({
        'rules.economy.noticeBoardPower.orchardDraw': 3,
        'rules.economy.noticeBoardPower.dairyWild': false,
      }),
    );
    expect(tuned.rules.economy.noticeBoardPower.orchardDraw).toBe(3);
    expect(tuned.rules.economy.noticeBoardPower.dairyWild).toBe(false);
    // The Dairy power is a FLAG and not a discount, so a number must not pass.
    expect(() =>
      validateOverlay(overlay({ 'rules.economy.noticeBoardPower.dairyWild': 1 }), BASE_GAME_DATA),
    ).toThrow(/is boolean/);
  });

  // The arm and its four sub-arms, every one read from disk and applied. An
  // overlay that names a knob the data no longer has is caught on the commit
  // that broke it rather than weeks later, in the middle of a run.
  it('loads and validates the arm and all four of its sub-arms', () => {
    for (const [name, loaded] of Object.entries(COMMITTED)) {
      expect(loaded.name, name).toBe(name);
      expect(() => validateOverlay(loaded, BASE_GAME_DATA), name).not.toThrow();
      const data = loadGameData(loaded);
      expect(isNoticeBoardPower(data), name).toBe(true);
      // Every one of them pins the bonus FIRST and the self-visit knob by name,
      // whatever value it sets: an arm that leaves either to the default stops
      // being the arm it is called the next time a default moves.
      expect(loaded.set['rules.turn.bonusTiming'], name).toBe('start');
      expect(loaded.set, name).toHaveProperty('rules.turn.selfVisitAllowed');
    }
  });

  // Each sub-arm is the arm plus exactly ONE changed leaf, which is what makes a
  // pair attributable to a rule. Asserted rather than trusted, because a second
  // change creeping in leaves a delta that is unreadable rather than wrong.
  it('changes exactly one leaf per sub-arm, and pins the rest of the arm beside it', () => {
    const arm = COMMITTED['notice-board-visit-v1']?.set ?? {};
    const oneLeaf: Record<string, [string, unknown]> = {
      'notice-board-visit-no-self-v1': ['rules.turn.selfVisitAllowed', false],
      'notice-board-visit-blocking-v1': ['rules.economy.noticeBoardBlocks', true],
      'notice-board-visit-threshold-2-v1': ['rules.economy.noticeBoardThreshold', 2],
      'notice-board-visit-threshold-4-v1': ['rules.economy.noticeBoardThreshold', 4],
    };
    for (const [name, [path, value]] of Object.entries(oneLeaf)) {
      const set = COMMITTED[name]?.set ?? {};
      expect(Object.keys(set).sort(), name).toEqual(Object.keys(arm).sort());
      expect(set[path], name).toBe(value);
      expect(
        Object.keys(set).filter((k) => JSON.stringify(set[k]) !== JSON.stringify(arm[k])),
        name,
      ).toEqual([path]);
    }
  });
});

/**
 * ⭐ DEAN'S TWO-BOARD FIX (ruled 11/09/2026), AND THE SURGICAL CLAIM THAT MAKES
 * IT READABLE.
 *
 * The arm is `overlays/notice-board-visit-no-self-v1.overlay.json` plus a
 * per-seat-count map that gives each player TWO Notice Boards AT TWO SEATS ONLY.
 * At three and four seats the two overlays are THE SAME RULES, so those columns
 * must reproduce the control on identical seeds and any difference there is a
 * leak rather than a finding.
 *
 * These tests diff the loaded `set` blocks rather than trusting the files to
 * stay that way, for the reason the imports at the top of this file record: A
 * COPY OF A PIN STOPS BEING A PIN THE MOMENT THE DEFAULT MOVES UNDER IT.
 */
describe('the two-board fix', () => {
  const CONTROL = noSelfJson as unknown as Overlay;
  const ARM = twoBoardsJson as unknown as Overlay;

  /**
   * The leaves the arm adds to its control. The control pins
   * `noticeBoardsBySeats.2` at 1 since the default flipped (13/09/2026), so the
   * arm adds only the three- and four-seat entries and CHANGES the two-seat one.
   */
  const NEW_LEAVES = [
    'rules.economy.noticeBoardsBySeats.3',
    'rules.economy.noticeBoardsBySeats.4',
  ] as const;

  // A map and not a boolean, in the `decksInPlayBySeats` idiom, shipped at two
  // boards at two seats since 13/09/2026.
  it('adds a per-seat-count map, ships two boards at two seats, and round-trips', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardsBySeats).toEqual({ '2': 2, '3': 1, '4': 1 });
    expect(noticeBoardsPerSeat(BASE_GAME_DATA, 2)).toBe(2);
    for (const seats of [3, 4]) {
      expect(noticeBoardsPerSeat(BASE_GAME_DATA, seats), String(seats)).toBe(1);
    }

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    for (const seats of [2, 3, 4]) {
      expect(knobs, String(seats)).toContain(`rules.economy.noticeBoardsBySeats.${seats}`);
    }

    const one = loadGameData(overlay({ 'rules.economy.noticeBoardsBySeats.2': 1 }));
    expect(one.rules.economy.noticeBoardsBySeats).toEqual({ '2': 1, '3': 1, '4': 1 });
    expect(noticeBoardsPerSeat(one, 2)).toBe(1);
    const two = BASE_GAME_DATA;
    expect(noticeBoardsPerSeat(two, 3)).toBe(1);
    // A seat count the map does not name falls back to the shipped rule rather
    // than to a guess.
    expect(noticeBoardsPerSeat(two, 1)).toBe(1);

    // A count of boards, so a boolean must not pass: the number of boards is
    // the rule, and "on" would not say how many.
    expect(() =>
      validateOverlay(overlay({ 'rules.economy.noticeBoardsBySeats.2': true }), BASE_GAME_DATA),
    ).toThrow(/is int/);
  });

  // Read from disk and applied, so an overlay naming a knob the data no longer
  // has fails on the commit that broke it rather than in the middle of a run.
  it('loads and validates, and sets two boards at two seats only', () => {
    expect(ARM.name).toBe('notice-board-visit-two-boards-v1');
    expect(() => validateOverlay(ARM, BASE_GAME_DATA)).not.toThrow();

    const data = loadGameData(ARM);
    expect(isNoticeBoardPower(data)).toBe(true);
    expect(data.rules.turn.bonusTiming).toBe('start');
    expect(data.rules.turn.selfVisitAllowed).toBe(false);
    expect(data.rules.economy.noticeBoardsBySeats).toEqual({ '2': 2, '3': 1, '4': 1 });
    expect(noticeBoardsPerSeat(data, 2)).toBe(2);
    expect(noticeBoardsPerSeat(data, 3)).toBe(1);
    expect(noticeBoardsPerSeat(data, 4)).toBe(1);
  });

  // ⭐ THE SURGICAL CLAIM, ASSERTED MECHANICALLY SO IT CANNOT SILENTLY STOP
  // BEING TRUE: the arm is its control plus the new leaves and NOTHING ELSE.
  // Every shared pin agrees, nothing the control pins is dropped, and the only
  // leaves added are the ones that ARE the variant.
  it('differs from its control in exactly the new leaves and nothing else', () => {
    const arm = ARM.set;
    const control = CONTROL.set;

    const added = Object.keys(arm).filter((k) => !(k in control));
    expect(added.sort()).toEqual([...NEW_LEAVES].sort());

    // Nothing is dropped: the arm pins everything the control pins.
    expect(Object.keys(control).filter((k) => !(k in arm))).toEqual([]);

    // And every shared leaf agrees but the two-seat board count.
    expect(
      Object.keys(control).filter((k) => JSON.stringify(control[k]) !== JSON.stringify(arm[k])),
    ).toEqual(['rules.economy.noticeBoardsBySeats.2']);
  });

  // ⭐ AND THE THREE-SEAT AND FOUR-SEAT COLUMNS ARE THE SAME RULES, NOT MERELY
  // SIMILAR ONES. Asserted on the LOADED data rather than on the overlay files,
  // because that is the claim the run depends on: those two columns must
  // reproduce the control on identical seeds, and any difference is a leak.
  it('is rule-for-rule its control at three and four seats', () => {
    const arm = loadGameData(ARM);
    const control = loadGameData(CONTROL);

    for (const seats of [3, 4]) {
      expect(noticeBoardsPerSeat(arm, seats), String(seats)).toBe(
        noticeBoardsPerSeat(control, seats),
      );
    }
    // Two seats is the only place the two games differ at all.
    expect(noticeBoardsPerSeat(arm, 2)).toBe(2);
    expect(noticeBoardsPerSeat(control, 2)).toBe(1);

    // Everything else in the tree is identical, map included once the map is
    // taken out of it: one leaf of difference, and it is the two-seat count.
    const armLeaves = flatten(arm);
    const controlLeaves = flatten(control);
    expect([...armLeaves.keys()]).toEqual([...controlLeaves.keys()]);
    // Compared by VALUE and not by reference: an array leaf (the island's VP
    // schedule, a card's triggers) is a fresh array in each loaded tree, so a
    // reference test would report every one of them as a difference.
    const differing = [...armLeaves.keys()].filter(
      (p) => JSON.stringify(armLeaves.get(p)) !== JSON.stringify(controlLeaves.get(p)),
    );
    expect(differing).toEqual(['rules.economy.noticeBoardsBySeats.2']);
  });
});

/**
 * ⭐ S17, THE HOST DRAW (Dean, ruled 11/09/2026), AND ITS PROVENANCE IS A TABLE
 * RATHER THAN A SIMULATION.
 *
 * Dean played `overlays/notice-board-visit-two-boards-v1.overlay.json` at a
 * two-player table on 11/09/2026 and house-ruled this in during the session:
 * when a neighbour visits you, you draw a card. ⛔ IT AMENDS S7, which said the
 * card left on the board was the payment and there was no other.
 *
 * The arm is that two-board overlay plus EXACTLY ONE LEAF, which is the whole of
 * what makes the pair attributable to this rule. These tests diff the loaded
 * `set` blocks rather than trusting the files to stay that way, for the reason
 * the imports at the top of this file record: A COPY OF A PIN STOPS BEING A PIN
 * THE MOMENT THE DEFAULT MOVES UNDER IT.
 *
 * ⛔ AND NOTHING HERE CAN TEST THE THING DEAN LIKED. The rule's principal
 * effect is more cards in hand and the engine's hand limit of 7 is an instrument
 * bound (C7) while the table plays with none, so a run of this arm answers the
 * rate, the glut, the length, the deliveries and the hook, and answers nothing
 * about whether the game feels less tight.
 */
describe('the host draw on a visit', () => {
  const CONTROL = twoBoardsJson as unknown as Overlay;
  const ARM = hostDrawJson as unknown as Overlay;

  // An INTEGER and not a boolean, so the size can be swept later without another
  // knob, and shipped at 0 so the base game is untouched.
  it('adds one int knob, ships it at 0, and round-trips it through an overlay', () => {
    expect(BASE_GAME_DATA.rules.turn.hostDrawOnVisit).toBe(0);
    expect(hostDrawOnVisit(BASE_GAME_DATA)).toBe(0);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.turn.hostDrawOnVisit');

    const one = loadGameData(overlay({ 'rules.turn.hostDrawOnVisit': 1 }));
    expect(one.rules.turn.hostDrawOnVisit).toBe(1);
    expect(hostDrawOnVisit(one)).toBe(1);

    // A count of cards, so a boolean must not pass: "on" would not say how many,
    // and how many is the thing a later sweep moves.
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.hostDrawOnVisit': true }), BASE_GAME_DATA),
    ).toThrow(/is int/);
  });

  // Read from disk and applied, so an overlay naming a knob the data no longer
  // has fails on the commit that broke it rather than in the middle of a run.
  it('loads and validates, and pays the host one card', () => {
    expect(ARM.name).toBe('notice-board-visit-host-draw-v1');
    expect(() => validateOverlay(ARM, BASE_GAME_DATA)).not.toThrow();

    const data = loadGameData(ARM);
    expect(isNoticeBoardPower(data)).toBe(true);
    expect(data.rules.turn.bonusTiming).toBe('start');
    expect(hostDrawOnVisit(data)).toBe(1);

    // ⛔ AND THE SELF-VISIT IS BANNED ON THE ARM THAT MATTERS. A card drawn
    // for visiting yourself is a pure faucet paid by nobody, so the rule and
    // the ban ship together.
    expect(data.rules.turn.selfVisitAllowed).toBe(false);
    // The two-board map rides along unchanged.
    expect(noticeBoardsPerSeat(data, 2)).toBe(2);
  });

  // ⭐ THE SURGICAL CLAIM, ASSERTED MECHANICALLY SO IT CANNOT SILENTLY STOP
  // BEING TRUE: the arm is its control plus ONE leaf and nothing else. Every
  // shared pin agrees, nothing the control pins is dropped, and the only leaf
  // added is the rule itself.
  it('differs from notice-board-visit-two-boards-v1 in exactly one leaf', () => {
    const arm = ARM.set;
    const control = CONTROL.set;

    const added = Object.keys(arm).filter((k) => !(k in control));
    expect(added).toEqual(['rules.turn.hostDrawOnVisit']);
    expect(arm['rules.turn.hostDrawOnVisit']).toBe(1);

    // Nothing is dropped: the arm pins everything the control pins.
    expect(Object.keys(control).filter((k) => !(k in arm))).toEqual([]);

    // And every shared leaf agrees, so the ONLY difference between the two
    // overlays is the host draw.
    expect(
      Object.keys(control).filter((k) => JSON.stringify(control[k]) !== JSON.stringify(arm[k])),
    ).toEqual([]);
  });

  // ⭐ AND THE SAME CLAIM ON THE LOADED DATA, WHICH IS WHAT THE RUN ACTUALLY
  // READS. Compared by VALUE and not by reference: an array leaf (the island's
  // VP schedule, a card's triggers) is a fresh array in each loaded tree, so a
  // reference test would report every one of them as a difference.
  it('is rule-for-rule its control everywhere but the host draw', () => {
    const armLeaves = flatten(loadGameData(ARM));
    const controlLeaves = flatten(loadGameData(CONTROL));

    expect([...armLeaves.keys()]).toEqual([...controlLeaves.keys()]);
    const differing = [...armLeaves.keys()].filter(
      (p) => JSON.stringify(armLeaves.get(p)) !== JSON.stringify(controlLeaves.get(p)),
    );
    expect(differing).toEqual(['rules.turn.hostDrawOnVisit']);
    expect(controlLeaves.get('rules.turn.hostDrawOnVisit')).toBe(0);
    expect(armLeaves.get('rules.turn.hostDrawOnVisit')).toBe(1);
  });
});

/**
 * ⭐ THE DELIVERY MEEPLE (Dean, 12/09/2026, ledger A151), three spend leaves.
 * Since 16/09/2026 it is the WORKER on the island's 3 and 4 VP tokens, and the
 * seeding leaf (`deliveryMeepleSpace`) and the space choice are deleted.
 *
 * ⛔ TWO OF THE THREE ONCE SHIPPED AT A VALUE THE BUILD HANDOFF GOT WRONG.
 * `meepleSpendTiming` pins `'start'` and not `'none'`, `meepleSpendPerTurn`
 * pins `null` and not `0`: either would delete the v31 control's turn-start
 * meeple spend, which `packages/sim/fixtures/2p-v31-opening.json` replays
 * against.
 */
describe('the delivery meeple', () => {
  it('ships the three spend leaves as ruled, and deletes the seeding and space leaves', () => {
    expect(meepleSpendTiming(BASE_GAME_DATA)).toBe('afterAction');
    expect(meepleSpendPerTurn(BASE_GAME_DATA)).toBe(1);
    expect(meepleSpendDistinctColours(BASE_GAME_DATA)).toBe(false);
    const byPath = new Map(listKnobs(BASE_GAME_DATA).map((k) => [k.path, k.type]));
    const expected: Readonly<Record<string, string>> = {
      'rules.turn.meepleSpendTiming': 'meepleSpendTiming',
      'rules.turn.meepleSpendPerTurn': 'intOrNull',
      'rules.turn.meepleSpendDistinctColours': 'boolean',
    };
    for (const [path, type] of Object.entries(expected)) {
      expect(byPath.get(path), path).toBe(type);
    }
    // ⛔ The deleted leaves fail loudly rather than setting nothing.
    for (const path of ['rules.turn.deliveryMeepleSpace', 'rules.turn.deliverySpaceChoice']) {
      expect(byPath.has(path), path).toBe(false);
      expect(() => validateOverlay(overlay({ [path]: null }), BASE_GAME_DATA), path).toThrow(
        /unknown knob/,
      );
    }
  });

  // ⛔ 'start' IS THE CURRENT BEHAVIOUR AND THEREFORE THE INERT VALUE. 'none'
  // would delete the v31 control's turn-start meeple spend, and a fixture
  // replays against it.
  // ⚠️ 14/09/2026: 'afterAction' SHIPS (Dean ruled the delivery meeple on), and
  // 'start' stays the value every control pins, for the reason above.
  it("ships the meeple spend window at 'afterAction', with 'start' and 'none' reachable", () => {
    expect(meepleSpendTiming(BASE_GAME_DATA)).toBe('afterAction');

    for (const value of ['none', 'start', 'afterAction'] as const) {
      expect(() =>
        validateOverlay(overlay({ 'rules.turn.meepleSpendTiming': value }), BASE_GAME_DATA),
      ).not.toThrow();
    }
    expect(
      meepleSpendTiming(loadGameData(overlay({ 'rules.turn.meepleSpendTiming': 'afterAction' }))),
    ).toBe('afterAction');

    // A closed set, so a fourth timing cannot arrive through an overlay.
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.meepleSpendTiming': 'later' }), BASE_GAME_DATA),
    ).toThrow(/is meepleSpendTiming/);
  });

  // ⛔ null MEANS UNLIMITED, in the idiom of commonsThreshold and
  // meepleCapPerColour. 0 would mean "no spend at all", which is a different
  // rule and would delete a live phase.
  // ⚠️ 14/09/2026: Dean's cap of 1 SHIPS; null stays the controls' pinned value.
  it('caps the meeple spend at 1 as ruled, and keeps C112 as its own leaf', () => {
    expect(meepleSpendPerTurn(BASE_GAME_DATA)).toBe(1);
    expect(meepleSpendDistinctColours(BASE_GAME_DATA)).toBe(false);

    // The rule as Dean ruled it.
    const capped = loadGameData(overlay({ 'rules.turn.meepleSpendPerTurn': 1 }));
    expect(meepleSpendPerTurn(capped)).toBe(1);
    expect(meepleSpendDistinctColours(capped)).toBe(false);

    // The C112 variant, which the cap alone cannot express.
    const distinct = loadGameData(
      overlay({
        'rules.turn.meepleSpendPerTurn': null,
        'rules.turn.meepleSpendDistinctColours': true,
      }),
    );
    expect(meepleSpendPerTurn(distinct)).toBeNull();
    expect(meepleSpendDistinctColours(distinct)).toBe(true);
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

  // ⭐ THE TOKEN ISLAND (16/09/2026): the payment rule in one function. A
  // first delivery pays pair + pair, a second pays pair + 2 any, and a wild
  // token's half is any 2.
  it('prices a delivery off the tokens left on a tile, always 4 cards', () => {
    expect(tokensPerTile(BASE_GAME_DATA)).toBe(2);
    expect(cardsPerToken(BASE_GAME_DATA)).toBe(2);
    const t = (demand: 'wheat' | 'dairy' | 'wild', vp: number) => ({ demand, vp, worker: null });
    expect(tileDemand(BASE_GAME_DATA, [t('wheat', 6), t('dairy', 3)])).toEqual({
      base: { wheat: 2, dairy: 2 },
      any: 0,
    });
    expect(tileDemand(BASE_GAME_DATA, [t('wheat', 6), t('wheat', 4)])).toEqual({
      base: { wheat: 4 },
      any: 0,
    });
    expect(tileDemand(BASE_GAME_DATA, [t('wheat', 6), t('wild', 5)])).toEqual({
      base: { wheat: 2 },
      any: 2,
    });
    // The second delivery: the last token plus the revealed "2 any".
    expect(tileDemand(BASE_GAME_DATA, [t('dairy', 3)])).toEqual({ base: { dairy: 2 }, any: 2 });
    expect(tileDemand(BASE_GAME_DATA, [t('wild', 3)])).toEqual({ base: {}, any: 4 });
    // The shortfall the Vegetable board may cover.
    expect(demandShortfall({ wheat: 2, dairy: 2 }, { wheat: 2, dairy: 2 })).toBe(0);
    expect(demandShortfall({ wheat: 2, dairy: 2 }, { wheat: 1, dairy: 1, apiary: 2 })).toBe(2);
  });

  it('puts a Worker on the 3 and 4 VP tokens only', () => {
    expect(BASE_GAME_DATA.island.tokens.vpValues).toEqual([6, 5, 4, 3]);
    expect([3, 4].map((vp) => tokenCarriesWorker(BASE_GAME_DATA, vp))).toEqual([true, true]);
    expect([5, 6].map((vp) => tokenCarriesWorker(BASE_GAME_DATA, vp))).toEqual([false, false]);
    const none = loadGameData(overlay({ 'island.tokens.workerOnVp': [] }));
    expect(tokenCarriesWorker(none, 3)).toBe(false);
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

  // The seat-scaling table of worksheet `Island`: 6 / 9 / 12 tiles, 12 / 18 /
  // 24 tokens, 3 / 4 / 5 crops, 0 / 2 / 4 wild.
  it('gives the token pool exactly the tokens the tiles hold at every seat count', () => {
    const table: Record<number, [number, number, number]> = {
      2: [6, 12, 0],
      3: [9, 18, 2],
      4: [12, 24, 4],
    };
    for (const [seats, [tiles, tokens, wild]] of Object.entries(table)) {
      const n = Number(seats);
      expect(tilesInPlayCount(BASE_GAME_DATA, n), `${seats} tiles`).toBe(tiles);
      expect(tokenPoolSize(BASE_GAME_DATA, n), `${seats} tokens`).toBe(tokens);
      expect(tiles * tokensPerTile(BASE_GAME_DATA), `${seats} fill`).toBe(tokens);
      expect(wildTokensAt(BASE_GAME_DATA, n), `${seats} wild`).toBe(wild);
      expect(wild, `${seats} wild fits the values`).toBeLessThanOrEqual(
        BASE_GAME_DATA.island.tokens.vpValues.length,
      );
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

  // At most one Worker per token and only the 3 and 4 VP tokens carry one, so
  // the biggest board needs 12 at most, well inside the bag of 25.
  it('has a bag deep enough for every Worker the biggest board can deal', () => {
    const { vpValues, workerOnVp } = BASE_GAME_DATA.island.tokens;
    const carrying = vpValues.filter((vp) => workerOnVp.includes(vp)).length;
    for (const seats of [2, 3, 4]) {
      const crops = BASE_GAME_DATA.island.decksInPlayBySeats[String(seats)] ?? 0;
      const most = crops * carrying + Math.min(wildTokensAt(BASE_GAME_DATA, seats), carrying);
      expect(most, `${seats} seats`).toBeLessThanOrEqual(BASE_GAME_DATA.island.meeples.poolSize);
    }
    expect(BASE_GAME_DATA.rules.turn.startingMeeplesPerColour).toBe(0);
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

  // ⭐ DRAW 2 SINCE 09/09/2026, AND IT IS DEAN'S CHOICE RATHER THAN A
  // CONSEQUENCE (C3). The commons has no free draw for the door to beat, so the
  // self-cancellation law has no subject - but a play still costs a CARD, so
  // Draw 2 nets +1 where every other board hands back a whole action. That is
  // the thinnest return in the set and it is the one contested door number in
  // the game; overlays/commons-draw-three.overlay.json is the arm.
  it('ships the Orchard door as a plain Draw 2', () => {
    const door = BASE_GAME_DATA.workers.roster.find((w) => w.id === 'draw');
    expect(door?.draw).toEqual({ see: 2, keep: 2 });
    // See can equal keep (a plain draw); it may never be less.
    expect(door?.draw?.see ?? 0).toBeGreaterThanOrEqual(door?.draw?.keep ?? 0);
  });

  // The old exception, asserted off the control that still needs it. A v31
  // visitor pays 1 card and the bonus slot's other option is a free Draw of
  // `bonusDraw`, so a door netting no more than the free option is strictly
  // worse than its own alternative and takes no traffic: Draw 3 nets +2 against
  // the free +1. If the v31 control ever stops pinning this, the Orchard board
  // dies inside the control and nothing errors.
  it('keeps the Orchard door card-POSITIVE under the v31 control', () => {
    const v31 = loadGameData(
      overlay(
        {
          'rules.turn.visitCurrency': 'card',
          'workers.roster.draw.draw.see': 3,
          'workers.roster.draw.draw.keep': 3,
        },
        'v31-card-visit',
      ),
    );
    const door = v31.workers.roster.find((w) => w.id === 'draw');
    const fee = 1;
    expect((door?.draw?.keep ?? 0) - fee).toBeGreaterThan(v31.rules.turn.bonusDraw);
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

  // Dean's table rulings of 15/09/2026: a random first player, and the round is
  // finished once the end is triggered. Both old values must stay reachable,
  // because every overlay describing an older game pins them.
  it('ships a random first player and finish-the-round, with both old rules as knobs', () => {
    expect(BASE_GAME_DATA.rules.setup.firstPlayer).toBe('random');
    expect(BASE_GAME_DATA.rules.endGame.endOfGame).toBe('finishRound');
    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.setup.firstPlayer');
    expect(knobs).toContain('rules.endGame.endOfGame');
    const old = loadGameData(
      overlay({
        'rules.setup.firstPlayer': 'seat0',
        'rules.endGame.endOfGame': 'oneMoreTurnEach',
      }),
    );
    expect(old.rules.setup.firstPlayer).toBe('seat0');
    expect(old.rules.endGame.endOfGame).toBe('oneMoreTurnEach');
    for (const [path, bad] of [
      ['rules.setup.firstPlayer', 'seat1'],
      ['rules.setup.firstPlayer', 0],
      ['rules.endGame.endOfGame', 'finishTurn'],
      ['rules.endGame.endOfGame', true],
    ] as const) {
      expect(() => validateOverlay(overlay({ [path]: bad }), BASE_GAME_DATA), path).toThrow(
        OverlayError,
      );
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
    // 3 since 10/09/2026 (S8), where it was 2 from 20/08/2026. The v31 control
    // pins the 2 it was measured with; see 'the notice board visit' above.
    expect(BASE_GAME_DATA.rules.economy.noticeBoardThreshold).toBe(3);
  });

  it("reaches the door's threshold on the Notice Board's printed face", () => {
    // Sheet v42 prints `3+`, extracted as 3, so the overlay moves it to 4.
    const tight = loadGameData(overlay({ 'cards.catalogue.W3.threshold': 4 }));
    expect(tight.cards.catalogue.find((c) => c.id === 'W3')?.threshold).toBe(4);
    expect(BASE_GAME_DATA.cards.catalogue.find((c) => c.id === 'W3')?.threshold).toBe(3);
  });

  it('switches a card out', () => {
    const withoutBreadHall = loadGameData(overlay({ 'cards.catalogue.W21.enabled': false }));
    expect(activeCards(withoutBreadHall)).toHaveLength(104);
    expect(activeCards(withoutBreadHall).some((c) => c.id === 'W21')).toBe(false);
  });

  it('accepts null where a knob nulls out a rule', () => {
    // The meeple spend cap is an intOrNull switch: null is unlimited.
    expect(BASE_GAME_DATA.rules.turn.meepleSpendPerTurn).toBe(1);
    const unlimited = loadGameData(overlay({ 'rules.turn.meepleSpendPerTurn': null }));
    expect(unlimited.rules.turn.meepleSpendPerTurn).toBeNull();
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
