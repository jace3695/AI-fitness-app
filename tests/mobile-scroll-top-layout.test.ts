import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';

const source = readFileSync(new URL('../components/ScrollTopButton.tsx', import.meta.url), 'utf8');
const css = postcss.parse(readFileSync(new URL('../components/scroll-top-button.module.css', import.meta.url), 'utf8'));
function style(width: number) {
  const values: Record<string, string> = {};
  css.walkRules(rule => {
    if (rule.selector !== '.button') return;
    const parent = rule.parent;
    if (parent?.type === 'atrule') {
      const max = parent.params.match(/max-width:\s*(\d+)px/);
      if (!max || width > Number(max[1])) return;
    }
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}
test('mobile TOP occupies document space instead of covering unfocused fields', () => {
  for (const width of [320, 390, 767]) {
    const actual = style(width);
    assert.equal(actual.position, 'static'); assert.equal(actual.bottom, 'auto');
    assert.equal(actual['min-height'], '48px'); assert.equal(actual['z-index'], 'auto');
  }
});
test('desktop TOP retains its fixed accessible control', () => {
  assert.equal(style(768).position, 'fixed'); assert.equal(style(1024)['min-height'], '48px');
});
test('scroll action preserves smooth and reduced-motion behavior', () => {
  const start = source.indexOf('  const handleClick ='); const end = source.indexOf('\n  if (!visible)', start);
  assert.ok(start >= 0 && end > start);
  for (const reduced of [true, false]) {
    let result: unknown;
    vm.runInNewContext(source.slice(start, end) + '\nhandleClick();', {
      window: { matchMedia: () => ({ matches: reduced }), scrollTo: (value: unknown) => { result = value; } },
    });
    assert.deepEqual(structuredClone(result), { top: 0, behavior: reduced ? 'instant' : 'smooth' });
  }
});
test('mobile flow control follows app content and remains hidden during editing or dialogs', () => {
  const gate = readFileSync(new URL('../app/components/AuthGate.tsx', import.meta.url), 'utf8');
  assert.match(gate, /\{children\}<HubBottomNav/);
  assert.match(source, /window\.scrollY > SHOW_AFTER_SCROLL_Y && !editing/);
  assert.match(css.toString(), /aria-modal="true".*display: none/);
});
