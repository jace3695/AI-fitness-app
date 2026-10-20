import type { BodyWorkoutReview } from './bodyWorkoutReview.ts';
import { HOME_EQUIPMENT } from './homeExerciseCatalog.ts';

// Route before any chat request. Even write/medical requests containing body
// metrics remain local: this path has no command or diagnostic capability.
export function isLocalBodyQuestion(text: string) {
  return /인바디|체성분|체지방|골격근|근육량|근육률|몸통\s*(근육|지방)|\bbmi\b|body\s*composition/i.test(text);
}

// Exact ordinary commands can leave a local body thread. Ambiguous follow-ups
// remain local until the user explicitly returns to the existing general chat.
export function shouldUseLocalBodyConversation(text: string, active: boolean) {
  if (isLocalBodyQuestion(text)) return true;
  if (!active) return false;
  return !/^(오늘\s*할\s*일\s*(보여줘|알려줘)|이번\s*달\s*지출\s*(보여줘|알려줘)|오늘\s*일본어\s*학습\s*진도\s*알려줘|오늘\s*자기계발\s*현황\s*알려줘)[.!?]?$/.test(text.trim());
}

export const LOCAL_BODY_NOTICE = '무료 로컬 점검 · 서버 전송·음성 생성·영구 저장 없음. 이 화면을 닫거나 기록·계정이 바뀌면 이력이 사라집니다.';

export function buildLocalBodyNarrative(review: BodyWorkoutReview) {
  const { recommendation: r, composition: c, body } = review;
  return [
    `기준일 ${body.today} · 마지막 체성분 기록 ${body.latestDate ?? '없음'}`,
    `${r.title}. ${r.reasons.join(' ')}`,
    c ? `현재 구성: 근력 ${c.strengthDays}일, 회복 ${c.recoveryDays}일, 유산소 ${c.cardioDays}일, 코어 ${c.coreDays}일, 휴식 ${c.restDays}일.` : '',
    r.change ? `변경 전: ${r.change.before}\n검토할 변경: ${r.change.after}${r.change.preparation ? `\n준비 조건: ${r.change.preparation}` : ''}` : '',
    `체성분 해석: ${body.nextAction}`,
    ...review.evidence.map(item => `${item.label}: ${item.summary}`),
    review.bodyRationale,
    review.decisionBoundary,
    `도구 목록: ${HOME_EQUIPMENT.join(', ')}. 제품 하중·밴드 저항 수치는 확인되지 않았습니다. 장비별 선택은 운동 목록에서 직접 확인하며 자동 교체하지 않습니다.`,
    '이 답변은 저장·삭제·계획 적용 명령을 실행하지 않습니다. 체성분 수치로 질환·근손실을 진단하거나 특정 운동의 의료적 적합성을 판단할 수 없습니다.',
  ].filter(Boolean).join('\n\n');
}

export function remoteChatHistory<T extends { id: string; role: 'user' | 'assistant'; text: string; localOnly?: boolean; historyOnly?: boolean }>(messages: T[]) {
  return messages.filter(item => item.id !== 'welcome' && !item.localOnly && !item.historyOnly && !isLocalBodyQuestion(item.text)).slice(-8).map(({ role, text }) => ({ role, text }));
}
