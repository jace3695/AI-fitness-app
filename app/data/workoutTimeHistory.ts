import {clockMinutes,validWorkoutTime,workoutMealGap,type WorkoutTime} from './workoutTimes.ts';

export function workoutHistoryPeriod(today:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(`${today}T12:00:00Z`))||new Date(`${today}T12:00:00Z`).toISOString().slice(0,10)!==today)return null;
  const anchor=Date.parse(`${today}T12:00:00Z`);
  const offset=(days:number)=>new Date(anchor-days*86400000).toISOString().slice(0,10);
  return {start:offset(28),end:offset(1)};
}

export function workoutTimeHistory(rows:unknown,owner:string,today:string,meals:Record<string,unknown>) {
  const period=workoutHistoryPeriod(today);
  if(!period||!Array.isArray(rows)||rows.length>28)return null;
  const dates=new Set<string>();
  for(const row of rows){
    if(!validWorkoutTime(row)||row.user_id!==owner||row.recorded_on<period.start||row.recorded_on>period.end||dates.has(row.recorded_on))return null;
    dates.add(row.recorded_on);
  }
  const days=(rows as WorkoutTime[]).map(row=>{
    const meal=meals[row.recorded_on];
    const values=meal&&typeof meal==='object'&&!Array.isArray(meal)?meal as Record<string,unknown>:{};
    const clock=values.lastMealTime;
    const protein=typeof values.proteinTotal==='number'&&Number.isFinite(values.proteinTotal)&&values.proteinTotal>=0?values.proteinTotal:null;
    const afterMeal=values.afterWorkoutMeal==='yes'?'식사함':values.afterWorkoutMeal==='no'?'식사 안 함':'미응답';
    return {protein,afterMeal,date:row.recorded_on,start:row.starts_at,end:row.ends_at,minutes:clockMinutes(row.ends_at)!-clockMinutes(row.starts_at)!,meal:clockMinutes(clock)===null?null:clock as string,gap:workoutMealGap(row,clock)};
  }).sort((a,b)=>b.date.localeCompare(a.date));
  return {...period,days,unrecorded:28-days.length,missingMeal:days.filter(day=>day.meal===null).length};
}
