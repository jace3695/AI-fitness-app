import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class ComponentReporter implements Reporter {
  private results: { title: string; project: string; status: string; durationMs: number }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    const row = { title: test.title, project: test.parent.project()?.name ?? '', status: result.status, durationMs: result.duration };
    this.results.push(row);
    // Do not emit raw assertions, DOM, audio, URLs, headers, console or attachments.
    console.log(`${row.status}: ${row.project} / ${row.title}`);
  }
  onEnd(result: FullResult) {
    mkdirSync('.e2e/component-browser/evidence', { recursive: true });
    const scope = 'Real source components and native browser; synthetic local inputs. Not Next/Auth/DB, hosted speech, physical-device or naturalness certification.';
    writeFileSync('.e2e/component-browser/evidence/results.json', JSON.stringify({ commit: process.env.QA_HEAD_SHA,
      scope, status: result.status, results: this.results }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Focused source-component browser QA\n\nCommit: \`${process.env.QA_HEAD_SHA}\`\n\nResult: **${result.status}**\n\n${scope}\n\n`
      + this.results.map(row => `- ${row.project}: ${row.status} — ${row.title}`).join('\n') + '\n');
  }
}
