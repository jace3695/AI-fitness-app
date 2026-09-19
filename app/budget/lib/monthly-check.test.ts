import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCategoryMemory } from './category-memory.ts';
import { buildMonthlyCheck } from './monthly-check.ts';
import { loadBudgetRows } from './load-records.ts';

const row = (id: string, date: string, amount: number, place: string, category = '식비') => ({ id, date, amount, place, category, payment: '체크카드', transaction_type: '일반 지출' });
test('merchant memory uses exact names, preserves income/savings and never mutates original previews', () => {
  const original = [{ type: 'expense', place: '  합성   카페  ', category: '기타' }, { type: 'income', place: '합성 카페', category: '월급' }, { place: '합성 카페 2호점', category: '기타' }];
  const result = applyCategoryMemory(original, [{ merchant_key: '합성 카페', category: '카페', revision: 'x' }]);
  assert.equal(result[0].category, '카페'); assert.equal(result[1].category, '월급'); assert.equal(result[2].category, '기타'); assert.equal(original[0].category, '기타');
});
test('monthly reference includes today, month-end, prepaid exclusion and missing fixed reservations', () => {
  const records = [row('a', '2026-02-01', 10000, '구독 A', '구독'), row('b', '2026-02-01', 20000, '구독 B', '구독'), row('c', '2026-03-01', 12000, '구독 A', '구독'), row('d', '2026-03-31', 18000, '식당'), { ...row('e', '2026-03-31', 30000, '충전'), transaction_type: '충전카드 충전' }];
  const check = buildMonthlyCheck(records, '2026-03', '2026-03-31', 100000);
  assert.equal(check.spent, 30000); assert.equal(check.reserved, 20000); assert.equal(check.remainingDays, 1); assert.equal(check.daily, 50000);
  assert.equal(check.comparisonDay, 28); assert.equal(check.fixed[0].change, 2000);
  assert.equal(buildMonthlyCheck(records, '2026-03', '2026-03-31', 1000).daily, 0);
  assert.equal(buildMonthlyCheck(records, '2026-03', '2026-04-01', 100000).daily, null);
});
test('duplicate candidates retain every original row and distinguish payment/date/place', () => {
  const a = row('a', '2026-09-14', 5000, '상점');
  const records = [a, { ...a, id: 'b' }, { ...a, id: 'c', payment: '현금' }, { ...a, id: 'd', place: '상점 2' }, { ...a, id: 'e', date: '2026-09-15' }];
  const check = buildMonthlyCheck(records, '2026-09', '2026-09-14', null);
  assert.equal(check.spent, 25000); assert.deepEqual(check.duplicates[0].ids, ['a', 'b']); assert.equal(records.length, 5);
});
test('future dates and partial months do not inflate period comparisons or claim a subscription price change', () => {
  const records = [row('a','2026-08-14',1000,'구독','구독'), row('b','2026-08-20',9000,'구독','구독'), row('c','2026-09-14',2000,'구독','구독'), row('d','2026-09-25',3000,'식당')];
  const check = buildMonthlyCheck(records,'2026-09','2026-09-14',100000);
  assert.equal(check.previousCount,1); assert.equal(check.currentCount,1); assert.equal(check.increases[0].increase,1000); assert.equal(check.fixed[0].change,null);
  assert.throws(() => buildMonthlyCheck([{...records[0],amount:NaN}],'2026-09','2026-09-14',null));
  assert.throws(() => buildMonthlyCheck([{...records[0],date:'2026-02-30'}],'2026-09','2026-09-14',null));
});
test('pagination reads more than the default cap, scopes owner and rejects truncation or changing totals', async () => {
  let calls = 0; const all = Array.from({length:1201},(_,id) => ({id:String(id)}));
  const client = { from() { return { select() { return this; }, eq(key: string, value: string) { assert.equal(key,'user_id'); assert.equal(value,'owner'); return this; }, order() { return this; }, async range(start: number,end: number) { calls++; return {data:all.slice(start,end+1),count:1201,error:null}; } }; } };
  assert.equal((await loadBudgetRows(client as never,'budget_transactions','owner')).length,1201); assert.equal(calls,3);
  const failing = { from() { return {select(){return this;},eq(){return this;},order(){return this;},async range(){return {data:[],count:1201,error:null};}};}};
  await assert.rejects(loadBudgetRows(failing as never,'budget_transactions','owner'));
});
