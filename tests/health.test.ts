import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readSkin } from "../src/lib/skin/read";
import { convertSkin } from "../src/lib/convert/convert";
import { passthroughProcessor, type ImageProcessor } from "../src/lib/convert/images";
import { transparentPixel, VERTICAL_TO_HORIZONTAL_DEGREES } from "../src/lib/convert/health";
import type { SkinPackage } from "../src/lib/skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

async function build(name: string, paths: string[], ini: string): Promise<SkinPackage> {
  const zip = new JSZip();
  for (const path of paths) zip.file(path, PNG);
  zip.file("skin.ini", ini);
  // "arraybuffer" rather than "uint8array": a Uint8Array is typed over
  // ArrayBufferLike, which includes SharedArrayBuffer and so is not a valid
  // BlobPart from TypeScript 5.7 onward. An ArrayBuffer always is.
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return readSkin(new File([bytes], name));
}

/** Reports a fixed image size so orientation handling can be exercised. */
function sized(width: number, height: number, log: string[]): ImageProcessor {
  return {
    ...passthroughProcessor,
    async measure() {
      return { width, height };
    },
    async rotate(bytes, degrees) {
      log.push(`rotate:${degrees}`);
      return bytes;
    },
    async scaleBy(bytes, factor) {
      log.push(`scaleBy:${factor}`);
      return bytes;
    },
  };
}

const QUAVER_INI = "[General]\r\nName = T\r\n\r\n[4K]\r\nColumnSize = 90\r\n";
const OSU_INI = "[General]\r\nName: T\r\n\r\n[Mania]\r\nKeys: 4\r\nColumnWidth: 30,30,30,30\r\n";
const HEALTH = ["Health/health-background.png", "Health/health-foreground.png"];

describe("health bar, Quaver -> osu!", () => {
  it("maps both pieces onto osu!'s scorebar", async () => {
    const { pkg, report } = await convertSkin(await build("t.qs", HEALTH, QUAVER_INI));
    const out = new Set(pkg.entries.map((e) => e.path));

    expect(out.has("scorebar-bg.png")).toBe(true);
    expect(out.has("scorebar-colour.png")).toBe(true);
    expect(report.entries.filter((e) => e.elementId.startsWith("health")).length).toBeGreaterThan(0);
  });

  it("ships both sizes, as with every natively-drawn element", async () => {
    const { pkg } = await convertSkin(await build("t.qs", HEALTH, QUAVER_INI));
    const out = new Set(pkg.entries.map((e) => e.path));
    expect(out.has("scorebar-bg@2x.png")).toBe(true);
    expect(out.has("scorebar-colour@2x.png")).toBe(true);
  });

  it("scales out of Quaver's 768-high space", async () => {
    const log: string[] = [];
    await convertSkin(await build("t.qs", HEALTH, QUAVER_INI), { processor: sized(600, 40, log) });
    expect(log).toContain("scaleBy:0.625");
    expect(log).toContain("scaleBy:1.25");
  });

  it("leaves a horizontal bar unrotated", async () => {
    const log: string[] = [];
    await convertSkin(await build("t.qs", HEALTH, QUAVER_INI), { processor: sized(600, 40, log) });
    expect(log.some((l) => l.startsWith("rotate:"))).toBe(false);
  });

  it("rotates a vertical bar onto osu!'s horizontal scorebar", async () => {
    const log: string[] = [];
    const { report } = await convertSkin(await build("t.qs", HEALTH, QUAVER_INI), {
      processor: sized(40, 600, log),
    });
    // Clockwise, so the bottom of the bar becomes the left edge and the fill
    // still runs in the direction osu! expects. The opposite turn puts bottom
    // on the right and renders the bar backwards.
    expect(VERTICAL_TO_HORIZONTAL_DEGREES).toBe(90);
    expect(log).toContain("rotate:90");
    expect(report.entries.find((e) => e.elementId === "healthBackground")?.detail).toMatch(/rotated/i);
  });

  it("blanks osu!'s marker rather than letting its default art through", async () => {
    const { pkg, report } = await convertSkin(await build("t.qs", HEALTH, QUAVER_INI));
    const marker = pkg.entries.find((e) => e.path === "scorebar-marker.png");

    expect(marker).toBeDefined();
    expect(marker!.bytes).toEqual(transparentPixel());
    expect(report.entries.some((e) => e.elementId === "healthExtras")).toBe(true);
  });

  it("does not blank anything when the skin has no health bar", async () => {
    const { pkg } = await convertSkin(await build("t.qs", ["4k/HitObjects/note-hitobject-1.png"], QUAVER_INI));
    expect(pkg.entries.some((e) => e.path.startsWith("scorebar-"))).toBe(false);
  });
});

describe("health bar, osu! -> Quaver", () => {
  it("maps the scorebar back into Quaver's Health folder", async () => {
    const { pkg } = await convertSkin(
      await build("t.osk", ["scorebar-bg.png", "scorebar-colour.png"], OSU_INI),
    );
    const out = new Set(pkg.entries.map((e) => e.path));
    expect(out.has("Health/health-background.png")).toBe(true);
    expect(out.has("Health/health-foreground.png")).toBe(true);
  });

  it("grows the bar into Quaver's 768-high space", async () => {
    const log: string[] = [];
    await convertSkin(await build("t.osk", ["scorebar-bg.png"], OSU_INI), {
      processor: sized(600, 40, log),
    });
    expect(log).toContain("scaleBy:1.6");
  });

  it("prefers an @2x scorebar when the skin ships one", async () => {
    const { report } = await convertSkin(
      await build("t.osk", ["scorebar-bg.png", "scorebar-bg@2x.png"], OSU_INI),
    );
    expect(report.entries.find((e) => e.elementId === "healthBackground")?.from).toBe("scorebar-bg@2x.png");
  });

  it("does not also carry the source through", async () => {
    const { pkg, report } = await convertSkin(
      await build("t.osk", ["scorebar-bg.png", "scorebar-colour.png"], OSU_INI),
    );
    expect(pkg.entries.some((e) => e.path === "scorebar-bg.png")).toBe(false);
    expect(report.counts.carried).toBe(0);
  });
});

describe("the transparent pixel", () => {
  it("is a real, decodable PNG", () => {
    const bytes = transparentPixel();
    // PNG magic number — osu! must be able to load it, not just find a file.
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBeGreaterThan(40);
  });
});
