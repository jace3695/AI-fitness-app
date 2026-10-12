import { z } from 'zod';
import { canonicalEvidence, evidenceReceiptSchema, instantSchema } from './validation.ts';
import { isRecordTimezone } from './study-policy.ts';
import type { EvidenceReceipt } from './types.ts';

export const SERVER_EVIDENCE_PROTOCOL = 'legacy-evidence-server-v1' as const;
export const MAX_PREFIX_EVENTS = 10_000;
/** Canonical payload bytes, not a hard transport-envelope byte limit. */
export const MAX_PREFIX_BYTES = 8 * 1024 * 1024;
export type ServerEvidenceContext = {
  ownerId: string; generationId: string; resetMarker: { present: boolean; value: string | null };
  prospectiveStartedAt: string; studyDayTimezone: string; protocol: typeof SERVER_EVIDENCE_PROTOCOL;
  manifestRelease: string; manifestDigest: string; serverTime: string; highWater: number;
};
/** Transport/storage metadata is deliberately separate from the strict five-field A1 receipt. */
export type ServerEvidenceReceipt = EvidenceReceipt & { canonicalEvent: string; manifestDigest: string; manifestRelease: string };
export type CachedEvidenceContext = {
  version: 1; ownerId: string; generationId: string; context: ServerEvidenceContext; status: 'previously_verified_offline';
};
export type CachedEvidencePrefix = CachedEvidenceContext & { throughSequence: number; records: readonly ServerEvidenceReceipt[] };
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const release = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@./-]+$/);
export const serverEvidenceContextSchema = z.object({
  ownerId: uuid, generationId: uuid,
  resetMarker: z.object({ present: z.boolean(), value: z.string().min(1).max(200).nullable() }).strict(),
  prospectiveStartedAt: instantSchema, studyDayTimezone: z.string().max(100).refine(isRecordTimezone),
  protocol: z.literal(SERVER_EVIDENCE_PROTOCOL), manifestRelease: release, manifestDigest: hash,
  serverTime: instantSchema, highWater: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(value => (value.resetMarker.present || value.resetMarker.value === null) &&
  Date.parse(value.prospectiveStartedAt) <= Date.parse(value.serverTime));
export const serverEvidenceReceiptSchema = evidenceReceiptSchema.extend({
  canonicalEvent: z.string().max(16 * 1024), manifestDigest: hash, manifestRelease: release,
}).strict().refine(value => canonicalEvidence(value.event) === value.canonicalEvent &&
  new TextEncoder().encode(value.canonicalEvent).byteLength <= 16 * 1024);
