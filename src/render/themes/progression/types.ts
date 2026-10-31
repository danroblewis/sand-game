// Themed progression presentation (DESIGN.md "Progression, scores, and fanfare"): the level map,
// the win fanfare and unlock ceremonies. Skins render into a DOM host the HUD owns; all game
// logic (records, locks, navigation) stays in the view models passed in.
import type { Unlock } from '../../../progress/model';

export interface MapLevelView {
  /** Index into LEVELS. */
  index: number;
  id: string;
  name: string;
  unlocked: boolean;
  completed: boolean;
  stars: number;
  current: boolean;
  /** Why it is locked. */
  requirement?: string;
  bestMoves?: number;
  parMoves?: number;
}

export interface MapChapterView {
  number: number;
  title: string;
  unlocked: boolean;
  requirement?: string;
  stars: number;
  maxStars: number;
  completed: number;
  levels: MapLevelView[];
}

export interface MapModel {
  chapters: MapChapterView[];
  totalStars: number;
  maxStars: number;
  /** Play an unlocked level. */
  select(index: number): void;
  /** A locked level was tapped: the HUD explains the requirement. */
  explain(level: MapLevelView): void;
}

export interface FanfareView {
  /** e.g. "Level 5" / "Endless". */
  kicker: string;
  title: string;
  /** Stars earned this run (null: no stars, e.g. Free Play). */
  stars: number | null;
  /** Best stars before this run. */
  prevStars: number;
  moves: number;
  parMoves?: number;
  seconds: number;
  sandSeconds: number;
  /** Best values after this run (records), if any. */
  best?: { moves?: number; seconds?: number; sandSeconds?: number; pour?: number };
  newRecord: { moves: boolean; seconds: boolean; sandSeconds: boolean; pour: boolean };
  firstClear: boolean;
  /** A line about what this win opened ("Level 6 unlocked"), if anything. */
  unlockedText?: string;
  next: { label: string; run: () => void } | null;
  replay: { label: string; run: () => void };
  map: { label: string; run: () => void };
  /** Called as star i (1..n) lands: sound + haptic tick. */
  onStar(i: number): void;
}

export interface CeremonyView {
  unlock: Unlock;
  title: string;
  text: string;
  cta: string;
  onContinue(): void;
}

export interface SkinProgression {
  /** Scoped styles for these screens, injected once when the skin is first activated. */
  readonly css?: string;
  /** Fill `host` with the chapter / level map. */
  renderMap(host: HTMLElement, model: MapModel): void;
  /** Fill `host` with the win screen; returns a cleanup (stops pending reveal timers). */
  winFanfare(host: HTMLElement, result: FanfareView): () => void;
  /** Fill `host` with an unlock ceremony; returns a cleanup. */
  ceremony(host: HTMLElement, unlock: CeremonyView): () => void;
}
