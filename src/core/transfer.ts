// The board as one shared space (world map of every region's fine cells, rebuilt only when
// dockings change), and the short-reach pull boxes exert on matching sand next to their openings.

import { COLOR_MASK, GRAINS_PER_CELL } from './types';
import type { Box, GameState, SandRegion } from './types';
import { P_PULL, PULL_RATE_BASE, PULL_RATE_PER_CELL, pullReach } from './constants';
import { nextFloat, nextInt } from './rng';
import type { Rng } from './rng';
import { allocStamps, changed, createSpace, groupCount, makeSlot } from './sand';
import { connectedGroups } from './grid';
import type { BoxGroup, Slot, Space } from './sand';

const N = GRAINS_PER_CELL;

/** A connected group of active unfrozen same-color boxes (often a single box) and the fine-cell
 *  openings its members share with sand boxes, pooled. */
export interface Puller {
  group: BoxGroup;
  /** The group's lowest-id member (kept for older callers; check fullness with groupCount(group)
   *  against group.capacity, not this box alone). */
  box: Box;
  color: number;
  /** Credit key: the lowest member box id. */
  key: number;
  /** Flat quads: [sandBoxSlotIdx, openingLocalIdx, boxSlotIdx, inletLocalIdx, ...]. The opening
   *  cell is in the sand box, the inlet is the mirrored cell of a member box across the edge. */
  pairs: Int32Array;
  /** Number of quads. */
  n: number;
  /** Max grains pulled in per step: base + per cell over all member cells. */
  rate: number;
  /** Sand-box slots the openings are in. */
  sources: Slot[];
  /** Nothing of the group's color was in reach last time: skip until a source wakes up. */
  idle: boolean;
}

export interface GameSpace extends Space {
  /** Docking signature (per box: x, y, active, frozen) the space was built for. */
  sig: Int32Array;
  pullers: Puller[];
  /** Pull credit per box id (fractional rates accumulate here). */
  credit: Float64Array;
  // Pull BFS scratch, indexed by slot.base + local index.
  bfsStamp: Uint32Array;
  bfsGen: number;
  dist: Uint16Array;
  qSlot: Int32Array;
  qLoc: Int32Array;
  qPair: Int32Array;
  // Chain-push scratch, indexed by slot.base + local index.
  cpStamp: Uint32Array;
  cpGen: number;
  cpParent: Int32Array;
  cpQueue: Int32Array;
  /** Stamp index → slot index (for decoding chain-push nodes). */
  slotOfCell: Int16Array;
}

const spaces = new WeakMap<GameState, GameSpace>();

function sigMatches(state: GameState, sig: Int32Array): boolean {
  const boxes = state.boxes;
  if (sig.length !== boxes.length * 4) return false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (
      sig[4 * i] !== b.x ||
      sig[4 * i + 1] !== b.y ||
      sig[4 * i + 2] !== (b.state === 'active' ? 1 : 0) ||
      sig[4 * i + 3] !== (b.frozen > 0 ? 1 : 0)
    )
      return false;
  }
  return true;
}

function writeSig(state: GameState, sig: Int32Array): void {
  state.boxes.forEach((b, i) => {
    sig[4 * i] = b.x;
    sig[4 * i + 1] = b.y;
    sig[4 * i + 2] = b.state === 'active' ? 1 : 0;
    sig[4 * i + 3] = b.frozen > 0 ? 1 : 0;
  });
}

function rebuild(state: GameState, sp: GameSpace): void {
  const { W, H } = sp;
  sp.slotOf.fill(0);
  const slots: Slot[] = [];
  for (const sb of state.sandBoxes) slots.push(makeSlot(sb.region, sb.x * N, sb.y * N, null, sb));
  for (const b of state.boxes) if (b.state === 'active') slots.push(makeSlot(b.region, b.x * N, b.y * N, b, null));
  slots.sort((a, b) => a.ox - b.ox || a.oy - b.oy);
  slots.forEach((s, i) => (s.idx = i));
  sp.slots = slots;
  for (const s of slots) {
    const { w, h, mask } = s.region;
    for (let y = 0; y < h; y++) {
      const wy = s.oy + y;
      if (wy < 0 || wy >= H) continue;
      for (let x = 0; x < w; x++) {
        const wx = s.ox + x;
        const i = y * w + x;
        if (wx < 0 || wx >= W || (mask !== null && mask[i] === 0)) continue;
        sp.slotOf[wy * W + wx] = s.idx + 1;
        sp.localOf[wy * W + wx] = i;
      }
    }
  }
  // Neighbours (regions touching by an edge or a corner) for waking sleeping regions.
  for (const a of slots) {
    a.nbrs = [];
    for (const b of slots) {
      if (a === b) continue;
      if (
        b.ox <= a.ox + a.region.w + N - 1 &&
        a.ox <= b.ox + b.region.w + N - 1 &&
        b.oy <= a.oy + a.region.h + N - 1 &&
        a.oy <= b.oy + b.region.h + N - 1
      )
        a.nbrs.push(b);
    }
  }
  allocStamps(sp);
  if (sp.bfsStamp.length < sp.cellTotal) {
    const n = sp.cellTotal;
    sp.bfsStamp = new Uint32Array(n);
    sp.bfsGen = 0;
    sp.dist = new Uint16Array(n);
    sp.qSlot = new Int32Array(n);
    sp.qLoc = new Int32Array(n);
    sp.qPair = new Int32Array(n);
    sp.cpStamp = new Uint32Array(n);
    sp.cpGen = 0;
    sp.cpParent = new Int32Array(n);
    sp.cpQueue = new Int32Array(n);
    sp.slotOfCell = new Int16Array(n);
  }
  for (const sl of slots) sp.slotOfCell.fill(sl.idx, sl.base, sl.base + sl.region.w * sl.region.h);
  // Groups (rule 6b): connected same-color boxes are one container.
  const slotOfBox = new Map<Box, Slot>();
  for (const sl of slots) if (sl.box) slotOfBox.set(sl.box, sl);
  const groups: BoxGroup[] = [];
  for (const g of connectedGroups(state)) {
    const members = g.map((b) => slotOfBox.get(b)!).filter(Boolean);
    const grp: BoxGroup = { slots: members, color: g[0].color, capacity: 0 };
    for (const m of members) {
      grp.capacity += m.region.capacity;
      m.group = grp;
    }
    groups.push(grp);
  }
  // Openings: box in-mask cells whose orthogonal neighbour across the box border is a sand-box cell.
  sp.pullers = [];
  const DX = [0, 0, -1, 1];
  const DY = [-1, 1, 0, 0];
  for (const grp of groups) {
    const pairs: number[] = [];
    let cells = 0;
    let key = Infinity;
    for (const s of grp.slots) {
      const box = s.box!;
      cells += box.cells.length;
      key = Math.min(key, box.id);
      const { w, h, mask } = s.region;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (mask !== null && mask[i] === 0) continue;
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d];
            const ny = y + DY[d];
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && (mask === null || mask[ny * w + nx] !== 0)) continue;
            const wx = s.ox + nx;
            const wy = s.oy + ny;
            if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
            const t = sp.slotOf[wy * W + wx] - 1;
            if (t < 0 || slots[t].sandBox === null) continue;
            pairs.push(t, sp.localOf[wy * W + wx], s.idx, i);
          }
        }
    }
    if (pairs.length === 0) continue;
    for (let k = 0; k < pairs.length; k += 4) {
      const T = slots[pairs[k]];
      const ox = pairs[k + 1] % T.region.w;
      const c = grp.color;
      if (ox < T.openLo[c]) T.openLo[c] = ox;
      if (ox > T.openHi[c]) T.openHi[c] = ox;
    }
    const sources: Slot[] = [];
    for (let k = 0; k < pairs.length; k += 4) if (!sources.includes(slots[pairs[k]])) sources.push(slots[pairs[k]]);
    sp.pullers.push({
      group: grp,
      box: grp.slots.reduce((m, sl) => (sl.box!.id < m.id ? sl.box! : m), grp.slots[0].box!),
      color: grp.color,
      key,
      pairs: Int32Array.from(pairs),
      n: pairs.length / 4,
      rate: PULL_RATE_BASE + PULL_RATE_PER_CELL * cells,
      sources,
      idle: false,
    });
  }
  writeSig(state, sp.sig);
}

/**
 * The shared space for a game, rebuilt only when the dockings can have changed (a box moved, was
 * removed or thawed). Cheap to call every step.
 */
export function gameSpace(state: GameState): GameSpace {
  let sp = spaces.get(state);
  if (!sp) {
    const W = state.width * N;
    const H = state.height * N;
    const base = createSpace(W, H, H);
    sp = {
      ...base,
      sig: new Int32Array(state.boxes.length * 4).fill(-999),
      pullers: [],
      credit: new Float64Array(state.boxes.length),
      bfsStamp: new Uint32Array(0),
      bfsGen: 0,
      dist: new Uint16Array(0),
      qSlot: new Int32Array(0),
      qLoc: new Int32Array(0),
      qPair: new Int32Array(0),
      cpStamp: new Uint32Array(0),
      cpGen: 0,
      cpParent: new Int32Array(0),
      cpQueue: new Int32Array(0),
      slotOfCell: new Int16Array(0),
    };
    spaces.set(state, sp);
    rebuild(state, sp);
  } else if (!sigMatches(state, sp.sig)) {
    if (sp.sig.length !== state.boxes.length * 4) {
      sp.sig = new Int32Array(state.boxes.length * 4);
      sp.credit = new Float64Array(state.boxes.length);
    }
    rebuild(state, sp);
  }
  return sp;
}

/** Mark the game's space stale (call after changing boxes behind the core's back). */
export function invalidateSpace(state: GameState): void {
  const sp = spaces.get(state);
  if (sp) sp.sig.fill(-999);
}

// ---------------------------------------------------------------------------------------------
// Chain push: a grain enters an occupied inlet and the box's grains shift by one along the
// shortest path (through same-color grains) to the nearest empty cell, so the pile bulges there.

/**
 * Push grain v in at `inlet` of box slot B. BFS (4-connected, up first, then sideways, then down)
 * from the inlet through same-color grains, crossing the shared edges between members of B's
 * group, to the nearest empty in-mask cell anywhere in the group; the grains along that path shift
 * by one (across edges as needed) and v enters at the inlet. Returns false if the group is full.
 */
export function chainPush(sp: GameSpace, B: Slot, inlet: number, v: number, flip: boolean): boolean {
  const { cpStamp, cpParent, cpQueue, slotOfCell, slots } = sp;
  sp.cpGen = (sp.cpGen + 1) >>> 0;
  if (sp.cpGen === 0) {
    cpStamp.fill(0);
    sp.cpGen = 1;
  }
  const gen = sp.cpGen;
  const c = v & COLOR_MASK;
  const grp = B.group;
  const multi = grp !== null && grp.slots.length > 1 && sp.W > 0;
  const W = sp.W;
  const start = B.base + inlet;
  let head = 0;
  let tail = 0;
  cpQueue[tail++] = start;
  cpStamp[start] = gen;
  cpParent[start] = -1;
  let found = -1;
  const sx = flip ? 1 : -1;
  while (head < tail && found < 0) {
    const cur = cpQueue[head++];
    const S = slots[slotOfCell[cur]];
    const r = S.region;
    const li = cur - S.base;
    const x = li % r.w;
    const y = (li - x) / r.w;
    for (let d = 0; d < 4; d++) {
      let nx = x;
      let ny = y;
      if (d === 0) ny--;
      else if (d === 1) nx += sx;
      else if (d === 2) nx -= sx;
      else ny++;
      let T = S;
      let j: number;
      if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h && (r.mask === null || r.mask[ny * r.w + nx] !== 0)) {
        j = ny * r.w + nx;
      } else {
        if (!multi) continue;
        const wx = S.ox + nx;
        const wy = S.oy + ny;
        if (wx < 0 || wy < 0 || wx >= W || wy >= sp.H) continue;
        const t = sp.slotOf[wy * W + wx] - 1;
        if (t < 0 || slots[t].group !== grp) continue;
        T = slots[t];
        j = sp.localOf[wy * W + wx];
      }
      const g = T.base + j;
      if (cpStamp[g] === gen) continue;
      cpStamp[g] = gen;
      cpParent[g] = cur;
      const val = T.region.cells[j];
      if (val === 0) {
        found = g;
        break;
      }
      if ((val & COLOR_MASK) === c) cpQueue[tail++] = g;
    }
  }
  if (found < 0) return false;
  const F = slots[slotOfCell[found]];
  for (let k = found; k !== start; ) {
    const p = cpParent[k];
    const KS = slots[slotOfCell[k]];
    const PS = slots[slotOfCell[p]];
    KS.region.cells[k - KS.base] = PS.region.cells[p - PS.base];
    KS.touched = true;
    k = p;
  }
  B.region.cells[inlet] = v;
  F.region.count++;
  B.touched = true;
  F.touched = true;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Pull

const DX8 = [0, -1, 1, 0, -1, 1, -1, 1];
const DY8 = [-1, 0, 0, 1, -1, -1, 1, 1];

/** Empty or color c, and inside the region. */
function passable(cells: Uint8Array, mask: Uint8Array | null, w: number, h: number, x: number, y: number, c: number): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const j = y * w + x;
  if (mask !== null && mask[j] === 0) return false;
  const v = cells[j];
  return v === 0 || (v & COLOR_MASK) === c;
}

/** The grain at box cell i is still falling (empty in-mask cell below it): wait for it to settle
 *  instead of pushing a chain (keeps a bottom docking a clean plug flow). */
function falling(r: SandRegion, i: number): boolean {
  const j = i + r.w;
  return j < r.cells.length && r.cells[j] === 0 && (r.mask === null || r.mask[j] !== 0);
}

/**
 * Every active unfrozen box with free capacity pulls matching sand within pullReach() fine cells of
 * its openings (BFS through empty / own-color cells of the sand box, 8-connected without diagonal
 * squeezing). Nearest first, with P_PULL:
 * - a grain on an opening crosses into the box: into the empty inlet, else (once the inlet grain
 *   has settled) by a chain push; at most `rate` grains per box per step;
 * - a grain whose own CA move already heads for the opening is left to the CA;
 * - otherwise it steps into an empty cell one BFS layer closer (any direction, within the tiny
 *   reach) and is held against gravity this step, or it swaps shades with a same-color grain one
 *   layer closer (holding nothing).
 * Other colors are never touched. Run before the CA sweep, inside beginStep/endStep.
 */
export function applyPull(state: GameState, sp: GameSpace, rng: Rng): void {
  const R = pullReach();
  const np = sp.pullers.length;
  if (R <= 0 || np === 0) return;
  const start = state.tick % np;
  for (let k = 0; k < np; k++) {
    const P = sp.pullers[(start + k) % np];
    if (groupCount(P.group) >= P.group.capacity) continue;
    if (P.idle) {
      let wake = false;
      for (const src of P.sources) if (!src.quiet || changed(src)) wake = true;
      if (!wake) continue;
    }
    const id = P.key;
    let credit = Math.min(sp.credit[id] + P.rate, P.rate + 1);
    credit = pullBox(sp, P, R, credit, rng, state.tick);
    sp.credit[id] = credit;
  }
}

function pullBox(sp: GameSpace, P: Puller, R: number, credit: number, rng: Rng, tick: number): number {
  const c = P.color;
  const slots = sp.slots;
  const { bfsStamp, dist, qSlot, qLoc, qPair, stamp, pulled } = sp;
  const pairs = P.pairs;
  const gen = sp.gen;
  sp.bfsGen = (sp.bfsGen + 1) >>> 0;
  if (sp.bfsGen === 0) {
    bfsStamp.fill(0);
    sp.bfsGen = 1;
  }
  const bg = sp.bfsGen;
  // Seeds: opening cells that are empty or hold color c (random start for fairness).
  let qn = 0;
  const off = nextInt(rng, P.n);
  for (let t = 0; t < P.n; t++) {
    const p = (off + t) % P.n;
    const s = pairs[4 * p];
    const o = pairs[4 * p + 1];
    const S = slots[s];
    const g = S.base + o;
    if (bfsStamp[g] === bg) continue;
    const v = S.region.cells[o];
    if (v !== 0 && (v & COLOR_MASK) !== c) continue;
    bfsStamp[g] = bg;
    dist[g] = 0;
    qSlot[qn] = s;
    qLoc[qn] = o;
    qPair[qn] = p;
    qn++;
  }
  P.idle = true;
  if (qn === 0) return credit;
  // BFS within each seed's sand box.
  for (let head = 0; head < qn; head++) {
    const S = slots[qSlot[head]];
    const i = qLoc[head];
    const d = dist[S.base + i];
    if (d >= R) continue;
    const { w, h, cells, mask } = S.region;
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      const dx = DX8[k];
      const dy = DY8[k];
      if (!passable(cells, mask, w, h, x + dx, y + dy, c)) continue;
      const j = (y + dy) * w + x + dx;
      const g = S.base + j;
      if (bfsStamp[g] === bg) continue;
      if (dx !== 0 && dy !== 0 && !passable(cells, mask, w, h, x + dx, y, c) && !passable(cells, mask, w, h, x, y + dy, c))
        continue;
      bfsStamp[g] = bg;
      dist[g] = d + 1;
      qSlot[qn] = qSlot[head];
      qLoc[qn] = j;
      qPair[qn] = -1;
      qn++;
    }
  }
  // Move reached grains, nearest first.
  const grp = P.group;
  let room = grp.capacity - groupCount(grp);
  for (let k = 0; k < qn; k++) {
    const S = slots[qSlot[k]];
    const r = S.region;
    const cells = r.cells;
    const i = qLoc[k];
    const v = cells[i];
    if (v === 0 || (v & COLOR_MASK) !== c) continue;
    P.idle = false;
    const g = S.base + i;
    if (pulled[g] === gen) continue;
    const d = dist[g];
    if (d === 0) {
      if (credit < 1) continue;
      const B = slots[pairs[4 * qPair[k] + 2]];
      const br = B.region;
      const inlet = pairs[4 * qPair[k] + 3];
      if (br.cells[inlet] === 0) {
        br.cells[inlet] = v;
        br.count++;
        B.touched = true;
      } else if (falling(br, inlet) || !chainPush(sp, B, inlet, v, ((tick + k) & 1) === 0)) continue;
      cells[i] = 0;
      r.count--;
      credit--;
      sp.crossings++;
      S.touched = true;
      stamp[B.base + inlet] = gen;
      pulled[B.base + inlet] = gen;
      if (--room <= 0) break;
      continue;
    }
    // A grain whose CA move (fall, else slide) would bring it closer to the opening is left to
    // the CA: pulling it instead would shear a draining body (a bottom docking stays a plug).
    const { w, h, mask } = r;
    const x = i % w;
    const y = (i - x) / w;
    if (y + 1 < h) {
      const b = i + w;
      const gb = S.base + b;
      if (cells[b] === 0 && (mask === null || mask[b] !== 0)) {
        if (bfsStamp[gb] === bg && dist[gb] === d - 1) continue; // it will fall toward the opening
      } else {
        const dl = x > 0 && cells[b - 1] === 0 && (mask === null || mask[b - 1] !== 0);
        const dr = x + 1 < w && cells[b + 1] === 0 && (mask === null || mask[b + 1] !== 0);
        const cl = bfsStamp[gb - 1] === bg && dist[gb - 1] === d - 1;
        const cr = bfsStamp[gb + 1] === bg && dist[gb + 1] === d - 1;
        if ((dl || dr) && (!dl || cl) && (!dr || cr)) continue; // its slide goes that way
      }
    }
    // Step toward the opening: a neighbour one BFS layer closer, preferring an empty one.
    let target = -1;
    let swap = -1;
    const rot = (tick + k) & 7;
    for (let kk = 0; kk < 8; kk++) {
      const q = (kk + rot) & 7;
      const dx = DX8[q];
      const dy = DY8[q];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const gj = S.base + j;
      if (bfsStamp[gj] !== bg || dist[gj] !== d - 1) continue;
      if (dx !== 0 && dy !== 0 && !passable(cells, mask, w, h, nx, y, c) && !passable(cells, mask, w, h, x, ny, c)) continue;
      const vj = cells[j];
      if (vj === 0) {
        target = j;
        break;
      }
      if (swap < 0 && (vj & COLOR_MASK) === c && pulled[gj] !== gen) swap = j;
    }
    if (target < 0 && swap < 0) continue;
    // In the airflow (an empty cell one layer closer): held against gravity this step. A grain
    // packed inside a matching body stays ordinary sand, so the body never hovers.
    if (target >= 0) {
      stamp[g] = gen;
      S.held = true;
    }
    if (nextFloat(rng) >= P_PULL) continue;
    if (target >= 0) {
      cells[target] = v;
      cells[i] = 0;
      stamp[S.base + target] = gen;
      pulled[S.base + target] = gen;
    } else {
      // Same-color swap: purely the shades flowing toward the opening. It holds nothing, so
      // both grains still get gravity this step.
      cells[i] = cells[swap];
      cells[swap] = v;
      pulled[S.base + swap] = gen;
      pulled[g] = gen;
    }
    S.touched = true;
  }
  return credit;
}
