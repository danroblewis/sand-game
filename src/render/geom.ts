// Shared drawing geometry (all skins): rounded shape outlines, direction tables.
import type { Dir, ShapeName, Vec } from '../core/types';
import { SHAPES } from '../core/shapes';

export const DIR_VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** Rotation that maps the local +x axis onto `dir`. */
export const DIR_ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
/** Pop scale-up duration (ms). */
export const POP_MS = 250;

/** Union outline of a set of unit cells as closed loops of corner vertices (grid units, clockwise in y-down). */
export function outlineLoops(cells: Vec[]): Vec[][] {
  const has = new Set(cells.map((c) => `${c.x},${c.y}`));
  const edges = new Map<string, Vec>(); // start "x,y" -> end
  const add = (x1: number, y1: number, x2: number, y2: number) => edges.set(`${x1},${y1}`, { x: x2, y: y2 });
  for (const { x, y } of cells) {
    if (!has.has(`${x},${y - 1}`)) add(x, y, x + 1, y);
    if (!has.has(`${x + 1},${y}`)) add(x + 1, y, x + 1, y + 1);
    if (!has.has(`${x},${y + 1}`)) add(x + 1, y + 1, x, y + 1);
    if (!has.has(`${x - 1},${y}`)) add(x, y + 1, x, y);
  }
  const loops: Vec[][] = [];
  while (edges.size > 0) {
    const firstKey = edges.keys().next().value as string;
    const [sx, sy] = firstKey.split(',').map(Number);
    const raw: Vec[] = [{ x: sx, y: sy }];
    let key = firstKey;
    for (let guard = 0; guard < 1000; guard++) {
      const end = edges.get(key);
      if (!end) break;
      edges.delete(key);
      if (end.x === sx && end.y === sy) break;
      raw.push(end);
      key = `${end.x},${end.y}`;
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
  return loops;
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

