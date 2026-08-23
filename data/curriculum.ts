export type CourseTrack = "foundation" | "work" | "travel";

export type LessonQuiz = {
  prompt: string;
  choices: string[];
  answer: number;
  explanation: string;
  kind?: "choice" | "listening" | "input";
};

export type CurriculumLesson = {
  id: string;
  track: CourseTrack;
  order: number;
  title: string;
  goal: string;
  minutes: number;
  words: { japanese: string; reading: string; meaning: string }[];
  pattern: { label: string; explanation: string; example: string; meaning: string };
  dialogue: { speaker: "A" | "B"; japanese: string; reading: string; meaning: string }[];
  speak: string;
  practice?: { href: string; label: string };
  quiz: LessonQuiz[];
};

import { EXPANDED_CURRICULUM } from "./curriculumExpansion";
import { ADVANCED_CURRICULUM } from "./curriculumAdvanced";

export const TRACKS: Record<CourseTrack, { title: string; description: string; accent: string }> = {
  foundation: {
    title: "왕초보 기초",
    description: "문자와 가장 쉬운 문장부터 일본어의 뼈대를 만들어요.",
    accent: "mint",
  },
  work: {
    title: "회사 일본어",
    description: "일본 본사와 사양·납기·문제를 정확하고 정중하게 이야기해요.",
    accent: "blue",
  },
  travel: {
    title: "여행 일본어",
    description: "공항부터 식당·교통·숙소까지 바로 써먹는 표현을 배워요.",
    accent: "coral",
  },
};

const lesson = (value: CurriculumLesson) => value;

const CORE_CURRICULUM: CurriculumLesson[] = [
  lesson({
    id: "f01", track: "foundation", order: 1, title: "히라가나와 첫 인사", goal: "히라가나의 기본 소리를 익히고 만났을 때 인사해요.", minutes: 10,
    words: [
      { japanese: "こんにちは", reading: "こんにちは", meaning: "안녕하세요" },
      { japanese: "ありがとう", reading: "ありがとう", meaning: "고마워" },
      { japanese: "はい", reading: "はい", meaning: "네" },
    ],
    pattern: { label: "～です", explanation: "명사 뒤에 붙여 ‘~입니다’라고 정중하게 말해요.", example: "ジェイスです。", meaning: "Jace입니다." },
    dialogue: [
      { speaker: "A", japanese: "こんにちは。", reading: "こんにちは。", meaning: "안녕하세요." },
      { speaker: "B", japanese: "こんにちは。ジェイスです。", reading: "こんにちは。ジェイスです。", meaning: "안녕하세요. Jace입니다." },
    ],
    speak: "こんにちは。ジェイスです。",
    practice: { href: "/kana", label: "히라가나 기본 46자 연습" },
    quiz: [
      { prompt: "‘안녕하세요’에 맞는 표현은?", choices: ["こんにちは", "ありがとう", "はい"], answer: 0, explanation: "こんにちは는 낮에 널리 쓰는 기본 인사예요." },
      { prompt: "‘Jace입니다’에 맞는 문장은?", choices: ["ジェイスか。", "ジェイスです。", "ジェイスを。"], answer: 1, explanation: "명사 뒤에 です를 붙이면 정중한 ‘~입니다’가 돼요." },
    ],
  }),
  lesson({
    id: "f02", track: "foundation", order: 2, title: "가타카나와 자기소개", goal: "외래어에 쓰는 가타카나를 익히고 내 이름을 소개해요.", minutes: 10,
    words: [
      { japanese: "わたし", reading: "わたし", meaning: "저, 나" },
      { japanese: "名前", reading: "なまえ", meaning: "이름" },
      { japanese: "韓国", reading: "かんこく", meaning: "한국" },
    ],
    pattern: { label: "AはBです", explanation: "は는 지금 무엇에 관해 말하는지 보여줘요. ‘와’라고 읽어요.", example: "わたしはジェイスです。", meaning: "저는 Jace입니다." },
    dialogue: [
      { speaker: "A", japanese: "お名前は何ですか。", reading: "おなまえはなんですか。", meaning: "성함이 무엇인가요?" },
      { speaker: "B", japanese: "わたしはジェイスです。", reading: "わたしはジェイスです。", meaning: "저는 Jace입니다." },
    ],
    speak: "わたしはジェイスです。韓国から来ました。",
    practice: { href: "/kana-writing", label: "가나를 직접 따라 쓰기" },
    quiz: [
      { prompt: "문장의 주제를 나타내며 ‘와’로 읽는 것은?", choices: ["を", "は", "に"], answer: 1, explanation: "조사 は는 표기는 ‘하’지만 조사일 때 ‘와’로 읽어요." },
      { prompt: "‘저는 Jace입니다’의 올바른 어순은?", choices: ["ジェイスはわたしです", "わたしはジェイスです", "わたしですジェイスは"], answer: 1, explanation: "주제 A + は + 설명 B + です 순서예요." },
    ],
  }),
  lesson({
    id: "f03", track: "foundation", order: 3, title: "이것·그것·어디", goal: "물건을 가리키고 위치를 물을 수 있어요.", minutes: 10,
    words: [
      { japanese: "これ", reading: "これ", meaning: "이것" },
      { japanese: "それ", reading: "それ", meaning: "그것" },
      { japanese: "どこ", reading: "どこ", meaning: "어디" },
    ],
    pattern: { label: "～はどこですか", explanation: "찾는 장소나 물건 뒤에 붙여 ‘~는 어디인가요?’라고 물어요.", example: "トイレはどこですか。", meaning: "화장실은 어디인가요?" },
    dialogue: [
      { speaker: "A", japanese: "トイレはどこですか。", reading: "トイレはどこですか。", meaning: "화장실은 어디인가요?" },
      { speaker: "B", japanese: "あそこです。", reading: "あそこです。", meaning: "저기입니다." },
    ],
    speak: "すみません。トイレはどこですか。",
    quiz: [
      { prompt: "내 가까이에 있는 ‘이것’은?", choices: ["これ", "それ", "どこ"], answer: 0, explanation: "これ는 말하는 사람 가까이 있는 것을 가리켜요." },
      { prompt: "‘화장실은 어디인가요?’는?", choices: ["トイレは何ですか。", "トイレはどこですか。", "トイレですか。"], answer: 1, explanation: "장소는 どこですか로 물어요." },
    ],
  }),
  lesson({
    id: "f04", track: "foundation", order: 4, title: "숫자와 시간", goal: "가격과 시간을 간단히 확인할 수 있어요.", minutes: 10,
    words: [
      { japanese: "一", reading: "いち", meaning: "1" },
      { japanese: "二", reading: "に", meaning: "2" },
      { japanese: "何時", reading: "なんじ", meaning: "몇 시" },
    ],
    pattern: { label: "～は何時ですか", explanation: "일정 뒤에 붙여 시간을 확인해요.", example: "会議は何時ですか。", meaning: "회의는 몇 시인가요?" },
    dialogue: [
      { speaker: "A", japanese: "会議は何時ですか。", reading: "かいぎはなんじですか。", meaning: "회의는 몇 시인가요?" },
      { speaker: "B", japanese: "二時です。", reading: "にじです。", meaning: "2시입니다." },
    ],
    speak: "会議は二時です。",
    quiz: [
      { prompt: "‘몇 시’는?", choices: ["何時", "何人", "何日"], answer: 0, explanation: "何時는 なんじ라고 읽고 ‘몇 시’라는 뜻이에요." },
      { prompt: "‘2시입니다’는?", choices: ["二日です。", "二人です。", "二時です。"], answer: 2, explanation: "시간의 ‘시’는 時(じ)를 사용해요." },
    ],
  }),
  lesson({
    id: "f05", track: "foundation", order: 5, title: "있어요·없어요", goal: "필요한 물건이나 장소가 있는지 물을 수 있어요.", minutes: 10,
    words: [
      { japanese: "あります", reading: "あります", meaning: "있습니다(사물)" },
      { japanese: "ありません", reading: "ありません", meaning: "없습니다(사물)" },
      { japanese: "人", reading: "ひと", meaning: "사람" },
    ],
    pattern: { label: "～はありますか", explanation: "사물이나 시설이 있는지 정중하게 물어요.", example: "在庫はありますか。", meaning: "재고가 있나요?" },
    dialogue: [
      { speaker: "A", japanese: "英語のメニューはありますか。", reading: "えいごのメニューはありますか。", meaning: "영어 메뉴가 있나요?" },
      { speaker: "B", japanese: "はい、あります。", reading: "はい、あります。", meaning: "네, 있습니다." },
    ],
    speak: "これはありますか。",
    quiz: [
      { prompt: "사물의 존재를 나타내는 말은?", choices: ["います", "あります", "します"], answer: 1, explanation: "사물·시설은 あります, 사람·동물은 います를 써요." },
      { prompt: "‘재고가 없어요’는?", choices: ["在庫はありません。", "在庫はいます。", "在庫をです。"], answer: 0, explanation: "ありません은 あります의 정중한 부정이에요." },
    ],
  }),
  lesson({
    id: "f06", track: "foundation", order: 6, title: "가요·먹어요·봐요", goal: "기본 동작을 현재·미래의 정중한 표현으로 말해요.", minutes: 10,
    words: [
      { japanese: "行きます", reading: "いきます", meaning: "갑니다" },
      { japanese: "食べます", reading: "たべます", meaning: "먹습니다" },
      { japanese: "見ます", reading: "みます", meaning: "봅니다" },
    ],
    pattern: { label: "동사 ～ます", explanation: "상대에게 예의 있게 현재 습관이나 앞으로 할 일을 말해요.", example: "会社に行きます。", meaning: "회사에 갑니다." },
    dialogue: [
      { speaker: "A", japanese: "どこに行きますか。", reading: "どこにいきますか。", meaning: "어디에 가나요?" },
      { speaker: "B", japanese: "会社に行きます。", reading: "かいしゃにいきます。", meaning: "회사에 갑니다." },
    ],
    speak: "会社に行きます。資料を見ます。",
    quiz: [
      { prompt: "목적지를 나타내는 조사로 알맞은 것은?", choices: ["に", "を", "と"], answer: 0, explanation: "이동하는 목적지는 に로 표시해요." },
      { prompt: "‘자료를 봅니다’는?", choices: ["資料に見ます。", "資料を見ます。", "資料は行きます。"], answer: 1, explanation: "동작의 대상은 を로 표시해요." },
    ],
  }),
  lesson({
    id: "f07", track: "foundation", order: 7, title: "좋아요·괜찮아요", goal: "상태와 느낌을 말하고 상대에게 확인할 수 있어요.", minutes: 10,
    words: [
      { japanese: "いい", reading: "いい", meaning: "좋다" },
      { japanese: "大丈夫", reading: "だいじょうぶ", meaning: "괜찮다" },
      { japanese: "難しい", reading: "むずかしい", meaning: "어렵다" },
    ],
    pattern: { label: "～はどうですか", explanation: "의견이나 상태가 어떤지 물을 때 써요.", example: "この時間はどうですか。", meaning: "이 시간은 어떠세요?" },
    dialogue: [
      { speaker: "A", japanese: "この時間はどうですか。", reading: "このじかんはどうですか。", meaning: "이 시간은 어떠세요?" },
      { speaker: "B", japanese: "はい、大丈夫です。", reading: "はい、だいじょうぶです。", meaning: "네, 괜찮습니다." },
    ],
    speak: "はい、大丈夫です。",
    quiz: [
      { prompt: "‘어떠세요?’에 해당하는 표현은?", choices: ["どうですか", "どこですか", "だれですか"], answer: 0, explanation: "どう는 상태나 의견을 물을 때 사용해요." },
      { prompt: "‘괜찮습니다’는?", choices: ["難しいです。", "大丈夫です。", "ありません。"], answer: 1, explanation: "大丈夫です는 괜찮다는 정중한 답이에요." },
    ],
  }),
  lesson({
    id: "f08", track: "foundation", order: 8, title: "부탁하고 허락받기", goal: "무언가를 부탁하고 가능한지 물을 수 있어요.", minutes: 10,
    words: [
      { japanese: "ください", reading: "ください", meaning: "주세요" },
      { japanese: "お願いします", reading: "おねがいします", meaning: "부탁드립니다" },
      { japanese: "できます", reading: "できます", meaning: "할 수 있습니다" },
    ],
    pattern: { label: "～てください", explanation: "상대에게 어떤 행동을 해 달라고 정중히 부탁해요.", example: "確認してください。", meaning: "확인해 주세요." },
    dialogue: [
      { speaker: "A", japanese: "もう一度言ってください。", reading: "もういちどいってください。", meaning: "한 번 더 말해 주세요." },
      { speaker: "B", japanese: "はい、わかりました。", reading: "はい、わかりました。", meaning: "네, 알겠습니다." },
    ],
    speak: "すみません。もう一度言ってください。",
    quiz: [
      { prompt: "‘확인해 주세요’는?", choices: ["確認です。", "確認してください。", "確認があります。"], answer: 1, explanation: "동사의 て형 + ください는 정중한 행동 요청이에요." },
      { prompt: "못 들었을 때 가장 알맞은 말은?", choices: ["もう一度言ってください。", "大丈夫です。", "どこですか。"], answer: 0, explanation: "もう一度는 ‘한 번 더’라는 뜻이에요." },
    ],
  }),
  lesson({
    id: "w01", track: "work", order: 1, title: "출근 인사와 첫 소개", goal: "일본 회사 담당자에게 자연스럽게 첫인사를 해요.", minutes: 10,
    words: [
      { japanese: "お世話になっております", reading: "おせわになっております", meaning: "항상 신세 지고 있습니다" },
      { japanese: "担当", reading: "たんとう", meaning: "담당" },
      { japanese: "よろしくお願いします", reading: "よろしくおねがいします", meaning: "잘 부탁드립니다" },
    ],
    pattern: { label: "～を担当しています", explanation: "자신이 맡은 업무나 제품을 소개할 때 써요.", example: "開発を担当しています。", meaning: "개발을 담당하고 있습니다." },
    dialogue: [
      { speaker: "A", japanese: "初めまして。パクと申します。", reading: "はじめまして。パクともうします。", meaning: "처음 뵙겠습니다. 박이라고 합니다." },
      { speaker: "B", japanese: "初めまして。よろしくお願いします。", reading: "はじめまして。よろしくおねがいします。", meaning: "처음 뵙겠습니다. 잘 부탁드립니다." },
    ],
    speak: "初めまして。開発を担当しているパクです。よろしくお願いします。",
    quiz: [
      { prompt: "첫 비즈니스 인사로 가장 알맞은 것은?", choices: ["久しぶり！", "初めまして。よろしくお願いします。", "じゃあね。"], answer: 1, explanation: "처음 만난 업무 상대에게 쓰는 정중한 기본 인사예요." },
      { prompt: "‘개발을 담당하고 있습니다’는?", choices: ["開発を担当しています。", "開発があります。", "開発に行きます。"], answer: 0, explanation: "업무 + を担当しています로 담당 업무를 말해요." },
    ],
  }),
  lesson({
    id: "w02", track: "work", order: 2, title: "사양 확인하기", goal: "도면과 제품 사양을 정확히 재확인할 수 있어요.", minutes: 10,
    words: [
      { japanese: "仕様", reading: "しよう", meaning: "사양" },
      { japanese: "図面", reading: "ずめん", meaning: "도면" },
      { japanese: "寸法", reading: "すんぽう", meaning: "치수" },
    ],
    pattern: { label: "～でよろしいでしょうか", explanation: "내가 이해한 내용이 맞는지 아주 정중하게 확인해요.", example: "この仕様でよろしいでしょうか。", meaning: "이 사양으로 괜찮으실까요?" },
    dialogue: [
      { speaker: "A", japanese: "寸法は十ミリでよろしいでしょうか。", reading: "すんぽうはじゅうミリでよろしいでしょうか。", meaning: "치수는 10mm로 괜찮으실까요?" },
      { speaker: "B", japanese: "はい、その仕様でお願いします。", reading: "はい、そのしようでおねがいします。", meaning: "네, 그 사양으로 부탁드립니다." },
    ],
    speak: "念のため、図面の寸法を確認させてください。",
    quiz: [
      { prompt: "상대에게 사양을 정중히 재확인하는 표현은?", choices: ["この仕様です。", "この仕様でよろしいでしょうか。", "この仕様がありません。"], answer: 1, explanation: "～でよろしいでしょうか는 비즈니스에서 확인할 때 안전한 표현이에요." },
      { prompt: "‘혹시 모르니, 만일을 위해’라는 뜻은?", choices: ["念のため", "今のところ", "できるだけ"], answer: 0, explanation: "念のため는 실수를 막기 위한 재확인에 자주 써요." },
    ],
  }),
  lesson({
    id: "w03", track: "work", order: 3, title: "납기와 일정 조율", goal: "납기를 묻고 가능한 일정을 협의할 수 있어요.", minutes: 10,
    words: [
      { japanese: "納期", reading: "のうき", meaning: "납기" },
      { japanese: "日程", reading: "にってい", meaning: "일정" },
      { japanese: "短縮", reading: "たんしゅく", meaning: "단축" },
    ],
    pattern: { label: "～までに可能ですか", explanation: "특정 기한까지 가능한지 확인해요.", example: "来週までに可能ですか。", meaning: "다음 주까지 가능합니까?" },
    dialogue: [
      { speaker: "A", japanese: "納期はいつになりますか。", reading: "のうきはいつになりますか。", meaning: "납기는 언제가 될까요?" },
      { speaker: "B", japanese: "来週の金曜日を予定しています。", reading: "らいしゅうのきんようびをよていしています。", meaning: "다음 주 금요일을 예정하고 있습니다." },
    ],
    speak: "可能であれば、納期を一週間短縮していただけますか。",
    quiz: [
      { prompt: "납기를 직접 묻는 자연스러운 표현은?", choices: ["納期はいつになりますか。", "納期はどこですか。", "納期を食べますか。"], answer: 0, explanation: "일정은 いつ(언제)로 물어요." },
      { prompt: "정중하게 납기 단축을 요청할 때 알맞은 시작은?", choices: ["絶対に", "可能であれば", "すぐに"], answer: 1, explanation: "可能であれば는 ‘가능하다면’이라는 완곡한 표현이에요." },
    ],
  }),
  lesson({
    id: "w04", track: "work", order: 4, title: "샘플과 평가 결과", goal: "샘플 발송과 평가 결과를 간단히 보고할 수 있어요.", minutes: 10,
    words: [
      { japanese: "サンプル", reading: "サンプル", meaning: "샘플" },
      { japanese: "評価", reading: "ひょうか", meaning: "평가" },
      { japanese: "結果", reading: "けっか", meaning: "결과" },
    ],
    pattern: { label: "～をお送りします", explanation: "메일이나 택배로 무언가를 보내겠다고 정중히 말해요.", example: "評価結果をお送りします。", meaning: "평가 결과를 보내드리겠습니다." },
    dialogue: [
      { speaker: "A", japanese: "サンプルはいつ発送しますか。", reading: "サンプルはいつはっそうしますか。", meaning: "샘플은 언제 발송합니까?" },
      { speaker: "B", japanese: "本日発送し、結果は明日お送りします。", reading: "ほんじつはっそうし、けっかはあしたおおくりします。", meaning: "오늘 발송하고, 결과는 내일 보내드리겠습니다." },
    ],
    speak: "評価が完了しましたので、結果をお送りします。",
    quiz: [
      { prompt: "‘평가 결과를 보내드리겠습니다’는?", choices: ["評価結果をお送りします。", "評価結果があります。", "評価結果を待ちます。"], answer: 0, explanation: "お送りします는 送ります의 겸양 표현이에요." },
      { prompt: "‘완료했으므로’의 자연스러운 연결은?", choices: ["完了しましたので", "完了しますか", "完了しません"], answer: 0, explanation: "～ので는 이유를 부드럽게 설명해요." },
    ],
  }),
  lesson({
    id: "w05", track: "work", order: 5, title: "문제 발생 보고", goal: "불량이나 문제의 발생 사실을 감정 없이 정확히 보고해요.", minutes: 10,
    words: [
      { japanese: "不具合", reading: "ふぐあい", meaning: "불량, 이상" },
      { japanese: "発生", reading: "はっせい", meaning: "발생" },
      { japanese: "現象", reading: "げんしょう", meaning: "현상" },
    ],
    pattern: { label: "～が発生しました", explanation: "문제나 현상이 발생했음을 객관적으로 보고해요.", example: "不具合が発生しました。", meaning: "불량이 발생했습니다." },
    dialogue: [
      { speaker: "A", japanese: "どのような現象ですか。", reading: "どのようなげんしょうですか。", meaning: "어떤 현상입니까?" },
      { speaker: "B", japanese: "吸着時にエラーが発生しました。", reading: "きゅうちゃくじにエラーがはっせいしました。", meaning: "흡착 시 오류가 발생했습니다." },
    ],
    speak: "本日の評価中に不具合が発生しました。詳細を確認しています。",
    quiz: [
      { prompt: "문제 발생을 객관적으로 보고하는 표현은?", choices: ["不具合が発生しました。", "不具合が好きです。", "不具合に行きます。"], answer: 0, explanation: "문제 + が発生しました는 표준적인 보고 표현이에요." },
      { prompt: "‘상세 내용을 확인하고 있습니다’는?", choices: ["詳細を確認しています。", "詳細を発送しています。", "詳細を短縮しています。"], answer: 0, explanation: "確認しています는 현재 조사 중임을 나타내요." },
    ],
  }),
  lesson({
    id: "w06", track: "work", order: 6, title: "원인과 대책 설명", goal: "확정된 사실과 조사 중인 내용을 구분해 말할 수 있어요.", minutes: 10,
    words: [
      { japanese: "原因", reading: "げんいん", meaning: "원인" },
      { japanese: "対策", reading: "たいさく", meaning: "대책" },
      { japanese: "調査中", reading: "ちょうさちゅう", meaning: "조사 중" },
    ],
    pattern: { label: "現時点では～", explanation: "현재 시점의 잠정 결론임을 분명히 해 과도한 단정을 피합니다.", example: "現時点では原因を調査中です。", meaning: "현재 시점에서는 원인을 조사 중입니다." },
    dialogue: [
      { speaker: "A", japanese: "原因はわかりましたか。", reading: "げんいんはわかりましたか。", meaning: "원인을 알았습니까?" },
      { speaker: "B", japanese: "現時点では特定できていません。", reading: "げんじてんではとくていできていません。", meaning: "현재 시점에서는 특정하지 못했습니다." },
    ],
    speak: "原因を調査中です。判明次第、対策をご連絡します。",
    quiz: [
      { prompt: "원인이 아직 확정되지 않았을 때 가장 안전한 표현은?", choices: ["原因はこれです。", "現時点では特定できていません。", "原因はありません。"], answer: 1, explanation: "現時点では를 쓰면 현재까지의 조사 상태임을 명확히 할 수 있어요." },
      { prompt: "‘판명되는 대로’는?", choices: ["判明次第", "確認前", "対応中"], answer: 0, explanation: "～次第는 ‘~하는 대로 곧’이라는 뜻이에요." },
    ],
  }),
  lesson({
    id: "w07", track: "work", order: 7, title: "메일 요청과 회신", goal: "자료 요청부터 회신 기한까지 정중히 전달해요.", minutes: 10,
    words: [
      { japanese: "添付", reading: "てんぷ", meaning: "첨부" },
      { japanese: "返信", reading: "へんしん", meaning: "회신" },
      { japanese: "ご確認", reading: "ごかくにん", meaning: "확인(존경 표현)" },
    ],
    pattern: { label: "恐れ入りますが～", explanation: "상대에게 수고를 끼치는 부탁 앞에 붙이는 정중한 완충 표현이에요.", example: "恐れ入りますが、ご確認ください。", meaning: "번거로우시겠지만 확인해 주세요." },
    dialogue: [
      { speaker: "A", japanese: "資料を添付しました。ご確認ください。", reading: "しりょうをてんぷしました。ごかくにんください。", meaning: "자료를 첨부했습니다. 확인해 주세요." },
      { speaker: "B", japanese: "確認後、本日中に返信します。", reading: "かくにんご、ほんじつちゅうにへんしんします。", meaning: "확인 후 오늘 중으로 회신하겠습니다." },
    ],
    speak: "恐れ入りますが、添付資料をご確認いただけますでしょうか。",
    quiz: [
      { prompt: "부탁 앞의 정중한 완충 표현은?", choices: ["恐れ入りますが", "もちろん", "とても"], answer: 0, explanation: "恐れ入りますが는 업무 메일과 대화에서 부탁을 부드럽게 해요." },
      { prompt: "‘오늘 중으로 회신하겠습니다’는?", choices: ["本日中に返信します。", "本日中に添付します。", "本日中に発生します。"], answer: 0, explanation: "本日中に는 ‘오늘이 끝나기 전까지’를 뜻해요." },
    ],
  }),
  lesson({
    id: "w08", track: "work", order: 8, title: "회의에서 의견 말하기", goal: "찬성·우려·대안을 예의 있게 말할 수 있어요.", minutes: 10,
    words: [
      { japanese: "賛成", reading: "さんせい", meaning: "찬성" },
      { japanese: "懸念", reading: "けねん", meaning: "우려" },
      { japanese: "提案", reading: "ていあん", meaning: "제안" },
    ],
    pattern: { label: "～と考えています", explanation: "단정하지 않고 자신의 판단이나 의견을 논리적으로 전달해요.", example: "この方法が適切だと考えています。", meaning: "이 방법이 적절하다고 생각합니다." },
    dialogue: [
      { speaker: "A", japanese: "この案についてどう思いますか。", reading: "このあんについてどうおもいますか。", meaning: "이 안에 대해 어떻게 생각합니까?" },
      { speaker: "B", japanese: "基本的に賛成ですが、納期に懸念があります。", reading: "きほんてきにさんせいですが、のうきにけねんがあります。", meaning: "기본적으로 찬성하지만 납기에 우려가 있습니다." },
    ],
    speak: "基本的に賛成です。ただ、別の方法も検討したいと考えています。",
    quiz: [
      { prompt: "찬성하면서 우려를 덧붙이는 자연스러운 연결은?", choices: ["賛成ですが", "賛成まで", "賛成ので"], answer: 0, explanation: "～ですが는 앞 내용을 인정하며 다른 의견을 부드럽게 이어줘요." },
      { prompt: "‘검토하고 싶다고 생각합니다’는?", choices: ["検討したいと考えています。", "検討してください。", "検討が発生します。"], answer: 0, explanation: "～たいと考えています는 자신의 의향을 정중히 밝혀요." },
    ],
  }),
  lesson({
    id: "t01", track: "travel", order: 1, title: "공항과 입국", goal: "탑승구와 입국 절차에 필요한 위치를 물어요.", minutes: 10,
    words: [
      { japanese: "空港", reading: "くうこう", meaning: "공항" },
      { japanese: "搭乗口", reading: "とうじょうぐち", meaning: "탑승구" },
      { japanese: "入国審査", reading: "にゅうこくしんさ", meaning: "입국 심사" },
    ],
    pattern: { label: "～はどこですか", explanation: "찾는 시설 뒤에 붙여 위치를 물어요.", example: "搭乗口はどこですか。", meaning: "탑승구는 어디인가요?" },
    dialogue: [
      { speaker: "A", japanese: "すみません。入国審査はどこですか。", reading: "すみません。にゅうこくしんさはどこですか。", meaning: "실례합니다. 입국 심사는 어디인가요?" },
      { speaker: "B", japanese: "まっすぐ行って、右です。", reading: "まっすぐいって、みぎです。", meaning: "곧장 가서 오른쪽입니다." },
    ],
    speak: "すみません。搭乗口はどこですか。",
    quiz: [
      { prompt: "탑승구는?", choices: ["搭乗口", "改札", "会計"], answer: 0, explanation: "搭乗口는 비행기에 타는 게이트예요." },
      { prompt: "위치를 묻는 말은?", choices: ["いつですか", "いくらですか", "どこですか"], answer: 2, explanation: "どこですか는 ‘어디인가요?’예요." },
    ],
  }),
  lesson({
    id: "t02", track: "travel", order: 2, title: "전철과 버스", goal: "목적지로 가는 교통편과 승강장을 확인해요.", minutes: 10,
    words: [
      { japanese: "駅", reading: "えき", meaning: "역" },
      { japanese: "乗り場", reading: "のりば", meaning: "타는 곳, 승강장" },
      { japanese: "切符", reading: "きっぷ", meaning: "표" },
    ],
    pattern: { label: "～まで行きますか", explanation: "교통수단이 원하는 목적지까지 가는지 물어요.", example: "この電車は東京まで行きますか。", meaning: "이 전철은 도쿄까지 가나요?" },
    dialogue: [
      { speaker: "A", japanese: "このバスは駅まで行きますか。", reading: "このバスはえきまでいきますか。", meaning: "이 버스는 역까지 가나요?" },
      { speaker: "B", japanese: "はい、行きます。三番乗り場です。", reading: "はい、いきます。さんばんのりばです。", meaning: "네, 갑니다. 3번 승강장입니다." },
    ],
    speak: "新宿まで行く電車はどれですか。",
    quiz: [
      { prompt: "버스나 전철을 타는 곳은?", choices: ["乗り場", "入口", "部屋"], answer: 0, explanation: "乗り場는 교통수단을 타는 장소예요." },
      { prompt: "‘역까지 가나요?’는?", choices: ["駅まで行きますか。", "駅から来ますか。", "駅を食べますか。"], answer: 0, explanation: "목적 범위의 끝은 まで로 나타내요." },
    ],
  }),
  lesson({
    id: "t03", track: "travel", order: 3, title: "호텔 체크인", goal: "예약을 알리고 객실 정보를 확인해요.", minutes: 10,
    words: [
      { japanese: "予約", reading: "よやく", meaning: "예약" },
      { japanese: "チェックイン", reading: "チェックイン", meaning: "체크인" },
      { japanese: "朝食", reading: "ちょうしょく", meaning: "아침 식사" },
    ],
    pattern: { label: "～で予約しています", explanation: "예약한 이름을 알려 줄 때 사용해요.", example: "パクで予約しています。", meaning: "박으로 예약했습니다." },
    dialogue: [
      { speaker: "A", japanese: "チェックインをお願いします。パクで予約しています。", reading: "チェックインをおねがいします。パクでよやくしています。", meaning: "체크인 부탁드립니다. 박으로 예약했습니다." },
      { speaker: "B", japanese: "パスポートをお願いします。", reading: "パスポートをおねがいします。", meaning: "여권 부탁드립니다." },
    ],
    speak: "パクで二泊予約しています。チェックインをお願いします。",
    quiz: [
      { prompt: "예약한 이름을 말하는 표현은?", choices: ["パクに予約です。", "パクで予約しています。", "パクを予約ください。"], answer: 1, explanation: "이름 + で予約しています라고 말해요." },
      { prompt: "2박은?", choices: ["二時", "二人", "二泊"], answer: 2, explanation: "숙박 수는 泊(はく/ぱく)으로 세어요." },
    ],
  }),
  lesson({
    id: "t04", track: "travel", order: 4, title: "식당에서 주문", goal: "추천을 묻고 원하는 메뉴를 주문해요.", minutes: 10,
    words: [
      { japanese: "注文", reading: "ちゅうもん", meaning: "주문" },
      { japanese: "おすすめ", reading: "おすすめ", meaning: "추천" },
      { japanese: "会計", reading: "かいけい", meaning: "계산" },
    ],
    pattern: { label: "～をください", explanation: "물건이나 메뉴를 가리키며 ‘~를 주세요’라고 말해요.", example: "これをください。", meaning: "이것을 주세요." },
    dialogue: [
      { speaker: "A", japanese: "おすすめは何ですか。", reading: "おすすめはなんですか。", meaning: "추천은 무엇인가요?" },
      { speaker: "B", japanese: "このラーメンがおすすめです。", reading: "このラーメンがおすすめです。", meaning: "이 라멘을 추천합니다." },
      { speaker: "A", japanese: "では、それをください。", reading: "では、それをください。", meaning: "그럼 그것을 주세요." },
    ],
    speak: "すみません。注文をお願いします。これを一つください。",
    quiz: [
      { prompt: "추천 메뉴를 묻는 표현은?", choices: ["おすすめは何ですか。", "会計はどこですか。", "注文がありません。"], answer: 0, explanation: "おすすめは何ですか는 식당과 쇼핑에서 모두 쓸 수 있어요." },
      { prompt: "‘이것을 하나 주세요’는?", choices: ["これを一つください。", "これが一人です。", "ここに一つです。"], answer: 0, explanation: "대상 + を + 수량 + ください 순서로 말해요." },
    ],
  }),
  lesson({
    id: "t05", track: "travel", order: 5, title: "쇼핑과 결제", goal: "가격·사이즈를 묻고 카드 결제를 요청해요.", minutes: 10,
    words: [
      { japanese: "いくら", reading: "いくら", meaning: "얼마" },
      { japanese: "試着", reading: "しちゃく", meaning: "입어 보기" },
      { japanese: "カード", reading: "カード", meaning: "카드" },
    ],
    pattern: { label: "～てもいいですか", explanation: "어떤 행동을 해도 되는지 허락을 구해요.", example: "試着してもいいですか。", meaning: "입어 봐도 될까요?" },
    dialogue: [
      { speaker: "A", japanese: "これはいくらですか。", reading: "これはいくらですか。", meaning: "이것은 얼마인가요?" },
      { speaker: "B", japanese: "三千円です。", reading: "さんぜんえんです。", meaning: "3천 엔입니다." },
      { speaker: "A", japanese: "カードで払えますか。", reading: "カードではらえますか。", meaning: "카드로 결제할 수 있나요?" },
    ],
    speak: "これを試着してもいいですか。",
    quiz: [
      { prompt: "가격을 묻는 말은?", choices: ["いつ", "いくら", "いくつ"], answer: 1, explanation: "いくらですか는 ‘얼마인가요?’예요." },
      { prompt: "입어 봐도 되는지 묻는 표현은?", choices: ["試着してください。", "試着してもいいですか。", "試着しません。"], answer: 1, explanation: "～てもいいですか는 허락을 구하는 표현이에요." },
    ],
  }),
  lesson({
    id: "t06", track: "travel", order: 6, title: "길 묻기", goal: "길을 묻고 좌우·직진 안내를 이해해요.", minutes: 10,
    words: [
      { japanese: "右", reading: "みぎ", meaning: "오른쪽" },
      { japanese: "左", reading: "ひだり", meaning: "왼쪽" },
      { japanese: "まっすぐ", reading: "まっすぐ", meaning: "곧장, 직진" },
    ],
    pattern: { label: "～へはどう行きますか", explanation: "목적지로 가는 방법이나 길을 물어요.", example: "駅へはどう行きますか。", meaning: "역에는 어떻게 가나요?" },
    dialogue: [
      { speaker: "A", japanese: "駅へはどう行きますか。", reading: "えきへはどういきますか。", meaning: "역에는 어떻게 가나요?" },
      { speaker: "B", japanese: "まっすぐ行って、二つ目を左に曲がってください。", reading: "まっすぐいって、ふたつめをひだりにまがってください。", meaning: "곧장 가서 두 번째 길에서 왼쪽으로 도세요." },
    ],
    speak: "すみません。駅までの道を教えてください。",
    quiz: [
      { prompt: "‘직진’은?", choices: ["みぎ", "ひだり", "まっすぐ"], answer: 2, explanation: "まっすぐ는 곧장 가라는 뜻이에요." },
      { prompt: "‘왼쪽으로 돌아 주세요’는?", choices: ["左に曲がってください。", "左を食べてください。", "左に泊まってください。"], answer: 0, explanation: "방향 + に曲がる로 어느 쪽으로 도는지 말해요." },
    ],
  }),
  lesson({
    id: "t07", track: "travel", order: 7, title: "문제가 생겼을 때", goal: "분실·고장 상황을 설명하고 도움을 요청해요.", minutes: 10,
    words: [
      { japanese: "なくしました", reading: "なくしました", meaning: "잃어버렸습니다" },
      { japanese: "壊れました", reading: "こわれました", meaning: "고장 났습니다" },
      { japanese: "助けてください", reading: "たすけてください", meaning: "도와주세요" },
    ],
    pattern: { label: "～てしまいました", explanation: "원치 않은 일이 일어났거나 완료되어 버렸음을 말해요.", example: "財布をなくしてしまいました。", meaning: "지갑을 잃어버렸습니다." },
    dialogue: [
      { speaker: "A", japanese: "どうしましたか。", reading: "どうしましたか。", meaning: "무슨 일이신가요?" },
      { speaker: "B", japanese: "パスポートをなくしてしまいました。", reading: "パスポートをなくしてしまいました。", meaning: "여권을 잃어버렸습니다." },
    ],
    speak: "すみません。財布をなくしてしまいました。助けてください。",
    quiz: [
      { prompt: "‘여권을 잃어버렸습니다’는?", choices: ["パスポートをなくしました。", "パスポートを曲がりました。", "パスポートを予約しました。"], answer: 0, explanation: "なくしました는 물건을 잃어버렸다는 뜻이에요." },
      { prompt: "긴급히 도움을 청하는 표현은?", choices: ["おすすめです。", "助けてください。", "会計です。"], answer: 1, explanation: "助けてください는 ‘도와주세요’예요." },
    ],
  }),
  lesson({
    id: "t08", track: "travel", order: 8, title: "병원과 약국", goal: "아픈 부위와 증상을 간단히 설명해요.", minutes: 10,
    words: [
      { japanese: "病院", reading: "びょういん", meaning: "병원" },
      { japanese: "薬局", reading: "やっきょく", meaning: "약국" },
      { japanese: "痛い", reading: "いたい", meaning: "아프다" },
    ],
    pattern: { label: "～が痛いです", explanation: "아픈 신체 부위를 が 앞에 놓아 증상을 말해요.", example: "腰が痛いです。", meaning: "허리가 아픕니다." },
    dialogue: [
      { speaker: "A", japanese: "どうしましたか。", reading: "どうしましたか。", meaning: "어디가 불편하세요?" },
      { speaker: "B", japanese: "腰が痛いです。昨日からです。", reading: "こしがいたいです。きのうからです。", meaning: "허리가 아픕니다. 어제부터입니다." },
    ],
    speak: "腰が痛いです。この薬を飲んでもいいですか。",
    quiz: [
      { prompt: "‘허리가 아픕니다’는?", choices: ["腰が痛いです。", "腰があります。", "腰へ行きます。"], answer: 0, explanation: "신체 부위 + が痛いです로 통증을 말해요." },
      { prompt: "약국은?", choices: ["病院", "薬局", "空港"], answer: 1, explanation: "薬局(やっきょく)은 약국이에요." },
    ],
  }),
];

const expandLessonQuiz = (item: CurriculumLesson): CurriculumLesson => {
  const wordQuestions = item.words.flatMap((word, index, words) => {
    const distractor1 = words[(index + 1) % words.length];
    const distractor2 = words[(index + 2) % words.length];
    return [
      { prompt: `‘${word.japanese}(${word.reading})’의 뜻은?`, choices: [word.meaning, distractor1.meaning, distractor2.meaning], answer: 0, explanation: `${word.japanese}(${word.reading})는 ‘${word.meaning}’라는 뜻이에요.` },
      { kind: "input" as const, prompt: `‘${word.meaning}’를 일본어로 입력하세요.`, choices: [word.japanese], answer: 0, explanation: `정답은 ${word.japanese}(${word.reading})예요.` },
    ];
  });
  return { ...item, quiz: [...item.quiz, ...wordQuestions].slice(0, 8) };
};

export const CURRICULUM: CurriculumLesson[] = [...CORE_CURRICULUM, ...EXPANDED_CURRICULUM, ...ADVANCED_CURRICULUM].map(expandLessonQuiz);

export const getTrackLessons = (track: CourseTrack) =>
  CURRICULUM.filter((item) => item.track === track).sort((a, b) => a.order - b.order);

export const getLesson = (id: string | null | undefined) =>
  CURRICULUM.find((item) => item.id === id) ?? CURRICULUM[0];

