import { describe, expect, it } from 'vitest';
import {
  BOX_FALL_INTERVAL,
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
    expect(s.hero).toEqual({ x: 1, y: 0, facing: 'right', falling: 0 });
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
