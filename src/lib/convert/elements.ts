/**
 * The element mapping table.
 *
 * Everything the converter knows about which file becomes which file lives
 * here as data, not as branching code. Later stages read the same table:
 * the canvas pipeline looks at `cost` to decide what needs processing, and
 * the conversion report walks it to say what happened.
 *
 * Path templates use two placeholders:
 *   {keymode}  Quaver's keymode folder — `4k`, `7k`, `sharedk`
 *   {lane}     Quaver's 1-based lane number
 *   {token}    osu!'s column token — `1`, `2` or `S`
 */

export type ElementGroup = "notes" | "receptors" | "stage" | "lighting" | "judgements";

export type ElementCost =
  /** Rename only. */
  | "identity"
  /** Needs an accompanying skin.ini value to look right. */
  | "geometry"
  /** Needs canvas processing — resizing, letterboxing, sheet packing. */
  | "image"
  /** Information is discarded in this direction. */
  | "lossy"
  /** No counterpart; dropped or synthesized. */
  | "none";

export interface ElementMapping {
  id: string;
  group: ElementGroup;
  label: string;
  /** Quaver path relative to the skin root, or null when Quaver has no counterpart. */
  quaver: string | null;
  /** osu! filename relative to the skin root, or null when osu! has no counterpart. */
  osu: string | null;
  /** True when the element exists once per lane. */
  perLane: boolean;
  cost: ElementCost;
  /** osu! skin.ini key that overrides the filename, with `{n}` for the column index. */
  osuIniKey?: string;
  /** Quaver spritesheet form, when the element animates as a sheet. */
  quaverSheet?: string;
  note?: string;
}

export const ELEMENTS: ElementMapping[] = [
  // ---------------------------------------------------------------- notes
  {
    id: "note",
    group: "notes",
    label: "Tap note",
    quaver: "{keymode}/HitObjects/note-hitobject-{lane}.png",
    osu: "mania-note{token}.png",
    osuIniKey: "NoteImage{n}",
    perLane: true,
    cost: "identity",
  },
  {
    id: "holdHead",
    group: "notes",
    label: "Long note head",
    quaver: "{keymode}/HitObjects/note-holdhitobject-{lane}.png",
    osu: "mania-note{token}H.png",
    osuIniKey: "NoteImage{n}H",
    perLane: true,
    cost: "identity",
  },
  {
    id: "holdBody",
    group: "notes",
    label: "Long note body",
    quaver: "{keymode}/HitObjects/note-holdbody-{lane}.png",
    quaverSheet: "{keymode}/HitObjects/note-holdbody-{lane}@{rows}x{cols}.png",
    osu: "mania-note{token}L.png",
    osuIniKey: "NoteImage{n}L",
    perLane: true,
    cost: "geometry",
    note: "Quaver stretches the body, so NoteBodyStyle must be 0 (Stretch) on the osu! side.",
  },
  {
    id: "holdTail",
    group: "notes",
    label: "Long note tail",
    quaver: "{keymode}/HitObjects/note-holdend-{lane}.png",
    osu: "mania-note{token}T.png",
    osuIniKey: "NoteImage{n}T",
    perLane: true,
    cost: "image",
    note: "osu! flips the tail by default from skin v2.5; Quaver draws it as authored.",
  },

  // ------------------------------------------------------------ receptors
  {
    id: "receptorUp",
    group: "receptors",
    label: "Receptor (idle)",
    quaver: "{keymode}/Receptors/receptor-up-{lane}.png",
    osu: "mania-key{token}.png",
    osuIniKey: "KeyImage{n}",
    perLane: true,
    cost: "image",
    note: "osu! stretches keys to the column box, ignoring aspect ratio; Quaver preserves it.",
  },
  {
    id: "receptorDown",
    group: "receptors",
    label: "Receptor (pressed)",
    quaver: "{keymode}/Receptors/receptor-down-{lane}.png",
    osu: "mania-key{token}D.png",
    osuIniKey: "KeyImage{n}D",
    perLane: true,
    cost: "image",
  },

  // ---------------------------------------------------------------- stage
  {
    id: "stageLeft",
    group: "stage",
    label: "Stage left border",
    quaver: "{keymode}/Stage/stage-left-border.png",
    osu: "mania-stage-left.png",
    osuIniKey: "StageLeft",
    perLane: false,
    cost: "identity",
  },
  {
    id: "stageRight",
    group: "stage",
    label: "Stage right border",
    quaver: "{keymode}/Stage/stage-right-border.png",
    osu: "mania-stage-right.png",
    osuIniKey: "StageRight",
    perLane: false,
    cost: "identity",
  },
  {
    id: "stageHint",
    group: "stage",
    label: "Judgement line",
    quaver: "{keymode}/Stage/stage-hitposition-overlay.png",
    osu: "mania-stage-hint.png",
    osuIniKey: "StageHint",
    perLane: false,
    cost: "geometry",
  },
  {
    id: "stageBgMask",
    group: "stage",
    label: "Stage background",
    quaver: "{keymode}/Stage/stage-bgmask.png",
    osu: null,
    perLane: false,
    cost: "lossy",
    note: "osu! tints lane backgrounds with Colour{n}; Quaver uses one image behind the stage.",
  },
  {
    id: "stageDistant",
    group: "stage",
    label: "Distant overlay",
    quaver: "{keymode}/Stage/stage-distant-overlay.png",
    osu: null,
    perLane: false,
    cost: "none",
    note: "Quaver-only.",
  },
  {
    id: "stageBottom",
    group: "stage",
    label: "Stage bottom overlay",
    quaver: null,
    osu: "mania-stage-bottom.png",
    osuIniKey: "StageBottom",
    perLane: false,
    cost: "none",
    note: "osu!-only.",
  },

  // ------------------------------------------------------------- lighting
  {
    id: "columnLight",
    group: "lighting",
    label: "Column lighting",
    quaver: "{keymode}/Lighting/column-lighting.png",
    osu: "mania-stage-light.png",
    osuIniKey: "StageLight",
    perLane: false,
    cost: "geometry",
  },
  {
    id: "hitLighting",
    group: "lighting",
    label: "Hit lighting",
    quaver: "{keymode}/Lighting/hitlighting.png",
    quaverSheet: "{keymode}/Lighting/hitlighting@{rows}x{cols}.png",
    osu: "lightingN.png",
    osuIniKey: "LightingN",
    perLane: false,
    cost: "image",
  },
  {
    id: "holdLighting",
    group: "lighting",
    label: "Hold lighting",
    quaver: "{keymode}/Lighting/holdlighting.png",
    quaverSheet: "{keymode}/Lighting/holdlighting@{rows}x{cols}.png",
    osu: "lightingL.png",
    osuIniKey: "LightingL",
    perLane: false,
    cost: "image",
  },

  // ----------------------------------------------------------- judgements
  ...judgement("marv", "300g"),
  ...judgement("perf", "300"),
  ...judgement("great", "200"),
  ...judgement("good", "100"),
  ...judgement("okay", "50"),
  ...judgement("miss", "0"),
];

function judgement(quaverName: string, osuName: string): ElementMapping[] {
  return [
    {
      id: `judge-${quaverName}`,
      group: "judgements",
      label: `Judgement (${quaverName})`,
      quaver: `Judgements/judge-${quaverName}.png`,
      quaverSheet: `Judgements/judge-${quaverName}@{rows}x{cols}.png`,
      osu: `mania-hit${osuName}.png`,
      osuIniKey: `Hit${osuName === "300g" ? "300g" : osuName}`,
      perLane: false,
      cost: "image",
    },
  ];
}

/** Elements that exist in both formats, in the direction given. */
export function mappableElements(): ElementMapping[] {
  return ELEMENTS.filter((e) => e.quaver !== null && e.osu !== null);
}

export function elementById(id: string): ElementMapping | undefined {
  return ELEMENTS.find((e) => e.id === id);
}

export interface PathContext {
  keymodeFolder: string;
  lane?: number;
  token?: string;
}

export function resolveQuaverPath(mapping: ElementMapping, ctx: PathContext): string | null {
  if (mapping.quaver === null) return null;
  return mapping.quaver
    .replace("{keymode}", ctx.keymodeFolder)
    .replace("{lane}", String(ctx.lane ?? 1));
}

export function resolveOsuPath(mapping: ElementMapping, ctx: PathContext): string | null {
  if (mapping.osu === null) return null;
  return mapping.osu.replace("{token}", ctx.token ?? "1");
}

/** Expand an osu! skin.ini image key like `NoteImage{n}H` for a column. */
export function resolveOsuIniKey(mapping: ElementMapping, columnIndex: number): string | null {
  if (!mapping.osuIniKey) return null;
  return mapping.osuIniKey.replace("{n}", String(columnIndex));
}
