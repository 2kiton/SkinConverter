import { describe, it, expect } from "vitest";
import { parseIni } from "../ini/document";
import { allSections, readSection } from "../ini/access";
import { convertSkin } from "./convert";
import type { ImageProcessor, LaneSlot, PackedSheet } from "./images";
import type { SkinEntry, SkinFormat, SkinPackage } from "../skin/types";

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

describe("receptor aspect handling", () => {
  it("pads Quaver receptors to osu!'s key box before osu! stretches them", async () => {
    const proc = new RecordingProcessor();
    await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), { processor: proc });

    const boxes = proc.opsNamed("letterbox");
    // Two receptor states x four lanes.
    expect(boxes).toHaveLength(8);
    // ColumnSize 90 -> 56.25 osu!px wide; hit position 402 leaves 78 below it.
    expect(boxes[0]!.args[0]).toBeCloseTo(56.25 / 78, 6);
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

  it("leaves notes alone — only receptors are reshaped", async () => {
    const proc = new RecordingProcessor();
    await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), { processor: proc });
    const { report } = await convertSkin(pkg("quaver", quaverIni(), QUAVER_PATHS), { processor: proc });
    const notes = report.entries.filter((e) => e.elementId === "note");
    expect(notes.every((n) => n.status === "copied")).toBe(true);
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
