// Physics proof: every level's authored solution wins in the real sand simulation.
// Slow (~10-30 s in total); run alone with `npx vitest run tests/levels-physics.test.ts`.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index';
import { describeState, replayLevel } from '../src/levels/replay';

const SEEDS = [7, 1, 12345];

describe('levels win in the real simulation', () => {
  for (const [index, level] of LEVELS.entries()) {
    // Chapter 1 stays brisk (under 2 minutes, no wait over 25 s). Chapters 2-3 (box gravity, hero)
    // stage sequences where one trigger drains a whole stack (a frozen plug thawing, a pin pulled),
    // so they get 150 s total and up to 40 s for that one wait.
    const [maxTotal, maxWait] = index < 18 ? [120, 25] : [150, 40];
    it(
      `${level.id} solution wins (seeds ${SEEDS.join(', ')})`,
      () => {
        for (const seed of SEEDS) {
          const r = replayLevel(level, level.solution ?? [], { seed });
          expect(r.won, `${level.id} seed ${seed}: ${r.why} ${describeState(r.state)}`).toBe(true);
          expect(r.steps / 60).toBeLessThan(maxTotal);
          expect(r.longestSettle / 60).toBeLessThan(maxWait);
        }
      },
      120_000,
    );
  }
});
