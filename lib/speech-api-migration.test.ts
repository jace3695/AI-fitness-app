import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const sql=readFileSync(new URL('../docs/azure-pronunciation-usage/api-proof-contract-draft.sql',import.meta.url),'utf8');
async function setup(crypto=true){const db=new PGlite({extensions:{pgcrypto}});await db.exec(`create schema extensions;${crypto?'create extension pgcrypto with schema extensions;':''}create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create sequence public.existing_sequence start 7;grant usage,select,update on sequence public.existing_sequence to public;create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);`);return db;}
async function absent(db:PGlite){assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_namespace where nspname='yeoni_speech_proof_candidate'")).rows[0].n,0);assert.equal((await db.query<{r:boolean}>("select has_sequence_privilege('authenticated','public.existing_sequence','USAGE,SELECT,UPDATE') r")).rows[0].r,true);assert.deepEqual((await db.query('select last_value::int,is_called from public.existing_sequence')).rows[0],{last_value:7,is_called:false});}
test('migration is atomic, disabled and credential-free; existing PUBLIC sequence permissions are not edited and no LOGIN role is added',async()=>{
 const db=await setup();try{await db.exec(sql);assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_tables where schemaname='yeoni_speech_proof_candidate'")).rows[0].n,3);assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='yeoni_speech_proof_candidate'")).rows[0].n,5);assert.deepEqual((await db.query('select enabled,allowed_owner,active_key_id,policy_id,api_boundary_reviewed_at from yeoni_speech_proof_candidate.policy')).rows[0],{enabled:false,allowed_owner:null,active_key_id:null,policy_id:null,api_boundary_reviewed_at:null});assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_proof_candidate.keys')).rows[0].n,0);assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_roles where rolname like 'yeoni_speech%'")).rows[0].n,0);assert.equal((await db.query<{r:boolean}>("select has_sequence_privilege('authenticated','public.existing_sequence','USAGE,SELECT,UPDATE') r")).rows[0].r,true);
 await assert.rejects(db.exec(sql),/already exists/);await db.exec('rollback');assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_proof_candidate.total')).rows[0].n,1);
 }finally{await db.close();}
});
test('preflight and inherited/default grant failures roll back all new objects without changing other app grants',async()=>{
 for(const scenario of ['login','privileged-membership','missing-crypto','inherited-table','inherited-function','vault-access']){
  const db=await setup(scenario!=='missing-crypto');try{
   if(scenario==='login')await db.exec('alter role authenticated login');
   if(scenario==='privileged-membership')await db.exec('create role dangerous login;grant dangerous to authenticated');
   if(scenario==='vault-access')await db.exec('grant select on vault.decrypted_secrets to authenticated');
   if(scenario.startsWith('inherited-'))await db.exec(`create role synthetic_reader;grant synthetic_reader to authenticated;alter default privileges grant ${scenario==='inherited-table'?'select on tables':'execute on functions'} to synthetic_reader;`);
   await assert.rejects(db.exec(sql),/Unexpected API role|privileged membership|capability missing|Unexpected direct usage table|Unexpected API function|Unexpected API access to Vault/);await db.exec('rollback');await absent(db);
  }finally{await db.close();}
 }
});
