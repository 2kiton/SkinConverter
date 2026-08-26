/**
 * Numeric translation between the two skin.ini coordinate spaces.
 *
 * Both games ultimately work in a 768-unit-high space, and both scale skins by
 * screen height, so the conversion is a single exact factor:
 *
 *   - Quaver authors skin.ini in 1366x768. Keys such as `ColumnSize` and
 *     `HitPosOffsetY` carry a `[FixedScale]` attribute and are multiplied by
 *     `SkinScalingFactor = 1920f / 1366` into its 1920x1080 render space.
 *   - osu! authors skin.ini in 640x480 osu!pixels and multiplies by
 *     `LegacySkin.STABLE_MAGIC_SCALE_FACTOR = 1.6f`, documented in its own
 *     source as "converting legacy positioning values (based in x480
 *     dimensions) to x768".
 *
 * So 480 -> 768 is x1.6 and 768 -> 480 is x0.625, exactly. Do NOT use
 * 640/1366: horizontal placement is a centring problem, not a scaling one.
 */

export const OSU_TO_QUAVER = 1.6;
export const QUAVER_TO_OSU = 0.625;

/** osu!'s own default column width, in osu!pixels. */
export const OSU_DEFAULT_COLUMN_WIDTH = 30;
/** osu!'s own default hit position, in osu!pixels measured from the top. */
export const OSU_DEFAULT_HIT_POSITION = 402;
/** osu!'s own default stage-light position, in osu!pixels measured from the top. */
export const OSU_DEFAULT_LIGHT_POSITION = 413;
/** osu!'s own default left edge of the stage, in osu!pixels. */
export const OSU_DEFAULT_COLUMN_START = 136;
/** The osu! authoring box height, in osu!pixels. */
export const OSU_SCREEN_HEIGHT = 480;
/** The osu! authoring box width, in osu!pixels. */
export const OSU_SCREEN_WIDTH = 640;

/** Quaver's own default column size, in its 1366x768 space. */
export const QUAVER_DEFAULT_COLUMN_SIZE = 90;
/** The Quaver authoring box width, in its own units. */
export const QUAVER_SCREEN_WIDTH = 1366;

export function osuToQuaver(value: number): number {
  return value * OSU_TO_QUAVER;
}

export function quaverToOsu(value: number): number {
  return value * QUAVER_TO_OSU;
}

/** Round to at most `places` decimals, dropping a trailing `.0`. */
export function tidy(value: number, places = 2): string {
  const rounded = Number(value.toFixed(places));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Parse a comma-separated numeric list, as used by osu!'s `ColumnWidth` etc.
 *
 * Empty entries are dropped rather than coerced: `Number("")` is 0, so a
 * stray comma in `ColumnWidth: 30,,40` would otherwise become a zero-width
 * lane that renders as an invisible column.
 */
export function parseNumberList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function formatNumberList(values: number[], places = 2): string {
  return values.map((v) => tidy(v, places)).join(",");
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Collapse osu!'s per-column widths into Quaver's single `ColumnSize`.
 *
 * Quaver has one uniform size plus a separate `ScratchLaneSize`, so unequal
 * osu! columns cannot survive. We take the most common width rather than the
 * mean, because skins that vary width usually do it for one scratch lane and
 * the mean would then be wrong for every lane.
 */
export function collapseColumnWidths(widths: number[]): { value: number; uniform: boolean } {
  if (widths.length === 0) return { value: OSU_DEFAULT_COLUMN_WIDTH, uniform: true };

  const counts = new Map<number, number>();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);

  let best = widths[0]!;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return { value: best, uniform: counts.size === 1 };
}

/**
 * Total stage width for a set of columns, including the gaps between them.
 * Used to centre the field identically in both games.
 */
export function stageWidth(columnWidths: number[], spacings: number[]): number {
  const columns = columnWidths.reduce((n, w) => n + w, 0);
  const gaps = spacings.slice(0, Math.max(0, columnWidths.length - 1)).reduce((n, s) => n + s, 0);
  return columns + gaps;
}

/**
 * osu! `ColumnStart` -> Quaver `ColumnAlignment`.
 *
 * `ColumnStart` is an absolute left edge in osu!pixels; `ColumnAlignment` is a
 * percentage of screen width. Convert by finding the field's centre and
 * expressing it as a percentage. A round trip will not return the original
 * number, because the two models disagree about what is being positioned.
 */
export function columnStartToAlignment(columnStart: number, totalStageWidth: number): number {
  const centre = columnStart + totalStageWidth / 2;
  return (centre / OSU_SCREEN_WIDTH) * 100;
}

export function alignmentToColumnStart(alignmentPercent: number, totalStageWidthOsu: number): number {
  const centre = (alignmentPercent / 100) * OSU_SCREEN_WIDTH;
  return centre - totalStageWidthOsu / 2;
}

/**
 * osu! measures `HitPosition` from the top of the 480-unit box; osu!'s own
 * loader immediately rewrites it as `(480 - HitPosition)`, a distance from the
 * bottom. Quaver's `HitPosOffsetY` is an offset from its own default, positive
 * meaning lower. Working in distance-from-bottom keeps both honest.
 */
export function hitPositionToOffset(hitPosition: number): number {
  // Positive offset moves the hit position DOWN in Quaver, which means a
  // smaller distance from the bottom, hence the sign flip.
  const deltaFromDefaultOsu = hitPosition - OSU_DEFAULT_HIT_POSITION;
  return osuToQuaver(deltaFromDefaultOsu);
}

export function offsetToHitPosition(offset: number): number {
  return OSU_DEFAULT_HIT_POSITION + quaverToOsu(offset);
}

/**
 * osu! `NoteBodyStyle`.
 *
 * The wiki lists `1` as the default "Repeat" style, but osu!'s own source
 * comments that value out — "listed as the default on the wiki, but is
 * seemingly not according to the source". Only 0, 2, 3 and 4 are real.
 * Quaver stretches hold bodies, so `Stretch` is the faithful match.
 */
export enum NoteBodyStyle {
  Stretch = 0,
  RepeatTop = 2,
  RepeatBottom = 3,
  RepeatTopAndBottom = 4,
}

/** The style that matches Quaver's stretched hold body. */
export const QUAVER_EQUIVALENT_BODY_STYLE = NoteBodyStyle.Stretch;

export function describeBodyStyle(value: number | null): string {
  switch (value) {
    case NoteBodyStyle.Stretch:
      return "stretch";
    case NoteBodyStyle.RepeatTop:
      return "repeat from top";
    case NoteBodyStyle.RepeatBottom:
      return "repeat from bottom";
    case NoteBodyStyle.RepeatTopAndBottom:
      return "repeat from both ends";
    case 1:
      return "repeat (not honoured by osu!)";
    default:
      return "unset";
  }
}

/** RGB(A) colour, as both games write it: `r,g,b` or `r,g,b,a`. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseRgba(raw: string | undefined): Rgba | null {
  const parts = parseNumberList(raw);
  if (parts.length < 3) return null;
  return {
    r: clampByte(parts[0]!),
    g: clampByte(parts[1]!),
    b: clampByte(parts[2]!),
    // Quaver documents alpha as defaulting to 255 when omitted.
    a: parts.length > 3 ? clampByte(parts[3]!) : 255,
  };
}

/** Quaver keeps the alpha channel; osu! ignores it on `ColourLight`. */
export function formatRgba(colour: Rgba, includeAlpha: boolean): string {
  const base = `${colour.r},${colour.g},${colour.b}`;
  return includeAlpha ? `${base},${colour.a}` : base;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
