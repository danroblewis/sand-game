// Terrarium progression: each chapter is a climbing vine; its levels are buds along the vine that
// bloom into three-petal flowers (petals lit = stars); locked levels are closed buds. The fanfare
// is a flower blooming petal by petal; the ceremony is sunlight breaking through fogged glass.
// The styles live here (injected once) so the skin stays self-contained.
import { buildFanfare, ceremonyButton, ceremonyIcon, h, LOCK_SVG, type FanfareLabels } from './common';
import type { CeremonyView, FanfareView, MapLevelView, MapModel, SkinProgression } from './types';

/** Horizontal bud positions along the vine (fractions of the width), repeating. */
const SWAY = [0.5, 0.68, 0.76, 0.66, 0.48, 0.32, 0.24, 0.34];
const ROW = 88; // px between buds

const LABELS: FanfareLabels = {
  moves: 'moves',
  par: 'par',
  time: 'Growing time',
  sand: 'Watering',
  pour: 'Longest pour',
  best: 'best',
  newRecord: 'New growth',
  firstClear: 'First bloom',
  headline: (s) => (s === null ? 'It grew!' : s >= 3 ? 'Full bloom!' : s === 2 ? 'Blooming!' : 'Sprouted!'),
};

/** Petal angles (degrees from straight up) for the three star petals; sepals sit between. */
const PETAL_ANGLES = [0, 120, 240];
const PETAL = 'M0 -5 C 10 -9 13 -24 0 -29 C -13 -24 -10 -9 0 -5 Z';
const SEPAL = 'M0 -6 C 5 -10 6 -17 0 -22 C -6 -17 -5 -10 0 -6 Z';
const FLOWER_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" class="tr-ico"><g transform="translate(12 12.6)">' +
  PETAL_ANGLES.map((a) => `<path transform="rotate(${a}) scale(.36)" d="${PETAL}"/>`).join('') +
  '<circle r="2.6" class="c"/></g></svg>';
const SPROUT_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-9"/><path d="M12 12C12 8 9 5.5 4.5 5.5 4.5 9.5 7.5 12 12 12z"/><path d="M12 14.5c0-3.6 2.6-6 6.8-6 0 3.6-2.6 6-6.8 6z"/><path d="M7 21h10"/></svg>';

function flowerSvg(l: MapLevelView): string {
  if (!l.unlocked) {
    // closed bud: tight sepals over a dark bud
    return (
      '<svg viewBox="-30 -30 60 60" aria-hidden="true" class="tr-bud closed">' +
      '<path class="bud" d="M0 -16 C 7 -9 9 3 0 10 C -9 3 -7 -9 0 -16 Z"/>' +
      '<path class="sep" d="M0 12 C -9 6 -9 -4 -3 -10 C -4 -2 -2 5 0 12 Z"/>' +
      '<path class="sep" d="M0 12 C 9 6 9 -4 3 -10 C 4 -2 2 5 0 12 Z"/>' +
      '</svg>'
    );
  }
  if (!l.completed) {
    // open bud: a hint of petal color between parting sepals
    return (
      '<svg viewBox="-30 -30 60 60" aria-hidden="true" class="tr-bud open">' +
      '<path class="bud" d="M0 -22 C 11 -13 13 4 0 14 C -13 4 -11 -13 0 -22 Z"/>' +
      '<path class="sep" d="M0 15 C -14 9 -15 -4 -9 -13 C -9 -3 -6 7 0 15 Z"/>' +
      '<path class="sep" d="M0 15 C 14 9 15 -4 9 -13 C 9 -3 6 7 0 15 Z"/>' +
      '</svg>'
    );
  }
  const petals = PETAL_ANGLES.map((a, i) => `<path class="petal${i < l.stars ? ' on' : ''}" transform="rotate(${a})" d="${PETAL}"/>`).join('');
  const sepals = PETAL_ANGLES.map((a) => `<path class="sep" transform="rotate(${a + 60})" d="${SEPAL}"/>`).join('');
  return `<svg viewBox="-30 -30 60 60" aria-hidden="true" class="tr-bloom">${sepals}${petals}<circle class="disc" r="10.5"/></svg>`;
}

function bud(l: MapLevelView, x: number, y: number, model: MapModel): HTMLElement {
  const n = h('div', `vn${l.unlocked ? '' : ' locked'}${l.completed ? ' done' : ''}${l.current ? ' current' : ''}`);
  n.style.left = `${x * 100}%`;
  n.style.top = `${y}px`;
  const b = h('button', 'vn-btn');
  b.type = 'button';
  b.dataset.index = String(l.index);
  b.setAttribute('aria-label', `Level ${l.index + 1}: ${l.name}${l.unlocked ? (l.completed ? `, ${l.stars} stars` : '') : ` (locked: ${l.requirement ?? ''})`}`);
  b.innerHTML = flowerSvg(l) + (l.unlocked ? `<span class="vn-num">${l.index + 1}</span>` : `<span class="vn-lock">${LOCK_SVG}</span>`);
  b.addEventListener('click', () => (l.unlocked ? model.select(l.index) : model.explain(l)));
  n.append(b);
  const name = h('span', `vn-name ${x > 0.55 ? 'left' : 'right'}`);
  name.textContent = l.name;
  n.append(name);
  return n;
}

let injected = false;
function ensureAssets(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.id = 'terrarium-progression';
  st.textContent = CSS;
  document.head.append(st);
  // shared gradients (outside any hidden overlay so url(#...) always resolves)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('aria-hidden', 'true');
  defs.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  defs.innerHTML =
    '<defs>' +
    '<radialGradient id="trPetalOn" cx="50%" cy="90%" r="95%"><stop offset="0" stop-color="#fff3f7"/><stop offset=".45" stop-color="#ff9cc2"/><stop offset="1" stop-color="#d9467e"/></radialGradient>' +
    '<radialGradient id="trDisc" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff2b0"/><stop offset=".6" stop-color="#f4c443"/><stop offset="1" stop-color="#b9821f"/></radialGradient>' +
    '<linearGradient id="trBudOpen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3cf"/><stop offset=".4" stop-color="#d9779c"/><stop offset=".75" stop-color="#5aa64a"/><stop offset="1" stop-color="#3a7c35"/></linearGradient>' +
    '<linearGradient id="trBudClosed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6b3c"/><stop offset="1" stop-color="#22422a"/></linearGradient>' +
    '<linearGradient id="trSepal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd468"/><stop offset="1" stop-color="#3b8a3a"/></linearGradient>' +
    '</defs>';
  document.body.append(defs);
}

export const terrariumProgression: SkinProgression = {
  renderMap(host, model) {
    ensureAssets();
    host.innerHTML = '';
    const root = h('div', 'pm pm-terrarium');
    root.append(h('div', 'tr-total', `<span>Garden in bloom</span>${FLOWER_ICON}<b>${model.totalStars}</b><span>/ ${model.maxStars}</span>`));
    let sway = 0;
    for (const ch of model.chapters) {
      const sec = h('section', `vine-ch${ch.unlocked ? '' : ' locked'}`);
      const head = h('header', 'vine-head');
      head.innerHTML = `<span class="vine-stake"><span class="vine-ch-num">Chapter ${ch.number}</span><b class="vine-ch-title"></b></span><span class="vine-ch-stars">${FLOWER_ICON}${ch.stars}/${ch.maxStars}</span>`;
      (head.querySelector('.vine-ch-title') as HTMLElement).textContent = ch.title;
      sec.append(head);
      if (!ch.unlocked && ch.requirement) {
        const lock = h('div', 'vine-lock', LOCK_SVG);
        lock.append(document.createTextNode(ch.requirement));
        sec.append(lock);
      }
      const vine = h('div', 'vine');
      const height = ch.levels.length * ROW;
      vine.style.height = `${height}px`;
      const pts: [number, number][] = [];
      ch.levels.forEach((l, i) => {
        const x = SWAY[(sway + i) % SWAY.length];
        const y = i * ROW + ROW / 2;
        pts.push([x * 100, y]);
        vine.append(bud(l, x, y, model));
      });
      sway += ch.levels.length;
      // the stem: vertical-tangent curves between buds (the grown part bright, the rest young)
      const seg = (a: [number, number], b: [number, number]) => `C ${a[0].toFixed(1)} ${a[1] + ROW / 2} ${b[0].toFixed(1)} ${b[1] - ROW / 2} ${b[0].toFixed(1)} ${b[1]}`;
      const start: [number, number] = [pts[0][0], 0];
      let all = `M ${start[0].toFixed(1)} 0 `;
      const allPts = [start, ...pts, [pts[pts.length - 1][0], height] as [number, number]];
      for (let i = 1; i < allPts.length; i++) all += seg(allPts[i - 1], allPts[i]) + ' ';
      const doneN = ch.levels.findIndex((l) => !l.completed);
      const cut = doneN < 0 ? allPts.length : doneN + 2; // through the first unfinished bud
      let grown = `M ${start[0].toFixed(1)} 0 `;
      for (let i = 1; i < Math.min(cut, allPts.length); i++) grown += seg(allPts[i - 1], allPts[i]) + ' ';
      vine.insertAdjacentHTML(
        'afterbegin',
        `<svg class="vine-stem" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">` +
          `<path class="young" d="${all}"/>` +
          (cut > 1 && ch.unlocked ? `<path class="grown" d="${grown}"/>` : '') +
          `</svg>`,
      );
      // leaves between buds, alternating sides of the stem
      for (let i = 0; i + 1 < pts.length; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        const leaf = h('i', `vine-leaf ${i % 2 ? 'l' : 'r'}${ch.unlocked && i + 1 < cut - 1 ? ' grown' : ''}`);
        leaf.style.left = `${mx}%`;
        leaf.style.top = `${my}px`;
        vine.append(leaf);
      }
      sec.append(vine);
      root.append(sec);
    }
    host.append(root);
  },

  winFanfare(host: HTMLElement, r: FanfareView) {
    ensureAssets();
    const cleanup = buildFanfare(host, r, 'terrarium', LABELS);
    // Rebuild the star row as a flower: the three star elements become petals (they keep their
    // `lit` / `had` classes and the reveal timers that light them).
    const row = host.querySelector('.ff-stars') as HTMLElement | null;
    if (row) {
      const stars = Array.from(row.querySelectorAll('.ff-star')) as HTMLElement[];
      row.classList.add('tr-flower');
      row.insertAdjacentHTML(
        'afterbegin',
        '<svg class="tr-flower-base" viewBox="-60 -60 120 140" aria-hidden="true">' +
          '<path class="stem" d="M0 10 C 4 30 -6 55 0 78"/>' +
          '<path class="leaf" d="M1 40 C 16 26 34 28 44 34 C 32 46 14 48 1 40 Z"/>' +
          '<path class="leaf" d="M-1 58 C -14 44 -32 44 -42 50 C -30 62 -12 64 -1 58 Z"/>' +
          PETAL_ANGLES.map((a) => `<path class="sep" transform="rotate(${a + 60}) scale(1.9)" d="${SEPAL}"/>`).join('') +
          '</svg>',
      );
      stars.forEach((s, i) => {
        s.style.setProperty('--a', `${PETAL_ANGLES[i]}deg`);
        s.innerHTML = `<svg viewBox="-16 -31 32 31" aria-hidden="true"><path d="${PETAL}"/></svg>`;
      });
      row.append(h('span', 'tr-disc'));
    }
    return cleanup;
  },

  ceremony(host: HTMLElement, c: CeremonyView) {
    ensureAssets();
    host.innerHTML = '';
    const root = h('div', `cer cer-terrarium cer-${c.unlock.kind}`);
    root.append(h('div', 'cer-status tr-status', 'The sun breaks through'));
    const pane = h('div', 'tr-pane');
    pane.append(h('span', 'tr-sun'));
    const rays = h('span', 'tr-rays');
    for (let i = 0; i < 7; i++) {
      const ray = h('i');
      ray.style.setProperty('--a', `${18 + i * 9}deg`);
      ray.style.setProperty('--d', `${380 + i * 70}ms`);
      rays.append(ray);
    }
    pane.append(rays, h('span', 'tr-fog'), h('span', 'tr-lattice'));
    pane.append(h('span', 'cer-icon', c.unlock.kind === 'chapter' ? SPROUT_SVG : ceremonyIcon(c)));
    const glints = h('span', 'tr-glints');
    for (let i = 0; i < 6; i++) glints.append(h('i'));
    pane.append(glints);
    const t = h('h2', 'cer-title');
    t.textContent = c.title;
    const p = h('p', 'cer-text');
    p.textContent = c.text;
    root.append(pane, t, p, ceremonyButton(c));
    host.append(root);
    (root.querySelector('.cer-continue') as HTMLElement | null)?.focus({ preventScroll: true });
    return () => {};
  },
};

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";

const CSS = `
/* ---------- terrarium: cards are fogged greenhouse glass ---------- */
.levelmap[data-skin='terrarium'] .map-card,
.picker[data-skin='terrarium'] .picker-card,
.win[data-skin='terrarium'] .win-card,
.ceremony[data-skin='terrarium'] .ceremony-card {
  background:
    radial-gradient(circle at 12% 18%, rgba(190,255,215,0.07) 0 2px, transparent 3px) 0 0 / 46px 52px,
    radial-gradient(circle at 70% 60%, rgba(190,255,215,0.05) 0 1.5px, transparent 2.5px) 0 0 / 34px 38px,
    linear-gradient(170deg, #14291e, #0b1711 70%);
  border: 1px solid rgba(160,230,180,0.22);
  box-shadow: inset 0 1px 0 rgba(200,255,220,0.08), 0 20px 60px rgba(0,0,0,0.55);
}
.pm-terrarium { display: flex; flex-direction: column; gap: 6px; }
.tr-ico { width: 16px; height: 16px; vertical-align: -3px; margin-right: 3px; }
.tr-ico path { fill: #ff9cc2; }
.tr-ico .c { fill: #f4c443; }
.tr-total { align-self: flex-end; font-size: 13px; color: #9fc4a8; }
.tr-total span:first-child { margin-right: 8px; font-family: ${SERIF}; font-style: italic; font-size: 14px; }
.tr-total b { color: #effbe9; font-size: 16px; margin-right: 3px; }
.vine-ch { position: relative; padding-top: 10px; }
.vine-head { display: flex; align-items: center; gap: 8px; position: relative; z-index: 2; }
.vine-stake {
  display: inline-flex; align-items: baseline; gap: 8px;
  padding: 5px 12px 6px; border-radius: 4px 14px 4px 14px;
  background: linear-gradient(#efe6cc, #d9cba3); color: #2b3a22;
  box-shadow: 0 2px 0 #7a6a44, 0 4px 10px rgba(0,0,0,0.35);
}
.vine-ch-num { font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #6c7a4c; }
.vine-ch-title { font-family: ${SERIF}; font-style: italic; font-size: 18px; font-weight: 700; }
.vine-ch-stars { margin-left: auto; font-size: 13px; color: #b9d8bf; font-weight: 700; }
.vine-ch.locked .vine-stake { filter: saturate(0.3) brightness(0.7); }
.vine-lock {
  display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 8px 12px;
  border-radius: 12px; font-size: 13px; font-weight: 700; color: #d6ecdc;
  background: linear-gradient(rgba(220,255,235,0.12), rgba(220,255,235,0.05));
  border: 1px solid rgba(200,255,220,0.2);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.vine-lock svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; }
.vine { position: relative; margin: 2px 0 4px; }
.vine-stem { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.vine-stem path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
.vine-stem .young { stroke: #24452c; stroke-width: 5; stroke-dasharray: 1 9; }
.vine-stem .grown { stroke: #4f9a3f; stroke-width: 6; filter: drop-shadow(0 0 3px rgba(130,220,110,0.35)); }
.vine-leaf {
  position: absolute; width: 22px; height: 12px; margin: -6px 0 0 0; pointer-events: none;
  background: linear-gradient(#36603a, #23432a); border-radius: 0 100% 0 100%;
}
.vine-leaf.r { transform: rotate(-24deg); transform-origin: 0 50%; }
.vine-leaf.l { margin-left: -22px; transform: scaleX(-1) rotate(-24deg); transform-origin: 100% 50%; }
.vine-leaf.grown { background: linear-gradient(#8fd468, #3e8a3a); box-shadow: inset 0 0 0 1px rgba(10,40,10,0.35); }
.vn { position: absolute; width: 0; height: 0; }
.vn-btn {
  position: absolute; left: -30px; top: -30px; width: 60px; height: 60px;
  padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer;
  touch-action: manipulation; color: inherit; font: inherit;
}
.vn-btn > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.vn-btn:focus-visible { outline: 3px solid #ffd36a; outline-offset: 2px; }
.vn-btn:active { transform: scale(0.94); }
.tr-bud .sep, .tr-bloom .sep { fill: url(#trSepal); stroke: #1d3e1f; stroke-width: 1; }
.tr-bud.open .bud { fill: url(#trBudOpen); stroke: #2a3f22; stroke-width: 1.2; }
.tr-bud.closed .bud { fill: url(#trBudClosed); stroke: #142a17; stroke-width: 1.2; }
.tr-bud.closed .sep { fill: #2b5530; stroke: #142a17; }
.tr-bloom .petal { fill: rgba(255,255,255,0.08); stroke: rgba(220,255,230,0.38); stroke-width: 1.2; stroke-dasharray: 3 2; }
.tr-bloom .petal.on { fill: url(#trPetalOn); stroke: #ffe6ef; stroke-dasharray: none; }
.tr-bloom .disc { fill: url(#trDisc); stroke: #7a5414; stroke-width: 1; }
.vn-num {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 15px; color: #fff; text-shadow: 0 1px 2px rgba(20,40,20,0.9);
  font-variant-numeric: tabular-nums; pointer-events: none;
}
.vn:not(.done) .vn-num { top: -6px; }
.vn.done .vn-num { color: #4a3208; text-shadow: none; font-size: 14px; top: 1px; }
.vn-lock { position: absolute; right: 8px; bottom: 6px; width: 16px; height: 16px; color: #7fa889; opacity: 0.8; }
.vn-lock svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2.4; }
.vn.current .vn-btn::before {
  content: ''; position: absolute; inset: -12px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,236,150,0.45), rgba(255,236,150,0) 68%);
  animation: tr-halo 1.8s ease-in-out infinite;
}
@keyframes tr-halo { 50% { transform: scale(1.18); opacity: 0.55; } }
.vn.current .tr-bud.open { animation: tr-sway 2.4s ease-in-out infinite; transform-origin: 50% 100%; }
@keyframes tr-sway { 50% { transform: rotate(5deg); } }
.vn-name {
  position: absolute; top: -10px; white-space: nowrap; font-size: 13px; font-weight: 700; color: #cfe6d4;
  max-width: 40vw; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
}
.vn-name.right { left: 36px; }
.vn-name.left { right: 36px; text-align: right; }
.vn.locked .vn-name { color: #6f8a76; }
.vn.current .vn-name { color: #ffe9a6; }

/* ---------- fanfare: a flower blooms petal by petal ---------- */
.ff-terrarium .ff-kicker { color: #9fd08a; }
.ff-terrarium .ff-headline { font-family: ${SERIF}; font-style: italic; font-size: 32px; color: #fff3f7; text-shadow: 0 2px 12px rgba(255,140,190,0.35); }
.ff-terrarium .ff-title { color: #b8d4be; }
.ff-terrarium .ff-stars.tr-flower { position: relative; width: 170px; height: 196px; margin: 4px 0 -10px; display: block; }
.tr-flower-base { position: absolute; left: 0; top: 0; width: 170px; height: 198px; overflow: visible; }
.tr-flower-base .stem { fill: none; stroke: #4f9a3f; stroke-width: 5; stroke-linecap: round; }
.tr-flower-base .leaf { fill: url(#trSepal); stroke: #1d3e1f; stroke-width: 1; }
.tr-flower-base .sep { fill: url(#trSepal); stroke: #1d3e1f; stroke-width: 0.6; }
.ff-terrarium .ff-star {
  position: absolute; left: 50%; top: 85px; width: 64px; height: 62px; margin-left: -32px; margin-top: -62px;
  transform-origin: 50% 100%; transform: rotate(var(--a));
}
.ff-terrarium .ff-star svg,
.ff-terrarium .ff-star:nth-child(2) svg { width: 64px; height: 62px; margin: 0; overflow: visible; }
.ff-terrarium .ff-star path { fill: rgba(255,255,255,0.06); stroke: rgba(220,255,230,0.35); stroke-width: 0.8; stroke-dasharray: 2 1.6; }
.ff-terrarium .ff-star.had path { fill: rgba(255,170,205,0.16); }
.ff-terrarium .ff-star.lit path { fill: url(#trPetalOn); stroke: #ffe6ef; stroke-dasharray: none; }
.ff-terrarium .ff-star.lit { animation: tr-bloom 560ms cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.ff-terrarium .ff-star.lit svg { filter: drop-shadow(0 0 6px rgba(255,150,195,0.55)); }
@keyframes tr-bloom {
  0% { transform: rotate(var(--a)) scale(0.15, 0.05); opacity: 0; }
  60% { opacity: 1; }
  100% { transform: rotate(var(--a)) scale(1); opacity: 1; }
}
.tr-disc {
  position: absolute; left: 50%; top: 85px; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #fff2b0, #f4c443 60%, #b9821f);
  box-shadow: 0 0 0 1px #7a5414, 0 0 14px rgba(255,220,120,0.45);
}
.ff-terrarium .ff-moves-num { color: #effbe9; }
.ff-terrarium .ff-par { background: rgba(200,255,220,0.08); }
.ff-terrarium .ff-row { background: rgba(200,255,220,0.05); border: 1px solid rgba(200,255,220,0.08); }
.ff-terrarium .ff-row dt { font-family: ${SERIF}; font-style: italic; font-weight: 600; color: #a9c9b0; }
.ff-terrarium .ff-badge { background: #ff9cc2; color: #3b0f22; }
.ff-terrarium .ff-unlocked { color: #a6e27a; }
.ff-terrarium .ff-note, .ff-terrarium .ff-moves { color: #a9c9b0; }
.cer-terrarium .cer-text { color: #b5cdbb; }

/* ---------- ceremony: sunlight breaks through the fogged glass ---------- */
.cer-terrarium .tr-status {
  font-family: ${SERIF}; font-style: italic; font-size: 15px; color: #ffe39a;
  text-shadow: 0 0 10px rgba(255,220,120,0.6); animation: tr-fade 700ms 200ms both;
}
.cer-terrarium .cer-title { font-family: ${SERIF}; font-style: italic; font-size: 26px; color: #fff8e0; }
.tr-pane {
  position: relative; width: 150px; height: 150px; border-radius: 14px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(170deg, #173323, #0b1a11);
  box-shadow: 0 0 0 4px #08110c, 0 0 0 5px rgba(170,240,190,0.25), 0 10px 40px rgba(255,220,120,0.18);
}
.tr-sun {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 18% 0%, #fffbe6 0, #ffe28a 18%, rgba(255,214,110,0.55) 42%, rgba(255,214,110,0.12) 70%, transparent 90%);
  clip-path: circle(0% at 18% 0%);
  animation: tr-sun 1100ms 250ms cubic-bezier(0.5, 0, 0.2, 1) forwards;
}
@keyframes tr-sun { to { clip-path: circle(150% at 18% 0%); } }
.tr-rays i {
  position: absolute; left: 18%; top: 0; width: 14px; height: 240px; margin-left: -7px;
  transform-origin: 50% 0; transform: rotate(var(--a)) scaleY(0.2);
  background: linear-gradient(rgba(255,248,210,0.85), rgba(255,236,160,0));
  opacity: 0; animation: tr-ray 1300ms var(--d) ease-out forwards; mix-blend-mode: screen;
}
.tr-rays i:nth-child(even) { width: 6px; margin-left: -3px; }
@keyframes tr-ray {
  0% { opacity: 0; transform: rotate(var(--a)) scaleY(0.2); }
  40% { opacity: 1; }
  100% { opacity: 0.55; transform: rotate(var(--a)) scaleY(1); }
}
.tr-fog {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(220,255,235,0.35) 0 2px, transparent 3px) 0 0 / 22px 26px,
    radial-gradient(circle at 60% 70%, rgba(220,255,235,0.3) 0 1.5px, transparent 2.5px) 0 0 / 16px 18px,
    linear-gradient(rgba(200,235,215,0.38), rgba(170,215,190,0.3));
  animation: tr-defog 1400ms 300ms ease-out forwards;
}
@keyframes tr-defog { to { opacity: 0.12; } }
.tr-lattice {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(90deg, transparent calc(50% - 2px), #08110c calc(50% - 2px) calc(50% + 2px), transparent calc(50% + 2px)),
    linear-gradient(transparent calc(50% - 2px), #08110c calc(50% - 2px) calc(50% + 2px), transparent calc(50% + 2px));
  opacity: 0.85;
}
.tr-pane .cer-icon {
  position: relative; z-index: 1; width: 74px; height: 74px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: #2c4a1c;
  background: radial-gradient(circle at 40% 35%, #fffbe0, #ffd96a 70%, #e0a92e);
  box-shadow: 0 0 0 6px rgba(255,230,140,0.25), 0 0 30px rgba(255,220,120,0.8);
  animation: tr-rise 620ms 900ms cubic-bezier(0.2, 1.5, 0.4, 1) both;
}
.tr-pane .cer-icon svg { width: 44px; height: 44px; stroke-width: 2.2; }
@keyframes tr-rise { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes tr-fade { from { opacity: 0; } to { opacity: 1; } }
.tr-glints i {
  position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 8px 2px rgba(255,240,190,0.9); opacity: 0;
  animation: tr-glint 900ms ease-in-out infinite;
}
.tr-glints i:nth-child(1) { left: 22%; top: 30%; animation-delay: 1.1s; }
.tr-glints i:nth-child(2) { left: 70%; top: 18%; animation-delay: 1.4s; }
.tr-glints i:nth-child(3) { left: 80%; top: 64%; animation-delay: 1.7s; }
.tr-glints i:nth-child(4) { left: 30%; top: 78%; animation-delay: 1.25s; }
.tr-glints i:nth-child(5) { left: 55%; top: 86%; animation-delay: 1.9s; }
.tr-glints i:nth-child(6) { left: 12%; top: 58%; animation-delay: 2.1s; }
@keyframes tr-glint { 0%, 100% { opacity: 0; transform: scale(0.4); } 50% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .vn.current .vn-btn::before, .vn.current .tr-bud.open, .tr-glints i { animation: none; }
  .ff-terrarium .ff-star.lit, .tr-pane .cer-icon, .cer-terrarium .tr-status { animation: none; }
  .tr-sun, .tr-rays i, .tr-fog { animation-duration: 1ms; animation-delay: 0ms; }
}
`;
