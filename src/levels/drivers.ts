// Driven-box hero levels ("Pusher II" tail): a box with a built-in force (BoxDef.force) pushes the
// train in front of it whenever it can (DESIGN.md "Driven boxes"). Exported as DRIVERS for index.ts
// to splice at the end of Chapter 4. Map legend as in index.ts: # sand box, capital letter = box,
// lower-case = frozen box, = wall, @ hero, . empty; an arrow after a box letter in the notes gives its
// force. Every level starts with each train pressing against something (nothing moves and nothing
// drains until the hero acts), and waiting is always safe: no solution races a drain (the physics
// test replays every hero solution at a slow walking pace).
import type { BoxDef, ColorId, Dir, LayerDef, LevelDef, SandBoxDef, ShapeName } from '../core/types';

const R = 1; // red
const O = 2; // orange
const Y = 3; // yellow
const G = 4; // green
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

/** Box helper; `force` makes it a driven box, `frozen` a frozen one. */
const bx = (shape: ShapeName, x: number, y: number, color: ColorId, force?: Dir, frozen?: number): BoxDef => ({
  shape,
  x,
  y,
  color,
  ...(force ? { force } : {}),
  ...(frozen ? { frozen } : {}),
});

/** Wall cells from [x, y] pairs. */
const wl = (...cells: [number, number][]) => cells.map(([x, y]) => ({ x, y }));
/** A horizontal run of wall cells at row y, columns x0..x1 (inclusive). */
const wrow = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i): [number, number] => [x0 + i, y]);
/** A vertical run of wall cells at column x, rows y0..y1 (inclusive). */
const wcol = (x: number, y0: number, y1: number): [number, number][] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i): [number, number] => [x, y0 + i]);

export const DRIVERS: LevelDef[] = [
  //   . . . . . . . .
  //   . . . . # . . .
  //   . = . = . = = =
  //   . R O Y W # # #
  //   . = . = . = = =
  //   . . . . . . . .
  //   . . . . @ . . .
  // force: R at (1,3) right
  // Solution: The red engine pushes orange and yellow at the white plug. The station drinks yellow,
  // red, orange: pull the orange up into the siding (the train closes up behind it), push the white
  // up under its sand, and let yellow and red in; then push the orange in by hand.
  {
    id: 'pusher-station',
    name: 'Pusher Station',
    width: 8,
    height: 7,
    hero: { x: 4, y: 6 },
    sandBoxes: [sb(5, 3, 3, 1, [[O, 1], [R, 1], [Y, 1]]), sb(4, 1, 1, 1, [[W, 1]])],
    walls: wl(...wrow(2, 1, 7).filter(([x]) => x !== 2 && x !== 4), ...wrow(4, 1, 7).filter(([x]) => x !== 2 && x !== 4)),
    boxes: [bx('1x1', 1, 3, R, 'right'), bx('1x1', 2, 3, O), bx('1x1', 3, 3, Y), bx('1x1', 4, 3, W)],
    hint: 'The red engine pushes its train into the station as soon as the white plug is gone. The station takes yellow, then red, then orange: pull the orange out of the train first.',
    solution: ['ULLUUD', 'DRRUUD', 'ULLLLUURRDULLDDRRR'],
  },
  //   . . . . . . . .
  //   . . . # . @ . .
  //   = = = . = = = R
  //   B Y . G # # # .
  //   = = = . = = = .
  //   . . . . . . . .
  //   . . . . . . . .
  // force: B at (0,3) right
  // Solution: The green blocker holds the blue engine at the station mouth. Push the red down to the
  // station's far end first (top band red); once it pops, go round below the green and push it up
  // under its sand: yellow and blue roll in. The green can't be reached before the red is in.
  {
    id: 'blocked-driver',
    name: 'Blocked Driver',
    width: 8,
    height: 7,
    hero: { x: 5, y: 1 },
    sandBoxes: [sb(4, 3, 3, 1, [[B, 1], [Y, 1], [R, 1]]), sb(3, 1, 1, 1, [[G, 1]])],
    walls: wl(...wrow(2, 0, 6).filter(([x]) => x !== 3), ...wrow(4, 0, 6).filter(([x]) => x !== 3)),
    boxes: [bx('1x1', 0, 3, B, 'right'), bx('1x1', 1, 3, Y), bx('1x1', 3, 3, G), bx('1x1', 7, 2, R)],
    hint: 'The green blocker holds the blue engine back, and it can wait there forever. The station drinks red first, from its far end: let the train in only after that.',
    solution: ['RRD', 'DDDLLLLUU', 'D'],
  },
  //   . . . = . = . .
  //   . . . = O = . .
  //   = = = = . = . .
  //   B Y R . @ . # #
  //   = = = = . . . .
  //   . . . = . # # .
  //   . . . . = . . .
  // force: B at (0,3) right
  // force: O at (4,1) down
  // Solution: You stand in the crossing, holding both engines. Step right: the red car rolls into the
  // crossing and stops against you, and the orange engine pushes it down to its station. Step down
  // and the yellow, then the blue, reach the right-hand station. Stepping down first jams the red.
  {
    id: 'crossfire',
    name: 'Crossfire',
    width: 8,
    height: 7,
    hero: { x: 4, y: 3 },
    sandBoxes: [sb(6, 3, 2, 1, [[B, 1], [Y, 1]]), sb(5, 5, 2, 1, [[O, 1], [R, 1]])],
    walls: wl(...wrow(2, 0, 3), ...wrow(4, 0, 3), [3, 0], [3, 1], [5, 0], [5, 1], [5, 2], [3, 5], [4, 6]),
    boxes: [bx('1x1', 0, 3, B, 'right'), bx('1x1', 1, 3, Y), bx('1x1', 2, 3, R), bx('1x1', 4, 1, O, 'down')],
    hint: 'Standing in the crossing you hold back both engines. A box in the crossing belongs to whichever engine pushes it next: let the red into the crossing, but not past it.',
    solution: ['R', 'D'],
  },
  //   . . . # . . . .
  //   . . . # . . . .
  //   . . . # . . . .
  //   . . = . = . . .
  //   . . = . = . . .
  //   . . = . = . . .
  //   . . = . = . . .
  //   . . = . = . . .
  //   . . = . . O @ .
  //   . . = R = # = .
  //   . . = b = . W .
  // force: B at (3,10) up
  // Solution: The frozen blue lift will push its stack up into the column, top box first. Load the
  // orange on top of the red, then drop down and push the white under its sand: the pop thaws the
  // lift and orange, red, blue go up in turn. Popping the white first jams the column.
  {
    id: 'lift',
    name: 'Lift',
    width: 8,
    height: 11,
    hero: { x: 6, y: 8 },
    boxGravity: true,
    sandBoxes: [sb(3, 0, 1, 3, [[O, 1], [R, 1], [B, 1]]), sb(5, 9, 1, 1, [[W, 1]])],
    walls: wl(...wcol(2, 3, 10), ...wcol(4, 3, 7), [4, 9], [4, 10], [6, 9]),
    boxes: [bx('1x1', 3, 10, B, 'up', 1), bx('1x1', 3, 9, R), bx('1x1', 5, 8, O), bx('1x1', 6, 10, W)],
    hint: 'The frozen blue lift will push everything above it up into the sand, top box first, once something pops. Load the orange first, then go down and pop the white.',
    solution: ['LL', 'RRRL'],
  },
  //   . . . = = . . .
  //   # . . . = . . .
  //   = . . . = . . .
  //   . B Y R . # # =
  //   = = = . = = = =
  //   . . . . . . . .
  //   . . . @ . . . .
  // force: B at (1,3) right
  // force: R at (3,3) left
  // Solution: The two engines push against each other. Walk up and kick the red one: it slides up to
  // row 1, where its engine drives it to its sand; the blue engine then pushes the yellow home. A plain
  // push stops it on row 2 (a second push recovers it, the kick does it in one).
  {
    id: 'stalemate',
    name: 'Stalemate',
    width: 8,
    height: 7,
    hero: { x: 3, y: 6 },
    sandBoxes: [sb(5, 3, 2, 1, [[B, 1], [Y, 1]]), sb(0, 1, 1, 1, [[R, 1]])],
    walls: wl([3, 0], [4, 0], [4, 1], [4, 2], [0, 2], ...wrow(4, 0, 2), ...wrow(4, 4, 7), [7, 3]),
    boxes: [bx('1x1', 1, 3, B, 'right'), bx('1x1', 2, 3, Y), bx('1x1', 3, 3, R, 'left')],
    hint: 'Two engines pushing against each other never move. Kick one out sideways (hold the direction, or Shift): a kicked box slides until it hits something, and then its engine takes over from there.',
    solution: ['UUKU'],
  },
  //   . # . . . . . .
  //   . # . . . . . .
  //   . # . . . . . .
  //   = . = . . . . .
  //   = . = . . . . .
  //   = . = . . . . .
  //   = . = . . . . .
  //   = . # . . . . .
  //   # . . w O K . .
  //   . P @ = = = = =
  //   = b = = = = = =
  // force: B at (1,10) up
  // force: P at (1,9) down
  // force: K at (5,8) left
  // Solution: Kick the purple engine left out of the shaft, under its own sand. Its pop thaws the
  // white plug, the pink engine delivers white and orange into the shaft and parks under its sand, and
  // that pop thaws the lift: orange, white, blue go up into the column. Pushing instead drops you
  // into the shaft.
  {
    id: 'drivers-finale',
    name: "Driver's Finale",
    width: 8,
    height: 11,
    hero: { x: 2, y: 9 },
    boxGravity: true,
    sandBoxes: [sb(1, 0, 1, 3, [[O, 1], [W, 1], [B, 1]]), sb(2, 7, 1, 1, [[K, 1]]), sb(0, 8, 1, 1, [[P, 1]])],
    walls: wl(...wcol(0, 3, 7), [0, 10], ...wcol(2, 3, 6), [2, 10], ...wrow(9, 3, 7), ...wrow(10, 3, 7)),
    boxes: [
      bx('1x1', 1, 10, B, 'up', 2),
      bx('1x1', 1, 9, P, 'down'),
      bx('1x1', 3, 8, W, undefined, 1),
      bx('1x1', 4, 8, O),
      bx('1x1', 5, 8, K, 'left'),
    ],
    hint: 'The purple engine pins the frozen lift down. Kick it out sideways under its own sand: from then on every pop sets off the next engine.',
    solution: ['KL'],
  },
];
