/**
 * Turning either skin format into one common playfield description.
 *
 * The preview exists so fidelity questions become a two-second visual check
 * instead of a launch-the-game cycle, which only works if the preview and the
 * converter agree. Both therefore share the same primitives — the element
 * table, the column-token rule, the scale factor — and the same baseline
 * assumption about where the hit position sits.
 *
 * Everything here is expressed in the 768-unit-high space both games share.
 */

import { allSections, get, readSection } from "../ini/access";
import type { SkinPackage } from "../skin/types";
import { ELEMENTS, type ElementMapping } from "../convert/elements";
import { columnTokens, parseSpecialStyle } from "../convert/lanes";
import { FileIndex } from "../convert/files";
import {
  OSU_DEFAULT_COLUMN_START,
  OSU_DEFAULT_COLUMN_WIDTH,
  OSU_DEFAULT_HIT_POSITION,
  OSU_SCREEN_HEIGHT,
  QUAVER_DEFAULT_COLUMN_SIZE,
  osuToQuaver,
  parseNumber,
  parseNumberList,
  parseRgba,
  quaverToOsu,
  stageWidth,
  type Rgba,
} from "../convert/geometry";

/** The 768-high space both games resolve to. */
export const FIELD_HEIGHT = 768;

export interface LaneVisual {
  /** Entry paths in the source package, or null when the element is absent. */
  note: string | null;
  holdHead: string | null;
  holdBody: string | null;
  holdTail: string | null;
  receptor: string | null;
  /** osu! `Colour{n}` lane background. Quaver has no equivalent. */
  laneColour: Rgba | null;
  /** Press-lighting tint: Quaver `ColumnColor{n}`, osu! `ColourLight{n}`. */
  lightColour: Rgba | null;
  width: number;
}

export interface PlayfieldLayout {
  keymode: string;
  keys: number;
  lanes: LaneVisual[];
  /** Gaps between lanes, in 768-space. */
  spacing: number[];
  /** Distance from the bottom of the field to the judgement line, in 768-space. */
  hitPositionFromBottom: number;
  stageHint: string | null;
  stageLeft: string | null;
  stageRight: string | null;
  /** Total stage width in 768-space, gaps included. */
  totalWidth: number;
  /** Things the preview could not determine and had to assume. */
  assumptions: string[];
}

/**
 * osu!'s own loader rewrites `HitPosition` as `480 - HitPosition`, a distance
 * from the bottom, then scales by 1.6. That gives 124.8 for the default 402.
 *
 * Quaver's `HitPosOffsetY` is an offset from its own default, and that
 * default is not stated in its documentation. The converter treats offset 0
 * as equivalent to osu!'s default, so the preview uses the same baseline —
 * which keeps the two consistent, but means the absolute position is an
 * assumption until it is measured in-game.
 */
export const DEFAULT_HIT_FROM_BOTTOM = osuToQuaver(OSU_SCREEN_HEIGHT - OSU_DEFAULT_HIT_POSITION);

export function availableKeymodes(pkg: SkinPackage): string[] {
  if (!pkg.ini) return [];
  const doc = pkg.ini;

  if (pkg.format === "osu") {
    return allSections(doc)
      .filter((s) => s.name.toLowerCase() === "mania")
      .map((s) => get(doc, s, "Keys"))
      .filter((k): k is string => !!k)
      .map((k) => `${k}K`)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  return allSections(doc)
    .map((s) => s.name.toUpperCase())
    .filter((n) => /^\d{1,2}K$/.test(n))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

export function buildLayout(pkg: SkinPackage, keymode: string): PlayfieldLayout | null {
  const keys = parseInt(keymode, 10);
  if (!Number.isFinite(keys) || keys < 1) return null;

  const index = new FileIndex(pkg.entries);
  const assumptions: string[] = [];
  const config = configFor(pkg, keymode, keys);

  const widths =
    pkg.format === "osu"
      ? osuColumnWidths(config, keys)
      : Array.from({ length: keys }, () => parseNumber(config["ColumnSize"]) ?? QUAVER_DEFAULT_COLUMN_SIZE);

  const spacing =
    pkg.format === "osu"
      ? padTo(parseNumberList(config["ColumnSpacing"]).map(osuToQuaver), Math.max(0, keys - 1), 0)
      : Array.from({ length: Math.max(0, keys - 1) }, () => parseNumber(config["NotePadding"]) ?? 0);

  const hitPositionFromBottom =
    pkg.format === "osu"
      ? osuToQuaver(OSU_SCREEN_HEIGHT - (parseNumber(config["HitPosition"]) ?? OSU_DEFAULT_HIT_POSITION))
      : DEFAULT_HIT_FROM_BOTTOM - (parseNumber(config["HitPosOffsetY"]) ?? 0);

  if (pkg.format === "quaver") {
    assumptions.push(
      "Quaver's default hit position is not documented, so osu!'s is used as the baseline and HitPosOffsetY applied to it.",
    );
  }

  const tokens = columnTokens(keys, parseSpecialStyle(config["SpecialStyle"]));
  const lanes: LaneVisual[] = [];

  for (let lane = 1; lane <= keys; lane++) {
    const column = lane - 1;
    lanes.push({
      note: resolve(pkg, index, config, "note", keymode, keys, lane, tokens[column] ?? "1"),
      holdHead: resolve(pkg, index, config, "holdHead", keymode, keys, lane, tokens[column] ?? "1"),
      holdBody: resolve(pkg, index, config, "holdBody", keymode, keys, lane, tokens[column] ?? "1"),
      holdTail: resolve(pkg, index, config, "holdTail", keymode, keys, lane, tokens[column] ?? "1"),
      receptor: resolve(pkg, index, config, "receptorUp", keymode, keys, lane, tokens[column] ?? "1"),
      laneColour: pkg.format === "osu" ? parseRgba(config[`Colour${lane}`]) : null,
      lightColour: parseRgba(
        pkg.format === "osu" ? config[`ColourLight${lane}`] : config[`ColumnColor${lane}`],
      ),
      width: widths[column] ?? widths[0] ?? QUAVER_DEFAULT_COLUMN_SIZE,
    });
  }

  if (pkg.format === "quaver" && lanes.every((l) => l.laneColour === null)) {
    assumptions.push("Quaver has no per-lane background colour; lanes are drawn on the stage background only.");
  }

  return {
    keymode,
    keys,
    lanes,
    spacing,
    hitPositionFromBottom,
    stageHint: resolve(pkg, index, config, "stageHint", keymode, keys, undefined, "1"),
    stageLeft: resolve(pkg, index, config, "stageLeft", keymode, keys, undefined, "1"),
    stageRight: resolve(pkg, index, config, "stageRight", keymode, keys, undefined, "1"),
    totalWidth: stageWidth(lanes.map((l) => l.width), spacing),
    assumptions,
  };
}

// ---------------------------------------------------------------- internals

function configFor(pkg: SkinPackage, keymode: string, keys: number): Record<string, string> {
  if (!pkg.ini) return {};
  const doc = pkg.ini;

  if (pkg.format === "osu") {
    const block = allSections(doc)
      .filter((s) => s.name.toLowerCase() === "mania")
      .find((s) => Number(get(doc, s, "Keys")) === keys);
    return block ? readSection(doc, block) : {};
  }

  const shared = allSections(doc).find((s) => s.name.toLowerCase() === "sharedk");
  const own = allSections(doc).find((s) => s.name.toUpperCase() === keymode.toUpperCase());
  return {
    ...(shared ? readSection(doc, shared) : {}),
    ...(own ? readSection(doc, own) : {}),
  };
}

function osuColumnWidths(config: Record<string, string>, keys: number): number[] {
  const list = parseNumberList(config["ColumnWidth"]).map(osuToQuaver);
  return padTo(list, keys, osuToQuaver(OSU_DEFAULT_COLUMN_WIDTH));
}

function padTo(list: number[], length: number, fallback: number): number[] {
  return Array.from({ length }, (_, i) => list[i] ?? list[list.length - 1] ?? fallback);
}

/**
 * Find the source file for one element in one lane, honouring osu!'s
 * `NoteImage{n}` overrides and its `@2x` variants, and Quaver's per-lane
 * filenames. Returns the entry path so the caller can look up the bytes.
 */
function resolve(
  pkg: SkinPackage,
  index: FileIndex,
  config: Record<string, string>,
  elementId: string,
  keymode: string,
  _keys: number,
  lane: number | undefined,
  token: string,
): string | null {
  const mapping = ELEMENTS.find((e) => e.id === elementId);
  if (!mapping) return null;

  if (pkg.format === "quaver") {
    const path = quaverPath(mapping, keymode, lane);
    if (!path) return null;
    const direct = index.get(path);
    if (direct) return direct.path;
    // Fall back to the shared keymode folder, as Quaver itself does.
    const shared = index.get(path.replace(/^\d{1,2}k\//i, "sharedk/"));
    return shared ? shared.path : null;
  }

  if (mapping.osu === null) return null;
  const column = (lane ?? 1) - 1;
  const override = mapping.osuIniKey
    ? config[mapping.osuIniKey.replace("{n}", String(column))]
    : undefined;
  const base = override ?? mapping.osu.replace("{token}", token);
  const found = index.findOsu(base) ?? { entry: index.findOsuFrames(base)[0] };
  return found?.entry?.path ?? null;
}

function quaverPath(mapping: ElementMapping, keymode: string, lane: number | undefined): string | null {
  if (mapping.quaver === null) return null;
  return mapping.quaver
    .replace("{keymode}", keymode.toLowerCase())
    .replace("{lane}", String(lane ?? 1));
}

/** osu! `ColumnStart` in 768-space, for callers that need absolute placement. */
export function osuColumnStart(config: Record<string, string>): number {
  return osuToQuaver(parseNumber(config["ColumnStart"]) ?? OSU_DEFAULT_COLUMN_START);
}

export { quaverToOsu };
