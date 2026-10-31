// Procedural level generator. Rejection sampling over random layouts: each attempt builds a level
// whose sand is derived from the box capacities (so conservation holds by construction), checks
// it with validateLevel and the greedy "naive player" difficulty gate, asks the heuristic solver
// (solver.ts) for a few candidate plans, and then PROVES the level by replaying candidates through
// the real simulation (createGame + stepGame with a per-drag settle loop). The first candidate that
// wins in physics becomes the level's solution; if none does, the level is rejected.
// Everything is driven by a seeded RNG with a derived sub-seed per attempt and the simulation runs
// with a fixed seed (SIM_SEED), so generateLevel(seed, difficulty) is deterministic.
import type { Box, BoxDef, ColorId, ConveyorDef, GameState, LayerDef, LevelDef, SandBoxDef, ShapeName } from '../core/types';
import { SHAPES, shapeBounds } from '../core/shapes';
import { canPlace, createGame, fallPlan, gameSpace, heroSupported, moveHero, stepGame, tryMoveBox, groupCount } from '../core';
import { validateLevel } from './validate';
import { DEFAULT_MODEL, greedySolve, makeStack, scriptedPlan, solveMany, type Intent, type ModelParams, type SolveResult } from './solver';

// ---------------------------------------------------------------------------------------------
// RNG (mulberry32, local so the generator is independent of the sim's RNG usage)

interface Rng {
  s: number;
}
const rngOf = (seed: number): Rng => ({ s: seed | 0 });
function rnd(r: Rng): number {
  let t = (r.s = (r.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (r: Rng, lo: number, hi: number) => lo + Math.floor(rnd(r) * (hi - lo + 1)); // inclusive
const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(rnd(r) * a.length)];
function shuffle<T>(r: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(r) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function weighted<T>(r: Rng, items: [T, number][]): T {
  let tot = 0;
  for (const [, w] of items) tot += w;
  let x = rnd(r) * tot;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1][0];
}
/** Integer hash used to derive per-attempt sub-seeds. */
function hash(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h | 0;
}

// ---------------------------------------------------------------------------------------------
// Difficulty parameters

export interface DifficultyParams {
  widths: [number, number];
  heights: [number, number];
  sandBoxes: [number, number];
  boxes: [number, number];
  colors: [number, number];
  /** Max chunks a color's sand is split into (more = more buried layers). */
  maxSplit: number;
  /** Max layers per sand box (after merging equal neighbours). */
  maxLayers: number;
  /** Fraction of free cells the boxes may occupy. */
  density: [number, number];
  /** Max fraction of a sand box's area filled with sand. */
  maxFill: number;
  /** Max frozen boxes (0 below difficulty 4). */
  frozen: number;
  /** Minimum drags in the verified solution. */
  minDrags: number;
  /** Maximum drags in the verified solution (rejects sprawling levels). */
  maxDrags: number;
  /** Require the greedy naive player to get stuck (heuristic, abstract model). */
  greedyMustFail: boolean;
  /** Probability that a box is placed next to a sand box / other box (traffic jams). */
  cluster: number;
}

export function difficultyParams(difficulty: number): DifficultyParams {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const T: Record<number, Omit<DifficultyParams, 'maxDrags' | 'greedyMustFail'>> = {
    1: { widths: [6, 6], heights: [7, 8], sandBoxes: [1, 1], boxes: [1, 2], colors: [1, 2], maxSplit: 1, maxLayers: 2, density: [0.1, 0.25], maxFill: 0.9, frozen: 0, minDrags: 1, cluster: 0 },
    2: { widths: [6, 6], heights: [7, 8], sandBoxes: [1, 1], boxes: [2, 3], colors: [2, 2], maxSplit: 1, maxLayers: 2, density: [0.15, 0.3], maxFill: 0.9, frozen: 0, minDrags: 2, cluster: 0.1 },
    3: { widths: [6, 7], heights: [8, 9], sandBoxes: [1, 2], boxes: [3, 4], colors: [2, 3], maxSplit: 2, maxLayers: 3, density: [0.2, 0.35], maxFill: 0.85, frozen: 0, minDrags: 3, cluster: 0.2 },
    4: { widths: [6, 7], heights: [8, 9], sandBoxes: [1, 2], boxes: [4, 5], colors: [3, 3], maxSplit: 2, maxLayers: 3, density: [0.25, 0.4], maxFill: 0.85, frozen: 1, minDrags: 4, cluster: 0.3 },
    5: { widths: [6, 7], heights: [8, 10], sandBoxes: [2, 3], boxes: [4, 6], colors: [3, 4], maxSplit: 2, maxLayers: 3, density: [0.3, 0.45], maxFill: 0.85, frozen: 1, minDrags: 5, cluster: 0.4 },
    6: { widths: [7, 7], heights: [9, 10], sandBoxes: [2, 3], boxes: [5, 6], colors: [3, 4], maxSplit: 2, maxLayers: 3, density: [0.3, 0.45], maxFill: 0.85, frozen: 1, minDrags: 6, cluster: 0.5 },
    7: { widths: [7, 8], heights: [9, 10], sandBoxes: [2, 3], boxes: [5, 7], colors: [4, 4], maxSplit: 2, maxLayers: 3, density: [0.3, 0.5], maxFill: 0.85, frozen: 2, minDrags: 7, cluster: 0.55 },
    8: { widths: [7, 8], heights: [9, 11], sandBoxes: [2, 3], boxes: [6, 7], colors: [4, 5], maxSplit: 2, maxLayers: 3, density: [0.35, 0.5], maxFill: 0.85, frozen: 2, minDrags: 8, cluster: 0.6 },
    9: { widths: [7, 8], heights: [10, 11], sandBoxes: [3, 3], boxes: [6, 8], colors: [4, 5], maxSplit: 3, maxLayers: 3, density: [0.35, 0.55], maxFill: 0.85, frozen: 2, minDrags: 9, cluster: 0.65 },
    10: { widths: [8, 8], heights: [10, 11], sandBoxes: [3, 4], boxes: [7, 8], colors: [5, 6], maxSplit: 3, maxLayers: 4, density: [0.4, 0.55], maxFill: 0.85, frozen: 3, minDrags: 10, cluster: 0.7 },
  };
  const p = T[d];
  return { ...p, maxDrags: p.minDrags * 2 + 6, greedyMustFail: d >= 5 };
}

// ---------------------------------------------------------------------------------------------
// Physics replay (the proof)

/** Sim seed used for verification. The UI must create the game with the same seed for the
 *  verified plan to be replayable bit-for-bit (other seeds usually win too, but are not proven). */
export const SIM_SEED = 1;
/** Steps of unchanged box/sand counts after which a drag's flow is considered finished (1.5 s). */
const QUIET_STEPS = 90;
/** Total sim time budget per plan (steps; 150 s). */
const PLAN_STEP_CAP = 150 * 60;
/** Sim time budget per drag (steps; 60 s): a flow that is still going after a minute is not fun
 *  to wait for (and costly to verify). */
const DRAG_STEP_CAP = 60 * 60;
/** Hero levels: sim steps between two inputs of one entry (as src/levels/replay.ts). */
const HERO_INPUT_STEPS = 6;
const HERO_DIRS: Record<string, 'up' | 'down' | 'left' | 'right'> = { U: 'up', D: 'down', L: 'left', R: 'right' };
/** Quiet steps to wait (5 s) for a blocked drag's way to clear / a box to thaw. */
const WAIT_QUIET_STEPS = 300;

function simPath(state: GameState, box: Box, tx: number, ty: number): [number, number][] | null {
  const key = (x: number, y: number) => y * 64 + x;
  const prev = new Map<number, number>();
  const q: [number, number][] = [[box.x, box.y]];
  prev.set(key(box.x, box.y), -1);
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y] = q[qi];
    if (x === tx && y === ty) {
      const out: [number, number][] = [];
      for (let k = key(x, y); k !== key(box.x, box.y); k = prev.get(k)!) out.unshift([k % 64, Math.floor(k / 64)]);
      return out;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (prev.has(key(nx, ny)) || !canPlace(state, box, nx, ny)) continue;
      prev.set(key(nx, ny), key(x, y));
      q.push([nx, ny]);
    }
  }
  return null;
}

/** True when the sim cannot change any more until a box moves: every region sleeps and no box
 *  has matching sand in reach. */
function simStatic(state: GameState): boolean {
  // belts and driven boxes move on their own clock: leave those boards to the quiet window
  if (state.conveyors?.length || state.boxes.some((b) => b.force && b.state === 'active')) return false;
  const sp = gameSpace(state);
  for (const s of sp.slots) if (!s.quiet) return false;
  for (const p of sp.pullers) if (!p.idle && groupCount(p.group) < p.group.capacity) return false;
  return true;
}

/** Steps the sim until it is static, or the box/sand counts have not changed for QUIET_STEPS, or
 *  the game is won, or `maxSteps` run out. Returns the steps run. */
function simSettle(state: GameState, maxSteps: number, quiet = QUIET_STEPS, until?: () => boolean): number {
  let still = 0;
  let steps = 0;
  let last = -1;
  while (steps < maxSteps && !state.won) {
    stepGame(state);
    steps++;
    if (until?.()) break;
    let total = state.completedCount * 1_000_000;
    for (const b of state.boxes) if (b.state === 'active') total += b.region.count + (b.x + 1) * 7919 + (b.y + 1) * 104729;
    if (state.hero) total += (state.hero.x + 1) * 15485863 + (state.hero.y + 1) * 32452843;
    // a box (or the hero) still falling (box gravity) is activity: a drag that drops a stack is
    // not settled until everything has landed
    if (total === last && !(state.boxGravity && (fallPlan(state).size > 0 || (state.hero && !heroSupported(state))))) {
      if (++still >= quiet) break;
      if ((still & 7) === 0 && simStatic(state)) break;
    } else {
      still = 0;
      last = total;
    }
  }
  return steps;
}

/** A box the rest of the plan never moves can only complete where it stands: it must share an
 *  edge with a sand box still holding its color or with a live box of its color, or a live box
 *  of its color must still move later (it may come alongside and feed it). Returns the index of
 *  the first box that cannot, or -1. */
function strandedBox(state: GameState, laterMoved: Set<number>): number {
  const { width: W, height: H } = state;
  const owner = new Int32Array(W * H).fill(-1); // >= 0 box id, <= -2 sand box -(k+2)
  state.sandBoxes.forEach((s, k) => {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) owner[y * W + x] = -(k + 2);
  });
  for (const b of state.boxes) if (b.state === 'active') for (const c of b.cells) owner[(b.y + c.y) * W + b.x + c.x] = b.id;
  const sandHas = state.sandBoxes.map(() => new Set<number>());
  state.sandBoxes.forEach((s, k) => {
    for (const v of s.region.cells) if (v) sandHas[k].add(v & 31);
  });
  const movingColors = new Set<number>();
  for (const b of state.boxes) if (b.state === 'active' && laterMoved.has(b.id)) movingColors.add(b.color);
  for (const b of state.boxes) {
    if (b.state !== 'active' || laterMoved.has(b.id) || movingColors.has(b.color)) continue;
    let ok = false;
    for (const c of b.cells) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = b.x + c.x + dx;
        const y = b.y + c.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = owner[y * W + x];
        if (o <= -2 && sandHas[-o - 2].has(b.color)) ok = true;
        else if (o >= 0 && o !== b.id && state.boxes[o].color === b.color) ok = true;
      }
      if (ok) break;
    }
    if (!ok) return b.id;
  }
  return -1;
}

export interface SimReplayResult {
  won: boolean;
  /** '' on a win, else why the replay failed. */
  reason: string;
  /** Sim steps run (60 per second of game time). */
  steps: number;
  /** The drags actually performed (drags of boxes that had already completed are dropped). */
  executed: string[];
}

/** Plays a plan (`box#i -> (x,y)` steps) through the real simulation: the sim first settles,
 *  then each drag is performed as single-cell moves along a shortest free route (a drag whose
 *  route is blocked fails the plan; a drag of a box that already completed is skipped) and the
 *  sim runs until the flow stops. `onStep` sees the sim state after each drag. */
export function replayInSim(
  level: LevelDef,
  path: string[],
  opts: {
    simSeed?: number;
    maxSteps?: number;
    onStep?: (step: string, state: GameState) => void;
  } = {},
): SimReplayResult {
  const state = createGame(level, opts.simSeed ?? SIM_SEED);
  const caps = levelCaps(level);
  const cap = opts.maxSteps ?? caps.plan;
  const dragCap = caps.drag;
  let steps = simSettle(state, cap);
  const executed: string[] = [];
  const moved = path.map((step) => {
    const m = /box#(\d+) -> /.exec(step);
    return m ? +m[1] : -1;
  });
  for (let si = 0; si < path.length; si++) {
    const step = path[si];
    if (state.hero) {
      const e = runHeroEntry(state, step, Math.min(cap - steps, dragCap));
      steps += e.steps;
      if (e.reason) return { won: false, reason: e.reason, steps, executed };
      executed.push(step);
      opts.onStep?.(step, state);
      if (state.won) break;
      if (steps >= cap) return { won: false, reason: 'sim time cap', steps, executed };
      continue;
    }
    const m = /box#(\d+) -> \((-?\d+),(-?\d+)\)/.exec(step);
    if (!m) return { won: false, reason: `bad step ${step}`, steps, executed };
    const box = state.boxes[+m[1]];
    if (box.state === 'active') {
      // like a patient player: if the box is still frozen or its way is still blocked (a box in
      // the way is still filling), wait for the sand to finish moving first
      let route = box.frozen > 0 ? null : simPath(state, box, +m[2], +m[3]);
      if (!route && box.state === 'active') {
        steps += simSettle(state, Math.min(cap - steps, DRAG_STEP_CAP), WAIT_QUIET_STEPS, () => {
          if (box.frozen > 0 || state.tick % 15 !== 0) return false;
          return !!(route = simPath(state, box, +m[2], +m[3]));
        });
        if (box.state !== 'active') {
          opts.onStep?.(step, state);
          continue;
        }
        if (box.frozen > 0) return { won: false, reason: `${step}: still frozen`, steps, executed };
        route ??= simPath(state, box, +m[2], +m[3]);
      }
      if (!route) return { won: false, reason: `${step}: no path`, steps, executed };
      executed.push(step);
      for (const [x, y] of route)
        if (!tryMoveBox(state, box.id, x - box.x, y - box.y)) return { won: false, reason: `${step}: step blocked`, steps, executed };
      const lim = Math.min(cap - steps, dragCap);
      const n = simSettle(state, lim);
      steps += n;
      if (n >= lim && !state.won) return { won: false, reason: `${step}: slow flow (cap)`, steps, executed };
    }
    opts.onStep?.(step, state);
    if (state.won) break;
    if (steps >= cap) return { won: false, reason: 'sim time cap', steps, executed };
    // early bail: a box that will never move again and cannot fill where it stands (not under
    // box gravity: a box can still fall into contact when something below it pops)
    const stuck = state.boxGravity ? -1 : strandedBox(state, new Set(moved.slice(si + 1)));
    if (stuck >= 0) return { won: false, reason: `stranded box#${stuck} after ${step}`, steps, executed };
  }
  if (!state.won) steps += simSettle(state, cap - steps);
  if (state.won) return { won: true, reason: '', steps, executed };
  const active = state.boxes
    .filter((b) => b.state === 'active')
    .map((b) => `${b.shape}c${b.color}${b.frozen ? 'F' + b.frozen : ''}=${b.region.count}/${b.region.capacity}`);
  return { won: false, reason: `not won; active=[${active.join(' ')}]`, steps, executed };
}

/** Sim step budgets: big maps (a 'scroll' / 'rooms' camera) get 300 s per plan, 180 s per entry. */
function levelCaps(level: LevelDef): { plan: number; drag: number } {
  const big = !!level.camera && level.camera !== 'fit';
  return big ? { plan: 300 * 60, drag: 180 * 60 } : { plan: PLAN_STEP_CAP, drag: DRAG_STEP_CAP };
}

/** Plays one hero entry (a string of U/D/L/R inputs at a human pace: HERO_INPUT_STEPS sim steps
 *  per input, more while the hero falls), then settles. Shared by the replay and the big-map
 *  executor so a plan built by executing it replays identically. */
function runHeroEntry(state: GameState, step: string, budget: number): { reason: string; steps: number } {
  let steps = 0;
  if (!/^[UDLR]+$/.test(step)) return { reason: `bad hero entry ${step}`, steps };
  const h = state.hero!;
  for (const ch of step) {
    if (!moveHero(state, HERO_DIRS[ch])) return { reason: `${step}: input ${ch} blocked at (${h.x},${h.y})`, steps };
    for (let i = 0; (i < HERO_INPUT_STEPS || !heroSupported(state) || h.falling > 0) && i < 600 && !state.won; i++) {
      stepGame(state);
      steps++;
    }
    if (state.won) return { reason: '', steps };
  }
  const n = simSettle(state, budget);
  steps += n;
  if (n >= budget && !state.won) return { reason: `${step}: slow flow (cap)`, steps };
  return { reason: '', steps };
}

/** Short category of a replay failure reason (for rejection tallies). */
function failKind(reason: string): string {
  for (const k of ['no path', 'blocked', 'frozen', 'stranded', 'diverged', 'cap', 'not won']) if (reason.includes(k)) return k;
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

type Rect = { x: number; y: number; w: number; h: number };

const SMALL: ShapeName[] = ['1x1', '2x1', '1x2'];
const BARS: ShapeName[] = ['3x1', '1x3'];
const SMALL_L: ShapeName[] = ['S', 'S90', 'S180', 'S270'];
const BIG: ShapeName[] = ['L0', 'L90', 'L180', 'L270', 'J0', 'J90', 'J180', 'J270'];

function pickShape(r: Rng, d: number, maxCells: number): ShapeName | null {
  const groups: [ShapeName[], number][] = [
    [SMALL, Math.max(1, 9 - 0.8 * d)],
    [BARS, 0.6 + 0.25 * d],
    [SMALL_L, d >= 3 ? 0.3 + 0.25 * d : 0],
    [['2x2'], d >= 4 ? 0.1 + 0.12 * d : 0],
    [BIG, d >= 5 ? 0.2 * (d - 4) : 0],
  ];
  const ok = groups
    .map(([g, w]) => [g.filter((s) => SHAPES[s].length <= maxCells), w] as [ShapeName[], number])
    .filter(([g, w]) => g.length && w > 0);
  if (!ok.length) return null;
  return pick(r, weighted(r, ok));
}

const sandBoxAt = (level: LevelDef, gx: number, gy: number): number =>
  level.sandBoxes.findIndex((s) => gx >= s.x && gx < s.x + s.w && gy >= s.y && gy < s.y + s.h);

/** True if the box, where it stands, shares an edge with a sand box that holds its color (in the
 *  physics it may pull some of it right away, or as soon as the layers above are gone). */
export function boxTouchesOwnSand(level: LevelDef, b: BoxDef): boolean {
  for (const c of SHAPES[b.shape])
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = sandBoxAt(level, b.x + c.x + dx, b.y + c.y + dy);
      if (k >= 0 && level.sandBoxes[k].layers.some((l) => l.color === b.color)) return true;
    }
  return false;
}

/** True if some sand box holds a layer that is neither its top nor its bottom layer. */
export function hasBuriedLayer(level: LevelDef): boolean {
  return level.sandBoxes.some((s) => makeStack(s.layers).length > 4);
}

function placeSandBoxes(r: Rng, W: number, H: number, n: number, d: number): Rect[] | null {
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    let placed = false;
    for (let t = 0; t < 40 && !placed; t++) {
      // 2-wide sand boxes are the most forgiving; 3-wide ones need a 3-wide box underneath (or
      // two side docks) to empty completely, so they are a little rarer
      const w = weighted(r, [
        [1, 0.8],
        [2, 2.5],
        [3, 0.8 + 0.05 * d],
      ]);
      const h = weighted(r, [
        [1, d <= 2 ? 1 : 0.5],
        [2, 2],
        [3, 0.6 + 0.1 * d],
      ]);
      if (w * h < 2) continue;
      let x = ri(r, 0, W - w);
      // Prefer floating sand boxes with room below (a box underneath catches the bottom layer by
      // gravity: the fast, complete drain) and free sides (side docks drain the top layer); a box
      // on top only gets the brim of a full pile.
      let y = ri(r, 0, Math.max(0, H - h - 2));
      const k = rnd(r);
      if (k < 0.1) x = 0;
      else if (k < 0.2) x = W - w;
      else if (k < 0.3) y = H - h; // on the floor
      if (rects.some((o) => x < o.x + o.w + 1 && o.x < x + w + 1 && y < o.y + o.h + 1 && o.y < y + h + 1)) continue;
      const cand = [...rects, { x, y, w, h }];
      if (!freeConnected(W, H, cand)) continue;
      rects.push({ x, y, w, h });
      placed = true;
    }
    if (!placed) return rects.length ? rects : null;
  }
  return rects;
}

function occupancyOf(W: number, H: number, rects: Rect[]): Uint8Array {
  const g = new Uint8Array(W * H);
  for (const s of rects) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g[y * W + x] = 1;
  return g;
}

function freeConnected(W: number, H: number, rects: Rect[]): boolean {
  const g = occupancyOf(W, H, rects);
  let start = -1;
  let free = 0;
  for (let i = 0; i < W * H; i++) if (!g[i]) (free++, start < 0 && (start = i));
  if (start < 0) return false;
  const seen = new Uint8Array(W * H);
  const q = [start];
  seen[start] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (g[j] || seen[j]) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return q.length === free;
}

/** Splits `total` (integer cells) into `k` multiples of 0.5, each at least one cell (thin layers
 *  barely drain from the side) unless the total is under a cell. */
function splitAmount(r: Rng, total: number, k: number): number[] {
  const halves = Math.round(total * 2);
  k = Math.max(1, Math.min(k, Math.floor(halves / 2)));
  const cuts = new Set<number>();
  for (let t = 0; cuts.size < k - 1 && t < 50; t++) {
    const c = ri(r, 2, halves - 2);
    if ([...cuts].every((o) => Math.abs(o - c) >= 2)) cuts.add(c);
  }
  const pts = [0, ...[...cuts].sort((a, b) => a - b), halves];
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) out.push((pts[i] - pts[i - 1]) / 2);
  return out;
}

/** Merges equal neighbours of a layer list (bottom first). */
function mergeLayers(ls: LayerDef[]): LayerDef[] {
  const out: LayerDef[] = [];
  for (const c of ls) {
    const last = out[out.length - 1];
    if (last && last.color === c.color) last.amount += c.amount;
    else out.push({ ...c });
  }
  return out;
}

function attempt(r: Rng, d: number, p: DifficultyParams, fail: (k: string) => null, shapeD = d): LevelDef | null {
  const W = ri(r, p.widths[0], p.widths[1]);
  const H = ri(r, p.heights[0], p.heights[1]);
  // Sand boxes must be able to hold the sand of the minimum number of boxes.
  const minArea = (p.boxes[0] * (1.4 + 0.1 * d)) / p.maxFill;
  let rects: Rect[] | null = null;
  for (let t = 0; t < 12; t++) {
    rects = placeSandBoxes(r, W, H, ri(r, p.sandBoxes[0], p.sandBoxes[1]), d);
    if (rects && rects.length >= p.sandBoxes[0] && rects.reduce((a, s) => a + s.w * s.h, 0) >= minArea) break;
    rects = null;
  }
  if (!rects) return fail('sandBoxes');

  // --- choose box shapes so the total fits the sand boxes and the free space
  const sandArea = rects.reduce((a, s) => a + s.w * s.h, 0);
  const free = W * H - sandArea;
  const density = p.density[0] + rnd(r) * (p.density[1] - p.density[0]);
  const roomTotal = rects.reduce((a, s) => a + Math.floor(s.w * s.h * p.maxFill * 2) / 2, 0);
  const maxCells = Math.min(Math.floor(roomTotal), Math.floor(free * density));
  const nBoxes = ri(r, p.boxes[0], p.boxes[1]);
  const shapes: ShapeName[] = [];
  let cells = 0;
  for (let i = 0; i < nBoxes; i++) {
    const s = pickShape(r, shapeD, maxCells - cells);
    if (!s) break;
    shapes.push(s);
    cells += SHAPES[s].length;
  }
  if (shapes.length < p.boxes[0]) return fail('tooFewBoxes');

  // --- colors
  const nColors = Math.min(shapes.length, ri(r, p.colors[0], p.colors[1]));
  const palette = shuffle(r, PALETTE.slice()).slice(0, nColors);
  const boxColors = shapes.map((_, i) => (i < nColors ? palette[i] : pick(r, palette)));
  shuffle(r, boxColors);
  const capByColor = new Map<ColorId, number>();
  shapes.forEach((s, i) => capByColor.set(boxColors[i], (capByColor.get(boxColors[i]) ?? 0) + SHAPES[s].length));

  // --- sand layers: split each color into chunks, deal chunks into sand boxes, shuffle order
  const chunks: LayerDef[] = [];
  for (const [color, total] of capByColor) {
    const k = ri(r, 1, Math.min(p.maxSplit, Math.floor(total)));
    for (const amount of splitAmount(r, total, k)) chunks.push({ color, amount });
  }
  shuffle(r, chunks);
  if (chunks.length < rects.length) return fail('tooFewChunks');
  const deal: LayerDef[][] = rects.map(() => []);
  // Every sand box gets one chunk first, then the rest goes where it fits (weighted by room). A
  // chunk that fits nowhere is split (in half-cell steps) across the roomiest sand boxes.
  const capLeft = rects.map((s) => Math.floor(s.w * s.h * p.maxFill * 2) / 2);
  const queue = chunks.slice();
  for (let ci = 0; queue.length; ci++) {
    const c = queue.shift()!;
    let target: number;
    if (ci < rects.length) target = ci;
    else {
      const opts = rects.map((_, k) => [k, capLeft[k] - c.amount] as [number, number]).filter(([, room]) => room >= -1e-9);
      if (opts.length) target = weighted(r, opts.map(([k, room]) => [k, room + 0.5] as [number, number]));
      else target = capLeft.indexOf(Math.max(...capLeft));
    }
    const take = Math.min(c.amount, capLeft[target]);
    if (take < 0.5 - 1e-9) return fail('sandOverflow');
    if (take < c.amount) queue.unshift({ color: c.color, amount: c.amount - take });
    capLeft[target] -= take;
    deal[target].push({ color: c.color, amount: take });
  }
  const sandBoxes: SandBoxDef[] = [];
  for (let k = 0; k < rects.length; k++) {
    // a few orderings: keep the layer count modest
    let layers: LayerDef[] | null = null;
    for (let t = 0; t < 6 && !layers; t++) {
      const ls = mergeLayers(shuffle(r, deal[k].slice()));
      if (ls.length <= p.maxLayers) layers = ls;
    }
    if (!layers) return fail('layers');
    sandBoxes.push({ ...rects[k], layers });
  }

  // --- place boxes (biggest first)
  const level: LevelDef = { id: '', name: '', width: W, height: H, sandBoxes, boxes: [] };
  const occ = occupancyOf(W, H, rects);
  const sbOcc = occupancyOf(W, H, rects);
  const order = shapes.map((s, i) => i).sort((a, b) => SHAPES[shapes[b]].length - SHAPES[shapes[a]].length);
  const placed: BoxDef[] = new Array(shapes.length);
  const origins = new Set<number>();
  const colorAt = new Map<number, ColorId>();
  const N4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const i of order) {
    const shape = shapes[i];
    const { w, h } = shapeBounds(shape);
    const cands: [number, number, number][] = [];
    for (let y = 0; y + h <= H; y++)
      for (let x = 0; x + w <= W; x++) {
        let ok = true;
        let near = 0;
        for (const c of SHAPES[shape]) {
          const gx = x + c.x;
          const gy = y + c.y;
          if (occ[gy * W + gx]) {
            ok = false;
            break;
          }
          for (const [dx, dy] of N4) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && occ[ny * W + nx]) near += sbOcc[ny * W + nx] ? 2 : 1;
          }
        }
        if (!ok || origins.has(y * W + x)) continue; // validateLevel rejects shared origins
        // same-color boxes side by side would exchange sand (conduits) and look like one blob
        if (
          SHAPES[shape].some((c) =>
            N4.some(([dx, dy]) => x + c.x + dx >= 0 && x + c.x + dx < W && colorAt.get((y + c.y + dy) * W + x + c.x + dx) === boxColors[i]),
          )
        )
          continue;
        if (boxTouchesOwnSand(level, { shape, x, y, color: boxColors[i] })) continue;
        cands.push([x, y, near]);
      }
    if (!cands.length) return fail('noBoxSpot');
    let c: [number, number, number];
    if (rnd(r) < p.cluster) {
      const best = Math.max(...cands.map((c) => c[2]));
      c = pick(r, cands.filter((k) => k[2] >= best - 1));
    } else c = pick(r, cands);
    placed[i] = { shape, x: c[0], y: c[1], color: boxColors[i] };
    origins.add(c[1] * W + c[0]);
    for (const cc of SHAPES[shape]) {
      occ[(c[1] + cc.y) * W + c[0] + cc.x] = 1;
      colorAt.set((c[1] + cc.y) * W + c[0] + cc.x, boxColors[i]);
    }
  }
  // Boxes in reading order (y then x) for stable ids.
  level.boxes = placed.sort((a, b) => a.y - b.y || a.x - b.x);

  // --- frozen boxes
  if (p.frozen > 0 && level.boxes.length >= 3) {
    const nf = ri(r, 0, p.frozen);
    const idx = shuffle(
      r,
      level.boxes.map((_, i) => i),
    ).slice(0, nf);
    for (const i of idx) level.boxes[i] = { ...level.boxes[i], frozen: ri(r, 1, Math.min(level.boxes.length - 1, 1 + Math.floor(d / 3))) };
  }
  return level;
}

const PALETTE: ColorId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---------------------------------------------------------------------------------------------
// Box-gravity levels (DESIGN.md "Box gravity"): built from parametrised stations, each a pattern
// the physics handles (see the rules of thumb in src/levels/index.ts):
//   A  shaft + tray: a one-row sand box ("tray", 2-3 one-cell bands) at the foot of a 1-wide shaft
//      against a board edge; only the bottom box of the shaft's stack touches it and drinks the top
//      band, then the stack drops one cell. Walls cover the tray's top and its far end.
//      Variants: 'plug' (the foot box starts frozen), 'pin' (the shaft's boxes start in a stack
//      resting on a 2x1 pin that bridges the shaft and the top of its wall; pulling the pin drops
//      the stack, in whatever order it is in).
//   B  floating sand box (1-2 wide, 1-2 one-row layers) over a wall ledge: a box resting on the
//      ledge catches the bottom layer from below; the next catcher goes on the same ledge. The
//      pin of an A-pin station is caught on a B ledge of its color.
// All remaining boxes start on the floor in a small pile. Colors are unique per band/layer.

export interface GravityParams {
  widths: [number, number];
  heights: [number, number];
  minDrags: number;
  maxDrags: number;
  /** Minimum number of boxes. */
  minBoxes: number;
  greedyMustFail: boolean;
  /** Template names allowed with weights. */
  templates: [string, number][];
}

export function gravityParams(difficulty: number): GravityParams {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const minDrags = [0, 1, 2, 3, 3, 4, 5, 5, 6, 6, 7][d];
  const t: [string, number][] = [
    ['A', d <= 4 ? 3 : d <= 6 ? 1 : 0],
    ['B', d <= 2 ? 2 : d <= 6 ? 0.3 : 0],
    ['A+B', d >= 2 ? (d >= 7 ? 1 : 3) : 0],
    ['Aplug+B', d >= 3 ? (d >= 7 ? 1.5 : 2 + 0.3 * d) : 0],
    ['Apin+Bpin', d >= 3 ? (d >= 7 ? 0.5 : 2 + 0.3 * d) : 0],
    ['A+A', d >= 4 ? 1.5 : 0],
    ['Apin+Bpin+B', d >= 6 ? 2 : 0],
    ['Aplug+B+A', d >= 6 ? 2 : 0],
    ['Apin+Bpin+A', d >= 7 ? 2 : 0],
    // trigger stacks (the headline gravity mechanic): a pre-loaded shaft gated by frozen boxes
    // that thaw as boxes pop elsewhere
    ['Atrig+B', d >= 2 ? (d >= 4 ? 3 : 1.5) : 0],
    ['Atrig+B+B', d >= 4 ? 6 : 0],
    ['Atrig2+B+B', d >= 6 ? 7 : 0],
    ['Atrig2+B+A', d >= 8 ? 3 : 0],
  ];
  return {
    widths: d <= 3 ? [6, 8] : [7, 9],
    heights: d <= 3 ? [8, 9] : [9, 11],
    minDrags,
    maxDrags: minDrags * 2 + 5,
    minBoxes: [0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6][d],
    greedyMustFail: d >= 5,
    templates: t.filter(([, w]) => w > 0),
  };
}

interface GBuild {
  W: number;
  H: number;
  occ: Uint8Array; // 1 = wall / sand box / box
  walls: { x: number; y: number }[];
  sandBoxes: SandBoxDef[];
  boxes: BoxDef[];
  /** Boxes still to place on the floor pile. */
  pile: BoxDef[];
  colors: ColorId[];
  /** Columns the pile must keep clear (shafts). */
  noPile: Set<number>;
  /** Intended solution, by box object: catches (B) first, then each shaft's sequence (A). */
  introB: GIntent[];
  introA: GIntent[];
  /** Trigger stack (foot first), if any. */
  trigger?: BoxDef[];
}
type GIntent = { ref: BoxDef; kind: 'dock' | 'park' } | { ref: BoxDef; kind: 'shaft'; x: number };

function gTake(g: GBuild): ColorId | null {
  return g.colors.length ? g.colors.pop()! : null;
}
function gWall(g: GBuild, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.W || y >= g.H) return false;
  if (g.occ[y * g.W + x]) return false;
  g.occ[y * g.W + x] = 1;
  g.walls.push({ x, y });
  return true;
}
function gFree(g: GBuild, x: number, y: number, w: number, h: number): boolean {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H || g.occ[yy * g.W + xx]) return false;
  return true;
}
function gClaim(g: GBuild, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g.occ[yy * g.W + xx] = 1;
}

/** Station A on the given side. Returns the columns it uses, or null if it does not fit. */
function stationA(r: Rng, g: GBuild, side: 'L' | 'R', variant: '' | 'plug' | 'pin' | 'trig' | 'trig2', bands: number, pinColor: ColorId | null): boolean {
  const { W, H } = g;
  const w = bands; // one cell per band, brim full
  if (w + 3 > W) return false;
  const shaft = side === 'L' ? 0 : W - 1;
  const t0 = side === 'L' ? 1 : W - 1 - w; // tray's left column
  const near = side === 'L' ? t0 : t0 + w - 1; // tray column beside the shaft
  const end = side === 'L' ? t0 + w : t0 - 1; // tray's far end
  if (!gFree(g, Math.min(shaft, t0, end), H - 1, w + 2, 1)) return false;
  const colors: ColorId[] = [];
  for (let i = 0; i < bands; i++) {
    const c = gTake(g);
    if (c === null) return false;
    colors.push(c);
  }
  g.sandBoxes.push({ x: t0, y: H - 1, w, h: 1, layers: colors.map((color) => ({ color, amount: 1 })) });
  gClaim(g, t0, H - 1, w, 1);
  gWall(g, end, H - 1);
  for (let x = t0; x < t0 + w; x++) if (x !== near) gWall(g, x, H - 2);
  // shaft wall: from `top` down to the tray row, over the near tray column
  const stackN = bands; // boxes the shaft must hold at once (one per band)
  let top: number;
  // the pin needs the stack above it (stackN cells) and at least two wall rows below it
  if (variant === 'pin' && stackN > H - 4) return false;
  const pinRow = variant === 'pin' ? ri(r, stackN, H - 4) : 0;
  if (variant === 'pin') top = pinRow + 1;
  else top = ri(r, 1, Math.max(1, H - 3 - stackN));
  for (let y = top; y <= H - 2; y++) if (!gWall(g, near, y)) return false;
  g.noPile.add(shaft);
  // boxes of this station, foot first = top band first (bands are listed bottom first)
  const order = colors.slice().reverse();
  const boxes: BoxDef[] = order.map((color) => ({ shape: '1x1', x: 0, y: 0, color }));
  const drop = (b: BoxDef): GIntent => ({ ref: b, kind: 'shaft', x: shaft });
  if (variant === 'trig' || variant === 'trig2') {
    // trigger stack: the whole sequence stands in the shaft in drain order (foot = top band);
    // the foot box is frozen (counts set later), and with 'trig2' one box higher up too
    boxes.forEach((b, i) => {
      Object.assign(b, { x: shaft, y: H - 1 - i });
      g.boxes.push(b);
      gClaim(g, shaft, H - 1 - i, 1, 1);
    });
    boxes[0].frozen = 1;
    if (variant === 'trig2') {
      if (bands < 2) return false;
      boxes[ri(r, 1, bands - 1)].frozen = 1;
    }
    g.trigger = boxes;
  } else if (variant === 'plug') {
    const plug = Object.assign(boxes[0], { x: shaft, y: H - 1, frozen: 1 });
    g.boxes.push(plug);
    gClaim(g, shaft, H - 1, 1, 1);
    g.pile.push(...boxes.slice(1));
    g.introA.push(...boxes.slice(1).map(drop));
  } else if (variant === 'pin') {
    if (pinColor === null) return false;
    const px = side === 'L' ? shaft : near;
    if (!gFree(g, px, pinRow, 2, 1)) return false;
    const pin: BoxDef = { shape: '2x1', x: px, y: pinRow, color: pinColor };
    g.boxes.push(pin);
    gClaim(g, px, pinRow, 2, 1);
    // pre-built stack in the shaft above the pin, in a random order (bottom first)
    const pre = shuffle(r, boxes.slice());
    let y = pinRow - 1;
    for (const b of pre) {
      Object.assign(b, { x: shaft, y });
      g.boxes.push(b);
      gClaim(g, shaft, y, 1, 1);
      y--;
    }
    if (pre.every((b, i) => b === boxes[i])) g.introA.push({ ref: pin, kind: 'dock' });
    else {
      // unload the stack from the top, pull the pin onto its ledge, then drop in band order
      for (const b of pre.slice().reverse()) g.introA.push({ ref: b, kind: 'park' });
      g.introA.push({ ref: pin, kind: 'dock' });
      g.introA.push(...boxes.map(drop));
    }
  } else {
    g.pile.push(...boxes);
    g.introA.push(...boxes.map(drop));
  }
  return true;
}

/** Station B: floating sand box over a wall ledge (or over the floor). `layers` colors given, or
 *  taken from the pool; `catchers` false when the catcher already exists (an A-pin's pin). */
function stationB(r: Rng, g: GBuild, w: number, layers: ColorId[] | number, catchers = true): boolean {
  const { W, H } = g;
  const cols: ColorId[] = [];
  if (typeof layers === 'number') {
    for (let i = 0; i < layers; i++) {
      const c = gTake(g);
      if (c === null) return false;
      cols.push(c);
    }
  } else cols.push(...layers);
  const h = cols.length;
  for (let t = 0; t < 30; t++) {
    const x = ri(r, 0, W - w);
    const onFloor = rnd(r) < 0.25;
    const ly = onFloor ? H : ri(r, h + 1, H - 3); // ledge row (H = the floor)
    const y = ly - 1 - h; // sand box top
    if (y < 0) continue;
    if (!gFree(g, x, y, w, h + 1)) continue; // sand box + dock row
    if (!onFloor && !gFree(g, x, ly, w, 1)) continue;
    // keep a free cell beside the dock row so a catcher can be carried in
    if (!gFree(g, x - 1, y + h, 1, 1) && !gFree(g, x + w, y + h, 1, 1)) continue;
    if ([...g.noPile].some((c) => c >= x - 1 && c <= x + w)) continue;
    g.sandBoxes.push({ x, y, w, h, layers: cols.map((color) => ({ color, amount: w })) });
    gClaim(g, x, y, w, h);
    if (!onFloor) for (let xx = x; xx < x + w; xx++) gWall(g, xx, ly);
    // catchers, bottom layer first
    if (catchers)
      for (const color of cols) {
        const b: BoxDef = { shape: w === 2 ? '2x1' : '1x1', x: 0, y: 0, color };
        g.pile.push(b);
        g.introB.push({ ref: b, kind: 'dock' });
      }
    return true;
  }
  return false;
}

/** Drops the pile boxes onto the floor in a random order (low stacks, resting, not touching sand). */
function placePile(r: Rng, g: GBuild, level: LevelDef): boolean {
  const { W, H } = g;
  for (const b of shuffle(r, g.pile.slice())) {
    const { w, h } = shapeBounds(b.shape);
    const cands: [number, number][] = [];
    for (let x = 0; x + w <= W; x++) {
      if ([...Array(w).keys()].some((i) => g.noPile.has(x + i))) continue;
      // drop from the lowest free run in these columns: find resting y scanning up from the floor
      for (let y = H - h; y >= Math.max(0, H - 4); y--) {
        if (!gFree(g, x, y, w, h)) continue;
        const rests = y + h >= H || [...Array(w).keys()].some((i) => g.occ[(y + h) * W + x + i]);
        if (!rests) continue;
        const cand = { ...b, x, y };
        if (boxTouchesAnySand(level, cand)) continue;
        cands.push([x, y]);
        break;
      }
    }
    if (!cands.length) return false;
    const [x, y] = pick(r, cands);
    Object.assign(b, { x, y });
    g.boxes.push(b);
    gClaim(g, x, y, w, h);
  }
  return true;
}

/** True if the box shares an edge with any sand box (it would drain or skim right away). */
function boxTouchesAnySand(level: LevelDef, b: BoxDef): boolean {
  for (const c of SHAPES[b.shape])
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (sandBoxAt(level, b.x + c.x + dx, b.y + c.y + dy) >= 0) return true;
  return false;
}

function attemptGravity(r: Rng, d: number, p: GravityParams, fail: (k: string) => null): (LevelDef & { template?: string; intents?: Intent[] }) | null {
  const W = ri(r, p.widths[0], p.widths[1]);
  const H = ri(r, p.heights[0], p.heights[1]);
  const template = weighted(r, p.templates);
  const g: GBuild = {
    W,
    H,
    occ: new Uint8Array(W * H),
    walls: [],
    sandBoxes: [],
    boxes: [],
    pile: [],
    colors: shuffle(r, PALETTE.slice()).slice(0, 6),
    noPile: new Set(),
    introB: [],
    introA: [],
  };
  const level: LevelDef & { template?: string; intents?: Intent[] } = { id: '', name: '', width: W, height: H, boxGravity: true, sandBoxes: g.sandBoxes, boxes: g.boxes, walls: g.walls };
  const side: 'L' | 'R' = rnd(r) < 0.5 ? 'L' : 'R';
  const other = side === 'L' ? 'R' : 'L';
  const bands = () => (d <= 2 ? 2 : ri(r, 2, 3));
  const bw = () => (rnd(r) < 0.6 ? 2 : 1);
  const bl = () => (d <= 2 ? ri(r, 1, 2) : ri(r, 1, 2));
  let ok = true;
  for (const part of template.split('+')) {
    if (!ok) break;
    if (part === 'A') ok = stationA(r, g, g.sandBoxes.some((s) => s.y === H - 1) ? other : side, '', bands(), null);
    else if (part === 'Aplug') ok = stationA(r, g, side, 'plug', bands(), null);
    else if (part === 'Atrig') ok = stationA(r, g, side, 'trig', bands(), null);
    else if (part === 'Atrig2') ok = stationA(r, g, side, 'trig2', 3, null);
    else if (part === 'Apin') {
      const pc = gTake(g);
      ok = pc !== null && stationA(r, g, side, 'pin', bands(), pc) && stationB(r, g, 2, [pc], false); // the pin is its catcher
    } else if (part === 'Bpin') continue; // built with its Apin
    else if (part === 'B') {
      // trigger stations do the work at higher difficulty: two layers (caught in order) when the
      // colors allow
      const want = template.includes('trig') && d >= 5 ? 2 : bl();
      ok = stationB(r, g, bw(), Math.max(1, Math.min(want, g.colors.length)));
    }
  }
  if (!ok) return fail('gStation');
  // a plug thaws after some pops elsewhere (at most the number of boxes not in its shaft)
  const plug = g.boxes.find((b) => b.frozen);
  if (plug) {
    const tray = g.sandBoxes.find((sb) => sb.layers.some((l) => l.color === plug.color))!;
    const elsewhere = [...g.pile, ...g.boxes].filter((b) => !tray.layers.some((l) => l.color === b.color)).length;
    if (elsewhere < 1) return fail('gPlug');
    plug.frozen = ri(r, 1, Math.min(2, elsewhere));
  }
  // trigger stack thaw counts: the foot needs n1 pops elsewhere; a higher plug at stack index k
  // reaches the foot after n1 + k pops, so a count above that makes the stack wait again for
  // more pops elsewhere (when there are enough of them)
  if (g.trigger) {
    const outside = g.pile.length + g.boxes.filter((b) => !g.trigger!.includes(b)).length;
    if (outside < 1) return fail('gTrigger');
    const foot = g.trigger[0];
    const k = g.trigger.findIndex((b, i) => i > 0 && b.frozen);
    const n1 = ri(r, 1, k > 0 ? Math.max(1, outside - 1) : outside);
    foot.frozen = n1;
    if (k > 0) g.trigger[k].frozen = n1 + k < outside + k ? ri(r, n1 + k + 1, outside + k) : outside + k;
  }
  // an optional floor wall stub as an obstacle in the pile area
  if (rnd(r) < 0.4) {
    const x = ri(r, 0, W - 1);
    if (!g.noPile.has(x) && gFree(g, x, H - 1, 1, 1) && sandBoxAt(level, x - 1, H - 1) < 0 && sandBoxAt(level, x + 1, H - 1) < 0) gWall(g, x, H - 1);
  }
  if (g.boxes.length + g.pile.length < p.minBoxes) return fail('gFewBoxes');
  if (!placePile(r, g, level)) return fail('gPile');
  level.boxes = g.boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  level.template = template;
  level.intents = [...g.introB, ...g.introA].map((it) => {
    const box = level.boxes.indexOf(it.ref);
    return it.kind === 'shaft' ? { box, kind: 'shaft' as const, x: it.x } : { box, kind: it.kind };
  });
  return level;
}

// ---------------------------------------------------------------------------------------------
// Hero (Sokoban) levels (DESIGN.md "Hero mode"): boxes are pushed one cell per input by a
// one-cell hero. Floating hero levels reuse the floating layout (sand boxes, conservation) with
// fewer, simpler boxes and corridor walls; gravity hero levels stand on a solid ground with a pit
// (a shaft down to a buried tray) and floating sand boxes right above the walking surface (a box
// pushed under one catches its bottom layer).

export function heroParams(difficulty: number): DifficultyParams {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const base = difficultyParams(d);
  const minDrags = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][d]; // pushes
  return {
    ...base,
    widths: d <= 3 ? [6, 7] : [7, 8],
    heights: d <= 3 ? [7, 8] : [8, 10],
    sandBoxes: d <= 2 ? [1, 1] : d <= 5 ? [1, 2] : [2, 3],
    boxes: [[0, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 4], [3, 4], [3, 4], [3, 4], [4, 4], [4, 5]][d] as [number, number],
    colors: [Math.min(2, base.colors[0]), Math.min(4, base.colors[1])],
    density: [0.06, 0.18],
    frozen: d >= 5 ? 1 : 0,
    minDrags,
    maxDrags: minDrags * 3 + 10,
    greedyMustFail: false,
    cluster: 0,
  };
}

/** Walls in a few short segments on free cells (keeping the free space connected). */
function addCorridorWalls(r: Rng, level: LevelDef, n: number): void {
  const W = level.width;
  const H = level.height;
  const occ = new Uint8Array(W * H);
  const mark = (x: number, y: number) => (occ[y * W + x] = 1);
  for (const sb of level.sandBoxes) for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) mark(x, y);
  for (const b of level.boxes) for (const c of SHAPES[b.shape]) mark(b.x + c.x, b.y + c.y);
  const walls = level.walls ?? (level.walls = []);
  let placed = 0;
  for (let t = 0; t < 60 && placed < n; t++) {
    const len = ri(r, 1, 3);
    const horiz = rnd(r) < 0.5;
    const x0 = ri(r, 0, W - 1);
    const y0 = ri(r, 0, H - 1);
    const cells: [number, number][] = [];
    for (let k = 0; k < len; k++) cells.push(horiz ? [x0 + k, y0] : [x0, y0 + k]);
    if (cells.some(([x, y]) => x >= W || y >= H || occ[y * W + x])) continue;
    // keep the free cells (boxes count as free: they can move) connected
    const rects = [
      ...level.sandBoxes,
      ...walls.map((w) => ({ x: w.x, y: w.y, w: 1, h: 1 })),
      ...cells.map(([x, y]) => ({ x, y, w: 1, h: 1 })),
    ];
    if (!freeConnected(W, H, rects)) continue;
    for (const [x, y] of cells) {
      mark(x, y);
      walls.push({ x, y });
    }
    placed += cells.length;
  }
}

/** A box that cannot move on either axis (blocked on a horizontal and a vertical side by an edge,
 *  wall or sand box) is dead unless it is already docked. */
function boxCornered(level: LevelDef, b: BoxDef): boolean {
  const W = level.width;
  const H = level.height;
  const fixedAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H || sandBoxAt(level, x, y) >= 0 || (level.walls ?? []).some((w) => w.x === x && w.y === y);
  const cs = SHAPES[b.shape].map((c) => [b.x + c.x, b.y + c.y]);
  const blocked = (dx: number, dy: number) => cs.some(([x, y]) => fixedAt(x + dx, y + dy));
  return (blocked(-1, 0) || blocked(1, 0)) && (blocked(0, -1) || blocked(0, 1)) && blocked(-1, 0) !== blocked(1, 0) && blocked(0, -1) !== blocked(0, 1);
}

/** Floating hero levels: can box i alone (the other boxes removed) be pushed by the hero (from
 *  its start) until it touches a sand box holding its color? A cheap necessary condition. */
function heroCanDeliver(level: LevelDef, i: number): boolean {
  const W = level.width;
  const H = level.height;
  const fixed = new Uint8Array(W * H);
  for (const sb of level.sandBoxes) for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) fixed[y * W + x] = 1;
  for (const w of level.walls ?? []) fixed[w.y * W + w.x] = 1;
  const b = level.boxes[i];
  const cells = SHAPES[b.shape];
  const fits = (x: number, y: number) =>
    cells.every((c) => x + c.x >= 0 && y + c.y >= 0 && x + c.x < W && y + c.y < H && !fixed[(y + c.y) * W + x + c.x]);
  const covers = (bx: number, by: number, x: number, y: number) => cells.some((c) => bx + c.x === x && by + c.y === y);
  const goal = (bx: number, by: number) =>
    cells.some((c) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const k = sandBoxAt(level, bx + c.x + dx, by + c.y + dy);
        return k >= 0 && level.sandBoxes[k].layers.some((l) => l.color === b.color);
      }),
    );
  const D: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  // state: box position + hero cell; the hero walks freely around the box
  const seen = new Set<number>();
  const q: [number, number, number, number][] = [[b.x, b.y, level.hero!.x, level.hero!.y]];
  seen.add(((b.y * W + b.x) * H + level.hero!.y) * W + level.hero!.x);
  for (let qi = 0; qi < q.length && qi < 20000; qi++) {
    const [bx, by, hx, hy] = q[qi];
    if (goal(bx, by)) return true;
    for (const [dx, dy] of D) {
      const nx = hx + dx;
      const ny = hy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || fixed[ny * W + nx]) continue;
      let nbx = bx;
      let nby = by;
      if (covers(bx, by, nx, ny)) {
        if (!fits(bx + dx, by + dy)) continue;
        nbx += dx;
        nby += dy;
      }
      const k = ((nby * W + nbx) * H + ny) * W + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push([nbx, nby, nx, ny]);
    }
  }
  return false;
}

function attemptHero(r: Rng, d: number, p: DifficultyParams, fail: (k: string) => null): LevelDef | null {
  const level = attempt(r, d, p, fail, Math.min(d, 3));
  if (!level) return null;
  addCorridorWalls(r, level, ri(r, Math.floor(d / 2), 2 + d));
  if (level.boxes.some((b) => boxCornered(level, b))) return fail('hCorner');
  // hero start: a random free cell
  const W = level.width;
  const free: [number, number][] = [];
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < W; x++)
      if (
        sandBoxAt(level, x, y) < 0 &&
        !(level.walls ?? []).some((w) => w.x === x && w.y === y) &&
        !level.boxes.some((b) => SHAPES[b.shape].some((c) => b.x + c.x === x && b.y + c.y === y))
      )
        free.push([x, y]);
  if (!free.length) return fail('hStart');
  const [hx, hy] = pick(r, free);
  level.hero = { x: hx, y: hy };
  for (let i = 0; i < level.boxes.length; i++) if (!level.boxes[i].frozen && !heroCanDeliver(level, i)) return fail('hReach');
  return level;
}

export function gravityHeroParams(difficulty: number): GravityParams {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const minDrags = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6][d]; // pushes
  const t: [string, number][] = [
    ['HB', d <= 2 ? 2 : 0],
    ['HA', d <= 3 ? 3 : 0],
    ['HA+HB', d >= 2 && d <= 6 ? 3 : 0],
    ['HA+HB+HB', d >= 5 ? 3 : 0],
    ['HAtrig+HB', d >= 3 && d <= 4 ? 4 : 0],
    ['HAtrig+HB+HB', d >= 4 ? 5 : 0],
    ['HAtrig2+HB+HB', d >= 7 ? 6 : 0],
  ];
  return {
    widths: d <= 3 ? [7, 8] : [8, 10],
    heights: [7, 9],
    minDrags,
    maxDrags: minDrags * 3 + 10,
    minBoxes: [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6][d],
    greedyMustFail: false,
    templates: t.filter(([, w]) => w > 0),
  };
}

function attemptGravityHero(
  r: Rng,
  d: number,
  p: GravityParams,
  fail: (k: string) => null,
  fixed?: { W: number; H: number; mirror: boolean; maxCursor: number; heroX: number; trayPool: ColorId[]; otherPool: ColorId[]; bands: number },
): (LevelDef & { template?: string }) | null {
  // Built for a pit on the left edge, mirrored half the time. Row `gy` is the walking surface:
  //   pit | tower (shaft boxes, drain order bottom-up) or a pre-loaded trigger stack in the pit |
  //   hero ... [catcher] _ [dock under a floating sand box] _ [catcher] _ [dock] ...
  // The hero pushes the bottom of the tower into the pit (the tower drops a cell each time it
  // steps back), and pushes each catcher right under its sand box (nearest first, walking under
  // the sand boxes it has done). Optional: a step to climb, a frozen catcher that blocks its dock
  // until enough pops elsewhere (the hero climbs over it meanwhile).
  const W = fixed ? fixed.W : ri(r, p.widths[0], p.widths[1]);
  const H = fixed ? fixed.H : ri(r, p.heights[0], p.heights[1]);
  const template = weighted(r, p.templates);
  const parts = template.split('+');
  const pitDepth = fixed ? 3 : ri(r, 3, 4);
  const gy = H - 1 - pitDepth;
  if (gy < 3) return fail('ghSize');
  // colors: the tray's bands must be unique on the whole board (a band's debris would seal the
  // next band while another box of its color exists); big maps pass pools for that
  const colors = fixed ? shuffle(r, fixed.otherPool.slice()) : shuffle(r, PALETTE.slice()).slice(0, 6);
  const take = () => colors.pop() ?? null;
  const takeBand = () => (fixed ? (fixed.trayPool.pop() ?? null) : take());
  const walls: { x: number; y: number }[] = [];
  const sandBoxes: SandBoxDef[] = [];
  const boxes: BoxDef[] = [];
  const a = parts.find((q) => q.startsWith('HA'));
  let trigger: BoxDef[] | null = null;
  let cursor = 1; // next free surface column
  let bands = 0;
  if (a) {
    bands = fixed ? fixed.bands : d <= 2 ? 2 : ri(r, 2, 3);
    const cs: ColorId[] = [];
    for (let i = 0; i < bands; i++) {
      const c = takeBand();
      if (c === null) return fail('ghColors');
      cs.push(c);
    }
    sandBoxes.push({ x: 1, y: H - 1, w: bands, h: 1, layers: cs.map((color) => ({ color, amount: 1 })) });
    const order: BoxDef[] = cs
      .slice()
      .reverse()
      .map((color) => ({ shape: '1x1', x: 0, y: 0, color }));
    if (a.startsWith('HAtrig')) {
      if (bands > pitDepth) return fail('ghPit');
      order.forEach((b, i) => Object.assign(b, { x: 0, y: H - 1 - i }));
      order[0].frozen = 1;
      if (a === 'HAtrig2' && bands >= 2) order[ri(r, 1, bands - 1)].frozen = 1;
      trigger = order;
    } else {
      if (gy - bands + 1 < 1) return fail('ghTower');
      order.forEach((b, i) => Object.assign(b, { x: 1, y: gy - i })); // the tower, at the pit edge
      cursor = 2;
    }
    boxes.push(...order);
  }
  // ground: everything below the surface is wall except the pit (column 0) and the tray
  for (let y = gy + 1; y < H; y++)
    for (let x = a ? 1 : 0; x < W; x++) {
      if (y === H - 1 && x >= 1 && x <= bands) continue;
      walls.push({ x, y });
    }
  if (!a) for (let y = gy + 1; y < H; y++) walls.push({ x: 0, y }); // no pit: solid ground
  // hero start, then maybe a step
  const hero = { x: fixed ? Math.max(cursor, fixed.heroX) : cursor + ri(r, 0, 1), y: gy };
  cursor = hero.x + 1;
  if (d >= 3 && rnd(r) < 0.5) {
    walls.push({ x: cursor, y: gy });
    cursor += 1;
  }
  // stations: catcher, gap, dock (sand box above it), gap
  const catchers: BoxDef[] = [];
  for (const q of parts) {
    if (q !== 'HB') continue;
    const w = rnd(r) < 0.5 ? 2 : 1;
    const color = take();
    if (color === null) return fail('ghColors');
    const cx = cursor + ri(r, 0, 1);
    const dx = cx + w + 1;
    if (dx + w > W) return fail('ghWidth');
    const catcher: BoxDef = { shape: w === 2 ? '2x1' : '1x1', x: cx, y: gy, color };
    boxes.push(catcher);
    catchers.push(catcher);
    sandBoxes.push({ x: dx, y: gy - 1, w, h: 1, layers: [{ color, amount: w }] });
    cursor = dx + w + 1;
  }
  if (cursor > (fixed ? fixed.maxCursor : W + 1)) return fail('ghWidth');
  if (boxes.length < p.minBoxes) return fail('gFewBoxes');
  // a frozen catcher (not the first) at higher difficulty: it waits for pops elsewhere
  if (d >= 6 && catchers.length >= 2) catchers[ri(r, 1, catchers.length - 1)].frozen = ri(r, 1, Math.max(1, boxes.length - 2));
  if (trigger) {
    const outside = boxes.length - trigger.length;
    if (outside < 1) return fail('gTrigger');
    const k = trigger.findIndex((b, i) => i > 0 && b.frozen);
    const n1 = ri(r, 1, k > 0 ? Math.max(1, outside - 1) : outside);
    trigger[0].frozen = n1;
    if (k > 0) trigger[k].frozen = n1 + k < outside + k ? ri(r, n1 + k + 1, outside + k) : outside + k;
  }
  const level: LevelDef & { template?: string } = {
    id: '',
    name: '',
    width: W,
    height: H,
    boxGravity: true,
    sandBoxes,
    boxes,
    walls,
    hero,
  };
  if (fixed ? fixed.mirror : rnd(r) < 0.5) {
    // mirror: pit on the right edge
    const mx = (x: number, w = 1) => W - x - w;
    for (const sb of sandBoxes) sb.x = mx(sb.x, sb.w);
    for (const b of boxes) b.x = mx(b.x, shapeBounds(b.shape).w);
    for (const w of walls) w.x = mx(w.x);
    hero.x = mx(hero.x);
  }
  level.boxes = boxes.sort((a2, b2) => a2.y - b2.y || a2.x - b2.x);
  if (level.boxes.some((b) => !b.frozen && boxTouchesAnySand(level, b))) return fail('ghTouch');
  level.template = template;
  return level;
}

// ---------------------------------------------------------------------------------------------
// Big maps ("Expedition", DESIGN.md "Big maps"): boards up to 32x16 built from zones side by side
// over a shared hub strip (the bottom 3 rows, where the hero walks):
//   corridor  a long same-color chain under a reservoir (one container once every link touches),
//             interlopers in the line pushed up under their own sand, gaps plugged with spares,
//             the link under the reservoir closed last;
//   rooms     rooms above the hub with frozen door plugs thawed by pops elsewhere; a thawed plug
//             is pushed straight up to its sand; boxes may belong to another room;
//   loop      a belt loop (interval 30) with 1-wide stations over its bottom row and a queue held
//             by a frozen gate; once the gate thaws the loop sorts every box to its station; a
//             spare box may wait to be loaded onto the belt;
//   driver    a driven box pushing a train along a walled lane toward a one-row tray; a frozen
//             plug at the front holds it until enough pops elsewhere, then the tray drains in
//             band order and the train advances by itself;
//   levers    small 1x1 stations in the hub strip whose pops thaw the gates of the first zone.
// Plans are built by EXECUTING the zones' intents in the real simulation: each "deliver box X to
// cell Y" is planned on the live state (single-box Sokoban search, other boxes as obstacles, the
// hero never on a belt) and played through runHeroEntry, so the run is the physics proof itself.

type BigIntent = { kind: 'deliver'; ref: BoxDef; x: number; y: number } | { kind: 'walk'; x: number; y: number } | { kind: 'raw'; entry: string };

interface BigBuild {
  W: number;
  H: number;
  occ: Uint8Array; // fixed cells and boxes
  walls: { x: number; y: number }[];
  sandBoxes: SandBoxDef[];
  boxes: BoxDef[];
  conveyors: ConveyorDef[];
  intents: BigIntent[];
  colors: ColorId[];
  /** Pops the plan has caused so far (frozen counts are set from it). */
  pops: number;
  mechanics: Set<string>;
}

const bTake = (g: BigBuild): ColorId | null => g.colors.pop() ?? null;
function bWall(g: BigBuild, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= g.W || y >= g.H || g.occ[y * g.W + x]) return;
  g.occ[y * g.W + x] = 1;
  g.walls.push({ x, y });
}
function bSand(g: BigBuild, sb: SandBoxDef): void {
  g.sandBoxes.push(sb);
  for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) g.occ[y * g.W + x] = 1;
}
function bBox(g: BigBuild, b: BoxDef): BoxDef {
  g.boxes.push(b);
  for (const c of SHAPES[b.shape]) g.occ[(b.y + c.y) * g.W + b.x + c.x] = 1;
  return b;
}
const bFree = (g: BigBuild, x: number, y: number) => x >= 0 && y >= 0 && x < g.W && y < g.H && !g.occ[y * g.W + x];

/** Lever stations in the hub strip: a 1x1 sand box in the middle row with its dock right below
 *  and the lever box beside the dock. Each delivery is one pop. */
function bLevers(r: Rng, g: BigBuild, x0: number, x1: number, n: number): boolean {
  const H = g.H;
  for (let k = 0; k < n; k++) {
    let ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      const x = ri(r, x0 + 1, x1 - 2);
      const side = rnd(r) < 0.5 ? -1 : 1;
      // sand at (x, H-2), dock (x, H-1); lever starts at (x+2*side, H-1) and is pushed along the
      // bottom row; keep the column above the sand free so the strip stays passable
      const lx = x + 2 * side;
      if (lx < x0 || lx > x1) continue;
      if (![x - 1, x, x + 1].every((c) => bFree(g, c, H - 2) && bFree(g, c, H - 1)) || !bFree(g, lx, H - 1) || !bFree(g, lx + side, H - 1)) continue;
      const color = bTake(g);
      if (color === null) return false;
      bSand(g, { x, y: H - 2, w: 1, h: 1, layers: [{ color, amount: 1 }] });
      const b = bBox(g, { shape: '1x1', x: lx, y: H - 1, color });
      g.intents.push({ kind: 'deliver', ref: b, x, y: H - 1 });
      g.pops++;
      g.mechanics.add('lever');
      ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

/** Corridor chain zone on columns [x0, x1]. */
function zoneCorridor(r: Rng, g: BigBuild, x0: number, x1: number, d: number): boolean {
  const { H } = g;
  const L = H - 4; // the line row; the hub strip below
  const red = bTake(g);
  if (red === null) return false;
  const rw = 3;
  // the line from x0+rw to x1: red pieces, interlopers (k) and gaps (gN)
  const len = x1 - (x0 + rw); // the line ends at x1 - 1; a wall at x1 seals it
  const room = Math.max(1, Math.floor((len - 1) / 3)); // holes fit two apart
  const k = Math.min(1 + Math.floor(d / 3), 3, room);
  const gN = Math.max(0, Math.min(d <= 2 ? 1 : ri(r, 1, 2), room - k));
  const cells: ('R' | 'I' | 'G')[] = [];
  for (let i = 0; i < len; i++) cells.push('R');
  // interlopers and gaps at distinct inner positions, two apart
  const used = new Set<number>();
  const place = (kind: 'I' | 'G') => {
    for (let t = 0; t < 40; t++) {
      const i = ri(r, 1, len - 2);
      if ([i - 1, i, i + 1].some((j) => used.has(j))) continue;
      used.add(i);
      cells[i] = kind;
      return true;
    }
    return false;
  };
  for (let i = 0; i < k; i++) if (!place('I')) return false;
  for (let i = 0; i < gN; i++) if (!place('G')) return false;
  // walls above the line except the reservoir, the interloper stations and their docks
  let redCells = 3 + gN + k; // the catcher and the spares (one per gap and per interloper)
  let x = x0 + rw;
  let run = 0;
  const flush = () => {
    // split a run of reds into 3x1 / 2x1 / 1x1 pieces
    let sx = x - run;
    while (run > 0) {
      const n = run >= 3 && rnd(r) < 0.5 ? 3 : run >= 2 && rnd(r) < 0.6 ? 2 : 1;
      bBox(g, { shape: n === 3 ? '3x1' : n === 2 ? '2x1' : '1x1', x: sx, y: L, color: red });
      redCells += n;
      sx += n;
      run -= n;
    }
  };
  for (let i = 0; i < len; i++, x++) {
    const c = cells[i];
    if (c === 'R') {
      run++;
      continue;
    }
    flush();
    if (c === 'I') {
      const color = bTake(g);
      if (color === null) return false;
      bSand(g, { x, y: L - 2, w: 1, h: 1, layers: [{ color, amount: 1 }] });
      const b = bBox(g, { shape: '1x1', x, y: L, color });
      g.intents.push({ kind: 'deliver', ref: b, x, y: L - 1 });
      g.pops++;
      g.mechanics.add('interloper');
    }
  }
  flush();
  bWall(g, x1, L);
  // reservoir over the dock row (the line row) at x0..x0+rw-1
  const rh = Math.ceil(redCells / rw);
  if (rh > L) return false;
  bSand(g, { x: x0, y: L - rh, w: rw, h: rh, layers: [{ color: red, amount: redCells }] });
  for (let y = 0; y < L; y++)
    for (let xx = x0; xx <= x1; xx++) {
      const station = g.sandBoxes.some((sb) => sb.w === 1 && sb.x === xx && sb.y === L - 2);
      if (station && y === L - 1) continue;
      bWall(g, xx, y);
    }
  // spares in the hub strip (row H-2), apart from each other; the catcher under the dock row
  const spares: BoxDef[] = [];
  for (let i = 0; i < gN + k; i++) {
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const sx = ri(r, x0 + rw + 1, x1 - 1);
      if (![sx - 1, sx, sx + 1].every((c) => bFree(g, c, H - 2)) || !bFree(g, sx, H - 1)) continue;
      spares.push(bBox(g, { shape: '1x1', x: sx, y: H - 2, color: red }));
      ok = true;
    }
    if (!ok) return false;
  }
  const catcher = bBox(g, { shape: '3x1', x: x0, y: L + 1, color: red });
  // fill the gaps, then close the link under the reservoir: the whole line fills as one
  // (an interloper pushed out of the line leaves a hole too)
  // pair holes and spares left to right (a spare never has to pass another)
  const holes: number[] = [];
  for (let i = 0; i < len; i++) if (cells[i] !== 'R') holes.push(x0 + rw + i);
  const bySpareX = spares.slice().sort((p1, p2) => p1.x - p2.x);
  holes.forEach((hx, i) => g.intents.push({ kind: 'deliver', ref: bySpareX[i], x: hx, y: L }));
  g.intents.push({ kind: 'deliver', ref: catcher, x: x0, y: L });
  g.pops += g.boxes.filter((b) => b.color === red).length;
  g.mechanics.add('chain');
  return true;
}

/** Rooms zone: n rooms over the hub, each with a door in its bottom wall; rooms after the first
 *  are plugged by a frozen box thawed by the pops so far. */
function zoneRooms(r: Rng, g: BigBuild, x0: number, x1: number, d: number): boolean {
  const { H } = g;
  const top = 0;
  const bottomWall = H - 4; // the room floor wall row; the hub strip below it
  const n = Math.max(2, Math.min(4, Math.floor((x1 - x0 + 1) / 6)));
  const rw = Math.floor((x1 - x0 + 1 - (n + 1)) / n);
  if (rw < 4 || bottomWall - top < 5) return false;
  const rooms: { x0: number; x1: number; door: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rx0 = x0 + 1 + i * (rw + 1);
    rooms.push({ x0: rx0, x1: rx0 + rw - 1, door: ri(r, rx0 + 1, rx0 + rw - 2) });
  }
  // walls: the separators, the floor row (except doors)
  for (let y = top; y <= bottomWall; y++) {
    bWall(g, x0, y);
    for (const rm of rooms) bWall(g, rm.x1 + 1, y);
  }
  for (let xx = x0; xx <= x1; xx++) if (!rooms.some((rm) => rm.door === xx)) bWall(g, xx, bottomWall);
  // each room: a station in line with its door (sand at the top, dock right below), plus 1-2
  // stations elsewhere in the room with their boxes; some boxes start in the previous room
  const plan: BigIntent[][] = rooms.map(() => []);
  const roomBoxes: { ref: BoxDef; target: number; x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rm = rooms[i];
    const nSt = ri(r, 1, d >= 5 ? 2 : 1);
    for (let k = 0; k < nSt; k++) {
      let ok = false;
      for (let t = 0; t < 40 && !ok; t++) {
        const sx = ri(r, rm.x0, rm.x1);
        const sy = ri(r, top + 1, bottomWall - 3);
        if (sx === rm.door || !bFree(g, sx, sy) || !bFree(g, sx, sy + 1)) continue;
        const color = bTake(g);
        if (color === null) return false;
        bSand(g, { x: sx, y: sy, w: 1, h: 1, layers: [{ color, amount: 1 }] });
        // its box: in this room, or (sometimes) in the room before it
        const home = i > 0 && rnd(r) < 0.4 ? i - 1 : i;
        const hr = rooms[home];
        let placed = false;
        for (let t2 = 0; t2 < 40 && !placed; t2++) {
          const bx2 = ri(r, hr.x0 + 1, hr.x1 - 1);
          const by2 = ri(r, top + 2, bottomWall - 2);
          if (bx2 === hr.door || !bFree(g, bx2, by2)) continue;
          // not next to any sand box, not in a corner
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.sandBoxes.some((q) => bx2 + dx >= q.x && bx2 + dx < q.x + q.w && by2 + dy >= q.y && by2 + dy < q.y + q.h))) continue;
          const b = bBox(g, { shape: '1x1', x: bx2, y: by2, color });
          roomBoxes.push({ ref: b, target: Math.max(i, home), x: sx, y: sy + 1 });
          placed = true;
        }
        if (!placed) return false;
        ok = true;
      }
      if (!ok) return false;
    }
  }
  // door plugs: rooms 1..n-1 (a plug's sand is at the top of its door column)
  const plugs: (BoxDef | null)[] = [null];
  for (let i = 1; i < n; i++) {
    const rm = rooms[i];
    const color = bTake(g);
    if (color === null) return false;
    if (!bFree(g, rm.door, top + 1)) return false;
    bSand(g, { x: rm.door, y: top, w: 1, h: 1, layers: [{ color, amount: 1 }] });
    plugs.push(bBox(g, { shape: '1x1', x: rm.door, y: bottomWall, color, frozen: 1 }));
  }
  // plan: room by room; a plug thaws at the pops so far, then goes straight up to its sand
  for (let i = 0; i < n; i++) {
    const plug = plugs[i];
    if (plug) {
      if (g.pops < 1) return false;
      plug.frozen = g.pops;
      g.intents.push({ kind: 'deliver', ref: plug, x: rooms[i].door, y: top + 1 });
      g.pops++;
    }
    for (const rb of roomBoxes)
      if (rb.target === i) {
        g.intents.push({ kind: 'deliver', ref: rb.ref, x: rb.x, y: rb.y });
        g.pops++;
      }
  }
  void plan;
  g.mechanics.add('rooms');
  if (n > 1) g.mechanics.add('plug');
  return true;
}

/** Belt loop zone: loop ring on [lx0, lx1] x [ly0, ly1 = H-4]; stations over the bottom row; the
 *  queue on the top row held by a frozen gate thawed by the pops so far (plus `extra` lever pops
 *  planned right after). */
function zoneLoop(r: Rng, g: BigBuild, x0: number, x1: number, d: number, extra: number): boolean {
  const { H } = g;
  const ly1 = H - 4;
  const lx0 = x0 + 1;
  const lx1 = Math.min(x1 - 1, lx0 + 6 + ri(r, 0, 6));
  const ly0 = Math.max(1, ly1 - ri(r, 4, 5));
  if (lx1 - lx0 < 6) return false;
  g.conveyors.push(
    { x: lx0, y: ly0, dir: 'right', length: lx1 - lx0, interval: 30 },
    { x: lx1, y: ly0, dir: 'down', length: ly1 - ly0, interval: 30 },
    { x: lx1, y: ly1, dir: 'left', length: lx1 - lx0, interval: 30 },
    { x: lx0, y: ly1, dir: 'up', length: ly1 - ly0, interval: 30 },
  );
  // stations: 1-wide sand boxes standing on the bottom row, 1-2 bands, two cells apart
  const nSt = Math.max(2, Math.min(4, 1 + Math.floor(d / 3)));
  const sxs: number[] = [];
  for (let t = 0; t < 60 && sxs.length < nSt; t++) {
    const sx = ri(r, lx0 + 1, lx1 - 1);
    if (sxs.some((q) => Math.abs(q - sx) < 2)) continue;
    sxs.push(sx);
  }
  if (sxs.length < 2) return false;
  const bandColors: ColorId[] = [];
  for (const sx of sxs) {
    const nb = d >= 5 && rnd(r) < 0.5 ? 2 : 1;
    const cs: ColorId[] = [];
    for (let i = 0; i < nb; i++) {
      const c = bTake(g);
      if (c === null) return false;
      cs.push(c);
    }
    bSand(g, { x: sx, y: ly1 - nb, w: 1, h: nb, layers: cs.map((color) => ({ color, amount: 1 })) });
    bandColors.push(...cs);
  }
  // the loop's interior is wall (except the stations)
  for (let y = ly0 + 1; y < ly1; y++) for (let xx = lx0 + 1; xx < lx1; xx++) bWall(g, xx, y);
  // the queue: gate at the end of the top row, boxes behind it (one per band); maybe one spare
  // waiting above the top row to be loaded
  const colors = shuffle(r, bandColors.slice());
  const loadOne = d >= 3 && colors.length >= 3 && rnd(r) < 0.6;
  const queue = loadOne ? colors.slice(0, -1) : colors;
  if (queue.length > lx1 - lx0) return false;
  const gate = bBox(g, { shape: '1x1', x: lx1 - 1, y: ly0, color: queue[0], frozen: 1 });
  for (let i = 1; i < queue.length; i++) bBox(g, { shape: '1x1', x: lx1 - 1 - i, y: ly0, color: queue[i] });
  if (loadOne) {
    const lx = lx0 + 1;
    if (!bFree(g, lx, ly0) || ly0 < 2) return false;
    const b = bBox(g, { shape: '1x1', x: lx, y: ly0 - 1, color: colors[colors.length - 1] });
    g.intents.push({ kind: 'deliver', ref: b, x: lx, y: ly0 });
    g.mechanics.add('load');
  }
  // the gate thaws at the pops so far plus the levers planned right after this zone
  const thaw = g.pops + extra;
  if (thaw < 1) return false;
  gate.frozen = thaw;
  g.pops += colors.length;
  g.mechanics.add('belt');
  g.mechanics.add('gate');
  return true;
}

/** Driver zone: a walled lane on row H-5 from x0+1 rightwards; a one-row tray at its right end;
 *  the train (front = top band) is pushed by a driven box at the back and held by a frozen plug. */
function zoneDriver(r: Rng, g: BigBuild, x0: number, x1: number, d: number, extra: number): boolean {
  const { H } = g;
  const lr = H - 5;
  const bands = ri(r, 2, 3);
  const tx = x1 - bands; // tray x0 (tray x .. x1-1, end wall at x1)
  const cs: ColorId[] = [];
  for (let i = 0; i < bands; i++) {
    const c = bTake(g);
    if (c === null) return false;
    cs.push(c);
  }
  bSand(g, { x: tx, y: lr, w: bands, h: 1, layers: cs.map((color) => ({ color, amount: 1 })) });
  bWall(g, x1, lr);
  // the train: front = top band (plug, frozen), ..., the driven box at the back (bottom band)
  const order = cs.slice().reverse();
  const front = tx - 1;
  const back = front - (order.length - 1);
  if (back - 1 < x0 + 1) return false;
  order.forEach((color, i) => {
    const b: BoxDef = { shape: '1x1', x: front - i, y: lr, color };
    if (i === 0) b.frozen = 1;
    if (i === order.length - 1) b.force = 'right';
    bBox(g, b);
  });
  // lane walls above and below, from the lane's start to the tray end
  for (let xx = x0 + 1; xx <= x1; xx++) {
    bWall(g, xx, lr - 1);
    bWall(g, xx, lr + 1);
  }
  bWall(g, x0, lr); // the lane's closed start
  const plug = g.boxes.find((b) => b.frozen === 1 && b.y === lr && b.x === front)!;
  const thaw = g.pops + extra;
  if (thaw < 1) return false;
  plug.frozen = thaw;
  g.pops += order.length;
  g.mechanics.add('driver');
  g.mechanics.add('plug');
  return true;
}

export function bigParams(difficulty: number): { W: number; H: number; minPushes: number; templates: [string, number][] } {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const W = [0, 16, 18, 20, 22, 24, 26, 30, 30, 32, 32][d];
  const H = [0, 12, 12, 12, 13, 13, 14, 14, 15, 15, 16][d];
  const minPushes = [0, 6, 8, 10, 12, 15, 18, 20, 24, 26, 30][d];
  const t: [string, number][] = [
    ['corridor', d <= 4 ? 3 : 0],
    ['rooms', d <= 4 ? 2 : 0],
    ['levers+loop', d <= 6 ? 2 : 0],
    ['levers+driver', d <= 6 ? 1.5 : 0],
    ['corridor+loop', d >= 4 ? 3 : 0],
    ['rooms+driver', d >= 4 ? 2 : 0],
    ['corridor+rooms', d >= 5 ? 2 : 0],
    ['rooms+loop+driver', d >= 7 ? 3 : 0],
    ['corridor+loop+driver', d >= 7 ? 3 : 0],
  ];
  return { W, H, minPushes, templates: t.filter(([, w]) => w > 0) };
}

function attemptBig(r: Rng, d: number, fail: (k: string) => null): (LevelDef & { template?: string; bigIntents?: BigIntent[] }) | null {
  const bp = bigParams(d);
  const W = bp.W;
  const H = bp.H;
  const template = weighted(r, bp.templates);
  const zones = template.split('+');
  const g: BigBuild = {
    W,
    H,
    occ: new Uint8Array(W * H),
    walls: [],
    sandBoxes: [],
    boxes: [],
    conveyors: [],
    intents: [],
    colors: shuffle(r, PALETTE.slice()),
    pops: 0,
    mechanics: new Set(),
  };
  // zone widths: split the board (levers take a narrow slice of the hub only)
  const real = zones.filter((z) => z !== 'levers');
  // widths by need, the slack shared out at random
  const need: Record<string, number> = { corridor: 11, rooms: 11, loop: 10, driver: 7 };
  const widths = real.map((z) => need[z]);
  let slack = W - widths.reduce((a2, b2) => a2 + b2, 0);
  if (slack < 0) return fail('xWidth');
  while (slack-- > 0) widths[ri(r, 0, widths.length - 1)]++;
  let x = 0;
  const leverZone = zones.includes('levers');
  for (let zi = 0; zi < real.length; zi++) {
    const z = real[zi];
    const x0 = x;
    const x1 = x + widths[zi] - 1;
    x += widths[zi];
    let ok = false;
    const extra = leverZone && z === real[0] ? ri(r, 1, 2) : 0;
    if (z === 'corridor') ok = zoneCorridor(r, g, x0, x1, d);
    else if (z === 'rooms') ok = zoneRooms(r, g, x0, x1, d);
    else if (z === 'loop') ok = zoneLoop(r, g, x0, x1, d, extra);
    else if (z === 'driver') ok = zoneDriver(r, g, x0, x1, d, extra);
    if (!ok) return fail(`xZone:${z}@${template}`);
    if (extra) {
      // the levers come right after their zone's setup, in the hub strip under it
      const before = g.intents.length;
      const popsBefore = g.pops;
      if (!bLevers(r, g, x0, x1, extra)) return fail('xLevers');
      // levers pop before the zone's own cascade: move them ahead of nothing (they are last)
      void before;
      void popsBefore;
    }
  }
  // the hero: in the hub strip, a free cell
  const spots: number[] = [];
  for (let xx = 0; xx < W; xx++) if (bFree(g, xx, H - 2)) spots.push(xx);
  if (!spots.length) return fail('xHero');
  const hero = { x: pick(r, spots), y: H - 2 };
  const level: LevelDef & { template?: string; bigIntents?: BigIntent[] } = {
    id: '',
    name: '',
    width: W,
    height: H,
    camera: zones.includes('rooms') && zones.length === 1 ? 'rooms' : 'scroll',
    hero,
    sandBoxes: g.sandBoxes,
    boxes: g.boxes.sort((a, b) => a.y - b.y || a.x - b.x),
    walls: g.walls,
    ...(g.conveyors.length ? { conveyors: g.conveyors } : {}),
  };
  if (d >= 5 && g.mechanics.size < 2) return fail('xMechanics');
  level.template = template;
  level.bigIntents = g.intents;
  return level;
}

/** Live-state occupancy for planning: 1 = wall / sand box / box (except `skip`) / hero. */
function liveOcc(state: GameState, skip = -1): Uint8Array {
  const { width: W, height: H } = state;
  const occ = new Uint8Array(W * H);
  for (const w of state.walls) occ[w.y * W + w.x] = 1;
  for (const sb of state.sandBoxes) for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) occ[y * W + x] = 1;
  for (const b of state.boxes) if (b.state === 'active' && b.id !== skip) for (const c of b.cells) occ[(b.y + c.y) * W + b.x + c.x] = 1;
  return occ;
}

function beltCells(state: GameState): Uint8Array {
  const { width: W, height: H } = state;
  const m = new Uint8Array(W * H);
  const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
  for (const cv of state.conveyors ?? []) {
    const [dx, dy] = V[cv.dir];
    for (let i = 0; i <= cv.length; i++) {
      const x = cv.x + dx * i;
      const y = cv.y + dy * i;
      if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
    }
  }
  return m;
}

const D4: [number, number, string][] = [
  [1, 0, 'R'],
  [-1, 0, 'L'],
  [0, 1, 'D'],
  [0, -1, 'U'],
];

/** Hero BFS over free, non-belt cells; returns the input string to each reached cell. */
function heroPaths(W: number, H: number, block: Uint8Array, belts: Uint8Array, hx: number, hy: number): Map<number, string> {
  const out = new Map<number, string>([[hy * W + hx, '']]);
  const q = [hy * W + hx];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const x = c % W;
    const y = (c - x) / W;
    const p = out.get(c)!;
    for (const [dx, dy, ch] of D4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (block[k] || belts[k] || out.has(k)) continue;
      out.set(k, p + ch);
      q.push(k);
    }
  }
  return out;
}

/** Gravity hero walk on the live state (left/right, falls, one-cell climbs; never into a box):
 *  inputs from the hero to (tx, ty), or null. */
function gravityWalk(state: GameState, occ: Uint8Array, tx: number, ty: number): string | null {
  const { width: W, height: H } = state;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !occ[y * W + x];
  const h = state.hero!;
  const out = new Map<number, string>([[h.y * W + h.x, '']]);
  const q = [h.y * W + h.x];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const x = c % W;
    const y = (c - x) / W;
    if (x === tx && y === ty) return out.get(c)!;
    for (const [dx, ch] of [
      [-1, 'L'],
      [1, 'R'],
    ] as const) {
      const nx = x + dx;
      let ny = y;
      if (free(nx, ny)) while (free(nx, ny + 1)) ny++;
      else if (free(nx, ny - 1) && free(x, y - 1) && nx >= 0 && nx < W && !state.boxes.some((b) => b.state === 'active' && b.cells.some((cc) => b.x + cc.x === nx && b.y + cc.y === y))) ny--;
      else continue;
      const k = ny * W + nx;
      if (out.has(k)) continue;
      out.set(k, out.get(c)! + ch);
      q.push(k);
    }
  }
  // the target cell may be mid-air above the drop: accept any cell in that column below it
  for (const [k, p] of out) if (k % W === tx && Math.floor(k / W) >= ty) return p;
  return null;
}

/** Inputs that push box `id` (on the live state) to (tx, ty), or null. Single-box Sokoban search:
 *  the other boxes stay put; on the way the box never touches sand of its own color (no early
 *  drain). */
function planDeliver(state: GameState, id: number, tx: number, ty: number, maxNodes = 6000): string | null {
  const { width: W, height: H } = state;
  const box = state.boxes[id];
  if (box.state !== 'active' || box.frozen > 0) return null;
  const fixed = liveOcc(state, id);
  const belts = beltCells(state);
  // sand boxes holding the box's own color: touching one on the way would start an early drain
  const sand = new Uint8Array(W * H);
  for (const sb of state.sandBoxes) {
    let own = false;
    for (const v of sb.region.cells) if (v && (v & 31) === box.color) own = true;
    if (own) for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) sand[y * W + x] = 1;
  }
  const cells = box.cells;
  const fits = (x: number, y: number) =>
    cells.every((c) => x + c.x >= 0 && y + c.y >= 0 && x + c.x < W && y + c.y < H && !fixed[(y + c.y) * W + x + c.x]);
  const touchesSand = (x: number, y: number) =>
    cells.some((c) => D4.some(([dx, dy]) => {
      const gx = x + c.x + dx;
      const gy = y + c.y + dy;
      return gx >= 0 && gy >= 0 && gx < W && gy < H && sand[gy * W + gx] === 1;
    }));
  type N = { bx: number; by: number; hx: number; hy: number; path: string; prev: N | null };
  const start: N = { bx: box.x, by: box.y, hx: state.hero!.x, hy: state.hero!.y, path: '', prev: null };
  const seen = new Set<number>([((box.y * W + box.x) * H + start.hy) * W + start.hx]);
  const q: N[] = [start];
  for (let qi = 0; qi < q.length && qi < maxNodes; qi++) {
    const n = q[qi];
    if (n.bx === tx && n.by === ty) {
      let s2 = '';
      for (let c: N | null = n; c; c = c.prev) s2 = c.path + s2;
      return s2;
    }
    const block = fixed.slice();
    for (const c of cells) block[(n.by + c.y) * W + n.bx + c.x] = 1;
    const reach = heroPaths(W, H, block, belts, n.hx, n.hy);
    for (const [dx, dy, ch] of D4) {
      const nbx = n.bx + dx;
      const nby = n.by + dy;
      if (!fits(nbx, nby)) continue;
      if (!(nbx === tx && nby === ty) && touchesSand(nbx, nby)) continue;
      // the hero stands behind any box cell whose neighbour against the push is not the box
      for (const c of cells) {
        const hx = n.bx + c.x - dx;
        const hy = n.by + c.y - dy;
        if (cells.some((o) => n.bx + o.x === hx && n.by + o.y === hy)) continue;
        const walk = reach.get(hy * W + hx);
        if (walk === undefined) continue;
        const nhx = n.bx + c.x;
        const nhy = n.by + c.y;
        if (belts[nhy * W + nhx]) continue; // never step onto a belt
        const k = ((nby * W + nbx) * H + nhy) * W + nhx;
        if (seen.has(k)) break;
        seen.add(k);
        q.push({ bx: nbx, by: nby, hx: nhx, hy: nhy, path: walk + ch, prev: n });
        break;
      }
    }
  }
  return null;
}

/** Executes big-map intents in the real simulation. Returns the entries (the solution) if the
 *  level is won. */
function executeBig(level: LevelDef, intents: { box: number; x: number; y: number; walk?: boolean; raw?: string }[]): { won: boolean; path: string[]; steps: number; pushes: number; reason: string } {
  const state = createGame(level, SIM_SEED);
  const caps = levelCaps(level);
  let steps = simSettle(state, caps.plan);
  const path: string[] = [];
  let pushes = 0;
  for (const it of intents) {
    if (state.won) break;
    let entry: string | null;
    if (it.raw) entry = it.raw;
    else if (it.walk) {
      const occ = liveOcc(state);
      entry = state.boxGravity
        ? gravityWalk(state, occ, it.x, it.y)
        : (heroPaths(state.width, state.height, occ, beltCells(state), state.hero!.x, state.hero!.y).get(it.y * state.width + it.x) ?? null);
    } else {
      if (state.boxes[it.box].state !== 'active') continue;
      entry = planDeliver(state, it.box, it.x, it.y);
    }
    if (entry === null) return { won: false, path, steps, pushes, reason: `no plan for box#${it.box} -> (${it.x},${it.y})` };
    if (!entry) continue;
    const before = state.events.length;
    const e = runHeroEntry(state, entry, Math.min(caps.plan - steps, caps.drag));
    for (let i = before; i < state.events.length; i++) if (state.events[i].type === 'heroPushed') pushes++;
    state.events.length = 0;
    steps += e.steps;
    path.push(entry);
    if (e.reason) return { won: false, path, steps, pushes, reason: e.reason };
    if (steps >= caps.plan) return { won: false, path, steps, pushes, reason: 'sim time cap' };
  }
  if (!state.won) steps += simSettle(state, Math.max(1, caps.plan - steps));
  return { won: state.won, path, steps, pushes, reason: state.won ? '' : 'not won' };
}

// ---------------------------------------------------------------------------------------------
// Public API

export interface GenerateOptions {
  difficulty: number;
  /** Box-gravity level (shafts, trays, ledges; DESIGN.md "Box gravity"). Default false. */
  gravity?: boolean;
  /** Hero (Sokoban) level: boxes are pushed by the hero (DESIGN.md "Hero mode"). Default false. */
  hero?: boolean;
  /** Big map (with hero): a board larger than the screen built from zones (DESIGN.md "Big maps"). */
  big?: boolean;
  /** Attempts per difficulty level before falling back to an easier one (default 3000). */
  maxAttempts?: number;
  /** Physics-verified candidate levels per difficulty level before falling back (default 40). */
  maxVerified?: number;
  /** Solver state budget per candidate search (default 3000). */
  maxStates?: number;
  /** Candidate plans replayed in physics per level (default 3). */
  candidates?: number;
  /** If given, rejection reasons (and time spent, as `<reason>Ms`) are tallied here. */
  reasons?: Record<string, number>;
}

export interface GenerateResult {
  level: LevelDef;
  /** Difficulty whose gates the level actually passed (lower than requested after a fallback). */
  difficulty: number;
  attempts: number;
  /** The physics-verified plan (path replays to a win with createGame(level, SIM_SEED)). */
  solution: SolveResult;
  /** Greedy naive player's drag count in the abstract model (-1 = stuck). */
  greedy: number;
  /** Physics replays run for this level (including failed candidates of rejected attempts). */
  replays: number;
  /** Sim steps the accepted plan took. */
  simSteps: number;
  /** Gravity levels: the station template the layout was built from (e.g. 'Apin+Bpin'). */
  template?: string;
}

/** Solver variants that propose candidate plans, most physics-faithful first. */
// (Generous variants, e.g. full side drains of buried layers, were tried: their plans never won
// in the sim, so only faithful and more cautious ones are used.)
const VARIANTS: { model: ModelParams; noise: number }[] = [
  { model: DEFAULT_MODEL, noise: 0 },
  { model: { wedge: 1, pocket: 0.4 }, noise: 0 }, // smaller slope remnants (the sim often does better)
  { model: { wedge: 0, pocket: 1 }, noise: 0 }, // never rely on side wedges of buried layers
  { model: DEFAULT_MODEL, noise: 1 },
];


/** Lazily yields distinct candidate plans with a drag count inside the difficulty's window
 *  (the faithful model first; other variants only if the earlier candidates fail in physics).
 *  Returns a rejection reason when the faithful model finds no plan at all. */
function* candidatePlans(
  level: LevelDef,
  p: { minDrags: number; maxDrags: number },
  maxStates: number,
  k: number,
  seed: number,
  status: { reason: string },
  intents?: Intent[],
): Generator<SolveResult> {
  const seen = new Set<string>();
  let yielded = 0;
  if (intents) {
    const path = scriptedPlan(level, intents);
    if (path && path.length >= p.minDrags && path.length <= p.maxDrags) {
      seen.add(path.join(';'));
      yielded++;
      yield { solved: true, moves: path.length, optimal: false, explored: 0, path };
    }
  }
  let short = false;
  let long = false;
  let defaultEmpty = false;
  for (let vi = 0; vi < VARIANTS.length && yielded < k; vi++) {
    if (defaultEmpty && vi > 1) break;
    const v = VARIANTS[vi];
    const hero = !!level.hero;
    const sols = solveMany(level, {
      maxStates: hero ? Math.max(maxStates, 8000) : maxStates,
      maxExplored: hero ? 1200 : 600,
      model: v.model,
      noise: v.noise ? hash(seed, v.noise) : 0,
      solutions: 2,
    });
    // no plan in the faithful model: only the optimistic variant (index 1) can still find one
    if (!sols.length && vi === 0) {
      defaultEmpty = true;
      continue;
    }
    if (defaultEmpty && !sols.length) break;
    for (const s of sols) {
      if (s.moves < p.minDrags) short = true;
      else if (s.moves > p.maxDrags) long = true;
      else {
        const key = s.path.join(';');
        if (seen.has(key) || yielded >= k) continue;
        seen.add(key);
        yielded++;
        yield s;
      }
    }
    if (vi === 0 && !yielded && sols.length) break; // drag window missed: the variants find similar plans
  }
  if (!yielded) status.reason = short ? 'short' : long ? 'long' : 'unsolved';
}

/** Generates a level and returns it with generation statistics. */
export function generateLevelWithStats(seed: number, opts: number | GenerateOptions): GenerateResult {
  const o: GenerateOptions = typeof opts === 'number' ? { difficulty: opts } : opts;
  const requested = Math.max(1, Math.min(10, Math.round(o.difficulty)));
  const maxAttempts = o.maxAttempts ?? 3000;
  const maxVerified = o.maxVerified ?? 40;
  const maxStates = o.maxStates ?? 3_000;
  const k = o.candidates ?? 3;
  let attempts = 0;
  let replays = 0;
  let curTemplate = '';
  const why = (key: string, t0: number) => {
    if (!o.reasons) return;
    o.reasons[key] = (o.reasons[key] ?? 0) + 1;
    if (curTemplate) o.reasons[`@${curTemplate}:${key}`] = (o.reasons[`@${curTemplate}:${key}`] ?? 0) + 1;
    o.reasons[key + 'Ms'] = Math.round((o.reasons[key + 'Ms'] ?? 0) + performance.now() - t0);
  };
  const gravity = !!o.gravity;
  const heroMode = !!o.hero;
  if (o.big && heroMode) return generateBig(seed, requested, gravity, o, why);
  for (let d = requested; d >= 1; d--) {
    const p = heroMode ? (gravity ? gravityHeroParams(d) : heroParams(d)) : gravity ? gravityParams(d) : difficultyParams(d);
    // the last resort (difficulty 1) gets many more attempts so we always return something
    const cap = d === 1 ? maxAttempts * 10 : maxAttempts;
    const vcap = d === 1 ? maxVerified * 10 : maxVerified;
    let verified = 0;
    for (let a = 0; a < cap && verified < vcap; a++) {
      attempts++;
      curTemplate = '';
      const t0 = o.reasons ? performance.now() : 0;
      const salt = heroMode ? (gravity ? 0x69 : 0x68) : gravity ? 0x67 : 0;
      const r = rngOf(salt ? hash(seed, requested, d, a, salt) : hash(seed, requested, d, a));
      let buildFail = 'build';
      const onFail = (key: string) => ((buildFail = key), null);
      const level = heroMode
        ? gravity
          ? attemptGravityHero(r, d, p as GravityParams, onFail)
          : attemptHero(r, d, p as DifficultyParams, onFail)
        : gravity
          ? attemptGravity(r, d, p as GravityParams, onFail)
          : attempt(r, d, p as DifficultyParams, onFail);
      if (!level) {
        why(buildFail, t0);
        continue;
      }
      const template = (level as { template?: string }).template;
      const intents = (level as { intents?: Intent[] }).intents;
      delete (level as { template?: string }).template;
      delete (level as { intents?: Intent[] }).intents;
      curTemplate = template ?? '';
      const tag = `${requested}${gravity ? 'g' : ''}${heroMode ? 'h' : ''}-${seed}`;
      level.id = `gen-${tag}`;
      level.name = `Random ${tag}`;
      if (validateLevel(level).length) {
        why('invalid', t0);
        continue;
      }
      const greedy = greedySolve(level);
      // trigger stacks are about reading the thaw counts, not search depth: the naive player
      // gate and the drag minimum are relaxed for them
      const trig = !!template?.includes('trig');
      if (p.greedyMustFail && greedy >= 0 && !trig) {
        why('greedy', t0);
        continue;
      }
      if (!p.greedyMustFail && greedy >= 0 && greedy < p.minDrags && !trig) {
        why('greedyShort', t0);
        continue;
      }
      // the proof: replay candidates through the real simulation
      const status = { reason: '' };
      let win: { plan: SolveResult; steps: number } | null = null;
      const fails: string[] = [];
      const window = trig ? { minDrags: Math.min(p.minDrags, d >= 6 ? 3 : 2), maxDrags: p.maxDrags } : p;
      for (const cand of candidatePlans(level, window, maxStates, k, hash(seed, d, a), status, intents)) {
        if (!fails.length) verified++;
        replays++;
        const sim = replayInSim(level, cand.path);
        if (sim.won) {
          win = { plan: { ...cand, path: sim.executed }, steps: sim.steps };
          if (o.reasons) o.reasons['winAt' + fails.length] = (o.reasons['winAt' + fails.length] ?? 0) + 1;
          break;
        }
        fails.push(failKind(sim.reason));
      }
      if (status.reason) {
        why(status.reason, t0);
        continue;
      }
      if (!win) {
        why('physics', t0);
        if (o.reasons) for (const f of fails) o.reasons['physics:' + f] = (o.reasons['physics:' + f] ?? 0) + 1;
        continue;
      }
      why('accepted', t0);
      const hint = makeHint(level);
      if (hint) level.hint = hint;
      const solution: SolveResult = { ...win.plan, moves: win.plan.path.length };
      return { level, difficulty: d, attempts, solution, greedy, replays, simSteps: win.steps, ...(template ? { template } : {}) };
    }
  }
  throw new Error(`generateLevel: no level found for seed ${seed}`);
}

/** Gravity big map ("descent"): gravity-hero floors stacked top to bottom, each its own small
 *  platform puzzle (towers, trigger stacks, catchers under floating sand); the hero walks off the
 *  right end of a floor and drops to the one below (no way back up). Each floor is planned by the
 *  hero solver on its own (from the cell the hero lands on); frozen counts are offset by the pops
 *  of the floors above, so they thaw at the same moment of the run. */
function attemptDescent(r: Rng, d: number, fail: (k: string) => null): (LevelDef & { template?: string; bigIntents?: BigIntent[] }) | null {
  const floors = d <= 3 ? 2 : d <= 6 ? 3 : 4;
  const W = [0, 14, 14, 16, 16, 18, 18, 20, 20, 22, 22][d];
  const Hf = 7;
  const H = floors * Hf;
  const level: LevelDef = { id: '', name: '', width: W, height: H, camera: 'scroll', boxGravity: true, sandBoxes: [], boxes: [], walls: [] };
  const intents: BigIntent[] = [];
  const names: string[] = [];
  let pops = 0;
  let hero: { x: number; y: number } | null = null;
  const fd = Math.max(2, Math.min(5, d - 1)); // per-floor difficulty (difficulty grows with the floor count)
  const gp = gravityHeroParams(fd);
  // tray bands unique over the whole map; catchers draw from the rest (repeatable between floors)
  const bands = floors >= 3 ? 2 : 3;
  const pal = shuffle(r, PALETTE.slice());
  const trayPool = pal.slice(0, Math.min(pal.length - 2, floors * bands));
  const otherPool = pal.slice(trayPool.length);
  for (let k = 0; k < floors; k++) {
    let f: (LevelDef & { template?: string }) | null = null;
    // floors alternate: pit on the left, then on the right; the hero starts two cells in from the
    // pit side (between the tower and the stations), and the floor above drops it right there
    const mirror = k % 2 === 1;
    for (let t = 0; t < 30 && !f; t++) {
      const pool = trayPool.slice();
      f = attemptGravityHero(r, fd, gp, () => null, { W, H: Hf, mirror, maxCursor: W - 4, heroX: 2, trayPool: pool, otherPool, bands });
      if (f) trayPool.length = pool.length; // commit the bands this floor took
    }
    if (!f) return fail('xFloor');
    names.push(f.template ?? '?');
    const gy = Hf - 4; // the floor's walking surface (pit depth 3)
    if (f.hero!.x !== (mirror ? W - 3 : 2)) return fail('xLanding');
    const exitX = mirror ? 2 : W - 3; // over the next floor's hero spot
    const pitX = mirror ? W - 1 : 0;
    f.id = 'floor';
    f.name = 'floor';
    delete f.template;
    // keep the drop column clear on this floor's ground (the hero falls through to the next)
    if (k < floors - 1) f.walls = (f.walls ?? []).filter((w) => !(w.x === exitX && w.y > gy));
    else f.walls = f.walls ?? [];
    const sols = solveMany(f, { maxStates: 8000, maxExplored: 1500, solutions: 1 });
    if (!sols.length) return fail('xFloorUnsolved');
    const dy = k * Hf;
    for (const sb of f.sandBoxes) level.sandBoxes.push({ ...sb, y: sb.y + dy });
    for (const b of f.boxes) level.boxes.push({ ...b, y: b.y + dy, ...(b.frozen ? { frozen: b.frozen + pops } : {}) });
    for (const w of f.walls) level.walls!.push({ x: w.x, y: w.y + dy });
    // close this floor's pit at the bottom (the board floor only closes the last one)
    if (k < floors - 1) level.walls!.push({ x: pitX, y: dy + Hf });
    if (k === 0) hero = { x: f.hero!.x, y: f.hero!.y + dy };
    for (const e of sols[0].path) intents.push({ kind: 'raw', entry: e });
    if (k < floors - 1) intents.push({ kind: 'walk', x: exitX, y: gy + dy }); // walk to the exit and drop
    pops += f.boxes.length;
  }
  // the bottom row of the last floor is the board floor; the floors' bottom rows are their grounds
  level.hero = hero!;
  level.boxes.sort((a2, b2) => a2.y - b2.y || a2.x - b2.x);
  const out = level as LevelDef & { template?: string; bigIntents?: BigIntent[] };
  out.template = `descent(${names.join('/')})`;
  out.bigIntents = intents;
  return out;
}

/** Big maps: build, then execute the zones' intents in the real simulation (the proof). */
function generateBig(
  seed: number,
  requested: number,
  gravity: boolean,
  o: GenerateOptions,
  why: (key: string, t0: number) => void,
): GenerateResult {
  const maxAttempts = o.maxAttempts ?? 400;
  let attempts = 0;
  let replays = 0;
  for (let d = requested; d >= 1; d--) {
    const bp = bigParams(d);
    const cap = d === 1 ? maxAttempts * 5 : maxAttempts;
    for (let a = 0; a < cap; a++) {
      attempts++;
      const t0 = o.reasons ? performance.now() : 0;
      const r = rngOf(hash(seed, requested, d, a, gravity ? 0x7a : 0x78));
      let buildFail = 'build';
      const onFail = (key: string) => ((buildFail = key), null);
      const level = gravity ? attemptDescent(r, d, onFail) : attemptBig(r, d, onFail);
      if (!level) {
        why(buildFail, t0);
        continue;
      }
      const template = level.template;
      const tw = (key: string) => {
        if (o.reasons && template) o.reasons[`@${template}:${key}`] = (o.reasons[`@${template}:${key}`] ?? 0) + 1;
      };
      const bi = level.bigIntents!;
      delete level.template;
      delete level.bigIntents;
      const tag = `${requested}x${gravity ? 'g' : ''}h-${seed}`;
      level.id = `gen-${tag}`;
      level.name = `Random ${tag}`;
      if (validateLevel(level).length) {
        why('invalid', t0);
        tw('invalid');
        continue;
      }
      const intents = bi.map((it) =>
        it.kind === 'raw'
          ? { box: -1, x: 0, y: 0, raw: it.entry }
          : it.kind === 'walk'
            ? { box: -1, x: it.x, y: it.y, walk: true }
            : { box: level.boxes.indexOf(it.ref), x: it.x, y: it.y },
      );
      replays++;
      const run = executeBig(level, intents);
      if (!run.won) {
        why('physics', t0);
        tw('physics');
        if (o.reasons) o.reasons['physics:' + failKind(run.reason)] = (o.reasons['physics:' + failKind(run.reason)] ?? 0) + 1;
        continue;
      }
      // loops and drivers work by themselves: they lower the push minimum
      const auto = (template ?? '').split('+').filter((z) => z === 'loop' || z === 'driver' || z === 'levers').length;
      const floors = gravity ? (level.height / 7) | 0 : 0;
      const minPushes = gravity ? 2 * floors + (d >= 5 ? 2 : 0) : Math.max(4, bp.minPushes - 8 * auto);
      if (run.pushes < minPushes) {
        why('short', t0);
        tw('short');
        continue;
      }
      why('accepted', t0);
      tw('accepted');
      level.hint = bigHint(level);
      const solution: SolveResult = { solved: true, moves: run.pushes, optimal: false, explored: 0, path: run.path };
      return { level, difficulty: d, attempts, solution, greedy: -1, replays, simSteps: run.steps, ...(template ? { template } : {}) };
    }
  }
  throw new Error(`generateLevel: no big level found for seed ${seed}`);
}

function bigHint(level: LevelDef): string {
  const parts: string[] = ['A big map: explore it.'];
  if (level.conveyors?.length) parts.push('The loop sorts its boxes to their stations once its frozen gate thaws.');
  if (level.boxes.some((b) => b.force)) parts.push('A driven box pushes its train into the tray when the frozen plug in front thaws.');
  if (level.boxes.some((b) => b.frozen)) parts.push('Every pop counts down every frozen box, wherever it is.');
  parts.push('Same-color boxes that touch fill as one container.');
  return parts.join(' ');
}

/** Deterministic random level for (seed, difficulty 1..10), proven solvable by a physics replay
 *  of its solution (generateLevelWithStats(...).solution) with createGame(level, SIM_SEED). */
export function generateLevel(seed: number, opts: number | GenerateOptions): LevelDef {
  return generateLevelWithStats(seed, opts).level;
}

function makeHint(level: LevelDef): string | undefined {
  const frozen = level.boxes.some((b) => b.frozen);
  if (level.hero) {
    const parts = ['Walk into a box to push it; it moves away from you.'];
    if (level.boxGravity) parts.push('You fall and climb one step. Push boxes off the edge into the pit in band order, or under a sand box to catch.');
    else parts.push('A box under a sand box catches the bottom layer; beside it, the layer at its height.');
    if (frozen) parts.push('Frozen boxes are walls until enough boxes pop.');
    return parts.join(' ');
  }
  if (level.boxGravity) {
    const tray = level.sandBoxes.some((sb) => sb.h === 1 && sb.y === level.height - 1 && sb.layers.length > 1);
    const parts = ['Boxes fall here.'];
    const H = level.height;
    const trigger = level.boxes.some(
      (b) => b.frozen && b.y === H - 1 && level.sandBoxes.some((sb) => sb.h === 1 && sb.y === H - 1 && (sb.x === b.x + 1 || sb.x + sb.w === b.x)),
    );
    if (trigger) {
      parts.push('The shaft is already loaded in order. Its ice blocks hold the stack: pop boxes elsewhere to thaw them, and the stack drains in stages.');
      return parts.join(' ');
    }
    if (tray) parts.push('Only the bottom box of a shaft touches its tray and drinks the top band: load the shaft in band order.');
    else parts.push('Rest a box on the ledge right under a sand box to catch its bottom layer.');
    if (frozen) parts.push('Ice thaws after the shown number of pops.');
    return parts.join(' ');
  }
  const buried = hasBuriedLayer(level);
  if (frozen && buried) return 'Ice thaws after the shown number of pops. Sand flows into boxes underneath or beside it.';
  if (frozen) return 'Ice thaws after the shown number of pops.';
  if (buried) return 'Sand only flows into a box it can fall or slide into: underneath for the bottom layer, beside a layer at its height.';
  return undefined;
}

/** Date-based seed (local date as YYYYMMDD), the same for everyone on a given day. */
export function generateDailySeed(date: Date = new Date()): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

const LETTERS: Record<number, string> = { 1: 'R', 2: 'O', 3: 'Y', 4: 'G', 5: 'T', 6: 'B', 7: 'I', 8: 'P', 9: 'K', 10: 'N', 11: 'W', 12: 'X' };

/** ASCII map for debugging: a header line (`<id> WxH`, plus `gravity` / `hero` flags), then the
 *  board: '#' sand box (digits when several), '=' wall, '^ v < >' belt, '@' hero, capital letter = box color,
 *  lower-case = frozen box (counter listed below), '.' empty. Sand box layers are listed
 *  bottom-first. */
export function describeLevel(level: LevelDef): string {
  const g: string[][] = Array.from({ length: level.height }, () => new Array(level.width).fill('.'));
  for (const w of level.walls ?? []) if (g[w.y]?.[w.x] !== undefined) g[w.y][w.x] = '=';
  // belts: an arrow on each empty belt cell (boxes drawn over them)
  const ARROW = { up: '^', down: 'v', left: '<', right: '>' } as const;
  const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
  for (const cv of level.conveyors ?? [])
    for (let i = 0; i < cv.length; i++) {
      const x = cv.x + V[cv.dir][0] * i;
      const y = cv.y + V[cv.dir][1] * i;
      if (g[y]?.[x] !== undefined) g[y][x] = ARROW[cv.dir];
    }
  level.sandBoxes.forEach((s, k) => {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g[y][x] = level.sandBoxes.length > 1 ? String(k + 1) : '#';
  });
  for (const b of level.boxes) {
    const ch = LETTERS[b.color] ?? '?';
    for (const c of SHAPES[b.shape]) g[b.y + c.y][b.x + c.x] = b.frozen ? ch.toLowerCase() : ch;
  }
  if (level.hero && g[level.hero.y]?.[level.hero.x] !== undefined) g[level.hero.y][level.hero.x] = '@';
  const lines = [`${level.id || 'level'} ${level.width}x${level.height}${level.boxGravity ? ' gravity' : ''}${level.hero ? ' hero' : ''}`, ...g.map((row) => row.join(' '))];
  level.sandBoxes.forEach((s, k) => {
    const ls = s.layers.map((l) => `${LETTERS[l.color] ?? '?'}${l.amount}`).join(' ');
    lines.push(`sand ${level.sandBoxes.length > 1 ? k + 1 : '#'} ${s.w}x${s.h} @${s.x},${s.y}: ${ls} (bottom first)`);
  });
  const fz = level.boxes.filter((b) => b.frozen);
  if (fz.length) lines.push('frozen: ' + fz.map((b) => `${b.shape}@${b.x},${b.y}=${b.frozen}`).join(' '));
  return lines.join('\n');
}
