'use client';

import { useEffect, useRef, useState } from 'react';
import ExerciseGuidePanel from './ExerciseGuidePanel';
import { exerciseGuides } from '../data/exerciseGuides';
import { isRecordResetRunning } from '../data/appRecordReset';
import { exactPainEvidenceGuide, isPainEvidenceMap, painEvidenceRawText, positivePainSet,
  type PainEvidenceCoverage, type PainEvidenceSource } from '../data/workoutPainEvidence';
import { painEvidenceUnavailable, samePainEvidenceSnapshot, watchWorkoutPainEvidence,
  type PainEvidenceRead } from '../data/workoutPainEvidenceReader';

const statusLabels = { completed: '완료', partial: '일부 완료', stopped: '중단', unknown: '수행 상태 미확인' };
const backLabels = { none: '불편 없음이라는 저장값', stiff: '약간 뻐근함', pain: '통증 있음', worse: '운동 전보다 악화' };
const fieldLabels = { answered: '입력 있음', missing: '미응답', invalid: '값 확인불가' };
const unavailableLabels = {
  preparing: '계정의 기록을 준비 중이에요.', reset: '기록 초기화를 확인 중이에요.', pending: '저장·복구 상태를 확인 중이에요.',
  unreadable: '기록을 읽을 수 없어요. 원본은 변경하지 않았어요.', changed: '기록이 바뀌었어요. 최신 근거를 다시 확인해 주세요.',
  hidden: '화면을 다시 열면 최신 기록을 확인해요.',
};
const buttonClass = 'min-h-11 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800';
const sourceId = (date: string) => `workout-pain-source-${date}`;

function Coverage({ value, label }: { value: PainEvidenceCoverage; label: string }) {
  return <section aria-label={label} className="min-w-0 rounded-xl bg-gray-50 p-3 text-xs leading-5">
    <h4 className="font-bold">{label}</h4><p>{value.start} ~ {value.end}</p>
    <p>일반 운동 기록이 있는 저장 날짜 {value.recorded}개</p>
    <p>부위 선택 {value.areaAnswered} · 미응답 {value.areaMissing} · 값 확인불가 {value.areaInvalid}</p>
    <p>부위·운동명 연결 입력 {value.pairAnswered} · 입력 부족 {value.pairMissing} · 값 확인불가 {value.pairInvalid}</p>
    <p>일반 운동 기록이 확인되지 않는 날짜 {value.unrecorded}개</p>
    {value.invalidRows > 0 && <p>날짜별 기록 자체를 읽을 수 없는 날짜 {value.invalidRows}개 (위 분모에서 제외)</p>}
  </section>;
}

function StoredFields({ row, labels }: { row: Record<string, unknown>; labels: Record<string, string> }) {
  return <>{Object.entries(labels).filter(([key]) => Object.hasOwn(row, key)).map(([key, label]) =>
    <p key={key}>{label} 원문: {painEvidenceRawText(row[key])}</p>)}</>;
}

function SourcePanel({ source, onClose }: { source: PainEvidenceSource; onClose: () => void }) {
  const matchingSets = source.linkedExercises.flatMap(row => Array.isArray(row.sets)
    ? row.sets.filter(set => isPainEvidenceMap(set) && positivePainSet(set.setNumber) && set.setNumber === source.painSet) : []);
  return <section id={sourceId(source.date)} tabIndex={-1} aria-label={`${source.date} 저장 기록 근거`}
    className="mt-3 min-w-0 rounded-xl border border-violet-200 p-3 text-xs leading-5 focus:outline-violet-500">
    <h4 className="font-bold">{source.date} 저장 기록 근거</h4>
    {source.invalidRow ? <p>이 날짜의 기록 구조를 읽을 수 없어요. 일반 운동 기록 여부나 통증 응답을 판단하지 않아요.</p> : <>
      <p>{statusLabels[source.status]}</p>
      <p>수행 상태 원문: {painEvidenceRawText(source.rawStatus)} · 완료표시 원문: {painEvidenceRawText(source.rawDone)}</p>
      <p className="whitespace-pre-wrap">부위 원문: {painEvidenceRawText(source.rawArea)} · {fieldLabels[source.areaState]}</p>
      <p className="whitespace-pre-wrap">발생 운동명 원문: {painEvidenceRawText(source.rawExercise)}</p>
      <p>부위·운동명 연결: {fieldLabels[source.pairState]}</p>
      <p>발생 세트 원문: {painEvidenceRawText(source.rawPainSet)}{source.painSet !== null ? ` · 저장된 번호 ${source.painSet}` : ' · 값이 없거나 유효한 양의 정수가 아님'}</p>
      {matchingSets.length === 0 ? <p>발생 세트 연결 미확인</p> : <p>같은 세트 번호의 후보 {matchingSets.length}개. 여러 라운드 중 특정 발생 라운드로 단정하지 않아요.</p>}
      <p>통증·신경 관련 계산 플래그 원문: {painEvidenceRawText(source.rawPain)}</p>
      <p>통증 여부에 대한 명시 응답은 확인되지 않아요. false나 점수 0을 전신 무통증 응답으로 세지 않아요.</p>
      <p>허리 상태: {typeof source.rawBack === 'string' && Object.hasOwn(backLabels, source.rawBack)
        ? backLabels[source.rawBack as keyof typeof backLabels] : '미응답 또는 값 확인불가'} · 원문 {painEvidenceRawText(source.rawBack)}</p>
      <p>신경 증상 선택 원문: {painEvidenceRawText(source.rawNeurologicalSymptoms)}. 빈 배열은 명시적인 “없음” 응답으로 판단하지 않아요.</p>
      {source.invalidExerciseRecords && <p>세부 수행 기록에 읽을 수 없는 값이 있어요.</p>}
      {source.linkedExercises.length === 0 && <p>{source.exercise
        ? '발생 운동명 입력만 있음 · 세부 수행 연결 미확인'
        : '발생 운동명 입력 미확인 · 세부 수행 연결 미확인'}</p>}
      {source.linkedExercises.map((row, index) => {
        const score = row.painScore;
        const validScore = typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 10;
        const sets = Array.isArray(row.sets) ? row.sets.filter(set => isPainEvidenceMap(set)
          && positivePainSet(set.setNumber) && set.setNumber === source.painSet) : [];
        return <div key={index} className="mt-2 rounded-lg bg-gray-50 p-2">
          <p className="font-bold">연결된 세부 수행 후보 {index + 1}</p>
          <p>운동명 원문: {painEvidenceRawText(row.exerciseName)} · 수행 상태 원문: {painEvidenceRawText(row.status)}</p>
          <p>이 수행 행의 통증 점수: {validScore ? `${score}/10 (저장값)` : score === undefined ? '미입력' : `값 확인불가 · 원문 ${painEvidenceRawText(score)}`}</p>
          {isPainEvidenceMap(row.executionContext) ? <StoredFields row={row.executionContext} labels={{ method: '방식', roundNumber: '라운드', sequenceIndex: '실행 순서 인덱스', groupNumber: '그룹', sourceExerciseIndex: '원본 운동 인덱스' }} /> : <p>실행 라운드·순서 연결 미확인</p>}
          {sets.map((set, setIndex) => <div key={setIndex} className="mt-1 border-t border-gray-200 pt-1">
            <p>같은 세트 번호 후보 {setIndex + 1}</p><StoredFields row={set as Record<string, unknown>} labels={{ setNumber: '세트 번호', completed: '완료표시', reps: '반복수', weightKg: '중량(kg)', durationSeconds: '시간(초)', bandLevel: '밴드', leftReps: '왼쪽 반복수', rightReps: '오른쪽 반복수', restAfterSeconds: '세트 후 휴식(초)' }} />
          </div>)}
          {row.sets !== undefined && !Array.isArray(row.sets) && <p>세트 기록 구조 확인불가</p>}
          {Array.isArray(row.sets) && row.sets.some(set => !isPainEvidenceMap(set) || !positivePainSet(set.setNumber)) && <p>유효한 번호가 없는 세트 기록은 발생 세트로 연결하지 않았어요.</p>}
        </div>;
      })}
    </>}
    <button type="button" className={`${buttonClass} mt-3`} onClick={onClose}>날짜 기록 닫기</button>
  </section>;
}

export default function WorkoutPainEvidence() {
  const [read, setRead] = useState<PainEvidenceRead>(painEvidenceUnavailable('preparing'));
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const [guideKey, setGuideKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState('');
  const watcher = useRef<ReturnType<typeof watchWorkoutPainEvidence> | null>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const publish = (next: PainEvidenceRead) => { setSourceDate(null); setGuideKey(null); setShowAll(false); setRead(next); };
    const current = watchWorkoutPainEvidence({ window, document, storage: () => window.localStorage, resetRunning: isRecordResetRunning,
      now: () => new Date(), setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: id => window.clearTimeout(id) }, publish);
    watcher.current = current;
    return () => { watcher.current = null; current.dispose(); };
  }, []);

  useEffect(() => {
    if (!sourceDate) return;
    const target = document.getElementById(sourceId(sourceDate));
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [sourceDate]);

  const revalidate = () => {
    const current = watcher.current?.read() ?? painEvidenceUnavailable('preparing');
    if (!samePainEvidenceSnapshot(read, current)) {
      setSourceDate(null); setGuideKey(null); setShowAll(false); setRead(current);
      setNotice('기록이 바뀌었어요. 최신 근거를 다시 확인해 주세요.');
      return false;
    }
    setNotice(''); return true;
  };
  const dateLink = (date: string) => <a key={date} href={`#${sourceId(date)}`} className="inline-flex min-h-11 items-center rounded-lg px-2 text-violet-800 underline"
    onClick={event => {
      event.preventDefault();
      if (!revalidate()) return;
      sourceTrigger.current = event.currentTarget;
      if (sourceDate === date) {
        const target = document.getElementById(sourceId(date));
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest' });
      } else setSourceDate(date);
    }}>{date} 기록 보기</a>;
  const summary = read.status === 'ready' ? read.summary : null;
  const selectedSource = summary?.sources.find(source => source.date === sourceDate);

  return <section aria-label="부위·운동명 반복 입력" className="mb-4 min-w-0 break-words rounded-3xl bg-white p-4 text-gray-900 shadow-sm [overflow-wrap:anywhere]">
    <h3 className="font-bold">부위·운동명 반복 입력</h3>
    <p className="mt-2 text-xs leading-5 text-gray-600">예전 요일 기록은 날짜로 옮겨 저장되었을 수 있어, 과거 기록의 실제 발생일은 확인할 수 없어요.</p>
    <p className="mt-1 text-xs leading-5 text-gray-600">어제까지의 입력을 비교해요. 위 안전 보류는 오늘 신호도 확인하므로 기간과 합계가 다를 수 있어요. 이 카드는 계획이나 보류를 변경하지 않아요.</p>
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    {read.status === 'unavailable' ? <div className="mt-3 text-xs"><p role="status">{unavailableLabels[read.reason]}</p>
      <button className={`${buttonClass} mt-2`} type="button" onClick={() => watcher.current?.refresh()}>근거 다시 읽기</button></div> : summary && <>
      <p className="mt-3 text-xs">어제까지 28일 · {summary.total.start} ~ {summary.total.end}</p>
      <div className="mt-2"><Coverage label="전체 28일 입력 범위" value={summary.total} /></div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"><Coverage label="최근 14일" value={summary.recent} /><Coverage label="이전 14일" value={summary.previous} /></div>
      <p className="mt-2 text-xs leading-5 text-gray-600">단위는 서로 다른 저장 날짜예요. 기록 없는 날짜는 휴식·실패·무통증으로 판단하지 않아요. 부위 미응답과 입력 부족도 통증 없음이 아니에요.</p>
      {summary.total.recorded === 0 && summary.total.invalidRows === 0 ? <p className="mt-3 text-sm">이 기간에 확인할 일반 운동 기록이 없어요.</p>
        : summary.total.recorded === 0 ? <p className="mt-3 text-sm">이 기간의 날짜별 기록을 확인할 수 없어요.</p>
          : summary.repeated.length === 0 ? <p className="mt-3 text-sm">이 기간에 같은 부위·운동명이 2개 이상의 저장 날짜에서 확인되지 않았어요. 미응답은 통증 없음으로 판단하지 않아요.</p> : null}
      <div className="mt-3 space-y-3">{summary.repeated.map(pair => {
        const guide = exactPainEvidenceGuide(exerciseGuides, pair.exercise);
        return <article key={pair.key} className="min-w-0 rounded-xl border border-violet-100 p-3 text-xs leading-5">
          <h4 className="font-bold">{pair.area} · {pair.exercise}</h4>
          <p>부위·운동명이 함께 입력된 저장 날짜 {summary.total.pairAnswered}개 중 {pair.dates.length}개</p>
          <p>최근 14일 {pair.recent}개 / 이전 14일 {pair.previous}개</p>
          <p>최근 일반 운동 기록 {summary.recent.recorded}개 · 연결 입력 {summary.recent.pairAnswered}개 / 이전 일반 운동 기록 {summary.previous.recorded}개 · 연결 입력 {summary.previous.pairAnswered}개</p>
          <div className="flex flex-wrap">{pair.dates.map(dateLink)}</div>
          {guide ? <button type="button" className={buttonClass} aria-expanded={guideKey === pair.key}
            onClick={() => { if (revalidate()) setGuideKey(guideKey === pair.key ? null : pair.key); }}>{guideKey === pair.key ? '기존 가이드 닫기' : '기존 자세·중단 기준 보기'}</button>
            : <p>이 이름에 연결된 기존 가이드가 없어요.</p>}
          {guide && guideKey === pair.key && <div className="mt-2" aria-label={`${pair.exercise} 기존 일반 가이드`}>
            <p className="rounded-xl bg-gray-50 p-3">일반 가이드예요. 이 기록을 보고 안전한 대체 운동으로 판정한 내용은 아니에요. 위 안전 보류 안내가 있으면 그 안내를 먼저 확인해 주세요.</p>
            <ExerciseGuidePanel exercise={{ name: pair.exercise, details: [], guide }} />
          </div>}
        </article>;
      })}</div>
      {summary.sources.length > 0 && <><button type="button" className={`${buttonClass} mt-3`} aria-expanded={showAll}
        onClick={() => { if (revalidate()) { setShowAll(!showAll); if (showAll) setSourceDate(null); } }}>날짜별 전체 입력 근거 {showAll ? '접기' : '보기'}</button>
        {showAll && <div aria-label="날짜별 전체 입력 근거" className="mt-2 flex flex-wrap text-xs">{summary.sources.map(source => dateLink(source.date))}</div>}</>}
      {selectedSource && <SourcePanel source={selectedSource} onClose={() => { setSourceDate(null); sourceTrigger.current?.focus(); }} />}
      <p className="mt-3 text-xs leading-5 text-gray-600">2개 날짜는 반복 표시를 위한 기준이에요. 통증 발생률·원인·악화·회복·운동의 안전성을 판단하지 않아요. 다른 기기의 미동기화 기록이나 저장 전 수정 이력은 확인할 수 없어요.</p>
    </>}
  </section>;
}
