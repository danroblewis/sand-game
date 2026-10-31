// App entry: wires core sim, renderer, input and HUD; runs the fixed-step loop.
import type { GameState, LevelDef } from './core/types';
import { createGame, moveBoxToward, stepGame, tryMoveBox } from './core';
import { SIM_SEED, generateDailySeed, generateLevel, generateLevelWithStats } from './levels/generate';
import { LEVELS } from './levels';
import { Renderer, createView, type CameraMode } from './render/renderer';
import { attachPointer } from './input/pointer';
import { attachKeyboard, fixSelection } from './input/keyboard';
import { Hud, lockBypass } from './ui/hud';
import { migrateCompleted, nextPendingUnlock, recordWin, settleSeen, type Unlock } from './progress/model';
import type { FanfareView } from './render/themes/progression/types';
import { chapterTheme } from './ui/chapters';
import { listSkins } from './render/themes';
import { HeroInput, heroApi } from './input/hero';
import { Sfx, measureSound } from './audio/sfx';
import { Haptics } from './audio/haptics';
import type { Dir } from './core/types';
import { gravityFor, saveProgress } from './ui/progress';
import type { GenerateOptions } from './levels/generate';
import { parFor } from './levels/par';
import { boxPath, parseHeroEntry, parseStep } from './levels/replay';

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
    loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero || hud.randomBig, hud.randomBig);
  },
  onPlayDaily: (d) => {
    const seed = generateDailySeed();
    loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero || hud.randomBig, hud.randomBig);
  },
  onPlaySeed: (d, seed, gravity, hero, big) => {
    const b = big ?? (hero === undefined ? hud.randomBig : false);
    loadRandom(d, seed, gravity ?? gravityFor(hud.randomMode, seed), (hero ?? hud.randomHero) || b, b);
  },
  onUndo: () => undo(),
  onSound: (on) => sfx.setEnabled(on),
  onSoundDiag: () => toggleAudioDiag(),
  onTheme: () => {
    if (currentLevel) applyTheme(currentLevel);
  },
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
// Locks can be bypassed for testing / authoring: ?unlock=all
if (new URLSearchParams(location.search).get('unlock') === 'all') lockBypass.all = true;
hud.setLevels(LEVELS);
// Progression: an older profile's completed levels become 1-star records, and whatever is already
// open is marked seen (no ceremony flood for a returning player).
if (hud.progress.progression < 1) {
  migrateCompleted(hud.progress, LEVELS);
  settleSeen(hud.progress, LEVELS);
  hud.progress.progression = 1;
  saveProgress(hud.progress);
}
hud.renderFreePlay();
hud.setDailySeed(generateDailySeed());

const renderer = new Renderer(hud.canvas);
hud.setThemes(listSkins().map((k) => ({ id: k.id, name: k.name })));

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
  | { kind: 'random'; difficulty: number; seed: number; gravity: boolean; hero: boolean; big: boolean };

let mode: Mode = { kind: 'campaign', index: 0 };
let currentLevel: LevelDef | null = null;
let state: GameState;
let winTimer = 0;
let buildToken = 0;

/** Per-run stats (no clock is shown during play): sim steps since the first input, and steps in
 *  which sand flowed into a box. */
const stats = { steps: 0, flowSteps: 0 };
const STEPS_PER_SEC = 60;

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
/**
 * Skin for a level: a fixed pick in the menu wins; on Auto it is the level's theme, else its
 * chapter's theme, else slate. The page background follows the skin.
 */
function themeFor(def: LevelDef): string {
  const pick = hud.progress.theme;
  if (pick && pick !== 'auto') return pick;
  if (def.theme) return def.theme;
  if (mode.kind === 'campaign' && LEVELS[mode.index] === def) return chapterTheme(mode.index) ?? 'slate';
  return 'slate';
}
function applyTheme(def: LevelDef): void {
  const skin = renderer.setSkin(themeFor(def));
  hud.skinProgression = skin.progression;
  hud.skinId = skin.id;
  document.documentElement.style.setProperty('--bg', skin.pageBg);
  document.documentElement.dataset.theme = skin.id;
}

/** Camera per level ('fit' unless the level asks for a big-map camera). */
function applyCamera(def: LevelDef): void {
  renderer.setCamera((def as LevelDef & { camera?: CameraMode }).camera);
  view.lastMovedBoxId = null;
  view.dragEdge = undefined;
}

/** Big-map drag levels: a one-time hint about looking around. */
let bigMapHintTimer = 0;
let pendingHint: LevelDef | null = null;
function maybeBigMapHint(def: LevelDef): void {
  const p = hud.progress as typeof hud.progress & { seenBigMapHint?: boolean };
  if (p.seenBigMapHint || def.hero || !renderer.cameraActive) return;
  p.seenBigMapHint = true;
  try {
    localStorage.setItem('sandboxes.progress', JSON.stringify(p));
  } catch {
    /* ignore */
  }
  let el = document.querySelector('.bigmap-hint') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'bigmap-hint';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = 'Drag empty space to look around · O or the map button shows the whole board';
  el.classList.add('show');
  window.clearTimeout(bigMapHintTimer);
  bigMapHintTimer = window.setTimeout(() => el?.classList.remove('show'), 4500);
  el.onclick = () => el?.classList.remove('show');
}

function startLevel(def: LevelDef): void {
  applyCamera(def);
  applyTheme(def);
  undoStack = [];
  heroInput?.cancelGesture();
  currentLevel = def;
  stats.steps = stats.flowSteps = 0;
  state = createGame(def, newSeed());
  view.selectedBoxId = null;
  view.dragBoxId = null;
  view.hoverBoxId = null;
  view.effects.length = 0;
  renderer.reset();
  window.clearTimeout(winTimer);
  accumulator = 0;
  layout(); // board size and hint height may have changed
  pendingHint = def; // checked on the first rendered frame (the camera needs the final layout)
}

/** Play campaign level i. Locked levels are refused (the map opens with the requirement) unless
 *  `force` (debug). Returns whether the level was loaded. */
function loadLevel(i: number, force = false): boolean {
  if (LEVELS.length === 0) return false;
  i = Math.max(0, Math.min(LEVELS.length - 1, i));
  if (!force && !hud.levelUnlocked(i)) {
    showLocked(i);
    return false;
  }
  buildToken++; // cancel a pending generation
  hud.hideBuilding();
  mode = { kind: 'campaign', index: i };
  hud.setLevel(i, LEVELS[i]);
  startLevel(LEVELS[i]);
  setHash(`level-${i + 1}`);
  return true;
}

/** A locked level was asked for: open the map and say what opens it. */
function showLocked(i: number): void {
  hud.hideWin();
  hud.openMap();
  hud.showStatus(`Level ${i + 1} is locked: ${hud.lockRequirement(i)}`);
}

/** Generate and play a random level. Shows a "Building level…" state while generating. */
/**
 * Generate a level. Floating levels pass the plain difficulty (works with every generator version);
 * gravity levels pass `{ difficulty, gravity: true }`. An older generator that ignores the flag
 * yields a floating level, which is then shown and linked as floating.
 */
function generate(seed: number, difficulty: number, gravity: boolean, hero: boolean, big = false): LevelDef {
  if (!gravity && !hero) return generateLevel(seed, difficulty);
  return generateLevel(seed, genOpts(difficulty, gravity, hero, big));
}

/** Options object for gravity/hero levels (`hero` may not be known to an older generator). */
function genOpts(difficulty: number, gravity: boolean, hero: boolean, big = false): GenerateOptions {
  const o: Record<string, unknown> = { difficulty };
  if (gravity) o.gravity = true;
  if (hero || big) o.hero = true;
  if (big) o.big = true;
  return o as unknown as GenerateOptions;
}

function loadRandom(difficulty: number, seed: number, gravity = false, hero = false, big = false): void {
  if (big) hero = true; // an Expedition is a hero level
  difficulty = Math.max(1, Math.min(10, Math.round(difficulty)));
  seed = Math.max(0, Math.min(0x7fffffff, Math.floor(seed)));
  const token = ++buildToken;
  hud.showBuilding(`Building ${big ? 'expedition' : 'level'}… (difficulty ${difficulty}${gravity ? ', gravity' : ''}${hero && !big ? ', pusher' : ''})`);
  // Let the overlay paint before the (synchronous, up to ~1 s) generation.
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      if (token !== buildToken) return;
      let def: LevelDef;
      try {
        def = generate(seed, difficulty, gravity, hero, big);
      } catch (err) {
        console.error(err);
        hud.showBuilding('Could not build that level. Try another seed.');
        window.setTimeout(() => token === buildToken && hud.hideBuilding(), 1800);
        return;
      }
      if (token !== buildToken) return;
      // What was actually generated decides the title and the link (an older generator may ignore
      // the hero/gravity flags).
      const cam = (def as LevelDef & { camera?: CameraMode }).camera;
      mode = { kind: 'random', difficulty, seed, gravity: !!def.boxGravity, hero: !!def.hero, big: !!cam && cam !== 'fit' };
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
  if (mode.kind !== 'random' && !hud.freePlayOpen) {
    hud.openMap(); // shows what opens Free Play
    return;
  }
  const d = mode.kind === 'random' ? mode.difficulty : hud.difficulty;
  const big = mode.kind === 'random' ? mode.big : hud.randomBig;
  const seed = freshSeed();
  loadRandom(d, seed, gravityFor(hud.randomMode, seed), hud.randomHero || big, big);
}

/** Next level; in the campaign it stops at the first locked level (the map explains why). */
function next(): void {
  if (mode.kind === 'random') newRandom();
  else if (mode.index + 1 < LEVELS.length) loadLevel(mode.index + 1);
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
  const g = /^gen-(\d{1,2})(x?)(g?)(h?)-(\d{1,10})$/.exec(h);
  if (g) {
    const d = Number(g[1]);
    const seed = Number(g[5]);
    if (d >= 1 && d <= 10 && seed <= 0x7fffffff) {
      // First-time visitors see the campaign first; existing players can open shared links.
      if (!hud.freePlayOpen && !hud.progress.completed.length) {
        if (!currentLevel) loadLevel(initialLevel());
        hud.openMap();
        hud.showStatus('Shared levels open in Free Play: solve a few campaign levels first.');
        return true;
      }
      const big = g[2] === 'x';
      loadRandom(d, seed, g[3] === 'g', g[4] === 'h' || big, big);
      return true;
    }
  }
  const l = /^level-(\d+)$/.exec(h);
  if (l) {
    const i = Number(l[1]) - 1;
    if (i >= 0 && i < LEVELS.length) {
      if (!hud.levelUnlocked(i)) {
        // locked: play the furthest open level instead and show what opens this one
        if (!currentLevel) loadLevel(initialLevel());
        showLocked(i);
        return true;
      }
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
  const { last } = hud.progress;
  const lastIdx = last ? LEVELS.findIndex((l) => l.id === last) : -1;
  if (lastIdx >= 0 && hud.levelUnlocked(lastIdx)) return lastIdx;
  const firstOpen = LEVELS.findIndex((l, i) => !hud.isCompleted(l.id) && hud.levelUnlocked(i));
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
    case 'heroThrown':
      sfx.play('whoosh');
      break;
    case 'heroSlid':
      sfx.play('stop', { fell: Math.min(6, 1 + ev.cells) });
      haptics.pulse('tick');
      break;
    case 'heroMoved':
      if ((state.hero as { sliding?: unknown } | null)?.sliding) break; // thrown: no footsteps
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

/** Record a win and build its fanfare (records are saved now, the screen shows after a beat). */
function winFanfare(won: GameState, m: Mode): FanfareView {
  const seconds = stats.steps / STEPS_PER_SEC;
  const sandSeconds = stats.flowSteps / STEPS_PER_SEC;
  const onStar = (i: number) => {
    sfx.play('star', { color: i });
    haptics.pulse('tick');
  };
  const leave = (fn: () => void) => () => {
    hud.hideWin();
    runCeremonies(fn);
  };
  if (m.kind === 'random') {
    hud.markRandomSolved(won.level.id, m.difficulty);
    return {
      kicker: m.big ? 'Expedition' : 'Free Play',
      title: won.level.name,
      stars: null,
      prevStars: 0,
      moves: won.moves,
      seconds,
      sandSeconds,
      newRecord: { moves: false, seconds: false, sandSeconds: false, pour: false },
      firstClear: false,
      next: { label: 'Next random', run: leave(() => newRandom()) },
      replay: { label: 'Replay', run: leave(() => restart()) },
      map: { label: 'Map', run: leave(() => hud.openMap()) },
      onStar,
    };
  }
  const o = recordWin(hud.progress, LEVELS, won.level.id, { moves: won.moves, seconds, sandSeconds });
  saveProgress(hud.progress);
  hud.markCompleted(won.level.id);
  const i = m.index;
  const hasNext = i + 1 < LEVELS.length && hud.levelUnlocked(i + 1);
  const r = o.record;
  return {
    kicker: `Level ${i + 1}`,
    title: won.level.name,
    stars: o.stars,
    prevStars: o.prevStars,
    moves: won.moves,
    parMoves: o.par?.moves,
    seconds,
    sandSeconds,
    best: o.before ? { moves: r.bestMoves, seconds: r.bestSeconds, sandSeconds: r.bestSandSeconds, pour: r.maxSandSeconds } : undefined,
    newRecord: o.newRecord,
    firstClear: o.firstClear,
    unlockedText: o.unlockedNext ? `Level ${i + 2} unlocked` : undefined,
    next: hasNext ? { label: 'Next level', run: leave(() => next()) } : null,
    replay: { label: 'Replay', run: leave(() => restart()) },
    map: { label: 'Map', run: leave(() => hud.openMap()) },
    onStar,
  };
}

/** Show queued unlock ceremonies one at a time, then run `then`. */
function runCeremonies(then: () => void = () => {}): void {
  const u = nextPendingUnlock(hud.progress);
  if (!u) {
    then();
    return;
  }
  saveProgress(hud.progress); // dequeued: it fires once
  const t = ceremonyText(u);
  hud.showCeremony({
    unlock: u,
    title: t.title,
    text: t.text,
    cta: 'Continue',
    onContinue: () => {
      hud.hideCeremony();
      runCeremonies(then);
    },
  });
  sfx.play('unlock');
  haptics.pulse('win');
}

function ceremonyText(u: Unlock): { title: string; text: string } {
  if (u.kind === 'chapter') return { title: `Chapter ${u.chapter} unlocked`, text: `${u.title}: a new set of levels is open on the map.` };
  if (u.kind === 'freeplay') return { title: 'Free Play unlocked', text: 'Random levels, the daily puzzle and expeditions are now on the level map.' };
  return { title: `${u.stars} stars!`, text: 'Chapters open as you collect stars. Replay a level under par for three.' };
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
      if (won.level !== currentLevel) continue;
      const fanfare = winFanfare(won, m);
      window.clearTimeout(winTimer);
      winTimer = window.setTimeout(() => {
        if (state !== won || won.level !== currentLevel) return;
        hud.showFanfare(fanfare);
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
  let mid0: { x: number; y: number } | null = null;
  const mid = () => {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  let pinched = false;
  let ovTap: { id: number; x: number; y: number } | null = null;
  const c = hud.canvas;
  const dist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  // A finger lifted outside the canvas must still leave the set (or the next touch looks like a pinch).
  const forget = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchD0 = 0;
    if (touches.size === 0) pinched = false;
  };
  window.addEventListener('pointerup', forget, true);
  window.addEventListener('pointercancel', forget, true);
  c.addEventListener(
    'pointerdown',
    (e) => {
      // a new primary pointer means every earlier touch has ended
      if (e.isPrimary) {
        touches.clear();
        pinched = false;
        pinchD0 = 0;
      }
      if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && renderer.cameraActive) {
        pinchD0 = dist();
        mid0 = mid();
        pinched = true;
        pointerCtl.cancel();
        heroInput.cancelGesture();
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
        // two fingers moving together: pan
        const m = mid();
        if (mid0 && r > 0.85 && r < 1.18) renderer.panBy(m.x - mid0.x, m.y - mid0.y);
        mid0 = m;
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
  if (!renderer.cameraActive) return;
  heroInput.cancelGesture();
  renderer.toggleOverview();
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

/** One fixed sim step, with the run stats: sim time since the first input, and steps in which
 *  sand flowed into a box (both stop at the win). */
function simStep(): void {
  const ev0 = state.events.length;
  const wonBefore = state.won;
  stepGame(state);
  if (state.moves > 0 && !wonBefore) {
    stats.steps++;
    for (let k = ev0; k < state.events.length; k++) {
      if (state.events[k].type === 'transfer') {
        stats.flowSteps++;
        break;
      }
    }
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
      simStep();
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
    if (pendingHint && pendingHint === currentLevel) {
      maybeBigMapHint(pendingHint);
      pendingHint = null;
    }
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
if (hud.progress.pendingUnlocks.length) runCeremonies(); // left over from an earlier session
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
  /** Debug: loads any level, locked or not. */
  loadLevel: (i: number) => loadLevel(i, true),
  /** Debug / tests: ignore the lock rules for this session (same as ?unlock=all). */
  unlockAll(on = true) {
    lockBypass.all = on;
    hud.renderFreePlay();
  },
  get progress() {
    return hud.progress;
  },
  parFor,
  get stats() {
    return { ...stats, seconds: stats.steps / STEPS_PER_SEC, sandSeconds: stats.flowSteps / STEPS_PER_SEC };
  },
  restart,
  heroStep,
  heroKick,
  /** Theme override: 'auto' or a skin id (persisted, like the menu picker). */
  setTheme(id: string) {
    hud.setTheme(id);
  },
  get skin() {
    return renderer.skin.id;
  },
  undo,
  sfx,
  haptics,
  measureSound,
  get undoDepth() {
    return undoStack.length;
  },
  heroInput: () => heroInput,
  /** Debug: play an arbitrary LevelDef without changing the level index. */
  playLevel(def: LevelDef, seed?: number) {
    window.clearTimeout(winTimer);
    hud.hideWin();
    undoStack = [];
    heroInput.cancel();
    hud.showLevelChrome(def); // badges / undo button only; progress is untouched
    applyCamera(def);
    applyTheme(def);
    state = createGame(def, seed ?? newSeed());
    stats.steps = stats.flowSteps = 0;
    view.selectedBoxId = view.dragBoxId = view.hoverBoxId = null;
    view.effects.length = 0;
    renderer.reset();
    layout();
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) simStep();
  },
  /** Debug / tests: play the current campaign level's authored solution (fast-forwarded sim).
   *  Each entry is applied, then the sim runs until quiet. Returns whether the level was won. */
  autoplay(plan?: string[]): boolean {
    const def = currentLevel;
    if (!def) return false;
    const entries = plan ?? (def as LevelDef & { solution?: string[] }).solution ?? [];
    const settle = (max = 60 * 60) => {
      let quiet = 0;
      for (let i = 0; i < max && quiet < 45 && !state.won; i++) {
        const n = state.events.length;
        simStep();
        quiet = state.events.length > n || state.boxes.some((b) => b.state === 'active' && (b.falling || b.sliding)) ? 0 : quiet + 1;
      }
    };
    settle();
    for (const e of entries) {
      if (state.won) break;
      const hero = parseHeroEntry(e);
      if (state.hero && hero) {
        for (const h of hero) {
          if (h.kick) heroKick(h.dir);
          else heroStep(h.dir);
          for (let i = 0; i < 6; i++) simStep();
          settle(600);
        }
        continue;
      }
      const st = parseStep(e);
      const box = st && state.boxes[st.box];
      if (!st || !box) return false;
      const path = boxPath(state, box, st.x, st.y);
      if (!path) return false;
      for (const [x, y] of path) moveBoxToward(state, box.id, x, y);
      state.moves++;
      if (!st.noWait) settle();
      else for (let i = 0; i < 30; i++) simStep();
    }
    settle();
    return state.won;
  },
};
