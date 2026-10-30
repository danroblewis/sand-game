// Procedural level generator. Rejection sampling over random layouts: each attempt builds a level
// whose sand is derived from the box capacities (so conservation holds by construction), checks
// it with validateLevel and the greedy "naive player" difficulty gate, asks the heuristic solver
// (solver.ts) for a few candidate plans, and then PROVES the level by replaying candidates through
// the real simulation (createGame + stepGame with a per-drag settle loop). The first candidate that
// wins in physics becomes the level's solution; if none does, the level is rejected.
// Everything is driven by a seeded RNG with a derived sub-seed per attempt and the simulation runs
// with a fixed seed (SIM_SEED), so generateLevel(seed, difficulty) is deterministic.
import type { Box, BoxDef, ColorId, GameState, LayerDef, LevelDef, SandBoxDef, ShapeName } from '../core/types';
import { SHAPES, shapeBounds } from '../core/shapes';
import { canPlace, createGame, gameSpace, stepGame, tryMoveBox } from '../core';
import { validateLevel } from './validate';
import { DEFAULT_MODEL, greedySolve, makeStack, solveMany, type ModelParams, type SolveResult } from './solver';

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
  const sp = gameSpace(state);
  for (const s of sp.slots) if (!s.quiet) return false;
  for (const p of sp.pullers) if (!p.idle && p.box.region.count < p.box.region.capacity) return false;
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
    for (const b of state.boxes) if (b.state === 'active') total += b.region.count;
    if (total === last) {
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
  const cap = opts.maxSteps ?? PLAN_STEP_CAP;
  let steps = simSettle(state, cap);
  const executed: string[] = [];
  const moved = path.map((step) => {
    const m = /box#(\d+) -> /.exec(step);
    return m ? +m[1] : -1;
  });
  for (let si = 0; si < path.length; si++) {
    const step = path[si];
    const m = /box#(\d+) -> \((\d+),(\d+)\)/.exec(step);
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
      const lim = Math.min(cap - steps, DRAG_STEP_CAP);
      const n = simSettle(state, lim);
      steps += n;
      if (n >= lim && !state.won) return { won: false, reason: `${step}: slow flow (cap)`, steps, executed };
    }
    opts.onStep?.(step, state);
    if (state.won) break;
    if (steps >= cap) return { won: false, reason: 'sim time cap', steps, executed };
    // early bail: a box that will never move again and cannot fill where it stands
    const stuck = strandedBox(state, new Set(moved.slice(si + 1)));
    if (stuck >= 0) return { won: false, reason: `stranded box#${stuck} after ${step}`, steps, executed };
  }
  if (!state.won) steps += simSettle(state, cap - steps);
  if (state.won) return { won: true, reason: '', steps, executed };
  const active = state.boxes
    .filter((b) => b.state === 'active')
    .map((b) => `${b.shape}c${b.color}${b.frozen ? 'F' + b.frozen : ''}=${b.region.count}/${b.region.capacity}`);
  return { won: false, reason: `not won; active=[${active.join(' ')}]`, steps, executed };
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

function attempt(r: Rng, d: number, p: DifficultyParams, fail: (k: string) => null): LevelDef | null {
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
    const s = pickShape(r, d, maxCells - cells);
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
// Public API

export interface GenerateOptions {
  difficulty: number;
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
  p: DifficultyParams,
  maxStates: number,
  k: number,
  seed: number,
  status: { reason: string },
): Generator<SolveResult> {
  const seen = new Set<string>();
  let yielded = 0;
  let short = false;
  let long = false;
  let defaultEmpty = false;
  for (let vi = 0; vi < VARIANTS.length && yielded < k; vi++) {
    if (defaultEmpty && vi > 1) break;
    const v = VARIANTS[vi];
    const sols = solveMany(level, { maxStates, maxExplored: 600, model: v.model, noise: v.noise ? hash(seed, v.noise) : 0, solutions: 2 });
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
  const why = (key: string, t0: number) => {
    if (!o.reasons) return;
    o.reasons[key] = (o.reasons[key] ?? 0) + 1;
    o.reasons[key + 'Ms'] = Math.round((o.reasons[key + 'Ms'] ?? 0) + performance.now() - t0);
  };
  for (let d = requested; d >= 1; d--) {
    const p = difficultyParams(d);
    // the last resort (difficulty 1) gets many more attempts so we always return something
    const cap = d === 1 ? maxAttempts * 10 : maxAttempts;
    const vcap = d === 1 ? maxVerified * 10 : maxVerified;
    let verified = 0;
    for (let a = 0; a < cap && verified < vcap; a++) {
      attempts++;
      const t0 = o.reasons ? performance.now() : 0;
      const r = rngOf(hash(seed, requested, d, a));
      let buildFail = 'build';
      const level = attempt(r, d, p, (key) => ((buildFail = key), null));
      if (!level) {
        why(buildFail, t0);
        continue;
      }
      level.id = `gen-${requested}-${seed}`;
      level.name = `Random ${requested}-${seed}`;
      if (validateLevel(level).length) {
        why('invalid', t0);
        continue;
      }
      const greedy = greedySolve(level);
      if (p.greedyMustFail && greedy >= 0) {
        why('greedy', t0);
        continue;
      }
      if (!p.greedyMustFail && greedy >= 0 && greedy < p.minDrags) {
        why('greedyShort', t0);
        continue;
      }
      // the proof: replay candidates through the real simulation
      const status = { reason: '' };
      let win: { plan: SolveResult; steps: number } | null = null;
      const fails: string[] = [];
      for (const cand of candidatePlans(level, p, maxStates, k, hash(seed, d, a), status)) {
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
      return { level, difficulty: d, attempts, solution, greedy, replays, simSteps: win.steps };
    }
  }
  throw new Error(`generateLevel: no level found for seed ${seed}`);
}

/** Deterministic random level for (seed, difficulty 1..10), proven solvable by a physics replay
 *  of its solution (generateLevelWithStats(...).solution) with createGame(level, SIM_SEED). */
export function generateLevel(seed: number, opts: number | GenerateOptions): LevelDef {
  return generateLevelWithStats(seed, opts).level;
}

function makeHint(level: LevelDef): string | undefined {
  const frozen = level.boxes.some((b) => b.frozen);
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

/** ASCII map for debugging: '#' sand box (digits when several), capital letter = box color,
 *  lower-case = frozen box (counter listed below), '.' empty. Sand box layers are listed
 *  bottom-first. */
export function describeLevel(level: LevelDef): string {
  const g: string[][] = Array.from({ length: level.height }, () => new Array(level.width).fill('.'));
  level.sandBoxes.forEach((s, k) => {
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) g[y][x] = level.sandBoxes.length > 1 ? String(k + 1) : '#';
  });
  for (const b of level.boxes) {
    const ch = LETTERS[b.color] ?? '?';
    for (const c of SHAPES[b.shape]) g[b.y + c.y][b.x + c.x] = b.frozen ? ch.toLowerCase() : ch;
  }
  const lines = g.map((row) => row.join(' '));
  level.sandBoxes.forEach((s, k) => {
    const ls = s.layers.map((l) => `${LETTERS[l.color] ?? '?'}${l.amount}`).join(' ');
    lines.push(`sand ${level.sandBoxes.length > 1 ? k + 1 : '#'} ${s.w}x${s.h} @${s.x},${s.y}: ${ls} (bottom first)`);
  });
  const fz = level.boxes.filter((b) => b.frozen);
  if (fz.length) lines.push('frozen: ' + fz.map((b) => `${b.shape}@${b.x},${b.y}=${b.frozen}`).join(' '));
  return lines.join('\n');
}
