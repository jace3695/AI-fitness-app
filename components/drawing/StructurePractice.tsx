"use client";
import { useState } from 'react';
import type { Attempt, DrawingDocument } from '@/lib/drawing/model';
import { structureState, copyAnalysis } from '@/lib/drawing/structure';
import { exportExample } from '@/lib/drawing/export';
import { Diagram } from './Diagram';
import { DrawingCanvas } from './DrawingCanvas';

export function StructureDiagram({ doc, mode, choice = '' }: { doc: DrawingDocument; mode: 'demo' | 'easy' | 'full'; choice?: string }) {
  const st = doc.example.structure;
  if (!st) return null;
  const picked = st.choices.find(c => c.id === choice);
  const lines = mode === 'easy' ? picked?.lines ?? st.lines.filter(l => st.easyLines.includes(l.id)) : mode === 'full' ? [...st.lines,...st.hidden] : st.lines.filter(l => st.frames[doc.step]?.includes(l.id));
  return <svg viewBox="0 0 400 400" role="img" aria-label="덩어리 분석 예시" data-testid={`structure-${mode}`} className="h-full w-full">
    {lines.map((l,i) => <path key={l.id} data-line={l.id} d={l.d} fill={l.fill === 'ink' ? '#7750c4' : 'none'} stroke={l.fill === 'ink' ? 'none' : ['#7750c4','#087f8c','#bd530c'][i%3]} strokeWidth="3" strokeDasharray={st.hidden.some(h=>h.id===l.id) ? '7 6' : undefined} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}
export default function StructurePractice({ attempt, records, original, easy, disabled, onChange }: { attempt: Attempt; records: Attempt[]; original: boolean; easy: boolean; disabled: boolean; onChange: (patch: Partial<DrawingDocument>) => void }) {
  const doc = attempt.document, state = structureState(doc), st = doc.example.structure;
  const [inkVisible,setInkVisible] = useState(true);
  const [full,setFull] = useState(false);
  if (!st) return <p role="alert">분석 예제를 열지 못했어요. 학습 지도에서 다시 선택해 주세요.</p>;
  const dual = doc.lesson.structurePractice === 'assemble';
  const analysis = !dual || state.surface === 'analysis';
  const patch = (value: Partial<typeof state>) => onChange({ structure: { ...state,...value } });
  const strokes = dual && analysis ? state.analysis : doc.strokes;
  const guide = <>{analysis && original && <div className="absolute inset-0 opacity-30"><Diagram example={doc.example} original /></div>}{easy && <div className="absolute inset-0 opacity-60"><StructureDiagram doc={doc} mode="easy" choice={state.choice} /></div>}</>;
  const sourceOptions = records.filter(a=>a.user_id === attempt.user_id && a.document.lesson.id === 'D45' && a.document.tool === 'app' && a.document.strokes.length && a.revision > 0 && doc.lesson.examples.some(e=>e.id===a.document.example.id));
  return <div role="region" aria-label="스스로 도형화 연습" className="space-y-4">
    <p className="text-sm">먼저 내 눈으로 큰 덩어리를 찾아요. 색 선은 정답이 아니라 나누는 방법의 한 예예요. 원본의 세부보다 크기와 붙는 자리를 봐요.</p>
    {doc.lesson.id === 'D46' && <label className="block text-sm">저장한 D45 분석 이어 쓰기<select aria-label="저장한 D45 분석" disabled={disabled} className="drawing-input mt-2 w-full" value={state.source?.attemptId ?? ''} onChange={e=>{const source=sourceOptions.find(a=>a.id===e.target.value);if(!source)return;if((state.analysis.length || doc.strokes.length)&&!window.confirm('분석 밑그림을 선택한 D45 그림으로 바꿀까요? 조립한 선과 저장된 원본은 남겨요.'))return;onChange(copyAnalysis(doc,source));}}><option value="">선택 없이 제공 예제로 시작해도 돼요</option>{sourceOptions.map(a=><option key={a.id} value={a.id}>{a.document.example.name} · 저장 {a.revision}회</option>)}</select></label>}
    {dual && <div className="flex flex-wrap gap-2" aria-label="분석과 조립 연습장"><button className="drawing-button" disabled={disabled} aria-pressed={analysis} onClick={()=>patch({surface:'analysis'})}>원본 위에서 나누기</button><button className="drawing-button" disabled={disabled} aria-pressed={!analysis} onClick={()=>patch({surface:'assembly'})}>빈 공간에 다시 조립</button></div>}
    <p className="rounded-xl bg-violet-50 p-3 text-sm">{analysis ? '원본 위에 큰 도형을 직접 그려요. 겹친 선을 숨기면 원본과 비교할 수 있어요.' : '앞에서 분석한 그림을 옆에 두고, 빈 공간에 큰 덩어리부터 다시 놓아요.'}</p>
    {easy && st.choices.length > 0 && <fieldset disabled={disabled} className="rounded-xl border p-3"><legend>도형 후보 도움</legend><p className="text-sm">어느 쪽이 가까운지 골라 보고, 내 선으로 바꾸어도 돼요.</p><div className="mt-2 flex flex-wrap gap-2">{st.choices.map(c=><button className="drawing-button" key={c.id} aria-pressed={state.choice === c.id} onClick={()=>patch({choice:c.id,identified:false,compared:false})}>{c.label}</button>)}</div></fieldset>}
    <button className="drawing-button" aria-pressed={inkVisible} onClick={()=>setInkVisible(!inkVisible)}>{inkVisible ? '내 분석선 잠깐 숨기기' : '내 분석선 다시 보기'}</button>
    {doc.tool === 'app' ? <DrawingCanvas key={`${attempt.id}-${state.surface}-${inkVisible}`} strokes={inkVisible ? strokes : []} disabled={disabled || !inkVisible} onChange={value=>{if(dual && analysis)patch({analysis:value,identified:false,compared:false});else onChange({strokes:value,structure:{...state,identified:false,compared:false}});}} guide={guide} reference={original ? <div><p className="text-sm font-semibold">{dual && !analysis ? '내가 나눈 덩어리' : doc.example.name}</p>{dual && !analysis ? <DrawingCanvas strokes={state.analysis} preview guide={<div className="opacity-30"><Diagram example={doc.example} original /></div>} /> : <Diagram example={doc.example} original />}</div> : undefined} /> : <><div className="mx-auto max-w-sm">{original && <Diagram example={doc.example} original />}{easy && <StructureDiagram doc={doc} mode="easy" choice={state.choice}/>}</div><p className="text-sm">{doc.tool === 'paper' ? '종이를 두 칸으로 나눠 왼쪽에 덩어리를 찾고 오른쪽에 다시 조립해요. 사진 없이 확인 결과만 저장해도 돼요.' : '다른 그림 앱에서 원본 위 분석 레이어와 빈 조립 레이어를 따로 만들어요. 완성 이미지는 아래에서 가져올 수 있어요.'}</p></>}
    <details className="rounded-2xl bg-slate-50 p-4" onToggle={e=>{if(e.currentTarget.open && doc.usedHelp<3)onChange({usedHelp:3});}}><summary className="cursor-pointer font-semibold">덩어리 나누는 시범 보기</summary><p className="my-2 text-sm">위의 이전·다음 행동에 맞춰 큰 덩어리가 나타나요.</p><div className="mx-auto max-w-sm"><StructureDiagram doc={doc} mode="demo" /></div><p className="text-sm">{st.explanation}</p>
      {st.hidden.length > 0 && <><button className="drawing-button mt-3" aria-pressed={full} onClick={()=>setFull(!full)}>{full ? '가려진 선 뺀 완성 보기' : '가려진 선까지 밑그림 보기'}</button><div className="mx-auto max-w-sm" data-testid="structure-occlusion">{full ? <StructureDiagram doc={doc} mode="full" /> : <Diagram example={doc.example} original />}</div><p className="text-sm">점선은 뒤에 있지만 가려져 완성 그림에서는 보이지 않는 부분이에요.</p></>}
    </details>
    <button className="drawing-button" onClick={()=>exportExample(doc.example)}>분석할 원본 내려받기</button>
    <fieldset className="rounded-2xl border p-4" disabled={disabled || doc.step !== doc.lesson.steps.length-1}><legend className="font-semibold">덩어리와 관계 확인</legend><p className="text-sm">마지막 행동에서 내 그림을 보고 확인해요. 자동 채점은 하지 않아요.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="고른 덩어리 확인" checked={state.identified} onChange={e=>patch({identified:e.target.checked})} />고른 도형이 어떤 부분인지 짚어 설명했어요.</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="위치와 관계 확인" checked={state.compared} onChange={e=>patch({compared:e.target.checked})} />{doc.lesson.check}</label></fieldset>
    <label className="block text-sm">내가 고른 덩어리와 관계 · 메모는 선택<textarea className="drawing-input mt-2 w-full" aria-label="덩어리 설명" maxLength={500} disabled={disabled} value={state.note} onChange={e=>patch({note:e.target.value})} /></label>
  </div>;
}
