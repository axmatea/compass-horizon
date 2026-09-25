/** Seeded PRNG and Beta posterior Monte Carlo. Deterministic: same inputs, same answer, everywhere. */

export const DRAWS = 4000;

export function hashSeed(input: string): number {
  // FNV-1a 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gamma(k, 1) for integer k as a sum of k exponentials. Exact for the integer shapes a Beta(1+q, 1+r-q) posterior uses. */
function gammaInt(k: number, rnd: () => number): number {
  let s = 0;
  for (let i = 0; i < k; i++) s -= Math.log(1 - rnd());
  return s;
}

export function betaSample(alpha: number, beta: number, rnd: () => number): number {
  const x = gammaInt(alpha, rnd);
  const y = gammaInt(beta, rnd);
  return x / (x + y);
}

export interface ArmEvidence {
  qualified: number;
  resolved: number;
  cplUsd: number;
}

/**
 * P(arm A yields more qualified leads per dollar than arm B).
 * Qualified rate ~ Beta(1+q, 1+r-q) among resolved leads; per dollar = rate / CPL.
 */
export function probABetterPerDollar(a: ArmEvidence, b: ArmEvidence, draws = DRAWS): number {
  const seed = hashSeed(
    `${a.qualified}|${a.resolved}|${a.cplUsd.toFixed(4)}|${b.qualified}|${b.resolved}|${b.cplUsd.toFixed(4)}|${draws}`,
  );
  const rnd = mulberry32(seed);
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    const pa = betaSample(1 + a.qualified, 1 + a.resolved - a.qualified, rnd);
    const pb = betaSample(1 + b.qualified, 1 + b.resolved - b.qualified, rnd);
    if (pa / a.cplUsd > pb / b.cplUsd) wins++;
  }
  return wins / draws;
}
