import { describe, expect, it } from 'vitest';
import {
  SPRING_INTERVAL,
  buildOccupancy,
  canPlace,
  createGame,
  dissolvedGrains,
  moveBoxToward,
  springStack,
  stepGame,
  tryMoveBox,
} from '../src/core';
import type { GameEvent, GameState } from '../src/core';
import { colorTotals, level } from './helpers';

function drain(s: GameState): GameEvent[] {
  const e = s.events.slice();
  s.events.length = 0;
  return e;
}

/** Three red 1x1 boxes stacked under an up-spring, a 1x3 all-red sand box above. */
const lane = () =>
  level({
    width: 3,
    height: 8,
    sandBoxes: [{ x: 1, y: 0, w: 1, h: 3, layers: [{ color: 1, amount: 3 }] }],
    boxes: [
      { shape: '1x1', x: 1, y: 4, color: 1 },
      { shape: '1x1', x: 1, y: 5, color: 1 },
      { shape: '1x1', x: 1, y: 6, color: 1 },
    ],
    springs: [{ x: 1, y: 7, dir: 'up' }],
  });

describe('springs', () => {
  it('createGame builds springs and clears pushDir', () => {
    const s = createGame(lane());
    expect(s.springs).toEqual([{ id: 0, x: 1, y: 7, dir: 'up', loaded: false }]);
    expect(s.boxes.every((b) => b.pushDir === null)).toBe(true);
    expect(createGame(level({})).springs).toEqual([]);
  });

  it('springs are obstacles for canPlace and occupancy', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }], springs: [{ x: 2, y: 0, dir: 'left' }] }));
    expect(canPlace(s, s.boxes[0], 2, 0)).toBe(false);
    expect(canPlace(s, s.boxes[0], 1, 0)).toBe(true);
    expect(buildOccupancy(s)[2]).toBe(-(s.sandBoxes.length + 1));
    expect(moveBoxToward(s, 0, 4, 0)).toBe(1); // stops in front of the spring... and gets pushed back later
  });

  it('a stack of 3 under an up-spring drains a sand box in sequence: dock, fill, pop, push the next', () => {
    const s = createGame(lane(), 3);
    const totals = colorTotals(s);
    const order: number[] = [];
    let pushes = 0;
    for (let t = 0; t < 4000 && !s.won; t++) {
      stepGame(s);
      for (const e of drain(s)) {
        if (e.type === 'boxCompleted') order.push(e.boxId);
        if (e.type === 'springPushed') {
          pushes++;
          expect(e.dir).toBe('up');
        }
      }
      // conservation (counting dissolved debris)
      const now = colorTotals(s);
      const gone = dissolvedGrains(s);
      expect(now.map((n, c) => n + gone[c])).toEqual(totals);
    }
    expect(s.won).toBe(true);
    expect(order).toEqual([0, 1, 2]); // front box first
    expect(pushes).toBeGreaterThanOrEqual(1 + 2); // initial push into contact, then once after each of the first two pops
    expect(s.moves).toBe(0);
  });

  it('a blocked stack sets loaded and pushDir; the next box is pushed into contact after the front pops', () => {
    const s = createGame(lane(), 3);
    stepGame(s); // pushes the stack into contact with the sand box
    expect(s.boxes.map((b) => b.y)).toEqual([3, 4, 5]);
    for (let t = 0; t < SPRING_INTERVAL; t++) stepGame(s);
    expect(s.springs[0].loaded).toBe(true);
    expect(s.boxes.map((b) => b.pushDir)).toEqual(['up', 'up', 'up']);
    // run until the front box pops, then the rest moves up within an interval
    let t = 0;
    while (s.boxes[0].state === 'active' && t++ < 2000) stepGame(s);
    expect(s.boxes[0].state).toBe('removed');
    for (let k = 0; k <= SPRING_INTERVAL; k++) stepGame(s);
    expect(s.boxes[1].y).toBe(3);
    expect(s.boxes[2].y).toBe(4);
    expect(s.boxes[1].region.count).toBeGreaterThan(0); // receiving sand right after docking
  });

  it('player moves against pushDir are refused; sideways and along are allowed; the spring pushes the rest', () => {
    const s = createGame(lane(), 3);
    for (let t = 0; t < 2; t++) stepGame(s);
    const mid = s.boxes[1];
    expect(mid.pushDir).toBe('up');
    expect(tryMoveBox(s, mid.id, 0, 1)).toBe(false); // against
    expect(moveBoxToward(s, mid.id, mid.x, mid.y + 2)).toBe(0);
    expect(tryMoveBox(s, mid.id, 1, 0)).toBe(true); // sideways out of the lane
    expect(s.moves).toBe(1);
    // the bottom box (now separated) gets pushed up into the gap within an interval
    for (let t = 0; t <= SPRING_INTERVAL; t++) stepGame(s);
    expect(s.boxes[2].y).toBe(4);
    expect(mid.pushDir).toBe(null); // out of the lane
    expect(tryMoveBox(s, mid.id, 0, 1)).toBe(true);
  });

  it('a pushed box can shove a box that blocks another lane; frozen boxes and the edge block', () => {
    const s = createGame(level({
      width: 6,
      height: 4,
      boxes: [
        { shape: '1x1', x: 1, y: 1, color: 1 },
        { shape: '2x1', x: 2, y: 1, color: 2 }, // sits across the lane of the other spring
        { shape: '1x1', x: 3, y: 3, color: 3, frozen: 1 },
      ],
      springs: [
        { x: 0, y: 1, dir: 'right' },
        { x: 3, y: 2, dir: 'up' },
      ],
    }));
    const st = springStack(s, s.springs[0]);
    expect(st.boxes.map((b) => b.id)).toEqual([0, 1]);
    expect(st.blocked).toBe(false);
    stepGame(s);
    expect([s.boxes[0].x, s.boxes[1].x]).toEqual([2, 3]);
    // the 2x1 now also sits in the up-spring's lane; keep stepping until everything is jammed
    for (let t = 0; t < 60; t++) stepGame(s);
    for (const b of s.boxes) {
      if (b.state !== 'active') continue;
      expect(canPlace(s, b, b.x, b.y)).toBe(true); // no overlaps, in bounds, not on a spring
    }
    for (const sp of s.springs) expect(sp.loaded || springStack(s, sp).boxes.length === 0).toBe(true);
    expect(s.boxes[0].x).toBeGreaterThan(1);
    expect(s.boxes[2].x).toBe(3); // frozen box never moves
    // frozen box in front of a spring: blocked, nothing moves
    const f = createGame(level({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1, frozen: 2 }], springs: [{ x: 0, y: 0, dir: 'right' }] }));
    for (let t = 0; t < 10; t++) stepGame(f);
    expect(f.boxes[0].x).toBe(1);
    expect(f.springs[0].loaded).toBe(true);
  });

  it('an empty front cell does nothing; determinism holds', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 4, y: 4, color: 1 }], springs: [{ x: 0, y: 0, dir: 'down' }] }));
    for (let t = 0; t < 10; t++) stepGame(s);
    expect(s.springs[0].loaded).toBe(false);
    expect(s.events.some((e) => e.type === 'springPushed')).toBe(false);
    const a = createGame(lane(), 9);
    const b = createGame(lane(), 9);
    for (let t = 0; t < 300; t++) {
      stepGame(a);
      stepGame(b);
    }
    expect(Array.from(a.sandBoxes[0].region.cells)).toEqual(Array.from(b.sandBoxes[0].region.cells));
    expect(a.boxes.map((x) => [x.x, x.y, x.state])).toEqual(b.boxes.map((x) => [x.x, x.y, x.state]));
  });
});
