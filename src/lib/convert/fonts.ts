/**
 * Number fonts — combo, score, accuracy.
 *
 * These are global to a skin, not per keymode, and the two games disagree
 * about how they are named:
 *
 *   - Quaver keeps them in `/Numbers/`, split into two families:
 *     `combo-{0-9}.png` for the combo counter and `score-{0-9}.png` for
 *     score, accuracy, rating and KPS, plus `score-percent` and
 *     `score-decimal`.
 *   - osu! declares prefixes in a `[Fonts]` section and derives the filenames
 *     from them: `{ComboPrefix}-{0-9}.png`, `{ScorePrefix}-{0-9}.png`, with
 *     `-percent` and `-dot` for the symbols. Both prefixes default to
 *     `score`, so an osu! skin usually has one font doing both jobs.
 *
 * Because osu!'s side is a prefix rather than a fixed name, this cannot live
 * in the per-element table with everything else.
 */

export interface FontFamily {
  /** Which counter this font drives. */
  id: "combo" | "score";
  /** osu! `[Fonts]` key naming the prefix. */
  osuPrefixKey: "ComboPrefix" | "ScorePrefix";
  /** osu! `[Fonts]` key for glyph overlap. */
  osuOverlapKey: "ComboOverlap" | "ScoreOverlap";
  /** osu!'s own default prefix when the skin declares none. */
  osuDefaultPrefix: string;
  /** Quaver filename stem inside `/Numbers/`. */
  quaverStem: string;
  /** Non-digit glyphs, as `[quaverSuffix, osuSuffix]`. */
  symbols: [string, string][];
}

export const FONT_FAMILIES: FontFamily[] = [
  {
    id: "combo",
    osuPrefixKey: "ComboPrefix",
    osuOverlapKey: "ComboOverlap",
    osuDefaultPrefix: "score",
    quaverStem: "combo",
    symbols: [],
  },
  {
    id: "score",
    osuPrefixKey: "ScorePrefix",
    osuOverlapKey: "ScoreOverlap",
    osuDefaultPrefix: "score",
    quaverStem: "score",
    // Quaver spells the decimal point "decimal"; osu! spells it "dot".
    symbols: [
      ["percent", "percent"],
      ["decimal", "dot"],
    ],
  },
];

export const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Quaver path for one glyph, relative to the skin root. */
export function quaverGlyphPath(family: FontFamily, glyph: string): string {
  return `Numbers/${family.quaverStem}-${glyph}.png`;
}

/** osu! filename for one glyph, given the skin's prefix for that family. */
export function osuGlyphPath(prefix: string, glyph: string): string {
  return `${prefix}-${glyph}.png`;
}

/** Every glyph name in a family, digits first. */
export function glyphNames(family: FontFamily, side: "quaver" | "osu"): string[] {
  const digits = DIGITS.map(String);
  const symbols = family.symbols.map(([q, o]) => (side === "quaver" ? q : o));
  return [...digits, ...symbols];
}

/**
 * The prefix QuaverMania writes when it exports a font to osu!.
 *
 * Namespaced so a converted font never collides with an element already in
 * the skin, and distinct per family so Quaver's separate combo and score
 * fonts stay separate rather than collapsing into osu!'s shared default.
 */
export function exportPrefix(family: FontFamily): string {
  return `qm-${family.id}`;
}
