import type { BodyMetricSources } from '../data/recordStorage';
import type { OaReportResult } from './oaReportParser';
import type { ImageLike, Worker } from 'tesseract.js';

/** Public InBody270S English result-sheet labels, not private measurements. */
export const INBODY_270S_INVENTORY = [
  ['weight', 'Weight', 'kg'],
  ['skeletalMuscleMass', 'Skeletal Muscle Mass', 'kg'],
  ['bodyFatMass', 'Body Fat Mass', 'kg'],
  ['bodyFatPercent', 'Percent Body Fat', '%'],
  ['bmi', 'Body Mass Index', 'kg/m²'],
  ['fatFreeMass', 'Fat Free Mass', 'kg'],
  ['basalMetabolicRate', 'Basal Metabolic Rate', 'kcal'],
] as const;
type MetricKey = typeof INBODY_270S_INVENTORY[number][0];
export type InbodyOcrLine = { text: string; confidence: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
export type InbodyLayoutLine = InbodyOcrLine & { bbox: Box; words: (InbodyOcrLine & { bbox: Box })[] };
type Section = 'composition' | 'muscle' | 'obesity' | 'research';
type Field = { key: MetricKey; section: Section; label: RegExp; unit: RegExp; min: number; max: number; decimal?: boolean };
const FIELDS: Field[] = [
  { key: 'weight', section: 'composition', label: /^(?:Sum of the above\s+)?Weight\b/i, unit: /^kg$/i, min: 20, max: 300, decimal: true },
  { key: 'bodyFatMass', section: 'composition', label: /^(?:For storing excess energy\s+)?Body Fat Mass\b/i, unit: /^kg$/i, min: .1, max: 150, decimal: true },
  { key: 'skeletalMuscleMass', section: 'muscle', label: /^(?:SMM\s+)?Skeletal Muscle Mass\b/i, unit: /^kg$/i, min: .1, max: 200, decimal: true },
  { key: 'bodyFatPercent', section: 'obesity', label: /^(?:PBF\s+)?Percent Body Fat\b/i, unit: /^%$/, min: 1, max: 80, decimal: true },
  { key: 'bmi', section: 'obesity', label: /^(?:BMI\s+)?Body Mass Index\b/i, unit: /^kg\/m(?:2|²)$/i, min: 5, max: 80, decimal: true },
  { key: 'fatFreeMass', section: 'research', label: /^Fat Free Mass\b/i, unit: /^kg$/i, min: 10, max: 250, decimal: true },
  { key: 'basalMetabolicRate', section: 'research', label: /^Basal Metabolic Rate\b/i, unit: /^kcal$/i, min: 500, max: 5000 },
];
const SECTIONS: [RegExp, Section][] = [
  [/^(?:\d+\s+)?Body Composition Analysis$/i, 'composition'],
  [/^(?:\d+\s+)?Muscle-Fat Analysis$/i, 'muscle'],
  [/^(?:\d+\s+)?Obesity Analysis$/i, 'obesity'],
  [/^(?:\d+\s+)?Research Parameters$/i, 'research'],
];
const EXCLUDED_SECTION = /^(?:\d+\s+)?(?:Body Composition History|Segmental (?:Lean|Fat) Analysis|Weight Control|InBody Score|Whole Body Phase Angle|Waist-Hip Ratio|Visceral Fat Level|Calorie Expenditure of Exercise|Impedance)\b/i;
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
const UNSTORED_COMPOSITION_ROW = /^(?:(?:Total amount of water in body\s+)?Total Body Water\s+\(L\)|(?:For building muscles\s+)?Protein\s+\(kg\)|(?:For strengthening bones\s+)?Minerals\s+\(kg\))\s+\d+(?:\.\d+)?(?:\s*\(\s*\d+(?:\.\d+)?\s*[~–-]\s*\d+(?:\.\d+)?\s*\))?$/i;

/** Tesseract may split table columns into separate blocks. Rejoin only words
 * on the same visible row inside three independently identified headings.
 * Never concatenate the next text line or scrape the first available number. */
export function inbodyLayoutLines(lines: readonly InbodyLayoutLine[]): InbodyOcrLine[] {
  const findHeading = (text: string) => {
    const matches = lines.filter(line => line.confidence >= 60 && normalize(line.text) === text);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const start = findHeading('Body Composition Analysis');
  const end = findHeading('Muscle-Fat Analysis');
  const right = findHeading('Research Parameters');
  if (!start || !end || !right || end.bbox.y0 <= start.bbox.y1
    || Math.abs(start.bbox.x0 - end.bbox.x0) > (start.bbox.y1 - start.bbox.y0)
    || right.bbox.x0 <= Math.max(start.bbox.x1, end.bbox.x1)) return [];
  const leftEdge = start.bbox.x0 - (start.bbox.y1 - start.bbox.y0);
  // OCR glyph boxes for left-aligned headings and row text can differ by a
  // few pixels. Use a heading-height gutter, not exact x-coordinate equality.
  const rightEdge = right.bbox.x0 - (right.bbox.y1 - right.bbox.y0);
  const inTable = (box: Box) => box.y0 >= start.bbox.y1 && box.y1 <= end.bbox.y0
    && box.x0 >= leftEdge && box.x0 < rightEdge;
  const words = lines.flatMap(line => line.words).filter(word => inTable(word.bbox));
  const rows: { box: Box; words: typeof words }[] = [];
  for (const word of [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const box = word.bbox;
    const row = rows.find(row => Math.min(row.box.y1, box.y1) - Math.max(row.box.y0, box.y0)
      >= Math.min(row.box.y1 - row.box.y0, box.y1 - box.y0) * .6);
    if (row) { row.words.push(word); row.box.y0 = Math.min(row.box.y0, box.y0); row.box.y1 = Math.max(row.box.y1, box.y1); }
    else rows.push({ box: { ...box }, words: [word] });
  }
  const assembled = rows.map(row => ({ text: row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(' '),
    confidence: Math.min(...row.words.map(word => word.confidence)) }));
  const ordered = [...lines].sort((a, b) => Number(a.bbox.x0 >= rightEdge) - Number(b.bbox.x0 >= rightEdge) || a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return ordered.flatMap(line => line === start ? [{ text: line.text, confidence: line.confidence }, ...assembled]
    : inTable(line.bbox) ? [] : [{ text: line.text, confidence: line.confidence }]);
}

function measurement(text: string, field: Field) {
  const label = text.match(field.label);
  if (!label) return undefined;
  const tail = text.slice(label[0].length).trim();
  // Explicit label + explicit unit + one current value. A parenthesized
  // reference interval is permitted but is never itself a candidate.
  const number = '(\\d+(?:\\.\\d+)?)';
  const range = '(?:\\s*\\(\\s*\\d+(?:\\.\\d+)?\\s*[~–-]\\s*\\d+(?:\\.\\d+)?\\s*\\))?';
  const before = tail.match(new RegExp(`^\\(([^()]+)\\)\\s*${number}${range}$`));
  const after = tail.match(new RegExp(`^${number}\\s*([^\\s()]+)${range}$`));
  const unit = before?.[1] ?? after?.[2];
  const token = before?.[2] ?? after?.[1];
  if (!unit || !token || !field.unit.test(unit) || (field.decimal && !token.includes('.'))) return undefined;
  const value = Number(token);
  return Number.isFinite(value) && value >= field.min && value <= field.max
    ? { value, originalText: text, originalLabel: label[0], originalUnit: unit } : undefined;
}

/** Fail closed on unrecognized model, headings, units, chart ticks and duplicates. */
export function readInbody270sLines(lines: readonly InbodyOcrLine[]) {
  const normalized = lines.map(line => ({ ...line, text: normalize(line.text) }));
  const confirmedModel = normalized.some(line => line.confidence >= 60 && /^\[?\s*InBody\s*270S\s*\]?$/i.test(line.text));
  const candidates: Partial<Record<MetricKey, NonNullable<ReturnType<typeof measurement>>>> = {};
  const rejected = new Set<MetricKey>();
  let section: Section | undefined;
  if (!confirmedModel) return { candidates, confirmedModel };
  for (const line of normalized) {
    const heading = SECTIONS.find(([pattern]) => pattern.test(line.text));
    if (heading) { section = line.confidence >= 60 ? heading[1] : undefined; continue; }
    if (EXCLUDED_SECTION.test(line.text)) { section = undefined; continue; }
    const matchedFields = FIELDS.filter(item => item.section === section && item.label.test(line.text));
    if (!matchedFields.length && line.text) {
      // An unfamiliar heading/text row must not lend its later values the last
      // known section's meaning. Only complete known non-stored table rows pass.
      if (!(section === 'composition' && line.confidence >= 60 && UNSTORED_COMPOSITION_ROW.test(line.text))) section = undefined;
      continue;
    }
    for (const field of matchedFields) {
      const parsed = line.confidence >= 60 ? measurement(line.text, field) : undefined;
      if (!parsed || candidates[field.key]) rejected.add(field.key);
      else candidates[field.key] = parsed;
    }
  }
  for (const key of rejected) delete candidates[key];
  return { candidates, confirmedModel };
}

/** Two independently scaled OCR observations must both identify the same row. */
export function agreedInbody270sReport(observations: readonly (readonly InbodyOcrLine[])[]): OaReportResult {
  const reads = observations.map(readInbody270sLines);
  const values: OaReportResult['values'] = {};
  const metricSources: BodyMetricSources = {};
  if (reads.length >= 2 && reads.every(read => read.confirmedModel)) {
    for (const [key, label] of INBODY_270S_INVENTORY) {
      const candidate: ReturnType<typeof measurement> = reads[0].candidates[key];
      if (!candidate || !reads.every(read => read.candidates[key]?.value === candidate.value)) continue;
      values[key] = candidate.value;
      metricSources[key] = { device: 'InBody 270S English report', originalLabel: label,
        originalUnit: candidate.originalUnit, originalText: candidate.originalText,
        method: 'ocr', mappingVersion: 'inbody-270s-en-v1' };
    }
  }
  const known = reads.length >= 2 && reads.every(read => read.confirmedModel);
  return { values, metricSources, recognizedCount: Object.keys(values).length,
    reviewKeys: INBODY_270S_INVENTORY.filter(([key]) => values[key] === undefined).map(([key]) => key),
    warnings: [known
      ? 'InBody270S 영문 결과지의 명확한 라벨·단위가 있는 항목만 읽어요. 그래프 눈금·목표값·과거 기록은 제외합니다. 측정 날짜는 사진에서 직접 확인해 입력해 주세요.'
      : 'InBody270S 영문 양식을 확인하지 못했어요. 자동 반영하지 않으며 사진의 항목명·단위를 직접 확인해야 합니다. 다른 양식은 자동 지원하지 않아요.'] };
}

/** Explicit same-origin static-asset hosting; ordinary callers keep Tesseract's defaults. */
export type InbodyOcrAssets = { basePath: string };
export function inbodyLocalAssetOptions(assets: InbodyOcrAssets) {
  const path = assets.basePath;
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('//')
    || path.endsWith('/') || path.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('OCR 정적 자산 경로를 확인해 주세요.');
  }
  return { workerPath: `${path}/worker.min.js`, corePath: path, langPath: path,
    workerBlobURL: false, cacheMethod: 'none' as const };
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다.')); };
    image.src = url;
  });
}

export async function parseInbody270sReport(file: File, onProgress?: (progress: number) => void, assets?: InbodyOcrAssets): Promise<OaReportResult> {
  const localAssets = assets ? inbodyLocalAssetOptions(assets) : undefined;
  const image = await loadImage(file);
  const ratio = image.naturalHeight / image.naturalWidth;
  if (!Number.isFinite(ratio) || ratio < 1 || ratio > 2) throw new Error('InBody270S 영문 전체 결과지 사진을 선택해 주세요. OA 긴 보고서는 다른 형식을 선택해야 합니다.');
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = localAssets ? await createWorker('eng', undefined, localAssets) : await createWorker('eng');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, tessedit_char_whitelist: '' });
    const images: HTMLCanvasElement[] = [];
    for (const width of [1800, 2100]) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = Math.round(width * ratio);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이미지 분석을 시작할 수 없습니다.');
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      images.push(canvas);
    }
    return await recognizeInbody270sImages(images, worker, onProgress);
  } finally {
    await worker.terminate();
  }
}

/** Shared local OCR adapter; accepts browser canvases or isolated Node buffers. */
export async function recognizeInbody270sImages(images: readonly ImageLike[], worker: Pick<Worker, 'recognize'>, onProgress?: (progress: number) => void) {
  const observations: InbodyOcrLine[][] = [];
  for (const image of images) {
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    observations.push(inbodyLayoutLines((result.data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph =>
      paragraph.lines.map(line => ({ ...line, confidence: Math.min(line.confidence, ...line.words.map(word => word.confidence)) }))))));
    onProgress?.(Math.round(observations.length / images.length * 100));
  }
  return agreedInbody270sReport(observations);
}
