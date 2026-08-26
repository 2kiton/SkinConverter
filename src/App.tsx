import { useCallback, useEffect, useMemo, useState } from "react";
import DropZone from "./components/DropZone";
import PackageReport from "./components/PackageReport";
import PlayfieldPreview from "./components/PlayfieldPreview";
import ConversionSummary from "./components/ConversionSummary";
import { readSkin } from "./lib/skin/read";
import { writeSkin, downloadBlob } from "./lib/skin/write";
import { checkRoundTrip, type RoundTripReport } from "./lib/skin/roundtrip";
import { convertSkin } from "./lib/convert/convert";
import { canvasProcessor } from "./lib/convert/images";
import type { ConversionReport } from "./lib/convert/report";
import { availableKeymodes } from "./lib/preview/layout";
import { FORMAT_EXTENSION, FORMAT_LABEL, type SkinPackage } from "./lib/skin/types";

type State =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "ready"; pkg: SkinPackage; report: RoundTripReport | null }
  | { phase: "error"; message: string };

interface Converted {
  pkg: SkinPackage;
  report: ConversionReport;
}

export default function App() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState<Converted | null>(null);
  const [keymode, setKeymode] = useState("");

  const source = state.phase === "ready" ? state.pkg : null;
  const keymodes = useMemo(() => (source ? availableKeymodes(source) : []), [source]);

  useEffect(() => {
    if (keymodes.length > 0 && !keymodes.includes(keymode)) setKeymode(keymodes[0]!);
  }, [keymodes, keymode]);

  const convert = useCallback(async (pkg: SkinPackage) => {
    setConverting(true);
    try {
      const result = await convertSkin(pkg, { processor: canvasProcessor() });
      setConverted({ pkg: result.pkg, report: result.report });
    } finally {
      setConverting(false);
    }
  }, []);

  const load = useCallback(async (file: File) => {
    setState({ phase: "reading" });
    setConverted(null);
    try {
      const pkg = await readSkin(file);
      setState({ phase: "ready", pkg, report: checkRoundTrip(pkg) });
    } catch (error) {
      setState({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "That file could not be read as a ZIP archive. Skins exported from either game should work.",
      });
    }
  }, []);

  const save = useCallback(async (pkg: SkinPackage) => {
    setSaving(true);
    try {
      const blob = await writeSkin(pkg);
      downloadBlob(blob, `${pkg.name}${FORMAT_EXTENSION[pkg.format]}`);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <main>
      <header className="masthead">
        <p className="eyebrow">
          <span className="q">.qs</span>
          <span aria-hidden="true">⇄</span>
          <span className="o">.osk</span>
        </p>
        <h1>QuaverMania</h1>
        <p className="deck">
          Convert Quaver and osu!mania skins with the playfield intact. Everything runs in your browser — no upload, no
          account.
        </p>
      </header>

      <DropZone onFile={load} busy={state.phase === "reading"} />

      {state.phase === "error" && (
        <div className="panel error" role="alert">
          <h3>Could not read that skin</h3>
          <p>{state.message}</p>
        </div>
      )}

      {source && (
        <>
          <PackageReport pkg={source} report={state.phase === "ready" ? state.report : null} />

          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => convert(source)}
              disabled={saving || converting}
            >
              {converting
                ? "Converting…"
                : `Convert to ${FORMAT_LABEL[source.format === "quaver" ? "osu" : "quaver"]}`}
            </button>
            <button type="button" onClick={() => save(source)} disabled={saving || converting}>
              Re-export source
            </button>
            <button
              type="button"
              onClick={() => setState({ phase: "idle" })}
              disabled={saving || converting}
            >
              Load another
            </button>
          </div>

          {keymodes.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h3>Playfield</h3>
                {keymodes.length > 1 && (
                  <div className="keymodes" role="group" aria-label="Keymode">
                    {keymodes.map((km) => (
                      <button
                        key={km}
                        type="button"
                        className={`chip${km === keymode ? " is-active" : ""}`}
                        onClick={() => setKeymode(km)}
                        aria-pressed={km === keymode}
                      >
                        {km}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="preview-pair">
                <PlayfieldPreview pkg={source} keymode={keymode} />
                {converted && <PlayfieldPreview pkg={converted.pkg} keymode={keymode} />}
              </div>

              <p className="hint">
                Each side is drawn by its own game's rules. Receptors are the tell: osu! stretches the key image to the
                column width and the band down to the stage bottom, ignoring aspect ratio, while Quaver scales to the
                column width and keeps it.
              </p>
            </section>
          )}

          {converted && (
            <>
              <ConversionSummary report={converted.report} />
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => save(converted.pkg)}
                  disabled={saving || converting}
                >
                  {saving ? "Packing…" : `Download ${FORMAT_EXTENSION[converted.pkg.format]}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
