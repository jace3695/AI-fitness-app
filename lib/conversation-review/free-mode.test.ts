import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildFreeConversation, FREE_CONVERSATIONS } from '../../data/freeConversation.ts';
import { FREE_MODE } from '../free-mode.ts';

const pageSource = ts.createSourceFile('page.tsx', readFileSync(new URL('../../app/language/conversation/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map<string, ts.Expression>();
function findHandlers(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['handleSend', 'handleKeyDown'].includes(node.name.text) && node.initializer) {
    handlers.set(node.name.text, node.initializer);
  }
  ts.forEachChild(node, findHandlers);
}
findHandlers(pageSource);
assert.equal(handlers.size, 2, 'the shipping conversation page has send and keyboard handlers');
const handlerCode = ts.transpileModule(`${[...handlers].map(([name, handler]) => `const ${name} = ${handler.getText(pageSource)};`).join('\n')}\nexports.send = handleSend; exports.keyDown = handleKeyDown;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Exercise the shipping handler with denied network/auth/audio boundaries.
// This is a source-level regression, not browser or full-page acceptance.
function fixture(situation: keyof typeof FREE_CONVERSATIONS, input: string, loading = false, builder = buildFreeConversation) {
  const previous = { role: 'user', text: 'synthetic earlier turn' };
  const state = { messages: [previous] as Record<string, unknown>[], input, loading, error: 'previous error' as unknown };
  const calls = { auth: 0, fetch: 0, voice: 0, builder: 0 };
  const forbidden = (boundary: 'auth' | 'fetch' | 'voice') => () => {
    calls[boundary]++;
    throw new Error(`Unexpected ${boundary} access`);
  };
  const exports = {} as { send: () => Promise<void>; keyDown: (event: { key: string; nativeEvent: { isComposing: boolean } }) => void };
  const context = {
    exports, FREE_MODE, situation, input, loading, messages: state.messages, Error,
    lastFreeSendMessages: { current: null },
    buildFreeConversation: (selected: keyof typeof FREE_CONVERSATIONS, text: string) => {
      calls.builder++;
      return builder(selected, text);
    },
    authenticatedJsonHeaders: forbidden('auth'), fetch: forbidden('fetch'), handleSpeak: forbidden('voice'),
    setMessages: (value: Record<string, unknown>[]) => { state.messages = value; },
    setInput: (value: string) => { state.input = value; },
    setLoading: (value: boolean) => { state.loading = value; },
    setError: (value: unknown) => { state.error = value; },
  };
  vm.runInNewContext(handlerCode, context);
  const render = (nextInput = state.input) => {
    state.input = nextInput;
    context.input = nextInput;
    context.messages = state.messages;
    context.loading = state.loading;
  };
  return { send: exports.send, keyDown: exports.keyDown, render, state, calls, previous };
}

test('FREE_MODE page imports the existing local exercise builder', () => {
  assert.equal(FREE_MODE, true);
  const imported = pageSource.statements.some(statement =>
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === '@/data/freeConversation'
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(element => element.name.text === 'buildFreeConversation'));
  assert.equal(imported, true);
});

test('FREE_MODE sample, reading, normalized and arbitrary sends return locally without auth, network or voice', async () => {
  for (const situation of Object.keys(FREE_CONVERSATIONS) as (keyof typeof FREE_CONVERSATIONS)[]) {
    const lesson = FREE_CONVERSATIONS[situation];
    for (const input of [lesson.japanese, lesson.reading, ` ${lesson.japanese} `, lesson.japanese.replace(/[。、！？?!]/g, ''), 'synthetic arbitrary alternative']) {
      const qa = fixture(situation, input);
      await qa.send();
      assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 1 });
      assert.equal(qa.state.loading, false);
      assert.equal(qa.state.error, null);
      assert.equal(qa.state.input, '');
      assert.equal(qa.state.messages.length, 3);
      assert.equal(qa.state.messages[0], qa.previous);
      assert.equal(qa.state.messages[1].role, 'user');
      assert.equal(qa.state.messages[1].text, input.trim());
      const practice = buildFreeConversation(situation, input.trim());
      const reply = qa.state.messages[2];
      assert.equal(reply.role, 'assistant');
      for (const field of ['reply', 'replyReading', 'replyKoreanPronunciation', 'explanation'] as const) {
        assert.equal(reply[field], practice[field]);
      }
      assert.equal(reply.originalUserText, input.trim());
      assert.equal(reply.correction, '');
      assert.equal(reply.correctionReading, '');
      assert.equal(reply.correctionKoreanPronunciation, '');
      if (input === 'synthetic arbitrary alternative') assert.equal(reply.reply, lesson.japanese);
      else assert.equal(reply.reply, lesson.reply);
    }
  }
});

test('blank and already-loading sends leave state unchanged before the local builder or any boundary', async () => {
  for (const [input, loading] of [['  ', false], ['synthetic pending send', true]] as const) {
    const qa = fixture('카페', input, loading);
    const before = structuredClone(qa.state);
    await qa.send();
    assert.deepEqual(qa.state, before);
    assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 0 });
  }
});

test('local builder failure retains the exact draft and history, then allows the same-render retry', async () => {
  const input = '  synthetic draft with spacing  ';
  let fail = true;
  const qa = fixture('카페', input, false, (situation, text) => {
    if (fail) throw new Error('Synthetic local builder failure');
    return buildFreeConversation(situation, text);
  });
  const messages = qa.state.messages;
  await qa.send();
  assert.equal(qa.state.messages, messages);
  assert.equal(qa.state.input, input);
  assert.equal(qa.state.loading, false);
  assert.equal(qa.state.error, 'Synthetic local builder failure');
  assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 1 });
  fail = false;
  await qa.send();
  assert.equal(qa.state.messages.length, 3);
  assert.equal(qa.state.messages[1].text, input.trim());
  assert.equal(qa.state.input, '');
  assert.equal(qa.state.error, null);
  assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 2 });
});

test('consecutive sends from one render commit once, while a later render can send another turn', async () => {
  const input = 'synthetic repeated input';
  const qa = fixture('카페', input);
  await Promise.all([qa.send(), qa.send()]);
  assert.equal(qa.state.messages.length, 3);
  assert.equal(qa.calls.builder, 1);
  qa.render(input);
  await qa.send();
  assert.equal(qa.state.messages.length, 5);
  assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 2 });
});

test('IME composition and non-Enter keys do not send; repeated committed Enter sends only once', () => {
  const qa = fixture('카페', 'synthetic IME draft');
  qa.keyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
  qa.keyDown({ key: 'a', nativeEvent: { isComposing: false } });
  assert.equal(qa.state.messages.length, 1);
  assert.equal(qa.calls.builder, 0);
  qa.keyDown({ key: 'Enter', nativeEvent: { isComposing: false } });
  qa.keyDown({ key: 'Enter', nativeEvent: { isComposing: false } });
  assert.equal(qa.state.messages.length, 3);
  assert.deepEqual(qa.calls, { auth: 0, fetch: 0, voice: 0, builder: 1 });
});
