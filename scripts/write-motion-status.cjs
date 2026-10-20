const fs = require('node:fs');
const catalog = require('../docs/exercise-motion/batch3-evidence/catalog.json');
const incomplete = {
  'dead-bug': '두 변형 검토 초안만 보존; 앱 시연 미연결',
  'foam-roller-recovery': '9단계 중 7단계 초안 보존; 앱 시연 미연결',
  'ab-slider-ready-position': '정지 준비 도해만 보존; 앱 시연 미연결',
};
const complete = catalog.rows.filter(row => !incomplete[row.id]);
if (complete.length !== 27 || catalog.rows.length !== 30) throw Error('Unexpected catalog count');
let text = '# 운동 시연 로컬 통합 상태\n\n완성 움직임 27종을 앱에 연결했습니다. 미완료 3종은 아래와 같이 원본 초안만 보존하고 앱 시연에는 연결하지 않았습니다. 전문가 자세·개인 적합성 검수는 미실시이며 의료적 안전성을 보장하지 않습니다. 로컬 통합은 배포 완료를 의미하지 않습니다.\n\n| 종목 | 상태 |\n|---|---|\n';
for (const row of catalog.rows) text += `| ${row.name} (\`${row.id}\`) | ${incomplete[row.id] || '움직이는 시연 로컬 통합'} |\n`;
text += '\n몸풀기 7장면, 정리운동 8장면(마지막 호흡은 정지 안내), 폼롤러 준비 14장면입니다. 장면 수를 별도 운동 개수로 더하지 않습니다. 제자리 걷기·짧은 밴드 로우 등 표현 범위는 각 가이드의 제한을 따릅니다.\n\n원본 패치 제작 시점의 상태·해시는 HANDOFF-BATCHES6-12.md, 실제 통합 범위·로컬 보정·최종 검증은 INTEGRATION-27.md를 참조하세요. 과거 차수 문서의 미통합 표기는 제작 당시 기록입니다.\n';
fs.writeFileSync('docs/exercise-motion/CATALOG-STATUS.md', text);
