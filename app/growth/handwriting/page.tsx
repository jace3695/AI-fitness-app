"use client";

import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import { PointerEvent, useEffect, useRef, useState } from "react";
import AppIdentity from "../../components/AppIdentity";
import { supabase } from "../../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "../useGrowthData";
import { emptyHandwritingEvidence, handwritingPoint, handwritingMetrics, type HandwritingEvidence } from "../../data/practiceEvidence";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";

const GUIDE_TEXTS = ["오늘도 차분하게 한 걸음", "작은 습관이 큰 변화를 만든다", "정확하게 쓰고 천천히 돌아본다"];

export default function GrowthHandwritingPage() {
  const growth = useGrowthData(30);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef<{image:string;evidence:HandwritingEvidence}[]>([]);
  const evidenceRef = useRef(emptyHandwritingEvidence());
  const strokeStartRef = useRef<number | null>(null);
  const strokeMovedRef = useRef(false);
  const historyIndexRef = useRef(-1);
  const [, setHistoryVersion] = useState(0);
  const [guideIndex, setGuideIndex] = useState(0);
  const [inkColor, setInkColor] = useState("#242231");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [locked, setLocked] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const pending = useRef<{owner:string;id:string;resourceId:string;path:string;uploaded:boolean;resourceSaved:boolean;blob:Blob;session:Parameters<typeof growth.saveSession>[0]} | null>(null);
  const handwritingRoutine = growth.routines.find((routine) => routine.category === "handwriting") ?? null;
  const metrics = handwritingMetrics(evidenceRef.current);
  useUnsavedChanges(metrics.strokes > 0 && !saved);

  const snapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push({image:canvas.toDataURL("image/png"),evidence:{...evidenceRef.current}});
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
    if (locked || restoring || drawingRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point(event);
    strokeStartRef.current = performance.now(); strokeMovedRef.current = false;
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
    const canvas=event.currentTarget;
    if (!strokeMovedRef.current) evidenceRef.current=handwritingPoint(evidenceRef.current,lastPointRef.current.x/canvas.width,lastPointRef.current.y/canvas.height,event.pressure,event.pointerType);
    evidenceRef.current=handwritingPoint(evidenceRef.current,next.x/canvas.width,next.y/canvas.height,event.pressure,event.pointerType);
    strokeMovedRef.current=true;
    lastPointRef.current = next;
  };

  const stopDrawing = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (!strokeMovedRef.current) return;
    evidenceRef.current={...evidenceRef.current,strokes:evidenceRef.current.strokes+1,activeMs:evidenceRef.current.activeMs+Math.max(0,performance.now()-(strokeStartRef.current??performance.now()))};
    snapshot();
  };

  const restore = (index: number) => {
    const canvas = canvasRef.current;
    const source = historyRef.current[index];
    if (!canvas || !source || locked || restoring) return;
    setRestoring(true);
    const image = new Image();
    image.onload = () => { const context = canvas.getContext("2d"); context?.clearRect(0, 0, canvas.width, canvas.height); context?.drawImage(image, 0, 0); evidenceRef.current={...source.evidence}; historyIndexRef.current=index; setRestoring(false);setHistoryVersion(value=>value+1); };
    image.onerror=()=>{setRestoring(false);growth.setNotice('연습장을 복원하지 못했어요. 다시 시도해 주세요.');};
    image.src = source.image;
  };

  const clear = () => { if(saving||restoring||(locked&&!saved))return; fillWhite();evidenceRef.current=emptyHandwritingEvidence();setSaved(false);setLocked(false);pending.current=null; snapshot(); growth.setNotice("연습장을 깨끗하게 비웠어요."); };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !supabase || !growth.user || !handwritingRoutine || saving || saved || restoring || !evidenceRef.current.strokes) return;
    setSaving(true);
    setLocked(true);
    try {
      if(!pending.current){
        const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png',.92));if(!blob)throw Error('image');
        const date=getLocalDateKey(),id=crypto.randomUUID(),resourceId=crypto.randomUUID(),measured=handwritingMetrics(evidenceRef.current);
        pending.current={owner:growth.user.id,id,resourceId,path:`${growth.user.id}/${date}/handwriting-${resourceId}.png`,uploaded:false,resourceSaved:false,blob,session:{id,routineId:handwritingRoutine.id,sessionDate:date,status:'completed',plannedMinutes:handwritingRoutine.target_minutes,actualMinutes:Math.round(measured.activeSeconds/60),memo:GUIDE_TEXTS[guideIndex],source:'handwriting',metrics:{resourceId,guideText:GUIDE_TEXTS[guideIndex],...measured}}};
      }
      const job=pending.current;if(job.owner!==growth.user.id)throw Error('owner');
      if(!job.uploaded){
        const upload=await supabase.storage.from('growth-resources').upload(job.path,job.blob,{contentType:'image/png',upsert:false});
        if(upload.error){const existing=await supabase.storage.from('growth-resources').download(job.path);if(existing.error||existing.data.size!==job.blob.size)throw Error('upload');}
        job.uploaded=true;
      }
      if(!job.resourceSaved){
        const resource=await supabase.from('growth_resources').insert({id:job.resourceId,user_id:job.owner,routine_id:job.session.routineId,title:`손글씨 연습 ${job.session.sessionDate}`,category:'handwriting',storage_path:job.path,mime_type:'image/png',size_bytes:job.blob.size,classification:'direct',notes:job.session.memo});
        if(resource.error){const existing=await supabase.from('growth_resources').select('id').eq('id',job.resourceId).eq('user_id',job.owner).eq('storage_path',job.path).maybeSingle();if(existing.error||!existing.data)throw Error('resource');}
        job.resourceSaved=true;
      }
      const session=await growth.saveSession(job.session);if(session.error)throw Error('session');
      setSaved(true);growth.setNotice('손글씨 이미지와 실제 측정 기록을 비공개로 저장했어요.');
    }catch{growth.setNotice('저장 결과를 확인하지 못했어요. 같은 기록 다시 확인으로 이미지·실행 기록을 재확인해 주세요.');}
    finally{setSaving(false);}
  };

  return <main className="min-h-dvh bg-yeoni-bg pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="손글씨 연습" subtitle="iPad와 Apple Pencil로 간단하게" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <AppCompanion compact quiet>한 글자씩 천천히 써봐요. 끝나면 오늘의 손글씨를 남겨 주세요.</AppCompanion>
      <section className="rounded-[30px] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-amber-600">따라 쓰기</p><h1 className="mt-1 text-2xl font-bold">{GUIDE_TEXTS[guideIndex]}</h1></div><button disabled={locked || restoring} onClick={() => setGuideIndex((value) => (value + 1) % GUIDE_TEXTS.length)} className="min-h-11 rounded-xl bg-amber-50 px-4 text-xs font-bold text-amber-700">다른 문장</button></div>
        <div className="mt-4 flex flex-wrap gap-2"><label className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-100 px-3 text-xs font-bold">펜 색<input type="color" value={inkColor} onChange={(event) => setInkColor(event.target.value)} className="h-7 w-7" /></label><button onClick={() => restore(historyIndexRef.current - 1)} disabled={locked || restoring || historyIndexRef.current <= 0} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">되돌리기</button><button onClick={() => restore(historyIndexRef.current + 1)} disabled={locked || restoring || historyIndexRef.current >= historyRef.current.length - 1} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">다시 실행</button><button disabled={saving || restoring || (locked && !saved)} onClick={clear} className="min-h-11 rounded-xl bg-red-50 px-4 text-xs font-bold text-red-600">모두 지우기</button></div>
        <canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} className="mt-4 w-full rounded-2xl bg-white shadow-inner ring-1 ring-gray-200" style={{ touchAction: "none", aspectRatio: "1.62 / 1" }} aria-label="손글씨 연습장" />
        <button disabled={saving || saved || restoring || !metrics.strokes || !handwritingRoutine} onClick={() => void save()} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 text-sm font-bold text-white disabled:bg-gray-300">{saved ? "저장 완료" : saving ? "비공개 저장 중…" : locked ? "같은 기록 다시 확인" : "손글씨와 완료 기록 저장"}</button>
        <section aria-label="손글씨 측정 기록" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <h2 className="font-bold">직접 측정한 연습 기록</h2><p className="mt-2">획 {metrics.strokes}개 · 그린 시간 {metrics.activeSeconds}초</p>
          <p>사용한 범위: 가로 {metrics.occupiedWidth}% · 세로 {metrics.occupiedHeight}%</p>
          <p>{metrics.pressureRange ? `펜 압력 범위 ${metrics.pressureRange[0].toFixed(2)} ~ ${metrics.pressureRange[1].toFixed(2)}` : '변화가 있는 펜 압력 미측정'}</p>
          <p className="mt-2 text-xs text-gray-600">화면에 남은 획의 접촉 시간만 합칩니다. 되돌린 획은 제외하며, 글씨 품질이나 교정 점수를 판정하지 않습니다. 목표 시간은 실제 시간으로 기록하지 않습니다.</p>
        </section>
        {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{growth.notice}</p>}
        <p className="mt-3 text-xs leading-5 text-gray-500">그림 기능은 포함하지 않았습니다. 이 화면은 손글씨 교정용 한 장 연습장만 제공합니다.</p>
      </section>
    </div>
  </main>;
}
