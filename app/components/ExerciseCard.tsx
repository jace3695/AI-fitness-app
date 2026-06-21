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
  return exercise.guide?.videoUrl ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} 자세 초보`)}`;
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
    <a href={getVideoHref(exercise)} target="_blank" rel="noreferrer" className="block rounded-xl bg-[#111827] px-3 py-2 text-center text-[13px] font-bold text-white">8) 영상 보기</a>
  </div>;
}

function IntervalGrid({ intervals }: { intervals: NonNullable<Exercise['intervals']> }) {
  return <div className="grid grid-cols-4 gap-1.5 my-2">{intervals.map((row, i) => <div key={i} className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-[10px] text-gray-400 mb-1">{row.weeks}</p><p className="text-[11px] font-medium text-gray-700 whitespace-pre-line leading-tight">{row.pattern}</p><p className="text-[10px] text-gray-400 mt-1">{row.total}</p></div>)}</div>;
}

function FollowModal({ exercises, index, onClose }: { exercises: Exercise[]; index: number; onClose: () => void }) {
  const [cur, setCur] = useState(index);
  const exercise = exercises[cur];
  return <div className="fixed inset-0 z-50 bg-black/50 p-3" onClick={onClose}>
    <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden rounded-3xl bg-white" onClick={(e) => e.stopPropagation()}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4"><p className="text-[12px] text-gray-400">따라하기 모드 {cur + 1}/{exercises.length}</p><h2 className="text-xl font-bold text-gray-900">{exercise.name}</h2>{exercise.meta && <p className="mt-1 text-[13px] text-gray-500">{exercise.meta}</p>}<Guide exercise={exercise} /><SetChecklist storageId={`follow-${exercise.name}`} sets={exercise.sets} restSeconds={exercise.restSeconds} />{exercise.intervalPlan && <IntervalTimer plan={exercise.intervalPlan} />}</div>
      <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-gray-100 bg-white/95 p-3 shadow-2xl"><button className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700" onClick={() => setCur((v) => Math.max(0, v - 1))}>이전</button><button className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700" onClick={() => setCur((v) => Math.min(exercises.length - 1, v + 1))}>다음</button><a className="rounded-xl bg-[#111827] py-3 text-center text-[12px] font-bold text-white" href={getVideoHref(exercise)} target="_blank" rel="noreferrer">영상</a><button className="rounded-xl bg-[#E24B4A] py-3 text-[12px] font-bold text-white" onClick={onClose}>닫기</button></div>
    </div>
  </div>;
}

export default function ExerciseCard({ exercise, exercises = [exercise], index = 0 }: { exercise: Exercise; exercises?: Exercise[]; index?: number }) {
  const [open, setOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  return <div className={`bg-white border rounded-xl transition-colors ${open ? 'border-gray-300' : 'border-gray-200'} hover:border-gray-300`}>
    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5" onClick={() => setOpen(!open)}><div className="flex-1 min-w-0"><p className="text-[13.5px] font-medium text-gray-800 leading-snug">{exercise.name}</p>{exercise.meta && <p className="text-[11.5px] text-gray-400 mt-0.5">{exercise.meta}</p>}</div><div className="flex items-center gap-2 shrink-0">{exercise.badge && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${BADGE_STYLES[exercise.badge.variant]}`}>{exercise.badge.label}</span>}<span className="text-[10px] text-gray-400" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span></div></div>
    <div className="px-3.5 pb-3"><button type="button" onClick={(e) => { e.stopPropagation(); setFollow(true); }} className="w-full rounded-xl bg-[#EEEDFE] px-3 py-2 text-[13px] font-bold text-[#3C3489]">따라하기 모드</button></div>
    {open && <div className="px-3.5 pb-3 pt-1 border-t border-gray-100">{exercise.details.map((d, i) => renderDetail(d, i))}{exercise.intervals && <IntervalGrid intervals={exercise.intervals} />}{exercise.intervalNote && <div className="flex gap-2 my-1 text-[13px] text-gray-500"><span style={{ color: '#7F77DD' }} className="shrink-0">•</span><span>{exercise.intervalNote}</span></div>}<Guide exercise={exercise} />{exercise.intervalPlan && <IntervalTimer plan={exercise.intervalPlan} />}<SetChecklist storageId={exercise.name} sets={exercise.sets} restSeconds={exercise.restSeconds} />{exercise.abSlideGate && <AbSlideGate storageId={exercise.name} />}</div>}
    {follow && <FollowModal exercises={exercises} index={index} onClose={() => setFollow(false)} />}
  </div>;
}
