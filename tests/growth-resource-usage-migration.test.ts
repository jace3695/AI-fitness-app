import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000101';
const other = '00000000-0000-4000-8000-000000000102';
const id = '00000000-0000-4000-8000-000000000103';
let original: unknown;
const sql = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(sql('20260902120000_add_growth_platform.sql').split('insert into storage.buckets')[0]);
  await db.exec(sql('20260902223000_harden_growth_routine_links.sql'));
  await db.query(`insert into public.growth_resources(id,user_id,title,storage_path,mime_type,size_bytes,notes)
    values ($1,$2,'기존 자료',$3,'text/plain',100,'기존 메모')`, [id, owner, `${owner}/original.txt`]);
  original = (await db.query('select to_jsonb(r) row from public.growth_resources r')).rows[0];
  await db.exec(sql('20260917084426_growth_resource_usage.sql'));
});
after(async () => { await db.close(); });

test('기존 행의 파일·분류·생성 시각은 그대로이고 활용일만 미기록으로 추가된다', async () => {
  assert.deepEqual((await db.query("select to_jsonb(r)-'last_used_on' row from public.growth_resources r")).rows[0], original);
  assert.equal((await db.query<{ last_used_on: string | null }>('select last_used_on from public.growth_resources')).rows[0].last_used_on, null);
});

test('소유자는 활용일을 저장하고 미기록으로 되돌릴 수 있다', async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  await db.query('update public.growth_resources set last_used_on=$1 where id=$2', ['2026-01-02', id]);
  assert.equal((await db.query<{ value: string }>("select last_used_on::text value from public.growth_resources")).rows[0].value, '2026-01-02');
  await db.query('update public.growth_resources set last_used_on=null where id=$1', [id]);
  assert.deepEqual((await db.query("select to_jsonb(r)-'last_used_on' row from public.growth_resources r")).rows[0], original);
});

test('미래·잘못된 날짜와 범위 밖 날짜는 DB에서도 차단한다', async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  for (const value of ['9999-12-31', '2026-02-30', '1899-12-31', 'infinity']) {
    await assert.rejects(db.query('update public.growth_resources set last_used_on=$1 where id=$2', [value, id]));
  }
  await assert.rejects(db.query("update public.growth_resources set last_used_on=((current_timestamp at time zone 'Asia/Seoul')::date+1) where id=$1", [id]));
  await db.query("update public.growth_resources set last_used_on=(current_timestamp at time zone 'Asia/Seoul')::date where id=$1", [id]);
  await db.query('update public.growth_resources set last_used_on=null where id=$1', [id]);
});

test('오래된 화면은 다른 세션의 날짜·메모 변경을 덮어쓰지 못한다', async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  const old = (await db.query<{ updated_at: string }>('select updated_at::text from public.growth_resources')).rows[0].updated_at;
  await db.query("update public.growth_resources set notes='다른 세션 메모', last_used_on='2026-01-03', updated_at=updated_at+interval '1 second' where id=$1", [id]);
  const result = await db.query('update public.growth_resources set last_used_on=$1 where id=$2 and updated_at=$3 and last_used_on is null returning id', ['2026-01-02', id, old]);
  assert.equal(result.rows.length, 0);
  assert.equal((await db.query<{ notes: string }>('select notes from public.growth_resources')).rows[0].notes, '다른 세션 메모');
});

test('다른 계정과 비로그인 사용자는 자료를 읽거나 활용일을 변경하지 못한다', async () => {
  await db.exec(`set app.test_user='${other}'; set role authenticated;`);
  assert.equal((await db.query('select id from public.growth_resources')).rows.length, 0);
  assert.equal((await db.query('update public.growth_resources set last_used_on=null where id=$1 returning id', [id])).rows.length, 0);
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select id from public.growth_resources'));
  await assert.rejects(db.query('update public.growth_resources set last_used_on=null where id=$1', [id]));
  await db.exec('reset role;');
});

test('활용일 권한 추가가 파일·소유자·생성 시각 변경이나 다른 루틴 연결을 허용하지 않는다', async () => {
  await db.exec(`reset role; insert into public.growth_routines(id,user_id,category,title) values('${other}','${other}','custom','다른 루틴');
    set app.test_user='${owner}'; set role authenticated;`);
  for (const change of ["storage_path='other/file.txt'", `user_id='${other}'`, "created_at=now()", "size_bytes=1", `routine_id='${other}'`]) {
    await assert.rejects(db.query(`update public.growth_resources set ${change} where id=$1`, [id]));
  }
});
