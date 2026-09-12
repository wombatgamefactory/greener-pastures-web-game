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
import unclaimedJson from '../../../overlays/notice-board-visit-unclaimed-v1.overlay.json' with { type: 'json' };
import unclaimedSelfJson from '../../../overlays/notice-board-visit-unclaimed-self-v1.overlay.json' with { type: 'json' };
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
  coinGrowOnFullBuilding,
  coinGrowReachesFullBuildings,
  coinPaysBuild,
  coinPaysGrow,
  coinPaysSuitCost,
  coinSupplyPerPlayer,
  commonsHarvestReachesCentre,
  commonsTakeGoesToHand,
  commonsTakeLeavesTheGame,
  commonsWildPair,
  deadTemplates,
  deliveriesPerTile,
  deliveryCost,
  deliveryMeepleSpace,
  deliveryVp,
  doorActionForSuit,
  doorForSuit,
  endgameCoinCost,
  expandSweep,
  farmsteadCoinPower,
  flatten,
  hostDrawOnVisit,
  isCommons,
  isCommonsTakeCoins,
  isMeepleCurrency,
  isNoticeBoardPower,
  listKnobs,
  loadGameData,
  meepleAction,
  meepleSpendDistinctColours,
  meepleSpendPerTurn,
  meepleSpendTiming,
  meeplesDealt,
  meeplesPerTile,
  noticeBoardBlocks,
  noticeBoardsPerSeat,
  storeCoinsPerCard,
  tileMeepleSpaces,
  unclaimedBoardsToCentre,
  validateOverlay,
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

// ⭐ THE v31 DRIFT GUARD, REWRITTEN FOR AN ARM RATHER THAN DELETED (10/09/2026).
//
// WHY THE GUARD EXISTS, AND IT IS THE PART TO KEEP. Coins were removed from the
// game on 02/09/2026 (v31), and the way they come back is not a decision - it is
// one key surviving a merge, or an old overlay being restored, or a re-extract
// from a sheet that still prints a coin icon. So this asserts on the WHOLE TREE
// rather than on a list of known keys. Every earlier coin economy in this
// project died the same way: a SECOND FAUCET (the Hiring Fair's bank-paid wage,
// the visit payout, the market) or a PITY RATE (£5 = 1 VP), and each of those
// arrived as an addition nobody re-derived the arithmetic for.
//
// ⭐ WHAT CHANGED: coins are genuinely back, as the ARM of 10/09/2026
// (docs/commons-coins-handoff-2026-09-10-v2.md, K7-K15) and not as the game.
// The arm has EXACTLY ONE MINT - clearing a central pile under
// `rules.turn.commonsTake: 'coins'` (K8) - and EXACTLY TWO SINKS - the
// Farmstead's coin-activated suit power (`farmsteadCoinPower`, K10-K14) and the
// fifteen Endgame cards priced in coins (`endgameCoinCost`, K15). Coins score
// nothing, break no ties, buy no ordinary card and leftover coins are dead. So
// the guard's job is no longer "no coin may exist" but "the shipped game has
// none, and the arm's surface is exactly these two leaves and no third" - which
// is the assertion that would catch a faucet arriving.
//
// ⭐ AND THERE ARE NOW TWO COIN ECONOMIES ON THE SURFACE, NOT ONE (12/09/2026,
// ledger A150, `docs/village-store-coins-2026-09-12-v2.md`). The VILLAGE STORE
// is a second, separate arm with its own single mint - one coin per additional
// barn card spent at a delivery (`storeCoinsPerCard`, V1) - its own shared
// supply (`coinSupplyPerPlayer`, V4) and its own two sinks split into four
// switches (`coinPaysBuild`, `coinPaysSuitCost`, `coinPaysGrow`,
// `coinGrowOnFullBuilding`, V6 to V9). ⛔ THE INVARIANT THE LISTS BELOW ENFORCE
// IS UNCHANGED AND IS THE ONLY ONE THAT MATTERS: every coin leaf is named
// literally, so a NINTH one cannot creep in behind a passing test, and each
// economy has EXACTLY ONE MINT. Two arms with one mint each is not the failure;
// two mints in one arm is, and so is a pity rate.
describe('coins are an arm, not the shipped game', () => {
  const COIN = /coin/i;

  // The magenta balloon keeps the id `balloonCoins` on purpose, because V19 The
  // Sky Market scores by balloon COUNT and a rename would have to be chased
  // through the handler, the art and the reports for no gain. It pays a harvest,
  // not money.
  const BALLOON_ID = 'aerodrome.balloons.balloonCoins.';

  it('ships every coin switch OFF, so the default game has no currency', () => {
    // The mint.
    expect(BASE_GAME_DATA.rules.turn.commonsTake).toBe('harvest');
    expect(isCommonsTakeCoins(BASE_GAME_DATA)).toBe(false);
    expect(commonsTakeLeavesTheGame(BASE_GAME_DATA)).toBe(false);
    // Both sinks.
    expect(BASE_GAME_DATA.rules.economy.farmsteadCoinPower).toBe(false);
    expect(farmsteadCoinPower(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.economy.endgameCoinCost).toBeNull();
    expect(endgameCoinCost(BASE_GAME_DATA)).toBeNull();
    // The Village Store's own mint, supply and four sink switches (A150).
    expect(storeCoinsPerCard(BASE_GAME_DATA)).toBe(0);
    expect(coinSupplyPerPlayer(BASE_GAME_DATA)).toBe(0);
    expect(coinPaysBuild(BASE_GAME_DATA)).toBe(false);
    expect(coinPaysSuitCost(BASE_GAME_DATA)).toBe(false);
    expect(coinPaysGrow(BASE_GAME_DATA)).toBe(false);
    expect(coinGrowReachesFullBuildings(BASE_GAME_DATA)).toBe(false);
  });

  // Listed LITERALLY rather than by count, so a NINTH coin leaf cannot creep in
  // unnoticed behind a passing test. One is a tombstone pinned at 0, two are the
  // commons-with-coins arm's switches, and six are the Village Store's.
  it("names no coin anywhere in the data, bar the tombstone and the two arms' switches", () => {
    const offenders = [...flatten(BASE_GAME_DATA).keys()]
      .filter((path) => COIN.test(path))
      .filter((path) => !path.startsWith(BALLOON_ID))
      .sort();
    expect(offenders).toEqual([
      'island.tileRule.coinsPerDelivery',
      'rules.economy.coinGrowOnFullBuilding',
      'rules.economy.coinPaysBuild',
      'rules.economy.coinPaysGrow',
      'rules.economy.coinPaysSuitCost',
      'rules.economy.coinSupplyPerPlayer',
      'rules.economy.endgameCoinCost',
      'rules.economy.farmsteadCoinPower',
      'rules.economy.storeCoinsPerCard',
    ]);
    // ⛔ THE TOMBSTONE IS STILL PINNED AT 0 AND IS NOT A FAUCET. The v31 plan
    // named the key rather than deleting it; island delivery pays VP and has
    // paid nothing else since. If this ever reads non-zero, the arm has grown a
    // second mint and the whole economy needs re-deriving.
    expect(BASE_GAME_DATA.island.tileRule.coinsPerDelivery).toBe(0);
    // And the balloon that keeps the name has stopped paying money.
    expect(
      BASE_GAME_DATA.aerodrome.balloons.find((b) => b.id === 'balloonCoins')?.reward.type,
    ).toBe('harvestAny');
  });

  // The registry is the other surface a coin could arrive on, and the same
  // literal listing applies. ⛔ EXACTLY ONE OF THESE EIGHT IS A MINT
  // (`storeCoinsPerCard`, the Village Store's, V1); one is a supply; and the
  // other six are SINKS. The commons-with-coins arm's own mint is
  // `commonsTake: 'coins'`, which does not match /coin/i and is asserted above
  // by value. A second faucet inside either arm is what every coin economy in
  // this project has died of, so a ninth entry here needs a ruling and not a
  // tuning.
  it('offers eight coin knobs, exactly one of which is a mint', () => {
    expect(KNOB_TEMPLATES.filter((t) => COIN.test(t.template)).map((t) => t.template)).toEqual([
      'rules.economy.endgameCoinCost',
      'rules.economy.farmsteadCoinPower',
      'rules.economy.storeCoinsPerCard',
      'rules.economy.coinSupplyPerPlayer',
      'rules.economy.coinPaysBuild',
      'rules.economy.coinPaysSuitCost',
      'rules.economy.coinPaysGrow',
      'rules.economy.coinGrowOnFullBuilding',
    ]);
  });

  // ⛔ THE COIN PRICE IS A RULES KNOB AND NEVER A CARD FIELD, AND THIS
  // ASSERTION IS THE THING THAT KEEPS IT SO. `BuildCost` lost its `coins` third
  // with the currency on 02/09/2026; K15 prices the fifteen Endgame cards in
  // coins through `rules.economy.endgameCoinCost` instead, so a coin price can
  // only ever arrive from a RULING. If it were a card field it could arrive from
  // a re-extract of a sheet nobody had read, which is exactly the silent drift
  // this file exists to make loud.
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

/**
 * ⭐ THE COMMONS IS THE SHIPPED GAME (Dean, 09/09/2026,
 * docs/commons-handoff-2026-09-09-v1.md, C1-C10).
 *
 * These assertions are the passenger guard. The flip moved four leaves at once -
 * the currency, the bonus window, the starting meeples and the Orchard door -
 * and the 05/09/2026 lesson is that an arm which does not PIN what the default
 * moved silently stops being the arm it is called. So each control is loaded
 * here as the overlay file loads it and asked which game it is.
 */
describe('the commons', () => {
  it('ships as the default game, with every meeple leaf at its no-subject value', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('commons');
    expect(isCommons(BASE_GAME_DATA)).toBe(true);
    expect(isMeepleCurrency(BASE_GAME_DATA)).toBe(false);
    // C2: the bonus is taken FIRST, reversing the 03/09/2026 ruling.
    expect(BASE_GAME_DATA.rules.turn.bonusTiming).toBe('start');
    // C6: no meeples anywhere.
    expect(BASE_GAME_DATA.rules.turn.startingMeeplesPerColour).toBe(0);
    expect(BASE_GAME_DATA.rules.turn.meepleAsCard).toBe(false);
    expect(BASE_GAME_DATA.rules.turn.slotToll).toBeNull();
    expect(BASE_GAME_DATA.rules.turn.meepleCapPerColour).toBeNull();
    // C7: the limit stays 7, and it is the simulator's bound rather than a rule.
    expect(BASE_GAME_DATA.rules.turn.handLimit).toBe(7);
  });

  // C10. Both off, so the shipped bonus refuses nothing and matches no colour.
  // They exist so that a bonus reading AUTOMATIC at the table is one number away
  // rather than a design pass away - which is exactly how the meeple visit died.
  it('ships both fallback knobs off, and offers both as knobs', () => {
    expect(BASE_GAME_DATA.rules.economy.commonsThreshold).toBeNull();
    expect(BASE_GAME_DATA.rules.economy.commonsColourMatch).toBe(false);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.economy.commonsThreshold');
    expect(knobs).toContain('rules.economy.commonsColourMatch');

    const capped = loadGameData(overlay({ 'rules.economy.commonsThreshold': 2 }));
    expect(capped.rules.economy.commonsThreshold).toBe(2);
    const matched = loadGameData(overlay({ 'rules.economy.commonsColourMatch': true }));
    expect(matched.rules.economy.commonsColourMatch).toBe(true);
  });

  // Dean's question of 09/09/2026: does a threshold on the centre reduce the
  // cards going from the centre to the barns, target 30-40%? commonsThreshold
  // measured no change at 2, so the other two semantics are knobs too. Both
  // ship off, so the shipped harvest is C5 exactly: any non-empty pile, whole.
  it('ships both harvest knobs off, and offers both as knobs', () => {
    expect(BASE_GAME_DATA.rules.economy.commonsHarvestMin).toBeNull();
    expect(BASE_GAME_DATA.rules.economy.commonsHarvestTake).toBeNull();

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.economy.commonsHarvestMin');
    expect(knobs).toContain('rules.economy.commonsHarvestTake');

    const gated = loadGameData(overlay({ 'rules.economy.commonsHarvestMin': 3 }));
    expect(gated.rules.economy.commonsHarvestMin).toBe(3);
    const capped = loadGameData(overlay({ 'rules.economy.commonsHarvestTake': 1 }));
    expect(capped.rules.economy.commonsHarvestTake).toBe(1);
  });

  // ⚠️ THE CONTROLS ARE THE POINT OF THE FLIP. Neither the v31 nor the meeple
  // branch may become unreachable, and neither may quietly become the commons.
  it('leaves both controls reachable, and neither of them is the commons', () => {
    const v31 = loadGameData(overlay({ 'rules.turn.visitCurrency': 'card' }, 'v31-card-visit'));
    expect(isCommons(v31)).toBe(false);
    expect(isMeepleCurrency(v31)).toBe(false);

    const loop = loadGameData(overlay({ 'rules.turn.visitCurrency': 'meeple' }, 'meeple-loop-v1'));
    expect(isCommons(loop)).toBe(false);
    expect(isMeepleCurrency(loop)).toBe(true);
  });

  // C3. The one door whose ACTION the commons changed, carried as a second
  // printed payload beside `action` so the controls keep their Sow without
  // pinning a leaf - `action` is not in the registry and could not be pinned.
  it('buys a GROW at the Apiary board, and a SOW under the controls', () => {
    expect(doorActionForSuit(BASE_GAME_DATA, 'apiary')).toBe('grow');
    const loop = loadGameData(overlay({ 'rules.turn.visitCurrency': 'meeple' }, 'meeple-loop-v1'));
    expect(doorActionForSuit(loop, 'apiary')).toBe('sow');
    // The other four are the same action in every game.
    for (const suit of ['wheat', 'vegetable', 'orchard', 'dairy']) {
      expect(doorActionForSuit(BASE_GAME_DATA, suit), suit).toBe(
        doorForSuit(BASE_GAME_DATA, suit)?.action,
      );
    }
  });

  // ⭐ THE COMMONS WITH COINS (Dean, 10/09/2026, K1-K15). Five more knobs, and
  // every one of them ships at the value that turns the arm OFF - the same shape
  // as the two fallback knobs above, and asserted the same way: off in the
  // shipped data, present in the registry, and reachable through an overlay.
  // ⚠️ THREE LEAVES AND NOT SEVEN SINCE 10/09/2026. The four suit-power numbers
  // this used to assert here were `rules.economy.farmsteadPower.*`, and the
  // notice-board visit RENAMED that block to `rules.economy.noticeBoardPower`
  // and repointed it: the powers left the Farmstead and went to the Notice
  // Boards, so the block went with them. They are asserted in their own describe
  // below, and the coins arm's own handler has to be repointed at the new names.
  it('ships every commons-with-coins knob off, and offers its three leaves as knobs', () => {
    expect(BASE_GAME_DATA.rules.economy.commonsWildPair).toBe(false);
    expect(commonsWildPair(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.economy.endgameCoinCost).toBeNull();
    expect(BASE_GAME_DATA.rules.economy.farmsteadCoinPower).toBe(false);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.economy.commonsWildPair');
    expect(knobs).toContain('rules.economy.endgameCoinCost');
    expect(knobs).toContain('rules.economy.farmsteadCoinPower');

    const paired = loadGameData(
      overlay({
        'rules.economy.commonsWildPair': true,
        'rules.economy.endgameCoinCost': 3,
        'rules.economy.farmsteadCoinPower': true,
      }),
    );
    expect(commonsWildPair(paired)).toBe(true);
    expect(endgameCoinCost(paired)).toBe(3);
    expect(farmsteadCoinPower(paired)).toBe(true);
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

  // K3/K4: the fifth commonsTake value. ⛔ A COIN TAKE HANDS BACK NO CARDS, so
  // it must never join `commonsTakeGoesToHand` - the pile is discarded to its
  // suits' piles and the taker is paid in a currency instead. What it DOES share
  // with the other three is that Harvest stops reaching the centre.
  it("takes a pile OUT of the game under 'coins', and never into a hand", () => {
    const coins = loadGameData(overlay({ 'rules.turn.commonsTake': 'coins' }, 'commons-coins-v1'));
    expect(isCommonsTakeCoins(coins)).toBe(true);
    expect(commonsTakeLeavesTheGame(coins)).toBe(true);
    expect(commonsTakeGoesToHand(coins)).toBe(false);

    // C5 is the shipped rule and the only value that leaves Harvest reaching the
    // centre; all four variants take it away, which is why the farm-bypass
    // reading is a structural zero under each of them rather than a fix.
    expect(commonsHarvestReachesCentre(BASE_GAME_DATA)).toBe(true);
    for (const take of ['bonus', 'spend', 'paid', 'coins']) {
      const arm = loadGameData(overlay({ 'rules.turn.commonsTake': take }));
      expect(commonsHarvestReachesCentre(arm), take).toBe(false);
    }

    // A closed set: a take may never resolve in a way nothing dispatches on.
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.commonsTake': 'gold' }), BASE_GAME_DATA),
    ).toThrow(/commonsTake/);
  });

  it('offers the Apiary door action as a knob, so a Sow arm is one overlay', () => {
    expect(listKnobs(BASE_GAME_DATA).map((k) => k.path)).toContain(
      'workers.roster.sow.actionUnderCommons',
    );
    const sown = loadGameData(overlay({ 'workers.roster.sow.actionUnderCommons': 'sow' }));
    expect(doorActionForSuit(sown, 'apiary')).toBe('sow');
    // A closed set: a door may never buy a word nothing dispatches on.
    expect(() =>
      validateOverlay(
        overlay({ 'workers.roster.sow.actionUnderCommons': 'plough' }),
        BASE_GAME_DATA,
      ),
    ).toThrow(/doorAction/);
  });
});

/**
 * ⭐ THE NOTICE BOARD VISIT IS AN ARM AND NOT THE GAME (Dean, 10/09/2026,
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
  it("adds 'noticeBoardPower' as a fourth currency, and still refuses a fifth word", () => {
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(false);

    const arm = loadGameData(
      overlay({ 'rules.turn.visitCurrency': 'noticeBoardPower' }, 'notice-board-visit-v1'),
    );
    expect(isNoticeBoardPower(arm)).toBe(true);
    expect(isCommons(arm)).toBe(false);
    expect(isMeepleCurrency(arm)).toBe(false);

    // A closed set: a game may never be named by a word nothing dispatches on.
    expect(() =>
      validateOverlay(overlay({ 'rules.turn.visitCurrency': 'noticeboard' }), BASE_GAME_DATA),
    ).toThrow(/visitCurrency/);
  });

  // ⭐ THE SEAM THE HANDOFF DID NOT NAME. `meeplesPerTile` answers 0 for the
  // commons and then falls through to the v31 arithmetic for anything else, so
  // a fourth currency would have seeded two meeples a tile in silence. The
  // function's own comment predicted it in September; this is the assertion that
  // keeps it closed.
  it('seeds no meeple on the island under the arm either', () => {
    const arm = loadGameData(
      overlay({ 'rules.turn.visitCurrency': 'noticeBoardPower' }, 'notice-board-visit-v1'),
    );
    expect(meeplesPerTile(arm)).toBe(0);
    expect(meeplesDealt(arm, 4)).toBe(0);
  });

  // S12, as amended by rulings C88 (Wheat) and C89 (Apiary) the same evening.
  // FIVE numbers and not four, and asserted whole rather than key by key: a
  // sixth arriving unnoticed is exactly the drift this file exists to make loud.
  it('carries the five renamed Notice Board powers, and offers all five as knobs', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardPower).toEqual({
      orchardDraw: 4,
      apiarySows: 2,
      vegetableFallback: 2,
      dairyWild: true,
      wheatBarn: 1,
    });

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    for (const key of [
      'orchardDraw',
      'apiarySows',
      'vegetableFallback',
      'dairyWild',
      'wheatBarn',
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
        Object.keys(set).filter((k) => set[k] !== arm[k]),
        name,
      ).toEqual([path]);
    }
  });
});

/**
 * ⭐ DEAN'S UNCLAIMED-BOARDS VARIANT (ruled 11/09/2026), AND THE 2x2 THAT KEEPS
 * IT SEPARABLE.
 *
 * The variant changes TWO things at once - self-visiting OFF, and the Notice
 * Board of every unfarmed suit to the centre - and ruling in a bundle rules in
 * the bundle (05/09/2026). So the four arms form a grid:
 *
 * |                   | self-visiting ON             | self-visiting OFF      |
 * | ----------------- | ---------------------------- | ---------------------- |
 * | no centre         | `notice-board-visit-v1`      | `-no-self-v1`          |
 * | unclaimed centre  | `-unclaimed-self-v1`         | `-unclaimed-v1` (Dean) |
 *
 * These tests diff the loaded `set` blocks rather than trusting the files to
 * stay a grid, for the reason the imports at the top of this file record: A COPY
 * OF A PIN STOPS BEING A PIN THE MOMENT THE DEFAULT MOVES UNDER IT.
 */
describe('the unclaimed boards in the centre', () => {
  /** The four corners, keyed by filename for the report. */
  const GRID: Readonly<Record<string, Overlay>> = {
    'notice-board-visit-v1': armJson as unknown as Overlay,
    'notice-board-visit-no-self-v1': noSelfJson as unknown as Overlay,
    'notice-board-visit-unclaimed-v1': unclaimedJson as unknown as Overlay,
    'notice-board-visit-unclaimed-self-v1': unclaimedSelfJson as unknown as Overlay,
  };

  /**
   * The leaves that ARE the centre, and the whole of it. One of them is new;
   * the other four are the commons knobs reused, because a central pile under
   * this variant IS a commons pile: `commonsThreshold` null is "nothing ever
   * refuses a play", `commonsHarvestMin` 3 is "anybody may harvest at three or
   * more", `commonsHarvestTake` null is "the whole pile", and `commonsTake`
   * 'harvest' is what lets Harvest reach the centre at all.
   */
  const CENTRE_LEAVES = [
    'rules.economy.unclaimedBoardsToCentre',
    'rules.economy.commonsThreshold',
    'rules.economy.commonsHarvestMin',
    'rules.economy.commonsHarvestTake',
  ] as const;

  // A new leaf, shipped OFF, on the same terms as `noticeBoardBlocks` beside
  // it: the shipped game is still the commons and this is one overlay away.
  it('adds one knob, ships it false, and round-trips it through an overlay', () => {
    expect(BASE_GAME_DATA.rules.economy.unclaimedBoardsToCentre).toBe(false);
    expect(unclaimedBoardsToCentre(BASE_GAME_DATA)).toBe(false);

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    expect(knobs).toContain('rules.economy.unclaimedBoardsToCentre');

    const centre = loadGameData(overlay({ 'rules.economy.unclaimedBoardsToCentre': true }));
    expect(centre.rules.economy.unclaimedBoardsToCentre).toBe(true);
    expect(unclaimedBoardsToCentre(centre)).toBe(true);

    // A boolean and never a count of boards: the number of central boards is
    // five minus the seats, which is arithmetic rather than a tuning.
    expect(() =>
      validateOverlay(overlay({ 'rules.economy.unclaimedBoardsToCentre': 4 }), BASE_GAME_DATA),
    ).toThrow(/is boolean/);
  });

  // ⛔ THE SHIPPED DEFAULT IS UNTOUCHED BY THE WHOLE PASS. The commons is
  // still the game, and a new knob that moved the default would be the
  // 05/09/2026 passenger failure arriving as a data edit.
  it('leaves the shipped game exactly where it was', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('commons');
    expect(isCommons(BASE_GAME_DATA)).toBe(true);
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.economy.unclaimedBoardsToCentre).toBe(false);
  });

  // All four corners read from disk and applied, so an overlay naming a knob
  // the data no longer has fails on the commit that broke it.
  it('loads and validates all four corners of the 2x2', () => {
    for (const [name, loaded] of Object.entries(GRID)) {
      expect(loaded.name, name).toBe(name);
      expect(() => validateOverlay(loaded, BASE_GAME_DATA), name).not.toThrow();
      const data = loadGameData(loaded);
      expect(isNoticeBoardPower(data), name).toBe(true);
      expect(data.rules.turn.bonusTiming, name).toBe('start');
    }
  });

  // The two centre arms differ in ONE leaf and it is the self-visit, which is
  // what makes the pair attributable to that rule alone.
  it('separates the two centre arms by exactly one leaf, the self-visit', () => {
    const dean = GRID['notice-board-visit-unclaimed-v1']?.set ?? {};
    const withSelf = GRID['notice-board-visit-unclaimed-self-v1']?.set ?? {};

    expect(Object.keys(withSelf).sort()).toEqual(Object.keys(dean).sort());
    expect(Object.keys(dean).filter((k) => dean[k] !== withSelf[k])).toEqual([
      'rules.turn.selfVisitAllowed',
    ]);
    expect(dean['rules.turn.selfVisitAllowed']).toBe(false);
    expect(withSelf['rules.turn.selfVisitAllowed']).toBe(true);
  });

  // ⭐ AND EACH CENTRE ARM IS ITS NO-CENTRE COUNTERPART PLUS THE CENTRE
  // LEAVES, AND NOTHING ELSE. That is the half of the grid a reader is most
  // likely to break by hand: a passenger added to one corner and not the other
  // leaves a delta that is unreadable rather than wrong.
  it('adds the centre leaves and only the centre leaves to each no-centre corner', () => {
    const columns: ReadonlyArray<readonly [string, string]> = [
      ['notice-board-visit-unclaimed-v1', 'notice-board-visit-no-self-v1'],
      ['notice-board-visit-unclaimed-self-v1', 'notice-board-visit-v1'],
    ];

    for (const [centreName, plainName] of columns) {
      const centre = GRID[centreName]?.set ?? {};
      const plain = GRID[plainName]?.set ?? {};

      const added = Object.keys(centre).filter((k) => !(k in plain));
      expect(added.sort(), centreName).toEqual([...CENTRE_LEAVES].sort());
      // Nothing is dropped either: a centre arm pins everything its plain
      // counterpart pins.
      expect(
        Object.keys(plain).filter((k) => !(k in centre)),
        centreName,
      ).toEqual([]);
      // And every shared leaf agrees, so the ONLY difference down a column is
      // the centre.
      expect(
        Object.keys(plain).filter((k) => plain[k] !== centre[k]),
        centreName,
      ).toEqual([]);
    }
  });

  // ⭐ THE `3+` RULE IS THE COMMONS KNOBS REUSED, NOT A SECOND SPELLING OF
  // THEM. A new knob that duplicates an old one is a defect, so this asserts
  // both the values and the fact that three of the four are knobs that were
  // already here.
  it('spells the 3+ rule with the commons knobs that already existed', () => {
    for (const name of [
      'notice-board-visit-unclaimed-v1',
      'notice-board-visit-unclaimed-self-v1',
    ]) {
      const set = GRID[name]?.set ?? {};
      // Never blocked: no cap on the inflow, so nothing refuses a play.
      expect(set['rules.economy.commonsThreshold'], name).toBeNull();
      // Harvestable by anybody at three or more: a gate on the outflow.
      expect(set['rules.economy.commonsHarvestMin'], name).toBe(3);
      // The whole pile, never a capped slice of it.
      expect(set['rules.economy.commonsHarvestTake'], name).toBeNull();
      // And Harvest reaches the centre at all, which every other value of this
      // knob turns off (a Harvest is a Harvest, D1, reaffirmed 11/09/2026).
      expect(set['rules.turn.commonsTake'], name).toBe('harvest');

      const data = loadGameData(GRID[name] as Overlay);
      expect(commonsHarvestReachesCentre(data), name).toBe(true);
      expect(unclaimedBoardsToCentre(data), name).toBe(true);
      expect(data.rules.economy.commonsHarvestMin, name).toBe(3);
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

  /** The leaves that ARE the variant, and the whole of it. */
  const NEW_LEAVES = [
    'rules.economy.noticeBoardsBySeats.2',
    'rules.economy.noticeBoardsBySeats.3',
    'rules.economy.noticeBoardsBySeats.4',
    // ⛔ Pinned at the BASE value rather than changed: this variant is the
    // ALTERNATIVE to the unclaimed-boards centre and never an addition to it,
    // and an unpinned leaf is how that passenger rides in.
    'rules.economy.unclaimedBoardsToCentre',
  ] as const;

  // A map and not a boolean, in the `decksInPlayBySeats` idiom, shipped at one
  // board each so the base game is untouched.
  it('adds a per-seat-count map, defaults to one board each, and round-trips', () => {
    expect(BASE_GAME_DATA.rules.economy.noticeBoardsBySeats).toEqual({ '2': 1, '3': 1, '4': 1 });
    for (const seats of [2, 3, 4]) {
      expect(noticeBoardsPerSeat(BASE_GAME_DATA, seats), String(seats)).toBe(1);
    }

    const knobs = listKnobs(BASE_GAME_DATA).map((k) => k.path);
    for (const seats of [2, 3, 4]) {
      expect(knobs, String(seats)).toContain(`rules.economy.noticeBoardsBySeats.${seats}`);
    }

    const two = loadGameData(overlay({ 'rules.economy.noticeBoardsBySeats.2': 2 }));
    expect(two.rules.economy.noticeBoardsBySeats).toEqual({ '2': 2, '3': 1, '4': 1 });
    expect(noticeBoardsPerSeat(two, 2)).toBe(2);
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

  // ⛔ THE SHIPPED DEFAULT IS UNTOUCHED BY THIS PASS TOO. The commons is still
  // the game, and a new knob that moved the default would be the 05/09/2026
  // passenger failure arriving as a data edit.
  it('leaves the shipped game exactly where it was', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('commons');
    expect(isCommons(BASE_GAME_DATA)).toBe(true);
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.economy.unclaimedBoardsToCentre).toBe(false);
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

    // ⛔ THE CENTRE IS OFF AND IT IS PINNED OFF. This variant is the
    // ALTERNATIVE to the unclaimed-boards centre, not an addition to it.
    expect(ARM.set['rules.economy.unclaimedBoardsToCentre']).toBe(false);
    expect(unclaimedBoardsToCentre(data)).toBe(false);
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

    // And every shared leaf agrees, so the ONLY difference between the two
    // overlays is the map plus the centre pinned at its base value.
    expect(Object.keys(control).filter((k) => control[k] !== arm[k])).toEqual([]);
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

  // ⛔ THE SHIPPED DEFAULT IS UNTOUCHED BY THIS PASS TOO. The commons is still
  // the game, and a new knob that moved the default would be the 05/09/2026
  // passenger failure arriving as a data edit.
  it('leaves the shipped game exactly where it was', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('commons');
    expect(isCommons(BASE_GAME_DATA)).toBe(true);
    expect(isNoticeBoardPower(BASE_GAME_DATA)).toBe(false);
    expect(BASE_GAME_DATA.rules.turn.hostDrawOnVisit).toBe(0);
    expect(hostDrawOnVisit(BASE_GAME_DATA)).toBe(0);
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
    // The two-board map rides along unchanged, and the centre stays off.
    expect(noticeBoardsPerSeat(data, 2)).toBe(2);
    expect(unclaimedBoardsToCentre(data)).toBe(false);
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
    expect(Object.keys(control).filter((k) => control[k] !== arm[k])).toEqual([]);
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
 * ⭐ THE VILLAGE STORE COIN AND THE DELIVERY MEEPLE (Dean, 12/09/2026, ledger
 * A150 and A151), AS TEN LEAVES AT SHIPPED-OFF VALUES AND NOTHING ELSE.
 *
 * ⛔ THE WHOLE CLAIM OF THIS SLICE IS INERTNESS, so these tests assert the
 * shipped VALUES rather than the rules: nothing in the engine reads any of them
 * yet, and the thing that would go wrong is a leaf shipping at a value that
 * quietly changes the game or a named control.
 *
 * ⛔ AND THREE OF THE TEN SHIP AT A VALUE THE BUILD HANDOFF GOT WRONG, which is
 * what most of this block is here to pin. `meepleSpendTiming` ships `'start'`
 * and not `'none'`, `meepleSpendPerTurn` ships `null` and not `0`, and
 * `deliveryMeepleSpace`'s `null` means "defer to the existing seeding" and not
 * "no meeples". The first two would delete the v31 control's turn-start meeple
 * spend, which `packages/sim/fixtures/2p-v31-opening.json` replays against.
 */
describe('the village store coin and the delivery meeple', () => {
  // Every leaf, its shipped value and its accessor, in one table so a future
  // edit that flips one has to flip a line here as well.
  it('ships all ten leaves at the value that changes nothing', () => {
    expect(BASE_GAME_DATA.rules.economy.storeCoinsPerCard).toBe(0);
    expect(storeCoinsPerCard(BASE_GAME_DATA)).toBe(0);
    expect(BASE_GAME_DATA.rules.economy.coinSupplyPerPlayer).toBe(0);
    expect(coinSupplyPerPlayer(BASE_GAME_DATA)).toBe(0);
    expect(coinPaysBuild(BASE_GAME_DATA)).toBe(false);
    expect(coinPaysSuitCost(BASE_GAME_DATA)).toBe(false);
    expect(coinPaysGrow(BASE_GAME_DATA)).toBe(false);
    expect(coinGrowOnFullBuilding(BASE_GAME_DATA)).toBe(false);

    expect(deliveryMeepleSpace(BASE_GAME_DATA)).toBeNull();
    expect(meepleSpendTiming(BASE_GAME_DATA)).toBe('start');
    expect(meepleSpendPerTurn(BASE_GAME_DATA)).toBeNull();
    expect(meepleSpendDistinctColours(BASE_GAME_DATA)).toBe(false);

    // The shipped game is still the commons and nothing here moved it.
    expect(isCommons(BASE_GAME_DATA)).toBe(true);
  });

  it('registers all ten as knobs of the right type', () => {
    const byPath = new Map(listKnobs(BASE_GAME_DATA).map((k) => [k.path, k.type]));
    const expected: Readonly<Record<string, string>> = {
      'rules.economy.storeCoinsPerCard': 'int',
      'rules.economy.coinSupplyPerPlayer': 'int',
      'rules.economy.coinPaysBuild': 'boolean',
      'rules.economy.coinPaysSuitCost': 'boolean',
      'rules.economy.coinPaysGrow': 'boolean',
      'rules.economy.coinGrowOnFullBuilding': 'boolean',
      'rules.turn.deliveryMeepleSpace': 'intOrNull',
      'rules.turn.meepleSpendTiming': 'meepleSpendTiming',
      'rules.turn.meepleSpendPerTurn': 'intOrNull',
      'rules.turn.meepleSpendDistinctColours': 'boolean',
    };
    for (const [path, type] of Object.entries(expected)) {
      expect(byPath.get(path), path).toBe(type);
    }
  });

  // ⭐ AN INT AND NOT A BOOL IN BOTH CASES, so the rate and the pool can be
  // swept later without another knob.
  it('takes the arm values through an overlay and refuses the wrong shapes', () => {
    const armed = loadGameData(
      overlay({
        'rules.economy.storeCoinsPerCard': 1,
        'rules.economy.coinSupplyPerPlayer': 5,
        'rules.economy.coinPaysBuild': true,
        'rules.economy.coinPaysSuitCost': true,
        'rules.economy.coinPaysGrow': true,
        'rules.economy.coinGrowOnFullBuilding': true,
      }),
    );
    expect(storeCoinsPerCard(armed)).toBe(1);
    expect(coinSupplyPerPlayer(armed)).toBe(5);
    expect(coinPaysSuitCost(armed)).toBe(true);

    expect(() =>
      validateOverlay(overlay({ 'rules.economy.storeCoinsPerCard': true }), BASE_GAME_DATA),
    ).toThrow(/is int/);
    expect(() =>
      validateOverlay(overlay({ 'rules.economy.coinPaysGrow': 1 }), BASE_GAME_DATA),
    ).toThrow(/is boolean/);
  });

  // ⛔ THE PRECEDENCE RULE, ASSERTED SO IT CANNOT SILENTLY STOP BEING TRUE: V9
  // is meaningless without V8, and a branch reading the raw leaf would price a
  // decision that cannot happen under the build-only arm.
  it('answers the full-building Grow through one accessor and never the raw leaf', () => {
    expect(coinGrowReachesFullBuildings(BASE_GAME_DATA)).toBe(false);

    const rawOnly = loadGameData(overlay({ 'rules.economy.coinGrowOnFullBuilding': true }));
    expect(coinGrowOnFullBuilding(rawOnly)).toBe(true);
    // The raw leaf says yes and the rule says no, which is the whole point.
    expect(coinGrowReachesFullBuildings(rawOnly)).toBe(false);

    const both = loadGameData(
      overlay({
        'rules.economy.coinPaysGrow': true,
        'rules.economy.coinGrowOnFullBuilding': true,
      }),
    );
    expect(coinGrowReachesFullBuildings(both)).toBe(true);

    // And a coin-Grow that cannot reach a full building is still a coin-Grow.
    const growOnly = loadGameData(overlay({ 'rules.economy.coinPaysGrow': true }));
    expect(coinPaysGrow(growOnly)).toBe(true);
    expect(coinGrowReachesFullBuildings(growOnly)).toBe(false);
  });

  // ⛔ null IS "DEFER TO THE EXISTING SEEDING" AND NOT "NO MEEPLES". Checked
  // against `meeplesPerTile` in every currency, because that is the function the
  // island actually seeds from and the two must not drift.
  it('defers to the existing island seeding while deliveryMeepleSpace is null', () => {
    for (const currency of ['commons', 'card', 'meeple', 'noticeBoardPower'] as const) {
      const data =
        currency === 'commons'
          ? BASE_GAME_DATA
          : loadGameData(overlay({ 'rules.turn.visitCurrency': currency }));
      expect(deliveryMeepleSpace(data), currency).toBeNull();
      expect(tileMeepleSpaces(data).length, currency).toBe(meeplesPerTile(data));
    }

    // The commons and the notice-board visit seed none; the v31 control seeds
    // one per delivery space; the meeple loop seeds the 3 VP space alone.
    expect(tileMeepleSpaces(BASE_GAME_DATA)).toEqual([]);
    expect(tileMeepleSpaces(loadGameData(overlay({ 'rules.turn.visitCurrency': 'card' })))).toEqual(
      [0, 1],
    );
    expect(
      tileMeepleSpaces(loadGameData(overlay({ 'rules.turn.visitCurrency': 'meeple' }))),
    ).toEqual([1]);
  });

  // M1: exactly one meeple, on delivery space index 1 and never index 0. The
  // override wins over the currency, which is what makes it a rule rather than
  // a hint.
  it('lets M1 override the seeding outright, and seeds nothing off the end of a tile', () => {
    const m1 = loadGameData(overlay({ 'rules.turn.deliveryMeepleSpace': 1 }));
    expect(tileMeepleSpaces(m1)).toEqual([1]);
    expect(
      tileMeepleSpaces(loadGameData(overlay({ 'rules.turn.deliveryMeepleSpace': 0 }))),
    ).toEqual([0]);
    // A tile has `deliveriesPerTile` spaces and the knob is a free integer, so
    // an out-of-range value seeds nothing rather than throwing - the same filter
    // `meeplesPerTile` already applies to `island.meeples.seededSpaces`.
    expect(deliveriesPerTile(BASE_GAME_DATA)).toBe(2);
    expect(
      tileMeepleSpaces(loadGameData(overlay({ 'rules.turn.deliveryMeepleSpace': 2 }))),
    ).toEqual([]);
  });

  // ⛔ 'start' IS THE CURRENT BEHAVIOUR AND THEREFORE THE INERT VALUE. 'none'
  // would delete the v31 control's turn-start meeple spend, and a fixture
  // replays against it.
  it("ships the meeple spend window at 'start', with 'none' reachable but not shipped", () => {
    expect(meepleSpendTiming(BASE_GAME_DATA)).toBe('start');

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
  it('caps the meeple spend at null for unlimited, and keeps C112 as its own leaf', () => {
    expect(meepleSpendPerTurn(BASE_GAME_DATA)).toBeNull();
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

  /**
   * ⭐ ZERO UNDER THE SHIPPED COMMONS (Dean, 09/09/2026, C6). There are no
   * meeples in the game at all - not a bag that pays none, no component - so the
   * island seeds nothing and the whole `island.meeples` block is read only by
   * the two controls. This assertion is the seam: if a future edit lets the
   * commons fall through to either meeple arithmetic it deals meeples onto a
   * board that has nowhere to put them, and nothing else would notice.
   *
   * The two control numbers are asserted below rather than deleted: 6 / 9 / 12
   * under the meeple loop (one per TILE, on the 3 VP second space) and
   * 12 / 18 / 24 under v31 (one per delivery SPACE).
   */
  it('seeds no meeple at all under the shipped commons', () => {
    expect(meeplesDealt(BASE_GAME_DATA, 2)).toBe(0);
    expect(meeplesDealt(BASE_GAME_DATA, 3)).toBe(0);
    expect(meeplesDealt(BASE_GAME_DATA, 4)).toBe(0);
    expect(BASE_GAME_DATA.rules.turn.startingMeeplesPerColour).toBe(0);
  });

  it('has a bag deep enough for the biggest board under the meeple controls', () => {
    const loop = loadGameData(overlay({ 'rules.turn.visitCurrency': 'meeple' }, 'meeple-loop'));
    expect(meeplesDealt(loop, 2)).toBe(6);
    expect(meeplesDealt(loop, 3)).toBe(9);
    expect(meeplesDealt(loop, 4)).toBe(12);
    for (const seats of [2, 3, 4]) {
      expect(meeplesDealt(loop, seats), `${seats} seats`).toBeLessThanOrEqual(
        loop.island.meeples.poolSize,
      );
    }
  });

  // The control, and the reason `perDeliverySpace` is still a live key rather
  // than a tombstone: overlays/v31-card-visit.overlay.json reads it.
  it('deals both spaces under the v31 card-visit control', () => {
    const control = loadGameData({
      name: 'v31-card-visit',
      schemaVersion: 1,
      set: { 'rules.turn.visitCurrency': 'card' },
    });
    expect(meeplesDealt(control, 2)).toBe(12);
    expect(meeplesDealt(control, 3)).toBe(18);
    expect(meeplesDealt(control, 4)).toBe(24);
    expect(meeplesDealt(control, 4)).toBeLessThanOrEqual(control.island.meeples.poolSize);
  });

  it('seeds one meeple per delivery space, face up', () => {
    expect(BASE_GAME_DATA.island.meeples.perDeliverySpace).toBe(1);
    expect(BASE_GAME_DATA.island.meeples.seededSpaces).toEqual([1]);
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
    // 3 since 10/09/2026 (S8), where it was 2 from 20/08/2026. The v31 control
    // pins the 2 it was measured with; see 'the notice board visit' above.
    expect(BASE_GAME_DATA.rules.economy.noticeBoardThreshold).toBe(3);
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
