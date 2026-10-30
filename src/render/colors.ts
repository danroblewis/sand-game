// Palette for ColorId 1..12, tuned for a dark slate background.
import type { ColorId } from '../core/types';
import { COLOR_MASK, SHADE_COUNT, SHADE_SHIFT } from '../core/types';

export const BG = '#1b1f2a';
export const BOARD_BG = '#222736';
export const GRID_LINE = 'rgba(255,255,255,0.045)';

/** Base hex per ColorId (index 0 unused). */
export const PALETTE: readonly string[] = [
  '#000000', // 0 (empty)
  '#e5484d', // 1 red
  '#f2853a', // 2 orange
  '#f5c84c', // 3 yellow
  '#5cc160', // 4 green
  '#2fbfb1', // 5 teal
  '#3e8ef7', // 6 blue
  '#7b74f0', // 7 indigo
  '#b065e6', // 8 purple
  '#ef6fae', // 9 pink
  '#a8744a', // 10 brown
  '#efe6d2', // 11 white / sand
  '#5a6072', // 12 charcoal (kept light enough to read on the slate)
];

export const COLOR_NAMES: readonly string[] = [
  '', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown',
  'white', 'charcoal',
];

// Frozen / ice look.
export const ICE_FILL_TOP = 'rgba(214, 236, 248, 0.92)';
export const ICE_FILL_BOTTOM = 'rgba(170, 205, 228, 0.88)';
export const ICE_STROKE = 'rgba(236, 248, 255, 0.95)';
export const ICE_TEXT = '#33546d';
export const ICE_FLASH = 'rgba(255,255,255,1)';

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BASE_RGB: RGB[] = PALETTE.map(hexToRgb);

/** Lightness offset for each shade: spread over roughly -12%..+12%. */
function shadeFactor(shade: number): number {
  return ((shade - (SHADE_COUNT - 1) / 2) / ((SHADE_COUNT - 1) / 2)) * 0.12;
}

function shadeRgb(base: RGB, f: number): RGB {
  const t = f >= 0 ? 255 : 0;
  const k = Math.abs(f);
  return [
    Math.round(base[0] + (t - base[0]) * k),
    Math.round(base[1] + (t - base[1]) * k),
    Math.round(base[2] + (t - base[2]) * k),
  ];
}

const MAX_COLOR = PALETTE.length - 1;

/** Precomputed shade table: SHADES[color][shade] = [r,g,b]. */
const SHADES: RGB[][] = BASE_RGB.map((rgb) =>
  Array.from({ length: SHADE_COUNT }, (_, s) => shadeRgb(rgb, shadeFactor(s))),
);

/** One of 8 shade variants for a color as [r,g,b]. */
export function grainRGBA(color: ColorId, shade: number): RGB {
  const c = color >= 1 && color <= MAX_COLOR ? color : 12;
  return SHADES[c][shade & (SHADE_COUNT - 1)];
}

/** Packed grain value (0..255) -> RGBA as a little-endian Uint32 (ImageData order). 0 = transparent. */
export const GRAIN_U32: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let v = 1; v < 256; v++) {
    const color = v & COLOR_MASK;
    if (color === 0) continue;
    const [r, g, b] = grainRGBA(color, v >>> SHADE_SHIFT);
    t[v] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return t;
})();

export function colorHex(color: ColorId): string {
  return PALETTE[color >= 1 && color <= MAX_COLOR ? color : 12];
}

function rgba(color: ColorId, a: number, lighten = 0): string {
  const [r, g, b] = shadeRgb(BASE_RGB[color >= 1 && color <= MAX_COLOR ? color : 12], lighten);
  return `rgba(${r},${g},${b},${a})`;
}

/** Outline color for a box. */
export function boxStroke(color: ColorId): string {
  return rgba(color, 1, 0.12);
}

/** Translucent tinted fill for a box interior. */
export function boxFill(color: ColorId): string {
  return rgba(color, 0.16);
}

/** Soft glow color for selection. */
export function boxGlow(color: ColorId): string {
  return rgba(color, 0.9, 0.35);
}

export function colorRGBA(color: ColorId, a: number): string {
  return rgba(color, a);
}
