import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { CURRICULUM } from '../data/curriculum.ts';
import { createLearningSession, getSessionQuizIndices, answerSessionQuestion } from '../utils/learningSession.ts';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { nodes, type UiNode } from './helpers/storage-ui-fixture.ts';
import type * as Course from '../app/data/languageCourseMutations.ts';
const P = 'japaneseCurriculumProgressV1', R = 'japaneseCurriculumReviewV1';
const lesson = CURRICULUM[0];
function draft(complete = false) {
  let session = { ...createLearningSession(lesson.id, 5, 'starter'), id: 'ui-course-session', stage: complete ? 4 : 0, quizCursor: complete ? 2 : 0 };
  if (complete) for (const index of getSessionQuizIndices(lesson, 5)) session = answerSessionQuestion(session, index, true, 'answer', { responseMs: 1000, neededHelp: false, modality: 'meaning' });
  return session;
}
function seed(session = draft()) { return JSON.stringify({ activeSession: session, lessonDrafts: { [lesson.id]: session } }); }
async function fixture(t: TestContext, progress?: string) {
  const f = await languageWriterFixture(progress === undefined ? {} : { [P]: progress }); t.after(f.dispose);
  f.tab.setModule('components/useYeoniPreferences.ts', { useYeoniPreferences: () => ({ visible: false }) });
  f.tab.setModule('components/language/LearningCompanion.tsx', { default: 'aside' });
  f.tab.setModule('components/language/LearningQuestion.tsx', { default: 'question' });
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
  f.tab.setModule('components/language/useLearningAudio.ts', { useLearningAudio: () => ({ stop() {}, async play() {}, playing: false, audioError: '' }) });
  return f;
}
function question(view: { render(): UiNode }) { const value = nodes(view.render()).find(node => node.type === 'question'); assert.ok(value); return value; }

test('FocusedLesson restored display performs no mount rewrite including normalized unknown draft paths', async t => {
  const raw = seed().replace('"stage":0', '"stage":99').replace('"answers":{}', '"answers":{},"future":900719925474099312345');
  const f = await fixture(t, raw); const before = f.browser.writes.length;
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  assert.equal(f.tab.local.getItem(P), raw); assert.equal(f.browser.writes.length, before);
});
test('FocusedLesson initializes one session and successive mount resumes its exact winner', async t => {
  const f = await fixture(t);
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); await view.settle();
  const raw = f.tab.local.getItem(P)!; const saved = JSON.parse(raw).activeSession.id;
  assert.ok(saved); view.dispose();
  const second = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(second.dispose); await second.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.id, saved); assert.equal(f.tab.local.getItem(P), raw);
});
test('FocusedLesson serializes rapid N/N+1 edits while holding the real synthetic lock', async t => {
  const f = await fixture(t, seed());
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock(); view.click('다음 표현'); view.click('다음 표현');
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).lessonDrafts[lesson.id].wordIndex, 0);
  release(); await view.settle(8);
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).lessonDrafts[lesson.id].wordIndex, 2);
  assert.equal(f.browser.maxActive, 1); assert.doesNotMatch(view.text(), /저장하지 못/);
});
test('FocusedLesson failed autosave retains pending input and newer edits, retry saves them in order', async t => {
  const f = await fixture(t, seed());
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite(P); view.click('다음 표현'); await view.settle();
  assert.match(view.text(), /synthetic quota refusal/); assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0);
  view.click('다음 표현'); assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0);
  view.click('저장 다시 확인하기'); await view.settle(8);
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 2); assert.doesNotMatch(view.text(), /synthetic quota refusal/);
});
test('FocusedLesson source frozen before answer rejects concurrent same-session change and retains answer', async t => {
  const start = { ...draft(), stage: 4 }; const f = await fixture(t, seed(start));
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const course = f.tab.loadModule('app/data/languageCourseMutations.ts') as typeof Course;
  await course.runCourseMutation(course.createCourseMutation(f.context, f.snapshot(), { kind: 'draft', lesson, session: { ...start, quizCursor: 1 } }));
  const q = question(view); (q.props.onAnswer as (correct: boolean, response: string) => void)(true, 'my retained answer'); view.render(); await view.settle();
  assert.match(view.text(), /다른 창/); assert.equal(question(view).props.response, 'my retained answer');
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.quizCursor, 1);
});
test('FocusedLesson failed finish keeps final answers and rolls back review plus progress, exact retry publishes success', async t => {
  const f = await fixture(t, seed(draft(true))); const before = f.tab.local.getItem(P);
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite(R); view.click('오늘 연습 저장하기'); await view.settle();
  assert.equal(f.tab.local.getItem(P), before); assert.equal(f.tab.local.getItem(R), null);
  assert.doesNotMatch(view.text(), /오늘의 연습을 저장했어요/); assert.equal(question(view).props.response, 'answer');
  view.click('저장 다시 확인하기'); await view.settle(8);
  assert.match(view.text(), /오늘의 연습을 저장했어요/); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  assert.equal(Object.keys(JSON.parse(f.tab.local.getItem(P)!).languageFinishReceiptsV1.operations).length, 1);
});
test('FocusedLesson pauses queued autosave without losing draft and never rebinds retired pending intent', async t => {
  const f = await fixture(t, seed());
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock(); view.click('다음 표현'); f.pause(); release(); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0);
  await f.resume(); await view.settle();
  view.click('저장 다시 확인하기'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0); assert.match(view.text(), /저장 완료 여부를 확인할 근거/);
  view.click('다음 표현'); await view.settle();
  view.click('현재 입력으로 새 저장 시도'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 2); assert.doesNotMatch(view.text(), /저장 완료 여부를 확인할 근거/);
});
test('FocusedLesson incorporates final unsaved answer after earlier autosave before atomic finish', async t => {
  const start = draft(true); const last = getSessionQuizIndices(lesson, 5).at(-1)!; delete start.answers[last]; delete start.firstAnswers[last]; delete start.responses[last];
  const f = await fixture(t, seed(start)); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock();
  (question(view).props.onAnswer as (correct: boolean, response: string) => void)(true, 'final'); view.render();
  view.click('오늘 연습 저장하기'); release(); await view.settle(10);
  assert.match(view.text(), /오늘의 연습을 저장했어요/); assert.equal(JSON.parse(f.tab.local.getItem(P)!).quizScores[lesson.id], 100);
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).lessonDrafts[lesson.id], undefined);
});
test('KanaStarter retains failed group completion and does not add daily behavior', async t => {
  const f = await fixture(t, '{"future":900719925474099312345}');
  f.tab.setModule('data/beginnerKana.ts', { BEGINNER_KANA_GROUPS: [{ id: 'a', title: 'first', chars: 'あ', sounds: ['아'] }] });
  const view = f.tab.mount('components/language/KanaStarter.tsx'); t.after(view.dispose); await view.settle();
  view.click('배운 글자 찾아보기'); view.click('あ'); f.browser.rejectNextWrite(P); view.click('이번 묶음 저장하기'); await view.settle();
  assert.match(view.text(), /synthetic quota refusal/); assert.doesNotMatch(view.text(), /글자와 친해졌어요/);
  view.click('이번 묶음 저장하기'); await view.settle();
  assert.match(view.text(), /1글자와 친해졌어요/); assert.match(f.tab.local.getItem(P)!, /900719925474099312345/);
  assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); assert.equal(f.tab.local.getItem('dailyLearningHistory'), null);
});
test('Learn track navigation waits for acknowledged commit and preserves pending choice on failure', async t => {
  const f = await fixture(t, '{"selectedTrack":"foundation","future":900719925474099312345}');
  f.tab.setModule('components/language/FocusedLesson.tsx', { default: 'focused' });
  const page = f.tab.mount('app/language/learn/page.tsx'); t.after(page.dispose);
  const routeNode = page.render().props.children as UiNode;
  const route = f.tab.mount('', {}, routeNode.type as (props: Record<string, unknown>) => UiNode); t.after(route.dispose);
  const contentNode = route.render(); const view = f.tab.mount('', {}, contentNode.type as (props: Record<string, unknown>) => UiNode); t.after(view.dispose); await view.settle();
  const click = () => {
    const link = nodes(view.render()).find(node => node.type === 'a' && node.props.href === '/language/learn?track=work'); assert.ok(link);
    (link.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() {} }); view.render();
  };
  f.browser.rejectNextWrite(P); click(); await view.settle(); assert.deepEqual(f.routes, []); assert.match(view.text(), /synthetic quota refusal/);
  click(); await view.settle(); assert.deepEqual(f.routes, ['/language/learn?track=work']);
  assert.match(f.tab.local.getItem(P)!, /900719925474099312345/);
});

test('FocusedLesson durable finish with retired publication retains intent and reconciles receipt without rescheduling', async t => {
  const f = await fixture(t, seed(draft(true))); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const set = f.tab.local.setItem; let armed = true;
  f.tab.local.setItem = (key, value) => {
    set(key, value);
    if (armed && key === f.tab.transactions.STORAGE_PROTOCOL_KEY && JSON.parse(value).state === 'committed') { armed = false; queueMicrotask(() => f.pause()); }
  };
  view.click('오늘 연습 저장하기'); await view.settle();
  assert.doesNotMatch(view.text(), /오늘의 연습을 저장했어요/); assert.equal(question(view).props.response, 'answer');
  const progress = f.tab.local.getItem(P), reviews = f.tab.local.getItem(R); assert.ok(reviews);
  await f.resume(); await view.settle(); view.click('저장 다시 확인하기'); await view.settle();
  assert.match(view.text(), /오늘의 연습을 저장했어요/); assert.equal(f.tab.local.getItem(P), progress); assert.equal(f.tab.local.getItem(R), reviews);
});

test('FocusedLesson input begun while unavailable cannot acquire authority on a later provider refresh', async t => {
  const f = await fixture(t, seed()); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  f.pause(); view.render(); view.click('다음 표현'); await view.settle();
  await f.resume(); await view.settle(); view.click('저장 다시 확인하기'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0); assert.match(view.text(), /입력 당시의 연결이 바뀌/);
  view.click('현재 입력으로 새 저장 시도'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 1);
});


test('FocusedLesson explicit new save recovers retained N/N+1 after precommit pause and finishes once', async t => {
  const start = { ...draft(), stage: 4 }; const indices = getSessionQuizIndices(lesson, 5);
  const f = await fixture(t, seed(start)); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock();
  (question(view).props.onAnswer as (correct: boolean, response: string) => void)(true, 'retained-first'); view.render();
  view.click('다음 문제'); f.pause(); release(); await view.settle();
  await f.resume(); await view.settle();
  view.click('현재 입력으로 새 저장 시도'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.responses[indices[0]], 'retained-first');
  for (let position = 1; position < indices.length; position++) {
    (question(view).props.onAnswer as (correct: boolean, response: string) => void)(true, 'retained-' + position); view.render(); await view.settle();
    view.click(position === indices.length - 1 ? '오늘 연습 저장하기' : '다음 문제'); await view.settle();
  }
  assert.match(view.text(), /오늘의 연습을 저장했어요/);
  assert.equal(Object.keys(JSON.parse(f.tab.local.getItem(P)!).languageFinishReceiptsV1.operations).length, 1);
});

for (const raw of ['null', '[]', '{bad']) test('KanaStarter warns on unreadable progress without writing ' + raw, async t => {
  const f = await fixture(t, raw); const before = f.browser.writes.length;
  const view = f.tab.mount('components/language/KanaStarter.tsx'); t.after(view.dispose); await view.settle();
  assert.match(view.text(), /일부 학습 기록의 형식을 읽지 못해/); assert.equal(f.tab.local.getItem(P), raw); assert.equal(f.browser.writes.length, before);
});

for (const [key, raw] of [[P, 'null'], [P, '[]'], [P, '{bad'], ['integratedLearningSettingsV1', 'null'], ['integratedLearningSettingsV1', '{"dailyMinutes":99}']] as const) test('Learn warns on partial source without normalization writes ' + key + raw, async t => {
  const f = await fixture(t, key === P ? raw : '{}');
  if (key !== P) await f.language.updateLanguageRecords(f.context, () => ({ [key]: raw }));
  f.tab.setModule('components/language/FocusedLesson.tsx', { default: 'focused' }); const before = f.browser.writes.length;
  const page = f.tab.mount('app/language/learn/page.tsx'); t.after(page.dispose);
  const routeNode = page.render().props.children as UiNode;
  const route = f.tab.mount('', {}, routeNode.type as (props: Record<string, unknown>) => UiNode); t.after(route.dispose);
  const content = route.render(); const view = f.tab.mount('', {}, content.type as (props: Record<string, unknown>) => UiNode); t.after(view.dispose); await view.settle();
  assert.ok(nodes(view.render()).some(node => node.props.role === 'alert'));
  assert.equal(f.tab.local.getItem(key), raw); assert.equal(f.browser.writes.length, before);
});


test('FocusedLesson unknown finish outcome reconciles retained receipt on explicit retry without redispatch', async t => {
  const f = await fixture(t, seed(draft(true))); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const set = f.tab.local.setItem; let armed = true;
  f.tab.local.setItem = (key, value) => { set(key, value); if (armed && key === f.tab.transactions.STORAGE_PROTOCOL_KEY && JSON.parse(value).state === 'committed') { armed = false; throw new Error('ambiguous committed marker'); } };
  view.click('오늘 연습 저장하기'); await view.settle();
  assert.match(view.text(), /ambiguous committed marker/); assert.doesNotMatch(view.text(), /오늘의 연습을 저장했어요/);
  assert.doesNotMatch(view.text(), /현재 입력으로 새 저장 시도/);
  const before = f.browser.writes.length; const reviews = f.tab.local.getItem(R);
  view.click('저장 다시 확인하기'); await view.settle();
  assert.match(view.text(), /오늘의 연습을 저장했어요/); assert.equal(f.tab.local.getItem(R), reviews); assert.equal(f.browser.writes.length, before);
});

function refuseOnePostCommitRead(f: Awaited<ReturnType<typeof languageWriterFixture>>) {
  const set = f.tab.local.setItem, get = f.tab.local.getItem; let armed = true, refuse = false;
  f.tab.local.setItem = (key, value) => { set(key, value); if (armed && key === f.tab.transactions.STORAGE_PROTOCOL_KEY && JSON.parse(value).state === 'committed') { armed = false; refuse = true; } };
  f.tab.local.getItem = key => { if (refuse && key === P) { refuse = false; throw new Error('synthetic postcommit read failure'); } return get(key); };
}

for (const finish of [false, true]) test('FocusedLesson reconciles same-context durable ' + (finish ? 'finish' : 'autosave') + ' after one postcommit read failure', async t => {
  const f = await fixture(t, seed(draft(finish))); const context = f.context;
  const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  refuseOnePostCommitRead(f); view.click(finish ? '오늘 연습 저장하기' : '다음 표현'); await view.settle();
  assert.equal(f.context, context); assert.equal(f.language.isLanguageRecordContextCurrent(context), true);
  assert.match(view.text(), /기기에 저장되었지만/); assert.doesNotMatch(view.text(), /현재 입력으로 새 저장 시도/);
  const writes = f.browser.writes.length, locks = f.browser.calls.length;
  view.click('저장 다시 확인하기'); await view.settle();
  assert.doesNotMatch(view.text(), /기기에 저장되었지만/); assert.equal(f.browser.writes.length, writes); assert.equal(f.browser.calls.length, locks);
  if (finish) assert.match(view.text(), /오늘의 연습을 저장했어요/);
  else assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 1);
});

test('KanaStarter reconciles same-context group completion after postcommit read failure', async t => {
  const f = await fixture(t, '{}'); const context = f.context;
  f.tab.setModule('data/beginnerKana.ts', { BEGINNER_KANA_GROUPS: [{ id: 'a', title: 'first', chars: 'あ', sounds: ['아'] }] });
  const view = f.tab.mount('components/language/KanaStarter.tsx'); t.after(view.dispose); await view.settle();
  view.click('배운 글자 찾아보기'); view.click('あ'); refuseOnePostCommitRead(f); view.click('이번 묶음 저장하기'); await view.settle();
  assert.equal(f.context, context); assert.match(view.text(), /기기에 저장되었지만/); assert.doesNotMatch(view.text(), /글자와 친해졌어요/);
  const writes = f.browser.writes.length, locks = f.browser.calls.length;
  view.click('이번 묶음 저장하기'); await view.settle(); assert.match(view.text(), /1글자와 친해졌어요/);
  assert.equal(f.browser.writes.length, writes); assert.equal(f.browser.calls.length, locks);
});

test('Learn reconciles same-context saved track before navigating after postcommit read failure', async t => {
  const f = await fixture(t, '{"selectedTrack":"foundation"}'); const context = f.context;
  f.tab.setModule('components/language/FocusedLesson.tsx', { default: 'focused' });
  const page = f.tab.mount('app/language/learn/page.tsx'); t.after(page.dispose);
  const routeNode = page.render().props.children as UiNode;
  const route = f.tab.mount('', {}, routeNode.type as (props: Record<string, unknown>) => UiNode); t.after(route.dispose);
  const content = route.render(); const view = f.tab.mount('', {}, content.type as (props: Record<string, unknown>) => UiNode); t.after(view.dispose); await view.settle();
  const click = () => { const link = nodes(view.render()).find(node => node.type === 'a' && node.props.href === '/language/learn?track=work'); assert.ok(link); (link.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() {} }); view.render(); };
  refuseOnePostCommitRead(f); click(); await view.settle(); assert.equal(f.context, context); assert.match(view.text(), /기기에 저장되었지만/); assert.deepEqual(f.routes, []);
  const writes = f.browser.writes.length, locks = f.browser.calls.length; click(); await view.settle();
  assert.deepEqual(f.routes, ['/language/learn?track=work']); assert.equal(f.browser.writes.length, writes); assert.equal(f.browser.calls.length, locks);
});

for (const queued of [false, true]) test('FocusedLesson refuses later same-session bytes as its own acknowledged source, queued=' + queued, async t => {
  const f = await fixture(t, seed()); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const course = f.tab.loadModule('app/data/languageCourseMutations.ts') as typeof Course;
  const request = f.browser.locks.request.bind(f.browser.locks); let armed = true;
  f.browser.locks.request = (name, options, callback) => request(name, options, callback).then(async value => {
    if (armed) {
      armed = false;
      await course.runCourseMutation(course.createCourseMutation(f.context, f.snapshot(), { kind: 'draft', lesson, session: { ...draft(), stage: 2 } }));
    }
    return value;
  });
  view.click('다음 표현'); if (queued) view.click('다음 표현'); await view.settle(8);
  assert.match(view.text(), /다른 창/); assert.match(view.text(), queued ? /오늘의 표현 3/ : /오늘의 표현 2/);
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.stage, 2);
  assert.equal(JSON.parse(f.tab.local.getItem(P)!).activeSession.wordIndex, 0);
  const before = f.browser.writes.length; view.click('저장 다시 확인하기'); await view.settle();
  assert.match(view.text(), /다른 창/); assert.equal(f.browser.writes.length, before);
});

test('FocusedLesson source advancement still merges an intervening different lesson and retains its active pointer', async t => {
  const f = await fixture(t, seed()); const view = f.tab.mount('components/language/FocusedLesson.tsx', { lesson }); t.after(view.dispose); await view.settle();
  const course = f.tab.loadModule('app/data/languageCourseMutations.ts') as typeof Course;
  const other = CURRICULUM[1], otherSession = { ...createLearningSession(other.id, 5, 'starter'), id: 'intervening-other' };
  const request = f.browser.locks.request.bind(f.browser.locks); let armed = true;
  f.browser.locks.request = (name, options, callback) => request(name, options, callback).then(async value => {
    if (armed) { armed = false; await course.runCourseMutation(course.createCourseMutation(f.context, f.snapshot(), { kind: 'draft', lesson: other, session: otherSession })); }
    return value;
  });
  view.click('다음 표현'); view.click('다음 표현'); await view.settle(8);
  const progress = JSON.parse(f.tab.local.getItem(P)!);
  assert.equal(progress.lessonDrafts[lesson.id].wordIndex, 2); assert.equal(progress.activeSession.id, 'intervening-other');
  assert.equal(progress.lessonDrafts[other.id].id, 'intervening-other'); assert.doesNotMatch(view.text(), /다른 창/);
});
