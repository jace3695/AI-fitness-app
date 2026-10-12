import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { emptySentenceTypingDraft, makeSentenceTypingSession, TYPING_PASSAGES } from '../lib/sentence-typing-draft.ts';
import { calculateTypingMetrics } from '../app/data/growthPlatform.ts';
import { typingMistakes, typingTrend } from '../app/data/practiceEvidence.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, category: 'typing', target_minutes: 15 };

// Render the shipping component with deterministic data/hook boundaries. React's
// textarea HTML includes its controlled value as descendant text, as does the
// browser's defaultValue synchronization. An enclosing label would therefore
// change Playwright's exact label text after typing or checkpoint restoration.
function render(typed: string, pending: boolean) {
  const startedAt = Date.parse('2026-10-09T10:00:00Z');
  const draft = { ...emptySentenceTypingDraft(owner, null), typed, startedAt: typed ? startedAt : null };
  const practice = { draft: { ...draft, pending: pending ? makeSentenceTypingSession(draft, routine, owner, '2026-10-09', startedAt + 1000) : null }, ready: true,
    storageError: false, saving: false, saved: false, notice: '', loadError: false, confirmedRow: null };
  const modules = {
    'react/jsx-runtime': jsx,
    react: { useRef: () => ({ current: null }), useMemo: (factory: () => unknown) => factory() },
    '@/components/AppCompanion': { default: () => null },
    'next/link': { default: () => null },
    '../../components/AppIdentity': { default: () => null },
    '../../data/growthPlatform': { calculateTypingMetrics },
    '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' },
    '../useGrowthData': { useGrowthData: () => ({ routines: [routine], sessions: [], dataReady: true, loading: false }) },
    '../../data/practiceEvidence': { typingMistakes, typingTrend },
    '@/components/useUnsavedChanges': { useUnsavedChanges() {} },
    '@/app/lib/supabase': { supabase: null },
    '@/lib/sentence-typing-draft': { TYPING_PASSAGES },
    './useSentenceTypingPractice': { useSentenceTypingPractice: () => practice },
  };
  const exports = {} as { SentenceTypingPractice: (props: unknown) => Parameters<typeof renderToStaticMarkup>[0] };
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/typing/page.tsx', import.meta.url), 'utf8') + '\nexport { SentenceTypingPractice };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Date })(exports, (name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules];
  });
  return renderToStaticMarkup(exports.SentenceTypingPractice({ owner, isOwnerActive: () => true }));
}

for (const [typed, pending] of [['', false], ['xx', false], ['A 합성 입력', true], ['업데이트 대기', true]] as const) {
  test(`sentence input keeps a stable explicit label with ${typed || 'empty input'} and pending=${pending}`, () => {
    const html = render(typed, pending);
    const label = html.match(/<label\b[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/);
    assert.ok(label, 'the input has a separate explicitly associated label');
    assert.equal(label[2], '입력 칸', 'label text cannot absorb controlled textarea content');
    const textarea = html.match(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/);
    assert.ok(textarea);
    assert.match(textarea[1], new RegExp(`\\bid="${label[1]}"`));
    assert.equal(textarea[2], typed);
    assert.equal(/\breadonly=""/i.test(textarea[1]), pending);
  });
}
