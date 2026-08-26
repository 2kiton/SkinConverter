import { describe, it, expect } from "vitest";
import { parseIni } from "../ini/document";
import { allSections, readSection } from "../ini/access";
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

function section(p: SkinPackage, name: string, nth = 0) {
  const doc = parseIni(p.iniSource!);
  const slice = allSections(doc).filter((s) => s.name.toLowerCase() === name.toLowerCase())[nth];
  return slice ? readSection(doc, slice) : {};
}

const QUAVER_INI = "[General]\r\nName = T\r\n\r\n[4K]\r\nColumnSize = 90\r\n";
const NOTES = [1, 2, 3, 4].map((n) => `4k/HitObjects/note-hitobject-${n}.png`);

describe("stage appearance", () => {
  it("hides osu!'s column separators, which Quaver does not draw", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, NOTES));
    // osu! defaults ColourColumnLine to opaque white; leaving it unset is why
    // a converted skin shows white lines between lanes that Quaver never had.
    expect(section(out, "Mania")["ColourColumnLine"]).toBe("0,0,0,0");
  });

  it("paints the lanes black rather than relying on osu!'s default", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, NOTES));
    const mania = section(out, "Mania");
    for (const lane of [1, 2, 3, 4]) {
      expect(mania[`Colour${lane}`]).toBe("0,0,0,255");
    }
  });

  it("prefers a sampled stage background over the flat black default", async () => {
    const { pkg: out } = await convertSkin(
      pkg("quaver", QUAVER_INI, [...NOTES, "4k/Stage/stage-bgmask.png"]),
      {
        processor: {
          ...(await import("./images")).passthroughProcessor,
          async sampleLaneColours(_b, lanes) {
            return lanes.map(() => ({ r: 20, g: 30, b: 40, a: 255 }));
          },
        },
      },
    );
    expect(section(out, "Mania")["Colour1"]).toBe("20,30,40,255");
  });

  it("keeps column lines hidden in every keymode block", async () => {
    const ini = QUAVER_INI + "\r\n[7K]\r\nColumnSize = 75\r\n";
    const { pkg: out } = await convertSkin(pkg("quaver", ini, NOTES));
    expect(section(out, "Mania", 0)["ColourColumnLine"]).toBe("0,0,0,0");
    expect(section(out, "Mania", 1)["ColourColumnLine"]).toBe("0,0,0,0");
  });
});

describe("hit position", () => {
  const RECEPTORS = [1, 2, 3, 4].map((n) => `4k/Receptors/receptor-up-${n}.png`);

  async function withReceptor(width: number, height: number) {
    const { passthroughProcessor } = await import("./images");
    return convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...RECEPTORS]), {
      processor: {
        ...passthroughProcessor,
        async measure() {
          return { width, height };
        },
      },
    });
  }

  it("pulls the hit line down by half the receptor height", async () => {
    // A square receptor on a 90-unit column is 90 units tall, so its centre
    // sits 45 units — 28.125 osu!px — above the bottom of the stage.
    const { pkg: out } = await withReceptor(100, 100);
    expect(section(out, "Mania")["HitPosition"]).toBe("451.88");
  });

  it("accounts for the receptor's aspect ratio", async () => {
    // Half as tall: 45 units, so 22.5 -> 14.0625 osu!px above the bottom.
    const { pkg: out } = await withReceptor(100, 50);
    expect(section(out, "Mania")["HitPosition"]).toBe("465.94");
  });

  it("still honours HitPosOffsetY on top of that", async () => {
    const { passthroughProcessor } = await import("./images");
    const offsetIni = ["[General]", "Name = T", "", "[4K]", "ColumnSize = 90", "HitPosOffsetY = 16", ""].join(
      "\r\n",
    );
    const { pkg: out } = await convertSkin(
      pkg("quaver", offsetIni, [...NOTES, ...RECEPTORS]),
      {
        processor: {
          ...passthroughProcessor,
          async measure() {
            return { width: 100, height: 100 };
          },
        },
      },
    );
    // 16 Quaver units = 10 osu!px lower than the centred position.
    expect(section(out, "Mania")["HitPosition"]).toBe("461.88");
  });

  it("falls back to osu!'s default when the skin ships no receptor", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, NOTES));
    expect(section(out, "Mania")["HitPosition"]).toBe("402");
  });
});

describe("number fonts", () => {
  const QUAVER_FONTS = [
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((d) => [
      `Numbers/combo-${d}.png`,
      `Numbers/score-${d}.png`,
    ]),
    "Numbers/score-percent.png",
    "Numbers/score-decimal.png",
  ];

  it("declares a [Fonts] prefix per family", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...QUAVER_FONTS]));
    const fonts = section(out, "Fonts");
    // Separate prefixes, because osu!'s shared "score" default would collapse
    // Quaver's two distinct fonts into one.
    expect(fonts["ComboPrefix"]).toBe("qm-combo");
    expect(fonts["ScorePrefix"]).toBe("qm-score");
    expect(fonts["ComboPrefix"]).not.toBe(fonts["ScorePrefix"]);
  });

  it("writes every digit under the declared prefix", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...QUAVER_FONTS]));
    const names = new Set(out.entries.map((e) => e.path));
    for (let d = 0; d <= 9; d++) {
      expect(names.has(`qm-combo-${d}.png`)).toBe(true);
      expect(names.has(`qm-score-${d}.png`)).toBe(true);
    }
  });

  it("renames Quaver's decimal glyph to osu!'s dot", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...QUAVER_FONTS]));
    const names = new Set(out.entries.map((e) => e.path));
    expect(names.has("qm-score-dot.png")).toBe(true);
    expect(names.has("qm-score-percent.png")).toBe(true);
    expect(names.has("qm-score-decimal.png")).toBe(false);
  });

  it("shrinks glyphs into osu!'s 480-space HUD", async () => {
    const log: number[] = [];
    const { passthroughProcessor } = await import("./images");
    await convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...QUAVER_FONTS]), {
      processor: {
        ...passthroughProcessor,
        async scaleBy(b, factor) {
          log.push(factor);
          return b;
        },
      },
    });
    // The HUD does not use the playfield's 1.6x scaling, so glyphs copied
    // verbatim render 1.6x too large.
    expect(log).toContain(0.625);
    expect(log).toContain(1.25);
  });

  it("ships an @2x glyph alongside each digit", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, [...NOTES, ...QUAVER_FONTS]));
    const names = new Set(out.entries.map((e) => e.path));
    expect(names.has("qm-combo-0.png")).toBe(true);
    expect(names.has("qm-combo-0@2x.png")).toBe(true);
  });

  it("omits [Fonts] entirely when the skin ships no digits", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", QUAVER_INI, NOTES));
    expect(section(out, "Fonts")).toEqual({});
  });

  const OSU_INI = "[General]\r\nName: T\r\n\r\n[Mania]\r\nKeys: 4\r\nColumnWidth: 30,30,30,30\r\n";

  it("reads osu!'s default prefix when [Fonts] is absent", async () => {
    const digits = [0, 1, 2].map((d) => `score-${d}.png`);
    const { pkg: out } = await convertSkin(pkg("osu", OSU_INI, ["mania-note1.png", ...digits]));
    const names = new Set(out.entries.map((e) => e.path));
    // Both prefixes default to "score", so one osu! font feeds both Quaver ones.
    expect(names.has("Numbers/combo-0.png")).toBe(true);
    expect(names.has("Numbers/score-0.png")).toBe(true);
  });

  it("honours a custom prefix declared in [Fonts]", async () => {
    const ini = OSU_INI + "\r\n[Fonts]\r\nComboPrefix: myfont\r\n";
    const { pkg: out } = await convertSkin(
      pkg("osu", ini, ["mania-note1.png", "myfont-0.png", "myfont-7.png"]),
    );
    const names = new Set(out.entries.map((e) => e.path));
    expect(names.has("Numbers/combo-0.png")).toBe(true);
    expect(names.has("Numbers/combo-7.png")).toBe(true);
  });

  it("maps osu!'s dot back onto Quaver's decimal", async () => {
    const ini = OSU_INI + "\r\n[Fonts]\r\nScorePrefix: sc\r\n";
    const { pkg: out } = await convertSkin(pkg("osu", ini, ["sc-dot.png", "sc-percent.png"]));
    const names = new Set(out.entries.map((e) => e.path));
    expect(names.has("Numbers/score-decimal.png")).toBe(true);
    expect(names.has("Numbers/score-percent.png")).toBe(true);
  });
});
