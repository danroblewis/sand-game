import { describe, expect, it } from 'vitest';
import {
  BOX_FALL_INTERVAL,
  KICK_INTERVAL,
  kickBox,
  slidePlan,
  heroSlidePlan,
  OCC_HERO,
  buildOccupancy,
  canPlace,
  countColor,
  createGame,
  moveBoxToward,
  moveHero,
  restoreState,
  snapshotState,
  stepGame,
  tryMoveBox,
} from '../src/core';
import type { GameEvent, GameState, LevelDef } from '../src/core';
import { level } from './helpers';

const run = (s: GameState, n: number): GameEvent[] => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepGame(s);
    ev.push(...s.events);
    s.events.length = 0;
  }
  return ev;
};
const hero = (p: Partial<LevelDef>, at = { x: 0, y: 0 }): LevelDef => ({ ...level(p), hero: at });
const pos = (s: GameState) => [s.hero!.x, s.hero!.y];

describe('hero: walking and pushing', () => {
  it('createGame sets the hero (null otherwise); it blocks canPlace and occupancy; boxes cannot be dragged', () => {
    expect(createGame(level({})).hero).toBe(null);
    const s = createGame(hero({ boxes: [{ shape: '1x1', x: 3, y: 0, color: 1 }] }, { x: 1, y: 0 }));
    expect(s.hero).toEqual({ x: 1, y: 0, facing: 'right', falling: 0, sliding: null });
    expect(canPlace(s, s.boxes[0], 1, 0)).toBe(false);
    expect(buildOccupancy(s)[1]).toBe(OCC_HERO);
    expect(tryMoveBox(s, 0, 1, 0)).toBe(false);
    expect(moveBoxToward(s, 0, 5, 0)).toBe(0);
  });

  it('walks into free cells, is blocked by walls, sand boxes and edges; moves count steps', () => {
    const s = createGame(hero({
      sandBoxes: [{ x: 0, y: 2, w: 1, h: 1, layers: [] }],
      walls: [{ x: 2, y: 0 }],
    }));
    expect(moveHero(s, 'left')).toBe(false); // edge
    expect(s.hero!.facing).toBe('left');
    expect(moveHero(s, 'right')).toBe(true);
    expect(moveHero(s, 'right')).toBe(false); // wall
    expect(moveHero(s, 'down')).toBe(true);
    expect(moveHero(s, 'left')).toBe(true);
    expect(moveHero(s, 'down')).toBe(false); // sand box
    expect(pos(s)).toEqual([0, 1]);
    expect(s.moves).toBe(3);
    expect(s.events.filter((e) => e.type === 'heroMoved').length).toBe(3);
  });

  it('pushes a 1x1 and an L as a whole; blocked when the cell beyond is occupied', () => {
    const s = createGame(hero({
      width: 8,
      boxes: [
        { shape: '1x1', x: 1, y: 0, color: 1 },
        { shape: 'L0', x: 2, y: 2, color: 2 }, // cells (2,2),(2,3),(2,4),(3,4)
      ],
    }));
    expect(moveHero(s, 'right')).toBe(true);
    expect([s.boxes[0].x, pos(s)]).toEqual([2, [1, 0]]);
    expect(s.events.some((e) => e.type === 'heroPushed' && e.boxId === 0)).toBe(true);
    // push the L from its foot's left side at (1,4)
    s.hero!.x = 1;
    s.hero!.y = 4;
    expect(moveHero(s, 'right')).toBe(true);
    expect([s.boxes[1].x, s.boxes[1].y]).toEqual([3, 2]);
    expect(pos(s)).toEqual([2, 4]);
    // blocked: put the 1x1 right beyond the L's bar and push the L again from (2,2)
    s.boxes[0].x = 5;
    s.boxes[0].y = 4;
    s.hero!.x = 2;
    s.hero!.y = 3;
    expect(moveHero(s, 'right')).toBe(false); // the foot (4,4) would hit the 1x1 at (5,4)
    expect(s.boxes[1].x).toBe(3);
  });

  it('cannot push a frozen box, nor two boxes in a row', () => {
    const s = createGame(hero({
      boxes: [
        { shape: '1x1', x: 1, y: 0, color: 1, frozen: 1 },
        { shape: '1x1', x: 1, y: 1, color: 2 },
        { shape: '1x1', x: 2, y: 1, color: 3 },
      ],
    }));
    expect(moveHero(s, 'right')).toBe(false);
    s.hero!.y = 1;
    expect(moveHero(s, 'right')).toBe(false);
    expect(s.boxes.map((b) => b.x)).toEqual([1, 1, 2]);
    expect(s.moves).toBe(0);
  });

  it('pushing a box against a sand box side starts a drain; the hero can wait', () => {
    const s = createGame(hero({
      sandBoxes: [{ x: 3, y: 0, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }), 3);
    expect(moveHero(s, 'right')).toBe(true); // box to (2,0), touching the sand box
    run(s, 300);
    expect(s.boxes[0].state).toBe('removed');
    expect(countColor(s.sandBoxes[0].region, 1)).toBe(0); // debris dissolved
    expect(s.won).toBe(true);
  });
});

describe('hero with gravity', () => {
  const g = (p: Partial<LevelDef>, at: { x: number; y: number }): LevelDef => ({ ...hero(p, at), boxGravity: true });

  it('falls and lands (heroLanded on the step of the last fall)', () => {
    const s = createGame(g({}, { x: 2, y: 2 }));
    const ev = run(s, 3 * BOX_FALL_INTERVAL + 1); // height 6: falls 3 cells at ticks 0, 4, 8
    expect(pos(s)).toEqual([2, 5]);
    expect(ev.filter((e) => e.type === 'heroLanded')).toEqual([{ type: 'heroLanded', fell: 3 }]);
    expect(s.hero!.falling).toBe(0);
    expect(moveHero(s, 'up')).toBe(false); // no jumping
    expect(moveHero(s, 'down')).toBe(false);
  });

  it('climbs one cell, cannot climb two', () => {
    const s = createGame(g({ walls: [{ x: 2, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 4 }] }, { x: 1, y: 5 }));
    expect(moveHero(s, 'right')).toBe(true);
    expect(pos(s)).toEqual([2, 4]);
    expect(s.events.at(-1)).toMatchObject({ type: 'heroMoved', climbed: true });
    expect(moveHero(s, 'right')).toBe(true); // walks to (3,4) over air... and stands only if supported
    run(s, 2 * BOX_FALL_INTERVAL);
    expect(pos(s)).toEqual([3, 5]); // fell into the gap
    expect(moveHero(s, 'right')).toBe(false); // (4,5) and (4,4) stacked: two cells, no climb
  });

  it('pushes a box off a ledge and it falls; a box cannot fall into the hero; the hero holds up a box', () => {
    const s = createGame(g({
      walls: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
      boxes: [{ shape: '1x1', x: 1, y: 2, color: 1 }],
    }, { x: 0, y: 2 }));
    expect(moveHero(s, 'right')).toBe(true); // box (1,2) → (2,2), still on the ledge
    expect(moveHero(s, 'right')).toBe(true); // box → (3,2): off the ledge
    run(s, 4 * BOX_FALL_INTERVAL);
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([3, 5]);
    // a box dropped onto the hero rests on it
    const t = createGame(g({ boxes: [{ shape: '1x1', x: 2, y: 0, color: 1 }] }, { x: 2, y: 5 }));
    run(t, 8 * BOX_FALL_INTERVAL);
    expect([t.boxes[0].y, t.hero!.y]).toEqual([4, 5]);
  });
});

describe('snapshot / restore', () => {
  it('round-trips exactly and stays in lockstep with the original', () => {
    const lv = hero({
      width: 7,
      sandBoxes: [{ x: 4, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 2 }, { color: 2, amount: 2 }] }],
      boxes: [{ shape: '1x1', x: 2, y: 0, color: 1 }, { shape: '2x1', x: 2, y: 3, color: 2 }],
    }, { x: 1, y: 0 });
    const a = createGame(lv, 5);
    moveHero(a, 'right'); // box 0 → (3,0), touching the sand box
    run(a, 50);
    const snap = snapshotState(a);
    const key = (s: GameState) =>
      JSON.stringify([
        s.sandBoxes.map((x) => [Array.from(x.region.cells), x.region.count]),
        s.boxes.map((b) => [b.x, b.y, b.state, b.frozen, b.falling, Array.from(b.region.cells), b.region.count]),
        s.hero, s.tick, s.rng.seed, s.moves, s.completedCount, s.won,
      ]);
    const atSnap = key(a);
    // diverge: more steps and a move, then restore
    moveHero(a, 'down');
    run(a, 80);
    expect(key(a)).not.toBe(atSnap);
    restoreState(a, snap);
    expect(key(a)).toBe(atSnap);
    // lockstep: a restored game and a fresh replay of the same history step identically
    const b = createGame(lv, 5);
    moveHero(b, 'right');
    run(b, 50);
    expect(key(b)).toBe(atSnap);
    run(a, 200);
    run(b, 200);
    expect(key(a)).toBe(key(b));
  });
});

describe('hero rides belts', () => {
  const belt = (p: Partial<LevelDef>): LevelDef =>
    hero({ width: 6, height: 2, conveyors: [{ x: 0, y: 1, dir: 'right', length: 5, interval: 3 }], ...p }, { x: 0, y: 1 });

  it('rides to the end of the strip on the belt steps, facing along it; walking off stops the ride', () => {
    const s = createGame({ ...belt({}), hero: { x: 1, y: 1 } });
    s.hero!.facing = 'left';
    const ev = run(s, 1); // tick 0: belt step
    expect(pos(s)).toEqual([2, 1]);
    expect(s.hero!.facing).toBe('right');
    expect(ev).toContainEqual({ type: 'heroMoved', x: 2, y: 1, dir: 'right', climbed: false });
    run(s, 2);
    expect(pos(s)).toEqual([2, 1]); // not before the next belt step
    run(s, 3 * 3);
    expect(pos(s)).toEqual([5, 1]); // carried off the end of the strip (4,1) onto (5,1), then stops
    expect(s.moves).toBe(0); // riding is not a move
    // walking off: step up off the belt and stay
    const t = createGame(belt({}));
    expect(moveHero(t, 'up')).toBe(true);
    run(t, 4 * 3);
    expect(pos(t)).toEqual([0, 0]);
  });

  it('pushes a box ahead when it can, and stops when blocked', () => {
    const s = createGame(belt({ boxes: [{ shape: '1x1', x: 2, y: 1, color: 1 }], walls: [{ x: 5, y: 1 }] }));
    // the box rides too; the hero follows; at the wall both stop
    run(s, 7 * 3);
    expect([s.boxes[0].x, pos(s)]).toEqual([4, [3, 1]]);
    // a box off the belt ahead of a riding hero gets pushed
    const p = createGame({ ...hero({ width: 6, height: 2, conveyors: [{ x: 0, y: 1, dir: 'right', length: 2, interval: 3 }], boxes: [{ shape: '1x1', x: 2, y: 1, color: 1 }] }, { x: 1, y: 1 }) });
    const ev = run(p, 1);
    expect([p.boxes[0].x, pos(p)]).toEqual([3, [2, 1]]);
    expect(ev.some((e) => e.type === 'heroPushed')).toBe(true);
  });
});

describe('kick', () => {
  const row = (p: Partial<LevelDef>, at = { x: 0, y: 0 }) => hero({ width: 7, height: 3, ...p }, at);

  it('a kicked box slides to a wall and stops, with the right cell count and events', () => {
    const s = createGame(row({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }], walls: [{ x: 5, y: 0 }] }));
    s.hero!.facing = 'left';
    expect(kickBox(s, 'right')).toBe(true);
    expect(s.boxes[0].sliding).toBe('right');
    expect(pos(s)).toEqual([0, 0]); // the hero stays
    expect(s.hero!.facing).toBe('right');
    expect(s.moves).toBe(1);
    expect(s.events).toContainEqual({ type: 'heroKicked', boxId: 0, dir: 'right' });
    expect(slidePlan(s)).toEqual(new Map([[0, 'right']]));
    const ev = run(s, 5 * KICK_INTERVAL);
    expect(s.boxes[0].x).toBe(4);
    expect(s.boxes[0].sliding).toBe(null);
    expect(ev.filter((e) => e.type === 'boxMoved').length).toBe(3);
    expect(ev.filter((e) => e.type === 'boxSlid')).toEqual([{ type: 'boxSlid', boxId: 0, dir: 'right', cells: 3 }]);
    expect(slidePlan(s).size).toBe(0);
    expect(kickBox(s, 'right')).toBe(true); // no box adjacent any more: a throw
    expect(s.hero!.sliding).toBe('right');
  });

  it('stops at another box; the hero cannot push a sliding box; it can be kicked again once stopped', () => {
    const s = createGame(row({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }, { shape: '1x1', x: 4, y: 0, color: 2 }] }));
    expect(kickBox(s, 'right')).toBe(true);
    expect(moveHero(s, 'right')).toBe(false); // box 0 is sliding: blocked
    run(s, 4 * KICK_INTERVAL);
    expect(s.boxes.map((b) => b.x)).toEqual([3, 4]);
    expect(moveHero(s, 'right')).toBe(true);
    expect(moveHero(s, 'right')).toBe(true); // hero at (2,0) next to box 0
    expect(kickBox(s, 'right')).toBe(false); // box 0 cannot move (box 1 behind it)
    expect(kickBox(s, 'up')).toBe(false); // nothing there
  });

  it('stops at a sand box side and docks: sand flows on the next steps', () => {
    const s = createGame(row({
      sandBoxes: [{ x: 5, y: 0, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }), 3);
    expect(kickBox(s, 'right')).toBe(true);
    run(s, 4 * KICK_INTERVAL);
    expect([s.boxes[0].x, s.boxes[0].sliding]).toEqual([4, null]);
    run(s, 20);
    expect(s.boxes[0].region.count).toBeGreaterThan(0);
  });

  it('kicking a frozen box fails', () => {
    const s = createGame(row({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1, frozen: 1 }] }));
    expect(kickBox(s, 'right')).toBe(false);
    expect(s.moves).toBe(0);
  });

  it('under gravity a kicked box slides off a ledge, stops sliding, falls and lands', () => {
    const s = createGame({
      ...hero({ width: 7, height: 6, walls: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }], boxes: [{ shape: '1x1', x: 1, y: 2, color: 1 }] }, { x: 0, y: 2 }),
      boxGravity: true,
    });
    expect(kickBox(s, 'right')).toBe(true);
    expect(kickBox(s, 'up')).toBe(false); // no vertical kicks with gravity
    const ev = run(s, 12 * BOX_FALL_INTERVAL);
    const slid = ev.find((e) => e.type === 'boxSlid');
    expect(slid).toEqual({ type: 'boxSlid', boxId: 0, dir: 'right', cells: 2 }); // (1,2)→(3,2), off the ledge
    expect([s.boxes[0].x, s.boxes[0].y]).toEqual([3, 5]); // fell to the floor
    expect(ev.filter((e) => e.type === 'boxLanded')).toEqual([{ type: 'boxLanded', boxId: 0, fell: 3 }]);
    expect(ev.indexOf(slid!)).toBeLessThan(ev.findIndex((e) => e.type === 'boxLanded'));
  });

  it('kicking a group piece away separates it: the full piece pops alone', () => {
    const s = createGame(row({
      boxes: [
        { shape: '1x1', x: 1, y: 1, color: 1 }, // full, underneath (so its sand can't fall into the partner)
        { shape: '1x1', x: 1, y: 0, color: 1 }, // empty partner on top
      ],
    }, { x: 0, y: 1 }));
    const r = s.boxes[0].region;
    r.cells.fill(1);
    r.count = r.capacity;
    run(s, 2);
    expect(s.boxes[0].state).toBe('active'); // held back by its empty partner
    expect(kickBox(s, 'right')).toBe(true);
    run(s, 2 * KICK_INTERVAL);
    expect(s.boxes[0].state).toBe('removed');
    expect(s.boxes[1].state).toBe('active');
  });

  it('undo restores a mid-slide state exactly; determinism holds', () => {
    const lv = row({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }], walls: [{ x: 6, y: 0 }] });
    const a = createGame(lv, 2);
    kickBox(a, 'right');
    run(a, 3);
    const snap = snapshotState(a);
    const key = (s: GameState) => JSON.stringify([s.boxes.map((b) => [b.x, b.y, b.sliding]), s.hero, s.tick, s.rng.seed, s.moves]);
    const at = key(a);
    const evA = run(a, 20).filter((e) => e.type === 'boxSlid');
    restoreState(a, snap);
    expect(key(a)).toBe(at);
    expect(a.boxes[0].sliding).toBe('right');
    const evB = run(a, 20).filter((e) => e.type === 'boxSlid');
    expect(evB).toEqual(evA); // same stop, same cell count (the counter is part of the snapshot)
    expect(evA).toEqual([{ type: 'boxSlid', boxId: 0, dir: 'right', cells: 4 }]);
  });
});

describe('throw (kick with no box ahead)', () => {
  const row = (p: Partial<LevelDef>, at = { x: 0, y: 0 }) => hero({ width: 7, height: 3, ...p }, at);

  it('throws the hero to a wall: one move, heroThrown, heroMoved per cell, heroSlid with the count', () => {
    const s = createGame(row({ walls: [{ x: 5, y: 0 }] }));
    expect(kickBox(s, 'right')).toBe(true);
    expect(s.hero!.sliding).toBe('right');
    expect(s.moves).toBe(1);
    expect(s.events).toContainEqual({ type: 'heroThrown', dir: 'right' });
    expect(heroSlidePlan(s)).toBe('right');
    const ev = run(s, 6 * KICK_INTERVAL);
    expect(pos(s)).toEqual([4, 0]);
    expect(s.hero!.sliding).toBe(null);
    expect(ev.filter((e) => e.type === 'heroMoved').length).toBe(4);
    expect(ev.filter((e) => e.type === 'heroSlid')).toEqual([{ type: 'heroSlid', dir: 'right', cells: 4 }]);
    expect(heroSlidePlan(s)).toBe(null);
    expect(s.moves).toBe(1);
  });

  it('stops at a box without pushing it; input is ignored while sliding', () => {
    const s = createGame(row({ boxes: [{ shape: '1x1', x: 4, y: 0, color: 1 }] }));
    expect(kickBox(s, 'right')).toBe(true); // (1,0) is free: a throw
    expect(moveHero(s, 'down')).toBe(false); // sliding: no input
    expect(kickBox(s, 'down')).toBe(false);
    const ev = run(s, 6 * KICK_INTERVAL);
    expect(pos(s)).toEqual([3, 0]);
    expect(s.boxes[0].x).toBe(4); // not pushed
    expect(ev.filter((e) => e.type === 'heroSlid')).toEqual([{ type: 'heroSlid', dir: 'right', cells: 3 }]);
    expect(moveHero(s, 'down')).toBe(true); // input again after it stopped
  });

  it('a kick with a box ahead kicks the box, not the hero', () => {
    const s = createGame(row({ boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }] }));
    expect(kickBox(s, 'right')).toBe(true);
    expect(s.boxes[0].sliding).toBe('right');
    expect(s.hero!.sliding).toBe(null);
    expect(s.events.some((e) => e.type === 'heroThrown')).toBe(false);
  });

  it('under gravity the thrown hero slides off a ledge, stops sliding, falls and lands', () => {
    const s = createGame({ ...hero({ width: 7, height: 6, walls: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }] }, { x: 0, y: 2 }), boxGravity: true });
    expect(kickBox(s, 'up')).toBe(false); // no vertical throws with gravity
    expect(kickBox(s, 'right')).toBe(true);
    const ev = run(s, 12 * BOX_FALL_INTERVAL);
    expect(ev.find((e) => e.type === 'heroSlid')).toEqual({ type: 'heroSlid', dir: 'right', cells: 3 }); // (0,2)→(3,2)
    expect(pos(s)).toEqual([3, 5]);
    expect(ev.filter((e) => e.type === 'heroLanded')).toEqual([{ type: 'heroLanded', fell: 3 }]);
  });

  it('belts do not carry a sliding hero; undo mid-slide resumes identically', () => {
    const lv = row({ walls: [{ x: 6, y: 0 }] });
    const a = createGame(lv, 2);
    kickBox(a, 'right');
    run(a, 3);
    const snap = snapshotState(a);
    const at = JSON.stringify([a.hero, a.tick, a.moves]);
    const evA = run(a, 20).filter((e) => e.type === 'heroSlid');
    restoreState(a, snap);
    expect(JSON.stringify([a.hero, a.tick, a.moves])).toBe(at);
    expect(a.hero!.sliding).toBe('right');
    expect(run(a, 20).filter((e) => e.type === 'heroSlid')).toEqual(evA);
    expect(evA).toEqual([{ type: 'heroSlid', dir: 'right', cells: 5 }]);
    // a belt under the hero does nothing while it slides
    const b = createGame({ ...row({ conveyors: [{ x: 0, y: 0, dir: 'down', length: 1, interval: 1 }] }) });
    kickBox(b, 'right');
    run(b, 1);
    expect(pos(b)).toEqual([1, 0]);
  });
});

