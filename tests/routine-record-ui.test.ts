import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as status from '../app/data/dailyAppStatus.ts';
import * as progression from '../app/data/growthRoutineProgression.ts';
import * as platform from '../app/data/growthPlatform.ts';
import * as schedule from '../app/data/growthSchedule.ts';
import * as routines from '../app/data/growthRoutines.ts';
import { emptyRoutineDraft, emptyRoutineForm, makeRoutineAttempt } from '../lib/routine-record-recovery.ts';
const owner = '00000000-0000-4000-8000-000000000001', day = '2026-10-09';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, category: 'custom', title: '합성 루틴', target_minutes: 15, preferred_days: [1,2,3,4,5,6,7], target_sessions_per_week: 7, enabled: true } as platform.GrowthRoutineRow;
type Element = ReactElement<Record<string, unknown>>;
function fixture() {
  const requests: unknown[] = [], changes: unknown[] = [], deleted: string[] = [];
  const recovery = { draft: emptyRoutineDraft(owner, null, day), ready: true, blocked: false, saving: false, notice: '', storageError: false, loadError: false,
    changeForm(mode: string, value: unknown) { changes.push({ mode, value }); }, start(value: unknown) { requests.push({ start: value }); },
    save: async (mode: string, value: unknown, state?: string) => { requests.push({ mode, value, state }); return null; }, retryLoad() {}, retryCheckpoint() {}, discardActive() {} };
  const growth = { user: { id: owner }, routines: [routine], sessions: [] as platform.GrowthSessionRow[], loading: false, notice: '', legacyBackupAvailable: false,
    setNotice() {}, refresh: async () => {}, deleteSession: async (id: string) => { deleted.push(id); }, removeRoutine: async (id: string) => { deleted.push(id); } };
  const slots: unknown[] = []; let cursor = 0;
  const modules = {
    'react/jsx-runtime': jsx,
    react: { useEffect() {}, useMemo: (fn: () => unknown) => fn(), useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; } },
    '@/lib/assistant-growth-command': { growthSessionTimeLabel: (row: platform.GrowthSessionRow) => row.metrics.actualMinutesRecorded === false ? '시간 미기록' : `${row.actual_minutes}분` },
    '@/components/AppCompanion': { default: () => null }, '@/components/RoutineElapsedTime': { default: () => null },
    'next/link': { default: () => null }, '../components/AppIdentity': { default: () => null }, '../lib/supabase': { supabase: null },
    '../data/dailyAppStatus': status, '../data/growthRoutineProgression': progression, '../data/growthPlatform': platform,
    '../data/growthSchedule': schedule, '../data/growthRoutines': routines, '@/utils/dateKey': { getLocalDateKey: () => day },
    './useGrowthData': { useGrowthData: () => growth }, './useRoutineRecordRecovery': { useRoutineRecordRecovery: () => recovery },
  };
  const exports = {} as { default: () => Element };
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Date, Intl, Set, Map })(exports, (name: string) => { assert.ok(name in modules, name); return modules[name as keyof typeof modules]; });
  return { render: () => { cursor = 0; return exports.default(); }, recovery, growth, requests, changes, deleted };
}
function all(element: unknown, predicate: (element: Element) => boolean): Element[] {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(child => all(child, predicate));
  const item = element as Element; return [...(predicate(item) ? [item] : []), ...all(item.props?.children, predicate)];
}
const button = (tree: Element, label: string) => all(tree, item => item.type === 'button' && (item.props['aria-label'] === label || item.props.children === label))[0];
const click = async (element: Element) => (element.props.onClick as () => Promise<void> | void)();

test('shipping page sends active/manual/quick through routine-specific immutable boundary', async () => {
  const qa = fixture(); await click(button(qa.render(), `${routine.title} 빠른 완료`));
  qa.recovery.draft.active = { ...emptyRoutineForm(day), routineId: routine.id, startedAt: `${day}T00:00:00Z` };
  await click(button(qa.render(), '진행 저장'));
  qa.recovery.draft.manual = { ...emptyRoutineForm(day), open: true, routineId: routine.id };
  const form = all(qa.render(), item => item.type === 'form')[0]; await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  assert.deepEqual(qa.requests.map(item => (item as { mode: string }).mode), ['quick','active','manual']);
});
test('pending create blocks every reachable delete/cancel and save action but keeps edits accessible', async () => {
  const qa = fixture(); qa.recovery.draft.manual = { ...emptyRoutineForm(day), routineId: routine.id, open: true };
  qa.recovery.draft.pending = makeRoutineAttempt(owner, 'manual', qa.recovery.draft.manual, routine, crypto.randomUUID(), day, `${day}T01:00:00Z`); qa.recovery.blocked = true;
  qa.growth.sessions = [{ ...qa.recovery.draft.pending.payload, created_at: `${day}T01:00:00Z` }];
  await click(button(qa.render(), '루틴 편집')); const tree = qa.render();
  for (const name of ['기록 삭제','삭제', `${routine.title} 완료 취소`, '기록 저장']) assert.equal(button(tree, name).props.disabled, true, name);
  await click(button(tree, '기록 삭제')); await click(button(tree, '삭제')); assert.deepEqual(qa.deleted, []);
  assert.equal(button(tree, '같은 기록 다시 확인').props.disabled, false);
  assert.equal(all(tree, item => item.type === 'textarea')[0].props.disabled, undefined);
});
test('active unsaved routine cannot be deleted and missing routine exposes preserved draft with explicit discard', async () => {
  const qa = fixture(); qa.recovery.draft.active = { ...emptyRoutineForm(day), routineId: routine.id, startedAt: `${day}T00:00:00Z`, memo: 'preserve me' };
  await click(button(qa.render(), '루틴 편집')); assert.equal(button(qa.render(), '삭제').props.disabled, true); await click(button(qa.render(), '삭제')); assert.deepEqual(qa.deleted, []);
  qa.growth.routines = []; const html = renderToStaticMarkup(qa.render()); assert.match(html, /preserve me/); assert.match(html, /메모 보관 후 실행 초안 비우기/);
});
test('raw blank minutes remain blank instead of becoming synthetic zero', () => {
  const qa = fixture(); qa.recovery.draft.manual.open = true; const input = all(qa.render(), item => item.props?.['aria-label'] === '실행 시간')[0];
  (input.props.onChange as (event: unknown) => void)({ target: { value: '' } }); assert.deepEqual(JSON.parse(JSON.stringify(qa.changes)), [{ mode: 'manual', value: { minutes: '' } }]);
});
test('unknown-only quick time appears as unrecorded in actual page summaries and recent history', () => {
  const qa = fixture(); const attempt = makeRoutineAttempt(owner, 'quick', null, routine, crypto.randomUUID(), day, `${day}T01:00:00Z`);
  qa.growth.sessions = [{ ...attempt.payload, created_at: `${day}T01:00:00Z` }];
  const html = renderToStaticMarkup(qa.render()); assert.match(html, /시간 미기록/); assert.match(html, /시간 미기록 포함 · 비교 보류/); assert.doesNotMatch(html, />0분</);
});
