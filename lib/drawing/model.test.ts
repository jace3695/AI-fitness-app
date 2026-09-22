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
  assert.equal(pack.lessons.filter(playable).length, 16);
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
    (p: typeof raw) => p.lessons[16].readiness.visualMatch = true,
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

test('stage one alternates cover every taught line with distinct geometry and preserve old snapshots', async () => {
  for (const l of pack.lessons.slice(0,8)) {
    assert.equal(l.examples.length, 2);
    assert.equal(l.steps[0].action, 'look');
    assert.notDeepEqual(l.examples[0].lines.map(x => x.d), l.examples[1].lines.map(x => x.d));
    for (const ex of l.examples) {
      assert.deepEqual(new Set(l.steps.filter(s => s.action === 'draw').flatMap(s => s.lines)), new Set(ex.lines.map(x => x.id)));
      for (const line of ex.lines.filter(x => x.fill !== 'ink')) {
        const start = /^M\s*([\d.]+)[ ,]+([\d.]+)/.exec(line.d);
        assert.deepEqual(start?.slice(1).map(Number), line.start, `${l.id} ${ex.id} ${line.id} start`);
      }
    }
  }
  const {parseAttempt} = await import('./model.ts');
  const old = {...attempt(), user_id:crypto.randomUUID()};
  old.document.packVersion = '1.0.0-draft.2';
  old.document.strokes = [{points:[[100,100,.5],[120,130,.6]],color:'#34314b',width:2.6,erase:false}];
  assert.deepEqual(parseAttempt(JSON.parse(JSON.stringify(old))), old);
});

test('stage one advances after two distinct self-confirmed examples, not repeated completions', () => {
  const evidence = [attempt({check:'independent'}), attempt({check:'independent'},1)];
  assert.equal(recommend(pack,evidence)?.lessonId, 'D02');
  const capstone = pack.lessons[7];
  const cap = capstone.examples.map(ex => ({...attempt(), document:{...newDocument(capstone,ex,pack.version),check:'independent' as const}}));
  assert.equal(confirmedStage(pack,cap,1), true);
  assert.equal(confirmedStage(pack,[cap[0],{...cap[1],document:{...cap[1].document,short:true}}],1), false);
  assert.equal(confirmedStage(pack,[cap[0],{...cap[1],document:{...cap[1].document,difficulty:'긴 선'}}],1), false);
});

test('construction examples separate guide geometry from finished outlines and validate saved part checks', async () => {
  const {parseAttempt} = await import('./model.ts');
  for(const l of pack.lessons.slice(8,16)) {
    assert.equal(l.examples.length,2);
    for(const ex of l.examples) {
      assert.ok(ex.lines.some(x=>x.group==='guide'));
      assert.ok(ex.lines.some(x=>x.group==='shape'));
      assert.ok(l.steps.some(x=>x.action==='compare'));
      for(const line of ex.lines.filter(x=>x.group==='guide')) {
        const xy=/^M\s*([\d.]+)[ ,]+([\d.]+)/.exec(line.d)?.slice(1).map(Number);
        assert.deepEqual(xy,line.start,`${l.id} ${line.id}`);
      }
    }
  }
  const lesson=pack.lessons[15];
  const good={...attempt(),user_id:crypto.randomUUID(),document:{...newDocument(lesson,lesson.examples[0],pack.version),partChecks:['head','body']}};
  assert.deepEqual(parseAttempt(good).document.partChecks,['head','body']);
  assert.equal(confirmedStage(pack,[good],2),false);
  assert.throws(()=>parseAttempt({...good,document:{...good.document,partChecks:['not-in-example']}}));
  const broken=structuredClone(raw);broken.lessons[11].easyLines=['missing'];assert.throws(()=>parsePack(broken));
});
