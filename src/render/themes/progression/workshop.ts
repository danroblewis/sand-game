// Workshop progression: each chapter is a shelf of labelled jars under a shelf lamp; a level's jar
// fills with golden sand as stars are earned; locked jars are corked and dusty. The win fanfare is
// a stamped parchment tag with wax-seal stars; the unlock ceremony lights a shelf lamp.
// The skin's CSS is injected once (scoped to .pm-workshop / .ff-workshop / .cer-workshop and the
// hosts' data-skin='workshop'), so the skin stays self-contained.
import { buildFanfare, ceremonyButton, ceremonyIcon, h, LOCK_SVG, STAR_SVG, type FanfareLabels } from './common';
import type { CeremonyView, FanfareView, MapLevelView, MapModel, SkinProgression } from './types';

const LABELS: FanfareLabels = {
  moves: 'moves',
  par: 'par',
  time: 'Bench time',
  sand: 'Pour time',
  pour: 'Longest pour',
  best: 'best',
  newRecord: 'Record',
  firstClear: 'First batch',
  headline: (s) => (s === null ? 'Well made' : s >= 3 ? 'Masterwork' : s === 2 ? 'Fine work' : 'Well made'),
};

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

const LAMP_SVG =
  '<svg class="lamp-svg" viewBox="0 0 160 120" aria-hidden="true">' +
  '<rect x="8" y="4" width="10" height="34" rx="2" class="lamp-brass"/>' +
  '<path d="M18 14 H86 V26" class="lamp-arm"/>' +
  '<circle cx="13" cy="10" r="1.6" class="lamp-rivet"/><circle cx="13" cy="32" r="1.6" class="lamp-rivet"/>' +
  '<path d="M74 26 h24 l-4 10 h-16 z" class="lamp-brass"/>' +
  '<circle cx="86" cy="56" r="20" class="lamp-glass"/>' +
  '<path d="M80 66 v-8 q3 -9 6 0 q3 -9 6 0 v8" class="lamp-filament"/>' +
  '<ellipse cx="80" cy="48" rx="5" ry="8" class="lamp-shine"/>' +
  '</svg>';

function jar(l: MapLevelView, model: MapModel): HTMLElement {
  const fill = l.completed ? Math.max(1, l.stars) : 0;
  const b = h('button', `jar${l.unlocked ? '' : ' locked'}${l.completed ? ' done' : ''}${l.current ? ' current' : ''} s${fill}`);
  b.type = 'button';
  b.dataset.index = String(l.index);
  b.title = l.unlocked ? l.name : `${l.name}: ${l.requirement ?? 'locked'}`;
  b.setAttribute('aria-label', `Level ${l.index + 1}: ${l.name}${l.unlocked ? (l.completed ? `, ${l.stars} stars` : '') : ` (locked: ${l.requirement ?? ''})`}`);
  const pips = [1, 2, 3].map((i) => `<i class="${l.completed && i <= l.stars ? 'on' : ''}"></i>`).join('');
  b.innerHTML =
    `<span class="jar-glass"><span class="jar-sand"></span><span class="jar-dust"></span></span>` +
    (l.unlocked ? '<span class="jar-lip"></span>' : '<span class="jar-cork"></span>') +
    `<span class="jar-label"><b>${l.unlocked ? l.index + 1 : LOCK_SVG}</b><span class="jar-pips">${pips}</span></span>` +
    (l.current ? '<span class="jar-here"></span>' : '');
  b.addEventListener('click', () => (l.unlocked ? model.select(l.index) : model.explain(l)));
  return b;
}

export const workshopProgression: SkinProgression = {
  renderMap(host, model) {
    ensureCss();
    host.innerHTML = '';
    const root = h('div', 'pm pm-workshop');
    root.append(h('div', 'ws-total', `<span>Collection</span>${STAR_SVG}<b>${model.totalStars}</b><span>/ ${model.maxStars}</span>`));
    for (const ch of model.chapters) {
      const shelf = h('section', `shelf${ch.unlocked ? ' lit' : ' locked'}`);
      const head = h('header', 'shelf-head');
      head.innerHTML = `<span class="shelf-lamp"><i></i></span><span class="shelf-plaque"><span class="shelf-no">Shelf ${roman(ch.number)}</span><b class="shelf-name"></b></span><span class="shelf-stars">${STAR_SVG}${ch.stars}/${ch.maxStars}</span>`;
      (head.querySelector('.shelf-name') as HTMLElement).textContent = ch.title;
      shelf.append(head);
      if (!ch.unlocked && ch.requirement) {
        const tag = h('div', 'shelf-tag', LOCK_SVG);
        tag.append(document.createTextNode(ch.requirement));
        shelf.append(tag);
      }
      const row = h('div', 'shelf-row');
      for (const l of ch.levels) row.append(jar(l, model));
      shelf.append(row);
      root.append(shelf);
    }
    host.append(root);
  },

  winFanfare(host: HTMLElement, r: FanfareView) {
    ensureCss();
    const cleanup = buildFanfare(host, r, 'workshop', LABELS);
    const root = host.querySelector('.ff-workshop');
    if (root) root.prepend(h('div', 'ws-stamp', r.stars !== null && r.stars >= 3 ? 'Assayed' : 'Approved'));
    return cleanup;
  },

  ceremony(host: HTMLElement, c: CeremonyView) {
    ensureCss();
    host.innerHTML = '';
    const root = h('div', `cer cer-workshop cer-${c.unlock.kind}`);
    const scene = h('div', 'ws-lampscene');
    scene.append(h('div', 'ws-glow'), h('div', 'ws-pool'), h('div', 'ws-lamp', LAMP_SVG), h('div', 'ws-plank'), h('span', 'cer-icon', ceremonyIcon(c)));
    const status = h('div', 'ws-status', 'A new lamp is lit');
    const t = h('h2', 'cer-title');
    t.textContent = c.title;
    const p = h('p', 'cer-text');
    p.textContent = c.text;
    root.append(scene, status, t, p, ceremonyButton(c));
    host.append(root);
    (root.querySelector('.cer-continue') as HTMLElement | null)?.focus({ preventScroll: true });
    return () => {};
  },
};

let cssDone = false;
function ensureCss(): void {
  if (cssDone || document.getElementById('ws-skin-css')) return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'ws-skin-css';
  s.textContent = CSS;
  document.head.append(s);
}

const SERIF = `ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`;
const ROW_H = 98; // px per shelf row (jar + plank)
const PLANK = 12;

const CSS = `
/* ---------- workshop map: shelves of jars ---------- */
.levelmap[data-skin='workshop'] .map-card,
.picker[data-skin='workshop'] .picker-card {
  background: #1d140e;
  border-color: #47321f;
}
.pm-workshop {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: ${SERIF};
  color: #f0e2c4;
}
.pm-workshop svg { fill: currentColor; }
.ws-total {
  align-self: flex-end;
  font-size: 13px;
  font-style: italic;
  color: #b89a72;
}
.ws-total svg, .shelf-stars svg {
  width: 14px; height: 14px; fill: #f2c25a; vertical-align: -2px; margin: 0 3px 0 6px;
}
.ws-total b { color: #ffe7b0; font-size: 16px; margin-right: 3px; font-style: normal; }
.shelf {
  position: relative;
  border-radius: 4px;
  border-left: 7px solid #4a2f1b;
  border-right: 7px solid #4a2f1b;
  background:
    radial-gradient(ellipse 80% 70% at 12% 0%, rgba(255, 196, 110, 0.20), transparent 70%),
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 46px),
    linear-gradient(#2c1c12, #1f140d);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), 0 3px 0 #0e0906;
  padding-bottom: 2px;
}
.shelf.locked {
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 46px),
    linear-gradient(#1f150e, #160f0a);
}
.shelf-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 6px;
}
.shelf-lamp {
  position: relative;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #5a4a3a, #2a1f16 70%);
  border: 2px solid #8a6a30;
  box-shadow: 0 2px 0 rgba(0,0,0,0.5);
}
.shelf-lamp i {
  position: absolute; inset: 4px; border-radius: 50%;
  background: #3a2c20;
}
.shelf.lit .shelf-lamp {
  background: radial-gradient(circle at 45% 40%, #fff6d6, #ffc75a 45%, #c47a1c 80%);
  box-shadow: 0 0 12px 3px rgba(255, 190, 90, 0.55), 0 0 30px 8px rgba(255, 170, 70, 0.18);
}
.shelf.lit .shelf-lamp i { background: radial-gradient(circle, #fffbe8, rgba(255,240,190,0) 70%); }
.shelf-plaque {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.shelf-no {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #d0a656;
}
.shelf-name {
  font-size: 18px;
  font-weight: 700;
  color: #f6e7c8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shelf.locked .shelf-name, .shelf.locked .shelf-no { color: #8a7660; }
.shelf-stars { font-size: 13px; color: #c9ad86; white-space: nowrap; }
.shelf-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 4px;
  padding: 5px 10px;
  width: fit-content;
  max-width: calc(100% - 24px);
  background: linear-gradient(#efe0bc, #dcc794);
  color: #4a2e14;
  font-size: 12.5px;
  font-style: italic;
  border-radius: 2px 8px 8px 2px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.45);
  transform: rotate(-1.2deg);
}
.shelf-tag svg { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; }
.shelf-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(54px, 1fr));
  grid-auto-rows: ${ROW_H}px;
  column-gap: 6px;
  padding: 0 8px;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 ${ROW_H - PLANK}px,
    #7a5030 ${ROW_H - PLANK}px ${ROW_H - PLANK + 2}px,
    #5a3820 ${ROW_H - PLANK + 2}px ${ROW_H - 3}px,
    #2a180c ${ROW_H - 3}px ${ROW_H}px
  );
  margin: 0 -8px;
  padding-left: 16px;
  padding-right: 16px;
}
.jar {
  position: relative;
  align-self: end;
  justify-self: center;
  width: 46px;
  height: 70px;
  margin-bottom: ${PLANK}px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.jar::after {
  /* contact shadow on the plank */
  content: '';
  position: absolute;
  left: 2px; right: 2px; bottom: -4px; height: 5px;
  border-radius: 50%;
  background: rgba(0,0,0,0.45);
  z-index: -1;
}
.jar-glass {
  position: absolute;
  left: 2px; right: 2px; top: 12px; bottom: 0;
  border-radius: 9px 9px 13px 13px;
  border: 2px solid rgba(214, 232, 238, 0.42);
  background:
    linear-gradient(90deg, rgba(0,0,0,0.3), rgba(255,255,255,0.14) 16%, rgba(255,255,255,0.03) 36%, rgba(255,255,255,0.02) 78%, rgba(255,255,255,0.08) 88%, rgba(0,0,0,0.3)),
    rgba(18, 11, 6, 0.55);
  overflow: hidden;
}
.jar-glass::after {
  content: '';
  position: absolute; left: 6px; top: 6px; width: 3px; bottom: 10px;
  border-radius: 2px; background: rgba(255,255,255,0.22);
}
.jar-sand {
  position: absolute; left: 0; right: 0; bottom: 0; height: 0;
  background:
    radial-gradient(circle at 25% 30%, rgba(255,250,220,0.55) 0.8px, transparent 1.4px) 0 0 / 5px 5px,
    radial-gradient(circle at 70% 60%, rgba(120,70,10,0.45) 0.8px, transparent 1.4px) 0 0 / 6px 6px,
    linear-gradient(#ffd56a, #e0a43a 60%, #b8761e);
  box-shadow: inset 0 2px 0 rgba(255, 240, 180, 0.6);
  transition: height 400ms ease-out;
}
.jar.s1 .jar-sand { height: 30%; }
.jar.s2 .jar-sand { height: 58%; }
.jar.s3 .jar-sand { height: 88%; }
.jar.s3 .jar-glass { box-shadow: 0 0 10px rgba(255, 200, 90, 0.35); }
.jar-lip {
  position: absolute; left: 7px; right: 7px; top: 8px; height: 7px;
  border-radius: 3px;
  background: linear-gradient(#f3d58a, #c49a45 50%, #7a5a22);
  box-shadow: 0 1px 0 rgba(0,0,0,0.5);
}
.jar-cork {
  position: absolute; left: 10px; right: 10px; top: 0; height: 17px;
  clip-path: polygon(0 0, 100% 0, 88% 100%, 12% 100%);
  background:
    radial-gradient(circle at 30% 40%, rgba(70,40,14,0.5) 1px, transparent 1.5px) 0 0 / 5px 4px,
    linear-gradient(90deg, #d8ab70, #a8763e 60%, #6e4824);
}
.jar-label {
  position: absolute; left: 6px; right: 6px; top: 28px;
  padding: 2px 0 3px;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  background: linear-gradient(#f4e8cc, #e0cc9c);
  color: #3a2410;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.5);
  font-size: 14px;
  line-height: 1;
}
.jar-label b { font-weight: 800; font-variant-numeric: tabular-nums; }
.jar-label svg { width: 13px; height: 13px; display: block; fill: none; stroke: currentColor; stroke-width: 2.4; }
.jar-pips { display: flex; gap: 2px; }
.jar-pips i { width: 5px; height: 5px; transform: rotate(45deg); background: rgba(90, 60, 30, 0.22); }
.jar-pips i.on { background: #c8861c; box-shadow: 0 0 0 0.5px #6a3c08; }
.jar.locked .jar-glass {
  border-color: rgba(170, 160, 150, 0.28);
  filter: saturate(0.4) brightness(0.8);
}
.jar-dust { position: absolute; inset: 0; display: none; }
.jar.locked .jar-dust {
  display: block;
  background:
    radial-gradient(circle at 20% 30%, rgba(200,190,175,0.22) 0.8px, transparent 1.3px) 0 0 / 4px 5px,
    radial-gradient(circle at 60% 70%, rgba(200,190,175,0.16) 0.8px, transparent 1.3px) 0 0 / 5px 3px,
    linear-gradient(rgba(150,140,130,0.25), rgba(150,140,130,0.08) 40%, transparent);
}
.jar.locked .jar-label { background: linear-gradient(#a99a80, #8e7f66); color: #3e3326; }
.jar.locked .jar-cork { filter: saturate(0.5) brightness(0.85); }
.jar.current .jar-glass {
  border-color: #ffd98a;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 14px 2px rgba(255, 190, 90, 0.6);
  animation: ws-glow 1.6s ease-in-out infinite;
}
.jar-here {
  position: absolute; left: 50%; top: -8px; width: 12px; height: 8px; margin-left: -6px;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  background: #ffd98a;
  filter: drop-shadow(0 0 4px rgba(255, 190, 90, 0.9));
  animation: ws-bob 1.2s ease-in-out infinite;
}
.jar:focus-visible { outline: 2px solid #ffd98a; outline-offset: 3px; border-radius: 8px; }
.jar:active { transform: translateY(1px); }
@keyframes ws-glow { 50% { box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 22px 5px rgba(255, 190, 90, 0.35); } }
@keyframes ws-bob { 50% { transform: translateY(-3px); } }

/* ---------- workshop fanfare: a stamped parchment tag ---------- */
.win[data-skin='workshop'] .win-card {
  position: relative;
  color: #3a2410;
  border: none;
  border-radius: 6px;
  padding-top: 40px;
  clip-path: polygon(0 34px, 34px 0, calc(100% - 34px) 0, 100% 34px, 100% 100%, 0 100%);
  background:
    radial-gradient(circle at 50% 18px, transparent 7px, #8a6a30 7.5px, #f3d58a 9px, #9a7432 12px, transparent 12.5px),
    repeating-linear-gradient(8deg, rgba(120, 80, 30, 0.035) 0 2px, transparent 2px 5px),
    radial-gradient(ellipse at 50% 35%, #f6ead0, #e6d3a6 65%, #cfb27a);
  box-shadow: inset 0 0 50px rgba(130, 80, 20, 0.35);
}
.win[data-skin='workshop'] .win-card::before {
  /* the punched hole shows the dark backdrop */
  content: '';
  position: absolute; left: 50%; top: 11px; width: 14px; height: 14px; margin-left: -7px;
  border-radius: 50%;
  background: #1a120d;
}
.ff-workshop { position: relative; font-family: ${SERIF}; }
.ff-workshop .ff-kicker { color: #8a5a2b; letter-spacing: 0.22em; font-size: 12px; }
.ff-workshop .ff-headline { font-size: 32px; font-weight: 700; color: #3a1f0c; letter-spacing: 0.01em; }
.ff-workshop .ff-title { color: #6a4a2a; font-style: italic; font-weight: 600; }
.ws-stamp {
  position: absolute; right: -4px; top: -26px;
  padding: 3px 8px;
  border: 2.5px solid rgba(170, 40, 28, 0.55);
  border-radius: 5px;
  color: rgba(170, 40, 28, 0.6);
  font-size: 12px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase;
  transform: rotate(10deg);
  font-family: ${SERIF};
  animation: ws-stamp 380ms 900ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
}
@keyframes ws-stamp {
  0% { opacity: 0; transform: rotate(10deg) scale(2.2); }
  100% { opacity: 1; transform: rotate(10deg) scale(1); }
}
.ff-workshop .ff-stars { gap: 12px; margin: 10px 0 4px; align-items: center; }
.ff-workshop .ff-star {
  width: 56px; height: 56px;
  display: grid; place-items: center;
  border-radius: 50%;
  border: 2px dashed rgba(110, 70, 30, 0.35);
}
.ff-workshop .ff-star:nth-child(2) { width: 66px; height: 66px; }
.ff-workshop .ff-star svg,
.ff-workshop .ff-star:nth-child(2) svg { width: 28px; height: 28px; margin: 0; }
.ff-workshop .ff-star:nth-child(2) svg { width: 34px; height: 34px; }
.ff-workshop .ff-star path { fill: rgba(110, 70, 30, 0.16); stroke: none; }
.ff-workshop .ff-star.lit {
  border: none;
  border-radius: 47% 53% 50% 50% / 52% 46% 54% 48%;
  background: radial-gradient(circle at 36% 30%, #e86a58, #b32a1d 55%, #73140d);
  box-shadow: 0 3px 0 rgba(70, 12, 6, 0.45), inset 0 -4px 7px rgba(0, 0, 0, 0.35), inset 0 2px 4px rgba(255, 200, 180, 0.4),
    0 0 0 4px rgba(179, 42, 29, 0.25);
  animation: ws-seal 420ms cubic-bezier(0.3, 1.5, 0.5, 1);
}
.ff-workshop .ff-star.lit path { fill: #7a1810; stroke: rgba(255, 190, 170, 0.65); stroke-width: 1; }
@keyframes ws-seal {
  0% { transform: scale(1.9) rotate(-25deg); opacity: 0; }
  60% { transform: scale(0.9) rotate(4deg); opacity: 1; }
  100% { transform: none; }
}
.ff-workshop .ff-moves { color: #6a4a2a; }
.ff-workshop .ff-moves-num { color: #2a170a; }
.ff-workshop .ff-par { background: rgba(110, 70, 30, 0.12); color: #6a4a2a; }
.ff-workshop .ff-moves.at-par .ff-par { background: rgba(47, 107, 42, 0.15); color: #2f6b2a; }
.ff-workshop .ff-row {
  background: transparent;
  border-radius: 0;
  border-bottom: 1px dashed rgba(110, 70, 30, 0.4);
  padding: 7px 4px;
}
.ff-workshop .ff-row dt { color: #6a4a2a; font-style: italic; }
.ff-workshop .ff-row dd { color: #2a170a; }
.ff-workshop .ff-best { color: #8a6a4a; }
.ff-workshop .ff-badge {
  background: transparent;
  color: #b22a1c;
  border: 2px solid #b22a1c;
  border-radius: 4px;
  transform: rotate(-5deg);
}
.ff-workshop .ff-note { color: #6a4a2a; font-style: italic; }
.ff-workshop .ff-unlocked { color: #2f6b2a; }
.ff-workshop .btn {
  font-family: ${SERIF};
  background: rgba(110, 70, 30, 0.08);
  color: #3a2410;
  border: 1px solid rgba(110, 70, 30, 0.45);
  border-radius: 8px;
}
.ff-workshop .btn:hover:not(:disabled) { background: rgba(110, 70, 30, 0.16); }
.ff-workshop .btn-primary {
  background: linear-gradient(#e6c06a, #b0822e);
  color: #2a170a;
  border-color: #7a5a22;
  box-shadow: inset 0 1px 0 rgba(255, 245, 200, 0.6), 0 2px 0 rgba(70, 40, 10, 0.5);
}
.ff-workshop .btn-primary:hover:not(:disabled) { background: linear-gradient(#f0cc78, #bd8e36); }
.ff-workshop .btn:focus-visible { outline-color: #8a3a10; }

/* ---------- workshop ceremony: a shelf lamp lights up ---------- */
.ceremony[data-skin='workshop'] .ceremony-card {
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0 1px, transparent 1px 52px),
    linear-gradient(#2c1c12, #1a110b);
  border: 2px solid #4a2f1b;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px #0e0906, 0 20px 60px rgba(0, 0, 0, 0.55);
}
.cer-workshop { font-family: ${SERIF}; color: #f3e4c4; }
.ws-lampscene { position: relative; width: 220px; height: 170px; }
.ws-lamp { position: absolute; left: 30px; top: 0; width: 160px; height: 120px; }
.ws-lamp svg { width: 100%; height: 100%; display: block; overflow: visible; }
.lamp-brass { fill: #c49a45; stroke: #4a3210; stroke-width: 1.5; }
.lamp-arm { fill: none; stroke: #8a6a30; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.lamp-rivet { fill: #f3d58a; }
.lamp-glass { fill: #3a2c20; stroke: #8a7a68; stroke-width: 2; animation: ws-glass 1.3s 250ms steps(1, end) forwards; }
.lamp-filament { fill: none; stroke: #6a5040; stroke-width: 1.6; stroke-linecap: round; animation: ws-fil 1.3s 250ms steps(1, end) forwards; }
.lamp-shine { fill: rgba(255, 255, 255, 0.18); }
@keyframes ws-glass {
  0% { fill: #3a2c20; }
  12% { fill: #b88a40; }
  20% { fill: #3a2c20; }
  34% { fill: #e0a850; }
  44% { fill: #5a4026; }
  60%, 100% { fill: #ffd27a; }
}
@keyframes ws-fil {
  0% { stroke: #6a5040; }
  12% { stroke: #fff4c8; }
  20% { stroke: #6a5040; }
  34%, 100% { stroke: #fffbe8; }
}
.ws-glow {
  position: absolute; left: 36px; top: -24px; width: 160px; height: 160px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 210, 120, 0.55), rgba(255, 170, 70, 0.18) 40%, transparent 70%);
  opacity: 0;
  animation: ws-flicker 1.3s 250ms forwards;
}
.ws-pool {
  position: absolute; left: 12px; right: 0; top: 74px; bottom: 26px;
  clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%);
  background: linear-gradient(rgba(255, 210, 120, 0.35), rgba(255, 190, 90, 0.08));
  opacity: 0;
  animation: ws-flicker 1.3s 250ms forwards;
}
@keyframes ws-flicker {
  0% { opacity: 0; }
  12% { opacity: 0.6; }
  20% { opacity: 0.05; }
  34% { opacity: 0.85; }
  44% { opacity: 0.3; }
  60%, 100% { opacity: 1; }
}
.ws-plank {
  position: absolute; left: 0; right: 0; bottom: 14px; height: 12px;
  background: linear-gradient(#7a5030 0 2px, #5a3820 2px 9px, #2a180c 9px);
  border-radius: 2px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.5);
}
.cer-workshop .cer-icon {
  position: absolute; left: 50%; bottom: 26px; margin-left: -26px;
  color: #5a4630;
  animation: ws-icon 1.3s 250ms forwards;
}
.cer-workshop .cer-icon svg { width: 52px; height: 52px; display: block; }
@keyframes ws-icon {
  0%, 55% { color: #5a4630; filter: none; }
  70%, 100% { color: #ffd36a; filter: drop-shadow(0 0 8px rgba(255, 200, 90, 0.8)); }
}
.ws-status {
  font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: #d0a656;
  opacity: 0; animation: ws-in 300ms 1.2s forwards;
}
@keyframes ws-in {
  to { opacity: 1; }
}
.cer-workshop .cer-title { font-size: 26px; color: #ffe7b0; }
.cer-workshop .cer-text { color: #c9ad86; }
.cer-workshop .cer-continue {
  font-family: ${SERIF};
  background: linear-gradient(#e6c06a, #b0822e);
  color: #2a170a;
  border-color: #7a5a22;
}
@media (prefers-reduced-motion: reduce) {
  .jar.current .jar-glass, .jar-here, .ff-workshop .ff-star.lit, .ws-stamp { animation: none; }
  .lamp-glass, .lamp-filament, .ws-glow, .ws-pool, .cer-workshop .cer-icon, .ws-status { animation-duration: 1ms; animation-delay: 0ms; }
}
`;
