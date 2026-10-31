// Skin "workshop": an alchemist's / glassblower's workshop. A warm dark workbench with faint wood
// grain and pencil-line grid; sand boxes are glass vials with brass caps; boxes are tinted glass
// jars with brass corner bands and a cork; frozen boxes are ice-crusted jars with the counter etched
// in frost; walls are stone masonry; belts are copper pipe runs with rollers; driven boxes carry a
// spring piston on their back edge that puffs steam; the hero is a clockwork tin figure with a
// wind-up key. Repeated textures (bench, stone, corner bands, cork) are baked per cell size.
// Gameplay affordances (counters, arrows, selection, pings, kick arrow) keep the slate rules.
import type { Box, ColorId, ConveyorState, Dir, SandRegion, Vec } from '../../core/types';
import type { HeroPose, SkinHost } from './skin';
import { SlateSkin } from './slate';
import { boxStroke, colorHex, colorRGBA } from '../colors';
import { workshopProgression } from './progression/workshop';
import type { SkinProgression } from './progression/types';
import { DIR_ANGLE, DIR_VEC, loopsPath, roundRectPath, shapeOutline } from '../geom';

const BENCH = '#2a1d15';
const BENCH_EDGE = '#140d09';
const BRASS_HI = '#f3d58a';
const BRASS = '#c49a45';
const BRASS_LO = '#7a5a22';
const COPPER_HI = '#f0b48a';
const COPPER = '#b8683e';
const COPPER_LO = '#5e2f1a';
const ICE_INK = '#1f4258';

/** Deterministic PRNG for baked textures (same look every load). */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

function brassGrad(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, BRASS_HI);
  gr.addColorStop(0.45, BRASS);
  gr.addColorStop(1, BRASS_LO);
  return gr;
}

/** Path with separate top and bottom corner radii (a vial: square-ish shoulders, round base). */
function vialPath(x: number, y: number, w: number, h: number, rt: number, rb: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + rt, y);
  p.lineTo(x + w - rt, y);
  p.arcTo(x + w, y, x + w, y + rt, rt);
  p.lineTo(x + w, y + h - rb);
  p.arcTo(x + w, y + h, x + w - rb, y + h, rb);
  p.lineTo(x + rb, y + h);
  p.arcTo(x, y + h, x, y + h - rb, rb);
  p.lineTo(x, y + rt);
  p.arcTo(x, y, x + rt, y, rt);
  p.closePath();
  return p;
}

interface Baked {
  cs: number;
  bench: CanvasPattern;
  benchTile: number; // tile size in cells
  stone: CanvasPattern;
  corner: HTMLCanvasElement;
  cornerPad: number;
  cork: HTMLCanvasElement;
  frostCork: HTMLCanvasElement;
}

export class WorkshopSkin extends SlateSkin {
  override readonly id: string = 'workshop';
  override readonly name: string = 'Workshop';
  override readonly pageBg: string = '#1a120d';
  override readonly progression: SkinProgression = workshopProgression;
  private baked: Baked | null = null;

  // ---------- baking ----------

  bake(host: SkinHost): void {
    const cs = Math.round(host.cellSize);
    if (cs < 4) return;
    const ctx = host.ctx;
    const TILE = 4; // bench tile spans 4x4 cells so the grain does not repeat every cell
    const bench = this.bakeBench(cs, TILE);
    const stone = this.bakeStone(cs);
    const benchP = ctx.createPattern(bench, 'repeat');
    const stoneP = ctx.createPattern(stone, 'repeat');
    if (!benchP || !stoneP) return;
    const [corner, cornerPad] = this.bakeCorner(cs);
    this.baked = {
      cs,
      bench: benchP,
      benchTile: TILE,
      stone: stoneP,
      corner,
      cornerPad,
      cork: this.bakeCork(cs, false),
      frostCork: this.bakeCork(cs, true),
    };
  }

  private ensure(host: SkinHost): Baked | null {
    const cs = host.cellSize;
    if ((!this.baked || this.baked.cs !== Math.round(cs)) && Math.abs(cs - Math.round(cs)) < 0.01) this.bake(host);
    return this.baked;
  }

  /** Warm workbench: planks with grain, a few knots, and pencil grid lines with drafting ticks. */
  private bakeBench(cs: number, tile: number): HTMLCanvasElement {
    const S = cs * tile;
    const [c, g] = canvas(S, S);
    const r = rng(0x5eed1);
    g.fillStyle = BENCH;
    g.fillRect(0, 0, S, S);
    // plank bands (two planks per tile, slight tone differences)
    const plank = S / 2;
    for (let i = 0; i < 2; i++) {
      g.fillStyle = i ? 'rgba(255,214,160,0.025)' : 'rgba(0,0,0,0.06)';
      g.fillRect(0, i * plank, S, plank);
    }
    // grain: long wavy strokes
    g.lineCap = 'round';
    for (let k = 0; k < 34; k++) {
      const y0 = r() * S;
      const amp = cs * (0.015 + r() * 0.045);
      const freq = (Math.PI * 2 * (1 + Math.floor(r() * 2))) / S;
      const ph = r() * Math.PI * 2;
      const ph2 = r() * Math.PI * 2;
      g.beginPath();
      for (let x = 0; x <= S; x += Math.max(2, cs * 0.1)) {
        const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3 + ph2) * amp * 0.3;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      const light = r() < 0.4;
      g.strokeStyle = light ? `rgba(255,220,170,${0.015 + r() * 0.03})` : `rgba(0,0,0,${0.06 + r() * 0.09})`;
      g.lineWidth = Math.max(1, cs * (0.01 + r() * 0.025));
      g.stroke();
      // wrap vertically so the tile seams vanish
      if (y0 < amp * 2 || y0 > S - amp * 2) {
        g.save();
        g.translate(0, y0 < S / 2 ? S : -S);
        g.stroke();
        g.restore();
      }
    }
    // a knot
    const kx = S * (0.25 + r() * 0.5);
    const ky = plank * 0.5;
    for (let i = 4; i >= 1; i--) {
      g.beginPath();
      g.ellipse(kx, ky, cs * 0.09 * i, cs * 0.035 * i, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(0,0,0,${0.06 + 0.03 * (4 - i)})`;
      g.lineWidth = Math.max(1, cs * 0.015);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(kx, ky, cs * 0.05, cs * 0.022, 0, 0, Math.PI * 2);
    g.fill();
    // plank seam
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, plank - Math.max(1, cs * 0.012), S, Math.max(1, cs * 0.024));
    // pencil grid: graphite lines, slightly uneven, with small cross ticks at intersections
    const lw = Math.max(1, cs * 0.016);
    for (let i = 0; i < tile; i++) {
      const a = 0.07 + r() * 0.04;
      g.fillStyle = `rgba(214,206,190,${a})`;
      g.fillRect(i * cs, 0, lw, S);
      g.fillStyle = `rgba(214,206,190,${0.07 + r() * 0.04})`;
      g.fillRect(0, i * cs, S, lw);
    }
    g.fillStyle = 'rgba(230,222,205,0.2)';
    const t = cs * 0.09;
    for (let i = 0; i < tile; i++)
      for (let j = 0; j < tile; j++) {
        g.fillRect(i * cs - t, j * cs, t * 2, lw);
        g.fillRect(i * cs, j * cs - t, lw, t * 2);
      }
    // the ticks at x=0 / y=0 wrap
    for (let j = 0; j < tile; j++) {
      g.fillRect(S - t, j * cs, t, lw);
      g.fillRect(j * cs, S - t, lw, t);
    }
    return c;
  }

  /** Stone masonry, 2x2 cells per tile: offset courses of blocks with mortar and speckle. */
  private bakeStone(cs: number): HTMLCanvasElement {
    const S = cs * 2;
    const [c, g] = canvas(S, S);
    const r = rng(0x570e);
    g.fillStyle = '#1b1612';
    g.fillRect(0, 0, S, S);
    const rows = 4;
    const rh = S / rows;
    const m = Math.max(1, cs * 0.035); // mortar
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? cs * 0.5 : 0;
      for (let k = -1; k < 3; k++) {
        const x0 = k * cs + off;
        const y0 = row * rh;
        const tone = 58 + Math.floor(r() * 16);
        const block = roundRectPath(x0 + m / 2, y0 + m / 2, cs - m, rh - m, cs * 0.04);
        const bg = g.createLinearGradient(0, y0, 0, y0 + rh);
        bg.addColorStop(0, `rgb(${tone + 14},${tone + 8},${tone})`);
        bg.addColorStop(1, `rgb(${tone - 8},${tone - 12},${tone - 16})`);
        g.fillStyle = bg;
        g.fill(block);
        g.save();
        g.clip(block);
        // speckle
        for (let i = 0; i < 18; i++) {
          g.fillStyle = r() < 0.5 ? 'rgba(255,240,220,0.07)' : 'rgba(0,0,0,0.12)';
          const s = Math.max(1, cs * (0.015 + r() * 0.02));
          g.fillRect(x0 + r() * cs, y0 + r() * rh, s, s);
        }
        // top highlight / bottom shade
        g.fillStyle = 'rgba(255,236,210,0.10)';
        g.fillRect(x0, y0 + m / 2, cs, Math.max(1, cs * 0.025));
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(x0, y0 + rh - m / 2 - Math.max(1, cs * 0.03), cs, Math.max(1, cs * 0.03));
        g.restore();
      }
    }
    return c;
  }

  /** One brass corner band (drawn for the top-left corner; rotated per corner when used). */
  private bakeCorner(cs: number): [HTMLCanvasElement, number] {
    const s = cs * 0.22;
    const t = Math.max(2, cs * 0.06);
    const pad = Math.ceil(Math.max(2, cs * 0.03));
    const [c, g] = canvas(s + pad * 2, s + pad * 2);
    g.translate(pad, pad);
    const rad = cs * 0.14;
    const p = new Path2D();
    const o = t / 2;
    p.moveTo(o, s);
    p.lineTo(o, rad);
    p.arcTo(o, o, rad, o, Math.max(0.1, rad - o));
    p.lineTo(s, o);
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(30,18,6,0.85)';
    g.lineWidth = t + Math.max(1, cs * 0.02) * 2;
    g.stroke(p);
    g.strokeStyle = brassGrad(g, 0, 0, s, s);
    g.lineWidth = t;
    g.stroke(p);
    // bright edge on the band
    g.strokeStyle = 'rgba(255,245,200,0.55)';
    g.lineWidth = Math.max(1, cs * 0.012);
    g.save();
    g.translate(-t * 0.22, -t * 0.22);
    g.stroke(p);
    g.restore();
    // rivets at the band ends
    for (const [x, y] of [[o, s - t * 0.75], [s - t * 0.75, o]]) {
      g.fillStyle = 'rgba(40,24,6,0.8)';
      g.beginPath();
      g.arc(x, y, Math.max(1, t * 0.26), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,240,190,0.7)';
      g.beginPath();
      g.arc(x - t * 0.07, y - t * 0.07, Math.max(0.6, t * 0.1), 0, Math.PI * 2);
      g.fill();
    }
    return [c, pad];
  }

  /** A cork stopper (tapered, speckled); frosted variant for frozen jars. */
  private bakeCork(cs: number, frost: boolean): HTMLCanvasElement {
    const w = cs * 0.36;
    const hh = cs * 0.2;
    const pad = 2;
    const [c, g] = canvas(w + pad * 2, hh + pad * 2);
    g.translate(pad, pad);
    const p = new Path2D();
    const top = hh * 0.22;
    p.moveTo(0, top);
    p.lineTo(w, top);
    p.lineTo(w * 0.88, hh);
    p.lineTo(w * 0.12, hh);
    p.closePath();
    const gr = g.createLinearGradient(0, 0, w, 0);
    if (frost) {
      gr.addColorStop(0, '#e9f4fa');
      gr.addColorStop(0.5, '#b8d4e2');
      gr.addColorStop(1, '#86a9bd');
    } else {
      gr.addColorStop(0, '#e2b77e');
      gr.addColorStop(0.55, '#b9864c');
      gr.addColorStop(1, '#7b532a');
    }
    g.fillStyle = gr;
    g.fill(p);
    const r = rng(frost ? 77 : 41);
    g.save();
    g.clip(p);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = frost ? 'rgba(255,255,255,0.55)' : 'rgba(70,40,14,0.45)';
      const s = Math.max(1, cs * 0.014);
      g.fillRect(r() * w, top + r() * (hh - top), s, s);
    }
    g.restore();
    // top face
    g.fillStyle = frost ? '#f4fbff' : '#d6a86c';
    g.beginPath();
    g.ellipse(w / 2, top, w / 2, top, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = frost ? 'rgba(40,80,100,0.6)' : 'rgba(60,34,10,0.75)';
    g.lineWidth = Math.max(1, cs * 0.012);
    g.stroke();
    g.stroke(p);
    return c;
  }

  // ---------- board ----------

  override board(host: SkinHost): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX;
    const y = host.originY;
    const w = cs * host.boardW;
    const h = cs * host.boardH;
    const pad = Math.round(cs * 0.12);
    const bk = this.ensure(host);
    // bench edge: a darker rim with a thin brass inlay
    const frame = roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, cs * 0.1);
    ctx.fillStyle = BENCH_EDGE;
    ctx.fill(frame);
    ctx.save();
    ctx.clip(roundRectPath(x, y, w, h, cs * 0.05));
    if (bk) {
      const k = cs / bk.cs;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);
      ctx.fillStyle = bk.bench;
      ctx.fillRect(0, 0, w / k, h / k);
      ctx.restore();
    } else {
      ctx.fillStyle = BENCH;
      ctx.fillRect(x, y, w, h);
    }
    // soft lamp-lit vignette (cheap: one radial gradient)
    const vg = ctx.createRadialGradient(x + w / 2, y + h * 0.4, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(255,190,110,0.05)');
    vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(196,154,69,0.35)';
    ctx.lineWidth = Math.max(1, host.dpr);
    ctx.stroke(roundRectPath(x - pad * 0.5, y - pad * 0.5, w + pad, h + pad, cs * 0.08));
  }

  // ---------- sand boxes: glass vials with a brass cap and foot ----------

  override sandBox(host: SkinHost, gx: number, gy: number, gw: number, gh: number, region: SandRegion): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX + gx * cs;
    const y = host.originY + gy * cs;
    const w = gw * cs;
    const h = gh * cs;
    const ins = Math.max(1, cs * 0.06);
    const capH = cs * 0.13;
    const footH = cs * 0.07;
    const gx0 = x + ins;
    const gy0 = y + ins * 0.5;
    const gw0 = w - ins * 2;
    const gh0 = h - ins * 0.5 - footH * 0.6;
    const glass = vialPath(gx0, gy0, gw0, gh0, cs * 0.05, Math.min(cs * 0.3, gw0 / 2));
    // drop shadow on the bench
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = cs * 0.14;
    ctx.shadowOffsetY = cs * 0.05;
    ctx.fillStyle = 'rgba(10,7,4,0.55)';
    ctx.fill(glass);
    ctx.restore();
    ctx.save();
    ctx.clip(glass);
    const rc = host.regionCanvas(region);
    ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, x, y, w, h);
    // inner edge darkening (thick glass) + left/right highlights
    let g = ctx.createLinearGradient(gx0, 0, gx0 + gw0, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.08, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.16, 'rgba(255,255,255,0)');
    g.addColorStop(0.86, 'rgba(255,255,255,0)');
    g.addColorStop(0.93, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(gx0, gy0, gw0, gh0);
    // a long specular streak
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill(roundRectPath(gx0 + gw0 * 0.1, gy0 + capH + cs * 0.06, Math.max(1.5, cs * 0.05), Math.max(0, gh0 - capH - cs * 0.3), cs * 0.025));
    g = ctx.createLinearGradient(0, gy0 + capH, 0, gy0 + capH + cs * 0.2);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx0, gy0 + capH, gw0, cs * 0.2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(225,238,245,0.5)';
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.stroke(glass);
    // brass cap: a collar across the top with ridges
    const cap = roundRectPath(x + ins * 0.4, y + 1, w - ins * 0.8, capH, cs * 0.04);
    ctx.fillStyle = brassGrad(ctx, 0, y, 0, y + capH);
    ctx.fill(cap);
    ctx.fillStyle = 'rgba(60,36,8,0.45)';
    const rib = Math.max(1, cs * 0.014);
    ctx.fillRect(x + ins, y + 1 + capH * 0.35, w - ins * 2, rib);
    ctx.fillRect(x + ins, y + 1 + capH * 0.68, w - ins * 2, rib);
    ctx.strokeStyle = 'rgba(40,24,6,0.85)';
    ctx.lineWidth = Math.max(1, cs * 0.015);
    ctx.stroke(cap);
    // screws on the collar
    ctx.fillStyle = 'rgba(255,240,190,0.75)';
    for (const sx of [x + ins + cs * 0.08, x + w - ins - cs * 0.08]) {
      ctx.beginPath();
      ctx.arc(sx, y + 1 + capH / 2, Math.max(1, cs * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }
    // brass foot under the round base
    const fw = Math.min(gw0 * 0.7, cs * 1.2);
    const foot = roundRectPath(x + w / 2 - fw / 2, y + h - footH - 1, fw, footH, footH * 0.45);
    ctx.fillStyle = brassGrad(ctx, 0, y + h - footH, 0, y + h);
    ctx.fill(foot);
    ctx.strokeStyle = 'rgba(40,24,6,0.85)';
    ctx.stroke(foot);
  }

  // ---------- walls: stone masonry ----------

  override walls(host: SkinHost, loops: Vec[][]): void {
    if (loops.length === 0) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const bk = this.ensure(host);
    const path = loopsPath(loops, host.originX, host.originY, cs, cs * 0.02, cs * 0.06);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = cs * 0.16;
    ctx.shadowOffsetY = cs * 0.06;
    ctx.fillStyle = '#3b332c';
    ctx.fill(path);
    ctx.restore();
    if (bk) {
      ctx.save();
      ctx.clip(path);
      const k = cs / bk.cs;
      ctx.translate(host.originX, host.originY);
      ctx.scale(k, k);
      ctx.fillStyle = bk.stone;
      ctx.fillRect(0, 0, (host.boardW * cs) / k, (host.boardH * cs) / k);
      ctx.restore();
    }
    ctx.save();
    ctx.clip(path);
    const e = Math.max(1, cs * 0.045);
    ctx.lineWidth = e * 2;
    ctx.translate(e, e);
    ctx.strokeStyle = 'rgba(255,230,200,0.14)';
    ctx.stroke(path);
    ctx.translate(-2 * e, -2 * e);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(path);
  }

  // ---------- belts: copper pipe runs with rollers ----------

  override belt(host: SkinHost, cv: ConveyorState, _now: number, progress: number, active: number): void {
    const cells = cv.cells && cv.cells.length ? cv.cells : [{ x: cv.x, y: cv.y }];
    const ctx = host.ctx;
    const cs = host.cellSize;
    const [dx, dy] = DIR_VEC[cv.dir];
    const start = cells[0];
    const ox = host.originX + (start.x + 0.5 - dx * 0.5) * cs;
    const oy = host.originY + (start.y + 0.5 - dy * 0.5) * cs;
    const L = cells.length * cs;
    const half = cs * 0.34;
    const pipeR = cs * 0.06;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(DIR_ANGLE[cv.dir]);
    // channel bed
    ctx.fillStyle = 'rgba(12,7,4,0.6)';
    ctx.fill(roundRectPath(cs * 0.04, -half, L - cs * 0.08, half * 2, cs * 0.08));
    // rollers moving along the run
    const spacing = cs * 0.25;
    const phase = (((progress * cs) % spacing) + spacing) % spacing;
    const inner = half - pipeR * 1.6;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cs * 0.06, -inner, L - cs * 0.12, inner * 2);
    ctx.clip();
    const rw = cs * 0.13;
    const rg = ctx.createLinearGradient(-rw / 2, 0, rw / 2, 0);
    rg.addColorStop(0, '#3a2a1e');
    rg.addColorStop(0.5, `rgb(${150 + 40 * active},${112 + 30 * active},${78 + 20 * active})`);
    rg.addColorStop(1, '#3a2a1e');
    ctx.fillStyle = rg;
    for (let u = -spacing + phase; u < L + spacing; u += spacing) {
      ctx.save();
      ctx.translate(u, 0);
      ctx.fillRect(-rw / 2, -inner, rw, inner * 2);
      ctx.restore();
    }
    ctx.restore();
    // copper pipes along both sides, with flanges at each cell joint
    for (const v of [-half + pipeR, half - pipeR]) {
      const g = ctx.createLinearGradient(0, v - pipeR, 0, v + pipeR);
      g.addColorStop(0, COPPER_HI);
      g.addColorStop(0.45, COPPER);
      g.addColorStop(1, COPPER_LO);
      ctx.fillStyle = g;
      ctx.fill(roundRectPath(cs * 0.04, v - pipeR, L - cs * 0.08, pipeR * 2, pipeR));
      ctx.fillStyle = brassGrad(ctx, 0, v - pipeR * 1.4, 0, v + pipeR * 1.4);
      for (let i = 0; i <= cells.length; i++) {
        const u = Math.min(L - cs * 0.07, Math.max(cs * 0.04, i * cs - cs * 0.025));
        ctx.fillRect(u, v - pipeR * 1.35, cs * 0.05, pipeR * 2.7);
      }
    }
    // direction tick (brass) at the far end
    ctx.fillStyle = `rgba(243,213,138,${0.55 + 0.4 * active})`;
    ctx.strokeStyle = 'rgba(30,18,6,0.8)';
    ctx.lineWidth = Math.max(1, cs * 0.015);
    ctx.beginPath();
    ctx.moveTo(L - cs * 0.1, 0);
    ctx.lineTo(L - cs * 0.27, -cs * 0.13);
    ctx.lineTo(L - cs * 0.27, cs * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------- jars ----------

  protected override boxRadius(cs: number): number {
    return cs * 0.14;
  }
  protected override boxFillStyle(color: ColorId): string {
    return colorRGBA(color, 0.26);
  }
  protected override boxStrokeStyle(color: ColorId): string {
    return boxStroke(color);
  }
  /** Glass: a dark left edge, a vertical specular streak and a soft shoulder sheen. */
  protected override boxSurface(host: SkinHost, x: number, y: number, w: number, h: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    let g = ctx.createLinearGradient(0, y, 0, y + cs * 0.35);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, cs * 0.35);
    g = ctx.createLinearGradient(x, 0, x + cs * 0.4, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cs * 0.4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x + cs * 0.17, y + cs * 0.24, Math.max(1, cs * 0.035), Math.max(0, Math.min(h - cs * 0.5, cs * 0.5)));
  }
  /** Brass bands on every convex corner, and a cork on the topmost edge. */
  protected override boxDecor(host: SkinHost, loops: Vec[][], px: number, py: number): void {
    const bk = this.ensure(host);
    this.cornerBands(host, loops, px, py, bk);
    this.cork(host, loops, px, py, bk, false);
  }

  private cornerBands(host: SkinHost, loops: Vec[][], px: number, py: number, bk: Baked | null): void {
    if (!bk) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const ins = cs * 0.06;
    const k = cs / bk.cs;
    for (const loop of loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const p = loop[(i - 1 + n) % n];
        const c = loop[i];
        const q = loop[(i + 1) % n];
        const d1x = Math.sign(c.x - p.x);
        const d1y = Math.sign(c.y - p.y);
        const d2x = Math.sign(q.x - c.x);
        const d2y = Math.sign(q.y - c.y);
        if (d1x * d2y - d1y * d2x <= 0) continue; // concave
        const cx = px + c.x * cs + ins * (-d1y - d2y);
        const cy = py + c.y * cs + ins * (d1x + d2x);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(d2y, d2x));
        ctx.scale(k, k);
        ctx.drawImage(bk.corner, -bk.cornerPad, -bk.cornerPad);
        ctx.restore();
      }
    }
  }

  /** Cork on the middle of the topmost horizontal edge of the outline. */
  private cork(host: SkinHost, loops: Vec[][], px: number, py: number, bk: Baked | null, frost: boolean): void {
    if (!bk) return;
    let best: { x: number; y: number; len: number } | null = null;
    for (const loop of loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % n];
        if (a.y !== b.y || b.x <= a.x) continue; // top edges run +x in a clockwise loop
        if (!best || a.y < best.y || (a.y === best.y && b.x - a.x > best.len)) best = { x: (a.x + b.x) / 2, y: a.y, len: b.x - a.x };
      }
    }
    if (!best) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const k = cs / bk.cs;
    const img = frost ? bk.frostCork : bk.cork;
    const w = (img.width - 4) * k;
    const cx = px + best.x * cs;
    const top = py + best.y * cs + cs * 0.01;
    ctx.drawImage(img, cx - w / 2 - 2 * k, top - 2 * k, img.width * k, img.height * k);
  }

  /** Ice-crusted jar: cold glass, frost, a crust with drips on top edges, counter etched in frost. */
  protected override frozenBody(host: SkinHost, b: Box, path: Path2D, px: number, py: number, lw: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const grad = ctx.createLinearGradient(px, py, px + b.bw * cs * 0.4, py + b.bh * cs);
    grad.addColorStop(0, 'rgba(214,236,246,0.95)');
    grad.addColorStop(1, 'rgba(140,182,206,0.93)');
    ctx.fillStyle = grad;
    ctx.fill(path);
    const frost = this.frostPattern(host);
    if (frost) {
      ctx.fillStyle = frost;
      ctx.fill(path);
    }
    const loops = shapeOutline(b.shape, b.cells);
    ctx.save();
    ctx.clip(path);
    // a faint memory of the jar's color at the bottom
    const tg = ctx.createLinearGradient(0, py + b.bh * cs * 0.5, 0, py + b.bh * cs);
    tg.addColorStop(0, colorRGBA(b.color, 0));
    tg.addColorStop(1, colorRGBA(b.color, 0.22));
    ctx.fillStyle = tg;
    ctx.fillRect(px, py, b.bw * cs, b.bh * cs);
    // crust and drips along top edges
    ctx.fillStyle = 'rgba(250,253,255,0.85)';
    for (const loop of loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i];
        const e = loop[(i + 1) % n];
        if (a.y !== e.y || e.x <= a.x) continue;
        const x0 = px + a.x * cs;
        const x1 = px + e.x * cs;
        const y0 = py + a.y * cs;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y0);
        const seg = cs * 0.12;
        let j = 0;
        for (let u = x1; u > x0; u -= seg, j++) {
          const d = ((j * 37 + a.x * 13 + a.y * 7) % 5) / 5; // deterministic drip lengths
          const yy = y0 + cs * (0.12 + (j % 3 === 1 ? 0.1 + d * 0.12 : d * 0.03));
          ctx.lineTo(u - seg * 0.5, yy);
          ctx.lineTo(Math.max(x0, u - seg), y0 + cs * 0.12);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    // glass streak
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(px + cs * 0.17, py + cs * 0.3, Math.max(1, cs * 0.035), Math.max(0, Math.min(b.bh * cs - cs * 0.6, cs * 0.5)));
    ctx.restore();
    ctx.strokeStyle = '#eef9ff';
    ctx.lineWidth = lw;
    ctx.stroke(path);
    const bk = this.ensure(host);
    this.cork(host, loops, px, py, bk, true);
    // counter (same placement rule as slate)
    let mx = 0;
    let my = 0;
    for (const c of b.cells) {
      mx += c.x + 0.5;
      my += c.y + 0.5;
    }
    mx /= b.cells.length;
    my /= b.cells.length;
    let best = b.cells[0];
    let bestD = Infinity;
    for (const c of b.cells) {
      const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const rect = b.cells.length === b.bw * b.bh;
    const tx = px + (rect ? mx : best.x + 0.5) * cs;
    const ty = py + (rect ? my : best.y + 0.5) * cs + cs * 0.05;
    const size = Math.round(Math.max(cs * 0.56, 12 * host.dpr));
    ctx.font = `800 ${size}px ui-serif, "Iowan Old Style", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // etched: a bright lower-right lip, then the dark cut
    const o = Math.max(1, size * 0.045);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(String(b.frozen), tx + o, ty + o);
    ctx.fillStyle = ICE_INK;
    ctx.fillText(String(b.frozen), tx, ty);
  }

  // ---------- driven boxes: a spring piston on the back edge, steam puffs ----------

  protected override drawForce(host: SkinHost, b: Box, px: number, py: number, now: number): void {
    const force = (b as Box & { force?: Dir | null }).force;
    if (!force) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const pressing = !!(b as Box & { pressing?: boolean }).pressing && b.frozen === 0;
    const moving = !!host.forces?.has(b.id) && b.frozen === 0;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    let mx = 0;
    let my = 0;
    for (const c of b.cells) {
      mx += c.x + 0.5;
      my += c.y + 0.5;
    }
    mx /= b.cells.length;
    my /= b.cells.length;
    let best = b.cells[0];
    let bd = Infinity;
    for (const c of b.cells) {
      const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    // face arrow (the affordance, same geometry as slate) with a dark under-stroke for the glass
    ctx.save();
    ctx.translate(px + (best.x + 0.5) * cs, py + (best.y + 0.5) * cs);
    ctx.rotate(DIR_ANGLE[force]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-cs * 0.12, -cs * 0.17);
    ctx.lineTo(cs * 0.08, 0);
    ctx.lineTo(-cs * 0.12, cs * 0.17);
    if (b.frozen > 0) {
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = ICE_INK;
      ctx.lineWidth = Math.max(2, cs * 0.07);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(3, cs * 0.11);
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#fff4dc';
      ctx.lineWidth = Math.max(2, cs * 0.065);
      ctx.stroke();
    }
    ctx.restore();
    if (b.frozen > 0) return;

    const backs = b.cells.filter((c) => !own.has(`${c.x - fx},${c.y - fy}`));
    const back = backs[Math.floor(backs.length / 2)];
    const nx = px + (back.x + 0.5 - fx * 0.5) * cs;
    const ny = py + (back.y + 0.5 - fy * 0.5) * cs;
    const t = now * 0.001;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(DIR_ANGLE[force]);
    // local frame: +x = force, the piston sticks out to -x
    // steam puffs behind while the train moves (drawn first, behind the piston)
    if (moving || pressing) {
      for (let i = 0; i < 5; i++) {
        const ph = (((t * (moving ? 1.6 : 0.7) + i / 5) % 1) + 1) % 1;
        const r = cs * (0.05 + 0.11 * ph);
        const sx = -cs * (0.3 + 0.45 * ph);
        const sy = Math.sin(i * 2.3 + ph * 3) * cs * 0.1 * ph;
        ctx.globalAlpha = (moving ? 0.55 : 0.3) * (1 - ph);
        ctx.fillStyle = '#f4efe6';
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // spring: compressed when pressing, oscillating while moving
    const base = cs * 0.2;
    const len = pressing ? base * 0.55 : moving ? base * (0.85 + 0.15 * Math.sin(t * 18)) : base;
    const x0 = -cs * 0.02;
    const x1 = x0 - len;
    const coils = 4;
    const amp = cs * 0.1;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    for (let i = 0; i <= coils * 2; i++) {
      const u = x0 - (len * i) / (coils * 2);
      ctx.lineTo(u, i === 0 || i === coils * 2 ? 0 : i % 2 ? -amp : amp);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(30,18,6,0.9)';
    ctx.lineWidth = Math.max(2, cs * 0.05);
    ctx.stroke();
    ctx.strokeStyle = BRASS_HI;
    ctx.lineWidth = Math.max(1, cs * 0.025);
    ctx.stroke();
    // mounting plate on the box and a push pad at the spring's end
    ctx.fillStyle = brassGrad(ctx, 0, -cs * 0.17, 0, cs * 0.17);
    ctx.strokeStyle = 'rgba(30,18,6,0.85)';
    ctx.lineWidth = Math.max(1, cs * 0.015);
    const plate = roundRectPath(-cs * 0.035, -cs * 0.16, cs * 0.05, cs * 0.32, cs * 0.015);
    ctx.fill(plate);
    ctx.stroke(plate);
    const pad = roundRectPath(x1 - cs * 0.06, -cs * 0.14, cs * 0.06, cs * 0.28, cs * 0.02);
    ctx.fillStyle = '#6b4526';
    ctx.fill(pad);
    ctx.stroke(pad);
    ctx.fillStyle = colorHex(b.color);
    ctx.fillRect(x1 - cs * 0.045, -cs * 0.09, cs * 0.03, cs * 0.18);
    ctx.restore();
    if (pressing) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      const fronts = b.cells.filter((c) => !own.has(`${c.x + fx},${c.y + fy}`));
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.35 * pulse;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = Math.max(1.5, cs * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const c of fronts) {
        const ex = px + (c.x + 0.5 + fx * 0.44) * cs;
        const ey = py + (c.y + 0.5 + fy * 0.44) * cs;
        ctx.moveTo(ex - fy * cs * 0.32, ey - fx * cs * 0.32);
        ctx.lineTo(ex + fy * cs * 0.32, ey + fx * cs * 0.32);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- hero: a clockwork tin figure with a wind-up key ----------

  override hero(host: SkinHost, p: HeroPose): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const { cx, cy, R, bob } = p;
    const sv = p.slide;
    const sq = p.squash;
    if (sv) {
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.16 / i;
        ctx.fillStyle = '#d9dde2';
        ctx.fill(roundRectPath(cx - sv[0] * i * cs * 0.3 - R * 0.7, cy - sv[1] * i * cs * 0.3 - R * 0.9, R * 1.4, R * 1.8, R * 0.5));
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 + bob * 3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, p.groundY, R * 0.75, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (sv) {
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(sv[1], sv[0]));
      ctx.scale(1.12, 0.88);
      ctx.rotate(-Math.atan2(sv[1], sv[0]) + (sv[0] !== 0 ? sv[0] * 0.15 : 0));
      ctx.translate(-cx, -cy);
    }
    const foot = cy + R;
    ctx.translate(cx, foot);
    ctx.scale(1 + (1 - sq) * 0.7, sq);
    ctx.translate(-cx, -foot);
    const facing = p.facing ?? 'down';
    const [fx, fy] = DIR_VEC[facing];
    const ink = 'rgba(28,20,14,0.95)';
    const olw = Math.max(1.2, cs * 0.025);
    const tnow = performance.now() * 0.001;

    // wind-up key: on the back when facing sideways, on the right side otherwise
    const keySide = fx !== 0 ? -fx : 1;
    const keyBehind = fy < 0; // facing away: the key is in front of the body (drawn after)
    const drawKey = () => {
      const kx = cx + keySide * R * 0.78;
      const ky = cy - R * 0.05;
      const spin = tnow * 2.4;
      ctx.save();
      ctx.translate(kx, ky);
      ctx.strokeStyle = ink;
      ctx.lineWidth = olw;
      ctx.fillStyle = brassGrad(ctx, -R * 0.2, -R * 0.4, R * 0.2, R * 0.4);
      // shaft
      ctx.fillRect(keySide > 0 ? 0 : -R * 0.22, -R * 0.06, R * 0.22, R * 0.12);
      ctx.strokeRect(keySide > 0 ? 0 : -R * 0.22, -R * 0.06, R * 0.22, R * 0.12);
      // bow: two lobes, foreshortened as it turns
      ctx.translate(keySide * R * 0.3, 0);
      ctx.scale(Math.max(0.25, Math.abs(Math.cos(spin))), 1);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(0, s * R * 0.2, R * 0.15, R * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3a2a14';
        ctx.beginPath();
        ctx.arc(0, s * R * 0.22, R * 0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = brassGrad(ctx, -R * 0.2, -R * 0.4, R * 0.2, R * 0.4);
      }
      ctx.restore();
    };
    if (!keyBehind) drawKey();

    // legs (little tin feet that alternate with the bob)
    const step = Math.sin(tnow * 10) * (bob !== 0 ? 1 : 0);
    ctx.fillStyle = '#4b4f57';
    for (const s of [-1, 1]) {
      const lx = cx + s * R * 0.3;
      ctx.fill(roundRectPath(lx - R * 0.16, cy + R * 0.55 - s * step * R * 0.06, R * 0.32, R * 0.42, R * 0.1));
    }
    // body: a tin can with a painted band and rivets
    const bw = R * 1.3;
    const bh = R * 1.05;
    const body = roundRectPath(cx - bw / 2, cy - R * 0.25, bw, bh, R * 0.28);
    const tin = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    tin.addColorStop(0, '#8d949c');
    tin.addColorStop(0.3, '#eef1f4');
    tin.addColorStop(0.6, '#b9bfc6');
    tin.addColorStop(1, '#6d737b');
    ctx.fillStyle = tin;
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = '#c2412f';
    ctx.fillRect(cx - bw / 2, cy + R * 0.12, bw, R * 0.26);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(cx - bw / 2, cy + R * 0.12, bw, R * 0.05);
    ctx.restore();
    ctx.lineWidth = olw;
    ctx.strokeStyle = ink;
    ctx.stroke(body);
    ctx.fillStyle = BRASS_HI;
    for (const s of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * bw * 0.32, cy + R * 0.25, R * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    // head: a dome with a brass rim and a little antenna knob
    const hy = cy - R * 0.42;
    const hr = R * 0.5;
    const hg = ctx.createRadialGradient(cx - hr * 0.4, hy - hr * 0.5, hr * 0.1, cx, hy, hr * 1.1);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.5, '#cfd4da');
    hg.addColorStop(1, '#7c838c');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(cx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = brassGrad(ctx, 0, hy + hr * 0.6, 0, hy + hr * 1.05);
    ctx.fill(roundRectPath(cx - hr * 0.85, hy + hr * 0.62, hr * 1.7, hr * 0.32, hr * 0.15));
    ctx.stroke(roundRectPath(cx - hr * 0.85, hy + hr * 0.62, hr * 1.7, hr * 0.32, hr * 0.15));
    ctx.beginPath();
    ctx.moveTo(cx, hy - hr);
    ctx.lineTo(cx, hy - hr - R * 0.18);
    ctx.stroke();
    ctx.fillStyle = '#c2412f';
    ctx.beginPath();
    ctx.arc(cx, hy - hr - R * 0.2, R * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // eyes (rivet-like) look toward `facing`; none when facing away
    if (fy >= 0 || fx !== 0) {
      const ex = cx + fx * hr * 0.35;
      const ey = hy + fy * hr * 0.15 + hr * 0.05;
      const sep = fx !== 0 ? hr * 0.28 : hr * 0.38;
      for (const x of fx !== 0 ? [ex - sep * 0.5 + fx * hr * 0.1, ex + sep * 0.5 + fx * hr * 0.1] : [ex - sep, ex + sep]) {
        ctx.fillStyle = '#1c1612';
        ctx.beginPath();
        ctx.arc(x, ey, hr * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(x - hr * 0.05, ey - hr * 0.05, hr * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (keyBehind) drawKey();
    ctx.restore();
  }

  /** Overview viewport outline: parchment-colored dashes over a dark under-line (reads on wood). */
  override viewportOutline(host: SkinHost, alpha: number, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX + r.x0 * cs;
    const y = host.originY + r.y0 * cs;
    const w = (r.x1 - r.x0) * cs;
    const h = (r.y1 - r.y0) * cs;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(3, 4 * host.dpr);
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#ffd98a';
    ctx.lineWidth = Math.max(2, 2 * host.dpr);
    ctx.setLineDash([6 * host.dpr, 4 * host.dpr]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
