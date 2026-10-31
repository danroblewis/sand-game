// Skin "terrarium": a lush glass greenhouse. Deep green-black glass with condensation and a faint
// lattice; glass planters hold the colored soils (sand boxes); woven baskets tinted by color with a
// leaf tag (boxes); frost-covered pots with the counter on a frosty label (frozen boxes); mossy
// stone (walls); trickling water channels with paddle wheels (belts); a coiled vine spring on the
// back of driven boxes (exhaust = drifting leaves and spores); a round sprout creature (hero).
// Repeated textures (glass + lattice, weave, stone, moss, leaf tags) are baked offscreen at the
// current cell size. Gameplay affordances (counters, force arrows, selection, kick arrow, pings,
// overview outline) keep slate's shapes so they read the same in every skin.
import type { Box, ColorId, ConveyorState, Dir, SandRegion, Vec } from '../../core/types';
import type { Effect } from '../renderer';
import type { HeroPose, SkinHost } from './skin';
import { SlateSkin } from './slate';
import { boxStroke, colorHex, colorRGBA } from '../colors';
import { terrariumProgression } from './progression/terrarium';
import type { SkinProgression } from './progression/types';
import { DIR_ANGLE, DIR_VEC, POP_MS, loopsPath, roundRectPath, shapeOutline } from '../geom';

const FRAME = '#060d09';
const GLASS_TOP = '#11251b';
const GLASS_BOT = '#08130d';
const LEAF = '#5fbf4f';
const LEAF_DARK = '#2f7a34';
const LEAF_LIGHT = '#a6e27a';
const FROST_TEXT = '#17443c';

/** Deterministic PRNG (same textures every load). */
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

/** Draw `fn` at the 9 wrap offsets of a T x T tile so shapes crossing an edge tile seamlessly. */
function wrapped(T: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) fn(dx, dy);
}

/** A pointed leaf along +x from the origin, length L, half-width W. */
function leafPath(g: CanvasRenderingContext2D | Path2D, L: number, W: number): void {
  g.moveTo(0, 0);
  g.bezierCurveTo(L * 0.3, -W * 1.25, L * 0.75, -W * 0.9, L, 0);
  g.bezierCurveTo(L * 0.75, W * 0.9, L * 0.3, W * 1.25, 0, 0);
}

/** Cell nearest the shape centroid (rectangles: the true centre). */
function counterSpot(b: Box): { x: number; y: number } {
  let mx = 0;
  let my = 0;
  for (const c of b.cells) {
    mx += c.x + 0.5;
    my += c.y + 0.5;
  }
  mx /= b.cells.length;
  my /= b.cells.length;
  if (b.cells.length === b.bw * b.bh) return { x: mx, y: my };
  let best = b.cells[0];
  let bd = Infinity;
  for (const c of b.cells) {
    const d = (c.x + 0.5 - mx) ** 2 + (c.y + 0.5 - my) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return { x: best.x + 0.5, y: best.y + 0.5 };
}

interface Baked {
  cs: number;
  dpr: number;
  /** Board glass: lattice + condensation, 5x5 cells. */
  glass: CanvasPattern;
  glassT: number;
  /** Condensation only (for planter glass), same tile size. */
  drops: CanvasPattern;
  /** Basket weave, half a cell. */
  weave: CanvasPattern;
  /** Mossy stone, 2x2 cells. */
  stone: CanvasPattern;
  /** Moss cap for one cell of a wall's top edge (width cs, drawn from y - cap overhang). */
  moss: HTMLCanvasElement;
  /** Leaf tags per color (lazily baked). */
  tags: Map<ColorId, HTMLCanvasElement>;
}

export class TerrariumSkin extends SlateSkin {
  override readonly id: string = 'terrarium';
  override readonly name: string = 'Terrarium';
  override readonly pageBg: string = '#08110c';
  override readonly progression: SkinProgression = terrariumProgression;
  private baked: Baked | null = null;

  // ------------------------------------------------------------------ baking
  bake(host: SkinHost): void {
    const cs = Math.round(host.cellSize);
    if (cs < 4) return;
    const dpr = host.dpr;
    const ctx = host.ctx;

    // --- board glass: lattice + condensation (4x4 cells) ---
    const T = cs * 5;
    const [gc, g] = canvas(T, T);
    const drawDrops = (d: CanvasRenderingContext2D, alpha: number) => {
      const r = rng(0x5eed7e44);
      for (let i = 0; i < 72; i++) {
        const x = r() * T;
        const y = r() * T;
        const big = r() < 0.18;
        const rad = cs * (big ? 0.05 + r() * 0.035 : 0.012 + r() * 0.025);
        const trail = big && r() < 0.6 ? cs * (0.25 + r() * 0.7) : 0;
        wrapped(T, (dx, dy) => {
          const cx = x + dx;
          const cy = y + dy;
          if (cx < -cs || cy < -cs * 2 || cx > T + cs || cy > T + cs) return;
          if (trail) {
            // a run-down trail above a big drop
            const tg = d.createLinearGradient(0, cy - trail, 0, cy);
            tg.addColorStop(0, 'rgba(190,255,215,0)');
            tg.addColorStop(1, `rgba(190,255,215,${0.06 * alpha})`);
            d.fillStyle = tg;
            d.fillRect(cx - rad * 0.45, cy - trail, rad * 0.9, trail);
          }
          d.fillStyle = `rgba(185,250,215,${0.07 * alpha})`;
          d.beginPath();
          d.arc(cx, cy, rad, 0, Math.PI * 2);
          d.fill();
          d.strokeStyle = `rgba(0,0,0,${0.22 * alpha})`;
          d.lineWidth = Math.max(0.6, rad * 0.25);
          d.beginPath();
          d.arc(cx, cy, rad * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
          d.stroke();
          d.fillStyle = `rgba(255,255,255,${(big ? 0.5 : 0.32) * alpha})`;
          d.beginPath();
          d.arc(cx - rad * 0.35, cy - rad * 0.35, Math.max(0.6, rad * 0.32), 0, Math.PI * 2);
          d.fill();
        });
      }
    };
    // lattice (thin glazing bars on the cell grid, small joints at crossings)
    const lw = Math.max(1, Math.round(dpr));
    g.fillStyle = 'rgba(150,230,175,0.055)';
    for (let i = 0; i < 5; i++) {
      g.fillRect(i * cs, 0, lw, T);
      g.fillRect(0, i * cs, T, lw);
    }
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < 5; i++) {
      g.fillRect(i * cs + lw, 0, lw, T);
      g.fillRect(0, i * cs + lw, T, lw);
    }
    g.fillStyle = 'rgba(170,240,190,0.12)';
    const j = Math.max(1.5, cs * 0.035);
    for (let a = 0; a < 5; a++)
      for (let b = 0; b < 5; b++) {
        g.beginPath();
        g.arc(a * cs + lw / 2, b * cs + lw / 2, j, 0, Math.PI * 2);
        g.fill();
      }
    drawDrops(g, 1);
    const [dc, d] = canvas(T, T);
    drawDrops(d, 1.6);

    // --- basket weave (half a cell, 2x2 blocks of alternating strands) ---
    const W = Math.max(4, Math.round(cs * 0.5));
    const [wc, w] = canvas(W, W);
    const hb = W / 2;
    const strands = 3;
    for (let bx = 0; bx < 2; bx++)
      for (let by = 0; by < 2; by++) {
        const horiz = (bx + by) % 2 === 0;
        for (let s = 0; s < strands; s++) {
          const o = (s + 0.5) * (hb / strands);
          const sw = hb / strands;
          const sx = bx * hb;
          const sy = by * hb;
          const gr = horiz ? w.createLinearGradient(0, sy + o - sw / 2, 0, sy + o + sw / 2) : w.createLinearGradient(sx + o - sw / 2, 0, sx + o + sw / 2, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0.16)');
          gr.addColorStop(0.55, 'rgba(255,255,255,0.03)');
          gr.addColorStop(1, 'rgba(0,0,0,0.2)');
          w.fillStyle = gr;
          if (horiz) w.fillRect(sx, sy + o - sw / 2, hb, sw);
          else w.fillRect(sx + o - sw / 2, sy, sw, hb);
        }
        // shadow where a block dives under its neighbour
        w.fillStyle = 'rgba(0,0,0,0.16)';
        if (horiz) w.fillRect(bx * hb + hb - Math.max(1, hb * 0.08), by * hb, Math.max(1, hb * 0.08), hb);
        else w.fillRect(bx * hb, by * hb + hb - Math.max(1, hb * 0.08), hb, Math.max(1, hb * 0.08));
      }

    // --- mossy stone (2x2 cells) ---
    const S = cs * 2;
    const [sc, s] = canvas(S, S);
    s.fillStyle = '#18211b';
    s.fillRect(0, 0, S, S);
    const r = rng(0x570e57);
    const rows = 6;
    const rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let u = r() * cs * 0.5;
      const start = u;
      while (u < start + S - cs * 0.3) {
        const sw = Math.min(cs * (0.36 + r() * 0.36), start + S - u);
        const gap = Math.max(1, cs * 0.035);
        const x0 = u + gap;
        const y0 = row * rh + gap;
        const ww = sw - gap * 2;
        const hh = rh - gap * 2;
        const tone = 0.8 + r() * 0.35;
        const mossy = r() < 0.45;
        const mx = r();
        const my = r();
        wrapped(S, (dx, dy) => {
          if (dy !== 0) return;
          const p = roundRectPath(x0 + dx, y0, ww, hh, Math.min(ww, hh) * 0.35);
          const sg = s.createLinearGradient(0, y0, 0, y0 + hh);
          sg.addColorStop(0, `rgb(${Math.round(102 * tone)},${Math.round(116 * tone)},${Math.round(104 * tone)})`);
          sg.addColorStop(1, `rgb(${Math.round(64 * tone)},${Math.round(76 * tone)},${Math.round(68 * tone)})`);
          s.fillStyle = sg;
          s.fill(p);
          s.strokeStyle = 'rgba(255,255,255,0.08)';
          s.lineWidth = Math.max(1, cs * 0.02);
          s.stroke(p);
          if (mossy) {
            s.save();
            s.clip(p);
            const cx = x0 + dx + ww * mx;
            const cy = y0 + hh * (my * 0.5);
            for (let k = 0; k < 7; k++) {
              const a = k * 0.9;
              s.fillStyle = k % 2 ? 'rgba(110,170,70,0.55)' : 'rgba(80,140,60,0.6)';
              s.beginPath();
              s.arc(cx + Math.cos(a) * cs * 0.05 * (k % 3), cy + Math.sin(a) * cs * 0.03 * (k % 3), cs * (0.035 + 0.02 * (k % 3)), 0, Math.PI * 2);
              s.fill();
            }
            s.restore();
          }
        });
        u += sw;
      }
    }
    // speckle
    for (let k = 0; k < 80; k++) {
      s.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.18)';
      s.fillRect(r() * S, r() * S, Math.max(1, cs * 0.02), Math.max(1, cs * 0.02));
    }

    // --- moss cap (one cell of a top edge; drawn from y - 0.12cs, 0.4cs tall) ---
    const [mc, m] = canvas(cs, cs * 0.42);
    const mr = rng(0x3055);
    const capY = cs * 0.12;
    m.save();
    // hanging strands
    for (let k = 0; k < 3; k++) {
      const x = cs * (0.15 + mr() * 0.7);
      const len = cs * (0.1 + mr() * 0.18);
      m.strokeStyle = 'rgba(96,160,70,0.75)';
      m.lineWidth = Math.max(1, cs * 0.025);
      m.lineCap = 'round';
      m.beginPath();
      m.moveTo(x, capY);
      m.quadraticCurveTo(x + cs * 0.03, capY + len * 0.6, x - cs * 0.01, capY + len);
      m.stroke();
    }
    // two layers of irregular cushions (dark under, light on top) plus a few blades
    const blob = (x: number, y: number, rad: number, c0: string, c1: string, c2: string) => {
      for (const dx of [-cs, 0, cs]) {
        const mg = m.createRadialGradient(x + dx - rad * 0.35, y - rad * 0.4, rad * 0.1, x + dx, y, rad);
        mg.addColorStop(0, c0);
        mg.addColorStop(0.6, c1);
        mg.addColorStop(1, c2);
        m.fillStyle = mg;
        m.beginPath();
        m.ellipse(x + dx, y, rad * 1.25, rad, 0, 0, Math.PI * 2);
        m.fill();
      }
    };
    for (let k = 0; k < 9; k++) blob((k / 9) * cs + mr() * cs * 0.06, capY + cs * (0.01 + mr() * 0.03), cs * (0.05 + mr() * 0.04), '#5e9a45', '#3c7634', '#24502a');
    for (let k = 0; k < 11; k++) blob(mr() * cs, capY - cs * (0.005 + mr() * 0.035), cs * (0.022 + mr() * 0.035), '#c4ec8c', '#7cc256', '#3f8a3a');
    m.strokeStyle = 'rgba(170,225,120,0.8)';
    m.lineWidth = Math.max(0.8, cs * 0.012);
    for (let k = 0; k < 7; k++) {
      const x = mr() * cs;
      const lean = (mr() - 0.5) * cs * 0.05;
      m.beginPath();
      m.moveTo(x, capY - cs * 0.01);
      m.quadraticCurveTo(x + lean * 0.4, capY - cs * 0.06, x + lean, capY - cs * (0.07 + mr() * 0.04));
      m.stroke();
    }
    m.restore();

    const glass = ctx.createPattern(gc, 'repeat');
    const drops = ctx.createPattern(dc, 'repeat');
    const weave = ctx.createPattern(wc, 'repeat');
    const stone = ctx.createPattern(sc, 'repeat');
    if (glass && drops && weave && stone) this.baked = { cs, dpr, glass, glassT: T, drops, weave, stone, moss: mc, tags: new Map() };
  }

  private ensure(host: SkinHost): Baked | null {
    const cs = host.cellSize;
    const b = this.baked;
    if ((!b || (b.cs !== Math.round(cs) && Math.abs(cs - Math.round(cs)) < 0.01) || b.dpr !== host.dpr) && cs >= 4) this.bake(host);
    return this.baked;
  }

  /** Fill a rect with a baked pattern anchored at (ax, ay), scaled from the baked cell size. */
  private fillPat(ctx: CanvasRenderingContext2D, pat: CanvasPattern, k: number, ax: number, ay: number, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(k, k);
    ctx.fillStyle = pat;
    ctx.fillRect((x - ax) / k, (y - ay) / k, w / k, h / k);
    ctx.restore();
  }

  private leafTag(color: ColorId, cs: number): HTMLCanvasElement {
    const b = this.baked!;
    let t = b.tags.get(color);
    if (t) return t;
    const L = cs * 0.34;
    const [c, g] = canvas(L + 4, L * 0.7 + 4);
    g.translate(2, c.height / 2);
    const p = new Path2D();
    leafPath(p, L, L * 0.26);
    const lg = g.createLinearGradient(0, -L * 0.3, 0, L * 0.3);
    lg.addColorStop(0, colorRGBA(color, 1));
    lg.addColorStop(1, boxStroke(color));
    g.fillStyle = lg;
    g.fill(p);
    g.strokeStyle = 'rgba(20,40,20,0.7)';
    g.lineWidth = Math.max(1, cs * 0.018);
    g.stroke(p);
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = Math.max(0.8, cs * 0.012);
    g.beginPath();
    g.moveTo(L * 0.12, 0);
    g.lineTo(L * 0.88, 0);
    for (const u of [0.35, 0.55, 0.72]) {
      g.moveTo(L * u, 0);
      g.lineTo(L * (u + 0.1), -L * 0.11);
      g.moveTo(L * u, 0);
      g.lineTo(L * (u + 0.1), L * 0.11);
    }
    g.stroke();
    // twine hole
    g.fillStyle = 'rgba(10,20,10,0.85)';
    g.beginPath();
    g.arc(L * 0.14, 0, Math.max(1, cs * 0.018), 0, Math.PI * 2);
    g.fill();
    t = c;
    b.tags.set(color, t);
    return t;
  }

  // ------------------------------------------------------------------ board
  override board(host: SkinHost): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX;
    const y = host.originY;
    const w = cs * host.boardW;
    const h = cs * host.boardH;
    const pad = Math.round(cs * 0.1);
    const bk = this.ensure(host);
    const frame = roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, cs * 0.16);
    ctx.fillStyle = FRAME;
    ctx.fill(frame);
    const inner = roundRectPath(x, y, w, h, cs * 0.1);
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, GLASS_TOP);
    bg.addColorStop(1, GLASS_BOT);
    ctx.fillStyle = bg;
    ctx.fill(inner);
    ctx.save();
    ctx.clip(inner);
    // light through the glass from the top-left
    const R = Math.max(w, h);
    const lg = ctx.createRadialGradient(x + w * 0.15, y - h * 0.1, 0, x + w * 0.15, y - h * 0.1, R * 0.9);
    lg.addColorStop(0, 'rgba(150,235,160,0.10)');
    lg.addColorStop(1, 'rgba(150,235,160,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, w, h);
    if (bk) {
      this.fillPat(ctx, bk.glass, cs / bk.cs, x, y, x, y, w, h);
    } else {
      ctx.beginPath();
      for (let i = 1; i < host.boardW; i++) {
        ctx.moveTo(x + i * cs + 0.5, y);
        ctx.lineTo(x + i * cs + 0.5, y + h);
      }
      for (let j = 1; j < host.boardH; j++) {
        ctx.moveTo(x, y + j * cs + 0.5);
        ctx.lineTo(x + w, y + j * cs + 0.5);
      }
      ctx.strokeStyle = 'rgba(150,230,175,0.06)';
      ctx.lineWidth = Math.max(1, host.dpr);
      ctx.stroke();
    }
    // a soft vignette at the base, like humus under the glass
    const vg = ctx.createLinearGradient(0, y + h - cs * 1.2, 0, y + h);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vg;
    ctx.fillRect(x, y + h - cs * 1.2, w, cs * 1.2);
    ctx.restore();
    // frame bevel: a glassy highlight on the top/left, a dark lip
    ctx.strokeStyle = 'rgba(170,240,190,0.16)';
    ctx.lineWidth = Math.max(1, host.dpr);
    ctx.stroke(frame);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke(inner);
  }

  // ------------------------------------------------------------------ planters
  /** Glass planter: thick tinted glass, reflections, condensation, a bright lip. */
  override sandBox(host: SkinHost, gx: number, gy: number, gw: number, gh: number, region: SandRegion): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX + gx * cs;
    const y = host.originY + gy * cs;
    const w = gw * cs;
    const h = gh * cs;
    const bk = this.baked;
    const inset = Math.max(1, Math.round(cs * 0.05));
    const glass = roundRectPath(x + inset, y + inset, w - inset * 2, h - inset * 2, cs * 0.16);

    ctx.fillStyle = 'rgba(160,240,200,0.06)';
    ctx.fill(glass);
    ctx.save();
    ctx.clip(glass);
    const rc = host.regionCanvas(region);
    ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, x, y, w, h);
    // inner shadow: the glass is thick at the rim
    const sh = cs * 0.16;
    let g = ctx.createLinearGradient(x, 0, x + sh, 0);
    g.addColorStop(0, 'rgba(10,40,25,0.4)');
    g.addColorStop(1, 'rgba(10,40,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, sh, h);
    g = ctx.createLinearGradient(x + w, 0, x + w - sh, 0);
    g.addColorStop(0, 'rgba(10,40,25,0.4)');
    g.addColorStop(1, 'rgba(10,40,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + w - sh, y, sh, h);
    g = ctx.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, sh);
    // condensation on the glass (faint, over the soil too)
    if (bk) {
      ctx.globalAlpha = 0.55;
      this.fillPat(ctx, bk.drops, cs / bk.cs, x, y, x, y, w, h);
      ctx.globalAlpha = 1;
    }
    // reflections: a broad sheen and two vertical streaks
    g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(220,255,235,0.12)');
    g.addColorStop(0.4, 'rgba(220,255,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(235,255,240,0.13)';
    ctx.fillRect(x + inset + cs * 0.1, y + cs * 0.12, Math.max(1, cs * 0.06), h - cs * 0.3);
    ctx.fillStyle = 'rgba(235,255,240,0.08)';
    ctx.fillRect(x + inset + cs * 0.2, y + cs * 0.12, Math.max(1, cs * 0.025), h - cs * 0.3);
    ctx.restore();

    // glass edge + a thick lip on top
    ctx.strokeStyle = 'rgba(190,250,215,0.42)';
    ctx.lineWidth = Math.max(1, cs * 0.04);
    ctx.stroke(glass);
    const lip = roundRectPath(x + inset * 0.5, y + inset * 0.5, w - inset, Math.max(2, cs * 0.09), cs * 0.05);
    const lg = ctx.createLinearGradient(0, y, 0, y + cs * 0.1);
    lg.addColorStop(0, 'rgba(230,255,240,0.55)');
    lg.addColorStop(1, 'rgba(150,220,180,0.18)');
    ctx.fillStyle = lg;
    ctx.fill(lip);
  }

  // ------------------------------------------------------------------ walls
  /** Mossy stone: baked cobbles inside the merged wall shape, moss caps on every top edge. */
  override walls(host: SkinHost, loops: Vec[][]): void {
    if (loops.length === 0) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const bk = this.ensure(host);
    const path = loopsPath(loops, host.originX, host.originY, cs, cs * 0.03, cs * 0.14);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = cs * 0.14;
    ctx.shadowOffsetY = cs * 0.05;
    ctx.fillStyle = '#3c4a40';
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.clip(path);
    if (bk) {
      const W = host.boardW * cs;
      const H = host.boardH * cs;
      this.fillPat(ctx, bk.stone, cs / bk.cs, host.originX, host.originY, host.originX, host.originY, W, H);
    }
    const e = Math.max(1, cs * 0.045);
    ctx.lineWidth = e * 2;
    ctx.translate(e, e);
    ctx.strokeStyle = 'rgba(200,255,210,0.1)';
    ctx.stroke(path);
    ctx.translate(-2 * e, -2 * e);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(path);
    // moss on top edges (clockwise loops in y-down: a top edge runs left to right)
    if (!bk) return;
    const mh = (cs / bk.moss.width) * bk.moss.height;
    for (const loop of loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const c = loop[i];
        const q = loop[(i + 1) % n];
        if (q.y !== c.y || q.x <= c.x) continue;
        for (let u = c.x; u < q.x; u++) {
          ctx.drawImage(bk.moss, 0, 0, bk.moss.width, bk.moss.height, host.originX + u * cs, host.originY + c.y * cs + cs * 0.03 - cs * 0.12, cs, mh);
        }
      }
    }
  }

  // ------------------------------------------------------------------ belts
  /** A trickling water channel: stone trough, flowing ripples, a paddle wheel at each end. */
  override belt(host: SkinHost, cv: ConveyorState, _now: number, progress: number, active: number): void {
    const cells = cv.cells && cv.cells.length ? cv.cells : [{ x: cv.x, y: cv.y }];
    const ctx = host.ctx;
    const cs = host.cellSize;
    const [dx, dy] = DIR_VEC[cv.dir];
    const start = cells[0];
    const ox = host.originX + (start.x + 0.5 - dx * 0.5) * cs;
    const oy = host.originY + (start.y + 0.5 - dy * 0.5) * cs;
    const L = cells.length * cs;
    const half = cs * 0.36;
    const inset = cs * 0.06;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(DIR_ANGLE[cv.dir]);
    // trough
    const trough = roundRectPath(inset, -half, L - inset * 2, half * 2, cs * 0.14);
    ctx.fillStyle = '#26332a';
    ctx.fill(trough);
    ctx.strokeStyle = 'rgba(120,180,110,0.35)';
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.stroke(trough);
    // water
    const wh = half - cs * 0.07;
    const water = roundRectPath(inset + cs * 0.06, -wh, L - inset * 2 - cs * 0.12, wh * 2, cs * 0.09);
    const wg = ctx.createLinearGradient(0, -wh, 0, wh);
    wg.addColorStop(0, '#0c3b3f');
    wg.addColorStop(0.5, active > 0 ? `rgb(${30 + 20 * active},${110 + 30 * active},${118 + 30 * active})` : '#1d6b70');
    wg.addColorStop(1, '#0a3236');
    ctx.fillStyle = wg;
    ctx.fill(water);
    ctx.save();
    ctx.clip(water);
    // ripples: soft arcs bowing in the flow direction
    const spacing = cs * 0.5;
    const phase = (((progress * cs) % spacing) + spacing) % spacing;
    const cw = cs * 0.12;
    ctx.beginPath();
    for (let u = -spacing + phase; u < L + spacing; u += spacing) {
      ctx.moveTo(u - cw, -wh * 0.62);
      ctx.quadraticCurveTo(u + cw * 0.6, 0, u - cw, wh * 0.62);
    }
    ctx.strokeStyle = `rgba(190,250,240,${0.22 + 0.33 * active})`;
    ctx.lineWidth = Math.max(1.5, cs * 0.045);
    ctx.lineCap = 'round';
    ctx.stroke();
    // glints drifting with the water (a touch faster than the ripples)
    ctx.fillStyle = 'rgba(235,255,250,0.55)';
    const gp = (((progress * cs * 1.3) % spacing) + spacing) % spacing;
    for (let u = -spacing + gp; u < L + spacing; u += spacing) {
      const v = Math.sin(u * 0.37 + start.x * 1.7 + start.y) * wh * 0.5;
      ctx.fillRect(u + cs * 0.18, v, Math.max(1, cs * 0.05), Math.max(1, cs * 0.02));
    }
    ctx.restore();
    // paddle wheels at both ends (turn with the flow)
    const wr = half * 0.62;
    const ang = progress * 2.4;
    for (const u of [inset + wr + cs * 0.04, L - inset - wr - cs * 0.04]) {
      ctx.save();
      ctx.translate(u, 0);
      ctx.rotate(ang);
      ctx.fillStyle = '#a57d48';
      ctx.strokeStyle = 'rgba(40,25,10,0.85)';
      ctx.lineWidth = Math.max(1, cs * 0.018);
      for (let k = 0; k < 6; k++) {
        ctx.rotate(Math.PI / 3);
        const p = roundRectPath(wr * 0.2, -wr * 0.13, wr * 0.82, wr * 0.26, wr * 0.06);
        ctx.fill(p);
        ctx.stroke(p);
      }
      ctx.fillStyle = '#6d4f2a';
      ctx.beginPath();
      ctx.arc(0, 0, wr * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d7b57c';
      ctx.beginPath();
      ctx.arc(0, 0, wr * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ baskets
  protected override boxRadius(cs: number, inset: number): number {
    return Math.min(cs * 0.2, (cs - inset * 2) / 2);
  }
  protected override boxFillStyle(color: ColorId): string {
    return colorRGBA(color, 0.3);
  }
  protected override boxStrokeStyle(color: ColorId): string {
    return boxStroke(color);
  }
  /** Woven basket texture over the soil, and a soft top sheen. */
  protected override boxSurface(host: SkinHost, x: number, y: number, w: number, h: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const bk = this.baked;
    if (bk) this.fillPat(ctx, bk.weave, cs / bk.cs, x, y, x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + cs * 0.4);
    g.addColorStop(0, 'rgba(255,255,230,0.12)');
    g.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, cs * 0.4);
  }
  /** Stitched rim (dashes over the outline) and a leaf tag tied at the top-right corner. */
  protected override boxDecor(host: SkinHost, loops: Vec[][], px: number, py: number, color: ColorId): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const inset = cs * 0.06;
    const path = loopsPath(loops, px, py, cs, inset, this.boxRadius(cs, inset));
    ctx.save();
    ctx.strokeStyle = 'rgba(40,24,8,0.45)';
    ctx.lineWidth = Math.max(1, cs * 0.028);
    ctx.setLineDash([Math.max(2, cs * 0.07), Math.max(2, cs * 0.06)]);
    ctx.stroke(path);
    ctx.restore();
    if (!this.baked || cs < 10) return;
    // top-right corner of the topmost row
    let best: Vec | null = null;
    for (const loop of loops)
      for (const v of loop) if (!best || v.y < best.y || (v.y === best.y && v.x > best.x)) best = v;
    if (!best) return;
    const tag = this.leafTag(color, Math.round(cs));
    const k = cs / Math.round(cs);
    const tx = px + best.x * cs - cs * 0.16;
    const ty = py + best.y * cs + cs * 0.15;
    ctx.save();
    ctx.translate(tx, ty);
    // twine from the rim
    ctx.strokeStyle = 'rgba(230,214,170,0.85)';
    ctx.lineWidth = Math.max(1, cs * 0.016);
    ctx.beginPath();
    ctx.moveTo(cs * 0.06, -cs * 0.07);
    ctx.quadraticCurveTo(cs * 0.05, -cs * 0.01, 0, 0);
    ctx.stroke();
    ctx.rotate(Math.PI * 0.72);
    ctx.drawImage(tag, -2 * k, (-tag.height / 2) * k, tag.width * k, tag.height * k);
    ctx.restore();
  }

  // ------------------------------------------------------------------ frozen pots
  /** Frost-covered pot: icy glaze, frost texture, a snow cap on the top edges, a frosty label. */
  protected override frozenBody(host: SkinHost, b: Box, path: Path2D, px: number, py: number, lw: number, outline?: Vec[][]): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const grad = ctx.createLinearGradient(px, py, px, py + b.bh * cs);
    grad.addColorStop(0, 'rgba(226,244,238,0.95)');
    grad.addColorStop(1, 'rgba(150,196,196,0.93)');
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    // the pot underneath: a terracotta blush at the bottom and a rim band
    const tg = ctx.createLinearGradient(0, py + b.bh * cs * 0.4, 0, py + b.bh * cs);
    tg.addColorStop(0, 'rgba(196,110,70,0)');
    tg.addColorStop(1, 'rgba(196,110,70,0.22)');
    ctx.fillStyle = tg;
    ctx.fillRect(px, py, b.bw * cs, b.bh * cs);
    ctx.fillStyle = 'rgba(60,110,110,0.22)';
    ctx.fillRect(px, py + cs * 0.24, b.bw * cs, Math.max(1, cs * 0.05));
    ctx.restore();
    const frost = this.frostPattern(host);
    if (frost) {
      ctx.fillStyle = frost;
      ctx.fill(path);
    }
    ctx.strokeStyle = '#effcf8';
    ctx.lineWidth = lw;
    ctx.stroke(path);
    // snow cap: scallops along every top edge
    const loops = outline ?? shapeOutline(b.shape, b.cells);
    ctx.fillStyle = '#ffffff';
    for (const loop of loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const c = loop[i];
        const q = loop[(i + 1) % n];
        if (q.y !== c.y || q.x <= c.x) continue;
        const x0 = px + c.x * cs + cs * 0.12;
        const x1 = px + q.x * cs - cs * 0.12;
        const yy = py + c.y * cs + cs * 0.07;
        const nB = Math.max(2, Math.round((x1 - x0) / (cs * 0.17)));
        const step = (x1 - x0) / nB;
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        for (let k = 0; k < nB; k++) ctx.quadraticCurveTo(x0 + (k + 0.5) * step, yy + cs * (k % 2 ? 0.07 : 0.11), x0 + (k + 1) * step, yy);
        ctx.lineTo(x1, yy - cs * 0.03);
        ctx.lineTo(x0, yy - cs * 0.03);
        ctx.closePath();
        ctx.fill();
      }
    }
    // frosty label with the counter
    const spot = counterSpot(b);
    const tx = px + spot.x * cs;
    const ty = py + spot.y * cs + cs * 0.04;
    const fs = Math.round(Math.max(cs * 0.5, 12 * host.dpr));
    ctx.font = `800 ${fs}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    const text = String(b.frozen);
    const tw = ctx.measureText(text).width;
    const lh = fs * 1.12;
    const lwid = Math.max(lh * 1.05, tw + fs * 0.55);
    const label = roundRectPath(tx - lwid / 2, ty - lh / 2, lwid, lh, lh * 0.22);
    ctx.save();
    ctx.shadowColor = 'rgba(20,60,55,0.35)';
    ctx.shadowBlur = cs * 0.06;
    ctx.shadowOffsetY = cs * 0.02;
    ctx.fillStyle = 'rgba(246,252,244,0.96)';
    ctx.fill(label);
    ctx.restore();
    ctx.strokeStyle = 'rgba(70,130,120,0.55)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(label);
    // frost rime on the label's top edge
    ctx.fillStyle = 'rgba(190,230,235,0.7)';
    ctx.fillRect(tx - lwid / 2 + lh * 0.2, ty - lh / 2 + Math.max(1, cs * 0.02), lwid - lh * 0.4, Math.max(1, cs * 0.03));
    ctx.fillStyle = FROST_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx, ty + fs * 0.05);
  }

  // ------------------------------------------------------------------ driven boxes
  /** Face arrow (affordance, as slate) and a coiled vine spring on the back edge. */
  protected override pressureColor(): string | null {
    return '#eaffc8';
  }

  protected override drawForce(host: SkinHost, b: Box, px: number, py: number, now: number): void {
    const force = b.force;
    if (!force) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const pressing = !!b.pressing && b.frozen === 0;
    const moving = !!host.forces?.has(b.id) && b.frozen === 0;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    const spot = counterSpot(b);
    // face arrow on the centre cell (rectangles: the cell nearest the centre)
    const ac = b.cells.length === b.bw * b.bh ? { x: Math.floor(spot.x - 0.5) + 0.5, y: Math.floor(spot.y - 0.5) + 0.5 } : spot;
    ctx.save();
    ctx.translate(px + ac.x * cs, py + ac.y * cs);
    ctx.rotate(DIR_ANGLE[force]);
    ctx.globalAlpha = b.frozen > 0 ? 0.3 : 0.55;
    ctx.strokeStyle = b.frozen > 0 ? FROST_TEXT : '#ffffff';
    ctx.lineWidth = Math.max(2, cs * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-cs * 0.12, -cs * 0.17);
    ctx.lineTo(cs * 0.08, 0);
    ctx.lineTo(-cs * 0.12, cs * 0.17);
    ctx.stroke();
    ctx.restore();
    if (b.frozen > 0) return;

    const backs = b.cells.filter((c) => !own.has(`${c.x - fx},${c.y - fy}`));
    const back = backs[Math.floor(backs.length / 2)];
    const nx = px + (back.x + 0.5 - fx * 0.5) * cs;
    const ny = py + (back.y + 0.5 - fy * 0.5) * cs;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    const len = cs * (pressing ? 0.24 + 0.02 * pulse : moving ? 0.42 + 0.05 * Math.sin(now * 0.02) : 0.34);
    const amp = cs * 0.14;
    const coils = 3;
    const loopR = Math.min(cs * 0.07, (len / coils) * 0.75);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(DIR_ANGLE[force]);
    // local frame: +x = force, the spring reaches back along -x
    if (pressing) {
      const g = ctx.createRadialGradient(-len * 0.5, 0, 0, -len * 0.5, 0, cs * 0.45);
      g.addColorStop(0, `rgba(200,255,140,${0.3 + 0.25 * pulse})`);
      g.addColorStop(1, 'rgba(200,255,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-len * 0.5 - cs * 0.45, -cs * 0.45, cs * 0.9, cs * 0.9);
    }
    // the coil: a projected helix; back half darker, drawn first
    const N = 72;
    const pt = (t: number): [number, number] => {
      const a = t * coils * Math.PI * 2;
      return [-t * len + Math.sin(a) * loopR, -Math.cos(a) * amp];
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = LEAF_DARK;
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const [x, y] = pt(i / N);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = pressing ? '#c8f27a' : LEAF;
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.stroke();
    // little leaves on the vine
    for (const [t, side] of [[0.33, -1], [0.7, 1]] as const) {
      const [x, y] = pt(t);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI + side * 0.9);
      ctx.beginPath();
      leafPath(ctx, cs * 0.16, cs * 0.05);
      ctx.fillStyle = LEAF_LIGHT;
      ctx.fill();
      ctx.restore();
    }
    // a curled tendril at the free end
    const [ex, ey] = pt(1);
    ctx.strokeStyle = LEAF;
    ctx.lineWidth = Math.max(1, cs * 0.025);
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2.4;
      const rr = cs * 0.07 * (1 - i / 22);
      const x = ex - cs * 0.04 - Math.sin(a) * rr;
      const y = ey + rr - Math.cos(a) * rr;
      if (i === 0) ctx.moveTo(ex, ey);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // collar where the vine grips the basket
    ctx.fillStyle = '#3d6b2e';
    ctx.fill(roundRectPath(-cs * 0.045, -cs * 0.15, cs * 0.07, cs * 0.3, cs * 0.03));
    ctx.fillStyle = colorHex(b.color);
    ctx.fillRect(-cs * 0.025, -cs * 0.09, cs * 0.03, cs * 0.18);
    // exhaust while moving: leaves and spores drifting backwards
    if (moving) {
      for (let i = 0; i < 6; i++) {
        const ph = (((now * 0.0022 + i / 6) % 1) + 1) % 1;
        const x = -len - cs * 0.05 - ph * cs * 0.7;
        const y = Math.sin(now * 0.004 + i * 2.1) * cs * 0.1 + (i - 2.5) * cs * 0.05;
        ctx.globalAlpha = 0.85 * (1 - ph);
        if (i % 2) {
          ctx.fillStyle = 'rgba(240,250,190,1)';
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1, cs * 0.025), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(now * 0.005 + i);
          ctx.beginPath();
          leafPath(ctx, cs * 0.13, cs * 0.045);
          ctx.fillStyle = i % 4 ? LEAF_LIGHT : LEAF;
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ hero
  /** A round sprout creature: leafy body, two leaf arms, a sprout on top, eyes toward `facing`. */
  override hero(host: SkinHost, p: HeroPose): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const { cx, cy, R, bob } = p;
    const sv = p.slide;
    const sq = p.squash;
    const t = performance.now();
    if (sv) {
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.18 / i;
        ctx.fillStyle = LEAF_LIGHT;
        ctx.beginPath();
        ctx.arc(cx - sv[0] * i * cs * 0.3, cy - sv[1] * i * cs * 0.3, R * (1 - i * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.32 * (1 + bob * 3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, p.groundY, R * 0.8, R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (sv) {
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(sv[1], sv[0]));
      ctx.scale(1.14, 0.86);
      ctx.rotate(-Math.atan2(sv[1], sv[0]) + (sv[0] !== 0 ? sv[0] * 0.18 : 0));
      ctx.translate(-cx, -cy);
    }
    const foot = cy + R;
    ctx.translate(cx, foot);
    ctx.scale(1 + (1 - sq) * 0.7, sq);
    ctx.translate(-cx, -foot);
    const [fx, fy] = DIR_VEC[p.facing ?? 'down'];
    const sway = Math.sin(t * 0.003) * 0.08;
    // leaf arms (behind the body), flapping a little with the walk bob
    const flap = bob * 4;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * R * 0.78, cy + R * 0.18);
      ctx.rotate(side > 0 ? 0.35 + flap + sway : Math.PI - 0.35 - flap - sway);
      ctx.beginPath();
      leafPath(ctx, R * 0.78, R * 0.26);
      const ag = ctx.createLinearGradient(0, -R * 0.3, 0, R * 0.3);
      ag.addColorStop(0, '#8fd968');
      ag.addColorStop(1, '#3f9440');
      ctx.fillStyle = ag;
      ctx.fill();
      ctx.lineWidth = Math.max(1, cs * 0.02);
      ctx.strokeStyle = 'rgba(18,48,18,0.85)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,255,200,0.55)';
      ctx.beginPath();
      ctx.moveTo(R * 0.1, 0);
      ctx.lineTo(R * 0.62, 0);
      ctx.stroke();
      ctx.restore();
    }
    // sprout on top: a stem with two seed leaves
    const top = cy - R * 0.92;
    const tipX = cx + R * (0.08 + sway * 0.8) - fx * R * 0.1;
    const tipY = cy - R * 1.48;
    ctx.strokeStyle = '#3d8a37';
    ctx.lineWidth = Math.max(1.5, R * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.quadraticCurveTo(cx - R * 0.08, cy - R * 1.2, tipX, tipY);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(side > 0 ? -0.45 + sway : Math.PI + 0.45 + sway);
      ctx.beginPath();
      leafPath(ctx, R * 0.55, R * 0.2);
      ctx.fillStyle = side > 0 ? '#9be36f' : '#79c95a';
      ctx.fill();
      ctx.lineWidth = Math.max(1, cs * 0.016);
      ctx.strokeStyle = 'rgba(18,48,18,0.8)';
      ctx.stroke();
      ctx.restore();
    }
    // body
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#e9fbc4');
    g.addColorStop(0.55, '#a5dc77');
    g.addColorStop(1, '#5a9f48');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, cs * 0.035);
    ctx.strokeStyle = 'rgba(18,48,18,0.9)';
    ctx.stroke();
    // a leaf-vein highlight on the belly
    ctx.strokeStyle = 'rgba(255,255,230,0.22)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.15, R * 0.62, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    // eyes toward `facing`
    const side = fx !== 0;
    const look = R * 0.36;
    const sep = side ? R * 0.13 : R * 0.33;
    const ex = cx + fx * look;
    const ey = cy + fy * look * 0.6 - (side ? R * 0.1 : R * 0.06);
    // rosy cheeks
    if (fy >= 0) {
      ctx.fillStyle = 'rgba(255,120,140,0.35)';
      for (const s of side ? [fx] : [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(ex + s * (sep + R * 0.2), ey + R * 0.28, R * 0.14, R * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (fy < 0) return void ctx.restore(); // facing away: only the back of the head
    for (const x of [ex - sep, ex + sep]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, ey, R * 0.18, R * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cs * 0.015);
      ctx.strokeStyle = 'rgba(18,48,18,0.55)';
      ctx.stroke();
      ctx.fillStyle = '#16210f';
      ctx.beginPath();
      ctx.arc(x + fx * R * 0.07, ey + fy * R * 0.08, R * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + fx * R * 0.07 - R * 0.04, ey + fy * R * 0.08 - R * 0.04, R * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ effects
  /** Pop: slate's scale-up + sparks, plus a ring of petals opening outward. */
  override pop(host: SkinHost, e: Extract<Effect, { kind: 'pop' }>, age: number): void {
    super.pop(host, e, age);
    const t = age / (POP_MS * 2.4);
    if (t > 1) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    let mx = 0;
    let my = 0;
    for (const c of e.cells) {
      mx += c.x + 0.5;
      my += c.y + 0.5;
    }
    mx /= e.cells.length;
    my /= e.cells.length;
    const cx = host.originX + (e.x + mx) * cs;
    const cy = host.originY + (e.y + my) * cs;
    const ease = 1 - (1 - t) * (1 - t);
    const span = Math.sqrt(e.cells.length);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ease * 0.6);
    ctx.globalAlpha = 0.9 * (1 - t);
    for (let k = 0; k < 6; k++) {
      ctx.save();
      ctx.rotate((k * Math.PI) / 3);
      ctx.translate(cs * (0.15 + 0.5 * span * ease), 0);
      ctx.beginPath();
      leafPath(ctx, cs * 0.26, cs * 0.09);
      ctx.fillStyle = k % 2 ? colorHex(e.color) : '#ffe3ef';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
