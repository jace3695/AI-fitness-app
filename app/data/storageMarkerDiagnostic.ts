/**
 * Inactive G8 metadata diagnostic. No application entrypoint imports this module.
 * Shape observations are not a snapshot, owner check, evidence receipt, or write
 * authorization. Raw marker strings may contain private before-images: never
 * log, display, persist, or transmit the supplied observations.
 *
 * Deliberately no imports from the transaction writer or application lifecycle.
 * Fixed protocol spellings match storageTransaction.ts at 02c670a; they are not
 * a source-key allowlist for export or recovery.
 */
const LEGACY_KEY = 'yeoni-storage-transaction-v1';
const V2_KEY = 'yeoni-storage-transaction-v2';
const GENERATION_KEY = 'yeoni-storage-generation-v1';
const MAX_MARKER_UNITS = 1_048_576;
const MAX_TOTAL_UNITS = 2_097_152;
const MAX_BEFORE_ENTRIES = 10_000;

export type StorageMarkerRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly raw: string }
  | { readonly kind: 'unavailable' };

/** Own data properties only; no Storage, owner, browser, or lifecycle facts. */
export interface StorageMarkerSample {
  readonly legacy: StorageMarkerRead;
  readonly v2: StorageMarkerRead;
  readonly generation: StorageMarkerRead;
}

export interface StorageMarkerObservations {
  readonly first: StorageMarkerSample;
  readonly second?: StorageMarkerSample;
}

export interface StorageMarkerDiagnostic {
  readonly version: 'g8-marker-diagnostic/v1';
  readonly legacyMarker: 'absent' | 'present_valid_shape' | 'present_unreadable' | 'inspection_incomplete' | 'unavailable';
  readonly v2Marker: 'absent' | 'committed_shape' | 'prepared_shape' | 'unreadable' | 'unsupported_version' | 'inspection_incomplete' | 'unavailable';
  readonly observation: 'single_sample' | 'no_marker_change_observed' | 'changed_during_observation' | 'unavailable';
  readonly reason: 'legacy_preservation_required' | 'ambiguous_markers' | 'invalid_metadata' | 'inspection_incomplete'
    | 'storage_unavailable' | 'v2_prepared_observed' | 'no_legacy_marker_observed';
  readonly quiescence: 'unverified';
  readonly repairPermission: 'none';
  readonly resumePermission: 'none';
}

/** An explicit, already supplied object; no default global storage lookup. */
export interface StorageMarkerReader {
  getItem(key: string): string | null;
}

type LegacyStatus = StorageMarkerDiagnostic['legacyMarker'];
type V2Status = StorageMarkerDiagnostic['v2Marker'];
type BeforeStatus = 'valid' | 'unreadable' | 'inspection_incomplete';


/**
 * Snapshot only known own data descriptors, without invoking input accessors.
 * Proxy reflection can itself throw; never inspect or expose that exception.
 * No subsequent inspection reads caller-owned wrappers or descriptor values.
 */
function dataFields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length < required.length || keys.length > required.length + optional.length
      || keys.some(key => typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)))) return null;
    const fields: Record<string, unknown> = Object.create(null);
    for (const key of [...required, ...optional]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        if (required.includes(key)) return null;
        continue;
      }
      if (!Object.hasOwn(descriptor, 'value')) return null;
      fields[key] = descriptor.value;
    }
    return fields;
  } catch {
    return null;
  }
}

function normalizeRead(value: unknown): StorageMarkerRead {
  // Determine the discriminant from an own data descriptor, not value.kind.
  // Snapshot both possible fields once; validate the exact variant afterwards.
  const fields = dataFields(value, ['kind'], ['raw']);
  if (fields?.kind === 'present' && Object.hasOwn(fields, 'raw') && typeof fields.raw === 'string') {
    return { kind: 'present', raw: fields.raw };
  }
  if (fields && !Object.hasOwn(fields, 'raw') && (fields.kind === 'absent' || fields.kind === 'unavailable')) {
    return { kind: fields.kind };
  }
  return { kind: 'unavailable' };
}

function unavailableSample(): StorageMarkerSample {
  return { legacy: { kind: 'unavailable' }, v2: { kind: 'unavailable' }, generation: { kind: 'unavailable' } };
}

function normalizeSample(value: unknown): StorageMarkerSample {
  const fields = dataFields(value, ['legacy', 'v2', 'generation']);
  return fields ? {
    legacy: normalizeRead(fields.legacy), v2: normalizeRead(fields.v2), generation: normalizeRead(fields.generation),
  } : unavailableSample();
}

function normalizeObservations(value: unknown): StorageMarkerObservations {
  const fields = dataFields(value, ['first'], ['second']);
  if (!fields) return { first: unavailableSample() };
  return { first: normalizeSample(fields.first), second: fields.second === undefined ? undefined : normalizeSample(fields.second) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inspectBefore(value: unknown): BeforeStatus {
  if (!isObject(value)) return 'unreadable';
  // JSON.parse is byte-bounded first. Count own entries before inspecting values;
  // overflow is incomplete inspection, including maps with invalid entries.
  let count = 0;
  for (const key in value) {
    if (Object.hasOwn(value, key) && ++count > MAX_BEFORE_ENTRIES) return 'inspection_incomplete';
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    // Match the existing reserved marker/session restriction, with additional
    // conservative rejection of prototype-shaped keys. Never dereference keys.
    if (key === LEGACY_KEY || key === V2_KEY || key === GENERATION_KEY || key === 'fitness-cloud-sync-epoch'
      || key === '__proto__' || key === 'prototype' || key === 'constructor') return 'unreadable';
    if (value[key] !== null && typeof value[key] !== 'string') return 'unreadable';
  }
  return 'valid';
}

function inspectLegacy(read: StorageMarkerRead, bounded: boolean): LegacyStatus {
  if (read.kind === 'absent') return 'absent';
  if (read.kind === 'unavailable' || typeof read.raw !== 'string') return 'unavailable';
  if (!bounded) return 'inspection_incomplete';
  try {
    const shape = inspectBefore(JSON.parse(read.raw));
    return shape === 'valid' ? 'present_valid_shape' : shape === 'unreadable' ? 'present_unreadable' : shape;
  } catch {
    return 'present_unreadable';
  }
}

function inspectV2(read: StorageMarkerRead, bounded: boolean): V2Status {
  if (read.kind === 'absent') return 'absent';
  if (read.kind === 'unavailable' || typeof read.raw !== 'string') return 'unavailable';
  if (!bounded) return 'inspection_incomplete';
  try {
    const value: unknown = JSON.parse(read.raw);
    if (!isObject(value) || !Object.hasOwn(value, 'version')) return 'unreadable';
    if (typeof value.version === 'number' && value.version !== 2) return 'unsupported_version';
    if (value.version !== 2 || !Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'generation')
      || typeof value.generation !== 'string' || !value.generation) return 'unreadable';
    if (value.state === 'committed') return 'committed_shape';
    if (value.state !== 'prepared' || !Object.hasOwn(value, 'transactionId') || !Object.hasOwn(value, 'before')
      || typeof value.transactionId !== 'string' || !value.transactionId) return 'unreadable';
    const shape = inspectBefore(value.before);
    return shape === 'valid' ? 'prepared_shape' : shape;
  } catch {
    return 'unreadable';
  }
}

function unavailable(read: StorageMarkerRead): boolean {
  return read.kind === 'unavailable' || (read.kind === 'present' && typeof read.raw !== 'string');
}

function different(a: StorageMarkerRead, b: StorageMarkerRead): boolean {
  if (unavailable(a) || unavailable(b)) return false;
  return a.kind !== b.kind || (a.kind === 'present' && b.kind === 'present' && a.raw !== b.raw);
}

/**
 * Pure, synchronous classification of at most two supplied ordered samples.
 * The 2 Mi-unit total cap covers the entire call, including repeated strings in
 * both samples. All string caps are checked before parsing or raw comparison.
 * Invalid wrapper shapes/accessors become unavailable. Strings are captured
 * once from own data descriptors, so caller getters cannot bypass the caps.
 * Generation is opaque; it is only bounded and compared, never JSON-decoded.
 */
export function classifyStorageMarkers(observations: StorageMarkerObservations): StorageMarkerDiagnostic {
  const { first, second } = normalizeObservations(observations);
  const samples = second ? [first, second] : [first];
  let total = 0;
  let bounded = true;
  let hasUnavailable = false;
  let hasLegacy = false;
  for (const sample of samples) {
    hasLegacy ||= sample.legacy.kind === 'present';
    for (const read of [sample.legacy, sample.v2, sample.generation]) {
      hasUnavailable ||= unavailable(read);
      if (read.kind === 'present' && typeof read.raw === 'string') {
        total += read.raw.length;
        if (read.raw.length > MAX_MARKER_UNITS || total > MAX_TOTAL_UNITS) bounded = false;
      }
    }
  }

  const legacyStatuses = samples.map(sample => inspectLegacy(sample.legacy, bounded));
  const v2Statuses = samples.map(sample => inspectV2(sample.v2, bounded));
  // Summarize conservatively across the observation window, never only its last
  // sample. A disappeared legacy marker does not erase an observed legacy block.
  const legacyOrder: readonly LegacyStatus[] = ['unavailable', 'inspection_incomplete', 'present_unreadable', 'present_valid_shape', 'absent'];
  const v2Order: readonly V2Status[] = ['unavailable', 'inspection_incomplete', 'unsupported_version', 'unreadable', 'prepared_shape', 'committed_shape', 'absent'];
  const legacyMarker = legacyOrder.find(status => legacyStatuses.includes(status))!;
  const v2Marker = v2Order.find(status => v2Statuses.includes(status))!;
  const incomplete = !bounded || legacyStatuses.includes('inspection_incomplete') || v2Statuses.includes('inspection_incomplete');
  const preparedObserved = v2Statuses.includes('prepared_shape');
  const invalidV2 = v2Statuses.includes('unreadable') || v2Statuses.includes('unsupported_version');

  let observation: StorageMarkerDiagnostic['observation'] = 'single_sample';
  if (!bounded) observation = 'unavailable';
  else if (second && (different(first.legacy, second.legacy) || different(first.v2, second.v2) || different(first.generation, second.generation))) {
    observation = 'changed_during_observation';
  } else if (hasUnavailable) observation = 'unavailable';
  else if (second) observation = 'no_marker_change_observed';

  const reason: StorageMarkerDiagnostic['reason'] = hasUnavailable ? 'storage_unavailable'
    : incomplete ? 'inspection_incomplete'
    : hasLegacy && preparedObserved ? 'ambiguous_markers'
    : hasLegacy ? 'legacy_preservation_required'
    : invalidV2 ? 'invalid_metadata'
    : preparedObserved ? 'v2_prepared_observed'
    : 'no_legacy_marker_observed';

  return Object.freeze({
    version: 'g8-marker-diagnostic/v1', legacyMarker, v2Marker, observation, reason,
    quiescence: 'unverified', repairPermission: 'none', resumePermission: 'none',
  });
}

function readMarker(storage: StorageMarkerReader | null | undefined, key: string): StorageMarkerRead {
  try {
    if (storage == null) return { kind: 'unavailable' };
    const raw = storage.getItem(key);
    if (raw === null) return { kind: 'absent' };
    // Runtime defense for non-Storage test doubles/adapters: never coerce a value.
    return typeof raw === 'string' ? { kind: 'present', raw } : { kind: 'unavailable' };
  } catch {
    // Do not inspect, stringify, retain, or return the thrown value.
    return { kind: 'unavailable' };
  }
}

function readSample(storage: StorageMarkerReader | null | undefined): StorageMarkerSample {
  return {
    legacy: readMarker(storage, LEGACY_KEY),
    v2: readMarker(storage, V2_KEY),
    generation: readMarker(storage, GENERATION_KEY),
  };
}

/**
 * Exactly two ordered three-key samples (six getItem attempts), no retry,
 * enumeration, referenced-key read, global lookup, locking, or mutation.
 * The caller must handle failure to obtain its storage object by passing null
 * or supplying unavailable observations to the pure classifier.
 * Returned output contains only fixed codes; raw observations stay transient.
 * Equal markers cannot establish quiescence, including ABA or old writers that
 * change records without participating in this marker protocol.
 */
export function readStorageMarkerDiagnostic(storage: StorageMarkerReader | null | undefined): StorageMarkerDiagnostic {
  return classifyStorageMarkers({ first: readSample(storage), second: readSample(storage) });
}
