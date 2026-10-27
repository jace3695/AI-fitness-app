// Failure evidence is an allowlist, not a redacted exception. Never inspect or
// copy messages, stacks, snippets, causes, step titles/params or attachments.
type SafeLocation = { file: string; line: number; column: number };
export type SafeFailureDiagnostics = {
  category: 'test-error' | 'timeout' | 'interrupted';
  testDefinition?: SafeLocation;
  errors: { location?: SafeLocation }[];
  omittedErrors: number;
};

const maxErrors = 3;
const maxCoordinate = 1_000_000;
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
  return {
    category,
    ...(testDefinition ? { testDefinition } : {}),
    errors: errors.slice(0, maxErrors).map(error => {
      const at = location(record(error)?.location, root, allowedSources);
      return at && (!testDefinition || at.file === testDefinition.file) ? { location: at } : {};
    }),
    omittedErrors: Math.min(omittedErrors + Math.max(0, errors.length - maxErrors), maxCoordinate),
  };
}
