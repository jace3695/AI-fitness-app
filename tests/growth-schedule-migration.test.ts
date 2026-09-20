import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000101";
const other = "00000000-0000-4000-8000-000000000102";
const routineId = "00000000-0000-4000-8000-000000000103";

before(async () => {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.test_user', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.growth_routines (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      category text not null,
      title text not null,
      target_minutes integer not null default 15,
      enabled boolean not null default true,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.growth_routines enable row level security;
    create policy owner on public.growth_routines to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    grant select, insert, delete on public.growth_routines to authenticated;
    grant update (category, title, target_minutes, enabled, sort_order, updated_at)
      on public.growth_routines to authenticated;
    insert into public.growth_routines(id, user_id, category, title)
      values('${routineId}', '${owner}', 'custom', '기존 루틴');
  `);
  const migration = readFileSync(
    new URL("../supabase/migrations/20260913054626_p2_growth_schedule.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migration);
});

after(async () => { await db.close(); });

test("마이그레이션은 기존 루틴을 매일·주 7회로 보존한다", async () => {
  const row = (await db.query<{ preferred_days: number[]; target_sessions_per_week: number }>(
    "select preferred_days, target_sessions_per_week from public.growth_routines where id=$1",
    [routineId],
  )).rows[0];
  assert.deepEqual(row.preferred_days, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(row.target_sessions_per_week, 7);
});

test("소유자는 새 일정 열만 갱신하고 다른 사용자는 원본을 바꾸지 못한다", async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  const ownerUpdate = await db.query(
    "update public.growth_routines set preferred_days=$1, target_sessions_per_week=$2 where id=$3 returning id",
    [[1, 3, 5], 3, routineId],
  );
  assert.equal(ownerUpdate.rows.length, 1);

  await db.exec(`set app.test_user='${other}';`);
  const otherUpdate = await db.query(
    "update public.growth_routines set preferred_days=$1 where id=$2 returning id",
    [[2, 4], routineId],
  );
  assert.equal(otherUpdate.rows.length, 0);
  await db.exec("reset role;");
  const preserved = (await db.query<{ preferred_days: number[] }>(
    "select preferred_days from public.growth_routines where id=$1",
    [routineId],
  )).rows[0];
  assert.deepEqual(preserved.preferred_days, [1, 3, 5]);
});

test("빈 요일·중복·허용 범위 밖 요일·요일 수보다 큰 목표를 거부한다", async () => {
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
  await assert.rejects(db.query(
    "update public.growth_routines set preferred_days=$1 where id=$2",
    [[], routineId],
  ));
  await assert.rejects(db.query(
    "update public.growth_routines set preferred_days=$1 where id=$2",
    [[0, 8], routineId],
  ));
  await assert.rejects(db.query(
    "update public.growth_routines set preferred_days=$1 where id=$2",
    [[1, 1, 3], routineId],
  ));
  await assert.rejects(db.query(
    "update public.growth_routines set preferred_days=$1, target_sessions_per_week=$2 where id=$3",
    [[1, 3], 3, routineId],
  ));
});
