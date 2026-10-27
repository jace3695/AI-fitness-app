import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from '../node_modules/esbuild/lib/main.js';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

export const outputDirectory = resolve('.e2e/component-browser/site');
export async function buildComponentSite() {
  await mkdir(outputDirectory, { recursive: true });
  // Source components and their actual styles; no broad sizing overrides hiding defects.
  await build({ entryPoints: ['scripts/browser-qa/cloud/entry.tsx'], bundle: true,
    outdir: outputDirectory, entryNames: 'fixture', platform: 'browser', format: 'iife',
    external: ['/yeoni-cat-sprite-v1.webp'],
    jsx: 'automatic', define: {
      // Standalone fixture only: never inherit hosted credentials or Next runtime flags.
      // Real archive/auth components remain present but explicitly unconfigured.
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': 'undefined',
      'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'undefined',
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': 'undefined',
      'process.env.__NEXT_ROUTER_BASEPATH': '""',
      'process.env.__NEXT_I18N_SUPPORT': 'false',
      'process.env.__NEXT_LINK_NO_TOUCH_START': 'false',
      'process.env.__NEXT_MANUAL_CLIENT_BASE_PATH': 'false',
      'process.env.__NEXT_MANUAL_TRAILING_SLASH': 'false',
      'process.env.__NEXT_TRAILING_SLASH': 'false',
    },
    tsconfig: 'tsconfig.json', logLevel: 'warning' });
  const styles = await postcss([tailwindcss({ content: [
    './scripts/browser-qa/cloud/**/*.tsx', './components/**/*.tsx', './app/components/**/*.tsx',
    './app/language/practice/**/*.tsx',
  ] })]).process(await readFile(resolve(outputDirectory, 'fixture.css'), 'utf8'), { from: undefined });
  await writeFile(resolve(outputDirectory, 'fixture.css'), styles.css);
  await writeFile(resolve(outputDirectory, 'index.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated component QA</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js" defer></script></body></html>');
}
if (process.argv.includes('--build-only')) await buildComponentSite();
