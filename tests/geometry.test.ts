import { describe, it, expect } from "vitest";
import {
  OSU_TO_QUAVER,
  QUAVER_TO_OSU,
  OSU_DEFAULT_HIT_POSITION,
  collapseColumnWidths,
  columnStartToAlignment,
  alignmentToColumnStart,
  formatNumberList,
  formatRgba,
  hitPositionToOffset,
  offsetToHitPosition,
  osuToQuaver,
  parseNumberList,
  parseRgba,
  quaverToOsu,
  stageWidth,
  tidy,
} from "../src/lib/convert/geometry";

describe("the scale factor", () => {
  it("matches osu!'s own STABLE_MAGIC_SCALE_FACTOR", () => {
    // osu! documents 1.6 as "converting legacy positioning values
    // (based in x480 dimensions) to x768".
    expect(OSU_TO_QUAVER).toBe(1.6);
    expect(QUAVER_TO_OSU).toBe(0.625);
    expect(OSU_TO_QUAVER * QUAVER_TO_OSU).toBe(1);
  });

  it("round-trips a value exactly", () => {
    for (const v of [30, 90, 136, 402, 1, 0]) {
      expect(quaverToOsu(osuToQuaver(v))).toBeCloseTo(v, 10);
    }
  });

  it("converts osu!'s default column width to Quaver units", () => {
    expect(osuToQuaver(30)).toBeCloseTo(48, 10);
  });
});

describe("number lists", () => {
  it("parses osu!'s comma lists and skips junk", () => {
    expect(parseNumberList("30,30,30,30")).toEqual([30, 30, 30, 30]);
    expect(parseNumberList(" 30 , 40 ")).toEqual([30, 40]);
    expect(parseNumberList("30,,x,40")).toEqual([30, 40]);
    expect(parseNumberList(undefined)).toEqual([]);
  });

  it("formats without trailing zeroes", () => {
    expect(formatNumberList([48, 48])).toBe("48,48");
    expect(tidy(48.0)).toBe("48");
    expect(tidy(48.567)).toBe("48.57");
  });
});

describe("collapsing osu! column widths", () => {
  it("keeps a uniform width and says it was uniform", () => {
    expect(collapseColumnWidths([30, 30, 30, 30])).toEqual({ value: 30, uniform: true });
  });

  it("takes the most common width, not the mean", () => {
    // A 7K+scratch skin: six normal lanes and one wide scratch lane.
    // The mean (34.3) would be wrong for every single lane.
    expect(collapseColumnWidths([60, 30, 30, 30, 30, 30, 30])).toEqual({ value: 30, uniform: false });
  });

  it("falls back to osu!'s default when there is nothing to collapse", () => {
    expect(collapseColumnWidths([])).toEqual({ value: 30, uniform: true });
  });
});

describe("stage width", () => {
  it("sums columns plus the gaps between them", () => {
    expect(stageWidth([30, 30, 30, 30], [5, 5, 5])).toBe(135);
  });

  it("ignores spacing entries beyond the gap count", () => {
    expect(stageWidth([30, 30], [5, 5, 5, 5])).toBe(65);
  });

  it("has no gaps for a single column", () => {
    expect(stageWidth([30], [5])).toBe(30);
  });
});

describe("horizontal placement", () => {
  it("centres the default 4K stage near the middle of the screen", () => {
    // ColumnStart 136 with four 30px columns -> centre at 196 of 640.
    const alignment = columnStartToAlignment(136, 120);
    expect(alignment).toBeCloseTo(30.625, 3);
  });

  it("round-trips through the alignment percentage", () => {
    const width = 120;
    const start = 136;
    const back = alignmentToColumnStart(columnStartToAlignment(start, width), width);
    expect(back).toBeCloseTo(start, 10);
  });
});

describe("hit position", () => {
  it("is a no-op offset at osu!'s default", () => {
    expect(hitPositionToOffset(OSU_DEFAULT_HIT_POSITION)).toBe(0);
  });

  it("round-trips", () => {
    for (const v of [402, 380, 430]) {
      expect(offsetToHitPosition(hitPositionToOffset(v))).toBeCloseTo(v, 10);
    }
  });

  it("scales the delta into Quaver units", () => {
    // 10 osu!px below the default is 16 Quaver units.
    expect(hitPositionToOffset(412)).toBeCloseTo(16, 10);
  });
});

describe("colours", () => {
  it("defaults a missing alpha to 255, as Quaver documents", () => {
    expect(parseRgba("255,0,0")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("reads an explicit alpha", () => {
    expect(parseRgba("10,20,30,40")).toEqual({ r: 10, g: 20, b: 30, a: 40 });
  });

  it("clamps and rounds out-of-range channels", () => {
    expect(parseRgba("300,-5,12.6")).toEqual({ r: 255, g: 0, b: 13, a: 255 });
  });

  it("rejects anything shorter than three channels", () => {
    expect(parseRgba("255,0")).toBeNull();
    expect(parseRgba(undefined)).toBeNull();
  });

  it("drops alpha for osu!, keeps it for Quaver", () => {
    const c = { r: 1, g: 2, b: 3, a: 4 };
    expect(formatRgba(c, false)).toBe("1,2,3");
    expect(formatRgba(c, true)).toBe("1,2,3,4");
  });
});
