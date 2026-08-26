import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readSkin } from "../skin/read";
import { convertSkin } from "./convert";
import type { SkinPackage } from "../skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * A skin is more than its playfield. An earlier build emitted only files that
 * matched a row in the element table, which silently produced skins with no
 * hitsounds, no combo digits and no health bar — and said nothing about it in
 * the report. The sample skins are pure playfield, so they never caught it.
 */
async function build(name: string, paths: string[], ini: string): Promise<SkinPackage> {
  const zip = new JSZip();
  for (const path of paths) zip.file(path, PNG);
  zip.file("skin.ini", ini);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return readSkin(new File([bytes], name));
}

const QUAVER_INI = "[General]\r\nName = T\r\n\r\n[4K]\r\nColumnSize = 90\r\n";

/** Files with no mapping at all — these must be carried through verbatim. */
const EXTRAS = [
  "SFX/hitsound.wav",
  "SFX/combobreak.wav",
  "Backgrounds/bg.jpg",
  "cursor.png",
  "steam_workshop_preview.png",
];

/** These DO have mappings, so they are converted rather than carried. */
const FONTS = ["Numbers/combo-0.png", "Numbers/score-0.png"];
const HEALTH = ["Health/health-background.png", "Health/health-foreground.png"];
const GRADES = ["Grades/grade-small-s.png", "Grades/grade-small-x.png"];

describe("non-playfield files", () => {
  it("carries every unmapped file through instead of dropping it", async () => {
    const src = await build("t.qs", ["4k/HitObjects/note-hitobject-1.png", ...EXTRAS], QUAVER_INI);
    const { pkg } = await convertSkin(src);

    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    for (const path of EXTRAS) {
      expect(out.has(path.toLowerCase()), `${path} should survive the conversion`).toBe(true);
    }
  });

  it("converts the health bar onto osu!'s scorebar", async () => {
    const src = await build("t.qs", [...HEALTH, ...EXTRAS], QUAVER_INI);
    const { pkg, report } = await convertSkin(src);

    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    expect(out.has("scorebar-bg.png")).toBe(true);
    expect(out.has("scorebar-colour.png")).toBe(true);
    expect(out.has("health/health-background.png")).toBe(false);

    // osu! substitutes its own marker for a missing file, so it is blanked.
    expect(out.has("scorebar-marker.png")).toBe(true);
    expect(report.entries.some((e) => e.elementId === "healthExtras")).toBe(true);
  });

  it("converts rank sprites onto osu!'s leaderboard grades", async () => {
    const src = await build("t.qs", [...GRADES, ...EXTRAS], QUAVER_INI);
    const { pkg } = await convertSkin(src);

    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    expect(out.has("ranking-s-small.png")).toBe(true);
    expect(out.has("ranking-x-small.png")).toBe(true);
    expect(out.has("grades/grade-small-s.png")).toBe(false);
  });

  it("converts number fonts rather than carrying them", async () => {
    const src = await build("t.qs", [...FONTS, ...EXTRAS], QUAVER_INI);
    const { pkg, report } = await convertSkin(src);

    // Quaver's Numbers/ folder maps onto osu!'s [Fonts] prefixes, so these
    // are remapped to a real osu! filename instead of left where they were.
    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    expect(out.has("qm-combo-0.png")).toBe(true);
    expect(out.has("qm-score-0.png")).toBe(true);
    expect(out.has("numbers/combo-0.png")).toBe(false);

    // Rescaled into osu!'s 480-space HUD, so they count as processed.
    const fontRows = report.entries.filter((e) => e.elementId.startsWith("font-"));
    expect(fontRows.length).toBeGreaterThan(0);
    expect(fontRows.every((r) => r.status === "processed")).toBe(true);
  });

  it("lists them in the report rather than carrying them silently", async () => {
    const src = await build("t.qs", ["4k/HitObjects/note-hitobject-1.png", ...EXTRAS], QUAVER_INI);
    const { report } = await convertSkin(src);

    expect(report.counts.carried).toBe(EXTRAS.length);
    const carried = report.entries.filter((e) => e.status === "carried");
    expect(new Set(carried.map((e) => e.from))).toEqual(new Set(EXTRAS));
  });

  it("labels what each carried file is, so the list is readable", async () => {
    const src = await build("t.qs", EXTRAS, QUAVER_INI);
    const { report } = await convertSkin(src);
    const labelFor = (path: string) =>
      report.entries.find((e) => e.from === path)?.label;

    expect(labelFor("SFX/hitsound.wav")).toBe("Sound effect");
    expect(labelFor("Backgrounds/bg.jpg")).toBe("Background");
    expect(labelFor("cursor.png")).toBe("Cursor");
    expect(labelFor("steam_workshop_preview.png")).toBe("Unmapped file");
  });

  it("does not carry a file it already converted", async () => {
    const src = await build(
      "t.qs",
      [1, 2, 3, 4].map((n) => `4k/HitObjects/note-hitobject-${n}.png`),
      QUAVER_INI,
    );
    const { pkg, report } = await convertSkin(src);

    // Sources that fed a mapped element must not reappear at their old path.
    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    expect(out.has("4k/hitobjects/note-hitobject-1.png")).toBe(false);
    expect(report.counts.carried).toBe(0);
  });

  it("never emits two entries for the same output path", async () => {
    const src = await build("t.qs", ["4k/HitObjects/note-hitobject-1.png", ...EXTRAS], QUAVER_INI);
    const { pkg } = await convertSkin(src);

    const paths = pkg.entries.map((e) => e.path.toLowerCase());
    expect(paths.length).toBe(new Set(paths).size);
  });

  it("works the same way converting osu! to Quaver", async () => {
    const osuIni = "[General]\r\nName: T\r\n\r\n[Mania]\r\nKeys: 4\r\nColumnWidth: 30,30,30,30\r\n";
    // score-0.png is deliberately absent: it is osu!'s default font prefix,
    // so it converts into Quaver's Numbers/ folder rather than being carried.
    const extras = ["normal-hitnormal.wav", "menu-background.jpg"];
    const src = await build("t.osk", ["mania-note1.png", "mania-note2.png", ...extras], osuIni);
    const { pkg, report } = await convertSkin(src);

    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    for (const path of extras) expect(out.has(path.toLowerCase())).toBe(true);
    expect(report.counts.carried).toBe(extras.length);
  });

  it("consumes every osu! animation frame it packs, not just the first", async () => {
    const osuIni = "[General]\r\nName: T\r\n\r\n[Mania]\r\nKeys: 4\r\n";
    const frames = [0, 1, 2, 3].map((i) => `mania-hit300-${i}.png`);
    const src = await build("t.osk", ["mania-note1.png", ...frames], osuIni);
    const { pkg, report } = await convertSkin(src);

    // All four frames fed the packed sheet, so none should also be carried.
    expect(report.entries.filter((e) => e.status === "carried" && e.from?.startsWith("mania-hit300"))).toHaveLength(
      0,
    );
    const out = new Set(pkg.entries.map((e) => e.path.toLowerCase()));
    for (const frame of frames) expect(out.has(frame)).toBe(false);
  });
});
