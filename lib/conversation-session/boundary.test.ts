import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { append, commit, save, started } from './fixtures.test-support.ts';

const root = new URL('../../', import.meta.url).pathname;
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]); }

test('inactive foundation has no production importer, storage capability, provider, A2 or clock/ID read', () => {
  for (const name of ['contracts.ts', 'reducer.ts', 'recap.ts']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket|Date\.now|Math\.random|randomUUID|setInterval|setTimeout)\s*[.(]/);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:app\/|evidence-store|localEvidenceStore|supabase|react)[^'"]*['"]/);
  }
  for (const file of ['app', 'components', 'data', 'hooks', 'services', 'utils'].flatMap(dir => files(join(root, dir)))) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.test.ts')) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:import|export)[^;]*conversation-session\//, file);
  }
});

test('planners perform deterministic work without reading current time', () => {
  const original = Date.now; Date.now = () => { throw new Error('clock access denied'); };
  try { const e = save(started()); assert.deepEqual(commit(e, append(e)), commit(e, append(e))); }
  finally { Date.now = original; }
});
