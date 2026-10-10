import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../lib/typing-basics-draft.ts';
import * as saveBoundary from '../lib/typing-session-recovery.ts';
import * as basics from '../app/data/typingBasics.ts';
import type { GrowthRoutineRow, GrowthSessionRow } from '../app/data/growthPlatform.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, target_minutes: 15 } as GrowthRoutineRow;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function environment() {
  return { storage: new Map<string, string>(), rows: new Map<string, GrowthSessionRow>(), owner, authOwner: null as string | null, now: Date.now(),
    payloads: [] as Record<string, unknown>[], rpcRequests: [] as Record<string, unknown>[],
    schemaMissing: false, resetRunning: false, progressFails: false, beforeRpc: null as (() => void) | null, beforeRead: null as (() => void) | null,
    marker: null as string | null, failMarkerReads: false, failReads: false, failWrites: false, quota: false, removeFails: false,
    calls: [] as string[], hold: null as { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null };
}

// Execute the shipping hook at synthetic auth/storage/PostgREST boundaries. These
// are deterministic unit checks, not browser, hosted DB, or device acceptance.
function fixture(env = environment(), id = owner) {
  const slots: unknown[] = [], effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  let cursor = 0, allowReset = false, prompts = 0;
  const storage = {
    getItem: (key: string) => env.storage.get(key) ?? null,
    setItem(key: string, value: string) { if (env.quota) throw Error('quota'); env.storage.set(key, value); },
    removeItem(key: string) { if (env.removeFails) throw Error('quota'); env.storage.delete(key); },
  };
  class Clock extends Date {
    constructor(value?: string | number) { super(value ?? env.now); }
    static now() { return env.now; }
  }
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useEffect(effect: () => void, deps: unknown[]) {
        const slot = cursor++; const old = slots[slot] as unknown[] | undefined;
        if (!old || old.some((value, i) => value !== deps[i])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); }
      },
    },
    '@/app/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: env.authOwner ?? env.owner } }, error: null }) },
      from(table: string) {
        const filters: Record<string, string> = {};
        const execute = async () => {
          if (table === 'user_app_state') return { data: env.failMarkerReads ? null : { state: { 'ai-fitness-record-reset-growth': env.marker } }, error: env.failMarkerReads ? Error('offline marker') : null };
          assert.equal(table, 'growth_sessions');
          if (!filters.id) return { data: env.progressFails ? null : [...env.rows.values()].filter(row => row.user_id === id && row.source === 'typing'), error: env.progressFails ? Error('progress offline') : null };
          env.calls.push(`read:${filters.id}`);
          env.beforeRead?.();
          const row = env.rows.get(filters.id);
          return { data: !env.failReads && row?.user_id === filters.user_id && row.user_id === (env.authOwner ?? env.owner) ? row : null, error: env.failReads ? Error('offline') : null };
        };
        const query = {
          select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; },
          contains() { return query; }, order() { return query; }, range() { return query; }, abortSignal() { return query; },
          maybeSingle: execute,
          then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); },
        };
        return query;
      },
      rpc(name: string, args: { p_payload: Record<string, unknown>; p_expected_owner: string; p_expected_reset_marker: string | null }) {
        assert.equal(name, 'save_sentence_typing_session');
        const execute = async () => {
          const payload = args.p_payload, held = env.hold;
          env.calls.push(`insert:${payload.id}`); env.payloads.push(structuredClone(payload)); env.rpcRequests.push(structuredClone(args));
          assert.ok(env.storage.get(drafts.typingBasicsDraftKey(payload.user_id as string)), 'checkpoint precedes insert');
          env.beforeRpc?.();
          if (env.schemaMissing) return { error: { code: 'PGRST202', message: 'function not found in schema cache' }, data: null };
          if (args.p_expected_owner !== env.owner || payload.user_id !== env.owner) return { error: { message: 'typing_owner_changed' }, data: null };
          if (args.p_expected_reset_marker !== env.marker) return { error: { message: 'typing_reset_changed' }, data: null };
          if (!env.failWrites) env.rows.set(payload.id as string, { ...payload, created_at: payload.updated_at } as GrowthSessionRow);
          if (held) { held.arrived.resolve(); await held.release.promise; }
          return { error: env.failWrites ? Error('offline') : null, data: null };
        };
        const query = { abortSignal() { return query; }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
        return query;
      },
    } },
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'record-reset', RECORD_RESET_STORAGE_EVENT: 'record-reset-storage', isRecordResetRunning: () => env.resetRunning, resetMarkerKey: () => 'ai-fitness-record-reset-growth' },
    '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' },
    '@/lib/typing-basics-draft': drafts,
    '@/lib/typing-session-recovery': saveBoundary,
    '@/app/data/typingBasics': basics,
  };
  const exports = {} as typeof import('../app/growth/typing/basics/useTypingBasicsPractice');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/typing/basics/useTypingBasicsPractice.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Error, AbortSignal, Date: Clock, crypto, navigator: { locks: { request: (_name: string, _options: unknown, run: () => unknown) => run() } },
    window: { localStorage: storage, confirm: () => { prompts++; return allowReset; },
      addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); },
      removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); },
    },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const isOwnerActive = (candidate: string) => env.owner === candidate;
  const render = () => { cursor = 0; const result = exports.useTypingBasicsPractice(id, isOwnerActive); effects.splice(0).forEach(effect => effect()); return result; };
  render();
  return { env, render, unmount: () => cleanups.forEach(cleanup => cleanup?.()), setConfirmation: (value: boolean) => { allowReset = value; }, prompts: () => prompts, emit: (name: string, event?: unknown) => events.get(name)?.forEach(callback => callback(event)) };
}

function complete(qa: ReturnType<typeof fixture>, checks = true) {
  for (const char of qa.render().draft.lesson.keys.slice(qa.render().draft.attempt.position)) {
    qa.env.now += 1000; qa.render().changeKey(basics.TYPING_KEYS[char].code);
  }
  if (checks) { qa.render().changeCheck(0, true); qa.render().changeCheck(1, true); }
}
const raw = (qa: ReturnType<typeof fixture>) => qa.env.storage.get(drafts.typingBasicsDraftKey(owner));

test('shipping basics hook checkpoints lesson, attempts, key mistakes and first/last times across reload and reset cancellation', async () => {
  const qa = fixture(); await flush(); qa.render().reset(1); qa.render().changeKey('KeyA'); qa.env.now += 2000; qa.render().changeKey('KeyD');
  const before = raw(qa)!;
  assert.equal(qa.render().reset(2), false); assert.equal(qa.prompts(), 1); assert.equal(raw(qa), before);
  qa.unmount(); qa.env.now += 60000; const reloaded = fixture(qa.env); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.render().draft)), JSON.parse(before));
  assert.equal(reloaded.render().draft.endedAt, null);
  complete(reloaded, false); reloaded.render().changeCheck(0, true);
  const finished = raw(reloaded)!; reloaded.unmount(); qa.env.now += 50000;
  const again = fixture(qa.env); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(again.render().draft)), JSON.parse(finished));
  assert.deepEqual([...again.render().draft.checks], [true, false]);
  await again.render().save(routine); assert.equal(qa.env.rows.size, 0);
  again.setConfirmation(true); assert.equal(again.render().reset(2), true);
  assert.equal(again.render().draft.lessonIndex, 2); assert.equal(again.render().draft.startedAt, null);
  assert.deepEqual(JSON.parse(JSON.stringify(again.render().draft.attempt)), basics.emptyTypingAttempt());
});

for (const committed of [true, false]) test(`shipping basics unresolved reload ${committed ? 'recovers committed row' : 'retries absent row'} with exact request`, async () => {
  const qa = fixture(); await flush(); qa.render().changeKey('KeyA'); complete(qa); qa.env.failReads = true; qa.env.failWrites = !committed;
  await qa.render().save(routine); const checkpoint = raw(qa)!, pending = JSON.parse(checkpoint).pending;
  assert.equal(qa.render().saved, false); assert.equal(qa.render().reset(), false);
  qa.unmount(); qa.env.now += 90000; const reloaded = fixture(qa.env); await flush();
  await reloaded.render().save(null); assert.equal(qa.env.payloads.length, 1); assert.equal(raw(qa), checkpoint);
  qa.env.failReads = false; qa.env.failWrites = false; const mark = qa.env.calls.length;
  await reloaded.render().save(null);
  assert.equal(reloaded.render().saved, true); assert.equal(reloaded.render().confirmedRow?.id, pending.id);
  assert.deepEqual(qa.env.calls.slice(mark), committed ? [`read:${pending.id}`] : [`read:${pending.id}`, `insert:${pending.id}`, `read:${pending.id}`]);
  if (!committed) assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]);
  assert.equal(qa.env.rows.size, 1); assert.equal(raw(qa), undefined);
  assert.deepEqual(qa.env.rows.get(pending.id)?.metrics, pending.metrics);
  assert.equal(qa.env.rows.get(pending.id)?.started_at, pending.startedAt); assert.equal(qa.env.rows.get(pending.id)?.ended_at, pending.endedAt);
});

test('quota failure preserves visible attempt and requires a checked checkpoint before save', async () => {
  const qa = fixture(); await flush(); qa.env.quota = true; qa.render().changeKey('KeyA');
  assert.equal(qa.render().draft.attempt.attempts, 1); assert.equal(qa.render().storageError, true);
  qa.render().changeKey('KeyF'); assert.equal(qa.render().draft.attempt.position, 0);
  await qa.render().save(routine); assert.deepEqual(qa.env.calls, []);
  qa.env.quota = false; qa.render().retryCheckpoint(); complete(qa); await qa.render().save(routine);
  assert.equal(qa.render().saved, true); assert.equal(qa.env.rows.size, 1);
});

test('pending-stage quota failure preserves its one UUID and blocks network until recovered', async () => {
  const qa = fixture(); await flush(); complete(qa); qa.env.quota = true; await qa.render().save(routine);
  const pending = qa.render().draft.pending; assert.ok(pending); assert.equal(qa.env.calls.length, 0);
  qa.env.quota = false; qa.render().retryCheckpoint(); await qa.render().save(routine);
  assert.equal(qa.render().saved, true); assert.deepEqual(qa.env.calls, [`read:${pending.id}`, `insert:${pending.id}`, `read:${pending.id}`]);
});

test('A in-flight save cannot clear A checkpoint or populate B; A recovers without another write', async () => {
  const qa = fixture(); await flush(); complete(qa);
  const held = { arrived: deferred(), release: deferred() }; qa.env.hold = held;
  const saving = qa.render().save(routine); await held.arrived.promise; const checkpoint = raw(qa);
  qa.env.owner = other; qa.unmount(); const b = fixture(qa.env, other); await flush(); held.release.resolve(); await saving;
  assert.equal(b.render().draft.attempt.attempts, 0); assert.equal(b.render().saved, false); assert.equal(raw(qa), checkpoint);
  b.unmount(); qa.env.owner = owner; qa.env.hold = null; const a = fixture(qa.env); await flush();
  await a.render().save(routine); assert.equal(a.render().saved, true); assert.equal(qa.env.payloads.length, 1);
});

test('other-tab input is never overwritten by a stale save or checkpoint retry', async () => {
  const qa = fixture(); await flush(); complete(qa); const current = raw(qa)!;
  const newer = JSON.stringify({ ...JSON.parse(current), lesson: { ...qa.render().draft.lesson, title: '다른 창' } });
  qa.env.storage.set(drafts.typingBasicsDraftKey(owner), newer); await qa.render().save(routine);
  assert.equal(qa.render().storageError, true); assert.equal(qa.env.calls.length, 0); assert.equal(raw(qa), newer);
  qa.render().retryCheckpoint(); assert.equal(raw(qa), newer); assert.notEqual(qa.render().draft.lesson.title, '다른 창');
});

test('a reset after GET is rejected by the existing fenced RPC; reload cannot resurrect the draft', async () => {
  const qa = fixture(); await flush(); complete(qa);
  qa.env.beforeRpc = () => { qa.env.marker = '2026-10-09T19:00:00Z|remote-reset'; qa.env.rows.clear(); };
  await qa.render().save(routine);
  assert.equal(qa.env.rows.size, 0); assert.equal(qa.render().saved, false); assert.equal(qa.render().ready, false);
  assert.equal(qa.render().draft.attempt.position, 12); assert.ok(JSON.parse(raw(qa)!).pending);
  await qa.render().save(routine); assert.equal(qa.env.rpcRequests.length, 1);
  qa.unmount(); const reloaded = fixture(qa.env); await flush();
  assert.equal(reloaded.render().draft.attempt.attempts, 0); assert.equal(reloaded.render().draft.resetMarker, qa.env.marker);
  assert.equal(raw(qa), undefined); assert.equal(qa.env.rows.size, 0);
});

test('unknown marker, progress read error and malformed recovery stay locked without dropping raw data', async () => {
  for (const failure of ['failMarkerReads', 'progressFails', 'malformed'] as const) {
    const qa = fixture(); await flush(); qa.render().changeKey('KeyA'); const valid = raw(qa)!; qa.unmount();
    if (failure === 'malformed') qa.env.storage.set(drafts.typingBasicsDraftKey(owner), '{'); else qa.env[failure] = true;
    const checkpoint = raw(qa), reloaded = fixture(qa.env); await flush();
    assert.equal(reloaded.render().ready, false); assert.equal(raw(qa), checkpoint);
    reloaded.render().changeKey('KeyF'); await reloaded.render().save(routine); assert.equal(raw(qa), checkpoint); assert.equal(qa.env.calls.length, 0);
    if (failure === 'malformed') qa.env.storage.set(drafts.typingBasicsDraftKey(owner), valid); else qa.env[failure] = false;
    reloaded.render().retryLoad(); reloaded.render(); await flush(); assert.equal(reloaded.render().ready, true); assert.equal(raw(qa), valid);
  }
});

test('missing RPC deployment keeps pending locked; exact read-first retry succeeds without direct fallback', async () => {
  const qa = fixture(); await flush(); complete(qa); qa.env.schemaMissing = true; await qa.render().save(routine);
  const checkpoint = raw(qa)!; assert.equal(qa.render().saved, false); assert.equal(qa.env.rows.size, 0); assert.match(qa.render().notice, /서버에 반영되지/);
  assert.equal(qa.render().reset(), false); qa.unmount(); qa.env.schemaMissing = false;
  const reloaded = fixture(qa.env); await flush(); await reloaded.render().save(routine);
  assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]); assert.equal(reloaded.render().saved, true);
  assert.equal(reloaded.render().confirmedRow?.id, JSON.parse(checkpoint).pending.id);
});

test('same-ID conflict keeps the recovery payload and existing server row intact', async () => {
  const qa = fixture(); await flush(); complete(qa); qa.env.failReads = true; await qa.render().save(routine);
  const checkpoint = raw(qa)!, id = JSON.parse(checkpoint).pending.id;
  const edited = { ...qa.env.rows.get(id)!, metrics: { ...qa.env.rows.get(id)!.metrics, keyAccuracy: 99 } };
  qa.env.rows.set(id, edited); qa.env.failReads = false; await qa.render().save(routine);
  assert.equal(qa.render().saved, false); assert.match(qa.render().notice, /덮어쓰지/); assert.equal(raw(qa), checkpoint);
  assert.equal(qa.render().reset(), false); assert.deepEqual(qa.env.rows.get(id), edited); assert.equal(qa.env.payloads.length, 1);
});

test('repeated saves, resets, key and check changes freeze the one pending request', async () => {
  const qa = fixture(); await flush(); complete(qa);
  const held = { arrived: deferred(), release: deferred() }; qa.env.hold = held;
  const saving = qa.render().save(routine); await held.arrived.promise; const checkpoint = raw(qa);
  await qa.render().save(routine); qa.render().changeKey('KeyF'); qa.render().changeCheck(0, false);
  assert.equal(qa.render().reset(), false); assert.equal(qa.prompts(), 0); assert.equal(raw(qa), checkpoint); assert.equal(qa.env.payloads.length, 1);
  held.release.resolve(); await saving; assert.equal(qa.render().saved, true);
});

test('failed local cleanup remains a same-ID recoverable checkpoint after confirmed success', async () => {
  const qa = fixture(); await flush(); complete(qa); qa.env.removeFails = true; await qa.render().save(routine);
  assert.equal(qa.render().saved, true); assert.ok(raw(qa)); qa.unmount(); qa.env.removeFails = false;
  const reloaded = fixture(qa.env); await flush(); await reloaded.render().save(routine);
  assert.equal(reloaded.render().saved, true); assert.equal(qa.env.payloads.length, 1); assert.equal(raw(qa), undefined);
});

test('multi-day pause preserves actual timestamps and explains the server bound without clamping or POST', async () => {
  const qa = fixture(); await flush(); qa.render().changeKey('KeyF'); const started = qa.render().draft.startedAt;
  qa.env.now += 2 * 86400000; complete(qa); const checkpoint = raw(qa);
  await qa.render().save(routine);
  assert.match(qa.render().notice, /24시간/); assert.equal(qa.render().storageError, false); assert.equal(qa.env.payloads.length, 0);
  assert.equal(raw(qa), checkpoint); assert.equal(qa.render().draft.startedAt, started); assert.equal(qa.render().draft.pending, null);
  assert.equal(qa.render().reset(), false); assert.equal(raw(qa), checkpoint);
  qa.setConfirmation(true); assert.equal(qa.render().reset(), true);
});

test('record-reset events disable recovery input and cross-tab storage events cannot silently replace it', async () => {
  const qa = fixture(); await flush(); qa.render().changeKey('KeyF');
  qa.emit('storage', { key: drafts.typingBasicsDraftKey(owner), newValue: 'another tab' });
  assert.equal(qa.render().storageError, true); assert.equal(qa.render().draft.attempt.position, 1);
  qa.env.resetRunning = true; qa.emit('record-reset'); assert.equal(qa.render().ready, false);
  await qa.render().save(routine); assert.equal(qa.env.payloads.length, 0);
});

test('an app-reset event during initial loading cannot be undone by the late progress response', async () => {
  const qa = fixture(); qa.env.resetRunning = true; qa.emit('record-reset'); await flush();
  assert.equal(qa.render().ready, false); assert.match(qa.render().notice, /기록 초기화/);
  qa.render().changeKey('KeyF'); qa.render().retryCheckpoint(); await qa.render().save(routine);
  assert.equal(raw(qa), undefined); assert.equal(qa.env.payloads.length, 0);
});

for (const emitsEvent of [true, false]) test(`a newer checkpoint during initialization stays locked until explicit reload (${emitsEvent ? 'storage event' : 'missed event'})`, async () => {
  const env = environment();
  const initial = { ...drafts.emptyTypingBasicsDraft(owner, null), startedAt: env.now, attempt: { position: 1, attempts: 1, mistakes: {} } };
  env.storage.set(drafts.typingBasicsDraftKey(owner), JSON.stringify(initial));
  const qa = fixture(env);
  const newer = JSON.stringify({ ...initial, attempt: { position: 2, attempts: 2, mistakes: {} } });
  env.storage.set(drafts.typingBasicsDraftKey(owner), newer);
  if (emitsEvent) qa.emit('storage', { key: drafts.typingBasicsDraftKey(owner), newValue: newer });
  await flush();
  assert.equal(qa.render().ready, false);
  assert.equal(qa.render().storageError, true);
  assert.equal(qa.render().loadError, true);
  assert.equal(qa.render().draft.attempt.position, 1);
  qa.render().changeKey('KeyJ'); qa.render().retryCheckpoint(); await qa.render().save(routine);
  assert.equal(raw(qa), newer); assert.equal(env.payloads.length, 0);
  qa.render().retryLoad(); qa.render(); await flush();
  assert.equal(qa.render().ready, true); assert.equal(qa.render().storageError, false);
  assert.equal(qa.render().draft.attempt.position, 2); assert.equal(raw(qa), newer);
});

test('same-lesson reset keeps a valid historical snapshot even when its index no longer exists', async () => {
  const env = environment();
  const historical = { ...drafts.emptyTypingBasicsDraft(owner, null), lessonIndex: 99,
    lesson: { id: 'previous-lesson', title: '이전 자리 수업', goal: '이전 안내', keys: 'jfjf' },
    startedAt: env.now, attempt: { position: 1, attempts: 2, mistakes: { j: 1 } } };
  env.storage.set(drafts.typingBasicsDraftKey(owner), JSON.stringify(historical));
  const qa = fixture(env); await flush();
  assert.equal(qa.render().ready, true);
  assert.equal(qa.render().reset(), false); assert.deepEqual(JSON.parse(raw(qa)!), historical);
  qa.setConfirmation(true); assert.equal(qa.render().reset(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(qa.render().draft.lesson)), historical.lesson);
  assert.equal(qa.render().draft.lessonIndex, historical.lessonIndex);
  assert.equal(qa.render().draft.startedAt, null); assert.equal(qa.render().draft.attempt.attempts, 0);
  assert.equal(qa.render().reset(0), true); assert.equal(qa.render().draft.lesson.id, basics.TYPING_LESSONS[0].id);
});

test('a stale owner UI cannot treat an RLS-empty read under B as confirmed absence for A', async () => {
  const qa = fixture(); await flush(); complete(qa); qa.env.failReads = true; qa.env.failWrites = true;
  await qa.render().save(routine); const checkpoint = raw(qa)!, id = JSON.parse(checkpoint).pending.id;
  qa.env.failReads = false; qa.env.failWrites = false;
  qa.env.beforeRead = () => { qa.env.authOwner = other; };
  const mark = qa.env.calls.length; await qa.render().save(null);
  assert.deepEqual(qa.env.calls.slice(mark), [`read:${id}`]);
  assert.equal(qa.render().saved, false); assert.equal(qa.env.payloads.length, 1); assert.equal(raw(qa), checkpoint);
  qa.env.authOwner = owner; qa.env.beforeRead = null; await qa.render().save(null);
  assert.equal(qa.render().saved, true); assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]);
});

test('saving a removed historical lesson preserves its row without counting it in the current course', async () => {
  const env = environment();
  const historical = { ...drafts.emptyTypingBasicsDraft(owner, null), lessonIndex: 99,
    lesson: { id: 'previous-lesson', title: '이전 자리 수업', goal: '이전 안내', keys: 'jfjf' } };
  env.storage.set(drafts.typingBasicsDraftKey(owner), JSON.stringify(historical));
  const qa = fixture(env); await flush(); complete(qa); await qa.render().save(routine);
  assert.equal(qa.render().saved, true); assert.equal(env.rows.size, 1);
  assert.equal([...env.rows.values()][0].metrics.lessonId, historical.lesson.id);
  assert.equal(qa.render().completed.has(historical.lesson.id), false);
});
