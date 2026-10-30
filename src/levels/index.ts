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
// Map legend in the level comments: # sand box, capital letter = box (R red, O orange, Y yellow,
// G green, T teal, B blue, P purple, K pink, W white), lower-case = frozen box, ^ v < > = empty belt
// cell running in that direction, = wall, . empty.

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
];

export function getLevel(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function getLevelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
