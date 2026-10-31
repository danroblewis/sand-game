// Player progress persisted in localStorage.
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
}

export type RandomMode = 'floating' | 'gravity' | 'mixed';
export const RANDOM_MODES: readonly RandomMode[] = ['floating', 'gravity', 'mixed'];

/** Whether a random level with this seed uses box gravity under `mode` (Mixed: odd seeds). */
export function gravityFor(mode: RandomMode, seed: number): boolean {
  return mode === 'gravity' || (mode === 'mixed' && seed % 2 === 1);
}

export function loadProgress(): Progress {
  const p: Progress = { completed: [], last: null, difficulty: null, randomSolved: {}, randomRecent: [], randomMode: 'floating', randomHero: false, sound: true, haptics: true };
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
