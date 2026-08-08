/**
 * Suit Service mechanics: performing a Service's ENHANCED action.
 *
 * What used to live here as well - the Working Week track's advance, wage and
 * expiry arithmetic - is gone with the Hiring Fair (2026-08-10). The wage is now
 * minted where the card is placed (doVisit), because the card landing on the
 * Service IS the use, and the Service's own threshold is the only brake.
 *
 * The rule that survived intact: the owner never earns from their own farm, so
 * every payment to an owner is gated on `actor !== owner` at its call site.
 */

import { withDrawModifier, workerData, workerState } from './query.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import type { Seat } from './state.js';

export interface WorkOptions {
  /**
   * false = the Herb Hive's free mode: the action happens but no card is placed
   * on the Service, so its threshold does not move and no wage is minted.
   */
  progress: boolean;
}

/**
 * Perform a Service's action as `actor`. RULING (locked, carried over from the
 * Hired Workers): suit powers apply to actions performed by a Service - it is
 * your action, done on someone else's premises. That is why the Orchard draw
 * modifier and the Wheat relaxed-harvest gate compose below.
 *
 * Every branch performs the ENHANCED action, never the plain one. The
 * enhancements are printed in workers.json and the sizing rule is there too:
 * a visitor pays a card, so an action that also spends cards has to over-deliver
 * or buying it is worse than doing it yourself.
 */
export function workWorker(fx: Fx, actor: Seat, workerId: string, opts: WorkOptions): void {
  const worker = workerData(fx.data, workerId);
  const owner = workerState(fx.state, workerId).owner;
  fx.emit({
    e: 'workerWorked',
    seat: actor,
    workerId: worker.id,
    owner,
    free: !opts.progress,
  });

  switch (worker.action) {
    case 'draw': {
      // The load-bearing exception, older than the Services: Draw 3 keep 2,
      // never a plain draw. A Service priced in cards must over-deliver cards or
      // it is precisely worthless to buy - do not "tidy" it to the base draw.
      // The Orchard Farmstead's modifier composes: (3,2) -> (4,2) base, (4,3)
      // upgraded.
      const spec = withDrawModifier(fx.data, fx.state, actor, worker.draw ?? { see: 1, keep: 1 });
      fx.pushTask({
        t: 'draw',
        pid: actor,
        src: null,
        see: spec.see,
        keep: spec.keep,
        revealed: [],
      });
      break;
    }
    case 'harvest':
      // 'harvestable', not 'full': the Service performs the ACTOR's Harvest
      // action, so the Wheat Farmstead's relaxed gate composes (locked ruling).
      fx.pushTask({
        t: 'chooseBuilding',
        pid: actor,
        src: null,
        filter: 'harvestable',
        then: 'harvest',
      });
      // The tail, queued AFTER the harvest: a junk hand card into your barn.
      // Only worth taking because the wild substitution (2026-08-08) made an odd
      // card in a barn worth half a crate instead of exactly nothing.
      pushHandToBarn(fx, actor, worker.handToBarn);
      break;
    case 'sow':
      if (worker.sow?.from === 'deck') {
        fx.pushTask({ t: 'sowFromDeck', pid: actor, src: null, remaining: worker.sow.amount });
      } else {
        fx.pushTask({ t: 'sow', pid: actor, src: null, remaining: worker.sow?.amount ?? 1 });
      }
      break;
    case 'build':
      // The Dairy Service waives the crop requirements (`substitute`) and never
      // the price. buildModsFor ORs in the actor's own Farmstead power on top, so
      // a Dairy player buying it is not double-counted, just unaffected.
      fx.pushTask({
        t: 'build',
        pid: actor,
        src: null,
        ...(worker.build ? { mods: { ...worker.build } } : {}),
      });
      break;
    case 'deliver':
      // The head, queued BEFORE the delivery: one hand card into the barn is
      // exactly "you may pay up to 1 card of the cost from your hand", since the
      // barn is where a delivery is paid from. One primitive, no second path.
      pushHandToBarn(fx, actor, worker.handToBarn);
      fx.pushTask({ t: 'deliver', pid: actor, src: null });
      break;
    default:
      worker.action satisfies never;
  }

  // Fires for every path - the bonus slot, a visit's payoff, a Helping Hand
  // repeat, the Herb Hive's free work. A17 The Smoke Pot reads it owner-side,
  // D17 The Strongbox actor-side.
  if (owner !== null) {
    fireHook(fx, 'afterWork', { actor, owner, workerId: worker.id, free: !opts.progress });
  }
}

function pushHandToBarn(fx: Fx, actor: Seat, n: number | undefined): void {
  if (!n || n <= 0) return;
  fx.pushTask({ t: 'handToBarn', pid: actor, src: null, remaining: n, optional: true });
}
