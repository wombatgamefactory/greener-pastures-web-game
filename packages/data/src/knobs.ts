/**
 * The knob registry: the declared balance surface.
 *
 * A tuning overlay may write to a path only if a template here covers it. That
 * restriction is the point. Without it a typo'd path is a silent no-op, and a
 * balance run quietly measures the baseline while claiming to measure a change.
 *
 * Templates use `{}` for a wildcard segment. Expansion happens against the real
 * data, so the legal values of a wildcard are whatever is actually there: no
 * separate list of card ids to keep in sync, and a card that leaves the game
 * takes its knobs with it.
 *
 * Adding a knob is one line here. Adding a knob that has no home in the data is
 * a design change first, not a tuning change.
 *
 * ⭐ v31 (02/09/2026) removed fourteen templates in one edit and added six. Every
 * one of the fourteen was a coin, a starter upgrade, a hand limit or a printed
 * face - `startingCoins`, `buyCost`, `marketCost`, `upgradeIsBonus`,
 * `upgradeCostCoins`, `coinPityDivisor`, the four `visitPayout` branches,
 * `giftDiscardCoins`, `serviceThreshold`, `ownerActivationCost`, `visitWage`,
 * `handToBarn`, `buildCost.coins`, `faces.{}.threshold`, `faces.{}.handSize`.
 * The six new ones are the levers v31 introduced and nobody has ever swept:
 * `bonusDraw`, `selfVisitAllowed`, and the four `island.meeples` knobs.
 *
 * ⭐ ONE OF THE FOURTEEN CAME STRAIGHT BACK, and not at the same path.
 * `rules.turn.handLimit` reinstates the hand limit on the same day it was
 * deleted, as ONE GLOBAL NUMBER rather than as `faces.{}.handSize` - five
 * printed per-suit values. That is the whole difference between the old knob and
 * this one: the old one was a card value with five expansions and no way to
 * sweep the rule itself, this one is a single lever and the Barn still prints
 * nothing. What the deletion measured is on the template below, and it is the
 * most useful paragraph in this file to read before touching a draw knob.
 */

import { flatten } from './paths.js';
import type { Leaf } from './paths.js';

/**
 * `int` and `number` are self-explanatory. `intOrNull` covers the knobs whose
 * null disables a rule outright (the wild substitution, a threshold override, an
 * unthresholded card). `intArray` covers the island's VP schedule, which is
 * replaced whole. `boolean` covers the enable flags and the two turn-structure
 * switches.
 *
 * `cropOrWild` is the one and only string-valued type, added 2026-08-16 for the
 * Tier 3 wild-activation arm. It is NOT a general string knob: its legal values
 * are the five crop names, `wild` and null, and nothing else, so it can name a
 * GROW payment rule and can never carry a word a player would read. The ban
 * below stands unweakened - the overlay may still never override card TEXT,
 * because the sheet is the single source of truth for wording and that is what
 * stops the web game and the physical game drifting apart on rules text.
 */
export type KnobType =
  | 'int'
  | 'number'
  | 'intOrNull'
  | 'intArray'
  | 'boolean'
  | 'cropOrWild'
  | 'bonusTiming'
  | 'balloonReward';

export interface KnobTemplate {
  /** Dotted path, `{}` for a wildcard segment. */
  readonly template: string;
  readonly type: KnobType;
  readonly description: string;
}

export interface Knob {
  readonly path: string;
  readonly type: KnobType;
  readonly description: string;
  readonly baseValue: Leaf;
}

export const KNOB_TEMPLATES: readonly KnobTemplate[] = [
  // --- Setup and turn structure -------------------------------------------
  {
    template: 'rules.setup.startingHand',
    type: 'int',
    description:
      'Cards drawn to hand at setup, from your own suit deck. Lowered 5 -> 4 by v31, in the same ' +
      'pass that removed the hand limit and made the plain Draw keep both cards - so the opening ' +
      'hand is smaller but grows faster, and the two changes have never been measured apart. This ' +
      'is the dial if the first three turns feel like a stall.',
  },
  {
    template: 'rules.setup.startingBarnCards',
    type: 'int',
    description:
      'Cards seeded into each barn at setup. 0 since v31: the barn starts empty, so the first ' +
      'delivery is strictly later than it used to be and the opening is a card-gathering phase ' +
      'whether the seat wants one or not.',
  },
  { template: 'rules.turn.actionsPerTurn', type: 'int', description: 'Main actions per turn.' },
  {
    template: 'rules.turn.bonusSlotsPerTurn',
    type: 'int',
    description:
      'Bonus options per turn: Draw 1, or place a card on a Notice Board and take that suit action.',
  },
  {
    template: 'rules.turn.baseDraw.see',
    type: 'int',
    description: 'Cards a plain Draw action reveals.',
  },
  {
    template: 'rules.turn.baseDraw.keep',
    type: 'int',
    description:
      'Cards a plain Draw action keeps. Equal to `see` since v31 - Draw 2, keep both, discard ' +
      'nothing. Setting it below `see` restores the v13 draw-and-discard.',
  },
  {
    template: 'rules.turn.bonusDraw',
    type: 'int',
    description:
      '⭐ THE YARDSTICK EVERY DOOR HAS TO BEAT. Cards the free bonus option gives, taken instead ' +
      'of placing a card on a Notice Board. It exists so the bonus slot is never dead (an empty ' +
      'hand has no card to place), and it silently prices all five doors: a door costs 1 card, so ' +
      'it must return more than this plus one to be worth taking. Raising it is the cheapest way ' +
      'to kill every door in the game at once, and the Orchard door at Draw 3 is the only one with ' +
      'a margin worth reading. Sweep it with the Orchard door, never alone.',
  },
  {
    template: 'rules.turn.handLimit',
    type: 'intOrNull',
    description:
      '⭐ THE HAND LIMIT, ONE GLOBAL RULE AT 7 (Dean: reinstated at 12 on 02/09/2026, reversing one v31 ' +
      'change on evidence, then cut to 7 the same day). Cards you may still hold when your turn ENDS; you may exceed it ' +
      'mid-turn and the overflow discards at the boundary. null restores v31 no-limit, which is ' +
      'the control arm and should not be run without reading what it measured: deleting the limit ' +
      'also deleted the only bound on the legal-move enumerator, and a 2-seat position reached ' +
      '43,879 legal moves (43,845 of them build payments) at hands of 34, taking a game from ~0.1s ' +
      'to 1-15 minutes and reducing the whole watch-list suite to n=8. It is a knob rather than a ' +
      'constant because 12 is a guess: three turns of accumulation above the 4-card opening hand. ' +
      'SWEEP IT WITH THE THING IT PRICES, never alone - a hand limit is a diminishing return on ' +
      'drawing, so it is the brake on rules.turn.bonusDraw and on every door that draws. Read the ' +
      'bonus mix and the median hand together; overlays/hand-limit.sweep.json is the ladder.',
  },
  {
    template: 'rules.turn.selfVisitAllowed',
    type: 'boolean',
    description:
      '⭐ RISK 2 OF v31. True: you may place your bonus card on your OWN Notice Board and take ' +
      "your own suit action. It is a solitaire door bought with the interaction door's currency, " +
      'which is the exact shape that has crowded the visit out in every previous version of this ' +
      'game; its only brake is that your card clogs your own board in two placements and shuts ' +
      'your own door. FALSE IS THE PAIRED CONTROL. Read the bonus mix four ways - Draw 1 / visit a ' +
      'neighbour / visit yourself / slot unspent - and never let an assertion pool the two visits.',
  },
  {
    template: 'rules.turn.bonusTiming',
    type: 'bonusTiming',
    description:
      '⭐ WHEN THE BONUS OPTION MAY BE TAKEN, and a CORRECTION rather than an experiment ' +
      "(Dean, 03/09/2026). 'end' IS THE RULE: meeples, then your core action, then the bonus. " +
      "The engine and both design docs carried 'start' from 19/08/2026 and were wrong about the " +
      "game. 'start' is now the paired control (overlays/bonus-first.overlay.json) and 'any' is " +
      "v14's once-per-turn-any-point (overlays/bonus-any-time.overlay.json). " +
      '⚠️ THE THREE ARE NOT ORDERABLE BY POWER, so do not read this as a buff or a nerf. ' +
      "Under 'start' a door can FUEL the action after it (Orchard door for Draw 3, then Build " +
      "with the cards); under 'end' the action can SET THE DOOR UP (fill a building, then " +
      'Harvest it through the Wheat door; harvest into the barn, then Deliver through the ' +
      'Vegetable one). The doors whose value is conditional on the turn so far - Wheat and ' +
      'Vegetable - gain most, and those are the two the door mix says are underused, so watch ' +
      'the DOOR MIX and not only the visit rate. SLOT UNSPENT still reads the window, but its ' +
      'absolute is a rational floor a bot cannot fail and only the delta between arms means ' +
      'anything.',
  },

  // --- Economy -------------------------------------------------------------
  {
    template: 'rules.economy.noticeBoardThreshold',
    type: 'intOrNull',
    description:
      "⭐ THE ONLY ECONOMY NUMBER LEFT, AND THE BALANCE LEVER. The door's threshold: how many " +
      'cards a Notice Board holds before it clogs and the farm shuts to visitors - and, since v31, ' +
      'to its owner too. An OVERRIDE of the printed face, kept as one because the value is a ' +
      'ruling and the face is generated; null hands the number back to the card, which now prints ' +
      '2 as well. The only lever ever measured to move the suit balance: t=4 gave Orchard 80.8%, ' +
      't=3 62.8%, t=2 42.0% against an even share of 36.4% on the two-building surface, and on the ' +
      'single-door surface t=5 clogged 2.3% of turn boundaries, t=3 5%, t=2 11%. In v31 it also ' +
      'throttles self-visits, so it is doing more work than any arm has measured.',
  },
  {
    template: 'rules.endGame.furtherTurnsEach',
    type: 'int',
    description: 'Turns each other player takes after the game-end trigger.',
  },
  {
    template: 'rules.endGame.deliveriesToTrigger',
    type: 'int',
    description:
      '⭐ THE FIRST KNOB TO SWEEP AFTER v31. Island deliveries by one seat that fire the end of ' +
      'the game. The whole clock of the flat island, and flat across seat counts - at 6 that is ' +
      'half the 2-seat board, a third of the 3-seat and a quarter of the 4-seat. v31 makes a turn ' +
      'materially more powerful (the bonus slot buys a whole core action for one card, and meeples ' +
      'add uncapped free ones), so the same 6 deliveries arrive sooner: expect a shorter game and ' +
      'higher scores before anything is dialled. overlays/end-trigger-8.overlay.json is the arm.',
  },

  // --- The five doors ------------------------------------------------------
  {
    template: 'workers.roster.{}.draw.see',
    type: 'int',
    description: 'Cards the Orchard door looks at.',
  },
  {
    template: 'workers.roster.{}.draw.keep',
    type: 'int',
    description:
      '⭐ THE ONE PRINTED EXCEPTION IN THE DOOR SET, AT 3. A visitor pays 1 card, and the bonus ' +
      "slot's other option is a free Draw 1, so a Draw 2 door nets exactly what the free option " +
      'gives for nothing and would be strictly worse than its own alternative. Draw 3 nets +2, ' +
      'which is the whole margin the Orchard board has. overlays/orchard-door-draw-two-v1.overlay.json ' +
      'is the paired control that measures the door dying.',
  },
  {
    template: 'workers.roster.{}.sow.amount',
    type: 'int',
    description:
      'Cards the Apiary door sows. It sows FROM THE HAND in v31, so a visitor pays 2 cards for 1 ' +
      'threshold step and this is the weakest door on the table by some distance - ruled that way ' +
      'knowingly. If the Apiary board takes no traffic, the fix is the source (back to a deck top), ' +
      'not this number.',
  },

  // --- The island ----------------------------------------------------------
  {
    template: 'island.vpByDeliveryOrder',
    type: 'intArray',
    description:
      "The flat island in one array: entry i is the VP the (i+1)th delivery to a tile takes, and the length is how many deliveries a tile accepts. [6, 3] is the game's only remaining time gradient - first to a tile is worth double second - and it replaced both the 4/8/16 level VP and the fill-order bonus strip. Replaced whole: shortening it closes a delivery space, lengthening it opens one and forces both the new price AND a third meeple out of a 25-deep bag to be found in the same edit.",
  },
  {
    template: 'island.cardsPerSubstitution',
    type: 'intOrNull',
    description:
      'Cards of any crops that stand in for one card the island asked for. null restores exact matching, which is the control arm. This is the dial on the barn queue: ticket 38 proved the block is MATCHING under an all-or-nothing crate payment, not quantity, so this is the only lever that touches the actual cause. Lower is looser - at 2 the colour puzzle survives because matching is still cheaper, and the rate self-scales because only a big barn can afford to substitute.',
  },
  {
    template: 'island.tileRule.crates',
    type: 'int',
    description: 'Crates printed on every tile. Each crate carries one suit demand token.',
  },
  {
    template: 'island.tileRule.cardsPerCrate',
    type: 'int',
    description:
      'Barn cards of the matching suit that pay one crate. Total tile cost is crates times this, so 4 at every tile. The pair, not the tile, is the unit a player reads.',
  },
  {
    template: 'island.meeples.perColour',
    type: 'int',
    description:
      "Meeples of each colour in the bag. 5 was chosen because 25 is the smallest flat pool that covers a 4-seat board's 24 delivery spaces, which is a component argument rather than a design one - so it is untested in every sense. CONSEQUENCE TO READ FIRST: 24 of 25 are drawn at 4 seats, so the island's colour mix is nearly deterministic there, while at 2 seats only 12 are drawn and it is a genuine sample. Move `poolSize` with this or the two disagree and data.test.ts fails, which is what that assertion is for.",
  },
  {
    template: 'island.meeples.poolSize',
    type: 'int',
    description:
      'Total meeples in the bag. Stored rather than derived precisely so that an overlay cannot half-change the pool: it must equal perColour times the number of colours, and the test says so.',
  },
  {
    template: 'island.meeples.perDeliverySpace',
    type: 'int',
    description:
      'Meeples seeded onto each island delivery space at setup. At 1 the bag is drained to 12 / 18 / 24 by seat count; at 2 a 4-seat board would need 48 and the bag does not hold them, so raising this means raising the pool in the same overlay.',
  },
  {
    template: 'island.meeples.faceUpAtSetup',
    type: 'boolean',
    description:
      "True: every delivery space's meeple is visible from setup, so the whole table can read which actions the island is offering and in what order before anybody delivers. That legibility is the point of the component, and false is the arm that asks how much of the meeple's pull is the information rather than the action.",
  },
  {
    template: 'island.slotsBySeats.{}.{}',
    type: 'int',
    description: 'Tiles in play at this seat count and level. Sets the length of the game.',
  },
  {
    template: 'island.decksInPlayBySeats.{}',
    type: 'int',
    description: 'Suit decks on the table at this seat count.',
  },
  {
    template: 'island.demandTokensBySeats.{}.perSuit',
    type: 'int',
    description: 'Demand tokens per suit in the pool.',
  },
  {
    template: 'island.demandTokensBySeats.{}.wild',
    type: 'int',
    description: 'Cornucopia (wild) tokens in the pool. Raising this loosens the colour puzzle.',
  },

  // --- The aerodrome -------------------------------------------------------
  {
    template: 'aerodrome.moveCost.barnCards',
    type: 'int',
    description: 'Barn cards, of differing suits, spent to move a balloon.',
  },
  {
    template: 'aerodrome.handMoveCost',
    type: 'int',
    description:
      "Cards discarded from HAND by the alternative flight payment Vegetable's Depots print (V4, V8). The base barn cost is untouched and this is a second route in, not a discount. Its number was set when the game had a hand limit and a draw-and-discard, and v31 has neither, so the measurement behind it (flights 0.54 -> 1.22 at n=1580) was taken in a game where hand cards were dearer than they are now. Re-read before trusting it.",
  },
  {
    template: 'aerodrome.balloons.{}.reward.type',
    type: 'balloonReward',
    description:
      '\u2b50 WHAT A BALLOON PAYS, as a type rather than a size. Added 03/09/2026 so that a ' +
      'reward can be REPLACED by an arm and not only resized, which is what the Vegetable question ' +
      'needs: sweeping the amounts from 1 to 8 moved the Vegetable win rate by 0.7 of a point and ' +
      'left its three intervals overlapping, so magnitude is measurably NOT the lever. ' +
      "'meepleFromBag' is the one reward denominated in ACTIONS rather than cards. \u26a0\ufe0f Changing " +
      'a type without changing `rewardText` leaves the printed card lying about itself, which ' +
      'matters for a screenshot and not for a run - the engine reads the type, the card face reads ' +
      'the text.',
  },
  {
    template: 'aerodrome.balloons.{}.reward.amount',
    type: 'int',
    description:
      'Size of a balloon reward. Matches three of the four balloons: the magenta one became "harvest any building, even if it is not full" in v31 and carries no amount, because a permission has no size.',
  },

  // --- Per-card ------------------------------------------------------------
  {
    template: 'cards.catalogue.{}.enabled',
    type: 'boolean',
    description:
      'Whether this card is in the game at all. Setting it false is how a paired comparison run asks whether the game is better without the card.',
  },
  {
    template: 'cards.catalogue.{}.threshold',
    type: 'intOrNull',
    description:
      'Cards a building holds before it is full and clogged. Flat since v31: starters print one face, so a Notice Board threshold is one path and not two.',
  },
  {
    template: 'cards.catalogue.{}.activationType',
    type: 'cropOrWild',
    description:
      "The crop a GROW must pay into this building, or 'wild' for any card. null is a card " +
      'that cannot be grown at all, and setting a null one is a design change wearing a ' +
      "knob's clothes - the extractor reads null threshold plus null activation as the ACTION " +
      'card, and this knob does not move the threshold with it.',
  },
  {
    template: 'cards.catalogue.{}.printedVp',
    type: 'int',
    description: 'VP printed on a built card. 0 on all fifteen starters since v31.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.suit',
    type: 'int',
    description:
      'Own-suit cards in a build cost. Since v31 this is also how the 30 Power and Endgame cards ' +
      'are paid for: their two coin icons became two crop icons of their own suit, which is one ' +
      'of the two pulls behind risk 3, the monoculture problem.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.wild',
    type: 'int',
    description: 'Any-suit cards in a build cost.',
  },
];

function templateToRegExp(template: string): RegExp {
  const pattern = template
    .split('.')
    .map((segment) => (segment === '{}' ? '[^.]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\.');
  return new RegExp(`^${pattern}$`);
}

/**
 * Expand the templates against real data. Every returned knob addresses a leaf
 * that exists, so an empty expansion for a template means that template is dead
 * and should be deleted, not that the caller did something wrong.
 */
export function listKnobs(data: unknown): Knob[] {
  const leaves = flatten(data);
  const knobs: Knob[] = [];
  const claimed = new Set<string>();

  for (const spec of KNOB_TEMPLATES) {
    const re = templateToRegExp(spec.template);
    for (const [path, baseValue] of leaves) {
      if (!re.test(path) || claimed.has(path)) continue;
      claimed.add(path);
      knobs.push({ path, type: spec.type, description: spec.description, baseValue });
    }
  }
  return knobs;
}

/** Templates that matched nothing. A dead template is a stale registry entry. */
export function deadTemplates(data: unknown): string[] {
  const leaves = [...flatten(data).keys()];
  return KNOB_TEMPLATES.filter((spec) => {
    const re = templateToRegExp(spec.template);
    return !leaves.some((path) => re.test(path));
  }).map((spec) => spec.template);
}
