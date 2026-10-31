// Hero (Sokoban) mode (DESIGN.md "Hero mode"): a one-cell character that walks, pushes one box at
// a time, and in gravity levels falls and climbs one cell.

import type { Box, Dir, GameState } from './types';
import { boxCoversCell, canPlace, sandBoxAtCell, shakeBox, wallAtCell } from './grid';
import { KICK_INTERVAL } from './constants';

const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

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

/** Can the hero push this box one cell by (dx, dy)? (active, unfrozen, fits; hero cell ignored) */
export function heroCanPush(state: GameState, box: Box, dx: number, dy: number): boolean {
  if (box.force !== null && box.frozen === 0 && VEC[box.force][0] === -dx && VEC[box.force][1] === -dy) return false; // resists
  return box.state === 'active' && box.frozen === 0 && box.sliding === null && canPush(state, box, box.x + dx, box.y + dy);
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
  const resists = box !== undefined && box.force !== null && box.frozen === 0 && box.force === OPP[dir];
  if (box && !resists && box.frozen === 0 && box.sliding === null && canPush(state, box, box.x + dx, box.y + dy)) {
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

// ---------------------------------------------------------------------------------------------
// Kick

// Cells slid so far by each sliding box, per game (box id → cells).
const slid = new WeakMap<GameState, Map<number, number>>();
function slidOf(state: GameState): Map<number, number> {
  let m = slid.get(state);
  if (!m) {
    m = new Map();
    slid.set(state, m);
  }
  return m;
}

/** Copy of the per-box slide counters (for snapshots). */
export function slideSave(state: GameState): [number, number][] {
  return [...slidOf(state)];
}

/** Restore a slideSave() copy. */
export function slideLoad(state: GameState, saved: [number, number][]): void {
  slid.set(state, new Map(saved));
}

/**
 * Kick the box next to the hero in `dir`: if it is active, unfrozen, not already sliding and can
 * move one cell in `dir`, it starts sliding (`box.sliding = dir`, one cell per KICK_INTERVAL steps
 * until blocked); the hero stays put and faces `dir`. Counts as a move; emits `heroKicked`. In
 * gravity levels only sideways kicks, and only while the hero stands on something. A driven box
 * resists a kick against its force; a kick along its force is a normal push (moveHero).
 */
export function kickBox(state: GameState, dir: Dir): boolean {
  const h = state.hero;
  if (!h) return false;
  const grav = state.boxGravity;
  if (grav && (dir === 'up' || dir === 'down')) return false;
  if (dir === 'left' || dir === 'right') h.facing = dir;
  if (grav && !heroSupported(state)) return false;
  const [dx, dy] = VEC[dir];
  const box = boxAt(state, h.x + dx, h.y + dy);
  if (!box || box.frozen > 0 || box.sliding !== null) return false;
  // Driven boxes: a kick against the force is resisted; a kick along it is just a push.
  if (box.force !== null && box.force === OPP[dir]) return false;
  if (box.force === dir) return moveHero(state, dir);
  if (!canPush(state, box, box.x + dx, box.y + dy)) return false;
  box.sliding = dir;
  slidOf(state).set(box.id, 0);
  state.moves++;
  state.events.push({ type: 'heroKicked', boxId: box.id, dir });
  return true;
}

/** One slide step worked out on the current board: sliding boxes move one cell if canPlace allows,
 *  in repeated passes (id order) so a box can follow one sliding ahead of it. With `apply` false the
 *  moves are undone. Returns the boxes that move. */
function planSlide(state: GameState, apply: boolean): Box[] {
  const movers = state.boxes.filter((b) => b.state === 'active' && b.sliding !== null);
  const moved: Box[] = [];
  const done = new Set<Box>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const b of movers) {
      if (done.has(b)) continue;
      const [dx, dy] = VEC[b.sliding!];
      if (!canPlace(state, b, b.x + dx, b.y + dy)) continue;
      b.x += dx;
      b.y += dy;
      done.add(b);
      moved.push(b);
      progress = true;
    }
  }
  if (!apply)
    for (const b of moved) {
      const [dx, dy] = VEC[b.sliding!];
      b.x -= dx;
      b.y -= dy;
    }
  return moved;
}

/** Boxes that will slide on the next slide step (box id → direction), dry run, for rendering. */
export function slidePlan(state: GameState): Map<number, Dir> {
  const m = new Map<number, Dir>();
  for (const b of planSlide(state, false)) m.set(b.id, b.sliding!);
  return m;
}

/**
 * Every KICK_INTERVAL steps: sliding boxes move one cell (`boxMoved`, a shake) while canPlace
 * allows. A box that cannot move stops: `boxSlid {boxId, dir, cells}`, `sliding = null`. Under box
 * gravity a box that is unsupported after its slide step stops sliding right away (also `boxSlid`)
 * and then falls normally in the gravity pass of the same step.
 */
export function applySliding(state: GameState): void {
  if (state.tick % KICK_INTERVAL !== 0) return;
  if (!state.boxes.some((b) => b.sliding !== null)) return;
  const counts = slidOf(state);
  const moved = new Set(planSlide(state, true));
  const stop = (b: Box) => {
    state.events.push({ type: 'boxSlid', boxId: b.id, dir: b.sliding!, cells: counts.get(b.id) ?? 0 });
    counts.delete(b.id);
    b.sliding = null;
  };
  for (const b of state.boxes) {
    if (b.sliding === null) continue;
    if (b.state !== 'active') {
      b.sliding = null;
      counts.delete(b.id);
      continue;
    }
    if (!moved.has(b)) {
      stop(b);
      continue;
    }
    const [dx, dy] = VEC[b.sliding];
    counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
    state.events.push({ type: 'boxMoved', boxId: b.id, x: b.x, y: b.y });
    shakeBox(state, b.id, dx, dy);
    if (state.boxGravity && canPlace(state, b, b.x, b.y + 1)) stop(b);
  }
}
