# QuaverMania

Convert Quaver (`.qs`) and osu!mania (`.osk`) skins with the playfield rendering
identically on both sides. Runs entirely in the browser.

## Why there is no backend

Both container formats are plain ZIP archives. Quaver's exporter builds an
`ArchiveType.Zip` and writes it to `{name}.qs` with `CompressionType.None`; its
importer just walks the archive entries. `.osk` is the same arrangement. A skin
is a bag of PNGs plus one INI file, so JSZip, an INI parser and `<canvas>` cover
the whole job client-side — no uploads, no size limits, no privacy question.

## Status

Converts in both directions, with a side-by-side playfield preview and a report
of what did and did not survive. See the roadmap below for what is verified and
what is not.

The INI parser came first, deliberately, because neither game writes a standard
INI file:

- osu! separates keys with `:`, Quaver with `=`, and files in the wild mix both.
- **osu!'s `[Mania]` section repeats**, once per keycount. A parser that stores
  sections in a map keeps only the last block and silently discards every other
  keymode in the skin.
- Comment styles differ (`//` vs `;`), and authors leave notes worth keeping.

So `src/lib/ini` keeps every physical line and edits them in place. An untouched
document re-serializes byte-for-byte, which is exactly what the app's round-trip
check asserts on whatever skin you load.

## Running it

Requires Node 20+.

```
npm install
npm run dev     # http://localhost:5173
npm test        # parser and detector tests
```

## Test skins

`samples/` holds two deliberately awkward skins, regenerated with
`python scripts/make-samples.py`. Receptors are 128x44 so aspect bugs show up,
hold ends are asymmetric arrows so a wrong flip is obvious, each ships
animations in its own format so both directions of the animation conversion get
exercised, and the osu! one declares two keymodes to cover repeated `[Mania]`.

## Layout

```
src/lib/ini/       lossless INI document model, accessors, builder
src/lib/skin/      zip read/write, format detection, round-trip check
src/lib/convert/   element table, geometry, lane indexing, canvas pipeline
src/lib/preview/   playfield layout shared with the converter
src/components/    drop zone, reports, preview canvas
```

## Roadmap

| Stage | Scope | State |
| ----- | ----- | ----- |
| 1 | Container round trip | Done, covered by tests |
| 2 | Declarative element mapping table | Done, covered by tests |
| 3 | Side-by-side playfield preview | Done, **not covered by tests** |
| 4 | Geometry translation (x0.625 / x1.6) | Done, covered by tests |
| 5 | Canvas pipeline | Wiring covered by tests; **pixel output unverified** |
| 6 | Synthesis and conversion report | Done, wiring covered by tests |

### What is not verified

`src/lib/convert/images.ts` only runs in a browser, so the test suite covers
*which* operation is called with *what* arguments, never the pixels it
produces. Converting a real skin in the browser is the only thing that
exercises it.

Three behaviours could not be settled from either game's documentation:

- **Long note tail orientation.** osu! flips tails by default from skin v2.5;
  Quaver draws them as authored. There is a toggle in the UI — convert both
  ways and keep the one that reads correctly in game.
- **Quaver's default hit position.** Not documented. The converter and the
  preview both treat `HitPosOffsetY = 0` as equivalent to osu!'s `HitPosition:
  402`, which keeps them consistent with each other but is an assumption.
- **Quaver's built-in per-column rotations.** `RotateHitObjectsByColumn` on its
  own uses undocumented defaults, so nothing is rotated unless the skin gives
  an explicit `HitObjectRotations` list. Guessing would point every arrow the
  wrong way.

### Reference

Quaver `skin.ini` values are authored in a **1366×768** space — keys such as
`ColumnSize` and `HitPosOffsetY` carry a `[FixedScale]` attribute and are
multiplied by `SkinScalingFactor = 1920f / 1366` at load. osu!'s are in
**640×480** osu!pixels. Both games scale skins by height, so the conversion
factor is `480 / 768 = 0.625` exactly, and `1.6` back. Do not use `640 / 1366`.
osu!'s own constant confirms it: `LegacySkin.STABLE_MAGIC_SCALE_FACTOR = 1.6f`,
documented there as "converting legacy positioning values (based in x480
dimensions) to x768".
