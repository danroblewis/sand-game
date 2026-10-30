// Hero (Sokoban) mode (DESIGN.md "Hero mode"): a one-cell character that walks, pushes one box at
// a time, and in gravity levels falls and climbs one cell.

import type { Box, Dir, GameState } from './types';
import { boxCoversCell, canPlace, sandBoxAtCell, shakeBox, wallAtCell } from './grid';

const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Active box (frozen or not) covering (gx, gy). */
function boxAt(state: GameState, gx: number, gy: number): Box | undefined {
  for (const b of state.boxes) if (b.state === 'active' && boxCoversCell(b, b.x, b.y, gx, gy)) return b;
  return undefined;
}

/** In bounds and holding no wall, sand box or active box (the hero's own cell counts as free). */
export function heroCellFree(state: GameState, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) return false;
  return !wallAtCell(state, gx, gy) && !sandBoxAtCell(state, gx, gy) && !boxAt(state, gx, gy);
}

/** Gravity levels: true when the hero stands on something (floor, wall, sand box, box). */
export function heroSupported(state: GameState): boolean {
  const h = state.hero;
  if (!h || !state.boxGravity) return true;
  return !heroCellFree(state, h.x, h.y + 1);
}

/** canPlace for a pushed box, ignoring the hero's own cell (the hero steps into the vacated cell). */
function canPush(state: GameState, box: Box, x: number, y: number): boolean {
  const h = state.hero;
  state.hero = null;
  try {
    return canPlace(state, box, x, y);
  } finally {
    state.hero = h;
  }
}

/**
 * One hero input. Walks into a free cell; or pushes the active unfrozen box in the target cell one
 * cell in `dir` (whole shape, only that box) and steps into the vacated cell; or, in gravity levels,
 * climbs one cell onto an obstacle when moving sideways (cell above the obstacle and cell above the
 * hero free). In gravity levels up/down are no-ops and the hero cannot move while unsupported (in
 * mid-fall). `facing` follows sideways inputs even when blocked. Each successful move increments
 * `moves` and emits `heroMoved` (plus `heroPushed` and `boxMoved` for a push). Returns success.
 */
export function moveHero(state: GameState, dir: Dir): boolean {
  const h = state.hero;
  if (!h) return false;
  const grav = state.boxGravity;
  if (grav && (dir === 'up' || dir === 'down')) return false;
  if (dir === 'left' || dir === 'right') h.facing = dir;
  if (grav && !heroSupported(state)) return false;
  const [dx, dy] = VEC[dir];
  const tx = h.x + dx;
  const ty = h.y + dy;
  if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return false;
  const walk = (x: number, y: number, climbed: boolean) => {
    h.x = x;
    h.y = y;
    state.moves++;
    state.events.push({ type: 'heroMoved', x, y, dir, climbed });
    return true;
  };
  if (heroCellFree(state, tx, ty)) return walk(tx, ty, false);
  const box = boxAt(state, tx, ty);
  if (box && box.frozen === 0 && canPush(state, box, box.x + dx, box.y + dy)) {
    box.x += dx;
    box.y += dy;
    state.events.push({ type: 'heroPushed', boxId: box.id, dir });
    state.events.push({ type: 'boxMoved', boxId: box.id, x: box.x, y: box.y });
    shakeBox(state, box.id, dx, dy);
    return walk(tx, ty, false);
  }
  // Climb one cell onto the obstacle (gravity levels, sideways only).
  if (grav && heroCellFree(state, tx, ty - 1) && heroCellFree(state, h.x, h.y - 1)) return walk(tx, ty - 1, true);
  return false;
}

/** Gravity pass for the hero (after the boxes): falls one cell if unsupported; lands on the same
 *  fall step as its last move (`heroLanded {fell}`). */
export function heroGravity(state: GameState): void {
  const h = state.hero;
  if (!h || !state.boxGravity) return;
  if (heroCellFree(state, h.x, h.y + 1)) {
    h.y++;
    h.falling++;
  }
  if (h.falling > 0 && !heroCellFree(state, h.x, h.y + 1)) {
    state.events.push({ type: 'heroLanded', fell: h.falling });
    h.falling = 0;
  }
}
