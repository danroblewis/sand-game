// Campaign chapters: contiguous ranges of LEVELS (0-based start index). Levels that exist are
// shown; a chapter with no levels yet is hidden.
export interface Chapter {
  title: string;
  /** Index into LEVELS of the chapter's first level. */
  start: number;
  /** Default skin for the chapter's levels (src/render/themes). */
  theme?: string;
}

export const CHAPTERS: readonly Chapter[] = [
  { title: 'Sand', start: 0, theme: 'slate' },
  { title: 'Workshop', start: 18, theme: 'slate' },
  { title: 'Pusher', start: 27, theme: 'station' },
  { title: 'Pusher II', start: 41, theme: 'station' },
  { title: 'Expanse', start: 77, theme: 'station' },
];

/** Chapters that contain at least one of `levelCount` levels, with their [start, end) ranges. */
export function chapterRanges(levelCount: number): { chapter: Chapter; number: number; start: number; end: number }[] {
  const out: { chapter: Chapter; number: number; start: number; end: number }[] = [];
  CHAPTERS.forEach((chapter, i) => {
    const start = chapter.start;
    const end = Math.min(levelCount, i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].start : levelCount);
    if (start < end) out.push({ chapter, number: i + 1, start, end });
  });
  return out;
}

/** Default theme of the chapter containing a level index, if any. */
export function chapterTheme(index: number): string | undefined {
  let t: string | undefined;
  for (const c of CHAPTERS) if (index >= c.start) t = c.theme;
  return t;
}

/** 1-based chapter number of a level index (0 if before the first chapter). */
export function chapterOf(index: number): number {
  let n = 0;
  CHAPTERS.forEach((c, i) => {
    if (index >= c.start) n = i + 1;
  });
  return n;
}
