import JSZip from "jszip";
import { serializeIni } from "../ini/document";
import type { SkinPackage } from "./types";

const ENCODER = new TextEncoder();

/**
 * Re-pack a skin. Every entry other than skin.ini is copied through as the
 * exact bytes we read, so image data is never re-encoded.
 *
 * Quaver's own exporter stores entries uncompressed. We match that for `.qs`
 * so our output resembles what the game itself produces; osu! is happy with
 * deflate and the smaller file is worth having.
 */
export async function writeSkin(pkg: SkinPackage): Promise<Blob> {
  const zip = new JSZip();

  for (const entry of pkg.entries) {
    const isIni = pkg.iniPath !== null && entry.path === pkg.iniPath;
    const bytes = isIni && pkg.ini ? ENCODER.encode(serializeIni(pkg.ini)) : entry.bytes;
    zip.file(entry.path, bytes);
  }

  if (pkg.format === "quaver") {
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  }
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next frame; revoking synchronously cancels the download in Safari.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
