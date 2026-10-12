import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Exercise the unchanged production CLI. A disposable copy isolates its digest
// fixture; no exporter, browser, application storage, or archived HTML is used.
const fixture = '<!doctype html><style>body{color:#123456}</style>'
  + '<script>window.assets={image:"data:image/png;base64,AQID",audio:"data:audio/mpeg;base64,BAUG"};window.ready=true;</script>';
const digest = createHash('sha256').update(fixture).digest('hex');
const filenames = { motion: 'Yeoni_Human_Motion_Preview.html', speech: 'Yeoni_Human_Speech_Preview.html' };

for (const kind of ['motion', 'speech'] as const) {
  test(`human ${kind} preview guard checks every byte and never refreshes expectations`, t => {
    const directory = mkdtempSync(join(tmpdir(), `yeoni-preview-${kind}-`));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const file of ['check-human-preview.mjs', 'human-preview-path.mjs']) {
      copyFileSync(new URL(`../scripts/browser-qa/${file}`, import.meta.url), join(directory, file));
    }
    const expectationPath = join(directory, 'human-preview-sha256.json');
    const expectation = JSON.stringify({ motion: digest, speech: digest });
    writeFileSync(expectationPath, expectation);
    const html = join(directory, filenames[kind]);
    const run = (requestedKind: string = kind) => spawnSync(process.execPath, [join(directory, 'check-human-preview.mjs'), requestedKind], {
      env: { ...process.env, YEONI_PREVIEW_ROOT: directory }, encoding: 'utf8',
    });
    writeFileSync(html, fixture);
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, new RegExp(`PASS ${kind}: complete current preview SHA-256 matches reviewed build`));
    for (const [name, changed] of [
      ['markup', fixture.replace('<!doctype html>', '<!doctype HTML>')],
      ['style', fixture.replace('#123456', '#123457')],
      ['script', fixture.replace('ready=true', 'ready=false')],
      ['embedded artwork', fixture.replace('base64,AQID', 'base64,AQIE')],
      ['embedded audio', fixture.replace('base64,BAUG', 'base64,BAUH')],
      ['trailing bytes', `${fixture}\n`],
    ]) {
      assert.notEqual(changed, fixture);
      writeFileSync(html, changed);
      const rejected = run();
      assert.equal(rejected.status, 1, name);
      assert.match(rejected.stderr, /Current preview differs from the reviewed build snapshot/, name);
      assert.equal(readFileSync(expectationPath, 'utf8'), expectation, 'Mismatch cannot rewrite the reviewed digest');
      assert.equal(readFileSync(html, 'utf8'), changed, 'Mismatch cannot silently rebuild the input');
    }
    writeFileSync(html, fixture);
    assert.equal(run().status, 0, 'Restoring the exact reviewed bytes passes again');
    writeFileSync(expectationPath, JSON.stringify({ [kind]: 'invalid' }));
    assert.equal(run().status, 1, 'Malformed expected digests fail closed');
    writeFileSync(expectationPath, '{}');
    assert.equal(run().status, 1, 'Missing expected digests fail closed');
    writeFileSync(expectationPath, expectation);
    rmSync(html);
    assert.equal(run().status, 1, 'Missing preview files fail closed');
    const unknown = run('unreviewed');
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown human preview/);
  });
}
