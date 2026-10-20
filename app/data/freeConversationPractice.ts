import { FREE_CONVERSATIONS } from '../../data/freeConversation.ts';

export type Situation = keyof typeof FREE_CONVERSATIONS;
export type PracticePhrase = { japanese: string; reading: string; meaning: string };
type Choice = { say: PracticePhrase; reply: PracticePhrase };
const phrase = (japanese: string, reading: string, meaning: string): PracticePhrase => ({ japanese, reading, meaning });
export const CONVERSATION_FOLLOWUPS: Record<Situation, { replyMeaning: string; choices: Choice[] }> = {
  카페: { replyMeaning: '따뜻한 것과 차가운 것 중 어느 것으로 하시겠어요?', choices: [
    { say: phrase('ホットでお願いします。', 'ほっとでおねがいします。', '따뜻한 것으로 부탁드려요.'), reply: phrase('かしこまりました。少々お待ちください。', 'かしこまりました。しょうしょうおまちください。', '알겠습니다. 잠시만 기다려 주세요.') },
    { say: phrase('アイスでお願いします。', 'あいすでおねがいします。', '차가운 것으로 부탁드려요.'), reply: phrase('かしこまりました。少々お待ちください。', 'かしこまりました。しょうしょうおまちください。', '알겠습니다. 잠시만 기다려 주세요.') },
  ] },
  여행: { replyMeaning: '역까지 같이 가요.', choices: [
    { say: phrase('ありがとうございます。お願いします。', 'ありがとうございます。おねがいします。', '감사합니다. 부탁드려요.'), reply: phrase('では、行きましょう。', 'では、いきましょう。', '그럼 가요.') },
    { say: phrase('駅まで歩いて何分ですか？', 'えきまであるいてなんぷんですか？', '역까지 걸어서 몇 분인가요?'), reply: phrase('歩いて五分くらいです。', 'あるいてごふんくらいです。', '걸어서 5분 정도예요. (연습용 가상 안내)') },
  ] },
  일상: { replyMeaning: '그러네요. 산책하러 가지 않을래요?', choices: [
    { say: phrase('いいですね。行きましょう。', 'いいですね。いきましょう。', '좋네요. 가요.'), reply: phrase('では、公園に行きましょう。', 'では、こうえんにいきましょう。', '그럼 공원에 가요.') },
    { say: phrase('すみません。今日は時間がありません。', 'すみません。きょうはじかんがありません。', '미안해요. 오늘은 시간이 없어요.'), reply: phrase('そうですか。また今度行きましょう。', 'そうですか。またこんどいきましょう。', '그렇군요. 다음에 또 가요.') },
  ] },
  업무: { replyMeaning: '알겠습니다. 확인하고 연락드리겠습니다.', choices: [
    { say: phrase('ありがとうございます。よろしくお願いします。', 'ありがとうございます。よろしくおねがいします。', '감사합니다. 잘 부탁드립니다.'), reply: phrase('はい、確認します。', 'はい、かくにんします。', '네, 확인하겠습니다.') },
    { say: phrase('いつご連絡いただけますか？', 'いつごれんらくいただけますか？', '언제 연락을 받을 수 있을까요?'), reply: phrase('今日の午後、ご連絡します。', 'きょうのごご、ごれんらくします。', '오늘 오후에 연락드리겠습니다. (연습용 약속)') },
  ] },
  친구: { replyMeaning: '좋아! 뭐 먹고 싶어?', choices: [
    { say: phrase('ラーメンが食べたい。', 'らーめんがたべたい。', '라멘 먹고 싶어.'), reply: phrase('いいね。ラーメンを食べに行こう。', 'いいね。らーめんをたべにいこう。', '좋아. 라멘 먹으러 가자.') },
    { say: phrase('カレーが食べたい。', 'かれーがたべたい。', '카레 먹고 싶어.'), reply: phrase('いいね。カレーを食べに行こう。', 'いいね。かれーをたべにいこう。', '좋아. 카레 먹으러 가자.') },
  ] },
};
export function starterPhrase(situation: Situation): PracticePhrase {
  const p = FREE_CONVERSATIONS[situation];
  return phrase(p.japanese, p.reading, p.meaning);
}
export function partnerPhrase(situation: Situation): PracticePhrase {
  const p = FREE_CONVERSATIONS[situation];
  return phrase(p.reply, p.replyReading, CONVERSATION_FOLLOWUPS[situation].replyMeaning);
}
export function matchesStarter(situation: Situation, text: string) {
  const normalize = (v: string) => v.normalize('NFKC').replace(/[\s。、！？?!]/g, '');
  const p = starterPhrase(situation);
  return [p.japanese, p.reading].some(v => normalize(v) === normalize(text));
}
// Keep the existing savedSentences schema and preserve every pre-existing entry.
// A selected phrase is a bookmark, never an automatically inferred wrong answer.
export function addConversationBookmark(raw: string | null, situation: Situation, selected: PracticePhrase) {
  const previous: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(previous)) throw Error('기존 복습 목록을 읽지 못했어요. 원본은 변경하지 않았어요.');
  const category = situation === '카페' ? '일상' : situation;
  const exists = previous.some(item => item && typeof item === 'object' &&
    item.japanese === selected.japanese && item.meaning === selected.meaning && item.category === category);
  return { added: !exists, entries: exists ? previous : [...previous, {
    ...selected, category, note: `상황별 고정 회화 · ${situation} · 직접 고른 예문`, pattern: 'other',
  }] };
}
