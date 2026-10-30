// Hero (Sokoban) mode input: tap-to-walk, swipe, d-pad repeat. Keyboard lives in keyboard.ts.
// All core hero functions are looked up through the namespace and guarded, so this module is
// inert until the core provides them (and in levels without a hero).
import type { Dir, GameState, Vec } from '../core/types';
import * as Core from '../core';
import type { Renderer } from '../render/renderer';

const core = Core as unknown as Record<string, unknown>;
type Fn<A extends unknown[], R> = (...a: A) => R;
const fn = <A extends unknown[], R>(name: string): Fn<A, R> | null =>
  typeof core[name] === 'function' ? (core[name] as Fn<A, R>) : null;

export const heroApi = {
  get moveHero() {
    return fn<[GameState, Dir], unknown>('moveHero');
  },
  get snapshot() {
    return fn<[GameState], unknown>('snapshotState');
  },
  get restore() {
    return fn<[GameState, unknown], void>('restoreState');
  },
};

export const DIRS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** True if a grid cell is solid for the hero: off-board, wall, sand box, or any active box. */
export function cellSolid(state: GameState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return true;
  for (const w of state.walls ?? []) if (w.x === x && w.y === y) return true;
  for (const s of state.sandBoxes) if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return true;
  for (const b of state.boxes) {
    if (b.state !== 'active') continue;
    for (const c of b.cells) if (b.x + c.x === x && b.y + c.y === y) return true;
  }
  return false;
}

/** Id of the active box covering a cell, if any. */
function boxIdAt(state: GameState, x: number, y: number): number | null {
  for (const b of state.boxes) {
    if (b.state !== 'active') continue;
    for (const c of b.cells) if (b.x + c.x === x && b.y + c.y === y) return b.id;
  }
  return null;
}

/** Shortest 4-way path of directions from the hero to any goal cell through free cells, or null. */
export function heroPath(state: GameState, goals: Vec[]): Dir[] | null {
  const h = state.hero;
  if (!h) return null;
  const key = (x: number, y: number) => y * state.width + x;
  const goal = new Set(goals.map((g) => key(g.x, g.y)));
  if (goal.has(key(h.x, h.y))) return [];
  const prev = new Map<number, [number, Dir]>();
  const seen = new Set<number>([key(h.x, h.y)]);
  const q: [number, number][] = [[h.x, h.y]];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const k = key(nx, ny);
      if (seen.has(k) || cellSolid(state, nx, ny)) continue;
      seen.add(k);
      prev.set(k, [key(x, y), d]);
      if (goal.has(k)) {
        const out: Dir[] = [];
        let cur = k;
        while (cur !== key(h.x, h.y)) {
          const [p, dd] = prev.get(cur)!;
          out.push(dd);
          cur = p;
        }
        return out.reverse();
      }
      q.push([nx, ny]);
    }
  }
  return null;
}

export interface HeroInputDeps {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  getState: () => GameState;
  /** One hero input (with undo snapshot). Returns true if the hero moved/pushed. */
  step: (dir: Dir) => boolean;
  isBlocked?: () => boolean;
}

const STEP_MS = 90;
const SWIPE_PX = 24;

export class HeroInput {
  private timer = 0;
  private path: Dir[] = [];

  constructor(private deps: HeroInputDeps) {
    const c = deps.canvas;
    let start: { x: number; y: number; id: number } | null = null;
    c.addEventListener('pointerdown', (e) => {
      if (!deps.getState().hero || deps.isBlocked?.()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (!deps.getState().hero || deps.isBlocked?.()) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.hypot(dx, dy) >= SWIPE_PX) {
        this.cancel();
        deps.step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
        return;
      }
      const r = c.getBoundingClientRect();
      const g = deps.renderer.pixelToGrid(s.x - r.left, s.y - r.top);
      this.tapCell(Math.floor(g.x), Math.floor(g.y));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => (start = null));
  }

  /** Stop a tap-to-walk in progress. */
  cancel(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.path = [];
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** Tap on a grid cell: push if it's a box next to the hero, else walk there. */
  tapCell(tx: number, ty: number): void {
    const state = this.deps.getState();
    const h = state.hero;
    if (!h || tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) return;
    this.cancel();
    const adj = Math.abs(tx - h.x) + Math.abs(ty - h.y) === 1;
    const box = boxIdAt(state, tx, ty);
    if (adj && box !== null) {
      this.deps.step(tx > h.x ? 'right' : tx < h.x ? 'left' : ty > h.y ? 'down' : 'up');
      return;
    }
    let dirs: Dir[] | null;
    if (state.boxGravity) {
      // Platform mode: walk sideways toward the tapped column; the core climbs and drops.
      const n = Math.abs(tx - h.x);
      dirs = new Array(n).fill(tx > h.x ? 'right' : 'left');
    } else if (box !== null || cellSolid(state, tx, ty)) {
      // Tapped an obstacle: walk to the nearest free cell beside it (no push).
      const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ x: tx + dx, y: ty + dy }))
        .filter((v) => !cellSolid(state, v.x, v.y));
      dirs = goals.length ? heroPath(state, goals) : null;
    } else {
      dirs = heroPath(state, [{ x: tx, y: ty }]);
    }
    if (!dirs || dirs.length === 0) return;
    this.path = dirs;
    this.walkNext(true);
  }

  private airWait = 0;

  private walkNext(first: boolean): void {
    const d = this.path.shift();
    if (!d) return this.cancel();
    if (first) this.airWait = 0;
    if (!this.deps.step(d)) {
      // Gravity levels: the hero can't move while falling (e.g. just walked off a ledge): wait for
      // it to land and carry on, for up to ~2 s. Any other failure (a wall, a stuck box) stops.
      const st = this.deps.getState();
      const h = st.hero;
      if (h && st.boxGravity && !cellSolid(st, h.x, h.y + 1) && this.airWait++ < 30) {
        this.path.unshift(d);
        this.timer = window.setTimeout(() => this.walkNext(false), 60);
        return;
      }
      return this.cancel();
    }
    if (this.path.length === 0) return this.cancel();
    this.timer = window.setTimeout(() => this.walkNext(false), STEP_MS);
  }
}
