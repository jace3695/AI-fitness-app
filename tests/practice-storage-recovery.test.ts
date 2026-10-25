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
function fixture(raw: string | null = original, transport?: conversation.Transport, clock?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }) {
  const slots: any[] = []; let position = 0;
  const effects: (() => void)[] = [];
  const state = { raw, failRead: true, failWrite: false, failAfterWrite: false, reads: [] as string[], writes: 0, removals: 0 };
  const listeners = new Map<string, Set<() => void>>();
  const browserWindow = {
    addEventListener(name: string, fn: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); },
  };
  const react = {
    useState(initial: any) { const i = position++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial: any) { const i = position++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn: () => any, deps: any[]) { const i = position++; if (!slots[i] || deps.some((x, j) => x !== slots[i].deps[j])) { slots[i]?.cleanup?.(); effects.push(() => { slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const deps: Record<string, unknown> = { react, 'react/jsx-runtime': jsx, './conversation': conversation,
    'next/link': { default: 'a' },
    './Recorder': { default: () => null }, '@/components/ConfirmedConversationArchive': { default: () => null } };
  const dirtyEditors = new Set<symbol>();
  const hookExports: any = {};
  const hookCode = ts.transpileModule(readFileSync(new URL('../components/useUnsavedChanges.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookDeps: Record<string, unknown> = { react, '@/app/lib/unsavedChanges': { setEditorDirty(id: symbol, dirty: boolean) {
    if (dirty) dirtyEditors.add(id); else dirtyEditors.delete(id);
  } } };
  vm.runInNewContext('(function(exports,require){' + hookCode + '})', { window: browserWindow })(hookExports, (name: string) => {
    assert.ok(name in hookDeps, name); return hookDeps[name];
  });
  deps['@/components/useUnsavedChanges'] = hookExports;
  const inputExports: any = {};
  const inputCode = ts.transpileModule(readFileSync(new URL('../app/language/practice/inputDraft.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext('(function(exports,require){' + inputCode + '})', { window: browserWindow })(inputExports, (name: string) => {
    assert.equal(name, './conversation.ts'); return conversation;
  });
  deps['./inputDraft'] = inputExports;
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('../app/language/practice/PracticeWorkspace.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext('(function(exports,require){' + code + '})', {
    AbortController, crypto, setTimeout: clock?.setTimeout ?? setTimeout, clearTimeout: clock?.clearTimeout ?? clearTimeout,
    window: browserWindow,
    sessionStorage: {
      getItem(key: string) { state.reads.push(key); if (state.failRead) throw Error('synthetic unavailable'); return state.raw; },
      setItem(_key: string, value: string) { state.writes++; if (state.failWrite) throw Error('synthetic quota'); state.raw = value; if (state.failAfterWrite) throw Error('synthetic lost confirmation'); },
      removeItem() { state.removals++; state.raw = null; },
    },
  })(exports, (name: string) => { assert.ok(name in deps, name); return deps[name]; });
  function render() { position = 0; const tree = exports.default({ owner: 'A', transport }); while (effects.length) effects.shift()!(); return tree; }
  render();
  return { state, render, dirty: () => dirtyEditors.size > 0, leave: () => [...(listeners.get('pagehide') ?? [])].forEach(fn => fn()), unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
function nodes(tree: any): any[] { if (!tree || typeof tree !== 'object') return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
function label(tree: any): string { if (typeof tree === 'string' || typeof tree === 'number') return String(tree); if (!tree || typeof tree !== 'object') return ''; return [tree.props?.children].flat(Infinity).map(label).join(''); }
function button(tree: any, name: string) { const found = nodes(tree).find(n => n.type === 'button' && label(n) === name); assert.ok(found, name); return found; }
function retry(f: ReturnType<typeof fixture>) { button(f.render(), '기존 탭 기록 다시 불러오기').props.onClick(); f.render(); return f.render(); }

test('actual unsaved-change hook registers the draft and releases it on clear or unmount without saving', () => {
  const f = fixture(null); f.state.failRead = false; retry(f);
  assert.equal(f.dirty(), false);
  nodes(f.render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'synthetic unsent draft' } });
  f.render(); assert.equal(f.dirty(), true);
  nodes(f.render()).find(n => n.type === 'textarea').props.onChange({ target: { value: '' } });
  f.render(); assert.equal(f.dirty(), false);
  nodes(f.render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'synthetic unsent draft' } });
  f.render(); f.unmount(); assert.equal(f.dirty(), false);
  assert.equal(f.state.writes + f.state.removals, 0);
});

test('free AI requires explicit data-use consent before any transport call', async () => {
  let calls = 0; const f = fixture(original, async () => { calls++; return { source: 'ai', reply: '合成', replyReading: 'ごうせい', correction: '合成', explanation: '합성' }; });
  f.state.failRead = false; retry(f);
  nodes(f.render()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'こんにちは' } });
  assert.equal(button(f.render(), 'AI와 대화하기').props.disabled, true);
  await button(f.render(), 'AI와 대화하기').props.onClick();
  assert.equal(calls, 0); assert.equal(f.state.writes, 0);
  assert.match(label(f.render()), /먼저 동의/);
});

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
  nodes(f.render()).find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props.checked === false).props.onChange({ target: { checked: true } });
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

function visibleNodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  const children = [tree.props?.children].flat(Infinity);
  return [tree, ...(tree.type === 'details' && !tree.props.open ? children.filter(n => n?.type === 'summary') : children).flatMap(visibleNodes)];
}
test('simple start keeps consent visible and secondary tools collapsed without losing data', () => {
  const f = fixture(null, async () => reply); f.state.failRead = false; retry(f);
  const tree = f.render(); const shown = visibleNodes(tree);
  assert.ok(shown.some(n => n.type === 'textarea' && n.props.id === 'practice-message'));
  assert.ok(shown.some(n => n.type === 'input' && n.props['aria-describedby'] === 'practice-data-use'));
  assert.ok(shown.some(n => n.type === 'p' && n.props.id === 'practice-data-use'));
  assert.equal(shown.filter(n => n.type === 'button' && n.props.className === 'btn').length, 1);
  assert.equal(shown.find(n => n.type === 'select').props.value, '일상');
  assert.equal(f.state.writes, 0); assert.equal(f.state.removals, 0);
});
test('starter fills Japanese input without sending, saving, or granting consent', () => {
  let calls = 0; const f = fixture(null, async () => { calls++; return reply; }); f.state.failRead = false; retry(f);
  button(f.render(), '이 문장으로 시작 (입력만)').props.onClick();
  const tree = f.render(); assert.equal(nodes(tree).find(n => n.type === 'textarea').props.value, 'こんにちは。');
  assert.equal(button(tree, 'AI와 대화하기').props.disabled, true);
  assert.equal(calls, 0); assert.equal(f.state.writes, 0);
  assert.equal(nodes(tree).some(n => n.type === 'button' && label(n) === '이 문장으로 시작 (입력만)'), false);
});
test('latest response is visible while explanation and history stay optional', () => {
  const raw = JSON.stringify({version: 1, owner: 'A', turns: [{id:'last', text:'合成入力', situation:'일상', review:false, practiced:0, reply}]});
  const f = fixture(raw, async () => reply); f.state.failRead = false; retry(f);
  const shown = visibleNodes(f.render());
  assert.ok(shown.some(n => n.type === 'section' && n.props['aria-label'] === '방금 나눈 대화'));
  assert.ok(shown.some(n => n.type === 'p' && label(n) === '合成応答'));
  assert.equal(shown.some(n => n.type === 'p' && label(n) === 'synthetic only'), false);
  assert.equal(f.state.raw, raw); assert.equal(f.state.writes, 0);
});
test('pronunciation action reveals recorder and closing removes it without writes or AI', () => {
  let calls = 0; const f = fixture(original, async () => {calls++; return reply;}); f.state.failRead = false; retry(f);
  button(f.render(), '이 문장 발음 연습').props.onClick();
  let tree = f.render(); const section = nodes(tree).find(n => n.type === 'details' && n.props.onToggle);
  assert.equal(section.props.open, true);
  section.props.onToggle({currentTarget:{open:false}}); tree=f.render();
  assert.equal(nodes(tree).find(n => n.type === 'details' && n.props.onToggle).props.open, false);
  assert.equal(calls,0); assert.equal(f.state.writes,0);
});

function virtualClock() {
 let now=0, id=0; const jobs=new Map<number,{at:number,run:()=>void}>();
 return { setTimeout: ((fn:()=>void,ms:number)=>{const key=++id;jobs.set(key,{at:now+ms,run:fn});return key;}) as unknown as typeof setTimeout,
 clearTimeout: ((key:number)=>{jobs.delete(key);}) as unknown as typeof clearTimeout,
 async advance(ms:number){const end=now+ms;while(true){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;jobs.delete(next[0]);next[1].run();for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));}now=end;}
 };
}
function beginSynthetic(f: ReturnType<typeof fixture>) {
 f.state.failRead=false;retry(f);nodes(f.render()).find(n=>n.type==='textarea').props.onChange({target:{value:'合成'}});
 nodes(f.render()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props['aria-describedby']==='practice-data-use').props.onChange({target:{checked:true}});
 button(f.render(),'AI와 대화하기').props.onClick();
}
test('bounded client budget allows 4s preparation + 17s provider + 1s return without redispatch',async()=>{
 const clock=virtualClock();let calls=0;let signal:AbortSignal|undefined;
 const f=fixture(null,async(_request,s)=>{calls++;signal=s;await new Promise(r=>clock.setTimeout(r,4000));await new Promise(r=>clock.setTimeout(r,17000));await new Promise(r=>clock.setTimeout(r,1000));return reply;},clock);
 beginSynthetic(f);await clock.advance(22000);
 assert.equal(signal?.aborted,false);assert.equal(calls,1);assert.equal(f.state.writes,1);assert.equal(JSON.parse(f.state.raw!).turns.length,1);
});
test('total timeout cancels a slow request, preserves input and rejects late result',async()=>{
 const clock=virtualClock();let calls=0;let signal:AbortSignal|undefined;
 const f=fixture(null,async(_request,s)=>{calls++;signal=s;await new Promise(r=>clock.setTimeout(r,35000));return reply;},clock);
 beginSynthetic(f);await clock.advance(30000);assert.equal(signal?.aborted,true);assert.equal(f.state.writes,0);
 assert.match(label(f.render()),/자동으로 다시 보내지/);assert.equal(nodes(f.render()).find(n=>n.type==='textarea').props.value,'合成');
 await clock.advance(5000);assert.equal(calls,1);assert.equal(f.state.writes,0);
});
