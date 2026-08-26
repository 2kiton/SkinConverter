import { describe, it, expect } from "vitest";
import { parseIni } from "../src/lib/ini/document";
import { allSections, readSection } from "../src/lib/ini/access";
import { convertSkin } from "../src/lib/convert/convert";
import type { ImageProcessor, LaneSlot, PackedSheet } from "../src/lib/convert/images";
import type { SkinEntry, SkinFormat, SkinPackage } from "../src/lib/skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * A processor that records what it was asked to do and returns marker bytes.
 *
 * Canvas only exists in a browser, so these tests cannot check pixels. What
 * they can check — and what actually broke twice while building this — is
 * whether the converter calls the right operation, for the right element,
 * with the right numbers.
 */
class RecordingProcessor implements ImageProcessor {
  readonly calls: { op: string; args: number[] }[] = [];

  private note(op: string, ...args: number[]) {
    this.calls.push({ op, args });
  }

  opsNamed(op: string) {
    return this.calls.filter((c) => c.op === op);
  }

  async sliceSheet(_b: Uint8Array, rows: number, cols: number): Promise<Uint8Array[]> {
    this.note("sliceSheet", rows, cols);
    return Array.from({ length: rows * cols }, () => PNG);
  }
  async packSheet(frames: Uint8Array[]): Promise<PackedSheet> {
    this.note("packSheet", frames.length);
    return { bytes: PNG, rows: 1, cols: frames.length };
  }
  async flipVertical(b: Uint8Array): Promise<Uint8Array> {
    this.note("flipVertical");
    return b;
  }
  async rotate(b: Uint8Array, degrees: number): Promise<Uint8Array> {
    this.note("rotate", degrees);
    return b;
  }
  async letterbox(b: Uint8Array, aspect: number): Promise<Uint8Array> {
    this.note("letterbox", aspect);
    return b;
  }
  async stretchToAspect(b: Uint8Array, aspect: number): Promise<Uint8Array> {
    this.note("stretchToAspect", aspect);
    return b;
  }
  async measure(_b: Uint8Array) {
    this.note("measure");
    return { width: 600, height: 40 };
  }
  async scaleBy(b: Uint8Array, factor: number): Promise<Uint8Array> {
    this.note("scaleBy", factor);
    return b;
  }
  async resizeToWidth(b: Uint8Array, width: number): Promise<Uint8Array> {
    this.note("resizeToWidth", width);
    return b;
  }
  async laneStripes(lanes: LaneSlot[], width: number, height: number): Promise<Uint8Array> {
    this.note("laneStripes", lanes.length, width, height);
    return new Uint8Array([1, 2, 3, 4]);
  }
  async sampleLaneColours(_b: Uint8Array, lanes: LaneSlot[]) {
    this.note("sampleLaneColours", lanes.length);
    return lanes.map((_, i) => ({ r: 10 * (i + 1), g: 20, b: 30, a: 255 }));
  }
}

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

function sectionOf(p: SkinPackage, name: string, nth = 0) {
  const doc = parseIni(p.iniSource!);
  const slice = allSections(doc).filter((s) => s.name.toLowerCase() === name.toLowerCase())[nth];
  return slice ? readSection(doc, slice) : {};
}

const QUAVER_PATHS = [1, 2, 3, 4].flatMap((lane) => [
  `4k/HitObjects/note-hitobject-${lane}.png`,
  `4k/Receptors/receptor-up-${lane}.png`,
  `4k/Receptors/receptor-down-${lane}.png`,
]);

function quaverIni(extra = ""): string {
  return ["[General]", "Name = T", "", "[4K]", "ColumnSize = 90", "NotePadding = 0", extra, ""].join("\r\n");
}

describe("receptor sizing", () => {
  it("sizes Quaver receptors to the column width, not to the key band", async () => {
    const proc = new RecordingProcessor();
    const { pkg: out } = await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), { processor: proc });

    // osu!'s LegacyKeyArea forces the sprite width to the column but leaves
    // HEIGHT at the texture's own. Padding the texture taller — which an
    // earlier build did — therefore stretched the key vertically on screen.
    expect(proc.opsNamed("letterbox")).toHaveLength(0);

    // Two states x four lanes, sized twice each: once standard, once @2x.
    const sizes = proc.opsNamed("resizeToWidth");
    expect(sizes).toHaveLength(16);
    // ColumnSize 90 in Quaver's 768-space. osu! stores skin.ini's 480-space
    // ColumnWidth times 1.6 internally, so the texture matches at 90, not the
    // 56.25 that skin.ini itself carries.
    expect(new Set(sizes.map((c) => c.args[0]))).toEqual(new Set([90, 180]));

    // Both files ship, so the on-screen size is right whichever osu! picks.
    expect(out.entries.some((e) => e.path === "qm-4k-receptor-up-1.png")).toBe(true);
    expect(out.entries.some((e) => e.path === "qm-4k-receptor-up-1@2x.png")).toBe(true);
  });

  it("keeps skin.ini pointing at the stem, letting osu! pick the @2x file", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS));
    expect(sectionOf(out, "Mania")["KeyImage0"]).toBe("qm-4k-receptor-up-1");
  });

  it("bakes osu!'s stretch into receptors on the way into Quaver", async () => {
    const proc = new RecordingProcessor();
    const ini = ["[General]", "Name: T", "", "[Mania]", "Keys: 4", "ColumnWidth: 30,30,30,30", "HitPosition: 402", ""].join(
      "\r\n",
    );
    await convertSkin(pkg("osu", ini, ["mania-key1.png", "mania-key2.png", "mania-key1D.png", "mania-key2D.png"]), {
      processor: proc,
    });

    const stretches = proc.opsNamed("stretchToAspect");
    expect(stretches).toHaveLength(8);
    expect(stretches[0]!.args[0]).toBeCloseTo(30 / 78, 6);
  });

  it("leaves notes at their source size — osu! scales those uniformly", async () => {
    const proc = new RecordingProcessor();
    const { pkg: out, report } = await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), {
      processor: proc,
    });
    // LegacyNotePiece divides by the texture width, so aspect is preserved
    // whatever the texture measures. Resizing would only cost resolution.
    const notes = report.entries.filter((e) => e.elementId === "note");
    expect(notes.every((n) => n.status === "copied")).toBe(true);
    expect(out.entries.some((e) => e.path === "qm-4k-note-1.png")).toBe(true);
  });

  it("shrinks natively-drawn elements out of Quaver's 768-high space", async () => {
    const proc = new RecordingProcessor();
    await convertSkin(
      pkg("quaver", quaverIni(), [
        ...QUAVER_PATHS,
        "4k/Stage/stage-left-border.png",
        "Judgements/judge-marv.png",
      ]),
      { processor: proc },
    );
    // Stage borders and judgement bursts are drawn at raw texture width, so
    // they land 1.6x too large unless scaled by 0.625 — doubled for @2x.
    const scales = proc.opsNamed("scaleBy");
    expect(scales.length).toBeGreaterThan(0);
    expect(new Set(scales.map((c) => c.args[0]))).toEqual(new Set([0.625, 1.25]));
  });

  it("centres the judgement burst like Quaver rather than osu!'s default", async () => {
    const { pkg: out } = await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS));
    // osu! defaults ScorePosition to 300 of 480 (62% down); Quaver centres it.
    expect(sectionOf(out, "Mania")["ScorePosition"]).toBe("240");
  });

  it("shifts the burst by JudgementBurstPosY", async () => {
    const { pkg: out } = await convertSkin(
      pkg("quaver", quaverIni("JudgementBurstPosY = 80"), QUAVER_PATHS),
    );
    // 80 Quaver units x 0.625 = 50 osu!px below centre.
    expect(sectionOf(out, "Mania")["ScorePosition"]).toBe("290");
  });
});

describe("per-lane rotation", () => {
  it("bakes an explicit rotation list into each lane", async () => {
    const proc = new RecordingProcessor();
    await convertSkin(pkg("quaver", quaverIni("HitObjectRotations = 90,0,180,270"), QUAVER_PATHS), {
      processor: proc,
    });
    expect(proc.opsNamed("rotate").map((c) => c.args[0])).toEqual([90, 180, 270]);
  });

  it("does not guess when the skin rotates by column but gives no list", async () => {
    const proc = new RecordingProcessor();
    const { report } = await convertSkin(
      pkg("quaver", quaverIni("RotateHitObjectsByColumn = True"), QUAVER_PATHS),
      { processor: proc },
    );
    // Quaver's built-in defaults are undocumented; rotating on a guess would
    // point every arrow the wrong way, so it warns instead.
    expect(proc.opsNamed("rotate")).toHaveLength(0);
    expect(report.warnings.join(" ")).toMatch(/no explicit rotation list/i);
  });
});

describe("stage background synthesis", () => {
  it("paints osu! lane colours into a Quaver stage background", async () => {
    const proc = new RecordingProcessor();
    const ini = [
      "[General]",
      "Name: T",
      "",
      "[Mania]",
      "Keys: 4",
      "ColumnWidth: 30,30,30,30",
      "Colour1: 40,20,20",
      "Colour2: 20,30,50",
      "Colour3: 20,30,50",
      "Colour4: 40,20,20",
      "",
    ].join("\r\n");

    const { pkg: out, report } = await convertSkin(pkg("osu", ini, ["mania-note1.png", "mania-note2.png"]), {
      processor: proc,
    });

    expect(proc.opsNamed("laneStripes")).toHaveLength(1);
    expect(out.entries.some((e) => e.path === "4k/Stage/stage-bgmask.png")).toBe(true);
    expect(sectionOf(out, "4K")["BgMaskAlpha"]).toBe("1.0");
    expect(report.entries.some((e) => e.status === "synthesized")).toBe(true);
  });

  it("samples a Quaver stage background back into osu! lane colours", async () => {
    const proc = new RecordingProcessor();
    const { pkg: out, report } = await convertSkin(
      pkg("quaver", quaverIni(), [...QUAVER_PATHS, "4k/Stage/stage-bgmask.png"]),
      { processor: proc },
    );

    expect(proc.opsNamed("sampleLaneColours")).toHaveLength(1);
    const mania = sectionOf(out, "Mania");
    expect(mania["Colour1"]).toBe("10,20,30,255");
    expect(mania["Colour4"]).toBe("40,20,30,255");
    expect(report.entries.some((e) => e.status === "synthesized")).toBe(true);
  });

  it("writes Colour keys into the right [Mania] block when keymodes repeat", async () => {
    const proc = new RecordingProcessor();
    const ini = quaverIni() + "\r\n[7K]\r\nColumnSize = 75\r\n";
    const { pkg: out } = await convertSkin(
      pkg("quaver", ini, [...QUAVER_PATHS, "4k/Stage/stage-bgmask.png"]),
      { processor: proc },
    );

    // Four lanes of colour in the 4K block, seven in the 7K block — not all
    // eleven appended to whichever block happened to be written last.
    expect(sectionOf(out, "Mania", 0)["Colour4"]).toBeDefined();
    expect(sectionOf(out, "Mania", 0)["Colour5"]).toBeUndefined();
    expect(sectionOf(out, "Mania", 1)["Colour7"]).toBeDefined();
  });

  it("skips synthesis entirely when there is nothing to synthesize", async () => {
    const proc = new RecordingProcessor();
    await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), { processor: proc });
    expect(proc.opsNamed("sampleLaneColours")).toHaveLength(0);
  });
});
