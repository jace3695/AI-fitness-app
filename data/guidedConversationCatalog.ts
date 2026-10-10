/** Retained authored text-only sources. No registry mutation or runtime authoring. */
import { GUIDED_CONVERSATION_PILOT, GUIDED_CONVERSATION_CATALOG_VERSION, GUIDED_RESPONSE_POLICY, GUIDED_SAMPLE_MATCH_POLICY, type GuidedConversationScript } from './guidedConversationPilot.ts';
import type { FreeConversationContextId, FreeConversationLevelId } from './freeConversationCatalog.ts';

export const GUIDED_CATALOGUE_VERSION = 'free-conversation-catalog-v3';
export const GUIDED_CATALOGUE_RESPONSE_POLICY = 'guided-fixed-exchange-v2';
export type GuidedCatalogueScript = Omit<GuidedConversationScript, 'contextId'> & Readonly<{ contextId: FreeConversationContextId }>;
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
function immutable<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

// Accepted content is copied whole. Never change text under an existing revision.
export const GUIDED_CONVERSATION_REMAINING: readonly GuidedCatalogueScript[] = immutable([
  {
    "scriptId": "guided-restaurant-beginner",
    "contextId": "restaurant",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "식당 · 인원 말하고 한 가지 주문하기",
    "situationKo": "가상의 식당에 혼자 왔어요. 자리에 앉은 뒤 메뉴에서 카레를 골라요. 좌석 안내와 주문 접수만 연습하며 가격과 실제 주문은 다루지 않아요.",
    "goalsKo": [
      "한 명이라고 짧게 말해요.",
      "카레를 달라고 정중하게 말해요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "restaurant-state-party-size",
        "titleKo": "인원 말하기",
        "goalKo": "한 명이라고 짧게 말해요.",
        "learnerExample": {
          "japanese": "一人です。",
          "reading": "ひとりです。",
          "koreanPronunciation": "히토리데스.",
          "meaningKo": "한 명이에요."
        },
        "fixedReply": {
          "japanese": "こちらへどうぞ。ご注文はお決まりですか。",
          "reading": "こちらへどうぞ。ごちゅうもんはおきまりですか。",
          "koreanPronunciation": "코치라에 도오조. 고추우몬와 오키마리데스카.",
          "meaningKo": "이쪽으로 오세요. 주문은 정하셨나요?"
        },
        "hintKo": "인원 한 명은 「一人（ひとり）」라고 해요. 이 예시에서는 안내받은 자리에 앉은 뒤 주문을 물어요.",
        "prompt": {
          "japanese": "いらっしゃいませ。何名様ですか。",
          "reading": "いらっしゃいませ。なんめいさまですか。",
          "koreanPronunciation": "이랏샤이마세. 난메에사마데스카.",
          "meaningKo": "어서 오세요. 몇 분이세요?"
        }
      },
      {
        "id": "restaurant-order-curry",
        "titleKo": "메뉴 주문하기",
        "goalKo": "카레를 달라고 정중하게 말해요.",
        "learnerExample": {
          "japanese": "カレーをください。",
          "reading": "かれーをください。",
          "koreanPronunciation": "카레에오 쿠다사이.",
          "meaningKo": "카레 주세요."
        },
        "fixedReply": {
          "japanese": "カレーですね。かしこまりました。",
          "reading": "かれーですね。かしこまりました。",
          "koreanPronunciation": "카레에데스네. 카시코마리마시타.",
          "meaningKo": "카레 말씀이시죠? 알겠습니다."
        },
        "hintKo": "메뉴 이름 뒤에 「をください」를 붙여요. 다른 메뉴를 써도 이 연습의 고정 응답은 카레 주문 예시를 보여 줘요.",
        "prompt": {
          "japanese": "こちらへどうぞ。ご注文はお決まりですか。",
          "reading": "こちらへどうぞ。ごちゅうもんはおきまりですか。",
          "koreanPronunciation": "코치라에 도오조. 고추우몬와 오키마리데스카.",
          "meaningKo": "이쪽으로 오세요. 주문은 정하셨나요?"
        }
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
    "scriptRevision": "sha256:f536c29078f567a5cc5dde12754c4e8cd406197b4daf91ff4881536fd6a0c9d3"
  },
  {
    "scriptId": "guided-restaurant-elementary",
    "contextId": "restaurant",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "식당 · 추천을 듣고 식사 선택하기",
    "situationKo": "가상의 식당에서 점심을 주문해요. 추천받은 생선 정식을 고르고 물을 요청한 뒤 후식은 사양해요. 메뉴 구성과 점원의 제안은 연습용 설정이에요.",
    "goalsKo": [
      "추천 메뉴가 무엇인지 물어요.",
      "추천받은 정식을 주문하고 물도 부탁해요.",
      "이번에는 후식을 주문하지 않겠다고 말해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "restaurant-ask-recommendation",
        "titleKo": "추천 묻기",
        "goalKo": "추천 메뉴가 무엇인지 물어요.",
        "learnerExample": {
          "japanese": "おすすめは何ですか。",
          "reading": "おすすめはなんですか。",
          "koreanPronunciation": "오스스메와 난데스카.",
          "meaningKo": "추천 메뉴는 무엇인가요?"
        },
        "fixedReply": {
          "japanese": "魚の定食がおすすめです。",
          "reading": "さかなのていしょくがおすすめです。",
          "koreanPronunciation": "사카나노 테에쇼쿠가 오스스메데스.",
          "meaningKo": "생선 정식을 추천합니다."
        },
        "hintKo": "「おすすめ」는 추천이에요. 「何ですか」로 무엇인지 물어요.",
        "prompt": {
          "japanese": "ご注文はお決まりですか。",
          "reading": "ごちゅうもんはおきまりですか。",
          "koreanPronunciation": "고추우몬와 오키마리데스카.",
          "meaningKo": "주문은 정하셨나요?"
        }
      },
      {
        "id": "restaurant-order-set-and-water",
        "titleKo": "주문에 요청 덧붙이기",
        "goalKo": "추천받은 정식을 주문하고 물도 부탁해요.",
        "learnerExample": {
          "japanese": "では、魚の定食をお願いします。お水もください。",
          "reading": "では、さかなのていしょくをおねがいします。おみずもください。",
          "koreanPronunciation": "데와, 사카나노 테에쇼쿠오 오네가이시마스. 오미즈모 쿠다사이.",
          "meaningKo": "그럼 생선 정식으로 부탁드려요. 물도 주세요."
        },
        "fixedReply": {
          "japanese": "かしこまりました。デザートはいかがですか。",
          "reading": "かしこまりました。でざーとはいかがですか。",
          "koreanPronunciation": "카시코마리마시타. 데자아토와 이카가데스카.",
          "meaningKo": "알겠습니다. 후식은 어떠세요?"
        },
        "hintKo": "「では」로 선택을 이어 가고 「も」로 추가 요청을 말해요. 이 설정에서는 생선 정식을 골라요.",
        "prompt": {
          "japanese": "魚の定食がおすすめです。",
          "reading": "さかなのていしょくがおすすめです。",
          "koreanPronunciation": "사카나노 테에쇼쿠가 오스스메데스.",
          "meaningKo": "생선 정식을 추천합니다."
        }
      },
      {
        "id": "restaurant-decline-dessert",
        "titleKo": "추가 주문 사양하기",
        "goalKo": "이번에는 후식을 주문하지 않겠다고 말해요.",
        "learnerExample": {
          "japanese": "いいえ、今回は要りません。ありがとうございます。",
          "reading": "いいえ、こんかいはいりません。ありがとうございます。",
          "koreanPronunciation": "이이에, 콘카이와 이리마센. 아리가토오 고자이마스.",
          "meaningKo": "아니요, 이번에는 괜찮아요. 감사합니다."
        },
        "fixedReply": {
          "japanese": "承知しました。お料理をお待ちください。",
          "reading": "しょうちしました。おりょうりをおまちください。",
          "koreanPronunciation": "쇼오치시마시타. 오료오리오 오마치쿠다사이.",
          "meaningKo": "알겠습니다. 음식이 나올 때까지 기다려 주세요."
        },
        "hintKo": "「今回は要りません」는 이번에는 필요 없다는 뜻이에요. 감사 인사를 덧붙여 정중히 사양해요.",
        "prompt": {
          "japanese": "かしこまりました。デザートはいかがですか。",
          "reading": "かしこまりました。でざーとはいかがですか。",
          "koreanPronunciation": "카시코마리마시타. 데자아토와 이카가데스카.",
          "meaningKo": "알겠습니다. 후식은 어떠세요?"
        }
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
    "scriptRevision": "sha256:ad272787da4fac2df9f60d19d71c665d641dc9ec51073a137dd2ece1796c5179"
  },
  {
    "scriptId": "guided-restaurant-intermediate",
    "contextId": "restaurant",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "식당 · 맵기 확인하고 주문 조건 바꾸기",
    "situationKo": "가상의 식당에서 닭고기 요리를 주문하기 전에 맵기와 소스 제공 방식을 물어요. 조리 시작 전 닭고기 대신 생선으로 바꿔 달라고 해요. 이 예시의 식당은 요청을 받아들여요. 알레르기 안전이나 실제 식당의 변경 정책을 안내하는 내용은 아니에요.",
    "goalsKo": [
      "매운 음식을 잘 못 먹는다고 설명하고 맵기를 물어요.",
      "소스를 별도 그릇에 담아 달라고 부탁해요.",
      "아직 조리 전이면 생선 요리로 바꾸고 같은 조건을 유지해 달라고 해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "restaurant-check-spiciness",
        "titleKo": "매운 정도 확인하기",
        "goalKo": "매운 음식을 잘 못 먹는다고 설명하고 맵기를 물어요.",
        "learnerExample": {
          "japanese": "辛いものが苦手なのですが、この料理は辛いですか。",
          "reading": "からいものがにがてなのですが、このりょうりはからいですか。",
          "koreanPronunciation": "카라이 모노가 니가테나노데스가, 코노 료오리와 카라이데스카.",
          "meaningKo": "매운 음식을 잘 못 먹는데 이 요리는 매운가요?"
        },
        "fixedReply": {
          "japanese": "料理自体は辛くありませんが、ソースは少し辛いです。",
          "reading": "りょうりじたいはからくありませんが、そーすはすこしからいです。",
          "koreanPronunciation": "료오리 지타이와 카라쿠 아리마센가, 소오스와 스코시 카라이데스.",
          "meaningKo": "요리 자체는 맵지 않지만 소스는 조금 맵습니다."
        },
        "hintKo": "「〜が苦手なのですが」로 자신의 선호를 설명한 뒤 질문해요. 맵기 답변은 이 가상 메뉴에만 해당해요.",
        "prompt": {
          "japanese": "こちらの鶏肉料理はいかがですか。",
          "reading": "こちらのとりにくりょうりはいかがですか。",
          "koreanPronunciation": "코치라노 토리니쿠료오리와 이카가데스카.",
          "meaningKo": "이 닭고기 요리는 어떠세요?"
        }
      },
      {
        "id": "restaurant-separate-sauce",
        "titleKo": "조건을 붙여 주문하기",
        "goalKo": "소스를 별도 그릇에 담아 달라고 부탁해요.",
        "learnerExample": {
          "japanese": "それでは、ソースを別の器に入れていただけますか。",
          "reading": "それでは、そーすをべつのうつわにいれていただけますか。",
          "koreanPronunciation": "소레데와, 소오스오 베츠노 우츠와니 이레테 이타다케마스카.",
          "meaningKo": "그러면 소스를 다른 그릇에 담아 주실 수 있을까요?"
        },
        "fixedReply": {
          "japanese": "はい、別の器に入れます。鶏肉料理を一つでよろしいですか。",
          "reading": "はい、べつのうつわにいれます。とりにくりょうりをひとつでよろしいですか。",
          "koreanPronunciation": "하이, 베츠노 우츠와니 이레마스. 토리니쿠료오리오 히토츠데 요로시이데스카.",
          "meaningKo": "네, 다른 그릇에 담겠습니다. 닭고기 요리 하나로 할까요?"
        },
        "hintKo": "「別の器」는 별도 그릇이에요. 「〜ていただけますか」로 가능한지 정중히 부탁해요.",
        "prompt": {
          "japanese": "料理自体は辛くありませんが、ソースは少し辛いです。",
          "reading": "りょうりじたいはからくありませんが、そーすはすこしからいです。",
          "koreanPronunciation": "료오리 지타이와 카라쿠 아리마센가, 소오스와 스코시 카라이데스.",
          "meaningKo": "요리 자체는 맵지 않지만 소스는 조금 맵습니다."
        }
      },
      {
        "id": "restaurant-change-before-cooking",
        "titleKo": "조리 전 메뉴 변경하기",
        "goalKo": "아직 조리 전이면 생선 요리로 바꾸고 같은 조건을 유지해 달라고 해요.",
        "learnerExample": {
          "japanese": "まだ調理前でしたら、魚料理に変更できますか。ソースは別でお願いします。",
          "reading": "まだちょうりまえでしたら、さかなりょうりにへんこうできますか。そーすはべつでおねがいします。",
          "koreanPronunciation": "마다 초오리마에데시타라, 사카나료오리니 헨코오데키마스카. 소오스와 베츠데 오네가이시마스.",
          "meaningKo": "아직 조리 전이라면 생선 요리로 바꿀 수 있을까요? 소스는 따로 부탁드려요."
        },
        "fixedReply": {
          "japanese": "まだ調理前ですので、変更できます。魚料理を一つ、ソースは別で承りました。",
          "reading": "まだちょうりまえですので、へんこうできます。さかなりょうりをひとつ、そーすはべつでうけたまわりました。",
          "koreanPronunciation": "마다 초오리마에데스노데, 헨코오데키마스. 사카나료오리오 히토츠, 소오스와 베츠데 우케타마와리마시타.",
          "meaningKo": "아직 조리 전이므로 변경할 수 있습니다. 생선 요리 하나, 소스는 따로 접수했습니다."
        },
        "hintKo": "「〜でしたら」로 조건을 붙이고 「変更できますか」로 가능 여부를 물어요. 실제 변경 가능 여부는 식당에 확인해야 해요.",
        "prompt": {
          "japanese": "はい、別の器に入れます。鶏肉料理を一つでよろしいですか。",
          "reading": "はい、べつのうつわにいれます。とりにくりょうりをひとつでよろしいですか。",
          "koreanPronunciation": "하이, 베츠노 우츠와니 이레마스. 토리니쿠료오리오 히토츠데 요로시이데스카.",
          "meaningKo": "네, 다른 그릇에 담겠습니다. 닭고기 요리 하나로 할까요?"
        }
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
    "scriptRevision": "sha256:727bd90a1981f853c2d0b2a7b4e6fc8d4a1f8cd9e2088ade9a0aa410d65d636a"
  },
  {
    "scriptId": "guided-hotel-beginner",
    "contextId": "hotel",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "호텔 · 예약 이름과 엘리베이터 위치",
    "situationKo": "가상의 호텔에 도착했어요. 연습용 예약 이름은 김이며 일본어로 キム라고 해요. 필요한 접수 절차를 마쳤다고 가정하고 예약 이름과 엘리베이터 위치만 연습해요. 실제 이름이나 신분증 정보를 입력할 필요가 없어요.",
    "goalsKo": [
      "연습용 예약 이름이 김이라고 말해요.",
      "엘리베이터가 어디 있는지 물어요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "hotel-state-reservation-name",
        "titleKo": "예약 이름 말하기",
        "goalKo": "연습용 예약 이름이 김이라고 말해요.",
        "learnerExample": {
          "japanese": "キムで予約しています。",
          "reading": "きむでよやくしています。",
          "koreanPronunciation": "키무데 요야쿠시테이마스.",
          "meaningKo": "김으로 예약했어요."
        },
        "fixedReply": {
          "japanese": "キム様ですね。こちらがお部屋の鍵です。",
          "reading": "きむさまですね。こちらがおへやのかぎです。",
          "koreanPronunciation": "키무사마데스네. 코치라가 오헤야노 카기데스.",
          "meaningKo": "김 님이시죠? 객실 열쇠입니다."
        },
        "hintKo": "이름 뒤의 「で予約しています」로 예약 이름을 알려요. キム는 연습용 이름이므로 그대로 사용해도 돼요.",
        "prompt": {
          "japanese": "いらっしゃいませ。お名前をお願いします。",
          "reading": "いらっしゃいませ。おなまえをおねがいします。",
          "koreanPronunciation": "이랏샤이마세. 오나마에오 오네가이시마스.",
          "meaningKo": "어서 오세요. 성함을 알려 주세요."
        }
      },
      {
        "id": "hotel-find-elevator",
        "titleKo": "시설 위치 묻기",
        "goalKo": "엘리베이터가 어디 있는지 물어요.",
        "learnerExample": {
          "japanese": "エレベーターはどこですか。",
          "reading": "えれべーたーはどこですか。",
          "koreanPronunciation": "에레베에타아와 도코데스카.",
          "meaningKo": "엘리베이터는 어디인가요?"
        },
        "fixedReply": {
          "japanese": "あちらです。ごゆっくりお過ごしください。",
          "reading": "あちらです。ごゆっくりおすごしください。",
          "koreanPronunciation": "아치라데스. 고윳쿠리 오스고시쿠다사이.",
          "meaningKo": "저쪽입니다. 편안히 쉬세요."
        },
        "hintKo": "시설 이름 뒤에 「はどこですか」를 붙여 위치를 물어요. 「あちら」는 직원이 가리키는 저쪽이라는 설정이에요.",
        "prompt": {
          "japanese": "キム様ですね。こちらがお部屋の鍵です。",
          "reading": "きむさまですね。こちらがおへやのかぎです。",
          "koreanPronunciation": "키무사마데스네. 코치라가 오헤야노 카기데스.",
          "meaningKo": "김 님이시죠? 객실 열쇠입니다."
        }
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
    "scriptRevision": "sha256:b75b4811dad73bfffdf8056a0667f95f8972a0565967eff27c4841f991ee0d02"
  },
  {
    "scriptId": "guided-hotel-elementary",
    "contextId": "hotel",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "호텔 · 숙박 일정과 시설 정보 확인",
    "situationKo": "가상의 호텔에서 연습용 이름 김으로 2박을 예약했어요. 직원의 숙박 일수 확인에 답하고 조식 장소와 체크아웃 시간을 물어요. 1층 식당과 오전 10시라는 정보는 이 연습의 가상 설정이며 실제 호텔 안내가 아니에요.",
    "goalsKo": [
      "2박이 맞다고 확인하고 체크인을 부탁해요.",
      "아침 식사를 어디에서 하는지 물어요.",
      "체크아웃 마감 시간을 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "hotel-confirm-two-nights",
        "titleKo": "숙박 일수 확인하기",
        "goalKo": "2박이 맞다고 확인하고 체크인을 부탁해요.",
        "learnerExample": {
          "japanese": "はい、二泊です。チェックインをお願いします。",
          "reading": "はい、にはくです。ちぇっくいんをおねがいします。",
          "koreanPronunciation": "하이, 니하쿠데스. 첵쿠인오 오네가이시마스.",
          "meaningKo": "네, 2박이에요. 체크인 부탁드려요."
        },
        "fixedReply": {
          "japanese": "承知しました。朝食付きのご予約です。",
          "reading": "しょうちしました。ちょうしょくつきのごよやくです。",
          "koreanPronunciation": "쇼오치시마시타. 초오쇼쿠츠키노 고요야쿠데스.",
          "meaningKo": "알겠습니다. 조식 포함 예약입니다."
        },
        "hintKo": "「二泊」은 「にはく」라고 읽어요. 이 흐름은 체크인 전체 절차를 재현하지 않아요.",
        "prompt": {
          "japanese": "キム様、二泊のご予約ですね。",
          "reading": "きむさま、にはくのごよやくですね。",
          "koreanPronunciation": "키무사마, 니하쿠노 고요야쿠데스네.",
          "meaningKo": "김 님, 2박 예약이시죠?"
        }
      },
      {
        "id": "hotel-ask-breakfast-location",
        "titleKo": "조식 장소 묻기",
        "goalKo": "아침 식사를 어디에서 하는지 물어요.",
        "learnerExample": {
          "japanese": "朝食はどこで食べられますか。",
          "reading": "ちょうしょくはどこでたべられますか。",
          "koreanPronunciation": "초오쇼쿠와 도코데 타베라레마스카.",
          "meaningKo": "아침 식사는 어디에서 할 수 있나요?"
        },
        "fixedReply": {
          "japanese": "一階のレストランでお召し上がりいただけます。",
          "reading": "いっかいのれすとらんでおめしあがりいただけます。",
          "koreanPronunciation": "잇카이노 레스토란데 오메시아가리 이타다케마스.",
          "meaningKo": "1층 레스토랑에서 드실 수 있습니다."
        },
        "hintKo": "「どこで」는 행동하는 장소를 물어요. 「食べられますか」는 먹을 수 있는지 묻는 말이에요.",
        "prompt": {
          "japanese": "承知しました。朝食付きのご予約です。",
          "reading": "しょうちしました。ちょうしょくつきのごよやくです。",
          "koreanPronunciation": "쇼오치시마시타. 초오쇼쿠츠키노 고요야쿠데스.",
          "meaningKo": "알겠습니다. 조식 포함 예약입니다."
        }
      },
      {
        "id": "hotel-ask-checkout-time",
        "titleKo": "체크아웃 시간 묻기",
        "goalKo": "체크아웃 마감 시간을 확인해요.",
        "learnerExample": {
          "japanese": "チェックアウトは何時までですか。",
          "reading": "ちぇっくあうとはなんじまでですか。",
          "koreanPronunciation": "첵쿠아우토와 난지마데데스카.",
          "meaningKo": "체크아웃은 몇 시까지인가요?"
        },
        "fixedReply": {
          "japanese": "午前十時までです。",
          "reading": "ごぜんじゅうじまでです。",
          "koreanPronunciation": "고젠 주우지마데데스.",
          "meaningKo": "오전 10시까지입니다."
        },
        "hintKo": "「何時まで」는 몇 시까지인지 묻는 표현이에요. 실제 숙소의 시간은 예약 안내나 직원에게 별도로 확인해요.",
        "prompt": {
          "japanese": "一階のレストランでお召し上がりいただけます。",
          "reading": "いっかいのれすとらんでおめしあがりいただけます。",
          "koreanPronunciation": "잇카이노 레스토란데 오메시아가리 이타다케마스.",
          "meaningKo": "1층 레스토랑에서 드실 수 있습니다."
        }
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
    "scriptRevision": "sha256:852ff666451fda9ca741a2c67753e9b72867fd3b1b1e2ca9bf9653b77e96e0cd"
  },
  {
    "scriptId": "guided-hotel-intermediate",
    "contextId": "hotel",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "호텔 · 소음 설명하고 객실 변경 문의",
    "situationKo": "가상의 호텔에서 복도 소음 때문에 객실 변경을 문의해요. 직원은 추가 요금 없이 조용한 객실로 바꿀 수 있다고 답하고 짐은 직접 옮긴다고 가정해요. 객실 상황과 요금 조건은 연습용이며 실제 호텔의 보장이나 변경 절차가 아니에요.",
    "goalsKo": [
      "복도 소음 때문에 잠들기 어렵다고 설명하고 조용한 객실이 있는지 물어요.",
      "객실 변경 전에 추가 요금이 있는지 물어요.",
      "객실 변경을 부탁하고 짐 이동과 새 열쇠 수령 장소를 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "hotel-explain-room-noise",
        "titleKo": "문제와 요청 함께 말하기",
        "goalKo": "복도 소음 때문에 잠들기 어렵다고 설명하고 조용한 객실이 있는지 물어요.",
        "learnerExample": {
          "japanese": "廊下の音が気になって眠れないのですが、静かな部屋は空いていますか。",
          "reading": "ろうかのおとがきになってねむれないのですが、しずかなへやはあいていますか。",
          "koreanPronunciation": "로오카노 오토가 키니 낫테 네무레나이노데스가, 시즈카나 헤야와 아이테이마스카.",
          "meaningKo": "복도 소리가 신경 쓰여서 잠들기 어려운데 조용한 객실이 비어 있나요?"
        },
        "fixedReply": {
          "japanese": "申し訳ございません。別のお部屋をご用意できます。",
          "reading": "もうしわけございません。べつのおへやをごよういできます。",
          "koreanPronunciation": "모오시와케 고자이마센. 베츠노 오헤야오 고요오이데키마스.",
          "meaningKo": "죄송합니다. 다른 객실을 준비해 드릴 수 있습니다."
        },
        "hintKo": "「〜のですが」로 상황을 설명하며 요청으로 이어 가요. 「空いていますか」로 빈 객실이 있는지 물어요.",
        "prompt": {
          "japanese": "フロントでございます。いかがなさいましたか。",
          "reading": "ふろんとでございます。いかがなさいましたか。",
          "koreanPronunciation": "후론토데 고자이마스. 이카가 나사이마시타카.",
          "meaningKo": "프런트입니다. 무슨 일이신가요?"
        }
      },
      {
        "id": "hotel-check-change-cost",
        "titleKo": "비용 조건 먼저 확인하기",
        "goalKo": "객실 변경 전에 추가 요금이 있는지 물어요.",
        "learnerExample": {
          "japanese": "部屋を替える前に、追加料金がかかるか確認してもよろしいですか。",
          "reading": "へやをかえるまえに、ついかりょうきんがかかるかかくにんしてもよろしいですか。",
          "koreanPronunciation": "헤야오 카에루 마에니, 츠이카료오킨가 카카루카 카쿠닌시테모 요로시이데스카.",
          "meaningKo": "객실을 바꾸기 전에 추가 요금이 있는지 확인해도 될까요?"
        },
        "fixedReply": {
          "japanese": "今回のお部屋の変更に追加料金はかかりません。",
          "reading": "こんかいのおへやのへんこうについかりょうきんはかかりません。",
          "koreanPronunciation": "콘카이노 오헤야노 헨코오니 츠이카료오킨와 카카리마센.",
          "meaningKo": "이번 객실 변경에는 추가 요금이 없습니다."
        },
        "hintKo": "「〜か確認してもよろしいですか」로 조건을 정중히 확인해요. 무료 변경은 이 가상 대화에서만 정한 조건이에요.",
        "prompt": {
          "japanese": "申し訳ございません。別のお部屋をご用意できます。",
          "reading": "もうしわけございません。べつのおへやをごよういできます。",
          "koreanPronunciation": "모오시와케 고자이마센. 베츠노 오헤야오 고요오이데키마스.",
          "meaningKo": "죄송합니다. 다른 객실을 준비해 드릴 수 있습니다."
        }
      },
      {
        "id": "hotel-confirm-luggage-and-key",
        "titleKo": "변경과 다음 행동 확인하기",
        "goalKo": "객실 변경을 부탁하고 짐 이동과 새 열쇠 수령 장소를 확인해요.",
        "learnerExample": {
          "japanese": "それでは、変更をお願いします。荷物は自分で運びますので、新しい鍵はフロントで受け取ればよいでしょうか。",
          "reading": "それでは、へんこうをおねがいします。にもつはじぶんではこびますので、あたらしいかぎはふろんとでうけとればよいでしょうか。",
          "koreanPronunciation": "소레데와, 헨코오오 오네가이시마스. 니모츠와 지분데 하코비마스노데, 아타라시이 카기와 후론토데 우케토레바 요이데쇼오카.",
          "meaningKo": "그러면 변경 부탁드려요. 짐은 제가 옮길 테니 새 열쇠는 프런트에서 받으면 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、フロントでお渡しします。今の鍵もお持ちください。",
          "reading": "はい、ふろんとでおわたしします。いまのかぎもおもちください。",
          "koreanPronunciation": "하이, 후론토데 오와타시시마스. 이마노 카기모 오모치쿠다사이.",
          "meaningKo": "네, 프런트에서 드리겠습니다. 지금 열쇠도 가져와 주세요."
        },
        "hintKo": "「〜ばよいでしょうか」로 다음 행동을 확인해요. 이 문장은 연습용이며 실제 객실 변경이나 비용 승인이 이루어지지 않아요.",
        "prompt": {
          "japanese": "今回のお部屋の変更に追加料金はかかりません。",
          "reading": "こんかいのおへやのへんこうについかりょうきんはかかりません。",
          "koreanPronunciation": "콘카이노 오헤야노 헨코오니 츠이카료오킨와 카카리마센.",
          "meaningKo": "이번 객실 변경에는 추가 요금이 없습니다."
        }
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
    "scriptRevision": "sha256:9ad1fdd0c5da4bb905f729d7629bacec264a4e7d4bc04946caec83eb8aaeea63"
  },
  {
    "scriptId": "guided-train-beginner",
    "contextId": "train",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "전철 · 타는 곳 묻고 번호 확인하기",
    "situationKo": "가상의 역에서 가상의 목적지인 みどり駅로 가려고 해요. 이 연습에서는 2번 승강장에서 탈 수 있다고 정했어요. 역 이름·승강장·운행 정보는 실제 길 안내가 아니에요.",
    "goalsKo": [
      "미도리역까지 가고 싶다고 말해요.",
      "안내받은 승강장이 2번인지 다시 확인해요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "train-name-destination",
        "titleKo": "목적지 말하기",
        "goalKo": "미도리역까지 가고 싶다고 말해요.",
        "learnerExample": {
          "japanese": "みどり駅まで行きたいです。",
          "reading": "みどりえきまでいきたいです。",
          "koreanPronunciation": "미도리에키마데 이키타이데스.",
          "meaningKo": "미도리역까지 가고 싶어요."
        },
        "fixedReply": {
          "japanese": "二番ホームへどうぞ。",
          "reading": "にばんほーむへどうぞ。",
          "koreanPronunciation": "니반 호오무에 도오조.",
          "meaningKo": "2번 승강장으로 가세요."
        },
        "hintKo": "「〜まで行きたいです」로 가고 싶은 목적지를 말해요. みどり駅는 가상의 역 이름이에요.",
        "prompt": {
          "japanese": "こんにちは。どちらまで行かれますか。",
          "reading": "こんにちは。どちらまでいかれますか。",
          "koreanPronunciation": "콘니치와. 도치라마데 이카레마스카.",
          "meaningKo": "안녕하세요. 어디까지 가시나요?"
        }
      },
      {
        "id": "train-confirm-platform-two",
        "titleKo": "승강장 번호 확인하기",
        "goalKo": "안내받은 승강장이 2번인지 다시 확인해요.",
        "learnerExample": {
          "japanese": "二番ホームですね。",
          "reading": "にばんほーむですね。",
          "koreanPronunciation": "니반 호오무데스네.",
          "meaningKo": "2번 승강장이죠?"
        },
        "fixedReply": {
          "japanese": "はい、二番ホームです。",
          "reading": "はい、にばんほーむです。",
          "koreanPronunciation": "하이, 니반 호오무데스.",
          "meaningKo": "네, 2번 승강장입니다."
        },
        "hintKo": "「〜ですね」로 들은 내용을 되짚어 확인해요. 실제로 탈 전철은 현장 표지와 직원 안내를 확인해야 해요.",
        "prompt": {
          "japanese": "二番ホームへどうぞ。",
          "reading": "にばんほーむへどうぞ。",
          "koreanPronunciation": "니반 호오무에 도오조.",
          "meaningKo": "2번 승강장으로 가세요."
        }
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
    "scriptRevision": "sha256:19f448ba6fa10f54e1f579e55a7541fc98d94505eb9fbbc3261a41fc8c50753e"
  },
  {
    "scriptId": "guided-train-elementary",
    "contextId": "train",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "전철 · 환승역과 승강장 확인하기",
    "situationKo": "가상의 전철 노선에서 さくら駅로 가요. あおば駅에서 갈아타고 4번 승강장의 전철을 탄 뒤 세 정거장 가는 연습용 경로예요. 실제 역이나 시간표와 연결되지 않아요.",
    "goalsKo": [
      "사쿠라역까지 갈 때 환승해야 하는지 물어요.",
      "아오바역에서 몇 번 승강장으로 가야 하는지 물어요.",
      "갈아탄 뒤 몇 번째 역인지 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "train-ask-transfer-needed",
        "titleKo": "환승 여부 묻기",
        "goalKo": "사쿠라역까지 갈 때 환승해야 하는지 물어요.",
        "learnerExample": {
          "japanese": "さくら駅まで行きたいのですが、乗り換えは必要ですか。",
          "reading": "さくらえきまでいきたいのですが、のりかえはひつようですか。",
          "koreanPronunciation": "사쿠라에키마데 이키타이노데스가, 노리카에와 히츠요오데스카.",
          "meaningKo": "사쿠라역까지 가고 싶은데 환승이 필요한가요?"
        },
        "fixedReply": {
          "japanese": "はい、あおば駅で乗り換えてください。",
          "reading": "はい、あおばえきでのりかえてください。",
          "koreanPronunciation": "하이, 아오바에키데 노리카에테 쿠다사이.",
          "meaningKo": "네, 아오바역에서 갈아타세요."
        },
        "hintKo": "「乗り換え」는 환승이에요. 「必要ですか」로 필요한지 물어요.",
        "prompt": {
          "japanese": "どちらまで行かれますか。",
          "reading": "どちらまでいかれますか。",
          "koreanPronunciation": "도치라마데 이카레마스카.",
          "meaningKo": "어디까지 가시나요?"
        }
      },
      {
        "id": "train-ask-transfer-platform",
        "titleKo": "환승 승강장 묻기",
        "goalKo": "아오바역에서 몇 번 승강장으로 가야 하는지 물어요.",
        "learnerExample": {
          "japanese": "あおば駅では、何番ホームに行けばいいですか。",
          "reading": "あおばえきでは、なんばんほーむにいけばいいですか。",
          "koreanPronunciation": "아오바에키데와, 난반 호오무니 이케바 이이데스카.",
          "meaningKo": "아오바역에서는 몇 번 승강장으로 가면 되나요?"
        },
        "fixedReply": {
          "japanese": "四番ホームです。さくら駅行きの電車に乗ってください。",
          "reading": "よんばんほーむです。さくらえきゆきのでんしゃにのってください。",
          "koreanPronunciation": "욘반 호오무데스. 사쿠라에키유키노 덴샤니 놋테 쿠다사이.",
          "meaningKo": "4번 승강장입니다. 사쿠라역행 전철을 타세요."
        },
        "hintKo": "「何番ホーム」로 번호를 물어요. 「〜に行けばいいですか」는 어디로 가면 되는지 확인하는 말이에요.",
        "prompt": {
          "japanese": "はい、あおば駅で乗り換えてください。",
          "reading": "はい、あおばえきでのりかえてください。",
          "koreanPronunciation": "하이, 아오바에키데 노리카에테 쿠다사이.",
          "meaningKo": "네, 아오바역에서 갈아타세요."
        }
      },
      {
        "id": "train-ask-stops-after-transfer",
        "titleKo": "환승 후 정거장 수 묻기",
        "goalKo": "갈아탄 뒤 몇 번째 역인지 확인해요.",
        "learnerExample": {
          "japanese": "乗り換えてから、何駅目ですか。",
          "reading": "のりかえてから、なんえきめですか。",
          "koreanPronunciation": "노리카에테카라, 난에키메데스카.",
          "meaningKo": "환승한 뒤 몇 번째 역인가요?"
        },
        "fixedReply": {
          "japanese": "三駅目です。さくら駅で降りてください。",
          "reading": "さんえきめです。さくらえきでおりてください。",
          "koreanPronunciation": "산에키메데스. 사쿠라에키데 오리테 쿠다사이.",
          "meaningKo": "세 번째 역입니다. 사쿠라역에서 내리세요."
        },
        "hintKo": "「〜てから」는 한 행동을 한 뒤를 뜻해요. 「何駅目」로 출발 후 몇 번째 역인지 물어요.",
        "prompt": {
          "japanese": "四番ホームです。さくら駅行きの電車に乗ってください。",
          "reading": "よんばんほーむです。さくらえきゆきのでんしゃにのってください。",
          "koreanPronunciation": "욘반 호오무데스. 사쿠라에키유키노 덴샤니 놋테 쿠다사이.",
          "meaningKo": "4번 승강장입니다. 사쿠라역행 전철을 타세요."
        }
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
    "scriptRevision": "sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085"
  },
  {
    "scriptId": "guided-train-intermediate",
    "contextId": "train",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "전철 · 잘못 고른 열차를 확인하고 대안 찾기",
    "situationKo": "가상의 역에서 みどり駅에 가려는데 눈앞의 쾌속은 그 역에 서지 않는다고 들었어요. 직원에게 대안과 환승 여부를 확인해요. 다음 보통열차가 같은 승강장에 온다는 정보까지 모두 연습용이며 실제 운행 안내가 아니에요.",
    "goalsKo": [
      "쾌속을 타도 목적지에서 내릴 수 없다는 뜻인지 확인해요.",
      "다음 보통열차가 같은 승강장에 오는지 물어요.",
      "안내받은 보통열차로 환승 없이 갈 수 있는지 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "train-confirm-train-does-not-stop",
        "titleKo": "놓친 조건 재확인하기",
        "goalKo": "쾌속을 타도 목적지에서 내릴 수 없다는 뜻인지 확인해요.",
        "learnerExample": {
          "japanese": "すみません。この電車では、みどり駅で降りられないということですか。",
          "reading": "すみません。このでんしゃでは、みどりえきでおりられないということですか。",
          "koreanPronunciation": "스미마센. 코노 덴샤데와, 미도리에키데 오리라레나이토 이우 코토데스카.",
          "meaningKo": "실례합니다. 이 전철을 타면 미도리역에서 내릴 수 없다는 뜻인가요?"
        },
        "fixedReply": {
          "japanese": "はい。みどり駅へは普通電車をご利用ください。",
          "reading": "はい。みどりえきへはふつうでんしゃをごりようください。",
          "koreanPronunciation": "하이. 미도리에키에와 후츠우덴샤오 고리요오쿠다사이.",
          "meaningKo": "네. 미도리역으로 가려면 보통열차를 이용하세요."
        },
        "hintKo": "「〜ということですか」로 들은 설명을 자신의 말로 되묻고 확인해요. 열차 종류별 정차역은 실제 노선마다 달라요.",
        "prompt": {
          "japanese": "この快速は、みどり駅には止まりません。",
          "reading": "このかいそくは、みどりえきにはとまりません。",
          "koreanPronunciation": "코노 카이소쿠와, 미도리에키니와 토마리마센.",
          "meaningKo": "이 쾌속은 미도리역에 정차하지 않습니다."
        }
      },
      {
        "id": "train-ask-local-same-platform",
        "titleKo": "대안의 탑승 장소 확인하기",
        "goalKo": "다음 보통열차가 같은 승강장에 오는지 물어요.",
        "learnerExample": {
          "japanese": "次の普通電車も、このホームから乗れますか。",
          "reading": "つぎのふつうでんしゃも、このほーむからのれますか。",
          "koreanPronunciation": "츠기노 후츠우덴샤모, 코노 호오무카라 노레마스카.",
          "meaningKo": "다음 보통열차도 이 승강장에서 탈 수 있나요?"
        },
        "fixedReply": {
          "japanese": "はい、同じホームです。次に来る普通電車にお乗りください。",
          "reading": "はい、おなじほーむです。つぎにくるふつうでんしゃにおのりください。",
          "koreanPronunciation": "하이, 오나지 호오무데스. 츠기니 쿠루 후츠우덴샤니 오노리쿠다사이.",
          "meaningKo": "네, 같은 승강장입니다. 다음에 오는 보통열차를 타세요."
        },
        "hintKo": "「次の」는 다음의, 「同じ」는 같다는 뜻이에요. 실제 승강장이나 출발 시각을 예측하는 문장이 아니에요.",
        "prompt": {
          "japanese": "はい。みどり駅へは普通電車をご利用ください。",
          "reading": "はい。みどりえきへはふつうでんしゃをごりようください。",
          "koreanPronunciation": "하이. 미도리에키에와 후츠우덴샤오 고리요오쿠다사이.",
          "meaningKo": "네. 미도리역으로 가려면 보통열차를 이용하세요."
        }
      },
      {
        "id": "train-confirm-no-transfer",
        "titleKo": "새 경로를 정리해 확인하기",
        "goalKo": "안내받은 보통열차로 환승 없이 갈 수 있는지 확인해요.",
        "learnerExample": {
          "japanese": "では、次の普通電車に乗れば、乗り換えずにみどり駅まで行けるのですね。",
          "reading": "では、つぎのふつうでんしゃにのれば、のりかえずにみどりえきまでいけるのですね。",
          "koreanPronunciation": "데와, 츠기노 후츠우덴샤니 노레바, 노리카에즈니 미도리에키마데 이케루노데스네.",
          "meaningKo": "그럼 다음 보통열차를 타면 환승 없이 미도리역까지 갈 수 있는 거군요."
        },
        "fixedReply": {
          "japanese": "はい、そのとおりです。みどり駅でお降りください。",
          "reading": "はい、そのとおりです。みどりえきでおおりください。",
          "koreanPronunciation": "하이, 소노 토오리데스. 미도리에키데 오오리쿠다사이.",
          "meaningKo": "네, 맞습니다. 미도리역에서 내리세요."
        },
        "hintKo": "「〜ば」로 조건을, 「〜ずに」로 어떤 행동을 하지 않음을 말해요. 「のですね」로 경로 전체를 다시 확인해요.",
        "prompt": {
          "japanese": "はい、同じホームです。次に来る普通電車にお乗りください。",
          "reading": "はい、おなじほーむです。つぎにくるふつうでんしゃにおのりください。",
          "koreanPronunciation": "하이, 오나지 호오무데스. 츠기니 쿠루 후츠우덴샤니 오노리쿠다사이.",
          "meaningKo": "네, 같은 승강장입니다. 다음에 오는 보통열차를 타세요."
        }
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
    "scriptRevision": "sha256:d5178b284e4d0d1d89a56be77a34e71923916b6a2dcf866e976f115a6bce11a5"
  },
  {
    "scriptId": "guided-company-general-beginner",
    "contextId": "company-general",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "회사 · 처음 인사하고 회의실 찾기",
    "situationKo": "가상의 회사에서 처음 만나는 동료에게 인사해요. 연습용 이름은 김이고 상대는 다나카예요. 인사 뒤 회의실 위치를 물어요. 사람과 장소는 모두 연습용이며 실제 개인정보를 쓰지 않아도 돼요.",
    "goalsKo": [
      "연습용 이름을 말하며 처음 인사해요.",
      "회의실이 어디인지 짧게 물어요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "company-general-introduce-name",
        "titleKo": "처음 인사하기",
        "goalKo": "연습용 이름을 말하며 처음 인사해요.",
        "learnerExample": {
          "japanese": "初めまして。キムです。よろしくお願いします。",
          "reading": "はじめまして。きむです。よろしくおねがいします。",
          "koreanPronunciation": "하지메마시테. 키무데스. 요로시쿠 오네가이시마스.",
          "meaningKo": "처음 뵙겠습니다. 김입니다. 잘 부탁드립니다."
        },
        "fixedReply": {
          "japanese": "こちらこそ、よろしくお願いします。もうすぐ会議ですね。",
          "reading": "こちらこそ、よろしくおねがいします。もうすぐかいぎですね。",
          "koreanPronunciation": "코치라코소, 요로시쿠 오네가이시마스. 모오 스구 카이기데스네.",
          "meaningKo": "저야말로 잘 부탁드립니다. 곧 회의네요."
        },
        "hintKo": "처음 만날 때 「初めまして」라고 인사해요. 이름은 연습용 キム를 그대로 사용해도 돼요.",
        "prompt": {
          "japanese": "初めまして。田中です。",
          "reading": "はじめまして。たなかです。",
          "koreanPronunciation": "하지메마시테. 타나카데스.",
          "meaningKo": "처음 뵙겠습니다. 다나카입니다."
        }
      },
      {
        "id": "company-general-find-meeting-room",
        "titleKo": "회의실 위치 묻기",
        "goalKo": "회의실이 어디인지 짧게 물어요.",
        "learnerExample": {
          "japanese": "会議室はどこですか。",
          "reading": "かいぎしつはどこですか。",
          "koreanPronunciation": "카이기시츠와 도코데스카.",
          "meaningKo": "회의실은 어디인가요?"
        },
        "fixedReply": {
          "japanese": "あちらです。一緒に行きましょう。",
          "reading": "あちらです。いっしょにいきましょう。",
          "koreanPronunciation": "아치라데스. 잇쇼니 이키마쇼오.",
          "meaningKo": "저쪽입니다. 같이 가시죠."
        },
        "hintKo": "「会議室」는 회의실이에요. 「はどこですか」로 위치를 물어요.",
        "prompt": {
          "japanese": "こちらこそ、よろしくお願いします。もうすぐ会議ですね。",
          "reading": "こちらこそ、よろしくおねがいします。もうすぐかいぎですね。",
          "koreanPronunciation": "코치라코소, 요로시쿠 오네가이시마스. 모오 스구 카이기데스네.",
          "meaningKo": "저야말로 잘 부탁드립니다. 곧 회의네요."
        }
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
    "scriptRevision": "sha256:fe229227b1667f00beb7c603067db8239f2bb3eefa3ec28df04957096ba3eae6"
  },
  {
    "scriptId": "guided-company-general-elementary",
    "contextId": "company-general",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "회사 · 자료 확인 범위와 기한 정하기",
    "situationKo": "가상의 동료에게 자료 확인을 부탁받았어요. 내일 정오까지 날짜와 담당자 이름을 확인하고 메일로 결과를 알리는 연습용 업무예요. 실제 자료나 사람의 정보를 입력하거나 메일을 보내지 않아요.",
    "goalsKo": [
      "확인할 수 있다고 답하고 언제까지 해야 하는지 물어요.",
      "자료 중 어디를 확인해야 하는지 물어요.",
      "확인한 뒤 메일로 결과를 알리겠다고 정리해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "company-general-ask-deadline",
        "titleKo": "기한 확인하기",
        "goalKo": "확인할 수 있다고 답하고 언제까지 해야 하는지 물어요.",
        "learnerExample": {
          "japanese": "はい。いつまでに確認すればいいですか。",
          "reading": "はい。いつまでにかくにんすればいいですか。",
          "koreanPronunciation": "하이. 이츠마데니 카쿠닌스레바 이이데스카.",
          "meaningKo": "네. 언제까지 확인하면 되나요?"
        },
        "fixedReply": {
          "japanese": "明日の正午までにお願いします。",
          "reading": "あしたのしょうごまでにおねがいします。",
          "koreanPronunciation": "아시타노 쇼오고마데니 오네가이시마스.",
          "meaningKo": "내일 정오까지 부탁드려요."
        },
        "hintKo": "「いつまでに」로 완료 기한을 물어요. 이 대화의 내일은 가상 상황 속 날짜예요.",
        "prompt": {
          "japanese": "この資料を確認してもらえますか。",
          "reading": "このしりょうをかくにんしてもらえますか。",
          "koreanPronunciation": "코노 시료오오 카쿠닌시테 모라에마스카.",
          "meaningKo": "이 자료를 확인해 주실 수 있나요?"
        }
      },
      {
        "id": "company-general-ask-review-scope",
        "titleKo": "확인 범위 묻기",
        "goalKo": "자료 중 어디를 확인해야 하는지 물어요.",
        "learnerExample": {
          "japanese": "どの部分を確認すればいいですか。",
          "reading": "どのぶぶんをかくにんすればいいですか。",
          "koreanPronunciation": "도노 부분오 카쿠닌스레바 이이데스카.",
          "meaningKo": "어느 부분을 확인하면 되나요?"
        },
        "fixedReply": {
          "japanese": "日付と担当者の名前を確認してください。結果はメールでお願いします。",
          "reading": "ひづけとたんとうしゃのなまえをかくにんしてください。けっかはめーるでおねがいします。",
          "koreanPronunciation": "히즈케토 탄토오샤노 나마에오 카쿠닌시테 쿠다사이. 켁카와 메에루데 오네가이시마스.",
          "meaningKo": "날짜와 담당자 이름을 확인해 주세요. 결과는 메일로 부탁드려요."
        },
        "hintKo": "「どの部分」는 어느 부분이라는 뜻이에요. 검토 대상을 분명히 하기 위한 질문이에요.",
        "prompt": {
          "japanese": "明日の正午までにお願いします。",
          "reading": "あしたのしょうごまでにおねがいします。",
          "koreanPronunciation": "아시타노 쇼오고마데니 오네가이시마스.",
          "meaningKo": "내일 정오까지 부탁드려요."
        }
      },
      {
        "id": "company-general-confirm-report-plan",
        "titleKo": "보고 방식 확인하기",
        "goalKo": "확인한 뒤 메일로 결과를 알리겠다고 정리해요.",
        "learnerExample": {
          "japanese": "わかりました。確認してから、メールで結果をお知らせします。",
          "reading": "わかりました。かくにんしてから、めーるでけっかをおしらせします。",
          "koreanPronunciation": "와카리마시타. 카쿠닌시테카라, 메에루데 켁카오 오시라세시마스.",
          "meaningKo": "알겠습니다. 확인한 뒤 메일로 결과를 알려 드리겠습니다."
        },
        "fixedReply": {
          "japanese": "ありがとうございます。よろしくお願いします。",
          "reading": "ありがとうございます。よろしくおねがいします。",
          "koreanPronunciation": "아리가토오 고자이마스. 요로시쿠 오네가이시마스.",
          "meaningKo": "감사합니다. 잘 부탁드려요."
        },
        "hintKo": "「〜てから」로 행동의 순서를 말해요. 이 연습에서 문장을 보내도 실제 메일 전송이나 업무 약속은 생성되지 않아요.",
        "prompt": {
          "japanese": "日付と担当者の名前を確認してください。結果はメールでお願いします。",
          "reading": "ひづけとたんとうしゃのなまえをかくにんしてください。けっかはめーるでおねがいします。",
          "koreanPronunciation": "히즈케토 탄토오샤노 나마에오 카쿠닌시테 쿠다사이. 켁카와 메에루데 오네가이시마스.",
          "meaningKo": "날짜와 담당자 이름을 확인해 주세요. 결과는 메일로 부탁드려요."
        }
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
    "scriptRevision": "sha256:461090c88ad4e775fa5f99462fb3b636c0931159dfaa67ab0d3dbbe19ecf841d"
  },
  {
    "scriptId": "guided-company-general-intermediate",
    "contextId": "company-general",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "회사 · 일정 충돌을 설명하고 우선순위 확인",
    "situationKo": "가상의 팀에서 오늘 보고서를 마쳐야 하는데 급한 회의 자료 작성도 부탁받았어요. 동료와 우선순위와 기한을 조정하고 최종 합의를 되짚어요. 일정과 합의는 연습용이며 실제 업무 지시나 약속을 변경하지 않아요.",
    "goalsKo": [
      "오늘 마감인 보고서와 새 요청 중 무엇을 먼저 해야 하는지 물어요.",
      "보고서 기한을 내일 정오로 바꿀 수 있는지 물어요.",
      "새로 정한 두 작업의 기한이 맞는지 한 문장으로 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "company-general-explain-priority-conflict",
        "titleKo": "일정 충돌 설명하기",
        "goalKo": "오늘 마감인 보고서와 새 요청 중 무엇을 먼저 해야 하는지 물어요.",
        "learnerExample": {
          "japanese": "今日中に仕上げる報告書があるのですが、会議資料を先に進めたほうがよいでしょうか。",
          "reading": "きょうじゅうにしあげるほうこくしょがあるのですが、かいぎしりょうをさきにすすめたほうがよいでしょうか。",
          "koreanPronunciation": "쿄오주우니 시아게루 호오코쿠쇼가 아루노데스가, 카이기시료오오 사키니 스스메타 호오가 요이데쇼오카.",
          "meaningKo": "오늘 안에 마칠 보고서가 있는데 회의 자료를 먼저 진행하는 것이 좋을까요?"
        },
        "fixedReply": {
          "japanese": "はい、会議資料を優先してください。報告書の期限は調整できます。",
          "reading": "はい、かいぎしりょうをゆうせんしてください。ほうこくしょのきげんはちょうせいできます。",
          "koreanPronunciation": "하이, 카이기시료오오 유우센시테 쿠다사이. 호오코쿠쇼노 키겐와 초오세에데키마스.",
          "meaningKo": "네, 회의 자료를 우선해 주세요. 보고서 기한은 조정할 수 있습니다."
        },
        "hintKo": "기존 일정부터 설명한 뒤 「先に進めたほうがよいでしょうか」로 우선순위를 확인해요.",
        "prompt": {
          "japanese": "急ぎで、今日の会議資料も作成していただけますか。",
          "reading": "いそぎで、きょうのかいぎしりょうもさくせいしていただけますか。",
          "koreanPronunciation": "이소기데, 쿄오노 카이기시료오모 사쿠세에시테 이타다케마스카.",
          "meaningKo": "급하게 오늘 회의 자료도 작성해 주실 수 있을까요?"
        }
      },
      {
        "id": "company-general-propose-revised-deadline",
        "titleKo": "대체 기한 제안하기",
        "goalKo": "보고서 기한을 내일 정오로 바꿀 수 있는지 물어요.",
        "learnerExample": {
          "japanese": "それでしたら、報告書の提出期限を明日の正午まで延ばしていただけますか。",
          "reading": "それでしたら、ほうこくしょのていしゅつきげんをあしたのしょうごまでのばしていただけますか。",
          "koreanPronunciation": "소레데시타라, 호오코쿠쇼노 테에슈츠키겐오 아시타노 쇼오고마데 노바시테 이타다케마스카.",
          "meaningKo": "그렇다면 보고서 제출 기한을 내일 정오까지로 바꿔 주실 수 있을까요?"
        },
        "fixedReply": {
          "japanese": "はい、それでお願いします。会議資料は今日の三時までに必要です。",
          "reading": "はい、それでおねがいします。かいぎしりょうはきょうのさんじまでにひつようです。",
          "koreanPronunciation": "하이, 소레데 오네가이시마스. 카이기시료오와 쿄오노 산지마데니 히츠요오데스.",
          "meaningKo": "네, 그렇게 해 주세요. 회의 자료는 오늘 3시까지 필요합니다."
        },
        "hintKo": "「それでしたら」로 상대 답변을 받아 조건에 맞는 대안을 제안해요. 시간은 연습용 설정이에요.",
        "prompt": {
          "japanese": "はい、会議資料を優先してください。報告書の期限は調整できます。",
          "reading": "はい、かいぎしりょうをゆうせんしてください。ほうこくしょのきげんはちょうせいできます。",
          "koreanPronunciation": "하이, 카이기시료오오 유우센시테 쿠다사이. 호오코쿠쇼노 키겐와 초오세에데키마스.",
          "meaningKo": "네, 회의 자료를 우선해 주세요. 보고서 기한은 조정할 수 있습니다."
        }
      },
      {
        "id": "company-general-restate-agreed-plan",
        "titleKo": "두 기한을 함께 재확인하기",
        "goalKo": "새로 정한 두 작업의 기한이 맞는지 한 문장으로 확인해요.",
        "learnerExample": {
          "japanese": "確認ですが、会議資料は今日の三時まで、報告書は明日の正午までということでよろしいでしょうか。",
          "reading": "かくにんですが、かいぎしりょうはきょうのさんじまで、ほうこくしょはあしたのしょうごまでということでよろしいでしょうか。",
          "koreanPronunciation": "카쿠닌데스가, 카이기시료오와 쿄오노 산지마데, 호오코쿠쇼와 아시타노 쇼오고마데토 이우 코토데 요로시이데쇼오카.",
          "meaningKo": "확인하겠습니다. 회의 자료는 오늘 3시까지, 보고서는 내일 정오까지로 이해하면 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、その予定でお願いします。難しそうな場合は早めに相談してください。",
          "reading": "はい、そのよていでおねがいします。むずかしそうなばあいははやめにそうだんしてください。",
          "koreanPronunciation": "하이, 소노 요테에데 오네가이시마스. 무즈카시소오나 바아이와 하야메니 소오단시테 쿠다사이.",
          "meaningKo": "네, 그 일정으로 부탁드려요. 어려울 것 같으면 일찍 상의해 주세요."
        },
        "hintKo": "「〜ということでよろしいでしょうか」로 합의 내용을 정리해 확인해요. 고정 응답은 실제 일정 변경을 뜻하지 않아요.",
        "prompt": {
          "japanese": "はい、それでお願いします。会議資料は今日の三時までに必要です。",
          "reading": "はい、それでおねがいします。かいぎしりょうはきょうのさんじまでにひつようです。",
          "koreanPronunciation": "하이, 소레데 오네가이시마스. 카이기시료오와 쿄오노 산지마데니 히츠요오데스.",
          "meaningKo": "네, 그렇게 해 주세요. 회의 자료는 오늘 3시까지 필요합니다."
        }
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
    "scriptRevision": "sha256:93b0f940f4a1de380b6146dac0852411e886767fa9809eea2f24b6737b7d81bb"
  },
  {
    "scriptId": "guided-company-mechanical-design-beginner",
    "contextId": "company-mechanical-design",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "회사 · 기계설계 · 도면과 확인 대상 말하기",
    "situationKo": "가상의 설계팀 동료에게 도면을 부탁하고 그림에서 가리키는 치수를 확인한다고 말해요. 수치·공차·제작 조건을 판단하지 않는 언어 연습이에요. 실제 도면을 올리거나 입력할 필요가 없어요.",
    "goalsKo": [
      "도면을 보여 달라고 짧게 부탁해요.",
      "가리키는 치수를 확인하겠다고 말해요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "mechanical-request-drawing",
        "titleKo": "도면 요청하기",
        "goalKo": "도면을 보여 달라고 짧게 부탁해요.",
        "learnerExample": {
          "japanese": "図面を見せてください。",
          "reading": "ずめんをみせてください。",
          "koreanPronunciation": "즈멘오 미세테 쿠다사이.",
          "meaningKo": "도면을 보여 주세요."
        },
        "fixedReply": {
          "japanese": "こちらです。何を確認しますか。",
          "reading": "こちらです。なにをかくにんしますか。",
          "koreanPronunciation": "코치라데스. 나니오 카쿠닌시마스카.",
          "meaningKo": "여기 있습니다. 무엇을 확인하시나요?"
        },
        "hintKo": "「図面」는 도면이고 「見せてください」는 보여 달라는 부탁이에요.",
        "prompt": {
          "japanese": "どの資料が必要ですか。",
          "reading": "どのしりょうがひつようですか。",
          "koreanPronunciation": "도노 시료오가 히츠요오데스카.",
          "meaningKo": "어떤 자료가 필요한가요?"
        }
      },
      {
        "id": "mechanical-name-dimension",
        "titleKo": "확인 대상 말하기",
        "goalKo": "가리키는 치수를 확인하겠다고 말해요.",
        "learnerExample": {
          "japanese": "この寸法を確認します。",
          "reading": "このすんぽうをかくにんします。",
          "koreanPronunciation": "코노 슨포오오 카쿠닌시마스.",
          "meaningKo": "이 치수를 확인하겠습니다."
        },
        "fixedReply": {
          "japanese": "はい。この部分ですね。",
          "reading": "はい。このぶぶんですね。",
          "koreanPronunciation": "하이. 코노 부분데스네.",
          "meaningKo": "네. 이 부분이군요."
        },
        "hintKo": "「この寸法」는 이 치수라는 뜻이에요. 실제 치수의 적합성이나 안전성을 판정하는 문장이 아니에요.",
        "prompt": {
          "japanese": "こちらです。何を確認しますか。",
          "reading": "こちらです。なにをかくにんしますか。",
          "koreanPronunciation": "코치라데스. 나니오 카쿠닌시마스카.",
          "meaningKo": "여기 있습니다. 무엇을 확인하시나요?"
        }
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
    "scriptRevision": "sha256:0e291a53f3ef71f6ef77c0eb37d45dac7ca1f5e28560e3be4ef1dffe28ca184f"
  },
  {
    "scriptId": "guided-company-mechanical-design-elementary",
    "contextId": "company-mechanical-design",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "회사 · 기계설계 · 개정판과 표시 확인",
    "situationKo": "가상의 설계 검토에서 도면이 최신판인지, 바뀐 곳이 어디인지, 표시한 치수 단위가 무엇인지 물어요. 빨간 표시와 밀리미터 단위는 이 연습용 도면의 설정이에요. 실제 도면의 단위나 개정 상태를 추정하는 안내가 아니에요.",
    "goalsKo": [
      "건네받은 도면이 최신판인지 확인해요.",
      "어디가 바뀌었는지 물어요.",
      "해당 치수의 단위가 밀리미터인지 물어요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "mechanical-check-latest-revision",
        "titleKo": "도면 개정 상태 묻기",
        "goalKo": "건네받은 도면이 최신판인지 확인해요.",
        "learnerExample": {
          "japanese": "これは最新版の図面ですか。",
          "reading": "これはさいしんばんのずめんですか。",
          "koreanPronunciation": "코레와 사이신반노 즈멘데스카.",
          "meaningKo": "이것은 최신판 도면인가요?"
        },
        "fixedReply": {
          "japanese": "はい、最新版です。変更した箇所があります。",
          "reading": "はい、さいしんばんです。へんこうしたかしょがあります。",
          "koreanPronunciation": "하이, 사이신반데스. 헨코오시타 카쇼가 아리마스.",
          "meaningKo": "네, 최신판입니다. 변경한 곳이 있습니다."
        },
        "hintKo": "「最新版」는 최신판이에요. 검토할 자료의 판본을 먼저 확인하는 질문이에요.",
        "prompt": {
          "japanese": "こちらの図面を確認してください。",
          "reading": "こちらのずめんをかくにんしてください。",
          "koreanPronunciation": "코치라노 즈멘오 카쿠닌시테 쿠다사이.",
          "meaningKo": "이 도면을 확인해 주세요."
        }
      },
      {
        "id": "mechanical-locate-changes",
        "titleKo": "변경 부분 묻기",
        "goalKo": "어디가 바뀌었는지 물어요.",
        "learnerExample": {
          "japanese": "どの部分が変わりましたか。",
          "reading": "どのぶぶんがかわりましたか。",
          "koreanPronunciation": "도노 부분가 카와리마시타카.",
          "meaningKo": "어느 부분이 바뀌었나요?"
        },
        "fixedReply": {
          "japanese": "赤く示した部分です。ここの寸法が変わりました。",
          "reading": "あかくしめしたぶぶんです。ここのすんぽうがかわりました。",
          "koreanPronunciation": "아카쿠 시메시타 부분데스. 코코노 슨포오가 카와리마시타.",
          "meaningKo": "빨간색으로 표시한 부분입니다. 이곳의 치수가 바뀌었습니다."
        },
        "hintKo": "「変わりました」는 바뀌었다는 뜻이에요. 색상 표시 방식은 이 가상 자료에서만 정한 설정이에요.",
        "prompt": {
          "japanese": "はい、最新版です。変更した箇所があります。",
          "reading": "はい、さいしんばんです。へんこうしたかしょがあります。",
          "koreanPronunciation": "하이, 사이신반데스. 헨코오시타 카쇼가 아리마스.",
          "meaningKo": "네, 최신판입니다. 변경한 곳이 있습니다."
        }
      },
      {
        "id": "mechanical-confirm-unit",
        "titleKo": "치수 단위 확인하기",
        "goalKo": "해당 치수의 단위가 밀리미터인지 물어요.",
        "learnerExample": {
          "japanese": "この寸法の単位はミリメートルですか。",
          "reading": "このすんぽうのたんいはみりめーとるですか。",
          "koreanPronunciation": "코노 슨포오노 탄이와 미리메에토루데스카.",
          "meaningKo": "이 치수의 단위는 밀리미터인가요?"
        },
        "fixedReply": {
          "japanese": "はい、この寸法はミリメートルで記載しています。",
          "reading": "はい、このすんぽうはみりめーとるできさいしています。",
          "koreanPronunciation": "하이, 코노 슨포오와 미리메에토루데 키사이시테이마스.",
          "meaningKo": "네, 이 치수는 밀리미터로 기재하고 있습니다."
        },
        "hintKo": "「単位」는 단위예요. 도면의 단위를 임의로 가정하지 않고 확인하는 표현을 연습해요.",
        "prompt": {
          "japanese": "赤く示した部分です。ここの寸法が変わりました。",
          "reading": "あかくしめしたぶぶんです。ここのすんぽうがかわりました。",
          "koreanPronunciation": "아카쿠 시메시타 부분데스. 코코노 슨포오가 카와리마시타.",
          "meaningKo": "빨간색으로 표시한 부분입니다. 이곳의 치수가 바뀌었습니다."
        }
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
    "scriptRevision": "sha256:124209ba5e67d5628324a3a453245a0e493e8e6a5a20d41374121416e670324c"
  },
  {
    "scriptId": "guided-company-mechanical-design-intermediate",
    "contextId": "company-mechanical-design",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "회사 · 기계설계 · 자료 불일치와 검토 절차 확인",
    "situationKo": "가상의 검토에서 도면과 사양서의 치수 표기가 달라요. 담당자 확인 전에는 어느 쪽도 맞다고 단정하지 않고 공차 관련 자료와 다음 검토 순서를 물어요. 이 대화는 설계·가공·안전 기준을 정하지 않으며 실제 설계 변경을 지시하지 않아요.",
    "goalsKo": [
      "두 자료의 치수가 달라 어느 쪽을 기준으로 볼지 담당자 확인을 부탁해요.",
      "공차도 함께 확인할 수 있는 자료를 요청해요.",
      "담당자 답변과 자료를 받은 후 수정안을 검토받는 순서가 맞는지 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "mechanical-report-document-discrepancy",
        "titleKo": "자료 사이 차이 알리기",
        "goalKo": "두 자료의 치수가 달라 어느 쪽을 기준으로 볼지 담당자 확인을 부탁해요.",
        "learnerExample": {
          "japanese": "図面と仕様書で寸法が異なるため、どちらを基準にするか担当者に確認していただけますか。",
          "reading": "ずめんとしようしょですんぽうがことなるため、どちらをきじゅんにするかたんとうしゃにかくにんしていただけますか。",
          "koreanPronunciation": "즈멘토 시요오쇼데 슨포오가 코토나루타메, 도치라오 키준니 스루카 탄토오샤니 카쿠닌시테 이타다케마스카.",
          "meaningKo": "도면과 사양서의 치수가 달라서 어느 쪽을 기준으로 할지 담당자에게 확인해 주실 수 있을까요?"
        },
        "fixedReply": {
          "japanese": "はい、担当者に確認します。回答があるまでは変更を進めないでください。",
          "reading": "はい、たんとうしゃにかくにんします。かいとうがあるまではへんこうをすすめないでください。",
          "koreanPronunciation": "하이, 탄토오샤니 카쿠닌시마스. 카이토오가 아루마데와 헨코오오 스스메나이데 쿠다사이.",
          "meaningKo": "네, 담당자에게 확인하겠습니다. 답변이 있을 때까지는 변경을 진행하지 마세요."
        },
        "hintKo": "「〜ため」로 이유를 설명하고 「どちらを基準にするか」로 확인할 내용을 특정해요. 이 연습에서는 문서 우선순위를 임의로 정하지 않아요.",
        "prompt": {
          "japanese": "図面と仕様書の確認状況を教えてください。",
          "reading": "ずめんとしようしょのかくにんじょうきょうをおしえてください。",
          "koreanPronunciation": "즈멘토 시요오쇼노 카쿠닌조오쿄오오 오시에테 쿠다사이.",
          "meaningKo": "도면과 사양서의 확인 상황을 알려 주세요."
        }
      },
      {
        "id": "mechanical-request-tolerance-reference",
        "titleKo": "관련 근거 자료 요청하기",
        "goalKo": "공차도 함께 확인할 수 있는 자료를 요청해요.",
        "learnerExample": {
          "japanese": "承知しました。公差についても確認したいので、参照する資料を教えていただけますか。",
          "reading": "しょうちしました。こうさについてもかくにんしたいので、さんしょうするしりょうをおしえていただけますか。",
          "koreanPronunciation": "쇼오치시마시타. 코오사니 츠이테모 카쿠닌시타이노데, 산쇼오스루 시료오오 오시에테 이타다케마스카.",
          "meaningKo": "알겠습니다. 공차도 확인하고 싶으니 참고할 자료를 알려 주실 수 있을까요?"
        },
        "fixedReply": {
          "japanese": "公差の条件が記載された資料も、担当者に確認して共有します。",
          "reading": "こうさのじょうけんがきさいされたしりょうも、たんとうしゃにかくにんしてきょうゆうします。",
          "koreanPronunciation": "코오사노 조오켄가 키사이사레타 시료오모, 탄토오샤니 카쿠닌시테 쿄오유우시마스.",
          "meaningKo": "공차 조건이 기재된 자료도 담당자에게 확인해서 공유하겠습니다."
        },
        "hintKo": "「公差」는 공차, 「参照する資料」는 참고할 자료예요. 공차값이나 적용 기준을 만들어 넣지 않아요.",
        "prompt": {
          "japanese": "はい、担当者に確認します。回答があるまでは変更を進めないでください。",
          "reading": "はい、たんとうしゃにかくにんします。かいとうがあるまではへんこうをすすめないでください。",
          "koreanPronunciation": "하이, 탄토오샤니 카쿠닌시마스. 카이토오가 아루마데와 헨코오오 스스메나이데 쿠다사이.",
          "meaningKo": "네, 담당자에게 확인하겠습니다. 답변이 있을 때까지는 변경을 진행하지 마세요."
        }
      },
      {
        "id": "mechanical-confirm-review-before-change",
        "titleKo": "검토 순서 재확인하기",
        "goalKo": "담당자 답변과 자료를 받은 후 수정안을 검토받는 순서가 맞는지 확인해요.",
        "learnerExample": {
          "japanese": "では、回答と資料を受け取ってから修正案を作成し、反映する前に確認をお願いする流れでよろしいでしょうか。",
          "reading": "では、かいとうとしりょうをうけとってからしゅうせいあんをさくせいし、はんえいするまえにかくにんをおねがいするながれでよろしいでしょうか。",
          "koreanPronunciation": "데와, 카이토오토 시료오오 우케톳테카라 슈우세에안오 사쿠세에시, 한에이스루 마에니 카쿠닌오 오네가이스루 나가레데 요로시이데쇼오카.",
          "meaningKo": "그럼 답변과 자료를 받은 후 수정안을 만들고 반영하기 전에 확인을 부탁드리는 순서로 하면 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、その流れでお願いします。修正案の確認後に、反映する内容を決めましょう。",
          "reading": "はい、そのながれでおねがいします。しゅうせいあんのかくにんごに、はんえいするないようをきめましょう。",
          "koreanPronunciation": "하이, 소노 나가레데 오네가이시마스. 슈우세에안노 카쿠닌고니, 한에이스루 나이요오오 키메마쇼오.",
          "meaningKo": "네, 그 순서로 부탁드려요. 수정안을 확인한 뒤 반영할 내용을 정합시다."
        },
        "hintKo": "「〜てから」와 「〜前に」를 함께 써서 순서를 명확히 해요. 어떤 변경을 승인하거나 제작 가능성을 보장하는 응답은 아니에요.",
        "prompt": {
          "japanese": "公差の条件が記載された資料も、担当者に確認して共有します。",
          "reading": "こうさのじょうけんがきさいされたしりょうも、たんとうしゃにかくにんしてきょうゆうします。",
          "koreanPronunciation": "코오사노 조오켄가 키사이사레타 시료오모, 탄토오샤니 카쿠닌시테 쿄오유우시마스.",
          "meaningKo": "공차 조건이 기재된 자료도 담당자에게 확인해서 공유하겠습니다."
        }
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
    "scriptRevision": "sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa"
  },
  {
    "scriptId": "guided-company-development-beginner",
    "contextId": "company-development",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "회사 · 개발 · 담당 업무와 시제품",
    "situationKo": "가상의 제품 개발팀에서 자신이 개발 담당이라고 소개하고 시제품을 봐도 되는지 물어요. 사람·제품·자료는 모두 연습용이에요. 실제 기기 조작이나 개발 작업은 포함하지 않아요.",
    "goalsKo": [
      "개발을 담당한다고 짧게 소개해요.",
      "시제품을 봐도 되는지 물어요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "development-state-role",
        "titleKo": "담당 업무 말하기",
        "goalKo": "개발을 담당한다고 짧게 소개해요.",
        "learnerExample": {
          "japanese": "開発を担当しています。",
          "reading": "かいはつをたんとうしています。",
          "koreanPronunciation": "카이하츠오 탄토오시테이마스.",
          "meaningKo": "개발을 담당하고 있습니다."
        },
        "fixedReply": {
          "japanese": "よろしくお願いします。こちらが試作品です。",
          "reading": "よろしくおねがいします。こちらがしさくひんです。",
          "koreanPronunciation": "요로시쿠 오네가이시마스. 코치라가 시사쿠힌데스.",
          "meaningKo": "잘 부탁드립니다. 이것이 시제품입니다."
        },
        "hintKo": "업무 이름 뒤에 「を担当しています」를 붙여 자신이 맡은 일을 말해요.",
        "prompt": {
          "japanese": "ご担当を教えてください。",
          "reading": "ごたんとうをおしえてください。",
          "koreanPronunciation": "고탄토오오 오시에테 쿠다사이.",
          "meaningKo": "담당 업무를 알려 주세요."
        }
      },
      {
        "id": "development-ask-see-prototype",
        "titleKo": "시제품 보기 요청하기",
        "goalKo": "시제품을 봐도 되는지 물어요.",
        "learnerExample": {
          "japanese": "試作品を見てもいいですか。",
          "reading": "しさくひんをみてもいいですか。",
          "koreanPronunciation": "시사쿠힌오 미테모 이이데스카.",
          "meaningKo": "시제품을 봐도 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、どうぞ。こちらでご覧ください。",
          "reading": "はい、どうぞ。こちらでごらんください。",
          "koreanPronunciation": "하이, 도오조. 코치라데 고란쿠다사이.",
          "meaningKo": "네, 그러세요. 여기서 보세요."
        },
        "hintKo": "「試作品」는 시제품이에요. 「見てもいいですか」는 봐도 되는지 묻는 표현이며 조작 허가를 뜻하지 않아요.",
        "prompt": {
          "japanese": "よろしくお願いします。こちらが試作品です。",
          "reading": "よろしくおねがいします。こちらがしさくひんです。",
          "koreanPronunciation": "요로시쿠 오네가이시마스. 코치라가 시사쿠힌데스.",
          "meaningKo": "잘 부탁드립니다. 이것이 시제품입니다."
        }
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
    "scriptRevision": "sha256:077fe1b205adf6527f62448bb2fcdcb09c12c006e51df4993fd585246e73e09d"
  },
  {
    "scriptId": "guided-company-development-elementary",
    "contextId": "company-development",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "회사 · 개발 · 진행 상황과 확인할 점",
    "situationKo": "가상의 제품 개발팀에서 시제품의 동작 확인을 진행 중이에요. 시작할 때 예상보다 시간이 걸리는 현상을 짧게 알리고 확인할 사양을 물어요. 제품의 실제 성능·원인·해결책을 단정하지 않는 언어 연습이에요.",
    "goalsKo": [
      "지금 동작을 확인하고 있다고 말해요.",
      "시작하는 데 생각보다 시간이 걸린다고 말해요.",
      "어떤 사양서를 확인하면 되는지 물어요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "development-report-test-progress",
        "titleKo": "진행 상황 말하기",
        "goalKo": "지금 동작을 확인하고 있다고 말해요.",
        "learnerExample": {
          "japanese": "はい、今、動作を確認しています。",
          "reading": "はい、いま、どうさをかくにんしています。",
          "koreanPronunciation": "하이, 이마, 도오사오 카쿠닌시테이마스.",
          "meaningKo": "네, 지금 동작을 확인하고 있습니다."
        },
        "fixedReply": {
          "japanese": "何か気になる点はありますか。",
          "reading": "なにかきになるてんはありますか。",
          "koreanPronunciation": "나니카 키니 나루 텐와 아리마스카.",
          "meaningKo": "신경 쓰이는 점이 있나요?"
        },
        "hintKo": "「〜ています」로 현재 진행 중인 일을 말해요. 「動作」는 작동이나 움직임을 뜻해요.",
        "prompt": {
          "japanese": "試作品の確認は進んでいますか。",
          "reading": "しさくひんのかくにんはすすんでいますか。",
          "koreanPronunciation": "시사쿠힌노 카쿠닌와 스슨데이마스카.",
          "meaningKo": "시제품 확인은 진행되고 있나요?"
        }
      },
      {
        "id": "development-describe-startup-delay",
        "titleKo": "관찰한 현상 말하기",
        "goalKo": "시작하는 데 생각보다 시간이 걸린다고 말해요.",
        "learnerExample": {
          "japanese": "起動に思ったより時間がかかります。",
          "reading": "きどうにおもったよりじかんがかかります。",
          "koreanPronunciation": "키도오니 오못타요리 지칸가 카카리마스.",
          "meaningKo": "시작하는 데 생각보다 시간이 걸립니다."
        },
        "fixedReply": {
          "japanese": "わかりました。まず仕様を確認しましょう。",
          "reading": "わかりました。まずしようをかくにんしましょう。",
          "koreanPronunciation": "와카리마시타. 마즈 시요오오 카쿠닌시마쇼오.",
          "meaningKo": "알겠습니다. 먼저 사양을 확인합시다."
        },
        "hintKo": "「思ったより」는 생각했던 것보다라는 뜻이에요. 관찰을 말할 뿐 불량이나 원인을 확정하지 않아요.",
        "prompt": {
          "japanese": "何か気になる点はありますか。",
          "reading": "なにかきになるてんはありますか。",
          "koreanPronunciation": "나니카 키니 나루 텐와 아리마스카.",
          "meaningKo": "신경 쓰이는 점이 있나요?"
        }
      },
      {
        "id": "development-ask-specification-source",
        "titleKo": "확인할 자료 묻기",
        "goalKo": "어떤 사양서를 확인하면 되는지 물어요.",
        "learnerExample": {
          "japanese": "どの仕様書を確認すればいいですか。",
          "reading": "どのしようしょをかくにんすればいいですか。",
          "koreanPronunciation": "도노 시요오쇼오 카쿠닌스레바 이이데스카.",
          "meaningKo": "어떤 사양서를 확인하면 되나요?"
        },
        "fixedReply": {
          "japanese": "この試作品に対応する仕様書を一緒に確認しましょう。",
          "reading": "このしさくひんにたいおうするしようしょをいっしょにかくにんしましょう。",
          "koreanPronunciation": "코노 시사쿠힌니 타이오오스루 시요오쇼오 잇쇼니 카쿠닌시마쇼오.",
          "meaningKo": "이 시제품에 해당하는 사양서를 함께 확인합시다."
        },
        "hintKo": "「仕様書」는 사양서예요. 실제 허용 시간이나 제품 버전은 이 대화에서 정하지 않아요.",
        "prompt": {
          "japanese": "わかりました。まず仕様を確認しましょう。",
          "reading": "わかりました。まずしようをかくにんしましょう。",
          "koreanPronunciation": "와카리마시타. 마즈 시요오오 카쿠닌시마쇼오.",
          "meaningKo": "알겠습니다. 먼저 사양을 확인합시다."
        }
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
    "scriptRevision": "sha256:fe529450660ac9feb889f086ba71dabd7c5660cdd7de488d7fc2883e5f552249"
  },
  {
    "scriptId": "guided-company-development-intermediate",
    "contextId": "company-development",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "회사 · 개발 · 재현 조건과 미확인 원인 보고",
    "situationKo": "가상의 시제품 검증 회의예요. 여러 번 작동시켰을 때만 관찰된 멈춤 현상을 보고하고 원인은 아직 모른다고 구분해 말해요. 승인된 검증 절차 안에서 조건을 비교하는 기록 계획을 상의해요. 실제 장비 실험이나 안전 절차를 지시하는 내용은 아니에요.",
    "goalsKo": [
      "처음에는 괜찮았지만 반복 동작 중 멈춤을 관찰했다고 말해요.",
      "기록은 있지만 원인은 아직 확인하지 못했다고 말해요.",
      "재현된 조건과 재현되지 않은 조건을 구분해 보고할지 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "development-report-observed-condition",
        "titleKo": "관찰 조건 구분해 말하기",
        "goalKo": "처음에는 괜찮았지만 반복 동작 중 멈춤을 관찰했다고 말해요.",
        "learnerExample": {
          "japanese": "最初は問題ありませんでしたが、何度か動作させたときに止まる現象を確認しました。",
          "reading": "さいしょはもんだいありませんでしたが、なんどかどうささせたときにとまるげんしょうをかくにんしました。",
          "koreanPronunciation": "사이쇼와 몬다이 아리마센데시타가, 난도카 도오사사세타 토키니 토마루 겐쇼오오 카쿠닌시마시타.",
          "meaningKo": "처음에는 문제가 없었지만 몇 번 작동시켰을 때 멈추는 현상을 확인했습니다."
        },
        "fixedReply": {
          "japanese": "発生したときの条件は記録していますか。",
          "reading": "はっせいしたときのじょうけんはきろくしていますか。",
          "koreanPronunciation": "핫세에시타 토키노 조오켄와 키로쿠시테이마스카.",
          "meaningKo": "발생했을 때의 조건은 기록하고 있나요?"
        },
        "hintKo": "「〜ときに」로 관찰 시점을 구체적으로 말해요. 관찰한 조건이 곧 원인이라고 단정하는 표현은 아니에요.",
        "prompt": {
          "japanese": "昨日見つかった現象について、状況を説明していただけますか。",
          "reading": "きのうみつかったげんしょうについて、じょうきょうをせつめいしていただけますか。",
          "koreanPronunciation": "키노오 미츠캇타 겐쇼오니 츠이테, 조오쿄오오 세츠메에시테 이타다케마스카.",
          "meaningKo": "어제 발견된 현상에 대해 상황을 설명해 주실 수 있을까요?"
        }
      },
      {
        "id": "development-separate-evidence-and-cause",
        "titleKo": "기록과 추측 구분하기",
        "goalKo": "기록은 있지만 원인은 아직 확인하지 못했다고 말해요.",
        "learnerExample": {
          "japanese": "はい、条件と発生時刻は記録しています。ただ、原因はまだ特定できていません。",
          "reading": "はい、じょうけんとはっせいじこくはきろくしています。ただ、げんいんはまだとくていできていません。",
          "koreanPronunciation": "하이, 조오켄토 핫세에지코쿠와 키로쿠시테이마스. 타다, 겐인와 마다 토쿠테에데키테이마센.",
          "meaningKo": "네, 조건과 발생 시각은 기록하고 있습니다. 다만 원인은 아직 특정하지 못했습니다."
        },
        "fixedReply": {
          "japanese": "わかりました。承認済みの手順の範囲で、条件ごとの結果を整理しましょう。",
          "reading": "わかりました。しょうにんずみのてじゅんのはんいで、じょうけんごとのけっかをせいりしましょう。",
          "koreanPronunciation": "와카리마시타. 쇼오닌즈미노 테준노 한이데, 조오켄고토노 켁카오 세에리시마쇼오.",
          "meaningKo": "알겠습니다. 승인된 절차의 범위에서 조건별 결과를 정리합시다."
        },
        "hintKo": "「ただ」로 단서를 덧붙이고 「まだ特定できていません」로 미확인 상태를 분명히 해요.",
        "prompt": {
          "japanese": "発生したときの条件は記録していますか。",
          "reading": "はっせいしたときのじょうけんはきろくしていますか。",
          "koreanPronunciation": "핫세에시타 토키노 조오켄와 키로쿠시테이마스카.",
          "meaningKo": "발생했을 때의 조건은 기록하고 있나요?"
        }
      },
      {
        "id": "development-confirm-comparison-report",
        "titleKo": "다음 보고 내용 확인하기",
        "goalKo": "재현된 조건과 재현되지 않은 조건을 구분해 보고할지 확인해요.",
        "learnerExample": {
          "japanese": "再現した条件と再現しなかった条件を分けて整理し、次の打ち合わせで報告する形でよろしいでしょうか。",
          "reading": "さいげんしたじょうけんとさいげんしなかったじょうけんをわけてせいりし、つぎのうちあわせでほうこくするかたちでよろしいでしょうか。",
          "koreanPronunciation": "사이겐시타 조오켄토 사이겐시나캇타 조오켄오 와케테 세에리시, 츠기노 우치아와세데 호오코쿠스루 카타치데 요로시이데쇼오카.",
          "meaningKo": "재현된 조건과 재현되지 않은 조건을 나누어 정리하고 다음 회의에서 보고하는 방식으로 하면 될까요?"
        },
        "fixedReply": {
          "japanese": "はい。未確認の点も分けて記載してください。原因については、その結果を見て検討しましょう。",
          "reading": "はい。みかくにんのてんもわけてきさいしてください。げんいんについては、そのけっかをみてけんとうしましょう。",
          "koreanPronunciation": "하이. 미카쿠닌노 텐모 와케테 키사이시테 쿠다사이. 겐인니 츠이테와, 소노 켁카오 미테 켄토오시마쇼오.",
          "meaningKo": "네. 확인하지 못한 점도 구분해 기재해 주세요. 원인은 그 결과를 보고 검토합시다."
        },
        "hintKo": "「再現した／再現しなかった」로 두 상태를 나눠 말해요. 실제 원인 분석이나 수정 완료를 주장하지 않는 보고 표현이에요.",
        "prompt": {
          "japanese": "わかりました。承認済みの手順の範囲で、条件ごとの結果を整理しましょう。",
          "reading": "わかりました。しょうにんずみのてじゅんのはんいで、じょうけんごとのけっかをせいりしましょう。",
          "koreanPronunciation": "와카리마시타. 쇼오닌즈미노 테준노 한이데, 조오켄고토노 켁카오 세에리시마쇼오.",
          "meaningKo": "알겠습니다. 승인된 절차의 범위에서 조건별 결과를 정리합시다."
        }
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
    "scriptRevision": "sha256:6a8c204a6396d1d8f3018f213d878227590d96251910fa2b09ea38ea532c9264"
  },
  {
    "scriptId": "guided-company-quality-beginner",
    "contextId": "company-quality",
    "levelId": "beginner",
    "levelLabelKo": "왕초보",
    "labelKo": "회사 · 품질 · 결과표와 확인 항목",
    "situationKo": "가상의 품질팀에서 측정 결과표를 보여 달라고 하고 어떤 항목인지 물어요. 실제 측정값이나 합격 여부는 다루지 않아요. 기밀 자료를 입력할 필요가 없는 언어 연습이에요.",
    "goalsKo": [
      "측정 결과를 보여 달라고 부탁해요.",
      "가리키는 칸이 무엇을 측정한 결과인지 물어요."
    ],
    "completionNoteKo": "2단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "quality-request-results",
        "titleKo": "측정 결과 요청하기",
        "goalKo": "측정 결과를 보여 달라고 부탁해요.",
        "learnerExample": {
          "japanese": "測定結果を見せてください。",
          "reading": "そくていけっかをみせてください。",
          "koreanPronunciation": "소쿠테에켁카오 미세테 쿠다사이.",
          "meaningKo": "측정 결과를 보여 주세요."
        },
        "fixedReply": {
          "japanese": "はい、こちらの表です。",
          "reading": "はい、こちらのひょうです。",
          "koreanPronunciation": "하이, 코치라노 효오데스.",
          "meaningKo": "네, 이 표입니다."
        },
        "hintKo": "「測定結果」는 측정 결과예요. 「見せてください」로 보여 달라고 부탁해요.",
        "prompt": {
          "japanese": "どの資料を見ますか。",
          "reading": "どのしりょうをみますか。",
          "koreanPronunciation": "도노 시료오오 미마스카.",
          "meaningKo": "어떤 자료를 보시나요?"
        }
      },
      {
        "id": "quality-ask-measured-item",
        "titleKo": "측정 항목 묻기",
        "goalKo": "가리키는 칸이 무엇을 측정한 결과인지 물어요.",
        "learnerExample": {
          "japanese": "これは何の結果ですか。",
          "reading": "これはなんのけっかですか。",
          "koreanPronunciation": "코레와 난노 켁카데스카.",
          "meaningKo": "이것은 무엇의 결과인가요?"
        },
        "fixedReply": {
          "japanese": "長さを測った結果です。",
          "reading": "ながさをはかったけっかです。",
          "koreanPronunciation": "나가사오 하캇타 켁카데스.",
          "meaningKo": "길이를 측정한 결과입니다."
        },
        "hintKo": "「何の結果」로 어떤 항목에 대한 결과인지 물어요. 수치만 보고 합격·불합격을 정하는 연습은 아니에요.",
        "prompt": {
          "japanese": "はい、こちらの表です。",
          "reading": "はい、こちらのひょうです。",
          "koreanPronunciation": "하이, 코치라노 효오데스.",
          "meaningKo": "네, 이 표입니다."
        }
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
    "scriptRevision": "sha256:1b28ee02e6b75c2270ef92e79ec301e1f5210d3724396e9d47fc52bb0a0a3de8"
  },
  {
    "scriptId": "guided-company-quality-elementary",
    "contextId": "company-quality",
    "levelId": "elementary",
    "levelLabelKo": "초급",
    "labelKo": "회사 · 품질 · 측정 조건과 재확인 요청",
    "situationKo": "가상의 품질팀에서 측정 결과와 측정 조건이 함께 있는지 확인해요. 한 항목을 다시 측정해 달라고 하고 적용할 검사 기준 자료를 물어요. 구체적인 측정 방법·수치·합격 기준은 정하지 않아요.",
    "goalsKo": [
      "측정 조건도 적혀 있는지 물어요.",
      "가리키는 항목을 다시 측정해 달라고 부탁해요.",
      "검사 기준을 어느 자료에서 확인하는지 물어요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "quality-check-condition-record",
        "titleKo": "측정 조건 기재 확인하기",
        "goalKo": "측정 조건도 적혀 있는지 물어요.",
        "learnerExample": {
          "japanese": "測定条件も書いてありますか。",
          "reading": "そくていじょうけんもかいてありますか。",
          "koreanPronunciation": "소쿠테에조오켄모 카이테아리마스카.",
          "meaningKo": "측정 조건도 적혀 있나요?"
        },
        "fixedReply": {
          "japanese": "はい、結果の下に記載しています。",
          "reading": "はい、けっかのしたにきさいしています。",
          "koreanPronunciation": "하이, 켁카노 시타니 키사이시테이마스.",
          "meaningKo": "네, 결과 아래에 기재하고 있습니다."
        },
        "hintKo": "「〜てあります」로 기록되어 있는 상태를 물어요. 실제 기록 양식을 정하는 표현은 아니에요.",
        "prompt": {
          "japanese": "測定結果をまとめました。確認をお願いします。",
          "reading": "そくていけっかをまとめました。かくにんをおねがいします。",
          "koreanPronunciation": "소쿠테에켁카오 마토메마시타. 카쿠닌오 오네가이시마스.",
          "meaningKo": "측정 결과를 정리했습니다. 확인 부탁드려요."
        }
      },
      {
        "id": "quality-request-repeat-measurement",
        "titleKo": "한 항목 재측정 부탁하기",
        "goalKo": "가리키는 항목을 다시 측정해 달라고 부탁해요.",
        "learnerExample": {
          "japanese": "念のため、この項目をもう一度測ってください。",
          "reading": "ねんのため、このこうもくをもういちどはかってください。",
          "koreanPronunciation": "넨노 타메, 코노 코오모쿠오 모오 이치도 하캇테 쿠다사이.",
          "meaningKo": "확인을 위해 이 항목을 한 번 더 측정해 주세요."
        },
        "fixedReply": {
          "japanese": "わかりました。決められた手順で再測定します。",
          "reading": "わかりました。きめられたてじゅんでさいそくていします。",
          "koreanPronunciation": "와카리마시타. 키메라레타 테준데 사이소쿠테에시마스.",
          "meaningKo": "알겠습니다. 정해진 절차로 재측정하겠습니다."
        },
        "hintKo": "「念のため」는 만일에 대비해 확인한다는 뜻이에요. 실제 재측정은 해당 업무의 승인된 절차에 따라야 해요.",
        "prompt": {
          "japanese": "はい、結果の下に記載しています。",
          "reading": "はい、けっかのしたにきさいしています。",
          "koreanPronunciation": "하이, 켁카노 시타니 키사이시테이마스.",
          "meaningKo": "네, 결과 아래에 기재하고 있습니다."
        }
      },
      {
        "id": "quality-ask-inspection-reference",
        "titleKo": "대조할 기준 자료 묻기",
        "goalKo": "검사 기준을 어느 자료에서 확인하는지 물어요.",
        "learnerExample": {
          "japanese": "検査基準は、どの資料で確認できますか。",
          "reading": "けんさきじゅんは、どのしりょうでかくにんできますか。",
          "koreanPronunciation": "켄사키준와, 도노 시료오데 카쿠닌데키마스카.",
          "meaningKo": "검사 기준은 어떤 자료에서 확인할 수 있나요?"
        },
        "fixedReply": {
          "japanese": "この製品に適用する基準の資料を、担当者と確認しましょう。",
          "reading": "このせいひんにてきようするきじゅんのしりょうを、たんとうしゃとかくにんしましょう。",
          "koreanPronunciation": "코노 세에힌니 테키요오스루 키준노 시료오오, 탄토오샤토 카쿠닌시마쇼오.",
          "meaningKo": "이 제품에 적용하는 기준 자료를 담당자와 확인합시다."
        },
        "hintKo": "「検査基準」는 검사 기준이에요. 어느 기준이 적용되는지 담당자에게 확인하는 질문이며 판정은 하지 않아요.",
        "prompt": {
          "japanese": "わかりました。決められた手順で再測定します。",
          "reading": "わかりました。きめられたてじゅんでさいそくていします。",
          "koreanPronunciation": "와카리마시타. 키메라레타 테준데 사이소쿠테에시마스.",
          "meaningKo": "알겠습니다. 정해진 절차로 재측정하겠습니다."
        }
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
    "scriptRevision": "sha256:5072ae7dcd99bfec4209b8424ee58a55d76338099deec57b7e8375be6d143dad"
  },
  {
    "scriptId": "guided-company-quality-intermediate",
    "contextId": "company-quality",
    "levelId": "intermediate",
    "levelLabelKo": "중급",
    "labelKo": "회사 · 품질 · 결과 차이 보고와 판정 보류",
    "situationKo": "가상의 품질 검토에서 처음 측정한 결과와 다시 측정한 결과가 달라요. 측정 조건과 기록을 확인하고 판정은 담당자 검토까지 보류하는 흐름을 연습해요. 구체적인 기준·허용 오차·출하 승인·불합격 판단은 제공하지 않아요.",
    "goalsKo": [
      "처음 결과와 차이가 있어 아직 판정할 수 없다고 보고해요.",
      "두 번의 측정 조건과 사용 기기를 대조할 수 있도록 기록을 요청해요.",
      "차이를 정리해 검토받는 동안 판정을 보류한다고 기록할지 확인해요."
    ],
    "completionNoteKo": "3단계의 정해진 대화를 연습해요. 실제 업무·예약·주문 처리나 일본어 실력 평가는 아니에요. 어떤 문장을 보내도 상대의 응답은 정해진 예시예요.",
    "steps": [
      {
        "id": "quality-report-result-disagreement",
        "titleKo": "결과 차이와 판단 한계 말하기",
        "goalKo": "처음 결과와 차이가 있어 아직 판정할 수 없다고 보고해요.",
        "learnerExample": {
          "japanese": "最初の結果と差があるため、現時点では合否を判断できません。",
          "reading": "さいしょのけっかとさがあるため、げんじてんではごうひをはんだんできません。",
          "koreanPronunciation": "사이쇼노 켁카토 사가 아루타메, 겐지텐데와 고오히오 한단데키마센.",
          "meaningKo": "처음 결과와 차이가 있어서 현재로서는 합격 여부를 판단할 수 없습니다."
        },
        "fixedReply": {
          "japanese": "わかりました。まず測定条件と手順を確認しましょう。",
          "reading": "わかりました。まずそくていじょうけんとてじゅんをかくにんしましょう。",
          "koreanPronunciation": "와카리마시타. 마즈 소쿠테에조오켄토 테준오 카쿠닌시마쇼오.",
          "meaningKo": "알겠습니다. 먼저 측정 조건과 절차를 확인합시다."
        },
        "hintKo": "「現時点では」로 현재 확인 범위를 한정해요. 결과 차이만으로 어느 측정이 맞거나 제품이 불량이라고 단정하지 않아요.",
        "prompt": {
          "japanese": "再測定の結果はいかがでしたか。",
          "reading": "さいそくていのけっかはいかがでしたか。",
          "koreanPronunciation": "사이소쿠테에노 켁카와 이카가데시타카.",
          "meaningKo": "재측정 결과는 어땠나요?"
        }
      },
      {
        "id": "quality-request-record-comparison",
        "titleKo": "비교할 기록 요청하기",
        "goalKo": "두 번의 측정 조건과 사용 기기를 대조할 수 있도록 기록을 요청해요.",
        "learnerExample": {
          "japanese": "二回の測定条件と使用した機器を照合したいので、それぞれの記録を共有していただけますか。",
          "reading": "にかいのそくていじょうけんとしようしたききをしょうごうしたいので、それぞれのきろくをきょうゆうしていただけますか。",
          "koreanPronunciation": "니카이노 소쿠테에조오켄토 시요오시타 키키오 쇼오고오시타이노데, 소레조레노 키로쿠오 쿄오유우시테 이타다케마스카.",
          "meaningKo": "두 번의 측정 조건과 사용한 기기를 대조하고 싶으니 각각의 기록을 공유해 주실 수 있을까요?"
        },
        "fixedReply": {
          "japanese": "はい、両方の記録を用意します。不明な点は測定担当者に確認します。",
          "reading": "はい、りょうほうのきろくをよういします。ふめいなてんはそくていたんとうしゃにかくにんします。",
          "koreanPronunciation": "하이, 료오호오노 키로쿠오 요오이시마스. 후메에나 텐와 소쿠테에탄토오샤니 카쿠닌시마스.",
          "meaningKo": "네, 양쪽 기록을 준비하겠습니다. 불분명한 점은 측정 담당자에게 확인하겠습니다."
        },
        "hintKo": "「照合したいので」로 자료 요청의 목적을 설명해요. 기록 공유는 대화 속 예시일 뿐 실제 파일 전송은 없어요.",
        "prompt": {
          "japanese": "わかりました。まず測定条件と手順を確認しましょう。",
          "reading": "わかりました。まずそくていじょうけんとてじゅんをかくにんしましょう。",
          "koreanPronunciation": "와카리마시타. 마즈 소쿠테에조오켄토 테준오 카쿠닌시마쇼오.",
          "meaningKo": "알겠습니다. 먼저 측정 조건과 절차를 확인합시다."
        }
      },
      {
        "id": "quality-confirm-pending-decision",
        "titleKo": "검토 전 판정 상태 확인하기",
        "goalKo": "차이를 정리해 검토받는 동안 판정을 보류한다고 기록할지 확인해요.",
        "learnerExample": {
          "japanese": "差が出た点を整理して担当者の確認を受けるまでは、判定保留として記録する形でよろしいでしょうか。",
          "reading": "さがでたてんをせいりしてたんとうしゃのかくにんをうけるまでは、はんていほりゅうとしてきろくするかたちでよろしいでしょうか。",
          "koreanPronunciation": "사가 데타 텐오 세에리시테 탄토오샤노 카쿠닌오 우케루마데와, 한테에호류우토시테 키로쿠스루 카타치데 요로시이데쇼오카.",
          "meaningKo": "차이가 난 점을 정리해서 담당자의 확인을 받을 때까지는 판정 보류로 기록하는 방식으로 하면 될까요?"
        },
        "fixedReply": {
          "japanese": "はい、この例では判定保留として記録します。適用する基準と記録を確認してから、担当者が判断します。",
          "reading": "はい、このれいでははんていほりゅうとしてきろくします。てきようするきじゅんときろくをかくにんしてから、たんとうしゃがはんだんします。",
          "koreanPronunciation": "하이, 코노 레에데와 한테에호류우토시테 키로쿠시마스. 테키요오스루 키준토 키로쿠오 카쿠닌시테카라, 탄토오샤가 한단시마스.",
          "meaningKo": "네, 이 예시에서는 판정 보류로 기록합니다. 적용 기준과 기록을 확인한 후 담당자가 판단합니다."
        },
        "hintKo": "「〜までは」로 보류 기간의 끝 조건을 말해요. 「判定保留」는 판정을 잠시 보류한다는 뜻이며 실제 조직의 처리 규칙을 대신하지 않아요.",
        "prompt": {
          "japanese": "はい、両方の記録を用意します。不明な点は測定担当者に確認します。",
          "reading": "はい、りょうほうのきろくをよういします。ふめいなてんはそくていたんとうしゃにかくにんします。",
          "koreanPronunciation": "하이, 료오호오노 키로쿠오 요오이시마스. 후메에나 텐와 소쿠테에탄토오샤니 카쿠닌시마스.",
          "meaningKo": "네, 양쪽 기록을 준비하겠습니다. 불분명한 점은 측정 담당자에게 확인하겠습니다."
        }
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
    "scriptRevision": "sha256:525fe4c01d580121d882fb7d5414d97b0f0bad11a00f6f536b8347d80734482f"
  }
] as const);

export type GuidedConversationRegistration = Readonly<{
  sourceVersion: 1; catalogVersion: string; builderPolicy: string; matchPolicy: typeof GUIDED_SAMPLE_MATCH_POLICY;
  contextId: FreeConversationContextId; scriptId: string; scriptRevision: string; label: string;
  levelId: FreeConversationLevelId; levelLabelKo: string;
  contentSource: Readonly<{ kind: 'authored-guided-conversation'; module: 'data/guidedConversationPilot.ts' | 'data/guidedConversationCatalog.ts'; exportName: 'GUIDED_CONVERSATION_PILOT' | 'GUIDED_CONVERSATION_REMAINING'; entryKey: string; revision: string }>;
  content: GuidedCatalogueScript;
}>;
function registration(content: GuidedCatalogueScript, pilot: boolean): GuidedConversationRegistration {
  return immutable({ sourceVersion: 1, catalogVersion: pilot ? GUIDED_CONVERSATION_CATALOG_VERSION : GUIDED_CATALOGUE_VERSION,
    builderPolicy: pilot ? GUIDED_RESPONSE_POLICY : GUIDED_CATALOGUE_RESPONSE_POLICY, matchPolicy: GUIDED_SAMPLE_MATCH_POLICY,
    contextId: content.contextId, scriptId: content.scriptId, scriptRevision: content.scriptRevision, label: content.labelKo,
    levelId: content.levelId, levelLabelKo: content.levelLabelKo,
    contentSource: { kind: 'authored-guided-conversation', module: pilot ? 'data/guidedConversationPilot.ts' : 'data/guidedConversationCatalog.ts',
      exportName: pilot ? 'GUIDED_CONVERSATION_PILOT' : 'GUIDED_CONVERSATION_REMAINING', entryKey: content.scriptId, revision: content.scriptRevision }, content });
}
/** All retained revisions, including predecessors. Never infer current from order. */
export const GUIDED_CONVERSATION_REGISTRATIONS: readonly GuidedConversationRegistration[] = immutable([
  ...GUIDED_CONVERSATION_PILOT.map(script => registration(script, true)),
  ...GUIDED_CONVERSATION_REMAINING.map(script => registration(script, false)),
]);

/** Explicit current pointers; new authoring retains prior registrations separately. */
export const GUIDED_CONVERSATION_CURRENT = immutable([
  {"contextId": "convenience-store", "levelId": "beginner", "scriptId": "guided-convenience-store-beginner", "scriptRevision": "sha256:4d72bba976fc0aa52a7f4913b4f08d9e8a9be1022c057e19bfeb1a90f5e4989a"},
  {"contextId": "convenience-store", "levelId": "elementary", "scriptId": "guided-convenience-store-elementary", "scriptRevision": "sha256:fb7841b7c9311d429ac7dddfc0b7cf1b3d2b97d4ff237cff5d5718cae213e99c"},
  {"contextId": "convenience-store", "levelId": "intermediate", "scriptId": "guided-convenience-store-intermediate", "scriptRevision": "sha256:9f45d6a111675b171beceb596f56fad136321478657d8797d1155c5fcb2f329c"},
  {"contextId": "restaurant", "levelId": "beginner", "scriptId": "guided-restaurant-beginner", "scriptRevision": "sha256:f536c29078f567a5cc5dde12754c4e8cd406197b4daf91ff4881536fd6a0c9d3"},
  {"contextId": "restaurant", "levelId": "elementary", "scriptId": "guided-restaurant-elementary", "scriptRevision": "sha256:ad272787da4fac2df9f60d19d71c665d641dc9ec51073a137dd2ece1796c5179"},
  {"contextId": "restaurant", "levelId": "intermediate", "scriptId": "guided-restaurant-intermediate", "scriptRevision": "sha256:727bd90a1981f853c2d0b2a7b4e6fc8d4a1f8cd9e2088ade9a0aa410d65d636a"},
  {"contextId": "hotel", "levelId": "beginner", "scriptId": "guided-hotel-beginner", "scriptRevision": "sha256:b75b4811dad73bfffdf8056a0667f95f8972a0565967eff27c4841f991ee0d02"},
  {"contextId": "hotel", "levelId": "elementary", "scriptId": "guided-hotel-elementary", "scriptRevision": "sha256:852ff666451fda9ca741a2c67753e9b72867fd3b1b1e2ca9bf9653b77e96e0cd"},
  {"contextId": "hotel", "levelId": "intermediate", "scriptId": "guided-hotel-intermediate", "scriptRevision": "sha256:9ad1fdd0c5da4bb905f729d7629bacec264a4e7d4bc04946caec83eb8aaeea63"},
  {"contextId": "train", "levelId": "beginner", "scriptId": "guided-train-beginner", "scriptRevision": "sha256:19f448ba6fa10f54e1f579e55a7541fc98d94505eb9fbbc3261a41fc8c50753e"},
  {"contextId": "train", "levelId": "elementary", "scriptId": "guided-train-elementary", "scriptRevision": "sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085"},
  {"contextId": "train", "levelId": "intermediate", "scriptId": "guided-train-intermediate", "scriptRevision": "sha256:d5178b284e4d0d1d89a56be77a34e71923916b6a2dcf866e976f115a6bce11a5"},
  {"contextId": "company-general", "levelId": "beginner", "scriptId": "guided-company-general-beginner", "scriptRevision": "sha256:fe229227b1667f00beb7c603067db8239f2bb3eefa3ec28df04957096ba3eae6"},
  {"contextId": "company-general", "levelId": "elementary", "scriptId": "guided-company-general-elementary", "scriptRevision": "sha256:461090c88ad4e775fa5f99462fb3b636c0931159dfaa67ab0d3dbbe19ecf841d"},
  {"contextId": "company-general", "levelId": "intermediate", "scriptId": "guided-company-general-intermediate", "scriptRevision": "sha256:93b0f940f4a1de380b6146dac0852411e886767fa9809eea2f24b6737b7d81bb"},
  {"contextId": "company-mechanical-design", "levelId": "beginner", "scriptId": "guided-company-mechanical-design-beginner", "scriptRevision": "sha256:0e291a53f3ef71f6ef77c0eb37d45dac7ca1f5e28560e3be4ef1dffe28ca184f"},
  {"contextId": "company-mechanical-design", "levelId": "elementary", "scriptId": "guided-company-mechanical-design-elementary", "scriptRevision": "sha256:124209ba5e67d5628324a3a453245a0e493e8e6a5a20d41374121416e670324c"},
  {"contextId": "company-mechanical-design", "levelId": "intermediate", "scriptId": "guided-company-mechanical-design-intermediate", "scriptRevision": "sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa"},
  {"contextId": "company-development", "levelId": "beginner", "scriptId": "guided-company-development-beginner", "scriptRevision": "sha256:077fe1b205adf6527f62448bb2fcdcb09c12c006e51df4993fd585246e73e09d"},
  {"contextId": "company-development", "levelId": "elementary", "scriptId": "guided-company-development-elementary", "scriptRevision": "sha256:fe529450660ac9feb889f086ba71dabd7c5660cdd7de488d7fc2883e5f552249"},
  {"contextId": "company-development", "levelId": "intermediate", "scriptId": "guided-company-development-intermediate", "scriptRevision": "sha256:6a8c204a6396d1d8f3018f213d878227590d96251910fa2b09ea38ea532c9264"},
  {"contextId": "company-quality", "levelId": "beginner", "scriptId": "guided-company-quality-beginner", "scriptRevision": "sha256:1b28ee02e6b75c2270ef92e79ec301e1f5210d3724396e9d47fc52bb0a0a3de8"},
  {"contextId": "company-quality", "levelId": "elementary", "scriptId": "guided-company-quality-elementary", "scriptRevision": "sha256:5072ae7dcd99bfec4209b8424ee58a55d76338099deec57b7e8375be6d143dad"},
  {"contextId": "company-quality", "levelId": "intermediate", "scriptId": "guided-company-quality-intermediate", "scriptRevision": "sha256:525fe4c01d580121d882fb7d5414d97b0f0bad11a00f6f536b8347d80734482f"}
] as const);
export function findGuidedConversationRegistration(scriptId: string, scriptRevision: string): GuidedConversationRegistration | undefined {
  return GUIDED_CONVERSATION_REGISTRATIONS.find(source => source.scriptId === scriptId && source.scriptRevision === scriptRevision);
}
export function findGuidedConversationCatalogScript(scriptId: string, scriptRevision: string): GuidedCatalogueScript | undefined {
  return findGuidedConversationRegistration(scriptId, scriptRevision)?.content;
}
export function findCurrentGuidedConversation(contextId: string, levelId: string): GuidedConversationRegistration | undefined {
  const pointer = GUIDED_CONVERSATION_CURRENT.find(item => item.contextId === contextId && item.levelId === levelId);
  if (!pointer) return undefined;
  const source = findGuidedConversationRegistration(pointer.scriptId, pointer.scriptRevision);
  return source?.contextId === contextId && source.levelId === levelId ? source : undefined;
}
/** Original pilot hashes stay pinned globally; new hashes are namespace-specific.
 * Formerly opaque old-shaped revisions must not acquire new historical meaning. */
export function findKnownGuidedConversationRevision(module: string, exportName: string, revision: string): GuidedConversationRegistration | undefined {
  return GUIDED_CONVERSATION_REGISTRATIONS.find(source => source.scriptRevision === revision &&
    (source.contentSource.module === 'data/guidedConversationPilot.ts' || (source.contentSource.module === module && source.contentSource.exportName === exportName)));
}
/** Display only; a label is never source admission or write authority. */
export function guidedConversationRoleLabel(builderPolicy: string): string {
  return builderPolicy === GUIDED_RESPONSE_POLICY ? '점원' : '상대방';
}
