/**
 * Column indexing.
 *
 * Quaver names one texture per lane, 1-based: `note-hitobject-3.png` is lane 3.
 * osu! does not. It names textures `mania-note1`, `mania-note2` and
 * `mania-noteS`, and works out which one a column uses from the column's
 * distance to the edge of the stage — unless the skin overrides the choice
 * with an explicit `NoteImage{n}` key.
 *
 * The rule below is a direct port of osu!'s own `LegacyManiaColumnElement`:
 *
 *     if (Column.IsSpecial) FallbackColumnIndex = "S";
 *     else {
 *         int columnInStage  = Column.Index % stage.Columns;
 *         int distanceToEdge = Math.Min(columnInStage, (stage.Columns - 1) - columnInStage);
 *         FallbackColumnIndex = distanceToEdge % 2 == 0 ? "1" : "2";
 *     }
 *
 * Getting this wrong silently swaps lane colours across the whole stage, and
 * community lore about it is unreliable — the widely repeated "7K is
 * 1,2,1,S,1,2,1" only holds when a special column actually exists, which by
 * default it does not.
 */

export type OsuColumnToken = "1" | "2" | "S";

/** `SpecialStyle` in osu!'s `[Mania]` section. */
export enum SpecialStyle {
  None = 0,
  Left = 1,
  Right = 2,
}

export function parseSpecialStyle(raw: string | undefined): SpecialStyle {
  switch ((raw ?? "").trim()) {
    case "1":
      return SpecialStyle.Left;
    case "2":
      return SpecialStyle.Right;
    default:
      return SpecialStyle.None;
  }
}

/**
 * Index of the special (scratch) column, or null when the stage has none.
 * osu! only honours a special column from 5 keys upward.
 */
export function specialColumnIndex(keys: number, style: SpecialStyle): number | null {
  if (style === SpecialStyle.None || keys < 5) return null;
  return style === SpecialStyle.Left ? 0 : keys - 1;
}

/** The `1` / `2` / `S` token osu! uses for a column when the skin gives no override. */
export function fallbackColumnToken(
  columnIndex: number,
  totalColumns: number,
  special: number | null,
): OsuColumnToken {
  if (special !== null && columnIndex === special) return "S";
  const columnInStage = columnIndex % totalColumns;
  const distanceToEdge = Math.min(columnInStage, totalColumns - 1 - columnInStage);
  return distanceToEdge % 2 === 0 ? "1" : "2";
}

/** Every column's token for a keycount, in column order. */
export function columnTokens(keys: number, style: SpecialStyle = SpecialStyle.None): OsuColumnToken[] {
  const special = specialColumnIndex(keys, style);
  return Array.from({ length: keys }, (_, i) => fallbackColumnToken(i, keys, special));
}

/**
 * Quaver's scratch lane. In its keymode folders the scratch lane is an extra
 * texture index past the playable lanes — lane 8 in 7K, per the wiki's
 * "there's an extra texture for the scratch lane" note.
 */
export function quaverScratchLane(keys: number): number {
  return keys + 1;
}

/** Quaver lane number (1-based) for an osu! column index (0-based). */
export function osuColumnToQuaverLane(columnIndex: number): number {
  return columnIndex + 1;
}

/** osu! column index (0-based) for a Quaver lane number (1-based). */
export function quaverLaneToOsuColumn(lane: number): number {
  return lane - 1;
}
