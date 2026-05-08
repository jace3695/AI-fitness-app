import { SAFETY } from '../data/workouts';

export default function SafetyView() {
  return (
    <div>
      <p className="text-[16px] font-medium text-gray-800 mb-3">주의사항</p>
      <div className="bg-[#FAEEDA] text-[#633806] border-l-[3px] border-[#EF9F27] rounded-xl px-3.5 py-2.5 text-[13px] mb-4">
        🦴 <strong>절대 금지:</strong> {SAFETY.forbidden}
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        {SAFETY.signals.map((s, i) => (
          <div
            key={i}
            className="flex gap-3 rounded-xl px-3.5 py-2.5 items-center"
            style={{ background: s.bg }}
          >
            <span className="font-medium text-[13px] min-w-[110px]" style={{ color: s.labelColor }}>
              {s.label}
            </span>
            <span className="text-[13px]" style={{ color: s.textColor }}>
              {s.action}
            </span>
          </div>
        ))}
      </div>

      <div className="bg-[#EEEDFE] text-[#3C3489] border-l-[3px] border-[#7F77DD] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed">
        {SAFETY.cpap}
      </div>
    </div>
  );
}
