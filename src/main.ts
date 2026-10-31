// App entry: wires core sim, renderer, input and HUD; runs the fixed-step loop.
import type { GameState, LevelDef } from './core/types';
import { createGame, moveBoxToward, stepGame, tryMoveBox } from './core';
import { SIM_SEED, generateDailySeed, generateLevel, generateLevelWithStats } from './levels/generate';
import { LEVELS } from './levels';
import { Renderer, createView, type CameraMode } from './render/renderer';
import { attachPointer } from './input/pointer';
import { attachKeyboard, fixSelection } from './input/keyboard';
import { Hud } from './ui/hud';
import { HeroInput, heroApi } from './input/hero';
import { Sfx, measureSound } from './audio/sfx';
import { Haptics } from './audio/haptics';
import type { Dir } from './core/types';
import { gravityFor } from './ui/progress';
import type { GenerateOptions } from './levels/generate';

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
  onPlayRandom: (d) => {
    const seed = freshSeed();
    loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero);
  },
  onPlayDaily: (d) => {
    const seed = generateDailySeed();
    loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero);
  },
  onPlaySeed: (d, seed, gravity, hero) =>
    loadRandom(d, seed, gravity ?? gravityFor(hud.randomMode, seed), hero ?? hud.randomHero),
  onUndo: () => undo(),
  onSound: (on) => sfx.setEnabled(on),
  onSoundDiag: () => toggleAudioDiag(),
  onOverview: () => toggleOverview(),
  onMenu: (open) => {
    if (open) {
      heroInput?.cancel();
      pointerCtl?.cancel();
    }
  },
  onHaptics: (on) => haptics.setEnabled(on),
  onHapticsTest: () => haptics.test(),
  onHeroMove: (d) => heroKey(d),
});
hud.setLevels(LEVELS);
hud.setDailySeed(generateDailySeed());

const renderer = new Renderer(hud.canvas);

// ---------- Sound: never autoplays; the context is created/resumed on the first user gesture ----------
const sfx = new Sfx(hud.progress.sound);
const haptics = new Haptics(hud.progress.haptics);
// iOS only counts touchend / click / keydown as activation for audio, so unlock on all of them,
// synchronously, every time (cheap once running): this also recovers 'interrupted'/'suspended'.
const unlockAudio = () => {
  haptics.activate();
  sfx.unlock();
};
for (const t of ['touchend', 'click', 'keydown', 'pointerup', 'pointerdown']) {
  window.addEventListener(t, unlockAudio, { capture: true, passive: true });
}

// ---------- Audio diagnostics overlay: ?audio=1, or hold the speaker button for 1 s ----------
let diagEl: HTMLElement | null = null;
let diagTimer = 0;
function toggleAudioDiag(show = !diagEl): void {
  if (!show) {
    window.clearInterval(diagTimer);
    diagEl?.remove();
    diagEl = null;
    return;
  }
  if (diagEl) return;
  const el = document.createElement('div');
  el.className = 'audio-diag';
  el.setAttribute('role', 'status');
  el.title = 'Tap to close';
  el.addEventListener('click', () => toggleAudioDiag(false));
  document.body.append(el);
  diagEl = el;
  const paint = () => {
    const d = sfx.state();
    el.textContent =
      `audio  ${d.enabled ? 'on' : 'MUTED'}${d.supported ? '' : ' (no Web Audio)'}\n` +
      `context  ${d.context}  ${d.sampleRate ? d.sampleRate + ' Hz' : ''}${d.createdRate && d.createdRate !== d.sampleRate ? ' (was ' + d.createdRate + ')' : ''}\n` +
      `silent <audio>  ${d.silentElement}\n` +
      `unlocks ${d.unlocks}  resumes ${d.resumes}  recreated ${d.recreated}\n` +
      `last error  ${d.lastError || '-'}\n` +
      `haptics  ${haptics.backend}${haptics.isEnabled ? '' : ' (off)'}${haptics.backend === 'ios-switch' ? '  ticks ' + haptics.ticks : ''}`;
  };
  paint();
  diagTimer = window.setInterval(paint, 400);
}
if (new URLSearchParams(location.search).get('audio') === '1') toggleAudioDiag(true);
let flowThisFrame = 0;
let popsThisFrame = 0;
let heroFoot: 0 | 1 = 0;
let lastThrustAt = 0;
const view = createView();

/** What is being played: a handmade campaign level or a generated one. */
type Mode =
  | { kind: 'campaign'; index: number }
  | { kind: 'random'; difficulty: number; seed: number; gravity: boolean; hero: boolean };

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

// ---------- Hero (pusher) levels: moves with undo ----------
const UNDO_CAP = 200;
let undoStack: unknown[] = [];

/** One hero input. Snapshot first; keep it on the undo stack only if the move happened. */
function heroStep(dir: Dir): boolean {
  const move = heroApi.moveHero;
  if (!state || !state.hero || !move || hud.busy || hud.pickerOpen) return false;
  const snap = heroApi.snapshot?.(state);
  const ok = !!move(state, dir);
  if (ok && snap !== undefined) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    hud.setUndoCount(undoStack.length);
  }
  return ok;
}

/** One kick: snapshot first; one undo entry per kick (the hero stays put). */
function heroKick(dir: Dir): boolean {
  const kick = heroApi.kickBox;
  if (!state || !state.hero || !kick || hud.busy || hud.pickerOpen || hud.menuOpen) return false;
  const snap = heroApi.snapshot?.(state);
  const ok = !!kick(state, dir);
  if (ok && snap !== undefined) {
    undoStack.push(snap);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    hud.setUndoCount(undoStack.length);
  }
  return ok;
}

/** Keyboard / d-pad move: cancels a tap-to-walk in progress. */
function heroKey(dir: Dir): void {
  heroInput.cancel();
  heroStep(dir);
}

function undo(): void {
  const restore = heroApi.restore;
  if (!state || !state.hero || !restore || undoStack.length === 0) return;
  heroInput.cancel();
  restore(state, undoStack.pop());
  sfx.play('undo');
  state.events.length = 0;
  view.effects.length = 0;
  renderer.reset(); // snap to the restored positions
  window.clearTimeout(winTimer);
  hud.hideWin();
  hud.setUndoCount(undoStack.length);
}

/** Start (or restart) playing a level definition. */
/** Camera per level ('fit' unless the level asks for a big-map camera). */
function applyCamera(def: LevelDef): void {
  renderer.setCamera((def as LevelDef & { camera?: CameraMode }).camera);
  view.lastMovedBoxId = null;
  view.dragEdge = undefined;
}

function startLevel(def: LevelDef): void {
  applyCamera(def);
  undoStack = [];
  heroInput?.cancel();
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
/**
 * Generate a level. Floating levels pass the plain difficulty (works with every generator version);
 * gravity levels pass `{ difficulty, gravity: true }`. An older generator that ignores the flag
 * yields a floating level, which is then shown and linked as floating.
 */
function generate(seed: number, difficulty: number, gravity: boolean, hero: boolean): LevelDef {
  if (!gravity && !hero) return generateLevel(seed, difficulty);
  return generateLevel(seed, genOpts(difficulty, gravity, hero));
}

/** Options object for gravity/hero levels (`hero` may not be known to an older generator). */
function genOpts(difficulty: number, gravity: boolean, hero: boolean): GenerateOptions {
  const o: Record<string, unknown> = { difficulty };
  if (gravity) o.gravity = true;
  if (hero) o.hero = true;
  return o as unknown as GenerateOptions;
}

function loadRandom(difficulty: number, seed: number, gravity = false, hero = false): void {
  difficulty = Math.max(1, Math.min(10, Math.round(difficulty)));
  seed = Math.max(0, Math.min(0x7fffffff, Math.floor(seed)));
  const token = ++buildToken;
  hud.showBuilding(`Building level… (difficulty ${difficulty}${gravity ? ', gravity' : ''}${hero ? ', pusher' : ''})`);
  // Let the overlay paint before the (synchronous, up to ~1 s) generation.
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      if (token !== buildToken) return;
      let def: LevelDef;
      try {
        def = generate(seed, difficulty, gravity, hero);
      } catch (err) {
        console.error(err);
        hud.showBuilding('Could not build that level. Try another seed.');
        window.setTimeout(() => token === buildToken && hud.hideBuilding(), 1800);
        return;
      }
      if (token !== buildToken) return;
      // What was actually generated decides the title and the link (an older generator may ignore
      // the hero/gravity flags).
      mode = { kind: 'random', difficulty, seed, gravity: !!def.boxGravity, hero: !!def.hero };
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
  const seed = freshSeed();
  loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero);
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
  const g = /^gen-(\d{1,2})(g?)(h?)-(\d{1,10})$/.exec(h);
  if (g) {
    const d = Number(g[1]);
    const seed = Number(g[4]);
    if (d >= 1 && d <= 10 && seed <= 0x7fffffff) {
      loadRandom(d, seed, g[2] === 'g', g[3] === 'h');
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

/** Map game events to sounds (pops in one frame are staggered so a group chords, not stacks). */
function playSound(ev: GameState['events'][number]): void {
  switch (ev.type) {
    case 'transfer':
      flowThisFrame += ev.count;
      break;
    case 'boxCompleted':
      // A group pops in one frame: one vibration pattern, chorded (staggered) sounds.
      if (popsThisFrame === 0) haptics.pulse('pop');
      sfx.play('pop', { color: ev.color, delay: Math.min(popsThisFrame++, 5) * 0.025 });
      break;
    case 'boxUnfrozen':
      sfx.play('thaw');
      haptics.pulse('thaw');
      break;
    case 'boxLanded':
      sfx.play('land', { fell: ev.fell });
      break;
    case 'heroLanded':
      sfx.play('land', { fell: ev.fell });
      haptics.pulse('land', ev.fell);
      break;
    case 'heroMoved':
      if (ev.climbed) sfx.play('climb');
      else sfx.play('step', { foot: (heroFoot = heroFoot ? 0 : 1) });
      break;
    case 'heroPushed':
      sfx.play('push');
      break;
    case 'forcePushed': {
      // trains can push every few steps: rate-limit the puff
      const t = performance.now();
      if (t - lastThrustAt > 180) {
        lastThrustAt = t;
        sfx.play('thrust');
      }
      break;
    }
    case 'heroKicked':
      sfx.play('whoosh');
      break;
    case 'boxSlid':
      sfx.play('stop', { fell: Math.min(6, 1 + ev.cells) });
      haptics.pulse('tick');
      break;
    case 'boxMoved': {
      // Player moves in drag levels only (falls and pushes have their own sounds).
      if (state.hero) break;
      const b = state.boxes.find((x) => x.id === ev.boxId);
      if (b && !b.falling) sfx.play('slide');
      break;
    }
    case 'won':
      sfx.play('win', { delay: 0.2 });
      haptics.pulse('win');
      break;
    case 'debrisDissolved':
      sfx.play('debris');
      break;
    case 'conveyed':
      sfx.play('belt');
      break;
  }
}

function drainEvents(now: number): void {
  const evs = state.events;
  if (evs.length === 0) return;
  for (const ev of evs) {
    for (const fx of renderer.effectsForEvent(ev, state, now)) view.effects.push(fx);
    playSound(ev);
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

const blocked = () => hud.pickerOpen || hud.busy || hud.menuOpen;
const pointerCtl = attachPointer({ canvas: hud.canvas, renderer, getState: () => state, view, isBlocked: blocked });

// ---------- Big maps: overview (pinch / O / map button) and overview taps ----------
// Capture-phase on the canvas: runs before the drag / hero handlers and can swallow the event.
{
  const touches = new Map<number, { x: number; y: number }>();
  let pinchD0 = 0;
  let pinched = false;
  let ovTap: { id: number; x: number; y: number } | null = null;
  const c = hud.canvas;
  const dist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  c.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && renderer.cameraActive) {
        pinchD0 = dist();
        pinched = true;
        pointerCtl.cancel();
        heroInput.cancel();
        e.stopImmediatePropagation();
        return;
      }
      if (renderer.overview && !blocked()) {
        // overview: taps navigate only (no drags, no walking)
        ovTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  c.addEventListener(
    'pointermove',
    (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinchD0 > 0) {
        const r = dist() / pinchD0;
        if (r < 0.75 && !renderer.overview) renderer.setOverview(true); // fingers together: zoom out
        if (r > 1.33 && renderer.overview) renderer.setOverview(false); // spread: back in
        e.stopImmediatePropagation();
      } else if (ovTap) e.stopImmediatePropagation();
    },
    { capture: true },
  );
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchD0 = 0;
    if (pinched) {
      if (touches.size === 0) pinched = false;
      e.stopImmediatePropagation(); // the pinch's fingers never tap / walk / drop
      return;
    }
    if (ovTap && e.pointerId === ovTap.id) {
      const r = c.getBoundingClientRect();
      if (e.type === 'pointerup') renderer.overviewTap(ovTap.x - r.left, ovTap.y - r.top);
      ovTap = null;
      e.stopImmediatePropagation();
    }
  };
  c.addEventListener('pointerup', up, { capture: true });
  c.addEventListener('pointercancel', up, { capture: true });
}
function toggleOverview(): void {
  if (renderer.cameraActive) renderer.toggleOverview();
}
attachKeyboard({
  getState: () => state,
  view,
  isBlocked: blocked,
  actions: { restart, next, prev, isRandom: () => mode.kind === 'random', heroMove: heroKey, heroKeyDown: (d, kick) => heroInput.keyDown(d, kick), undo, overview: toggleOverview, menu: () => hud.openMenu() },
});
const heroInput: HeroInput = new HeroInput({
  canvas: hud.canvas,
  renderer,
  getState: () => state,
  step: heroStep,
  kick: heroKick,
  view,
  onThreshold: (armed) => {
    sfx.play('armed', { foot: armed ? 1 : 0 });
    haptics.pulse('tick');
  },
  isBlocked: blocked,
});

// ---------- Layout ----------
// Side-by-side HUD for short landscape screens (phones); must match the media query in style.css.
const landscapeMq = window.matchMedia('(orientation: landscape)');

/** Size the app to the visual viewport and the board to the free space left by the HUD. */
function layout(): void {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  if (state) renderer.setBoardSize(state.width, state.height);
  // The board fills everything below the top bar; the renderer fits / scrolls inside it.
  hud.boardWrap.style.height = '';
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
    flowThisFrame = 0;
    popsThisFrame = 0;
    drainEvents(now);
    const flowRate = steps > 0 ? flowThisFrame / steps : 0;
    sfx.update(dt / 1000, flowRate);
    haptics.update(dt / 1000, flowRate, now);
    releaseGoneHeldBox();
    pointerCtl.tick();
    heroInput.tick(now);
    hud.setBigMap(renderer.cameraActive);
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
    if (mode.kind !== 'random') return null;
    const m = mode;
    return generateLevelWithStats(m.seed, m.gravity || m.hero ? genOpts(m.difficulty, m.gravity, m.hero) : m.difficulty).solution.path;
  },
  view,
  renderer,
  hud,
  levels: LEVELS,
  loadLevel,
  restart,
  heroStep,
  heroKick,
  undo,
  sfx,
  haptics,
  measureSound,
  get undoDepth() {
    return undoStack.length;
  },
  heroInput: () => heroInput,
  /** Debug: play an arbitrary LevelDef without changing the level index. */
  playLevel(def: LevelDef) {
    window.clearTimeout(winTimer);
    hud.hideWin();
    undoStack = [];
    heroInput.cancel();
    hud.showLevelChrome(def); // badges / undo button only; progress is untouched
    applyCamera(def);
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
