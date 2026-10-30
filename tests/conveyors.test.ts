import { describe, expect, it } from 'vitest';
import { CONVEYOR_INTERVAL, OCC_WALL, buildOccupancy, canPlace, wallAtCell, conveyorAtCell, conveyorPlan, createGame, dissolvedGrains, riderNextFree, stepGame, tryMoveBox } from '../src/core';
import type { GameEvent, GameState, LevelDef } from '../src/core';
import { colorTotals, level } from './helpers';

const steps = (s: GameState, n: number) => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepGame(s);
    ev.push(...s.events);
    s.events.length = 0;
  }
  return ev;
};

/** Upward belt in column 1 from y=7 to y=3, a 1x3 all-red sand box above it (rows 0..2). */
const lane = (boxes: LevelDef['boxes']) =>
  level({
    width: 3,
    height: 8,
    sandBoxes: [{ x: 1, y: 0, w: 1, h: 3, layers: [{ color: 1, amount: 3 }] }],
    boxes,
    conveyors: [{ x: 1, y: 7, dir: 'up', length: 5 }],
  });

const queue = () => lane([
  { shape: '1x1', x: 1, y: 5, color: 1 },
  { shape: '1x1', x: 1, y: 6, color: 1 },
  { shape: '1x1', x: 1, y: 7, color: 1 },
]);

describe('conveyors', () => {
  it('createGame builds the strip cells, heldBoxId and pushDir; conveyorAtCell finds them', () => {
    const s = createGame(queue());
    expect(s.conveyors[0].cells).toEqual([7, 6, 5, 4, 3].map((y) => ({ x: 1, y })));
    expect(s.heldBoxId).toBe(null);
    expect(s.boxes.every((b) => b.pushDir === null)).toBe(true);
    expect(conveyorAtCell(s, 1, 4)?.id).toBe(0);
    expect(conveyorAtCell(s, 1, 2)).toBeUndefined();
    expect(createGame(level({})).conveyors).toEqual([]);
  });

  it('belt cells are not obstacles for canPlace', () => {
    const s = createGame(lane([{ shape: '1x1', x: 0, y: 7, color: 2 }]));
    expect(canPlace(s, s.boxes[0], 1, 4)).toBe(true);
    expect(tryMoveBox(s, 0, 1, 0)).toBe(true);
  });

  it('a queue of 3 on an upward belt under a sand box drains it in layer order and wins (conserving grains)', () => {
    // Different colors: touching same-color boxes would form one group (rule 6b) and wait for each
    // other. The bottom layer reaches the front box first.
    const s = createGame(level({
      width: 3,
      height: 8,
      sandBoxes: [{ x: 1, y: 0, w: 1, h: 3, layers: [{ color: 1, amount: 1 }, { color: 2, amount: 1 }, { color: 3, amount: 1 }] }],
      boxes: [
        { shape: '1x1', x: 1, y: 5, color: 1 },
        { shape: '1x1', x: 1, y: 6, color: 2 },
        { shape: '1x1', x: 1, y: 7, color: 3 },
      ],
      conveyors: [{ x: 1, y: 7, dir: 'up', length: 5 }],
    }), 3);
    const totals = colorTotals(s);
    const order: number[] = [];
    let conveyed = 0;
    for (let t = 0; t < 40 * CONVEYOR_INTERVAL && !s.won; t++) {
      for (const e of steps(s, 1)) {
        if (e.type === 'boxCompleted') order.push(e.boxId);
        if (e.type === 'conveyed') conveyed++;
      }
      const gone = dissolvedGrains(s);
      expect(colorTotals(s).map((n, c) => n + gone[c])).toEqual(totals);
    }
    expect(s.won).toBe(true);
    expect(order).toEqual([0, 1, 2]);
    expect(conveyed).toBeGreaterThanOrEqual(3);
    expect(s.moves).toBe(0);
  });

  it('the queue compacts toward the end, one cell per interval, front first', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 5, color: 3 }, // non-matching colors: nothing pops meanwhile
      { shape: '1x1', x: 1, y: 6, color: 3 },
      { shape: '1x1', x: 1, y: 7, color: 3 },
    ]), 3);
    const ev = steps(s, 1); // tick 0 is a belt step
    expect(s.boxes.map((b) => b.y)).toEqual([4, 5, 6]);
    expect(ev.filter((e) => e.type === 'conveyed')).toEqual([{ type: 'conveyed', conveyorId: 0, boxIds: [0, 1, 2], dir: 'up' }]);
    expect(s.boxes.map((b) => b.pushDir)).toEqual(['up', 'up', 'up']);
    steps(s, CONVEYOR_INTERVAL - 1);
    expect(s.boxes.map((b) => b.y)).toEqual([4, 5, 6]); // not before the interval
    steps(s, 1);
    expect(s.boxes.map((b) => b.y)).toEqual([3, 4, 5]); // front docked against the sand box
    steps(s, CONVEYOR_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([3, 4, 5]); // jammed
    expect(s.boxes.map((b) => b.pushDir)).toEqual([null, null, null]);
  });

  it('a box dropped at the belt start rides to the back of the queue', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 3, color: 3 }, // a non-matching front box: it stays docked
      { shape: '1x1', x: 0, y: 7, color: 2 },
    ]), 3);
    expect(tryMoveBox(s, 1, 1, 0)).toBe(true); // onto the belt start (1,7)
    steps(s, 6 * CONVEYOR_INTERVAL);
    expect([s.boxes[1].x, s.boxes[1].y]).toEqual([1, 4]); // right behind the front box
  });

  it('the held box is not carried and blocks the boxes behind it until released', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 5, color: 3 }, // non-matching colors: nothing pops
      { shape: '1x1', x: 1, y: 6, color: 3 },
      { shape: '1x1', x: 1, y: 7, color: 3 },
    ]), 3);
    s.heldBoxId = 1;
    steps(s, 3 * CONVEYOR_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([3, 6, 7]); // front rode on; middle held; back blocked by it
    s.heldBoxId = null;
    steps(s, 3 * CONVEYOR_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([3, 4, 5]);
  });

  it('a frozen box on the belt does not ride and blocks the boxes behind it', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 5, color: 2, frozen: 2 },
      { shape: '1x1', x: 1, y: 7, color: 1 },
    ]), 3);
    steps(s, 4 * CONVEYOR_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([5, 6]);
  });

  it('a box rides only if its first cell is on the strip; dragging against the belt is allowed', () => {
    const s = createGame(level({
      width: 6,
      height: 4,
      boxes: [{ shape: '2x1', x: 0, y: 1, color: 1 }],
      conveyors: [{ x: 1, y: 3, dir: 'up', length: 3 }], // column 1, rows 3..1
    }));
    steps(s, 1);
    // A box rides the belt under its FIRST cell (top-left) only: here only the right cell is on
    // the strip, so it stays put.
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([0, 1]);
    expect(tryMoveBox(s, 0, 1, 0)).toBe(true); // now its first cell (1,1) is on the strip
    steps(s, CONVEYOR_INTERVAL);
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([1, 0]);
    expect(tryMoveBox(s, 0, 0, 1)).toBe(true); // dragging against the belt is allowed
  });

  it('is deterministic', () => {
    const run = () => {
      const s = createGame(queue(), 9);
      steps(s, 400);
      return [Array.from(s.sandBoxes[0].region.cells), s.boxes.map((b) => [b.x, b.y, b.state]), s.rng.seed];
    };
    expect(run()).toEqual(run());
  });

  it('phase rises 0..1 between belt steps and resets on a belt step', () => {
    const s = createGame(queue(), 3);
    steps(s, 1);
    expect(s.conveyors[0].phase).toBe(0); // tick 0 was a belt step
    steps(s, Math.floor(CONVEYOR_INTERVAL / 2));
    expect(s.conveyors[0].phase).toBeCloseTo(Math.floor(CONVEYOR_INTERVAL / 2) / CONVEYOR_INTERVAL, 5);
    steps(s, CONVEYOR_INTERVAL - 1 - Math.floor(CONVEYOR_INTERVAL / 2));
    expect(s.conveyors[0].phase).toBeCloseTo((CONVEYOR_INTERVAL - 1) / CONVEYOR_INTERVAL, 5);
    steps(s, 1);
    expect(s.conveyors[0].phase).toBe(0);
  });

  it('riderNextFree predicts the next belt step (queued boxes behind a moving one glide too) without moving anything', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 4, color: 3 },
      { shape: '1x1', x: 1, y: 5, color: 3 },
      { shape: '1x1', x: 0, y: 0, color: 2 }, // off the belt
    ]), 3);
    expect(riderNextFree(s, s.boxes[0])).toBe('up');
    expect(riderNextFree(s, s.boxes[1])).toBe('up'); // its cell ahead is being vacated
    expect(riderNextFree(s, s.boxes[2])).toBe(null);
    expect(s.boxes.map((b) => [b.x, b.y])).toEqual([[1, 4], [1, 5], [0, 0]]); // dry run only
    expect([...conveyorPlan(s).keys()]).toEqual([0, 1]);
    steps(s, 1); // belt step: front docks at y=3
    expect(riderNextFree(s, s.boxes[0])).toBe(null); // against the sand box
    expect(riderNextFree(s, s.boxes[1])).toBe(null); // queued behind a box that cannot move
    s.heldBoxId = 1;
    expect(riderNextFree(s, s.boxes[1])).toBe(null);
  });

  it('a box parked in the belt path blocks riders; moving it away lets them continue next belt step', () => {
    const s = createGame(lane([
      { shape: '1x1', x: 1, y: 7, color: 3 }, // rider at the belt start
      { shape: '1x1', x: 0, y: 5, color: 2 }, // parked beside the belt
    ]), 3);
    expect(tryMoveBox(s, 1, 1, 0)).toBe(true); // player parks it on the belt at (1,5)... it rides too
    s.heldBoxId = 1; // ...unless held: keep it there as a blocker
    steps(s, 3 * CONVEYOR_INTERVAL);
    expect(s.boxes[0].y).toBe(6); // stuck behind the parked box
    expect(riderNextFree(s, s.boxes[0])).toBe(null);
    expect(tryMoveBox(s, 1, -1, 0)).toBe(true); // move it out of the way
    s.heldBoxId = null;
    expect(riderNextFree(s, s.boxes[0])).toBe('up');
    const before = s.tick;
    while (s.tick % CONVEYOR_INTERVAL !== 0) steps(s, 1);
    steps(s, 1); // the next belt step
    expect(s.boxes[0].y).toBe(5);
    expect(s.tick - before).toBeLessThanOrEqual(CONVEYOR_INTERVAL + 1);
  });

  it('a box parked across the belt (not riding, off-strip cells free) also blocks', () => {
    // A 2x1 straddling the belt, jammed against a sand box above it (its color isn't in it).
    const s = createGame(level({
      width: 3,
      height: 8,
      sandBoxes: [{ x: 1, y: 0, w: 2, h: 3, layers: [{ color: 4, amount: 6 }] }],
      boxes: [
        { shape: '1x1', x: 1, y: 7, color: 3 },
        { shape: '2x1', x: 1, y: 3, color: 2 }, // jammed against the sand box, across the belt
      ],
      conveyors: [{ x: 1, y: 7, dir: 'up', length: 5 }],
    }), 3);
    steps(s, 6 * CONVEYOR_INTERVAL);
    expect(s.boxes[0].y).toBe(4); // queued behind the jammed 2x1
  });
});

describe('walls', () => {
  it('createGame copies walls; they block canPlace, occupancy and belt riders', () => {
    const lv = level({
      width: 3,
      height: 6,
      boxes: [{ shape: '1x1', x: 1, y: 5, color: 1 }, { shape: '1x1', x: 0, y: 0, color: 2 }],
      conveyors: [{ x: 1, y: 5, dir: 'up', length: 5 }],
      walls: [{ x: 1, y: 2 }],
    });
    const s = createGame(lv);
    expect(s.walls).toEqual([{ x: 1, y: 2 }]);
    expect(s.walls[0]).not.toBe(lv.walls![0]); // copied
    expect(wallAtCell(s, 1, 2)).toEqual({ x: 1, y: 2 });
    expect(wallAtCell(s, 0, 2)).toBeUndefined();
    expect(canPlace(s, s.boxes[1], 1, 2)).toBe(false);
    expect(canPlace(s, s.boxes[1], 0, 2)).toBe(true);
    expect(buildOccupancy(s)[2 * 3 + 1]).toBe(OCC_WALL);
    for (let t = 0; t < 6 * CONVEYOR_INTERVAL; t++) stepGame(s);
    expect(s.boxes[0].y).toBe(3); // rode up to the wall and stopped
    expect(riderNextFree(s, s.boxes[0])).toBe(null);
    expect(createGame(level({})).walls).toEqual([]);
  });
});

describe('belt loops, handoffs and per-belt speeds', () => {
  // 4x4 ring: right along the top, down the right side, left along the bottom, up the left side.
  const ring = (boxes: LevelDef['boxes'], interval = 1, extra: Partial<LevelDef> = {}): LevelDef =>
    level({
      width: 4,
      height: 4,
      boxes,
      conveyors: [
        { x: 0, y: 0, dir: 'right', length: 3, interval },
        { x: 3, y: 0, dir: 'down', length: 3, interval },
        { x: 3, y: 3, dir: 'left', length: 3, interval },
        { x: 0, y: 3, dir: 'up', length: 3, interval },
      ],
      ...extra,
    });
  const PERIM = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]];

  it('a 1x1 circulates a loop of four belts indefinitely, handing off at every corner', () => {
    const s = createGame(ring([{ shape: '1x1', x: 0, y: 0, color: 1 }]));
    const b = s.boxes[0];
    for (let t = 0; t < 36; t++) {
      expect([b.x, b.y]).toEqual(PERIM[t % 12]);
      expect(riderNextFree(s, b)).toBe(['right', 'down', 'left', 'up'][Math.floor((t % 12) / 3)]);
      steps(s, 1);
    }
    expect([b.x, b.y]).toEqual(PERIM[0]);
  });

  it('a queue follows its leader around a corner in one belt step', () => {
    const s = createGame(ring([
      { shape: '1x1', x: 3, y: 0, color: 1 }, // on the corner: first cell on the down belt
      { shape: '1x1', x: 2, y: 0, color: 2 }, // right behind it on the top belt
    ]));
    steps(s, 1);
    expect(s.boxes.map((b) => [b.x, b.y])).toEqual([[3, 1], [3, 0]]);
    expect(s.boxes.map((b) => b.pushDir)).toEqual(['down', 'right']);
  });

  it('a blocked box stops and resumes when the way clears; conveyorPlan agrees', () => {
    const s = createGame(ring([
      { shape: '1x1', x: 0, y: 0, color: 1 },
      { shape: '1x1', x: 2, y: 0, color: 2 },
    ]));
    s.heldBoxId = 1; // the held box is not carried and blocks
    steps(s, 3);
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([1, 0]);
    expect(conveyorPlan(s).has(0)).toBe(false);
    s.heldBoxId = null;
    expect(conveyorPlan(s)).toEqual(new Map([[1, 'right'], [0, 'right']]));
    steps(s, 1);
    expect(s.boxes.map((b) => [b.x, b.y])).toEqual([[2, 0], [3, 0]]);
    // a wall ahead also stops it
    const w = createGame(ring([{ shape: '1x1', x: 0, y: 0, color: 1 }], 1, { walls: [{ x: 2, y: 0 }] }));
    steps(w, 5);
    expect([w.boxes[0].x, w.boxes[0].y]).toEqual([1, 0]);
  });

  it('belts with different intervals step on their own schedules; phase is per belt', () => {
    const s = createGame(level({
      width: 10,
      height: 2,
      boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }, { shape: '1x1', x: 0, y: 1, color: 2 }],
      conveyors: [
        { x: 0, y: 0, dir: 'right', length: 10, interval: 2 },
        { x: 0, y: 1, dir: 'right', length: 10, interval: 5 },
      ],
    }));
    expect(s.conveyors.map((c) => c.interval)).toEqual([2, 5]);
    expect(createGame(queue()).conveyors[0].interval).toBe(CONVEYOR_INTERVAL);
    steps(s, 10); // ticks 0..9: fast belt steps at 0,2,4,6,8; slow at 0,5
    expect(s.boxes.map((b) => b.x)).toEqual([5, 2]);
    expect(s.conveyors.map((c) => c.phase)).toEqual([1 / 2, 4 / 5]);
  });
});

