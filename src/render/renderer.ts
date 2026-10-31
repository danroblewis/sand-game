// Canvas renderer. Reads GameState; never mutates it.
import type { Box, ColorId, Dir, GameEvent, GameState, SandRegion, ShapeName, ConveyorState, Vec } from '../core/types';
import { SHADE_COUNT } from '../core/types';
import { SHAPES } from '../core/shapes';
import { regionVersion } from '../core/sand';
import { CONVEYOR_INTERVAL, conveyorPlan } from '../core';
import * as Core from '../core';

// Box gravity exports may not exist yet in the core: read them through the namespace, guarded.
const coreAny = Core as unknown as Record<string, unknown>;
function fallPlanOf(state: GameState): Set<number> | null {
  const fp = coreAny.fallPlan;
  if (!state.boxGravity || typeof fp !== 'function') return null;
  try {
    return (fp as (s: GameState) => Set<number>)(state);
  } catch {
    return null;
  }
}
/** Will the hero fall on the next fall step? Uses the core's helper when present. */
function heroWillFall(state: GameState, falls: Set<number> | null): boolean {
  const h = state.hero;
  if (!h || !state.boxGravity) return false;
  const f = coreAny.heroWillFall;
  if (typeof f === 'function') {
    try {
      return !!(f as (s: GameState) => boolean)(state);
    } catch {
      /* fall through to the local check */
    }
  }
  const x = h.x;
  const y = h.y + 1;
  if (y >= state.height) return false;
  for (const w of state.walls ?? []) if (w.x === x && w.y === y) return false;
  for (const sb of state.sandBoxes) if (x >= sb.x && x < sb.x + sb.w && y >= sb.y && y < sb.y + sb.h) return false;
  for (const b of state.boxes) {
    if (b.state !== 'active') continue;
    for (const c of b.cells) if (b.x + c.x === x && b.y + c.y === y) return !!falls && falls.has(b.id);
  }
  return true;
}

function slidePlanOf(state: GameState): Map<number, Dir> | null {
  const sp = coreAny.slidePlan;
  if (!state.hero || typeof sp !== 'function') return null;
  if (!state.boxes.some((b) => (b as Box & { sliding?: Dir | null }).sliding)) return null;
  try {
    return (sp as (s: GameState) => Map<number, Dir>)(state);
  } catch {
    return null;
  }
}
/** Boxes a driven-box train moves on the next force step (id -> dir), guarded. */
function forcePlanOf(state: GameState): Map<number, Dir> | null {
  const fp = coreAny.forcePlan;
  if (typeof fp !== 'function' || !state.boxes.some((b) => (b as Box & { force?: Dir | null }).force)) return null;
  try {
    const r = (fp as (s: GameState) => Map<number, Dir> | Set<number>)(state);
    if (r instanceof Map) return r;
    // a Set of ids: every moving box goes the way of the (first) driven box in the set
    const m = new Map<number, Dir>();
    const driver = state.boxes.find((b) => r.has(b.id) && (b as Box & { force?: Dir | null }).force);
    const d = driver ? (driver as Box & { force: Dir }).force : null;
    if (d) for (const id of r) m.set(id, d);
    return m;
  } catch {
    return null;
  }
}

/** Direction the thrown hero slides on the next slide step, or null (guarded). */
function heroSlideOf(state: GameState): Dir | null {
  const f = coreAny.heroSlidePlan;
  const h = state.hero as (GameState['hero'] & { sliding?: Dir | null }) | null;
  if (!h || !h.sliding || typeof f !== 'function') return null;
  try {
    return (f as (s: GameState) => Dir | null)(state);
  } catch {
    return null;
  }
}

function kickInterval(): number {
  const v = coreAny.KICK_INTERVAL;
  return typeof v === 'number' && v > 0 ? v : 2;
}

function boxFallInterval(): number {
  const v = coreAny.BOX_FALL_INTERVAL;
  return typeof v === 'number' && v > 0 ? v : 4;
}
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
  | { kind: 'thaw'; t0: number; dur: number; boxId: number }
  /** Landing squash for a box that fell `fell` cells. */
  | { kind: 'land'; t0: number; dur: number; boxId: number; amp: number }
  /** Off-screen event marker at the viewport edge (big maps). x/y in grid cells. */
  | { kind: 'ping'; t0: number; dur: number; x: number; y: number; color: ColorId }
  /** Dust puff at the bottom edge of a landed box. */
  | { kind: 'dust'; t0: number; dur: number; sparks: Spark[] }
  /** Sparkle over a sand box whose leftover grains of `color` just dissolved. */
  | { kind: 'debris'; t0: number; dur: number; color: ColorId; x: number; y: number; w: number; h: number; sparks: Spark[] };

export interface View {
  selectedBoxId: number | null;
  dragBoxId: number | null;
  hoverBoxId: number | null;
  effects: Effect[];
  /** Fraction (0..1) of the next sim step already elapsed (fixed-step accumulator / step length). */
  stepFrac: number;
  /** Big maps: the last box the player moved (camera focus in drag levels). */
  lastMovedBoxId?: number | null;
  /** Big maps: pointer near a viewport edge while dragging (-1..1 per axis): camera looks ahead. */
  dragEdge?: { x: number; y: number };
  /** Hero swipe trail: kick when the drag reaches the kick distance. */
  charge?: HeroCharge | null;
}

export interface HeroCharge {
  dir: Dir;
  /** Drag length along `dir`, CSS px. */
  dist: number;
  /** Release kicks (the drag reached the kick distance). */
  armed: boolean;
  /** Set on release: the trail fades out from this time (performance.now ms). */
  fadeAt?: number;
}

export function createView(): View {
  return { selectedBoxId: null, dragBoxId: null, hoverBoxId: null, effects: [], stepFrac: 0 };
}

const POP_MS = 250;
const SPARK_MS = 650;
const THAW_MS = 450;
const DEBRIS_MS = 650;
/** Box position lerp time constant while a conveyor carries the box. */
const PUSH_LERP_TAU = 0.12;
/** A color counts as "present" in a region if seen within this window (debris sparkle placement). */
const DEBRIS_SEEN_MS = 2500;

const DIR_VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** Rotation that maps the local +x axis onto `dir`. */
const DIR_ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
/** Belt chevron spacing (cells). They crawl exactly one cell per belt step, in sync with riders. */
const BELT_SPACING = 0.5;
/** Blocked riders nudge against their obstacle just before each belt step. */
const NUDGE_CELLS = 0.045;
const NUDGE_WINDOW = 0.2; // last fraction of the belt period
const EMPTY_PLAN: Map<number, Dir> = new Map();
/** Effect target id used for the hero (box ids are >= 0). */
const HERO_ID = -1;
/** Hero walk glide: one cell in ~90 ms. */
const HERO_WALK_SPEED = 1 / 0.09;
/** A belt looks "busy" for this long after it moved a box. */
const BELT_ACTIVE_MS = 300;

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

/** True if two pop effects' cells share an edge (absolute grid coordinates). */
function popsTouch(a: Extract<Effect, { kind: 'pop' }>, b: Extract<Effect, { kind: 'pop' }>): boolean {
  const set = new Set(a.cells.map((c) => `${a.x + c.x},${a.y + c.y}`));
  for (const c of b.cells) {
    const x = b.x + c.x;
    const y = b.y + c.y;
    if (set.has(`${x + 1},${y}`) || set.has(`${x - 1},${y}`) || set.has(`${x},${y + 1}`) || set.has(`${x},${y - 1}`)) return true;
  }
  return false;
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
  /** performance.now() when each color (0..31) was last seen in the region. */
  colorSeen: Float64Array;
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

export type CameraMode = 'fit' | 'scroll' | 'rooms';
/** Big maps: cells across the shorter screen side. */
const CAM_CELLS_ACROSS = 8.5;
const CAM_FOLLOW_TAU = 0.18;
const ROOM_SNAP_MS = 250;
const OVERVIEW_MS = 220;
const PING_MS = 1200;

interface RenderPos {
  rx: number;
  ry: number;
  /** Lerp time constant in seconds (longer while a conveyor carries the box). */
  tau: number;
  /** True once a gliding rider is locked onto its exact belt position (drawn directly, no lerp). */
  locked: boolean;
  /** Catch-up speed allowance (cells/s) carried over from a glide that just ended (0 = none). */
  carry: number;
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
  /** Last time each conveyor moved a box (performance.now ms). */
  private beltActiveAt = new Map<number, number>();
  /** Driven-box trains moving on the next force step (set each frame). */
  private forces: Map<number, Dir> | null = null;
  /** Drawn hero position (grid units) and the speed allowance carried out of a fall. */
  private heroPos: { rx: number; ry: number; carry: number } | null = null;
  /** Most recent pop effect (to merge a group's simultaneous pops into it). */
  private lastPop: Extract<Effect, { kind: 'pop' }> | null = null;
  /** Union outlines of the wall cells for the current state (rebuilt on state change). */
  private wallLoops: Vec[][] = [];
  /** Belt direction per grid cell "x,y" for the current state (rebuilt on state change). */
  private beltCells = new Map<string, Dir>();

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
    this.fitCs = cs;
    this.fitOx = Math.round((W - cs * this.boardW) / 2);
    this.fitOy = Math.round((H - cs * this.boardH) / 2);
    // Big-map cell size: ~8.5 cells across the shorter side (today's phone sizing).
    this.camCs = Math.max(8, Math.floor(Math.min(W, H) / CAM_CELLS_ACROSS));
    this.cellSize = cs;
    this.originX = this.fitOx;
    this.originY = this.fitOy;
  }

  // ---------- Camera (big maps: LevelDef.camera 'scroll' | 'rooms') ----------

  private camMode: CameraMode = 'fit';
  private fitCs = 32;
  private fitOx = 0;
  private fitOy = 0;
  private camCs = 32;
  private camX = 0;
  private camY = 0;
  private camInit = false;
  private camAnim: { t0: number; fx: number; fy: number; tx: number; ty: number } | null = null;
  private room: { x: number; y: number } | null = null;
  /** Overview tap / pan: look here until the player moves something. `direct` = 1:1 pan, no easing. */
  private manualFocus: { x: number; y: number; key: string; direct?: boolean } | null = null;
  private ovOn = false;
  private ovT = 0;
  /** Camera viewport in grid cells this frame (for pings / overview outline). */
  private view0 = { x: 0, y: 0, w: 0, h: 0 };

  /** Set the level's camera mode (resets the camera). */
  setCamera(mode: CameraMode | undefined): void {
    this.camMode = mode ?? 'fit';
    this.camInit = false;
    this.camAnim = null;
    this.room = null;
    this.manualFocus = null;
    this.ovOn = false;
    this.ovT = 0;
  }

  /** True when the board is larger than the screen and a camera is in use. */
  get cameraActive(): boolean {
    return this.camMode !== 'fit' && this.fitCs < this.camCs;
  }

  get overview(): boolean {
    return this.ovOn;
  }

  setOverview(on: boolean): void {
    if (!this.cameraActive) on = false;
    this.ovOn = on;
  }

  toggleOverview(): void {
    this.setOverview(!this.ovOn);
  }

  /** Tap in the overview (CSS px): pan there and return to the normal view. */
  overviewTap(px: number, py: number): void {
    const g = this.pixelToGrid(px, py);
    const x = Math.max(0, Math.min(this.boardW, g.x));
    const y = Math.max(0, Math.min(this.boardH, g.y));
    this.manualFocus = { x, y, key: this.focusKey };
    this.ovOn = false;
  }

  /** Pan the camera by a pointer delta in CSS px (drag on empty board / two fingers): 1:1, clamped. */
  panBy(dxCss: number, dyCss: number): void {
    if (!this.cameraActive || this.ovOn) return;
    const cs = this.camCs / this.dpr; // CSS px per cell
    const vw = this.canvas.width / this.camCs;
    const vh = this.canvas.height / this.camCs;
    const clampC = (c: number, v: number, size: number) => (size <= v ? size / 2 : Math.max(v / 2, Math.min(size - v / 2, c)));
    const x = clampC(this.camX - dxCss / cs, vw, this.boardW);
    const y = clampC(this.camY - dyCss / cs, vh, this.boardH);
    this.camX = x;
    this.camY = y;
    this.camAnim = null;
    this.manualFocus = { x, y, key: this.focusKey, direct: true };
  }

  private focusKey = '';

  /** Focus point (cells) for the camera: hero, held box, last moved box, else board centre. */
  private focusPoint(state: GameState, view: View): { x: number; y: number; key: string } {
    if (state.hero) {
      const p = this.heroPos;
      return { x: (p ? p.rx : state.hero.x) + 0.5, y: (p ? p.ry : state.hero.y) + 0.5, key: `h${state.hero.x},${state.hero.y}` };
    }
    const id = view.dragBoxId ?? view.lastMovedBoxId ?? null;
    let b = id !== null ? state.boxes.find((x) => x.id === id && x.state === 'active') : undefined;
    // Drag levels start on the first movable box (lowest id), never on empty board.
    if (!b) b = state.boxes.filter((x) => x.state === 'active' && x.frozen === 0).sort((p, q) => p.id - q.id)[0];
    if (b) {
      const p = this.positions.get(b.id);
      return { x: (p ? p.rx : b.x) + b.bw / 2, y: (p ? p.ry : b.y) + b.bh / 2, key: `b${b.id},${b.x},${b.y}` };
    }
    return { x: this.boardW / 2, y: this.boardH / 2, key: 'c' };
  }

  /** Per frame: choose cellSize / origin for this frame (fit, scroll, rooms, overview blend). */
  private updateCamera(state: GameState, view: View, dt: number, now: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.cameraActive) {
      this.cellSize = this.fitCs;
      this.originX = this.fitOx;
      this.originY = this.fitOy;
      this.view0 = { x: 0, y: 0, w: this.boardW, h: this.boardH };
      return;
    }
    const cs = this.camCs;
    const vw = W / cs;
    const vh = H / cs;
    const f = this.focusPoint(state, view);
    this.focusKey = f.key;
    if (this.manualFocus && this.manualFocus.key !== f.key) this.manualFocus = null; // the player moved: follow again
    let fx = this.manualFocus ? this.manualFocus.x : f.x;
    let fy = this.manualFocus ? this.manualFocus.y : f.y;
    if (view.dragEdge && view.dragBoxId !== null) {
      fx += view.dragEdge.x * 2;
      fy += view.dragEdge.y * 2;
    }
    const clampC = (c: number, v: number, size: number) => (size <= v ? size / 2 : Math.max(v / 2, Math.min(size - v / 2, c)));
    let tx: number;
    let ty: number;
    if (this.manualFocus?.direct) {
      // free look: hold exactly where the player panned
      tx = clampC(fx, vw, this.boardW);
      ty = clampC(fy, vh, this.boardH);
      this.camX = tx;
      this.camY = ty;
      this.camAnim = null;
    } else if (this.camMode === 'rooms') {
      const r = this.pickRoom(fx, fy, vw, vh);
      tx = clampC(r.cx, vw, this.boardW);
      ty = clampC(r.cy, vh, this.boardH);
    } else {
      tx = clampC(fx, vw, this.boardW);
      ty = clampC(fy, vh, this.boardH);
    }
    if (!this.camInit) {
      this.camX = tx;
      this.camY = ty;
      this.camInit = true;
      this.camAnim = null;
    } else if (this.camMode === 'rooms' || this.manualFocus) {
      // snap-scroll: ~250 ms ease to the new target
      if (!this.camAnim || this.camAnim.tx !== tx || this.camAnim.ty !== ty) {
        if (Math.abs(tx - this.camX) > 1e-3 || Math.abs(ty - this.camY) > 1e-3) this.camAnim = { t0: now, fx: this.camX, fy: this.camY, tx, ty };
      }
      if (this.camAnim) {
        const t = Math.min(1, (now - this.camAnim.t0) / ROOM_SNAP_MS);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.camX = this.camAnim.fx + (this.camAnim.tx - this.camAnim.fx) * e;
        this.camY = this.camAnim.fy + (this.camAnim.ty - this.camAnim.fy) * e;
        if (t >= 1) this.camAnim = null;
      }
    } else {
      // soft follow
      const k = 1 - Math.exp(-dt / CAM_FOLLOW_TAU);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    this.view0 = { x: this.camX - vw / 2, y: this.camY - vh / 2, w: vw, h: vh };
    // overview blend
    const target = this.ovOn ? 1 : 0;
    const step = dt / (OVERVIEW_MS / 1000);
    if (target > this.ovT) this.ovT = Math.min(1, this.ovT + step);
    else if (target < this.ovT) this.ovT = Math.max(0, this.ovT - step);
    const e = this.ovT * this.ovT * (3 - 2 * this.ovT);
    const ox1 = W / 2 - this.camX * cs;
    const oy1 = H / 2 - this.camY * cs;
    if (e <= 0) {
      this.cellSize = cs;
      this.originX = Math.round(ox1);
      this.originY = Math.round(oy1);
    } else if (e >= 1) {
      this.cellSize = this.fitCs;
      this.originX = this.fitOx;
      this.originY = this.fitOy;
    } else {
      this.cellSize = cs + (this.fitCs - cs) * e;
      this.originX = ox1 + (this.fitOx - ox1) * e;
      this.originY = oy1 + (this.fitOy - oy1) * e;
    }
  }

  /** Rooms: screen-sized windows, evenly spread (overlapping slightly, no slivers); hysteresis. */
  private pickRoom(fx: number, fy: number, vw: number, vh: number): { cx: number; cy: number } {
    const axis = (f: number, v: number, size: number, cur: number | undefined) => {
      const rw = Math.max(1, Math.floor(v));
      if (size <= rw) return { i: 0, c: size / 2 };
      const n = Math.ceil(size / rw);
      const start = (i: number) => Math.round((i * (size - rw)) / (n - 1));
      if (cur !== undefined && cur < n && f >= start(cur) && f < start(cur) + rw) return { i: cur, c: start(cur) + rw / 2 };
      let best = 0;
      let bestD = -Infinity;
      for (let i = 0; i < n; i++) {
        const s0 = start(i);
        const d = Math.min(f - s0, s0 + rw - f); // distance inside the room (negative = outside)
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      }
      return { i: best, c: start(best) + rw / 2 };
    };
    const ax = axis(fx, vw, this.boardW, this.room?.x);
    const ay = axis(fy, vh, this.boardH, this.room?.y);
    this.room = { x: ax.i, y: ay.i };
    return { cx: ax.c, cy: ay.c };
  }

  /** Is a grid rect visible in the canvas this frame (for culling)? */
  private onScreen(x: number, y: number, w: number, h: number): boolean {
    const cs = this.cellSize;
    const m = cs; // one cell of slack (glows, squash, effects)
    const sx = this.originX + x * cs;
    const sy = this.originY + y * cs;
    return sx + w * cs > -m && sy + h * cs > -m && sx < this.canvas.width + m && sy < this.canvas.height + m;
  }

  /** Grid point outside the camera viewport (pings)? */
  private offView(x: number, y: number): boolean {
    if (!this.cameraActive || this.ovOn) return false;
    const v = this.view0;
    return x < v.x || y < v.y || x > v.x + v.w || y > v.y + v.h;
  }

  /** Forget animated positions (call on level load so boxes snap into place). */
  reset(): void {
    this.positions.clear();
    this.heroPos = null;
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
      this.heroPos = null;
      this.beltActiveAt.clear();
      this.beltCells.clear();
      this.wallLoops = outlineLoops(state.walls ?? []);
      for (const cv of state.conveyors ?? []) for (const c of cv.cells) this.beltCells.set(`${c.x},${c.y}`, cv.dir);
    }
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    this.updateCamera(state, view, dt, now);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    this.drawBoard();
    for (const sb of state.sandBoxes) if (this.onScreen(sb.x, sb.y, sb.w, sb.h)) this.drawSandBox(sb.x, sb.y, sb.w, sb.h, sb.region);
    // Belt timing: `phase` is set by the core when the step ran; add the elapsed part of the next
    // step so riders (and chevrons) move every frame and reach exactly 1 cell at the belt step.
    const convs = state.conveyors ?? [];
    const frac = Math.min(1, Math.max(0, view.stepFrac || 0)) / CONVEYOR_INTERVAL;
    const basePhase = convs.length && typeof convs[0].phase === 'number' ? convs[0].phase : (Math.max(0, state.tick - 1) % CONVEYOR_INTERVAL) / CONVEYOR_INTERVAL;
    const phase = Math.min(1, basePhase + frac);
    const beltProgress = Math.floor(Math.max(0, state.tick - 1) / CONVEYOR_INTERVAL) + phase; // in cells
    const plan = convs.length ? conveyorPlan(state) : EMPTY_PLAN;
    // Box gravity: boxes about to fall glide down by the fall phase (same scheme as belt riders).
    const falls = fallPlanOf(state);
    const fallI = boxFallInterval();
    const fallPhase = Math.min(1, ((Math.max(0, state.tick - 1) % fallI) + Math.min(1, Math.max(0, view.stepFrac || 0))) / fallI);
    // Kicked boxes slide one cell per KICK_INTERVAL steps: same phase scheme.
    const slides = slidePlanOf(state);
    // Driven-box trains move one cell per BOX_FALL_INTERVAL steps (fall phase).
    this.forces = forcePlanOf(state);
    const kickI = kickInterval();
    const slidePhase = Math.min(1, ((Math.max(0, state.tick - 1) % kickI) + Math.min(1, Math.max(0, view.stepFrac || 0))) / kickI);
    this.drawWalls();
    for (const cv of convs) this.drawConveyor(cv, now, beltProgress);

    // Update animated positions.
    const nudge =
      phase > 1 - NUDGE_WINDOW ? NUDGE_CELLS * Math.sin((Math.PI * (phase - (1 - NUDGE_WINDOW))) / NUDGE_WINDOW) : 0;
    for (const b of state.boxes) {
      let p = this.positions.get(b.id);
      if (!p) {
        p = { rx: b.x, ry: b.y, tau: LERP_TAU, locked: false, carry: 0 };
        this.positions.set(b.id, p);
        continue;
      }
      const held = b.id === view.dragBoxId || b.id === state.heldBoxId;
      if (held) p.tau = LERP_TAU;
      let tx = b.x;
      let ty = b.y;
      const slideDir = held ? undefined : slides?.get(b.id);
      const forceDir = held || slideDir ? undefined : this.forces?.get(b.id);
      const rideDir = held || b.frozen > 0 || slideDir ? undefined : plan.get(b.id);
      const falling = !held && !slideDir && !forceDir && falls !== null && falls.has(b.id);
      if (rideDir || falling || slideDir || forceDir) {
        // Gliding rider / faller / slider: grid position + phase. Continuous across the step
        // because the grid position advances exactly when the phase wraps.
        if (slideDir) {
          const [dx, dy] = DIR_VEC[slideDir];
          tx += dx * slidePhase;
          ty += dy * slidePhase;
        } else if (forceDir) {
          const [dx, dy] = DIR_VEC[forceDir];
          tx += dx * fallPhase;
          ty += dy * fallPhase;
        } else if (falling) {
          ty += fallPhase;
        } else if (rideDir) {
          const [dx, dy] = DIR_VEC[rideDir];
          tx += dx * phase;
          ty += dy * phase;
        }
        if (p.locked) {
          p.rx = tx;
          p.ry = ty;
          p.carry = 1.6 * (60 / (slideDir ? kickI : falling || forceDir ? fallI : CONVEYOR_INTERVAL));
          continue;
        }
      } else {
        p.locked = false;
        // Blocked rider: a small nudge against the obstacle just before each belt step.
        if (nudge > 0 && !held && b.frozen === 0 && b.state === 'active') {
          let bd: Dir | undefined;
          for (const c of b.cells) if ((bd = this.beltCells.get(`${b.x + c.x},${b.y + c.y}`))) break;
          if (bd) {
            tx += DIR_VEC[bd][0] * nudge;
            ty += DIR_VEC[bd][1] * nudge;
          }
        }
      }
      const k = dt > 0 ? 1 - Math.exp(-dt / p.tau) : 1;
      // Riders/fallers ease on, but may catch up at 1.6x their own speed so a fast fall locks on
      // within a few frames instead of trailing it (no snap: the per-frame move stays bounded).
      // A glide that just ended (landed / blocked) finishes at its own speed, not with a slow ease.
      const chase = (slideDir ? 1.6 * (60 / kickI) : forceDir ? 1.6 * (60 / fallI) : rideDir ? 1.6 * (60 / CONVEYOR_INTERVAL) : falling ? 1.6 * (60 / fallI) : p.carry) * dt;
      const ease = (cur: number, tgt: number) => {
        const d = tgt - cur;
        const e = d * k;
        return Math.abs(d) <= chase ? tgt : Math.abs(e) >= chase ? cur + e : cur + Math.sign(d) * chase;
      };
      p.rx = ease(p.rx, tx);
      p.ry = ease(p.ry, ty);
      if (Math.abs(tx - p.rx) < 0.002) p.rx = tx;
      if (Math.abs(ty - p.ry) < 0.002) p.ry = ty;
      if (p.rx === tx && p.ry === ty) {
        p.tau = LERP_TAU;
        if (!rideDir && !falling && !slideDir && !forceDir) p.carry = 0;
        if (rideDir || falling || slideDir || forceDir) p.locked = true; // eased on: from now on follow it exactly
      }
    }

    // Same-color touching boxes form a group (DESIGN 6b): drawn as one merged shape.
    const groups = this.visualGroups(state, view);
    const grouped = new Set<number>();
    for (const g of groups) for (const b of g) grouped.add(b.id);

    // Motion streaks behind sliding boxes.
    for (const b of state.boxes) {
      const sd = (b as Box & { sliding?: Dir | null }).sliding;
      if (b.state === 'active' && sd) this.drawStreak(b, sd);
    }
    // Draw resting boxes first, then groups, then the selected one, then the dragged one on top.
    let selBox: Box | null = null;
    let dragBox: Box | null = null;
    for (const b of state.boxes) {
      if (b.state !== 'active' || grouped.has(b.id)) continue;
      if (b.id === view.dragBoxId) dragBox = b;
      else if (b.id === view.selectedBoxId) selBox = b;
      else if (this.onScreen(b.x - 1, b.y - 1, b.bw + 2, b.bh + 2)) this.drawBox(b, view, now);
    }
    for (const g of groups) this.drawGroup(g, view, now);
    if (selBox) this.drawBox(selBox, view, now);
    if (dragBox) this.drawBox(dragBox, view, now);
    if (state.hero) {
      const hs = heroSlideOf(state);
      this.drawHero(state, view, now, dt, !hs && heroWillFall(state, falls) ? fallPhase : -1, fallI, hs, slidePhase, kickI);
    }
    if (state.hero && view.charge) this.drawCharge(state, view.charge, now);

    this.drawEffects(view, now);
    this.drawViewportOutline();
  }

  /**
   * Effects for a game event. Handles the events that need board knowledge (conveyors, debris) and
   * delegates the rest to `effectForEvent`. Also slows position lerps for boxes a belt carries.
   */
  effectsForEvent(ev: GameEvent, state: GameState, now: number): Effect[] {
    const out = this.effectsForEventInner(ev, state, now);
    // Big maps: a ping at the screen edge for things that happen out of view.
    if (this.cameraActive && !this.ovOn) {
      const at = (x: number, y: number, color: ColorId) => {
        if (this.offView(x, y)) out.push({ kind: 'ping', t0: now, dur: PING_MS, x, y, color });
      };
      if (ev.type === 'boxCompleted') {
        let mx = 0;
        let my = 0;
        for (const c of ev.cells) {
          mx += c.x + 0.5;
          my += c.y + 0.5;
        }
        at(ev.x + mx / ev.cells.length, ev.y + my / ev.cells.length, ev.color);
      } else if (ev.type === 'boxUnfrozen' || (ev.type === 'boxLanded' && ev.fell >= 2)) {
        const b = state.boxes.find((x) => x.id === ev.boxId);
        if (b) at(b.x + b.bw / 2, b.y + b.bh / 2, ev.type === 'boxUnfrozen' ? 11 : b.color);
      } else if (ev.type === 'debrisDissolved') {
        for (const fx of out) if (fx.kind === 'debris') at(fx.x + fx.w / 2, fx.y + fx.h / 2, ev.color);
      }
    }
    return out;
  }

  private effectsForEventInner(ev: GameEvent, state: GameState, now: number): Effect[] {
    if (ev.type === 'conveyed') {
      this.beltActiveAt.set(ev.conveyorId, now);
      for (const id of ev.boxIds) {
        if (id === state.heldBoxId) continue;
        const p = this.positions.get(id);
        if (p) p.tau = PUSH_LERP_TAU;
      }
      return [];
    }
    if (ev.type === 'debrisDissolved') {
      const out: Effect[] = [];
      for (const sb of state.sandBoxes) {
        const rc = this.regionCanvases.get(sb.region);
        if (!rc || now - rc.colorSeen[ev.color & 31] > DEBRIS_SEEN_MS) continue;
        const sparks: Spark[] = [];
        const n = Math.min(28, 6 + sb.w * sb.h * 2);
        for (let i = 0; i < n; i++) {
          const [r, g, b] = grainRGBA(ev.color, Math.floor(Math.random() * SHADE_COUNT));
          sparks.push({
            x: sb.x + 0.1 + Math.random() * (sb.w - 0.2),
            y: sb.y + 0.15 + Math.random() * (sb.h - 0.3),
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.4 - Math.random() * 0.8,
            size: 0.05 + Math.random() * 0.05,
            rgb: `rgb(${r},${g},${b})`,
          });
        }
        out.push({ kind: 'debris', t0: now, dur: DEBRIS_MS, color: ev.color, x: sb.x, y: sb.y, w: sb.w, h: sb.h, sparks });
      }
      return out;
    }
    if (ev.type === 'heroLanded' && state.hero) {
      const k = Math.min(1, Math.max(1, ev.fell) / 6);
      const sparks: Spark[] = [];
      const per = Math.round(3 + 5 * k);
      for (let i = 0; i < per; i++) {
        const side = i % 2 ? 1 : -1;
        const [r, g, bl] = grainRGBA(11, Math.floor(Math.random() * SHADE_COUNT));
        sparks.push({
          x: state.hero.x + 0.5 + side * (0.15 + Math.random() * 0.2),
          y: state.hero.y + 0.95,
          vx: side * (0.6 + Math.random() * 1.4) * (0.5 + k),
          vy: -(0.2 + Math.random() * 0.8) * (0.5 + k),
          size: 0.035 + Math.random() * 0.04,
          rgb: `rgb(${r},${g},${bl})`,
        });
      }
      return [
        { kind: 'land', t0: now, dur: 110 + 60 * k, boxId: HERO_ID, amp: 0.06 + 0.1 * k },
        { kind: 'dust', t0: now, dur: 260 + 200 * k, sparks },
      ];
    }
    if (ev.type === 'boxLanded') {
      const box = state.boxes.find((b) => b.id === ev.boxId);
      const fell = Math.max(1, ev.fell);
      const k = Math.min(1, fell / 6); // 1 cell subtle .. 6+ cells a thump
      const out: Effect[] = [{ kind: 'land', t0: now, dur: 110 + 60 * k, boxId: ev.boxId, amp: 0.035 + 0.075 * k }];
      if (box) {
        const sparks: Spark[] = [];
        const own = new Set(box.cells.map((c) => `${c.x},${c.y}`));
        const bottoms = box.cells.filter((c) => !own.has(`${c.x},${c.y + 1}`));
        const per = Math.round(2 + 5 * k);
        for (const c of bottoms) {
          for (let i = 0; i < per; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            const sh = Math.floor(Math.random() * SHADE_COUNT);
            const [r, g, bl] = grainRGBA(11, sh);
            sparks.push({
              x: box.x + c.x + 0.5 + side * (0.25 + Math.random() * 0.25),
              y: box.y + c.y + 0.97,
              vx: side * (0.6 + Math.random() * 1.6) * (0.5 + k),
              vy: -(0.2 + Math.random() * 0.9) * (0.5 + k),
              size: 0.04 + Math.random() * 0.05,
              rgb: `rgb(${r},${g},${bl})`,
            });
          }
        }
        out.push({ kind: 'dust', t0: now, dur: 280 + 220 * k, sparks });
      }
      return out;
    }
    const fx = effectForEvent(ev, now);
    if (fx && fx.kind === 'pop') {
      // A group pops in one step (DESIGN 6b): fold touching same-color pops of this frame into one
      // effect so they scale and fade as one shape instead of stacking flashes.
      const prev = this.lastPop;
      if (prev && prev.t0 === now && prev.color === fx.color && popsTouch(prev, fx)) {
        const abs = fx.cells.map((c) => ({ x: fx.x + c.x - prev.x, y: fx.y + c.y - prev.y }));
        prev.cells = prev.cells.concat(abs);
        prev.sparks = prev.sparks.concat(fx.sparks.slice(0, Math.max(0, 40 - prev.sparks.length)));
        return [];
      }
      this.lastPop = fx;
    }
    return fx ? [fx] : [];
  }

  /**
   * Conveyor: a dark recessed lane over its cells, a roller at each end, and chevrons crawling in
   * `dir` (brighter for a moment after the belt moved a box).
   */
  private drawConveyor(cv: ConveyorState, now: number, progress: number): void {
    const cells = cv.cells && cv.cells.length ? cv.cells : [{ x: cv.x, y: cv.y }];
    const len = cells.length;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const [dx, dy] = DIR_VEC[cv.dir];
    const start = cells[0];
    // Local frame: origin at the back edge of the start cell (centre line), +u along dir.
    const ox = this.originX + (start.x + 0.5 - dx * 0.5) * cs;
    const oy = this.originY + (start.y + 0.5 - dy * 0.5) * cs;
    const L = len * cs;
    const half = cs * 0.36; // lane half-width
    const inset = cs * 0.07;

    const since = now - (this.beltActiveAt.get(cv.id) ?? -1e9);
    const active = since < BELT_ACTIVE_MS ? 1 - since / BELT_ACTIVE_MS : 0;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(DIR_ANGLE[cv.dir]);

    // Recessed lane.
    const lane = roundRectPath(inset, -half, L - inset * 2, half * 2, cs * 0.1);
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fill(lane);
    ctx.save();
    ctx.clip(lane);
    const sh = ctx.createLinearGradient(0, -half, 0, half);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(0.25, 'rgba(0,0,0,0)');
    sh.addColorStop(0.8, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, -half, L, half * 2);

    // Crawling chevrons (time based, ~1 cell/s).
    const spacing = BELT_SPACING * cs;
    const phase = (((progress * cs) % spacing) + spacing) % spacing;
    const cw = cs * 0.13; // chevron depth along u
    const chH = half * 0.62;
    ctx.beginPath();
    for (let u = -spacing + phase; u < L + spacing; u += spacing) {
      ctx.moveTo(u - cw, -chH);
      ctx.lineTo(u, 0);
      ctx.lineTo(u - cw, chH);
    }
    ctx.strokeStyle = `rgba(200,212,235,${0.16 + 0.24 * active})`;
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = `rgba(255,255,255,${0.08 + 0.1 * active})`;
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(lane);

    // Rollers at both ends: small cylinders across the lane.
    const rw = cs * 0.13;
    for (const u of [inset + rw * 0.15, L - inset - rw * 1.15]) {
      const g = ctx.createLinearGradient(u, 0, u + rw, 0);
      g.addColorStop(0, '#4a5163');
      g.addColorStop(0.45, '#b4bccc');
      g.addColorStop(1, '#4a5163');
      ctx.fillStyle = g;
      ctx.fill(roundRectPath(u, -half - cs * 0.03, rw, half * 2 + cs * 0.06, rw * 0.45));
    }
    ctx.restore();
  }

  /**
   * Walls: solid dark blocks merged across orthogonal neighbours (one outline per connected group,
   * so no inner seams), with a faint hatch and an inner bevel (light top/left, dark bottom/right).
   */
  private drawWalls(): void {
    if (this.wallLoops.length === 0) return;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const path = loopsPath(this.wallLoops, this.originX, this.originY, cs, cs * 0.03, cs * 0.12);
    const g = ctx.createLinearGradient(0, this.originY, 0, this.originY + this.boardH * cs);
    g.addColorStop(0, '#363c50');
    g.addColorStop(1, '#2b3041');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = cs * 0.12;
    ctx.shadowOffsetY = cs * 0.04;
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    // Faint diagonal hatch (board-aligned, so it flows across merged cells).
    ctx.beginPath();
    const step = cs * 0.22;
    const x0 = this.originX;
    const y0 = this.originY;
    const W = this.boardW * cs;
    const H = this.boardH * cs;
    for (let d = -H; d < W; d += step) {
      ctx.moveTo(x0 + d, y0 + H);
      ctx.lineTo(x0 + d + H, y0);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke();
    // Inner bevel: the outline shifted down-right shows as a highlight on the top/left inner edges,
    // shifted up-left as a shadow on the bottom/right inner edges.
    const e = Math.max(1, cs * 0.045);
    ctx.lineWidth = e * 2;
    ctx.translate(e, e);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke(path);
    ctx.translate(-2 * e, -2 * e);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke(path);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(path);
  }

  /**
   * The hero: a small round character with eyes looking toward `facing`. Walks glide at constant
   * speed with a little bob; falls glide with the box fall phase (fallPhase >= 0) and lock on like
   * falling boxes; landing squashes it.
   */
  private drawHero(
    state: GameState,
    view: View,
    now: number,
    dt: number,
    fallPhase: number,
    fallI: number,
    slideDir: Dir | null = null,
    slidePhase = 0,
    kickI = 2,
  ): void {
    const h = state.hero!;
    const cs = this.cellSize;
    const ctx = this.ctx;
    let p = this.heroPos;
    if (!p) p = this.heroPos = { rx: h.x, ry: h.y, carry: 0 };
    const falling = fallPhase >= 0;
    // Thrown: glide with the slide phase, like a kicked box.
    const sv = slideDir ? DIR_VEC[slideDir] : null;
    const tx = h.x + (sv ? sv[0] * slidePhase : 0);
    const ty = h.y + (falling ? fallPhase : 0) + (sv ? sv[1] * slidePhase : 0);
    // Walks: ~90 ms per cell; when a fast tap-to-walk gets ahead, glide faster (never jump).
    const lag = Math.abs(tx - p.rx) + Math.abs(h.y - p.ry);
    const speed = sv ? 1.6 * (60 / kickI) : falling ? 1.6 * (60 / fallI) : Math.max(HERO_WALK_SPEED, p.carry, lag > 1 ? HERO_WALK_SPEED * 2 : 0);
    if (falling || sv) p.carry = speed;
    const step = speed * dt;
    const move = (cur: number, tgt: number) => (Math.abs(tgt - cur) <= step ? tgt : cur + Math.sign(tgt - cur) * step);
    p.rx = move(p.rx, tx);
    p.ry = move(p.ry, ty);
    if (p.rx === tx && p.ry === ty && !falling && !sv) p.carry = 0;
    // Walk bob: hop while gliding between cells (not while falling or sliding).
    const remaining = Math.min(1, Math.abs(tx - p.rx) + Math.abs(h.y - p.ry));
    const bob = falling || sv ? 0 : -0.09 * Math.sin(Math.PI * remaining);

    const cx = this.originX + (p.rx + 0.5) * cs;
    const cy = this.originY + (p.ry + 0.5 + bob) * cs;
    const R = cs * 0.34;
    const sq = this.squashOf(HERO_ID, view, now);

    // Thrown: motion streak behind the hero.
    if (sv) {
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.18 / i;
        ctx.fillStyle = '#ffd27e';
        ctx.beginPath();
        ctx.arc(cx - sv[0] * i * cs * 0.3, cy - sv[1] * i * cs * 0.3, R * (1 - i * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Ground shadow (stays on the ground line during the bob).
    ctx.save();
    ctx.globalAlpha = 0.28 * (1 + bob * 3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, this.originY + (p.ry + 0.5) * cs + R * 0.98, R * 0.78, R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (sv) {
      // sliding pose: stretched along the slide, squashed across it, leaning into it
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(sv[1], sv[0]));
      ctx.scale(1.14, 0.86);
      ctx.rotate(-Math.atan2(sv[1], sv[0]) + (sv[0] !== 0 ? sv[0] * 0.18 : 0));
      ctx.translate(-cx, -cy);
    }
    const foot = cy + R;
    ctx.translate(cx, foot);
    ctx.scale(1 + (1 - sq) * 0.7, sq);
    ctx.translate(-cx, -foot);
    // Body.
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#fff1cf');
    g.addColorStop(0.55, '#ffd27e');
    g.addColorStop(1, '#e9a24a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, cs * 0.035);
    ctx.strokeStyle = 'rgba(60,36,10,0.85)';
    ctx.stroke();
    // Eyes look toward `facing`.
    const [fx, fy] = DIR_VEC[h.facing ?? 'down'];
    const side = fx !== 0;
    const look = R * 0.38;
    const sep = side ? R * 0.26 : R * 0.34;
    const ex = cx + fx * look;
    const ey = cy + fy * look * 0.7 - (side ? R * 0.12 : 0);
    const eyes = side ? [ex - sep / 2 * 1, ex + sep / 2 * 1] : [ex - sep, ex + sep];
    for (const x of eyes) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, ey, R * 0.2, R * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cs * 0.015);
      ctx.strokeStyle = 'rgba(60,36,10,0.5)';
      ctx.stroke();
      ctx.fillStyle = '#1f1a14';
      ctx.beginPath();
      ctx.arc(x + fx * R * 0.07, ey + fy * R * 0.08, R * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Swipe arrow from the hero, as long as the drag: light below the kick distance, amber at/after. */
  private drawCharge(state: GameState, c: HeroCharge, now: number): void {
    const fade = c.fadeAt !== undefined ? Math.max(0, 1 - (now - c.fadeAt) / 150) : 1;
    if (fade <= 0 || c.dist <= 0) return;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const hp = this.heroPos;
    const h = state.hero!;
    const cx = this.originX + ((hp ? hp.rx : h.x) + 0.5) * cs;
    const cy = this.originY + ((hp ? hp.ry : h.y) + 0.5) * cs;
    const x0 = cs * 0.4;
    const x1 = x0 + c.dist * this.dpr;
    const head = Math.min(cs * 0.4, c.dist * this.dpr);
    const w = cs * 0.14;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(DIR_ANGLE[c.dir]);
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = c.armed ? '#f5c84c' : '#e6ecf8';
    ctx.fillRect(x0, -w / 2, Math.max(0, x1 - head - x0), w);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1 - head, -head * 0.6);
    ctx.lineTo(x1 - head, head * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Fading streak behind a sliding box. */
  private drawStreak(b: Box, dir: Dir): void {
    const p = this.positions.get(b.id);
    const cs = this.cellSize;
    const ctx = this.ctx;
    const [dx, dy] = DIR_VEC[dir];
    const x = this.originX + (p ? p.rx : b.x) * cs;
    const y = this.originY + (p ? p.ry : b.y) * cs;
    const w = b.bw * cs;
    const h = b.bh * cs;
    ctx.save();
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.16 / i;
      ctx.fillStyle = colorHex(b.color);
      const o = i * cs * 0.28;
      ctx.fill(roundRectPath(x - dx * o + cs * 0.12, y - dy * o + cs * 0.12, w - cs * 0.24, h - cs * 0.24, cs * 0.14));
    }
    ctx.restore();
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
      rc = { canvas, ctx, img, u32: new Uint32Array(img.data.buffer), version: -1, count: -1, colorSeen: new Float64Array(32) };
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
    let colors = 0;
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      u[i] = T[v];
      colors |= 1 << (v & 31);
    }
    rc.ctx.putImageData(rc.img, 0, 0);
    const seenAt = performance.now();
    for (let c = 1; c < 32; c++) if (colors & (1 << c)) rc.colorSeen[c] = seenAt;
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

  /** Landing squash factor (1 = none) for a box, from its `land` effect. */
  private squashOf(id: number, view: View, now: number): number {
    for (const e of view.effects) {
      if (e.kind !== 'land' || e.boxId !== id) continue;
      const t = (now - e.t0) / e.dur;
      if (t >= 0 && t <= 1) return 1 - e.amp * Math.sin(Math.PI * t);
    }
    return 1;
  }

  private drawBox(b: Box, view: View, now: number): void {
    const sq = this.squashOf(b.id, view, now);
    if (sq !== 1) {
      // Squash about the bottom edge, with a matching slight widening.
      const pos = this.positions.get(b.id);
      const cs = this.cellSize;
      const cx = this.originX + ((pos ? pos.rx : b.x) + b.bw / 2) * cs;
      const by = this.originY + ((pos ? pos.ry : b.y) + b.bh) * cs;
      this.ctx.save();
      this.ctx.translate(cx, by);
      this.ctx.scale(1 + (1 - sq) * 0.6, sq);
      this.ctx.translate(-cx, -by);
      this.drawBoxBody(b, view, now);
      this.ctx.restore();
      return;
    }
    this.drawBoxBody(b, view, now);
  }

  private drawBoxBody(b: Box, view: View, now: number): void {
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
      ctx.font = `800 ${Math.round(Math.max(cs * 0.56, 12 * this.dpr))}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
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
        this.strokeSelected(b.color, path, lw);
      } else {
        ctx.strokeStyle = boxStroke(b.color);
        ctx.lineWidth = lw;
        ctx.stroke(path);
        if (hover) this.strokeHover(path, lw);
      }
    }

    this.drawThaw(b, path, view, now, lw);
    this.drawForce(b, px, py, now);
  }

  /**
   * Driven box: an arrow on its face pointing in `force` (faint under ice), a nozzle on the back
   * edge with a soft glow; exhaust while its train moves; a brighter pulsing glow and a pressure
   * line on the front edge while it is pressing.
   */
  private drawForce(b: Box, px: number, py: number, now: number): void {
    const force = (b as Box & { force?: Dir | null }).force;
    if (!force) return;
    const pressing = !!(b as Box & { pressing?: boolean }).pressing && b.frozen === 0;
    const moving = !!this.forces?.has(b.id) && b.frozen === 0;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    // face arrow on the cell nearest the centroid
    let mx = 0;
    let my = 0;
    for (const c of b.cells) {
      mx += c.x + 0.5;
      my += c.y + 0.5;
    }
    mx /= b.cells.length;
    my /= b.cells.length;
    let best = b.cells[0];
    let bd = Infinity;
    for (const c of b.cells) {
      const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const ax = px + (best.x + 0.5) * cs;
    const ay = py + (best.y + 0.5) * cs;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(DIR_ANGLE[force]);
    ctx.globalAlpha = b.frozen > 0 ? 0.3 : 0.42;
    ctx.strokeStyle = b.frozen > 0 ? ICE_TEXT : '#ffffff';
    ctx.lineWidth = Math.max(2, cs * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-cs * 0.12, -cs * 0.17);
    ctx.lineTo(cs * 0.08, 0);
    ctx.lineTo(-cs * 0.12, cs * 0.17);
    ctx.stroke();
    ctx.restore();
    if (b.frozen > 0) return;

    // back edge: cells with no own cell behind them (opposite to force); nozzle on the middle one
    const backs = b.cells.filter((c) => !own.has(`${c.x - fx},${c.y - fy}`));
    const back = backs[Math.floor(backs.length / 2)];
    const nx = px + (back.x + 0.5 - fx * 0.5) * cs; // centre of the back edge
    const ny = py + (back.y + 0.5 - fy * 0.5) * cs;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(DIR_ANGLE[force]);
    // local frame: +x = force direction, the nozzle points to -x
    const glowR = cs * (pressing ? 0.55 : 0.4);
    const g = ctx.createRadialGradient(-cs * 0.12, 0, 0, -cs * 0.12, 0, glowR);
    const a = pressing ? 0.35 + 0.25 * pulse : moving ? 0.35 : 0.16;
    g.addColorStop(0, colorRGBA(b.color, a));
    g.addColorStop(1, colorRGBA(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-cs * 0.12 - glowR, -glowR, glowR * 2, glowR * 2);
    // nozzle: a small trapezoid sticking out behind the box
    ctx.fillStyle = boxStroke(b.color);
    ctx.beginPath();
    ctx.moveTo(cs * 0.04, -cs * 0.14);
    ctx.lineTo(cs * 0.04, cs * 0.14);
    ctx.lineTo(-cs * 0.13, cs * 0.2);
    ctx.lineTo(-cs * 0.13, -cs * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pressing ? `rgba(255,245,210,${0.6 + 0.4 * pulse})` : 'rgba(255,255,255,0.35)';
    ctx.fillRect(-cs * 0.15, -cs * 0.15, cs * 0.05, cs * 0.3);
    // exhaust while moving: streaks flowing backwards
    if (moving) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const ph = ((now * 0.004 + i / 4) % 1 + 1) % 1;
        const x = -cs * (0.2 + 0.55 * ph);
        const off = (i - 1.5) * cs * 0.08;
        ctx.globalAlpha = 0.55 * (1 - ph);
        ctx.strokeStyle = i % 2 ? '#ffffff' : colorHex(b.color);
        ctx.lineWidth = Math.max(1.5, cs * 0.035);
        ctx.beginPath();
        ctx.moveTo(x, off);
        ctx.lineTo(x - cs * 0.14, off);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // pressing: thin pressure highlight along the front edge
    if (pressing) {
      const fronts = b.cells.filter((c) => !own.has(`${c.x + fx},${c.y + fy}`));
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.35 * pulse;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = Math.max(1.5, cs * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const c of fronts) {
        const ex = px + (c.x + 0.5 + fx * 0.44) * cs;
        const ey = py + (c.y + 0.5 + fy * 0.44) * cs;
        ctx.moveTo(ex - fy * cs * 0.32, ey - fx * cs * 0.32);
        ctx.lineTo(ex + fy * cs * 0.32, ey + fx * cs * 0.32);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private strokeSelected(color: ColorId, path: Path2D, lw: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = boxGlow(color);
    ctx.shadowBlur = this.cellSize * 0.35;
    ctx.strokeStyle = boxGlow(color);
    ctx.lineWidth = lw * 1.6;
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, lw * 0.45);
    ctx.stroke(path);
  }

  private strokeHover(path: Path2D, lw: number): void {
    this.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    this.ctx.lineWidth = Math.max(1, lw * 0.5);
    this.ctx.stroke(path);
  }

  private drawThaw(b: Box, path: Path2D, view: View, now: number, lw: number): void {
    const ctx = this.ctx;
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

  /**
   * Connected same-color groups for drawing: active, unfrozen boxes of one color whose grid cells
   * share an edge and that are drawn at the same offset from their grid position (so pieces gliding
   * together on a belt stay merged, a piece mid-move does not). The dragged box is excluded so it
   * reads as detaching. Only groups of 2+ are returned.
   */
  private visualGroups(state: GameState, view: View): Box[][] {
    const cand: Box[] = [];
    for (const b of state.boxes) {
      if (b.state === 'active' && b.frozen === 0 && b.id !== view.dragBoxId && !view.effects.some((e) => e.kind === 'land' && e.boxId === b.id)) cand.push(b);
    }
    if (cand.length < 2) return [];
    const owner = new Map<string, number>(); // "x,y" -> index in cand
    cand.forEach((b, i) => {
      for (const c of b.cells) owner.set(`${b.x + c.x},${b.y + c.y}`, i);
    });
    const parent = cand.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const off = (b: Box): [number, number] => {
      const p = this.positions.get(b.id);
      return p ? [p.rx - b.x, p.ry - b.y] : [0, 0];
    };
    cand.forEach((b, i) => {
      const [oxA, oyA] = off(b);
      for (const c of b.cells) {
        for (const [nx, ny] of [[b.x + c.x + 1, b.y + c.y], [b.x + c.x, b.y + c.y + 1]]) {
          const j = owner.get(`${nx},${ny}`);
          if (j === undefined || j === i) continue;
          const o = cand[j];
          if (o.color !== b.color) continue;
          const [oxB, oyB] = off(o);
          if (Math.abs(oxA - oxB) > 0.01 || Math.abs(oyA - oyB) > 0.01) continue;
          parent[find(i)] = find(j);
        }
      }
    });
    const comps = new Map<number, Box[]>();
    cand.forEach((b, i) => {
      const r = find(i);
      const list = comps.get(r);
      if (list) list.push(b);
      else comps.set(r, [b]);
    });
    return [...comps.values()].filter((g) => g.length > 1);
  }

  /** One merged outline and fill for a group, faint seams between pieces, per-piece highlights. */
  private drawGroup(members: Box[], view: View, now: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const first = members[0];
    const p0 = this.positions.get(first.id);
    const offX = p0 ? p0.rx - first.x : 0;
    const offY = p0 ? p0.ry - first.y : 0;
    const bx = this.originX + offX * cs;
    const by = this.originY + offY * cs;
    const inset = cs * 0.06;
    const radius = Math.min(cs * 0.18, (cs - inset * 2) / 2);
    const lw = Math.max(2, cs * 0.06);

    const abs: Vec[] = [];
    const owner = new Map<string, number>();
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const b of members) {
      for (const c of b.cells) {
        const x = b.x + c.x;
        const y = b.y + c.y;
        abs.push({ x, y });
        owner.set(`${x},${y}`, b.id);
        minY = Math.min(minY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + 1);
      }
    }
    const union = loopsPath(outlineLoops(abs), bx, by, cs, inset, radius);

    ctx.fillStyle = boxFill(first.color);
    ctx.fill(union);
    ctx.save();
    ctx.clip(union);
    for (const b of members) {
      const rc = this.regionCanvas(b.region);
      ctx.drawImage(rc.canvas, 0, 0, b.region.w, b.region.h, bx + b.x * cs, by + b.y * cs, b.bw * cs, b.bh * cs);
    }
    const sy = by + minY * cs;
    const g = ctx.createLinearGradient(0, sy, 0, sy + cs * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx + minX * cs, sy, (maxX - minX) * cs, cs * 0.5);

    // Faint seams where two pieces meet (they can still be pulled apart).
    ctx.beginPath();
    const m = cs * 0.2;
    for (const [key, id] of owner) {
      const [x, y] = key.split(',').map(Number);
      const right = owner.get(`${x + 1},${y}`);
      if (right !== undefined && right !== id) {
        ctx.moveTo(bx + (x + 1) * cs, by + y * cs + m);
        ctx.lineTo(bx + (x + 1) * cs, by + (y + 1) * cs - m);
      }
      const down = owner.get(`${x},${y + 1}`);
      if (down !== undefined && down !== id) {
        ctx.moveTo(bx + x * cs + m, by + (y + 1) * cs);
        ctx.lineTo(bx + (x + 1) * cs - m, by + (y + 1) * cs);
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = boxStroke(first.color);
    ctx.lineWidth = Math.max(1, lw * 0.45);
    ctx.lineCap = 'round';
    ctx.setLineDash([Math.max(2, cs * 0.06), Math.max(2, cs * 0.06)]);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = boxStroke(first.color);
    ctx.lineWidth = lw;
    ctx.stroke(union);

    for (const b of members) this.drawForce(b, bx + b.x * cs, by + b.y * cs, now);
    // Per-piece selection / hover / thaw so the player sees which piece they act on.
    for (const b of members) {
      const sel = b.id === view.selectedBoxId;
      const hov = b.id === view.hoverBoxId;
      const thaw = view.effects.some((e) => e.kind === 'thaw' && e.boxId === b.id);
      if (!sel && !hov && !thaw) continue;
      const path = loopsPath(shapeOutline(b.shape, b.cells), bx + b.x * cs, by + b.y * cs, cs, inset, radius);
      if (sel) this.strokeSelected(b.color, path, lw);
      else if (hov) this.strokeHover(path, lw);
      this.drawThaw(b, path, view, now, lw);
    }
  }

  /** Marker at the screen edge pointing to an off-screen event. */
  private drawPing(e: Extract<Effect, { kind: 'ping' }>, age: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const sx = this.originX + e.x * cs;
    const sy = this.originY + e.y * cs;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (sx >= 0 && sy >= 0 && sx <= W && sy <= H) return; // in view now
    const m = 22 * this.dpr;
    const px = Math.max(m, Math.min(W - m, sx));
    const py = Math.max(m, Math.min(H - m, sy));
    const a = Math.atan2(sy - py, sx - px);
    const t = age / e.dur;
    const r = 9 * this.dpr * (1 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI));
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.translate(px, py);
    ctx.fillStyle = colorHex(e.color);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, 1.5 * this.dpr);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r + 9 * this.dpr, 0);
    ctx.lineTo(r + 2 * this.dpr, -5 * this.dpr);
    ctx.lineTo(r + 2 * this.dpr, 5 * this.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Overview: outline of the normal camera viewport. */
  private drawViewportOutline(): void {
    if (this.ovT <= 0 || !this.cameraActive) return;
    const ctx = this.ctx;
    const cs = this.cellSize;
    const v = this.view0;
    const x0 = Math.max(0, v.x);
    const y0 = Math.max(0, v.y);
    const x1 = Math.min(this.boardW, v.x + v.w);
    const y1 = Math.min(this.boardH, v.y + v.h);
    ctx.save();
    ctx.globalAlpha = this.ovT;
    ctx.strokeStyle = '#f5c84c';
    ctx.lineWidth = Math.max(2, 2 * this.dpr);
    ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
    ctx.strokeRect(this.originX + x0 * cs, this.originY + y0 * cs, (x1 - x0) * cs, (y1 - y0) * cs);
    ctx.restore();
  }

  private drawDebris(e: Extract<Effect, { kind: 'debris' }>, age: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const t = age / e.dur;
    const x = this.originX + e.x * cs;
    const y = this.originY + e.y * cs;
    ctx.save();
    // Brief tinted glow over the glass.
    ctx.globalAlpha = 0.16 * (1 - t);
    ctx.fillStyle = colorHex(e.color);
    ctx.fill(roundRectPath(x + cs * 0.04, y + cs * 0.04, e.w * cs - cs * 0.08, e.h * cs - cs * 0.08, cs * 0.12));
    // Rising, twinkling motes.
    const ts = age / 1000;
    for (let i = 0; i < e.sparks.length; i++) {
      const sp = e.sparks[i];
      const tw = 0.55 + 0.45 * Math.sin(age * 0.03 + i * 1.7);
      ctx.globalAlpha = Math.max(0, (1 - t) * tw);
      const size = Math.max(this.dpr * 1.5, sp.size * cs * (1 - t * 0.5));
      ctx.fillStyle = i % 4 === 0 ? '#ffffff' : sp.rgb;
      ctx.fillRect(this.originX + (sp.x + sp.vx * ts) * cs - size / 2, this.originY + (sp.y + sp.vy * ts) * cs - size / 2, size, size);
    }
    ctx.restore();
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
      if (e.kind === 'debris') {
        this.drawDebris(e, age);
        continue;
      }
      if (e.kind === 'ping') {
        this.drawPing(e, age);
        continue;
      }
      if (e.kind === 'dust') {
        const t = age / e.dur;
        const ts = age / 1000;
        const drag = 1 - Math.exp(-ts * 6); // particles decelerate quickly
        ctx.save();
        for (const sp of e.sparks) {
          ctx.globalAlpha = Math.max(0, 0.75 * (1 - t));
          const sx = sp.x + (sp.vx / 6) * drag;
          const sy = sp.y + (sp.vy / 6) * drag + 0.6 * ts * ts;
          const size = Math.max(this.dpr * 1.5, sp.size * cs * (1 + t));
          ctx.fillStyle = sp.rgb;
          ctx.fillRect(this.originX + sx * cs - size / 2, this.originY + sy * cs - size / 2, size, size);
        }
        ctx.restore();
        continue;
      }
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

