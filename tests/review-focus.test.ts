import test from 'node:test';import assert from 'node:assert/strict';
import { reviewFocus } from '../utils/reviewFocus.ts';
import { MANUFACTURING_CURRICULUM } from '../data/curriculumManufacturing.ts';
import type { CurriculumReviewItem } from '../utils/curriculumProgress.ts';
test('review focus respects due dates, interest track and explicit help/error evidence without changing source',()=>{
 const items=[{id:'a',lessonId:'w21',wrongCount:2},{id:'b',lessonId:'f01',wrongCount:5},{id:'c',lessonId:'w22',lastNeededHelp:true},{id:'d',lessonId:'w01',wrongCount:9,nextReviewAt:'2099-01-01'}].map(row=>({...row,createdAt:'2026-01-01',lessonTitle:'예문',prompt:'문제',explanation:'설명'})) as CurriculumReviewItem[];
 const before=structuredClone(items);assert.deepEqual(reviewFocus(items,Date.parse('2026-09-18'),'work').map(row=>row.id),['c','a']);assert.deepEqual(items,before);
});
test('manufacturing lessons have separate IDs, readings and valid unambiguous answer choices',()=>{
 assert.equal(new Set(MANUFACTURING_CURRICULUM.map(row=>row.id)).size,2);
 for(const lesson of MANUFACTURING_CURRICULUM){assert.equal(lesson.track,'work');assert.ok(lesson.dialogue.every(row=>row.reading&&row.meaning));for(const quiz of lesson.quiz){assert.ok(quiz.choices[quiz.answer]);assert.equal(new Set(quiz.choices).size,quiz.choices.length);}}
});
