import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import type { TestContext } from 'node:test';
import ts from 'typescript';
import { CURRICULUM } from '../../data/curriculum.ts';
import { languageFixture, deferred } from './languageFixture.ts';
import { loadLegacyEvidenceRepository } from './legacyEvidenceRepositoryHarness.ts';
import { createLegacyEvidenceSqlFixture } from './legacy-evidence-sql.ts';
import { createLanguageSyncCoordinator } from '../../app/data/languageSyncCoordinator.ts';
import { readLanguageRecordSnapshot, type LanguageRecordSnapshot } from '../../app/data/languageCloudSync.ts';
import { COURSE_REVIEW_KEY, createReviewMutation, runReviewMutation, projectReviewRows, type ReviewMutationPayload, type ReviewMutationResult } from '../../app/data/languageReviewMutations.ts';
import type { LanguageMutation, LanguageMutationResult } from '../../app/data/languageRecordMutations.ts';
import type { LanguageRowHandle } from '../../app/data/languageRecordIdentity.ts';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE, type LanguageLegacyEvidenceRelease } from '../../app/data/languageLegacyEvidenceRelease.ts';
import { createDeterministicIDBAdapter } from '../../lib/language-legacy-evidence/idb-test-adapter.ts';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST, LEGACY_EVIDENCE_MANIFEST_RELEASE, SERVER_EVIDENCE_PROTOCOL } from '../../lib/language-legacy-evidence/identity-manifest.ts';
import type { ServerEvidenceContext } from '../../lib/language-legacy-evidence/server-types.ts';
import type { LearnerMode } from '../../utils/learningSession.ts';
import type * as Capture from '../../app/data/languageLegacyReviewCapture.ts';
import type * as Repository from '../../app/data/languageLegacyEvidenceRepository.ts';

const ENABLED: LanguageLegacyEvidenceRelease = Object.freeze({ resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true });
/** Execute the adapter's exact source in the native realm. The repository here is
 * itself exact source loaded by the existing singleton/release-only fixture.
 * Every identity, coordinator, planner, store and proof registry stays real. */
export async function loadLegacyReviewCapture(runtime: typeof Repository, release: LanguageLegacyEvidenceRelease = ENABLED): Promise<typeof Capture> {
  const path = new URL('../../app/data/languageLegacyReviewCapture.ts', import.meta.url);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = new Map<string, unknown>();
  for (const match of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    if (dependencies.has(name)) continue;
    dependencies.set(name, name === './languageLegacyEvidenceRepository.ts' ? runtime : name === './languageLegacyEvidenceRelease.ts' ?
      { LANGUAGE_LEGACY_EVIDENCE_RELEASE: release } : await import(name.startsWith('.') ? new URL(name, path).href : name));
  }
  const exported = {};
  runInThisContext(`(function(exports, require) { ${compiled}\n})`)(exported, (name: string) => {
    assert.ok(dependencies.has(name), `Unexpected adapter dependency ${name}`); return dependencies.get(name);
  });
  return exported as typeof Capture;
}

type RpcHook = (name: string, args: Record<string, unknown>, result?: unknown) => void | Promise<void>;
type ActionHook = (intent: LanguageMutation<ReviewMutationPayload>, result?: LanguageMutationResult<ReviewMutationResult>) => void | Promise<void>;
/** Deterministic request/IDB fixture, not browser-engine or hosted verification.
 * Optional SQL runs the existing disposable migration fixture, unchanged. */
export async function createLegacyReviewCaptureFixture(t: TestContext, options: { active?: boolean; sql?: boolean; questionIds?: string[] } = {}) {
  const sql = options.sql ? await createLegacyEvidenceSqlFixture({ activateWrites: true }) : null;
  const owner = randomUUID(), local = languageFixture(), lease = await local.owner(owner);
  const rows = (options.questionIds ?? ['f01:2', 'f01:3']).map(id => {
    const [lessonId, index] = id.split(':'), lesson = CURRICULUM.find(row => row.id === lessonId)!;
    const quiz = lesson.quiz[Number(index)];
    return { id, lessonId, lessonTitle: lesson.title, prompt: quiz.prompt, explanation: quiz.explanation,
      createdAt: '2026-10-09T00:00:00.000Z', wrongCount: 0, reviewCount: 0, successStreak: 0 };
  });
  let remote: Record<string, unknown> = { [COURSE_REVIEW_KEY]: JSON.stringify(rows) }, remoteVersion = 1;
  if (sql) await sql.addOwner(owner, remote);
  const idb = createDeterministicIDBAdapter(), previousIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let idbOpenCount = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new Proxy(idb.factory, { get(target, key) {
    if (key === 'open') return (...args: Parameters<typeof target.open>) => { idbOpenCount++; return target.open(...args); };
    return Reflect.get(target, key);
  } }) });
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const syncCalls: { name: 'read' | 'update'; state?: Record<string, unknown> }[] = [];
  let beforeRpc: RpcHook | undefined, afterRpc: RpcHook | undefined, currentUser: string | null = owner;
  const state: { enrollment: { creationRequestId: string; initialGenerationId: string } | null; currentContext: ServerEvidenceContext | null } = { enrollment: null, currentContext: null };
  const client = { auth: { async getUser() { return { data: { user: currentUser ? { id: currentUser } : null }, error: null }; } },
    rpc(name: string, args: Record<string, unknown>) { return { async abortSignal() {
      assert.equal(local.locks.active, 0, 'No local storage lock crosses the RPC');
      calls.push({ name, args: structuredClone(args) }); await beforeRpc?.(name, args);
      let data: unknown;
      if (sql) {
        try { data = await sql.rpc(name, args); } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
      } else {
        assert.equal(args.expected_owner, owner);
        if (name === 'read_language_legacy_evidence_status') data = { version: 1, status: state.enrollment ? 'enrolled' : 'unenrolled', ownerId: owner,
          protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE, manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST,
          statePresent: true, resetMarker: { present: false, value: null }, ...structuredClone(state) };
        else if (name === 'enroll_language_legacy_evidence_v1') {
          if (!state.enrollment) {
            const generationId = randomUUID(), now = new Date().toISOString();
            state.enrollment = { creationRequestId: String(args.creation_request_id), initialGenerationId: generationId };
            state.currentContext = { ownerId: owner, generationId, resetMarker: { present: false, value: null }, prospectiveStartedAt: now,
              studyDayTimezone: String(args.proposed_timezone), protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE,
              manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST, serverTime: now, highWater: 0 };
          }
          data = { version: 1, status: 'enrolled', ...state.enrollment, currentContext: structuredClone(state.currentContext) };
        } else throw Error(`Unexpected synthetic RPC ${name}; use the SQL fixture for delivery`);
      }
      await afterRpc?.(name, args, data); return { data, error: null };
    } }; },
  };
  const coordinator = createLanguageSyncCoordinator({ lease, storage: local.storage, onState() {}, transport: {
    async verifyOwner() { return currentUser === owner; },
    async read() {
      syncCalls.push({ name: 'read' });
      if (sql) { const result = await sql.db.query<{ state: Record<string, unknown>; updated_at: string }>('select state,updated_at from public.language_user_state where user_id=$1', [owner]);
        return result.rows[0] ? { state: result.rows[0].state, updatedAt: result.rows[0].updated_at } : null; }
      return { state: structuredClone(remote), updatedAt: String(remoteVersion) };
    },
    async insert() { assert.fail('The review fixture starts from an existing language state'); },
    async update(_userId, wire, expectedUpdatedAt) {
      syncCalls.push({ name: 'update', state: structuredClone(wire) });
      if (sql) { const result = await sql.db.query('update public.language_user_state set state=$2,updated_at=clock_timestamp() where user_id=$1 and updated_at=$3 returning user_id', [owner, wire, expectedUpdatedAt]); return result.rows.length === 1; }
      if (expectedUpdatedAt !== String(remoteVersion)) return false;
      remote = structuredClone(wire); remoteVersion++; return true;
    },
  } });
  const release = options.active === false ? LANGUAGE_LEGACY_EVIDENCE_RELEASE : ENABLED;
  const runtime = await loadLegacyEvidenceRepository(client, release), adapterModule = await loadLegacyReviewCapture(runtime, release);
  await coordinator.start(); assert.equal(coordinator.getState().status, 'ready');
  const source = () => { const context = coordinator.getState().context; assert.ok(context, 'Expected live fixture context'); return { context, snapshot: readLanguageRecordSnapshot(context) }; };
  const handles = new Map(projectReviewRows<{ id: string }>(source().snapshot, COURSE_REVIEW_KEY).rows.map(row => [row.value.id, row.handle]));
  const submitted: ReviewMutationPayload[] = [], intents: LanguageMutation<ReviewMutationPayload>[] = [], outcomes: LanguageMutationResult<ReviewMutationResult>[] = [];
  let retryCount = 0, beforeAction: ActionHook | undefined, afterAction: ActionHook | undefined, afterPublish: ActionHook | undefined;
  let retained: { intent: LanguageMutation<ReviewMutationPayload>; publish: Parameters<Capture.CapturedLegacyActions['submit']>[1] } | null = null;
  const attempt = async () => {
    const action = retained; if (!action) return false;
    try {
      await beforeAction?.(action.intent);
      const result = await runReviewMutation(action.intent, source().context); outcomes.push(result);
      await afterAction?.(action.intent, result);
      if (!result.acknowledged) return false;
      action.publish(result); await afterPublish?.(action.intent, result); retained = null; return true;
    } catch { return false; }
  };
  const actions: Capture.CapturedLegacyActions = {
    async submit(payload, publish, original: LanguageRecordSnapshot) {
      if (retained) return false;
      submitted.push(payload); const intent = createReviewMutation(source().context, original, payload); intents.push(intent);
      retained = { intent, publish }; return attempt();
    },
    async retry() { retryCount++; return attempt(); },
  };
  const adapters = new Set<Capture.CapturedCourseReviewAdapter>(), repositories = new Set<Repository.LanguageLegacyEvidenceRepository>();
  const views: Capture.CapturedReviewView[] = [];
  function create(questionId = 'f01:3', mode: LearnerMode = 'reader', changed?: (view: Capture.CapturedReviewView) => void) {
    const handle = handles.get(questionId); assert.ok(handle, `Unknown fixture question ${questionId}`);
    const adapter = new adapterModule.CapturedCourseReviewAdapter({ handle, mode, source, actions, changed(view) { views.push(view); changed?.(view); } });
    adapters.add(adapter); return adapter;
  }
  t.after(async () => { for (const adapter of adapters) adapter.dispose(); for (const repo of repositories) repo.close(); coordinator.dispose(); local.restore();
    if (previousIDB) Object.defineProperty(globalThis, 'indexedDB', previousIDB); else Reflect.deleteProperty(globalThis, 'indexedDB'); await sql?.close(); });
  return { sql, owner, local, idb, client, calls, syncCalls, coordinator, runtime, adapterModule, source, handles, actions, submitted, intents, outcomes, views, create,
    get idbOpenCount() { return idbOpenCount; }, get retryCount() { return retryCount; },
    rpcHooks(before?: RpcHook, after?: RpcHook) { beforeRpc = before; afterRpc = after; },
    actionHooks(hooks: { before?: ActionHook; after?: ActionHook; afterPublish?: ActionHook } = {}) { beforeAction = hooks.before; afterAction = hooks.after; afterPublish = hooks.afterPublish; },
    setUser(userId: string | null) { currentUser = userId; },
    async acquire() { const repo = await runtime.acquireLanguageLegacyEvidenceRepository(source().context, { mode: 'existing', studyDayTimezone: 'UTC' }); repositories.add(repo); return repo; },
  };
}

/** A synthetic visible element and two manually advanced frame boundaries.
 * This verifies adapter orchestration, never claims actual pixels/browser focus. */
export function reviewElement(runId: string, surface: 'question' | 'hint' | 'feedback', draftToken: string, eventId?: string) {
  const frames: FrameRequestCallback[] = [];
  let focused = true, visible = true, connected = true, hidden = false;
  const win = { innerHeight: 800, innerWidth: 1200, requestAnimationFrame(callback: FrameRequestCallback) { frames.push(callback); return frames.length; },
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } };
  const doc = { defaultView: win, get visibilityState() { return visible ? 'visible' : 'hidden'; }, hasFocus: () => focused };
  const element = { dataset: { reviewRun: runId, reviewSurface: surface, reviewDraft: draftToken, ...(eventId ? { reviewEvent: eventId } : {}) }, ownerDocument: doc, get isConnected() { return connected; }, parentElement: null,
    closest: () => hidden ? {} : null, getBoundingClientRect: () => ({ width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100 }) } as unknown as HTMLElement;
  return { element, frames, setFocused(value: boolean) { focused = value; }, setVisible(value: boolean) { visible = value; }, setConnected(value: boolean) { connected = value; }, setHidden(value: boolean) { hidden = value; },
    frame() { const callback = frames.shift(); assert.ok(callback, 'An actual adapter frame must be pending'); callback(performance.now()); } };
}
export async function until(predicate: () => boolean, message = 'Expected fixture boundary') {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) { if (predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 2)); }
  assert.fail(message);
}
export async function observeReview(adapter: Capture.CapturedCourseReviewAdapter, surface: 'question' | 'hint' | 'feedback' = 'question') {
  const view = adapter.view();
  const element = reviewElement(view.runId!, surface, view.draftToken!, surface === 'feedback' ? view.handoff?.eventId : undefined), pending = adapter.observe(surface, element.element);
  await until(() => element.frames.length === 1); element.frame(); await until(() => element.frames.length === 1); element.frame();
  return pending;
}
export { deferred };
export type LegacyReviewCaptureFixture = Awaited<ReturnType<typeof createLegacyReviewCaptureFixture>>;
export type { LanguageRowHandle };
