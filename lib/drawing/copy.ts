import type { Attempt, DrawingDocument, Example, Help, Lesson } from './model.ts';

export function comparisonOptions(lesson: Lesson, example: Example, easy: boolean): [NonNullable<DrawingDocument['comparison']>['focus'], string][] {
  switch (lesson.id) {
    case 'D21': return [['ears', '귀 크기']];
    case 'D22': return [['ears', '귀 길이']];
    case 'D23': return [['space', '머리와 몸의 위치']];
    case 'D24': return [['space', '배 양옆의 빈 공간']];
    case 'D25': return [['ears', '귀가 붙은 위치']];
    case 'D26': return [['width', '함께 줄인 크기']];
    case 'D27':
    case 'D28': return [['width', '전체 폭'], ...(example.lines.some(l => l.id === 'earL') && !easy ? [['ears', '귀 위치·크기'] as ['ears', string]] : []), ['eyes', '눈 높이']];
    default: return [['width', '전체 폭']];
  }
}

export function copyGuide(lesson: Lesson, example: Example, help: Help, step: number, easy: boolean) {
  const p = lesson.practice;
  const ids = new Set(p?.baseLines ?? []);
  const anchors = new Set(help > 0 ? p?.anchors : []);
  if (easy) { p?.easyLines.forEach(id => ids.add(id)); p?.easyAnchors.forEach(id => anchors.add(id)); }
  if (help === 2) p?.largeLines.forEach(id => ids.add(id));
  if (help === 3) {
    p?.demoBaseLines.forEach(id => ids.add(id));
    lesson.steps.slice(0, step + 1).forEach((s, i) => {
      if (s.action === 'draw' || (i === step && s.action !== 'look')) s.lines.forEach(id => ids.add(id));
      s.hideLines?.forEach(id => ids.delete(id));
    });
  }
  return { lines: example.lines.filter(l => ids.has(l.id)), anchors: example.lines.filter(l => anchors.has(l.id)), scale: p?.scale ?? 1 };
}

export function correctionCopy(target: Attempt, source: Attempt): DrawingDocument {
  if (target.document.lesson.id !== 'D27' || target.user_id !== source.user_id || !/^D2[0-6]$/.test(source.document.lesson.id)) throw Error('D20~D26의 내 그림을 골라 주세요.');
  return {
    ...target.document, strokes: structuredClone(source.document.strokes), photo: source.document.photo,
    tool: source.document.tool, step: 0, check: 'unconfirmed',
    references: [...new Set([...target.document.references, source.id])],
    correctionSource: { attemptId: source.id, revision: source.revision, lessonId: source.document.lesson.id, example: structuredClone(source.document.example), scale: source.document.lesson.practice?.scale ?? 1 },
  };
}

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const scaledTransform = (scale: number) => `translate(${200 * (1 - scale)} ${200 * (1 - scale)}) scale(${scale})`;
export function copyWorksheetSvg(lesson: Lesson, example: Example, easy = false) {
  const paths = (lines: Example['lines'], color: string) => lines.map(l => `<path d="${escape(l.d)}" fill="${l.fill === 'ink' ? color : 'none'}" stroke="${l.fill === 'ink' ? 'none' : color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  // A worksheet always starts at the authored scaffold, never the current completed demonstration.
  const guide = copyGuide(lesson, example, lesson.help as Help, 0, easy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 840 470"><rect width="840" height="470" fill="white"/><g font-family="sans-serif" font-size="16" fill="#222"><text x="20" y="24">${escape(lesson.id)} · 원본</text><text x="440" y="24">내가 그릴 자리</text></g><g transform="translate(10 45)">${paths(example.lines.filter(l => !['guide','gesture'].includes(l.group)), '#222')}</g><g transform="translate(430 45)"><rect width="400" height="400" rx="8" fill="none" stroke="#ddd"/><g transform="${scaledTransform(guide.scale)}">${paths([...guide.lines, ...guide.anchors], '#999')}</g></g></svg>`;
}
