import { describe, it, expect } from "vitest";
import { parseIni } from "../src/lib/ini/document";
import { convertSkin } from "../src/lib/convert/convert";
import { passthroughProcessor } from "../src/lib/convert/images";
import type { SkinEntry, SkinPackage } from "../src/lib/skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const EOL = "\r\n";

/**
 * osu!stable seats the long note tail slightly below where it ends the body,
 * leaving a strip of body showing above it — a thin line over every long note,
 * measured in game as roughly the body image's own height.
 *
 * No skin.ini key moves the tail, and flattening the body did not help, so the
 * gap is closed from the other side: padding above the tail makes the sprite
 * taller, and a taller sprite drawn from the same anchor shifts its content.
 */
function pkg(iniText: string): SkinPackage {
  const paths = [1, 2, 3, 4].flatMap((n) => [
    `4k/HitObjects/note-holdbody-${n}.png`,
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

const INI = ["[General]", "Name = T", "", "[4K]", "ColumnSize = 90", ""].join(EOL);

/**
 * Body and tail are scaled independently to the column width, so the two are
 * given different widths here — a lift measured in body pixels means nothing
 * until it is converted into the tail's scale.
 */
function measuring(pads: number[], body = { width: 155, height: 14 }, tail = { width: 310, height: 74 }) {
  let call = 0;
  return {
    ...passthroughProcessor,
    async measure() {
      // tailLift measures the body first, then the tail.
      call++;
      return call % 2 === 1 ? body : tail;
    },
    async padTop(b: Uint8Array, pixels: number) {
      pads.push(pixels);
      return b;
    },
  } as never;
}

describe("long note tail lift, stable", () => {
  it("lifts the tail by the body height, rescaled into tail pixels", async () => {
    const pads: number[] = [];
    await convertSkin(pkg(INI), { target: "stable", processor: measuring(pads) });
    // 14 body px at a 310/155 = 2x scale difference -> 28 tail px, plus a
    // 1.2% seating bias of ~4px, because covering the overhang exactly still
    // left a sliver showing in game.
    expect(pads).toEqual([32, 32, 32, 32]);
  });

  it("scales the lift with the tail's own resolution", async () => {
    const pads: number[] = [];
    await convertSkin(pkg(INI), {
      target: "stable",
      processor: measuring(pads, { width: 100, height: 20 }, { width: 100, height: 50 }),
    });
    // Same width, so the body height carries across unchanged: 20 + 1.2% of 100.
    expect(pads).toEqual([21, 21, 21, 21]);
  });

  it("reports the lift and the reason", async () => {
    const { report } = await convertSkin(pkg(INI), { target: "stable", processor: measuring([]) });
    const row = report.entries.find((e) => e.elementId === "holdTail");
    expect(row?.status).toBe("processed");
    expect(row?.detail).toMatch(/lifted \d+px/i);
    expect(row?.detail).toMatch(/seats the tail below/i);
  });

  it("does nothing when the body is missing", async () => {
    const pads: number[] = [];
    const bare = pkg(INI);
    bare.entries = bare.entries.filter((e) => !e.path.includes("holdbody"));
    await convertSkin(bare, { target: "stable", processor: measuring(pads) });
    expect(pads).toEqual([]);
  });
});

  it("scales the bias with resolution rather than fixing it in pixels", async () => {
    const low: number[] = [];
    const high: number[] = [];
    await convertSkin(pkg(INI), {
      target: "stable",
      processor: measuring(low, { width: 100, height: 10 }, { width: 100, height: 40 }),
    });
    await convertSkin(pkg(INI), {
      target: "stable",
      processor: measuring(high, { width: 200, height: 20 }, { width: 200, height: 80 }),
    });
    // Doubling every source dimension should double the lift, so a skin
    // authored at 2x does not end up half-corrected.
    expect(high[0]).toBe(low[0]! * 2);
  });

describe("long note tail lift, lazer", () => {
  it("does not lift, since lazer seats the tail correctly", async () => {
    const pads: number[] = [];
    await convertSkin(pkg(INI), { target: "lazer", processor: measuring(pads) });
    expect(pads).toEqual([]);
  });

  it("does not lift on the default target either", async () => {
    const pads: number[] = [];
    await convertSkin(pkg(INI), { processor: measuring(pads) });
    expect(pads).toEqual([]);
  });
});
