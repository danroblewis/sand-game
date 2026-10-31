// Styled sand blit (Skin contract `sand`). The simulation is untouched: this only changes how a
// region's packed grains become pixels. Regions are still rebuilt only when their version changes
// (or while a moving-grain sparkle is fading out).
import type { ColorId, SandRegion } from '../core/types';
import { COLOR_MASK, SHADE_SHIFT } from '../core/types';
import { GRAIN_U32 } from './colors';

export type RGB = [number, number, number];
export type GrainStyle = 'square' | 'dot' | 'chunky';

export interface SandStyle {
  /** Grain colour for a color and shade (0..7). Omit for the default (slate) palette. */
  palette?(color: ColorId, shade: number): RGB;
  /** square = 1 px per grain; dot = baked round dot; chunky = bevelled block (when cells are big enough). */
  grain: GrainStyle;
  /** Strength (0..1) of the lighter line on each column's topmost grain. */
  surfaceLight?: number;
  /** Strength (0..1) of the darker line on the grain below it. */
  surfaceShadow?: number;
  /** 0..1: darken grains by how much sand lies above them in their column. */
  depthDarken?: number;
  /** 0..1: chance that a grain that just moved shows a bright pixel for ~2 frames. */
  movingSparkle?: number;
  /** How bright a sparkle is (0..1 toward white; default 0.6). */
  sparkleStrength?: number;
  /** Static specks (pebbles, roots) on settled sand, seeded per region. */
  specks?: { density: number; colors: string[] };
  /** Animated layer over a region that changed recently (device px rect, clipped by the caller). */
  overlay?(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, time: number): void;
}

/** The default style: exactly the original 1 px-per-grain blit. */
export const PLAIN_SAND: SandStyle = { grain: 'square' };

// LUT layout: [tone][level][value]. Tones: 0 base, 1 highlight, 2 lowlight (grain stamps).
// Levels: 0..7 depth darkening, 8 surface light, 9 surface shadow, 10 sparkle, 11.. specks.
const DEPTH_LEVELS = 8;
const L_LIGHT = 8;
const L_SHADOW = 9;
const L_SPARK = 10;
const L_SPECK = 11;

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function tone(c: RGB, f: number): RGB {
  const t = f >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(f));
  return [c[0] + (t - c[0]) * k, c[1] + (t - c[1]) * k, c[2] + (t - c[2]) * k];
}

function pack(c: RGB): number {
  const r = Math.max(0, Math.min(255, Math.round(c[0])));
  const g = Math.max(0, Math.min(255, Math.round(c[1])));
  const b = Math.max(0, Math.min(255, Math.round(c[2])));
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function unpack(u: number): RGB {
  return [u & 255, (u >>> 8) & 255, (u >>> 16) & 255];
}

/** Compiled tables for one style. */
export interface SandLut {
  style: SandStyle;
  /** True when the plain GRAIN_U32 blit is exact (slate). */
  plain: boolean;
  levels: number;
  /** lut[(tone * levels + level) * 256 + value] */
  lut: Uint32Array;
}

const lutCache = new WeakMap<SandStyle, SandLut>();

export function compileSand(style: SandStyle): SandLut {
  let c = lutCache.get(style);
  if (c) return c;
  const plain = !style.palette && style.grain === 'square' && !style.surfaceLight && !style.surfaceShadow && !style.depthDarken && !style.movingSparkle && !style.specks;
  const specks = style.specks?.colors.map(hexRgb) ?? [];
  const levels = L_SPECK + specks.length;
  const lut = new Uint32Array(3 * levels * 256);
  const base = new Uint32Array(256);
  for (let v = 1; v < 256; v++) {
    const color = v & COLOR_MASK;
    if (color === 0) continue;
    base[v] = style.palette ? pack(style.palette(color, v >>> SHADE_SHIFT)) : GRAIN_U32[v];
  }
  const toneF = style.grain === 'chunky' ? [0, 0.1, -0.15] : style.grain === 'dot' ? [0, 0.08, -0.2] : [0, 0, 0];
  const depthMax = 0.55 * (style.depthDarken ?? 0);
  const spark = style.sparkleStrength ?? 0.6;
  for (let t = 0; t < 3; t++) {
    for (let l = 0; l < levels; l++) {
      const off = (t * levels + l) * 256;
      for (let v = 1; v < 256; v++) {
        if (!base[v]) continue;
        let c = unpack(base[v]);
        if (l < DEPTH_LEVELS) c = tone(c, -depthMax * (l / (DEPTH_LEVELS - 1)));
        else if (l === L_LIGHT) c = tone(c, 0.35 * (style.surfaceLight ?? 0));
        else if (l === L_SHADOW) c = tone(c, -0.3 * (style.surfaceShadow ?? 0));
        else if (l === L_SPARK) c = tone(c, spark);
        else {
          // speck: a pebble / root colour, a little varied by the grain's shade
          const s = specks[l - L_SPECK];
          c = tone(s, ((v >>> SHADE_SHIFT) - 3.5) * 0.03);
        }
        if (toneF[t]) c = tone(c, toneF[t]);
        lut[off + v] = pack(c);
      }
    }
  }
  c = { style, plain, levels, lut };
  lutCache.set(style, c);
  return c;
}

/** Pixels per grain on the region canvas for this style at this grain size (device px). */
export function grainScale(style: SandStyle, grainPx: number): number {
  if (style.grain === 'square' || grainPx < 1.8) return 1;
  // chunky: 2x2 bevelled blocks; dot: a 3x3 rounded dot once grains are big enough to show it
  return style.grain === 'dot' && grainPx >= 2.6 ? 3 : 2;
}

/** Tone index for each pixel of a k x k grain stamp. */
const stampCache = new Map<string, Uint8Array>();
function stamp(grain: GrainStyle, k: number): Uint8Array {
  const key = `${grain}${k}`;
  let s = stampCache.get(key);
  if (s) return s;
  s = new Uint8Array(k * k);
  for (let y = 0; y < k; y++) {
    for (let x = 0; x < k; x++) {
      let t = 0;
      if (grain === 'chunky') {
        if (y === 0 || (x === 0 && y < k - 1)) t = 1; // lit top / left edge
        else if (y === k - 1 || x === k - 1) t = 2; // shaded bottom / right edge
      } else if (grain === 'dot') {
        const corner = (x === 0 || x === k - 1) && (y === 0 || y === k - 1);
        if (k === 2) t = x === 1 && y === 1 ? 2 : x === 0 && y === 0 ? 1 : 0;
        else if (corner) t = 2;
        else if (x === 1 && y === 1 && k > 2) t = 1;
      }
      s[y * k + x] = t;
    }
  }
  stampCache.set(key, s);
  return s;
}

/** Per-region scratch kept between rebuilds. */
export interface SandScratch {
  prev: Uint8Array | null;
  age: Uint8Array | null;
  level: Uint8Array | null;
  seed: number;
}

function hash(i: number, seed: number): number {
  let h = (i * 0x9e3779b1 + seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Fill `out` (k*w by k*h pixels) from the region with the style. Returns true while sparkles are
 * still fading (the caller rebuilds next frame even if the region did not change).
 */
export function bakeRegion(region: SandRegion, out: Uint32Array, k: number, L: SandLut, sc: SandScratch, frame: number): boolean {
  const { w, h, cells } = region;
  const n = cells.length;
  const st = L.style;
  if (L.plain) {
    const T = GRAIN_U32;
    for (let i = 0; i < n; i++) out[i] = T[cells[i]];
    return false;
  }
  if (!sc.level || sc.level.length !== n) sc.level = new Uint8Array(n);
  const level = sc.level;
  // column pass: depth, surface light / shadow, specks
  const depth = st.depthDarken ?? 0;
  const light = !!st.surfaceLight;
  const shadow = !!st.surfaceShadow;
  const speckN = st.specks?.colors.length ?? 0;
  const speckD = st.specks?.density ?? 0;
  const dScale = depth > 0 ? (DEPTH_LEVELS - 1) / Math.max(1, h * 0.85) : 0;
  for (let x = 0; x < w; x++) {
    let above = 0;
    let state = 0; // 0 = no grain yet, 1 = just after the top grain, 2 = deeper
    for (let y = 0, i = x; y < h; y++, i += w) {
      if (cells[i] === 0) continue;
      let l = dScale ? Math.min(DEPTH_LEVELS - 1, Math.round(above * dScale)) : 0;
      if (state === 0) {
        if (light) l = L_LIGHT;
        state = 1;
      } else if (state === 1) {
        if (shadow) l = L_SHADOW;
        state = 2;
      } else if (speckN && above > 2) {
        const r = hash(i, sc.seed);
        if (r < speckD) l = L_SPECK + Math.floor((r / speckD) * speckN);
      }
      level[i] = l;
      above++;
    }
  }
  // moving sparkle: grains that changed since the last bake of this region
  let sparkling = false;
  const sp = st.movingSparkle ?? 0;
  if (sp > 0) {
    if (!sc.prev || sc.prev.length !== n) {
      sc.prev = new Uint8Array(cells);
      sc.age = new Uint8Array(n);
    }
    const prev = sc.prev;
    const age = sc.age!;
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      if (v !== prev[i]) {
        prev[i] = v;
        if (v !== 0 && hash(i + frame * 7919, sc.seed) < sp) age[i] = 2;
        else age[i] = 0;
      }
      if (age[i] > 0) {
        if (v !== 0) level[i] = L_SPARK;
        age[i]--;
        sparkling = true;
      }
    }
  }
  const lut = L.lut;
  const levels = L.levels;
  if (k === 1) {
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      out[i] = v === 0 ? 0 : lut[level[i] * 256 + v];
    }
    return sparkling;
  }
  const s = stamp(st.grain, k);
  const ow = w * k;
  if (k === 2) {
    // unrolled 2x2 stamps (the common case)
    const s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3];
    const L1 = levels * 256;
    const L2 = 2 * levels * 256;
    for (let y = 0; y < h; y++) {
      let i = y * w;
      let o = y * 2 * ow;
      for (let x = 0; x < w; x++, i++, o += 2) {
        const v = cells[i];
        if (v === 0) {
          out[o] = out[o + 1] = out[o + ow] = out[o + ow + 1] = 0;
          continue;
        }
        const b = level[i] * 256 + v;
        const t0 = lut[b];
        const t1 = lut[L1 + b];
        const t2 = lut[L2 + b];
        out[o] = s0 === 0 ? t0 : s0 === 1 ? t1 : t2;
        out[o + 1] = s1 === 0 ? t0 : s1 === 1 ? t1 : t2;
        out[o + ow] = s2 === 0 ? t0 : s2 === 1 ? t1 : t2;
        out[o + ow + 1] = s3 === 0 ? t0 : s3 === 1 ? t1 : t2;
      }
    }
    return sparkling;
  }
  if (k === 3) {
    const L1 = levels * 256;
    const L2 = 2 * levels * 256;
    const tone3 = new Uint32Array(3);
    for (let y = 0; y < h; y++) {
      let i = y * w;
      let o = y * 3 * ow;
      for (let x = 0; x < w; x++, i++, o += 3) {
        const v = cells[i];
        const o1 = o + ow;
        const o2 = o1 + ow;
        if (v === 0) {
          out[o] = out[o + 1] = out[o + 2] = out[o1] = out[o1 + 1] = out[o1 + 2] = out[o2] = out[o2 + 1] = out[o2 + 2] = 0;
          continue;
        }
        const bi = level[i] * 256 + v;
        tone3[0] = lut[bi];
        tone3[1] = lut[L1 + bi];
        tone3[2] = lut[L2 + bi];
        out[o] = tone3[s[0]];
        out[o + 1] = tone3[s[1]];
        out[o + 2] = tone3[s[2]];
        out[o1] = tone3[s[3]];
        out[o1 + 1] = tone3[s[4]];
        out[o1 + 2] = tone3[s[5]];
        out[o2] = tone3[s[6]];
        out[o2 + 1] = tone3[s[7]];
        out[o2 + 2] = tone3[s[8]];
      }
    }
    return sparkling;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = cells[i];
      const o = y * k * ow + x * k;
      if (v === 0) {
        for (let sy = 0; sy < k; sy++) out.fill(0, o + sy * ow, o + sy * ow + k);
        continue;
      }
      const lv = level[i] * 256 + v;
      const t0 = lut[lv];
      const t1 = lut[(levels + level[i]) * 256 + v];
      const t2 = lut[(2 * levels + level[i]) * 256 + v];
      let si = 0;
      for (let sy = 0; sy < k; sy++) {
        const row = o + sy * ow;
        for (let sx = 0; sx < k; sx++) {
          const t = s[si++];
          out[row + sx] = t === 0 ? t0 : t === 1 ? t1 : t2;
        }
      }
    }
  }
  return sparkling;
}

// ---------- palette helpers for skins ----------

/** Lighten (f > 0, toward white) or darken (f < 0, toward black). */
export function toneRgb(c: RGB, f: number): RGB {
  return tone(c, f);
}

/** Linear mix a -> b by t. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Desaturate toward the colour's own luminance by t (0..1). */
export function desaturate(c: RGB, t: number): RGB {
  const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return mixRgb(c, [l, l, l], t);
}
