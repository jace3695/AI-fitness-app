import { LIVE_REPORT_FIELDS, LIVE_REPORT_MAX_LENGTH, LIVE_REPORT_TIMEZONE, LanguageLiveError, type LiveFieldKey, type LiveFieldPresence, type LiveReportDraft } from './types.ts';
import { normalizeLiveReportMetadata } from './validation.ts';

function presence(text: string): LiveFieldPresence {
  const clean = text.trim();
  if (/^(?:없음|해당\s*없음|없습니다|none|not\s+applicable)[.!。]?$/i.test(clean)) return 'none';
  if (/^(?:미학습|아직\s*(?:배우지|학습하지)\s*않음|학습하지\s*않음)[.!。]?$/.test(clean)) return 'not_learned';
  if (!clean || /^(?:미확인|확인\s*필요|알\s*수\s*없음|기록\s*없음|미기재|미상|unknown|n\/?a)[.!。]?$/i.test(clean)) return 'unknown';
  return 'reported';
}

/** Deterministic, free parser. Original text never passes through normalization. */
export function parseLiveReport(rawText: string): LiveReportDraft {
  if (typeof rawText !== 'string' || rawText.length > LIVE_REPORT_MAX_LENGTH) throw new LanguageLiveError('validation', `보고서 원문은 ${LIVE_REPORT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 분석할 수 있어요. 입력은 잘라내지 않았어요.`);
  const fields = LIVE_REPORT_FIELDS.reduce((result, { key }) => {
    result[key] = { text: '', presence: 'unknown', sourceBlocks: [] };
    return result;
  }, {} as LiveReportDraft['fields']);
  const warnings: string[] = [];
  const unknownLines: string[] = [];
  const fieldByLabel = new Map<string, LiveFieldKey>(LIVE_REPORT_FIELDS.map(({ key, label }) => [label.replace(/\s/g, ''), key]));
  let currentKey: LiveFieldKey | null = null;
  let block: string[] = [];
  const flush = () => {
    if (!currentKey) { unknownLines.push(...block); block = []; return; }
    const value = block.join('\n').trim();
    fields[currentKey].sourceBlocks!.push(value);
    fields[currentKey].text = fields[currentKey].sourceBlocks!.join('\n\n');
    fields[currentKey].presence = presence(fields[currentKey].text);
    block = [];
  };
  for (const line of rawText.replace(/\r\n?/g, '\n').split('\n')) {
    // Accept common markdown decoration only around the known heading itself.
    const candidate = line.replace(/^\s*(?:#{1,6}\s+)?(?:[-*•]\s+|\d+[.)]\s+)?/, '');
    const colon = candidate.search(/[:：]/);
    const label = (colon >= 0 ? candidate.slice(0, colon) : candidate).replace(/\*\*/g, '').trim().replace(/\s/g, '');
    const key = fieldByLabel.get(label);
    if (key) {
      flush();
      if (fields[key].sourceBlocks!.length) warnings.push(`${LIVE_REPORT_FIELDS.find(field => field.key === key)!.label} 표제가 반복되어 내용을 모두 보존했어요.`);
      currentKey = key;
      const value = colon >= 0 ? candidate.slice(colon + 1) : '';
      // A closing markdown marker belongs to a bold heading, never the value.
      block = [candidate.startsWith('**') && candidate.slice(0, colon).split('**').length === 2 ? value.replace(/^\*\*/, '').replace(/^\s/, '') : value.replace(/^\s/, '')];
    } else block.push(line);
  }
  flush();
  const versionMatches = [...rawText.matchAll(/^\s*(?:#{1,6}\s+)?(?:\*\*)?\[?연이\s*AI\s*일본어\s*학습\s*기록\s*v\s*(\d+(?:\.\d+)*)(?=\s|\]|\*|$)/gim)];
  const versions = new Set(versionMatches.map(match => match[1]));
  const version = versions.size === 1 ? versionMatches[0][1] : null;
  const reportVersion = version === '1.1' ? 'v1.1' : version === '1' ? 'v1' : 'unknown';
  if (versions.size > 1) warnings.push('서로 다른 보고서 버전 표제가 있어요. 여러 수업이 함께 붙여넣어졌는지 확인해 주세요.');
  if (reportVersion === 'unknown') warnings.push('보고서 버전을 확인하지 못했어요. 원문과 분석 항목을 확인해 주세요.');
  if (reportVersion === 'v1') warnings.push('이전 v1 보고서예요. 추가된 7개 항목은 보고된 내용이 없으면 미확인으로 보존해요.');
  const recognized = LIVE_REPORT_FIELDS.filter(({ key }) => fields[key].sourceBlocks!.length > 0).length;
  if (!recognized) warnings.push('알려진 표제를 찾지 못했어요. 원문을 보존했으니 항목을 직접 확인해 주세요.');
  if (recognized < LIVE_REPORT_FIELDS.length) warnings.push(`25개 항목 중 ${recognized}개 표제를 찾았어요. 누락 항목은 미확인이에요.`);
  const report = normalizeLiveReportMetadata({ rawText, reportVersion, parserVersion: '1.0.0', source: 'chatgpt_live_manual', importFormat: 'labelled_text', structuredSchemaVersion: 1, fields, lessonDate: null, lessonTimezone: LIVE_REPORT_TIMEZONE, topic: '', stage: '', warnings: [...new Set(warnings)], unparsedText: unknownLines.join('\n') });
  if (!report.lessonDate) report.warnings.push('수업 날짜를 확인하지 못했어요. 등록 날짜를 수업 날짜로 대신 쓰지 않아요.');
  return report;
}
