/**
 * Building a new INI document from scratch.
 *
 * Conversion does not edit the source config — the two formats disagree about
 * structure, not just spelling, so the target is written fresh. The builder
 * emits in the target game's dialect: osu! separates with `:` and comments
 * with `//`, Quaver separates with `=` and comments with `;`.
 */

import type { IniDocument, IniNode } from "./document";

export type Dialect = "osu" | "quaver";

const SEPARATOR: Record<Dialect, string> = { osu: ": ", quaver: " = " };
const COMMENT: Record<Dialect, string> = { osu: "//", quaver: ";" };

export class IniBuilder {
  private readonly nodes: IniNode[] = [];

  constructor(private readonly dialect: Dialect) {}

  /** Start a section. Repeats are allowed — osu! needs one `[Mania]` per keycount. */
  section(name: string): this {
    if (this.nodes.length > 0) this.blank();
    this.nodes.push({ kind: "section", name, indent: "", trailing: "" });
    return this;
  }

  /** Write a key. `undefined` and `null` values are skipped entirely. */
  pair(key: string, value: string | number | null | undefined): this {
    if (value === null || value === undefined) return this;
    this.nodes.push({
      kind: "pair",
      key,
      value: String(value),
      indent: "",
      separator: SEPARATOR[this.dialect],
      trailing: "",
    });
    return this;
  }

  comment(text: string): this {
    this.nodes.push({ kind: "comment", raw: `${COMMENT[this.dialect]} ${text}` });
    return this;
  }

  blank(): this {
    this.nodes.push({ kind: "blank", raw: "" });
    return this;
  }

  build(): IniDocument {
    // Both games ship on Windows first and their own files use CRLF.
    return { nodes: this.nodes, eol: "\r\n", finalNewline: true, bom: "" };
  }
}
