import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { buildFreeConversation } from '../../data/freeConversation.ts';
import { LEGACY_FREE_CONVERSATION_SCRIPTS } from '../../data/freeConversationCatalog.ts';
import { FREE_MODE } from '../free-mode.ts';
import { conversationSessionFixture } from '../../tests/helpers/conversationSessionFixture.ts';

const pageSource = ts.createSourceFile('page.tsx', readFileSync(new URL('../../app/language/conversation/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('FREE_MODE shipping entry mounts only the local session page before the isolated paid handler', () => {
  assert.equal(FREE_MODE, true);
  const entry = pageSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ConversationPage') as ts.FunctionDeclaration | undefined;
  const local = pageSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LocalConversationPage') as ts.FunctionDeclaration | undefined;
  assert.ok(entry?.body); assert.ok(local?.body);
  const branch = entry.body.statements.find(ts.isIfStatement); assert.ok(branch); assert.equal(branch.expression.getText(pageSource), 'FREE_MODE');
  assert.match(branch.thenStatement.getText(pageSource), /return\s+<LocalConversationPage\s*\/>/);
  assert.doesNotMatch(local.body.getText(pageSource), /\b(?:fetch|authenticatedJsonHeaders|buildFreeConversation)\s*\(/);
  assert.match(local.body.getText(pageSource), /useConversationSession\s*\(/);
});

// The old source-only fixture extracted the paid page's retained handleSend once
// the free page was split out. These checks now execute the active shipping hook,
// registered observation/facade and actual fixed-response contracts together.
// Synthetic hosts/SDK are not real-browser acceptance or physical audio tests.
for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) test(`FREE_MODE ${script.legacySituation} sample/reading/normalized/arbitrary shipping sends remain exact and local`, async t => {
  const f = await conversationSessionFixture(); t.after(f.dispose);
  const h = f.mountHook(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../../components/language/useConversationSession.ts')).useConversationSession());
  const example = script.content;
  for (const input of [example.japanese, example.reading, ` ${example.japanese} `, example.japanese.replace(/[。、！？?!]/g, ''), 'PRIVATE_SYNTHETIC_ARBITRARY_FREE_INPUT']) {
    assert.equal(await h.current.start(script.scriptId), true);
    h.current.typeInput(input); await h.view.settle(); assert.equal(await h.current.send(), true); await h.view.settle();
    const session = h.current.session!; assert.equal(session.turns.length, 1); assert.equal(session.turns[0].draft.input, input);
    const practice = buildFreeConversation(script.legacySituation, input), emitted = session.turns[0].emission;
    for (const field of ['reply', 'replyReading', 'replyKoreanPronunciation', 'explanation'] as const) assert.equal(emitted[field], practice[field]);
    assert.equal(emitted.correction, ''); assert.equal(emitted.correctionReading, ''); assert.equal(emitted.correctionKoreanPronunciation, '');
    assert.equal(emitted.source, 'local'); assert.equal(session.turns[0].sampleMatch.assessment, 'unavailable'); assert.equal(h.current.input, '');
    assert.equal(f.audio.length, 0);
  }
  await f.refresh(); await h.view.settle();
  assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE_SYNTHETIC_ARBITRARY_FREE_INPUT|yeoni-conversation-local-v1/);
  assert.ok(f.calls.every(call => call.kind === 'read'), 'Conversation-only writes may wake legacy sync, but do not upload conversation content');
});
