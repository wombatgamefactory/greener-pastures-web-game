/**
 * The weight tables. One reference table, four archetype overrides.
 *
 * Ticket 10's reason for archetypes over one heuristic: a card that only one
 * taste likes then reads as an archetype artefact rather than a card problem,
 * which is the difference between "cut this card" and "this card is for the
 * socialite". The balance runs seat mixed profiles by default for exactly that.
 *
 * These numbers are a starting position, not a tuned one - tuning cannot begin
 * before ticket 11 has win rates to tune against. They were set so that every
 * mechanism the v14 watch-list needs measured actually gets exercised: hiring,
 * the £2 upgrade sinks, renting a rival's Worker, and the optional tasks the
 * reference bot skips wholesale.
 */

import { TERM_NAMES } from './terms.js';

export type WeightTable = Readonly<Record<string, number>>;

/**
 * `balanced` - the reference table, and the `normal` rung of the ladder.
 *
 * Rough intended ordering at a typical decision: deliver a Level 2/3 tile >
 * unclog your own Notice Board > hire > visit > build > harvest > grow > draw >
 * end the turn. Deliver's feature is the tile's printed VP (4 / 8 / 16), so its
 * weight of 3 puts a Level 1 delivery at 12 and a Level 3 at 48.
 */
export const BALANCED: WeightTable = {
  deliver: 3,
  deliverClimb: 5,
  deliverCost: -0.5,
  balloon: 2,

  harvest: 1.5,
  unclogBoard: 6,
  grow: 2.5,
  growCompletes: 3,
  sow: 1.5,
  sowCompletes: 2,

  build: 3,
  buildVp: 1.5,
  buildOwnCrop: 2,
  buildSpend: -0.8,
  hire: 8,
  upgrade: 4,
  upgradeMilestone: 6,

  drawAction: 1.2,
  deckOwnCrop: 1,
  deckDemand: 0.8,
  keepValue: 2,
  keepOwnCrop: 1.5,
  discardJunk: 2,

  visit: 6,
  visitWorker: 2,
  visitSpecial: 1.5,
  visitFeeJunk: 1.5,
  workOwn: 5,
  workerTask: 3,

  cardMove: 2,
  cardMoveSpend: 1.5,
  skip: -1,
  cardTask: 1,
  pass: -50,
  endTurn: -2,
};

/**
 * The four archetypes, as partial overrides of the reference table.
 *
 * `hermit` is the control for watch-list assertion 8 ("did players watch each
 * other"): a hermit mirror SHOULD report solitaire, and a run where it does not
 * means the assertion has no teeth. Its visit weight is prohibitive rather than
 * literally 0 because `visitFeeJunk` is negative-only - at weight 0 a visit
 * would still be worth slightly more than nothing on a turn with no other
 * option, and "never" has to mean never for a control.
 */
export const PROFILES: Readonly<Record<string, WeightTable>> = {
  balanced: {},
  hermit: { visit: -100, visitWorker: 0, visitSpecial: 0, visitFeeJunk: 0, cardMove: -100 },
  socialite: { visit: 14, visitWorker: 5, visitSpecial: 4, workOwn: 2, cardMove: 5 },
  loyalist: { buildOwnCrop: 6, deckOwnCrop: 4, keepOwnCrop: 4, upgradeMilestone: 10, upgrade: 6 },
  racer: { deliver: 6, deliverClimb: 10, deliverCost: -0.2, harvest: 2.5, drawAction: 0.8 },
};

export function weightsFor(profile: string): WeightTable {
  const override = PROFILES[profile];
  if (!override) throw new Error(`Unknown weight profile ${profile}`);
  return { ...BALANCED, ...override };
}

/**
 * Every weight names a real term and every term has a weight. Cheap, but it is
 * what stops a renamed term from silently scoring 0 in every profile.
 */
export function checkWeightTable(table: WeightTable): string[] {
  const problems: string[] = [];
  const known = new Set(TERM_NAMES);
  for (const name of Object.keys(table)) {
    if (!known.has(name)) problems.push(`weight for unknown term "${name}"`);
  }
  for (const name of TERM_NAMES) {
    if (!(name in table)) problems.push(`term "${name}" has no weight`);
  }
  return problems;
}
