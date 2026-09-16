import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { WORKOUT_RECORD_KEY as key, isWorkoutCommandProposal, workoutDaySnapshot } from '../lib/assistant-workout-command.ts';
import { CARDIO_COMMAND_TYPES, describeWorkoutCardio, isWorkoutCardioIntent, nextWorkoutCardioSnapshot, parseWorkoutCardioCommand } from '../lib/assistant-workout-cardio-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';
import { proposeWorkoutCommand } from '../lib/assistant-workout-server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
const db = new PGlite(), owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const change = { kind: 'cardio' as const, type: '실내 걷기' as const, minutes: 20 };
const original = {
  settings: 'keep', 'ai-fitness-selected-weekly-workout-plan': 'custom-plan',
  'ai-fitness-user-workout-settings': { dateOverrides: { [today()]: { groupId: 'rest' } } },
  [key]: { '2001-01-01': { cardioDone: true, cardioMinutes: 10 }, [today()]: {
    workoutDone: false, workoutStatus: 'stopped', workoutPain: true, workoutBackStatus: 'worse',
    workoutExerciseRecords: [{ exerciseName: '실제 동작', sets: [{ reps: 3, painScore: 2 }] }],
    cardioDone: true, cardioType: '고정식 자전거', cardioMinutes: 15, cardioMemo: '기존 메모',
    rosaryCardioMinutes: 7, postWorkoutCardioMinutes: 3, foamRollerMemo: 'keep', pullupDone: true,
  } },
};
const request = (overrides = {}) => ({ id: randomUUID(), day: today(), change, expected: workoutDaySnapshot(original, today()), resets: { fitness: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_workout_cardio_command($1,$2,$3,$4,$5,$6) receipt', [p.id,p.day,p.change,p.expected,p.resets,p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_workout_command($1) receipt', [id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state: Row}>('select state from public.user_app_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_workout_command_history')).rows[0].n);
const write = async (value: Row) => db.query('update public.user_app_state set state=$1', [value]);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;`);
  for (const file of ['./e2e/schema.sql','../supabase/migrations/20260901125340_add_fitness_ai_review_history.sql','../supabase/migrations/20260906141943_add_app_record_resets.sql','../supabase/migrations/20260915034857_assistant_task_command_history.sql','../supabase/migrations/20260916094552_assistant_workout_commands.sql','../supabase/migrations/20260916232300_assistant_workout_cardio_commands.sql']) await db.exec(read(file));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)', [owner, original]);
});

test('cardio changes only its three fields, preserving stopped workouts, pain, actual sets, notes, plans and other dates', async () => {
  const p = request(), receipt = await apply(p), saved = await state();
  assert.equal(receipt.command_kind, 'cardio');
  assert.deepEqual(saved, { ...original, [key]: { ...original[key], [today()]: { ...original[key][today()], cardioDone: true, cardioType: '실내 걷기', cardioMinutes: 20 } } });
  assert.deepEqual(receipt.before_values, workoutDaySnapshot(original,today()));
  assert.deepEqual(receipt.after_values, nextWorkoutCardioSnapshot(p.expected,change));
  await undo(p.id); assert.deepEqual(await state(),original);
});
test('retry and undo are idempotent and an already matching value produces no extra receipt', async () => {
  const p = request(), receipt = await apply(p);
  assert.deepEqual(await apply(p),receipt); assert.equal(await count(),1);
  await assert.rejects(apply(request({ expected: workoutDaySnapshot(await state(),today()) })),/이미 같은 값/);
  await assert.rejects(apply({ ...p,change: { ...change,minutes: 30 } }),/이미 사용한 요청/);
  const undone = await undo(p.id); assert.deepEqual(await undo(p.id),undone); assert.deepEqual(await apply(p),undone);
  assert.deepEqual(await state(),original); assert.equal(await count(),1);
});
test('a ledger failure rolls back the state and the identical request can retry', async () => {
  const p=request(); await db.exec('reset role; alter table public.assistant_workout_command_history add constraint injected_failure check(false); set role authenticated;');
  await assert.rejects(apply(p)); assert.deepEqual(await state(),original); assert.equal(await count(),0);
  await db.exec('reset role; alter table public.assistant_workout_command_history drop constraint injected_failure; set role authenticated;');
  await apply(p); assert.equal(await count(),1);
});
test('two reviewed requests cannot overwrite each other', async () => {
  const results=await Promise.allSettled([apply(request()),apply(request({change:{...change,minutes:30}}))]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1); assert.equal(await count(),1);
});
test('new settings and records on other dates survive apply and undo', async () => {
  const p=request(), changed={...original,settings:'new',[key]:{...original[key],'2001-01-02':false}};
  await write(changed);await apply(p);const saved=await state();
  await write({...saved,[key]:{...(saved[key] as Row),'2001-01-03':{cardioMinutes:5}}});await undo(p.id);
  assert.deepEqual(await state(),{...changed,[key]:{...changed[key],'2001-01-03':{cardioMinutes:5}}});
});
test('later same-date safety edits block both stale confirmation and undo',async()=>{
  const p=request(),modified={...original,[key]:{...original[key],[today()]:{...original[key][today()],workoutPainSet:2}}};
  await write(modified);await assert.rejects(apply(p),/다른 곳에서 오늘 운동 기록/);assert.deepEqual(await state(),modified);
  const next=request({expected:workoutDaySnapshot(modified,today())});await apply(next);const saved=await state();
  const after={...saved,[key]:{...(saved[key] as Row),[today()]:{...(workoutDaySnapshot(saved,today()).record as Row),cardioMemo:'이후 메모'}}};
  await write(after);await assert.rejects(undo(next.id),/새 기록을 보호/);assert.deepEqual(await state(),after);
});
test('missing stores, empty dates and legacy booleans restore exactly without invented exercise details',async()=>{
  for(const before of [{settings:'keep'},{[key]:{}},{[key]:{[today()]:false}},{[key]:{[today()]:true}}]){
    await write(before);const p=request({expected:workoutDaySnapshot(before,today())});await apply(p);
    const expectedRecord=typeof p.expected.record==='boolean'?{workoutDone:p.expected.record}:{};
    assert.deepEqual(workoutDaySnapshot(await state(),today()).record,{...expectedRecord,cardioDone:true,cardioType:'실내 걷기',cardioMinutes:20});
    await undo(p.id);assert.deepEqual(await state(),before);
  }
  await db.exec('delete from public.user_app_state');const p=request({expected:{}});await apply(p);await undo(p.id);assert.deepEqual(await state(),{});
});
test('legacy JSON string stores keep their format and all dates through save and undo',async()=>{
  await write({...original,[key]:JSON.stringify(original[key])});const p=request();await apply(p);assert.equal(typeof (await state())[key],'string');
  await undo(p.id);assert.deepEqual(JSON.parse((await state())[key] as string),original[key]);
});
test('malformed stores and cardio values fail without changing any record',async()=>{
  for(const value of [null,[],'{','null',{[today()]:null},{[today()]:'bad'}]){
    const before={...original,[key]:value};await write(before);await assert.rejects(apply(request()));assert.deepEqual(await state(),before);
  }
  for(const record of [{cardioDone:null},{cardioDone:'true'},{cardioType:[]},{cardioType:'a'.repeat(201)},{cardioMinutes:'20'},{cardioMinutes:-1}]){
    const before={...original,[key]:{[today()]:record}};await write(before);const p=request({expected:workoutDaySnapshot(before,today())});
    assert.throws(()=>nextWorkoutCardioSnapshot(p.expected,change));await assert.rejects(apply(p),/형식/);assert.deepEqual(await state(),before);
  }
  assert.equal(await count(),0);
});
test('database rejects unsupported kinds, types, extra fields and out-of-range or fractional minutes',async()=>{
  for(const bad of [null,{}, {...change,kind:'completion'},{...change,type:null},{...change,type:'달리기'},{...change,minutes:null},{...change,minutes:'20'},{...change,minutes:0},{...change,minutes:301},{...change,minutes:1.5},{...change,extra:true}]) await assert.rejects(apply(request({change:bad})));
  for(const expected of [null,[],{record:null},{record:{},other:true}]) await assert.rejects(apply(request({expected})));
  assert.deepEqual(await state(),original);assert.equal(await count(),0);
});
test('expired requests, different dates and changed reset markers fail before saving',async()=>{
  for(const overrides of [{expires:'2001-01-01T00:00:00Z'},{expires:new Date(Date.now()+60*60_000).toISOString()},{day:'2001-01-01'},{resets:{fitness:'changed',assistant:null}}]) await assert.rejects(apply(request(overrides)));
  assert.deepEqual(await state(),original);assert.equal(await count(),0);
});
for(const area of ['fitness','assistant'])test(`${area} reset clears cardio receipts and rejects pending requests`,async()=>{
  const p=request(),pending=request();await apply(p);await db.query("select public.reset_my_app_records($1,$2,'초기화')",[area,randomUUID()]);
  assert.equal(await count(),0);await assert.rejects(apply(pending),/초기화/);await assert.rejects(undo(p.id),/이력을 찾을 수/);
});
test('RLS, owner checks and anonymous grants isolate cardio records and receipts',async()=>{
  const p=request();await apply(p);await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(),0);assert.equal(await state(),undefined);await assert.rejects(undo(p.id),/이력을 찾을 수/);
  await assert.rejects(db.query("insert into public.assistant_workout_command_history(user_id,id,record_date,payload_hash,before_values,after_values,store_format) values($1,$2,current_date,'x','{}','{}','object')",[owner,randomUUID()]));
  await db.exec('reset role; set role anon;');await assert.rejects(apply(request()));await assert.rejects(db.query('select * from public.assistant_workout_command_history'));
});
test('Auth deletion cascades cardio receipts without Auth application permissions',async()=>{
  await apply(request());await db.exec(`reset role; set role synthetic_auth_admin; delete from auth.users where id='${owner}'; reset role;`);assert.equal(await count(),0);
});
test('old completion and cardio commands share ordering protection and undo in reverse order',async()=>{
  await write({settings:'keep'});const p=request({expected:{}});
  const complete=(args:ReturnType<typeof request>)=>db.query<Row>('select public.apply_assistant_workout_command($1,$2,$3,$4,$5) receipt',[args.id,args.day,args.expected,args.resets,args.expires]);
  assert.equal(((await complete(p)).rows[0].receipt as Row).command_kind,'completion');
  await assert.rejects(apply(p),/이미 사용한 요청/);const completed=await state();
  const cardio=request({expected:workoutDaySnapshot(completed,today())});await apply(cardio);await assert.rejects(complete(cardio),/이미 사용한 요청/);
  await assert.rejects(undo(p.id),/새 기록을 보호/);await undo(cardio.id);assert.deepEqual(await state(),completed);await undo(p.id);assert.deepEqual(await state(),{settings:'keep'});
});
test('supported explicit total commands accept every existing type without guessing exercise location',()=>{
  for(const type of CARDIO_COMMAND_TYPES){const parsed=parseWorkoutCardioCommand(`오늘 유산소 ${type} 총 20분 기록해줘`);assert.deepEqual(parsed,{...change,type});assert.ok(isWorkoutCardioIntent(`오늘 유산소 ${type} 총 20분 기록해줘`));}
  assert.deepEqual(parseWorkoutCardioCommand('유산소 야외 걷기 총 300분 저장해주세요.'),{...change,type:'야외 걷기',minutes:300});
  assert.equal(isWorkoutCardioIntent('오늘 유산소 운동 몇 분 할지 계획 보여줘'),false);
});
test('questions, conditions, negatives, additions, vague types, durations and other days are rejected',()=>{
  for(const text of ['어제 유산소 실내 걷기 총 20분 기록해줘','내일 유산소 실내 걷기 총 20분 기록해줘','오늘 유산소 걷기 총 20분 기록해줘','오늘 유산소 실내 걷기 20분 기록해줘','오늘 유산소 실내 걷기 총 20분 추가해줘','오늘 유산소 실내 걷기 총 20분 기록해줘?','오늘 유산소 실내 걷기 총 20분 기록하지 마','오늘 유산소 실내 걷기 총 20분 기록해줘 그리고 운동 완료했어','오늘 유산소 실내 걷기 총 0분 기록해줘','오늘 유산소 실내 걷기 총 301분 기록해줘','오늘 유산소 실내 걷기 총 1.5분 기록해줘','오늘 유산소 실내 걷기 총 -1분 기록해줘','오늘 유산소 실내 걷기 총 1시간 기록해줘','오늘 유산소 실내 걷기 총 20분 끝나면 기록해줘'])assert.throws(()=>parseWorkoutCardioCommand(text),/유산소/);
});
test('description distinguishes missing completion and zero from an actual completed cardio record',()=>{
  assert.equal(describeWorkoutCardio({}),'유산소 기록 없음');
  assert.equal(describeWorkoutCardio({record:{cardioDone:false,cardioType:'실내 걷기',cardioMinutes:0}}),'완료 미기록 (실내 걷기 · 총 0분)');
  assert.equal(describeWorkoutCardio(nextWorkoutCardioSnapshot({},change)),'실내 걷기 · 총 20분');
});
test('cardio drafts preserve owner and payload across recovery while old completion drafts remain valid',()=>{
  const p={domain:'workout',ownerId:owner,requestId:randomUUID(),date:today(),change,expected:request().expected,resetMarkers:request().resets,expiresAt:request().expires};
  const drafts=[{proposal:p,attempted:true}];assert.ok(isWorkoutCommandProposal(p));assert.deepEqual(readCommandDrafts(JSON.stringify({ownerId:owner,drafts}),owner),drafts);
  assert.deepEqual(readCommandDrafts(JSON.stringify({ownerId:owner,drafts}),other),[]);
  for(const bad of [{...p,change:null},{...p,change:{...change,minutes:0}},{...p,expected:{record:{cardioDone:null}}},{...p,ownerId:other}])assert.throws(()=>readCommandDrafts(JSON.stringify({ownerId:owner,drafts:[{proposal:bad,attempted:false}]}),owner));
  const {change: removed,...old}=p;assert.equal(removed,change);assert.ok(isWorkoutCommandProposal(old));
});

test('proposal checks the database capability without applying records and reports pending migration clearly',async()=>{
  const calls: string[]=[];
  const mock={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:original},error:null})})})}),
    rpc:async(name:string)=>{calls.push(name);return {data:null,error:{code:'PGRST202'}};}} as unknown as SupabaseClient;
  await assert.rejects(proposeWorkoutCommand(mock,owner,today(),change),/아직 준비 중/);
  assert.deepEqual(calls,['assistant_workout_cardio_next']);assert.deepEqual(await state(),original);
});
test('read-only database validation failures do not produce a confirmable proposal',async()=>{
  const mock={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:original},error:null})})})}),
    rpc:async()=>({data:null,error:{code:'503'}})} as unknown as SupabaseClient;
  await assert.rejects(proposeWorkoutCommand(mock,owner,today(),change),/잠시 후/);assert.deepEqual(await state(),original);
});
test('available cardio validation produces the exact reviewed proposal and skips unchanged values',async()=>{
  const make=(stored:Row)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{state:stored},error:null})})})}),
    rpc:async()=>({data:nextWorkoutCardioSnapshot(workoutDaySnapshot(stored,today()),change),error:null})}) as unknown as SupabaseClient;
  const proposal=await proposeWorkoutCommand(make(original),owner,today(),change);assert.ok(isWorkoutCommandProposal(proposal));
  assert.deepEqual(proposal?.change,change);assert.deepEqual(proposal?.expected,workoutDaySnapshot(original,today()));
  const saved={...original,[key]:{...original[key],[today()]:nextWorkoutCardioSnapshot(workoutDaySnapshot(original,today()),change).record}};
  assert.equal(await proposeWorkoutCommand(make(saved),owner,today(),change),null);assert.deepEqual(await state(),original);
});
