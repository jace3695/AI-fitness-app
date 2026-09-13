import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function config(values: Record<string, string | undefined>) {
  const env = { ...process.env };
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) delete env[key];
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "const c = await import('./lib/supabase-config.ts'); console.log(JSON.stringify([c.SUPABASE_URL, c.SUPABASE_PUBLISHABLE_KEY]));"],
  { cwd: process.cwd(), env: { ...env, ...values }, encoding: 'utf8' });
}
test('browser Supabase respects the complete isolated URL and anonymous-key pair', () => {
  const result = config({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-public-key' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), ['http://127.0.0.1:54321', 'ci-public-key']);
});
test('a configured publishable key takes precedence over the legacy anon key', () => {
  const result = config({ NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'ci-publishable', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-legacy' });
  assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), ['https://fixture.invalid', 'ci-publishable']);
});
test('a partially configured project fails instead of mixing credentials with the deployed default', () => {
  for (const values of [{ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-public-key' }]) {
    const result = config(values); assert.notEqual(result.status, 0); assert.match(result.stderr, /함께 설정/);
  }
});
test('with neither override the existing deployed public configuration remains available', () => {
  const result = config({}); assert.equal(result.status, 0);
  const [url, key] = JSON.parse(result.stdout); assert.match(url, /^https:\/\/[^/]+\.supabase\.co$/); assert.match(key, /^sb_publishable_/);
});
