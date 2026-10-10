import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { test } from 'node:test';
import { append, commit, save, started } from './fixtures.test-support.ts';

const root = new URL('../../', import.meta.url).pathname;
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]); }

test('pure foundation has no storage/provider/A2/clock authority; P2-C admits only the reviewed hook/recap imports', () => {
  for (const name of ['contracts.ts', 'reducer.ts', 'recap.ts']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket|Date\.now|Math\.random|randomUUID|setInterval|setTimeout)\s*[.(]/);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:app\/|evidence-store|localEvidenceStore|supabase|react)[^'"]*['"]/);
  }
  for (const file of ['app', 'components', 'data', 'hooks', 'services', 'utils'].flatMap(dir => files(join(root, dir)))) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.test.ts')) continue;
    if (['app/data/languageLocalParticipants.ts', 'app/data/languageCloudSync.ts', 'app/data/conversationLocalRecords.ts'].some(path => file === join(root, path))) continue;
    assertUiPureImport(relative(root, file), readFileSync(file, 'utf8'));
  }
});

test('planners perform deterministic work without reading current time', () => {
  const original = Date.now; Date.now = () => { throw new Error('clock access denied'); };
  try { const e = save(started()); assert.deepEqual(commit(e, append(e)), commit(e, append(e))); }
  finally { Date.now = original; }
});

const UI_PURE_IMPORTS: Record<string, { module: string; names: readonly string[]; typeOnly?: boolean }> = {
  'components/language/useConversationSession.ts': { module: 'contracts', names: ['CONVERSATION_LIMITS', 'exact', 'sourceRef', 'supportedSource', 'isGuidedSource', 'getConversationStep', 'getConversationProgress', 'ConversationDraft', 'ConversationSession', 'ConversationCommand'] },
  'app/language/conversation/page.tsx': { module: 'recap', names: ['projectClosedConversationRecap'] },
  'components/language/ConversationSessionRecap.tsx': { module: 'recap', names: ['projectClosedConversationRecap'], typeOnly: true },
};
function assertUiPureImport(path: string, text: string) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.includes('conversation-session/')) {
      const allowed = UI_PURE_IMPORTS[path]; assert.ok(allowed, `${path}: pure conversation imports require review`);
      assert.ok(ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings), `${path}: only named static pure imports are reviewed`);
      assert.ok(node.moduleSpecifier.text.replace(/\.ts$/, '').endsWith(`/conversation-session/${allowed.module}`), `${path}: unreviewed pure module`);
      if (allowed.typeOnly) assert.equal(node.importClause.isTypeOnly, true, `${path}: recap renderer is type-only`);
      for (const element of node.importClause.namedBindings.elements) assert.ok(allowed.names.includes(element.propertyName?.text ?? element.name.text), `${path}: unreviewed pure export`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      for (const argument of node.arguments) assert.doesNotMatch(argument.getText(source), /conversation-session/, `${path}: no dynamic pure import escape`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

test('P2C pure importer allowance rejects page planners, recap runtime authority and alternate import routes', () => {
  for (const [path, source] of [
    ['app/language/conversation/page.tsx', "import { planApply } from '@/lib/conversation-session/reducer';"],
    ['components/language/ConversationSessionRecap.tsx', "import { projectClosedConversationRecap } from '../../lib/conversation-session/recap';"],
    ['components/language/useConversationSession.ts', "export { CONVERSATION_LIMITS } from '../../lib/conversation-session/contracts';"],
    ['components/language/useConversationSession.ts', "import * as model from '../../lib/conversation-session/contracts';"],
    ['components/language/useConversationSession.ts', "const model = await import('../../lib/conversation-session/contracts');"],
    ['components/unreviewed.tsx', "import { CONVERSATION_LIMITS } from '../lib/conversation-session/contracts';"],
  ]) assert.throws(() => assertUiPureImport(path, source));
});
