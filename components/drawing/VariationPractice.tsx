"use client";
import type { Attempt, DrawingDocument } from '@/lib/drawing/model';
import { chooseVariation, variationChoice, variationState, variationTarget } from '@/lib/drawing/variation';
import { exportExample } from '@/lib/drawing/export';
import { Diagram } from './Diagram';
import { DrawingCanvas } from './DrawingCanvas';

export function VariationDiagram({ doc, mode }: { doc: DrawingDocument; mode: 'demo' | 'easy' }) {
  const choice = variationChoice(doc);
  if (!choice) return null;
  const kept = doc.example.lines.filter(l => !choice.remove.includes(l.id));
  const target = variationTarget(doc);
  const lines = mode === 'easy' ? choice.easy === 'trace' ? target.lines : choice.easy === 'kept' ? kept : [] : doc.step === 0 ? doc.example.lines : doc.step >= 3 ? target.lines : kept;
  const anchors = mode === 'easy' ? choice.anchors : doc.step === 2 ? choice.lines.map(l => l.start) : [];
  return <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-label={mode === 'demo' ? '한 부분 변형 시범' : '변형 연습 도움'} data-testid={`variation-${mode}`}>
    {lines.map(l => <path key={l.id} data-line={l.id} d={l.d} fill={l.fill === 'ink' ? mode === 'demo' && doc.step >= 3 && choice.remove.includes(l.id) ? '#7750c4' : '#6e6680' : 'none'} stroke={l.fill === 'ink' ? 'none' : mode === 'demo' && doc.step >= 3 && choice.remove.includes(l.id) ? '#7750c4' : '#b4afc0'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
    {anchors.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="4" fill="#bd530c" stroke="white" />)}
  </svg>;
}

export default function VariationPractice({ attempt, original, easy, disabled, onChange }: { attempt: Attempt; original: boolean; easy: boolean; disabled: boolean; onChange: (patch: Partial<DrawingDocument>) => void }) {
  const doc = attempt.document, state = variationState(doc), choice = variationChoice(doc);
  if (!choice) return <p role="alert">이 그림의 변형 예제를 열지 못했어요. 학습 지도에서 수업을 다시 선택해 주세요.</p>;
  const target = variationTarget(doc);
  const patch = (value: Partial<typeof state>) => onChange({ variation: { ...state, ...value } });
  const references = original ? <div className="grid grid-cols-2 gap-2" aria-label="기본과 변형 비교">
    <div className="rounded-xl border bg-white p-2"><p className="text-sm font-semibold">기본 · {doc.example.name}</p><Diagram example={doc.example} original /></div>
    <div className="rounded-xl border bg-white p-2"><p className="text-sm font-semibold">변형 · {choice.label}</p><Diagram example={target} original /></div>
  </div> : undefined;
  return <div className="space-y-4" role="region" aria-label="한 부분만 바꾸기">
    <p className="text-sm">한 가지를 바꾸어도 같은 친구예요. 기본 그림에서 바꿀 부분을 비워 두고 새 모양을 넣어요.</p>
    <fieldset disabled={disabled} className="rounded-2xl border p-3"><legend className="px-1 font-semibold">이번에 바꿀 한 가지</legend><div className="flex flex-wrap gap-2">{doc.example.variations!.map(v => <button type="button" key={v.id} className="drawing-button" aria-pressed={state.choice === v.id} onClick={() => { if (v.id === state.choice) return; if ((doc.strokes.length || state.changedChecked || state.keptChecked) && !window.confirm('바꿀 요소를 바꾸면 비교 확인을 다시 해요. 지금 그린 선은 남겨둘까요?')) return; onChange(chooseVariation(doc,v.id)); }}>{v.label}</button>)}</div></fieldset>
    <dl className="rounded-2xl bg-violet-50 p-4 text-sm"><dt className="font-bold">바꾸는 것</dt><dd>{choice.changed}</dd><dt className="mt-2 font-bold">그대로 두는 것</dt><dd>{choice.kept}</dd></dl>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">{choice.instruction}</p>
    {doc.tool === 'app' ? <DrawingCanvas key={attempt.id} strokes={doc.strokes} onChange={strokes => onChange({ strokes })} disabled={disabled} reference={references} guide={easy ? <VariationDiagram doc={doc} mode="easy" /> : undefined} /> : <>{references}{easy && <div className="mx-auto max-w-sm"><VariationDiagram doc={doc} mode="easy" /></div>}<p className="text-sm">{doc.tool === 'paper' ? '기본 그림과 변형 예제를 종이 옆에 두고, 빈자리에 나머지를 유지하며 한 부분만 바꿔 그려요. 사진 없이 확인 결과만 저장해도 돼요.' : '기본 그림과 변형 예제를 다른 그림 앱 옆에 두고 새 레이어에 그려요. 완성한 이미지는 아래에서 가져올 수 있어요.'}</p></>}
    <details className="rounded-2xl bg-slate-50 p-4" onToggle={e => { if (e.currentTarget.open && doc.usedHelp < 3) onChange({ usedHelp: 3 }); }}><summary className="cursor-pointer font-semibold">한 부분 바꾸는 시범 보기</summary><p className="my-2 text-sm">위의 이전·다음 행동으로 봐요. 주황 점은 시작 자리, 보라 선은 바꾸는 부분이에요. 회색 선은 유지해요.</p><div className="mx-auto max-w-sm"><VariationDiagram doc={doc} mode="demo" /></div></details>
    <div className="flex flex-wrap gap-2"><button className="drawing-button" onClick={() => exportExample(doc.example)}>기본 그림 내려받기</button><button className="drawing-button" onClick={() => exportExample(target)}>변형 예제 내려받기</button></div>
    <fieldset disabled={disabled || doc.step !== doc.lesson.steps.length - 1} className="rounded-2xl border p-4"><legend className="px-1 font-semibold">바꾼 것과 유지한 것 확인</legend><p className="mb-2 text-sm">마지막 비교 행동에서 내 그림을 보고 체크해요. 자동 채점이 아니에요.</p>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="바꾼 부분 확인" checked={state.changedChecked} onChange={e => patch({ changedChecked: e.target.checked })} />바꾼 부분: {choice.changed}</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="유지한 부분 확인" checked={state.keptChecked} onChange={e => patch({ keptChecked: e.target.checked })} />유지한 부분: {choice.kept}</label>
    </fieldset>
    <label className="block text-sm">내가 바꾼 한 가지 · 메모는 선택<textarea aria-label="내가 바꾼 한 가지" className="drawing-input mt-2 w-full" maxLength={500} disabled={disabled} value={state.note} onChange={e => patch({ note: e.target.value })} /></label>
  </div>;
}
