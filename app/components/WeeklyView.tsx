"use client";

import {
  getWorkoutGroupForPlanDay,
  WeeklyWorkoutPlan,
} from "../data/workoutPlans";
import { WorkoutDayId } from "../data/workoutCompletion";

interface WeeklyViewProps {
  onTabChange: (id: string) => void;
  completedDays: Record<WorkoutDayId, boolean>;
  painDays: Record<WorkoutDayId, boolean>;
  todayDayId: WorkoutDayId | null;
  plans: WeeklyWorkoutPlan[];
  selectedPlanId: string;
  onPlanChange: (planId: string) => void;
}

const DAY_ITEMS: { id: WorkoutDayId; short: string; label: string }[] = [
  { id: "mon", short: "월", label: "월요일" },
  { id: "tue", short: "화", label: "화요일" },
  { id: "wed", short: "수", label: "수요일" },
  { id: "thu", short: "목", label: "목요일" },
  { id: "fri", short: "금", label: "금요일" },
  { id: "sat", short: "토", label: "토요일" },
  { id: "sun", short: "일", label: "일요일" },
];

const CATEGORY_LABEL = {
  cardio: "유산소",
  core: "코어",
  strength: "근력",
  recovery: "회복",
  rest: "휴식",
} as const;

const INTENSITY_LABEL = {
  low: "저강도",
  medium: "중강도",
  high: "고강도",
} as const;

function getDayEmoji(category: keyof typeof CATEGORY_LABEL, optional: boolean) {
  if (optional) return "🚶";
  if (category === "rest") return "😴";
  if (category === "recovery") return "🌿";
  if (category === "strength") return "💪";
  if (category === "core") return "🧘";
  return "🏃";
}

export default function WeeklyView({
  onTabChange,
  completedDays,
  painDays,
  todayDayId,
  plans,
  selectedPlanId,
  onPlanChange,
}: WeeklyViewProps) {
  const selectedPlan =
    plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const schedule = DAY_ITEMS.map((day) => {
    const group = getWorkoutGroupForPlanDay(selectedPlan, day.id);
    return {
      ...day,
      group,
      optional: group.type === "choice",
      rest: group.category === "rest",
      completed: completedDays[day.id],
      pain: painDays[day.id],
    };
  });
  const requiredDays = schedule.filter((day) => !day.rest && !day.optional);
  const optionalDays = schedule.filter((day) => day.optional);
  const completedRequired = requiredDays.filter((day) => day.completed).length;
  const painCount = schedule.filter((day) => day.pain).length;
  const progress =
    requiredDays.length > 0
      ? Math.round((completedRequired / requiredDays.length) * 100)
      : 0;
  const nextPlanIndex = plans.findIndex((plan) => plan.id === selectedPlan.id) + 1;
  const nextPlan = plans[nextPlanIndex];
  const recommendation =
    painCount > 0
      ? {
          tone: "border-amber-100 bg-amber-50 text-amber-900",
          title: "현재 계획 유지·회복 우선",
          body: `이번 주 통증 기록이 ${painCount}일 있습니다. 다음 단계로 올리기보다 통증과 저림이 가라앉는지 먼저 확인하세요.`,
        }
      : completedRequired === requiredDays.length && requiredDays.length > 0
        ? {
            tone: "border-emerald-100 bg-emerald-50 text-emerald-900",
            title: nextPlan ? "다음 단계 검토 가능" : "현재 리듬 유지",
            body: nextPlan
              ? `필수 계획을 모두 마쳤습니다. 다음 주에 몸 상태가 괜찮다면 ‘${nextPlan.weekLabel}’ 계획을 직접 선택할 수 있습니다.`
              : "필수 계획을 모두 마쳤습니다. 같은 계획을 유지하며 무게와 횟수는 천천히 조절하세요.",
          }
        : {
            tone: "border-blue-100 bg-blue-50 text-blue-900",
            title: "현재 계획을 이어가세요",
            body: `필수 운동 ${requiredDays.length}일 중 ${completedRequired}일을 완료했습니다. 남은 계획은 통증 없는 범위에서 진행하세요.`,
          };

  return (
    <div className="min-w-0">
      <details className="mb-5 rounded-2xl border border-[#D9D6FF] bg-white shadow-sm">
        <summary className="cursor-pointer list-none p-4">
          <p className="text-[14px] font-bold text-[#3C3489]">이번 주 운동 계획 바꾸기</p>
          <p className="mt-1 text-[12px] text-gray-500">현재 계획: {selectedPlan.name}</p>
        </summary>
        <section className="border-t border-[#EEEDFE] p-4">
        <div className="mb-3">
          <p className="text-[14px] font-bold text-[#3C3489]">
            이번 주 운동 계획
          </p>
          <p className="mt-1 text-[12px] text-gray-500">
            컨디션과 목표에 맞춰 이번 주에 사용할 계획을 선택하세요.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              aria-pressed={selectedPlanId === plan.id}
              onClick={() => onPlanChange(plan.id)}
              className={`rounded-xl border px-3 py-3 text-left transition ${
                selectedPlanId === plan.id
                  ? "border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]"
                  : "border-gray-100 bg-gray-50 text-gray-600"
              }`}
            >
              <span className="block text-[13px] font-bold">{plan.name}</span>
              <span className="mt-1 block text-[11px] leading-relaxed opacity-80">
                {plan.recommendedFor}
              </span>
            </button>
          ))}
        </div>
        {selectedPlan.notice && (
          <p className="mt-3 rounded-xl bg-[#EAF3DE] px-3 py-2 text-[12px] leading-relaxed text-[#27500A]">
            {selectedPlan.notice}
          </p>
        )}
        </section>
      </details>

      <section className="mb-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-[#534AB7]">
              {selectedPlan.weekLabel} 진행률
            </p>
            <p className="mt-1 text-[20px] font-bold text-gray-900">
              필수 운동 {completedRequired}/{requiredDays.length}일
            </p>
          </div>
          <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[12px] font-bold text-[#3C3489]">
            {progress}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={`${selectedPlan.weekLabel} 필수 운동 진행률`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"
        >
          <div
            className="h-full rounded-full bg-[#534AB7] transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] text-gray-400">필수 계획</p>
            <p className="mt-1 text-[17px] font-bold text-gray-800">
              {requiredDays.length}일
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] text-gray-400">선택 운동</p>
            <p className="mt-1 text-[17px] font-bold text-gray-800">
              {optionalDays.length}일
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] text-gray-400">통증 기록</p>
            <p
              className={`mt-1 text-[17px] font-bold ${
                painCount > 0 ? "text-amber-700" : "text-gray-800"
              }`}
            >
              {painCount}일
            </p>
          </div>
        </div>
      </section>

      <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-gray-400">
        선택한 계획의 7일 일정
      </p>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {schedule.map((day) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onTabChange(day.id)}
            className={`min-w-0 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
              day.id === todayDayId
                ? "border-[#7F77DD] bg-[#EEEDFE]"
                : "border-gray-100 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-gray-500">
                {day.short}
                {day.id === todayDayId ? " · 오늘" : ""}
              </span>
              <span>{getDayEmoji(day.group.category, day.optional)}</span>
            </div>
            <p className="mt-2 min-h-10 break-keep text-[12px] font-bold leading-snug text-gray-900">
              {day.group.name}
            </p>
            <p className="mt-1 text-[10px] text-gray-500">
              {day.group.duration}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[9px] font-semibold text-gray-600">
                {day.optional
                  ? "선택"
                  : CATEGORY_LABEL[day.group.category]}
              </span>
              {!day.rest && (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[9px] font-semibold text-gray-600">
                  {INTENSITY_LABEL[day.group.intensity]}
                </span>
              )}
            </div>
            <p
              className={`mt-2 text-[10px] font-bold ${
                day.pain
                  ? "text-amber-700"
                  : day.completed
                    ? "text-emerald-700"
                    : "text-gray-400"
              }`}
            >
              {day.pain
                ? day.completed
                  ? "완료 · 통증 확인"
                  : "통증 확인"
                : day.completed
                  ? "완료"
                  : day.rest
                    ? "회복일"
                    : day.optional
                      ? "선택 가능"
                      : "진행 전"}
            </p>
          </button>
        ))}
      </div>

      <section
        className={`mb-5 rounded-2xl border p-4 text-[12px] leading-relaxed ${recommendation.tone}`}
      >
        <p className="font-bold">{recommendation.title}</p>
        <p className="mt-1">{recommendation.body}</p>
      </section>

      <button
        type="button"
        onClick={() => onTabChange("pullup")}
        className="mb-5 w-full rounded-2xl border border-[#AFA9EC] bg-[#EEEDFE] px-4 py-3 text-left shadow-sm transition hover:bg-[#E3E1FD]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-[#3C3489]">
              철봉 단계 훈련
            </p>
            <p className="mt-0.5 text-[12px] text-[#534AB7]">
              매일 3~5분 턱걸이 초기자세 연습
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#534AB7]">
            입장
          </span>
        </div>
      </button>

      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[13px] leading-relaxed text-blue-900">
        <p className="font-bold">{selectedPlan.name}</p>
        <p className="mt-1">{selectedPlan.description}</p>
        <p className="mt-2 text-[11px] text-blue-700">
          단계는 자동 변경되지 않습니다. 한 주 기록과 통증 상태를 확인한 뒤
          직접 선택하세요.
        </p>
      </section>
    </div>
  );
}
