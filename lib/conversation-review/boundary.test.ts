import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { createAssessmentAdapter } from './assessment-core.ts';
import { change, FIXTURE_SOURCE, RECEIVED_AT, request } from '../../tests/fixtures/conversation-review.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(path) && !path.endsWith('.test.ts') ? [path] : [];
  });
}

test('production wiring uses only the empty public registry; synthetic fixture imports never reach app modules', () => {
  const consumers: string[] = [];
  for (const file of ['app', 'components', 'data', 'lib', 'utils', 'services'].flatMap(directory => sources(join(root, directory)))) {
    const source = readFileSync(file, 'utf8');
    const path = relative(root, file);
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const imports = parsed.statements.filter(ts.isImportDeclaration);
    for (const statement of imports) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      assert.ok(!statement.moduleSpecifier.text.includes('fixtures/conversation-review'), `${path} imports synthetic assessments`);
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createAssessmentAdapter') consumers.push(path);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
  assert.deepEqual(consumers, ['lib/conversation-review/assessment.ts']);
});

test('contract modules have no storage/network/provider/course/Live/A2 effects or runtime activation flags', () => {
  for (const name of ['contract', 'assessment-core', 'assessment', 'projection', 'summary']) {
    const source = readFileSync(join(root, `lib/conversation-review/${name}.ts`), 'utf8');
    const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const permittedImports = new Set(['zod', './contract.ts', './assessment-core.ts', './projection.ts', '../../data/freeConversationCatalog.ts']);
    for (const statement of parsed.statements.filter(ts.isImportDeclaration)) {
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
      assert.ok(permittedImports.has(statement.moduleSpecifier.text), `${name} imports an unreviewed dependency`);
    }
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node)) assert.ok(!['fetch', 'localStorage', 'indexedDB', 'process', 'location', 'navigator', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'markTodayRoutineCompleted', 'reviewObservationFields'].includes(node.text), `${name} has an effect or activation surface: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
});

test('test adapter registries are immutable snapshots, not runtime registration handles', () => {
  const source = { ...structuredClone(FIXTURE_SOURCE) };
  const adapter = createAssessmentAdapter([source]);
  source.namespace = 'changed-after-construction';
  assert.equal(adapter(change(), request(), RECEIVED_AT).status, 'confirmed-change');
  const switched = request(); switched.source.namespace = 'changed-after-construction';
  assert.equal(adapter(change(switched), switched, RECEIVED_AT).status, 'unavailable');
});
