import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== 'development' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return new Response(null, { status: 404 });
  }
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  const allowedOrigins = [`http://127.0.0.1:${url.port}`, `http://localhost:${url.port}`];
  if (!origin || !allowedOrigins.includes(origin) || origin !== `http://${host}` || request.headers.get('x-yeoni-qa') !== '1' ||
      request.headers.get('content-type') !== 'application/json') {
    return new Response(null, { status: 403 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) return new Response(null, { status: 413 });
  let data;
  try { data = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (data?.format !== 'yeoni-sync-qa-v1' || !Array.isArray(data.entries)) return new Response(null, { status: 400 });
  const directory = join(process.cwd(), 'scripts', 'sync-qa', 'private');
  const name = `capture-${Date.now()}-${randomUUID()}.json`;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), raw, { flag: 'wx', mode: 0o600 });
  return Response.json({ file: `scripts/sync-qa/private/${name}` });
}
