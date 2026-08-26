import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readSkin } from "../skin/read";
import { convertSkin } from "./convert";
import { passthroughProcessor } from "./images";
import { GRADES, osuGradePath, quaverGradePath } from "./grades";
import type { SkinPackage } from "../skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

async function build(name: string, paths: string[], ini: string): Promise<SkinPackage> {
  const zip = new JSZip();
  for (const path of paths) zip.file(path, PNG);
  zip.file("skin.ini", ini);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return readSkin(new File([bytes], name));
}

const QUAVER_INI = "[General]\r\nName = T\r\n\r\n[4K]\r\nColumnSize = 90\r\n";
const OSU_INI = "[General]\r\nName: T\r\n\r\n[Mania]\r\nKeys: 4\r\nColumnWidth: 30,30,30,30\r\n";

const ALL_QUAVER_GRADES = ["x", "ss", "s", "a", "b", "c", "d", "f"].map(quaverGradePath);

describe("rank sprites, Quaver -> osu!", () => {
  it("maps every grade osu! has a rank for", async () => {
    const { pkg } = await convertSkin(await build("t.qs", ALL_QUAVER_GRADES, QUAVER_INI));
    const out = new Set(pkg.entries.map((e) => e.path));

    for (const name of ["X", "XH", "S", "SH", "A", "B", "C", "D"]) {
      expect(out.has(osuGradePath(name)), `${name} should be written`).toBe(true);
    }
  });

  it("fills both S variants from Quaver's single S", async () => {
    const { pkg, report } = await convertSkin(
      await build("t.qs", [quaverGradePath("s")], QUAVER_INI),
    );
    const out = new Set(pkg.entries.map((e) => e.path));
    // SH is osu!'s silver S, earned with Hidden or Flashlight rather than by
    // accuracy — Quaver has no such distinction, so both get the same art.
    expect(out.has("ranking-S-small.png")).toBe(true);
    expect(out.has("ranking-SH-small.png")).toBe(true);
    expect(report.entries.find((e) => e.elementId === "grade-s")?.detail).toMatch(/silver/i);
  });

  it("keeps Quaver's X and SS as distinct osu! ranks", async () => {
    const { pkg } = await convertSkin(
      await build("t.qs", [quaverGradePath("x"), quaverGradePath("ss")], QUAVER_INI),
    );
    const out = new Set(pkg.entries.map((e) => e.path));
    expect(out.has("ranking-X-small.png")).toBe(true);
    expect(out.has("ranking-XH-small.png")).toBe(true);
  });

  it("warns that the F grade has nowhere to go", async () => {
    const { report } = await convertSkin(await build("t.qs", ALL_QUAVER_GRADES, QUAVER_INI));
    // osu! has no failing rank, and its D is already taken by Quaver's D.
    expect(report.warnings.join(" ")).toMatch(/F grade was not carried across/i);
  });

  it("says nothing about F when the skin does not ship one", async () => {
    const { report } = await convertSkin(await build("t.qs", [quaverGradePath("s")], QUAVER_INI));
    expect(report.warnings.join(" ")).not.toMatch(/F grade/i);
  });

  it("ships an @2x companion for each rank", async () => {
    const { pkg } = await convertSkin(await build("t.qs", [quaverGradePath("a")], QUAVER_INI));
    const out = new Set(pkg.entries.map((e) => e.path));
    expect(out.has("ranking-A-small.png")).toBe(true);
    expect(out.has("ranking-A-small@2x.png")).toBe(true);
  });

  it("scales into osu!'s 480-space, not the playfield's 768-space", async () => {
    const log: number[] = [];
    await convertSkin(await build("t.qs", [quaverGradePath("a")], QUAVER_INI), {
      processor: {
        ...passthroughProcessor,
        async scaleBy(b, factor) {
          log.push(factor);
          return b;
        },
      },
    });
    expect(log).toContain(0.625);
    expect(log).toContain(1.25);
  });

  it("leaves osu!'s full-size results grades alone", async () => {
    const { pkg } = await convertSkin(await build("t.qs", ALL_QUAVER_GRADES, QUAVER_INI));
    // Quaver only ships 60x60 art; upscaling it into osu!'s much larger
    // results-screen grades would look worse than osu!'s own.
    expect(pkg.entries.some((e) => e.path === "ranking-X.png")).toBe(false);
  });

  it("does not also carry the sources through", async () => {
    const { pkg, report } = await convertSkin(await build("t.qs", ALL_QUAVER_GRADES, QUAVER_INI));
    expect(pkg.entries.some((e) => e.path === "Grades/grade-small-s.png")).toBe(false);
    // F is the one grade with no mapping, so it is the only one carried.
    expect(report.counts.carried).toBe(1);
  });
});

describe("rank sprites, osu! -> Quaver", () => {
  it("maps osu!'s ranks back into Quaver's Grades folder", async () => {
    const paths = ["X", "S", "A", "B", "C", "D"].map(osuGradePath);
    const { pkg } = await convertSkin(await build("t.osk", paths, OSU_INI));
    const out = new Set(pkg.entries.map((e) => e.path));

    for (const id of ["x", "s", "a", "b", "c", "d"]) {
      expect(out.has(quaverGradePath(id)), `${id} should be written`).toBe(true);
    }
  });

  it("takes the primary rank rather than the silver variant", async () => {
    const { report } = await convertSkin(
      await build("t.osk", [osuGradePath("S"), osuGradePath("SH")], OSU_INI),
    );
    expect(report.entries.find((e) => e.elementId === "grade-s")?.from).toBe("ranking-S-small.png");
  });

  it("warns that Quaver's F has no source", async () => {
    const { report } = await convertSkin(await build("t.osk", [osuGradePath("S")], OSU_INI));
    expect(report.warnings.join(" ")).toMatch(/F grade has no osu! source/i);
  });

  it("grows the art into Quaver's 768-high space", async () => {
    const log: number[] = [];
    await convertSkin(await build("t.osk", [osuGradePath("A")], OSU_INI), {
      processor: {
        ...passthroughProcessor,
        async scaleBy(b, factor) {
          log.push(factor);
          return b;
        },
      },
    });
    expect(log).toContain(1.6);
  });
});

describe("the grade table", () => {
  it("covers every osu! rank exactly once", async () => {
    const targets = GRADES.flatMap((g) => g.osu);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.sort()).toEqual(["A", "B", "C", "D", "S", "SH", "X", "XH"]);
  });
});
