import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

type Element = { type: unknown; props: { children?: unknown; onClick?: () => void } };
function setup(state: Record<string, string>) {
  const writes: unknown[] = [], changes: unknown[] = [], downloads: Blob[] = [];
  let clicks = 0;
  const modules = {
    'react/jsx-runtime': jsx,
    react: { useRef: () => ({ current: null }), useState: (initial: unknown) => [initial, (value: unknown) => changes.push(value)] },
    '../data/cloudSync': { readLocalCloudState: () => state, applyCloudState: (value: unknown) => writes.push(value), mergeExplicitCloudBackup: () => { throw new Error('Unexpected restore'); } },
  };
  const exports = {} as { default: () => Parameters<typeof renderToStaticMarkup>[0] };
  const source = ts.transpileModule(readFileSync(new URL('../app/components/DataBackupPanel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Date, Blob, URL: { createObjectURL: (blob: Blob) => { downloads.push(blob); return 'blob:synthetic-backup'; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click: () => { clicks++; }, remove() {} }) },
    window: { setTimeout: (callback: () => void) => callback() },
  })(exports, (name: string) => { assert.ok(name in modules, name); return modules[name as keyof typeof modules]; });
  const tree = exports.default();
  function find(value: unknown): Element | undefined {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    const element = value as Element;
    if (element.type === 'button' && element.props.children === '운동·식단 기록 백업') return element;
    return find(element.props?.children);
  }
  return { tree, changes, writes, downloads, clicks: () => clicks, download: () => find(tree)?.props.onClick?.() };
}

test('shipping backup panel states the local domain and exclusions instead of promising a full-app archive', () => {
  const value = setup({});
  const html = renderToStaticMarkup(value.tree);
  assert.match(html, /운동·식단 기록 백업/);
  assert.match(html, /연이 전체 앱 백업은 아닙니다/);
  assert.match(html, /일본어 Live 기록/);
  assert.match(html, /업로드한 교재·그림·음성 파일/);
  assert.match(html, /별도 임시 저장된 입력/);
  assert.match(html, /5MB 이하/);
  assert.doesNotMatch(html, />전체 기록 백업</);
});

test('in-scope export preserves the existing JSON contract and never mutates records', async () => {
  const state = { 'ai-fitness-weight-records': '{"2026-10-09":70}' };
  const value = setup(state); value.download();
  assert.equal(value.clicks(), 1); assert.equal(value.downloads.length, 1);
  const payload = JSON.parse(await value.downloads[0].text());
  assert.equal(payload.app, 'AI-fitness-app'); assert.equal(payload.version, 1); assert.deepEqual(payload.state, state);
  assert.equal(value.writes.length, 0);
  assert.ok(value.changes.some(change => typeof change === 'string' && change.includes('백업 파일을 만들었습니다')));
});

test('export exceeding the existing import limit fails visibly without downloading an unrestorable file or mutating data', () => {
  const state = { 'ai-fitness-synthetic-large': 'x'.repeat(5 * 1024 * 1024) };
  const value = setup(state); value.download();
  assert.equal(value.clicks(), 0); assert.equal(value.downloads.length, 0); assert.equal(value.writes.length, 0);
  assert.equal(state['ai-fitness-synthetic-large'].length, 5 * 1024 * 1024);
  assert.ok(value.changes.some(change => typeof change === 'string' && change.includes('5MB를 넘어') && change.includes('원본 기록은 그대로')));
});
