'use client';

import { useState } from 'react';
import { COMMON_INTENSITY, DayWorkout, SAFETY_STOP_MESSAGE } from '../data/workouts';
import { RECOVERY_REASON_LABELS, RECOVERY_ROUTINE, RECOVERY_STOP_CRITERIA, RecoveryDayRecord } from '../data/recoveryMode';
import FlowDiagram from './FlowDiagram';
import PhaseSection from './PhaseSection';

interface DayViewProps { day: DayWorkout; isCompleted: boolean; onToggleComplete: () => void; onPullupTraining?: () => void; recovery?: RecoveryDayRecord; onRecordRecovery?: () => void; showBaseRoutine?: boolean; onShowRecommended?: () => void; onShowBaseRoutine?: () => void }

export default function DayView({ day, isCompleted, onToggleComplete, onPullupTraining, recovery, onRecordRecovery, showBaseRoutine = true, onShowRecommended, onShowBaseRoutine }: DayViewProps) {
  const [warning, setWarning] = useState(false);
  const exercises = day.phases.flatMap((p) => p.exercises).filter((e) => e.sets !== 0 || e.intervalPlan || e.abSlideGate);
  const highRiskNames = ['슬라이딩보드', '전신 서킷', '고블릿 스쿼트', '매달리기', '런지', 'AB 슬라이드'];
  const isRecoveryRecommended = Boolean(recovery?.recoveryMode);
  const reasonLabels = recovery?.reasons.map((reason) => RECOVERY_REASON_LABELS[reason]).filter(Boolean) || [];
  return <div>
    {recovery && <section className={`mb-4 rounded-2xl border p-4 shadow-sm ${isRecoveryRecommended ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-100 bg-green-50 text-green-800'}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-semibold">오늘 상태</p><h2 className="mt-1 text-[18px] font-bold">{isRecoveryRecommended ? '회복 운동 권장' : '일반 운동'}</h2></div><span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold">권장 강도: {recovery.intensity === '70%' ? '70%' : recovery.intensity === 'recovery' ? '회복' : '정상'}</span></div>
      {isRecoveryRecommended ? <div className="mt-3 rounded-xl bg-white/75 p-3 text-[13px] leading-relaxed"><p className="font-bold">오늘은 회복 운동 권장일입니다.</p><p>강한 슬라이딩보드, 전신 서킷, 고중량 운동은 피하고<br />가벼운 움직임과 회복을 우선하세요.</p></div> : <p className="mt-3 text-[13px]">일반식 기반 기본 루틴을 진행해도 됩니다. 통증·저림·어지럼이 있으면 즉시 중단하세요.</p>}
      <p className="mt-3 text-[12px]"><b>원인:</b> {reasonLabels.length ? reasonLabels.join(' / ') : '특이사항 없음'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2"><button onClick={onShowRecommended} className="rounded-xl bg-[#534AB7] px-2 py-2 text-[12px] font-bold text-white">오늘 추천 루틴</button><button onClick={onShowBaseRoutine} className="rounded-xl bg-white px-2 py-2 text-[12px] font-bold text-gray-700">기존 루틴 보기</button><button onClick={onRecordRecovery} className="rounded-xl bg-green-600 px-2 py-2 text-[12px] font-bold text-white">오늘은 회복 우선</button></div>
      {recovery.completedAsRecovery && <p className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-[12px] font-bold text-green-700">회복 운동 완료/회복 우선으로 기록됨</p>}
    </section>}
    {isRecoveryRecommended && !showBaseRoutine && <section className="mb-4 rounded-2xl border border-green-100 bg-white p-4 shadow-sm"><p className="text-[16px] font-bold text-gray-900">회복 운동 루틴 · 20~25분</p><div className="mt-3 space-y-2">{RECOVERY_ROUTINE.map((item, idx) => <div key={item} className="rounded-xl bg-green-50 px-3 py-2 text-[13px] text-green-800">{idx + 1}) {item}</div>)}</div><p className="mt-3 text-[12px] font-bold text-red-700">중단 기준: {RECOVERY_STOP_CRITERIA.join(' · ')}</p></section>}
    {(!isRecoveryRecommended || showBaseRoutine) && <><div className="flex justify-between items-start mb-4"><div><p className="text-[17px] font-medium text-gray-800">{day.title}</p><p className="text-[12px] text-gray-400 mt-0.5">{day.subtitle}</p></div><span className="text-white text-[11px] font-medium px-3 py-1 rounded-full shrink-0 ml-2" style={{ background: day.badgeBg }}>{day.totalTime}</span></div>
    <button type="button" onClick={() => setWarning(true)} className="w-full mb-3 py-3 px-4 rounded-xl text-[14px] font-bold bg-[#FCEBEB] text-[#A32D2D] border border-red-200">통증·저림·어지러움 발생</button>
    {warning && <div className="mb-4 rounded-2xl bg-[#FCEBEB] border-2 border-[#E24B4A] p-4 text-[#791F1F]"><p className="text-[18px] font-bold mb-1">운동을 즉시 중단하세요.</p><p className="text-[13px] leading-relaxed">허리 통증, 다리 저림, 날카로운 무릎 통증 또는 어지러움이 지속되면 무리하지 말고 의료진과 상담하세요.</p><button className="mt-3 text-[12px] underline" onClick={() => setWarning(false)}>안내 접기</button></div>}
    <div className="mb-4 rounded-xl bg-white border border-gray-100 p-3"><p className="text-[13px] font-semibold text-gray-800 mb-2">오늘 운동 순서</p><div className="flex gap-1.5 overflow-x-auto">{exercises.map((e, i) => <span key={`${e.name}-${i}`} className="shrink-0 rounded-full bg-[#EEEDFE] text-[#3C3489] px-2.5 py-1 text-[11px]">{i + 1}. {e.name}</span>)}</div></div>
    <div className="mb-4 grid gap-1.5 rounded-xl bg-[#E6F1FB] p-3 text-[12px] text-[#0C447C]"><p className="font-semibold">운동 강도 기준</p>{COMMON_INTENSITY.map((x) => <p key={x}>• {x}</p>)}<p className="font-semibold text-[#A32D2D]">{SAFETY_STOP_MESSAGE}</p></div>
    {onPullupTraining && ['mon', 'sat'].includes(day.id) && <button type="button" onClick={onPullupTraining} className="w-full mb-3 py-3 px-4 rounded-xl text-[14px] font-bold bg-[#EEEDFE] text-[#3C3489] border border-[#AFA9EC]">철봉 단계 훈련 진행</button>}
    <button type="button" onClick={onToggleComplete} className={`w-full mb-4 py-2.5 px-4 rounded-xl text-[14px] font-medium transition-colors border ${isCompleted ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC] hover:bg-[#E3E1FD]'}`}>{isCompleted ? '운동 완료됨' : '오늘 운동 완료'}</button>
    <FlowDiagram flow={day.flow} />
    {day.phases.map((phase, i) => {
      const offset = day.phases.slice(0, i).reduce((sum, p) => sum + p.exercises.length, 0);
      return <PhaseSection key={i} phase={phase} exercises={day.phases.flatMap((p) => p.exercises)} offset={offset} highRiskNames={isRecoveryRecommended ? highRiskNames : []} />;
    })}
    </>}
  </div>;
}
