import { describe, expect, it } from 'vitest';
import {
  GRAINS_PER_UNIT,
  createRegion,
  createRng,
  fillLayers,
  grainColor,
  packGrain,
  regionVersion,
  shakeRegion,
  recount,
  regionIsFull,
  setGrain,
  stepRegion,
  countColor,
} from '../src/core';

describe('sand region', () => {
  it('createRegion computes capacity from mask', () => {
    expect(createRegion(4, 3).capacity).toBe(12);
    const m = new Uint8Array([1, 0, 1, 1]);
    expect(createRegion(2, 2, m).capacity).toBe(3);
  });

  it('setGrain keeps count correct and respects mask', () => {
    const r = createRegion(2, 2, new Uint8Array([1, 0, 1, 1]));
    expect(setGrain(r, 1, 0, packGrain(1, 0))).toBe(false);
    setGrain(r, 0, 0, packGrain(1, 0));
    setGrain(r, 0, 0, packGrain(2, 0));
    expect(r.count).toBe(1);
    setGrain(r, 0, 0, 0);
    expect(r.count).toBe(0);
  });

  it('gravity / slide / slump conserve grains and settle downward', () => {
    const rng = createRng(7);
    const r = createRegion(30, 40);
    // Scatter grains in the top half.
    for (let i = 0; i < 300; i++) setGrain(r, (i * 7) % 30, (i * 13) % 20, packGrain(1 + (i % 3), i % 8));
    const n = r.count;
    for (let s = 0; s < 400; s++) {
      stepRegion(r, rng, s);
      expect(recount(r)).toBe(n);
    }
    expect(r.count).toBe(n);
    // All grains should be in the bottom rows now.
    for (let y = 0; y < 40 - Math.ceil(n / 30) - 3; y++)
      for (let x = 0; x < 30; x++) expect(r.cells[y * 30 + x]).toBe(0);
  });

  it('slump flattens a pile', () => {
    const rng = createRng(3);
    const r = createRegion(40, 30);
    for (let y = 10; y < 30; y++) for (let x = 0; x < 5; x++) setGrain(r, x, y, packGrain(1, 0));
    for (let s = 0; s < 1500; s++) stepRegion(r, rng, s);
    // 100 grains over 40 columns: height should be within a few rows.
    let maxH = 0;
    for (let x = 0; x < 40; x++) {
      let h = 0;
      for (let y = 0; y < 30; y++) if (r.cells[y * 40 + x]) h++;
      maxH = Math.max(maxH, h);
    }
    expect(r.count).toBe(100);
    expect(maxH).toBeLessThanOrEqual(9);
  });

  it('respects the mask', () => {
    const rng = createRng(1);
    // 3 wide, 3 tall, middle-bottom cell masked out.
    const m = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 0, 1]);
    const r = createRegion(3, 3, m);
    setGrain(r, 1, 0, packGrain(1, 0));
    for (let s = 0; s < 20; s++) stepRegion(r, rng, s);
    expect(r.cells[7]).toBe(0);
    expect(r.count).toBe(1);
  });

  it('fillLayers fills bottom-up, left to right, with exact counts', () => {
    const r = createRegion(24, 48);
    const placed = fillLayers(r, [
      { color: 1, amount: 1 },
      { color: 6, amount: 0.5 },
    ]);
    expect(placed).toBe(GRAINS_PER_UNIT * 1.5);
    expect(r.count).toBe(placed);
    expect(countColor(r, 1)).toBe(576);
    expect(countColor(r, 6)).toBe(288);
    // bottom 24 rows red, next 12 rows blue, rest empty
    for (let y = 0; y < 48; y++) {
      const c = grainColor(r.cells[y * 24 + 5]);
      if (y >= 24) expect(c).toBe(1);
      else if (y >= 12) expect(c).toBe(6);
      else expect(c).toBe(0);
    }
    // partial row fills left to right
    const p = createRegion(10, 10);
    fillLayers(p, [{ color: 2, amount: 15 / GRAINS_PER_UNIT }]);
    for (let x = 0; x < 10; x++) expect(p.cells[90 + x]).not.toBe(0);
    for (let x = 0; x < 5; x++) expect(p.cells[80 + x]).not.toBe(0);
    for (let x = 5; x < 10; x++) expect(p.cells[80 + x]).toBe(0);
  });

  it('fillLayers respects mask and regionIsFull', () => {
    const m = new Uint8Array([1, 1, 0, 1]);
    const r = createRegion(2, 2, m);
    expect(fillLayers(r, [{ color: 1, amount: 1 }])).toBe(3);
    expect(r.cells[2]).toBe(0);
    expect(regionIsFull(r)).toBe(true);
  });

  it('a resting region keeps its version; a moving one bumps it', () => {
    const rng = createRng(2);
    const r = createRegion(10, 10);
    fillLayers(r, [{ color: 1, amount: 50 / GRAINS_PER_UNIT }]);
    const v0 = regionVersion(r);
    for (let s = 0; s < 5; s++) stepRegion(r, rng, s);
    expect(regionVersion(r)).toBe(v0); // flat layer at rest
    setGrain(r, 5, 0, packGrain(2, 0));
    const v1 = regionVersion(r);
    stepRegion(r, rng, 5);
    expect(regionVersion(r)).toBeGreaterThan(v1);
  });
});

describe('shakeRegion', () => {
  const setup = () => {
    const r = createRegion(24, 24);
    fillLayers(r, [{ color: 1, amount: 0.4 }], createRng(9));
    // a small heap so the sideways shake has somewhere to go
    for (let y = 8; y < 14; y++) for (let x = 10; x < 14; x++) setGrain(r, x, y, packGrain(2, 1));
    return r;
  };
  const perColumn = (r: ReturnType<typeof createRegion>) =>
    Array.from({ length: r.w }, (_, x) => Array.from({ length: r.h }, (_, y) => (r.cells[y * r.w + x] ? 1 : 0) as number).reduce((a, b) => a + b, 0));
  const perRow = (r: ReturnType<typeof createRegion>) =>
    Array.from({ length: r.h }, (_, y) => Array.from(r.cells.subarray(y * r.w, y * r.w + r.w)).filter((v) => v !== 0).length);

  it('hops up (downward move): count and per-column counts preserved, only into empty cells', () => {
    const r = setup();
    const before = Uint8Array.from(r.cells);
    const n = r.count;
    const cols = perColumn(r);
    const hops = shakeRegion(r, createRng(4), 0, -1, 0.5, 2);
    expect(hops).toBeGreaterThan(10);
    expect(recount(r)).toBe(n);
    expect(r.count).toBe(n);
    expect(perColumn(r)).toEqual(cols);
    // Grains only went up, at most SHAKE_HOPS (2) cells: each column's top rises by 0..2.
    const top = (c: Uint8Array, x: number) => {
      for (let y = 0; y < r.h; y++) if (c[y * r.w + x]) return y;
      return r.h;
    };
    let lifted = 0;
    for (let x = 0; x < r.w; x++) {
      const d = top(before, x) - top(r.cells, x);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(2);
      lifted += d;
    }
    expect(lifted).toBeGreaterThan(0);
    // Gravity brings the surface back.
    const rng = createRng(1);
    for (let s = 0; s < 30; s++) stepRegion(r, rng, s);
    expect(r.count).toBe(n);
  });

  it('hops sideways (move right → sand tumbles left): per-row counts preserved, respects the mask', () => {
    const r = setup();
    const n = r.count;
    const rows = perRow(r);
    expect(shakeRegion(r, createRng(5), -1, 0, 0.5, 2)).toBeGreaterThan(0);
    expect(recount(r)).toBe(n);
    expect(perRow(r)).toEqual(rows);
    const m = new Uint8Array(9).fill(1);
    m[3] = 0; // (0,1) outside
    const k = createRegion(3, 3, m);
    setGrain(k, 1, 1, packGrain(1, 0));
    for (let i = 0; i < 20; i++) shakeRegion(k, createRng(i), -1, 0, 1, 2);
    expect(k.cells[3]).toBe(0);
    expect(k.count).toBe(1);
  });
});
