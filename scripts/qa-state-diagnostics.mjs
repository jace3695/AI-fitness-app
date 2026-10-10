// This is an output boundary, not a general JSON logger. Reconstruct only known
// fixed diagnostic fields; never echo arbitrary keys, strings, or malformed data.
const choice = (value, allowed) => typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
const bit = value => typeof value === 'boolean' ? value : null;
const count = value => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
const fields = (data, names, project) => Object.fromEntries(names.map(name => [name, project(data[name])]));
const exposureValues = ['shown', 'not-shown', 'unknown'];
const guided = data => ({
  level: choice(data.level, ['beginner', 'elementary', 'intermediate']), step: count(data.step),
  phase: choice(data.phase, ['step-visible', 'exposure-ready', 'input-filled', 'save-clicked', 'saved', 'reloaded', 'send-clicked', 'sent', 'before-close', 'before-recovery', 'recovered', 'pending-close-confirmed', 'close-abandoned', 'replacement-close-clicked', 'close-clicked', 'closed', 'finished', 'checkpoint-refused']),
  checkpointKind: choice(data.checkpointKind, ['draft', 'append', 'close']),
  proof: choice(data.proof, ['invalid-envelope', 'changed-scope', 'authority-or-status', 'wrong-step', 'progress-or-editor', 'pending-kind', 'draft-transition', 'command-boundary', 'operation-identity', 'command-payload', 'unresolved-operation', 'terminal-transition', 'missing-storage', 'read-failed', 'changed-after-observation']),
  surface: choice(data.surface, ['present', 'missing', 'unavailable']),
  status: choice(data.status, ['unavailable', 'idle', 'unsaved', 'saving', 'pending', 'uncertain', 'saved']),
  ...fields(data, ['available', 'busy', 'contextCurrent', 'editorPresent', 'editorDirty', 'editorOnActiveStep', 'closedBoundary'], bit),
  errorCode: choice(data.errorCode, ['none', 'changed-before-action', 'capacity-exceeded', 'source-conflict', 'storage-unconfirmed', 'other-safe-error']),
  commandKind: choice(data.commandKind, ['none', 'append', 'close']),
  commandBoundary: choice(data.commandBoundary, ['none', 'entered', 'head-changed', 'editor-changed', 'saving-draft', 'after-save-changed', 'pre-capture-changed', 'captured', 'staged', 'applied', 'failed']),
  ...fields(data, ['stepIndex', 'submittedSteps', 'totalSteps', 'turnCount', 'draftCount'], count),
  pendingKind: choice(data.pendingKind, ['none', 'append', 'close', 'create', 'draft', 'cancel', 'delete']),
  exposure: fields(data.exposure && typeof data.exposure === 'object' ? data.exposure : {}, ['example', 'reading', 'meaning', 'hint'], value => choice(value, exposureValues)),
});
const storage = data => ({
  phase: choice(data.phase, ['editor-ready', 'first-edit', 'peer-edit', 'queued-newer-input', 'released', 'journal-injected', 'blocked-save', 'reload-blocked', 'failure']),
  tab: choice(data.tab, ['first', 'peer']),
  visibility: choice(data.visibility, ['visible', 'hidden']),
  authGate: choice(data.authGate, ['failed', 'login', 'editor', 'pending']),
  editor: choice(data.editor, ['hydrated', 'read-blocked', 'pending']),
  ...fields(data, ['hungerVisible', 'hungerDisabled', 'hungerYes', 'hungerNo', 'saveVisible', 'saveDisabled', 'recordPresent', 'savedHungerYes', 'savedHungerNo', 'savedWater500', 'waterStore500', 'legacyPresent'], bit),
  savedHunger: choice(data.savedHunger, ['absent', 'yes', 'no', 'unrecorded', 'other']),
  savedWater: choice(data.savedWater, ['absent', 'zero', '500', 'other']),
  protocolState: choice(data.protocolState, ['absent', 'prepared', 'committed', 'other']),
  probe: choice(data.probe, ['unavailable']),
  failure: choice(data.failure, ['webkit-internal', 'crash', 'timeout', 'closed-or-disconnected', 'aborted', 'connection-reset', 'other']),
});
const handwriting = data => ({
  ...fields(data, ['savePresent', 'saveDisabled', 'saveInProgress', 'materialVisible', 'storageFailure', 'draftConflict', 'recoveryFailure', 'saveUnconfirmed', 'resetFenced', 'localActive', 'hasWorksheet', 'hasRaster', 'hasPending', 'hasPendingPng', 'checksComplete', 'hasStrokes', 'paperMinutesValid', 'unavailable'], bit),
});
const handwritingSave = data => ({
  phase: choice(data.phase, ['idle', 'encoding-png', 'encoded-png', 'staging-png', 'pending-request-succeeded', 'pending-transaction-completed', 'pending-transaction-aborted']),
  ...fields(data, ['encodingRequested', 'encodingReturned', 'encodingPngValid', 'pendingPutAttempted', 'pendingPutHasBlob', 'pendingPutReturned', 'pendingRequestSucceeded', 'pendingRequestFailed', 'pendingTransactionCompleted', 'pendingTransactionAborted', 'unavailable'], bit),
  errorBoundary: choice(data.errorBoundary, ['none', 'png-call', 'pending-put', 'pending-request', 'pending-transaction']),
  errorName: choice(data.errorName, ['none', 'AbortError', 'ConstraintError', 'DataCloneError', 'DataError', 'InvalidStateError', 'NotSupportedError', 'QuotaExceededError', 'ReadOnlyError', 'TransactionInactiveError', 'UnknownError', 'other']),
});
const ownerSwitch = data => ({
  phase: choice(data.phase, ['owner-a-ready', 'holder-a-ready', 'lock-held', 'edit-queued', 'signout-clicked', 'owner-cleared', 'lock-released', 'signed-out', 'before-b-login', 'after-b-login', 'owner-b-ready', 'isolation-verified', 'before-reload', 'after-reload', 'complete']),
  tab: choice(data.tab, ['first', 'holder']), visibility: choice(data.visibility, ['visible', 'hidden']),
  authGate: choice(data.authGate, ['failed', 'login', 'editor', 'pending']),
  sync: choice(data.sync, ['synced', 'error', 'conflict', 'syncing', 'pending', 'absent']),
  ...fields(data, ['owner', 'desiredOwner', 'readyOwner', 'lastReadOwner'], value => choice(value, ['A', 'B', 'none', 'other'])),
  ...fields(data, ['failed', 'readyMatchesEpoch', 'localEmpty', 'localMatchesA', 'localMatchesB', 'editorPrivate', 'editorPresent', 'legacyPresent', 'sessionChangedNotice'], bit),
  ...fields(data, ['lockHeld', 'lockPending', 'reads', 'writes'], count),
  protocolState: choice(data.protocolState, ['absent', 'prepared', 'committed', 'other']),
  lastReadResult: choice(data.lastReadResult, ['absent', 'pending', 'ok', 'not-confirmed']),
  probe: choice(data.probe, ['unavailable']),
  failure: choice(data.failure, ['webkit-internal', 'crash', 'timeout', 'closed-or-disconnected', 'aborted', 'connection-reset', 'other']),
});
const projectors = { QA_GUIDED_BOUNDARY: guided, QA_STORAGE_PROTOCOL_STATE: storage, QA_HANDWRITING_RECOVERY_STATE: handwriting, QA_HANDWRITING_SAVE_BOUNDARY: handwritingSave, QA_OWNER_SWITCH_STATE: ownerSwitch };
export function projectStateDiagnostic(line) {
  if (typeof line !== 'string' || line.length > 8192) return null;
  const delimiter = line.indexOf(' '), prefix = line.slice(0, delimiter);
  if (!Object.hasOwn(projectors, prefix)) return null;
  let data;
  try { data = JSON.parse(line.slice(delimiter + 1)); } catch { return null; }
  if (!data || Array.isArray(data) || typeof data !== 'object') return null;
  const projected = `${prefix} ${JSON.stringify(projectors[prefix](data))}`;
  return projected.length <= 4096 ? { prefix, line: projected } : null;
}
export function stateDiagnosticCollector() {
  const emitted = Object.fromEntries(Object.keys(projectors).map(key => [key, 0]));
  const dropped = Object.fromEntries(Object.keys(projectors).map(key => [key, 0]));
  return {
    ingest(line) {
      const result = projectStateDiagnostic(line);
      if (!result) return null;
      if (emitted[result.prefix] >= 512) { dropped[result.prefix] = Math.min(10000, dropped[result.prefix] + 1); return null; }
      emitted[result.prefix]++; return result.line;
    },
    snapshot: () => ({ emitted: { ...emitted }, dropped: { ...dropped } }),
  };
}
