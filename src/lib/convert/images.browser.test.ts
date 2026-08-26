import { describe, it, expect } from "vitest";
import { canvasProcessor } from "./images";

/**
 * Pixel-level tests for the canvas pipeline, running in real Chromium.
 *
 * The Node suite can only assert which operation was called with which
 * arguments — it injects a fake processor, because canvas does not exist
 * there. These are the tests that actually look at the output.
 */

const proc = canvasProcessor();

type Rgba = [number, number, number, number];

/** Build a PNG of solid vertical bands, one per colour. */
async function bands(colours: Rgba[], width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const bandWidth = width / colours.length;
  colours.forEach((c, i) => {
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
    ctx.fillRect(i * bandWidth, 0, bandWidth, height);
  });
  return toBytes(canvas);
}

/** Build a PNG whose top half and bottom half differ, for flip tests. */
async function halves(top: Rgba, bottom: Rgba, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `rgb(${top[0]},${top[1]},${top[2]})`;
  ctx.fillRect(0, 0, width, height / 2);
  ctx.fillStyle = `rgb(${bottom[0]},${bottom[1]},${bottom[2]})`;
  ctx.fillRect(0, height / 2, width, height / 2);
  return toBytes(canvas);
}

async function toBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function inspect(bytes: Uint8Array) {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const ctx = canvas.getContext("2d")!;
  return {
    width: bitmap.width,
    height: bitmap.height,
    at(x: number, y: number): Rgba {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!];
    },
  };
}

function near(actual: Rgba, expected: Rgba, tolerance = 6) {
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tolerance);
  }
}

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const WHITE: Rgba = [255, 255, 255, 255];

describe("sliceSheet", () => {
  it("cuts a Quaver @1x4 strip into four frames in order", async () => {
    const sheet = await bands([RED, GREEN, BLUE, WHITE], 400, 100);
    const frames = await proc.sliceSheet(sheet, 1, 4);

    expect(frames).toHaveLength(4);
    const expected = [RED, GREEN, BLUE, WHITE];
    for (let i = 0; i < 4; i++) {
      const img = await inspect(frames[i]!);
      expect(img.width).toBe(100);
      expect(img.height).toBe(100);
      near(img.at(50, 50), expected[i]!);
    }
  });

  it("reads a grid left-to-right then top-to-bottom", async () => {
    // 2 rows x 2 cols: top row red/green, bottom row blue/white.
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    const cells: [Rgba, number, number][] = [
      [RED, 0, 0],
      [GREEN, 100, 0],
      [BLUE, 0, 100],
      [WHITE, 100, 100],
    ];
    for (const [c, x, y] of cells) {
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x, y, 100, 100);
    }

    const frames = await proc.sliceSheet(await toBytes(canvas), 2, 2);
    expect(frames).toHaveLength(4);
    const order = [RED, GREEN, BLUE, WHITE];
    for (let i = 0; i < 4; i++) {
      near((await inspect(frames[i]!)).at(50, 50), order[i]!);
    }
  });

  it("hands the image back untouched for a nonsense grid", async () => {
    const src = await bands([RED], 40, 40);
    expect(await proc.sliceSheet(src, 0, 0)).toEqual([src]);
  });
});

describe("packSheet", () => {
  it("packs frames into a single row, preserving order", async () => {
    const frames = await Promise.all([
      bands([RED], 60, 60),
      bands([GREEN], 60, 60),
      bands([BLUE], 60, 60),
    ]);
    const packed = await proc.packSheet(frames);

    // Quaver names sheets @{rows}x{columns}; a strip is one row.
    expect(packed.rows).toBe(1);
    expect(packed.cols).toBe(3);

    const img = await inspect(packed.bytes);
    expect(img.width).toBe(180);
    expect(img.height).toBe(60);
    near(img.at(30, 30), RED);
    near(img.at(90, 30), GREEN);
    near(img.at(150, 30), BLUE);
  });

  it("centres frames of differing sizes in a common cell", async () => {
    const packed = await proc.packSheet([await bands([RED], 40, 40), await bands([GREEN], 80, 80)]);
    const img = await inspect(packed.bytes);

    expect(img.width).toBe(160);
    expect(img.height).toBe(80);
    // The small frame sits centred in an 80x80 cell, so its centre is opaque
    // red while the cell corner stays transparent.
    near(img.at(40, 40), RED);
    expect(img.at(2, 2)[3]).toBe(0);
  });

  it("round-trips through sliceSheet", async () => {
    const originals = [RED, GREEN, BLUE];
    const packed = await proc.packSheet(
      await Promise.all(originals.map((c) => bands([c], 50, 50))),
    );
    const frames = await proc.sliceSheet(packed.bytes, packed.rows, packed.cols);

    expect(frames).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      near((await inspect(frames[i]!)).at(25, 25), originals[i]!);
    }
  });
});

describe("flipVertical", () => {
  it("swaps top and bottom", async () => {
    const src = await halves(RED, BLUE, 40, 40);
    const img = await inspect(await proc.flipVertical(src));

    expect(img.width).toBe(40);
    expect(img.height).toBe(40);
    near(img.at(20, 10), BLUE);
    near(img.at(20, 30), RED);
  });
});

describe("rotate", () => {
  it("grows the canvas so a 90-degree turn clips nothing", async () => {
    const src = await bands([RED], 100, 40);
    const img = await inspect(await proc.rotate(src, 90));
    expect(img.width).toBe(40);
    expect(img.height).toBe(100);
  });

  it("moves the left band to the top when turning clockwise", async () => {
    const src = await bands([RED, BLUE], 80, 80);
    const img = await inspect(await proc.rotate(src, 90));
    near(img.at(40, 20), RED);
    near(img.at(40, 60), BLUE);
  });

  it("is a no-op at 0 and 360 degrees", async () => {
    const src = await bands([RED], 30, 30);
    expect(await proc.rotate(src, 0)).toEqual(src);
    expect(await proc.rotate(src, 360)).toEqual(src);
  });
});

describe("letterbox", () => {
  it("pads to the target aspect without distorting the art", async () => {
    // A 100x40 receptor padded into a 1:1 box.
    const src = await bands([RED], 100, 40);
    const img = await inspect(await proc.letterbox(src, 1));

    expect(img.width).toBe(100);
    expect(img.height).toBe(100);
    // Art keeps its own height, centred; the padding above it is transparent.
    near(img.at(50, 50), RED);
    expect(img.at(50, 5)[3]).toBe(0);
    expect(img.at(50, 95)[3]).toBe(0);
  });

  it("pads horizontally when the source is too tall", async () => {
    const src = await bands([RED], 40, 100);
    const img = await inspect(await proc.letterbox(src, 1));
    expect(img.width).toBe(100);
    expect(img.height).toBe(100);
    expect(img.at(5, 50)[3]).toBe(0);
  });

  it("leaves an image that is already the right shape alone", async () => {
    const src = await bands([RED], 50, 50);
    expect(await proc.letterbox(src, 1)).toEqual(src);
  });
});

describe("stretchToAspect", () => {
  it("distorts deliberately to the target aspect", async () => {
    const src = await bands([RED], 100, 100);
    const img = await inspect(await proc.stretchToAspect(src, 2));
    expect(img.width).toBe(100);
    expect(img.height).toBe(50);
    // Unlike letterbox, the art fills the frame — no transparent padding.
    expect(img.at(50, 25)[3]).toBe(255);
    expect(img.at(2, 2)[3]).toBe(255);
  });
});

describe("lane colours", () => {
  it("paints per-lane bands at the right positions", async () => {
    const lanes = [
      { x: 0, width: 50, colour: { r: 255, g: 0, b: 0, a: 255 } },
      { x: 50, width: 50, colour: { r: 0, g: 255, b: 0, a: 255 } },
      { x: 100, width: 50, colour: null },
    ];
    const img = await inspect(await proc.laneStripes(lanes, 150, 60));

    expect(img.width).toBe(150);
    near(img.at(25, 30), RED);
    near(img.at(75, 30), GREEN);
    // A lane with no colour stays transparent rather than painting black.
    expect(img.at(125, 30)[3]).toBe(0);
  });

  it("recovers the colours it painted", async () => {
    const lanes = [
      { x: 0, width: 50, colour: { r: 200, g: 40, b: 40, a: 255 } },
      { x: 50, width: 50, colour: { r: 40, g: 40, b: 200, a: 255 } },
    ];
    const mask = await proc.laneStripes(lanes, 100, 40);
    const sampled = await proc.sampleLaneColours(mask, lanes, 100);

    expect(sampled).toHaveLength(2);
    near(
      [sampled[0]!.r, sampled[0]!.g, sampled[0]!.b, sampled[0]!.a],
      [200, 40, 40, 255],
      3,
    );
    near(
      [sampled[1]!.r, sampled[1]!.g, sampled[1]!.b, sampled[1]!.a],
      [40, 40, 200, 255],
      3,
    );
  });

  it("scales lane slots onto a mask of a different pixel size", async () => {
    // Slots are in 768-space units; the mask is whatever the skin author drew.
    const source = await bands([RED, BLUE], 400, 100);
    const lanes = [
      { x: 0, width: 45, colour: null },
      { x: 45, width: 45, colour: null },
    ];
    const sampled = await proc.sampleLaneColours(source, lanes, 90);
    near([sampled[0]!.r, sampled[0]!.g, sampled[0]!.b, sampled[0]!.a], RED, 3);
    near([sampled[1]!.r, sampled[1]!.g, sampled[1]!.b, sampled[1]!.a], BLUE, 3);
  });
});
