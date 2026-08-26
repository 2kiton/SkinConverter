import type { DetectionResult, DetectionSignal, SkinFormat } from "./types";

/**
 * Decide whether an archive is a Quaver or an osu!mania skin.
 *
 * The extension is only a hint: people rename skins, and re-zipped skins lose
 * it entirely. So we score structural evidence and let the extension break
 * ties. Reporting the signals matters as much as the verdict, because a skin
 * that scores on both sides is usually a half-finished manual port and the
 * user needs to know before converting it again.
 */
export function detectFormat(fileName: string, paths: string[], iniText: string | null): DetectionResult {
  const signals: DetectionSignal[] = [];
  const lower = paths.map((p) => p.toLowerCase());

  const ext = fileName.toLowerCase().match(/\.(qs|osk)$/)?.[1];
  if (ext === "qs") signals.push({ format: "quaver", weight: 2, reason: "File extension is .qs" });
  if (ext === "osk") signals.push({ format: "osu", weight: 2, reason: "File extension is .osk" });

  const keymodeDirs = new Set<string>();
  for (const p of lower) {
    const dir = p.match(/^(sharedk|\d{1,2}k)\//)?.[1];
    if (dir) keymodeDirs.add(dir);
  }
  if (keymodeDirs.size > 0) {
    signals.push({
      format: "quaver",
      weight: 5,
      reason: `Keymode folders: ${[...keymodeDirs].sort().join(", ")}`,
    });
  }

  const maniaFiles = lower.filter((p) => /(^|\/)mania-/.test(p)).length;
  if (maniaFiles > 0) {
    signals.push({ format: "osu", weight: 5, reason: `${maniaFiles} mania-* element${maniaFiles === 1 ? "" : "s"}` });
  }

  if (lower.some((p) => /(^|\/)note-(hitobject|holdbody|holdend|holdhitobject|mine)/.test(p))) {
    signals.push({ format: "quaver", weight: 3, reason: "Quaver hit-object filenames" });
  }
  if (lower.some((p) => /(^|\/)receptor-(up|down)-/.test(p))) {
    signals.push({ format: "quaver", weight: 3, reason: "Quaver receptor filenames" });
  }
  if (lower.some((p) => /(^|\/)lighting[nl]\.png$/.test(p))) {
    signals.push({ format: "osu", weight: 2, reason: "osu! hit lighting (lightingN/lightingL)" });
  }

  if (iniText) {
    const headers = [...iniText.matchAll(/^[ \t]*\[([^\]]+)\]/gm)].map((m) => (m[1] ?? "").trim().toLowerCase());
    if (headers.includes("mania")) {
      const count = headers.filter((h) => h === "mania").length;
      signals.push({ format: "osu", weight: 5, reason: `skin.ini has ${count} [Mania] section${count === 1 ? "" : "s"}` });
    }
    const quaverSections = headers.filter((h) => /^(sharedk|\d{1,2}k)$/.test(h));
    if (quaverSections.length > 0) {
      signals.push({
        format: "quaver",
        weight: 5,
        reason: `skin.ini keymode sections: ${quaverSections.map((s) => s.toUpperCase()).join(", ")}`,
      });
    }
  }

  const score = (f: SkinFormat) =>
    signals.filter((s) => s.format === f).reduce((n, s) => n + s.weight, 0);

  const quaver = score("quaver");
  const osu = score("osu");

  // Default to Quaver only when nothing at all was found, and say so.
  if (quaver === 0 && osu === 0) {
    signals.push({ format: "quaver", weight: 0, reason: "No format signals found — defaulting to Quaver" });
  }

  return {
    format: osu > quaver ? "osu" : "quaver",
    signals,
    ambiguous: quaver > 0 && osu > 0,
  };
}
