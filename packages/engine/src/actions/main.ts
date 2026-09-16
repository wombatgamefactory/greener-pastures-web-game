/**
 * The main-action umbrella: has this seat any legal main action at all?
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import { drawableSuits } from '../query.js';
import type { GameState, Seat } from '../state.js';
import type { GameData } from '@gp/data';
import { anyBuildOption } from './build.js';
import { anyDeliverOption } from './deliver.js';
import { growOptions } from './grow.js';
import { harvestOptions } from './harvest.js';

// --- The main-action umbrella ---------------------------------------------

/**
 * Is ANY main action legal? Decides whether `pass` is offered (and nothing else
 * is).
 *
 * It must list the MAIN actions and only those. The GBP 2 upgrade came out of
 * this list on 19/08/2026 when it moved into the bonus slot, because leaving it
 * in would suppress `pass` for a seat whose only remaining option was a bonus -
 * and that seat would then have no legal move at all. The same trap waits for
 * anything that is added here.
 */
export function hasMainOption(data: GameData, state: GameState, seat: Seat): boolean {
  return (
    drawableSuits(data, state).length > 0 ||
    anyBuildOption(data, state, seat) ||
    growOptions(data, state, seat).length > 0 ||
    harvestOptions(data, state, seat).length > 0 ||
    anyDeliverOption(data, state, seat)
  );
}
