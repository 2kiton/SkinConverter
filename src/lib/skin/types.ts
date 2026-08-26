import type { IniDocument } from "../ini/document";

export type SkinFormat = "quaver" | "osu";

export interface SkinEntry {
  /** Path relative to the skin root, forward-slashed, root prefix stripped. */
  path: string;
  /** Path exactly as stored in the archive, before normalization. */
  originalPath: string;
  bytes: Uint8Array;
}

export interface SkinPackage {
  /** Base name of the uploaded file, without extension. */
  name: string;
  format: SkinFormat;
  /** Why the detector chose that format. Surfaced in the UI. */
  detection: DetectionResult;
  /** Every non-directory entry, skin.ini included. */
  entries: SkinEntry[];
  /** Parsed skin.ini, or null when the archive has none. */
  ini: IniDocument | null;
  /** Raw skin.ini text as read, kept for the round-trip assertion. */
  iniSource: string | null;
  /** Path skin.ini was found at, e.g. `skin.ini`. Casing varies in the wild. */
  iniPath: string | null;
  /** Single top-level folder stripped from every path, if the archive had one. */
  strippedRoot: string | null;
}

export interface DetectionSignal {
  format: SkinFormat;
  weight: number;
  reason: string;
}

export interface DetectionResult {
  format: SkinFormat;
  signals: DetectionSignal[];
  /** True when signals for both formats were found; the skin may be a hybrid. */
  ambiguous: boolean;
}

export const FORMAT_LABEL: Record<SkinFormat, string> = {
  quaver: "Quaver",
  osu: "osu!mania",
};

export const FORMAT_EXTENSION: Record<SkinFormat, string> = {
  quaver: ".qs",
  osu: ".osk",
};
