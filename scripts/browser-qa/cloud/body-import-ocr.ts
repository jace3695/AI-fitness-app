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

// Generic English manufacturer labels + independently invented values only.
// Exercises the shipped label adapter, not real image recognition accuracy.
export async function readSyntheticInbodyReport(): Promise<OaReportResult> {
  const { agreedInbody270sReport } = await import('../../../app/lib/inbodyReportParser');
  const lines = [
    '[InBody270S]', 'Body Composition Analysis',
    'Body Fat Mass (kg) 17.4 (10.0 ~ 20.0)', 'Weight (kg) 79.6 (60.0 ~ 90.0)',
    'Muscle-Fat Analysis', 'SMM Skeletal Muscle Mass (kg) 32.8',
    'Obesity Analysis', 'BMI Body Mass Index (kg/m²) 25.7', 'PBF Percent Body Fat (%) 21.9',
    'Research Parameters', 'Fat Free Mass 62.2 kg (50.0 ~ 75.0)', 'Basal Metabolic Rate 1623 kcal (1400 ~ 1800)',
  ].map(text => ({ text, confidence: 94 }));
  return agreedInbody270sReport([lines, lines.map(line => ({ ...line }))]);
}
