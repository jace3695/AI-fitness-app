import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const source = readFileSync(new URL('../scripts/test.mjs', import.meta.url), 'utf8');
const imports = source.match(/^import .+;$/gm);
assert.deepEqual(imports, [
  "import { readdirSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "import { spawnSync } from 'node:child_process';",
]);
const body = source.replace(/^import .+;\n/gm, '');
type SpawnResult = { status: number | null; signal?: string | null; error?: Error };

function execute(result: SpawnResult, options: { root?: string; argv?: string[]; env?: Record<string, string> } = {}) {
  const calls: { executable: string; args: string[]; options: unknown }[] = [];
  const exits: number[] = [];
  const stopped = {};
  let thrown: unknown;
  try {
    // Execute the actual runner body. Only its process boundary is replaced;
    // real directory enumeration is optionally rooted at a tiny fixture tree.
    new Function('readdirSync', 'join', 'spawnSync', 'process', body)(
      (path: string, settings: { withFileTypes: true }) => readdirSync(options.root ? join(options.root, path) : path, settings),
      join,
      (executable: string, args: string[], spawnOptions: unknown) => {
        calls.push({ executable, args, options: spawnOptions });
        return result;
      },
      { execPath: '/synthetic/node', argv: options.argv ?? [], env: options.env ?? {},
        exit(code: number) { exits.push(code); throw stopped; } },
    );
  } catch (error) { if (error !== stopped) thrown = error; }
  return { calls, exits, thrown };
}

test('actual test runner recursively admits every sorted test file with one fixed two-process limit', t => {
  const root = mkdtempSync(join(tmpdir(), 'yeoni-runner-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['app/z.test.ts', 'app/nested/a.test.ts', 'lib/z.test.ts', 'tests/a.test.ts', 'tests/nested/b.test.ts',
    'app/not-a-test.ts', 'lib/ignored.test.mjs', 'tests/ignored.spec.ts'];
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), 'synthetic'); }
  const actual = execute({ status: 0 }, { root });
  assert.equal(actual.thrown, undefined);
  assert.deepEqual(actual.exits, [0]);
  assert.deepEqual(actual.calls, [{ executable: '/synthetic/node', args: [
    '--experimental-strip-types', '--test', '--test-concurrency=2',
    'app/nested/a.test.ts', 'app/z.test.ts', 'lib/z.test.ts', 'tests/a.test.ts', 'tests/nested/b.test.ts',
  ], options: { stdio: 'inherit' } }]);
});

test('incoming arguments and environment cannot replace the runner fixed concurrency or filter discovery', () => {
  const baseline = execute({ status: 0 });
  const supplied = execute({ status: 0 }, {
    argv: ['/synthetic/node', 'scripts/test.mjs', '--test-concurrency=99', '--test-name-pattern=none', '--test-shard=1/9'],
    env: { NODE_OPTIONS: '--test-concurrency=99', TEST_CONCURRENCY: '99', CI: 'true', npm_config_test_concurrency: '99' },
  });
  assert.equal(supplied.thrown, undefined);
  assert.deepEqual(supplied.calls, baseline.calls);
  assert.deepEqual(supplied.exits, [0]);
  assert.equal(supplied.calls.length, 1);
  const args = supplied.calls[0].args;
  assert.deepEqual(args.filter(value => value.startsWith('--')), ['--experimental-strip-types', '--test', '--test-concurrency=2']);
  assert.ok(args.includes('tests/test-runner-contract.test.ts'));
  const selected = args.slice(3);
  assert.equal(new Set(selected).size, selected.length);
  assert.deepEqual(selected, [...selected].sort());
  assert.ok(selected.every(path => /^(app|lib|tests)\/.+\.test\.ts$/.test(path)));
});

test('runner propagates each child status and treats null status or signal as failure without retry', () => {
  for (const [result, expected] of [
    [{ status: 0 }, 0], [{ status: 1 }, 1], [{ status: 17 }, 17],
    [{ status: null, signal: 'SIGKILL' }, 1], [{ status: null, signal: null }, 1],
  ] as [SpawnResult, number][]) {
    const actual = execute(result);
    assert.equal(actual.thrown, undefined);
    assert.deepEqual(actual.exits, [expected]);
    assert.equal(actual.calls.length, 1);
  }
});

test('runner throws the identical spawn error and never reports a successful exit or retries', () => {
  const error = new Error('synthetic spawn failure');
  const actual = execute({ status: null, error });
  assert.equal(actual.thrown, error);
  assert.deepEqual(actual.exits, []);
  assert.equal(actual.calls.length, 1);
});
