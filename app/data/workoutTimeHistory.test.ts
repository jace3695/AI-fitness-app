import test from 'node:test';
import assert from 'node:assert/strict';
import {workoutHistoryPeriod,workoutTimeHistory} from './workoutTimeHistory.ts';
const owner='00000000-0000-4000-8000-000000000001';
const row={user_id:owner,recorded_on:'2026-09-17',starts_at:'20:00',ends_at:'20:40',revision:owner};
test('workout history uses 28 complete calendar days across leap and year boundaries',()=>{
 assert.deepEqual(workoutHistoryPeriod('2024-03-01'),{start:'2024-02-02',end:'2024-02-29'});
 assert.deepEqual(workoutHistoryPeriod('2026-01-01'),{start:'2025-12-04',end:'2025-12-31'});
 assert.equal(workoutHistoryPeriod('2026-02-30'),null);
});
test('workout history distinguishes missing clocks and preserves same-day evidence without writes',()=>{
 const rows=[{...row,recorded_on:'2026-09-16'},row];const meals={'2026-09-17':{lastMealTime:'18:30'},'2026-09-16':{dinnerBefore1830:true}};const before=JSON.stringify({rows,meals});
 const result=workoutTimeHistory(rows,owner,'2026-09-18',meals)!;
 assert.equal(result.unrecorded,26);assert.equal(result.missingMeal,1);assert.equal(result.days[0].gap,'마지막 식사 90분 후 운동 시작');assert.equal(result.days[1].gap,null);assert.equal(result.days[0].minutes,40);assert.equal(JSON.stringify({rows,meals}),before);
 assert.equal(workoutTimeHistory([row],owner,'2026-09-18',{'2026-09-17':{lastMealTime:'21:00'}})!.days[0].gap,'운동 종료 20분 후 마지막 식사');
 assert.match(workoutTimeHistory([row],owner,'2026-09-18',{'2026-09-17':{lastMealTime:'20:20'}})!.days[0].gap!,/구간 안/);
});
test('workout history rejects malformed, duplicate, foreign and out-of-period rows rather than claiming no records',()=>{
 for(const rows of [null,[row,row],[{...row,user_id:'00000000-0000-4000-8000-000000000002'}],[{...row,recorded_on:'2026-09-18'}],[{...row,recorded_on:'2026-08-20'}],[{...row,ends_at:'19:00'}]])assert.equal(workoutTimeHistory(rows,owner,'2026-09-18',{}),null);
 assert.equal(workoutTimeHistory([],owner,'2026-09-18',{})!.unrecorded,28);
});
