import { useCallback, useState } from "react";
import DropZone from "./components/DropZone";
import PackageReport from "./components/PackageReport";
import { readSkin } from "./lib/skin/read";
import { writeSkin, downloadBlob } from "./lib/skin/write";
import { checkRoundTrip, type RoundTripReport } from "./lib/skin/roundtrip";
import { FORMAT_EXTENSION, type SkinPackage } from "./lib/skin/types";

type State =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "ready"; pkg: SkinPackage; report: RoundTripReport | null }
  | { phase: "error"; message: string };

export default function App() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (file: File) => {
    setState({ phase: "reading" });
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
        <p className="stage">
          Stage 1 · container round trip. This build reads a skin, verifies nothing is lost parsing its{" "}
          <code>skin.ini</code>, and writes it back out. Element conversion comes next.
        </p>
      </header>

      <DropZone onFile={load} busy={state.phase === "reading"} />

      {state.phase === "error" && (
        <div className="panel error" role="alert">
          <h3>Could not read that skin</h3>
          <p>{state.message}</p>
        </div>
      )}

      {state.phase === "ready" && (
        <>
          <PackageReport pkg={state.pkg} report={state.report} />
          <div className="actions">
            <button type="button" className="primary" onClick={() => save(state.pkg)} disabled={saving}>
              {saving ? "Packing…" : `Re-export ${FORMAT_EXTENSION[state.pkg.format]}`}
            </button>
            <button type="button" onClick={() => setState({ phase: "idle" })}>
              Load another
            </button>
          </div>
          <p className="hint">
            Re-export writes the skin back unchanged. Import it into{" "}
            {state.pkg.format === "quaver" ? "Quaver" : "osu!"} and confirm it still loads — that is the stage 1 test.
          </p>
        </>
      )}
    </main>
  );
}
