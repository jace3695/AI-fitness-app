import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as prior from './legacy-v1-contracts.test-support.ts';
import * as current from './contracts.ts';
import { LEGACY_FREE_CONVERSATION_SCRIPTS } from '../../data/freeConversationCatalog.ts';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot.ts';
import { base, emptySession, started, save, draft, append, commit, close, fillBudget, TIME } from './fixtures.test-support.ts';
import { planCreateSession } from './reducer.ts';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { conversationLocalKey } from '../../app/data/languageLocalParticipants.ts';

function guided() {
  const script = GUIDED_CONVERSATION_PILOT[0], source = current.freezeGuidedSource(script.scriptId, script.scriptRevision)!;
  const envelope = base(); const result = planCreateSession(envelope, envelope, { ...emptySession(), source });
  assert.notEqual(result.status, 'blocked'); if (result.status === 'blocked') throw new Error(result.code); return result.envelope;
}

test('G5 compatibility fixture is the byte-exact accepted P2C strict v1 parser', () => {
  const bytes = readFileSync(new URL('./legacy-v1-contracts.test-support.ts', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '7b6da2573ae21037409d3e110eeddaf954f8606eab22bb3ed2cbd4bbf56709db');
  assert.equal(prior.SESSION_SCHEMA_VERSION, 1);
  assert.deepEqual(prior.parseEnvelope(current.canonicalJson(guided())), { status: 'blocked', code: 'unsupported-schema' });
});

for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) test(`G5 byte-exact legacy source and builder ${script.scriptId}`, () => {
  const old = prior.freezeLegacySource(script.scriptId)!, now = current.freezeLegacySource(script.scriptId)!;
  assert.equal(current.canonicalJson(now), prior.canonicalJson(old));
  for (const input of [script.content.japanese, script.content.reading, ` \n${script.content.japanese}?! `, '한국어 alternative', '！？', ' Ａ\u0301 ']) {
    const value = { ...draft(), input, source: current.sourceRef(now) };
    const fields = { turnId: 'turn-byte-fixture', sequence: 1, predecessorTurnId: null, recordedAt: TIME };
    assert.equal(current.canonicalJson(current.buildFrozenTurn(now, value, fields)), prior.canonicalJson(prior.buildFrozenTurn(old, value, fields)));
  }
});

test('G5 legacy v1 roundtrips and logical admission remain exactly old behavior', () => {
  const e = save(started()); const pending = (() => { const c = append(e); const session = e.sessions[0]; return { ...e, sessions: [{ ...session, stateRevision: session.stateRevision + 1, operations: [{ command: c, terminal: null }] }] }; })();
  const completed = commit(commit(e, append(e)), close(commit(e, append(e))));
  for (const fixture of [base(), started(), e, pending, completed, fillBudget(base()), fillBudget(e)]) {
    const raw = prior.canonicalJson(fixture); assert.equal(current.canonicalJson(fixture), raw);
    assert.deepEqual(current.parseEnvelope(raw), prior.parseEnvelope(raw)); assert.deepEqual(current.capacityUsage(fixture), prior.capacityUsage(fixture as prior.ConversationEnvelope));
    assert.equal(current.encodeEnvelope(fixture).status, prior.encodeEnvelope(fixture).status);
  }
  const edge = fillBudget(e); edge.tombstones.at(-1)!.deletionId += 'x';
  assert.deepEqual(current.validateEnvelope(edge), prior.validateEnvelope(edge));
  assert.equal(current.validateEnvelope(edge).status, 'blocked');
});

test('G5 old-client strict parser blocks broader sync reads and reset planning without altering v2 bytes', async t => {
  // Same shipping participant/sync code, with the frozen predecessor contracts.
  // This verifies fail-closed behavior, not mixed-client rollout safety.
  const overrides = new Map<string, unknown>([['../../lib/conversation-session/contracts.ts', prior]]);
  const load = async <T>(path: string): Promise<T> => {
    const url = new URL(path, import.meta.url), source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const deps = new Map<string, unknown>();
    for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
      const name = match[1]; deps.set(name, overrides.has(name) ? overrides.get(name) : await import(new URL(name, url).href));
    }
    const exports = {}; runInThisContext(`(function(exports, require) {${source}\n})`)(exports, (name: string) => { assert.ok(deps.has(name)); return deps.get(name); }); return exports as T;
  };
  const oldParticipant = await load<typeof import('../../app/data/languageLocalParticipants.ts')>('../../app/data/languageLocalParticipants.ts');
  overrides.set('./languageLocalParticipants.ts', oldParticipant);
  const oldSync = await load<typeof import('../../app/data/languageCloudSync.ts')>('../../app/data/languageCloudSync.ts');
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner();
  const envelope = { ...guided(), ownerId: 'a', enrollment: { kind: 'explicit-enrollment' as const, enrollmentId: 'causal-enrollment', createdAt: TIME,
    observation: { kind: 'authenticated-remote-observation-received' as const, requestId: 'request', ownerId: 'a', ownerEpochId: 'epoch', lifecycleId: 'life', marker: null, receivedAt: TIME } } };
  const raw = current.canonicalJson(envelope), key = conversationLocalKey('a'); f.values.set(key, raw); const before = new Map(f.values);
  assert.throws(() => oldSync.readLanguageSyncRequest(lease, oldSync.createLanguageSyncLifecycle(), f.storage), error => error instanceof oldParticipant.ConversationLocalError && error.code === 'unsupported-partition');
  assert.throws(() => oldParticipant.planLanguageLocalParticipants(f.storage, { ownerId: 'a', marker: '2026-10-11T00:00:00Z|11111111-1111-4111-8111-111111111111', reason: 'explicit-reset', replacement: { generationId: 'next', enrollmentId: 'next-enrollment', createdAt: TIME } }), error => error instanceof oldParticipant.ConversationLocalError && error.code === 'unsupported-partition');
  assert.deepEqual(f.values, before); assert.equal(f.values.get(key), raw);
});

// Arbitrary unknown legacy summary identifiers were historically valid data.
// A new policy name cannot retroactively corrupt that read-only legacy history.
test('G5 previously unknown legacy summary identifiers remain canonical and migrate unchanged', () => {
  let legacy = started(); const command = close(legacy); assert.equal(command.kind, 'close');
  if (command.kind !== 'close') assert.fail(); command.boundary.summaryPolicyVersion = 'guided-conversation-recap-v1';
  legacy = commit(legacy, command);
  const raw = current.canonicalJson(legacy); assert.deepEqual(current.parseEnvelope(raw), prior.parseEnvelope(raw));
  const script = GUIDED_CONVERSATION_PILOT[0], source = current.freezeGuidedSource(script.scriptId, script.scriptRevision)!;
  const result = planCreateSession(legacy, legacy, { ...emptySession('guided-next'), source });
  assert.notEqual(result.status, 'blocked'); if (result.status === 'blocked') assert.fail();
  assert.equal(result.envelope.schemaVersion, 2); assert.equal(current.canonicalJson(result.envelope.sessions[0]), current.canonicalJson(legacy.sessions[0]));
});
