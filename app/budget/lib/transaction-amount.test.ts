import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInputLocally } from './transaction-parser.ts';

test('currency amounts take precedence over digits in store names or dates', () => {
  assert.equal(parseInputLocally('오늘 GS25 카페 1000원 체크카드')[0].amount, 1000);
  assert.equal(parseInputLocally('9월 9일 점심 9000원')[0].amount, 9000);
  assert.equal(parseInputLocally('QA-PR189 카페 1000원')[0].amount, 1000);
});

test('thousands separators stay inside one amount while transaction commas split entries', () => {
  const items = parseInputLocally('점심 9,000원, 월급 2,500,000원, 적금 5만원');
  assert.deepEqual(items.map(item => item.amount), [9000, 2500000, 50000]);
  assert.equal(parseInputLocally('커피 1.5천원')[0].amount, 1500);
});

test('negative, fractional won and unsafe amounts are rejected instead of silently changed', () => {
  for (const input of ['환불 -1000원', '커피 - 1.5천원', '커피 1.5원', '커피 0.0001천원', '급여 9007199254740992원']) {
    assert.throws(() => parseInputLocally(input), /금액/);
  }
});
test('decimal unit conversion keeps exact whole won without floating rounding', () => {
  assert.equal(parseInputLocally('커피 1.001천원')[0].amount, 1001);
  assert.equal(parseInputLocally('식비 0.0001만원')[0].amount, 1);
  assert.equal(parseInputLocally('커피 1.0000원')[0].amount, 1);
});
test('invalid amount in a batch rejects the entire preview rather than dropping an entry', () => {
  assert.throws(() => parseInputLocally('점심 9000원, 환불 -1000원'), /금액/);
});
