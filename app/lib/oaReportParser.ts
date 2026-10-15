import type { InbodyRecord } from "../data/recordStorage";

type NumericKey = Exclude<keyof InbodyRecord, "memo"> | "weight";

type ReportRow = {
  key: NumericKey;
  centerY: number;
  min: number;
  max: number;
  decimals?: boolean;
};

const REPORT_ROWS: ReportRow[] = [
  { key: "weight", centerY: 0.105, min: 20, max: 300, decimals: true },
  { key: "bodyScore", centerY: 0.402, min: 1, max: 100 },
  { key: "bodyFatPercent", centerY: 0.4341, min: 1, max: 80, decimals: true },
  { key: "musclePercent", centerY: 0.4565, min: 1, max: 90, decimals: true },
  { key: "bmi", centerY: 0.479, min: 5, max: 80, decimals: true },
  { key: "boneMass", centerY: 0.502, min: 0.5, max: 15, decimals: true },
  { key: "proteinPercent", centerY: 0.5244, min: 1, max: 40, decimals: true },
  { key: "basalMetabolicRate", centerY: 0.5469, min: 500, max: 5000 },
  { key: "visceralFatLevel", centerY: 0.5693, min: 1, max: 50 },
  { key: "bodyAge", centerY: 0.5923, min: 10, max: 120 },
  { key: "fatFreeMass", centerY: 0.6147, min: 10, max: 250, decimals: true },
  { key: "subcutaneousFatPercent", centerY: 0.6372, min: 1, max: 80, decimals: true },
  { key: "bodyWaterPercent", centerY: 0.6602, min: 10, max: 80, decimals: true },
  { key: "subcutaneousFatMass", centerY: 0.6826, min: 0.1, max: 150, decimals: true },
  { key: "muscleMass", centerY: 0.7051, min: 5, max: 200, decimals: true },
  { key: "fatMass", centerY: 0.728, min: 0.1, max: 150, decimals: true },
  // 0.75 위치의 표준 체중은 현재 기록 필드에 없으므로 건너뛴다.
  { key: "leftArmFatMass", centerY: 0.7725, min: 0.1, max: 30, decimals: true },
  { key: "rightArmFatMass", centerY: 0.7954, min: 0.1, max: 30, decimals: true },
  { key: "bodyFatMass", centerY: 0.818, min: 0.1, max: 80, decimals: true },
  { key: "leftLegFatMass", centerY: 0.8403, min: 0.1, max: 50, decimals: true },
  { key: "rightLegFatMass", centerY: 0.8628, min: 0.1, max: 50, decimals: true },
  { key: "leftArmMuscleMass", centerY: 0.8853, min: 0.1, max: 30, decimals: true },
  { key: "rightArmMuscleMass", centerY: 0.9082, min: 0.1, max: 30, decimals: true },
  { key: "skeletalMuscleMass", centerY: 0.9307, min: 1, max: 100, decimals: true },
  { key: "leftLegMuscleMass", centerY: 0.9536, min: 0.1, max: 50, decimals: true },
  { key: "rightLegMuscleMass", centerY: 0.9761, min: 0.1, max: 50, decimals: true },
];

export type OaReportResult = {
  values: Partial<Record<NumericKey, number>>;
  detectedDate?: string;
  recognizedCount: number;
  reviewKeys?: NumericKey[];
};

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없습니다."));
    };
    image.src = url;
  });
}

function makeCrop(
  image: HTMLImageElement,
  centerY: number,
  kind: "header" | "score" | "value" | "plainValue" | "age" | "segment",
  variant = false,
) {
  const source = {
    header: { x: 0.02, width: 0.96, height: 0.075 },
    score: { x: 0.02, width: 0.94, height: 0.024 },
    // 상태 배지 직전까지만 잘라 배지 글자를 숫자로 오인하지 않게 한다.
    value: { x: variant ? 0.58 : 0.55, width: variant ? 0.39 : 0.43, height: 0.021 },
    // 상태 배지가 없는 무지방 체중은 값이 더 오른쪽에 정렬된다.
    plainValue: { x: 0.65, width: 0.33, height: 0.021 },
    // "40연령 단위"의 한글 획이 숫자로 합쳐지지 않도록 숫자만 자른다.
    age: { x: 0.62, width: 0.09, height: 0.018 },
    segment: { x: 0.68, width: 0.30, height: 0.021 },
  }[kind];
  const sourceHeight = image.naturalHeight * source.height;
  const sourceWidth = image.naturalWidth * source.width;
  const canvas = document.createElement("canvas");
  const targetHeight = kind === "header" ? 300 : variant ? 240 : 192;
  const contentHeight = targetHeight - 16;
  // 고정 최소 너비를 사용하면 320px 원본의 숫자가 가로로 2~3배
  // 찌그러진다. 원본 종횡비를 그대로 유지한 채 충분히 확대한다.
  canvas.width =
    Math.round((sourceWidth / sourceHeight) * contentHeight) + 16;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이미지 분석을 시작할 수 없습니다.");

  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    image.naturalWidth * source.x,
    image.naturalHeight * centerY - sourceHeight / 2,
    sourceWidth,
    sourceHeight,
    8,
    8,
    canvas.width - 16,
    canvas.height - 16,
  );

  // 보고서 숫자는 매우 연한 회색이다. 이진화하면 9의 꼬리나 6의 윗부분이
  // 사라져 29.9→20, 66.5→5처럼 읽히므로 회색조 대비만 높인다.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let darkest = 255;
  let lightest = 0;
  let darkPixels = 0;
  let contentPixels = 0;
  for (let index = 0; index < pixels.data.length; index += 4) {
    const x = (index / 4) % canvas.width;
    const y = Math.floor(index / 4 / canvas.width);
    if (x < 8 || x >= canvas.width - 8 || y < 8 || y >= canvas.height - 8) continue;
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    darkest = Math.min(darkest, gray);
    lightest = Math.max(lightest, gray);
    contentPixels++;
    if (gray < 128) darkPixels++;
    pixels.data[index] = gray;
    pixels.data[index + 1] = gray;
    pixels.data[index + 2] = gray;
  }
  const span = Math.max(1, lightest - darkest);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const x = (index / 4) % canvas.width;
    const y = Math.floor(index / 4 / canvas.width);
    if (x < 8 || x >= canvas.width - 8 || y < 8 || y >= canvas.height - 8) continue;
    const contrast = Math.max(
      0,
      Math.min(255, ((pixels.data[index] - darkest) / span) * 255),
    );
    const value = darkPixels > contentPixels / 2 ? 255 - contrast : contrast;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  if (kind !== "header") {
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 8; y < canvas.height - 8; y++) for (let x = 8; x < canvas.width - 8; x++) {
      if (pixels.data[(y * canvas.width + x) * 4] < 180) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right >= left && bottom >= top) {
      const tight = document.createElement("canvas");
      tight.width = right - left + 33; tight.height = bottom - top + 33;
      const tightContext = tight.getContext("2d");
      if (tightContext) {
        tightContext.fillStyle = "white"; tightContext.fillRect(0, 0, tight.width, tight.height);
        tightContext.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, 16, 16, right - left + 1, bottom - top + 1);
        return tight;
      }
    }
  }
  return canvas;
}

export function numberFromText(text: string, row: ReportRow) {
  if (row.key === "bodyAge" || !/\d/.test(text)) return undefined;
  const normalized = text.trim().replace(/,/g, ".")
    .replace(/\s*([.,])\s*/g, "$1");
  // One complete measurement only: never take the first digit of a label/range.
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:%|kg|kcal|points?)?\s*$/i);
  if (!match || (row.decimals && !match[1].includes("."))) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= row.min && value <= row.max ? value : undefined;
}

export function dateFromText(text: string) {
  const dates = new Set<string>();
  for (const match of text.matchAll(/(?<!\d)(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/g)) {
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const parsed = new Date(date + "T00:00:00Z");
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) dates.add(date);
  }
  return dates.size === 1 ? [...dates][0] : undefined;
}

export function agreedNumber(reads: { text: string; confidence: number }[], row: ReportRow) {
  const parsed = reads.map(read => read.confidence >= 60 ? numberFromText(read.text, row) : undefined);
  return parsed.length >= 2 && parsed.every(value => value !== undefined && value === parsed[0]) ? parsed[0] : undefined;
}

export async function parseOaReport(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<OaReportResult> {
  const image = await loadImage(file);
  if (image.naturalHeight / image.naturalWidth < 4.5) {
    throw new Error("오아 앱에서 저장한 긴 건강 리포트 전체 이미지를 선택해주세요.");
  }
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const values: Partial<Record<NumericKey, number>> = {};
  try {
    // The top contains multiple lines (account, date and time), not one line.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: "" });
    const headerResult = await worker.recognize(makeCrop(image, 0.04, "header"));
    const detectedDate = dateFromText(headerResult.data.text);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "" });
    for (let index = 0; index < REPORT_ROWS.length; index += 1) {
      const row = REPORT_ROWS[index];
      // This report uses an age category; do not convert its leading digits to years.
      if (row.key !== "bodyAge") {
        const kind = index <= 1 ? "score" : index === 10 ? "plainValue" : index >= 16 ? "segment" : "value";
        const reads = [];
        for (const variant of [false, true]) {
          const result = await worker.recognize(makeCrop(image, row.centerY, kind, variant));
          reads.push({ text: result.data.text, confidence: result.data.confidence });
        }
        const value = agreedNumber(reads, row);
        if (value !== undefined) values[row.key] = value;
      }
      onProgress?.(Math.round(((index + 1) / REPORT_ROWS.length) * 100));
    }
    // Do not invent decimals or replace observations with derived percentages.
    return { values, detectedDate, recognizedCount: Object.keys(values).length,
      reviewKeys: REPORT_ROWS.filter(row => values[row.key] === undefined).map(row => row.key) };
  } finally {
    await worker.terminate();
  }
}
