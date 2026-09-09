import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// No login/link/db-push, hosted URL, project credentials, or personal backups.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP) {
  throw new Error('This launcher is for a disposable GitHub Actions runner.');
}
const workdir = resolve('.e2e/stack');
const cli = resolve('node_modules/.bin/supabase');
const run = (...args) => execFileSync(cli, [...args, '--workdir', workdir], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
});
const redact = text => String(text).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-jwt]').replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]');
try {
  if (process.argv[2] === 'stop') {
    if (existsSync(`${workdir}/supabase/config.toml`)) run('stop', '--no-backup');
    rmSync('.e2e/stack', { recursive: true, force: true });
    rmSync('.e2e/stack-status.json', { force: true });
    console.log('Disposable Supabase containers/volumes and local keys removed.');
  } else if (process.argv[2] === 'start') {
    mkdirSync(workdir, { recursive: true });
    // Discover the pinned CLI's interface on the runner before invoking it.
    run('--help'); run('init', '--help'); run('start', '--help'); run('status', '--help');
    run('init');
    copyFileSync('tests/e2e/schema.sql', `${workdir}/supabase/seed.sql`);
    console.log('Starting isolated Auth, PostgREST and Postgres…');
    run('start', '--exclude', 'studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor');
    const status = JSON.parse(run('status', '--output', 'json'));
    if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
      throw new Error('The disposable stack did not return the expected local credentials.');
    }
    writeFileSync('.e2e/stack-status.json', JSON.stringify(status), { mode: 0o600 });
    // The service-role key stays in the runner's ignored fixture file, never in
    // the Next/browser environment or uploaded reports. Public anon JWT only.
    console.log(`::add-mask::${status.ANON_KEY}`);
    console.log(`::add-mask::${status.SERVICE_ROLE_KEY}`);
    appendFileSync(process.env.GITHUB_ENV, `YEONI_E2E=1\nNEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`);
    console.log('Isolated stack ready; no hosted project was contacted.');
  } else throw new Error('Use start or stop.');
} catch (error) {
  console.error(redact(error.stderr || error.message));
  process.exitCode = 1;
}
