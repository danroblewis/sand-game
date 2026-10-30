// The shared simulation: cross-edge gravity/slide/slump, the short-reach pull, chain push.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GRAINS_PER_CELL as N,
  COMPLETION_SLACK,
  PULL_REACH,
  countColor,
  createGame,
  gameSpace,
  packGrain,
  pullReach,
  recount,
  regionVersion,
  setPullReach,
  stepGame,
  tryMoveBox,
} from '../src/core';
import type { BoxDef, GameState, SandBoxDef, SandRegion } from '../src/core';
import { ascii, colorTotals, columnHeights, level, runUntil, runUntilStable, totalGrains } from './helpers';

afterEach(() => {
  setPullReach(PULL_REACH);
});

/** Top-most row (fine) holding color c, or r.h if none. */
function topOf(r: SandRegion, c: number): number {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if ((r.cells[y * r.w + x] & 31) === c) return y;
  return r.h;
}

function pour(r: SandRegion, color: number, n: number): void {
  for (let i = 0; i < n; i++) {
    r.cells[r.cells.length - 1 - i] = packGrain(color, i % 8);
    r.count++;
  }
}

describe('configuration', () => {
  it('pull reach defaults to 3 fine cells, clamped to 1..6 (0 disables)', () => {
    expect(PULL_REACH).toBe(3);
    expect(pullReach()).toBe(3);
    setPullReach(1);
    expect(pullReach()).toBe(1);
    setPullReach(9);
    expect(pullReach()).toBe(6);
    setPullReach(0);
    expect(pullReach()).toBe(0);
  });

  it('the world map links docked regions and is rebuilt when a box moves', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 1, w: 1, h: 1, layers: [] }],
      boxes: [{ shape: '1x1', x: 2, y: 1, color: 1 }, { shape: '1x1', x: 1, y: 0, color: 2, frozen: 1 }],
    }));
    const sp = gameSpace(s);
    expect(gameSpace(s)).toBe(sp);
    expect(sp.pullers.length).toBe(1); // frozen box: no openings
    expect(sp.pullers[0].n).toBe(N); // one shared edge, N fine pairs
    tryMoveBox(s, 0, 1, 0);
    expect(gameSpace(s).pullers.length).toBe(0); // undocked
  });
});

describe('gravity across edges (no pull)', () => {
  it('a box BELOW a sand box fills by gravity alone with PULL_REACH 0; other colors stay', () => {
    setPullReach(0);
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 1 }, { color: 6, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 2, color: 1 }],
    }), 4);
    const box = s.boxes[0];
    const sb = s.sandBoxes[0].region;
    const steps = runUntil(s, () => {
      expect(totalGrains(s, true)).toBe(2 * 576);
      if (box.state === 'active') expect(countColor(box.region, 6)).toBe(0);
      return box.state === 'removed';
    }, 400);
    console.log(`box below, gravity only: filled in ${steps} steps`);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(80);
    expect(countColor(sb, 1)).toBeLessThanOrEqual(COMPLETION_SLACK); // debris
    expect(countColor(sb, 6)).toBe(576);
    // blue falls to the floor of the sand box (on top of at most a few rows of red debris)
    for (let t = 0; t < 120; t++) stepGame(s);
    expect(topOf(sb, 6)).toBeGreaterThanOrEqual(N - 4);
  });

  it('a same-color box above another drains into it by gravity', () => {
    setPullReach(0);
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 3 }, { shape: '1x1', x: 0, y: 1, color: 3 }] }));
    const [a, b] = s.boxes.map((x) => x.region);
    pour(a, 3, 300);
    const steps = runUntil(s, () => a.count === 0, 300);
    expect(steps).toBeGreaterThan(0);
    expect(b.count).toBe(300);
  });

  it('two same-color boxes side by side level out into one continuous pile', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 3 }, { shape: '1x1', x: 1, y: 0, color: 3 }] }), 2);
    const [a, b] = s.boxes.map((x) => x.region);
    pour(a, 3, 400);
    runUntilStable(s, () => b.count, 200, 3000);
    expect(a.count + b.count).toBe(400);
    expect(b.count).toBeGreaterThan(100);
    // No cliff at the shared edge: the surface continues across it.
    const ha = columnHeights(a);
    const hb = columnHeights(b);
    expect(Math.abs(ha[N - 1] - hb[0])).toBeLessThanOrEqual(2);
    // and slopes down away from the side that started full
    expect(ha[0]).toBeGreaterThan(hb[N - 1]);
  });

  it('different-color boxes never exchange grains', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 3 }, { shape: '1x1', x: 1, y: 0, color: 4 }] }));
    pour(s.boxes[0].region, 3, 400);
    for (let i = 0; i < 300; i++) stepGame(s);
    expect(s.boxes[0].region.count).toBe(400);
    expect(s.boxes[1].region.count).toBe(0);
  });

  it('grains never leave a box into a sand box', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 1, w: 2, h: 1, layers: [{ color: 6, amount: 0.25 }] }],
      boxes: [{ shape: '1x1', x: 0, y: 0, color: 3 }],
    }));
    pour(s.boxes[0].region, 3, 300);
    for (let i = 0; i < 300; i++) stepGame(s);
    expect(s.boxes[0].region.count).toBe(300);
    expect(countColor(s.sandBoxes[0].region, 3)).toBe(0);
  });
});

describe('pull from the top', () => {
  it('a box on top of a brim-full 1x2 sand box gets only the top few rows, then stops', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 1, w: 1, h: 2, layers: [{ color: 6, amount: 0.5 }, { color: 1, amount: 1.5 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }), 6);
    const box = s.boxes[0].region;
    const sb = s.sandBoxes[0].region;
    let snap = '';
    const steps = runUntilStable(s, () => {
      if (box.count >= 40 && !snap) snap = `top pull mid-way (box ${box.count}):\nbox (bottom rows)\n${ascii(box, 1).split('\n').slice(18).join('\n')}sand box (top rows)\n${ascii(sb, 1).split('\n').slice(0, 8).join('\n')}`;
      expect(topOf(sb, 6)).toBe(36); // blue never moves up
      return box.count;
    }, 300, 3000);
    console.log(snap);
    console.log(`top pull: stalled after ${steps} steps with ${box.count} in the box, ${countColor(sb, 1)} red left`);
    expect(s.boxes[0].state).toBe('active');
    expect(box.count + countColor(sb, 1)).toBe(864);
    // top 3 rows (72 grains), plus the odd grain that slumps into reach
    expect(box.count).toBeGreaterThanOrEqual(60);
    expect(box.count).toBeLessThanOrEqual(150);
    // nothing hovers: every grain left in the sand box is supported
    for (let y = 0; y < sb.h - 1; y++) for (let x = 0; x < sb.w; x++) if (sb.cells[y * sb.w + x]) expect(sb.cells[(y + 1) * sb.w + x]).not.toBe(0);
    expect(topOf(sb, 1)).toBeGreaterThanOrEqual(3);
  });

  it('a wider reach (6) takes a few more rows, still nowhere near the whole layer', () => {
    setPullReach(6);
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 1, w: 1, h: 2, layers: [{ color: 1, amount: 2 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }), 6);
    runUntilStable(s, () => s.boxes[0].region.count, 300, 3000);
    expect(s.boxes[0].region.count).toBeGreaterThan(130);
    expect(s.boxes[0].region.count).toBeLessThan(260);
  });
});

describe('pull through a bottom docking', () => {
  it('with the pull on, a box below still drains its color as a clean plug (nothing left behind)', () => {
    for (const seed of [1, 2, 3]) {
      const s = createGame(level({
        sandBoxes: [{ x: 0, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 1 }, { color: 2, amount: 1 }] }],
        boxes: [{ shape: '1x1', x: 0, y: 2, color: 1 }],
      }), seed);
      runUntil(s, () => s.boxes[0].state === 'removed', 400);
      expect(s.boxes[0].state).toBe('removed');
      expect(countColor(s.sandBoxes[0].region, 1)).toBeLessThanOrEqual(COMPLETION_SLACK);
    }
  });

  it('under half of a 2-wide sand box, edge flow brings the whole floor layer to the hole (no pull needed)', () => {
    setPullReach(0);
    const s = createGame(level({
      sandBoxes: [{ x: 2, y: 1, w: 2, h: 2, layers: [{ color: 1, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 2, y: 3, color: 1 }],
    }), 7);
    const steps = runUntil(s, () => s.boxes[0].state === 'removed', 2000);
    console.log(`half-width bottom docking: full in ${steps} steps`);
    expect(steps).toBeGreaterThan(0);
    expect(s.sandBoxes[0].region.count).toBeLessThanOrEqual(COMPLETION_SLACK);
  });
});

describe('pull from the side', () => {
  it('drains the layer at its height as a wedge while the layer above caves in, then stalls', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 0, w: 1, h: 3, layers: [{ color: 6, amount: 1 }, { color: 1, amount: 1 }, { color: 3, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 2, y: 1, color: 1 }],
    }), 5);
    const sb = s.sandBoxes[0].region;
    const box = s.boxes[0].region;
    let red = countColor(sb, 1);
    let lastChange = 0;
    let snap = '';
    for (let t = 0; t < 1500; t++) {
      stepGame(s);
      const r = countColor(sb, 1);
      expect(r).toBeLessThanOrEqual(red); // monotone
      if (r !== red) lastChange = t;
      red = r;
      expect(box.count + red).toBe(576); // every grain that left is in the box
      expect(countColor(sb, 6)).toBe(576);
      if (t === 40) snap = ascii(sb);
    }
    console.log(`side wedge at t=40:\n${snap}stalled at t=${lastChange}: box ${box.count}, red left ${red}\n${ascii(sb)}`);
    expect(s.boxes[0].state).toBe('active');
    expect(lastChange).toBeLessThan(1000);
    expect(red).toBeGreaterThan(30); // some red got buried by the caved-in yellow
    expect(box.count).toBeGreaterThan(200);
    // yellow caved in: it now reaches below its original bottom (row 24)
    let yellowLow = 0;
    for (let y = 0; y < sb.h; y++) for (let x = 0; x < sb.w; x++) if ((sb.cells[y * sb.w + x] & 31) === 3) yellowLow = y;
    expect(yellowLow).toBeGreaterThan(N);
    // blue untouched
    expect(topOf(sb, 6)).toBe(2 * N);
  });

  it('a side-docked box that already holds sand builds a pile sloping away from the inlet, then fills completely', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 2 }] }],
      boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }],
    }), 5);
    const box = s.boxes[0];
    const r = box.region;
    pour(r, 1, 150);
    let checked = false;
    let inletColumnFull = false;
    for (let t = 0; t < 600 && box.state === 'active'; t++) {
      stepGame(s);
      if (!checked && r.count >= 300) {
        checked = true;
        const h = columnHeights(r);
        const near = (h[N - 1] + h[N - 2] + h[N - 3] + h[N - 4]) / 4;
        const far = (h[0] + h[1] + h[2] + h[3]) / 4;
        console.log(`side fill mid-way (${r.count}/576), inlet on the right:\n${ascii(r)}heights ${h.join(',')}`);
        expect(near).toBeGreaterThan(far + 6);
        // monotone-ish slope: each quarter higher than the one farther from the inlet
        const q = (a: number) => h.slice(a, a + 6).reduce((x, y) => x + y, 0);
        expect(q(18)).toBeGreaterThan(q(12));
        expect(q(12)).toBeGreaterThan(q(0));
      }
      let full = true;
      for (let y = 0; y < N; y++) if (!r.cells[y * N + N - 1]) full = false;
      if (full && r.count < r.capacity) inletColumnFull = true;
    }
    expect(checked).toBe(true);
    expect(box.state).toBe('removed'); // the chain push keeps feeding a buried inlet
    expect(inletColumnFull).toBe(true);
    expect(s.sandBoxes[0].region.count).toBeGreaterThanOrEqual(1152 - 426);
    expect(s.sandBoxes[0].region.count).toBeLessThanOrEqual(1152 - 426 + COMPLETION_SLACK);
  });

  it('a box beside a sand box only takes what is in reach: a buried layer stays put', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 3, layers: [{ color: 1, amount: 1 }, { color: 6, amount: 2 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }));
    for (let i = 0; i < 400; i++) stepGame(s);
    expect(s.boxes[0].region.count).toBe(0);
  });
});

describe('pulled grains and other colors', () => {
  it('never swap with or displace other colors (other colors only ever move down or sideways)', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 2, w: 2, h: 2, layers: [] }],
      boxes: [
        { shape: '2x1', x: 1, y: 1, color: 1 },
        { shape: '1x1', x: 3, y: 2, color: 1 },
      ],
    }), 8);
    const sb = s.sandBoxes[0].region;
    // speckled mix: ~50% red, rest blue/yellow, packed full
    let k = 1;
    for (let i = 0; i < sb.cells.length; i++) {
      k = (k * 1103515245 + 12345) >>> 0;
      const c = (k >>> 16) % 4 < 2 ? 1 : (k >>> 16) % 4 === 2 ? 6 : 3;
      sb.cells[i] = packGrain(c, k & 7);
    }
    sb.count = sb.cells.length;
    const ySum = (c: number) => {
      let n = 0;
      for (let i = 0; i < sb.cells.length; i++) if ((sb.cells[i] & 31) === c) n += Math.floor(i / sb.w);
      return n;
    };
    const totals = colorTotals(s);
    let yb = ySum(6);
    let yy = ySum(3);
    for (let t = 0; t < 600; t++) {
      stepGame(s);
      const nb = ySum(6);
      const ny = ySum(3);
      expect(nb).toBeGreaterThanOrEqual(yb);
      expect(ny).toBeGreaterThanOrEqual(yy);
      yb = nb;
      yy = ny;
    }
    expect(colorTotals(s)).toEqual(totals);
    for (const b of s.boxes) expect(countColor(b.region, 1)).toBe(b.region.count);
    expect(s.boxes[0].region.count + s.boxes[1].region.count).toBeGreaterThan(50);
  });
});

describe('fill times when sand is in reach', () => {
  const cases: [string, SandBoxDef, BoxDef, number, number][] = [
    ['1x1 beside a full 1x1 (right)', { x: 1, y: 1, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }, { shape: '1x1', x: 2, y: 1, color: 1 }, 75, 180],
    ['1x1 beside a full 1x1 (left)', { x: 1, y: 1, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }, { shape: '1x1', x: 0, y: 1, color: 1 }, 75, 180],
    ['1x1 beside the top layer of a 1x2', { x: 1, y: 0, w: 1, h: 2, layers: [{ color: 6, amount: 1 }, { color: 1, amount: 1 }] }, { shape: '1x1', x: 2, y: 0, color: 1 }, 75, 180],
    ['1x1 beside the top layer of a 2x2', { x: 1, y: 0, w: 2, h: 2, layers: [{ color: 6, amount: 2 }, { color: 1, amount: 2 }] }, { shape: '1x1', x: 3, y: 0, color: 1 }, 60, 140],
    ['1x1 below a full 1x1', { x: 1, y: 0, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }, { shape: '1x1', x: 1, y: 1, color: 1 }, 12, 45],
    ['1x2 beside a full 1x2', { x: 1, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 2 }] }, { shape: '1x2', x: 2, y: 0, color: 1 }, 120, 300],
    ['2x2 beside a full 2x2', { x: 1, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 4 }] }, { shape: '2x2', x: 3, y: 0, color: 1 }, 380, 750],
    ['L270 beside a full 2x2', { x: 0, y: 1, w: 2, h: 2, layers: [{ color: 1, amount: 4 }] }, { shape: 'L270', x: 2, y: 1, color: 1 }, 380, 750],
  ];
  for (const [name, sandBox, box, lo, hi] of cases) {
    it(`${name}: ${lo}–${hi} steps, conserving grains`, () => {
      const s = createGame(level({ width: 8, height: 8, sandBoxes: [sandBox], boxes: [box] }), 11);
      const total = totalGrains(s);
      const steps = runUntil(s, () => {
        expect(totalGrains(s, true)).toBe(total);
        return s.boxes[0].state === 'removed';
      }, 3000);
      console.log(`fill time ${name}: ${steps} steps (${(steps / 60).toFixed(2)} s)`);
      expect(steps).toBeGreaterThanOrEqual(lo);
      expect(steps).toBeLessThanOrEqual(hi);
    });
  }
});

describe('conduits and invariants', () => {
  it('a box acts as a conduit from a sand box to a further same-color box', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 2, layers: [{ color: 2, amount: 2 }] }],
      boxes: [
        { shape: '1x1', x: 1, y: 1, color: 2 },
        { shape: '1x1', x: 2, y: 1, color: 2 },
      ],
    }));
    const far = s.boxes[1].region;
    runUntil(s, () => far.count > 0, 2000);
    expect(far.count).toBeGreaterThan(0);
  });

  it('region counts always match their cells', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 2 }, { color: 2, amount: 2 }] }],
      boxes: [
        { shape: 'S', x: 2, y: 0, color: 2 },
        { shape: '2x1', x: 0, y: 2, color: 1 },
      ],
    }));
    for (let t = 0; t < 300; t++) {
      stepGame(s);
      for (const r of [...s.sandBoxes.map((x) => x.region), ...s.boxes.map((x) => x.region)] as SandRegion[])
        expect(recount(r)).toBe(r.count);
    }
  });

  it('is deterministic', () => {
    const run = (): GameState => {
      const s = createGame(level({
        sandBoxes: [{ x: 1, y: 1, w: 2, h: 2, layers: [{ color: 1, amount: 2 }, { color: 2, amount: 2 }] }],
        boxes: [{ shape: '1x2', x: 3, y: 1, color: 2 }, { shape: '2x1', x: 1, y: 0, color: 2 }],
      }), 99);
      for (let t = 0; t < 200; t++) stepGame(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.sandBoxes[0].region.cells)).toEqual(Array.from(b.sandBoxes[0].region.cells));
    expect(a.rng.seed).toBe(b.rng.seed);
  });

  it('resting regions sleep: their versions stay put; a move wakes them', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 2 }, { color: 2, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 3, y: 0, color: 1 }],
    }));
    for (let t = 0; t < 120; t++) stepGame(s);
    const sb = s.sandBoxes[0].region;
    const v = regionVersion(sb);
    for (let t = 0; t < 60; t++) stepGame(s);
    expect(regionVersion(sb)).toBe(v);
    // dock the box beside the red layer: things move again
    tryMoveBox(s, 0, -1, 1);
    for (let t = 0; t < 30; t++) stepGame(s);
    expect(regionVersion(sb)).toBeGreaterThan(v);
    expect(s.boxes[0].region.count).toBeGreaterThan(0);
  });

  it('switching the pull off mid-fill leaves nothing hovering', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 1, w: 1, h: 2, layers: [{ color: 1, amount: 2 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }, { shape: '1x1', x: 2, y: 1, color: 1 }],
    }), 3);
    const sb = s.sandBoxes[0].region;
    for (let t = 0; t < 10; t++) stepGame(s);
    setPullReach(0);
    for (let t = 0; t < 120; t++) stepGame(s);
    for (let y = 0; y < sb.h - 1; y++) for (let x = 0; x < sb.w; x++) if (sb.cells[y * sb.w + x]) expect(sb.cells[(y + 1) * sb.w + x]).not.toBe(0);
  });
});
