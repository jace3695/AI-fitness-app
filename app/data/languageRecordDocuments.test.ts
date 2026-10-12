import assert from 'node:assert/strict';
import test from 'node:test';
import { LanguageDocumentError, LanguageSourceConflictError, assertLanguagePathsUnchanged, languageDocument } from './languageRecordDocuments.ts';
import { LANGUAGE_STORAGE_KEYS } from './languageStorageBoundary.ts';

for (const key of LANGUAGE_STORAGE_KEYS.filter(key => key !== 'languageRecordResetV1')) test(`${key}: lossless field/row patch preserves opaque number, escape spelling and duplicate unknown members`, () => {
  const raw = ' \n{ "known":1, "future":9007199254740993123456789, "escaped":"\\u3042", "duplicate":1,"duplicate":2, "nested": {"z":1e999,"a":-0} }\t';
  const doc = languageDocument(raw, 'object').set(['known'], 2);
  assert.equal(doc.text(), raw.replace('"known":1', '"known":2'));
  assert.equal(languageDocument(doc.text(), 'object').get(['known']), 2);
  const list = '[ 9007199254740993123456789, {"known":1,"future":1e999,"future":2}, "\\u3042" ]';
  assert.equal(languageDocument(list, 'array').set([1, 'known'], 2).text(), list.replace('"known":1', '"known":2'));
});
for (const raw of ['', '{', 'null', 'true', '4', '"text"', '[]', '{"a":}', '{"a":1,}', '{"a":01}', '{"a":NaN}', '{"a":"\n"}', '{"a":1}\u00a0']) test(`invalid object is never made writable: ${JSON.stringify(raw)}`, () => {
  assert.throws(() => languageDocument(raw, 'object'), LanguageDocumentError);
});
test('duplicate touched ancestors and fields reject; unknown duplicates remain uninterpreted', () => {
  for (const raw of ['{"x":1,"x":2}', '{"a":{"x":1},"a":{"x":2}}']) {
    const doc = languageDocument(raw, 'object'); const path = raw.includes('"a"') ? ['a', 'x'] : ['x'];
    assert.throws(() => doc.set(path, 3), LanguageDocumentError); assert.equal(doc.text(), raw);
    assert.throws(() => doc.remove(path), LanguageDocumentError); assert.equal(doc.text(), raw);
  }
  const raw = '{"unknown":1,"unknown":2}'; assert.equal(languageDocument(raw, 'object').set(['known'], true).text(), '{"unknown":1,"unknown":2,"known":true}');
});
test('known number replacement does not conflate nonfinite parsed number with null or round large numbers', () => {
  assert.equal(languageDocument('{"x":3e0,"y":5.0}', 'object').set(['x'], 3).set(['y'], 5).text(), '{"x":3e0,"y":5.0}');
  assert.equal(languageDocument('{"x":1e-999}', 'object').set(['x'], 0).text(), '{"x":0}');
  assert.equal(languageDocument('{"x":1e999}', 'object').set(['x'], null).text(), '{"x":null}');
  assert.equal(languageDocument('{"x":9007199254740993}', 'object').set(['x'], 9007199254740992).text(), '{"x":9007199254740992}');
  assert.equal(languageDocument('{"x":"\\u3042"}', 'object').set(['x'], 'あ').text(), '{"x":"\\u3042"}');
});
test('every insertion/removal position emits valid JSON and preserves remaining value tokens', () => {
  for (let length = 0; length < 12; length++) {
    const array = `[ ${Array.from({length}, (_, i) => `{"n":${i},"opaque":9${'0'.repeat(i + 20)}}`).join(' , \n')} ]`;
    for (let index = 0; index < length; index++) {
      const doc = languageDocument(array, 'array'); const keep = Array.from({length}, (_, i) => doc.rawAt([i])).filter((_, i) => i !== index);
      doc.remove([index]); assert.equal(JSON.parse(doc.text()).length, length - 1);
      assert.deepEqual(Array.from({ length: doc.length() }, (_, i) => doc.rawAt([i])), keep);
    }
    const added = languageDocument(array, 'array').appendRaw([], '{"new":1e999}'); assert.equal(added.rawAt([length]), '{"new":1e999}');
  }
  for (const key of ['a', 'b', 'c']) { const doc = languageDocument(' { "a":1, "b":2, "c":3 } ', 'object').remove([key]); assert.equal(Object.keys(JSON.parse(doc.text())).length, 2); }
});
test('missing parents initialize narrowly and malformed existing parents reject', () => {
  assert.equal(languageDocument(undefined, 'object').set(['a', 'b'], 1).text(), '{"a":{"b":1}}');
  for (const value of ['null', '[]', '1']) assert.throws(() => languageDocument(`{"a":${value}}`, 'object').set(['a','b'], 1));
  assert.throws(() => languageDocument('{}','object').set(['a',0], 1));
  for (const value of [undefined, NaN, Infinity, new Date()]) assert.throws(() => languageDocument('{}','object').set(['a'], value));
});
test('setRaw migrates exact unknown legacy draft bytes without token changes', () => {
  const raw = '{"id":"old","unknown":1e999,"duplicate":1,"duplicate":2}';
  assert.equal(languageDocument('{}','object').setRaw(['drafts','lesson'], raw).rawAt(['drafts','lesson']), raw);
});
test('source proofs distinguish exact tokens, absence, whole-source whitespace, and malformed ancestors', () => {
  assertLanguagePathsUnchanged('{"a":1,"b":2}', '{"a":1,"b":3}', 'object', [['a']]);
  assert.throws(() => assertLanguagePathsUnchanged('{"a":1}', '{"a":1.0}', 'object', [['a']]), LanguageSourceConflictError);
  assert.throws(() => assertLanguagePathsUnchanged(undefined, '{}', 'object', [[]]), LanguageSourceConflictError);
  assert.throws(() => assertLanguagePathsUnchanged('{"a":null}', '{"a":{}}', 'object', [['a','b']]), LanguageDocumentError);
});
