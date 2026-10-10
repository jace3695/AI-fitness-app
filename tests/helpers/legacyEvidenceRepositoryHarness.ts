/** Test/CI-only module substitution. All registries, producer/consumer modules and
 * coordinator code execute from source in one native module graph. Only the app's
 * fixed singleton import is redirected to the permitted synthetic/local client. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE, type LanguageLegacyEvidenceRelease } from '../../app/data/languageLegacyEvidenceRelease.ts';
import type * as Repository from '../../app/data/languageLegacyEvidenceRepository.ts';

export async function loadLegacyEvidenceRepository(client: unknown, release: LanguageLegacyEvidenceRelease = LANGUAGE_LEGACY_EVIDENCE_RELEASE): Promise<typeof Repository> {
  const path = new URL('../../app/data/languageLegacyEvidenceRepository.ts', import.meta.url);
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = new Map<string, unknown>();
  for (const match of source.matchAll(/require\("([^"]+)"\)/g)) {
    const name = match[1];
    if (dependencies.has(name)) continue;
    dependencies.set(name, name === '../../lib/supabase.ts' ? { createClient: () => client } :
      name === './languageLegacyEvidenceRelease.ts' ? { LANGUAGE_LEGACY_EVIDENCE_RELEASE: Object.freeze({ ...release }) } :
      await import(name.startsWith('.') ? new URL(name, path).href : name));
  }
  const exported = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Date, crypto: globalThis.crypto, structuredClone, TextEncoder, AbortController, Set, Map, WeakMap, WeakSet,
  })(exported, (name: string) => {
    if (!dependencies.has(name)) throw new Error('Unexpected repository dependency');
    return dependencies.get(name);
  });
  return exported as typeof Repository;
}
