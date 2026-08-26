import type { RoundTripReport } from "../lib/skin/roundtrip";
import type { SkinPackage } from "../lib/skin/types";
import { FORMAT_LABEL } from "../lib/skin/types";

interface Props {
  pkg: SkinPackage;
  report: RoundTripReport | null;
}

export default function PackageReport({ pkg, report }: Props) {
  const totalBytes = pkg.entries.reduce((n, e) => n + e.bytes.length, 0);
  const images = pkg.entries.filter((e) => /\.(png|jpe?g)$/i.test(e.path)).length;
  const audio = pkg.entries.filter((e) => /\.(wav|ogg|mp3)$/i.test(e.path)).length;
  const sheets = pkg.entries.filter((e) => /@\d+x\d+\.png$/i.test(e.path)).length;

  return (
    <div className="report">
      <section className="panel">
        <h2>
          <span className={`fmt fmt-${pkg.format}`}>{FORMAT_LABEL[pkg.format]}</span>
          <span className="pkg-name">{pkg.name}</span>
        </h2>

        <dl className="stats">
          <Stat label="Entries" value={pkg.entries.length.toLocaleString()} />
          <Stat label="Images" value={images.toLocaleString()} />
          <Stat label="Spritesheets" value={sheets.toLocaleString()} />
          <Stat label="Audio" value={audio.toLocaleString()} />
          <Stat label="Uncompressed" value={formatBytes(totalBytes)} />
        </dl>

        {pkg.strippedRoot && (
          <p className="note">
            Archive was nested inside <code>{pkg.strippedRoot}/</code>. Paths were flattened to the skin root.
          </p>
        )}
        {pkg.detection.ambiguous && (
          <p className="note warn">
            Signals for both formats were found. This may be a partly-converted skin — check the evidence below.
          </p>
        )}
      </section>

      <section className="panel">
        <h3>Detection evidence</h3>
        <ul className="signals">
          {pkg.detection.signals.map((s, i) => (
            <li key={i}>
              <span className={`dot dot-${s.format}`} aria-hidden="true" />
              <span className="sig-reason">{s.reason}</span>
              <span className="sig-weight">{s.weight > 0 ? `+${s.weight}` : "—"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>skin.ini round trip</h3>
        {report === null ? (
          <p className="note warn">
            No <code>skin.ini</code> in this archive. Both games fall back to defaults, so conversion will have no
            geometry to carry across.
          </p>
        ) : (
          <>
            <p className={`verdict ${report.iniStable ? "ok" : "bad"}`}>
              {report.iniStable
                ? "Parsed and re-serialized identically — no data lost."
                : `Output differs from the source at character ${report.firstDiffAt}.`}
            </p>
            <dl className="stats">
              <Stat label="Sections" value={String(report.sectionCount)} />
              <Stat label="Keys" value={String(report.pairCount)} />
              <Stat label="Keymodes" value={report.keymodes.join(", ") || "none"} />
              <Stat label="Unparsed lines" value={String(report.unknownLines)} />
            </dl>
            <p className="note">Section names: {report.sectionNames.join(", ") || "none"}</p>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
