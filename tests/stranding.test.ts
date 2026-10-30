// Randomised invariants harness for the shared simulation: random boards, random dockings, random
// moves (which shake), every rule active. Conservation must be exact at every step.
import { describe, expect, it } from 'vitest';
import { COMPLETION_SLACK, SHAPES, dissolvedGrains, canPlace, countColor, createGame, createRng, nextInt, recount, shapeBounds, stepGame, tryMoveBox } from '../src/core';
import type { BoxDef, GameState, LayerDef, SandBoxDef, ShapeName } from '../src/core';
import { colorTotals, level, runUntilStable } from './helpers';

const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

function randomLevel(seed: number) {
  const r = createRng(seed);
  const W = 7;
  const H = 8;
  const sandBoxes: SandBoxDef[] = [];
  const taken = new Set<number>();
  const n = 1 + nextInt(r, 2);
  for (let k = 0; k < n; k++) {
    const w = 1 + nextInt(r, 2);
    const h = 1 + nextInt(r, 3);
    const x = nextInt(r, W - w + 1);
    const y = nextInt(r, H - h + 1);
    let ok = true;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (taken.has(yy * W + xx)) ok = false;
    if (!ok) continue;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(yy * W + xx);
    const layers: LayerDef[] = [];
    let left = w * h * (0.5 + 0.5 * (nextInt(r, 3) / 2));
    while (left > 0.2) {
      const a = Math.min(left, 0.25 + nextInt(r, 4) * 0.25);
      layers.push({ color: 1 + nextInt(r, 3), amount: a });
      left -= a;
    }
    sandBoxes.push({ x, y, w, h, layers });
  }
  const boxes: BoxDef[] = [];
  for (let tries = 0; tries < 60 && boxes.length < 6; tries++) {
    const shape = SHAPE_NAMES[nextInt(r, SHAPE_NAMES.length)];
    const x = nextInt(r, W);
    const y = nextInt(r, H);
    const cells = SHAPES[shape].map((c) => [x + c.x, y + c.y]);
    if (cells.some(([cx, cy]) => cx >= W || cy >= H || taken.has(cy * W + cx))) continue;
    cells.forEach(([cx, cy]) => taken.add(cy * W + cx));
    boxes.push({ shape, x, y, color: 1 + nextInt(r, 3), frozen: nextInt(r, 5) === 0 ? 1 : 0 });
  }
  return level({ width: W, height: H, sandBoxes, boxes });
}

function check(s: GameState, totals: number[], sandColors: number[][]): void {
  // exact conservation, counting grains removed by debris dissolution
  const now = colorTotals(s);
  const gone = dissolvedGrains(s);
  expect(now.map((n, c) => n + gone[c])).toEqual(totals);
  s.sandBoxes.forEach((sb, i) => {
    expect(recount(sb.region)).toBe(sb.region.count);
    for (let c = 1; c <= 3; c++) {
      const now = countColor(sb.region, c);
      expect(now).toBeLessThanOrEqual(sandColors[i][c]); // sand only ever leaves a sand box
      sandColors[i][c] = now;
    }
  });
  for (const b of s.boxes) {
    expect(recount(b.region)).toBe(b.region.count);
    expect(countColor(b.region, b.color)).toBe(b.region.count); // only its own color
    expect(b.region.count).toBeLessThanOrEqual(b.region.capacity);
    if (b.frozen > 0) expect(b.region.count).toBe(0);
  }
}

describe('invariants harness', () => {
  it('conserves every grain under gravity, cross-edge moves, pull, chain push and shake', () => {
    let moved = 0;
    let crossed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame(randomLevel(seed), seed);
      const totals = colorTotals(s);
      const sandColors = s.sandBoxes.map((sb) => [0, 1, 2, 3].map((c) => countColor(sb.region, c)));
      const r = createRng(seed * 31);
      for (let t = 0; t < 360; t++) {
        if (t % 20 === 0) {
          const active = s.boxes.filter((b) => b.state === 'active' && b.frozen === 0);
          if (active.length) {
            const b = active[nextInt(r, active.length)];
            const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][nextInt(r, 4)];
            if (canPlace(s, b, b.x + dx, b.y + dy) && tryMoveBox(s, b.id, dx, dy)) moved++;
          }
        }
        stepGame(s);
        for (const e of s.events) if (e.type === 'transfer') crossed += e.count;
        s.events.length = 0;
        check(s, totals, sandColors);
      }
    }
    console.log(`invariants harness: 40 boards x 360 steps, ${moved} moves, ${crossed} grains crossed into boxes`);
    expect(moved).toBeGreaterThan(50);
    expect(crossed).toBeGreaterThan(1000);
  });
});

describe('bottom docking harness: every shape catches a matching sand box from below', () => {
  // Sand box of matching width (or 1 wider: partial coverage) holding exactly the box's capacity
  // of one color; the box docked directly below. Run to quiescence: the box must complete.
  for (const extra of [0, 1]) {
    it(`all shapes complete (${extra ? 'sand box 1 wider' : 'full coverage'})`, () => {
      const report: string[] = [];
      for (const shape of SHAPE_NAMES) {
        const { w, h } = shapeBounds(shape);
        const cells = SHAPES[shape].length;
        const sw = w + extra;
        const sh = Math.ceil(cells / sw);
        for (const seed of [1, 2]) {
          const s = createGame(level({
            width: sw + 2,
            height: sh + h + 1,
            sandBoxes: [{ x: 0, y: 0, w: sw, h: sh, layers: [{ color: 1, amount: cells }] }],
            boxes: [{ shape, x: 0, y: sh, color: 1 }],
          }), seed);
          const b = s.boxes[0];
          const total = b.region.capacity;
          let done = -1;
          runUntilStable(s, () => {
            if (b.state === 'removed' && done < 0) done = s.tick;
            return b.region.count + (b.state === 'removed' ? 1e6 : 0);
          }, 300, 20000);
          const left = s.sandBoxes[0].region.count + dissolvedGrains(s)[1]; // debris (dissolved by now)
          if (seed === 1) report.push(`${shape}:${done}${left ? `+${left}` : ''}`);
          expect(b.state, `${shape} extra=${extra} seed=${seed}: ${b.region.count}/${total}`).toBe('removed');
          expect(b.region.count + left).toBe(total);
          expect(left).toBeLessThanOrEqual(COMPLETION_SLACK);
          expect(s.sandBoxes[0].region.count).toBe(0);
        }
      }
      console.log(`bottom docking (${extra ? '1 wider' : 'full coverage'}), steps to complete [+debris]: ${report.join(' ')}`);
    });
  }

  it('single-color random bottom docks (offsets, wider/taller sand boxes, surplus) never stall', () => {
    const r = createRng(42);
    let stalled = 0;
    for (let k = 0; k < 60; k++) {
      const shape = SHAPE_NAMES[nextInt(r, SHAPE_NAMES.length)];
      const { w, h } = shapeBounds(shape);
      const cells = SHAPES[shape].length;
      const extra = nextInt(r, 3);
      const sw = w + extra;
      const amt = cells + nextInt(r, 3) * 0.5;
      const sh = Math.ceil(amt / sw) + nextInt(r, 2);
      const s = createGame(level({
        width: sw + 2,
        height: sh + h + 1,
        sandBoxes: [{ x: 0, y: 0, w: sw, h: sh, layers: [{ color: 1, amount: amt }] }],
        boxes: [{ shape, x: nextInt(r, extra + 1), y: sh, color: 1 }],
      }), k);
      const b = s.boxes[0];
      runUntilStable(s, () => b.region.count + (b.state === 'removed' ? 1e6 : 0), 300, 20000);
      if (b.state !== 'removed') stalled++;
    }
    expect(stalled).toBe(0);
  });
});
