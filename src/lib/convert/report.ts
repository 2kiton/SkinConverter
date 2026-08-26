/**
 * The conversion report.
 *
 * A converter aiming at perfect output has to be honest about the rows it
 * could not make perfect, otherwise the user discovers the gap in-game with
 * no idea which of two hundred files caused it.
 */

import type { ElementCost, ElementGroup } from "./elements";

export type EntryStatus =
  /** Carried across unchanged. */
  | "copied"
  /** Carried across, with a skin.ini value written to match. */
  | "configured"
  /** Pixels were processed — resized, letterboxed, packed or sliced. */
  | "processed"
  /** Carried across, but something about it could not survive. */
  | "approximated"
  /** No counterpart in the target format. */
  | "dropped"
  /** Created from config rather than copied from a file. */
  | "synthesized"
  /** Expected but absent from the source skin. */
  | "missing";

export interface ReportEntry {
  elementId: string;
  label: string;
  group: ElementGroup;
  cost: ElementCost;
  status: EntryStatus;
  keymode?: string;
  lane?: number;
  from?: string;
  to?: string;
  detail?: string;
}

export interface ConversionReport {
  from: "quaver" | "osu";
  to: "quaver" | "osu";
  keymodes: string[];
  entries: ReportEntry[];
  /** Things the user should know before trusting the output in-game. */
  warnings: string[];
  counts: Record<EntryStatus, number>;
}

export function emptyCounts(): Record<EntryStatus, number> {
  return {
    copied: 0,
    configured: 0,
    processed: 0,
    approximated: 0,
    dropped: 0,
    synthesized: 0,
    missing: 0,
  };
}

export function tally(entries: ReportEntry[]): Record<EntryStatus, number> {
  const counts = emptyCounts();
  for (const entry of entries) counts[entry.status]++;
  return counts;
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  copied: "Copied",
  configured: "Copied + configured",
  processed: "Processed",
  approximated: "Approximated",
  dropped: "Dropped",
  synthesized: "Synthesized",
  missing: "Missing from source",
};

/** Statuses that mean the output is not a faithful reproduction. */
export const IMPERFECT: EntryStatus[] = ["approximated", "dropped", "missing"];
