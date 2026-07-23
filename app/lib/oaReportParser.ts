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
  { key: "bodyScore", centerY: 0.402, min: 0, max: 100 },
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
  kind: "header" | "score" | "value" | "segment",
) {
  const source = {
    header: { x: 0.12, width: 0.76, height: 0.034 },
    score: { x: 0.04, width: 0.52, height: 0.028 },
    value: { x: 0.52, width: 0.44, height: 0.018 },
    segment: { x: 0.64, width: 0.33, height: 0.018 },
  }[kind];
  const sourceHeight = image.naturalHeight * source.height;
  const sourceWidth = image.naturalWidth * source.width;
  const canvas = document.createElement("canvas");
  const targetHeight = kind === "header" ? 120 : 96;
  canvas.width = Math.max(420, Math.round((sourceWidth / sourceHeight) * targetHeight));
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

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const value = gray < 242 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function numberFromText(text: string, row: ReportRow) {
  const normalized = text
    .replace(/,/g, ".")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1");
  const candidates = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const candidate of candidates) {
    let value = Number(candidate);
    if (!Number.isFinite(value)) continue;
    // 소수점이 희미해 빠진 경우(예: 299 → 29.9)를 항목 범위로 복구한다.
    if (row.decimals && !candidate.includes(".")) {
      while (value > row.max && value / 10 >= row.min) value /= 10;
    }
    if (value >= row.min && value <= row.max) return value;
  }
}

export async function parseOaReport(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<OaReportResult> {
  const image = await loadImage(file);
  if (image.naturalHeight / image.naturalWidth < 4.5) {
    throw new Error("오아 앱에서 저장한 긴 건강 보고서 원본을 선택해주세요.");
  }

  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const values: Partial<Record<NumericKey, number>> = {};
  let detectedDate: string | undefined;

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: "0123456789.-%kg",
    });

    const header = makeCrop(image, 0.035, "header");
    const headerResult = await worker.recognize(header);
    const dateMatch = headerResult.data.text.match(
      /(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/,
    );
    if (dateMatch) {
      detectedDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    for (let index = 0; index < REPORT_ROWS.length; index += 1) {
      const row = REPORT_ROWS[index];
      const kind =
        index === 0 ? "score" : index === 1 ? "score" : index >= 16 ? "segment" : "value";
      const result = await worker.recognize(makeCrop(image, row.centerY, kind));
      const value = numberFromText(result.data.text, row);
      if (value !== undefined) values[row.key] = value;
      onProgress?.(Math.round(((index + 1) / REPORT_ROWS.length) * 100));
    }

    return {
      values,
      detectedDate,
      recognizedCount: Object.keys(values).length,
    };
  } finally {
    await worker.terminate();
  }
}
