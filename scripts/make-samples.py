"""
Generate the test skins in samples/.

These are deliberately awkward, not pretty: the receptor images are 128x44 so
aspect-ratio bugs show up immediately, the hold ends are asymmetric arrows so a
wrong flip or rotation is obvious, the Quaver sample ships an @1x4 spritesheet
and the osu! sample ships numbered animation frames so both directions of the
animation conversion get exercised, and the osu! sample declares two keymodes
so the repeated-[Mania] path is covered.

    python scripts/make-samples.py
"""

import os
import struct
import zipfile
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")


def png(width, height, shade):
    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            raw += bytes(shade(x, y, width, height))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def solid(r, g, b, a=255):
    return lambda x, y, w, h: (r, g, b, a)


def bar(r, g, b):
    """A note with softened edges, so stretching is visible."""

    def shade(x, y, w, h):
        edge = 3
        faded = x < edge or x >= w - edge or y < edge or y >= h - edge
        return (r, g, b, 120 if faded else 255)

    return shade


def arrow(r, g, b):
    """Asymmetric on both axes: any wrong flip or rotation is obvious."""

    def shade(x, y, w, h):
        centre = w / 2
        t = y / max(1, h - 1)
        half = (w / 2) * (0.25 + 0.75 * (1 - t))
        return (r, g, b, 255) if abs(x - centre) <= half else (0, 0, 0, 0)

    return shade


LANE_COLOURS = [(255, 96, 96), (96, 170, 255), (96, 170, 255), (255, 96, 96)]


def build_quaver():
    files = {}
    for lane in range(1, 5):
        c = LANE_COLOURS[lane - 1]
        files[f"4k/HitObjects/note-hitobject-{lane}.png"] = png(128, 36, bar(*c))
        files[f"4k/HitObjects/note-holdhitobject-{lane}.png"] = png(128, 36, bar(*c))
        files[f"4k/HitObjects/note-holdbody-{lane}.png"] = png(
            128, 64, solid(c[0] // 2, c[1] // 2, c[2] // 2, 220)
        )
        files[f"4k/HitObjects/note-holdend-{lane}.png"] = png(128, 36, arrow(*c))
        files[f"4k/Receptors/receptor-up-{lane}.png"] = png(128, 44, arrow(200, 200, 200))
        files[f"4k/Receptors/receptor-down-{lane}.png"] = png(128, 44, arrow(255, 255, 255))

    files["4k/Stage/stage-hitposition-overlay.png"] = png(256, 6, solid(255, 255, 255, 200))
    files["4k/Stage/stage-left-border.png"] = png(8, 256, solid(90, 90, 110))
    files["4k/Stage/stage-right-border.png"] = png(8, 256, solid(90, 90, 110))
    for d in range(10):
        files[f"Numbers/combo-{d}.png"] = png(48, 64, bar(255, 255, 255))
        files[f"Numbers/score-{d}.png"] = png(48, 64, bar(220, 220, 255))
    files["Numbers/score-percent.png"] = png(48, 64, bar(200, 200, 255))
    files["Numbers/score-decimal.png"] = png(24, 64, bar(200, 200, 255))
    for j in ("marv", "perf", "great", "good", "okay", "miss"):
        files[f"Judgements/judge-{j}.png"] = png(200, 80, bar(255, 220, 120))
    files["SFX/hitsound.wav"] = b"RIFF____WAVEfmt "
    files["4k/Lighting/hitlighting@1x4.png"] = png(
        256, 64, lambda x, y, w, h: (255, 255, 200, 40 + (x // 64) * 60)
    )
    files["skin.ini"] = (
        "[General]\r\nName = QM Sample Quaver\r\nAuthor = QuaverMania\r\nVersion = 1.0\r\n\r\n"
        "[4K]\r\nColumnSize = 90\r\nNotePadding = 4\r\nColumnAlignment = 50\r\n"
        "HitPosOffsetY = 0\r\nColumnColor1 = 255,96,96,255\r\nColumnColor2 = 96,170,255,255\r\n"
        "ColumnColor3 = 96,170,255,255\r\nColumnColor4 = 255,96,96,255\r\n"
    ).encode()

    # Quaver's own exporter stores entries uncompressed; match it.
    write(os.path.join(OUT, "sample-quaver.qs"), files, zipfile.ZIP_STORED)


def build_osu():
    files = {}
    for token, c in (("1", (255, 96, 96)), ("2", (96, 170, 255))):
        files[f"mania-note{token}.png"] = png(128, 36, bar(*c))
        files[f"mania-note{token}H.png"] = png(128, 36, bar(*c))
        files[f"mania-note{token}L.png"] = png(128, 64, solid(c[0] // 2, c[1] // 2, c[2] // 2, 220))
        files[f"mania-note{token}T.png"] = png(128, 36, arrow(*c))
        files[f"mania-key{token}.png"] = png(128, 44, arrow(200, 200, 200))
        files[f"mania-key{token}D.png"] = png(128, 44, arrow(255, 255, 255))

    files["mania-stage-hint.png"] = png(256, 6, solid(255, 255, 255, 200))
    files["mania-stage-left.png"] = png(8, 256, solid(90, 90, 110))
    files["mania-stage-right.png"] = png(8, 256, solid(90, 90, 110))
    for i in range(4):
        files[f"mania-hit300-{i}.png"] = png(128, 128, solid(255, 240, 120, 80 + i * 50))

    files["skin.ini"] = (
        "[General]\r\nName: QM Sample osu\r\nAuthor: QuaverMania\r\nVersion: 2.5\r\n\r\n"
        "[Mania]\r\nKeys: 4\r\nColumnStart: 136\r\nColumnWidth: 30,30,30,30\r\n"
        "ColumnSpacing: 2,2,2\r\nHitPosition: 402\r\nNoteBodyStyle: 0\r\n"
        "Colour1: 40,20,20\r\nColour2: 20,30,50\r\nColour3: 20,30,50\r\nColour4: 40,20,20\r\n"
        "ColourLight1: 255,96,96\r\n\r\n"
        "[Mania]\r\nKeys: 7\r\nColumnStart: 100\r\nColumnWidth: 30,30,30,30,30,30,30\r\n"
        "HitPosition: 402\r\n"
    ).encode()

    write(os.path.join(OUT, "sample-osu.osk"), files, zipfile.ZIP_DEFLATED)


def write(path, files, compression):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w", compression) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    print(f"{path}  {os.path.getsize(path)} bytes  {len(files)} entries")


if __name__ == "__main__":
    build_quaver()
    build_osu()
