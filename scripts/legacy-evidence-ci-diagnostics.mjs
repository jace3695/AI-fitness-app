/** Console diagnostics are a separate, closed projection, never a report/error dump. */
import { fileURLToPath } from 'node:url';
import { getCallSites, types } from 'node:util';
import nativeAssert from 'node:assert/strict';

export const CASES = Object.freeze([
  'old_direct_writer_vs_append', 'append_then_reset', 'reset_then_stale_append',
  'concurrent_same_slot_and_distinct_slots', 'enrollment_vs_reset_both_orders',
  'state_delete_reinsert_vs_append', 'assistant_and_connector_dependencies',
  'rollback_allocation', 'account_and_state_cascade', 'request_bound_enrollment_replay', 'competing_enrollment_nonce',
]);
export const REFUSALS = Object.freeze({
  'unverified disposable stack capability': 'unverified_stack',
  'ambiguous generated config': 'ambiguous_config',
  'disposable GitHub Actions runner required': 'runner_required',
  'wrong checkout': 'wrong_checkout',
  'missing Actions run identity': 'run_identity_missing',
  'external database or credential override': 'external_database_override',
  'external API override': 'external_api_override',
  'missing generated config section': 'config_section_missing',
  'unexpected disposable ports': 'unexpected_ports',
  'missing local stack status': 'local_status_missing',
  'external public credential override': 'external_public_credential_override',
  'invalid generated database URL': 'invalid_database_url',
  'non-disposable database URL': 'nonlocal_database_url',
  'invalid Docker inspection': 'invalid_container_inspection',
  'missing or ambiguous disposable database container': 'ambiguous_container',
  'database image or project metadata mismatch': 'container_identity_mismatch',
  'database port metadata mismatch': 'container_port_mismatch',
  'generated stack files absent': 'stack_files_missing',
  'unsafe generated stack file': 'unsafe_stack_file',
  'nonlocal Docker context': 'nonlocal_docker_context',
  'invalid container discovery': 'invalid_container_discovery',
  'nonlocal or provider request': 'nonlocal_request',
  'synthetic account bound exceeded': 'account_bound_exceeded',
  'no runtime arguments accepted': 'unexpected_arguments',
});
const PHASE_CHECKPOINTS = Object.freeze({
  preflight: ['arguments_and_stack', 'generated_files', 'status_and_config', 'docker_context', 'container_discovery', 'container_identity'],
  postgres: ['execute', 'imports', 'source_digests', 'sessions', 'synthetic_accounts', 'auth_owner_fixture'],
  audit: ['schema', 'privileges', 'dependencies', 'restricted_roles', 'disposable_activation'],
  scenario: ['execute'],
  http: ['execute'],
  cleanup: ['postgres_sessions', 'postgres_accounts', 'postgres_observer', 'http_repository', 'http_coordinator', 'http_owner', 'http_fixture', 'http_indexeddb', 'http_accounts'],
  report: ['write'],
  gate: ['complete'],
});
const CODES = new Set([
  'ERR_ASSERTION', 'ERR_MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION',
  'ENOENT', 'EACCES', 'EPERM', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT',
  '42501', '57014', '55P03', '40P01', '23503', '23505', '42P01', '42883', 'PGRST106',
  'legacy_harness_refused', 'legacy_cleanup_failed', 'legacy_auth_mismatch',
  'legacy_auth_owner_fixture_failed',
  'legacy_enrolled_generation_missing', 'legacy_enrollment_conflict', 'legacy_enrollment_integrity',
  'legacy_enrollment_stale', 'legacy_event_id_conflict', 'legacy_invalid_enrollment', 'legacy_invalid_event',
  'legacy_marker_conflict', 'legacy_predecessor_conflict', 'legacy_source_slot_conflict',
  'legacy_stale_generation', 'legacy_state_not_ready', 'legacy_unsupported_manifest', 'legacy_unsupported_protocol',
]);
const REFUSAL_CODES = new Set(Object.values(REFUSALS));
const SQLSTATES = new Set(['42501', '57014', '55P03', '40P01', '23503', '23505', '42P01', '42883', 'P0001']);
const SQL_ERRORS = new Set(['sql_error', ...[...CODES].filter(code => code.startsWith('legacy_'))]);
export const EXECUTOR_DEPENDENCIES = Object.freeze([
  'executor_auth_usage', 'executor_public_usage', 'executor_private_usage', 'executor_auth_uid',
  'reset_auth_usage', 'reset_public_usage', 'reset_private_usage', 'reset_auth_uid',
  'executor_canonical', 'executor_instant', 'executor_marker', 'executor_timezone_valid',
  'executor_assert_request', 'executor_context_json', 'executor_receipt', 'executor_validate_event', 'executor_check_read',
]);
export const AUTH_INSTALLER_CAPABILITIES = Object.freeze(['installer_auth_owner_set', 'installer_auth_grant_option', 'installer_auth_direct_grant_option']);
const SOURCES = ['qa-legacy-evidence-postgres.mjs', 'qa-legacy-evidence-http.mjs'].map(name => {
  const url = new URL(name, import.meta.url);
  return { name, prefixes: [url.href, fileURLToPath(url)] };
});
export const DIAGNOSTIC_LINE_LIMIT = 160;
export const DIAGNOSTIC_CHARACTER_LIMIT = 512;

// Never invoke payload getters, toJSON, coercions, causes or custom inspection.
const assertionLocations = new WeakMap();
const sqlDenials = new WeakMap();
function ownValue(object, key) {
  if ((typeof object !== 'object' && typeof object !== 'function') || object === null || types.isProxy(object)) return undefined;
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
}
export function safeCode(error) {
  const code = ownValue(error, 'code');
  return typeof code === 'string' && CODES.has(code) ? code : 'harness_error';
}
// The failed assertion remains the original error. Never copy its SQL payload,
// SQLERRM, query, identity or even an arbitrary five-character SQLSTATE.
export function rememberSqlDenial(error, result) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function') || types.isProxy(error)) return;
  const state = ownValue(result, 'sqlstate'), code = ownValue(result, 'error');
  sqlDenials.set(error, {
    sqlstate: typeof state === 'string' && SQLSTATES.has(state) ? state : 'unknown_sqlstate',
    error: typeof code === 'string' && SQL_ERRORS.has(code) ? code : 'unknown_error',
  });
}
function sourceLocation(error) {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) return assertionLocations.get(error);
  return undefined;
}
// Capture assertion call sites before invoking the unchanged built-in assertion.
// Node's getCallSites does not evaluate an Error's stack or prepareStackTrace.
// Native/accessor-backed thrown stacks are deliberately never read.
function assertionCallSites() {
  const result = [];
  for (const frame of getCallSites(12)) {
    const source = SOURCES.find(source => source.prefixes.includes(frame.scriptName));
    if (!source || !Number.isInteger(frame.lineNumber) || frame.lineNumber < 1 || frame.lineNumber > 99_999 ||
        !Number.isInteger(frame.columnNumber) || frame.columnNumber < 1 || frame.columnNumber > 99_999) continue;
    const location = `${source.name}:${frame.lineNumber}:${frame.columnNumber}`;
    if (!result.includes(location)) result.push(location);
    if (result.length === 3) break;
  }
  return result;
}
export const diagnosticAssert = Object.freeze(Object.fromEntries(
  ['equal', 'notEqual', 'deepEqual', 'ok', 'match', 'throws', 'rejects'].map(method => [method, (...args) => {
    let locations = [];
    try { locations = assertionCallSites(); } catch { /* Diagnostics cannot skip an assertion. */ }
    const remember = error => {
      if (locations.length && error !== null && (typeof error === 'object' || typeof error === 'function') && !assertionLocations.has(error)) assertionLocations.set(error, locations);
      throw error;
    };
    try {
      const result = nativeAssert[method](...args);
      return method === 'rejects' ? result.catch(remember) : result;
    } catch (error) { return remember(error); }
  }]),
));
function context(phase, checkpoint, caseName) {
  const valid = typeof phase === 'string' && Object.hasOwn(PHASE_CHECKPOINTS, phase) && PHASE_CHECKPOINTS[phase].includes(checkpoint);
  if (!valid || (caseName !== undefined && !CASES.includes(caseName))) throw new Error('Invalid diagnostic enum');
  return { phase, checkpoint, ...(caseName === undefined ? {} : { case: caseName }) };
}
export function createLegacyEvidenceDiagnostics(writeLine = line => console.log(line)) {
  let current = context('gate', 'complete'), lines = 0;
  const failures = new WeakSet();
  function emit(entry, status, error) {
    if (lines >= DIAGNOSTIC_LINE_LIMIT) return;
    const payload = { ...entry, status };
    if (status === 'failed') {
      payload.code = safeCode(error);
      const refusal = ownValue(error, 'refusal');
      if (typeof refusal === 'string' && REFUSAL_CODES.has(refusal)) payload.refusal = refusal;
      const sources = sourceLocation(error); if (sources) payload.sources = sources;
      const denial = error !== null && (typeof error === 'object' || typeof error === 'function') ? sqlDenials.get(error) : undefined;
      if (denial) payload.denial = denial;
    }
    // All serialized values above are enums or a bounded source coordinate.
    const line = lines === DIAGNOSTIC_LINE_LIMIT - 1 ? '[legacy-evidence-ci] diagnostics_limit_reached' : `[legacy-evidence-ci] ${JSON.stringify(payload)}`;
    lines++;
    // A broken diagnostic sink must never skip work or replace its failure.
    try { writeLine(line); } catch { /* Console transport only; work errors propagate below. */ }
  }
  function fail(entry, error) {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      if (failures.has(error)) return;
      failures.add(error);
    }
    emit(entry, 'failed', error);
  }
  return Object.freeze({
    start(phase, checkpoint, caseName) { current = context(phase, checkpoint, caseName); emit(current, 'running'); },
    passed() { emit(current, 'passed'); },
    failed(error) { fail(current, error); },
    dependency(name, granted) {
      if (!EXECUTOR_DEPENDENCIES.includes(name) || typeof granted !== 'boolean') throw new Error('Invalid diagnostic enum');
      emit({ ...context('audit', 'dependencies'), dependency: name, granted }, 'observed');
    },
    capability(name, available) {
      if (!AUTH_INSTALLER_CAPABILITIES.includes(name) || typeof available !== 'boolean') throw new Error('Invalid diagnostic enum');
      emit({ ...context('audit', 'dependencies'), capability: name, available }, 'observed');
    },
    async run(phase, checkpoint, callback, caseName) {
      const entry = context(phase, checkpoint, caseName); current = entry; emit(entry, 'running');
      try { const result = await callback(); emit(entry, 'passed'); return result; }
      catch (error) { fail(current, error); throw error; }
    },
    async cleanup(steps) {
      let failed = false, firstError;
      for (const { checkpoint, run } of steps) {
        const entry = context('cleanup', checkpoint); emit(entry, 'running');
        try { await run(); emit(entry, 'passed'); }
        catch (error) { fail(entry, error); if (!failed) firstError = error; failed = true; }
      }
      if (failed) throw firstError;
    },
  });
}
