// Hero-level plan search (level design aid for chapter 3 "Pusher").
// Usage: npx vite-node scripts/hero-plan.ts <level-id> [entries...] :: <goal> [<goal>...]
//   goal: "i:x,y" (box #i at x,y) or "h:x,y" (hero at x,y); several goals must all hold.
// Replays the given entries in the real simulation (seed 7), then breadth-first searches hero inputs
// on an abstract copy of the board (positions only: walls, sand boxes, boxes; frozen boxes are fixed;
// the same push / fall / climb rules as src/core/hero.ts) and prints the shortest input string.
// It knows nothing about sand: pin the positions of boxes that must not move (extra goals), then
// prove the result with the replay. In zsh pass multi-goal strings unquoted or with ${=var}.
// --kick also searches kicks (K + direction: the box slides until blocked, the hero stays).
import { getLevel } from '../src/levels';
import { replayLevel } from '../src/levels/replay';
import { SHAPES } from '../src/core/shapes';
const kicks = process.argv.includes('--kick');
const args = process.argv.slice(2).filter((a) => a !== '--kick');
const sep = args.indexOf('::');
const [id, ...entries] = sep < 0 ? args : args.slice(0, sep);
const goals = sep < 0 ? [] : args.slice(sep + 1);
const level = getLevel(id)!;
const r = replayLevel(level, entries, { seed: 7 });
const st = r.state;
if (r.why && !r.why.startsWith('plan finished')) { console.log('replay failed:', r.why); process.exit(1); }
const W = st.width, H = st.height, grav = st.boxGravity;
const fixed = new Set<number>();
for (const w of st.walls) fixed.add(w.y * W + w.x);
for (const s of st.sandBoxes) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) fixed.add(y * W + x);
const act = st.boxes.filter((b) => b.state === 'active');
const frozen = act.filter((b) => b.frozen > 0);
for (const b of frozen) for (const c of b.cells) fixed.add((b.y + c.y) * W + b.x + c.x); // frozen = fixed (abstract)
const mov = act.filter((b) => b.frozen === 0);
const cells = mov.map((b) => SHAPES[b.shape]);
type S = { hx: number; hy: number; p: number[] }; // p: x,y per movable box
const key = (s: S) => `${s.hx},${s.hy}|${s.p.join(',')}`;
function occ(s: S, skip = -1): Set<number> {
  const o = new Set<number>();
  for (let i = 0; i < mov.length; i++) if (i !== skip) for (const c of cells[i]) o.add((s.p[2 * i + 1] + c.y) * W + s.p[2 * i] + c.x);
  return o;
}
const free = (o: Set<number>, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !fixed.has(y * W + x) && !o.has(y * W + x);
function fits(s: S, i: number, x: number, y: number, heroBlocks: boolean) {
  const o = occ(s, i);
  for (const c of cells[i]) {
    const gx = x + c.x, gy = y + c.y;
    if (!free(o, gx, gy)) return false;
    if (heroBlocks && gx === s.hx && gy === s.hy) return false;
  }
  return true;
}
function settleGrav(s: S) {
  if (!grav) return;
  for (let moved = true; moved; ) {
    moved = false;
    const order = mov.map((_, i) => i).sort((a, b) => s.p[2 * b + 1] - s.p[2 * a + 1]);
    for (const i of order) if (fits(s, i, s.p[2 * i], s.p[2 * i + 1] + 1, true)) { s.p[2 * i + 1]++; moved = true; }
    if (free(occ(s), s.hx, s.hy + 1)) { s.hy++; moved = true; }
  }
}
const D: Record<string, [number, number]> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
function step(s0: S, d: string): S | null {
  if (grav && (d === 'U' || d === 'D')) return null;
  const s: S = { hx: s0.hx, hy: s0.hy, p: s0.p.slice() };
  const [dx, dy] = D[d];
  const tx = s.hx + dx, ty = s.hy + dy;
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
  const o = occ(s);
  if (free(o, tx, ty)) { s.hx = tx; s.hy = ty; settleGrav(s); return s; }
  const i = mov.findIndex((_, k) => cells[k].some((c) => s.p[2 * k] + c.x === tx && s.p[2 * k + 1] + c.y === ty));
  if (i >= 0 && fits(s, i, s.p[2 * i] + dx, s.p[2 * i + 1] + dy, false)) {
    s.p[2 * i] += dx; s.p[2 * i + 1] += dy; s.hx = tx; s.hy = ty; settleGrav(s); return s;
  }
  if (grav && free(o, tx, ty - 1) && free(o, s.hx, s.hy - 1)) { s.hx = tx; s.hy = ty - 1; settleGrav(s); return s; }
  return null;
}
/** Kick (DESIGN.md "Kick"): the adjacent box slides in `d` until blocked; under gravity it stops as
 *  soon as it is unsupported after a slide step and then falls. The hero stays put. */
function kick(s0: S, d: string): S | null {
  if (grav && (d === 'U' || d === 'D')) return null;
  if (grav && free(occ(s0), s0.hx, s0.hy + 1)) return null; // can't kick in mid-air
  const [dx, dy] = D[d];
  const tx = s0.hx + dx, ty = s0.hy + dy;
  const i = mov.findIndex((_, k) => cells[k].some((c) => s0.p[2 * k] + c.x === tx && s0.p[2 * k + 1] + c.y === ty));
  if (i < 0 || !fits(s0, i, s0.p[2 * i] + dx, s0.p[2 * i + 1] + dy, true)) return null;
  const s: S = { hx: s0.hx, hy: s0.hy, p: s0.p.slice() };
  while (fits(s, i, s.p[2 * i] + dx, s.p[2 * i + 1] + dy, true)) {
    s.p[2 * i] += dx; s.p[2 * i + 1] += dy;
    if (grav && fits(s, i, s.p[2 * i], s.p[2 * i + 1] + 1, true)) break;
  }
  settleGrav(s);
  return s;
}
const goalFns = goals.map((g) => {
  const [who, xy] = g.split(':'); const [gx, gy] = xy.split(',').map(Number);
  if (who === 'h') return (s: S) => s.hx === gx && s.hy === gy;
  const bi = mov.findIndex((b) => b.id === +who);
  if (bi < 0) throw new Error(`box ${who} not movable/active`);
  return (s: S) => s.p[2 * bi] === gx && s.p[2 * bi + 1] === gy;
});
const start: S = { hx: st.hero!.x, hy: st.hero!.y, p: mov.flatMap((b) => [b.x, b.y]) };
const prev = new Map<string, [string, string]>([[key(start), ['', '']]]);
const q: S[] = [start];
for (let qi = 0; qi < q.length && qi < 3_000_000; qi++) {
  const s = q[qi];
  if (goalFns.every((f) => f(s))) {
    let k = key(s); let path = '';
    while (prev.get(k)![0]) { const [pk, d] = prev.get(k)!; path = d + path; k = pk; }
    console.log(path || '(already there)');
    process.exit(0);
  }
  for (const d of 'UDLR') {
    for (const [n, label] of [[step(s, d), d], [kicks ? kick(s, d) : null, 'K' + d]] as [S | null, string][]) {
      if (!n) continue;
      const k = key(n);
      if (prev.has(k)) continue;
      prev.set(k, [key(s), label]);
      q.push(n);
    }
  }
}
console.log('no plan found');
