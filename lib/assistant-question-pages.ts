// Static supported prompts only; no user records, frequency tracking or persistence.
export const QUESTION_PAGES = [
 ['오늘 운동 계획 보여줘','내 체성분 기록을 보고 운동 계획 알려줘','오늘 일본어 학습 진도 알려줘','이번 달 지출 알려줘'],
 ['오늘 브리핑 보여줘','오늘 할 일 알려줘','오늘 자기계발 현황 알려줘','일본어 복습 시작'],
] as const;
let visits=Math.floor(Math.random()*QUESTION_PAGES.length);
export function nextQuestionVisit(){return visits++%QUESTION_PAGES.length;}
export function questionPage(index:number){return QUESTION_PAGES[((index%QUESTION_PAGES.length)+QUESTION_PAGES.length)%QUESTION_PAGES.length];}
