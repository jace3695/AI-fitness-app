export type LearningCategory = "일상" | "여행" | "업무" | "친구" | string;
export type LearningLevel = "beginner" | "basic" | "practical";

export type SentenceItem = {
  id?: string;
  category: LearningCategory;
  level?: LearningLevel;
  japanese: string;
  reading?: string;
  rubySegments?: RubySegment[];
  koreanPronunciation?: string;
  meaning: string;
  note: string;
  description?: string;
  pattern?: string;
  relatedWords?: string[];
};

export type RubySegment = {
  text: string;
  reading?: string;
};

const normalizeSentencePattern = (sentence: SentenceItem): string => {
  const normalized = sentence.pattern?.replace(/_/g, "-");
  if (normalized) return normalized;

  const text = sentence.japanese;
  if (text.includes("どこ") || text.includes("道に迷")) return "direction";
  if (text.includes("ください") || text.includes("お願いします")) return "request";
  if (text.includes("いくら") || text.includes("会計") || text.includes("レシート") || text.includes("サイズ")) return "shopping";
  if (text.includes("ですか") || text.includes("ますか") || text.includes("？") || text.includes("?")) return "question";
  if (text.includes("で")) return "particle-de";
  if (text.includes("に")) return "particle-ni";
  if (text.includes("を")) return "particle-wo";
  if (text.includes("は")) return "particle-wa";
  if (text.includes("ます")) return "masu";
  if (text.includes("です")) return "desu";

  if (sentence.category === "여행") return "travel";
  if (sentence.category === "업무") return "work";
  if (sentence.category === "일상" || sentence.category === "친구") return "daily";
  return "other";
};

const KANJI_REGEX = /[一-龯々]/;

const buildReadingFromRubySegments = (rubySegments?: RubySegment[]): string | undefined => {
  if (!rubySegments || rubySegments.length === 0) return undefined;

  const merged = rubySegments
    .map((segment) => {
      const raw = segment.reading ?? segment.text;
      if (KANJI_REGEX.test(raw)) return "";
      return raw;
    })
    .join("")
    .trim();

  return merged.length > 0 ? merged : undefined;
};

const inferRelatedWords = (sentence: SentenceItem): string[] => {
  if (sentence.relatedWords && sentence.relatedWords.length > 0) return sentence.relatedWords;
  const source = sentence.rubySegments?.map((segment) => segment.text).join("") || sentence.japanese;
  const matches = source.match(/[一-龯ぁ-んァ-ンー]{2,}/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 4);
};

const BASE_SENTENCES: SentenceItem[] = ([
  // ===== 여행 =====
  { level: "beginner", japanese: "これをください", koreanPronunciation: "코레오 쿠다사이", meaning: "이거 주세요", category: "여행", note: "가게나 식당에서 주문할 때" },
  { level: "beginner", japanese: "おすすめは何ですか？", reading: "おすすめはなんですか？", rubySegments: [{ text: "おすすめは" }, { text: "何", reading: "なん" }, { text: "ですか？" }], koreanPronunciation: "오스스메와 난데스카?", meaning: "추천은 뭐예요?", category: "여행", note: "식당이나 가게에서 추천을 물을 때" },
  { level: "beginner", japanese: "お会計お願いします", reading: "おかいけいおねがいします", rubySegments: [{ text: "お" }, { text: "会計", reading: "かいけい" }, { text: "お願いします" }], koreanPronunciation: "오카이케이 오네가이시마스", meaning: "계산 부탁합니다", category: "여행", note: "식당에서 계산을 요청할 때" },
  { level: "basic", japanese: "カードは使えますか？", reading: "かーどはつかえますか？", rubySegments: [{ text: "カードは" }, { text: "使", reading: "つか" }, { text: "えますか？" }], koreanPronunciation: "카아도와 츠카에마스카?", meaning: "카드 사용할 수 있나요?", category: "여행", note: "결제 가능 여부를 확인할 때" },
  { level: "basic", japanese: "現金だけですか？", rubySegments: [{ text: "現金", reading: "げんきん" }, { text: "だけですか？" }], koreanPronunciation: "겐킨다케데스카?", meaning: "현금만 되나요?", category: "여행", note: "카드 결제가 안 되는지 확인할 때" },
  { level: "basic", japanese: "水をください", rubySegments: [{ text: "水", reading: "みず" }, { text: "をください" }], koreanPronunciation: "미즈오 쿠다사이", meaning: "물 주세요", category: "여행", note: "식당에서 물을 요청할 때" },
  { level: "practical", japanese: "トイレはどこですか？", koreanPronunciation: "토이레와 도코데스카?", meaning: "화장실은 어디예요?", category: "여행", note: "화장실 위치를 물을 때" },
  { level: "practical", japanese: "駅はどこですか？", reading: "えきはどこですか？", rubySegments: [{ text: "駅", reading: "えき" }, { text: "はどこですか？" }], koreanPronunciation: "에키와 도코데스카?", meaning: "역은 어디예요?", category: "여행", note: "역 위치를 물을 때" },
  { level: "practical", japanese: "ここから遠いですか？", reading: "ここからとおいですか？", rubySegments: [{ text: "ここから" }, { text: "遠", reading: "とお" }, { text: "いですか？" }], koreanPronunciation: "코코카라 토오이데스카?", meaning: "여기서 멀어요?", category: "여행", note: "거리감을 물을 때" },
  { japanese: "歩いて行けますか？", rubySegments: [{ text: "歩", reading: "ある" }, { text: "いて" }, { text: "行", reading: "い" }, { text: "けますか？" }], koreanPronunciation: "아루이테 이케마스카?", meaning: "걸어서 갈 수 있어요?", category: "여행", note: "도보 이동 가능 여부를 물을 때" },
  { japanese: "予約しています", reading: "よやくしています", rubySegments: [{ text: "予約", reading: "よやく" }, { text: "しています" }], koreanPronunciation: "요야쿠시테이마스", meaning: "예약했습니다", category: "여행", note: "호텔이나 식당에서 예약 사실을 말할 때" },
  { japanese: "チェックインお願いします", reading: "ちぇっくいんおねがいします", rubySegments: [{ text: "チェックインお" }, { text: "願", reading: "ねが" }, { text: "いします" }], koreanPronunciation: "첵쿠인 오네가이시마스", meaning: "체크인 부탁합니다", category: "여행", note: "호텔 체크인할 때" },
  { japanese: "チェックアウトは何時ですか？", reading: "ちぇっくあうとはなんじですか？", rubySegments: [{ text: "チェックアウトは" }, { text: "何時", reading: "なんじ" }, { text: "ですか？" }], koreanPronunciation: "첵쿠아우토와 난지데스카?", meaning: "체크아웃은 몇 시예요?", category: "여행", note: "호텔 체크아웃 시간을 물을 때" },
  { japanese: "荷物を預けたいです", reading: "にもつをあずけたいです", rubySegments: [{ text: "荷", reading: "に" }, { text: "物", reading: "もつ" }, { text: "を" }, { text: "預", reading: "あず" }, { text: "けたいです" }], koreanPronunciation: "니모츠오 아즈케타이데스", meaning: "짐을 맡기고 싶어요", category: "여행", note: "호텔이나 역에서 짐을 맡길 때" },
  { japanese: "英語は話せますか？", rubySegments: [{ text: "英語", reading: "えいご" }, { text: "は" }, { text: "話", reading: "はな" }, { text: "せますか？" }], koreanPronunciation: "에이고와 하나세마스카?", meaning: "영어 할 수 있어요?", category: "여행", note: "의사소통 가능 언어를 물을 때" },
  { japanese: "日本語が少しできます", rubySegments: [{ text: "日本語", reading: "にほんご" }, { text: "が" }, { text: "少", reading: "すこ" }, { text: "しできます" }], koreanPronunciation: "니혼고가 스코시 데키마스", meaning: "일본어를 조금 할 수 있어요", category: "여행", note: "자신의 일본어 수준을 말할 때" },
  { japanese: "ゆっくり話してください", reading: "ゆっくりはなしてください", rubySegments: [{ text: "ゆっくり" }, { text: "話", reading: "はな" }, { text: "してください" }], koreanPronunciation: "윳쿠리 하나시테 쿠다사이", meaning: "천천히 말해 주세요", category: "여행", note: "상대 말이 빠를 때" },
  { japanese: "もう一度お願いします", reading: "もういちどおねがいします", rubySegments: [{ text: "もう" }, { text: "一度", reading: "いちど" }, { text: "お願いします" }], koreanPronunciation: "모오 이치도 오네가이시마스", meaning: "한 번 더 부탁합니다", category: "여행", note: "다시 말해 달라고 할 때" },
  { japanese: "写真を撮ってもいいですか？", rubySegments: [{ text: "写真", reading: "しゃしん" }, { text: "を" }, { text: "撮", reading: "と" }, { text: "ってもいいですか？" }], koreanPronunciation: "샤신오 톳테모 이이데스카?", meaning: "사진 찍어도 돼요?", category: "여행", note: "촬영 가능 여부를 물을 때" },
  { japanese: "これはいくらですか？", koreanPronunciation: "코레와 이쿠라데스카?", meaning: "이거 얼마예요?", category: "여행", note: "가격을 물을 때" },
  { japanese: "切符を買いたいです", rubySegments: [{ text: "切符", reading: "きっぷ" }, { text: "を" }, { text: "買", reading: "か" }, { text: "いたいです" }], koreanPronunciation: "킷푸오 카이타이데스", meaning: "표를 사고 싶어요", category: "여행", note: "교통권이나 입장권을 살 때" },
  { japanese: "この電車はどこに行きますか？", reading: "このでんしゃはどこにいきますか？", rubySegments: [{ text: "この" }, { text: "電", reading: "でん" }, { text: "車", reading: "しゃ" }, { text: "はどこに" }, { text: "行", reading: "い" }, { text: "きますか？" }], koreanPronunciation: "코노 덴샤와 도코니 이키마스카?", meaning: "이 전철은 어디로 가나요?", category: "여행", note: "전철 방향을 확인할 때" },
  { japanese: "次の駅で降ります", rubySegments: [{ text: "次", reading: "つぎ" }, { text: "の" }, { text: "駅", reading: "えき" }, { text: "で" }, { text: "降", reading: "お" }, { text: "ります" }], koreanPronunciation: "츠기노 에키데 오리마스", meaning: "다음 역에서 내립니다", category: "여행", note: "하차 위치를 말할 때" },
  { japanese: "この近くにコンビニはありますか？", reading: "このちかくにこんびにはありますか？", rubySegments: [{ text: "この" }, { text: "近", reading: "ちか" }, { text: "くにコンビニはありますか？" }], koreanPronunciation: "코노 치카쿠니 콘비니와 아리마스카?", meaning: "이 근처에 편의점이 있나요?", category: "여행", note: "근처 편의시설을 찾을 때" },
  { japanese: "道に迷いました", rubySegments: [{ text: "道", reading: "みち" }, { text: "に" }, { text: "迷", reading: "まよ" }, { text: "いました" }], koreanPronunciation: "미치니 마요이마시타", meaning: "길을 잃었어요", category: "여행", note: "길을 잃었을 때 도움을 요청할 때" },
  { japanese: "ここに行きたいです", reading: "ここにいきたいです", rubySegments: [{ text: "ここに" }, { text: "行", reading: "い" }, { text: "きたいです" }], koreanPronunciation: "코코니 이키타이데스", meaning: "여기에 가고 싶어요", category: "여행", note: "지도나 주소를 보여주며 말할 때" },
  { japanese: "タクシーを呼んでください", reading: "たくしーをよんでください", rubySegments: [{ text: "タクシーを" }, { text: "呼", reading: "よ" }, { text: "んでください" }], koreanPronunciation: "타쿠시오 욘데 쿠다사이", meaning: "택시를 불러 주세요", category: "여행", note: "택시 호출을 요청할 때" },
  { japanese: "辛くしないでください", rubySegments: [{ text: "辛", reading: "から" }, { text: "くしないでください" }], koreanPronunciation: "카라쿠 시나이데 쿠다사이", meaning: "맵게 하지 말아 주세요", category: "여행", note: "음식 주문 시 요청할 때" },
  { japanese: "持ち帰りできますか？", rubySegments: [{ text: "持", reading: "も" }, { text: "ち" }, { text: "帰", reading: "かえ" }, { text: "りできますか？" }], koreanPronunciation: "모치카에리 데키마스카?", meaning: "포장 가능해요?", category: "여행", note: "음식 포장 가능 여부를 물을 때" },
  { japanese: "店内で食べます", rubySegments: [{ text: "店内", reading: "てんない" }, { text: "で" }, { text: "食", reading: "た" }, { text: "べます" }], koreanPronunciation: "텐나이데 타베마스", meaning: "매장에서 먹을게요", category: "여행", note: "식사 장소를 말할 때" },
  { japanese: "袋をください", rubySegments: [{ text: "袋", reading: "ふくろ" }, { text: "をください" }], koreanPronunciation: "후쿠로오 쿠다사이", meaning: "봉투 주세요", category: "여행", note: "가게에서 봉투를 요청할 때" },
  { japanese: "レシートをください", koreanPronunciation: "레시이토오 쿠다사이", meaning: "영수증 주세요", category: "여행", note: "영수증을 요청할 때" },
  { japanese: "免税できますか？", rubySegments: [{ text: "免税", reading: "めんぜい" }, { text: "できますか？" }], koreanPronunciation: "멘제이 데키마스카?", meaning: "면세 가능해요?", category: "여행", note: "쇼핑 시 면세 가능 여부를 물을 때" },
  { japanese: "試着してもいいですか？", rubySegments: [{ text: "試着", reading: "しちゃく" }, { text: "してもいいですか？" }], koreanPronunciation: "시챠쿠시테모 이이데스카?", meaning: "입어봐도 돼요?", category: "여행", note: "옷가게에서 시착을 요청할 때" },
  { japanese: "別のサイズはありますか？", rubySegments: [{ text: "別", reading: "べつ" }, { text: "のサイズはありますか？" }], koreanPronunciation: "베츠노 사이즈와 아리마스카?", meaning: "다른 사이즈 있나요?", category: "여행", note: "사이즈를 물을 때" },
  { japanese: "これにします", koreanPronunciation: "코레니 시마스", meaning: "이걸로 할게요", category: "여행", note: "선택을 확정할 때" },
  { japanese: "少し考えます", rubySegments: [{ text: "少", reading: "すこ" }, { text: "し" }, { text: "考", reading: "かんが" }, { text: "えます" }], koreanPronunciation: "스코시 칸가에마스", meaning: "조금 생각해볼게요", category: "여행", note: "구매를 잠시 보류할 때" },
  { japanese: "助けてください", rubySegments: [{ text: "助", reading: "たす" }, { text: "けてください" }], koreanPronunciation: "타스케테 쿠다사이", meaning: "도와주세요", category: "여행", note: "도움이 필요할 때" },
  { japanese: "病院に行きたいです", rubySegments: [{ text: "病院", reading: "びょういん" }, { text: "に" }, { text: "行", reading: "い" }, { text: "きたいです" }], koreanPronunciation: "뵤오인니 이키타이데스", meaning: "병원에 가고 싶어요", category: "여행", note: "몸이 아플 때" },
  { japanese: "薬局はどこですか？", rubySegments: [{ text: "薬局", reading: "やっきょく" }, { text: "はどこですか？" }], koreanPronunciation: "야쿄쿠와 도코데스카?", meaning: "약국은 어디예요?", category: "여행", note: "약국 위치를 물을 때" },
  { japanese: "空港までどのくらいかかりますか？", reading: "くうこうまでどのくらいかかりますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "空港", reading: "くうこう" }, { text: "までどのくらいかかりますか？" }], koreanPronunciation: "쿠우코오마데 도노쿠라이 카카리마스카?", meaning: "공항까지 얼마나 걸리나요?", category: "여행", note: "이동 시간을 물을 때", description: "택시나 버스에서 소요 시간을 확인하는 표현" },
  { japanese: "搭乗口を教えてください", reading: "とうじょうぐちをおしえてください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "搭乗口", reading: "とうじょうぐち" }, { text: "を" }, { text: "教", reading: "おし" }, { text: "えてください" }], koreanPronunciation: "토오조오구치오 오시에테 구다사이", meaning: "탑승구를 알려 주세요", category: "여행", note: "공항에서 탑승구를 찾을 때", description: "공항 직원에게 탑승구 위치를 물을 때" },
  { japanese: "この便は遅れていますか？", reading: "このびんはおくれていますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "この" }, { text: "便", reading: "びん" }, { text: "は" }, { text: "遅", reading: "おく" }, { text: "れていますか？" }], koreanPronunciation: "코노빈와 오쿠레테이마스카?", meaning: "이 항공편은 지연되고 있나요?", category: "여행", note: "항공편 지연 여부를 확인할 때", description: "출발 전 항공편 상태를 확인하는 표현" },
  { japanese: "入国カードはどこで書きますか？", reading: "にゅうこくカードはどこでかきますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "入国", reading: "にゅうこく" }, { text: "カードはどこで" }, { text: "書", reading: "か" }, { text: "きますか？" }], koreanPronunciation: "뉴우코쿠 카아도와 도코데 카키마스카?", meaning: "입국카드는 어디에서 작성하나요?", category: "여행", note: "입국 절차에서 물을 때", description: "입국장 내 작성 장소를 찾을 때" },
  { japanese: "チェックインをお願いします", reading: "チェックインをおねがいします", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "チェックインをお" }, { text: "願", reading: "ねが" }, { text: "いします" }], koreanPronunciation: "첵쿠인오 오네가이시마스", meaning: "체크인 부탁드립니다", category: "여행", note: "호텔 프런트에서", description: "호텔 도착 후 객실 배정을 요청할 때" },
  { japanese: "パスポートをお見せします", reading: "パスポートをおみせします", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "パスポートをお" }, { text: "見", reading: "み" }, { text: "せします" }], koreanPronunciation: "파스포오토오 오미세시마스", meaning: "여권을 보여드리겠습니다", category: "여행", note: "신분 확인이 필요할 때", description: "호텔이나 공항에서 신분증 제시할 때" },
  { japanese: "朝食は何時からですか？", reading: "ちょうしょくはなんじからですか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "朝食", reading: "ちょうしょく" }, { text: "は" }, { text: "何時", reading: "なんじ" }, { text: "からですか？" }], koreanPronunciation: "초오쇼쿠와 난지카라데스카?", meaning: "아침 식사는 몇 시부터인가요?", category: "여행", note: "호텔 식사 시간을 물을 때", description: "호텔 조식 이용 시간을 확인할 때" },
  { japanese: "部屋の鍵が開きません", reading: "へやのかぎがあきません", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "部屋", reading: "へや" }, { text: "の" }, { text: "鍵", reading: "かぎ" }, { text: "が" }, { text: "開", reading: "あ" }, { text: "きません" }], koreanPronunciation: "헤야노 카기가 아키마셍", meaning: "방 열쇠가 열리지 않아요", category: "여행", note: "객실 출입 문제가 있을 때", description: "키카드나 열쇠 문제를 프런트에 말할 때" },
  { japanese: "タオルをもう一枚ください", reading: "タオルをもういちまいください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "タオルをもう" }, { text: "一枚", reading: "いちまい" }, { text: "ください" }], koreanPronunciation: "타오루오 모오 이치마이 구다사이", meaning: "수건 한 장 더 주세요", category: "여행", note: "호텔 비품을 요청할 때", description: "추가 수건이 필요할 때 쓰는 표현" },
  { japanese: "荷物を部屋までお願いします", reading: "にもつをへやまでおねがいします", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "荷物", reading: "にもつ" }, { text: "を" }, { text: "部屋", reading: "へや" }, { text: "までお" }, { text: "願", reading: "ねが" }, { text: "いします" }], koreanPronunciation: "니모츠오 헤야마데 오네가이시마스", meaning: "짐을 방까지 부탁드립니다", category: "여행", note: "짐 운반을 요청할 때", description: "호텔에서 짐 이동 도움을 요청하는 표현" },
  { japanese: "おすすめの料理はありますか？", reading: "おすすめのりょうりはありますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "おすすめの" }, { text: "料理", reading: "りょうり" }, { text: "はありますか？" }], koreanPronunciation: "오스스메노 료오리와 아리마스카?", meaning: "추천 요리가 있나요?", category: "여행", note: "식당에서 메뉴를 물을 때", description: "처음 가는 식당에서 인기 메뉴를 확인할 때" },
  { japanese: "アレルギーがあります", reading: "アレルギーがあります", /* TODO: rubySegments 수동 확인 필요 */ /* TODO: rubySegments 수동 확인 필요 */ koreanPronunciation: "아레루기이가 아리마스", meaning: "알레르기가 있습니다", category: "여행", note: "음식 주문 전 주의할 때", description: "식재료 알레르기를 미리 알릴 때" },
  { japanese: "肉なしでお願いします", reading: "にくなしでおねがいします", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "肉", reading: "にく" }, { text: "なしでお" }, { text: "願", reading: "ねが" }, { text: "いします" }], koreanPronunciation: "니쿠나시데 오네가이시마스", meaning: "고기 빼고 부탁드립니다", category: "여행", note: "재료 변경을 요청할 때", description: "개인 식단에 맞게 메뉴를 조정할 때" },
  { japanese: "お水をもう一杯ください", reading: "おみずをもういっぱいください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "お" }, { text: "水", reading: "みず" }, { text: "をもう" }, { text: "一杯", reading: "いっぱい" }, { text: "ください" }], koreanPronunciation: "오미즈오 모오 잇파이 구다사이", meaning: "물 한 잔 더 주세요", category: "여행", note: "식사 중 추가 주문", description: "음료를 추가로 요청할 때" },
  { japanese: "先にお会計できますか？", reading: "さきにおかいけいできますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "先", reading: "さき" }, { text: "にお" }, { text: "会計", reading: "かいけい" }, { text: "できますか？" }], koreanPronunciation: "사키니 오카이케이 데키마스카?", meaning: "먼저 계산할 수 있나요?", category: "여행", note: "식당에서 먼저 계산할 때", description: "식사 전후 결제 순서를 조정할 때" },
  { japanese: "この住所まで行ってください", reading: "このじゅうしょまでいってください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "この" }, { text: "住所", reading: "じゅうしょ" }, { text: "まで" }, { text: "行", reading: "い" }, { text: "ってください" }], koreanPronunciation: "코노 주우쇼마데 잇테 구다사이", meaning: "이 주소까지 가 주세요", category: "여행", note: "택시 기사에게 목적지를 말할 때", description: "지도나 주소를 보여주며 이동 요청할 때" },
  { japanese: "次の角を右に曲がってください", reading: "つぎのかどをみぎにまがってください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "次", reading: "つぎ" }, { text: "の" }, { text: "角", reading: "かど" }, { text: "を" }, { text: "右", reading: "みぎ" }, { text: "に" }, { text: "曲", reading: "ま" }, { text: "がってください" }], koreanPronunciation: "츠기노 카도오 미기니 마갓테 구다사이", meaning: "다음 모퉁이에서 오른쪽으로 돌아 주세요", category: "여행", note: "길 안내를 할 때", description: "운전자에게 경로를 구체적으로 알려줄 때" },
  { japanese: "この近くにATMはありますか？", reading: "このちかくにエーティーエムはありますか？", rubySegments: [{ text: "この" }, { text: "近", reading: "ちか" }, { text: "くにATMはありますか？" }], koreanPronunciation: "코노 치카쿠니 에이티이에무와 아리마스카?", meaning: "이 근처에 ATM이 있나요?", category: "여행", note: "현금이 필요할 때", description: "주변 금융기기 위치를 물을 때" },
  { japanese: "一番近い駅はどこですか？", reading: "いちばんちかいえきはどこですか？", rubySegments: [{ text: "一番", reading: "いちばん" }, { text: "近", reading: "ちか" }, { text: "い" }, { text: "駅", reading: "えき" }, { text: "はどこですか？" }], koreanPronunciation: "이치방 치카이 에키와 도코데스카?", meaning: "가장 가까운 역은 어디인가요?", category: "여행", note: "역 위치를 물을 때", description: "도보로 갈 수 있는 가까운 역을 찾을 때" },
  { japanese: "このバスは市役所に行きますか？", reading: "このバスはしやくしょにいきますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "このバスは" }, { text: "市役所", reading: "しやくしょ" }, { text: "に" }, { text: "行", reading: "い" }, { text: "きますか？" }], koreanPronunciation: "코노 바스와 시야쿠쇼니 이키마스카?", meaning: "이 버스는 시청에 가나요?", category: "여행", note: "버스 노선을 확인할 때", description: "탑승 전 목적지 도착 여부를 확인할 때" },
  { japanese: "乗り換えは何回ですか？", reading: "のりかえはなんかいですか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "乗", reading: "の" }, { text: "り" }, { text: "換", reading: "か" }, { text: "えは" }, { text: "何回", reading: "なんかい" }, { text: "ですか？" }], koreanPronunciation: "노리카에와 난카이데스카?", meaning: "환승은 몇 번인가요?", category: "여행", note: "교통 경로를 확인할 때", description: "복잡한 이동 경로의 환승 횟수를 물을 때" },
  { japanese: "ICカードにチャージしたいです", reading: "アイシーカードにチャージしたいです", /* TODO: rubySegments 수동 확인 필요 */ /* TODO: rubySegments 수동 확인 필요 */ koreanPronunciation: "아이시이카아도니 챠아지시타이데스", meaning: "IC카드에 충전하고 싶어요", category: "여행", note: "교통카드 충전을 요청할 때", description: "역 창구나 편의점에서 충전할 때" },
  { japanese: "この電車は急行ですか？", reading: "このでんしゃはきゅうこうですか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "この" }, { text: "電車", reading: "でんしゃ" }, { text: "は" }, { text: "急行", reading: "きゅうこう" }, { text: "ですか？" }], koreanPronunciation: "코노 덴샤와 큐우코오데스카?", meaning: "이 전철은 급행인가요?", category: "여행", note: "전철 종류를 확인할 때", description: "정차역이 적은 급행 여부를 물을 때" },
  { japanese: "試着室はどこですか？", reading: "しちゃくしつはどこですか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "試着室", reading: "しちゃくしつ" }, { text: "はどこですか？" }], koreanPronunciation: "시챠쿠시츠와 도코데스카?", meaning: "탈의실은 어디인가요?", category: "여행", note: "의류 매장에서", description: "옷을 입어보기 전에 장소를 물을 때" },
  { japanese: "これの色違いはありますか？", reading: "これのいろちがいはありますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "これの" }, { text: "色違", reading: "いろちが" }, { text: "いはありますか？" }], koreanPronunciation: "코레노 이로치가이와 아리마스카?", meaning: "이거 다른 색상도 있나요?", category: "여행", note: "상품 색상을 물을 때", description: "같은 상품의 다른 컬러를 찾을 때" },
  { japanese: "お土産にしたいです", reading: "おみやげにしたいです", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "お" }, { text: "土産", reading: "みやげ" }, { text: "にしたいです" }], koreanPronunciation: "오미야게니 시타이데스", meaning: "선물용으로 하고 싶어요", category: "여행", note: "포장이나 추천을 요청할 때", description: "기념품 구매 의도를 전달할 때" },
  { japanese: "袋は有料ですか？", reading: "ふくろはゆうりょうですか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "袋", reading: "ふくろ" }, { text: "は" }, { text: "有料", reading: "ゆうりょう" }, { text: "ですか？" }], koreanPronunciation: "후쿠로와 유우료오데스카?", meaning: "봉투는 유료인가요?", category: "여행", note: "결제 전에 추가 비용을 확인할 때", description: "쇼핑 시 봉투 비용 여부를 물을 때" },
  { japanese: "クレジットカードで払えますか？", reading: "クレジットカードではらえますか？", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "クレジットカードで" }, { text: "払", reading: "はら" }, { text: "えますか？" }], koreanPronunciation: "쿠레짓토 카아도데 하라에마스카?", meaning: "신용카드로 결제할 수 있나요?", category: "여행", note: "결제 수단을 확인할 때", description: "현금 대신 카드 결제 가능 여부를 묻는 표현" },
  { japanese: "財布をなくしました", reading: "さいふをなくしました", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "財布", reading: "さいふ" }, { text: "をなくしました" }], koreanPronunciation: "사이후오 나쿠시마시타", meaning: "지갑을 잃어버렸습니다", category: "여행", note: "분실 신고가 필요할 때", description: "소지품 분실 사실을 바로 알릴 때" },
  { japanese: "警察を呼んでください", reading: "けいさつをよんでください", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "警察", reading: "けいさつ" }, { text: "を" }, { text: "呼", reading: "よ" }, { text: "んでください" }], koreanPronunciation: "케이사츠오 욘데 구다사이", meaning: "경찰을 불러 주세요", category: "여행", note: "긴급 상황에서", description: "도난이나 사고가 발생했을 때 도움 요청" },
  { japanese: "気分が悪いです", reading: "きぶんがわるいです", /* TODO: rubySegments 수동 확인 필요 */ rubySegments: [{ text: "気分", reading: "きぶん" }, { text: "が" }, { text: "悪", reading: "わる" }, { text: "いです" }], koreanPronunciation: "키분가 와루이데스", meaning: "몸 상태가 안 좋아요", category: "여행", note: "몸이 좋지 않을 때", description: "병원 방문 전 증상을 간단히 전달할 때" },

  // ===== 업무 =====
  { level: "beginner", japanese: "ご確認お願いします", reading: "ごかくにんおねがいします", rubySegments: [{ text: "ご" }, { text: "確認", reading: "かくにん" }, { text: "お願いします" }], koreanPronunciation: "고카쿠닌 오네가이시마스", meaning: "확인 부탁드립니다", category: "업무", note: "메일이나 업무 대화에서 확인을 요청할 때" },
  { level: "beginner", japanese: "ご連絡ありがとうございます", reading: "ごれんらくありがとうございます", rubySegments: [{ text: "ご" }, { text: "連絡", reading: "れんらく" }, { text: "ありがとうございます" }], koreanPronunciation: "고렌라쿠 아리가토오 고자이마스", meaning: "연락 감사합니다", category: "업무", note: "상대의 연락에 감사할 때" },
  { level: "beginner", japanese: "資料を送付いたします", rubySegments: [{ text: "資料", reading: "しりょう" }, { text: "を" }, { text: "送付", reading: "そうふ" }, { text: "いたします" }], koreanPronunciation: "시료오 소오후 이타시마스", meaning: "자료를 송부드립니다", category: "업무", note: "자료를 보낼 때" },
  { level: "basic", japanese: "納期はいつですか？", rubySegments: [{ text: "納期", reading: "のうき" }, { text: "はいつですか？" }], koreanPronunciation: "노오키와 이츠데스카?", meaning: "납기는 언제입니까?", category: "업무", note: "납기 일정을 확인할 때" },
  { level: "basic", japanese: "見積をお願いします", rubySegments: [{ text: "見積", reading: "みつもり" }, { text: "をお願いします" }], koreanPronunciation: "미츠모리오 오네가이시마스", meaning: "견적 부탁드립니다", category: "업무", note: "견적 요청 시" },
  { level: "basic", japanese: "内容を確認中です", reading: "ないようをかくにんちゅうです", rubySegments: [{ text: "内容を" }, { text: "確認", reading: "かくにん" }, { text: "中です" }], koreanPronunciation: "나이요오오 카쿠닌추우데스", meaning: "내용 확인 중입니다", category: "업무", note: "검토 중임을 알릴 때" },
  { level: "practical", japanese: "対応いたします", rubySegments: [{ text: "対応", reading: "たいおう" }, { text: "いたします" }], koreanPronunciation: "타이오오 이타시마스", meaning: "대응하겠습니다", category: "업무", note: "처리 의사를 전달할 때" },
  { level: "practical", japanese: "少々お待ちください", reading: "しょうしょうおまちください", koreanPronunciation: "쇼오쇼오 오마치쿠다사이", meaning: "잠시만 기다려 주세요", category: "업무", note: "확인 시간이 필요할 때" },
  { level: "practical", japanese: "後ほどご連絡いたします", reading: "のちほどごれんらくいたします", rubySegments: [{ text: "後ほどご" }, { text: "連絡", reading: "れんらく" }, { text: "いたします" }], koreanPronunciation: "노치호도 고렌라쿠 이타시마스", meaning: "나중에 연락드리겠습니다", category: "업무", note: "추후 연락을 약속할 때" },
  { japanese: "問題ありません", rubySegments: [{ text: "問題", reading: "もんだい" }, { text: "ありません" }], koreanPronunciation: "몬다이 아리마센", meaning: "문제 없습니다", category: "업무", note: "이상이 없다고 말할 때" },
  { japanese: "修正をお願いします", reading: "しゅうせいをおねがいします", koreanPronunciation: "슈우세이오 오네가이시마스", meaning: "수정 부탁드립니다", category: "업무", note: "수정을 요청할 때" },
  { japanese: "確認いたしました", rubySegments: [{ text: "確認", reading: "かくにん" }, { text: "いたしました" }], koreanPronunciation: "카쿠닌 이타시마시타", meaning: "확인했습니다", category: "업무", note: "확인 완료를 전달할 때" },
  { japanese: "進捗はいかがですか？", rubySegments: [{ text: "進捗", reading: "しんちょく" }, { text: "はいかがですか？" }], koreanPronunciation: "신초쿠와 이카가데스카?", meaning: "진행 상황은 어떻습니까?", category: "업무", note: "진행 상태를 물을 때" },
  { japanese: "会議を設定しましょう", rubySegments: [{ text: "会議", reading: "かいぎ" }, { text: "を設定しましょう" }], koreanPronunciation: "카이기오 셋테이시마쇼오", meaning: "회의를 설정합시다", category: "업무", note: "회의 일정을 잡을 때" },
  { japanese: "資料を確認してください", rubySegments: [{ text: "資料", reading: "しりょう" }, { text: "を" }, { text: "確認", reading: "かくにん" }, { text: "してください" }], koreanPronunciation: "시료오 카쿠닌시테 쿠다사이", meaning: "자료를 확인해 주세요", category: "업무", note: "자료 검토를 요청할 때" },
  { japanese: "仕様を確認してください", rubySegments: [{ text: "仕様", reading: "しよう" }, { text: "を" }, { text: "確認", reading: "かくにん" }, { text: "してください" }], koreanPronunciation: "시요오오 카쿠닌시테 쿠다사이", meaning: "사양을 확인해 주세요", category: "업무", note: "제품 사양 확인을 요청할 때" },
  { japanese: "仕様変更は可能ですか？", rubySegments: [{ text: "仕様", reading: "しよう" }, { text: "変更", reading: "へんこう" }, { text: "は可能ですか？" }], koreanPronunciation: "시요오헨코오와 카노오데스카?", meaning: "사양 변경은 가능합니까?", category: "업무", note: "사양 변경 가능 여부를 물을 때" },
  { japanese: "価格を教えてください", reading: "かかくをおしえてください", koreanPronunciation: "카카쿠오 오시에테 쿠다사이", meaning: "가격을 알려 주세요", category: "업무", note: "가격 정보를 요청할 때" },
  { japanese: "納期を短縮できますか？", rubySegments: [{ text: "納期", reading: "のうき" }, { text: "を短縮できますか？" }], koreanPronunciation: "노오키오 탄슈쿠 데키마스카?", meaning: "납기를 단축할 수 있습니까?", category: "업무", note: "납기 단축 가능 여부를 물을 때" },
  { japanese: "サンプルを送ってください", reading: "さんぷるをおくってください", koreanPronunciation: "산푸루오 옷테 쿠다사이", meaning: "샘플을 보내 주세요", category: "업무", note: "샘플 요청 시" },
  { japanese: "図面を送付してください", reading: "ずめんをそうふしてください", rubySegments: [{ text: "図面を" }, { text: "送付", reading: "そうふ" }, { text: "してください" }], koreanPronunciation: "즈멘오 소오후시테 쿠다사이", meaning: "도면을 송부해 주세요", category: "업무", note: "도면 요청 시" },
  { japanese: "不具合が発生しました", reading: "ふぐあいがはっせいしました", koreanPronunciation: "후구아이가 핫세이시마시타", meaning: "불량이 발생했습니다", category: "업무", note: "문제 발생을 보고할 때" },
  { japanese: "原因を確認しています", rubySegments: [{ text: "原因", reading: "げんいん" }, { text: "を" }, { text: "確認", reading: "かくにん" }, { text: "しています" }], koreanPronunciation: "겐인오 카쿠닌시테이마스", meaning: "원인을 확인하고 있습니다", category: "업무", note: "원인 조사 중임을 말할 때" },
  { japanese: "対策を検討しています", reading: "たいさくをけんとうしています", koreanPronunciation: "타이사쿠오 켄토오시테이마스", meaning: "대책을 검토하고 있습니다", category: "업무", note: "대응 방안을 검토 중일 때" },
  { japanese: "回答をお待ちしております", reading: "かいとうをおまちしております", koreanPronunciation: "카이토오오 오마치시테오리마스", meaning: "답변 기다리겠습니다", category: "업무", note: "메일 끝맺음으로 자주 쓰는 표현" },
  { japanese: "早急に対応お願いします", reading: "さっきゅうにたいおうおねがいします", rubySegments: [{ text: "早急に" }, { text: "対応", reading: "たいおう" }, { text: "お願いします" }], koreanPronunciation: "소오큐우니 타이오오 오네가이시마스", meaning: "조속한 대응 부탁드립니다", category: "업무", note: "긴급 대응을 요청할 때" },
  { japanese: "問題があればご連絡ください", rubySegments: [{ text: "問題", reading: "もんだい" }, { text: "があればご" }, { text: "連絡", reading: "れんらく" }, { text: "ください" }], koreanPronunciation: "몬다이가 아레바 고렌라쿠쿠다사이", meaning: "문제가 있으면 연락 주세요", category: "업무", note: "상대에게 확인을 요청할 때" },
  { japanese: "ご検討よろしくお願いします", reading: "ごけんとうよろしくおねがいします", koreanPronunciation: "고켄토오 요로시쿠 오네가이시마스", meaning: "검토 부탁드립니다", category: "업무", note: "제안이나 요청 후 마무리할 때" },
  { japanese: "ご対応ありがとうございます", reading: "ごたいおうありがとうございます", rubySegments: [{ text: "ご" }, { text: "対応", reading: "たいおう" }, { text: "ありがとうございます" }], koreanPronunciation: "고타이오오 아리가토오 고자이마스", meaning: "대응 감사합니다", category: "업무", note: "처리에 감사할 때" },
  { japanese: "今後ともよろしくお願いします", reading: "こんごともよろしくおねがいします", koreanPronunciation: "콩고토모 요로시쿠 오네가이시마스", meaning: "앞으로도 잘 부탁드립니다", category: "업무", note: "업무 관계에서 마무리 인사로 사용" },


  { japanese: "十時から会議があります。", reading: "じゅうじからかいぎがあります。", rubySegments: [{ text: "十時から" }, { text: "会議", reading: "かいぎ" }, { text: "があります。" }], koreanPronunciation: "주우지카라 카이기가 아리마스", meaning: "10시부터 회의가 있습니다.", category: "업무", note: "회의 시간을 알릴 때", description: "회의 일정을 간단히 공유하는 표현" },
  { japanese: "会議室を予約しました。", reading: "かいぎしつをよやくしました。", rubySegments: [{ text: "会議室", reading: "かいぎしつ" }, { text: "を予約しました。" }], koreanPronunciation: "카이기시츠오 요야쿠시마시타", meaning: "회의실을 예약했습니다.", category: "업무", note: "회의 준비를 알릴 때", description: "회의 공간 예약 완료를 보고할 때" },
  { japanese: "本日の議題はこちらです。", reading: "ほんじつのぎだいはこちらです。", rubySegments: [{ text: "本日の" }, { text: "議題", reading: "ぎだい" }, { text: "はこちらです。" }], koreanPronunciation: "혼지츠노 기다이와 코치라데스", meaning: "오늘의 의제는 이것입니다.", category: "업무", note: "회의 시작 시", description: "회의 안건을 안내할 때" },
  { japanese: "日程を調整しましょう。", reading: "にっていをちょうせいしましょう。", rubySegments: [{ text: "日程", reading: "にってい" }, { text: "を調整しましょう。" }], koreanPronunciation: "닛테이오 초오세이시마쇼오", meaning: "일정을 조정합시다.", category: "업무", note: "일정 협의 시", description: "미팅 가능한 시간을 맞출 때" },
  { japanese: "この時間で大丈夫ですか？", reading: "このじかんでだいじょうぶですか？", koreanPronunciation: "코노 지칸데 다이죠오부데스카", meaning: "이 시간 괜찮으신가요?", category: "업무", note: "시간 확정 전", description: "상대의 가능 시간을 확인할 때" },
  { japanese: "明日までに送ります。", reading: "あしたまでにおくります。", koreanPronunciation: "아시타마데니 오쿠리마스", meaning: "내일까지 보내겠습니다.", category: "업무", note: "기한을 말할 때", description: "자료 전달 마감 일정을 약속하는 표현" },
  { japanese: "メールをご確認ください。", reading: "めーるをごかくにんください。", rubySegments: [{ text: "メールをご" }, { text: "確認", reading: "かくにん" }, { text: "ください。" }], koreanPronunciation: "메루오 고카쿠닌쿠다사이", meaning: "메일을 확인해 주세요.", category: "업무", note: "이메일 안내 시", description: "보낸 메일 확인을 요청할 때" },
  { japanese: "資料を添付しました。", reading: "しりょうをてんぷしました。", rubySegments: [{ text: "資料", reading: "しりょう" }, { text: "を" }, { text: "添付", reading: "てんぷ" }, { text: "しました。" }], koreanPronunciation: "시료오 텐푸시마시타", meaning: "자료를 첨부했습니다.", category: "업무", note: "메일 발송 후", description: "첨부 파일이 있음을 명확히 전할 때" },
  { japanese: "ご返信をお願いします。", reading: "ごへんしんをおねがいします。", rubySegments: [{ text: "ご" }, { text: "返信", reading: "へんしん" }, { text: "をお願いします。" }], koreanPronunciation: "고헨신오 오네가이시마스", meaning: "회신 부탁드립니다.", category: "업무", note: "답변 요청 시", description: "메일이나 메신저에서 답장을 요청하는 표현" },
  { japanese: "先ほどの件を共有します。", reading: "さきほどのけんをきょうゆうします。", rubySegments: [{ text: "先ほどの件を" }, { text: "共有", reading: "きょうゆう" }, { text: "します。" }], koreanPronunciation: "사키호도노 켕오 쿄오유우시마스", meaning: "아까 건을 공유하겠습니다.", category: "업무", note: "정보 전달 시", description: "최근 논의한 내용을 팀에 공유할 때" },
  { japanese: "お電話ありがとうございます。", reading: "おでんわありがとうございます。", koreanPronunciation: "오덴와 아리가토오고자이마스", meaning: "전화 주셔서 감사합니다.", category: "업무", note: "전화 응대 시", description: "비즈니스 전화 첫 인사로 쓰는 표현" },
  { japanese: "ただいま担当者に確認します。", reading: "ただいまたんとうしゃにかくにんします。", rubySegments: [{ text: "ただいま" }, { text: "担当者", reading: "たんとうしゃ" }, { text: "に" }, { text: "確認", reading: "かくにん" }, { text: "します。" }], koreanPronunciation: "타다이마 탄토오샤니 카쿠닌시마스", meaning: "지금 담당자에게 확인하겠습니다.", category: "업무", note: "즉시 확인이 필요할 때", description: "전화/문의 응대 중 내부 확인을 할 때" },
  { japanese: "少々お待ちください。", reading: "しょうしょうおまちください。", koreanPronunciation: "쇼오쇼오 오마치쿠다사이", meaning: "잠시만 기다려 주세요.", category: "업무", note: "보류 요청", description: "확인이나 처리 시간이 필요할 때" },
  { japanese: "こちらでよろしいでしょうか。", reading: "こちらでよろしいでしょうか。", koreanPronunciation: "코치라데 요로시이데쇼오카", meaning: "이렇게 하면 될까요?", category: "업무", note: "최종 확인 시", description: "상대의 승인 전 마지막으로 확인하는 표현" },
  { japanese: "内容を修正しました。", reading: "ないようをしゅうせいしました。", koreanPronunciation: "나이요오오 슈우세이시마시타", meaning: "내용을 수정했습니다.", category: "업무", note: "수정 완료 보고", description: "요청 사항 반영 후 알릴 때" },
  { japanese: "最新版をお送りします。", reading: "さいしんばんをおおくりします。", koreanPronunciation: "사이신방오 오오쿠리시마스", meaning: "최신본을 보내드리겠습니다.", category: "업무", note: "파일 전달 시", description: "업데이트된 자료를 공유할 때" },
  { japanese: "進捗を報告します。", reading: "しんちょくをほうこくします。", rubySegments: [{ text: "進捗", reading: "しんちょく" }, { text: "を" }, { text: "報告", reading: "ほうこく" }, { text: "します。" }], koreanPronunciation: "신초쿠오 호오코쿠시마스", meaning: "진행 상황을 보고하겠습니다.", category: "업무", note: "상태 보고", description: "업무 진행도를 정기적으로 전달할 때" },
  { japanese: "この件は完了しました。", reading: "このけんはかんりょうしました。", rubySegments: [{ text: "この件は" }, { text: "完了", reading: "かんりょう" }, { text: "しました。" }], koreanPronunciation: "코노 켕와 칸료오시마시타", meaning: "이 건은 완료되었습니다.", category: "업무", note: "완료 안내", description: "업무 처리 완료를 명확히 알릴 때" },
  { japanese: "確認後にご連絡します。", reading: "かくにんごにごれんらくします。", rubySegments: [{ text: "確認", reading: "かくにん" }, { text: "後にご" }, { text: "連絡", reading: "れんらく" }, { text: "します。" }], koreanPronunciation: "카쿠닌고니 고렌라쿠시마스", meaning: "확인 후 연락드리겠습니다.", category: "업무", note: "후속 안내", description: "내부 확인이 끝난 뒤 회신하겠다고 할 때" },
  { japanese: "恐れ入りますが、再送してください。", reading: "おそれいりますが、さいそうしてください。", koreanPronunciation: "오소레이리마스가 사이소오시테쿠다사이", meaning: "죄송하지만 다시 보내 주세요.", category: "업무", note: "재전송 요청", description: "메일/파일을 못 받았을 때 정중히 요청" },
  { japanese: "本日中に回答します。", reading: "ほんじつちゅうにかいとうします。", koreanPronunciation: "혼지츠추우니 카이토오시마스", meaning: "오늘 중으로 답변드리겠습니다.", category: "업무", note: "응답 기한 안내", description: "답변 시점을 명확하게 약속할 때" },
  { japanese: "ご依頼ありがとうございます。", reading: "ごいらいありがとうございます。", rubySegments: [{ text: "ご" }, { text: "依頼", reading: "いらい" }, { text: "ありがとうございます。" }], koreanPronunciation: "고이라이 아리가토오고자이마스", meaning: "의뢰해 주셔서 감사합니다.", category: "업무", note: "접수 인사", description: "요청을 받았을 때 예의 있게 시작하는 표현" },
  { japanese: "対応の優先度を上げます。", reading: "たいおうのゆうせんどをあげます。", rubySegments: [{ text: "対応", reading: "たいおう" }, { text: "の" }, { text: "優先", reading: "ゆうせん" }, { text: "度を上げます。" }], koreanPronunciation: "타이오오노 유우센도오 아게마스", meaning: "대응 우선순위를 높이겠습니다.", category: "업무", note: "긴급 대응", description: "중요도가 높은 이슈로 전환할 때" },
  { japanese: "まず結論から申し上げます。", reading: "まずけつろんからもうしあげます。", koreanPronunciation: "마즈 케츠론카라 모오시아게마스", meaning: "먼저 결론부터 말씀드리겠습니다.", category: "업무", note: "보고 시작 시", description: "핵심부터 전달하려는 발표 표현" },
  { japanese: "私はこの案に賛成です。", reading: "わたしはこのあんにさんせいです。", koreanPronunciation: "와타시와 코노 안니 산세이데스", meaning: "저는 이 안에 찬성합니다.", category: "업무", note: "의견 표현", description: "회의에서 찬성 의견을 간단히 말할 때" },
  { japanese: "私は別の案を提案します。", reading: "わたしはべつのあんをていあんします。", koreanPronunciation: "와타시와 베츠노 안오 테이안시마스", meaning: "저는 다른 안을 제안합니다.", category: "업무", note: "대안 제시", description: "다른 선택지를 제시할 때" },
  { japanese: "この点を再確認してください。", reading: "このてんをさいかくにんしてください。", rubySegments: [{ text: "この点を再" }, { text: "確認", reading: "かくにん" }, { text: "してください。" }], koreanPronunciation: "코노 텐오 사이카쿠닌시테쿠다사이", meaning: "이 점을 다시 확인해 주세요.", category: "업무", note: "재확인 요청", description: "실수 방지를 위해 특정 항목을 다시 점검할 때" },
  { japanese: "会議のリンクを送ります。", reading: "かいぎのりんくをおくります。", rubySegments: [{ text: "会議", reading: "かいぎ" }, { text: "のリンクを送ります。" }], koreanPronunciation: "카이기노 링쿠오 오쿠리마스", meaning: "회의 링크를 보내겠습니다.", category: "업무", note: "온라인 회의 준비", description: "화상회의 접속 정보를 공유할 때" },
  { japanese: "開始時間を五分遅らせます。", reading: "かいしじかんをごふんおくらせます。", koreanPronunciation: "카이시지칸오 고훈 오쿠라세마스", meaning: "시작 시간을 5분 늦추겠습니다.", category: "업무", note: "시간 변경", description: "회의 시작 지연을 공지할 때" },
  { japanese: "本日はここまでにします。", reading: "ほんじつはここまでにします。", koreanPronunciation: "혼지츠와 코코마데니 시마스", meaning: "오늘은 여기까지 하겠습니다.", category: "업무", note: "회의 마무리", description: "회의나 브리핑을 종료할 때" },

  // ===== 친구 =====
  { level: "beginner", japanese: "今何してる？", rubySegments: [{ text: "今", reading: "いま" }, { text: "何", reading: "なに" }, { text: "してる？" }], koreanPronunciation: "이마 난시테루?", meaning: "지금 뭐 해?", category: "친구", note: "친구에게 가볍게 물을 때" },
  { level: "beginner", japanese: "今日暇？", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "暇", reading: "ひま" }, { text: "？" }], koreanPronunciation: "쿄오 히마?", meaning: "오늘 시간 있어?", category: "친구", note: "약속 가능 여부를 물을 때" },
  { level: "beginner", japanese: "一緒に行こう", rubySegments: [{ text: "一緒", reading: "いっしょ" }, { text: "に" }, { text: "行", reading: "い" }, { text: "こう" }], koreanPronunciation: "잇쇼니 이코오", meaning: "같이 가자", category: "친구", note: "함께 가자고 할 때" },
  { level: "basic", japanese: "どこ行く？", reading: "どこいく？", rubySegments: [{ text: "どこ" }, { text: "行", reading: "い" }, { text: "く？" }], koreanPronunciation: "도코 이쿠?", meaning: "어디 갈래?", category: "친구", note: "갈 장소를 물을 때" },
  { level: "basic", japanese: "ご飯食べた？", reading: "ごはんたべた？", rubySegments: [{ text: "ご" }, { text: "飯", reading: "はん" }, { text: "食", reading: "た" }, { text: "べた？" }], koreanPronunciation: "고한 타베타?", meaning: "밥 먹었어?", category: "친구", note: "일상적으로 안부를 물을 때" },
  { level: "basic", japanese: "あとで会おう", reading: "あとであおう", rubySegments: [{ text: "あとで" }, { text: "会", reading: "あ" }, { text: "おう" }], koreanPronunciation: "아토데 아오오", meaning: "나중에 만나자", category: "친구", note: "나중에 만날 약속을 할 때" },
  { level: "practical", japanese: "久しぶり！", rubySegments: [{ text: "久", reading: "ひさ" }, { text: "しぶり！" }], koreanPronunciation: "히사시부리!", meaning: "오랜만!", category: "친구", note: "오랜만에 만났을 때" },
  { level: "practical", japanese: "元気？", rubySegments: [{ text: "元気", reading: "げんき" }, { text: "？" }], koreanPronunciation: "겐키?", meaning: "잘 지냈어?", category: "친구", note: "친구에게 안부를 물을 때" },
  { level: "practical", japanese: "それいいね", koreanPronunciation: "소레 이이네", meaning: "그거 좋다", category: "친구", note: "상대 의견에 긍정할 때" },
  { japanese: "マジで？", koreanPronunciation: "마지데?", meaning: "진짜?", category: "친구", note: "놀라거나 반응할 때" },
  { japanese: "ちょっと待って", reading: "ちょっとまって", rubySegments: [{ text: "ちょっと" }, { text: "待", reading: "ま" }, { text: "って" }], koreanPronunciation: "촛토 맛테", meaning: "잠깐만", category: "친구", note: "잠시 기다려 달라고 할 때" },
  { japanese: "後で連絡する", rubySegments: [{ text: "後", reading: "あと" }, { text: "で" }, { text: "連絡", reading: "れんらく" }, { text: "する" }], koreanPronunciation: "아토데 렌라쿠스루", meaning: "나중에 연락할게", category: "친구", note: "추후 연락을 말할 때" },
  { japanese: "眠い", rubySegments: [{ text: "眠", reading: "ねむ" }, { text: "い" }], koreanPronunciation: "네무이", meaning: "졸려", category: "친구", note: "상태를 가볍게 말할 때" },
  { japanese: "疲れた", rubySegments: [{ text: "疲", reading: "つか" }, { text: "れた" }], koreanPronunciation: "츠카레타", meaning: "피곤해", category: "친구", note: "피곤함을 말할 때" },
  { japanese: "楽しかった", rubySegments: [{ text: "楽", reading: "たの" }, { text: "しかった" }], koreanPronunciation: "타노시캇타", meaning: "재밌었다", category: "친구", note: "좋았던 경험을 말할 때" },
  { japanese: "また行こう", reading: "またいこう", rubySegments: [{ text: "また" }, { text: "行", reading: "い" }, { text: "こう" }], koreanPronunciation: "마타 이코오", meaning: "또 가자", category: "친구", note: "다음 약속을 자연스럽게 말할 때" },
  { japanese: "写真送って", rubySegments: [{ text: "写真", reading: "しゃしん" }, { text: "送", reading: "おく" }, { text: "って" }], koreanPronunciation: "샤신 옷테", meaning: "사진 보내줘", category: "친구", note: "사진을 요청할 때" },
  { japanese: "何食べたい？", rubySegments: [{ text: "何", reading: "なに" }, { text: "食", reading: "た" }, { text: "べたい？" }], koreanPronunciation: "나니 타베타이?", meaning: "뭐 먹고 싶어?", category: "친구", note: "메뉴를 정할 때" },
  { japanese: "どっちがいい？", koreanPronunciation: "돗치가 이이?", meaning: "어느 쪽이 좋아?", category: "친구", note: "선택을 물을 때" },
  { japanese: "大丈夫？", rubySegments: [{ text: "大丈夫", reading: "だいじょうぶ" }, { text: "？" }], koreanPronunciation: "다이조오부?", meaning: "괜찮아?", category: "친구", note: "상대 상태를 걱정할 때" },
  { japanese: "無理しないで", rubySegments: [{ text: "無理", reading: "むり" }, { text: "しないで" }], koreanPronunciation: "무리시나이데", meaning: "무리하지 마", category: "친구", note: "상대를 배려할 때" },
  { japanese: "すごいね", koreanPronunciation: "스고이네", meaning: "대단하네", category: "친구", note: "칭찬할 때" },
  { japanese: "分かった", rubySegments: [{ text: "分", reading: "わ" }, { text: "かった" }], koreanPronunciation: "와캇타", meaning: "알겠어", category: "친구", note: "이해했음을 말할 때" },
  { japanese: "知らなかった", rubySegments: [{ text: "知", reading: "し" }, { text: "らなかった" }], koreanPronunciation: "시라나캇타", meaning: "몰랐어", category: "친구", note: "새로운 정보를 들었을 때" },
  { japanese: "いいと思う", reading: "いいとおもう", rubySegments: [{ text: "いいと" }, { text: "思", reading: "おも" }, { text: "う" }], koreanPronunciation: "이이토 오모우", meaning: "좋다고 생각해", category: "친구", note: "의견을 말할 때" },
  { japanese: "ちょっと難しい", reading: "ちょっとむずかしい", rubySegments: [{ text: "ちょっと" }, { text: "難", reading: "むずか" }, { text: "しい" }], koreanPronunciation: "촛토 무즈카시이", meaning: "조금 어려워", category: "친구", note: "난이도나 상황을 말할 때" },
  { japanese: "助かった", rubySegments: [{ text: "助", reading: "たす" }, { text: "かった" }], koreanPronunciation: "타스캇타", meaning: "도움 됐어", category: "친구", note: "고마움을 자연스럽게 표현할 때" },
  { japanese: "ありがとう", koreanPronunciation: "아리가토오", meaning: "고마워", category: "친구", note: "친구에게 감사할 때" },
  { japanese: "ごめんね", koreanPronunciation: "고멘네", meaning: "미안해", category: "친구", note: "가볍게 사과할 때" },
  { japanese: "またね", koreanPronunciation: "마타네", meaning: "또 봐", category: "친구", note: "헤어질 때 인사" },

  { japanese: "おはよう、今日も頑張ろう。", reading: "おはよう、きょうもがんばろう。", rubySegments: [{ text: "おはよう、" }, { text: "今日", reading: "きょう" }, { text: "も" }, { text: "頑張", reading: "がんば" }, { text: "ろう。" }], koreanPronunciation: "오하요오, 쿄오모 간바로오", meaning: "좋은 아침, 오늘도 힘내자.", category: "친구", note: "아침 인사", description: "친구에게 가볍게 응원하며 인사할 때" },
  { japanese: "今夜ひま？", rubySegments: [{ text: "今夜", reading: "こんや" }, { text: "ひま？" }], reading: "こんやひま？", koreanPronunciation: "콘야 히마?", meaning: "오늘 밤 시간 있어?", category: "친구", note: "약속 잡기", description: "저녁 약속 가능 여부를 물을 때" },
  { japanese: "土曜日に会える？", rubySegments: [{ text: "土曜日", reading: "どようび" }, { text: "に" }, { text: "会", reading: "あ" }, { text: "える？" }], reading: "どようびにあえる？", koreanPronunciation: "도요오비니 아에루?", meaning: "토요일에 만날 수 있어?", category: "친구", note: "만남 제안", description: "주말 약속을 제안할 때" },
  { japanese: "駅前で待ち合わせしよう。", rubySegments: [{ text: "駅前", reading: "えきまえ" }, { text: "で" }, { text: "待", reading: "ま" }, { text: "ち合わせ", reading: "あわせ" }, { text: "しよう。" }], reading: "えきまえでまちあわせしよう。", koreanPronunciation: "에키마에데 마치아와세시요오", meaning: "역 앞에서 만나자.", category: "친구", note: "장소 정하기", description: "만날 위치를 정할 때" },
  { japanese: "少し遅れそう。", rubySegments: [{ text: "少", reading: "すこ" }, { text: "し" }, { text: "遅", reading: "おく" }, { text: "れそう。" }], reading: "すこしおくれそう。", koreanPronunciation: "스코시 오쿠레소오", meaning: "조금 늦을 것 같아.", category: "친구", note: "지각 연락", description: "약속 시간에 늦을 때 알리는 표현" },
  { japanese: "もう着いたよ。", reading: "もうついたよ。", rubySegments: [{ text: "もう" }, { text: "着", reading: "つ" }, { text: "いたよ。" }], koreanPronunciation: "모오 츠이타요", meaning: "나 이미 도착했어.", category: "친구", note: "도착 알림", description: "약속 장소에 먼저 도착했을 때" },
  { japanese: "どこにいるの？", reading: "どこにいるの？", koreanPronunciation: "도코니 이루노?", meaning: "어디야?", category: "친구", note: "위치 확인", description: "친구 위치를 빠르게 확인할 때" },
  { japanese: "今日は本当に楽しいね。", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "は" }, { text: "本当", reading: "ほんとう" }, { text: "に" }, { text: "楽", reading: "たの" }, { text: "しいね。" }], reading: "きょうはほんとうにたのしいね。", koreanPronunciation: "쿄오와 혼토오니 타노시이네", meaning: "오늘 정말 즐겁다.", category: "친구", note: "기분 표현", description: "함께 있는 시간을 칭찬할 때" },
  { japanese: "その服、すごく似合うよ。", reading: "そのふく、すごくにあうよ。", rubySegments: [{ text: "その" }, { text: "服", reading: "ふく" }, { text: "、すごく" }, { text: "似合", reading: "にあ" }, { text: "うよ。" }], koreanPronunciation: "소노 후쿠, 스고쿠 니아우요", meaning: "그 옷 정말 잘 어울려.", category: "친구", note: "칭찬", description: "외모나 스타일을 자연스럽게 칭찬할 때" },
  { japanese: "その話、面白い！", reading: "そのはなし、おもしろい！", rubySegments: [{ text: "その" }, { text: "話", reading: "はなし" }, { text: "、" }, { text: "面白", reading: "おもしろ" }, { text: "い！" }], koreanPronunciation: "소노 하나시, 오모시로이", meaning: "그 이야기 재미있다!", category: "친구", note: "반응", description: "친구 이야기에 긍정적으로 반응할 때" },
  { japanese: "私はラーメン気分。", rubySegments: [{ text: "私", reading: "わたし" }, { text: "はラーメン" }, { text: "気分", reading: "きぶん" }, { text: "。" }], reading: "わたしはらーめんきぶん。", koreanPronunciation: "와타시와 라아멘 키분", meaning: "나는 라멘 먹고 싶은 기분이야.", category: "친구", note: "취향 말하기", description: "먹고 싶은 음식을 가볍게 말할 때" },
  { japanese: "この店、安くておいしいよ。", reading: "このみせ、やすくておいしいよ。", rubySegments: [{ text: "この" }, { text: "店", reading: "みせ" }, { text: "、" }, { text: "安", reading: "やす" }, { text: "くておいしいよ。" }], koreanPronunciation: "코노 미세, 야스쿠테 오이시이요", meaning: "이 가게 싸고 맛있어.", category: "친구", note: "맛집 추천", description: "친구에게 가게를 추천할 때" },
  { japanese: "週末は何する？", rubySegments: [{ text: "週末", reading: "しゅうまつ" }, { text: "は" }, { text: "何", reading: "なに" }, { text: "する？" }], reading: "しゅうまつはなにする？", koreanPronunciation: "슈우마츠와 나니스루?", meaning: "주말에 뭐 할 거야?", category: "친구", note: "주말 대화", description: "가벼운 안부 겸 계획을 물을 때" },
  { japanese: "今週はちょっと忙しい。", rubySegments: [{ text: "今週", reading: "こんしゅう" }, { text: "はちょっと" }, { text: "忙", reading: "いそが" }, { text: "しい。" }], reading: "こんしゅうはちょっといそがしい。", koreanPronunciation: "콘슈우와 촛토 이소가시이", meaning: "이번 주는 좀 바빠.", category: "친구", note: "근황 공유", description: "일정이 많음을 전달할 때" },
  { japanese: "来週なら大丈夫だよ。", rubySegments: [{ text: "来週", reading: "らいしゅう" }, { text: "なら" }, { text: "大丈夫", reading: "だいじょうぶ" }, { text: "だよ。" }], reading: "らいしゅうならだいじょうぶだよ。", koreanPronunciation: "라이슈우나라 다이죠오부다요", meaning: "다음 주면 괜찮아.", category: "친구", note: "대안 제시", description: "이번 주가 어려울 때 다른 날짜를 제안" },
  { japanese: "その映画、もう見た？", reading: "そのえいが、もうみた？", rubySegments: [{ text: "その" }, { text: "映画", reading: "えいが" }, { text: "、もう" }, { text: "見", reading: "み" }, { text: "た？" }], koreanPronunciation: "소노 에이가, 모오 미타?", meaning: "그 영화 벌써 봤어?", category: "친구", note: "취미 대화", description: "영화 이야기를 시작할 때" },
  { japanese: "最近どんな音楽を聞く？", rubySegments: [{ text: "最近", reading: "さいきん" }, { text: "どんな" }, { text: "音楽", reading: "おんがく" }, { text: "を" }, { text: "聞", reading: "き" }, { text: "く？" }], reading: "さいきんどんなおんがくをきく？", koreanPronunciation: "사이킨 돈나 온가쿠오 키쿠?", meaning: "요즘 어떤 음악 들어?", category: "친구", note: "취미 질문", description: "음악 취향을 물을 때" },
  { japanese: "私もその歌が好き。", rubySegments: [{ text: "私", reading: "わたし" }, { text: "もその" }, { text: "歌", reading: "うた" }, { text: "が" }, { text: "好", reading: "す" }, { text: "き。" }], reading: "わたしもそのうたがすき。", koreanPronunciation: "와타시모 소노 우타가 스키", meaning: "나도 그 노래 좋아해.", category: "친구", note: "공감", description: "공통 관심사를 확인할 때" },
  { japanese: "写真を送ってくれてありがとう。", rubySegments: [{ text: "写真", reading: "しゃしん" }, { text: "を" }, { text: "送", reading: "おく" }, { text: "ってくれてありがとう。" }], reading: "しゃしんをおくってくれてありがとう。", koreanPronunciation: "샤신오 오쿳테쿠레테 아리가토오", meaning: "사진 보내줘서 고마워.", category: "친구", note: "메시지 응답", description: "사진을 받은 뒤 감사할 때" },
  { japanese: "後でメッセージするね。", rubySegments: [{ text: "後", reading: "あと" }, { text: "でメッセージするね。" }], reading: "あとでめっせーじするね。", koreanPronunciation: "아토데 멧세에지 스루네", meaning: "나중에 메시지할게.", category: "친구", note: "연락 예고", description: "지금은 어렵고 나중에 연락할 때" },
  { japanese: "返信が遅れてごめん。", rubySegments: [{ text: "返信", reading: "へんしん" }, { text: "が" }, { text: "遅", reading: "おく" }, { text: "れてごめん。" }], reading: "へんしんがおくれてごめん。", koreanPronunciation: "헨신가 오쿠레테 고멘", meaning: "답장이 늦어서 미안.", category: "친구", note: "사과", description: "늦은 답장에 대한 가벼운 사과" },
  { japanese: "気にしないで。", rubySegments: [{ text: "気", reading: "き" }, { text: "にしないで。" }], reading: "きにしないで。", koreanPronunciation: "키니 시나이데", meaning: "신경 쓰지 마.", category: "친구", note: "위로", description: "친구를 편하게 해 줄 때" },
  { japanese: "相談したいことがある。", rubySegments: [{ text: "相談", reading: "そうだん" }, { text: "したいことがある。" }], reading: "そうだんしたいことがある。", koreanPronunciation: "소오단시타이 코토가 아루", meaning: "상담하고 싶은 게 있어.", category: "친구", note: "고민 이야기", description: "진지한 대화를 시작할 때" },
  { japanese: "いつでも聞くよ。", reading: "いつでもきくよ。", rubySegments: [{ text: "いつでも" }, { text: "聞", reading: "き" }, { text: "くよ。" }], koreanPronunciation: "이츠데모 키쿠요", meaning: "언제든 들어줄게.", category: "친구", note: "지지", description: "친구를 응원하고 위로할 때" },
  { japanese: "今日はありがとう、助かった。", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "はありがとう、" }, { text: "助", reading: "たす" }, { text: "かった。" }], reading: "きょうはありがとう、たすかった。", koreanPronunciation: "쿄오와 아리가토오, 타스캇타", meaning: "오늘 고마워, 도움 됐어.", category: "친구", note: "감사", description: "도움을 받은 뒤 자연스럽게 고마움을 표현" },
  { japanese: "また近いうちに会おう。", reading: "またちかいうちにあおう。", rubySegments: [{ text: "また" }, { text: "近", reading: "ちか" }, { text: "いうちに" }, { text: "会", reading: "あ" }, { text: "おう。" }], koreanPronunciation: "마타 치카이우치니 아오오", meaning: "또 조만간 만나자.", category: "친구", note: "마무리", description: "다음 만남을 약속하며 대화 마무리" },
  { japanese: "帰ったら連絡してね。", rubySegments: [{ text: "帰", reading: "かえ" }, { text: "ったら" }, { text: "連絡", reading: "れんらく" }, { text: "してね。" }], reading: "かえったられんらくしてね。", koreanPronunciation: "카엣타라 렌라쿠시테네", meaning: "집에 가면 연락해 줘.", category: "친구", note: "안전 확인", description: "헤어질 때 안부 확인용으로 쓰는 표현" },
  { japanese: "おやすみ、また明日。", reading: "おやすみ、またあした。", rubySegments: [{ text: "おやすみ、また" }, { text: "明日", reading: "あした" }, { text: "。" }], koreanPronunciation: "오야스미, 마타 아시타", meaning: "잘 자, 내일 또 봐.", category: "친구", note: "밤 인사", description: "메시지 대화 끝에 쓰는 인사" },
  { japanese: "次はどこに行く？", rubySegments: [{ text: "次", reading: "つぎ" }, { text: "はどこに" }, { text: "行", reading: "い" }, { text: "く？" }], reading: "つぎはどこにいく？", koreanPronunciation: "츠기와 도코니 이쿠?", meaning: "다음엔 어디 갈까?", category: "친구", note: "약속 이어가기", description: "다음 활동을 자연스럽게 제안할 때" },
  { japanese: "また写真を撮ろう。", reading: "またしゃしんをとろう。", rubySegments: [{ text: "また" }, { text: "写真", reading: "しゃしん" }, { text: "を" }, { text: "撮", reading: "と" }, { text: "ろう。" }], koreanPronunciation: "마타 샤신오 토로오", meaning: "또 사진 찍자.", category: "친구", note: "가벼운 제안", description: "추억을 남기자고 말할 때" },
  { level: "beginner", japanese: "毎朝七時に起きます。", reading: "まいあさしちじにおきます。", rubySegments: [{ text: "毎朝", reading: "まいあさ" }, { text: "七時", reading: "しちじ" }, { text: "に" }, { text: "起", reading: "お" }, { text: "きます。" }], koreanPronunciation: "마이아사 시치지니 오키마스", meaning: "매일 아침 7시에 일어납니다.", category: "일상", note: "아침 루틴", description: "기상 시간을 말하는 기본 표현" },
  { level: "beginner", japanese: "起きたら水を飲みます。", reading: "おきたらみずをのみます。", rubySegments: [{ text: "起", reading: "お" }, { text: "きたら" }, { text: "水", reading: "みず" }, { text: "を" }, { text: "飲", reading: "の" }, { text: "みます。" }], koreanPronunciation: "오키타라 미즈오 노미마스", meaning: "일어나면 물을 마십니다.", category: "일상", note: "건강 습관", description: "아침 습관을 설명할 때" },
  { level: "beginner", japanese: "朝ごはんを作ります。", reading: "あさごはんをつくります。", rubySegments: [{ text: "朝", reading: "あさ" }, { text: "ごはんを" }, { text: "作", reading: "つく" }, { text: "ります。" }], koreanPronunciation: "아사고항오 츠쿠리마스", meaning: "아침밥을 만듭니다.", category: "일상", note: "요리", description: "아침 준비를 말할 때" },
  { level: "basic", japanese: "家を出る前に歯を磨きます。", reading: "いえをでるまえにはをみがきます。", rubySegments: [{ text: "家", reading: "いえ" }, { text: "を" }, { text: "出", reading: "で" }, { text: "る" }, { text: "前", reading: "まえ" }, { text: "に" }, { text: "歯", reading: "は" }, { text: "を" }, { text: "磨", reading: "みが" }, { text: "きます。" }], koreanPronunciation: "이에오 데루마에니 하오 미가키마스", meaning: "집을 나가기 전에 이를 닦습니다.", category: "일상", note: "개인 위생", description: "출근/외출 전 루틴 설명" },
  { level: "basic", japanese: "今日は少し寒いですね。", reading: "きょうはすこしさむいですね。", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "は" }, { text: "少", reading: "すこ" }, { text: "し" }, { text: "寒", reading: "さむ" }, { text: "いですね。" }], koreanPronunciation: "쿄오와 스코시 사무이데스네", meaning: "오늘은 조금 춥네요.", category: "일상", note: "날씨 대화", description: "날씨를 가볍게 말할 때" },
  { level: "basic", japanese: "午後から雨が降ります。", reading: "ごごからあめがふります。", rubySegments: [{ text: "午後", reading: "ごご" }, { text: "から" }, { text: "雨", reading: "あめ" }, { text: "が" }, { text: "降", reading: "ふ" }, { text: "ります。" }], koreanPronunciation: "고고카라 아메가 후리마스", meaning: "오후부터 비가 옵니다.", category: "일상", note: "날씨 안내", description: "비 예보를 전달할 때" },
  { level: "practical", japanese: "傘を持って行ってください。", rubySegments: [{ text: "傘", reading: "かさ" }, { text: "を" }, { text: "持", reading: "も" }, { text: "って" }, { text: "行", reading: "い" }, { text: "ってください。" }], reading: "かさをもっていってください。", koreanPronunciation: "카사오 못테잇테쿠다사이", meaning: "우산을 가져가세요.", category: "일상", note: "간단한 부탁", description: "비 오는 날 준비를 부탁할 때" },
  { level: "practical", japanese: "スーパーで牛乳を買います。", reading: "すーぱーでぎゅうにゅうをかいます。", rubySegments: [{ text: "スーパーで" }, { text: "牛乳", reading: "ぎゅうにゅう" }, { text: "を" }, { text: "買", reading: "か" }, { text: "います。" }], koreanPronunciation: "스우파아데 규우뉴우오 카이마스", meaning: "마트에서 우유를 삽니다.", category: "일상", note: "쇼핑", description: "장보기 계획을 말할 때" },
  { level: "practical", japanese: "この野菜は新鮮です。", reading: "このやさいはしんせんです。", rubySegments: [{ text: "この" }, { text: "野菜", reading: "やさい" }, { text: "は" }, { text: "新鮮", reading: "しんせん" }, { text: "です。" }], koreanPronunciation: "코노 야사이와 신센데스", meaning: "이 채소는 신선합니다.", category: "일상", note: "물건 상태", description: "식재료 상태를 설명할 때" },
  { japanese: "もう少し安いものはありますか？", reading: "もうすこしやすいものはありますか？", rubySegments: [{ text: "もう" }, { text: "少", reading: "すこ" }, { text: "し" }, { text: "安", reading: "やす" }, { text: "いものはありますか？" }], koreanPronunciation: "모오 스코시 야스이 모노와 아리마스카", meaning: "조금 더 저렴한 것이 있나요?", category: "일상", note: "가격 문의", description: "쇼핑 중 가격대를 물을 때" },
  { japanese: "袋は要りません。", rubySegments: [{ text: "袋", reading: "ふくろ" }, { text: "は" }, { text: "要", reading: "い" }, { text: "りません。" }], reading: "ふくろはいりません。", koreanPronunciation: "후쿠로와 이리마센", meaning: "봉투는 필요 없습니다.", category: "일상", note: "결제 시", description: "계산대에서 봉투 거절할 때" },
  { japanese: "レシートをください。", reading: "れしーとをください。", koreanPronunciation: "레시이토오 쿠다사이", meaning: "영수증 주세요.", category: "일상", note: "계산", description: "구매 후 영수증을 요청하는 표현" },
  { japanese: "頭が痛いです。", rubySegments: [{ text: "頭", reading: "あたま" }, { text: "が" }, { text: "痛", reading: "いた" }, { text: "いです。" }], reading: "あたまがいたいです。", koreanPronunciation: "아타마가 이타이데스", meaning: "머리가 아픕니다.", category: "일상", note: "증상 설명", description: "병원이나 약국에서 증상을 말할 때" },
  { japanese: "熱を測ってください。", rubySegments: [{ text: "熱", reading: "ねつ" }, { text: "を" }, { text: "測", reading: "はか" }, { text: "ってください。" }], reading: "ねつをはかってください。", koreanPronunciation: "네츠오 하캇테쿠다사이", meaning: "체온을 재 주세요.", category: "일상", note: "병원", description: "진료 전 기본 확인을 요청할 때" },
  { japanese: "この薬は一日二回です。", reading: "このくすりはいちにちにかいです。", rubySegments: [{ text: "この" }, { text: "薬", reading: "くすり" }, { text: "は" }, { text: "一日", reading: "いちにち" }, { text: "二回", reading: "にかい" }, { text: "です。" }], koreanPronunciation: "코노 쿠스리와 이치니치 니카이데스", meaning: "이 약은 하루 두 번입니다.", category: "일상", note: "복용 안내", description: "약 복용 횟수를 설명할 때" },
  { japanese: "食後に飲んでください。", rubySegments: [{ text: "食後", reading: "しょくご" }, { text: "に" }, { text: "飲", reading: "の" }, { text: "んでください。" }], reading: "しょくごにのんでください。", koreanPronunciation: "쇼쿠고니 논데쿠다사이", meaning: "식후에 드세요.", category: "일상", note: "복약 지시", description: "약 복용 타이밍을 전달할 때" },
  { japanese: "今日はジムに行きます。", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "はジムに" }, { text: "行", reading: "い" }, { text: "きます。" }], reading: "きょうはじむにいきます。", koreanPronunciation: "쿄오와 지무니 이키마스", meaning: "오늘은 헬스장에 갑니다.", category: "일상", note: "운동 계획", description: "운동 일정을 말할 때" },
  { japanese: "三十分走りました。", rubySegments: [{ text: "三十分", reading: "さんじゅっぷん" }, { text: "走", reading: "はし" }, { text: "りました。" }], reading: "さんじゅっぷんはしりました。", koreanPronunciation: "산줏푼 하시리마시타", meaning: "30분 달렸습니다.", category: "일상", note: "운동 기록", description: "운동한 시간을 공유할 때" },
  { japanese: "少し休んでから続けます。", rubySegments: [{ text: "少", reading: "すこ" }, { text: "し" }, { text: "休", reading: "やす" }, { text: "んでから" }, { text: "続", reading: "つづ" }, { text: "けます。" }], reading: "すこしやすんでからつづけます。", koreanPronunciation: "스코시 야슨데카라 츠즈케마스", meaning: "조금 쉬고 나서 계속하겠습니다.", category: "일상", note: "운동 중", description: "휴식 후 다시 진행할 때" },
  { japanese: "今、何時ですか？", reading: "いま、なんじですか？", rubySegments: [{ text: "今", reading: "いま" }, { text: "、" }, { text: "何時", reading: "なんじ" }, { text: "ですか？" }], koreanPronunciation: "이마 난지데스카", meaning: "지금 몇 시인가요?", category: "일상", note: "시간 질문", description: "시간을 물을 때 쓰는 기본 표현" },
  { japanese: "五分だけ待ってください。", rubySegments: [{ text: "五分", reading: "ごふん" }, { text: "だけ" }, { text: "待", reading: "ま" }, { text: "ってください。" }], reading: "ごふんだけまってください。", koreanPronunciation: "고훈다케 맛테쿠다사이", meaning: "5분만 기다려 주세요.", category: "일상", note: "간단한 부탁", description: "잠깐만 기다려 달라고 할 때" },
  { japanese: "先に始めてください。", rubySegments: [{ text: "先", reading: "さき" }, { text: "に" }, { text: "始", reading: "はじ" }, { text: "めてください。" }], reading: "さきにはじめてください。", koreanPronunciation: "사키니 하지메테쿠다사이", meaning: "먼저 시작해 주세요.", category: "일상", note: "협업 상황", description: "상대에게 먼저 진행을 부탁할 때" },
  { japanese: "手伝ってくれて助かります。", rubySegments: [{ text: "手伝", reading: "てつだ" }, { text: "ってくれて" }, { text: "助", reading: "たす" }, { text: "かります。" }], reading: "てつだってくれてたすかります。", koreanPronunciation: "테츠닷테쿠레테 타스카리마스", meaning: "도와줘서 큰 도움이 됩니다.", category: "일상", note: "감사", description: "일상 속 도움에 감사할 때" },
  { japanese: "帰ったらすぐ洗濯します。", rubySegments: [{ text: "帰", reading: "かえ" }, { text: "ったらすぐ" }, { text: "洗濯", reading: "せんたく" }, { text: "します。" }], reading: "かえったらすぐせんたくします。", koreanPronunciation: "카엣타라 스구 센타쿠시마스", meaning: "집에 가면 바로 세탁합니다.", category: "일상", note: "집안일", description: "귀가 후 할 일을 말할 때" },
  { japanese: "部屋を片付けないと。", rubySegments: [{ text: "部屋", reading: "へや" }, { text: "を" }, { text: "片付", reading: "かたづ" }, { text: "けないと。" }], reading: "へやをかたづけないと。", koreanPronunciation: "헤야오 카타즈케나이토", meaning: "방을 정리해야 해.", category: "일상", note: "자기 다짐", description: "해야 할 집안일을 말할 때" },
  { japanese: "夜は早く寝るようにします。", rubySegments: [{ text: "夜", reading: "よる" }, { text: "は" }, { text: "早", reading: "はや" }, { text: "く" }, { text: "寝", reading: "ね" }, { text: "るようにします。" }], reading: "よるははやくねるようにします。", koreanPronunciation: "요루와 하야쿠 네루요오니 시마스", meaning: "밤에는 일찍 자도록 하겠습니다.", category: "일상", note: "생활 습관", description: "건강한 습관을 다짐할 때" },
  { japanese: "今日は家でゆっくりします。", reading: "きょうはいえでゆっくりします。", rubySegments: [{ text: "今日", reading: "きょう" }, { text: "は" }, { text: "家", reading: "いえ" }, { text: "でゆっくりします。" }], koreanPronunciation: "쿄오와 이에데 윳쿠리시마스", meaning: "오늘은 집에서 푹 쉴게요.", category: "일상", note: "휴식", description: "바깥 일정 없이 쉬는 날 표현" },
  { japanese: "窓を開けてもいいですか？", rubySegments: [{ text: "窓", reading: "まど" }, { text: "を" }, { text: "開", reading: "あ" }, { text: "けてもいいですか？" }], reading: "まどをあけてもいいですか？", koreanPronunciation: "마도오 아케테모 이이데스카", meaning: "창문 열어도 될까요?", category: "일상", note: "허락 요청", description: "실내 환기를 위해 허락을 구할 때" },
  { japanese: "電気を消してください。", rubySegments: [{ text: "電気", reading: "でんき" }, { text: "を" }, { text: "消", reading: "け" }, { text: "してください。" }], reading: "でんきをけしてください。", koreanPronunciation: "덴키오 케시테쿠다사이", meaning: "불을 꺼 주세요.", category: "일상", note: "간단한 부탁", description: "집에서 자주 쓰는 부탁 표현" },
  { japanese: "おやすみなさい、また明日。", reading: "おやすみなさい、またあした。", rubySegments: [{ text: "おやすみなさい、また" }, { text: "明日", reading: "あした" }, { text: "。" }], koreanPronunciation: "오야스미나사이, 마타 아시타", meaning: "안녕히 주무세요, 내일 또 봐요.", category: "일상", note: "저녁 인사", description: "하루를 마무리할 때 쓰는 인사" },
] as SentenceItem[]);

export const SENTENCES: SentenceItem[] = [...BASE_SENTENCES, ...EXPANDED_SENTENCES, ...RECOMMENDED_SENTENCES]
  .filter((sentence, index, items) => items.findIndex((candidate) => candidate.japanese === sentence.japanese) === index)
  .map((sentence) => ({
  ...sentence,
  reading:
    sentence.reading
    ?? buildReadingFromRubySegments(sentence.rubySegments)
    ?? (KANJI_REGEX.test(sentence.japanese) ? undefined : sentence.japanese),
  koreanPronunciation: sentence.koreanPronunciation ?? "발음 참고 준비 중",
  pattern: normalizeSentencePattern(sentence),
  relatedWords: inferRelatedWords(sentence),
}));
import { EXPANDED_SENTENCES } from "./learningDataExpansion";
import { RECOMMENDED_SENTENCES } from "./recommendedDataExpansion";

