'use client';

const examples = ['내 기록을 보고 오늘 할 일을 조언해줘', '오늘 자기계발 현황 알려줘', '타자 연습 완료했어', '오늘 일본어 학습 진도 알려줘', '오늘 운동 계획 보여줘'];
export default function AssistantPromptExamples({ disabled, hasDraft, onSelect }: { disabled: boolean; hasDraft: boolean; onSelect: (text: string) => void }) {
  return <details className="mt-3 rounded-xl border border-gray-100 px-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-700">무슨 말을 할지 모르겠다면 · 예시 보기</summary>
    <p className="mb-2 text-sm text-gray-600">예시를 고르면 입력칸만 채워져요. 내용을 확인한 뒤 보내 주세요.</p>
    {hasDraft && <p className="mb-2 text-sm text-gray-600">작성 중인 말이 있어요. 다른 예시를 고르려면 입력칸을 먼저 비워 주세요.</p>}
    <div aria-label="추천 질문" className="flex flex-wrap gap-2 pb-3">{examples.map(sample => <button key={sample} type="button" disabled={disabled || hasDraft} onClick={() => { if (!disabled && !hasDraft) onSelect(sample); }} className="min-h-11 max-w-full rounded-xl border border-[#D6D1F3] bg-[#F1EFFF] px-3 py-2 text-left text-sm font-semibold text-[#5146A6] disabled:opacity-50">{sample}</button>)}</div>
  </details>;
}
