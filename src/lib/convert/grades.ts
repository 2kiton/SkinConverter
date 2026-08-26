/**
 * Rank / grade sprites.
 *
 * Global to the skin, like the fonts and the health bar, so this sits outside
 * the per-element table.
 *
 * The two games grade on different scales:
 *
 *   Quaver  X (100%, all marvelous), SS (99%), S (95-98), A (90-94),
 *           B (80-89), C (70-79), D (below 70), F (failed)
 *   osu!    XH and X (both SS, silver when earned with HD or FL),
 *           SH and S (both S), A, B, C, D — and no failing grade at all
 *
 * So the mapping is not one-to-one at either end. Quaver's two top grades
 * cover osu!'s two SS variants, its single S covers both S variants, and its
 * F has nowhere to go — osu! shows D for a failed play rather than a separate
 * rank, and D is already spoken for.
 *
 * Quaver only ships `grade-small-*` (its docs suggest 60x60), which matches
 * osu!'s `-small` leaderboard variants in both purpose and size. osu!'s
 * full-size results-screen grades are several times larger, so upscaling a
 * 60px source into them would look worse than leaving osu!'s own art there.
 */

export interface GradeMapping {
  /** Quaver's grade suffix, as in `grade-small-{id}.png`. */
  quaver: string;
  /** osu! rank letters this grade should fill, as in `ranking-{name}-small.png`. */
  osu: string[];
  label: string;
}

export const GRADES: GradeMapping[] = [
  // Quaver's X is a perfect play; osu!'s X is SS. XH is the silver variant,
  // earned with Hidden or Flashlight rather than by accuracy, so Quaver's SS
  // is the closest thing to fill it with.
  { quaver: "x", osu: ["X"], label: "Grade X (SS)" },
  { quaver: "ss", osu: ["XH"], label: "Grade SS (silver SS)" },
  // S and SH differ the same way, and Quaver has only one S.
  { quaver: "s", osu: ["S", "SH"], label: "Grade S" },
  { quaver: "a", osu: ["A"], label: "Grade A" },
  { quaver: "b", osu: ["B"], label: "Grade B" },
  { quaver: "c", osu: ["C"], label: "Grade C" },
  { quaver: "d", osu: ["D"], label: "Grade D" },
];

/** Quaver grades with no osu! counterpart. */
export const QUAVER_ONLY_GRADES = ["f"];

export function quaverGradePath(id: string): string {
  return `Grades/grade-small-${id}.png`;
}

export function osuGradePath(name: string): string {
  return `ranking-${name}-small.png`;
}
