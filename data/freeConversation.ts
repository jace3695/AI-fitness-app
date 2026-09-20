export const FREE_CONVERSATIONS = {
  카페: { japanese: 'コーヒーを一つください。', reading: 'こーひーをひとつください。', pronunciation: '코오히이오 히토츠 쿠다사이', meaning: '커피 한 잔 주세요.', reply: 'ホットとアイス、どちらになさいますか？', replyReading: 'ほっととあいす、どちらになさいますか？', replyPronunciation: '홋토토 아이스, 도치라니 나사이마스카?', hint: '따뜻한 커피는 ホット、차가운 커피는 アイス라고 말해요.' },
  여행: { japanese: '駅はどこですか？', reading: 'えきはどこですか？', pronunciation: '에키와 도코데스카?', meaning: '역은 어디인가요?', reply: '駅まで一緒に行きましょう。', replyReading: 'えきまでいっしょにいきましょう。', replyPronunciation: '에키마데 잇쇼니 이키마쇼오', hint: '장소를 물을 때는 「장소 + はどこですか」를 써요. 실제 길 안내가 아닌 연습 문장이에요.' },
  일상: { japanese: '今日はいい天気ですね。', reading: 'きょうはいいてんきですね。', pronunciation: '쿄오와 이이 텐키데스네', meaning: '오늘은 날씨가 좋네요.', reply: 'そうですね。散歩に行きませんか？', replyReading: 'そうですね。さんぽにいきませんか？', replyPronunciation: '소오데스네. 산포니 이키마센카?', hint: '「〜ませんか」는 상대방에게 함께 하자고 권하는 표현이에요.' },
  업무: { japanese: '図面の確認をお願いします。', reading: 'ずめんのかくにんをおねがいします。', pronunciation: '즈멘노 카쿠닌오 오네가이시마스', meaning: '도면 확인을 부탁드립니다.', reply: '承知しました。確認してご連絡します。', replyReading: 'しょうちしました。かくにんしてごれんらくします。', replyPronunciation: '쇼오치시마시타. 카쿠닌시테 고렌라쿠시마스', hint: '図面은 도면, 確認은 확인이에요. 「〜をお願いします」로 정중하게 부탁할 수 있어요.' },
  친구: { japanese: '一緒にご飯を食べよう。', reading: 'いっしょにごはんをたべよう。', pronunciation: '잇쇼니 고항오 타베요오', meaning: '같이 밥 먹자.', reply: 'いいね！何を食べたい？', replyReading: 'いいね！なにをたべたい？', replyPronunciation: '이이네! 나니오 타베타이?', hint: '친구 사이에서는 「〜よう」로 같이 하자고 말해요.' },
};

export function buildFreeConversation(situation: keyof typeof FREE_CONVERSATIONS, message: string) {
  const lesson = FREE_CONVERSATIONS[situation] ?? FREE_CONVERSATIONS.일상;
  const normalize = (text: string) => text.normalize('NFKC').replace(/[\s。、！？?!]/g, '');
  const matched = normalize(message) === normalize(lesson.japanese) || normalize(message) === normalize(lesson.reading);
  return { reply: matched ? lesson.reply : lesson.japanese, replyReading: matched ? lesson.replyReading : lesson.reading, replyKoreanPronunciation: matched ? lesson.replyPronunciation : lesson.pronunciation, correction: '', correctionReading: '', correctionKoreanPronunciation: '', explanation: `${matched ? '연습 문장과 일치해요. 다음 응답을 듣고 따라 해보세요.' : `이 상황의 연습 문장: ${lesson.meaning} 자유 문장의 자동 교정은 보류 중이에요.`} ${lesson.hint}`, source: 'local' };
}
