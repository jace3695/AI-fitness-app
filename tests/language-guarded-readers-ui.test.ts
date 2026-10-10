import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deferred, nodes, storageBrowser, storageTab, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';

async function readerFixture(t: TestContext) {
  const browser = storageBrowser(), tab = storageTab(browser, 'reader'); t.after(tab.dispose);
  const gate = tab.mount('app/components/AuthGate.tsx', { children: 'synthetic authenticated child' }); t.after(gate.dispose); await gate.settle();
  const lease = nodes(gate.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner;
  tab.setModule('app/components/AuthenticatedStorageOwner.tsx', { useAuthenticatedStorageOwner: () => lease });
  return { browser, tab, gate, lease };
}

for (const invalidation of ['binding', 'owner', 'storage-access'] as const) test(`R13 shipping calendar removes language facts during unrelated pending network on ${invalidation}`, async t => {
  const f = await readerFixture(t);
  const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-03`;
  f.tab.local.setItem('dailyLearningHistory', JSON.stringify({ [date]: { completedIds: ['kana', 'words'], completedCount: 2 } }));
  f.tab.setModule('next/link', { default: 'a' });
  f.tab.setModule('components/AppCompanion.tsx', { default: 'aside' });
  f.tab.setModule('components/useDialogFocus.ts', { useDialogFocus() {} });
  f.tab.setModule('app/components/GoogleCalendarPanel.tsx', { default: 'google-calendar' });
  const pending = deferred<{ data: never[]; error: null }>();
  const original = f.tab.loadModule('app/lib/supabase.ts') as { supabase: { auth: unknown } };
  let remoteQueries = 0;
  f.tab.setModule('app/lib/supabase.ts', { supabase: { auth: original.supabase.auth, from() {
    remoteQueries++;
    const query = { select() { return query; }, eq() { return query; }, gte() { return query; }, lte() { return query; }, neq() { return query; }, then(yes: (value: unknown) => unknown) { return pending.promise.then(yes); } };
    return query;
  } } });
  const page = f.tab.mount('app/calendar/page.tsx'); t.after(page.dispose);
  const calendar = page.render().props.children as UiNode;
  const view = f.tab.mount('', {}, calendar.type as (props: Record<string, unknown>) => UiNode); t.after(view.dispose); await view.settle();
  assert.ok(remoteQueries >= 3, 'Unrelated calendar network reads are still awaiting');
  assert.match(view.text(), /언2/);
  const originalRaw = f.tab.local.getItem('dailyLearningHistory');
  if (invalidation === 'binding') f.tab.local.setItem('language-storage-binding-v1', '{malformed');
  else if (invalidation === 'owner') f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
  else f.tab.failStorageAccess();
  f.tab.dispatch({ type: 'storage', key: invalidation === 'binding' ? 'language-storage-binding-v1' : null });
  assert.doesNotMatch(view.text(), /언2/);
  assert.match(view.text(), /학습 기록의 계정과 저장 상태를 확인하지 못해/);
  pending.resolve({ data: [], error: null }); await view.settle();
  assert.doesNotMatch(view.text(), /언2/, 'Late unrelated network must not resurrect a language badge');
  assert.equal(f.tab.local.getItem('dailyLearningHistory'), originalRaw);
});

for (const invalidation of ['binding', 'session', 'storage-access'] as const) test(`R13 shipping preference hook clears cached language fallback on ${invalidation}`, async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('integratedLearningSettingsV1', JSON.stringify({ showCompanion: false, homeCompanionMotion: false }));
  // Load after synthetic hooks are installed by the existing AuthGate mount.
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const component = () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } });
  const view = f.tab.mount('', {}, component); t.after(view.dispose); await view.settle();
  assert.match(view.text(), /"visible":false,"motion":"off"/);
  if (invalidation === 'binding') f.tab.local.setItem('language-storage-binding-v1', '{malformed');
  else if (invalidation === 'session') f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
  else f.tab.failStorageAccess();
  f.tab.dispatch({ type: invalidation === 'session' ? f.tab.transactions.CLOUD_SESSION_CHANGED_EVENT : 'storage', key: 'language-storage-binding-v1' });
  assert.match(view.text(), /"visible":true,"motion":"reactions"/);
  assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), '{"showCompanion":false,"homeCompanionMotion":false}');
});

test('R13 independent device appearance survives language fallback invalidation', async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('integratedLearningSettingsV1', '{"showCompanion":true}');
  f.tab.local.setItem('yeoniAppearanceSettingsV1', '{"visible":false,"motion":"home"}');
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const view = f.tab.mount('', {}, () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } })); t.after(view.dispose); await view.settle();
  f.tab.local.setItem('language-storage-binding-v1', '{malformed'); f.tab.dispatch({ type: 'storage', key: 'language-storage-binding-v1' });
  assert.match(view.text(), /"visible":false,"motion":"home"/);
});

for (const phase of ['prepared', 'switched', 'reset', 'accepted-reset'] as const) test(`R14 shipping progress ${phase} never displays unscoped confusingKana and preserves its exact bytes`, async t => {
  const f = await languageWriterFixture({ wrongKanaChars: '["う"]' }); t.after(f.dispose);
  const legacy = ' [ "あ", {"char":"い"} ] ';
  const resetMarker = '2026-10-09T12:00:00.000Z|11111111-1111-4111-8111-111111111111';
  f.tab.local.setItem('confusingKana', legacy);
  if (phase === 'switched') await f.tab.cloud.prepareLocalCloudState('synthetic-owner-b');
  if (phase === 'reset') f.tab.local.setItem('languageRecordResetV1', resetMarker);
  if (phase === 'accepted-reset') {
    const lifecycle = f.language.createLanguageSyncLifecycle(); t.after(() => lifecycle.revoke());
    const request = f.language.readLanguageSyncRequest(f.lease, lifecycle, f.tab.local);
    const accepted = await f.language.commitLanguageRemoteReset(request, { languageRecordResetV1: resetMarker, wrongKanaChars: '["う"]' });
    f.tab.setModule('components/language/LanguageRecordsProvider.tsx', { useLanguageRecords: () => ({ context: accepted.context, refresh() {} }) });
  }
  f.tab.setModule('next/link', { default: 'a' });
  // Small static curriculum fixtures keep this handler test independent of catalogue loading.
  f.tab.setModule('data/words.ts', { WORDS: [] });
  f.tab.setModule('data/sentences.ts', { SENTENCES: [] });
  f.tab.setModule('data/grammar.ts', { GRAMMAR_LESSONS: [], GRAMMAR_PROGRESS_KEY: 'grammarProgress' });
  f.tab.setModule('data/curriculum.ts', { CURRICULUM: [], TRACKS: { foundation: { title: '기초' }, work: { title: '업무' }, travel: { title: '여행' } } });
  const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle();
  assert.doesNotMatch(view.text(), /헷갈림 [23]개/, 'The two legacy characters must not enter any summary');
  if (phase === 'switched' || phase === 'reset') {
    assert.match(view.text(), /학습 기록을 다시 확인해 주세요/, 'Retired authority requires a newly accepted coordinator context');
    assert.doesNotMatch(view.text(), /학습 요약/, 'Blocked attribution cannot display selected bytes either');
  }
  else {
    assert.match(view.text(), /학습 요약가나1단어/);
    assert.match(view.text(), /기본 46자전체 46자 · 오답 0개 · 헷갈림 1개/, 'The guarded selected wrongKanaChars contribution remains');
  }
  assert.equal(f.tab.local.getItem('confusingKana'), legacy);
  const boundary = f.tab.loadModule('app/data/languageStorageBoundary.ts') as { LANGUAGE_STORAGE_KEYS: readonly string[] };
  assert.equal(boundary.LANGUAGE_STORAGE_KEYS.includes('confusingKana'), false);
  const resets = f.tab.loadModule('app/data/appRecordReset.ts') as { APP_RECORD_KEYS: { language: readonly string[] } };
  assert.equal(resets.APP_RECORD_KEYS.language.includes('confusingKana'), false);
});

test('R13 an unsubscribed preference cache cannot expose an old language fallback on the next first render', async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('integratedLearningSettingsV1', '{"showCompanion":false}');
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const renderPreference = () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } });
  const first = f.tab.mount('', {}, renderPreference); await first.settle(); assert.match(first.text(), /"visible":false/); first.dispose();
  f.tab.local.setItem('language-storage-binding-v1', '{malformed');
  const second = f.tab.mount('', {}, renderPreference); t.after(second.dispose); await second.settle();
  for (const tree of second.history) assert.doesNotMatch(String(tree.props.children), /"visible":false/);
});

for (const event of ['focus', 'pageshow', 'yeoni-records-changed', 'ai-yeoni-record-reset', 'yeoni-cloud-session-changed', 'storage']) {
  test(`explicit denied-save stop/hide survives ${event} without changing stored bytes`, async t => {
    const f = await readerFixture(t);
    const saved = '{"visible":true,"motion":"home"}';
    f.tab.local.setItem('yeoniAppearanceSettingsV1', saved);
    const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
    const view = f.tab.mount('', {}, () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } }));
    t.after(view.dispose); await view.settle();
    f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
    assert.throws(() => preferences.updateYeoniPreferences({ visible: false, motion: 'off' }), /synthetic quota refusal/);
    assert.match(view.text(), /"visible":false,"motion":"off"/);
    f.tab.dispatch({ type: event, key: 'unrelated-record' });
    assert.match(view.text(), /"visible":false,"motion":"off"/);
    assert.equal(f.tab.local.getItem('yeoniAppearanceSettingsV1'), saved);
  });
}

test('only failed explicit fields survive language invalidation and an unsubscribed remount', async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('integratedLearningSettingsV1', '{"showCompanion":false}');
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const renderPreference = () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } });
  const first = f.tab.mount('', {}, renderPreference); await first.settle();
  assert.match(first.text(), /"visible":false,"motion":"reactions"/);
  f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
  assert.throws(() => preferences.updateYeoniPreferences({ motion: 'off' }), /synthetic quota refusal/);
  first.dispose();
  f.tab.local.setItem('language-storage-binding-v1', '{malformed');
  const second = f.tab.mount('', {}, renderPreference); t.after(second.dispose); await second.settle();
  assert.match(second.text(), /"visible":true,"motion":"off"/);
  for (const tree of second.history) {
    assert.doesNotMatch(String(tree.props.children), /"visible":false/, 'Unchosen borrowed visibility cannot survive remount');
    assert.match(String(tree.props.children), /"motion":"off"/, 'The explicit unsaved stop cannot be lost on first render');
  }
  assert.equal(f.tab.local.getItem('yeoniAppearanceSettingsV1'), null);
});

test('a successful retry retires failed device overrides so later saved preferences can refresh', async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('yeoniAppearanceSettingsV1', '{"visible":true,"motion":"home"}');
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const view = f.tab.mount('', {}, () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } }));
  t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
  assert.throws(() => preferences.updateYeoniPreferences({ visible: false, motion: 'off' }), /synthetic quota refusal/);
  preferences.updateYeoniPreferences({ visible: true });
  assert.equal(f.tab.local.getItem('yeoniAppearanceSettingsV1'), '{"visible":true,"motion":"off"}');
  f.tab.local.setItem('yeoniAppearanceSettingsV1', '{"visible":true,"motion":"home"}');
  f.tab.dispatch({ type: 'storage', key: 'yeoniAppearanceSettingsV1' });
  assert.match(view.text(), /"visible":true,"motion":"home"/);
});

test('consecutive failed explicit fields survive storage-access loss without borrowing other values', async t => {
  const f = await readerFixture(t);
  const legacy = '{"showCompanion":false}';
  f.tab.local.setItem('integratedLearningSettingsV1', legacy);
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  const view = f.tab.mount('', {}, () => ({ type: 'span', props: { children: JSON.stringify(preferences.useYeoniPreferences()) } }));
  t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
  assert.throws(() => preferences.updateYeoniPreferences({ motion: 'off' }), /synthetic quota refusal/);
  f.tab.failStorageAccess(); f.tab.dispatch({ type: 'focus' });
  assert.match(view.text(), /"visible":true,"motion":"off"/, 'Storage failure must discard borrowed visibility while keeping the explicit stop');
  f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
  assert.throws(() => preferences.updateYeoniPreferences({ visible: false }), /synthetic quota refusal/);
  f.tab.dispatch({ type: 'pageshow' });
  assert.match(view.text(), /"visible":false,"motion":"off"/, 'The later failed partial change must retain the earlier explicit field');
  assert.equal(f.tab.local.getItem('yeoniAppearanceSettingsV1'), null);
  assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), legacy);
});

for (const denied of [false, true]) test(`a newer subscriber choice wins when its persistence ${denied ? 'fails' : 'succeeds'}`, async t => {
  const f = await readerFixture(t);
  f.tab.local.setItem('yeoniAppearanceSettingsV1', '{"visible":true,"motion":"reactions"}');
  type Preference = ReturnType<typeof import('../components/useYeoniPreferences.ts')['useYeoniPreferences']>;
  let subscribe!: (listener: () => void) => () => void;
  let snapshot!: () => Preference;
  f.tab.setModule('react', { useSyncExternalStore(sub: typeof subscribe, get: typeof snapshot) { subscribe = sub; snapshot = get; return get(); } });
  const preferences = f.tab.loadModule('components/useYeoniPreferences.ts') as typeof import('../components/useYeoniPreferences.ts');
  preferences.useYeoniPreferences();
  t.after(subscribe(() => {}));
  let once = true;
  t.after(subscribe(() => {
    if (!once) return;
    once = false;
    if (denied) {
      f.browser.rejectNextWrite('yeoniAppearanceSettingsV1');
      assert.throws(() => preferences.updateYeoniPreferences({ motion: 'off' }), /synthetic quota refusal/);
    } else preferences.updateYeoniPreferences({ motion: 'off' });
  }));
  preferences.updateYeoniPreferences({ motion: 'home' });
  assert.equal(snapshot().motion, 'off');
  assert.equal(JSON.parse(f.tab.local.getItem('yeoniAppearanceSettingsV1')!).motion, denied ? 'home' : 'off');
  f.tab.dispatch({ type: 'focus' });
  assert.equal(snapshot().motion, 'off', 'An older write cannot overwrite or retire a newer explicit choice');
});
