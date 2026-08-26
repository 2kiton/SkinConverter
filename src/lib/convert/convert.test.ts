import { describe, it, expect } from "vitest";
import { parseIni, serializeIni } from "../ini/document";
import { allSections, get, readSection } from "../ini/access";
import { convertSkin } from "./convert";
import type { SkinEntry, SkinFormat, SkinPackage } from "../skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function pkg(format: SkinFormat, iniText: string, paths: string[]): SkinPackage {
  const entries: SkinEntry[] = paths.map((path) => ({ path, originalPath: path, bytes: PNG }));
  entries.push({ path: "skin.ini", originalPath: "skin.ini", bytes: new TextEncoder().encode(iniText) });
  return {
    name: "test",
    format,
    detection: { format, signals: [], ambiguous: false },
    entries,
    ini: parseIni(iniText),
    iniSource: iniText,
    iniPath: "skin.ini",
    strippedRoot: null,
  };
}

function outIni(p: SkinPackage) {
  const doc = parseIni(p.iniSource!);
  return {
    doc,
    section(name: string, nth = 0) {
      const slice = allSections(doc).filter((s) => s.name.toLowerCase() === name.toLowerCase())[nth];
      return slice ? readSection(doc, slice) : {};
    },
  };
}

const QUAVER_4K = [
  "[General]",
  "Name = Neon",
  "Author = tester",
  "",
  "[4K]",
  "ColumnSize = 90",
  "NotePadding = 0",
  "ColumnColor1 = 255,0,0,200",
  "",
].join("\r\n");

const QUAVER_PATHS = [1, 2, 3, 4].flatMap((lane) => [
  `4k/HitObjects/note-hitobject-${lane}.png`,
  `4k/HitObjects/note-holdhitobject-${lane}.png`,
  `4k/HitObjects/note-holdbody-${lane}.png`,
  `4k/HitObjects/note-holdend-${lane}.png`,
  `4k/Receptors/receptor-up-${lane}.png`,
  `4k/Receptors/receptor-down-${lane}.png`,
]);

describe("Quaver -> osu!", () => {
  it("emits one [Mania] block per keymode with the right Keys", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    expect(outIni(out).section("Mania")["Keys"]).toBe("4");
  });

  it("scales ColumnSize into osu! units", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    // 90 Quaver units x 0.625 = 56.25 osu!px, once per column.
    expect(outIni(out).section("Mania")["ColumnWidth"]).toBe("56.25,56.25,56.25,56.25");
  });

  it("sets NoteBodyStyle to Stretch, matching Quaver's hold rendering", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    // 0 = Stretch. The wiki claims the default is 1, but osu!'s source
    // comments that value out as not actually honoured.
    expect(outIni(out).section("Mania")["NoteBodyStyle"]).toBe("0");
  });

  it("carries ColumnColor across as ColourLight, dropping alpha", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    expect(outIni(out).section("Mania")["ColourLight1"]).toBe("255,0,0");
  });

  it("gives every lane its own file so per-lane art is not collapsed", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    const mania = outIni(out).section("Mania");
    // osu!'s default naming only offers 1/2/S, which would merge lanes 1+4 and
    // 2+3. Explicit NoteImage keys sidestep that entirely.
    expect(mania["NoteImage0"]).toBe("qm-4k-note-1");
    expect(mania["NoteImage3"]).toBe("qm-4k-note-4");
    expect(mania["NoteImage0"]).not.toBe(mania["NoteImage3"]);
  });

  it("writes a file for every referenced image", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    const names = new Set(out.entries.map((e) => e.path));
    for (const lane of [1, 2, 3, 4]) {
      expect(names.has(`qm-4k-note-${lane}.png`)).toBe(true);
      // Both sizes ship so the on-screen result is the same either way.
      expect(names.has(`qm-4k-receptor-up-${lane}.png`)).toBe(true);
      expect(names.has(`qm-4k-receptor-up-${lane}@2x.png`)).toBe(true);
    }
  });

  it("produces a skin.ini that parses back cleanly", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    expect(serializeIni(parseIni(out.iniSource!))).toBe(out.iniSource);
  });

  it("reports missing elements rather than silently skipping them", async () => {
    const { report } = await convertSkin(pkg("quaver", QUAVER_4K, []));
    expect(report.counts.missing).toBeGreaterThan(0);
    expect(report.entries.every((e) => e.status !== "copied")).toBe(true);
  });

  it("warns that hold tails were not flipped", async () => {
    const { report } = await convertSkin(pkg("quaver", QUAVER_4K, QUAVER_PATHS));
    expect(report.warnings.join(" ")).toMatch(/tails were copied unflipped/i);
  });
});

const OSU_4K = [
  "[General]",
  "Name: Neon",
  "",
  "[Mania]",
  "Keys: 4",
  "ColumnStart: 136",
  "ColumnWidth: 30,30,30,30",
  "HitPosition: 402",
  "ColourLight1: 55,255,255",
  "",
].join("\r\n");

const OSU_PATHS = [
  "mania-note1.png",
  "mania-note2.png",
  "mania-note1H.png",
  "mania-note2H.png",
  "mania-note1L.png",
  "mania-note2L.png",
  "mania-note1T.png",
  "mania-note2T.png",
  "mania-key1.png",
  "mania-key2.png",
  "mania-key1D.png",
  "mania-key2D.png",
];

describe("osu! -> Quaver", () => {
  it("emits a [4K] section", async () => {
    const { pkg: out } = await convertSkin(pkg("osu", OSU_4K, OSU_PATHS));
    expect(outIni(out).section("4K")["ColumnSize"]).toBe("48");
  });

  it("turns the default hit position into a zero offset", async () => {
    const { pkg: out } = await convertSkin(pkg("osu", OSU_4K, OSU_PATHS));
    expect(outIni(out).section("4K")["HitPosOffsetY"]).toBe("0");
  });

  it("keeps alpha on ColumnColor, which Quaver supports", async () => {
    const { pkg: out } = await convertSkin(pkg("osu", OSU_4K, OSU_PATHS));
    expect(outIni(out).section("4K")["ColumnColor1"]).toBe("55,255,255,255");
  });

  it("expands osu!'s 1/2/S pattern into one file per Quaver lane", async () => {
    const { pkg: out } = await convertSkin(pkg("osu", OSU_4K, OSU_PATHS));
    const names = new Set(out.entries.map((e) => e.path.toLowerCase()));
    for (const lane of [1, 2, 3, 4]) {
      expect(names.has(`4k/hitobjects/note-hitobject-${lane}.png`)).toBe(true);
    }
  });

  it("routes lanes through osu!'s real fallback pattern (1,2,2,1)", async () => {
    const { report } = await convertSkin(pkg("osu", OSU_4K, OSU_PATHS));
    const notes = report.entries.filter((e) => e.elementId === "note" && e.lane !== undefined);
    expect(notes.map((e) => e.from)).toEqual([
      "mania-note1.png",
      "mania-note2.png",
      "mania-note2.png",
      "mania-note1.png",
    ]);
  });

  it("honours an explicit NoteImage override", async () => {
    const ini = OSU_4K.replace("ColourLight1: 55,255,255", "NoteImage0: mania-note2");
    const { report } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    const first = report.entries.find((e) => e.elementId === "note" && e.lane === 1);
    expect(first?.from).toBe("mania-note2.png");
  });

  it("prefers an @2x source and says so", async () => {
    const { report } = await convertSkin(pkg("osu", OSU_4K, [...OSU_PATHS, "mania-note1@2x.png"]));
    const first = report.entries.find((e) => e.elementId === "note" && e.lane === 1);
    expect(first?.from).toBe("mania-note1@2x.png");
    expect(first?.detail).toMatch(/@2x/);
  });

  it("warns when osu! columns are not uniform", async () => {
    const ini = OSU_4K.replace("ColumnWidth: 30,30,30,30", "ColumnWidth: 60,30,30,30");
    const { report } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    expect(report.warnings.join(" ")).toMatch(/differing widths/i);
    // The most common width wins, not the mean.
    const { pkg: out } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    expect(outIni(out).section("4K")["ColumnSize"]).toBe("48");
  });

  it("warns when lane background colours would be lost", async () => {
    const ini = OSU_4K.replace("ColourLight1: 55,255,255", "Colour1: 10,10,10");
    const { report } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    expect(report.warnings.join(" ")).toMatch(/lane background colours/i);
  });

  it("warns when a repeating hold body cannot be reproduced", async () => {
    const ini = OSU_4K.replace("HitPosition: 402", "HitPosition: 402\nNoteBodyStyle: 3");
    const { report } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    expect(report.warnings.join(" ")).toMatch(/NoteBodyStyle 3/);
  });

  it("handles both keymodes when [Mania] repeats", async () => {
    const ini = `${OSU_4K}\r\n[Mania]\r\nKeys: 7\r\nColumnWidth: 30,30,30,30,30,30,30\r\n`;
    const { pkg: out, report } = await convertSkin(pkg("osu", ini, OSU_PATHS));
    expect(report.keymodes).toEqual(["4K", "7K"]);
    const doc = parseIni(out.iniSource!);
    const names = allSections(doc).map((s) => s.name);
    expect(names).toContain("4K");
    expect(names).toContain("7K");
    expect(get(doc, allSections(doc).find((s) => s.name === "7K")!, "ColumnSize")).toBe("48");
  });
});
