// Springs: fixed one-cell tiles that push the stack of boxes in front of them (DESIGN.md "Springs").

import type { Box, Dir, GameState, SpringState } from './types';
import { SPRING_INTERVAL } from './constants';
import { boxCoversCell, sandBoxAtCell, shakeBox } from './grid';

export const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Spring covering grid cell (gx, gy), if any. */
export function springAtCell(state: GameState, gx: number, gy: number): SpringState | undefined {
  for (const s of state.springs) if (s.x === gx && s.y === gy) return s;
  return undefined;
}

/** Active box (frozen or not) covering (gx, gy), skipping those in `skip`. */
function activeBoxAt(state: GameState, gx: number, gy: number, skip: Set<Box> | null): Box | undefined {
  for (const b of state.boxes) {
    if (b.state !== 'active' || (skip && skip.has(b))) continue;
    if (boxCoversCell(b, b.x, b.y, gx, gy)) return b;
  }
  return undefined;
}

export interface Stack {
  boxes: Box[];
  blocked: boolean;
}

/**
 * The stack in front of a spring, by the pushing closure: start with the first active box in the
 * spring's lane (scanning from the front cell through empty cells; a sand box, spring or the edge
 * ends the lane: no stack); while the set moved one cell in `dir` would overlap another active unfrozen box, that box
 * joins. Blocked if any target cell is off the board, a sand box, a spring, or a frozen box (a
 * frozen first box blocks too). Empty lane: empty, unblocked stack.
 */
export function springStack(state: GameState, spring: SpringState): Stack {
  const [dx, dy] = DIR_VEC[spring.dir];
  // The arm extends along the lane through empty cells to the first box, so a stack that has been
  // pushed away keeps being pushed (and the next box follows when the front one pops).
  let first: Box | undefined;
  for (let gx = spring.x + dx, gy = spring.y + dy; ; gx += dx, gy += dy) {
    if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) break;
    if (sandBoxAtCell(state, gx, gy) || springAtCell(state, gx, gy)) break;
    first = activeBoxAt(state, gx, gy, null);
    if (first) break;
  }
  if (!first) return { boxes: [], blocked: false };
  if (first.frozen > 0) return { boxes: [], blocked: true };
  const set = new Set<Box>([first]);
  const order: Box[] = [first];
  for (let k = 0; k < order.length; k++) {
    const b = order[k];
    for (const c of b.cells) {
      const tx = b.x + c.x + dx;
      const ty = b.y + c.y + dy;
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return { boxes: order, blocked: true };
      if (sandBoxAtCell(state, tx, ty) || springAtCell(state, tx, ty)) return { boxes: order, blocked: true };
      const o = activeBoxAt(state, tx, ty, set);
      if (!o) continue;
      if (o.frozen > 0) return { boxes: order, blocked: true };
      set.add(o);
      order.push(o);
    }
  }
  return { boxes: order, blocked: false };
}

// Tick of each spring's last push (per game).
const lastPush = new WeakMap<GameState, Map<number, number>>();

/**
 * Every step: recompute every spring's stack, set `pushDir` on stack members (cleared on all other
 * boxes) and `loaded` on blocked springs. A spring whose stack can move pushes it one cell, at most
 * once every SPRING_INTERVAL steps: boxes move together, each is shaken, one `springPushed` event.
 * Springs are processed in id order; a box in two stacks takes the first spring's direction.
 */
export function applySprings(state: GameState): void {
  if (state.springs.length === 0) return;
  for (const b of state.boxes) b.pushDir = null;
  let last = lastPush.get(state);
  if (!last) {
    last = new Map();
    lastPush.set(state, last);
  }
  for (const spring of state.springs) {
    const stack = springStack(state, spring);
    spring.loaded = stack.blocked;
    for (const b of stack.boxes) if (b.pushDir === null) b.pushDir = spring.dir;
    if (stack.blocked || stack.boxes.length === 0) continue;
    const prev = last.get(spring.id);
    if (prev !== undefined && state.tick - prev < SPRING_INTERVAL) continue;
    last.set(spring.id, state.tick);
    const [dx, dy] = DIR_VEC[spring.dir];
    for (const b of stack.boxes) {
      b.x += dx;
      b.y += dy;
    }
    for (const b of stack.boxes) shakeBox(state, b.id, dx, dy);
    state.events.push({ type: 'springPushed', springId: spring.id, boxIds: stack.boxes.map((b) => b.id), dir: spring.dir });
  }
}
