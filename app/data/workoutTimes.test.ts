import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {clockMinutes,completedWorkoutTime,confirmWorkoutTime,validWorkoutTime,workoutMealGap,writeWorkoutTime,type WorkoutTime} from './workoutTimes.ts';
const row:WorkoutTime={user_id:'00000000-0000-4000-8000-000000000101',recorded_on:'2020-01-01',starts_at:'20:00',ends_at:'20:40',revision:'00000000-0000-4000-8000-000000000103'};
test('운동 시각은 날짜·분 단위·순서·한국 시간의 미래 여부를 검증한다',()=>{
 assert.equal(validWorkoutTime(row),true);for(const bad of [{recorded_on:'2020-02-30'},{starts_at:'8:00'},{ends_at:'24:00'},{ends_at:'20:00'},{starts_at:'22:00'}])assert.equal(validWorkoutTime({...row,...bad}),false);
 assert.equal(completedWorkoutTime(row,new Date('2020-01-01T11:39:59Z')),false);assert.equal(completedWorkoutTime(row,new Date('2020-01-01T11:40:00Z')),true);assert.equal(clockMinutes('00:00'),0);
});
test('마지막 식사와 운동 구간의 선후를 계산하고 미기록은 추정하지 않는다',()=>{
 assert.equal(workoutMealGap(row,'18:30'),'마지막 식사 90분 후 운동 시작');assert.equal(workoutMealGap(row,'21:00'),'운동 종료 20분 후 마지막 식사');assert.match(workoutMealGap(row,'20:10')!,/구간 안/);assert.equal(workoutMealGap(row,'20:00'),'마지막 식사 0분 후 운동 시작');assert.equal(workoutMealGap(row,undefined),null);assert.equal(workoutMealGap(row,'24:00'),null);
});
test('응답 유실 후 GET만 재확인하고 삽입을 반복하지 않는다',async()=>{
 const methods:string[]=[];let failRead=true;
 const client=createClient('https://example.test','test-key',{auth:{persistSession:false},global:{fetch:async(_url,options)=>{const method=options?.method??'GET';methods.push(method);return method!=='GET'||failRead?new Response('{"message":"lost"}',{status:503}):new Response(JSON.stringify(row),{status:200,headers:{'Content-Type':'application/json'}});}}});
 const req={before:null,after:row};assert.equal(await writeWorkoutTime(client,row.user_id,req),'uncertain');failRead=false;assert.equal(await confirmWorkoutTime(client,row.user_id,req),'confirmed');assert.equal(methods.filter(method=>method==='POST').length,1);assert.ok(methods.slice(1).every(method=>method==='GET'));assert.ok(methods.length>=3);
});
test('다른 계정과 바뀐 revision은 성공으로 표시하지 않는다',async()=>{
 let calls=0;const client=createClient('https://example.test','test-key',{auth:{persistSession:false},global:{fetch:async()=>{calls++;return new Response(JSON.stringify({...row,revision:'00000000-0000-4000-8000-000000000104'}),{status:200,headers:{'Content-Type':'application/json'}});}}});
 assert.equal(await writeWorkoutTime(client,'other',{before:null,after:row}),'invalid');assert.equal(calls,0);assert.equal(await confirmWorkoutTime(client,row.user_id,{before:null,after:row}),'changed');assert.equal(await confirmWorkoutTime(client,row.user_id,{before:row,after:null}),'changed');
});
