'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {dietPatternToday} from '../data/dietPatterns';
import {clockMinutes,completedWorkoutTime,confirmWorkoutTime,validWorkoutTime,workoutMealGap,writeWorkoutTime,type TimeRequest,type WorkoutTime} from '../data/workoutTimes';
import {useUnsavedChanges} from '@/components/useUnsavedChanges';
const button='min-h-11 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 disabled:opacity-50';
export default function WorkoutTimes({initialDate,meals,fixedDate=false,onPendingChange}:{initialDate:string;meals?:Record<string,unknown>;fixedDate?:boolean;onPendingChange?:(pending:boolean)=>void}) {
  const [date,setDate]=useState(initialDate),[owner,setOwner]=useState('');
  const [row,setRow]=useState<WorkoutTime|null>(null),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [review,setReview]=useState<(TimeRequest&{uncertain?:boolean})|null>(null),[busy,setBusy]=useState(false);
  const alive=useRef(false),generation=useRef(0),working=useRef(false);
  const dirty=start!==(row?.starts_at??'')||end!==(row?.ends_at??'');
  useUnsavedChanges(dirty||!!review);
  useEffect(()=>{onPendingChange?.(dirty||!!review);return()=>onPendingChange?.(false);},[dirty,review,onPendingChange]);
  async function load(user:string,day:string) {
    if(!supabase)return;
    const version=++generation.current;setLoading(true);setError('');
    try {
      const result=await supabase.from('workout_actual_times').select('*').eq('user_id',user).eq('recorded_on',day).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
      if(!alive.current||version!==generation.current)return;
      if(result.error||result.data&&!validWorkoutTime(result.data))throw Error('load');
      setRow(result.data);setStart(result.data?.starts_at??'');setEnd(result.data?.ends_at??'');
    }catch{if(alive.current&&version===generation.current){setRow(null);setError('운동 시각을 불러오지 못했어요. 다시 불러와 주세요.');}}
    finally{if(alive.current&&version===generation.current)setLoading(false);}
  }
  useEffect(()=>{
    alive.current=true;generation.current++;setDate(initialDate);let active=true;
    if(!supabase){setError('로그인 연결을 확인해 주세요.');setLoading(false);return;}
    void supabase.auth.getUser().then(({data,error})=>{if(!active)return;if(error||!data.user){setError('로그인을 확인해 주세요.');setLoading(false);return;}setOwner(data.user.id);void load(data.user.id,initialDate);}).catch(()=>{if(active){setError('로그인 연결을 확인해 주세요.');setLoading(false);}});
    return()=>{active=false;alive.current=false;};
  },[initialDate]);
  const disabled=loading||!!error||busy||!!review||!owner;
  const prepare=(remove=false)=>{
    const after=remove?null:{user_id:owner,recorded_on:date,starts_at:start,ends_at:end,revision:crypto.randomUUID()};
    if(after&&!completedWorkoutTime(after)){setNotice('이미 지난 같은 날짜의 시작·종료 시각을 입력해 주세요. 종료는 시작보다 늦어야 합니다.');return;}
    if(remove&&!row)return;
    setNotice('');setReview({before:row,after});
  };
  const run=async()=>{
    if(!supabase||!review||working.current)return;
    working.current=true;setBusy(true);
    const result=review.uncertain?await confirmWorkoutTime(supabase,owner,review):await writeWorkoutTime(supabase,owner,review);
    if(!alive.current)return;
    if(result==='uncertain'){setReview({...review,uncertain:true});setNotice('저장 결과를 확인하지 못했어요. 다시 쓰지 않고 서버 결과만 확인합니다.');}
    else{setReview(null);setNotice(result==='confirmed'?'운동 시각을 반영했습니다. 운동 완료·상세 기록은 바뀌지 않았습니다.':result==='invalid'?'시각과 날짜를 다시 확인해 주세요.':'기록이 바뀌었거나 요청이 반영되지 않았어요. 최신 값을 확인한 뒤 다시 진행해 주세요.');await load(owner,date);}
    working.current=false;setBusy(false);
  };
  const meal=meals?.[date];const mealClock=meal&&typeof meal==='object'&&!Array.isArray(meal)?(meal as Record<string,unknown>).lastMealTime:undefined;
  const gap=row?workoutMealGap(row,mealClock):null;
  return <section aria-label="실제 운동 시각" className="my-4 min-w-0 rounded-2xl border border-gray-100 bg-white p-4 text-gray-900 shadow-sm">
    <h3 className="text-[15px] font-bold">실제 운동 시각</h3>
    <p className="mt-2 text-xs leading-5 text-gray-500">한국 날짜 기준, 하루 한 운동 구간을 직접 기록합니다. 자정을 넘는 구간은 지원하지 않습니다. 운동 완료와 별도로 저장합니다.</p>
    <label className="mt-3 block text-xs font-bold">운동 시각 날짜<input aria-label="운동 시각 날짜" type="date" min="1900-01-01" max={dietPatternToday()} value={date} disabled={disabled||dirty||fixedDate} onChange={e=>{if(!e.target.value)return;setDate(e.target.value);setNotice('');void load(owner,e.target.value);}} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border p-2"/></label>
    {loading?<p className="mt-3 text-xs">운동 시각을 불러오는 중…</p>:error?<p role="alert" className="mt-3 text-xs text-amber-800">{error}</p>:<p className="mt-3 text-xs">{row?`저장된 구간 ${row.starts_at} ~ ${row.ends_at} · ${clockMinutes(row.ends_at)!-clockMinutes(row.starts_at)!}분 (휴식 포함 경과 시간)`:'저장된 운동 시각이 없습니다.'}</p>}
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold">운동 시작 시각<input aria-label="운동 시작 시각" type="time" value={start} disabled={disabled} onChange={e=>setStart(e.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border p-2"/></label>
      <label className="text-xs font-bold">운동 종료 시각<input aria-label="운동 종료 시각" type="time" value={end} disabled={disabled} onChange={e=>setEnd(e.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border p-2"/></label>
    </div>
    <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={()=>prepare()}>시각 저장 검토</button><button className={button} disabled={disabled||!row} onClick={()=>prepare(true)}>시각 삭제 검토</button><button className={button} disabled={loading||busy||!!review||!owner} onClick={()=>{setNotice('');void load(owner,date);}}>입력 취소·다시 불러오기</button></div>
    {meals&& !loading&&!error&&<p className="mt-3 text-xs leading-5">{gap?`${date} · ${gap}`:row?'마지막 식사 시각이 없어 간격을 계산하지 않습니다.':'운동 시각을 저장하면 같은 날짜의 마지막 식사 시각과 비교합니다.'} 저장한 시각만 비교하며, 식사 적절성이나 운동 효과를 판단하지 않습니다.</p>}
    {review&&<div role="region" aria-label="운동 시각 확인" className="mt-3 rounded-xl bg-violet-50 p-3 text-xs leading-5"><p className="font-bold">{date} · {review.after?'시각 저장 확인':'시각 삭제 확인'}</p><p>기존 {review.before?`${review.before.starts_at} ~ ${review.before.ends_at}`:'미기록'} → {review.after?`${review.after.starts_at} ~ ${review.after.ends_at}`:'미기록'}</p><p>운동 완료·유산소·세트·메모·식단 기록은 유지합니다.</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void run()}>{busy?'결과 확인 중…':review.uncertain?'운동 시각 서버 결과 재확인':'확인 후 시각 반영'}</button>{!review.uncertain&&<button className={button} disabled={busy} onClick={()=>setReview(null)}>시각 검토 취소</button>}</div></div>}
    {notice&&<p role="status" className="mt-3 text-xs leading-5 text-violet-800">{notice}</p>}
  </section>;
}
