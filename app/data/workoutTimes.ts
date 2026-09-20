import type { SupabaseClient } from '@supabase/supabase-js';
export type WorkoutTime = {user_id:string; recorded_on:string; starts_at:string; ends_at:string; revision:string};
export const clockMinutes=(clock:unknown):number|null => typeof clock==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? Number(clock.slice(0,2))*60+Number(clock.slice(3)) : null;
const uuid=(value:unknown)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validWorkoutTime(value:unknown):value is WorkoutTime {
  if(!value || typeof value!=='object') return false;
  const row=value as WorkoutTime;
  const date=row.recorded_on;
  const a=clockMinutes(row.starts_at), b=clockMinutes(row.ends_at);
  return uuid(row.user_id)&&uuid(row.revision)&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='1900-01-01'&&Number.isFinite(Date.parse(`${date}T12:00:00Z`))&&new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date&&a!==null&&b!==null&&a<b;
}
export function completedWorkoutTime(row:WorkoutTime,now=new Date()) {
  return validWorkoutTime(row)&&Date.parse(`${row.recorded_on}T${row.ends_at}:00+09:00`)<=now.getTime();
}
export function workoutMealGap(row:WorkoutTime,meal:unknown) {
  const m=clockMinutes(meal);
  if(!validWorkoutTime(row)||m===null) return null;
  const a=clockMinutes(row.starts_at)!,b=clockMinutes(row.ends_at)!;
  return m<=a ? `마지막 식사 ${a-m}분 후 운동 시작` : m>=b ? `운동 종료 ${m-b}분 후 마지막 식사` : '마지막 식사 시각이 운동 구간 안에 있습니다. 입력한 시각을 확인해 주세요.';
}
export type TimeRequest={before:WorkoutTime|null; after:WorkoutTime|null};
export type TimeResult='confirmed'|'uncertain'|'changed'|'invalid';
function validRequest(owner:string,request:TimeRequest) {
  const {before,after}=request;
  return !!(before||after)&&[before,after].every(r=>r===null || validWorkoutTime(r)&&r.user_id===owner)&&(!before||!after||before.recorded_on===after.recorded_on&&before.revision!==after.revision);
}
export async function confirmWorkoutTime(client:SupabaseClient,owner:string,request:TimeRequest):Promise<TimeResult> {
  if(!validRequest(owner,request))return 'invalid';
  try {
    const row=request.after??request.before!;
    const {data,error}=await client.from('workout_actual_times').select('*').eq('user_id',owner).eq('recorded_on',row.recorded_on).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
    if(error)return 'uncertain';
    if(!request.after)return data?'changed':'confirmed';
    return data&&validWorkoutTime(data)&&Object.keys(request.after).every(k=>data[k as keyof WorkoutTime]===request.after![k as keyof WorkoutTime])?'confirmed':'changed';
  }catch{return 'uncertain';}
}
export async function writeWorkoutTime(client:SupabaseClient,owner:string,request:TimeRequest):Promise<TimeResult> {
  if(!validRequest(owner,request)||request.after&&!completedWorkoutTime(request.after))return 'invalid';
  const {before,after}=request;
  try {
    const query=!before ? client.from('workout_actual_times').insert(after!) : after ? client.from('workout_actual_times').update({starts_at:after.starts_at,ends_at:after.ends_at,revision:after.revision}).eq('user_id',owner).eq('recorded_on',before.recorded_on).eq('revision',before.revision) : client.from('workout_actual_times').delete().eq('user_id',owner).eq('recorded_on',before.recorded_on).eq('revision',before.revision);
    await query.abortSignal(AbortSignal.timeout(15000));
  }catch{/* A lost reply may have committed. Read before any further mutation. */}
  return confirmWorkoutTime(client,owner,request);
}
