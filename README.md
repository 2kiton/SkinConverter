# QuaverMania

Convert skins between **Quaver** (`.qs`) and **osu!mania** (`.osk`), in either
direction, with the playfield looking the same in both games.

Everything runs in your browser. Your skin is never uploaded anywhere.

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```
npm install
npm run dev
```

Then open http://localhost:5173.

## How to use it

1. **Drop your skin** (`.qs` or `.osk`) onto the page. The format is detected
   automatically.
2. **Pick your osu! client** (Quaver → osu! only): choose **osu!lazer** or
   **osu!stable**. The two read skins differently, so a skin built for one can
   look wrong in the other.
3. **Click Convert.** A side-by-side preview shows the playfield in both games,
   along with a report of what was converted. If your skin has several
   keymodes, use the buttons above the preview to switch between them.
4. **Click Download** to save the converted skin, then import it into the game
   as you would any other skin.

### Long notes look upside down?

If the end of long notes points the wrong way in game, tick **Flip long note
tails**, convert again and re-import. osu!stable builds already correct for
this, so it is usually only needed for osu!lazer.

## What gets converted

**Converted:** the playfield — notes, long notes, receptors/keys, stage,
column layout, hit position and judgements.

**Copied over unchanged:** everything else (hitsounds, backgrounds, cursors,
combo and score numbers, health bar, grades). These files are kept in the
download and listed in the report, but the other game may not pick them up, so
you may need to place them yourself.

**Not supported yet:** hit bubbles, the judgement counter, the warning arrow,
combo bursts, and scratch-lane (`SpecialStyle`) layouts.

## Known limitations

- **osu!stable assumes a 16:9 screen.** On other aspect ratios the stage may
  sit slightly off-centre.
- Quaver's default hit position and built-in per-column note rotations are
  undocumented, so conversions involving them are a best guess. Check the
  result in game.

## For developers

Tests, project layout and the notes on how each game actually reads skins are
in [docs/NOTES.md](docs/NOTES.md).

## License

[MIT](LICENSE)
