import type { InbodyRecord } from "../data/recordStorage";

type NumericKey = Exclude<keyof InbodyRecord, "memo"> | "weight";

type ReportRow = {
  key: NumericKey;
  centerY: number;
};

const REPORT_ROWS: ReportRow[] = [
  { key: "weight", centerY: 0.105 },
  { key: "bodyScore", centerY: 0.398 },
  { key: "bodyFatPercent", centerY: 0.48 },
  { key: "musclePercent", centerY: 0.497 },
  { key: "bmi", centerY: 0.514 },
  { key: "boneMass", centerY: 0.532 },
  { key: "proteinPercent", centerY: 0.549 },
  { key: "basalMetabolicRate", centerY: 0.566 },
  { key: "visceralFatLevel", centerY: 0.583 },
  { key: "bodyAge", centerY: 0.6 },
  { key: "fatFreeMass", centerY: 0.618 },
  { key: "subcutaneousFatPercent", centerY: 0.635 },
  { key: "bodyWaterPercent", centerY: 0.652 },
  { key: "subcutaneousFatMass", centerY: 0.669 },
  { key: "muscleMass", centerY: 0.686 },
  { key: "fatMass", centerY: 0.704 },
  { key: "leftArmFatMass", centerY: 0.738 },
  { key: "rightArmFatMass", centerY: 0.755 },
  { key: "bodyFatMass", centerY: 0.772 },
  { key: "leftLegFatMass", centerY: 0.789 },
  { key: "rightLegFatMass", centerY: 0.806 },
  { key: "leftArmMuscleMass", centerY: 0.824 },
  { key: "rightArmMuscleMass", centerY: 0.841 },
  { key: "skeletalMuscleMass", centerY: 0.858 },
  { key: "leftLegMuscleMass", centerY: 0.875 },
  { key: "rightLegMuscleMass", centerY: 0.892 },
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

function makeOcrSheet(image: HTMLImageElement) {
  const rowHeight = 76;
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = rowHeight * (REPORT_ROWS.length + 1);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이미지 분석을 시작할 수 없습니다.");

  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const drawCrop = (
    rowIndex: number,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
  ) => {
    const top = rowIndex * rowHeight;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      10,
      top + 6,
      680,
      rowHeight - 12,
    );
  };

  drawCrop(
    0,
    image.naturalWidth * 0.23,
    image.naturalHeight * 0.045,
    image.naturalWidth * 0.58,
    image.naturalHeight * 0.025,
  );

  REPORT_ROWS.forEach((row, index) => {
    const isTopValue = index < 2;
    drawCrop(
      index + 1,
      image.naturalWidth * (isTopValue ? 0.055 : 0.55),
      image.naturalHeight * (row.centerY - (isTopValue ? 0.012 : 0.009)),
      image.naturalWidth * (isTopValue ? 0.48 : 0.31),
      image.naturalHeight * (isTopValue ? 0.024 : 0.018),
    );
  });

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const value = gray < 185 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export async function parseOaReport(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<OaReportResult> {
  const image = await loadImage(file);
  if (image.naturalHeight / image.naturalWidth < 4.5) {
    throw new Error("오아 앱에서 저장한 긴 건강 보고서 원본을 선택해주세요.");
  }

  const canvas = makeOcrSheet(image);
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text")
        onProgress?.(Math.round(message.progress * 100));
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    });
    const {
      data: { text, tsv },
    } = await worker.recognize(canvas, {}, { text: true, tsv: true });

    const values: Partial<Record<NumericKey, number>> = {};
    let detectedDate: string | undefined;

    // OCR가 줄 번호를 잘못 읽더라도 각 단어의 실제 Y 좌표는 안정적이다.
    // 합성 시트의 행 위치로 값을 매핑해 브라우저별 줄바꿈 차이를 피한다.
    for (const line of (tsv ?? "").split(/\r?\n/).slice(1)) {
      const columns = line.split("\t");
      if (columns.length < 12 || columns[0] !== "5") continue;
      const top = Number(columns[7]);
      const height = Number(columns[9]);
      const contents = columns.slice(11).join("\t");
      if (!Number.isFinite(top) || !Number.isFinite(height)) continue;
      const rowIndex = Math.floor((top + height / 2) / 76);
      const normalized = contents.replace(/,/g, ".").replace(/[Oo]/g, "0");

      if (rowIndex === 0) {
        const dateMatch = normalized.match(
          /(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/,
        );
        if (dateMatch)
          detectedDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
        continue;
      }

      const row = REPORT_ROWS[rowIndex - 1];
      if (!row || values[row.key] !== undefined) continue;
      const numberMatch = normalized.match(/\d+(?:\.\d+)?/);
      if (!numberMatch) continue;
      const value = Number(numberMatch[0]);
      if (Number.isFinite(value)) values[row.key] = value;
    }

    // 일부 구형 브라우저에서 TSV가 비어 있을 때는 텍스트 행 순서를 보조로 쓴다.
    if (!Object.keys(values).length) {
      const lines = text.split(/\r?\n/).filter((line) => /\d/.test(line));
      lines.slice(1, REPORT_ROWS.length + 1).forEach((line, index) => {
        const normalized = line.replace(/,/g, ".").replace(/[Oo]/g, "0");
        const numberMatch = normalized.match(/\d+(?:\.\d+)?/);
        const value = numberMatch ? Number(numberMatch[0]) : Number.NaN;
        if (Number.isFinite(value)) values[REPORT_ROWS[index].key] = value;
      });
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
