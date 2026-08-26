/**
 * Read/write helpers over the lossless document.
 *
 * Everything here is repeat-aware: `sections(doc, "Mania")` returns every
 * `[Mania]` block in file order, because that is how osu! encodes one
 * keymode per block. Callers pick the block they want by inspecting its
 * `Keys` value.
 */

import type { IniDocument, PairNode } from "./document";

export interface SectionSlice {
  name: string;
  /** Index of the `[Name]` line itself. */
  headerIndex: number;
  /** Node range holding this section's body, `[start, end)`. */
  start: number;
  end: number;
}

/** Every section in the document, in file order, including repeats. */
export function allSections(doc: IniDocument): SectionSlice[] {
  const out: SectionSlice[] = [];
  doc.nodes.forEach((node, i) => {
    if (node.kind !== "section") return;
    if (out.length > 0) out[out.length - 1]!.end = i;
    out.push({ name: node.name, headerIndex: i, start: i + 1, end: doc.nodes.length });
  });
  return out;
}

/** Sections matching `name`, case-insensitively. osu! and Quaver disagree on casing. */
export function sections(doc: IniDocument, name: string): SectionSlice[] {
  const wanted = name.toLowerCase();
  return allSections(doc).filter((s) => s.name.toLowerCase() === wanted);
}

function pairsIn(doc: IniDocument, slice: SectionSlice): PairNode[] {
  const out: PairNode[] = [];
  for (let i = slice.start; i < slice.end; i++) {
    const node = doc.nodes[i];
    if (node?.kind === "pair") out.push(node);
  }
  return out;
}

/** All key/value pairs in a section, as a plain object. Later keys win. */
export function readSection(doc: IniDocument, slice: SectionSlice): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairsIn(doc, slice)) out[pair.key.trim()] = pair.value.trim();
  return out;
}

export function get(doc: IniDocument, slice: SectionSlice, key: string): string | undefined {
  const wanted = key.toLowerCase();
  for (const pair of pairsIn(doc, slice)) {
    if (pair.key.trim().toLowerCase() === wanted) return pair.value.trim();
  }
  return undefined;
}

/**
 * Set a key inside a section, editing the existing line in place when one
 * exists so its formatting survives. Returns true if an existing line was
 * updated, false if a new line had to be inserted.
 */
export function set(doc: IniDocument, slice: SectionSlice, key: string, value: string): boolean {
  const wanted = key.toLowerCase();
  for (let i = slice.start; i < slice.end; i++) {
    const node = doc.nodes[i];
    if (node?.kind === "pair" && node.key.trim().toLowerCase() === wanted) {
      node.value = value;
      return true;
    }
  }

  // Insert after the last non-blank line of the section so we do not push
  // trailing whitespace further down the file on every write.
  let insertAt = slice.end;
  while (insertAt > slice.start && doc.nodes[insertAt - 1]?.kind === "blank") insertAt--;

  const template = pairsIn(doc, slice)[0];
  doc.nodes.splice(insertAt, 0, {
    kind: "pair",
    key,
    value,
    indent: template?.indent ?? "",
    separator: template?.separator ?? " = ",
    trailing: "",
  });
  return false;
}

/** Section names in file order, deduplicated, preserving first-seen casing. */
export function sectionNames(doc: IniDocument): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of allSections(doc)) {
    const k = s.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.name);
  }
  return out;
}

export function countPairs(doc: IniDocument): number {
  return doc.nodes.reduce((n, node) => (node.kind === "pair" ? n + 1 : n), 0);
}
