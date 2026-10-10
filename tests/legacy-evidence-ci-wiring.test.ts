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

test('disposable seed installs the actual ledger and additive enrollment once after all reset and connector dependencies', () => {
  const stack = source('scripts/e2e-stack.mjs');
  const migrations = [...stack.matchAll(/readFileSync\('(supabase\/migrations\/[^']+)'/g)].map(match => match[1]);
  const ledger = 'supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql';
  const enrollment = 'supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql';
  assert.equal(migrations.filter(path => path === ledger).length, 1);
  assert.equal(migrations.filter(path => path === enrollment).length, 1);
  assert.ok(migrations.indexOf(ledger) < migrations.indexOf(enrollment));
  for (const dependency of [
    'supabase/migrations/20260915034857_assistant_task_command_history.sql',
    'supabase/migrations/20260915052413_chatgpt_scoped_connection.sql',
    'supabase/migrations/20260916043619_assistant_language_commands.sql',
    'supabase/migrations/20260916045546_language_history_reset_triggers.sql',
  ]) {
    assert.equal(migrations.filter(path => path === dependency).length, 1);
    assert.ok(migrations.indexOf(dependency) < migrations.indexOf(ledger), `${dependency} must precede the ledger`);
  }
  const guardedBuilder = "appendFileSync(`${workdir}/supabase/seed.sql`, '\\n' + buildLegacyEvidenceInstallationFixture(\n" +
    "      readFileSync('" + ledger + "', 'utf8'),\n" +
    "      readFileSync('" + enrollment + "', 'utf8'), 'deferred-owner-stage'));";
  assert.equal(stack.split(guardedBuilder).length, 2);
  assert.ok(stack.indexOf("process.env.GITHUB_ACTIONS !== 'true'") < stack.indexOf(guardedBuilder));
  assert.ok(stack.indexOf("process.argv[2] === 'start'") < stack.indexOf(guardedBuilder));
  assert.match(stack, /import \{ buildLegacyEvidenceInstallationFixture \} from '\.\/legacy-evidence-installation-fixture\.mjs'/);
  assert.ok(stack.indexOf(enrollment) < stack.indexOf("run('start', '--exclude'"));
  assert.doesNotMatch(stack, /grant execute on function.*legacy_evidence|DISPOSABLE_EVIDENCE_RELEASE|enrollmentEnabled|captureEnabled/);
  const owner = stack.indexOf('provisionDisposableAuthUsage(verifyDisposableStack())');
  assert.ok(owner > stack.indexOf("writeFileSync('.e2e/stack-status.json'"));
  assert.ok(owner < stack.indexOf('appendFileSync(process.env.GITHUB_ENV'));
  assert.ok(owner < stack.indexOf("console.log('Isolated stack ready"));
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
  assert.match(main, /report = await diagnostics\.run\('postgres', 'execute', \(\) => runPostgresHarness\(stack, diagnostics\)\)/);
  assert.match(main, /await diagnostics\.run\('http', 'execute', async \(\) => \{\s+const \{ runHttpHarness \} = await import\('\.\/qa-legacy-evidence-http\.mjs'\);\s+report\.http = await runHttpHarness\(diagnostics\); assert\.equal\(report\.http\.status, 'passed'\)/);
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

// The focused workflow is additive. All general-workflow contracts above remain.
const b2Workflow = source('.github/workflows/legacy-evidence-browser.yml');
const b2Steps = b2Workflow.slice(b2Workflow.indexOf('    steps:\n')).split(/\n(?=      - )/);
function b2Step(name: string) {
  const matches = b2Steps.filter(value => value.startsWith(`      - name: ${name}\n`));
  assert.equal(matches.length, 1, `expected exactly one B2 ${name} step`);
  return matches[0];
}

test('B2 has an independent non-canceling bounded job and exact source triggers', () => {
  assert.match(b2Workflow, /\non:\n  pull_request:\n    types: \[opened, synchronize, reopened\]\n    paths:\n/);
  assert.match(b2Workflow, /\n  workflow_dispatch:\n/);
  assert.doesNotMatch(b2Workflow, /pull_request_target|\n  push:|schedule:|workflow_run:/);
  assert.match(b2Workflow, /permissions:\n  contents: read\n/);
  assert.match(b2Workflow, /group: legacy-evidence-b2-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: false/);
  assert.match(b2Workflow, /jobs:\n  legacy-evidence-b2:\n    runs-on: ubuntu-24\.04\n    timeout-minutes: 75\n/);
  assert.match(workflow, /timeout-minutes: 210/);
  assert.match(workflow, /group: browser-qa-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true/);
  assert.match(b2Workflow, /QA_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  const pathSection = b2Workflow.match(/    paths:\n([\s\S]*?)  workflow_dispatch:/)?.[1];
  assert.ok(pathSection);
  const paths = [...pathSection.matchAll(/^      - '([^']+)'$/gm)].map(match => match[1]);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(paths, [...paths].sort());
  for (const path of paths) assert.match(path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$|^(?:package(?:-lock)?\.json|playwright(?:\.legacy-evidence)?\.config\.ts|next\.config\.mjs|tsconfig\.json)$/);
  const driver = source('scripts/qa-legacy-evidence-postgres.mjs');
  const inputs = driver.slice(driver.indexOf('export const SOURCE_INPUTS'), driver.indexOf('].sort());'));
  for (const match of inputs.matchAll(/'([^']+)'/g)) assert.ok(paths.includes(match[1]), `missing B2 source trigger ${match[1]}`);
  for (const path of [
    '.github/workflows/legacy-evidence-browser.yml', 'scripts/qa-legacy-evidence-browser.mjs',
    'scripts/legacy-evidence-b2-build-inputs.json', 'playwright.legacy-evidence.config.ts',
    'tests/e2e/legacy-evidence-review.spec.ts', 'tests/legacy-evidence-browser-harness.test.ts',
    'tests/e2e/auth.spec.ts', 'tests/e2e/fixture.ts', 'tests/e2e/reporter.ts',
    'supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql',
    'supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql',
  ]) assert.ok(paths.includes(path), path);
});

test('B2 absolute deadline starts before checkout and all setup with a fixed cleanup reserve', () => {
  const budget = b2Step('Anchor the absolute validation and cleanup budget');
  assert.equal(b2Steps.indexOf(budget), 1);
  assert.equal(budget.trim(), '- name: Anchor the absolute validation and cleanup budget\n' +
    '        shell: bash\n' +
    '        run: |\n' +
    '          started="$(date +%s%3N)"\n' +
    '          deadline="$((started + 75 * 60 * 1000))"\n' +
    '          stop_at="$((deadline - 15 * 60 * 1000))"\n' +
    '          printf \'B2_JOB_STARTED_MS=%s\\nB2_JOB_DEADLINE_MS=%s\\nB2_STOP_AT_MS=%s\\n\' "$started" "$deadline" "$stop_at" >> "$GITHUB_ENV"');
  for (const name of ['B2_JOB_STARTED_MS', 'B2_JOB_DEADLINE_MS', 'B2_STOP_AT_MS']) {
    assert.equal(b2Workflow.split(`${name}=`).length, 2, `${name} must never be reset by a later step`);
  }
  assert.ok(b2Workflow.indexOf('name: Anchor the absolute') < b2Workflow.indexOf('uses: actions/checkout@'));
  assert.ok(b2Workflow.indexOf('name: Anchor the absolute') < b2Workflow.indexOf('name: Install locked app dependencies'));
});

function runBody(value: string) {
  const match = value.match(/\n        run: ([^\n]+)(?:\n([\s\S]*))?$/);
  assert.ok(match, 'expected a fixed run step');
  if (match[1] !== '|') return match[1];
  return (match[2] ?? '').trimEnd().split('\n').map(line => {
    assert.ok(line.startsWith('          ')); return line.slice(10);
  }).join('\n');
}
const setupNames = [
  'Install locked app dependencies', 'Install locked browser QA dependencies',
  'Verify pure B2 harness and source wiring', 'Install real browsers',
  'Build fixed library for isolated browser comparison', 'Start disposable database and auth',
  'Validate inactive and disposable enabled browser artifacts',
];
const timestampGuard = [
  '[[ "$B2_JOB_STARTED_MS" =~ ^[1-9][0-9]{12}$ && "$B2_JOB_DEADLINE_MS" =~ ^[1-9][0-9]{12}$ && "$B2_STOP_AT_MS" =~ ^[1-9][0-9]{12}$ ]]',
  'now="$(date +%s%3N)"',
  '[[ "$now" =~ ^[1-9][0-9]{12}$ ]]',
  'test "$now" -ge "$B2_JOB_STARTED_MS"',
  'test "$B2_JOB_DEADLINE_MS" -eq "$((B2_JOB_STARTED_MS + 75 * 60 * 1000))"',
  'test "$B2_STOP_AT_MS" -eq "$((B2_JOB_DEADLINE_MS - 15 * 60 * 1000))"',
].join('\n');
const timeoutLaunch = 'timeout --signal=TERM --kill-after=10s "${remaining}s" bash --noprofile --norc -e -o pipefail <<\'B2_FIXED_SETUP\'';
function fixedSetupRecipe(name: string) {
  const value = b2Step(name), body = runBody(value);
  assert.match(value, /\n        shell: bash\n/);
  const prefix = timestampGuard + '\n' +
    'remaining="$(((B2_STOP_AT_MS - now) / 1000 - 15))"\n' +
    'test "$remaining" -gt 0 || { echo \'B2 work budget exhausted.\'; exit 1; }\n' + timeoutLaunch + '\n';
  assert.ok(body.startsWith(prefix), `${name} must validate and enforce the original absolute cutoff`);
  assert.ok(body.endsWith('\nB2_FIXED_SETUP'));
  assert.doesNotMatch(value, /continue-on-error|--foreground|--preserve-status|working-directory:|\$@|\$\*/);
  return body.slice(prefix.length, -'\nB2_FIXED_SETUP'.length);
}

test('B2 fixed setup wrappers preserve every pinned recipe and pure preflight command', () => {
  const generalCheckout = steps.find(value => value.startsWith('      - uses: actions/checkout@'));
  const generalNode = steps.find(value => value.startsWith('      - uses: actions/setup-node@'));
  const checkout = b2Steps.find(value => value.startsWith('      - uses: actions/checkout@'));
  const node = b2Steps.find(value => value.startsWith('      - uses: actions/setup-node@'));
  assert.ok(generalCheckout && generalNode && checkout && node);
  for (const [actual, original] of [[checkout, generalCheckout], [node, generalNode], [b2Step('Checkout official libsoup 3.6.6 source'), step('Checkout official libsoup 3.6.6 source')]]) {
    assert.match(actual, /\n        timeout-minutes: 5\n/);
    assert.equal(actual.replace('        timeout-minutes: 5\n', ''), original);
  }
  // Initial pinned actions each have a five-minute ceiling, directly after the
  // budget anchor, so neither can consume the sixty-minute working allowance.
  assert.equal(b2Steps.indexOf(checkout), 2); assert.equal(b2Steps.indexOf(node), 3);
  assert.equal(fixedSetupRecipe('Install locked app dependencies'), 'npm ci');
  assert.equal(fixedSetupRecipe('Install locked browser QA dependencies'), 'npm --prefix scripts/browser-qa ci --ignore-scripts');
  for (const name of ['Install real browsers', 'Build fixed library for isolated browser comparison', 'Start disposable database and auth']) {
    assert.equal(fixedSetupRecipe(name), runBody(step(name)));
  }
  assert.equal(fixedSetupRecipe('Verify pure B2 harness and source wiring'),
    'node --experimental-strip-types --test tests/legacy-evidence-browser-harness.test.ts tests/legacy-evidence-ci-wiring.test.ts');
  const preflight = b2Step('Verify pure B2 harness and source wiring');
  assert.ok(b2Steps.indexOf(preflight) < b2Steps.indexOf(b2Step('Install real browsers')));
  assert.ok(b2Steps.indexOf(preflight) < b2Steps.indexOf(b2Step('Start disposable database and auth')));
  assert.match(b2Workflow, /QA_SOUP_VARIANT: fixed/);
  assert.doesNotMatch(b2Workflow, /(?:run: |^          )(?:npm test|npm run build|node scripts\/qa-playwright\.mjs)|--repeat-each|--retries|--workers|--shard|--no-deps/m);
});

test('B2 setup and main runner refuse at the cutoff with TERM plus KILL grace inside it', () => {
  // Read the actual fixed shell arithmetic/flags. This pure model launches no
  // shell, child, installation, server or database while checking its branches.
  for (const name of setupNames) {
    fixedSetupRecipe(name);
    const body = runBody(b2Step(name));
    const arithmetic = body.match(/remaining="\$\(\(\(B2_STOP_AT_MS - now\) \/ (\d+) - (\d+)\)\)"/);
    const kill = body.match(/timeout --signal=TERM --kill-after=(\d+)s/);
    assert.ok(arithmetic && kill);
    const divisor = Number(arithmetic[1]), reserveSeconds = Number(arithmetic[2]), killSeconds = Number(kill[1]);
    const decide = (stop: number, now: number) => {
      const seconds = Math.trunc((stop - now) / divisor) - reserveSeconds;
      return { starts: seconds > 0, seconds, forcedExitBy: now + (seconds + killSeconds) * 1000 };
    };
    const stop = 1_900_000_000_000;
    for (const left of [-1000, 0, 1, 9999, 14999, 15000, 15999]) {
      assert.equal(decide(stop, stop - left).starts, false, `${name} must refuse with ${left}ms remaining`);
    }
    for (const left of [16000, 16001, 59999, 300000, 3_000_000]) {
      const result = decide(stop, stop - left);
      assert.equal(result.starts, true); assert.ok(result.seconds > 0);
      assert.ok(result.forcedExitBy <= stop - 5000, `${name} must keep KILL and transition grace before cutoff`);
    }
  }
});

test('B2 later checkout reserves its entire action ceiling before starting', () => {
  const guard = b2Step('Reserve the complete libsoup checkout allowance');
  const checkout = b2Step('Checkout official libsoup 3.6.6 source');
  assert.equal(b2Steps.indexOf(checkout), b2Steps.indexOf(guard) + 1);
  assert.match(guard, /\n        shell: bash\n/);
  const body = runBody(guard);
  assert.ok(body.startsWith(timestampGuard + '\n'));
  const allowance = body.match(/test "\$\(\(B2_STOP_AT_MS - now\)\)" -ge "\$\(\((\d+) \* 60 \* 1000 \+ (\d+) \* 1000\)\)" \|\| \{ echo 'B2 action budget exhausted\.'; exit 1; \}/);
  assert.ok(allowance);
  const actionMinutes = Number(checkout.match(/timeout-minutes: (\d+)/)?.[1]);
  assert.equal(Number(allowance[1]), actionMinutes);
  const required = Number(allowance[1]) * 60_000 + Number(allowance[2]) * 1000;
  assert.equal(required, 315_000);
  for (const remaining of [-1, 0, 15_000, 300_000, 314_999]) assert.equal(remaining >= required, false);
  assert.equal(required >= required, true);
  assert.ok(required - actionMinutes * 60_000 >= 15_000);
});

test('B2 invokes one owned orchestrator after stack readiness and never duplicates activation', () => {
  const start = b2Step('Start disposable database and auth');
  const run = b2Step('Validate inactive and disposable enabled browser artifacts');
  assert.equal(b2Steps.indexOf(run), b2Steps.indexOf(start) + 1);
  assert.equal(fixedSetupRecipe('Validate inactive and disposable enabled browser artifacts'),
    'node --experimental-strip-types scripts/qa-legacy-evidence-browser.mjs run');
  assert.equal(b2Workflow.split('          node --experimental-strip-types scripts/qa-legacy-evidence-browser.mjs run\n').length, 2);
  assert.doesNotMatch(b2Workflow, /run:.*qa-legacy-evidence-postgres|run:.*legacy-evidence-activation-fixture|run:.*qa-legacy-evidence-http/);
  assert.doesNotMatch(b2Workflow, /VERCEL|SUPABASE_ACCESS_TOKEN|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|captureEnabled|enrollmentEnabled/);
});

test('B2 unconditional cleanup binds the existing stack-stop result before artifact publication', () => {
  const run = b2Step('Validate inactive and disposable enabled browser artifacts');
  const cleanup = b2Step('Remove owned B2 processes and private artifacts');
  const stack = b2Step('Remove disposable database and keys');
  const artifacts = b2Step('Publish sanitized B2 evidence only');
  assert.equal(b2Steps.indexOf(cleanup), b2Steps.indexOf(run) + 1);
  assert.equal(b2Steps.indexOf(stack), b2Steps.indexOf(cleanup) + 1);
  assert.equal(b2Steps.indexOf(artifacts), b2Steps.indexOf(stack) + 1);
  assert.match(cleanup, /^      - name: Remove owned B2 processes and private artifacts\n        if: always\(\)\n        timeout-minutes: 5\n        shell: bash\n        run: \|\n/);
  assert.ok(runBody(cleanup).startsWith(timestampGuard + '\n'));
  assert.equal(stack.trim(), '- name: Remove disposable database and keys\n' +
    '        if: always()\n        run: |\n' +
    '          set +e\n' +
    '          node scripts/e2e-stack.mjs stop\n' +
    '          status=$?\n' +
    '          B2_STACK_STOP_EXIT="$status" node scripts/qa-legacy-evidence-browser.mjs finalize\n' +
    '          finalized=$?\n' +
    '          test "$status" -eq 0 && test "$finalized" -eq 0');
  assert.equal(b2Workflow.split('node scripts/e2e-stack.mjs stop').length, 2);
  assert.doesNotMatch(cleanup + stack, /rm -rf|pkill|killall|docker.*(?:prune|rm)/);
});

test('B2 failed or cutoff setup or main runner still reaches both bounded cleanup stages', () => {
  const owned = b2Step('Remove owned B2 processes and private artifacts');
  const stack = b2Step('Remove disposable database and keys');
  const cleanupNames = ['Remove owned B2 processes and private artifacts', 'Remove disposable database and keys'];
  assert.doesNotMatch(stack, /B2_STOP_AT_MS|remaining=|B2_FIXED_SETUP/);
  assert.doesNotMatch(owned, /B2_FIXED_SETUP|B2 work budget exhausted/);
  const body = runBody(owned);
  assert.ok(body.startsWith(timestampGuard + '\n'));
  assert.match(body, /remaining="\$\(\(\(B2_STOP_AT_MS \+ 5 \* 60 \* 1000 - 45 \* 1000 - now\) \/ 1000 - 15\)\)"/);
  assert.match(body, /if test "\$remaining" -gt 0; then\n  if test "\$remaining" -gt 240; then remaining=240; fi\n  timeout --signal=TERM --kill-after=10s "\$\{remaining\}s" node --experimental-strip-types scripts\/qa-legacy-evidence-browser\.mjs cleanup\nelse\n/);
  assert.match(body, /  set \+e\n  timeout --signal=TERM --kill-after=5s 5s node --experimental-strip-types scripts\/qa-legacy-evidence-browser\.mjs cleanup\n  exit 1\nfi$/);
  assert.match(source('scripts/e2e-stack.mjs'), /timeout: 600_000/);
  const setupIndexes = b2Steps.map((value, index) => ({ value, index })).filter(({ value }) =>
    setupNames.some(name => value.startsWith(`      - name: ${name}\n`)) ||
    value.startsWith('      - uses:') || value.startsWith('      - name: Reserve the complete libsoup checkout allowance\n') ||
    value.startsWith('      - name: Checkout official libsoup 3.6.6 source\n'));
  for (const failedAt of setupIndexes) {
    // GitHub's default success gate skips later work after any failed setup;
    // explicitly always() stages remain eligible even if owned cleanup fails.
    let failed = false;
    const visited: string[] = [];
    for (let index = 1; index < b2Steps.length; index++) {
      const value = b2Steps[index];
      const always = /\n        if: always\(\)\n/.test(value);
      if (failed && !always) continue;
      const name = value.match(/^      - name: (.+)/)?.[1];
      if (name) visited.push(name);
      if (index === failedAt.index || value === owned) failed = true;
    }
    for (const name of cleanupNames) assert.ok(visited.includes(name), `cleanup not reachable after ${failedAt.value.split('\n')[0]}`);
    assert.ok(visited.indexOf(cleanupNames[0]) < visited.indexOf(cleanupNames[1]));
  }
});

test('B2 owned cleanup shares the original shutdown window and never resets it', () => {
  const body = runBody(b2Step('Remove owned B2 processes and private artifacts'));
  // Project the literal shell arithmetic and limits, never invoke the cleanup.
  const arithmetic = body.match(/remaining="\$\(\(\(B2_STOP_AT_MS \+ (\d+) \* 60 \* 1000 - (\d+) \* 1000 - now\) \/ (\d+) - (\d+)\)\)"/);
  const cap = body.match(/if test "\$remaining" -gt (\d+); then remaining=(\d+); fi/);
  const kill = body.match(/timeout --signal=TERM --kill-after=(\d+)s "\$\{remaining\}s"/);
  const emergency = body.match(/timeout --signal=TERM --kill-after=(\d+)s (\d+)s node/);
  assert.ok(arithmetic && cap && kill && emergency); assert.equal(cap[1], cap[2]);
  const stop = 1_900_000_000_000;
  const cutoff = stop + Number(arithmetic[1]) * 60_000 - Number(arithmetic[2]) * 1000;
  const decide = (now: number) => {
    const seconds = Math.trunc((cutoff - now) / Number(arithmetic[3])) - Number(arithmetic[4]);
    return seconds > 0
      ? { emergency: false, statusMayPass: true, seconds: Math.min(seconds, Number(cap[1])), killSeconds: Number(kill[1]) }
      : { emergency: true, statusMayPass: false, seconds: Number(emergency[2]), killSeconds: Number(emergency[1]) };
  };
  assert.equal(cutoff, stop + 255_000);
  assert.equal(decide(stop).seconds, 240);
  assert.equal(decide(stop + 60_000).seconds, 180);
  assert.equal(decide(stop + 200_000).seconds, 40);
  for (const now of [stop, stop + 60_000, stop + 200_000, cutoff - 16_000]) {
    const selected = decide(now); assert.equal(selected.emergency, false);
    assert.ok(now + (selected.seconds + selected.killSeconds) * 1000 <= cutoff - 5000);
  }
  for (const now of [cutoff - 15_999, cutoff, cutoff + 60_000]) {
    const selected = decide(now); assert.equal(selected.emergency, true);
    assert.equal(selected.statusMayPass, false); assert.equal(selected.seconds + selected.killSeconds, 10);
  }
  // A late cleanup call cannot receive a fresh five-minute allowance. The normal
  // bound leaves the fixed ten-minute stack stop and finalizer/report margin.
  assert.ok(cutoff + 600_000 <= stop + 15 * 60_000 - 45_000);
});

test('B2 upload is an exact two-report JSON allowlist with unchanged short retention', () => {
  const artifacts = b2Step('Publish sanitized B2 evidence only');
  assert.match(artifacts, /\n        if: always\(\)\n/);
  assert.match(artifacts, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/);
  assert.match(artifacts, /name: legacy-evidence-b2-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  const paths = artifacts.match(/          path: \|\n((?:            .+\n)+)/)?.[1].trim().split('\n').map(path => path.trim());
  assert.deepEqual(paths, [
    '.e2e/evidence/legacy-evidence-b2-results.json',
    '.e2e/evidence/legacy-evidence-postgres.json',
  ]);
  assert.match(artifacts, /include-hidden-files: true\n          if-no-files-found: warn\n          retention-days: 7/);
  assert.equal((b2Workflow.match(/uses: actions\/upload-artifact@/g) ?? []).length, 1);
});
