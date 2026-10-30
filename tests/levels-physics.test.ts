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

// No timers: a hero solution must not depend on reaching a spot before a drain finishes. Replaying
// with a slow walk (2 s per input instead of 0.1 s; entries still settle in between) must still win.
// A level that only wins by hurrying (or would need a no-wait " &" entry) fails here.
describe('hero levels do not race the sand', () => {
  for (const level of LEVELS.filter((l) => l.hero)) {
    it(`${level.id} wins at a slow walking pace`, () => {
      const r = replayLevel(level, level.solution ?? [], { seed: 7, heroInputSteps: 120 });
      expect(r.won, `${level.id}: ${r.why} ${describeState(r.state)}`).toBe(true);
      for (const step of level.solution ?? []) expect(step.includes('&'), `${level.id}: no-wait entry ${step}`).toBe(false);
    }, 60_000);
  }
});

