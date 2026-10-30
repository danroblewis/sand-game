import type { BoxDef, ColorId, LevelDef } from '../core/types';
import { SHAPES } from '../core/shapes';

const EPS = 1e-9;
const MIN_COLOR = 1;
const MAX_COLOR = 12;

/** Absolute grid cells occupied by a box definition. */
export function boxDefCells(box: BoxDef): { x: number; y: number }[] {
  const cells = SHAPES[box.shape];
  if (!cells) return [];
  return cells.map((c) => ({ x: box.x + c.x, y: box.y + c.y }));
}

/** Total box capacity per color, in grid-cell units (frozen boxes included). */
export function levelCapacityByColor(level: LevelDef): Map<ColorId, number> {
  const out = new Map<ColorId, number>();
  for (const b of level.boxes) {
    const n = SHAPES[b.shape]?.length ?? 0;
    out.set(b.color, (out.get(b.color) ?? 0) + n);
  }
  return out;
}

/** Total sand per color across all sand boxes, in grid-cell units. */
export function levelSandByColor(level: LevelDef): Map<ColorId, number> {
  const out = new Map<ColorId, number>();
  for (const sb of level.sandBoxes) {
    for (const l of sb.layers) out.set(l.color, (out.get(l.color) ?? 0) + l.amount);
  }
  return out;
}

const isInt = (n: number) => Number.isInteger(n);
const validColor = (c: number) => isInt(c) && c >= MIN_COLOR && c <= MAX_COLOR;

/** Returns human-readable problems with a level definition. Empty array = valid. */
export function validateLevel(level: LevelDef): string[] {
  const p: string[] = [];
  const tag = `level ${level.id ?? '?'}`;
  const W = level.width;
  const H = level.height;

  if (!level.id) p.push(`${tag}: missing id`);
  if (!level.name) p.push(`${tag}: missing name`);
  if (!(isInt(W) && isInt(H) && W > 0 && H > 0)) {
    p.push(`${tag}: board size must be positive integers (got ${W}x${H})`);
    return p;
  }
  if (!level.sandBoxes?.length) p.push(`${tag}: no sand boxes`);
  if (!level.boxes?.length) p.push(`${tag}: no boxes`);

  // Occupancy grid: '' empty, otherwise the label of the occupant.
  const owner: string[] = new Array(W * H).fill('');
  const claim = (x: number, y: number, label: string) => {
    const i = y * W + x;
    if (owner[i]) p.push(`${tag}: ${label} overlaps ${owner[i]} at (${x},${y})`);
    else owner[i] = label;
  };

  level.sandBoxes.forEach((sb, i) => {
    const label = `sandBox#${i}`;
    if (!(isInt(sb.x) && isInt(sb.y) && isInt(sb.w) && isInt(sb.h) && sb.w > 0 && sb.h > 0)) {
      p.push(`${tag}: ${label} has invalid geometry`);
      return;
    }
    if (sb.x < 0 || sb.y < 0 || sb.x + sb.w > W || sb.y + sb.h > H) {
      p.push(`${tag}: ${label} out of bounds`);
      return;
    }
    for (let y = sb.y; y < sb.y + sb.h; y++) for (let x = sb.x; x < sb.x + sb.w; x++) claim(x, y, label);

    if (!sb.layers?.length) p.push(`${tag}: ${label} has no layers`);
    let total = 0;
    sb.layers.forEach((l, j) => {
      if (!validColor(l.color)) p.push(`${tag}: ${label} layer ${j} color ${l.color} not in 1..12`);
      if (!(l.amount > 0)) p.push(`${tag}: ${label} layer ${j} amount must be > 0`);
      total += l.amount;
    });
    if (!(total > 0)) p.push(`${tag}: ${label} holds no sand`);
    if (total > sb.w * sb.h + EPS) p.push(`${tag}: ${label} overfilled (${total} > ${sb.w * sb.h})`);
  });

  const seenPos = new Set<string>();
  level.boxes.forEach((b, i) => {
    const label = `box#${i}(${b.shape}@${b.x},${b.y})`;
    if (!SHAPES[b.shape]) {
      p.push(`${tag}: ${label} unknown shape`);
      return;
    }
    if (!validColor(b.color)) p.push(`${tag}: ${label} color ${b.color} not in 1..12`);
    if (!(isInt(b.x) && isInt(b.y))) p.push(`${tag}: ${label} position must be integer`);
    const key = `${b.x},${b.y}`;
    if (seenPos.has(key)) p.push(`${tag}: ${label} duplicate box position`);
    seenPos.add(key);
    for (const c of boxDefCells(b)) {
      if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) {
        p.push(`${tag}: ${label} out of bounds at (${c.x},${c.y})`);
        continue;
      }
      // claim() reports overlaps with sand boxes and earlier boxes.
      claim(c.x, c.y, label);
    }
  });

  // Walls: single obstacle cells with no sand.
  (level.walls ?? []).forEach((w, i) => {
    const label = `wall#${i}(${w.x},${w.y})`;
    if (!(isInt(w.x) && isInt(w.y)) || w.x < 0 || w.y < 0 || w.x >= W || w.y >= H) {
      p.push(`${tag}: ${label} out of bounds`);
      return;
    }
    claim(w.x, w.y, label);
  });

  // Conveyors: a strip of `length` cells from (x, y) in `dir`. The whole strip must be on the board
  // and must not overlap sand boxes or other conveyors; boxes may start on a belt (belt cells are
  // walkable), and whatever lies beyond the strip end is fine.
  const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const belt = new Array<string>(W * H).fill('');
  (level.conveyors ?? []).forEach((cv, i) => {
    const label = `conveyor#${i}(${cv.dir}@${cv.x},${cv.y}x${cv.length})`;
    const d = DIRS[cv.dir];
    if (!d) {
      p.push(`${tag}: ${label} has an unknown direction`);
      return;
    }
    if (!(isInt(cv.length) && cv.length >= 1)) {
      p.push(`${tag}: ${label} length must be a positive integer`);
      return;
    }
    if (!(isInt(cv.x) && isInt(cv.y))) {
      p.push(`${tag}: ${label} position must be integer`);
      return;
    }
    for (let k = 0; k < cv.length; k++) {
      const x = cv.x + d[0] * k;
      const y = cv.y + d[1] * k;
      if (x < 0 || y < 0 || x >= W || y >= H) {
        p.push(`${tag}: ${label} runs out of bounds at (${x},${y})`);
        return;
      }
      const o = owner[y * W + x];
      if (o.startsWith('sandBox') || o.startsWith('wall')) p.push(`${tag}: ${label} overlaps ${o} at (${x},${y})`);
      if (belt[y * W + x]) p.push(`${tag}: ${label} overlaps ${belt[y * W + x]} at (${x},${y})`);
      else belt[y * W + x] = label;
    }
  });

  // Conservation per color.
  const cap = levelCapacityByColor(level);
  const sand = levelSandByColor(level);
  const colors = new Set<ColorId>([...cap.keys(), ...sand.keys()]);
  for (const c of colors) {
    const a = sand.get(c) ?? 0;
    const b = cap.get(c) ?? 0;
    if (Math.abs(a - b) > EPS) p.push(`${tag}: color ${c} sand ${a} != box capacity ${b}`);
  }

  // Frozen counters: each must be reachable. Iteratively thaw boxes whose counter can be met by
  // the number of boxes that could have been completed before them.
  const frozenCounts: number[] = [];
  let available = 0;
  level.boxes.forEach((b, i) => {
    if (b.frozen === undefined || b.frozen === 0) {
      available++;
      return;
    }
    if (!(isInt(b.frozen) && b.frozen > 0)) {
      p.push(`${tag}: box#${i} frozen must be a positive integer (got ${b.frozen})`);
      return;
    }
    if (b.frozen > level.boxes.length - 1) {
      p.push(`${tag}: box#${i} frozen ${b.frozen} exceeds number of other boxes`);
    }
    frozenCounts.push(b.frozen);
  });
  frozenCounts.sort((a, b) => a - b);
  for (const f of frozenCounts) {
    if (f <= available) available++;
    else {
      p.push(`${tag}: a frozen box needs ${f} completions but only ${available} boxes can complete first`);
      break;
    }
  }

  return p;
}

/** Validates a list of levels including unique ids. */
export function validateLevels(levels: LevelDef[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const l of levels) {
    if (ids.has(l.id)) out.push(`duplicate level id ${l.id}`);
    ids.add(l.id);
    out.push(...validateLevel(l));
  }
  return out;
}
