"use client";

import { useState } from "react";
import type { CloudSyncConflictReview as Review, CloudSyncConflictChoice } from "../data/cloudSyncConflicts";

type Side = "local" | "remote";
const fieldNames: Record<string, string> = {
  "ai-fitness-workout-completed-days": "운동 기록", "ai-fitness-diet-completed-days": "식단 기록",
  "ai-fitness-water-intake": "물 섭취", "ai-fitness-user-workout-settings": "운동 설정",
  workoutMemo: "운동 메모", dietMemo: "식단 메모", workoutStatus: "운동 상태", workoutDone: "운동 완료",
};
export function cloudSyncFieldLabel(path: string[]) {
  return path.map(part => Object.hasOwn(fieldNames, part) ? fieldNames[part] : part).join(" / ");
}
export function cloudSyncValueLabel(value: { present: boolean; value?: unknown }, unknownBase = false) {
  if (unknownBase) return "기준 정보 없음 (이 기기에서 아직 확인하지 않음)";
  if (!value.present) return "값 없음 (삭제되었거나 아직 기록되지 않음)";
  if (value.value === null) return "비어 있는 값 (null)";
  if (value.value === "") return "빈 문자열 (\"\")";
  if (typeof value.value === "string") return `문자열: ${value.value}`;
  if (typeof value.value === "number") return `숫자: ${value.value}`;
  if (typeof value.value === "boolean") return `참/거짓: ${value.value}`;
  return JSON.stringify(value.value, null, 2);
}

/** Values stay in this owner's UI only. No default winner and no background submission. */
export default function CloudSyncConflictReview({ review, busy, onResolve }: {
  review: Review;
  busy: boolean;
  onResolve: (choices: CloudSyncConflictChoice[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, Side>>({});
  const complete = review.conflicts.every(conflict => choices[JSON.stringify(conflict.path)]);
  return <section aria-label="기록 충돌 선택" className="mt-3 min-w-0 rounded-xl border border-amber-200 bg-white p-3 text-gray-800">
    <h3 className="text-sm font-bold">같은 항목의 변경 {review.conflicts.length}개를 확인해 주세요</h3>
    <p className="mt-1 text-xs leading-relaxed">기기와 서버가 같은 항목을 다르게 수정했습니다. 양쪽 내용을 확인하고 항목마다 남길 값을 골라 주세요. 선택하기 전에는 이 동기화를 보류하며 원본을 유지합니다.</p>
    <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto overscroll-contain">
      {review.conflicts.map((conflict, index) => {
        const id = JSON.stringify(conflict.path);
        return <fieldset key={id} disabled={busy} className="min-w-0 rounded-lg border border-gray-200 p-2">
          <legend className="max-w-full break-words px-1 text-xs font-bold">{index + 1}. {cloudSyncFieldLabel(conflict.path)}</legend>
          <details className="mb-2 text-xs text-gray-600"><summary className="cursor-pointer py-2">마지막 공통 기준</summary>
            <p className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{cloudSyncValueLabel(conflict.base, review.request.base === null)}</p>
          </details>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {(["local", "remote"] as const).map(side => <label key={side} className={`block min-w-0 cursor-pointer rounded-lg border p-3 ${choices[id] === side ? "border-[#534AB7] bg-[#EEEDFE]" : "border-gray-200"}`}>
              <span className="flex min-h-6 items-center gap-2 text-xs font-bold">
                <input type="radio" name={`sync-conflict-${index}`} value={side} checked={choices[id] === side}
                  onChange={() => setChoices(current => ({ ...current, [id]: side }))}
                  className="h-5 w-5 shrink-0 accent-[#534AB7]" />
                {side === "local" ? "이 기기 값 유지" : "서버 값 유지"}
              </span>
              <span className="mt-2 block max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed">{cloudSyncValueLabel(conflict[side])}</span>
            </label>)}
          </div>
        </fieldset>;
      })}
    </div>
    <p role="status" className="mt-2 text-xs text-gray-600">{complete ? "모든 항목을 선택했습니다. 적용 전에 최신 기록을 다시 확인합니다." : "아직 선택하지 않은 항목이 있습니다."}</p>
    <button type="button" disabled={busy || !complete}
      onClick={() => { if (complete && !busy) onResolve(review.conflicts.map(conflict => ({ path: conflict.path, side: choices[JSON.stringify(conflict.path)] }))); }}
      className="mt-2 min-h-11 w-full rounded-xl bg-[#534AB7] px-3 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? "최신 기록 확인 중…" : "선택한 값으로 동기화"}
    </button>
  </section>;
}
