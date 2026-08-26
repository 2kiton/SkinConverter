/**
 * Locating source files.
 *
 * Skins in the wild are inconsistent about casing, and both formats have a
 * fallback scheme that has to be honoured or half the elements come back
 * empty:
 *
 *   - Quaver: a keymode may set `UseFallback = True` and keep its textures in
 *     `/sharedk/`, with `*Fallbacks` integer lists remapping lane -> texture
 *     index. `HoldBodyFallbacks = 1,3` in `[1K]` means lane 1 uses
 *     `note-holdbody-1.png` and the scratch lane uses `note-holdbody-3.png`.
 *   - osu!: an element may ship an `@2x` high-DPI variant, which is the better
 *     source to convert from.
 */

import type { SkinEntry } from "../skin/types";

export class FileIndex {
  private readonly byLowerPath = new Map<string, SkinEntry>();

  constructor(entries: SkinEntry[]) {
    for (const entry of entries) this.byLowerPath.set(entry.path.toLowerCase(), entry);
  }

  /** Exact lookup, case-insensitive. */
  get(path: string): SkinEntry | undefined {
    return this.byLowerPath.get(path.toLowerCase());
  }

  has(path: string): boolean {
    return this.byLowerPath.has(path.toLowerCase());
  }

  /**
   * Look up an osu! element, preferring its `@2x` variant.
   *
   * osu! image references in skin.ini omit the extension, and both `.png` and
   * `.jpg` are legal, so we try the plausible spellings in quality order.
   */
  findOsu(baseName: string): { entry: SkinEntry; hd: boolean } | undefined {
    const stem = baseName.replace(/\.(png|jpe?g)$/i, "");
    for (const ext of ["png", "jpg", "jpeg"]) {
      const hd = this.get(`${stem}@2x.${ext}`);
      if (hd) return { entry: hd, hd: true };
    }
    for (const ext of ["png", "jpg", "jpeg"]) {
      const sd = this.get(`${stem}.${ext}`);
      if (sd) return { entry: sd, hd: false };
    }
    return undefined;
  }

  /**
   * Find every animation frame for an osu! element: `name-0.png`, `name-1.png`
   * and so on, in index order. Empty when the element is a still image.
   */
  findOsuFrames(baseName: string): SkinEntry[] {
    const stem = baseName.replace(/\.(png|jpe?g)$/i, "").toLowerCase();
    const frames: { index: number; entry: SkinEntry }[] = [];
    const pattern = new RegExp(`^${escapeRegExp(stem)}-(\\d+)(@2x)?\\.(png|jpe?g)$`);

    for (const [path, entry] of this.byLowerPath) {
      const match = pattern.exec(path);
      if (match) frames.push({ index: Number(match[1]), entry });
    }
    frames.sort((a, b) => a.index - b.index);
    return frames.map((f) => f.entry);
  }

  /**
   * Find a Quaver spritesheet and its grid, e.g. `hitlighting@1x12.png`.
   * Quaver writes the suffix as `@{rows}x{columns}`.
   */
  findQuaverSheet(basePath: string): { entry: SkinEntry; rows: number; cols: number } | undefined {
    const stem = basePath.replace(/\.png$/i, "").toLowerCase();
    const pattern = new RegExp(`^${escapeRegExp(stem)}@(\\d+)x(\\d+)\\.png$`);
    for (const [path, entry] of this.byLowerPath) {
      const match = pattern.exec(path);
      if (match) return { entry, rows: Number(match[1]), cols: Number(match[2]) };
    }
    return undefined;
  }

  get size(): number {
    return this.byLowerPath.size;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A Quaver keymode's fallback configuration, read from its skin.ini section. */
export interface QuaverFallbacks {
  useFallback: boolean;
  hitObject: number[];
  holdBody: number[];
  holdEnd: number[];
  receptor: number[];
}

export const NO_FALLBACKS: QuaverFallbacks = {
  useFallback: false,
  hitObject: [],
  holdBody: [],
  holdEnd: [],
  receptor: [],
};

/** Which sharedk texture index a lane should use, given its fallback list. */
export function fallbackIndexFor(list: number[], lane: number): number {
  // Lists are 1-based by lane, matching the wiki's "starting at lane 1".
  return list[lane - 1] ?? lane;
}
