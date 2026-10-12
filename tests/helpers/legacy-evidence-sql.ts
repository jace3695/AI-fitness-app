/** Synthetic auth claims + actual authored SQL on one PGlite connection. Never a concurrency/hosted proof. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST, SERVER_EVIDENCE_PROTOCOL } from '../../lib/language-legacy-evidence/identity-manifest.ts';
export const LEGACY_EVIDENCE_MIGRATION = '20261010025109_language_legacy_evidence_ledger.sql';
export const LEGACY_EVIDENCE_ENROLLMENT_MIGRATION = '20261010040739_language_legacy_evidence_enrollment.sql';
export const readSql = (path: string) => readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
export async function createLegacyEvidenceSqlFixture(options: {ledgerOnly?: boolean; activateWrites?: boolean; beforeEnrollmentMigration?: (db: PGlite) => Promise<void>} = {}) {
 const db = new PGlite();
 await db.exec(`create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
 create schema auth; create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
 grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
 grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 await db.exec(readSql('tests/e2e/schema.sql'));
 for(const name of ['20260915034857_assistant_task_command_history.sql','20260915052413_chatgpt_scoped_connection.sql','20260916043619_assistant_language_commands.sql','20260916045546_language_history_reset_triggers.sql']) await db.exec(readSql(`supabase/migrations/${name}`));
 // Install over an existing synthetic row and capture the preexisting ACL/policy inventory.
 const preservationOwner=randomUUID();
 await db.query('insert into auth.users(id) values($1)',[preservationOwner]);
 await db.query("insert into public.language_user_state(user_id,state,updated_at) values($1,'{\"synthetic-preservation\":\"unchanged\"}','2001-01-01T00:00:00Z')",[preservationOwner]);
 const inventory=async()=>({
  rows:(await db.query('select user_id,state,updated_at from public.language_user_state order by user_id')).rows,
  grants:(await db.query("select grantee,privilege_type,is_grantable from information_schema.table_privileges where table_schema='public' and table_name='language_user_state' and grantee not like 'language_legacy_evidence_%' order by grantee,privilege_type")).rows,
  policies:(await db.query("select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='language_user_state' and policyname not like 'legacy_evidence_%' order by policyname")).rows,
 });
 const beforeInstallation=await inventory();
 await db.exec(readSql(`supabase/migrations/${LEGACY_EVIDENCE_MIGRATION}`));
 await options.beforeEnrollmentMigration?.(db);
 // Only the frozen A2.1 CI audit may explicitly select its historical migration fixture.
 if(!options.ledgerOnly) await db.exec(readSql(`supabase/migrations/${LEGACY_EVIDENCE_ENROLLMENT_MIGRATION}`));
 // Disposable synthetic opt-in only. Production migration remains write-disabled.
 if(options.activateWrites&&!options.ledgerOnly) await db.exec(`grant execute on function
  public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text),
  language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text),
  public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text),
  language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text),
  public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[]),
  language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])
 to authenticated;`);
 const afterInstallation=await inventory();
 await db.query('delete from auth.users where id=$1',[preservationOwner]);
 async function asOwner(ownerId: string|null) { await db.query("select set_config('app.test_user',$1,false)",[ownerId??'']); await db.exec('set role authenticated'); }
 async function addOwner(ownerId=randomUUID(),state:Record<string,unknown>={}) { await db.exec('reset role'); await db.query('insert into auth.users(id) values($1)',[ownerId]); await asOwner(ownerId); await db.query('insert into public.language_user_state(user_id,state) values($1,$2)',[ownerId,state]); return ownerId; }
 async function rpc(name: string, args: Record<string,unknown>): Promise<unknown> {
  const signatures: Record<string,string[]> = {
   read_language_legacy_evidence_status:['expected_owner','expected_marker'],
   enroll_language_legacy_evidence_v1:['expected_owner','creation_request_id','expected_marker','proposed_timezone','protocol','manifest_release','manifest_digest'],
   get_language_legacy_evidence_context:['expected_owner','expected_marker','proposed_timezone','protocol','manifest_digest'],
   append_language_legacy_evidence:['expected_owner','expected_generation','manifest_digest','batch_id','source_slot','expected_predecessor','canonical_events'],
   read_language_legacy_evidence_context:['expected_owner','expected_generation','manifest_digest'],
   read_language_legacy_evidence_events:['expected_owner','expected_generation','manifest_digest','event_ids'],
   read_language_legacy_evidence_page:['expected_owner','expected_generation','manifest_digest','through_sequence','after_sequence','page_limit'],
  };
  const keys=signatures[name]; if(!keys||Object.keys(args).some(key=>!keys.includes(key))) throw new Error('Unknown fixed RPC');
  return (await db.query<{result:unknown}>(`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(key=>args[key]??null))).rows[0].result;
 }
 async function context(ownerId:string,marker:unknown={present:false,value:null},timezone='UTC') { return rpc('get_language_legacy_evidence_context',{expected_owner:ownerId,expected_marker:marker,proposed_timezone:timezone,protocol:SERVER_EVIDENCE_PROTOCOL,manifest_digest:LEGACY_EVIDENCE_MANIFEST_DIGEST}); }
 return {db,asOwner,addOwner,rpc,context,beforeInstallation,afterInstallation,close:()=>db.close()};
}
