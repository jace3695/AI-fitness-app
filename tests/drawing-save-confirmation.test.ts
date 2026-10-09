import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { newDocument, parseAttempt, parsePack, type Attempt } from '../lib/drawing/model.ts';
import { memorySource } from '../lib/drawing/memory.ts';
import { draftKey, type LocalDraft } from '../lib/drawing/local-store.ts';

const pack = parsePack(JSON.parse(readFileSync(new URL('../content/drawing/foundations-v1.json', import.meta.url), 'utf8')));
const owner = '00000000-0000-4000-8000-000000000001';
function drawing(n: number, revision = 0): Attempt {
  const lesson = pack.lessons[n - 1];
  return { id: crypto.randomUUID(), user_id: owner, revision, status: 'draft',
    created_at: '2026-10-09T00:00:00.000Z', updated_at: '2026-10-09T00:00:00.000Z',
    document: newDocument(lesson, lesson.examples[0], pack.version) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Execute the shipping hook, with deterministic hook state and service/storage
// boundaries. No browser, network, credentials or real IndexedDB are used.
function fixture(source: Attempt) {
  const rows = new Map([[source.id, structuredClone(source)]]);
  const local = new Map<string, LocalDraft>();
  const slots: unknown[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  let held: { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  const modules = {
    react: {
      useState(initial: unknown) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (value: unknown) => {
          slots[slot] = typeof value === 'function' ? value(slots[slot]) : value;
        }];
      },
      useRef(initial: unknown) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = { current: initial };
        return slots[slot];
      },
      useCallback(callback: unknown) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = callback;
        return slots[slot];
      },
      useEffect(effect: () => void) {
        const slot = cursor++;
        if (!(slot in slots)) { slots[slot] = true; effects.push(effect); }
      },
    },
    '@/app/lib/supabase': { supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: owner } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from(table: string) {
        assert.equal(table, 'growth_drawing_attempts');
        let inserted: Attempt | undefined;
        const query = {
          select() { return query; }, eq() { return query; }, order() { return query; },
          abortSignal() { return query; },
          async range() { return { data: [...rows.values()], error: null }; },
          insert(value: Attempt) { inserted = value; return query; },
          async maybeSingle() {
            assert.ok(inserted);
            const saved = parseAttempt({ ...inserted, revision: 1,
              created_at: source.created_at, updated_at: source.updated_at });
            rows.set(saved.id, structuredClone(saved));
            return { data: saved, error: null };
          },
        };
        return query;
      },
    } },
    '@/lib/drawing/model': { parseAttempt },
    '@/lib/drawing/local-store': {
      draftKey, localDrafts: async () => [],
      async localWrite(key: string, value: LocalDraft) {
        if (!value.pending && held) {
          held.arrived.resolve();
          await held.release.promise;
        }
        local.set(key, structuredClone(value));
      },
    },
  };
  const exports = {} as typeof import('../app/growth/drawing/useDrawingRecords');
  const code = ts.transpileModule(readFileSync(new URL('../app/growth/drawing/useDrawingRecords.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, { Blob, AbortSignal, Error })(exports, (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name as keyof typeof modules];
  });
  const render = () => { cursor = 0; return exports.useDrawingRecords(); };
  render(); effects.splice(0).forEach(effect => effect());
  return { rows, local, render,
    holdConfirmation() {
      held = { arrived: deferred(), release: deferred() };
      return held;
    },
  };
}

test('D33/D34 server row counts can pass before the drawing save and local confirmation finish', async () => {
  const source = drawing(31, 1);
  const original = structuredClone(source);
  const qa = fixture(source);
  // Flush the immediate synthetic auth/list promises, without a timing sleep.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(qa.render().ready, true);
  for (const n of [33, 34]) {
    const draft = drawing(n);
    draft.document = { ...draft.document, ...memorySource(draft, source) };
    const confirmation = qa.holdConfirmation();
    let settled = false;
    const saving = qa.render().save(draft).then(saved => { settled = true; return saved; });
    await confirmation.arrived.promise;

    // This is the old E2E barrier. It succeeds while the user-facing operation
    // is still saving and reload recovery still points at revision zero.
    assert.equal(qa.rows.size, n === 33 ? 2 : 3);
    assert.equal(settled, false);
    assert.equal(qa.render().busy, true);
    const pending = qa.local.get(draftKey(owner, draft.id))!;
    assert.equal(pending.pending, true);
    assert.equal(pending.attempt.revision, 0);
    assert.equal(pending.baseRevision, 0);
    assert.equal(qa.render().records.some(row => row.id === draft.id), false);

    confirmation.release.resolve();
    const saved = await saving;
    assert.ok(saved);
    assert.equal(qa.render().busy, false);
    assert.equal(qa.render().records.find(row => row.id === draft.id)?.revision, saved.revision);
    const confirmed = qa.local.get(draftKey(owner, draft.id))!;
    assert.equal(confirmed.pending, false);
    assert.equal(confirmed.attempt.revision, saved.revision);
    assert.equal(confirmed.baseRevision, saved.revision);
    assert.deepEqual(confirmed.attempt, qa.rows.get(draft.id));
    assert.deepEqual(qa.rows.get(source.id), original);
  }
});
