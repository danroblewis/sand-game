// Campaign chapters: contiguous ranges of LEVELS (0-based start index). Levels that exist are
// shown; a chapter with no levels yet is hidden.
export interface Chapter {
  title: string;
  /** Index into LEVELS of the chapter's first level. */
  start: number;
}

export const CHAPTERS: readonly Chapter[] = [
  { title: 'Sand', start: 0 },
  { title: 'Workshop', start: 18 },
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

/** 1-based chapter number of a level index (0 if before the first chapter). */
export function chapterOf(index: number): number {
  let n = 0;
  CHAPTERS.forEach((c, i) => {
    if (index >= c.start) n = i + 1;
  });
  return n;
}
