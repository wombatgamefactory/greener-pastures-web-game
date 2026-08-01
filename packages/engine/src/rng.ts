/**
 * Seeded randomness. sfc32 state lives inline in GameState.rng, so a game is
 * fully reproducible from (data, seed, move list) - the contract the sim,
 * saves, undo and bug reports all stand on. Math.random and Date never appear
 * in this package.
 */

export type RngState = [number, number, number, number];

/** Derive an sfc32 state from a seed string via splitmix32 over a string hash. */
export function seedRng(seed: string): RngState {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const next = () => {
    h = (h + 0x9e3779b9) | 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

/** Advance the state in place and return a float in [0, 1). */
export function rngNext(s: RngState): number {
  const [a, b, c, d] = s;
  const t = (((a + b) | 0) + d) | 0;
  s[3] = (d + 1) | 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) | 0;
  s[2] = ((c << 21) | (c >>> 11)) + t;
  s[2] |= 0;
  return (t >>> 0) / 4294967296;
}

/** Uniform integer in [0, n). */
export function rngInt(s: RngState, n: number): number {
  return Math.floor(rngNext(s) * n);
}

/** Fisher-Yates, in place, consuming the state. */
export function shuffle<T>(s: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rngInt(s, i + 1);
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
  return items;
}
