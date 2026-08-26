import JSZip from "jszip";
import { parseIni } from "../ini/document";
import { detectFormat } from "./detect";
import type { SkinEntry, SkinPackage } from "./types";

/**
 * Both `.qs` and `.osk` are ordinary ZIP archives — Quaver writes its export
 * with SharpCompress at `CompressionType.None`, osu! uses a normal deflate
 * zip — so one reader covers both.
 */
export async function readSkin(file: File): Promise<SkinPackage> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const raw: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    raw.push({ path: entry.name.replace(/\\/g, "/"), bytes: await entry.async("uint8array") });
  }

  if (raw.length === 0) {
    throw new Error("That archive is empty. A skin needs at least one image or a skin.ini.");
  }

  const strippedRoot = findCommonRoot(raw.map((e) => e.path));
  const entries: SkinEntry[] = raw.map((e) => ({
    originalPath: e.path,
    path: strippedRoot ? e.path.slice(strippedRoot.length + 1) : e.path,
    bytes: e.bytes,
  }));

  const iniEntry = entries.find((e) => e.path.toLowerCase() === "skin.ini");
  const iniSource = iniEntry ? decodeText(iniEntry.bytes) : null;

  const name = file.name.replace(/\.(qs|osk|zip)$/i, "") || "skin";
  const detection = detectFormat(file.name, entries.map((e) => e.path), iniSource);

  return {
    name,
    format: detection.format,
    detection,
    entries,
    ini: iniSource === null ? null : parseIni(iniSource),
    iniSource,
    iniPath: iniEntry?.path ?? null,
    strippedRoot,
  };
}

/**
 * Skins re-zipped by hand are usually nested one folder deep. Strip that
 * folder so every downstream path is relative to the skin root — otherwise
 * neither game finds a single element.
 */
function findCommonRoot(paths: string[]): string | null {
  const tops = new Set<string>();
  for (const p of paths) {
    const slash = p.indexOf("/");
    if (slash === -1) return null; // A file sits at the root already.
    tops.add(p.slice(0, slash));
  }
  const only = [...tops];
  return only.length === 1 ? only[0]! : null;
}

/** skin.ini is nominally UTF-8, but older hand-written ones are Windows-1252. */
function decodeText(bytes: Uint8Array): string {
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return strict.decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
