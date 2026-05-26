'use client';

import { useEffect, useRef, useState } from 'react';

interface Rect { x: number; y: number; w: number; h: number }

interface Props {
  file: File;
  onConfirm: (cropped: File) => void;
  onSkip: () => void;
}

export default function CropModal({ file, onConfirm, onSkip }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [srcUrl, setSrcUrl] = useState('');
  const [rect, setRect] = useState<Rect | null>(null);
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── pointer helpers ──────────────────────────────────────────────────────
  function toRelative(clientX: number, clientY: number) {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const b = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (clientY - b.top) / b.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    const p = toRelative(e.clientX, e.clientY);
    startPos.current = p;
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const p = toRelative(e.clientX, e.clientY);
    const sx = startPos.current.x, sy = startPos.current.y;
    setRect({
      x: Math.min(sx, p.x),
      y: Math.min(sy, p.y),
      w: Math.abs(p.x - sx),
      h: Math.abs(p.y - sy),
    });
  }

  function onPointerUp() {
    dragging.current = false;
  }

  // ── crop & export ────────────────────────────────────────────────────────
  async function handleConfirm() {
    const img = imgRef.current;
    if (!img || !rect || rect.w < 0.01 || rect.h < 0.01) {
      onSkip(); // too small → use original
      return;
    }
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const canvas = document.createElement('canvas');
    const cw = Math.round(rect.w * nw);
    const ch = Math.round(rect.h * nh);
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, rect.x * nw, rect.y * nh, cw, ch, 0, 0, cw, ch);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92)
    );
    const name = file.name.replace(/\.[^.]+$/, '') + '_crop.jpg';
    onConfirm(new File([blob], name, { type: 'image/jpeg' }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-800">範囲を選択</p>
            <p className="text-xs text-gray-400">ドラッグして切り取り範囲を指定してください</p>
          </div>
          <button onClick={onSkip} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image + crop overlay */}
        <div
          ref={containerRef}
          className="relative select-none touch-none overflow-hidden bg-gray-900 cursor-crosshair"
          style={{ maxHeight: '60vh' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {srcUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={srcUrl}
              alt="crop"
              draggable={false}
              className="w-full h-full object-contain block"
              style={{ maxHeight: '60vh' }}
            />
          )}

          {/* Dark overlay with hole */}
          {rect && rect.w > 0.005 && rect.h > 0.005 && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {/* Dimming mask with transparent hole */}
              <defs>
                <mask id="hole">
                  <rect x="0" y="0" width="1" height="1" fill="white" />
                  <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="black" />
                </mask>
              </defs>
              <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.5)" mask="url(#hole)" />
              {/* Border */}
              <rect
                x={rect.x} y={rect.y} width={rect.w} height={rect.h}
                fill="none" stroke="white" strokeWidth="0.003"
              />
              {/* Corner handles */}
              {([
                [rect.x, rect.y], [rect.x + rect.w, rect.y],
                [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
              ] as [number, number][]).map(([cx, cy], i) => (
                <rect key={i} x={cx - 0.012} y={cy - 0.012} width={0.024} height={0.024}
                  fill="white" rx="0.004" />
              ))}
            </svg>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
          <button
            onClick={onSkip}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            そのまま使う
          </button>
          <button
            onClick={handleConfirm}
            disabled={!rect || rect.w < 0.01 || rect.h < 0.01}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
          >
            この範囲で決定
          </button>
        </div>
      </div>
    </div>
  );
}
