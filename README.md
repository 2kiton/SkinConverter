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

**Stage 1 — container round trip.** Reads either format, detects which one it
is, parses `skin.ini` losslessly, and writes the archive back out. No element
conversion yet.

Stage 1 exists to prove the INI parser before anything depends on it. Neither
game writes a standard INI file:

- osu! separates keys with `:`, Quaver with `=`, and files in the wild mix both.
- **osu!'s `[Mania]` section repeats**, once per keycount. A parser that stores
  sections in a map keeps only the last block and silently discards every other
  keymode in the skin.
- Comment styles differ (`//` vs `;`), and authors leave notes worth keeping.

So `src/lib/ini` keeps every physical line and edits them in place. An untouched
document re-serializes byte-for-byte, which is exactly what the app's round-trip
check asserts on whatever skin you load.

## Running it

Requires Node 20+, which is **not currently installed on this machine**.

```
npm install
npm run dev     # http://localhost:5173
npm test        # parser and detector tests
```

## Verifying stage 1

1. Load a real `.qs` or `.osk`.
2. Confirm the report says the round trip was identical and the keymodes match
   what the skin actually ships.
3. Re-export, then import the result back into the game and confirm it loads.

## Layout

```
src/lib/ini/       lossless INI document model and accessors
src/lib/skin/      zip read/write, format detection, round-trip check
src/components/    drop zone and report UI
```

## Roadmap

| Stage | Scope |
| ----- | ----- |
| 1 | Container round trip — **done** |
| 2 | Declarative 1:1 element rename tables |
| 3 | Side-by-side playfield preview canvas |
| 4 | Geometry translation (×0.625 / ×1.6, origin constants) |
| 5 | Canvas pipeline — spritesheets, letterboxing, baked rotations, `@2x` |
| 6 | Synthesis and conversion report |

### Reference

Quaver `skin.ini` values are authored in a **1366×768** space — keys such as
`ColumnSize` and `HitPosOffsetY` carry a `[FixedScale]` attribute and are
multiplied by `SkinScalingFactor = 1920f / 1366` at load. osu!'s are in
**640×480** osu!pixels. Both games scale skins by height, so the conversion
factor is `480 / 768 = 0.625` exactly, and `1.6` back. Do not use `640 / 1366`.
