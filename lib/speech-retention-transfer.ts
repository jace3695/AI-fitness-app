/** Offline SQL renderer only. No DB, network, env, credential or I/O access.
 * Rendering does not attest to approval or to legacy non-use. The default null
 * context cannot produce an executable transfer. Nothing imports this in app code.
 */
import {createHash} from 'node:crypto';
export const RETENTION_TRANSFER_SOURCE_SHA256='71b437bce3d600966ae95426275e206301af1fb59705140872ea0d9b67df18b3';
export const RETENTION_TRANSFER_DESTINATION_SHA256='2811c2156d1d5182d442ec244698c726ca3a3839f1a0e3f13cf7f87c7c558eeb';
export type RetentionTransferContext=Readonly<{legacyHistory:'unknown'|'reviewed-unused';evidenceSHA256:string}>;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const quote=(s:string)=>`'${s.replaceAll("'","''")}'`;
export function renderUnconfiguredRetentionTransferSQL(source:string,destination:string):string {
 const candidate=renderRetentionTransferSQL(source,destination,{legacyHistory:'unknown',evidenceSHA256:'0'.repeat(64)});
 return '-- UNCONFIGURED REVIEW COPY: deliberately aborts; zero digest is NOT evidence.\n'+candidate.replace('\nbegin;\n',"\nbegin;\ndo $unconfigured$begin raise exception 'Transfer context not configured; review copy only';end $unconfigured$;\n");
}
export function renderRetentionTransferSQL(source:string,destination:string,context:RetentionTransferContext|null=null):string {
 if(!context||typeof context!=='object'||Object.keys(context).sort().join(',')!=='evidenceSHA256,legacyHistory')throw Error('Transfer review context unavailable');
 const {legacyHistory,evidenceSHA256}=context;
 if(typeof legacyHistory!=='string'||!['unknown','reviewed-unused'].includes(legacyHistory)||typeof evidenceSHA256!=='string'||!/^[0-9a-f]{64}$/.test(evidenceSHA256))throw Error('Transfer review context unavailable');
 if(hash(source)!==RETENTION_TRANSFER_SOURCE_SHA256||hash(destination)!==RETENTION_TRANSFER_DESTINATION_SHA256)throw Error('Transfer source identity mismatch');
 // Pinned bytes only: retain all original V2 install checks, but remove its own
 // outer transaction so create + handoff + permanent V1 retirement are atomic.
 const begin=destination.indexOf('\nbegin;\n'),end=destination.lastIndexOf('\ncommit;');
 if(begin<0||end<=begin||destination.slice(end).trim()!=='commit;')throw Error('Transfer install boundary mismatch');
 const install=destination.slice(0,begin)+'\n'+destination.slice(begin+8,end);
 const functions=[...source.matchAll(/create function yeoni_speech_proof_candidate\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)].map(m=>({name:m[1],body:m[3],types:m[2].split(',').map(arg=>arg.trim().split(/\s+/).slice(1).join(' ')).join(',')}));
 if(functions.length!==5||functions.map(f=>f.name).join(',')!=='authorized,payload,consume,ready,finish')throw Error('Transfer legacy function identity mismatch');
 const functionChecks=functions.map(f=>` if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${quote(`yeoni_speech_proof_candidate.${f.name}(${f.types})`)}) and p.prokind='f' and l.lanname=${quote(f.name==='payload'?'sql':'plpgsql')} and p.prosrc=${quote(f.body)} and p.prosecdef=${f.name==='payload'?'false':'true'} and p.proconfig=array['search_path=""'])<>1 then raise exception 'Legacy function contract drift';end if;`).join('\n');
 return `-- UNAPPLIED OFFLINE CANDIDATE. Explicit review context is not authorization.
-- Requires a separately approved maintenance window and exact target identity.
-- No LOGIN role, secret, scheduler, key activation, policy duration or provider.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
begin
 if to_regnamespace('yeoni_speech_proof_candidate') is null
  or to_regclass('yeoni_speech_proof_candidate.policy') is null
  or to_regclass('yeoni_speech_proof_candidate.keys') is null
  or to_regclass('yeoni_speech_proof_candidate.total') is null then raise exception 'Legacy installation missing';end if;
 if to_regnamespace('yeoni_speech_retention_candidate') is not null then raise exception 'Destination already exists; never initialize again';end if;
end $preflight$;
-- Drain current guarded V1 transactions before inspecting their budget. ACCESS
-- EXCLUSIVE also prevents DML/reset of these rows during this transaction. This
-- does not fence an unlisted external provider path or a future privileged admin.
lock table yeoni_speech_proof_candidate.policy,yeoni_speech_proof_candidate.keys,yeoni_speech_proof_candidate.total in access exclusive mode;
do $legacy$
declare who text; object regclass; fn record;
begin
${functionChecks}
 if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='yeoni_speech_proof_candidate')<>5 then raise exception 'Unexpected legacy function contract';end if;
 -- Preserve the original API/table boundary; otherwise a caller could reset the
 -- retired old marker. No new roles/grants are created by this preflight.
 foreach who in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(who,'yeoni_speech_proof_candidate','CREATE') then raise exception 'Unexpected legacy API schema access';end if;
  foreach object in array array['yeoni_speech_proof_candidate.policy'::regclass,'yeoni_speech_proof_candidate.keys'::regclass,'yeoni_speech_proof_candidate.total'::regclass] loop
   if has_table_privilege(who,object,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected legacy API table access';end if;
  end loop;
  for fn in select p.oid,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='yeoni_speech_proof_candidate' loop
   if has_function_privilege(who,fn.oid,'EXECUTE') is distinct from (who='authenticated' and fn.proname in ('ready','consume','finish')) then raise exception 'Unexpected legacy API function access';end if;
  end loop;
 end loop;
 if (select count(*) from yeoni_speech_proof_candidate.policy)<>1
  or (select count(*) from yeoni_speech_proof_candidate.total)<>1 then raise exception 'Legacy singleton missing or ambiguous';end if;
 if exists(select 1 from yeoni_speech_proof_candidate.policy where not singleton or enabled)
  or exists(select 1 from yeoni_speech_proof_candidate.keys where enabled)
  or exists(select 1 from yeoni_speech_proof_candidate.total where not singleton) then raise exception 'Legacy admission must already be disabled';end if;
 perform 1 from yeoni_speech_proof_candidate.policy where singleton for update;
 perform 1 from yeoni_speech_proof_candidate.total where singleton for update;
end $legacy$;
${install}
-- Fresh schema creation is the once-only DDL fence. The claim is created and
-- locked in this SAME transaction; no externally visible default=true is reset.
create table yeoni_speech_retention_candidate.transfer_claim (
 singleton boolean primary key default true check(singleton),
 contract_version text not null check(contract_version='v1-fresh-v2-transfer-1'),
 legacy_classification text not null check(legacy_classification in ('proven-unused','spent-or-unknown')),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 source_sql_sha256 text not null check(source_sql_sha256='${RETENTION_TRANSFER_SOURCE_SHA256}'),
 destination_sql_sha256 text not null check(destination_sql_sha256='${RETENTION_TRANSFER_DESTINATION_SHA256}'),
 legacy_retired boolean not null check(legacy_retired)
);
alter table yeoni_speech_retention_candidate.transfer_claim enable row level security;
revoke all on yeoni_speech_retention_candidate.transfer_claim from public,anon,authenticated,service_role;
insert into yeoni_speech_retention_candidate.transfer_claim values(true,'v1-fresh-v2-transfer-1','spent-or-unknown','${evidenceSHA256}','${RETENTION_TRANSFER_SOURCE_SHA256}','${RETENTION_TRANSFER_DESTINATION_SHA256}',true);
do $transfer$
declare old yeoni_speech_proof_candidate.total%rowtype; unused boolean; who text;
begin
 select * into old from yeoni_speech_proof_candidate.total where singleton for update;
 if not found then raise exception 'Legacy singleton disappeared';end if;
 perform 1 from yeoni_speech_retention_candidate.total where singleton and consumed for update;
 if not found or (select count(*) from yeoni_speech_retention_candidate.total)<>1 then raise exception 'Fresh destination not sealed';end if;
 perform 1 from yeoni_speech_retention_candidate.transfer_claim where singleton for update;
 if not found or (select count(*) from yeoni_speech_retention_candidate.transfer_claim)<>1 then raise exception 'Bootstrap claim missing';end if;
 -- false/empty alone is not historical non-use. Unknown always imports spent.
 unused:=${quote(legacyHistory)}='reviewed-unused' and old.consumed is false and old.finished is false
  and old.request_id is null and old.payload_hash is null and old.duration_ms is null and old.consumed_at is null;
 update yeoni_speech_retention_candidate.transfer_claim set legacy_classification=case when unused then 'proven-unused' else 'spent-or-unknown' end where singleton;
 -- Retire first. No fabricated old request is created; old request metadata and
 -- owner linkage are erased, not copied into V2. Keys/Vault references stay OFF.
 update yeoni_speech_proof_candidate.total set consumed=true,request_id=null,payload_hash=null,duration_ms=null,consumed_at=null where singleton;
 update yeoni_speech_proof_candidate.policy set enabled=false,allowed_owner=null where singleton;
 update yeoni_speech_retention_candidate.total set consumed=not unused where singleton;
 foreach who in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(who,'yeoni_speech_retention_candidate.transfer_claim','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected bootstrap claim access';end if;
 end loop;
 if not exists(select 1 from yeoni_speech_proof_candidate.total where singleton and consumed and request_id is null and payload_hash is null and duration_ms is null and consumed_at is null)
  or exists(select 1 from yeoni_speech_proof_candidate.policy where enabled or allowed_owner is not null)
  or exists(select 1 from yeoni_speech_proof_candidate.keys where enabled)
  or not exists(select 1 from yeoni_speech_retention_candidate.total where singleton and consumed=(not unused))
  or exists(select 1 from yeoni_speech_retention_candidate.receipt)
  or exists(select 1 from yeoni_speech_retention_candidate.keys)
  or exists(select 1 from yeoni_speech_retention_candidate.policy where enabled or allowed_owner is not null or policy_id is not null or metadata_retention_seconds is not null or cleanup_schedule_generation is not null)
  then raise exception 'Transfer postcondition failed';end if;
end $transfer$;
commit;
`;
}
