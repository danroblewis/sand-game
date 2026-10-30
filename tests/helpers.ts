import type { GameState, LevelDef, SandRegion } from '../src/core';
import { stepGame } from '../src/core';

export function level(partial: Partial<LevelDef>): LevelDef {
  return { id: 't', name: 'test', width: 6, height: 6, sandBoxes: [], boxes: [], ...partial };
}

export function totalGrains(state: GameState, includeRemoved = false): number {
  let n = 0;
  for (const sb of state.sandBoxes) n += sb.region.count;
  for (const b of state.boxes) if (includeRemoved || b.state === 'active') n += b.region.count;
  return n;
}

/** Grains per color over every region (removed boxes included: their sand is kept). */
export function colorTotals(state: GameState): number[] {
  const t = new Array(32).fill(0);
  const add = (r: SandRegion) => {
    for (let i = 0; i < r.cells.length; i++) if (r.cells[i]) t[r.cells[i] & 31]++;
  };
  for (const sb of state.sandBoxes) add(sb.region);
  for (const b of state.boxes) add(b.region);
  return t;
}

/** Step until pred() holds; returns the number of steps taken, or -1 if max was hit first. */
export function runUntil(s: GameState, pred: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    stepGame(s);
  }
  return pred() ? max : -1;
}

/** Step until `value()` has not changed for `quiet` steps (or max steps). Returns steps taken. */
export function runUntilStable(s: GameState, value: () => number, quiet: number, max: number): number {
  let last = value();
  let still = 0;
  for (let i = 0; i < max; i++) {
    stepGame(s);
    const v = value();
    if (v === last) {
      if (++still >= quiet) return i + 1;
    } else {
      still = 0;
      last = v;
    }
  }
  return max;
}

const SYM: Record<number, string> = { 1: 'r', 2: 'o', 3: 'y', 4: 'g', 5: 't', 6: 'B', 7: 'i', 8: 'p' };

/** ASCII picture of a region: one character per fine column, every `rowStep`-th row. */
export function ascii(r: SandRegion, rowStep = 2): string {
  let s = '';
  for (let y = 0; y < r.h; y += rowStep) {
    let line = '|';
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      const v = r.cells[i];
      line += r.mask && !r.mask[i] ? ' ' : v ? (SYM[v & 31] ?? '#') : '.';
    }
    s += line + '|\n';
  }
  return s;
}

/** Surface height (in fine cells) of each column of a region. */
export function columnHeights(r: SandRegion): number[] {
  const out: number[] = [];
  for (let x = 0; x < r.w; x++) {
    let h = 0;
    for (let y = 0; y < r.h; y++)
      if (r.cells[y * r.w + x]) {
        h = r.h - y;
        break;
      }
    out.push(h);
  }
  return out;
}
