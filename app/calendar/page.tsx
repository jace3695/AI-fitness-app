"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "../components/AuthGate";
import AppIdentity from "../components/AppIdentity";
import GoogleCalendarPanel, { type GoogleCalendarEvent } from "../components/GoogleCalendarPanel";
import { supabase } from "../lib/supabase";
import { readRecordStores, type DietDayRecord } from "../data/recordStorage";
import { getWorkoutRecord, isWorkoutPerformed, type WorkoutDayRecord } from "../data/workoutCompletion";

type Task={id:string;title:string;due_at:string|null;status:string};
type Budget={id:string;date:string;amount:number|string;category?:string;description?:string;memo?:string};
type DayInfo={workout?:WorkoutDayRecord;diet?:DietDayRecord;water?:number;note?:string;language?:{count:number;ids:string[]};tasks?:Task[];budget?:Budget[];google?:GoogleCalendarEvent[]};
const LANGUAGE:Record<string,string>={kana:"가나",words:"단어",sentences:"문장",grammar:"문법",review:"복습"};
function parse(value:string|null){try{return value?JSON.parse(value) as Record<string,unknown>:{};}catch{return {};}}

function UnifiedCalendar(){
 const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)}),[info,setInfo]=useState<Record<string,DayInfo>>({}),[google,setGoogle]=useState<GoogleCalendarEvent[]>([]),[selected,setSelected]=useState("");
 const monthKey=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,"0")}`;
 const onGoogle=useCallback((events:GoogleCalendarEvent[])=>setGoogle(events),[]);
 useEffect(()=>{
  let active=true;
  const load=async()=>{
   const next:Record<string,DayInfo>={},stores=readRecordStores();
   Object.entries(stores.workouts).forEach(([date,value])=>{if(date.startsWith(monthKey)&&isWorkoutPerformed(value))next[date]={...next[date],workout:getWorkoutRecord(value),note:stores.notes[date]};});
   Object.entries(stores.diet).forEach(([date,value])=>{if(date.startsWith(monthKey)&&Object.keys(value).length)next[date]={...next[date],diet:value,water:stores.water[date]};});
   Object.entries(parse(localStorage.getItem("dailyLearningHistory"))).forEach(([date,value])=>{if(!date.startsWith(monthKey)||!value||typeof value!=="object")return;const row=value as Record<string,unknown>,ids=Array.isArray(row.completedIds)?row.completedIds.filter((id):id is string=>typeof id==="string"):[],count=Number(row.completedCount||ids.length);if(count)next[date]={...next[date],language:{count,ids}};});
   if(supabase){
    const {data:{user}}=await supabase.auth.getUser();
    if(user){const end=`${monthKey}-${new Date(month.getFullYear(),month.getMonth()+1,0).getDate()}`;const [tasks,budget]=await Promise.all([supabase.from("assistant_items").select("id,title,due_at,status").eq("user_id",user.id).gte("due_at",`${monthKey}-01T00:00:00+09:00`).lte("due_at",`${end}T23:59:59+09:00`).neq("status","cancelled"),supabase.from("budget_transactions").select("*").eq("user_id",user.id).gte("date",`${monthKey}-01`).lte("date",end)]);(tasks.data as Task[]|null)?.forEach(task=>{const date=task.due_at?.slice(0,10);if(date)next[date]={...next[date],tasks:[...(next[date]?.tasks||[]),task]};});(budget.data as Budget[]|null)?.forEach(item=>{next[item.date]={...next[item.date],budget:[...(next[item.date]?.budget||[]),item]};});}
   }
   if(active)setInfo(next);
  };
  void load();return()=>{active=false};
 },[month,monthKey]);
 const merged=useMemo(()=>{const next={...info};google.forEach(event=>next[event.date]={...next[event.date],google:[...(next[event.date]?.google||[]),event]});return next},[google,info]);
 const days=useMemo(()=>[...Array(new Date(month.getFullYear(),month.getMonth(),1).getDay()).fill(null),...Array.from({length:new Date(month.getFullYear(),month.getMonth()+1,0).getDate()},(_,i)=>i+1)],[month]),row=selected?merged[selected]:undefined;
 const workout=row?.workout?[row.workout.workoutRoutineName||row.workout.workoutPlanName,...(row.workout.workoutExerciseNames||[]),row.workout.cardioDone?`${row.workout.cardioType||"유산소"} ${row.workout.cardioMinutes||0}분`:"",row.workout.workoutMemo||row.note].filter(Boolean) as string[]:[];
 const diet=row?.diet?[row.diet.dietStatus,row.diet.fastingRecordStatus?`공복 ${row.diet.fastingRecordStatus}`:"",row.water?`물 ${row.water.toLocaleString()}mL`:"",row.diet.dietMemo].filter((v):v is string=>typeof v==="string"&&!!v):[];
 const Card=({title,href,tone,children}:{title:string;href:string;tone:string;children:React.ReactNode})=><article className={`rounded-2xl border p-4 ${tone}`}><div className="flex justify-between"><b>{title}</b><Link href={href} className="text-xs font-bold">앱 열기 →</Link></div><div className="mt-2 space-y-1 text-sm text-gray-700">{children}</div></article>;
 return <main className="min-h-dvh bg-[#F6F7FB] pb-28 text-[#242231]"><div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-10"><AppIdentity kind="calendar" title="통합 달력" subtitle="모든 앱의 날짜별 기록"/><GoogleCalendarPanel monthKey={monthKey} onEvents={onGoogle}/><section className="mt-4 rounded-3xl bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center justify-between"><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">←</button><h2 className="text-xl font-bold">{month.getFullYear()}년 {month.getMonth()+1}월</h2><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">→</button></div><div className="mt-5 grid grid-cols-7 text-center text-xs font-bold text-gray-400">{"일월화수목금토".split("").map(d=><span key={d}>{d}</span>)}</div><div className="mt-2 grid grid-cols-7 gap-1.5">{days.map((day,index)=>{if(!day)return <span key={`e${index}`}/>;const date=`${monthKey}-${String(day).padStart(2,"0")}`,r=merged[date];return <button key={date} onClick={()=>setSelected(date)} className={`min-h-20 rounded-2xl border p-2 text-left ${selected===date?"border-violet-600 bg-violet-50":"border-gray-100 bg-gray-50"}`}><b>{day}</b><span className="mt-1 flex flex-wrap gap-1 text-[10px]">{r?.tasks?.length?<i className="not-italic text-violet-700">할{r.tasks.length}</i>:null}{r?.workout?<i className="not-italic text-blue-700">운</i>:null}{r?.diet?<i className="not-italic text-emerald-700">식</i>:null}{r?.language?<i className="not-italic text-amber-700">언{r.language.count}</i>:null}{r?.budget?.length?<i className="not-italic text-orange-700">가{r.budget.length}</i>:null}{r?.google?.length?<i className="not-italic text-sky-700">G{r.google.length}</i>:null}</span></button>})}</div></section>
 {selected?<section className="mt-4 rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">{selected} 기록 상세</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{row?.tasks?.length?<Card title="제이스 비서" href="/assistant" tone="border-violet-100 bg-violet-50">{row.tasks.map(x=><p key={x.id}>• {x.title} · {x.status==="completed"?"완료":"진행 중"}</p>)}</Card>:null}{row?.workout?<Card title="운동" href="/fitness" tone="border-blue-100 bg-blue-50">{(workout.length?workout:["운동 완료"]).map((x,i)=><p key={i}>• {x}</p>)}</Card>:null}{row?.diet?<Card title="식단" href="/diet" tone="border-emerald-100 bg-emerald-50">{(diet.length?diet:["식단 기록 완료"]).map((x,i)=><p key={i}>• {x}</p>)}</Card>:null}{row?.language?<Card title="언어 학습" href="/language" tone="border-amber-100 bg-amber-50"><p>{row.language.count}개 과정 완료</p><p>{row.language.ids.map(id=>LANGUAGE[id]||id).join(" · ")}</p></Card>:null}{row?.budget?.length?<Card title="가계부" href="/budget" tone="border-orange-100 bg-orange-50">{row.budget.map(x=><p key={x.id}>• {x.category||x.description||x.memo||"거래"} · {Number(x.amount).toLocaleString()}원</p>)}</Card>:null}{row?.google?.length?<Card title="Google Calendar" href="/calendar" tone="border-sky-100 bg-sky-50">{row.google.map(x=><p key={x.id}>• {x.startLabel} {x.htmlLink?<a className="font-bold text-blue-700 underline" href={x.htmlLink} target="_blank" rel="noreferrer">{x.title}</a>:x.title}</p>)}</Card>:null}</div>{!row?<p className="mt-4 text-sm text-gray-400">이 날짜에 저장된 기록이 없습니다.</p>:null}</section>:null}</div></main>;
}
export default function Page(){return <AuthGate><UnifiedCalendar/></AuthGate>}
