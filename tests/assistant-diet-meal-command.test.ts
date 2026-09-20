import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { dietDaySnapshot, dietNextSnapshot, parseDietCommand, isDietCommandProposal, isDietRecordIntent, describeDietSnapshot } from '../lib/assistant-diet-command.ts';
import { DIET_MEAL_STORE_KEYS as keys, type DietMealChange } from '../lib/assistant-diet-meal-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';
const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const recordKey = 'ai-fitness-diet-completed-days';
const original = {
  settings: 'keep', 'ai-fitness-diet-start-date': '2026-08-24',
  [keys.meal]: { '2001-01-01': { note: 'old meal' }, [today()]: { lunchProteinChoice: '25', breakfastShake: true, afternoonShake: 'half', dinnerProteinChoice: 'custom', dinnerProteinCustom: 27, afterDinnerShake: 'none', lunchRice: true, dinnerCarb: '50', lastMealTime: '19:10', futureField: 'keep' } },
  [keys.proteinTotal]: { [today()]: 115 },
  [keys.supplement]: { [today()]: { type: 'half', protein: 16, customProtein: 0, assessment: 'uncertain', customField: 'keep' } },
  [keys.lunchCarb]: { [today()]: { amountType: '100', grams: 100, riceType: '현미밥', customRiceType: '', estimatedCarbs: 30, customField: 'keep rice' } },
  [keys.dinnerCarb]: { [today()]: { amountType: '50', grams: 50, riceType: '기타', customRiceType: '사용자 밥', estimatedCarbs: 15 } },
  [keys.social]: { [today()]: 'lunch' },
  [recordKey]: { '2001-01-01': { dietMemo: 'old' }, [today()]: { proteinTotal: 115, meals: { breakfast: true }, dietMemo: '기존 메모', fastingRecordStatus: '12h', lastMealTime: '19:10', customField: 'keep' } },
  'ai-fitness-water-intake': { [today()]: 300 },
};
const change = (slot: 'lunch' | 'dinner' = 'lunch', field: 'protein' | 'rice' = 'protein', grams = 30): DietMealChange => ({ kind: 'meal', slot, field, grams });
const request = (source: Row = original, edit = change(), overrides = {}) => ({ id: randomUUID(), day: today(), change: edit, expected: dietDaySnapshot(source, today(), edit), resets: { diet: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_diet_meal_command($1,$2,$3,$4,$5,$6) receipt', [p.id, p.day, p.change, p.expected, p.resets, p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_diet_command($1) receipt', [id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state: Row}>('select state from public.user_app_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_diet_command_history')).rows[0].n);
const write = async (value: Row) => db.query('update public.user_app_state set state=$1', [value]);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const semantic = (value: Row) => Object.fromEntries(Object.entries(value).map(([k,v]) => { try { return [k, typeof v === 'string' ? JSON.parse(v) : v]; } catch { return [k,v]; } }));
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(read('./e2e/schema.sql'));
  for (const name of ['20260901125340_add_fitness_ai_review_history', '20260906141943_add_app_record_resets', '20260915034857_assistant_task_command_history', '20260916104440_assistant_diet_commands', '20260916131029_assistant_diet_meal_commands', '20260916142043_assistant_diet_time_commands']) await db.exec(read(`../supabase/migrations/${name}.sql`));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)', [owner, original]);
});
for (const slot of ['lunch','dinner'] as const) for (const field of ['protein','rice'] as const) test(`${slot} ${field} keeps unrelated fields, mirrors review and restores exactly`, async () => {
  const p = request(original,change(slot,field,field === 'rice' ? 130 : 32)); const receipt = await apply(p);
  assert.deepEqual(receipt.after_values, dietNextSnapshot(p.expected,p.change));
  const saved = await state(); const next = dietDaySnapshot(saved,today(),p.change);
  assert.deepEqual(next,receipt.after_values);
  assert.deepEqual(next.supplement,p.expected.supplement); assert.deepEqual(next.social,p.expected.social); assert.deepEqual(next.water,p.expected.water);
  assert.deepEqual(next.record?.meals,p.expected.record?.meals); assert.equal(next.record?.lastMealTime,'19:10'); assert.equal(next.record?.dietMemo,'기존 메모');
  assert.equal(next.meal?.futureField,'keep'); assert.equal(next.meal?.breakfastShake,true);
  assert.deepEqual(saved.settings,original.settings); assert.deepEqual((saved[keys.meal] as Row)['2001-01-01'],original[keys.meal]['2001-01-01']);
  if(field === 'protein') assert.equal(next.proteinTotal,slot==='lunch'?122:120);
  else { assert.equal(next.proteinTotal,115); assert.equal((next[slot==='lunch'?'lunchCarb':'dinnerCarb'] as Row).grams,130); }
  assert.deepEqual(await apply(p),receipt); assert.equal(await count(),1);
  const undone=await undo(p.id); assert.ok(undone.undone_at); assert.deepEqual(await state(),original); assert.deepEqual(await apply(p),undone); assert.deepEqual(await undo(p.id),undone);
});
test('zero clears only the selected meal amount and derives the remaining total', async()=>{
  for (const field of ['protein','rice'] as const) {
    const p=request(original,change('lunch',field,0));const saved=(await apply(p)).after_values as Row;
    if(field==='protein') assert.equal(saved.proteinTotal,90);else assert.equal((saved.lunchCarb as Row).grams,0);
    await undo(p.id);assert.deepEqual(await state(),original);
  }
});
test('a first record never invents a meal time, other meals, rice type or completion',async()=>{
  await write({settings:'keep'});
  const p=request({settings:'keep'});const saved=(await apply(p)).after_values as Row;
  assert.deepEqual(saved.meal,{lunchProteinChoice:'custom',lunchProteinCustom:30});assert.equal((saved.record as Row).proteinTotal,30);assert.equal((saved.record as Row).meals,undefined);
  await undo(p.id);assert.deepEqual(await state(),{settings:'keep'});
  const rice=request({settings:'keep'},change('dinner','rice',80));const riceSaved=(await apply(rice)).after_values as Row;
  assert.equal((riceSaved.dinnerCarb as Row).riceType,'기타');assert.equal((riceSaved.dinnerCarb as Row).customRiceType,'종류 미기록');await undo(rice.id);assert.deepEqual(await state(),{settings:'keep'});
});
test('string stores and legacy numeric supplements survive save and exact semantic undo',async()=>{
  const before: Row = Object.fromEntries(Object.entries(original).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v]));
  before[keys.supplement]=JSON.stringify({[today()]:16});await write(before);
  const p=request(before);await apply(p);assert.equal(typeof (await state())[keys.meal],'string');await undo(p.id);assert.deepEqual(semantic(await state()),semantic(before));
});
test('legacy numeric and named rice records can be explicitly replaced without inventing their type',async()=>{
  for(const value of [70,'third-bowl']){const before={...original,[keys.lunchCarb]:{[today()]:value}};await write(before);const p=request(before,change('lunch','rice',125));const receipt=await apply(p);assert.equal(((receipt.after_values as Row).lunchCarb as Row).grams,125);await undo(p.id);assert.deepEqual(await state(),before);}
});
test('stale meal, supplement, rice, social and aggregate snapshots cannot overwrite changes',async()=>{
  for(const key of [keys.meal,keys.supplement,keys.lunchCarb,keys.social,keys.proteinTotal]){await write(original);const p=request();const changed={...original,[key]:{[today()]:key===keys.social?'travel':key===keys.proteinTotal?999:{customField:'later'}}};await write(changed);await assert.rejects(apply(p),/다른 곳에서 오늘 식단 기록이 변경/);assert.deepEqual(await state(),changed);}assert.equal(await count(),0);
});
test('later same-day edits block undo while unrelated dates stay intact',async()=>{
  const p=request();await apply(p);const saved=await state();const modified={...saved,[keys.meal]:{...(saved[keys.meal] as Row),[today()]:{...((saved[keys.meal] as Row)[today()] as Row),lunchProteinCustom:35}}};await write(modified);await assert.rejects(undo(p.id),/새 기록을 보호/);assert.deepEqual(await state(),modified);
  const withOld={...saved,[keys.meal]:{...(saved[keys.meal] as Row),'2000-01-01':{custom:'later other date'}}};await write(withOld);await undo(p.id);assert.deepEqual(await state(),{...original,[keys.meal]:{...original[keys.meal],'2000-01-01':{custom:'later other date'}}});
});
test('inconsistent stored totals stop protein writes instead of discarding unknown intake',async()=>{
  const before={...original,[keys.proteinTotal]:{[today()]:200}};await write(before);const p=request(before);assert.throws(()=>dietNextSnapshot(p.expected,p.change),/합계/);await assert.rejects(apply(p),/합계/);assert.deepEqual(await state(),before);assert.equal(await count(),0);
});
test('malformed existing food measurements fail closed in TypeScript and SQL',async()=>{
  for(const partial of [{lunchProteinChoice:'maybe'},{breakfastShake:'yes'},{dinnerProteinChoice:'custom',dinnerProteinCustom:null},{afternoonShake:1}]){const before={...original,[keys.meal]:{[today()]:{...original[keys.meal][today()],...partial}}};await write(before);const p=request(before);assert.throws(()=>dietNextSnapshot(p.expected,p.change));await assert.rejects(apply(p));assert.deepEqual(await state(),before);}
});
test('invalid grams and unexpected payload fields cannot mutate data via direct RPC',async()=>{
  for(const edit of [change('lunch','protein',101),change('dinner','rice',1001),change('lunch','protein',-1),change('lunch','protein',2.5),{...change(),extra:true},{...change(),slot:'breakfast'},{...change(),grams:'30'},{...change(),field:'foodWeight'}])await assert.rejects(apply({...request(),change:edit as DietMealChange}));
  assert.deepEqual(await state(),original);assert.equal(await count(),0);
});
test('expired, future, prior date and reused request payloads are rejected',async()=>{
  for(const overrides of [{expires:'2001-01-01T00:00:00Z'},{expires:new Date(Date.now()+60*60_000).toISOString()},{day:'2001-01-01'}])await assert.rejects(apply(request(original,change(),overrides)));
  const p=request();await apply(p);await assert.rejects(apply({...p,change:change('lunch','protein',35)}),/이미 사용한 요청/);assert.equal(await count(),1);
});
test('lost-response retry stays idempotent after expiration',async()=>{
  const p=request(original,change(),{expires:new Date(Date.now()+120).toISOString()});const receipt=await apply(p);await new Promise(resolve=>setTimeout(resolve,140));assert.deepEqual(await apply(p),receipt);assert.equal(await count(),1);
});
test('a receipt failure rolls back meal details and both protein totals together',async()=>{
  await db.exec(`reset role; create function public.reject_meal_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end $$;
    create trigger reject_meal_receipt before insert on public.assistant_diet_command_history for each row execute function public.reject_meal_receipt(); set role authenticated;`);
  try { await assert.rejects(apply(request()),/synthetic receipt failure/); assert.deepEqual(await state(),original); assert.equal(await count(),0); }
  finally { await db.exec('reset role; drop trigger reject_meal_receipt on public.assistant_diet_command_history; drop function public.reject_meal_receipt(); set role authenticated;'); }
});
test('reset deletes history and invalidates an outstanding meal proposal',async()=>{
  const p=request();await apply(p);await write({...await state(),'ai-fitness-record-reset-diet':'reset-test'});assert.equal(await count(),0);await assert.rejects(apply(p),/초기화/);await assert.rejects(undo(p.id),/찾을 수 없습니다/);
});
test('RLS hides receipts and rejects another owner undo',async()=>{
  const p=request();await apply(p);await db.exec(`set app.test_user='${other}'`);assert.equal(await count(),0);await assert.rejects(undo(p.id),/찾을 수 없습니다/);assert.equal(await state(),undefined);await db.exec(`set app.test_user='${owner}'`);assert.equal(await count(),1);
});
test('anonymous callers have no meal write privileges',async()=>{
  await db.exec('set role anon');await assert.rejects(apply(request()),/permission denied/);await db.exec('set role authenticated');assert.deepEqual(await state(),original);
});
test('bounded grammar recognizes direct meal grams and rejects inference or added amounts',()=>{
  for(const [text,expected] of [['오늘 점심 단백질 30g 기록해줘',change()],['오늘 식단 저녁 밥량 130그램으로 저장해주세요',change('dinner','rice',130)],['점심 식품 단백질 0g 저장해줘',change('lunch','protein',0)]] as const){assert.deepEqual(parseDietCommand(text),expected);assert.equal(isDietRecordIntent(text),true);}
  for(const text of ['어제 점심 단백질 30g 기록해줘','오늘 점심 닭가슴살 100g 기록해줘','오늘 점심 단백질 30g 추가해줘','오늘 저녁 탄수화물 30g 기록해줘','오늘 저녁 밥 0.5공기 기록해줘','오늘 점심 단백질 30.5g 기록해줘','오늘 점심 단백질 30g 그리고 밥 100g 기록해줘','오늘 점심 단백질 101g 기록해줘'])assert.throws(()=>parseDietCommand(text));
  assert.equal(isDietRecordIntent('점심 뭐 먹을까?'),false);
});
test('meal drafts preserve scope, owner and expiry; old diet snapshots remain unchanged',()=>{
  const p=request();const proposal={domain:'diet',ownerId:owner,requestId:p.id,date:p.day,change:p.change,expected:p.expected,resetMarkers:p.resets,expiresAt:p.expires};assert.equal(isDietCommandProposal(proposal),true);
  assert.equal(isDietCommandProposal({...proposal,expected:{...p.expected,extra:1}}),false);
  assert.equal(isDietCommandProposal({...proposal,change:{kind:'water',totalMl:500}}),false);
  assert.deepEqual(Object.keys(dietDaySnapshot(original,today())).sort(),['record','water']);
  const raw=JSON.stringify({version:1,ownerId:owner,drafts:[{proposal,attempted:false}]});
  assert.equal(readCommandDrafts(raw,owner).length,1);
  assert.match(describeDietSnapshot(dietNextSnapshot(p.expected,p.change),p.change),/점심 식품 단백질 30g.*120g/);
});
