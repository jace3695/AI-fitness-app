import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { clearAssistantChatInputDraft as clear, openAssistantChatInputDraft as open, updateAssistantChatInputDraft as update } from './assistant-chat-input-draft.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
const target = new EventTarget();
Object.defineProperty(target, 'localStorage', { get() { throw Error('persistent storage forbidden'); } });
Object.defineProperty(target, 'sessionStorage', { get() { throw Error('persistent storage forbidden'); } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
beforeEach(clear);
after(() => { clear(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });

test('same-owner workspace reentry restores only the bounded unsent text', () => {
  const lease = open('A');
  assert.equal(update(lease, '  작성 중 문장  ', true), true);
  assert.equal(open('A').text, '  작성 중 문장  ');
  assert.equal(update(lease, 'x'.repeat(501), true), false);
  assert.equal(open('A').text, '  작성 중 문장  ');
});
test('clear and consumed-input updates do not resurrect a previous text', () => {
  const lease = open('A'); update(lease, '문장', true);
  assert.equal(update(lease, ''), true);
  assert.equal(open('A').text, '');
  update(lease, '  ', true); assert.equal(open('A').text, '');
});
test('account cycle invalidates old leases and cannot restore either account draft', () => {
  const a = open('A'); update(a, 'A 문장', true);
  const b = open('B'); assert.equal(b.text, ''); update(b, 'B 문장', true);
  assert.equal(open('A').text, '');
  assert.equal(update(a, '늦은 A 문장', true), false);
  assert.equal(update(b, '늦은 B 문장', true), false);
});
test('old workspace completion or clear cannot overwrite a newer writer', () => {
  const a = open('A'), b = open('A');
  update(a, '첫 문장', true); update(b, '최근 문장', true);
  assert.equal(update(a, ''), false);
  assert.equal(update(a, '늦은 추천 문장'), false);
  assert.equal(open('A').text, '최근 문장');
  assert.equal(update(a, '직접 새로 쓴 문장', true), true);
  assert.equal(update(b, ''), false);
  assert.equal(open('A').text, '직접 새로 쓴 문장');
});
test('session change and pagehide invalidate drafts without browser persistence', () => {
  const a = open('A'); update(a, '문장', true);
  target.dispatchEvent(new Event('yeoni-cloud-session-changed'));
  assert.equal(open('A').text, ''); assert.equal(update(a, '늦은 문장', true), false);
  const next = open('A'); update(next, '새 문장', true);
  target.dispatchEvent(new Event('pagehide'));
  assert.equal(open('A').text, '');
});
test('only relevant account or epoch storage events clear the tab memory', () => {
  const a = open('A'); update(a, '문장', true);
  target.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
  assert.equal(open('A').text, '문장');
  target.dispatchEvent(Object.assign(new Event('storage'), { key: 'fitness-cloud-sync-epoch' }));
  assert.equal(open('A').text, '');
});
