'use client';

import { useState } from 'react';
import { Exercise, Detail, SAFETY_STOP_MESSAGE } from '../data/workouts';
import { AbSlideGate, IntervalTimer, SetChecklist } from './WorkoutControls';

const BADGE_STYLES: Record<string, string> = {
  yellow: 'bg-[#FAEEDA] text-[#854F0B]', green: 'bg-[#EAF3DE] text-[#3B6D11]', blue: 'bg-[#E6F1FB] text-[#185FA5]', purple: 'bg-[#EEEDFE] text-[#3C3489]', red: 'bg-[#FCEBEB] text-[#A32D2D]',
};

function renderDetail(d: Detail, i: number) {
  const text = d.text;
  if (d.type === 'warn') return <div key={i} className="bg-[#FCEBEB] rounded-lg px-3 py-2 my-1 text-[12px] text-[#791F1F]">{text}</div>;
  if (d.type === 'good') return <div key={i} className="bg-[#EAF3DE] rounded-lg px-3 py-2 my-1 text-[12px] text-[#27500A]">{text}</div>;
  const dotColor = d.type === 'red' ? '#E24B4A' : d.type === 'green' ? '#639922' : '#7F77DD';
  return <div key={i} className="flex gap-2 my-1 text-[13px] text-gray-500 leading-relaxed"><span style={{ color: dotColor }} className="shrink-0 mt-0.5">•</span><span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-gray-800">$1</strong>') }} /></div>;
}

function getVideoHref(exercise: Exercise) {
  const guide = exercise.guide;
  if (guide?.videoUrl) return guide.videoUrl;
  if (guide?.videoSearchQuery) return `https://www.youtube.com/results?search_query=${encodeURIComponent(guide.videoSearchQuery)}`;
  return undefined;
}

function getVideoLabel(exercise: Exercise) {
  if (exercise.guide?.videoUrl) return '영상 보기';
  if (exercise.guide?.videoSearchQuery) return '영상 검색';
  return '영상 준비중';
}

function GuideBlock({ title, items, tone = 'plain' }: { title: string; items?: string[]; tone?: 'plain' | 'mistake' | 'stop' }) {
  if (!items?.length) return null;
  const box = tone === 'mistake' ? 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]' : tone === 'stop' ? 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]' : 'bg-gray-50 text-gray-600 border-gray-100';
  return <section className={`rounded-xl border p-3 ${box}`}><p className="text-[12px] font-bold mb-1.5">{title}</p><ul className="space-y-1">{items.map((x) => <li key={x} className="text-[12px] leading-relaxed">• {x}</li>)}</ul></section>;
}

function Guide({ exercise }: { exercise: Exercise }) {
  const g = exercise.guide;
  if (!g) return null;
  return <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
    <p className="text-[13px] font-bold text-gray-800">자세 가이드</p>
    {g.keyPoint && <p className="rounded-xl bg-[#EEEDFE] p-3 text-[13px] font-semibold text-[#3C3489]">1) 핵심 한 줄: {g.keyPoint}</p>}
    <GuideBlock title="2) 시작 자세" items={g.setup} />
    <GuideBlock title="3) 움직이는 순서" items={g.movement} />
    {g.breathing && <div className="rounded-xl bg-[#E6F1FB] p-3 text-[12px] text-[#0C447C]"><b>4) 호흡</b><p className="mt-1">{g.breathing}</p></div>}
    {g.target && <div className="rounded-xl bg-[#EAF3DE] p-3 text-[12px] text-[#27500A]"><b>5) 자극 부위</b><p className="mt-1">{g.target}</p></div>}
    <GuideBlock title="6) 자주 하는 실수" items={g.commonMistakes} tone="mistake" />
    <GuideBlock title="7) 즉시 중단 기준" items={g.stopCriteria} tone="stop" />
    <p className="rounded-xl bg-[#FCEBEB] p-3 text-[12px] font-semibold text-[#A32D2D]">{SAFETY_STOP_MESSAGE} 어깨 통증도 있으면 즉시 중단하세요.</p>
    {getVideoHref(exercise) ? <a href={getVideoHref(exercise)} target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-[#111827] px-3 py-2 text-center text-[13px] font-bold text-white">8) {getVideoLabel(exercise)}</a> : <button type="button" disabled className="block w-full rounded-xl bg-gray-100 px-3 py-2 text-center text-[13px] font-bold text-gray-400">8) 영상 준비중</button>}
  </div>;
}

function IntervalGrid({ intervals }: { intervals: NonNullable<Exercise['intervals']> }) {
  return <div className="grid grid-cols-4 gap-1.5 my-2">{intervals.map((row, i) => <div key={i} className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-[10px] text-gray-400 mb-1">{row.weeks}</p><p className="text-[11px] font-medium text-gray-700 whitespace-pre-line leading-tight">{row.pattern}</p><p className="text-[10px] text-gray-400 mt-1">{row.total}</p></div>)}</div>;
}

function FollowModal({ exercises, index, onClose }: { exercises: Exercise[]; index: number; onClose: () => void }) {
  const [cur, setCur] = useState(index);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [showStopGuide, setShowStopGuide] = useState(false);
  const exercise = exercises[cur];
  const completeCurrent = () => {
    setCompleted((current) => new Set(current).add(cur));
    if (cur < exercises.length - 1) setCur((value) => value + 1);
  };
  return <div className="fixed inset-0 z-50 bg-[#111827] p-0 sm:p-3" role="dialog" aria-modal="true" aria-label="운동 따라하기">
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white sm:rounded-3xl lg:max-w-3xl">
      <div className="shrink-0 border-b border-gray-100 bg-white px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-[#534AB7]">오늘 운동</p>
            <p className="mt-0.5 text-[12px] text-gray-400">{cur + 1} / {exercises.length}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-bold text-gray-600">나가기</button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-[#534AB7] transition-all" style={{ width: `${((cur + 1) / exercises.length) * 100}%` }} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-gradient-to-br from-[#EEEDFE] to-[#F7F6FF] p-5 text-center">
          <p className="text-[12px] font-bold text-[#534AB7]">현재 동작</p>
          <h2 className="mt-2 text-[26px] font-bold text-gray-900">{exercise.name}</h2>
          {exercise.meta && <p className="mt-2 text-[14px] font-semibold text-gray-600">{exercise.meta}</p>}
          {completed.has(cur) && <span className="mt-3 inline-block rounded-full bg-green-100 px-3 py-1 text-[12px] font-bold text-green-700">완료됨</span>}
        </div>
        <div className="mt-4">
          <Guide exercise={exercise} />
          <SetChecklist storageId={`follow-${exercise.name}`} sets={exercise.sets} restSeconds={exercise.restSeconds} />
          {exercise.intervalPlan && <IntervalTimer plan={exercise.intervalPlan} />}
        </div>
        {showStopGuide && <div className="mt-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-800"><p className="text-[16px] font-bold">운동을 즉시 멈추세요.</p><p className="mt-1 text-[13px] leading-relaxed">허리 통증, 다리 저림, 날카로운 무릎 통증 또는 어지러움이 지속되면 오늘 운동을 종료하고 회복을 우선하세요.</p><button type="button" onClick={onClose} className="mt-3 w-full rounded-xl bg-red-600 px-3 py-3 text-[13px] font-bold text-white">운동 종료</button></div>}
      </div>
      <div className="shrink-0 border-t border-gray-100 bg-white/95 p-3 shadow-2xl">
        <button type="button" onClick={() => setShowStopGuide((value) => !value)} className="mb-2 w-full rounded-xl bg-red-50 py-2.5 text-[12px] font-bold text-red-700">통증·저림·어지러움 발생</button>
        <div className="grid grid-cols-[0.8fr_1.6fr_0.8fr] gap-2">
          <button type="button" disabled={cur === 0} className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700 disabled:text-gray-300" onClick={() => setCur((value) => Math.max(0, value - 1))}>이전</button>
          <button type="button" className="rounded-xl bg-[#534AB7] py-3 text-[13px] font-bold text-white" onClick={completeCurrent}>{cur === exercises.length - 1 ? '이 동작 완료' : '완료하고 다음'}</button>
          <button type="button" disabled={cur === exercises.length - 1} className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700 disabled:text-gray-300" onClick={() => setCur((value) => Math.min(exercises.length - 1, value + 1))}>건너뛰기</button>
        </div>
        {getVideoHref(exercise) ? <a className="mt-2 block rounded-xl bg-[#111827] py-2.5 text-center text-[12px] font-bold text-white" href={getVideoHref(exercise)} target="_blank" rel="noopener noreferrer">{getVideoLabel(exercise)}</a> : null}
      </div>
    </div>
  </div>;
}

export default function ExerciseCard({ exercise, exercises = [exercise], index = 0, highRisk = false }: { exercise: Exercise; exercises?: Exercise[]; index?: number; highRisk?: boolean }) {
  const [open, setOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  return <div className={`bg-white border rounded-xl transition-colors ${open ? 'border-gray-300' : 'border-gray-200'} hover:border-gray-300`}>
    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5" onClick={() => setOpen(!open)}><div className="flex-1 min-w-0"><p className="text-[13.5px] font-medium text-gray-800 leading-snug">{exercise.name}</p>{exercise.meta && <p className="text-[11.5px] text-gray-400 mt-0.5">{exercise.meta}</p>}</div><div className="flex items-center gap-2 shrink-0">{highRisk && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">강도 조절</span>}{exercise.badge && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${BADGE_STYLES[exercise.badge.variant]}`}>{exercise.badge.label}</span>}<span className="text-[10px] text-gray-400" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span></div></div>
    <div className="px-3.5 pb-3"><button type="button" onClick={(e) => { e.stopPropagation(); setFollow(true); }} className="w-full rounded-xl bg-[#EEEDFE] px-3 py-2 text-[13px] font-bold text-[#3C3489]">따라하기 모드</button></div>
    {open && <div className="px-3.5 pb-3 pt-1 border-t border-gray-100">{exercise.details.map((d, i) => renderDetail(d, i))}{exercise.intervals && <IntervalGrid intervals={exercise.intervals} />}{exercise.intervalNote && <div className="flex gap-2 my-1 text-[13px] text-gray-500"><span style={{ color: '#7F77DD' }} className="shrink-0">•</span><span>{exercise.intervalNote}</span></div>}<Guide exercise={exercise} />{exercise.intervalPlan && <IntervalTimer plan={exercise.intervalPlan} />}<SetChecklist storageId={exercise.name} sets={exercise.sets} restSeconds={exercise.restSeconds} />{exercise.abSlideGate && <AbSlideGate storageId={exercise.name} />}</div>}
    {follow && <FollowModal exercises={exercises} index={index} onClose={() => setFollow(false)} />}
  </div>;
}
