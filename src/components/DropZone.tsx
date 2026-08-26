import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

export default function DropZone({ onFile, busy }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className={`drop${over ? " is-over" : ""}${busy ? " is-busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".qs,.osk,.zip"
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="drop-title">{busy ? "Reading archive…" : "Drop a skin here"}</p>
      <p className="drop-sub">
        <code>.qs</code> or <code>.osk</code> — nothing leaves your browser
      </p>
      <button type="button" onClick={() => input.current?.click()} disabled={busy}>
        Choose file
      </button>
    </div>
  );
}
