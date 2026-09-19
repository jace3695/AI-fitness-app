import type { CurriculumLesson } from './curriculum.ts';

// Original language exercises; these examples do not define inspection criteria.
// Terminology reference: https://www.keyence.co.jp/ss/products/measure-sys/gd-and-t/basic/about.jsp
export const MANUFACTURING_CURRICULUM: CurriculumLesson[] = [
  {
    id:'w21',track:'work',order:21,title:'도면 치수와 공차 확인',minutes:10,
    goal:'도면의 치수·공차와 최신 개정판을 정중하게 확인해요.',
    words:[{japanese:'図面',reading:'ずめん',meaning:'도면'},{japanese:'寸法',reading:'すんぽう',meaning:'치수'},{japanese:'公差',reading:'こうさ',meaning:'공차'}],
    pattern:{label:'～を確認させてください',explanation:'확인할 대상을 を 앞에 두고 정중하게 확인을 요청해요.',example:'この寸法の公差を確認させてください。',meaning:'이 치수의 공차를 확인하게 해 주세요.'},
    dialogue:[{speaker:'A',japanese:'こちらは最新版の図面でしょうか。',reading:'こちらはさいしんばんのずめんでしょうか。',meaning:'이것은 최신판 도면인가요?'},{speaker:'B',japanese:'はい。変更箇所を赤で示しています。',reading:'はい。へんこうかしょをあかでしめしています。',meaning:'네. 변경 부분을 빨간색으로 표시하고 있습니다.'}],
    speak:'この寸法の公差を確認させてください。',
    quiz:[{prompt:'치수의 공차를 확인하고 싶을 때는?',choices:['納期を早めてください。','この寸法の公差を確認させてください。','会議を延期してください。'],answer:1,explanation:'寸法은 치수, 公差는 공차예요. 문장으로 확인 대상을 분명히 말해요.'},{prompt:'「最新版の図面」의 뜻은?',choices:['최신판 도면','측정 결과','납품 일정'],answer:0,explanation:'最新版는 최신판, 図面은 도면이에요.'}],
  },
  {
    id:'w22',track:'work',order:22,title:'측정 결과와 품질 확인',minutes:10,
    goal:'측정값을 보고하고 검사 기준과 재측정을 확인해요.',
    words:[{japanese:'測定値',reading:'そくていち',meaning:'측정값'},{japanese:'検査基準',reading:'けんさきじゅん',meaning:'검사 기준'},{japanese:'再測定',reading:'さいそくてい',meaning:'재측정'}],
    pattern:{label:'～と照合してください',explanation:'기준이나 자료와 대조해 달라고 요청해요.',example:'測定値を検査基準と照合してください。',meaning:'측정값을 검사 기준과 대조해 주세요.'},
    dialogue:[{speaker:'A',japanese:'測定結果を共有していただけますか。',reading:'そくていけっかをきょうゆうしていただけますか。',meaning:'측정 결과를 공유해 주실 수 있나요?'},{speaker:'B',japanese:'はい。測定条件も記載します。',reading:'はい。そくていじょうけんもきさいします。',meaning:'네. 측정 조건도 기재하겠습니다.'}],
    speak:'念のため、再測定をお願いします。',
    quiz:[{prompt:'측정값을 검사 기준과 대조해 달라는 표현은?',choices:['測定値を検査基準と照合してください。','測定条件を省略してください。','図面を破棄してください。'],answer:0,explanation:'照合는 대조예요. 수치만으로 합격을 단정하지 않고 기준과 확인하도록 요청해요.'},{prompt:'「念のため、再測定をお願いします。」의 뜻은?',choices:['납기를 변경해 주세요.','만일을 위해 재측정을 부탁드립니다.','도면을 보내 주세요.'],answer:1,explanation:'念のため는 만일을 위해, 再測定는 재측정이에요.'}],
  },
];
