import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { growthDurationLabel, summarizeGrowthDuration } from '../app/data/growthPlatform.ts';

// Execute the shipping local assistant dispatcher with synthetic read-only DB
// boundaries. No provider, user account, or external service is contacted.
function fixture(rows: Record<string, unknown>[]) {
  const selections: string[] = [];
  const source = readFileSync(new URL('../app/api/assistant/chat/route.ts', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function processSingleCommand('), source.indexOf('\nexport async function POST'));
  const compiled = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const process = vm.runInNewContext(`${compiled}\nprocessSingleCommand`, {
    resolveContextualMessage: (value: string) => value, seoulDate: () => '2026-10-09', detectAdviceScope: () => null,
    isDietRecordIntent: () => false, isGrowthCompletionIntent: () => false, isBudgetEditIntent: () => false,
    isWorkoutFeedbackIntent: () => false, isWorkoutCardioIntent: () => false, isRetiredGrowthRoutine: () => false,
    growthDurationLabel, summarizeGrowthDuration, parseState: () => ({}), getTodayWorkout: () => null,
    getLanguageSnapshot: () => ({ completedIds: [], totalReview: 0 }), LANGUAGE_ROUTINES: [], won: () => '0원',
    generativeFallback: () => { throw Error('Provider path must not execute'); },
  }) as (client: unknown, owner: string, message: string, history: unknown[]) => Promise<{ reply: string }>;
  const client = { from(table: string) {
    let columns = '', single = false;
    const query = {
      select(value: string) { columns = value; if (table === 'growth_sessions') selections.push(value); return query; },
      eq() { return query; }, not() { return query; }, gte() { return query; }, lte() { return query; }, order() { return query; }, limit() { return query; }, maybeSingle() { single = true; return query; },
      then(resolve: (value: unknown) => unknown) {
        const records = table === 'growth_sessions' ? rows : table === 'growth_routines' ? [{ id: 'routine', title: '합성', target_minutes: 15 }] : [];
        return Promise.resolve({ error: null, data: single ? { state: {} } : records.map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]]))) }).then(resolve);
      },
    }; return query;
  } };
  return { ask: (message: string) => process(client, 'synthetic-owner', message, []), selections };
}
for (const question of ['오늘 브리핑', '자기계발 현황']) test(`shipping assistant ${question} retains unknown time and completed status`, async () => {
  const qa = fixture([{ routine_id: 'routine', status: 'completed', actual_minutes: 0, metrics: { actualMinutesRecorded: false } }]);
  const result = await qa.ask(question);
  assert.match(result.reply, /시간 미기록 1회/); assert.doesNotMatch(result.reply, /0분/); assert.match(result.reply, /완료/);
  assert.ok(qa.selections.every(value => value.split(',').includes('metrics')));
});
for (const question of ['오늘 브리핑', '자기계발 현황']) test(`shipping assistant ${question} totals known only and preserves historical meaning`, async () => {
  const qa = fixture([{ routine_id: 'routine', status: 'completed', actual_minutes: 99, metrics: { actualMinutesRecorded: false } }, { routine_id: 'routine', status: 'partial', actual_minutes: 20 }]);
  const result = await qa.ask(question); assert.match(result.reply, /기록 20분 · 시간 미기록 1회 제외/); assert.doesNotMatch(result.reply, /119분/);
  const zero = await fixture([{ routine_id: 'routine', status: 'completed', actual_minutes: 0, metrics: { actualMinutesRecorded: true } }]).ask(question);
  assert.match(zero.reply, /기록 0분/); assert.doesNotMatch(zero.reply, /시간 미기록/);
});
test('assistant daily card selects metrics and uses the same explicit duration formatter', () => {
  const source = readFileSync(new URL('../app/assistant/AssistantClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /select\("routine_id,session_date,actual_minutes,status,metrics"\)/);
  assert.match(source, /duration: summarizeGrowthDuration\(todayGrowthSessions\)/);
  assert.match(source, /growthDurationLabel\(briefing.growth.duration\)/);
  assert.doesNotMatch(source, /briefing\.growth\.minutes/);
});
test('paid-coach preparation carries known-only totals and explicit unknown counts without altering dispatch', () => {
  const source = readFileSync(new URL('../app/api/growth/coach/route.ts', import.meta.url), 'utf8');
  assert.match(source, /totalMinutes: duration\.recordedTimeSessions \? duration\.totalMinutes : null/);
  assert.match(source, /unknownTimeSessions: duration\.unknownTimeSessions/);
  assert.match(source, /시간 미기록 횟수는 0분 실행이 아니며/);
  assert.match(source, /isAiFeatureAvailable\("growth-weekly-coach"\) && sessions\.length/);
});
