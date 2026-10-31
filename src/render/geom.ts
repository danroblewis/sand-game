// Shared drawing geometry (all skins): rounded shape outlines, direction tables.
import type { Dir, ShapeName, Vec } from '../core/types';
import { SHAPES } from '../core/shapes';

export const DIR_VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** Rotation that maps the local +x axis onto `dir`. */
export const DIR_ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
/** Pop scale-up duration (ms). */
export const POP_MS = 250;

/**
 * Union outline of a set of unit cells as closed loops of corner vertices (grid units, clockwise in
 * y-down; holes run the other way). Cells are grouped by 4-connectivity, so cells touching only at a
 * corner get separate loops; at a "pinch" vertex (two cells diagonal inside one group, i.e. two
 * holes or a hole and the outside meeting at a corner) the tracer turns left, so each hole keeps
 * its own loop.
 */
export function outlineLoops(cells: Vec[]): Vec[][] {
  const has = new Set(cells.map((c) => `${c.x},${c.y}`));
  // 4-connected components, in order of first appearance
  const comp = new Map<string, number>();
  const groups: Vec[][] = [];
  for (const c of cells) {
    const k0 = `${c.x},${c.y}`;
    if (comp.has(k0)) continue;
    const id = groups.length;
    const members: Vec[] = [];
    comp.set(k0, id);
    const q: Vec[] = [c];
    for (let i = 0; i < q.length; i++) {
      const { x, y } = q[i];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const k = `${x + dx},${y + dy}`;
        if (has.has(k) && !comp.has(k)) {
          comp.set(k, id);
          q.push({ x: x + dx, y: y + dy });
        }
      }
    }
    // keep the caller's cell order inside the group (stable loop start points)
    groups.push(members);
  }
  const seen = new Set<string>();
  for (const c of cells) {
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    groups[comp.get(k)!].push(c);
  }
  const loops: Vec[][] = [];
  for (const g of groups) traceGroup(g, has, loops);
  return loops;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function traceGroup(cells: Vec[], has: Set<string>, loops: Vec[][]): void {
  const out = new Map<string, Edge[]>(); // start vertex -> boundary edges leaving it
  const order: Edge[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const e = { x1, y1, x2, y2 };
    const k = `${x1},${y1}`;
    const list = out.get(k);
    if (list) list.push(e);
    else out.set(k, [e]);
    order.push(e);
  };
  for (const { x, y } of cells) {
    if (!has.has(`${x},${y - 1}`)) add(x, y, x + 1, y);
    if (!has.has(`${x + 1},${y}`)) add(x + 1, y, x + 1, y + 1);
    if (!has.has(`${x},${y + 1}`)) add(x + 1, y + 1, x, y + 1);
    if (!has.has(`${x - 1},${y}`)) add(x, y + 1, x, y);
  }
  const used = new Set<Edge>();
  // A vertex with two outgoing edges is a pinch: two cells of this (4-connected) group touch
  // diagonally there. Turning left keeps those cells joined through the corner, so each hole gets
  // its own loop. Preference for incoming (dx, dy): left (dy, -dx), straight, right (-dy, dx).
  const rank = (dx: number, dy: number, e: Edge) => {
    const ex = Math.sign(e.x2 - e.x1);
    const ey = Math.sign(e.y2 - e.y1);
    if (ex === dy && ey === -dx) return 0;
    if (ex === dx && ey === dy) return 1;
    if (ex === -dy && ey === dx) return 2;
    return 3; // reversal: never on a valid boundary
  };
  for (const first of order) {
    if (used.has(first)) continue;
    used.add(first);
    const raw: Vec[] = [{ x: first.x1, y: first.y1 }];
    let cur = first;
    for (let guard = 0; guard < 100000; guard++) {
      const dx = Math.sign(cur.x2 - cur.x1);
      const dy = Math.sign(cur.y2 - cur.y1);
      const atStart = cur.x2 === first.x1 && cur.y2 === first.y1;
      let next: Edge | null = null;
      let best = 4;
      for (const e of out.get(`${cur.x2},${cur.y2}`) ?? []) {
        if (used.has(e) && !(atStart && e === first)) continue;
        const r = rank(dx, dy, e);
        if (r < best) {
          best = r;
          next = e;
        }
      }
      if (!next || next === first) break;
      used.add(next);
      raw.push({ x: next.x1, y: next.y1 });
      cur = next;
    }
    // Drop collinear vertices.
    const n = raw.length;
    const loop: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const p = raw[(i - 1 + n) % n];
      const c = raw[i];
      const q = raw[(i + 1) % n];
      const cross = (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x);
      if (cross !== 0) loop.push(c);
    }
    if (loop.length >= 3) loops.push(loop);
  }
}

const outlineCache = new Map<string, Vec[][]>();
export function shapeOutline(shape: ShapeName, cells: Vec[]): Vec[][] {
  let o = outlineCache.get(shape);
  if (!o) {
    o = outlineLoops(cells.length ? cells : SHAPES[shape]);
    outlineCache.set(shape, o);
  }
  return o;
}

const counterCache = new Map<string, Vec>();
/**
 * Where a box's centred label (the frozen counter) goes, in grid units relative to the box origin:
 * the true centre for rectangles, else the centre of the cell nearest the centroid. Cached per shape.
 */
export function shapeLabelPos(shape: ShapeName, cells: Vec[], bw: number, bh: number): Vec {
  let p = counterCache.get(shape);
  if (p) return p;
  let mx = 0;
  let my = 0;
  for (const c of cells) {
    mx += c.x + 0.5;
    my += c.y + 0.5;
  }
  mx /= cells.length;
  my /= cells.length;
  let best = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  p = cells.length === bw * bh ? { x: mx, y: my } : { x: best.x + 0.5, y: best.y + 0.5 };
  counterCache.set(shape, p);
  return p;
}

/** Rounded, inset path following loops (grid units) placed at device pixel (px, py). */
export function loopsPath(loops: Vec[][], px: number, py: number, cs: number, inset: number, radius: number): Path2D {
  const path = new Path2D();
  for (const loop of loops) {
    const n = loop.length;
    const pts: number[] = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = loop[(i - 1 + n) % n];
      const c = loop[i];
      const q = loop[(i + 1) % n];
      const d1x = Math.sign(c.x - p.x);
      const d1y = Math.sign(c.y - p.y);
      const d2x = Math.sign(q.x - c.x);
      const d2y = Math.sign(q.y - c.y);
      // Inward normal of a clockwise (y-down) edge is (-dy, dx).
      pts[i * 2] = px + c.x * cs + inset * (-d1y - d2y);
      pts[i * 2 + 1] = py + c.y * cs + inset * (d1x + d2x);
    }
    const lx = pts[(n - 1) * 2];
    const ly = pts[(n - 1) * 2 + 1];
    path.moveTo((lx + pts[0]) / 2, (ly + pts[1]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      path.arcTo(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], radius);
    }
    path.closePath();
  }
  return path;
}


export function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

