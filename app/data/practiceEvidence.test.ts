import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typingMistakes, typingTrend, handwritingPoint, handwritingMetrics, emptyHandwritingEvidence } from './practiceEvidence.ts';
import type { GrowthSessionRow } from './growthPlatform.ts';
test('typing evidence counts final mismatches, leaves untyped characters alone and compares only same passage', () => {
  assert.deepEqual(typingMistakes('가나다나', '가xx'), [{character:'나',count:1},{character:'다',count:1}]);
  const rows = [{source:'typing',session_date:'2026-09-18',metrics:{passageIndex:0,characters:10,correctCharacters:9,elapsedSeconds:20}}, {source:'typing',session_date:'2026-09-01',metrics:{passageIndex:0,characters:20,correctCharacters:16,elapsedSeconds:60}}, {source:'typing',session_date:'2026-09-18',metrics:{passageIndex:1,characters:100,correctCharacters:100,elapsedSeconds:1}}] as unknown as GrowthSessionRow[];
  assert.deepEqual(typingTrend(rows,0,'2026-09-18'),{recent:{count:1,accuracy:90,cpm:30},previous:{count:1,accuracy:80,cpm:20}});
});
test('handwriting measures drawing bounds and time without interpreting constant mouse pressure as measured pen variation', () => {
  const mouse = handwritingPoint(emptyHandwritingEvidence(),.2,.4,.5,'mouse');
  assert.equal(handwritingMetrics(mouse).pressureRange,null);
  const pen = handwritingPoint(handwritingPoint(mouse,.1,.5,.2,'pen'),.8,.9,.7,'pen');
  assert.deepEqual(handwritingMetrics({...pen,strokes:2,activeMs:2500}),{strokes:2,activeSeconds:3,occupiedWidth:70,occupiedHeight:50,pressureRange:[.2,.7]});
  assert.deepEqual(emptyHandwritingEvidence(),emptyHandwritingEvidence());
});
