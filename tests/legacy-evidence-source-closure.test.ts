import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '..');
const repository = 'app/data/languageLegacyEvidenceRepository.ts';
const bridge = 'app/data/languageCloudSync.ts';
const registry = 'lib/language-legacy-evidence/receipt-proof.ts';
const store = 'lib/language-legacy-evidence/local-store.ts';
const allowed: Record<string, string[]> = {
  LocalEvidenceStore: [store, repository],
  languageLegacyEvidenceCapability: [bridge, repository],
  registerAuthenticatedReceiptReadback: [registry, repository],
  registerAuthenticatedPrefix: [registry, repository],
  registerAuthenticatedContext: [registry, repository],
  registerAuthenticatedAdmissionStatus: [registry, repository],
  registerAuthenticatedFirstAdmission: [registry, repository],
  registerAuthenticatedResetEvidenceState: [registry, repository],
  languageEvidenceResetCapability: ['app/data/languageResetFence.ts', repository],
  requireLanguageEvidenceCleanup: ['app/data/languageResetFence.ts', 'app/lib/resetAppRecords.ts'],
};
function files(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(name) : /\.(?:tsx?|[cm]?js)$/.test(name) && !/\.(?:test|spec)\./.test(name) ? [name] : [];
  });
}
function inspect(path: string, source: string) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const initializers = new Map<string, ts.Expression[]>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, [...(initializers.get(node.name.text) ?? []), node.initializer]);
    }
    node.forEachChild(collect);
  };
  collect(ast);
  const constant = (node: ts.Expression | undefined, seen = new Set<string>()): string | undefined => {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return constant(node.expression, seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left, seen), right = constant(node.right, seen);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isIdentifier(node) && !seen.has(node.text) && initializers.get(node.text)?.length === 1) {
      seen.add(node.text); return constant(initializers.get(node.text)![0], seen);
    }
  };
  const walk = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'LocalEvidenceStore') {
      assert.equal(path, repository, `${path}: unreviewed evidence store constructor`);
      const options = node.arguments?.[0];
      assert.ok(options && ts.isObjectLiteralExpression(options) && options.properties.some(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'writerAdmission'), `${path}: explicit admission binding required`);
    }
    if (ts.isIdentifier(node) && Object.hasOwn(allowed, node.text)) assert.ok(allowed[node.text].includes(path), `${path}: unauthorized evidence authority ${node.text}`);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly || ts.isExportDeclaration(node) && node.isTypeOnly) return;
      const name = node.moduleSpecifier.text;
      if (/languageLegacyEvidenceRepository(?:\.ts)?$/.test(name)) {
        assert.equal(path, 'app/lib/resetAppRecords.ts', `${path}: evidence consumer outside reviewed reset bridge`);
        assert.ok(ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings));
        for (const binding of node.importClause.namedBindings.elements) assert.equal((binding.propertyName ?? binding.name).text, 'cleanupLanguageLegacyEvidenceForReset');
      }
      if (/language-legacy-evidence\/local-store(?:\.ts)?$/.test(name)) {
        assert.equal(path, repository, `${path}: unreviewed evidence store import`);
        assert.ok(ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings), `${path}: no namespace/reexport store authority`);
      }
      if (/receipt-proof(?:\.ts)?$/.test(name)) {
        assert.ok([repository, store].includes(path), `${path}: unreviewed receipt registry consumer`);
        assert.ok(ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings), `${path}: no namespace/reexport receipt authority`);
      }
      assert.doesNotMatch(name, /(?:tests\/helpers|legacyEvidenceRepositoryHarness|\.test(?:\.|-))/, `${path}: production test-factory import`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const target = constant(node.arguments[0]);
      assert.ok(target, `${path}: unresolved dependency route requires review`);
      assert.doesNotMatch(target, /languageLegacyEvidenceRepository|receipt-proof|language-legacy-evidence\/local-store|legacyEvidenceRepositoryHarness/, `${path}: dynamic evidence authority`);
    }
    if (ts.isElementAccessExpression(node)) {
      const member = constant(node.argumentExpression);
      if (member && Object.hasOwn(allowed, member)) assert.ok(allowed[member].includes(path));
    }
    node.forEachChild(walk);
  };
  walk(ast);
}
test('inactive capture and reset-only repository bridge preserve narrow registered proof producer closure', () => {
  for (const path of ['app', 'components', 'utils', 'hooks', 'lib', 'services', 'public', 'data'].flatMap(files)) inspect(path, readFileSync(resolve(root, path), 'utf8'));
  const source = readFileSync(resolve(root, repository), 'utf8');
  assert.match(source, /import \{ createClient \} from '\.\.\/\.\.\/lib\/supabase\.ts'/);
  assert.doesNotMatch(source, /languageConversationCapability|authenticatedReadback.*\bas\b|isCurrent:\s*\(\)\s*=>\s*true/);
  const release = readFileSync(resolve(root, 'app/data/languageLegacyEvidenceRelease.ts'), 'utf8');
  assert.match(release, /resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false/);
  const reset = readFileSync(resolve(root, 'app/lib/resetAppRecords.ts'), 'utf8');
  assert.match(reset, /if \(LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol === 'protocol-required'\)/);
  assert.ok(reset.indexOf('context = await requireLanguageEvidenceCleanup') < reset.indexOf('context = await cleanupLanguageLegacyEvidenceForReset'));
  assert.ok(reset.indexOf('context = await cleanupLanguageLegacyEvidenceForReset') < reset.indexOf('context = await completeLanguageReset'));
});
test('source closure rejects copied authority import aliases, namespace, reexports and test loader routes', () => {
  for (const source of [
    `import { languageLegacyEvidenceCapability as hidden } from './languageCloudSync.ts';`,
    `import * as hidden from '../lib/language-legacy-evidence/receipt-proof.ts';`,
    `export { registerAuthenticatedPrefix as hidden } from '../lib/language-legacy-evidence/receipt-proof.ts';`,
    `const hidden = import('./languageLegacyEvidenceRepository.ts');`,
    `const route = './languageLegacy' + 'EvidenceRepository.ts'; const hidden = import(route);`,
    `export function hidden(route: string) { return import(route); }`,
    `const key = 'registerAuthenticated' + 'Prefix'; const hidden = registry[key];`,
    `import * as hidden from '../lib/language-legacy-evidence/local-store.ts';`,
    `const hidden = import('../lib/language-legacy-evidence/local-store.ts');`,
    `const key = 'LocalEvidence' + 'Store'; const hidden = registry[key];`,
    `import { loadLegacyEvidenceRepository } from '../tests/helpers/legacyEvidenceRepositoryHarness.ts';`,
  ]) assert.throws(() => inspect('app/data/unreviewed.ts', source));
});
