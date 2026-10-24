import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../app/components/WeightChart.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const saveGoal =');
const end = source.indexOf('  const remainingText =', start);

function fixture() {
  const state = { saved: { minKg: 60, maxKg: 65 }, message: '', fail: true, writes: 0 };
  const context = {
    minimumDraft: '61.2', maximumDraft: '64.8',
    setGoalDraft: (_draft: unknown) => {},
    setGoalMessage: (message: string) => { state.message = message; },
    onGoalChange: (goal: typeof state.saved) => {
      state.writes++;
      if (state.fail) throw new Error('synthetic quota failure');
      state.saved = structuredClone(goal);
    },
  };
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const save = vm.runInNewContext(code + ';saveGoal', context) as (event: { preventDefault(): void }) => void;
  return { state, context, save: () => save({ preventDefault() {} }) };
}

test('actual goal form handler preserves existing goal and both drafts on storage failure', () => {
  const f = fixture();
  assert.doesNotThrow(f.save);
  assert.deepEqual(f.state.saved, { minKg: 60, maxKg: 65 });
  assert.equal(f.context.minimumDraft, '61.2');
  assert.equal(f.context.maximumDraft, '64.8');
  assert.match(f.state.message, /저장하지 못했어요/);
  assert.doesNotMatch(f.state.message, /저장했습니다/);
});

test('same input can be explicitly retried after failure without automatic writes', () => {
  const f = fixture(); f.save();
  assert.equal(f.state.writes, 1);
  f.state.fail = false; f.save();
  assert.equal(f.state.writes, 2);
  assert.deepEqual(f.state.saved, { minKg: 61.2, maxKg: 64.8 });
  assert.match(f.state.message, /저장했습니다/);
});

test('invalid goal still stops before persistence', () => {
  const f = fixture(); f.context.minimumDraft = '70'; f.context.maximumDraft = '60'; f.save();
  assert.equal(f.state.writes, 0);
  assert.match(f.state.message, /30~250kg/);
});
