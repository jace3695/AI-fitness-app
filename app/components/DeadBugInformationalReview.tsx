'use client';

import { useState } from 'react';
import DeadBugReviewDemo from './DeadBugReviewDemo';

/** Explicitly opened reference only. Closing removes all player state and effects. */
export default function DeadBugInformationalReview() {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-xl border border-indigo-200 bg-indigo-50 p-3" onToggle={event => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
    }}>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-indigo-900">
        데드버그 동작 설명 보기 · 개인 추천 아님
      </summary>
      <p className="mb-3 text-xs leading-relaxed text-slate-700">
        두 변형의 움직임을 비교하는 설명입니다. 개인에게 할 운동을 정하거나 운동표에 추가하지 않습니다.
        직접 재생해야 움직이며, 닫으면 재생·변형 선택·동작 위치가 초기화됩니다.
      </p>
      {open ? <DeadBugReviewDemo mode="information" /> : null}
    </details>
  );
}
