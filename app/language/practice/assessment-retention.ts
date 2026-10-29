/** Shared disclosure contract; no default duration, storage, credentials or I/O. */
export const RETENTION_POLICY_ID='trial-retention-policy-v2';
export const RETENTION_ASSESSMENT_POLICY='azure-ja-accuracy-fluency-retention-v2';
export type RetentionDescriptor=Readonly<{
 metadataRetentionSeconds:number;authorizationExpiresAt:number;reviewArtifactSHA256:string;
 cleanupIntervalSeconds:number;cleanupStartDelaySeconds:number;cleanupRunTimeoutSeconds:number;
}>;
export type RetentionDisclosure=RetentionDescriptor&Readonly<{policyHash:string}>;
export const UNCONFIGURED_RETENTION:RetentionDescriptor|null=null;
const fields=['metadataRetentionSeconds','authorizationExpiresAt','reviewArtifactSHA256','cleanupIntervalSeconds','cleanupStartDelaySeconds','cleanupRunTimeoutSeconds'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=2147483647;
export function parseRetentionDescriptor(value:unknown):RetentionDescriptor{
 if(!object(value)||Object.keys(value).length!==fields.length||!fields.every(k=>Object.hasOwn(value,k))
  ||!integer(value.metadataRetentionSeconds,31)||typeof value.authorizationExpiresAt!=='number'||!Number.isSafeInteger(value.authorizationExpiresAt)||value.authorizationExpiresAt<0
  ||typeof value.reviewArtifactSHA256!=='string'||!/^[a-f0-9]{64}$/.test(value.reviewArtifactSHA256)
  ||!integer(value.cleanupIntervalSeconds,1)||!integer(value.cleanupStartDelaySeconds,0)||!integer(value.cleanupRunTimeoutSeconds,1)
  ||!Number.isSafeInteger(value.cleanupIntervalSeconds+value.cleanupStartDelaySeconds+value.cleanupRunTimeoutSeconds))throw Error('Retention policy unavailable');
 return Object.freeze({...value}) as RetentionDescriptor;
}
export function retentionPolicyMessage(value:RetentionDescriptor):string{
 const p=parseRetentionDescriptor(value);
 return [RETENTION_POLICY_ID,String(p.metadataRetentionSeconds),String(p.authorizationExpiresAt),p.reviewArtifactSHA256,String(p.cleanupIntervalSeconds),String(p.cleanupStartDelaySeconds),String(p.cleanupRunTimeoutSeconds)].join('\n');
}
export function cleanupDelaySeconds(p:RetentionDescriptor){return p.cleanupIntervalSeconds+p.cleanupStartDelaySeconds+p.cleanupRunTimeoutSeconds;}
export function parseRetentionDisclosure(value:unknown,now=Date.now()):RetentionDisclosure{
 if(!object(value)||Object.keys(value).length!==fields.length+1||typeof value.policyHash!=='string'||!/^[a-f0-9]{64}$/.test(value.policyHash))throw Error('Retention disclosure unavailable');
 const {policyHash,...descriptor}=value,p=parseRetentionDescriptor(descriptor);
 if(!Number.isFinite(now)||p.authorizationExpiresAt*1000<=now+30000)throw Error('Retention disclosure expired');
 return Object.freeze({...p,policyHash});
}
export async function verifyRetentionDisclosure(value:unknown,now:()=>number=Date.now):Promise<RetentionDisclosure>{
 const p=parseRetentionDisclosure(value,now()),{policyHash,...descriptor}=p;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(retentionPolicyMessage(descriptor))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==policyHash)throw Error('Retention disclosure mismatch');
 // Hash verification may finish after the 30-second dispatch window closes.
 // Do not return a ready disclosure just because it was fresh before awaiting.
 return parseRetentionDisclosure(p,now());
}
