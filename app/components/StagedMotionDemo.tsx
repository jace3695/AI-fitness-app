'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useMotionDisclosurePause} from '../../hooks/useMotionDisclosurePause';
import {advanceMotion,clampProgress} from '../lib/exerciseMotion';


export type MotionStage={id:string;name:string;peak:number;guide:string;isStatic?:boolean};
type Props={title:string;intro:string;stages:readonly MotionStage[];renderFigure:(id:string,progress:number,label:string)=>ReactNode};
export default function StagedMotionDemo({title,intro,stages,renderFigure}:Props){
 const [stage,setStage]=useState(0);
 return <section aria-label={`${title} 단계별 자체 시범`} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-800">
  <p className="font-bold">{title} · 단계별 자체 시범</p>
  <p className="mt-2 text-xs">{intro}  의료 처방이나 개인별 추천이 아닙니다. 전문가 자세 검수는 미실시이며 허리 질환 안전성을 보장하지 않습니다.</p>
  <label className="mt-3 block">시범 단계<select className="mt-1 min-h-11 w-full rounded border border-indigo-300 bg-white px-2" value={stage} onChange={e=>setStage(Number(e.target.value))}>{stages.map((s,i)=><option key={s.id} value={i}>{i+1}. {s.name}</option>)}</select></label>
  <div className="mt-2 flex gap-3">
   <button type="button" className="min-h-11 rounded border border-indigo-300 px-3 disabled:opacity-50" disabled={stage===0} onClick={()=>setStage(n=>n-1)}>이전 단계</button>
   <button type="button" className="min-h-11 rounded border border-indigo-300 px-3 disabled:opacity-50" disabled={stage===stages.length-1} onClick={()=>setStage(n=>n+1)}>다음 단계</button>
  </div>
  <p className="mt-2 text-xs">단계는 자동으로 바뀌지 않습니다. 자세를 다시 준비한 뒤 재생하세요. 단계 변경 시 항상 정지합니다.</p>
  <StagePlayer key={stages[stage].id} index={stage} stage={stages[stage]} renderFigure={renderFigure}/>
 </section>;
}
function StagePlayer({index,stage,renderFigure}:{index:number;stage:MotionStage;renderFigure:Props["renderFigure"]}){
 const [playing,setPlaying]=useState(false),[progress,setProgress]=useState(0),[loop,setLoop]=useState(false),[slow,setSlow]=useState(false),[reduced,setReduced]=useState(false);
 const position=useRef(0);
 const panel=useRef<HTMLDivElement>(null);
 useMotionDisclosurePause(panel,setPlaying);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const preference=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};
  const visibility=()=>{if(document.hidden)setPlaying(false);};
  preference();media.addEventListener('change',preference);document.addEventListener('visibilitychange',visibility);
  return()=>{media.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{
  if(!playing||reduced)return;
  let frame=0,last:number|undefined;
  const tick=(now:number)=>{
   if(document.hidden){setPlaying(false);return;}
   const next=advanceMotion(position.current,last===undefined?0:now-last,slow,loop);
   last=now;position.current=next.progress;setProgress(next.progress);
   if(next.ended)setPlaying(false);else frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[playing,reduced,slow,loop]);
 const seek=(value:number)=>{setPlaying(false);position.current=clampProgress(value);setProgress(position.current);};
 return <>
  {renderFigure(stage.id,progress,stage.name)}
  <p className="font-semibold">{index+1}. {stage.name}</p>
  <p className="mt-2">{stage.guide}</p>
  <p className="mt-2 text-xs">통증·저림·어지럼·균형 불안정이 있으면 중단하세요. 그림의 확대·속도·크기·반복은 운동 처방이 아닙니다.</p>
  <div ref={panel} className="mt-3 flex flex-wrap items-center gap-3">
   <button type="button" className="min-h-11 rounded bg-indigo-700 px-3 text-white disabled:opacity-50" aria-pressed={playing} disabled={reduced||stage.isStatic} onClick={()=>{if(position.current>=1){position.current=0;setProgress(0);}setPlaying(v=>!v);}}>{playing?'일시정지':'재생'}</button>
   <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={stage.isStatic} checked={loop} onChange={e=>setLoop(e.target.checked)}/>반복</label>
   <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={stage.isStatic} checked={slow} onChange={e=>setSlow(e.target.checked)}/>느리게 (0.5배)</label>
  </div>
  {reduced&&<p className="mt-2 text-xs">동작 줄이기 설정에 따라 정지합니다. 슬라이더로 자세를 확인하세요.</p>}
  <label className="mt-3 block">동작 위치 (조정하면 정지)<input aria-label="동작 위치" className="block min-h-11 w-full" type="range" min="0" max="1" step=".01" value={progress} onChange={e=>seek(Number(e.target.value))}/></label>
  <div className="mt-2 flex flex-wrap gap-3">
   <button type="button" className="min-h-11 rounded border border-indigo-300 px-3" onClick={()=>seek(0)}>시작 자세 보기</button>
   <button type="button" className="min-h-11 rounded border border-indigo-300 px-3" onClick={()=>seek(stage.peak)}>중간 자세 보기</button>
  </div>
 </>;
}
