import type { WorkoutCompletionStore } from './workoutCompletion.ts';
import { getWorkoutRecord } from './workoutCompletion.ts';
import type { DailyConditionStore } from './recoveryMode.ts';
import { workoutHistoryPeriod } from './workoutTimeHistory.ts';

const validDate=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(`${date}T12:00:00Z`))&&new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date;
export function workoutEvidence(workouts:WorkoutCompletionStore,conditions:DailyConditionStore,today:string){
 const period=workoutHistoryPeriod(today);if(!period)return null;
 const days=Object.entries(workouts).filter(([date])=>validDate(date)&&date>=period.start&&date<=period.end).flatMap(([date,value])=>{
  const r=getWorkoutRecord(value);
  const status=r.workoutStatus??(r.workoutDone?'completed':Object.keys(r).some(key=>['workoutFatigue','workoutDifficulty','workoutPainArea','workoutLastSetRpe'].includes(key))?'unconfirmed':null);
  if(!status||!['completed','partial','stopped','unconfirmed'].includes(status))return [];
  const nextDate=new Date(Date.parse(`${date}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  const next=conditions[nextDate];
  const sets=(r.workoutExerciseRecords??[]).flatMap(exercise=>exercise.sets??[]);
  return [{date,status,back:r.workoutBackStatus??null,difficulty:r.workoutDifficulty??null,fatigue:typeof r.workoutFatigue==='number'&&r.workoutFatigue>=1&&r.workoutFatigue<=5?r.workoutFatigue:null,
   rpe:Number.isInteger(r.workoutLastSetRpe)&&r.workoutLastSetRpe!>=1&&r.workoutLastSetRpe!<=10?r.workoutLastSetRpe!:null,painArea:r.workoutPainArea??null,painExercise:r.workoutPainExercise??null,painSet:r.workoutPainSet??null,completedSets:sets.filter(s=>s.completed).length,recordedSets:sets.length,
   nextDate,nextSignals:next&&Array.isArray(next.signals)?next.signals:null}];
 }).sort((a,b)=>b.date.localeCompare(a.date));
 const last14=days.filter(day=>day.date>=new Date(Date.parse(`${today}T12:00:00Z`)-14*86400000).toISOString().slice(0,10));
 const count=(values:typeof days)=>({recorded:values.length,completed:values.filter(x=>x.status==='completed').length,partial:values.filter(x=>x.status==='partial').length,stopped:values.filter(x=>x.status==='stopped').length,backAnswers:values.filter(x=>x.back!==null).length,nextAnswers:values.filter(x=>x.nextSignals!==null).length});
 return {...period,days,recent:count(last14),previous:count(days.filter(day=>!last14.includes(day)))};
}
