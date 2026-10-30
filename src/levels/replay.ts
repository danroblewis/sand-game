// Replays a drag plan ("box#i -> (x,y)") through the real simulation. This is the proof that a
// level is winnable: the abstract solver is only a heuristic now that sand obeys gravity.
import type { Box, GameState, LevelDef } from '../core/types';
import { canPlace, createGame, regionVersion, stepGame, tryMoveBox } from '../core';
import { STEPS_PER_SECOND } from '../core/constants';

export interface ReplayOptions {
  seed?: number;
  /** Steps without any region changing before a drag is considered settled. */
  quietSteps?: number;
  /** Max sim steps to wait after one drag. */
  maxStepsPerDrag?: number;
  /** Called after each drag has settled (for --verbose output). */
  onDrag?: (step: string, state: GameState, settleSteps: number) => void;
}

export interface ReplayResult {
  won: boolean;
  /** Reason for failure ('' when won). */
  why: string;
  /** Total sim steps (60 per second). */
  steps: number;
  drags: number;
  /** Sim seconds each completed box took from the drag that preceded its completion. */
  fills: string[];
  /** Longest single settle after a drag, in sim steps. */
  longestSettle: number;
  state: GameState;
}

const STEP_RE = /^box#(\d+) -> \((-?\d+),(-?\d+)\)$/;

export function parseStep(step: string): { box: number; x: number; y: number } | null {
  const m = STEP_RE.exec(step.trim());
  return m ? { box: +m[1], x: +m[2], y: +m[3] } : null;
}

/** Grid path (excluding the start) for `box` to (tx, ty) through cells where it fits. */
export function boxPath(state: GameState, box: Box, tx: number, ty: number): [number, number][] | null {
  const key = (x: number, y: number) => (y + 8) * 64 + x + 8;
  const prev = new Map<number, number>([[key(box.x, box.y), -1]]);
  const q: [number, number][] = [[box.x, box.y]];
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y] = q[qi];
    if (x === tx && y === ty) {
      const out: [number, number][] = [];
      for (let k = key(x, y); k !== key(box.x, box.y); k = prev.get(k)!) out.unshift([(k % 64) - 8, Math.floor(k / 64) - 8]);
      return out;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (prev.has(key(nx, ny)) || !canPlace(state, box, nx, ny)) continue;
      prev.set(key(nx, ny), key(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

function versionSum(state: GameState): number {
  let v = state.completedCount * 1_000_003;
  for (const s of state.sandBoxes) v += regionVersion(s.region);
  // Box positions and spring states count as activity: a spring pushing a stack (one cell per
  // few steps) or a box just pushed into contact must not end the settle.
  for (const b of state.boxes) v += regionVersion(b.region) + b.region.count + (b.x + 1) * 7919 + (b.y + 1) * 104729;
  for (const sp of state.springs ?? []) v += sp.loaded ? 15485863 : 0;
  return v;
}

/** Steps until nothing changes for `quiet` steps (or `max` steps). Returns steps taken. */
export function settle(state: GameState, quiet = 45, max = 3600): number {
  let steps = 0;
  let still = 0;
  let last = versionSum(state);
  while (steps < max && !state.won) {
    stepGame(state);
    steps++;
    const v = versionSum(state);
    if (v === last) {
      if (++still >= quiet) break;
    } else {
      still = 0;
      last = v;
    }
  }
  return steps;
}

export function replayLevel(level: LevelDef, plan: string[], opts: ReplayOptions = {}): ReplayResult {
  const state = createGame(level, opts.seed ?? 7);
  const quiet = opts.quietSteps ?? 45;
  const maxPer = opts.maxStepsPerDrag ?? 60 * STEPS_PER_SECOND;
  let steps = settle(state, quiet, maxPer);
  let longest = steps;
  const fills: string[] = [];
  let why = '';
  let drags = 0;
  for (const step of plan) {
    const p = parseStep(step);
    if (!p || !state.boxes[p.box]) {
      why = `bad step "${step}"`;
      break;
    }
    const box = state.boxes[p.box];
    if (box.state !== 'active') {
      why = `${step}: box already completed`;
      break;
    }
    if (box.frozen > 0) {
      why = `${step}: box still frozen (${box.frozen})`;
      break;
    }
    const path = boxPath(state, box, p.x, p.y);
    if (!path) {
      why = `${step}: no path`;
      break;
    }
    for (const [x, y] of path) {
      if (!tryMoveBox(state, box.id, x - box.x, y - box.y)) {
        why = `${step}: step blocked`;
        break;
      }
    }
    if (why) break;
    drags++;
    const before = state.boxes.filter((b) => b.state === 'active').map((b) => b.id);
    const t = state.tick;
    const s = settle(state, quiet, maxPer);
    steps += s;
    longest = Math.max(longest, s);
    for (const b of state.boxes)
      if (before.includes(b.id) && b.state === 'removed')
        fills.push(`#${b.id}${b.shape}:${((state.tick - t) / STEPS_PER_SECOND).toFixed(1)}s`);
    opts.onDrag?.(step, state, s);
  }
  if (!why && !state.won) why = 'plan finished but level not won';
  return { won: state.won && !why, why, steps, drags, fills, longestSettle: longest, state };
}

const CH = '?ROYGTBIPKNWC';

/** Human-readable fill report: per active box fill and per sand box grains left per color. */
export function describeState(state: GameState): string {
  const boxes = state.boxes
    .filter((b) => b.state === 'active')
    .map((b) => `#${b.id}${CH[b.color]}${b.frozen ? '*' + b.frozen : ''}@${b.x},${b.y}=${(b.region.count / 576).toFixed(2)}/${b.region.capacity / 576}`)
    .join(' ');
  const sbs = state.sandBoxes
    .map((s) => {
      const per = new Map<number, number>();
      for (const v of s.region.cells) if (v) per.set(v & 31, (per.get(v & 31) ?? 0) + 1);
      return `sb${s.id}[${[...per].map(([c, n]) => `${CH[c]}${(n / 576).toFixed(2)}`).join(' ')}]`;
    })
    .join(' ');
  return `boxes: ${boxes || '-'} | ${sbs}`;
}
