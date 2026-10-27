import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { failureDiagnostics, type SafeFailureDiagnostics } from './failure-diagnostics.ts';

const redact = (message: string) => message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-jwt]')
  .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
  .replace(/Qa-[0-9a-f-]+!/g, '[redacted-fixture-password]');

export default class SafeReporter implements Reporter {
  private root = process.cwd();
  private allowedSources = new Set(readdirSync(join(this.root, 'tests/e2e'), { withFileTypes: true })
    .filter(entry => entry.isFile() && /^[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/.test(entry.name))
    .slice(0, 1000).map(entry => `tests/e2e/${entry.name}`));
  private results: { title: string; status: string; durationMs: number; failure?: SafeFailureDiagnostics }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    // Only known source coordinates and fixed categories, never error content.
    const failure = failureDiagnostics(test.location, result, this.root, this.allowedSources);
    this.results.push({ title: test.titlePath().join(' / '), status: result.status, durationMs: result.duration,
      ...(failure ? { failure } : {}) });
    console.log(`${result.status}: ${test.titlePath().join(' / ')}`);
  }
  onError() { console.error('Runner error (details withheld)'); }
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
      this.results.map(row => `- ${row.status}: ${row.title} (${row.durationMs} ms)` +
        (row.failure ? ` — diagnostics: \`${JSON.stringify(row.failure)}\`` : '')).join('\n') +
      '\n\nActual Next production build + browser + disposable Supabase Auth/PostgREST/Postgres. Synthetic data only. Hosted account, actual iPhone lock/background and deployed preview upgrade are not certified by this run.\n');
  }
}
