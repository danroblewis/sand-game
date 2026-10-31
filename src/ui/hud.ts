// DOM HUD: level title, hint, moves, controls, level picker (campaign + random) and win overlay.
import type { Dir, LevelDef } from '../core/types';
import { loadProgress, recordRandomSolve, saveProgress, type Progress, type RandomMode } from './progress';
import { chapterRanges } from './chapters';
import { chapterStates, freePlayUnlocked, FREE_PLAY_AFTER, completedCount, isCompleted as recCompleted, levelLock, totalStars } from '../progress/model';
import { parFor } from '../levels/par';
import type { CeremonyView, FanfareView, MapLevelView, MapModel, SkinProgression } from '../render/themes/progression/types';
import { slateProgression } from '../render/themes/progression/slate';
import { hapticsBackend } from '../audio/haptics';

export interface HudHandlers {
  onRestart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectLevel: (index: number) => void;
  /** Same difficulty, fresh seed (random mode). */
  onNewRandom: () => void;
  onPlayRandom: (difficulty: number) => void;
  onPlayDaily: (difficulty: number) => void;
  /** `gravity` is set when the typed code names it (gen-7g-…); otherwise the picker mode decides. */
  onPlaySeed: (difficulty: number, seed: number, gravity?: boolean, hero?: boolean, big?: boolean) => void;
  /** Hero levels: undo the last move. */
  onUndo?: () => void;
  /** Hero levels: one d-pad step. */
  onHeroMove?: (dir: Dir) => void;
  /** Sound on/off toggled. */
  onSound?: (on: boolean) => void;
  /** Speaker button held for 1 s: audio diagnostics. */
  onSoundDiag?: () => void;
  /** Vibration on/off toggled. */
  onHaptics?: (on: boolean) => void;
  /** Haptics button held for 1 s and released: play the test pattern. */
  onHapticsTest?: () => void;
  /** Big maps: toggle the overview. */
  onOverview?: () => void;
  /** The gear menu opened / closed (pause input). */
  onMenu?: (open: boolean) => void;
  /** Theme picked in the menu ('auto' or a skin id). */
  onTheme?: (id: string) => void;
}

/** Overrides the lock rules (debug / tests: ?unlock=all). */
export const lockBypass = { all: false };

export type WinKind = 'next' | 'last' | 'random';

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  restart:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v14"/><path d="M6 12l6 6 6-6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  hero: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/><circle cx="17" cy="12" r="1" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  hapticsOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4.5 9v6M19.5 9v6M2 10.5v3M22 10.5v3"/></svg>',
  hapticsOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 4l16 16"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.4"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
};

const LOCK_ICON = ICONS.lock;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function button(cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, `${icon}<span>${label}</span>`);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    onClick();
    (e.currentTarget as HTMLButtonElement).blur();
  });
  return b;
}

function setLabel(b: HTMLButtonElement, label: string, icon?: string): void {
  if (icon) b.innerHTML = `${icon}<span></span>`;
  const s = b.querySelector('span');
  if (s) s.textContent = label;
  b.setAttribute('aria-label', label);
}

/** YYYYMMDD -> "YYYY-MM-DD". */
export function dailyLabel(seed: number): string {
  const s = String(seed).padStart(8, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Parse what a player types/pastes into the seed field: "48213", "#48213", "gen-7-48213". */
export function parseSeedInput(text: string): { seed: number; difficulty?: number; gravity?: boolean; hero?: boolean; big?: boolean } | null {
  const t = text.trim();
  const g = /^#?gen-(\d{1,2})(x?)(g?)(h?)-(\d{1,10})$/i.exec(t);
  if (g) {
    const d = Number(g[1]);
    const seed = Number(g[5]);
    const big = g[2] !== '';
    // an Expedition (x) is always a hero level
    if (d >= 1 && d <= 10 && seed <= 0x7fffffff) return { seed, difficulty: d, gravity: g[3] !== '', hero: g[4] !== '' || big, big };
    return null;
  }
  const m = /^#?\s*(\d{1,10})$/.exec(t);
  if (!m) return null;
  const seed = Number(m[1]);
  return seed <= 0x7fffffff ? { seed } : null;
}

export class Hud {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly boardWrap: HTMLElement;
  readonly stage: HTMLElement;
  progress: Progress;

  private top: HTMLElement;
  private levelNum: HTMLElement;
  private levelName: HTMLElement;
  private hint: HTMLElement;
  private movesEl: HTMLElement;
  private soundBtn!: HTMLButtonElement;
  private hapticsBtn!: HTMLButtonElement;
  private prevBtn: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private overviewBtn!: HTMLButtonElement;
  private topUndo!: HTMLButtonElement;
  private modeIcons!: HTMLElement;
  private menu!: HTMLElement;
  private menuTitle!: HTMLElement;
  private themeRow!: HTMLElement;
  private nextBtn: HTMLButtonElement;
  private picker: HTMLElement;
  private pickerGrid: HTMLElement;
  private diffSeg: HTMLElement;
  private modeSeg!: HTMLElement;
  private heroToggle!: HTMLButtonElement;
  private bigToggle!: HTMLButtonElement;
  private newBtn!: HTMLButtonElement;
  private mapOverlay!: HTMLElement;
  private mapHost!: HTMLElement;
  private mapStatus!: HTMLElement;
  private mapFree!: HTMLElement;
  private pickerStatus!: HTMLElement;
  private ceremonyOverlay!: HTMLElement;
  private ceremonyHost!: HTMLElement;
  private fanfareHost!: HTMLElement;
  private fanfareCleanup: (() => void) | null = null;
  private ceremonyCleanup: (() => void) | null = null;
  private statusTimer = 0;
  /** Themed progression screens of the active skin. */
  skinProgression: SkinProgression = slateProgression;
  /** Active skin id (styles the map / fanfare / ceremony overlays). */
  skinId = 'slate';
  private randomSection!: HTMLElement;
  private diffValue: HTMLElement;
  private diffSolved: HTMLElement;
  private dailyBtn: HTMLButtonElement;
  private seedInput: HTMLInputElement;
  private seedError: HTMLElement;
  private win: HTMLElement;
  private winMoves: HTMLElement;
  private winPrimary: HTMLButtonElement;
  private winSecondary: HTMLButtonElement;
  private building: HTMLElement;
  private buildingText: HTMLElement;
  private levels: LevelDef[] = [];
  private index = -1;
  private lastMoves = -1;
  private dailySeed = 0;
  private winKind: WinKind = 'next';
  /** Difficulty selected in the picker. */
  difficulty: number;
  /** Random-level gravity mode selected in the picker. */
  randomMode: RandomMode;
  /** Random levels in hero (Pusher) mode. */
  randomHero: boolean;
  /** Random levels as big maps (Expedition; implies Pusher). */
  randomBig: boolean;

  constructor(root: HTMLElement, private handlers: HudHandlers) {
    this.root = root;
    this.progress = loadProgress();
    this.difficulty = this.progress.difficulty ?? 5;
    this.randomMode = this.progress.randomMode;
    this.randomHero = this.progress.randomHero;
    this.randomBig = this.progress.randomBig;
    root.innerHTML = '';
    root.classList.add('app');

    // ----- top bar -----
    const top = (this.top = el('header', 'hud-top'));
    const info = el('div', 'level-info');
    this.levelNum = el('div', 'level-num');
    this.levelName = el('div', 'level-name');
    info.append(this.levelNum, this.levelName);
    const moves = el('div', 'moves');
    moves.append(el('span', 'moves-label', 'Moves'));
    this.movesEl = el('span', 'moves-value', '0');
    moves.append(this.movesEl);
    this.soundBtn = el('button', 'btn menu-toggle btn-mute');
    this.soundBtn.type = 'button';
    // Hold 1 s for audio diagnostics (that press does not toggle).
    let holdTimer = 0;
    let held = false;
    this.soundBtn.addEventListener('pointerdown', () => {
      held = false;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        held = true;
        handlers.onSoundDiag?.();
      }, 1000);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      this.soundBtn.addEventListener(ev, () => window.clearTimeout(holdTimer));
    }
    this.soundBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.soundBtn.addEventListener('click', () => {
      if (held) {
        held = false;
        return;
      }
      this.progress.sound = !this.progress.sound;
      saveProgress(this.progress);
      this.renderSound();
      handlers.onSound?.(this.progress.sound);
    });
    this.hapticsBtn = el('button', 'btn menu-toggle btn-haptics');
    this.hapticsBtn.type = 'button';
    // Hold 1 s and release: test pattern (fired on release, i.e. inside the gesture, for iOS).
    let hDown = 0;
    let hTested = false;
    this.hapticsBtn.addEventListener('pointerdown', () => {
      hDown = performance.now();
      hTested = false;
    });
    this.hapticsBtn.addEventListener('pointerup', () => {
      if (hDown && performance.now() - hDown >= 1000) {
        hTested = true;
        handlers.onHapticsTest?.();
      }
      hDown = 0;
    });
    this.hapticsBtn.addEventListener('pointercancel', () => (hDown = 0));
    this.hapticsBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.hapticsBtn.addEventListener('click', () => {
      if (hTested) {
        hTested = false;
        return;
      }
      this.progress.haptics = !this.progress.haptics;
      saveProgress(this.progress);
      this.renderSound();
      handlers.onHaptics?.(this.progress.haptics);
    });
    // Only where some haptics backend exists (Vibration API, or the iOS 17.4+ switch tick).
    const canVibrate = hapticsBackend() !== 'none';
    // Top bar: title (+ tiny mode icons) on the left; moves, overview (big maps) and the gear menu.
    this.modeIcons = el('span', 'mode-icons');
    info.append(this.modeIcons);
    this.overviewBtn = el('button', 'btn-top btn-overview', ICONS.map);
    this.overviewBtn.type = 'button';
    this.overviewBtn.setAttribute('aria-label', 'Map overview (O)');
    this.overviewBtn.title = 'Map overview (O)';
    this.overviewBtn.addEventListener('click', () => handlers.onOverview?.());
    const gear = el('button', 'btn-top btn-menu', ICONS.gear);
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Menu');
    gear.title = 'Menu (Esc)';
    gear.addEventListener('click', () => this.openMenu());
    // Undo in the top bar (hero levels): the same as Z / the menu entry.
    this.topUndo = el('button', 'btn-top btn-undo-top', ICONS.undo);
    this.topUndo.type = 'button';
    this.topUndo.setAttribute('aria-label', 'Undo (Z)');
    this.topUndo.title = 'Undo (Z)';
    this.topUndo.disabled = true;
    this.topUndo.addEventListener('click', () => {
      handlers.onUndo?.();
      this.topUndo.blur();
    });
    const right = el('div', 'hud-top-right');
    right.append(moves, this.overviewBtn, this.topUndo, gear);
    top.append(info, right);

    // ----- board: everything below the top bar -----
    this.hint = el('p', 'hint menu-hint');
    this.boardWrap = el('main', 'board-wrap');
    this.canvas = el('canvas', 'board');
    this.canvas.setAttribute('aria-label', 'Game board');
    this.boardWrap.append(this.canvas);
    this.stage = el('div', 'stage');
    this.stage.append(this.boardWrap);

    // ----- gear menu (pauses input while open) -----
    const closeThen = (fn: () => void) => () => {
      this.closeMenu();
      fn();
    };
    this.prevBtn = button('btn-prev', ICONS.prev, 'Previous', closeThen(() => handlers.onPrev()));
    const restart = button('btn-restart', ICONS.restart, 'Restart', closeThen(() => handlers.onRestart()));
    const levelsBtn = button('btn-levels', ICONS.grid, 'Levels', closeThen(() => this.openMap()));
    this.nextBtn = button('btn-next', ICONS.next, 'Next', closeThen(() => handlers.onNext()));
    const newBtn = (this.newBtn = button('btn-new', ICONS.dice, 'New level', closeThen(() => handlers.onNewRandom())));
    this.undoBtn = button('btn-undo', ICONS.undo, 'Undo', closeThen(() => handlers.onUndo?.()));
    this.undoBtn.disabled = true;
    const resume = button('btn-primary btn-resume', ICONS.next, 'Resume', () => this.closeMenu());
    this.menu = el('div', 'overlay menu hidden');
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-label', 'Menu');
    const card = el('div', 'card menu-card');
    const head = el('div', 'menu-head');
    this.menuTitle = el('h2', 'menu-title', 'Paused');
    const x = el('button', 'btn btn-close', '&times;');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => this.closeMenu());
    head.append(this.menuTitle, x);
    const actions = el('div', 'menu-actions');
    actions.append(this.undoBtn, restart, levelsBtn);
    const toggles = el('div', 'menu-toggles');
    toggles.append(this.soundBtn);
    if (canVibrate) toggles.append(this.hapticsBtn);
    // Level navigation sits low in the menu, away from Resume, so it is hard to hit by accident.
    const nav = el('div', 'menu-nav');
    nav.append(this.prevBtn, this.nextBtn, newBtn);
    // Theme: Auto (level / chapter default) or a fixed skin; filled by setThemes().
    this.themeRow = el('div', 'menu-theme');
    this.themeRow.setAttribute('role', 'radiogroup');
    this.themeRow.setAttribute('aria-label', 'Theme');
    card.append(head, resume, actions, toggles, this.themeRow, nav, this.hint);
    this.renderSound();
    this.menu.append(card);
    this.menu.addEventListener('click', (e) => {
      if (e.target === this.menu) this.closeMenu();
    });

    // ----- level picker -----
    this.picker = el('div', 'overlay picker hidden');
    const pcard = el('div', 'card picker-card');
    const phead = el('div', 'picker-head');
    phead.append(el('h2', '', 'All levels'));
    const toMap = button('btn-ghost btn-to-map', ICONS.map, 'Map', () => this.openMap());
    phead.append(toMap);
    const close = el('button', 'btn btn-close', '&times;');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closePicker());
    phead.append(close);
    this.pickerGrid = el('div', 'chapters');

    const rsec = el('section', 'random-section');
    const rhead = el('div', 'section-head');
    rhead.append(el('h3', '', 'Free Play'));
    const dl = el('div', 'diff-label');
    dl.append('Difficulty ');
    this.diffValue = el('b', 'diff-value');
    this.diffSolved = el('span', 'diff-solved');
    dl.append(this.diffValue, this.diffSolved);
    rhead.append(dl);
    this.diffSeg = el('div', 'diff-seg');
    this.diffSeg.setAttribute('role', 'radiogroup');
    this.diffSeg.setAttribute('aria-label', 'Difficulty');
    for (let d = 1; d <= 10; d++) {
      const b = el('button', 'diff-btn', String(d));
      b.type = 'button';
      b.dataset.d = String(d);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => this.setDifficulty(d));
      this.diffSeg.append(b);
    }
    // Floating / Gravity / Mixed.
    this.modeSeg = el('div', 'mode-seg');
    this.modeSeg.setAttribute('role', 'radiogroup');
    this.modeSeg.setAttribute('aria-label', 'Box gravity');
    for (const [m, label, icon] of [
      ['floating', 'Floating', ''],
      ['gravity', 'Gravity', ICONS.down],
      ['mixed', 'Mixed', ''],
    ] as [RandomMode, string, string][]) {
      const b = el('button', 'mode-btn', `${icon}<span>${label}</span>`);
      b.type = 'button';
      b.dataset.mode = m;
      b.setAttribute('role', 'radio');
      b.title = m === 'mixed' ? 'Gravity on some levels (decided by the seed)' : m === 'gravity' ? 'Boxes fall' : 'Boxes stay where you put them';
      b.addEventListener('click', () => this.setRandomMode(m));
      this.modeSeg.append(b);
    }
    // Pusher (hero mode) on/off, beside the gravity control.
    this.heroToggle = el('button', 'hero-toggle', `${ICONS.hero}<span>Pusher</span><i class="switch" aria-hidden="true"></i>`);
    this.heroToggle.type = 'button';
    this.heroToggle.title = 'Random levels with a character who pushes the boxes';
    this.heroToggle.addEventListener('click', () => this.setRandomHero(!this.randomHero));
    // Expedition: big maps with the hero (implies Pusher).
    this.bigToggle = el('button', 'hero-toggle big-toggle', `${ICONS.map}<span>Expedition</span><i class="switch" aria-hidden="true"></i>`);
    this.bigToggle.type = 'button';
    this.bigToggle.title = 'Big maps to explore (with the Pusher)';
    this.bigToggle.addEventListener('click', () => this.setRandomBig(!this.randomBig));
    const modeRow = el('div', 'mode-row');
    modeRow.append(this.modeSeg, this.heroToggle, this.bigToggle);
    const ractions = el('div', 'random-actions');
    const playRandom = button('btn-primary btn-play-random', ICONS.dice, 'Play random', () => {
      this.closePicker();
      this.closeMap();
      handlers.onPlayRandom(this.difficulty);
    });
    this.dailyBtn = button('btn-daily', ICONS.sun, 'Daily', () => {
      this.closePicker();
      this.closeMap();
      handlers.onPlayDaily(this.difficulty);
    });
    ractions.append(playRandom, this.dailyBtn);
    const seedForm = el('form', 'seed-row');
    this.seedInput = el('input', 'seed-input');
    this.seedInput.type = 'text';
    this.seedInput.inputMode = 'numeric';
    this.seedInput.autocomplete = 'off';
    this.seedInput.enterKeyHint = 'go';
    this.seedInput.placeholder = 'Seed, e.g. 48213';
    this.seedInput.setAttribute('aria-label', 'Seed');
    const seedBtn = el('button', 'btn btn-seed', 'Play seed');
    seedBtn.type = 'submit';
    seedForm.append(this.seedInput, seedBtn);
    this.seedError = el('div', 'seed-error');
    seedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const parsed = parseSeedInput(this.seedInput.value);
      if (!parsed) {
        this.seedError.textContent = 'Enter a number (or a code like gen-7-48213).';
        return;
      }
      this.seedError.textContent = '';
      if (parsed.difficulty) this.setDifficulty(parsed.difficulty);
      this.seedInput.blur();
      this.closePicker();
      this.closeMap();
      handlers.onPlaySeed(this.difficulty, parsed.seed, parsed.gravity, parsed.hero, parsed.big);
    });
    const bigNote = el('p', 'big-note', 'Expeditions are big: building one can take a couple of seconds at high difficulty.');
    rsec.append(rhead, modeRow, this.diffSeg, ractions, seedForm, this.seedError, bigNote);
    this.randomSection = rsec;

    const csec = el('section', 'campaign-section');
    const chead = el('div', 'section-head');
    chead.append(el('h3', '', 'Campaign'));
    this.pickerStatus = el('div', 'map-status');
    this.pickerStatus.setAttribute('role', 'status');
    csec.append(chead, this.pickerStatus, this.pickerGrid);

    pcard.append(phead, csec, rsec);
    this.picker.append(pcard);
    this.picker.addEventListener('click', (e) => {
      if (e.target === this.picker) this.closePicker();
    });

    // ----- win overlay: the skin's fanfare -----
    this.win = el('div', 'overlay win hidden');
    this.fanfareHost = el('div', 'card win-card');
    this.win.append(this.fanfareHost);
    this.winMoves = el('p', 'win-moves');
    this.winPrimary = el('button');
    this.winSecondary = el('button');
    this.win.addEventListener('click', (e) => {
      if (e.target === this.win) this.hideWin();
    });

    // ----- level map (the skin's map + Free Play) -----
    this.mapOverlay = el('div', 'overlay levelmap hidden');
    this.mapOverlay.setAttribute('role', 'dialog');
    this.mapOverlay.setAttribute('aria-label', 'Level map');
    const mcard = el('div', 'card map-card');
    const mhead = el('div', 'picker-head map-head');
    mhead.append(el('h2', '', 'Levels'));
    const allBtn = button('btn-ghost btn-all-levels', ICONS.grid, 'All levels', () => this.openPicker());
    const mclose = el('button', 'btn btn-close', '&times;');
    mclose.type = 'button';
    mclose.setAttribute('aria-label', 'Close');
    mclose.addEventListener('click', () => this.closeMap());
    mhead.append(allBtn, mclose);
    this.mapStatus = el('div', 'map-status');
    this.mapStatus.setAttribute('role', 'status');
    this.mapHost = el('div', 'map-host');
    this.mapFree = el('section', 'freeplay');
    mcard.append(mhead, this.mapStatus, this.mapHost, this.mapFree);
    this.mapOverlay.append(mcard);
    this.mapOverlay.addEventListener('click', (e) => {
      if (e.target === this.mapOverlay) this.closeMap();
    });

    // ----- unlock ceremony -----
    this.ceremonyOverlay = el('div', 'overlay ceremony hidden');
    this.ceremonyOverlay.setAttribute('role', 'dialog');
    this.ceremonyOverlay.setAttribute('aria-label', 'Unlocked');
    this.ceremonyHost = el('div', 'card ceremony-card');
    this.ceremonyOverlay.append(this.ceremonyHost);

    // ----- "building level" overlay -----
    this.building = el('div', 'overlay building hidden');
    const bcard = el('div', 'card building-card');
    bcard.append(el('div', 'spinner'));
    this.buildingText = el('div', 'building-text', 'Building level…');
    bcard.append(this.buildingText);
    this.building.append(bcard);

    root.append(top, this.stage, this.menu, this.mapOverlay, this.picker, this.win, this.ceremonyOverlay, this.building);

    window.addEventListener(
      'keydown',
      (e) => {
        if (this.menuOpen && e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeMenu();
          return;
        }
        if (this.ceremonyShown) {
          if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopImmediatePropagation();
            (this.ceremonyHost.querySelector('.cer-continue') as HTMLButtonElement | null)?.click();
          }
          return;
        }
        if (!this.pickerOpen) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!this.picker.classList.contains('hidden')) this.closePicker();
          else this.closeMap();
        }
      },
      true,
    );
    this.renderDifficulty();
  }

  // ----- gear menu -----
  get menuOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  openMenu(): void {
    if (this.menuOpen) return;
    this.closePicker();
    this.menu.classList.remove('hidden');
    this.handlers.onMenu?.(true);
    (this.menu.querySelector('.btn-resume') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menu.classList.add('hidden');
    this.handlers.onMenu?.(false);
  }

  /** Fill the menu's theme picker (Auto + each skin). */
  setThemes(skins: { id: string; name: string }[]): void {
    this.themeRow.innerHTML = '';
    this.themeRow.append(el('span', 'menu-theme-label', 'Theme'));
    for (const t of [{ id: 'auto', name: 'Auto' }, ...skins]) {
      const b = el('button', 'theme-btn', t.name);
      b.type = 'button';
      b.dataset.theme = t.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => this.setTheme(t.id));
      this.themeRow.append(b);
    }
    this.renderTheme();
  }

  /** Pick a theme ('auto' or a skin id): stored, and reported to the app. */
  setTheme(id: string): void {
    this.progress.theme = id;
    saveProgress(this.progress);
    this.renderTheme();
    this.handlers.onTheme?.(id);
  }

  private renderTheme(): void {
    for (const b of Array.from(this.themeRow.querySelectorAll('.theme-btn')) as HTMLElement[]) {
      const on = b.dataset.theme === (this.progress.theme || 'auto');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  /** Big maps: show the overview button in the top bar. */
  setBigMap(on: boolean): void {
    this.root.classList.toggle('bigmap', on);
  }

  /** True while the level map, the flat grid or a ceremony covers the board. */
  get pickerOpen(): boolean {
    return !this.picker.classList.contains('hidden') || !this.mapOverlay.classList.contains('hidden') || this.ceremonyShown;
  }

  get mapOpen(): boolean {
    return !this.mapOverlay.classList.contains('hidden');
  }

  get ceremonyShown(): boolean {
    return !this.ceremonyOverlay.classList.contains('hidden');
  }

  /** True while a level is being generated. */
  get busy(): boolean {
    return !this.building.classList.contains('hidden');
  }

  setLevels(levels: LevelDef[]): void {
    this.levels = levels;
    this.renderFreePlay();
  }

  setDailySeed(seed: number): void {
    this.dailySeed = seed;
    setLabel(this.dailyBtn, `Daily ${dailyLabel(seed)}`);
  }

  setDifficulty(d: number): void {
    this.difficulty = Math.max(1, Math.min(10, Math.round(d)));
    this.progress.difficulty = this.difficulty;
    saveProgress(this.progress);
    this.renderDifficulty();
  }

  setRandomHero(on: boolean): void {
    this.randomHero = on;
    this.progress.randomHero = on;
    saveProgress(this.progress);
    this.renderDifficulty();
  }

  setRandomBig(on: boolean): void {
    this.randomBig = on;
    this.progress.randomBig = on;
    saveProgress(this.progress);
    this.renderDifficulty();
  }

  setRandomMode(m: RandomMode): void {
    this.randomMode = m;
    this.progress.randomMode = m;
    saveProgress(this.progress);
    this.renderDifficulty();
  }

  private renderDifficulty(): void {
    // Expedition implies Pusher: the Pusher switch shows on and is fixed while Expedition is on.
    this.heroToggle.classList.toggle('on', this.randomHero || this.randomBig);
    this.heroToggle.setAttribute('aria-pressed', String(this.randomHero || this.randomBig));
    this.heroToggle.disabled = this.randomBig;
    this.bigToggle.classList.toggle('on', this.randomBig);
    this.bigToggle.setAttribute('aria-pressed', String(this.randomBig));
    this.randomSection.classList.toggle('big', this.randomBig);
    for (const b of Array.from(this.modeSeg.children) as HTMLElement[]) {
      const on = b.dataset.mode === this.randomMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    this.diffValue.textContent = String(this.difficulty);
    const n = this.progress.randomSolved[String(this.difficulty)] ?? 0;
    this.diffSolved.textContent = ` · ${n} solved`;
    for (const b of Array.from(this.diffSeg.children) as HTMLElement[]) {
      const d = Number(b.dataset.d);
      const on = d === this.difficulty;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('has-solved', (this.progress.randomSolved[String(d)] ?? 0) > 0);
    }
  }

  /** Debug/preview: show a level's hint, badges and hero controls without touching progress. */
  showLevelChrome(level: LevelDef): void {
    this.common(level);
  }

  private common(level: LevelDef): void {
    // The hint lives at the bottom of the menu; mode badges are tiny icons next to the title.
    this.hint.textContent = level.hint ?? '';
    this.hint.classList.toggle('empty', !level.hint);
    this.modeIcons.innerHTML = '';
    if (level.hero) {
      const i = el('span', 'mode-icon mode-hero', ICONS.hero);
      i.title = 'Pusher: walk the character and push the boxes';
      this.modeIcons.append(i);
    }
    if (level.boxGravity) {
      const i = el('span', 'mode-icon mode-gravity', ICONS.down);
      i.title = 'Gravity: boxes fall';
      this.modeIcons.append(i);
    }
    this.root.classList.toggle('hero', !!level.hero);
    this.root.classList.toggle('gravity', !!level.boxGravity);
    this.setUndoCount(0);
    this.lastMoves = -1;
    this.setMoves(0);
    this.hideWin();
    this.renderFreePlay();
  }

  /** Show a campaign level. */
  setLevel(index: number, level: LevelDef): void {
    this.index = index;
    this.root.classList.remove('random');
    this.levelNum.innerHTML = `<span class="lvl-word">Level </span>${index + 1}`;
    this.levelName.textContent = level.name;
    this.levelName.classList.toggle('done', this.isCompleted(level.id));
    this.prevBtn.disabled = index <= 0;
    this.nextBtn.disabled = index >= this.levels.length - 1 || !this.levelUnlocked(index + 1);
    this.common(level);
    this.progress.last = level.id;
    saveProgress(this.progress);
  }

  /** Show a generated level: "Random 7 · #48213", "Random 7g · #48213" (gravity) or "Daily 2026-10-30 · 5". */
  setRandomLevel(level: LevelDef, difficulty: number, seed: number): void {
    const camera = (level as { camera?: string }).camera;
    const big = !!camera && camera !== 'fit';
    const dl = `${difficulty}${big ? 'x' : ''}${level.boxGravity ? 'g' : ''}${level.hero ? 'h' : ''}`;
    this.index = -1;
    this.root.classList.add('random');
    const daily = seed === this.dailySeed;
    this.levelNum.innerHTML = `<span class="lvl-word">${daily ? 'Daily' : 'Endless'}</span><span class="lvl-short">${daily ? '☀' : '∞'}</span>`;
    this.levelName.textContent = daily
      ? `Daily ${dailyLabel(seed)} · ${dl}`
      : `Random ${dl} · #${seed}`;
    this.levelName.title = level.id;
    this.levelName.classList.toggle('done', this.progress.randomRecent.includes(level.id));
    this.seedInput.value = String(seed);
    this.common(level);
  }

  private renderSound(): void {
    const on = this.progress.sound;
    this.soundBtn.innerHTML = `${on ? ICONS.soundOn : ICONS.soundOff}<span>Sound</span><b>${on ? 'On' : 'Off'}</b>`;
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.setAttribute('aria-label', on ? 'Sound on (tap to mute)' : 'Sound off (tap to unmute)');
    this.soundBtn.title = on ? 'Mute' : 'Unmute';
    this.soundBtn.classList.toggle('off', !on);
    const h = this.progress.haptics;
    this.hapticsBtn.innerHTML = `${h ? ICONS.hapticsOn : ICONS.hapticsOff}<span>Vibration</span><b>${h ? 'On' : 'Off'}</b>`;
    this.hapticsBtn.setAttribute('aria-pressed', String(h));
    this.hapticsBtn.setAttribute('aria-label', h ? 'Vibration on (tap to turn off)' : 'Vibration off (tap to turn on)');
    this.hapticsBtn.title = h ? 'Vibration off' : 'Vibration on';
    this.hapticsBtn.classList.toggle('off', !h);
  }

  /** Enable the Undo button when there is something to undo. */
  setUndoCount(n: number): void {
    this.undoBtn.disabled = n <= 0;
    this.topUndo.disabled = n <= 0;
  }

  setMoves(n: number): void {
    if (n === this.lastMoves) return;
    this.lastMoves = n;
    this.movesEl.textContent = String(n);
  }

  isCompleted(id: string): boolean {
    return recCompleted(this.progress, id);
  }

  /** Whether campaign level `index` is playable (lock rules, unless bypassed). */
  levelUnlocked(index: number): boolean {
    return lockBypass.all || levelLock(this.progress, this.levels, index).unlocked;
  }

  /** Why a level is locked (or '' if it is not). */
  lockRequirement(index: number): string {
    if (lockBypass.all) return '';
    const l = levelLock(this.progress, this.levels, index);
    return l.unlocked ? '' : (l.requirement ?? 'Locked');
  }

  get freePlayOpen(): boolean {
    return lockBypass.all || freePlayUnlocked(this.progress, this.levels);
  }

  /** After a campaign win: refresh the title check and lock-dependent controls. */
  markCompleted(_id: string): void {
    this.levelName.classList.add('done');
    if (this.index >= 0) this.nextBtn.disabled = this.index >= this.levels.length - 1 || !this.levelUnlocked(this.index + 1);
    this.renderFreePlay();
  }

  /** Free Play gate: the menu's New level button and the Free Play section. */
  renderFreePlay(): void {
    this.newBtn.disabled = !this.freePlayOpen && !this.root.classList.contains('random');
    this.root.classList.toggle('freeplay-locked', !this.freePlayOpen);
  }

  /** Show a short status line in the open map / grid (lock requirements). */
  showStatus(text: string): void {
    for (const s of [this.mapStatus, this.pickerStatus]) {
      s.textContent = text;
      s.classList.add('show');
    }
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.mapStatus.classList.remove('show');
      this.pickerStatus.classList.remove('show');
    }, 3500);
  }

  markRandomSolved(id: string, difficulty: number): void {
    recordRandomSolve(this.progress, id, difficulty);
    this.levelName.classList.add('done');
    this.renderDifficulty();
  }

  /** Simple win screen (kept for callers without a fanfare view). */
  showWin(moves: number, kind: WinKind): void {
    this.winKind = kind;
    this.winMoves.textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
  }

  /** The themed win fanfare. */
  showFanfare(v: FanfareView): void {
    this.fanfareCleanup?.();
    this.fanfareHost.dataset.skin = this.skinId;
    this.win.dataset.skin = this.skinId;
    this.win.classList.remove('hidden');
    this.fanfareCleanup = this.skinProgression.winFanfare(this.fanfareHost, v);
  }

  hideWin(): void {
    this.fanfareCleanup?.();
    this.fanfareCleanup = null;
    this.win.classList.add('hidden');
  }

  /** The themed unlock ceremony. */
  showCeremony(v: CeremonyView): void {
    this.ceremonyCleanup?.();
    this.ceremonyOverlay.dataset.skin = this.skinId;
    this.ceremonyOverlay.dataset.kind = v.unlock.kind;
    this.ceremonyOverlay.classList.remove('hidden');
    this.ceremonyCleanup = this.skinProgression.ceremony(this.ceremonyHost, v);
  }

  hideCeremony(): void {
    this.ceremonyCleanup?.();
    this.ceremonyCleanup = null;
    this.ceremonyOverlay.classList.add('hidden');
  }

  get winShown(): boolean {
    return !this.win.classList.contains('hidden');
  }

  showBuilding(text = 'Building level…'): void {
    this.buildingText.textContent = text;
    this.building.classList.remove('hidden');
  }

  hideBuilding(): void {
    this.building.classList.add('hidden');
  }

  /** The flat grid of every level ("All levels"), with stars and locks. */
  openPicker(): void {
    this.closeMap(false);
    this.pickerGrid.innerHTML = '';
    const states = chapterStates(this.progress, this.levels);
    for (const ch of chapterRanges(this.levels.length)) {
      const st = states.find((c) => c.number === ch.number);
      const sec = el('div', `chapter${st && !st.unlocked && !lockBypass.all ? ' locked' : ''}`);
      const head = el('div', 'chapter-head');
      let done = 0;
      for (let i = ch.start; i < ch.end; i++) if (this.isCompleted(this.levels[i].id)) done++;
      head.append(
        el('h4', 'chapter-title', `<span class="chapter-num">Chapter ${ch.number}</span> ${ch.chapter.title}`),
        el('span', 'chapter-progress', `★ ${st?.stars ?? 0}/${(ch.end - ch.start) * 3} · ${done}/${ch.end - ch.start}`),
      );
      const grid = el('div', 'picker-grid');
      for (let i = ch.start; i < ch.end; i++) {
        const lv = this.levels[i];
        const isDone = this.isCompleted(lv.id);
        const req = this.lockRequirement(i);
        const stars = this.progress.records[lv.id]?.stars ?? 0;
        const b = el('button', `level-tile${isDone ? ' done' : ''}${req ? ' locked' : ''}${i === this.index ? ' current' : ''}`);
        b.type = 'button';
        b.title = req ? `${lv.name}: ${req}` : lv.name;
        b.setAttribute('aria-label', `Level ${i + 1}: ${lv.name}${isDone ? ` (solved, ${stars} stars)` : ''}${req ? ` (locked: ${req})` : ''}`);
        const starsHtml = isDone ? `<span class="tile-stars">${[1, 2, 3].map((k) => `<i class="${k <= stars ? 'on' : ''}"></i>`).join('')}</span>` : '';
        b.innerHTML = req ? `<span class="lock">${LOCK_ICON}</span>` : `<span class="num">${i + 1}</span>${starsHtml}`;
        b.addEventListener('click', () => {
          if (req) {
            this.showStatus(`Level ${i + 1} is locked: ${req}`);
            return;
          }
          this.closePicker();
          this.handlers.onSelectLevel(i);
        });
        grid.append(b);
      }
      sec.append(head, grid);
      this.pickerGrid.append(sec);
    }
    this.seedError.textContent = '';
    this.pickerStatus.classList.remove('show');
    this.picker.dataset.skin = this.skinId;
    this.placeFreePlay(this.picker.querySelector('.picker-card') as HTMLElement);
    this.renderDifficulty();
    this.picker.classList.remove('hidden');
    const card = this.randomSection.parentElement;
    if (card) card.scrollTop = this.index < 0 && this.freePlayOpen ? card.scrollHeight : 0;
  }

  /** Put the Free Play controls (or, while locked, what opens them) at the end of `parent`. */
  private placeFreePlay(parent: HTMLElement): void {
    parent.querySelector('.freeplay-lock')?.remove();
    if (this.freePlayOpen) {
      parent.append(this.randomSection);
      return;
    }
    this.randomSection.remove();
    const n = completedCount(this.progress, this.levels);
    const lock = el('section', 'freeplay-lock');
    lock.innerHTML = `<span class="lock">${LOCK_ICON}</span><div><h3>Free Play</h3><p>Random levels, daily puzzles and expeditions open after ${FREE_PLAY_AFTER} solved levels (${Math.min(n, FREE_PLAY_AFTER)}/${FREE_PLAY_AFTER}).</p></div>`;
    parent.append(lock);
  }

  /** The themed level map (pause menu "Levels", win "Map"). */
  openMap(): void {
    this.closePicker();
    this.closeMenu();
    const model = this.mapModel();
    this.mapOverlay.dataset.skin = this.skinId;
    this.mapHost.dataset.skin = this.skinId;
    this.skinProgression.renderMap(this.mapHost, model);
    this.mapStatus.classList.remove('show');
    this.mapFree.innerHTML = '';
    this.placeFreePlay(this.mapFree);
    this.seedError.textContent = '';
    this.renderDifficulty();
    this.mapOverlay.classList.remove('hidden');
    const card = this.mapHost.parentElement as HTMLElement;
    const cur = this.mapHost.querySelector('.current') as HTMLElement | null;
    if (this.index < 0 && this.freePlayOpen) card.scrollTop = card.scrollHeight;
    else if (cur) card.scrollTop = Math.max(0, cur.getBoundingClientRect().top - card.getBoundingClientRect().top + card.scrollTop - card.clientHeight / 2);
    else card.scrollTop = 0;
  }

  closeMap(_notify = true): void {
    this.mapOverlay.classList.add('hidden');
  }

  /** Map view model from progress (stars, locks, current level). */
  mapModel(): MapModel {
    const p = this.progress;
    const states = chapterStates(p, this.levels);
    const chapters = states.map((c) => {
      const levels: MapLevelView[] = [];
      for (let i = c.start; i < c.end; i++) {
        const lv = this.levels[i];
        const r = p.records[lv.id];
        const req = this.lockRequirement(i);
        levels.push({ index: i, id: lv.id, name: lv.name, unlocked: !req, completed: !!r?.completed, stars: r?.stars ?? 0, current: i === this.index, requirement: req || undefined, bestMoves: r?.bestMoves, parMoves: parFor(lv.id)?.moves });
      }
      const unlocked = lockBypass.all || c.unlocked;
      const requirement = unlocked ? undefined : levels[0]?.requirement;
      return { number: c.number, title: c.title, unlocked, requirement, stars: c.stars, maxStars: c.maxStars, completed: c.completed, levels };
    });
    return {
      chapters,
      totalStars: totalStars(p, this.levels),
      maxStars: this.levels.length * 3,
      select: (i) => {
        this.closeMap();
        this.handlers.onSelectLevel(i);
      },
      explain: (l) => this.showStatus(`Level ${l.index + 1} is locked: ${l.requirement ?? ''}`),
    };
  }

  closePicker(): void {
    this.picker.classList.add('hidden');
  }
}
