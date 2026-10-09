import { relative, resolve } from 'node:path';
import type { TestError, TestResult, TestStep } from '@playwright/test/reporter';
import { failureLabel } from './navigation-diagnostics.ts';

// Source locations and fixed categories only. Step titles/params, exception
// text, stacks, snippets and attachments can contain credentials or row data.
export function failureDiagnostics(
  result: Pick<TestResult, 'errors' | 'steps'>,
  root: string,
  sourceFiles: ReadonlySet<string>,
) {
  const location = (value: TestError['location']) => {
    if (!value) return null;
    const file = relative(root, resolve(root, value.file)).replaceAll('\\', '/');
    if (!sourceFiles.has(file) || !/^tests\/e2e\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts$/.test(file)) return null;
    if (![value.line, value.column].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000)) return null;
    return { file, line: value.line, column: value.column };
  };
  const error = (value: TestError) => ({
    kind: failureLabel(value.message ?? ''), location: location(value.location),
  });
  const steps: { category: string; kind: string; location: ReturnType<typeof location> }[] = [];
  const categories = ['expect', 'fixture', 'hook', 'pw:api', 'test.step', 'test.attach'];
  const visit = (step: TestStep, depth: number): boolean => {
    if (depth > 32 || steps.length >= 8) return false;
    // Prefer the innermost failing action to its enclosing hook/test.step.
    let childFailed = false;
    for (const child of step.steps) childFailed = visit(child, depth + 1) || childFailed;
    if (step.error && !childFailed && steps.length < 8) steps.push({
      category: categories.includes(step.category) ? step.category : 'other',
      kind: failureLabel(step.error.message ?? ''),
      location: location(step.location) ?? location(step.error.location),
    });
    return childFailed || !!step.error;
  };
  for (const step of result.steps) visit(step, 0);
  return { errors: result.errors.slice(0, 8).map(error), steps };
}
