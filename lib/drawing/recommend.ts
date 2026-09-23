import type { Attempt, Help, Lesson, Pack } from "./model.ts";
import { recallEligible } from "./memory.ts";
import { playable } from "./model.ts";

export const HELP_LABELS = ["옆의 원본을 보고 스스로", "시작점 도움", "큰 모양 도움", "한 동작씩 함께 따라가기"];
export type Recommendation = { lessonId: string; exampleId: string; help: Help; reason: string; short: boolean };
export function recommend(pack: Pack, history: Attempt[], requiredExamples = 2): Recommendation | null {
  const available = pack.lessons.filter(playable);
  if (!available.length) return null;
  const latest = [...history].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const current = available.find(l => l.id === latest?.document.lesson.id) ?? available[0];
  const doc = latest?.document;
  const base = { lessonId: current.id, exampleId: current.examples[0].id, help: current.help as Help, short: false };
  if (!doc) return { ...base, reason: "큰 몸의 시작점 하나부터 함께 찾아봐요." };
  if (latest.status === "draft") return { ...base, exampleId: doc.example.id, help: doc.help, reason: "저장한 그림을 이어서 그려요." };
  if (doc.check === "difficult" || doc.difficulty) {
    const review = current.id === "D68" ? available.find(l => l.id === "D58") : undefined;
    return { ...base, lessonId: review?.id ?? current.id, exampleId: review?.examples[0].id ?? doc.example.id, help: Math.min(3, doc.usedHelp + 1) as Help, short: true,
      reason: review ? "걷기가 어려웠다고 했어요. 앞뒤 다리의 방향부터 다시 봐요." : "어려웠다고 알려줬어요. 같은 목표에서 그릴 부분을 줄여봐요." };
  }
  if (!recallEligible(doc)) return { ...base, exampleId: doc.example.id, reason: "기억할 특징 두 개와 다시 본 한 곳을 확인해요. 이전 그림 떠올리기는 저장한 그림을 골라 연습해요." };
  if (doc.short || doc.check === "unconfirmed") return { ...base, exampleId: current.examples.find(e => e.id !== doc.example.id)?.id ?? base.exampleId, reason: "짧은 시도와 전체 목표 확인은 달라요. 같은 목표의 다른 그림을 제안해요." };
  if (doc.check === "assisted") return { ...base, exampleId: doc.example.id, help: Math.max(0, doc.usedHelp - 1) as Help, reason: "도움을 받아 해봤다고 체크했어요. 다음에는 도움 하나만 줄여봐요." };
  const confirmed = history.filter(a => a.status === "completed" && !a.document.short && a.document.check === "independent" && !a.document.difficulty && a.document.lesson.id === current.id && recallEligible(a.document));
  const distinct = new Set(confirmed.map(a => a.document.example.id));
  if (distinct.size < Math.max(2, requiredExamples)) return { ...base, exampleId: current.examples.find(e => !distinct.has(e.id))?.id ?? base.exampleId, reason: "스스로 해봤다고 체크했어요. 다른 예제에서도 같은 목표를 확인해요." };
  const next = available.find(l => pack.lessons.indexOf(l) > pack.lessons.indexOf(current));
  return next ? { lessonId: next.id, exampleId: next.examples[0].id, help: next.help as Help, short: false, reason: "서로 다른 예제에서 스스로 확인했어요. 다음 목표를 살펴봐요. 완료 횟수로 실력을 채점하지 않아요." }
    : { ...base, reason: "현재 준비된 수업을 다른 도움 수준으로 복습할 수 있어요." };
}

export function feedback(attempt: Attempt, pack: Pack, history: Attempt[]) {
  const d = attempt.document;
  const next = recommend(pack, [attempt, ...history.filter(a => a.id !== attempt.id)]);
  return [
    { title: "오늘 배운 내용", body: d.lesson.goal },
    { title: "잘된 부분", body: d.check === "independent" ? `‘${d.lesson.check}’에 스스로 해봤다고 체크했어요. (자기확인)` : d.check === "assisted" ? "도움을 받아 시도했다고 체크했어요. (자기확인)" : "시도를 기록했어요. 그림의 잘된 부분은 아직 분석하지 않았어요." },
    { title: "가장 먼저 살펴볼 부분", body: d.difficulty ? `어렵다고 고른 부분: ${d.difficulty}. ${d.lesson.easier}` : "그림을 분석하지 않아 고칠 부분을 판정하지 않았어요. 오늘 확인 질문으로 한 곳만 살펴봐요." },
    { title: "필요한 보조 연습", body: d.difficulty === "긴 선" ? "2분 이내로 몸 선의 어려운 반쪽만 2번 그린 뒤 오늘 캐릭터로 돌아와요." : d.difficulty === "시작점" ? "별도 선 연습 없이 시작점을 손가락으로 한 번 짚어봐요." : "지금은 별도의 반복 연습을 추가하지 않아요." },
    { title: "다음 연습", body: next ? `${pack.lessons.find(l => l.id === next.lessonId)?.title}. ${next.reason}` : "수업 준비 상태를 확인해 주세요." },
    { title: "현재 학습 단계", body: `${d.lesson.stage}단계 · ${d.lesson.memoryPractice ? (memoryStateLabel(d)) : HELP_LABELS[d.usedHelp]}. 확인 근거: 사용자 자기확인. 그림 분석은 받지 않았어요.` },
  ];
}

export function confirmedStage(pack: Pack, history: Attempt[], stage: number) {
  const capstone: Lesson | undefined = pack.lessons.filter(l => l.stage === stage).at(-1);
  if (!capstone) return false;
  const evidence = history.filter(a => a.document.lesson.id === capstone.id && a.status === "completed" && a.document.check === "independent" && !a.document.short && !a.document.difficulty && recallEligible(a.document));
  return new Set(evidence.map(a => a.document.example.id)).size >= 2;
}

function memoryStateLabel(doc: import("./model.ts").DrawingDocument) { return doc.memory?.copyMode ? "원본 보며 모작" : `기억·비교 연습 · 잠깐 확인 ${doc.memory?.peeks ?? 0}회`; }
