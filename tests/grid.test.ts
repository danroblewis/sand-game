import { describe, expect, it } from 'vitest';
import { GRAINS_PER_CELL as N, boxAtCell, buildOccupancy, canPlace, createGame, moveBoxToward, movableBoxes, packGrain, recount, shakeBox, stepGame, tryMoveBox } from '../src/core';
import { level } from './helpers';

const lv = level({
  width: 6,
  height: 6,
  sandBoxes: [{ x: 2, y: 2, w: 2, h: 1, layers: [] }],
  boxes: [
    { shape: '1x1', x: 0, y: 0, color: 1 },
    { shape: '2x1', x: 4, y: 0, color: 2 },
    { shape: 'L0', x: 0, y: 3, color: 3, frozen: 2 },
  ],
});

describe('grid placement', () => {
  it('canPlace checks bounds, sand boxes and other boxes', () => {
    const s = createGame(lv);
    const b = s.boxes[0];
    expect(canPlace(s, b, 0, 0)).toBe(true);
    expect(canPlace(s, b, -1, 0)).toBe(false);
    expect(canPlace(s, b, 6, 0)).toBe(false);
    expect(canPlace(s, b, 0, 6)).toBe(false);
    expect(canPlace(s, b, 2, 2)).toBe(false); // sand box
    expect(canPlace(s, b, 3, 2)).toBe(false);
    expect(canPlace(s, b, 5, 0)).toBe(false); // 2x1 box
    expect(canPlace(s, b, 0, 5)).toBe(false); // L foot at (1,5)? L0 cells: (0,3),(0,4),(0,5),(1,5)
    expect(canPlace(s, b, 1, 5)).toBe(false);
    expect(canPlace(s, b, 1, 4)).toBe(true); // L bounding box but not a shape cell
    const big = s.boxes[1];
    expect(canPlace(s, big, 5, 0)).toBe(false); // out of bounds on the right
  });

  it('removed boxes do not block', () => {
    const s = createGame(lv);
    s.boxes[1].state = 'removed';
    expect(canPlace(s, s.boxes[0], 4, 0)).toBe(true);
    expect(boxAtCell(s, 4, 0)).toBeUndefined();
  });

  it('boxAtCell and occupancy', () => {
    const s = createGame(lv);
    expect(boxAtCell(s, 5, 0)?.id).toBe(1);
    expect(boxAtCell(s, 1, 5)?.id).toBe(2);
    expect(boxAtCell(s, 1, 4)).toBeUndefined();
    const occ = buildOccupancy(s);
    expect(occ[2 * 6 + 3]).toBe(-1);
    expect(occ[0]).toBe(1);
    expect(occ[5]).toBe(2);
    expect(buildOccupancy(s, 0)[0]).toBe(0);
  });

  it('tryMoveBox moves, counts moves, emits events; frozen boxes do not move', () => {
    const s = createGame(lv);
    expect(tryMoveBox(s, 0, 1, 0)).toBe(true);
    expect(s.boxes[0].x).toBe(1);
    expect(s.moves).toBe(1);
    expect(s.events).toContainEqual({ type: 'boxMoved', boxId: 0, x: 1, y: 0 });
    expect(tryMoveBox(s, 0, 0, -1)).toBe(false);
    expect(s.moves).toBe(1);
    expect(tryMoveBox(s, 2, 1, 0)).toBe(false); // frozen
    s.boxes[0].state = 'removed';
    expect(tryMoveBox(s, 0, 1, 0)).toBe(false);
  });

  it('movableBoxes is sorted by y then x and excludes frozen', () => {
    const s = createGame(level({
      boxes: [
        { shape: '1x1', x: 3, y: 2, color: 1 },
        { shape: '1x1', x: 1, y: 2, color: 1 },
        { shape: '1x1', x: 5, y: 0, color: 1 },
        { shape: '1x1', x: 0, y: 5, color: 1, frozen: 1 },
      ],
    }));
    expect(movableBoxes(s).map((b) => b.id)).toEqual([2, 1, 0]);
  });
});

describe('moveBoxToward', () => {
  it('slides straight to the target without counting moves', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }] }));
    expect(moveBoxToward(s, 0, 4, 3)).toBe(7);
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([4, 3]);
    expect(s.moves).toBe(0);
    expect(s.events.filter((e) => e.type === 'boxMoved').length).toBe(7);
  });

  it('slides around an obstacle', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 1, y: 0, w: 1, h: 1, layers: [] }],
      boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }],
    }));
    // x is blocked at first, so it drops a row, then slides right.
    expect(moveBoxToward(s, 0, 3, 1)).toBe(4);
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([3, 1]);
  });

  it('stops when no axis can progress', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 2, y: 0, w: 1, h: 1, layers: [] }],
      boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }],
    }));
    expect(moveBoxToward(s, 0, 4, 0)).toBe(1);
    expect(s.boxes[0].x).toBe(1);
  });
});

describe('shake on move', () => {
  const filled = () => {
    const s = createGame(level({ boxes: [{ shape: '2x1', x: 1, y: 1, color: 4 }] }), 3);
    const r = s.boxes[0].region;
    for (let i = 0; i < 500; i++) {
      r.cells[r.cells.length - 1 - i] = packGrain(4, i % 8);
      r.count++;
    }
    return s;
  };
  const colCounts = (r: { w: number; h: number; cells: Uint8Array }) =>
    Array.from({ length: r.w }, (_, x) => {
      let n = 0;
      for (let y = 0; y < r.h; y++) if (r.cells[y * r.w + x]) n++;
      return n;
    });

  it('a downward move makes surface grains hop up; count preserved exactly', () => {
    const s = filled();
    const r = s.boxes[0].region;
    const cols = colCounts(r);
    const before = Uint8Array.from(r.cells);
    expect(tryMoveBox(s, 0, 0, 1)).toBe(true);
    expect(r.count).toBe(500);
    expect(recount(r)).toBe(500);
    expect(colCounts(r)).toEqual(cols); // vertical hops only
    expect(Array.from(r.cells)).not.toEqual(Array.from(before));
    for (let i = 0; i < 60; i++) stepGame(s);
    expect(r.count).toBe(500);
  });

  it('a sideways drag shakes once per step taken; moveBoxToward conserves too', () => {
    const s = filled();
    const r = s.boxes[0].region;
    expect(moveBoxToward(s, 0, 4, 1)).toBe(3);
    expect(recount(r)).toBe(500);
    expect(r.count).toBe(500);
    expect(shakeBox(s, 0, 1, 0)).toBeGreaterThanOrEqual(0);
    expect(recount(r)).toBe(500);
  });

  it('empty boxes and missing ids are a no-op', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }] }));
    const seed = s.rng.seed;
    expect(shakeBox(s, 0, 1, 0)).toBe(0);
    expect(shakeBox(s, 7, 1, 0)).toBe(0);
    expect(s.rng.seed).toBe(seed);
    expect(N).toBe(24);
  });
});
