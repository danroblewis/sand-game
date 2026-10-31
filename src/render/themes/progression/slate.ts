// Slate progression: a vertical trail of level nodes per chapter (chapters are segments), with
// locks, stars and a "you are here" marker; a clean card fanfare; a star-burst ceremony.
import { buildFanfare, ceremonyButton, ceremonyIcon, h, LOCK_SVG, PIN_SVG, STAR_SVG, starsRow, type FanfareLabels } from './common';
import type { CeremonyView, FanfareView, MapLevelView, MapModel, SkinProgression } from './types';

/** Horizontal node positions along the trail (fractions of the width), repeating. */
const WAVE = [0.5, 0.7, 0.8, 0.7, 0.5, 0.3, 0.2, 0.3];
const ROW = 84; // px between nodes

const LABELS: FanfareLabels = {
  moves: 'moves',
  par: 'par',
  time: 'Time',
  sand: 'Sand flow',
  pour: 'Longest pour',
  best: 'best',
  newRecord: 'New record',
  firstClear: 'First clear',
  headline: (s) => (s === null ? 'Solved!' : s >= 3 ? 'Perfect!' : s === 2 ? 'Great!' : 'Solved!'),
};

function node(l: MapLevelView, x: number, y: number, model: MapModel): HTMLElement {
  const n = h('div', `trail-node${l.unlocked ? '' : ' locked'}${l.completed ? ' done' : ''}${l.current ? ' current' : ''}`);
  n.style.left = `${x * 100}%`;
  n.style.top = `${y}px`;
  const b = h('button', 'trail-btn');
  b.type = 'button';
  b.dataset.index = String(l.index);
  b.setAttribute('aria-label', `Level ${l.index + 1}: ${l.name}${l.unlocked ? (l.completed ? `, ${l.stars} stars` : '') : ` (locked: ${l.requirement ?? ''})`}`);
  b.innerHTML = l.unlocked ? `<span class="num">${l.index + 1}</span>` : LOCK_SVG;
  b.addEventListener('click', () => (l.unlocked ? model.select(l.index) : model.explain(l)));
  n.append(b);
  if (l.completed) n.append(starsRow(l.stars, 'stars trail-stars'));
  const name = h('span', `trail-name ${x > 0.55 ? 'left' : 'right'}`);
  name.textContent = l.name;
  n.append(name);
  if (l.current) n.append(h('span', `trail-pin ${x > 0.55 ? 'right' : 'left'}`, PIN_SVG));
  return n;
}

export const slateProgression: SkinProgression = {
  renderMap(host, model) {
    host.innerHTML = '';
    const root = h('div', 'pm pm-slate');
    const total = h('div', 'pm-total', `${STAR_SVG}<b>${model.totalStars}</b><span>/ ${model.maxStars}</span>`);
    root.append(total);
    let wave = 0;
    for (const ch of model.chapters) {
      const sec = h('section', `trail-ch${ch.unlocked ? '' : ' locked'}`);
      const head = h('header', 'trail-head');
      head.innerHTML = `<span class="trail-ch-num">Chapter ${ch.number}</span><span class="trail-ch-title"></span><span class="trail-ch-stars">${STAR_SVG}${ch.stars}/${ch.maxStars}</span>`;
      (head.querySelector('.trail-ch-title') as HTMLElement).textContent = ch.title;
      sec.append(head);
      if (!ch.unlocked && ch.requirement) {
        const lock = h('div', 'trail-lock', LOCK_SVG);
        lock.append(document.createTextNode(ch.requirement));
        sec.append(lock);
      }
      const path = h('div', 'trail');
      const height = ch.levels.length * ROW;
      path.style.height = `${height}px`;
      const pts: string[] = [];
      ch.levels.forEach((l, i) => {
        const x = WAVE[(wave + i) % WAVE.length];
        const y = i * ROW + ROW / 2;
        pts.push(`${(x * 100).toFixed(1)},${y}`);
        path.append(node(l, x, y, model));
      });
      wave += ch.levels.length;
      // The connecting path (done part solid, the rest dashed).
      const doneN = ch.levels.findIndex((l) => !l.completed);
      const cut = doneN < 0 ? pts.length : doneN + 1;
      const svg = `<svg class="trail-line" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">` +
        `<polyline class="rest" points="${pts.join(' ')}"/>` +
        (cut > 1 ? `<polyline class="walked" points="${pts.slice(0, cut).join(' ')}"/>` : '') +
        `</svg>`;
      path.insertAdjacentHTML('afterbegin', svg);
      sec.append(path);
      root.append(sec);
    }
    host.append(root);
  },

  winFanfare(host: HTMLElement, r: FanfareView) {
    return buildFanfare(host, r, 'slate', LABELS);
  },

  ceremony(host: HTMLElement, c: CeremonyView) {
    host.innerHTML = '';
    const root = h('div', `cer cer-slate cer-${c.unlock.kind}`);
    const burst = h('div', 'cer-burst');
    for (let i = 0; i < 12; i++) {
      const ray = h('i');
      ray.style.setProperty('--a', `${i * 30}deg`);
      burst.append(ray);
    }
    burst.append(h('span', 'cer-icon', ceremonyIcon(c)));
    const t = h('h2', 'cer-title');
    t.textContent = c.title;
    const p = h('p', 'cer-text');
    p.textContent = c.text;
    root.append(burst, t, p, ceremonyButton(c));
    host.append(root);
    (root.querySelector('.cer-continue') as HTMLElement | null)?.focus({ preventScroll: true });
    return () => {};
  },
};
