// Small deterministic RNG (mulberry32) operating on GameState.rng in place.

export interface Rng {
  seed: number;
}

export function createRng(seed = 1): Rng {
  return { seed: seed | 0 };
}

/** Uniform float in [0, 1). Advances rng.seed. */
export function nextFloat(rng: Rng): number {
  let t = (rng.seed = (rng.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return nextFloat(rng) < p;
}
