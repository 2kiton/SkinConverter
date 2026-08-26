/**
 * The conversion orchestrator.
 *
 * Reads a parsed skin, walks the element table for every keymode it declares,
 * and produces a new package in the other format plus a report of exactly what
 * happened to each element.
 *
 * Image processing is injected rather than imported so this module stays
 * runnable (and testable) outside a browser, where there is no canvas.
 */

import { serializeIni } from "../ini/document";
import { IniBuilder } from "../ini/build";
import { allSections, get, readSection } from "../ini/access";
import type { SkinEntry, SkinFormat, SkinPackage } from "../skin/types";
import { ELEMENTS, resolveOsuIniKey, type ElementMapping } from "./elements";
import { columnTokens, parseSpecialStyle, SpecialStyle } from "./lanes";
import {
  QUAVER_DEFAULT_COLUMN_SIZE,
  QUAVER_EQUIVALENT_BODY_STYLE,
  alignmentToColumnStart,
  collapseColumnWidths,
  columnStartToAlignment,
  formatRgba,
  hitPositionToOffset,
  offsetToHitPosition,
  osuToQuaver,
  parseNumber,
  parseNumberList,
  parseRgba,
  quaverToOsu,
  stageWidth,
  tidy,
  OSU_DEFAULT_COLUMN_WIDTH,
  OSU_DEFAULT_COLUMN_START,
  OSU_DEFAULT_HIT_POSITION,
  OSU_DEFAULT_LIGHT_POSITION,
} from "./geometry";
import { FileIndex, fallbackIndexFor, NO_FALLBACKS, type QuaverFallbacks } from "./files";
import { tally, type ConversionReport, type ReportEntry } from "./report";
import type { ImageProcessor } from "./images";
import { passthroughProcessor } from "./images";

export interface ConvertOptions {
  processor?: ImageProcessor;
  /**
   * Flip the long-note tail when converting.
   *
   * osu! flips `mania-note{n}T` by default from skin v2.5 while Quaver draws
   * `note-holdend` as authored, but the docs do not settle whether that makes
   * an unflipped copy correct in practice. Off by default: a wrong flip is
   * worse than an unflipped tail, and this is a switch the user can test.
   */
  flipHoldTail?: boolean;
}

export interface ConversionResult {
  pkg: SkinPackage;
  report: ConversionReport;
}

export async function convertSkin(source: SkinPackage, options: ConvertOptions = {}): Promise<ConversionResult> {
  const target: SkinFormat = source.format === "quaver" ? "osu" : "quaver";
  return source.format === "quaver"
    ? quaverToOsuSkin(source, options)
    : osuToQuaverSkin(source, options, target);
}

// ---------------------------------------------------------------- Quaver -> osu!

async function quaverToOsuSkin(source: SkinPackage, options: ConvertOptions): Promise<ConversionResult> {
  const proc = options.processor ?? passthroughProcessor;
  const index = new FileIndex(source.entries);
  const entries: SkinEntry[] = [];
  const report: ReportEntry[] = [];
  const warnings: string[] = [];

  const keymodes = quaverKeymodes(source);
  if (keymodes.length === 0) {
    warnings.push("No keymode sections found in skin.ini, so 4K was assumed.");
    keymodes.push({ label: "4K", keys: 4, folder: "4k", config: {}, fallbacks: NO_FALLBACKS });
  }

  const ini = new IniBuilder("osu");
  const general = source.ini ? findSection(source, "General") : {};
  ini.section("General")
    .pair("Name", general["Name"] ?? source.name)
    .pair("Author", general["Author"] ?? "")
    .pair("Version", "2.5");

  ini.section("Colours");
  ini.comment("Converted from a Quaver skin by QuaverMania.");

  for (const km of keymodes) {
    ini.section("Mania").pair("Keys", km.keys);

    const columnSize = parseNumber(km.config["ColumnSize"]) ?? QUAVER_DEFAULT_COLUMN_SIZE;
    const notePadding = parseNumber(km.config["NotePadding"]) ?? 0;
    const columnWidthOsu = quaverToOsu(columnSize);
    const spacingOsu = quaverToOsu(notePadding);
    const totalWidth = stageWidth(
      Array.from({ length: km.keys }, () => columnWidthOsu),
      Array.from({ length: km.keys - 1 }, () => spacingOsu),
    );

    const alignment = parseNumber(km.config["ColumnAlignment"]);
    const columnStart =
      alignment === null ? OSU_DEFAULT_COLUMN_START : alignmentToColumnStart(alignment, totalWidth);

    ini
      .pair("ColumnStart", tidy(columnStart))
      .pair("ColumnWidth", repeat(tidy(columnWidthOsu), km.keys))
      .pair("ColumnSpacing", repeat(tidy(spacingOsu), Math.max(0, km.keys - 1)))
      .pair("NoteBodyStyle", QUAVER_EQUIVALENT_BODY_STYLE);

    const hitOffset = parseNumber(km.config["HitPosOffsetY"]) ?? 0;
    ini.pair("HitPosition", tidy(offsetToHitPosition(hitOffset)));

    const lightOffset = parseNumber(km.config["ColumnLightingOffsetY"]);
    if (lightOffset !== null) {
      ini.pair("LightPosition", tidy(OSU_DEFAULT_LIGHT_POSITION + quaverToOsu(lightOffset)));
    }

    // ColumnColor{n} is the press-lighting tint, which is exactly ColourLight{n}.
    for (let lane = 1; lane <= km.keys; lane++) {
      const colour = parseRgba(km.config[`ColumnColor${lane}`]);
      if (colour) ini.pair(`ColourLight${lane}`, formatRgba(colour, false));
    }

    for (const mapping of ELEMENTS) {
      if (mapping.quaver === null) continue;

      if (mapping.osu === null) {
        report.push(entry(mapping, "dropped", { keymode: km.label, detail: mapping.note ?? "" }));
        continue;
      }

      const lanes = mapping.perLane ? range(1, km.keys) : [undefined];
      for (const lane of lanes) {
        const sourcePath = quaverPath(mapping, km, lane);
        if (!sourcePath) continue;

        const found = resolveQuaverSource(index, mapping, km, lane, sourcePath);
        if (!found) {
          report.push(entry(mapping, "missing", { keymode: km.label, ...(lane ? { lane } : {}), from: sourcePath }));
          continue;
        }

        // Give every lane its own file and point skin.ini straight at it. That
        // sidesteps osu!'s 1/2/S collapse entirely, so per-lane art survives.
        const outName = osuOutputName(mapping, km, lane);
        let bytes = found.entry.bytes;
        let status: ReportEntry["status"] = "copied";
        let detail: string | undefined;

        if (found.sheet) {
          const frames = await proc.sliceSheet(bytes, found.sheet.rows, found.sheet.cols);
          if (frames.length > 1) {
            frames.forEach((frame, i) => {
              entries.push({ path: `${stripExt(outName)}-${i}.png`, originalPath: found.entry.path, bytes: frame });
            });
            status = "processed";
            detail = `Sliced a ${found.sheet.rows}x${found.sheet.cols} spritesheet into ${frames.length} frames.`;
            report.push(
              entry(mapping, status, {
                keymode: km.label,
                ...(lane ? { lane } : {}),
                from: found.entry.path,
                to: `${stripExt(outName)}-0.png …`,
                ...(detail ? { detail } : {}),
              }),
            );
            writeImageKey(ini, mapping, lane, km, stripExt(outName));
            continue;
          }
          bytes = frames[0] ?? bytes;
        }

        if (mapping.id === "holdTail" && options.flipHoldTail) {
          bytes = await proc.flipVertical(bytes);
          status = "processed";
          detail = "Flipped vertically to match osu!'s default tail orientation.";
        }

        if (found.viaFallback) {
          detail = `Resolved through the sharedk fallback (${found.entry.path}).`;
        }

        entries.push({ path: outName, originalPath: found.entry.path, bytes });
        writeImageKey(ini, mapping, lane, km, stripExt(outName));
        report.push(
          entry(mapping, mapping.cost === "geometry" ? "configured" : status, {
            keymode: km.label,
            ...(lane ? { lane } : {}),
            from: found.entry.path,
            to: outName,
            ...(detail ? { detail } : {}),
          }),
        );
      }
    }
  }

  if (source.entries.some((e) => /note-mine/i.test(e.path))) {
    warnings.push("Mines are Quaver-only and were not carried across; osu!mania has no equivalent.");
  }
  const bgMask = source.entries.find((e) => /stage-bgmask\.png$/i.test(e.path));
  if (bgMask) {
    warnings.push(
      "The stage background image has no osu! counterpart. osu! tints lanes with Colour{n} instead — set those by hand.",
    );
  }
  if (!options.flipHoldTail) {
    warnings.push(
      "Long note tails were copied unflipped. osu! flips tails by default from skin v2.5 — if yours look wrong, re-run with the flip enabled.",
    );
  }

  const doc = ini.build();
  entries.push({ path: "skin.ini", originalPath: "skin.ini", bytes: encode(serializeIni(doc)) });

  return {
    pkg: {
      name: source.name,
      format: "osu",
      detection: { format: "osu", signals: [], ambiguous: false },
      entries,
      ini: doc,
      iniSource: serializeIni(doc),
      iniPath: "skin.ini",
      strippedRoot: null,
    },
    report: {
      from: "quaver",
      to: "osu",
      keymodes: keymodes.map((k) => k.label),
      entries: report,
      warnings,
      counts: tally(report),
    },
  };
}

// ---------------------------------------------------------------- osu! -> Quaver

async function osuToQuaverSkin(
  source: SkinPackage,
  options: ConvertOptions,
  _target: SkinFormat,
): Promise<ConversionResult> {
  const proc = options.processor ?? passthroughProcessor;
  const index = new FileIndex(source.entries);
  const entries: SkinEntry[] = [];
  const report: ReportEntry[] = [];
  const warnings: string[] = [];

  const blocks = osuManiaBlocks(source);
  if (blocks.length === 0) {
    warnings.push("No [Mania] sections found in skin.ini, so 4K was assumed from the default element names.");
    blocks.push({ keys: 4, config: {} });
  }

  const general = source.ini ? findSection(source, "General") : {};
  const ini = new IniBuilder("quaver");
  ini
    .section("General")
    .pair("Name", general["Name"] ?? source.name)
    .pair("Author", general["Author"] ?? "")
    .pair("Version", "1.0");
  ini.comment("Converted from an osu!mania skin by QuaverMania.");

  for (const block of blocks) {
    const keys = block.keys;
    const folder = `${keys}k`;
    const label = `${keys}K`;
    ini.section(label);

    const widths = parseNumberList(block.config["ColumnWidth"]);
    const collapsed = collapseColumnWidths(widths);
    if (!collapsed.uniform) {
      warnings.push(
        `${label}: osu! columns had differing widths (${widths.join(", ")}). Quaver uses one uniform ColumnSize, so ${collapsed.value} was used for every lane.`,
      );
    }
    ini.pair("ColumnSize", tidy(osuToQuaver(collapsed.value)));

    const spacings = parseNumberList(block.config["ColumnSpacing"]);
    if (spacings.length > 0) ini.pair("NotePadding", tidy(osuToQuaver(spacings[0] ?? 0)));

    const columnStart = parseNumber(block.config["ColumnStart"]) ?? OSU_DEFAULT_COLUMN_START;
    const total = stageWidth(
      widths.length > 0 ? widths : Array.from({ length: keys }, () => OSU_DEFAULT_COLUMN_WIDTH),
      spacings,
    );
    ini.pair("ColumnAlignment", tidy(columnStartToAlignment(columnStart, total)));

    const hitPosition = parseNumber(block.config["HitPosition"]) ?? OSU_DEFAULT_HIT_POSITION;
    ini.pair("HitPosOffsetY", tidy(hitPositionToOffset(hitPosition)));

    const lightPosition = parseNumber(block.config["LightPosition"]);
    if (lightPosition !== null) {
      ini.pair("ColumnLightingOffsetY", tidy(osuToQuaver(lightPosition - OSU_DEFAULT_LIGHT_POSITION)));
    }

    for (let column = 0; column < keys; column++) {
      const colour = parseRgba(block.config[`ColourLight${column + 1}`]);
      if (colour) ini.pair(`ColumnColor${column + 1}`, formatRgba(colour, true));
    }

    const laneColours = range(1, keys)
      .map((n) => parseRgba(block.config[`Colour${n}`]))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (laneColours.length > 0) {
      warnings.push(
        `${label}: osu! lane background colours (Colour1…) have no Quaver key. Quaver uses one stage-bgmask image instead, so they were not carried across.`,
      );
    }

    const style = parseSpecialStyle(block.config["SpecialStyle"]);
    if (style !== SpecialStyle.None) {
      warnings.push(
        `${label}: osu! marks a special column on the ${style === SpecialStyle.Left ? "left" : "right"}. Quaver's scratch lane is a separate texture index — check lane assignment in-game.`,
      );
    }
    const tokens = columnTokens(keys, style);

    for (const mapping of ELEMENTS) {
      if (mapping.osu === null) continue;

      if (mapping.quaver === null) {
        report.push(entry(mapping, "dropped", { keymode: label, detail: mapping.note ?? "" }));
        continue;
      }

      const lanes = mapping.perLane ? range(1, keys) : [undefined];
      for (const lane of lanes) {
        const column = lane === undefined ? 0 : lane - 1;
        const override = mapping.perLane
          ? block.config[resolveOsuIniKey(mapping, column) ?? ""]
          : mapping.osuIniKey
            ? block.config[mapping.osuIniKey]
            : undefined;

        const base = override ?? defaultOsuName(mapping, tokens[column] ?? "1");
        const frames = index.findOsuFrames(base);
        const still = index.findOsu(base);

        if (frames.length === 0 && !still) {
          report.push(entry(mapping, "missing", { keymode: label, ...(lane ? { lane } : {}), from: base }));
          continue;
        }

        const outPath = quaverOutputPath(mapping, folder, lane);
        if (!outPath) continue;

        if (frames.length > 1) {
          const packed = await proc.packSheet(frames.map((f) => f.bytes));
          const sheetPath = outPath.replace(/\.png$/i, `@${packed.rows}x${packed.cols}.png`);
          entries.push({ path: sheetPath, originalPath: frames[0]!.path, bytes: packed.bytes });
          report.push(
            entry(mapping, "processed", {
              keymode: label,
              ...(lane ? { lane } : {}),
              from: `${base}-0 … -${frames.length - 1}`,
              to: sheetPath,
              detail: `Packed ${frames.length} frames into a ${packed.rows}x${packed.cols} spritesheet.`,
            }),
          );
          continue;
        }

        const chosen = still ?? { entry: frames[0]!, hd: false };
        entries.push({ path: outPath, originalPath: chosen.entry.path, bytes: chosen.entry.bytes });
        report.push(
          entry(mapping, mapping.cost === "geometry" ? "configured" : "copied", {
            keymode: label,
            ...(lane ? { lane } : {}),
            from: chosen.entry.path,
            to: outPath,
            ...(chosen.hd ? { detail: "Used the @2x source; Quaver has no HD suffix and scales natively." } : {}),
          }),
        );
      }
    }
  }

  const bodyStyle = blocks[0]?.config["NoteBodyStyle"];
  if (bodyStyle !== undefined && bodyStyle.trim() !== "0") {
    warnings.push(
      `The source uses NoteBodyStyle ${bodyStyle}, which repeats the hold body. Quaver always stretches hold bodies, so long notes will look different.`,
    );
  }

  const doc = ini.build();
  entries.push({ path: "skin.ini", originalPath: "skin.ini", bytes: encode(serializeIni(doc)) });

  return {
    pkg: {
      name: source.name,
      format: "quaver",
      detection: { format: "quaver", signals: [], ambiguous: false },
      entries,
      ini: doc,
      iniSource: serializeIni(doc),
      iniPath: "skin.ini",
      strippedRoot: null,
    },
    report: {
      from: "osu",
      to: "quaver",
      keymodes: blocks.map((b) => `${b.keys}K`),
      entries: report,
      warnings,
      counts: tally(report),
    },
  };
}

// ---------------------------------------------------------------- helpers

interface QuaverKeymode {
  label: string;
  keys: number;
  folder: string;
  config: Record<string, string>;
  fallbacks: QuaverFallbacks;
}

function quaverKeymodes(source: SkinPackage): QuaverKeymode[] {
  if (!source.ini) return [];
  const shared = findSection(source, "SHAREDK");

  return allSections(source.ini)
    .filter((s) => /^\d{1,2}K$/i.test(s.name))
    .map((s) => {
      const own = readSection(source.ini!, s);
      const config = { ...shared, ...own };
      const keys = parseInt(s.name, 10);
      return {
        label: s.name.toUpperCase(),
        keys,
        folder: `${keys}k`,
        config,
        fallbacks: {
          useFallback: /^true$/i.test(config["UseFallback"] ?? ""),
          hitObject: parseNumberList(config["HitObjectFallbacks"]),
          holdBody: parseNumberList(config["HoldBodyFallbacks"]),
          holdEnd: parseNumberList(config["HoldEndFallbacks"]),
          receptor: parseNumberList(config["ReceptorFallbacks"]),
        },
      };
    });
}

interface OsuBlock {
  keys: number;
  config: Record<string, string>;
}

function osuManiaBlocks(source: SkinPackage): OsuBlock[] {
  if (!source.ini) return [];
  const doc = source.ini;
  return allSections(doc)
    .filter((s) => s.name.toLowerCase() === "mania")
    .map((s) => ({ keys: Number(get(doc, s, "Keys") ?? 0), config: readSection(doc, s) }))
    .filter((b) => Number.isFinite(b.keys) && b.keys > 0);
}

function findSection(source: SkinPackage, name: string): Record<string, string> {
  if (!source.ini) return {};
  const slice = allSections(source.ini).find((s) => s.name.toLowerCase() === name.toLowerCase());
  return slice ? readSection(source.ini, slice) : {};
}

function quaverPath(mapping: ElementMapping, km: QuaverKeymode, lane: number | undefined): string | null {
  if (mapping.quaver === null) return null;
  return mapping.quaver.replace("{keymode}", km.folder).replace("{lane}", String(lane ?? 1));
}

interface ResolvedSource {
  entry: SkinEntry;
  viaFallback: boolean;
  sheet?: { rows: number; cols: number };
}

function resolveQuaverSource(
  index: FileIndex,
  mapping: ElementMapping,
  km: QuaverKeymode,
  lane: number | undefined,
  primary: string,
): ResolvedSource | undefined {
  const sheet = mapping.quaverSheet
    ? index.findQuaverSheet(primary)
    : undefined;
  if (sheet) return { entry: sheet.entry, viaFallback: false, sheet: { rows: sheet.rows, cols: sheet.cols } };

  const direct = index.get(primary);
  if (direct) return { entry: direct, viaFallback: false };

  if (!km.fallbacks.useFallback) return undefined;

  const list = fallbackListFor(mapping.id, km.fallbacks);
  const sharedLane = lane === undefined ? 1 : fallbackIndexFor(list, lane);
  const sharedPath = (mapping.quaver ?? "")
    .replace("{keymode}", "sharedk")
    .replace("{lane}", String(sharedLane));
  const shared = index.get(sharedPath);
  return shared ? { entry: shared, viaFallback: true } : undefined;
}

function fallbackListFor(id: string, fallbacks: QuaverFallbacks): number[] {
  switch (id) {
    case "note":
    case "holdHead":
      return fallbacks.hitObject;
    case "holdBody":
      return fallbacks.holdBody;
    case "holdTail":
      return fallbacks.holdEnd;
    case "receptorUp":
    case "receptorDown":
      return fallbacks.receptor;
    default:
      return [];
  }
}

/**
 * Output filenames for osu!. Kept flat at the skin root and prefixed per
 * keymode, because osu! stable is unreliable about subfolders in skin.ini
 * image lookups.
 */
function osuOutputName(mapping: ElementMapping, km: QuaverKeymode, lane: number | undefined): string {
  const suffix = lane === undefined ? "" : `-${lane}`;
  return `qm-${km.folder}-${kebab(mapping.id)}${suffix}.png`;
}

function quaverOutputPath(mapping: ElementMapping, folder: string, lane: number | undefined): string | null {
  if (mapping.quaver === null) return null;
  return mapping.quaver.replace("{keymode}", folder).replace("{lane}", String(lane ?? 1));
}

function defaultOsuName(mapping: ElementMapping, token: string): string {
  return (mapping.osu ?? "").replace("{token}", token);
}

function writeImageKey(
  ini: IniBuilder,
  mapping: ElementMapping,
  lane: number | undefined,
  _km: QuaverKeymode,
  stem: string,
): void {
  if (!mapping.osuIniKey) return;
  const key = mapping.perLane
    ? mapping.osuIniKey.replace("{n}", String((lane ?? 1) - 1))
    : mapping.osuIniKey;
  ini.pair(key, stem);
}

function entry(
  mapping: ElementMapping,
  status: ReportEntry["status"],
  extra: Partial<ReportEntry>,
): ReportEntry {
  return {
    elementId: mapping.id,
    label: mapping.label,
    group: mapping.group,
    cost: mapping.cost,
    status,
    ...extra,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

function repeat(value: string, times: number): string {
  return Array.from({ length: Math.max(0, times) }, () => value).join(",");
}

function stripExt(name: string): string {
  return name.replace(/\.(png|jpe?g)$/i, "");
}

function kebab(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
