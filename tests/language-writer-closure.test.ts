import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { LANGUAGE_STORAGE_KEYS } from '../app/data/languageStorageBoundary.ts';
import { APP_RECORD_KEYS } from '../app/data/appRecordReset.ts';
import { buildFreeAdviceContext } from '../lib/free-advice-context.ts';
import { buildLanguageDailyStatus } from '../app/data/dailyAppStatus.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const routes = ['page', 'learn/page', 'review/page', 'progress/page', 'settings/page', 'kana/page', 'words/page', 'sentences/page', 'grammar/page', 'calendar/page', 'speaking/page', 'conversation/page'].map(path => `app/language/${path}.tsx`);
const helpers = ['utils/curriculumProgress.ts', 'utils/dailyRoutineProgress.ts', 'utils/integratedLearningSettings.ts', 'utils/learningSession.ts'];
const components = ['FocusedLesson', 'KanaStarter', 'LearningWelcome', 'CourseReviewQuestion'].map(name => `components/language/${name}.tsx`);
const domains = ['Course', 'Daily', 'Legacy', 'Review', 'Settings'].map(name => `app/data/language${name}Mutations.ts`);
const removed = new Set(['saveCurriculumProgress', 'saveIntegratedLearningSettings', 'saveTodayRoutineCompletedIds', 'markTodayRoutineCompleted', 'saveToStorage']);
function tree(path: string) { return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function walk(node: ts.Node, visit: (node: ts.Node) => void) { visit(node); node.forEachChild(child => walk(child, visit)); }
function productionFiles(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? productionFiles(path) : /\.(?:tsx?|[cm]?js)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : [];
  });
}

test('closure manifest fixes exact sixteen selected keys, twelve reset records and unchanged settings retention', () => {
  assert.deepEqual(new Set(LANGUAGE_STORAGE_KEYS), new Set(['japaneseCurriculumProgressV1', 'japaneseCurriculumReviewV1', 'reviewCompletedItemsByDate', 'dailyRoutineProgress', 'dailyLearningHistory', 'integratedLearningSettingsV1', 'japaneseAppSettings', 'learningSettings', 'savedWords', 'savedSentences', 'wrongKana', 'wrongKanaChars', 'wrongWords', 'wrongSentences', 'grammarProgress', 'languageRecordResetV1']));
  assert.equal(APP_RECORD_KEYS.language.length, 12);
  for (const key of ['japaneseAppSettings', 'integratedLearningSettingsV1', 'learningSettings']) assert.ok(!APP_RECORD_KEYS.language.includes(key));
  for (const path of [...routes, ...helpers, ...components, ...domains]) assert.ok(existsSync(resolve(ROOT,path)), `Closure participant missing: ${path}`);
});

test('every business route/component/helper is free of direct Storage, hidden aliases and removed raw-save helpers', () => {
  for (const path of [...routes, ...helpers, ...components, ...domains]) {
    walk(tree(path), node => {
      if (ts.isIdentifier(node)) assert.ok(!['localStorage', 'sessionStorage', 'Storage', ...removed].includes(node.text), `${path}: forbidden storage capability/helper ${node.text}`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) assert.ok(!['setItem', 'removeItem', 'getItem'].includes(node.expression.name.text), `${path}: raw Storage call ${node.expression.getText()}`);
      if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) assert.ok(!['localStorage','sessionStorage','setItem','removeItem','getItem'].includes(node.argumentExpression.text), `${path}: computed Storage alias`);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) assert.doesNotMatch(node.moduleSpecifier.text, /(?:recordStorage|cloudSync|languageResetFence|languageStorageBoundary)(?:\.ts)?$/, `${path}: do not import general storage authority (boundary types are checked below)`);
    });
  }
});

test('pure projection calls must receive coherent bytes, never an omitted implicit storage source', () => {
  for (const path of [...routes, ...components]) walk(tree(path), node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const count = node.expression.text === 'getTodayRoutineCompletedIds' ? 2 : ['loadCurriculumProgress','loadIntegratedLearningSettings'].includes(node.expression.text) ? 1 : 0;
    if (count) assert.ok(node.arguments.length >= count, `${path}: ${node.expression.text} requires explicit source bytes`);
  });
});

test('only the central domain runner invokes the adapter business writer; marker remains boundary-only', () => {
  const files = ['app','components','utils','hooks','lib','services','public','data'].filter(path => existsSync(resolve(ROOT,path))).flatMap(productionFiles);
  const consumers: string[] = [];
  for (const path of files) {
    const ast = tree(path);
    walk(ast, node => {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === 'updateLanguageRecords') consumers.push(path);
          if (removed.has(imported)) assert.fail(`${path}: removed raw writer imported as ${element.name.text}`);
        }
      }
    });
  }
  assert.deepEqual([...new Set(consumers)], ['app/data/languageRecordMutations.ts']);
  for (const path of domains) assert.doesNotMatch(read(path), /['"]languageRecordResetV1['"]|from\s+['"]react['"]|\b(?:localStorage|fetch|supabase)\b/);
});

const REVIEWED_STORAGE_AUTHORITY = new Set([
  'app/data/languageCloudSync.ts', 'app/data/languageStorageBoundary.ts', 'app/data/languageResetFence.ts',
  'app/data/storageTransaction.ts', 'app/data/cloudSync.ts', 'app/lib/resetAppRecords.ts', 'app/components/RecordResetPanel.tsx',
  // These retained nonlanguage capabilities use independent, fixed namespaces.
  'components/useYeoniPreferences.ts', 'lib/syncQaTrace.ts', 'app/budget/lib/pending-save.ts',
  'components/LanguageCloudSync.tsx', 'app/data/languageSyncCoordinator.ts',
]);
const rawNames = new Set(['localStorage','sessionStorage','Storage','getItem','setItem','removeItem','writeStorageBatch','updateStorageBatch','updateStorageBatchWithReceipt','writeJson','updateJson']);
const parsedSources = new Map<string, ts.SourceFile>();
function parsed(path: string) { let source = parsedSources.get(path); if (!source) { source = tree(path); parsedSources.set(path,source); } return source; }
function resolveDependency(path: string, name: string): string | null {
  if (!name.startsWith('.') && !name.startsWith('@/')) return null;
  if (/\.(?:css|svg|png|webp|jpg|json)$/.test(name)) return null;
  const base = name.startsWith('@/') ? resolve(ROOT,name.slice(2)) : resolve(ROOT,dirname(path),name);
  const found = [base,`${base}.ts`,`${base}.tsx`,`${base}.js`,`${base}.mjs`,`${base}.cjs`,`${base}/index.ts`,`${base}/index.tsx`,`${base}/index.js`,`${base}/index.mjs`].find(candidate => /\.(?:tsx?|[cm]?js)$/.test(candidate) && existsSync(candidate));
  assert.ok(found, `${path}: unresolved internal dependency ${name} must be reviewed, not skipped`);
  return relative(ROOT,found);
}
function constantString(expression: ts.Expression, path: string, seen = new Set<string>()): string | undefined {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) return constantString(expression.expression,path,seen);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) { const a = constantString(expression.left,path,seen), b = constantString(expression.right,path,seen); return a === undefined || b === undefined ? undefined : a + b; }
  if (!ts.isIdentifier(expression)) return undefined;
  const token = `${path}:${expression.text}`; if (seen.has(token)) return undefined; seen.add(token);
  const declarations: ts.Expression[] = [];
  walk(parsed(path), node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text && node.initializer) declarations.push(node.initializer); });
  if (declarations.length === 1) return constantString(declarations[0],path,seen);
  for (const statement of parsed(path).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    const spec = statement.importClause.namedBindings.elements.find(element => element.name.text === expression.text); if (!spec) continue;
    const dependency = resolveDependency(path,statement.moduleSpecifier.text); if (!dependency) continue;
    return constantString(ts.factory.createIdentifier(spec.propertyName?.text ?? spec.name.text),dependency,seen);
  }
  return undefined;
}
function scanReachableStorage(roots: readonly string[]) {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return; seen.add(path);
    const reviewed = REVIEWED_STORAGE_AUTHORITY.has(path);
    walk(parsed(path), node => {
      if (!reviewed && ts.isIdentifier(node)) assert.ok(!rawNames.has(node.text), `${path}: undeclared reachable storage authority ${node.text}`);
      if (!reviewed && ts.isElementAccessExpression(node)) { const name = constantString(node.argumentExpression,path); if (name) assert.ok(!rawNames.has(name), `${path}: computed raw-storage alias ${name}`); }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly || ts.isExportDeclaration(node) && node.isTypeOnly) return;
        const dependency = resolveDependency(path,node.moduleSpecifier.text); if (dependency) visit(dependency);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        assert.equal(node.arguments.length,1,`${path}: dynamic dependency route requires review`);
        const name = constantString(node.arguments[0],path); assert.ok(name,`${path}: computed dependency route requires review`);
        const dependency = resolveDependency(path,name); if (dependency) visit(dependency);
      }
    });
  };
  roots.forEach(visit); return seen;
}

test('reachable helpers including reexports/index/dynamic imports cannot hide undeclared storage authority', () => {
  const seen = scanReachableStorage([...routes,...components,...helpers,...domains]);
  assert.ok(seen.has('app/data/languageRecordMutations.ts')); assert.ok(seen.has('app/data/languageRecordDocuments.ts'));
});

test('global production selected-key aliases and adapter namespace/reexport routes stay inside reviewed closure', () => {
  const files = ['app','components','utils','hooks','lib','services','public','data'].filter(path => existsSync(resolve(ROOT,path))).flatMap(productionFiles);
  const selectedRoots = new Set<string>();
  for (const path of files) walk(parsed(path), node => {
    if (ts.isIdentifier(node) && node.text === 'updateLanguageRecords') assert.ok(['app/data/languageCloudSync.ts','app/data/languageRecordMutations.ts'].includes(path),`${path}: adapter authority alias/reexport outside domain runner`);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && /languageCloudSync(?:\.ts)?$/.test(node.moduleSpecifier.text)) {
      assert.ok(!ts.isExportDeclaration(node),`${path}: adapter authority cannot be reexported`);
      if (ts.isImportDeclaration(node)) assert.ok(!node.importClause?.namedBindings || !ts.isNamespaceImport(node.importClause.namedBindings),`${path}: namespace import hides adapter authority`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
      const name = constantString(node.arguments[0],path); if (name) assert.doesNotMatch(name,/languageCloudSync(?:\.ts)?$/,`${path}: dynamic adapter authority import`);
    }
    if (!ts.isCallExpression(node)) return;
    const keys = node.arguments.map(argument => constantString(argument,path)).filter((value): value is string => value !== undefined && (LANGUAGE_STORAGE_KEYS as readonly string[]).includes(value));
    if (!keys.length) return;
    selectedRoots.add(path);
    const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isElementAccessExpression(node.expression) ? constantString(node.expression.argumentExpression,path) : ts.isIdentifier(node.expression) ? node.expression.text : undefined;
    if (method && rawNames.has(method)) assert.ok(REVIEWED_STORAGE_AUTHORITY.has(path),`${path}: selected-key raw/generic operation ${method}(${keys.join(',')})`);
  });
  scanReachableStorage([...selectedRoots]);
});

test('closure scanner rejects hidden helper aliases and unsupported dependency routes', () => {
  for (const [index, source] of [
    'export function save(store: unknown) { const alias = window.localStorage; alias.setItem("savedWords", "[]"); }',
    'const name = "set" + "Item"; export function save(store: Record<string, Function>) { store[name]("savedWords", "[]"); }',
    'export async function save(route: string) { const helper = await import(route); helper.save(); }',
    'export { save } from "./not-a-reviewed-helper";',
  ].entries()) {
    const path = `tests/synthetic-language-capability-${index}.ts`;
    parsedSources.set(path,ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true));
    assert.throws(() => scanReachableStorage([path]), /storage authority|raw-storage alias|dependency route|unresolved internal dependency/);
    parsedSources.delete(path);
  }
});

test('global raw storage capability inventory cannot silently grow or change outside the reviewed boundary', () => {
  const manifest = JSON.parse(read('tests/helpers/languageStorageCapabilities.json')) as { files: Record<string,string> };
  const files = ['app','components','utils','hooks','lib','services','public','data'].filter(path => existsSync(resolve(ROOT,path))).flatMap(productionFiles);
  for (const path of files) {
    if (REVIEWED_STORAGE_AUTHORITY.has(path)) continue;
    let rawAuthority = false;
    walk(parsed(path), node => {
      if (ts.isIdentifier(node) && ['localStorage','sessionStorage','getItem','setItem','removeItem'].includes(node.text)) rawAuthority = true;
      if (ts.isElementAccessExpression(node)) { const key = constantString(node.argumentExpression,path); if (key && rawNames.has(key)) rawAuthority = true; }
    });
    if (!rawAuthority) continue;
    assert.ok(manifest.files[path], `${path}: newly exposed raw Storage capability requires selected-key audit`);
    assert.equal(createHash('sha256').update(read(path)).digest('hex'),manifest.files[path],`${path}: changed external storage capability requires a renewed selected-key call-chain audit`);
  }
});

const REVIEWED_IMPORTERS = new Set([...REVIEWED_STORAGE_AUTHORITY,...routes,...components,...helpers,...domains,
  'app/data/languageRecordMutations.ts','app/data/languageRecordDocuments.ts','app/data/languageRecordIdentity.ts',
  'components/language/LanguageRecordsProvider.tsx','components/language/useLanguageRecordSnapshot.ts','components/language/useLanguageMutationAction.ts',
]);
function capabilityImporters(files: readonly string[]): Set<string> {
  const edges = new Map<string,Set<string>>();
  for (const path of files) {
    const imports = new Set<string>(); edges.set(path,imports);
    walk(parsed(path), node => {
      let specifier: ts.Expression | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly || ts.isExportDeclaration(node) && node.isTypeOnly) return;
        specifier = node.moduleSpecifier;
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0];
      if (!specifier) return;
      const name = constantString(specifier,path); assert.ok(name,`${path}: computed module route needs explicit capability review`);
      const dependency = resolveDependency(path,name); if (dependency) imports.add(dependency);
    });
  }
  const capable = new Set(['app/data/recordStorage.ts','app/data/storageTransaction.ts','app/data/languageCloudSync.ts']);
  let expanded = true;
  while (expanded) { expanded = false; for (const [path,imports] of edges) if (!capable.has(path) && [...imports].some(dependency => capable.has(dependency))) { capable.add(path); expanded = true; } }
  return capable;
}
function assertImporterReviewed(path: string, manifest: Record<string,string>) {
  if (REVIEWED_IMPORTERS.has(path)) return;
  assert.ok(manifest[path],`${path}: new transitive storage-capability importer requires selected-key audit`);
  assert.equal(createHash('sha256').update(read(path)).digest('hex'),manifest[path],`${path}: changed transitive storage-capability importer requires renewed selected-key audit`);
}
test('every transitive generic-storage caller is reviewed even when its key is computed and its import is aliased', () => {
  const manifest = JSON.parse(read('tests/helpers/languageStorageCapabilities.json')) as {importers:Record<string,string>};
  const files = ['app','components','utils','hooks','lib','services','public','data'].filter(path => existsSync(resolve(ROOT,path))).flatMap(productionFiles);
  const capable = capabilityImporters(files); for (const path of capable) assertImporterReviewed(path,manifest.importers);
  const hidden = 'data/synthetic-hidden-writer.mjs';
  parsedSources.set(hidden,ts.createSourceFile(hidden,`import { writeJson as persist } from '@/app/data/recordStorage'; const key = ['saved','Words'].join(''); export const save = () => persist(key, []);`,ts.ScriptTarget.Latest,true));
  assert.ok(capabilityImporters([...files,hidden]).has(hidden),'Alias/computed key must not hide inherited write capability');
  assert.throws(() => assertImporterReviewed(hidden,manifest.importers),/new transitive storage-capability importer/);
  parsedSources.delete(hidden);
});

test('additive inner operation receipts do not change established remote summary compatibility', () => {
  const base = { japaneseCurriculumProgressV1: JSON.stringify({ activityDates:['2026-10-09'], completedLessonIds:['lesson'], lessonAttempts:{} }), dailyRoutineProgress: JSON.stringify({date:'2026-10-09',completedIds:['words']}), grammarProgress:'[]', japaneseCurriculumReviewV1:'[]' };
  const extended = { ...base, japaneseCurriculumProgressV1: JSON.stringify({ ...JSON.parse(base.japaneseCurriculumProgressV1), languageFinishReceiptsV1:{version:1,operations:{op:{payload:'exact full payload',result:{score:100}}}} }) };
  const now = new Date('2026-10-09T12:00:00Z');
  assert.deepEqual(buildFreeAdviceContext('language', {languageState:extended}, now), buildFreeAdviceContext('language',{languageState:base},now));
  assert.deepEqual(buildLanguageDailyStatus(extended,'2026-10-09'), buildLanguageDailyStatus(base,'2026-10-09'));
});
