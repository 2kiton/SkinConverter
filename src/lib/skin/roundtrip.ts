import { serializeIni } from "../ini/document";
import { allSections, countPairs, sectionNames, get } from "../ini/access";
import type { SkinPackage } from "./types";

export interface RoundTripReport {
  /** True when re-serializing skin.ini reproduces the source byte-for-byte. */
  iniStable: boolean;
  /** First differing character offset, when it is not stable. */
  firstDiffAt: number | null;
  sourceLength: number;
  outputLength: number;
  sectionNames: string[];
  sectionCount: number;
  pairCount: number;
  /** Keymodes the skin configures: `4K`, `7K` for Quaver; `Keys: n` for osu!. */
  keymodes: string[];
  unknownLines: number;
}

/**
 * Stage 1's assertion: parse skin.ini, serialize it again, and require the
 * result to be identical. Any difference means the parser is losing something
 * a skin author wrote, and every later conversion stage would inherit that
 * loss silently.
 */
export function checkRoundTrip(pkg: SkinPackage): RoundTripReport | null {
  if (!pkg.ini || pkg.iniSource === null) return null;

  const output = serializeIni(pkg.ini);
  const source = pkg.iniSource;
  const iniStable = output === source;

  let firstDiffAt: number | null = null;
  if (!iniStable) {
    const max = Math.min(source.length, output.length);
    let i = 0;
    while (i < max && source[i] === output[i]) i++;
    firstDiffAt = i;
  }

  return {
    iniStable,
    firstDiffAt,
    sourceLength: source.length,
    outputLength: output.length,
    sectionNames: sectionNames(pkg.ini),
    sectionCount: allSections(pkg.ini).length,
    pairCount: countPairs(pkg.ini),
    keymodes: readKeymodes(pkg),
    unknownLines: pkg.ini.nodes.filter((n) => n.kind === "unknown").length,
  };
}

function readKeymodes(pkg: SkinPackage): string[] {
  const ini = pkg.ini;
  if (!ini) return [];

  if (pkg.format === "osu") {
    // One [Mania] block per keycount; the block's own `Keys` value names it.
    return sortKeymodes(
      allSections(ini)
        .filter((s) => s.name.toLowerCase() === "mania")
        .map((s) => get(ini, s, "Keys"))
        .filter((k): k is string => !!k)
        .map((k) => `${k}K`),
    );
  }

  return sortKeymodes(
    allSections(ini)
      .map((s) => s.name.toUpperCase())
      .filter((n) => /^(SHAREDK|\d{1,2}K)$/.test(n)),
  );
}

function sortKeymodes(list: string[]): string[] {
  const unique = [...new Set(list)];
  return unique.sort((a, b) => {
    if (a === "SHAREDK") return -1;
    if (b === "SHAREDK") return 1;
    return parseInt(a, 10) - parseInt(b, 10);
  });
}
