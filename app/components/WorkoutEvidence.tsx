'use client';
import {workoutEvidence} from '../data/workoutEvidence';
import type {WorkoutCompletionStore} from '../data/workoutCompletion';
import {CONDITION_SIGNAL_OPTIONS,type DailyConditionStore} from '../data/recoveryMode';
const back={none:'불편 없음',stiff:'약간 뻐근함',pain:'통증 있음',worse:'운동 전보다 악화'};
const difficulty={easy:'쉬움',moderate:'적당함',hard:'힘듦'};
export default function WorkoutEvidence({workouts,conditions,today,onRecords}:{workouts:WorkoutCompletionStore;conditions:DailyConditionStore;today:string;onRecords:()=>void}){
 const summary=workoutEvidence(workouts,conditions,today);if(!summary)return null;
 return <section aria-label="운동 수행·다음 날 컨디션" className="mb-4 rounded-3xl bg-white p-4 text-gray-900 shadow-sm">
  <h3 className="font-bold">운동 수행·다음 날 컨디션</h3><p className="mt-2 text-xs leading-5 text-gray-500">어제까지 28일 · {summary.start} ~ {summary.end}. 기록 없는 날은 휴식이나 실패로 판단하지 않습니다.</p>
  <div className="mt-3 grid grid-cols-2 gap-2">{[{label:'최근 14일',value:summary.recent},{label:'이전 14일',value:summary.previous}].map(({label,value})=><div key={label} className="rounded-xl bg-violet-50 p-3 text-xs leading-5"><strong>{label}</strong><p>수행 기록 {value.recorded}일</p><p>완료 {value.completed} · 일부 {value.partial} · 중단 {value.stopped}</p><p>허리 응답 {value.backAnswers}일</p><p>다음 날 컨디션 응답 {value.nextAnswers}일</p></div>)}</div>
  <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">날짜별 수행·컨디션 근거</summary>{!summary.days.length?<p className="text-xs">이 기간에 저장된 수행 기록이 없습니다.</p>:<ul className="space-y-2">{summary.days.map(day=><li key={day.date} className="rounded-xl bg-gray-50 p-3 text-xs leading-5"><strong>{day.date}</strong><p>{day.status==='completed'?'완료':day.status==='partial'?'일부 완료':day.status==='stopped'?'중단':'수행 상태 미확인'} · 세트 {day.recordedSets?`${day.completedSets}/${day.recordedSets}`:'미기록'}</p><p>전체 난이도 {day.difficulty?difficulty[day.difficulty]:'미응답'} · 피로 {day.fatigue===null?'미응답':`${day.fatigue}/5`}</p><p>마지막 세트 RPE {day.rpe===null?'미응답':`${day.rpe}/10`} · 통증 부위 {day.painArea??'미기록'}</p><p>운동 후 허리 {day.back?back[day.back]:'미응답'}</p>{day.painExercise&&<p>불편했던 운동 {day.painExercise}{day.painSet?` · ${day.painSet}세트`:''}</p>}<p>다음 날({day.nextDate}) {day.nextSignals===null?'컨디션 미기록':!day.nextSignals.length?'선택한 불편 신호 없음':day.nextSignals.map(id=>CONDITION_SIGNAL_OPTIONS.find(option=>option.id===id)?.label??'기타 기록').join(' · ')}</p></li>)}</ul>}</details>
  <p className="mt-2 text-xs leading-5 text-gray-500">전체 체감 난이도는 마지막 세트 RPE와 다릅니다. 다음 날 기록은 날짜로 연결하며 운동이 증상의 원인이라고 판단하지 않습니다. 계획 변경은 위 조정 제안을 확인한 뒤 적용합니다.</p><button type="button" onClick={onRecords} className="mt-2 min-h-11 rounded-xl bg-violet-50 px-3 text-xs font-bold text-violet-800">수행 기록 확인·수정</button>
 </section>;
}
