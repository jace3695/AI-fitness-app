// Reads a private capture and prints only IDs, outcomes and counts; never bodies.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const firstRow = body => Array.isArray(body) ? body[0] : body;

export function auditSyncQa(capture) {
  if (capture.format !== 'yeoni-sync-qa-v1' || !Array.isArray(capture.entries)) throw new Error('Unsupported or missing trace format');
  const writes = capture.entries.filter(entry => ['PATCH', 'POST'].includes(entry.method)).map(entry => {
    const status = entry.response?.status;
    const result = { id: entry.id, status: status ?? null, outcome: 'not-acknowledged' };
    if (status < 200 || status >= 300 || !status) return result;
    if (entry.method === 'PATCH' && !firstRow(entry.response.body)) return { ...result, outcome: 'cas-rejected' };
    if (entry.phase !== 'delivered' || !entry.deliveredAt) return { ...result, outcome: 'response-not-delivered' };
    const nextWrite = capture.entries.find(next => next.client === entry.client && next.id > entry.id && ['PATCH', 'POST'].includes(next.method));
    const confirmation = capture.entries.find(next => next.client === entry.client && next.id > entry.id &&
      (!nextWrite || next.id < nextWrite.id) && next.method === 'GET' && next.sentAt >= entry.deliveredAt &&
      next.phase === 'delivered' && !next.response?.synthetic && next.response?.status === 200 &&
      firstRow(next.response?.body)?.state !== undefined);
    if (!confirmation) return { ...result, outcome: 'confirmation-missing' };
    return { ...result, confirmationId: confirmation.id, outcome: stable(firstRow(confirmation.response.body).state) === stable(entry.requestBody?.state) ? 'confirmation-matches' : 'confirmation-differs' };
  });
  return { format: capture.format, entries: capture.entries.length,
    completeCapture: !capture.overflow && capture.inFlight === 0 && capture.held?.length === 0 && !capture.rule && !capture.entries.some(entry => entry.error === 'Response body capture failed'),
    writes,
    note: 'Following GET comparison only. UI behavior, causal identity of the GET, original account preservation, and cleanup require separate evidence.',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/sync-qa/audit.mjs <private-capture.json>');
  console.log(JSON.stringify(auditSyncQa(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
}
