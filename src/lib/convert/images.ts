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

/** One lane's slot in the stage, in any consistent unit. */
export interface LaneSlot {
  x: number;
  width: number;
  colour: { r: number; g: number; b: number; a: number } | null;
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
   * padding with transparency. Used when the destination will stretch the
   * result: pre-padding means the stretch lands on empty space, not on art.
   */
  letterbox(bytes: Uint8Array, aspect: number): Promise<Uint8Array>;
  /**
   * Resize to an aspect ratio, distorting deliberately. The mirror of
   * `letterbox`: used when the SOURCE game stretched an image and the
   * destination will not, so the stretch has to be baked in to preserve how it
   * actually looked.
   */
  stretchToAspect(bytes: Uint8Array, aspect: number): Promise<Uint8Array>;
  /** Pixel dimensions, or null when the bytes cannot be decoded. */
  measure(bytes: Uint8Array): Promise<{ width: number; height: number } | null>;
  /**
   * Grow the canvas upward by `pixels`, leaving the new space transparent and
   * the original content anchored at the bottom.
   *
   * Used to shift an element a game seats in the wrong place: a taller sprite
   * drawn from the same anchor moves its visible content.
   */
  padTop(bytes: Uint8Array, pixels: number): Promise<Uint8Array>;
  /** Scale by a uniform factor, preserving aspect. */
  scaleBy(bytes: Uint8Array, factor: number): Promise<Uint8Array>;
  /** Resize so the image is exactly `width` pixels across, preserving aspect. */
  resizeToWidth(bytes: Uint8Array, width: number): Promise<Uint8Array>;
  /** Draw flat per-lane colour bands — a Quaver stage background from osu! lane colours. */
  laneStripes(lanes: LaneSlot[], width: number, height: number): Promise<Uint8Array>;
  /** Average the colour under each lane slot — the inverse of `laneStripes`. */
  sampleLaneColours(
    bytes: Uint8Array,
    lanes: LaneSlot[],
    totalWidth: number,
  ): Promise<({ r: number; g: number; b: number; a: number } | null)[]>;
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
  async stretchToAspect(bytes) {
    return bytes;
  },
  async measure() {
    return null;
  },
  async padTop(bytes) {
    return bytes;
  },
  async scaleBy(bytes) {
    return bytes;
  },
  async resizeToWidth(bytes) {
    return bytes;
  },
  async laneStripes() {
    return new Uint8Array();
  },
  async sampleLaneColours(_bytes, lanes) {
    return lanes.map(() => null);
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
      // Math.cos(PI/2) is 6.1e-17, not 0, so a plain ceil() adds a stray
      // transparent pixel on every right-angle turn — and right angles are
      // the common case for arrow skins. Snap the near-zero and near-one
      // values before measuring.
      const cos = snap(Math.abs(Math.cos(radians)));
      const sin = snap(Math.abs(Math.sin(radians)));
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

    async stretchToAspect(bytes, aspect) {
      if (!Number.isFinite(aspect) || aspect <= 0) return bytes;
      const bitmap = await decode(bytes);
      if (Math.abs(bitmap.width / bitmap.height - aspect) < 0.001) {
        bitmap.close?.();
        return bytes;
      }

      // Keep the longer edge so nothing is downsampled away.
      const width = bitmap.width;
      const height = Math.max(1, Math.round(width / aspect));
      const { canvas, ctx } = surface(width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      return encode(canvas);
    },

    async measure(bytes) {
      try {
        const bitmap = await decode(bytes);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close?.();
        return size;
      } catch {
        // A corrupt or unsupported image should not abort the conversion.
        return null;
      }
    },

    async padTop(bytes, pixels) {
      const extra = Math.round(pixels);
      if (!Number.isFinite(extra) || extra <= 0) return bytes;

      const bitmap = await decode(bytes);
      const { canvas, ctx } = surface(bitmap.width, bitmap.height + extra);
      // Original content sits at the bottom; the new space is above it.
      ctx.drawImage(bitmap, 0, extra);
      bitmap.close?.();
      return encode(canvas);
    },

    async scaleBy(bytes, factor) {
      if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.001) return bytes;
      const bitmap = await decode(bytes);
      return redraw(bitmap, Math.max(1, Math.round(bitmap.width * factor)));
    },

    async resizeToWidth(bytes, width) {
      if (!Number.isFinite(width) || width <= 0) return bytes;
      const bitmap = await decode(bytes);
      if (Math.abs(bitmap.width - width) < 1) {
        bitmap.close?.();
        return bytes;
      }
      return redraw(bitmap, Math.max(1, Math.round(width)));
    },

    async laneStripes(lanes, width, height) {
      const { canvas, ctx } = surface(width, height);
      for (const lane of lanes) {
        if (!lane.colour) continue;
        const { r, g, b, a } = lane.colour;
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(Math.round(lane.x), 0, Math.round(lane.width), height);
      }
      return encode(canvas);
    },

    async sampleLaneColours(bytes, lanes, totalWidth) {
      const bitmap = await decode(bytes);
      const { ctx } = surface(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / Math.max(1, totalWidth);

      const out = lanes.map((lane) => {
        const x = Math.round(lane.x * scale);
        const w = Math.max(1, Math.round(lane.width * scale));
        if (x < 0 || x >= bitmap.width) return null;

        const data = ctx.getImageData(x, 0, Math.min(w, bitmap.width - x), bitmap.height).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        const pixels = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          a += data[i + 3] ?? 0;
        }
        return {
          r: Math.round(r / pixels),
          g: Math.round(g / pixels),
          b: Math.round(b / pixels),
          a: Math.round(a / pixels),
        };
      });

      bitmap.close?.();
      return out;
    },
  };
}

// ---------------------------------------------------------------- plumbing

type Surface = { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/** Redraw a bitmap at a new width, keeping its aspect ratio. */
async function redraw(bitmap: ImageBitmap, width: number): Promise<Uint8Array> {
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
  const { canvas, ctx } = surface(width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return encode(canvas);
}

/** Pull a floating-point trig result back onto an exact 0 or 1. */
function snap(value: number): number {
  if (Math.abs(value) < 1e-9) return 0;
  if (Math.abs(value - 1) < 1e-9) return 1;
  return value;
}

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
  // Feature-detect rather than `instanceof OffscreenCanvas`: `surface()` falls
  // back to an HTMLCanvasElement when OffscreenCanvas is missing, and naming
  // the constructor here would throw a ReferenceError in exactly those
  // browsers — crashing the fallback path that exists to serve them.
  const blob = isOffscreen(canvas)
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
          "image/png",
        ),
      );
  return new Uint8Array(await blob.arrayBuffer());
}

function isOffscreen(canvas: OffscreenCanvas | HTMLCanvasElement): canvas is OffscreenCanvas {
  return typeof (canvas as OffscreenCanvas).convertToBlob === "function";
}
