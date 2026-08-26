/**
 * The health bar.
 *
 * Global to the skin rather than per keymode, so like the number fonts this
 * sits outside the per-element table.
 *
 *   Quaver  /Health/health-background.png   static backing
 *           /Health/health-foreground.png   the part that crops as HP changes
 *   osu!    scorebar-bg.png                 static backing
 *           scorebar-colour.png             the part that crops
 *
 * Two mismatches have to be handled rather than ignored:
 *
 *   Orientation  Quaver's bar may be vertical (its docs suggest 600x40
 *                horizontal or 40x600 vertical). osu!'s scorebar is
 *                horizontal only, so a vertical source has to be rotated or
 *                it renders sideways.
 *   Extra pieces osu! also draws `scorebar-marker` (a knob at the fill edge)
 *                and `scorebar-ki` (a character at the end). Quaver has
 *                neither, so osu! would fall back to its own defaults and
 *                stamp them onto a converted skin. Suppressing them with a
 *                transparent pixel is closer to the source than letting
 *                osu!'s defaults through.
 */

export interface HealthPiece {
  id: string;
  label: string;
  quaver: string;
  osu: string;
}

export const HEALTH_PIECES: HealthPiece[] = [
  {
    id: "healthBackground",
    label: "Health bar background",
    quaver: "Health/health-background.png",
    osu: "scorebar-bg.png",
  },
  {
    id: "healthForeground",
    label: "Health bar fill",
    quaver: "Health/health-foreground.png",
    osu: "scorebar-colour.png",
  },
];

/**
 * osu! elements with no Quaver counterpart that would otherwise fall back to
 * osu!'s stock art on top of a converted skin.
 */
export const SUPPRESSED_OSU_PIECES = [
  "scorebar-marker.png",
  "scorebar-ki.png",
  "scorebar-kidanger.png",
  "scorebar-kidanger2.png",
];

/**
 * A 1x1 fully transparent PNG.
 *
 * Used to blank an element rather than delete it, because osu! substitutes its
 * own default for a missing file but honours an empty one. Hard-coded rather
 * than drawn, so it works without a canvas.
 */
const TRANSPARENT_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function transparentPixel(): Uint8Array {
  const binary = atob(TRANSPARENT_PIXEL_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Rotation needed to turn a vertical Quaver bar into osu!'s horizontal one.
 *
 * Quaver's vertical bar fills upward from the bottom; osu! fills rightward
 * from the left, so the bottom edge has to end up on the left.
 *
 * `rotate()` turns clockwise, and under a clockwise quarter turn a downward
 * vector (0, 1) maps to (-1, 0) — bottom becomes left. 270 would send bottom
 * to the right instead, which inverts the fill and renders the bar backwards.
 */
export const VERTICAL_TO_HORIZONTAL_DEGREES = 90;

export function isVertical(width: number, height: number): boolean {
  return height > width;
}
