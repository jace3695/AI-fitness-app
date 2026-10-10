import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source contracts only: no driver import, database, HTTP or subprocess execution.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = source('.github/workflows/browser-verification.yml');
const steps = workflow.split(/\n(?=      - )/);
function step(name: string) {
  const matches = steps.filter(value => value.startsWith(`      - name: ${name}\n`));
  assert.equal(matches.length, 1, `expected exactly one ${name} step`);
  return matches[0];
}

test('disposable seed installs the actual ledger once after all reset and connector dependencies', () => {
  const stack = source('scripts/e2e-stack.mjs');
  const migrations = [...stack.matchAll(/readFileSync\('(supabase\/migrations\/[^']+)'/g)].map(match => match[1]);
  const ledger = 'supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql';
  assert.equal(migrations.filter(path => path === ledger).length, 1);
  for (const dependency of [
    'supabase/migrations/20260915034857_assistant_task_command_history.sql',
    'supabase/migrations/20260915052413_chatgpt_scoped_connection.sql',
    'supabase/migrations/20260916043619_assistant_language_commands.sql',
    'supabase/migrations/20260916045546_language_history_reset_triggers.sql',
  ]) {
    assert.equal(migrations.filter(path => path === dependency).length, 1);
    assert.ok(migrations.indexOf(dependency) < migrations.indexOf(ledger), `${dependency} must precede the ledger`);
  }
  assert.ok(stack.includes("appendFileSync(`${workdir}/supabase/seed.sql`, '\\n' + readFileSync('" + ledger + "', 'utf8'));"));
  assert.ok(stack.indexOf(ledger) < stack.indexOf("run('start', '--exclude'"));
});

test('post-stack CI step invokes the authored PostgreSQL and HTTP chain with native TypeScript loading', () => {
  const start = step('Start disposable database and auth');
  const gate = step('Verify legacy evidence PostgreSQL races and HTTP roundtrip');
  const build = step('Build the isolated production app');
  assert.equal(steps.indexOf(gate), steps.indexOf(start) + 1);
  assert.ok(steps.indexOf(gate) < steps.indexOf(build));
  assert.equal(gate.trim(), '- name: Verify legacy evidence PostgreSQL races and HTTP roundtrip\n' +
    '        run: node --experimental-strip-types scripts/qa-legacy-evidence-postgres.mjs');
  assert.match(workflow, /node-version: '24\.19\.0'/);
  const driver = source('scripts/qa-legacy-evidence-postgres.mjs');
  const main = driver.slice(driver.indexOf('export async function main()'));
  assert.match(main, /report = await runPostgresHarness\(stack\);\s+const \{ runHttpHarness \} = await import\('\.\/qa-legacy-evidence-http\.mjs'\);\s+report\.http = await runHttpHarness\(\); assert\.equal\(report\.http\.status, 'passed'\)/);
  assert.match(main, /\.e2e\/evidence\/legacy-evidence-postgres\.json/);
});

test('the CI gate keeps unconditional stack cleanup and the existing synthetic-only artifact boundary', () => {
  const gate = step('Verify legacy evidence PostgreSQL races and HTTP roundtrip');
  const cleanup = step('Remove disposable database and keys');
  const artifacts = step('Publish synthetic evidence only');
  assert.ok(steps.indexOf(cleanup) > steps.indexOf(gate));
  assert.equal(cleanup.trim(), '- name: Remove disposable database and keys\n' +
    '        if: always()\n        run: node scripts/e2e-stack.mjs stop');
  assert.ok(steps.indexOf(artifacts) > steps.indexOf(cleanup));
  assert.match(artifacts, /\n        if: always\(\)\n/);
  const paths = artifacts.match(/          path: \|\n((?:            .+\n)+)/)?.[1].trim().split('\n').map(path => path.trim());
  assert.ok(paths);
  assert.ok(paths.includes('.e2e/evidence/*.json'));
  for (const path of paths) {
    assert.match(path, /^\.e2e\/evidence\/(?:\*\.json|server-navigation\.jsonl|(?:drawing-[a-z0-9-]+|pin-status-|language-live-)\*\.png)$/);
  }
});
