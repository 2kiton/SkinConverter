import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_HEIGHT, buildLayout, type PlayfieldLayout } from "../lib/preview/layout";
import type { SkinFormat, SkinPackage } from "../lib/skin/types";
import { FORMAT_LABEL } from "../lib/skin/types";

interface Props {
  pkg: SkinPackage;
  keymode: string;
}

/**
 * A fixed scene, so two skins are always compared on the same notes. Values
 * are distances from the judgement line in 768-space; the hold spans a range.
 */
const SCENE = {
  taps: [520, 300, 640, 180, 420, 250, 580, 340, 460, 210, 600],
  hold: { lane: 0, from: 90, to: 400 },
};

export default function PlayfieldPreview({ pkg, keymode }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => buildLayout(pkg, keymode), [pkg, keymode]);
  const images = useSkinImages(pkg, layout);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !layout) return;
    draw(el, layout, images, pkg.format);
  }, [layout, images, pkg.format]);

  if (!layout) {
    return <p className="note warn">No playfield configuration found for {keymode}.</p>;
  }

  const missing = layout.lanes.filter((l) => l.note === null).length;

  return (
    <div className="preview">
      <div className="preview-head">
        <span className={`fmt fmt-${pkg.format}`}>{FORMAT_LABEL[pkg.format]}</span>
        <span className="preview-meta">
          {layout.keymode} · lane {Math.round(layout.lanes[0]?.width ?? 0)}u · hit line{" "}
          {Math.round(layout.hitPositionFromBottom)}u from bottom
        </span>
      </div>
      <canvas ref={canvas} className="preview-canvas" width={520} height={640} />
      {missing > 0 && (
        <p className="note warn">
          {missing} of {layout.keys} lanes have no note image — they are drawn as outlines.
        </p>
      )}
      {layout.assumptions.map((a) => (
        <p className="note" key={a}>
          {a}
        </p>
      ))}
    </div>
  );
}

/** Decode every image the layout references, once per package. */
function useSkinImages(pkg: SkinPackage, layout: PlayfieldLayout | null): Map<string, HTMLImageElement> {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    if (!layout) return;
    let cancelled = false;

    const wanted = new Set<string>();
    for (const lane of layout.lanes) {
      for (const path of [lane.note, lane.holdHead, lane.holdBody, lane.holdTail, lane.receptor]) {
        if (path) wanted.add(path);
      }
    }
    for (const path of [layout.stageHint, layout.stageLeft, layout.stageRight]) {
      if (path) wanted.add(path);
    }

    const urls: string[] = [];
    const loaded = new Map<string, HTMLImageElement>();

    const jobs = [...wanted].map((path) => {
      const entry = pkg.entries.find((e) => e.path === path);
      if (!entry) return Promise.resolve();

      const copy = new Uint8Array(entry.bytes);
      const url = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: "image/png" }));
      urls.push(url);

      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          loaded.set(path, img);
          resolve();
        };
        // A skin with a corrupt or unsupported image should degrade to an
        // outline, not blank the whole preview.
        img.onerror = () => resolve();
        img.src = url;
      });
    });

    void Promise.all(jobs).then(() => {
      if (!cancelled) setImages(loaded);
    });

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [pkg, layout]);

  return images;
}

function draw(
  canvas: HTMLCanvasElement,
  layout: PlayfieldLayout,
  images: Map<string, HTMLImageElement>,
  format: SkinFormat,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  ctx.fillStyle = dark ? "#0b0c11" : "#1a1b22";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Fit the field by height, then centre the stage horizontally.
  const scale = cssHeight / FIELD_HEIGHT;
  const stagePx = layout.totalWidth * scale;
  const originX = (cssWidth - stagePx) / 2;
  const hitY = cssHeight - layout.hitPositionFromBottom * scale;

  const laneX: number[] = [];
  let cursor = originX;
  for (let i = 0; i < layout.lanes.length; i++) {
    laneX.push(cursor);
    cursor += (layout.lanes[i]?.width ?? 0) * scale + (layout.spacing[i] ?? 0) * scale;
  }

  // 1. Lane backgrounds. osu! tints these with Colour{n}; Quaver cannot.
  layout.lanes.forEach((lane, i) => {
    const x = laneX[i] ?? 0;
    const w = lane.width * scale;
    ctx.fillStyle = lane.laneColour
      ? `rgba(${lane.laneColour.r},${lane.laneColour.g},${lane.laneColour.b},${lane.laneColour.a / 255})`
      : "rgba(255,255,255,0.035)";
    ctx.fillRect(x, 0, w, cssHeight);

    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, cssHeight);
    ctx.stroke();
  });
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.beginPath();
  ctx.moveTo(Math.round(originX + stagePx) + 0.5, 0);
  ctx.lineTo(Math.round(originX + stagePx) + 0.5, cssHeight);
  ctx.stroke();

  // 2. Hold note, drawn behind the taps so the head reads correctly.
  const holdLane = layout.lanes[SCENE.hold.lane];
  if (holdLane) {
    const x = laneX[SCENE.hold.lane] ?? 0;
    const w = holdLane.width * scale;
    const top = hitY - SCENE.hold.to * scale;
    const bottom = hitY - SCENE.hold.from * scale;

    const body = holdLane.holdBody ? images.get(holdLane.holdBody) : undefined;
    if (body) {
      // Both games stretch the body between head and tail in this configuration.
      ctx.drawImage(body, x, top, w, bottom - top);
    } else {
      ctx.fillStyle = "rgba(120,180,255,0.28)";
      ctx.fillRect(x, top, w, bottom - top);
    }

    const tail = holdLane.holdTail ? images.get(holdLane.holdTail) : undefined;
    if (tail) drawNote(ctx, tail, x, top, w, "up");

    const head = holdLane.holdHead ? images.get(holdLane.holdHead) : undefined;
    if (head) drawNote(ctx, head, x, bottom, w, "down");
    else outlineNote(ctx, x, bottom, w);
  }

  // 3. Tap notes.
  layout.lanes.forEach((lane, i) => {
    if (i === SCENE.hold.lane) return;
    const x = laneX[i] ?? 0;
    const w = lane.width * scale;
    const y = hitY - (SCENE.taps[i % SCENE.taps.length] ?? 300) * scale;

    const img = lane.note ? images.get(lane.note) : undefined;
    if (img) drawNote(ctx, img, x, y, w, "down");
    else outlineNote(ctx, x, y, w);
  });

  // 4. Judgement line.
  const hint = layout.stageHint ? images.get(layout.stageHint) : undefined;
  if (hint) {
    const h = (hint.height / hint.width) * stagePx;
    ctx.drawImage(hint, originX, hitY - h / 2, stagePx, h);
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(originX, Math.round(hitY) + 0.5);
    ctx.lineTo(originX + stagePx, Math.round(hitY) + 0.5);
    ctx.stroke();
  }

  // 5. Receptors, drawn by each format's own sizing rule. This is the whole
  //    reason the preview exists: osu! stretches the key image to the column
  //    width AND the band from the hit position to the bottom of the stage,
  //    ignoring aspect ratio, while Quaver scales to the column width and
  //    keeps it. The same file looks different in each game.
  layout.lanes.forEach((lane, i) => {
    const img = lane.receptor ? images.get(lane.receptor) : undefined;
    const x = laneX[i] ?? 0;
    const w = lane.width * scale;
    if (!img) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 2, hitY, w - 4, Math.min(w, cssHeight - hitY) - 2);
      return;
    }

    if (format === "osu") {
      ctx.drawImage(img, x, hitY, w, cssHeight - hitY);
    } else {
      const h = (img.height / img.width) * w;
      ctx.drawImage(img, x, hitY - h / 2, w, h);
    }
  });

  // 6. Stage borders.
  const left = layout.stageLeft ? images.get(layout.stageLeft) : undefined;
  if (left) {
    const w = (left.width / left.height) * cssHeight;
    ctx.drawImage(left, originX - w, 0, w, cssHeight);
  }
  const right = layout.stageRight ? images.get(layout.stageRight) : undefined;
  if (right) {
    const w = (right.width / right.height) * cssHeight;
    ctx.drawImage(right, originX + stagePx, 0, w, cssHeight);
  }
}

/**
 * Notes scale to the column width and keep their aspect ratio in both games —
 * osu! does this in `LegacyNotePiece.Update`, dividing by the texture width.
 * `anchor` says which edge sits on `y`.
 */
function drawNote(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  anchor: "up" | "down",
): void {
  if (img.width === 0) return;
  const height = (img.height / img.width) * width;
  ctx.drawImage(img, x, anchor === "down" ? y - height : y, width, height);
}

function outlineNote(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  const height = width * 0.28;
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 2, y - height, width - 4, height);
  ctx.setLineDash([]);
}
