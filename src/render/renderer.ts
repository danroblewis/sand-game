// Canvas renderer. Reads GameState; never mutates it.
import type { Box, ColorId, GameEvent, GameState, SandRegion, ShapeName, Vec } from '../core/types';
import { SHADE_COUNT } from '../core/types';
import { SHAPES } from '../core/shapes';
import { regionVersion } from '../core/sand';
import {
  BOARD_BG,
  GRID_LINE,
  GRAIN_U32,
  ICE_FILL_BOTTOM,
  ICE_FILL_TOP,
  ICE_STROKE,
  ICE_TEXT,
  boxFill,
  boxGlow,
  boxStroke,
  colorHex,
  colorRGBA,
  grainRGBA,
} from './colors';

// ---------- Effects ----------

interface Spark {
  x: number; // grid units (board space)
  y: number;
  vx: number; // cells / s
  vy: number;
  size: number; // fraction of a cell
  rgb: string;
}

export type Effect =
  | {
      kind: 'pop';
      t0: number;
      dur: number;
      x: number;
      y: number;
      cells: Vec[];
      color: ColorId;
      sparks: Spark[];
    }
  | { kind: 'thaw'; t0: number; dur: number; boxId: number };

export interface View {
  selectedBoxId: number | null;
  dragBoxId: number | null;
  hoverBoxId: number | null;
  effects: Effect[];
}

export function createView(): View {
  return { selectedBoxId: null, dragBoxId: null, hoverBoxId: null, effects: [] };
}

const POP_MS = 250;
const SPARK_MS = 650;
const THAW_MS = 450;

/** Build an effect for a game event (or null if the event has no visual). */
export function effectForEvent(ev: GameEvent, now: number): Effect | null {
  if (ev.type === 'boxCompleted') {
    let cx = 0;
    let cy = 0;
    for (const c of ev.cells) {
      cx += c.x + 0.5;
      cy += c.y + 0.5;
    }
    cx = ev.x + cx / ev.cells.length;
    cy = ev.y + cy / ev.cells.length;
    const sparks: Spark[] = [];
    const n = 10 + ev.cells.length * 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      const [r, g, b] = grainRGBA(ev.color, Math.floor(Math.random() * SHADE_COUNT));
      sparks.push({
        x: cx + (Math.random() - 0.5) * 0.6,
        y: cy + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 2.5,
        size: 0.06 + Math.random() * 0.06,
        rgb: `rgb(${r},${g},${b})`,
      });
    }
    return { kind: 'pop', t0: now, dur: SPARK_MS, x: ev.x, y: ev.y, cells: ev.cells, color: ev.color, sparks };
  }
  if (ev.type === 'boxUnfrozen') {
    return { kind: 'thaw', t0: now, dur: THAW_MS, boxId: ev.boxId };
  }
  return null;
}

// ---------- Shape outlines ----------

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
function shapeOutline(shape: ShapeName, cells: Vec[]): Vec[][] {
  let o = outlineCache.get(shape);
  if (!o) {
    o = outlineLoops(cells.length ? cells : SHAPES[shape]);
    outlineCache.set(shape, o);
  }
  return o;
}

/** Rounded, inset path following loops (grid units) placed at device pixel (px, py). */
function loopsPath(loops: Vec[][], px: number, py: number, cs: number, inset: number, radius: number): Path2D {
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

// ---------- Sand blitting ----------

interface RegionCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  u32: Uint32Array;
  version: number;
  count: number;
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

// ---------- Renderer ----------

interface RenderPos {
  rx: number;
  ry: number;
}

const LERP_TAU = 0.08; // seconds

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Device pixels per CSS pixel. */
  dpr = 1;
  /** Cell size in device pixels. */
  cellSize = 32;
  /** Board top-left in device pixels. */
  originX = 0;
  originY = 0;
  private boardW = 6;
  private boardH = 8;
  private regionCanvases = new WeakMap<SandRegion, RegionCanvas>();
  private positions = new Map<number, RenderPos>();
  private lastTime = 0;
  private frost: CanvasPattern | null = null;
  private lastState: GameState | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    canvas.style.touchAction = 'none';
    this.resize();
  }

  /** Recompute backing-store size and board layout from the canvas' CSS size. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = dpr;
    const cssW = this.canvas.clientWidth || 300;
    const cssH = this.canvas.clientHeight || 300;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.layout();
  }

  /** Board margin in cells on each side (room for the board frame). */
  private static readonly MARGIN = 0.12;

  /** Set the board size in cells (before the first render of a new level). */
  setBoardSize(w: number, h: number): void {
    if (w === this.boardW && h === this.boardH) return;
    this.boardW = w;
    this.boardH = h;
    this.layout();
  }

  /** CSS height the canvas needs to show the board as large as possible inside availW x availH CSS px. */
  fitHeight(availW: number, availH: number): number {
    const m = Renderer.MARGIN * 2;
    const cs = Math.max(8, Math.min(availW / (this.boardW + m), availH / (this.boardH + m)));
    return Math.min(availH, Math.ceil(cs * (this.boardH + m)));
  }

  private layout(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const m = Renderer.MARGIN * 2;
    const cs = Math.max(8, Math.floor(Math.min(W / (this.boardW + m), H / (this.boardH + m))));
    this.cellSize = cs;
    this.originX = Math.round((W - cs * this.boardW) / 2);
    this.originY = Math.round((H - cs * this.boardH) / 2);
  }

  /** Forget animated positions (call on level load so boxes snap into place). */
  reset(): void {
    this.positions.clear();
  }

  /** CSS pixel (relative to canvas top-left) -> fractional grid coordinates. */
  pixelToGrid(px: number, py: number): Vec {
    return {
      x: (px * this.dpr - this.originX) / this.cellSize,
      y: (py * this.dpr - this.originY) / this.cellSize,
    };
  }

  /**
   * Active box under a CSS pixel position (frozen boxes included). If nothing is directly under
   * the point, returns the nearest movable box within `slop` CSS px (finger-friendly hit area).
   */
  boxAtPixel(state: GameState, px: number, py: number, slop = 0): Box | undefined {
    const g = this.pixelToGrid(px, py);
    const gx = Math.floor(g.x);
    const gy = Math.floor(g.y);
    for (const b of state.boxes) {
      if (b.state !== 'active') continue;
      for (const c of b.cells) {
        if (b.x + c.x === gx && b.y + c.y === gy) return b;
      }
    }
    if (slop <= 0) return undefined;
    const cellCss = this.cellSize / this.dpr;
    let best: Box | undefined;
    let bestD = slop / cellCss; // in cells
    for (const b of state.boxes) {
      if (b.state !== 'active' || b.frozen > 0) continue;
      for (const c of b.cells) {
        const x0 = b.x + c.x;
        const y0 = b.y + c.y;
        const dx = Math.max(x0 - g.x, 0, g.x - (x0 + 1));
        const dy = Math.max(y0 - g.y, 0, g.y - (y0 + 1));
        const d = Math.hypot(dx, dy);
        if (d <= bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    return best;
  }

  render(state: GameState, view: View, now: number = performance.now()): void {
    if (state.width !== this.boardW || state.height !== this.boardH) {
      this.boardW = state.width;
      this.boardH = state.height;
      this.layout();
    }
    if (state !== this.lastState) {
      this.lastState = state;
      this.positions.clear();
    }
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    const k = dt > 0 ? 1 - Math.exp(-dt / LERP_TAU) : 1;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    this.drawBoard();
    for (const sb of state.sandBoxes) this.drawSandBox(sb.x, sb.y, sb.w, sb.h, sb.region);

    // Update animated positions.
    for (const b of state.boxes) {
      let p = this.positions.get(b.id);
      if (!p) {
        p = { rx: b.x, ry: b.y };
        this.positions.set(b.id, p);
      } else {
        p.rx += (b.x - p.rx) * k;
        p.ry += (b.y - p.ry) * k;
        if (Math.abs(b.x - p.rx) < 0.002) p.rx = b.x;
        if (Math.abs(b.y - p.ry) < 0.002) p.ry = b.y;
      }
    }

    // Draw resting boxes first, then the selected one, then the dragged one on top.
    let selBox: Box | null = null;
    let dragBox: Box | null = null;
    for (const b of state.boxes) {
      if (b.state !== 'active') continue;
      if (b.id === view.dragBoxId) dragBox = b;
      else if (b.id === view.selectedBoxId) selBox = b;
      else this.drawBox(b, view, now);
    }
    if (selBox) this.drawBox(selBox, view, now);
    if (dragBox) this.drawBox(dragBox, view, now);

    this.drawEffects(view, now);
  }

  private drawBoard(): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const x = this.originX;
    const y = this.originY;
    const w = cs * this.boardW;
    const h = cs * this.boardH;
    const r = cs * 0.18;
    const pad = Math.round(cs * 0.08);
    const bg = roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, r);
    ctx.fillStyle = BOARD_BG;
    ctx.fill(bg);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = Math.max(1, this.dpr);
    ctx.stroke(bg);

    ctx.beginPath();
    for (let i = 1; i < this.boardW; i++) {
      const lx = x + i * cs + 0.5;
      ctx.moveTo(lx, y + cs * 0.1);
      ctx.lineTo(lx, y + h - cs * 0.1);
    }
    for (let j = 1; j < this.boardH; j++) {
      const ly = y + j * cs + 0.5;
      ctx.moveTo(x + cs * 0.1, ly);
      ctx.lineTo(x + w - cs * 0.1, ly);
    }
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = Math.max(1, Math.round(this.dpr));
    ctx.stroke();
  }

  /** Refresh and return the offscreen canvas for a region (1px per grain). */
  private regionCanvas(region: SandRegion): RegionCanvas {
    let rc = this.regionCanvases.get(region);
    if (!rc) {
      const canvas = document.createElement('canvas');
      canvas.width = region.w;
      canvas.height = region.h;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(region.w, region.h);
      rc = { canvas, ctx, img, u32: new Uint32Array(img.data.buffer), version: -1, count: -1 };
      this.regionCanvases.set(region, rc);
    }
    // Skip regions whose grains have not changed since the last upload.
    const version = regionVersion(region);
    if (version === rc.version && region.count === rc.count) return rc;
    rc.version = version;
    rc.count = region.count;
    const cells = region.cells;
    const u = rc.u32;
    const T = GRAIN_U32;
    const n = cells.length;
    for (let i = 0; i < n; i++) u[i] = T[cells[i]];
    rc.ctx.putImageData(rc.img, 0, 0);
    return rc;
  }

  private drawSandBox(gx: number, gy: number, gw: number, gh: number, region: SandRegion): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const x = this.originX + gx * cs;
    const y = this.originY + gy * cs;
    const w = gw * cs;
    const h = gh * cs;
    const inset = Math.max(1, Math.round(cs * 0.04));
    const r = cs * 0.12;
    const glass = roundRectPath(x + inset, y + inset, w - inset * 2, h - inset * 2, r);

    // Glass body.
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill(glass);

    ctx.save();
    ctx.clip(glass);
    const rc = this.regionCanvas(region);
    ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, x, y, w, h);
    // Inner shadow along the edges.
    const sh = cs * 0.18;
    let g = ctx.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, sh);
    g = ctx.createLinearGradient(x, 0, x + sh, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, sh, h);
    g = ctx.createLinearGradient(x + w, 0, x + w - sh, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + w - sh, y, sh, h);
    // Glass sheen.
    g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(220,232,255,0.38)';
    ctx.lineWidth = Math.max(1, cs * 0.035);
    ctx.stroke(glass);
    // Highlight on the top-left lip.
    ctx.beginPath();
    ctx.moveTo(x + inset + r, y + inset + ctx.lineWidth);
    ctx.lineTo(x + w * 0.45, y + inset + ctx.lineWidth);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();
  }

  private frostPattern(): CanvasPattern | null {
    if (this.frost) return this.frost;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.45})`;
      const s = Math.random() < 0.85 ? 1 : 2;
      g.fillRect(Math.random() * 96, Math.random() * 96, s, s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const x0 = Math.random() * 96;
      const y0 = Math.random() * 96;
      const len = 6 + Math.random() * 16;
      const a = Math.random() * Math.PI;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      g.stroke();
    }
    this.frost = this.ctx.createPattern(c, 'repeat');
    return this.frost;
  }

  private drawBox(b: Box, view: View, now: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const pos = this.positions.get(b.id);
    const rx = pos ? pos.rx : b.x;
    const ry = pos ? pos.ry : b.y;
    const px = this.originX + rx * cs;
    const py = this.originY + ry * cs;
    const loops = shapeOutline(b.shape, b.cells);
    const inset = cs * 0.06;
    const radius = Math.min(cs * 0.18, (cs - inset * 2) / 2);
    const path = loopsPath(loops, px, py, cs, inset, radius);
    const selected = b.id === view.selectedBoxId;
    const dragging = b.id === view.dragBoxId;
    const hover = b.id === view.hoverBoxId;
    const lw = Math.max(2, cs * 0.06);

    if (b.frozen > 0) {
      const grad = ctx.createLinearGradient(px, py, px, py + b.bh * cs);
      grad.addColorStop(0, ICE_FILL_TOP);
      grad.addColorStop(1, ICE_FILL_BOTTOM);
      ctx.fillStyle = grad;
      ctx.fill(path);
      const frost = this.frostPattern();
      if (frost) {
        ctx.fillStyle = frost;
        ctx.fill(path);
      }
      ctx.strokeStyle = ICE_STROKE;
      ctx.lineWidth = lw;
      ctx.stroke(path);
      // Number on the cell nearest the shape centroid.
      let mx = 0;
      let my = 0;
      for (const c of b.cells) {
        mx += c.x + 0.5;
        my += c.y + 0.5;
      }
      mx /= b.cells.length;
      my /= b.cells.length;
      let best = b.cells[0];
      let bestD = Infinity;
      for (const c of b.cells) {
        const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      // Rectangles: true centre. Other shapes: centre of the cell nearest the centroid.
      const rect = b.cells.length === b.bw * b.bh;
      const tx = px + (rect ? mx : best.x + 0.5) * cs;
      const ty = py + (rect ? my : best.y + 0.5) * cs;
      ctx.fillStyle = ICE_TEXT;
      ctx.font = `800 ${Math.round(cs * 0.56)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.frozen), tx, ty + cs * 0.03);
    } else {
      ctx.fillStyle = boxFill(b.color);
      ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      const region = b.region;
      const rc = this.regionCanvas(region);
      ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, px, py, b.bw * cs, b.bh * cs);
      // Subtle top sheen.
      const g = ctx.createLinearGradient(0, py, 0, py + cs * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px, py, b.bw * cs, cs * 0.5);
      ctx.restore();

      if (selected || dragging) {
        ctx.save();
        ctx.shadowColor = boxGlow(b.color);
        ctx.shadowBlur = cs * 0.35;
        ctx.strokeStyle = boxGlow(b.color);
        ctx.lineWidth = lw * 1.6;
        ctx.stroke(path);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1, lw * 0.45);
        ctx.stroke(path);
      } else {
        ctx.strokeStyle = boxStroke(b.color);
        ctx.lineWidth = lw;
        ctx.stroke(path);
        if (hover) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = Math.max(1, lw * 0.5);
          ctx.stroke(path);
        }
      }
    }

    // Thaw flash.
    for (const e of view.effects) {
      if (e.kind !== 'thaw' || e.boxId !== b.id) continue;
      const t = (now - e.t0) / e.dur;
      if (t < 0 || t > 1) continue;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fill(path);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = colorHex(b.color);
      ctx.lineWidth = lw * (1 + t * 2);
      ctx.stroke(path);
      ctx.restore();
    }
  }

  private drawEffects(view: View, now: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const effects = view.effects;
    let w = 0;
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      const age = now - e.t0;
      if (age > e.dur) continue; // expired: drop
      effects[w++] = e;
      if (e.kind !== 'pop') continue;

      // Pop: scale-up + fade of the shape.
      const tp = age / POP_MS;
      if (tp <= 1) {
        let mx = 0;
        let my = 0;
        for (const c of e.cells) {
          mx += c.x + 0.5;
          my += c.y + 0.5;
        }
        mx /= e.cells.length;
        my /= e.cells.length;
        const ease = 1 - (1 - tp) * (1 - tp);
        const s = 1 + 0.28 * ease;
        const cx = this.originX + (e.x + mx) * cs;
        const cy = this.originY + (e.y + my) * cs;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
        const loops = outlineLoops(e.cells);
        const path = loopsPath(loops, this.originX + e.x * cs, this.originY + e.y * cs, cs, cs * 0.06, cs * 0.18);
        ctx.globalAlpha = 1 - tp;
        ctx.fillStyle = colorRGBA(e.color, 0.85);
        ctx.fill(path);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, cs * 0.06);
        ctx.stroke(path);
        ctx.restore();
      }

      // Sparks.
      const ts = age / 1000;
      const fade = 1 - age / e.dur;
      ctx.globalAlpha = Math.max(0, fade);
      for (const sp of e.sparks) {
        const sx = sp.x + sp.vx * ts;
        const sy = sp.y + sp.vy * ts + 0.5 * 9 * ts * ts;
        const size = Math.max(this.dpr * 1.5, sp.size * cs);
        ctx.fillStyle = sp.rgb;
        ctx.fillRect(this.originX + sx * cs - size / 2, this.originY + sy * cs - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }
    effects.length = w;
  }
}

