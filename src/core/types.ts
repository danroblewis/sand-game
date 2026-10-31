// Shared type contract for the whole game. All modules import from here.
// Do not add runtime logic to this file beyond trivial helpers/constants.

/** Fine sand cells per grid-cell edge. A 1x1 box holds N*N grains. */
export const GRAINS_PER_CELL = 24;

/** Grains in one full grid cell. */
export const GRAINS_PER_UNIT = GRAINS_PER_CELL * GRAINS_PER_CELL;

/** A grain cell value packs color (low 5 bits) and a shade (high 3 bits). 0 = empty. */
export const COLOR_MASK = 0x1f;
export const SHADE_SHIFT = 5;
export const SHADE_COUNT = 8;

export const grainColor = (v: number): ColorId => v & COLOR_MASK;
export const grainShade = (v: number): number => v >>> SHADE_SHIFT;
export const packGrain = (color: ColorId, shade: number): number =>
  (color & COLOR_MASK) | ((shade & (SHADE_COUNT - 1)) << SHADE_SHIFT);

/** 1..31. 0 means empty. */
export type ColorId = number;

export interface Vec {
  x: number;
  y: number;
}

/** Shape names. Cells are defined in shapes.ts; (0,0) is the top-left of the bounding box. */
export type ShapeName =
  | '1x1'
  | '2x1' // two wide, one tall
  | '1x2' // one wide, two tall
  | '2x2'
  | '3x1'
  | '1x3'
  | 'L0' // L tetromino, 4 rotations (3 tall / 3 wide variants)
  | 'L90'
  | 'L180'
  | 'L270'
  | 'J0' // mirrored L, 4 rotations
  | 'J90'
  | 'J180'
  | 'J270'
  | 'S' // small L: 3 cells in a 2x2 bounding box, 4 rotations
  | 'S90'
  | 'S180'
  | 'S270';

// ---------- Level definitions (authored data) ----------

/** One horizontal layer of sand, bottom to top order inside a sand box. `amount` is in grid-cell
 *  units: 1 = GRAINS_PER_UNIT grains. Fractions allowed (0.5 = half a cell of sand). */
export interface LayerDef {
  color: ColorId;
  amount: number;
}

export interface SandBoxDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bottom layer first. Sum of amounts must be <= w*h. */
  layers: LayerDef[];
}

export interface BoxDef {
  shape: ShapeName;
  x: number;
  y: number;
  color: ColorId;
  /** If > 0, the box starts frozen and unfreezes after this many boxes are completed. */
  frozen?: number;
  /** A driven box: it has a built-in force in this direction. It moves the moment it can (one cell
   *  per BOX_FALL_INTERVAL steps) and pushes the train of boxes in front of it. See DESIGN.md. */
  force?: Dir;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** A conveyor belt: a strip of `length` grid cells starting at (x, y) and running in `dir`. Boxes
 *  with any cell on the strip ride it one cell per CONVEYOR_INTERVAL steps toward the end, queueing
 *  up behind whatever blocks them (typically a sand box face). The strip is walkable: boxes can be
 *  dragged on or off it. A box the player is holding (`GameState.heldBoxId`) is not carried. */
export interface ConveyorDef {
  x: number;
  y: number;
  dir: Dir;
  length: number;
  /** Steps per cell for this belt (default CONVEYOR_INTERVAL). Loops in big maps use faster belts. */
  interval?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Board size in grid cells. */
  width: number;
  height: number;
  sandBoxes: SandBoxDef[];
  boxes: BoxDef[];
  conveyors?: ConveyorDef[];
  /** Fixed wall cells: obstacles like sand boxes, but holding no sand. */
  walls?: Vec[];
  /** When true, boxes fall (one cell per BOX_FALL_INTERVAL steps) until they rest on the floor, a
   *  wall, a sand box, or another box. Default false. */
  boxGravity?: boolean;
  /** Hero (Sokoban) mode: the player is a character starting at this cell who walks and pushes
   *  boxes. Boxes are never dragged in hero levels. Combine with boxGravity for platform-Sokoban. */
  hero?: Vec;
  /** Camera for boards larger than the screen. 'fit' (default) scales the whole board to fit;
   *  'scroll' follows the focus (hero, held box) smoothly at a fixed cell size; 'rooms' snaps
   *  between screen-sized rooms (square reveal). */
  camera?: 'fit' | 'scroll' | 'rooms';
  /** Optional one-line hint shown in the HUD. */
  hint?: string;
  /** Optional authored solution as drag steps "box#i -> (x,y)" (i = index into `boxes`). Levels are
   *  proven solvable by replaying this through the real simulation (scripts/replay.ts). */
  solution?: string[];
}

// ---------- Runtime state ----------

/** A fine-grained falling-sand region. Coordinates: x right, y DOWN (y=0 is the top row). */
export interface SandRegion {
  /** Size in fine cells. */
  w: number;
  h: number;
  /** Packed grain values, row-major: cells[y*w + x]. 0 = empty. */
  cells: Uint8Array;
  /** 1 if the fine cell is inside the shape, 0 if it is outside (never holds sand). null = all inside. */
  mask: Uint8Array | null;
  /** Number of grains currently in the region. */
  count: number;
  /** Number of fine cells inside the mask. */
  capacity: number;
}

export type BoxState = 'active' | 'removed';

export interface Box {
  id: number;
  shape: ShapeName;
  /** Occupied grid cells relative to (x, y). */
  cells: Vec[];
  /** Bounding size in grid cells. */
  bw: number;
  bh: number;
  /** Top-left grid position of the bounding box. */
  x: number;
  y: number;
  color: ColorId;
  /** Remaining completions needed before this box unfreezes. 0 = movable and accepting sand. */
  frozen: number;
  /** Direction a conveyor carried this box in on its last belt step, or null (for rendering). */
  pushDir: Dir | null;
  /** Cells fallen so far in the current fall under box gravity (0 when resting). */
  falling: number;
  /** Direction this box is sliding in after a kick, or null. It moves one cell per KICK_INTERVAL
   *  steps until blocked (or until it falls under gravity). */
  sliding: Dir | null;
  /** Built-in force direction for a driven box, or null (copied from BoxDef.force). */
  force: Dir | null;
  /** True while a driven box is pressing against something it cannot move (for rendering). */
  pressing: boolean;
  /** Fine grid region sized bw*N by bh*N with a mask built from `cells`. */
  region: SandRegion;
  state: BoxState;
}

export interface SandBoxState {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  region: SandRegion;
}

export interface ConveyorState {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  length: number;
  /** Steps per cell for this belt. */
  interval: number;
  /** Cells of the strip, in order from start to end. */
  cells: Vec[];
  /** 0..1 progress toward the next belt step (for continuous rendering of riders). */
  phase: number;
}

export interface HeroState {
  x: number;
  y: number;
  facing: Dir;
  /** Cells fallen in the current fall under box gravity (0 when standing). */
  falling: number;
}

export type GameEvent =
  | { type: 'boxCompleted'; boxId: number; x: number; y: number; cells: Vec[]; color: ColorId }
  | { type: 'conveyed'; conveyorId: number; boxIds: number[]; dir: Dir }
  | { type: 'boxLanded'; boxId: number; fell: number }
  | { type: 'heroMoved'; x: number; y: number; dir: Dir; climbed: boolean }
  | { type: 'heroPushed'; boxId: number; dir: Dir }
  | { type: 'heroLanded'; fell: number }
  | { type: 'heroKicked'; boxId: number; dir: Dir }
  | { type: 'boxSlid'; boxId: number; dir: Dir; cells: number }
  | { type: 'forcePushed'; boxId: number; boxIds: number[]; dir: Dir }
  | { type: 'boxUnfrozen'; boxId: number }
  | { type: 'boxMoved'; boxId: number; x: number; y: number }
  | { type: 'transfer'; count: number }
  /** Every box of `color` is gone: its leftover grains in the sand boxes have finished dissolving. */
  | { type: 'debrisDissolved'; color: ColorId }
  | { type: 'won' };

export interface GameState {
  level: LevelDef;
  width: number;
  height: number;
  sandBoxes: SandBoxState[];
  boxes: Box[];
  conveyors: ConveyorState[];
  /** Wall cells (copied from the level). Obstacles for movement; nothing else. */
  walls: Vec[];
  /** Box gravity on/off for this level (see LevelDef.boxGravity). */
  boxGravity: boolean;
  /** The hero in hero mode, else null. */
  hero: HeroState | null;
  /** Box currently held by the pointer (set by the input layer); conveyors leave it alone. */
  heldBoxId: number | null;
  /** Boxes completed so far (drives frozen counters). */
  completedCount: number;
  /** Player moves (grid steps). Informational only; there is no timer and no scoring. */
  moves: number;
  tick: number;
  won: boolean;
  /** Events emitted since the consumer last drained the array. Consumers should `.length = 0` it. */
  events: GameEvent[];
  /** Deterministic RNG state, advanced by the sim. */
  rng: { seed: number };
}

export type RegionOwner =
  | { kind: 'sandbox'; sandBox: SandBoxState }
  | { kind: 'box'; box: Box };
