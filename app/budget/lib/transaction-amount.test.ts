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
