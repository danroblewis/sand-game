// Fine-grained falling sand: regions, layer filling, and the one shared CA kernel that steps every
// region of a board as a single space (grains cross docked edges when the destination accepts).

import { COLOR_MASK, GRAINS_PER_UNIT, SHADE_COUNT, packGrain } from './types';
import type { Box, LayerDef, SandBoxState, SandRegion } from './types';
import { EDGE_FLOW_SPEED, P_SLUMP, SLUMP_REACH } from './constants';
import { createRng, nextFloat, nextInt } from './rng';
import type { Rng } from './rng';

// ---------------------------------------------------------------------------------------------
// Regions

export function createRegion(w: number, h: number, mask: Uint8Array | null = null): SandRegion {
  let capacity = w * h;
  if (mask) {
    if (mask.length !== w * h) throw new Error('mask size mismatch');
    capacity = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) capacity++;
  }
  return { w, h, cells: new Uint8Array(w * h), mask, count: 0, capacity };
}

export function inRegion(r: SandRegion, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < r.w && y < r.h && (r.mask === null || r.mask[y * r.w + x] !== 0);
}

/** Packed grain at (x, y); 0 when empty or out of bounds. */
export function getGrain(r: SandRegion, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return 0;
  return r.cells[y * r.w + x];
}

/** Set a cell (0 clears it), keeping `count` correct. Returns false if out of the mask. */
export function setGrain(r: SandRegion, x: number, y: number, v: number): boolean {
  if (!inRegion(r, x, y)) return false;
  setGrainAt(r, y * r.w + x, v);
  return true;
}

/** Index-based setter (no bounds/mask check), keeping `count` correct. */
export function setGrainAt(r: SandRegion, i: number, v: number): void {
  const old = r.cells[i];
  if (old === 0 && v !== 0) r.count++;
  else if (old !== 0 && v === 0) r.count--;
  r.cells[i] = v;
  touchRegion(r);
}

/** Recount grains from scratch (debug / validation). */
export function recount(r: SandRegion): number {
  let n = 0;
  for (let i = 0; i < r.cells.length; i++) if (r.cells[i] !== 0) n++;
  return n;
}

/** Number of grains of a given color in the region. */
export function countColor(r: SandRegion, color: number): number {
  let n = 0;
  const c = r.cells;
  for (let i = 0; i < c.length; i++) if (c[i] !== 0 && (c[i] & COLOR_MASK) === color) n++;
  return n;
}

export function regionIsFull(r: SandRegion): boolean {
  return r.count >= r.capacity;
}

// Per-region change counter, bumped by anything that changes a region's cells (the renderer
// skips rebuilding regions whose version did not change).
const versions = new WeakMap<SandRegion, number>();
export function regionVersion(r: SandRegion): number {
  return versions.get(r) ?? 0;
}
export function touchRegion(r: SandRegion): void {
  versions.set(r, (versions.get(r) ?? 0) + 1);
}

/**
 * Fill horizontal layers bottom-up into empty in-mask cells. `amount` is in grid-cell units
 * (× GRAINS_PER_UNIT grains); partial rows fill left to right. Each grain gets a random shade.
 * Returns the number of grains placed (excess beyond capacity is dropped).
 */
export function fillLayers(region: SandRegion, layers: LayerDef[], rng: Rng = createRng(12345)): number {
  const { w, h, cells, mask } = region;
  let y = h - 1;
  let x = 0;
  let placed = 0;
  for (const layer of layers) {
    let n = Math.round(layer.amount * GRAINS_PER_UNIT);
    while (n > 0 && y >= 0) {
      const i = y * w + x;
      if (cells[i] === 0 && (mask === null || mask[i] !== 0)) {
        cells[i] = packGrain(layer.color, nextInt(rng, SHADE_COUNT));
        region.count++;
        placed++;
        n--;
      }
      if (++x === w) {
        x = 0;
        y--;
      }
    }
  }
  touchRegion(region);
  return placed;
}

// ---------------------------------------------------------------------------------------------
// The shared space

/** One region placed in the shared space. */
export interface Slot {
  /** Index in `Space.slots`. */
  idx: number;
  region: SandRegion;
  /** Top-left of the region in world fine cells. */
  ox: number;
  oy: number;
  box: Box | null;
  sandBox: SandBoxState | null;
  /** Box color (0 for sand boxes). */
  color: number;
  /** True for an active, unfrozen box: it accepts grains of `color` into its empty cells.
   *  Sand boxes and frozen boxes never accept. */
  accepting: boolean;
  /** Offset of this region's cells in the space's per-cell stamp arrays. */
  base: number;
  /** Cells changed this step (regionVersion is bumped in endStep). */
  touched: boolean;
  /** The pull held grains here this step (keeps the region awake). */
  held: boolean;
  /** Slots whose regions touch this one (edge or corner): their changes can wake it. */
  nbrs: Slot[];
  /** Sleeping: last sweep found nothing to move here (no grain moved, no slump pending). */
  quiet: boolean;
  /** regionVersion / count when last seen at endStep (detects outside changes). */
  seenVer: number;
  seenCount: number;
  /** Per-sweep flags. */
  skip: boolean;
  busy: boolean;
  /** Sand boxes: local x-range [openLo[c], openHi[c]] of the opening cells of accepting boxes of
   *  color c (empty range when none). Slumps toward it skip the P_SLUMP roll. */
  openLo: Int16Array;
  openHi: Int16Array;
  /** Box slots: the connected same-color group (rule 6b) this box belongs to, one container for
   *  sand; null for sand boxes. */
  group: BoxGroup | null;
}

/** A connected group of same-color boxes, treated as one container. */
export interface BoxGroup {
  slots: Slot[];
  color: number;
  capacity: number;
}

/** Total grains in a group. */
export function groupCount(g: BoxGroup): number {
  let n = 0;
  for (const s of g.slots) n += s.region.count;
  return n;
}

/** A fresh slot (box/sandBox owners optional). */
export function makeSlot(region: SandRegion, ox: number, oy: number, box: Box | null, sandBox: SandBoxState | null): Slot {
  return {
    idx: 0,
    region,
    ox,
    oy,
    box,
    sandBox,
    color: box ? box.color : 0,
    accepting: box !== null && box.frozen === 0,
    base: 0,
    touched: false,
    held: false,
    nbrs: [],
    quiet: false,
    seenVer: -1,
    seenCount: -1,
    skip: false,
    busy: false,
    openLo: new Int16Array(32).fill(32767),
    openHi: new Int16Array(32).fill(-32768),
    group: null,
  };
}

export interface Space {
  /** World size in fine cells (0 = no world: regions are isolated, as for `stepRegion`). */
  W: number;
  H: number;
  /** World fine cell → slot index + 1 for in-mask cells of some region, 0 for none. */
  slotOf: Int16Array;
  /** World fine cell → local index inside that slot's region. */
  localOf: Int32Array;
  /** Slots sorted by world x (sweep order within a world row). */
  slots: Slot[];
  /** Rows swept bottom-up: world rows (or the region's rows when W = 0). */
  rows: number;
  /** Total cells over all slots (size of the stamp arrays). */
  cellTotal: number;
  /** "Done this step" stamps: moved by the CA or the pull, or held by the pull. */
  stamp: Uint32Array;
  /** "Moved by the pull this step" stamps. */
  pulled: Uint32Array;
  gen: number;
  /** Grains that crossed from a sand box into a box this step. */
  crossings: number;
}

export function createSpace(W: number, H: number, rows: number): Space {
  return {
    W,
    H,
    slotOf: new Int16Array(W * H),
    localOf: new Int32Array(W * H),
    slots: [],
    rows,
    cellTotal: 0,
    stamp: new Uint32Array(0),
    pulled: new Uint32Array(0),
    gen: 0,
    crossings: 0,
  };
}

/** Size the stamp arrays for the current slots (call after (re)placing slots). */
export function allocStamps(sp: Space): void {
  let base = 0;
  for (const s of sp.slots) {
    s.base = base;
    base += s.region.w * s.region.h;
  }
  sp.cellTotal = base;
  if (sp.stamp.length < base) {
    sp.stamp = new Uint32Array(base);
    sp.pulled = new Uint32Array(base);
    sp.gen = 0;
  }
}

/** Start a step: fresh stamp generation, clear per-step flags. */
export function beginStep(sp: Space): void {
  sp.gen = (sp.gen + 1) >>> 0;
  if (sp.gen === 0) {
    sp.stamp.fill(0);
    sp.pulled.fill(0);
    sp.gen = 1;
  }
  sp.crossings = 0;
  for (const s of sp.slots) s.touched = s.held = false;
}

/** End a step: bump the version of every region that changed. */
export function endStep(sp: Space): void {
  for (const s of sp.slots) {
    if (s.touched) touchRegion(s.region);
    s.seenVer = regionVersion(s.region);
    s.seenCount = s.region.count;
  }
}

/** Changed since the last endStep (this step's pull, or code outside the sim). */
export function changed(s: Slot): boolean {
  return s.touched || s.held || s.seenVer !== regionVersion(s.region) || s.seenCount !== s.region.count;
}

// Target of the last successful `free` query (module scratch keeps the hot loop allocation-free).
let tSlot: Slot = null as unknown as Slot;
let tIdx = 0;

/**
 * Is the cell at offset (dx, dy) from (x, y) in slot S an empty cell a grain of color c may move
 * into? Inside S any empty in-mask cell; across an edge (via the world map) only an empty cell of
 * a region that accepts c. A diagonal step across regions also needs one of the two orthogonal
 * intermediate cells to belong to S or the target (no slipping through a corner between walls).
 * On success the target is left in tSlot / tIdx.
 */
export function free(sp: Space, S: Slot, x: number, y: number, dx: number, dy: number, c: number): boolean {
  const r = S.region;
  const nx = x + dx;
  const ny = y + dy;
  if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h) {
    const j = ny * r.w + nx;
    if (r.mask === null || r.mask[j] !== 0) {
      if (r.cells[j] !== 0) return false;
      tSlot = S;
      tIdx = j;
      return true;
    }
  }
  const W = sp.W;
  if (W === 0) return false;
  const wx = S.ox + nx;
  const wy = S.oy + ny;
  if (wx < 0 || wy < 0 || wx >= W || wy >= sp.H) return false;
  const w = wy * W + wx;
  const s = sp.slotOf[w] - 1;
  if (s < 0) return false;
  const T = sp.slots[s];
  if (T === S || !T.accepting || T.color !== c) return false;
  const j = sp.localOf[w];
  if (T.region.cells[j] !== 0) return false;
  if ((dx === 1 || dx === -1) && (dy === 1 || dy === -1)) {
    const a = sp.slotOf[(S.oy + y) * W + wx] - 1;
    const b = sp.slotOf[wy * W + S.ox + x] - 1;
    if (a !== S.idx && a !== s && b !== S.idx && b !== s) return false;
  }
  tSlot = T;
  tIdx = j;
  return true;
}

/** Move the grain v at index i of S into (tSlot, tIdx). */
function moveTo(sp: Space, S: Slot, i: number, v: number): void {
  const T = tSlot;
  const j = tIdx;
  T.region.cells[j] = v;
  S.region.cells[i] = 0;
  if (T !== S) {
    S.region.count--;
    T.region.count++;
    T.touched = true;
    T.busy = true; // an arrival can move again next step, even in a region that was asleep
    if (S.box === null && T.box !== null) sp.crossings++;
  }
  S.touched = true;
  sp.stamp[T.base + j] = sp.gen;
}

/** Is the cell at (x + dx, y + dy) of sand-box slot S across an edge in a box that accepts color
 *  c and whose group is not full (an opening of that color, occupied or not)? */
function opening(sp: Space, S: Slot, x: number, y: number, dx: number, dy: number, c: number): boolean {
  if (sp.W === 0 || S.box !== null) return false;
  const nx = x + dx;
  const ny = y + dy;
  if (nx >= 0 && nx < S.region.w && ny >= 0 && ny < S.region.h) return false;
  const wx = S.ox + nx;
  const wy = S.oy + ny;
  if (wx < 0 || wx >= sp.W || wy < 0 || wy >= sp.H) return false;
  const s = sp.slotOf[wy * sp.W + wx] - 1;
  if (s < 0) return false;
  const T = sp.slots[s];
  if (!T.accepting || T.color !== c) return false;
  return T.group ? groupCount(T.group) < T.group.capacity : T.region.count < T.region.capacity;
}

/**
 * Slump test along the row in direction d. Returns -1 for a free run with a drop within
 * SLUMP_REACH cells (ordinary slump), k > 0 when, in a sand box, the free run (k cells) ends at a
 * docked opening of the grain's color, or passes over one below, at any distance (edge flow: the
 * surface keeps flowing toward an opening that can still take it, so a layer beside or above a box
 * drains completely instead of resting as a wedge on the far side), 0 otherwise.
 */
function canSlump(sp: Space, S: Slot, x: number, y: number, d: number, c: number): number {
  const far = S.box === null && sp.W !== 0 ? S.region.w : SLUMP_REACH;
  let drop = false;
  for (let j = 1; j <= far; j++) {
    if (!free(sp, S, x, y, j * d, 0, c)) {
      if (j >= 2 && opening(sp, S, x, y, j * d, 0, c)) return j - 1;
      break;
    }
    // The run reaches a cell over an opening below (empty or not: an occupied inlet is fed by the
    // pull's chain push, e.g. into the foot of an L under its overhang), or a column of an opening
    // of this color (it falls the rest of the way): edge flow.
    const xx = x + j * d;
    if (xx >= S.openLo[c] && xx <= S.openHi[c] && (x < S.openLo[c] || x > S.openHi[c])) return j;
    if (opening(sp, S, x, y, j * d, 1, c)) return j;
    if (j >= 2 && free(sp, S, x, y, j * d, 1, c)) {
      if (tSlot !== S) return j; // the drop is into a box below (an opening): edge flow
      if (j <= SLUMP_REACH) {
        drop = true;
        if (far === SLUMP_REACH) break;
      }
    }
  }
  return drop ? -1 : 0;
}

/**
 * One CA sweep over the whole space: world rows bottom-up, alternating scan direction by tick.
 * Each grain not stamped this step tries gravity, then a diagonal slide, then (with P_SLUMP) a
 * sideways slump toward a drop within SLUMP_REACH; every neighbour may lie across a docked edge.
 * Returns true if something moved or a slump was possible (i.e. the space is not at rest).
 */
export function sweepSpace(sp: Space, rng: Rng, tick: number): boolean {
  const gen = sp.gen;
  const stamp = sp.stamp;
  const slots = sp.slots;
  const ns = slots.length;
  const ltr = (tick & 1) === 0;
  let active = false;
  // Sleep: a region that was quiet, did not change, and whose neighbours were quiet and did not
  // change either, cannot move anything this step (a move depends only on its own cells and its
  // neighbours'). Arrivals during the sweep mark the target busy.
  for (let k = 0; k < ns; k++) {
    const S = slots[k];
    S.busy = false;
    let skip = S.quiet && !changed(S);
    if (skip) for (const n of S.nbrs) if (!n.quiet || changed(n)) skip = false;
    S.skip = skip;
  }
  for (let wy = sp.rows - 1; wy >= 0; wy--) {
    for (let k = 0; k < ns; k++) {
      const S = slots[ltr ? k : ns - 1 - k];
      const r = S.region;
      const y = wy - S.oy;
      if (y < 0 || y >= r.h || r.count === 0 || S.skip) continue;
      const w = r.w;
      const cells = r.cells;
      const base = S.base;
      const row = y * w;
      for (let k2 = 0; k2 < w; k2++) {
        const x = ltr ? k2 : w - 1 - k2;
        const i = row + x;
        const v = cells[i];
        if (v === 0) continue;
        if (stamp[base + i] === gen) {
          S.busy = true; // moved or held by the pull this step: look again next step
          continue;
        }
        const c = v & COLOR_MASK;
        if (free(sp, S, x, y, 0, 1, c)) {
          moveTo(sp, S, i, v);
          active = S.busy = true;
          continue;
        }
        const dl = free(sp, S, x, y, -1, 1, c);
        const lS = tSlot;
        const lI = tIdx;
        const dr = free(sp, S, x, y, 1, 1, c);
        if (dl || dr) {
          if (dl && (!dr || nextFloat(rng) < 0.5)) {
            tSlot = lS;
            tIdx = lI;
          }
          moveTo(sp, S, i, v);
          active = S.busy = true;
          continue;
        }
        const sl = canSlump(sp, S, x, y, -1, c);
        const sr = canSlump(sp, S, x, y, 1, c);
        if (sl === 0 && sr === 0) continue;
        active = S.busy = true;
        if (sl > 0 || sr > 0) {
          // Edge flow toward an opening: every step, up to EDGE_FLOW_SPEED cells.
          const d = sl > 0 && (sr <= 0 || nextFloat(rng) < 0.5) ? -1 : 1;
          const run = d < 0 ? sl : sr;
          free(sp, S, x, y, d * Math.min(run, EDGE_FLOW_SPEED), 0, c);
          moveTo(sp, S, i, v);
          continue;
        }
        // Toward an opening of this color in the same sand box the slope relaxes eagerly.
        const lo = S.openLo[c];
        const toward = lo <= S.openHi[c] && ((sr && x < lo) || (sl && x > S.openHi[c]));
        if (toward) {
          free(sp, S, x, y, x < lo ? 1 : -1, 0, c);
          moveTo(sp, S, i, v);
          continue;
        }
        if (nextFloat(rng) >= P_SLUMP) continue;
        const d = sl && sr ? (nextFloat(rng) < 0.5 ? -1 : 1) : sl ? -1 : 1;
        free(sp, S, x, y, d, 0, c);
        moveTo(sp, S, i, v);
      }
    }
  }
  for (let k = 0; k < ns; k++) slots[k].quiet = !slots[k].busy;
  return active;
}

// Standalone stepping of a single region (no neighbours), e.g. for tests and tools.
const solo = new WeakMap<SandRegion, Space>();

/**
 * One CA step of an isolated region (same kernel as the board sim, with no docked neighbours).
 * Returns whether the region may still change (a grain moved or a slump was possible).
 */
export function stepRegion(region: SandRegion, rng: Rng, stepIndex: number): boolean {
  if (region.count === 0) return false;
  let sp = solo.get(region);
  if (!sp) {
    sp = createSpace(0, 0, region.h);
    sp.slots.push(makeSlot(region, 0, 0, null, null));
    allocStamps(sp);
    solo.set(region, sp);
  }
  beginStep(sp);
  const active = sweepSpace(sp, rng, stepIndex);
  endStep(sp);
  return active;
}

/**
 * Shake: give a region's sand an impulse (hx, hy) (each -1, 0 or 1). In each of `passes` passes,
 * every grain whose neighbour in that direction is an empty in-mask cell hops into it with
 * probability p (scan order makes a grain hop at most once per pass). Stays inside the region, so
 * the grain count is preserved exactly. Returns the number of hops.
 */
export function shakeRegion(region: SandRegion, rng: Rng, hx: number, hy: number, p: number, passes: number): number {
  if (region.count === 0 || (hx === 0 && hy === 0)) return 0;
  const { w, h, cells, mask } = region;
  const off = hy * w + hx;
  // Scan from the side the grains hop toward (hopping up → top-down), so a grain that hopped
  // lands in an already-visited cell and is not visited again in the same pass.
  const y0 = hy > 0 ? h - 1 : 0;
  const ys = hy > 0 ? -1 : 1;
  const x0 = hx > 0 ? w - 1 : 0;
  const xs = hx > 0 ? -1 : 1;
  let hops = 0;
  for (let pass = 0; pass < passes; pass++) {
    for (let yy = 0, y = y0; yy < h; yy++, y += ys) {
      const ny = y + hy;
      if (ny < 0 || ny >= h) continue;
      for (let xx = 0, x = x0; xx < w; xx++, x += xs) {
        const nx = x + hx;
        if (nx < 0 || nx >= w) continue;
        const i = y * w + x;
        const v = cells[i];
        if (v === 0) continue;
        const j = i + off;
        if (cells[j] !== 0 || (mask !== null && mask[j] === 0)) continue;
        if (nextFloat(rng) >= p) continue;
        cells[j] = v;
        cells[i] = 0;
        hops++;
      }
    }
  }
  if (hops) touchRegion(region);
  return hops;
}
