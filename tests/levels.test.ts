import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../src/core/types';
import { LEVELS, getLevel } from '../src/levels/index';
import { levelCapacityByColor, levelSandByColor, validateLevel, validateLevels } from '../src/levels/validate';
import { parseStep, settle } from '../src/levels/replay';
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
  it('has 14-18 levels', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(14);
    expect(LEVELS.length).toBeLessThanOrEqual(18);
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
        for (const step of level.solution!) {
          const p = parseStep(step);
          expect(p, `bad step ${step}`).not.toBeNull();
          expect(p!.box).toBeLessThan(level.boxes.length);
        }
        // every box is dragged at least once unless it is completed in place (frozen boxes that
        // thaw already docked)
        const dragged = new Set(level.solution!.map((st) => parseStep(st)!.box));
        level.boxes.forEach((b, i) => {
          if (!dragged.has(i)) expect(b.frozen ?? 0, `box#${i} never moves`).toBeGreaterThan(0);
        });
      });
    });
  }

  it('introduces frozen boxes no earlier than level 7', () => {
    LEVELS.slice(0, 6).forEach((l) => expect(l.boxes.some((b) => b.frozen)).toBe(false));
    expect(LEVELS.slice(6).filter((l) => l.boxes.some((b) => b.frozen)).length).toBeGreaterThan(5);
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

  it('rejects duplicate level ids', () => {
    expect(validateLevels([base(), base()]).join('\n')).toMatch(/duplicate level id/);
  });
});
