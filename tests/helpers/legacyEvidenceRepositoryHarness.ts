import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { languageFixture } from './languageFixture.ts';
import { createLanguageSyncCoordinator } from '../../app/data/languageSyncCoordinator.ts';
import { createDeterministicIDBAdapter } from '../../lib/language-legacy-evidence/idb-test-adapter.ts';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST, LEGACY_EVIDENCE_MANIFEST_RELEASE, SERVER_EVIDENCE_PROTOCOL } from '../../lib/language-legacy-evidence/identity-manifest.ts';
import type { ServerEvidenceContext } from '../../lib/language-legacy-evidence/server-types.ts';
import type { StoreIncarnation } from '../../lib/language-legacy-evidence/store-admission-types.ts';
/** Test/CI-only module substitution. All registries, producer/consumer modules and
 * coordinator code execute from source in one native module graph. Only the app's
 * fixed singleton import is redirected to the permitted synthetic/local client. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE, type LanguageLegacyEvidenceRelease } from '../../app/data/languageLegacyEvidenceRelease.ts';
import type * as Repository from '../../app/data/languageLegacyEvidenceRepository.ts';

export async function loadLegacyEvidenceRepository(client: unknown, release: LanguageLegacyEvidenceRelease = LANGUAGE_LEGACY_EVIDENCE_RELEASE): Promise<typeof Repository> {
  const path = new URL('../../app/data/languageLegacyEvidenceRepository.ts', import.meta.url);
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = new Map<string, unknown>();
  for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    if (dependencies.has(name)) continue;
    dependencies.set(name, name === '../../lib/supabase.ts' ? { createClient: () => client } :
      name === './languageLegacyEvidenceRelease.ts' ? { LANGUAGE_LEGACY_EVIDENCE_RELEASE: Object.freeze({ ...release }) } :
      await import(name.startsWith('.') ? new URL(name, path).href : name));
  }
  const exported = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Date, crypto: globalThis.crypto, structuredClone, TextEncoder, AbortController, Set, Map, WeakMap, WeakSet,
  })(exported, (name: string) => {
    if (!dependencies.has(name)) throw new Error('Unexpected repository dependency');
    return dependencies.get(name);
  });
  return exported as typeof Repository;
}

// This is a transport/IDB fault fixture, not SQL or a browser-engine proof. The
// actual repository, registered owner/coordinator and private proof registries
// execute unchanged; no successful fixture imports a proof registrar.
export type LegacyEvidenceFixtureHook = (name: string, args: Record<string, unknown>) => void | Promise<void>;
export async function createLegacyEvidenceAdmissionFixture(t: TestContext) {
  const local = languageFixture(), owner = randomUUID(), lease = await local.owner(owner);
  let adapter = createDeterministicIDBAdapter();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => adapter.factory });
  const state: { resetMarker: { present: boolean; value: string | null }; enrollment: { creationRequestId: string; initialGenerationId: string } | null; currentContext: ServerEvidenceContext | null } = {
    resetMarker: { present: false, value: null }, enrollment: null, currentContext: null,
  };
  let before: LegacyEvidenceFixtureHook | undefined, after: LegacyEvidenceFixtureHook | undefined, currentUser: string | null = owner;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const newContext = (requestId: string = randomUUID(), timezone = 'UTC') => {
    const generationId = randomUUID(), now = new Date().toISOString();
    state.enrollment = { creationRequestId: requestId, initialGenerationId: generationId };
    state.currentContext = { ownerId: owner, generationId, resetMarker: { ...state.resetMarker }, prospectiveStartedAt: now,
      studyDayTimezone: timezone, protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE,
      manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST, serverTime: now, highWater: 0 };
  };
  const status = () => ({ version: 1, status: state.enrollment ? state.currentContext ? 'enrolled' : 'enrolled_generation_missing' : 'unenrolled',
    ownerId: owner, protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE,
    manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST, statePresent: true, ...structuredClone(state) });
  const client = { auth: { async getUser() { return { data: { user: currentUser ? { id: currentUser } : null }, error: null }; } },
    rpc(name: string, args: Record<string, unknown>) { return { async abortSignal() {
      calls.push({ name, args: structuredClone(args) }); await before?.(name, args);
      assert.equal(local.locks.active, 0, 'No local-storage transaction spans HTTP');
      assert.equal(args.expected_owner, owner);
      let data: unknown;
      if (name === 'read_language_legacy_evidence_status') data = status();
      else if (name === 'enroll_language_legacy_evidence_v1') {
        assert.equal(JSON.stringify(args.expected_marker), JSON.stringify(state.resetMarker));
        if (!state.enrollment) newContext(String(args.creation_request_id), String(args.proposed_timezone));
        data = { version: 1, status: 'enrolled', ...state.enrollment!, currentContext: structuredClone(state.currentContext) };
      } else throw Error(`Unexpected synthetic RPC ${name}`);
      await after?.(name, args); return { data, error: null };
    } }; },
  };
  const coordinator = createLanguageSyncCoordinator({ lease, storage: local.storage, onState() {}, transport: {
    async verifyOwner() { return currentUser === owner; },
    async read() { return { state: state.resetMarker.present ? { languageRecordResetV1: state.resetMarker.value! } : {}, updatedAt: '2026-10-10T00:00:00.000Z' }; },
    async insert() { assert.fail('Unexpected bootstrap'); }, async update() { assert.fail('Unexpected snapshot write'); },
  } });
  const runtime = await loadLegacyEvidenceRepository(client, { resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true });
  await coordinator.start(); assert.equal(coordinator.getState().status, 'ready');
  const repositories = new Set<Repository.LanguageLegacyEvidenceRepository>();
  t.after(() => { for (const repository of repositories) repository.close(); coordinator.dispose(); local.restore(); if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else Reflect.deleteProperty(globalThis, 'indexedDB'); });
  return { owner, local, state, runtime, coordinator, calls, newContext, get adapter() { return adapter; },
    evict() { adapter = createDeterministicIDBAdapter(); },
    hooks(nextBefore?: LegacyEvidenceFixtureHook, nextAfter?: LegacyEvidenceFixtureHook) { before = nextBefore; after = nextAfter; },
    setUser(value: string | null) { currentUser = value; },
    async acquire(mode: 'initialize' | 'existing' = 'initialize', studyDayTimezone = 'UTC') {
      const context = coordinator.getState().context; assert.ok(context);
      const repository = await runtime.acquireLanguageLegacyEvidenceRepository(context, { mode, studyDayTimezone });
      repositories.add(repository); return repository;
    },
  };
}

/** A real coordinator/admission fixture with two independently acquired facades.
 * The only substituted boundaries are synthetic transport and IndexedDB. */
export async function createAdmittedLegacyEvidenceRepositoryFixture(t: TestContext) {
  const fixture = await createLegacyEvidenceAdmissionFixture(t);
  const repository = await fixture.acquire();
  const secondRepository = await fixture.acquire('existing');
  assert.equal(repository.localContinuity(), 'verified');
  assert.equal(secondRepository.localContinuity(), 'verified');
  const context = repository.context();
  const incarnation = fixture.adapter.inspect('incarnations', 'store') as StoreIncarnation;
  assert.equal(incarnation.continuity, 'verified');
  return Object.assign(fixture, { repository, secondRepository, context, fence: context,
    generationId: context.generationId, incarnationId: incarnation.incarnationId, store: repository.store() });
}
