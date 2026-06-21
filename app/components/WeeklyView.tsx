'use client';

import { WEEK_OVERVIEW } from '../data/workouts';

interface WeeklyViewProps {
  onTabChange: (id: string) => void;
  completedDays: Record<'mon' | 'tue' | 'thu' | 'fri' | 'sat', boolean>;
}

export default function WeeklyView({ onTabChange, completedDays }: WeeklyViewProps) {
  const { stats, days, dayTimes } = WEEK_OVERVIEW;

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
        onClick={() => onTabChange('pullup')}
        className="mb-5 w-full rounded-2xl border border-[#AFA9EC] bg-[#EEEDFE] px-4 py-3 text-left shadow-sm transition hover:bg-[#E3E1FD]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-[#3C3489]">철봉 단계 훈련</p>
            <p className="mt-0.5 text-[12px] text-[#534AB7]">월·토 루틴과 연결된 5단계 턱걸이 준비 모드</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#534AB7]">입장</span>
        </div>
      </button>

      {/* 7-day Week Grid */}
      <div className="grid grid-cols-7 gap-1.5 mb-5">
        {days.map((d, i) => (
          
          <div
            key={i}
            className={`rounded-xl py-2 px-1 text-center border transition-colors ${
              d.active
                ? 'cursor-pointer hover:opacity-80'
                : 'bg-gray-50 cursor-default'
            }`}
            style={d.active ? { borderColor: d.border } : { borderColor: '#E5E7EB' }}
            onClick={() => d.active && d.tabId && onTabChange(d.tabId)}
          >
            <p className="text-[10px] text-gray-400 mb-0.5">{d.day}</p>
            <div className="text-[15px] my-0.5">{d.emoji}</div>
            <p
              className="text-[9px] font-medium leading-tight"
              style={{ color: d.active ? d.color : '#9CA3AF' }}
            >
              {d.label}
            </p>
            <p className="text-[9px] text-gray-400 mt-0.5">{d.sub}</p>
            <span
              className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1"
              style={
                d.active
                  ? { background: d.bg, color: d.color }
                  : { background: '#F3F4F6', color: '#9CA3AF' }
              }
            >
              {d.time}
            </span>
            {d.active && d.tabId && (
              <p
                className={`text-[9px] font-medium mt-1 ${
                  completedDays[d.tabId as keyof typeof completedDays]
                    ? 'text-green-600'
                    : 'text-gray-300'
                }`}
              >
                {completedDays[d.tabId as keyof typeof completedDays] ? '완료' : '미완료'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Day-time Grid */}
      <p className="text-[12px] font-medium text-gray-400 uppercase tracking-wide mb-2">
        요일별 운동 시간
      </p>
      <div className="grid grid-cols-5 gap-1.5 mb-5">
        {dayTimes.map((dt, i) => (
          <div
            key={i}
            className="rounded-xl p-2.5 text-center border"
            style={
              dt.color
                ? { borderColor: dt.border }
                : { background: '#F9FAFB', borderColor: '#E5E7EB' }
            }
          >
            <p
              className="text-[12px] font-medium mb-0.5"
              style={{ color: dt.color || '#9CA3AF' }}
            >
              {dt.days}
            </p>
            <p
              className="text-[17px] font-medium mb-0.5"
              style={{ color: dt.color || '#9CA3AF', fontSize: dt.total === '휴식' ? '14px' : undefined }}
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
          { icon: '🧘', label: '준비운동', time: '10분', bg: '#EEEDFE', lc: '#3C3489', tc: '#534AB7' },
          { icon: '💪', label: '본 운동', time: '30~35분', bg: '#E6F1FB', lc: '#0C447C', tc: '#185FA5' },
          { icon: '🏂', label: '슬라이딩보드', time: '20~25분', bg: '#FAEEDA', lc: '#633806', tc: '#854F0B' },
          { icon: '🌿', label: '마무리 스트레칭', time: '5~8분', bg: '#EAF3DE', lc: '#27500A', tc: '#3B6D11' },
        ].map((s, i, arr) => (
          <div key={i} className="flex items-center flex-1">
            <div className="flex-1 rounded-xl px-1.5 py-2 text-center" style={{ background: s.bg }}>
              <div className="text-[13px] mb-0.5">{s.icon}</div>
              <p className="text-[9.5px] font-medium mb-0.5" style={{ color: s.lc }}>{s.label}</p>
              <p className="text-[9.5px]" style={{ color: s.tc }}>{s.time}</p>
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
          약 65~70분
        </span>
      </div>

      {/* Info Box */}
      <div className="bg-[#E6F1FB] text-[#0C447C] border-l-[3px] border-[#378ADD] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed">
        💡 각 요일 탭 하나에 준비운동 · 본 운동 · 슬라이딩보드 · 마무리 스트레칭이 모두 담겨 있습니다.
        해당 요일 탭만 열면 그날 운동을 처음부터 끝까지 진행할 수 있습니다.
      </div>
    </div>
  );
}
