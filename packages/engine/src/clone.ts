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
    //
    // ⭐ AND THE PRIMITIVE FAST PATH (04/09/2026), which is the same argument
    // one level down. A GameState's big arrays are arrays of STRINGS - decks,
    // hands, barns, stacks, discards - and recursing into `clonePlain` for a
    // string is a function call to reach the `return value` at the bottom. The
    // inline test reaches the same answer without the call, and a profile put
    // this function at ~15% of a whole game.
    const n = value.length;
    const copy = new Array<unknown>(n);
    for (let i = 0; i < n; i++) {
      const v = value[i];
      copy[i] = v !== null && typeof v === 'object' ? clonePlain(v) : v;
    }
    return copy as T;
  }
  if (value !== null && typeof value === 'object') {
    // ⭐ `Object.keys` rather than `Object.entries` (03/09/2026). Entries builds
    // a throwaway two-element array PER FIELD, and a CPU profile put this
    // function at ~5% of a whole game - it is on the critical path of `apply`,
    // and the bots' probe applies moves speculatively as well. Same keys, same
    // order, same result: both read own enumerable string keys.
    //
    // ⭐ AND `for...in` RATHER THAN `Object.keys` (04/09/2026), which is the
    // same argument once more: `Object.keys` builds a throwaway ARRAY per
    // object, and one clone of a GameState walks thousands of them. `for...in`
    // reads own AND inherited enumerable string keys - identical here, and
    // identical for anything this may ever be handed, because the whole state
    // model is plain JSON by construction (ticket 04): object literals and
    // JSON.parse output, whose only prototype is Object.prototype, which has no
    // enumerable properties. ⚠️ That is the precondition, and it is the one
    // thing that would break this: hand it a class instance with enumerable
    // prototype members and they would be cloned onto the copy.
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k in source) {
      const v = source[k];
      out[k] = v !== null && typeof v === 'object' ? clonePlain(v) : v;
    }
    return out as T;
  }
  return value;
}
