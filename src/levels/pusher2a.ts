// Chapter 4 "Pusher II", part A: hero (Sokoban) levels. Owned by one designer agent;
// appended into LEVELS by index.ts. Keep ids unique across the whole campaign.
//
// Part A: fifteen floating (no box gravity) hero levels, one Sokoban idea each, rising in
// difficulty, ending with a finale that combines several. Map legend as in index.ts: # sand box,
// capital letter = box, lower-case = frozen box, = wall, @ hero, . empty. Every solution is proven
// by tests/levels-physics.test.ts (three seeds, plus a slow walk so no entry races the sand).
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

/** Wall cells read from a map: every '=' in the rows (cells separated by single spaces). */
const walls = (...rows: string[]) =>
  rows.flatMap((row, y) => row.split(' ').flatMap((c, x) => (c === '=' ? [{ x, y }] : [])));

export const PUSHER2A: LevelDef[] = [
  //   . . . . . . .
  //   . = = = . = .
  //   . = = # . = .
  //   . = = # . = .
  //   . . . B . = .
  //   = = = . = = .
  //   = = = R = = .
  //   = . . . . . .
  //   = . . @ . . .
  // Solution: The blue sits under the sand box but red is the bottom layer. Go round to the right
  // and push the blue left into the alcove, push the red up the corridor to catch, then come in by
  // the alcove's back door and push the blue back under the sand.
  {
    id: 'corridor-swap',
    name: 'Corridor Swap',
    width: 7,
    height: 9,
    hero: { x: 3, y: 8 },
    sandBoxes: [sb(3, 2, 1, 2, [[R, 1], [B, 1]])],
    walls: walls(
      '. . . . . . .',
      '. = = = . = .',
      '. = = # . = .',
      '. = = # . = .',
      '. . . B . = .',
      '= = = . = = .',
      '= = = R = = .',
      '= . . . . . .',
      '= . . @ . . .',
    ),
    boxes: [bx('1x1', 3, 4, B), bx('1x1', 3, 6, R)],
    hint: 'The red has to get past the blue in a one-wide corridor. Push the blue aside into the alcove, let the red by, then bring the blue back.',
    solution: ['URRRUUUUUUULLDDDDL', 'RUUUURRDDDDDDDLLLUU', 'URUUUULLLLDDDDRR'],
  },
  //   = = # = = = =
  //   = = # = # = =
  //   = = . . . = =
  //   = = . . . = =
  //   = = = . = = =
  //   . . . B . . .
  //   . . . R Y . .
  //   @ . . . . . .
  // Solution: A box through the door can only go up and sideways, never back out. The blue sits in
  // front of the door but red is the bottom of its sand box: push the blue aside, send the red in
  // and left, the yellow in and right, then the blue in and left.
  {
    id: 'one-way-door',
    name: 'One-Way Door',
    width: 7,
    height: 8,
    hero: { x: 0, y: 7 },
    sandBoxes: [sb(2, 0, 1, 2, [[R, 1], [B, 1]]), sb(4, 1, 1, 1, [[Y, 1]])],
    walls: walls(
      '= = # = = = =',
      '= = # = # = =',
      '= = . . . = =',
      '= = . . . = =',
      '= = = . = = =',
      '. . . B . . .',
      '. . . R Y . .',
      '@ . . . . . .',
    ),
    boxes: [bx('1x1', 3, 5, B), bx('1x1', 3, 6, R), bx('1x1', 4, 6, Y)],
    hint: 'Whatever you push through the door stays in: it can go up and sideways but never back out. Send each box in only when its layer is at the bottom of its sand box.',
    solution: ['UURRRLDDRUUUURUL', 'DDDDDRRULDLUUUULUR', 'DDDDRRULDLUUURUL'],
  },
  //   . @ . . . . . .
  //   . R R . # # . .
  //   . . R . # # . .
  //   . . R . # # . .
  //   . . . = . . . .
  //   . . . = . . . .
  //   . . . . B B . .
  //   . . . . . . . .
  //   . . . . . . . .
  //   . . . . . . . .
  // Solution: Pushed straight right, the L's long arm would lie against the sand box and drink only
  // a wedge of the buried red. Take it down past the pillar, right, and up under the sand box so its
  // short arm and corner cover the bottom. Keep the blue out of that spot until the red is gone.
  {
    id: 'turn-the-l',
    name: 'Turn the L',
    width: 8,
    height: 10,
    hero: { x: 1, y: 0 },
    sandBoxes: [sb(4, 1, 2, 3, [[R, 4], [B, 2]])],
    walls: walls(
      '. @ . . . . . .',
      '. R R . # # . .',
      '. . R . # # . .',
      '. . R . # # . .',
      '. . . = . . . .',
      '. . . = . . . .',
      '. . . . B B . .',
      '. . . . . . . .',
      '. . . . . . . .',
      '. . . . . . . .',
    ),
    boxes: [bx('L180', 1, 1, R), bx('2x1', 4, 6, B)],
    hint: 'A box drinks with whatever side touches the sand. From the side, the L touches the buried red; from below, its top arm covers the whole bottom. Walk it round.',
    solution: ['DDDDDDLDRRRURURRRDLLLLDDRUUU', 'DDLLLLURRRDRUU'],
  },
  //   = = = # = = =
  //   = = = # = = =
  //   = = = . = = =
  //   = = = w = = =
  //   = . . . . . =
  //   # . Y G R . #
  //   = . . . . . =
  //   = . . @ . . =
  // Solution: The frozen white plugs the only way to the sand box above it and needs two pops. Only
  // the red and the yellow can pop out here, and each has to cross the other's path to its own
  // side. Then push the white up to catch, and the green after it.
  {
    id: 'two-keys',
    name: 'Two Keys',
    width: 7,
    height: 8,
    hero: { x: 3, y: 7 },
    sandBoxes: [sb(3, 0, 1, 2, [[W, 1], [G, 1]]), sb(0, 5, 1, 1, [[R, 1]]), sb(6, 5, 1, 1, [[Y, 1]])],
    walls: walls(
      '= = = # = = =',
      '= = = # = = =',
      '= = = . = = =',
      '= = = w = = =',
      '= . . . . . =',
      '# . Y G R . #',
      '= . . . . . =',
      '= . . @ . . =',
    ),
    boxes: [bx('1x1', 3, 3, W, 2), bx('1x1', 2, 5, Y), bx('1x1', 3, 5, G), bx('1x1', 4, 5, R)],
    hint: 'The frozen box is a door that opens after two pops. Only two boxes here can pop before it opens: find them.',
    solution: ['UUDLLUURDLDRRRDRU', 'ULLL', 'URU', 'DDRRULDLUU'],
  },
  //   = # = . . . . .
  //   = # = . = = = .
  //   = # = . = = = .
  //   = . R Y B . . .
  //   = = = . = . . .
  //   = = = . . . . .
  //   = = = = . . . .
  //   = = = = . . @ .
  // Solution: The three cars are jammed: you can only ever push the last one, into the one ahead.
  // Go round to the crossing and drop the yellow into the pocket, then push the red into the dock.
  // Run the blue out into the yard, lift the yellow back up from the pocket's back door, drive it
  // in, and bring the blue home last.
  {
    id: 'train',
    name: 'Train',
    width: 8,
    height: 8,
    hero: { x: 6, y: 7 },
    sandBoxes: [sb(1, 0, 1, 3, [[R, 1], [Y, 1], [B, 1]])],
    walls: walls(
      '= # = . . . . .',
      '= # = . = = = .',
      '= # = . = = = .',
      '= . R Y B . . .',
      '= = = . = . . .',
      '= = = . . . . .',
      '= = = = . . . .',
      '= = = = . . @ .',
    ),
    boxes: [bx('1x1', 2, 3, R), bx('1x1', 3, 3, Y), bx('1x1', 4, 3, B)],
    hint: 'Only the last car of a train can be pushed, and only into the car ahead. Break the train: park the middle car in the pocket so you can stand behind the front one.',
    solution: ['UUUURUUULLLLDDDL', 'RRRDDLLUDRRUULLL', 'RRRDRRULLLLL'],
  },
  //   . # . = . # .
  //   . # . = . # .
  //   . . . . . . .
  //   . . . = . = .
  //   . R . = . Y .
  //   . . . = . . .
  //   . B . = . G .
  //   . . . @ . . .
  // Solution: On the left, push the red and then the blue straight up under the sand box. The right
  // half is the same but for one wall under its sand box: there each box has to go up the inner
  // column and be pushed in sideways from the doorway, and you get back round by the bottom door.
  {
    id: 'mirror',
    name: 'Mirror',
    width: 7,
    height: 8,
    hero: { x: 3, y: 7 },
    sandBoxes: [sb(1, 0, 1, 2, [[R, 1], [B, 1]]), sb(5, 0, 1, 2, [[Y, 1], [G, 1]])],
    walls: walls(
      '. # . = . # .',
      '. # . = . # .',
      '. . . . . . .',
      '. . . = . = .',
      '. R . = . Y .',
      '. . . = . . .',
      '. B . = . G .',
      '. . . @ . . .',
    ),
    boxes: [bx('1x1', 1, 4, R), bx('1x1', 1, 6, B), bx('1x1', 5, 4, Y), bx('1x1', 5, 6, G)],
    hint: 'The two halves are mirror images except for one wall. What works on the left will not work on the right: find another way in.',
    solution: ['RUURRULDLUUDDDDLLUULUU', 'URRR', 'DDDRRDLDLUUUUDDDDLLLUUUU', 'URRR'],
  },
  //   . . . . . . .
  //   . . . . . R .
  //   . . . . . R .
  //   . . # # = . .
  //   . = # # . . .
  //   . . # # . . .
  //   . . = = . . .
  //   . G . . . B .
  //   . G . . . B .
  //   . . . @ . . .
  // Solution: Walls leave one way in for each band: the red top band only from the left, the green
  // middle band only from the right, the blue bottom band from the side last (the floor is walled).
  // Circle the island and feed it top to bottom, keeping each box off the sides it should not touch.
  {
    id: 'island',
    name: 'Island',
    width: 7,
    height: 10,
    hero: { x: 3, y: 9 },
    sandBoxes: [sb(2, 3, 2, 3, [[B, 2], [G, 2], [R, 2]])],
    walls: walls(
      '. . . . . . .',
      '. . . . . R .',
      '. . . . . R .',
      '. . # # = . .',
      '. = # # . . .',
      '. . # # . . .',
      '. . = = . . .',
      '. G . . . B .',
      '. G . . . B .',
      '. . . @ . . .',
    ),
    boxes: [bx('1x2', 5, 1, R), bx('1x2', 1, 7, G), bx('1x2', 5, 7, B)],
    hint: 'The island can be fed from three sides, but the walls decide which layer each side reaches. Top band first, each from a side at its height, and the bottom one last.',
    solution: ['RRUURUUUUUULLLLULD', 'DDLDDDDDRRRDRUUU', 'DRRUL'],
  },
  //   = = = # = = =
  //   # # = # = = =
  //   . . . . . . .
  //   . . = Y R . .
  //   . . . = . . .
  //   . . . . . . .
  //   . . . . Y Y .
  //   . . . . . . @
  // Solution: The yellow box is walled in under the sand box's lane and cannot move. Push the yellow
  // bar into the lane under the sand box: touching yellows are one container, so the yellow falls
  // through the bar into the box below. Then pull the plug: push the bar left out of the lane, the
  // full box pops alone, and the bar ends under the other yellow sand box. Then catch the red.
  {
    id: 'seal-unseal',
    name: 'Seal and Unseal',
    width: 7,
    height: 8,
    hero: { x: 6, y: 7 },
    sandBoxes: [sb(3, 0, 1, 2, [[Y, 1], [R, 1]]), sb(0, 1, 2, 1, [[Y, 2]])],
    walls: walls(
      '= = = # = = =',
      '# # = # = = =',
      '. . . . . . .',
      '. . = Y R . .',
      '. . . = . . .',
      '. . . . . . .',
      '. . . . Y Y .',
      '. . . . . . @',
    ),
    boxes: [bx('1x1', 3, 3, Y), bx('2x1', 4, 6, Y), bx('1x1', 4, 3, R)],
    hint: 'Touching boxes of one color are one container. Plug the bar in over the walled-in yellow so the sand runs through it, then pull the plug out: a full box pops once it is alone.',
    solution: ['UUUUULLDDRDLLDDRUUUUDDDLLLURRRDRUURUUL', 'LLL', 'RDRDRURULL'],
  },
  //   = = = = = . .
  //   = = = # . . .
  //   = = . # = . .
  //   = = . # = . .
  //   = = . # = R .
  //   . . . # = . .
  //   . G . = = . .
  //   . . B . . . .
  //   . . B = K . .
  //   @ . . = . . .
  // Solution: One tall sand box, four bands. The red top band can only be reached from the right,
  // at its height; then the blue (two cells deep) from the left with the bar; then the green, then
  // the pink at the bottom, each one a step lower as the pile drops. Wait for each band to drain
  // before docking the next box, and keep the doorway clear: you need it to get to the far side.
  {
    id: 'patience',
    name: 'Patience',
    width: 7,
    height: 10,
    hero: { x: 0, y: 9 },
    sandBoxes: [sb(3, 1, 1, 5, [[K, 1], [G, 1], [B, 2], [R, 1]])],
    walls: walls(
      '= = = = = . .',
      '= = = # . . .',
      '= = . # = . .',
      '= = . # = . .',
      '= = . # = R .',
      '. . . # = . .',
      '. G . = = . .',
      '. . B . . . .',
      '. . B = K . .',
      '@ . . = . . .',
    ),
    boxes: [bx('1x1', 5, 4, R), bx('1x2', 2, 7, B), bx('1x1', 1, 6, G), bx('1x1', 4, 8, K)],
    hint: 'Patience: a box on the side drains the band at its height only once everything above it is gone. Dock each box one step lower as the pile drops, and keep the doorway clear.',
    solution: ['RRUURRRUUUUURUL', 'DDDDDDDDLURULLLUUU', 'DLLDDRULURDRU', 'DLDDRUU'],
  },
  //   = = # # = = #
  //   . . . . . . #
  //   . . . . . . .
  //   # . . . . . .
  //   . . . = . . .
  //   . . R . B . .
  //   . . R R R . .
  //   . . = . . . .
  //   . . . . . . @
  // Solution: The two reds touch, so they are one container: docked together they would share the
  // sand and never fill. They can only be split from the pocket between them, and the blue blocks the
  // way in. Push the blue into the pocket, push the bar down off the pair, then the post up out of
  // the way so you can free the blue; each red then catches alone.
  {
    id: 'split-decision',
    name: 'Split Decision',
    width: 7,
    height: 9,
    hero: { x: 6, y: 8 },
    sandBoxes: [sb(2, 0, 2, 1, [[R, 2]]), sb(6, 0, 1, 2, [[R, 2]]), sb(0, 3, 1, 1, [[B, 1]])],
    walls: walls(
      '= = # # = = #',
      '. . . . . . #',
      '. . . . . . .',
      '# . . . . . .',
      '. . . = . . .',
      '. . R . B . .',
      '. . R R R . .',
      '. . = . . . .',
      '. . . . . . @',
    ),
    boxes: [bx('1x2', 2, 5, R), bx('2x1', 3, 6, R), bx('1x1', 4, 5, B)],
    hint: 'Touching boxes of one color are one container: split the pair before either one docks. The only place to split them from is the pocket they wrap around.',
    solution: ['UUULLDLLURDRUURULLL', 'DLLDDRRRRRDDLUUDRRUUU', 'DLLLDLUUUULLUR'],
  },
  //   # . . . . . .
  //   . . . . G . .
  //   = = = w = = =
  //   . . . . . . #
  //   . . . . . . .
  //   = = = y = = =
  //   # . . . . . .
  //   . . . . . R .
  //   . . . @ . . #
  // Solution: Three rooms, two frozen doors. Only the red can pop at first; its pop thaws the yellow
  // door (1), which you push up into the middle room to its sand. That second pop thaws the white
  // door (2): push it up into the top room, then bring the green all the way down to the bottom.
  {
    id: 'layered-lock',
    name: 'Layered Lock',
    width: 7,
    height: 9,
    hero: { x: 3, y: 8 },
    sandBoxes: [sb(0, 0, 1, 1, [[W, 1]]), sb(6, 3, 1, 1, [[Y, 1]]), sb(0, 6, 1, 1, [[R, 1]]), sb(6, 8, 1, 1, [[G, 1]])],
    walls: walls(
      '# . . . . . .',
      '. . . . G . .',
      '= = = w = = =',
      '. . . . . . #',
      '. . . . . . .',
      '= = = y = = =',
      '# . . . . . .',
      '. . . . . R .',
      '. . . @ . . #',
    ),
    boxes: [bx('1x1', 5, 7, R), bx('1x1', 3, 5, Y, 1), bx('1x1', 3, 2, W, 2), bx('1x1', 4, 1, G)],
    hint: 'Each frozen door opens after a number of pops, and only one box can pop at a time. Work out the order: every pop unlocks the next room.',
    solution: ['RRURULLLL', 'RUULURR', 'LUURURRDLLULL', 'RDDDDDDDLDRR'],
  },
  //   = . . = = . . .
  //   = . . . . . . .
  //   = . = # . . . .
  //   = . = # = . B .
  //   . . = # = . Y @
  //   . . . . = . R .
  //   = = = . = . . .
  //   = = = . . . . .
  // Solution: The corridor spirals in to the sand box at its heart, one cell wide except for a
  // turning bay at each corner. Drain the blue top band from the yard side first, then send the
  // red (bottom band) round the spiral, then the yellow; leave by the back passage each time.
  {
    id: 'spiral',
    name: 'Spiral',
    width: 8,
    height: 8,
    hero: { x: 7, y: 4 },
    sandBoxes: [sb(3, 2, 1, 3, [[R, 1], [Y, 1], [B, 1]])],
    walls: walls(
      '= . . = = . . .',
      '= . . . . . . .',
      '= . = # . . . .',
      '= . = # = . B .',
      '. . = # = . Y @',
      '. . . . = . R .',
      '= = = . = . . .',
      '= = = . . . . .',
    ),
    boxes: [bx('1x1', 6, 3, B), bx('1x1', 6, 4, Y), bx('1x1', 6, 5, R)],
    hint: 'The corridor winds inwards one cell wide; use the bay at each corner to turn a box. The top band can be drained from the yard; the others only from the heart of the spiral, bottom band first.',
    solution: ['DLDLUUUURRDDLURULL', 'RULLLLULDDDDLDRR', 'RDDRRUUUUURULLLLULDDDDLDRR'],
  },
  //   . . . . . . . =
  //   . R = . . . . =
  //   . . = . . = . #
  //   . . . . . = . #
  //   . = = = . = = =
  //   . . . . . . . .
  //   . . G . . . . .
  //   @ . . . . . . .
  // Solution: The track zigzags under and over two barriers. Each box goes down from the first hole
  // above, right under the first barrier, up from the hole below, right over the second barrier and
  // down from the last hole above into the dock. Red docks first at the top band, then green below.
  {
    id: 'switchback',
    name: 'Switchback',
    width: 8,
    height: 8,
    hero: { x: 0, y: 7 },
    sandBoxes: [sb(7, 2, 1, 2, [[G, 1], [R, 1]])],
    walls: walls(
      '. . . . . . . =',
      '. R = . . . . =',
      '. . = . . = . #',
      '. . . . . = . #',
      '. = = = . = = =',
      '. . . . . . . .',
      '. . G . . . . .',
      '@ . . . . . . .',
    ),
    boxes: [bx('1x1', 1, 1, R), bx('1x1', 2, 6, G)],
    hint: 'The track weaves under one barrier and over the next, so every box has to be pushed down, then up, then down again. Find the hole above or below for each turn.',
    solution: ['UUUUUUURDDLDRRRLLLDDDRRRURUUULURRURD', 'LLDDDDLDDRUUUUULURRURDD'],
  },
  //   = # # = # = # =
  //   = . . = # = . =
  //   = . . = . = . =
  //   . . . = . = . #
  //   . . . . . . . .
  //   . B B . B . . .
  //   . . . . . . # R
  //   . B . B . . # .
  //   . B . B B . # .
  //   . . . . . . . @
  // Solution: Four blue boxes, three alcoves under the blue sand boxes at the top. Each alcove fits
  // one shape: the bar under the wide one, the post in the deep slot, the cube in the shallow one. A
  // wrong shape there catches only part of the sand and stalls. The hook is the odd one out: it
  // hugs the tall column at the bottom right, foot underneath, back against its side. The red is
  // odd one out in color only: push it straight up under its own little sand box first.
  {
    id: 'odd-one-out',
    name: 'Odd One Out',
    width: 8,
    height: 10,
    hero: { x: 7, y: 9 },
    sandBoxes: [sb(1, 0, 2, 1, [[B, 2]]), sb(4, 0, 1, 2, [[B, 2]]), sb(6, 0, 1, 1, [[B, 1]]), sb(6, 6, 1, 3, [[B, 3]]), sb(7, 3, 1, 1, [[R, 1]])],
    walls: walls(
      '= # # = # = # =',
      '= . . = # = . =',
      '= . . = . = . =',
      '. . . = . = . #',
      '. . . . . . . .',
      '. B B . B . . .',
      '. . . . . . # R',
      '. B . B . . # .',
      '. B . B B . # .',
      '. . . . . . . @',
    ),
    boxes: [bx('1x1', 4, 5, B), bx('2x1', 1, 5, B), bx('1x2', 1, 7, B), bx('S', 3, 7, B), bx('1x1', 7, 6, R)],
    hint: 'Four of the boxes are blue, but each alcove fits only one shape: a box that covers part of a sand box catches part of it and stalls. One box fits none of them. Find where it belongs.',
    solution: ['UUUU', 'LLDLLDLDRR', 'UULLUUUU', 'DDDRRDLLLLDDRRRDRUUUUU', 'DDRULURDRUUU'],
  },
  //   = = # = = = = =
  //   = = # = = = = =
  //   = = . . . = = =
  //   = = . . . = = =
  //   = = = w = = = #
  //   # . . . . . . #
  //   # . . . . = . .
  //   . . . . R . B @
  //   . . . . R R R .
  //   . . . . = . . .
  //   . . . . . . . .
  // Solution: Everything at once. The two reds are joined and must be split from the pocket the blue
  // guards: push the blue into the pocket, the bar down, the post left, and free the blue. Dock each
  // red at its own sand box (two pops thaw the white door). Push the white through the door, up and
  // left under the sand box; the blue follows it in once the white has caught. Through the door
  // there is no way back.
  {
    id: 'last-push',
    name: 'Last Push',
    width: 8,
    height: 11,
    hero: { x: 7, y: 7 },
    sandBoxes: [sb(2, 0, 1, 2, [[W, 1], [B, 1]]), sb(0, 5, 1, 2, [[R, 2]]), sb(7, 4, 1, 2, [[R, 2]])],
    walls: walls(
      '= = # = = = = =',
      '= = # = = = = =',
      '= = . . . = = =',
      '= = . . . = = =',
      '= = = w = = = #',
      '# . . . . . . #',
      '# . . . . = . .',
      '. . . . R . B @',
      '. . . . R R R .',
      '. . . . = . . .',
      '. . . . . . . .',
    ),
    boxes: [bx('1x2', 4, 7, R), bx('2x1', 5, 8, R), bx('1x1', 6, 7, B), bx('1x1', 3, 4, W, 2)],
    hint: 'Split the joined reds from their pocket, dock each one alone, and the white door thaws. Behind the door nothing comes back out: the white goes in first, the blue after it.',
    solution: ['LDLLLDDRRURRULLDDLLUUUDDLUURUL', 'URR', 'LUURUL', 'DDDRRRDDLLDLUUUUURUL'],
  },
];
