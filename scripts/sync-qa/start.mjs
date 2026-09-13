// Local Next development only. Uses the repository's public client configuration.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../../lib/supabase-config.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const port = Number(process.argv[2] ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024–65535');
console.log(`A: http://127.0.0.1:${port}/?qa-sync=1`);
console.log(`B: http://localhost:${port}/?qa-sync=1`);
console.log('Uses real app authentication and the configured Supabase server. Back up the account before synthetic writes.');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
