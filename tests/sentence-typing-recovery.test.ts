import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../lib/sentence-typing-draft.ts';
import type { GrowthRoutineRow, GrowthSessionRow } from '../app/data/growthPlatform.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, target_minutes: 15 } as GrowthRoutineRow;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function environment() {
  return { storage: new Map<string, string>(), rows: new Map<string, GrowthSessionRow>(), owner, now: Date.now(),
    payloads: [] as Record<string, unknown>[], rpcRequests: [] as Record<string, unknown>[],
    schemaMissing: false, beforeRpc: null as (() => void) | null,
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
      auth: { getUser: async () => ({ data: { user: { id: env.owner } }, error: null }) },
      from(table: string) {
        const filters: Record<string, string> = {};
        const execute = async () => {
          if (table === 'user_app_state') return { data: env.failMarkerReads ? null : { state: { 'ai-fitness-record-reset-growth': env.marker } }, error: env.failMarkerReads ? Error('offline marker') : null };
          assert.equal(table, 'growth_sessions');
          env.calls.push(`read:${filters.id}`);
          const row = env.rows.get(filters.id);
          return { data: !env.failReads && row?.user_id === filters.user_id ? row : null, error: env.failReads ? Error('offline') : null };
        };
        const query = {
          select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; },
          abortSignal() { return query; },
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
          assert.ok(env.storage.get(drafts.sentenceTypingDraftKey(payload.user_id as string)), 'checkpoint precedes insert');
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
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'record-reset', RECORD_RESET_STORAGE_EVENT: 'record-reset-storage', isRecordResetRunning: () => false, resetMarkerKey: () => 'ai-fitness-record-reset-growth' },
    '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' },
    '@/lib/sentence-typing-draft': drafts,
  };
  const exports = {} as typeof import('../app/growth/typing/useSentenceTypingPractice');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/typing/useSentenceTypingPractice.ts', import.meta.url), 'utf8'), {
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
  const render = () => { cursor = 0; const result = exports.useSentenceTypingPractice(id, isOwnerActive); effects.splice(0).forEach(effect => effect()); return result; };
  render();
  return { env, render, unmount: () => cleanups.forEach(cleanup => cleanup?.()), setConfirmation: (value: boolean) => { allowReset = value; }, prompts: () => prompts };
}

test('shipping hook persists each input synchronously and restores timer, passage and reset cancellation after reload', async () => {
  const qa = fixture(); await flush();
  qa.render().reset(1); qa.render().changeInput('합성 입력');
  const before = JSON.parse(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner))!);
  assert.equal(qa.render().reset(2), false); assert.equal(qa.prompts(), 1);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), JSON.stringify(before));
  qa.unmount(); const reloaded = fixture(qa.env); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.render().draft)), before);
  reloaded.setConfirmation(true); assert.equal(reloaded.render().reset(2), true);
  assert.equal(reloaded.render().draft.typed, ''); assert.equal(reloaded.render().draft.startedAt, null);
  assert.equal(reloaded.render().draft.passageIndex, 2);
});

test('shipping hook persists unresolved payload; reload read failure cannot insert; later read recovery avoids duplicate', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('xx'); qa.env.failReads = true;
  await qa.render().save(routine);
  const before = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner))!;
  const pending = JSON.parse(before).pending;
  assert.equal(qa.render().saved, false); assert.equal(qa.render().reset(), false); assert.equal(qa.env.rows.size, 1);
  qa.unmount(); const reloaded = fixture(qa.env); await flush();
  await reloaded.render().save(routine);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), before);
  qa.env.failReads = false; await reloaded.render().save(routine);
  assert.equal(reloaded.render().saved, true);
  assert.equal(reloaded.render().confirmedRow?.id, pending.id);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), undefined);
});

test('confirmed absence after reload retries the same ID and exact timed payload', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('천천'); qa.env.failWrites = true;
  await qa.render().save(routine);
  const before = JSON.parse(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner))!).pending;
  qa.unmount(); qa.env.now += 60000; const reloaded = fixture(qa.env); await flush(); qa.env.failWrites = false;
  const mark = qa.env.calls.length; await reloaded.render().save(routine);
  assert.deepEqual(qa.env.calls.slice(mark), [`read:${before.id}`, `insert:${before.id}`, `read:${before.id}`]);
  assert.equal(qa.env.rows.get(before.id)?.ended_at, before.endedAt);
  assert.deepEqual(qa.env.rows.get(before.id)?.metrics, before.metrics);
  assert.equal(qa.env.payloads.length, 2);
  assert.deepEqual(qa.env.payloads[1], qa.env.payloads[0]);
  assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]);
  assert.equal(qa.env.payloads[0].updated_at, before.endedAt);
});

test('storage quota failure retains visible input and no cloud write begins before checkpoint recovery', async () => {
  const qa = fixture(); await flush(); qa.env.quota = true; qa.render().changeInput('보존');
  assert.equal(qa.render().draft.typed, '보존'); assert.equal(qa.render().storageError, true);
  await qa.render().save(routine); assert.deepEqual(qa.env.calls, []);
  qa.env.quota = false; qa.render().retryCheckpoint(); await qa.render().save(routine);
  assert.equal(qa.render().saved, true); assert.equal(qa.env.rows.size, 1);
});

test('in-flight A save cannot clear A checkpoint or populate B; A later recovers it read-only', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('A 입력');
  const held = { arrived: deferred(), release: deferred() }; qa.env.hold = held;
  const saving = qa.render().save(routine); await held.arrived.promise;
  const checkpoint = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner));
  qa.env.owner = other; qa.unmount(); const b = fixture(qa.env, other); await flush();
  held.release.resolve(); await saving;
  assert.equal(b.render().draft.typed, ''); assert.equal(b.render().saved, false);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), checkpoint);
  assert.equal(qa.env.rows.size, 1); assert.equal([...qa.env.rows.values()][0].user_id, owner);
  b.unmount(); qa.env.owner = owner; qa.env.hold = null; const a = fixture(qa.env); await flush();
  await a.render().save(routine); assert.equal(a.render().saved, true);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
});

test('app record reset invalidates previous recovery and a reset after load blocks reinsertion', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('초기화 전'); qa.env.marker = '2026-10-09T09:00:00Z|reset';
  await qa.render().save(routine); assert.equal(qa.env.calls.length, 0); assert.equal(qa.render().ready, false);
  qa.unmount(); const reloaded = fixture(qa.env); await flush();
  assert.equal(reloaded.render().draft.typed, ''); assert.equal(reloaded.render().draft.resetMarker, qa.env.marker);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), undefined);
});

test('failed local cleanup leaves a recoverable same-ID checkpoint despite confirmed cloud success', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('xx'); qa.env.removeFails = true;
  await qa.render().save(routine); assert.equal(qa.render().saved, true);
  assert.ok(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)));
  qa.unmount(); qa.env.removeFails = false; const reloaded = fixture(qa.env); await flush();
  await reloaded.render().save(routine); assert.equal(reloaded.render().saved, true);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
});

test('a different tab checkpoint blocks save and stays byte-for-byte preserved', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('현재 입력');
  const newer = JSON.stringify({ ...qa.render().draft, typed: '다른 창' });
  qa.env.storage.set(drafts.sentenceTypingDraftKey(owner), newer);
  await qa.render().save(routine);
  assert.equal(qa.env.calls.length, 0); assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), newer);
  assert.equal(qa.render().draft.typed, '현재 입력'); assert.equal(qa.render().storageError, true);
});

test('repeated save and reset clicks during an in-flight write keep one frozen request', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('반복 클릭');
  const held = { arrived: deferred(), release: deferred() }; qa.env.hold = held;
  const saving = qa.render().save(routine); await held.arrived.promise;
  const raw = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner));
  await qa.render().save(routine); qa.render().changeInput('변경 금지');
  assert.equal(qa.render().reset(), false); assert.equal(qa.prompts(), 0);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), raw);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
  held.release.resolve(); await saving; assert.equal(qa.render().saved, true);
});

test('a differing same-ID server row stays untouched and keeps the recovery payload locked', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('xx'); qa.env.failReads = true;
  await qa.render().save(routine);
  const raw = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner))!;
  const id = JSON.parse(raw).pending.id;
  const edited = { ...qa.env.rows.get(id)!, memo: 'server-side later edit' };
  qa.env.rows.set(id, edited); qa.env.failReads = false; await qa.render().save(routine);
  assert.equal(qa.render().saved, false); assert.match(qa.render().notice, /덮어쓰지/);
  assert.equal(qa.render().reset(), false);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), raw);
  assert.deepEqual(qa.env.rows.get(id), edited);
  assert.equal(qa.env.calls.filter(call => call.startsWith('insert:')).length, 1);
});


test('a reset after the marker GET is rejected by the fenced RPC and preserves recovery input', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('초기화 경합');
  qa.env.beforeRpc = () => { qa.env.marker = '2026-10-09T18:00:00Z|remote-reset'; qa.env.rows.clear(); };
  await qa.render().save(routine);
  assert.equal(qa.env.rows.size, 0); assert.equal(qa.render().saved, false); assert.equal(qa.render().ready, false);
  assert.equal(qa.render().draft.typed, '초기화 경합'); assert.match(qa.render().notice, /기록 초기화/);
  assert.ok(JSON.parse(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner))!).pending);
  await qa.render().save(routine); assert.equal(qa.env.rpcRequests.length, 1);
});

test('missing fenced-save deployment keeps the exact draft and cannot fall back to a direct INSERT', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('업데이트 대기'); qa.env.schemaMissing = true;
  await qa.render().save(routine);
  const raw = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner));
  assert.equal(qa.render().saved, false); assert.equal(qa.env.rows.size, 0); assert.match(qa.render().notice, /서버에 반영되지/);
  assert.equal(qa.render().reset(), false); assert.equal(qa.render().draft.typed, '업데이트 대기');
  qa.unmount(); qa.env.schemaMissing = false; qa.env.now += 60000;
  const reloaded = fixture(qa.env); await flush(); const mark = qa.env.calls.length; await reloaded.render().save(routine);
  const id = JSON.parse(raw!).pending.id;
  assert.deepEqual(qa.env.calls.slice(mark), [`read:${id}`, `insert:${id}`, `read:${id}`]);
  assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]); assert.equal(reloaded.render().saved, true);
});


test('unknown reset-marker load retains recovered input and stays locked until verified reload', async () => {
  const qa = fixture(); await flush(); qa.render().changeInput('연결 후 복구');
  const raw = qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)); qa.unmount(); qa.env.failMarkerReads = true;
  const reloaded = fixture(qa.env); await flush();
  assert.equal(reloaded.render().draft.typed, '연결 후 복구'); assert.equal(reloaded.render().ready, false);
  assert.equal(reloaded.render().loadError, true); assert.equal(reloaded.render().saved, false);
  reloaded.render().changeInput('덮어쓰면 안 됨'); await reloaded.render().save(routine);
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), raw); assert.deepEqual(qa.env.calls, []);
  qa.env.failMarkerReads = false; reloaded.render().retryLoad(); reloaded.render(); await flush();
  assert.equal(reloaded.render().ready, true); assert.equal(reloaded.render().draft.typed, '연결 후 복구');
  assert.equal(qa.env.storage.get(drafts.sentenceTypingDraftKey(owner)), raw);
});
