"use client";
import type {Attempt,DrawingDocument,ProjectState} from '@/lib/drawing/model';
import {projectCandidates,projectEdit,projectSavePatch,projectSessionReady,projectSource,projectState} from '@/lib/drawing/projects';
import {DrawingCanvas,paintStrokes} from './DrawingCanvas';
import {download} from '@/lib/drawing/export';

const prompts:Record<string,string[]>={
  C01:['오늘의 기분과 유지할 특징 하나','첫 표정에서 눈·입을 어떻게 바꿨나요?','다른 감정과 그대로 둔 특징','두 표정을 비교하고 수정한 한 곳'],
  C02:['인사·앉기·걷기 중 고른 상황과 이유','몸·팔·다리가 향하는 방향','큰 덩어리에 더한 캐릭터 특징','추가한 표정과 기준형에서 유지한 특징'],
  C03:['친구 캐릭터의 다른 역할','다르게 그린 큰 몸 모양','친구만의 구별되는 특징 하나','두 캐릭터의 공통점과 구별점'],
  C04:['캐릭터가 쓰일 화면과 역할','작게 보았을 때 남길 특징','추가한 표정 또는 인사·앉기·걷기 자세','작은 크기에서도 알아볼 수 있는 특징'],
};
export default function ProjectPractice({attempt,records,disabled,onChange,onSave}:{attempt:Attempt;records:Attempt[];disabled:boolean;onChange:(patch:Partial<DrawingDocument>)=>void;onSave:(patch:Partial<DrawingDocument>)=>Promise<void>}) {
  const d=attempt.document,p=projectState(d),id=d.lesson.id,step=d.step;
  const candidates=projectCandidates(attempt,records),two=id==='C01';
  const labels=two?['첫 표정','다른 표정']:['이번 프로젝트 그림','보조 그림'];
  function edit(patch:Partial<ProjectState>){onChange(projectEdit(d,patch));}
  function move(next:number){const active=two&&next===2?1:next===3?p.active:0;onChange({step:next,project:{...p,active},strokes:p.boards[active]});}
  function card(){
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=two?1450:1000;
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#34314b';ctx.font='32px sans-serif';ctx.fillText(`${id} · ${p.name||d.lesson.title}`,40,50,1120);
    const frames=[{label:'선택한 내 기준형',strokes:p.source?.strokes??[]},{label:labels[0],strokes:p.boards[0]},...(two?[{label:labels[1],strokes:p.boards[1]}]:[])];
    frames.forEach((frame,i)=>{const x=40+(i%2)*580,y=90+Math.floor(i/2)*590;ctx.font='24px sans-serif';ctx.fillText(frame.label,x,y);const panel=document.createElement('canvas');panel.width=panel.height=530;paintStrokes(panel,frame.strokes,true);ctx.drawImage(panel,x,y+20);});
    canvas.toBlob(blob=>{if(blob)download(blob,`${id}-project-card.png`);},'image/png');
  }
  return <fieldset disabled={disabled} aria-label="지속 프로젝트 연습" className="min-w-0">
    <p className="my-3 text-sm">회차마다 10~20분, 기한 없이 이어 해요. 저장한 원본의 복사본을 보고 연습해요. 회차를 다시 수정하면 그 뒤 회차도 다시 확인해요.</p>
    <div className="mb-4 flex flex-wrap gap-2">{p.saved.map((saved,i)=><button key={i} className={step===i?'drawing-primary':'drawing-button'} disabled={i>0&&!p.saved[i-1]} aria-current={step===i?'step':undefined} onClick={()=>move(i)}>{i+1}회차{saved?' · 저장됨':''}</button>)}</div>
    {step===0&&d.tool==='app'&&<><label className="block text-sm">기준으로 삼을 내 그림<select className="drawing-input mt-2 w-full" value={p.source?.attemptId??''} onChange={e=>{const source=candidates.find(a=>a.id===e.target.value);if(source){const snapshot=projectSource(source);onChange({...projectEdit(d,{source:snapshot}),references:[snapshot.attemptId]});}}}><option value="">저장한 그림 선택</option>{candidates.map(a=><option key={a.id} value={a.id}>{a.document.lesson.id} · {a.document.character.name||a.document.lesson.title}</option>)}{p.source&&!candidates.some(a=>a.id===p.source!.attemptId)&&<option value={p.source.attemptId}>{p.source.label} · 보관한 복사본</option>}</select></label>{!candidates.length&&!p.source&&<p className="my-3 text-sm">먼저 기본 수업에서 내 캐릭터를 그리고 저장해 주세요. 학습 지도에서 D61 기준형이나 D74 내 캐릭터를 열 수 있어요.</p>}</>}
    {p.source&&<div className="my-4"><p className="text-sm">선택한 내 기준형 · {p.source.label} · 원본은 보존돼요</p><div className={id==='C04'?'mt-2 w-24':'mt-2 max-w-xs'}><DrawingCanvas strokes={p.source.strokes} preview /></div>{id==='C04'&&<p className="text-xs">작은 표시 크기 96px에서 특징을 확인해요.</p>}</div>}
    {step>0&&d.tool==='app'&&<>
      {two&&step===3&&<div className="my-3 flex flex-wrap gap-2">{labels.map((label,i)=><button key={label} className={p.active===i?'drawing-primary':'drawing-button'} onClick={()=>onChange({project:{...p,active:i},strokes:p.boards[i]})}>{label} 수정</button>)}</div>}
      <h4 className="my-3 font-semibold">{labels[p.active]}</h4><DrawingCanvas key={`${attempt.id}-${p.active}`} strokes={p.boards[p.active]} disabled={disabled} onChange={strokes=>{const boards=structuredClone(p.boards);boards[p.active]=strokes;edit({boards});}} />
    </>}
    {d.tool!=='app'&&<p className="my-4 text-sm">기준 그림과 회차별 그림을 {d.tool==='paper'?'종이에':'다른 그림 앱에'} 보관해요. 아래 회차 메모에 무엇을 했는지 적고, 사진은 선택해서 가져와요. 앱 안의 선 모음으로 기록하지 않아요.</p>}
    <label className="my-4 block text-sm">{prompts[id][step]}<textarea aria-label="이번 회차 메모" maxLength={500} className="drawing-input mt-2 w-full" value={p.notes[step]} onChange={e=>{const notes=[...p.notes] as ProjectState['notes'];notes[step]=e.target.value;edit({notes});}} /></label>
    {step===3&&<><div className="grid grid-cols-2 gap-3">{(two?p.boards:[p.source?.strokes??[],p.boards[0]]).map((strokes,i)=><div key={i}><p className="text-sm">{two?labels[i]:i===0?'기준형':'새 그림'}</p><div className={id==='C04'?'w-24 max-w-full':''}><DrawingCanvas strokes={strokes} preview /></div></div>)}</div>
      {id==='C04'&&<label className="my-3 block text-sm">묶음 이름<input maxLength={100} className="drawing-input w-full" value={p.name} onChange={e=>edit({name:e.target.value})}/></label>}
      <label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={p.compared} onChange={e=>edit({compared:e.target.checked})}/>{d.lesson.check} · 직접 비교했어요</label>
      <button className="drawing-button mb-3" disabled={d.tool!=='app'||!projectSessionReady(d)} onClick={card}>프로젝트 카드 PNG</button>
    </>}
    <button className="drawing-primary" disabled={!projectSessionReady(d)} onClick={()=>void onSave(projectSavePatch(d))}>이번 회차 저장</button>
    <p role="status" className="mt-2 text-sm">{p.saved[step]?'이번 회차를 저장했어요. 다음 회차를 선택하거나 나중에 이어 해요.':'이번 회차의 선택·그림과 메모를 확인한 뒤 저장해요.'}</p>
    <p className="mt-4 text-xs">막히면 학습 지도에서 표정 D62~D64, 자세 D66~D69를 복습해요. 새 각도나 어려운 자세를 추가하지 않아도 돼요.</p>
  </fieldset>;
}
