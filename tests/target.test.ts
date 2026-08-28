import { describe, it, expect } from "vitest";
import { parseIni } from "../src/lib/ini/document";
import { allSections, readSection } from "../src/lib/ini/access";
import { convertSkin, type OsuTarget } from "../src/lib/convert/convert";
import { passthroughProcessor } from "../src/lib/convert/images";
import type { SkinEntry, SkinPackage } from "../src/lib/skin/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const EOL = "\r\n";

/**
 * A lazer build renders correctly on lazer but is wrong on osu!stable in two
 * separate ways, both confirmed against the real client.
 *
 * 1. `ColumnStart`. lazer's own config marks the field unimplemented and
 *    centres the stage itself, so whatever value is written is invisible
 *    there — while stable takes it as the literal left edge. The space it is
 *    measured in is 853 units wide on 16:9, not 640, so a stage centred
 *    against 640 lands 107 units too far left. A working stable skin confirms
 *    it: `ColumnStart: 300` with `ColumnWidth: 70,70,70,70` centres at 440,
 *    matching the 16:9 centre of 427 rather than the 4:3 centre of 320.
 *
 * 2. Key types. stable types `[Mania]` keys individually, and the position
 *    family is int32:
 *
 *      Error in [Mania] Line 20: Expected type int32 (name = HitPosition)
 *
 *    stable then discards the line, leaving the hit line at its own default
 *    while the receptors stay where the skin put them — so the hitbox stops
 *    matching the art. The width keys are NOT int32; that same working skin
 *    ships `ColumnWidth: 66.66,...`, so rounding is applied only where stable
 *    demands it.
 */
function pkg(iniText: string, paths: string[]): SkinPackage {
  const entries: SkinEntry[] = paths.map((path) => ({ path, originalPath: path, bytes: PNG }));
  entries.push({ path: "skin.ini", originalPath: "skin.ini", bytes: new TextEncoder().encode(iniText) });
  return {
    name: "test",
    format: "quaver",
    detection: { format: "quaver", signals: [], ambiguous: false },
    entries,
    ini: parseIni(iniText),
    iniSource: iniText,
    iniPath: "skin.ini",
    strippedRoot: null,
  };
}

function mania(p: SkinPackage, nth = 0) {
  const doc = parseIni(p.iniSource!);
  const slice = allSections(doc).filter((s) => s.name.toLowerCase() === "mania")[nth];
  return slice ? readSection(doc, slice) : {};
}

// ColumnSize 90 -> 56.25 osu!px, NotePadding 4 -> 2.5. Both non-integer.
const QUAVER_INI = [
  "[General]",
  "Name = T",
  "",
  "[4K]",
  "ColumnSize = 90",
  "NotePadding = 4",
  "ColumnAlignment = 50",
  "",
].join(EOL);

const PATHS = [1, 2, 3, 4].flatMap((n) => [
  `4k/HitObjects/note-hitobject-${n}.png`,
  `4k/Receptors/receptor-up-${n}.png`,
]);

/**
 * A real receptor measurement is what makes HitPosition non-integer, so the
 * int32 tests need a processor that reports one.
 */
const MEASURING = {
  ...passthroughProcessor,
  async measure() {
    return { width: 128, height: 44 };
  },
};

async function build(target?: OsuTarget) {
  return convertSkin(pkg(QUAVER_INI, PATHS), { processor: MEASURING, ...(target ? { target } : {}) });
}

describe("osu! target", () => {
  it("defaults to lazer", async () => {
    const a = await build();
    const b = await build("lazer");
    expect(b.pkg.iniSource).toBe(a.pkg.iniSource);
  });

  it("rounds the int32 position keys stable rejects decimals on", async () => {
    const block = mania((await build("stable")).pkg);
    for (const key of ["HitPosition", "ScorePosition"]) {
      expect(block[key], `${key} should be present`).toBeDefined();
      expect(Number.isInteger(Number(block[key])), `${key} must be an integer`).toBe(true);
    }
  });

  it("leaves those keys at full precision for lazer", async () => {
    // The same measurement that rounds to 470 on stable.
    expect(mania((await build("lazer")).pkg)["HitPosition"]).toBe("470.33");
  });

  it("does not round the width keys, which stable accepts as decimals", async () => {
    const block = mania((await build("stable")).pkg);
    expect(block["ColumnWidth"]).toBe("56.25,56.25,56.25,56.25");
    expect(block["ColumnSpacing"]).toBe("2.5,2.5,2.5");
  });

  it("centres the stage in the 16:9 space stable actually draws into", async () => {
    // Stage is 4*56.25 + 3*2.5 = 232.5 wide; (853.33 - 232.5) / 2 = 310.42.
    expect(mania((await build("stable")).pkg)["ColumnStart"]).toBe("310.42");
  });

  it("hides separators with widths, which is what stable honours", async () => {
    const block = mania((await build("stable")).pkg);
    // A transparent ColourColumnLine works on lazer; stable needs the widths
    // zeroed. ColumnLineWidth takes one more value than there are columns.
    expect(block["ColumnLineWidth"]).toBe("0,0,0,0,0");
    expect(block["JudgementLine"]).toBe("0");

    // Barlines need BOTH: a zero height and a transparent colour. osu!
    // defaults ColourBarline to opaque white, and they land on beat
    // boundaries — which is where long notes end, so they read as a stray
    // line at the top of every long note.
    expect(block["BarlineHeight"]).toBe("0");
    expect(block["ColourBarline"]).toBe("0,0,0,0");
  });

  it("adds none of the stable-only keys to a lazer build", async () => {
    const block = mania((await build("lazer")).pkg);
    expect(block["ColumnLineWidth"]).toBeUndefined();
    expect(block["BarlineHeight"]).toBeUndefined();
    expect(block["ColourBarline"]).toBeUndefined();
    expect(block["JudgementLine"]).toBeUndefined();
  });

  it("keeps lazer's horizontal geometry untouched", async () => {
    const block = mania((await build("lazer")).pkg);
    expect(block["ColumnStart"]).toBe("203.75");
    expect(block["ColumnWidth"]).toBe("56.25,56.25,56.25,56.25");
  });

  it("still writes the per-column image keys for stable", async () => {
    const block = mania((await build("stable")).pkg);
    // Fixing the layout must not disturb the art: each lane keeps its own file.
    expect(block["NoteImage0"]).toBe("qm-4k-note-1");
    expect(block["NoteImage3"]).toBe("qm-4k-note-4");
    expect(block["KeyImage0"]).toBe("qm-4k-receptor-up-1");
  });

  it("writes identical image files for both targets", async () => {
    const lazer = await build("lazer");
    const stable = await build("stable");
    const names = (r: typeof lazer) =>
      r.pkg.entries.map((e) => e.path).filter((p) => p !== "skin.ini").sort();
    // Only the config differs; nothing about the art depends on the client.
    expect(names(stable)).toEqual(names(lazer));
  });

  it("says in the report that a stable build was made", async () => {
    expect((await build("stable")).report.warnings.join(" ")).toMatch(/osu!stable/i);
  });

  it("says nothing about stable in a lazer build", async () => {
    expect((await build("lazer")).report.warnings.join(" ")).not.toMatch(/osu!stable/i);
  });

  it("centres every keymode block, not only the first", async () => {
    const ini = [QUAVER_INI, "[7K]", "ColumnSize = 75", "NotePadding = 4", ""].join(EOL);
    const { pkg: out } = await convertSkin(pkg(ini, PATHS), { processor: MEASURING, target: "stable" });
    const seven = mania(out, 1);

    // 7 columns of 46.88 plus 6 gaps of 2.5 = 343.13 wide, so the stage starts
    // at (853.33 - 343.13) / 2. A wider stage has to start further left, which
    // only holds if the start is recomputed per block rather than shared.
    expect(seven["ColumnStart"]).toBe("255.1");
    expect(Number(seven["ColumnStart"])).toBeLessThan(Number(mania(out, 0)["ColumnStart"]));
    expect(seven["ColumnLineWidth"]).toBe("0,0,0,0,0,0,0,0");
  });

  it("emits no decimal on any int32 key, in any keymode block", async () => {
    // JudgementBurstPosY is what drags ScorePosition off a whole number.
    const ini = [QUAVER_INI, "[7K]", "ColumnSize = 75", "JudgementBurstPosY = 13", ""].join(EOL);
    const { pkg: out } = await convertSkin(pkg(ini, PATHS), { processor: MEASURING, target: "stable" });

    for (const block of [mania(out, 0), mania(out, 1)]) {
      for (const key of ["HitPosition", "ScorePosition", "LightPosition"]) {
        const value = block[key];
        if (value === undefined) continue;
        expect(Number.isInteger(Number(value)), `${key} = ${value}`).toBe(true);
      }
    }
  });
});
