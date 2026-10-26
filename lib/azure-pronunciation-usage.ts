import type { AssessmentUsageLedger } from './azure-pronunciation-server.ts';
import {randomUUID} from 'node:crypto';
type UsageQuery = PromiseLike<{data: unknown;error: unknown}> & {abortSignal(signal: AbortSignal): UsageQuery};
type UsageClient = {rpc(name: string, params: Record<string, string | number>): UsageQuery};

/** Trusted backend scoped-role RPC adapter. Authenticated browser clients are denied by SQL.
 * SQL draft must be reviewed/applied and policy explicitly configured first.
 * Missing/unavailable RPC blocks dispatch; this adapter does not imply DB setup.
 */
export function createAzureUsageLedger(owner: string, client: UsageClient, resourceName='yeoni-speech-jace', region='koreacentral'): AssessmentUsageLedger {
  if (!owner) throw Error('Usage owner required');
  const leases=new Map<string,string>();
  return {durable:true,isReady:async(signal)=>{
    signal.throwIfAborted();const result=await client.rpc('is_yeoni_speech_usage_ready',{p_owner_id:owner,p_resource_name:resourceName,p_region:region}).abortSignal(signal);signal.throwIfAborted();return !result.error&&result.data===true;
  },settle:async(input,signal)=>{
    signal.throwIfAborted();if(input.owner!==owner)return false;const token=leases.get(input.requestId);if(!token)return false;
    const result=await client.rpc('finish_yeoni_speech_usage',{p_owner_id:owner,p_request_id:input.requestId,p_lease_token:token}).abortSignal(signal);signal.throwIfAborted();if(result.error||result.data!==true)return false;leases.delete(input.requestId);return true;
  },consume:async(input,signal)=>{
    signal.throwIfAborted();
    if (input.owner!==owner || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !Number.isFinite(input.durationMs) || input.durationMs<=0 || input.durationMs>30000) return 'limit';
    if(input.resourceName!==resourceName||input.region!==region)return 'limit';
    const token=randomUUID();
    const result=await client.rpc('consume_yeoni_speech_usage',{p_owner_id:owner,p_request_id:input.requestId,p_fingerprint:input.fingerprint,p_duration_ms:Math.ceil(input.durationMs),p_resource_name:resourceName,p_region:region,p_lease_token:token}).abortSignal(signal);
    signal.throwIfAborted();
    if(result.error || !['accepted','duplicate','limit','busy'].includes(result.data as string)) throw Error('Shared usage could not be confirmed');
    if(result.data==='accepted')leases.set(input.requestId,token);
    return result.data as 'accepted'|'duplicate'|'limit'|'busy';
  }};
}
