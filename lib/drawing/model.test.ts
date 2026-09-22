import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parsePack, newDocument, playable, type Attempt } from './model.ts';
import { recommend, feedback, confirmedStage } from './recommend.ts';
const raw = JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json', import.meta.url), 'utf8'));
const pack = parsePack(raw);
const lesson = pack.lessons[0];
function attempt(extra: Partial<Attempt['document']> = {}, variant = 0): Attempt {
  return { id: crypto.randomUUID(), user_id: 'test', status: 'completed', revision: 1, created_at: '2026-09-22', updated_at: '2026-09-22', document: { ...newDocument(lesson, lesson.examples[variant], pack.version), ...extra } };
}
test('authoritative 80 lessons retain 9-stage allocation and C01–C04, unpublished manuscripts are not playable', () => {
  assert.deepEqual(pack.stages.map(s => pack.lessons.filter(l => l.stage === s.id).length), [8,8,12,6,8,10,8,10,10]);
  assert.deepEqual(pack.projects.map(p => p.id), ['C01','C02','C03','C04']);
  assert.equal(pack.lessons.filter(playable).length, 1);
  for (const l of pack.lessons) { assert.ok(l.goal && l.check && l.easier); assert.ok(l.instructions.length); }
});
test('D01 has one start-only frame then six cumulative actions with no invented head or neck', () => {
  assert.equal(lesson.steps.length, 6); assert.equal(lesson.steps[0].action, 'look');
  assert.deepEqual(lesson.steps[1].lines, ['bodyL']); assert.deepEqual(lesson.steps[2].lines, ['bodyR']);
  for (const ex of lesson.examples) {
    assert.equal(ex.lines.length, 9); assert.ok(!ex.lines.some(l => /head|neck/.test(l.id)));
    assert.deepEqual(ex.lines.find(l => l.id === 'bodyL')!.start, ex.lines.find(l => l.id === 'bodyR')!.start);
    assert.deepEqual(new Set(lesson.steps.slice(1).flatMap(s => s.lines)), new Set(ex.lines.map(l => l.id)));
  }
});
test('malformed remote packs cannot replace the good pack', () => {
  for (const mutate of [
    (p: typeof raw) => p.lessons.pop(),
    (p: typeof raw) => p.lessons[1].references.push('missing'),
    (p: typeof raw) => p.lessons[0].examples[0].lines[0].d = '<script>alert(1)</script>',
    (p: typeof raw) => p.lessons[0].steps[0].lines.push('unknown-line'),
    (p: typeof raw) => p.lessons[2].readiness.visualMatch = true,
  ]) { const value = structuredClone(raw); mutate(value); assert.throws(() => parsePack(value)); }
});
test('completion count alone, short practice and assisted confirmation never certify a stage', () => {
  const history = Array.from({ length: 80 }, () => attempt());
  assert.equal(confirmedStage(pack, history, 1), false);
  assert.equal(recommend(pack, history)?.lessonId, 'D01');
  assert.equal(recommend(pack, [attempt({ check:'independent', short:true })])?.lessonId, 'D01');
  const assisted = recommend(pack, [attempt({ check:'assisted', help:3, usedHelp:3 })]);
  assert.equal(assisted?.help, 2);
});
test('difficulty wins over a confident self check; no invented visual appraisal', () => {
  const a = attempt({ check:'independent', difficulty:'긴 선' });
  assert.equal(recommend(pack, [a])?.short, true);
  const words = feedback(a, pack, []).map(v => v.body).join(' ');
  assert.match(words, /자기확인/); assert.match(words, /그림 분석은 받지 않았어요/); assert.match(words, /2분/);
  assert.doesNotMatch(words, /비율이 좋아|정확하게 그렸|완벽/);
});

test('restoring drawings rejects malformed photo, ink and lesson pointers before rendering', async () => {
  const { parseAttempt } = await import('./model.ts');
  const valid = { ...attempt(), user_id: crypto.randomUUID() };
  assert.equal(parseAttempt(valid).document.lesson.id, 'D01');
  for (const change of [
    {photo:'https://untrusted.invalid/photo'},
    {step:9},
    {strokes:[{points:[[Infinity,1,.5]],color:'#ffffff',width:2,erase:false}]},
  ]) assert.throws(() => parseAttempt({...valid,document:{...valid.document,...change}}));
});
