import { describe, expect, it } from 'vitest';
import { outlineLoops } from '../src/render/geom';
import type { Vec } from '../src/core/types';

const cells = (rows: string[]): Vec[] => {
  const out: Vec[] = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch === '#' && out.push({ x, y })));
  return out;
};
/** Signed area (y-down): positive = clockwise on screen (outer), negative = hole. */
const area = (l: Vec[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + (p.x * q.y - q.x * p.y); }, 0) / 2;
const perimeter = (l: Vec[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + Math.abs(q.x - p.x) + Math.abs(q.y - p.y); }, 0);
/** Every loop edge is axis-aligned (no diagonal slivers). */
const axisAligned = (loops: Vec[][]) => loops.every((l) => l.every((p, i) => { const q = l[(i + 1) % l.length]; return p.x === q.x || p.y === q.y; }));

describe('outlineLoops', () => {
  it('cells touching only at a corner get separate loops', () => {
    const loops = outlineLoops(cells(['#.', '.#']));
    expect(loops.length).toBe(2);
    expect(axisAligned(loops)).toBe(true);
    for (const l of loops) {
      expect(l.length).toBe(4);
      expect(area(l)).toBe(1);
    }
  });

  it('a diagonal staircase of walls (Crossfire-like) stays axis-aligned', () => {
    const loops = outlineLoops(cells(['#...', '.#..', '..#.', '...#']));
    expect(loops.length).toBe(4);
    expect(axisAligned(loops)).toBe(true);
    expect(loops.reduce((s, l) => s + area(l), 0)).toBe(4);
  });

  it('an L is one 6-vertex loop', () => {
    const loops = outlineLoops(cells(['#.', '##']));
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(6);
    expect(area(loops[0])).toBe(3);
  });

  it('a ring has an outer loop and a hole running the other way', () => {
    const loops = outlineLoops(cells(['###', '#.#', '###']));
    expect(loops.length).toBe(2);
    const areas = loops.map(area).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);
    expect(axisAligned(loops)).toBe(true);
  });

  it('a plus is one 12-vertex loop', () => {
    const loops = outlineLoops(cells(['.#.', '###', '.#.']));
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(12);
    expect(area(loops[0])).toBe(5);
    expect(perimeter(loops[0])).toBe(12);
  });

  it('two holes meeting at a corner inside one group split cleanly at the pinch', () => {
    const loops = outlineLoops(cells(['####', '#.##', '##.#', '####']));
    expect(loops.length).toBe(3);
    expect(axisAligned(loops)).toBe(true);
    expect(loops.map(area).sort((a, b) => a - b)).toEqual([-1, -1, 16]);
  });

  it('pinch between two groups and inside a group with cells: total perimeter is preserved', () => {
    const c = cells(['##..', '#.#.', '.##.', '...#']);
    const loops = outlineLoops(c);
    expect(axisAligned(loops)).toBe(true);
    // every cell side that faces a non-cell is in exactly one loop
    const has = new Set(c.map((p) => `${p.x},${p.y}`));
    let sides = 0;
    for (const p of c) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has.has(`${p.x + dx},${p.y + dy}`)) sides++;
    expect(loops.reduce((s, l) => s + perimeter(l), 0)).toBe(sides);
    expect(loops.reduce((s, l) => s + area(l), 0)).toBe(c.length);
  });
});
