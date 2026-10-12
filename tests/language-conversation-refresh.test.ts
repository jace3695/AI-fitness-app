import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { conversationSessionFixture } from './helpers/conversationSessionFixture.ts';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, languageSyncAckKey, languageSyncBaseKey, projectLanguageBytes } from '../app/data/languageStorageBoundary.ts';
import { CLOUD_SESSION_CHANGED_EVENT, STORAGE_JOURNAL_KEY, STORAGE_OWNER_KEY, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY } from '../app/data/storageTransaction.ts';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT } from '../app/data/appRecordReset.ts';
import type { ConversationEnvelope } from '../lib/conversation-session/contracts.ts';

type Fixture = Awaited<ReturnType<typeof conversationSessionFixture>>;
type Hook = ReturnType<typeof import('../components/language/useConversationSession.ts')['useConversationSession']>;
const input = '  PRIVATE_REFRESH_ONLY 日本語\t👩🏽‍💻\n  ';
const wire = { savedWords: '["existing uploaded word"]', unknownRemoteField: { kept: true } };
const json = (value: unknown) => JSON.stringify(value);
const reads = (f: Fixture) => f.calls.filter(call => call.kind === 'read').length;
const uploads = (f: Fixture) => f.calls.filter(call => call.kind !== 'read').map(call => call.payload.state);
const privateBytes = (f: Fixture) => f.tab.local.getItem(f.participants.conversationLocalKey(f.lease.userId));
const selection = () => Object.assign(Object.create(null) as { kind: 'guided'; scriptId: string; scriptRevision: string }, {
  kind: 'guided' as const, scriptId: GUIDED_CONVERSATION_PILOT[1].scriptId, scriptRevision: GUIDED_CONVERSATION_PILOT[1].scriptRevision,
});
async function fixture(t: TestContext, marker?: string) {
  const markerBytes = marker ? { [LANGUAGE_MARKER_KEY]: marker } : {};
  const f = await conversationSessionFixture({ savedWords: wire.savedWords, ...markerBytes }); t.after(f.dispose);
  f.setRemote({ ...wire, ...markerBytes });
  await f.refresh();
  const h = f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  await h.view.settle();
  assert.equal(f.tab.pendingTimers, 0);
  return { f, h };
}
async function flush(f: Fixture, h: Awaited<ReturnType<typeof fixture>>['h']) {
  // Only one-shot timers run here: no focus, visibility, 30-second remote poll,
  // synthetic manual coordinator call, or browser automation is involved.
  f.tab.flushTimers(); await h.view.settle();
}
async function start(f: Fixture, h: Awaited<ReturnType<typeof fixture>>['h']) {
  assert.equal(await h.current.start(selection()), true); await h.view.settle();
  await flush(f, h);
}
async function type(h: Awaited<ReturnType<typeof fixture>>['h']) {
  h.current.typeInput(input); await h.view.settle();
  assert.equal(h.current.input, input); assert.equal(h.current.status, 'saved');
}

// AuthGate, LanguageCloudSync, coordinator, transaction notification, private
// facade and conversation hook are shipped code. Timers, DOM, React host and
// remote SDK are synthetic; this does not prove the historical WebKit trigger.
for (const action of ['start', 'draft', 'append'] as const) test(`private conversation ${action} leaves language refresh scheduling and context unchanged`, async t => {
  const { f, h } = await fixture(t);
  if (action !== 'start') await start(f, h);
  if (action === 'append') { await type(h); await flush(f, h); }
  const context = f.context, generation = f.tab.transactions.readStorageSnapshot(f.tab.local).generation;
  const acknowledgement = f.tab.local.getItem(languageSyncAckKey(f.lease.userId));
  const readCount = reads(f), uploaded = json(uploads(f)), language = json(projectLanguageBytes(f.tab.local));
  const before = privateBytes(f), notices = f.notices.length;
  if (action === 'start') { assert.equal(await h.current.start(selection()), true); await h.view.settle(); }
  else if (action === 'draft') await type(h);
  else { assert.equal(await h.current.send(), true); await h.view.settle(); }
  const after = privateBytes(f); assert.notEqual(after, before);
  assert.notEqual(f.tab.transactions.readStorageSnapshot(f.tab.local).generation, generation, 'Private commits advance the shared transaction generation');
  assert.ok(f.notices.length > notices, 'The real transaction reaches the registered records-change listener');
  assert.equal(json(projectLanguageBytes(f.tab.local)), language, 'Private commits change no language-upload-owned bytes');
  assert.equal(f.language.isLanguageRecordContextCurrent(context), true, 'Private writes alone preserve authority');
  const checkCurrent = h.current.checkCurrent, scheduled = f.tab.pendingTimers;
  await flush(f, h);
  // Compare all effects together so a red result identifies scheduling, the GET,
  // context replacement and stale hook closure, rather than just a timer count.
  assert.deepEqual({
    scheduled, extraReads: reads(f) - readCount, sameContext: f.context === context,
    originalContextCurrent: f.language.isLanguageRecordContextCurrent(context), capturedHookCurrent: checkCurrent(),
    sameAcknowledgement: f.tab.local.getItem(languageSyncAckKey(f.lease.userId)) === acknowledgement,
    exactPrivateBytes: privateBytes(f) === after, exactLanguageBytes: json(projectLanguageBytes(f.tab.local)) === language,
    exactUploadBytes: json(uploads(f)) === uploaded, exactRemoteBytes: json(f.remoteState()) === json(wire),
    pendingTimers: f.tab.pendingTimers,
  }, {
    scheduled: 0, extraReads: 0, sameContext: true, originalContextCurrent: true, capturedHookCurrent: true, sameAcknowledgement: true,
    exactPrivateBytes: true, exactLanguageBytes: true, exactUploadBytes: true, exactRemoteBytes: true, pendingTimers: 0,
  });
  assert.doesNotMatch(json(uploads(f)), /PRIVATE_REFRESH_ONLY|yeoni-conversation-local/);
});

test('private autosave does not temporarily hide a saved guided editor behind a needless pending GET', async t => {
  const { f, h } = await fixture(t); await start(f, h);
  const context = f.context, readCount = reads(f);
  await type(h);
  const before = privateBytes(f), held = f.holdRead();
  await flush(f, h);
  const during = { extraReads: reads(f) - readCount, available: h.current.available, status: h.current.status,
    exactInput: h.current.input === input, exactPrivateBytes: privateBytes(f) === before };
  held.resolve({ data: { state: wire, updated_at: 'synthetic-held-private-read' }, error: null });
  await h.view.settle();
  assert.equal(privateBytes(f), before); assert.equal(h.current.input, input); assert.equal(h.current.status, 'saved');
  assert.deepEqual({ ...during, sameContextAfter: f.context === context }, {
    extraReads: 0, available: true, status: 'saved', exactInput: true, exactPrivateBytes: true, sameContextAfter: true,
  });
});

test('real language-upload-owned change still schedules exact upload and retires previous context', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, before = privateBytes(f), readCount = reads(f), writeCount = uploads(f).length;
  const savedWords = '["existing uploaded word","new upload-owned word"]';
  await f.language.updateLanguageRecords(context, () => ({ savedWords })); await h.view.settle();
  assert.equal(f.tab.pendingTimers, 1); assert.equal(reads(f), readCount);
  await flush(f, h);
  assert.equal(reads(f), readCount + 2, 'Read-first plus exact post-write readback');
  assert.equal(uploads(f).length, writeCount + 1);
  assert.deepEqual(JSON.parse(json(uploads(f).at(-1))), { ...wire, savedWords });
  assert.deepEqual(JSON.parse(json(f.remoteState())), { ...wire, savedWords });
  assert.equal(privateBytes(f), before); assert.notEqual(f.context, context);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
  assert.equal(h.current.input, input); assert.equal(h.current.status, 'saved'); assert.equal(f.tab.pendingTimers, 0);
  assert.doesNotMatch(json(uploads(f)), /PRIVATE_REFRESH_ONLY|yeoni-conversation-local/);
});

test('explicit focus still reads unchanged server and retires old authority without rewriting private bytes', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, before = privateBytes(f), readCount = reads(f), uploaded = json(uploads(f));
  const oldCheck = h.current.checkCurrent;
  await f.refresh(); await h.view.settle();
  assert.equal(reads(f), readCount + 1); assert.notEqual(f.context, context);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false); assert.equal(oldCheck(), false);
  assert.equal(privateBytes(f), before); assert.equal(json(uploads(f)), uploaded);
  assert.equal(h.current.input, input); assert.equal(h.current.status, 'saved'); assert.equal(f.tab.pendingTimers, 0);
});

const controlKeys = [null, STORAGE_JOURNAL_KEY, STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY,
  LANGUAGE_BINDING_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_MARKER_KEY, RECORD_RESET_STORAGE_EVENT,
  languageSyncBaseKey('synthetic-owner-a'), languageSyncAckKey('synthetic-owner-a')];
for (const key of controlKeys) test(`language control storage event ${String(key)} still revokes conversation authority synchronously`, async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, before = privateBytes(f), readCount = reads(f), oldSave = h.current.save;
  f.tab.dispatch({ type: 'storage', key });
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
  await h.view.settle(); assert.equal(h.current.available, false); assert.equal(await oldSave(), false);
  await flush(f, h); assert.equal(reads(f), readCount); assert.equal(privateBytes(f), before);
});

for (const event of [CLOUD_SESSION_CHANGED_EVENT, RECORD_RESET_EVENT]) test(`${event} still revokes old context and hook actions immediately`, async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, before = privateBytes(f), oldSend = h.current.send;
  f.tab.dispatch({ type: event });
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false); assert.equal(await oldSend(), false);
  await h.view.settle(); assert.equal(privateBytes(f), before);
});

test('authenticated owner switch still retires original context and captured private actions', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, owner = f.lease.userId, key = f.participants.conversationLocalKey(owner), before = f.tab.local.getItem(key), oldSend = h.current.send;
  await f.switchOwner('synthetic-other-owner'); await h.view.settle();
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false); assert.equal(await oldSend(), false);
  assert.equal(h.current.input, ''); assert.equal(h.current.sessions.length, 0); assert.equal(f.tab.local.getItem(key), before);
});

test('authenticated remote reset still replaces private generation and cannot revive pre-reset input', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, generation = f.snapshot().envelope!.generationId, oldSend = h.current.send;
  const marker = '2026-10-11T00:00:00.000Z|11111111-1111-4111-8111-111111111111';
  f.setRemote({ ...wire, [LANGUAGE_MARKER_KEY]: marker }); await f.refresh(); await h.view.settle();
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false); assert.equal(await oldSend(), false);
  assert.notEqual(f.snapshot().envelope!.generationId, generation); assert.equal(f.snapshot().envelope!.marker, marker);
  assert.equal(f.snapshot().envelope!.sessions.length, 0); assert.equal(h.current.input, ''); assert.equal(h.current.sessions.length, 0);
});

for (const corrupt of ['malformed', 'unsupported'] as const) test(`${corrupt} private partition still fails closed even when language upload bytes are unchanged`, async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, key = f.participants.conversationLocalKey(f.lease.userId);
  const language = json(projectLanguageBytes(f.tab.local)), readCount = reads(f), uploaded = json(uploads(f));
  const invalid = corrupt === 'malformed' ? '{broken' : json({ ...JSON.parse(privateBytes(f)!), schemaVersion: 999 });
  // A corruption fault is injected through the real transaction so its generic
  // records event and generation marker take the same route as a private write.
  await f.tab.transactions.updateStorageBatch(f.tab.local, () => ({ [key]: invalid }), { owner: f.lease });
  await h.view.settle(); await flush(f, h);
  assert.equal(json(projectLanguageBytes(f.tab.local)), language); assert.equal(f.tab.local.getItem(key), invalid);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false, 'Unchanged upload bytes must not preserve authority over an invalid private partition');
  assert.equal(h.current.available, false); assert.equal(h.current.input, ''); assert.equal(await h.current.send(), false);
  assert.equal(reads(f), readCount); assert.equal(json(uploads(f)), uploaded); assert.equal(json(f.remoteState()), json(wire));
});

test('valid foreign-owner private partition at current-owner key still revokes without remote dispatch', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, key = f.participants.conversationLocalKey(f.lease.userId), foreignOwner = 'synthetic-foreign-owner';
  const language = json(projectLanguageBytes(f.tab.local)), readCount = reads(f), uploaded = json(uploads(f));
  const envelope = JSON.parse(privateBytes(f)!) as ConversationEnvelope;
  assert.equal(envelope.enrollment.kind, 'explicit-enrollment'); assert.ok(envelope.enrollment.observation);
  assert.equal(envelope.sessions[0].operations.length, 0); assert.equal(envelope.sessions[0].closed, null);
  envelope.ownerId = foreignOwner; envelope.enrollment.observation.ownerId = foreignOwner;
  const misplaced = f.contracts.canonicalJson(envelope);
  assert.equal(f.contracts.parseEnvelope(misplaced).status, 'valid', 'The owner fault is not a schema/coherence failure');
  assert.equal(f.participants.readConversationPartition(misplaced, foreignOwner)!.ownerId, foreignOwner);
  assert.throws(() => f.participants.readConversationPartition(misplaced, f.lease.userId), { code: 'invalid-partition' });
  await f.tab.transactions.updateStorageBatch(f.tab.local, () => ({ [key]: misplaced }), { owner: f.lease });
  await h.view.settle(); await flush(f, h);
  assert.equal(json(projectLanguageBytes(f.tab.local)), language); assert.equal(f.tab.local.getItem(key), misplaced);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
  assert.equal(h.current.available, false); assert.equal(h.current.input, ''); assert.equal(await h.current.send(), false);
  assert.equal(reads(f), readCount); assert.equal(json(uploads(f)), uploaded); assert.equal(json(f.remoteState()), json(wire));
});

test('valid private marker mismatch still schedules remote reconciliation and blocks conflicting authority', async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, key = f.participants.conversationLocalKey(f.lease.userId);
  const language = json(projectLanguageBytes(f.tab.local)), readCount = reads(f), uploaded = json(uploads(f));
  const envelope = JSON.parse(privateBytes(f)!) as ConversationEnvelope;
  assert.equal(envelope.enrollment.kind, 'explicit-enrollment'); assert.ok(envelope.enrollment.observation);
  assert.equal(envelope.sessions[0].operations.length, 0); assert.equal(envelope.sessions[0].closed, null);
  const marker = '2026-10-11T00:00:00.000Z|22222222-2222-4222-8222-222222222222';
  envelope.marker = marker; envelope.enrollment.observation.marker = marker;
  const mismatched = f.contracts.canonicalJson(envelope);
  assert.equal(f.contracts.parseEnvelope(mismatched).status, 'valid', 'Every internal observation agrees with the partition marker');
  assert.equal(f.participants.readConversationPartition(mismatched, f.lease.userId)!.marker, marker);
  await f.tab.transactions.updateStorageBatch(f.tab.local, () => ({ [key]: mismatched }), { owner: f.lease });
  await h.view.settle();
  assert.equal(f.tab.pendingTimers, 1, 'A participant marker change remains relevant even without upload-owned byte changes');
  await flush(f, h);
  assert.equal(reads(f), readCount + 1, 'The existing read-first reconciliation checks the authenticated server marker');
  assert.equal(json(projectLanguageBytes(f.tab.local)), language); assert.equal(f.tab.local.getItem(key), mismatched);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
  assert.equal(h.current.available, false); assert.equal(h.current.input, ''); assert.equal(await h.current.send(), false);
  assert.equal(json(uploads(f)), uploaded); assert.equal(json(f.remoteState()), json(wire)); assert.equal(f.tab.pendingTimers, 0);
});

test('first private enrollment at a non-null language reset marker is refresh-neutral', async t => {
  const marker = '2026-10-11T00:00:00.000Z|33333333-3333-4333-8333-333333333333';
  const { f, h } = await fixture(t, marker), context = f.context, readCount = reads(f);
  const language = json(projectLanguageBytes(f.tab.local)), uploaded = json(uploads(f)), remote = json(f.remoteState());
  assert.equal(f.snapshot().envelope, null);
  assert.equal(await h.current.start(selection()), true); await h.view.settle();
  const before = privateBytes(f), scheduled = f.tab.pendingTimers;
  assert.equal(f.snapshot().envelope!.marker, marker);
  assert.equal(f.snapshot().envelope!.enrollment.observation!.marker, marker);
  await flush(f, h);
  assert.equal(privateBytes(f), before); assert.equal(json(projectLanguageBytes(f.tab.local)), language);
  assert.equal(json(uploads(f)), uploaded); assert.equal(json(f.remoteState()), remote);
  assert.deepEqual({ scheduled, extraReads: reads(f) - readCount, sameContext: f.context === context,
    originalContextCurrent: f.language.isLanguageRecordContextCurrent(context) }, {
    scheduled: 0, extraReads: 0, sameContext: true, originalContextCurrent: true,
  });
});

test('existing valid null-marker private partition still reconciles to the non-null authenticated language marker', async t => {
  const marker = '2026-10-11T00:00:00.000Z|44444444-4444-4444-8444-444444444444';
  const { f, h } = await fixture(t, marker); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, key = f.participants.conversationLocalKey(f.lease.userId), readCount = reads(f);
  const language = json(projectLanguageBytes(f.tab.local)), uploaded = json(uploads(f)), remote = json(f.remoteState());
  const envelope = JSON.parse(privateBytes(f)!) as ConversationEnvelope;
  assert.equal(envelope.enrollment.kind, 'explicit-enrollment'); assert.ok(envelope.enrollment.observation);
  const generation = envelope.generationId; envelope.marker = null; envelope.enrollment.observation.marker = null;
  const stale = f.contracts.canonicalJson(envelope);
  assert.equal(f.contracts.parseEnvelope(stale).status, 'valid');
  assert.equal(f.participants.readConversationPartition(stale, f.lease.userId)!.marker, null);
  await f.tab.transactions.updateStorageBatch(f.tab.local, () => ({ [key]: stale }), { owner: f.lease });
  await h.view.settle(); assert.equal(f.tab.pendingTimers, 1);
  await flush(f, h);
  assert.equal(reads(f), readCount + 1); assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
  assert.notEqual(f.snapshot().envelope!.generationId, generation); assert.equal(f.snapshot().envelope!.marker, marker);
  assert.equal(f.snapshot().envelope!.enrollment.kind, 'reset-replacement'); assert.equal(f.snapshot().envelope!.sessions.length, 0);
  assert.equal(h.current.available, true); assert.equal(h.current.input, ''); assert.equal(h.current.sessions.length, 0);
  assert.equal(json(projectLanguageBytes(f.tab.local)), language); assert.equal(json(uploads(f)), uploaded);
  assert.equal(json(f.remoteState()), remote); assert.equal(f.tab.pendingTimers, 0);
});

for (const key of [STORAGE_OWNER_KEY, LANGUAGE_OWNER_KEY]) test(`same-tab generic transaction notice for corrupt ${key} still retires language access`, async t => {
  const { f, h } = await fixture(t); await start(f, h); await type(h); await flush(f, h);
  const context = f.context, lease = f.lease, privateKey = f.participants.conversationLocalKey(lease.userId);
  const before = f.tab.local.getItem(privateKey), language = json(projectLanguageBytes(f.tab.local)), readCount = reads(f), uploaded = json(uploads(f));
  const notices = f.notices.length;
  if (key === STORAGE_OWNER_KEY) {
    // Public writers reject this reserved key. Inject a host corruption exactly
    // after a real unrelated transaction's durable marker, before its generic
    // notification. There is no native storage event or auth event in this test.
    const setItem = f.tab.local.setItem; let injected = false;
    f.tab.local.setItem = (name, value) => {
      setItem(name, value);
      if (!injected && name === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"')) {
        injected = true; setItem(key, 'synthetic-wrong-owner');
      }
    };
    try {
      const receipt = await f.tab.transactions.updateStorageBatchWithReceipt(f.tab.local, () => ({ 'synthetic-other-private-record': 'changed' }), { owner: lease });
      assert.equal(receipt.ownerCurrent, false); assert.equal(injected, true);
    } finally { f.tab.local.setItem = setItem; }
    // Check before rendering or an explicit authority predicate could itself
    // discover the damaged owner and hide a missing notification response.
    assert.equal(context.signal.aborted, true);
  } else {
    await f.tab.transactions.updateStorageBatch(f.tab.local, () => ({ [key]: 'synthetic-wrong-owner' }), { owner: lease });
    assert.equal(f.tab.pendingTimers, 1, 'The changed language owner remains in the scheduling fingerprint');
  }
  assert.ok(f.notices.length > notices);
  await h.view.settle(); await flush(f, h);
  assert.equal(f.language.isLanguageRecordContextCurrent(context), false); assert.equal(h.current.available, false);
  assert.doesNotMatch(f.sync.text(), /학습 기록 · 서버 저장 확인/);
  assert.equal(f.tab.local.getItem(privateKey), before); assert.equal(json(projectLanguageBytes(f.tab.local)), language);
  assert.equal(reads(f), readCount); assert.equal(json(uploads(f)), uploaded); assert.equal(json(f.remoteState()), json(wire));
});
