// Driven boxes (DESIGN.md "Driven boxes"): a box with a built-in force pushes the train of boxes in
// front of it one cell every BOX_FALL_INTERVAL steps whenever the whole train can move.

import type { Box, Dir, GameState } from './types';
import { BOX_FALL_INTERVAL } from './constants';
import { boxCoversCell, sandBoxAtCell, shakeBox, wallAtCell } from './grid';

const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** A driven box that acts this force tick: active, unfrozen, not held, not sliding, with a force. */
function drives(state: GameState, b: Box): boolean {
  return b.force !== null && b.state === 'active' && b.frozen === 0 && b.id !== state.heldBoxId && b.sliding === null;
}

/**
 * The push train of `driver` along its force: the closure of active boxes the set would overlap
 * when moved one cell. Blocked when any target cell is off the board, a wall, a sand box or the
 * hero, or holds a box that is frozen, sliding or held, or when the train contains a driven box
 * whose force points back against `dir` (two opposed driven boxes are stuck).
 */
export function forceTrain(state: GameState, driver: Box): { boxes: Box[]; blocked: boolean } {
  const dir = driver.force!;
  const [dx, dy] = VEC[dir];
  const set = new Set<Box>([driver]);
  const order: Box[] = [driver];
  const h = state.hero;
  for (let k = 0; k < order.length; k++) {
    const b = order[k];
    if (b !== driver && b.force === OPP[dir] && b.frozen === 0) return { boxes: order, blocked: true };
    for (const c of b.cells) {
      const tx = b.x + c.x + dx;
      const ty = b.y + c.y + dy;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return { boxes: order, blocked: true };
      if (wallAtCell(state, tx, ty) || sandBoxAtCell(state, tx, ty)) return { boxes: order, blocked: true };
      if (h && h.x === tx && h.y === ty) return { boxes: order, blocked: true };
      for (const o of state.boxes) {
        if (o.state !== 'active' || set.has(o) || !boxCoversCell(o, o.x, o.y, tx, ty)) continue;
        if (o.frozen > 0 || o.sliding !== null || o.id === state.heldBoxId) return { boxes: order, blocked: true };
        set.add(o);
        order.push(o);
      }
    }
  }
  return { boxes: order, blocked: false };
}

/** One force tick worked out on the current board (repeated passes in id order). With `apply`
 *  false all moves are undone. Returns the trains that moved (driver, members) and the drivers
 *  left pressing. */
function planForces(state: GameState, apply: boolean): { trains: { driver: Box; boxes: Box[] }[]; pressing: Set<Box> } {
  const drivers = state.boxes.filter((b) => drives(state, b)).sort((a, b) => a.id - b.id);
  const trains: { driver: Box; boxes: Box[] }[] = [];
  const moved = new Set<Box>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const d of drivers) {
      if (moved.has(d)) continue;
      const t = forceTrain(state, d);
      if (t.blocked) continue;
      const [dx, dy] = VEC[d.force!];
      for (const b of t.boxes) {
        b.x += dx;
        b.y += dy;
        moved.add(b);
      }
      trains.push({ driver: d, boxes: t.boxes });
      progress = true;
    }
  }
  if (!apply)
    for (let i = trains.length - 1; i >= 0; i--) {
      const [dx, dy] = VEC[trains[i].driver.force!];
      for (const b of trains[i].boxes) {
        b.x -= dx;
        b.y -= dy;
      }
    }
  return { trains, pressing: new Set(drivers.filter((d) => !moved.has(d))) };
}

/** Boxes that will move on the next force tick (box id → direction), dry run, for rendering. */
export function forcePlan(state: GameState): Map<number, Dir> {
  const m = new Map<number, Dir>();
  for (const t of planForces(state, false).trains) for (const b of t.boxes) m.set(b.id, t.driver.force!);
  return m;
}

/**
 * Every BOX_FALL_INTERVAL steps: each acting driven box pushes its train one cell if the whole
 * train can move (`forcePushed {boxId, boxIds, dir}`, a shake for each member); drivers that
 * could not move are `pressing` (recomputed every force tick; non-acting boxes are not pressing).
 * The shared space rebuilds by itself because box positions changed.
 */
export function applyForces(state: GameState): void {
  if (state.tick % BOX_FALL_INTERVAL !== 0) return;
  if (!state.boxes.some((b) => b.force !== null)) return;
  const { trains, pressing } = planForces(state, true);
  for (const b of state.boxes) b.pressing = pressing.has(b);
  for (const { driver, boxes } of trains) {
    const dir = driver.force!;
    const [dx, dy] = VEC[dir];
    state.events.push({ type: 'forcePushed', boxId: driver.id, boxIds: boxes.map((b) => b.id), dir });
    for (const b of boxes) shakeBox(state, b.id, dx, dy);
  }
}
