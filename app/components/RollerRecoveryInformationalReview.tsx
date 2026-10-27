'use client';

import { useState } from 'react';
import RollerRecoveryReviewDemo from './RollerRecoveryReviewDemo';

/** Explicit information disclosure only. Closing unmounts the shared staged player. */
export default function RollerRecoveryInformationalReview() {
  const [open, setOpen] = useState(false);
  return <details className="rounded-xl border border-indigo-200 bg-indigo-50 p-3" onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-indigo-900">
      폼롤러 일반 동작 설명 보기 · 바깥 허벅지는 새 정의
    </summary>
    <p className="mb-3 text-xs leading-relaxed text-slate-700">
      바깥 허벅지는 외측 대퇴사두근을 대상으로 새로 정의한 정보용 그림입니다.
      원 안내의 대상 조직을 확인한 것이 아니며, 개인 운동 추천이나 기존 시간·횟수의 검증이 아닙니다.
      직접 재생해야 움직이며, 닫으면 재생·단계·동작 위치가 초기화됩니다.
    </p>
    <p className="mb-3 text-xs leading-relaxed text-slate-700">
      자세 원리 참고: <a className="text-indigo-700 underline" href="https://intraining.com.au/how-to-use-your-itb-roller-for-recovery/" target="_blank" rel="noopener noreferrer">물리치료사의 외측 대퇴사두근 설명</a>
      {' · '}<a className="text-indigo-700 underline" href="https://www.joionline.net/library/foam-roller/" target="_blank" rel="noopener noreferrer">JOI의 대상·제외 부위 안내</a>.
      이 출처가 이 그림이나 개인의 수행 적합성을 검수했다는 뜻은 아닙니다.
    </p>
    {open ? <RollerRecoveryReviewDemo /> : null}
  </details>;
}
