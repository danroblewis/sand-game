// CLI: npx vite-node scripts/generate.ts <difficulty> <count> [startSeed] [flags]
//   --gravity   box-gravity levels (shafts, trays, ledges)
//   --hero      hero (Sokoban) levels: solutions are U/D/L/R input strings, drags = pushes
//   --big       with --hero: big maps (Expedition; zones over a hub strip, camera scroll/rooms)
//   --quiet     only print the summary (and failing levels)
//   --replay    re-check: replay each accepted solution through the real simulation again
//               (redundant: acceptance already requires a physics win; this guards determinism)
//   --diagnose  print sim vs heuristic-model state after every drag of the solution
//   --seeds=N   with --replay: also replay with N-1 other sim seeds (robustness, informational)
//   --calibrate print single-dock probes (sim grains taken vs the heuristic model's estimate) and
//               exit; use it to re-fit the constants in src/levels/solver.ts after core changes
// Prints generated levels (ASCII), drag counts, greedy result, timing and acceptance rate.
// Generation time includes the physics verification.
import { describeLevel, generateLevelWithStats, replayInSim } from '../src/levels/generate';
import { boxOpenings, drainStack, makeStack, modelTrace, type ModelState } from '../src/levels/solver';
import { SHAPES } from '../src/core/shapes';
import { createGame, stepGame, pullReach } from '../src/core';
import type { ShapeName } from '../src/core/types';
import { GRAINS_PER_UNIT } from '../src/core/types';
import type { GameState, LevelDef } from '../src/core/types';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--'));
const difficulty = Number(pos[0] ?? 5);
const count = Number(pos[1] ?? 5);
const start = Number(pos[2] ?? 1);
const replay = flags.has('--replay');
const quiet = flags.has('--quiet');
const diagnose = flags.has('--diagnose');
const seedsArg = args.find((a) => a.startsWith('--seeds='));
const extraSeeds = seedsArg ? Math.max(1, Number(seedsArg.slice(8))) : 1;

const cells = (g: number) => (g / GRAINS_PER_UNIT).toFixed(2);

function simLines(state: GameState): string[] {
  const out = state.boxes.map(
    (b) =>
      `  box#${b.id} ${b.shape.padEnd(4)} c${b.color} @${b.x},${b.y} ${b.state === 'removed' ? 'REMOVED' : `fill ${cells(b.region.count)}`}${b.frozen ? ` frozen ${b.frozen}` : ''}`,
  );
  state.sandBoxes.forEach((s, k) => {
    const m = new Map<number, number>();
    for (const v of s.region.cells) if (v) m.set(v & 31, (m.get(v & 31) ?? 0) + 1);
    out.push(`  sand${k + 1}: ` + [...m].sort((a, b) => a[0] - b[0]).map(([c, n]) => `c${c}=${cells(n)}`).join(' '));
  });
  return out;
}

function modelLines(level: LevelDef, st: ModelState): string[] {
  const out = level.boxes.map((b, i) => {
    const f = Math.max(0, (b.frozen ?? 0) - st.done);
    return `  box#${i} ${b.shape.padEnd(4)} c${b.color} @${st.xs[i]},${st.ys[i]} ${st.alive[i] ? `fill ${cells(st.fill[i])}` : 'REMOVED'}${f ? ` frozen ${f}` : ''}`;
  });
  st.sand.forEach((stack, k) => {
    const m = new Map<number, number>();
    for (let i = 0; i < stack.length; i += 2) m.set(stack[i] & 31, (m.get(stack[i] & 31) ?? 0) + stack[i + 1]);
    const layers = [];
    for (let i = 0; i < stack.length; i += 2) layers.push(`c${stack[i] & 31}${stack[i] > 31 ? '*' : ''}:${cells(stack[i + 1])}`);
    out.push(`  sand${k + 1}: ` + [...m].sort((a, b) => a[0] - b[0]).map(([c, n]) => `c${c}=${cells(n)}`).join(' ') + `   [${layers.join(' ')}]`);
  });
  return out;
}

function diagnoseLevel(level: LevelDef, path: string[]): void {
  const model: string[][] = [];
  const ok = modelTrace(level, path, (_step, st) => model.push(modelLines(level, st)));
  console.log(`model predicts: ${ok ? 'win' : 'no win'}`);
  let i = 0;
  const res = replayInSim(level, path, {
    onStep: (step, state) => {
      const sim = simLines(state);
      const mod = model[i++] ?? [];
      console.log(`-- after ${step}`);
      sim.forEach((l, j) => {
        const same = l.replace(/\s+\[.*$/, '') === (mod[j] ?? '').replace(/\s+\[.*$/, '');
        console.log(`${same ? ' ' : '!'} sim  ${l.padEnd(46)} model ${mod[j] ?? ''}`);
      });
    },
  });
  console.log(`diagnose result: ${res.won ? 'won' : res.reason}`);
}

/** Single-dock probes: one sand box (layers bottom first), one box; sim vs model. */
function calibrate(): void {
  console.log(`pull reach ${pullReach()} fine cells`);
  type P = [string, number, number, [number, number][], ShapeName, number, number, number];
  // [label, w, h, layers, shape, dx, dy (box offset from the sand box's top-left), color]
  const probes: P[] = [];
  for (const [w, h] of [[1, 3], [2, 2], [2, 3], [3, 2], [3, 3]]) {
    const n = w * h;
    const lay: [number, number][] = [[1, Math.floor(n / 2)], [2, n - Math.floor(n / 2)]]; // full: 1 below 2
    const half: [number, number][] = [[1, Math.floor(n / 4) || 0.5], [2, Math.floor(n / 4) || 0.5]]; // half full
    probes.push([`${w}x${h} full top`, w, h, lay, w >= 2 ? '2x1' : '1x1', 0, -1, 2]);
    probes.push([`${w}x${h} half top`, w, h, half, w >= 2 ? '2x1' : '1x1', 0, -1, 2]);
    probes.push([`${w}x${h} full below`, w, h, lay, w >= 3 ? '3x1' : w === 2 ? '2x2' : '1x2', 0, h, 1]);
    probes.push([`${w}x${h} full below 1col`, w, h, lay, '1x2', 0, h, 1]);
    for (let r = 0; r < h; r++) {
      probes.push([`${w}x${h} full side row${r} top-layer`, w, h, lay, '1x2', w, r, 2]);
      probes.push([`${w}x${h} full side row${r} buried`, w, h, lay, '1x2', w, r, 1]);
      probes.push([`${w}x${h} half side row${r} top-layer`, w, h, half, '1x2', w, r, 2]);
    }
  }
  for (const [label, w, h, layers, shape, dx, dy, color] of probes) {
    const sb = { x: 3, y: 3, w, h, layers: layers.map(([c, a]) => ({ color: c, amount: a })) };
    const box = { shape, x: 3 + dx, y: 3 + dy, color };
    const level: LevelDef = { id: 'cal', name: 'cal', width: 10, height: 11, sandBoxes: [sb], boxes: [box, { shape: '1x1', x: 9, y: 0, color: 9 }] };
    const st = createGame(level, 1);
    let quiet = 0;
    let last = -1;
    let t = 0;
    for (; t < 60 * 60 && quiet < 180; t++) {
      stepGame(st);
      const c = st.boxes[0].state === 'removed' ? -1 : st.boxes[0].region.count;
      quiet = c === last ? quiet + 1 : 0;
      last = c;
    }
    const b = st.boxes[0];
    const sim = b.state === 'removed' ? b.region.capacity : b.region.count;
    const stack = makeStack(sb.layers);
    const ops = boxOpenings(level, SHAPES[shape], box.x, box.y).flatMap(([, o]) => o);
    const model = drainStack(stack, ops, color, SHAPES[shape].length * GRAINS_PER_UNIT);
    console.log(`${label.padEnd(34)} ${shape.padEnd(4)} sim ${cells(sim)}${b.state === 'removed' ? ' (full)' : '       '} model ${cells(model)}  ${(t / 60).toFixed(1)}s`);
  }
}
if (flags.has('--calibrate')) {
  calibrate();
  process.exit(0);
}

const reasons: Record<string, number> = {};
const templates: Record<string, number> = {};
let totalAttempts = 0;
let totalMs = 0;
let maxMs = 0;
const times: number[] = [];
const drags: number[] = [];
let fallbacks = 0;
let replayFails = 0;
let simMs = 0;
let seedWins = 0;
let seedRuns = 0;
let replaysTotal = 0;
const simSecs: number[] = [];
for (let seed = start; seed < start + count; seed++) {
  const t0 = performance.now();
  const res = generateLevelWithStats(seed, { difficulty, reasons, gravity: flags.has('--gravity'), hero: flags.has('--hero'), big: flags.has('--big') });
  if (res.template) templates[res.template] = (templates[res.template] ?? 0) + 1;
  replaysTotal += res.replays;
  simSecs.push(res.simSteps / 60);
  const ms = performance.now() - t0;
  totalAttempts += res.attempts;
  totalMs += ms;
  maxMs = Math.max(maxMs, ms);
  times.push(ms);
  drags.push(res.solution.moves);
  if (res.difficulty !== difficulty) fallbacks++;
  let rep = '';
  if (replay) {
    const t1 = performance.now();
    const r = replayInSim(res.level, res.solution.path);
    simMs += performance.now() - t1;
    rep = r.reason;
    if (!r.won) replayFails++;
    for (let k = 2; k <= extraSeeds; k++) {
      seedRuns++;
      if (replayInSim(res.level, res.solution.path, { simSeed: k }).won) seedWins++;
    }
  }
  if (!quiet || rep) {
    console.log(
      `\n== ${res.level.id} (${res.level.width}x${res.level.height}) drags=${res.solution.moves} greedy=${res.greedy} ` +
        `attempts=${res.attempts} replays=${res.replays} sim=${(res.simSteps / 60).toFixed(0)}s gatesAt=${res.difficulty}${res.template ? ` template=${res.template}` : ''} ${ms.toFixed(0)}ms${replay ? (rep ? ` REPLAY FAIL: ${rep}` : ' replay=win') : ''}`,
    );
    console.log(describeLevel(res.level));
    if (res.level.hint) console.log(`hint: ${res.level.hint}`);
    console.log('solution: ' + res.solution.path.join(', '));
    if (diagnose) diagnoseLevel(res.level, res.solution.path);
  }
}
times.sort((a, b) => a - b);
console.log(
  `\ndifficulty ${difficulty}: ${count} levels, acceptance ${((count / totalAttempts) * 100).toFixed(1)}% ` +
    `(${totalAttempts} attempts), time median ${times[times.length >> 1].toFixed(0)}ms max ${maxMs.toFixed(0)}ms ` +
    `mean ${(totalMs / count).toFixed(0)}ms, mean drags ${(drags.reduce((a, b) => a + b, 0) / count).toFixed(1)}, ` +
    `fallbacks ${fallbacks}, physics replays ${replaysTotal} (${(replaysTotal / count).toFixed(1)}/level), ` +
    `solution sim time mean ${(simSecs.reduce((a, b) => a + b, 0) / count).toFixed(0)}s` +
    `${replay ? `, re-check failures ${replayFails}, re-check mean ${(simMs / count).toFixed(0)}ms` : ''}` +
    `${seedRuns ? `, other sim seeds win ${seedWins}/${seedRuns}` : ''}`,
);
const per = Object.entries(reasons).filter(([k]) => k.startsWith('@') && !k.endsWith('Ms'));
console.log('rejections: ' + JSON.stringify(Object.fromEntries(Object.entries(reasons).filter(([k]) => !k.startsWith('@')))));
if (per.length) {
  const byT: Record<string, Record<string, number>> = {};
  for (const [k, n] of per) {
    const [t, r] = k.slice(1).split(':');
    (byT[t] ??= {})[r] = n;
  }
  for (const [t, rs] of Object.entries(byT)) console.log(`  template ${t}: ${JSON.stringify(rs)}`);
}
if (Object.keys(templates).length) console.log('templates: ' + JSON.stringify(templates));
