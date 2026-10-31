// Conveyor belts (DESIGN.md "Conveyors", "Big maps"): walkable strips that carry the boxes (and the
// hero) on them toward the strip's end, one cell per belt interval, queueing behind whatever blocks
// them; contiguous strips can form loops (a box rides the belt under its first cell).

import type { Box, ConveyorDef, ConveyorState, Dir, GameState, Vec } from './types';
import { CONVEYOR_INTERVAL } from './constants';
import { canPlace, shakeBox } from './grid';
import { heroCanPush, heroCellFree, heroSupported } from './hero';

export const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Runtime state for a conveyor: its strip cells from start to end, and its own step interval. */
export function buildConveyor(def: ConveyorDef, id: number): ConveyorState {
  const [dx, dy] = DIR_VEC[def.dir];
  const cells = [];
  for (let k = 0; k < def.length; k++) cells.push({ x: def.x + k * dx, y: def.y + k * dy });
  const interval = Math.max(1, Math.round(def.interval ?? CONVEYOR_INTERVAL));
  return { id, x: def.x, y: def.y, dir: def.dir, length: def.length, cells, phase: 0, interval };
}

/** Conveyor whose strip covers grid cell (gx, gy), if any (and that cell's index along it). */
function beltAt(state: GameState, gx: number, gy: number): { conv: ConveyorState; k: number } | null {
  for (const c of state.conveyors)
    for (let k = 0; k < c.cells.length; k++) if (c.cells[k].x === gx && c.cells[k].y === gy) return { conv: c, k };
  return null;
}

/** Conveyor whose strip covers grid cell (gx, gy), if any. */
export function conveyorAtCell(state: GameState, gx: number, gy: number): ConveyorState | undefined {
  return beltAt(state, gx, gy)?.conv;
}

/** A box's first cell: the topmost, then leftmost cell of its shape (box.x, box.y for rectangles).
 *  A box rides only the belt under this cell, so corner handoffs are unambiguous. */
export function firstCell(box: Box): Vec {
  let best = box.cells[0];
  for (const c of box.cells) if (c.y < best.y || (c.y === best.y && c.x < best.x)) best = c;
  return { x: box.x + best.x, y: box.y + best.y };
}

/** Does belt `conv` step on this tick? */
function steps(conv: ConveyorState, tick: number): boolean {
  return tick % conv.interval === 0;
}

interface Mover {
  box: Box | null; // null = the hero
  conv: ConveyorState;
  k: number;
}

/** The hero can ride: on a belt, not mid-fall (and supported in gravity levels). */
function heroRider(state: GameState): { conv: ConveyorState; k: number } | null {
  const h = state.hero;
  if (!h || h.falling > 0 || h.sliding !== null || !heroSupported(state)) return null;
  return beltAt(state, h.x, h.y);
}

/**
 * The belt step at `tick`, worked out on the current board. Riders are the active unfrozen boxes
 * (not held) whose first cell is on a belt stepping this tick, plus the hero standing on one. They
 * are resolved in repeated passes (order: belt id, then closest to the strip end first) until
 * nothing more can move, each mover at most once, so a queue follows its leader around a corner
 * onto the next belt. A box moves if canPlace allows; the hero moves if the cell ahead is free or
 * holds a box it can push. With `apply` false every move is undone (dry run). Returns the moved
 * boxes per conveyor index, and the hero's move (belt, pushed box) if any.
 */
function planBelts(
  state: GameState,
  tick: number,
  apply: boolean,
): { boxes: Box[][]; hero: { conv: ConveyorState; pushed: Box | null } | null } {
  const movers: Mover[] = [];
  for (const b of state.boxes) {
    if (b.state !== 'active' || b.frozen > 0 || b.id === state.heldBoxId || b.sliding !== null) continue;
    const f = firstCell(b);
    const at = beltAt(state, f.x, f.y);
    if (at && steps(at.conv, tick)) movers.push({ box: b, conv: at.conv, k: at.k });
  }
  const hr = heroRider(state);
  if (hr && steps(hr.conv, tick)) movers.push({ box: null, conv: hr.conv, k: hr.k });
  movers.sort((a, b) => a.conv.id - b.conv.id || b.k - a.k || (a.box?.id ?? -1) - (b.box?.id ?? -1));
  const out: Box[][] = state.conveyors.map(() => []);
  let hero: { conv: ConveyorState; pushed: Box | null } | null = null;
  const done = new Set<Mover>();
  const pushedSet = new Set<Box>();
  const undo: (() => void)[] = [];
  for (let progress = true; progress; ) {
    progress = false;
    for (const m of movers) {
      if (done.has(m) || (m.box && pushedSet.has(m.box))) continue;
      const [dx, dy] = DIR_VEC[m.conv.dir];
      if (m.box) {
        const b = m.box;
        if (!canPlace(state, b, b.x + dx, b.y + dy)) continue;
        b.x += dx;
        b.y += dy;
        undo.push(() => {
          b.x -= dx;
          b.y -= dy;
        });
        out[state.conveyors.indexOf(m.conv)].push(b);
      } else {
        const h = state.hero!;
        const tx = h.x + dx;
        const ty = h.y + dy;
        let pushed: Box | null = null;
        if (!heroCellFree(state, tx, ty)) {
          const b = state.boxes.find((o) => o.state === 'active' && o.frozen === 0 && o.cells.some((c) => o.x + c.x === tx && o.y + c.y === ty));
          if (!b || done.has(movers.find((x) => x.box === b)!) || !heroCanPush(state, b, dx, dy)) continue;
          b.x += dx;
          b.y += dy;
          pushed = b;
          pushedSet.add(b);
          undo.push(() => {
            b.x -= dx;
            b.y -= dy;
          });
        }
        const ox = h.x;
        const oy = h.y;
        h.x = tx;
        h.y = ty;
        undo.push(() => {
          h.x = ox;
          h.y = oy;
        });
        hero = { conv: m.conv, pushed };
      }
      done.add(m);
      progress = true;
    }
  }
  if (!apply) for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  return { boxes: out, hero };
}

/**
 * For rendering: the direction `box` will move on the next step of the belt under its first cell
 * if nothing changes before then, else null (not riding, frozen, held, or blocked). Pair with that
 * belt's `phase` to draw the box gliding.
 */
export function riderNextFree(state: GameState, box: Box): Dir | null {
  return conveyorPlan(state).get(box.id) ?? null;
}

/** All boxes that will move on their belt's next step (box id → direction), from dry runs at each
 *  belt's next step tick. */
export function conveyorPlan(state: GameState): Map<number, Dir> {
  const m = new Map<number, Dir>();
  const ticks = new Set<number>();
  for (const c of state.conveyors) ticks.add(state.tick + ((c.interval - (state.tick % c.interval)) % c.interval));
  for (const t of [...ticks].sort((a, b) => a - b)) {
    const { boxes } = planBelts(state, t, false);
    boxes.forEach((list, i) => {
      for (const b of list) if (!m.has(b.id)) m.set(b.id, state.conveyors[i].dir);
    });
  }
  return m;
}

/**
 * Runs every step: updates each belt's `phase` (0..1 toward its next step) and performs the belt
 * step for the belts whose interval divides the tick (see planBelts). Moved boxes are shaken and
 * get `pushDir`; riders of stepping belts that did not move, and boxes on no belt, get null. One
 * `conveyed` event per belt that moved boxes; a riding hero emits `heroMoved` (and `heroPushed` /
 * `boxMoved` when it shoves a box). Belt moves are not player moves.
 */
export function applyConveyors(state: GameState): void {
  if (state.conveyors.length === 0) return;
  let any = false;
  for (const conv of state.conveyors) {
    const t = state.tick % conv.interval;
    conv.phase = t / conv.interval;
    if (t === 0) any = true;
  }
  if (!any) return;
  const plan = planBelts(state, state.tick, true);
  const moved = new Set<Box>();
  state.conveyors.forEach((conv, i) => {
    const list = plan.boxes[i];
    if (list.length === 0) return;
    const [dx, dy] = DIR_VEC[conv.dir];
    for (const b of list) {
      b.pushDir = conv.dir;
      moved.add(b);
      shakeBox(state, b.id, dx, dy);
    }
    state.events.push({ type: 'conveyed', conveyorId: conv.id, boxIds: list.map((b) => b.id), dir: conv.dir });
  });
  for (const b of state.boxes) {
    if (moved.has(b)) continue;
    const f = firstCell(b);
    const at = beltAt(state, f.x, f.y);
    if (!at || steps(at.conv, state.tick)) b.pushDir = null;
  }
  if (plan.hero) {
    const h = state.hero!;
    const dir = plan.hero.conv.dir;
    if (dir === 'left' || dir === 'right') h.facing = dir;
    const p = plan.hero.pushed;
    if (p) {
      const [dx, dy] = DIR_VEC[dir];
      state.events.push({ type: 'heroPushed', boxId: p.id, dir });
      state.events.push({ type: 'boxMoved', boxId: p.id, x: p.x, y: p.y });
      shakeBox(state, p.id, dx, dy);
    }
    state.events.push({ type: 'heroMoved', x: h.x, y: h.y, dir, climbed: false });
  }
}
