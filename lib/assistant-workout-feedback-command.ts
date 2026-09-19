import type {WorkoutDaySnapshot} from './assistant-workout-command.ts';
export const FEEDBACK_FIELDS={workoutFatigue:'피로도',workoutDifficulty:'난이도',workoutLastSetRpe:'마지막 세트 RPE',workoutPainArea:'통증 부위',workoutStatus:'상태'} as const;
export type WorkoutFeedbackChange={kind:'feedback';field:keyof typeof FEEDBACK_FIELDS;value:string|number};
const choices:Record<string,Record<string,string>>={workoutDifficulty:{쉬움:'easy',적당함:'moderate',힘듦:'hard'},workoutPainArea:{허리:'허리',골반:'골반',무릎:'무릎',발목:'발목',어깨:'어깨',손목:'손목',기타:'기타'},workoutStatus:{'일부 완료':'partial',중단:'stopped'}};
export function isWorkoutFeedbackChange(value:unknown):value is WorkoutFeedbackChange{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const c=value as WorkoutFeedbackChange;
 if(Object.keys(c).sort().join()!=='field,kind,value'||c.kind!=='feedback'||!Object.hasOwn(FEEDBACK_FIELDS,c.field))return false;
 return c.field==='workoutFatigue'||c.field==='workoutLastSetRpe'?typeof c.value==='number'&&Number.isInteger(c.value)&&c.value>=1&&c.value<=(c.field==='workoutFatigue'?5:10):Object.values(choices[c.field]??{}).includes(String(c.value))&&typeof c.value==='string';
}
export function nextWorkoutFeedbackSnapshot(before:WorkoutDaySnapshot,change:WorkoutFeedbackChange):WorkoutDaySnapshot{
 if(!isWorkoutFeedbackChange(change))throw Error('운동 상세 기록 값을 다시 확인해 주세요.');
 const raw=before.record;if(raw!==undefined&&typeof raw!=='boolean'&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw Error('기존 운동 기록 형식을 확인하지 못했습니다.');
 const record=typeof raw==='boolean'?{workoutDone:raw}:raw??{};
 return {record:{...record,[change.field]:change.value,...(change.field==='workoutStatus'?{workoutDone:false}:{}),...(change.field==='workoutPainArea'?{workoutPain:true}:{})}};
}
export function describeWorkoutFeedback(snapshot:WorkoutDaySnapshot):string{
 const r=typeof snapshot.record==='object'?snapshot.record:{};return Object.entries(FEEDBACK_FIELDS).map(([field,label])=>{const value=r[field];const named=Object.entries(choices[field]??{}).find(([,v])=>v===value)?.[0];return `${label} ${value===undefined?'미기록':named??String(value)}`;}).join(' · ');
}
export const isWorkoutFeedbackIntent=(message:string)=>/운동/.test(message)&&/(피로도|난이도|RPE|통증\s*부위|상태)/i.test(message)&&/(기록|저장)/.test(message);
export function parseWorkoutFeedbackCommand(message:string):WorkoutFeedbackChange{
 const match=/^오늘\s+운동\s+(피로도|난이도|마지막\s+세트\s+RPE|통증\s+부위|상태)\s+(.+?)\s+(?:기록|저장)(?:해\s*줘|해주세요|해요)[.!。]*$/i.exec(message.trim());
 const label=match?.[1].replace(/\s+/g,' ').replace(/rpe/i,'RPE');const field=(Object.keys(FEEDBACK_FIELDS) as (keyof typeof FEEDBACK_FIELDS)[]).find(key=>FEEDBACK_FIELDS[key]===label);const text=match?.[2];
 const value=field==='workoutFatigue'||field==='workoutLastSetRpe'?text&&/^\d{1,2}$/.test(text)?Number(text):null:field&&text?choices[field]?.[text]:null;
 const change={kind:'feedback',field,value};if(!isWorkoutFeedbackChange(change))throw Error('한 항목씩 입력해 주세요. 예: ‘오늘 운동 피로도 4 기록해줘’, ‘오늘 운동 난이도 힘듦 기록해줘’, ‘오늘 운동 마지막 세트 RPE 7 기록해줘’, ‘오늘 운동 통증 부위 허리 기록해줘’, ‘오늘 운동 상태 일부 완료 기록해줘’.');return change;
}
