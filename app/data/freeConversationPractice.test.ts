import test from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_FOLLOWUPS, addConversationBookmark, matchesStarter, partnerPhrase, starterPhrase, type Situation } from './freeConversationPractice.ts';

for (const situation of Object.keys(CONVERSATION_FOLLOWUPS) as Situation[]) {
  test(`${situation}: two explicit choices have readable replies and repeat-safe bookmarks`, () => {
    const flow = CONVERSATION_FOLLOWUPS[situation];
    assert.equal(flow.choices.length, 2);
    const phrases = [starterPhrase(situation), partnerPhrase(situation), ...flow.choices.flatMap(c => [c.say, c.reply])];
    for (const p of phrases) {
      assert(p.japanese && p.reading && p.meaning);
      const once = addConversationBookmark(null, situation, p);
      const twice = addConversationBookmark(JSON.stringify(once.entries), situation, p);
      assert.equal(once.added, true); assert.equal(twice.added, false);
      assert.deepEqual(twice.entries, once.entries);
    }
    assert.equal(matchesStarter(situation, starterPhrase(situation).japanese), true);
    assert.equal(matchesStarter(situation, starterPhrase(situation).reading), true);
    assert.equal(matchesStarter(situation, '別の自然な表現です。'), false);
  });
}
test('bookmark appends without changing legacy entries; cafe uses existing daily category', () => {
  const legacy = [{ japanese: '昔の文', meaning: '이전 문장', category: '업무', custom: { keep: true } }, 'legacy value'];
  const next = addConversationBookmark(JSON.stringify(legacy), '카페', starterPhrase('카페'));
  assert.deepEqual(next.entries.slice(0, 2), legacy);
  assert.equal(next.entries[2].category, '일상');
  assert.equal('wrongCount' in next.entries[2], false);
});
test('invalid existing storage fails without inventing an empty replacement', () => {
  for (const raw of ['broken', '{}', 'null']) assert.throws(() => addConversationBookmark(raw, '친구', starterPhrase('친구')));
});
test('starter comparison accepts width/punctuation but never treats unknown input as a saved wrong answer', () => {
  assert(matchesStarter('여행', ' 駅はどこですか？ '));
  assert(!matchesStarter('여행', ''));
  assert(!matchesStarter('여행', '駅までお願いします'));
});
