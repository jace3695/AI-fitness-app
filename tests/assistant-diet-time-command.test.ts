import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { dietDaySnapshot, dietNextSnapshot, parseDietCommand, isDietCommandProposal, isDietRecordIntent, describeDietSnapshot } from '../lib/assistant-diet-command.ts';
import { DIET_FASTING_KEY as fasting, DIET_TIME_STORE_KEYS as keys, type DietTimeChange } from '../lib/assistant-diet-time-command.ts';
import { assertPastMealTime, fastingStartForDay } from '../lib/diet-time.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';
const db = new PGlite(), owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const record = 'ai-fitness-diet-completed-days';
const original: Row = {
  settings: 'keep', [record]: { '2001-01-01': { dietMemo: 'old' }, [today()]: { dietMemo: 'keep', waterMl: 300, proteinTotal: 70, meals: { lunch: true }, fastingRecordStatus: '12h', fastingHours: 12, fastingSuccess: false, lastMealTime: '19:10', dinnerBefore1830: false } },
  [keys.meal]: { '2001-01-01': { lastMealTime: '20:00' }, [today()]: { lastMealTime: '19:10', lunchProteinChoice: '30', dinnerCarb: '80', extra: 'keep' } },
  [keys.dinnerTime]: { '2001-01-01': '20:00', [today()]: '19:10' }, [fasting]: '19:10',
  'ai-fitness-water-intake': { [today()]: 300 }, 'ai-fitness-protein-total': { [today()]: 70 },
};
const change: DietTimeChange = { kind: 'time', time: '00:00' };
const request = (source: Row = original, overrides = {}) => ({ id: randomUUID(), day: today(), change, expected: dietDaySnapshot(source, today(), change), resets: { diet: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_diet_time_command($1,$2,$3,$4,$5,$6) receipt', [p.id,p.day,p.change,p.expected,p.resets,p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_diet_command($1) receipt',[id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state:Row}>('select state from public.user_app_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n:number}>('select count(*) n from public.assistant_diet_command_history')).rows[0].n);
const write = (value:Row) => db.query('update public.user_app_state set state=$1',[value]);
const read = (path:string) => readFileSync(new URL(path,import.meta.url),'utf8');
const semantic = (value:Row) => Object.fromEntries(Object.entries(value).map(([k,v])=>{try{return [k,typeof v==='string'?JSON.parse(v):v];}catch{return[k,v];}}));
before(async()=>{
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(read('./e2e/schema.sql'));
  for(const name of ['20260901125340_add_fitness_ai_review_history','20260906141943_add_app_record_resets','20260915034857_assistant_task_command_history','20260916104440_assistant_diet_commands','20260916131029_assistant_diet_meal_commands','20260916142043_assistant_diet_time_commands'])await db.exec(read(`../supabase/migrations/${name}.sql`));
});
after(async()=>db.close());
beforeEach(async()=>{
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)',[owner,original]);
});
test('confirmed clock synchronizes four stores and exactly restores legacy raw clock without changing fasting completion',async()=>{
  const p=request(),receipt=await apply(p),saved=await state();
  assert.deepEqual(receipt.after_values,dietNextSnapshot(p.expected,change,today()));assert.deepEqual(dietDaySnapshot(saved,today(),change),receipt.after_values);
  assert.deepEqual((receipt.after_values as Row).record,{...p.expected.record,lastMealTime:'00:00',dinnerBefore1830:true});
  assert.deepEqual((receipt.after_values as Row).meal,{...p.expected.meal,lastMealTime:'00:00'});
  assert.equal(fastingStartForDay(saved[fasting],today()),'00:00');assert.equal(fastingStartForDay(saved[fasting],'2001-01-01'),'');
  assert.deepEqual(saved['ai-fitness-protein-total'],original['ai-fitness-protein-total']);assert.deepEqual(saved['ai-fitness-water-intake'],original['ai-fitness-water-intake']);
  assert.deepEqual(await apply(p),receipt);assert.equal(await count(),1);const undone=await undo(p.id);assert.ok(undone.undone_at);assert.deepEqual(await state(),original);assert.deepEqual(await apply(p),undone);assert.deepEqual(await undo(p.id),undone);
});
for(const [label,value] of [['JSON scalar','"19:10"'],['object map',{'2001-01-01':'20:00',[today()]:'19:10'}],['JSON map',JSON.stringify({'2001-01-01':'20:00',[today()]:'19:10'})],['empty','']] as const)test(`${label} fasting format preserves previous dates and restores exact original value`,async()=>{
  const source={...original,[fasting]:value};await write(source);const p=request(source);await apply(p);const saved=await state();
  assert.equal(fastingStartForDay(saved[fasting],today()),'00:00');
  if(label.includes('map'))assert.equal(fastingStartForDay(saved[fasting],'2001-01-01'),'20:00');
  await undo(p.id);assert.deepEqual(await state(),source);
});
test('first record adds only clock facts and removes newly created keys on undo',async()=>{
  const source={settings:'keep'};await write(source);const p=request(source);const receipt=await apply(p);
  assert.deepEqual(receipt.after_values,{record:{lastMealTime:'00:00',dinnerBefore1830:true},meal:{lastMealTime:'00:00'},dinnerTime:'00:00',fastingStart:{[today()]:'00:00'}});
  await undo(p.id);assert.deepEqual(await state(),source);
});
test('string date stores keep their representation and other dates after undo',async()=>{
  const source=Object.fromEntries(Object.entries(original).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v]));await write(source);const p=request(source);await apply(p);assert.equal(typeof (await state())[keys.meal],'string');await undo(p.id);assert.deepEqual(semantic(await state()),semantic(source));
});
test('stale summary, meal, dinner and global fasting confirmations never overwrite later edits',async()=>{
  for(const key of [record,keys.meal,keys.dinnerTime,fasting]){await write(original);const p=request();const modified={...original,[key]:key===fasting?'18:00':{[today()]:key===keys.dinnerTime?'18:00':{lastMealTime:'18:00'}}};await write(modified);await assert.rejects(apply(p),/다른 곳에서 오늘 식단 기록이 변경/);assert.deepEqual(await state(),modified);}assert.equal(await count(),0);
});
test('undo protects later global clocks including another day',async()=>{
  const p=request();await apply(p);const saved=await state();for(const value of ['22:00',{...(saved[fasting] as Row),'2000-01-01':'22:00'}]){const modified={...saved,[fasting]:value};await write(modified);await assert.rejects(undo(p.id),/새 기록을 보호/);assert.deepEqual(await state(),modified);}
});
test('unrelated dated records added later survive undo',async()=>{
  const p=request();await apply(p);const saved=await state();await write({...saved,[record]:{...(saved[record] as Row),'2000-01-01':{dietMemo:'later'}}});await undo(p.id);assert.deepEqual(await state(),{...original,[record]:{...(original[record] as Row),'2000-01-01':{dietMemo:'later'}}});
});
test('malformed existing clocks and stores fail closed consistently',async()=>{
  for(const patch of [{[fasting]:null},{[fasting]:'25:00'},{[fasting]:{[today()]:false}},{[keys.meal]:{[today()]:{lastMealTime:null}}},{[keys.dinnerTime]:{[today()]:'12:60'}},{[record]:{[today()]:{lastMealTime:7}}}]){
    const source={...original,...patch};await write(source);assert.throws(()=>dietDaySnapshot(source,today(),change));await assert.rejects(apply(request()),/시각/);assert.deepEqual(await state(),source);
  }assert.equal(await count(),0);
});
test('invalid clock, missing fields and extra payload fields cannot write through RPC',async()=>{
  for(const edit of [{kind:'time',time:'24:00'},{kind:'time',time:'18:60'},{kind:'time',time:'6:30'},{kind:'time',time:null},{kind:'time'},{...change,extra:true},{kind:'time',time:'18:30:00'}])await assert.rejects(apply(request(original,{change:edit})));
  assert.deepEqual(await state(),original);assert.equal(await count(),0);
});
test('future, expired, far-future expiry and non-today requests fail without mutation',async()=>{
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  if(clock<'23:59')await assert.rejects(apply(request(original,{change:{kind:'time',time:'23:59'}})),/아직 지나지 않은/);
  for(const overrides of [{expires:'2001-01-01T00:00:00Z'},{expires:new Date(Date.now()+60*60_000).toISOString()},{day:'2001-01-01'}])await assert.rejects(apply(request(original,overrides)));
  assert.deepEqual(await state(),original);assert.equal(await count(),0);
});
test('lost-response retries stay idempotent after expiry and reject request reuse',async()=>{
  const p=request(original,{expires:new Date(Date.now()+150).toISOString()}),receipt=await apply(p);await new Promise(resolve=>setTimeout(resolve,170));assert.deepEqual(await apply(p),receipt);await assert.rejects(apply({...p,change:{kind:'time',time:'00:01'}}),/이미 사용한 요청/);assert.equal(await count(),1);
});
test('receipt insert failure rolls all four writes back',async()=>{
  await db.exec(`reset role; create function public.reject_time_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end $$; create trigger reject_time_receipt before insert on public.assistant_diet_command_history for each row execute function public.reject_time_receipt(); set role authenticated;`);
  try{await assert.rejects(apply(request()),/synthetic receipt failure/);assert.deepEqual(await state(),original);assert.equal(await count(),0);}finally{await db.exec('reset role; drop trigger reject_time_receipt on public.assistant_diet_command_history; drop function public.reject_time_receipt(); set role authenticated;');}
});
test('reset invalidates proposals and receipts',async()=>{
  const p=request();await apply(p);await write({...await state(),'ai-fitness-record-reset-diet':'reset-test'});assert.equal(await count(),0);await assert.rejects(apply(p),/초기화/);await assert.rejects(undo(p.id),/찾을 수 없습니다/);
});
test('owner isolation and anonymous permissions protect clock writes and receipts',async()=>{
  const p=request();await apply(p);await db.exec(`set app.test_user='${other}'`);assert.equal(await count(),0);assert.equal(await state(),undefined);await assert.rejects(undo(p.id),/찾을 수 없습니다/);await db.exec(`set app.test_user='${owner}'; set role anon;`);await assert.rejects(apply(request()),/permission denied/);
});
test('explicit 24-hour grammar rejects inferred, multi-action and other-day times',()=>{
  for(const text of ['오늘 마지막 식사 18:30 기록해줘','오늘 식단 마지막 식사 시각 18:30 저장해주세요','마지막 식사 시간 18:30으로 기록해줘']){assert.deepEqual(parseDietCommand(text),{kind:'time',time:'18:30'});assert.ok(isDietRecordIntent(text));}
  assert.deepEqual(parseDietCommand('오늘 마지막 식사 6:05 기록해줘'),{kind:'time',time:'06:05'});
  for(const text of ['어제 마지막 식사 18:30 기록해줘','오늘 마지막 식사 오후 6시 기록해줘','오늘 마지막 식사 지금 기록해줘','오늘 마지막 식사 24:00 기록해줘','오늘 마지막 식사 18:60 기록해줘','오늘 마지막 식사 18:30 기록해줘 그리고 공복 완료해줘'])assert.throws(()=>parseDietCommand(text));
});
test('clock validation compares KST date at minute boundaries without inferring fasting success',()=>{
  const now=Date.parse('2026-09-16T09:30:00Z');assert.doesNotThrow(()=>assertPastMealTime('2026-09-16','18:30',now));assert.throws(()=>assertPastMealTime('2026-09-16','18:31',now));
  assert.equal(dietNextSnapshot({}, {kind:'time',time:'18:30'},today()).record?.dinnerBefore1830,true);assert.equal(dietNextSnapshot({}, {kind:'time',time:'18:31'},today()).record?.dinnerBefore1830,false);
});
test('time drafts recover safely; water and meal snapshot shapes remain isolated',()=>{
  const p=request(),proposal={domain:'diet',ownerId:owner,requestId:p.id,date:p.day,change:p.change,expected:p.expected,resetMarkers:p.resets,expiresAt:p.expires};assert.ok(isDietCommandProposal(proposal));
  assert.equal(isDietCommandProposal({...proposal,expected:{...p.expected,extra:1}}),false);assert.equal(isDietCommandProposal({...proposal,change:{kind:'water',totalMl:500}}),false);
  assert.equal(readCommandDrafts(JSON.stringify({version:1,ownerId:owner,drafts:[{proposal,attempted:false}]}),owner).length,1);
  assert.equal(describeDietSnapshot(dietNextSnapshot(p.expected,change,today()),change,today()),'마지막 식사 00:00');assert.deepEqual(Object.keys(dietDaySnapshot(original,today())).sort(),['record','water']);
});
test('legacy display reads scalar and date map, and never reuses a different dated entry',()=>{
  for(const value of ['18:30','"18:30"',{[today()]:'18:30'},JSON.stringify({[today()]:'18:30'})])assert.equal(fastingStartForDay(value,today()),'18:30');
  for(const value of [null,'24:00','18:99',{other:'18:30'},'broken',[]])assert.equal(fastingStartForDay(value,today()),'');
});
