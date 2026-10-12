'use client';

import Link from 'next/link';
import type { LiveSkill, LiveSkillState } from '@/lib/language-live/learning-types';
import { useLiveOverview, type LiveOverviewState } from './useLiveOverview';
import styles from './live-overview.module.css';

const skills: Record<LiveSkill, string> = { listening: '듣기', speaking: '말하기', reading: '읽기', writing: '쓰기' };
const excerpt = (text: string) => Array.from(text).length > 240 ? `${Array.from(text).slice(0, 240).join('')}… (일부 표시)` : text;

export function LiveOverviewStatus({ state }: { state: LiveOverviewState }) {
  if (state.status === 'ready') return null;
  if (state.status === 'loading') return <p role="status">Live 수업과 복습 기록을 확인하는 중…</p>;
  return <div className={styles.notice} role="alert"><strong>{state.status === 'stale' ? '최신 Live 기록을 다시 확인해야 해요.' : 'Live 기록을 불러오지 못했어요.'}</strong><p>{state.message}</p><p>기록이 없는 상태로 처리하지 않았어요. 현재 단계와 복습 수 표시는 보류해요.</p></div>;
}
function StateList({ states }: { states: LiveSkillState[] }) {
  return <ul className={styles.list}>{states.map(state => <li key={`${state.item.itemId}:${state.skill}`}><strong lang="ja">{excerpt(state.item.text)}</strong> · {skills[state.skill]}
    <p>{state.status === 'relearn_needed' ? '재학습 필요 · ' : ''}{state.nextDue ? `복습일 ${state.nextDue}` : '복습일 미확인'}{state.needsAssessment ? ' · 추가 평가 필요' : ''}</p>
  </li>)}</ul>;
}

export default function LiveOverview() {
  const state = useLiveOverview();
  const overview = state.status === 'ready' ? state.overview : null;
  return <section className={styles.panel} aria-labelledby="live-overview-title">
    <div className={styles.header}><h2 id="live-overview-title">나의 AI Live 학습</h2><button className={styles.action} type="button" disabled={state.status === 'loading'} onClick={state.refresh}>Live 현황 새로고침</button></div>
    <p className={styles.hint}>직접 확인해 저장한 Live 기록이에요. 기존 자유 학습 완료 기록과 따로 보여요.</p>
    <LiveOverviewStatus state={state} />
    {overview ? <>
      <p className={styles.hint}>{overview.asOfDate} · 한국 시간 기준 · 현재까지 보관한 Live 수업 {overview.lessons.length}회</p>
      {!overview.lessons.length ? <p>{overview.futureLessons ? '현재 날짜까지 확인된 수업은 없어요. 미래 날짜의 수업을 현재 진도로 표시하지 않았어요.' : '아직 저장한 AI Live 수업이 없어요. 수업 보고서를 가져오거나 첫 수업을 준비해 보세요.'}</p> : null}
      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="live-recent-title"><h3 id="live-recent-title">최근 학습 결과</h3>
          <p>최근 수업일: {overview.latestDate ?? '미확인'}</p>
          {overview.recentLessons.length ? <ul className={styles.list}>{overview.recentLessons.slice(0, 2).map(lesson => <li key={lesson.lesson_id}><strong>{excerpt(lesson.report.topic) || '주제 미확인'}</strong>
            {(['listening', 'speaking', 'reading', 'writing'] as const).map(skill => { const field = lesson.report.fields[skill]; return <p key={skill} className={styles.preserved}>{skills[skill]}: {field.presence === 'unknown' ? '미확인' : field.presence === 'not_learned' ? '미학습으로 보고됨' : field.presence === 'none' ? '해당 없음으로 보고됨' : excerpt(field.text) || '미확인'}</p>; })}
          </li>)}</ul> : <p>날짜가 확인된 최근 수업이 없어요.</p>}
          {overview.recentLessons.length > 2 ? <p>같은 최근 날짜의 수업 {overview.recentLessons.length}회 중 2회만 표시해요.</p> : null}
          <p className={styles.hint}>보고서에 적힌 관찰이며 객관적인 실력 점수는 아니에요.</p>
        </section>
        <section className={styles.card} aria-labelledby="live-stage-title"><h3 id="live-stage-title">현재 학습 단계</h3><p className={styles.preserved}>{overview.stage ? excerpt(overview.stage) : '미확인'}</p>
          <p className={styles.hint}>{overview.stageAmbiguous ? '같은 최근 날짜의 단계가 서로 달라요. 원본 수업을 확인해 주세요.' : '최근 학습 날짜의 보고서 기준이에요. 등록 시각이나 예전 단계로 미확인 내용을 채우지 않아요.'}</p>
          {overview.undatedLessons ? <p className={styles.hint}>날짜 미확인 수업 {overview.undatedLessons}회는 최근 단계 계산에서 제외해요.</p> : null}
        </section>
        <section className={styles.card} aria-labelledby="live-due-title"><h3 id="live-due-title">오늘 복습할 내용</h3>
          <p>오늘까지 예정된 복습 {overview.due.length}개 영역 · 지난 복습일 {overview.due.filter(item => item.nextDue! < overview.asOfDate).length}개 영역</p>
          {overview.reviewQueue.length ? <><StateList states={overview.reviewQueue} /><p className={styles.hint}>재학습·지난 복습일·추가 평가를 우선해 최대 5개 영역을 보여요.</p></> : <p>확인된 기록상 오늘 예정된 복습이나 추가 평가 요청이 없어요.</p>}
        </section>
        <section className={styles.card} aria-labelledby="live-relearning-title"><h3 id="live-relearning-title">재학습 필요 항목</h3><p>{overview.relearning.length}개 영역</p>
          {overview.relearning.length ? <><StateList states={overview.relearning.slice(0, 5)} />{overview.relearning.length > 5 ? <p>먼저 5개 영역만 표시해요. 전체 항목은 복습 관리에서 확인해 주세요.</p> : null}</> : <p>현재 확인된 재학습 필요 항목이 없어요.</p>}
        </section>
      </div>
      {overview.learning.unconfirmedLessons.length ? <p className={styles.notice}>수업 {overview.learning.unconfirmedLessons.length}회의 현재 보고서에 확인한 평가 근거가 아직 없어요. 복습 항목이 없다고 숙달한 것은 아니에요.</p> : null}
      {overview.futureLessons || overview.futureObservations ? <p className={styles.notice}>미래 날짜의 수업 {overview.futureLessons}회·관찰 {overview.futureObservations}건은 현재 상태에서 제외했어요.</p> : null}
      <p className={styles.hint}>듣기·말하기·읽기·쓰기는 각각 확인해요. 미확인 내용을 미학습이나 숙달로 바꾸지 않아요.</p>
    </> : null}
    <nav className={styles.actions} aria-label="Live 학습 바로가기">
      <Link className={styles.action} href="/language/live?view=import">AI Live 기록 가져오기</Link>
      <Link className={styles.action} href="/language/live?view=prepare">다음 AI 수업 준비</Link>
      <Link className={styles.action} href="/language/live?view=learning">복습·학습 상태 보기</Link>
      <Link className={styles.action} href="/language/live?view=history">전체 Live 학습 이력</Link>
    </nav>
  </section>;
}
