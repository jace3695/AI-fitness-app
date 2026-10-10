'use client';

import { LIVE_REPORT_FIELDS, type LiveFieldKey, type LiveFieldValue, type LiveReportDraft } from '@/lib/language-live/types';

const presenceLabels: Record<LiveFieldValue['presence'], string> = {
  reported: '보고됨', unknown: '미확인', none: '해당 없음', not_learned: '미학습',
};
const groups = [
  { title: '수업 기본 정보', start: 0, end: 3 },
  { title: '오늘 배운 내용', start: 3, end: 7 },
  { title: '듣기·말하기·읽기·쓰기', start: 7, end: 11 },
  { title: '교정과 다음 학습', start: 11, end: 18 },
  { title: '복습·망각·재학습', start: 18, end: 25 },
];

export default function ReportFields({ report, onChange, disabled = false, prefix = 'live-field' }: {
  report: LiveReportDraft;
  onChange?: (key: LiveFieldKey, value: LiveFieldValue) => void;
  disabled?: boolean;
  prefix?: string;
}) {
  return <div className="live-fields">
    {groups.map((group, groupIndex) => <details key={group.title} open={groupIndex === 0} className="live-field-group">
      <summary>{group.title}<span>{group.end - group.start}개 항목</span></summary>
      <div className="live-field-group-body">
        {LIVE_REPORT_FIELDS.slice(group.start, group.end).map(({ key, label }, index) => {
          const field = report.fields[key];
          const id = `${prefix}-${key}`;
          return <div className="live-field" key={key}>
            <label htmlFor={onChange ? id : undefined} className="live-field-label">{group.start + index + 1}. {label}</label>
            {onChange ? <>
              <textarea id={id} value={field.text} rows={key === 'lessonDate' ? 1 : 3} disabled={disabled}
                placeholder={key === 'lessonDate' ? '예: 2026-10-09 · 모르면 비워 두세요' : '보고서에 없는 내용은 미확인으로 두세요'}
                onChange={(event) => onChange(key, { ...field, text: event.target.value, presence: event.target.value.trim() ? 'reported' : 'unknown' })} />
              <label className="live-presence-label" htmlFor={`${id}-presence`}>기록 상태</label>
              <select id={`${id}-presence`} aria-label={`${label} 기록 상태`} value={field.presence} disabled={disabled}
                onChange={(event) => onChange(key, { ...field, presence: event.target.value as LiveFieldValue['presence'] })}>
                {Object.entries(presenceLabels).map(([value, text]) => <option value={value} key={value}>{text}</option>)}
              </select>
            </> : <>
              <span className="live-badge">{presenceLabels[field.presence]}</span>
              <p className="live-preserved-text">{field.text || '보고서에 기록되지 않았어요.'}</p>
            </>}
            {field.sourceBlocks && field.sourceBlocks.length > 1 ? <p className="live-hint">같은 표제가 {field.sourceBlocks.length}번 나왔어요. 원문을 함께 확인해 주세요.</p> : null}
          </div>;
        })}
      </div>
    </details>)}
  </div>;
}

export function ReportSource({ report }: { report: LiveReportDraft }) {
  return <>
    {report.warnings.length > 0 ? <div className="live-notice live-notice-warning"><strong>분석 시 확인할 내용</strong><ul>{report.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div> : null}
    {report.unparsedText ? <details className="live-source"><summary>항목으로 분류하지 못한 원문 보기</summary><p className="live-preserved-text">{report.unparsedText}</p></details> : null}
    <details className="live-source"><summary>붙여넣은 원문 그대로 보기</summary><p className="live-preserved-text" lang="ja">{report.rawText}</p></details>
  </>;
}
