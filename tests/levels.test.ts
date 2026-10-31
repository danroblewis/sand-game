import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../src/core/types';
import { LEVELS, getLevel } from '../src/levels/index';
import { levelCapacityByColor, levelSandByColor, validateLevel, validateLevels } from '../src/levels/validate';
import { parseHeroEntry, parseStep, replayLevel, settle } from '../src/levels/replay';
import { createGame } from '../src/core';

const base = (): LevelDef => ({
  id: 'test',
  name: 'Test',
  width: 6,
  height: 8,
  sandBoxes: [{ x: 2, y: 1, w: 2, h: 2, layers: [{ color: 1, amount: 1 }, { color: 6, amount: 2 }] }],
  boxes: [
    { shape: '1x1', x: 0, y: 6, color: 1 },
    { shape: '2x1', x: 3, y: 6, color: 6 },
  ],
});

describe('LEVELS', () => {
  it('has 14-80 levels', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(14);
    expect(LEVELS.length).toBeLessThanOrEqual(80);
  });

  it('chapter 1 (levels 1-18) has no box gravity; chapter 2 (Workshop) is all box gravity', () => {
    LEVELS.slice(0, 18).forEach((l) => expect(l.boxGravity ?? false, l.id).toBe(false));
    const ch2 = LEVELS.slice(18, 27);
    expect(ch2.length).toBe(9);
    ch2.forEach((l) => {
      expect(l.boxGravity, l.id).toBe(true);
      expect(l.conveyors ?? [], `${l.id}: no belts in gravity levels`).toEqual([]);
      expect(l.hero, `${l.id}: no hero in Workshop`).toBeUndefined();
    });
  });

  it('chapters 3+ (Pusher, Pusher II: levels 28+) all have a hero, no belts; earlier levels have none', () => {
    LEVELS.slice(0, 27).forEach((l) => expect(l.hero, l.id).toBeUndefined());
    const hero = LEVELS.slice(27);
    expect(hero.length).toBeGreaterThanOrEqual(14);
    hero.forEach((l) => {
      expect(l.hero, l.id).toBeDefined();
      expect(l.conveyors ?? [], `${l.id}: no belts in hero levels`).toEqual([]);
    });
    // within each hero chapter: floating Sokoban first, then platform (gravity) Sokoban
    for (const ch of [LEVELS.slice(27, 41), LEVELS.slice(41)]) {
      if (!ch.length) continue;
      const g = ch.map((l) => !!l.boxGravity);
      if (!g.includes(true)) continue;
      expect(g.indexOf(true)).toBeGreaterThanOrEqual(4);
      expect(g.slice(g.indexOf(true)).every((x) => x)).toBe(true);
    }
  });

  it('has unique ids and names', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length);
    expect(validateLevels(LEVELS)).toEqual([]);
  });

  it('getLevel finds levels by id', () => {
    expect(getLevel(LEVELS[3].id)).toBe(LEVELS[3]);
    expect(getLevel('nope')).toBeUndefined();
  });

  for (const level of LEVELS) {
    describe(level.id, () => {
      it('passes validateLevel', () => {
        expect(validateLevel(level)).toEqual([]);
      });

      it('has a portrait-friendly board and at most 6 colors', () => {
        expect(level.width).toBeGreaterThanOrEqual(6);
        expect(level.width).toBeLessThanOrEqual(8);
        expect(level.height).toBeGreaterThanOrEqual(7);
        expect(level.height).toBeLessThanOrEqual(11);
        expect(level.name.length).toBeGreaterThan(0);
        expect(levelCapacityByColor(level).size).toBeLessThanOrEqual(6);
      });

      it('no box gets sand before the player moves anything', () => {
        // Otherwise a box would fill (or start filling) with no player action.
        const state = createGame(level, 7);
        settle(state, 30, 600);
        for (const b of state.boxes) expect(b.region.count, `box#${b.id} starts docked`).toBe(0);
      });

      it('has an authored solution that references real boxes', () => {
        expect(level.solution?.length, 'missing solution').toBeGreaterThan(0);
        if (level.hero) {
          // hero levels: every entry is a string of U/D/L/R inputs
          for (const step of level.solution!) expect(parseHeroEntry(step), `bad hero entry ${step}`).not.toBeNull();
          return;
        }
        for (const step of level.solution!) {
          const p = parseStep(step);
          expect(p, `bad step ${step}`).not.toBeNull();
          expect(p!.box).toBeLessThan(level.boxes.length);
        }
        // every box is dragged at least once unless it is completed in place (frozen boxes that
        // thaw already docked) or, with box gravity, dropped into place when its support is pulled
        // (a closet over a shaft); the physics replay proves those complete.
        const dragged = new Set(level.solution!.map((st) => parseStep(st)!.box));
        level.boxes.forEach((b, i) => {
          if (!dragged.has(i) && !level.boxGravity) expect(b.frozen ?? 0, `box#${i} never moves`).toBeGreaterThan(0);
        });
      });
    });
  }

  it('introduces frozen boxes no earlier than level 7', () => {
    LEVELS.slice(0, 6).forEach((l) => expect(l.boxes.some((b) => b.frozen)).toBe(false));
    expect(LEVELS.slice(6).filter((l) => l.boxes.some((b) => b.frozen)).length).toBeGreaterThan(5);
  });
});

describe('hero solutions with kicks', () => {
  it('parses K + direction as a kick', () => {
    expect(parseHeroEntry('RRKLDD')).toEqual([
      { dir: 'right', kick: false },
      { dir: 'right', kick: false },
      { dir: 'left', kick: true },
      { dir: 'down', kick: false },
      { dir: 'down', kick: false },
    ]);
    expect(parseHeroEntry('RK')).toBeNull(); // a kick needs a direction
    expect(parseHeroEntry('KX')).toBeNull();
  });

  it('a kicked box slides until blocked and the entry settles only after it stops', () => {
    // hero at (0,3) kicks the red right: it slides past (2,3) and stops against the wall at (4,3),
    // right under the red sand box at (3,2), and catches it; the hero never moves
    const lv: LevelDef = {
      id: 'kick-test',
      name: 'Kick Test',
      width: 6,
      height: 6,
      hero: { x: 0, y: 3 },
      sandBoxes: [{ x: 3, y: 2, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }],
      walls: [{ x: 4, y: 3 }],
      boxes: [{ shape: '1x1', x: 1, y: 3, color: 1 }],
      solution: ['KR'],
    };
    expect(validateLevel(lv)).toEqual([]);
    for (const seed of [7, 1]) {
      const r = replayLevel(lv, lv.solution!, { seed });
      expect(r.won, r.why).toBe(true);
      expect(r.inputs).toBe(1);
      expect(r.kicks).toBe(1);
      expect(r.state.hero).toMatchObject({ x: 0, y: 3 });
    }
    // a plain push moves it one cell only: not under the sand box, no win
    expect(replayLevel(lv, ['R'], { seed: 7 }).won).toBe(false);
  });
});

describe('validateLevel', () => {
  it('accepts a simple valid level', () => {
    expect(validateLevel(base())).toEqual([]);
    expect(levelSandByColor(base()).get(6)).toBe(2);
    expect(levelCapacityByColor(base()).get(6)).toBe(2);
  });

  it('rejects non-positive board size', () => {
    expect(validateLevel({ ...base(), width: 0 }).length).toBeGreaterThan(0);
  });

  it('rejects overlapping boxes', () => {
    const l = base();
    l.boxes[1] = { shape: '2x1', x: 0, y: 6, color: 6 };
    expect(validateLevel(l).join('\n')).toMatch(/overlap/);
  });

  it('rejects a box overlapping a sand box', () => {
    const l = base();
    l.boxes[0] = { shape: '1x1', x: 2, y: 2, color: 1 };
    expect(validateLevel(l).join('\n')).toMatch(/overlaps sandBox/);
  });

  it('rejects overlapping sand boxes', () => {
    const l = base();
    l.sandBoxes.push({ x: 3, y: 2, w: 2, h: 2, layers: [{ color: 4, amount: 1 }] });
    l.boxes.push({ shape: '1x1', x: 5, y: 7, color: 4 });
    expect(validateLevel(l).join('\n')).toMatch(/sandBox#1 overlaps sandBox#0/);
  });

  it('rejects out-of-bounds boxes and sand boxes', () => {
    const l = base();
    l.boxes[1] = { shape: '2x1', x: 5, y: 6, color: 6 };
    expect(validateLevel(l).join('\n')).toMatch(/out of bounds/);
    const l2 = base();
    l2.sandBoxes[0] = { ...l2.sandBoxes[0], x: 5 };
    expect(validateLevel(l2).join('\n')).toMatch(/out of bounds/);
  });

  it('rejects conservation mismatches', () => {
    const l = base();
    l.sandBoxes[0].layers[0].amount = 1.5;
    expect(validateLevel(l).join('\n')).toMatch(/color 1 sand 1.5 != box capacity 1/);
    const l2 = base();
    l2.boxes.push({ shape: '1x1', x: 5, y: 0, color: 4 });
    expect(validateLevel(l2).join('\n')).toMatch(/color 4/);
  });

  it('tolerates floating point sums', () => {
    const l = base();
    l.sandBoxes[0].layers = [
      { color: 1, amount: 0.1 },
      { color: 1, amount: 0.2 },
      { color: 1, amount: 0.7 },
      { color: 6, amount: 2 },
    ];
    expect(validateLevel(l)).toEqual([]);
  });

  it('rejects overfilled or empty sand boxes', () => {
    const l = base();
    l.sandBoxes[0].layers.push({ color: 4, amount: 2 });
    l.boxes.push({ shape: '2x1', x: 0, y: 0, color: 4 });
    expect(validateLevel(l).join('\n')).toMatch(/overfilled/);
    const l2 = base();
    l2.sandBoxes.push({ x: 0, y: 4, w: 1, h: 1, layers: [] });
    expect(validateLevel(l2).join('\n')).toMatch(/no layers|holds no sand/);
  });

  it('rejects bad colors', () => {
    const l = base();
    l.boxes[0].color = 13;
    l.sandBoxes[0].layers[0].color = 13;
    expect(validateLevel(l).join('\n')).toMatch(/not in 1\.\.12/);
  });

  it('rejects unreachable frozen counters', () => {
    const l = base();
    l.boxes[0].frozen = 2;
    expect(validateLevel(l).join('\n')).toMatch(/frozen/);
    const l2 = base();
    l2.boxes[0].frozen = 1;
    l2.boxes[1].frozen = 1;
    expect(validateLevel(l2).join('\n')).toMatch(/needs 1 completions but only 0/);
    const ok = base();
    ok.boxes[0].frozen = 1;
    expect(validateLevel(ok)).toEqual([]);
  });

  it('accepts conveyors and rejects bad ones', () => {
    const ok = base();
    // a belt under a box (boxes may start on belts) running up to the sand box face
    ok.conveyors = [{ x: 0, y: 6, dir: 'up', length: 3 }];
    expect(validateLevel(ok)).toEqual([]);
    const cases: [LevelDef['conveyors'], RegExp][] = [
      [[{ x: 0, y: 1, dir: 'up', length: 3 }], /out of bounds/],
      [[{ x: 6, y: 0, dir: 'left', length: 1 }], /out of bounds/],
      [[{ x: 0, y: 1, dir: 'right', length: 3 }], /overlaps sandBox/],
      [[{ x: 0, y: 0, dir: 'right', length: 0 }], /length/],
      [[{ x: 0, y: 0, dir: 'sideways' as never, length: 1 }], /unknown direction/],
      [
        [
          { x: 0, y: 4, dir: 'right', length: 3 },
          { x: 1, y: 5, dir: 'up', length: 2 },
        ],
        /conveyor#1.*overlaps conveyor#0/,
      ],
    ];
    for (const [conveyors, re] of cases) {
      const l = base();
      l.conveyors = conveyors;
      expect(validateLevel(l).join('\n')).toMatch(re);
    }
  });

  it('accepts walls and rejects bad ones', () => {
    const ok = base();
    ok.walls = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(validateLevel(ok)).toEqual([]);
    const cases: [LevelDef['walls'], RegExp][] = [
      [[{ x: 6, y: 0 }], /wall#0.*out of bounds/],
      [[{ x: 2, y: 1 }], /wall#0.*overlaps sandBox/],
      [[{ x: 0, y: 6 }], /wall#0.*overlaps box/],
      [[{ x: 0, y: 0 }, { x: 0, y: 0 }], /wall#1.*overlaps wall#0/],
    ];
    for (const [walls, re] of cases) {
      const l = base();
      l.walls = walls;
      expect(validateLevel(l).join('\n')).toMatch(re);
    }
    const l = base();
    l.walls = [{ x: 0, y: 5 }];
    l.conveyors = [{ x: 0, y: 6, dir: 'up', length: 2 }];
    expect(validateLevel(l).join('\n')).toMatch(/conveyor#0.*overlaps wall#0/);
  });

  it('box gravity: every box must start resting', () => {
    const ok: LevelDef = {
      ...base(),
      boxGravity: true,
      walls: [{ x: 4, y: 3 }],
      boxes: [
        { shape: '1x1', x: 0, y: 7, color: 1 }, // on the floor
        { shape: '2x1', x: 0, y: 6, color: 6 }, // half on the red box: resting
      ],
    };
    expect(validateLevel(ok)).toEqual([]);
    const onWall: LevelDef = { ...ok, boxes: [{ shape: '1x1', x: 0, y: 7, color: 1 }, { shape: '2x1', x: 4, y: 2, color: 6 }] };
    expect(validateLevel(onWall)).toEqual([]);
    const underSandBox: LevelDef = { ...ok, boxes: [{ shape: '1x1', x: 0, y: 7, color: 1 }, { shape: '2x1', x: 2, y: 0, color: 6 }] };
    expect(validateLevel(underSandBox)).toEqual([]); // resting on the sand box's top
    const floating: LevelDef = { ...ok, boxes: [{ shape: '1x1', x: 0, y: 7, color: 1 }, { shape: '2x1', x: 3, y: 5, color: 6 }] };
    expect(validateLevel(floating).join('\n')).toMatch(/box#1.*does not start resting/);
    // a tall box resting on nothing but itself is still floating
    const tall: LevelDef = { ...ok, boxes: [{ shape: '1x1', x: 0, y: 4, color: 1 }, { shape: '2x1', x: 0, y: 7, color: 6 }] };
    expect(validateLevel(tall).join('\n')).toMatch(/box#0.*does not start resting/);
    // without box gravity floating boxes are fine
    expect(validateLevel({ ...floating, boxGravity: false })).toEqual([]);
  });

  it('hero: starts in bounds on a free cell, resting with box gravity', () => {
    const ok: LevelDef = {
      ...base(),
      walls: [{ x: 5, y: 0 }],
      boxes: [
        { shape: '1x1', x: 0, y: 7, color: 1 },
        { shape: '2x1', x: 3, y: 7, color: 6 },
      ],
      hero: { x: 1, y: 7 },
    };
    expect(validateLevel(ok)).toEqual([]);
    expect(validateLevel({ ...ok, hero: { x: 6, y: 0 } }).join('\n')).toMatch(/hero start \(6,0\) out of bounds/);
    expect(validateLevel({ ...ok, hero: { x: -1, y: 2 } }).join('\n')).toMatch(/hero start.*out of bounds/);
    expect(validateLevel({ ...ok, hero: { x: 5, y: 0 } }).join('\n')).toMatch(/hero start \(5,0\) is not a free cell \(wall/);
    expect(validateLevel({ ...ok, hero: { x: 2, y: 1 } }).join('\n')).toMatch(/not a free cell \(sandBox#0/);
    expect(validateLevel({ ...ok, hero: { x: 0, y: 7 } }).join('\n')).toMatch(/not a free cell \(box#0/);
    // floating: fine without gravity, rejected with it; resting on the floor, a box, a wall is fine
    expect(validateLevel({ ...ok, hero: { x: 1, y: 3 } })).toEqual([]);
    const g: LevelDef = { ...ok, boxGravity: true };
    expect(validateLevel(g)).toEqual([]);
    expect(validateLevel({ ...g, hero: { x: 1, y: 3 } }).join('\n')).toMatch(/hero start \(1,3\) does not start resting/);
    expect(validateLevel({ ...g, hero: { x: 0, y: 6 } })).toEqual([]); // on the red box
    expect(validateLevel({ ...g, hero: { x: 2, y: 0 } })).toEqual([]); // on the sand box
  });

  it('rejects duplicate level ids', () => {
    expect(validateLevels([base(), base()]).join('\n')).toMatch(/duplicate level id/);
  });
});
