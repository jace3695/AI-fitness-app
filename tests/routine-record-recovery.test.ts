import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../lib/routine-record-recovery.ts';
import type { GrowthRoutineRow, GrowthSessionRow } from '../app/data/growthPlatform.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, target_minutes: 15 } as GrowthRoutineRow;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function environment() {
  return { storage: new Map<string, string>(), rows: new Map<string, GrowthSessionRow>(), owner, now: Date.now(),
    payloads: [] as Record<string, unknown>[], rpcRequests: [] as Record<string, unknown>[],
    resetRunning: false, lostResponse: false, noLocks: false, authCallbacks: new Set<Function>(), failTerminalReadback: false, schemaMissing: false, beforeRpc: null as (() => void) | null,
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
    setItem(key: string, value: string) { if (env.quota) throw Error('quota'); env.storage.set(key, value); if (env.failTerminalReadback && JSON.parse(value).lastConfirmed) { env.failTerminalReadback = false; throw Error('readback unavailable after commit'); } },
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
      auth: { getUser: async () => ({ data: { user: { id: env.owner } }, error: null }), onAuthStateChange(callback: Function) { env.authCallbacks.add(callback); return { data: { subscription: { unsubscribe: () => env.authCallbacks.delete(callback) } } }; } },
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
        assert.equal(name, 'save_routine_session');
        const execute = async () => {
          const payload = args.p_payload, held = env.hold;
          env.calls.push(`insert:${payload.id}`); env.payloads.push(structuredClone(payload)); env.rpcRequests.push(structuredClone(args));
          assert.ok(env.storage.get(drafts.routineDraftKey(payload.user_id as string)), 'checkpoint precedes insert');
          env.beforeRpc?.();
          if (env.schemaMissing) return { error: { code: 'PGRST202', message: 'function not found in schema cache' }, data: null };
          if (args.p_expected_owner !== env.owner || payload.user_id !== env.owner) return { error: { message: 'routine_owner_changed' }, data: null };
          if (args.p_expected_reset_marker !== env.marker) return { error: { message: 'routine_reset_changed' }, data: null };
          if (!env.failWrites) env.rows.set(payload.id as string, { ...payload, created_at: payload.updated_at } as GrowthSessionRow);
          if (held) { held.arrived.resolve(); await held.release.promise; }
          return { error: env.failWrites || env.lostResponse ? Error('offline') : null, data: null };
        };
        const query = { abortSignal() { return query; }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } };
        return query;
      },
    } },
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'record-reset', RECORD_RESET_STORAGE_EVENT: 'record-reset-storage', isRecordResetRunning: () => env.resetRunning, resetMarkerKey: () => 'ai-fitness-record-reset-growth' },
    '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' },
    '@/lib/routine-record-recovery': drafts,
  };
  const exports = {} as typeof import('../app/growth/useRoutineRecordRecovery');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/useRoutineRecordRecovery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Error, AbortSignal, Date: Clock, crypto, structuredClone, navigator: env.noLocks ? {} : { locks: { request: (_name: string, _options: unknown, run: () => unknown) => run() } },
    window: { localStorage: storage, confirm: () => { prompts++; return allowReset; },
      addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); },
      removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); },
    },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const render = () => { cursor = 0; const result = exports.useRoutineRecordRecovery(id); effects.splice(0).forEach(effect => effect()); return result; };
  render();
  return { env, render, unmount: () => cleanups.forEach(cleanup => cleanup?.()), emit(name: string, value: unknown = {}) { events.get(name)?.forEach(fn => fn(value)); }, switchAuth(next: string) { env.owner = next; env.authCallbacks.forEach(fn => fn('SIGNED_IN', { user: { id: next } })); }, setConfirmation: (value: boolean) => { allowReset = value; }, prompts: () => prompts };
}

async function ready(env = environment(), id = owner) { const qa = fixture(env, id); await flush(); await flush(); return qa; }
function manual(qa: ReturnType<typeof fixture>, changes: Record<string, unknown> = {}) {
  qa.render().changeForm('manual', { routineId: routine.id, date: '2026-10-08', open: true, minutes: '17', memo: '합성 메모', difficulty: 'too_easy', ...changes });
}
const saved = (qa: ReturnType<typeof fixture>) => JSON.parse(qa.env.storage.get(drafts.routineDraftKey(owner))!);

test('shipping routine hook synchronously displays and durably restores manual raw fields and active timer', async () => {
  const qa = await ready(); manual(qa, { minutes: '', status: 'partial', stopReason: 'tired' }); qa.render().start(routine); qa.render().changeForm('active', { memo: '진행', difficulty: 'difficult' }); await flush();
  const before = saved(qa); qa.unmount(); const restored = await ready(qa.env);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.render().draft)), before);
  assert.equal(restored.render().draft.manual.minutes, ''); assert.ok(restored.render().draft.active.startedAt);
});
for (const mode of ['active','manual','quick'] as const) test(`shipping ${mode} lost response then reload recovers one immutable ID with no second write`, async () => {
  const qa = await ready(); manual(qa); qa.render().start(routine); await flush(); qa.env.lostResponse = true;
  // The first read confirms absence, then POST commits; only the post-write read fails.
  qa.env.beforeRpc = () => { qa.env.failReads = true; };
  await qa.render().save(mode, routine); const pending = saved(qa).pending;
  assert.equal(qa.env.rows.size, 1); assert.equal(qa.render().draft.pending?.payload.id, pending.payload.id);
  qa.unmount(); const again = await ready(qa.env); await again.render().save(mode, null);
  assert.equal(qa.env.payloads.length, 1); assert.equal(saved(qa).pending.payload.id, pending.payload.id);
  qa.env.failReads = false; qa.env.beforeRpc = null; await again.render().save(mode, null);
  assert.equal(qa.env.rows.size, 1); assert.equal(qa.env.payloads.length, 1); assert.equal(saved(qa).lastConfirmed, pending.payload.id); assert.equal(saved(qa).pending, null);
});
test('confirmed absence retries exact frozen payload after reload without changing date/time/feedback', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.failWrites = true;
  await qa.render().save('manual', routine); const first = structuredClone(qa.env.payloads[0]);
  qa.unmount(); qa.env.now += 600000; const again = await ready(qa.env); qa.env.failWrites = false;
  await again.render().save('manual', null); assert.deepEqual(qa.env.payloads[1], first); assert.deepEqual(qa.env.rpcRequests[1], qa.env.rpcRequests[0]);
});
test('unavailable first read is unknown and never permits any write', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.failReads = true; await qa.render().save('manual', routine);
  assert.equal(qa.env.rows.size, 0); assert.equal(qa.env.payloads.length, 0); assert.ok(saved(qa).pending);
});
test('newer manual edits during save survive completion and reload while original payload stays immutable', async () => {
  const qa = await ready(); manual(qa); await flush(); const hold = { arrived: deferred(), release: deferred() }; qa.env.hold = hold;
  const saving = qa.render().save('manual', routine); await hold.arrived.promise;
  qa.render().changeForm('manual', { memo: '더 새로운 메모', minutes: '23', date: '2026-10-07', status: 'stopped', stopReason: 'interrupted' }); await flush(); hold.release.resolve(); await saving;
  assert.equal(qa.env.payloads[0].memo, '합성 메모'); assert.equal(saved(qa).manual.memo, '더 새로운 메모'); assert.equal(saved(qa).pending, null);
  qa.unmount(); const again = await ready(qa.env); assert.equal(again.render().draft.manual.minutes, '23'); assert.equal(again.render().draft.manual.status, 'stopped');
});
test('quota failure preserves visible raw input and blocks POST until explicit checkpoint retry', async () => {
  const qa = await ready(); qa.env.quota = true; manual(qa, { minutes: '0017' }); await flush();
  assert.equal(qa.render().draft.manual.minutes, '0017'); assert.equal(qa.render().storageError, true); await qa.render().save('manual', routine); assert.equal(qa.env.payloads.length, 0);
  qa.env.quota = false; await qa.render().retryCheckpoint(); await qa.render().save('manual', routine); assert.equal(qa.env.rows.size, 1);
});
test('same-origin stale tab cannot mint second attempt or overwrite newer input/tombstone', async () => {
  const qa = await ready(), second = await ready(qa.env); manual(qa); await flush();
  manual(second, { memo: 'stale' }); await flush(); assert.equal(second.render().storageError, true);
  await qa.render().save('manual', routine); const terminal = qa.env.storage.get(drafts.routineDraftKey(owner));
  await second.render().retryCheckpoint(); assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), terminal); assert.equal(qa.env.rows.size, 1);
});
test('a server-confirmed but unverified local terminal write blocks mutation until reload', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.failTerminalReadback = true; await qa.render().save('manual', routine);
  assert.ok(qa.render().confirmedRow); assert.equal(qa.render().ready, false); assert.equal(qa.render().storageError, false); assert.equal(saved(qa).pending, null);
  const bytes = qa.env.storage.get(drafts.routineDraftKey(owner)); manual(qa, { memo: 'must not overwrite' }); await qa.render().save('quick', routine);
  assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes); assert.equal(qa.env.rows.size, 1);
  qa.unmount(); const again = await ready(qa.env); assert.equal(again.render().ready, true); assert.equal(again.render().draft.pending, null);
});
test('A to B to A auth event invalidates old callback even without a React owner render', async () => {
  const qa = await ready(); manual(qa); await flush(); const hold = { arrived: deferred(), release: deferred() }; qa.env.hold = hold;
  const saving = qa.render().save('manual', routine); await hold.arrived.promise; const bytes = qa.env.storage.get(drafts.routineDraftKey(owner));
  qa.switchAuth(other); qa.switchAuth(owner); hold.release.resolve(); await saving;
  assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes); assert.equal(qa.render().confirmedRow, null); assert.equal(qa.render().ready, false);
  qa.unmount(); qa.env.hold = null; const again = await ready(qa.env); await again.render().save('manual', null); assert.equal(qa.env.payloads.length, 1);
});
test('B never restores A inputs; A can later recover its original request', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.failWrites = true; await qa.render().save('manual', routine); const bytes = qa.env.storage.get(drafts.routineDraftKey(owner));
  qa.unmount(); qa.env.owner = other; const b = await ready(qa.env, other); assert.equal(b.render().draft.manual.memo, ''); assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes);
  b.unmount(); qa.env.owner = owner; qa.env.failWrites = false; const a = await ready(qa.env); await a.render().save('manual', null); assert.equal(qa.env.rows.size, 1);
});
test('authoritative reset immediately before RPC rejects stale payload without direct INSERT fallback', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.beforeRpc = () => { qa.env.marker = '2026-10-09T12:00:00Z|reset'; };
  await qa.render().save('manual', routine); assert.equal(qa.env.rows.size, 0); assert.equal(qa.render().ready, false);
  qa.unmount(); const after = await ready(qa.env); assert.equal(after.render().draft.pending, null); assert.equal(after.render().draft.manual.memo, ''); assert.ok(saved(after).revision);
});
test('reset signal during asynchronous hydration cannot be undone by old marker continuation', async () => {
  const env = environment(); const qa = fixture(env); env.resetRunning = true; qa.emit('record-reset'); await flush(); await flush();
  assert.equal(qa.render().ready, false); assert.equal(env.storage.get(drafts.routineDraftKey(owner)), undefined);
});
test('server marker read failure cannot erase existing drafts or claim absence', async () => {
  const qa = await ready(); manual(qa); await flush(); const bytes = qa.env.storage.get(drafts.routineDraftKey(owner)); qa.unmount(); qa.env.failMarkerReads = true;
  const next = await ready(qa.env); assert.equal(next.render().ready, false); assert.equal(next.render().loadError, true); assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes);
});
test('missing RPC leaves immutable pending, without falling back to generic session insert', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.schemaMissing = true; await qa.render().save('manual', routine);
  assert.equal(qa.env.rows.size, 0); assert.ok(saved(qa).pending); assert.match(qa.render().notice, /업데이트/);
});
test('missing Web Locks fails closed without replacing existing bytes or allowing cloud writes', async () => {
  const env = environment(); env.noLocks = true; const qa = await ready(env); assert.equal(qa.render().ready, false); assert.equal(env.storage.size, 0); assert.equal(env.payloads.length, 0);
});
test('future schema and pending input extensions remain byte-for-byte untouched on load', async () => {
  for (const kind of ['root-version','pending-extension']) {
    const env = environment(), draft = drafts.emptyRoutineDraft(owner, null, '2026-10-09');
    if (kind === 'root-version') (draft as { version: number }).version = 2;
    else { draft.manual = { ...draft.manual, routineId: routine.id }; draft.pending = drafts.makeRoutineAttempt(owner, 'manual', draft.manual, routine, crypto.randomUUID(), '2026-10-09', new Date(env.now).toISOString()); draft.pending.input!.future = 'do not delete'; }
    const bytes = JSON.stringify(draft); env.storage.set(drafts.routineDraftKey(owner), bytes); const qa = await ready(env);
    assert.equal(qa.render().ready, false); assert.equal(env.storage.get(drafts.routineDraftKey(owner)), bytes);
  }
});
test('known-version opaque root and form fields survive save, terminal cleanup, and reset', async () => {
  const env = environment(), draft = drafts.emptyRoutineDraft(owner, null, '2026-10-09'); draft.future = { keep: true }; draft.manual.extra = 'opaque'; draft.active.extra = 'timer'; env.storage.set(drafts.routineDraftKey(owner), JSON.stringify(draft));
  const qa = await ready(env); manual(qa); await flush(); await qa.render().save('manual', routine);
  assert.deepEqual(saved(qa).future, { keep: true }); assert.equal(saved(qa).manual.extra, 'opaque');
  qa.unmount(); env.marker = 'new reset'; const reset = await ready(env); assert.deepEqual(saved(reset).future, { keep: true }); assert.equal(saved(reset).manual.extra, 'opaque'); assert.equal(saved(reset).active.extra, 'timer');
});
test('quick completion explicitly records time unknown without target minutes or fabricated timestamps', async () => {
  const qa = await ready(); await qa.render().save('quick', routine); const p = qa.env.payloads[0];
  assert.equal(p.actual_minutes, 0); assert.equal((p.metrics as Record<string, unknown>).actualMinutesRecorded, false); assert.equal(p.started_at, null); assert.equal(p.ended_at, null);
});
test('active stopped record retains exact time provenance alongside the reported stop reason', async () => {
  const qa = await ready(); qa.render().start(routine); await flush();
  qa.render().changeForm('active', { status: 'stopped', stopReason: 'tired' }); await flush();
  await qa.render().save('active', routine);
  assert.equal(qa.env.payloads.length, 1);
  assert.deepEqual(qa.env.payloads[0].metrics, { recordMode: 'active', actualMinutesRecorded: true, stopReason: 'tired' });
  assert.equal(qa.env.payloads[0].status, 'stopped');
  assert.equal(qa.env.payloads[0].actual_minutes, 0);
  assert.equal(qa.env.payloads[0].planned_minutes, routine.target_minutes);
});
test('zero elapsed is zero; reversed or over-one-day timers are not clamped into invented evidence', async () => {
  const qa = await ready(); qa.render().start(routine); await flush(); await qa.render().save('active', routine); assert.equal(qa.env.payloads[0].actual_minutes, 0);
  qa.render().start(routine); await flush(); qa.env.now -= 60000; await qa.render().save('active', routine); assert.equal(qa.env.payloads.length, 1); assert.match(qa.render().notice, /거꾸로/);
  qa.env.now += 2 * 86400000; await qa.render().save('active', routine); assert.equal(qa.env.payloads.length, 1);
});
test('any full-field server mismatch, including submillisecond timestamps, is a conflict', async () => {
  const qa = await ready(); manual(qa); await flush(); qa.env.beforeRpc = () => { qa.env.failReads = true; }; await qa.render().save('manual', routine);
  const pending = saved(qa).pending, row = qa.env.rows.get(pending.payload.id)!;
  qa.env.beforeRpc = null; qa.env.failReads = false; qa.env.rows.set(row.id, { ...row, updated_at: row.updated_at.replace(/\.\d{3}Z$/, '.000001Z') });
  await qa.render().save('manual', null); assert.ok(qa.render().draft.pending); assert.match(qa.render().notice, /달라요/); assert.equal(qa.env.payloads.length, 1);
});
test('auth mismatch hides old-owner fields immediately before parent owner prop catches up', async () => {
  const qa = await ready(); manual(qa, { memo: 'A private draft' }); await flush(); const bytes = qa.env.storage.get(drafts.routineDraftKey(owner));
  qa.switchAuth(other); assert.equal(qa.render().draft.manual.memo, ''); assert.equal(qa.render().ready, false);
  qa.switchAuth(owner); assert.equal(qa.render().draft.manual.memo, ''); assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes);
});
test('explicit active discard preserves extensions and terminal revision; cancellation and pending block it', async () => {
  const qa = await ready(); qa.render().start(routine); qa.render().changeForm('active', { memo: 'keep', extension: { x: 1 } }); await flush();
  const original = saved(qa); await qa.render().discardActive(); assert.equal(saved(qa).revision, original.revision);
  qa.setConfirmation(true); await qa.render().discardActive(); assert.equal(saved(qa).active.memo, ''); assert.deepEqual(saved(qa).active.extension, { x: 1 }); assert.notEqual(saved(qa).revision, original.revision);
  qa.render().start(routine); await flush(); qa.env.failWrites = true; await qa.render().save('active', routine); const bytes = qa.env.storage.get(drafts.routineDraftKey(owner)); await qa.render().discardActive(); assert.equal(qa.env.storage.get(drafts.routineDraftKey(owner)), bytes);
});
test('verified hydration owner mismatch never exposes recovered A inputs when auth events are absent', async () => {
  const env = environment(); const input = drafts.emptyRoutineDraft(owner, null, '2026-10-09'); input.manual.memo = 'private A'; env.storage.set(drafts.routineDraftKey(owner), JSON.stringify(input)); env.owner = other;
  const qa = await ready(env, owner); assert.equal(qa.render().ready, false); assert.equal(qa.render().draft.manual.memo, ''); assert.equal(env.storage.get(drafts.routineDraftKey(owner)), JSON.stringify(input));
});
test('owner mismatch discovered by save read hides A without requiring a delivered auth event', async () => {
  const qa = await ready(); manual(qa, { memo: 'private A' }); await flush(); qa.env.owner = other;
  await qa.render().save('manual', routine); assert.equal(qa.render().draft.manual.memo, ''); assert.equal(qa.render().ready, false); assert.equal(qa.env.payloads.length, 0);
});
test('nonzero submillisecond timestamp on any frozen row timestamp never matches', () => {
  const form = { ...drafts.emptyRoutineForm('2026-10-09'), routineId: routine.id, startedAt: '2026-10-09T10:00:00.000Z' };
  const attempt = drafts.makeRoutineAttempt(owner, 'active', form, routine, crypto.randomUUID(), '2026-10-09', '2026-10-09T10:01:00.000Z');
  const row = { ...attempt.payload, created_at: attempt.payload.updated_at };
  for (const key of ['started_at','ended_at','updated_at'] as const) assert.equal(drafts.routineRowMatches({ ...row, [key]: row[key]!.replace('.000Z', '.000001Z') }, attempt.payload), false);
});
test('enum fields reject arrays and objects instead of coercing property keys', () => {
  for (const field of ['difficulty', 'stopReason']) for (const malformed of [['appropriate'], ['tired'], {}, null, false, 0]) {
    const value = drafts.emptyRoutineDraft(owner, null, '2026-10-09'); (value.manual as Record<string, unknown>)[field] = malformed;
    assert.throws(() => drafts.parseRoutineDraft(JSON.stringify(value), owner), /routine_draft_invalid/);
  }
  const form = { ...drafts.emptyRoutineForm('2026-10-09'), routineId: routine.id, status: 'stopped' as const, stopReason: 'tired' };
  const attempt = drafts.makeRoutineAttempt(owner, 'manual', form, routine, crypto.randomUUID(), '2026-10-09', '2026-10-09T10:00:00Z');
  attempt.payload.metrics.stopReason = ['tired']; assert.throws(() => drafts.assertRoutinePayload(attempt.payload, owner), /routine_attempt_invalid/);
});
test('malformed reset read and false/undefined row data stay unknown, never authorize an insert', async () => {
  for (const value of [undefined, false, true, [], {}, { state: false }, { state: null }, { state: { 'ai-fitness-record-reset-growth': false } }]) assert.throws(() => drafts.readRoutineResetMarker(value), /routine_reset_unknown/);
  assert.equal(drafts.readRoutineResetMarker(null), null); assert.equal(drafts.readRoutineResetMarker({ state: {} }), null);
  const payload = drafts.makeRoutineAttempt(owner, 'quick', null, routine, crypto.randomUUID(), '2026-10-09', '2026-10-09T10:00:00Z').payload;
  let writes = 0;
  for (const value of [undefined, false, true, []]) await assert.rejects(drafts.confirmRoutineSave(payload, { assertCurrent: async () => {}, read: async () => ({ data: value as unknown as GrowthSessionRow, error: null }), insert: async () => { writes++; } }), /routine_save_unconfirmed/);
  assert.equal(writes, 0);
});
test('every persisted payload field is compared, with only equivalent timestamp rendering normalized', () => {
  const payload = drafts.makeRoutineAttempt(owner, 'quick', null, routine, crypto.randomUUID(), '2026-10-09', '2026-10-09T10:00:00Z').payload;
  const row = { ...payload, created_at: payload.updated_at };
  for (const [field, changed] of Object.entries({ id: other, user_id: other, routine_id: other, session_date: '2026-10-08', status: 'partial', planned_minutes: 16, actual_minutes: 1, memo: 'changed', source: 'typing', metrics: { recordMode: 'quick', actualMinutesRecorded: true }, started_at: payload.updated_at, ended_at: payload.updated_at, updated_at: '2026-10-09T10:00:01Z' })) assert.equal(drafts.routineRowMatches({ ...row, [field]: changed }, payload), false, field);
  assert.equal(drafts.routineRowMatches({ ...row, updated_at: '2026-10-09T19:00:00.000000+09:00' }, payload), true);
});
