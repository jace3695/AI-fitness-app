import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as conversation from '../app/language/practice/conversation.ts';

// Actual component handlers with in-memory hooks/storage. Not a browser or DB test.
const original = JSON.stringify({ version: 1, owner: 'A', turns: [
  { id: 'saved', text: '合成の練習文', situation: '일상', review: true, practiced: 3 },
] });
function fixture(raw: string | null = original, transport?: conversation.Transport) {
  const slots: any[] = []; let position = 0;
  const effects: (() => void)[] = [];
  const state = { raw, failRead: true, failWrite: false, failAfterWrite: false, reads: [] as string[], writes: 0, removals: 0 };
  const listeners = new Map<string, () => void>();
  const react = {
    useState(initial: any) { const i = position++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial: any) { const i = position++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn: () => any, deps: any[]) { const i = position++; if (!slots[i] || deps.some((x, j) => x !== slots[i].deps[j])) { slots[i]?.cleanup?.(); effects.push(() => { slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const deps: Record<string, unknown> = { react, 'react/jsx-runtime': jsx, './conversation': conversation,
    './Recorder': { default: () => null }, '@/components/ConfirmedConversationArchive': { default: () => null } };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('../app/language/practice/PracticeWorkspace.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext('(function(exports,require){' + code + '})', {
    AbortController, crypto, setTimeout, clearTimeout,
    window: { addEventListener(name: string, fn: () => void) { listeners.set(name, fn); }, removeEventListener(name: string) { listeners.delete(name); } },
    sessionStorage: {
      getItem(key: string) { state.reads.push(key); if (state.failRead) throw Error('synthetic unavailable'); return state.raw; },
      setItem(_key: string, value: string) { state.writes++; if (state.failWrite) throw Error('synthetic quota'); state.raw = value; if (state.failAfterWrite) throw Error('synthetic lost confirmation'); },
      removeItem() { state.removals++; state.raw = null; },
    },
  })(exports, (name: string) => { assert.ok(name in deps, name); return deps[name]; });
  function render() { position = 0; const tree = exports.default({ owner: 'A', transport }); while (effects.length) effects.shift()!(); return tree; }
  render();
  return { state, render, leave: () => listeners.get('pagehide')?.(), unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
function nodes(tree: any): any[] { if (!tree || typeof tree !== 'object') return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
function label(tree: any): string { if (typeof tree === 'string' || typeof tree === 'number') return String(tree); if (!tree || typeof tree !== 'object') return ''; return [tree.props?.children].flat(Infinity).map(label).join(''); }
function button(tree: any, name: string) { const found = nodes(tree).find(n => n.type === 'button' && label(n) === name); assert.ok(found, name); return found; }
function retry(f: ReturnType<typeof fixture>) { button(f.render(), '기존 탭 기록 다시 불러오기').props.onClick(); f.render(); return f.render(); }

test('temporary read failure recovers saved review and practice count without any write', () => {
  const f = fixture();
  assert.equal(button(f.render(), '연습 기록 보관').props.disabled, true);
  f.state.failRead = false;
  const tree = retry(f);
  assert.match(label(tree), /合成の練習文/); assert.match(label(tree), /자기 보고 재연습 3회/);
  button(tree, '복습 표시 해제');
  assert.equal(f.state.raw, original); assert.equal(f.state.writes, 0); assert.equal(f.state.removals, 0);
  assert.deepEqual(f.state.reads, ['japanese-practice-tab-v1:A', 'japanese-practice-tab-v1:A']);
});
test('persistent read failure allows further deliberate retries without reset', () => {
  const f = fixture(); const tree = retry(f);
  assert.match(label(tree), /기존 기록은 변경하지 않았어요/);
  assert.equal(button(tree, '연습 기록 보관').props.disabled, true);
  assert.equal(f.state.raw, original); assert.equal(f.state.writes + f.state.removals, 0);
});
test('malformed data remains byte-for-byte intact and is never shown as restored', () => {
  const f = fixture('{broken PRIVATE_FRAGMENT'); f.state.failRead = false;
  const tree = retry(f);
  assert.doesNotMatch(label(tree), /PRIVATE_FRAGMENT|다시 불러왔어요/);
  assert.equal(f.state.raw, '{broken PRIVATE_FRAGMENT'); assert.equal(f.state.writes + f.state.removals, 0);
});
test('another owner payload is rejected without exposing or rewriting it', () => {
  const other = original.replace('"owner":"A"', '"owner":"B"');
  const f = fixture(other); f.state.failRead = false;
  assert.doesNotMatch(label(retry(f)), /合成の練習文/);
  assert.equal(f.state.raw, other); assert.equal(f.state.writes + f.state.removals, 0);
});
test('successful retry cancels pending reset confirmation', () => {
  const f = fixture(); button(f.render(), '이 탭 기록 초기화 검토').props.onClick();
  button(f.render(), '이 탭 기록만 삭제'); f.state.failRead = false;
  const tree = retry(f);
  assert.doesNotMatch(label(tree), /이 탭 기록만 삭제/); assert.equal(f.state.removals, 0);
});
test('empty storage recovers without creating a record; new input can then be saved locally', async () => {
  const f = fixture(null); f.state.failRead = false;
  const tree = retry(f); assert.match(label(tree), /표시할 기록이 없어요/);
  assert.equal(f.state.writes, 0);
  nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: '新しい合成文' } });
  button(f.render(), '연습 기록 보관').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.writes, 1); assert.match(label(f.render()), /新しい合成文/);
});

const reply = { source: 'ai', reply: '合成応答', replyReading: 'ごうせい', correction: '合成文', explanation: 'synthetic only' };
async function failedSave(f: ReturnType<typeof fixture>) {
  f.state.failRead = false; retry(f); f.state.failWrite = true;
  nodes(f.render()).find(n => n.type === 'textarea').props.onChange({ target: { value: '合成入力' } });
  button(f.render(), 'AI와 대화하기').props.onClick();
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}
test('failed response storage retries once without AI redispatch or duplicate rows', async () => {
  let calls = 0; const f = fixture(original, async () => { calls++; return reply; });
  await failedSave(f); assert.equal(f.state.raw, original); assert.match(label(f.render()), /合成応答/);
  assert.equal(button(f.render(), 'AI와 대화하기').props.disabled, true);
  button(f.render(), 'AI와 대화하기').props.onClick(); assert.equal(calls, 1);
  f.state.failWrite = false; const b = button(f.render(), '탭 저장만 다시 시도'); b.props.onClick(); b.props.onClick();
  assert.equal(calls, 1); assert.equal(f.state.writes, 2);
  assert.equal(JSON.parse(f.state.raw!).turns.length, 2);
});
test('repeated quota failure preserves original journal and retained response', async () => {
  const f = fixture(original, async () => reply); await failedSave(f);
  button(f.render(), '탭 저장만 다시 시도').props.onClick();
  assert.equal(f.state.raw, original); assert.match(label(f.render()), /合成応答/);
});
test('retry reads latest journal and refuses corrupt or wrong-owner replacement', async () => {
  const f = fixture(original, async () => reply); await failedSave(f); f.state.failWrite = false;
  for (const raw of ['{broken', original.replace('"owner":"A"', '"owner":"B"')]) {
    f.state.raw = raw; button(f.render(), '탭 저장만 다시 시도').props.onClick(); assert.equal(f.state.raw, raw);
  }
  assert.equal(f.state.writes, 1);
});
test('retry merges later local records instead of overwriting them', async () => {
  const f = fixture(original, async () => reply); await failedSave(f); f.state.failWrite = false;
  const next = JSON.parse(original); next.turns.push({ ...next.turns[0], id: 'later' }); f.state.raw = JSON.stringify(next);
  button(f.render(), '탭 저장만 다시 시도').props.onClick();
  assert.equal(JSON.parse(f.state.raw!).turns.length, 3);
});
test('page exit clears temporary response and stale retry handler cannot write', async () => {
  const f = fixture(original, async () => reply); await failedSave(f);
  const b = button(f.render(), '탭 저장만 다시 시도'); f.leave(); f.state.failWrite = false; b.props.onClick();
  assert.equal(f.state.writes, 1); assert.doesNotMatch(label(f.render()), /合成応答/);
});
test('account-keyed unmount blocks old retry; new account payload is never imported', async () => {
  const f = fixture(original, async () => reply); await failedSave(f);
  const b = button(f.render(), '탭 저장만 다시 시도'); f.unmount(); f.state.failWrite = false; b.props.onClick();
  assert.equal(f.state.writes, 1);
  const source = readFileSync(new URL('../app/language/practice/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /PracticeWorkspace key=\{owner\} owner=\{owner\}/);
});
test('late synthetic response after unmount cannot create a draft or save', async () => {
  let resolve!: (value: unknown) => void;
  const f = fixture(original, () => new Promise(r => { resolve = r; }));
  await failedSave(f); f.unmount(); resolve(reply);
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  assert.equal(f.state.writes, 0); assert.equal(f.state.raw, original);
});
test('already present identical response is acknowledged without an additional write', async () => {
  let calls = 0; const f = fixture(original, async () => { calls++; return reply; });
  await failedSave(f); f.state.failWrite = false; f.state.failAfterWrite = true;
  button(f.render(), '탭 저장만 다시 시도').props.onClick();
  const writes = f.state.writes; f.state.failAfterWrite = false;
  button(f.render(), '탭 저장만 다시 시도').props.onClick();
  assert.equal(f.state.writes, writes); assert.equal(calls, 1); assert.equal(JSON.parse(f.state.raw!).turns.length, 2);
});
test('full latest journal is preserved while unsaved response remains available', async () => {
  const f = fixture(original, async () => reply); await failedSave(f); f.state.failWrite = false;
  const next = JSON.parse(original); next.turns = Array.from({ length: 30 }, (_, i) => ({ ...next.turns[0], id: String(i) }));
  const full = JSON.stringify(next); f.state.raw = full;
  button(f.render(), '탭 저장만 다시 시도').props.onClick();
  assert.equal(f.state.raw, full); assert.equal(f.state.writes, 1); assert.match(label(f.render()), /合成応答/);
});
