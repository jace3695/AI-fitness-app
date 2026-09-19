import test from 'node:test';import assert from 'node:assert/strict';import {workoutEvidence} from './workoutEvidence.ts';
test('workout evidence separates incomplete, missing and next-calendar-day responses without assuming recovery',()=>{
 const workouts={'2026-09-17':{workoutStatus:'partial' as const,workoutFatigue:4,workoutBackStatus:'stiff' as const},'2026-09-01':true,'2026-09-16':{cardioDone:true},'2026-09-18':true};
 const conditions={'2026-09-18':{signals:[] as [],recommendation:'normal' as const,updatedAt:'2026-09-18T00:00:00Z'}};const before=JSON.stringify({workouts,conditions});const result=workoutEvidence(workouts,conditions,'2026-09-18')!;
 assert.equal(result.days.length,2);assert.equal(result.recent.partial,1);assert.equal(result.previous.completed,1);assert.deepEqual(result.days[0].nextSignals,[]);assert.equal(result.days[1].nextSignals,null);assert.equal(result.days[1].fatigue,null);assert.equal(JSON.stringify({workouts,conditions}),before);
});
test('workout evidence excludes impossible and out-of-period dates',()=>{assert.equal(workoutEvidence({}, {},'2026-02-30'),null);assert.equal(workoutEvidence({'2026-02-30':true,'2026-01-01':true},{},'2026-03-01')!.days.length,0);});
