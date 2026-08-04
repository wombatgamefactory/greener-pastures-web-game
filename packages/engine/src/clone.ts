/**
 * Deep-clone plain JSON.
 *
 * `structuredClone` is not reachable here: the engine's tsconfig gives it
 * neither DOM nor Node types on purpose, so the global does not exist as far as
 * the typechecker is concerned. Everything in the state model and the move
 * protocol is plain JSON by design (ticket 04 - no classes, no closures, no
 * Dates), which is exactly the subset this walks.
 */

export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clonePlain) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clonePlain(v);
    return out as T;
  }
  return value;
}
