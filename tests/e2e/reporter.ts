import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';

const redact = (message: string) => message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-jwt]')
  .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]')
  .replace(/Qa-[0-9a-f-]+!/g, '[redacted-fixture-password]');

export default class SafeReporter implements Reporter {
  private results: { title: string; status: string; durationMs: number }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    // No errors, steps, URLs, headers, attachments, passwords or storageState.
    this.results.push({ title: test.titlePath().join(' / '), status: result.status, durationMs: result.duration });
    console.log(`${result.status}: ${test.titlePath().join(' / ')}`);
    for (const error of result.errors) console.error(redact(error.message || 'Test failed'));
  }
  onError(error: TestError) { console.error(redact(error.message || 'Runner error')); }
  onStdOut(chunk: string | Buffer) { process.stdout.write(redact(String(chunk))); }
  onStdErr(chunk: string | Buffer) { process.stderr.write(redact(String(chunk))); }
  onEnd(result: FullResult) {
    mkdirSync('.e2e/evidence', { recursive: true });
    const report = { commit: process.env.QA_HEAD_SHA, status: result.status, results: this.results };
    writeFileSync('.e2e/evidence/results.json', JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Disposable browser verification\n\nCommit: \`${process.env.QA_HEAD_SHA}\`\n\nResult: **${result.status}**\n\n` +
      this.results.map(row => `- ${row.status}: ${row.title} (${row.durationMs} ms)`).join('\n') +
      '\n\nActual Next production build + browser + disposable Supabase Auth/PostgREST/Postgres. Synthetic data only. Hosted account, actual iPhone lock/background and deployed preview upgrade are not certified by this run.\n');
  }
}
