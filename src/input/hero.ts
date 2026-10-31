// Hero (Sokoban) mode input: tap-to-walk, swipe, d-pad repeat. Keyboard lives in keyboard.ts.
// All core hero functions are looked up through the namespace and guarded, so this module is
// inert until the core provides them (and in levels without a hero).
import type { Dir, GameState, Vec } from '../core/types';
import * as Core from '../core';
import type { Renderer, View } from '../render/renderer';

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
  get kickBox() {
    return fn<[GameState, Dir], unknown>('kickBox');
  },
};

/** Kick timing (hold a swipe or an arrow key). */
export const CHARGE_START_MS = 1000;
export const KICK_HOLD_MS = 2000;

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
  /** One kick (with undo snapshot). Returns true if a box was kicked. */
  kick: (dir: Dir) => boolean;
  /** The view: the charge animation state is written to view.charge. */
  view: View;
  /** Called once when a hold becomes armed (sound / haptic tick). */
  onArmed?: () => void;
  isBlocked?: () => boolean;
}

interface TouchHold {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  t0: number;
  dir: Dir | null;
  /** The swipe locked a direction at some point (so a release is not a tap). */
  swiped: boolean;
  armedFired: boolean;
}

interface KeyHold {
  dir: Dir;
  t0: number;
  armedFired: boolean;
}

const STEP_MS = 90;
const FAST_STEP_MS = 45;
const SWIPE_PX = 24;

export class HeroInput {
  private timer = 0;
  private path: Dir[] = [];

  private hold: TouchHold | null = null;
  private keyHold: KeyHold | null = null;

  constructor(private deps: HeroInputDeps) {
    const c = deps.canvas;
    const local = (x: number, y: number) => {
      const r = c.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      if (!deps.getState().hero || deps.isBlocked?.()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.hold) return; // one finger
      e.preventDefault();
      this.cancelKey();
      this.hold = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), dir: null, swiped: false, armedFired: false };
    });
    c.addEventListener('pointermove', (e) => {
      const h = this.hold;
      if (!h || e.pointerId !== h.id) return;
      h.x = e.clientX;
      h.y = e.clientY;
      const dx = h.x - h.ox;
      const dy = h.y - h.oy;
      if (!h.dir) {
        if (Math.hypot(dx, dy) >= SWIPE_PX) {
          // lock a direction; the hold (for a kick) counts from the touch
          h.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          h.swiped = true;
        }
      } else {
        const [vx, vy] = DIRS[h.dir];
        if (dx * vx + dy * vy < SWIPE_PX * 0.5) {
          // moved back toward the origin: cancel (lifting now does nothing; swiping out again restarts)
          h.dir = null;
          h.t0 = performance.now();
          h.armedFired = false;
        }
      }
      this.paintTouch();
    });
    const end = (e: PointerEvent) => {
      const h = this.hold;
      if (!h || e.pointerId !== h.id) return;
      this.hold = null;
      deps.view.charge = null;
      if (e.type !== 'pointerup' || !deps.getState().hero || deps.isBlocked?.()) return;
      if (h.dir) {
        this.cancel();
        const held = performance.now() - h.t0;
        if (held >= KICK_HOLD_MS) deps.kick(h.dir);
        else deps.step(h.dir);
        return;
      }
      if (h.swiped) return; // swiped then came back: cancelled
      const p = local(h.ox, h.oy);
      const g = deps.renderer.pixelToGrid(p.x, p.y);
      this.tapCell(Math.floor(g.x), Math.floor(g.y));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /** Write the touch trail / charge into the view. */
  private paintTouch(now = performance.now()): void {
    const h = this.hold;
    if (!h) return;
    const r = this.deps.canvas.getBoundingClientRect();
    if (!h.dir) {
      this.deps.view.charge = null;
      return;
    }
    const [vx, vy] = DIRS[h.dir];
    const proj = Math.max(0, (h.x - h.ox) * vx + (h.y - h.oy) * vy);
    const held = now - h.t0;
    this.deps.view.charge = {
      dir: h.dir,
      progress: Math.max(0, Math.min(1, (held - CHARGE_START_MS) / (KICK_HOLD_MS - CHARGE_START_MS))),
      armed: held >= KICK_HOLD_MS,
      trail: { ox: h.ox - r.left, oy: h.oy - r.top, x: h.ox - r.left + vx * proj, y: h.oy - r.top + vy * proj },
    };
  }

  /** Per frame: advance the charge animation; keyboard holds kick at 2 s; armed feedback. */
  tick(now = performance.now()): void {
    const st = this.deps.getState();
    if (!st || !st.hero) {
      if (this.hold || this.keyHold) {
        this.hold = null;
        this.keyHold = null;
        this.deps.view.charge = null;
      }
      return;
    }
    if (this.hold) {
      this.paintTouch(now);
      if (this.hold.dir && !this.hold.armedFired && now - this.hold.t0 >= KICK_HOLD_MS) {
        this.hold.armedFired = true;
        this.deps.onArmed?.();
      }
      return;
    }
    const k = this.keyHold;
    if (!k) return;
    const held = now - k.t0;
    if (held >= KICK_HOLD_MS) {
      // keyboard: the kick fires at 2 s without waiting for the key to be released
      this.keyHold = null;
      this.deps.view.charge = null;
      this.deps.kick(k.dir);
      return;
    }
    this.deps.view.charge = held >= CHARGE_START_MS ? { dir: k.dir, progress: (held - CHARGE_START_MS) / (KICK_HOLD_MS - CHARGE_START_MS), armed: false } : null;
  }

  /** Arrow / WASD pressed: move now; holding it charges a kick in the same direction. Shift = kick now. */
  keyDown(dir: Dir, kickNow: boolean): void {
    this.cancel();
    if (kickNow) {
      this.cancelKey();
      this.deps.kick(dir);
      return;
    }
    this.deps.step(dir);
    this.keyHold = { dir, t0: performance.now(), armedFired: false };
  }

  keyUp(dir: Dir): void {
    if (this.keyHold && this.keyHold.dir === dir) this.cancelKey();
  }

  private cancelKey(): void {
    if (!this.keyHold) return;
    this.keyHold = null;
    if (!this.hold) this.deps.view.charge = null;
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
  private stepsTaken = 0;

  private walkNext(first: boolean): void {
    const d = this.path.shift();
    if (!d) return this.cancel();
    if (first) {
      this.airWait = 0;
      this.stepsTaken = 0;
    }
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
    // Long paths speed up after the third step.
    this.stepsTaken++;
    this.timer = window.setTimeout(() => this.walkNext(false), this.stepsTaken >= 3 ? FAST_STEP_MS : STEP_MS);
  }
}
