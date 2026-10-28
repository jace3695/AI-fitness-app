import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { inbodyLocalAssetOptions } from '../app/lib/inbodyReportParser.ts';
import { OCR_ASSETS, OCR_ASSET_ID, OCR_ASSET_PREFIX } from '../scripts/browser-qa/cloud/ocr-assets.mjs';
import { verifyOcrAsset } from '../scripts/browser-qa/cloud/prepare-ocr-assets.mjs';

// Control-flow tests only. The native fixture never receives these unit-test worker doubles.
function parserFixture(options: { ratio?: number; imageError?: boolean; contextError?: boolean; recognizeError?: boolean } = {}) {
  const source = readFileSync('app/lib/inbodyReportParser.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const calls = { images: 0, revoked: 0, workers: [] as unknown[][], sizes: [] as number[][], recognized: [] as number[][], terminated: 0, parameters: null as unknown };
  class Image {
    naturalWidth = 1800; naturalHeight = Math.round(1800 * (options.ratio ?? 2550 / 1800));
    onload?: () => void; onerror?: () => void;
    constructor() { calls.images++; }
    set src(_value: string) { if (options.imageError) this.onerror?.(); else this.onload?.(); }
  }
  const worker = {
    async setParameters(value: unknown) { calls.parameters = value; },
    async recognize(canvas: { width: number; height: number }) { calls.recognized.push([canvas.width, canvas.height]); if (options.recognizeError) throw new Error('synthetic worker failure'); return { data: { blocks: [] } }; },
    async terminate() { calls.terminated++; },
  };
  const exports: { parseInbody270sReport?: (file: unknown, progress?: (value: number) => void, assets?: { basePath: string }) => Promise<unknown> } = {};
  const context = { Image, URL: { createObjectURL: () => 'blob:synthetic-unit', revokeObjectURL: () => { calls.revoked++; } },
    document: { createElement(tag: string) {
      assert.equal(tag, 'canvas'); const canvas = { width: 0, height: 0, getContext() { return options.contextError ? null : { fillStyle: '', fillRect() {}, drawImage() { calls.sizes.push([canvas.width, canvas.height]); } }; } }; return canvas;
    } } };
  vm.runInNewContext(`(function(exports, require){${code}\n})`, context)(exports, (name: string) => {
    assert.equal(name, 'tesseract.js'); return { PSM: { AUTO: '3' }, createWorker: async (...args: unknown[]) => { calls.workers.push(args); return worker; } };
  });
  assert.ok(exports.parseInbody270sReport);
  return { calls, run: exports.parseInbody270sReport };
}

test('default real parser keeps its default eng model call and draws both existing scales before terminating', async () => {
  const f = parserFixture(), progress: number[] = [];
  await f.run({}, value => progress.push(value));
  assert.deepEqual(f.calls.workers, [['eng']]);
  assert.deepEqual(f.calls.sizes, [[1800, 2550], [2100, 2975]]);
  assert.deepEqual(f.calls.recognized, f.calls.sizes);
  assert.deepEqual(progress, [50, 100]); assert.equal(f.calls.terminated, 1); assert.equal(f.calls.revoked, 1);
  assert.equal(JSON.stringify(f.calls.parameters), JSON.stringify({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' }));
});

test('configured parser changes asset transport only, leaving OEM undefined and recognized values untouched', async () => {
  const f = parserFixture(); await f.run({}, undefined, { basePath: OCR_ASSET_PREFIX });
  assert.equal(f.calls.workers[0][0], 'eng'); assert.equal(f.calls.workers[0][1], undefined);
  assert.equal(JSON.stringify(f.calls.workers[0][2]), JSON.stringify(inbodyLocalAssetOptions({ basePath: OCR_ASSET_PREFIX })));
  assert.equal(f.calls.terminated, 1);
});

test('decode and ratio failures revoke the object URL before any worker or canvas exists', async () => {
  for (const options of [{ imageError: true }, { ratio: .25 }, { ratio: 3 }]) {
    const f = parserFixture(options); await assert.rejects(() => f.run({}));
    assert.equal(f.calls.revoked, 1); assert.deepEqual(f.calls.workers, []); assert.deepEqual(f.calls.sizes, []);
  }
});

test('canvas and recognition failures terminate the actual-parser worker ownership in finally', async () => {
  for (const options of [{ contextError: true }, { recognizeError: true }]) {
    const f = parserFixture(options); await assert.rejects(() => f.run({}));
    assert.equal(f.calls.workers.length, 1); assert.equal(f.calls.terminated, 1);
  }
});

test('asset configuration refuses remote, protocol-relative, query, fragment, encoded and traversing locations', () => {
  for (const basePath of ['https://example.com/ocr', '//example.com/ocr', '/ocr?model=other', '/ocr#other', '/ocr/%2e%2e', '/ocr/../private', '/ocr/./worker', '/', '/ocr/']) assert.throws(() => inbodyLocalAssetOptions({ basePath }));
  assert.deepEqual(inbodyLocalAssetOptions({ basePath: OCR_ASSET_PREFIX }), { workerPath: `${OCR_ASSET_PREFIX}/worker.min.js`, corePath: OCR_ASSET_PREFIX, langPath: OCR_ASSET_PREFIX, workerBlobURL: false, cacheMethod: 'none' });
});

test('all worker/core/data versions and cache identity are bound to full byte hashes, with no corrupted-byte fallback', () => {
  assert.equal(OCR_ASSETS.length, 6);
  const digest = createHash('sha256').update(OCR_ASSETS.map(asset => asset.sha256).join('\n')).digest('hex').slice(0, 16);
  assert.equal(OCR_ASSET_ID, `t6.0.1-c6.1.2-e1.0.0-${digest}`);
  for (const asset of OCR_ASSETS.filter(asset => asset.source)) verifyOcrAsset(readFileSync(`node_modules/${asset.source}`), asset);
  const bytes = Buffer.from('synthetic static asset');
  const metadata = { name: 'synthetic', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.equal(verifyOcrAsset(bytes, metadata), bytes);
  assert.throws(() => verifyOcrAsset(Buffer.from('corrupted static asset'), metadata), /mismatch/);
  assert.throws(() => verifyOcrAsset(Buffer.concat([bytes, Buffer.from('x')]), metadata), /mismatch/);
  assert.equal(OCR_ASSETS.filter(asset => asset.url).length, 1);
  assert.equal(OCR_ASSETS.at(-1)?.url, 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz');
});

test('real-image fixture configures only static assets; production readers, PNG bytes and external denial remain real', () => {
  const fixture = readFileSync('scripts/browser-qa/cloud/BodyImportRealOcrFixture.tsx', 'utf8');
  assert.match(fixture, /<BodyRecordCard/); assert.match(fixture, /inbodyOcrAssets=\{\{ basePath: OCR_ASSET_PREFIX \}\}/);
  assert.doesNotMatch(fixture, /readReport=|readInbodyReport=|readSynthetic|agreedInbody|recognizeInbody|fetch\(/);
  const native = readFileSync('tests/browser-cloud/body-import-real-ocr.spec.ts', 'utf8');
  assert.match(native, /setInputFiles\(resolve\('scripts\/browser-qa\/fixtures\/inbody-270s-synthetic.png'\)\)/);
  assert.match(native, /Reflect.apply\(original, this, args\)/);
  assert.doesNotMatch(native, /route\.fulfill|route\.continue|createWorker\s*=|readSynthetic/);
  const guard = readFileSync('tests/browser-cloud/fixture.ts', 'utf8');
  assert.match(guard, /else \{ external.push\(url.origin\); await route.abort\('blockedbyclient'\); \}/);
  for (const [name, width, height] of [['inbody-270s-synthetic.png', 1800, 2550], ['inbody-wrong-ratio.png', 64, 16]] as const) {
    const png = readFileSync(`scripts/browser-qa/fixtures/${name}`);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  }
});

test('actual reporter accepts only four fixed B3 real phases, strips diagnostics and keeps the 32-phase cap', () => {
  const code = ts.transpileModule(readFileSync('tests/browser-cloud/reporter.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  type Reporter = { onStepEnd(a: unknown, b: unknown, c: unknown): void; onTestEnd(a: unknown, b: unknown): void; onEnd(a: unknown): void };
  const exports: { default?: new () => Reporter } = {}; let output = '';
  vm.runInNewContext(`(function(exports, require){${code}\n})`, { process: { env: {} }, console: { log() {} } })(exports, (name: string) => {
    assert.equal(name, 'node:fs'); return { mkdirSync() {}, appendFileSync() { assert.fail('No summary configured'); }, writeFileSync(_path: string, value: string) { output = value; } };
  });
  assert.ok(exports.default); const reporter = new exports.default();
  const item = { id: 'synthetic-b3', title: 'Fixed synthetic case', parent: { project: () => ({ name: 'synthetic-browser' }) } };
  const phases = ['b3-real/decode-ratio', 'b3-real/worker-ocr', 'b3-real/review', 'b3-real/save-reload'];
  for (let index = 0; index < 36; index++) reporter.onStepEnd(item, {}, { title: phases[index % phases.length], error: { message: 'PRIVATE_OCR_SENTINEL', url: 'PRIVATE_URL_SENTINEL' } });
  for (const title of ['b3-real/other', 'b3-real/review/PRIVATE_TITLE_SENTINEL', 'b3-real/worker-ocr\n', 'PRIVATE_OCR_SENTINEL']) reporter.onStepEnd(item, {}, { title });
  reporter.onTestEnd(item, { status: 'failed', duration: 1 }); reporter.onEnd({ status: 'failed' });
  const saved = JSON.parse(output).results[0].phases;
  assert.equal(saved.length, 32); assert.deepEqual(saved.map((item: { phase: string }) => item.phase), Array.from({ length: 32 }, (_, index) => phases[index % phases.length]));
  assert.ok(saved.every((item: { status: string }) => item.status === 'failed')); assert.doesNotMatch(output, /PRIVATE_|b3-real\/other/);
});
