// Player progress persisted in localStorage.
import type { LevelRecord, Unlock } from '../progress/model';
const KEY = 'sandboxes.progress';
const RECENT_MAX = 300;

export interface Progress {
  /** Completed campaign level ids. */
  completed: string[];
  /** Last played campaign level id. */
  last: string | null;
  /** Last chosen random-level difficulty (1..10), or null if never chosen. */
  difficulty: number | null;
  /** Random levels solved, keyed by difficulty ("1".."10"). */
  randomSolved: Record<string, number>;
  /** Recently solved random level ids (so replaying the same seed doesn't count twice). */
  randomRecent: string[];
  /** Random-level box gravity: always off, always on, or per seed. */
  randomMode: RandomMode;
  /** Random levels in hero (Pusher) mode. */
  randomHero: boolean;
  /** Sound effects on (still silent until the first user gesture). */
  sound: boolean;
  /** Vibration feedback on (where navigator.vibrate exists). */
  haptics: boolean;
  /** The one-time big-map "look around" hint was shown. */
  seenBigMapHint?: boolean;
  /** Theme override: 'auto' (level / chapter default) or a skin id. */
  theme: string;
  /** Random levels: big maps with the hero (Expedition). */
  randomBig: boolean;
  /** Per-level records (campaign), keyed by level id. */
  records: Record<string, LevelRecord>;
  /** Unlock ceremonies already queued or shown (keys from unlockKey). */
  seenUnlocks: string[];
  /** Unlock ceremonies waiting to be shown. */
  pendingUnlocks: Unlock[];
  /** Chapters kept open permanently (1-based; granted to profiles that played them before stars). */
  unlockedChapters: number[];
  /** Free Play kept open permanently (an older profile that had used it or solved 6 levels). */
  freePlayGranted: boolean;
  /** Progression data version (0 = an older profile that still needs migrating). */
  progression: number;
}

export type RandomMode = 'floating' | 'gravity' | 'mixed';
export const RANDOM_MODES: readonly RandomMode[] = ['floating', 'gravity', 'mixed'];

/** Whether a random level with this seed uses box gravity under `mode` (Mixed: odd seeds). */
export function gravityFor(mode: RandomMode, seed: number): boolean {
  return mode === 'gravity' || (mode === 'mixed' && seed % 2 === 1);
}

export function loadProgress(): Progress {
  const p: Progress = { completed: [], last: null, difficulty: null, randomSolved: {}, randomRecent: [], randomMode: 'floating', randomHero: false, sound: true, haptics: true, theme: 'auto', randomBig: false, records: {}, seenUnlocks: [], pendingUnlocks: [], progression: 0, unlockedChapters: [], freePlayGranted: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return p;
    const o = JSON.parse(raw) as Partial<Progress>;
    if (Array.isArray(o.completed)) p.completed = o.completed.filter((x) => typeof x === 'string');
    if (typeof o.last === 'string') p.last = o.last;
    if (typeof o.difficulty === 'number' && o.difficulty >= 1 && o.difficulty <= 10) p.difficulty = Math.round(o.difficulty);
    if (o.randomSolved && typeof o.randomSolved === 'object') {
      for (const [k, v] of Object.entries(o.randomSolved)) if (typeof v === 'number' && v > 0) p.randomSolved[k] = v;
    }
    if (typeof o.randomMode === 'string' && (RANDOM_MODES as readonly string[]).includes(o.randomMode)) p.randomMode = o.randomMode;
    if (typeof o.randomHero === 'boolean') p.randomHero = o.randomHero;
    if (typeof o.sound === 'boolean') p.sound = o.sound;
    if (typeof o.haptics === 'boolean') p.haptics = o.haptics;
    if (o.seenBigMapHint === true) p.seenBigMapHint = true;
    if (typeof o.theme === 'string' && o.theme) p.theme = o.theme;
    if (typeof o.randomBig === 'boolean') p.randomBig = o.randomBig;
    if (o.records && typeof o.records === 'object') {
      for (const [id, r] of Object.entries(o.records)) {
        if (!r || typeof r !== 'object') continue;
        const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
        const stars = Math.max(0, Math.min(3, Math.round(num(r.stars) ?? 0)));
        p.records[id] = { completed: r.completed === true, stars, bestMoves: num(r.bestMoves), bestSeconds: num(r.bestSeconds), bestSandSeconds: num(r.bestSandSeconds), maxSandSeconds: num(r.maxSandSeconds) };
      }
    }
    if (Array.isArray(o.seenUnlocks)) p.seenUnlocks = o.seenUnlocks.filter((x) => typeof x === 'string');
    if (Array.isArray(o.pendingUnlocks)) p.pendingUnlocks = o.pendingUnlocks.filter((u) => u && typeof u === 'object' && typeof (u as Unlock).kind === 'string');
    if (Array.isArray(o.unlockedChapters)) p.unlockedChapters = o.unlockedChapters.filter((x) => typeof x === 'number');
    if (o.freePlayGranted === true) p.freePlayGranted = true;
    if (typeof o.progression === 'number') p.progression = o.progression;
    if (Array.isArray(o.randomRecent)) p.randomRecent = o.randomRecent.filter((x) => typeof x === 'string').slice(-RECENT_MAX);
  } catch {
    /* storage unavailable or corrupt */
  }
  return p;
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Count a solved random level once per level id. Returns true if it was newly counted. */
export function recordRandomSolve(p: Progress, id: string, difficulty: number): boolean {
  if (p.randomRecent.includes(id)) return false;
  p.randomRecent.push(id);
  if (p.randomRecent.length > RECENT_MAX) p.randomRecent.splice(0, p.randomRecent.length - RECENT_MAX);
  const k = String(difficulty);
  p.randomSolved[k] = (p.randomSolved[k] ?? 0) + 1;
  saveProgress(p);
  return true;
}
