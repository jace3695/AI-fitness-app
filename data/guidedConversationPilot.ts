/**
 * Text-only, locally authored convenience-store pilot. These are retained immutable
 * revisions, not linguistic assessment or native-speaker/professional review.
 *
 * Each revision is SHA-256 of UTF-8 canonical JSON of the complete script with
 * scriptRevision omitted: recursively sorted object keys, ordered arrays, no
 * formatting whitespace, and unescaped Unicode. Hashing is authoring/test-only;
 * runtime lookup returns the exact pinned revision without hashing or fallback.
 */
export const GUIDED_CONVERSATION_SOURCE_VERSION = 1;
export const GUIDED_CONVERSATION_CATALOG_VERSION = 'free-conversation-catalog-v2';
export const GUIDED_RESPONSE_POLICY = 'guided-fixed-exchange-v1';
export const GUIDED_SAMPLE_MATCH_POLICY = 'guided-nfkc-example-or-reading-v1';
export const GUIDED_SUMMARY_POLICY_VERSION = 'guided-conversation-recap-v1';
export const GUIDED_TURN_POLICY = 'guided-explicit-submit-advances-v1';

export type GuidedConversationPhrase = Readonly<{
  japanese: string;
  reading: string;
  koreanPronunciation: string;
  meaningKo: string;
}>;

export type GuidedConversationStep = Readonly<{
  id: string;
  titleKo: string;
  goalKo: string;
  prompt: GuidedConversationPhrase;
  learnerExample: GuidedConversationPhrase;
  fixedReply: GuidedConversationPhrase;
  hintKo: string;
}>;

export type GuidedConversationScript = Readonly<{
  scriptId: string;
  contextId: 'convenience-store';
  levelId: 'beginner' | 'elementary' | 'intermediate';
  levelLabelKo: string;
  labelKo: string;
  situationKo: string;
  goalsKo: readonly string[];
  completionNoteKo: string;
  steps: readonly GuidedConversationStep[];
  authorship: Readonly<{
    status: 'locally-authored-unreviewed';
    nativeSpeakerReview: 'not-performed';
    professionalReview: 'not-performed';
  }>;
  pronunciationNoteKo: string;
  turnPolicy: typeof GUIDED_TURN_POLICY;
  stepCount: number;
  scriptRevision: string;
}>;

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

function immutable<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

// Keep past revisions here if a future authoring change adds a new revision.
// Do not edit text, metadata or step order under an existing scriptRevision.
export const GUIDED_CONVERSATION_PILOT = immutable([
  {
    "scriptId": "guided-convenience-store-beginner",
    "contextId": "convenience-store",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "편의점 · 물 한 병 사기",
    "situationKo": "계산대에 물 한 병을 가져왔어요. 이 연습에서는 가격이 100엔이고, 딱 맞는 현금 100엔을 가지고 있어요. 가격과 계산 과정은 연습용 설정이에요.",
    "goalsKo": [
      "물건을 가리켜 짧게 구매 의사를 말하기",
      "돈을 건네며 짧게 응답하기"
    ],
    "completionNoteKo": "두 단계에서 문장을 보내는 연습이에요. 실제 구매나 일본어 실력 평가는 아니에요.",
    "steps": [
      {
        "id": "buy-item",
        "titleKo": "물건 사기",
        "goalKo": "가리키는 물건을 정중하게 달라고 해요.",
        "prompt": {
          "japanese": "いらっしゃいませ。",
          "reading": "いらっしゃいませ。",
          "koreanPronunciation": "이랏샤이마세.",
          "meaningKo": "어서 오세요."
        },
        "learnerExample": {
          "japanese": "これをください。",
          "reading": "これをください。",
          "koreanPronunciation": "코레오 쿠다사이.",
          "meaningKo": "이거 주세요."
        },
        "fixedReply": {
          "japanese": "はい。百円です。",
          "reading": "はい。ひゃくえんです。",
          "koreanPronunciation": "하이. 햐쿠엔데스.",
          "meaningKo": "네. 100엔입니다."
        },
        "hintKo": "「これ」는 눈앞의 물건을 가리켜요. 「〜をください」로 정중하게 달라고 할 수 있어요."
      },
      {
        "id": "hand-over-payment",
        "titleKo": "돈 건네기",
        "goalKo": "준비한 돈을 건네며 짧게 말해요.",
        "prompt": {
          "japanese": "百円です。",
          "reading": "ひゃくえんです。",
          "koreanPronunciation": "햐쿠엔데스.",
          "meaningKo": "100엔입니다."
        },
        "learnerExample": {
          "japanese": "はい、どうぞ。",
          "reading": "はい、どうぞ。",
          "koreanPronunciation": "하이, 도오조.",
          "meaningKo": "네, 여기요."
        },
        "fixedReply": {
          "japanese": "ありがとうございます。",
          "reading": "ありがとうございます。",
          "koreanPronunciation": "아리가토오 고자이마스.",
          "meaningKo": "감사합니다."
        },
        "hintKo": "돈이나 물건을 상대에게 건넬 때 「はい、どうぞ」라고 할 수 있어요. 이 연습에서는 딱 맞는 금액을 건네요."
      }
    ],
    "authorship": {
      "status": "locally-authored-unreviewed",
      "nativeSpeakerReview": "not-performed",
      "professionalReview": "not-performed"
    },
    "pronunciationNoteKo": "한글 발음은 읽기 참고용 근사 표기예요. 실제 음성이나 발음 채점 결과가 아니에요.",
    "turnPolicy": "guided-explicit-submit-advances-v1",
    "stepCount": 2,
    "scriptRevision": "sha256:4d72bba976fc0aa52a7f4913b4f08d9e8a9be1022c057e19bfeb1a90f5e4989a"
  },
  {
    "scriptId": "guided-convenience-store-elementary",
    "contextId": "convenience-store",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "편의점 · 도시락 데우기와 계산",
    "situationKo": "도시락을 계산대에 가져왔어요. 데워 달라고 하고, 가져온 가방을 쓰며, 카드 결제를 선택해요. 단말기 조작과 실제 결제 이후 과정은 이 짧은 연습에 포함하지 않아요.",
    "goalsKo": [
      "데우기 선택에 답하기",
      "봉투를 정중히 거절하고 이유 덧붙이기",
      "원하는 결제 수단 말하기"
    ],
    "completionNoteKo": "세 가지 선택을 말하는 연습이에요. 결제 완료나 일본어 실력 평가는 아니에요.",
    "steps": [
      {
        "id": "request-heating",
        "titleKo": "데우기 선택",
        "goalKo": "도시락을 데워 달라고 요청해요.",
        "prompt": {
          "japanese": "お弁当は温めますか？",
          "reading": "おべんとうはあたためますか？",
          "koreanPronunciation": "오벤토오와 아타타메마스카?",
          "meaningKo": "도시락은 데워 드릴까요?"
        },
        "learnerExample": {
          "japanese": "はい、温めてください。",
          "reading": "はい、あたためてください。",
          "koreanPronunciation": "하이, 아타타메테 쿠다사이.",
          "meaningKo": "네, 데워 주세요."
        },
        "fixedReply": {
          "japanese": "かしこまりました。レジ袋はご利用ですか？",
          "reading": "かしこまりました。れじぶくろはごりようですか？",
          "koreanPronunciation": "카시코마리마시타. 레지부쿠로와 고리요오데스카?",
          "meaningKo": "알겠습니다. 봉투는 이용하시겠어요?"
        },
        "hintKo": "「温めてください」는 데워 달라는 말이에요. 「〜てください」로 원하는 행동을 부탁해요."
      },
      {
        "id": "decline-bag",
        "titleKo": "봉투 거절",
        "goalKo": "가방이 있어서 봉투가 필요 없다고 말해요.",
        "prompt": {
          "japanese": "レジ袋はご利用ですか？",
          "reading": "れじぶくろはごりようですか？",
          "koreanPronunciation": "레지부쿠로와 고리요오데스카?",
          "meaningKo": "봉투는 이용하시겠어요?"
        },
        "learnerExample": {
          "japanese": "袋は要りません。バッグがあります。",
          "reading": "ふくろはいりません。ばっぐがあります。",
          "koreanPronunciation": "후쿠로와 이리마센. 박구가 아리마스.",
          "meaningKo": "봉투는 필요 없어요. 가방이 있어요."
        },
        "fixedReply": {
          "japanese": "承知しました。お支払いはどうなさいますか？",
          "reading": "しょうちしました。おしはらいはどうなさいますか？",
          "koreanPronunciation": "쇼오치시마시타. 오시하라이와 도오 나사이마스카?",
          "meaningKo": "알겠습니다. 결제는 어떻게 하시겠어요?"
        },
        "hintKo": "「要りません」는 필요 없다는 뜻이에요. 「バッグがあります」를 덧붙여 거절하는 이유를 짧게 말해요."
      },
      {
        "id": "choose-card",
        "titleKo": "결제 수단 선택",
        "goalKo": "카드로 결제하겠다고 말해요.",
        "prompt": {
          "japanese": "お支払いはどうなさいますか？",
          "reading": "おしはらいはどうなさいますか？",
          "koreanPronunciation": "오시하라이와 도오 나사이마스카?",
          "meaningKo": "결제는 어떻게 하시겠어요?"
        },
        "learnerExample": {
          "japanese": "カードでお願いします。",
          "reading": "かーどでおねがいします。",
          "koreanPronunciation": "카아도데 오네가이시마스.",
          "meaningKo": "카드로 할게요."
        },
        "fixedReply": {
          "japanese": "かしこまりました。こちらの端末でお願いします。",
          "reading": "かしこまりました。こちらのたんまつでおねがいします。",
          "koreanPronunciation": "카시코마리마시타. 코치라노 탄마츠데 오네가이시마스.",
          "meaningKo": "알겠습니다. 이 단말기에서 결제해 주세요."
        },
        "hintKo": "결제 수단 뒤에 「でお願いします」를 붙여요. 「現金でお願いします」는 현금으로 하겠다는 뜻이지만, 이 예문의 고정 흐름은 카드 결제예요."
      }
    ],
    "authorship": {
      "status": "locally-authored-unreviewed",
      "nativeSpeakerReview": "not-performed",
      "professionalReview": "not-performed"
    },
    "pronunciationNoteKo": "한글 발음은 읽기 참고용 근사 표기예요. 실제 음성이나 발음 채점 결과가 아니에요.",
    "turnPolicy": "guided-explicit-submit-advances-v1",
    "stepCount": 3,
    "scriptRevision": "sha256:fb7841b7c9311d429ac7dddfc0b7cf1b3d2b97d4ff237cff5d5718cae213e99c"
  },
  {
    "scriptId": "guided-convenience-store-intermediate",
    "contextId": "convenience-store",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "편의점 · 다시 묻고 구매 내용 바꾸기",
    "situationKo": "도시락과 음료를 계산대에 가져왔어요. 점원의 질문을 다시 들은 뒤, 계산과 데우기 전에 도시락을 샌드위치로 바꾸고 음료를 따로 담아 달라고 요청해요. 이 연습의 점원은 변경 요청을 받아들여요. 봉투 요금과 실제 결제는 다루지 않아요.",
    "goalsKo": [
      "잘 듣지 못한 말을 더 천천히 다시 말해 달라고 요청하기",
      "행동이 시작되기 전에 구매 내용을 바꾸기",
      "추가 조건을 붙여 정중하게 서비스 요청하기"
    ],
    "completionNoteKo": "다시 묻기·변경·추가 요청의 세 단계를 연습해요. 실제 매장의 처리 보장이나 자유 문장 평가는 아니에요.",
    "steps": [
      {
        "id": "ask-slower-repeat",
        "titleKo": "천천히 다시 말해 달라고 하기",
        "goalKo": "잘 듣지 못한 질문을 더 천천히 말해 달라고 부탁해요.",
        "prompt": {
          "japanese": "こちらのお弁当は温めますか？",
          "reading": "こちらのおべんとうはあたためますか？",
          "koreanPronunciation": "코치라노 오벤토오와 아타타메마스카?",
          "meaningKo": "이 도시락은 데워 드릴까요?"
        },
        "learnerExample": {
          "japanese": "すみません、もう少しゆっくり言っていただけますか。",
          "reading": "すみません、もうすこしゆっくりいっていただけますか。",
          "koreanPronunciation": "스미마센, 모오 스코시 윳쿠리 잇테 이타다케마스카.",
          "meaningKo": "죄송하지만 조금 더 천천히 말씀해 주시겠어요?"
        },
        "fixedReply": {
          "japanese": "お弁当は、温めますか？",
          "reading": "おべんとうは、あたためますか？",
          "koreanPronunciation": "오벤토오와, 아타타메마스카?",
          "meaningKo": "도시락은, 데워 드릴까요?"
        },
        "hintKo": "「もう少しゆっくり」는 조금 더 천천히라는 뜻이에요. 「〜ていただけますか」로 정중하게 부탁해요. 문장의 쉼표는 연습용 표시이며 실제 음성 속도를 뜻하지 않아요."
      },
      {
        "id": "change-before-heating",
        "titleKo": "데우기 전에 물건 바꾸기",
        "goalKo": "도시락을 데우기 전에 샌드위치로 바꿔도 되는지 물어요.",
        "prompt": {
          "japanese": "お弁当は、温めますか？",
          "reading": "おべんとうは、あたためますか？",
          "koreanPronunciation": "오벤토오와, 아타타메마스카?",
          "meaningKo": "도시락은, 데워 드릴까요?"
        },
        "learnerExample": {
          "japanese": "温める前に、こちらのサンドイッチに替えてもいいですか。",
          "reading": "あたためるまえに、こちらのさんどいっちにかえてもいいですか。",
          "koreanPronunciation": "아타타메루 마에니, 코치라노 산도잇치니 카에테모 이이데스카.",
          "meaningKo": "데우기 전에 이 샌드위치로 바꿔도 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、大丈夫です。こちらのサンドイッチですね。",
          "reading": "はい、だいじょうぶです。こちらのさんどいっちですね。",
          "koreanPronunciation": "하이, 다이조오부데스. 코치라노 산도잇치데스네.",
          "meaningKo": "네, 괜찮습니다. 이 샌드위치 말씀이시죠?"
        },
        "hintKo": "「〜前に」로 시점을 분명히 해요. 「〜に替えてもいいですか」는 다른 물건으로 바꿔도 되는지 묻는 말이에요. 이 설정에서는 아직 계산하거나 데우지 않았어요."
      },
      {
        "id": "request-separate-bags",
        "titleKo": "따로 담아 달라고 하기",
        "goalKo": "변경 내용을 확인하고 음료를 별도 봉투에 담아 달라고 부탁해요.",
        "prompt": {
          "japanese": "こちらのサンドイッチですね。",
          "reading": "こちらのさんどいっちですね。",
          "koreanPronunciation": "코치라노 산도잇치데스네.",
          "meaningKo": "이 샌드위치 말씀이시죠?"
        },
        "learnerExample": {
          "japanese": "はい。それと、飲み物は別の袋に入れていただけますか。",
          "reading": "はい。それと、のみものはべつのふくろにいれていただけますか。",
          "koreanPronunciation": "하이. 소레토, 노미모노와 베츠노 후쿠로니 이레테 이타다케마스카.",
          "meaningKo": "네. 그리고 음료는 다른 봉투에 넣어 주시겠어요?"
        },
        "fixedReply": {
          "japanese": "かしこまりました。サンドイッチと飲み物は別々の袋にお入れします。",
          "reading": "かしこまりました。さんどいっちとのみものはべつべつのふくろにおいれします。",
          "koreanPronunciation": "카시코마리마시타. 산도잇치토 노미모노와 베츠베츠노 후쿠로니 오이레시마스.",
          "meaningKo": "알겠습니다. 샌드위치와 음료는 각각 다른 봉투에 넣어 드리겠습니다."
        },
        "hintKo": "「それと」로 요청을 덧붙여요. 「別の袋に入れていただけますか」는 다른 봉투에 넣어 달라는 정중한 부탁이에요. 봉투 비용에 대한 표현은 다음 콘텐츠 범위예요."
      }
    ],
    "authorship": {
      "status": "locally-authored-unreviewed",
      "nativeSpeakerReview": "not-performed",
      "professionalReview": "not-performed"
    },
    "pronunciationNoteKo": "한글 발음은 읽기 참고용 근사 표기예요. 실제 음성이나 발음 채점 결과가 아니에요.",
    "turnPolicy": "guided-explicit-submit-advances-v1",
    "stepCount": 3,
    "scriptRevision": "sha256:9f45d6a111675b171beceb596f56fad136321478657d8797d1155c5fcb2f329c"
  }
] as const satisfies readonly GuidedConversationScript[]);

/** Exact ID and revision only; unknown revisions never resolve to current content. */
export function findGuidedConversationScript(scriptId: string, scriptRevision: string): GuidedConversationScript | undefined {
  return GUIDED_CONVERSATION_PILOT.find(script => script.scriptId === scriptId && script.scriptRevision === scriptRevision);
}
