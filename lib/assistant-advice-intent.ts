import type { FreeAdviceScope } from './free-advice-context';

export const ADVICE_QUESTIONS: Record<FreeAdviceScope, string> = {
  assistant: '내 기록을 보고 오늘 할 일을 조언해줘',
  fitness: '최근 운동 기록을 보고 개선점을 조언해줘',
  budget: '이번 달 소비를 줄이려면 어떻게 하면 좋을까?',
  language: '일본어 학습 기록을 보고 공부 방법을 조언해줘',
};

// Routing only: never generates advice, sends records, or changes data.
export function detectAdviceScope(message: string): FreeAdviceScope | null {
  const text = message.trim();
  // A quoted task/memo may itself contain an advice question. Keep explicit
  // writes on the existing review path, including combined requests.
  if (/(추가|등록|저장|삭제|수정|변경|기록|완료)\s*(해\s*줘|해\s*주세요|해요|했어|했어요|처리)|완료했|끝냈/.test(text)) return null;
  const asksAdvice = /(조언|분석|개선|추천|어떻게|어떤\s*방법|잘\s*(하고|하구)\s*있|줄이려면|늘리려면|하면\s*좋|해도\s*(될|되)|괜찮을까)/.test(text);
  if (!asksAdvice) return null;
  const fitness = /(운동|식단|체중|몸무게|단백질|섭취|식사|걷기|근력|허리)/.test(text);
  const budget = /(가계부|소비|지출|예산|저축|수입|돈)/.test(text);
  const language = /(일본어|언어|학습|공부|복습|가나|단어)/.test(text);
  if ([fitness, budget, language].filter(Boolean).length > 1) return 'assistant';
  if (fitness) return 'fitness';
  if (budget) return 'budget';
  if (language) return 'language';
  if (/(기록|일상|오늘|조언)/.test(text)) return 'assistant';
  return null;
}
