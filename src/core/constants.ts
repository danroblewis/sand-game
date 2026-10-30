// Tunable simulation constants. All probabilities are per grain per 60 Hz step.

import { GRAINS_PER_UNIT } from './types';

/** Fixed simulation rate. */
export const STEPS_PER_SECOND = 60;
/** Max sim steps the main loop should run per animation frame when catching up. */
export const MAX_STEPS_PER_FRAME = 4;

/** Probability a grain that cannot fall or slide slumps sideways toward a nearby drop. */
export const P_SLUMP = 0.35;

/** How far (in fine cells) a grain looks sideways for a drop when slumping. Piles relax to a
 *  slope of about 1/SLUMP_REACH; grains on a flat supported surface never jitter. */
export const SLUMP_REACH = 4;

/** Edge flow: in a sand box, a surface grain whose free run along its row ends at a docked opening
 *  of its color (a box that can still take it) keeps flowing toward it, at any distance, moving
 *  this many cells per step. Lets a layer beside a box drain completely. */
export const EDGE_FLOW_SPEED = 12;

/** Default reach of a box's pull in fine cells (grains): BFS steps from the opening cells through
 *  empty / own-color cells. Deliberately tiny: the pull is a nudge at the opening, not a force
 *  that moves sand over distance. */
export const PULL_REACH = 3;

/** Probability a grain under pull steps one cell toward the opening each step. */
export const P_PULL = 0.8;

/** Max grains a box pulls in through its openings per step: BASE + PER_CELL * gridCells.
 *  Fractional rates accumulate as per-box credit. A 1x1 box takes 5.5/step → 576 grains in ~105
 *  steps (≈1.75 s) when sand is in reach; bigger shapes proportionally longer. */
export const PULL_RATE_BASE = 5;
export const PULL_RATE_PER_CELL = 0.5;

/** Shake on move: probability per grain per hop pass, and the number of passes (so surface grains
 *  hop one or two cells against the motion and then fall back). */
export const P_SHAKE = 0.5;
export const SHAKE_HOPS = 2;

/** Runtime-tunable settings (tests, debug UI). */
export const simConfig = {
  /** Pull reach in fine cells (0 = pull disabled). */
  pullReach: PULL_REACH as number,
};

/** Set the pull reach in fine cells, clamped to 1..6; 0 (or less) disables the pull (tests).
 *  Returns the old value. */
export function setPullReach(cells: number): number {
  const old = simConfig.pullReach;
  simConfig.pullReach = cells <= 0 ? 0 : Math.max(1, Math.min(6, Math.round(cells)));
  return old;
}

/** Current pull reach in fine cells. */
export function pullReach(): number {
  return simConfig.pullReach;
}

/** Completion slack: a box completes when it is within this many grains of full (a tenth of a
 *  grid cell, 58 grains, the same absolute amount for every box). Real sand leaves films and
 *  trapped grains behind; the leftovers stay in the sand boxes as debris. */
export const COMPLETION_SLACK = Math.round(0.1 * GRAINS_PER_UNIT);

/** Debris dissolution: once no box of a color remains on the board (active or frozen), its leftover
 *  grains in the sand boxes crumble away over this many steps (~0.75 s). */
export const DISSOLVE_STEPS = 45;

/** Conveyors move the boxes riding them one cell every this many steps. */
export const CONVEYOR_INTERVAL = 6;
