"use client";

import { WEEK_OVERVIEW } from "../data/workouts";

interface WeeklyViewProps {
  onTabChange: (id: string) => void;
  completedDays: Record<
    "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat",
    boolean
  >;
}

export default function WeeklyView({
  onTabChange,
  completedDays,
}: WeeklyViewProps) {
  const { stats, days, dayTimes, afterMonth } = WEEK_OVERVIEW;

  return (
    <div>
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {stats.map((s, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-3">
            <p className="text-[11px] text-gray-400 mb-0.5">{s.label}</p>
            <p className="text-[19px] font-medium text-gray-800">
              {s.value}
              <span className="text-[12px] font-normal"> {s.unit}</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Pull-up Training Entry */}
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

      {/* 7-day Week Grid */}
      <div className="grid grid-cols-7 gap-1.5 mb-5">
        {days.map((d, i) => (
          <div
            key={i}
            className={`rounded-xl py-2 px-1 text-center border transition-colors ${
              d.active
                ? "cursor-pointer hover:opacity-80"
                : "bg-gray-50 cursor-default"
            }`}
            style={
              d.active ? { borderColor: d.border } : { borderColor: "#E5E7EB" }
            }
            onClick={() => d.active && d.tabId && onTabChange(d.tabId)}
          >
            <p className="text-[10px] text-gray-400 mb-0.5">{d.day}</p>
            <div className="text-[15px] my-0.5">{d.emoji}</div>
            <p
              className="text-[9px] font-medium leading-tight"
              style={{ color: d.active ? d.color : "#9CA3AF" }}
            >
              {d.label}
            </p>
            <p className="text-[9px] text-gray-400 mt-0.5">{d.sub}</p>
            <span
              className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1"
              style={
                d.active
                  ? { background: d.bg, color: d.color }
                  : { background: "#F3F4F6", color: "#9CA3AF" }
              }
            >
              {d.time}
            </span>
            {d.active && d.tabId && (
              <p
                className={`text-[9px] font-medium mt-1 ${
                  completedDays[d.tabId as keyof typeof completedDays]
                    ? "text-green-600"
                    : "text-gray-300"
                }`}
              >
                {completedDays[d.tabId as keyof typeof completedDays]
                  ? "완료"
                  : "미완료"}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Day-time Grid */}
      <p className="text-[12px] font-medium text-gray-400 uppercase tracking-wide mb-2">
        요일별 운동 시간
      </p>
      <div className="grid grid-cols-7 gap-1.5 mb-5">
        {dayTimes.map((dt, i) => (
          <div
            key={i}
            className="rounded-xl p-2.5 text-center border"
            style={
              dt.color
                ? { borderColor: dt.border }
                : { background: "#F9FAFB", borderColor: "#E5E7EB" }
            }
          >
            <p
              className="text-[12px] font-medium mb-0.5"
              style={{ color: dt.color || "#9CA3AF" }}
            >
              {dt.days}
            </p>
            <p
              className="text-[17px] font-medium mb-0.5"
              style={{
                color: dt.color || "#9CA3AF",
                fontSize: dt.total === "휴식" ? "14px" : undefined,
              }}
            >
              {dt.total}
            </p>
            <p className="text-[10px] text-gray-400 whitespace-pre-line leading-relaxed">
              {dt.detail}
            </p>
          </div>
        ))}
      </div>

      {/* Flow Diagram */}
      <p className="text-[12px] font-medium text-gray-400 uppercase tracking-wide mb-2">
        하루 운동 흐름
      </p>
      <div className="flex items-stretch gap-0 mb-3">
        {[
          {
            icon: "📿",
            label: "묵주기도 슬라이딩",
            time: "15~20분",
            bg: "#EEEDFE",
            lc: "#3C3489",
            tc: "#534AB7",
          },
          {
            icon: "💪",
            label: "근력/안정화 A/B/C",
            time: "15~20분",
            bg: "#E6F1FB",
            lc: "#0C447C",
            tc: "#185FA5",
          },
          {
            icon: "🧗",
            label: "턱걸이 초기자세",
            time: "3~5분",
            bg: "#FAEEDA",
            lc: "#633806",
            tc: "#854F0B",
          },
          {
            icon: "🏂",
            label: "슬라이딩보드 마무리",
            time: "0~20분",
            bg: "#EAF3DE",
            lc: "#27500A",
            tc: "#3B6D11",
          },
        ].map((s, i, arr) => (
          <div key={i} className="flex items-center flex-1">
            <div
              className="flex-1 rounded-xl px-1.5 py-2 text-center"
              style={{ background: s.bg }}
            >
              <div className="text-[13px] mb-0.5">{s.icon}</div>
              <p
                className="text-[9.5px] font-medium mb-0.5"
                style={{ color: s.lc }}
              >
                {s.label}
              </p>
              <p className="text-[9.5px]" style={{ color: s.tc }}>
                {s.time}
              </p>
            </div>
            {i < arr.length - 1 && (
              <div className="text-gray-300 text-[11px] px-0.5 shrink-0">→</div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end items-center gap-2 mb-4">
        <span className="text-[12px] text-gray-400">근력일 총 시간</span>
        <span className="bg-[#534AB7] text-white text-[11px] font-medium px-2.5 py-1 rounded-full">
          약 40분+
        </span>
      </div>

      {/* Info Box */}
      <div className="bg-[#E6F1FB] text-[#0C447C] border-l-[3px] border-[#378ADD] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed">
        💡 월~금은 1개월 감량 집중기 운동일입니다. 묵주기도 슬라이딩보드 → 근력/안정화 A/B/C/D/E →
        턱걸이 초기자세 → 슬라이딩보드 마무리 순서로 진행하고, 토요일은 선택 유산소 또는 휴식, 일요일은 휴식입니다.
      </div>

      <div className="mt-4 rounded-2xl border border-[#AFA9EC] bg-white p-4 text-[13px] text-gray-700 shadow-sm">
        <p className="font-bold text-[#3C3489]">1개월 이후 유지/조절기 안내</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {afterMonth.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      <div className="mt-4 rounded-2xl border border-green-100 bg-green-50 p-4 text-[13px] leading-relaxed text-green-800">
        <p className="font-bold">이번 달 감량 목표</p>
        <p className="mt-1">현실 목표: 2~4kg · 공격 목표: 4~6kg</p>
        <p className="mt-1">10kg 이상 감량은 2~3개월 이상 장기 목표로 관리합니다. 무리한 감량보다 허리 통증 없이 지속하는 것을 우선합니다.</p>
      </div>
    </div>
  );
}
