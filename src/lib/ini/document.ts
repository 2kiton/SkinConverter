/**
 * A lossless INI document model.
 *
 * Neither game's skin.ini is quite a standard INI file, and a normal
 * key/value parser destroys both of them:
 *
 *   - osu! separates with a colon (`Keys: 4`), Quaver with an equals
 *     (`ColumnSize = 90`). Files in the wild mix both.
 *   - osu!'s `[Mania]` section REPEATS, once per keycount. A parser that
 *     stores sections in a map keeps only the last one and silently drops
 *     every other keymode in the skin.
 *   - Comment styles differ (`//` in osu!, `;` in Quaver) and skin authors
 *     leave notes to themselves that are worth preserving.
 *
 * So the document keeps every physical line, in order, and edits mutate a
 * line in place. An untouched document re-serializes byte-for-byte; that
 * property is what the round-trip check in `lib/skin/roundtrip.ts` asserts.
 */

export type Eol = "\r\n" | "\n";

export interface BlankNode {
  kind: "blank";
  raw: string;
}

export interface CommentNode {
  kind: "comment";
  raw: string;
}

export interface SectionNode {
  kind: "section";
  /** Section name with surrounding brackets and whitespace removed, e.g. `Mania`. */
  name: string;
  indent: string;
  trailing: string;
}

export interface PairNode {
  kind: "pair";
  key: string;
  value: string;
  indent: string;
  /** The separator exactly as written, including padding, e.g. `" = "` or `": "`. */
  separator: string;
  /** Whitespace after the value, preserved so untouched lines are byte-stable. */
  trailing: string;
}

/** A line we could not classify. Carried through verbatim rather than dropped. */
export interface UnknownNode {
  kind: "unknown";
  raw: string;
}

export type IniNode = BlankNode | CommentNode | SectionNode | PairNode | UnknownNode;

export interface IniDocument {
  nodes: IniNode[];
  /** Dominant line ending in the source, reused when serializing. */
  eol: Eol;
  /** Whether the source ended with a line break. */
  finalNewline: boolean;
  /** Byte-order mark, if the source had one. Re-emitted verbatim. */
  bom: string;
}

const SECTION_RE = /^([ \t]*)\[([^\]]*)\](.*)$/;
// A key may not contain a separator character; the first `=` or `:` wins.
const PAIR_RE = /^([ \t]*)([^=:\r\n]+?)([ \t]*[:=][ \t]*)(.*?)([ \t]*)$/;
const COMMENT_RE = /^[ \t]*(?:[;#]|\/\/)/;

export function parseIni(source: string): IniDocument {
  let bom = "";
  let text = source;
  if (text.charCodeAt(0) === 0xfeff) {
    bom = "\uFEFF";
    text = text.slice(1);
  }

  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const eol: Eol = crlf >= lf && crlf > 0 ? "\r\n" : "\n";

  const finalNewline = /\r?\n$/.test(text);
  const body = finalNewline ? text.replace(/\r?\n$/, "") : text;

  const lines = body.length === 0 && !finalNewline ? [] : body.split(/\r\n|\n/);
  const nodes = lines.map(parseLine);

  return { nodes, eol, finalNewline, bom };
}

function parseLine(line: string): IniNode {
  if (line.trim() === "") return { kind: "blank", raw: line };
  if (COMMENT_RE.test(line)) return { kind: "comment", raw: line };

  const section = SECTION_RE.exec(line);
  if (section) {
    return {
      kind: "section",
      indent: section[1] ?? "",
      name: (section[2] ?? "").trim(),
      trailing: section[3] ?? "",
    };
  }

  const pair = PAIR_RE.exec(line);
  if (pair) {
    return {
      kind: "pair",
      indent: pair[1] ?? "",
      key: pair[2] ?? "",
      separator: pair[3] ?? "",
      value: pair[4] ?? "",
      trailing: pair[5] ?? "",
    };
  }

  return { kind: "unknown", raw: line };
}

export function serializeNode(node: IniNode): string {
  switch (node.kind) {
    case "blank":
    case "comment":
    case "unknown":
      return node.raw;
    case "section":
      return `${node.indent}[${node.name}]${node.trailing}`;
    case "pair":
      return `${node.indent}${node.key}${node.separator}${node.value}${node.trailing}`;
  }
}

export function serializeIni(doc: IniDocument): string {
  const body = doc.nodes.map(serializeNode).join(doc.eol);
  return doc.bom + body + (doc.finalNewline ? doc.eol : "");
}
