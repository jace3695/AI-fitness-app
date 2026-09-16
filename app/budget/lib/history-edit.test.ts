import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountRange, historyCsv, parseExpenseField, parseWholeAmount } from './history-edit.ts';

test('amount boundaries are inclusive and invalid filters cannot silently broaden results', () => {
  for (const [min,max] of [['4,000','5000'],['4000','5,000']]) {
    const range = amountRange(min,max);
    assert.equal(range.error,'');
    assert.deepEqual([3999,4000,4500,5000,5001].filter(range.matches),[4000,4500,5000]);
  }
  assert.equal(amountRange('5000','5000').matches(5000),true);
  assert.equal(amountRange('5000','5000').matches(4999),false);
  for (const [min,max] of [['5000','4000'],['1e3',''],['','1,00'],['-1',''],['','9007199254740992']]) {
    const range = amountRange(min,max); assert.ok(range.error); assert.equal(range.matches(5000),false);
  }
  assert.equal(amountRange('','').matches(0),true);
  assert.equal(amountRange('0','0').matches(0),true);
  assert.equal(parseWholeAmount('9007199254740991'),9007199254740991);
});

test('edit inputs preserve intentional empty memos and reject invalid dates and unsafe amounts', () => {
  assert.deepEqual(parseExpenseField('memo',''),{value:'',error:''});
  assert.deepEqual(parseExpenseField('place','  합성 장소  '),{value:'합성 장소',error:''});
  assert.equal(parseExpenseField('date','2024-02-29').error,'');
  for (const date of ['2026-02-29','0000-01-01','2026-1-01','2026-04-31']) assert.ok(parseExpenseField('date',date).error);
  for (const amount of ['','0','-1','1.5','1e3','9,007,199,254,740,992']) assert.ok(parseExpenseField('amount',amount).error);
  assert.equal(parseExpenseField('payment','unknown').error.length>0,true);
  assert.equal(parseExpenseField('memo','🙂'.repeat(1000)).error,'');
  assert.ok(parseExpenseField('memo','🙂'.repeat(1001)).error);
});

test('filtered CSV has a real BOM and line endings, preserves quotes/newlines and neutralizes formula cells', () => {
  const csv = historyCsv([['내용','금액'],['카페, "A"\n메모',4000],['=SUM(A1)',5000]]);
  assert.equal(csv.charCodeAt(0),0xfeff);
  assert.ok(csv.includes('"카페, ""A""\n메모","4000"'));
  assert.ok(csv.includes('\r\n"\'=SUM(A1)","5000"'));
  assert.equal(csv.includes('\\r\\n'),false);
});
