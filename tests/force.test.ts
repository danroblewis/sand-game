import { describe, expect, it } from 'vitest';
import {
  BOX_FALL_INTERVAL,
  createGame,
  dissolvedGrains,
  forcePlan,
  kickBox,
  moveHero,
  restoreState,
  snapshotState,
  stepGame,
} from '../src/core';
import type { GameEvent, GameState, LevelDef } from '../src/core';
import { colorTotals, level } from './helpers';

const run = (s: GameState, n: number): GameEvent[] => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepGame(s);
    ev.push(...s.events);
    s.events.length = 0;
  }
  return ev;
};
const xs = (s: GameState) => s.boxes.map((b) => [b.x, b.y]);

/** A 3x1 sand box of three one-cell bands (bottom→top red, orange, yellow) on the right; a train
 *  front-to-back yellow, orange and a right-driven red box behind them. */
const station = (): LevelDef =>
  level({
    width: 7,
    height: 2,
    sandBoxes: [{ x: 4, y: 0, w: 3, h: 1, layers: [{ color: 1, amount: 1 }, { color: 2, amount: 1 }, { color: 3, amount: 1 }] }],
    boxes: [
      { shape: '1x1', x: 2, y: 0, color: 3 },
      { shape: '1x1', x: 1, y: 0, color: 2 },
      { shape: '1x1', x: 0, y: 0, color: 1, force: 'right' },
    ],
  });

describe('driven boxes', () => {
  it('createGame copies force (null by default) and pressing = false', () => {
    const s = createGame(station());
    expect(s.boxes.map((b) => b.force)).toEqual([null, null, 'right']);
    expect(s.boxes.every((b) => b.pressing === false)).toBe(true);
  });

  it('a driven box pushes a 3-box train against a sand box: front drains and pops, the train advances at once, ... won', () => {
    const s = createGame(station(), 3);
    const totals = colorTotals(s);
    expect(forcePlan(s)).toEqual(new Map([[2, 'right'], [1, 'right'], [0, 'right']]));
    const first = run(s, 1); // tick 0: the train moves one cell into contact
    expect(first.filter((e) => e.type === 'forcePushed')).toEqual([{ type: 'forcePushed', boxId: 2, boxIds: [2, 1, 0], dir: 'right' }]);
    expect(xs(s)).toEqual([[3, 0], [2, 0], [1, 0]]);
    const pops: [number, number][] = [];
    let advancedAfter = -1;
    for (let t = 1; t < 20000 && !s.won; t++) {
      for (const e of run(s, 1)) {
        if (e.type === 'boxCompleted') pops.push([e.boxId, t]);
        if (e.type === 'forcePushed' && pops.length === 1 && advancedAfter < 0) advancedAfter = t - pops[0][1];
      }
      const gone = dissolvedGrains(s);
      expect(colorTotals(s).map((n, c) => n + gone[c])).toEqual(totals);
    }
    console.log(`driven train: pops ${pops.map(([id, t]) => `#${id}@${t}`).join(' ')}, won at ${s.tick}`);
    expect(s.won).toBe(true);
    expect(pops.map(([id]) => id)).toEqual([0, 1, 2]);
    expect(advancedAfter).toBeGreaterThanOrEqual(0);
    expect(advancedAfter).toBeLessThanOrEqual(BOX_FALL_INTERVAL); // no timer: next force tick
  });

  it('a pressing box has pressing = true and moves within one interval once the blocker is gone', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1, force: 'right' }], walls: [{ x: 2, y: 0 }] }));
    run(s, 1);
    expect(s.boxes[0].pressing).toBe(true);
    expect(forcePlan(s).size).toBe(0);
    s.walls.length = 0;
    run(s, BOX_FALL_INTERVAL);
    expect(s.boxes[0].x).toBe(2);
    expect(s.boxes[0].pressing).toBe(false);
  });

  it('two opposed driven boxes in one train are stuck', () => {
    const s = createGame(level({
      boxes: [
        { shape: '1x1', x: 1, y: 0, color: 1, force: 'right' },
        { shape: '1x1', x: 2, y: 0, color: 2, force: 'left' },
      ],
    }));
    run(s, 3 * BOX_FALL_INTERVAL);
    expect(xs(s)).toEqual([[1, 0], [2, 0]]);
    expect(s.boxes.map((b) => b.pressing)).toEqual([true, true]);
  });

  it('under gravity an up-driven box lifts a box and supports it', () => {
    const s = createGame({ ...level({ boxes: [{ shape: '1x1', x: 2, y: 5, color: 1, force: 'up' }, { shape: '1x1', x: 2, y: 4, color: 2 }] }), boxGravity: true });
    run(s, 8 * BOX_FALL_INTERVAL);
    expect(xs(s)).toEqual([[2, 1], [2, 0]]);
    expect(s.boxes[0].pressing).toBe(true); // pressed against the ceiling through its train
    run(s, 4 * BOX_FALL_INTERVAL);
    expect(xs(s)).toEqual([[2, 1], [2, 0]]); // nothing falls
  });

  it('a right-driven box falls off a ledge, then keeps pushing along the floor', () => {
    const s = createGame({
      ...level({ width: 7, boxes: [{ shape: '1x1', x: 1, y: 2, color: 1, force: 'right' }], walls: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }] }),
      boxGravity: true,
    });
    const ev = run(s, 20 * BOX_FALL_INTERVAL);
    expect(xs(s)).toEqual([[6, 5]]);
    expect(ev.some((e) => e.type === 'boxLanded')).toBe(true);
    expect(s.boxes[0].pressing).toBe(true); // against the right edge
  });

  it('frozen driven boxes do nothing until thawed, then push', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1, force: 'right', frozen: 1 }] }));
    run(s, 3 * BOX_FALL_INTERVAL);
    expect(s.boxes[0].x).toBe(0);
    expect(s.boxes[0].pressing).toBe(false);
    s.boxes[0].frozen = 0;
    run(s, BOX_FALL_INTERVAL);
    expect(s.boxes[0].x).toBe(1);
  });
});

describe('driven boxes and the hero', () => {
  const lv = (): LevelDef => ({ ...level({ width: 6, height: 4, boxes: [{ shape: '1x1', x: 2, y: 1, color: 1, force: 'right' }] }), hero: { x: 3, y: 1 } });

  it('the hero cannot push it against its force, but can push it across; it resumes when free', () => {
    const s = createGame(lv());
    run(s, 1);
    expect(s.boxes[0].pressing).toBe(true); // the hero blocks it
    expect(moveHero(s, 'left')).toBe(false); // against the force: resists
    expect(moveHero(s, 'up')).toBe(true);
    expect(moveHero(s, 'left')).toBe(true); // hero at (2,0), above the box
    expect(moveHero(s, 'down')).toBe(true); // push across: box (2,1) → (2,2)
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([2, 2]);
    run(s, 2 * BOX_FALL_INTERVAL);
    expect(s.boxes[0].x).toBeGreaterThan(2); // driving right again
  });

  it('kicks: across slides, along is a push, against is resisted', () => {
    const s = createGame(lv());
    run(s, 1);
    expect(kickBox(s, 'left')).toBe(false); // against
    moveHero(s, 'up');
    moveHero(s, 'left'); // hero (2,0)
    expect(kickBox(s, 'down')).toBe(true); // across: slides down
    expect(s.boxes[0].sliding).toBe('down');
    const t = createGame({ ...level({ width: 6, height: 4, boxes: [{ shape: '1x1', x: 2, y: 1, color: 1, force: 'right' }], walls: [{ x: 5, y: 1 }] }), hero: { x: 1, y: 1 } });
    const moves = t.moves;
    expect(kickBox(t, 'right')).toBe(true); // along: a push (box and hero move one)
    expect([t.boxes[0].x, t.hero!.x, t.boxes[0].sliding, t.moves - moves]).toEqual([3, 2, null, 1]);
  });
});

describe('driven boxes: snapshots and determinism', () => {
  it('snapshot round-trips force/pressing and stays in lockstep', () => {
    const a = createGame(station(), 4);
    run(a, 300);
    const snap = snapshotState(a);
    const key = (s: GameState) => JSON.stringify([xs(s), s.boxes.map((b) => [b.force, b.pressing, b.state, b.region.count]), s.tick, s.rng.seed]);
    const at = key(a);
    run(a, 400);
    const later = key(a);
    restoreState(a, snap);
    expect(key(a)).toBe(at);
    run(a, 400);
    expect(key(a)).toBe(later);
    const b = createGame(station(), 4);
    run(b, 700);
    expect(key(b)).toBe(later);
  });
});
