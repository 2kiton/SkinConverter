/**
 * The canvas pipeline.
 *
 * The two formats animate in structurally opposite ways: osu! uses numbered
 * frame files (`mania-hit300-0.png`, `-1.png`, …) paced by
 * `AnimationFramerate`, while Quaver uses one spritesheet named
 * `name@{rows}x{columns}.png` played at a fixed rate. Converting either way
 * means moving actual pixels, not renaming files.
 *
 * `ImageProcessor` is an interface so the converter can run headless in tests
 * with `passthroughProcessor`, and in the browser with `canvasProcessor()`.
 */

export interface PackedSheet {
  bytes: Uint8Array;
  rows: number;
  cols: number;
}

export interface ImageProcessor {
  /** Cut a Quaver spritesheet into frames, left-to-right then top-to-bottom. */
  sliceSheet(bytes: Uint8Array, rows: number, cols: number): Promise<Uint8Array[]>;
  /** Pack frames into a single-row Quaver spritesheet. */
  packSheet(frames: Uint8Array[]): Promise<PackedSheet>;
  /** Mirror an image vertically. */
  flipVertical(bytes: Uint8Array): Promise<Uint8Array>;
  /** Rotate clockwise by degrees, growing the canvas so nothing is clipped. */
  rotate(bytes: Uint8Array, degrees: number): Promise<Uint8Array>;
  /**
   * Fit an image into a box of the given aspect ratio without distorting it,
   * padding with transparency. Used for receptors, because osu! stretches key
   * images to the column box while Quaver preserves aspect ratio.
   */
  letterbox(bytes: Uint8Array, aspect: number): Promise<Uint8Array>;
}

/** Does nothing but hand the bytes back. Used in tests and on the server. */
export const passthroughProcessor: ImageProcessor = {
  async sliceSheet(bytes) {
    return [bytes];
  },
  async packSheet(frames) {
    return { bytes: frames[0] ?? new Uint8Array(), rows: 1, cols: frames.length };
  },
  async flipVertical(bytes) {
    return bytes;
  },
  async rotate(bytes) {
    return bytes;
  },
  async letterbox(bytes) {
    return bytes;
  },
};

/** Browser implementation, backed by OffscreenCanvas where available. */
export function canvasProcessor(): ImageProcessor {
  return {
    async sliceSheet(bytes, rows, cols) {
      if (rows < 1 || cols < 1) return [bytes];
      const bitmap = await decode(bytes);
      const frameW = Math.floor(bitmap.width / cols);
      const frameH = Math.floor(bitmap.height / rows);
      if (frameW < 1 || frameH < 1) return [bytes];

      const out: Uint8Array[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const { canvas, ctx } = surface(frameW, frameH);
          ctx.drawImage(bitmap, c * frameW, r * frameH, frameW, frameH, 0, 0, frameW, frameH);
          out.push(await encode(canvas));
        }
      }
      bitmap.close?.();
      return out;
    },

    async packSheet(frames) {
      if (frames.length === 0) return { bytes: new Uint8Array(), rows: 1, cols: 0 };
      const bitmaps = await Promise.all(frames.map(decode));

      // Frames may differ in size; size the cell to the largest and centre
      // each frame in it, so nothing is cropped and nothing drifts.
      const cellW = Math.max(...bitmaps.map((b) => b.width));
      const cellH = Math.max(...bitmaps.map((b) => b.height));
      const { canvas, ctx } = surface(cellW * bitmaps.length, cellH);

      bitmaps.forEach((bitmap, i) => {
        const x = i * cellW + (cellW - bitmap.width) / 2;
        const y = (cellH - bitmap.height) / 2;
        ctx.drawImage(bitmap, x, y);
        bitmap.close?.();
      });

      // Quaver writes the suffix as @{rows}x{columns}; a strip is 1 row.
      return { bytes: await encode(canvas), rows: 1, cols: bitmaps.length };
    },

    async flipVertical(bytes) {
      const bitmap = await decode(bytes);
      const { canvas, ctx } = surface(bitmap.width, bitmap.height);
      ctx.translate(0, bitmap.height);
      ctx.scale(1, -1);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return encode(canvas);
    },

    async rotate(bytes, degrees) {
      const normalized = ((degrees % 360) + 360) % 360;
      if (normalized === 0) return bytes;

      const bitmap = await decode(bytes);
      const radians = (normalized * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const width = Math.ceil(bitmap.width * cos + bitmap.height * sin);
      const height = Math.ceil(bitmap.width * sin + bitmap.height * cos);

      const { canvas, ctx } = surface(width, height);
      ctx.translate(width / 2, height / 2);
      ctx.rotate(radians);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      bitmap.close?.();
      return encode(canvas);
    },

    async letterbox(bytes, aspect) {
      if (!Number.isFinite(aspect) || aspect <= 0) return bytes;
      const bitmap = await decode(bytes);
      const current = bitmap.width / bitmap.height;
      // Already the right shape, to within a rounding pixel.
      if (Math.abs(current - aspect) < 0.001) {
        bitmap.close?.();
        return bytes;
      }

      const width = current > aspect ? bitmap.width : Math.round(bitmap.height * aspect);
      const height = current > aspect ? Math.round(bitmap.width / aspect) : bitmap.height;
      const { canvas, ctx } = surface(width, height);
      ctx.drawImage(bitmap, (width - bitmap.width) / 2, (height - bitmap.height) / 2);
      bitmap.close?.();
      return encode(canvas);
    },
  };
}

// ---------------------------------------------------------------- plumbing

type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D };

function surface(width: number, height: number): Surface {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D context");
    return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D };
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context");
  return { canvas, ctx };
}

async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  // Copy into a fresh buffer: the source may be a view over a larger one.
  const copy = new Uint8Array(bytes);
  return createImageBitmap(new Blob([copy.buffer as ArrayBuffer]));
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
            "image/png",
          ),
        );
  return new Uint8Array(await blob.arrayBuffer());
}
