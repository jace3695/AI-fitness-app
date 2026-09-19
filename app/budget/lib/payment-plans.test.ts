import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthDueDate, parsePaymentPlan, paymentPlanChecks, type PaymentPlan } from './payment-plans.ts';
import { buildMonthlyCheck } from './monthly-check.ts';

const plan: PaymentPlan = {id:'1',user_id:'owner',name:'구독 1',merchant_key:'구독 1',amount:15000,due_day:31,start_month:'2026-01-01',is_subscription:true,last_used_on:null,enabled:true,revision:'r',request_hash:'h',updated_at:''};
const row=(id:string,date:string,amount:number,place='구독 1',category='구독')=>({id,date,amount,place,category});
test('monthly due dates clamp at month-end and handle leap years and year transitions without timezone shifts',()=>{
  assert.equal(monthDueDate('2026-02',31),'2026-02-28'); assert.equal(monthDueDate('2024-02',31),'2024-02-29');
  assert.equal(monthDueDate('2026-12',31),'2026-12-31'); assert.equal(monthDueDate('0099-02',31),'0099-02-28');
  assert.throws(()=>monthDueDate('2026-13',2)); assert.throws(()=>monthDueDate('2026-01',0));
  const draft={name:'구독 1',amount:'15,000',day:'31',month:'2026-01',subscription:true,lastUsed:'2026-02-30',enabled:true};
  assert.throws(()=>parsePaymentPlan(draft,'2026-03-01'));
  assert.throws(()=>parsePaymentPlan({...draft,lastUsed:'2026-03-02'},'2026-03-01'));
  assert.equal(parsePaymentPlan({...draft,lastUsed:''},'2026-03-01').last_used_on,null);
});
test('only exact names count, unknown usage stays unknown, future records do not imply payment and top-ups are excluded',()=>{
  const records=[row('1','2026-02-28',5000),row('2','2026-02-01',9000,'구독 2'),{...row('3','2026-02-01',10000),transaction_type:'충전카드 충전'}];
  const check=paymentPlanChecks([plan],records,'2026-02','2026-02-27')[0];
  assert.equal(check.days,1); assert.equal(check.count,1); assert.equal(check.recordedCount,0); assert.equal(check.reserved,10000); assert.equal(check.unusedDays,null); assert.equal(check.needsReview,true);
  assert.equal(paymentPlanChecks([{...plan,last_used_on:'2026-01-28'}],[],'2026-02','2026-02-27')[0].unusedDays,30);
  assert.equal(paymentPlanChecks([{...plan,last_used_on:'2026-02-28'}],[],'2026-02','2026-02-27')[0].unusedDays,null);
  assert.deepEqual(paymentPlanChecks([{...plan,enabled:false},{...plan,start_month:'2026-03-01'}],[],'2026-02','2026-02-27'),[]);
});
test('explicit plans replace old fixed guesses once, subtract recorded totals and leave historic reports independent',()=>{
  const records=[row('a','2026-01-01',10000),row('b','2026-02-28',5000)];
  const check=buildMonthlyCheck(records,'2026-02','2026-02-27',100000,[plan]);
  assert.equal(check.spent,5000); assert.equal(check.plannedReserved,10000); assert.equal(check.reserved,10000); assert.equal(check.daily,42500);
  assert.equal(buildMonthlyCheck(records.slice(0,1),'2026-02','2026-02-27',100000,[plan]).reserved,15000);
  assert.equal(buildMonthlyCheck(records.slice(0,1),'2026-02','2026-02-27',100000,[{...plan,enabled:false}]).reserved,0);
  assert.equal(buildMonthlyCheck(records.slice(0,1),'2026-02','2026-03-01',100000,[plan]).reserved,10000);
  assert.throws(()=>buildMonthlyCheck(records,'2026-02','2026-02-27',100000,[{...plan,amount:Number.MAX_SAFE_INTEGER},{...plan,id:'2',merchant_key:'else'}]));
});
test('increase explanations use comparable days, transaction counts and exact merchant deltas without inventing price changes',()=>{
  const records=[row('a','2026-01-01',5000,'가게 A','식비'),row('b','2026-01-28',70000,'가게 B','식비'),row('c','2026-02-01',6000,'가게 A','식비'),row('d','2026-02-10',6000,'가게 A','식비'),row('e','2026-02-28',30000,'미래','식비')];
  const check=buildMonthlyCheck(records,'2026-02','2026-02-10',null);
  assert.equal(check.increases[0].increase,7000); assert.equal(check.increases[0].currentCount,2); assert.equal(check.increases[0].previousCount,1); assert.equal(check.increases[0].currentAverage,6000);
  assert.deepEqual(check.increases[0].merchants,[{name:'가게 A',currentCount:2,previousCount:1,currentAmount:12000,previousAmount:5000,increase:7000}]);
});
