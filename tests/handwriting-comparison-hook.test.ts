import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { SavedHandwritingReader, ComparisonReadError, type ComparisonTransport } from '../lib/handwriting-comparison-reader.ts';
import * as readerModule from '../lib/handwriting-comparison-reader.ts';
const owner = '00000000-0000-4000-8000-000000000901';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhcEAAAAASUVORK5CYII=', 'base64'));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Row = { id: string; user_id: string; source: string; status: string; session_date: string; created_at: string; metrics: Record<string, unknown> };
function row(n = 1, legacy = false): Row { return { id: id(n), user_id: owner, source: 'handwriting', status: 'completed', session_date: '2026-10-09', created_at: '2026-10-09T12:00:00.000Z', metrics: { resourceId: id(n + 10000), guideText: `합성 ${n}`, strokes: 2, activeSeconds: 0, occupiedWidth: 10, occupiedHeight: 20, pressureRange: null, ...(!legacy ? { practiceKind: 'free-handwriting-v1', pngSha256: sha(png) } : {}) } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(count = 3) {
  const env = { owner, epoch: 'epoch-1', marker: null as string | null, active: true, epochFails: false, authFails: false, markerFails: false, pageFails: false,
    sessions: new Map<string, Row>(), resources: new Map<string, Record<string, unknown>>(), objects: new Map<string, Blob>(), calls: [] as string[], urls: [] as string[], revoked: [] as string[],
    block: null as { name: string; occurrence: number; arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null, counters: new Map<string, number>(), decoded: { width: 1, height: 1 } };
  for (let n = 1; n <= count; n++) { const s = row(n, n === 2), path = `${owner}/2026-10-09/${n === 2 ? '' : 'free-'}handwriting-${s.metrics.resourceId}.png`; env.sessions.set(s.id, s); env.resources.set(String(s.metrics.resourceId), { id: s.metrics.resourceId, user_id: owner, storage_path: path, size_bytes: png.length, mime_type: 'image/png' }); env.objects.set(path, new Blob([new Uint8Array(png)], { type: 'image/png' })); }
  const stage = async (name: string) => { env.calls.push(name); const nth = (env.counters.get(name) ?? 0) + 1; env.counters.set(name, nth); const gate = env.block; if (gate?.name === name && gate.occurrence === nth) { gate.arrived.resolve(); await gate.release.promise; } };
  const transport: ComparisonTransport = {
    active: () => env.active, epoch: () => { if (env.epochFails) throw Error('epoch'); return env.epoch; },
    async authenticate() { await stage('auth'); if (env.authFails) throw Error('offline'); return env.owner; },
    async marker(candidate) { assert.equal(candidate, owner); await stage('marker'); if (env.markerFails) throw Error('offline'); return env.marker; },
    async page(candidate, after, limit) { assert.equal(candidate, owner); await stage('page'); if (env.pageFails) throw Error('offline'); return [...env.sessions.values()].filter(r => !after || r.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map(r => structuredClone(r)); },
    async session(candidate, key) { assert.equal(candidate, owner); await stage('session'); return structuredClone(env.sessions.get(key) ?? null); },
    async resource(candidate, key) { assert.equal(candidate, owner); await stage('resource'); return structuredClone(env.resources.get(key) ?? null); },
    async links(candidate, key) { assert.equal(candidate, owner); await stage('links'); return [...env.sessions.values()].filter(r => r.metrics.resourceId === key).map(r => ({ id: r.id })).slice(0, 2); },
    async download(path) { await stage('download'); const blob = env.objects.get(path); if (!blob) throw new ComparisonReadError('image_unavailable'); return blob; },
    async hash(bytes) { await stage('hash'); return sha(bytes); },
    async decode() { await stage('decode'); return env.decoded; },
    createUrl() { const url = `blob:synthetic-${env.urls.length}`; env.urls.push(url); return url; },
    revokeUrl(url) { assert.ok(!env.revoked.includes(url), `double revoke: ${url}`); env.revoked.push(url); },
  };
  const reader = new SavedHandwritingReader(owner, transport);
  return { env, transport, reader, block(name: string, occurrence = 1) { env.counters.clear(); const gate = { name, occurrence, arrived: deferred(), release: deferred() }; env.block = gate; return gate; } };
}

test('shipping read controller verifies original downloaded bytes and labels legacy without hashing/backfill', async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); assert.equal(q.reader.snapshot().entries.length, 3);
  assert.equal(q.reader.snapshot().panes[0].status, 'empty'); await q.reader.select(0, id(1)); await q.reader.select(1, id(2));
  assert.equal(q.reader.snapshot().panes[0].status, 'ready_verified'); assert.equal(q.reader.snapshot().panes[1].status, 'ready_legacy_unverified');
  assert.equal(q.env.calls.filter(v => v === 'hash').length, 1); assert.notEqual(q.reader.snapshot().panes[0].url, q.reader.snapshot().panes[1].url);
  assert.equal(q.env.sessions.size, 3); assert.equal(q.env.resources.size, 3);
});
test('same attempt/resource cannot occupy two panes; swapping keeps identities and revokes old URLs once', async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(1)); await q.reader.select(1, id(1));
  assert.equal(q.reader.snapshot().panes[1].status, 'unlinked_or_unsupported'); await q.reader.select(1, id(2)); await q.reader.swap();
  assert.deepEqual(q.reader.snapshot().panes.map(p => p.id), [id(2), id(1)]); assert.equal(q.env.revoked.length, 2);
  const pane = q.reader.snapshot().panes[0]; q.reader.imageError(0, pane.token - 1, pane.url); assert.equal(q.reader.snapshot().panes[0].status, 'ready_legacy_unverified');
  q.reader.imageError(0, pane.token, pane.url); assert.equal(q.reader.snapshot().panes[0].status, 'image_unavailable'); assert.equal(q.reader.snapshot().panes[1].status, 'ready_verified');
});
test('missing resource, failed read, missing object and valid hash mismatch are distinct', async t => {
  for (const fault of ['metadata', 'network', 'object', 'hash', 'decode', 'size', 'mime', 'signature', 'dimensions']) {
    const q = fixture(); t.after(() => q.reader.dispose()); const resource = q.env.resources.get(id(10001))!;
    if (fault === 'metadata') q.env.resources.delete(id(10001));
    if (fault === 'network') q.transport.resource = async () => { throw Error('offline'); };
    if (fault === 'object') q.env.objects.clear();
    if (fault === 'hash') q.env.sessions.get(id(1))!.metrics.pngSha256 = 'a'.repeat(64);
    if (fault === 'decode') q.transport.decode = async () => { throw Error('decode'); };
    if (fault === 'size') resource.size_bytes = 2;
    if (fault === 'mime') q.env.objects.set(String(resource.storage_path), new Blob([new Uint8Array(png)], { type: 'image/jpeg' }));
    if (fault === 'signature') q.env.objects.set(String(resource.storage_path), new Blob([new Uint8Array(png.length)], { type: 'image/png' }));
    if (fault === 'dimensions') q.env.decoded.width = 99;
    await q.reader.refresh(); await q.reader.select(0, id(1));
    assert.equal(q.reader.snapshot().panes[0].status, fault === 'metadata' ? 'metadata_missing' : fault === 'network' ? 'read_unconfirmed' : fault === 'hash' ? 'integrity_mismatch' : 'image_unavailable', fault);
    assert.equal(q.env.urls.length, 0, fault);
  }
});
test('path attacks and ambiguous resource links fail before Storage, even duplicate outside loaded first page', async t => {
  for (const attack of ['path', 'duplicate']) {
    const q = fixture(51); t.after(() => q.reader.dispose());
    if (attack === 'path') q.env.resources.get(id(10001))!.storage_path = `${owner}/learning/film-v1/page-02.webp`;
    else q.env.sessions.get(id(51))!.metrics.resourceId = id(10001);
    await q.reader.refresh(); assert.equal(q.reader.snapshot().entries.length, 50); await q.reader.select(0, id(1));
    assert.equal(q.reader.snapshot().panes[0].status, 'unlinked_or_unsupported'); assert.equal(q.env.calls.includes('download'), false);
  }
});
for (const [stage, occurrence] of [['auth', 1], ['marker', 1], ['session', 1], ['resource', 1], ['links', 1], ['download', 1], ['hash', 1], ['decode', 1], ['session', 2], ['resource', 2], ['links', 2], ['marker', 2]] as const) {
  test(`owner epoch A→B→A during ${stage} #${occurrence} clears both panes without stale success/error`, async t => {
    const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(2));
    const gate = q.block(stage, occurrence), loading = q.reader.select(1, id(1)); await gate.arrived.promise;
    q.env.epoch = 'epoch-2'; q.env.owner = id(900); q.env.owner = owner; q.env.epoch = 'epoch-3'; gate.release.resolve(); await loading;
    assert.equal(q.reader.snapshot().blocked, true); assert.ok(q.reader.snapshot().panes.every(p => !p.url && p.id === null)); assert.equal(q.env.urls.length, q.env.revoked.length);
  });
}
test('selection replacement, clear and disposal abort delayed work without waiting for transport completion', async () => {
  for (const mode of ['replace', 'clear', 'dispose']) {
    const q = fixture(); await q.reader.refresh(); const gate = q.block('download'), old = q.reader.select(0, id(1)); await gate.arrived.promise;
    if (mode === 'replace') { q.env.block = null; await q.reader.select(0, id(3)); } else if (mode === 'clear') q.reader.clear(0); else q.reader.dispose();
    await old; gate.release.resolve(); await tick();
    assert.equal(q.reader.snapshot().panes[0].id, mode === 'replace' ? id(3) : null); assert.equal(q.env.urls.length, mode === 'replace' ? 1 : 0); q.reader.dispose();
  }
});
test('remote reset at final marker read clears the other ready pane and retained resources never restore attempts', async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(2));
  const gate = q.block('marker', 2), load = q.reader.select(1, id(1)); await gate.arrived.promise; q.env.marker = 'reset-2'; q.env.sessions.clear(); gate.release.resolve(); await load;
  assert.equal(q.reader.snapshot().blocked, true); assert.equal(q.env.urls.length, q.env.revoked.length); await q.reader.refresh(); assert.equal(q.reader.snapshot().entries.length, 0); assert.equal(q.env.resources.size, 3);
});
test('session deletion and relevant metadata drift after decode prevent publication; irrelevant resource edits do not', async t => {
  for (const change of ['delete', 'context', 'path', 'irrelevant']) {
    const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); const gate = q.block('decode'), load = q.reader.select(0, id(1)); await gate.arrived.promise;
    if (change === 'delete') q.env.sessions.delete(id(1));
    if (change === 'context') q.env.sessions.get(id(1))!.metrics.guideText = 'changed';
    if (change === 'path') q.env.resources.get(id(10001))!.storage_path = `${owner}/2026-10-08/free-handwriting-${id(10001)}.png`;
    if (change === 'irrelevant') Object.assign(q.env.resources.get(id(10001))!, { title: 'edited', classification: 'reference', routine_id: null });
    gate.release.resolve(); await load; assert.equal(q.reader.snapshot().panes[0].status, change === 'delete' ? 'metadata_missing' : change === 'irrelevant' ? 'ready_verified' : 'unlinked_or_unsupported');
  }
});
test('more than 1000 same-day records paginate by unique id and page failure is retryable, not empty', async t => {
  const q = fixture(1003); t.after(() => q.reader.dispose()); await q.reader.refresh(); const original = q.reader.snapshot().entries;
  q.env.pageFails = true; await q.reader.more(); assert.equal(q.reader.snapshot().entries, original); assert.ok(q.reader.snapshot().error); assert.equal(q.reader.snapshot().hasMore, true);
  q.env.pageFails = false; while (q.reader.snapshot().hasMore) await q.reader.more();
  assert.equal(q.reader.snapshot().entries.length, 1003); assert.equal(new Set(q.reader.snapshot().entries.map(e => e.id)).size, 1003);
  await q.reader.select(0, id(1003)); assert.equal(q.reader.snapshot().panes[0].status, 'ready_verified');
  await Promise.all([q.reader.resume(), q.reader.resume()]); assert.ok(q.reader.snapshot().panes.every(p => p.id === null)); assert.equal(q.reader.snapshot().entries.length, 50);
});
test('auth/marker uncertainty, malformed marker and epoch failure clear already visible private content', async t => {
  for (const fault of ['auth', 'marker', 'malformed', 'epoch', 'inactive']) {
    const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(1));
    if (fault === 'auth') q.env.authFails = true; if (fault === 'marker') q.env.markerFails = true;
    if (fault === 'malformed') q.transport.marker = async () => 7 as unknown as string;
    if (fault === 'epoch') q.env.epochFails = true; if (fault === 'inactive') q.env.active = false;
    await q.reader.select(1, id(2)); assert.ok(q.reader.snapshot().panes.every(p => !p.url && p.id === null), fault); assert.equal(q.reader.snapshot().blocked, true);
  }
});
test('suspend hides and revokes before resume; remote reset remains fenced across hidden pages', async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(1)); q.reader.suspend('hidden');
  assert.ok(q.reader.snapshot().panes.every(p => !p.url)); q.env.marker = 'changed'; await q.reader.resume(); assert.equal(q.reader.snapshot().blocked, true); assert.equal(q.reader.snapshot().entries.length, 0);
});
test('a bounded timeout settles a non-abortable auth read without publishing a late result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const q = fixture(); t.after(() => q.reader.dispose()); const gate = q.block('auth'), load = q.reader.refresh(); await gate.arrived.promise;
  t.mock.timers.tick(25_001); await load; assert.equal(q.reader.snapshot().loading, false); assert.ok(q.reader.snapshot().error); gate.release.resolve(); await tick(); assert.equal(q.reader.snapshot().entries.length, 0);
});

function shippingHook() {
  const q = fixture(), slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [], effectSlots = new Set<number>();
  const events = new Map<string, Set<(event?: unknown) => void>>(); let cursor = 0, strictReplay = false;
  const eventTarget = { addEventListener(name: string, fn: (event?: unknown) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); }, removeEventListener(name: string, fn: (event?: unknown) => void) { events.get(name)?.delete(fn); } };
  const doc = { ...eventTarget, visibilityState: 'visible' }; let authCallback: ((event: string, session: unknown) => void) | null = null, resetting = false;
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = value; }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { cursor++; return snapshot(); },
      useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++; effectSlots.add(slot); const old = slots[slot] as unknown[] | undefined; if (strictReplay || !old || old.some((v, i) => v !== deps[i])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    },
    'react-dom': { flushSync: (action: () => void) => action() },
    '@/app/lib/supabase': { supabase: { auth: { onAuthStateChange(callback: typeof authCallback) { authCallback = callback; return { data: { subscription: { unsubscribe() { authCallback = null; } } } }; } } } },
    '@/app/data/storageTransaction': { captureStorageOwner() { throw Error('unexpected production transport'); }, CLOUD_SESSION_CHANGED_EVENT: 'cloud-session', STORAGE_SESSION_KEY: 'epoch-key', STORAGE_OWNER_KEY: 'owner-key', STORAGE_READY_KEY: 'ready-key' },
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'reset', RECORD_RESET_STORAGE_EVENT: 'reset-storage', isRecordResetRunning: () => resetting, resetMarkerKey: () => 'growth-reset' },
    '@/lib/handwriting-comparison-reader': readerModule,
  };
  const exports = {} as typeof import('../app/growth/handwriting/compare/useSavedHandwritingComparison');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/compare/useSavedHandwritingComparison.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { window: eventTarget, document: doc, JSON, Error })(exports, (name: string) => { assert.ok(name in modules, name); return modules[name as keyof typeof modules]; });
  const active = () => q.env.active;
  const render = () => { cursor = 0; const result = exports.useSavedHandwritingComparison(owner, active, q.transport); effects.splice(0).forEach(effect => effect()); strictReplay = false; return result; };
  const fire = (name: string, event?: unknown) => events.get(name)?.forEach(fn => fn(event));
  return { ...q, render, fire, doc, auth: (event: string, session: unknown) => authCallback?.(event, session), setResetting: (value: boolean) => { resetting = value; },
    replay() { cleanups.forEach(cleanup => cleanup?.()); effectSlots.forEach(slot => { cleanups[slot] = () => {}; }); strictReplay = true; render(); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
    async settle() { for (let n = 0; n < 30; n++) { await tick(); render(); } return render(); } };
}
test('shipping hook survives StrictMode effect setup-cleanup-setup and performs read-only discovery', async t => {
  const q = shippingHook(); t.after(q.unmount); q.render(); q.replay(); const result = await q.settle(); assert.equal(result.entries.length, 3); assert.equal(result.loading, false);
  await result.reader.select(0, id(1)); assert.equal(q.render().panes[0].status, 'ready_verified');
});
test('shipping hook synchronously clears images for auth/epoch/reset/storage/pagehide and ignores unrelated reset notices', async t => {
  for (const event of ['auth', 'epoch', 'reset', 'storage', 'pagehide', 'hidden']) {
    const q = shippingHook(); t.after(q.unmount); q.render(); await q.settle(); await q.render().reader.select(0, id(1));
    q.fire('storage', { key: 'reset-storage', newValue: JSON.stringify({ userId: owner, app: 'diet' }) }); assert.equal(q.render().panes[0].status, 'ready_verified');
    q.auth('TOKEN_REFRESHED', { user: { id: owner } }); assert.equal(q.render().panes[0].status, 'ready_verified');
    if (event === 'auth') q.auth('SIGNED_OUT', null); if (event === 'epoch') q.fire('cloud-session');
    if (event === 'reset') { q.setResetting(true); q.fire('reset'); }
    if (event === 'storage') q.fire('storage', { key: 'reset-storage', newValue: JSON.stringify({ userId: owner, app: 'growth' }) });
    if (event === 'pagehide') q.fire('pagehide'); if (event === 'hidden') { q.doc.visibilityState = 'hidden'; q.fire('visibilitychange'); }
    assert.ok(q.render().panes.every(p => !p.url && p.id === null), event); assert.equal(q.env.revoked.length, 1, event);
  }
});
test('comparison shipping sources have no mutation/optimizer/storage persistence paths and editor links use checkpoint navigation', () => {
  const hook = readFileSync(new URL('../app/growth/handwriting/compare/useSavedHandwritingComparison.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /useGrowthData|\.upload\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|createSignedUrl|localStorage\.setItem|indexedDB|caches\.|console\./);
  assert.match(hook, /\.download\(path, \{\}, \{ cache: 'no-store', signal \}\)/); assert.match(hook, /\.contains\('metrics', \{ resourceId \}\)\.limit\(2\)/);
  const page = readFileSync(new URL('../app/growth/handwriting/compare/page.tsx', import.meta.url), 'utf8'); assert.match(page, /<Image unoptimized/g); assert.doesNotMatch(page, /useGrowthData|localStorage|indexedDB|signedUrl/);
  for (const file of ['../app/growth/handwriting/page.tsx', '../app/growth/handwriting/free/page.tsx']) { const source = readFileSync(new URL(file, import.meta.url), 'utf8'); assert.match(source, /<Link onClick=\{navigate\} href="\/growth\/handwriting\/compare"/); assert.match(source, /await practice\.flush\(\); router\.push\(href\)/); }
});

test('auth and reset-marker timeouts clear the independently ready peer, while cancelled auth does not', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stage of ['auth', 'marker']) {
    const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(2));
    const gate = q.block(stage), load = q.reader.select(1, id(1)); await gate.arrived.promise;
    t.mock.timers.tick(25_001); await load; assert.equal(q.reader.snapshot().blocked, true, stage); assert.ok(q.reader.snapshot().panes.every(p => !p.url && p.id === null), stage);
    gate.release.resolve(); await tick(); assert.equal(q.reader.snapshot().entries.length, 0);
  }
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(2));
  const gate = q.block('auth'), load = q.reader.select(1, id(1)); await gate.arrived.promise; q.reader.clear(1); await load;
  assert.equal(q.reader.snapshot().panes[0].status, 'ready_legacy_unverified'); gate.release.resolve();
});
test('shipping hook blocks refresh and selection while a local reset is running, then revalidates at completion', async t => {
  const q = shippingHook(); t.after(q.unmount); q.render(); await q.settle(); await q.render().reader.select(0, id(1));
  q.setResetting(true); q.fire('reset'); const downloads = q.env.calls.filter(call => call === 'download').length;
  await q.render().reader.refresh(); await q.render().reader.select(0, id(1)); assert.equal(q.render().blocked, true); assert.equal(q.env.calls.filter(call => call === 'download').length, downloads);
  q.setResetting(false); q.fire('reset'); await q.settle(); assert.equal(q.render().entries.length, 3); assert.ok(q.render().panes.every(p => p.id === null));
});
test('contradictory or non-monotonic pages fail closed and do not advance the cursor', async t => {
  const q = fixture(51); t.after(() => q.reader.dispose()); await q.reader.refresh(); const page = q.transport.page;
  q.transport.page = async () => [row(1)]; await q.reader.more(); assert.ok(q.reader.snapshot().error); assert.equal(q.reader.snapshot().entries.length, 50);
  q.transport.page = page; await q.reader.more(); assert.equal(q.reader.snapshot().entries.length, 51);
});
test('URL allocation followed by identity invalidation is revoked immediately and cannot publish', async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); const create = q.transport.createUrl;
  q.transport.createUrl = blob => { const url = create(blob); q.env.epoch = 'epoch-new'; return url; };
  await q.reader.select(0, id(1)); assert.equal(q.reader.snapshot().blocked, true); assert.equal(q.env.urls.length, 1); assert.deepEqual(q.env.revoked, q.env.urls);
});

function productionTransportFixture() {
  const calls: { table: string; method: string; args: unknown[] }[] = [], urls: string[] = [], revoked: string[] = [];
  const env = { result: { data: { state: {} } as unknown, error: null as unknown }, image: null as null | { onload: (() => void) | null; onerror: (() => void) | null; naturalWidth: number; naturalHeight: number; src: string; removeAttribute: (key: string) => void } };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) },
    from(table: string) {
      const query = new Proxy({} as Record<string, unknown>, { get(_target, method: string) {
        if (method === 'then') return (resolve: (value: unknown) => void) => Promise.resolve(env.result).then(resolve);
        if (method === 'maybeSingle') return async () => env.result;
        assert.ok(['select', 'eq', 'order', 'limit', 'gt', 'abortSignal', 'contains'].includes(method), `mutating/unexpected method ${method}`);
        return (...args: unknown[]) => { calls.push({ table, method, args }); return query; };
      } }); return query;
    },
    storage: { from(bucket: string) { assert.equal(bucket, 'growth-resources'); return { async download(...args: unknown[]) { calls.push({ table: 'storage', method: 'download', args }); return { data: new Blob([new Uint8Array(png)], { type: 'image/png' }), error: null }; } }; } },
  };
  class SyntheticImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; naturalWidth = 1; naturalHeight = 1; src = ''; constructor() { env.image = this; } removeAttribute(key: string) { assert.equal(key, 'src'); this.src = ''; } }
  const modules = { react: {}, 'react-dom': {}, '@/app/lib/supabase': { supabase: client }, '@/app/data/storageTransaction': { captureStorageOwner: () => ({ userId: owner, epoch: 'verified' }) }, '@/app/data/appRecordReset': { resetMarkerKey: () => 'growth-reset' }, '@/lib/handwriting-comparison-reader': readerModule };
  const exports = {} as typeof import('../app/growth/handwriting/compare/useSavedHandwritingComparison');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/compare/useSavedHandwritingComparison.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Image: SyntheticImage, Error, crypto, Uint8Array, Blob, Array, Object, String, Promise, URL: { createObjectURL() { const url = `blob:decode-${urls.length}`; urls.push(url); return url; }, revokeObjectURL(url: string) { revoked.push(url); } } })(exports, (name: string) => { assert.ok(name in modules, name); return modules[name as keyof typeof modules]; });
  return { env, calls, urls, revoked, transport: exports.comparisonTransport(owner, () => true) };
}
test('shipping production transport reads owner-filtered marker/pages/exact rows/all links and untransformed no-store authenticated bytes', async () => {
  const q = productionTransportFixture(), signal = new AbortController().signal;
  assert.equal(q.transport.epoch(), 'verified'); assert.equal(await q.transport.authenticate(signal), owner); assert.equal(await q.transport.marker(owner, signal), null);
  q.env.result = { data: [], error: null }; await q.transport.page(owner, id(1), 50, signal); await q.transport.links(owner, id(10001), signal);
  q.env.result = { data: null, error: null }; assert.equal(await q.transport.session(owner, id(1), signal), null); assert.equal(await q.transport.resource(owner, id(10001), signal), null);
  for (const table of ['growth_sessions', 'growth_resources', 'user_app_state']) assert.ok(q.calls.some(call => call.table === table && call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === owner));
  assert.ok(q.calls.some(call => call.method === 'gt' && call.args[0] === 'id' && call.args[1] === id(1)));
  assert.ok(q.calls.some(call => call.method === 'contains' && JSON.stringify(call.args) === JSON.stringify(['metrics', { resourceId: id(10001) }])));
  const path = `${owner}/2026-10-09/free-handwriting-${id(10001)}.png`; await q.transport.download(path, signal);
  const download = q.calls.find(call => call.method === 'download')!; assert.equal(download.args[0], path); assert.equal(JSON.stringify(download.args[1]), '{}'); assert.equal((download.args[2] as RequestInit).cache, 'no-store'); assert.equal((download.args[2] as RequestInit).signal, signal);
  assert.ok(q.calls.filter(call => call.method === 'abortSignal').every(call => call.args[0] === signal));
});
test('production reset marker distinguishes absent row/key from malformed null/array/scalar and failed query', async () => {
  const q = productionTransportFixture(), signal = new AbortController().signal;
  for (const data of [null, { state: {} }]) { q.env.result = { data, error: null }; assert.equal(await q.transport.marker(owner, signal), null); }
  for (const data of [{ state: null }, { state: [] }, { state: { 'growth-reset': null } }, { state: { 'growth-reset': 7 } }, { state: { 'growth-reset': '' } }]) { q.env.result = { data, error: null }; await assert.rejects(q.transport.marker(owner, signal), /read_unconfirmed/); }
  q.env.result = { data: null, error: Error('offline') }; await assert.rejects(q.transport.marker(owner, signal), /read_unconfirmed/);
});
test('production decode revokes its temporary Blob URL on success/error/abort and cannot double-complete', async () => {
  for (const mode of ['success', 'error', 'abort']) {
    const q = productionTransportFixture(), controller = new AbortController(), decoding = q.transport.decode(new Blob([new Uint8Array(png)], { type: 'image/png' }), controller.signal), image = q.env.image!;
    const oldLoad = image.onload!;
    if (mode === 'success') image.onload!(); if (mode === 'error') image.onerror!(); if (mode === 'abort') controller.abort();
    if (mode === 'success') assert.equal(JSON.stringify(await decoding), JSON.stringify({ width: 1, height: 1 })); else await assert.rejects(decoding);
    oldLoad(); assert.equal(image.src, ''); assert.deepEqual(q.revoked, q.urls); assert.equal(q.revoked.length, 1);
  }
});

for (const stage of ['authenticate', 'marker', 'session', 'resource', 'links', 'download', 'hash', 'decode'] as const) test(`rejected ${stage} after epoch change clears shared private state even without a delivered lifecycle event`, async t => {
  const q = fixture(); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(2));
  const gate = deferred(), arrived = deferred(); q.transport[stage] = (async () => { arrived.resolve(); await gate.promise; throw Error('late failure'); }) as never;
  const load = q.reader.select(1, id(1)); await arrived.promise; q.env.epoch = 'epoch-next'; gate.resolve(); await load;
  assert.equal(q.reader.snapshot().blocked, true); assert.ok(q.reader.snapshot().panes.every(p => !p.url && p.id === null)); assert.equal(q.env.urls.length, q.env.revoked.length);
});
test('rejected next-page read after owner invalidation clears the loaded list and ready peer', async t => {
  const q = fixture(51); t.after(() => q.reader.dispose()); await q.reader.refresh(); await q.reader.select(0, id(1));
  const gate = deferred(), arrived = deferred(); q.transport.page = async () => { arrived.resolve(); await gate.promise; throw Error('late failure'); };
  const read = q.reader.more(); await arrived.promise; q.env.active = false; gate.resolve(); await read;
  assert.equal(q.reader.snapshot().blocked, true); assert.equal(q.reader.snapshot().entries.length, 0); assert.ok(q.reader.snapshot().panes.every(p => !p.url));
});

function shippingPageGate() {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [], timers = new Map<number, () => void>(); let cursor = 0, nextTimer = 0;
  let resolve!: (result: { data: { user: { id: string } | null }; error: unknown }) => void, reject!: (error: unknown) => void, auth: ((event: string, session: { user: { id: string } } | null) => void) | null = null;
  const user = new Promise<{ data: { user: { id: string } | null }; error: unknown }>((yes, no) => { resolve = yes; reject = no; });
  const jsx = (type: unknown, props: unknown, key?: unknown) => ({ type, props, key });
  const react = {
    useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback(fn: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = fn; return slots[slot]; },
    useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++; const old = slots[slot] as unknown[] | undefined; if (!old || old.some((v, i) => v !== deps[i])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
  };
  const modules: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { flushSync: (fn: () => void) => fn() }, 'next/link': {}, 'next/image': {},
    '@/app/components/AppIdentity': {}, '@/utils/dateKey': {}, '@/app/data/handwritingCourse': {}, '@/lib/handwriting-comparison': {}, '@/lib/handwriting-comparison-reader': {}, './useSavedHandwritingComparison': {},
    '@/app/lib/supabase': { supabase: { auth: { getUser: () => user, onAuthStateChange(callback: typeof auth) { auth = callback; return { data: { subscription: { unsubscribe() { auth = null; } } } }; } } } },
  };
  const exports = {} as { default: () => { type: unknown; props: { children?: unknown; owner?: string; isOwnerActive?: (id: string) => boolean } } };
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/compare/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { setTimeout(fn: () => void) { const n = ++nextTimer; timers.set(n, fn); return n; }, clearTimeout(n: number) { timers.delete(n); } })(exports, (name: string) => { assert.ok(name in modules, name); return modules[name]; });
  return { resolve, reject, auth: (event: string, session: { user: { id: string } } | null) => auth?.(event, session), timeout: () => [...timers.values()].forEach(fn => fn()), render() { cursor = 0; const tree = exports.default(); effects.splice(0).forEach(effect => effect()); return tree; }, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}
test('shipping outer account gate settles rejected/hung lookup, offers retry and ignores late lookup after timeout', async t => {
  for (const mode of ['reject', 'timeout']) {
    const q = shippingPageGate(); t.after(q.unmount); assert.match(JSON.stringify(q.render()), /비교 계정 확인 중/);
    if (mode === 'reject') q.reject(Error('offline')); else q.timeout(); await tick();
    assert.match(JSON.stringify(q.render()), /계정 다시 확인/); assert.doesNotMatch(JSON.stringify(q.render()), /비교 계정 확인 중/);
    if (mode === 'timeout') { q.resolve({ data: { user: { id: owner } }, error: null }); await tick(); assert.equal(q.render().type, 'main'); }
  }
});
test('shipping outer account gate synchronously fences old owner and ignores stale initial identity after auth event', async t => {
  const q = shippingPageGate(); t.after(q.unmount); q.render(); q.auth('SIGNED_IN', { user: { id: owner } }); const first = q.render(); assert.equal(first.props.owner, owner); assert.equal(first.props.isOwnerActive!(owner), true);
  q.auth('SIGNED_OUT', null); assert.equal(first.props.isOwnerActive!(owner), false); assert.equal(q.render().type, 'main');
  q.resolve({ data: { user: { id: owner } }, error: null }); await tick(); assert.equal(q.render().type, 'main');
  q.auth('SIGNED_IN', { user: { id: id(999) } }); assert.equal(q.render().props.owner, id(999));
});

test('shipping hook rechecks once after owner preparation completes, without requiring manual refresh on cold load', async t => {
  const q = shippingHook(); t.after(q.unmount); q.env.epochFails = true; q.render(); await q.settle(); assert.equal(q.render().blocked, true);
  const before = q.env.calls.length; q.fire('cloud-session'); await q.settle(); assert.equal(q.env.calls.length, before); assert.equal(q.render().blocked, true);
  q.env.epochFails = false; q.env.epoch = 'prepared-epoch'; q.fire('cloud-session'); await q.settle(); assert.equal(q.render().entries.length, 3); assert.equal(q.render().blocked, false);
  const after = q.env.calls.length; await q.settle(); assert.equal(q.env.calls.length, after);
});
