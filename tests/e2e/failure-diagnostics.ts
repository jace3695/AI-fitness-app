// Failure evidence is an allowlist, not a redacted exception. Never inspect or
// copy messages, stacks, snippets, causes, step titles/params or attachments.
type SafeLocation = { file: string; line: number; column: number };
type SafeFailedOperation = {
  location: SafeLocation;
  category: 'expect' | 'pw:api';
  durationMs: number;
};
export type SafeFailureDiagnostics = {
  category: 'test-error' | 'timeout' | 'interrupted';
  testDefinition?: SafeLocation;
  errors: { location?: SafeLocation }[];
  omittedErrors: number;
  // Native failed test.step coordinates are phases, not inferred assertion sites.
  failedSteps?: SafeLocation[];
  // Native assertion/API call sites, not error contents or inferred causes.
  failedOperations?: SafeFailedOperation[];
  stepScanTruncated?: true;
};

const maxErrors = 3;
const maxFailedSteps = 3;
const maxFailedOperations = 3;
const maxScannedSteps = 2000;
const maxCoordinate = 1_000_000;
const maxDurationMs = 1_000_000;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const boundedInteger = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maxCoordinate;

function sourceFile(value: unknown, root: string, allowedSources: ReadonlySet<string>): string | undefined {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return;
  const file = value.replaceAll('\\', '/');
  const base = root.replaceAll('\\', '/').replace(/\/$/, '');
  // Reject traversal before normalization, URL/file schemes and UNC paths.
  if (file.split('/').some(part => part === '.' || part === '..') || file.includes('://') || file.startsWith('//')) return;
  const relative = file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  if (!/^tests\/e2e\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/.test(relative) || !allowedSources.has(relative)) return;
  return relative;
}

function location(value: unknown, root: string, allowedSources: ReadonlySet<string>): SafeLocation | undefined {
  const input = record(value);
  if (!input) return;
  const file = sourceFile(input.file, root, allowedSources);
  if (!file || !boundedInteger(input.line, 1) || !boundedInteger(input.column, 1)) return;
  return { file, line: input.line, column: input.column };
}

function operation(category: unknown, durationMs: unknown, at: SafeLocation | undefined,
  testFile: string | undefined): SafeFailedOperation | undefined {
  if ((category !== 'expect' && category !== 'pw:api') || !at || at.file !== testFile
    || typeof durationMs !== 'number' || !Number.isInteger(durationMs)
    || durationMs < 0 || durationMs > maxDurationMs) return;
  return { location: at, category, durationMs };
}

// TestResult.steps and TestStep.{category,error,location,duration,steps} are public
// Playwright reporter fields. Walk only those fields, never step titles/params
// or error contents. Literal test.step wrappers retain a spec-owned phase when
// an inner helper's native error location is absent or outside the allowlist.
function failedStepEvidence(value: unknown, testFile: string | undefined, root: string,
  allowedSources: ReadonlySet<string>): Pick<SafeFailureDiagnostics, 'failedSteps' | 'failedOperations' | 'stepScanTruncated'> {
  if (!Array.isArray(value) || !testFile) return {};
  const frames = [{ items: value, next: 0 }];
  const seen = new Set<object>();
  const failedSteps: SafeLocation[] = [];
  const failedOperations: SafeFailedOperation[] = [];
  let scanned = 0;
  let truncated = false;
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.next >= frame.items.length) { frames.pop(); continue; }
    if (scanned++ === maxScannedSteps) { truncated = true; break; }
    const step = record(frame.items[frame.next++]);
    if (!step || seen.has(step)) continue;
    seen.add(step);
    const category = step.category;
    if ((category === 'test.step' || category === 'expect' || category === 'pw:api') && record(step.error)) {
      const at = location(step.location, root, allowedSources);
      if (category === 'test.step' && at?.file === testFile) {
        if (failedSteps.length < maxFailedSteps) failedSteps.push(at);
        else truncated = true;
      } else if (category === 'expect' || category === 'pw:api') {
        const safe = operation(category, step.duration, at, testFile);
        if (safe) {
          if (failedOperations.length < maxFailedOperations) failedOperations.push(safe);
          else truncated = true;
        }
      }
    }
    if (Array.isArray(step.steps)) frames.push({ items: step.steps, next: 0 });
  }
  return { ...(failedSteps.length ? { failedSteps } : {}),
    ...(failedOperations.length ? { failedOperations } : {}), ...(truncated ? { stepScanTruncated: true } : {}) };
}

/** Native TestError.location is the failure site; TestCase.location is only the definition. */
export function failureDiagnostics(testLocation: unknown, result: unknown, root: string,
  allowedSources: ReadonlySet<string>): SafeFailureDiagnostics | undefined {
  const input = record(result);
  const category = input?.status === 'failed' ? 'test-error' : input?.status === 'timedOut' ? 'timeout'
    : input?.status === 'interrupted' ? 'interrupted' : undefined;
  if (!category || !input) return;
  const testFile = sourceFile(record(testLocation)?.file, root, allowedSources);
  const testDefinition = location(testLocation, root, allowedSources);
  const errors = Array.isArray(input.errors) ? input.errors : [];
  return {
    category,
    ...(testDefinition ? { testDefinition } : {}),
    errors: errors.slice(0, maxErrors).map(error => {
      const at = location(record(error)?.location, root, allowedSources);
      return at && at.file === testFile ? { location: at } : {};
    }),
    omittedErrors: Math.min(Math.max(0, errors.length - maxErrors), maxCoordinate),
    ...failedStepEvidence(input.steps, testFile, root, allowedSources),
  };
}

/** Revalidate persisted JSON before logging; never spread untrusted fields. */
export function storedFailureDiagnostics(value: unknown, root: string,
  allowedSources: ReadonlySet<string>): SafeFailureDiagnostics | undefined {
  const input = record(value);
  if (!input || typeof input.category !== 'string' || !['test-error', 'timeout', 'interrupted'].includes(input.category)) return;
  const category = input.category as SafeFailureDiagnostics['category'];
  const testDefinition = location(input.testDefinition, root, allowedSources);
  const errors = Array.isArray(input.errors) ? input.errors : [];
  const omittedErrors = boundedInteger(input.omittedErrors, 0) ? input.omittedErrors : 0;
  const steps = Array.isArray(input.failedSteps) ? input.failedSteps : [];
  const failedSteps = steps.slice(0, maxFailedSteps).flatMap(value => {
    const at = location(value, root, allowedSources);
    return at && at.file === testDefinition?.file ? [at] : [];
  });
  const operations = Array.isArray(input.failedOperations) ? input.failedOperations : [];
  const failedOperations = operations.slice(0, maxFailedOperations).flatMap(value => {
    const item = record(value);
    if (!item) return [];
    const safe = operation(item.category, item.durationMs, location(item.location, root, allowedSources), testDefinition?.file);
    return safe ? [safe] : [];
  });
  return {
    category,
    ...(testDefinition ? { testDefinition } : {}),
    errors: errors.slice(0, maxErrors).map(error => {
      const at = location(record(error)?.location, root, allowedSources);
      return at && (!testDefinition || at.file === testDefinition.file) ? { location: at } : {};
    }),
    omittedErrors: Math.min(omittedErrors + Math.max(0, errors.length - maxErrors), maxCoordinate),
    ...(failedSteps.length ? { failedSteps } : {}),
    ...(failedOperations.length ? { failedOperations } : {}),
    ...(input.stepScanTruncated === true || steps.length > maxFailedSteps || operations.length > maxFailedOperations
      ? { stepScanTruncated: true } : {}),
  };
}
