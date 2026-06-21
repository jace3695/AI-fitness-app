'use client';

import { useState } from 'react';
import { COMMON_INTENSITY, DayWorkout, SAFETY_STOP_MESSAGE } from '../data/workouts';
import FlowDiagram from './FlowDiagram';
import PhaseSection from './PhaseSection';

interface DayViewProps { day: DayWorkout; isCompleted: boolean; onToggleComplete: () => void; onPullupTraining?: () => void }

export default function DayView({ day, isCompleted, onToggleComplete, onPullupTraining }: DayViewProps) {
  const [warning, setWarning] = useState(false);
  const exercises = day.phases.flatMap((p) => p.exercises).filter((e) => e.sets !== 0 || e.intervalPlan || e.abSlideGate);
  return <div>
    <div className="flex justify-between items-start mb-4"><div><p className="text-[17px] font-medium text-gray-800">{day.title}</p><p className="text-[12px] text-gray-400 mt-0.5">{day.subtitle}</p></div><span className="text-white text-[11px] font-medium px-3 py-1 rounded-full shrink-0 ml-2" style={{ background: day.badgeBg }}>{day.totalTime}</span></div>
    <button type="button" onClick={() => setWarning(true)} className="w-full mb-3 py-3 px-4 rounded-xl text-[14px] font-bold bg-[#FCEBEB] text-[#A32D2D] border border-red-200">통증·저림·어지러움 발생</button>
    {warning && <div className="mb-4 rounded-2xl bg-[#FCEBEB] border-2 border-[#E24B4A] p-4 text-[#791F1F]"><p className="text-[18px] font-bold mb-1">운동을 즉시 중단하세요.</p><p className="text-[13px] leading-relaxed">허리 통증, 다리 저림, 날카로운 무릎 통증 또는 어지러움이 지속되면 무리하지 말고 의료진과 상담하세요.</p><button className="mt-3 text-[12px] underline" onClick={() => setWarning(false)}>안내 접기</button></div>}
    <div className="mb-4 rounded-xl bg-white border border-gray-100 p-3"><p className="text-[13px] font-semibold text-gray-800 mb-2">오늘 운동 순서</p><div className="flex gap-1.5 overflow-x-auto">{exercises.map((e, i) => <span key={`${e.name}-${i}`} className="shrink-0 rounded-full bg-[#EEEDFE] text-[#3C3489] px-2.5 py-1 text-[11px]">{i + 1}. {e.name}</span>)}</div></div>
    <div className="mb-4 grid gap-1.5 rounded-xl bg-[#E6F1FB] p-3 text-[12px] text-[#0C447C]"><p className="font-semibold">운동 강도 기준</p>{COMMON_INTENSITY.map((x) => <p key={x}>• {x}</p>)}<p className="font-semibold text-[#A32D2D]">{SAFETY_STOP_MESSAGE}</p></div>
    {onPullupTraining && ['mon', 'sat'].includes(day.id) && <button type="button" onClick={onPullupTraining} className="w-full mb-3 py-3 px-4 rounded-xl text-[14px] font-bold bg-[#EEEDFE] text-[#3C3489] border border-[#AFA9EC]">철봉 단계 훈련 진행</button>}
    <button type="button" onClick={onToggleComplete} className={`w-full mb-4 py-2.5 px-4 rounded-xl text-[14px] font-medium transition-colors border ${isCompleted ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC] hover:bg-[#E3E1FD]'}`}>{isCompleted ? '운동 완료됨' : '오늘 운동 완료'}</button>
    <FlowDiagram flow={day.flow} />
    {day.phases.map((phase, i) => {
      const offset = day.phases.slice(0, i).reduce((sum, p) => sum + p.exercises.length, 0);
      return <PhaseSection key={i} phase={phase} exercises={day.phases.flatMap((p) => p.exercises)} offset={offset} />;
    })}
  </div>;
}
