"use client";
import type {Attempt,DrawingDocument} from '@/lib/drawing/model';
import {gestureState} from '@/lib/drawing/gesture';
import {exportExample} from '@/lib/drawing/export';
import {Diagram} from './Diagram';
import {DrawingCanvas} from './DrawingCanvas';

export function GestureDiagram({doc,mode}:{doc:DrawingDocument;mode:'demo'|'easy'|'base'}){
 const g=doc.example.gesture;if(!g)return null;
 const choice=g.choices.find(c=>c.id===gestureState(doc).choice);
 const ids=mode==='demo'?g.frames[doc.step]:mode==='base'?g.baseLines:g.easyLines;
 const lines=mode==='easy' && choice?choice.lines:g.lines.filter(l=>ids.includes(l.id));
 return <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-label="자세의 큰 방향" data-testid={`gesture-${mode}`}>
  {lines.map(l=><path key={l.id} data-line={l.id} d={l.d} fill="none" stroke={l.group==='gesture'?'#7750c4':'#087f8c'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
  {mode==='easy'&&g.anchors.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="5" fill="#bd530c" stroke="white"/>)}
 </svg>;
}
export default function GesturePractice({attempt,original,easy,disabled,onChange}:{attempt:Attempt;original:boolean;easy:boolean;disabled:boolean;onChange:(patch:Partial<DrawingDocument>)=>void}){
 const doc=attempt.document,state=gestureState(doc),g=doc.example.gesture;if(!g)return <p role="alert">자세 예제를 열지 못했어요. 학습 지도에서 다시 선택해 주세요.</p>;
 const trace=state.surface==='trace';
 const patch=(value:Partial<typeof state>)=>onChange({gesture:{...state,...value}});
 const guide=<>{trace&&original&&<div className="absolute inset-0 opacity-30"><Diagram example={doc.example} original/></div>}{g.baseLines.length>0&&<div className="absolute inset-0 opacity-40"><GestureDiagram doc={doc} mode="base"/></div>}{easy&&<div className="absolute inset-0 opacity-60"><GestureDiagram doc={doc} mode="easy"/></div>}</>;
 return <div role="region" aria-label="쉬운 크로키 연습" className="space-y-4">
  <p className="text-sm">빨리 그리는 시험이 아니에요. 얼굴·손가락·근육은 생략하고 머리, 몸, 팔·다리의 큰 방향만 봐요. 제한 시간 없이 천천히 해도 돼요.</p>
  <p className="rounded-xl bg-violet-50 p-3 text-sm">오늘 볼 방향: {g.focus}</p>
  <div className="flex flex-wrap gap-2"><button className={trace?'drawing-primary':'drawing-button'} aria-pressed={trace} disabled={disabled} onClick={()=>onChange({gesture:{...state,surface:'trace'},usedHelp:Math.max(doc.usedHelp,2) as DrawingDocument['usedHelp']})}>원본 위에서 방향 찾기</button><button className={!trace?'drawing-primary':'drawing-button'} aria-pressed={!trace} disabled={disabled} onClick={()=>patch({surface:'free'})}>빈 공간에 자세 그리기</button></div>
  <p className="text-sm">{trace?'연한 원본 위에 방향을 짚어요. 여기 그린 선은 빈 공간의 선과 따로 저장돼요.':'옆의 자세를 보고 빈 공간에 그려요. 앞서 따라 그린 선은 원본 위 연습장에 남아 있어요.'}</p>
  {easy&&g.choices.length>0&&<fieldset className="rounded-xl border p-3" disabled={disabled}><legend>방향 후보 도움</legend><div className="flex flex-wrap gap-2">{g.choices.map(c=><button className={state.choice===c.id?'drawing-primary':'drawing-button'} key={c.id} aria-pressed={state.choice===c.id} onClick={()=>patch({choice:c.id,directionChecked:false,compared:false})}>{c.label}</button>)}</div><p className="mt-2 text-sm">원본이 기운 쪽과 가까운 방향을 골라 따라가요.</p></fieldset>}
  {doc.tool==='app'?<DrawingCanvas key={`${attempt.id}-${state.surface}`} strokes={trace?state.trace:doc.strokes} disabled={disabled} guide={guide} reference={original?<div><p className="font-semibold">{doc.example.name}</p><Diagram example={doc.example} original/>{doc.lesson.id==='D54'&&<div className="rounded-xl border p-2"><p className="text-sm">곧게 선 가운데 길과 비교</p><svg viewBox="0 0 400 400" role="img" aria-label="곧게 선 방향" className="mx-auto h-40"><circle cx="200" cy="75" r="26" fill="none" stroke="#64748b" strokeWidth="3"/><path d="M200 105 L200 225 M200 225 L175 325 M200 225 L225 325" stroke="#64748b" strokeWidth="3" fill="none"/></svg></div>}</div>:undefined} onChange={strokes=>trace?patch({trace:strokes,directionChecked:false,compared:false}):onChange({strokes,gesture:{...state,directionChecked:false,compared:false}})}/>:<><div className="mx-auto max-w-sm">{original&&<Diagram example={doc.example} original/>}{easy&&<GestureDiagram doc={doc} mode="easy"/>}</div><p className="text-sm">{doc.tool==='paper'?'종이 왼쪽에 방향을 짚고 오른쪽 빈 공간에 자세를 그려요. 시간을 재지 않아도 돼요. 사진 없이 자기확인만 저장할 수 있어요.':'다른 그림 앱에서 따라 그린 방향과 새 자세를 별도 레이어에 보관해요. 완성 이미지는 아래에서 가져올 수 있어요.'}</p></>}
  <details className="rounded-2xl bg-slate-50 p-4" onToggle={e=>{if(e.currentTarget.open&&doc.usedHelp<3)onChange({usedHelp:3});}}><summary className="cursor-pointer font-semibold">큰 방향 시범 보기</summary><p className="my-2 text-sm">위의 이전·다음 행동으로 머리부터 방향을 이어 봐요. 보라색은 방향선, 청록색은 단순 덩어리예요.</p><div className="mx-auto max-w-sm"><GestureDiagram doc={doc} mode="demo"/></div></details>
  <button className="drawing-button" onClick={()=>exportExample(doc.example)}>자세 원본 내려받기</button>
  <fieldset className="rounded-2xl border p-4" disabled={disabled||doc.step!==doc.lesson.steps.length-1}><legend className="font-semibold">방향 비교 확인</legend><p className="text-sm">마지막 행동에서 원본과 내 그림을 비교해요. 속도와 세부 묘사는 평가하지 않아요.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="큰 방향 확인" checked={state.directionChecked} onChange={e=>patch({directionChecked:e.target.checked})}/>{doc.lesson.check}</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="원본 자세 비교" checked={state.compared} onChange={e=>patch({compared:e.target.checked})}/>원본과 중요한 방향 한두 곳을 비교했어요.</label></fieldset>
  <label className="block text-sm">오늘 본 방향 · 메모는 선택<textarea aria-label="자세 방향 메모" className="drawing-input mt-2 w-full" disabled={disabled} maxLength={500} value={state.note} onChange={e=>patch({note:e.target.value})}/></label>
 </div>;
}
