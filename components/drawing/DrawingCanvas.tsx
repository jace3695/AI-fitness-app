"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Stroke } from "@/lib/drawing/model";
import type { ReactNode } from "react";
import PracticeOptions from "./PracticeOptions";

export function paintStrokes(canvas: HTMLCanvasElement, strokes: Stroke[], white = false) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(canvas.width / 400, canvas.height / 400);
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const first = stroke.points[0];
    if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1], b = stroke.points[i];
      ctx.lineWidth = stroke.width * (0.55 + b[2] * 0.9); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  ctx.restore();
  if (white) { ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalCompositeOperation = "source-over"; }
}

export function DrawingCanvas({ strokes, onChange, guide, reference, disabled, preview = false, palette, simple = false }: { strokes: Stroke[]; onChange?: (value: Stroke[]) => void; guide?: ReactNode; reference?: ReactNode; disabled?: boolean; preview?: boolean; palette?: string[]; simple?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [eraser, setEraser] = useState(false);
  const [penOnly, setPenOnly] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [color, setColor] = useState("#34314b");
  const [wide, setWide] = useState(false);
  const [limit, setLimit] = useState(false);
  useEffect(() => { if (ref.current) paintStrokes(ref.current, strokes); }, [strokes]);
  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(400, (event.clientX - rect.left) / rect.width * 400)), Math.max(0, Math.min(400, (event.clientY - rect.top) / rect.height * 400)), event.pressure || .5];
  };
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || preview || active.current || (penOnly && event.pointerType !== "pen")) return;
    if (strokes.length >= 1000 || strokes.reduce((n, s) => n + s.points.length, 0) >= 60_000) { setLimit(true); return; }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    active.current = { id: event.pointerId, stroke: { points: [point(event)], color, width: eraser ? 15 : wide ? 12 : 2.6, erase: eraser } };
    paintStrokes(event.currentTarget, [...strokes, active.current.stroke]);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || active.current.id !== event.pointerId) return;
    if (active.current.stroke.points.length < 6000) active.current.stroke.points.push(point(event));
    paintStrokes(event.currentTarget, [...strokes, active.current.stroke]);
  };
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || active.current.id !== event.pointerId) return;
    onChange?.([...strokes, active.current.stroke]); active.current = null; setRedo([]);
  };
  return <div>
    {!preview && <div className="mb-3 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !strokes.length} onClick={() => { setRedo([...redo, strokes[strokes.length - 1]]); onChange?.(strokes.slice(0, -1)); }} className="drawing-button">되돌리기</button>
      <button type="button" disabled={disabled} aria-pressed={eraser} onClick={() => setEraser(!eraser)} className="drawing-button">{eraser ? "지우개 사용 중" : "연필 사용 중"}</button>
      <button type="button" disabled={disabled} aria-pressed={zoom} onClick={() => setZoom(!zoom)} className="drawing-button">{zoom ? "원래 크기" : "확대"}</button>
      {palette && <>{palette.map((c,i)=><button key={c} type="button" className="drawing-button" aria-pressed={color===c} disabled={disabled} onClick={()=>setColor(c)}>{i===0?'주색 연필':'보조색 연필'}</button>)}<button type="button" className="drawing-button" aria-pressed={wide} disabled={disabled} onClick={()=>setWide(!wide)}>넓게 칠하기</button></>}
      <PracticeOptions simple={simple} title="색 · 다시 실행 · 펜 설정"><div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !redo.length} onClick={() => { onChange?.([...strokes, redo[redo.length - 1]]); setRedo(redo.slice(0, -1)); }} className="drawing-button">다시 실행</button>
      <label className="drawing-button flex items-center gap-2">선 색<input aria-label="선 색" type="color" value={color} onChange={e => setColor(e.target.value)} className="h-6 w-8" /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={penOnly} onChange={e => setPenOnly(e.target.checked)} />Pencil만 사용</label></div></PracticeOptions>
    </div>}
    <div className={reference ? "grid grid-cols-1 items-start gap-4 md:grid-cols-2" : ""}>
    {reference && <div className="min-w-0">{reference}</div>}
    <div className="min-w-0 overflow-auto rounded-3xl border border-violet-100 bg-white">
      <div className="relative aspect-square" style={{ width: zoom ? "160%" : "100%" }}>
        <div className="pointer-events-none absolute inset-0">{guide}</div>
        <canvas ref={ref} width={800} height={800} aria-label={preview ? "저장한 그림 미리보기" : "내 그림 연습장"} className={`relative h-full w-full ${preview ? "" : "touch-none"}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
      </div>
    </div>
    </div>
    {limit && <p role="alert">이 그림의 선이 많아졌어요. 먼저 저장하거나 내보낸 뒤 새 시도로 이어가 주세요.</p>}
    {!preview && <p className="mt-2 text-xs text-slate-500">손가락·마우스로 그려요. 잘못 그리면 ‘되돌리기’를 누르세요. 화면을 내릴 때는 그림 바깥을 쓸어 주세요.</p>}
  </div>;
}
