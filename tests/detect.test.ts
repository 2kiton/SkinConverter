import { describe, it, expect } from "vitest";
import { detectFormat } from "../src/lib/skin/detect";

describe("format detection", () => {
  it("recognises a Quaver skin by its keymode folders", () => {
    const r = detectFormat("skin.zip", ["4k/HitObjects/note-hitobject-1.png", "skin.ini"], null);
    expect(r.format).toBe("quaver");
    expect(r.ambiguous).toBe(false);
  });

  it("recognises an osu! skin by its mania-* elements", () => {
    const r = detectFormat("skin.zip", ["mania-note1.png", "mania-key1.png"], null);
    expect(r.format).toBe("osu");
  });

  it("outweighs a misleading extension with structural evidence", () => {
    const r = detectFormat("mislabelled.qs", ["mania-note1.png", "mania-note1H.png"], "[Mania]\nKeys: 4\n");
    expect(r.format).toBe("osu");
    expect(r.ambiguous).toBe(true);
  });

  it("counts each [Mania] block", () => {
    const r = detectFormat("s.osk", [], "[Mania]\nKeys: 4\n[Mania]\nKeys: 7\n");
    expect(r.signals.some((s) => s.reason.includes("2 [Mania] sections"))).toBe(true);
  });

  it("says so when it has nothing to go on", () => {
    const r = detectFormat("skin.zip", ["readme.txt"], null);
    expect(r.signals.at(-1)!.reason).toContain("No format signals");
  });
});
