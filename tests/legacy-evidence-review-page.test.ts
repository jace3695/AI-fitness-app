import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { storageBrowser, storageTab, nodes, type UiNode } from './helpers/storage-ui-fixture.ts';
import * as grammar from '../data/grammar.ts';
import { loadLegacyEvidenceRepository } from './helpers/legacyEvidenceRepositoryHarness.ts';

for (const search of ['?capture=course-review&row=f01%3A3', '?capture=course-review&captureEnabled=true&enrollmentEnabled=true&resetProtocol=protocol-required']) {
  test(`B2 actual inactive focused route has no target-bearing first render or evidence acquisition (${search})`, async t => {
    const privateTarget = 'UNADMITTED_TARGET_72';
    const f = await languageWriterFixture({ japaneseCurriculumReviewV1: JSON.stringify([{ id: 'f01:3', lessonId: 'f01', lessonTitle: privateTarget, prompt: privateTarget, explanation: privateTarget, createdAt: '2026-10-09T00:00:00.000Z' }]), savedWords: JSON.stringify([{ word: privateTarget, meaning: 'target', category: '일상', example: privateTarget }]) });
    t.after(f.dispose); f.tab.setLocationSearch(search);
    f.tab.setModule('next/navigation', { useSearchParams: () => new URLSearchParams(f.tab.locationSearch()) });
    f.tab.local.setItem('captureEnabled', 'true'); f.tab.local.setItem('enrollmentEnabled', 'true'); f.tab.local.setItem('resetProtocol', 'protocol-required');
    let rpc = 0; const client = { auth: { async getUser() { rpc++; throw Error('Unexpected inactive evidence auth'); } }, rpc() { rpc++; throw Error('Unexpected inactive RPC'); } };
    const repository = await loadLegacyEvidenceRepository(client);
    f.tab.setModule('lib/supabase.ts', { createClient: () => client });
    let acquisitions = 0;
    f.tab.setModule('app/data/languageLegacyEvidenceRepository.ts', { ...repository, acquireLanguageLegacyEvidenceRepository(...args: Parameters<typeof repository.acquireLanguageLegacyEvidenceRepository>) { acquisitions++; return repository.acquireLanguageLegacyEvidenceRepository(...args); } });
    f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
    f.tab.setModule('data/grammar.ts', grammar);
    f.tab.setModule('next/image', { default: 'img' });
    f.tab.setModule('components/yeoni-mascot.module.css.ts', { default: {} });
    f.tab.setModule('react', { memo: (component: unknown) => component });
    const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
    assert.match(view.text(), /아직 활성화되지/); assert.doesNotMatch(view.text(), new RegExp(privateTarget));
    assert.equal(acquisitions, 0, 'Actual release-gated factory was never invoked, so no evidence IDB/enrollment/RPC path began');
    assert.equal(rpc, 0);
    assert.equal(nodes(view.render()).filter(node => node.type === 'button').length, 0);
    for (const render of view.history) assert.ok(!JSON.stringify(render).includes(privateTarget), 'No earlier ordinary recommendation render');
    f.tab.dispatch({ type: 'pageshow' }); f.tab.dispatch({ type: 'focus' }); await view.settle(); assert.equal(acquisitions, 0);
    assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null, 'No automatic ordinary reconciliation in focused mode');
  });
}

test('B2 synthetic route location is isolated per harness and defaults empty', () => {
  const browser = storageBrowser(), first = storageTab(browser, 'first'), second = storageTab(browser, 'second');
  first.setLocationSearch('?capture=course-review');
  assert.equal(first.locationSearch(), '?capture=course-review'); assert.equal(second.locationSearch(), '');
  first.dispose(); second.dispose();
  assert.match(readFileSync(new URL('./helpers/storage-ui-fixture.ts', import.meta.url), 'utf8'), /location: \{ search: ''/);
});

test('B2 source loader parses the real TS generic and TSX route with their actual file extensions', async t => {
  const f = await languageWriterFixture(); t.after(f.dispose);
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
    f.tab.setModule('data/grammar.ts', grammar);
    f.tab.setModule('next/image', { default: 'img' });
    f.tab.setModule('components/yeoni-mascot.module.css.ts', { default: {} });
    f.tab.setModule('react', { memo: (component: unknown) => component });
  f.tab.setModule('lib/supabase.ts', { createClient: () => { throw Error('Unexpected client'); } });
  const review = f.tab.loadModule('lib/language-legacy-evidence/review-capture.ts');
  assert.equal(typeof review.prepareReviewTransition, 'function');
  assert.equal(typeof review.parseReviewRun, 'function');
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  assert.ok(nodes(view.render()).some(node => node.type === 'section'));
  assert.match(readFileSync(new URL('./helpers/storage-ui-fixture.ts', import.meta.url), 'utf8'), /fileName: absolute/);
});

test('B2 current router search switches the same mounted real page both ways without popstate', async t => {
  const target = 'SYNTHETIC_ORDINARY_ROUTE_TARGET';
  const f = await languageWriterFixture({ savedWords: JSON.stringify([{ word: target, meaning: 'test', category: '일상', example: 'test' }]) });
  t.after(f.dispose);
  f.tab.setLocationSearch('?capture=course-review');
  f.tab.setModule('next/navigation', { useSearchParams: () => new URLSearchParams(f.tab.locationSearch()) });
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
  f.tab.setModule('data/grammar.ts', grammar); f.tab.setModule('next/image', { default: 'img' });
  f.tab.setModule('components/yeoni-mascot.module.css.ts', { default: {} });
  f.tab.setModule('react', { memo: (component: unknown) => component });
  let rpc = 0, acquisitions = 0;
  const client = { auth: { async getUser() { rpc++; throw Error('Unexpected inactive evidence auth'); } }, rpc() { rpc++; throw Error('Unexpected inactive RPC'); } };
  const repository = await loadLegacyEvidenceRepository(client);
  f.tab.setModule('lib/supabase.ts', { createClient: () => client });
  f.tab.setModule('app/data/languageLegacyEvidenceRepository.ts', { ...repository, acquireLanguageLegacyEvidenceRepository(...args: Parameters<typeof repository.acquireLanguageLegacyEvidenceRepository>) { acquisitions++; return repository.acquireLanguageLegacyEvidenceRepository(...args); } });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  assert.ok(view.history.every(render => !JSON.stringify(render).includes(target)), 'Focused entry has no earlier ordinary target render');
  // The mock supplies current router params. No production history patch, remount,
  // popstate dispatch, or claim of actual Next/React browser scheduling is made.
  for (const search of ['', '?capture=course-review&row=f01%3A3', '?capture=other', '?capture=course-review', '']) {
    const before = view.history.length;
    f.tab.setLocationSearch(search); await view.settle();
    const focused = new URLSearchParams(search).get('capture') === 'course-review';
    assert.equal(view.text().includes('아직 활성화되지'), focused);
    assert.equal(view.text().includes(target), !focused);
    if (focused) assert.ok(view.history.slice(before).every(render => !JSON.stringify(render).includes(target)), 'Current focused query immediately removes ordinary targets');
    assert.equal(acquisitions, 0); assert.equal(rpc, 0);
  }
  const page = f.tab.loadModule('app/language/review/page.tsx').default as () => { type: unknown; props: { fallback: unknown; children: { type: unknown } } };
  const boundary = page();
  assert.equal(boundary.type, Symbol.for('fixture-suspense'));
  assert.equal(typeof boundary.props.children.type, 'function', 'The mounted root executes the actual page child');
  assert.ok(!JSON.stringify(boundary.props.fallback).includes(target), 'Static fallback is target-free');
});


test('B2 synthetic root Suspense preserves generic override, nested and empty renders', () => {
  const tab = storageTab(storageBrowser(), 'bounded-suspense');
  let calls = 0;
  const child = { type: () => { calls++; return { type: 'section', props: {} }; }, props: {} };
  const ordinary = tab.mount('', {}, () => ({ type: 'section', props: { children: child } }));
  assert.equal(calls, 0, 'Ordinary nested components remain opaque in the existing fixture');
  ordinary.dispose();
  const empty = tab.mount('', {}, () => null as unknown as UiNode);
  assert.equal(empty.text(), ''); empty.dispose();
  for (const path of ['', 'app/language/review/page.tsx', 'app/language/learn/page.tsx']) {
    const view = tab.mount(path, {}, () => ({ type: Symbol.for('fixture-suspense'), props: { children: child } }));
    assert.equal(calls, 0, 'Generic overrides never opt into actual ReviewPage execution');
    assert.equal(view.render().props.children, child); view.dispose();
  }
  // Synthetic malformed root probes test only the helper's bounded shape guard.
  tab.setModule('app/language/review/page.tsx', { default: () => ({ type: Symbol.for('fixture-suspense'), props: { children: [child, child] } }) });
  assert.throws(() => tab.mount('app/language/review/page.tsx'), /Expected one actual root Suspense child/);
  assert.equal(calls, 0); tab.dispose();
});

test('B2 root handling leaves the actual Learn page route tree opaque for existing manual mounts', async t => {
  const f = await languageWriterFixture(); t.after(f.dispose);
  f.tab.setModule('components/useYeoniPreferences.ts', { useYeoniPreferences: () => ({ visible: false }) });
  f.tab.setModule('components/language/LearningCompanion.tsx', { default: 'aside' });
  f.tab.setModule('components/language/LearningQuestion.tsx', { default: 'question' });
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
  f.tab.setModule('components/language/useLearningAudio.ts', { useLearningAudio: () => ({ stop() {}, async play() {}, playing: false, audioError: '' }) });
  const page = f.tab.mount('app/language/learn/page.tsx'); t.after(page.dispose);
  assert.equal(page.render().type, Symbol.for('fixture-suspense'));
  const route = page.render().props.children as UiNode;
  assert.equal(typeof route.type, 'function'); assert.equal((route.type as { name: string }).name, 'LearningRoute');
  assert.equal(f.tab.local.getItem('japaneseCurriculumProgressV1'), null, 'Opaque Learn wrapper must not execute child initialization');
});
