import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { captureFullPageEvidence, fullPageEvidenceClips } from './browser-cloud/evidence-capture.ts';

// Native browsers are not launched by these tests. This exercises capture planning,
// shipped screenshot calls and reporter redaction, not the pending browser outcome.
test('oversized native-density evidence covers every vertical row once below the WebKit capture boundary', () => {
  for (const deviceScaleFactor of [1, 1.5, 2, 3]) {
    for (const height of [11054, 32767, 32768, 40001]) {
      const clips = fullPageEvidenceClips({ width: 390, height, deviceScaleFactor });
      if (height * deviceScaleFactor <= 32767) { assert.deepEqual(clips, [undefined]); continue; }
      let nextY = 0;
      for (const clip of clips) {
        assert.ok(clip);
        assert.equal(clip.x, 0); assert.equal(clip.width, 390); assert.equal(clip.y, nextY);
        assert.ok(clip.height > 0 && Math.ceil(clip.height * deviceScaleFactor) <= 32767);
        nextY += clip.height;
      }
      assert.equal(nextY, height);
    }
  }
});

test('normal capture size stays unchanged and invalid or unbounded requests fail rather than silently crop', () => {
  assert.deepEqual(fullPageEvidenceClips({ width: 320, height: 10886, deviceScaleFactor: 3 }), [undefined]);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => fullPageEvidenceClips({ width: 320, height: bad, deviceScaleFactor: 3 }));
  assert.throws(() => fullPageEvidenceClips({ width: 20000, height: 10, deviceScaleFactor: 3 }), /width/);
  assert.throws(() => fullPageEvidenceClips({ width: 320, height: 1e9, deviceScaleFactor: 3 }), /budget/);
});

test('capture uses native pixel density, no viewport/style changes and predictable complete tile filenames', async () => {
  const calls: { path: string; fullPage: boolean; clip?: { x: number; y: number; width: number; height: number }; scale?: string }[] = [];
  const dimensions = { width: 320, height: 11054, deviceScaleFactor: 3 };
  const page = { evaluate: async () => dimensions, screenshot: async (options: typeof calls[number]) => { calls.push(options); return Buffer.from('synthetic'); } };
  await captureFullPageEvidence(page as unknown as Parameters<typeof captureFullPageEvidence>[0], 'test.png');
  assert.deepEqual(calls.map(call => call.path), ['test.png', 'test-part-002.png', 'test-part-003.png']);
  assert.equal(calls.at(-1)!.clip!.y + calls.at(-1)!.clip!.height, dimensions.height);
  for (const call of calls) { assert.equal(call.fullPage, true); assert.equal(call.scale, undefined); assert.deepEqual(Object.keys(call).sort(), ['clip', 'fullPage', 'path']); }
  calls.length = 0; dimensions.height = 1000;
  await captureFullPageEvidence(page as unknown as Parameters<typeof captureFullPageEvidence>[0], 'small.png');
  assert.deepEqual(calls, [{ path: 'small.png', fullPage: true }]);
});

test('capture errors remain failures without retry, downgrade or ignored missing tiles', async () => {
  let calls = 0;
  const page = { evaluate: async () => ({ width: 320, height: 11054, deviceScaleFactor: 3 }), screenshot: async () => { calls++; throw new Error('synthetic failure'); } };
  await assert.rejects(captureFullPageEvidence(page as unknown as Parameters<typeof captureFullPageEvidence>[0], 'test.png'), /synthetic failure/);
  assert.equal(calls, 1);
});

test('both named B3 and shared teardown full-page paths use bounded evidence without changing geometry or density', () => {
  for (const path of ['tests/browser-cloud/body-import.spec.ts', 'tests/browser-cloud/fixture.ts']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /captureFullPageEvidence\(page,/);
    assert.doesNotMatch(source, /fullPage:\s*true|scale:\s*'css'/);
  }
  const body = readFileSync('tests/browser-cloud/body-import.spec.ts', 'utf8');
  assert.match(body, /document\.documentElement\.scrollWidth <= innerWidth/);
  assert.match(body, /box\.fits && box\.withinViewport/);
  assert.match(body, /completeButtonWords\(button\)/);
  assert.match(body, /for \(const width of \[320, 390\]\)/);
  assert.match(body, /for \(const rootSize of \[16, 32\]\)/);
});

test('reporter emits only bounded fixed phase enums and never raw assertions, errors or arbitrary labels', () => {
  const source = readFileSync('tests/browser-cloud/reporter.ts', 'utf8');
  const output: Record<string, string> = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: new () => { onStepEnd: (...args: unknown[]) => void; onTestEnd: (...args: unknown[]) => void; onEnd: (...args: unknown[]) => void } } = {};
  vm.runInNewContext(js, { exports, require: () => ({ mkdirSync: () => {}, writeFileSync: (path: string, text: string) => { output[path] = text; }, appendFileSync: () => {} }), process: { env: {} }, console: { log: () => {} } });
  assert.ok(exports.default);
  const reporter = new exports.default();
  assert.equal(typeof reporter.onStepEnd, 'function');
  const caseA = { id: 'a', title: 'synthetic test', parent: { project: () => ({ name: 'webkit-small' }) } };
  const raw = 'synthetic-private-error';
  reporter.onStepEnd(caseA, {}, { title: 'b3-reflow/draft/320/32/checks' });
  reporter.onStepEnd(caseA, {}, { title: 'b3-reflow/draft/320/32/full-page-capture', error: { message: raw, stack: raw } });
  reporter.onStepEnd(caseA, {}, { title: 'b3-reflow/draft/320/32/checks/' + raw, error: { message: raw } });
  reporter.onStepEnd(caseA, {}, { title: raw, error: { message: raw } });
  reporter.onTestEnd(caseA, { status: 'failed', duration: 1, errors: [{ message: raw }] });
  reporter.onEnd({ status: 'failed' });
  const json = Object.values(output)[0];
  assert.ok(!json.includes(raw));
  assert.deepEqual(JSON.parse(json).results[0].phases, [
    { phase: 'b3-reflow/draft/320/32/checks', status: 'passed' },
    { phase: 'b3-reflow/draft/320/32/full-page-capture', status: 'failed' },
  ]);
  for (let i = 0; i < 40; i++) reporter.onStepEnd(caseA, {}, { title: 'component-evidence/final-capture' });
  reporter.onTestEnd(caseA, { status: 'passed', duration: 1 });
  reporter.onTestEnd(caseA, { status: 'passed', duration: 1 });
  reporter.onEnd({ status: 'passed' });
  const results = JSON.parse(Object.values(output)[0]).results;
  assert.equal(results[1].phases.length, 32);
  assert.deepEqual(results[2].phases, []);
});
