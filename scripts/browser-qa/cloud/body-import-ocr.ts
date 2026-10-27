import { recoveredNumber, type OaReportResult } from '../../../app/lib/oaReportParser.ts';

// An explicit fixture reader uses actual numeric recovery; review/save/transaction
// code is the real BodyRecordCard. No module replacement or build alias is used.
// These observations are deliberately synthetic, not real Tesseract output.
export async function readSyntheticReport(): Promise<OaReportResult> {
  const read = (text: string) => ({ text, confidence: 94 });
  const weight = recoveredNumber([read('(82.4 lb)'), read('82.4')],
    [read('82.4'), read('82.4 kg')],
    { key: 'weight', centerY: 0, min: 20, max: 300, decimals: true });
  return { values: { bmi: 24.8, ...(weight === undefined ? {} : { weight }) },
    detectedDate: '2025-04-07', recognizedCount: weight === undefined ? 1 : 2 };
}
