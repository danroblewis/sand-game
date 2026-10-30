// Physics lab: tiny levels that measure how the real sand simulation delivers sand to boxes.
// Usage: npx vite-node scripts/physics-lab.ts [experiment-name]
// Prints, for each experiment, the fill of each box (in cells) and what is left in each sand box
// after every drag has settled. The rules of thumb at the top of src/levels/index.ts come from here.
import type { BoxDef, ConveyorDef, LevelDef, ShapeName } from '../src/core/types';
import { describeState, replayLevel } from '../src/levels/replay';

const R = 1, O = 2, Y = 3, G = 4, B = 6;
type L = [number, number][];
const lvl = (w: number, h: number, sb: [number, number, number, number, L][], boxes: BoxDef[], conveyors: ConveyorDef[] = []): LevelDef => ({
  id: 'lab', name: 'lab', width: w, height: h, conveyors,
  sandBoxes: sb.map(([x, y, sw, sh, layers]) => ({ x, y, w: sw, h: sh, layers: layers.map(([color, amount]) => ({ color, amount })) })),
  boxes,
});
const box = (shape: ShapeName, x: number, y: number, color: number, frozen?: number): BoxDef => ({ shape, x, y, color, ...(frozen ? { frozen } : {}) });

function run(name: string, level: LevelDef, plan: string[]) {
  const only = process.argv[2];
  if (only && !name.startsWith(only)) return;
  console.log(`\n## ${name}`);
  const r = replayLevel(level, plan, {
    onDrag: (step, state, s) => console.log(`  ${step.padEnd(16)} +${(s / 60).toFixed(1)}s  ${describeState(state)}`),
  });
  console.log(`  -> ${r.won ? 'WON' : 'not won'} ${r.why} total ${(r.steps / 60).toFixed(1)}s`);
}

// A. Box on top of a 2-wide sand box of height H filled with red to various levels.
for (const h of [1, 2, 3, 4]) {
  for (const fill of [1, 0.75, 0.5, 0.25]) {
    const amt = 2 * h * fill;
    // sand box sits on the board floor (rows 10-h..9); the box docks on its top edge
    run(`A top h=${h} fill=${fill} (red ${amt})`, lvl(6, 10, [[2, 10 - h, 2, h, [[R, amt]]]], [box('2x1', 0, 0, R)]), [`box#0 -> (2,${9 - h})`]);
  }
}

// B. Side box at each row of a 2x3 sand box with three 1-row layers (bottom blue, red, green top).
for (const row of [0, 1, 2]) {
  for (const color of [G, R, B]) {
    run(`B side row=${row} color=${'?R?YG?B'[color]}`, lvl(6, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x1', 5, 0, color)]), [`box#0 -> (2,${4 + row})`]);
  }
}

// C. Remnants: side box takes the middle red, then a top box takes green, then the red box again.
run('C buried remnant', lvl(6, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 3, 0, R), box('2x1', 4, 1, G), box('2x1', 0, 0, B)]), [
  'box#0 -> (2,5)', 'box#1 -> (0,3)', 'box#0 -> (2,6)', 'box#2 -> (2,6)',
]);
// C2. Top layer first from above, then the next layer from above.
run('C2 peel from top (3 tall)', lvl(6, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 3, 0, G), box('2x1', 4, 1, R), box('2x1', 0, 0, B)]), [
  'box#0 -> (0,3)', 'box#1 -> (0,3)', 'box#2 -> (0,3)',
]);
// D. Two same-color boxes sharing one red layer from the two sides.
run('D share two sides', lvl(6, 8, [[2, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x1', 0, 0, R), box('1x1', 5, 0, R), box('1x2', 0, 1, G), box('1x2', 5, 1, B)]), [
  'box#0 -> (1,5)', 'box#1 -> (4,5)', 'box#2 -> (1,3)', 'box#3 -> (4,6)',
]);
// E. Box below catches the bottom layer by gravity.
for (const color of [B, R]) {
  run(`E below color=${'?R?YG?B'[color]}`, lvl(6, 8, [[2, 1, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 0, 7, color)]), ['box#0 -> (2,4)']);
}
// E2. Box below catches, then the layers above fall into it in turn.
run('E2 below catches in turn', lvl(6, 8, [[2, 1, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 0, 7, B), box('2x1', 4, 7, R), box('2x1', 0, 6, G)]), [
  'box#0 -> (2,4)', 'box#1 -> (2,4)', 'box#2 -> (2,4)',
]);
// F. Side box low (floor row) vs high on a 1-wide tall column.
for (const row of [0, 1, 2, 3]) {
  run(`F column side row=${row}`, lvl(6, 8, [[0, 3, 1, 4, [[R, 1], [Y, 1], [R, 1], [G, 1]]]], [box('1x1', 5, 0, R)]), [`box#0 -> (1,${3 + row})`]);
}
// G. Wide sand box (4x2): side box 1x1 at bottom row gets the bottom layer? and 1x2 covering both rows.
run('G wide side bottom row 1x1', lvl(7, 8, [[0, 5, 4, 2, [[B, 4], [R, 4]]]], [box('1x1', 6, 0, B)]), ['box#0 -> (4,6)']);
run('G wide side 1x2 red', lvl(7, 8, [[0, 5, 4, 2, [[B, 4], [R, 4]]]], [box('1x2', 6, 0, R)]), ['box#0 -> (4,5)']);
run('G wide top 3x1 red', lvl(7, 8, [[0, 5, 4, 2, [[B, 4], [R, 4]]]], [box('3x1', 4, 0, R)]), ['box#0 -> (0,4)']);
// H. Reach across a wide sand box: one 1x1 box beside / on top / below a 4-wide single layer.
for (const amt of [1, 2, 4]) {
  run(`H wide side floor 4x1 red=${amt}`, lvl(7, 8, [[0, 6, 4, 1, [[R, amt]]]], [box('1x1', 6, 0, R), box('1x1', 6, 2, R), box('1x1', 6, 4, R), box('1x1', 5, 1, R)].slice(0, amt)), ['box#0 -> (4,6)']);
}
run('H top 1x1 over 4x2 red 4', lvl(7, 8, [[0, 6, 4, 2, [[R, 4]]]], [box('2x2', 5, 0, R)]), ['box#0 -> (0,4)']);
run('H top 1x1 corner over 3x1 full', lvl(7, 8, [[0, 6, 3, 1, [[R, 3]]]], [box('1x3', 6, 0, R)]), ['box#0 -> (0,3)']);
// I. Funnel: a box below one column of a wider sand box.
run('I below 1 col of 3x2 red 6 (1x1 boxes)', lvl(7, 9, [[0, 0, 3, 2, [[R, 6]]]], [box('1x1', 6, 8, R), box('1x1', 5, 8, R), box('1x1', 4, 8, R), box('1x1', 6, 6, R), box('1x1', 5, 6, R), box('1x1', 4, 6, R)]), [
  'box#0 -> (1,2)', 'box#1 -> (1,2)', 'box#2 -> (1,2)', 'box#3 -> (1,2)', 'box#4 -> (1,2)', 'box#5 -> (1,2)',
]);
run('I below 3x1 under 3x2 two layers', lvl(7, 9, [[0, 0, 3, 2, [[B, 3], [R, 3]]]], [box('3x1', 4, 8, B), box('3x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('I below 1x1 under 3x2 two layers', lvl(7, 9, [[0, 0, 3, 2, [[B, 3], [R, 3]]]], [box('3x1', 4, 8, B), box('3x1', 4, 6, R)]), ['box#0 -> (1,2)', 'box#1 -> (0,2)']);
// J. Side box at the top layer height when the sand box is taller (air above).
run('J side top-layer 2x3 half full', lvl(6, 8, [[0, 4, 2, 3, [[B, 2], [R, 2]]]], [box('1x1', 5, 0, R), box('1x1', 5, 2, R)]), ['box#0 -> (2,5)', 'box#1 -> (2,4)']);
run('J side above pile', lvl(6, 8, [[0, 4, 2, 3, [[B, 2], [R, 2]]]], [box('1x2', 5, 0, R)]), ['box#0 -> (2,4)']);
// K. Two same-color boxes stacked: one below the sand box, one below that box.
run('K chain below', lvl(6, 9, [[2, 0, 2, 2, [[R, 4]]]], [box('2x1', 0, 8, R), box('2x1', 4, 8, R)]), ['box#0 -> (2,3)', 'box#1 -> (2,2)']);
// L. 1-wide column (4 tall) half full of yellow on red: top vs side docking speed.
run('L column top 1x2', lvl(5, 9, [[1, 3, 1, 4, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (1,1)']);
run('L column side 1x2 at top layer', lvl(5, 9, [[1, 3, 1, 4, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (2,4)']);
run('L column side 1x1 at top layer', lvl(5, 9, [[1, 3, 1, 4, [[R, 2], [Y, 2]]]], [box('1x1', 4, 0, Y), box('1x1', 4, 2, Y)]), ['box#0 -> (2,4)', 'box#1 -> (2,5)']);
run('L column side 1x2 above pile', lvl(5, 9, [[1, 3, 1, 4, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (2,3)']);
run('L column 2-wide side 1x2 at top layer', lvl(5, 9, [[0, 3, 2, 4, [[R, 4], [Y, 4]]]], [box('1x2', 4, 0, Y), box('1x2', 4, 5, Y)]), ['box#0 -> (2,3)', 'box#1 -> (2,4)']);
run('M lanes column 6 tall side', lvl(7, 10, [[1, 2, 1, 6, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (0,4)']);
run('M lanes column 6 tall side right', lvl(7, 10, [[1, 2, 1, 6, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (2,4)']);
run('M lanes column 6 tall side one higher', lvl(7, 10, [[1, 2, 1, 6, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y)]), ['box#0 -> (2,3)']);
run('N sleep then side dock', lvl(7, 10, [[1, 2, 1, 6, [[R, 2], [Y, 2]]]], [box('1x2', 4, 0, Y), box('1x1', 6, 9, G)]), ['box#1 -> (5,9)', 'box#1 -> (6,9)', 'box#0 -> (0,4)']);
run('N sleep then side dock long path', lvl(7, 10, [[1, 2, 1, 6, [[R, 2], [Y, 2]]]], [box('1x2', 4, 4, Y)]), ['box#0 -> (4,8)', 'box#0 -> (0,4)']);

// ---- 3-grain reach era (2026-10-30) ----
// P. Side drain of the top layer for 1/2/3-wide sand boxes (2 rows: blue bottom row, red top row).
for (const w of [1, 2, 3]) {
  run(`P side top w=${w}`, lvl(7, 8, [[0, 4, w, 2, [[B, w], [R, w]]]], [box(w === 1 ? '1x1' : w === 2 ? '2x1' : '3x1', 4, 0, R)].map((b) => ({ ...b, shape: '1x1' as ShapeName })).concat(w > 1 ? [box('1x1', 6, 0, R)] : []).concat(w > 2 ? [box('1x1', 6, 2, R)] : [])), [`box#0 -> (${w},4)`].concat(w > 1 ? [`box#1 -> (${w},4)`] : []).concat(w > 2 ? [`box#2 -> (${w},4)`] : []));
  run(`P side top w=${w} tall box`, lvl(7, 8, [[0, 4, w, 2, [[B, w], [R, w]]]], [box('1x2', 6, 0, R)].slice(0, 1)), [`box#0 -> (${w},3)`]);
}
// Q. Wedge at a buried layer (2-wide, 3 rows: B / R / G), side box at the red row, then green taken.
run('Q wedge buried then expose', lvl(7, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 4, 0, R), box('1x2', 6, 0, G)]), ['box#0 -> (2,5)', 'box#1 -> (2,3)']);
// R. 1x3 and L beside a 1-row layer.
run('R 1x3 beside 1-row top layer', lvl(7, 9, [[0, 5, 2, 3, [[B, 2], [Y, 2], [R, 2]]]], [box('1x3', 6, 0, R)]), ['box#0 -> (2,3)']);
run('R 1x3 covering top layer row', lvl(7, 9, [[0, 5, 2, 3, [[B, 2], [Y, 2], [R, 2]]]], [box('1x3', 6, 0, R)]), ['box#0 -> (2,4)']);
run('R L0 foot at layer', lvl(7, 9, [[0, 5, 2, 3, [[B, 2], [Y, 2], [R, 4]]]], [box('L0', 4, 0, R)]), ['box#0 -> (2,3)']);
run('R J180 hook top corner', lvl(7, 9, [[1, 5, 2, 3, [[B, 2], [Y, 2], [R, 4]]]], [box('J180', 4, 0, R)]), ['box#0 -> (3,4)']);
// S. Bottom catch: full vs partial coverage, two layers.
run('S below full width 2', lvl(7, 9, [[0, 0, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 4, 8, B), box('2x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('S below half width 2', lvl(7, 9, [[0, 0, 2, 2, [[B, 2], [R, 2]]]], [box('1x2', 4, 7, B), box('2x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('S below 3-wide with 2x1', lvl(7, 9, [[0, 0, 3, 2, [[B, 3], [R, 3]]]], [box('S90', 4, 7, B), box('3x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('S below J0 catch', lvl(7, 9, [[0, 0, 2, 2, [[R, 4]]]], [box('J0', 4, 6, R)]), ['box#0 -> (0,2)']);
run('S below L90 catch', lvl(7, 9, [[0, 0, 3, 2, [[R, 4], [B, 2]]]], [box('L90', 4, 7, R)]), ['box#0 -> (0,2)']);
// T. Top box on a brim-full vs 3/4-full sand box.
run('T top brim full', lvl(7, 9, [[0, 5, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 4, 0, R)]), ['box#0 -> (0,4)']);
// U. Sharing: two same-color 1x1 on the two sides of the top layer; box stacked under a box.
run('U share sides', lvl(7, 9, [[2, 5, 2, 3, [[B, 4], [R, 2]]]], [box('1x1', 0, 0, R), box('1x1', 6, 0, R)]), ['box#0 -> (1,5)', 'box#1 -> (4,5)']);
run('U stacked boxes below', lvl(7, 9, [[2, 0, 2, 2, [[R, 4]]]], [box('2x1', 0, 8, R), box('2x1', 4, 8, R)]), ['box#0 -> (2,3)', 'box#1 -> (2,2)']);
// V. Side at a layer after the bottom was caught (pile dropped): dock low.
run('V side after drop', lvl(7, 9, [[0, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 4, 8, B), box('1x1', 6, 0, G), box('1x1', 6, 2, G), box('1x2', 4, 5, R)]), ['box#0 -> (0,3)', 'box#1 -> (2,2)', 'box#2 -> (2,2)', 'box#3 -> (2,1)']);
run('Q2 expose: green 1x2 at its row+below, then red', lvl(7, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 4, 0, R), box('1x2', 6, 0, G)]), ['box#0 -> (2,5)', 'box#1 -> (2,4)']);
run('Q3 expose: green first, red after', lvl(7, 8, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 4, 0, R), box('1x2', 6, 0, G)]), ['box#1 -> (2,4)', 'box#0 -> (2,5)']);
run('Q4 peel down the side 1x2s', lvl(7, 9, [[0, 4, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 4, 0, G), box('1x2', 5, 0, R), box('1x2', 6, 0, B)]), ['box#0 -> (2,4)', 'box#1 -> (2,5)', 'box#2 -> (2,6)']);
// W. Debris (completion slack leaves up to 0.1 cell behind): does it block the next layer?
run('W1 below then below', lvl(7, 9, [[0, 0, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 4, 8, B), box('2x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('W2 below then side at floor', lvl(7, 9, [[0, 0, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 4, 8, B), box('1x2', 6, 4, R)]), ['box#0 -> (0,2)', 'box#1 -> (2,1)']);
run('W3 side top then below', lvl(7, 9, [[0, 0, 2, 2, [[B, 2], [R, 2]]]], [box('1x2', 6, 4, R), box('2x1', 4, 8, B)]), ['box#0 -> (2,0)', 'box#1 -> (0,2)']);
run('W4 column below then side', lvl(7, 9, [[0, 0, 1, 2, [[B, 1], [R, 1]]]], [box('1x1', 4, 8, B), box('1x1', 6, 4, R)]), ['box#0 -> (0,2)', 'box#1 -> (1,1)']);
run('W5 3 layers side peel', lvl(7, 9, [[0, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 6, 4, G), box('1x2', 5, 4, R), box('2x1', 4, 8, B)]), ['box#0 -> (2,0)', 'box#1 -> (2,1)', 'box#2 -> (0,3)']);
run('W6 3 layers: below, side, side', lvl(7, 9, [[0, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 4, 8, B), box('1x2', 6, 4, G), box('1x2', 5, 4, R)]), ['box#0 -> (0,3)', 'box#1 -> (2,1)', 'box#2 -> (2,1)']);
run('W7 same color twice below', lvl(7, 9, [[0, 0, 2, 2, [[R, 4]]]], [box('2x1', 4, 8, R), box('2x1', 4, 6, R)]), ['box#0 -> (0,2)', 'box#1 -> (0,2)']);
run('X1 G right side, R left side', lvl(7, 9, [[1, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 6, 4, G), box('1x2', 5, 4, R), box('2x1', 4, 8, B)]), ['box#0 -> (3,0)', 'box#1 -> (0,1)', 'box#2 -> (1,3)']);
run('X2 G right side, R right lower 1x2', lvl(7, 9, [[1, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 6, 4, G), box('1x2', 5, 4, R), box('2x1', 4, 8, B)]), ['box#0 -> (3,0)', 'box#1 -> (3,1)', 'box#2 -> (1,3)']);
run('X3 G 1x3 right covering 3 rows', lvl(7, 9, [[1, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 6, 4, G), box('1x2', 5, 4, R), box('2x1', 4, 8, B)]), ['box#0 -> (3,1)', 'box#1 -> (0,1)', 'box#2 -> (1,3)']);
run('X4 1-wide column 3 layers side peel', lvl(7, 9, [[1, 0, 1, 3, [[B, 1], [R, 1], [G, 1]]]], [box('1x1', 6, 4, G), box('1x1', 5, 4, R), box('1x1', 4, 8, B)]), ['box#0 -> (2,0)', 'box#1 -> (2,1)', 'box#2 -> (1,3)']);
run('X5 1-wide column 3 layers: below, side, side', lvl(7, 9, [[1, 0, 1, 3, [[B, 1], [R, 1], [G, 1]]]], [box('1x1', 4, 8, B), box('1x1', 6, 4, G), box('1x1', 5, 4, R)]), ['box#0 -> (1,3)', 'box#1 -> (2,1)', 'box#2 -> (2,2)']);
run('Y1 J0 beside tall column', lvl(7, 10, [[5, 0, 2, 9, [[G, 2], [Y, 12]]]], [box('J0', 0, 0, Y)]), ['box#0 -> (3,1)']);
run('Y2 1x3 beside tall column', lvl(7, 10, [[5, 0, 2, 9, [[G, 2], [Y, 12]]]], [box('1x3', 0, 0, Y)]), ['box#0 -> (4,1)']);
run('Y3 1x2 beside tall column', lvl(7, 10, [[5, 0, 2, 9, [[G, 2], [Y, 12]]]], [box('1x2', 0, 0, Y)]), ['box#0 -> (4,2)']);
run('Y4 J0 lower', lvl(7, 10, [[5, 0, 2, 9, [[G, 2], [Y, 12]]]], [box('J0', 0, 0, Y)]), ['box#0 -> (3,2)']);
run('Z1 2x2 side O top (R still below)', lvl(7, 9, [[0, 0, 2, 2, [[R, 2], [O, 2]]]], [box('2x2', 4, 4, 2)]), ['box#0 -> (2,0)']);
run('Z2 2x2 side O after R caught', lvl(7, 9, [[0, 0, 2, 2, [[R, 2], [O, 2]]]], [box('2x1', 4, 8, R), box('2x2', 4, 4, 2)]), ['box#0 -> (0,2)', 'box#1 -> (2,0)']);
run('Z3 1x2 side O after R caught', lvl(7, 9, [[0, 0, 2, 2, [[R, 2], [O, 2]]]], [box('2x1', 4, 8, R), box('1x2', 4, 4, 2)]), ['box#0 -> (0,2)', 'box#1 -> (2,0)']);
run('Z4 2x2 low side O after R caught', lvl(7, 9, [[0, 0, 2, 2, [[R, 2], [O, 2]]]], [box('2x1', 4, 8, R), box('2x2', 4, 4, 2)]), ['box#0 -> (0,2)', 'box#1 -> (2,1)']);

// ---- conveyors (2026-10-30) ----
// SA. Up belt under a 2-wide sand box: drop blue then red 2x1 on it.
run('SA up belt B then R', lvl(6, 10, [[2, 0, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 0, 9, B), box('2x1', 4, 9, R)], [{ x: 2, y: 9, dir: 'up', length: 7 }]), ['box#0 -> (2,9)', 'box#1 -> (2,9)']);
run('SA2 up belt queue loaded at once', lvl(6, 10, [[2, 0, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('2x1', 0, 9, B), box('2x1', 4, 9, R), box('2x1', 0, 8, G)], [{ x: 2, y: 9, dir: 'up', length: 6 }]), ['box#0 -> (2,8)', 'box#1 -> (2,9)', 'box#2 -> (2,9)']);
// SB. Left belt pressing 1x2 boxes against a sand box's side at the top two rows.
run('SB side belt', lvl(8, 6, [[0, 1, 2, 3, [[B, 2], [R, 2], [G, 2]]]], [box('1x2', 4, 4, G), box('1x2', 5, 4, R)], [{ x: 7, y: 1, dir: 'left', length: 5 }]), ['box#0 -> (6,1)', 'box#1 -> (7,1)']);
// SC. Frozen box on the belt holds the queue.
run('SC frozen on belt', lvl(6, 10, [[2, 0, 2, 2, [[B, 2], [R, 2]]]], [box('2x1', 2, 5, R, 1), box('2x1', 4, 9, B), box('1x1', 0, 0, G)], [{ x: 2, y: 9, dir: 'up', length: 7 }]), ['box#1 -> (2,9)']);
// AA. Five layers caught from below one after another (2-wide, 5 tall).
run('AA five catches', lvl(8, 11, [[3, 0, 2, 5, [[B, 2], [R, 2], [G, 2], [8, 2], [Y, 2]]]], [box('2x1', 0, 10, B), box('2x1', 0, 9, R), box('2x1', 0, 8, G), box('2x1', 6, 10, 8), box('2x1', 6, 9, Y)]), ['box#0 -> (3,5)', 'box#1 -> (3,5)', 'box#2 -> (3,5)', 'box#3 -> (3,5)', 'box#4 -> (3,5)']);
run('AA2 five catches with walls', { ...lvl(8, 11, [[3, 0, 2, 5, [[B, 2], [R, 2], [G, 2], [8, 2], [Y, 2]]]], [box('2x1', 0, 10, B), box('2x1', 0, 9, R), box('2x1', 0, 8, G), box('2x1', 6, 10, 8), box('2x1', 6, 9, Y)]), walls: [2, 5].flatMap((x) => [0, 1, 2, 3, 4, 5, 6, 7].map((y) => ({ x, y }))) }, ['box#0 -> (3,5)', 'box#1 -> (3,5)', 'box#2 -> (3,5)', 'box#3 -> (3,5)', 'box#4 -> (3,5)']);
run('AB four catches 2x4', lvl(8, 11, [[3, 0, 2, 4, [[B, 2], [R, 2], [G, 2], [Y, 2]]]], [box('2x1', 0, 10, B), box('2x1', 0, 9, R), box('2x1', 0, 8, G), box('2x1', 6, 9, Y)]), ['box#0 -> (3,4)', 'box#1 -> (3,4)', 'box#2 -> (3,4)', 'box#3 -> (3,4)']);
run('AC three catches 2x3', lvl(8, 11, [[3, 0, 2, 3, [[B, 2], [R, 2], [Y, 2]]]], [box('2x1', 0, 10, B), box('2x1', 0, 9, R), box('2x1', 6, 9, Y)]), ['box#0 -> (3,3)', 'box#1 -> (3,3)', 'box#2 -> (3,3)']);
run('AD 1-wide five catches', lvl(8, 11, [[3, 0, 1, 5, [[B, 1], [R, 1], [G, 1], [8, 1], [Y, 1]]]], [box('1x1', 0, 10, B), box('1x1', 0, 9, R), box('1x1', 0, 8, G), box('1x1', 6, 10, 8), box('1x1', 6, 9, Y)]), ['box#0 -> (3,5)', 'box#1 -> (3,5)', 'box#2 -> (3,5)', 'box#3 -> (3,5)', 'box#4 -> (3,5)']);
// AE. Group rule: two red 1x1 side by side under a 2-wide red sand box fill as one catcher.
run('AE group catcher', lvl(7, 9, [[0, 0, 2, 2, [[R, 2], [B, 2]]]], [box('1x1', 4, 8, R), box('1x1', 5, 8, R), box('2x1', 4, 6, B)]), ['box#0 -> (0,2)', 'box#1 -> (1,2)']);
run('AE2 one full red touching an empty red waits', lvl(7, 9, [[0, 0, 2, 1, [[R, 1]]]], [box('1x1', 4, 8, R), box('1x1', 5, 8, R)]), ['box#1 -> (5,7)', 'box#0 -> (0,1)', 'box#1 -> (1,1)', 'box#1 -> (1,3)']);
// Result (2026-10-30): sequential reds both fill (the second catches the rest); a grouped pair
// fed by the belt stalls at ~1.0 + 0.85 and never pops, so the group rule is not used in levels.
run('AF buddy sequential on a belt', { ...lvl(7, 8, [[3, 0, 2, 2, [[R, 2], [B, 2]]]], [box('1x1', 0, 5, R), box('1x1', 2, 6, R)], [{ x: 0, y: 2, dir: 'right', length: 5 }]), walls: [{ x: 5, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 }] }, ['box#0 -> (1,2)', 'box#1 -> (0,2)']);
run('AG buddy pair on a belt (grouped)', { ...lvl(7, 8, [[3, 0, 2, 2, [[R, 2], [B, 2]]]], [box('1x1', 0, 5, R), box('1x1', 2, 6, R)], [{ x: 0, y: 2, dir: 'right', length: 5 }]), walls: [{ x: 5, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 }] }, ['box#0 -> (1,2) &', 'box#1 -> (0,2)']);
