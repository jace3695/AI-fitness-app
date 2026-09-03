"use client";

import { forwardRef, PointerEvent, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

export type DrawingPracticeCanvasHandle = {
  toBlob: () => Promise<Blob | null>;
  discardDraft: () => void;
};

const MAX_HISTORY = 10;
type HistoryEntry = { source: string; dirty: boolean };
type DrawingPracticeCanvasProps = {
  guide?: ReactNode;
  guideVisible?: boolean;
  onToggleGuide?: () => void;
  draftKey: string;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};

const DrawingPracticeCanvas = forwardRef<DrawingPracticeCanvasHandle, DrawingPracticeCanvasProps>(function DrawingPracticeCanvas({ guide, guideVisible = true, onToggleGuide, draftKey, disabled = false, onDirtyChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const strokeChangedRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const restoreTokenRef = useRef(0);
  const [, setHistoryVersion] = useState(0);

  const fillWhite = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }, []);

  const persistDraft = useCallback((source: string, dirty: boolean) => {
    try {
      if (dirty) window.sessionStorage.setItem(draftKey, source);
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // The in-memory canvas remains available when browser storage is full or disabled.
    }
    onDirtyChange?.(dirty);
  }, [draftKey, onDirtyChange]);

  const snapshot = useCallback((dirty = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    restoreTokenRef.current += 1;
    const source = canvas.toDataURL("image/webp", 0.72);
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push({ source, dirty });
    historyRef.current = next.slice(-MAX_HISTORY);
    historyIndexRef.current = historyRef.current.length - 1;
    persistDraft(source, dirty);
    setHistoryVersion((value) => value + 1);
  }, [persistDraft]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(720, Math.round(rect.width * ratio));
      const height = Math.round(width * 9 / 16);
      if (canvas.width === width && canvas.height === height) return;
      const previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = width;
      canvas.height = height;
      fillWhite();
      if (previous.width && previous.height) canvas.getContext("2d")?.drawImage(previous, 0, 0, width, height);
    };
    let savedDraft: string | null = null;
    try { savedDraft = window.sessionStorage.getItem(draftKey); } catch { /* Use a blank in-memory canvas. */ }
    resize();
    const blankSource = canvas.toDataURL("image/webp", 0.72);
    historyRef.current = [{ source: blankSource, dirty: false }];
    historyIndexRef.current = 0;
    onDirtyChange?.(false);
    setHistoryVersion((value) => value + 1);
    if (savedDraft) {
      const restoreToken = ++restoreTokenRef.current;
      const image = new Image();
      image.onload = () => {
        if (restoreToken !== restoreTokenRef.current) return;
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        snapshot(true);
      };
      image.onerror = () => {
        if (restoreToken !== restoreTokenRef.current) return;
        onDirtyChange?.(false);
      };
      image.src = savedDraft;
    } else persistDraft(blankSource, false);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draftKey, fillWhite, onDirtyChange, persistDraft, snapshot]);

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      canvas.toBlob(resolve, "image/png", 0.9);
    }),
    discardDraft: () => {
      try { window.sessionStorage.removeItem(draftKey); } catch { /* The saved cloud record is still authoritative. */ }
      onDirtyChange?.(false);
    },
  }), [draftKey, onDirtyChange]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !event.isPrimary || activePointerRef.current !== null) return;
    event.preventDefault();
    restoreTokenRef.current += 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    drawingRef.current = true;
    const start = point(event);
    lastPointRef.current = start;
    const context = event.currentTarget.getContext("2d");
    if (context) {
      const pressure = event.pressure > 0 ? event.pressure : 0.45;
      context.fillStyle = "#242231";
      context.beginPath();
      context.arc(start.x, start.y, (2.5 + pressure * 5.5) / 2, 0, Math.PI * 2);
      context.fill();
      strokeChangedRef.current = true;
    }
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    const pressure = event.pressure > 0 ? event.pressure : 0.45;
    context.strokeStyle = "#242231";
    context.lineWidth = 2.5 + pressure * 5.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    strokeChangedRef.current = true;
    lastPointRef.current = next;
  };

  const stopDrawing = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || (event && activePointerRef.current !== event.pointerId)) return;
    drawingRef.current = false;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activePointerRef.current = null;
    if (strokeChangedRef.current) snapshot();
    strokeChangedRef.current = false;
  };

  const restore = (index: number) => {
    const canvas = canvasRef.current;
    const entry = historyRef.current[index];
    if (!canvas || !entry || index < 0 || index >= historyRef.current.length) return;
    const restoreToken = ++restoreTokenRef.current;
    const image = new Image();
    image.onload = () => {
      if (restoreToken !== restoreTokenRef.current) return;
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      historyIndexRef.current = index;
      persistDraft(entry.source, entry.dirty);
      setHistoryVersion((value) => value + 1);
    };
    image.src = entry.source;
  };

  const clear = () => {
    fillWhite();
    snapshot(false);
  };

  return <section aria-label="iPad 그림 연습장" className="rounded-3xl bg-[#f8f7fc] p-3 sm:p-4">
    <div className="no-print flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs leading-5 text-gray-500">한 종류의 연필만 사용하세요. 자동 선 보정은 적용하지 않습니다.</p>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {guide && onToggleGuide ? <button type="button" onClick={onToggleGuide} disabled={disabled} aria-pressed={!guideVisible} className="min-h-11 rounded-xl bg-violet-50 px-4 text-xs font-bold text-violet-700 ring-1 ring-violet-100 disabled:opacity-40">{guideVisible ? "가이드 숨기기" : "가이드 보기"}</button> : null}
        <button type="button" onClick={() => restore(historyIndexRef.current - 1)} disabled={disabled || historyIndexRef.current <= 0} className="min-h-11 rounded-xl bg-white px-4 text-xs font-bold text-gray-700 ring-1 ring-gray-200 disabled:opacity-40">되돌리기</button>
        <button type="button" onClick={() => restore(historyIndexRef.current + 1)} disabled={disabled || historyIndexRef.current >= historyRef.current.length - 1} className="min-h-11 rounded-xl bg-white px-4 text-xs font-bold text-gray-700 ring-1 ring-gray-200 disabled:opacity-40">다시 실행</button>
        <button type="button" onClick={clear} disabled={disabled} className="min-h-11 rounded-xl bg-red-50 px-4 text-xs font-bold text-red-600 disabled:opacity-40">모두 지우기</button>
      </div>
    </div>
    <div className="relative mt-3 overflow-hidden rounded-2xl bg-white shadow-inner ring-1 ring-gray-200">
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        className="block w-full bg-white"
        style={{ touchAction: "none", aspectRatio: "16 / 9" }}
        aria-label="Apple Pencil 또는 손가락으로 그리는 연습장"
        aria-disabled={disabled}
      />
      {guide ? <div aria-hidden="true" className={`pointer-events-none absolute inset-0 grid place-items-center transition-opacity ${guideVisible ? "opacity-100" : "opacity-0"}`}>{guide}</div> : null}
    </div>
    {guide ? <p className="mt-2 text-xs leading-5 text-gray-500">회색 가이드는 화면에만 겹쳐 보이며 저장 그림에는 포함되지 않습니다. 3분 따라 그린 뒤 가이드를 숨기고 ‘모두 지우기’를 눌러 다시 그리세요.</p> : null}
  </section>;
});

export default DrawingPracticeCanvas;
