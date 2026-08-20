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
 */

import { flatten } from './paths.js';
import type { Leaf } from './paths.js';

/**
 * `int` and `number` are self-explanatory. `intOrNull` covers the knobs whose
 * null disables a rule outright (the coin pity rate, an unthresholded card).
 * `intArray` covers a Working Week track, which is replaced whole. `boolean`
 * covers the enable flags.
 *
 * `cropOrWild` is the one and only string-valued type, added 2026-08-16 for the
 * Tier 3 wild-activation arm. It is NOT a general string knob: its legal values
 * are the five crop names, `wild` and null, and nothing else, so it can name a
 * GROW payment rule and can never carry a word a player would read. The ban
 * below stands unweakened - the overlay may still never override card TEXT,
 * because the sheet is the single source of truth for wording and that is what
 * stops the web game and the physical game drifting apart on rules text.
 */
export type KnobType = 'int' | 'number' | 'intOrNull' | 'intArray' | 'boolean' | 'cropOrWild';

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
    description: 'Cards drawn to hand at setup.',
  },
  {
    template: 'rules.setup.startingBarnCards',
    type: 'int',
    description: 'Cards seeded into each barn at setup.',
  },
  {
    template: 'rules.setup.startingCoins',
    type: 'int',
    description: 'Coins each player starts with.',
  },
  { template: 'rules.turn.actionsPerTurn', type: 'int', description: 'Main actions per turn.' },
  {
    template: 'rules.turn.bonusSlotsPerTurn',
    type: 'int',
    description: 'Free bonus slots per turn (work your own Worker, or Visit).',
  },
  {
    template: 'rules.turn.baseDraw.see',
    type: 'int',
    description: 'Cards a plain Draw action reveals.',
  },
  {
    template: 'rules.turn.baseDraw.keep',
    type: 'int',
    description: 'Cards a plain Draw action keeps.',
  },
  {
    template: 'rules.turn.buyCost',
    type: 'intOrNull',
    description:
      'Coins for the once-per-turn free BUY: one card, blind, off the top of a deck that is not your own suit. Null deletes the rule. The exchange rate between the currency the game mints and the currency it is throttled by, so it is the balance number of the whole economy.',
  },
  {
    template: 'rules.turn.marketCost',
    type: 'intOrNull',
    description:
      'Coins for BUY AT MARKET, the adopted bonus-slot coin sink (docs/Market Bonus Action 2026-08-03.md): top card of any one deck in play, own suit included, into the barn, revealed. Consumes the bonus slot, so it competes with the visit - which is the point, and the risk. Null deletes the rule. The doc names GBP 2 as broken and GBP 4 as the fallback dial.',
  },
  {
    template: 'rules.turn.bonusAtStartOnly',
    type: 'boolean',
    description:
      'True: the bonus slot may be taken only at the START of your turn, before the main action ' +
      '(Dean, 19/08/2026). False restores v14 "once per turn, any point". Set false together ' +
      'with upgradeIsBonus, buyCost and marketCost to reach the pre-19/08 turn, which is the ' +
      'paired control for the turn-structure arm. On its own it answers the one question no ' +
      'report has ever measured: does forcing the choice to the top of the turn cost visits?',
  },
  {
    template: 'rules.turn.upgradeIsBonus',
    type: 'boolean',
    description:
      'True: flipping a starter for coins is a BONUS-slot option (Dean, 19/08/2026). False: it ' +
      'costs the whole main action, as it did until then - the shape the 2026-07-14 table ' +
      'measured as "nobody upgraded a starter". Read the upgrade take rate AND its timing: an ' +
      'upgrade spike in the opening rounds followed by a visit-heavy midgame is a PASS, because ' +
      'the option is capped at three flips a seat and cannot crowd the visit out all game.',
  },

  // --- Economy -------------------------------------------------------------
  {
    template: 'rules.economy.noticeBoardThreshold',
    type: 'intOrNull',
    description:
      "The door's threshold: how many rival cards a Notice Board holds before it clogs and the " +
      'farm shuts to visitors. An OVERRIDE of the printed face (the sheet prints 5), authored ' +
      'because the value is a ruling and the face is generated from the spreadsheet. Ruled 2 on ' +
      '20/08/2026; null hands the number back to the card. The only lever ever measured to move ' +
      'the suit balance: t=5 clogs 2.3% of turn boundaries, t=3 5%, t=2 11%, evenness best at 2. ' +
      '4 - one full delivery of freight - is unarmed and not refuted.',
  },
  {
    template: 'rules.economy.upgradeCostCoins',
    type: 'int',
    description:
      'Cost to flip a starter to its upgraded face - all three of them since 2026-08-12, when ' +
      "the Farmstead's free flip at the own-crop milestone was retired and it went on sale at " +
      'the same price. Now the widest single dial on the upgrade layer.',
  },
  {
    template: 'rules.economy.coinPityDivisor',
    type: 'intOrNull',
    description: 'Coins per 1 VP at game end. Null deletes the rule. Flagged OPEN in the design.',
  },
  {
    template: 'rules.economy.visitPayout.base',
    type: 'int',
    description: 'Coins the bank pays a visitor who takes the money instead of a Worker.',
  },
  {
    template: 'rules.economy.visitPayout.upgraded',
    type: 'int',
    description: 'The same, at an upgraded Notice Board.',
  },
  {
    template: 'rules.economy.visitPayout.upgradedAction',
    type: 'int',
    description:
      'Coins the bank pays a visitor who takes the ACTION at an upgraded Notice Board. A base ' +
      'board always pays the action branch nothing. 0 is the paired control for the 2026-08-13 ' +
      'upgraded face.',
  },
  {
    template: 'rules.economy.visitPayout.twoCard',
    type: 'intOrNull',
    description:
      "Special Orders' 2-card mode: the coins the bank pays a visitor who places two cards " +
      'instead of one. Upgraded boards only, and never a Worker payoff. Null deletes the rule, ' +
      'which is what ships since change 6 retired Special Orders.',
  },
  {
    template: 'rules.economy.giftDiscardCoins',
    type: 'int',
    description:
      'The coin the upgraded Orchard Farmstead mints per card it gives away at the discard ' +
      'divert seam. Flagged in the rebuild as the number most likely to be wrong, at roughly £8-10 ' +
      'a game where seats currently end with £1. 0 leaves the gift free.',
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
      'Island deliveries by one seat that fire the end of the game. The whole clock of the flat island, and flat across seat counts - at 6 that is half the 2-seat board, a third of the 3-seat and a quarter of the 4-seat, so this is the dial if 2p runs long.',
  },

  // --- The suit Services ---------------------------------------------------
  {
    template: 'workers.serviceThreshold',
    type: 'int',
    description:
      "Cards a Service holds before it clogs and its owner must Harvest it. The brake that replaced the Working Week track: a popular Service fills faster, so popularity buys its owner a barn of mixed colour and costs them a Harvest action. 4 against the Notice Board's 5, because the card supply did not double when the second visit target arrived.",
  },
  {
    template: 'workers.ownerActivationCost',
    type: 'int',
    description:
      'Coins the OWNER pays the bank to activate their own Service from the bonus slot. The reason a coin is never dead and the reason income is compulsory: a seat that never visits anybody eventually cannot afford to run their own farm. 0 makes the own-use free, which is the hermit-battery shape v14 had to kill once already.',
  },
  {
    template: 'workers.visitWage',
    type: 'int',
    description:
      'Coins the bank mints to the OWNER when a RIVAL activates their Service. SHIPPED AT 0 (Dean, 2026-08-10): the card that lands on the Service is the payment, and being useful is paid in freight rather than coin. Raising it turns the Service back into a faucet, which is what the first build shipped and what overlays/service-wage-one.overlay.json restores.',
  },
  {
    template: 'workers.roster.{}.draw.see',
    type: 'int',
    description: 'Cards the Draw Service looks at.',
  },
  {
    template: 'workers.roster.{}.draw.keep',
    type: 'int',
    description:
      'Cards the Draw Service keeps. Must over-deliver against a plain Draw or buying it is net zero.',
  },
  {
    template: 'workers.roster.{}.sow.amount',
    type: 'int',
    description: 'Cards the Sow Service sows off the deck tops.',
  },
  {
    template: 'workers.roster.{}.handToBarn',
    type: 'int',
    description:
      "Optional hand cards into your own barn on the Wheat and Vegetable Services. Wheat's lands after the harvest (a junk sink), Vegetable's before the delivery (which IS 'pay 1 card of the cost from hand').",
  },

  // --- The island ----------------------------------------------------------
  {
    template: 'island.vpByDeliveryOrder',
    type: 'intArray',
    description:
      "The flat island in one array: entry i is the VP the (i+1)th delivery to a tile takes, and the length is how many deliveries a tile accepts. [6, 3] is the game's only remaining time gradient - first to a tile is worth double second - and it replaced both the 4/8/16 level VP and the fill-order bonus strip. Replaced whole, like a Working Week track: shortening it closes a delivery space, lengthening it opens one and forces the new price to be named.",
  },
  {
    template: 'island.cardsPerSubstitution',
    type: 'intOrNull',
    description:
      'Cards of any crops that stand in for one card the island asked for. null restores exact matching, which is the control arm. This is the dial on the barn queue: ticket 38 proved the block is MATCHING under an all-or-nothing crate payment, not quantity, so this is the only lever that touches the actual cause. Lower is looser - at 2 the colour puzzle survives because matching is still cheaper, and the rate self-scales because only a big barn can afford to substitute.',
  },
  {
    template: 'island.tileRule.coinsPerDelivery',
    type: 'int',
    description: 'Coins the bank pays on every island delivery. Flat £1 since 2026-08-09.',
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
      "Cards discarded from HAND by the alternative flight payment Vegetable's Depots print (V4, V8). The base barn cost is untouched and this is a second route in, not a discount. THE SUIT'S FIRST DIAL: its central risk is the hand starving, because activation costs, sowing, consignment, the visit and this all come out of a hand of 5, and an empty hand cannot visit. Drop it to 1 if a Vegetable seat's visits per turn fall below the table's 0.52.",
  },
  {
    template: 'aerodrome.balloons.{}.reward.amount',
    type: 'int',
    description: 'Size of a balloon reward.',
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
    description: 'Cards a building holds before it is full and clogged.',
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
    description: 'VP printed on a built card.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.suit',
    type: 'int',
    description: 'Own-suit cards in a build cost.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.wild',
    type: 'int',
    description: 'Any-suit cards in a build cost.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.coins',
    type: 'int',
    description: 'Coins in a build cost.',
  },
  {
    template: 'cards.catalogue.{}.upgradeCostCoins',
    type: 'int',
    description: 'Per-starter override of the standard upgrade price.',
  },
  {
    template: 'cards.catalogue.{}.faces.{}.threshold',
    type: 'intOrNull',
    description: 'Threshold on one printed face of a starter.',
  },
  {
    template: 'cards.catalogue.{}.faces.{}.handSize',
    type: 'intOrNull',
    description: 'Absolute hand size printed on a Barn face. The master clock of the whole game.',
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
