import type { WordItem } from "./words";
import type { SentenceItem } from "./sentences";
import { toKoreanPronunciation } from "./learningDataExpansion";

type Seed = [string, string, string, string];

const parse = (category: string, source: string): Seed[] => source.trim().split("\n").map((line) => {
  const [word, reading, meaning] = line.split("|");
  return [word, reading, meaning, category];
});

const coreSeeds: Seed[] = [
  ...parse("일상", `食べる|たべる|먹다
飲む|のむ|마시다
見る|みる|보다
聞く|きく|듣다·묻다
話す|はなす|말하다
読む|よむ|읽다
書く|かく|쓰다
買う|かう|사다
売る|うる|팔다
作る|つくる|만들다
使う|つかう|사용하다
開ける|あける|열다
閉める|しめる|닫다
入る|はいる|들어가다
出る|でる|나가다
起きる|おきる|일어나다
寝る|ねる|자다
洗う|あらう|씻다
着る|きる|입다
脱ぐ|ぬぐ|벗다
持つ|もつ|가지다
置く|おく|놓다
取る|とる|집다·취하다
立つ|たつ|서다
座る|すわる|앉다
歩く|あるく|걷다
走る|はしる|달리다
泳ぐ|およぐ|수영하다
休む|やすむ|쉬다
始める|はじめる|시작하다
終わる|おわる|끝나다
待つ|まつ|기다리다
急ぐ|いそぐ|서두르다
忘れる|わすれる|잊다
覚える|おぼえる|외우다
分かる|わかる|알다·이해하다
考える|かんがえる|생각하다
選ぶ|えらぶ|고르다
比べる|くらべる|비교하다
変える|かえる|바꾸다
大きい|おおきい|크다
小さい|ちいさい|작다
新しい|あたらしい|새롭다
古い|ふるい|오래되다
高い|たかい|비싸다·높다
安い|やすい|싸다
長い|ながい|길다
短い|みじかい|짧다
広い|ひろい|넓다
狭い|せまい|좁다
重い|おもい|무겁다
軽い|かるい|가볍다
早い|はやい|이르다·빠르다
遅い|おそい|늦다
暑い|あつい|덥다
寒い|さむい|춥다
暖かい|あたたかい|따뜻하다
涼しい|すずしい|선선하다
難しい|むずかしい|어렵다
易しい|やさしい|쉽다
面白い|おもしろい|재미있다
忙しい|いそがしい|바쁘다
明るい|あかるい|밝다
暗い|くらい|어둡다
強い|つよい|강하다
弱い|よわい|약하다
良い|よい|좋다
悪い|わるい|나쁘다
便利|べんり|편리함
不便|ふべん|불편함
静か|しずか|조용함
賑やか|にぎやか|번화함
綺麗|きれい|깨끗함·예쁨
丈夫|じょうぶ|튼튼함
必要|ひつよう|필요함
大切|たいせつ|소중함
簡単|かんたん|간단함
複雑|ふくざつ|복잡함`),
  ...parse("여행", `飛行機|ひこうき|비행기
船|ふね|배
自転車|じてんしゃ|자전거
自動車|じどうしゃ|자동차
信号|しんごう|신호등
横断歩道|おうだんほどう|횡단보도
交差点|こうさてん|교차로
道路|どうろ|도로
橋|はし|다리
港|みなと|항구
海岸|かいがん|해안
山|やま|산
川|かわ|강
湖|みずうみ|호수
公園|こうえん|공원
動物園|どうぶつえん|동물원
水族館|すいぞくかん|수족관
遊園地|ゆうえんち|놀이공원
市場|いちば|시장
土産|みやげ|기념품
切符|きっぷ|표
荷物|にもつ|짐
旅行者|りょこうしゃ|여행자
観光客|かんこうきゃく|관광객
案内人|あんないにん|안내인
地元|じもと|현지
景色|けしき|경치
入口券|にゅうじょうけん|입장권
予約席|よやくせき|예약석
空港バス|くうこうばす|공항버스
観光案内|かんこうあんない|관광 안내
旅行日程|りょこうにってい|여행 일정
宿泊先|しゅくはくさき|숙소
忘れ物|わすれもの|분실물
落とし物|おとしもの|습득물
迷子|まいご|미아·길을 잃은 사람
道順|みちじゅん|길 순서
片道券|かたみちけん|편도권
往復券|おうふくけん|왕복권
乗り場|のりば|타는 곳`),
  ...parse("업무", `働く|はたらく|일하다
勤める|つとめる|근무하다
調べる|しらべる|조사하다
確認する|かくにんする|확인하다
連絡する|れんらくする|연락하다
報告する|ほうこくする|보고하다
相談する|そうだんする|상담하다
説明する|せつめいする|설명하다
提出する|ていしゅつする|제출하다
承認する|しょうにんする|승인하다
修正する|しゅうせいする|수정하다
変更する|へんこうする|변경하다
準備する|じゅんびする|준비하다
整理する|せいりする|정리하다
共有する|きょうゆうする|공유하다
検討する|けんとうする|검토하다
対応する|たいおうする|대응하다
依頼する|いらいする|의뢰하다
受注する|じゅちゅうする|수주하다
契約する|けいやくする|계약하다
管理|かんり|관리
資料|しりょう|자료
書類|しょるい|서류
メール|めーる|메일
電話|でんわ|전화
会議|かいぎ|회의
打合せ|うちあわせ|협의
予定変更|よていへんこう|일정 변경
作業時間|さぎょうじかん|작업 시간
作業内容|さぎょうないよう|작업 내용
確認事項|かくにんじこう|확인 사항
未完了|みかんりょう|미완료
完了予定|かんりょうよてい|완료 예정
納期回答|のうきかいとう|납기 회신
在庫確認|ざいこかくにん|재고 확인
品質確認|ひんしつかくにん|품질 확인
検査結果|けんさけっか|검사 결과
測定結果|そくていけっか|측정 결과
改善案|かいぜんあん|개선안
対応状況|たいおうじょうきょう|대응 상황
担当部署|たんとうぶしょ|담당 부서
関連部署|かんれんぶしょ|관련 부서
承認者|しょうにんしゃ|승인자
依頼者|いらいしゃ|요청자
納入先|のうにゅうさき|납품처
仕入先|しいれさき|매입처
販売先|はんばいさき|판매처
生産計画|せいさんけいかく|생산 계획
作業手順|さぎょうてじゅん|작업 절차
安全確認|あんぜんかくにん|안전 확인
注意事項|ちゅういじこう|주의 사항
異常発生|いじょうはっせい|이상 발생
原因分析|げんいんぶんせき|원인 분석
再発防止策|さいはつぼうしさく|재발 방지책
費用削減|ひようさくげん|비용 절감
価格交渉|かかくこうしょう|가격 협상
契約条件|けいやくじょうけん|계약 조건
支払条件|しはらいじょうけん|지불 조건
納入条件|のうにゅうじょうけん|납품 조건
秘密保持|ひみつほじ|비밀 유지`),
  ...parse("친구", `会う|あう|만나다
遊ぶ|あそぶ|놀다
笑う|わらう|웃다
泣く|なく|울다
歌う|うたう|노래하다
踊る|おどる|춤추다
誘う|さそう|권유하다
断る|ことわる|거절하다
褒める|ほめる|칭찬하다
謝る|あやまる|사과하다
喜ぶ|よろこぶ|기뻐하다
怒る|おこる|화내다
驚く|おどろく|놀라다
手伝う|てつだう|돕다
送る|おくる|보내다
迎える|むかえる|마중하다
貸す|かす|빌려주다
借りる|かりる|빌리다
教える|おしえる|가르치다
習う|ならう|배우다
仲良し|なかよし|친한 사이
付き合い|つきあい|교제
友情|ゆうじょう|우정
気持ち|きもち|기분
笑い声|わらいごえ|웃음소리
話題|わだい|화제
共通点|きょうつうてん|공통점
好み|このみ|취향
お気に入り|おきにいり|마음에 드는 것
休日|きゅうじつ|휴일
誕生会|たんじょうかい|생일 파티
結婚式|けっこんしき|결혼식
記念日|きねんび|기념일
贈り物|おくりもの|선물
手紙|てがみ|편지
電話中|でんわちゅう|통화 중
返信|へんしん|답장
連絡|れんらく|연락
待ち合わせ場所|まちあわせばしょ|약속 장소
待ち合わせ時間|まちあわせじかん|약속 시간`),
];

const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const readings = ["", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
const numberText = (value: number) => `${value >= 10 ? `${value >= 20 ? digits[Math.floor(value / 10)] : ""}十` : ""}${digits[value % 10]}`;
const numberReading = (value: number) => `${value >= 10 ? `${value >= 20 ? readings[Math.floor(value / 10)] : ""}じゅう` : ""}${readings[value % 10]}`;
const counterReading = (value: number, counter: "minute" | "floor" | "number" | "piece" | "person") => {
  if (counter === "person") {
    if (value === 1) return "ひとり";
    if (value === 2) return "ふたり";
    if (value === 4) return "よにん";
    return `${numberReading(value)}にん`;
  }
  if (counter === "number") return `${numberReading(value)}ばん`;
  const endings = {
    minute: ["", "いっぷん", "にふん", "さんぷん", "よんぷん", "ごふん", "ろっぷん", "ななふん", "はっぷん", "きゅうふん"],
    floor: ["", "いっかい", "にかい", "さんがい", "よんかい", "ごかい", "ろっかい", "ななかい", "はっかい", "きゅうかい"],
    piece: ["", "いっこ", "にこ", "さんこ", "よんこ", "ごこ", "ろっこ", "ななこ", "はっこ", "きゅうこ"],
  }[counter];
  const unit = value % 10;
  if (unit !== 0) {
    const tens = value >= 20 ? `${readings[Math.floor(value / 10)]}じゅう` : value >= 10 ? "じゅう" : "";
    return `${tens}${endings[unit]}`;
  }
  const tens = value >= 20 ? readings[Math.floor(value / 10)] : "";
  return `${tens}じゅっ${counter === "minute" ? "ぷん" : counter === "floor" ? "かい" : "こ"}`;
};
const counters: Seed[] = [
  ...Array.from({ length: 60 }, (_, index) => [`${numberText(index + 1)}分`, counterReading(index + 1, "minute"), `${index + 1}분`, "일상"] as Seed),
  ...Array.from({ length: 60 }, (_, index) => [`${numberText(index + 1)}階`, counterReading(index + 1, "floor"), `${index + 1}층`, "여행"] as Seed),
  ...Array.from({ length: 60 }, (_, index) => [`${numberText(index + 1)}番`, counterReading(index + 1, "number"), `${index + 1}번`, "여행"] as Seed),
  ...Array.from({ length: 60 }, (_, index) => [`${numberText(index + 1)}個`, counterReading(index + 1, "piece"), `${index + 1}개`, "일상"] as Seed),
  ...Array.from({ length: 60 }, (_, index) => [`${numberText(index + 1)}人`, counterReading(index + 1, "person"), `${index + 1}명`, "친구"] as Seed),
];

const makeWord = ([word, reading, meaning, category]: Seed, index: number): WordItem => {
  const counter = /[分階番個人]$/.test(word);
  const example = counter ? `${word}お願いします。` : index % 2 ? `${word}を覚えます。` : `${word}について話します。`;
  const exampleReading = counter ? `${reading}おねがいします。` : index % 2 ? `${reading}をおぼえます。` : `${reading}についてはなします。`;
  return { word, reading, meaning, category, level: index % 3 === 0 ? "beginner" : index % 3 === 1 ? "basic" : "practical", partOfSpeech: /[いうるくすむぐぶつぬ]$/.test(word) ? "verb" : "noun", koreanPronunciation: toKoreanPronunciation(reading), example, exampleReading, exampleKoreanPronunciation: toKoreanPronunciation(exampleReading), exampleMeaning: counter ? `${meaning} 부탁합니다.` : index % 2 ? `${meaning}을 외웁니다.` : `${meaning}에 관해 이야기합니다.` };
};

export const RECOMMENDED_WORDS: WordItem[] = [...coreSeeds, ...counters].map(makeWord);

export const RECOMMENDED_SENTENCES: SentenceItem[] = RECOMMENDED_WORDS.flatMap((word, index) => {
  const first: SentenceItem = { japanese: word.example, reading: word.exampleReading, koreanPronunciation: word.exampleKoreanPronunciation, meaning: word.exampleMeaning ?? word.meaning, category: word.category, level: word.level, note: `${word.meaning} 활용`, description: `‘${word.word}’을 실제 문맥에서 익혀요.`, relatedWords: [word.word] };
  if (index % 2) return [first];
  return [first, { japanese: `${word.word}はどうですか。`, reading: `${word.reading}はどうですか。`, koreanPronunciation: toKoreanPronunciation(`${word.reading}はどうですか。`), meaning: `${word.meaning}은 어떻습니까?`, category: word.category, level: word.level, note: `${word.meaning} 질문`, description: `‘${word.word}’에 관해 묻는 문장이에요.`, relatedWords: [word.word] }];
});

