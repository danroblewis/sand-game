// DOM HUD: level title, hint, moves, controls, level picker (campaign + random) and win overlay.
import type { LevelDef } from '../core/types';
import { loadProgress, recordRandomSolve, saveProgress, type Progress } from './progress';

export interface HudHandlers {
  onRestart: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelectLevel: (index: number) => void;
  /** Same difficulty, fresh seed (random mode). */
  onNewRandom: () => void;
  onPlayRandom: (difficulty: number) => void;
  onPlayDaily: (difficulty: number) => void;
  onPlaySeed: (difficulty: number, seed: number) => void;
}

export type WinKind = 'next' | 'last' | 'random';

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  restart:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
};

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
export function parseSeedInput(text: string): { seed: number; difficulty?: number } | null {
  const t = text.trim();
  const g = /^#?gen-(\d{1,2})-(\d{1,10})$/i.exec(t);
  if (g) {
    const d = Number(g[1]);
    const seed = Number(g[2]);
    if (d >= 1 && d <= 10 && seed <= 0x7fffffff) return { seed, difficulty: d };
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
  private bottom: HTMLElement;
  private levelNum: HTMLElement;
  private levelName: HTMLElement;
  private hint: HTMLElement;
  private movesEl: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private picker: HTMLElement;
  private pickerGrid: HTMLElement;
  private diffSeg: HTMLElement;
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

  constructor(root: HTMLElement, private handlers: HudHandlers) {
    this.root = root;
    this.progress = loadProgress();
    this.difficulty = this.progress.difficulty ?? 5;
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
    top.append(info, moves);

    // ----- board + hint -----
    this.hint = el('div', 'hint');
    this.boardWrap = el('main', 'board-wrap');
    this.canvas = el('canvas', 'board');
    this.canvas.setAttribute('aria-label', 'Game board');
    this.boardWrap.append(this.canvas);
    // Board with the hint directly under it, kept together and centred in the free space.
    this.stage = el('div', 'stage');
    this.stage.append(this.boardWrap, this.hint);

    // ----- bottom buttons -----
    const bottom = (this.bottom = el('footer', 'hud-bottom'));
    this.prevBtn = button('btn-prev', ICONS.prev, 'Prev', () => handlers.onPrev());
    const restart = button('btn-restart', ICONS.restart, 'Restart', () => handlers.onRestart());
    const levelsBtn = button('btn-levels', ICONS.grid, 'Levels', () => this.openPicker());
    this.nextBtn = button('btn-next', ICONS.next, 'Next', () => handlers.onNext());
    const newBtn = button('btn-new', ICONS.dice, 'New level', () => handlers.onNewRandom());
    bottom.append(this.prevBtn, restart, levelsBtn, this.nextBtn, newBtn);

    // ----- level picker -----
    this.picker = el('div', 'overlay picker hidden');
    const pcard = el('div', 'card picker-card');
    const phead = el('div', 'picker-head');
    phead.append(el('h2', '', 'Levels'));
    const close = el('button', 'btn btn-close', '&times;');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closePicker());
    phead.append(close);
    this.pickerGrid = el('div', 'picker-grid');

    const rsec = el('section', 'random-section');
    const rhead = el('div', 'section-head');
    rhead.append(el('h3', '', 'Random'));
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
    const ractions = el('div', 'random-actions');
    const playRandom = button('btn-primary btn-play-random', ICONS.dice, 'Play random', () => {
      this.closePicker();
      handlers.onPlayRandom(this.difficulty);
    });
    this.dailyBtn = button('btn-daily', ICONS.sun, 'Daily', () => {
      this.closePicker();
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
      handlers.onPlaySeed(this.difficulty, parsed.seed);
    });
    rsec.append(rhead, this.diffSeg, ractions, seedForm, this.seedError);
    this.randomSection = rsec;

    const csec = el('section', 'campaign-section');
    const chead = el('div', 'section-head');
    chead.append(el('h3', '', 'Campaign'));
    csec.append(chead, this.pickerGrid);

    pcard.append(phead, csec, rsec);
    this.picker.append(pcard);
    this.picker.addEventListener('click', (e) => {
      if (e.target === this.picker) this.closePicker();
    });

    // ----- win overlay -----
    this.win = el('div', 'overlay win hidden');
    const wcard = el('div', 'card win-card');
    wcard.append(el('h2', 'win-title', 'Solved!'));
    this.winMoves = el('p', 'win-moves');
    const wbtns = el('div', 'win-buttons');
    this.winSecondary = button('btn-ghost', ICONS.restart, 'Replay', () => {
      if (this.winKind === 'random') {
        this.hideWin();
        this.openPicker();
      } else handlers.onRestart();
    });
    this.winPrimary = button('btn-primary', ICONS.next, 'Next level', () => {
      if (this.winKind === 'last') {
        this.hideWin();
        this.openPicker();
      } else if (this.winKind === 'random') handlers.onNewRandom();
      else handlers.onNext();
    });
    wbtns.append(this.winSecondary, this.winPrimary);
    wcard.append(this.winMoves, wbtns);
    this.win.append(wcard);
    this.win.addEventListener('click', (e) => {
      if (e.target === this.win) this.hideWin();
    });

    // ----- "building level" overlay -----
    this.building = el('div', 'overlay building hidden');
    const bcard = el('div', 'card building-card');
    bcard.append(el('div', 'spinner'));
    this.buildingText = el('div', 'building-text', 'Building level…');
    bcard.append(this.buildingText);
    this.building.append(bcard);

    root.append(top, this.stage, bottom, this.picker, this.win, this.building);

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.pickerOpen) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closePicker();
        }
      },
      true,
    );
    this.renderDifficulty();
  }

  /** CSS px height available to the board canvas in the stacked (portrait/desktop) layout. */
  freeBoardHeight(): number {
    const cs = getComputedStyle(this.root);
    const inner = this.root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0;
    let h = inner - this.top.offsetHeight - this.bottom.offsetHeight - gap * 2;
    if (!this.hint.classList.contains('empty')) {
      h -= this.hint.offsetHeight + (parseFloat(getComputedStyle(this.stage).rowGap) || 0);
    }
    return Math.max(80, h);
  }

  get pickerOpen(): boolean {
    return !this.picker.classList.contains('hidden');
  }

  /** True while a level is being generated. */
  get busy(): boolean {
    return !this.building.classList.contains('hidden');
  }

  setLevels(levels: LevelDef[]): void {
    this.levels = levels;
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

  private renderDifficulty(): void {
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

  private common(level: LevelDef): void {
    this.hint.textContent = level.hint ?? '';
    this.hint.classList.toggle('empty', !level.hint);
    this.lastMoves = -1;
    this.setMoves(0);
    this.hideWin();
  }

  /** Show a campaign level. */
  setLevel(index: number, level: LevelDef): void {
    this.index = index;
    this.root.classList.remove('random');
    this.levelNum.innerHTML = `<span class="lvl-word">Level </span>${index + 1}`;
    this.levelName.textContent = level.name;
    this.levelName.classList.toggle('done', this.isCompleted(level.id));
    this.prevBtn.disabled = index <= 0;
    this.nextBtn.disabled = index >= this.levels.length - 1;
    this.common(level);
    this.progress.last = level.id;
    saveProgress(this.progress);
  }

  /** Show a generated level: "Random 7 · #48213" or "Daily 2026-10-30 · 5". */
  setRandomLevel(level: LevelDef, difficulty: number, seed: number): void {
    this.index = -1;
    this.root.classList.add('random');
    const daily = seed === this.dailySeed;
    this.levelNum.innerHTML = `<span class="lvl-word">${daily ? 'Daily' : 'Endless'}</span><span class="lvl-short">${daily ? '☀' : '∞'}</span>`;
    this.levelName.textContent = daily
      ? `Daily ${dailyLabel(seed)} · ${difficulty}`
      : `Random ${difficulty} · #${seed}`;
    this.levelName.title = level.id;
    this.levelName.classList.toggle('done', this.progress.randomRecent.includes(level.id));
    this.seedInput.value = String(seed);
    this.common(level);
  }

  setMoves(n: number): void {
    if (n === this.lastMoves) return;
    this.lastMoves = n;
    this.movesEl.textContent = String(n);
  }

  isCompleted(id: string): boolean {
    return this.progress.completed.includes(id);
  }

  markCompleted(id: string): void {
    if (!this.isCompleted(id)) {
      this.progress.completed.push(id);
      saveProgress(this.progress);
    }
    this.levelName.classList.add('done');
  }

  markRandomSolved(id: string, difficulty: number): void {
    recordRandomSolve(this.progress, id, difficulty);
    this.levelName.classList.add('done');
    this.renderDifficulty();
  }

  showWin(moves: number, kind: WinKind): void {
    this.winKind = kind;
    this.winMoves.textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
    if (kind === 'random') {
      setLabel(this.winPrimary, 'Next random', ICONS.dice);
      setLabel(this.winSecondary, 'Back to levels', ICONS.grid);
    } else {
      setLabel(this.winPrimary, kind === 'next' ? 'Next level' : 'All levels', kind === 'next' ? ICONS.next : ICONS.grid);
      setLabel(this.winSecondary, 'Replay', ICONS.restart);
    }
    this.win.classList.remove('hidden');
    this.winPrimary.focus({ preventScroll: true });
  }

  hideWin(): void {
    this.win.classList.add('hidden');
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

  openPicker(): void {
    this.pickerGrid.innerHTML = '';
    this.levels.forEach((lv, i) => {
      const done = this.isCompleted(lv.id);
      const b = el('button', `level-tile${done ? ' done' : ''}${i === this.index ? ' current' : ''}`);
      b.type = 'button';
      b.title = lv.name;
      b.innerHTML = `<span class="num">${i + 1}</span>${done ? `<span class="check">${ICONS.check}</span>` : ''}`;
      b.addEventListener('click', () => {
        this.closePicker();
        this.handlers.onSelectLevel(i);
      });
      this.pickerGrid.append(b);
    });
    this.seedError.textContent = '';
    this.renderDifficulty();
    this.picker.classList.remove('hidden');
    const card = this.randomSection.parentElement;
    if (card) card.scrollTop = this.index < 0 ? card.scrollHeight : 0;
  }

  closePicker(): void {
    this.picker.classList.add('hidden');
  }
}
