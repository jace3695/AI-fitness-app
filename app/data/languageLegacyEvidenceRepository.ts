import { z } from 'zod';
import { createClient } from '../../lib/supabase.ts';
import { languageLegacyEvidenceCapability, type LanguageLegacyEvidenceAuthority, type LanguageRecordContext } from './languageCloudSync.ts';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE } from './languageLegacyEvidenceRelease.ts';
import { languageEvidenceResetCapability, type LanguageResetContext, type LanguageEvidenceResetAuthority } from './languageResetFence.ts';
import type { FrozenEnrollmentIntent } from '../../lib/language-legacy-evidence/store-admission-types.ts';
import { parseLanguageMarker } from './languageStorageBoundary.ts';
import { LocalEvidenceStore } from '../../lib/language-legacy-evidence/local-store.ts';
import { canonicalSha256, immutableCopy } from '../../lib/language-legacy-evidence/canonical-hash.ts';
import { canonicalEvidence, evidenceReceiptSchema, instantSchema, makeSourceSlotKey } from '../../lib/language-legacy-evidence/validation.ts';
import { isRecordTimezone } from '../../lib/language-legacy-evidence/study-policy.ts';
import { projectLegacyEvidence } from '../../lib/language-legacy-evidence/projection.ts';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST, LEGACY_EVIDENCE_MANIFEST_RELEASE, SERVER_EVIDENCE_PROTOCOL } from '../../lib/language-legacy-evidence/identity-manifest.ts';
import { registerAuthenticatedContext, registerAuthenticatedPrefix, registerAuthenticatedReceiptReadback, registerAuthenticatedAdmissionStatus, registerAuthenticatedFirstAdmission, registerAuthenticatedResetEvidenceState } from '../../lib/language-legacy-evidence/receipt-proof.ts';
import { LocalEvidenceError, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, MAX_EVENT_BYTES, type FrozenBatch, type Immutable, type LocalEvidenceContext, type LocalFence } from '../../lib/language-legacy-evidence/persistence-types.ts';
import { verifyFrozenBatch } from '../../lib/language-legacy-evidence/outbox.ts';
import { MAX_PREFIX_EVENTS, MAX_PREFIX_BYTES, type ServerEvidenceContext, type ServerEvidenceReceipt } from '../../lib/language-legacy-evidence/server-types.ts';
import type { EvidenceProjection, EvidenceReceipt, EvidenceSnapshot } from '../../lib/language-legacy-evidence/types.ts';

export type LegacyEvidenceFailure = 'feature_inactive' | 'local_continuity_unknown' | 'legacy_enrolled_generation_missing' | 'legacy_enrollment_stale' | 'legacy_enrollment_conflict' | 'legacy_enrollment_integrity' | 'legacy_invalid_enrollment' | 'stale_authority' | 'unavailable' | 'invalid_response' | 'event_conflict' |
  'legacy_auth_mismatch' | 'legacy_state_not_ready' | 'legacy_unsupported_protocol' | 'legacy_unsupported_manifest' |
  'legacy_stale_generation' | 'legacy_marker_conflict' | 'legacy_invalid_event' | 'legacy_event_id_conflict' |
  'legacy_source_slot_conflict' | 'legacy_predecessor_conflict' | 'legacy_retryable';
export class LegacyEvidenceRepositoryError extends Error {
  readonly code: LegacyEvidenceFailure;
  constructor(code: LegacyEvidenceFailure) { super(code); this.name = 'LegacyEvidenceRepositoryError'; this.code = code; }
}
function fail(code: LegacyEvidenceFailure): never { throw new LegacyEvidenceRepositoryError(code); }
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const markerSchema = z.object({ present: z.boolean(), value: z.string().max(200).nullable() }).strict();
const contextSchema = z.object({ ownerId: uuid, generationId: uuid, resetMarker: markerSchema,
  prospectiveStartedAt: instantSchema, studyDayTimezone: z.string().max(100).refine(isRecordTimezone),
  protocol: z.literal(SERVER_EVIDENCE_PROTOCOL), manifestRelease: z.literal(LEGACY_EVIDENCE_MANIFEST_RELEASE),
  manifestDigest: z.literal(LEGACY_EVIDENCE_MANIFEST_DIGEST), serverTime: instantSchema, highWater: sequence }).strict();
const serverReceiptSchema = evidenceReceiptSchema.extend({ canonicalEvent: z.string().max(MAX_EVENT_BYTES), manifestDigest: hash, manifestRelease: z.string().min(1).max(100) }).strict();
const exactResponseSchema = z.object({ context: contextSchema, records: z.array(serverReceiptSchema).max(MAX_BATCH_EVENTS), missingEventIds: z.array(uuid).max(MAX_BATCH_EVENTS) }).strict();
const pageSchema = z.object({ context: contextSchema, records: z.array(serverReceiptSchema).max(200), throughSequence: sequence,
  afterSequence: sequence, lastSequence: sequence, rowCount: sequence.max(200), payloadBytes: sequence.max(MAX_BATCH_BYTES), exhausted: z.boolean() }).strict();
const equals = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
const payloadBytes = (text: string) => new TextEncoder().encode(text).byteLength;
const asA1Receipt = (row: ServerEvidenceReceipt): EvidenceReceipt => ({ ownerId: row.ownerId, event: row.event,
  payloadHash: row.payloadHash, receivedAt: row.receivedAt, serverSequence: row.serverSequence });
const identity = (context: ServerEvidenceContext) => ({ ownerId: context.ownerId, generationId: context.generationId,
  resetMarker: context.resetMarker, prospectiveStartedAt: context.prospectiveStartedAt, studyDayTimezone: context.studyDayTimezone,
  protocol: context.protocol, manifestRelease: context.manifestRelease, manifestDigest: context.manifestDigest });

export interface VerifiedLegacyEvidencePrefix {
  readonly status: 'complete_authenticated_prefix';
  readonly snapshot: Immutable<EvidenceSnapshot>;
  readonly context: Immutable<LocalEvidenceContext>;
}
export type LegacyEvidencePrefixResult = VerifiedLegacyEvidencePrefix | {
  readonly status: 'partial'; readonly reason: 'resource_limit'; readonly throughSequence: number;
  readonly afterSequence: number; readonly generationId: string;
};
export interface LanguageLegacyEvidenceRepository {
  /** Local cancellation serial is allocated here, never parsed from the owner's opaque epoch. */
  context(): Immutable<LocalEvidenceContext>;
  serverContext(): Immutable<ServerEvidenceContext>;
  localContinuity(): 'verified' | 'unknown';
  store(): LocalEvidenceStore;
  deliverBatch(batch: FrozenBatch): Promise<{ status: 'acknowledged' | 'readback_required'; acknowledged: number; pending: number }>;
  readPrefix(options?: { maxEvents?: number; maxPayloadBytes?: number }): Promise<LegacyEvidencePrefixResult>;
  project(prefix: VerifiedLegacyEvidencePrefix): EvidenceProjection;
  cleanupAfterReset(expectedMarker: Readonly<{ present: boolean; value: string | null }>): Promise<void>;
  close(): void;
}
type Registration = { authority: LanguageLegacyEvidenceAuthority; context: ServerEvidenceContext; serial: number; retired: boolean; store: LocalEvidenceStore; continuity: 'verified' | 'unknown' };
const repositories = new WeakMap<LanguageLegacyEvidenceRepository, Registration>();
const prefixes = new WeakMap<VerifiedLegacyEvidencePrefix, Registration>();
const retiredAuthorities = new WeakSet<LanguageLegacyEvidenceAuthority>();
let cancellationSerial = 0;
function assertRegistration(entry: Registration): void {
  if (entry.retired || retiredAuthorities.has(entry.authority)) fail('stale_authority');
  try { languageLegacyEvidenceCapability.assertCurrent(entry.authority); }
  catch { entry.retired = true; fail('stale_authority'); }
}
function registration(repo: LanguageLegacyEvidenceRepository): Registration {
  const entry = repositories.get(repo); if (!entry) fail('stale_authority'); assertRegistration(entry); return entry;
}
function localContext(entry: Registration): LocalEvidenceContext {
  assertRegistration(entry);
  return { ownerId: entry.context.ownerId, generationId: entry.context.generationId,
    prospectiveStartedAt: entry.context.prospectiveStartedAt, studyDayTimezone: entry.context.studyDayTimezone,
    now: new Date(Math.max(Date.now(), Date.parse(entry.context.serverTime))).toISOString(), ownerEpoch: entry.serial, freshness: 'fresh' };
}
function parseContext(input: unknown, authority: LanguageLegacyEvidenceAuthority, original?: ServerEvidenceContext): ServerEvidenceContext {
  const parsed = contextSchema.safeParse(input); if (!parsed.success) fail('invalid_response');
  const value = parsed.data, marker = parseLanguageMarker(value.resetMarker.present ? value.resetMarker.value : undefined);
  if (value.ownerId !== authority.ownerId || marker.kind === 'invalid' ||
    (value.resetMarker.present ? marker.kind !== 'valid' : value.resetMarker.value !== null) ||
    !equals(value.resetMarker, authority.resetMarker) || Date.parse(value.prospectiveStartedAt) > Date.parse(value.serverTime)) fail('invalid_response');
  if (original && !equals(identity(value), identity(original))) { retiredAuthorities.add(authority); fail('legacy_stale_generation'); }
  return value;
}
function remoteFailure(error: unknown): LegacyEvidenceRepositoryError {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const known: LegacyEvidenceFailure[] = ['legacy_enrollment_integrity', 'legacy_invalid_enrollment', 'legacy_enrolled_generation_missing', 'legacy_enrollment_stale', 'legacy_enrollment_conflict', 'legacy_auth_mismatch', 'legacy_state_not_ready', 'legacy_unsupported_protocol', 'legacy_unsupported_manifest',
    'legacy_stale_generation', 'legacy_marker_conflict', 'legacy_invalid_event', 'legacy_event_id_conflict', 'legacy_source_slot_conflict', 'legacy_predecessor_conflict', 'legacy_retryable'];
  return new LegacyEvidenceRepositoryError(known.find(code => message === code) ?? 'unavailable');
}
/** Fixed singleton transport. There is deliberately no production dependency-injection factory. */
async function rpc(authority: LanguageLegacyEvidenceAuthority, guard: () => void, name: string, args: Record<string, unknown>): Promise<unknown> {
  guard();
  const client = createClient();
  let user;
  try { user = await client.auth.getUser(); } catch { guard(); fail('unavailable'); }
  guard();
  if (user.error) fail('unavailable');
  if (user.data.user?.id !== authority.ownerId) { retiredAuthorities.add(authority); fail('legacy_auth_mismatch'); }
  let result;
  try {
    guard(); // No awaited work between this guard and dispatch.
    result = await client.rpc(name, args).abortSignal(authority.signal);
  } catch { guard(); fail('unavailable'); }
  guard();
  if (result.error) {
    const error = remoteFailure(result.error);
    if (['legacy_auth_mismatch', 'legacy_stale_generation', 'legacy_marker_conflict', 'legacy_state_not_ready'].includes(error.code)) retiredAuthorities.add(authority);
    throw error;
  }
  return result.data;
}
const readArgs = (entry: Registration) => ({ expected_owner: entry.context.ownerId, expected_generation: entry.context.generationId,
  manifest_digest: LEGACY_EVIDENCE_MANIFEST_DIGEST });
async function readContext(entry: Registration): Promise<ServerEvidenceContext> {
  const result = await rpc(entry.authority, () => assertRegistration(entry), 'read_language_legacy_evidence_context', readArgs(entry));
  assertRegistration(entry); return parseContext(result, entry.authority, entry.context);
}
async function verifyReceipt(entry: Registration, input: unknown, context: ServerEvidenceContext): Promise<ServerEvidenceReceipt> {
  assertRegistration(entry);
  const parsed = serverReceiptSchema.safeParse(input); if (!parsed.success) fail('invalid_response');
  const row = parsed.data, event = row.event;
  if (row.ownerId !== context.ownerId || event.generationId !== context.generationId ||
    row.manifestDigest !== LEGACY_EVIDENCE_MANIFEST_DIGEST || row.manifestRelease !== LEGACY_EVIDENCE_MANIFEST_RELEASE ||
    payloadBytes(row.canonicalEvent) > MAX_EVENT_BYTES || canonicalEvidence(event) !== row.canonicalEvent ||
    event.sourceSlotKey !== makeSourceSlotKey(context.ownerId, event) || row.serverSequence > context.highWater ||
    Date.parse(event.occurredAt) < Date.parse(context.prospectiveStartedAt) || Date.parse(row.receivedAt) < Date.parse(event.occurredAt) ||
    Date.parse(row.receivedAt) > Date.parse(context.serverTime)) fail('invalid_response');
  const digest = await canonicalSha256(row.canonicalEvent); assertRegistration(entry);
  if (digest !== row.payloadHash) fail('invalid_response');
  return row;
}
async function readExact(entry: Registration, batch: FrozenBatch) {
  const data = await rpc(entry.authority, () => assertRegistration(entry), 'read_language_legacy_evidence_events',
    { ...readArgs(entry), event_ids: batch.events.map(event => event.eventId) });
  assertRegistration(entry);
  const parsed = exactResponseSchema.safeParse(data); if (!parsed.success) fail('invalid_response');
  const context = parseContext(parsed.data.context, entry.authority, entry.context);
  const requested = new Map(batch.events.map(event => [event.eventId, event])), seen = new Set<string>(), sequences = new Set<number>();
  const records: ServerEvidenceReceipt[] = [];
  let bytes = 0;
  for (const input of parsed.data.records) {
    const row = await verifyReceipt(entry, input, context); assertRegistration(entry);
    const expected = requested.get(row.event.eventId);
    if (!expected || seen.has(row.event.eventId) || sequences.has(row.serverSequence)) fail('invalid_response');
    if (row.canonicalEvent !== expected.canonical || row.payloadHash !== expected.payloadHash) fail('event_conflict');
    bytes += payloadBytes(row.canonicalEvent); if (bytes > MAX_BATCH_BYTES) fail('invalid_response');
    seen.add(row.event.eventId); sequences.add(row.serverSequence); records.push(row);
  }
  for (const id of parsed.data.missingEventIds) {
    if (!requested.has(id) || seen.has(id)) fail('invalid_response'); seen.add(id);
  }
  if (seen.size !== requested.size) fail('invalid_response');
  assertRegistration(entry);
  return { context, records, missing: parsed.data.missingEventIds };
}
async function acknowledge(entry: Registration, batch: FrozenBatch, records: ServerEvidenceReceipt[]): Promise<void> {
  if (!records.length) return;
  const expected = [];
  for (const row of records) {
    const metadata = await entry.store.readDelivery(localContext(entry), row.event.eventId); assertRegistration(entry);
    if (!metadata) fail('invalid_response'); expected.push(metadata);
  }
  const proof = registerAuthenticatedReceiptReadback({ context: localContext(entry), batchId: batch.batchId, exactReceipts: records }, () => assertRegistration(entry));
  await entry.store.acknowledgeBatch(localContext(entry), batch.batchId, proof, expected); assertRegistration(entry);
}
async function deliver(entry: Registration, input: FrozenBatch) {
  const batch = immutableCopy(input); await verifyFrozenBatch(batch); assertRegistration(entry);
  if (batch.ownerId !== entry.context.ownerId || batch.generationId !== entry.context.generationId) fail('legacy_stale_generation');
  await entry.store.putBatch(localContext(entry), batch); assertRegistration(entry);
  const stored = await entry.store.readBatch(localContext(entry), batch.batchId); assertRegistration(entry);
  if (!stored || !equals(stored.batch, batch)) fail('event_conflict');
  // Persisted exact intent precedes even the first remote read. A failed/partial
  // read never authorizes append; an append result never authorizes acknowledgement.
  let first;
  try { first = await readExact(entry, batch); }
  catch (error) { if (error instanceof LegacyEvidenceRepositoryError && error.code === 'event_conflict') {
    await entry.store.quarantineBatch(localContext(entry), batch.batchId); assertRegistration(entry);
  } throw error; }
  assertRegistration(entry);
  await acknowledge(entry, batch, first.records); assertRegistration(entry);
  if (!first.missing.length) return { status: 'acknowledged' as const, acknowledged: batch.events.length, pending: 0 };
  for (const id of first.missing) {
    const current = await entry.store.readDelivery(localContext(entry), id); assertRegistration(entry);
    if (!current || current.status === 'acknowledged') fail('event_conflict');
    if (current.status === 'quarantined') throw new LocalEvidenceError('quarantined');
  }
  let appendFailure: unknown;
  try {
    await rpc(entry.authority, () => assertRegistration(entry), 'append_language_legacy_evidence', { ...readArgs(entry), batch_id: batch.batchId,
      source_slot: batch.sourceSlotKey, expected_predecessor: batch.expectedPredecessor, canonical_events: batch.events.map(event => event.canonical) });
  } catch (error) { appendFailure = error; }
  assertRegistration(entry);
  for (const event of batch.events) {
    const current = await entry.store.readDelivery(localContext(entry), event.eventId); assertRegistration(entry);
    if (!current) fail('invalid_response');
    if (current.status !== 'acknowledged') {
      try { await entry.store.markReadbackRequired(localContext(entry), event, current.revision); }
      catch (error) {
        assertRegistration(entry);
        if (!(error instanceof LocalEvidenceError) || error.code !== 'checkpoint_conflict') throw error;
        // Another facade may have advanced delivery while this request was away.
        // This local read is not receipt authority; independent HTTP read follows.
        const latest = await entry.store.readDelivery(localContext(entry), event.eventId); assertRegistration(entry);
        if (!latest || latest.payloadHash !== event.payloadHash || !['acknowledged', 'readback_required'].includes(latest.status)) throw error;
      }
      assertRegistration(entry);
    }
  }
  let after;
  try { after = await readExact(entry, batch); }
  catch (error) { if (error instanceof LegacyEvidenceRepositoryError && error.code === 'event_conflict') {
    await entry.store.quarantineBatch(localContext(entry), batch.batchId); assertRegistration(entry);
  } throw error; }
  assertRegistration(entry);
  await acknowledge(entry, batch, after.records); assertRegistration(entry);
  if (after.missing.length && appendFailure instanceof LegacyEvidenceRepositoryError && appendFailure.code !== 'unavailable' && appendFailure.code !== 'legacy_retryable') {
    if (['legacy_event_id_conflict', 'legacy_source_slot_conflict', 'legacy_predecessor_conflict'].includes(appendFailure.code)) {
      await entry.store.quarantineBatch(localContext(entry), batch.batchId); assertRegistration(entry);
    }
    throw appendFailure;
  }
  return { status: after.missing.length ? 'readback_required' as const : 'acknowledged' as const,
    acknowledged: after.records.length, pending: after.missing.length };
}
async function readPrefix(entry: Registration, options: { maxEvents?: number; maxPayloadBytes?: number } = {}): Promise<LegacyEvidencePrefixResult> {
  const maxEvents = options.maxEvents ?? MAX_PREFIX_EVENTS, maxPayloadBytes = options.maxPayloadBytes ?? MAX_PREFIX_BYTES;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_PREFIX_EVENTS || !Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1 || maxPayloadBytes > MAX_PREFIX_BYTES) fail('invalid_response');
  const start = await readContext(entry); assertRegistration(entry);
  const through = start.highWater, records: ServerEvidenceReceipt[] = [], ids = new Set<string>();
  let after = 0, bytes = 0;
  while (after < through) {
    const raw = await rpc(entry.authority, () => assertRegistration(entry), 'read_language_legacy_evidence_page',
      { ...readArgs(entry), through_sequence: through, after_sequence: after, page_limit: Math.min(200, maxEvents - records.length || 1) });
    assertRegistration(entry);
    const parsed = pageSchema.safeParse(raw); if (!parsed.success) fail('invalid_response');
    const page = parsed.data, context = parseContext(page.context, entry.authority, start);
    if (page.throughSequence !== through || page.afterSequence !== after || page.rowCount !== page.records.length ||
      page.lastSequence !== (page.records.at(-1)?.serverSequence ?? after) || page.exhausted !== (page.lastSequence === through) ||
      context.highWater < through || !page.records.length) fail('invalid_response');
    let pageBytes = 0, next = after;
    const verified: ServerEvidenceReceipt[] = [];
    for (const input of page.records) {
      const row = await verifyReceipt(entry, input, context); assertRegistration(entry);
      if (row.serverSequence !== ++next || next > through || ids.has(row.event.eventId)) fail('invalid_response');
      pageBytes += payloadBytes(row.canonicalEvent); verified.push(row);
    }
    if (pageBytes !== page.payloadBytes || pageBytes > MAX_BATCH_BYTES) fail('invalid_response');
    if (records.length + verified.length > maxEvents || bytes + pageBytes > maxPayloadBytes) {
      assertRegistration(entry);
      return Object.freeze({ status: 'partial', reason: 'resource_limit', throughSequence: through, afterSequence: after, generationId: start.generationId });
    }
    for (const row of verified) { records.push(row); ids.add(row.event.eventId); }
    after = next; bytes += pageBytes;
    if (after < through && (records.length === maxEvents || bytes === maxPayloadBytes)) {
      assertRegistration(entry);
      return Object.freeze({ status: 'partial', reason: 'resource_limit', throughSequence: through, afterSequence: after, generationId: start.generationId });
    }
  }
  const final = await readContext(entry); assertRegistration(entry);
  if (final.highWater < through || !equals(identity(final), identity(start))) fail('legacy_stale_generation');
  const context = { ...localContext(entry), now: final.serverTime };
  const snapshot: EvidenceSnapshot = { schemaVersion: 1, ownerId: start.ownerId, generationId: start.generationId,
    prospectiveStartedAt: start.prospectiveStartedAt, studyDayTimezone: start.studyDayTimezone,
    completeness: { status: 'complete', throughServerSequence: through }, records: records.map(asA1Receipt) };
  const proof = registerAuthenticatedPrefix({ context, serverContext: final, throughSequence: through, records }, () => assertRegistration(entry));
  await entry.store.writeVerifiedPrefix(context, proof); assertRegistration(entry);
  const result: VerifiedLegacyEvidencePrefix = immutableCopy({ status: 'complete_authenticated_prefix' as const, snapshot, context });
  prefixes.set(result, entry); return result;
}
/** No capture/display consumer. Initialization requires the explicit release floor. */
export async function acquireLanguageLegacyEvidenceRepository(recordContext: LanguageRecordContext,
  options: { studyDayTimezone: string; mode?: 'initialize' | 'existing' }): Promise<LanguageLegacyEvidenceRepository> {
  const initialize = (options.mode ?? 'initialize') === 'initialize';
  if (!isRecordTimezone(options.studyDayTimezone) || !['initialize', 'existing'].includes(options.mode ?? 'initialize')) fail('invalid_response');
  if (initialize && (LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol !== 'protocol-required' || !LANGUAGE_LEGACY_EVIDENCE_RELEASE.enrollmentEnabled)) fail('feature_inactive');
  let authority: LanguageLegacyEvidenceAuthority;
  try { authority = languageLegacyEvidenceCapability.acquire(recordContext); } catch { fail('stale_authority'); }
  let acquiredEntry: Registration | null = null;
  const guard = () => { if (acquiredEntry?.retired || retiredAuthorities.has(authority)) fail('stale_authority'); try { languageLegacyEvidenceCapability.assertCurrent(authority); } catch { fail('stale_authority'); } };
  if (cancellationSerial === Number.MAX_SAFE_INTEGER) fail('unavailable');
  const serial = ++cancellationSerial;
  let context: ServerEvidenceContext | null = null;
  const store = new LocalEvidenceStore({ writerAdmission: null, isCurrent(fence: LocalFence) {
    try { guard(); return context !== null && fence.ownerId === context.ownerId && fence.generationId === context.generationId && fence.ownerEpoch === serial; } catch { return false; }
  } });
  const readStatus = async () => {
    const raw = await rpc(authority, guard, 'read_language_legacy_evidence_status', { expected_owner: authority.ownerId, expected_marker: authority.resetMarker });
    guard(); return parseStatus(raw, authority.ownerId, authority.resetMarker);
  };
  let status = await readStatus(); guard();
  if (status.status === 'enrolled_generation_missing') fail('legacy_enrolled_generation_missing');
  if (!initialize && status.status === 'unenrolled') fail('legacy_state_not_ready');
  let admission = await store.readAdmission(registerAuthenticatedAdmissionStatus({ ...statusAdmission(status), ownerEpoch: serial }, guard)); guard();
  if (status.status === 'unenrolled') {
    // Durable exact intent precedes every network enrollment attempt. A response
    // lost after commit is completed from fresh status on the next acquisition.
    let intent = admission.intent;
    if (!intent) intent = { version: 1, ownerId: authority.ownerId, requestId: crypto.randomUUID(), resetMarker: { ...authority.resetMarker },
      studyDayTimezone: options.studyDayTimezone, protocol: SERVER_EVIDENCE_PROTOCOL,
      manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE, manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST };
    assertIntent(intent, authority.ownerId, authority.resetMarker);
    await store.freezeEnrollmentIntent(intent, registerAuthenticatedAdmissionStatus({ ...statusAdmission(status), ownerEpoch: serial }, guard)); guard();
    const result = await rpc(authority, guard, 'enroll_language_legacy_evidence_v1', {
      expected_owner: intent.ownerId, creation_request_id: intent.requestId, expected_marker: intent.resetMarker,
      proposed_timezone: intent.studyDayTimezone, protocol: intent.protocol, manifest_release: intent.manifestRelease, manifest_digest: intent.manifestDigest,
    });
    guard(); const receipt = enrollmentSchema.safeParse(result); if (!receipt.success) fail('invalid_response');
    parseContext(receipt.data.currentContext, authority);
    if (receipt.data.status === 'enrolled' ? receipt.data.creationRequestId !== intent.requestId || receipt.data.initialGenerationId !== receipt.data.currentContext.generationId
      : receipt.data.creationRequestId === intent.requestId) fail('invalid_response');
    // An RPC result alone is never local admission proof.
    status = await readStatus(); guard();
    if (status.status !== 'enrolled' || !status.enrollment || !status.currentContext) fail('legacy_enrolled_generation_missing');
    if (receipt.data.creationRequestId !== status.enrollment.creationRequestId || receipt.data.initialGenerationId !== status.enrollment.initialGenerationId ||
      !equals(identity(receipt.data.currentContext), identity(status.currentContext))) fail('invalid_response');
    admission = await store.readAdmission(registerAuthenticatedAdmissionStatus({ ...statusAdmission(status), ownerEpoch: serial }, guard)); guard();
  }
  if (status.status !== 'enrolled' || !status.currentContext || !status.enrollment) fail('legacy_state_not_ready');
  context = parseContext(status.currentContext, authority);
  if (admission.intent && admission.continuity !== 'verified') {
    const intent = admission.intent;
    // A competing enrollment, rotated generation or modified request cannot
    // convert the pending local intent into first-use continuity.
    if (firstAdmissionMatches(intent, status)) {
      await store.completeFirstAdmission(intent, registerAuthenticatedFirstAdmission({ ownerId: authority.ownerId, ownerEpoch: serial,
        incarnationId: admission.incarnationId, intent, currentContext: context,
        creationRequestId: status.enrollment.creationRequestId, initialGenerationId: status.enrollment.initialGenerationId }, guard)); guard();
      admission = await store.readAdmission(registerAuthenticatedAdmissionStatus({ ...statusAdmission(status), ownerEpoch: serial }, guard)); guard();
    }
  }
  const entry = { authority, context, serial, retired: false, continuity: admission.continuity } as Registration;
  acquiredEntry = entry;
  entry.store = new LocalEvidenceStore({ writerAdmission: admission.continuity === 'verified' ? admission.admission : null,
    onAdmissionLost() { entry.continuity = 'unknown'; },
    isCurrent(fence: LocalFence) {
      try { assertRegistration(entry); return fence.ownerId === entry.context.ownerId && fence.generationId === entry.context.generationId && fence.ownerEpoch === serial; }
      catch { return false; }
    },
  });
  const repository: LanguageLegacyEvidenceRepository = Object.freeze({
    context() { return immutableCopy(localContext(registration(this))); },
    serverContext() { return immutableCopy(registration(this).context); },
    localContinuity() { return registration(this).continuity; },
    store() { const current = registration(this); if (LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol !== 'protocol-required' || !LANGUAGE_LEGACY_EVIDENCE_RELEASE.captureEnabled) fail('feature_inactive'); if (current.continuity !== 'verified') fail('local_continuity_unknown'); return current.store; },
    async deliverBatch(batch: FrozenBatch) { return deliver(registration(this), batch); },
    async readPrefix(bounds?: { maxEvents?: number; maxPayloadBytes?: number }) { return readPrefix(registration(this), bounds); },
    project(prefix: VerifiedLegacyEvidencePrefix) {
      const current = registration(this);
      if (prefixes.get(prefix) !== current) fail('stale_authority');
      const { ownerId, generationId, prospectiveStartedAt, studyDayTimezone, now } = prefix.context;
      return projectLegacyEvidence(prefix.snapshot, { ownerId, generationId, prospectiveStartedAt, studyDayTimezone, now });
    },
    async cleanupAfterReset(expectedMarker: Readonly<{ present: boolean; value: string | null }>) {
      const current = registration(this);
      if (!markerSchema.safeParse(expectedMarker).success || !equals(expectedMarker, current.authority.resetMarker)) fail('legacy_marker_conflict');
      const checked = await readContext(current); assertRegistration(current);
      if (!equals(checked.resetMarker, expectedMarker)) fail('legacy_marker_conflict');
      await current.store.cleanupStaleGenerations(localContext(current)); assertRegistration(current);
    },
    close() { const current = repositories.get(this); if (current) current.retired = true; },
  });
  repositories.set(repository, entry);
  const proof = registerAuthenticatedContext({ context: localContext(entry), serverContext: context }, () => assertRegistration(entry));
  try { await entry.store.writeVerifiedContext(localContext(entry), proof); assertRegistration(entry); }
  catch (error) { entry.retired = true; throw error; }
  return repository;
}

const enrollmentIdentitySchema = z.object({ creationRequestId: uuid, initialGenerationId: uuid }).strict();
const statusSchema = z.object({ version: z.literal(1), status: z.enum(['unenrolled', 'enrolled', 'enrolled_generation_missing']),
  ownerId: uuid, protocol: z.literal(SERVER_EVIDENCE_PROTOCOL), manifestRelease: z.literal(LEGACY_EVIDENCE_MANIFEST_RELEASE),
  manifestDigest: z.literal(LEGACY_EVIDENCE_MANIFEST_DIGEST), statePresent: z.literal(true), resetMarker: markerSchema,
  enrollment: enrollmentIdentitySchema.nullable(), currentContext: contextSchema.nullable() }).strict();
const enrollmentSchema = z.object({ version: z.literal(1), status: z.enum(['enrolled', 'existing_enrollment']),
  creationRequestId: uuid, initialGenerationId: uuid, currentContext: contextSchema }).strict();
type EvidenceStatus = z.infer<typeof statusSchema>;
function parseStatus(input: unknown, ownerId: string, expectedMarker: Readonly<{ present: boolean; value: string | null }>): EvidenceStatus {
  const parsed = statusSchema.safeParse(input); if (!parsed.success) fail('invalid_response');
  const value = parsed.data, marker = parseLanguageMarker(value.resetMarker.present ? value.resetMarker.value : null);
  if (value.ownerId !== ownerId || !equals(value.resetMarker, expectedMarker) ||
    (value.resetMarker.present ? marker.kind !== 'valid' : value.resetMarker.value !== null) ||
    (value.status === 'unenrolled' ? value.enrollment !== null || value.currentContext !== null : value.enrollment === null) ||
    (value.status === 'enrolled') !== (value.currentContext !== null)) fail('invalid_response');
  if (value.currentContext && (value.currentContext.ownerId !== ownerId || !equals(value.currentContext.resetMarker, expectedMarker) ||
    Date.parse(value.currentContext.prospectiveStartedAt) > Date.parse(value.currentContext.serverTime))) fail('invalid_response');
  return value;
}
function statusAdmission(status: EvidenceStatus) {
  return { ownerId: status.ownerId, resetMarker: status.resetMarker, status: status.status,
    creationRequestId: status.enrollment?.creationRequestId ?? null, initialGenerationId: status.enrollment?.initialGenerationId ?? null,
    currentContext: status.currentContext };
}
function assertIntent(intent: FrozenEnrollmentIntent, ownerId: string, marker: Readonly<{ present: boolean; value: string | null }>): void {
  if (intent.version !== 1 || intent.ownerId !== ownerId || !uuid.safeParse(intent.requestId).success || !equals(intent.resetMarker, marker) ||
    !isRecordTimezone(intent.studyDayTimezone) || intent.protocol !== SERVER_EVIDENCE_PROTOCOL ||
    intent.manifestRelease !== LEGACY_EVIDENCE_MANIFEST_RELEASE || intent.manifestDigest !== LEGACY_EVIDENCE_MANIFEST_DIGEST) fail('legacy_enrollment_stale');
}
function firstAdmissionMatches(intent: FrozenEnrollmentIntent, status: EvidenceStatus): boolean {
  const context = status.currentContext;
  return status.status === 'enrolled' && context !== null && status.enrollment !== null &&
    intent.ownerId === status.ownerId && intent.requestId === status.enrollment.creationRequestId &&
    context.generationId === status.enrollment.initialGenerationId && equals(intent.resetMarker, status.resetMarker) &&
    intent.studyDayTimezone === context.studyDayTimezone && intent.protocol === context.protocol &&
    intent.manifestRelease === context.manifestRelease && intent.manifestDigest === context.manifestDigest;
}
function cleanupIdentity(status: EvidenceStatus): unknown {
  return { ...statusAdmission(status), currentContext: status.currentContext ? identity(status.currentContext) : null };
}
async function resetStatus(authority: LanguageEvidenceResetAuthority): Promise<EvidenceStatus> {
  const guard = () => languageEvidenceResetCapability.assertCurrent(authority);
  guard(); const client = createClient();
  let auth;
  try { auth = await client.auth.getUser(); } catch { guard(); fail('unavailable'); }
  guard(); if (auth.error || auth.data.user?.id !== authority.ownerId) fail('legacy_auth_mismatch');
  let result;
  try { result = await client.rpc('read_language_legacy_evidence_status', { expected_owner: authority.ownerId,
    expected_marker: { present: true, value: authority.marker } }).abortSignal(new AbortController().signal); }
  catch { guard(); fail('unavailable'); }
  guard(); if (result.error) throw remoteFailure(result.error);
  return parseStatus(result.data, authority.ownerId, { present: true, value: authority.marker });
}
/** Sole consumer is the existing reset orchestrator. No ordinary writer context
 * can be acquired while the same-request cleanup fence is pending. */
export async function cleanupLanguageLegacyEvidenceForReset(context: LanguageResetContext, marker: string): Promise<LanguageResetContext> {
  if (LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol !== 'protocol-required') fail('feature_inactive');
  const authority = languageEvidenceResetCapability.acquire(context, marker);
  const guard = () => languageEvidenceResetCapability.assertCurrent(authority);
  const before = await resetStatus(authority); guard();
  if (before.status !== 'unenrolled') {
    if (!before.enrollment) fail('invalid_response');
    const proof = registerAuthenticatedResetEvidenceState({ ownerId: authority.ownerId, ownerEpoch: authority.ownerEpoch,
      requestId: authority.requestId, resetMarker: { present: true, value: marker }, status: before.status,
      creationRequestId: before.enrollment.creationRequestId, initialGenerationId: before.enrollment.initialGenerationId,
      context: before.currentContext }, guard);
    // The registered reset proof is the only authority used by cleanup; ordinary
    // LocalFence access remains disabled throughout the transaction and readback.
    const store = new LocalEvidenceStore({ writerAdmission: null, isCurrent: () => false });
    await store.cleanupConfirmedReset(proof); guard();
  }
  // This deliberately also checks the skip-IDB branch. Concurrent first
  // enrollment or generation loss under the same marker leaves cleanup pending.
  const after = await resetStatus(authority); guard();
  if (!equals(cleanupIdentity(before), cleanupIdentity(after))) fail('legacy_stale_generation');
  return languageEvidenceResetCapability.verify(authority);
}
