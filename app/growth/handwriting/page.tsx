"use client";

import Link from "next/link";
import { PointerEvent, useEffect, useRef, useState } from "react";
import AppIdentity from "../../components/AppIdentity";
import { supabase } from "../../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "../useGrowthData";

const GUIDE_TEXTS = ["오늘도 차분하게 한 걸음", "작은 습관이 큰 변화를 만든다", "정확하게 쓰고 천천히 돌아본다"];

export default function GrowthHandwritingPage() {
  const growth = useGrowthData(30);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [, setHistoryVersion] = useState(0);
  const [guideIndex, setGuideIndex] = useState(0);
  const [inkColor, setInkColor] = useState("#242231");
  const [saving, setSaving] = useState(false);
  const handwritingRoutine = growth.routines.find((routine) => routine.category === "handwriting") ?? null;

  const snapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(canvas.toDataURL("image/png"));
    historyRef.current = next.slice(-20);
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion((value) => value + 1);
  };

  const fillWhite = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.min(1200, Math.max(640, Math.round(canvas.getBoundingClientRect().width * 2)));
    canvas.width = width;
    canvas.height = Math.round(width * 0.62);
    fillWhite();
    snapshot();
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point(event);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    context.strokeStyle = inkColor;
    context.lineWidth = 3 + pressure * 6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPointRef.current = next;
  };

  const stopDrawing = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    snapshot();
  };

  const restore = (index: number) => {
    const canvas = canvasRef.current;
    const source = historyRef.current[index];
    if (!canvas || !source) return;
    const image = new Image();
    image.onload = () => { const context = canvas.getContext("2d"); context?.clearRect(0, 0, canvas.width, canvas.height); context?.drawImage(image, 0, 0); };
    image.src = source;
    historyIndexRef.current = index;
    setHistoryVersion((value) => value + 1);
  };

  const clear = () => { fillWhite(); snapshot(); growth.setNotice("연습장을 깨끗하게 비웠어요."); };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !supabase || !growth.user || !handwritingRoutine || saving) return;
    setSaving(true);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) { setSaving(false); return; }
    const date = getLocalDateKey();
    const path = `${growth.user.id}/${date}/handwriting-${crypto.randomUUID()}.png`;
    const upload = await supabase.storage.from("growth-resources").upload(path, blob, { contentType: "image/png", upsert: false });
    if (upload.error) { growth.setNotice("손글씨 이미지를 저장하지 못했어요."); setSaving(false); return; }
    const resource = await supabase.from("growth_resources").insert({ user_id: growth.user.id, routine_id: handwritingRoutine.id, title: `손글씨 연습 ${date}`, category: "handwriting", storage_path: path, mime_type: "image/png", size_bytes: blob.size, classification: "direct", notes: GUIDE_TEXTS[guideIndex] }).select("id").single();
    if (resource.error) { await supabase.storage.from("growth-resources").remove([path]); growth.setNotice("자료 정보를 저장하지 못해 업로드를 되돌렸어요."); setSaving(false); return; }
    const session = await growth.saveSession({ routineId: handwritingRoutine.id, sessionDate: date, status: "completed", plannedMinutes: handwritingRoutine.target_minutes, actualMinutes: handwritingRoutine.target_minutes, memo: GUIDE_TEXTS[guideIndex], source: "handwriting", metrics: { resourceId: resource.data.id, guideText: GUIDE_TEXTS[guideIndex] } });
    setSaving(false);
    growth.setNotice(session.error ? "이미지는 저장했지만 실행 기록을 남기지 못했어요." : "손글씨 이미지와 완료 기록을 비공개로 저장했어요.");
  };

  return <main className="min-h-dvh bg-[#F5F4FA] pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="손글씨 연습" subtitle="iPad와 Apple Pencil로 간단하게" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <section className="rounded-[30px] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-amber-600">따라 쓰기</p><h1 className="mt-1 text-2xl font-bold">{GUIDE_TEXTS[guideIndex]}</h1></div><button onClick={() => setGuideIndex((value) => (value + 1) % GUIDE_TEXTS.length)} className="min-h-11 rounded-xl bg-amber-50 px-4 text-xs font-bold text-amber-700">다른 문장</button></div>
        <div className="mt-4 flex flex-wrap gap-2"><label className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-100 px-3 text-xs font-bold">펜 색<input type="color" value={inkColor} onChange={(event) => setInkColor(event.target.value)} className="h-7 w-7" /></label><button onClick={() => restore(historyIndexRef.current - 1)} disabled={historyIndexRef.current <= 0} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">되돌리기</button><button onClick={() => restore(historyIndexRef.current + 1)} disabled={historyIndexRef.current >= historyRef.current.length - 1} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">다시 실행</button><button onClick={clear} className="min-h-11 rounded-xl bg-red-50 px-4 text-xs font-bold text-red-600">모두 지우기</button></div>
        <canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} className="mt-4 w-full rounded-2xl bg-white shadow-inner ring-1 ring-gray-200" style={{ touchAction: "none", aspectRatio: "1.62 / 1" }} aria-label="손글씨 연습장" />
        <button disabled={saving || !handwritingRoutine} onClick={() => void save()} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 text-sm font-bold text-white disabled:bg-gray-300">{saving ? "비공개 저장 중…" : "손글씨와 완료 기록 저장"}</button>
        {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{growth.notice}</p>}
        <p className="mt-3 text-xs leading-5 text-gray-500">그림 기능은 포함하지 않았습니다. 이 화면은 손글씨 교정용 한 장 연습장만 제공합니다.</p>
      </section>
    </div>
  </main>;
}
