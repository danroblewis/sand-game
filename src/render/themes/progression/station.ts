// Station progression: a deck plan. Each chapter is a deck (a room) whose levels are hatches;
// sealed bulkheads between decks show what opens them. Fanfare is a delivery readout with lamp
// stars; the ceremony opens a hatch.
import { buildFanfare, ceremonyButton, ceremonyIcon, h, LOCK_SVG, STAR_SVG, type FanfareLabels } from './common';
import type { CeremonyView, FanfareView, MapLevelView, MapModel, SkinProgression } from './types';

const LABELS: FanfareLabels = {
  moves: 'moves',
  par: 'par',
  time: 'Run time',
  sand: 'Pour time',
  pour: 'Longest pour',
  best: 'best',
  newRecord: 'Record',
  firstClear: 'First delivery',
  headline: (s) => (s === null ? 'Delivery complete' : s >= 3 ? 'Flawless delivery' : 'Delivery complete'),
};

const pad = (n: number) => String(n).padStart(2, '0');

function hatch(l: MapLevelView, model: MapModel): HTMLElement {
  const b = h('button', `hatch${l.unlocked ? '' : ' locked'}${l.completed ? ' done' : ''}${l.current ? ' current' : ''}`);
  b.type = 'button';
  b.dataset.index = String(l.index);
  b.title = l.unlocked ? l.name : `${l.name}: ${l.requirement ?? 'locked'}`;
  b.setAttribute('aria-label', `Level ${l.index + 1}: ${l.name}${l.unlocked ? (l.completed ? `, ${l.stars} stars` : '') : ` (locked: ${l.requirement ?? ''})`}`);
  const lamps = [1, 2, 3].map((i) => `<i class="${l.completed && i <= l.stars ? 'on' : ''}"></i>`).join('');
  b.innerHTML = `<span class="hatch-num">${l.unlocked ? pad(l.index + 1) : LOCK_SVG}</span><span class="hatch-lamps">${lamps}</span>${l.current ? '<span class="hatch-beacon"></span>' : ''}`;
  b.addEventListener('click', () => (l.unlocked ? model.select(l.index) : model.explain(l)));
  return b;
}

export const stationProgression: SkinProgression = {
  renderMap(host, model) {
    host.innerHTML = '';
    const root = h('div', 'pm pm-station');
    root.append(h('div', 'deck-total', `<span>Cargo rating</span>${STAR_SVG}<b>${model.totalStars}</b><span>/ ${model.maxStars}</span>`));
    model.chapters.forEach((ch, i) => {
      if (i > 0) {
        const cor = h('div', `corridor${ch.unlocked ? ' open' : ''}`);
        cor.append(h('div', 'bulkhead', ch.unlocked ? '' : LOCK_SVG));
        if (!ch.unlocked && ch.requirement) {
          const req = h('span', 'bulkhead-req');
          req.textContent = ch.requirement;
          cor.append(req);
        }
        root.append(cor);
      }
      const deck = h('section', `deck${ch.unlocked ? '' : ' locked'}`);
      const plate = h('header', 'deck-plate');
      plate.innerHTML = `<span class="deck-id">Deck ${pad(ch.number)}</span><b class="deck-name"></b><span class="deck-stars">${STAR_SVG}${ch.stars}/${ch.maxStars}</span>`;
      (plate.querySelector('.deck-name') as HTMLElement).textContent = ch.title;
      const floor = h('div', 'deck-floor');
      for (const l of ch.levels) floor.append(hatch(l, model));
      deck.append(plate, floor);
      root.append(deck);
    });
    host.append(root);
  },

  winFanfare(host: HTMLElement, r: FanfareView) {
    return buildFanfare(host, r, 'station', LABELS);
  },

  ceremony(host: HTMLElement, c: CeremonyView) {
    host.innerHTML = '';
    const root = h('div', `cer cer-station cer-${c.unlock.kind}`);
    root.append(h('div', 'cer-status', 'Access granted'));
    const door = h('div', 'cer-hatch');
    door.append(h('span', 'cer-icon', ceremonyIcon(c)), h('i', 'door-l'), h('i', 'door-r'));
    const t = h('h2', 'cer-title');
    t.textContent = c.title;
    const p = h('p', 'cer-text');
    p.textContent = c.text;
    root.append(door, t, p, ceremonyButton(c));
    host.append(root);
    (root.querySelector('.cer-continue') as HTMLElement | null)?.focus({ preventScroll: true });
    return () => {};
  },
};
