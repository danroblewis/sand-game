// Grid-level placement and movement of boxes.

import type { Box, GameState, Vec } from './types';
import { P_SHAKE, SHAKE_HOPS } from './constants';
import { shakeRegion } from './sand';

/** True if (gx, gy) is one of the box's cells when its top-left is at (bx, by). */
export function boxCoversCell(box: Box, bx: number, by: number, gx: number, gy: number): boolean {
  const lx = gx - bx;
  const ly = gy - by;
  if (lx < 0 || ly < 0 || lx >= box.bw || ly >= box.bh) return false;
  for (const c of box.cells) if (c.x === lx && c.y === ly) return true;
  return false;
}

/** Occupancy code for wall cells in `buildOccupancy`. */
export const OCC_WALL = -1_000_000;

/** Wall tile at grid cell (gx, gy), if any. */
export function wallAtCell(state: GameState, gx: number, gy: number): Vec | undefined {
  for (const w of state.walls) if (w.x === gx && w.y === gy) return w;
  return undefined;
}

/** Sand box covering grid cell (gx, gy), if any. */
export function sandBoxAtCell(state: GameState, gx: number, gy: number) {
  for (const sb of state.sandBoxes) {
    if (gx >= sb.x && gy >= sb.y && gx < sb.x + sb.w && gy < sb.y + sb.h) return sb;
  }
  return undefined;
}

/** Active box (frozen or not) covering grid cell (gx, gy), if any. */
export function boxAtCell(state: GameState, gx: number, gy: number): Box | undefined {
  for (const b of state.boxes) {
    if (b.state === 'active' && boxCoversCell(b, b.x, b.y, gx, gy)) return b;
  }
  return undefined;
}

/**
 * Occupancy grid (row-major, width*height): 0 = empty, -(sandBoxId+1) for sand boxes, OCC_WALL for
 * walls, boxId+1 for active boxes. `excludeBoxId` leaves that box out.
 */
export function buildOccupancy(state: GameState, excludeBoxId = -1): Int32Array {
  const { width, height } = state;
  const occ = new Int32Array(width * height);
  for (const sb of state.sandBoxes) {
    for (let y = sb.y; y < sb.y + sb.h; y++)
      for (let x = sb.x; x < sb.x + sb.w; x++)
        if (x >= 0 && y >= 0 && x < width && y < height) occ[y * width + x] = -(sb.id + 1);
  }
  for (const w of state.walls) if (w.x >= 0 && w.y >= 0 && w.x < width && w.y < height) occ[w.y * width + w.x] = OCC_WALL;
  for (const b of state.boxes) {
    if (b.state !== 'active' || b.id === excludeBoxId) continue;
    for (const c of b.cells) {
      const x = b.x + c.x;
      const y = b.y + c.y;
      if (x >= 0 && y >= 0 && x < width && y < height) occ[y * width + x] = b.id + 1;
    }
  }
  return occ;
}

/** All cells in bounds, overlapping no sand box, no wall and no other active box (conveyor belts
 *  are walkable, not obstacles). */
export function canPlace(state: GameState, box: Box, x: number, y: number): boolean {
  for (const c of box.cells) {
    const gx = x + c.x;
    const gy = y + c.y;
    if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) return false;
    if (sandBoxAtCell(state, gx, gy) || wallAtCell(state, gx, gy)) return false;
    for (const o of state.boxes) {
      if (o === box || o.state !== 'active') continue;
      if (boxCoversCell(o, o.x, o.y, gx, gy)) return false;
    }
  }
  return true;
}

function findBox(state: GameState, id: number): Box | undefined {
  for (const b of state.boxes) if (b.id === id) return b;
  return undefined;
}

function canMove(box: Box | undefined): box is Box {
  return !!box && box.state === 'active' && box.frozen === 0;
}

function step(state: GameState, box: Box, dx: number, dy: number): boolean {
  if (!canPlace(state, box, box.x + dx, box.y + dy)) return false;
  box.x += dx;
  box.y += dy;
  state.events.push({ type: 'boxMoved', boxId: box.id, x: box.x, y: box.y });
  shakeBox(state, box.id, dx, dy);
  return true;
}

/**
 * Shake a box's sand after it moved by (dx, dy) grid cells: surface grains hop against the motion
 * (up for a downward move, sideways the other way for a sideways move) into empty in-mask cells,
 * then gravity brings them back. Count is preserved exactly. Returns the number of hops.
 */
export function shakeBox(state: GameState, boxId: number, dx: number, dy: number): number {
  const box = findBox(state, boxId);
  if (!box || box.state !== 'active' || box.region.count === 0) return 0;
  return shakeRegion(box.region, state.rng, -Math.sign(dx), -Math.sign(dy), P_SHAKE, SHAKE_HOPS);
}

/** Move one grid step (dx, dy) if possible. Increments `moves` on success. */
export function tryMoveBox(state: GameState, boxId: number, dx: number, dy: number): boolean {
  const box = findBox(state, boxId);
  if (!canMove(box) || (dx === 0 && dy === 0)) return false;
  if (!step(state, box, dx, dy)) return false;
  state.moves++;
  return true;
}

/**
 * Slide toward grid position (tx, ty) one step at a time (at most |dx|+|dy| steps), trying the
 * axis with the larger remaining distance first, then the other. Does NOT increment `moves`.
 * Returns the number of steps taken.
 */
export function moveBoxToward(state: GameState, boxId: number, tx: number, ty: number): number {
  const box = findBox(state, boxId);
  if (!canMove(box)) return 0;
  const budget = Math.abs(tx - box.x) + Math.abs(ty - box.y);
  let steps = 0;
  while (steps < budget) {
    const rx = tx - box.x;
    const ry = ty - box.y;
    if (rx === 0 && ry === 0) break;
    const sx = Math.sign(rx);
    const sy = Math.sign(ry);
    const xFirst = Math.abs(rx) >= Math.abs(ry);
    let moved = false;
    if (xFirst) {
      moved = (sx !== 0 && step(state, box, sx, 0)) || (sy !== 0 && step(state, box, 0, sy));
    } else {
      moved = (sy !== 0 && step(state, box, 0, sy)) || (sx !== 0 && step(state, box, sx, 0));
    }
    if (!moved) break;
    steps++;
  }
  return steps;
}

/** Active, unfrozen boxes in tab order (y, then x). */
export function movableBoxes(state: GameState): Box[] {
  return state.boxes
    .filter((b) => b.state === 'active' && b.frozen === 0)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
}
