import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

// Pure contract tests only: extract the installer without importing the
// Playwright fixture, running a server, or launching any browser.
const source = readFileSync(new URL('./e2e/owner-recheck-harness.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('owner-recheck-harness.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const installer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'installOwnerRecheckReadFault');
assert.ok(installer && ts.isFunctionDeclaration(installer));
assert.ok(installer.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
const isolated = ts.factory.updateFunctionDeclaration(installer, undefined, installer.asteriskToken, installer.name,
  installer.typeParameters, installer.parameters, installer.type, installer.body);
const executable = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, isolated, ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const EVENT = 'yeoni-cloud-session-changed';
const KEY = 'yeoni-storage-transaction-v2';
const NOTICE = '다른 창에서 로그인 상태가 변경되었습니다. 다시 시도하여 계정을 확인해 주세요.';
const SECRET = 'SYNTHETIC_PRIVATE_BYTES_DO_NOT_RETURN';
const SUCCESS = { reads: 6, getterRestored: true, bytesUnchanged: true };
const MATCH_ERROR = /requires exactly one active panel callback and one attempt/;
const READ_ERROR = /callback\/read contract changed/;
type Probe = { trigger(): typeof SUCCESS; unchanged(): boolean };
type NativeCall = { target: EventTarget; type: string; listener: EventListenerOrEventListenerObject | null; capture: boolean };
type StorageRead = { receiver: Storage; key: string; inCallback: boolean };
type WindowFixture = EventTarget & { localStorage: Storage; sessionStorage: Storage; ownerRecheckFixture: Probe };

function fixture() {
  const adds: NativeCall[] = [], removes: NativeCall[] = [], reads: StorageRead[] = [];
  const writes: string[] = [], dispatches: string[] = [];
  const state: Record<string, unknown> = { calls: 0, unrelated: 0, inCallback: false };
  const capture = (options?: boolean | EventListenerOptions) => typeof options === 'boolean' ? options : Boolean(options?.capture);
  class NativeTarget extends EventTarget {
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      adds.push({ target: this, type, listener, capture: capture(options) });
      super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      removes.push({ target: this, type, listener, capture: capture(options) });
      // Node's boolean remove overload differs from DOM capture matching.
      // Normalize it so these host tests exercise the browser's contract.
      super.removeEventListener(type, listener, { capture: capture(options) });
    }
    override dispatchEvent(event: Event) { dispatches.push(event.type); return super.dispatchEvent(event); }
  }
  const window = new NativeTarget() as WindowFixture;
  const context = createContext({ window, Event, AbortController, NativeTarget, reads, writes, state, KEY });
  const run = <T = unknown>(code: string): T => runInContext(code, context) as T;
  run(`
    class Storage {
      getItem(key) {
        reads.push({ receiver: this, key: String(key), inCallback: state.inCallback });
        return Object.hasOwn(this, String(key)) ? this[String(key)] : null;
      }
      setItem(key, value) {
        writes.push(String(key));
        Object.defineProperty(this, String(key), { value: String(value), writable: true, configurable: true, enumerable: true });
      }
      removeItem(key) { writes.push(String(key)); delete this[String(key)]; }
      clear() { for (const key of Object.keys(this)) this.removeItem(key); }
    }
    window.localStorage = new Storage();
    window.sessionStorage = new Storage();
    ${executable}
    installOwnerRecheckReadFault(${JSON.stringify({ eventName: EVENT, protocolKey: KEY, panelNotice: NOTICE })});
  `);
  const storagePrototype = run<Storage>('Storage.prototype');
  window.localStorage.setItem(KEY, SECRET);
  window.localStorage.setItem('private-record', `${SECRET}:record`);
  window.localStorage.setItem(`${KEY}-other`, `${SECRET}:near-key`);
  window.sessionStorage.setItem(KEY, `${SECRET}:session`);
  writes.length = 0;
  const descriptor = Object.getOwnPropertyDescriptor(storagePrototype, 'getItem')!;
  const probe = window.ownerRecheckFixture;
  return { window, probe, state, run, adds, removes, reads, writes, dispatches, storagePrototype, descriptor };
}
type Fixture = ReturnType<typeof fixture>;
type Encoding = 'literal' | 'escaped-units' | 'escaped-uppercase' | 'escaped-codepoints';
function noticeLiteral(encoding: Encoding, notice = NOTICE) {
  if (encoding === 'literal') return JSON.stringify(notice);
  return `"${Array.from(notice, character => {
    const hex = character.codePointAt(0)!.toString(16);
    return encoding === 'escaped-codepoints' ? `\\u{${hex}}` : `\\u${(encoding === 'escaped-uppercase' ? hex.toUpperCase() : hex).padStart(4, '0')}`;
  }).join('')}"`;
}
function callback(f: Fixture, body = 'state.values=Array.from({length:6},()=>window.localStorage.getItem(KEY));', encoding: Encoding = 'literal', notice = NOTICE) {
  return f.run<EventListener>(`(function(e){void ${noticeLiteral(encoding, notice)};state.calls++;state.correctThis=this===window;state.eventType=e.type;${body}})`);
}
function add(f: Fixture, listener = callback(f), options?: boolean | AddEventListenerOptions) {
  f.window.addEventListener(EVENT, listener, options);
  return listener;
}
function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function restored(f: Fixture) {
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.storagePrototype, 'getItem'), f.descriptor);
  assert.equal(f.window.localStorage.getItem(KEY), SECRET);
}

for (const encoding of ['literal', 'escaped-units', 'escaped-uppercase', 'escaped-codepoints'] as const)
  test(`owner recheck identifies the exact notice in ${encoding} minified callback source`, () => {
    const f = fixture(), listener = add(f, callback(f, undefined, encoding));
    assert.notEqual(f.adds.at(-1)?.listener, listener, 'Only the matching callback is wrapped');
    assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
    assert.equal(f.state.calls, 1);
    assert.equal(f.state.correctThis, true);
    assert.equal(f.state.eventType, EVENT);
    restored(f);
  });

test('owner recheck refuses zero matches and forwards wrong notices, types, objects and receivers unchanged', () => {
  const f = fixture(), other = f.run<EventTarget>('new NativeTarget()');
  const nearNotice = callback(f, undefined, 'literal', NOTICE.replace('로그인', '로그아웃'));
  const match = callback(f);
  const object = f.run<EventListenerObject>(`({handleEvent(e){void ${JSON.stringify(NOTICE)};state.unrelated++;}})`);
  f.window.addEventListener(EVENT, nearNotice);
  f.window.addEventListener(`${EVENT}-other`, match);
  f.window.addEventListener(EVENT, object);
  f.window.addEventListener.call(other, EVENT, match);
  assert.deepEqual(f.adds.map(call => call.listener), [nearNotice, match, object, match]);
  assert.throws(() => f.probe.trigger(), MATCH_ERROR);
  assert.equal(f.state.calls, 0);
  assert.equal(f.reads.length, 0, 'Refusal happens before any storage snapshot');
  assert.equal(f.probe.unchanged(), false);
  restored(f);
});

test('owner recheck refuses multiple live callbacks without invoking or reading either', () => {
  const f = fixture(); add(f); add(f);
  assert.throws(() => f.probe.trigger(), MATCH_ERROR);
  assert.equal(f.state.calls, 0); assert.equal(f.reads.length, 0);
  assert.equal(f.probe.unchanged(), false);
  restored(f);
});

test('owner recheck calls its unique real callback directly without dispatching unrelated readers', () => {
  const f = fixture(); add(f);
  f.window.addEventListener(EVENT, f.run<EventListener>('(function unrelated(){state.unrelated++;})'));
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  assert.equal(f.state.calls, 1); assert.equal(f.state.unrelated, 0);
  assert.deepEqual(f.dispatches, []);
  assert.throws(() => f.probe.trigger(), MATCH_ERROR, 'A successful attempt is one-shot');
  f.window.dispatchEvent(new Event(EVENT));
  assert.equal(f.state.calls, 2); assert.equal(f.state.unrelated, 1);
  assert.deepEqual(plain(f.state.values), Array(6).fill(SECRET), 'Later native delivery gets real storage');
  restored(f);
});

test('owner recheck deduplicates callback/capture pairs without changing native once semantics', () => {
  const f = fixture(), listener = add(f);
  add(f, listener, false); add(f, listener, { capture: false, once: true });
  assert.equal(new Set(f.adds.map(call => call.listener)).size, 1);
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  f.window.dispatchEvent(new Event(EVENT)); f.window.dispatchEvent(new Event(EVENT));
  assert.equal(f.state.calls, 3, 'A duplicate add cannot change the original persistent registration to once');
});

for (const capture of [false, true])
  test(`owner recheck removal maps original callback and capture=${capture} to its native wrapper`, () => {
    const f = fixture(), listener = add(f, undefined, { capture });
    const wrapper = f.adds.at(-1)?.listener;
    f.window.removeEventListener(EVENT, listener, !capture);
    assert.equal(f.removes.at(-1)?.listener, listener, 'Wrong capture must not remove the tracked wrapper');
    f.window.removeEventListener(EVENT, listener, capture);
    assert.equal(f.removes.at(-1)?.listener, wrapper);
    assert.equal(f.removes.at(-1)?.capture, capture);
    f.window.dispatchEvent(new Event(EVENT));
    assert.equal(f.state.calls, 0);
    assert.throws(() => f.probe.trigger(), MATCH_ERROR);
  });

test('owner recheck tracks both capture registrations and allows an unmount/remount to leave one live callback', () => {
  const f = fixture(), listener = add(f);
  add(f, listener, true);
  assert.notEqual(f.adds[0].listener, f.adds[1].listener);
  assert.throws(() => f.probe.trigger(), MATCH_ERROR);
  f.window.removeEventListener(EVENT, listener, { capture: false });
  f.window.removeEventListener(EVENT, listener, { capture: true });
  const remounted = add(f);
  assert.notEqual(remounted, listener);
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  assert.equal(f.state.calls, 1);
});

test('owner recheck forwards removal on other events and targets without losing its live registration', () => {
  const f = fixture(), listener = add(f);
  const other = f.run<EventTarget>('new NativeTarget()');
  f.window.removeEventListener(`${EVENT}-other`, listener);
  f.window.removeEventListener.call(other, EVENT, listener);
  assert.deepEqual(f.removes.map(call => call.listener), [listener, listener]);
  assert.equal(f.removes[1].target, other);
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
});

for (const abortBeforeAdd of [false, true])
  test(`owner recheck ignores a signal aborted ${abortBeforeAdd ? 'before' : 'after'} registration`, () => {
    const f = fixture(), controller = new AbortController();
    if (abortBeforeAdd) controller.abort();
    add(f, undefined, { signal: controller.signal });
    if (!abortBeforeAdd) controller.abort();
    assert.throws(() => f.probe.trigger(), MATCH_ERROR);
    f.window.dispatchEvent(new Event(EVENT));
    assert.equal(f.state.calls, 0);
    add(f);
    assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  });

test('owner recheck removes a readded live callback rather than its stale aborted registration', () => {
  const f = fixture(), controller = new AbortController();
  const listener = add(f, undefined, { signal: controller.signal });
  const stale = f.adds.at(-1)?.listener;
  controller.abort();
  add(f, listener);
  const live = f.adds.at(-1)?.listener;
  assert.notEqual(live, stale);
  f.window.removeEventListener(EVENT, listener);
  assert.equal(f.removes.at(-1)?.listener, live);
  f.window.dispatchEvent(new Event(EVENT));
  assert.equal(f.state.calls, 0);
  assert.throws(() => f.probe.trigger(), MATCH_ERROR);
});

for (const capture of [false, true])
  test(`owner recheck direct invocation removes a once callback from native listeners with capture=${capture}`, () => {
    const f = fixture(); add(f, undefined, { once: true, capture });
    const wrapper = f.adds.at(-1)?.listener;
    assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
    assert.equal(f.removes.at(-1)?.listener, wrapper);
    assert.equal(f.removes.at(-1)?.capture, capture);
    f.window.dispatchEvent(new Event(EVENT));
    assert.equal(f.state.calls, 1, 'Direct invocation must consume the native once listener too');
    restored(f);
  });

test('owner recheck native once delivery retires tracking and permits a later remount', () => {
  const f = fixture(), listener = add(f, undefined, { once: true });
  f.window.dispatchEvent(new Event(EVENT)); f.window.dispatchEvent(new Event(EVENT));
  assert.equal(f.state.calls, 1);
  assert.deepEqual(plain(f.state.values), Array(6).fill(SECRET), 'Normal events are never armed implicitly');
  assert.throws(() => f.probe.trigger(), MATCH_ERROR);
  add(f, listener, { once: true });
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  f.window.dispatchEvent(new Event(EVENT));
  assert.equal(f.state.calls, 2);
});

test('owner recheck injects exactly six generations only for localStorage and the exact primitive protocol key', () => {
  const f = fixture();
  add(f, callback(f, `
    state.inCallback=true;
    const foreign=new Storage(); foreign.setItem(KEY,'foreign-protocol');
    state.unaffected=[window.sessionStorage.getItem(KEY),foreign.getItem(KEY),window.localStorage.getItem(KEY+'-other'),
      window.localStorage.getItem('private-record'),window.localStorage.getItem(new String(KEY))];
    state.values=Array.from({length:6},()=>window.localStorage.getItem(KEY));
    state.inCallback=false;
  `));
  assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
  assert.deepEqual(plain(f.state.unaffected), [`${SECRET}:session`, 'foreign-protocol', `${SECRET}:near-key`, `${SECRET}:record`, SECRET]);
  assert.deepEqual(plain(f.state.values as string[]).map(value => JSON.parse(value)), Array.from({ length: 6 }, (_, index) => ({
    version: 2, state: 'committed', generation: `synthetic-recheck-overlap-${index + 1}`,
  })));
  assert.equal(f.reads.filter(read => read.inCallback).length, 5, 'Only unrelated reads reach the original getter');
  assert.equal(f.reads.filter(read => read.inCallback && read.receiver === f.window.localStorage && read.key === KEY).length, 1,
    'A boxed key is delegated to native conversion rather than consuming the fault budget');
  restored(f);
});

for (const count of [0, 5, 7])
  test(`owner recheck refuses protocol read-count drift (${count} reads) and restores the getter`, () => {
    const f = fixture();
    add(f, callback(f, `state.values=Array.from({length:${count}},()=>window.localStorage.getItem(KEY));`));
    assert.throws(() => f.probe.trigger(), READ_ERROR);
    assert.equal(f.state.calls, 1);
    if (count === 7) assert.equal((f.state.values as string[])[6], SECRET, 'The seventh read uses the original getter');
    assert.equal(f.probe.unchanged(), true);
    assert.throws(() => f.probe.trigger(), MATCH_ERROR, 'A failed callback contract still consumes the attempt');
    restored(f);
  });

for (const throws of [false, true])
  test(`owner recheck restores the complete getter descriptor ${throws ? 'when the callback throws' : 'on success'}`, () => {
    const f = fixture();
    Object.defineProperty(f.storagePrototype, 'getItem', { ...f.descriptor, writable: false, enumerable: true });
    f.descriptor = Object.getOwnPropertyDescriptor(f.storagePrototype, 'getItem')!;
    add(f, callback(f, `state.values=Array.from({length:6},()=>window.localStorage.getItem(KEY));${throws ? 'throw new Error("synthetic callback failure");' : ''}`));
    if (throws) assert.throws(() => f.probe.trigger(), /synthetic callback failure/);
    else assert.deepEqual(plain(f.probe.trigger()), SUCCESS);
    restored(f);
    assert.equal(f.probe.unchanged(), true);
  });

test('owner recheck successful reports expose only counts and booleans, never storage keys or values', () => {
  const f = fixture(); add(f);
  assert.equal(f.probe.unchanged(), false);
  const result = f.probe.trigger();
  assert.deepEqual(plain(result), SUCCESS);
  assert.deepEqual(Object.keys(result).sort(), ['bytesUnchanged', 'getterRestored', 'reads']);
  assert.deepEqual(Object.keys(f.probe).sort(), ['trigger', 'unchanged']);
  assert.equal(f.probe.unchanged(), true);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE|private-record|yeoni-storage/);
  assert.deepEqual(f.writes, [], 'Fault installation and triggering never write storage');
  f.window.localStorage.setItem('private-record', 'changed after trigger');
  assert.equal(f.probe.unchanged(), false, 'The original byte comparison remains internal and live');
  restored(f);
});

for (const mutation of ['change', 'add', 'remove'] as const)
  test(`owner recheck refuses a callback that would ${mutation} stored bytes without including them in its error`, () => {
    const f = fixture();
    const edit = mutation === 'change' ? `window.localStorage.setItem('private-record','${SECRET}:changed');`
      : mutation === 'add' ? `window.localStorage.setItem('new-private-key','${SECRET}:new');`
      : "window.localStorage.removeItem('private-record');";
    add(f, callback(f, `state.values=Array.from({length:6},()=>window.localStorage.getItem(KEY));${edit}`));
    assert.throws(() => f.probe.trigger(), (error: unknown) => {
      assert.equal((error as Error).message, 'Owner recheck fixture changed stored bytes');
      assert.doesNotMatch(String(error), /SYNTHETIC_PRIVATE|private-record|new-private-key/);
      return true;
    });
    assert.equal(f.probe.unchanged(), false);
    restored(f);
  });
