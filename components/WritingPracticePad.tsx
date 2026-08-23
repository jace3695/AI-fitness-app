"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

type WritingPracticePadProps = {
  title: string;
  targetText: string;
  reading?: string;
  meaning?: string;
  helperText?: string;
};

export default function WritingPracticePad({
  title,
  targetText,
  reading,
  meaning,
  helperText,
}: WritingPracticePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#0f172a";
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const getCtx = () => canvasRef.current?.getContext("2d");

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = getCtx();
    if (!ctx) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = getPoint(event);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = getPoint(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    ctx.clearRect(0, 0, width, height);
  };

  return (
    <div className="card" style={{ marginTop: "14px", borderColor: "#bfdbfe", background: "#f8fbff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <div style={{ fontWeight: 700, color: "#1e3a8a" }}>{title}</div>
        <button type="button" className="btn" onClick={handleClear} style={{ background: "#ffffff", borderColor: "#cbd5e1", color: "#334155" }}>
          지우기
        </button>
      </div>
      <div style={{ fontSize: "34px", fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{targetText}</div>
      {reading && <div style={{ marginTop: "6px", fontSize: "13px", color: "#64748b" }}>읽는 법: {reading}</div>}
      {meaning && <div style={{ marginTop: "2px", fontSize: "14px", color: "#334155" }}>뜻: {meaning}</div>}
      {helperText && <div style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>{helperText}</div>}

      <div style={{ position: "relative", marginTop: "12px", borderRadius: "12px", border: "1px solid #dbeafe", overflow: "hidden", background: "#ffffff", height: "250px" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "48px", fontWeight: 700, color: "rgba(96, 165, 250, 0.35)", letterSpacing: "1px", padding: "14px", textAlign: "center", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {targetText}
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none", position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}
          aria-label={`${title} 캔버스`}
        />
      </div>
    </div>
  );
}

