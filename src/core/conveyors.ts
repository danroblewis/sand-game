// Conveyor belts (DESIGN.md "Conveyors"): walkable strips that carry the boxes on them toward the
// strip's end, one cell every CONVEYOR_INTERVAL steps, queueing behind whatever blocks them.

import type { Box, ConveyorDef, ConveyorState, Dir, GameState } from './types';
import { CONVEYOR_INTERVAL } from './constants';
import { canPlace, shakeBox } from './grid';

export const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Runtime state for a conveyor: its strip cells from start to end. */
export function buildConveyor(def: ConveyorDef, id: number): ConveyorState {
  const [dx, dy] = DIR_VEC[def.dir];
  const cells = [];
  for (let k = 0; k < def.length; k++) cells.push({ x: def.x + k * dx, y: def.y + k * dy });
  return { id, x: def.x, y: def.y, dir: def.dir, length: def.length, cells, phase: 0 };
}

/** Conveyor whose strip covers grid cell (gx, gy), if any. */
export function conveyorAtCell(state: GameState, gx: number, gy: number): ConveyorState | undefined {
  for (const c of state.conveyors) for (const v of c.cells) if (v.x === gx && v.y === gy) return c;
  return undefined;
}

/** Index along the strip of the box's cell closest to the end, or -1 if no cell is on the strip. */
function frontIndex(conv: ConveyorState, box: Box): number {
  let best = -1;
  for (let k = 0; k < conv.cells.length; k++) {
    const v = conv.cells[k];
    for (const c of box.cells) if (box.x + c.x === v.x && box.y + c.y === v.y && k > best) best = k;
  }
  return best;
}

/**
 * The next belt step, worked out on the current board: for each conveyor (id order), the active
 * unfrozen boxes with any cell on its strip (except the held box) are processed front-to-back
 * (closest to the end first) and each moves one cell in `dir` if canPlace allows; boxes that moved
 * have vacated their cells, boxes that could not move (and the held box) block those behind. A box
 * rides at most once per step even if it touches two belts. With `apply` false the moves are undone
 * afterwards (a dry run for rendering). Returns, per conveyor, the boxes that move, in order.
 */
function planBelts(state: GameState, apply: boolean): Box[][] {
  const moved = new Set<Box>();
  const out: Box[][] = [];
  for (const conv of state.conveyors) {
    const [dx, dy] = DIR_VEC[conv.dir];
    const riders: { box: Box; k: number }[] = [];
    for (const b of state.boxes) {
      if (b.state !== 'active' || b.frozen > 0 || b.id === state.heldBoxId || moved.has(b)) continue;
      const k = frontIndex(conv, b);
      if (k >= 0) riders.push({ box: b, k });
    }
    riders.sort((a, b) => b.k - a.k || a.box.id - b.box.id);
    const list: Box[] = [];
    for (const { box } of riders) {
      if (!canPlace(state, box, box.x + dx, box.y + dy)) continue;
      box.x += dx;
      box.y += dy;
      moved.add(box);
      list.push(box);
    }
    out.push(list);
  }
  if (!apply)
    state.conveyors.forEach((conv, i) => {
      const [dx, dy] = DIR_VEC[conv.dir];
      for (const b of out[i]) {
        b.x -= dx;
        b.y -= dy;
      }
    });
  return out;
}

/**
 * For rendering: the direction `box` will move on the next belt step if nothing changes before
 * then (it rides a belt, is active, unfrozen and not held, and the cell ahead is free or is being
 * vacated by the box ahead of it in the queue), else null. Pair with `conveyor.phase` to draw the
 * box gliding.
 */
export function riderNextFree(state: GameState, box: Box): Dir | null {
  const plan = planBelts(state, false);
  for (let i = 0; i < plan.length; i++) if (plan[i].includes(box)) return state.conveyors[i].dir;
  return null;
}

/** All boxes that would move on the next belt step (box id → direction), one dry run. */
export function conveyorPlan(state: GameState): Map<number, Dir> {
  const m = new Map<number, Dir>();
  planBelts(state, false).forEach((list, i) => {
    for (const b of list) m.set(b.id, state.conveyors[i].dir);
  });
  return m;
}

/**
 * Runs every step: advances each conveyor's `phase` (0..1 toward the next belt step) and, every
 * CONVEYOR_INTERVAL steps, performs the belt step (see planBelts). Moved boxes are shaken and get
 * `pushDir`; every other box's `pushDir` is cleared. One `conveyed` event per conveyor that moved
 * something. Belt moves are not player moves.
 */
export function applyConveyors(state: GameState): void {
  if (state.conveyors.length === 0) return;
  const t = state.tick % CONVEYOR_INTERVAL;
  for (const conv of state.conveyors) conv.phase = t / CONVEYOR_INTERVAL;
  if (t !== 0) return;
  for (const b of state.boxes) b.pushDir = null;
  const plan = planBelts(state, true);
  state.conveyors.forEach((conv, i) => {
    const list = plan[i];
    if (list.length === 0) return;
    const [dx, dy] = DIR_VEC[conv.dir];
    for (const b of list) {
      b.pushDir = conv.dir;
      shakeBox(state, b.id, dx, dy);
    }
    state.events.push({ type: 'conveyed', conveyorId: conv.id, boxIds: list.map((b) => b.id), dir: conv.dir });
  });
}
