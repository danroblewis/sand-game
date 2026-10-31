// Shared DOM helpers for the themed progression screens.
import type { CeremonyView, FanfareView } from './types';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.95 6.5.85-4.78 4.5 1.2 6.45L12 17.2l-5.77 3.15 1.2-6.45-4.78-4.5 6.5-.85z"/></svg>';
export const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
export const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
export const DICE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>';
export const FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4"/><path d="M6 4.5h11l-2.5 4 2.5 4H6"/></svg>';

/** "8.4 s", "1:05". */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '–';
  if (s < 60) return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function starsRow(n: number, cls = 'stars'): HTMLElement {
  const row = h('span', cls);
  row.setAttribute('aria-label', `${n} of 3 stars`);
  for (let i = 1; i <= 3; i++) row.append(h('i', i <= n ? 'on' : '', STAR_SVG));
  return row;
}

function btn(cls: string, label: string, run: () => void): HTMLButtonElement {
  const b = h('button', `btn ${cls}`);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', () => run());
  return b;
}

export interface FanfareLabels {
  moves: string;
  par: string;
  time: string;
  sand: string;
  pour: string;
  best: string;
  newRecord: string;
  firstClear: string;
  headline: (stars: number | null) => string;
}

/**
 * The win screen skeleton both skins share: headline, stars revealed one by one, moves counted up
 * against par, records with "new record" badges, then Next / Replay / Map. Skins restyle it by class.
 */
export function buildFanfare(host: HTMLElement, r: FanfareView, skin: string, L: FanfareLabels): () => void {
  host.innerHTML = '';
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const root = h('div', `ff ff-${skin}`);
  root.append(h('div', 'ff-kicker', ''), h('h2', 'ff-headline', ''), h('div', 'ff-title', ''));
  (root.children[0] as HTMLElement).textContent = r.kicker;
  (root.children[1] as HTMLElement).textContent = L.headline(r.stars);
  (root.children[2] as HTMLElement).textContent = r.title;

  const starEls: HTMLElement[] = [];
  if (r.stars !== null) {
    const row = h('div', 'ff-stars');
    row.setAttribute('aria-label', `${r.stars} of 3 stars`);
    for (let i = 1; i <= 3; i++) {
      const s = h('span', `ff-star${i <= r.prevStars ? ' had' : ''}`, STAR_SVG);
      row.append(s);
      starEls.push(s);
    }
    root.append(row);
  }

  // moves vs par: counted up
  const mv = h('div', 'ff-moves');
  const mvNum = h('b', 'ff-moves-num', '0');
  mv.append(mvNum, h('span', 'ff-moves-label', ` ${L.moves}`));
  if (r.parMoves !== undefined) {
    const par = h('span', 'ff-par');
    par.textContent = `${L.par} ${r.parMoves}`;
    mv.append(par);
  }
  root.append(mv);

  const stats = h('dl', 'ff-stats');
  const row = (label: string, value: string, best: string | undefined, isNew: boolean) => {
    const d = h('div', 'ff-row');
    const dt = h('dt');
    dt.textContent = label;
    const dd = h('dd');
    const v = h('span', 'ff-val');
    v.textContent = value;
    dd.append(v);
    if (isNew) dd.append(h('span', 'ff-badge', L.newRecord));
    else if (best !== undefined) {
      const b = h('span', 'ff-best');
      b.textContent = `${L.best} ${best}`;
      dd.append(b);
    }
    d.append(dt, dd);
    stats.append(d);
  };
  const B = r.best;
  // moves already lead the screen: a row only to compare with an earlier best
  if (r.newRecord.moves || (B?.moves !== undefined && B.moves !== r.moves)) row(L.moves, String(r.moves), B?.moves !== undefined && B.moves !== r.moves ? String(B.moves) : undefined, r.newRecord.moves);
  row(L.time, fmtTime(r.seconds), B?.seconds !== undefined && B.seconds !== r.seconds ? fmtTime(B.seconds) : undefined, r.newRecord.seconds);
  row(L.sand, fmtTime(r.sandSeconds), B?.sandSeconds !== undefined && B.sandSeconds !== r.sandSeconds ? fmtTime(B.sandSeconds) : undefined, r.newRecord.sandSeconds);
  if (B?.pour !== undefined && (r.newRecord.pour || B.pour !== r.sandSeconds)) row(L.pour, fmtTime(B.pour), undefined, r.newRecord.pour);
  root.append(stats);
  if (r.firstClear && r.stars !== null) root.append(h('div', 'ff-note', L.firstClear));
  if (r.unlockedText) {
    const u = h('div', 'ff-unlocked');
    u.textContent = r.unlockedText;
    root.append(u);
  }

  const btns = h('div', 'ff-buttons');
  btns.append(btn('btn-ghost ff-map', r.map.label, r.map.run), btn('btn-ghost ff-replay', r.replay.label, r.replay.run));
  if (r.next) btns.append(btn('btn-primary ff-next', r.next.label, r.next.run));
  else (btns.children[0] as HTMLElement).classList.replace('btn-ghost', 'btn-primary');
  root.append(btns);
  host.append(root);

  // ---- the reveal ----
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const T0 = reduce ? 0 : 300;
  const STEP = reduce ? 0 : 340;
  const n = r.stars ?? 0;
  starEls.forEach((s, i) => {
    if (i < n)
      later(T0 + i * STEP, () => {
        s.classList.add('lit');
        r.onStar(i + 1);
      });
  });
  const countStart = r.stars === null ? T0 : T0 + Math.max(0, n - 1) * STEP + 200;
  const dur = reduce ? 0 : Math.min(500, 60 * r.moves + 150);
  later(countStart, () => {
    const t0 = performance.now();
    const tick = () => {
      const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
      mvNum.textContent = String(Math.round(r.moves * (1 - Math.pow(1 - k, 2))));
      if (k < 1) timers.push(window.setTimeout(tick, 33));
      else {
        mv.classList.add('done');
        if (r.parMoves !== undefined) mv.classList.add(r.moves <= r.parMoves ? 'at-par' : 'over-par');
      }
    };
    tick();
  });
  later(countStart + dur + 120, () => root.classList.add('show-stats'));
  (btns.querySelector('.btn-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  return () => timers.forEach((t) => window.clearTimeout(t));
}

export function ceremonyIcon(c: CeremonyView): string {
  return c.unlock.kind === 'stars' ? STAR_SVG : c.unlock.kind === 'freeplay' ? DICE_SVG : FLAG_SVG;
}

export function ceremonyButton(c: CeremonyView): HTMLButtonElement {
  const b = btn('btn-primary cer-continue', c.cta, () => c.onContinue());
  return b;
}
