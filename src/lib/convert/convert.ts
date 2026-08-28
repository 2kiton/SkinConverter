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
  QUAVER_TO_OSU,
  OSU_TO_QUAVER,
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
  OSU_SCREEN_HEIGHT,
  OSU_WIDESCREEN_WIDTH,
} from "./geometry";
import { FileIndex, fallbackIndexFor, NO_FALLBACKS, type QuaverFallbacks } from "./files";
import {
  GRADES,
  QUAVER_ONLY_GRADES,
  osuGradePath,
  quaverGradePath,
} from "./grades";
import {
  HEALTH_PIECES,
  SUPPRESSED_OSU_PIECES,
  VERTICAL_TO_HORIZONTAL_DEGREES,
  isVertical,
  transparentPixel,
} from "./health";
import {
  FONT_FAMILIES,
  exportPrefix,
  glyphNames,
  osuGlyphPath,
  quaverGlyphPath,
} from "./fonts";
import { tally, type ConversionReport, type ReportEntry } from "./report";
import type { ImageProcessor, LaneSlot } from "./images";
import { passthroughProcessor } from "./images";

/**
 * Which osu! client the output is aimed at.
 *
 * lazer parses `[Mania]` geometry as floating point. osu!stable's parser is
 * integer-based for these keys, so a value like `ColumnWidth: 56.25` does not
 * survive it — the stage falls back to defaults and lands in the wrong place
 * at the wrong size. Rounding is the only difference between the two targets;
 * every file the converter writes is identical.
 */
export type OsuTarget = "lazer" | "stable";

export interface ConvertOptions {
  processor?: ImageProcessor;
  /** Defaults to `lazer`, which is the historical behaviour. */
  target?: OsuTarget;
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
  const consumed = new Set<string>();

  const target = options.target ?? "lazer";

  // osu! flips `mania-note{n}T` itself from skin version 2.5, which we
  // declare. A Quaver long note end points away from the receptors, so
  // shipping it as-authored lands it upside down, buried in the body, with
  // only its flat edge showing above — the thin line. Pre-flipping cancels
  // osu!'s flip out. lazer does not apply that flip, so it stays opt-in there.
  const flipTail = target === "stable" || (options.flipHoldTail ?? false);

  // osu!stable types its [Mania] keys individually. The position family is
  // int32 and a decimal makes stable reject the line outright:
  //
  //   Error in [Mania] Line 20: Expected type int32 (name = HitPosition)
  //
  // A rejected HitPosition means the hit line falls back to stable's default
  // while the receptors stay where the skin put them, so the hitbox no longer
  // lines up with the art. Width keys are NOT int32 — real stable skins ship
  // `ColumnWidth: 66.66` — so rounding is applied only where it is required.
  const pos = (value: number) => (target === "stable" ? Math.round(value) : value);

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

  ini.comment("Converted from a Quaver skin by QuaverMania.");

  // Fonts are global to the skin, so they are resolved once, before the
  // per-keymode blocks are written.
  const fontKeys: [string, string][] = [];
  for (const family of FONT_FAMILIES) {
    let found = 0;
    for (const glyph of glyphNames(family, "quaver")) {
      const src = index.get(quaverGlyphPath(family, glyph));
      if (!src) continue;
      const osuGlyph = family.symbols.find(([q]) => q === glyph)?.[1] ?? glyph;
      const outPath = osuGlyphPath(exportPrefix(family), osuGlyph);

      // The score and combo counters live in osu!'s HUD, which stays in the
      // 480-space skin.ini is written in — unlike the mania playfield, which
      // scales by STABLE_MAGIC_SCALE_FACTOR into 768-space. Glyphs copied
      // straight across therefore render 1.6x too large.
      const glyphHd = await proc.scaleBy(src.bytes, QUAVER_TO_OSU * 2);
      const glyphSd = await proc.scaleBy(src.bytes, QUAVER_TO_OSU);
      entries.push({ path: outPath, originalPath: src.path, bytes: glyphSd });
      entries.push({
        path: outPath.replace(/\.png$/i, "@2x.png"),
        originalPath: src.path,
        bytes: glyphHd,
      });
      consumed.add(src.path.toLowerCase());
      report.push({
        elementId: `font-${family.id}`,
        label: `${family.id === "combo" ? "Combo" : "Score"} font`,
        group: "judgements",
        cost: "identity",
        status: "processed",
        from: src.path,
        to: outPath,
        detail: "Scaled into osu!'s 480-space HUD, which does not use the playfield's 1.6x scaling.",
      });
      found++;
    }
    if (found > 0) fontKeys.push([family.osuPrefixKey, exportPrefix(family)]);
  }

  if (fontKeys.length > 0) {
    ini.section("Fonts");
    for (const [key, value] of fontKeys) ini.pair(key, value);
  }

  // Rank sprites, global rather than per keymode. Quaver's grade art is
  // small-format, matching osu!'s leaderboard variants; osu!'s results-screen
  // grades are far larger and are deliberately left to osu!'s own skin.
  for (const grade of GRADES) {
    const src = index.get(quaverGradePath(grade.quaver));
    if (!src) continue;

    // Grades sit in menus and the leaderboard, which stay in osu!'s 480-space
    // rather than the playfield's 768-space.
    const gradeHd = await proc.scaleBy(src.bytes, QUAVER_TO_OSU * 2);
    const gradeSd = await proc.scaleBy(src.bytes, QUAVER_TO_OSU);

    for (const name of grade.osu) {
      const outPath = osuGradePath(name);
      entries.push({ path: outPath, originalPath: src.path, bytes: gradeSd });
      entries.push({
        path: outPath.replace(/\.png$/i, "@2x.png"),
        originalPath: src.path,
        bytes: gradeHd,
      });
    }
    consumed.add(src.path.toLowerCase());

    report.push({
      elementId: `grade-${grade.quaver}`,
      label: grade.label,
      group: "judgements",
      cost: "identity",
      status: "processed",
      from: src.path,
      to: grade.osu.map(osuGradePath).join(", "),
      ...(grade.osu.length > 1
        ? { detail: "Fills both osu! variants; the silver one is earned with Hidden or Flashlight, which Quaver has no equivalent for." }
        : {}),
    });
  }

  for (const id of QUAVER_ONLY_GRADES) {
    if (!index.get(quaverGradePath(id))) continue;
    warnings.push(
      `Quaver's ${id.toUpperCase()} grade was not carried across — osu! has no failing rank and shows D instead, which is already taken by Quaver's own D.`,
    );
  }

  // Health bar, also global rather than per keymode.
  let healthFound = false;
  for (const piece of HEALTH_PIECES) {
    const src = index.get(piece.quaver);
    if (!src) continue;
    healthFound = true;

    let bytes = src.bytes;
    const notes: string[] = [];

    // Quaver's bar may be vertical; osu!'s scorebar is horizontal only.
    const size = await proc.measure(bytes);
    if (size && isVertical(size.width, size.height)) {
      bytes = await proc.rotate(bytes, VERTICAL_TO_HORIZONTAL_DEGREES);
      notes.push("rotated from vertical to osu!'s horizontal scorebar");
    }

    const hd = await proc.scaleBy(bytes, QUAVER_TO_OSU * 2);
    bytes = await proc.scaleBy(bytes, QUAVER_TO_OSU);
    notes.push("scaled into osu!'s 480-space HUD");
    const detail = notes.join("; ");

    entries.push({ path: piece.osu, originalPath: src.path, bytes });
    entries.push({ path: piece.osu.replace(/\.png$/i, "@2x.png"), originalPath: src.path, bytes: hd });
    consumed.add(src.path.toLowerCase());
    report.push({
      elementId: piece.id,
      label: piece.label,
      group: "stage",
      cost: "image",
      status: "processed",
      from: src.path,
      to: piece.osu,
      detail,
    });
  }

  if (healthFound) {
    // osu! substitutes its own art for a missing element but honours an empty
    // one, so blank the pieces Quaver has no counterpart for rather than let
    // osu!'s stock marker land on a converted skin.
    for (const path of SUPPRESSED_OSU_PIECES) {
      entries.push({ path, originalPath: "", bytes: transparentPixel() });
    }
    report.push({
      elementId: "healthExtras",
      label: "Health bar marker",
      group: "stage",
      cost: "none",
      status: "synthesized",
      to: SUPPRESSED_OSU_PIECES.join(", "),
      detail: "Blanked; osu! draws a marker and character that Quaver has no equivalent for.",
    });
  }

  // Sampled once and reused: the stage background is a single image for the
  // whole skin, not per keymode.
  const bgMask = source.entries.find((e) => /stage-bgmask\.png$/i.test(e.path));

  for (const km of keymodes) {
    ini.section("Mania").pair("Keys", km.keys);

    const columnSize = parseNumber(km.config["ColumnSize"]) ?? QUAVER_DEFAULT_COLUMN_SIZE;
    const notePadding = parseNumber(km.config["NotePadding"]) ?? 0;

    // Widths and gaps are rounded first, not just on the way out, so the
    // stage width and starting edge are derived from the same numbers the
    // client will actually read. Rounding only at print time would leave the
    // stage a few pixels off-centre.
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
      .pair("ColumnWidth", repeat(tidy(columnWidthOsu), km.keys))
      .pair("ColumnSpacing", repeat(tidy(spacingOsu), Math.max(0, km.keys - 1)))
      .pair("NoteBodyStyle", QUAVER_EQUIVALENT_BODY_STYLE);

    // lazer ignores ColumnStart and centres the stage itself; stable takes it
    // literally, in a space that is 853 units wide on 16:9 rather than 640.
    // Centring against 640 therefore looks perfect on lazer and sits 107
    // units left of centre on stable.
    ini.pair(
      "ColumnStart",
      tidy(target === "stable" ? (OSU_WIDESCREEN_WIDTH - totalWidth) / 2 : columnStart),
    );

    if (target === "stable") {
      // Zeroing the widths is how working stable skins hide the column
      // separators and barlines; stable does not honour a transparent
      // ColourColumnLine the way lazer does. ColumnLineWidth takes one more
      // value than there are columns, for the edges.
      ini
        .pair("ColumnLineWidth", repeat("0", km.keys + 1))
        .pair("BarlineHeight", 0)
        // Barlines are the measure separators osu! draws across the stage,
        // and ColourBarline defaults to opaque white. Quaver draws no such
        // line. A zero BarlineHeight is not enough on its own — a working
        // stable skin hides them with a fully transparent colour, which is
        // what this matches.
        //
        // They read as "a line at the end of every long note" because long
        // notes almost always end on a beat boundary, which is precisely
        // where a barline falls.
        .pair("ColourBarline", "0,0,0,0")
        .pair("JudgementLine", 0);
    }

    // Absent means Quaver's default of True; only an explicit False counts.
    const drawsLongNoteEnd = /^false$/i.test(km.config["DrawLongNoteEnd"] ?? "") ? false : true;

    const hitOffset = parseNumber(km.config["HitPosOffsetY"]) ?? 0;

    // Quaver centres the receptor ON the hit position. osu! anchors the key
    // area to the bottom of the stage and puts the hit position at its top
    // edge, so the two only line up if HitPosition is pulled down by half the
    // receptor's height. Without this the judgement line sits above the
    // receptors by however tall they are.
    const receptorSize = await measureReceptor(index, proc, km);
    const halfReceptorOsu = receptorSize
      ? quaverToOsu((columnSize * (receptorSize.height / receptorSize.width)) / 2)
      : 0;
    const hitPosition = receptorSize
      ? OSU_SCREEN_HEIGHT - halfReceptorOsu + quaverToOsu(hitOffset)
      : offsetToHitPosition(hitOffset);
    ini.pair("HitPosition", tidy(pos(hitPosition)));

    // Quaver centres the judgement burst on the playfield's mid-point;
    // osu!'s ScorePosition default of 300 sits at 62% down instead.
    const burstOffset = parseNumber(km.config["JudgementBurstPosY"]) ?? 0;
    ini.pair("ScorePosition", tidy(pos(OSU_SCREEN_HEIGHT / 2 + quaverToOsu(burstOffset))));

    const lightOffset = parseNumber(km.config["ColumnLightingOffsetY"]);
    if (lightOffset !== null) {
      ini.pair("LightPosition", tidy(pos(OSU_DEFAULT_LIGHT_POSITION + quaverToOsu(lightOffset))));
    }

    // Quaver draws no separator between columns, but osu!'s ColourColumnLine
    // defaults to opaque white — which is where the white lane dividers in a
    // converted skin come from. Make them transparent.
    ini.pair("ColourColumnLine", "0,0,0,0");

    // ColumnColor{n} is the press-lighting tint, which is exactly ColourLight{n}.
    for (let lane = 1; lane <= km.keys; lane++) {
      const colour = parseRgba(km.config[`ColumnColor${lane}`]);
      if (colour) ini.pair(`ColourLight${lane}`, formatRgba(colour, false));
    }

    // Synthesis: Quaver paints one image behind the whole stage, osu! tints
    // each lane with Colour{n}. Averaging the mask under each lane recovers
    // the part of that image osu! is able to express.
    let painted = false;
    if (bgMask) {
      const slots = laneSlots(km.keys, columnSize, notePadding);
      const sampled = await proc.sampleLaneColours(bgMask.bytes, slots, slotsWidth(slots));
      const usable = sampled.filter((c) => c !== null && c.a > 8);

      if (usable.length > 0) {
        sampled.forEach((colour, i) => {
          if (colour && colour.a > 8) ini.pair(`Colour${i + 1}`, formatRgba(colour, true));
        });
        report.push({
          elementId: "stageBgMask",
          label: "Lane background colours",
          group: "stage",
          cost: "lossy",
          status: "synthesized",
          keymode: km.label,
          from: bgMask.path,
          to: "skin.ini Colour1…",
          detail: "Averaged the stage background under each lane into osu!'s per-lane Colour keys.",
        });
        consumed.add(bgMask.path.toLowerCase());
        painted = true;
      }
    }

    // Quaver's stage is a flat black field behind the notes. Say so
    // explicitly rather than trusting osu!'s default to match.
    if (!painted) {
      for (let lane = 1; lane <= km.keys; lane++) ini.pair(`Colour${lane}`, "0,0,0,255");
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
        // Written alongside the standard file rather than instead of it. osu!
        // prefers `name@2x` and halves its display size, but whether a given
        // build resolves an HD-only element that way is not something the
        // docs settle — shipping both makes the on-screen size identical
        // either way, and costs a few KB.
        let hdBytes: Uint8Array | null = null;

        if (found.sheet) {
          const frames = await proc.sliceSheet(bytes, found.sheet.rows, found.sheet.cols);
          if (frames.length > 1) {
            frames.forEach((frame, i) => {
              entries.push({ path: `${stripExt(outName)}-${i}.png`, originalPath: found.entry.path, bytes: frame });
              consumed.add(found.entry.path.toLowerCase());
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

        // Quaver's DrawLongNoteEnd, when False, means the game never renders
        // the long note end at all — so the file in the skin may be a
        // leftover or a placeholder that was never meant to be seen. osu! has
        // no such switch and will happily draw it, which is where a stray bar
        // at the top of every long note comes from. Blank it instead: osu!
        // substitutes its own default for a MISSING element but honours an
        // empty one.
        if (mapping.id === "holdTail" && drawsLongNoteEnd === false) {
          // Same dimensions, no pixels. osu! sizes the hold body relative to
          // the tail, so collapsing it to a single pixel would shorten the
          // body and expose osu!'s own art behind it. A real transparent image
          // is written rather than the reference dropped, because osu!
          // substitutes its own default art for a MISSING element.
          const size = await proc.measure(bytes);
          bytes = size ? await proc.laneStripes([], size.width, size.height) : transparentPixel();
          status = "approximated";
          detail =
            "Blanked: the source skin sets DrawLongNoteEnd = False, so Quaver never draws this and osu! has no equivalent switch.";
        } else if (mapping.id === "holdTail") {
          if (flipTail) {
            bytes = await proc.flipVertical(bytes);
            status = "processed";
            detail =
              target === "stable"
                ? "Pre-flipped: osu!stable flips the tail itself at skin version 2.5, which would otherwise turn the end upside down into the body."
                : "Flipped vertically to match osu!'s default tail orientation.";
          }

          // osu!stable seats the tail slightly below where it ends the body,
          // leaving a strip of body uncovered above it — the thin line over
          // every long note. No skin.ini key moves the tail, but a taller
          // sprite drawn from the same anchor puts its content higher, so the
          // gap is closed by padding above it. Padding goes on last, after any
          // flip, so it is always the top edge of the exported image no matter
          // which way round the art ended up.
          //
          // The lift is the body's own height, which is what the exposed strip
          // measures in game, converted into the tail's pixel scale since the
          // two images are scaled independently to the column width.
          const lift = target === "stable" ? await tailLift(index, proc, km, lane, bytes) : 0;
          if (lift > 0) {
            bytes = await proc.padTop(bytes, lift);
            status = "processed";
            detail = `Lifted ${lift}px; osu!stable seats the tail below the end of the body and leaves a strip of it showing.`;
          }
        }

        // Quaver rotates arrow skins per lane at runtime; osu! has no rotation
        // key, so the rotation has to be baked into each lane's pixels or
        // every arrow points the same way.
        const rotation = rotationFor(mapping.id, km, lane);
        if (rotation !== 0) {
          bytes = await proc.rotate(bytes, rotation);
          status = "processed";
          detail = `Baked ${rotation}° of per-lane rotation into the image.`;
        }

        // Sizing, per osu!'s own drawing rules:
        //
        //   Notes      LegacyNotePiece scales uniformly by DrawWidth/texture
        //              width, so aspect is kept and texture size is irrelevant.
        //   Receptors  LegacyKeyArea gives the sprite RelativeSizeAxes.X with
        //              Width = 1, leaving height ABSOLUTE at the texture's own
        //              height. Width is forced to the column, height is not —
        //              so the texture has to be sized so its width equals the
        //              column width, or the key renders vertically stretched.
        //   Native     Stage borders scale (1, DrawHeight/Height): X scale is
        //              1, so on-screen width is the raw texture width. Same for
        //              judgements. Quaver art is drawn in a 768-high space and
        //              osu! in a 480-high one, so it lands 1.6x too big unless
        //              it is scaled by 0.625.
        //
        // Emitting at @2x doubles the pixels for the same on-screen size, so
        // the downscale does not cost resolution.
        if (mapping.osuSizing === "keyArea") {
          // osu!'s playfield works in 768-space, not the 480-space skin.ini is
          // written in: LegacyManiaSkinConfiguration stores the default column
          // as `30 * STABLE_MAGIC_SCALE_FACTOR` = 48, so a ColumnWidth of 30
          // becomes 48 internally. Texture pixels map to those internal units,
          // which means the key texture has to be as wide as the column in
          // 768-space — and that is exactly Quaver's own ColumnSize. Sizing to
          // the 480-space number instead left the texture 1.6x too short, and
          // since osu! forces the width but not the height, the key rendered
          // that much too wide.
          hdBytes = await proc.resizeToWidth(bytes, columnSize * 2);
          bytes = await proc.resizeToWidth(bytes, columnSize);
          status = "processed";
          detail = `Sized to the ${tidy(columnSize)}-unit column; osu! forces key width but leaves height native.`;
        } else if (mapping.osuSizing === "native") {
          hdBytes = await proc.scaleBy(bytes, QUAVER_TO_OSU * 2);
          bytes = await proc.scaleBy(bytes, QUAVER_TO_OSU);
          status = "processed";
          detail = "Scaled from Quaver's 768-high space into osu!'s 480-high one.";
        }

        if (found.viaFallback) {
          detail = `Resolved through the sharedk fallback (${found.entry.path}).`;
        }

        // `geometry` elements report as "configured" only when nothing else
        // happened to them; actual pixel work outranks the default.
        const reported = status !== "copied" ? status : mapping.cost === "geometry" ? "configured" : status;

        entries.push({ path: outName, originalPath: found.entry.path, bytes });
        if (hdBytes) {
          entries.push({
            path: `${stripExt(outName)}@2x.png`,
            originalPath: found.entry.path,
            bytes: hdBytes,
          });
        }
        const emitted = outName;
        consumed.add(found.entry.path.toLowerCase());
        writeImageKey(ini, mapping, lane, km, stripExt(outName));
        report.push(
          entry(mapping, reported, {
            keymode: km.label,
            ...(lane ? { lane } : {}),
            from: found.entry.path,
            to: emitted,
            ...(detail ? { detail } : {}),
          }),
        );
      }
    }
  }

  if (target === "stable") {
    warnings.push(
      "Built for osu!stable: HitPosition, ScorePosition and LightPosition are rounded because stable types them as int32 and rejects the whole line otherwise; ColumnStart centres the stage in the 16:9 space stable actually draws into; separators are hidden with ColumnLineWidth, and barlines with a transparent ColourBarline. lazer accepts decimals and ignores ColumnStart entirely, which is why a lazer build looks right there and not on stable.",
    );
  }

  for (const km of keymodes) {
    if (/^false$/i.test(km.config["DrawLongNoteEnd"] ?? "")) {
      warnings.push(
        `${km.label}: the source sets DrawLongNoteEnd = False, which Quaver honours by drawing no long note end. osu! has no such switch, so the end was blanked rather than left to show art the source never displays.`,
      );
    }
  }

  warnings.push(...rotationWarnings(keymodes));

  if (source.entries.some((e) => /note-mine/i.test(e.path))) {
    warnings.push("Mines are Quaver-only and were not carried across; osu!mania has no equivalent.");
  }

  if (bgMask && !report.some((e) => e.status === "synthesized")) {
    warnings.push(
      "The stage background image could not be sampled into per-lane colours; osu! will use its default lane backgrounds.",
    );
  }
  if (!options.flipHoldTail) {
    warnings.push(
      "Long note tails were copied unflipped. osu! flips tails by default from skin v2.5 — if yours look wrong, re-run with the flip enabled.",
    );
  }

  report.push(...carryRemainder(source, entries, consumed));

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
  const consumed = new Set<string>();

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

  // Fonts are global, and osu! names them by prefix rather than by a fixed
  // filename, so the prefix has to be read before the glyphs can be found.
  // Both prefixes default to "score", which means one osu! font commonly
  // feeds both of Quaver's separate combo and score fonts.
  const fonts = source.ini ? findSection(source, "Fonts") : {};
  for (const family of FONT_FAMILIES) {
    const prefix = fonts[family.osuPrefixKey]?.trim() || family.osuDefaultPrefix;
    for (const glyph of glyphNames(family, "osu")) {
      const found = index.findOsu(osuGlyphPath(prefix, glyph));
      if (!found) continue;
      const quaverGlyph = family.symbols.find(([, o]) => o === glyph)?.[0] ?? glyph;
      const outPath = quaverGlyphPath(family, quaverGlyph);
      if (entries.some((e) => e.path.toLowerCase() === outPath.toLowerCase())) continue;

      entries.push({ path: outPath, originalPath: found.entry.path, bytes: found.entry.bytes });
      consumed.add(found.entry.path.toLowerCase());
      report.push({
        elementId: `font-${family.id}`,
        label: `${family.id === "combo" ? "Combo" : "Score"} font`,
        group: "judgements",
        cost: "identity",
        status: "copied",
        from: found.entry.path,
        to: outPath,
      });
    }
  }

  for (const grade of GRADES) {
    // The first osu! name is the primary one; SH/XH are silver variants of it.
    const primary = grade.osu[0]!;
    const found = index.findOsu(osuGradePath(primary));
    if (!found) continue;

    const outPath = quaverGradePath(grade.quaver);
    if (entries.some((e) => e.path.toLowerCase() === outPath.toLowerCase())) continue;

    const bytes = await proc.scaleBy(found.entry.bytes, OSU_TO_QUAVER);
    entries.push({ path: outPath, originalPath: found.entry.path, bytes });
    consumed.add(found.entry.path.toLowerCase());
    report.push({
      elementId: `grade-${grade.quaver}`,
      label: grade.label,
      group: "judgements",
      cost: "identity",
      status: "processed",
      from: found.entry.path,
      to: outPath,
      detail: "Scaled from osu!'s 480-space into Quaver's 768-high one.",
    });
  }

  if (GRADES.some((g) => index.findOsu(osuGradePath(g.osu[0]!)))) {
    warnings.push(
      "Quaver's F grade has no osu! source — osu! has no failing rank — so it will fall back to Quaver's default.",
    );
  }

  for (const piece of HEALTH_PIECES) {
    const found = index.findOsu(piece.osu);
    if (!found) continue;
    // osu! authors in a 480-high space and Quaver draws at native size in a
    // 768-high one, so the bar has to grow to keep the same screen presence.
    const bytes = await proc.scaleBy(found.entry.bytes, OSU_TO_QUAVER);
    entries.push({ path: piece.quaver, originalPath: found.entry.path, bytes });
    consumed.add(found.entry.path.toLowerCase());
    report.push({
      elementId: piece.id,
      label: piece.label,
      group: "stage",
      cost: "image",
      status: "processed",
      from: found.entry.path,
      to: piece.quaver,
      detail: "Scaled from osu!'s 480-high space into Quaver's 768-high one.",
    });
  }

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

    // Synthesis: osu! tints each lane with Colour{n}; Quaver has no such key,
    // but it does draw one image behind the stage. Painting the lane colours
    // into that image is the only way they survive.
    const laneColours = range(1, keys).map((n) => parseRgba(block.config[`Colour${n}`]));
    if (laneColours.some((c) => c !== null)) {
      const quaverWidths = (widths.length > 0 ? widths : Array.from({ length: keys }, () => collapsed.value)).map(
        osuToQuaver,
      );
      const slots = laneColours.map((colour, i) => ({
        x: quaverWidths.slice(0, i).reduce((n, w) => n + w, 0) + i * osuToQuaver(spacings[0] ?? 0),
        width: quaverWidths[i] ?? osuToQuaver(collapsed.value),
        colour,
      }));
      const total = slotsWidth(slots);
      const mask = await proc.laneStripes(slots, Math.round(total), 512);

      if (mask.length > 0) {
        const maskPath = `${folder}/Stage/stage-bgmask.png`;
        entries.push({ path: maskPath, originalPath: "skin.ini", bytes: mask });
        ini.pair("BgMaskAlpha", "1.0");
        report.push({
          elementId: "stageBgMask",
          label: "Lane background colours",
          group: "stage",
          cost: "lossy",
          status: "synthesized",
          keymode: label,
          from: "skin.ini Colour1…",
          to: maskPath,
          detail: "Painted osu!'s per-lane colours into a Quaver stage background image.",
        });
      } else {
        warnings.push(
          `${label}: osu! lane background colours (Colour1…) have no Quaver key and could not be rendered into a stage background.`,
        );
      }
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
          for (const f of frames) consumed.add(f.path.toLowerCase());
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
        let bytes = chosen.entry.bytes;
        let status: ReportEntry["status"] = mapping.cost === "geometry" ? "configured" : "copied";
        let detail = chosen.hd
          ? "Used the @2x source; Quaver has no HD suffix and scales natively."
          : undefined;

        // The mirror of the outbound case: osu! stretched this key image to
        // its column box, and Quaver will not. Baking the stretch in is what
        // makes the receptor look the same in Quaver as it did in osu!.
        if (mapping.id === "receptorUp" || mapping.id === "receptorDown") {
          const boxHeight = OSU_SCREEN_HEIGHT - hitPosition;
          const boxWidth = widths[column] ?? collapsed.value;
          if (boxHeight > 0 && boxWidth > 0) {
            bytes = await proc.stretchToAspect(bytes, boxWidth / boxHeight);
            status = "processed";
            detail = "Baked in osu!'s key-box stretch, which Quaver does not apply.";
          }
        }

        entries.push({ path: outPath, originalPath: chosen.entry.path, bytes });
        consumed.add(chosen.entry.path.toLowerCase());
        report.push(
          entry(mapping, status, {
            keymode: label,
            ...(lane ? { lane } : {}),
            from: chosen.entry.path,
            to: outPath,
            ...(detail ? { detail } : {}),
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

  report.push(...carryRemainder(source, entries, consumed));

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

/**
 * Measure a keymode's first receptor, so the hit position can be aligned to
 * its centre. Returns null when the skin ships none, or when the processor
 * cannot decode images (the headless one used in tests).
 */
async function measureReceptor(
  index: FileIndex,
  proc: ImageProcessor,
  km: QuaverKeymode,
): Promise<{ width: number; height: number } | null> {
  const entry =
    index.get(`${km.folder}/Receptors/receptor-up-1.png`) ??
    index.get("sharedk/Receptors/receptor-up-1.png");
  if (!entry) return null;
  const size = await proc.measure(entry.bytes);
  return size && size.width > 0 ? size : null;
}

/**
 * A small extra lift on top of the body-height term, as a fraction of the
 * tail's width.
 *
 * The exposed strip measures about one body height, but covering exactly that
 * still left a couple of pixels showing in game — stable seats the tail a
 * little low on top of the overhang. Expressed against the tail's width rather
 * than as a pixel count so it holds at any source resolution.
 *
 * Tuned in game. If it needs adjusting, err high: overshooting leaves a
 * one-pixel transparent gap that shows the (usually dark) lane, while
 * undershooting leaves a strip of the body, which is bright and is the exact
 * artefact this exists to remove.
 */
const TAIL_SEATING_BIAS = 0.018;

/**
 * How far the long note tail has to rise to cover the body strip stable
 * leaves exposed above it, in the tail image's own pixels.
 *
 * Returns 0 for lazer, which seats the tail correctly, and whenever either
 * image cannot be measured.
 */
async function tailLift(
  index: FileIndex,
  proc: ImageProcessor,
  km: QuaverKeymode,
  lane: number | undefined,
  tailBytes: Uint8Array,
): Promise<number> {
  const bodyEntry =
    index.get(`${km.folder}/HitObjects/note-holdbody-${lane ?? 1}.png`) ??
    index.get(`sharedk/HitObjects/note-holdbody-${lane ?? 1}.png`);
  if (!bodyEntry) return 0;

  const body = await proc.measure(bodyEntry.bytes);
  const tail = await proc.measure(tailBytes);
  if (!body || !tail || body.width <= 0) return 0;

  // Both are scaled independently to the column width, so the body's height
  // has to be re-expressed in the tail's pixels before it means anything.
  const overhang = body.height * (tail.width / body.width);
  return Math.round(overhang + tail.width * TAIL_SEATING_BIAS);
}

/** Evenly spaced lane slots for a keymode, starting at x = 0. */
function laneSlots(keys: number, width: number, spacing: number): LaneSlot[] {
  return Array.from({ length: keys }, (_, i) => ({
    x: i * (width + spacing),
    width,
    colour: null,
  }));
}

function slotsWidth(slots: LaneSlot[]): number {
  const last = slots[slots.length - 1];
  return last ? last.x + last.width : 0;
}

/**
 * Per-lane rotation Quaver applies at runtime, in degrees.
 *
 * Only an explicit `HitObjectRotations` / `ReceptorRotations` list is honoured.
 * `RotateHitObjectsByColumn` on its own makes Quaver use built-in per-keymode
 * defaults that are not documented anywhere, and guessing them would rotate
 * every arrow in the skin the wrong way — so that case is warned about
 * instead, in `rotationWarnings`.
 */
function rotationFor(elementId: string, km: QuaverKeymode, lane: number | undefined): number {
  if (lane === undefined) return 0;

  const key =
    elementId === "receptorUp" || elementId === "receptorDown"
      ? "ReceptorRotations"
      : elementId === "note" || elementId === "holdHead" || elementId === "holdTail"
        ? "HitObjectRotations"
        : null;
  if (key === null) return 0;

  const list = parseNumberList(km.config[key]);
  return list[lane - 1] ?? 0;
}

function rotationWarnings(keymodes: QuaverKeymode[]): string[] {
  const out: string[] = [];
  for (const km of keymodes) {
    const rotatesNotes = /^true$/i.test(km.config["RotateHitObjectsByColumn"] ?? "");
    const rotatesReceptors = /^true$/i.test(km.config["RotateReceptorsByColumn"] ?? "");
    const hasNoteList = parseNumberList(km.config["HitObjectRotations"]).length > 0;
    const hasReceptorList = parseNumberList(km.config["ReceptorRotations"]).length > 0;

    if ((rotatesNotes && !hasNoteList) || (rotatesReceptors && !hasReceptorList)) {
      out.push(
        `${km.label}: the skin rotates elements by column but gives no explicit rotation list. Quaver's built-in defaults are undocumented, so nothing was rotated — arrow skins will need HitObjectRotations set by hand.`,
      );
    }
  }
  return out;
}

/**
 * Copy through every source file no mapping claimed.
 *
 * A skin is more than its playfield: hitsounds, backgrounds, cursors, combo
 * digits and the health bar all live in files this converter has no mapping
 * for. Emitting only mapped elements silently produced a skin with no sound
 * and no HUD, so anything unclaimed is carried across at its original path
 * and listed in the report.
 *
 * The path is NOT remapped — the destination game very likely does not read
 * that location — but the asset survives for the user to place by hand, which
 * beats deleting it without a word.
 */
function carryRemainder(
  source: SkinPackage,
  entries: SkinEntry[],
  consumed: Set<string>,
): ReportEntry[] {
  const out: ReportEntry[] = [];
  const taken = new Set(entries.map((e) => e.path.toLowerCase()));

  for (const entry of source.entries) {
    const key = entry.path.toLowerCase();
    if (key === "skin.ini" || consumed.has(key)) continue;
    // Never let a carried file shadow something the conversion produced.
    if (taken.has(key)) continue;

    entries.push({ path: entry.path, originalPath: entry.path, bytes: entry.bytes });
    out.push({
      elementId: "carried",
      label: describeCarried(entry.path),
      group: "stage",
      cost: "none",
      status: "carried",
      from: entry.path,
      to: entry.path,
    });
  }
  return out;
}

function describeCarried(path: string): string {
  const lower = path.toLowerCase();
  if (/\.(wav|ogg|mp3)$/.test(lower)) return "Sound effect";
  if (/(^|\/)backgrounds?\//.test(lower)) return "Background";
  if (/(^|\/)numbers?\//.test(lower) || /(^|\/)(score|combo)-/.test(lower)) return "Number font";
  if (/(^|\/)health\//.test(lower)) return "Health bar";
  if (/(^|\/)grades?\//.test(lower)) return "Grade";
  if (/cursor/.test(lower)) return "Cursor";
  if (/(^|\/)(menu|mainmenu|pause|skip|scoreboard|hitbubbles|judgements?)\//.test(lower)) return "Interface";
  if (/note-mine/.test(lower)) return "Mine (Quaver only)";
  if (/(^|\/)lanecover\//.test(lower)) return "Lane cover (Quaver only)";
  return "Unmapped file";
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
