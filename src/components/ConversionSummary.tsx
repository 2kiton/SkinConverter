import { useState } from "react";
import {
  IMPERFECT,
  STATUS_LABEL,
  type ConversionReport,
  type EntryStatus,
  type ReportEntry,
} from "../lib/convert/report";

interface Props {
  report: ConversionReport;
}

const ORDER: EntryStatus[] = [
  "copied",
  "configured",
  "processed",
  "synthesized",
  "approximated",
  "dropped",
  "missing",
];

/**
 * A converter aiming at perfect output has to name the rows it could not make
 * perfect, or the user finds the gap in-game with no idea which of two hundred
 * files caused it. Imperfect rows are shown first and expanded by default.
 */
export default function ConversionSummary({ report }: Props) {
  const [showAll, setShowAll] = useState(false);

  const imperfect = report.entries.filter((e) => IMPERFECT.includes(e.status));
  const shown = showAll ? report.entries : imperfect;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Conversion report</h3>
        <span className="preview-meta">{report.keymodes.join(", ")}</span>
      </div>

      <dl className="stats">
        {ORDER.filter((s) => report.counts[s] > 0).map((status) => (
          <div className="stat" key={status}>
            <dt>{STATUS_LABEL[status]}</dt>
            <dd className={IMPERFECT.includes(status) ? "is-imperfect" : undefined}>{report.counts[status]}</dd>
          </div>
        ))}
      </dl>

      {report.warnings.length > 0 && (
        <ul className="warnings">
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {report.entries.length > 0 && (
        <>
          <div className="panel-head">
            <h3>
              {showAll ? `All ${report.entries.length} elements` : `${imperfect.length} need attention`}
            </h3>
            <button type="button" className="chip" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show only problems" : "Show everything"}
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="verdict ok">Every element mapped cleanly.</p>
          ) : (
            <div className="tscroll">
              <table>
                <thead>
                  <tr>
                    <th>Element</th>
                    <th>Status</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry, i) => (
                    <Row key={`${entry.elementId}-${entry.keymode}-${entry.lane}-${i}`} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Row({ entry }: { entry: ReportEntry }) {
  return (
    <tr>
      <td>
        {entry.label}
        {entry.lane !== undefined && <span className="dim"> · lane {entry.lane}</span>}
        {entry.keymode && <span className="dim"> · {entry.keymode}</span>}
        {entry.detail && <div className="row-detail">{entry.detail}</div>}
      </td>
      <td>
        <span className={`badge b-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
      </td>
      <td className="mono">{entry.from ?? "—"}</td>
      <td className="mono">{entry.to ?? "—"}</td>
    </tr>
  );
}
