import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPING_KEYS, TYPING_LESSONS, TYPING_BASICS_ID, emptyTypingAttempt, pressTypingKey, typingKeyAccuracy, completedTypingBasics } from './typingBasics.ts';
test('typing positions cover the keyboard and Korean two-set word sequence',()=>{
 assert.equal(Object.keys(TYPING_KEYS).length,31);
 assert.equal(new Set(TYPING_LESSONS.map(x=>x.id)).size,14);
 for(const lesson of TYPING_LESSONS) for(const key of lesson.keys) assert.ok(TYPING_KEYS[key],key);
 assert.equal(TYPING_KEYS.b.finger,3);assert.equal(TYPING_KEYS.c.finger,2);assert.equal(TYPING_KEYS.y.finger,4);
 assert.equal(TYPING_LESSONS.at(-1)!.keys,'skan qkek gkfn');
});
test('wrong keys persist in accuracy, unsupported keys and completed input cannot alter result',()=>{
 let s=pressTypingKey(emptyTypingAttempt(),'fj','KeyA');
 assert.equal(s.position,0);assert.equal(s.mistakes.f,1);
 assert.equal(pressTypingKey(s,'fj','Tab'),s);
 s=pressTypingKey(s,'fj','KeyF');s=pressTypingKey(s,'fj','KeyJ');
 assert.equal(typingKeyAccuracy(s),67);assert.equal(s.attempts,3);
 assert.equal(pressTypingKey(s,'fj','KeyF'),s);
});
test('position progress excludes old sentence records, partials and other courses',()=>{
 const row={source:'typing',status:'completed',metrics:{courseId:TYPING_BASICS_ID,lessonId:'anchors',lessonCompleted:true}};
 assert.deepEqual([...completedTypingBasics([row,row,{...row,status:'partial'},{...row,metrics:{...row.metrics,lessonId:'unknown'}},{...row,metrics:{passageIndex:0}},{...row,metrics:{...row.metrics,courseId:'other'}}])],['anchors']);
});
