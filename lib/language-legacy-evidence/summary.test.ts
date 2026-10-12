import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLegacyEvidence } from './projection.ts';
import { formatLegacyEvidenceSummary, formatModalityEvidence, formatStudyStage, LEGACY_EVIDENCE_EXPLANATION, summarizeLegacyEvidence } from './summary.ts';
import { catalogue, context, episode, listeningTask, meaningTask, snapshot, typedTask } from './test-fixtures.ts';

test('summary counts clearly labelled pairs and unobserved coverage rather than lessons or ability', () => {
  const projected = projectLegacyEvidence(snapshot(episode(0)), context(), catalogue);
  const summary = summarizeLegacyEvidence(projected);
  assert.equal(summary.unit, '항목–영역 쌍'); assert.equal(summary.coverage.observed, 1); assert.equal(summary.coverage.unobserved, 5);
  assert.equal(summary.stages.completed_once, 1); assert.equal(summary.stages.not_started, 5);
  const line = formatLegacyEvidenceSummary(projected);
  assert.match(line, /현재 기록 기준/); assert.match(line, /측정 시작 후만/); assert.match(line, /영역 기록 없음 5쌍/);
  assert.equal(summary.historicalModalities, 'unknown'); assert.equal(summary.speaking, 'unobserved');
});

test('unknown, partial and unavailable produce distinct factual summaries', () => {
  const empty = projectLegacyEvidence(snapshot([]), context(), catalogue);
  assert.match(formatLegacyEvidenceSummary(empty), /영역 기록 없음/);
  const partial = snapshot([]); partial.completeness.status = 'partial';
  assert.match(formatLegacyEvidenceSummary(projectLegacyEvidence(partial, context(), catalogue)), /일부 기록만 확인됨/);
  assert.match(formatLegacyEvidenceSummary(projectLegacyEvidence(null, context(), catalogue)), /조회 확인 필요/);
});

test('listening summary preserves playback and text provenance; typing never becomes general writing', () => {
  const events = [...episode(0, { task: listeningTask, format: 'listening_choice' }), ...episode(0, { task: typedTask, format: 'typed_answer', answers: [{ correct: false }] })];
  const result = projectLegacyEvidence(snapshot(events), context(), catalogue);
  const listening = result.pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
  const typed = result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'typing')!;
  assert.match(formatModalityEvidence(listening), /듣기 문제 응답 최근 결과: 정답 · 소리 재생 완료 · 글자 선택지 표시/);
  assert.match(formatModalityEvidence(typed), /직접 입력 최근 결과: 오답/);
  assert.doesNotMatch(formatModalityEvidence(listening), /할 수|청취 능력|잘 듣/);
  assert.match(LEGACY_EVIDENCE_EXPLANATION, /인증하지 않아요/); assert.match(LEGACY_EVIDENCE_EXPLANATION, /AI Live 진도는 별도/);
});

test('long-term record label is always qualified, with transparent heuristic and due explanation', () => {
  const result = projectLegacyEvidence(snapshot([0, 1, 4, 11, 30].flatMap(day => episode(day))), context(30), catalogue);
  const pair = result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')!;
  assert.equal(formatStudyStage(pair), '장기 기억 완료 · 기록 기준');
  assert.match(formatLegacyEvidenceSummary(result), /장기 기억 완료 · 기록 기준/);
  assert.match(LEGACY_EVIDENCE_EXPLANATION, /장기 간격 복습 조건 충족/); assert.match(LEGACY_EVIDENCE_EXPLANATION, /초기 기록 정책/);
});
