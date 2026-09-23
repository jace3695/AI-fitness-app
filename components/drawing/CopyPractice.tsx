"use client";
import { useState } from 'react';
import Image from 'next/image';
import type { Attempt, DrawingDocument, Example, Help, Lesson } from '@/lib/drawing/model';
import { copyGuide, copyWorksheetSvg, correctionCopy, scaledTransform } from '@/lib/drawing/copy';
import { download, exportExample } from '@/lib/drawing/export';
import { HELP_LABELS } from '@/lib/drawing/recommend';
import { Diagram } from './Diagram';
import { DrawingCanvas } from './DrawingCanvas';

export function CopyGuide({ lesson, example, help, step, easy }: { lesson: Lesson; example: Example; help: Help; step: number; easy: boolean }) {
  const guide = copyGuide(lesson, example, help, step, easy);
  return <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-label="모작 위치 도움" data-testid="copy-guide">
    <g transform={scaledTransform(guide.scale)}>
      <g data-testid="copy-provided">{guide.lines.map(l => <path key={l.id} d={l.d} fill={l.fill === 'ink' ? '#a6a1b2' : 'none'} stroke={l.fill === 'ink' ? 'none' : '#a6a1b2'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}</g>
      <g data-testid="copy-anchors">{guide.anchors.map(l => <circle key={l.id} cx={l.start[0]} cy={l.start[1]} r="4" fill="#a5541e" />)}</g>
    </g>
  </svg>;
}

export default function CopyPractice({ attempt, records, original, easy, disabled, onChange }: { attempt: Attempt; records: Attempt[]; original: boolean; easy: boolean; disabled: boolean; onChange: (patch: Partial<DrawingDocument>) => void }) {
  const doc = attempt.document;
  const [overlay, setOverlay] = useState(true);
  const [sourceId, setSourceId] = useState('');
  const candidates = records.filter(a => a.user_id === attempt.user_id && /^D2[0-6]$/.test(a.document.lesson.id));
  const source = records.find(a => a.id === doc.correctionSource?.attemptId && a.revision === doc.correctionSource.revision);
  const referenceExample = doc.correctionSource?.example ?? doc.example;
  const referenceScale = doc.correctionSource?.scale ?? 1;
  const guide = !doc.correctionSource && overlay ? <CopyGuide lesson={doc.lesson} example={doc.example} help={doc.help} step={doc.step} easy={easy} /> : undefined;
  const reference = original ? <div className="rounded-2xl border border-slate-200 bg-white" aria-label="옆에 두는 원본">
    <p className="px-3 pt-3 text-sm font-semibold">원본 · {referenceExample.name}</p>
    <div style={{ transform: `scale(${referenceScale})` }}><Diagram example={referenceExample} original /></div>
  </div> : undefined;
  const selected = candidates.find(a => a.id === sourceId);

  return <div className="space-y-4" role="region" aria-label="원본 보며 모작하기">
    <p className="text-sm">원본을 보고 옆 연습장에 옮겨요. 먼저 큰 모양, 그다음 작은 부분이에요. 휴대폰에서는 원본 아래에 연습장이 있어요.</p>
    {doc.lesson.id === 'D27' && <section className="rounded-2xl border border-violet-200 p-4" aria-label="한 곳 수정하기">
      <h4 className="font-semibold">내 그림의 복사본에서 고쳐요</h4>
      {candidates.length ? <><label className="mt-3 block text-sm">수정할 이전 그림<select aria-label="수정할 이전 그림" value={sourceId} className="drawing-input mt-2 w-full" disabled={disabled} onChange={e => setSourceId(e.target.value)}><option value="">D20~D26 그림 선택</option>{candidates.map(a => <option key={a.id} value={a.id}>{a.document.lesson.id} · {a.document.example.name} · {new Date(a.updated_at).toLocaleDateString('ko-KR')}</option>)}</select></label>
        <button className="drawing-button mt-3" disabled={disabled || !selected} onClick={() => { if (!selected) return; if (doc.strokes.length && !window.confirm('현재 수정 연습의 선을 선택한 그림의 복사본으로 바꿀까요? 저장된 원본은 유지돼요.')) return; onChange(correctionCopy(attempt, selected)); }}>복사본 가져오기</button></> : <p className="mt-2 text-sm">D20~D26에서 저장한 그림이 여기에 보여요. 지금은 시범을 보고 곰을 한 번 그린 뒤 한 곳을 고쳐봐도 돼요.</p>}
      {doc.correctionSource && <><p className="mt-3 text-sm" role="status">{doc.correctionSource.lessonId} 복사본을 불러왔어요. 저장된 원본은 그대로 있어요.</p>{source ? <details className="mt-3"><summary className="cursor-pointer text-sm">수정 전 그림 보기</summary><div className="max-w-sm"><DrawingCanvas key={`${source.id}-${source.revision}`} strokes={source.document.strokes} preview />{source.document.photo && <Image src={source.document.photo} alt="수정 전 사진" width={400} height={400} unoptimized className="h-auto w-full" />}</div></details> : <p className="mt-2 text-sm">이전 작품이 변경되었거나 없어 수정 전 비교를 표시하지 않아요. 불러온 선과 당시 참고 예제는 유지돼요.</p>}</>}
      {easy && original && <div className="mt-4" aria-label="두 곳만 살펴보기"><p className="text-sm">전체 폭과 눈 높이 중 하나만 골라요. 두 곳 모두 고칠 필요는 없어요.</p><div className="mt-3 grid grid-cols-2 gap-3">{(['width','eyes'] as const).map(focus => {
        const eye=referenceExample.lines.find(l=>l.id==='eyeL')?.start ?? [160,200];
        return <div key={focus} className="rounded-xl bg-white p-2"><p className="text-sm">{focus==='width'?'원본 전체 폭':'원본 눈 높이 · 확대'}</p><svg viewBox={focus==='width'?'50 60 300 300':`120 ${Math.max(0,eye[1]-35)} 160 90`} className="aspect-square w-full" role="img" aria-label={focus==='width'?'전체 폭 참고':'눈 높이 확대 참고'}>{referenceExample.lines.filter(l=>!['guide','gesture'].includes(l.group)).map(l=><path key={l.id} d={l.d} fill={l.fill==='ink'?'#222':'none'} stroke={l.fill==='ink'?'none':'#222'} strokeWidth="3" strokeLinecap="round" />)}</svg></div>;
      })}</div></div>}
    </section>}
    {doc.tool === 'app' ? <>
      <div className="flex flex-wrap items-end gap-3"><label className="block text-sm">도움 정도<select className="drawing-input mt-1" value={doc.help} disabled={disabled || !!doc.correctionSource} onChange={e => { const help = Number(e.target.value) as Help; onChange({ help, usedHelp: Math.max(help, doc.usedHelp) as Help }); }}>{HELP_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label><button className="drawing-button" aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>{overlay ? '밑그림 숨기기' : '밑그림 다시 보기'}</button></div>
      <DrawingCanvas key={`${attempt.id}-${doc.correctionSource?.attemptId ?? 'new'}`} strokes={doc.strokes} onChange={strokes => onChange({ strokes })} disabled={disabled} guide={guide} reference={reference} />
    </> : <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{reference}<div className="aspect-square rounded-2xl border bg-white">{guide}</div></div>
      <p className="text-sm">{doc.tool === 'paper' ? '원본을 종이 옆에 두고 빈 자리에 옮겨 그려요. 인쇄용 연습장에는 원본과 이번 수업의 위치 도움만 들어 있어요. 사진 없이 자기확인만 저장해도 돼요.' : '원본을 다른 그림 앱의 옆 창이나 옆 페이지에 두고 빈 공간에 옮겨요. 완성한 이미지는 아래에서 가져올 수 있어요.'}</p>
    </>}
    {easy && doc.lesson.id === 'D26' && original && <div className="max-w-sm rounded-2xl border bg-white p-3" aria-label="작게 줄인 원본"><p className="text-sm">작게 줄인 원본 · 얼굴과 귀를 함께 줄여요</p><div style={{ transform: `scale(${doc.lesson.practice?.scale ?? 1})` }}><Diagram example={doc.example} original /></div></div>}
    <div className="flex flex-wrap gap-2"><button className="drawing-button" onClick={() => exportExample(referenceExample)}>예제 내려받기</button>{!doc.correctionSource && <button className="drawing-button" onClick={() => download(new Blob([copyWorksheetSvg(doc.lesson, doc.example, easy)], { type: 'image/svg+xml' }), `${doc.example.id}-copy-worksheet.svg`)}>모작 연습장 내려받기</button>}</div>
    <details className="rounded-2xl bg-slate-50 p-4" onToggle={event => { if (event.currentTarget.open && doc.usedHelp < 3) onChange({ usedHelp: 3 }); }}>
      <summary className="cursor-pointer font-semibold">선생님 시범 보기 · {doc.example.name}</summary>
      <p className="my-3 text-sm">위의 이전·다음 행동으로 한 동작씩 봐요. 주황 점은 시작 위치, 화살표는 움직일 방향, 보라 선은 이번 동작이에요.</p>
      <div className="mx-auto max-w-sm" data-testid="copy-demonstration"><Diagram example={doc.example} lesson={doc.lesson} step={doc.step} help={3} /></div>
    </details>
    {Number(doc.lesson.id.slice(1)) >= 20 && <fieldset className="rounded-2xl border p-4" disabled={disabled}>
      <legend className="px-1 font-semibold">비교할 한 곳</legend><p className="mb-3 text-sm">직접 살펴본 내용을 남겨요. 원본과 같다고 느꼈다면 그 이유를 적어도 돼요.</p>
      <div className="flex flex-wrap gap-2">{([['width','전체 폭'],['ears','귀 위치·크기'],['eyes','눈 높이'],['space','안쪽 빈 공간']] as const).map(([focus,label]) => <button key={focus} type="button" className="drawing-button" aria-pressed={doc.comparison?.focus === focus} onClick={() => onChange({ comparison: { focus, reason: doc.comparison?.reason ?? '' } })}>{label}</button>)}</div>
      <label className="mt-3 block text-sm">이곳을 고른 이유<textarea className="drawing-input mt-2 w-full" maxLength={500} value={doc.comparison?.reason ?? ''} disabled={!doc.comparison} placeholder="한 곳을 고른 뒤 내가 본 차이를 적어요." onChange={e => { if (doc.comparison) onChange({ comparison: { ...doc.comparison, reason: e.target.value } }); }} /></label>
    </fieldset>}
  </div>;
}
