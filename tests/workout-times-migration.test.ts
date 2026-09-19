import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000101',other='00000000-0000-4000-8000-000000000102',a='00000000-0000-4000-8000-000000000103',b='00000000-0000-4000-8000-000000000104';
before(async()=>{
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table public.user_app_state(user_id uuid primary key,state jsonb);insert into public.user_app_state values('${owner}','{"keep":"original"}');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260917133223_workout_actual_times.sql',import.meta.url),'utf8'));
});
after(async()=>db.close());
const insert=(user=owner,date='2020-01-01',start='20:00',end='20:40')=>db.query('insert into public.workout_actual_times values($1,$2,$3,$4,$5)',[user,date,start,end,a]);
test('계정별 하루 한 구간을 저장하고 중복 삽입은 거부한다',async()=>{
 await db.exec(`set app.test_user='${owner}';set role authenticated;`);await insert();await assert.rejects(insert());assert.equal((await db.query('select * from public.workout_actual_times')).rows.length,1);
});
test('다른 계정 조회·수정·삭제와 위조 소유자 삽입은 차단한다',async()=>{
 await db.exec(`set app.test_user='${other}';`);assert.equal((await db.query('select * from public.workout_actual_times')).rows.length,0);assert.equal((await db.query("update public.workout_actual_times set ends_at='21:00' returning *")).rows.length,0);assert.equal((await db.query('delete from public.workout_actual_times returning *')).rows.length,0);await assert.rejects(insert(owner,'2020-01-02'));
});
test('서버가 미래·역순·잘못된 시각·소유권 및 날짜 변경을 거부한다',async()=>{
 await db.exec(`set app.test_user='${owner}';`);
 for(const [day,start,end] of [['2999-01-01','20:00','20:40'],['2020-01-02','20:40','20:00'],['2020-01-02','20:00','24:00'],['2020-01-02','20:00','20:00'],['2020-01-02','8:00','09:00']])await assert.rejects(insert(owner,day,start,end));
 await assert.rejects(db.query(`update public.workout_actual_times set user_id='${other}'`));await assert.rejects(db.query("update public.workout_actual_times set recorded_on='2020-01-02'"));
});
test('검토 후 다른 변경이 있으면 오래된 수정과 삭제가 새 값을 보존한다',async()=>{
 assert.equal((await db.query('update public.workout_actual_times set ends_at=$1,revision=$2 where revision=$3 returning *',['20:50',b,a])).rows.length,1);
 assert.equal((await db.query('update public.workout_actual_times set ends_at=$1,revision=$2 where revision=$3 returning *',['21:00',a,a])).rows.length,0);
 assert.equal((await db.query('delete from public.workout_actual_times where revision=$1 returning *',[a])).rows.length,0);
 assert.equal((await db.query<{ends_at:string}>('select ends_at from public.workout_actual_times')).rows[0].ends_at,'20:50');
});
test('삭제 후 다시 생성한 구간을 오래된 요청으로 지우지 않고 원본 운동 데이터도 유지한다',async()=>{
 await db.query('delete from public.workout_actual_times where revision=$1',[b]);await insert();assert.equal((await db.query('delete from public.workout_actual_times where revision=$1 returning *',[b])).rows.length,0);
 await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from public.workout_actual_times'));await db.exec(`reset role;delete from auth.users where id='${owner}';`);assert.equal((await db.query('select * from public.workout_actual_times')).rows.length,0);assert.deepEqual((await db.query<{state:unknown}>('select state from public.user_app_state')).rows[0].state,{keep:'original'});
});


test('운동 초기화 표식만 해당 계정의 시각을 지우고 식단 초기화는 보존한다',async()=>{
 await db.exec(`reset role;insert into auth.users values('${owner}');`);await insert();
 await db.query("update public.user_app_state set state=state || '{\"ai-fitness-record-reset-diet\":\"one\"}'::jsonb where user_id=$1",[owner]);assert.equal((await db.query('select * from public.workout_actual_times')).rows.length,1);
 await db.query("update public.user_app_state set state=state || '{\"ai-fitness-record-reset-fitness\":\"two\"}'::jsonb where user_id=$1",[owner]);assert.equal((await db.query('select * from public.workout_actual_times')).rows.length,0);
});
