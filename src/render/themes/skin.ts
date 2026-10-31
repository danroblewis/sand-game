// The Skin contract: every visual the renderer produces goes through the active skin. The renderer
// keeps the motion (camera, glides, culling, effect lifetimes) and the shared sand pixel blit; a
// skin decides what things look like.
import type { Box, ColorId, ConveyorState, Dir, SandRegion, Vec } from '../../core/types';
import type { Effect, HeroCharge, View } from '../renderer';
import type { SkinProgression } from './progression/types';

/** What a skin may read from the renderer while drawing (device-pixel space). */
export interface SkinHost {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  /** Cell size in device pixels (may be fractional during the overview blend). */
  readonly cellSize: number;
  readonly dpr: number;
  /** Board top-left in device pixels. */
  readonly originX: number;
  readonly originY: number;
  readonly boardW: number;
  readonly boardH: number;
  /** Drawn (animated) box positions in grid units. */
  readonly positions: Map<number, { rx: number; ry: number }>;
  /** Driven-box trains moving on the next force step (id -> dir), or null. */
  readonly forces: Map<number, Dir> | null;
  /** Shared sand blit: the region's 1px-per-grain canvas (draw it scaled, smoothing off). */
  regionCanvas(region: SandRegion): { canvas: HTMLCanvasElement };
}

/** Hero pose computed by the renderer (device pixels). */
export interface HeroPose {
  cx: number;
  cy: number;
  /** Body radius. */
  R: number;
  /** y of the ground line under the hero (shadow). */
  groundY: number;
  /** Walk bob (cells, negative = up). */
  bob: number;
  /** Landing squash (1 = none). */
  squash: number;
  /** Sliding (thrown) direction vector, or null. */
  slide: [number, number] | null;
  facing: Dir;
}

/** The kick arrow (gameplay affordance) in device pixels. */
export interface KickArrow {
  cx: number;
  cy: number;
  charge: HeroCharge;
  /** 0..1 fade after release. */
  fade: number;
}

export interface Skin {
  readonly id: string;
  readonly name: string;
  /** Page / HUD background (CSS color) behind the board. */
  readonly pageBg: string;
  /** Themed level map, win fanfare and unlock ceremonies (DOM). */
  readonly progression: SkinProgression;

  /** Called when cell size or DPR changes: rebake sprite sheets if the skin uses any. */
  bake?(h: SkinHost): void;

  board(h: SkinHost): void;
  sandBox(h: SkinHost, gx: number, gy: number, gw: number, gh: number, region: SandRegion): void;
  walls(h: SkinHost, loops: Vec[][]): void;
  belt(h: SkinHost, cv: ConveyorState, now: number, progress: number, active: number): void;
  /** One box: body, sand, frozen overlay + counter, selection/hover, thaw flash, driver. */
  boxBody(h: SkinHost, b: Box, view: View, now: number): void;
  /** A same-color group drawn as one shape with seams; per-piece highlights. */
  group(h: SkinHost, members: Box[], view: View, now: number): void;
  /** Motion streak behind a kicked (sliding) box. */
  streak(h: SkinHost, b: Box, dir: Dir): void;
  hero(h: SkinHost, pose: HeroPose): void;
  kickArrow(h: SkinHost, a: KickArrow): void;

  // effects (lifetimes are managed by the renderer)
  pop(h: SkinHost, e: Extract<Effect, { kind: 'pop' }>, age: number): void;
  debris(h: SkinHost, e: Extract<Effect, { kind: 'debris' }>, age: number): void;
  dust(h: SkinHost, e: Extract<Effect, { kind: 'dust' }>, age: number): void;
  ping(h: SkinHost, e: Extract<Effect, { kind: 'ping' }>, age: number): void;
  /** Overview: outline of the normal viewport (grid rect), alpha 0..1. */
  viewportOutline(h: SkinHost, alpha: number, rect: { x0: number; y0: number; x1: number; y1: number }): void;
}

export type { ColorId };
