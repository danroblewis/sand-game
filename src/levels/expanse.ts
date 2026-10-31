// Chapter 5 "Expanse": big maps (DESIGN.md "Big maps"). Boards larger than the screen, shown with
// the 'scroll' or 'rooms' camera: long same-color chains acting as one container (rule 6b), remote
// triggers (a pop in one room thaws a plug in another), and belt loops that circulate boxes past
// sand box stations. Owned by one designer agent; spliced into LEVELS by index.ts.
//
// Maps are drawn without spaces (one character per cell, x grows right, y grows down): # sand box,
// capital letter = box (R red, O orange, Y yellow, G green, T teal, B blue, P purple, K pink,
// W white), lower-case = frozen box, = wall, @ hero, ^ v < > belt, . empty. Walls are read from the
// map itself (every '='); sand boxes and boxes are listed explicitly and drawn for reading. Every
// solution is proven by tests/levels-physics.test.ts (three seeds, plus a slow walk so no entry
// races the sand).
import type { BoxDef, ColorId, ConveyorDef, Dir, LayerDef, LevelDef, SandBoxDef, ShapeName, Vec } from '../core/types';

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

/** Driven box helper (DESIGN.md "Driven boxes"): a box with a built-in force. */
const dv = (shape: ShapeName, x: number, y: number, color: ColorId, force: Dir, frozen?: number): BoxDef =>
  frozen ? { shape, x, y, color, force, frozen } : { shape, x, y, color, force };

/** Wall cells read from a map: every '=' (one character per cell, no spaces). */
const walls = (...rows: string[]): Vec[] =>
  rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === '=' ? [{ x, y }] : [])));

/** A clockwise rectangular belt loop on the ring of cells x0..x1, y0..y1: right along the top, down
 *  the right side, left along the bottom, up the left side. Each corner cell belongs to the strip
 *  leaving it, so a 1x1 box turns the corner. */
const loop = (x0: number, y0: number, x1: number, y1: number, interval?: number): ConveyorDef[] =>
  (
    [
      { x: x0, y: y0, dir: 'right', length: x1 - x0 },
      { x: x1, y: y0, dir: 'down', length: y1 - y0 },
      { x: x1, y: y1, dir: 'left', length: x1 - x0 },
      { x: x0, y: y1, dir: 'up', length: y1 - y0 },
    ] as ConveyorDef[]
  ).map((c) => (interval ? { ...c, interval } : c));

void [O, G, T, P, K, W, loop];

export const EXPANSE: LevelDef[] = [
  //    0123456789012345678901234567
  //  0 ......=.....................
  //  1 ......=.....................
  //  2 ######=.....................
  //  3 ######=....###..............
  //  4 ######=..........#..........
  //  5 ######=.....................
  //  6 ######=...................==
  //  7 ......RRRRRBBBRRRYRRRRRRRRRR
  //  8 RRRRRR.RRR.........R......RR
  //  9 ..............@...........==
  // Solution: The red line from the reservoir under the sand box to the sealed 2x2 at the far end
  // is one container: it fills only once every link touches. Push the blue and yellow interlopers
  // up out of the line under their own sand, plug the gaps with the spare reds, and close the link
  // under the reservoir last; the whole chain fills and pops at once.
  {
    id: 'long-haul',
    name: 'Long Haul',
    width: 28,
    height: 10,
    camera: 'scroll',
    hero: { x: 14, y: 9 },
    sandBoxes: [sb(0, 2, 6, 5, [[R, 30]]), sb(11, 3, 3, 1, [[B, 3]]), sb(17, 4, 1, 1, [[Y, 1]])],
    walls: walls(
      '......=.....................',
      '......=.....................',
      '......=.....................',
      '......=.....................',
      '......=.....................',
      '......=.....................',
      '......=...................==',
      '............................',
      '............................',
      '..........................==',
    ),
    boxes: [
      bx('3x1', 0, 8, R), // 0: under the reservoir, left
      bx('3x1', 3, 8, R), // 1: under the reservoir, right
      bx('1x1', 6, 7, R), // 2
      bx('3x1', 7, 7, R), // 3
      bx('1x1', 10, 7, R), // 4
      bx('3x1', 11, 7, B), // 5: interloper
      bx('3x1', 14, 7, R), // 6
      bx('1x1', 17, 7, Y), // 7: interloper
      bx('3x1', 18, 7, R), // 8
      bx('1x1', 21, 7, R), // 9
      bx('3x1', 22, 7, R), // 10
      bx('1x1', 25, 7, R), // 11
      bx('2x2', 26, 7, R), // 12: sealed at the far end
      bx('3x1', 7, 8, R), // 13: spare bar
      bx('1x1', 19, 8, R), // 14: spare
    ],
    hint: 'The red line is one container: it fills only when every link touches. Clear the line, plug the gaps, and close the link under the reservoir last.',
    solution: ['ULLUUU', 'DDDRRRRRUU', 'DDDRRRULLDLU', 'DLLLLLLLLLLLURRRRDRRU', 'DLLLLLLLLUDLLLU'],
  },
  //    01234567890123456789012
  //  0 ##.....=.......=.......
  //  1 .......=.......=.P.....
  //  2 .......=.......=.......
  //  3 ..#.B..........y...#...
  //  4 .......=.......=.......
  //  5 ..RR...=.......=.......
  //  6 .......=.......=.......
  //  7 ========...@...========
  //  8 .......=.......=.......
  //  9 .......=.......=.......
  // 10 .....#.=.......=.......
  // 11 ..#....g.......t...#...
  // 12 .......=.......=.......
  // 13 .......=.......=.......
  // 14 .......=.......=.......
  // Solution: Every pop counts down every frozen door plug, wherever it is; each plug's sand sits in
  // line with its door, so a thawed plug is pushed straight in. Pop the red in the open room (NW):
  // the yellow plug of NE thaws. Park the blue in the hub, push the yellow in, and bring NE's
  // purple across to its sand in NW: the green plug of SW thaws. Push it in, then the blue after
  // it to the end of the room: the teal plug of SE thaws, and goes straight in.
  {
    id: 'four-rooms',
    name: 'Four Rooms',
    width: 23,
    height: 15,
    camera: 'rooms',
    hero: { x: 11, y: 7 },
    sandBoxes: [
      sb(0, 0, 2, 1, [[R, 2]]), // NW
      sb(2, 3, 1, 1, [[P, 1]]), // NW, in line with its door
      sb(19, 3, 1, 1, [[Y, 1]]), // NE, in line with its door
      sb(5, 10, 1, 1, [[G, 1]]), // SW, over the door line
      sb(2, 11, 1, 1, [[B, 1]]), // SW, at the end of the door line
      sb(19, 11, 1, 1, [[T, 1]]), // SE, in line with its door
    ],
    walls: walls(
      '.......=.......=.......',
      '.......=.......=.......',
      '.......=.......=.......',
      '.......................',
      '.......=.......=.......',
      '.......=.......=.......',
      '.......=.......=.......',
      '========.......========',
      '.......=.......=.......',
      '.......=.......=.......',
      '.......=.......=.......',
      '.......................',
      '.......=.......=.......',
      '.......=.......=.......',
      '.......=.......=.......',
    ),
    boxes: [
      bx('2x1', 2, 5, R), // 0
      bx('1x1', 4, 3, B), // 1: belongs in SW
      bx('1x1', 15, 3, Y, 1), // 2: NE door plug
      bx('1x1', 7, 11, G, 3), // 3: SW door plug
      bx('1x1', 15, 11, T, 5), // 4: SE door plug
      bx('1x1', 17, 1, P), // 5: in NE, belongs in NW
    ],
    hint: 'Every pop counts down every frozen door plug, wherever it is. Some boxes belong to a room across the hub, and a door opens only once enough has popped elsewhere.',
    solution: ['UUUULLLLLDDLLLLDLLUUUU', 'RRRDRRRRRURDDDDDDD', 'UUUUUURRRRRRRR', 'ULUURDDRDLLLLLLLLLLLLLL', 'RRRRDDDDDDDDLL', 'RRUURDRDLLLLLL', 'RRRRRRRRRRRRR'],
  },
  //    012345678901
  //  0 =====.......
  //  1 =====.......
  //  2 =====.Y..@..
  //  3 =====.====..
  //  4 =====.R.....
  //  5 =====.==##ww
  //  6 =====.=...=.
  //  7 =====.=.....
  //  8 =====.=.....
  //  9 =====.=.....
  // 10 =====.G.....
  // 11 ==###.==##ww
  // 12 ==##ww=...=.
  // 13 =====.=.....
  // 14 =====.=.....
  // 15 =====.=.....
  // 16 =====.P.....
  // 17 =====.==##ww
  // 18 ==###.=...=.
  // 19 ==##ww=.....
  // 20 =====.=.....
  // 21 =====.=.....
  // 22 =====.=.....
  // 23 ==###.B.....
  // Solution: The box shaft (x=5) has two stack trays, each above a white ice floor, and a tray at
  // its foot; you go down your own way, dropping through the ice floors at the right (x=10-11),
  // and there is no way back up. Each floor sends its box into the shaft: the yellow from the top
  // ledge first (its band is on top), then drop to the floor below for the red. The pops thaw the
  // ice in turn: the top floor opens, the shaft ice under tray A melts so the green from the next
  // floor falls through to tray B, then your floor gives way, the purple follows the green, and
  // the blue waits at the bottom. Drop down the well before pushing a floor's box and it is lost.
  {
    id: 'descent',
    name: 'Descent',
    width: 12,
    height: 24,
    camera: 'scroll',
    boxGravity: true,
    hero: { x: 9, y: 2 },
    sandBoxes: [
      sb(8, 5, 2, 1, [[W, 2]]), // ice floor 0's tray
      sb(2, 11, 3, 1, [[R, 1], [Y, 1]]), // stack tray A
      sb(8, 11, 2, 1, [[W, 2]]), // ice floor 1's tray
      sb(2, 12, 2, 1, [[W, 2]]), // shaft ice A's tray
      sb(8, 17, 2, 1, [[W, 2]]), // ice floor 2's tray
      sb(2, 18, 3, 1, [[P, 1], [G, 1]]), // stack tray B
      sb(2, 19, 2, 1, [[W, 2]]), // shaft ice B's tray
      sb(2, 23, 3, 1, [[B, 1]]), // tray C at the shaft foot
    ],
    walls: walls(
      '=====.......',
      '=====.......',
      '=====.......',
      '=====.====..',
      '=====.......',
      '=====.==##..',
      '=====.=...=.',
      '=====.=.....',
      '=====.=.....',
      '=====.=.....',
      '=====.......',
      '==###.==##..',
      '==##..=...=.',
      '=====.=.....',
      '=====.=.....',
      '=====.=.....',
      '=====.......',
      '=====.==##..',
      '==###.=...=.',
      '==##..=.....',
      '=====.=.....',
      '=====.=.....',
      '=====.=.....',
      '==###.......',
    ),
    boxes: [
      bx('1x1', 6, 2, Y), // 0: on the ledge
      bx('1x1', 6, 4, R), // 1
      bx('1x1', 6, 10, G), // 2
      bx('1x1', 6, 16, P), // 3
      bx('1x1', 6, 23, B), // 4
      bx('2x1', 10, 5, W, 1), // 5: ice floor 0
      bx('2x1', 4, 12, W, 3), // 6: shaft ice A
      bx('2x1', 10, 11, W, 5), // 7: ice floor 1
      bx('2x1', 4, 19, W, 7), // 8: shaft ice B
      bx('2x1', 10, 17, W, 7), // 9: ice floor 2
    ],
    hint: 'There is no way back up. Each floor sends its box down the shaft before you drop through the ice, and the stack drains at the trays in the order it lands.',
    solution: ['LLL', 'RRRRLLLL', 'RRRRR', 'LLLLL', 'RRRRR', 'LLLLL', 'RRRRR', 'LLLLL'],
  },
  //    01234567890123456789
  //  0 ....................
  //  1 ..........@.........
  //  2 .....Y..............
  //  3 ==>>>>>>RTBYPWRb>v==
  //  4 ==^=======.##.#==v==
  //  5 ==^=#===#===#====v==
  //  6 ==^=#===#===#====v==
  //  7 ==^=#===#===#====v==
  //  8 ==^<<<<<<<<<<<<<<<==
  // Solution: The queue waits behind the frozen blue gate. The white, purple and teal boxes have
  // no station on the loop: push each down into a pocket beside its own sand (white and purple
  // share the pocket at x=13, teal has the one at x=10). Removing a box lets the queue behind it
  // close up by one, so take the white first, then the teal (now over its pocket), and only then
  // the purple; the other way round the teal slides past its pocket for good. Load the spare
  // yellow onto the tail. Three pops thaw the gate and the loop sorts the rest by itself: each box
  // catches at the first station whose bottom band is its color.
  {
    id: 'loop-line',
    name: 'Loop Line',
    width: 20,
    height: 12,
    camera: 'scroll',
    hero: { x: 10, y: 1 },
    sandBoxes: [
      sb(12, 5, 1, 3, [[R, 1], [Y, 1]]), // station 1
      sb(8, 5, 1, 3, [[B, 1], [R, 1]]), // station 2
      sb(4, 5, 1, 3, [[Y, 1], [B, 1]]), // station 3
      sb(12, 4, 1, 1, [[W, 1]]), // pocket x=13: white side
      sb(14, 4, 1, 1, [[P, 1]]), // pocket x=13: purple side
      sb(11, 4, 1, 1, [[T, 1]]), // pocket x=10: teal side
    ],
    walls: walls(
      '....................',
      '....................',
      '....................',
      '==................==',
      '==.=======.##.#==.==',
      '==.=#===#===#====.==',
      '==.=#===#===#====.==',
      '==.=#===#===#====.==',
      '==................==',
      '====================',
      '====================',
      '====================',
    ),
    conveyors: loop(2, 3, 17, 8, 30),
    boxes: [
      bx('1x1', 15, 3, B, 3), // 0: the frozen gate: the queue waits behind it
      bx('1x1', 14, 3, R), // 1
      bx('1x1', 13, 3, W), // 2
      bx('1x1', 12, 3, P), // 3
      bx('1x1', 11, 3, Y), // 4
      bx('1x1', 10, 3, B), // 5
      bx('1x1', 9, 3, T), // 6
      bx('1x1', 8, 3, R), // 7
      bx('1x1', 5, 2, Y), // 8: waiting to be loaded
    ],
    hint: 'The loop only sorts boxes it has a station for. Push the others into pockets beside their own sand; each removal closes the queue up by one cell, so mind the order.',
    solution: ['LLLLLDU', 'DRRRRRRRRDU', 'LLLDU', 'RRRDU'],
  },
  //    01234567890123456789
  //  0 >>>>>>>>>v>>>>>>>>>v
  //  1 ^...@....vg.....K.#v
  //  2 ^........vR........v
  //  3 ^..#..#..G^..#..#..v
  //  4 ^..#..#..Y^..#..#..v
  //  5 ^..#..#..r^..#..#..v
  //  6 ^<<<<<<<<<^<<<<<<<<<
  // Solution: Two loops meet where the west loop runs down and the east loop runs up, each queue
  // held by a frozen gate. From inside a loop you can push the box at the junction across, and you
  // cross yourself only on a belt cell whose next cell is taken (a box or a gate), so you never
  // ride off. The green has to go east and the red west, but the junction is jammed: send the
  // yellow east first as a spacer, bring the red west, send the green east, bring the yellow
  // home. Then pull the lever (the pink, pushed beside its sand): both gates thaw and each loop
  // feeds its boxes to its own stations.
  {
    id: 'switchyard',
    name: 'Switchyard',
    width: 20,
    height: 7,
    camera: 'scroll',
    hero: { x: 4, y: 1 },
    sandBoxes: [
      sb(6, 3, 1, 3, [[R, 1], [Y, 1]]), // west station 1
      sb(3, 3, 1, 3, [[R, 1]]), // west station 2
      sb(16, 3, 1, 3, [[G, 1]]), // east station 1
      sb(13, 3, 1, 3, [[G, 1]]), // east station 2
      sb(18, 1, 1, 1, [[K, 1]]), // the lever's sand
    ],
    conveyors: [...loop(0, 0, 9, 6, 30), ...loop(10, 0, 19, 6, 30)],
    boxes: [
      bx('1x1', 9, 5, R, 1), // 0: west gate
      bx('1x1', 10, 1, G, 1), // 1: east gate
      bx('1x1', 9, 4, Y), // 2
      bx('1x1', 9, 3, G), // 3
      bx('1x1', 10, 2, R), // 4
      bx('1x1', 16, 1, K), // 5: the lever
    ],
    hint: 'Each loop sorts only its own colors, and a box can cross only where the two queues meet. The yellow has to go over first, as a spacer.',
    solution: ['DRRRDDRR', 'R', 'R', 'UUL', 'L', 'L', 'DDR', 'R', 'R', 'UUL', 'RURRRRR'],
  },
  //    012345678901234567890123456789
  //  0 ....=====#====#====#======....
  //  1 ....=====#====#====#======....
  //  2 ....>>>>>>>>>>>>>>>>>>>>>>....
  //  3 ..P.======================.Y..
  //  4 .@..==========#====#======..R.
  //  5 .B..==========#====#======.G..
  //  6 ..Y.<<<<<<<<<<<<<<<<<<<<<<....
  //  7 ....======================....
  // Solution: Two one-way walkways cross the gorge under floating sand boxes; a box riding under
  // one catches its bottom band in passing (one pass is enough), and a box that finds nothing
  // rides off the far end onto the platform. Load the west boxes in band order (purple, then the
  // yellow above it, then blue), ride across yourself, send the yellow and red west, and send the
  // green west too: it has no station that way, but it reaches the west platform, where you ride
  // in behind it, nudge it off the landing and load it east to its station.
  {
    id: 'sky-walk',
    name: 'Sky Walk',
    width: 30,
    height: 8,
    camera: 'scroll',
    hero: { x: 1, y: 4 },
    sandBoxes: [
      sb(9, 0, 1, 2, [[P, 1], [Y, 1]]), // over the east walk
      sb(14, 0, 1, 2, [[B, 1]]),
      sb(19, 0, 1, 2, [[G, 1]]),
      sb(19, 4, 1, 2, [[Y, 1]]), // over the west walk
      sb(14, 4, 1, 2, [[R, 1]]),
    ],
    walls: walls(
      '....=====#====#====#======....',
      '....=====#====#====#======....',
      '..............................',
      '....======================....',
      '....==========#====#======....',
      '....==========#====#======....',
      '..............................',
      '....======================....',
    ),
    conveyors: [
      { x: 4, y: 2, dir: 'right', length: 22, interval: 30 },
      { x: 25, y: 6, dir: 'left', length: 22, interval: 30 },
    ],
    boxes: [
      bx('1x1', 2, 3, P), // 0
      bx('1x1', 1, 5, B), // 1
      bx('1x1', 2, 6, Y), // 2
      bx('1x1', 27, 3, Y), // 3
      bx('1x1', 28, 4, R), // 4
      bx('1x1', 27, 5, G), // 5
    ],
    hint: 'A box riding under a sand box catches its bottom band on the way. Anything with no station on its walk rides to the far platform: the walk back can return it.',
    solution: ['RULURR', 'DDDDDLUUUULURR', 'DDLLLDRDRUUULURR', 'R', 'RRDLULDDDUURRRDDDLLL', 'RRURULLULDDURRDDLL', 'RRULULDRDL', 'L', 'DLUUUULURR'],
  },
  //    0123456789012345
  //  0 ###=============
  //  1 ###=============
  //  2 ###==========R==
  //  3 ###=========.R==
  //  4 ###=========.===
  //  5 ###=========.===
  //  6 .............===
  //  7 ..R....====..===
  //  8 .R..RRR=========
  //  9 ..R....=========
  // 10 .R..RRR=========
  // 11 .......=========
  // 12 RRRRRR.=========
  // 13 ...@...=========
  // Solution: The corridor from the reservoir (rows 0-5) to the sealed 1x2 at the far end is one
  // container once every cell holds red; it fills only when the link under the reservoir closes it.
  // In a one-wide corridor you can only push from behind, so it fills from the far end back, and
  // a bar cannot turn the corner (the nook under it lets you push a small box up the last leg).
  // Send the four small boxes up the far leg (they enter the corridor at x=3; never push a red under
  // the reservoir early), then the two long bars along the first leg, the third bar into the mouth,
  // and the link up under the reservoir last.
  {
    id: 'relay',
    name: 'Relay',
    width: 16,
    height: 14,
    camera: 'scroll',
    hero: { x: 3, y: 13 },
    sandBoxes: [sb(0, 0, 3, 6, [[R, 18]])],
    walls: walls(
      '###=============',
      '###=============',
      '###==========.==',
      '###=========..==',
      '###=========.===',
      '###=========.===',
      '.............===',
      '.......====..===',
      '.......=========',
      '.......=========',
      '.......=========',
      '.......=========',
      '.......=========',
      '.......=========',
    ),
    boxes: [
      bx('1x2', 13, 2, R), // 0: sealed in its pocket at the far end
      bx('3x1', 0, 12, R), // 1: the link under the reservoir
      bx('3x1', 4, 8, R), // 2
      bx('3x1', 4, 10, R), // 3
      bx('3x1', 3, 12, R), // 4
      bx('1x1', 1, 8, R), // 5
      bx('1x1', 1, 10, R), // 6
      bx('1x1', 2, 9, R), // 7
      bx('1x1', 2, 7, R), // 8
    ],
    hint: 'The red corridor is one container that fills only when complete. You can only push from behind, and bars cannot turn corners: fill the far end first and link the reservoir last.',
    solution: ['RRRUULLLLLLURRDRUUUUDDDLLULUUURRRRRRRRRRRDRUUU', 'DDLLLLLLLLLLLDLDRRLDDRRUUUDLLUURRRRRRRRRRDRUU', 'DLLLLLLDLLLDLLDRDRUUUDLLUURRRRRRRRRRDRU', 'LLLLLLLLLLLDRDRULURRRRRRRRR', 'LLLLLDLLLDDRRUULLURRRRR', 'LLDDDLLLDDRRUUUULLURR', 'DDDDDRDDLLUUUUUU', 'DDDDDDLLLUUUUUU'],
  },
  //    01234567890123456789012345678901
  //  0 .......================.....====
  //  1 .#.....===>>>>>>>>>>>v=...#.====
  //  2 .......===^==========v=.....###=
  //  3 ..W....===^=====#=#=#v=..W..###=
  //  4 .......===^=====#=#=#v=.....###=
  //  5 .......===^=====#=#=#v=.....###=
  //  6 ..R.R..===^g<<<<<<<<<<==.===###=
  //  7 .......=....................###=
  //  8 .......p....................###=
  //  9 ========....................###=
  // 10 ======RR....................###=
  // 11 ======RRRRRRRBRRRYRRRRRRRRR....=
  // 12 ========............@...R...RRR.
  // 13 ========........................
  // Solution: The red line along the bottom runs from the sealed 2x2 in the west to the reservoir in
  // the east; a blue and a yellow sit in it. Push them up out of the line onto the loop (they
  // queue behind the frozen green gate). The white in the east room thaws the purple plug of the
  // west room: walk it in and out like in Four Rooms and load it onto the loop too. The white in
  // the west room thaws the gate and the loop sorts its four boxes. Fill the two gaps with the
  // spare reds from the west room, slip back under through the gap at x=27, push the link into it
  // and the catcher under the reservoir last: 27 cells of red fill as one.
  {
    id: 'expanse',
    name: 'Expanse',
    width: 32,
    height: 14,
    camera: 'scroll',
    hero: { x: 20, y: 12 },
    sandBoxes: [
      sb(28, 2, 3, 9, [[R, 27]]), // the reservoir
      sb(20, 3, 1, 3, [[B, 1], [G, 1]]), // loop station 1
      sb(18, 3, 1, 3, [[Y, 1]]), // loop station 2
      sb(16, 3, 1, 3, [[P, 1]]), // loop station 3
      sb(1, 1, 1, 1, [[W, 1]]), // west room
      sb(26, 1, 1, 1, [[W, 1]]), // east room
    ],
    walls: walls(
      '.......================.....====',
      '.#.....===............=...#.====',
      '.......===.==========.=.....###=',
      '.......===.=====#=#=#.=.....###=',
      '.......===.=====#=#=#.=.....###=',
      '.......===.=====#=#=#.=.....###=',
      '.......===............==.===###=',
      '.......=....................###=',
      '............................###=',
      '========....................###=',
      '======......................###=',
      '======.........................=',
      '========........................',
      '========........................',
    ),
    conveyors: loop(10, 1, 21, 6, 30),
    boxes: [
      bx('1x1', 11, 6, G, 2), // 0: the loop's frozen gate
      bx('2x2', 6, 10, R), // 1: sealed at the far west end of the line
      bx('3x1', 8, 11, R), // 2
      bx('2x1', 11, 11, R), // 3
      bx('1x1', 13, 11, B), // 4: interloper
      bx('3x1', 14, 11, R), // 5
      bx('1x1', 17, 11, Y), // 6: interloper
      bx('3x1', 18, 11, R), // 7
      bx('3x1', 21, 11, R), // 8
      bx('3x1', 24, 11, R), // 9
      bx('1x1', 24, 12, R), // 10: the link
      bx('3x1', 28, 12, R), // 11: the catcher under the reservoir
      bx('1x1', 7, 8, P, 1), // 12: the west room's door plug
      bx('1x1', 2, 3, W), // 13: west room
      bx('1x1', 2, 6, R), // 14: spare
      bx('1x1', 4, 6, R), // 15: spare
      bx('1x1', 25, 3, W), // 16: east room
    ],
    hint: 'Everything counts down everything: rooms thaw doors, doors thaw the loop. Clear the red line onto the loop, fill its gaps, and link the reservoir last.',
    solution: ['LLLLLLLUUUUU', 'DDDDDRRRRUUUUU', 'RRRRRRRUUUURDRU', 'DDLLDDDLLLLLLLLLLLLLLLLLLULLDRRRRRRRRRRDRUU', 'DLLLLLLLLLUUUUULLLLDLU', 'DDRRRDDLDRRRRRRRRRURDDD', 'UULLLLLLLUUULLLLDDLDRRRRRRRRRRRRRRRURDDD', 'RRRRRRRRRRDDDLLLLURRRDRU', 'DRRU'],
  },
  //    0123456789012345678901234567
  //  0 ###=========================
  //  1 ###=========================
  //  2 ###=========================
  //  3 ###=========================
  //  4 ###=========================
  //  5 ###=========================
  //  6 ###=========================
  //  7 ...R.RRRR.RRRR.RRRR=========
  //  8 ...=.====.====.==RR=========
  //  9 ...=.......R.=..........R...
  // 10 RRR.....=.............@...R.
  // 11 ............................
  // Solution: The red lane under the wall is one container from the reservoir's catcher spot to the
  // sealed 2x2, with three one-cell gaps over openings. A kicked box slides until it hits something:
  // kick each spare red along a hall row so it stops against a pillar right under an opening, then
  // kick it up into its gap. Kick the catcher up under the reservoir last.
  {
    id: 'kickoff',
    name: 'Kickoff',
    width: 28,
    height: 12,
    camera: 'scroll',
    hero: { x: 22, y: 10 },
    sandBoxes: [sb(0, 0, 3, 7, [[R, 21]])],
    walls: walls(
      '###=========================',
      '###=========================',
      '###=========================',
      '###=========================',
      '###=========================',
      '###=========================',
      '###=========================',
      '...................=========',
      '...=.====.====.==..=========',
      '...=.........=..............',
      '........=...................',
      '............................',
    ),
    boxes: [
      bx('2x2', 17, 7, R), // 0: sealed at the far end of the lane
      bx('1x1', 3, 7, R), // 1
      bx('3x1', 5, 7, R), // 2
      bx('1x1', 8, 7, R), // 3
      bx('3x1', 10, 7, R), // 4
      bx('1x1', 13, 7, R), // 5
      bx('2x1', 15, 7, R), // 6
      bx('1x1', 24, 9, R), // 7
      bx('1x1', 26, 10, R), // 8
      bx('1x1', 11, 9, R), // 9
      bx('3x1', 0, 10, R), // 10: the catcher
    ],
    hint: 'A long swipe kicks a box: it slides until it hits something. Use the pillars to stop each spare red under a gap in the lane, kick it up, and kick the catcher under the reservoir last.',
    solution: ['RRRUKLDLLLLLLLLLLLKU', 'URRRRRRRRRRRRRDKLDLLLLLLLLLLLLLLLLLLKU', 'URRRUKLLLLLLDLLLKU', 'DLLLKU'],
  },
  //    012345678901234567890123456789
  //  0 ..............................
  //  1 ..............................
  //  2 @....................=........
  //  3 .....R.=.......B.....Y........
  //  4 ..G=.......=..................
  //  5 ==.=====.=====.=====.=====#===
  //  6 =..........................###
  //  7 ==============================
  // force: #0->right
  // force: G at (2,4) right (the engine, parked against its alcove wall)
  // Solution: The lane along the bottom is walled: boxes go in only through the four openings, and
  // nothing in it moves until the green engine is pushed down into it. Then it drives east,
  // collecting every box it meets, and presses the train against the tray: the front box drinks
  // the top band, pops, and the engine closes up. So the eastmost opening must get the red (top
  // band), then the blue, then the yellow; the engine itself catches its green from the sand box
  // over the front cell last. The pillars stop kicked boxes over the right openings.
  {
    id: 'thrust-line',
    name: 'Thrust Line',
    width: 30,
    height: 8,
    camera: 'scroll',
    hero: { x: 0, y: 2 },
    sandBoxes: [sb(27, 6, 3, 1, [[Y, 1], [B, 1], [R, 1]]), sb(26, 5, 1, 1, [[G, 1]])],
    walls: walls(
      '..............................',
      '..............................',
      '.....................=........',
      '.......=......................',
      '...=.......=..................',
      '==.=====.=====.=====.=====#===',
      '=..........................###',
      '==============================',
    ),
    boxes: [
      dv('1x1', 2, 4, G, 'right'), // 0: the engine, parked against the alcove wall
      bx('1x1', 5, 3, R), // 1
      bx('1x1', 15, 3, B), // 2
      bx('1x1', 21, 3, Y), // 3
    ],
    hint: 'The green engine drives east the moment it is in the lane, collecting every box it meets; the tray eats the front box first. Load the openings so the order matches the bands.',
    solution: ['DRRRRDRULUKRURRRRRRRRRRRRRRRRDDDD', 'UULLLLLULDDD', 'URRRRRRRRUKLLLULLLLLLLLLLLLDDD', 'ULLULLLLDD'],
  },
  //    012345678901
  //  0 ============
  //  1 ##.###......
  //  2 ==.=........
  //  3 ==.=........
  //  4 ==.=........
  //  5 ==..B..#....
  //  6 ==.===..R.@.
  //  7 ==.=====##ww
  //  8 ==.=......=.
  //  9 ==.=........
  // 10 ==.=........
  // 11 ==..R..#....
  // 12 ==.===..Y...
  // 13 ==.=====##ww
  // 14 ==.=......=.
  // 15 ==.=........
  // 16 ==.=........
  // 17 ==..Y..#....
  // 18 ==.===..B...
  // 19 ==.=====##ww
  // 20 ==.=......=.
  // 21 ==g=........
  // 22 ==P=....#...
  // 23 ====.....G..
  // force: #0->up
  // force: P at (2,22) up (the lift, held down by the frozen green pin)
  // Solution: Three floors, each with a box for its own little station (which thaws that floor's ice)
  // and a box on the ledge by the shaft door; there is no way back up. On each floor send the ledge
  // box down the shaft (it lands on the stack over the pinned lift), pop the floor box, and drop
  // through the ice when it melts. The last pop at the bottom thaws the pin and the lift carries the
  // whole stack up to the two trays at the top, which take it from the top down: the stack you built
  // going down comes back up in reverse, so the trays' top bands read yellow, red, blue, green, purple.
  {
    id: 'deep-well',
    name: 'Deep Well',
    width: 12,
    height: 24,
    camera: 'scroll',
    boxGravity: true,
    hero: { x: 10, y: 6 },
    sandBoxes: [
      sb(0, 1, 2, 1, [[P, 1], [Y, 1]]), // the stations at the top of the shaft
      sb(3, 1, 3, 1, [[G, 1], [B, 1], [R, 1]]),
      sb(7, 5, 1, 1, [[R, 1]]), // floor 1
      sb(8, 7, 2, 1, [[W, 2]]),
      sb(7, 11, 1, 1, [[Y, 1]]), // floor 2
      sb(8, 13, 2, 1, [[W, 2]]),
      sb(7, 17, 1, 1, [[B, 1]]), // floor 3
      sb(8, 19, 2, 1, [[W, 2]]),
      sb(8, 22, 1, 1, [[G, 1]]), // the bottom
    ],
    walls: walls(
      '============',
      '##.###......',
      '==.=........',
      '==.=........',
      '==.=........',
      '==.....#....',
      '==.===......',
      '==.=====##..',
      '==.=......=.',
      '==.=........',
      '==.=........',
      '==.....#....',
      '==.===......',
      '==.=====##..',
      '==.=......=.',
      '==.=........',
      '==.=........',
      '==.....#....',
      '==.===......',
      '==.=====##..',
      '==.=......=.',
      '==.=........',
      '==.=....#...',
      '====........',
    ),
    boxes: [
      dv('1x1', 2, 22, P, 'up'), // 0: the lift
      bx('1x1', 2, 21, G, 7), // 1: the pin holding it down
      bx('1x1', 4, 5, B), // 2: floor 1, on the ledge by the shaft door
      bx('1x1', 8, 6, R), // 3
      bx('2x1', 10, 7, W, 1), // 4: ice floor 1
      bx('1x1', 4, 11, R), // 5: floor 2
      bx('1x1', 8, 12, Y), // 6
      bx('2x1', 10, 13, W, 3), // 7: ice floor 2
      bx('1x1', 4, 17, Y), // 8: floor 3
      bx('1x1', 8, 18, B), // 9
      bx('2x1', 10, 19, W, 5), // 10: ice floor 3
      bx('1x1', 9, 23, G), // 11: the bottom
    ],
    hint: 'Every floor sends one box down the shaft before you drop through its ice. At the end the lift carries the stack back up and the trays at the top take it from the top down.',
    solution: ['LL', 'LLLLL', 'RRRRRRRR', 'LLL', 'LLLLL', 'RRRRRRRR', 'LLL', 'LLLLL', 'RRRRRRRR', 'LL'],
  },
  //    012345678901234567890123456789
  //  0 ==============================
  //  1 =.#..#.=.......=.......=.....=
  //  2 =......=...#...=...#...=..#..=
  //  3 =......=...#...=...#...=..#..=
  //  4 =..R...g.......p.......r.....=
  //  5 ==.....g.......p.......r.....=
  //  6 =...Y..=.......=.......=.....=
  //  7 =#..@..=....B.#=....T..=.....=
  //  8 =......=.......=.......=.....=
  //  9 ==============================
  // Solution: Each bulkhead is a frozen 1x2 in the wall between two rooms; clearing a room thaws the
  // next one, and the thawed bulkhead is itself a box: push it east into the next room, under its
  // sand, and the doorway is open. Room C's teal belongs back in room A: once the purple bulkhead has
  // gone, one kick west along the doorway row sends it through both doorways to the pillar in room
  // A, two pushes from its sand.
  {
    id: 'bulkheads',
    name: 'Bulkheads',
    width: 30,
    height: 10,
    camera: 'rooms',
    hero: { x: 4, y: 7 },
    sandBoxes: [
      sb(2, 1, 1, 1, [[R, 1]]), // room A
      sb(5, 1, 1, 1, [[Y, 1]]),
      sb(1, 7, 1, 1, [[T, 1]]),
      sb(11, 2, 1, 2, [[G, 2]]), // room B: for the first bulkhead
      sb(14, 7, 1, 1, [[B, 1]]),
      sb(19, 2, 1, 2, [[P, 2]]), // room C: for the second bulkhead
      sb(26, 2, 1, 2, [[R, 2]]), // room D: for the third bulkhead
    ],
    walls: walls(
      '==============================',
      '=.#..#.=.......=.......=.....=',
      '=......=...#...=...#...=..#..=',
      '=......=...#...=...#...=..#..=',
      '=............................=',
      '==...........................=',
      '=......=.......=.......=.....=',
      '=#.....=......#=.......=.....=',
      '=......=.......=.......=.....=',
      '==============================',
    ),
    boxes: [
      bx('1x1', 3, 4, R), // 0
      bx('1x1', 4, 6, Y), // 1
      bx('1x2', 7, 4, G, 2), // 2: the first bulkhead
      bx('1x1', 12, 7, B), // 3
      bx('1x2', 15, 4, P, 4), // 4: the second bulkhead
      bx('1x1', 20, 7, T), // 5: belongs in room A
      bx('1x2', 23, 4, R, 6), // 6: the third bulkhead
    ],
    hint: 'The walls between the rooms are frozen boxes. Clear a room and the next bulkhead thaws: push it into the next room under its own sand to open the way.',
    solution: ['LUURULDLUU', 'DDDRRDRUUUU', 'DRRRRR', 'DDDRR', 'UUURRRRRR', 'DDDDRRUURUKLULLLLLLLLLLLLLLLLLLLDD', 'UURRRRRRRRRRRRRRRRRRRRRRR'],
  },
  //    012345678901234567890123456789
  //  0 ==============================
  //  1 .......=================......
  //  2 ..B.=..================....#..
  //  3 .......================.......
  //  4 .@...Y.>>>>>>>>>>>>>>>>.###...
  //  5 .......=================......
  //  6 .=.R=..=================.G....
  //  7 .......=================......
  //  8 ==============================
  // Solution: The ferry is a one-way belt across the chasm. A box loaded on it rides to the landing,
  // where it waits beside the tray, which drinks from the top band down: load blue, then red, then
  // yellow (the yellow sits in the way at the start; step it aside first). Then ride across yourself
  // for the green on the far platform. Riding over before the three are loaded strands them.
  {
    id: 'ferry',
    name: 'Ferry',
    width: 30,
    height: 9,
    camera: 'scroll',
    hero: { x: 1, y: 4 },
    sandBoxes: [sb(24, 4, 3, 1, [[Y, 1], [R, 1], [B, 1]]), sb(27, 2, 1, 1, [[G, 1]])],
    walls: walls(
      '==============================',
      '.......=================......',
      '....=..================....#..',
      '.......================.......',
      '........................###...',
      '.......=================......',
      '.=..=..=================......',
      '.......=================......',
      '==============================',
    ),
    conveyors: [{ x: 7, y: 4, dir: 'right', length: 16, interval: 20 }],
    boxes: [
      bx('1x1', 5, 4, Y), // 0
      bx('1x1', 3, 6, R), // 1
      bx('1x1', 2, 2, B), // 2
      bx('1x1', 25, 6, G), // 3: on the far side
    ],
    hint: 'The ferry only goes one way. Load it in the order the tray drinks (top band first), and ride across yourself last.',
    solution: ['DRRRRU', 'LULUULDDLDRRRRR', 'DDDLLLUULURRRR', 'UULDLDRR', 'R', 'URRRRDDLLLDRRDRUUU'],
  },
  //    012345678901234567890123456789
  //  0 ###=..........................
  //  1 ###=..........................
  //  2 ###=..........................
  //  3 ###=..........................
  //  4 ###=........@.................
  //  5 ###=....B...........Y.........
  //  6 ###=..........................
  //  7 ###=............#.............
  //  8 ###=...................=======
  //  9 ...RRRRRRRRRRRRRRRRRRRRRR=====
  // 10 .........#........#....RR=====
  // 11 RRR..........G.........=======
  // 12 .......................=======
  // Solution: The red line across the map is one container from the reservoir's catcher spot to the
  // sealed 2x2, and it is also a wall: north and south meet only where you split it. The two single
  // links (x=8 and x=17) are gates: push one out two cells, pass a box through the gap (each box
  // pops beside its station right by the gate), walk round and push the link back. Blue goes south
  // at the west gate; at the east gate the green goes north (open it upward), then the yellow south.
  // End in the south with every gate closed, and push the catcher up under the reservoir last.
  {
    id: 'long-chain-ii',
    name: 'Long Chain II',
    width: 30,
    height: 13,
    camera: 'scroll',
    hero: { x: 12, y: 4 },
    sandBoxes: [sb(0, 0, 3, 9, [[R, 27]]), sb(9, 10, 1, 1, [[B, 1]]), sb(18, 10, 1, 1, [[Y, 1]]), sb(16, 7, 1, 1, [[G, 1]])],
    walls: walls(
      '###=..........................',
      '###=..........................',
      '###=..........................',
      '###=..........................',
      '###=..........................',
      '###=..........................',
      '###=..........................',
      '###=............#.............',
      '###=...................=======',
      '.........................=====',
      '.........#........#......=====',
      '.......................=======',
      '.......................=======',
    ),
    boxes: [
      bx('2x2', 23, 9, R), // 0: sealed at the far end
      bx('3x1', 3, 9, R), // 1
      bx('2x1', 6, 9, R), // 2
      bx('1x1', 8, 9, R), // 3: a gate link
      bx('3x1', 9, 9, R), // 4
      bx('3x1', 12, 9, R), // 5
      bx('2x1', 15, 9, R), // 6
      bx('1x1', 17, 9, R), // 7: a gate link
      bx('3x1', 18, 9, R), // 8
      bx('2x1', 21, 9, R), // 9
      bx('3x1', 0, 11, R), // 10: the catcher
      bx('1x1', 8, 5, B), // 11: north, belongs south
      bx('1x1', 20, 5, Y), // 12: north, belongs south
      bx('1x1', 13, 11, G), // 13: south, belongs north
    ],
    hint: 'The red line is one container and a wall. Split it at a single link to let a box through, then put the link back; the reservoir link goes in last.',
    solution: ['DDDDLLLLDD', 'UUUULUURDDDDD', 'DLDDRUU', 'DRRURRRRRRRUUU', 'DDD', 'LLLLLDRRRRDRUUUU', 'URUULDDD', 'DD', 'UUUURRRRULLLULDDDDD', 'DLDDRUU', 'DDLLLLLLLLLLLLLLLLUU'],
  },
  //    0123456789012345
  //  0 =====#=======#==
  //  1 =.............<=
  //  2 =....R........^=
  //  3 =.............^=
  //  4 ==#======#====^=
  //  5 =>...........=^=
  //  6 =^...........=t=
  //  7 =^............^=
  //  8 =^======#====#==
  //  9 =^=...........<=
  // 10 =p=..G........^=
  // 11 =^............^=
  // 12 ===#==========^=
  // 13 =.....R......=b=
  // 14 =......@.Y...=^=
  // 15 =.............^=
  // 16 ================
  // Solution: Four decks joined by one-way escalators (up-belts) that switch sides, each blocked by a
  // frozen plug sitting on it. Clearing a deck thaws the plug above-going: it rides up first and pops
  // under the sand box over the escalator's exit. A box the next deck needs has to go up the escalator
  // before you do: put the yellow on the first, the green on the second, then ride up yourself (the
  // ride pushes the waiting box off the landing). Ride up without it and it is stranded below.
  {
    id: 'switchback-decks',
    name: 'Switchback Decks',
    width: 16,
    height: 17,
    camera: 'rooms',
    hero: { x: 7, y: 14 },
    sandBoxes: [
      sb(3, 12, 1, 1, [[R, 1]]), // deck 1
      sb(13, 8, 1, 1, [[B, 1]]), // over the first escalator's exit
      sb(8, 8, 1, 1, [[Y, 1]]), // deck 2
      sb(2, 4, 1, 1, [[P, 1]]), // over the second escalator's exit
      sb(9, 4, 1, 1, [[G, 1]]), // deck 3
      sb(13, 0, 1, 1, [[T, 1]]), // over the third escalator's exit
      sb(5, 0, 1, 1, [[R, 1]]), // deck 4
    ],
    walls: walls(
      '=====#=======#==',
      '=..............=',
      '=..............=',
      '=..............=',
      '==#======#====.=',
      '=............=.=',
      '=............=.=',
      '=..............=',
      '=.======#====#==',
      '=.=............=',
      '=.=............=',
      '=..............=',
      '===#==========.=',
      '=............=.=',
      '=............=.=',
      '=..............=',
      '================',
    ),
    conveyors: [
      { x: 14, y: 15, dir: 'up', length: 6, interval: 20 },
      { x: 14, y: 9, dir: 'left', length: 1, interval: 20 },
      { x: 1, y: 11, dir: 'up', length: 6, interval: 20 },
      { x: 1, y: 5, dir: 'right', length: 1, interval: 20 },
      { x: 14, y: 7, dir: 'up', length: 6, interval: 20 },
      { x: 14, y: 1, dir: 'left', length: 1, interval: 20 },
    ],
    boxes: [
      bx('1x1', 14, 13, B, 1), // 0: plug on the first escalator
      bx('1x1', 6, 13, R), // 1
      bx('1x1', 9, 14, Y), // 2: needed on deck 2
      bx('1x1', 1, 10, P, 3), // 3: plug on the second escalator
      bx('1x1', 5, 10, G), // 4: needed on deck 3
      bx('1x1', 14, 6, T, 5), // 5: plug on the third escalator
      bx('1x1', 5, 2, R), // 6: deck 4
    ],
    hint: 'The escalators only go up. Clear a deck to thaw its escalator, and send up the box the next deck needs before you ride up yourself.',
    solution: ['ULLL', 'RRRRRDLDRRRRR', 'R', 'LLLL', 'LLLLDRDLLLL', 'L', 'RRRRRR', 'DDRRRRRR', 'DDLLLLLLLLU'],
  },
  //    01234567890123456789012345678901
  //  0 ................................
  //  1 ................................
  //  2 ...=...............Y............
  //  3 ......P..........=....###.......
  //  4 ..........@...........###.......
  //  5 .........=....B.......###.......
  //  6 ......................###.......
  //  7 .G=...................###.......
  //  8 =.==.=====.=====.=#===###=.=====
  //  9 =..................######=.=====
  // 10 ======================###=w=====
  // 11 RR====================###=.=====
  // 12 RRRRR.RRRRR.RRRRR.RRRR...=.=====
  // 13 =====.=====.=====.====...#.=====
  // 14 ....=...R.=...R.=...R.......RRR.
  // 15 ................................
  // force: #0->right
  // force: G at (1,7) right (the engine, parked against its alcove wall)
  // Solution: North: the thrust lane. Kick each box against its pillar and drop it into the right
  // opening (purple east, blue middle, yellow west: the tray takes purple, blue, yellow), then drop
  // the engine in: it collects all three and feeds the tray, and catches its own green last. Those
  // four pops thaw the white bulkhead in the east corridor: push it down beside its sand and go
  // through into the south hall. There the long red line from the sealed 2x2 to the reservoir has
  // three gaps over openings: kick each spare red against a pillar under a gap and up into it, then
  // push the catcher west and kick it up under the reservoir: 27 cells of red fill as one.
  {
    id: 'expedition',
    name: 'Expedition',
    width: 32,
    height: 16,
    camera: 'scroll',
    hero: { x: 10, y: 4 },
    sandBoxes: [
      sb(22, 3, 3, 9, [[R, 27]]), // the reservoir
      sb(19, 9, 3, 1, [[Y, 1], [B, 1], [P, 1]]), // the thrust lane's tray
      sb(18, 8, 1, 1, [[G, 1]]), // the engine's station, over the front cell
      sb(25, 13, 1, 1, [[W, 1]]), // the bulkhead's sand
    ],
    walls: walls(
      '................................',
      '................................',
      '...=............................',
      '.................=....###.......',
      '......................###.......',
      '.........=............###.......',
      '......................###.......',
      '..=...................###.......',
      '=.==.=====.=====.=#===###=.=====',
      '=..................######=.=====',
      '======================###=.=====',
      '..====================###=.=====',
      '.........................=.=====',
      '=====.=====.=====.====...#.=====',
      '....=.....=.....=...............',
      '...........................#....',
    ),
    boxes: [
      dv('1x1', 1, 7, G, 'right'), // 0: the engine, parked against its alcove wall
      bx('1x1', 6, 3, P), // 1
      bx('1x1', 14, 5, B), // 2
      bx('1x1', 19, 2, Y), // 3
      bx('1x1', 26, 10, W, 4), // 4: the bulkhead in the east corridor
      bx('2x2', 0, 11, R), // 5: sealed at the west end of the red line
      bx('3x1', 2, 12, R), // 6
      bx('1x1', 6, 12, R), // 7
      bx('3x1', 7, 12, R), // 8
      bx('1x1', 10, 12, R), // 9
      bx('3x1', 12, 12, R), // 10
      bx('2x1', 15, 12, R), // 11
      bx('3x1', 18, 12, R), // 12
      bx('1x1', 21, 12, R), // 13
      bx('1x1', 20, 14, R), // 14: spare
      bx('1x1', 14, 14, R), // 15: spare
      bx('1x1', 8, 14, R), // 16: spare
      bx('3x1', 28, 14, R), // 17: the catcher
    ],
    hint: 'North first: the engine feeds the tray in the order you load the lane, and those pops thaw the bulkhead. Then kick the spare reds into the gaps of the long line and the catcher in last.',
    solution: ['LLLLLUKRURRRRRRRRRRRDDDDDD', 'UUULKLULLLLLDDDD', 'UUUURRRRRRRRURRUKLULLLLLLLLLLLLLLLLDDDDDDD', 'UULLLDD', 'UUUUURRRURRRRRRRRRRRRRRRRRRRRRDDDDDRDDDDD', 'DDLLLLLKLDLLLLKU', 'LLUKLDLLLLKU', 'LLUKLDLLLLKU', 'RRRRRRRRRRRRRRRRRRRRRRRRRRULLLLLLDLLKU'],
  },
];
