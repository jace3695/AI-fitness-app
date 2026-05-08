import { Phase } from '../data/workouts';
import ExerciseCard from './ExerciseCard';

const PHASE_STYLES: Record<string, { bg: string; titleColor: string; subColor: string }> = {
  warmup:   { bg: '#EEEDFE', titleColor: '#3C3489', subColor: '#534AB7' },
  main:     { bg: '#E6F1FB', titleColor: '#0C447C', subColor: '#185FA5' },
  sliding:  { bg: '#FAEEDA', titleColor: '#633806', subColor: '#854F0B' },
  cooldown: { bg: '#EAF3DE', titleColor: '#27500A', subColor: '#3B6D11' },
};

const ALERT_STYLES: Record<string, string> = {
  yellow: 'bg-[#FAEEDA] text-[#633806] border-l-[3px] border-[#EF9F27]',
  green:  'bg-[#EAF3DE] text-[#27500A] border-l-[3px] border-[#639922]',
  blue:   'bg-[#E6F1FB] text-[#0C447C] border-l-[3px] border-[#378ADD]',
  purple: 'bg-[#EEEDFE] text-[#3C3489] border-l-[3px] border-[#7F77DD]',
};

interface PhaseSectionProps {
  phase: Phase;
}

export default function PhaseSection({ phase }: PhaseSectionProps) {
  const style = PHASE_STYLES[phase.id] ?? PHASE_STYLES.warmup;

  return (
    <div className="mb-4">
      {/* Phase Header */}
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl mb-3"
        style={{ background: style.bg }}
      >
        <span className="text-lg">{phase.icon}</span>
        <span className="text-[13px] font-medium" style={{ color: style.titleColor }}>
          {phase.title}
        </span>
        <span className="text-[11px] ml-auto" style={{ color: style.subColor }}>
          {phase.subtitle}
        </span>
      </div>

      {/* Today Sliding Box */}
      {phase.todaySliding && (
        <div className="flex justify-between items-center bg-[#FAEEDA] rounded-xl px-4 py-3 mb-3">
          <div>
            <p className="text-[13px] font-medium text-[#633806]">오늘 슬라이딩보드 목표 시간</p>
            <p className="text-[11px] text-[#854F0B] mt-0.5">{phase.todaySliding.note}</p>
          </div>
          <p className="text-[22px] font-medium text-[#854F0B]">{phase.todaySliding.time}</p>
        </div>
      )}

      {/* Alert Box */}
      {phase.alert && (
        <div className={`rounded-xl px-3.5 py-2.5 mb-3 text-[13px] leading-relaxed ${ALERT_STYLES[phase.alert.variant]}`}>
          {phase.alert.text}
        </div>
      )}

      {/* Exercises */}
      <div className="flex flex-col gap-1.5">
        {phase.exercises.map((ex, i) => (
          <ExerciseCard key={i} exercise={ex} />
        ))}
      </div>
    </div>
  );
}
