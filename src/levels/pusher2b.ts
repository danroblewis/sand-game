// Chapter 4 "Pusher II", part B: hero (Sokoban) levels. Owned by one designer agent;
// appended into LEVELS by index.ts. Keep ids unique across the whole campaign.
//
// Part B: fifteen GRAVITY hero levels (hero + boxGravity): the hero falls, climbs one cell, and
// holds up whatever rests on him; boxes fall. One idea each, rising in difficulty, ending with a
// finale that combines several. Map legend as in index.ts: # sand box, capital letter = box,
// lower-case = frozen box, = wall, @ hero, . empty. Every solution is proven by
// tests/levels-physics.test.ts (three seeds, plus a slow walk so no entry races the sand).
import type { BoxDef, ColorId, LayerDef, LevelDef, SandBoxDef, ShapeName } from '../core/types';

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
/** A vertical run of wall cells at column x, rows y0..y1 (inclusive). */
const wcol = (x: number, y0: number, y1: number): [number, number][] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i): [number, number] => [x, y0 + i]);
/** A horizontal run of wall cells at row y, columns x0..x1 (inclusive). */
const wrow = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i): [number, number] => [x0 + i, y]);

export const PUSHER2B: LevelDef[] = [
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . #
  //   . . . . . . Y .
  //   . . R . r # # =
  //   . . R . r # # =
  //   . @ R . r # # =
  // Solution: Push the red bar against the frozen red face. The small red falls on your head; step
  // back and it lands behind the bar: two steps. Climb, cross the sand box and push the yellow
  // under its sand. Its pop thaws the face, which now touches both red steps: one container,
  // drained through the face.
  {
    id: 'stairs',
    name: 'Stairs',
    width: 8,
    height: 9,
    hero: { x: 1, y: 8 },
    boxGravity: true,
    sandBoxes: [sb(5, 6, 2, 3, [[R, 6]]), sb(7, 4, 1, 1, [[Y, 1]])],
    walls: wl(...wcol(7, 6, 8)),
    boxes: [bx('1x3', 4, 6, R, 1), bx('1x2', 2, 7, R), bx('1x1', 2, 6, R), bx('1x1', 6, 5, Y)],
    hint: 'Build stairs: push the bar to the ice, let the small box drop behind you, and climb. Push the yellow under its sand: the ice melts and joins the red steps, and they drink together.',
    solution: ['RL', 'RRRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . G . . . .
  //   . . . R @ . . .
  //   . = = = = = = .
  //   . # = = = = # .
  // Solution: Push red left. You stand under green and hold it up; push again and green drops
  // behind you, on your right. Red goes into the left pit, then green into the right one.
  {
    id: 'hold-the-door',
    name: 'Hold the Door',
    width: 8,
    height: 10,
    hero: { x: 4, y: 7 },
    boxGravity: true,
    sandBoxes: [sb(1, 9, 1, 1, [[R, 1]]), sb(6, 9, 1, 1, [[G, 1]])],
    walls: wl(...wrow(8, 1, 6), ...wrow(9, 2, 5)),
    boxes: [bx('1x1', 3, 7, R), bx('1x1', 3, 6, G)],
    hint: 'Green rests on red. Push red out and you hold green up; push again and it drops behind you, on the side you need. Red goes left, green goes right.',
    solution: ['LLL', 'RRRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . O . . . . . .
  //   . Y . . . . . .
  //   . R w # . . @ .
  //   . = = = = = = =
  //   . = = = = = = =
  //   . = = = = = = =
  //   . # # # = = = =
  // Solution: The tray wants yellow (the middle box) first, then orange, then red. Climb the white
  // sand box onto the ice and push yellow off; orange rests on you, step back and push it off too.
  // The two pops thaw the ice, which drains away; drop down and push red.
  {
    id: 'drop-shaft',
    name: 'Drop Shaft',
    width: 8,
    height: 10,
    hero: { x: 6, y: 5 },
    boxGravity: true,
    sandBoxes: [sb(1, 9, 3, 1, [[R, 1], [O, 1], [Y, 1]]), sb(3, 5, 1, 1, [[W, 1]])],
    walls: wl(...wrow(6, 1, 7), ...wrow(7, 1, 7), ...wrow(8, 1, 7), ...wrow(9, 4, 7)),
    boxes: [bx('1x1', 1, 5, R), bx('1x1', 1, 4, Y), bx('1x1', 1, 3, O), bx('1x1', 2, 5, W, 2)],
    hint: 'Top band first: that is the middle box. Stand on the ice to reach it. The ice melts after two pops and lets you reach the bottom box.',
    solution: ['LLLLL', 'RL', 'RL'],
  },
  //   . . . . . . . .
  //   . . = O = . . .
  //   # . = R = . . .
  //   # . P P @ = . .
  //   . = = . = . . .
  //   # . = . . . . .
  //   # . K K . . . .
  //   . = = . = . . .
  //   . . = . = . . .
  //   . . = . . . . .
  //   # # # y . B . #
  // Solution: Push the purple pin off from its right side and fall down the shaft with the closet
  // on your head onto the pink pin. Step out of the middle door, push the pink pin from its right
  // side and ride down again onto the frozen yellow. Step out of the bottom door and push blue to
  // its sand: three pops thaw the plug and the closet drains red, orange.
  {
    id: 'elevator-down',
    name: 'Elevator Down',
    width: 8,
    height: 11,
    hero: { x: 4, y: 3 },
    boxGravity: true,
    sandBoxes: [sb(0, 2, 1, 2, [[P, 2]]), sb(0, 5, 1, 2, [[K, 2]]), sb(0, 10, 3, 1, [[O, 1], [R, 1], [Y, 1]]), sb(7, 10, 1, 1, [[B, 1]])],
    walls: wl([2, 1], [4, 1], [2, 2], [4, 2], [5, 3], [1, 4], [2, 4], [4, 4], [2, 5], [1, 7], [2, 7], [4, 7], [2, 8], [4, 8], [2, 9]),
    boxes: [bx('2x1', 2, 3, P), bx('1x1', 3, 2, R), bx('1x1', 3, 1, O), bx('2x1', 2, 6, K), bx('1x1', 3, 10, Y, 3), bx('1x1', 5, 10, B)],
    hint: 'Two floors down: push each pin from its right side and ride the closet down. Step out of the door each time, then finish the blue at the bottom to melt the plug.',
    solution: ['L', 'RL', 'RR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . = # . . .
  //   . . . = . G @ .
  //   . . . = = = = .
  //   . . . = . . . .
  //   . . . = Y . . .
  //   . . . . O . . .
  //   = = = . = = = =
  //   = # # b = = = =
  //   = # # w = = = =
  // Solution: Catch the green first: once you jump down you cannot get back up. Its pop thaws the
  // blue plug (count 1), which drains its band and leaves; then topple orange and yellow into the
  // shaft. Orange lands on the white plug beside its band; its pop is the third, the white plug
  // thaws and drains, and yellow drops to the bottom tray. Every box that passes an emptied tray
  // takes nothing, so dropping early or late lands the same way.
  {
    id: 'plug-chain',
    name: 'Plug Chain',
    width: 8,
    height: 11,
    hero: { x: 6, y: 3 },
    boxGravity: true,
    sandBoxes: [sb(4, 2, 1, 1, [[G, 1]]), sb(1, 9, 2, 1, [[O, 1], [B, 1]]), sb(1, 10, 2, 1, [[Y, 1], [W, 1]])],
    walls: wl(...wcol(3, 2, 6), ...wrow(4, 4, 6), ...wrow(8, 0, 2), [0, 9], [0, 10], ...wrow(8, 4, 7), ...wrow(9, 4, 7), ...wrow(10, 4, 7)),
    boxes: [bx('1x1', 5, 3, G), bx('1x1', 4, 7, O), bx('1x1', 4, 6, Y), bx('1x1', 3, 9, B, 1), bx('1x1', 3, 10, W, 3)],
    hint: 'Two frozen plugs: the blue one opens after one pop, the white one after three. Catch the green up top before you jump down, then topple the tower into the shaft.',
    solution: ['L', 'RR', 'LLL', 'R', 'L'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . Y . . . .
  //   . . . O . . . .
  //   . . . R . . . .
  //   @ . . B . . # .
  //   # # # B . . # .
  // Solution: Stand on the tray and push the blue base: it slides, you drop into its spot and hold
  // the tower up. Push the base again: you step out from under, the tower drops beside the tray and
  // drains red, orange, yellow; blue lands by its own sand.
  {
    id: 'undercut',
    name: 'Undercut',
    width: 8,
    height: 9,
    hero: { x: 0, y: 7 },
    boxGravity: true,
    sandBoxes: [sb(0, 8, 3, 1, [[Y, 1], [O, 1], [R, 1]]), sb(6, 7, 1, 2, [[B, 2]])],
    walls: wl(),
    boxes: [bx('1x2', 3, 7, B), bx('1x1', 3, 6, R), bx('1x1', 3, 5, O), bx('1x1', 3, 4, Y)],
    hint: 'Push the base out from under the tower while standing on the tray. Push it once more to step out, and the tower drops onto the tray.',
    solution: ['RRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . #
  //   . . . . . . Y .
  //   @ G G G . = = =
  //   = # w . . # # #
  //   = = = . . = = =
  //   = = = . . = = =
  // Solution: Push the bar across the gap until the wall stops it: it rests on the frozen white.
  // Climb on and walk across, push yellow under its sand. The pop thaws the white, which drains;
  // the bar loses its support, drops one cell and drinks the green from its end.
  {
    id: 'bridge',
    name: 'Bridge',
    width: 8,
    height: 9,
    hero: { x: 0, y: 5 },
    boxGravity: true,
    sandBoxes: [sb(1, 6, 1, 1, [[W, 1]]), sb(5, 6, 3, 1, [[G, 3]]), sb(7, 3, 1, 1, [[Y, 1]])],
    walls: wl(...wcol(0, 6, 8), [1, 7], [1, 8], [2, 7], [2, 8], [5, 5], [6, 5], [7, 5], ...wrow(7, 5, 7), ...wrow(8, 5, 7)),
    boxes: [bx('3x1', 1, 5, G), bx('1x1', 2, 6, W, 1), bx('1x1', 6, 4, Y)],
    hint: 'The bar is a bridge: push it across until it stops, climb it and walk over. What holds it up is ice; when it melts the bridge drops onto its sand.',
    solution: ['RRRRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . R . . .
  //   . . = = = # . .
  //   . . . . . . = @
  //   = = = = = = = =
  // Solution: Climb up and push red off the far end of the overhang. Jump after it: you land on it,
  // step off the left side, and push it under the overhang until it sits right under the red sand.
  {
    id: 'overhang',
    name: 'Overhang',
    width: 8,
    height: 9,
    hero: { x: 7, y: 7 },
    boxGravity: true,
    sandBoxes: [sb(5, 6, 1, 1, [[R, 1]])],
    walls: wl(...wrow(6, 2, 4), [6, 7], ...wrow(8, 0, 7)),
    boxes: [bx('1x1', 4, 5, R)],
    hint: 'Push the red off the far end, then follow it down and go round it. Its sand is in the underside of the overhang: push it right under.',
    solution: ['LLLLL', 'LL', 'RRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . @ . . . . .
  //   . . G . . . . .
  //   . . O . . . . .
  //   . . B . . . . .
  //   . . R . . . . .
  //   . = = = = = = .
  //   . # # = = # # .
  // Solution: Each time you push the bottom box out you end up under the tower; the side you step
  // out to decides where the next box lands. Red left, blue right, orange left, green right: each
  // pit gets its boxes in band order only if you alternate.
  {
    id: 'double-pit',
    name: 'Double Pit',
    width: 8,
    height: 10,
    hero: { x: 2, y: 3 },
    boxGravity: true,
    sandBoxes: [sb(1, 9, 2, 1, [[O, 1], [R, 1]]), sb(5, 9, 2, 1, [[G, 1], [B, 1]])],
    walls: wl(...wrow(8, 1, 6), [3, 9], [4, 9]),
    boxes: [bx('1x1', 2, 7, R), bx('1x1', 2, 6, B), bx('1x1', 2, 5, O), bx('1x1', 2, 4, G)],
    hint: 'Two pits, two trays. Every push out of the tower leaves you holding the rest; step out on the side that sends the next box to the other pit.',
    solution: ['RLL', 'RRRRR', 'LLLLL', 'RRRRR'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   # . . . . . . .
  //   . Y . . . . . .
  //   = = = . . R . .
  //   = = = @ . B . #
  //   = # # w = = = =
  // Solution: Push blue to its tray; red stays on your head. Only after blue has gone can you step
  // right: red drops on your left. Push it against the wall and climb out over it, then push yellow
  // under its sand. That pop thaws the white under the step, which drains; the red step drops into
  // its place and drinks.
  {
    id: 'leave-a-step',
    name: 'Leave a Step',
    width: 8,
    height: 11,
    hero: { x: 3, y: 9 },
    boxGravity: true,
    sandBoxes: [sb(0, 6, 1, 1, [[Y, 1]]), sb(7, 9, 1, 1, [[B, 1]]), sb(1, 10, 2, 1, [[R, 1], [W, 1]])],
    walls: wl(...wrow(8, 0, 2), ...wrow(9, 0, 2), [0, 10], ...wrow(10, 4, 7)),
    boxes: [bx('1x1', 1, 7, Y), bx('1x1', 5, 9, B), bx('1x1', 5, 8, R), bx('1x1', 3, 10, W, 2)],
    hint: 'You can only climb out over a step. Keep the red one: wait for the blue to finish, then push red against the wall and climb. The ice under it melts once you are out.',
    solution: ['RR', 'RLLLLL'],
  },
  //   = . . . . . . .
  //   = . . . . . . .
  //   = . . . # = . .
  //   = @ Y . . = . .
  //   = = w w w # # #
  //   = # . . = = . .
  //   = . B . . = . .
  //   = = k k k # # #
  //   = . . . = = . .
  //   = . . G . # = =
  // Solution: Push yellow under its sand: the pop thaws the white floor you stand on, which drains
  // and lowers you onto the pink floor, right of blue. Push blue left under its sand; that third
  // pop thaws the pink floor. Stand left of green when it crumbles, then push green to its sand.
  {
    id: 'crumble',
    name: 'Crumble',
    width: 8,
    height: 10,
    hero: { x: 1, y: 3 },
    boxGravity: true,
    sandBoxes: [
      sb(4, 2, 1, 1, [[Y, 1]]),
      sb(5, 4, 3, 1, [[W, 3]]),
      sb(1, 5, 1, 1, [[B, 1]]),
      sb(5, 7, 3, 1, [[K, 3]]),
      sb(5, 9, 1, 1, [[G, 1]]),
    ],
    walls: wl(...wcol(0, 0, 9), [5, 2], [5, 3], [1, 4], [4, 5], [5, 5], [5, 6], [1, 7], [4, 8], [5, 8], [6, 9], [7, 9]),
    boxes: [bx('1x1', 2, 3, Y), bx('3x1', 2, 4, W, 1), bx('1x1', 2, 6, B), bx('3x1', 2, 7, K, 3), bx('1x1', 3, 9, G)],
    hint: 'The floors are ice. Every pop melts one and you sink to the next room: stand where you want to land.',
    solution: ['RR', 'L', 'R'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . # . . . . .
  //   . . . . . G . .
  //   . . . . . G . @
  //   . = = = = = = =
  //   . = = = = = = =
  //   . = = = = = = =
  //   . # = = = = = =
  // Solution: Push the tall green under the floating green sand and let it catch the bottom half.
  // Then push it on into the pit: it lands beside the tray and drinks the rest.
  {
    id: 'catch-and-carry',
    name: 'Catch and Carry',
    width: 8,
    height: 10,
    hero: { x: 7, y: 5 },
    boxGravity: true,
    sandBoxes: [sb(2, 3, 1, 1, [[G, 1]]), sb(1, 9, 1, 1, [[G, 1]])],
    walls: wl(...wrow(6, 1, 7), ...wrow(7, 1, 7), ...wrow(8, 1, 7), ...wrow(9, 2, 7)),
    boxes: [bx('1x2', 5, 4, G)],
    hint: 'One sand box fills only half of the tall green. Catch under it first, then carry the box on into the pit for the rest.',
    solution: ['LLLL', 'LL'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . B = . .
  //   . . . . Y . @ .
  //   . . . . O = = .
  //   = = = . R . . .
  //   # # # . # = = =
  // Solution: The tray wants yellow (third), then blue (top), then red (bottom), then orange. Step
  // into the nook and push yellow off; blue rests on you, step back and push it too (it drains the
  // small tray). Go down and around, push red from the floor; orange rests on you, step back, push
  // it.
  {
    id: 'tower-order',
    name: 'Tower Order',
    width: 8,
    height: 10,
    hero: { x: 6, y: 6 },
    boxGravity: true,
    sandBoxes: [sb(0, 9, 3, 1, [[O, 1], [R, 1], [Y, 1]]), sb(4, 9, 1, 1, [[B, 1]])],
    walls: wl(...wrow(8, 0, 2), [5, 5], [5, 7], [6, 7], [5, 9], [6, 9], [7, 9]),
    boxes: [bx('1x1', 4, 8, R), bx('1x1', 4, 7, O), bx('1x1', 4, 6, Y), bx('1x1', 4, 5, B)],
    hint: 'Not the bottom first: the nook in the wall reaches the middle of the tower. Take the upper two from there, then go down for the rest.',
    solution: ['LL', 'RL', 'RRRLLL', 'RL'],
  },
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . = . . . . .
  //   @ . = . . . . .
  //   = . = . . . . .
  //   . . = . . . . .
  //   . . = . . . . .
  //   . . = . . . . #
  //   . . = . . . Y .
  //   . . = . . = = =
  //   . R . . . r # #
  // Solution: Walk off the shelf and fall onto red; step off left and push it through the tunnel
  // under the wall, against the frozen red face. Climb it, climb the ledge and push yellow under
  // its sand. The pop thaws the face, which joins the red step and drains both.
  {
    id: 'long-way-round',
    name: 'Long Way Round',
    width: 8,
    height: 11,
    hero: { x: 0, y: 3 },
    boxGravity: true,
    sandBoxes: [sb(6, 10, 2, 1, [[R, 2]]), sb(7, 7, 1, 1, [[Y, 1]])],
    walls: wl([0, 4], ...wcol(2, 2, 9), ...wrow(9, 5, 7)),
    boxes: [bx('1x1', 1, 10, R), bx('1x1', 5, 10, R, 1), bx('1x1', 6, 8, Y)],
    hint: 'No way over the wall: go down, take the red box through the tunnel, and use it to climb the far side. The ice melts into the step once you are up.',
    solution: ['RL', 'RRR', 'RRR'],
  },
  //   . . . . . . . .
  //   . . = O = . . .
  //   # . = R = . . .
  //   # . P P @ = . .
  //   . = = . = . . .
  //   . . = . = . . .
  //   . . = . = = = =
  //   . . = . = . . #
  //   . . = . = G . #
  //   . . = . . B . .
  //   # # # y # B . .
  // Solution: Push the pin from its right side and ride the closet down onto the frozen yellow
  // plug, holding it up. Step out of the door onto the green tray and undercut: push the blue base
  // twice, the green drops beside its tray and the base goes under its sand. The pin and the first
  // pop thaw the plug; the closet drains yellow, red, orange.
  {
    id: 'grand-finale',
    name: 'Grand Finale',
    width: 8,
    height: 11,
    hero: { x: 4, y: 3 },
    boxGravity: true,
    sandBoxes: [sb(0, 2, 1, 2, [[P, 2]]), sb(0, 10, 3, 1, [[O, 1], [R, 1], [Y, 1]]), sb(4, 10, 1, 1, [[G, 1]]), sb(7, 7, 1, 2, [[B, 2]])],
    walls: wl([2, 1], [4, 1], [2, 2], [4, 2], [5, 3], [1, 4], [2, 4], ...wcol(2, 5, 9), ...wcol(4, 4, 8), ...wrow(6, 5, 7)),
    boxes: [bx('2x1', 2, 3, P), bx('1x1', 3, 2, R), bx('1x1', 3, 1, O), bx('1x1', 3, 10, Y, 2), bx('1x2', 5, 9, B), bx('1x1', 5, 8, G)],
    hint: 'Everything at once: pull the pin, ride the closet down, step out and undercut the tower from the tray. The plug melts after two pops.',
    solution: ['L', 'RRR'],
  },
];
