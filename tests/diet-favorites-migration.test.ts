import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000101', other = '00000000-0000-4000-8000-000000000102', id = '00000000-0000-4000-8000-000000000103';
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.user_app_state(user_id uuid primary key,state jsonb); insert into public.user_app_state values('${owner}','{"keep":"original"}');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260917114328_diet_meal_favorites.sql', import.meta.url), 'utf8'));
});
after(async () => db.close());
const insert = (user: string, name: string, protein: number | null = 27) => db.query(`insert into public.diet_meal_favorites(id,user_id,name,slot,food_protein,rice_grams,rice_name,supplement_protein) values($1,$2,$3,'lunch',$4,120,'통곡물밥',16)`, [id,user,name,protein]);
test('소유자가 저장·조회하며 같은 이름과 ID는 중복 삽입되지 않는다', async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  await insert(owner, '회사 점심');
  assert.equal((await db.query('select * from public.diet_meal_favorites')).rows.length, 1);
  await assert.rejects(insert(owner, '다른 이름'));
  await assert.rejects(db.query(`insert into public.diet_meal_favorites(id,user_id,name,slot,food_protein,rice_grams,rice_name,supplement_protein) values($1,$2,'회사 점심','lunch',1,0,'기타',0)`, [other, owner]));
});
test('다른 계정은 조회·삭제할 수 없고 남의 소유자로 삽입하지 못한다', async () => {
  await db.exec(`set app.test_user='${other}';`);
  assert.equal((await db.query('select * from public.diet_meal_favorites')).rows.length, 0);
  assert.equal((await db.query('delete from public.diet_meal_favorites returning id')).rows.length, 0);
  await assert.rejects(insert(owner, '권한 없음'));
});
test('인증 계정의 직접 덮어쓰기·소유권/생성 시각 변경 및 비로그인 접근 차단', async () => {
  await db.exec(`set app.test_user='${owner}';`);
  await assert.rejects(db.query('update public.diet_meal_favorites set food_protein=0'));
  await assert.rejects(db.query(`update public.diet_meal_favorites set user_id='${other}'`));
  await assert.rejects(db.query(`insert into public.diet_meal_favorites(id,user_id,name,slot,rice_grams,rice_name,supplement_protein,created_at) values('${other}','${owner}','시각 조작','lunch',0,'기타',0,now())`));
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select * from public.diet_meal_favorites'));
  await assert.rejects(db.query('delete from public.diet_meal_favorites'));
});
test('서버에서도 잘못된 이름·음수·과량·저녁 보충 수치를 거부한다', async () => {
  await db.exec(`reset role; set app.test_user='${owner}'; set role authenticated;`);
  for (const [name, protein] of [[' ', 1], ['가'.repeat(61),1], ['잘못된 양', -1], ['잘못된 양',301]] as const) {
    await assert.rejects(db.query(`insert into public.diet_meal_favorites(id,user_id,name,slot,food_protein,rice_grams,rice_name,supplement_protein) values($1,$2,$3,'lunch',$4,0,'기타',0)`, [other,owner,name,protein]));
  }
  await assert.rejects(db.query(`insert into public.diet_meal_favorites(id,user_id,name,slot,rice_grams,rice_name,supplement_protein) values('${other}','${owner}','저녁','dinner',0,'기타',16)`));
});
test('소유자 삭제 후 원본 하루 기록은 그대로이며 계정 삭제는 즐겨찾기만 연쇄 정리', async () => {
  await db.query('delete from public.diet_meal_favorites where id=$1', [id]);
  await insert(owner, '미기록', null);
  assert.equal((await db.query<{ food_protein: null }>('select food_protein from public.diet_meal_favorites')).rows[0].food_protein, null);
  await db.exec(`reset role; delete from auth.users where id='${owner}';`);
  assert.equal((await db.query('select * from public.diet_meal_favorites')).rows.length, 0);
  assert.deepEqual((await db.query<{ state: unknown }>('select state from public.user_app_state')).rows[0].state, {keep:'original'});
});
