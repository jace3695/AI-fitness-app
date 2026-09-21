'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import AppIdentity from '@/app/components/AppIdentity';
import { supabase } from '@/app/lib/supabase';
import { useGrowthData } from '../../useGrowthData';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import { getLocalDateKey } from '@/utils/dateKey';
import { TYPING_BASICS_ID, TYPING_LESSONS, TYPING_KEYS, KEY_ROWS, FINGERS, emptyTypingAttempt, pressTypingKey, typingKeyAccuracy, completedTypingBasics } from '@/app/data/typingBasics';

const colors = ['bg-rose-50 text-rose-900','bg-amber-50 text-amber-900','bg-emerald-50 text-emerald-900','bg-sky-50 text-sky-900','bg-indigo-50 text-indigo-900','bg-teal-50 text-teal-900','bg-orange-50 text-orange-900','bg-pink-50 text-pink-900','bg-gray-100 text-gray-800'];
export default function TypingBasicsPage() {
  const growth=useGrowthData();
  const owner=growth.user?.id;
  const [index,setIndex]=useState(0);
  const [attempt,setAttempt]=useState(emptyTypingAttempt);
  const [started,setStarted]=useState<number|null>(null);
  const [ended,setEnded]=useState<number|null>(null);
  const [active,setActive]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [checks,setChecks]=useState([false,false]);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [notice,setNotice]=useState('');
  const [completed,setCompleted]=useState(new Set<string>());
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const pad=useRef<HTMLButtonElement>(null);
  const pending=useRef<Parameters<typeof growth.saveSession>[0]|null>(null);
  const lesson=TYPING_LESSONS[index];
  const expected=lesson.keys[attempt.position];
  const key=expected ? TYPING_KEYS[expected] : null;
  const finished=attempt.position===lesson.keys.length;
  const routine=growth.routines.find(row=>row.category==='typing');
  const dirty=attempt.attempts>0 && !saved;
  useUnsavedChanges(dirty);
  useEffect(()=>{
    if(!owner || !supabase) return;
    const client=supabase;let cancelled=false;
    setReady(false);setError('');
    void(async()=>{
      try {
        const rows:Parameters<typeof completedTypingBasics>[0]=[];
        for(let offset=0;;offset+=500){
          const result=await client.from('growth_sessions').select('source,status,metrics').eq('user_id',owner).eq('source','typing').contains('metrics',{courseId:TYPING_BASICS_ID}).order('id').range(offset,offset+499).abortSignal(AbortSignal.timeout(15000));
          if(result.error) throw result.error;
          rows.push(...(result.data??[]));if((result.data?.length??0)<500) break;
        }
        if(cancelled) return;
        const done=completedTypingBasics(rows);setCompleted(done);setIndex(Math.max(0,TYPING_LESSONS.findIndex(item=>!done.has(item.id))));setReady(true);
      } catch {if(!cancelled) setError('자리 연습 진도를 불러오지 못했어요. 다시 불러와 주세요.');}
    })();
    return()=>{cancelled=true;};
  },[owner,reload]);
  function reset(next=index){
    if(saving || pending.current && !saved) return;
    if(dirty && !window.confirm('저장하지 않은 이번 연습을 지우고 이동할까요?')) return;
    setIndex(next);setAttempt(emptyTypingAttempt());setStarted(null);setEnded(null);setActive(false);setFeedback('');setChecks([false,false]);setSaved(false);setNotice('');pending.current=null;
  }
  function press(event:KeyboardEvent<HTMLButtonElement>){
    if(event.code==='Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if(!active || finished || saving || saved || pending.current || event.repeat || event.shiftKey) return;
    const next=pressTypingKey(attempt,lesson.keys,event.code);
    if(next===attempt) return;
    const now=Date.now();if(started===null)setStarted(now);
    setFeedback(next.position===attempt.position ? `다시 해봐요. ${key?.label} · ${FINGERS[key!.finger]}` : '좋아요. 손가락을 기본 자리로 돌려놓아요.');setAttempt(next);
    if(next.position===lesson.keys.length){setEnded(now);setActive(false);}
  }
  async function save(){
    if(!owner || !routine || !ready || !growth.dataReady || !finished || !checks.every(Boolean) || saving || saved || started===null || ended===null) return;
    setSaving(true);
    const seconds=Math.max(1,Math.round((ended-started)/1000));
    pending.current??={id:crypto.randomUUID(),routineId:routine.id,sessionDate:getLocalDateKey(),status:'completed',source:'typing',plannedMinutes:5,actualMinutes:Math.round(seconds/60),memo:`타자 자리 ${index+1}강 · ${lesson.title}`,startedAt:new Date(started).toISOString(),endedAt:new Date(ended).toISOString(),metrics:{courseId:TYPING_BASICS_ID,lessonId:lesson.id,lessonCompleted:true,keyPresses:attempt.attempts,correctKeyPresses:attempt.position,keyAccuracy:typingKeyAccuracy(attempt),mistakeKeys:attempt.mistakes,elapsedSeconds:seconds,selfChecks:checks,inputMode:'physical-key-position'}};
    try {
      const result=await growth.saveSession(pending.current);
      if(result.error) throw result.error;
      setSaved(true);setCompleted(previous=>new Set([...previous,lesson.id]));setNotice('자리 연습 기록을 저장했어요.');
    } catch {setNotice('저장 결과를 확인하지 못했어요. 같은 기록 다시 확인을 눌러 주세요.');}
    finally{setSaving(false);}
  }
  const frozen=saving || !!pending.current;
  return <main className="min-h-dvh bg-yeoni-bg pb-32 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="타자 자리 연습" subtitle="손가락 자리부터 천천히"/><Link href="/growth/typing" className="rounded-xl bg-gray-100 px-3 py-2 text-sm">문장 연습</Link></div></header>
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <section className="rounded-3xl bg-white p-5" aria-label="자리 연습 진도"><h1 className="text-2xl font-bold">빠르게 치기 전에, 편한 자리부터</h1><p className="mt-3 text-sm leading-6">PC·외장 키보드의 QWERTY / 한글 두벌식 기준이에요. 휴대폰 터치 키보드 대신 실제 키보드를 연결해 주세요. 한/영 상태와 관계없이 키의 위치로 연습해요.</p><p className="mt-3 font-bold">{completed.size} / {TYPING_LESSONS.length} 수업 완료</p>{!ready && !error && <p role="status">진도 불러오는 중…</p>}{error && <p role="alert">{error} <button onClick={()=>setReload(value=>value+1)} className="min-h-11 underline">진도 다시 불러오기</button></p>}
        <details className="mt-3"><summary className="cursor-pointer py-2 font-bold">전체 단계 보기</summary><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{TYPING_LESSONS.map((item,i)=><button key={item.id} aria-current={i===index?'step':undefined} disabled={!ready || saving || (!!pending.current && !saved)} onClick={()=>reset(i)} className={`min-h-11 rounded-xl px-3 py-2 text-left text-sm ${i===index?'bg-indigo-100':'bg-gray-50'}`}>{i+1}. {item.title}{completed.has(item.id)?' · 완료':''}</button>)}</div></details>
      </section>
      <section className="rounded-3xl bg-white p-5"><h2 className="font-bold">매번 3~5분, 가볍게 연습해요</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6"><li>왼손은 A S D F, 오른손은 J K L ;. 검지로 F·J의 돌기를 찾아요.</li><li>어깨와 손의 힘을 빼고, 키가 입력될 만큼만 눌러요. 손가락을 높이 들거나 바닥까지 세게 치지 않아요.</li><li>키를 누른 뒤 기본 자리로 돌아와요. 손이 굳거나 불편하면 쉬어요.</li></ul><p className="mt-3 text-xs text-gray-500">타건음은 키보드 구조에도 영향을 받아요. 앱은 실제 손가락·누르는 힘·소리를 측정하지 않아요. 처음에는 속도 목표 없이 정확도 95%를 연습 목표로 삼아요. 연습 시간은 첫 키부터 마지막 키까지이며 중간에 쉰 시간도 포함돼요.</p></section>
      <section className="rounded-3xl bg-white p-4 sm:p-6"><h2 className="text-xl font-bold">{index+1}강 · {lesson.title}</h2><p className="mt-2 text-sm leading-6">{lesson.goal}</p>
        <p className="mt-4 break-words rounded-xl bg-gray-50 p-3 font-mono text-lg tracking-widest" aria-label="연습 순서">{Array.from(lesson.keys).map((char,i)=><span key={i} className={i<attempt.position?'text-emerald-700':i===attempt.position?'rounded bg-indigo-200 font-bold':''}>{char===' '?'␣':char.toUpperCase()}</span>)}</p>
        <div className="mt-4 rounded-2xl bg-indigo-50 p-4 text-center" aria-label="다음 키 안내">{key?<><p className="text-sm">다음 키 · {attempt.position+1} / {lesson.keys.length}</p><strong className="mt-1 block text-3xl">{key.label}{key.label!==key.korean?` · ${key.korean}`:''}</strong><p className="mt-2 text-lg font-bold">{FINGERS[key.finger]}</p></>:<strong>한 바퀴 완료! 힘과 손가락을 점검해요.</strong>}</div>
        <div className="mt-4 space-y-1" aria-label="손가락별 키보드 안내">{KEY_ROWS.map((row,r)=><div key={row} className="grid grid-cols-10 gap-1" style={{paddingLeft:r*4}}>{Array.from(row).map(char=>{const item=TYPING_KEYS[char];return <div key={char} title={`${item.label} ${FINGERS[item.finger]}`} aria-current={expected===char?'true':undefined} className={`rounded-md py-2 text-center text-xs ${colors[item.finger]} ${expected===char?'ring-2 ring-indigo-700':''}`}><b className={char==='f'||char==='j'?'underline decoration-2 underline-offset-4':''}>{item.label}</b><span className="mt-1 block">{item.korean}</span></div>;})}</div>)}<div className={`mx-auto w-1/2 rounded-md bg-gray-100 p-2 text-center text-xs ${expected===' '?'ring-2 ring-indigo-700':''}`}>Space · 엄지</div></div>
        <button ref={pad} type="button" aria-label="키보드 자리 연습 입력" disabled={!ready || finished || frozen || saved} onClick={()=>{setActive(true);pad.current?.focus();}} onBlur={()=>setActive(false)} onKeyDown={press} className="mt-5 min-h-16 w-full rounded-2xl bg-indigo-600 p-4 font-bold text-white focus:ring-4 focus:ring-indigo-300 disabled:bg-gray-300">{finished?'입력 완료':active?'이제 실제 키보드를 눌러 주세요':'여기를 눌러 연습 시작 / 이어하기'}</button>
        <p className="mt-2 text-xs text-gray-500">틀린 키는 다음으로 넘어가지 않아요. 길게 누르기는 한 번만 세고, Tab으로 연습 영역을 벗어날 수 있어요.</p><p role="status" className="mt-3 min-h-6 text-sm text-indigo-800">{feedback}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm"><span>첫 시도 포함 정확도 <b>{typingKeyAccuracy(attempt)}%</b></span><span>틀린 키 <b>{attempt.attempts-attempt.position}회</b></span><span>진행 <b>{attempt.position}/{lesson.keys.length}</b></span></div>
        {Object.keys(attempt.mistakes).length>0 && <p className="mt-2 text-sm">다시 익힐 자리: {Object.entries(attempt.mistakes).map(([char,n])=>`${TYPING_KEYS[char].label} ${n}회`).join(' · ')}</p>}
        {finished && <fieldset disabled={frozen} className="mt-5 space-y-3"><legend className="mb-2 font-bold">직접 점검해 주세요</legend>{['안내된 손가락으로 누르고 기본 자리로 돌아왔어요.','키를 세게 내리치지 않고 손의 힘을 빼 보았어요.'].map((label,i)=><label key={label} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={checks[i]} onChange={event=>setChecks(old=>old.map((v,j)=>j===i?event.target.checked:v))}/>{label}</label>)}</fieldset>}
        <div className="mt-5 flex flex-wrap gap-3"><button disabled={saving || (!!pending.current && !saved)} onClick={()=>reset()} className="min-h-12 rounded-xl bg-gray-100 px-4">같은 자리 다시 연습</button><button disabled={!finished || !checks.every(Boolean) || !routine || !ready || !growth.dataReady || saving || saved} onClick={()=>void save()} className="min-h-12 rounded-xl bg-indigo-600 px-4 font-bold text-white disabled:bg-gray-300">{saved?'저장 완료':saving?'저장 중…':pending.current?'같은 기록 다시 확인':'자리 연습 저장'}</button>{saved && <button onClick={()=>reset(Math.max(0,TYPING_LESSONS.findIndex(item=>!completed.has(item.id))))} className="min-h-12 rounded-xl bg-indigo-50 px-4 font-bold">{completed.size===TYPING_LESSONS.length?'처음부터 복습':'다음 미완료 수업'}</button>}</div>
        {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}{!growth.loading && !routine && <p className="mt-3 text-sm">자기계발 홈에서 타자 루틴을 추가하면 기록을 저장할 수 있어요.</p>}
        <Link href="/growth/typing" className="mt-5 inline-block py-3 font-bold text-indigo-700 underline">자리가 편해졌다면 문장 연습으로</Link>
      </section>
    </div>
  </main>;
}
