import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { conversationSessionFixture } from './helpers/conversationSessionFixture.ts';
import { nodes, textOf, tick, type UiNode } from './helpers/storage-ui-fixture.ts';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import { FREE_CONVERSATION_COVERAGE } from '../data/freeConversationCatalog.ts';
import { findGuidedConversationRegistration, findGuidedConversationCatalogScript } from '../data/guidedConversationCatalog.ts';
import { STORAGE_PROTOCOL_KEY } from '../app/data/storageTransaction.ts';
import type { ConversationDraft } from '../lib/conversation-session/contracts.ts';

type Fixture = Awaited<ReturnType<typeof conversationSessionFixture>>;
type Hook = ReturnType<typeof import('../components/language/useConversationSession.ts')['useConversationSession']>;
async function fixture(t: TestContext) { const f = await conversationSessionFixture(); t.after(f.dispose); return f; }
function hook(f: Fixture) { return f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession()); }
const selection = (script: { scriptId: string; scriptRevision: string }) => Object.assign(Object.create(null) as { kind: 'guided'; scriptId: string; scriptRevision: string }, { kind: 'guided' as const, scriptId: script.scriptId, scriptRevision: script.scriptRevision });
async function started(t: TestContext, index = 0) { const f = await fixture(t), h = hook(f), script = GUIDED_CONVERSATION_PILOT[index]; assert.equal(await h.current.start(selection(script)), true); await h.view.settle(); return { f, h, script }; }
async function type(h: ReturnType<typeof hook>, input: string) { h.current.typeInput(input); await h.view.settle(); }
function session(f: Fixture, id?: string) { const value = f.snapshot().envelope!.sessions.find(item => !id || item.sessionId === id); assert.ok(value); return value; }
function json(value: unknown) { return JSON.stringify(value); }
function recap(f: Fixture, id?: string) { return (f.tab.loadModule('lib/conversation-session/recap.ts') as typeof import('../lib/conversation-session/recap.ts')).projectClosedConversationRecap(f.snapshot().envelope, id ?? session(f).sessionId); }
function node(view: ReturnType<Fixture['mountPage']>, id: string) { const value = nodes(view.render()).find(item => item.props.id === id); assert.ok(value, `Missing ${id}: ${view.text()}`); return value; }
function change(value: UiNode, next: string) { (value.props.onChange as (event: unknown) => void)({ target: { value: next } }); }
async function selectPage(view: ReturnType<Fixture['mountPage']>, index = 0) {
  view.click('수준별 연습 선택'); await view.settle();
  change(node(view, 'conversation-level'), GUIDED_CONVERSATION_PILOT[index].levelId); await view.settle();
  const checkbox = nodes(view.render()).find(value => value.type === 'input' && value.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  view.click('새 대화 시작'); await view.settle();
}
async function retainDuringSend(f: Fixture, h: ReturnType<typeof hook>, submitted: string, retained: string) {
  await type(h, submitted); const ref = h.current.editorStepRef!, submittedId = session(f).drafts.find(item => item.input === submitted)!.draftId;
  const release = f.browser.holdLock(), sending = h.current.send(); await tick();
  h.current.typeInput(retained); assert.equal(h.current.input, retained); assert.deepEqual(h.current.editorStepRef, ref);
  release(); assert.equal(await sending, true); await h.view.settle();
  assert.equal(h.current.input, retained); assert.deepEqual(h.current.editorStepRef, ref); assert.equal(h.current.olderStepInput, true); assert.equal(h.current.canSend, false);
  assert.equal(await h.current.save(), true); await h.view.settle();
  const draft = session(f).drafts.find(item => item.input === retained)!; assert.notEqual(draft.draftId, submittedId); assert.deepEqual(draft.source, ref); return draft;
}
function unknownAfterMarker(f: Fixture, occurrence = 1) {
  const set = f.tab.local.setItem; let count = 0;
  f.tab.local.setItem = (key, value) => { set(key, value); if (key === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"') && ++count === occurrence) throw new Error('GUIDED_PRIVATE_HOST_ERROR'); };
  return () => { f.tab.local.setItem = set; };
}

// The auth coordinator, facade, hook and page are shipped code. The browser/SDK
// and identities are synthetic. These are not actual browser/IME acceptance.
for (const [index, script] of GUIDED_CONVERSATION_PILOT.entries()) {
  test(`guided ${script.levelId}: explicit 0→${script.steps.length}, fresh editor IDs, fixed responses, close and reopen`, async t => {
    const { f, h } = await started(t, index), ids = new Set<string>();
    for (let ordinal = 0; ordinal < script.steps.length; ordinal++) {
      const step = script.steps[ordinal]; assert.equal(h.current.activeStep?.id, step.id); assert.equal(h.current.progress?.submittedStepCount, ordinal);
      const input = ordinal === 0 ? step.learnerExample.japanese : `  PRIVATE_${script.levelId}_${ordinal} 日本語 👩🏽‍💻\t  `;
      await type(h, input); const draft = session(f).drafts.find(item => item.source.stepId === step.id)!;
      assert.ok(!ids.has(draft.draftId)); ids.add(draft.draftId);
      assert.equal(await h.current.send(), true); await h.view.settle();
      const turn = session(f).turns[ordinal]; assert.equal(turn.draft.input, input); assert.equal(turn.draft.source.stepId, step.id);
      assert.equal(turn.emission.reply, step.fixedReply.japanese); assert.equal(turn.emission.correction, ''); assert.equal(turn.sampleMatch.assessment, 'unavailable');
      assert.ok('kind' in turn.emission); if ('kind' in turn.emission) assert.equal(turn.emission.exampleFallback?.japanese ?? null, ordinal ? step.learnerExample.japanese : null);
      assert.equal(session(f).closed, null); assert.equal(h.current.input, '');
    }
    assert.equal(h.current.activeStep, undefined); assert.equal(h.current.editorStepRef, null); assert.equal(h.current.canEdit, false); assert.equal(h.current.canSend, false);
    assert.equal(await h.current.send(), false); assert.equal(await h.current.end(), true); await h.view.settle();
    const projected = recap(f); assert.ok('sourceKind' in projected); if ('sourceKind' in projected) { assert.equal(projected.progress.coverage, 'all-steps-submitted'); assert.equal(projected.assessmentCoverage.assessedTurns, 0); }
    const id = session(f).sessionId; assert.equal(await h.current.leave(), true); assert.equal(await h.current.open(id), true); assert.equal(h.current.session?.source.scriptRevision, script.scriptRevision);
    assert.equal(f.audio.length, 0); assert.equal(f.calls.some(call => json(call.payload).includes('PRIVATE_')), false); assert.equal(json(f.notices).includes('PRIVATE_'), false); assert.equal(json(f.diagnostics).includes('PRIVATE_'), false);
  });

  test(`guided ${script.levelId}: actual shipping selection, DOM exposure, IME-safe submit, final close and factual history`, async t => {
    const f = await fixture(t), page = f.mountPage(); assert.match(page.text(), /24\/24/); assert.equal(f.snapshot().envelope, null);
    await selectPage(page, index); assert.match(page.text(), new RegExp(script.levelLabelKo)); assert.match(page.text(), /텍스트 전용/);
    assert.equal(nodes(page.render()).some(value => value.type === 'button' && String(value.props.children).includes('예문 듣기')), false);
    for (let ordinal = 0; ordinal < script.steps.length; ordinal++) {
      const step = script.steps[ordinal]; assert.match(page.text(), new RegExp(step.titleKo));
      change(node(page, 'conversation-input'), ordinal ? 'PRIVATE_GUIDED_PAGE_NONMATCH' : step.learnerExample.reading); await page.settle();
      const input = node(page, 'conversation-input'); const key = input.props.onKeyDown as (event: unknown) => void;
      let prevented = 0;
      for (const suppressed of [{ isComposing: true, keyCode: 13, repeat: false }, { isComposing: false, keyCode: 229, repeat: false }, { isComposing: false, keyCode: 13, repeat: true }]) key({ key: 'Enter', nativeEvent: suppressed, repeat: suppressed.repeat, preventDefault() { prevented++; } });
      assert.equal(session(f).turns.length, ordinal); assert.equal(prevented, 0);
      page.click(ordinal === script.steps.length - 1 ? '마지막 문장 보내기' : '보내고 다음 단계로'); await page.settle();
      const turn = session(f).turns[ordinal]; assert.equal(turn.draft.exposure.example, 'shown'); assert.equal(turn.draft.exposure.meaning, 'shown'); assert.equal(turn.draft.exposure.hint, 'not-shown');
      assert.match(page.text(), /정해진 점원 응답/); if (ordinal) assert.match(page.text(), /참고 예문/);
    }
    assert.equal(session(f).closed, null); assert.match(page.text(), new RegExp(`연습 단계 ${script.steps.length}/${script.steps.length} 전송됨`));
    page.click('대화 종료'); await page.settle(); assert.ok(session(f).closed); assert.match(page.text(), /평가한 문장 0개/); assert.match(page.text(), /잘 쓴 표현: 평가하지 않음/);
    assert.equal(f.audio.length, 0); page.click('기록 보기'); await page.settle(); assert.match(page.text(), new RegExp(`전송한 단계 ${script.steps.length}/${script.steps.length}`)); assert.match(page.text(), /직접 작성한 고정 연습/);
  });
}

for (const index of [1, 2]) test(`guided ${GUIDED_CONVERSATION_PILOT[index].levelId}: two exact retained old lanes force read-only C and explicit partial close/new session`, async t => {
  const { f, h, script } = await started(t, index), id = session(f).sessionId;
  const a = await retainDuringSend(f, h, 'PRIVATE_A_SENT', 'PRIVATE_A_UNSENT'); assert.equal(await h.current.openCurrentStep(), true);
  const b = await retainDuringSend(f, h, 'PRIVATE_B_SENT', 'PRIVATE_B_UNSENT');
  assert.equal(h.current.activeStep?.id, script.steps[2]!.id); assert.equal(h.current.currentStepBlocked, true); assert.equal(h.current.canSend, false);
  assert.equal(await h.current.openCurrentStep(), false); assert.match(h.current.error!, /초안 두 개/); assert.equal(json(session(f).drafts), json([a, b]));
  h.current.insertExample(); assert.equal(h.current.input, b.input); assert.equal(await h.current.send(), false); assert.equal(session(f).turns.length, 2);
  assert.equal(await h.current.end(), true); await h.view.settle(); assert.equal(json(session(f).drafts), json([a, b]));
  const result = recap(f); assert.ok('sourceKind' in result); if ('sourceKind' in result) { assert.equal(result.progress.coverage, 'partial'); assert.equal(result.progress.submittedStepCount, 2); assert.deepEqual([...result.progress.unsubmittedStepIds], [script.steps[2]!.id]); assert.deepEqual([...result.unsentDrafts.map(draft => draft.source.stepId)], [script.steps[0].id, script.steps[1].id]); }
  assert.equal(await h.current.start(selection(script)), true); await h.view.settle(); assert.notEqual(h.current.session?.sessionId, id); assert.equal(h.current.activeStep?.id, script.steps[0].id); assert.equal(json(session(f, id).drafts), json([a, b]));
});

test('guided exact step exposure is sticky, rejects stale effects, and never transfers A hint to B or B example to A', async t => {
  const { f, h, script } = await started(t, 1), refA = h.current.activeStepRef!, oldObserver = h.current.observeExposure;
  h.current.observeExposure({ hint: 'shown' }, refA); await type(h, 'PRIVATE_A'); assert.equal(await h.current.send(), true); await h.view.settle();
  const refB = h.current.activeStepRef!; oldObserver({ example: 'shown', reading: 'shown', meaning: 'shown', hint: 'shown' }, refA);
  h.current.observeExposure({ example: 'shown', reading: 'shown' }, refB); await type(h, 'PRIVATE_B');
  let draftB = session(f).drafts[0]; assert.equal(draftB.exposure.hint, 'not-shown'); assert.equal(draftB.exposure.example, 'shown');
  h.current.observeExposure({ example: 'not-shown', reading: 'not-shown' }, refB); assert.equal(await h.current.save(), true); draftB = session(f).drafts[0]; assert.equal(draftB.exposure.example, 'shown'); assert.equal(draftB.exposure.reading, 'shown');
  assert.equal(session(f).turns[0].draft.exposure.example, 'not-shown'); assert.equal(session(f).turns[0].draft.exposure.hint, 'shown');
  assert.equal(h.current.activeStep?.id, script.steps[1].id);
});

test('guided page post-answer fallback and hint become old-step sticky facts without backdating submitted A or contaminating B', async t => {
  const { f, h, script } = await started(t, 1);
  const old = await retainDuringSend(f, h, 'PRIVATE_MATCH_NEITHER', 'PRIVATE_OLD_DRAFT');
  assert.equal(session(f).turns[0].draft.exposure.hint, 'not-shown');
  const page = f.mountPage(); await page.settle();
  assert.match(page.text(), /이전 단계의 보내지 않은 초안/); assert.match(page.text(), /참고 예문/);
  assert.equal(session(f).turns[0].draft.exposure.hint, 'not-shown');
  page.click('입력 저장'); await page.settle();
  const after = session(f).drafts.find(draft => draft.draftId === old.draftId)!; assert.equal(after.exposure.hint, 'shown'); assert.equal(after.source.stepId, script.steps[0].id);
  page.click('저장하고 현재 단계 열기'); await page.settle();
  change(node(page, 'conversation-input'), 'PRIVATE_B_CURRENT'); await page.settle();
  const b = session(f).drafts.find(draft => draft.source.stepId === script.steps[1].id)!; assert.equal(b.exposure.hint, 'not-shown'); assert.equal(b.exposure.example, 'shown');
  assert.equal(session(f).turns[0].draft.exposure.example, 'not-shown');
});

test('guided old editor refuses active example insertion and active-only display does not merge into its immutable source', async t => {
  const { f, h } = await started(t, 1), old = await retainDuringSend(f, h, 'PRIVATE_A', 'PRIVATE_A_RETAINED');
  const active = h.current.activeStepRef!; h.current.observeExposure({ example: 'shown', reading: 'shown', meaning: 'shown', hint: 'shown' }, active);
  h.current.insertExample(); assert.equal(h.current.input, old.input); assert.equal(await h.current.save(), true);
  assert.deepEqual(session(f).drafts[0], old); assert.equal(h.current.canSend, false);
});

test('guided final submit preserves newer final-step input as unsent and still requires explicit close', async t => {
  const { f, h, script } = await started(t);
  await type(h, script.steps[0].learnerExample.japanese); assert.equal(await h.current.send(), true);
  const final = await retainDuringSend(f, h, 'PRIVATE_FINAL_SENT', 'PRIVATE_FINAL_UNSENT');
  assert.equal(h.current.activeStep, undefined); assert.equal(h.current.canSend, false); assert.equal(await h.current.openCurrentStep(), false); assert.equal(session(f).closed, null);
  assert.equal(await h.current.end(), true); assert.equal(json(session(f).drafts), json([final])); const result = recap(f); assert.ok('sourceKind' in result); if ('sourceKind' in result) { assert.equal(result.progress.coverage, 'all-steps-submitted'); assert.equal(result.unsentDraftCount, 1); }
});

for (const existingLegacy of [false, true]) test(`guided all 24 exact previews leave ${existingLegacy ? 'existing v1 bytes' : 'absent storage'} unenrolled and unchanged`, async t => {
  const f = await fixture(t);
  if (existingLegacy) { const h = hook(f); assert.equal(await h.current.start('legacy-daily'), true); assert.equal(await h.current.leave(), true); h.view.dispose(); }
  const page = f.mountPage(); await page.settle();
  const before = [...f.browser.values], writes = f.browser.writes.length;
  const checkbox = nodes(page.render()).find(value => value.type === 'input' && value.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  page.click('수준별 연습 선택'); await page.settle();
  assert.equal(FREE_CONVERSATION_COVERAGE.length, 24);
  for (const cell of FREE_CONVERSATION_COVERAGE) {
    assert.equal(cell.availability, 'available'); assert.ok(cell.scriptId && cell.scriptRevision);
    const registration = findGuidedConversationRegistration(cell.scriptId, cell.scriptRevision); assert.ok(registration);
    const script = registration.content;
    change(node(page, 'conversation-context'), cell.contextId); await page.settle();
    change(node(page, 'conversation-level'), cell.levelId); await page.settle();
    const preview = region(page, '무료 회화 예문 미리보기');
    assert.ok(preview.includes(`${script.labelKo} · ${script.levelLabelKo}`));
    assert.ok(preview.includes(`예문 버전: ${script.scriptRevision}`)); assert.ok(preview.includes(`${script.steps.length}단계`));
    assert.ok(preview.includes(`${registration.builderPolicy === 'guided-fixed-exchange-v1' ? '점원' : '상대방'} 응답은`));
    assert.equal(page.button('새 대화 시작').props.disabled, false); assert.doesNotMatch(page.text(), /대화 준비 중/);
    assert.deepEqual([...f.browser.values], before); assert.equal(f.browser.writes.length, writes);
  }
  assert.match(page.text(), /수준별 연습 24\/24개 이용 가능/);
  assert.equal(f.snapshot().envelope?.schemaVersion ?? null, existingLegacy ? 1 : null); assert.equal(f.audio.length, 0);
});

test('guided unknown context and level have no preview, source, fallback, enrollment or audio', async t => {
  const f = await fixture(t), page = f.mountPage(); await page.settle();
  const checkbox = nodes(page.render()).find(value => value.type === 'input' && value.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  page.click('수준별 연습 선택'); await page.settle(); const before = [...f.browser.values], writes = f.browser.writes.length;
  for (const [context, level] of [['unknown', 'beginner'], ['restaurant', 'unknown'], ['__proto__', 'intermediate'], ['constructor', 'beginner'], ['company-general', 'toString']]) {
    change(node(page, 'conversation-context'), context); await page.settle(); change(node(page, 'conversation-level'), level); await page.settle();
    assert.equal(page.button('새 대화 시작').props.disabled, true); assert.match(page.text(), /대화 준비 중/);
    assert.doesNotMatch(region(page, '무료 회화 예문 미리보기'), /예문 버전:|기존 다섯 상황|정해진 시범/);
    assert.equal(f.snapshot().envelope, null); assert.deepEqual([...f.browser.values], before); assert.equal(f.browser.writes.length, writes);
  }
  assert.equal(f.audio.length, 0);
});

for (const terminal of ['unknown-append', 'cancel-observes-applied', 'unknown-cancel-observes-applied'] as const) test(`guided ${terminal}: newer A input survives terminal recovery under its original reference`, async t => {
  const { f, h, script } = await started(t, 1); await type(h, 'PRIVATE_ORIGINAL');
  let restore = () => {};
  if (terminal === 'unknown-append') {
    const release = f.browser.holdLock(); restore = unknownAfterMarker(f, 2); const sending = h.current.send(); await tick(); h.current.typeInput('PRIVATE_NEWER_OLD_A'); release(); assert.equal(await sending, false); restore();
    assert.equal(await h.current.recover(), true);
  } else {
    const captured = f.facade.captureConversationAppend(f.snapshot(), session(f).sessionId, session(f).drafts[0].draftId); await f.facade.stageConversationIntent(captured); await h.view.settle(); h.current.typeInput('PRIVATE_NEWER_OLD_A'); await h.view.settle();
    const run = f.facade.runConversationEdit;
    Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof run>[0]) {
      if (intent.kind === 'cancel') await f.facade.applyConversationIntent(captured);
      const result = await run(intent);
      // Applied-winner cancellation is read-only replay and writes no marker.
      // Lose its acknowledgement at the facade/hook continuation instead.
      if (intent.kind === 'cancel' && terminal.startsWith('unknown')) throw Object.assign(new Error('synthetic lost cancellation acknowledgement'), { outcome: 'unknown' });
      return result;
    } });
    const cancelled = await h.current.cancelPending(); restore(); Object.assign(f.facade, { runConversationEdit: run });
    if (terminal.startsWith('unknown')) { assert.equal(cancelled, false); assert.equal(h.current.status, 'uncertain'); assert.equal(await h.current.recover(), true); } else assert.equal(cancelled, true);
  }
  await h.view.settle(); assert.equal(session(f).turns.length, 1); assert.equal(h.current.input, 'PRIVATE_NEWER_OLD_A'); assert.equal(h.current.editorStepRef?.stepId, script.steps[0].id); assert.equal(h.current.activeStep?.id, script.steps[1].id); assert.equal(h.current.canSend, false); assert.equal(await h.current.save(), true);
});

test('guided cancelled/restored pending append retains exact A and cannot advance until a new explicit submission', async t => {
  const { f, h, script } = await started(t, 1); await type(h, 'PRIVATE_CANCELLED_A'); const original = session(f).drafts[0];
  const intent = f.facade.captureConversationAppend(f.snapshot(), session(f).sessionId, original.draftId); await f.facade.stageConversationIntent(intent);
  h.view.dispose(); const next = hook(f); await next.view.settle(); assert.equal(next.current.activeStep?.id, script.steps[0].id); assert.equal(await next.current.cancelPending(), true);
  assert.deepEqual(session(f).drafts[0], original); assert.equal(session(f).turns.length, 0); assert.equal(await next.current.send(), true); assert.equal(session(f).turns.length, 1);
});

test('guided delayed selected-level start is fenced before capture and late creation never navigates a changed selection', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_BEFORE_SELECTION');
  let current = true; const start = h.current.start(selection(GUIDED_CONVERSATION_PILOT[1]), () => current); current = false;
  assert.equal(await start, false); assert.equal(f.snapshot().envelope!.sessions.length, 1);
  const previousId = h.current.session!.sessionId, release = f.browser.holdLock(); current = true;
  const creating = h.current.start(selection(GUIDED_CONVERSATION_PILOT[1]), () => current); await tick(); current = false; release();
  assert.equal(await creating, false); assert.equal(h.current.session!.sessionId, previousId); assert.equal(h.current.input, 'PRIVATE_BEFORE_SELECTION');
});

test('guided whitespace-only refuses advancement, punctuation-only participates unassessed, oversize stays exact and unsaved', async t => {
  const { f, h } = await started(t); await type(h, ' \t\n '); assert.equal(await h.current.send(), false); assert.equal(session(f).turns.length, 0);
  await type(h, '。！？'); assert.equal(await h.current.send(), true); assert.equal(session(f).turns.length, 1); assert.equal(session(f).turns[0].sampleMatch.assessment, 'unavailable');
  const tooLong = '🍙'.repeat(4001); await type(h, tooLong); assert.equal(h.current.input, tooLong); assert.equal(await h.current.send(), false); assert.equal(h.current.status, 'unsaved');
});

test('guided peer-filled older lanes keep dirty third input visible and require explicit unsaved-only discard before partial close', async t => {
  const { f, h, script } = await started(t, 1);
  await retainDuringSend(f, h, 'PRIVATE_A_SENT', 'PRIVATE_A_KEEP'); assert.equal(await h.current.openCurrentStep(), true);
  await type(h, 'PRIVATE_B_SENT'); assert.equal(await h.current.send(), true); await h.view.settle(); h.view.dispose();
  const page = f.mountPage(); await page.settle(); page.click('저장하고 현재 단계 열기'); await page.settle();
  const run = f.facade.runConversationEdit; let injected = false;
  Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof run>[0]) {
    if (!injected && intent.kind === 'draft') {
      injected = true; const source = f.snapshot(), current = session(f);
      const oldB = f.contracts.draftSchema.parse({ draftId: 'synthetic-peer-old-b', revision: 1, savedAt: new Date().toISOString(), input: 'PRIVATE_B_PEER_KEEP',
        source: f.contracts.sourceRef(current.source, script.steps[1].id), origin: { kind: 'typed', edited: false }, exposure: { example: 'not-shown', reading: 'not-shown', meaning: 'not-shown', hint: 'not-shown' } });
      await run(f.facade.captureConversationDraft(source, current.sessionId, oldB));
    }
    return run(intent);
  } });
  change(node(page, 'conversation-input'), 'PRIVATE_C_DIRTY_THIRD'); await page.settle(); Object.assign(f.facade, { runConversationEdit: run });
  assert.equal(injected, true); const lanes = json(session(f).drafts);
  assert.equal(node(page, 'conversation-input').props.value, 'PRIVATE_C_DIRTY_THIRD'); assert.equal(node(page, 'conversation-input').props.disabled, true);
  assert.equal(page.button('마지막 문장 보내기').props.disabled, true); assert.equal(page.button('예문 넣기').props.disabled, true); assert.match(page.text(), /미저장 입력을 보존/);
  page.click('현재 기록으로 대화 종료'); await page.settle(); assert.equal(session(f).closed, null); assert.equal(node(page, 'conversation-input').props.value, 'PRIVATE_C_DIRTY_THIRD'); assert.equal(json(session(f).drafts), lanes);
  page.click('저장되지 않은 입력 버리기'); await page.settle(); assert.match(page.text(), /저장된 대화 기록은 삭제하지 않아요/); page.click('현재 미저장 입력 버리기'); await page.settle();
  page.click('현재 기록으로 대화 종료'); await page.settle(); assert.ok(session(f).closed); assert.equal(session(f).turns.length, 2);
  assert.equal(session(f).drafts.length, 2); assert.equal(session(f).drafts[0].input, 'PRIVATE_A_KEEP'); assert.equal(session(f).drafts[1].input, 'PRIVATE_B_PEER_KEEP');
  assert.match(page.text(), /아직 전송하지 않은 단계: 결제 수단 선택/); assert.doesNotMatch(page.text(), /PRIVATE_C_DIRTY_THIRD/);
});

test('guided current step remains read-only after both older lanes arrive through a peer write, without draft mutation', async t => {
  const { f, h, script } = await started(t, 1); const retained = await retainDuringSend(f, h, 'PRIVATE_A_SENT', 'PRIVATE_A_OLD'); assert.equal(await h.current.openCurrentStep(), true);
  await type(h, 'PRIVATE_B_SENT'); assert.equal(await h.current.send(), true); await h.view.settle();
  const current = session(f), b = f.contracts.draftSchema.parse({ ...retained, draftId: 'peer-retained-b', revision: 1, input: 'PRIVATE_B_OLD', source: f.contracts.sourceRef(current.source, script.steps[1].id) });
  await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), current.sessionId, b)); await h.view.settle();
  assert.equal(h.current.currentStepBlocked, true); assert.equal(h.current.canEdit, false); assert.equal(h.current.canSend, false); const before = json(session(f).drafts);
  h.current.typeInput('PRIVATE_C_REJECTED'); h.current.insertExample(); assert.equal(h.current.input, ''); assert.equal(json(session(f).drafts), before);
  assert.equal(await h.current.end(), true); assert.equal(json(session(f).drafts), before);
});

test('guided committed DOM effects inside apply do not retain an already-sent editor or backdate its answer', async t => {
  const f = await fixture(t), page = f.mountPage(); await selectPage(page, 1);
  change(node(page, 'conversation-input'), 'PRIVATE_FORCED_DOM_NONMATCH'); await page.settle();
  const apply = f.facade.applyConversationIntent; let interposed = false;
  Object.assign(f.facade, { async applyConversationIntent(intent: Parameters<typeof apply>[0]) {
    const result = await apply(intent); if (intent.command.kind === 'append') { interposed = true; page.render(); } return result;
  } });
  page.click('보내고 다음 단계로'); await page.settle(); Object.assign(f.facade, { applyConversationIntent: apply });
  assert.equal(interposed, true); assert.equal(node(page, 'conversation-input').props.value, ''); assert.equal(node(page, 'conversation-input').props.disabled, false);
  assert.equal(session(f).turns[0].draft.exposure.hint, 'not-shown'); assert.equal(session(f).drafts.length, 0); assert.doesNotMatch(page.text(), /이전 단계의 보내지 않은 초안/);
});

test('guided unavailable settings shell creates no target or transcript DOM exposure', async t => {
  const { f, h } = await started(t, 1); const retained = await retainDuringSend(f, h, 'PRIVATE_A_SENT', 'PRIVATE_A_UNSENT'); h.view.dispose();
  f.tab.setModule('components/language/useLanguageRecordSnapshot.ts', { useLanguageRecordSnapshot: () => ({ records: {}, snapshot: null, error: null }) });
  const page = f.mountPage(); await page.settle(); assert.match(page.text(), /계정과 학습 설정의 저장 상태/); assert.doesNotMatch(page.text(), /PRIVATE_A_UNSENT/);
  page.dispose(); const check = hook(f); assert.equal(check.current.status, 'saved'); assert.equal(await check.current.save(), true); assert.deepEqual(session(f).drafts[0], retained);
  assert.equal(session(f).turns[0].draft.exposure.hint, 'not-shown');
});

test('guided confirmed discard can release exposure-only dirty editor without altering saved lanes when draft capacity blocks close preservation', async t => {
  const { f, h } = await started(t, 1);
  await retainDuringSend(f, h, 'PRIVATE_A_SENT', 'PRIVATE_A_KEEP'); assert.equal(await h.current.openCurrentStep(), true);
  await retainDuringSend(f, h, 'PRIVATE_B_SENT', 'PRIVATE_B_KEEP'); h.view.dispose(); const before = json(session(f).drafts);
  const page = f.mountPage(); await page.settle();
  const run = f.facade.runConversationEdit; let saves = 0;
  Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof run>[0]) { if (intent.kind === 'draft') { saves++; throw Object.assign(new Error('synthetic logical budget boundary'), { code: 'capacity-exceeded' }); } return run(intent); } });
  page.click('현재 기록으로 대화 종료'); await page.settle(); assert.equal(session(f).closed, null); assert.ok(saves > 0); assert.equal(json(session(f).drafts), before);
  page.click('저장되지 않은 입력 버리기'); page.click('현재 미저장 입력 버리기'); await page.settle(); const attempts = saves;
  assert.equal(node(page, 'conversation-input').props.value, ''); assert.equal(node(page, 'conversation-input').props.disabled, true);
  page.click('현재 기록으로 대화 종료'); await page.settle(); Object.assign(f.facade, { runConversationEdit: run });
  assert.equal(saves, attempts); assert.ok(session(f).closed); assert.equal(json(session(f).drafts), before);
});

test('guided confirmed discard with a free lane requires explicit current-step opening before typing and still permits close', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SAVED_A');
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, 'PRIVATE_UNSAVED_A'); const saved = json(session(f).drafts);
  h.current.requestDiscardInput(); assert.equal(h.current.confirmDiscardInput(), true); assert.equal(h.current.editorStepRef, null); assert.equal(h.current.canEdit, false); assert.equal(h.current.canSend, false); assert.equal(h.current.canClose, true);
  h.current.typeInput('PRIVATE_SHOULD_NOT_OPEN'); h.current.insertExample(); assert.equal(h.current.input, ''); assert.equal(json(session(f).drafts), saved);
  assert.equal(await h.current.openCurrentStep(), true); assert.equal(h.current.input, 'PRIVATE_SAVED_A'); assert.equal(h.current.canEdit, true); assert.equal(await h.current.end(), true);
});

test('guided peer-consumed editor waits for explicit displayed current-step opening without replaying submitted text', async t => {
  const { f, h, script } = await started(t); await type(h, 'PRIVATE_PEER_SENT_A');
  const current = session(f), intent = f.facade.captureConversationAppend(f.snapshot(), current.sessionId, current.drafts[0].draftId);
  await f.facade.stageConversationIntent(intent); await f.facade.applyConversationIntent(intent); await h.view.settle();
  assert.equal(h.current.input, ''); assert.equal(h.current.editorStepRef, null); assert.equal(h.current.activeStep?.id, script.steps[1].id); assert.equal(h.current.canEdit, false);
  h.current.typeInput('PRIVATE_UNOPENED_B'); assert.equal(h.current.input, ''); assert.equal(session(f).drafts.length, 0);
  assert.equal(await h.current.openCurrentStep(), true); await type(h, 'PRIVATE_OPENED_B'); assert.equal(session(f).drafts[0].source.stepId, script.steps[1].id);
});

// Exact accepted sources, independent of whichever revision is current later.
const representativeSources = [
  ['guided-restaurant-beginner', 'sha256:f536c29078f567a5cc5dde12754c4e8cd406197b4daf91ff4881536fd6a0c9d3'],
  ['guided-train-elementary', 'sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085'],
  ['guided-company-mechanical-design-intermediate', 'sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa'],
] as const;
function region(page: ReturnType<Fixture['mountPage']>, label: string) {
  const found = nodes(page.render()).find(value => value.props['aria-label'] === label); assert.ok(found, `Missing ${label}`); return textOf(found);
}
function requiredScript(id: string, revision: string) { const script = findGuidedConversationCatalogScript(id, revision); assert.ok(script); return script; }
async function chooseScript(page: ReturnType<Fixture['mountPage']>, script: { contextId: string; levelId: string }) {
  page.click('수준별 연습 선택'); await page.settle();
  change(node(page, 'conversation-context'), script.contextId); await page.settle();
  change(node(page, 'conversation-level'), script.levelId); await page.settle();
}
async function startScript(page: ReturnType<Fixture['mountPage']>, script: { contextId: string; levelId: string }) {
  await chooseScript(page, script);
  const checkbox = nodes(page.render()).find(value => value.type === 'input' && value.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  page.click('새 대화 시작'); await page.settle();
}

for (const [scriptId, revision] of representativeSources) test(`catalogue shipping page ${scriptId}: exact saved source, help, fixed responses, explicit close and source-bound reopen`, async t => {
  const script = requiredScript(scriptId, revision), f = await fixture(t); let page = f.mountPage();
  await startScript(page, script); const id = session(f).sessionId;
  assert.equal(session(f).source.scriptId, scriptId); assert.equal(session(f).source.scriptRevision, revision);
  assert.equal(session(f).source.builderPolicy, 'guided-fixed-exchange-v2');
  assert.match(region(page, '현재 연습 단계'), /상대방 응답은/); assert.doesNotMatch(region(page, '현재 연습 단계'), /점원/);
  for (const [ordinal, step] of script.steps.entries()) {
    assert.ok(region(page, '현재 연습 단계').includes(step.titleKo));
    assert.match(region(page, '현재 연습 단계'), /상대방 말/);
    const arbitrary = `  PRIVATE_CATALOGUE_${scriptId}_${ordinal} 日本語 👩🏽‍💻\t  `;
    if (ordinal === 0) { page.click('힌트 보기'); page.click('예문 넣기'); }
    else change(node(page, 'conversation-input'), ordinal === 1 ? arbitrary : step.learnerExample.japanese);
    await page.settle(); page.click('입력 저장'); await page.settle();
    const draft = session(f).drafts.find(item => item.source.stepId === step.id)!;
    assert.ok(draft); assert.equal(draft.source.scriptId, scriptId); assert.equal(draft.source.scriptRevision, revision);
    assert.equal(draft.exposure.hint, ordinal === 0 ? 'shown' : 'not-shown');
    const saved = json(session(f));
    if (ordinal === 0) {
      page.dispose(); page = f.mountPage(); await page.settle();
      assert.equal(node(page, 'conversation-input').props.value, step.learnerExample.japanese);
      assert.equal(json(session(f)), saved); assert.equal(session(f).drafts[0].origin.kind, 'inserted-example');
    }
    const send = page.button(ordinal === script.steps.length - 1 ? '마지막 문장 보내기' : '보내고 다음 단계로').props.onClick as () => void;
    send(); send(); await page.settle();
    const turn = session(f).turns[ordinal]; assert.equal(session(f).turns.length, ordinal + 1);
    assert.equal(turn.draft.source.stepId, step.id); assert.equal(turn.draft.source.scriptId, scriptId);
    assert.equal(turn.draft.input, ordinal === 1 ? arbitrary : step.learnerExample.japanese);
    assert.equal(turn.emission.reply, step.fixedReply.japanese); assert.equal(turn.emission.correction, '');
    assert.equal(turn.sampleMatch.assessment, 'unavailable'); assert.equal(session(f).closed, null);
    assert.ok('kind' in turn.emission); if ('kind' in turn.emission) assert.equal(turn.emission.exampleFallback?.japanese ?? null, ordinal === 1 ? step.learnerExample.japanese : null);
    assert.ok(region(page, '이 대화에서 보낸 문장').includes(turn.emission.explanation));
    assert.match(region(page, '이 대화에서 보낸 문장'), /정해진 상대방 응답/); assert.doesNotMatch(region(page, '이 대화에서 보낸 문장'), /점원/);
  }
  assert.equal(page.button('보내고 다음 단계로').props.disabled, true);
  assert.equal(node(page, 'conversation-input').props.disabled, true);
  assert.match(page.text(), new RegExp(`연습 단계 ${script.steps.length}/${script.steps.length} 전송됨`));
  page.click('대화 종료'); await page.settle(); const closed = json(session(f));
  assert.ok(session(f).closed); assert.match(region(page, '종료한 대화 요약'), /평가한 문장 0개/);
  assert.match(region(page, '종료한 대화 요약'), /정해진 상대방 시범/); assert.doesNotMatch(region(page, '종료한 대화 요약'), /점원/);
  for (const turn of session(f).turns) assert.ok(region(page, '종료한 대화 요약').includes(turn.emission.explanation));
  page.click('기록 보기'); await page.settle(); await chooseScript(page, GUIDED_CONVERSATION_PILOT[0]);
  assert.match(region(page, '무료 회화 예문 미리보기'), /점원 응답은/);
  assert.ok(region(page, '이 브라우저의 대화 기록').includes(revision));
  page.click(`${script.labelKo} 종료 요약 보기`); await page.settle();
  assert.equal(session(f, id).source.scriptRevision, revision); assert.equal(json(session(f, id)), closed);
  assert.match(region(page, '종료한 대화 요약'), /정해진 상대방 응답/); assert.doesNotMatch(region(page, '종료한 대화 요약'), /점원/);
  assert.equal(f.audio.length, 0); assert.equal(json(f.calls).includes('PRIVATE_CATALOGUE_'), false);
  assert.equal(json(f.notices).includes('PRIVATE_CATALOGUE_'), false); assert.equal(json(f.diagnostics).includes('PRIVATE_CATALOGUE_'), false);
});

for (const context of ['company-general', 'company-mechanical-design', 'company-development', 'company-quality']) test(`catalogue ${context}: preview, prompt, transcript and partial recap use frozen generic counterpart`, async t => {
  const cell = FREE_CONVERSATION_COVERAGE.find(item => item.contextId === context && item.levelId === 'beginner')!;
  assert.ok(cell.scriptId && cell.scriptRevision); const script = requiredScript(cell.scriptId, cell.scriptRevision), f = await fixture(t), page = f.mountPage();
  await chooseScript(page, script); assert.match(region(page, '무료 회화 예문 미리보기'), /상대방 응답은/); assert.doesNotMatch(region(page, '무료 회화 예문 미리보기'), /점원/);
  await startScript(page, script); assert.match(region(page, '현재 연습 단계'), /상대방 말/); assert.doesNotMatch(region(page, '현재 연습 단계'), /점원/);
  page.click('예문 넣기'); await page.settle(); page.click('보내고 다음 단계로'); await page.settle();
  assert.match(region(page, '이 대화에서 보낸 문장'), /정해진 상대방 응답/); assert.doesNotMatch(region(page, '이 대화에서 보낸 문장'), /점원/);
  page.click('대화 종료'); await page.settle(); const closed = json(session(f));
  assert.match(region(page, '종료한 대화 요약'), /일부 단계만 전송/); assert.match(region(page, '종료한 대화 요약'), /정해진 상대방 응답/);
  assert.doesNotMatch(region(page, '종료한 대화 요약'), /점원/); const projected = recap(f); assert.ok('sourceKind' in projected); if ('sourceKind' in projected) assert.equal(projected.assessmentCoverage.assessedTurns, 0);
  page.click('기록 보기'); await page.settle(); await chooseScript(page, GUIDED_CONVERSATION_PILOT[0]);
  page.click(`${script.labelKo} 종료 요약 보기`); await page.settle(); assert.equal(json(session(f)), closed);
  assert.match(region(page, '종료한 대화 요약'), /정해진 상대방 응답/); assert.doesNotMatch(region(page, '종료한 대화 요약'), /점원/);
});

test('catalogue selecting company does not relabel reopened pilot active turns or saved recap explanations', async t => {
  const script = GUIDED_CONVERSATION_PILOT[0], f = await fixture(t), page = f.mountPage(); await selectPage(page);
  page.click('예문 넣기'); await page.settle(); page.click('보내고 다음 단계로'); await page.settle();
  const explanation = session(f).turns[0].emission.explanation, before = json(session(f)); assert.match(explanation, /점원/);
  page.click('기록 보기'); await page.settle(); await chooseScript(page, { contextId: 'company-quality', levelId: 'beginner' });
  assert.match(region(page, '무료 회화 예문 미리보기'), /상대방 응답은/);
  page.click(`${script.labelKo} 대화 이어가기`); await page.settle(); assert.equal(json(session(f)), before);
  assert.match(region(page, '현재 연습 단계'), /점원 말/); assert.doesNotMatch(region(page, '현재 연습 단계'), /상대방/);
  assert.match(region(page, '이 대화에서 보낸 문장'), /정해진 점원 응답/); assert.ok(region(page, '이 대화에서 보낸 문장').includes(explanation));
  page.click('대화 종료'); await page.settle(); const closed = json(session(f));
  page.click('기록 보기'); await page.settle(); page.click(`${script.labelKo} 종료 요약 보기`); await page.settle();
  assert.equal(json(session(f)), closed); assert.match(region(page, '종료한 대화 요약'), /정해진 점원 응답/);
  assert.doesNotMatch(region(page, '종료한 대화 요약'), /상대방/); assert.ok(region(page, '종료한 대화 요약').includes(explanation));
});

test('catalogue same-level cross-context stale editor and exposure cannot become the new first step', async t => {
  const restaurant = requiredScript(...representativeSources[0]);
  const companyCell = FREE_CONVERSATION_COVERAGE.find(cell => cell.contextId === 'company-quality' && cell.levelId === 'beginner')!;
  assert.ok(companyCell.scriptId && companyCell.scriptRevision); const company = requiredScript(companyCell.scriptId, companyCell.scriptRevision);
  const f = await fixture(t), h = hook(f); assert.equal(await h.current.start(selection(restaurant)), true); await h.view.settle();
  await type(h, 'PRIVATE_RESTAURANT_FIRST'); const oldId = h.current.session!.sessionId, oldRef = h.current.editorStepRef!, stale = h.current;
  assert.equal(await h.current.start(selection(company)), true); await h.view.settle();
  assert.equal(h.current.progress?.activeStepIndex, 0); assert.equal(restaurant.levelId, company.levelId);
  assert.notEqual(h.current.activeStepRef?.scriptId, oldRef.scriptId); assert.notEqual(h.current.activeStepRef?.stepId, oldRef.stepId);
  const previous = json(session(f, oldId)), current = json(h.current.session);
  stale.typeInput('PRIVATE_STALE_CONTEXT'); stale.insertExample(); stale.observeExposure({ hint: 'shown', example: 'shown' }, oldRef);
  assert.equal(await stale.send(), false); await h.view.settle(); assert.equal(h.current.input, '');
  assert.equal(json(session(f, oldId)), previous); assert.equal(json(h.current.session), current);
  await type(h, 'PRIVATE_COMPANY_FIRST'); const own = h.current.session!.drafts[0];
  assert.equal(own.source.scriptId, company.scriptId); assert.equal(own.source.stepId, company.steps[0].id); assert.equal(own.exposure.hint, 'not-shown');
});

test('catalogue delayed same-level cross-context creation remains on the original saved input after selection changes', async t => {
  const restaurant = requiredScript(...representativeSources[0]);
  const companyCell = FREE_CONVERSATION_COVERAGE.find(cell => cell.contextId === 'company-general' && cell.levelId === 'beginner')!;
  assert.ok(companyCell.scriptId && companyCell.scriptRevision); const company = requiredScript(companyCell.scriptId, companyCell.scriptRevision);
  const f = await fixture(t), h = hook(f); assert.equal(await h.current.start(selection(restaurant)), true); await type(h, 'PRIVATE_RESTAURANT_RETAIN');
  const previousId = h.current.session!.sessionId, previous = json(h.current.session), release = f.browser.holdLock(); let current = true;
  const creating = h.current.start(selection(company), () => current); await tick(); current = false; release();
  assert.equal(await creating, false); await h.view.settle(); assert.equal(h.current.session!.sessionId, previousId);
  assert.equal(h.current.input, 'PRIVATE_RESTAURANT_RETAIN'); assert.equal(h.current.editorStepRef?.scriptId, restaurant.scriptId);
  assert.equal(json(session(f, previousId)), previous);
});
