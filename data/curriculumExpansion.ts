import type { CurriculumLesson } from "./curriculum";

const lesson = (value: CurriculumLesson) => value;

export const EXPANDED_CURRICULUM: CurriculumLesson[] = [
  lesson({
    id:"f09",track:"foundation",order:9,title:"어제 한 일 말하기",goal:"정중한 과거형으로 어제 한 일을 말해요.",minutes:10,
    words:[{japanese:"行きました",reading:"いきました",meaning:"갔습니다"},{japanese:"食べました",reading:"たべました",meaning:"먹었습니다"},{japanese:"見ました",reading:"みました",meaning:"봤습니다"}],
    pattern:{label:"～ました",explanation:"동사의 ます를 ました로 바꾸면 정중한 과거가 돼요.",example:"昨日、資料を見ました。",meaning:"어제 자료를 봤습니다."},
    dialogue:[{speaker:"A",japanese:"昨日、何をしましたか。",reading:"きのう、なにをしましたか。",meaning:"어제 무엇을 했나요?"},{speaker:"B",japanese:"会社で資料を見ました。",reading:"かいしゃでしりょうをみました。",meaning:"회사에서 자료를 봤습니다."}],speak:"昨日、会社で資料を見ました。",
    quiz:[{prompt:"‘먹었습니다’는?",choices:["食べます","食べました","食べません"],answer:1,explanation:"～ました는 정중한 과거형이에요."},{prompt:"‘어제 무엇을 했나요?’는?",choices:["昨日、何をしましたか。","明日、何をしますか。","何時ですか。"],answer:0,explanation:"昨日와 しましたか를 함께 써요."}],
  }),
  lesson({
    id:"f10",track:"foundation",order:10,title:"맛과 상태 표현하기",goal:"い형용사와 な형용사로 느낌을 말해요.",minutes:10,
    words:[{japanese:"おいしい",reading:"おいしい",meaning:"맛있다"},{japanese:"高い",reading:"たかい",meaning:"비싸다, 높다"},{japanese:"静か",reading:"しずか",meaning:"조용하다"}],
    pattern:{label:"형용사 + です",explanation:"い형용사는 그대로, な형용사는 명사 앞에서 な를 붙여요.",example:"この店は静かです。",meaning:"이 가게는 조용합니다."},
    dialogue:[{speaker:"A",japanese:"この料理はどうですか。",reading:"このりょうりはどうですか。",meaning:"이 요리는 어때요?"},{speaker:"B",japanese:"とてもおいしいです。",reading:"とてもおいしいです。",meaning:"매우 맛있습니다."}],speak:"この料理はおいしいですが、少し高いです。",
    quiz:[{prompt:"‘매우 맛있습니다’는?",choices:["とてもおいしいです。","とても静かです。","少し高くないです。"],answer:0,explanation:"とても는 ‘매우’라는 뜻이에요."},{prompt:"‘조용한 가게’는?",choices:["静か店","静かな店","静かい店"],answer:1,explanation:"な형용사는 명사 앞에서 な를 붙여요."}],
  }),
  lesson({
    id:"f11",track:"foundation",order:11,title:"빈도와 습관 말하기",goal:"얼마나 자주 하는지 말하고 물어요.",minutes:10,
    words:[{japanese:"毎日",reading:"まいにち",meaning:"매일"},{japanese:"時々",reading:"ときどき",meaning:"가끔"},{japanese:"週に二回",reading:"しゅうににかい",meaning:"일주일에 두 번"}],
    pattern:{label:"기간 + に + 횟수",explanation:"일정한 기간 동안 몇 번 하는지 나타내요.",example:"週に二回運動します。",meaning:"일주일에 두 번 운동합니다."},
    dialogue:[{speaker:"A",japanese:"どのくらい日本語を勉強しますか。",reading:"どのくらいにほんごをべんきょうしますか。",meaning:"얼마나 자주 일본어를 공부하나요?"},{speaker:"B",japanese:"毎日十分勉強します。",reading:"まいにちじゅっぷんべんきょうします。",meaning:"매일 10분 공부합니다."}],speak:"毎日十分、日本語を勉強します。",
    quiz:[{prompt:"‘일주일에 두 번’은?",choices:["週に二回","二週間","毎週二時"],answer:0,explanation:"기간 + に + 횟수 순서예요."},{prompt:"‘가끔’은?",choices:["毎日","時々","全然"],answer:1,explanation:"時々는 가끔이라는 뜻이에요."}],
  }),
  lesson({
    id:"f12",track:"foundation",order:12,title:"둘을 비교하기",goal:"두 대상을 비교하고 더 좋은 것을 골라요.",minutes:10,
    words:[{japanese:"より",reading:"より",meaning:"~보다"},{japanese:"ほうが",reading:"ほうが",meaning:"~쪽이"},{japanese:"どちら",reading:"どちら",meaning:"어느 쪽"}],
    pattern:{label:"AよりBのほうが～",explanation:"A보다 B 쪽이 어떻다고 비교해요.",example:"電車よりバスのほうが安いです。",meaning:"전철보다 버스가 더 저렴합니다."},
    dialogue:[{speaker:"A",japanese:"電車とバスと、どちらが速いですか。",reading:"でんしゃとバスと、どちらがはやいですか。",meaning:"전철과 버스 중 어느 쪽이 빠른가요?"},{speaker:"B",japanese:"電車のほうが速いです。",reading:"でんしゃのほうがはやいです。",meaning:"전철이 더 빠릅니다."}],speak:"バスより電車のほうが速いです。",
    quiz:[{prompt:"두 가지 중 ‘어느 쪽’은?",choices:["どこ","どちら","どのくらい"],answer:1,explanation:"どちら는 두 대상 중 어느 쪽인지 물어요."},{prompt:"‘전철이 더 빠릅니다’는?",choices:["電車のほうが速いです。","電車より遅いです。","電車はどちらです。"],answer:0,explanation:"Bのほうが로 B 쪽이 더 그렇다고 말해요."}],
  }),
  lesson({
    id:"w09",track:"work",order:9,title:"설계 변경 요청",goal:"변경 이유와 원하는 내용을 정중하게 전달해요.",minutes:10,
    words:[{japanese:"変更",reading:"へんこう",meaning:"변경"},{japanese:"修正",reading:"しゅうせい",meaning:"수정"},{japanese:"可能",reading:"かのう",meaning:"가능"}],
    pattern:{label:"～していただけますか",explanation:"업무 상대에게 행동을 매우 정중하게 요청해요.",example:"寸法を修正していただけますか。",meaning:"치수를 수정해 주실 수 있을까요?"},
    dialogue:[{speaker:"A",japanese:"図面の変更は可能でしょうか。",reading:"ずめんのへんこうはかのうでしょうか。",meaning:"도면 변경이 가능할까요?"},{speaker:"B",japanese:"変更内容を確認いたします。",reading:"へんこうないようをかくにんいたします。",meaning:"변경 내용을 확인하겠습니다."}],speak:"恐れ入りますが、この寸法を修正していただけますか。",
    quiz:[{prompt:"정중한 수정 요청은?",choices:["修正します。","修正していただけますか。","修正しません。"],answer:1,explanation:"～していただけますか는 매우 정중한 요청이에요."},{prompt:"‘변경 내용을 확인하겠습니다’는?",choices:["変更内容を確認いたします。","変更内容を発送します。","変更内容が壊れました。"],answer:0,explanation:"確認いたします는 겸양 표현이에요."}],
  }),
  lesson({
    id:"w10",track:"work",order:10,title:"회의에서 의견 말하기",goal:"동의·우려·대안을 부드럽게 말해요.",minutes:10,
    words:[{japanese:"賛成",reading:"さんせい",meaning:"찬성"},{japanese:"懸念",reading:"けねん",meaning:"우려"},{japanese:"提案",reading:"ていあん",meaning:"제안"}],
    pattern:{label:"～と考えています",explanation:"단정하지 않고 자신의 판단을 업무적으로 전달해요.",example:"再確認が必要だと考えています。",meaning:"재확인이 필요하다고 생각합니다."},
    dialogue:[{speaker:"A",japanese:"この案についてどう思いますか。",reading:"このあんについてどうおもいますか。",meaning:"이 안에 대해 어떻게 생각하세요?"},{speaker:"B",japanese:"基本的には賛成ですが、納期に懸念があります。",reading:"きほんてきにはさんせいですが、のうきにけねんがあります。",meaning:"기본적으로 찬성하지만 납기가 우려됩니다."}],speak:"基本的には賛成ですが、もう一度確認が必要だと考えています。",
    quiz:[{prompt:"부드럽게 판단을 말하는 표현은?",choices:["～と考えています","～に違いない","絶対です"],answer:0,explanation:"～と考えています는 업무상 의견 전달에 적합해요."},{prompt:"‘우려가 있습니다’는?",choices:["懸念があります。","提案を発送します。","賛成が壊れました。"],answer:0,explanation:"懸念があります는 우려 사항을 말해요."}],
  }),
  lesson({
    id:"w11",track:"work",order:11,title:"업무 전화 응대",goal:"담당자를 찾고 부재 메시지를 남겨요.",minutes:10,
    words:[{japanese:"お電話",reading:"おでんわ",meaning:"전화"},{japanese:"席を外す",reading:"せきをはずす",meaning:"자리를 비우다"},{japanese:"伝言",reading:"でんごん",meaning:"전언"}],
    pattern:{label:"～はいらっしゃいますか",explanation:"회사에서 담당자가 있는지 정중하게 물어요.",example:"鈴木様はいらっしゃいますか。",meaning:"스즈키 님 계신가요?"},
    dialogue:[{speaker:"A",japanese:"鈴木様はいらっしゃいますか。",reading:"すずきさまはいらっしゃいますか。",meaning:"스즈키 님 계신가요?"},{speaker:"B",japanese:"ただ今、席を外しております。",reading:"ただいま、せきをはずしております。",meaning:"지금 자리를 비우셨습니다."}],speak:"戻られましたら、お電話をいただけるようお伝えください。",
    quiz:[{prompt:"담당자가 있는지 정중히 묻는 말은?",choices:["鈴木様はありますか。","鈴木様はいらっしゃいますか。","鈴木様をください。"],answer:1,explanation:"いらっしゃいますか는 いますか의 존경 표현이에요."},{prompt:"‘자리를 비우고 있습니다’는?",choices:["席を外しております。","席を送っております。","席を確認しました。"],answer:0,explanation:"席を外す는 잠시 자리를 비운다는 뜻이에요."}],
  }),
  lesson({
    id:"w12",track:"work",order:12,title:"정중한 메일 마무리",goal:"첨부·회신 요청과 감사 인사를 자연스럽게 써요.",minutes:10,
    words:[{japanese:"添付",reading:"てんぷ",meaning:"첨부"},{japanese:"ご確認",reading:"ごかくにん",meaning:"확인"},{japanese:"ご返信",reading:"ごへんしん",meaning:"회신"}],
    pattern:{label:"お手数ですが～",explanation:"상대에게 수고를 부탁할 때 앞에 붙이는 완곡한 표현이에요.",example:"お手数ですが、ご確認をお願いいたします。",meaning:"번거로우시겠지만 확인 부탁드립니다."},
    dialogue:[{speaker:"A",japanese:"評価結果を添付いたしました。",reading:"ひょうかけっかをてんぷいたしました。",meaning:"평가 결과를 첨부했습니다."},{speaker:"B",japanese:"確認後、ご返信いたします。",reading:"かくにんご、ごへんしんいたします。",meaning:"확인 후 회신드리겠습니다."}],speak:"お手数ですが、添付資料をご確認いただけますと幸いです。",
    quiz:[{prompt:"메일의 정중한 확인 요청은?",choices:["確認してください。","お手数ですが、ご確認をお願いいたします。","確認しません。"],answer:1,explanation:"お手数ですが를 붙이면 부담을 배려하는 요청이 돼요."},{prompt:"‘첨부했습니다’는?",choices:["添付いたしました。","添付があります。","添付を待ちます。"],answer:0,explanation:"添付いたしました는 정중한 완료 보고예요."}],
  }),
  lesson({
    id:"t09",track:"travel",order:9,title:"환승과 교통카드",goal:"환승 위치와 교통카드 사용법을 물어요.",minutes:10,
    words:[{japanese:"乗り換え",reading:"のりかえ",meaning:"환승"},{japanese:"改札",reading:"かいさつ",meaning:"개찰구"},{japanese:"交通系ICカード",reading:"こうつうけいアイシーカード",meaning:"교통 IC카드"}],
    pattern:{label:"どこで～ますか",explanation:"어떤 행동을 하는 장소를 물어요.",example:"どこで乗り換えますか。",meaning:"어디에서 환승하나요?"},
    dialogue:[{speaker:"A",japanese:"新宿へはどこで乗り換えますか。",reading:"しんじゅくへはどこでのりかえますか。",meaning:"신주쿠에는 어디에서 환승하나요?"},{speaker:"B",japanese:"次の駅で乗り換えてください。",reading:"つぎのえきでのりかえてください。",meaning:"다음 역에서 환승하세요."}],speak:"このカードはどこでチャージできますか。",
    quiz:[{prompt:"‘환승’은?",choices:["乗り換え","改札","予約"],answer:0,explanation:"乗り換え는 다른 교통편으로 갈아타는 일이에요."},{prompt:"행동 장소를 묻는 조사는?",choices:["で","を","と"],answer:0,explanation:"행동이 이루어지는 장소는 で로 표시해요."}],
  }),
  lesson({
    id:"t10",track:"travel",order:10,title:"예약 변경과 취소",goal:"예약 시간·인원을 변경하거나 취소해요.",minutes:10,
    words:[{japanese:"変更",reading:"へんこう",meaning:"변경"},{japanese:"キャンセル",reading:"キャンセル",meaning:"취소"},{japanese:"予約番号",reading:"よやくばんごう",meaning:"예약 번호"}],
    pattern:{label:"～たいのですが",explanation:"원하는 일을 바로 명령하지 않고 부드럽게 상담해요.",example:"予約を変更したいのですが。",meaning:"예약을 변경하고 싶은데요."},
    dialogue:[{speaker:"A",japanese:"予約時間を変更したいのですが。",reading:"よやくじかんをへんこうしたいのですが。",meaning:"예약 시간을 변경하고 싶은데요."},{speaker:"B",japanese:"予約番号をお願いします。",reading:"よやくばんごうをおねがいします。",meaning:"예약 번호를 부탁드립니다."}],speak:"明日の予約を三時に変更したいのですが。",
    quiz:[{prompt:"부드러운 변경 요청은?",choices:["変更します。","変更したいのですが。","変更しません。"],answer:1,explanation:"～たいのですが는 희망을 부드럽게 꺼내요."},{prompt:"‘예약 번호’는?",choices:["予約番号","電話番号","部屋番号"],answer:0,explanation:"予約番号는 예약을 식별하는 번호예요."}],
  }),
  lesson({
    id:"t11",track:"travel",order:11,title:"면세와 포장 요청",goal:"면세 여부를 확인하고 포장을 부탁해요.",minutes:10,
    words:[{japanese:"免税",reading:"めんぜい",meaning:"면세"},{japanese:"包装",reading:"ほうそう",meaning:"포장"},{japanese:"別々",reading:"べつべつ",meaning:"따로따로"}],
    pattern:{label:"～にしていただけますか",explanation:"상태나 방식이 그렇게 되도록 정중히 요청해요.",example:"別々の袋にしていただけますか。",meaning:"봉투를 따로 해 주실 수 있나요?"},
    dialogue:[{speaker:"A",japanese:"これは免税になりますか。",reading:"これはめんぜいになりますか。",meaning:"이것은 면세가 되나요?"},{speaker:"B",japanese:"はい、パスポートを見せてください。",reading:"はい、パスポートをみせてください。",meaning:"네, 여권을 보여 주세요."}],speak:"プレゼントなので、包装していただけますか。",
    quiz:[{prompt:"‘면세’는?",choices:["免税","会計","試着"],answer:0,explanation:"免税는 일정 조건에서 세금을 면제하는 것이에요."},{prompt:"‘포장해 주실 수 있나요?’는?",choices:["包装がありますか。","包装していただけますか。","包装を食べますか。"],answer:1,explanation:"～していただけますか는 정중한 부탁이에요."}],
  }),
  lesson({
    id:"t12",track:"travel",order:12,title:"긴급 상황 설명",goal:"경찰·구급차를 요청하고 현재 위치를 말해요.",minutes:10,
    words:[{japanese:"警察",reading:"けいさつ",meaning:"경찰"},{japanese:"救急車",reading:"きゅうきゅうしゃ",meaning:"구급차"},{japanese:"事故",reading:"じこ",meaning:"사고"}],
    pattern:{label:"～を呼んでください",explanation:"긴급 상황에서 사람이나 차량을 불러 달라고 요청해요.",example:"救急車を呼んでください。",meaning:"구급차를 불러 주세요."},
    dialogue:[{speaker:"A",japanese:"事故です。救急車を呼んでください。",reading:"じこです。きゅうきゅうしゃをよんでください。",meaning:"사고입니다. 구급차를 불러 주세요."},{speaker:"B",japanese:"今いる場所を教えてください。",reading:"いまいるばしょをおしえてください。",meaning:"현재 있는 장소를 알려 주세요."}],speak:"助けてください。警察を呼んでください。",
    quiz:[{prompt:"구급차를 요청하는 말은?",choices:["救急車を呼んでください。","救急車へ行きます。","救急車がありますか。"],answer:0,explanation:"긴급 호출은 ～を呼んでください를 사용해요."},{prompt:"‘사고’는?",choices:["事故","病院","薬局"],answer:0,explanation:"事故는 뜻하지 않게 일어난 사고예요."}],
  }),
];

