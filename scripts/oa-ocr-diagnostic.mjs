// Local diagnostic. Private input requires an explicit path; never saves app records.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute, extname } from 'node:path';
import assert from 'node:assert/strict';

const mode = process.argv[2] || 'clean';
if (!['clean', 'labels', 'badges', 'score-limit', 'score-decimal', 'low-resolution', 'private-local'].includes(mode)) throw Error('Choose clean, labels, badges, score-limit, low-resolution or private-local');
const privateInput = mode === 'private-local';
const privatePath = process.env.OA_LOCAL_IMAGE;
const expected = privateInput && process.env.OA_EXPECTED_JSON ? JSON.parse(readFileSync(process.env.OA_EXPECTED_JSON, 'utf8')) : null;
if (privateInput && (!privatePath || !isAbsolute(privatePath) || !['.jpg', '.jpeg', '.png'].includes(extname(privatePath).toLowerCase()))) throw Error('private-local requires OA_LOCAL_IMAGE with an explicit absolute local JPG/PNG path');
const output = privateInput ? resolve('../private-ocr') : resolve('scripts/browser-qa/.generated/oa-diagnostic');
mkdirSync(output, { recursive: true });
const bundle = await build({
  stdin: { contents: `import {parseOaReport} from './app/lib/oaReportParser'; window.parseReport=parseOaReport;`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, plugins: [{ name: 'synthetic-only-observer', setup(b) {
    b.onLoad({ filter: /oaReportParser\.ts$/ }, args => {
      let contents = readFileSync(args.path, 'utf8');
      contents = contents.replace('const value = agreedNumber(reads, row);', `
        const numeric = reads.map(read => numberFromText(read.text, row));
        const reasons = reads.map((read, i) => {
          const normalized = read.text.trim().replace(/,/g, '.').replace(/\\s*([.,])\\s*/g, '$1');
          const token = normalized.match(/^(\\d+(?:\\.\\d+)?)\\s*(?:%|kg|kcal|points?)?\\s*$/i);
          return { text: read.text.trim(), confidence: read.confidence, confidencePassed: read.confidence >= 60,
            numeric: numeric[i] ?? null,
            rejection: !read.text.trim() ? 'empty-ocr' : !token ? 'not-single-number' : row.decimals && !token[1].includes('.') ? 'missing-decimal' : numeric[i] === undefined ? 'out-of-range' : read.confidence < 60 ? 'confidence-below-60' : null };
        });
        const value = agreedNumber(reads, row);
        window.ocrDiagnostics.push({ key: row.key, reads: reasons,
          accepted: value ?? null,
          agreement: numeric.every(n => n !== undefined) ? (numeric.every(n => n === numeric[0]) ? 'equal' : 'different') : 'unparseable' });`);
      return { contents, loader: 'ts' };
    });
  } }],
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : '<input type="file"><script>window.ocrDiagnostics=[]</script><script src="/app.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const blocked = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    const name = new URL(url).pathname.split('/').at(-1);
    let file;
    if (name === 'worker.min.js') file = resolve('node_modules/tesseract.js/dist/worker.min.js');
    if (/^tesseract-core[-a-z]*\.wasm(?:\.js)?$/.test(name)) file = resolve('node_modules/tesseract.js-core', name);
    if (name === 'eng.traineddata.gz') file = resolve('scripts/browser-qa/.generated/ocr-assets/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
    if (file && route.request().method() === 'GET') return route.fulfill({ body: readFileSync(file), headers: { 'Access-Control-Allow-Origin': '*' }, contentType: name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    blocked.push(new URL(url).origin); return route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin);
  if (privateInput) await page.locator('input[type=file]').setInputFiles(privatePath);
  const result = await page.evaluate(async ({ mode, expected }) => {
    if (mode === 'private-local') {
      const parsed = await window.parseReport(document.querySelector('input').files[0]);
      // Never return health values, raw OCR strings, dates or image bytes to the host log.
      const comparison = expected ? {
        dateMatches: parsed.detectedDate === expected.date,
        matched: Object.keys(expected.values).filter(key => parsed.values[key] === expected.values[key]),
        mismatched: Object.keys(expected.values).filter(key => parsed.values[key] !== undefined && parsed.values[key] !== expected.values[key]),
        missing: Object.keys(expected.values).filter(key => parsed.values[key] === undefined),
        unexpected: Object.keys(parsed.values).filter(key => !(key in expected.values)),
      } : undefined;
      return { recognizedCount: parsed.recognizedCount, dateRecognized: !!parsed.detectedDate, comparison,
        rows: window.ocrDiagnostics.map(row => ({ key: row.key, accepted: row.accepted !== null,
          agreement: row.agreement, reads: row.reads.map(read => ({confidence: read.confidence, confidencePassed: read.confidencePassed, parseable: read.numeric !== null, rejection: read.rejection})) })) };
    }
    const low = mode === 'low-resolution';
    const canvas = document.createElement('canvas'); canvas.width = low ? 320 : 1000; canvas.height = low ? 2048 : 6000;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = low ? '#171717' : 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (mode === 'badges') {
      ctx.fillStyle = '#22292c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white'; ctx.fillRect(25, 400, 950, 5500);
    }
    ctx.fillStyle = low || mode === 'badges' ? '#bababa' : 'black'; ctx.textBaseline = 'middle'; ctx.font = low ? '11px Arial' : '65px Arial';
    ctx.fillText('2025-04-07 08:12:34', canvas.width * .1, canvas.height * .04);
    ctx.fillStyle = low ? '#bababa' : 'black';
    const rows = [ ['83.0', .08, .105], [mode === 'score-limit' ? '100' : mode === 'score-decimal' ? '9.5' : '76', mode === 'score-limit' ? .12 : .08, .402], ['24.5', .65, .479], ['9', .76, .5693] ];
    for (const [text, x, y] of rows) {
      ctx.font = low ? (y < .45 ? '26px Arial' : '12px Arial') : '65px Arial';
      ctx.fillText(text, canvas.width * x, canvas.height * y);
  if (mode === 'labels') { ctx.font = '35px Arial'; ctx.fillText('normal', canvas.width * (y < .45 ? .4 : .82), canvas.height * y); }
      if (['score-limit', 'score-decimal'].includes(mode) && y === .402) { ctx.font = '25px Arial'; ctx.fillText('points', 240, canvas.height * y + 10); }
      if (mode === 'badges' && y > .45) {
        ctx.fillStyle = '#00b883'; ctx.fillRect(820, canvas.height * y - 30, 120, 60);
        ctx.fillStyle = 'white'; ctx.font = '30px Arial'; ctx.fillText('normal', 825, canvas.height * y);
        ctx.fillStyle = 'black';
      }
    }
    const blob = await new Promise(r => canvas.toBlob(r));
    const parsed = await window.parseReport(new File([blob], 'synthetic.png', { type: 'image/png' }));
    return { recognizedCount: parsed.recognizedCount, dateRecognized: !!parsed.detectedDate, rows: window.ocrDiagnostics.filter(r => ['weight', 'bodyScore', 'bmi', 'visceralFatLevel'].includes(r.key)) };
  }, {mode, expected});
  const report = { mode, syntheticOnly: !privateInput, externalRequestsSent: 0, blockedRequests: blocked.length, ...result };
  writeFileSync(resolve(output, `${mode}.json`), JSON.stringify(report, null, 2));
  if (!privateInput) {
    assert.equal(result.dateRecognized, true);
    assert.equal(result.recognizedCount, { clean: 4, labels: 2, badges: 3, 'score-limit': 4, 'score-decimal': 4, 'low-resolution': 2 }[mode]);
    if (mode === 'score-decimal') assert.equal(result.rows.find(row => row.key === 'bodyScore').accepted, 9.5);
    if (mode === 'score-limit') assert.equal(result.rows.find(row => row.key === 'bodyScore').accepted, 100);
  }
  if (privateInput && expected) { assert.equal(result.comparison.dateMatches, true); for (const key of ['mismatched', 'missing', 'unexpected']) assert.deepEqual(result.comparison[key], []); }
  if (mode === 'badges') { const row = result.rows.find(row => row.key === 'visceralFatLevel'); assert.equal(row.accepted, null); assert.ok(row.reads.some(read => read.rejection === 'confidence-below-60')); }
  if (mode === 'labels') {
    for (const row of result.rows.filter(row => ['bmi', 'visceralFatLevel'].includes(row.key))) for (const read of row.reads) {
      assert.equal(read.rejection, 'not-single-number');
    }
  }
  if (mode === 'low-resolution') {
    for (const read of result.rows.find(row => row.key === 'bmi').reads) assert.equal(read.rejection, 'missing-decimal');
  }

  console.log(JSON.stringify(privateInput ? { mode, recognizedCount: result.recognizedCount, dateRecognized: result.dateRecognized, externalRequestsSent: 0, reportSavedOutsideRepository: true } : report));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
