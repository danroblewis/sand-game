// Box gravity (per level, DESIGN.md "Box gravity"): unsupported boxes fall one cell every
// BOX_FALL_INTERVAL steps, bottom-up so a stack falls together.

import type { Box, GameState } from './types';
import { BOX_FALL_INTERVAL } from './constants';
import { canPlace, shakeBox } from './grid';
import { heroGravity } from './hero';

/** Lowest grid row the box occupies. */
function bottomRow(b: Box): number {
  let m = -Infinity;
  for (const c of b.cells) if (b.y + c.y > m) m = b.y + c.y;
  return m;
}

/** Active boxes in fall order: bottom-up (lowest cell's y descending), ties by id. */
function fallOrder(state: GameState): Box[] {
  return state.boxes
    .filter((b) => b.state === 'active')
    .sort((a, b) => bottomRow(b) - bottomRow(a) || a.id - b.id);
}

/**
 * One fall step worked out on the current board: bottom-up, each active box (frozen too) that is
 * not held and can move down one cell does. With `apply` false the moves are undone (dry run).
 * Returns the boxes that fall.
 */
function planFall(state: GameState, apply: boolean): Box[] {
  const fell: Box[] = [];
  for (const b of fallOrder(state)) {
    if (b.id === state.heldBoxId) continue;
    if (!canPlace(state, b, b.x, b.y + 1)) continue;
    b.y++;
    fell.push(b);
  }
  if (!apply) for (const b of fell) b.y--;
  return fell;
}

/** True when the box cannot fall right now (something under it, the floor, or it is held). With
 *  box gravity off every box is supported. */
export function boxSupported(state: GameState, box: Box): boolean {
  if (!state.boxGravity || box.state !== 'active' || box.id === state.heldBoxId) return true;
  return !canPlace(state, box, box.x, box.y + 1);
}

/** Ids of the boxes that will fall on the next fall step (dry run; for rendering). Empty when box
 *  gravity is off. A box resting on a box that falls is included (the stack falls together). */
export function fallPlan(state: GameState): Set<number> {
  if (!state.boxGravity) return new Set();
  return new Set(planFall(state, false).map((b) => b.id));
}

/**
 * Every BOX_FALL_INTERVAL steps (box gravity on): the planned boxes fall one cell (`falling++`,
 * `boxMoved` each, bottom-up). A box that moved and will not fall on the next fall step (dry run
 * from the new positions) lands on this same step:
 * `boxLanded {boxId, fell}`, one shake (dy = +1: the surface hops up), `falling = 0`; a box that
 * was falling but is blocked without having moved lands the same way. Falls are not moves; the
 * shared space rebuilds by itself because box positions changed.
 */
export function applyBoxGravity(state: GameState): void {
  if (!state.boxGravity || state.tick % BOX_FALL_INTERVAL !== 0) return;
  const moved = planFall(state, true);
  const fell = new Set(moved);
  const land = (b: Box) => {
    state.events.push({ type: 'boxLanded', boxId: b.id, fell: b.falling });
    shakeBox(state, b.id, 0, 1);
    b.falling = 0;
  };
  // Boxes that moved land on this same step if they will not fall on the next fall step (dry run
  // from the new positions, so a stack whose lower boxes keep falling keeps falling together).
  for (const b of moved) {
    b.falling++;
    state.events.push({ type: 'boxMoved', boxId: b.id, x: b.x, y: b.y });
  }
  const next = new Set(planFall(state, false));
  for (const b of moved) if (!next.has(b)) land(b);
  // A box that was still falling but is blocked without having moved (support appeared) lands too.
  for (const b of state.boxes) if (b.state === 'active' && !fell.has(b) && b.falling > 0) land(b);
  heroGravity(state); // after the boxes: the hero holds up boxes resting on it
}
