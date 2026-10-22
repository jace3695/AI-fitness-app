import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss, { type Document } from 'postcss';

const css = postcss.parse(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'));
const pwa = readFileSync(new URL('../app/components/PwaManager.tsx', import.meta.url), 'utf8');

// CSS contract only: evaluate the actual notice declarations at breakpoint edges.
// Tailwind's fixed/right/z utilities precede the app's global override.
function noticeStyle(width: number, install: boolean) {
  const classes = new Set(['yeoni-pwa-notice', ...(install ? ['yeoni-pwa-install'] : ['yeoni-pwa-banner'])]);
  const style: Record<string, string> = { position: 'fixed', right: '0.75rem', 'z-index': '110' };
  css.walkRules(rule => {
    let parent: typeof rule.parent | Document = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && parent.name === 'media') {
        const max = parent.params.match(/max-width:\s*(\d+)px/);
        const min = parent.params.match(/min-width:\s*(\d+)px/);
        if ((max && width > Number(max[1])) || (min && width < Number(min[1]))) return;
      }
      parent = parent.parent;
    }
    if (!rule.selectors.some(selector => /^\.[\w-]+(?:\.[\w-]+)*$/.test(selector) && selector.split('.').slice(1).every(name => classes.has(name)))) return;
    rule.walkDecls(declaration => { style[declaration.prop] = declaration.value; });
  });
  return style;
}

test('both browser install and iOS guidance use the non-overlay mobile layout', () => {
  for (const marker of ['if (installPrompt)', 'if (showIosInstallHint)']) {
    const branch = pwa.slice(pwa.indexOf(marker));
    assert.match(branch.match(/<div className="([^"]+)"/)![1], /yeoni-pwa-install/);
  }
});
test('390px and mobile breakpoint reserve normal document space for installation', () => {
  for (const width of [320, 390, 767]) {
    const style = noticeStyle(width, true);
    assert.equal(style.position, 'static');
    assert.equal(style.bottom, 'auto'); assert.equal(style.right, 'auto');
    assert.equal(style['z-index'], 'auto');
  }
});
test('desktop installation and urgent update banners retain existing fixed placement', () => {
  assert.equal(noticeStyle(768, true).position, 'fixed');
  assert.equal(noticeStyle(390, false).position, 'fixed');
});
test('bottom menu keeps safe-area and scroll clearance instead of removing navigation', () => {
  const text = css.toString();
  assert.match(text, /body\.has-hub-bottom-nav\s*\{[^}]*padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(text, /scroll-padding-bottom:\s*calc\(96px \+ env\(safe-area-inset-bottom\)\)/);
});
