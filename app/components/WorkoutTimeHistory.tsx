'use client';
import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {workoutHistoryPeriod,workoutTimeHistory} from '../data/workoutTimeHistory';
import type {WorkoutTime} from '../data/workoutTimes';

export default function WorkoutTimeHistory({today,meals}:{today:string;meals:Record<string,unknown>}) {
  const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0);
  const [result,setResult]=useState<{owner:string;rows:WorkoutTime[];today:string}|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    let active=true;const controller=new AbortController();
    setLoading(true);setError('');setResult(null);
    void(async()=>{
      try{
        if(!supabase)throw Error('auth');
        const auth=await supabase.auth.getUser();
        if(auth.error||!auth.data.user)throw Error('auth');
        const owner=auth.data.user.id,period=workoutHistoryPeriod(today);
        if(!period)throw Error('date');
        const {data,error}=await supabase.from('workout_actual_times').select('*').eq('user_id',owner).gte('recorded_on',period.start).lte('recorded_on',period.end).order('recorded_on',{ascending:false}).limit(29).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
        if(error||!workoutTimeHistory(data,owner,today,{}))throw Error('read');
        if(active)setResult({owner,rows:data as WorkoutTime[],today});
      }catch{if(active)setError('최근 운동 시각을 불러오지 못했어요. 기록 없음으로 판단하지 않습니다. 다시 불러와 주세요.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;controller.abort();};
  },[open,refresh,today]);
  const summary=result?.today===today?workoutTimeHistory(result.rows,result.owner,today,meals):null;
  return <section aria-label="최근 운동·식사 시각" className="my-4 min-w-0 rounded-2xl border border-gray-100 bg-white p-4 text-gray-900 shadow-sm">
    <h3 className="text-[15px] font-bold">최근 운동·식사 시각</h3>
    <p className="mt-2 text-xs leading-5 text-gray-500">어제까지 최근 28일의 직접 저장한 운동 구간과 마지막 식사 시각을 함께 봅니다. 기록 없는 날을 휴식으로 판단하지 않습니다.</p>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="mt-3 min-h-11 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">{open?'최근 시각 기록 접기':'최근 시각 기록 보기'}</button>
    {open&&<div className="mt-3 text-xs leading-5">
      <button type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)} className="min-h-11 rounded-xl bg-gray-100 px-3 py-2 font-bold disabled:opacity-50">최근 시각 다시 불러오기</button>
      {loading?<p role="status">최근 운동 시각을 불러오는 중…</p>:error?<p role="alert" className="mt-2 text-amber-800">{error}</p>:summary&&<>
        <p className="mt-3 font-bold">{summary.start} ~ {summary.end}</p>
        <p>운동 시각 기록 {summary.days.length}일 · 시각 미기록 {summary.unrecorded}일</p>
        <p>운동 시각 기록 중 마지막 식사 시각 미기록 {summary.missingMeal}일</p>
        {!summary.days.length?<p className="mt-2">이 기간에 저장된 운동 시각이 없습니다.</p>:<ul className="mt-3 space-y-3">{summary.days.map(day=><li key={day.date} className="rounded-xl bg-gray-50 p-3">
          <p className="font-bold">{day.date}</p><p>운동 {day.start} ~ {day.end} · {day.minutes}분 (휴식 포함 경과 시간)</p>
          <p>마지막 식사 {day.meal??'시각 미기록'}</p><p>{day.gap??'식사 시각이 없어 간격을 계산하지 않습니다.'}</p>
        </li>)}</ul>}
        <p className="mt-3 text-gray-500">저장된 같은 날짜의 시각만 비교합니다. 다른 식사나 단백질 섭취 시각으로 간주하지 않으며, 식사 적절성·운동 효과를 판정하지 않습니다. 위 입력칸의 미저장 내용은 포함하지 않습니다.</p>
      </>}
    </div>}
  </section>;
}
