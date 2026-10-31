// Replays a drag plan ("box#i -> (x,y)") through the real simulation. This is the proof that a
// level is winnable: the abstract solver is only a heuristic now that sand obeys gravity.
import type { Box, Dir, GameState, LevelDef } from '../core/types';
import { canPlace, createGame, fallPlan, heroSupported, kickBox, moveHero, regionVersion, stepGame, tryMoveBox } from '../core';
import { STEPS_PER_SECOND } from '../core/constants';

export interface ReplayOptions {
  seed?: number;
  /** Steps without any region changing before a drag is considered settled. */
  quietSteps?: number;
  /** Max sim steps to wait after one drag. */
  maxStepsPerDrag?: number;
  /** Hero levels: sim steps between two inputs of one entry (default HERO_INPUT_STEPS). A slow pace
   *  proves no entry has to beat a drain (tests/levels-physics.test.ts). */
  heroInputSteps?: number;
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
  /** Hero levels: hero inputs (moves and kicks) issued; 0 otherwise. */
  inputs: number;
  /** Hero levels: kicks among `inputs`. */
  kicks: number;
  /** Sim seconds each completed box took from the drag that preceded its completion. */
  fills: string[];
  /** Longest single settle after a drag, in sim steps. */
  longestSettle: number;
  state: GameState;
}

// A step is "box#i -> (x,y)"; a trailing " &" means "don't wait for this drag to settle": the next
// drag follows after GRAB_STEPS (the time a player needs to grab the next piece), e.g. to clear a
// belt's path while a box rides it.
const STEP_RE = /^box#(\d+) -> \((-?\d+),(-?\d+)\)( &)?$/;

/** Sim steps between a no-wait drag ("... &") and the next drag (0.5 s). */
export const GRAB_STEPS = 30;

/** Hero levels: each solution entry is a string of inputs: U/D/L/R moves, or K followed by a
 *  direction letter for a kick (DESIGN.md "Kick"), e.g. "RRKLDD". */
const HERO_RE = /^(?:[UDLR]|K[UDLR])+$/;
const HERO_DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };

/** One hero input: a move or a kick in `dir`. */
export interface HeroInput {
  dir: Dir;
  kick: boolean;
}

/** Sim steps between two hero inputs in one entry (a quick but human pace; lets a pushed box
 *  start falling or docking before the next input). */
export const HERO_INPUT_STEPS = 6;

/** Hero entry ("RRKLU") → inputs, or null if it is not a valid hero entry. */
export function parseHeroEntry(entry: string): HeroInput[] | null {
  const t = entry.trim();
  if (!HERO_RE.test(t)) return null;
  const out: HeroInput[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'K') out.push({ dir: HERO_DIR[t[++i]], kick: true });
    else out.push({ dir: HERO_DIR[t[i]], kick: false });
  }
  return out;
}

/** True while a kicked box is still sliding. */
function anySliding(state: GameState): boolean {
  return state.boxes.some((b) => b.state === 'active' && b.sliding !== null);
}

/** True when the hero (box gravity) has nothing right below it and would fall. */
function heroCanFall(state: GameState): boolean {
  return !!state.hero && state.boxGravity && !heroSupported(state);
}

export function parseStep(step: string): { box: number; x: number; y: number; noWait: boolean } | null {
  const m = STEP_RE.exec(step.trim());
  return m ? { box: +m[1], x: +m[2], y: +m[3], noWait: !!m[4] } : null;
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
  // Box positions count as activity: a box riding a conveyor (one cell per few steps) or one just
  // carried into contact must not end the settle.
  for (const b of state.boxes) v += regionVersion(b.region) + b.region.count + (b.x + 1) * 7919 + (b.y + 1) * 104729;
  if (state.hero) v += (state.hero.x + 1) * 15485863 + (state.hero.y + 1) * 32452843;
  return v;
}

const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/** True while some box on a conveyor can still ride on (belts move only every few dozen steps, so
 *  a quiet stretch shorter than the belt interval must not end the settle). */
function beltBusy(state: GameState): boolean {
  for (const cv of state.conveyors ?? []) {
    const [dx, dy] = DIR_VEC[cv.dir];
    for (const b of state.boxes) {
      if (b.state !== 'active' || b.frozen > 0) continue;
      const on = b.cells.some((c) => cv.cells.some((k) => k.x === b.x + c.x && k.y === b.y + c.y));
      if (on && canPlace(state, b, b.x + dx, b.y + dy)) return true;
    }
  }
  return false;
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
    // a box still falling (box gravity) is activity too: a drag that drops a stack is not settled
    // until everything has landed
    if (v === last && !beltBusy(state) && fallPlan(state).size === 0 && !heroCanFall(state) && !anySliding(state)) {
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
  let inputs = 0;
  let kicks = 0;
  for (const step of plan) {
    if (state.won && state.hero) break;
    if (state.hero) {
      // Hero level: walk the inputs at a human pace, then settle once the entry is done.
      const dirs = parseHeroEntry(step);
      if (!dirs) {
        why = `bad hero entry "${step}"`;
        break;
      }
      drags++;
      const before = state.boxes.filter((b) => b.state === 'active').map((b) => b.id);
      const t = state.tick;
      let s = 0;
      for (let k = 0; k < dirs.length && !state.won; k++) {
        const { dir, kick } = dirs[k];
        if (!(kick ? kickBox(state, dir) : moveHero(state, dir))) {
          const label = `${kick ? 'K' : ''}${dir[0].toUpperCase()}`;
          why = `${step}: input ${k + 1} (${label}) blocked with the hero at (${state.hero.x},${state.hero.y})`;
          break;
        }
        inputs++;
        if (kick) kicks++;
        // a few steps per input, more while the hero is still falling (gravity levels) or a kicked
        // box is still sliding
        for (let i = 0; (i < (opts.heroInputSteps ?? HERO_INPUT_STEPS) || heroCanFall(state) || state.hero.falling > 0 || anySliding(state)) && i < 600 && !state.won; i++) {
          stepGame(state);
          s++;
        }
      }
      if (why) break;
      const ss = settle(state, quiet, maxPer);
      s += ss;
      steps += s;
      longest = Math.max(longest, ss);
      for (const b of state.boxes)
        if (before.includes(b.id) && b.state === 'removed')
          fills.push(`#${b.id}${b.shape}:${((state.tick - t) / STEPS_PER_SECOND).toFixed(1)}s`);
      opts.onDrag?.(step, state, s);
      continue;
    }
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
    let s = 0;
    if (p.noWait) {
      for (; s < GRAB_STEPS && !state.won; s++) stepGame(state);
    } else s = settle(state, quiet, maxPer);
    steps += s;
    longest = Math.max(longest, s);
    for (const b of state.boxes)
      if (before.includes(b.id) && b.state === 'removed')
        fills.push(`#${b.id}${b.shape}:${((state.tick - t) / STEPS_PER_SECOND).toFixed(1)}s`);
    opts.onDrag?.(step, state, s);
  }
  if (!why && !state.won) why = 'plan finished but level not won';
  return { won: state.won && !why, why, steps, drags, inputs, kicks, fills, longestSettle: longest, state };
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
