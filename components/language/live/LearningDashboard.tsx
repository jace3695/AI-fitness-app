'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { LIVE_SKILLS, type LiveItemIdentity, type LiveLearningEvent, type LiveLearningProjection, type LiveLearningStatus, type LiveSkill, type LiveSkillState } from '@/lib/language-live/learning-types';
import { livePracticeHref, liveReviewQueue } from '@/lib/language-live/review-policy';
import { LIVE_REPORT_FIELDS } from '@/lib/language-live/types';

export const skillLabels: Record<LiveSkill, string> = { listening: '듣기', speaking: '말하기', reading: '읽기', writing: '쓰기' };
export const statusLabels: Record<LiveLearningStatus, string> = { unlearned: '미학습', learning: '학습 중', review_due: '복습 예정', relearn_needed: '재학습 필요', mastery_confirmed: '숙달 확인' };
export const kindLabels: Record<LiveLearningEvent['kind'], string> = { not_learned: '미학습 확인', learn: '새 학습', review: '복습 평가', forgetting: '망각·오류 확인', relearn: '재학습 실시', reassessment: '재학습 후 재평가' };
export const resultLabels: Record<LiveLearningEvent['result'], string> = { independent_correct: '힌트 없이 독립 정답', hinted_correct: '힌트를 받고 정답', incorrect: '틀린 답변', cannot_recall: '기억하지 못함', uncertain: '평가 불확실', not_assessed: '평가하지 않음' };
export const itemKindLabels: Record<LiveItemIdentity['kind'], string> = { kana: '가나', word: '단어', grammar: '문법', expression: '표현', sentence: '문장', other: '그 외' };
export const statusLabel = (status: LiveLearningStatus | null) => status ? statusLabels[status] : '미확인';
export const fieldLabel = (key: LiveLearningEvent['sourceField']) => LIVE_REPORT_FIELDS.find(field => field.key === key)?.label ?? key;
const flag = (value: boolean | null) => value === null ? '미확인' : value ? '예' : '아니요';

export function LearningEventSummary({ event }: { event: LiveLearningEvent }) {
  return <div className="live-event-summary">
    <strong lang="ja">{event.item.text}</strong>{event.item.meaning ? <span> · {event.item.meaning}</span> : null}
    <p>{skillLabels[event.skill]} · {kindLabels[event.kind]} · {resultLabels[event.result]} · {event.certainty === 'confirmed' ? '근거 확인' : '불확실'}</p>
    <p className="live-hint">실제 관찰일 {event.occurredDate ?? '미확인'} · 독립 수행 {flag(event.independent)} · 힌트 사용 {flag(event.hintUsed)} · 망각 재확인 {event.forgettingConfirmed ? '예' : '아니요'}</p>
    <p className="live-preserved-text">근거 ({fieldLabel(event.sourceField)}): {event.evidenceText}</p>
    <p className="live-preserved-text">기록 이유: {event.reason}</p>
    {event.relearningText ? <p className="live-preserved-text">재학습 내용: {event.relearningText}</p> : null}
    {event.linkedRelearningEventId ? <p className="live-hint">연결한 재학습 기록: {event.linkedRelearningEventId}</p> : null}
    {event.teacherRecommendedDue ? <p className="live-hint">선생님 권장일 {event.teacherRecommendedDue} · {event.teacherRecommendationConfirmed ? '적용 확인' : '미확인으로 보존'}</p> : null}
  </div>;
}

export default function LearningDashboard({ projection, today }: { projection: LiveLearningProjection; today: string }) {
  const [filter, setFilter] = useState<LiveLearningStatus | 'all'>('all');
  const queue = liveReviewQueue(projection.states, today);
  const items = useMemo(() => [...new Map(projection.states.map(state => [state.item.itemId, state.item])).values()], [projection.states]);
  const visibleItems = items.filter(item => filter === 'all' || projection.states.some(state => state.item.itemId === item.itemId && state.status === filter));
  return <>
    <section className="live-card" aria-labelledby="live-review-queue-title">
      <h2 id="live-review-queue-title">오늘 먼저 확인할 내용</h2>
      <p className="live-hint">{today} · 한국 시간 기준 · 재학습, 지난 복습일, 반복 오류를 우선해 최대 5개만 보여요. 복습을 놓친 날을 실패로 기록하지 않아요.</p>
      {queue.length ? <ul className="live-list">{queue.map(state => <li key={`${state.item.itemId}:${state.skill}`}><strong lang="ja">{state.item.text}</strong> · {skillLabels[state.skill]} · {statusLabel(state.status)}
        <p>다음 복습 {state.nextDue ?? '날짜 확인 필요'}{state.nextDue && state.nextDue < today ? ' · 예정일 지남' : ''}{state.needsAssessment ? ' · 추가 평가 필요' : ''}</p>
        <Link className="live-button" href={livePracticeHref(state.item, state.skill)}>기존 앱에서 연습하기</Link>
      </li>)}</ul> : <p>오늘 예정된 복습이나 추가 평가 요청이 없어요. 미확인 영역의 숙달을 뜻하지는 않아요.</p>}
      <details className="live-source"><summary>복습·숙달 계산 기준 보기</summary><div className="live-field-group-body"><p>초기 간격은 1·3·7·14·30일이에요. 명시적으로 확인한 결과만 계산하고, 힌트 사용·오류·재학습 뒤에는 가까운 날짜에 다시 확인해요.</p><p>숙달 확인에는 서로 다른 3일의 독립 정답과 최소 7일 간격이 필요해요. 같은 날의 성공을 여러 번 세지 않아요. 재학습 직후 정답만으로 장기 숙달을 확정하지 않아요.</p><p>음성 인식처럼 불확실한 평가는 기존 상태와 복습일을 유지해요. 실제 실력 점수나 학습 시간을 만들지 않아요. 정책 버전: {projection.policyVersion}</p></div></details>
    </section>
    <section className="live-card" aria-labelledby="live-skill-states-title"><h2 id="live-skill-states-title">듣기·말하기·읽기·쓰기 상태</h2>
      <p className="live-hint">보고서에서 직접 확인한 영역만 반영해요. 미학습과 미확인은 다릅니다. 기존 앱에서 연습해도 Live 상태를 자동으로 바꾸지 않아요.</p>
      <label htmlFor="live-state-filter">학습 상태 필터</label><select id="live-state-filter" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">모든 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {!items.length ? <p>아직 확인해 저장한 학습 항목이 없어요. 아래에서 수업의 평가 근거를 직접 확인해 주세요.</p> : !visibleItems.length ? <p>선택한 상태의 항목이 없어요.</p> : visibleItems.map(item => <article className="live-item-card" key={item.itemId}><h3 lang="ja">{item.text}</h3><p className="live-hint">{itemKindLabels[item.kind]}{item.meaning ? ` · ${item.meaning}` : ''}</p><div className="live-skill-grid">{LIVE_SKILLS.map(skill => <SkillCard key={skill} item={item} skill={skill} state={projection.states.find(state => state.item.itemId === item.itemId && state.skill === skill)} />)}</div></article>)}
    </section>
  </>;
}

function SkillCard({ item, skill, state }: { item: LiveItemIdentity; skill: LiveSkill; state?: LiveSkillState }) {
  return <section className="live-skill-card" aria-label={`${item.text} ${skillLabels[skill]} 상태`}>
    <h4>{skillLabels[skill]}</h4><span className="live-badge">{statusLabel(state?.status ?? null)}</span>
    {state ? <>
      <p>다음 복습 {state.nextDue ?? '미확인'}</p>
      <p className="live-hint">정책 계산일 {state.policyDue ?? '미확인'}<br />최초 학습 {state.firstLearnedDate ?? '미확인'}<br />마지막 복습 {state.lastReviewedDate ?? '미확인'}</p>
      <p className="live-hint">복습 {state.reviewCount}회 · 오류 {state.errorCount}회<br />독립 성공 {state.independentSuccessCount}일 · 불확실 {state.uncertainCount}회</p>
      {state.needsAssessment ? <p className="live-notice live-notice-warning">추가 평가 필요</p> : null}
      <details className="live-source"><summary>상태·평가 이력 {state.history.length}건</summary><div className="live-field-group-body"><p className="live-hint">과거 숙달 확인 {state.masteryHistory.length}건을 보존하고 있어요.</p><ol className="live-learning-timeline">{state.history.map((entry, index) => <li key={`${entry.lessonId}:${entry.eventId}:${index}`}>
        <LearningEventSummary event={entry.event} /><p>{statusLabel(entry.previousStatus)} → {statusLabel(entry.status)}</p><p className="live-preserved-text">{entry.reason}</p><p className="live-hint">복습 예정일 {entry.nextDue ?? '미확인'} · 원본 수업 {entry.lessonId} · 보고서 버전 {entry.lessonRevision} · 근거 버전 {entry.batchVersion}</p>
      </li>)}</ol></div></details>
    </> : <p className="live-hint">이 영역의 확인된 기록이 없어요.</p>}
  </section>;
}
