// Game state construction, the fixed-step simulation and completion logic.

import { COLOR_MASK, GRAINS_PER_CELL } from './types';
import type { Box, GameState, LevelDef, SandBoxState } from './types';
import { SHAPES, shapeBounds } from './shapes';
import { beginStep, createRegion, endStep, fillLayers, sweepSpace } from './sand';
import { applyPull, gameSpace } from './transfer';
import { applyConveyors, buildConveyor } from './conveyors';
import { COMPLETION_SLACK, DISSOLVE_STEPS } from './constants';
import { nextFloat } from './rng';
import { touchRegion } from './sand';

const N = GRAINS_PER_CELL;

export function createGame(level: LevelDef, seed = 1): GameState {
  const rng = { seed: seed | 0 };
  const sandBoxes: SandBoxState[] = level.sandBoxes.map((def, id) => {
    const region = createRegion(def.w * N, def.h * N);
    fillLayers(region, def.layers, rng);
    return { id, x: def.x, y: def.y, w: def.w, h: def.h, region };
  });
  const boxes: Box[] = level.boxes.map((def, id) => {
    const cells = SHAPES[def.shape].map((c) => ({ x: c.x, y: c.y }));
    const { w: bw, h: bh } = shapeBounds(def.shape);
    const fw = bw * N;
    const mask = new Uint8Array(fw * bh * N);
    for (const c of cells)
      for (let y = 0; y < N; y++) mask.fill(1, (c.y * N + y) * fw + c.x * N, (c.y * N + y) * fw + c.x * N + N);
    return {
      id,
      shape: def.shape,
      cells,
      bw,
      bh,
      x: def.x,
      y: def.y,
      color: def.color,
      frozen: Math.max(0, def.frozen ?? 0),
      region: createRegion(fw, bh * N, mask),
      state: 'active',
      pushDir: null,
    };
  });
  return {
    level,
    width: level.width,
    height: level.height,
    sandBoxes,
    boxes,
    conveyors: (level.conveyors ?? []).map(buildConveyor),
    heldBoxId: null,
    walls: (level.walls ?? []).map((w) => ({ x: w.x, y: w.y })),
    completedCount: 0,
    moves: 0,
    tick: 0,
    won: false,
    events: [],
    rng,
  };
}

/**
 * One 60 Hz step of the shared simulation: the short-reach pull (which stamps the grains it holds),
 * then the gravity / slide / slump sweep over every region at once (moves may cross docked edges
 * into accepting boxes), then completions.
 */
export function stepGame(state: GameState): void {
  dissolveDebris(state);
  const sp = gameSpace(state);
  beginStep(sp);
  applyPull(state, sp, state.rng);
  sweepSpace(sp, state.rng, state.tick);
  endStep(sp);
  if (sp.crossings > 0) state.events.push({ type: 'transfer', count: sp.crossings });
  applyConveyors(state); // box moves change the dockings: the space rebuilds next step
  checkCompletions(state);
  state.tick++;
}

// ---------------------------------------------------------------------------------------------
// Debris dissolution

interface Debris {
  /** Colors currently dissolving: [color, stepsLeft, color, stepsLeft, ...]. */
  active: number[];
  /** Colors already finished (dissolved or dissolving). */
  finished: Set<number>;
  /** Grains removed per color so far. */
  removed: number[];
}
const debris = new WeakMap<GameState, Debris>();
function debrisOf(state: GameState): Debris {
  let d = debris.get(state);
  if (!d) {
    d = { active: [], finished: new Set(), removed: new Array(32).fill(0) };
    debris.set(state, d);
  }
  return d;
}

/** Grains removed by debris dissolution so far, per color (index = ColorId). */
export function dissolvedGrains(state: GameState): number[] {
  return debrisOf(state).removed.slice();
}

/** Colors with no box left on the board (none active, none frozen) are finished: start dissolving
 *  their leftover grains in the sand boxes. Called after completions. */
function markFinished(state: GameState): void {
  const d = debrisOf(state);
  const remaining = new Set<number>();
  for (const b of state.boxes) if (b.state === 'active') remaining.add(b.color);
  const present = new Set<number>();
  for (const sb of state.sandBoxes) {
    const c = sb.region.cells;
    for (let i = 0; i < c.length; i++) if (c[i] !== 0) present.add(c[i] & COLOR_MASK);
  }
  for (const color of present) {
    if (remaining.has(color) || d.finished.has(color)) continue;
    d.finished.add(color);
    d.active.push(color, DISSOLVE_STEPS);
  }
}

/** One step of dissolution: each grain of a dissolving color goes with probability 1/stepsLeft
 *  (all of them on the last step), so the debris crumbles away evenly over DISSOLVE_STEPS. */
function dissolveDebris(state: GameState): void {
  const d = debris.get(state);
  if (!d || d.active.length === 0) return;
  for (let k = 0; k < d.active.length; k += 2) {
    const color = d.active[k];
    const left = d.active[k + 1];
    const p = 1 / left;
    for (const sb of state.sandBoxes) {
      const r = sb.region;
      const c = r.cells;
      let n = 0;
      for (let i = 0; i < c.length; i++) {
        if (c[i] === 0 || (c[i] & COLOR_MASK) !== color) continue;
        if (left > 1 && nextFloat(state.rng) >= p) continue;
        c[i] = 0;
        n++;
      }
      if (n) {
        r.count -= n;
        d.removed[color] += n;
        touchRegion(r);
      }
    }
    d.active[k + 1] = left - 1;
  }
  for (let k = d.active.length - 2; k >= 0; k -= 2) {
    if (d.active[k + 1] > 0) continue;
    state.events.push({ type: 'debrisDissolved', color: d.active[k] });
    d.active.splice(k, 2);
  }
}

/** Within COMPLETION_SLACK grains of full (a literally full box always qualifies). */
export function boxComplete(box: Box): boolean {
  const r = box.region;
  return r.count >= r.capacity || r.count >= r.capacity - COMPLETION_SLACK;
}

/** Remove complete boxes (full within COMPLETION_SLACK), tick frozen counters, and detect the win
 *  (all boxes removed; leftover debris in the sand boxes does not matter). Connected same-color
 *  boxes (rule 6b) complete together: a group pops only when every member is complete. */
export function checkCompletions(state: GameState): void {
  let completed = false;
  for (const group of connectedGroups(state)) {
    if (!group.every(boxComplete)) continue;
    for (const box of group) {
      box.state = 'removed';
      state.completedCount++;
      state.events.push({
        type: 'boxCompleted',
        boxId: box.id,
        x: box.x,
        y: box.y,
        cells: box.cells.map((c) => ({ x: c.x, y: c.y })),
        color: box.color,
      });
      for (const other of state.boxes) {
        if (other.state !== 'active' || other.frozen <= 0) continue;
        other.frozen--;
        if (other.frozen === 0) state.events.push({ type: 'boxUnfrozen', boxId: other.id });
      }
    }
    completed = true;
  }
  if (completed) markFinished(state);
  if (!state.won && state.boxes.every((b) => b.state === 'removed')) {
    state.won = true;
    state.events.push({ type: 'won' });
  }
}

/** Do two boxes have cells sharing a grid edge? */
function touching(a: Box, b: Box): boolean {
  for (const ca of a.cells) {
    const ax = a.x + ca.x;
    const ay = a.y + ca.y;
    for (const cb of b.cells) {
      const d = Math.abs(ax - b.x - cb.x) + Math.abs(ay - b.y - cb.y);
      if (d === 1) return true;
    }
  }
  return false;
}

/**
 * Connected groups (rule 6b): active, unfrozen boxes of the same color whose cells share a grid
 * edge, transitively. A lone box is a group of one. Groups are ordered by their lowest box id, and
 * boxes inside a group by id.
 */
export function connectedGroups(state: GameState): Box[][] {
  const live = state.boxes.filter((b) => b.state === 'active' && b.frozen === 0);
  const seen = new Set<Box>();
  const groups: Box[][] = [];
  for (const start of live) {
    if (seen.has(start)) continue;
    seen.add(start);
    const g = [start];
    for (let k = 0; k < g.length; k++)
      for (const o of live)
        if (!seen.has(o) && o.color === g[k].color && touching(g[k], o)) {
          seen.add(o);
          g.push(o);
        }
    g.sort((a, b) => a.id - b.id);
    groups.push(g);
  }
  return groups;
}

/** The connected group containing box `boxId` (empty if the box is not active and unfrozen). */
export function boxGroup(state: GameState, boxId: number): Box[] {
  for (const g of connectedGroups(state)) if (g.some((b) => b.id === boxId)) return g;
  return [];
}
