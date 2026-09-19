// Loopback-only browser/React/HTTP lab. Never reads .env or personal backups.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(resolve(root, 'package.json'));
const postcss = require('postcss');
const tailwind = require('tailwindcss');
mkdirSync(resolve(here, '.generated'), { recursive: true });
await build({ entryPoints: [resolve(here, 'browser.tsx')], bundle: true,
  outfile: resolve(here, '.generated/app.js'), jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'fixture-transport', setup(b) {
    b.onResolve({ filter: /(^|\/)supabase(\.ts)?$/ }, () => ({ path: resolve(here, 'client.ts') }));
  } }], tsconfig: resolve(root, 'tsconfig.json') });
const css = await postcss([tailwind({ config: resolve(root, 'tailwind.config.ts'), content: [resolve(root, 'app/**/*.{ts,tsx}'), resolve(root, 'components/**/*.{ts,tsx}')] })])
  .process(readFileSync(resolve(root, 'app/globals.css'), 'utf8'), { from: resolve(root, 'app/globals.css') });
writeFileSync(resolve(here, '.generated/app.css'), css.css);
const fixture = {
  'ai-fitness-workout-completed-days': Object.fromEntries([1, 2, 3, 4].map(d => [`2026-09-0${d}`, { workoutDone: true, workoutStatus: 'completed', workoutMemo: `fixture-original-${d}` }])),
  'ai-fitness-user-workout-settings': { weeklyGroups: { mon: 'fixture-plan' }, exerciseTargets: {} },
  'ai-fitness-workout-direction-backup': { savedAt: 'fixture-fixed', settings: {} },
};
let row = { state: structuredClone(fixture), updated_at: new Date().toISOString() };
let version = 1;
let armed = '';
let sequence = 0;
const pending = [];
const requests = [];
const servers = [];
const evidence = () => writeFileSync(resolve(here, '.generated/evidence.json'), JSON.stringify({ fixture, row, requests }, null, 2));
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const app = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>PR189 합성 검증</title><div id="root"></div><script src="/app.js"></script></html>';
const controls = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>PR189 로컬 검증 제어</title><style>body{font:16px sans-serif}button{padding:10px;margin:3px}iframe{height:850px;border:2px solid #6554b8}pre{white-space:pre-wrap;max-height:400px;overflow:auto}</style>
<h1>PR189 합성 전용 브라우저·HTTP 검증</h1><p>개인 계정과 운영 서버 연결 없음. A/B는 별도 origin. 실제 컴포넌트 + 합성 서버.</p>
<button data-action="pause-get">다음 GET 응답 대기</button><button data-action="pause-patch">다음 PATCH 응답 대기</button><button data-action="lose-patch">다음 PATCH 반영 후 응답 유실</button><button data-action="fail-get">다음 GET 오류</button><button data-action="release">대기 응답 해제</button><button data-action="update">새 서비스워커 버전 준비</button><button data-action="cleanup">서버 합성 데이터 정리</button><button data-action="read">서버·요청 본문 조회</button>
<p id="state" role="status"></p><pre id="evidence"></pre>
<h2>A · 320px</h2><iframe title="Session A" src="http://127.0.0.1:8871/" width="320"></iframe>
<h2>B · 390px</h2><iframe title="Session B" src="http://127.0.0.1:8872/" width="390"></iframe>
<script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const data=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.dataset.action})}).then(r=>r.json());document.getElementById('state').textContent=data.summary;document.getElementById('evidence').textContent=JSON.stringify(data,null,2)});</script></html>`;
async function handle(req, res) {
  try {
    const host = req.headers.host;
    if (!['127.0.0.1:8870','127.0.0.1:8871','127.0.0.1:8872'].includes(host)) return json(res, { error: 'Loopback host only' }, 403);
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, { error: 'Same-origin only' }, 403);
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2000000) throw new Error('Request too large'); }
      const body = JSON.parse(raw);
      if (path === '/api/control' && host.endsWith(':8870')) {
        if (body.action === 'release') { for (const release of pending.splice(0)) release(); }
        else if (body.action === 'update') version++;
        else if (body.action === 'cleanup') { armed = ''; for (const release of pending.splice(0)) release(); row = { state: {}, updated_at: new Date().toISOString() }; evidence(); }
        else if (['pause-get','pause-patch','lose-patch','fail-get'].includes(body.action)) armed = body.action;
        return json(res, { summary: `설정 ${armed || '없음'} · 대기 ${pending.length} · 요청 ${requests.length} · SW ${version}`, row, requests });
      }
      if (path !== '/api/fixture/state' || body.table !== 'user_app_state' || body.filters?.user_id !== 'fixture-user') return json(res, { error: 'Fixture requests only' }, 400);
      const entry = { id: ++sequence, origin: host, time: new Date().toISOString(), request: body };
      requests.push(entry);
      const fault = (body.method === 'GET' && ['pause-get','fail-get'].includes(armed)) || (body.method === 'PATCH' && ['pause-patch','lose-patch'].includes(armed)) ? armed : '';
      if (fault) armed = '';
      let response;
      if (body.method === 'GET') response = fault === 'fail-get' ? { data: null, error: 'fixture query unavailable' } : { data: structuredClone(row), error: null };
      else if (body.method === 'PATCH') {
        if (body.filters.updated_at !== row.updated_at) response = { data: null, error: null };
        else { row = structuredClone(body.payload); response = { data: { updated_at: row.updated_at }, error: null }; }
      } else response = { data: null, error: 'Fixture row already exists' };
      entry.response = response; entry.fault = fault; evidence();
      if (fault.startsWith('pause-')) await new Promise(resolve => pending.push(resolve));
      if (fault === 'lose-patch') { entry.delivery = 'socket destroyed after commit'; evidence(); res.destroy(); return; }
      entry.delivery = fault === 'fail-get' ? 503 : 200; evidence();
      return json(res, response, entry.delivery);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src http://127.0.0.1:8871 http://127.0.0.1:8872; img-src 'self' data:");
    if (path === '/app.js' || path === '/app.css') { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(readFileSync(resolve(here, `.generated${path}`))); }
    if (path === '/sw.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(readFileSync(resolve(root, 'public/sw.js'), 'utf8') + `\n// local fixture revision ${version}\n`); }
    if (['/manifest.json','/icon-192.png','/icon-512.png'].includes(path)) { res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'image/png'); return res.end(readFileSync(resolve(root, `public${path}`))); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(host.endsWith(':8870') ? controls : app);
  } catch (error) { if (!res.headersSent) json(res, { error: String(error) }, 500); else res.end(); }
}
for (const port of [8870,8871,8872]) {
  const server = createServer(handle); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); servers.push(server);
}
console.log('Synthetic browser lab ready: http://127.0.0.1:8870 (no real account or environment files)');
process.on('SIGINT', () => { for (const release of pending.splice(0)) release(); for (const server of servers) server.close(); process.exit(0); });
