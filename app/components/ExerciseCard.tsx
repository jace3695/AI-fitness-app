'use client';

import { useState } from 'react';
import { Exercise, Detail } from '../data/workouts';
import { AbSlideGate, IntervalTimer, SetChecklist } from './WorkoutControls';
import ExerciseGuidePanel from './ExerciseGuidePanel';
import WorkoutSession from './WorkoutSession';

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

function IntervalGrid({ intervals }: { intervals: NonNullable<Exercise['intervals']> }) {
  return <div className="grid grid-cols-4 gap-1.5 my-2">{intervals.map((row, i) => <div key={i} className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-[10px] text-gray-400 mb-1">{row.weeks}</p><p className="text-[11px] font-medium text-gray-700 whitespace-pre-line leading-tight">{row.pattern}</p><p className="text-[10px] text-gray-400 mt-1">{row.total}</p></div>)}</div>;
}

export default function ExerciseCard({ exercise, exercises = [exercise], index = 0, highRisk = false }: { exercise: Exercise; exercises?: Exercise[]; index?: number; highRisk?: boolean }) {
  const [open, setOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  return <div className={`bg-white border rounded-xl transition-colors ${open ? 'border-gray-300' : 'border-gray-200'} hover:border-gray-300`}>
    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5" onClick={() => setOpen(!open)}><div className="flex-1 min-w-0"><p className="text-[13.5px] font-medium text-gray-800 leading-snug">{exercise.name}</p>{exercise.meta && <p className="text-[11.5px] text-gray-400 mt-0.5">{exercise.meta}</p>}</div><div className="flex items-center gap-2 shrink-0">{highRisk && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">강도 조절</span>}{exercise.badge && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${BADGE_STYLES[exercise.badge.variant]}`}>{exercise.badge.label}</span>}<span className="text-[10px] text-gray-400" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span></div></div>
    <div className="px-3.5 pb-3"><button type="button" onClick={(e) => { e.stopPropagation(); setFollow(true); }} className="w-full rounded-xl bg-[#EEEDFE] px-3 py-2 text-[13px] font-bold text-[#3C3489]">따라하기 모드</button></div>
    {open && <div className="px-3.5 pb-3 pt-1 border-t border-gray-100">{exercise.details.map((d, i) => renderDetail(d, i))}{exercise.intervals && <IntervalGrid intervals={exercise.intervals} />}{exercise.intervalNote && <div className="flex gap-2 my-1 text-[13px] text-gray-500"><span style={{ color: '#7F77DD' }} className="shrink-0">•</span><span>{exercise.intervalNote}</span></div>}<ExerciseGuidePanel exercise={exercise} />{exercise.intervalPlan && <IntervalTimer plan={exercise.intervalPlan} />}<SetChecklist storageId={exercise.name} sets={exercise.sets} restSeconds={exercise.restSeconds} />{exercise.abSlideGate && <AbSlideGate storageId={exercise.name} />}</div>}
    {follow && <WorkoutSession exercises={exercises} title="운동 따라하기" startIndex={index} onClose={() => setFollow(false)} />}
  </div>;
}
