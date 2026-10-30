// Physics proof: every level's authored solution wins in the real sand simulation.
// Slow (~10-30 s in total); run alone with `npx vitest run tests/levels-physics.test.ts`.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index';
import { describeState, replayLevel } from '../src/levels/replay';

const SEEDS = [7, 1, 12345];

describe('levels win in the real simulation', () => {
  for (const level of LEVELS) {
    it(
      `${level.id} solution wins (seeds ${SEEDS.join(', ')})`,
      () => {
        for (const seed of SEEDS) {
          const r = replayLevel(level, level.solution ?? [], { seed });
          expect(r.won, `${level.id} seed ${seed}: ${r.why} ${describeState(r.state)}`).toBe(true);
          // keep the level brisk: under ~2 minutes of sim time, no single wait over ~25 s
          expect(r.steps / 60).toBeLessThan(120);
          expect(r.longestSettle / 60).toBeLessThan(25);
        }
      },
      120_000,
    );
  }
});
