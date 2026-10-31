// Skin "slate": the original look (dark slate board, glass sand boxes, tinted rounded boxes,
// frosted ice, bevelled walls, recessed belts, a round cream hero). Code moved verbatim from the
// renderer; the renderer now only orchestrates.
import type { Box, ColorId, ConveyorState, Dir, SandRegion, Vec } from '../../core/types';
import type { Effect, View } from '../renderer';
import type { HeroPose, KickArrow, Skin, SkinHost } from './skin';
import { BG, BOARD_BG, GRID_LINE, ICE_FILL_BOTTOM, ICE_FILL_TOP, ICE_STROKE, ICE_TEXT, boxFill, boxGlow, boxStroke, colorHex, colorRGBA } from '../colors';
import { slateProgression } from './progression/slate';
import type { SkinProgression } from './progression/types';
import { DIR_ANGLE, DIR_VEC, POP_MS, loopsPath, outlineLoops, roundRectPath, shapeLabelPos, shapeOutline } from '../geom';

const BELT_SPACING = 0.5;

export class SlateSkin implements Skin {
  readonly id: string = 'slate';
  readonly name: string = 'Slate';
  readonly pageBg: string = BG;
  readonly progression: SkinProgression = slateProgression;
  protected frostCache: CanvasPattern | null = null;

  board(host: SkinHost): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX;
    const y = host.originY;
    const w = cs * host.boardW;
    const h = cs * host.boardH;
    const r = cs * 0.18;
    const pad = Math.round(cs * 0.08);
    const bg = roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, r);
    ctx.fillStyle = BOARD_BG;
    ctx.fill(bg);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = Math.max(1, host.dpr);
    ctx.stroke(bg);

    ctx.beginPath();
    for (let i = 1; i < host.boardW; i++) {
      const lx = x + i * cs + 0.5;
      ctx.moveTo(lx, y + cs * 0.1);
      ctx.lineTo(lx, y + h - cs * 0.1);
    }
    for (let j = 1; j < host.boardH; j++) {
      const ly = y + j * cs + 0.5;
      ctx.moveTo(x + cs * 0.1, ly);
      ctx.lineTo(x + w - cs * 0.1, ly);
    }
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = Math.max(1, Math.round(host.dpr));
    ctx.stroke();
  }

  sandBox(host: SkinHost, gx: number, gy: number, gw: number, gh: number, region: SandRegion): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const x = host.originX + gx * cs;
    const y = host.originY + gy * cs;
    const w = gw * cs;
    const h = gh * cs;
    const inset = Math.max(1, Math.round(cs * 0.04));
    const r = cs * 0.12;
    const glass = roundRectPath(x + inset, y + inset, w - inset * 2, h - inset * 2, r);

    // Glass body.
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill(glass);

    ctx.save();
    ctx.clip(glass);
    const rc = host.regionCanvas(region);
    ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, x, y, w, h);
    // Inner shadow along the edges.
    const sh = cs * 0.18;
    let g = ctx.createLinearGradient(0, y, 0, y + sh);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, sh);
    g = ctx.createLinearGradient(x, 0, x + sh, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, sh, h);
    g = ctx.createLinearGradient(x + w, 0, x + w - sh, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + w - sh, y, sh, h);
    // Glass sheen.
    g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.strokeStyle = 'rgba(220,232,255,0.38)';
    ctx.lineWidth = Math.max(1, cs * 0.035);
    ctx.stroke(glass);
    // Highlight on the top-left lip.
    ctx.beginPath();
    ctx.moveTo(x + inset + r, y + inset + ctx.lineWidth);
    ctx.lineTo(x + w * 0.45, y + inset + ctx.lineWidth);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();
  }

  walls(host: SkinHost, loops: Vec[][]): void {
    if (loops.length === 0) return;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const path = loopsPath(loops, host.originX, host.originY, cs, cs * 0.03, cs * 0.12);
    const g = ctx.createLinearGradient(0, host.originY, 0, host.originY + host.boardH * cs);
    g.addColorStop(0, '#363c50');
    g.addColorStop(1, '#2b3041');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = cs * 0.12;
    ctx.shadowOffsetY = cs * 0.04;
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    // Faint diagonal hatch (board-aligned, so it flows across merged cells).
    ctx.beginPath();
    const step = cs * 0.22;
    const x0 = host.originX;
    const y0 = host.originY;
    const W = host.boardW * cs;
    const H = host.boardH * cs;
    for (let d = -H; d < W; d += step) {
      ctx.moveTo(x0 + d, y0 + H);
      ctx.lineTo(x0 + d + H, y0);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke();
    // Inner bevel: the outline shifted down-right shows as a highlight on the top/left inner edges,
    // shifted up-left as a shadow on the bottom/right inner edges.
    const e = Math.max(1, cs * 0.045);
    ctx.lineWidth = e * 2;
    ctx.translate(e, e);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke(path);
    ctx.translate(-2 * e, -2 * e);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke(path);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(path);
  }

  belt(host: SkinHost, cv: ConveyorState, now: number, progress: number, active: number): void {
    const cells = cv.cells && cv.cells.length ? cv.cells : [{ x: cv.x, y: cv.y }];
    const len = cells.length;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const [dx, dy] = DIR_VEC[cv.dir];
    const start = cells[0];
    // Local frame: origin at the back edge of the start cell (centre line), +u along dir.
    const ox = host.originX + (start.x + 0.5 - dx * 0.5) * cs;
    const oy = host.originY + (start.y + 0.5 - dy * 0.5) * cs;
    const L = len * cs;
    const half = cs * 0.36; // lane half-width
    const inset = cs * 0.07;


    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(DIR_ANGLE[cv.dir]);

    // Recessed lane.
    const lane = roundRectPath(inset, -half, L - inset * 2, half * 2, cs * 0.1);
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fill(lane);
    ctx.save();
    ctx.clip(lane);
    const sh = ctx.createLinearGradient(0, -half, 0, half);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(0.25, 'rgba(0,0,0,0)');
    sh.addColorStop(0.8, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, -half, L, half * 2);

    // Crawling chevrons (time based, ~1 cell/s).
    const spacing = BELT_SPACING * cs;
    const phase = (((progress * cs) % spacing) + spacing) % spacing;
    const cw = cs * 0.13; // chevron depth along u
    const chH = half * 0.62;
    ctx.beginPath();
    for (let u = -spacing + phase; u < L + spacing; u += spacing) {
      ctx.moveTo(u - cw, -chH);
      ctx.lineTo(u, 0);
      ctx.lineTo(u - cw, chH);
    }
    ctx.strokeStyle = `rgba(200,212,235,${0.16 + 0.24 * active})`;
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = `rgba(255,255,255,${0.08 + 0.1 * active})`;
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke(lane);

    // Rollers at both ends: small cylinders across the lane.
    const rw = cs * 0.13;
    for (const u of [inset + rw * 0.15, L - inset - rw * 1.15]) {
      const g = ctx.createLinearGradient(u, 0, u + rw, 0);
      g.addColorStop(0, '#4a5163');
      g.addColorStop(0.45, '#b4bccc');
      g.addColorStop(1, '#4a5163');
      ctx.fillStyle = g;
      ctx.fill(roundRectPath(u, -half - cs * 0.03, rw, half * 2 + cs * 0.06, rw * 0.45));
    }
    ctx.restore();
  }

  protected frostPattern(host: SkinHost): CanvasPattern | null {
    if (this.frostCache) return this.frostCache;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    // deterministic speckle (same frost every load)
    let seed = 0x2f6b9a1d;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.45})`;
      const s = random() < 0.85 ? 1 : 2;
      g.fillRect(random() * 96, random() * 96, s, s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const x0 = random() * 96;
      const y0 = random() * 96;
      const len = 6 + random() * 16;
      const a = random() * Math.PI;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      g.stroke();
    }
    this.frostCache = host.ctx.createPattern(c, 'repeat');
    return this.frostCache;
  }

  // ----- style hooks (station etc. override these; defaults are the slate look) -----
  protected boxRadius(cs: number, inset: number): number {
    return Math.min(cs * 0.18, (cs - inset * 2) / 2);
  }
  protected boxFillStyle(color: ColorId): string {
    return boxFill(color);
  }
  protected boxStrokeStyle(color: ColorId): string {
    return boxStroke(color);
  }
  /** Surface treatment over the sand (clipped to the box): a soft top sheen. */
  protected boxSurface(host: SkinHost, x: number, y: number, w: number, _h: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const g = ctx.createLinearGradient(0, y, 0, y + cs * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, cs * 0.5);
  }
  /**
   * Extra decoration on top of a box / group outline (loops in grid units, placed at px, py).
   * `boxes` are the pieces drawn (one box, or a group's members; positions relative to px, py are
   * box.x/box.y for groups, 0,0 for a single box), so a skin can decorate each piece once.
   */
  protected boxDecor(_host: SkinHost, _loops: Vec[][], _px: number, _py: number, _color: ColorId, _boxes: Box[] = []): void {}

  /** Frozen box: ice fill + frost + the thaw counter. */
  protected frozenBody(host: SkinHost, b: Box, path: Path2D, px: number, py: number, lw: number, _loops?: Vec[][]): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
      const grad = ctx.createLinearGradient(px, py, px, py + b.bh * cs);
      grad.addColorStop(0, ICE_FILL_TOP);
      grad.addColorStop(1, ICE_FILL_BOTTOM);
      ctx.fillStyle = grad;
      ctx.fill(path);
      const frost = this.frostPattern(host);
      if (frost) {
        ctx.fillStyle = frost;
        ctx.fill(path);
      }
      ctx.strokeStyle = ICE_STROKE;
      ctx.lineWidth = lw;
      ctx.stroke(path);
      // Number at the shape's label point (rect centre, else the cell nearest the centroid).
      const lp = shapeLabelPos(b.shape, b.cells, b.bw, b.bh);
      const tx = px + lp.x * cs;
      const ty = py + lp.y * cs;
      ctx.fillStyle = ICE_TEXT;
      ctx.font = `800 ${Math.round(Math.max(cs * 0.56, 12 * host.dpr))}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.frozen), tx, ty + cs * 0.03);
  }

  boxBody(host: SkinHost, b: Box, view: View, now: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const pos = host.positions.get(b.id);
    const rx = pos ? pos.rx : b.x;
    const ry = pos ? pos.ry : b.y;
    const px = host.originX + rx * cs;
    const py = host.originY + ry * cs;
    const loops = shapeOutline(b.shape, b.cells);
    const inset = cs * 0.06;
    const radius = this.boxRadius(cs, inset);
    const path = loopsPath(loops, px, py, cs, inset, radius);
    const selected = b.id === view.selectedBoxId;
    const dragging = b.id === view.dragBoxId;
    const hover = b.id === view.hoverBoxId;
    const lw = Math.max(2, cs * 0.06);

    if (b.frozen > 0) {
      this.frozenBody(host, b, path, px, py, lw, loops);
    } else {
      ctx.fillStyle = this.boxFillStyle(b.color);
      ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      const region = b.region;
      const rc = host.regionCanvas(region);
      ctx.drawImage(rc.canvas, 0, 0, region.w, region.h, px, py, b.bw * cs, b.bh * cs);
      this.boxSurface(host, px, py, b.bw * cs, b.bh * cs);
      ctx.restore();

      if (selected || dragging) {
        this.strokeSelected(host, b.color, path, lw);
      } else {
        ctx.strokeStyle = this.boxStrokeStyle(b.color);
        ctx.lineWidth = lw;
        ctx.stroke(path);
        if (hover) this.strokeHover(host, path, lw);
      }
      this.boxDecor(host, loops, px, py, b.color, [b]);
    }

    this.drawThaw(host, b, path, view, now, lw);
    this.drawForce(host, b, px, py, now);
  }

  /**
   * Driven box: an arrow on its face pointing in `force` (faint under ice), a nozzle on the back
   * edge with a soft glow; exhaust while its train moves; a brighter pulsing glow and a pressure
   * line on the front edge while it is pressing.
   */
  protected drawForce(host: SkinHost, b: Box, px: number, py: number, now: number): void {
    const force = (b as Box & { force?: Dir | null }).force;
    if (!force) return;
    const pressing = !!(b as Box & { pressing?: boolean }).pressing && b.frozen === 0;
    const moving = !!host.forces?.has(b.id) && b.frozen === 0;
    const ctx = host.ctx;
    const cs = host.cellSize;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    // face arrow on the cell nearest the centroid
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
    const ax = px + (best.x + 0.5) * cs;
    const ay = py + (best.y + 0.5) * cs;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(DIR_ANGLE[force]);
    ctx.globalAlpha = b.frozen > 0 ? 0.3 : 0.42;
    ctx.strokeStyle = b.frozen > 0 ? ICE_TEXT : '#ffffff';
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

    // back edge: cells with no own cell behind them (opposite to force); nozzle on the middle one
    const backs = b.cells.filter((c) => !own.has(`${c.x - fx},${c.y - fy}`));
    const back = backs[Math.floor(backs.length / 2)];
    const nx = px + (back.x + 0.5 - fx * 0.5) * cs; // centre of the back edge
    const ny = py + (back.y + 0.5 - fy * 0.5) * cs;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(DIR_ANGLE[force]);
    // local frame: +x = force direction, the nozzle points to -x
    const glowR = cs * (pressing ? 0.55 : 0.4);
    const g = ctx.createRadialGradient(-cs * 0.12, 0, 0, -cs * 0.12, 0, glowR);
    const a = pressing ? 0.35 + 0.25 * pulse : moving ? 0.35 : 0.16;
    g.addColorStop(0, colorRGBA(b.color, a));
    g.addColorStop(1, colorRGBA(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-cs * 0.12 - glowR, -glowR, glowR * 2, glowR * 2);
    // nozzle: a small trapezoid sticking out behind the box
    ctx.fillStyle = boxStroke(b.color);
    ctx.beginPath();
    ctx.moveTo(cs * 0.04, -cs * 0.14);
    ctx.lineTo(cs * 0.04, cs * 0.14);
    ctx.lineTo(-cs * 0.13, cs * 0.2);
    ctx.lineTo(-cs * 0.13, -cs * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pressing ? `rgba(255,245,210,${0.6 + 0.4 * pulse})` : 'rgba(255,255,255,0.35)';
    ctx.fillRect(-cs * 0.15, -cs * 0.15, cs * 0.05, cs * 0.3);
    // exhaust while moving: streaks flowing backwards
    if (moving) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const ph = ((now * 0.004 + i / 4) % 1 + 1) % 1;
        const x = -cs * (0.2 + 0.55 * ph);
        const off = (i - 1.5) * cs * 0.08;
        ctx.globalAlpha = 0.55 * (1 - ph);
        ctx.strokeStyle = i % 2 ? '#ffffff' : colorHex(b.color);
        ctx.lineWidth = Math.max(1.5, cs * 0.035);
        ctx.beginPath();
        ctx.moveTo(x, off);
        ctx.lineTo(x - cs * 0.14, off);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Colour of the pressure line on a pressing driven box's front edge (null: none). */
  protected pressureColor(): string | null {
    return '#fff3c4';
  }

  /** Pressing driven box: a thin pulsing line along its front edge (drawn above all boxes). */
  forceOverlay(host: SkinHost, b: Box, _view: View, now: number): void {
    const force = (b as Box & { force?: Dir | null }).force;
    if (!force || b.frozen > 0 || !(b as Box & { pressing?: boolean }).pressing) return;
    const color = this.pressureColor();
    if (!color) return;
    const cs = host.cellSize;
    const pos = host.positions.get(b.id);
    const px = host.originX + (pos ? pos.rx : b.x) * cs;
    const py = host.originY + (pos ? pos.ry : b.y) * cs;
    const [fx, fy] = DIR_VEC[force];
    const own = new Set(b.cells.map((c) => `${c.x},${c.y}`));
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    const fronts = b.cells.filter((c) => !own.has(`${c.x + fx},${c.y + fy}`));
    const ctx = host.ctx;
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.35 * pulse;
    ctx.strokeStyle = color;
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

  protected strokeSelected(host: SkinHost, color: ColorId, path: Path2D, lw: number): void {
    const ctx = host.ctx;
    ctx.save();
    ctx.shadowColor = boxGlow(color);
    ctx.shadowBlur = host.cellSize * 0.35;
    ctx.strokeStyle = boxGlow(color);
    ctx.lineWidth = lw * 1.6;
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, lw * 0.45);
    ctx.stroke(path);
  }

  protected strokeHover(host: SkinHost, path: Path2D, lw: number): void {
    host.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    host.ctx.lineWidth = Math.max(1, lw * 0.5);
    host.ctx.stroke(path);
  }

  protected drawThaw(host: SkinHost, b: Box, path: Path2D, view: View, now: number, lw: number): void {
    const ctx = host.ctx;
    for (const e of view.effects) {
      if (e.kind !== 'thaw' || e.boxId !== b.id) continue;
      const t = (now - e.t0) / e.dur;
      if (t < 0 || t > 1) continue;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fill(path);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = colorHex(b.color);
      ctx.lineWidth = lw * (1 + t * 2);
      ctx.stroke(path);
      ctx.restore();
    }
  }

  /** One merged outline and fill for a group, faint seams between pieces, per-piece highlights. */
  group(host: SkinHost, members: Box[], view: View, now: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const first = members[0];
    const p0 = host.positions.get(first.id);
    const offX = p0 ? p0.rx - first.x : 0;
    const offY = p0 ? p0.ry - first.y : 0;
    const bx = host.originX + offX * cs;
    const by = host.originY + offY * cs;
    const inset = cs * 0.06;
    const radius = this.boxRadius(cs, inset);
    const lw = Math.max(2, cs * 0.06);

    const abs: Vec[] = [];
    const owner = new Map<string, number>();
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of members) {
      for (const c of b.cells) {
        const x = b.x + c.x;
        const y = b.y + c.y;
        abs.push({ x, y });
        owner.set(`${x},${y}`, b.id);
        minY = Math.min(minY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
    }
    const union = loopsPath(outlineLoops(abs), bx, by, cs, inset, radius);

    ctx.fillStyle = this.boxFillStyle(first.color);
    ctx.fill(union);
    ctx.save();
    ctx.clip(union);
    for (const b of members) {
      const rc = host.regionCanvas(b.region);
      ctx.drawImage(rc.canvas, 0, 0, b.region.w, b.region.h, bx + b.x * cs, by + b.y * cs, b.bw * cs, b.bh * cs);
    }
    const sy = by + minY * cs;
    this.boxSurface(host, bx + minX * cs, sy, (maxX - minX) * cs, (maxY - minY) * cs);

    // Faint seams where two pieces meet (they can still be pulled apart).
    ctx.beginPath();
    const m = cs * 0.2;
    for (const [key, id] of owner) {
      const [x, y] = key.split(',').map(Number);
      const right = owner.get(`${x + 1},${y}`);
      if (right !== undefined && right !== id) {
        ctx.moveTo(bx + (x + 1) * cs, by + y * cs + m);
        ctx.lineTo(bx + (x + 1) * cs, by + (y + 1) * cs - m);
      }
      const down = owner.get(`${x},${y + 1}`);
      if (down !== undefined && down !== id) {
        ctx.moveTo(bx + x * cs + m, by + (y + 1) * cs);
        ctx.lineTo(bx + (x + 1) * cs - m, by + (y + 1) * cs);
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.boxStrokeStyle(first.color);
    ctx.lineWidth = Math.max(1, lw * 0.45);
    ctx.lineCap = 'round';
    ctx.setLineDash([Math.max(2, cs * 0.06), Math.max(2, cs * 0.06)]);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = this.boxStrokeStyle(first.color);
    ctx.lineWidth = lw;
    ctx.stroke(union);
    this.boxDecor(host, outlineLoops(abs), bx, by, first.color, members);

    for (const b of members) this.drawForce(host, b, bx + b.x * cs, by + b.y * cs, now);
    // Per-piece selection / hover / thaw so the player sees which piece they act on.
    for (const b of members) {
      const sel = b.id === view.selectedBoxId;
      const hov = b.id === view.hoverBoxId;
      const thaw = view.effects.some((e) => e.kind === 'thaw' && e.boxId === b.id);
      if (!sel && !hov && !thaw) continue;
      const path = loopsPath(shapeOutline(b.shape, b.cells), bx + b.x * cs, by + b.y * cs, cs, inset, radius);
      if (sel) this.strokeSelected(host, b.color, path, lw);
      else if (hov) this.strokeHover(host, path, lw);
      this.drawThaw(host, b, path, view, now, lw);
    }
  }

  /** Fading streak behind a sliding box. */
  streak(host: SkinHost, b: Box, dir: Dir): void {
    const p = host.positions.get(b.id);
    const cs = host.cellSize;
    const ctx = host.ctx;
    const [dx, dy] = DIR_VEC[dir];
    const x = host.originX + (p ? p.rx : b.x) * cs;
    const y = host.originY + (p ? p.ry : b.y) * cs;
    const w = b.bw * cs;
    const h = b.bh * cs;
    ctx.save();
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.16 / i;
      ctx.fillStyle = colorHex(b.color);
      const o = i * cs * 0.28;
      ctx.fill(roundRectPath(x - dx * o + cs * 0.12, y - dy * o + cs * 0.12, w - cs * 0.24, h - cs * 0.24, cs * 0.14));
    }
    ctx.restore();
  }

  /** The hero: a small round character with eyes looking toward `facing`. */
  hero(host: SkinHost, p: HeroPose): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const { cx, cy, R, bob } = p;
    const sv = p.slide;
    const sq = p.squash;

    // Thrown: motion streak behind the hero.
    if (sv) {
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.18 / i;
        ctx.fillStyle = '#ffd27e';
        ctx.beginPath();
        ctx.arc(cx - sv[0] * i * cs * 0.3, cy - sv[1] * i * cs * 0.3, R * (1 - i * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Ground shadow (stays on the ground line during the bob).
    ctx.save();
    ctx.globalAlpha = 0.28 * (1 + bob * 3);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, p.groundY, R * 0.78, R * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (sv) {
      // sliding pose: stretched along the slide, squashed across it, leaning into it
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
    // Body.
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#fff1cf');
    g.addColorStop(0.55, '#ffd27e');
    g.addColorStop(1, '#e9a24a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, cs * 0.035);
    ctx.strokeStyle = 'rgba(60,36,10,0.85)';
    ctx.stroke();
    // Eyes look toward `facing`.
    const [fx, fy] = DIR_VEC[p.facing ?? 'down'];
    const side = fx !== 0;
    const look = R * 0.38;
    const sep = side ? R * 0.26 : R * 0.34;
    const ex = cx + fx * look;
    const ey = cy + fy * look * 0.7 - (side ? R * 0.12 : 0);
    const eyes = side ? [ex - sep / 2 * 1, ex + sep / 2 * 1] : [ex - sep, ex + sep];
    for (const x of eyes) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x, ey, R * 0.2, R * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cs * 0.015);
      ctx.strokeStyle = 'rgba(60,36,10,0.5)';
      ctx.stroke();
      ctx.fillStyle = '#1f1a14';
      ctx.beginPath();
      ctx.arc(x + fx * R * 0.07, ey + fy * R * 0.08, R * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Swipe arrow from the hero, as long as the drag: light below the kick distance, amber at/after. */
  kickArrow(host: SkinHost, a: KickArrow): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const c = a.charge;
    const x0 = cs * 0.4;
    const x1 = x0 + c.dist * host.dpr;
    const head = Math.min(cs * 0.4, c.dist * host.dpr);
    const w = cs * 0.14;
    ctx.save();
    ctx.translate(a.cx, a.cy);
    ctx.rotate(DIR_ANGLE[c.dir]);
    ctx.globalAlpha = 0.35 * a.fade;
    ctx.fillStyle = c.armed ? '#f5c84c' : '#e6ecf8';
    ctx.fillRect(x0, -w / 2, Math.max(0, x1 - head - x0), w);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1 - head, -head * 0.6);
    ctx.lineTo(x1 - head, head * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  pop(host: SkinHost, e: Extract<Effect, { kind: 'pop' }>, age: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    // Pop: scale-up + fade of the shape.
    const tp = age / POP_MS;
    if (tp <= 1) {
      let mx = 0;
      let my = 0;
      for (const c of e.cells) {
        mx += c.x + 0.5;
        my += c.y + 0.5;
      }
      mx /= e.cells.length;
      my /= e.cells.length;
      const ease = 1 - (1 - tp) * (1 - tp);
      const s = 1 + 0.28 * ease;
      const cx = host.originX + (e.x + mx) * cs;
      const cy = host.originY + (e.y + my) * cs;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      const loops = outlineLoops(e.cells);
      const path = loopsPath(loops, host.originX + e.x * cs, host.originY + e.y * cs, cs, cs * 0.06, cs * 0.18);
      ctx.globalAlpha = 1 - tp;
      ctx.fillStyle = colorRGBA(e.color, 0.85);
      ctx.fill(path);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.stroke(path);
      ctx.restore();
    }

    // Sparks.
    const ts = age / 1000;
    const fade = 1 - age / e.dur;
    ctx.globalAlpha = Math.max(0, fade);
    for (const sp of e.sparks) {
      const sx = sp.x + sp.vx * ts;
      const sy = sp.y + sp.vy * ts + 0.5 * 9 * ts * ts;
      const size = Math.max(host.dpr * 1.5, sp.size * cs);
      ctx.fillStyle = sp.rgb;
      ctx.fillRect(host.originX + sx * cs - size / 2, host.originY + sy * cs - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  debris(host: SkinHost, e: Extract<Effect, { kind: 'debris' }>, age: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const t = age / e.dur;
    const x = host.originX + e.x * cs;
    const y = host.originY + e.y * cs;
    ctx.save();
    // Brief tinted glow over the glass.
    ctx.globalAlpha = 0.16 * (1 - t);
    ctx.fillStyle = colorHex(e.color);
    ctx.fill(roundRectPath(x + cs * 0.04, y + cs * 0.04, e.w * cs - cs * 0.08, e.h * cs - cs * 0.08, cs * 0.12));
    // Rising, twinkling motes.
    const ts = age / 1000;
    for (let i = 0; i < e.sparks.length; i++) {
      const sp = e.sparks[i];
      const tw = 0.55 + 0.45 * Math.sin(age * 0.03 + i * 1.7);
      ctx.globalAlpha = Math.max(0, (1 - t) * tw);
      const size = Math.max(host.dpr * 1.5, sp.size * cs * (1 - t * 0.5));
      ctx.fillStyle = i % 4 === 0 ? '#ffffff' : sp.rgb;
      ctx.fillRect(host.originX + (sp.x + sp.vx * ts) * cs - size / 2, host.originY + (sp.y + sp.vy * ts) * cs - size / 2, size, size);
    }
    ctx.restore();
  }

  dust(host: SkinHost, e: Extract<Effect, { kind: 'dust' }>, age: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const t = age / e.dur;
    const ts = age / 1000;
    const drag = 1 - Math.exp(-ts * 6); // particles decelerate quickly
    ctx.save();
    for (const sp of e.sparks) {
      ctx.globalAlpha = Math.max(0, 0.75 * (1 - t));
      const sx = sp.x + (sp.vx / 6) * drag;
      const sy = sp.y + (sp.vy / 6) * drag + 0.6 * ts * ts;
      const size = Math.max(host.dpr * 1.5, sp.size * cs * (1 + t));
      ctx.fillStyle = sp.rgb;
      ctx.fillRect(host.originX + sx * cs - size / 2, host.originY + sy * cs - size / 2, size, size);
    }
    ctx.restore();
  }

  /** Marker at the screen edge pointing to an off-screen event. */
  ping(host: SkinHost, e: Extract<Effect, { kind: 'ping' }>, age: number): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    const sx = host.originX + e.x * cs;
    const sy = host.originY + e.y * cs;
    const W = host.canvas.width;
    const H = host.canvas.height;
    if (sx >= 0 && sy >= 0 && sx <= W && sy <= H) return; // in view now
    const m = 22 * host.dpr;
    const px = Math.max(m, Math.min(W - m, sx));
    const py = Math.max(m, Math.min(H - m, sy));
    const a = Math.atan2(sy - py, sx - px);
    const t = age / e.dur;
    const r = 9 * host.dpr * (1 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI));
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.translate(px, py);
    ctx.fillStyle = colorHex(e.color);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, 1.5 * host.dpr);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r + 9 * host.dpr, 0);
    ctx.lineTo(r + 2 * host.dpr, -5 * host.dpr);
    ctx.lineTo(r + 2 * host.dpr, 5 * host.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Overview: outline of the normal camera viewport. */
  viewportOutline(host: SkinHost, alpha: number, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const ctx = host.ctx;
    const cs = host.cellSize;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#f5c84c';
    ctx.lineWidth = Math.max(2, 2 * host.dpr);
    ctx.setLineDash([6 * host.dpr, 4 * host.dpr]);
    ctx.strokeRect(host.originX + r.x0 * cs, host.originY + r.y0 * cs, (r.x1 - r.x0) * cs, (r.y1 - r.y0) * cs);
    ctx.restore();
  }
}
