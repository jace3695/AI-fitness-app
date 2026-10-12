'use client';

import Link from 'next/link';
import type { LiveCalendarDay } from '@/lib/language-live/overview';
import type { LiveOverviewState } from './useLiveOverview';
import { LiveOverviewStatus } from './LiveOverview';
import styles from './live-overview.module.css';

export function LiveCalendarBadges({ day }: { day?: LiveCalendarDay }) {
  if (!day) return null;
  return <span className={styles.badges}>
    {day.lessons.length ? <span className={styles.badge} aria-label={`Live 수업 ${day.lessons.length}회`}>L {day.lessons.length}</span> : null}
    {day.reviews ? <span className={styles.badge} aria-label={`Live 복습 관찰 ${day.reviews}건`}>복 {day.reviews}</span> : null}
    {day.relearning ? <span className={styles.badge} aria-label={`Live 재학습 관찰 ${day.relearning}건`}>재 {day.relearning}</span> : null}
    {day.planned.length ? <span className={styles.badge} aria-label={`Live 복습 예정 ${day.planned.length}개 영역`}>예 {day.planned.length}</span> : null}
  </span>;
}

export default function LiveCalendarOverlay({ state, selectedDateKey, monthKey, onSelectDate }: {
  state: LiveOverviewState; selectedDateKey: string; monthKey: string; onSelectDate: (date: string) => void;
}) {
  const overview = state.status === 'ready' ? state.overview : null;
  const selected = overview?.calendar[selectedDateKey];
  const dates = overview ? Object.keys(overview.calendar).filter(date => date.startsWith(`${monthKey}-`)).sort() : [];
  return <section className={styles.panel} aria-labelledby="live-calendar-title">
    <div className={styles.header}><h2 id="live-calendar-title">달력의 AI Live 기록</h2><button className={styles.action} type="button" onClick={state.refresh} disabled={state.status === 'loading'}>Live 달력 새로고침</button></div>
    <p className={styles.hint}>L: Live 수업 · 복: 복습 관찰 · 재: 재학습 관찰 · 예: 복습 예정. 기존 루틴 완료 수와 연속 학습일은 그대로예요.</p>
    <LiveOverviewStatus state={state} />
    {overview ? <>
      <p className={styles.hint}>Live 날짜는 보고서의 한국 달력 날짜예요. 기기의 날짜 칸에 같은 날짜로 표시하며, 복습 예정은 {overview.asOfDate} 기준 현재 유효한 일정이에요.</p>
      <h3>{selectedDateKey} Live 상세</h3>
      {selected?.lessons.length ? <><p>Live 수업 {selected.lessons.length}회</p><ul className={styles.list}>{selected.lessons.slice(0, 5).map(lesson => <li key={lesson.lesson_id}>{lesson.report.topic || '주제 미확인'}</li>)}</ul>{selected.lessons.length > 5 ? <p>수업 제목은 5회까지만 표시해요.</p> : null}</> : <p>{selectedDateKey > overview.asOfDate ? '미래 날짜에는 수업 실시를 표시하지 않아요.' : '이 날짜에 확인된 Live 수업 기록이 없어요. 실제로 수업을 하지 않았다는 뜻은 아니에요.'}</p>}
      <p>Live 복습 관찰 {selected?.reviews ?? 0}건 · 재학습 관찰 {selected?.relearning ?? 0}건 · 복습 예정 {selected?.planned.length ?? 0}개 영역</p>
      <p className={styles.hint}>관찰 수는 성공 횟수가 아니에요. 날짜·활동 근거가 확인된 기록만 표시하고 학습시간은 만들지 않아요.</p>
      {overview.undatedLessons || overview.undatedObservations ? <p className={styles.notice}>날짜 미확인 수업 {overview.undatedLessons}회·관찰 {overview.undatedObservations}건은 달력 날짜에 배치하지 않았어요.</p> : null}
      {overview.futureLessons || overview.futureObservations ? <p className={styles.notice}>미래 날짜의 수업·관찰은 실시 기록에서 제외했어요.</p> : null}
      <details><summary>{monthKey} Live 기록·예정 날짜 {dates.length}일</summary>
        {dates.length ? <ul className={styles.calendarList}>{dates.map(date => <li key={date}><button type="button" className={styles.action} aria-pressed={date === selectedDateKey} onClick={() => onSelectDate(date)}>{date} · <LiveCalendarBadges day={overview.calendar[date]} /></button></li>)}</ul> : <p>이 달에 날짜가 확인된 Live 기록이나 현재 복습 일정이 없어요.</p>}
      </details>
    </> : null}
    <nav className={styles.actions} aria-label="Live 달력 바로가기"><Link className={styles.action} href="/language/live?view=history">Live 수업 이력 보기</Link><Link className={styles.action} href="/language/live?view=learning">Live 복습 관리</Link></nav>
  </section>;
}
