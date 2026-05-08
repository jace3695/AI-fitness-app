import { FlowItem } from '../data/workouts';

interface FlowDiagramProps {
  flow: FlowItem[];
}

export default function FlowDiagram({ flow }: FlowDiagramProps) {
  return (
    <div className="flex items-stretch gap-0 mb-5">
      {flow.map((step, i) => (
        <div key={i} className="flex items-center flex-1">
          <div
            className="flex-1 rounded-xl px-1.5 py-2 text-center"
            style={{ background: step.bgColor }}
          >
            <div className="text-[13px] mb-0.5">{step.icon}</div>
            <p className="text-[9.5px] font-medium mb-0.5" style={{ color: step.labelColor }}>
              {step.label}
            </p>
            <p className="text-[9.5px]" style={{ color: step.timeColor }}>
              {step.time}
            </p>
          </div>
          {i < flow.length - 1 && (
            <div className="text-gray-300 text-[11px] px-0.5 shrink-0">→</div>
          )}
        </div>
      ))}
    </div>
  );
}
