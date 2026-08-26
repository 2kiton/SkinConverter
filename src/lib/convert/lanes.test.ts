import { describe, it, expect } from "vitest";
import {
  columnTokens,
  fallbackColumnToken,
  parseSpecialStyle,
  specialColumnIndex,
  SpecialStyle,
} from "./lanes";

/**
 * These expectations come from osu!'s own `LegacyManiaColumnElement`, not from
 * community lore. The lore version of 7K ("1,2,1,S,1,2,1") is wrong for a
 * default stage, which is exactly why this is pinned by tests.
 */
describe("osu! fallback column tokens", () => {
  it("mirrors around the centre for 4K", () => {
    expect(columnTokens(4)).toEqual(["1", "2", "2", "1"]);
  });

  it("alternates outward from both edges for 5K and 7K", () => {
    expect(columnTokens(5)).toEqual(["1", "2", "1", "2", "1"]);
    expect(columnTokens(7)).toEqual(["1", "2", "1", "2", "1", "2", "1"]);
  });

  it("does not invent a special column when SpecialStyle is unset", () => {
    expect(columnTokens(7)).not.toContain("S");
  });

  it("handles the smallest stages", () => {
    expect(columnTokens(1)).toEqual(["1"]);
    expect(columnTokens(2)).toEqual(["1", "1"]);
    expect(columnTokens(3)).toEqual(["1", "2", "1"]);
  });

  it("is symmetric for every keycount", () => {
    for (let keys = 1; keys <= 18; keys++) {
      const tokens = columnTokens(keys);
      expect(tokens).toEqual([...tokens].reverse());
    }
  });
});

describe("special columns", () => {
  it("places the special column on the requested side", () => {
    expect(specialColumnIndex(7, SpecialStyle.Left)).toBe(0);
    expect(specialColumnIndex(7, SpecialStyle.Right)).toBe(6);
  });

  it("ignores SpecialStyle below 5 keys", () => {
    expect(specialColumnIndex(4, SpecialStyle.Left)).toBeNull();
    expect(specialColumnIndex(1, SpecialStyle.Right)).toBeNull();
  });

  it("marks only the special column with S", () => {
    const tokens = columnTokens(8, SpecialStyle.Left);
    expect(tokens[0]).toBe("S");
    expect(tokens.slice(1)).not.toContain("S");
  });

  it("reads SpecialStyle values, defaulting to none", () => {
    expect(parseSpecialStyle("1")).toBe(SpecialStyle.Left);
    expect(parseSpecialStyle("2")).toBe(SpecialStyle.Right);
    expect(parseSpecialStyle("0")).toBe(SpecialStyle.None);
    expect(parseSpecialStyle(undefined)).toBe(SpecialStyle.None);
    expect(parseSpecialStyle("nonsense")).toBe(SpecialStyle.None);
  });
});

describe("fallbackColumnToken", () => {
  it("takes the special column first", () => {
    expect(fallbackColumnToken(3, 7, 3)).toBe("S");
  });

  it("measures distance to the nearer edge", () => {
    // 7 columns: distances 0,1,2,3,2,1,0 -> 1,2,1,2,1,2,1
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => fallbackColumnToken(i, 7, null))).toEqual([
      "1",
      "2",
      "1",
      "2",
      "1",
      "2",
      "1",
    ]);
  });
});
