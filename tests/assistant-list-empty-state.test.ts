import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import * as jsx from 'react/jsx-runtime';
import type { AssistantListFilter } from '../components/AssistantListEmptyState.tsx';

type Props = {
  filter: AssistantListFilter;
  loadFailures: readonly string[];
  entryFormId: string;
  onAdd: () => void;
  onRetry: () => void;
};
type NodeProps = { children?: ReactNode; onClick?: () => void; type?: string; role?: string; 'aria-controls'?: string };
const source = readFileSync(new URL('../components/AssistantListEmptyState.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../app/assistant/AssistantClient.tsx', import.meta.url), 'utf8');
const moduleExports = {} as { default: (props: Props) => ReactNode };
function compile(code: string) {
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
}
vm.runInNewContext('(function(exports,require){' + compile(source) + '})')(moduleExports, (name: string) => {
  if (name === 'react/jsx-runtime') return jsx;
  throw new Error(`Unexpected dependency: ${name}`);
});
function nodes(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join(' ');
  return isValidElement<NodeProps>(node) ? text(node.props.children) : '';
}
function fixture(filter: AssistantListFilter = 'all', loadFailures: readonly string[] = []) {
  const calls = { add: 0, retry: 0 };
  const props = { filter, loadFailures, entryFormId: 'assistant-entry-form', onAdd: () => { calls.add++; }, onRetry: () => { calls.retry++; } };
  const tree = moduleExports.default(props);
  const buttons = nodes(tree).filter(node => node.type === 'button');
  assert.equal(buttons.length, 1);
  return { calls, tree, button: buttons[0] };
}

test('confirmed empty list offers one explicit open-form action, never retries or submits', () => {
  const f = fixture();
  assert.match(text(f.tree), /아직 이 목록에 등록된 항목이 없어요/);
  assert.equal(text(f.button), '직접 추가하기');
  assert.equal(f.button.props.type, 'button');
  assert.equal(f.button.props['aria-controls'], 'assistant-entry-form');
  f.button.props.onClick?.();
  assert.deepEqual(f.calls, { add: 1, retry: 0 });
});

test('failed list reads explain unknown contents and only offer the read retry', () => {
  for (const failure of ['할 일', '프로젝트', '기억', '연결 확인', '로그인 확인']) {
    const f = fixture('all', [failure]);
    assert.match(text(f.tree), /목록을 불러오지 못했어요/);
    assert.match(text(f.tree), /항목이 없는지는 아직 알 수 없어요/);
    assert.doesNotMatch(text(f.tree), /아직 이 목록에 등록된 항목이 없어요|직접 추가하기/);
    assert.equal(text(f.button), '다시 불러오기');
    assert.equal(f.button.props.type, 'button');
    assert.ok(nodes(f.tree).some(node => node.props.role === 'status'));
    f.button.props.onClick?.();
    assert.deepEqual(f.calls, { add: 0, retry: 1 });
  }
});

test('selected lists use only their own failures; unrelated app failures do not hide an empty list', () => {
  const relevant: Record<AssistantListFilter, string[]> = {
    all: ['할 일', '프로젝트', '기억'], task: ['할 일'], waiting: ['할 일'], project: ['프로젝트'], memory: ['기억'],
  };
  for (const filter of Object.keys(relevant) as AssistantListFilter[]) {
    for (const failure of ['할 일', '프로젝트', '기억', '가계부', '운동·식단', '언어학습', '성장 기록', '연결 확인', '로그인 확인']) {
      const unavailable = relevant[filter].includes(failure) || ['연결 확인', '로그인 확인'].includes(failure);
      assert.equal(text(fixture(filter, [failure]).button), unavailable ? '다시 불러오기' : '직접 추가하기', `${filter}: ${failure}`);
    }
  }
});

const parsed = ts.createSourceFile('AssistantClient.tsx', client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found);
  return found;
}

test('actual open-form handler preserves existing draft, opens before focusing and is safe to repeat', () => {
  const declaration = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'showEntryForm') as ts.VariableDeclaration;
  const details = { open: false };
  let focuses = 0;
  const input = { value: 'already typed', focus: () => { assert.equal(details.open, true); focuses++; } };
  const context = { entryDetailsRef: { current: details }, entryInputRef: { current: input } };
  const show = vm.runInNewContext(compile(`const handler = ${declaration.initializer!.getText(parsed)}; handler;`), context) as () => void;
  show(); show();
  assert.equal(focuses, 2);
  assert.equal(input.value, 'already typed');
  const absent = vm.runInNewContext(compile(`const handler = ${declaration.initializer!.getText(parsed)}; handler;`), { entryDetailsRef: { current: null }, entryInputRef: { current: null } }) as () => void;
  assert.doesNotThrow(absent);
  assert.match(client, /<details id="assistant-entry-form" ref=\{entryDetailsRef\}/);
  assert.match(client, /<input ref=\{entryInputRef\} aria-label="추가할 내용" value=\{title\}/);
});

test('actual list branch retains existing rows and wires the empty retry to the existing read function', () => {
  const empty = findNode(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'AssistantListEmptyState');
  assert.ok(ts.isConditionalExpression(empty.parent) && ts.isConditionalExpression(empty.parent.parent));
  const expression = empty.parent.parent.getText(parsed);
  let reads = 0;
  const context = {
    require: (name: string) => { assert.equal(name, 'react/jsx-runtime'); return jsx; }, exports: {},
    AssistantListEmptyState: moduleExports.default, loading: false, rows: [] as unknown[], filter: 'memory',
    loadFailures: ['기억'], showEntryForm: () => {}, load: () => { reads++; }, filterLabels: { memory: '기억' },
  };
  const run = () => vm.runInNewContext(compile(`const tree = (${expression}); tree;`), { ...context }) as ReactNode;
  const emptyTree = run() as ReactElement<Props>;
  assert.equal(emptyTree.type, moduleExports.default);
  emptyTree.props.onRetry();
  assert.equal(reads, 1);
  context.rows = [{ id: 'synthetic-retained', kind: 'memory', title: 'Previously loaded note', done: false, created: '2026-10-26T12:00:00Z' }];
  const retained = run();
  assert.match(text(retained), /Previously loaded note/);
  assert.equal(nodes(retained).filter(node => node.type === 'article').length, 1);
  assert.ok(nodes(retained).every(node => node.type !== moduleExports.default));
  context.loading = true;
  assert.match(text(run()), /동기화 중/);
  assert.equal(reads, 1);
});
