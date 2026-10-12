'use client';

import { LIVE_REPORT_FIELDS, type LiveLesson } from '@/lib/language-live/types';
import { LIVE_EVENT_KINDS, LIVE_EVENT_RESULTS, LIVE_ITEM_KINDS, LIVE_SKILLS, type LiveItemIdentity, type LiveLearningEvent } from '@/lib/language-live/learning-types';
import { matchLiveItem } from '@/lib/language-live/learning-validation';
import { learningSourceProblems } from '@/app/language/live/learning-draft';
import { itemKindLabels, kindLabels, resultLabels, skillLabels } from './LearningDashboard';

export default function LearningEventEditor({ entry, reviewed, lesson, items, relearning, disabled, onChange, onReview, onConfirm, onCancel }: {
  entry: LiveLearningEvent;
  reviewed: boolean;
  lesson: LiveLesson;
  items: LiveItemIdentity[];
  relearning: LiveLearningEvent[];
  disabled: boolean;
  onChange: (event: LiveLearningEvent) => void;
  onReview: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const known = items.find(item => item.itemId === entry.item.itemId);
  const matches = matchLiveItem(entry.item, items).filter(item => item.itemId !== entry.item.itemId);
  const problems = learningSourceProblems(entry, lesson);
  const sources = relearning.filter(event => event.kind === 'relearn' && event.eventId !== entry.eventId && event.item.itemId === entry.item.itemId && event.skill === entry.skill);
  if (entry.kind === 'reassessment' && !sources.some(event => event.eventId === entry.linkedRelearningEventId)) problems.push('같은 항목·영역의 현재 유효한 재학습 기록을 연결해 주세요.');
  const change = (patch: Partial<LiveLearningEvent>) => onChange({ ...entry, ...patch });
  const chooseKind = (kind: LiveLearningEvent['kind']) => change({ kind, result: 'not_assessed', independent: null, hintUsed: null, forgettingConfirmed: false, linkedRelearningEventId: null });
  const chooseResult = (result: LiveLearningEvent['result']) => change({ result, independent: result === 'independent_correct' ? true : result === 'hinted_correct' ? false : null,
    hintUsed: result === 'independent_correct' ? false : result === 'hinted_correct' ? true : null, forgettingConfirmed: false });
  return <section className="live-confirm" aria-labelledby="live-observation-title"><h3 id="live-observation-title">보고서에서 관찰 한 건 확인</h3>
    <p className="live-hint">자유문장을 자동 평가하지 않아요. 보고서의 실제 관찰을 항목별로 직접 연결해 주세요. 불확실한 내용은 불확실로 보존합니다.</p>
    <fieldset className="live-learning-fieldset" disabled={disabled}>
      <label htmlFor="live-known-item">기존 학습 항목 연결</label><select id="live-known-item" value={known?.itemId ?? ''} onChange={event => { const item = items.find(value => value.itemId === event.target.value); change({ item: item ? { ...item } : { itemId: crypto.randomUUID(), kind: 'kana', text: '', meaning: '' }, linkedRelearningEventId: null }); }}><option value="">새 항목을 직접 입력</option>{items.map(item => <option key={item.itemId} value={item.itemId}>{itemKindLabels[item.kind]} · {item.text}{item.meaning ? ` · ${item.meaning}` : ''}</option>)}</select>
      <div className="live-learning-grid"><div><label htmlFor="live-item-kind">항목 종류</label><select id="live-item-kind" value={entry.item.kind} disabled={Boolean(known)} onChange={event => change({ item: { ...entry.item, kind: event.target.value as LiveItemIdentity['kind'] } })}>{LIVE_ITEM_KINDS.map(kind => <option key={kind} value={kind}>{itemKindLabels[kind]}</option>)}</select></div>
        <div><label htmlFor="live-item-text">일본어 항목 원문</label><input id="live-item-text" lang="ja" value={entry.item.text} disabled={Boolean(known)} onChange={event => change({ item: { ...entry.item, text: event.target.value } })} /></div></div>
      <label htmlFor="live-item-meaning">뜻·용법 구분 (선택)</label><input id="live-item-meaning" value={entry.item.meaning} disabled={Boolean(known)} onChange={event => change({ item: { ...entry.item, meaning: event.target.value } })} />
      {known ? <p className="live-hint">기존 항목과 연결했어요. 일본어 표기와 뜻은 그대로 유지합니다.</p> : null}
      {matches.length ? <div className="live-notice live-notice-warning"><p>같은 종류·표기·뜻의 항목이 있어요. 확인해서 연결해 주세요.</p>{matches.map(item => <button type="button" key={item.itemId} onClick={() => change({ item: { ...item } })}>기존 {item.text} 항목에 연결</button>)}</div> : null}
      <div className="live-learning-grid"><div><label htmlFor="live-event-skill">학습 영역</label><select id="live-event-skill" value={entry.skill} onChange={event => change({ skill: event.target.value as LiveLearningEvent['skill'], linkedRelearningEventId: null })}>{LIVE_SKILLS.map(skill => <option key={skill} value={skill}>{skillLabels[skill]}</option>)}</select></div>
        <div><label htmlFor="live-event-kind">관찰 종류</label><select id="live-event-kind" value={entry.kind} onChange={event => chooseKind(event.target.value as LiveLearningEvent['kind'])}>{LIVE_EVENT_KINDS.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></div></div>
      <label htmlFor="live-source-field">근거가 있는 보고서 항목</label><select id="live-source-field" value={entry.sourceField} onChange={event => change({ sourceField: event.target.value as LiveLearningEvent['sourceField'], evidenceText: '' })}>{LIVE_REPORT_FIELDS.map(field => <option value={field.key} key={field.key}>{field.label}</option>)}</select>
      <div className="live-source-excerpt" aria-label="선택한 보고서 내용"><p className="live-preserved-text">{lesson.report.fields[entry.sourceField].text || '이 항목에 보고된 내용이 없어요.'}</p></div>
      <label htmlFor="live-evidence-text">그대로 옮긴 평가 근거</label><textarea id="live-evidence-text" value={entry.evidenceText} rows={3} onChange={event => change({ evidenceText: event.target.value })} />
      <p className="live-hint">위 내용에서 해당 관찰의 문장을 그대로 복사해 주세요. 요약·번역으로 바꾸거나 없는 평가를 추가하지 않아요.</p>
      <div className="live-learning-grid"><div><label htmlFor="live-event-date">실제 관찰 날짜</label><input id="live-event-date" type="date" value={entry.occurredDate ?? ''} onChange={event => change({ occurredDate: event.target.value || null, teacherRecommendationConfirmed: false })} /><p className="live-hint">수업 날짜가 있으면 표시해요. 다른 날의 관찰이면 수정하고, 모르면 비워 두세요.</p></div>
        <div><label htmlFor="live-certainty">평가의 확실성</label><select id="live-certainty" value={entry.certainty} onChange={event => change({ certainty: event.target.value as LiveLearningEvent['certainty'], forgettingConfirmed: false })}><option value="uncertain">불확실 · 상태 확정 보류</option><option value="confirmed">보고서에서 명확히 확인</option></select></div></div>
      <label htmlFor="live-event-result">평가 결과</label><select id="live-event-result" value={entry.result} disabled={['learn', 'not_learned', 'relearn'].includes(entry.kind)} onChange={event => chooseResult(event.target.value as LiveLearningEvent['result'])}>{LIVE_EVENT_RESULTS.map(result => <option key={result} value={result}>{resultLabels[result]}</option>)}</select>
      <p className="live-hint">새 학습·미학습·재학습 실시는 평가하지 않음으로 기록해요. 정답 여부는 별도의 복습·재평가 관찰로 추가해 주세요.</p>
      <div className="live-learning-grid"><div><label htmlFor="live-independent">독립 수행 여부</label><select id="live-independent" value={entry.independent === null ? '' : String(entry.independent)} disabled={['independent_correct', 'hinted_correct'].includes(entry.result)} onChange={event => change({ independent: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">미확인</option><option value="false">독립 수행 아님</option><option value="true" disabled={entry.result !== 'independent_correct'}>독립 정답 확인</option></select></div>
        <div><label htmlFor="live-hint-used">힌트 사용 여부</label><select id="live-hint-used" value={entry.hintUsed === null ? '' : String(entry.hintUsed)} disabled={['independent_correct', 'hinted_correct'].includes(entry.result)} onChange={event => change({ hintUsed: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">미확인</option><option value="true">힌트 사용</option><option value="false">힌트 사용 안 함</option></select></div></div>
      <label className="live-checkbox"><input type="checkbox" checked={entry.forgettingConfirmed} disabled={entry.certainty !== 'confirmed' || !['incorrect', 'cannot_recall'].includes(entry.result)} onChange={event => change({ forgettingConfirmed: event.target.checked })} /><span>일시적인 실수나 인식 오류가 아니라 망각을 다시 확인한 근거가 있어요.</span></label>
      {entry.kind === 'relearn' ? <><label htmlFor="live-relearning-text">실시한 재학습 내용</label><textarea id="live-relearning-text" value={entry.relearningText} rows={3} onChange={event => change({ relearningText: event.target.value })} /></> : null}
      {entry.kind === 'reassessment' ? <><label htmlFor="live-relearning-link">이번 재평가와 연결할 재학습</label><select id="live-relearning-link" value={entry.linkedRelearningEventId ?? ''} onChange={event => change({ linkedRelearningEventId: event.target.value || null })}><option value="">직접 선택해 주세요</option>{sources.map(event => <option value={event.eventId} key={event.eventId}>{event.occurredDate ?? '날짜 미확인'} · {event.item.text} · {event.relearningText}</option>)}</select>{!sources.length ? <p className="live-hint">이 항목·영역의 재학습 관찰을 먼저 추가하거나 유효한 다른 수업의 재학습을 확인해 주세요.</p> : null}</> : null}
      <label htmlFor="live-event-reason">관찰을 기록하는 이유</label><textarea id="live-event-reason" value={entry.reason} rows={2} onChange={event => change({ reason: event.target.value })} />
      <details className="live-source"><summary>선생님의 복습 권장일 직접 확인 (선택)</summary><div className="live-field-group-body"><label htmlFor="live-teacher-due">보고서의 복습 권장일</label><input id="live-teacher-due" type="date" value={entry.teacherRecommendedDue ?? ''} onChange={event => change({ teacherRecommendedDue: event.target.value || null, teacherRecommendationConfirmed: false })} /><label className="live-checkbox"><input type="checkbox" checked={entry.teacherRecommendationConfirmed} disabled={!entry.teacherRecommendedDue || !entry.occurredDate} onChange={event => change({ teacherRecommendationConfirmed: event.target.checked })} /><span>보고서에서 이 항목의 권장일을 확인했고 정책 계산일 대신 적용할게요.</span></label></div></details>
      {problems.length ? <ul className="live-hint">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
      <label className="live-checkbox"><input type="checkbox" checked={reviewed} onChange={event => onReview(event.target.checked)} /><span>항목·영역·관찰일·근거와 불확실성을 직접 확인했어요.</span></label>
      <div className="live-actions"><button type="button" className="live-primary" disabled={!reviewed || problems.length > 0 || matches.length > 0} onClick={onConfirm}>확인한 관찰을 목록에 반영</button><button type="button" onClick={onCancel}>이 관찰 입력 취소</button></div>
    </fieldset>
  </section>;
}
