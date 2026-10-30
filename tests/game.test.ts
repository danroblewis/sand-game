import { describe, expect, it } from 'vitest';
import { COMPLETION_SLACK, DISSOLVE_STEPS, GRAINS_PER_UNIT, boxComplete, boxGroup, checkCompletions, connectedGroups, dissolvedGrains, tryMoveBox, createGame, stepGame, countColor } from '../src/core';
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

describe('connected same-color boxes complete together (rule 6b)', () => {
  const fill = (b: { region: { cells: Uint8Array; count: number; capacity: number } }) => {
    b.region.cells.fill(1);
    b.region.count = b.region.capacity;
  };

  it('two touching red boxes under 2 cells of red: neither pops until both are full, then both in one step', () => {
    const s = createGame(level({
      sandBoxes: [{ x: 0, y: 0, w: 2, h: 1, layers: [{ color: 1, amount: 2 }] }],
      boxes: [
        { shape: '1x1', x: 0, y: 1, color: 1 },
        { shape: '1x1', x: 1, y: 1, color: 1 },
      ],
    }), 5);
    expect(boxGroup(s, 0).map((b) => b.id)).toEqual([0, 1]);
    let popTick = -1;
    for (let t = 0; t < 2000 && !s.won; t++) {
      stepGame(s);
      const done = s.events.filter((e) => e.type === 'boxCompleted');
      s.events.length = 0;
      if (done.length) {
        expect(popTick).toBe(-1);
        expect(done.map((e) => (e as { boxId: number }).boxId)).toEqual([0, 1]);
        popTick = t;
      }
    }
    expect(popTick).toBeGreaterThan(0);
    expect(s.completedCount).toBe(2);
    expect(s.won).toBe(true);
  });

  it('a full box held back by an unfilled partner pops once moved away', () => {
    const s = createGame(level({ boxes: [{ shape: '1x1', x: 0, y: 0, color: 1 }, { shape: '1x1', x: 1, y: 0, color: 1 }] }));
    fill(s.boxes[0]);
    checkCompletions(s);
    expect(s.boxes[0].state).toBe('active');
    expect(tryMoveBox(s, 0, 0, 1)).toBe(true); // (0,1): only touches (1,0) by a corner
    expect(boxGroup(s, 0).map((b) => b.id)).toEqual([0]);
    stepGame(s);
    expect(s.boxes[0].state).toBe('removed');
    expect(s.boxes[1].state).toBe('active');
  });

  it('frozen boxes and other colors never join a group', () => {
    const s = createGame(level({
      boxes: [
        { shape: '1x1', x: 0, y: 0, color: 1 },
        { shape: '1x1', x: 1, y: 0, color: 1, frozen: 5 },
        { shape: '1x1', x: 0, y: 1, color: 2 },
      ],
    }));
    expect(connectedGroups(s).map((g) => g.map((b) => b.id))).toEqual([[0], [2]]);
    fill(s.boxes[0]);
    checkCompletions(s);
    expect(s.boxes[0].state).toBe('removed');
    expect(s.boxes[1].frozen).toBe(4);
  });

  it('three-box chains wait for the middle, then pop together (completedCount and frozen counters per box)', () => {
    const s = createGame(level({
      boxes: [
        { shape: '1x1', x: 0, y: 0, color: 1 },
        { shape: '2x1', x: 1, y: 0, color: 1 },
        { shape: '1x2', x: 3, y: 0, color: 1 },
        { shape: '1x1', x: 5, y: 5, color: 3, frozen: 3 },
      ],
    }));
    expect(boxGroup(s, 2).map((b) => b.id)).toEqual([0, 1, 2]);
    fill(s.boxes[0]);
    fill(s.boxes[2]);
    checkCompletions(s);
    expect(s.completedCount).toBe(0);
    fill(s.boxes[1]);
    checkCompletions(s);
    expect(s.boxes.slice(0, 3).map((b) => b.state)).toEqual(['removed', 'removed', 'removed']);
    expect(s.completedCount).toBe(3);
    expect(s.boxes[3].frozen).toBe(0);
    expect(s.events.filter((e) => e.type === 'boxUnfrozen')).toEqual([{ type: 'boxUnfrozen', boxId: 3 }]);
  });
});

