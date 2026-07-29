'use client';

import { useEffect, useState } from 'react';
import {
  CONDITION_SIGNAL_OPTIONS,
  ConditionSignalId,
  DailyConditionRecord,
  getConditionRecommendation,
} from '../data/recoveryMode';

interface ConditionCheckCardProps {
  value?: DailyConditionRecord;
  onSave: (signals: ConditionSignalId[], memo: string) => void;
  onClear: () => void;
}

const RECOMMENDATION_COPY = {
  normal: {
    label: '정상 강도',
    description: '오늘 계획을 진행하되 몸풀기부터 천천히 시작하세요.',
    tone: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  },
  '70%': {
    label: '약 70%로 조절',
    description: '세트·시간·속도를 줄이고 증상이 커지면 회복으로 전환하세요.',
    tone: 'border-amber-100 bg-amber-50 text-amber-900',
  },
  recovery: {
    label: '회복 우선',
    description: '오늘의 강한 운동은 건너뛰고 가벼운 회복만 진행하세요.',
    tone: 'border-red-100 bg-red-50 text-red-800',
  },
} as const;

export default function ConditionCheckCard({ value, onSave, onClear }: ConditionCheckCardProps) {
  const [signals, setSignals] = useState<ConditionSignalId[]>(value?.signals ?? []);
  const [memo, setMemo] = useState(value?.memo ?? '');

  useEffect(() => {
    setSignals(value?.signals ?? []);
    setMemo(value?.memo ?? '');
  }, [value?.updatedAt, value?.memo, value?.signals]);

  const recommendation = getConditionRecommendation(signals);
  const copy = RECOMMENDATION_COPY[recommendation];

  const toggleSignal = (signal: ConditionSignalId) => {
    setSignals((current) => {
      const withoutOpposite = signal === 'mild-back-discomfort'
        ? current.filter((item) => item !== 'marked-back-pain')
        : signal === 'marked-back-pain'
          ? current.filter((item) => item !== 'mild-back-discomfort')
          : current;
      return withoutOpposite.includes(signal)
        ? withoutOpposite.filter((item) => item !== signal)
        : [...withoutOpposite, signal];
    });
  };

  const renderGroup = (group: 'body' | 'condition') => (
    <div className="mt-2 flex flex-wrap gap-2">
      {CONDITION_SIGNAL_OPTIONS.filter((option) => option.group === group).map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={signals.includes(option.id)}
          onClick={() => toggleSignal(option.id)}
          className={`rounded-full border px-3 py-2 text-[12px] font-bold ${
            signals.includes(option.id)
              ? 'border-[#7F77DD] bg-[#EEEDFE] text-[#3C3489]'
              : 'border-gray-100 bg-gray-50 text-gray-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">운동 전 30초 체크</p>
          <h3 className="mt-1 text-[18px] font-bold text-gray-900">오늘 몸 상태</h3>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${copy.tone}`}>
          {copy.label}
        </span>
      </div>

      <p className="mt-4 text-[12px] font-bold text-gray-700">통증·저림</p>
      {renderGroup('body')}
      <p className="mt-4 text-[12px] font-bold text-gray-700">전반적인 컨디션</p>
      {renderGroup('condition')}

      <div className={`mt-4 rounded-2xl border p-3 text-[12px] leading-relaxed ${copy.tone}`}>
        <p className="font-bold">{copy.label}</p>
        <p className="mt-1">{copy.description}</p>
      </div>

      <label className="mt-4 block text-[12px] font-bold text-gray-700">
        메모
        <textarea
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="어느 부위가 언제부터 불편한지 입력"
          className="mt-2 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-normal"
        />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSave(signals, memo)}
          className="rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-bold text-white"
        >
          {value ? '오늘 상태 수정 저장' : '오늘 상태 저장'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSignals([]);
            setMemo('');
            onClear();
          }}
          className="rounded-xl bg-gray-100 px-4 py-3 text-[13px] font-bold text-gray-600"
        >
          기록 초기화
        </button>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-red-600">
        양쪽 다리의 심해지는 저림·무력, 대소변 변화, 회음부 감각 저하는 앱 판단 대상이 아닙니다. 이런 증상은 운동하지 말고 즉시 응급 진료를 받으세요.
      </p>
    </section>
  );
}
