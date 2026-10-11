import { randomUUID, createHash } from 'node:crypto';
import type { BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect, login, originalLanguage, canonical, type State } from './fixture';
import { RouteDrain } from './route-drain';
import { reauthenticateFixtureAccount } from './fixture-account-auth';
import { CURRICULUM } from '../../data/curriculum';
import { languageDocument } from '../../app/data/languageRecordDocuments';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST } from '../../lib/language-legacy-evidence/identity-manifest';
import type { CaptureCheckpoint, FrozenBatch, FrozenEvidence } from '../../lib/language-legacy-evidence/persistence-types';
import type { ReviewRun, ReviewJournalPayload, ReviewExposure } from '../../lib/language-legacy-evidence/review-capture';
import type { ServerEvidenceContext, ServerEvidenceReceipt } from '../../lib/language-legacy-evidence/server-types';

// Everything observed below stays in memory. Assertions project sensitive values
// to booleans before passing them to Playwright (whose errors become artifacts).
// This spec never imports a store/repository constructor or proof registrar.
const DB = 'yeoni-legacy-language-evidence-v1';
const KEY = 'japaneseCurriculumReviewV1';
const ORIGIN = 'http://127.0.0.1:54321';
const RPC_PATTERN = /^http:\/\/127\.0\.0\.1:54321\/rest\/v1\/rpc\/(?:read_language_legacy_evidence_(?:status|context|events|page)|enroll_language_legacy_evidence_v1|append_language_legacy_evidence|reset_my_app_records)(?:\?|$)/;
const rpc = {
  status: 'read_language_legacy_evidence_status', context: 'read_language_legacy_evidence_context',
  events: 'read_language_legacy_evidence_events', page: 'read_language_legacy_evidence_page',
  enroll: 'enroll_language_legacy_evidence_v1', append: 'append_language_legacy_evidence', reset: 'reset_my_app_records',
} as const;
type Account = Parameters<typeof login>[1];
const equal = (left: unknown, right: unknown, label: string) => expect(canonical(left) === canonical(right), label).toBe(true);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const requireTrue = (condition: unknown, label: string) => expect(Boolean(condition), label).toBe(true);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const captureUrl = (row = '') => `/language/review?capture=course-review${row ? `&row=${encodeURIComponent(row)}` : ''}`;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const startButton = (page: Page) => button(page, '기록형 복습 시작');
const input = (page: Page) => page.getByLabel('일본어로 써 보세요. 읽는 법으로 입력해도 괜찮아요.', { exact: true });
const recoverButton = (page: Page) => button(page, '같은 기록 다시 확인');
const question = (page: Page) => page.locator('[data-review-surface="question"]');
const pending = (page: Page) => page.getByText('로컬 기록이 있어요. 서버 확인은 대기 중이에요.', { exact: true });
const verified = (page: Page) => page.getByText('서버에서 별도로 확인했어요.', { exact: true });
const ordinaryReady = (page: Page) => page.getByText('학습 기록 · 서버 저장 확인', { exact: true });

function generatedPair() {
  for (const lesson of CURRICULUM) {
    const typedIndex = lesson.quiz.findIndex(q => q.generatedReviewSurface?.origin === 'generated-word-input');
    if (typedIndex < 0) continue;
    const typed = lesson.quiz[typedIndex], authored = typed.generatedReviewSurface!;
    const meaningIndex = lesson.quiz.findIndex(q => q.generatedReviewSurface?.origin === 'generated-word-meaning' && q.evidenceRef?.itemId === typed.evidenceRef?.itemId && q.evidenceRef?.contentRevision === typed.evidenceRef?.contentRevision);
    if (meaningIndex < 0) continue;
    const row = (index: number) => ({ id: `${lesson.id}:${index}`, lessonId: lesson.id, lessonTitle: lesson.title,
      prompt: lesson.quiz[index].prompt, explanation: lesson.quiz[index].explanation, createdAt: '2001-01-02T00:00:00.000Z',
      wrongCount: 2, intervalDays: 3, reviewCount: 4, successStreak: 1 });
    return { typed: row(typedIndex), meaning: row(meaningIndex), answer: authored.targetText, reading: authored.reading,
      typedPrompt: typed.prompt, meaningPrompt: lesson.quiz[meaningIndex].prompt, explanation: typed.explanation,
      meaningAnswer: lesson.quiz[meaningIndex].choices[lesson.quiz[meaningIndex].answer], itemId: typed.evidenceRef!.itemId };
  }
  throw new Error('B2 generated same-item fixture missing');
}
const sample = generatedPair();
const historicalRow = '{ "id":"b2-historical-response", "lessonId":"b2-historical", "lessonTitle":"preserve", "prompt":"old", "explanation":"old", "createdAt":"2001-01-02T00:00:00.000Z", "response":"prior local compatibility response", "unknown":1e+02 }';
async function seed(account: Account, both = false) {
  const row = JSON.stringify({ ...sample.typed, unknownSyntheticField: 'preserve-encoding' }).replace('"preserve-encoding"', '"preserve\\u002dencoding"');
  const array = `[\n ${row},\n${both ? `${JSON.stringify(sample.meaning)},\n` : ''} ${historicalRow}\n]`;
  const state: State = { ...originalLanguage, [KEY]: array, integratedLearningSettingsV1: JSON.stringify({ ...JSON.parse(originalLanguage.integratedLearningSettingsV1 as string), learnerMode: 'reader' }) };
  const result = await account.client.from('language_user_state').update({ state }).eq('user_id', account.id);
  requireTrue(!result.error, 'Synthetic RLS course seed succeeded');
  return { state, array, row };
}

interface NativeSnapshot {
  exists: boolean; version: number; names: string[]; rows: Record<string, { key: IDBValidKey; value: unknown }[]>;
}
interface NativeFacts {
  opens: number; frames: number; blocked: number; aborted: number; faulted: number; overflow: boolean;
  questionBeforeAcquire: boolean; hintBeforeIntent: boolean; enabledBeforePresentation: boolean;
  commits: { operation: string; runId: string; frames: number; focused: boolean; visible: boolean; beforePixels: boolean }[];
  lifecycle: { blur: number; pagehide: number; hidden: number };
}
interface NativeProbe {
  facts: NativeFacts;
  read(): Promise<NativeSnapshot>;
  armAbort(operation: string): void;
  armReadAbort(store: string): void;
  lock(store: string): Promise<void>;
  releaseLock(): void;
  createV3(): Promise<string>;
  releaseV3(): void;
  oldOpen(): Promise<string>;
  close(): void;
}
declare global { interface Window { __b2: NativeProbe } }

async function instrument(context: BrowserContext) {
  await context.addInitScript(({ database }) => {
    const originalOpen = IDBFactory.prototype.open;
    const originalTransaction = IDBDatabase.prototype.transaction;
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalCursor = IDBObjectStore.prototype.openCursor;
    const originalGet = IDBObjectStore.prototype.get;
    const originalFrame = window.requestAnimationFrame.bind(window);
    const connections = new Set<IDBDatabase>();
    const writes = new WeakMap<IDBTransaction, { operation: string; runId: string; beforePixels: boolean }[]>();
    const attached = new WeakSet<IDBTransaction>();
    const durable = new Set<string>();
    const seenEvents = new Set<string>(), seenBatches = new Set<string>(), seenCheckpoints = new Set<string>();
    let abortOperation: string | null = null, abortRead: string | null = null, seen = false;
    let held: IDBTransaction | null = null, old: IDBDatabase | null = null;
    let lockReleased = true, lastFrameTimestamp: number | null = null;
    const facts: NativeFacts = { opens: 0, frames: 0, blocked: 0, aborted: 0, faulted: 0, overflow: false,
      questionBeforeAcquire: false, hintBeforeIntent: false, enabledBeforePresentation: false,
      commits: [], lifecycle: { blur: 0, pagehide: 0, hidden: 0 } };
    const fail = () => { facts.overflow = true; throw new Error('B2 native observation limit'); };
    function observeTransaction(tx: IDBTransaction) {
      if (attached.has(tx) || tx.db.name !== database) return;
      attached.add(tx);
      tx.addEventListener('abort', () => { facts.aborted++; });
      tx.addEventListener('complete', () => {
        for (const entry of writes.get(tx) ?? []) {
          if (facts.commits.length >= 128) { facts.overflow = true; return; }
          durable.add(`${entry.runId}:${entry.operation}`);
          facts.commits.push({ ...entry, frames: facts.frames, focused: document.hasFocus(), visible: document.visibilityState === 'visible' });
        }
      });
    }
    IDBFactory.prototype.open = function(name: string, version?: number) {
      const request = version === undefined ? originalOpen.call(this, name) : originalOpen.call(this, name, version);
      if (name === database) {
        seen = true; if (++facts.opens > 256) fail();
        request.addEventListener('blocked', () => { facts.blocked++; });
        request.addEventListener('upgradeneeded', () => { if (request.transaction) observeTransaction(request.transaction); });
      }
      return request;
    };
    IDBDatabase.prototype.transaction = function(stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const tx = originalTransaction.call(this, stores, mode, options); observeTransaction(tx); return tx;
    };
    const observeWrite = (store: IDBObjectStore, value: unknown, key?: IDBValidKey) => {
      if (store.transaction.db.name !== database) return;
      observeTransaction(store.transaction);
      const row = value as { canonical?: string; value?: { eventId?: string } };
      if (store.name === 'events' && row.value?.eventId) { seenEvents.add(row.value.eventId); if (seenEvents.size > 128) { store.transaction.abort(); fail(); } }
      if (store.name === 'batches') { seenBatches.add(String(key)); if (seenBatches.size > 128) { store.transaction.abort(); fail(); } }
      if (store.name === 'checkpoints') { seenCheckpoints.add(String(key)); if (seenCheckpoints.size > 32) { store.transaction.abort(); fail(); } }
      if (store.name === 'reviewTransitions' && typeof row.canonical === 'string') {
        const journal = JSON.parse(row.canonical) as ReviewJournalPayload;
        const operation = journal.operation.kind, runId = journal.runId;
        const beforePixels = operation === 'acquire' ? !document.querySelector('[data-review-surface="question"]') :
          operation === 'begin_reveal' ? !document.querySelector('[data-review-surface="hint"]') : true;
        const entries = writes.get(store.transaction) ?? [];
        if (facts.commits.length + entries.length >= 128) { store.transaction.abort(); fail(); }
        entries.push({ operation, runId, beforePixels }); writes.set(store.transaction, entries);
        if (abortOperation === operation) { abortOperation = null; facts.faulted++; store.transaction.abort(); }
      }
    };
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const request = originalPut.call(this, value, key); observeWrite(this, value, key); return request;
    };
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      const request = originalAdd.call(this, value, key); observeWrite(this, value, key); return request;
    };
    IDBObjectStore.prototype.openCursor = function(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection) {
      const request = originalCursor.call(this, query, direction);
      if (this.transaction.db.name === database && abortRead === this.name) { abortRead = null; facts.faulted++; this.transaction.abort(); }
      return request;
    };
    IDBObjectStore.prototype.get = function(key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.transaction.db.name === database && abortRead === this.name) { abortRead = null; facts.faulted++; this.transaction.abort(); }
      return request;
    };
    // Pass real callbacks to the native scheduler. No timing, focus, visibility,
    // source, admission, receipt or application callback is substituted.
    window.requestAnimationFrame = callback => originalFrame(time => {
      // Multiple native callbacks in one rendering frame share a timestamp.
      if (time !== lastFrameTimestamp) { facts.frames++; lastFrameTimestamp = time; }
      callback(time);
    });
    const observePixels = () => {
      for (const node of document.querySelectorAll<HTMLElement>('[data-review-surface]')) {
        const run = node.dataset.reviewRun, surface = node.dataset.reviewSurface;
        if (!run || node.closest('[hidden],[inert]')) continue;
        if (surface === 'question') {
          if (!durable.has(`${run}:acquire`) && !durable.has(`${run}:presentation`)) facts.questionBeforeAcquire = true;
          const enabled = node.querySelector<HTMLInputElement | HTMLButtonElement>('input:not(:disabled),button:not(:disabled)');
          if (enabled && !durable.has(`${run}:presentation`)) facts.enabledBeforePresentation = true;
        }
        if (surface === 'hint' && !durable.has(`${run}:begin_reveal`)) facts.hintBeforeIntent = true;
      }
    };
    new MutationObserver(observePixels).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert'] });
    window.addEventListener('blur', () => { facts.lifecycle.blur++; });
    window.addEventListener('pagehide', () => { facts.lifecycle.pagehide++; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') facts.lifecycle.hidden++; });
    const openExisting = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = originalOpen.call(indexedDB, database);
      request.onupgradeneeded = () => { request.transaction!.abort(); reject(new Error('B2 observer refused creation')); };
      request.onerror = () => reject(new Error('B2 native read failed'));
      request.onsuccess = () => { connections.add(request.result); resolve(request.result); };
    });
    const close = (db: IDBDatabase) => { db.close(); connections.delete(db); };
    window.__b2 = {
      facts,
      async read() {
        if (!seen && typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some(entry => entry.name === database)) {
          return { exists: false, version: 0, names: [], rows: {} };
        }
        const db = old ?? await openExisting(); seen = true;
        try {
          const names = [...db.objectStoreNames];
          const tx = originalTransaction.call(db, names, 'readonly');
          const rows: NativeSnapshot['rows'] = {};
          const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('B2 native snapshot failed')); });
          for (const name of names) {
            rows[name] = [];
            const cursor = tx.objectStore(name).openCursor();
            cursor.onsuccess = () => { const item = cursor.result; if (!item) return;
              if (rows[name].length >= (name === 'checkpoints' ? 32 : name === 'events' || name === 'batches' ? 128 : 256)) { facts.overflow = true; tx.abort(); return; }
              rows[name].push({ key: item.primaryKey, value: item.value }); item.continue(); };
          }
          await done; return { exists: true, version: db.version, names, rows };
        } finally { if (db !== old) close(db); }
      },
      armAbort(operation) { if (abortOperation) throw new Error('B2 native fault already armed'); abortOperation = operation; },
      armReadAbort(store) { if (abortRead) throw new Error('B2 native read fault already armed'); abortRead = store; },
      async lock(store) {
        if (held) throw new Error('B2 native lock already held');
        const db = await openExisting(); lockReleased = false;
        const tx = originalTransaction.call(db, store, 'readwrite'); held = tx;
        let count = 0; const started = performance.now();
        const ended = () => { held = null; lockReleased = true; close(db); };
        tx.oncomplete = ended; tx.onabort = ended;
        const pump = () => { if (lockReleased) return; if (++count > 8192 || performance.now() - started > 5000) { facts.overflow = true; tx.abort(); return; }
          const read = originalGet.call(tx.objectStore(store), '__b2-nonexistent-read-lock__'); read.onsuccess = pump; };
        pump();
        await new Promise<void>(resolve => { const ready = originalGet.call(tx.objectStore(store), '__b2-nonexistent-read-lock__'); ready.onsuccess = () => resolve(); });
      },
      releaseLock() { lockReleased = true; },
      async createV3() {
        if (seen) throw new Error('B2 historical fixture requires a fresh origin'); seen = true;
        // Exact v3 layout and valid unknown incarnation, matching the reviewed
        // historical schema. No fabricated enrollment/admission is inserted.
        const birth = { version: 1, incarnationId: '10000000-0000-4000-8000-000000000003', origin: 'unproven_upgrade', continuity: 'unknown' };
        await new Promise<void>((resolve, reject) => {
          const request = originalOpen.call(indexedDB, database, 3);
          request.onupgradeneeded = () => {
            for (const name of ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes', 'admissions', 'incarnations', 'enrollmentIntents']) {
              const store = request.result.createObjectStore(name);
              if (name === 'events') store.createIndex('semanticKey', 'semanticKey', { unique: true });
              if (name === 'checkpoints') store.createIndex('episodeKey', 'episodeKey', { unique: true });
              if (name === 'incarnations') store.put(birth, 'store');
            }
          };
          request.onerror = () => reject(new Error('B2 historical fixture creation failed'));
          request.onsuccess = () => { old = request.result; old.onversionchange = () => { /* Intentionally hold the actual v3 connection. */ }; resolve(); };
        });
        return JSON.stringify(birth);
      },
      releaseV3() { old?.close(); old = null; },
      oldOpen() { return new Promise<string>(resolve => {
        const request = originalOpen.call(indexedDB, database, 3);
        request.onerror = () => resolve(request.error?.name === 'VersionError' ? 'VersionError' : 'unexpected-error');
        request.onsuccess = () => { request.result.close(); resolve('unexpected-success'); };
      }); },
      close() { lockReleased = true; if (held) { try { held.abort(); } catch { /* Already settled. */ } } old?.close(); old = null; for (const db of connections) db.close(); connections.clear(); },
    };
  }, { database: DB });
}
const native = (page: Page) => page.evaluate(() => window.__b2.read());
const facts = (page: Page) => page.evaluate(() => window.__b2.facts);
const values = <T>(state: NativeSnapshot, name: string): T[] => (state.rows[name] ?? []).map(row => row.value as T);
const runs = (state: NativeSnapshot) => values<ReviewRun>(state, 'reviewRuns').filter(row => row.kind === 'run');
const events = (state: NativeSnapshot) => values<{ value: FrozenEvidence }>(state, 'events').map(row => row.value).sort((a, b) => a.sequence - b.sequence);
const checkpoints = (state: NativeSnapshot) => values<{ value: CaptureCheckpoint }>(state, 'checkpoints').map(row => row.value);
const batches = (state: NativeSnapshot) => values<{ canonical: string }>(state, 'batches').map(row => JSON.parse(row.canonical) as FrozenBatch).sort((a, b) => a.events[0].sequence - b.events[0].sequence);
const journals = (state: NativeSnapshot) => values<{ canonical: string }>(state, 'reviewTransitions').map(row => JSON.parse(row.canonical) as ReviewJournalPayload);

class EvidenceTraffic {
  readonly entries: { name: string; body: Record<string, unknown>; status: number; upstream: boolean; delivered: boolean; response: unknown }[] = [];
  readonly drain = new RouteDrain();
  private releases: (() => void)[] = [];
  private held: { name: string; phase: 'request' | 'response' | 'loss'; arrived: () => void; wait: Promise<void> } | null = null;
  failEvidence = false;
  failReadback = false;
  lossNextAppend = false;
  private committedLoss = false;
  constructor(private readonly context: BrowserContext) {}
  hold(name: string, phase: 'request' | 'response' | 'loss') {
    if (this.held) throw new Error('B2 HTTP hold already armed');
    const arrived = deferred(), release = deferred(); this.releases.push(release.resolve);
    this.held = { name, phase, arrived: arrived.resolve, wait: release.promise };
    return { arrived: arrived.promise, release: release.resolve };
  }
  readonly route = (route: Route) => this.drain.run(async () => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== ORIGIN || request.method() !== 'POST') { await route.fallback(); return; }
    const name = url.pathname.slice('/rest/v1/rpc/'.length);
    if (this.entries.length >= 256) { await route.abort('blockedbyclient'); throw new Error('B2 evidence traffic limit'); }
    const entry = { name, body: request.postDataJSON() as Record<string, unknown>, status: 0, upstream: false, delivered: false, response: null as unknown };
    this.entries.push(entry);
    if (this.failEvidence && name !== rpc.reset || this.failReadback && this.committedLoss && name === rpc.events) { await route.abort('failed'); return; }
    const hold = this.held?.name === name ? this.held : null; if (hold) this.held = null;
    if (hold?.phase === 'request') { hold.arrived(); await hold.wait; }
    const response = await route.fetch({ maxRetries: 0 });
    entry.status = response.status(); entry.upstream = true; entry.response = await response.json().catch(() => null);
    if (hold && hold.phase !== 'request') { hold.arrived(); await hold.wait; }
    if (name === rpc.append && this.lossNextAppend) {
      this.lossNextAppend = false;
      requireTrue(response.ok(), 'Lost append response follows genuine upstream success');
      this.committedLoss = true; await route.abort('failed'); return;
    }
    if (hold?.phase === 'loss') { requireTrue(response.ok(), 'Lost HTTP response follows genuine upstream success'); await route.abort('failed'); return; }
    entry.delivered = true; await route.fulfill({ response });
  });
  async install() { await this.context.route(RPC_PATTERN, this.route); }
  count(name: string) { return this.entries.filter(entry => entry.name === name).length; }
  async close() {
    this.failEvidence = false; this.failReadback = false; this.lossNextAppend = false;
    this.releases.forEach(release => release()); this.held = null;
    await this.drain.wait(); await this.context.unroute(RPC_PATTERN, this.route);
  }
}

async function foreground(page: Page) {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState === 'visible' && document.hasFocus()), { message: 'Real foreground focus is required' }).toBe(true);
  const paused = button(page, '학습 기록 다시 확인');
  await expect(ordinaryReady(page).or(paused)).toBeVisible();
  if (await paused.isVisible()) await paused.click();
  await expect(ordinaryReady(page)).toBeVisible();
}
async function enter(page: Page, account: Account, row = sample.typed.id) {
  await login(page, account, captureUrl(row)); await foreground(page);
  await expect(startButton(page)).toBeEnabled();
  await expect(question(page)).toHaveCount(0);
}
async function begin(page: Page, row = sample.typed.id) {
  await foreground(page);
  await startButton(page).scrollIntoViewIfNeeded();
  await startButton(page).click();
  await expect(question(page)).toBeVisible();
  await question(page).scrollIntoViewIfNeeded();
  if (row === sample.typed.id) await expect(input(page)).toBeEditable();
  else await expect(button(page, sample.meaningAnswer)).toBeEnabled();
}
async function recover(page: Page) {
  await foreground(page); await expect(recoverButton(page)).toBeEnabled(); await recoverButton(page).click();
}
async function answer(page: Page, value = sample.answer) {
  await input(page).fill(value); await input(page).press('Enter');
  await expect(button(page, value === sample.answer || value === sample.reading ? '복습 결과 저장 · 다음 문제' : '다시 풀어볼래요')).toBeEnabled();
  await expect.poll(async () => checkpoints(await native(page)).some(cp => cp.handoff?.status === 'applied'), { message: 'Committed compatibility handoff is acknowledged locally' }).toBe(true);
}
async function confirmDialog(page: Page, target: Locator, accepted: boolean) {
  const dialog = page.waitForEvent('dialog'); const clicked = target.click(); const prompt = await dialog;
  expect(prompt.type()).toBe('confirm'); if (accepted) await prompt.accept(); else await prompt.dismiss(); await clicked;
}
async function waitClosedAndDismissed(page: Page, expected: Pick<ReviewRun['immutable'], 'runId' | 'episodeId' | 'generationId'>) {
  await expect.poll(async () => {
    const local = await native(page), run = runs(local).find(row => row.immutable.runId === expected.runId);
    if (!run || run.immutable.episodeId !== expected.episodeId || run.generationId !== expected.generationId || run.state.lifecycle !== 'closed') return false;
    const closure = journals(local).find(row => row.runId === expected.runId && row.transitionId === run.state.latestTransitionId);
    return Boolean(closure && closure.operation.kind === 'close_unavailable' && closure.scope.generationId === expected.generationId
      && closure.after.runState.lifecycle === 'closed' && closure.after.runState.latestTransitionId === run.state.latestTransitionId);
  }, { message: 'Exact captured run and latest unavailable-close journal are terminal' }).toBe(true);
  await expect(question(page)).toHaveCount(0);
  await expect(page.getByText('문제를 고른 뒤 시작을 눌러 주세요.', { exact: true })).toBeVisible();
}
async function awaitUnavailableCloseRefusal(page: Page, traffic: EvidenceTraffic) {
  const close = button(page, '기록형 복습 종료 확인'), held = traffic.hold(rpc.status, 'response');
  try {
    await confirmDialog(page, close, true);
    await held.arrived;
    await expect(close).toBeDisabled();
  } finally { held.release(); }
  await traffic.drain.wait();
  // These controls were observed disabled for this exact held action. Their
  // re-enabled blocked state is its completion boundary, not an idle snapshot.
  await expect(close).toBeEnabled();
  await expect(recoverButton(page)).toBeEnabled();
  await expect(page.getByText('기록을 확인하지 못했어요. 입력은 보존했어요.', { exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: '320px document has no horizontal overflow' }).toBe(true);
}
async function noEvidenceOpen(page: Page, traffic: EvidenceTraffic) {
  const observed = await facts(page); expect(observed.opens).toBe(0); expect(traffic.entries.length).toBe(0);
  const absence = await page.evaluate(async name => typeof indexedDB.databases !== 'function' || !(await indexedDB.databases()).some(db => db.name === name), DB);
  requireTrue(absence, 'Metadata inspection does not find or create the inactive database');
}
async function checkNativeSafety(page: Page, fresh = true) {
  const observed = await facts(page);
  requireTrue(!observed.overflow, 'Native observation stayed bounded');
  if (fresh) {
    requireTrue(!observed.questionBeforeAcquire, 'Durable acquisition precedes first question pixels');
    requireTrue(!observed.hintBeforeIntent, 'Durable hint intent precedes hint pixels');
    requireTrue(!observed.enabledBeforePresentation, 'Exact durable presentation precedes answer enablement');
  }
}
async function cleanupNative(context: BrowserContext) {
  for (const page of context.pages()) if (!page.isClosed()) await page.evaluate(() => window.__b2?.close());
}
async function runObserved(context: BrowserContext, work: (traffic: EvidenceTraffic) => Promise<void>) {
  await instrument(context); const traffic = new EvidenceTraffic(context); await traffic.install();
  try { await work(traffic); }
  finally {
    // Release and drain genuine HTTP callbacks while routes still exist. Native
    // observer/lock cleanup is guaranteed even when route cleanup rejects.
    try { await traffic.close(); } finally { await cleanupNative(context); }
  }
}

async function status(account: Account, marker: { present: boolean; value: string | null } = { present: false, value: null }) {
  const result = await account.client.rpc(rpc.status, { expected_owner: account.id, expected_marker: marker });
  requireTrue(!result.error, 'Independent authenticated status read succeeds');
  return result.data as { status: string; currentContext: ServerEvidenceContext | null; enrollment: unknown };
}
async function verifyLedger(account: Account, local: NativeSnapshot) {
  const localEvents = events(local); requireTrue(localEvents.length > 0 && localEvents.length <= 128, 'Bounded local events exist');
  const generation = localEvents[0].generationId;
  const args = { expected_owner: account.id, expected_generation: generation, manifest_digest: LEGACY_EVIDENCE_MANIFEST_DIGEST };
  const current = await account.client.rpc(rpc.context, args); requireTrue(!current.error, 'Independent authenticated context read succeeds');
  const context = current.data as ServerEvidenceContext;
  const exact = await account.client.rpc(rpc.events, { ...args, event_ids: localEvents.map(event => event.eventId) });
  requireTrue(!exact.error, 'Independent authenticated exact-event read succeeds');
  const records = (exact.data as { records: ServerEvidenceReceipt[]; missingEventIds: string[] }).records;
  expect((exact.data as { missingEventIds: string[] }).missingEventIds.length).toBe(0);
  expect(records.length).toBe(localEvents.length);
  for (const event of localEvents) {
    const receipt = records.find(row => row.event.eventId === event.eventId);
    requireTrue(receipt && receipt.ownerId === account.id && receipt.payloadHash === event.payloadHash && receipt.canonicalEvent === event.canonical && sha(receipt.canonicalEvent) === receipt.payloadHash, 'Exact event canonical bytes and hash match authenticated ledger');
  }
  const page = await account.client.rpc(rpc.page, { ...args, through_sequence: context.highWater, after_sequence: 0, page_limit: 128 });
  requireTrue(!page.error, 'Independent authenticated page read succeeds');
  const paged = page.data as { records: ServerEvidenceReceipt[]; rowCount: number; exhausted: boolean; lastSequence: number };
  requireTrue(paged.exhausted && paged.rowCount === records.length && paged.lastSequence === context.highWater, 'Authenticated complete prefix contains exactly the local events');
  equal(paged.records.map(row => row.event.eventId).sort(), records.map(row => row.event.eventId).sort(), 'Page and exact-event readback agree');
  expect(new Set(records.map(row => row.event.eventId)).size).toBe(records.length);
  const enrolled = await status(account); requireTrue(enrolled.status === 'enrolled' && enrolled.currentContext?.generationId === generation, 'Status and context bind the genuine generation');
  return { args, records, context };
}

test('I1 inactive navigation never opens evidence @b2-inactive', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await login(page, qa.account, '/language/review'); await foreground(page);
    await expect(page.getByRole('heading', { name: '복습', exact: true })).toBeVisible(); await noEvidenceOpen(page, traffic);
    // A genuine same-origin RSC prefetch request carries no admission authority.
    const prefetch = await page.request.get(captureUrl(sample.typed.id), { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
    requireTrue(prefetch.ok(), 'Inactive focused route prefetch succeeds'); await noEvidenceOpen(page, traffic);
    await page.goto(captureUrl()); await foreground(page);
    await expect(page.getByText('기록형 과정 복습은 아직 활성화되지 않았어요.', { exact: true })).toBeVisible();
    await expect(startButton(page)).toHaveCount(0); await expect(question(page)).toHaveCount(0); await noEvidenceOpen(page, traffic);
    await page.goto(captureUrl(sample.typed.id)); await foreground(page); await noEvidenceOpen(page, traffic);
    // Native history is the documented Next same-page search-param boundary.
    await page.evaluate(url => history.pushState(null, '', url), '/language/review');
    await expect(page.getByRole('heading', { name: '복습', exact: true })).toBeVisible();
    await page.evaluate(url => history.pushState(null, '', url), captureUrl(sample.typed.id));
    await expect(page.getByText('기록형 과정 복습은 아직 활성화되지 않았어요.', { exact: true })).toBeVisible();
    await page.goBack(); await expect(page.getByRole('heading', { name: '복습', exact: true })).toBeVisible();
    await page.goForward(); await expect(page.getByText('기록형 과정 복습은 아직 활성화되지 않았어요.', { exact: true })).toBeVisible();
    await noEvidenceOpen(page, traffic); await page.reload(); await foreground(page); await noEvidenceOpen(page, traffic);
  });
});

test('I2 inactive bait and small-screen ordinary practice @b2-inactive', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await page.setViewportSize({ width: 320, height: 844 });
    await context.addInitScript(() => {
      // Inert bait only. No auth, epoch, reset marker, enrollment or proof seed.
      localStorage.setItem('NEXT_PUBLIC_LANGUAGE_LEGACY_EVIDENCE_ENABLED', 'true');
      localStorage.setItem('captureEnabled', 'true');
      localStorage.setItem('resetProtocol', 'protocol-required');
    });
    await login(page, qa.account, `${captureUrl(sample.typed.id)}&captureEnabled=true&enrollmentEnabled=true&resetProtocol=protocol-required`);
    await foreground(page);
    const section = page.getByRole('region', { name: '기록형 과정 복습', exact: true });
    await expect(section).toBeVisible(); await expect(startButton(page)).toHaveCount(0);
    requireTrue(!(await section.textContent())?.includes(sample.answer), 'Unavailable capture has no authored answer');
    requireTrue(!(await section.textContent())?.includes(sample.typedPrompt), 'Unavailable capture has no authored recommendation');
    const ordinary = page.getByRole('link', { name: '기존 복습으로 가기', exact: true });
    await ordinary.scrollIntoViewIfNeeded(); await ordinary.focus(); await expect(ordinary).toBeFocused();
    await noOverflow(page); await noEvidenceOpen(page, traffic);
    await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: '복습', exact: true })).toBeVisible();
    await button(page, '새 과정').scrollIntoViewIfNeeded(); await button(page, '새 과정').click();
    await expect(page.getByRole('heading', { name: '오늘 복습할 과정 문제', exact: true })).toBeVisible();
    await noOverflow(page); await noEvidenceOpen(page, traffic);
  });
});

test('E1 authenticated admission precedes presentation @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    const source = await seed(qa.account); await enter(page, qa.account);
    expect((await facts(page)).opens).toBe(0); expect(traffic.entries.length).toBe(0);
    requireTrue(!(await page.getByRole('region', { name: '기록형 과정 복습', exact: true }).last().textContent())?.includes(sample.answer), 'No target-bearing UI before explicit admission');
    const hold = traffic.hold(rpc.enroll, 'response');
    await startButton(page).scrollIntoViewIfNeeded(); await startButton(page).click(); await hold.arrived;
    await expect(question(page)).toHaveCount(0); await expect(input(page)).toHaveCount(0);
    const pendingEnrollment = await native(page);
    expect(pendingEnrollment.version).toBe(4); expect(values(pendingEnrollment, 'enrollmentIntents').length).toBe(1);
    expect(values(pendingEnrollment, 'admissions').length).toBe(0);
    hold.release(); await expect(input(page)).toBeEditable();
    const local = await native(page), run = runs(local)[0], event = JSON.parse(events(local)[0].canonical);
    expect(runs(local).length).toBe(1); expect(events(local).length).toBe(1); expect(values(local, 'admissions').length).toBe(1);
    equal(run.immutable.originalSource, { key: KEY, arrayBytes: source.array, rowBytes: source.row, rowIndex: 0 }, 'Acquisition pins exact whole-array and unknown-field row bytes');
    requireTrue(event.kind === 'exercise_presented' && event.hintUsed === null && event.answerPreviouslyRevealed === null && event.correct === null, 'Unknown assistance stays unknown');
    requireTrue(event.textVisibility.targetText === false && event.textVisibility.reading === false, 'Typed target and reading are genuinely hidden');
    const transitions = journals(local), acquire = transitions.find(entry => entry.operation.kind === 'acquire')!;
    requireTrue(acquire.after.runState.phase === 'unpresented' && acquire.after.exposure?.pending.some(intent => intent.surface === 'question'), 'Durable pending question precedes observation');
    const observed = await facts(page), acquisition = observed.commits.find(entry => entry.operation === 'acquire')!, presentation = observed.commits.find(entry => entry.operation === 'presentation')!;
    requireTrue(acquisition.beforePixels && presentation.frames >= acquisition.frames + 2 && presentation.focused && presentation.visible, 'Native frame and real visibility observation precede exact persisted presentation');
    expect(traffic.count(rpc.enroll)).toBe(1); requireTrue(traffic.count(rpc.status) >= 2, 'Enrollment is followed by genuine authenticated status readback');
    expect(traffic.count(rpc.append)).toBe(0); await expect(pending(page)).toBeVisible(); await expect(verified(page)).toHaveCount(0);
    await checkNativeSafety(page);
  });
});

test('E2 typed answer IME retry and prospective privacy @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await enter(page, qa.account); await begin(page);
    const sentinel = `b2-private-typed-${randomUUID()}`;
    await input(page).fill(sentinel); await input(page).dispatchEvent('compositionstart'); await input(page).press('Enter');
    expect(events(await native(page)).length).toBe(1); await expect(button(page, '다시 풀어볼래요')).toHaveCount(0);
    await input(page).dispatchEvent('compositionend'); await input(page).press('Enter'); await page.keyboard.press('Enter');
    await expect(button(page, '다시 풀어볼래요')).toBeEnabled();
    let local = await native(page); expect(events(local).length).toBe(2);
    const wrong = checkpoints(local)[0].handoff!;
    expect(Boolean(wrong.answer === sentinel && !wrong.correct && wrong.status === 'applied' && wrong.observation.modality === 'typing' && Number.isFinite(wrong.observation.responseMs)), 'B2_E2_EXACT_LOCAL_HANDOFF').toBe(true);
    expect(Boolean(events(local).every(event => !event.canonical.includes(sentinel))), 'B2_E2_CANONICAL_PRIVACY').toBe(true);
    const committedDraft = wrong.draftToken, committedEvents = events(local), originalRun = runs(local)[0];
    await button(page, '다시 풀어볼래요').click(); await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue('');
    const retried = await native(page), retryRun = runs(retried).find(row => row.immutable.runId === originalRun.immutable.runId);
    const retryCheckpoint = checkpoints(retried).find(cp => cp.sourceSlotKey === originalRun.immutable.sourceSlotKey);
    const retryAcknowledgement = journals(retried).find(row => row.runId === originalRun.immutable.runId && row.transitionId === retryRun?.state.latestTransitionId);
    // The applied old handoff is durable history. Retry clears the rendered draft,
    // binds a new token, and acknowledges that clear without rewriting history.
    expect(Boolean(retryCheckpoint?.handoff?.status === 'applied' && retryCheckpoint.handoff.draftToken === committedDraft
      && canonical(retryCheckpoint.handoff) === canonical(wrong)), 'B2_E2_RETRY_RETAINS_APPLIED_HANDOFF').toBe(true);
    expect(Boolean(retryRun && retryRun.state.currentDraftToken !== committedDraft && retryCheckpoint?.answerReady === true
      && retryRun.state.phase === 'answerable' && retryRun.state.action === null), 'B2_E2_RETRY_NEW_DRAFT_READY').toBe(true);
    expect(Boolean(retryAcknowledgement?.operation.kind === 'ack_retry' && canonical(retryAcknowledgement.after.runState) === canonical(retryRun?.state)), 'B2_E2_RETRY_CLEAR_ACKNOWLEDGED').toBe(true);
    expect(Boolean(canonical(events(retried)) === canonical(committedEvents)), 'B2_E2_RETRY_NO_ANSWER_EVENT').toBe(true);
    await expect(page.locator('[data-review-surface="feedback"]')).toHaveCount(0);
    await expect(page.locator('[data-review-surface="hint"]')).toHaveCount(0);
    await answer(page); local = await native(page);
    expect(events(local).length).toBe(3); const run = runs(local)[0], correct = checkpoints(local)[0].handoff!;
    expect(Boolean(run.state.hadWrong && correct.draftToken !== committedDraft && correct.correct), 'B2_E2_RETRY_CUMULATIVE_WRONG').toBe(true);
    const answerEvents = events(local).map(event => JSON.parse(event.canonical)).filter(event => event.kind === 'answer_submitted');
    expect(answerEvents.length).toBe(2);
    expect(Boolean(answerEvents[0].correct === false && answerEvents[1].correct === true && answerEvents[1].isRetry === true && answerEvents[1].answerPreviouslyRevealed === true), 'B2_E2_RETRY_EVIDENCE').toBe(true);
    await button(page, '복습 결과 저장 · 다음 문제').click();
    await expect.poll(async () => {
      const state = await qa.readLanguage(); const doc = languageDocument(state[KEY] as string, 'array');
      return doc.get([0, 'reviewCount']) === 5;
    }, { message: 'Original legacy scheduling reaches authenticated storage' }).toBe(true);
    const saved = await qa.readLanguage(), doc = languageDocument(saved[KEY] as string, 'array');
    expect(Boolean(doc.rawAt([1]) === historicalRow), 'B2_E2_HISTORICAL_BYTES').toBe(true);
    expect(Boolean(doc.get([0, 'wrongCount']) === 3 && doc.get([0, 'lastNeededHelp']) === true && doc.get([0, 'successStreak']) === 0 && doc.get([0, 'intervalDays']) === 1), 'B2_E2_LEGACY_SCHEDULE').toBe(true);
    expect(Boolean(doc.get([0, 'lastModality']) === correct.observation.modality && doc.get([0, 'lastResponseMs']) === Math.round(correct.observation.responseMs!)), 'B2_E2_LEGACY_OBSERVATION').toBe(true);
    const last = JSON.parse(doc.get([0, 'languageLastOperationV1', 'payload']) as string);
    expect(Boolean(!Object.hasOwn(last, 'response') && last.hadWrong === true && last.correct === true && canonical(last.observation) === canonical(correct.observation)), 'B2_E2_LAST_PRIVACY').toBe(true);
    expect(Boolean(!JSON.stringify(saved).includes(sentinel) && !JSON.stringify(qa.traffic.entries).includes(sentinel) && !JSON.stringify(traffic.entries).includes(sentinel)), 'B2_E2_WIRE_PRIVACY').toBe(true);
    expect(Boolean(!JSON.stringify(await facts(page)).includes(sentinel)), 'B2_E2_DIAGNOSTIC_PRIVACY').toBe(true);
    await checkNativeSafety(page);
    // Synthetic composition/Enter guards are covered; native OS IME is not.
  });
});

test('E3 meaning hints and shared exposure fence typing @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async () => {
    await seed(qa.account, true); await enter(page, qa.account); await begin(page);
    const draft = 'b2-unsubmitted-shared-exposure'; await input(page).fill(draft);
    const typedInitial = await native(page), typedBefore = checkpoints(typedInitial)[0];
    const typedRun = runs(typedInitial).find(row => row.immutable.sourceSlotKey === typedBefore.sourceSlotKey)!.immutable;
    requireTrue(typedBefore.answerPreviouslyRevealed === null, 'Typed checkpoint starts with unknown exposure');
    const peer = await context.newPage();
    await peer.goto(captureUrl(sample.meaning.id)); await foreground(peer); await begin(peer, sample.meaning.id);
    await button(peer, '힌트 볼래요').click(); await expect(peer.locator('[data-review-surface="hint"]')).toBeVisible();
    await expect(button(peer, sample.meaningAnswer)).toBeEnabled();
    let local = await native(peer);
    const exposure = values<ReviewExposure>(local, 'itemExposures').find(row => row.itemId === sample.itemId)!;
    requireTrue(exposure.targetText === true && exposure.reading === true && exposure.answer === true && exposure.coverage === 'unknown' && exposure.pending.length === 0, 'Real meaning and hint pixels produce shared sticky exposure without invented coverage');
    const history = journals(local), hintIntent = history.find(row => row.operation.kind === 'begin_reveal')!, hintObserved = history.find(row => row.operation.kind === 'observed_hint')!;
    requireTrue(hintIntent.after.exposure?.pending.some(intent => intent.surface === 'hint') && hintObserved.operation.kind === 'observed_hint' && hintObserved.operation.observed.actualVisible, 'Durable hint intent and actual observation remain separate operations');
    requireTrue(!history.some(row => ['observed_reveal', 'observed_visibility', 'provenance_loss'].includes(row.operation.kind)), 'No fabricated reveal, visibility or provenance repair is inserted');
    await foreground(page); await expect(recoverButton(page)).toBeEnabled(); await recoverButton(page).click();
    await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue(draft); await input(page).press('Enter');
    await expect(page.getByText('다른 화면에서 같은 표현을 봤어요. 이 입력의 기록은 안전하게 중단했어요.', { exact: true })).toBeVisible();
    requireTrue(await input(page).inputValue() === draft, 'Shared-exposure refusal preserves the unsubmitted draft');
    expect(events(await native(page)).filter(event => event.sourceSlotKey === typedBefore.sourceSlotKey).length).toBe(1);
    await confirmDialog(page, button(page, '기록형 복습 종료 확인'), true);
    await waitClosedAndDismissed(page, typedRun);
    await page.goto(captureUrl(sample.typed.id)); await foreground(page); await begin(page);
    local = await native(page);
    const newest = checkpoints(local).filter(cp => cp.presentation.taskFormat === 'typed_answer').find(cp => cp.episodeId !== typedBefore.episodeId)!;
    requireTrue(newest && newest.answerPreviouslyRevealed === true && newest.presentation.hintUsed === null, 'A later typing episode inherits real same-item exposure and unknown hint provenance');
    await checkNativeSafety(peer); await peer.close();
  });
});

test('E4 overlapping Starts and native read interruption @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account, true); await enter(page, qa.account);
    const peer = await context.newPage(); await peer.goto(captureUrl(sample.typed.id)); await foreground(peer);
    await foreground(page); const enrollment = traffic.hold(rpc.enroll, 'response');
    await startButton(page).click(); await enrollment.arrived;
    await foreground(peer); await begin(peer);
    const initial = await native(peer), selected = runs(initial)[0].immutable;
    enrollment.release(); await traffic.drain.wait();
    equal(runs(await native(peer)).map(run => run.immutable.runId), [selected.runId], 'Competing actual Starts acquire only the selected durable identity');
    await expect(page.locator('[data-review-surface="question"]')).toHaveCount(0);
    await input(peer).fill('b2-cas-stale-draft');
    // This bounded native lock holds the answer action's preliminary read.
    // It does not establish a prepared answer or an answer-write CAS boundary.
    // Returning to the first page genuinely blurs the pending owner.
    await peer.evaluate(() => window.__b2.lock('reviewRuns'));
    try {
      await input(peer).press('Enter');
      await page.bringToFront();
      await expect.poll(() => peer.evaluate(() => !document.hasFocus()), { message: 'Competing action genuinely loses focus' }).toBe(true);
    } finally { await peer.evaluate(() => window.__b2.releaseLock()); }
    await foreground(page); await expect(recoverButton(page)).toBeEnabled(); await recoverButton(page).click();
    const state = await native(page);
    expect(runs(state).length).toBe(1);
    requireTrue(journals(state).filter(row => row.operation.kind === 'acquire').length === 1, 'Competing actual Starts create only one durable acquisition');
    requireTrue(events(state).every(event => event.episodeId === selected.episodeId && event.sourceSlotKey === selected.sourceSlotKey), 'Only selected acquired identities are committed');
    requireTrue((await facts(peer)).lifecycle.blur > 0, 'Real blur fences stale action callbacks');
    await expect(peer.getByText('내가 고른 답: b2-cas-stale-draft', { exact: true })).toHaveCount(0);
    const current = checkpoints(state)[0];
    requireTrue(current.handoff === null && events(state).length === 1, 'Blur interrupts the preliminary read before answer preparation');
    requireTrue(!journals(state).some(row => row.operation.kind === 'answer'), 'The blurred preliminary read produces no answer transition');
    await expect(input(page)).toBeEditable(); await answer(page, 'b2-cas-foreground-draft');
    const after = await native(page);
    expect(events(after).length).toBe(2);
    expect(journals(after).filter(row => row.operation.kind === 'answer').length).toBe(1);
    expect(traffic.count(rpc.append)).toBe(0);
    requireTrue(values<ReviewExposure>(after, 'itemExposures').every(row => row.pending.length === 0), 'Only the selected foreground handoff settles the pending reveal');
    await button(page, '다시 풀어볼래요').click(); await expect(input(page)).toBeEditable();
    const retried = await native(page), typedRun = runs(retried).find(row => row.immutable.runId === selected.runId)!;
    const currentDraft = typedRun.state.currentDraftToken;
    const priorHandoff = checkpoints(after).find(cp => cp.sourceSlotKey === selected.sourceSlotKey)?.handoff;
    const retryCheckpoint = checkpoints(retried).find(cp => cp.sourceSlotKey === selected.sourceSlotKey);
    const retryAcknowledgement = journals(retried).find(row => row.runId === selected.runId && row.transitionId === typedRun.state.latestTransitionId);
    expect(Boolean(priorHandoff?.status === 'applied' && retryCheckpoint?.handoff?.status === 'applied'
      && retryCheckpoint.handoff.draftToken === priorHandoff.draftToken && canonical(retryCheckpoint.handoff) === canonical(priorHandoff)), 'B2_E4_RETRY_RETAINS_APPLIED_HANDOFF').toBe(true);
    expect(Boolean(currentDraft !== selected.initialDraftToken && currentDraft !== priorHandoff?.draftToken && retryCheckpoint?.answerReady === true
      && typedRun.state.phase === 'answerable' && typedRun.state.action === null), 'B2_E4_RETRY_NEW_DRAFT_READY').toBe(true);
    expect(Boolean(retryAcknowledgement?.operation.kind === 'ack_retry' && canonical(retryAcknowledgement.after.runState) === canonical(typedRun.state)), 'B2_E4_RETRY_CLEAR_ACKNOWLEDGED').toBe(true);
    expect(Boolean(canonical(events(retried)) === canonical(events(after))), 'B2_E4_RETRY_NO_ANSWER_EVENT').toBe(true);
    await expect(input(page)).toHaveValue(''); await expect(page.locator('[data-review-surface="feedback"]')).toHaveCount(0);
    await expect(page.locator('[data-review-surface="hint"]')).toHaveCount(0);
    // A fresh peer view explicitly acquires the current draft before another
    // supported run creates the hint. An old retained token cannot explain refusal.
    await peer.reload(); await foreground(peer); await begin(peer);
    const peerCurrent = await native(peer), peerRun = runs(peerCurrent).find(row => row.immutable.runId === selected.runId)!;
    requireTrue(peerRun.state.currentDraftToken === currentDraft && peerRun.state.phase === 'answerable' && peerRun.state.action === null, 'Peer acquires the exact current durable typed draft before the hint');
    requireTrue(await question(peer).getAttribute('data-review-run') === selected.runId && await question(peer).getAttribute('data-review-draft') === currentDraft, 'Peer rendered run and draft identity match the durable retry');
    await expect(input(peer)).toHaveValue('');
    await page.goto(captureUrl(sample.meaning.id)); await foreground(page); await begin(page, sample.meaning.id);
    const meaningRun = runs(await native(page)).find(row => row.immutable.rowKey === sample.meaning.id)!;
    requireTrue(meaningRun.immutable.identity.itemId === selected.identity.itemId && meaningRun.immutable.identity.contentRevision === selected.identity.contentRevision, 'The separate meaning run shares the exact typed item revision');
    await page.evaluate(() => window.__b2.armAbort('observed_hint'));
    await button(page, '힌트 볼래요').click(); await expect(recoverButton(page)).toBeEnabled();
    const pendingHint = await native(page), typedBeforeHintAnswer = events(pendingHint).filter(event => event.sourceSlotKey === selected.sourceSlotKey);
    requireTrue(values<ReviewExposure>(pendingHint, 'itemExposures').some(row => row.pending.some(intent => intent.surface === 'hint' && intent.runId === meaningRun.immutable.runId)), 'Failed actual sibling hint observation retains its exact pending reveal');
    await foreground(peer); await expect(recoverButton(peer)).toBeEnabled(); await recoverButton(peer).click();
    await expect(input(peer)).toBeEditable(); await expect(recoverButton(peer)).toHaveCount(0);
    const beforeAnswer = await native(peer), recoveredRun = runs(beforeAnswer).find(row => row.immutable.runId === selected.runId)!;
    requireTrue(recoveredRun.state.currentDraftToken === currentDraft && recoveredRun.state.phase === 'answerable' && recoveredRun.state.action === null
      && await question(peer).getAttribute('data-review-draft') === currentDraft, 'Peer recovery completes with the unchanged current draft rather than a stale-token refusal');
    requireTrue(values<ReviewExposure>(beforeAnswer, 'itemExposures').some(row => row.pending.some(intent => intent.surface === 'hint' && intent.runId === meaningRun.immutable.runId)), 'Exact sibling pending hint remains immediately before the typed attempt');
    await input(peer).fill('b2-pending-hint-answer'); await input(peer).focus(); await expect(input(peer)).toBeFocused();
    await input(peer).press('Enter');
    await expect(recoverButton(peer)).toBeEnabled();
    await expect(peer.getByText('기록을 확인하지 못했어요. 입력은 보존했어요.', { exact: true })).toBeVisible();
    await expect(input(peer)).not.toBeEditable();
    requireTrue(await input(peer).inputValue() === 'b2-pending-hint-answer', 'Settled pending-exposure refusal preserves the targeted typed draft');
    const refused = await native(peer);
    equal(events(refused).filter(event => event.sourceSlotKey === selected.sourceSlotKey), typedBeforeHintAnswer, 'Pending sibling reveal prevents an additional typed answer event');
    expect(journals(refused).filter(row => row.runId === selected.runId && row.operation.kind === 'answer').length).toBe(1);
    requireTrue(!journals(refused).some(row => row.runId === meaningRun.immutable.runId && row.operation.kind === 'observed_hint'), 'No successful hint observation is fabricated');
    await checkNativeSafety(page); await checkNativeSafety(peer, false); await peer.close();
  });
});

test('E5 confirmed local handoff survives reload @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await enter(page, qa.account); await begin(page); await answer(page);
    const before = await native(page), originalEvents = events(before), handoff = checkpoints(before)[0].handoff, immutable = runs(before)[0].immutable;
    await expect(pending(page)).toBeVisible(); await expect(verified(page)).toHaveCount(0);
    const writes = qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method !== 'GET').length;
    await page.reload(); await foreground(page); await expect(startButton(page)).toBeEnabled();
    await expect(question(page)).toHaveCount(0); expect(traffic.count(rpc.append)).toBe(0);
    equal(events(await native(page)), originalEvents, 'Reload does not rewrite committed canonical events');
    await startButton(page).click(); await expect(button(page, '복습 결과 저장 · 다음 문제')).toBeEnabled();
    const after = await native(page);
    equal(runs(after)[0].immutable, immutable, 'Explicit restart reacquires the exact durable run');
    equal(checkpoints(after)[0].handoff, handoff, 'Confirmed local compatibility handoff survives exact');
    equal(events(after), originalEvents, 'Read-first reload recovery creates no answer event');
    await expect(pending(page)).toBeVisible(); await expect(verified(page)).toHaveCount(0);
    expect(qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method !== 'GET').length).toBe(writes);
    expect(traffic.count(rpc.append)).toBe(0); await checkNativeSafety(page, false);
  });
});

test('E6 lost append response uses authenticated readback @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); const other = await qa.createAccount();
    await enter(page, qa.account); await begin(page); await answer(page);
    const before = await native(page), frozen = batches(before);
    expect(frozen.length).toBe(2); traffic.lossNextAppend = true; traffic.failReadback = true;
    await button(page, '서버 기록 확인').click(); await expect(recoverButton(page)).toBeEnabled();
    expect(traffic.count(rpc.append)).toBe(1);
    const lost = traffic.entries.find(entry => entry.name === rpc.append)!;
    requireTrue(lost.upstream && lost.status >= 200 && lost.status < 300 && !lost.delivered, 'Actual PostgREST success precedes deliberately lost delivery');
    equal(lost.body.batch_id, frozen[0].batchId, 'Lost request uses the exact frozen batch identity');
    equal(lost.body.canonical_events, frozen[0].events.map(event => event.canonical), 'Lost request preserves exact canonical event order');
    equal(lost.body.expected_predecessor, frozen[0].expectedPredecessor, 'Lost request preserves exact predecessor');
    await expect(verified(page)).toHaveCount(0);
    const afterLoss = await native(page); equal(batches(afterLoss), frozen, 'Loss does not rewrite local batch IDs, events or predecessors');
    traffic.failReadback = false; const mark = traffic.entries.length;
    await recover(page); await expect(button(page, '서버 기록 확인')).toBeEnabled(); await button(page, '서버 기록 확인').click();
    await expect(verified(page)).toBeVisible();
    expect(traffic.entries.filter(entry => entry.name === rpc.append && entry.body.batch_id === frozen[0].batchId).length).toBe(1);
    const resumed = traffic.entries.slice(mark), successor = resumed.findIndex(entry => entry.name === rpc.append);
    requireTrue(successor > 0 && resumed.slice(0, successor).some(entry => entry.name === rpc.events && entry.upstream && entry.delivered), 'Actual authenticated predecessor readback precedes successor append');
    const local = await native(page); equal(events(local), events(before), 'Readback never rewrites local canonical events');
    const verifiedLedger = await verifyLedger(qa.account, local);
    expect(traffic.count(rpc.append)).toBe(2);
    const foreign = await other.client.rpc(rpc.events, { ...verifiedLedger.args, event_ids: events(local).map(event => event.eventId) });
    requireTrue(Boolean(foreign.error) && !foreign.data, 'Second real authenticated owner cannot read the first owner ledger');
    expect(qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method !== 'GET').length).toBe(0);
    await checkNativeSafety(page);
  });
});

test('E7 offline outbox preserves predecessor order @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await enter(page, qa.account); await begin(page);
    traffic.failEvidence = true; await answer(page); const before = await native(page);
    await expect(pending(page)).toBeVisible(); await button(page, '서버 기록 확인').click();
    await expect(recoverButton(page)).toBeEnabled(); expect(traffic.count(rpc.append)).toBe(0);
    requireTrue(traffic.entries.some(entry => entry.name === rpc.events && !entry.upstream), 'Only the selected loopback evidence transport is unavailable');
    await page.reload(); await foreground(page); await expect(startButton(page)).toBeEnabled();
    equal(events(await native(page)), events(before), 'Pending native events survive reload unchanged');
    equal(batches(await native(page)), batches(before), 'Pending batch IDs and predecessor bytes survive reload unchanged');
    await startButton(page).click(); await expect(recoverButton(page)).toBeEnabled();
    await expect(question(page)).toHaveCount(0); await expect(verified(page)).toHaveCount(0);
    expect(traffic.count(rpc.append)).toBe(0);
    traffic.failEvidence = false; await recover(page); await expect(button(page, '서버 기록 확인')).toBeEnabled();
    const mark = traffic.entries.length, predecessor = traffic.hold(rpc.append, 'response');
    await button(page, '서버 기록 확인').click(); await predecessor.arrived;
    const live = events(before), args = { expected_owner: qa.account.id, expected_generation: live[0].generationId, manifest_digest: LEGACY_EVIDENCE_MANIFEST_DIGEST };
    const prefix = await qa.account.client.rpc(rpc.events, { ...args, event_ids: live.map(event => event.eventId) });
    requireTrue(!prefix.error, 'Independent ordinary authentication reads the genuinely partial delivery');
    const partial = prefix.data as { records: ServerEvidenceReceipt[]; missingEventIds: string[] };
    requireTrue(partial.records.length === 1 && partial.records[0].event.eventId === live[0].eventId && partial.missingEventIds.length === 1 && partial.missingEventIds[0] === live[1].eventId, 'Genuine upstream predecessor exists while successor is still absent');
    expect(traffic.entries.slice(mark).filter(entry => entry.name === rpc.append).length).toBe(1);
    await expect(verified(page)).toHaveCount(0); await expect(pending(page)).toBeVisible();
    predecessor.release(); await expect(verified(page)).toBeVisible();
    const delivered = traffic.entries.slice(mark), appends = delivered.filter(entry => entry.name === rpc.append);
    expect(appends.length).toBe(2);
    const frozen = batches(before);
    equal(appends.map(entry => entry.body.batch_id), frozen.map(batch => batch.batchId), 'Explicit delivery preserves frozen ordered batch identities');
    equal(appends[1].body.expected_predecessor, { eventId: events(before)[0].eventId, payloadHash: events(before)[0].payloadHash, sequence: 0 }, 'Successor carries the exact durable predecessor');
    const firstIndex = delivered.indexOf(appends[0]), secondIndex = delivered.indexOf(appends[1]);
    requireTrue(delivered.slice(firstIndex + 1, secondIndex).some(entry => entry.name === rpc.events && entry.upstream && entry.delivered && (entry.response as { missingEventIds?: string[] })?.missingEventIds?.length === 0), 'A complete genuine predecessor readback authorizes the successor');
    await verifyLedger(qa.account, await native(page));
    expect(qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method !== 'GET').length).toBe(0);
    await checkNativeSafety(page, false);
  });
});

test('E8 pinned source and held retirement closure @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    const source = await seed(qa.account, true); await enter(page, qa.account); await begin(page);
    const run = runs(await native(page))[0];
    equal(run.immutable.originalSource.arrayBytes, source.array, 'Captured episode pins whole-array source encoding');
    equal(run.immutable.originalSource.rowBytes, source.row, 'Captured episode pins unknown-field row encoding');
    // The existing mutation hook acknowledges local durable storage independently
    // of its background PATCH. Hold the actual authority read needed by closure.
    const statusMark = traffic.entries.length, held = traffic.hold(rpc.status, 'loss');
    let retiringRun!: ReviewRun, retirementJournal!: ReviewJournalPayload, legacyOperation: unknown;
    try {
      await button(page, '내일 다시 볼래요').click(); await held.arrived;
      const heldStatus = traffic.entries.slice(statusMark).find(entry => entry.name === rpc.status);
      const proof = heldStatus?.response as { status?: string; ownerId?: string; resetMarker?: unknown; currentContext?: ServerEvidenceContext } | undefined;
      expect(Boolean(heldStatus?.upstream && heldStatus.status >= 200 && heldStatus.status < 300 && !heldStatus.delivered
        && heldStatus.body.expected_owner === qa.account.id && canonical(heldStatus.body.expected_marker) === canonical({ present: false, value: null })
        && proof?.status === 'enrolled' && proof.ownerId === qa.account.id && proof.currentContext?.ownerId === qa.account.id
        && proof.currentContext.generationId === run.generationId && canonical(proof.resetMarker) === canonical({ present: false, value: null })
        && canonical(proof.currentContext.resetMarker) === canonical(proof.resetMarker)), 'B2_E8_CLOSURE_AUTHORITY_HELD').toBe(true);
      const heldNative = await native(page);
      retiringRun = runs(heldNative).find(row => row.immutable.runId === run.immutable.runId)!;
      retirementJournal = journals(heldNative).find(row => row.runId === run.immutable.runId && row.transitionId === retiringRun?.state.latestTransitionId)!;
      expect(Boolean(retiringRun && canonical(retiringRun.immutable) === canonical(run.immutable) && retiringRun.state.lifecycle === 'retiring'
        && retiringRun.state.retirement?.kind === 'defer' && retiringRun.state.retirement.outcome === null
        && retirementJournal?.operation.kind === 'begin_retirement' && retirementJournal.operation.retirementKind === 'defer'
        && retirementJournal.scope.ownerId === qa.account.id && retirementJournal.scope.generationId === run.generationId
        && retirementJournal.actionId === retiringRun.state.retirement.retirementId
        && canonical(retirementJournal.after.runState) === canonical(retiringRun.state)), 'B2_E8_EXACT_RETIREMENT_HELD').toBe(true);
      expect(Boolean(!journals(heldNative).some(row => row.runId === run.immutable.runId && row.operation.kind === 'close_retirement')), 'B2_E8_NO_CLOSE_BEFORE_AUTHORITY').toBe(true);
      await expect(recoverButton(page)).toBeDisabled();
      await expect.poll(async () => {
        const server = await qa.readLanguage(), doc = languageDocument(server[KEY] as string, 'array');
        return typeof doc.get([0, 'languageLastOperationV1', 'operationId']) === 'string';
      }, { message: 'The first genuine legacy mirror save precedes the independent source change' }).toBe(true);
      await expect(ordinaryReady(page)).toBeVisible();
      const server = await qa.readLanguage(), changed = languageDocument(server[KEY] as string, 'array');
      legacyOperation = changed.get([0, 'languageLastOperationV1']);
      expect(Boolean(typeof changed.get([0, 'languageLastOperationV1', 'operationId']) === 'string'
        && qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method === 'PATCH').length === 1), 'B2_E8_SINGLE_LEGACY_SAVE_ACKNOWLEDGED').toBe(true);
      changed.set([0, 'unknownSyntheticField'], 'changed-through-owner-client');
      const changedState = { ...server, [KEY]: changed.text() };
      const update = await qa.account.client.from('language_user_state').update({ state: changedState, updated_at: new Date().toISOString() }).eq('user_id', qa.account.id);
      expect(Boolean(!update.error), 'B2_E8_OWNER_SOURCE_CHANGE').toBe(true);
      await page.evaluate(url => history.pushState(null, '', url), captureUrl(sample.meaning.id));
      expect(Boolean(await question(page).getAttribute('data-review-run') === run.immutable.runId), 'B2_E8_QUERY_RETAINS_PINNED_RUN').toBe(true);
    } finally { held.release(); }
    await traffic.drain.wait(); await expect(recoverButton(page)).toBeEnabled();
    await expect(page.getByText('복습 저장 결과를 아직 확정하지 못했어요. 새 저장을 만들지 말고 같은 저장을 확인해 주세요.', { exact: true })).toBeVisible();
    const writes = qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method === 'PATCH').length;
    await page.goto(captureUrl(sample.typed.id)); await foreground(page); await startButton(page).click();
    await expect(page.getByText('복습 저장 결과를 아직 확정하지 못했어요. 새 저장을 만들지 말고 같은 저장을 확인해 주세요.', { exact: true })).toBeVisible();
    await expect(question(page)).toHaveCount(0); await expect(button(page, '기록형 복습 종료 확인')).toHaveCount(0);
    expect(qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method === 'PATCH').length).toBe(writes);
    const reloaded = await native(page), reloadedRun = runs(reloaded).find(row => row.immutable.runId === run.immutable.runId);
    expect(Boolean(reloadedRun?.state.lifecycle === 'retiring' && canonical(reloadedRun) === canonical(retiringRun)
      && canonical(journals(reloaded).find(row => row.transitionId === retirementJournal.transitionId)) === canonical(retirementJournal)
      && !journals(reloaded).some(row => row.runId === run.immutable.runId && ['close_retirement', 'close_unavailable'].includes(row.operation.kind))), 'B2_E8_RELOAD_RETAINS_EXACT_RETIREMENT').toBe(true);
    const afterReload = languageDocument((await qa.readLanguage())[KEY] as string, 'array');
    expect(Boolean(canonical(afterReload.get([0, 'languageLastOperationV1'])) === canonical(legacyOperation)
      && afterReload.get([0, 'unknownSyntheticField']) === 'changed-through-owner-client'), 'B2_E8_RELOAD_NEVER_REDISPATCHES_LEGACY_SAVE').toBe(true);
    // A separate supported row exercises an acknowledged save whose local
    // closure aborts. The original unresolved episode remains untouched.
    await page.goto(captureUrl(sample.meaning.id)); await foreground(page); await begin(page, sample.meaning.id);
    await button(page, sample.meaningAnswer).click(); await expect(button(page, '복습 결과 저장 · 다음 문제')).toBeEnabled();
    await page.evaluate(() => window.__b2.armAbort('close_retirement'));
    await button(page, '복습 결과 저장 · 다음 문제').click(); await expect(recoverButton(page)).toBeEnabled();
    expect((await facts(page)).faulted).toBe(1);
    const acknowledged = await qa.readLanguage(), ackDoc = languageDocument(acknowledged[KEY] as string, 'array');
    requireTrue(ackDoc.get([1, 'reviewCount']) === 5 && typeof ackDoc.get([1, 'languageLastOperationV1', 'operationId']) === 'string', 'Legacy save was genuinely acknowledged before closure failure');
    const writesAtAck = qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method === 'PATCH').length;
    await recover(page);
    await expect.poll(async () => runs(await native(page)).some(row => row.immutable.rowKey === sample.meaning.id && row.state.lifecycle === 'closed'), { message: 'Read-first recovery finishes only the retained closure' }).toBe(true);
    expect(qa.traffic.entries.filter(entry => entry.table === 'language_user_state' && entry.method === 'PATCH').length).toBe(writesAtAck);
    equal(await qa.readLanguage(), acknowledged, 'Closure recovery never redispatches or edits original legacy schedule');
    await checkNativeSafety(page);
  });
});

test('E9 owner switch fences in-flight capture @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); const other = await qa.createAccount(); const otherSource = await seed(other);
    await enter(page, qa.account); await begin(page); await answer(page);
    const before = await native(page), hold = traffic.hold(rpc.append, 'response');
    await button(page, '서버 기록 확인').click(); await hold.arrived;
    const oldAppend = traffic.entries.find(entry => entry.name === rpc.append)!;
    requireTrue(oldAppend.upstream && oldAppend.status >= 200 && oldAppend.status < 300, 'Old-owner action actually reached PostgREST');
    await button(page, '로그아웃').click(); await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await page.getByLabel('이메일', { exact: true }).fill(other.email); await page.getByLabel('비밀번호', { exact: true }).fill(other.password);
    await button(page, 'AI 연이 시작').click(); await expect(button(page, '로그아웃')).toBeVisible(); await foreground(page);
    const mark = traffic.entries.length; hold.release(); await traffic.drain.wait();
    await reauthenticateFixtureAccount(other);
    equal(await qa.readLanguage(other), otherSource.state, 'Late old-owner action cannot mutate the new owner source');
    await expect(verified(page)).toHaveCount(0); await expect(page.locator('[data-review-surface="feedback"]')).toHaveCount(0);
    requireTrue(traffic.entries.slice(mark).every(entry => entry.body.expected_owner !== qa.account.id), 'No old-owner evidence delivery is dispatched after actual owner switch');
    const local = await native(page);
    equal(events(local).filter(event => event.ownerId === qa.account.id), events(before), 'Late callback cannot rewrite old-owner canonical events');
    requireTrue(!events(local).some(event => event.ownerId === other.id), 'New owner does not inherit old capture');
    const otherStatus = await status(other); expect(otherStatus.status).toBe('unenrolled');
    await reauthenticateFixtureAccount(qa.account);
    const oldStatus = await status(qa.account); requireTrue(oldStatus.currentContext?.highWater === 1, 'Independent original owner verifies only the already committed upstream event');
    await checkNativeSafety(page, false);
  });
});

test('E10 required reset retires scoped evidence @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    const source = await seed(qa.account); await enter(page, qa.account); await begin(page); await answer(page);
    const before = await native(page), generation = events(before)[0].generationId;
    const stale = page, settings = await context.newPage(); await settings.goto('/language/settings'); await foreground(settings);
    const panel = settings.getByRole('region', { name: '일본어 기록 초기화', exact: true });
    await panel.getByRole('button', { name: '일본어 기록 초기화하기', exact: true }).click();
    await panel.getByLabel('위의 일본어 기록이 영구 삭제되는 것을 확인했어요.', { exact: true }).check();
    await panel.getByLabel('확인을 위해 ‘초기화’를 입력해 주세요.', { exact: true }).fill('초기화');
    const hold = traffic.hold(rpc.reset, 'loss');
    await panel.getByRole('button', { name: '일본어 기록 영구 삭제', exact: true }).click(); await hold.arrived;
    const resetCall = traffic.entries.find(entry => entry.name === rpc.reset)!;
    requireTrue(resetCall.upstream && resetCall.status >= 200 && resetCall.status < 300, 'Synthetic-account reset reached actual server before response loss');
    hold.release(); await traffic.drain.wait();
    await expect.poll(async () => await settings.getByText('초기화 요청의 서버 처리 결과가 아직 확인되지 않았어요. 기록을 보존했으니 같은 요청으로 다시 확인해 주세요.', { exact: true }).isVisible()
      || await button(settings, '진행 중인 초기화 결과 확인하기').isVisible(), { message: 'Lost reset response exposes explicit same-request recovery' }).toBe(true);
    const uncertain = await qa.readLanguage(), marker = uncertain.languageRecordResetV1;
    requireTrue(typeof marker === 'string' && marker.endsWith(`|${resetCall.body.p_request_id}`), 'Authenticated marker binds the exact original reset request');
    await settings.reload();
    const recoveryPanel = settings.getByRole('region', { name: '일본어 기록 초기화', exact: true });
    await recoveryPanel.getByRole('button', { name: '진행 중인 초기화 결과 확인하기', exact: true }).click();
    await recoveryPanel.getByLabel('위의 일본어 기록이 영구 삭제되는 것을 확인했어요.', { exact: true }).check();
    await recoveryPanel.getByLabel('확인을 위해 ‘초기화’를 입력해 주세요.', { exact: true }).fill('초기화');
    await recoveryPanel.getByRole('button', { name: '같은 초기화 요청 확인', exact: true }).click();
    await expect(settings.getByText('일본어 기록을 초기화했어요. 유지되는 항목은 아래에서 확인해 주세요.', { exact: true })).toBeVisible();
    expect(traffic.count(rpc.reset)).toBe(1);
    const after = await qa.readLanguage();
    equal(after.integratedLearningSettingsV1, source.state.integratedLearningSettingsV1, 'Reader settings survive required reset');
    equal(after.learningSettings, source.state.learningSettings, 'Ordinary learning settings survive required reset');
    requireTrue(!Object.hasOwn(after, KEY), 'Actual reset removed course records');
    const afterStatus = await status(qa.account, { present: true, value: marker as string });
    requireTrue(afterStatus.currentContext && afterStatus.currentContext.generationId !== generation && afterStatus.currentContext.highWater === 0, 'Authenticated required reset rotates generation and retires old ledger');
    const local = await native(settings);
    for (const name of ['reviewRuns', 'itemExposures', 'reviewTransitions', 'events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes', 'admissions']) {
      requireTrue(!values<{ generationId?: string }>(local, name).some(row => row.generationId === generation), 'Native scoped cleanup removes every old-generation record');
    }
    const enrollmentCount = traffic.count(rpc.enroll), appendCount = traffic.count(rpc.append);
    await foreground(stale); await stale.reload(); await foreground(stale);
    await expect(startButton(stale)).toHaveCount(0); await expect(question(stale)).toHaveCount(0);
    expect(traffic.count(rpc.append)).toBe(appendCount); expect(traffic.count(rpc.enroll)).toBe(enrollmentCount);
    equal(await qa.readLanguage(), after, 'Stale page cannot republish cleared source or pending outbox');
    await settings.close();
  });
});

test('E11 native v3 migration and old-client refusal @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await enter(page, qa.account);
    const birth = await page.evaluate(() => window.__b2.createV3());
    const historical = await native(page); expect(historical.version).toBe(3);
    await startButton(page).click(); await expect(recoverButton(page)).toBeEnabled();
    requireTrue((await facts(page)).blocked === 1, 'Actual live v3 connection blocks the actual app upgrade');
    equal(await native(page), historical, 'Blocked upgrade preserves exact historical native keys and bytes');
    await page.evaluate(() => window.__b2.releaseV3());
    await expect.poll(async () => (await facts(page)).aborted, { message: 'Previously rejected native upgrade aborts after real blocker release' }).toBeGreaterThan(0);
    const released = await native(page); expect(released.version).toBe(3); equal(released, historical, 'Released rejected request does not publish a surprise v4 upgrade');
    await recover(page); await expect(recoverButton(page)).toBeEnabled();
    const upgraded = await native(page); expect(upgraded.version).toBe(4);
    for (const name of historical.names) equal(upgraded.rows[name], historical.rows[name], 'Migration preserves every exact v3 key and value');
    requireTrue(JSON.stringify(values(upgraded, 'incarnations')[0]) === birth, 'Unknown historical incarnation bytes are never promoted');
    equal(upgraded.names.filter(name => !historical.names.includes(name)).sort(), ['itemExposures', 'reviewRuns', 'reviewTransitions'], 'Actual v4 upgrade adds only the reviewed stores');
    expect(runs(upgraded).length).toBe(0); expect(events(upgraded).length).toBe(0); expect(values(upgraded, 'admissions').length).toBe(0);
    expect(traffic.count(rpc.enroll)).toBe(0); await expect(question(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__b2.oldOpen())).toBe('VersionError');
    await checkNativeSafety(page);
  });
});

test('E12 interrupted native transactions and explicit close @b2-enabled', async ({ page, context, qa }) => {
  await runObserved(context, async traffic => {
    await seed(qa.account); await page.setViewportSize({ width: 320, height: 844 }); await enter(page, qa.account); await begin(page);
    await noOverflow(page); await input(page).focus(); await expect(input(page)).toBeFocused();
    await input(page).fill('b2-native-abort-draft');
    await confirmDialog(page, button(page, '복습에서 삭제'), false);
    requireTrue(await input(page).inputValue() === 'b2-native-abort-draft', 'Canceled deletion preserves the draft');
    const before = await native(page);
    await page.evaluate(() => window.__b2.armAbort('answer')); await input(page).press('Enter');
    await expect(recoverButton(page)).toBeEnabled(); expect((await facts(page)).faulted).toBe(1);
    equal(events(await native(page)), events(before), 'A real aborted transaction publishes no answer event');
    await expect(page.locator('[data-review-surface="feedback"]')).toHaveCount(0); await expect(verified(page)).toHaveCount(0);
    await recover(page); await expect(button(page, '다시 풀어볼래요')).toBeEnabled();
    const acknowledged = await native(page); expect(events(acknowledged).length).toBe(2);
    await button(page, '다시 풀어볼래요').click(); await expect(input(page)).toBeEditable();
    await input(page).fill('b2-pending-local-ack');
    await page.evaluate(() => window.__b2.armAbort('compatibility_applied')); await input(page).press('Enter');
    await expect(recoverButton(page)).toBeEnabled();
    const pendingClose = await native(page), pendingRun = runs(pendingClose)[0], pendingHandoff = checkpoints(pendingClose)[0].handoff;
    requireTrue(pendingHandoff?.status === 'pending' && pendingRun.state.lifecycle === 'active', 'Committed answer still requires its exact compatibility acknowledgement');
    await awaitUnavailableCloseRefusal(page, traffic);
    const refusedClose = await native(page), retainedRun = runs(refusedClose).find(row => row.immutable.runId === pendingRun.immutable.runId);
    equal(retainedRun, pendingRun, 'Settled forbidden-close refusal preserves the exact pending run');
    equal(checkpoints(refusedClose).find(cp => cp.sourceSlotKey === pendingRun.immutable.sourceSlotKey)?.handoff, pendingHandoff, 'Settled forbidden-close refusal preserves the exact pending handoff');
    equal(events(refusedClose), events(pendingClose), 'Forbidden-close refusal leaves canonical events unchanged');
    equal(journals(refusedClose), journals(pendingClose), 'Forbidden-close refusal adds no journal transition');
    requireTrue(!journals(refusedClose).some(row => row.runId === pendingRun.immutable.runId && row.operation.kind === 'close_unavailable'), 'Exact refused run has no unavailable-close journal after the action settles');
    await page.reload(); await foreground(page); await startButton(page).click();
    await expect(button(page, '다시 풀어볼래요')).toBeEnabled();
    await button(page, '다시 풀어볼래요').click(); await expect(input(page)).toBeEditable();
    await page.evaluate(() => window.__b2.armReadAbort('reviewRuns')); await button(page, '힌트 볼래요').click();
    await expect(recoverButton(page)).toBeEnabled(); expect((await facts(page)).faulted).toBe(1);
    await expect(page.locator('[data-review-surface="hint"]')).toHaveCount(0);
    const peer = await context.newPage(); await peer.goto('/language/settings'); await foreground(peer);
    await expect.poll(() => page.evaluate(() => !document.hasFocus()), { message: 'Interruption uses genuine page blur' }).toBe(true);
    await foreground(page); requireTrue((await facts(page)).lifecycle.blur > 0, 'Real blur is observed');
    await confirmDialog(page, button(page, '기록형 복습 종료 확인'), true);
    await expect.poll(async () => runs(await native(page))[0].state.lifecycle, { message: 'Allowed unavailable close is proven by native readback' }).toBe('closed');
    requireTrue(journals(await native(page)).some(row => row.operation.kind === 'close_unavailable'), 'Explicit close has its own durable journal');
    const frozen = events(await native(page));
    await page.goto('/language/settings'); await foreground(page); await page.reload(); await foreground(page);
    equal(events(await native(page)), frozen, 'Real navigation, pagehide and reload never synthesize an answer or delivery');
    expect(traffic.count(rpc.append)).toBe(0); await noOverflow(page); await peer.close();
    // Bounded abort/read failures are actual native faults. Unbounded quota fill
    // is intentionally excluded; source/unit quota bounds remain a separate gate.
  });
});
