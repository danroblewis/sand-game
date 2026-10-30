import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../src/core/types';
import {
  boxTouchesOwnSand,
  describeLevel,
  difficultyParams,
  generateDailySeed,
  generateLevel,
  generateLevelWithStats,
  replayInSim,
  SIM_SEED,
  type GenerateResult,
} from '../src/levels/generate';
import { validateLevel, levelCapacityByColor } from '../src/levels/validate';
import { greedySolve } from '../src/levels/solver';

// Generation includes a physics replay of the solution (the proof), so the sample is modest.
const DIFFS = [1, 3, 5, 8];
const SEEDS = 6;

// Generate once, share across tests.
const results = new Map<number, GenerateResult[]>();
const genMs = new Map<number, number>();
for (const d of DIFFS) {
  const out: GenerateResult[] = [];
  const t0 = performance.now();
  for (let s = 1; s <= SEEDS; s++) out.push(generateLevelWithStats(s, d));
  genMs.set(d, performance.now() - t0);
  results.set(d, out);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

describe('generateLevel', () => {
  it('is deterministic per (seed, difficulty)', () => {
    for (const [s, d] of [
      [1, 1],
      [4, 3],
      [2, 5],
    ]) {
      const a = generateLevelWithStats(s, { difficulty: d });
      expect(JSON.stringify(a.level)).toBe(JSON.stringify(results.get(d)![s - 1].level));
      expect(a.solution.path).toEqual(results.get(d)![s - 1].solution.path);
    }
    expect(JSON.stringify(generateLevel(1, 5))).toBe(JSON.stringify(results.get(5)![0].level));
    expect(JSON.stringify(results.get(5)![0].level)).not.toBe(JSON.stringify(results.get(5)![1].level));
  });

  for (const d of DIFFS) {
    it(`difficulty ${d}: valid and well-formed`, () => {
      for (const r of results.get(d)!) {
        const l: LevelDef = r.level;
        const map = describeLevel(l);
        expect(validateLevel(l), map).toEqual([]);
        expect(l.id).toMatch(new RegExp(`^gen-${d}-\\d+$`));
        expect(l.width).toBeGreaterThanOrEqual(6);
        expect(l.width).toBeLessThanOrEqual(8);
        expect(l.height).toBeGreaterThanOrEqual(7);
        expect(l.height).toBeLessThanOrEqual(11);
        expect(levelCapacityByColor(l).size).toBeLessThanOrEqual(6);
        for (const b of l.boxes) {
          expect(b.color === 11 || b.color === 12).toBe(false);
          // no box starts docked to sand of its own color (it would fill with no player action)
          expect(boxTouchesOwnSand(l, b), map).toBe(false);
        }
        for (const sb of l.sandBoxes) {
          expect(sb.h, map).toBeLessThanOrEqual(3);
          expect(sb.layers.length, map).toBeLessThanOrEqual(4);
          for (const layer of sb.layers) expect(layer.amount).toBeGreaterThanOrEqual(0.5);
        }
        expect(r.solution.solved).toBe(true);
        expect(r.solution.moves).toBe(r.solution.path.length);
        expect(r.solution.moves).toBeGreaterThanOrEqual(1);
        if (r.level.boxes.some((b) => b.frozen)) expect(l.hint).toBeTruthy();
      }
    });
  }

  it('solutions are physics-verified: replaying them in the real simulation wins', () => {
    // every d1/d3 level and two of each harder difficulty (each replay costs ~0.5-3 s)
    for (const d of DIFFS) {
      const rs = results.get(d)!.slice(0, d <= 3 ? SEEDS : 2);
      for (const r of rs) {
        const sim = replayInSim(r.level, r.solution.path, { simSeed: SIM_SEED });
        expect(sim.won, `${describeLevel(r.level)}\n${r.solution.path.join(', ')}\n${sim.reason}`).toBe(true);
        expect(sim.steps).toBe(r.simSteps);
        expect(sim.executed).toEqual(r.solution.path);
      }
    }
  });

  it('rarely falls back to an easier difficulty', () => {
    for (const d of DIFFS) {
      const rs = results.get(d)!;
      expect(rs.filter((r) => r.difficulty !== d).length).toBeLessThanOrEqual(1);
    }
  });

  it('gets harder with difficulty (mean drags and boxes)', () => {
    const means = DIFFS.map((d) => mean(results.get(d)!.map((r) => r.solution.moves)));
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThan(means[i - 1]);
    const boxes = DIFFS.map((d) => mean(results.get(d)!.map((r) => r.level.boxes.length)));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]).toBeGreaterThan(boxes[i - 1]);
    for (const d of DIFFS)
      for (const r of results.get(d)!) expect(r.solution.moves).toBeLessThanOrEqual(difficultyParams(r.difficulty).maxDrags);
  });

  it('defeats the greedy naive player (heuristic model) at difficulty >= 5', () => {
    for (const d of [5, 8]) {
      for (const r of results.get(d)!) {
        if (r.difficulty >= 5) expect(greedySolve(r.level), describeLevel(r.level)).toBe(-1);
      }
    }
  });

  it('uses frozen boxes at higher difficulty only', () => {
    expect(results.get(1)!.some((r) => r.level.boxes.some((b) => b.frozen))).toBe(false);
    expect(results.get(3)!.some((r) => r.level.boxes.some((b) => b.frozen))).toBe(false);
  });

  it('generates in reasonable time', () => {
    // mean per level, including physics verification (generous bounds for slow CI machines)
    expect(genMs.get(1)! / SEEDS).toBeLessThan(3000);
    expect(genMs.get(3)! / SEEDS).toBeLessThan(5000);
    expect(genMs.get(8)! / SEEDS).toBeLessThan(20000);
  });
});

// ---- box gravity ----
const GDIFFS = [2, 5, 8];
const GSEEDS = 5;
const gResults = new Map<number, GenerateResult[]>();
const gMs = new Map<number, number>();
for (const d of GDIFFS) {
  const t0 = performance.now();
  const out: GenerateResult[] = [];
  for (let s = 1; s <= GSEEDS; s++) out.push(generateLevelWithStats(s, { difficulty: d, gravity: true }));
  gMs.set(d, performance.now() - t0);
  gResults.set(d, out);
}

describe('generateLevel (box gravity)', () => {
  it('is deterministic per (seed, difficulty, gravity)', () => {
    for (const [s, d] of [
      [1, 2],
      [3, 5],
    ]) {
      const a = generateLevelWithStats(s, { difficulty: d, gravity: true });
      expect(JSON.stringify(a.level)).toBe(JSON.stringify(gResults.get(d)![s - 1].level));
      expect(a.solution.path).toEqual(gResults.get(d)![s - 1].solution.path);
    }
    // the plain number form is the non-gravity generator
    expect(generateLevel(1, 2).boxGravity).toBeFalsy();
    expect(JSON.stringify(gResults.get(5)![0].level)).not.toBe(JSON.stringify(gResults.get(5)![1].level));
  });

  for (const d of GDIFFS) {
    it(`difficulty ${d}: valid gravity levels, every box starts resting`, () => {
      for (const r of gResults.get(d)!) {
        const l = r.level;
        const map = describeLevel(l);
        expect(l.boxGravity, map).toBe(true);
        expect(l.id).toMatch(new RegExp(`^gen-${d}g-\\d+$`));
        expect(l.name).toMatch(new RegExp(`^Random ${d}g-\\d+$`));
        // validateLevel checks conservation, overlaps and (gravity) that every box starts resting
        expect(validateLevel(l), map).toEqual([]);
        expect(levelCapacityByColor(l).size).toBeLessThanOrEqual(6);
        expect(map.split('\n')[0]).toMatch(/ gravity$/);
        for (const b of l.boxes) if (!b.frozen) expect(boxTouchesOwnSand(l, b) && !l.sandBoxes.some((sb) => sb.h === 1), map).toBe(false);
        expect(r.template).toBeTruthy();
        expect(r.solution.moves).toBe(r.solution.path.length);
      }
    });
  }

  it('solutions are physics-verified (replay wins)', () => {
    for (const d of GDIFFS)
      for (const r of gResults.get(d)!.slice(0, 2)) {
        const sim = replayInSim(r.level, r.solution.path, { simSeed: SIM_SEED });
        expect(sim.won, `${describeLevel(r.level)}\n${r.solution.path.join(', ')}\n${sim.reason}`).toBe(true);
        expect(sim.steps).toBe(r.simSteps);
      }
  });

  it('gets harder with difficulty and rarely falls back', () => {
    // trigger stacks need few drags (the shaft releases itself), so drags rise less steeply than
    // the number of boxes and frozen gates
    const means = GDIFFS.map((d) => mean(gResults.get(d)!.map((r) => r.solution.moves)));
    expect(means[1]).toBeGreaterThan(means[0]);
    expect(means[2]).toBeGreaterThan(means[0]);
    const gates = GDIFFS.map((d) => mean(gResults.get(d)!.map((r) => r.level.boxes.filter((b) => b.frozen).length)));
    expect(gates[2]).toBeGreaterThan(gates[0]);
    const boxes = GDIFFS.map((d) => mean(gResults.get(d)!.map((r) => r.level.boxes.length)));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]).toBeGreaterThan(boxes[i - 1]);
    for (const d of GDIFFS) expect(gResults.get(d)!.filter((r) => r.difficulty !== d).length).toBeLessThanOrEqual(1);
  });

  it('defeats the greedy naive player (heuristic model) at difficulty >= 5', () => {
    for (const d of [5, 8])
      for (const r of gResults.get(d)!)
        // trigger stacks are exempt: their challenge is the thaw counts, not search depth
        if (r.difficulty >= 5 && !r.template!.includes('trig')) expect(greedySolve(r.level), describeLevel(r.level)).toBe(-1);
  });

  it('trigger stacks: a pre-loaded shaft gated by frozen boxes, chosen often from difficulty 5', () => {
    const trig = [...gResults.get(5)!, ...gResults.get(8)!].filter((r) => r.template!.includes('trig'));
    expect(trig.length).toBeGreaterThanOrEqual(3);
    for (const r of trig) {
      const frozen = r.level.boxes.filter((b) => b.frozen);
      expect(frozen.length, describeLevel(r.level)).toBeGreaterThanOrEqual(1);
      // the frozen foot box sits beside its tray, on the floor
      expect(frozen.some((b) => b.y === r.level.height - 1)).toBe(true);
    }
  });

  it('generates in reasonable time', () => {
    expect(gMs.get(2)! / GSEEDS).toBeLessThan(3000);
    expect(gMs.get(8)! / GSEEDS).toBeLessThan(20000);
  });
});

// ---- hero (Sokoban) ----
const HDIFFS = [1, 3, 5, 8];
const HSEEDS = 3;
const hResults = new Map<string, GenerateResult[]>(); // key `${d}${gravity ? 'g' : ''}`
for (const gravity of [false, true])
  for (const d of HDIFFS) {
    const out: GenerateResult[] = [];
    for (let s = 1; s <= HSEEDS; s++) out.push(generateLevelWithStats(s, { difficulty: d, hero: true, gravity }));
    hResults.set(`${d}${gravity ? 'g' : ''}`, out);
  }

describe('generateLevel (hero)', () => {
  it('is deterministic per (seed, difficulty, gravity, hero)', () => {
    for (const [s, d, gravity] of [
      [2, 3, false],
      [1, 5, true],
    ] as const) {
      const a = generateLevelWithStats(s, { difficulty: d, hero: true, gravity });
      const b = hResults.get(`${d}${gravity ? 'g' : ''}`)![s - 1];
      expect(JSON.stringify(a.level)).toBe(JSON.stringify(b.level));
      expect(a.solution.path).toEqual(b.solution.path);
    }
  });

  for (const gravity of [false, true])
    for (const d of HDIFFS) {
      it(`${gravity ? 'gravity ' : ''}difficulty ${d}: valid hero levels`, () => {
        for (const r of hResults.get(`${d}${gravity ? 'g' : ''}`)!) {
          const l = r.level;
          const map = describeLevel(l);
          expect(l.hero, map).toBeTruthy();
          expect(!!l.boxGravity).toBe(gravity);
          expect(l.id).toMatch(new RegExp(`^gen-${d}${gravity ? 'g' : ''}h-\\d+$`));
          expect(l.name).toMatch(new RegExp(`^Random ${d}${gravity ? 'g' : ''}h-\\d+$`));
          // validateLevel: conservation, overlaps, a free hero start (resting under gravity)
          expect(validateLevel(l), map).toEqual([]);
          expect(map).toContain('@');
          for (const b of l.boxes) if (!b.frozen) expect(boxTouchesOwnSand(l, b) && !gravity, map).toBe(false);
          // solutions are hero input strings
          for (const e of r.solution.path) expect(e).toMatch(/^[UDLR]+$/);
        }
      });
    }

  it('hero solutions are physics-verified (replay wins)', () => {
    for (const gravity of [false, true])
      for (const d of HDIFFS) {
        const r = hResults.get(`${d}${gravity ? 'g' : ''}`)![0];
        const sim = replayInSim(r.level, r.solution.path, { simSeed: SIM_SEED });
        expect(sim.won, `${describeLevel(r.level)}\n${r.solution.path.join(' ')}\n${sim.reason}`).toBe(true);
        expect(sim.steps).toBe(r.simSteps);
      }
  });

  it('needs more pushes at higher difficulty', () => {
    for (const g of ['', 'g']) {
      const m = HDIFFS.map((d) => mean(hResults.get(`${d}${g}`)!.map((r) => r.solution.moves)));
      expect(m[3], g).toBeGreaterThan(m[0]);
      expect(m[2], g).toBeGreaterThan(m[0]);
    }
  });
});

describe('helpers', () => {
  it('generateDailySeed is date based', () => {
    expect(generateDailySeed(new Date(2026, 9, 29))).toBe(20261029);
    expect(generateDailySeed(new Date(2026, 9, 29, 23, 59))).toBe(20261029);
    expect(generateDailySeed(new Date(2026, 9, 30))).not.toBe(20261029);
  });

  it('describeLevel draws the board', () => {
    const l = results.get(3)![0].level;
    const lines = describeLevel(l).split('\n');
    expect(lines[0]).toBe(`${l.id} ${l.width}x${l.height}`);
    expect(lines.slice(1, l.height + 1).every((row) => row.split(' ').length === l.width)).toBe(true);
    expect(lines.some((x) => x.startsWith('sand'))).toBe(true);
  });
});
