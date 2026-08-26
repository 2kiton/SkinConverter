import { describe, it, expect } from "vitest";
import { parseIni, serializeIni } from "./document";
import { allSections, sections, get, set, readSection, sectionNames } from "./access";

/** Round-tripping is the whole point, so assert it on every sample. */
function stable(source: string) {
  expect(serializeIni(parseIni(source))).toBe(source);
}

const QUAVER_INI = [
  "[General]",
  "Name = Neon",
  "Author = someone",
  "Version = 1.0",
  "",
  "; lane sizing below",
  "[4K]",
  "ColumnSize = 90",
  "NotePadding = 0",
  "ColumnColor1 = 255,0,0,255",
  "",
  "[7K]",
  "ColumnSize = 75",
  "",
].join("\r\n");

const OSU_INI = [
  "[General]",
  "Name: Neon",
  "Author: someone",
  "Version: 2.5",
  "",
  "// two keymodes, two blocks",
  "[Mania]",
  "Keys: 4",
  "ColumnStart: 136",
  "ColumnWidth: 30,30,30,30",
  "HitPosition: 402",
  "",
  "[Mania]",
  "Keys: 7",
  "ColumnStart: 100",
  "ColumnWidth: 30,30,30,30,30,30,30",
  "",
].join("\n");

describe("round-tripping", () => {
  it("reproduces a Quaver skin.ini byte-for-byte", () => stable(QUAVER_INI));
  it("reproduces an osu! skin.ini byte-for-byte", () => stable(OSU_INI));

  it("preserves CRLF, LF, and a missing final newline", () => {
    stable("[A]\r\nX = 1\r\n");
    stable("[A]\nX = 1\n");
    stable("[A]\nX = 1");
    stable("");
  });

  it("preserves odd spacing, comments, and a BOM", () => {
    stable("\uFEFF[General]\r\n  Name   =   Neon   \r\n\r\n;; trailing note\r\n");
  });

  it("carries unparseable lines through untouched", () => {
    const src = "[A]\nthis line has no separator\nX = 1\n";
    stable(src);
    expect(parseIni(src).nodes.filter((n) => n.kind === "unknown")).toHaveLength(1);
  });
});

describe("repeated sections", () => {
  it("keeps every [Mania] block rather than collapsing them", () => {
    const doc = parseIni(OSU_INI);
    const mania = sections(doc, "Mania");
    expect(mania).toHaveLength(2);
    expect(mania.map((s) => get(doc, s, "Keys"))).toEqual(["4", "7"]);
  });

  it("scopes each block's keys to that block", () => {
    const doc = parseIni(OSU_INI);
    const [four, seven] = sections(doc, "Mania");
    expect(get(doc, four!, "ColumnStart")).toBe("136");
    expect(get(doc, seven!, "ColumnStart")).toBe("100");
  });

  it("reports section names without duplicates", () => {
    expect(sectionNames(parseIni(OSU_INI))).toEqual(["General", "Mania"]);
  });

  it("bounds the last section at end of file", () => {
    const doc = parseIni(QUAVER_INI);
    const last = allSections(doc).at(-1)!;
    expect(readSection(doc, last)).toEqual({ ColumnSize: "75" });
  });
});

describe("separators", () => {
  it("reads both `=` and `:` and keeps whichever was written", () => {
    const doc = parseIni("[A]\nX = 1\nY: 2\n");
    const [a] = allSections(doc);
    expect(get(doc, a!, "X")).toBe("1");
    expect(get(doc, a!, "Y")).toBe("2");
    expect(serializeIni(doc)).toBe("[A]\nX = 1\nY: 2\n");
  });

  it("splits on the first separator so values may contain colons", () => {
    const doc = parseIni("[A]\nPath: C:/skins/note.png\n");
    expect(get(doc, allSections(doc)[0]!, "Path")).toBe("C:/skins/note.png");
  });

  it("matches keys case-insensitively", () => {
    const doc = parseIni("[A]\nColumnSize = 90\n");
    expect(get(doc, allSections(doc)[0]!, "columnsize")).toBe("90");
  });
});

describe("editing", () => {
  it("updates a value in place and leaves the rest of the file alone", () => {
    const doc = parseIni(QUAVER_INI);
    const fourK = sections(doc, "4K")[0]!;
    expect(set(doc, fourK, "ColumnSize", "120")).toBe(true);
    const out = serializeIni(doc);
    expect(out).toBe(QUAVER_INI.replace("ColumnSize = 90", "ColumnSize = 120"));
  });

  it("inserts a missing key using the section's own separator style", () => {
    const doc = parseIni(OSU_INI);
    const fourK = sections(doc, "Mania")[0]!;
    expect(set(doc, fourK, "NoteBodyStyle", "1")).toBe(false);
    expect(get(doc, fourK, "NoteBodyStyle")).toBe("1");
    expect(serializeIni(doc)).toContain("NoteBodyStyle: 1");
  });

  it("inserts before the section's trailing blank line", () => {
    const doc = parseIni("[A]\nX = 1\n\n[B]\nY = 2\n");
    set(doc, sections(doc, "A")[0]!, "Z", "3");
    expect(serializeIni(doc)).toBe("[A]\nX = 1\nZ = 3\n\n[B]\nY = 2\n");
  });

  it("writes into the right block when a section repeats", () => {
    const doc = parseIni(OSU_INI);
    set(doc, sections(doc, "Mania")[1]!, "ColumnStart", "90");
    const after = parseIni(serializeIni(doc));
    expect(get(after, sections(after, "Mania")[0]!, "ColumnStart")).toBe("136");
    expect(get(after, sections(after, "Mania")[1]!, "ColumnStart")).toBe("90");
  });
});
