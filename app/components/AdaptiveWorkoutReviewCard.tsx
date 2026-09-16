'use client';

import { useState } from 'react';
import { buildAdaptiveWorkoutReview, decideAdaptiveWorkoutReview } from '../data/workoutAdaptiveReview';
import type { AdaptiveReviewInput, AdaptiveWorkoutReview } from '../data/workoutAdaptiveReview';
import { readRecordStores } from '../data/recordStorage';
import { readUserWorkoutSettings } from '../data/userWorkoutSettings';
import type { UserWorkoutSettings } from '../data/userWorkoutSettings';
import { DEFAULT_WEEKLY_WORKOUT_PLAN_ID, SELECTED_WEEKLY_WORKOUT_PLAN_KEY } from '../data/workoutPlans';
import { getLocalDateKey } from '../data/dietPlans';
import { getExerciseGuide } from '../data/exerciseGuides';

const ACTION_LABELS = { maintain: '유지', increase: '증가', replace: '교체', decrease: '감소', hold: '증상 확인' };

interface Props {
  input: AdaptiveReviewInput;
  onApply: (settings: UserWorkoutSettings) => void;
  onRefresh: () => void;
}

export default function AdaptiveWorkoutReviewCard({ input, onApply, onRefresh }: Props) {
  const review = buildAdaptiveWorkoutReview(input);
  const [notice, setNotice] = useState('');
  const confirm = (decision: 'applied' | 'kept', prepared: boolean) => {
    try {
      const stores = readRecordStores();
      const freshInput: AdaptiveReviewInput = {
        settings: readUserWorkoutSettings(), workouts: stores.workouts, conditions: stores.conditions,
        selectedPlanId: window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) || DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
        today: getLocalDateKey(),
      };
      const next = decideAdaptiveWorkoutReview(freshInput, review.id, decision, new Date().toISOString(), prepared);
      // The parent's callback persists before publishing the new React state.
      onApply(next);
      setNotice(decision === 'kept' || !review.change ? '현재 계획을 유지하기로 기록했습니다.' : '확인한 변경을 적용했습니다. 해당 요일의 운동 화면에서 확인할 수 있습니다.');
    } catch (error) {
      setNotice(error instanceof Error && /기록이나 계획|이미 확인|증상 확인|준비 조건/.test(error.message) ? error.message : '저장하지 못했습니다. 계획은 적용되지 않았습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.');
    }
    try { onRefresh(); } catch { setNotice('저장 상태를 다시 확인하지 못했습니다. 화면을 새로고침해 계획을 확인해 주세요.'); }
  };
  return (
    <section aria-label="기록에 따른 운동 조정" className="mb-4 rounded-3xl border border-violet-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-[#534AB7]">연이의 운동 조정 제안</p>
          <h3 className="mt-1 text-lg font-extrabold text-gray-900">재민님 기록에 맞춰 다음 운동을</h3>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${review.action === 'hold' ? 'bg-red-50 text-red-800' : review.action === 'decrease' ? 'bg-amber-50 text-amber-900' : 'bg-[#EEEDFE] text-[#534AB7]'}`}>{ACTION_LABELS[review.action]}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-600">최근 28일의 수행능력·허리 상태·피로를 확인합니다. 재민님이 확인해서 적용할 때 계획이 바뀝니다.</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-2xl bg-gray-50 p-3"><dt className="text-gray-500">비교할 기록</dt><dd className="mt-1 font-bold text-gray-900">{review.evidenceCount}회 <span className="block text-[11px] font-normal text-gray-500">근력 {review.strengthCount}회</span></dd></div>
        <div className="rounded-2xl bg-gray-50 p-3"><dt className="text-gray-500">최근 운동 후 허리</dt><dd className="mt-1 font-bold text-gray-900">{review.latestBack}</dd></div>
        <div className="rounded-2xl bg-gray-50 p-3"><dt className="text-gray-500">최근 운동 후 피로</dt><dd className="mt-1 font-bold text-gray-900">{review.latestFatigue}</dd></div>
      </dl>
      <div className={`mt-3 rounded-2xl p-3 ${review.action === 'hold' ? 'bg-red-50 text-red-900' : 'bg-[#F7F6FF] text-gray-800'}`}>
        <p className="text-sm font-bold">{review.title}</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-5">{review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>
      <ReviewConfirmation key={review.id} review={review} onConfirm={confirm} />
      {notice && <p role="status" className="mt-3 rounded-xl border border-violet-100 p-3 text-xs leading-5 text-[#534AB7]">{notice}</p>}
      {input.settings.adaptiveReviewDecisions?.length ? (
        <details className="mt-4 border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-xs font-bold text-gray-600">내가 확인한 조정 이력</summary>
          <ul className="mt-2 space-y-2">
            {[...input.settings.adaptiveReviewDecisions].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, 5).map((item) => (
              <li key={item.id} className="rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600">
                <p className="font-bold text-gray-800">{new Date(item.decidedAt).toLocaleDateString('ko-KR')} · {item.decision === 'kept' ? '계획 유지' : ACTION_LABELS[item.action]}</p>
                <p className="break-words">{item.summary}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details className="mt-3 text-xs leading-5 text-gray-500">
        <summary className="cursor-pointer">어떤 기준으로 조정하나요?</summary>
        <p className="mt-2">화·목은 1~2라운드의 회복형 운동입니다. 같은 근력 루틴을 3회 같은 조건으로 여유 있게 수행하면 한 번에 한 항목만 검토합니다. 반복수를 먼저 1회 높이고, 12회에 도달한 운동은 덤벨 0.5kg 또는 밴드 한 단계만 제안합니다. 새 동작을 2라운드로 익힌 경우에만 최대 3라운드까지 한 번 높일 수 있습니다.</p>
        <p className="mt-2">제안은 자동 적용되지 않습니다. 중량·밴드·추가 라운드를 준비할 수 있고 현재 통증·저림이 없다는 조건을 직접 확인해야 적용됩니다. 날짜가 지났다는 이유만으로 바꾸지는 않습니다.</p>
        <p className="mt-2">체지방 감소는 식사와 평소 활동량도 함께 관리합니다. 근력·반복수·회복이 나빠지면 체중이 줄어도 운동량을 늘리지 않습니다.</p>
      </details>
    </section>
  );
}

function ReviewConfirmation({ review, onConfirm }: { review: AdaptiveWorkoutReview; onConfirm: (decision: 'applied' | 'kept', prepared: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirm = (decision: 'applied' | 'kept') => {
    if (saving) return;
    setSaving(true);
    try { onConfirm(decision, prepared); } finally { setSaving(false); }
  };
  if (review.action === 'hold') return null;
  if (review.alreadyReviewed) return <p className="mt-3 text-xs font-bold text-gray-500">확인한 제안입니다. 새 기록을 남기면 다시 검토합니다.</p>;
  if (!review.change) return <button type="button" onClick={() => confirm('kept')} disabled={saving} className="mt-3 min-h-11 w-full rounded-2xl border border-violet-200 px-4 py-3 text-sm font-bold text-[#534AB7] disabled:opacity-50">현재 계획 유지 확인</button>;
  const guide = review.action === 'replace' ? getExerciseGuide(review.change.groupId === 'current-fullbody-hamstring-circuit' ? 'supported-hamstring-curl' : 'band-pallof-press') : undefined;
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="min-h-11 w-full rounded-2xl bg-[#EEEDFE] px-4 py-3 text-sm font-bold text-[#534AB7]">{expanded ? '변경 내용 접기' : '변경 내용 확인'}</button>
      {expanded && <div className="mt-3 space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 p-3"><dt className="text-xs text-gray-500">현재</dt><dd className="mt-1 text-sm font-bold text-gray-800">{review.change.before}</dd></div>
          <div className="rounded-2xl border border-violet-200 bg-[#F7F6FF] p-3"><dt className="text-xs text-[#534AB7]">확인 후 적용</dt><dd className="mt-1 text-sm font-bold text-[#3C3489]">{review.change.after}</dd></div>
        </dl>
        {guide && <details className="rounded-2xl border border-gray-200 p-3 text-xs leading-5 text-gray-600">
          <summary className="cursor-pointer font-bold text-gray-800">새 운동 자세와 중단 기준</summary>
          <p className="mt-2">{guide.summary}</p>
          <ol className="mt-2 list-inside list-decimal space-y-1">{[...guide.setup, ...guide.movement].map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="mt-2">{guide.breathing}</p>
          <p className="mt-2 text-red-800">{guide.stopCriteria.join(' ')}</p>
        </details>}
        {review.preparation && <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-700"><input type="checkbox" checked={prepared} onChange={(event) => setPrepared(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#534AB7]" />{review.preparation}</label>}
        <button type="button" disabled={saving || Boolean(review.preparation && !prepared)} onClick={() => confirm('applied')} className="min-h-11 w-full rounded-2xl bg-[#534AB7] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">확인한 변경 적용</button>
      </div>}
      <button type="button" disabled={saving} onClick={() => confirm('kept')} className="mt-2 min-h-11 w-full rounded-2xl px-4 py-3 text-xs font-bold text-gray-600 disabled:opacity-50">이번에는 현재 계획 유지</button>
    </div>
  );
}
