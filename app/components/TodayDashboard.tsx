"use client";


interface TodayDashboardProps {
  workoutDone: boolean;
  workoutPain: boolean;
  recoveryRecommended: boolean;
  recoveryCompleted: boolean;
  onOpenWorkout: () => void;
  onOpenRecord: () => void;
}

function statusTone(done: boolean) {
  return done
    ? "border-emerald-100 bg-emerald-50 text-emerald-800"
    : "border-gray-100 bg-white text-gray-800";
}

export default function TodayDashboard({
  workoutDone,
  workoutPain,
  recoveryRecommended,
  recoveryCompleted,
  onOpenWorkout,
  onOpenRecord,
}: TodayDashboardProps) {
  const completedCount = [
    workoutDone || recoveryCompleted,
  ].filter(Boolean).length;
  const progress = completedCount * 100;

  const items = [
    {
      label: "운동",
      value: recoveryCompleted ? "회복 완료" : workoutDone ? "완료" : recoveryRecommended ? "조절 필요" : "진행 전",
      sub: workoutPain ? "통증 기록 확인 필요" : recoveryRecommended ? "상태 체크 결과 반영" : "오늘 계획 기준",
      done: workoutDone || recoveryCompleted,
      onClick: workoutPain ? onOpenRecord : onOpenWorkout,
    },
  ];

  return (
    <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">오늘 체크</p>
          <h3 className="mt-1 text-[18px] font-bold text-gray-900">
            오늘 운동 상태
          </h3>
        </div>
        <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[12px] font-bold text-[#3C3489]">
          {progress}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-[#534AB7] transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {(recoveryRecommended || workoutPain) && (
        <button
          type="button"
          onClick={onOpenRecord}
          className="mt-3 w-full rounded-2xl bg-amber-50 px-3 py-2.5 text-left text-[12px] font-semibold leading-relaxed text-amber-900"
        >
          {workoutPain
            ? "통증 기록이 있습니다. 오늘 기록을 확인하고 운동 강도를 낮추세요."
            : "오늘 상태 체크에 따라 운동 강도 조절 또는 회복이 권장됩니다. 운동 화면에서 권장 강도를 확인하세요."}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={`rounded-2xl border p-3 text-left transition active:scale-[0.99] ${statusTone(item.done)}`}
          >
            <span className="block text-[11px] opacity-65">{item.label}</span>
            <span className="mt-1 block text-[15px] font-bold">
              {item.value}
            </span>
            <span className="mt-1 block text-[10px] opacity-65">{item.sub}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        14시간 공복은 주 5일 목표이며, 컨디션 저하일의 12시간 조절도 오늘
        관리에 반영됩니다. 24시간 단식은 포함하지 않습니다.
      </p>
    </section>
  );
}
