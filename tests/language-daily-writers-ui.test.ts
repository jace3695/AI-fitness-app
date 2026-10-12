import assert from 'node:assert/strict';
import test from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { nodes, textOf } from './helpers/storage-ui-fixture.ts';

async function home() {
  const f = await languageWriterFixture();
  for (const path of ['components/language/LearningWelcome.tsx', 'components/YeoniAdviceEntry.tsx', 'components/language/live/LiveOverview.tsx']) f.tab.setModule(path, { default: 'aside' });
  const page = f.tab.mount('app/language/page.tsx');
  return { ...f, page, dispose() { page.dispose(); f.dispose(); } };
}
test('shipping home mount has no daily writes; double-click one retained toggle cannot cancel itself', async t => {
  const f = await home(); t.after(f.dispose); const writes = f.browser.writes.length;
  f.page.render(); assert.equal(f.browser.writes.length, writes); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  const button = f.page.button('직접 완료'); const click = button.props.onClick as () => void;
  click(); click(); await f.page.settle(); assert.match(f.page.text(), /1\/5 완료/);
  const routine = JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!); assert.deepEqual(routine.completedIds, ['kana']);
  const history = JSON.parse(f.tab.local.getItem('dailyLearningHistory')!); assert.equal(history[routine.date].completedCount, 1);
});
test('shipping home storage failure keeps intent and display; new work requires retry proof or explicit discard', async t => {
  const f = await home(); t.after(f.dispose); f.browser.rejectNextWrite('dailyLearningHistory'); f.page.click('직접 완료'); await f.page.settle();
  assert.match(f.page.text(), /0\/5 완료/); assert.match(f.page.text(), /synthetic quota refusal/); assert.match(f.page.text(), /저장 다시 확인/);
  assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); assert.equal(f.tab.local.getItem('dailyLearningHistory'), null);
  assert.ok(f.page.button('직접 완료').props.disabled);
  // Rollback advances the protocol generation. A non-idempotent action cannot silently rebase.
  f.page.click('저장 다시 확인'); await f.page.settle(); assert.match(f.page.text(), /저장 조건|다른 창/); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  f.page.click('보류한 변경 버리기'); f.page.click('직접 완료'); await f.page.settle(); assert.match(f.page.text(), /1\/5 완료/);
});
test('shipping home queued toggle is fenced on pause and retains explicit pending action after resume', async t => {
  const f = await home(); t.after(f.dispose); const release = f.browser.holdLock(); f.page.click('직접 완료'); f.pause(); f.page.render(); release(); await f.page.settle();
  assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); assert.match(f.page.text(), /보류한 변경 버리기/);
  await f.resume(); await f.page.settle(); f.page.click('저장 다시 확인'); await f.page.settle(); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); assert.match(f.page.text(), /입력|기록|저장/);
  const alert = nodes(f.page.render()).find(node => node.props.role === 'alert'); assert.ok(alert && textOf(alert));
});
test('shipping home explicit new save recovers proven rollback without toggling twice', async t => {
  const f = await home(); t.after(f.dispose); f.browser.rejectNextWrite('dailyLearningHistory'); f.page.click('직접 완료'); await f.page.settle();
  assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); f.page.click('최신 상태에서 새로 저장'); await f.page.settle();
  assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, ['kana']); assert.match(f.page.text(), /1\/5 완료/); assert.doesNotMatch(f.page.text(), /저장 다시 확인/);
});
