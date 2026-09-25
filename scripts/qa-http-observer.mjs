import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { appendFileSync, mkdirSync } from 'node:fs';

// Passive Node HTTP observation. Does not replace next start, handlers, network
// policy, or request contents. Query strings and headers never enter evidence.
export function installHttpObserver(write, port = 3000) {
  let sequence = 0;
  const requests = new WeakMap();
  const start = ({ request, response, socket }) => {
    if (socket.localPort !== port || request.method !== 'GET' || request.headers['sec-fetch-dest'] !== 'document') return;
    const pathname = request.url?.split('?')[0];
    const route = ['/diet/settings', '/growth/drawing'].includes(pathname) ? pathname : 'other-route';
    const info = { id: ++sequence, route };
    requests.set(request, info);
    write({ ...info, at: Date.now(), event: 'server-received' });
    response.once('close', () => {
      if (!response.writableFinished) write({ ...info, at: Date.now(), event: 'server-response-closed-early' });
    });
  };
  const finish = ({ request, response }) => {
    const info = requests.get(request);
    if (info) write({ ...info, at: Date.now(), event: 'server-finished', status: response.statusCode });
  };
  subscribe('http.server.request.start', start);
  subscribe('http.server.response.finish', finish);
  return () => {
    unsubscribe('http.server.request.start', start);
    unsubscribe('http.server.response.finish', finish);
  };
}

if (process.env.QA_HTTP_OBSERVER === '1') {
  if (process.env.YEONI_E2E !== '1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Non-isolated HTTP observer refused');
  mkdirSync('.e2e/evidence', { recursive: true });
  installHttpObserver(row => appendFileSync('.e2e/evidence/server-navigation.jsonl', JSON.stringify(row) + '\n'));
}
