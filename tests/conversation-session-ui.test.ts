import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { conversationSessionFixture } from './helpers/conversationSessionFixture.ts';
import { nodes, tick } from './helpers/storage-ui-fixture.ts';
import { CONVERSATION_LIMITS, type ConversationDraft } from '../lib/conversation-session/contracts.ts';
import { LANGUAGE_MARKER_KEY } from '../app/data/languageStorageBoundary.ts';
import { STORAGE_PROTOCOL_KEY } from '../app/data/storageTransaction.ts';

type Fixture = Awaited<ReturnType<typeof conversationSessionFixture>>;
type Hook = ReturnType<typeof import('../components/language/useConversationSession.ts')['useConversationSession']>;
async function fixture(t: TestContext) { const f = await conversationSessionFixture(); t.after(f.dispose); return f; }
function hook(f: Fixture) {
  return f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
}
async function type(h: ReturnType<typeof hook>, input: string) { h.current.typeInput(input); await h.view.settle(); }
async function started(t: TestContext) {
  const f = await fixture(t), h = hook(f); assert.equal(await h.current.start('legacy-cafe'), true); await h.view.settle(); return { f, h };
}
function currentSession(f: Fixture, sessionId?: string) {
  const sessions = f.snapshot().envelope!.sessions, session = sessionId ? sessions.find(value => value.sessionId === sessionId) : sessions[0]; assert.ok(session); return session;
}
function exactDraft(f: Fixture, original: ConversationDraft, input: string) {
  return f.contracts.draftSchema.parse({ ...original, revision: original.revision + 1, input, savedAt: new Date().toISOString() });
}
function unknownAfterMarker(f: Fixture, occurrence = 1) {
  const set = f.tab.local.setItem; let count = 0;
  f.tab.local.setItem = (key, value) => { set(key, value); if (key === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"') && ++count === occurrence) throw new Error('PRIVATE_SYNTHETIC_HOST_ERROR'); };
  return () => { f.tab.local.setItem = set; };
}

// Every test uses synthetic identities/text. The host hooks/SDK are synthetic;
// persistence authority, observation registration and all action handlers are real.
test('P2C mount reads genuine coordinator authority but never enrolls an absent owner partition', async t => {
  const f = await fixture(t), before = f.browser.writes.length, h = hook(f); await h.view.settle();
  assert.equal(f.snapshot().envelope, null); assert.equal(h.current.session, null); assert.equal(h.current.sessions.length, 0);
  assert.equal(f.browser.writes.length, before); assert.equal(h.current.available, true);
  assert.equal(f.snapshot().observation.kind, 'authenticated-remote-observation-received');
  assert.equal(await h.current.send(), false); assert.equal(f.snapshot().envelope, null);
});

test('P2C explicit start/type/save/send preserves exact Unicode/whitespace and records one durable unassessed turn', async t => {
  const { f, h } = await started(t), input = '  日本語\t👩🏽‍💻\nPRIVATE_SYNTHETIC_INPUT  ';
  await type(h, input); assert.equal(h.current.input, input); assert.equal(h.current.status, 'saved'); assert.equal(currentSession(f).drafts[0].input, input);
  await h.current.observeExposure({ example: 'shown', reading: 'not-shown', meaning: 'shown', hint: 'not-shown' });
  assert.equal(await h.current.save(), true); assert.equal(h.current.status, 'saved'); assert.equal(currentSession(f).drafts[0].input, input);
  assert.equal(await h.current.send(), true); await h.view.settle();
  const session = currentSession(f); assert.equal(session.turns.length, 1); assert.equal(session.turns[0].draft.input, input); assert.equal(session.drafts.length, 0);
  assert.equal(session.turns[0].sampleMatch.assessment, 'unavailable'); assert.equal(session.turns[0].emission.correction, ''); assert.equal(h.current.input, '');
});

test('P2C rapid repeated captured handlers create/save/send/end at most once', async t => {
  const f = await fixture(t), h = hook(f);
  const start = h.current.start; await Promise.all([start('legacy-cafe'), start('legacy-cafe'), start('legacy-cafe')]); await h.view.settle();
  assert.equal(f.snapshot().envelope!.sessions.length, 1);
  await type(h, 'PRIVATE_SYNTHETIC_REPEAT'); const save = h.current.save;
  await Promise.all([save(), save(), save()]); assert.equal(currentSession(f).drafts.length, 1);
  const send = h.current.send; await Promise.all([send(), send(), send()]); await h.view.settle();
  assert.equal(currentSession(f).turns.length, 1);
  const end = h.current.end; await Promise.all([end(), end(), end()]); await h.view.settle();
  const session = currentSession(f); assert.ok(session.closed); assert.equal(session.operations.filter(operation => operation.command.kind === 'close').length, 1);
  assert.equal(await h.current.send(), false); assert.equal(currentSession(f).turns.length, 1);
});

test('P2C closing preserves unsent draft and freezes original authenticated observation provenance', async t => {
  const { f, h } = await started(t), observation = f.snapshot().observation;
  await type(h, 'PRIVATE_SYNTHETIC_SENT'); assert.equal(await h.current.send(), true);
  await type(h, 'PRIVATE_SYNTHETIC_UNSENT'); assert.equal(await h.current.end(), true); await h.view.settle();
  const session = currentSession(f); assert.equal(session.turns.length, 1); assert.equal(session.drafts[0].input, 'PRIVATE_SYNTHETIC_UNSENT'); assert.ok(session.closed);
  assert.equal(session.closed.turnRefs.length, 1); assert.equal(session.closed.observation.requestId, observation.requestId); assert.equal(h.current.canEdit, false);
  await f.refresh(); await h.view.settle(); assert.equal(currentSession(f).closed!.observation.requestId, observation.requestId);
});

test('P2C starting another script and leaving preserve exact old draft without claiming closure', async t => {
  const { f, h } = await started(t), first = h.current.session!.sessionId;
  await type(h, 'PRIVATE_SYNTHETIC_SWITCH  '); assert.equal(await h.current.start('legacy-travel'), true); await h.view.settle();
  assert.equal(currentSession(f, first).drafts[0].input, 'PRIVATE_SYNTHETIC_SWITCH  '); assert.equal(currentSession(f, first).closed, null);
  const second = h.current.session!.sessionId; assert.notEqual(second, first);
  await type(h, 'PRIVATE_SYNTHETIC_LEAVE'); assert.equal(await h.current.leave(), true); await h.view.settle();
  assert.equal(currentSession(f, second).drafts[0].input, 'PRIVATE_SYNTHETIC_LEAVE');
  assert.equal(await h.current.open(first), true); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_SWITCH  ');
});

test('P2C failed switch keeps old editor and exact unsaved input', async t => {
  const { f, h } = await started(t), id = h.current.session!.sessionId, input = 'PRIVATE_SYNTHETIC_FAILED_SWITCH';
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, input); f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId));
  assert.equal(await h.current.start('legacy-travel'), false); await h.view.settle();
  assert.equal(h.current.session!.sessionId, id); assert.equal(h.current.input, input); assert.equal(f.snapshot().envelope!.sessions.length, 1); assert.notEqual(h.current.status, 'saved');
});

test('P2C reload selects durable open session and restores exact acknowledged draft', async t => {
  const { f, h } = await started(t), input = 'PRIVATE_SYNTHETIC_RELOAD\n  ';
  await type(h, input); assert.equal(await h.current.save(), true); const id = h.current.session!.sessionId;
  h.view.dispose(); const reloaded = await conversationSessionFixture({}, { browser: f.browser, id: 'conversation-reloaded' }); t.after(reloaded.dispose);
  const next = hook(reloaded); await next.view.settle(); assert.equal(next.current.session!.sessionId, id); assert.equal(next.current.input, input); assert.equal(next.current.status, 'saved');
});

for (const action of ['save', 'send'] as const) test(`P2C newer typing while ${action} awaits acknowledgement survives and remains unsaved`, async t => {
  const { f, h } = await started(t);
  if (action === 'send') await type(h, 'PRIVATE_SYNTHETIC_N');
  const release = f.browser.holdLock();
  if (action === 'save') h.current.typeInput('PRIVATE_SYNTHETIC_N');
  const work = action === 'send' ? h.current.send() : Promise.resolve(false); await tick();
  h.current.typeInput('PRIVATE_SYNTHETIC_N_PLUS_1'); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_N_PLUS_1');
  release(); await work; await h.view.settle(); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_N_PLUS_1'); assert.equal(h.current.status, 'unsaved');
  const persisted = currentSession(f); assert.equal(action === 'send' ? persisted.turns[0].draft.input : persisted.drafts[0].input, 'PRIVATE_SYNTHETIC_N');
  assert.equal(await h.current.save(), true); assert.ok(currentSession(f).drafts.some(draft => draft.input === 'PRIVATE_SYNTHETIC_N_PLUS_1'));
});

test('P2C same-owner pause hides and revokes handlers while preserving in-memory unsaved input on return', async t => {
  const { f, h } = await started(t), input = 'PRIVATE_SYNTHETIC_PAUSE'; const release = f.browser.holdLock(); h.current.typeInput(input);
  const staleSave = h.current.save, before = f.browser.writes.length; f.pause(); h.view.render();
  assert.equal(h.current.available, false); assert.equal(h.current.input, ''); assert.equal(await staleSave(), false); assert.equal(f.browser.writes.length, before); release(); await tick();
  await f.resume(); await h.view.settle(); assert.equal(h.current.input, input); assert.equal(h.current.status, 'unsaved'); assert.equal(currentSession(f).drafts.length, 0);
});

test('P2C owner ABA clears visible text and permanently retires original captured callbacks', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_OWNER_A'); await h.current.save();
  const oldSave = h.current.save, oldSend = h.current.send, originalOwner = f.lease.userId, id = h.current.session!.sessionId;
  await f.switchOwner('synthetic-owner-b'); await h.view.settle(); assert.equal(h.current.input, ''); assert.equal(h.current.sessions.length, 0);
  assert.equal(await oldSave(), false); assert.equal(await oldSend(), false);
  await f.switchOwner(originalOwner); await h.view.settle(); assert.equal(await oldSend(), false); assert.equal(currentSession(f, id).turns.length, 0);
  // Returning A has fresh registered authority and can explicitly choose its own durable session.
  assert.equal(await h.current.open(id), true); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_OWNER_A');
});

test('P2C authenticated remote reset hides old generation/input and cannot revive queued old send', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_BEFORE_RESET'); await h.current.save();
  const oldSend = h.current.send, generation = f.snapshot().envelope!.generationId;
  f.setRemote({ [LANGUAGE_MARKER_KEY]: '2026-10-11T00:00:00.000Z|11111111-1111-4111-8111-111111111111' }); await f.refresh(); await h.view.settle();
  assert.equal(h.current.input, ''); assert.equal(h.current.sessions.length, 0); assert.equal(await oldSend(), false);
  assert.notEqual(f.snapshot().envelope!.generationId, generation); assert.equal(f.snapshot().envelope!.sessions.length, 0);
  assert.equal(await h.current.start('legacy-cafe'), true); await type(h, 'PRIVATE_SYNTHETIC_AFTER_RESET'); await h.current.save();
  assert.equal(await oldSend(), false); assert.equal(currentSession(f).drafts[0].input, 'PRIVATE_SYNTHETIC_AFTER_RESET');
});

test('P2C quota failure retains exact input and previous durable snapshot without raw diagnostics', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_OLD_DRAFT'); await h.current.save();
  const key = f.participants.conversationLocalKey(f.lease.userId), before = f.tab.local.getItem(key);
  f.browser.rejectNextWrite(key, new Error('PRIVATE_SYNTHETIC_STORAGE_DIAGNOSTIC')); await type(h, 'PRIVATE_SYNTHETIC_NEW_DRAFT'); await h.view.settle();
  assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_NEW_DRAFT'); assert.equal(f.tab.local.getItem(key), before); assert.notEqual(h.current.status, 'saved'); assert.doesNotMatch(h.current.error ?? '', /PRIVATE_SYNTHETIC/);
});

test('P2C missing Web Locks cannot fall back to raw or secondary storage', async t => {
  const { f, h } = await started(t); const before = new Map(f.browser.values); f.tab.disableLocks(); await type(h, 'PRIVATE_SYNTHETIC_NO_LOCKS');
  assert.equal(await h.current.save(), false); await h.view.settle(); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_NO_LOCKS'); assert.deepEqual(f.browser.values, before); assert.notEqual(h.current.status, 'saved');
});

test('P2C unknown durable draft performs read-first recovery without replay or input loss', async t => {
  const { f, h } = await started(t), input = 'PRIVATE_SYNTHETIC_UNKNOWN'; const restore = unknownAfterMarker(f); t.after(restore); await type(h, input);
  assert.equal(await h.current.save(), false); restore(); await h.view.settle(); assert.equal(h.current.status, 'uncertain'); assert.equal(h.current.input, input);
  const writes = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, writes); assert.equal(h.current.status, 'saved'); assert.equal(currentSession(f).drafts[0].input, input);
});

test('P2C unknown close is recovered once from durable boundary rather than issuing another close', async t => {
  const { f, h } = await started(t); const restore = unknownAfterMarker(f, 2); t.after(restore);
  assert.equal(await h.current.end(), false); restore(); await h.view.settle(); assert.equal(h.current.status, 'uncertain');
  const before = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, before); assert.ok(currentSession(f).closed); assert.equal(currentSession(f).operations.length, 1);
});

test('P2C restarted staged append is never automatically sent and explicit cancellation restores unsent draft', async t => {
  const { f, h } = await started(t), input = 'PRIVATE_SYNTHETIC_STAGED'; await type(h, input); await h.current.save();
  const session = currentSession(f), intent = f.facade.captureConversationAppend(f.snapshot(), session.sessionId, session.drafts[0].draftId); await f.facade.stageConversationIntent(intent);
  h.view.dispose(); const restarted = hook(f); await restarted.view.settle(); const before = f.browser.writes.length;
  assert.ok(restarted.current.pendingOperation); assert.equal(currentSession(f).turns.length, 0); await restarted.current.recover(); await restarted.view.settle();
  assert.equal(f.browser.writes.length, before); assert.equal(currentSession(f).turns.length, 0); assert.equal(await restarted.current.cancelPending(), true); await restarted.view.settle();
  assert.equal(restarted.current.input, input); assert.equal(currentSession(f).operations[0].terminal!.kind, 'cancelled'); assert.equal((await f.facade.applyConversationIntent(intent)).effect.kind, 'cancelled'); assert.equal(currentSession(f).turns.length, 0);
});

test('P2C divergent same-lane draft source blocks overwrite instead of silently rebasing local typing', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_INITIAL'); await h.current.save();
  const session = currentSession(f), original = session.drafts[0];
  await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), session.sessionId, exactDraft(f, original, 'PRIVATE_SYNTHETIC_OTHER_EDITOR'))); await type(h, 'PRIVATE_SYNTHETIC_THIS_EDITOR');
  assert.equal(await h.current.save(), false); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_THIS_EDITOR'); assert.equal(currentSession(f).drafts[0].input, 'PRIVATE_SYNTHETIC_OTHER_EDITOR');
});

test('P2C 8000-code-unit cap rejects oversize without truncation; blank send never creates a turn', async t => {
  const { f, h } = await started(t), input = 'x'.repeat(CONVERSATION_LIMITS.inputCodeUnits + 1); await type(h, input); assert.equal(await h.current.save(), false);
  assert.equal(h.current.input, input); assert.equal(currentSession(f).drafts.length, 0);
  await type(h, ' \t\n'); assert.equal(await h.current.send(), false); assert.equal(h.current.input, ' \t\n'); assert.equal(currentSession(f).turns.length, 0);
});

test('P2C session count capacity keeps every existing record and rejects only the requested extra session', async t => {
  const f = await fixture(t);
  for (let i = 0; i < CONVERSATION_LIMITS.sessions; i++) await f.facade.runConversationEdit(f.facade.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const h = hook(f); await h.view.settle(); const key = f.participants.conversationLocalKey(f.lease.userId), before = f.tab.local.getItem(key);
  assert.equal(await h.current.start('legacy-cafe'), false); assert.equal(f.tab.local.getItem(key), before); assert.equal(f.snapshot().envelope!.sessions.length, CONVERSATION_LIMITS.sessions);
});

test('P2C delete needs current exact displayed session confirmation and preserves unrelated sessions', async t => {
  const { f, h } = await started(t), first = h.current.session!.sessionId; await type(h, 'PRIVATE_SYNTHETIC_DELETE'); await h.current.save();
  await h.current.start('legacy-travel'); const second = h.current.session!.sessionId; await h.current.open(first);
  assert.equal(await h.current.confirmDelete(), false); h.current.requestDelete(); assert.equal(h.current.deletion?.sessionId, first);
  const original = currentSession(f, first).drafts[0]; await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), first, exactDraft(f, original, 'PRIVATE_SYNTHETIC_CHANGED_AFTER_CONFIRM')));
  assert.equal(await h.current.confirmDelete(), false); assert.equal(f.snapshot().envelope!.sessions.length, 2);
  await h.current.recover(); h.current.requestDiscardInput(); assert.equal(h.current.confirmDiscardInput(), true);
  assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_CHANGED_AFTER_CONFIRM'); h.current.requestDelete(); assert.equal(await h.current.confirmDelete(), true); await h.view.settle();
  assert.equal(f.snapshot().envelope!.sessions.length, 1); assert.equal(currentSession(f, second).sessionId, second); assert.equal(f.snapshot().envelope!.tombstones.length, 1);
});

// Page-specific assertions are kept against actual rendered event handlers.
test('P2C shipping page requires explicit enrollment, labels local retention and sends once outside IME composition', async t => {
  const f = await fixture(t), view = f.mountPage(); await view.settle();
  assert.match(view.text(), /이 브라우저에만 저장/); assert.match(view.text(), /평가하지 않/); assert.equal(f.snapshot().envelope, null);
  assert.equal(view.button('새 대화 시작').props.disabled, true);
  (view.button('새 대화 시작').props.onClick as () => void)(); await view.settle(); assert.equal(f.snapshot().envelope, null);
  const consent = nodes(view.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(consent);
  (consent.props.onChange as (event: unknown) => void)({ target: { checked: true } }); view.render();
  view.click('새 대화 시작'); await view.settle(); const input = nodes(view.render()).find(node => node.props.id === 'conversation-input'); assert.ok(input);
  (input.props.onChange as (event: unknown) => void)({ target: { value: 'PRIVATE_SYNTHETIC_PAGE' } }); await view.settle();
  const editor = nodes(view.render()).find(node => node.type === input.type && typeof node.props.onKeyDown === 'function'); assert.ok(editor);
  const keydown = editor.props.onKeyDown as (event: unknown) => void;
  keydown({ key: 'Enter', nativeEvent: { isComposing: true, keyCode: 229 }, preventDefault() {} }); await view.settle(); assert.equal(currentSession(f).turns.length, 0);
  keydown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} }); keydown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} }); await view.settle();
  assert.equal(currentSession(f).turns.length, 1); assert.equal(f.audio.length, 0); assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE_SYNTHETIC_PAGE|yeoni-conversation-local-v1/);
});

test('P2C shipping closed recap is factual, separates unsent draft and exposes no assessment claim or history speech action', async t => {
  const { f, h } = await started(t); await h.current.observeExposure({ example: 'shown', reading: 'not-shown', meaning: 'shown', hint: 'not-shown' }); await type(h, 'PRIVATE_SYNTHETIC_RECAP_SENT'); await h.current.send(); await type(h, 'PRIVATE_SYNTHETIC_RECAP_UNSENT'); await h.current.end();
  h.view.dispose(); const view = f.mountPage(); await view.settle();
  view.click('카페 종료 요약 보기'); await view.settle();
  assert.match(view.text(), /평가하지 않음/); assert.match(view.text(), /보내지 않은 초안/); assert.doesNotMatch(view.text(), /0 mistakes|정답률|숙련도|자연스러운 문장/);
  assert.equal(f.audio.length, 0); assert.ok(nodes(view.render()).every(node => !Object.hasOwn(node.props, 'dangerouslySetInnerHTML')));
});

test('P2C disappearing enrolled partition reports missing source and never implicitly recreates history', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_MISSING');
  const key = f.participants.conversationLocalKey(f.lease.userId); f.tab.local.removeItem(key); f.tab.dispatch({ type: 'storage', key }); await h.view.settle();
  assert.equal(h.current.missing, true); assert.equal(h.current.canEdit, false); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_MISSING');
  assert.equal(await h.current.save(), false); assert.equal(await h.current.start('legacy-cafe'), false); assert.equal(f.tab.local.getItem(key), null);
});

test('P2C example insertion/edit and visible hint exposure are retained as facts without restoring assessment authority', async t => {
  const { f, h } = await started(t); await h.current.observeExposure({ reading: 'shown', hint: 'shown' }); h.current.insertExample(); await h.view.settle();
  assert.equal(currentSession(f).drafts[0].origin.kind, 'inserted-example'); assert.equal(currentSession(f).drafts[0].origin.edited, false);
  await type(h, `${h.current.input} synthetic edit`); assert.equal(await h.current.send(), true);
  const turn = currentSession(f).turns[0]; assert.equal(turn.draft.origin.kind, 'inserted-example'); assert.equal(turn.draft.origin.edited, true);
  assert.equal(turn.draft.exposure.example, 'shown'); assert.equal(turn.draft.exposure.reading, 'shown'); assert.equal(turn.draft.exposure.hint, 'shown'); assert.equal(turn.sampleMatch.assessment, 'unavailable');
});

for (const navigation of ['start', 'open', 'leave'] as const) test(`P2C ${navigation} waits for preservation but refuses to hide newer typing during its save`, async t => {
  const { f, h } = await started(t), original = h.current.session!.sessionId;
  const other = await f.facade.runConversationEdit(f.facade.captureConversationSession(f.snapshot(), 'legacy-travel', 'UTC'));
  let release = f.browser.holdLock(); h.current.typeInput('PRIVATE_SYNTHETIC_NAV_N'); await tick(); h.current.typeInput('PRIVATE_SYNTHETIC_NAV_N_PLUS_1'); release(); await h.view.settle();
  assert.equal(h.current.status, 'unsaved');
  release = f.browser.holdLock(); const move = navigation === 'start' ? h.current.start('legacy-daily') : navigation === 'open' ? h.current.open(other.effect.sessionId) : h.current.leave();
  await tick(); h.current.typeInput('PRIVATE_SYNTHETIC_NAV_N_PLUS_2'); release(); assert.equal(await move, false); await h.view.settle();
  assert.equal(h.current.session!.sessionId, original); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_NAV_N_PLUS_2'); assert.equal(h.current.status, 'unsaved'); assert.equal(f.snapshot().envelope!.sessions.length, 2);
});

test('P2C unknown durable append recovers one committed turn without auto-retry or fresh command identity', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_APPEND_UNKNOWN'); const restore = unknownAfterMarker(f, 2); t.after(restore);
  assert.equal(await h.current.send(), false); restore(); await h.view.settle(); assert.equal(h.current.status, 'uncertain'); assert.equal(currentSession(f).turns.length, 1);
  const before = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, before); assert.equal(currentSession(f).operations.length, 1); assert.equal(h.current.input, '');
});

test('P2C retained handlers from an earlier session cannot mutate newly selected session under the same owner', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_FIRST_SESSION'); const old = h.current;
  await h.current.start('legacy-travel'); await type(h, 'PRIVATE_SYNTHETIC_SECOND_SESSION'); const id = h.current.session!.sessionId;
  old.typeInput('PRIVATE_SYNTHETIC_STALE_EVENT'); assert.equal(await old.send(), false); assert.equal(await old.end(), false); old.requestDelete();
  assert.equal(h.current.deletion, null); assert.equal(h.current.session!.sessionId, id); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_SECOND_SESSION'); assert.equal(currentSession(f, id).turns.length, 0);
});

test('P2C explicit local input discard requires its exact reviewed editor revision', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_DISCARD_BASE');
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, 'PRIVATE_SYNTHETIC_DISCARD_PENDING');
  assert.equal(h.current.confirmDiscardInput(), false); h.current.requestDiscardInput(); assert.equal(h.current.discardingInput, true);
  assert.equal(h.current.confirmDiscardInput(), true); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_DISCARD_BASE'); assert.equal(currentSession(f).drafts[0].input, 'PRIVATE_SYNTHETIC_DISCARD_BASE');
});

test('P2C typing with both persisted lanes occupied never overwrites the other recovery draft', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_PINNED_LANE');
  const session = currentSession(f), first = session.drafts[0];
  const second = f.contracts.draftSchema.parse({ ...first, draftId: 'synthetic-second-lane', input: 'PRIVATE_SYNTHETIC_OTHER_LANE' });
  await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), session.sessionId, second));
  const command = f.facade.captureConversationAppend(f.snapshot(), session.sessionId, first.draftId); await f.facade.stageConversationIntent(command);
  await type(h, 'PRIVATE_SYNTHETIC_THIRD_UNSAVED_LANE');
  assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_THIRD_UNSAVED_LANE'); assert.equal(await h.current.save(), false);
  assert.deepEqual(Array.from(currentSession(f).drafts, draft => draft.input), ['PRIVATE_SYNTHETIC_PINNED_LANE', 'PRIVATE_SYNTHETIC_OTHER_LANE']);
  assert.equal(currentSession(f).turns.length, 0); assert.match(h.current.error ?? '', /한도/);
});

test('P2C displayed hint exposure survives switching away and reopening the same session', async t => {
  const { f, h } = await started(t), id = h.current.session!.sessionId; h.current.observeExposure({ hint: 'shown', reading: 'shown' });
  await h.current.start('legacy-travel'); await h.current.open(id); await type(h, 'PRIVATE_SYNTHETIC_STICKY_EXPOSURE'); await h.current.send();
  assert.equal(currentSession(f, id).turns[0].draft.exposure.hint, 'shown'); assert.equal(currentSession(f, id).turns[0].draft.exposure.reading, 'shown');
});

test('P2C session creation fences typing until the new session is acknowledged', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_OLD_BEFORE_CREATE');
  const old = h.current.typeInput, release = f.browser.holdLock(), creating = h.current.start('legacy-travel'); await tick();
  assert.equal(h.current.canEdit, false); old('PRIVATE_SYNTHETIC_DURING_CREATE'); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_OLD_BEFORE_CREATE');
  release(); assert.equal(await creating, true); await h.view.settle(); assert.equal(h.current.input, ''); assert.equal(f.snapshot().envelope!.sessions.length, 2);
  assert.equal(currentSession(f).drafts[0].input, 'PRIVATE_SYNTHETIC_OLD_BEFORE_CREATE');
});

test('P2C cached example audio handlers are inert after pause or leaving the current session', async t => {
  const f = await fixture(t), view = f.mountPage(); await view.settle();
  const consent = nodes(view.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(consent);
  (consent.props.onChange as (event: unknown) => void)({ target: { checked: true } }); view.render(); view.click('새 대화 시작'); await view.settle();
  const oldAudio = view.button('예문 듣기').props.onClick as () => void; f.pause(); oldAudio(); await view.settle(); assert.equal(f.audio.length, 0);
  await f.resume(); await view.settle(); const freshAudio = view.button('예문 듣기').props.onClick as () => void;
  view.click('기록 보기'); await view.settle(); freshAudio(); await view.settle(); assert.equal(f.audio.length, 0);
});

for (const failure of ['durable marker', 'notification'] as const) test(`P2C unknown delete after ${failure} reconciles exact tombstone without repeating deletion`, async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_UNKNOWN_DELETE'); h.current.requestDelete(); assert.ok(h.current.deletion);
  const restore = failure === 'durable marker' ? unknownAfterMarker(f) : f.failNextNotification(); t.after(restore);
  assert.equal(await h.current.confirmDelete(), false); restore(); await h.view.settle(); assert.equal(h.current.status, 'uncertain');
  assert.equal(f.snapshot().envelope!.sessions.length, 0); assert.equal(f.snapshot().envelope!.tombstones.length, 1);
  const before = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, before); assert.equal(h.current.session, null); assert.equal(h.current.status, 'idle');
});

test('P2C unknown enrollment is verified read-first rather than starting a duplicate session', async t => {
  const f = await fixture(t), h = hook(f), restore = unknownAfterMarker(f); t.after(restore);
  assert.equal(await h.current.start('legacy-cafe'), false); restore(); await h.view.settle(); assert.equal(h.current.status, 'uncertain'); assert.equal(f.snapshot().envelope!.sessions.length, 1);
  const before = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, before); assert.ok(h.current.session); assert.equal(h.current.status, 'saved');
});

for (const change of ['close', 'delete'] as const) test(`P2C page preserves unsaved text when another writer ${change}s its session`, async t => {
  const f = await fixture(t), view = f.mountPage(); await view.settle();
  const consent = nodes(view.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(consent);
  (consent.props.onChange as (event: unknown) => void)({ target: { checked: true } }); view.render(); view.click('새 대화 시작'); await view.settle();
  const id = currentSession(f).sessionId, input = nodes(view.render()).find(node => node.props.id === 'conversation-input'); assert.ok(input);
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId));
  (input.props.onChange as (event: unknown) => void)({ target: { value: 'PRIVATE_SYNTHETIC_RETAIN_AFTER_EXTERNAL_CHANGE' } }); await view.settle();
  if (change === 'delete') await f.facade.runConversationEdit(f.facade.captureConversationDeletion(f.snapshot(), id));
  else { const intent = f.facade.captureConversationClose(f.snapshot(), id); await f.facade.stageConversationIntent(intent); await f.facade.applyConversationIntent(intent); }
  await view.settle(); assert.match(view.text(), /PRIVATE_SYNTHETIC_RETAIN_AFTER_EXTERNAL_CHANGE/); assert.equal(nodes(view.render()).find(node => node.props.id === 'conversation-input'), undefined);
  const before = f.browser.writes.length; await view.settle(); assert.equal(f.browser.writes.length, before); assert.equal(f.audio.length, 0);
});

test('P2C unsupported frozen source is read-only while its retained draft remains visible and explicitly deletable', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_UNSUPPORTED_DRAFT'); const key = f.participants.conversationLocalKey(f.lease.userId);
  const envelope = JSON.parse(f.tab.local.getItem(key)!); const session = envelope.sessions[0]; session.source.scriptRevision = 'synthetic-unsupported-source'; session.source.contentSource.revision = session.source.scriptRevision;
  for (const draft of session.drafts) draft.source.scriptRevision = session.source.scriptRevision;
  f.tab.local.setItem(key, f.contracts.canonicalJson(envelope)); h.view.dispose();
  const view = f.mountPage(); await view.settle(); assert.match(view.text(), /PRIVATE_SYNTHETIC_UNSUPPORTED_DRAFT/); assert.match(view.text(), /지원하지 않|현재.*기준/);
  assert.equal(nodes(view.render()).find(node => node.props.id === 'conversation-input'), undefined); assert.equal(nodes(view.render()).find(node => node.type === 'button' && node.props.children === '예문 듣기'), undefined);
  view.click('대화 삭제'); await view.settle(); view.click('이 대화 영구 삭제'); await view.settle(); assert.equal(f.snapshot().envelope!.sessions.length, 0); assert.equal(f.snapshot().envelope!.tombstones.length, 1);
});

/** Interpose a genuine competing facade edit after the original durable save,
 * before the caller receives its acknowledged result. No snapshot, context,
 * receipt or operation authority is manufactured by this test wrapper. */
function interposeCompetingDraftSave(f: Fixture, mode: 'same-lane' | 'other-lane-append' = 'same-lane') {
  const original = f.facade.runConversationEdit;
  let armed = true, interposed = false;
  Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof original>[0]) {
    const result = await original(intent);
    if (armed && intent.kind === 'draft' && result.acknowledged && result.source) {
      armed = false;
      const source = f.facade.readConversationSnapshot(result.source.context), effect = result.effect;
      assert.equal(effect.kind, 'draft-saved'); if (effect.kind !== 'draft-saved') assert.fail('Expected the original draft-save receipt');
      const session = source.envelope!.sessions.find(item => item.sessionId === effect.sessionId)!;
      const draft = session.drafts.find(item => item.draftId === effect.resultId)!; assert.ok(draft);
      const nextDraft = mode === 'same-lane' ? exactDraft(f, draft, 'PRIVATE_SYNTHETIC_INTERPOSED_COMPETITOR')
        : f.contracts.draftSchema.parse({ ...draft, draftId: 'synthetic-interposed-other-lane', revision: 1, input: 'PRIVATE_SYNTHETIC_INTERPOSED_COMPETITOR' });
      const competing = f.facade.captureConversationDraft(source, session.sessionId, nextDraft);
      const changed = await original(competing); assert.equal(changed.acknowledged, true);
      if (mode === 'other-lane-append') {
        const current = f.facade.readConversationSnapshot(source.context);
        const append = f.facade.captureConversationAppend(current, session.sessionId, nextDraft.draftId);
        assert.equal((await f.facade.stageConversationIntent(append)).acknowledged, true);
        assert.equal((await f.facade.applyConversationIntent(append)).acknowledged, true);
      }
      interposed = true;
    }
    return result;
  } });
  return { get interposed() { return interposed; }, restore() { Object.assign(f.facade, { runConversationEdit: original }); } };
}

for (const action of ['send', 'end', 'leave', 'open', 'start'] as const) test(`P2C ${action} refuses an interposed competing same-lane save before its own save acknowledgement returns`, async t => {
  const { f, h } = await started(t), originalId = h.current.session!.sessionId;
  const other = await f.facade.runConversationEdit(f.facade.captureConversationSession(f.snapshot(), 'legacy-travel', 'UTC'));
  await type(h, 'PRIVATE_SYNTHETIC_INTERPOSE_BASE');
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, 'PRIVATE_SYNTHETIC_VISIBLE_OWN_INPUT');
  assert.equal(h.current.status, 'unsaved');
  const injection = interposeCompetingDraftSave(f); t.after(injection.restore);
  const result = action === 'start' ? await h.current.start('legacy-daily') : action === 'open' ? await h.current.open(other.effect.sessionId) : await h.current[action]();
  injection.restore(); await h.view.settle(); assert.equal(injection.interposed, true);
  assert.equal(result, false, `${action} must not rebind the user action to the competitor's draft`);
  assert.equal(h.current.session!.sessionId, originalId); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_VISIBLE_OWN_INPUT'); assert.equal(h.current.status, 'unsaved');
  const session = currentSession(f, originalId); assert.equal(session.drafts[0].input, 'PRIVATE_SYNTHETIC_INTERPOSED_COMPETITOR');
  assert.equal(session.turns.length, 0); assert.equal(session.operations.length, 0); assert.equal(session.closed, null); assert.equal(f.snapshot().envelope!.sessions.length, 2);
});

for (const action of ['send', 'end'] as const) test(`P2C ${action} refuses an interposed other-lane append that changes the original session head`, async t => {
  const { f, h } = await started(t), id = h.current.session!.sessionId; await type(h, 'PRIVATE_SYNTHETIC_HEAD_BASE');
  f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, 'PRIVATE_SYNTHETIC_VISIBLE_ORIGINAL_HEAD');
  const injection = interposeCompetingDraftSave(f, 'other-lane-append'); t.after(injection.restore);
  const result = await h.current[action](); injection.restore(); await h.view.settle(); assert.equal(injection.interposed, true);
  assert.equal(result, false, `${action} must preserve its original head dependency across awaited draft save`);
  assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_VISIBLE_ORIGINAL_HEAD'); assert.equal(h.current.session!.sessionId, id);
  const session = currentSession(f, id); assert.equal(session.headRevision, 1); assert.equal(session.turns.length, 1); assert.equal(session.turns[0].draft.input, 'PRIVATE_SYNTHETIC_INTERPOSED_COMPETITOR');
  assert.equal(session.closed, null); assert.equal(session.operations.length, 1); assert.equal(session.drafts[0].input, 'PRIVATE_SYNTHETIC_VISIBLE_ORIGINAL_HEAD');
});

for (const action of ['send', 'end'] as const) test(`P2C cached ${action} refuses a peer head that changed before the next render`, async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_CACHED_VISIBLE');
  const id = h.current.session!.sessionId, oldAction = h.current[action], own = currentSession(f, id).drafts[0];
  const other = f.contracts.draftSchema.parse({ ...own, draftId: 'synthetic-unrendered-peer-lane', revision: 1, input: 'PRIVATE_SYNTHETIC_UNRENDERED_PEER_HEAD' });
  await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), id, other));
  const peer = f.facade.captureConversationAppend(f.snapshot(), id, other.draftId); await f.facade.stageConversationIntent(peer); await f.facade.applyConversationIntent(peer);
  // No hook render between the peer commit and invocation of its old callback.
  assert.equal(await oldAction(), false); await h.view.settle(); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_CACHED_VISIBLE');
  const session = currentSession(f, id); assert.equal(session.turns.length, 1); assert.equal(session.turns[0].draft.input, 'PRIVATE_SYNTHETIC_UNRENDERED_PEER_HEAD'); assert.equal(session.closed, null); assert.equal(session.operations.length, 1);
});

for (const navigation of ['start', 'open', 'leave'] as const) test(`P2C ${navigation} refuses a peer other-lane head advance during its awaited preservation save`, async t => {
  const { f, h } = await started(t), id = h.current.session!.sessionId;
  const target = await f.facade.runConversationEdit(f.facade.captureConversationSession(f.snapshot(), 'legacy-travel', 'UTC'));
  await type(h, 'PRIVATE_SYNTHETIC_NAV_HEAD_BASE'); f.browser.rejectNextWrite(f.participants.conversationLocalKey(f.lease.userId)); await type(h, 'PRIVATE_SYNTHETIC_NAV_VISIBLE_HEAD');
  const injection = interposeCompetingDraftSave(f, 'other-lane-append'); t.after(injection.restore);
  const result = navigation === 'start' ? await h.current.start('legacy-daily') : navigation === 'open' ? await h.current.open(target.effect.sessionId) : await h.current.leave();
  injection.restore(); assert.equal(injection.interposed, true); assert.equal(result, false); await h.view.settle();
  assert.equal(h.current.session!.sessionId, id); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_NAV_VISIBLE_HEAD');
  const session = currentSession(f, id); assert.equal(session.turns.length, 1); assert.equal(session.turns[0].draft.input, 'PRIVATE_SYNTHETIC_INTERPOSED_COMPETITOR'); assert.equal(session.closed, null); assert.equal(f.snapshot().envelope!.sessions.length, 2);
});

test('P2C peer overwrite after new-session commit preserves the old editor and the already durable new session', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_OLD_CREATE_VIEW'); const id = h.current.session!.sessionId;
  const original = f.facade.runConversationEdit; let interposed = false;
  Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof original>[0]) {
    const result = await original(intent);
    if (!interposed && intent.kind === 'create' && result.acknowledged && result.source) {
      interposed = true;
      const source = f.facade.readConversationSnapshot(result.source.context), old = source.envelope!.sessions.find(session => session.sessionId === id)!;
      const peer = f.facade.captureConversationDraft(source, id, exactDraft(f, old.drafts[0], 'PRIVATE_SYNTHETIC_PEER_AFTER_CREATE'));
      assert.equal((await original(peer)).acknowledged, true);
    }
    return result;
  } });
  const restore = () => Object.assign(f.facade, { runConversationEdit: original }); t.after(restore);
  const result = await h.current.start('legacy-travel'); restore(); await h.view.settle();
  assert.equal(interposed, true); assert.equal(result, false); assert.equal(h.current.session!.sessionId, id); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_OLD_CREATE_VIEW'); assert.equal(h.current.status, 'unsaved');
  const envelope = f.snapshot().envelope!; assert.equal(envelope.sessions.length, 2); assert.equal(currentSession(f, id).drafts[0].input, 'PRIVATE_SYNTHETIC_PEER_AFTER_CREATE');
  const created = envelope.sessions.find(session => session.sessionId !== id)!; assert.equal(created.source.scriptId, 'legacy-travel'); assert.equal(created.turns.length, 0); assert.equal(created.drafts.length, 0);
});

test('P2C cached cancellation cannot cancel a newer replacement pending operation', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_CANCELLATION_TARGET'); const session = currentSession(f), id = session.sessionId, draftId = session.drafts[0].draftId;
  const first = f.facade.captureConversationAppend(f.snapshot(), id, draftId); await f.facade.stageConversationIntent(first);
  const staleCancel = h.current.cancelPending;
  await f.facade.runConversationEdit(f.facade.captureConversationCancellation(f.snapshot(), id, first.command.operationId));
  const second = f.facade.captureConversationAppend(f.snapshot(), id, draftId); await f.facade.stageConversationIntent(second);
  const writes = f.browser.writes.length; assert.equal(await staleCancel(), false); assert.equal(f.browser.writes.length, writes);
  const operations = currentSession(f, id).operations; assert.equal(operations[0].terminal!.kind, 'cancelled'); assert.equal(operations[1].command.operationId, second.command.operationId); assert.equal(operations[1].terminal, null);
  assert.equal(currentSession(f, id).turns.length, 0); await h.view.settle(); assert.equal(await h.current.cancelPending(), true); assert.equal(currentSession(f, id).operations[1].terminal!.kind, 'cancelled');
});

test('P2C unknown new-session recovery acknowledges creation without hiding an old editor changed by a peer', async t => {
  const { f, h } = await started(t); await type(h, 'PRIVATE_SYNTHETIC_OLD_UNKNOWN_CREATE'); const originalId = h.current.session!.sessionId;
  const restore = unknownAfterMarker(f); t.after(restore); assert.equal(await h.current.start('legacy-travel'), false); restore(); await h.view.settle();
  assert.equal(h.current.status, 'uncertain'); const created = f.snapshot().envelope!.sessions.find(session => session.sessionId !== originalId)!; assert.ok(created);
  const old = currentSession(f, originalId).drafts[0];
  await f.facade.runConversationEdit(f.facade.captureConversationDraft(f.snapshot(), originalId, exactDraft(f, old, 'PRIVATE_SYNTHETIC_PEER_DURING_CREATE_RECOVERY')));
  const writes = f.browser.writes.length; assert.equal(await h.current.recover(), true); await h.view.settle(); assert.equal(f.browser.writes.length, writes);
  assert.equal(h.current.session!.sessionId, originalId); assert.equal(h.current.input, 'PRIVATE_SYNTHETIC_OLD_UNKNOWN_CREATE'); assert.equal(h.current.status, 'unsaved');
  assert.equal(currentSession(f, originalId).drafts[0].input, 'PRIVATE_SYNTHETIC_PEER_DURING_CREATE_RECOVERY');
  assert.equal(f.snapshot().envelope!.sessions.length, 2); assert.equal(currentSession(f, created.sessionId).source.scriptId, 'legacy-travel'); assert.equal(currentSession(f, created.sessionId).turns.length, 0);
});
