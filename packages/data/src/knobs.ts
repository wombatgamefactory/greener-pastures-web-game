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
 * There is deliberately no string type. The overlay carries numbers and flags
 * only and may never override card text: the sheet is the single source of truth
 * for wording, and that is what stops the web game and the physical game drifting
 * apart on rules text.
 */
export type KnobType = 'int' | 'number' | 'intOrNull' | 'intArray' | 'boolean';

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

  // --- Economy -------------------------------------------------------------
  {
    template: 'rules.economy.upgradeCostCoins',
    type: 'int',
    description: 'Cost to flip a starter to its upgraded face.',
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
    template: 'rules.economy.farmsteadFlipAtOwnColourBuilds',
    type: 'int',
    description: 'Own-colour deck builds at which the Farmstead flips free.',
  },
  {
    template: 'rules.endGame.furtherTurnsEach',
    type: 'int',
    description: 'Turns each other player takes after the game-end trigger.',
  },

  // --- Hired Workers -------------------------------------------------------
  {
    template: 'workers.hireFee',
    type: 'int',
    description: 'Coins paid to the bank to hire a Worker.',
  },
  {
    template: 'workers.maxPerPlayer',
    type: 'int',
    description: 'How many Workers one player may own at once.',
  },
  {
    template: 'workers.roster.{}.wages',
    type: 'intArray',
    description:
      'The Working Week track, replaced whole. Its LENGTH is the brake on a Worker, especially the Draw Worker; its values are the mint rate.',
  },
  {
    template: 'workers.roster.{}.draw.see',
    type: 'int',
    description: 'Cards the Draw Worker looks at.',
  },
  {
    template: 'workers.roster.{}.draw.keep',
    type: 'int',
    description:
      'Cards the Draw Worker keeps. Must over-deliver against a plain Draw or renting it is net zero.',
  },
  {
    template: 'workers.roster.{}.sow.amount',
    type: 'int',
    description: 'Cards the Sow Worker sows.',
  },

  // --- The island ----------------------------------------------------------
  {
    template: 'island.deliveriesPerTile',
    type: 'int',
    description: 'How many deliveries one tile accepts before it closes.',
  },
  {
    template: 'island.levelRules.{}.vp',
    type: 'int',
    description: 'Receipt VP at this level. The 4/8/16 versus 5/10/20 question lives here.',
  },
  {
    template: 'island.levelRules.{}.coinsPerDelivery',
    type: 'int',
    description: 'Coins the bank pays on every delivery at this level.',
  },
  {
    template: 'island.levelRules.{}.crates',
    type: 'int',
    description: 'Crates printed on a tile at this level. Each crate carries one suit demand.',
  },
  {
    template: 'island.levelRules.{}.cardsPerCrate',
    type: 'int',
    description:
      'Barn cards of the matching suit needed to pay one crate. Total tile cost is crates times this. Currently disputed between sources.',
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
