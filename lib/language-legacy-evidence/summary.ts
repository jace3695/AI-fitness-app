import { MODALITY_LABELS, STAGE_LABELS, STUDY_DISCLOSURE, POLICY_EXPLANATION } from './study-policy.ts';
import type { EvidenceProjection, ModalityProjection, StudyStage } from './types.ts';

/** Counts item–modality pairs, never learners, lessons, routine completions or overall ability. */
export function summarizeLegacyEvidence(projection: EvidenceProjection) {
  const stages = Object.fromEntries(Object.keys(STAGE_LABELS).map(stage => [stage, 0])) as Record<StudyStage, number>;
  const coverage = { unobserved: 0, partial: 0, observed: 0, unavailable: 0 };
  for (const pair of projection.pairs) { coverage[pair.coverage]++; if (pair.stage !== null) stages[pair.stage]++; }
  return { policyVersion: projection.policyVersion, checkedAt: projection.checkedAt, status: projection.status,
    unit: '항목–영역 쌍' as const, stages, coverage, historicalModalities: 'unknown' as const, speaking: 'unobserved' as const };
}

export function formatLegacyEvidenceSummary(projection: EvidenceProjection): string {
  const summary = summarizeLegacyEvidence(projection);
  if (summary.status === 'unavailable') return '기존 과정 문제 기준 · 영역별 기록 조회 확인 필요';
  if (summary.status === 'partial') return '기존 과정 문제 기준 · 일부 기록만 확인됨 · 영역별 기록 조회 확인 필요';
  const stages = (Object.keys(STAGE_LABELS) as StudyStage[]).filter(stage => summary.stages[stage] > 0).map(stage => `${stage === 'not_started' ? '영역 기록 없음' : STAGE_LABELS[stage]} ${summary.stages[stage]}쌍`).join(' · ');
  return `기존 과정 문제 기준 · 현재 기록 기준 (${summary.checkedAt}) · 항목–영역 쌍: ${stages || '영역 기록 없음'} · 새 영역별 기록은 측정 시작 후만 표시`;
}

export function formatModalityEvidence(pair: ModalityProjection): string {
  const label = MODALITY_LABELS[pair.modality];
  if (pair.coverage === 'unavailable') return `${label} 기록 조회 확인 필요`;
  if (!pair.lastOutcome) return `${label} ${pair.coverage === 'partial' ? '기록 확인 필요' : pair.presentations ? '문제 표시 기록 있음' : '기록 없음'}`;
  const outcome = pair.lastOutcome;
  const help = outcome.helped === null ? ' · 도움 여부 미확인' : outcome.helped ? ' · 도움 사용' : '';
  const audio = pair.modality !== 'listening' ? '' : outcome.audio.status === 'completed' && outcome.audio.promptMatchesTask === true ? ' · 소리 재생 완료' : ' · 소리 재생 확인 안 됨';
  const text = pair.modality !== 'listening' ? '' : ` · 글자 선택지 ${outcome.textVisibility.choices === null ? '표시 여부 미확인' : outcome.textVisibility.choices ? '표시' : '숨김'}`;
  return `${label} 최근 결과: ${outcome.correct ? '정답' : '오답'}${outcome.isRetry ? ' · 재시도' : ''}${help}${audio}${text} · 응답 ${pair.responses}회${pair.coverage === 'partial' ? ' · 일부 근거 미확인' : ''}`;
}

export function formatStudyStage(pair: ModalityProjection): string {
  if (pair.stage === null) return '영역별 기록 조회 확인 필요';
  return pair.stage === 'not_started' ? '영역 기록 없음 · 시작 전' : STAGE_LABELS[pair.stage];
}

export const LEGACY_EVIDENCE_EXPLANATION = `${STUDY_DISCLOSURE} ${POLICY_EXPLANATION} 복습 필요는 기억 상실을 뜻하지 않아요. 직접 입력은 말하기·필기 능력 평가가 아니에요.`;
