import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { failureDiagnostics } from './failure-diagnostics.ts';

const redact = (message: string) => message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-jwt]')
  .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
  .replace(/Qa-[0-9a-f-]+!/g, '[redacted-fixture-password]');

export default class SafeReporter implements Reporter {
  private readonly root = process.cwd();
  private readonly sourceFiles = new Set(readdirSync('tests/e2e').map(name => `tests/e2e/${name}`));
  private results: { title: string; status: string; durationMs: number; failure?: ReturnType<typeof failureDiagnostics> }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    // Never export raw errors or steps. Failed actions retain only allowlisted
    // source locations and fixed categories, also visible through qa-playwright.
    const failure = result.status === 'passed' || result.status === 'skipped' ? undefined
      : failureDiagnostics(result, this.root, this.sourceFiles);
    this.results.push({ title: test.titlePath().join(' / '), status: result.status, durationMs: result.duration, failure });
    console.log(`${result.status}: ${test.titlePath().join(' / ')}`);
    if (failure) console.log('QA_FAILURE_LOCATION ' + JSON.stringify(failure));
  }
  onError(error: TestError) {
    console.error('QA_RUNNER_FAILURE ' + JSON.stringify(failureDiagnostics({ errors: [error], steps: [] }, this.root, this.sourceFiles)));
  }
  onStdOut(chunk: string | Buffer) { process.stdout.write(redact(String(chunk))); }
  onStdErr(chunk: string | Buffer) { process.stderr.write(redact(String(chunk))); }
  onEnd(result: FullResult) {
    mkdirSync('.e2e/evidence', { recursive: true });
    const report = { commit: process.env.QA_HEAD_SHA, status: result.status, results: this.results };
    writeFileSync('.e2e/evidence/results.json', JSON.stringify(report, null, 2));
    // Each targeted invocation used to overwrite the preceding summary. Keep
    // every invocation as well as the final results.json for exact accounting.
    writeFileSync(`.e2e/evidence/results-${Date.now()}-${process.pid}.json`, JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Disposable browser verification\n\nCommit: \`${process.env.QA_HEAD_SHA}\`\n\nResult: **${result.status}**\n\n` +
      this.results.map(row => `- ${row.status}: ${row.title} (${row.durationMs} ms)`).join('\n') +
      '\n\nActual Next production build + browser + disposable Supabase Auth/PostgREST/Postgres. Synthetic data only. Hosted account, actual iPhone lock/background and deployed preview upgrade are not certified by this run.\n');
  }
}
