import { describe, expect, it } from 'vitest';
import { BOX_FALL_INTERVAL, boxSupported, createGame, dissolvedGrains, fallPlan, stepGame, tryMoveBox } from '../src/core';
import type { GameEvent, GameState, LevelDef } from '../src/core';
import { colorTotals, level } from './helpers';

const grav = (p: Partial<LevelDef>): LevelDef => ({ ...level(p), boxGravity: true });
const run = (s: GameState, n: number): GameEvent[] => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepGame(s);
    ev.push(...s.events);
    s.events.length = 0;
  }
  return ev;
};

describe('box gravity', () => {
  it('createGame copies the flag (default off) and sets falling = 0', () => {
    expect(createGame(level({})).boxGravity).toBe(false);
    const s = createGame(grav({ boxes: [{ shape: '1x1', x: 0, y: 5, color: 1 }] }));
    expect(s.boxGravity).toBe(true);
    expect(s.boxes[0].falling).toBe(0);
  });

  it('a stack of three falls together and lands with one boxLanded per box', () => {
    const s = createGame(grav({
      boxes: [
        { shape: '1x1', x: 2, y: 0, color: 1 },
        { shape: '2x1', x: 2, y: 1, color: 2 },
        { shape: '1x1', x: 3, y: 2, color: 3 },
      ],
    }));
    expect(fallPlan(s)).toEqual(new Set([0, 1, 2]));
    expect(boxSupported(s, s.boxes[2])).toBe(false);
    // board height 6: the stack falls 3 cells on fall steps at ticks 0, 4, 8 and lands on the
    // last of them (same step as the final move), bottom box first
    const ev = run(s, 2 * BOX_FALL_INTERVAL + 1);
    expect(s.boxes.map((b) => b.y)).toEqual([3, 4, 5]);
    expect(ev.filter((e) => e.type === 'boxMoved').length).toBe(9);
    expect(ev.filter((e) => e.type === 'boxLanded')).toEqual([
      { type: 'boxLanded', boxId: 2, fell: 3 },
      { type: 'boxLanded', boxId: 1, fell: 3 },
      { type: 'boxLanded', boxId: 0, fell: 3 },
    ]);
    const lastMove = ev.map((e) => e.type).lastIndexOf('boxMoved');
    expect(ev.findIndex((e) => e.type === 'boxLanded')).toBeGreaterThan(lastMove); // after the moves, same step
    expect(run(s, 2 * BOX_FALL_INTERVAL).some((e) => e.type === 'boxLanded')).toBe(false); // no late duplicate
    expect(s.boxes.every((b) => b.falling === 0)).toBe(true);
    expect(s.moves).toBe(0);
    expect(fallPlan(s).size).toBe(0);
  });

  it('pulling the bottom box out sideways drops the two above', () => {
    const s = createGame(grav({
      boxes: [
        { shape: '1x1', x: 2, y: 3, color: 1 },
        { shape: '1x1', x: 2, y: 4, color: 2 },
        { shape: '1x1', x: 2, y: 5, color: 3 },
      ],
    }));
    expect(run(s, BOX_FALL_INTERVAL).some((e) => e.type === 'boxLanded')).toBe(false); // resting
    expect(tryMoveBox(s, 2, 1, 0)).toBe(true);
    expect(fallPlan(s)).toEqual(new Set([0, 1]));
    run(s, 2 * BOX_FALL_INTERVAL);
    expect(s.boxes.map((b) => [b.x, b.y])).toEqual([[2, 4], [2, 5], [3, 5]]);
  });

  it('the held box never falls and supports boxes on it; it falls after release', () => {
    const s = createGame(grav({
      boxes: [
        { shape: '1x1', x: 1, y: 1, color: 1 },
        { shape: '1x1', x: 1, y: 2, color: 2 },
      ],
    }));
    s.heldBoxId = 1;
    expect(boxSupported(s, s.boxes[1])).toBe(true);
    expect(boxSupported(s, s.boxes[0])).toBe(true);
    run(s, 4 * BOX_FALL_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([1, 2]);
    expect(tryMoveBox(s, 1, 0, -1)).toBe(false); // box 0 is in the way
    s.heldBoxId = null;
    run(s, 5 * BOX_FALL_INTERVAL);
    expect(s.boxes.map((b) => b.y)).toEqual([4, 5]);
  });

  it('frozen boxes fall; walls and sand boxes are shelves; player moves upward are allowed', () => {
    const s = createGame(grav({
      sandBoxes: [{ x: 0, y: 3, w: 1, h: 1, layers: [] }],
      boxes: [
        { shape: '1x1', x: 0, y: 0, color: 1, frozen: 2 },
        { shape: '1x1', x: 4, y: 0, color: 2 },
      ],
      walls: [{ x: 4, y: 2 }],
    }));
    run(s, 4 * BOX_FALL_INTERVAL);
    expect(s.boxes.map((b) => [b.x, b.y])).toEqual([[0, 2], [4, 1]]);
    expect(tryMoveBox(s, 1, 0, -1)).toBe(true);
    expect(s.boxes[1].y).toBe(0);
    run(s, 2 * BOX_FALL_INTERVAL);
    expect(s.boxes[1].y).toBe(1);
  });

  it('a box moved under a floating sand box onto a wall shelf catches its color; without the shelf it falls away', () => {
    const lv = (shelf: boolean) =>
      grav({
        sandBoxes: [{ x: 2, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 1 }] }],
        boxes: [{ shape: '1x1', x: 1, y: 2, color: 1 }],
        walls: shelf ? [{ x: 1, y: 3 }, { x: 2, y: 3 }] : [{ x: 1, y: 3 }],
      });
    const s = createGame(lv(true), 3);
    expect(boxSupported(s, s.boxes[0])).toBe(true); // resting on the wall
    expect(tryMoveBox(s, 0, 1, 0)).toBe(true); // under the sand box, on the shelf
    let t = 0;
    while (s.boxes[0].state === 'active' && t++ < 2000) stepGame(s);
    expect(s.boxes[0].state).toBe('removed');
    expect(t).toBeLessThan(120); // gravity catch
    const f = createGame(lv(false), 3);
    expect(tryMoveBox(f, 0, 1, 0)).toBe(true);
    run(f, 6 * BOX_FALL_INTERVAL);
    expect(f.boxes[0].y).toBe(5); // fell to the floor
    const got = f.boxes[0].region.count;
    expect(got).toBeLessThan(576); // only what fell in during the moment it touched
    run(f, 300);
    expect(f.boxes[0].region.count).toBe(got);
  });

  it('a shaft beside a one-row sand box of three bands drains in sequence as the stack drops, and wins', () => {
    // 3x1 sand box at the shaft foot: bands (bottom→top) red, orange, yellow, one cell each. The
    // stack's bottom box is the only one beside it, so it must be the top band's color; each pop
    // drops the next box into place (popping the top of a stack would drop nothing).
    const s = createGame(grav({
      width: 4,
      height: 4,
      sandBoxes: [{ x: 1, y: 3, w: 3, h: 1, layers: [{ color: 1, amount: 1 }, { color: 2, amount: 1 }, { color: 3, amount: 1 }] }],
      boxes: [
        { shape: '1x1', x: 0, y: 3, color: 3 },
        { shape: '1x1', x: 0, y: 2, color: 2 },
        { shape: '1x1', x: 0, y: 1, color: 1 },
      ],
    }), 5);
    const totals = colorTotals(s);
    const pops: [number, number][] = [];
    let t = 0;
    for (; t < 20000 && !s.won; t++) {
      for (const e of run(s, 1)) if (e.type === 'boxCompleted') pops.push([e.boxId, t]);
      const gone = dissolvedGrains(s);
      expect(colorTotals(s).map((n, c) => n + gone[c])).toEqual(totals);
    }
    console.log(`gravity shaft: won at step ${t} (${(t / 60).toFixed(1)} s), pops ${pops.map(([id, at]) => `#${id}@${at}`).join(' ')}`);
    expect(s.won).toBe(true);
    expect(pops.map(([id]) => id)).toEqual([0, 1, 2]);
  });

  it('with the flag off nothing falls', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }] }));
    run(s, 10 * BOX_FALL_INTERVAL);
    expect(s.boxes[0].y).toBe(0);
    expect(fallPlan(s).size).toBe(0);
    expect(boxSupported(s, s.boxes[0])).toBe(true);
  });

  it('is deterministic', () => {
    const go = () => {
      const s = createGame(grav({
        sandBoxes: [{ x: 2, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 2 }, { color: 2, amount: 2 }] }],
        boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }, { shape: '2x1', x: 2, y: 2, color: 2 }, { shape: '1x1', x: 4, y: 3, color: 1 }],
      }), 9);
      run(s, 300);
      return [s.boxes.map((b) => [b.x, b.y, b.state, b.region.count]), Array.from(s.sandBoxes[0].region.cells), s.rng.seed];
    };
    expect(go()).toEqual(go());
  });
});
