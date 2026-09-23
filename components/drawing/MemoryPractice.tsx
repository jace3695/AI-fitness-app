"use client";
import { useState } from 'react';
import type { Attempt, DrawingDocument } from '@/lib/drawing/model';
import { memoryHintLines, memoryPhase, memorySource, memoryState, memoryVisible } from '@/lib/drawing/memory';
import { exportExample } from '@/lib/drawing/export';
import { Diagram } from './Diagram';
import { DrawingCanvas } from './DrawingCanvas';

export function MemoryHint({ doc, easy }: { doc: DrawingDocument; easy: boolean }) {
  const lines = memoryHintLines(doc.lesson, doc.example, easy);
  if (!lines.length) return null;
  return <svg viewBox="0 0 400 400" className="h-full w-full" aria-label="큰 모양 힌트" role="img" data-testid="memory-hint">{lines.map(l => <path key={l.id} d={l.d} fill="none" stroke="#b4afc0" strokeWidth="3" strokeLinecap="round" />)}</svg>;
}

export default function MemoryPractice({ attempt, records, easy, disabled, onChange }: { attempt: Attempt; records: Attempt[]; easy: boolean; disabled: boolean; onChange: (patch: Partial<DrawingDocument>) => void }) {
  const doc = attempt.document, state = memoryState(doc), phase = memoryPhase(doc), visible = memoryVisible(doc);
  const config = doc.lesson.memoryPractice!;
  const [sourceId, setSourceId] = useState('');
  const candidates = records.filter(a => a.user_id === attempt.user_id && /^D(29|3[0-2])$/.test(a.document.lesson.id) && a.document.lesson.memoryPractice);
  const patch = (value: Partial<typeof state>) => onChange({ memory: { ...state, ...value } });
  const source = candidates.find(a => a.id === sourceId);
  const reference = visible ? <div className="rounded-2xl border bg-white p-3" aria-label="기억 연습 원본"><p className="text-sm font-semibold">{doc.example.name}</p><Diagram example={doc.example} original /></div> : <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed p-5 text-center text-sm" role="status">원본을 가렸어요. 기억나는 만큼만 그려요.</div>;
  return <div className="space-y-4" role="region" aria-label="기억해서 다시 그리기">
    <p className="text-sm">{phase === 'observe' ? '먼저 관찰해요. 다음 행동에서 원본을 가려요.' : phase === 'recall' ? '지금은 기억 연습이에요. 다시 확인해도 괜찮아요.' : '원본을 다시 보며 한 곳만 비교하고 보완해요.'}</p>
    {['D33','D34'].includes(doc.lesson.id) && <fieldset disabled={disabled} className="rounded-2xl border p-3">
      <legend className="font-semibold">이전에 연습한 캐릭터</legend>
      <label className="block text-sm">이전 기억 그림<select className="drawing-input mt-2 w-full" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">저장한 D29~D32 그림 선택</option>{candidates.map(a => <option key={a.id} value={a.id}>{a.document.lesson.id} · {a.document.example.name} · {new Date(a.updated_at).toLocaleDateString('ko-KR')}</option>)}</select></label>
      <button className="drawing-button mt-3" disabled={!source} onClick={() => { if (!source) return; if ((doc.strokes.length || doc.photo) && !window.confirm('현재 연습장을 비우고 선택한 캐릭터를 새로 기억해 볼까요? 저장된 이전 그림은 그대로예요.')) return; onChange(memorySource(attempt, source)); }}>이 캐릭터로 기억 연습</button>
      <p className="mt-2 text-sm">{state.source ? `${state.source.lessonId}의 당시 원본으로 새 그림을 그려요. 이전 작품은 바꾸지 않아요.` : '이전 그림이 없으면 기본 예제로 맛봐요. D33의 이전 연습 떠올리기 확인은 그림을 저장한 뒤 할 수 있어요.'}</p>
    </fieldset>}
    <fieldset disabled={disabled} className="rounded-2xl border p-3"><legend className="font-semibold">기억할 특징 두 개</legend><p className="mb-2 text-sm">{phase === 'recall' ? '기억나는 특징을 골라요.' : '기억하고 싶은 특징을 두 개 이상 골라요.'}</p><div className="flex flex-wrap gap-2">{config.features.map(feature => <button type="button" key={feature.id} className="drawing-button" aria-pressed={state.selected.includes(feature.id)} onClick={() => patch({ selected: state.selected.includes(feature.id) ? state.selected.filter(id => id !== feature.id) : [...state.selected, feature.id] })}>{feature.label}</button>)}</div></fieldset>
    {phase === 'recall' && <div className="flex flex-wrap gap-2"><button className="drawing-button" disabled={disabled || state.copyMode} onClick={() => onChange({ memory: { ...state, peeking: !state.peeking, peeks: state.peeking ? state.peeks : Math.min(10000, state.peeks + 1) }, usedHelp: state.peeking ? doc.usedHelp : Math.max(1, doc.usedHelp) as DrawingDocument['usedHelp'] })}>{state.peeking ? '다시 가리고 이어 그리기' : '잠깐 원본 확인'}</button>{config.hint === 'copy' && <button className="drawing-button" disabled={disabled} aria-pressed={state.copyMode} onClick={() => onChange({ memory: { ...state, copyMode: !state.copyMode, peeking: false }, short: true, check: 'assisted', usedHelp: Math.max(1, doc.usedHelp) as DrawingDocument['usedHelp'] })}>{state.copyMode ? '다시 기억 연습하기' : '원본 보며 모작으로 마치기'}</button>}</div>}
    {state.copyMode && <p className="rounded-xl bg-amber-50 p-3 text-sm">원본을 보며 연습 중이에요. 실패가 아닌 도움받은 시도로 남겨요.</p>}
    {easy && <p className="rounded-xl bg-amber-50 p-3 text-sm">{config.hint === 'words' ? '글자 힌트: 달걀 몸 / 점 눈. 이 두 가지만 기억해도 돼요.' : doc.lesson.easier}</p>}
    {easy && config.hint === 'choices' && phase === 'observe' && <div className="grid grid-cols-2 gap-3" aria-label="기억할 특징 그림 선택지">{config.features.slice(0,2).map(f => <div key={f.id} className="rounded-xl border p-2"><p className="text-sm">{f.label}</p><svg viewBox="0 0 400 400" role="img" aria-label={f.label} className="w-full">{doc.example.lines.filter(l => f.lines.includes(l.id)).map(l => <path key={l.id} d={l.d} fill="none" stroke="#34314b" strokeWidth="4" />)}</svg></div>)}</div>}
    {doc.tool === 'app' ? <DrawingCanvas key={`${attempt.id}-${state.source?.attemptId ?? 'new'}`} strokes={doc.strokes} onChange={strokes => onChange({ strokes })} disabled={disabled} reference={reference} guide={<MemoryHint doc={doc} easy={easy} />} /> : <><div className="grid gap-4 md:grid-cols-2">{reference}<div className="aspect-square rounded-2xl border bg-white"><MemoryHint doc={doc} easy={easy} /></div></div><p className="text-sm">{doc.tool === 'paper' ? '종이에서는 원본을 다른 종이로 덮고 빈 종이에 기억해서 그려요. 비교할 때만 덮은 종이를 열어요.' : '다른 그림 앱에서는 원본 창이나 레이어를 가리고 새 빈 레이어에 그려요. 비교할 때만 다시 열어요.'} 사진 없이 자기확인만 저장해도 돼요.</p></>}
    {visible && <button className="drawing-button" onClick={() => exportExample(doc.example)}>관찰용 원본 내려받기</button>}
    <label className="block text-sm">기억나는 특징 · 말해도 괜찮아요<textarea className="drawing-input mt-2 w-full" disabled={disabled} maxLength={500} value={state.recalled} onChange={e => patch({ recalled: e.target.value })} placeholder="예: 큰 얼굴 위에 작은 귀 두 개" /></label>
    {phase === 'compare' && <label className="block text-sm">다시 보고 보완할 한 곳<textarea className="drawing-input mt-2 w-full" disabled={disabled} maxLength={500} value={state.compared} onChange={e => patch({ compared: e.target.value })} placeholder="예: 귀 위치를 다시 봤어요. 오른쪽 귀만 조금 옮길래요." /></label>}
    <p className="text-xs text-slate-600">잠깐 원본 확인 {state.peeks}회 · 횟수로 실력을 채점하지 않아요. 관찰·비교 단계에서 보는 원본은 이 횟수에 포함하지 않아요.</p>
  </div>;
}
