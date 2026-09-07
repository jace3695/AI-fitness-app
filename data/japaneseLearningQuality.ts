import type { LearningLevel, PartOfSpeech } from "./words";

// App learning stages, not JLPT/CEFR claims. Explicit core vocabulary takes
// precedence; specialist work vocabulary is kept in the practical library.
const firstWords = new Set("こんにちは|ありがとう|すみません|はい|いいえ|おはよう|こんばんは|さようなら|私|名前|日本|日本語|韓国|学生|先生|友達|家族|母|父|水|お茶|ご飯|パン|卵|肉|魚|野菜|果物|りんご|牛乳|食べる|飲む|見る|聞く|話す|読む|書く|買う|行く|来る|帰る|寝る|起きる|休む|会う|好き|嫌い|大きい|小さい|高い|安い|新しい|古い|暑い|寒い|楽しい|嬉しい|悲しい|良い|悪い|忙しい|元気|大丈夫|今日|明日|昨日|朝|昼|夜|毎日|今|時間|学校|家|部屋|本|机|椅子|鞄|靴|服|電話|トイレ|駅|電車|バス|ホテル|店|空港|地図|右|左|まっすぐ|ここ|そこ|あそこ|これ|それ|あれ|どこ|何|だれ|いくら|一|二|三|四|五|六|七|八|九|十|百".split("|"));
const iAdjectives = new Map("大きい:커요|小さい:작아요|新しい:새로워요|古い:오래됐어요|高い:비싸요|安い:저렴해요|長い:길어요|短い:짧아요|広い:넓어요|狭い:좁아요|重い:무거워요|軽い:가벼워요|早い:일러요|遅い:늦어요|暑い:더워요|寒い:추워요|暖かい:따뜻해요|涼しい:선선해요|難しい:어려워요|易しい:쉬워요|面白い:재미있어요|忙しい:바빠요|明るい:밝아요|暗い:어두워요|強い:강해요|弱い:약해요|良い:좋아요|悪い:나빠요|嬉しい:기뻐요|悲しい:슬퍼요|楽しい:즐거워요|寂しい:외로워요|恥ずかしい:부끄러워요|羨ましい:부러워요|近い:가까워요|遠い:멀어요".split("|").map((entry) => entry.split(":") as [string, string]));
const naAdjectives = new Map("便利:편리해요|不便:불편해요|静か:조용해요|賑やか:활기차요|綺麗:깨끗해요|丈夫:튼튼해요|必要:필요해요|大切:소중해요|簡単:간단해요|複雑:복잡해요|暇:한가해요|元気:건강해요|大丈夫:괜찮아요".split("|").map((entry) => entry.split(":") as [string, string]));

// Each verb's usage is authored, rather than attaching a noun-only suffix.
const verbExamples: Record<string, [string, string, string]> = {
  行く: ["学校に行きます。", "がっこうにいきます。", "학교에 가요."],
  来る: ["友達が来ます。", "ともだちがきます。", "친구가 와요."],
  帰る: ["家に帰ります。", "いえにかえります。", "집에 돌아가요."],
  食べる: ["パンを食べます。", "ぱんをたべます。", "빵을 먹어요."],
  飲む: ["水を飲みます。", "みずをのみます。", "물을 마셔요."],
  見る: ["映画を見ます。", "えいがをみます。", "영화를 봐요."],
  聞く: ["音楽を聞きます。", "おんがくをききます。", "음악을 들어요."],
  話す: ["日本語で話します。", "にほんごではなします。", "일본어로 말해요."],
  読む: ["本を読みます。", "ほんをよみます。", "책을 읽어요."],
  書く: ["名前を書きます。", "なまえをかきます。", "이름을 써요."],
  買う: ["切符を買います。", "きっぷをかいます。", "표를 사요."],
  売る: ["古い本を売ります。", "ふるいほんをうります。", "오래된 책을 팔아요."],
  作る: ["料理を作ります。", "りょうりをつくります。", "요리를 만들어요."],
  使う: ["このペンを使います。", "このぺんをつかいます。", "이 펜을 사용해요."],
  開ける: ["窓を開けます。", "まどをあけます。", "창문을 열어요."],
  閉める: ["ドアを閉めます。", "どあをしめます。", "문을 닫아요."],
  入る: ["部屋に入ります。", "へやにはいります。", "방에 들어가요."],
  出る: ["家を出ます。", "いえをでます。", "집에서 나가요."],
  起きる: ["朝、起きます。", "あさ、おきます。", "아침에 일어나요."],
  寝る: ["早く寝ます。", "はやくねます。", "일찍 자요."],
  洗う: ["手を洗います。", "てをあらいます。", "손을 씻어요."],
  着る: ["シャツを着ます。", "しゃつをきます。", "셔츠를 입어요."],
  脱ぐ: ["靴を脱ぎます。", "くつをぬぎます。", "신발을 벗어요."],
  持つ: ["鞄を持ちます。", "かばんをもちます。", "가방을 들어요."],
  置く: ["ここに置きます。", "ここにおきます。", "여기에 놓아요."],
  取る: ["ペンを取ります。", "ぺんをとります。", "펜을 집어요."],
  立つ: ["ここに立ちます。", "ここにたちます。", "여기에 서요."],
  座る: ["椅子に座ります。", "いすにすわります。", "의자에 앉아요."],
  歩く: ["駅まで歩きます。", "えきまであるきます。", "역까지 걸어요."],
  走る: ["公園で走ります。", "こうえんではしります。", "공원에서 달려요."],
  泳ぐ: ["プールで泳ぎます。", "ぷーるでおよぎます。", "수영장에서 수영해요."],
  休む: ["少し休みます。", "すこしやすみます。", "조금 쉬어요."],
  始める: ["勉強を始めます。", "べんきょうをはじめます。", "공부를 시작해요."],
  終わる: ["授業が終わります。", "じゅぎょうがおわります。", "수업이 끝나요."],
  待つ: ["ここで待ちます。", "ここでまちます。", "여기서 기다려요."],
  急ぐ: ["少し急ぎます。", "すこしいそぎます。", "조금 서둘러요."],
  忘れる: ["時々、名前を忘れます。", "ときどき、なまえをわすれます。", "가끔 이름을 잊어요."],
  覚える: ["新しい言葉を覚えます。", "あたらしいことばをおぼえます。", "새로운 단어를 외워요."],
  分かる: ["意味が分かります。", "いみがわかります。", "뜻을 알아요."],
  考える: ["予定を考えます。", "よていをかんがえます。", "계획을 생각해요."],
  選ぶ: ["好きな色を選びます。", "すきないろをえらびます。", "좋아하는 색을 골라요."],
  比べる: ["値段を比べます。", "ねだんをくらべます。", "가격을 비교해요."],
  変える: ["予定を変えます。", "よていをかえます。", "계획을 바꿔요."],
  働く: ["会社で働きます。", "かいしゃではたらきます。", "회사에서 일해요."],
  勤める: ["日本の会社に勤めています。", "にほんのかいしゃにつとめています。", "일본 회사에 다니고 있어요."],
  調べる: ["原因を調べます。", "げんいんをしらべます。", "원인을 조사해요."],
  会う: ["友達に会います。", "ともだちにあいます。", "친구를 만나요."],
  遊ぶ: ["公園で遊びます。", "こうえんであそびます。", "공원에서 놀아요."],
  笑う: ["みんなで笑います。", "みんなでわらいます。", "다 같이 웃어요."],
  泣く: ["赤ちゃんが泣いています。", "あかちゃんがないています。", "아기가 울고 있어요."],
  歌う: ["好きな歌を歌います。", "すきなうたをうたいます。", "좋아하는 노래를 불러요."],
  踊る: ["音楽に合わせて踊ります。", "おんがくにあわせておどります。", "음악에 맞춰 춤춰요."],
  誘う: ["友達を誘います。", "ともだちをさそいます。", "친구에게 함께하자고 해요."],
  断る: ["誘いを断ります。", "さそいをことわります。", "초대를 거절해요."],
  褒める: ["子供を褒めます。", "こどもをほめます。", "아이를 칭찬해요."],
  謝る: ["友達に謝ります。", "ともだちにあやまります。", "친구에게 사과해요."],
  喜ぶ: ["友達が喜んでいます。", "ともだちがよろこんでいます。", "친구가 기뻐하고 있어요."],
  怒る: ["父が怒っています。", "ちちがおこっています。", "아버지가 화나 있어요."],
  驚く: ["大きな音に驚きました。", "おおきなおとにおどろきました。", "큰 소리에 놀랐어요."],
  手伝う: ["料理を手伝います。", "りょうりをてつだいます。", "요리를 도와요."],
  送る: ["手紙を送ります。", "てがみをおくります。", "편지를 보내요."],
  迎える: ["駅で友達を迎えます。", "えきでともだちをむかえます。", "역에서 친구를 마중해요."],
  貸す: ["友達に本を貸します。", "ともだちにほんをかします。", "친구에게 책을 빌려줘요."],
  借りる: ["図書館で本を借ります。", "としょかんでほんをかります。", "도서관에서 책을 빌려요."],
  教える: ["日本語を教えます。", "にほんごをおしえます。", "일본어를 가르쳐요."],
  習う: ["日本語を習います。", "にほんごをならいます。", "일본어를 배워요."],
};
const workVerbs = new Map("確認する:확인해요|連絡する:연락해요|報告する:보고해요|相談する:상담해요|説明する:설명해요|提出する:제출해요|承認する:승인해요|修正する:수정해요|変更する:변경해요|準備する:준비해요|整理する:정리해요|共有する:공유해요|検討する:검토해요|対応する:대응해요|依頼する:의뢰해요|受注する:수주해요|契約する:계약해요".split("|").map((entry) => entry.split(":") as [string, string]));

export function isNumberPracticeWord(word: string): boolean {
  return /^[〇零一二三四五六七八九十百千\d]+(?:時|月|日|分|階|番|個|人)?$/.test(word);
}

export function getVocabularyLevel(word: string, category: string): LearningLevel {
  if (firstWords.has(word)) return "beginner";
  if (isNumberPracticeWord(word)) return "basic";
  return category === "업무" ? "practical" : "basic";
}

// A deliberately small first set. Longer clauses and formal business speech
// remain available in the library, not mixed into the first beginner filter.
const firstSentences = new Set("こんにちは|おはようございます|ありがとうございます|すみません|はい|いいえ|おやすみなさい|さようなら|これは何ですか|これは水です|私は学生です|韓国から来ました|日本語を勉強しています|よろしくお願いします|もう一度お願いします|ゆっくり話してください|トイレはどこですか|駅はどこですか|いくらですか|これをください|水をください|大丈夫です|元気です|パンを食べます|水を飲みます|本を読みます|名前を書きます|学校に行きます|家に帰ります|友達が来ます|今日は休みです|今、何時ですか|明日、会いましょう|大きいです|小さいです|安いです|高いです|楽しいです|嬉しいです|寒いです|暑いです".split("|"));
export function getSentenceLearningLevel(japanese: string, category: string): LearningLevel {
  const plain = japanese.replace(/[。！？?!]/g, "").trim();
  if (firstSentences.has(plain)) return "beginner";
  if (category === "업무" || /いただ|ございます|なければ|にもかかわらず|わけでは|ようにして|ことにな|させて/.test(plain)) return "practical";
  return "basic";
}

export function getVocabularyPartOfSpeech(word: string, fallback: PartOfSpeech = "noun"): PartOfSpeech {
  if (["美味しい", "眠い", "痛い"].includes(word)) return "i-adjective";
  if (iAdjectives.has(word)) return "i-adjective";
  if (naAdjectives.has(word)) return "na-adjective";
  if (verbExamples[word] || workVerbs.has(word)) return "verb";
  if (word === "都合がいい" || word === "都合が悪い") return "expression";
  return fallback;
}

export type VocabularyExample = { japanese: string; reading: string; meaning: string; pronunciationReading: string };

export function createVocabularyExample(word: string, reading: string, meaning: string): VocabularyExample {
  const example = (japanese: string, kana: string, korean: string, pronunciationReading = kana) => ({ japanese, reading: kana, meaning: korean, pronunciationReading });
  const verb = verbExamples[word];
  if (verb) return example(...verb);
  const workVerb = workVerbs.get(word);
  if (workVerb) return example(word.slice(0, -2) + "します。", reading.slice(0, -2) + "します。", workVerb + ".");
  const adjective = iAdjectives.get(word) ?? naAdjectives.get(word);
  if (adjective) return example(word + "です。", reading + "です。", adjective + ".");
  if (word === "都合がいい") return example("明日は都合がいいです。", "あしたはつごうがいいです。", "내일은 시간이 괜찮아요.", "あしたわつごうがいいです。");
  if (word === "都合が悪い") return example("今日は都合が悪いです。", "きょうはつごうがわるいです。", "오늘은 시간이 안 맞아요.", "きょうわつごうがわるいです。");
  if (isNumberPracticeWord(word)) {
    const suffix = word.slice(-1);
    const counterPatterns: Record<string, [string, string, string, string]> = {
      時: ["集合は", "しゅうごうは", "집합 시간은 ", "しゅうごうわ"],
      月: ["出発は", "しゅっぱつは", "출발은 ", "しゅっぱつわ"],
      日: ["予約日は", "よやくびは", "예약일은 ", "よやくびわ"],
      階: ["部屋は", "へやは", "방은 ", "へやわ"],
      番: ["番号は", "ばんごうは", "번호는 ", "ばんごうわ"],
      人: ["予約は", "よやくは", "예약 인원은 ", "よやくわ"],
    };
    const parts = counterPatterns[suffix];
    if (parts) return example(parts[0] + word + "です。", parts[1] + reading + "です。", parts[2] + meaning + "입니다.", parts[3] + reading + "です。");
    if (suffix === "分") return example("あと" + word + "です。", "あと" + reading + "です。", "앞으로 " + meaning + " 남았어요.");
    if (suffix === "個") return example("りんごを" + word + "ください。", "りんごを" + reading + "ください。", "사과 " + meaning + " 주세요.");
    return example("答えは" + word + "です。", "こたえは" + reading + "です。", "정답은 " + meaning + "입니다.", "こたえわ" + reading + "です。");
  }
  // Noun-only construction. No index-based assignment and no suffix guessing
  // (休日 is not a numeric date; 案内人 is not a numeric person counter).
  return example(word + "について教えてください。", reading + "についておしえてください。", "‘" + meaning + "’에 대해 알려 주세요.");
}
