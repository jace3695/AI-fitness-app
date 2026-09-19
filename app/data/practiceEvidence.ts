import type { GrowthSessionRow } from './growthPlatform.ts';

export function typingMistakes(target: string, typed: string) {
  const expected = Array.from(target), actual = Array.from(typed);
  const counts = new Map<string, number>();
  actual.forEach((char, index) => {
    if (expected[index] !== undefined && expected[index] !== char) counts.set(expected[index], (counts.get(expected[index]) ?? 0) + 1);
  });
  return [...counts].map(([character, count]) => ({ character, count })).sort((a, b) => b.count - a.count);
}

export function typingTrend(sessions: GrowthSessionRow[], passageIndex: number, today: string) {
  const anchor = Date.parse(`${today}T12:00:00Z`);
  const offset = (days: number) => new Date(anchor - days * 86400000).toISOString().slice(0, 10);
  const summarize = (start: string, end: string) => {
    const records = sessions.filter(row => row.source === 'typing' && row.session_date >= start && row.session_date <= end && row.metrics.passageIndex === passageIndex);
    const measured = records.filter(row => ['characters', 'correctCharacters', 'elapsedSeconds'].every(key => typeof row.metrics[key] === 'number' && Number.isFinite(row.metrics[key]) && (row.metrics[key] as number) >= 0) && (row.metrics.characters as number) > 0 && (row.metrics.elapsedSeconds as number) > 0 && (row.metrics.correctCharacters as number) <= (row.metrics.characters as number));
    const sum = (key: string) => measured.reduce((total, row) => total + (row.metrics[key] as number), 0);
    return { count: measured.length, accuracy: measured.length ? Math.round(100 * sum('correctCharacters') / sum('characters')) : null, cpm: measured.length ? Math.round(60 * sum('characters') / sum('elapsedSeconds')) : null };
  };
  return { recent: summarize(offset(13), today), previous: summarize(offset(27), offset(14)) };
}

export type HandwritingEvidence = { strokes: number; activeMs: number; minX: number | null; minY: number | null; maxX: number | null; maxY: number | null; penMin: number | null; penMax: number | null };
export const emptyHandwritingEvidence = (): HandwritingEvidence => ({ strokes: 0, activeMs: 0, minX: null, minY: null, maxX: null, maxY: null, penMin: null, penMax: null });
export function handwritingPoint(previous: HandwritingEvidence, x: number, y: number, pressure: number, pointerType: string): HandwritingEvidence {
  const px = Math.max(0, Math.min(1, x)), py = Math.max(0, Math.min(1, y));
  const pen = pointerType === 'pen' && Number.isFinite(pressure) && pressure > 0 && pressure <= 1;
  return { ...previous, minX: Math.min(previous.minX ?? px, px), minY: Math.min(previous.minY ?? py, py), maxX: Math.max(previous.maxX ?? px, px), maxY: Math.max(previous.maxY ?? py, py), penMin: pen ? Math.min(previous.penMin ?? pressure, pressure) : previous.penMin, penMax: pen ? Math.max(previous.penMax ?? pressure, pressure) : previous.penMax };
}
export function handwritingMetrics(evidence: HandwritingEvidence) {
  return { strokes: evidence.strokes, activeSeconds: Math.round(evidence.activeMs / 1000), occupiedWidth: evidence.minX === null ? 0 : Math.round(100 * (evidence.maxX! - evidence.minX)), occupiedHeight: evidence.minY === null ? 0 : Math.round(100 * (evidence.maxY! - evidence.minY)), pressureRange: evidence.penMin !== null && evidence.penMax !== null && evidence.penMax > evidence.penMin ? [evidence.penMin, evidence.penMax] : null };
}
