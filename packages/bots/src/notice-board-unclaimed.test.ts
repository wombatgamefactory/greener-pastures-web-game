/**
 * THE BOTS UNDER DEAN'S UNCLAIMED-BOARDS VARIANT (ruled 11/09/2026,
 * `overlays/notice-board-visit-unclaimed-v1.overlay.json`), and under the
 * shipped commons the variant must not have moved.
 *
 * **THE RULE IN ONE LINE**: self-visiting is BANNED, and the Notice Board of
 * every suit no player is farming stands ownerless in the centre with a public
 * pile, so every seat faces exactly FOUR targets at every player count -
 * (seats - 1) rivals' boards plus (5 - seats) central ones.
 *
 * ⛔ **WHY THIS FILE EXISTS AT ALL, AND IT IS ONE DEFECT RATHER THAN A HABIT.**
 * `terms.ts`'s `commonsPileSize` asked the engine's `data`-only
 * `commonsBoardSuit`, which answers null outside `visitCurrency: 'commons'` -
 * so under this variant **every central pile was priced at a flat ZERO and no
 * bot would ever have harvested one.** That is the exact defect found and fixed
 * for the village green on 09/09/2026 returning in a new place, and every
 * reading about the centre in this pass depends on the fix. The cases below are
 * what make the fix a claim somebody has run rather than a claim somebody has
 * made.
 *
 * ⚠️ **THIS FILE WALKS WHOLE GAMES**, for the reason `commons.test.ts` and
 * `notice-board.test.ts` both state at their own heads: the variant reuses two
 * move shapes that already existed, so almost every term fires for it WITHOUT
 * ANY CHANGE, and a claim that something already works is worth nothing until
 * something has run it.
 *
 * ⛔ Nothing here may name the engine's truth type, and nothing does.
 *
 * ⚠️ **THE VARIANT IS RESTATED INLINE RATHER THAN READ OFF ITS OVERLAY**,
 * exactly as its two neighbours restate theirs, because this package is
 * platform-free and may not do file I/O. That makes it a COPY OF A PIN, which
 * this project has learned stops being a pin the moment a default moves under
 * it - so it sets only the leaves these cases depend on and names them, and
 * `overlays.test.ts` in @gp/sim is what validates the real overlay.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, viewFor } from '@gp/engine';
import type { CardId, Move } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { scoredPolicy } from './evaluator.js';
import { makePolicy, policyRng } from './roster.js';
import type { PolicyId } from './roster.js';
import type { ExplainedMove } from './types.js';

/**
 * The variant: the eight leaves these cases depend on, out of the overlay's
 * eighteen. Four of them already hold the shipped value and are pinned anyway,
 * because an inherited value is how a passenger gets made (the 05/09/2026
 * lesson) and because each of these four is load-bearing HERE in a way it is
 * not in the game it was inherited from.
 */
const VARIANT: GameData = loadGameData({
  name: 'notice-board-unclaimed-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'aerodrome.moveCost.barnCards': 2,
    'aerodrome.alwaysInPlay': false,
    'aerodrome.flightMints': false,
    'aerodrome.balloons.balloonDraw.reward.type': 'draw',
    'aerodrome.balloons.balloonDraw.reward.amount': 4,
    'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
    'aerodrome.balloons.balloonBuild.reward.amount': 4,
    'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
    'aerodrome.balloons.balloonSow.reward.amount': 4,
    'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
    'rules.economy.storeCoinsPerCard': 0,
    'rules.economy.coinSupplyPerPlayer': 0,
    'rules.economy.coinPaysBuild': false,
    'rules.economy.coinPaysSuitCost': false,
    'rules.economy.coinPaysGrow': false,
    'rules.economy.coinGrowOnFullBuilding': false,
    // The design: owned boards printing the S12 powers, bonus FIRST.
    'rules.turn.visitCurrency': 'noticeBoardPower',
    'rules.turn.bonusTiming': 'start',
    // The two knobs the 2x2 separates, and this corner is both of them.
    'rules.turn.selfVisitAllowed': false,
    'rules.economy.unclaimedBoardsToCentre': true,
    // S8: three is a MINIMUM on an owned board and never a maximum load.
    'rules.economy.noticeBoardThreshold': 3,
    'rules.economy.noticeBoardBlocks': false,
    // The `3+` rule on a CENTRAL pile, spelled with knobs that already existed:
    // `harvest` is the value that lets Harvest reach the centre at all, and the
    // minimum of 3 is the OUTFLOW half - a pile below three may be taken by
    // nobody and a pile at three or more by ANYBODY.
    'rules.turn.commonsTake': 'harvest',
    'rules.economy.commonsHarvestMin': 3,
  },
});

/** The shipped commons, which this variant's magpie lane must not have moved. */
const COMMONS: GameData = loadGameData({
  name: 'commons-control-test',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'aerodrome.moveCost.barnCards': 2,
    'aerodrome.alwaysInPlay': false,
    'aerodrome.flightMints': false,
    'aerodrome.balloons.balloonDraw.reward.type': 'draw',
    'aerodrome.balloons.balloonDraw.reward.amount': 4,
    'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
    'aerodrome.balloons.balloonBuild.reward.amount': 4,
    'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
    'aerodrome.balloons.balloonSow.reward.amount': 4,
    'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
    'rules.economy.storeCoinsPerCard': 0,
    'rules.economy.coinSupplyPerPlayer': 0,
    'rules.economy.coinPaysBuild': false,
    'rules.economy.coinPaysSuitCost': false,
    'rules.economy.coinPaysGrow': false,
    'rules.economy.coinGrowOnFullBuilding': false,
    'rules.turn.visitCurrency': 'commons',
    'rules.turn.bonusTiming': 'start',
  },
});

const TABLE: Record<number, Suit[]> = {
  2: ['wheat', 'vegetable'],
  3: ['wheat', 'vegetable', 'orchard'],
  4: ['wheat', 'vegetable', 'orchard', 'apiary'],
};

const MIXED: PolicyId[] = ['balanced', 'socialite', 'loyalist', 'racer'];

/** The five Notice Board card ids, by suit, off the catalogue's own flag. */
function boardCards(data: GameData): Record<string, CardId> {
  const out: Record<string, CardId> = {};
  for (const card of data.cards.catalogue) {
    if (card.slot === 'noticeboard' && out[card.suit] === undefined) out[card.suit] = card.id;
  }
  return out;
}

interface Walk {
  readonly moves: readonly Move[];
  readonly ended: boolean;
  readonly crash: string | null;
  /** Central piles on the table at the first decision: (5 - seats), or null. */
  readonly centralBoards: number | null;
  /** Rivals at the first decision: (seats - 1), or null. */
  readonly rivals: number | null;
  /**
   * The term breakdown at the first decision that offered BOTH a play onto a
   * rival's board and a play onto a central one. That is the only position in
   * which `hostGift`'s asymmetry between the two kinds can be read off one
   * decision rather than compared across two.
   */
  readonly bothKinds: ExplainedMove[] | null;
  /**
   * The term breakdown at the first decision that offered a play onto a CENTRAL
   * board, whether or not a rival visit was on offer beside it. Under the
   * shipped commons there is no `visit` move at all, so `bothKinds` can never
   * fill there and this is the only way to read a central play's terms.
   */
  readonly commonsExplain: ExplainedMove[] | null;
  /**
   * The term breakdown at the first decision that offered a Harvest of a
   * CENTRAL pile - the one position that can prove `commonsPileSize` is no
   * longer blind.
   */
  readonly centralHarvest: { explained: ExplainedMove[]; building: CardId } | null;
  /**
   * The central board CARD IDS, read off the commons zone's own keys at the
   * first decision rather than re-derived from which suits are seated. That is
   * the same authority the engine's `centralPileSuit` reads, and it is what
   * makes this helper mode-independent: five ids under the commons, (5 - seats)
   * under the variant, none at all under any other currency.
   */
  readonly central: ReadonlySet<CardId>;
}

function walk(
  data: GameData,
  spec: {
    seats: number;
    seed: string;
    policies: readonly PolicyId[];
    maxMoves?: number;
    explainAs?: PolicyId;
  },
): Walk {
  const policies = spec.policies.map((id) => makePolicy(id));
  const rngs = policies.map((policy, seat) => policyRng(spec.seed, seat, policy.id));
  const maxMoves = spec.maxMoves ?? 6000;
  const idleLimit = spec.seats * 4;
  const explainAs = spec.explainAs ?? 'balanced';
  const cards = boardCards(data);
  const central = new Set<CardId>();

  let state = newGame(data, {
    seats: spec.seats,
    suits: TABLE[spec.seats] as Suit[],
    seed: spec.seed,
  });
  const moves: Move[] = [];
  let idle = 0;
  let crash: string | null = null;
  let bothKinds: ExplainedMove[] | null = null;
  let commonsExplain: ExplainedMove[] | null = null;
  let centralHarvest: Walk['centralHarvest'] = null;
  let centralBoards: number | null = null;
  let rivals: number | null = null;

  try {
    while (!isOver(state) && moves.length < maxMoves && idle < idleLimit) {
      const legal = legalMoves(data, state);
      if (legal.length === 0) throw new Error('No legal moves and the game is not over');
      const seat = (legal[0] as Move).seat;
      const policy = policies[seat];
      const rng = rngs[seat];
      if (!policy || !rng) throw new Error(`No policy for seat ${seat}`);
      const view = viewFor(data, state, seat);
      const ctx = { data, view, moves: legal, rng, probe: makeProber(data, state, seat) };

      if (centralBoards === null) {
        const colours = Object.keys(view.commons?.boards ?? {});
        for (const colour of colours) {
          const id = cards[colour];
          if (id !== undefined) central.add(id);
        }
        centralBoards = colours.length;
        rivals = view.rivals.length;
      }
      if (
        bothKinds === null &&
        legal.some((m) => m.type === 'visit') &&
        legal.some((m) => m.type === 'commons')
      ) {
        // `explain` is deliberately un-narrowed, so every option on offer is in
        // the list - which is what lets one decision carry both kinds.
        bothKinds = scoredPolicy(explainAs).explain?.(ctx) ?? null;
      }
      if (commonsExplain === null && legal.some((m) => m.type === 'commons')) {
        commonsExplain = scoredPolicy(explainAs).explain?.(ctx) ?? null;
      }
      const centralTarget = legal.find((m) => m.type === 'harvest' && central.has(m.building));
      if (centralHarvest === null && centralTarget !== undefined) {
        const explained = scoredPolicy(explainAs).explain?.(ctx);
        if (explained !== undefined) {
          centralHarvest = {
            explained,
            building: (centralTarget as { building: CardId }).building,
          };
        }
      }

      const move = policy.choose(ctx);
      state = apply(data, state, move).state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    crash = error instanceof Error ? error.message : String(error);
  }

  return {
    moves,
    ended: isOver(state),
    crash,
    centralBoards,
    rivals,
    bothKinds,
    commonsExplain,
    centralHarvest,
    central,
  };
}

function playsIn(walked: Walk) {
  const { moves, central } = walked;
  const visits = moves.filter((m) => m.type === 'visit');
  const commons = moves.filter((m) => m.type === 'commons');
  return {
    rival: visits.filter((m) => m.host !== m.seat).length,
    own: visits.filter((m) => m.host === m.seat).length,
    centre: commons.length,
    hosts: new Set(visits.map((m) => m.host)),
    boards: new Set(commons.map((m) => m.board)),
    centralHarvests: moves.filter((m) => m.type === 'harvest' && central.has(m.building)).length,
  };
}

describe("Dean's unclaimed-boards variant, the arm", () => {
  // ⭐ THE READING WITHOUT WHICH NOTHING ELSE IN THE PASS MEANS ANYTHING. Both
  // move kinds share one bonus slot, and the split between them is the decisive
  // number of the whole variant - so a run in which one of the two never
  // happens is measuring the instrument rather than the rules.
  for (const seats of [2, 3, 4]) {
    it(`takes both kinds of play and ends the game at ${seats} seats`, () => {
      const walked = walk(VARIANT, {
        seats,
        seed: `unclaimed-${seats}`,
        policies: MIXED.slice(0, seats),
      });
      expect(walked.crash).toBeNull();
      expect(walked.ended).toBe(true);
      const plays = playsIn(walked);
      expect(plays.rival).toBeGreaterThan(0);
      expect(plays.centre).toBeGreaterThan(0);
      // ⛔ OWN MUST READ ZERO BY CONSTRUCTION. A non-zero own share is a bug in
      // the ban rather than a finding, which is the overlay's own first
      // instruction about what to read.
      expect(plays.own).toBe(0);
      // There are no meeples and no free Draw 1 in this slot.
      expect(walked.moves.filter((m) => m.type === 'spendMeeple')).toHaveLength(0);
      expect(walked.moves.filter((m) => m.type === 'collect')).toHaveLength(0);
      expect(walked.moves.filter((m) => m.type === 'commonsTake')).toHaveLength(0);
    });

    // ⭐ FOUR TARGETS AT EVERY PLAYER COUNT, read off the table the bots
    // actually see rather than off the arithmetic that predicts it: the centre
    // holds (5 - seats) piles and the seat faces (seats - 1) rivals.
    it(`faces exactly four targets at ${seats} seats`, () => {
      const walked = walk(VARIANT, {
        seats,
        seed: `targets-${seats}`,
        policies: MIXED.slice(0, seats),
      });
      expect(walked.crash).toBeNull();
      expect(walked.centralBoards).toBe(5 - seats);
      expect(walked.rivals).toBe(seats - 1);
      expect((walked.centralBoards as number) + (walked.rivals as number)).toBe(4);
      // And every target a bot actually used is one of the four: no seat ever
      // played onto its own board, and no central play landed on a farmed suit.
      const plays = playsIn(walked);
      expect(plays.own).toBe(0);
      for (const board of plays.boards) {
        expect((TABLE[seats] as Suit[]).includes(board)).toBe(false);
      }
    });
  }

  // ⛔ THE DEFECT THIS PASS EXISTS TO FIX, ASSERTED END TO END. With
  // `commonsPileSize` blind, a central pile priced at 0, the `harvest` term
  // scored a flat nothing and the bots simply never took one.
  it('prices a central pile above zero and actually harvests the centre', () => {
    const walked = walk(VARIANT, { seats: 2, seed: 'centre-harvest', policies: MIXED.slice(0, 2) });
    expect(walked.crash).toBeNull();
    expect(walked.centralHarvest).not.toBeNull();
    const { explained, building } = walked.centralHarvest as {
      explained: ExplainedMove[];
      building: CardId;
    };
    const harvests = explained.filter(
      (e) => e.move.type === 'harvest' && e.move.building === building,
    );
    expect(harvests.length).toBeGreaterThan(0);
    // `explain` omits zero contributions, so "present and positive" is the
    // whole assertion: the pile is worth at least `commonsHarvestMin` cards.
    for (const e of harvests) expect(e.terms['harvest']).toBeGreaterThan(0);
    // And a board that never blocks pays nothing for being reopened.
    for (const e of harvests) expect(e.terms['unclogBoard']).toBeUndefined();
    expect(playsIn(walked).centralHarvests).toBeGreaterThan(0);
  });

  // ⛔ THE LEDGER'S C64 UNDER TWO MOVE KINDS AT ONCE, READ OFF ONE DECISION.
  // A rival's board has a host who harvests the fee into their barn; a central
  // board has no host and the card is handed to nobody. That asymmetry IS the
  // variant's headline risk, and it must be visible rather than neutered.
  it('charges hostGift on a rival visit and never on a central play', () => {
    const walked = walk(VARIANT, { seats: 3, seed: 'host-gift', policies: MIXED.slice(0, 3) });
    expect(walked.crash).toBeNull();
    expect(walked.bothKinds).not.toBeNull();
    const explained = walked.bothKinds as ExplainedMove[];
    const rival = explained.filter((e) => e.move.type === 'visit');
    const centre = explained.filter((e) => e.move.type === 'commons');
    expect(rival.length).toBeGreaterThan(0);
    expect(centre.length).toBeGreaterThan(0);
    for (const e of rival) expect(e.terms['hostGift']).toBeLessThan(0);
    for (const e of centre) expect(e.terms['hostGift']).toBeUndefined();
    // The four terms that must fire IDENTICALLY on the two kinds, or the split
    // would be an artefact of which terms happened to claim which move. Every
    // one of them is present on both sides of this same decision.
    for (const e of [...rival, ...centre]) {
      expect(e.terms['handSpend']).toBeLessThan(0);
      expect(e.terms['visitFeeJunk']).toBeLessThan(0);
    }
    // ⛔ AND THE SELF-VISIT TERMS HAVE NO SUBJECT: the ban means the engine
    // never enumerates one, so neither weight can reach the split.
    for (const e of explained) {
      expect(e.terms['selfVisit']).toBeUndefined();
      expect(e.terms['clogOwnBoard']).toBeUndefined();
      expect(e.terms['unclogBoard']).toBeUndefined();
    }
  });

  // ⚠️ THE MAGPIE'S DISPOSAL LANE HAS TO REACH BOTH KINDS OR THE MIRROR'S OWN
  // SPLIT CARRIES A +2 THUMB TOWARD THE RIVAL SIDE. An own-crop card is
  // worthless to a magpie wherever it goes.
  it('opens the magpie disposal lane on both kinds of play', () => {
    const walked = walk(VARIANT, {
      seats: 3,
      seed: 'magpie-lane',
      policies: ['magpie', 'magpie', 'magpie'],
      explainAs: 'magpie',
    });
    expect(walked.crash).toBeNull();
    expect(walked.bothKinds).not.toBeNull();
    const explained = walked.bothKinds as ExplainedMove[];
    const own = (e: ExplainedMove) => e.terms['visitFeeOwnCrop'] ?? 0;
    // At least one play of EACH kind pays with an own-crop card and is credited
    // for it. `explain` is un-narrowed, so every fee on offer is in the list.
    expect(explained.filter((e) => e.move.type === 'visit').some((e) => own(e) > 0)).toBe(true);
    expect(explained.filter((e) => e.move.type === 'commons').some((e) => own(e) > 0)).toBe(true);
  });

  // The property every balance number rests on: a seed is a game.
  it('replays a seed move for move', () => {
    const spec = { seats: 3, seed: 'same-seed', policies: MIXED.slice(0, 3) };
    const first = walk(VARIANT, spec);
    expect(first.crash).toBeNull();
    expect(walk(VARIANT, spec).moves).toEqual(first.moves);
  });
});

describe('the shipped commons, which this variant must not have moved', () => {
  // ⛔ A CONTROL THAT MOVES IS NOT A CONTROL. `visitFeeOwnCrop` was widened to
  // reach a `commons` act, and a `commons` act is what the SHIPPED COMMONS
  // produces too - so the `noticeBoardArm` gate is the whole of what keeps the
  // commons' magpie exactly as weak as every commons number was taken with.
  it('leaves the magpie disposal lane shut on a commons play', () => {
    const walked = walk(COMMONS, {
      seats: 3,
      seed: 'commons-magpie',
      policies: ['magpie', 'magpie', 'magpie'],
      explainAs: 'magpie',
    });
    expect(walked.crash).toBeNull();
    expect(walked.ended).toBe(true);
    expect(walked.moves.filter((m) => m.type === 'commons').length).toBeGreaterThan(0);
    // There is no host under the commons, so there is no `visit` move to pair
    // this against: the assertion is simply that the lane never opens. It is
    // read off the decision that offers the most fees rather than off a
    // decision that offers both kinds, because only one kind exists here.
    expect(walked.moves.filter((m) => m.type === 'visit')).toHaveLength(0);
    const explained = walked.commonsExplain;
    expect(explained).not.toBeNull();
    for (const e of (explained as ExplainedMove[]).filter((x) => x.move.type === 'commons')) {
      expect(e.terms['visitFeeOwnCrop']).toBeUndefined();
    }
  });

  // And the centre the commons has always had is still priced, which is the
  // other half of the `commonsPileSize` change: it was re-pointed, not moved.
  it('still prices its own central piles above zero', () => {
    const walked = walk(COMMONS, {
      seats: 2,
      seed: 'commons-centre',
      policies: MIXED.slice(0, 2),
    });
    expect(walked.crash).toBeNull();
    expect(walked.ended).toBe(true);
    expect(walked.centralBoards).toBe(5);
    expect(walked.centralHarvest).not.toBeNull();
    const { explained, building } = walked.centralHarvest as {
      explained: ExplainedMove[];
      building: CardId;
    };
    const harvests = explained.filter(
      (e) => e.move.type === 'harvest' && e.move.building === building,
    );
    expect(harvests.length).toBeGreaterThan(0);
    for (const e of harvests) expect(e.terms['harvest']).toBeGreaterThan(0);
  });
});
