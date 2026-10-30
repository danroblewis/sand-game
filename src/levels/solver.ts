// Heuristic plan finder for the falling-sand physics (DESIGN.md "Sand mechanics"). It is NOT a
// proof: levels are proven by replaying a plan through the real simulation (generate.ts
// replayInSim). The solver only proposes candidate plans, so its model is a simple, slightly
// optimistic approximation of what the simulation does:
//
//   - sand is a stack of flat layers; a layer of `amount` cells in a sand box `w` cells wide is
//     amount*N/w fine rows thick (N = GRAINS_PER_CELL), stacked from the floor;
//   - a box pulls matching grains only within pullReach() fine cells of its opening (a few
//     grains: a nudge), everything else is gravity / sliding / slumping across the shared edge:
//   - TOP opening (box sits on the sand box): drains the top layer only within pullReach() of the
//     sand box's top edge (i.e. only while the pile is brim-full);
//   - SIDE opening: the TOP layer flows out down to the opening's lower edge if it reaches the
//     opening's height (or just touches its top edge) by edge flow; a layer extending above the
//     opening leaves a small slope remnant (~0.14 cells) against the far wall (an opening on the
//     other side gets it); a BURIED layer at the opening's
//     height gives up only a wedge (~0.38 cells per grid row of overlap^1.7) before the layers
//     above cave in and bury the rest (the layer is then marked CAVED: no more side drain until
//     it is the top layer again);
//   Calibration: `npx vite-node scripts/generate.ts --calibrate` prints sim vs model per probe.
//   - boxes complete within COMPLETION_SLACK grains of full; once a color's boxes are all done,
//     its leftover grains are debris and are dropped from the stacks;
//   - BOTTOM opening (box below the sand box): the bottom layer falls in by gravity; a box that
//     covers only some of the sand box's columns gets those columns plus a little from the rest
//     (the remnant is marked STRANDED for bottom openings);
//   - drained layers thin, layers above drop, empty layers vanish (and equal neighbours merge).
// Box-to-box conduits are not modelled; moves that would put two same-color boxes edge to edge
// while one of them holds sand are pruned.
import type { LevelDef } from '../core/types';
import { GRAINS_PER_CELL, GRAINS_PER_UNIT } from '../core/types';
import { SHAPES } from '../core/shapes';
import { COMPLETION_SLACK, pullReach } from '../core/constants';

const N = GRAINS_PER_CELL;
const U = GRAINS_PER_UNIT;

/** One opening between a box and a sand box. Heights are in grains measured from the sand box
 *  floor (a fine row of a sand box `w` cells wide holds w*N grains).
 *  - top: the pull reaches the pile down to height `lo` (default 0 = everything);
 *  - side: the opening spans pile heights [lo, hi) and the pull reaches `reach` below `lo`;
 *    a slope remnant scaled by `pocket` stays against the far wall;
 *  - bottom: `frac` (default 1) of the bottom layer falls into the box. */
export type Opening =
  | { kind: 'top'; lo?: number }
  | { kind: 'bottom'; frac?: number }
  | { kind: 'side'; lo: number; hi: number; reach?: number; rowGrains?: number; pocket?: number; dir?: -1 | 1 };
// side.pocket: scale of the slope remnant (ModelParams.pocket)

/** Layer stack, bottom first, flat: [color|flags, grains, ...]. */
export type LayerStack = number[];

const COLOR = 0x1f;
/** A buried layer that already gave its wedge to a side opening (the layers above caved in). */
export const CAVED = 0x20;
/** A top layer drained from the right side, leaving its slope remnant against the left wall. */
export const POCKET_L = 0x40;
/** A top layer drained from the left side, leaving its slope remnant against the right wall. */
export const POCKET_R = 0x100;
/** A bottom layer drained by a box covering only some columns (the rest is stranded). */
export const STRANDED = 0x80;
/** A layer disturbed by a cave-in or a partial drain below it: some of its grains got mixed into
 *  the layer underneath, so when it is drained to the end a residue stays behind, buried under
 *  that layer (it comes back when that layer is gone). */
export const MIXED = 0x200;
/** Internal drainable() marker: move the residue of a MIXED layer under the layer below. */
const BURY = 0x10000;
/** Residue of a MIXED layer drained to the end (sim: 0.03..0.1 cells). */
const MIX_RESIDUE = Math.round(0.08 * U);
/** Slope remnant of a top layer that extends above the side opening draining it. */
const SIDE_REMNANT = Math.round(0.14 * U);
/** Share of a MIXED top layer a side opening gets (sim: 0.42..0.44, and 0 from the far side). */
const MIXED_SIDE = 0.4;

/** Model tuning (scales of the physics-calibrated estimates). */
export interface ModelParams {
  /** Scale of the buried-layer side wedge (0 = side openings never drain buried layers). */
  wedge: number;
  /** Scale of the pocket a side-drained top layer leaves behind. */
  pocket: number;
}
export const DEFAULT_MODEL: ModelParams = { wedge: 1, pocket: 1 };

/** Builds a merged layer stack (grains) from layer definitions. */
export function makeStack(layers: { color: number; amount: number }[]): LayerStack {
  const out: LayerStack = [];
  for (const l of layers) {
    const g = Math.round(l.amount * U);
    if (g <= 0) continue;
    if (out.length && out[out.length - 2] === l.color) out[out.length - 1] += g;
    else out.push(l.color, g);
  }
  return out;
}

/** Top opening of a sand box `w` x `h` (grid cells): only the top pullReach() fine rows. */
export function topOpening(w: number, h: number): Opening {
  return { kind: 'top', lo: Math.max(0, h * N - pullReach()) * w * N };
}

/** Bottom opening of a sand box `w` wide whose bottom row has `covered` columns above the box
 *  (sim: 2 of 3 columns get ~0.8 of the bottom layer, 1 of 2 ~0.72, an edge 1 of 3 ~0.42). */
export function bottomOpening(w: number, covered: number): Opening {
  if (covered >= w) return { kind: 'bottom', frac: 1 };
  const f = ((covered + 0.3 * (w - covered)) / w) * (w - covered >= 2 ? 0.85 : 1);
  return { kind: 'bottom', frac: f };
}

/** Side opening covering sand-box grid rows [rowMin, rowMax] (0 = top row) of a sand box with
 *  `h` grid rows and `w` grid columns. `dir` is the direction from the box to the sand box (+1:
 *  the box is on the sand box's left). */
export function sideOpening(
  w: number,
  h: number,
  rowMin: number,
  rowMax: number,
  model: ModelParams = DEFAULT_MODEL,
  dir: -1 | 1 = 1,
): Opening {
  const rowGrains = w * N; // grains per fine row (= fine columns)
  return {
    kind: 'side',
    lo: Math.max(0, h - 1 - rowMax) * N * rowGrains,
    hi: (h - rowMin) * N * rowGrains,
    reach: pullReach() * rowGrains,
    rowGrains,
    pocket: model.pocket,
    dir,
  };
}

/** Grains a side opening drains from a buried layer whose overlap with the opening is `grains`
 *  (in a sand box with `rowGrains` grains per fine row) before the layers above cave in
 *  (calibrated against the sim: ~0.38 cells per grid row of overlap^1.7). */
export function sideWedge(grains: number, rowGrains: number, scale = 1): number {
  const rows = grains / (rowGrains * N); // thickness in grid rows
  return Math.round(0.38 * Math.pow(rows, 1.7) * U * scale);
}

/** Removes every layer of `color` (debris once its boxes are all complete); merges neighbours. */
function stripColor(stack: LayerStack, color: number): void {
  for (let i = 0; i < stack.length; ) {
    if ((stack[i] & COLOR) !== color) {
      i += 2;
      continue;
    }
    stack.splice(i, 2);
    if (i > 0 && i < stack.length && (stack[i - 2] & COLOR) === (stack[i] & COLOR)) {
      stack[i - 2] &= stack[i];
      stack[i - 1] += stack[i + 1];
      stack.splice(i, 2);
    }
  }
}

function stackHas(stack: LayerStack, color: number): boolean {
  for (let i = 0; i < stack.length; i += 2) if ((stack[i] & COLOR) === color) return true;
  return false;
}

/** Finds a drainable layer of `color` for one opening: [layer index, grains, flag to set] or null. */
function drainable(stack: LayerStack, op: Opening, color: number, model: ModelParams): [number, number, number] | null {
  const hit = drainable0(stack, op, color, model);
  if (!hit) return null;
  const [i, amt, flag] = hit;
  const c = stack[2 * i];
  // a disturbed layer drained to the end leaves a residue mixed into the layer below
  if (c & MIXED && i > 0 && amt >= stack[2 * i + 1] && model.pocket > 0) {
    const res = Math.round(MIX_RESIDUE * model.pocket);
    return amt - res > 0 ? [i, amt - res, flag | BURY] : null;
  }
  return hit;
}

function drainable0(stack: LayerStack, op: Opening, color: number, model: ModelParams): [number, number, number] | null {
  const n = stack.length / 2;
  if (!n) return null;
  const topC = stack[2 * n - 2];
  if (op.kind === 'top') {
    if ((topC & COLOR) !== color) return null;
    let total = 0;
    for (let i = 1; i < stack.length; i += 2) total += stack[i];
    const g = stack[2 * n - 1];
    const amt = Math.min(g, total - (op.lo ?? 0));
    if (amt <= 0) return null;
    if (amt < g) return [n - 1, amt, 0];
    return [n - 1, g, 0];
  }
  if (op.kind === 'bottom') {
    if ((stack[0] & COLOR) !== color || stack[0] & STRANDED) return null;
    const f = op.frac ?? 1;
    if (f >= 1) return [0, stack[1], 0];
    const amt = Math.floor(stack[1] * f);
    return amt > 0 ? [0, amt, STRANDED] : null;
  }
  const rowGrains = op.rowGrains ?? 1;
  // Slope remnants piled against the far wall (left by earlier drains through this side) do not
  // cover the layer below near this opening: the opening sees through them.
  const mineFlag = op.dir === -1 ? POCKET_L : POCKET_R;
  let effTop = n - 1;
  while (effTop > 0 && stack[2 * effTop] & mineFlag && (stack[2 * effTop] & COLOR) !== color) effTop--;
  let base = 0;
  for (let i = 0; i <= effTop; i++) {
    const c = stack[2 * i];
    const g = stack[2 * i + 1];
    const top = base + g;
    if ((c & COLOR) === color) {
      if (i === effTop) {
        // top layer: reachable through the air above the pile
        if (op.hi < base) return null; // (touching the layer's base is enough: it falls into the gap)
        // (the few cells of pull reach below the opening's lower edge deliver next to nothing)
        const floor = Math.max(base, op.lo);
        if (top <= floor) return null;
        // The slope remnant lies against the far wall. dir -1 = the box is right of the sand box,
        // so the remnant is at the left wall; an opening at that wall later gets it.
        const mine = op.dir === -1 ? POCKET_L : POCKET_R;
        const near = op.dir === -1 ? POCKET_R : POCKET_L;
        // a disturbed layer (it sank into a cave-in / partial drain below) no longer lies flat:
        // the sim delivers only ~40% of it to a side opening, then stalls
        if (c & MIXED) {
          if (c & mine) return null;
          const part = Math.round((top - floor) * MIXED_SIDE);
          return part > 0 ? [i, part, mine] : null;
        }
        if (c & near) return [i, top - floor, 0];
        if (c & mine) return null;
        // edge flow drains a layer the opening covers completely; one that extends above the
        // opening leaves ~0.14 cells sloped against the far wall (sim, any width)
        const slope = top <= op.hi ? 0 : Math.round(SIDE_REMNANT * (op.pocket ?? 1));
        const amt = top - floor - slope;
        return amt > 0 ? [i, amt, mine] : null;
      }
      const overlap = Math.min(top, op.hi) - Math.max(base, op.lo);
      if (!(c & CAVED) && overlap > 0 && model.wedge > 0) {
        const amt = Math.min(g, sideWedge(overlap, rowGrains, model.wedge));
        if (amt > 0) return [i, amt, CAVED];
      }
    }
    base = top;
  }
  return null;
}

/** Drains up to `need` grains of `color` through the given openings (mutates `stack`). Returns
 *  the grains taken. */
export function drainStack(
  stack: LayerStack,
  openings: Opening[],
  color: number,
  need: number,
  model: ModelParams = DEFAULT_MODEL,
  stats?: { layers: number },
): number {
  let taken = 0;
  while (need > 0) {
    let hit: [number, number, number] | null = null;
    for (const op of openings) {
      hit = drainable(stack, op, color, model);
      if (hit) break;
    }
    if (!hit) break;
    const [i, amt, flag] = hit;
    const t = Math.min(amt, need);
    stack[2 * i + 1] -= t;
    const full = t === amt;
    // a pocket only forms when the layer was drained down to it
    if (flag & (POCKET_L | POCKET_R) ? full : true) stack[2 * i] |= flag & ~BURY;
    // cave-ins and partial bottom drains disturb every layer above
    if (flag & (CAVED | STRANDED)) for (let j = i + 1; 2 * j < stack.length; j++) stack[2 * j] |= MIXED;
    taken += t;
    if (stats) stats.layers++;
    need -= t;
    if (flag & BURY && full && stack[2 * i + 1] > 0) {
      // the residue ends up under the layer below (merging with a same-color layer under that)
      const c = stack[2 * i] & ~(MIXED | POCKET_L | POCKET_R);
      const g = stack[2 * i + 1];
      stack.splice(2 * i, 2);
      if (i >= 2 && (stack[2 * i - 4] & COLOR) === (c & COLOR)) stack[2 * i - 3] += g;
      else stack.splice(2 * i - 2, 0, c, g);
      // the layer now on top of the residue may merge with whatever is above it
      for (let j = 0; 2 * j + 2 < stack.length; j++)
        if ((stack[2 * j] & COLOR) === (stack[2 * j + 2] & COLOR)) {
          stack[2 * j] &= stack[2 * j + 2];
          stack[2 * j + 1] += stack[2 * j + 3];
          stack.splice(2 * j + 2, 2);
          j--;
        }
      continue;
    }
    if (stack[2 * i + 1] <= 0) {
      stack.splice(2 * i, 2);
      // merge neighbours that now touch (the merged layer keeps only the flags both had)
      if (i > 0 && 2 * i < stack.length && (stack[2 * i - 2] & COLOR) === (stack[2 * i] & COLOR)) {
        stack[2 * i - 2] &= stack[2 * i];
        stack[2 * i - 1] += stack[2 * i + 1];
        stack.splice(2 * i, 2);
      }
    }
  }
  return taken;
}

/** True if any grain of `color` is drainable through the openings. */
export function canDrain(stack: LayerStack, openings: Opening[], color: number, model: ModelParams = DEFAULT_MODEL): boolean {
  return openings.some((op) => !!drainable(stack, op, color, model));
}

export interface SolveResult {
  solved: boolean;
  /** Number of drags in the found solution. */
  moves: number;
  /** True when the search space was exhausted (an unsolved result is then a model "no"). */
  optimal: boolean;
  explored: number;
  /** Human-readable step list: "box#i -> (x,y)". */
  path: string[];
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface S {
  xs: number[];
  ys: number[];
  alive: boolean[];
  fill: number[];
  sand: LayerStack[]; // per sand box
  done: number;
  /** Hero position (hero levels; -1 otherwise). */
  hx: number;
  hy: number;
}

/** A hero macro-move: walk (free) to the cell behind a box, then one push input. */
interface HeroMove {
  /** Inputs (U/D/L/R): the walk, then the push. */
  keys: string;
  box: number;
  dx: number;
  dy: number;
  /** Hero cell the push starts from. */
  fx: number;
  fy: number;
}

/** Openings between a box (shape cells at x, y) and each sand box it shares an edge with. */
export function boxOpenings(
  level: LevelDef,
  cells: readonly { x: number; y: number }[],
  x: number,
  y: number,
  model: ModelParams = DEFAULT_MODEL,
  sbGrid?: Int8Array,
): [number, Opening[]][] {
  const W = level.width;
  const H = level.height;
  const at = (gx: number, gy: number): number => {
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
    if (sbGrid) return sbGrid[gy * W + gx];
    return level.sandBoxes.findIndex((s) => gx >= s.x && gx < s.x + s.w && gy >= s.y && gy < s.y + s.h);
  };
  const acc = new Map<number, { top: Set<number>; bottom: Set<number>; sides: Map<number, [number, number]> }>();
  for (const c of cells) {
    for (const [dx, dy] of DIRS) {
      const nx = x + c.x + dx;
      const ny = y + c.y + dy;
      const k = at(nx, ny);
      if (k < 0) continue;
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { top: new Set(), bottom: new Set(), sides: new Map() }));
      if (dy === 1) a.top.add(nx - level.sandBoxes[k].x); // sand box cell below the box cell: box sits on top
      else if (dy === -1) a.bottom.add(nx);
      else {
        const r = ny - level.sandBoxes[k].y;
        const cur = a.sides.get(dx);
        a.sides.set(dx, cur ? [Math.min(cur[0], r), Math.max(cur[1], r)] : [r, r]);
      }
    }
  }
  return [...acc].map(([k, a]) => {
    const sbd = level.sandBoxes[k];
    const ops: Opening[] = [];
    if (a.bottom.size) ops.push(bottomOpening(sbd.w, a.bottom.size));
    if (a.top.size) ops.push(topOpening(sbd.w, sbd.h));
    for (const [dx, [r0, r1]] of a.sides) ops.push(sideOpening(sbd.w, sbd.h, r0, r1, model, dx as -1 | 1));
    return [k, ops] as [number, Opening[]];
  });
}

function makeModel(level: LevelDef, model: ModelParams = DEFAULT_MODEL) {
  const W = level.width;
  const H = level.height;
  const nb = level.boxes.length;
  const cells = level.boxes.map((b) => SHAPES[b.shape]);
  const cap = cells.map((c) => c.length * U);
  const color = level.boxes.map((b) => b.color);
  const frozen = level.boxes.map((b) => b.frozen ?? 0);

  const sbGrid = new Int8Array(W * H).fill(-1);
  level.sandBoxes.forEach((sb, i) => {
    for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) sbGrid[y * W + x] = i;
  });
  // fixed obstacles: sand boxes and wall tiles
  const fixed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (sbGrid[i] >= 0) fixed[i] = 1;
  for (const w of level.walls ?? []) if (w.x >= 0 && w.y >= 0 && w.x < W && w.y < H) fixed[w.y * W + w.x] = 1;
  const gravity = !!level.boxGravity;
  const bottom = cells.map((cs) => Math.max(...cs.map((c) => c.y)));

  const init: S = {
    xs: level.boxes.map((b) => b.x),
    ys: level.boxes.map((b) => b.y),
    alive: level.boxes.map(() => true),
    fill: level.boxes.map(() => 0),
    sand: level.sandBoxes.map((sb) => makeStack(sb.layers)),
    done: 0,
    hx: level.hero ? level.hero.x : -1,
    hy: level.hero ? level.hero.y : -1,
  };
  const hero = !!level.hero;

  const thawed = (s: S, i: number) => frozen[i] - s.done <= 0;

  const adjCache = new Map<number, [number, Opening[]][]>();
  function openingsAt(i: number, x: number, y: number): [number, Opening[]][] {
    const ck = (i * 64 + x + 8) * 64 + y + 8;
    let adj = adjCache.get(ck);
    if (!adj) adjCache.set(ck, (adj = boxOpenings(level, cells[i], x, y, model, sbGrid)));
    return adj;
  }

  /** Settles all dockings. Returns '' or a reason the state is pruned ('conduit'). */
  /** Box gravity: every live box (frozen too) that can move down falls, bottom-up so stacks fall
   *  together, until all are supported. */
  function fall(s: S): void {
    const g = occupancy(s, -1);
    const order = [];
    for (let i = 0; i < nb; i++) if (s.alive[i]) order.push(i);
    for (let moved = true; moved; ) {
      moved = false;
      // the hero falls too (after the boxes); boxes never fall into the hero's cell
      if (hero && s.hy + 1 < H && !g[(s.hy + 1) * W + s.hx]) {
        g[s.hy * W + s.hx] = 0;
        s.hy++;
        g[s.hy * W + s.hx] = 1;
        moved = true;
      }
      order.sort((a, b) => s.ys[b] + bottom[b] - (s.ys[a] + bottom[a]) || a - b);
      for (const i of order) {
        let ok = true;
        for (const c of cells[i]) {
          const gx = s.xs[i] + c.x;
          const gy = s.ys[i] + c.y + 1;
          if (gy >= H) ok = false;
          // a cell below that is another of this box's own cells is fine
          else if (g[gy * W + gx] && !cells[i].some((o) => o.x === c.x && o.y === c.y + 1)) ok = false;
          if (!ok) break;
        }
        if (!ok) continue;
        for (const c of cells[i]) g[(s.ys[i] + c.y) * W + s.xs[i] + c.x] = 0;
        s.ys[i]++;
        for (const c of cells[i]) g[(s.ys[i] + c.y) * W + s.xs[i] + c.x] = 1;
        moved = true;
      }
    }
  }

  /** Settles everything after a move: boxes fall (gravity), dockings drain, completed boxes pop
   *  (which may drop the boxes above them onto new dockings), until nothing changes. */
  function settle(s: S): string {
    for (;;) {
      if (gravity) fall(s);
      const before = s.done;
      drainAll(s);
      if (!gravity || s.done === before) break;
    }
    return conduit(s) ? 'conduit' : '';
  }

  function drainAll(s: S): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < nb; i++) {
        if (!s.alive[i] || !thawed(s, i)) continue;
        for (const [k, ops] of openingsAt(i, s.xs[i], s.ys[i])) {
          const need = cap[i] - s.fill[i];
          if (need <= 0) break;
          const t = drainStack(s.sand[k], ops, color[i], need, model);
          if (t > 0) {
            s.fill[i] += t;
            changed = true;
          }
        }
        if (s.fill[i] >= cap[i] - COMPLETION_SLACK) {
          s.alive[i] = false;
          s.done++;
          changed = true;
          // the last box of a color is done: what is left of that color is debris
          if (!s.alive.some((al, j) => al && color[j] === color[i])) for (const st of s.sand) stripColor(st, color[i]);
        }
      }
    }
  }

  /** Two live, thawed same-color boxes share an edge while one of them holds sand (the real sim
   *  moves sand between them by gravity / slumping). */
  function conduit(s: S): boolean {
    for (let i = 0; i < nb; i++) {
      if (!s.alive[i] || !thawed(s, i)) continue;
      for (let j = i + 1; j < nb; j++) {
        if (!s.alive[j] || !thawed(s, j) || color[j] !== color[i]) continue;
        if (s.fill[i] === 0 && s.fill[j] === 0) continue;
        for (const a of cells[i])
          for (const b of cells[j])
            if (Math.abs(s.xs[i] + a.x - s.xs[j] - b.x) + Math.abs(s.ys[i] + a.y - s.ys[j] - b.y) === 1) return true;
      }
    }
    return false;
  }

  const key = (s: S) => {
    let k = '';
    for (let i = 0; i < nb; i++) k += s.alive[i] ? String.fromCharCode(48 + s.xs[i] * 16 + s.ys[i]) + s.fill[i] + ',' : '-';
    k += '|' + s.sand.map((a) => a.join(',')).join('/');
    if (!hero) return k;
    // floating hero levels: the hero's whole walkable region is one state (classic Sokoban
    // normalisation); under gravity walking is one-way (falls), so the exact cell counts
    if (gravity) return k + '@' + (s.hy * W + s.hx);
    const reach = heroWalk(s);
    let m = Infinity;
    for (const c of reach.keys()) if (c < m) m = c;
    return k + '@' + m;
  };

  /** Cells the hero can occupy (no box is pushed on the way) → the inputs that get it there. */
  function heroWalk(s: S): Map<number, string> {
    const g = occupancy(s, -1);
    g[s.hy * W + s.hx] = 0;
    const out = new Map<number, string>([[s.hy * W + s.hx, '']]);
    const q = [s.hy * W + s.hx];
    const dirs: [number, number, string][] = gravity
      ? [
          [-1, 0, 'L'],
          [1, 0, 'R'],
        ]
      : [
          [-1, 0, 'L'],
          [1, 0, 'R'],
          [0, -1, 'U'],
          [0, 1, 'D'],
        ];
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !g[y * W + x];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const x = c % W;
      const y = (c - x) / W;
      const path = out.get(c)!;
      for (const [dx, dy, ch] of dirs) {
        const tx = x + dx;
        let ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        if (free(tx, ty)) {
          if (gravity) while (free(tx, ty + 1)) ty++; // walks off an edge: falls
        } else {
          // into a box that would move: that is a push, not a walk
          const b = boxAt(s, tx, ty);
          if (b >= 0 && thawed(s, b) && canShift(s, b, dx, dy)) continue;
          // gravity: climb one cell onto the obstacle
          if (!(gravity && free(tx, ty - 1) && free(x, y - 1))) continue;
          ty--;
        }
        const k = ty * W + tx;
        if (out.has(k)) continue;
        out.set(k, path + ch);
        q.push(k);
      }
    }
    return out;
  }

  /** Index of the live box covering (x, y), or -1. */
  function boxAt(s: S, x: number, y: number): number {
    for (let i = 0; i < nb; i++) {
      if (!s.alive[i]) continue;
      for (const c of cells[i]) if (s.xs[i] + c.x === x && s.ys[i] + c.y === y) return i;
    }
    return -1;
  }

  /** Box i can move one cell by (dx, dy) (the hero's own cell does not count). */
  function canShift(s: S, i: number, dx: number, dy: number): boolean {
    const g = occupancy(s, i);
    if (s.hx >= 0) g[s.hy * W + s.hx] = 0;
    for (const c of cells[i]) {
      const gx = s.xs[i] + c.x + dx;
      const gy = s.ys[i] + c.y + dy;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H || g[gy * W + gx]) return false;
    }
    return true;
  }

  /** All push macro-moves from state s. */
  function heroMoves(s: S): HeroMove[] {
    const walk = heroWalk(s);
    const out: HeroMove[] = [];
    const dirs: [number, number, string][] = gravity
      ? [
          [-1, 0, 'L'],
          [1, 0, 'R'],
        ]
      : [
          [-1, 0, 'L'],
          [1, 0, 'R'],
          [0, -1, 'U'],
          [0, 1, 'D'],
        ];
    for (const [c, path] of walk) {
      const x = c % W;
      const y = (c - x) / W;
      for (const [dx, dy, ch] of dirs) {
        const b = boxAt(s, x + dx, y + dy);
        if (b < 0 || !thawed(s, b)) continue;
        const t = { ...s, hx: x, hy: y };
        if (!canShift(t, b, dx, dy)) continue;
        out.push({ keys: path + ch, box: b, dx, dy, fx: x, fy: y });
      }
    }
    // gravity: the hero holds up whatever stands on it; stepping away (one input) lets it drop
    if (gravity && s.hy > 0 && boxAt(s, s.hx, s.hy - 1) >= 0)
      for (const [c, path] of walk)
        if (path.length === 1) out.push({ keys: path, box: -1, dx: 0, dy: 0, fx: c % W, fy: (c - (c % W)) / W });
    return out;
  }

  /** Applies a push (box moves, hero steps into its old cell); call settle() after. */
  function applyPush(s: S, m: HeroMove): void {
    if (m.box < 0) {
      s.hx = m.fx;
      s.hy = m.fy;
      return;
    }
    s.xs[m.box] += m.dx;
    s.ys[m.box] += m.dy;
    s.hx = m.fx + m.dx;
    s.hy = m.fy + m.dy;
  }

  function occupancy(s: S, skip: number): Uint8Array {
    const g = fixed.slice();
    for (let i = 0; i < nb; i++) {
      if (!s.alive[i] || i === skip) continue;
      for (const c of cells[i]) g[(s.ys[i] + c.y) * W + s.xs[i] + c.x] = 1;
    }
    if (hero && s.hx >= 0) g[s.hy * W + s.hx] = 1;
    return g;
  }

  function reachable(s: S, i: number): [number, number][] {
    const g = occupancy(s, i);
    const fits = (x: number, y: number) => {
      for (const c of cells[i]) {
        const gx = x + c.x;
        const gy = y + c.y;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H || g[gy * W + gx]) return false;
      }
      return true;
    };
    const seen = new Uint8Array(W * H);
    seen[s.ys[i] * W + s.xs[i]] = 1;
    const q: [number, number][] = [[s.xs[i], s.ys[i]]];
    const out: [number, number][] = [];
    for (let qi = 0; qi < q.length; qi++) {
      const [x, y] = q[qi];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const id = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[id] || !fits(nx, ny)) continue;
        seen[id] = 1;
        q.push([nx, ny]);
        out.push([nx, ny]);
      }
    }
    if (!gravity) return out;
    // under gravity the box is carried along any free path and released: it ends where it lands
    const rest = new Set<number>();
    const useful: [number, number][] = [];
    const park: [number, number, number][] = [];
    const fixedFits = (x: number, y: number) => {
      for (const c of cells[i]) {
        const gx = x + c.x;
        const gy = y + c.y;
        if (gx < 0 || gy < 0 || gx >= W || gy >= H || fixed[gy * W + gx]) return false;
      }
      return true;
    };
    for (const [x0, y0] of out) {
      let y = y0;
      while (fits(x0, y + 1)) y++;
      const k = y * W + x0;
      if (rest.has(k) || (x0 === s.xs[i] && y === s.ys[i])) continue;
      rest.add(k);
      // useful: drains now; lands on another box (a stack: it drops on when that one goes); or
      // would fall into contact with its own sand once the boxes below it are gone
      let onBox = false;
      for (const c of cells[i]) {
        const gy = y + c.y + 1;
        if (gy < H && g[gy * W + x0 + c.x] && !fixed[gy * W + x0 + c.x]) onBox = true;
      }
      let yf = y;
      while (fixedFits(x0, yf + 1)) yf++;
      if (touchesOwnSand(s, i, x0, y) || onBox || touchesOwnSand(s, i, x0, yf)) useful.push([x0, y]);
      else {
        // parking: keep a few spots far from every sand box (they cannot interfere)
        let dmin = 99;
        for (const sb of level.sandBoxes) {
          const dx = Math.max(sb.x - x0, 0, x0 - (sb.x + sb.w - 1));
          const dy = Math.max(sb.y - y, 0, y - (sb.y + sb.h - 1));
          dmin = Math.min(dmin, dx + dy);
        }
        park.push([x0, y, dmin]);
      }
    }
    park.sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of park.slice(0, 3)) useful.push([x, y]);
    return useful;
  }

  const clone = (s: S): S => ({
    xs: s.xs.slice(),
    ys: s.ys.slice(),
    alive: s.alive.slice(),
    fill: s.fill.slice(),
    sand: s.sand.map((a) => a.slice()),
    done: s.done,
    hx: s.hx,
    hy: s.hy,
  });

  const initRisk = settle(init);

  /** True if box i at (x,y) could drain some of its color from an adjacent sand box. */
  function touchesOwnSand(s: S, i: number, x: number, y: number): boolean {
    return openingsAt(i, x, y).some(([k, ops]) => canDrain(s.sand[k], ops, color[i], model));
  }

  /** True if box i at (x,y) is docked to a sand box that holds its color at all. */
  function dockedToOwnColor(s: S, i: number, x: number, y: number): boolean {
    return openingsAt(i, x, y).some(([k]) => stackHas(s.sand[k], color[i]));
  }

  /** True if box i at (x,y) shares an edge with any sand box. */
  function dockedAnySand(i: number, x: number, y: number): boolean {
    return openingsAt(i, x, y).length > 0;
  }

  /** Box i is blocked by fixed cells (edge, wall, sand box) on a horizontal and a vertical side. */
  function cornered(s: S, i: number): boolean {
    const blocked = (dx: number, dy: number) =>
      cells[i].some((c) => {
        const x = s.xs[i] + c.x + dx;
        const y = s.ys[i] + c.y + dy;
        return x < 0 || y < 0 || x >= W || y >= H || fixed[y * W + x] === 1;
      });
    return (blocked(-1, 0) || blocked(1, 0)) && (blocked(0, -1) || blocked(0, 1));
  }

  return { init, initRisk, nb, settle, key, reachable, clone, thawed, touchesOwnSand, dockedToOwnColor, openingsAt, dockedAnySand, hero, heroMoves, applyPush, cornered, gravity };
}

/** One step of a scripted plan (box gravity): `dock` = carry the box to where it drains its own
 *  sand right away (e.g. a ledge under a sand box); `shaft` = drop it down column `x` (it lands on
 *  whatever is there); `park` = put it out of the way. */
export type Intent = { box: number; kind: 'dock' | 'park' } | { box: number; kind: 'shaft'; x: number };

/** Turns intents into a concrete plan in the abstract model (each target is one the box can
 *  reach; the model settles after every move). Returns null if an intent cannot be carried out
 *  (box gone or frozen, no such target). The plan is a candidate only: replay it in physics. */
export function scriptedPlan(level: LevelDef, intents: Intent[], model: ModelParams = DEFAULT_MODEL): string[] | null {
  const m = makeModel(level, model);
  const s = m.clone(m.init);
  const path: string[] = [];
  for (const it of intents) {
    const i = it.box;
    if (!s.alive[i]) continue; // already done (fed by a drop)
    if (!m.thawed(s, i)) return null;
    const targets = m.reachable(s, i);
    let t: [number, number] | undefined;
    if (it.kind === 'dock') {
      // the docking that gets the most done (e.g. full coverage under a sand box)
      let best = -1;
      for (const [x, y] of targets) {
        if (!m.touchesOwnSand(s, i, x, y)) continue;
        const c = m.clone(s);
        c.xs[i] = x;
        c.ys[i] = y;
        if (m.settle(c)) continue;
        const score = c.done * 1e6 + (c.alive[i] ? c.fill[i] : 1e5);
        if (score > best) {
          best = score;
          t = [x, y];
        }
      }
    }
    else if (it.kind === 'shaft') t = targets.filter(([x]) => x === it.x).sort((a, b) => b[1] - a[1])[0];
    else {
      // the free spot farthest from every sand box
      let best = -1;
      for (const [x, y] of targets) {
        if (m.dockedAnySand(i, x, y)) continue;
        let dmin = 99;
        for (const sb of level.sandBoxes)
          dmin = Math.min(dmin, Math.max(sb.x - x, 0, x - (sb.x + sb.w - 1)) + Math.max(sb.y - y, 0, y - (sb.y + sb.h - 1)));
        if (dmin > best) {
          best = dmin;
          t = [x, y];
        }
      }
    }
    if (!t) return null;
    s.xs[i] = t[0];
    s.ys[i] = t[1];
    if (m.settle(s)) return null;
    path.push(`box#${i} -> (${t[0]},${t[1]})`);
  }
  return s.done === m.nb ? path : null;
}

/** Abstract-model snapshot passed to modelTrace's callback (fill in grains). */
export interface ModelState {
  xs: number[];
  ys: number[];
  alive: boolean[];
  fill: number[];
  /** Per sand box: flat layer stack [color|flags, grains, ...], bottom first. */
  sand: LayerStack[];
  done: number;
}

/** Replays a plan (`box#i -> (x,y)` steps) in the abstract model; `onStep` sees the state after
 *  each move. Returns true if the model ends with every box complete. */
export function modelTrace(
  level: LevelDef,
  path: string[],
  onStep?: (step: string, s: ModelState) => void,
  model: ModelParams = DEFAULT_MODEL,
): boolean {
  const m = makeModel(level, model);
  const s = m.clone(m.init);
  for (const step of path) {
    const r = /box#(\d+) -> \((-?\d+),(-?\d+)\)/.exec(step);
    if (!r) return false;
    s.xs[+r[1]] = +r[2];
    s.ys[+r[1]] = +r[3];
    m.settle(s);
    onStep?.(step, s);
  }
  return s.done === m.nb;
}

export interface SolveOptions {
  /** Breadth-first (fewest drags) first, falling back to best-first. */
  optimal?: boolean;
  maxStates?: number;
  /** Also give up after expanding this many states (default: unlimited). Solvable generated
   *  levels are typically solved within a few hundred expansions. */
  maxExplored?: number;
  model?: ModelParams;
  /** Seed for random tie-breaking in best-first search (0 = deterministic, no noise). */
  noise?: number;
  /** Collect up to this many distinct solutions (best-first only; default 1). */
  solutions?: number;
}

/** Finds a plan. With `optimal`, runs breadth-first (fewest drags) and falls back to a
 *  best-first search if the state budget runs out; otherwise runs best-first only (fast). */
export function solveLevel(level: LevelDef, opts: SolveOptions = {}): SolveResult {
  const maxStates = opts.maxStates ?? 200_000;
  if (!opts.optimal) return search(level, maxStates, true, opts)[0];
  const bfs = search(level, maxStates, false, opts)[0];
  if (bfs.solved || bfs.optimal) return bfs;
  const best = search(level, maxStates, true, opts)[0];
  best.explored += bfs.explored;
  return best;
}

/** Up to `opts.solutions` distinct plans from one best-first search (first one first). An empty
 *  array means no plan was found. */
export function solveMany(level: LevelDef, opts: SolveOptions = {}): SolveResult[] {
  return search(level, opts.maxStates ?? 200_000, true, opts).filter((r) => r.solved);
}

function search(level: LevelDef, maxStates: number, bestFirst: boolean, opts: SolveOptions): SolveResult[] {
  const { init, initRisk, nb, settle, key, reachable, clone, thawed, openingsAt, hero, heroMoves, applyPush, cornered, touchesOwnSand, gravity } =
    makeModel(level, opts.model);
  const unsolved = (optimal: boolean, explored: number): SolveResult => ({ solved: false, moves: -1, optimal, explored, path: [] });
  if (initRisk) return [unsolved(true, 0)];
  const want = Math.max(1, opts.solutions ?? 1);
  let rs = opts.noise ? opts.noise | 0 : 0;
  const noise = (): number => {
    if (!opts.noise) return 0;
    let t = (rs = (rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 3;
  };
  type Node = { s: S; parent: Node | null; step: string; dock: string; depth: number; pri: number; time: number };
  const start: Node = { s: init, parent: null, step: '', dock: '', depth: 0, pri: 0, time: 0 };
  const seen = new Set<string>([key(init)]);
  let explored = 0;
  const found: SolveResult[] = [];
  const sigs = new Set<string>();

  const finish = (n: Node): boolean => {
    const path: string[] = [];
    const docks: string[] = [];
    for (let c: Node | null = n; c && c.parent; c = c.parent) {
      path.unshift(c.step);
      docks.unshift(c.dock);
    }
    // distinct = different sequence of (box, docking) choices, ignoring exact parking cells
    const sig = docks.join(';');
    if (!sigs.has(sig)) {
      sigs.add(sig);
      found.push({ solved: true, moves: n.depth, optimal: !bestFirst, explored, path });
    }
    return found.length >= want;
  };
  if (init.done === nb) {
    finish(start);
    return found;
  }

  // Frontier: FIFO for breadth-first, binary min-heap on `pri` for best-first.
  const heap: Node[] = [start];
  let head = 0;
  const push = (n: Node) => {
    heap.push(n);
    if (!bestFirst) return;
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].pri <= heap[i].pri) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): Node | undefined => {
    if (!bestFirst) return head < heap.length ? heap[head++] : undefined;
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].pri < heap[m].pri) m = l;
        if (r < heap.length && heap[r].pri < heap[m].pri) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const capTotal = level.boxes.reduce((a, b) => a + SHAPES[b.shape].length * U, 0);
  const maxExplored = opts.maxExplored ?? Infinity;
  for (let n = pop(); n; n = pop()) {
    if (++explored > maxExplored) return found.length ? found : [unsolved(false, explored)];
    if (!bestFirst && head > 4096) {
      heap.splice(0, head);
      head = 0;
    }
    // a move: a drag of box i to (x, y), or (hero levels) a push macro-move
    const moves: { i: number; x: number; y: number; hm?: HeroMove }[] = [];
    if (hero)
      for (const hm of heroMoves(n.s))
        moves.push(hm.box < 0 ? { i: 0, x: -1, y: -1, hm } : { i: hm.box, x: n.s.xs[hm.box] + hm.dx, y: n.s.ys[hm.box] + hm.dy, hm });
    else
      for (let i = 0; i < nb; i++) {
        if (!n.s.alive[i] || !thawed(n.s, i)) continue;
        for (const [x, y] of reachable(n.s, i)) moves.push({ i, x, y });
      }
    for (const { i, x, y, hm } of moves) {
      {
        const s = clone(n.s);
        if (hm) applyPush(s, hm);
        else {
          s.xs[i] = x;
          s.ys[i] = y;
        }
        if (settle(s)) continue; // pruned (conduit)
        // Sokoban dead corner (floating hero levels): a pushed box wedged against fixed cells on
        // a horizontal and a vertical side can never move again; unless it drains there, prune
        if (hm && hm.box >= 0 && !gravity && s.alive[hm.box] && cornered(s, hm.box) && !touchesOwnSand(s, hm.box, s.xs[hm.box], s.ys[hm.box])) continue;
        const k = key(s);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > maxStates) return found.length ? found : [unsolved(false, explored)];
        const depth = n.depth + 1;
        let filled = 0;
        for (let j = 0; j < nb; j++) filled += s.alive[j] ? s.fill[j] : capOf(level, j);
        // tie-break toward fast docks (sim fill time: below ~0.5 s/cell, side ~2, top ~2.5)
        const got = (s.alive[i] ? s.fill[i] : capOf(level, i)) - (n.s.alive[i] ? n.s.fill[i] : capOf(level, i));
        const secs = got > 0 ? (got / U) * dockSeconds(openingsAt(i, x, y)) : 0;
        const time = n.time + secs;
        // weighted best-first: sand still to collect dominates; moves that collect nothing
        // (parking a box out of the way) cost a little extra
        const remaining = (capTotal - filled) / U;
        const pri = (nb - s.done) * 2 + remaining * 3 + depth + (got > 0 ? 0 : 1) + time / 30 + (hm ? hm.keys.length * 0.03 : 0) + noise();
        const dock =
          i +
          ':' +
          openingsAt(i, x, y)
            .map(([k, ops]) => k + ops.map((o) => (o.kind === 'side' ? 's' + o.lo : o.kind[0])).join(''))
            .join(',');
        const child: Node = { s, parent: n, step: hm ? hm.keys : `box#${i} -> (${x},${y})`, dock: hm ? dock + '>' + x + ',' + y : dock, depth, pri, time };
        if (s.done === nb) {
          if (finish(child)) return found;
          continue;
        }
        push(child);
      }
    }
  }
  return found.length ? found : [unsolved(true, explored)];
}

/** Rough sim seconds per cell of sand for a box docked through these openings (below: gravity,
 *  fast; side: slope flow, slow). */
function dockSeconds(adj: [number, Opening[]][]): number {
  let best = 3;
  for (const [, ops] of adj) for (const o of ops) best = Math.min(best, o.kind === 'bottom' ? 0.5 : o.kind === 'side' ? 5 : 3);
  return best;
}

const capOf = (level: LevelDef, j: number) => SHAPES[level.boxes[j].shape].length * U;

/** Naive strategy: repeatedly drag the first box that can reach its own sand straight there,
 *  never moving anything out of the way. Levels this solves are "easy"; harder levels should
 *  defeat it. Heuristic (abstract model). Returns the number of drags, or -1 if it gets stuck. */
export function greedySolve(level: LevelDef, model: ModelParams = DEFAULT_MODEL): number {
  if (level.hero) return -1; // boxes are pushed, not dragged: the naive drag player does not apply
  const m = makeModel(level, model);
  const s = m.clone(m.init);
  let moves = 0;
  for (;;) {
    if (s.done === m.nb) return moves;
    let moved = false;
    for (let i = 0; i < m.nb && !moved; i++) {
      if (!s.alive[i] || !m.thawed(s, i)) continue;
      for (const [x, y] of m.reachable(s, i)) {
        if (m.touchesOwnSand(s, i, x, y)) {
          s.xs[i] = x;
          s.ys[i] = y;
          m.settle(s);
          moves++;
          moved = true;
          break;
        }
      }
    }
    if (!moved) return -1;
  }
}

/** True if a box (at its definition position) is docked to a sand box holding its color at all. */
export function dockedToOwnColor(level: LevelDef, boxIndex: number): boolean {
  const m = makeModel(level);
  const b = level.boxes[boxIndex];
  return m.dockedToOwnColor(m.init, boxIndex, b.x, b.y);
}
