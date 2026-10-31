// Skin "station": a cargo-station proof of concept. Steel deck plates, riveted hoppers for sand
// boxes, cargo containers with corner plates, cryo pods for frozen boxes, bulkhead panels for walls,
// rails for belts, thruster bells with flame for driven boxes, and a small maintenance bot as the
// hero. Gameplay affordances (counters, arrows, selection, pings, kick arrow, overview outline) are
// inherited from slate so they read the same in every skin.
import type { Box, ColorId, ConveyorState, Dir, SandRegion, Vec } from '../../core/types';
import type { HeroPose, SkinHost } from './skin';
import { SlateSkin } from './slate';
import { boxStroke, colorHex, colorRGBA } from '../colors';
import { stationProgression } from './progression/station';
import type { SkinProgression } from './progression/types';
import { DIR_ANGLE, DIR_VEC, loopsPath, roundRectPath, shapeLabelPos } from '../geom';

const DECK = '#1a1e26';
const SEAM = 'rgba(0,0,0,0.38)';
const SEAM_HI = 'rgba(255,255,255,0.035)';
const RIVET = 'rgba(255,255,255,0.08)';
const STEEL_HI = '#9aa3b5';
const STEEL = '#5d6676';
const STEEL_LO = '#363c48';
const HAZARD = '#d9a63a';

export class StationSkin extends SlateSkin {
  override readonly id: string = 'station';
  override readonly name: string = 'Station';
  override readonly pageBg: string = '#111419';
  override readonly progression: SkinProgression = stationProgression;
  /** Baked deck-plate tile (one cell) and the cell size it was baked at. */
  private plate: { cs: number; pattern: CanvasPattern } | null = null;

  /** Bake the deck-plate tile at the current cell size (rebaked when the size changes). */
  bake(host: SkinHost): void {
    const cs = Math.round(host.cellSize);
    if (cs < 4) return;
    const c = document.createElement('canvas');
    c.width = c.height = cs;
    const g = c.getContext('2d')!;
    g.fillStyle = DECK;
    g.fillRect(0, 0, cs, cs);
    // plate seams (dark) with a faint highlight just inside
    g.fillStyle = SEAM;
    g.fillRect(0, 0, cs, Math.max(1, cs * 0.02));
    g.fillRect(0, 0, Math.max(1, cs * 0.02), cs);
    g.fillStyle = SEAM_HI;
    g.fillRect(Math.max(1, cs * 0.02), Math.max(1, cs * 0.02), cs, Math.max(1, cs * 0.015));
    // a rivet in each plate corner
    g.fillStyle = RIVET;
    const r = Math.max(1, cs * 0.035);
    for (const [x, y] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
      g.beginPath();
      g.arc(x * cs, y * cs, r, 0, Math.PI * 2);
      g.fill();
    }
    const pattern = host.ctx.createPattern(c, 'repeat');
    if (pattern) this.plate = { cs, pattern };
  }

  override board(host: SkinHost): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX;
    const y = host.originY;
    const w = cs * host.boardW;
    const h = cs * host.boardH;
    const pad = Math.round(cs * 0.08);
    // (re)bake the deck tile when the integer cell size changes (resize, camera levels)
    if ((!this.plate || this.plate.cs !== Math.round(cs)) && Math.abs(cs - Math.round(cs)) < 0.01) this.bake(host);
    const frame = roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, cs * 0.06);
    ctx.fillStyle = '#0c0e12';
    ctx.fill(frame);
    ctx.save();
    ctx.clip(roundRectPath(x, y, w, h, cs * 0.04));
    if (this.plate && Math.abs(this.plate.cs - cs) < 0.5) {
      // baked tile, aligned to the board origin
      ctx.translate(x, y);
      ctx.fillStyle = this.plate.pattern;
      ctx.fillRect(0, 0, w, h);
    } else {
      // overview blend / not baked yet: draw the plates directly
      ctx.fillStyle = DECK;
      ctx.fillRect(x, y, w, h);
      ctx.beginPath();
      for (let i = 1; i < host.boardW; i++) {
        ctx.moveTo(x + i * cs + 0.5, y);
        ctx.lineTo(x + i * cs + 0.5, y + h);
      }
      for (let j = 1; j < host.boardH; j++) {
        ctx.moveTo(x, y + j * cs + 0.5);
        ctx.lineTo(x + w, y + j * cs + 0.5);
      }
      ctx.strokeStyle = SEAM;
      ctx.lineWidth = Math.max(1, host.dpr);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = Math.max(1, host.dpr);
    ctx.stroke(frame);
  }

  /** Hopper: a riveted steel frame with a hazard-striped lip around a dark well holding the sand. */
  override sandBox(host: SkinHost, gx: number, gy: number, gw: number, gh: number, region: SandRegion): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX + gx * cs;
    const y = host.originY + gy * cs;
    const w = gw * cs;
    const h = gh * cs;
    const f = Math.max(2, cs * 0.075); // frame thickness
    const outer = roundRectPath(x + 1, y + 1, w - 2, h - 2, cs * 0.06);
    const inner = roundRectPath(x + f, y + f, w - f * 2, h - f * 2, cs * 0.03);
    // frame
    const fg = ctx.createLinearGradient(x, y, x + w, y + h);
    fg.addColorStop(0, STEEL_HI);
    fg.addColorStop(0.5, STEEL);
    fg.addColorStop(1, STEEL_LO);
    ctx.fillStyle = fg;
    ctx.fill(outer);
    // well + sand
    ctx.fillStyle = '#0b0d11';
    ctx.fill(inner);
    ctx.save();
    ctx.clip(inner);
    const rc = host.regionCanvas(region);
    ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, x, y, w, h);
    const sh = ctx.createLinearGradient(0, y + f, 0, y + f + cs * 0.22);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y + f, w, cs * 0.22);
    ctx.restore();
    // hazard stripes on the top lip
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + f, y + 1, w - f * 2, f - 1);
    ctx.clip();
    ctx.fillStyle = 'rgba(20,20,20,0.85)';
    ctx.fillRect(x, y, w, f);
    ctx.fillStyle = HAZARD;
    const step = f * 2.2;
    for (let u = -f; u < w + f; u += step) {
      ctx.beginPath();
      ctx.moveTo(x + u, y + f);
      ctx.lineTo(x + u + f, y);
      ctx.lineTo(x + u + f + step / 2, y);
      ctx.lineTo(x + u + step / 2, y + f);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // rivets along the sides and bottom
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const rr = Math.max(1, cs * 0.028);
    const gap = cs * 0.5;
    for (let v = y + f + gap * 0.5; v < y + h - f; v += gap) {
      for (const u of [x + f / 2, x + w - f / 2]) {
        ctx.beginPath();
        ctx.arc(u, v, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let u = x + f + gap * 0.5; u < x + w - f; u += gap) {
      ctx.beginPath();
      ctx.arc(u, y + h - f / 2, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, host.dpr);
    ctx.stroke(outer);
  }

  /** Bulkheads: steel panels merged across a wall group, with seams and bolts per cell. */
  override walls(host: SkinHost, loops: Vec[][]): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const path = loopsPath(loops, host.originX, host.originY, cs, cs * 0.02, cs * 0.05);
    const g = ctx.createLinearGradient(0, host.originY, 0, host.originY + host.boardH * cs);
    g.addColorStop(0, '#3d4452');
    g.addColorStop(1, '#2c313c');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = cs * 0.12;
    ctx.shadowOffsetY = cs * 0.04;
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.clip(path);
    // panel seams on the cell grid (inside the wall shapes only)
    const x0 = host.originX;
    const y0 = host.originY;
    const W = host.boardW * cs;
    const H = host.boardH * cs;
    ctx.beginPath();
    for (let i = 0; i <= host.boardW; i++) {
      ctx.moveTo(x0 + i * cs, y0);
      ctx.lineTo(x0 + i * cs, y0 + H);
    }
    for (let j = 0; j <= host.boardH; j++) {
      ctx.moveTo(x0, y0 + j * cs);
      ctx.lineTo(x0 + W, y0 + j * cs);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.stroke();
    // diagonal brace + bolts per cell
    ctx.beginPath();
    for (let i = 0; i < host.boardW; i++) {
      for (let j = 0; j < host.boardH; j++) {
        const cx = x0 + i * cs;
        const cy = y0 + j * cs;
        ctx.moveTo(cx + cs * 0.2, cy + cs * 0.8);
        ctx.lineTo(cx + cs * 0.8, cy + cs * 0.2);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = Math.max(1, cs * 0.06);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const r = Math.max(1, cs * 0.03);
    for (let i = 0; i < host.boardW; i++) {
      for (let j = 0; j < host.boardH; j++) {
        for (const [u, v] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
          ctx.beginPath();
          ctx.arc(x0 + (i + u) * cs, y0 + (j + v) * cs, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // bevel
    const e = Math.max(1, cs * 0.04);
    ctx.lineWidth = e * 2;
    ctx.translate(e, e);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke(path);
    ctx.translate(-2 * e, -2 * e);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(path);
  }

  /** Belts as rails: two steel rails with sleepers sliding along in `dir`. */
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
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(DIR_ANGLE[cv.dir]);
    ctx.fillStyle = 'rgba(6,8,12,0.55)';
    ctx.fill(roundRectPath(cs * 0.04, -half, L - cs * 0.08, half * 2, cs * 0.06));
    // sleepers, moving with the belt
    const spacing = cs * 0.5;
    const phase = (((progress * cs) % spacing) + spacing) % spacing;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cs * 0.04, -half, L - cs * 0.08, half * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(120,96,64,${0.55 + 0.25 * active})`;
    for (let u = -spacing + phase; u < L + spacing; u += spacing) ctx.fillRect(u - cs * 0.05, -half * 0.86, cs * 0.1, half * 1.72);
    ctx.restore();
    // rails
    for (const v of [-half * 0.55, half * 0.55]) {
      const g = ctx.createLinearGradient(0, v - cs * 0.04, 0, v + cs * 0.04);
      g.addColorStop(0, '#c9d0dc');
      g.addColorStop(1, '#5b6372');
      ctx.fillStyle = g;
      ctx.fillRect(cs * 0.06, v - cs * 0.035, L - cs * 0.12, cs * 0.07);
    }
    // direction tick at the far end
    ctx.fillStyle = `rgba(217,166,58,${0.5 + 0.4 * active})`;
    ctx.beginPath();
    ctx.moveTo(L - cs * 0.1, 0);
    ctx.lineTo(L - cs * 0.26, -cs * 0.12);
    ctx.lineTo(L - cs * 0.26, cs * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ----- containers -----
  protected override boxRadius(cs: number): number {
    return cs * 0.05;
  }
  protected override boxFillStyle(color: ColorId): string {
    return colorRGBA(color, 0.24);
  }
  protected override boxStrokeStyle(color: ColorId): string {
    return boxStroke(color);
  }
  /** Corrugated walls: faint vertical ribs over the sand. */
  protected override boxSurface(host: SkinHost, x: number, y: number, w: number, h: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let u = x + cs * 0.14; u < x + w - cs * 0.05; u += cs * 0.2) ctx.fillRect(u, y, Math.max(1, cs * 0.03), h);
    const g = ctx.createLinearGradient(0, y, 0, y + cs * 0.3);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, cs * 0.3);
  }
  /** Steel corner plates on every convex corner of the container outline. */
  protected override boxDecor(host: SkinHost, loops: Vec[][], px: number, py: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const s = cs * 0.2;
    const ins = cs * 0.05;
    ctx.save();
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
        // corner point pulled inside by the outline inset
        const cx = px + c.x * cs + ins * (-d1y - d2y);
        const cy = py + c.y * cs + ins * (d1x + d2x);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + d2x * s, cy + d2y * s);
        ctx.lineTo(cx + d2x * s - d1x * s * 0.45, cy + d2y * s - d1y * s * 0.45);
        ctx.lineTo(cx - d1x * s * 0.45 + d2x * s * 0.45, cy - d1y * s * 0.45 + d2y * s * 0.45);
        ctx.lineTo(cx - d1x * s, cy - d1y * s);
        ctx.closePath();
        ctx.fillStyle = STEEL_HI;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1, cs * 0.015);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(cx + (d2x - d1x) * s * 0.28, cy + (d2y - d1y) * s * 0.28, Math.max(1, cs * 0.022), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Cryo pod: cold glass with frost, two clamp bands, and the thaw counter. */
  protected override frozenBody(host: SkinHost, b: Box, path: Path2D, px: number, py: number, lw: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const grad = ctx.createLinearGradient(px, py, px + b.bw * cs, py + b.bh * cs);
    grad.addColorStop(0, 'rgba(196,232,246,0.95)');
    grad.addColorStop(1, 'rgba(118,170,204,0.92)');
    ctx.fillStyle = grad;
    ctx.fill(path);
    const frost = this.frostPattern(host);
    if (frost) {
      ctx.fillStyle = frost;
      ctx.fill(path);
    }
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = 'rgba(40,70,92,0.35)';
    ctx.fillRect(px, py + b.bh * cs * 0.12, b.bw * cs, cs * 0.06);
    ctx.fillRect(px, py + b.bh * cs * 0.82, b.bw * cs, cs * 0.06);
    ctx.restore();
    ctx.strokeStyle = '#e8f8ff';
    ctx.lineWidth = lw;
    ctx.stroke(path);
    // counter (same rule as slate: centre of rectangles, else the cell nearest the centroid)
    const lp = shapeLabelPos(b.shape, b.cells, b.bw, b.bh);
    const tx = px + lp.x * cs;
    const ty = py + lp.y * cs;
    ctx.fillStyle = '#16364a';
    ctx.font = `800 ${Math.round(Math.max(cs * 0.56, 12 * host.dpr))}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.frozen), tx, ty + cs * 0.03);
  }

  /** Driven box: the face arrow (affordance, as slate) and a thruster bell with a flame. */
  protected override pressureColor(): string | null {
    return '#d8f0ff';
  }

  protected override drawForce(host: SkinHost, b: Box, px: number, py: number, now: number): void {
    const force = (b as Box & { force?: Dir | null }).force;
    if (!force) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const pressing = !!(b as Box & { pressing?: boolean }).pressing && b.frozen === 0;
    const moving = !!host.forces?.has(b.id) && b.frozen === 0;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    // face arrow on the cell nearest the centroid (same affordance as slate)
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
    ctx.save();
    ctx.translate(px + (best.x + 0.5) * cs, py + (best.y + 0.5) * cs);
    ctx.rotate(DIR_ANGLE[force]);
    ctx.globalAlpha = b.frozen > 0 ? 0.3 : 0.5;
    ctx.strokeStyle = b.frozen > 0 ? '#16364a' : '#ffffff';
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
    const flick = 0.75 + 0.25 * Math.sin(now * 0.05) * Math.sin(now * 0.031);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(DIR_ANGLE[force]);
    // flame (behind the bell): blue-white when pressing, orange when moving, a pilot otherwise
    const len = cs * (pressing ? 0.42 : moving ? 0.55 * flick : 0.14);
    const fg = ctx.createLinearGradient(-cs * 0.18, 0, -cs * 0.18 - len, 0);
    if (pressing) {
      fg.addColorStop(0, 'rgba(235,248,255,0.95)');
      fg.addColorStop(0.4, 'rgba(120,190,255,0.75)');
      fg.addColorStop(1, 'rgba(60,120,255,0)');
    } else {
      fg.addColorStop(0, 'rgba(255,240,190,0.95)');
      fg.addColorStop(0.45, 'rgba(255,150,50,0.7)');
      fg.addColorStop(1, 'rgba(255,80,20,0)');
    }
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-cs * 0.18, -cs * 0.13);
    ctx.quadraticCurveTo(-cs * 0.18 - len * 0.7, -cs * 0.1, -cs * 0.18 - len, 0);
    ctx.quadraticCurveTo(-cs * 0.18 - len * 0.7, cs * 0.1, -cs * 0.18, cs * 0.13);
    ctx.closePath();
    ctx.fill();
    // bell nozzle
    const bg = ctx.createLinearGradient(0, -cs * 0.2, 0, cs * 0.2);
    bg.addColorStop(0, STEEL_HI);
    bg.addColorStop(0.5, STEEL);
    bg.addColorStop(1, STEEL_LO);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(cs * 0.04, -cs * 0.1);
    ctx.lineTo(cs * 0.04, cs * 0.1);
    ctx.lineTo(-cs * 0.19, cs * 0.17);
    ctx.lineTo(-cs * 0.19, -cs * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, cs * 0.015);
    ctx.stroke();
    ctx.fillStyle = colorHex(b.color);
    ctx.fillRect(-cs * 0.02, -cs * 0.1, cs * 0.04, cs * 0.2);
    ctx.restore();
  }

  /** The hero as a small maintenance bot: boxy body, visor with eyes, antenna light, treads. */
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
        ctx.fillStyle = '#e8b84a';
        ctx.fill(roundRectPath(cx - sv[0] * i * cs * 0.3 - R * 0.85, cy - sv[1] * i * cs * 0.3 - R * 0.8, R * 1.7, R * 1.6, R * 0.35));
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.3 * (1 + bob * 3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, p.groundY, R * 0.8, R * 0.16, 0, 0, Math.PI * 2);
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
    // treads
    ctx.fillStyle = '#23262d';
    ctx.fill(roundRectPath(cx - R * 0.95, cy + R * 0.55, R * 1.9, R * 0.45, R * 0.2));
    ctx.fillStyle = '#4a4f5a';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * R * 0.38, cy + R * 0.78, R * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // body
    const body = roundRectPath(cx - R * 0.82, cy - R * 0.72, R * 1.64, R * 1.32, R * 0.32);
    const g = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    g.addColorStop(0, '#f6cf6a');
    g.addColorStop(1, '#c9902c');
    ctx.fillStyle = g;
    ctx.fill(body);
    ctx.lineWidth = Math.max(1.5, cs * 0.03);
    ctx.strokeStyle = 'rgba(50,32,8,0.9)';
    ctx.stroke(body);
    // antenna + light
    const blink = (Math.floor(performance.now() / 600) & 1) === 0;
    ctx.strokeStyle = '#3b3f48';
    ctx.lineWidth = Math.max(1, cs * 0.025);
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.35, cy - R * 0.72);
    ctx.lineTo(cx + R * 0.5, cy - R * 1.05);
    ctx.stroke();
    ctx.fillStyle = blink ? '#ff6b5a' : '#7a2b24';
    ctx.beginPath();
    ctx.arc(cx + R * 0.5, cy - R * 1.08, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // visor with eyes looking toward `facing`
    const [fx, fy] = DIR_VEC[p.facing ?? 'down'];
    const visor = roundRectPath(cx - R * 0.6, cy - R * 0.45, R * 1.2, R * 0.6, R * 0.18);
    ctx.fillStyle = '#10141b';
    ctx.fill(visor);
    ctx.fillStyle = '#7fe3ff';
    const ex = cx + fx * R * 0.18;
    const ey = cy - R * 0.15 + fy * R * 0.08;
    const sep = fx !== 0 ? R * 0.2 : R * 0.26;
    for (const x of [ex - sep, ex + sep]) {
      ctx.beginPath();
      ctx.arc(x, ey, R * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
