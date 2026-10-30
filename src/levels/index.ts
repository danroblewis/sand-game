import type { BoxDef, ColorId, LayerDef, LevelDef, SandBoxDef, ShapeName } from '../core/types';

export { validateLevel, levelCapacityByColor, levelSandByColor } from './validate';

// Palette ids (see DESIGN.md).
const R = 1; // red
const O = 2; // orange
const Y = 3; // yellow
const G = 4; // green
const T = 5; // teal
const B = 6; // blue
const P = 8; // purple
const K = 9; // pink
const W = 11; // white

/** Sand box helper: layers given bottom-first as [color, amount] pairs. */
const sb = (x: number, y: number, w: number, h: number, layers: [ColorId, number][]): SandBoxDef => ({
  x,
  y,
  w,
  h,
  layers: layers.map(([color, amount]): LayerDef => ({ color, amount })),
});

/** Box helper. */
const bx = (shape: ShapeName, x: number, y: number, color: ColorId, frozen?: number): BoxDef =>
  frozen ? { shape, x, y, color, frozen } : { shape, x, y, color };

/** Wall cells from [x, y] pairs. */
const wl = (...cells: [number, number][]) => cells.map(([x, y]) => ({ x, y }));
/** A vertical run of wall cells at column x, rows y0..y1 (inclusive), as [x, y] pairs. */
const wcol = (x: number, y0: number, y1: number): [number, number][] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i): [number, number] => [x, y0 + i]);
/** A horizontal run of wall cells at row y, columns x0..x1 (inclusive), as [x, y] pairs. */
const wrow = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i): [number, number] => [x0 + i, y]);

// Coordinates: x grows right, y grows DOWN, (0,0) is the top-left cell. Each level carries an
// authored `solution` (drag steps "box#i -> (x,y)") that is replayed through the real sand
// simulation by `npm run replay` and tests/levels-physics.test.ts; that replay is the proof the
// level is winnable. Use `npm run replay -- --verbose <id>` to see fills after every drag, and
// scripts/physics-lab.ts for the experiments behind the rules below.
//
// Rules of thumb for the real physics (pull reach 3 grains, completion slack 0.1 cell; measured
// with scripts/physics-lab.ts, experiments P..Z):
// - BELOW is king: a box right under a sand box catches the BOTTOM layer by gravity, fast
//   (~1 s for 2 cells) and completely, as long as it covers the full width of the sand box.
//   A box covering only part of the width leaves ~30% on the uncovered side (it stalls).
//   Only the box's color falls in. Sand boxes need empty space beneath for this.
// - TOP is useless: a box on top only skims a brim-full sand box (~0.3 cell), otherwise nothing.
// - SIDE at the TOP layer's height drains it completely by edge flow: 1-wide ~2.5 s per cell,
//   2-wide ~6-9 s for 2 cells (a 1x2 covering the layer row and the row below/above is the best
//   side shape), 3-wide 10-13 s per cell. Tall pieces (1x3, J/L bars) beside a 1-row layer take
//   just that layer. SIDE at a BURIED layer takes a wedge (~0.4 cell) and stalls until the layers
//   above are gone. Dock at the pile surface; as boxes take sand the pile drops: dock lower.
// - DEBRIS: a box pops within 0.1 cell of full; the leftover grains stay while another box of that
//   color is still on the board, then dissolve (~0.75 s). While they stay, foreign debris on top of
//   a layer seals it from the side and foreign debris on the floor blocks the next catch from
//   below, so with a color shared by several boxes keep its debris out of other layers' way.
//   Once every box of a color is gone its debris vanishes: stacks of unique colors (3+ layers)
//   can then be caught from below one after another, or peeled from the side.
// - CONVEYORS: a belt is a walkable strip; any unfrozen box with a cell on it rides one cell
//   every 100 steps (~1.7 s per cell, so a 4-cell ride takes ~7 s) toward the end and queues
//   behind whatever blocks it: the sand box face, the box ahead, a frozen box, a wall, or any box
//   parked in its path (riders wait until it is moved). When the front box pops, the queue
//   advances and the next box docks. Belts are slow on purpose: drop a box, then do something
//   else (clear the path, fetch the next box) while it crawls. A frozen box on the belt holds the
//   queue; when it thaws it rides on and the queue follows. Dragging a box back off the belt is
//   allowed. Boxes one cell thick along the belt keep the queue tight (2x1 on up/down belts).
//   In authored solutions a step ending in " &" doesn't wait for the ride to finish.
// - GROUPS: same-color boxes that share an edge pop together only when all are full. A box that
//   is full but touching an unfinished buddy stays (and keeps blocking its spot): separate them.
//   A pair fed side by side under a 2-wide sand box stalled short (~1.0 + 0.85), while feeding
//   them one after another worked, so keep same-color boxes apart when they dock.
// - WALLS are plain obstacle cells (no sand): use them to fence a sand box so a belt lane is the
//   only way in.
// - Catching many layers from below in turn: a 2x4 sand box with 4 unique colors empties
//   cleanly; in a 2x5 with 5 colors the 4th catch stalls at ~1.8/2 (the last layer slumps into
//   the gap), and a 1-wide 5-tall column stalls at the 3rd. Keep belt-fed stacks at 4 layers.
// - Same-color boxes that touch exchange sand (gravity/slump between boxes): keep same-color
//   boxes apart unless you want one to feed the other. Two same-color boxes stacked under a sand
//   box both fill. Two same-color boxes on the two sides of a top layer share it.
// - A partially filled box keeps what it has: one box can collect a shared color from two sand
//   boxes in turn (e.g. a 2x2 drinking 2 cells beside each of two corners).
// - Timing: catches ~1 s; side drains 2-9 s per 2 cells; a 2x2 drinking from the side of a
//   2-wide box keeps trickling for ~15-18 s.
//
// - BOX GRAVITY (chapter 2 "Workshop", physics-lab experiments GA..T12, PL, FR, PP): carrying is
//   free (any path of empty cells), boxes fall when released, so the puzzle is what holds a box at a
//   height and what touches what.
//   * TRAY SHAFT works: a one-row sand box (a "tray", 1-3 wide, 1 cell per band) at the foot of a
//     1-wide shaft. Only the bottom box touches it and drinks the top band (~8-10 s per 1x1); when it
//     pops the stack drops one cell. Stack order bottom-up = band order top-down; a wrong box at the
//     foot takes a ~0.08 wedge of a buried band and the tray jams. 4-wide trays (thinner bands) and
//     2-cell bands in a 4-wide tray stall short; a 1x2 at the foot works but is slow (~44 s).
//   * A band two cells deep needs two same-color 1x1s touching at the foot (one container, T8);
//     split by another box they fail (T8b).
//   * TALL SAND BOX + one box per layer does NOT work (GA/GH/GG): every box touches its buried layer
//     at once, wedges cave the column in, ~40% drains. Even dropping the aligned stack at once fails.
//   * Floating sand boxes: a box catches from below only while resting right under it (a wall ledge
//     or a pillar of other boxes); a stack under it does not rise when the catcher pops, so the next
//     catcher goes on the same support. Boxes cannot land side by side in the dock row (the sand box
//     is above it), so a "wide catcher by landing" is not possible there.
//   * Pins: a support pulled out (through a door in the shaft wall) drops the stack above it; a
//     closet (walls on three sides) over a shaft holds a fixed order that drops when the pin goes. A
//     pin at the shaft foot keeps a stack up so a higher box sits beside a second tray (two trays,
//     one shaft). Frozen boxes don't dock: a frozen plug at the foot holds the sequence until it thaws.
//   * Wall off every tray side a box could reach from the floor, or it is a second (bypass) contact.
//   * Debris still matters: a floating sand box's leftover of a color blocks its next catch while
//     another box of that color is on the board; give each floating sand box its own colors.
// - HERO (chapter 3 "Pusher", physics-lab HA, the levels themselves): solutions are U/D/L/R strings,
//   6 sim steps per input, settle after each string. A push moves one box one cell; a box only catches
//   when it ends right under / beside the sand, but it does drink on the way for the steps it spends
//   beside a sand box (start boxes away from sides they slide past). A box against a wall or the
//   board edge can never be pulled back: check every push direction is still possible
//   (scripts/hero-plan.ts searches input strings for a goal). Gravity: walking into a box pushes it if it can move, else climbs
//   it (one cell, the cell above the hero must be free); up/down do nothing. The hero holds up the
//   boxes above him, rides a shaft down when a pin he pushed was his floor, and falls when the box he
//   stands on pops. A step box pushed against a wall is stuck for good, so it must drain where it
//   stands, and never beside a buried band of its own color (it wedges and jams the tray): lean it on
//   a frozen box instead and let it slide into the frozen box's place after the thaw.
// Map legend in the level comments: # sand box, capital letter = box (R red, O orange, Y yellow,
// G green, T teal, B blue, P purple, K pink, W white), lower-case = frozen box, ^ v < > = empty belt
// cell running in that direction, = wall, @ hero, . empty.

export const LEVELS: LevelDef[] = [
  //   . . . . . .
  //   . . # # . .
  //   . . # # . .
  //   . . . . . .
  //   . . . . . .
  //   . . . . . .
  //   . . R R . .
  //   . . . . . .
  // Solution: Slide the red bar under the sand box; the red falls straight in.
  {
    id: 'first-pour',
    name: 'First Pour',
    width: 6,
    height: 8,
    sandBoxes: [sb(2, 1, 2, 2, [[R, 2]])],
    boxes: [bx('2x1', 2, 6, R)],
    hint: 'Drag the box right under the sand box: the sand falls in.',
    solution: ['box#0 -> (2,3)'],
  },
  //   . . . . . .
  //   . . # . . .
  //   . . # . . .
  //   . . # . . .
  //   . . . . . .
  //   . . . . . .
  //   . . R . . B
  //   . . . . . .
  // Solution: A red box under the sand box gets nothing: blue is the bottom layer. Put blue under
  // it first; the red then lies on the floor, so dock the red box beside it.
  {
    id: 'two-colors',
    name: 'Two Colors',
    width: 6,
    height: 8,
    sandBoxes: [sb(2, 1, 1, 3, [[B, 1], [R, 1]])],
    boxes: [bx('1x1', 2, 6, R), bx('1x1', 5, 6, B)],
    hint: 'From below, only the bottom layer falls in. Then the red lies on the floor: dock beside it.',
    solution: ['box#1 -> (2,4)', 'box#0 -> (3,3)'],
  },
  //   . . R . . .
  //   . . R . . .
  //   . . # # . .
  //   . . # # . .
  //   . . # # . .
  //   . . . . . .
  //   . . . . . .
  //   . . . . . .
  //   B B . . . .
  // Solution: The red box starts on top and gets nothing (the box is not brim-full). Dock it on
  // the side at the red layer, then catch the blue from below.
  {
    id: 'top-down',
    name: 'Top Down',
    width: 6,
    height: 9,
    sandBoxes: [sb(2, 2, 2, 3, [[B, 2], [R, 2]])],
    boxes: [bx('1x2', 2, 0, R), bx('2x1', 0, 8, B)],
    hint: 'A box on top only skims a brim-full sand box. Dock on the side, right at the top layer.',
    solution: ['box#0 -> (4,3)', 'box#1 -> (2,5)'],
  },
  //   # # . . . .
  //   # # . . . .
  //   # # . . . .
  //   . . . . . .
  //   . . . . . .
  //   . . . . G G
  //   . . . . G G
  //   B B . . . .
  // Solution: The first green 1x2 docks beside the top two rows; the pile drops, so the second
  // green docks one row lower; blue is caught from below.
  {
    id: 'side-door',
    name: 'Side Door',
    width: 6,
    height: 8,
    sandBoxes: [sb(0, 0, 2, 3, [[B, 2], [G, 4]])],
    boxes: [bx('1x2', 5, 5, G), bx('1x2', 4, 5, G), bx('2x1', 0, 7, B)],
    hint: 'A side box drinks the layer at its height. As the pile drops, dock the next box lower.',
    solution: ['box#0 -> (2,0)', 'box#1 -> (2,1)', 'box#2 -> (0,3)'],
  },
  //   # # . . # # .
  //   # # . . # # .
  //   . . . . . . .
  //   . . . . . . .
  //   . . . . . . G
  //   . . R . . . G
  //   . . R . . R R
  //   B B . . . . .
  // Solution: Red is on top of the left box and at the bottom of the right one: one red docks
  // beside the left box, the other catches the right box from below. Blue is caught under the left
  // box, green drinks the right box from the side.
  {
    id: 'dominoes',
    name: 'Two Reds',
    width: 7,
    height: 8,
    sandBoxes: [sb(0, 0, 2, 2, [[B, 2], [R, 2]]), sb(4, 0, 2, 2, [[R, 2], [G, 2]])],
    boxes: [bx('1x2', 2, 5, R), bx('2x1', 5, 6, R), bx('2x1', 0, 7, B), bx('1x2', 6, 4, G)],
    hint: 'Red is on top in one sand box and at the bottom in the other: one red docks beside it, one catches it from below.',
    solution: ['box#0 -> (2,0)', 'box#1 -> (4,2)', 'box#2 -> (0,2)', 'box#3 -> (3,0)'],
  },
  //   # # . . . .
  //   # # . . . .
  //   . . . . . .
  //   . . # # . .
  //   . . # # . .
  //   . . # # . .
  //   Y Y . G R .
  //   . . . G R .
  //   . . B B . .
  // Solution: The green 1x2 blocks the catch spot under the blue/green box. Move red to the side
  // of the yellow/red box first (it drains the red top), green to the side of its box, then blue
  // up into the catch spot and yellow under its box.
  {
    id: 'stacked',
    name: 'Stacked',
    width: 6,
    height: 9,
    sandBoxes: [sb(0, 0, 2, 2, [[Y, 2], [R, 2]]), sb(2, 3, 2, 3, [[B, 2], [G, 2]])],
    boxes: [bx('2x1', 0, 6, Y), bx('1x2', 3, 6, G), bx('1x2', 4, 6, R), bx('2x1', 2, 8, B)],
    hint: 'The box under the sand box is the wrong color: make room before you can catch from below.',
    solution: ['box#2 -> (2,0)', 'box#1 -> (4,4)', 'box#3 -> (2,6)', 'box#0 -> (0,2)'],
  },
  //   . . . . . # #
  //   . . . . . . .
  //   . . # # g . .
  //   . . # # g . .
  //   . . . . . . .
  //   . . . . . . .
  //   . . . . . . .
  //   R R . . B B .
  // Solution: The green ice box already sits beside the green. Catch the blue from below: the pop
  // thaws the green, which drinks the green that has dropped to its level. Red catches the small
  // red box from below.
  {
    id: 'ice-gate',
    name: 'Ice Gate',
    width: 7,
    height: 8,
    sandBoxes: [sb(2, 2, 2, 2, [[B, 2], [G, 2]]), sb(5, 0, 2, 1, [[R, 2]])],
    boxes: [bx('1x2', 4, 2, G, 1), bx('2x1', 0, 7, R), bx('2x1', 4, 7, B)],
    hint: 'Ice thaws after the number of pops shown. The green ice box is already in place.',
    solution: ['box#2 -> (2,4)', 'box#1 -> (5,1)'],
  },
  //   . . # # . . .
  //   . . # # . R .
  //   . . . . . R .
  //   . . b b . . .
  //   . . . . p . .
  //   . . . . p . .
  //   . . # # . . .
  //   . . # # . . .
  //   . . . . . . .
  //   . . . . . G G
  // Solution: Red docks beside the upper box, green catches the lower box from below (2 pops): the
  // blue ice bar thaws and moves up one row into the catch spot; then the purple ice box thaws and
  // docks beside the lower box.
  {
    id: 'ice-maze',
    name: 'Thaw Order',
    width: 7,
    height: 10,
    sandBoxes: [sb(2, 0, 2, 2, [[B, 2], [R, 2]]), sb(2, 6, 2, 2, [[G, 2], [P, 2]])],
    boxes: [
      bx('1x2', 5, 1, R),
      bx('2x1', 5, 9, G),
      bx('2x1', 2, 3, B, 2),
      bx('1x2', 4, 4, P, 3),
    ],
    hint: 'The blue ice box is one row too low. Pop two boxes, then lift it into the gap under its sand.',
    solution: ['box#0 -> (4,0)', 'box#1 -> (2,8)', 'box#2 -> (2,2)', 'box#3 -> (4,6)'],
  },
  //   . . # . . .
  //   . . # . . .
  //   . . # . . .
  //   # # ^ # # .
  //   # # ^ # # .
  //   . . ^ . . B
  //   Y Y ^ P P R
  //   Y Y P P . G
  // Solution: Drop the boxes on the belt in layer order: blue (bottom), red, green. Each rides up
  // and catches its layer from below; the queue advances when the front box pops. The yellow and
  // purple walls are caught from below.
  {
    id: 'belt-loaded',
    name: 'Belt Loaded',
    width: 6,
    height: 8,
    sandBoxes: [sb(2, 0, 1, 3, [[B, 1], [R, 1], [G, 1]]), sb(0, 3, 2, 2, [[Y, 4]]), sb(3, 3, 2, 2, [[P, 4]])],
    boxes: [
      bx('1x1', 5, 6, R),
      bx('1x1', 5, 7, G),
      bx('1x1', 5, 5, B),
      bx('2x1', 0, 7, Y),
      bx('2x1', 0, 6, Y),
      bx('2x1', 3, 6, P),
      bx('2x1', 2, 7, P),
    ],
    conveyors: [{ x: 2, y: 6, dir: 'up', length: 4 }],
    hint: 'Drop a box on the belt and it rides to the sand box; the queue advances when the front box pops. Load the layers bottom first.',
    solution: [
      'box#2 -> (2,5)',
      'box#0 -> (2,5)',
      'box#1 -> (2,5)',
      'box#4 -> (0,5)',
      'box#3 -> (0,5)',
      'box#5 -> (3,5)',
      'box#6 -> (3,5)',
    ],
  },
  //   . Y . . . # #
  //   . Y . . . # #
  //   Y Y . . . # #
  //   Y Y . . . # #
  //   . Y . . . # #
  //   . Y . . . # #
  //   . Y . . . # #
  //   . Y . . . # #
  //   Y Y . . . # #
  //   . . G G . . .
  // Solution: The tall 2-wide column is yellow on a thin green floor. Each yellow J/L hooks its
  // bar beside the pile surface, one notch lower each time; the green is caught from below.
  {
    id: 'hooks',
    name: 'Hooks',
    width: 7,
    height: 10,
    sandBoxes: [sb(5, 0, 2, 9, [[G, 2], [Y, 12]])],
    boxes: [bx('J0', 0, 0, Y), bx('L180', 0, 3, Y), bx('J0', 0, 6, Y), bx('2x1', 2, 9, G)],
    hint: 'A side box drinks the top layer at its height. The pile sinks: hook each piece in lower.',
    solution: ['box#0 -> (3,1)', 'box#1 -> (3,3)', 'box#2 -> (3,5)', 'box#3 -> (5,9)'],
  },
  //   . . . . . . .
  //   . . . . . . .
  //   . # . # . # .
  //   . # . # . # .
  //   B # G # Y # T
  //   B # G # Y # T
  //   . # . # . # .
  //   . # . # . # .
  //   R . . . . . K
  //   R . . . . . K
  // Solution: Catch each column's bottom layer from below (red, pink, blue). The top layers drop
  // to the floor; dock yellow, green and teal in the lanes beside the floor rows.
  {
    id: 'lanes',
    name: 'Lanes',
    width: 7,
    height: 10,
    sandBoxes: [sb(1, 2, 1, 6, [[R, 2], [Y, 2]]), sb(3, 2, 1, 6, [[B, 2], [T, 2]]), sb(5, 2, 1, 6, [[K, 2], [G, 2]])],
    boxes: [
      bx('1x2', 0, 4, B),
      bx('1x2', 2, 4, G),
      bx('1x2', 4, 4, Y),
      bx('1x2', 6, 4, T),
      bx('1x2', 0, 8, R),
      bx('1x2', 6, 8, K),
    ],
    hint: 'Catch each bottom layer from below; the top layer then drops to the floor - drink it from the side at its new height.',
    solution: [
      'box#4 -> (1,8)',
      'box#5 -> (5,8)',
      'box#0 -> (3,8)',
      'box#2 -> (0,6)',
      'box#1 -> (4,6)',
      'box#3 -> (2,6)',
    ],
  },
  //   # # . . . O O
  //   # # . . . . .
  //   . . . B . . .
  //   . . . B . . .
  //   # # # . # # #
  //   w w w . w w w
  //   . . . R . # #
  //   . . . R . # #
  //   Y Y . . . . .
  // Solution: Blue steps aside, red climbs through the gap and docks beside the red on top; blue
  // drops through the gap beside the blue. The white ice bars thaw under their walls and fill.
  // Orange catches its box from below, yellow catches the bottom-right box from below.
  {
    id: 'swap-meet',
    name: 'Swap Meet',
    width: 7,
    height: 9,
    sandBoxes: [
      sb(0, 0, 2, 2, [[O, 2], [R, 2]]),
      sb(0, 4, 3, 1, [[W, 3]]),
      sb(4, 4, 3, 1, [[W, 3]]),
      sb(5, 6, 2, 2, [[Y, 2], [B, 2]]),
    ],
    boxes: [
      bx('1x2', 3, 2, B),
      bx('2x1', 5, 0, O),
      bx('3x1', 4, 5, W, 3),
      bx('1x2', 3, 6, R),
      bx('3x1', 0, 5, W, 2),
      bx('2x1', 0, 8, Y),
    ],
    hint: 'Someone has to step aside to let the other through the gap.',
    solution: ['box#0 -> (4,1)', 'box#3 -> (2,0)', 'box#0 -> (4,6)', 'box#1 -> (0,2)', 'box#5 -> (5,8)'],
  },
  //   # . . . . . .
  //   # . R . . . .
  //   # . R . . . .
  //   . . . B . . .
  //   . . . B . . .
  //   # # # . # # #
  //   w w w . w w w
  //   . . . R . # #
  //   . . . . . # #
  //   G G . . . . .
  // Solution: Red 1x2 catches the red column from below. Blue steps aside, the red 1x1 climbs the
  // gap and catches the rest (white ice bars thaw and fill). Blue drops through the gap beside the
  // blue, and green catches the bottom-right box from below.
  {
    id: 'double-swap',
    name: 'Double Swap',
    width: 7,
    height: 10,
    sandBoxes: [
      sb(0, 0, 1, 3, [[R, 3]]),
      sb(0, 5, 3, 1, [[W, 3]]),
      sb(4, 5, 3, 1, [[W, 3]]),
      sb(5, 7, 2, 2, [[G, 2], [B, 2]]),
    ],
    boxes: [
      bx('1x2', 2, 1, R),
      bx('1x2', 3, 3, B),
      bx('2x1', 0, 9, G),
      bx('3x1', 0, 6, W, 3),
      bx('1x1', 3, 7, R),
      bx('3x1', 4, 6, W, 2),
    ],
    hint: 'Two red boxes share one column of red: each catches it from below in turn.',
    solution: ['box#0 -> (0,3)', 'box#1 -> (4,3)', 'box#4 -> (0,3)', 'box#1 -> (4,7)', 'box#2 -> (5,9)'],
  },
  //   # # . . Y # #
  //   # # . . Y # #
  //   . . . . Y . .
  //   . . o o Y . .
  //   B B o o . R R
  //   . . . . . . .
  //   # # . . . # #
  //   # # . . . # #
  //   P P . . . G G
  // Solution: Yellows dock beside the bottom boxes, red and blue catch the top corners from below.
  // Green and purple sit under the wrong boxes: park green, let purple through, then green. After
  // three pops the orange 2x2 drinks the orange beside the top-left box, then beside the top-right
  // one.
  {
    id: 'four-corners',
    name: 'Four Corners',
    width: 7,
    height: 9,
    sandBoxes: [
      sb(0, 0, 2, 2, [[R, 2], [O, 2]]),
      sb(5, 0, 2, 2, [[B, 2], [O, 2]]),
      sb(0, 6, 2, 2, [[G, 2], [Y, 2]]),
      sb(5, 6, 2, 2, [[P, 2], [Y, 2]]),
    ],
    boxes: [
      bx('2x2', 2, 3, O, 3),
      bx('2x1', 5, 4, R),
      bx('2x1', 0, 4, B),
      bx('1x2', 4, 2, Y),
      bx('1x2', 4, 0, Y),
      bx('2x1', 5, 8, G),
      bx('2x1', 0, 8, P),
    ],
    hint: 'The orange box needs the orange from both top corners. Swap the two boxes on the floor.',
    solution: [
      'box#3 -> (4,6)',
      'box#1 -> (0,2)',
      'box#2 -> (5,2)',
      'box#4 -> (2,6)',
      'box#5 -> (3,5)',
      'box#6 -> (5,8)',
      'box#5 -> (0,8)',
      'box#0 -> (2,0)',
      'box#0 -> (3,0)',
    ],
  },
  //   # # < < < < <
  //   # # . T . . .
  //   # # # # # . .
  //   # # . . . . .
  //   . . . . . . Y
  //   . . . R . G Y
  //   O O . R . G .
  //   B B . . . . .
  // Solution: Drop yellow at the start of the belt; while it crawls along the top row, move the
  // parked teal box out of its path and under the teal wall. Green follows on the belt (yellow and
  // green drink the top two layers of the tall box). Orange catches its wall from below, blue
  // catches the tall box from below, and the red that dropped to the floor is drunk from the side.
  {
    id: 'conveyor',
    name: 'Conveyor',
    width: 7,
    height: 8,
    sandBoxes: [
      sb(0, 0, 2, 4, [[B, 2], [R, 2], [G, 2], [Y, 2]]),
      sb(2, 2, 2, 1, [[O, 2]]),
      sb(4, 2, 1, 1, [[T, 1]]),
    ],
    boxes: [
      bx('1x2', 6, 4, Y),
      bx('1x2', 5, 5, G),
      bx('1x2', 3, 5, R),
      bx('2x1', 0, 7, B),
      bx('2x1', 0, 6, O),
      bx('1x1', 3, 1, T),
    ],
    conveyors: [{ x: 6, y: 0, dir: 'left', length: 5 }],
    hint: 'The belt is slow: while a box crawls toward the tall sand box, move the teal box out of its way. The belt only reaches the top two rows.',
    solution: [
      'box#0 -> (6,0) &',
      'box#5 -> (4,3)',
      'box#1 -> (6,0)',
      'box#4 -> (2,3)',
      'box#3 -> (0,4)',
      'box#2 -> (2,3)',
    ],
  },
  //   . # # # # # .
  //   . # # # # # .
  //   . # # t # # .
  //   # # # t # # #
  //   # # # . # # #
  //   # g g . y y #
  //   . B R . R B .
  // Solution: Blue (right) goes under the blue; red, then blue (left) park in the pocket; the
  // other red goes under the red; the parked blue and red come out and go home (4 pops thaw the
  // bars). Green, yellow and teal ice boxes thaw under their sand and fill.
  {
    id: 'shunting-yard',
    name: 'Shunting Yard',
    width: 7,
    height: 7,
    sandBoxes: [
      sb(0, 3, 1, 3, [[R, 2]]),
      sb(6, 3, 1, 3, [[B, 2]]),
      sb(1, 0, 2, 5, [[G, 2]]),
      sb(4, 0, 2, 5, [[Y, 2]]),
      sb(3, 0, 1, 2, [[T, 2]]),
    ],
    boxes: [
      bx('1x1', 1, 6, B),
      bx('1x1', 2, 6, R),
      bx('1x1', 4, 6, R),
      bx('1x1', 5, 6, B),
      bx('2x1', 1, 5, G, 4),
      bx('2x1', 4, 5, Y, 4),
      bx('1x2', 3, 2, T, 5),
    ],
    hint: 'Reds go left under the red, blues go right under the blue: shunt them past each other.',
    solution: ['box#3 -> (6,6)', 'box#1 -> (3,4)', 'box#0 -> (3,5)', 'box#2 -> (0,6)', 'box#0 -> (6,6)', 'box#1 -> (0,6)'],
  },
  //   . . = # # = . .
  //   . . = # # = . .
  //   . . = # # = . .
  //   . . = # # = . .
  //   . . = ^ . = R R
  //   g g = ^ . = B B
  //   O O = ^ . = Y Y
  //   . . . ^ . . . .
  //   # # . ^ . . . .
  //   # # . . . . . .
  // Solution: Orange leaves the left pocket and docks beside its box. Yellow blocks the right
  // pocket: park it at the bottom. Blue goes on the belt, red right behind it (the queue advances
  // as blue pops); three pops thaw green, which goes on the belt next, then the parked yellow.
  {
    id: 'gauntlet',
    name: 'Gauntlet',
    width: 8,
    height: 10,
    sandBoxes: [sb(3, 0, 2, 4, [[B, 2], [R, 2], [G, 2], [Y, 2]]), sb(0, 8, 2, 2, [[O, 2]])],
    walls: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 }, { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }],
    conveyors: [{ x: 3, y: 8, dir: 'up', length: 5 }],
    boxes: [
      bx('2x1', 6, 6, Y),
      bx('2x1', 6, 5, B),
      bx('2x1', 6, 4, R),
      bx('2x1', 0, 6, O),
      bx('2x1', 0, 5, G, 3),
    ],
    hint: 'The walled sand box is fed only by the belt: queue the colors bottom layer first. Park the boxes that come out in the wrong order while the belt crawls.',
    solution: [
      'box#3 -> (2,9)',
      'box#0 -> (6,9)',
      'box#1 -> (3,7) &',
      'box#2 -> (3,8)',
      'box#4 -> (3,7) &',
      'box#0 -> (3,8)',
    ],
  },
  //   # # . . . . # #
  //   # # . . . . # #
  //   . . . o o . . .
  //   . . . o o . . .
  //   . . . . . . . .
  //   . . . . . B . .
  //   R R . # # B . .
  //   R R . # # . . .
  //   . . . . . . G G
  //   . . . . . . . .
  // Solution: Blue drinks the top of the right box; the red 2x2 catches red under the left box,
  // then under the right box (2 pops thaw orange). The orange 2x2 drinks beside the top-left box,
  // then beside the bottom box; green catches the bottom box from below.
  {
    id: 'grand-central',
    name: 'Grand Central',
    width: 8,
    height: 10,
    sandBoxes: [
      sb(0, 0, 2, 2, [[R, 2], [O, 2]]),
      sb(6, 0, 2, 2, [[R, 2], [B, 2]]),
      sb(3, 6, 2, 2, [[G, 2], [O, 2]]),
    ],
    boxes: [
      bx('2x2', 3, 2, O, 2),
      bx('1x2', 5, 5, B),
      bx('2x2', 0, 6, R),
      bx('2x1', 6, 8, G),
    ],
    hint: 'Red and orange are each split between two sand boxes. Catch bottoms from below, drink tops from the side.',
    solution: ['box#1 -> (5,0)', 'box#2 -> (0,2)', 'box#2 -> (6,2)', 'box#0 -> (2,0)', 'box#0 -> (5,6)', 'box#3 -> (3,8)'],
  },
  // ---- Chapter 2: Workshop (box gravity) ----
  //   . . . . . .
  //   . . # # . .
  //   . . . . . .
  //   . = = = . .
  //   . = . . . .
  //   . = . . . .
  //   . = . . . .
  //   . # = B B R
  // Solution: Carry the red to the top of the shaft and let go: it falls to the foot, lands beside
  // the red sand and drinks it. The blue rests on the ledge right under the blue sand and catches it.
  {
    id: 'drop-in',
    name: 'Drop In',
    width: 6,
    height: 8,
    boxGravity: true,
    sandBoxes: [sb(1, 7, 1, 1, [[R, 1]]), sb(2, 1, 2, 1, [[B, 2]])],
    walls: wl(...wcol(1, 3, 6), [2, 3], [3, 3], [2, 7]),
    boxes: [bx('1x1', 5, 7, R), bx('2x1', 3, 7, B)],
    hint: 'Boxes fall here. Drop the red down the shaft: it lands beside the red sand and drinks it. Rest the blue on the ledge under the blue.',
    solution: ['box#0 -> (0,0)', 'box#1 -> (2,2)'],
  },
  //   . . . . . . .
  //   . . . . . . .
  //   . = . . . . .
  //   . = . . . . .
  //   . = . . . . .
  //   . = . . . . .
  //   . = . . . . B
  //   . = . . . . R
  //   . # # # = . Y
  // Solution: Only the box at the foot of the shaft touches the tray, and it drinks the top band.
  // The pile is in the wrong order: park blue on the wall and red on the floor, drop yellow, then
  // red, then blue; each pop drops the stack one cell onto the tray.
  {
    id: 'stack-order',
    name: 'Stack Order',
    width: 7,
    height: 9,
    boxGravity: true,
    sandBoxes: [sb(1, 8, 3, 1, [[B, 1], [R, 1], [Y, 1]])],
    walls: wl(...wcol(1, 2, 7), [4, 8]),
    boxes: [bx('1x1', 6, 8, Y), bx('1x1', 6, 7, R), bx('1x1', 6, 6, B)],
    hint: 'Only the bottom box of the shaft touches the tray, and it drinks the top band. When it pops the stack drops one. Load the top band\'s color first.',
    solution: ['box#2 -> (4,7)', 'box#1 -> (5,8)', 'box#0 -> (0,0)', 'box#1 -> (0,0)', 'box#2 -> (0,0)'],
  },
  //   . . . . . . .
  //   # # . . . # #
  //   # # . . . # #
  //   . . . . . . .
  //   = = . . . = =
  //   . . . . . . .
  //   . . . . . . .
  //   . . G G B B .
  //   . . R R Y Y .
  // Solution: Lift green and blue off the piles, catch red and yellow (the bottom layers) on the
  // ledges, then blue and green on the same ledges.
  {
    id: 'shelf-life',
    name: 'Shelf Life',
    width: 7,
    height: 9,
    boxGravity: true,
    sandBoxes: [sb(0, 1, 2, 2, [[R, 2], [B, 2]]), sb(5, 1, 2, 2, [[Y, 2], [G, 2]])],
    walls: wl([0, 4], [1, 4], [5, 4], [6, 4]),
    boxes: [bx('2x1', 2, 8, R), bx('2x1', 2, 7, G), bx('2x1', 4, 8, Y), bx('2x1', 4, 7, B)],
    hint: 'A box resting on a ledge under a sand box catches its bottom layer. When it pops, rest the next one on the same ledge. Dig out the bottom layers first.',
    solution: ['box#1 -> (2,6)', 'box#3 -> (2,5)', 'box#0 -> (0,3)', 'box#2 -> (5,3)', 'box#3 -> (0,3)', 'box#1 -> (5,3)'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . Y R Y G B . .
  //   . = = = = = = .
  //   . = = = = = = .
  //   . = = = = = = .
  //   . = = = = = = .
  //   . # # # . # # .
  // Solution: The left tray's top band is yellow two cells deep: drop both yellows (they touch, so
  // they are one container and drink it through the bottom one), then red. Right shaft: blue, green.
  {
    id: 'pair-up',
    name: 'Pair Up',
    width: 8,
    height: 9,
    boxGravity: true,
    sandBoxes: [sb(1, 8, 3, 1, [[R, 1], [Y, 2]]), sb(5, 8, 2, 1, [[G, 1], [B, 1]])],
    walls: wl(...wrow(4, 1, 6), ...wrow(5, 1, 6), ...wrow(6, 1, 6), ...wrow(7, 1, 6)),
    boxes: [bx('1x1', 1, 3, Y), bx('1x1', 2, 3, R), bx('1x1', 3, 3, Y), bx('1x1', 4, 3, G), bx('1x1', 5, 3, B)],
    hint: 'Same-color boxes that touch are one container. The yellow band is two cells deep: only two yellows touching at the foot of the shaft can drink it all.',
    solution: ['box#0 -> (0,0) &', 'box#2 -> (0,0) &', 'box#1 -> (0,0) &', 'box#4 -> (7,0) &', 'box#3 -> (7,0)'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . = . . . . . .
  //   . = . . # # . .
  //   . = . . # # . .
  //   . = . . . . Y O
  //   . = = . . . R R
  //   . # # = . . B B
  // Solution: Stack orange then yellow under the floating sand box as a pillar, park red on the
  // wall, catch blue then red on top of the pillar, then drop the pillar down the shaft: yellow
  // (the top band) first, then orange.
  {
    id: 'pillar',
    name: 'Pillar',
    width: 8,
    height: 9,
    boxGravity: true,
    sandBoxes: [sb(4, 4, 2, 2, [[B, 2], [R, 2]]), sb(1, 8, 2, 1, [[O, 1], [Y, 1]])],
    walls: wl(...wcol(1, 3, 7), [2, 7], [3, 8]),
    boxes: [bx('2x1', 6, 8, B), bx('2x1', 6, 7, R), bx('1x1', 6, 6, Y), bx('1x1', 7, 6, O)],
    hint: 'Nothing holds a box under the floating sand box. Build a pillar from the small boxes, catch both layers on top of it, then take the pillar down the shaft: yellow first.',
    solution: [
      'box#3 -> (4,8)',
      'box#2 -> (4,7)',
      'box#1 -> (1,2)',
      'box#0 -> (4,6)',
      'box#1 -> (4,6)',
      'box#2 -> (0,0)',
      'box#3 -> (0,0)',
    ],
  },
  //   = = . . # # .
  //   R = . . . . .
  //   O = . . = = .
  //   P P . . . . .
  //   . = . . . . .
  //   . = . . . . .
  //   . . . . . . .
  //   . = . . . . .
  //   . = = = . . .
  //   . # # # = Y .
  // Solution: Orange and red are sealed in a closet over the shaft, held by the purple pin. Feed
  // yellow through the side door to the foot first, then pull the pin and catch purple on its ledge:
  // orange and red drop onto yellow in the right order.
  {
    id: 'pull-the-pin',
    name: 'Pull the Pin',
    width: 7,
    height: 10,
    boxGravity: true,
    sandBoxes: [sb(1, 9, 3, 1, [[R, 1], [O, 1], [Y, 1]]), sb(4, 0, 2, 1, [[P, 2]])],
    walls: wl([0, 0], [1, 0], [1, 1], [1, 2], [1, 4], [1, 5], [1, 7], [1, 8], [2, 8], [3, 8], [4, 9], [4, 2], [5, 2]),
    boxes: [bx('2x1', 0, 3, P), bx('1x1', 0, 2, O), bx('1x1', 0, 1, R), bx('1x1', 5, 9, Y)],
    hint: 'The purple pin holds the closet shut. Once it is pulled, orange and red drop down the shaft in that order, so get the right box under them first.',
    solution: ['box#3 -> (0,6)', 'box#0 -> (4,1)'],
  },
  //   . . . . . # .
  //   . . . . . # .
  //   . . . . . # .
  //   . = . . . . .
  //   . = . . . = .
  //   . = . . . . .
  //   W = . . . . .
  //   G = . . . . .
  //   B = = = . . .
  //   y # # # = O R
  // Solution: The frozen yellow plug thaws after three pops. Unload the shaft top-first (white,
  // green onto the tray walls), catch blue, green, white under the floating column, then drop orange
  // and red onto the thawed plug.
  {
    id: 'cold-stack',
    name: 'Cold Stack',
    width: 7,
    height: 10,
    boxGravity: true,
    sandBoxes: [sb(1, 9, 3, 1, [[R, 1], [O, 1], [Y, 1]]), sb(5, 0, 1, 3, [[B, 1], [G, 1], [W, 1]])],
    walls: wl(...wcol(1, 3, 8), [2, 8], [3, 8], [4, 9], [5, 4]),
    boxes: [
      bx('1x1', 0, 9, Y, 3),
      bx('1x1', 0, 8, B),
      bx('1x1', 0, 7, G),
      bx('1x1', 0, 6, W),
      bx('1x1', 5, 9, O),
      bx('1x1', 6, 9, R),
    ],
    hint: 'The frozen plug thaws after three pops. Unload the shaft from the top, catch the column from below in its order, then stack the rest on the thawed plug.',
    solution: [
      'box#3 -> (3,7)',
      'box#2 -> (2,7)',
      'box#1 -> (5,3)',
      'box#2 -> (5,3)',
      'box#3 -> (5,3)',
      'box#4 -> (0,0) &',
      'box#5 -> (0,0)',
    ],
  },
  //   . . . . . . # #
  //   . . . = . . . .
  //   . . . = . . = =
  //   . . . = . . . .
  //   . . . = . . . .
  //   = = . = . . . .
  //   # # . = . . . .
  //   = = . = . . . .
  //   = = . = . . G .
  //   # # P P O R B .
  // Solution: The purple pin holds the stack up so the box at row 6 sits beside the upper tray.
  // Drop orange, red (supports), then blue and green (upper tray, top band first). Pull the pin out
  // through the door to its ledge: the stack drops and orange then red drain the lower tray.
  {
    id: 'two-stories',
    name: 'Two Stories',
    width: 8,
    height: 10,
    boxGravity: true,
    sandBoxes: [sb(0, 9, 2, 1, [[R, 1], [O, 1]]), sb(0, 6, 2, 1, [[G, 1], [B, 1]]), sb(6, 0, 2, 1, [[P, 2]])],
    walls: wl([0, 5], [1, 5], [0, 7], [1, 7], [0, 8], [1, 8], ...wcol(3, 1, 8), [6, 2], [7, 2]),
    boxes: [bx('2x1', 2, 9, P), bx('1x1', 4, 9, O), bx('1x1', 5, 9, R), bx('1x1', 6, 9, B), bx('1x1', 6, 8, G)],
    hint: 'One shaft, two trays. The pin keeps the stack up so a box sits beside the upper tray; when the upper tray is done, pull the pin and the stack drops onto the lower one.',
    solution: ['box#1 -> (2,0) &', 'box#2 -> (2,0) &', 'box#3 -> (2,0)', 'box#4 -> (2,0)', 'box#0 -> (6,1)'],
  },
  //   . . . . . . # #
  //   . . . . . . . .
  //   . . . . = . . =
  //   . . . . = . . .
  //   . . . . = . . .
  //   = = = . = . . .
  //   = # # . = . . .
  //   = = = . = . . .
  //   = = = R = . . .
  //   = = = Y = . . .
  //   # # # P P Y B g
  // Solution: The shaft holds yellow and red on the purple pin. Park red on the frozen green, drop the
  // second yellow (now touching the first: one container for the two-cell yellow band), red, then
  // blue beside the upper tray; its pop thaws green, which follows. Pull the pin to its ledge: the
  // yellow pair drinks its band, then red.
  {
    id: 'workshop',
    name: 'Workshop',
    width: 8,
    height: 11,
    boxGravity: true,
    sandBoxes: [sb(0, 10, 3, 1, [[R, 1], [Y, 2]]), sb(1, 6, 2, 1, [[G, 1], [B, 1]]), sb(6, 0, 2, 1, [[P, 2]])],
    walls: wl(
      [0, 5], [1, 5], [2, 5], [0, 6],
      ...wrow(7, 0, 2), ...wrow(8, 0, 2), ...wrow(9, 0, 2),
      ...wcol(4, 2, 9),
      [7, 2],
    ),
    boxes: [
      bx('2x1', 3, 10, P),
      bx('1x1', 3, 9, Y),
      bx('1x1', 3, 8, R),
      bx('1x1', 5, 10, Y),
      bx('1x1', 6, 10, B),
      bx('1x1', 7, 10, G, 1),
    ],
    hint: 'Finish the upper tray first, with the stack standing on the pin, then pull the pin. The yellow band is two cells deep: two yellows must touch at the bottom.',
    solution: [
      'box#2 -> (7,9)',
      'box#3 -> (3,0) &',
      'box#2 -> (3,0) &',
      'box#4 -> (3,0)',
      'box#5 -> (3,0)',
      'box#0 -> (6,1)',
    ],
  },
  // ---- Chapter 3: Pusher (hero / Sokoban) ----
  //   . . # # . .
  //   . . # # . .
  //   . . . . . .
  //   . . . . . .
  //   . . B B . .
  //   . . @ . . .
  //   . . . R R .
  //   . . . . . .
  // Solution: Push the blue bar up under the sand box (blue is the bottom layer), then walk round
  // and push the red bar left and up into the same spot.
  {
    id: 'first-push',
    name: 'First Push',
    width: 6,
    height: 8,
    hero: { x: 2, y: 5 },
    sandBoxes: [sb(2, 0, 2, 2, [[B, 2], [R, 2]])],
    boxes: [bx('2x1', 2, 4, B), bx('2x1', 3, 6, R)],
    hint: 'Walk into a box to push it. Push the blue up under the sand box first: from below only the bottom layer falls in.',
    solution: ['UU', 'RRRDDDL', 'DLLUUUU'],
  },
  //   . . . . = = .
  //   . . . . = . .
  //   . . # # . Y .
  //   . . # # . Y .
  //   . . . . . . .
  //   . . G G . = =
  //   . . . . . . .
  //   @ . . . . . .
  // Solution: Walk round to the right of the yellow 1x2 and push it against the sand box at the yellow
  // (top) layer; then get under the green bar and push it up to catch the green from below.
  {
    id: 'far-side',
    name: 'Far Side',
    width: 7,
    height: 8,
    hero: { x: 0, y: 7 },
    sandBoxes: [sb(2, 2, 2, 2, [[G, 2], [Y, 2]])],
    walls: wl([4, 0], [4, 1], [5, 0], [5, 5], [6, 5]),
    boxes: [bx('1x2', 5, 2, Y), bx('2x1', 2, 5, G)],
    hint: 'A box moves away from you, so stand on its far side. Push the yellow against the sand box at the yellow layer, then the green up from below.',
    solution: ['UUURRRRRRUL', 'DLDDLU'],
  },
  //   # # . = . # #
  //   # # . = . # #
  //   . . . . . . .
  //   . . . . . . .
  //   . . . . . . .
  //   . B B . R R .
  //   . B . . . R .
  //   . B . . . R .
  //   . . . @ . . .
  // Solution: The two hooks start on the wrong sides. Push the blue J up and over to the right sand box,
  // then the red L to the left one; each catches with its 2-wide bar.
  {
    id: 'odd-shapes',
    name: 'Odd Shapes',
    width: 7,
    height: 9,
    hero: { x: 3, y: 8 },
    sandBoxes: [sb(0, 0, 2, 2, [[R, 4]]), sb(5, 0, 2, 2, [[B, 4]])],
    walls: wl([3, 0], [3, 1]),
    boxes: [bx('L180', 4, 5, R), bx('J180', 1, 5, B)],
    hint: 'A shape moves as a whole, and you can push it from any of its cells. Swap the two hooks: each one catches under its own color with its bar.',
    solution: ['LLUUULURRRR', 'RRDDDLLLLDLUUU'],
  },
  //   = = = = = . # #
  //   = . . . . . # #
  //   . . = = . . . .
  //   . R R . B . . .
  //   = . . . B . . =
  //   . . . . = . . =
  //   . @ . = . = . .
  //   . . . = . . . .
  // Solution: Route the blue 1x2 round the walls to the right column and up beside the blue layer,
  // then bring the red bar under the sand box. Pushing either into a corner early is fatal.
  {
    id: 'dead-ends',
    name: 'Dead Ends',
    width: 8,
    height: 8,
    hero: { x: 1, y: 6 },
    sandBoxes: [sb(6, 0, 2, 2, [[R, 2], [B, 2]])],
    walls: wl([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [2, 2], [3, 2], [4, 5], [5, 6], [0, 4], [3, 6], [3, 7], [7, 4], [7, 5]),
    boxes: [bx('1x2', 4, 3, B), bx('2x1', 1, 3, R)],
    hint: 'A box pushed into a corner or against a wall can never come back out. Plan the route before you push: blue goes beside the blue layer, red goes underneath.',
    solution: ['UURRURURRDDDLUUU', 'ULLLLDLDRRRRRDRU'],
  },
  //   # # . = # # #
  //   # # . = . . .
  //   . . . = . . .
  //   . . . = B B .
  //   R R . w . . .
  //   . . . = . . .
  //   . @ . = . . .
  //   . . . = . . .
  // Solution: Push the red up under its sand box; the pop thaws the white plug in the doorway. Push
  // it through into the right room, push the blue up under the blue, then the white up under the white.
  {
    id: 'cold-wall',
    name: 'Cold Wall',
    width: 7,
    height: 8,
    hero: { x: 1, y: 6 },
    sandBoxes: [sb(0, 0, 2, 2, [[R, 2]]), sb(4, 0, 2, 1, [[B, 2]]), sb(6, 0, 1, 1, [[W, 1]])],
    walls: wl(...wcol(3, 0, 3), ...wcol(3, 5, 7)),
    boxes: [bx('2x1', 0, 4, R), bx('1x1', 3, 4, W, 1), bx('2x1', 4, 3, B)],
    hint: 'The frozen box is a wall until something pops. Then it is just a box in the doorway: push it through, and mind where it ends up.',
    solution: ['UUU', 'DRRRUU', 'DDRDRUUU'],
  },
  //   = # # . . # # =
  //   . # # . . # # .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . R R . . B B .
  //   . R R . . B B .
  //   = . . = = . . =
  //   . . . @ . . . .
  // Solution: The red 2x2 catches red under the left box, then drinks the right box's red top from the
  // middle gap; the blue 2x2 then stands in the gap and drinks blue from both boxes at once.
  {
    id: 'shared-colors',
    name: 'Shared Colors',
    width: 8,
    height: 8,
    hero: { x: 3, y: 7 },
    sandBoxes: [sb(1, 0, 2, 2, [[R, 2], [B, 2]]), sb(5, 0, 2, 2, [[B, 2], [R, 2]])],
    walls: wl([0, 0], [7, 0], [0, 6], [7, 6], [3, 6], [4, 6]),
    boxes: [bx('2x2', 1, 4, R), bx('2x2', 5, 4, B)],
    hint: 'Each big box needs half its color from each sand box. A box keeps what it has caught, and a box standing between two sand boxes drinks from both.',
    solution: ['LUUU', 'LLURRDRUU', 'DRRRRDDLDLUURULDLUU'],
  },
  //   . . . # # . . .
  //   . . . # # = = .
  //   . . . # # # # =
  //   . . . . . . . .
  //   . . . . = = = .
  //   . G G . . G . .
  //   . . . . . G . .
  //   . B B . . G . .
  //   @ . . . . . . .
  // Solution: Hang the 1x3 under the sand box's left column, bring the green bar up the left side and
  // push it in on top: the pair is one container and the 1x3 below fills first. Push the full 1x3
  // away from its far side (it pops alone), the bar into the slot, and the blue under the blue.
  {
    id: 'join-and-split',
    name: 'Join and Split',
    width: 8,
    height: 9,
    hero: { x: 0, y: 8 },
    sandBoxes: [sb(3, 0, 2, 3, [[G, 3.25], [B, 2]]), sb(5, 2, 2, 1, [[G, 1.75]])],
    walls: wl([5, 1], [6, 1], [7, 2], [4, 4], [5, 4], [6, 4]),
    boxes: [bx('2x1', 1, 5, G), bx('1x3', 5, 5, G), bx('2x1', 1, 7, B)],
    hint: 'Touching boxes of one color are one container and pop only when the whole group is full. Join them under the sand box, then push the full one away from the far side.',
    solution: ['RRRRRRULLDLU', 'DLLLUURUULU', 'RR', 'DDDLLDDRRRURUL', 'UULURR', 'LDDDDDLUUUULLU', 'RR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . Y . . .
  //   . . . = = = . .
  //   @ # w = = = . #
  // Solution: Walk right: climb the tray and the frozen white, climb the ledge, push the yellow off
  // onto its tray. The pop thaws the white, which drains its tray where it stands.
  {
    id: 'step-up',
    name: 'Step Up',
    width: 8,
    height: 8,
    hero: { x: 0, y: 7 },
    boxGravity: true,
    sandBoxes: [sb(1, 7, 1, 1, [[W, 1]]), sb(7, 7, 1, 1, [[Y, 1]])],
    walls: wl(...wrow(6, 3, 5), ...wrow(7, 3, 5)),
    boxes: [bx('1x1', 2, 7, W, 1), bx('1x1', 4, 5, Y)],
    hint: 'Now you fall, and you climb one step at a time: walk into anything one cell high. Push the yellow off the ledge onto its sand.',
    solution: ['RRRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . R . . .
  //   . . . . O . . .
  //   . . . . Y . . @
  //   . . . . = = = =
  //   = = = . = = = =
  //   # # # . = = = =
  // Solution: Push the tower's bottom box into the shaft, step back so the tower drops (you hold up
  // whatever is above you), push again: yellow, orange, red land on the tray in band order.
  {
    id: 'topple',
    name: 'Topple',
    width: 8,
    height: 8,
    hero: { x: 7, y: 4 },
    boxGravity: true,
    sandBoxes: [sb(0, 7, 3, 1, [[R, 1], [O, 1], [Y, 1]])],
    walls: wl(...wrow(5, 4, 7), ...wrow(6, 4, 7), ...wrow(7, 4, 7), [0, 6], [1, 6], [2, 6]),
    boxes: [bx('1x1', 4, 4, Y), bx('1x1', 4, 3, O), bx('1x1', 4, 2, R)],
    hint: 'Push the bottom of the tower off the ledge: it drops down the shaft. Whatever is above you stays up while you stand under it, so step back to let the tower drop.',
    solution: ['LLL', 'R', 'L', 'R', 'L'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . R . . #
  //   . . = . O @ W .
  //   . . = . = = = =
  //   . . = . = = = =
  //   = = = . = = = =
  //   # # # y = = = =
  // Solution: Topple orange and red into the shaft onto the frozen yellow plug, then push the white
  // under its sand box: its pop thaws the plug and the shaft drains yellow, orange, red.
  {
    id: 'cold-trigger',
    name: 'Cold Trigger',
    width: 8,
    height: 10,
    hero: { x: 5, y: 5 },
    boxGravity: true,
    sandBoxes: [sb(0, 9, 3, 1, [[R, 1], [O, 1], [Y, 1]]), sb(7, 4, 1, 1, [[W, 1]])],
    walls: wl(...wrow(8, 0, 2), ...wcol(2, 5, 7), ...wrow(6, 4, 7), ...wrow(7, 4, 7), ...wrow(8, 4, 7), ...wrow(9, 4, 7)),
    boxes: [bx('1x1', 3, 9, Y, 1), bx('1x1', 4, 5, O), bx('1x1', 4, 4, R), bx('1x1', 6, 5, W)],
    hint: 'The frozen plug holds the shaft shut until something pops. Load the shaft while it is cold, then pull the trigger.',
    solution: ['L', 'R', 'L', 'R', 'R'],
  },
  //   . . . . . . . .
  //   . . . = . . . .
  //   . . = R = . . .
  //   # . = O = . . .
  //   # . P P . . . .
  //   = = = . = . . .
  //   . . = . = = . .
  //   = = = . = . = @
  //   # # # y . . . =
  // Solution: Climb the stairs and push the pin left from its right side onto its purple sand. You
  // ride the closet down onto the frozen yellow (thawed by the pin's pop) and hold the stack up;
  // step out of the door and orange, red drop onto the tray.
  {
    id: 'push-the-pin',
    name: 'Push the Pin',
    width: 8,
    height: 9,
    hero: { x: 7, y: 7 },
    boxGravity: true,
    sandBoxes: [sb(0, 8, 3, 1, [[R, 1], [O, 1], [Y, 1]]), sb(0, 3, 1, 2, [[P, 2]])],
    walls: wl(
      [3, 1], [2, 2], [2, 3], [4, 2], [4, 3],
      ...wcol(2, 5, 7), [0, 7], [1, 7], [0, 5], [1, 5],
      ...wcol(4, 5, 7), [5, 6], [6, 7], [7, 8],
    ),
    boxes: [bx('2x1', 2, 4, P), bx('1x1', 3, 3, O), bx('1x1', 3, 2, R), bx('1x1', 3, 8, Y, 1)],
    hint: 'Climb up and push the pin from its right side. You drop down the shaft with the closet on your head: you hold it up until you step out through the door.',
    solution: ['LLLL', 'R'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . = . B . . . .
  //   . = . G . . . .
  //   . = . R . @ . .
  //   = = . = = = = =
  //   # # . = = = = =
  //   = = . = = = = =
  //   # # y = = = = =
  // Solution: Topple red, green, blue onto the frozen plug. Green and blue drain the upper tray in
  // turn, their two pops thaw the plug, which drains yellow, and red drops onto the lower tray.
  {
    id: 'chain-reaction',
    name: 'Chain Reaction',
    width: 8,
    height: 10,
    hero: { x: 5, y: 5 },
    boxGravity: true,
    sandBoxes: [sb(0, 9, 2, 1, [[R, 1], [Y, 1]]), sb(0, 7, 2, 1, [[B, 1], [G, 1]])],
    walls: wl(...wrow(8, 0, 1), ...wrow(6, 0, 1), ...wcol(1, 3, 5), ...wrow(6, 3, 7), ...wrow(7, 3, 7), ...wrow(8, 3, 7), ...wrow(9, 3, 7)),
    boxes: [bx('1x1', 2, 9, Y, 2), bx('1x1', 3, 5, R), bx('1x1', 3, 4, G), bx('1x1', 3, 3, B)],
    hint: 'One shaft, two trays, and a frozen plug at the bottom. Load the shaft in the right order and it runs itself: every pop drops the stack a step.',
    solution: ['LL', 'R', 'L', 'R', 'L'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . Y .
  //   . . . . . # = .
  //   . . . . w # = .
  //   . @ K . w # # .
  // Solution: Push the pink step against the frozen white and climb onto the ledge; push the yellow
  // off the right end and come straight back down onto the pink. The pop thaws the white, which drains
  // and leaves; push the pink into its spot to drain the bottom band.
  {
    id: 'wrong-side',
    name: 'Wrong Side',
    width: 8,
    height: 10,
    hero: { x: 1, y: 9 },
    boxGravity: true,
    sandBoxes: [sb(5, 7, 1, 3, [[K, 1], [W, 2]]), sb(6, 9, 1, 1, [[Y, 1]])],
    walls: wl([6, 7], [6, 8]),
    boxes: [bx('1x1', 2, 9, K), bx('1x2', 4, 8, W, 1), bx('1x1', 6, 6, Y)],
    hint: 'Push the pink step against the frozen box and climb. When the yellow pops the white thaws and melts away, so come back down on the pink side first: from the other side the step can only be pushed the wrong way.',
    solution: ['RRRRRLLLL', 'R'],
  },
  //   . . . = . . . .
  //   . . . B = . . .
  //   . = = G = . . .
  //   # = = R = . . .
  //   # . P P . . . .
  //   = = = . = . . .
  //   = = = . = = . .
  //   = = = . = . = @
  //   = # # . = . . =
  //   = = = . . . . .
  //   = # # y = . . .
  // Solution: Climb, push the pin left onto its sand and ride red, green, blue down onto the frozen
  // plug. Step out of the door: green and blue drain the upper tray, the pin and those pops thaw the
  // plug, yellow then red drain the lower tray.
  {
    id: 'pusher',
    name: 'Pusher',
    width: 8,
    height: 11,
    hero: { x: 7, y: 7 },
    boxGravity: true,
    sandBoxes: [
      sb(0, 3, 1, 2, [[P, 2]]),
      sb(1, 10, 2, 1, [[R, 1], [Y, 1]]),
      sb(1, 8, 2, 1, [[B, 1], [G, 1]]),
    ],
    walls: wl(
      [3, 0], [1, 2], [2, 2], [1, 3], [2, 3], [4, 1], [4, 2], [4, 3],
      ...wcol(0, 5, 10), [1, 5], [2, 5], [1, 6], [2, 6], [1, 7], [2, 7], [1, 9], [2, 9],
      ...wcol(4, 5, 8), [4, 10], [5, 6], [6, 7], [7, 8],
    ),
    boxes: [bx('2x1', 2, 4, P), bx('1x1', 3, 3, R), bx('1x1', 3, 2, G), bx('1x1', 3, 1, B), bx('1x1', 3, 10, Y, 3)],
    hint: 'Push the pin from its right side and ride the closet down onto the frozen plug. You are the spacer: step out of the door when the stack should drop.',
    solution: ['LLLL', 'RR'],
  },
];

export function getLevel(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function getLevelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
