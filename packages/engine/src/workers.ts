/**
 * Hired Worker mechanics: performing a Worker's action, and the Working Week
 * track arithmetic (advance, wage, expiry).
 *
 * The one derivation that replaces every own-vs-visit mode flag, confirmed
 * against the reference implementation: the wage is minted by the bank to the
 * OWNER, and only when actor !== owner. The visitor never pays it (their price
 * was the fee card); an owner's own uses advance the meeple but pay nothing.
 */

import { workerData, workerState } from './query.js';
import type { Fx } from './fx.js';
import type { Seat } from './state.js';

export interface WorkOptions {
  /**
   * false = the Herb Hive's free mode: the action happens but the meeple does
   * not advance, so no wage is paid and the Working Week is not consumed.
   */
  progress: boolean;
}

/**
 * Perform a Worker's action as `actor`, then advance the meeple (unless the
 * work was free). RULING (locked): suit powers apply to actions performed by a
 * Hired Worker - it is your action, done by hired muscle. Suit-power modifiers
 * attach here when the Farmstead handlers land.
 */
export function workWorker(fx: Fx, actor: Seat, workerId: string, opts: WorkOptions): void {
  const worker = workerData(fx.data, workerId);
  const ws = workerState(fx.state, workerId);
  fx.emit({
    e: 'workerWorked',
    seat: actor,
    workerId: worker.id,
    owner: ws.owner,
    free: !opts.progress,
  });

  switch (worker.action) {
    case 'draw': {
      // The one printed exception, load-bearing: Draw 3 keep 2, never a plain
      // draw. A Worker priced in cards must over-deliver cards to be worth
      // renting - do not "tidy" this to the base draw.
      const spec = worker.draw ?? { see: 1, keep: 1 };
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
      // 'harvestable', not 'full': the Worker performs the actor's Harvest
      // action, so the Wheat Farmstead's relaxed gate composes (locked ruling).
      fx.pushTask({
        t: 'chooseBuilding',
        pid: actor,
        src: null,
        filter: 'harvestable',
        then: 'harvest',
      });
      break;
    case 'sow':
      fx.pushTask({ t: 'sow', pid: actor, src: null, remaining: worker.sow?.amount ?? 1 });
      break;
    case 'build':
      // A plain Build, chosen via the same enumerator the Build move uses.
      // Hire and starter upgrades are NOT offered through a Worker (open
      // ruling; the reference's worker-build is hand-builds only).
      fx.pushTask({ t: 'build', pid: actor, src: null });
      break;
    case 'deliver':
      fx.pushTask({ t: 'deliver', pid: actor, src: null });
      break;
    default:
      worker.action satisfies never;
  }

  if (opts.progress) advanceWorker(fx, actor, workerId);
}

/**
 * Track arithmetic: arrival(0) -> paying spaces 1..N -> home. Landing on space
 * i pays wages[i-1] to the owner when a rival worked it. Advancing past space
 * N expires the Worker: back to the Fair, hireable by anyone, no wage on the
 * walk home.
 */
export function advanceWorker(fx: Fx, actor: Seat, workerId: string): void {
  const worker = workerData(fx.data, workerId);
  const ws = workerState(fx.state, workerId);
  const owner = ws.owner;
  ws.trackPos += 1;
  if (ws.trackPos > worker.wages.length) {
    ws.owner = null;
    ws.trackPos = 0;
    fx.emit({ e: 'workerExpired', workerId: worker.id });
    return;
  }
  const wage = worker.wages[ws.trackPos - 1] ?? 0;
  const rivalUse = owner !== null && owner !== actor;
  if (rivalUse && wage > 0) {
    fx.gainCoins(owner, wage, `wage:${worker.id}`);
  }
  fx.emit({
    e: 'workerAdvanced',
    workerId: worker.id,
    to: ws.trackPos,
    wage,
    paidTo: rivalUse ? owner : null,
  });
}
