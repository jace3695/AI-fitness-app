"use client";
import IdentityPractice from "@/components/drawing/IdentityPractice";
import { identityEligible } from "@/lib/drawing/identity";
import GesturePractice from "@/components/drawing/GesturePractice";
import { gestureEligible } from "@/lib/drawing/gesture";
import StructurePractice from "@/components/drawing/StructurePractice";
import { structureEligible } from "@/lib/drawing/structure";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import AppIdentity from "@/app/components/AppIdentity";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { DrawingCanvas, paintStrokes } from "@/components/drawing/DrawingCanvas";
import TemplateReferences from "@/components/drawing/TemplateReferences";
import PartFinder from "@/components/drawing/PartFinder";
import MemoryPractice from "@/components/drawing/MemoryPractice";
import { memoryStep, memoryState, memoryVisible } from "@/lib/drawing/memory";
import VariationPractice from "@/components/drawing/VariationPractice";
import { variationEligible } from "@/lib/drawing/variation";
import CopyPractice from "@/components/drawing/CopyPractice";
import { Diagram } from "@/components/drawing/Diagram";
import { bundledPack, loadDrawingPack } from "@/lib/drawing/pack";
import { newDocument, playable, type Attempt, type Check, type DrawingDocument, type Help, type Lesson } from "@/lib/drawing/model";
import { feedback, HELP_LABELS, recommend, confirmedStage } from "@/lib/drawing/recommend";
import { compressPhoto, download, exportAttempt, exportExample } from "@/lib/drawing/export";
import { useDrawingRecords } from "./useDrawingRecords";
import "./drawing.css";

export default function DrawingPage() {
  const records = useDrawingRecords();
  const { checkpoint, owner } = records;
  const [pack, setPack] = useState(bundledPack);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [original, setOriginal] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const [referenceOverlay, setReferenceOverlay] = useState(false);
  const [easy, setEasy] = useState(false);
  const [compare, setCompare] = useState<string>("");
  const [album, setAlbum] = useState(false);
  const [localStatus, setLocalStatus] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [filter, setFilter] = useState(0);
  const [review, setReview] = useState(false);
  const checkpointGeneration = useRef(0);
  const latestOwner = useRef(records.owner); latestOwner.current = records.owner;
  useUnsavedChanges(dirty);
  useEffect(() => {
    let active = true;
    void loadDrawingPack(process.env.NEXT_PUBLIC_DRAWING_PACK_URL).then(result => { if (active) { setPack(result.pack); if (result.notice) records.setNotice(result.notice); } });
    return () => { active = false; };
    // setNotice is stable; pack updates never replace the current attempt's snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!attempt || !dirty || attempt.user_id !== owner) return;
    const ticket = ++checkpointGeneration.current;
    const timer = setTimeout(() => {
      void checkpoint({ attempt, baseRevision: attempt.revision, pending: true })
        .then(() => { if (ticket === checkpointGeneration.current) setLocalStatus("이 기기에 임시 보관 중 · 클라우드 저장 전"); })
        .catch(() => { if (ticket === checkpointGeneration.current) setLocalStatus("임시 저장 공간을 쓰지 못했어요. 화면을 닫기 전에 내보내기 또는 저장해 주세요."); });
    }, 250);
    return () => clearTimeout(timer);
  }, [attempt, dirty, owner, checkpoint]);

  const owned = attempt?.user_id === records.owner ? attempt : null;
  const doc = owned?.document;
  const next = recommend(pack, records.records);
  const prepared = pack.lessons.filter(playable);
  const doneIds = new Set(records.records.filter(a => a.status === "completed").map(a => a.document.lesson.id));
  function update(patch: Partial<DrawingDocument>) {
    if (!owned || records.busy) return;
    setAttempt({ ...owned, status: "draft", document: { ...owned.document, ...patch } }); setDirty(true); setReview(false);
  }
  async function preserve() {
    if (!owned || !dirty) return true;
    try { await records.checkpoint({ attempt: owned, baseRevision: owned.revision, pending: true }); return true; }
    catch { records.setNotice("임시 저장에 실패해 새 그림으로 이동하지 않았어요. 현재 그림을 먼저 내보내 주세요."); return false; }
  }
  async function start(lesson: Lesson, exampleId?: string, help?: Help, short = false) {
    if (!records.owner || !playable(lesson) || records.busy) return;
    if (!await preserve()) return;
    const example = lesson.examples.find(e => e.id === exampleId) ?? lesson.examples[0];
    const document = newDocument(lesson, example, pack.version); document.help = help ?? document.help; document.usedHelp = document.help; document.short = short;
    const now = new Date().toISOString();
    setAttempt({ id: crypto.randomUUID(), user_id: records.owner, revision: 0, status: "draft", document, created_at: now, updated_at: now });
    setDirty(true); setReview(false); setEasy(short); setOriginal(lesson.stage !== 4); setOverlay(true); setReferenceOverlay(false); setAlbum(false); setCompare("");
  }
  async function open(record: Attempt) {
    if (!await preserve()) return;
    setAttempt(record); setEasy(record.document.short); setReferenceOverlay(false); setDirty(false); setReview(false); setOriginal(record.document.lesson.stage !== 4); setAlbum(false); setCompare("");
  }
  async function save(completed: boolean) {
    if (!owned || photoBusy) return;
    const saved = await records.save({ ...owned, status: completed ? "completed" : "draft" });
    if (saved && saved.user_id === latestOwner.current) { checkpointGeneration.current++; setAttempt(saved); setDirty(false); setLocalStatus("클라우드 저장 확인 완료"); setReview(completed); }
  }
  const previous = records.records.find(a => a.id === compare);
  const step = doc?.lesson.steps[doc.step];
  const related = records.records.filter(a => a.id !== owned?.id && (!doc?.lesson.references.length || doc.lesson.references.includes(a.document.lesson.id)));

  return <main className="drawing-page min-h-screen bg-[#f6f4fb] pb-40 text-slate-800">
    <header className="border-b border-violet-100 bg-white px-4 py-4"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><AppIdentity kind="growth" title="그림 연습" /><Link href="/growth" className="drawing-button">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <section className="drawing-card">
        <p className="text-sm font-semibold text-violet-700">자기계발 · 하루 10~20분</p><h1 className="mt-2 text-2xl font-bold">그림 연습</h1>
        <p className="mt-2 text-sm text-slate-600">어디서 시작할지 몰라도 괜찮아요. 캐릭터 한 부분씩 함께 그려요.</p>
        {!owned && <div className="mt-5 rounded-2xl bg-violet-50 p-4"><p className="text-sm">오늘의 추천</p><h2 className="mt-1 text-lg font-bold">{next ? pack.lessons.find(l => l.id === next.lessonId)?.title : "시각 예제를 준비하고 있어요"}</h2><p className="my-3 text-sm">{next?.reason}</p>
          {records.recovery.map(draft => <button key={draft.attempt.id} className="drawing-primary mb-2 mr-2" onClick={() => { setAttempt(draft.attempt); setDirty(draft.pending); setOriginal(draft.attempt.document.lesson.stage !== 4); }}>{draft.attempt.document.lesson.id} · 이 기기의 그림 복구하기</button>)}
          <button className="drawing-primary" disabled={!records.ready || !records.owner || !next} onClick={() => { const draft = records.records.find(a => a.status === "draft"); if (draft) void open(draft); else if (next) void start(pack.lessons.find(l => l.id === next.lessonId)!, next.exampleId, next.help, next.short); }}>이어서 연습하기</button>
        </div>}
        <div className="mt-4 flex flex-wrap gap-2"><button className="drawing-button" onClick={() => setAlbum(!album)}>내 그림 {records.records.length}장</button><a className="drawing-button" href="#drawing-map">학습 지도</a><span className="self-center text-xs text-slate-500">시도 완료 {doneIds.size}개 · 실력 점수가 아니에요</span></div>
      </section>
      {records.notice && <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">{records.notice}</p>}
      {album && <section className="drawing-card" aria-label="내 그림 앨범"><h2 className="text-lg font-bold">내 그림</h2><label className="my-3 block text-sm">단계 필터 <select className="drawing-input" value={filter} onChange={e => setFilter(Number(e.target.value))}><option value={0}>모든 단계</option>{pack.stages.map(s => <option key={s.id} value={s.id}>{s.id}. {s.title}</option>)}</select></label>
        {records.recovery.filter(d => d.attempt.id !== owned?.id).map(draft => <button key={draft.attempt.id} className="drawing-button mb-3 mr-2" onClick={async () => { if (await preserve()) { setAttempt(draft.attempt); setDirty(true); setAlbum(false); } }}>{draft.attempt.document.lesson.id} · 미전송 그림 복구</button>)}{!records.records.length && <p>저장한 그림이 여기에 모여요.</p>}<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{records.records.filter(a => !filter || a.document.lesson.stage === filter).map(a => <article key={a.id} className="min-w-0 rounded-2xl border p-3"><DrawingCanvas key={a.id + a.revision} strokes={a.document.strokes.length ? a.document.strokes : a.document.structure?.analysis ?? a.document.gesture?.trace ?? []} preview />{a.document.photo && <Image src={a.document.photo} alt="종이 그림" width={200} height={200} unoptimized className="h-auto w-full" />}<h3 className="mt-2 text-sm font-bold">{a.document.lesson.id} {a.document.lesson.title}</h3><p className="my-2 text-xs">{new Date(a.updated_at).toLocaleDateString("ko-KR")} · {a.status === "draft" ? "진행 중" : "시도 완료"}</p><button className="drawing-button" onClick={() => void open(a)}>열고 이어 그리기</button><button className="drawing-button mt-2" disabled={records.busy} onClick={async () => { if (window.confirm("이 그림과 자기확인만 삭제할까요? 다른 기록은 유지돼요.") && await records.remove(a)) { if (a.id === owned?.id) { setAttempt(null); setDirty(false); } } }}>삭제</button></article>)}</div>
      </section>}
      {owned && doc && <>
        <section className="drawing-card" aria-label="현재 과제"><p className="text-sm font-semibold text-violet-700">{doc.lesson.stage}단계 · {doc.lesson.id}</p><h2 className="mt-1 text-xl font-bold">{doc.lesson.title}</h2><p className="mt-2">오늘 하나만: {doc.lesson.goal}</p>
          <fieldset disabled={records.busy || photoBusy} className="mt-4 flex flex-wrap gap-3"><label className="text-sm">그리는 곳<select className="drawing-input" value={doc.tool} onChange={e => update({ tool: e.target.value as DrawingDocument["tool"] })}><option value="app">앱 안에서</option><option value="paper">종이·연필</option><option value="external">다른 그림 앱</option></select></label><label className="text-sm">연습 시간<select className="drawing-input" value={doc.short ? 5 : doc.minutes} onChange={e => update({ minutes: Number(e.target.value), short: Number(e.target.value) === 5 })}><option value={5}>5분 · 일부만 시도</option><option value={10}>10분</option><option value={20}>20분</option></select></label></fieldset>
          {["D42", "D52", "D60"].includes(doc.lesson.id) && <label className="mt-4 block text-sm">{doc.lesson.id === "D60" ? "연습할 자세 선택" : "익숙한 캐릭터 선택"}<select aria-label={doc.lesson.id === "D60" ? "연습할 자세 선택" : "익숙한 캐릭터 선택"} className="drawing-input mt-1 w-full" disabled={records.busy} value={doc.example.id} onChange={e => { void start(doc.lesson, e.target.value); }}>{doc.lesson.examples.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select></label>}
          <div className="mt-4 flex flex-wrap gap-2"><button className="drawing-button" aria-pressed={easy} onClick={() => { setEasy(!easy); if (!easy) update({ short: true }); }}>더 쉽게 · 일부만</button><button className="drawing-button" onClick={() => { const lesson = pack.lessons.find(l => l.id === doc.lesson.id) ?? doc.lesson; void start(lesson, lesson.examples[(lesson.examples.findIndex(e => e.id === doc.example.id) + 1) % lesson.examples.length]?.id, doc.help); }}>같은 목표의 다른 그림</button><button className="drawing-button" onClick={() => void save(false)} disabled={records.busy}>잠깐 쉬기 · 저장</button></div>
          {(easy || doc.short) && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">쉬운 과제: {doc.lesson.easier} 일부만 한 시도로 기록하고 전체 목표 확인과 구분해요.</p>}
        </section>
        <section className="drawing-card" aria-label="한 동작씩 보기">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-violet-700">{doc.step + 1} / {doc.lesson.steps.length} · 지금 할 행동</p><h3 className="mt-2 text-lg font-bold">{step?.text}</h3></div></div>
          <div className="my-4 flex flex-wrap gap-2"><button className="drawing-button" disabled={doc.step === 0} onClick={() => update(doc.lesson.memoryPractice ? memoryStep(doc, doc.step - 1) : { step: doc.step - 1 })}>이전 행동</button><button className="drawing-primary" disabled={doc.step >= doc.lesson.steps.length - 1 || (!!doc.lesson.memoryPractice && doc.step === (doc.lesson.id === "D33" ? 1 : 0) && memoryState(doc).selected.length < 2)} onClick={() => update(doc.lesson.memoryPractice ? memoryStep(doc, doc.step + 1) : { step: doc.step + 1 })}>다음 행동</button>{!doc.lesson.memoryPractice && <button className="drawing-button" aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? "원본 숨기기" : "원본 다시 보기"}</button>}</div>
          {doc.lesson.identityPractice ? <IdentityPractice key={owned.id} attempt={owned} records={records.records} original={original} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : doc.lesson.gesturePractice ? <GesturePractice key={owned.id} attempt={owned} original={original} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : doc.lesson.structurePractice ? <StructurePractice key={owned.id} attempt={owned} records={records.records} original={original} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : doc.lesson.variationPractice ? <VariationPractice key={owned.id} attempt={owned} original={original} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : doc.lesson.memoryPractice ? <MemoryPractice key={owned.id} attempt={owned} records={records.records} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : doc.lesson.practice?.mode === "copy" ? <CopyPractice key={owned.id} attempt={owned} records={records.records} original={original} easy={easy || doc.short} disabled={records.busy} onChange={update} /> : <>
          {original && <details className="mb-4 rounded-2xl bg-slate-50 p-3" open={doc.tool !== "app" || doc.help === 0}><summary className="cursor-pointer text-sm font-semibold">완성 예제 · {doc.example.name}</summary><div className="mx-auto max-w-xs"><Diagram example={doc.example} original /></div><button className="drawing-button" onClick={() => exportExample(doc.example)}>예제 저장 · 인쇄용</button></details>}
          {doc.example.lines.some(l => l.group === "guide") && <div className="mb-3"><button className="drawing-button" disabled={!original} aria-pressed={referenceOverlay && original} onClick={() => setReferenceOverlay(!referenceOverlay)}>{referenceOverlay && original ? "완성 외곽 겹치기 끄기" : "완성 외곽 겹치기"}</button><button className="drawing-button ml-2" onClick={() => exportExample(doc.example, doc.lesson.steps.filter(s => s.action === "draw").flatMap(s => s.lines))}>도형 밑그림 내려받기</button><p className="mt-2 text-xs">회색 외곽과 도형의 자리를 비교해요. 겹친 도형은 지우지 않아도 돼요. 원본을 숨기면 겹쳐보기도 숨겨져요.</p></div>}
          <p className="mb-3 text-xs text-slate-600">주황 점은 시작 위치의 예시예요. 이번 행동의 설명을 따라가요. 주황 화살표는 손이 움직일 방향, 보라 선은 이번에 그릴 부분이에요.</p>
          {doc.tool === "app" ? <>
            <label className="mb-3 block text-sm">도움 정도<select className="drawing-input" value={doc.help} onChange={e => { const help = Number(e.target.value) as Help; update({ help, usedHelp: Math.max(help, doc.usedHelp) as Help }); }}>{HELP_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label>
            <button className="drawing-button mb-3" aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>{overlay ? "밑그림 숨기기" : "밑그림 다시 보기"}</button>
            <DrawingCanvas key={owned.id} strokes={doc.strokes} onChange={strokes => update({ strokes })} disabled={records.busy} guide={overlay && <Diagram example={doc.example} lesson={doc.lesson} step={doc.step} help={doc.help} referenceOverlay={referenceOverlay && original} easy={easy || doc.short} />} />
          </> : <><div className="mx-auto max-w-sm"><Diagram example={doc.example} lesson={doc.lesson} step={doc.step} referenceOverlay={referenceOverlay && original} easy={easy || doc.short} /></div><p className="my-3 text-sm">{doc.tool === "paper" ? "손바닥보다 조금 크게 예제를 인쇄하고 비치는 종이를 얹어요. 종이 모서리를 고정해요. 인쇄가 어렵다면 앱 안에서 그리기를 선택해요. 사진 없이 자기확인만 저장해도 돼요." : "예제를 저장해 그림 앱으로 불러와요. 원본 위에 새 레이어(투명한 종이)를 올려 그려요. 앱마다 버튼 이름이 달라요. 완성한 이미지를 아래에 가져올 수 있어요."}</p><button className="drawing-button" onClick={() => exportExample(doc.example)}>예제 내려받기</button></>}
          {original && <PartFinder key={owned.id} example={doc.example} checked={doc.partChecks ?? []} disabled={records.busy} onCheck={partChecks => update({partChecks})} onHelp={() => update({usedHelp: Math.max(1, doc.usedHelp) as Help})} />}
          </>}
          <label className="mt-5 block text-sm font-semibold">종이 그림 사진 · 다른 앱 그림 가져오기<input type="file" accept="image/jpeg,image/png,image/webp" disabled={records.busy || photoBusy} className="mt-2 block max-w-full text-sm" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; const owner = records.owner; setPhotoBusy(true); try { const photo = await compressPhoto(file); if (latestOwner.current === owner) update({ photo }); } catch (error) { records.setNotice(error instanceof Error ? error.message : "사진을 열지 못했어요."); } finally { setPhotoBusy(false); } }} /></label>
          {doc.photo && <><Image src={doc.photo} width={600} height={600} alt="내가 남긴 그림 사진" unoptimized className="mt-3 h-auto max-h-96 w-auto max-w-full rounded-2xl" /><button className="drawing-button mt-2" onClick={() => update({ photo: null })}>사진 빼기</button></>}
        </section>
        {!doc.lesson.identityPractice && !doc.lesson.memoryPractice && doc.lesson.id !== "D27" && doc.lesson.references.length > 0 && <section className="drawing-card"><h3 className="font-bold">이전 그림과 연결하기</h3><p className="my-2 text-sm">{doc.lesson.references.join(" · ")}의 기존 그림을 선택해요. 새로 그릴 때도 원본은 보존해요.</p>{!related.length && <p className="text-sm">연결할 그림이 아직 없어요. 앞 수업에서 저장한 뒤 돌아올 수 있어요.</p>}<div className="space-y-2">{related.map(a => <label key={a.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={doc.references.includes(a.id)} onChange={e => update({ references: e.target.checked ? [...doc.references, a.id] : doc.references.filter(id => id !== a.id) })} />{a.document.lesson.id} · {a.document.lesson.title} · {new Date(a.updated_at).toLocaleDateString("ko-KR")}<button className="drawing-button" onClick={() => setCompare(a.id)}>비교</button></label>)}</div>{doc.lesson.id === "D76" && <button className="drawing-button mt-3" onClick={() => { const base = related.find(a => doc.references.includes(a.id)); if (base) update({ strokes: structuredClone(base.document.strokes), photo: base.document.photo }); else records.setNotice("색을 넣을 원본 그림을 먼저 선택해 주세요."); }}>선택한 선화의 복사본 가져오기</button>}</section>}
        {doc.lesson.stage === 9 && <section className="drawing-card"><h3 className="font-bold">내 캐릭터 소개</h3>{([["name", "이름"], ["role", "역할 · 누구를 위한 친구인가요?"], ["personality", "성격 한 단어"], ["features", "다음에도 유지할 특징 1~2개"], ["improvement", "다음에 바꿔볼 것 하나"]] as const).map(([key, label]) => <label key={key} className="mt-3 block text-sm">{label}<input maxLength={300} className="drawing-input w-full" value={doc.character[key]} onChange={e => update({ character: { ...doc.character, [key]: e.target.value } })} /></label>)}</section>}
        {(!doc.lesson.memoryPractice || memoryVisible(doc)) && <section className="drawing-card"><h3 className="font-bold">이전 그림과 나란히 보기</h3><select aria-label="비교할 그림" className="drawing-input mt-3 w-full" value={compare} onChange={e => setCompare(e.target.value)}><option value="">그림 선택</option>{records.records.filter(a => a.id !== owned.id).map(a => <option key={a.id} value={a.id}>{a.document.lesson.title} · {new Date(a.updated_at).toLocaleDateString("ko-KR")}</option>)}</select>{previous && <div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-sm">이전 그림</p><DrawingCanvas key={previous.id} strokes={previous.document.strokes} preview />{previous.document.photo && <Image src={previous.document.photo} width={300} height={300} alt="이전 그림 사진" unoptimized className="h-auto w-full" />}</div><div><p className="text-sm">지금 그림</p><DrawingCanvas key={owned.id + "-preview"} strokes={doc.strokes} preview />{doc.photo && <Image src={doc.photo} width={300} height={300} alt="현재 그림 사진" unoptimized className="h-auto w-full" />}</div></div>}</section>}
        <section className="drawing-card" aria-label="오늘의 자기확인"><h3 className="text-lg font-bold">짧게 돌아보기</h3><p className="mt-3">{doc.lesson.check}</p><fieldset disabled={records.busy} className="mt-3 flex flex-wrap gap-2">{([["independent", "스스로 해봤어요"], ["assisted", "도움을 받았어요"], ["difficult", "아직 어려워요"], ["unconfirmed", "아직 확인 전"]] as [Check, string][]).map(([value, label]) => <button className={doc.check === value ? "drawing-primary" : "drawing-button"} key={value} disabled={value === "independent" && (!!doc.memory?.copyMode || !variationEligible(doc) || !structureEligible(doc) || !gestureEligible(doc) || !identityEligible(doc))} aria-pressed={doc.check === value} onClick={() => update({ check: value })}>{label}</button>)}</fieldset>
          <label className="mt-4 block text-sm">어디가 어려웠나요? (선택)<select className="drawing-input w-full" value={doc.difficulty} onChange={e => update({ difficulty: e.target.value })}><option value="">특별히 고르지 않음</option>{["시작점", "긴 선", "작은 부분 위치", "기억", "포즈", "지루함"].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="mt-4 block text-sm">남기고 싶은 말<input className="drawing-input w-full" value={doc.memo} maxLength={1000} onChange={e => update({ memo: e.target.value })} /></label>
          <p className="my-3 text-xs text-slate-500">자기확인은 그림을 AI가 채점한 결과가 아니에요. 그림 분석 없이 다음 과제를 추천해요.</p>
          <div className="flex flex-wrap gap-2"><button className="drawing-primary" disabled={records.busy || photoBusy} onClick={() => void save(true)}>{records.busy ? "저장 확인 중…" : "시도 마치고 저장"}</button><button className="drawing-button" disabled={records.busy || photoBusy} onClick={() => void save(false)}>진행 중 저장</button><button className="drawing-button" onClick={() => exportAttempt(owned)}>편집 가능한 기록 내보내기</button><button className="drawing-button" onClick={() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1200;
            if (doc.lesson.structurePractice === 'assemble' || doc.lesson.gesturePractice) {
              canvas.width = 2400; const ctx = canvas.getContext('2d');
              [doc.structure?.analysis ?? doc.gesture?.trace ?? [], doc.strokes].forEach((strokes, i) => { const side = document.createElement('canvas'); side.width = side.height = 1200; paintStrokes(side, strokes, true); ctx?.drawImage(side, i * 1200, 0); });
            } else paintStrokes(canvas, doc.strokes, true); canvas.toBlob(blob => { if (blob) download(blob, `${doc.lesson.id}-my-drawing.png`); }, "image/png"); }}>내 그림 PNG</button></div>
          <p role="status" className="mt-3 text-sm">{localStatus}</p>
        </section>
        {review && <section className="drawing-card" aria-label="연이의 연습 정리"><h3 className="text-lg font-bold">오늘 연습 정리</h3><dl className="mt-3 space-y-4">{feedback(owned, pack, records.records).map(item => <div key={item.title}><dt className="font-semibold">{item.title}</dt><dd className="mt-1 text-sm text-slate-600">{item.body}</dd></div>)}</dl>{next && <button className="drawing-primary mt-5" onClick={() => void start(pack.lessons.find(l => l.id === next.lessonId)!, next.exampleId, next.help, next.short)}>추천 과제 시작</button>}</section>}
      </>}
      {(!doc?.lesson.memoryPractice || memoryVisible(doc)) && <TemplateReferences owner={records.owner} lessonId={doc?.lesson.id ?? "D01"} />}
      <section className="drawing-card"><h2 className="text-lg font-bold">좋아하는 캐릭터도 참고해요</h2><p className="my-2 text-sm text-slate-600">개인 연습용 선택 참고 자료예요. 아래 링크를 추가한 것을 단계별 수업 완성으로 세지는 않아요.</p><ul className="space-y-3 text-sm"><li><a href="https://www.pokemon.com/us/pokedex/ditto" target="_blank" rel="noreferrer" className="font-bold underline">메타몽 원본 보기</a> — 큰 바깥 모양을 먼저 보고, 점 눈과 입을 나중에 넣는 연습에 활용해요.</li><li><a href="https://www.pokemon.com/us/pokedex/jigglypuff" target="_blank" rel="noreferrer" className="font-bold underline">푸린 원본 보기</a> — 둥근 몸에 붙는 귀의 위치를 관찰해요. 큰 눈과 앞머리는 다음 순서예요.</li><li><a href="https://www.pokemon.com/us/pokedex/pikachu" target="_blank" rel="noreferrer" className="font-bold underline">피카츄 원본 보기</a> — 얼굴과 긴 귀부터 살펴봐요. 팔다리와 꼬리까지 한 번에 그리지 않아도 돼요.</li></ul></section>
      <section id="drawing-map" className="drawing-card"><h2 className="text-lg font-bold">9단계 학습 지도</h2><p className="my-3 text-sm text-slate-600">기본 원고 {pack.lessons.length}개 · 설명과 그림 일치 확인 {prepared.length}개. 준비 중인 수업은 완성 수에 포함하지 않아요.</p>{pack.stages.map(stage => <details key={stage.id} className="border-t py-4"><summary className="cursor-pointer font-semibold">{stage.id}. {stage.title} {confirmedStage(pack, records.records, stage.id) ? "· 자기확인됨" : "· 목표 확인 전"}</summary><p className="my-3 text-sm">단계 목표: {stage.criterion}</p><ul className="space-y-2">{pack.lessons.filter(l => l.stage === stage.id).map(lesson => <li key={lesson.id}><button className="drawing-button w-full text-left" disabled={!playable(lesson) || !records.owner || records.busy} onClick={() => void start(lesson)}>{lesson.id} · {lesson.title} {!playable(lesson) && "· 시각 자료 준비 중"}</button></li>)}</ul><p className="mt-3 text-xs text-slate-500">준비된 수업은 다음 단계도 맛볼 수 있어요. 맛보기를 이전 단계의 숙련으로 기록하지 않아요.</p></details>)}</section>
      <section className="drawing-card"><h2 className="text-lg font-bold">80개 다음에도 계속</h2>{pack.projects.map(project => <details key={project.id} className="border-b py-3"><summary className="cursor-pointer font-semibold">{project.id} · {project.title}</summary><ol className="my-3 list-inside list-decimal space-y-2 text-sm">{project.sessions.map(session => <li key={session}>{session}</li>)}</ol><p className="text-sm">확인할 점: {project.check}</p></details>)}</section>
      <section className="drawing-card text-sm"><h2 className="font-semibold">선택 이미지 피드백</h2><p className="mt-2 text-slate-600">그림 분석은 아직 연결 검증 중이에요. 기본 수업·자기확인·추천에는 AI 호출이 필요 없어요. 사진을 고르거나 그림을 그리는 것만으로 AI에 보내지 않아요.</p></section>
    </div>
  </main>;
}
