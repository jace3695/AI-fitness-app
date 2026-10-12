import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TestError, TestStep } from '@playwright/test/reporter';
import { failureDiagnostics } from './e2e/failure-diagnostics.ts';

const root = '/runner/work/app';
const sourceFiles = new Set(['tests/e2e/drawing.spec.ts', 'tests/e2e/drawing-tools.ts']);
const source = { file: root + '/tests/e2e/drawing.spec.ts', line: 554, column: 87 };
const secret = 'private-account-token-and-row-data';
const failure: TestError = { message: 'Timeout: ' + secret, stack: secret, snippet: secret, value: secret, location: source };
const step = (overrides: Partial<TestStep> = {}) => ({
  category: 'pw:api', error: failure, location: source, steps: [],
  title: secret, titlePath: () => [secret], params: { password: secret },
  attachments: [{ name: secret, contentType: 'text/plain', body: Buffer.from(secret) }],
  ...overrides,
} as TestStep);

test('failure evidence locates the innermost failing action without exposing runtime data', () => {
  const result = failureDiagnostics({ errors: [failure], steps: [step({ category: 'test.step', steps: [step()] })] }, root, sourceFiles);
  const location = { ...source, file: 'tests/e2e/drawing.spec.ts' };
  assert.deepEqual(result, { errors: [{ kind: 'timeout', location }], steps: [{ category: 'pw:api', kind: 'timeout', location }] });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('unapproved paths, URLs and invalid coordinates never leave failure evidence', () => {
  for (const location of [
    { ...source, file: root + '/../private/file.ts' },
    { ...source, file: 'https://private.example/token' },
    { ...source, file: root + '/tests/e2e/private-account.ts' },
    { ...source, line: -1 }, { ...source, column: 0 },
    { ...source, line: Infinity }, { ...source, column: 1.5 },
  ]) {
    const result = failureDiagnostics({ errors: [{ ...failure, location }], steps: [] }, root, sourceFiles);
    assert.deepEqual(result.errors, [{ kind: 'timeout', location: null }]);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('failure evidence bounds records and maps unknown categories to fixed labels', () => {
  const unknown = step({ category: secret, error: { message: secret } });
  const result = failureDiagnostics({ errors: Array(20).fill(failure), steps: Array(20).fill(unknown) }, root, sourceFiles);
  assert.equal(result.errors.length, 8);
  assert.equal(result.steps.length, 8);
  assert.equal(result.steps[0].category, 'other');
  assert.equal(result.steps[0].kind, 'other');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('missing locations remain unknown and successful actions are not blamed', () => {
  const result = failureDiagnostics({ errors: [{ message: 'Test timeout' }], steps: [step({ error: undefined })] }, root, sourceFiles);
  assert.deepEqual(result, { errors: [{ kind: 'timeout', location: null }], steps: [] });
  const fallback = failureDiagnostics({ errors: [], steps: [step({ location: undefined })] }, root, sourceFiles);
  assert.equal(fallback.steps[0].location?.line, source.line);
});
