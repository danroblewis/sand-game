// App entry: wires core sim, renderer, input and HUD; runs the fixed-step loop.
import type { GameState, LevelDef } from './core/types';
import { createGame, moveBoxToward, stepGame, tryMoveBox } from './core';
import { SIM_SEED, generateDailySeed, generateLevel, generateLevelWithStats } from './levels/generate';
import { LEVELS } from './levels';
import { Renderer, createView } from './render/renderer';
import { attachPointer } from './input/pointer';
import { attachKeyboard, fixSelection } from './input/keyboard';
import { Hud } from './ui/hud';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
const WIN_DELAY_MS = 650;

const app = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));

const hud = new Hud(app, {
  onRestart: () => restart(),
  onPrev: () => prev(),
  onNext: () => next(),
  onSelectLevel: (i) => loadLevel(i),
  onNewRandom: () => newRandom(),
  onPlayRandom: (d) => loadRandom(d, freshSeed()),
  onPlayDaily: (d) => loadRandom(d, generateDailySeed()),
  onPlaySeed: (d, seed) => loadRandom(d, seed),
});
hud.setLevels(LEVELS);
hud.setDailySeed(generateDailySeed());

const renderer = new Renderer(hud.canvas);
const view = createView();

/** What is being played: a handmade campaign level or a generated one. */
type Mode = { kind: 'campaign'; index: number } | { kind: 'random'; difficulty: number; seed: number };

let mode: Mode = { kind: 'campaign', index: 0 };
let currentLevel: LevelDef | null = null;
let state: GameState;
let winTimer = 0;
let buildToken = 0;

/** Sim RNG seed (sand speckle / flow). Fixed so a level plays out exactly as it was verified:
 *  random levels are proven with the generator's SIM_SEED, campaign levels with seed 7
 *  (see tests/levels-physics.test.ts). Restarting therefore replays the same physics. */
function newSeed(): number {
  return mode.kind === 'random' ? SIM_SEED : 7;
}

/** A fresh, short, shareable level seed. */
function freshSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}

/** Start (or restart) playing a level definition. */
function startLevel(def: LevelDef): void {
  currentLevel = def;
  state = createGame(def, newSeed());
  view.selectedBoxId = null;
  view.dragBoxId = null;
  view.hoverBoxId = null;
  view.effects.length = 0;
  renderer.reset();
  window.clearTimeout(winTimer);
  accumulator = 0;
  layout(); // board size and hint height may have changed
}

function loadLevel(i: number): void {
  if (LEVELS.length === 0) return;
  buildToken++; // cancel a pending generation
  hud.hideBuilding();
  i = Math.max(0, Math.min(LEVELS.length - 1, i));
  mode = { kind: 'campaign', index: i };
  hud.setLevel(i, LEVELS[i]);
  startLevel(LEVELS[i]);
  setHash(`level-${i + 1}`);
}

/** Generate and play a random level. Shows a "Building level…" state while generating. */
function loadRandom(difficulty: number, seed: number): void {
  difficulty = Math.max(1, Math.min(10, Math.round(difficulty)));
  seed = Math.max(0, Math.min(0x7fffffff, Math.floor(seed)));
  const token = ++buildToken;
  hud.showBuilding(`Building level… (difficulty ${difficulty})`);
  // Let the overlay paint before the (synchronous, up to ~1 s) generation.
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      if (token !== buildToken) return;
      let def: LevelDef;
      try {
        def = generateLevel(seed, difficulty);
      } catch (err) {
        console.error(err);
        hud.showBuilding('Could not build that level. Try another seed.');
        window.setTimeout(() => token === buildToken && hud.hideBuilding(), 1800);
        return;
      }
      if (token !== buildToken) return;
      mode = { kind: 'random', difficulty, seed };
      hud.setRandomLevel(def, difficulty, seed);
      startLevel(def);
      setHash(def.id);
      hud.hideBuilding();
    }, 0),
  );
}

function restart(): void {
  if (!currentLevel) return;
  if (mode.kind === 'campaign') hud.setLevel(mode.index, currentLevel);
  else hud.setRandomLevel(currentLevel, mode.difficulty, mode.seed);
  startLevel(currentLevel); // same definition => identical level
}

function newRandom(): void {
  const d = mode.kind === 'random' ? mode.difficulty : hud.difficulty;
  loadRandom(d, freshSeed());
}

function next(): void {
  if (mode.kind === 'random') newRandom();
  else loadLevel(mode.index + 1);
}

function prev(): void {
  if (mode.kind === 'campaign') loadLevel(mode.index - 1);
}

// ---------- URL hash: #level-5 or #gen-7-48213 ----------
let currentHash = '';
function setHash(h: string): void {
  currentHash = h;
  if (location.hash.slice(1) !== h) history.replaceState(history.state, '', `#${h}`);
}

/** Load whatever the hash names. Returns false if it names nothing loadable. */
function loadFromHash(): boolean {
  const h = decodeURIComponent(location.hash.slice(1));
  const g = /^gen-(\d{1,2})-(\d{1,10})$/.exec(h);
  if (g) {
    const d = Number(g[1]);
    const seed = Number(g[2]);
    if (d >= 1 && d <= 10 && seed <= 0x7fffffff) {
      loadRandom(d, seed);
      return true;
    }
  }
  const l = /^level-(\d+)$/.exec(h);
  if (l) {
    const i = Number(l[1]) - 1;
    if (i >= 0 && i < LEVELS.length) {
      loadLevel(i);
      return true;
    }
  }
  return false;
}

window.addEventListener('hashchange', () => {
  if (location.hash.slice(1) !== currentHash) loadFromHash();
});

function initialLevel(): number {
  const { last, completed } = hud.progress;
  const lastIdx = last ? LEVELS.findIndex((l) => l.id === last) : -1;
  if (lastIdx >= 0) return lastIdx;
  const firstOpen = LEVELS.findIndex((l) => !completed.includes(l.id));
  return firstOpen >= 0 ? firstOpen : 0;
}

function drainEvents(now: number): void {
  const evs = state.events;
  if (evs.length === 0) return;
  for (const ev of evs) {
    for (const fx of renderer.effectsForEvent(ev, state, now)) view.effects.push(fx);
    if (ev.type === 'won') {
      const won = state;
      const m = mode;
      // Only real campaign/random levels count (not debug playLevel() boards).
      if (won.level === currentLevel) {
        if (m.kind === 'random') hud.markRandomSolved(won.level.id, m.difficulty);
        else hud.markCompleted(won.level.id);
      }
      window.clearTimeout(winTimer);
      winTimer = window.setTimeout(() => {
        if (state !== won || won.level !== currentLevel) return;
        if (m.kind === 'random') hud.showWin(won.moves, 'random');
        else hud.showWin(won.moves, m.index < LEVELS.length - 1 ? 'next' : 'last');
      }, WIN_DELAY_MS);
    }
  }
  evs.length = 0;
}

const blocked = () => hud.pickerOpen || hud.busy;
attachPointer({ canvas: hud.canvas, renderer, getState: () => state, view, isBlocked: blocked });
attachKeyboard({
  getState: () => state,
  view,
  isBlocked: blocked,
  actions: { restart, next, prev, isRandom: () => mode.kind === 'random' },
});

// ---------- Layout ----------
// Side-by-side HUD for short landscape screens (phones); must match the media query in style.css.
const landscapeMq = window.matchMedia('(orientation: landscape) and (max-height: 560px)');

/** Size the app to the visual viewport and the board to the free space left by the HUD. */
function layout(): void {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  if (state) renderer.setBoardSize(state.width, state.height);
  const wrap = hud.boardWrap;
  if (landscapeMq.matches) {
    wrap.style.height = '';
  } else {
    wrap.style.height = `${renderer.fitHeight(wrap.clientWidth, hud.freeBoardHeight())}px`;
  }
  renderer.resize();
}

let layoutQueued = false;
function queueLayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    layout();
  });
}

new ResizeObserver(queueLayout).observe(document.documentElement);
new ResizeObserver(() => renderer.resize()).observe(hud.boardWrap);
window.addEventListener('resize', queueLayout);
window.addEventListener('orientationchange', () => {
  queueLayout();
  window.setTimeout(layout, 250); // iOS reports the final size late
});
window.visualViewport?.addEventListener('resize', queueLayout);
landscapeMq.addEventListener('change', queueLayout);

// iOS Safari: no pinch-zoom gestures and no rubber-band/pull-to-refresh outside scrollable cards.
for (const t of ['gesturestart', 'gesturechange']) {
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
  'touchmove',
  (e) => {
    const t = e.target as Element | null;
    if (e.cancelable && !t?.closest('.card')) e.preventDefault();
  },
  { passive: false },
);

/** A held box that popped or froze is no longer held (the pointer may not have moved since). */
function releaseGoneHeldBox(): void {
  const id = state.heldBoxId;
  if (id === null || id === undefined) return;
  const b = state.boxes.find((x) => x.id === id);
  if (!b || b.state !== 'active' || b.frozen > 0) {
    state.heldBoxId = null;
    if (view.dragBoxId === id) view.dragBoxId = null;
  }
}

let accumulator = 0;
let lastTime = performance.now();

function frame(now: number): void {
  const dt = Math.min(250, now - lastTime);
  lastTime = now;
  if (state) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      stepGame(state);
      accumulator -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME && accumulator > STEP_MS) accumulator = 0; // drop backlog
    view.stepFrac = Math.min(1, accumulator / STEP_MS);
    drainEvents(now);
    releaseGoneHeldBox();
    fixSelection(state, view);
    renderer.render(state, view, now);
    hud.setMoves(state.moves);
  }
  requestAnimationFrame(frame);
}

if (!loadFromHash() && LEVELS.length > 0) loadLevel(initialLevel());
layout();
requestAnimationFrame(frame);

// Debug handle.
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  get state() {
    return state;
  },
  get mode() {
    return mode;
  },
  loadRandom,
  newRandom,
  core: { moveBoxToward, tryMoveBox },
  /** Debug: the generator's solution path for the current random level ("box#i -> (x,y)"). */
  solution(): string[] | null {
    return mode.kind === 'random' ? generateLevelWithStats(mode.seed, mode.difficulty).solution.path : null;
  },
  view,
  renderer,
  hud,
  levels: LEVELS,
  loadLevel,
  restart,
  /** Debug: play an arbitrary LevelDef without changing the level index. */
  playLevel(def: LevelDef) {
    window.clearTimeout(winTimer);
    hud.hideWin();
    state = createGame(def, newSeed());
    view.selectedBoxId = view.dragBoxId = view.hoverBoxId = null;
    view.effects.length = 0;
    renderer.reset();
    layout();
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) stepGame(state);
  },
};
