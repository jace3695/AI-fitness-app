'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { GrowthRoutineRow, GrowthSessionRow } from '@/app/data/growthPlatform';
import { isRetiredGrowthRoutine } from '@/app/data/growthRoutines';
import { summarizeGrowthPatterns } from '@/app/data/growthPatterns';
import { GROWTH_WEEKDAYS } from '@/app/data/growthSchedule';
import { getLocalDateKey } from '@/utils/dateKey';
import GrowthWorkoutPatterns from './GrowthWorkoutPatterns';
import GrowthTimePatterns from './GrowthTimePatterns';

export default function GrowthPatterns({ routines, sessions, workoutRecords, ready, loading, onRefresh }: {
  routines: GrowthRoutineRow[]; sessions: GrowthSessionRow[]; workoutRecords: unknown; ready: boolean; loading: boolean; onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const visible = routines.filter(routine => routine.enabled && !isRetiredGrowthRoutine(routine));
  const routine = visible.find(item => item.id === selected) ?? visible[0];
  const incomplete = sessions.length >= 1000;
  const pattern = ready && !loading && !incomplete && routine ? summarizeGrowthPatterns(sessions, routine.id, getLocalDateKey()) : null;
  return <section aria-label="루틴 요일별 실행 패턴" className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-xl font-bold">내가 이어가기 편한 요일은?</h2>
    <p className="mt-2 text-sm leading-6 text-gray-600">어제까지 28일의 실행 기록을 비교해요. 기록 없는 날은 실패로 계산하지 않아요. 현재 설정으로 과거의 예정일을 추정하지 않습니다.</p>
    {loading ? <p role="status" className="mt-4 text-sm">실행 기록을 불러오고 있어요…</p> : !ready || incomplete ? <div role="alert" className="mt-4 text-sm text-amber-800"><p>{incomplete ? '기록이 많아 전체 기간을 확인하지 못했어요. 일부 기록으로 추천하지 않습니다.' : '실행 기록을 모두 확인하지 못했어요. 연결을 확인하고 다시 불러와 주세요.'}</p><button type="button" onClick={() => void onRefresh()} className="mt-2 min-h-11 rounded-xl bg-amber-50 px-3 font-bold">기록 다시 불러오기</button></div> : !routine ? <p className="mt-4 text-sm">사용 중인 루틴이 없습니다. 자기계발 홈에서 루틴을 추가하거나 켜 주세요.</p> : <>
      <label className="mt-4 block text-sm font-bold">살펴볼 루틴<select value={routine.id} onChange={event => setSelected(event.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl bg-gray-50 px-3">{visible.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {pattern && <><p className="mt-3 text-xs text-gray-500">{pattern.start} ~ {pattern.end} · 기록 {pattern.recorded}일 · 기록 없음 {pattern.unrecorded}일</p>
        <p className="mt-2 text-xs text-gray-500">같은 날 여러 번 기록해도 하루로 집계하며, 완료 → 진행 → 중단 순으로 표시해요.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{[{ name: '평일', value: pattern.weekday }, { name: '주말', value: pattern.weekend }].map(({ name, value }) => <div key={name} className="rounded-xl bg-violet-50 p-3 text-sm"><h3 className="font-bold">{name}</h3><p className="mt-1">완료 {value.completed}일 / 기록 {value.recorded}일</p><p className="mt-1 text-xs">진행 {value.partial}일 · 중단 {value.stopped}일</p></div>)}</div>
        <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">요일별 근거 보기</summary><table className="w-full table-fixed text-center text-xs"><caption className="pb-2 text-left text-gray-500">최근 28일의 기록일 수</caption><thead><tr><th>요일</th><th>완료</th><th>진행</th><th>중단</th><th>기록일</th></tr></thead><tbody>{pattern.weekdays.map(day => <tr key={day.day} className="border-t border-gray-100"><th className="py-2">{GROWTH_WEEKDAYS[day.day - 1].label}</th><td>{day.completed}</td><td>{day.partial}</td><td>{day.stopped}</td><td>{day.recorded}</td></tr>)}</tbody></table></details>
        <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm leading-6">{pattern.recorded ? pattern.suggestion : '이 기간에는 실행 기록이 없어요. 첫 기록부터 차근차근 모아보세요.'}</p>
        <GrowthWorkoutPatterns days={pattern.days} workoutRecords={workoutRecords} />
        <GrowthTimePatterns sessions={sessions} routineId={routine.id} days={pattern.days} />
      </>}
      <button type="button" onClick={() => void onRefresh()} className="mt-3 min-h-11 rounded-xl bg-gray-100 px-3 text-sm font-bold">기록 다시 불러오기</button>
      <p className="mt-1 text-xs text-gray-500">마지막으로 불러온 기록을 기준으로 비교해요.</p>
      <Link href="/growth" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-violet-700">루틴 일정 확인하기 →</Link><p className="text-xs text-gray-500">자기계발 홈의 ‘루틴 편집’에서 직접 검토해 바꿀 수 있어요.</p>
    </>}
  </section>;
}
