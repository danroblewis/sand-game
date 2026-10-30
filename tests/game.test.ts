import { describe, expect, it } from 'vitest';
import { COMPLETION_SLACK, DISSOLVE_STEPS, GRAINS_PER_UNIT, boxComplete, checkCompletions, dissolvedGrains, createGame, stepGame, countColor } from '../src/core';
import type { GameEvent } from '../src/core';
import { level, totalGrains } from './helpers';

describe('createGame', () => {
  it('builds regions, masks, ids and frozen counters', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 2, h: 2, layers: [{ color: 1, amount: 1.5 }, { color: 2, amount: 2 }] }],
      boxes: [
        { shape: 'L0', x: 3, y: 0, color: 1 },
        { shape: '1x1', x: 5, y: 5, color: 2, frozen: 3 },
      ],
    }));
    const sb = s.sandBoxes[0];
    expect(sb.region.w).toBe(48);
    expect(sb.region.count).toBe(3.5 * GRAINS_PER_UNIT);
    expect(countColor(sb.region, 1)).toBe(1.5 * GRAINS_PER_UNIT);
    const L = s.boxes[0];
    expect([L.bw, L.bh, L.region.w, L.region.h]).toEqual([2, 3, 48, 72]);
    expect(L.region.capacity).toBe(4 * GRAINS_PER_UNIT);
    expect(s.boxes.map((b) => b.id)).toEqual([0, 1]);
    expect(s.boxes[1].frozen).toBe(3);
    expect(s.tick).toBe(0);
    expect(s.won).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const lv = level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 1, layers: [{ color: 1, amount: 0.5 }, { color: 2, amount: 0.5 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    });
    const a = createGame(lv, 5);
    const b = createGame(lv, 5);
    for (let i = 0; i < 50; i++) {
      stepGame(a);
      stepGame(b);
    }
    expect(Array.from(a.sandBoxes[0].region.cells)).toEqual(Array.from(b.sandBoxes[0].region.cells));
  });
});

describe('stepGame', () => {
  it('tiny level drains completely, removes the box and wins without losing grains', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 1, layers: [{ color: 1, amount: 1 }] }],
      boxes: [{ shape: '1x1', x: 1, y: 0, color: 1 }],
    }));
    const events: GameEvent[] = [];
    let steps = 0;
    while (!s.won && steps < 1000) {
      expect(totalGrains(s)).toBe(GRAINS_PER_UNIT);
      stepGame(s);
      events.push(...s.events);
      s.events.length = 0;
      steps++;
    }
    expect(s.won).toBe(true);
    expect(s.tick).toBe(steps);
    expect(s.boxes[0].state).toBe('removed');
    expect(s.sandBoxes[0].region.count).toBeLessThanOrEqual(COMPLETION_SLACK); // debris
    expect(s.boxes[0].region.count).toBeGreaterThanOrEqual(GRAINS_PER_UNIT - COMPLETION_SLACK);
    expect(totalGrains(s, true)).toBe(GRAINS_PER_UNIT);
    expect(s.completedCount).toBe(1);
    expect(events.some((e) => e.type === 'transfer')).toBe(true);
    const done = events.find((e) => e.type === 'boxCompleted');
    expect(done).toMatchObject({ type: 'boxCompleted', boxId: 0, x: 1, y: 0, color: 1 });
    expect(events[events.length - 1]).toEqual({ type: 'won' });
  });

  it('completes within COMPLETION_SLACK grains of full (58), not before; full always completes', () => {
    expect(COMPLETION_SLACK).toBe(58);
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }, { shape: '2x2', x: 2, y: 2, color: 1 }] }));
    const [a, b] = s.boxes;
    a.region.count = a.region.capacity - COMPLETION_SLACK - 1;
    b.region.count = b.region.capacity - COMPLETION_SLACK - 1;
    expect(boxComplete(a)).toBe(false);
    checkCompletions(s);
    expect(s.completedCount).toBe(0);
    a.region.count++;
    b.region.count = b.region.capacity;
    expect(boxComplete(a)).toBe(true);
    checkCompletions(s);
    expect(s.boxes.map((x) => x.state)).toEqual(['removed', 'removed']);
    expect(s.won).toBe(true);
  });

  it('frozen counters decrement on completion and emit boxUnfrozen', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 1, layers: [] }],
      boxes: [
        { shape: '1x1', x: 1, y: 0, color: 1 },
        { shape: '1x1', x: 3, y: 0, color: 2, frozen: 1 },
        { shape: '1x1', x: 4, y: 0, color: 2, frozen: 2 },
      ],
    }));
    const r = s.boxes[0].region;
    r.cells.fill(1);
    r.count = r.capacity;
    checkCompletions(s);
    expect(s.boxes[0].state).toBe('removed');
    expect(s.boxes[1].frozen).toBe(0);
    expect(s.boxes[2].frozen).toBe(1);
    expect(s.events).toContainEqual({ type: 'boxUnfrozen', boxId: 1 });
    expect(s.events.filter((e) => e.type === 'boxUnfrozen').length).toBe(1);
    expect(s.won).toBe(false);
  });

  it('thawed boxes accept sand; full level with a frozen box is winnable', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 2, layers: [{ color: 1, amount: 1 }, { color: 2, amount: 1 }] }],
      boxes: [
        // Red on the floor drains through the bottom; orange falls into the bottom cell, beside
        // the frozen orange box, and flows into it sideways once the box thaws.
        { shape: '1x1', x: 0, y: 2, color: 1 },
        { shape: '1x1', x: 1, y: 1, color: 2, frozen: 1 },
      ],
    }));
    let steps = 0;
    while (!s.won && steps < 4000) {
      stepGame(s);
      steps++;
      if (s.boxes[0].state === 'active') expect(s.boxes[1].region.count).toBe(0);
    }
    expect(s.won).toBe(true);
    expect(totalGrains(s, true) + dissolvedGrains(s).reduce((a, b) => a + b, 0)).toBe(2 * GRAINS_PER_UNIT);
  });
});

describe('debris dissolution', () => {
  const run = (frozenRed: boolean) => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 1, h: 2, layers: [{ color: 2, amount: 1 }, { color: 1, amount: 1 }] }],
      boxes: [
        { shape: '1x1', x: 1, y: 0, color: 1 }, // beside the red top layer
        { shape: '1x1', x: 4, y: 4, color: 2 }, // orange, parked away
        ...(frozenRed ? [{ shape: '1x1' as const, x: 4, y: 0, color: 1, frozen: 3 }] : []),
      ],
    }), 4);
    return s;
  };

  it('leftover grains of a finished color crumble away over DISSOLVE_STEPS, then one event', () => {
    const s = run(false);
    const sb = s.sandBoxes[0].region;
    const events: GameEvent[] = [];
    while (s.boxes[0].state === 'active' && s.tick < 2000) {
      stepGame(s);
      events.push(...s.events);
      s.events.length = 0;
    }
    const left = countColor(sb, 1);
    expect(left).toBeGreaterThan(0); // debris (within the completion slack)
    expect(left).toBeLessThanOrEqual(COMPLETION_SLACK);
    const counts: number[] = [];
    for (let t = 0; t < DISSOLVE_STEPS + 5; t++) {
      stepGame(s);
      counts.push(countColor(sb, 1));
      events.push(...s.events);
      s.events.length = 0;
    }
    // gradual: about half is left half-way, none at the end
    expect(counts[Math.floor(DISSOLVE_STEPS / 2)]).toBeGreaterThan(0);
    expect(counts[Math.floor(DISSOLVE_STEPS / 2)]).toBeLessThan(left);
    expect(counts[DISSOLVE_STEPS - 1]).toBe(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(events.filter((e) => e.type === 'debrisDissolved')).toEqual([{ type: 'debrisDissolved', color: 1 }]);
    expect(dissolvedGrains(s)[1]).toBe(left);
    expect(countColor(sb, 2)).toBe(576); // other colors untouched
    expect(s.sandBoxes[0].region.count).toBe(576);
  });

  it('a frozen box of the color still counts as remaining capacity: nothing dissolves', () => {
    const s = run(true);
    while (s.boxes[0].state === 'active' && s.tick < 2000) stepGame(s);
    expect(s.boxes[0].state).toBe('removed');
    const left = countColor(s.sandBoxes[0].region, 1);
    for (let t = 0; t < 100; t++) stepGame(s);
    expect(countColor(s.sandBoxes[0].region, 1)).toBe(left);
    expect(dissolvedGrains(s)[1]).toBe(0);
  });
});
