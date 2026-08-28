import { describe, it, expect } from "vitest";
import { parseIni } from "../src/lib/ini/document";
import { convertSkin } from "../src/lib/convert/convert";
import { transparentPixel } from "../src/lib/convert/health";
import { passthroughProcessor } from "../src/lib/convert/images";
import type { SkinEntry, SkinPackage } from "../src/lib/skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const EOL = "\r\n";

/**
 * The long note end.
 *
 * osu! flips `mania-note{n}T` itself from skin version 2.5, which we declare.
 * A Quaver end points away from the receptors, so shipping it as-authored
 * lands it upside down and buried in the body, leaving only its flat edge
 * visible above the note — which reads as a thin horizontal line, and cost
 * several rounds of misdiagnosis to pin down.
 *
 * Separately, Quaver's `DrawLongNoteEnd = False` means the game never draws
 * the end at all, and osu! has no equivalent switch.
 */
function pkg(iniText: string): SkinPackage {
  const paths = [1, 2, 3, 4].flatMap((n) => [
    `4k/HitObjects/note-hitobject-${n}.png`,
    `4k/HitObjects/note-holdend-${n}.png`,
  ]);
  const entries: SkinEntry[] = paths.map((path) => ({ path, originalPath: path, bytes: PNG }));
  entries.push({ path: "skin.ini", originalPath: "skin.ini", bytes: new TextEncoder().encode(iniText) });
  return {
    name: "test",
    format: "quaver",
    detection: { format: "quaver", signals: [], ambiguous: false },
    entries,
    ini: parseIni(iniText),
    iniSource: iniText,
    iniPath: "skin.ini",
    strippedRoot: null,
  };
}

const ini = (extra: string[] = []) =>
  ["[General]", "Name = T", "", "[4K]", "ColumnSize = 90", ...extra, ""].join(EOL);

const FLIPPED = new Uint8Array([9, 9, 9, 9]);

/** Records which images were flipped, and reports a tail size. */
function recording(flips: number[]) {
  return {
    ...passthroughProcessor,
    async measure() {
      return { width: 128, height: 36 };
    },
    async flipVertical() {
      flips.push(1);
      return FLIPPED;
    },
    async laneStripes(_lanes: unknown[], width: number, height: number) {
      return new Uint8Array([width, height]);
    },
  } as never;
}

function tails(p: SkinPackage) {
  return p.entries.filter((e) => e.path.includes("hold-tail"));
}

describe("long note end, stable", () => {
  it("pre-flips the end so osu!'s own flip cancels out", async () => {
    const flips: number[] = [];
    const { pkg: out } = await convertSkin(pkg(ini()), { target: "stable", processor: recording(flips) });

    expect(flips.length).toBe(4);
    expect(tails(out).length).toBe(4);
    for (const entry of tails(out)) expect(entry.bytes).toEqual(FLIPPED);
  });

  it("still writes the real art, not a blank", async () => {
    const { pkg: out } = await convertSkin(pkg(ini()), { target: "stable" });
    // The end has to survive the conversion; hiding it was a workaround, not
    // a fix.
    for (const entry of tails(out)) expect(entry.bytes).toEqual(PNG);
  });

  it("says why it flipped", async () => {
    const { report } = await convertSkin(pkg(ini()), { target: "stable", processor: recording([]) });
    expect(report.entries.find((e) => e.elementId === "holdTail")?.detail).toMatch(/osu!stable flips the tail/i);
  });
});

describe("long note end, lazer", () => {
  it("does not flip by default, leaving lazer's behaviour alone", async () => {
    const flips: number[] = [];
    await convertSkin(pkg(ini()), { target: "lazer", processor: recording(flips) });
    expect(flips.length).toBe(0);
  });

  it("flips when explicitly asked", async () => {
    const flips: number[] = [];
    await convertSkin(pkg(ini()), { target: "lazer", flipHoldTail: true, processor: recording(flips) });
    expect(flips.length).toBe(4);
  });
});

describe("DrawLongNoteEnd", () => {
  it("carries the end across when the skin draws it", async () => {
    const { pkg: out } = await convertSkin(pkg(ini()));
    expect(tails(out).length).toBe(4);
    for (const entry of tails(out)) expect(entry.bytes).toEqual(PNG);
  });

  it("treats an absent key as Quaver's default of True", async () => {
    const { pkg: out } = await convertSkin(pkg(ini(["NotePadding = 0"])));
    for (const entry of tails(out)) expect(entry.bytes).toEqual(PNG);
  });

  it("blanks the end when the skin sets it False", async () => {
    const { pkg: out } = await convertSkin(pkg(ini(["DrawLongNoteEnd = False"])));
    // Blanked, not dropped — a missing file makes osu! fall back to its own art.
    for (const entry of tails(out)) expect(entry.bytes).toEqual(transparentPixel());
  });

  it("blanks at the end's own size when it can be measured", async () => {
    const { pkg: out } = await convertSkin(pkg(ini(["DrawLongNoteEnd = False"])), {
      processor: recording([]),
    });
    // osu! sizes the body against the tail, so a 1x1 blank would shorten the
    // body and let osu!'s own art show through.
    for (const entry of tails(out)) expect(entry.bytes).toEqual(new Uint8Array([128, 36]));
  });

  it("wins over the flip, since there is nothing left to flip", async () => {
    const flips: number[] = [];
    await convertSkin(pkg(ini(["DrawLongNoteEnd = False"])), {
      target: "stable",
      processor: recording(flips),
    });
    expect(flips.length).toBe(0);
  });

  it("says so in the report and the warnings", async () => {
    const { report } = await convertSkin(pkg(ini(["DrawLongNoteEnd = False"])));
    const row = report.entries.find((e) => e.elementId === "holdTail");
    expect(row?.status).toBe("approximated");
    expect(row?.detail).toMatch(/DrawLongNoteEnd/);
    expect(report.warnings.join(" ")).toMatch(/DrawLongNoteEnd/);
  });
});
