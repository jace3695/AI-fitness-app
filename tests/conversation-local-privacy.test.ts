import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { readLocalCloudState } from '../app/data/cloudSync.ts';
import { projectLanguageBytes, LANGUAGE_STORAGE_KEYS, LANGUAGE_MARKER_KEY } from '../app/data/languageStorageBoundary.ts';
import { readStorageSnapshot, STORAGE_PROTOCOL_KEY, STORAGE_JOURNAL_KEY, STORAGE_GENERATION_KEY, updateStorageBatchWithReceipt, StorageWriteAttemptError } from '../app/data/storageTransaction.ts';
import { languageFixture } from './helpers/languageFixture.ts';
import { conversationLocalKey, readConversationPartition } from '../app/data/languageLocalParticipants.ts';
import { commitLanguageSyncResponse, readLanguageSyncRequest, planLanguageSync } from '../app/data/languageCloudSync.ts';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { GUIDED_CONVERSATION_REMAINING } from '../data/guidedConversationCatalog.ts';
import { canonicalJson, type ConversationEnvelope } from '../lib/conversation-session/contracts.ts';
import { base, emptySession, draft, save, commit, stage, append, getSession, TIME } from '../lib/conversation-session/fixtures.test-support.ts';

const poison = {
  transcript: 'PRIVATE_SYNTHETIC_TRANSCRIPT_725AF',
  draft: 'PRIVATE_SYNTHETIC_DRAFT_649BE',
  staged: 'PRIVATE_SYNTHETIC_STAGED_COMMAND_126CD',
  receipt: 'PRIVATE_SYNTHETIC_RECEIPT_PAYLOAD_891DE',
  corrupt: 'PRIVATE_SYNTHETIC_CORRUPT_BYTES_255EF',
  journal: 'PRIVATE_SYNTHETIC_PREPARED_JOURNAL_671FA',
};
function assertNoPrivate(value: unknown) {
  const raw = JSON.stringify(value);
  for (const canary of Object.values(poison)) assert.ok(!raw.includes(canary), `Private synthetic canary escaped: ${canary}`);
}
const privateRaw = JSON.stringify(poison);
function projectAll(storage: Parameters<typeof readStorageSnapshot>[0]) {
  const snapshot = readStorageSnapshot(storage);
  const exports = { cloud: readLocalCloudState(), directCloud: readLocalCloudState(storage), language: projectLanguageBytes(snapshot) };
  assertNoPrivate(exports);
  assert.deepEqual(exports.cloud, { 'ai-fitness-synthetic-safe': { kept: true } });
  assert.deepEqual(exports.language, { savedWords: '["synthetic safe legacy word"]' });
  for (const reserved of [STORAGE_PROTOCOL_KEY, STORAGE_JOURNAL_KEY, STORAGE_GENERATION_KEY]) assert.equal(snapshot.getItem(reserved), null);
  return exports;
}

type TestElement = { type: unknown; props: { children?: unknown; onClick?: () => void } };
function renderBackup() {
  const downloads: Blob[] = [], notices: unknown[] = [];
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': jsx,
    react: { useRef: () => ({ current: null }), useState: (initial: unknown) => [initial, (value: unknown) => notices.push(value)] },
    '../data/storageTransaction': {},
    '../data/cloudSync': { readLocalCloudState, restoreCloudBackup() { throw new Error('Unexpected restore'); } },
  };
  const source = ts.transpileModule(readFileSync(new URL('../app/components/DataBackupPanel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const api = {} as { default(): unknown };
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Date, Blob, URL: { createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:synthetic-conversation-privacy'; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
    window: { setTimeout: (callback: () => void) => callback() },
  })(api, (name: string) => { assert.ok(name in modules, name); return modules[name]; });
  function find(value: unknown): TestElement | undefined {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    const element = value as TestElement;
    if (element.type === 'button' && element.props.children === '운동·식단 기록 백업') return element;
    return find(element.props?.children);
  }
  const button = find(api.default()); assert.ok(button); button.props.onClick!();
  return { downloads, notices };
}

function seedPrivacy(participantKey: string) {
  return {
    'ai-fitness-synthetic-safe': '{"kept":true}',
    savedWords: '["synthetic safe legacy word"]',
    [participantKey]: privateRaw,
  };
}
function installPrepared(storage: Parameters<typeof readStorageSnapshot>[0] & Pick<Storage, 'setItem'>, key: string) {
  storage.setItem(key, `partial replacement ${poison.draft}`);
  storage.setItem(STORAGE_PROTOCOL_KEY, JSON.stringify({
    version: 2, state: 'prepared', generation: 'synthetic-generation', transactionId: poison.journal,
    before: { [key]: privateRaw, 'synthetic-private-malformed': poison.corrupt },
  }));
}
const participantKey = conversationLocalKey('a');
async function privacyFixture() {
  const f = languageFixture(); await f.owner('a');
  for (const [key, value] of Object.entries(seedPrivacy(participantKey))) f.values.set(key, value);
  f.values.set(conversationLocalKey('synthetic-corrupt-other-owner'), poison.corrupt);
  return f;
}
function canaryEnvelope(): ConversationEnvelope {
  let envelope: ConversationEnvelope = { ...base(), ownerId: 'a', sessions: [emptySession()],
    enrollment: { kind: 'explicit-enrollment', enrollmentId: 'synthetic-enrollment', createdAt: TIME,
      observation: { kind: 'authenticated-remote-observation-received', requestId: 'read', ownerId: 'a', ownerEpochId: 'epoch', lifecycleId: 'life', marker: null, receivedAt: TIME } } };
  envelope = save(envelope, draft('transcript-draft', poison.transcript));
  const applied = { ...append(envelope), receiptId: poison.receipt }; envelope = commit(envelope, applied);
  envelope = save(envelope, draft('surviving-draft', poison.draft));
  envelope = save(envelope, draft('staged-draft', poison.staged));
  envelope = stage(envelope, append(envelope, 'second-operation', getSession(envelope).drafts.find(value => value.draftId === 'staged-draft')!));
  assert.ok(readConversationPartition(canonicalJson(envelope), 'a')); return envelope;
}

test('P2B local conversation and protocol namespaces never expand the 16-key language or generic cloud allowlists', () => {
  assert.equal(LANGUAGE_STORAGE_KEYS.length, 16);
  assert.ok(!LANGUAGE_STORAGE_KEYS.includes(participantKey as never)); assert.ok(!participantKey.startsWith('ai-fitness-'));
  assert.ok(!participantKey.startsWith('language-cloud-sync-')); assert.notEqual(participantKey, LANGUAGE_MARKER_KEY);
  const resetKeys = readFileSync(new URL('../app/data/appRecordReset.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(resetKeys, /yeoni-conversation-local|conversationLocalKey/);
});

for (const mode of ['ordinary', 'prepared', 'legacy journal'] as const) test(`P2B ${mode} cloud and language projections omit transcript/draft/stage/receipt/corrupt/journal canaries`, async t => {
  const f = await privacyFixture(); t.after(f.restore);
  if (mode === 'prepared') installPrepared(f.storage, participantKey);
  if (mode === 'legacy journal') f.storage.setItem(STORAGE_JOURNAL_KEY, JSON.stringify({ [participantKey]: privateRaw, 'synthetic-private-journal': poison.journal }));
  projectAll(f.storage);
});

for (const mode of ['ordinary', 'prepared', 'legacy journal'] as const) test(`P2B shipping backup download excludes every private canary in ${mode} storage`, async t => {
  const f = await privacyFixture(); t.after(f.restore);
  if (mode === 'prepared') installPrepared(f.storage, participantKey);
  if (mode === 'legacy journal') f.storage.setItem(STORAGE_JOURNAL_KEY, JSON.stringify({ [participantKey]: privateRaw, 'synthetic-private-journal': poison.journal }));
  const before = new Map(f.values), backup = renderBackup(); assert.equal(backup.downloads.length, 1);
  const raw = await backup.downloads[0].text(); assertNoPrivate(raw); assertNoPrivate(backup.notices);
  const parsed = JSON.parse(raw); assert.deepEqual(parsed.state, { 'ai-fitness-synthetic-safe': { kept: true } }); assert.equal(parsed.app, 'AI-fitness-app');
  assert.deepEqual(f.values, before);
});

for (const mode of ['rollback', 'unknown'] as const) test(`P2B ${mode} transaction outcome cannot leak private before-images through exports or backup`, async t => {
  const f = await privacyFixture(); t.after(f.restore); const set = f.storage.setItem;
  let calls = 0;
  f.storage.setItem = (key, value) => {
    if (key === participantKey && (++calls === 1 || mode === 'unknown')) throw new Error('synthetic quota');
    set(key, value);
  };
  await assert.rejects(updateStorageBatchWithReceipt(f.storage, () => ({ [participantKey]: `new ${poison.staged}` })), error => {
    assert.ok(error instanceof StorageWriteAttemptError); assert.equal(error.outcome, mode === 'unknown' ? 'unknown' : 'not-committed'); return true;
  });
  assert.equal(readStorageSnapshot(f.storage).pending, mode === 'unknown');
  assert.equal(readStorageSnapshot(f.storage).getItem(participantKey), privateRaw); projectAll(f.storage);
  const backup = renderBackup(); assert.equal(backup.downloads.length, 1); assertNoPrivate(await backup.downloads[0].text());
});

test('P2B language upload planning preserves unknown server fields without substituting identically named local participant data', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request('a');
  f.values.set(participantKey, canonicalJson(canaryEnvelope()));
  f.values.set(conversationLocalKey('synthetic-corrupt-other-owner'), poison.corrupt);
  const unknown = { remote_only_field: { preserved: [null, { revision: 17 }] }, [participantKey]: 'server-existing-opaque-value' };
  await commitLanguageSyncResponse(request, { ...unknown, savedWords: '["safe old"]' });
  await updateStorageBatchWithReceipt(f.storage, () => ({ savedWords: '["safe new"]' }));
  const plan = planLanguageSync(readLanguageSyncRequest(lease, lifecycle, f.storage), { ...unknown, savedWords: '["safe old"]' });
  assert.equal(plan.kind, 'write'); assert.equal(plan.wire.savedWords, '["safe new"]');
  assert.deepEqual(plan.wire.remote_only_field, unknown.remote_only_field); assert.equal(plan.wire[participantKey], 'server-existing-opaque-value');
  assertNoPrivate(plan); assertNoPrivate(readLocalCloudState()); assertNoPrivate(projectLanguageBytes(readStorageSnapshot(f.storage)));
});

test('P2B shipping coordinator upload and readback preserve server unknown fields while private sessions stay device-local', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, request } = await f.request('a');
  let remote: Record<string, unknown> = { savedWords: '["safe old"]', server_field: { preserved: true } };
  await commitLanguageSyncResponse(request, remote); f.values.set(participantKey, canonicalJson(canaryEnvelope()));
  f.values.set(conversationLocalKey('synthetic-corrupt-other-owner'), poison.corrupt);
  await updateStorageBatchWithReceipt(f.storage, () => ({ savedWords: '["safe new"]' }));
  const sent: Record<string, unknown>[] = [], states: unknown[] = [], notifications: unknown[] = [];
  f.window.addEventListener('yeoni-records-changed', event => notifications.push({ type: event.type, detail: (event as CustomEvent).detail }));
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState: state => states.push(state), transport: {
    async verifyOwner() { return true; }, async read() { return { state: remote, updatedAt: 'synthetic-remote-time' }; },
    async insert() { assert.fail('Unexpected insert'); },
    async update(_owner, wire) { assert.equal(f.locks.active, 0); sent.push(wire); remote = wire; return true; },
  } }); t.after(coordinator.dispose);
  await coordinator.start(); await Promise.resolve(); assert.equal(coordinator.getState().status, 'ready'); assert.equal(sent.length, 1);
  assert.deepEqual(remote.server_field, { preserved: true }); assert.equal(remote.savedWords, '["safe new"]');
  assertNoPrivate(sent); assertNoPrivate(states); assertNoPrivate(notifications); assert.ok(notifications.length > 0);
  assert.ok(f.storage.getItem(participantKey)?.includes(poison.transcript));
});

for (const mode of ['corrupt parser', 'host read', 'host replacement'] as const) test(`P2B coordinator ${mode} diagnostics expose no private raw content or host exception`, async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, request } = await f.request('a');
  await commitLanguageSyncResponse(request, {}); f.values.set(participantKey, mode === 'corrupt parser' ? poison.corrupt : canonicalJson(canaryEnvelope()));
  const states: unknown[] = []; let calls = 0;
  if (mode === 'host read') { const get = f.storage.getItem; f.storage.getItem = key => { if (key === participantKey) throw new Error(privateRaw); return get(key); }; }
  if (mode === 'host replacement') { const set = f.storage.setItem; f.storage.setItem = (key, value) => { if (key === STORAGE_PROTOCOL_KEY) throw new Error(privateRaw); set(key, value); }; }
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState: state => states.push(state), transport: {
    async verifyOwner() { return true; }, async read() { calls++; return { state: {}, updatedAt: 'synthetic-time' }; },
    async insert() { assert.fail('Unexpected insert'); }, async update() { assert.fail('Unexpected update'); },
  } }); t.after(coordinator.dispose);
  await coordinator.start(); assert.notEqual(coordinator.getState().status, 'ready'); assertNoPrivate(states);
  assert.equal(calls, mode === 'host replacement' ? 1 : 0);
});

test('P2C shipping hook input/send/close and SDK wakeups never export conversation text, drafts, namespace or event payload', async t => {
  const { conversationSessionFixture } = await import('./helpers/conversationSessionFixture.ts');
  const f = await conversationSessionFixture(); t.after(f.dispose);
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  assert.equal(await h.current.start('legacy-cafe'), true);
  h.current.typeInput(poison.transcript); await h.view.settle(); assert.equal(await h.current.send(), true);
  h.current.typeInput(poison.draft); await h.view.settle(); assert.equal(await h.current.end(), true);
  const key = f.participants.conversationLocalKey(f.lease.userId), raw = f.tab.local.getItem(key)!;
  assert.ok(raw.includes(poison.transcript)); assert.ok(raw.includes(poison.draft));
  await f.refresh(); await h.view.settle(); assertNoPrivate(f.calls); assertNoPrivate(f.notices); assertNoPrivate(f.diagnostics);
  assert.doesNotMatch(JSON.stringify(f.calls), /yeoni-conversation-local-v1/); assert.equal(f.audio.length, 0);
  const boundary = f.tab.loadModule('app/data/languageStorageBoundary.ts') as typeof import('../app/data/languageStorageBoundary.ts');
  assertNoPrivate(boundary.projectLanguageBytes(f.tab.transactions.readStorageSnapshot(f.tab.local)));
  assertNoPrivate(f.tab.cloud.readLocalCloudState());
  const backup = f.tab.mount('app/components/DataBackupPanel.tsx'); t.after(backup.dispose); backup.click('운동·식단 기록 백업');
  assert.equal(f.tab.downloads.length, 1); assertNoPrivate(await f.tab.downloads[0].text()); assert.doesNotMatch(await f.tab.downloads[0].text(), /yeoni-conversation-local-v1/);
});

test('P2C shipping unknown-write UI diagnostics and prepared bytes keep poison text device-local', async t => {
  const { conversationSessionFixture } = await import('./helpers/conversationSessionFixture.ts');
  const f = await conversationSessionFixture(); t.after(f.dispose);
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  await h.current.start('legacy-cafe'); h.current.typeInput(poison.draft); await h.view.settle();
  const key = f.participants.conversationLocalKey(f.lease.userId), set = f.tab.local.setItem;
  f.tab.local.setItem = (name, value) => { if (name === key || name === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"')) throw new Error(privateRaw); set(name, value); };
  t.after(() => { f.tab.local.setItem = set; }); h.current.typeInput(poison.staged); await h.view.settle();
  assert.equal(h.current.status, 'unavailable'); assertNoPrivate(h.current.error); assertNoPrivate(f.calls); assertNoPrivate(f.notices); assertNoPrivate(f.diagnostics);
  assertNoPrivate(f.tab.cloud.readLocalCloudState());
  const protocol = f.tab.transactions.readStorageSnapshot(f.tab.local); assert.equal(protocol.pending, true);
  assert.ok(protocol.getItem(key)?.includes(poison.draft)); assertNoPrivate(f.tab.cloud.readLocalCloudState(protocol));
});

for (const index of [0, 1, 2]) test(`G5 guided level ${index} real hook keeps all input/fallback/drafts out of provider, backup and notices`, async t => {
  const { GUIDED_CONVERSATION_PILOT } = await import('../data/guidedConversationPilot.ts');
  const { conversationSessionFixture } = await import('./helpers/conversationSessionFixture.ts');
  const f = await conversationSessionFixture(); t.after(f.dispose); const script = GUIDED_CONVERSATION_PILOT[index];
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  assert.equal(await h.current.start(Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision })), true);
  h.current.typeInput(poison.transcript); await h.view.settle(); assert.equal(await h.current.send(), true);
  h.current.typeInput(poison.draft); await h.view.settle(); assert.equal(await h.current.end(), true);
  const key = f.participants.conversationLocalKey(f.lease.userId), raw = f.tab.local.getItem(key)!;
  assert.ok(raw.includes(poison.transcript)); assert.ok(raw.includes(poison.draft)); assert.ok(raw.includes('sample-fallback-with-response'));
  await f.refresh(); await h.view.settle(); assertNoPrivate(f.calls); assertNoPrivate(f.notices); assertNoPrivate(f.diagnostics); assert.equal(f.audio.length, 0);
  const boundary = f.tab.loadModule('app/data/languageStorageBoundary.ts') as typeof import('../app/data/languageStorageBoundary.ts');
  assertNoPrivate(boundary.projectLanguageBytes(f.tab.transactions.readStorageSnapshot(f.tab.local))); assertNoPrivate(f.tab.cloud.readLocalCloudState());
  const backup = f.tab.mount('app/components/DataBackupPanel.tsx'); t.after(backup.dispose); backup.click('운동·식단 기록 백업');
  assert.equal(f.tab.downloads.length, 1); const exported = await f.tab.downloads[0].text(); assertNoPrivate(exported); assert.doesNotMatch(exported, /yeoni-conversation-local-v1|guided-fixed-emission|guided-convenience-store/);
});

for (const script of GUIDED_CONVERSATION_REMAINING) test(`catalogue privacy ${script.scriptId}: registered hook/facade pending, cancellation and recap never leave the owner partition`, async t => {
  const { conversationSessionFixture } = await import('./helpers/conversationSessionFixture.ts');
  const f = await conversationSessionFixture({}, { id: `privacy-${script.scriptId}`, owner: `synthetic-privacy-owner-${GUIDED_CONVERSATION_REMAINING.indexOf(script)}` }); t.after(f.dispose);
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  const canaries = { transcript: `${poison.transcript}_${script.contextId}`, staged: `${poison.staged}_${script.contextId}`, draft: `${poison.draft}_${script.contextId}` };
  const excludes = (value: unknown) => {
    assertNoPrivate(value); const raw = JSON.stringify(value);
    for (const canary of [...Object.values(canaries), script.scriptId, script.scriptRevision]) assert.ok(!raw.includes(canary), `Catalogue private value escaped: ${canary}`);
    assert.doesNotMatch(raw, /yeoni-conversation-local-v1|guided-fixed-emission/);
  };
  const serverBefore = JSON.stringify(f.remoteState()), key = f.participants.conversationLocalKey(f.lease.userId);
  assert.equal(f.tab.local.getItem(key), null);
  assert.equal(await h.current.start(Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision })), true);
  const id = h.current.session!.sessionId;
  h.current.typeInput(canaries.transcript); await h.view.settle(); assert.equal(await h.current.send(), true);
  const turn = f.snapshot().envelope!.sessions.find(session => session.sessionId === id)!.turns[0];
  assert.equal(turn.draft.input, canaries.transcript); assert.ok('kind' in turn.emission);
  assert.equal(turn.emission.branch, 'sample-fallback-with-response'); assert.equal(turn.emission.reply, script.steps[0].fixedReply.japanese);
  assert.equal(turn.emission.builderPolicy, 'guided-fixed-exchange-v2'); assert.equal(turn.emission.exampleFallback?.japanese, script.steps[0].learnerExample.japanese);
  h.current.typeInput(canaries.staged); await h.view.settle();
  const saved = f.snapshot().envelope!.sessions.find(session => session.sessionId === id)!.drafts[0]; assert.equal(saved.input, canaries.staged);
  const intent = f.facade.captureConversationAppend(f.snapshot(), id, saved.draftId); await f.facade.stageConversationIntent(intent); await h.view.settle();
  assert.equal(f.facade.reconcileConversationOperation(f.snapshot(), id, intent.command.operationId).status, 'pending');
  const pendingRaw = f.tab.local.getItem(key)!; assert.ok(pendingRaw.includes(canaries.staged)); assert.ok(pendingRaw.includes(canaries.transcript));
  f.pause(); await f.resume(); await h.view.settle(); assert.equal(f.tab.local.getItem(key), pendingRaw);
  assert.equal(f.facade.reconcileConversationOperation(f.snapshot(), id, intent.command.operationId).status, 'pending');
  assert.equal(await h.current.cancelPending(), true); await h.view.settle();
  assert.equal(f.facade.reconcileConversationOperation(f.snapshot(), id, intent.command.operationId).status, 'cancelled');
  h.current.typeInput(canaries.draft); await h.view.settle(); assert.equal(await h.current.end(), true);
  const raw = f.tab.local.getItem(key)!; assert.ok(raw.includes(canaries.transcript)); assert.ok(raw.includes(canaries.staged)); assert.ok(raw.includes(canaries.draft));
  assert.ok(raw.includes(script.scriptId)); assert.ok(raw.includes(script.scriptRevision)); assert.ok(raw.includes('sample-fallback-with-response'));
  await f.refresh(); await h.view.settle();
  assert.equal(JSON.stringify(f.remoteState()), serverBefore); excludes(f.calls); excludes(f.notices); excludes(f.diagnostics); assert.equal(f.audio.length, 0);
  const boundary = f.tab.loadModule('app/data/languageStorageBoundary.ts') as typeof import('../app/data/languageStorageBoundary.ts');
  excludes(boundary.projectLanguageBytes(f.tab.transactions.readStorageSnapshot(f.tab.local))); excludes(f.tab.cloud.readLocalCloudState());
  const backup = f.tab.mount('app/components/DataBackupPanel.tsx'); t.after(backup.dispose); backup.click('운동·식단 기록 백업');
  assert.equal(f.tab.downloads.length, 1); excludes(await f.tab.downloads[0].text()); excludes(f.notices); excludes(f.diagnostics);
  assert.equal(f.tab.local.getItem(key), raw);
});

for (const script of GUIDED_CONVERSATION_REMAINING.filter(item => item.levelId === 'beginner')) test(`catalogue privacy ${script.contextId}: unknown-write UI and prepared before-image keep new source/input canaries local`, async t => {
  const { conversationSessionFixture } = await import('./helpers/conversationSessionFixture.ts');
  const f = await conversationSessionFixture({}, { id: `unknown-${script.contextId}` }); t.after(f.dispose);
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  assert.equal(await h.current.start(Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision })), true);
  h.current.typeInput(`${poison.draft}_${script.contextId}`); await h.view.settle();
  const key = f.participants.conversationLocalKey(f.lease.userId), before = f.tab.local.getItem(key), set = f.tab.local.setItem;
  f.tab.local.setItem = (name, value) => { if (name === key || name === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"')) throw new Error(`${privateRaw}_${script.scriptId}`); set(name, value); };
  t.after(() => { f.tab.local.setItem = set; }); h.current.typeInput(`${poison.staged}_${script.contextId}`); await h.view.settle();
  assert.equal(h.current.status, 'unavailable'); assertNoPrivate(h.current.error); assertNoPrivate(f.calls); assertNoPrivate(f.notices); assertNoPrivate(f.diagnostics);
  assert.doesNotMatch(JSON.stringify([h.current.error, f.calls, f.notices, f.diagnostics]), new RegExp(script.scriptId));
  const snapshot = f.tab.transactions.readStorageSnapshot(f.tab.local); assert.equal(snapshot.pending, true); assert.equal(snapshot.getItem(key), before);
  assertNoPrivate(f.tab.cloud.readLocalCloudState()); assertNoPrivate(f.tab.cloud.readLocalCloudState(snapshot)); assert.equal(f.audio.length, 0);
  const backup = f.tab.mount('app/components/DataBackupPanel.tsx'); t.after(backup.dispose); backup.click('운동·식단 기록 백업');
  assert.equal(f.tab.downloads.length, 1); const raw = await f.tab.downloads[0].text(); assertNoPrivate(raw); assert.ok(!raw.includes(script.scriptId)); assert.ok(!raw.includes(script.scriptRevision));
});
