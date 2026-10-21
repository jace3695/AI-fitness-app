'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BodyAnalysisHistory from './BodyAnalysisHistory';
import type { BodyAnalysisSnapshot } from '@/lib/body-analysis-history';
import { BODY_COACH_RECENT_DAYS } from '../data/bodyCompositionCoach';
import { type BodyWorkoutReview } from '../data/bodyWorkoutReview';
import { type RecordStores } from '../data/recordStorage';
import { readLocalBodyReview } from '../data/readLocalBodyReview';
import { buildLocalBodyNarrative, LOCAL_BODY_NOTICE } from '../data/localBodyConversation';
import { RECORDS_CHANGED_EVENT } from '../data/storageTransaction';

const statusLabels = {
  missing: '미제공 · 비교 자료 부족',
  invalid: '값 확인 필요 · 비교 제외',
  unverified: '기기·출처·단위 확인 필요 · 비교 제외',
  stale: '오래된 측정치 · 현재 비교 제외',
  historical: '최신 측정일에 없는 항목 · 과거 참고값',
  single: '최근 1회 · 비교 자료 부족',
  comparable: '최근 동일 출처 수치 비교',
};

export default function BodyCompositionCoach({ stores, analysisRequest = 0 }: { stores?: RecordStores; analysisRequest?: number }) {
  const [candidate, setCandidate] = useState<{ ownerId: string; snapshot: BodyAnalysisSnapshot } | null>(null);
  const [combined, setCombined] = useState<BodyWorkoutReview | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [sessionChanged, setSessionChanged] = useState(false);
  const handledRequest = useRef(analysisRequest);
  const review = combined?.body;
  // A fresh explicit check is required after any record/account refresh.
  useEffect(() => {
    const clear = () => { setCandidate(null); setCombined(null); setHistory([]); setHistoryOpen(false); setError(''); };
    const invalidate = () => { clear(); setSessionChanged(true); };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'fitness-cloud-sync-user' || event.key === 'fitness-cloud-sync-epoch') invalidate();
      else clear();
    };
    clear();
    window.addEventListener(RECORDS_CHANGED_EVENT, clear);
    window.addEventListener('storage', storage);
    window.addEventListener('yeoni-cloud-session-changed', invalidate);
    return () => {
      window.removeEventListener(RECORDS_CHANGED_EVENT, clear);
      window.removeEventListener('storage', storage);
      window.removeEventListener('yeoni-cloud-session-changed', invalidate);
    };
  }, [stores]);
  const check = useCallback(() => {
    if (sessionChanged) return;
    try {
      const next = readLocalBodyReview(stores);
      setCombined(next);
      const narrative = buildLocalBodyNarrative(next);
      const ownerId = window.localStorage.getItem('fitness-cloud-sync-user');
      setCandidate(ownerId ? { ownerId, snapshot: { version: 1, source: 'local-rules', date: next.body.today, text: narrative } } : null);
      setHistory(items => items[0] === narrative ? items : [narrative, ...items].slice(0, 5));
      setError('');
    } catch {
      setCandidate(null);
      setCombined(null);
      setHistory([]);
      setHistoryOpen(false);
      setError('저장된 기록을 읽지 못했습니다. 기록 화면을 다시 확인해 주세요.');
    }
  }, [sessionChanged, stores]);
  useEffect(() => {
    if (handledRequest.current === analysisRequest) return;
    handledRequest.current = analysisRequest;
    check();
  }, [analysisRequest, check]);
  return <section aria-label="체성분과 운동 함께 점검" className="mt-4 rounded-2xl border border-violet-100 bg-white p-3 text-sm">
    <h3 className="font-bold">체성분과 운동 함께 점검</h3>
    <p className="mt-1 text-xs leading-5">브라우저 안에서 계산하는 무료 점검입니다. 점검만으로는 서버 전송·영구 저장·운동 설정 변경을 하지 않습니다. 계정 이력 저장은 별도 확인 후 직접 선택합니다.</p>
    <button type="button" disabled={sessionChanged} onClick={check} className="mt-2 min-h-11 rounded-xl bg-violet-100 px-3 font-semibold text-violet-900 disabled:opacity-50">체성분·운동 무료 점검</button>
    {sessionChanged && <p role="status" className="mt-2 text-xs">계정 상태가 바뀌었습니다. 화면을 새로 열고 현재 계정의 기록을 확인한 뒤 점검해 주세요.</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {history.length > 0 && <details open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)} aria-label="화면 내 로컬 점검 이력" className="mt-3 text-xs">
      <summary className="min-h-11 cursor-pointer py-3">이번 화면의 분석 문장·이력 ({history.length}/5)</summary>
      {historyOpen && <>
      <p>{LOCAL_BODY_NOTICE}</p>
      <button type="button" onClick={() => { setHistory([]); setHistoryOpen(false); }} className="min-h-11 px-2">화면 점검 이력 비우기</button>
      {history.map((text, index) => <article key={`${index}-${text}`} className="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3">
        <h4 className="font-semibold">{index === 0 ? '최근 점검' : '이전 점검'} · 참고용</h4>{text}
      </article>)}
      </>}
    </details>}
    <BodyAnalysisHistory candidate={candidate} />
    {review && combined && <div className="mt-3 space-y-3" aria-live="polite">
      <p>기준일 {review.today} · 마지막 체성분 기록 {review.latestDate ?? '없음'}</p>
      <section aria-label="기록 기반 운동 구성 제안" className="space-y-2 rounded-xl bg-violet-50 p-3">
        <h4 className="font-bold">{combined.recommendation.title}</h4>
        <p className="text-xs">기존 운동 기록 근거 {combined.recommendation.evidenceCount}회 · 근력 {combined.recommendation.strengthCount}회</p>
        {combined.recommendation.reasons.map(reason => <p className="text-xs" key={reason}>{reason}</p>)}
        {combined.composition && <p className="text-xs">현재 선택한 구성: {combined.composition.planName} · 근력 {combined.composition.strengthDays}일 · 회복 {combined.composition.recoveryDays}일 · 유산소 {combined.composition.cardioDays}일 · 코어 {combined.composition.coreDays}일 · 휴식 {combined.composition.restDays}일</p>}
        {combined.recommendation.change && <div className="text-xs">
          <p>변경 전: {combined.recommendation.change.before}</p>
          <p>검토할 변경: {combined.recommendation.change.after}</p>
          {combined.recommendation.change.preparation && <p>준비 조건: {combined.recommendation.change.preparation}</p>}
        </div>}
        <p className="text-xs">{combined.bodyRationale}</p>
        {combined.evidence.map(item => <p className="text-xs" key={item.key}>{item.label} 근거 · {item.summary}</p>)}
        <p className="text-xs">{combined.decisionBoundary}</p>
      </section>
      <p className="rounded-xl bg-gray-50 p-3">{review.nextAction}</p>
      <ul className="space-y-2">{review.metrics.map(metric => <li key={metric.key} className="rounded-xl bg-gray-50 p-3">
        <p className="font-semibold">{metric.label}: {metric.value === undefined ? '—' : `${metric.value}${metric.unit}`}</p>
        <p className="text-xs">{statusLabels[metric.status]}{metric.date ? ` · ${metric.date} · ${metric.ageDays}일 전` : ''}</p>
        {metric.ageDays !== undefined && metric.ageDays > BODY_COACH_RECENT_DAYS && metric.status !== 'stale' && <p className="text-xs">오래된 측정치 · 현재 비교 제외</p>}
        {metric.device && <p className="text-xs">출처 표기: {metric.device} · 저장 전 원문 확인 필요</p>}
        {metric.delta !== undefined && <p className="text-xs">{metric.fromDate} → {metric.date} · {metric.count}회 · 표시 수치 차이 {metric.delta > 0 ? '+' : ''}{metric.delta}{metric.unit === '%' ? '%p' : metric.unit}</p>}
      </li>)}</ul>
      <p className="text-xs">BMI가 누락되거나 OCR 후보가 모호하면 빈칸으로 유지합니다. 기존 저장 형식에는 모호함 사유가 남지 않아 미입력과 구별할 수 없습니다. 키·체중으로 대신 계산하지 않습니다.</p>
      {review.excludedDateCount > 0 && <p className="text-xs">잘못된 날짜 또는 미래 날짜 {review.excludedDateCount}건은 제외했습니다.</p>}
      {review.divergent && <p className="text-xs">근육량 kg와 근육률 %의 변화 방향이 다릅니다.</p>}
      <p className="text-xs leading-5">{review.limitation}</p>
      <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3">비교 기준과 자료 제한</summary><p>{review.criteria}</p></details>
    </div>}
  </section>;
}
