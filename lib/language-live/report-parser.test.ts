import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_REPORT_FIELDS, LIVE_REPORT_MAX_LENGTH } from './types.ts';
import { parseLiveReport } from './report-parser.ts';
import { normalizeLiveReportMetadata, parseLiveLessonDate, validateLiveReport } from './validation.ts';
import { isSameLiveReport, stableLiveValue } from './identity.ts';

const raw = '[연이 AI 일본어 학습 기록 v1.1]\r\n- 학습 날짜: 2026-10-09\r\n- 수업 주제: あ・え\r\n- 현재 학습 단계: 왕초보\r\n- 교정한 표현과 교정 이유:\r\nえ → え (원문)\r\n이유: 두 번째 줄\r\n- 틀린 부분: 해당 없음\r\n- 쓰기 학습 결과: 미학습\r\n- 듣기 학습 결과: 미확인';

test('v1.1 preserves exact CRLF/Japanese source and multiline correction, without invented observations', () => {
  const report = parseLiveReport(raw);
  assert.equal(report.rawText, raw);
  assert.equal(report.reportVersion, 'v1.1');
  assert.equal(report.fields.corrections.text, 'え → え (원문)\n이유: 두 번째 줄');
  assert.equal(report.fields.errors.presence, 'none');
  assert.equal(report.fields.writing.presence, 'not_learned');
  assert.equal(report.fields.listening.presence, 'unknown');
  assert.equal(report.fields.speaking.presence, 'unknown');
  assert.equal(report.lessonDate, '2026-10-09');
  assert.equal(report.lessonTimezone, 'Asia/Seoul');
  assert.equal(Object.keys(report.fields).length, 25);
  assert.deepEqual(validateLiveReport(report), []);
});

test('old v1 accepts eighteen fields and keeps seven additions unknown', () => {
  const text = '[연이 AI 일본어 학습 기록 v1]\n' + LIVE_REPORT_FIELDS.slice(0, 18).map(({ key, label }) => `${label}: ${key === 'lessonDate' ? '2026년 10월 9일' : key}`).join('\n');
  const report = parseLiveReport(text);
  assert.equal(report.reportVersion, 'v1');
  for (const { key } of LIVE_REPORT_FIELDS.slice(18)) assert.deepEqual(report.fields[key], { text: '', presence: 'unknown', sourceBlocks: [] });
  assert.deepEqual(validateLiveReport(report), []);
});

test('markdown labels and repeated headings retain every occurrence, with warning', () => {
  const report = parseLiveReport('앞 문단\n**학습 날짜:** 2026.10.9\n- **오늘 배운 단어**: え\n다음 줄\n2. 오늘 배운 단어： エ\n# 수업 주제: 첫 수업');
  assert.equal(report.unparsedText, '앞 문단');
  assert.equal(report.fields.vocabulary.text, 'え\n다음 줄\n\nエ');
  assert.deepEqual(report.fields.vocabulary.sourceBlocks, ['え\n다음 줄', 'エ']);
  assert.ok(report.warnings.some(item => item.includes('반복')));
  assert.equal(report.lessonDate, '2026-10-09');
});

test('missing date/version remains unknown, never becomes import date or not learned', () => {
  const report = parseLiveReport('수업 주제: 첫 수업\n듣기 학습 결과:\n');
  assert.equal(report.lessonDate, null);
  assert.equal(report.reportVersion, 'unknown');
  assert.equal(report.fields.lessonDate.presence, 'unknown');
  assert.deepEqual(validateLiveReport(report), []);
  assert.equal(parseLiveReport('[연이 AI 일본어 학습 기록 v2.0]').reportVersion, 'unknown');
});

test('calendar dates reject rollover, invalid leap days and ambiguous free prose', () => {
  for (const text of ['2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01', '어제', '10/9/2026']) assert.equal(parseLiveLessonDate(text), null, text);
  assert.equal(parseLiveLessonDate('2024-02-29'), '2024-02-29');
  assert.equal(parseLiveLessonDate('2026년 10월 9일'), '2026-10-09');
  assert.ok(validateLiveReport(parseLiveReport('학습 날짜: 2026-02-29')).some(item => item.includes('날짜')));
});

test('structured edits update metadata without altering original source or source blocks', () => {
  const report = parseLiveReport(raw);
  const changed = normalizeLiveReportMetadata({ ...report, fields: { ...report.fields, lessonDate: { ...report.fields.lessonDate, text: '2026-10-08' }, topic: { ...report.fields.topic, text: '바꾼 주제' } } });
  assert.equal(changed.rawText, raw);
  assert.equal(changed.lessonDate, '2026-10-08');
  assert.equal(changed.topic, '바꾼 주제');
  assert.deepEqual(changed.fields.lessonDate.sourceBlocks, ['2026-10-09']);
  assert.deepEqual(validateLiveReport(changed), []);
  assert.ok(validateLiveReport({ ...changed, lessonDate: '2026-10-09' }).length);
});

test('oversized, malformed fields and empty source fail explicitly without truncation', () => {
  const text = 'あ'.repeat(LIVE_REPORT_MAX_LENGTH + 1);
  assert.throws(() => parseLiveReport(text), /잘라내지/);
  assert.ok(validateLiveReport(parseLiveReport(' ')).length);
  assert.ok(validateLiveReport({ ...parseLiveReport(raw), fields: {} }).length);
  assert.ok(validateLiveReport({ ...parseLiveReport(raw), lessonTimezone: 'bad-timezone' }).length);
  assert.ok(validateLiveReport({ ...parseLiveReport(raw), fields: { ...parseLiveReport(raw).fields, listening: { text: '', presence: 'mastered' } } }).length);
});

test('duplicate candidates preserve distinct dates, orthography and array order', () => {
  const left = parseLiveReport(raw);
  assert.equal(isSameLiveReport(left, parseLiveReport(raw)), true);
  assert.equal(isSameLiveReport(left, parseLiveReport(raw.replace('2026-10-09', '2026-10-10'))), false);
  assert.equal(isSameLiveReport(left, parseLiveReport(raw.replace('え', 'エ'))), false);
  assert.equal(stableLiveValue({ a: 1, b: 2 }), stableLiveValue({ b: 2, a: 1 }));
  assert.notEqual(stableLiveValue([1, 2]), stableLiveValue([2, 1]));
});

test('all 25 fields, source identity, no-colon markdown headings and marked-up values survive', () => {
  const report = parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n' + LIVE_REPORT_FIELDS.map(({ key, label }) => key === 'lessonDate' ? '## 1. **학습 날짜**\n2026-10-09' : `${label}: **${key}**`).join('\n'));
  assert.equal(report.source, 'chatgpt_live_manual');
  assert.equal(report.importFormat, 'labelled_text');
  assert.equal(report.structuredSchemaVersion, 1);
  assert.equal(report.fields.topic.text, '**topic**');
  assert.equal(report.fields.evidenceAndUncertainty.text, '**evidenceAndUncertainty**');
  assert.deepEqual(validateLiveReport(report), []);
});

test('many repeated sections retain every block without an unbounded warning list', () => {
  const report = parseLiveReport(Array.from({ length: 200 }, (_, index) => `오늘 배운 단어: ${index}`).join('\n'));
  assert.equal(report.fields.vocabulary.sourceBlocks?.length, 200);
  assert.ok(report.warnings.length < 100);
  assert.deepEqual(validateLiveReport(report), []);
});

test('conflicting report titles and incidental version mentions never assert a known version', () => {
  assert.equal(parseLiveReport('[연이 AI 일본어 학습 기록 v1]\n[연이 AI 일본어 학습 기록 v1.1]').reportVersion, 'unknown');
  assert.equal(parseLiveReport('교정한 표현과 교정 이유: 다음에는 연이 AI 일본어 학습 기록 v1.1 작성').reportVersion, 'unknown');
});

test('HTML, combining marks, fullwidth kana and raw Unicode are preserved literally', () => {
  const source = '수업 주제: <script>alert(1)</script>\n오늘 배운 단어: ｶﾞ・か\u3099・ガ\n교정한 표현과 교정 이유: **え**';
  const report = parseLiveReport(source);
  assert.equal(report.rawText, source);
  assert.equal(report.fields.vocabulary.text, 'ｶﾞ・か\u3099・ガ');
  assert.equal(report.fields.corrections.text, '**え**');
  assert.equal(report.topic, '<script>alert(1)</script>');
});

test('malformed/cyclic reports are validation errors and punctuated unknown dates are allowed', () => {
  const malformed: Record<string, unknown> = { ...parseLiveReport(raw) };
  malformed.extra = malformed;
  assert.ok(validateLiveReport(malformed).length);
  assert.deepEqual(validateLiveReport(parseLiveReport('학습 날짜: 미확인。')), []);
  assert.ok(validateLiveReport({ ...parseLiveReport(raw), source: 'automatic_sync' }).length);
});
