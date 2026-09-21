import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDWRITING_LESSONS as lessons, HANDWRITING_COURSE_ID as courseId, completedHandwritingLessons, nextHandwritingLesson } from './handwritingCourse.ts';
test('handwriting curriculum covers every worksheet once with stable page references', () => {
  assert.equal(lessons.length, 53); assert.equal(new Set(lessons.map(row => row.id)).size, 53);
  lessons.forEach((row, index) => { assert.equal(row.pdfPage, index + 2); assert.ok(row.title && row.steps.length === 3 && row.checks.length === 2); });

});
test('handwriting resume ignores legacy, partial, foreign and duplicate records', () => {
  const completed = {status:'completed',source:'handwriting',metrics:{courseId,lessonId:'film-p2',lessonCompleted:true}};
  const done=completedHandwritingLessons([completed,completed,{...completed,status:'partial'},{...completed,metrics:{...completed.metrics,lessonId:'film-p3',lessonCompleted:false}},{...completed,metrics:{...completed.metrics,courseId:'another'}},{...completed,metrics:{...completed.metrics,lessonId:'unknown'}}]);
  assert.deepEqual([...done],['film-p2']);assert.equal(nextHandwritingLesson(done).id,'film-p3');assert.equal(nextHandwritingLesson(new Set(lessons.map(row=>row.id))).id,'film-p2');
});
