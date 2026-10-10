import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : path.endsWith('.test.ts') ? [path] : [];
  });
}

// Bound independent file processes: SQL/VM fixtures can exceed 1 GiB each.
// Test bodies keep their own concurrency, races, assertions and timeouts.
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=2', ...['app', 'lib', 'tests'].flatMap(discover).sort()], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
