// Progression (DESIGN.md "Progression, scores, and fanfare"): per-level records, stars from moves vs
// par, unlock rules, and a queue of unlock ceremonies that fire once. Pure functions over the
// persisted Progress (src/ui/progress.ts) and the campaign level list.
import type { LevelDef } from '../core/types';
import { parFor, type Par } from '../levels/par';
import { chapterRanges } from '../ui/chapters';
import type { Progress } from '../ui/progress';

export interface LevelRecord {
  completed: boolean;
  /** Fewest moves in a win. */
  bestMoves?: number;
  /** Shortest win, sim seconds from the first input. */
  bestSeconds?: number;
  /** Least sand-flow time in a win. */
  bestSandSeconds?: number;
  /** "Longest pour": most sand-flow time in a win. */
  maxSandSeconds?: number;
  /** Best star rating (1..3). */
  stars: number;
}

export type Unlock =
  | { kind: 'chapter'; chapter: number; title: string }
  | { kind: 'freeplay' }
  | { kind: 'stars'; stars: number };

/** Free Play opens after this many completed campaign levels. */
export const FREE_PLAY_AFTER = 6;
/** A chapter opens at this share of the stars available in all earlier chapters. */
export const CHAPTER_STAR_SHARE = 0.6;
/** A star-milestone ceremony every this many stars. */
export const STAR_MILESTONE = 25;

/** Stars for a win: 3 if moves <= ceil(par x 1.15), 2 if <= par x 1.6, else 1 (no par: 1). */
export function starsFor(moves: number, par: Par | undefined): number {
  if (!par) return 1;
  if (moves <= Math.ceil(par.moves * 1.15)) return 3;
  if (moves <= par.moves * 1.6) return 2;
  return 1;
}

export function unlockKey(u: Unlock): string {
  return u.kind === 'chapter' ? `chapter-${u.chapter}` : u.kind === 'stars' ? `stars-${u.stars}` : 'freeplay';
}

export function recordOf(p: Progress, id: string): LevelRecord | undefined {
  return p.records[id];
}

export function isCompleted(p: Progress, id: string): boolean {
  return !!p.records[id]?.completed;
}

export function totalStars(p: Progress, levels: readonly LevelDef[]): number {
  let n = 0;
  for (const l of levels) n += p.records[l.id]?.stars ?? 0;
  return n;
}

export function completedCount(p: Progress, levels: readonly LevelDef[]): number {
  let n = 0;
  for (const l of levels) if (p.records[l.id]?.completed) n++;
  return n;
}

export interface ChapterState {
  /** 1-based chapter number. */
  number: number;
  title: string;
  theme?: string;
  start: number;
  end: number;
  unlocked: boolean;
  stars: number;
  maxStars: number;
  completed: number;
  /** Stars needed (in chapters before this one) to open it; 0 for the first chapter. */
  needStars: number;
  /** Stars earned in chapters before this one. */
  haveStars: number;
}

/** Chapter states in order (sequential: a chapter also needs the one before it open). */
export function chapterStates(p: Progress, levels: readonly LevelDef[]): ChapterState[] {
  const out: ChapterState[] = [];
  let prevStars = 0;
  let prevMax = 0;
  let prevOpen = true;
  chapterRanges(levels.length).forEach((ch, i) => {
    let stars = 0;
    let completed = 0;
    for (let k = ch.start; k < ch.end; k++) {
      const r = p.records[levels[k].id];
      stars += r?.stars ?? 0;
      if (r?.completed) completed++;
    }
    const needStars = i === 0 ? 0 : Math.ceil(prevMax * CHAPTER_STAR_SHARE - 1e-9);
    const unlocked = i === 0 || (p.unlockedChapters ?? []).includes(ch.number) || (prevOpen && prevStars >= needStars);
    out.push({ number: ch.number, title: ch.chapter.title, theme: ch.chapter.theme, start: ch.start, end: ch.end, unlocked, stars, maxStars: (ch.end - ch.start) * 3, completed, needStars, haveStars: prevStars });
    prevStars += stars;
    prevMax += (ch.end - ch.start) * 3;
    prevOpen = unlocked;
  });
  return out;
}

export interface LevelLock {
  unlocked: boolean;
  /** Why it is locked (for the map / grid / hash). */
  requirement?: string;
}

/** Whether campaign level `index` can be played, and if not, what opens it. */
export function levelLock(p: Progress, levels: readonly LevelDef[], index: number, chapters = chapterStates(p, levels)): LevelLock {
  const ch = chapters.find((c) => index >= c.start && index < c.end);
  if (!ch) return { unlocked: false, requirement: 'Unknown level' };
  if (!ch.unlocked) {
    const prev = chapters[chapters.indexOf(ch) - 1];
    if (prev && !prev.unlocked) return { unlocked: false, requirement: `Open chapter ${prev.number} first` };
    return { unlocked: false, requirement: `Chapter ${ch.number} opens at ${ch.needStars} stars (you have ${ch.haveStars})` };
  }
  if (index === ch.start || p.records[levels[index].id]?.completed || p.records[levels[index - 1].id]?.completed) return { unlocked: true };
  return { unlocked: false, requirement: `Solve level ${index} first` };
}

export function isUnlocked(p: Progress, levels: readonly LevelDef[], index: number): boolean {
  return levelLock(p, levels, index).unlocked;
}

export function freePlayUnlocked(p: Progress, levels: readonly LevelDef[]): boolean {
  return !!p.freePlayGranted || completedCount(p, levels) >= FREE_PLAY_AFTER;
}

/** Everything currently unlocked that gets a ceremony (chapters after the first, Free Play, milestones). */
function unlockSet(p: Progress, levels: readonly LevelDef[]): Unlock[] {
  const out: Unlock[] = [];
  for (const c of chapterStates(p, levels)) if (c.number > 1 && c.unlocked) out.push({ kind: 'chapter', chapter: c.number, title: c.title });
  if (freePlayUnlocked(p, levels)) out.push({ kind: 'freeplay' });
  const stars = totalStars(p, levels);
  for (let s = STAR_MILESTONE; s <= stars; s += STAR_MILESTONE) out.push({ kind: 'stars', stars: s });
  return out;
}

/**
 * Mark everything already unlocked as seen without a ceremony (first run of this version over an
 * old profile, so a returning player is not flooded). Returns true if anything changed.
 */
export function settleSeen(p: Progress, levels: readonly LevelDef[]): boolean {
  let changed = false;
  for (const u of unlockSet(p, levels)) {
    const k = unlockKey(u);
    if (!p.seenUnlocks.includes(k)) {
      p.seenUnlocks.push(k);
      changed = true;
    }
  }
  return changed;
}

/** Queue ceremonies for unlocks not seen before. */
function queueNewUnlocks(p: Progress, levels: readonly LevelDef[]): Unlock[] {
  const fresh: Unlock[] = [];
  for (const u of unlockSet(p, levels)) {
    const k = unlockKey(u);
    if (p.seenUnlocks.includes(k)) continue;
    p.seenUnlocks.push(k);
    p.pendingUnlocks.push(u);
    fresh.push(u);
  }
  return fresh;
}

/** Take the next ceremony off the queue (the caller saves progress). */
export function nextPendingUnlock(p: Progress): Unlock | undefined {
  return p.pendingUnlocks.shift();
}

export interface WinStats {
  moves: number;
  /** Sim seconds from the first input to the win. */
  seconds: number;
  /** Sim seconds with sand flowing. */
  sandSeconds: number;
}

export interface WinOutcome {
  par?: Par;
  stars: number;
  prevStars: number;
  /** Records before this win (undefined on a first completion). */
  before?: LevelRecord;
  record: LevelRecord;
  newRecord: { moves: boolean; seconds: boolean; sandSeconds: boolean; pour: boolean };
  firstClear: boolean;
  /** Unlocks this win caused (also queued in progress.pendingUnlocks). */
  unlocks: Unlock[];
  /** The next level index became playable by this win. */
  unlockedNext: boolean;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Record a campaign win: updates the record, the completed list and the ceremony queue. */
export function recordWin(p: Progress, levels: readonly LevelDef[], id: string, s: WinStats): WinOutcome {
  const idx = levels.findIndex((l) => l.id === id);
  const nextWasOpen = idx >= 0 && idx + 1 < levels.length && isUnlocked(p, levels, idx + 1);
  const par = parFor(id);
  const stars = starsFor(s.moves, par);
  const prev = p.records[id];
  const before = prev?.completed ? { ...prev } : undefined;
  const seconds = r1(s.seconds);
  const sand = r1(s.sandSeconds);
  const rec: LevelRecord = { ...(prev ?? { completed: false, stars: 0 }) };
  const newRecord = {
    moves: before !== undefined && before.bestMoves !== undefined && s.moves < before.bestMoves,
    seconds: before !== undefined && before.bestSeconds !== undefined && seconds < before.bestSeconds,
    sandSeconds: before !== undefined && before.bestSandSeconds !== undefined && sand < before.bestSandSeconds,
    pour: before !== undefined && before.maxSandSeconds !== undefined && sand > before.maxSandSeconds,
  };
  rec.completed = true;
  rec.stars = Math.max(rec.stars ?? 0, stars);
  rec.bestMoves = rec.bestMoves === undefined ? s.moves : Math.min(rec.bestMoves, s.moves);
  rec.bestSeconds = rec.bestSeconds === undefined ? seconds : Math.min(rec.bestSeconds, seconds);
  rec.bestSandSeconds = rec.bestSandSeconds === undefined ? sand : Math.min(rec.bestSandSeconds, sand);
  rec.maxSandSeconds = rec.maxSandSeconds === undefined ? sand : Math.max(rec.maxSandSeconds, sand);
  p.records[id] = rec;
  if (!p.completed.includes(id)) p.completed.push(id);
  const unlocks = queueNewUnlocks(p, levels);
  const unlockedNext = idx >= 0 && idx + 1 < levels.length && !nextWasOpen && isUnlocked(p, levels, idx + 1);
  return { par, stars, prevStars: prev?.stars ?? 0, before, record: rec, newRecord, firstClear: !before, unlocks, unlockedNext };
}

/**
 * Old profiles: every id in `completed` without a record becomes a 1-star record; a chapter with
 * any completed level stays open for good, and so does Free Play if it was used (any random level
 * solved) or 6 levels were solved.
 */
export function migrateCompleted(p: Progress, levels: readonly LevelDef[] = []): boolean {
  let changed = false;
  for (const ch of chapterRanges(levels.length)) {
    let any = false;
    for (let k = ch.start; k < ch.end; k++) if (p.completed.includes(levels[k].id)) any = true;
    if (any && !p.unlockedChapters.includes(ch.number)) {
      p.unlockedChapters.push(ch.number);
      changed = true;
    }
  }
  const usedRandom = p.randomRecent.length > 0 || Object.values(p.randomSolved).some((n) => n > 0);
  if (!p.freePlayGranted && (usedRandom || p.completed.length >= FREE_PLAY_AFTER)) {
    p.freePlayGranted = true;
    changed = true;
  }
  for (const id of p.completed) {
    if (!p.records[id]) {
      p.records[id] = { completed: true, stars: 1 };
      changed = true;
    }
  }
  return changed;
}

/** First playable level at or after `from` that is locked (`]` stops before it), or -1. */
export function firstLockedFrom(p: Progress, levels: readonly LevelDef[], from: number): number {
  const ch = chapterStates(p, levels);
  for (let i = from; i < levels.length; i++) if (!levelLock(p, levels, i, ch).unlocked) return i;
  return -1;
}
