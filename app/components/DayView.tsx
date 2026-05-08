import { DayWorkout } from '../data/workouts';
import FlowDiagram from './FlowDiagram';
import PhaseSection from './PhaseSection';

interface DayViewProps {
  day: DayWorkout;
}

export default function DayView({ day }: DayViewProps) {
  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-[17px] font-medium text-gray-800">{day.title}</p>
          <p className="text-[12px] text-gray-400 mt-0.5">{day.subtitle}</p>
        </div>
        <span
          className="text-white text-[11px] font-medium px-3 py-1 rounded-full shrink-0 ml-2"
          style={{ background: day.badgeBg }}
        >
          {day.totalTime}
        </span>
      </div>

      {/* Flow Diagram */}
      <FlowDiagram flow={day.flow} />

      {/* Phases */}
      {day.phases.map((phase, i) => (
        <PhaseSection key={i} phase={phase} />
      ))}
    </div>
  );
}
