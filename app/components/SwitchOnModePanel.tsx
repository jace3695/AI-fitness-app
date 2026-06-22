'use client';

import { RoutineSelection } from '../data/workouts';

export type SwitchOnMode = RoutineSelection;

interface RoutineSelectionPanelProps {
  selection: RoutineSelection;
  onSelectionChange: (value: RoutineSelection) => void;
}

const OPTIONS: { id: RoutineSelection; label: string; description: string }[] = [
  { id: 'base', label: '기본 주간 루틴', description: '시작일부터 사용하는 일반식 기반 기본 루틴' },
  { id: 'adapt1', label: '초기 적응 루틴 1일차', description: '재시작 첫날을 가볍게 여는 상체 활성화 루틴' },
  { id: 'adapt2', label: '초기 적응 루틴 2일차', description: '하체·엉덩이를 낮은 강도로 다시 깨우는 루틴' },
  { id: 'adapt3', label: '초기 적응 루틴 3일차', description: '슬라이딩보드 중심으로 강도를 천천히 올리는 루틴' },
  { id: 'recovery', label: '회복 운동 모드', description: '단식·피로·컨디션 저하 시 회복을 우선하는 루틴' },
];

export default function SwitchOnModePanel({ selection, onSelectionChange }: RoutineSelectionPanelProps) {
  const selected = OPTIONS.find((option) => option.id === selection) || OPTIONS[0];
  const showAdaptationRecommendation = selection === 'adapt1' || selection === 'adapt2' || selection === 'adapt3';

  return <section className="mb-4 rounded-2xl bg-white border border-gray-100 p-3 shadow-sm">
    <div className="mb-3">
      <p className="text-[14px] font-semibold text-gray-800">루틴 선택</p>
      <p className="mt-0.5 text-[12px] text-gray-400">현재 적용: {selected.label}</p>
      <p className="mt-2 rounded-xl bg-[#EAF3DE] px-3 py-2 text-[12px] text-[#27500A]">식단 단계와 운동 루틴은 분리되어 있습니다. 식단 1주차여도 운동은 기본 주간 루틴이 기본값입니다.</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
      {OPTIONS.map((option) => <button key={option.id} type="button" onClick={() => onSelectionChange(option.id)} className={`rounded-xl px-2 py-2 text-left text-[12px] font-medium border ${selection === option.id ? 'bg-[#EEEDFE] text-[#3C3489] border-[#AFA9EC]' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
        <span className="block font-bold">{option.label}</span>
        <span className="mt-0.5 block text-[10px] opacity-80">{option.description}</span>
      </button>)}
    </div>
    {showAdaptationRecommendation && <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
      <p className="font-bold">초기 적응 루틴 권장 상황</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>운동을 1주 이상 쉬고 다시 시작할 때</li>
        <li>수면 부족이나 피로가 누적된 뒤 재개할 때</li>
        <li>기본 루틴이 부담스럽게 느껴질 때</li>
        <li>허리 통증이나 다리 저림은 없지만 강도를 낮춰 재시작하고 싶을 때</li>
      </ul>
    </div>}
  </section>;
}
