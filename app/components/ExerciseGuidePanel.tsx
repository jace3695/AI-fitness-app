import { Exercise, SAFETY_STOP_MESSAGE } from '../data/workouts';

export function getExerciseVideoHref(exercise: Exercise) {
  const guide = exercise.guide;
  if (guide?.videoUrl) return guide.videoUrl;
  if (guide?.videoSearchQuery) return `https://www.youtube.com/results?search_query=${encodeURIComponent(guide.videoSearchQuery)}`;
  return undefined;
}

export function getExerciseVideoLabel(exercise: Exercise) {
  if (exercise.guide?.videoUrl) return '영상 보기';
  if (exercise.guide?.videoSearchQuery) return '영상 검색';
  return '영상 준비중';
}

function GuideBlock({ title, items, tone = 'plain' }: { title: string; items?: string[]; tone?: 'plain' | 'mistake' | 'stop' }) {
  if (!items?.length) return null;
  const box = tone === 'mistake' ? 'bg-[#FAEEDA] text-[#633806] border-[#EF9F27]' : tone === 'stop' ? 'bg-[#FCEBEB] text-[#791F1F] border-[#E24B4A]' : 'bg-gray-50 text-gray-600 border-gray-100';
  return <section className={`rounded-xl border p-3 ${box}`}><p className="mb-1.5 text-[12px] font-bold">{title}</p><ul className="space-y-1">{items.map((item) => <li key={item} className="text-[12px] leading-relaxed">• {item}</li>)}</ul></section>;
}

export default function ExerciseGuidePanel({ exercise }: { exercise: Exercise }) {
  const guide = exercise.guide;
  if (!guide) return null;
  return (
    <div className="mt-3 space-y-2" onClick={(event) => event.stopPropagation()}>
      <p className="text-[13px] font-bold text-gray-800">자세 가이드</p>
      {guide.keyPoint ? <p className="rounded-xl bg-[#EEEDFE] p-3 text-[13px] font-semibold text-[#3C3489]">1) 핵심 한 줄: {guide.keyPoint}</p> : null}
      <GuideBlock title="2) 시작 자세" items={guide.setup} />
      <GuideBlock title="3) 움직이는 순서" items={guide.movement} />
      {guide.breathing ? <div className="rounded-xl bg-[#E6F1FB] p-3 text-[12px] text-[#0C447C]"><b>4) 호흡</b><p className="mt-1">{guide.breathing}</p></div> : null}
      {guide.target ? <div className="rounded-xl bg-[#EAF3DE] p-3 text-[12px] text-[#27500A]"><b>5) 자극 부위</b><p className="mt-1">{guide.target}</p></div> : null}
      <GuideBlock title="6) 자주 하는 실수" items={guide.commonMistakes} tone="mistake" />
      <GuideBlock title="7) 즉시 중단 기준" items={guide.stopCriteria} tone="stop" />
      {guide.alternatives?.length ? (
        <section className="rounded-xl border border-[#AFA9EC] bg-[#EEEDFE] p-3 text-[#3C3489]">
          <p className="text-[12px] font-bold">통증·불안정 시 대체 운동</p>
          <ul className="mt-1.5 space-y-1">
            {guide.alternatives.map((alternative) => <li key={alternative} className="text-[12px] leading-relaxed">• {alternative}</li>)}
          </ul>
        </section>
      ) : null}
      <p className="rounded-xl bg-[#FCEBEB] p-3 text-[12px] font-semibold text-[#A32D2D]">{SAFETY_STOP_MESSAGE} 어깨 통증도 있으면 즉시 중단하세요.</p>
      {getExerciseVideoHref(exercise) ? <a href={getExerciseVideoHref(exercise)} target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-[#111827] px-3 py-2 text-center text-[13px] font-bold text-white">8) 한국어 {getExerciseVideoLabel(exercise)}</a> : <button type="button" disabled className="block w-full rounded-xl bg-gray-100 px-3 py-2 text-center text-[13px] font-bold text-gray-400">8) 영상 준비중</button>}
    </div>
  );
}
