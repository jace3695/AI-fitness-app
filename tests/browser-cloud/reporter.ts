import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

type Phase = { phase: string; status: 'passed' | 'failed' };
export default class ComponentReporter implements Reporter {
  private phases = new Map<string, Phase[]>();
  private results: { title: string; project: string; status: string; durationMs: number; phases: Phase[] }[] = [];
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    // Fixed QA enums only: never serialize raw errors, titles from the DOM, or coordinates/data.
    if (!/^(?:component-evidence\/final-capture|b3-reflow\/(?:idle|draft)\/(?:320|390)\/(?:16|32)\/(?:checks|full-page-capture|date-closeup))$/.test(step.title)) return;
    const phases = this.phases.get(test.id) ?? [];
    phases.push({ phase: step.title, status: step.error ? 'failed' : 'passed' });
    this.phases.set(test.id, phases.slice(-32));
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const row = { title: test.title, project: test.parent.project()?.name ?? '', status: result.status, durationMs: result.duration, phases: this.phases.get(test.id) ?? [] };
    this.phases.delete(test.id);
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
