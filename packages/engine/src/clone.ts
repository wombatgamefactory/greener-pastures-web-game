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
  if (Array.isArray(value)) {
    // Indexed rather than `.map(clonePlain)`: map hands the callback an index
    // and the source array on every element, which this ignores, and it is
    // called once per array in a whole GameState on every `apply` and every
    // speculative probe.
    const n = value.length;
    const copy = new Array<unknown>(n);
    for (let i = 0; i < n; i++) copy[i] = clonePlain(value[i]);
    return copy as T;
  }
  if (value !== null && typeof value === 'object') {
    // ⭐ `Object.keys` rather than `Object.entries` (03/09/2026). Entries builds
    // a throwaway two-element array PER FIELD, and a CPU profile put this
    // function at ~5% of a whole game - it is on the critical path of `apply`,
    // and the bots' probe applies moves speculatively as well. Same keys, same
    // order, same result: both read own enumerable string keys.
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] as string;
      out[k] = clonePlain(source[k]);
    }
    return out as T;
  }
  return value;
}
