// Undo snapshots: compact deep copies of everything the simulation evolves.

import type { BoxState, Dir, GameState, HeroState } from './types';
import { touchRegion } from './sand';
import { gameSpace, invalidateSpace } from './transfer';
import { debrisLoad, debrisSave } from './game';
import { slideLoad, slideSave } from './hero';

export interface GameSnapshot {
  /** Per region (sand boxes, then boxes): its cells and count. */
  cells: Uint8Array[];
  counts: Int32Array;
  /** Per box: x, y, frozen, falling. */
  boxNums: Int32Array;
  boxStates: BoxState[];
  pushDirs: (Dir | null)[];
  slidings: (Dir | null)[];
  slideCounts: [number, number][];
  hero: HeroState | null;
  conveyorPhase: Float64Array;
  heldBoxId: number | null;
  tick: number;
  seed: number;
  completedCount: number;
  moves: number;
  won: boolean;
  /** Pull credit per box id (keeps the sand in lockstep after a restore). */
  credit: Float64Array;
  debris: ReturnType<typeof debrisSave>;
}

/** Deep copy of the evolving game state (typed-array copies; no per-grain objects). */
export function snapshotState(state: GameState): GameSnapshot {
  const regions = [...state.sandBoxes.map((s) => s.region), ...state.boxes.map((b) => b.region)];
  const boxNums = new Int32Array(state.boxes.length * 4);
  state.boxes.forEach((b, i) => {
    boxNums[4 * i] = b.x;
    boxNums[4 * i + 1] = b.y;
    boxNums[4 * i + 2] = b.frozen;
    boxNums[4 * i + 3] = b.falling;
  });
  return {
    cells: regions.map((r) => r.cells.slice()),
    counts: Int32Array.from(regions.map((r) => r.count)),
    boxNums,
    boxStates: state.boxes.map((b) => b.state),
    pushDirs: state.boxes.map((b) => b.pushDir),
    slidings: state.boxes.map((b) => b.sliding),
    slideCounts: slideSave(state),
    hero: state.hero ? { ...state.hero } : null,
    conveyorPhase: Float64Array.from(state.conveyors.map((c) => c.phase)),
    heldBoxId: state.heldBoxId,
    tick: state.tick,
    seed: state.rng.seed,
    completedCount: state.completedCount,
    moves: state.moves,
    won: state.won,
    credit: gameSpace(state).credit.slice(),
    debris: debrisSave(state),
  };
}

/** Restore a snapshot taken from this same game. Region versions are bumped (the renderer redraws)
 *  and the shared space is invalidated so dockings are rebuilt. Pending events are kept. */
export function restoreState(state: GameState, snap: GameSnapshot): void {
  const regions = [...state.sandBoxes.map((s) => s.region), ...state.boxes.map((b) => b.region)];
  regions.forEach((r, i) => {
    r.cells.set(snap.cells[i]);
    r.count = snap.counts[i];
    touchRegion(r);
  });
  state.boxes.forEach((b, i) => {
    b.x = snap.boxNums[4 * i];
    b.y = snap.boxNums[4 * i + 1];
    b.frozen = snap.boxNums[4 * i + 2];
    b.falling = snap.boxNums[4 * i + 3];
    b.state = snap.boxStates[i];
    b.pushDir = snap.pushDirs[i];
    b.sliding = snap.slidings[i];
  });
  state.hero = snap.hero ? { ...snap.hero } : null;
  state.conveyors.forEach((c, i) => (c.phase = snap.conveyorPhase[i]));
  state.heldBoxId = snap.heldBoxId;
  state.tick = snap.tick;
  state.rng.seed = snap.seed;
  state.completedCount = snap.completedCount;
  state.moves = snap.moves;
  state.won = snap.won;
  debrisLoad(state, snap.debris);
  slideLoad(state, snap.slideCounts);
  invalidateSpace(state);
  gameSpace(state).credit.set(snap.credit);
}
