import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 30_000
const MAX_QUESTION_LENGTH = 500
const MAX_SUMMARY_ENTRIES = 30

function toSafeNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toSafeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toSafeText(value: unknown, maxLength = 80) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sanitizeNumericSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_SUMMARY_ENTRIES)
      .map(([key, amount]) => [toSafeText(key, 40) || '미분류', toSafeNumber(amount)])
  )
}

function sanitizeFixedExpenseCandidates(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.slice(0, 5).map((item) => ({
    category: toSafeText(item?.category, 40) || '기타',
    count: Math.max(0, Math.round(toSafeNumber(item?.count))),
    avgAmount: Math.max(0, toSafeNumber(item?.avgAmount)),
    score: Math.max(0, toSafeNumber(item?.score)),
    priority: Boolean(item?.priority),
    patternText: toSafeText(item?.patternText, 100),
    monthCount: Math.max(0, Math.round(toSafeNumber(item?.monthCount)))
  }))
}

function sanitizeConfirmedFixedExpenses(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.slice(0, 5).map((item) => ({
    name: toSafeText(item?.name, 60) || '미분류',
    category: toSafeText(item?.category, 40) || '기타',
    avgAmount: Math.max(0, toSafeNumber(item?.avgAmount))
  }))
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: '요청 내용이 너무 깁니다.' }, { status: 413 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const question = toSafeText(body.question, MAX_QUESTION_LENGTH)
  const requestedPeriod = toSafeText(body.period, 7)
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod) ? requestedPeriod : '선택 월'
  if (!question) {
    return NextResponse.json({ error: '질문을 입력해주세요.' }, { status: 400 })
  }

  const categorySummary = sanitizeNumericSummary(body.categorySummary)
  const previousCategorySummary = sanitizeNumericSummary(body.previousCategorySummary)
  const paymentSummary = sanitizeNumericSummary(body.paymentSummary)
  const transactionTypeSummary = sanitizeNumericSummary(body.transactionTypeSummary)
  const sourceSummary = body.summary && typeof body.summary === 'object' ? body.summary : {}

  const summary = {
    totalIncome: toSafeNumber(sourceSummary.totalIncome),
    totalExpense: toSafeNumber(sourceSummary.totalExpense),
    totalSavings: toSafeNumber(sourceSummary.totalSavings),
    savingsRate: toSafeNumber(sourceSummary.savingsRate),
    topCategoryName: toSafeText(sourceSummary.topCategoryName, 40) || '-',
    topCategoryAmount: toSafeNumber(sourceSummary.topCategoryAmount),
    estimatedFixedTotal: toSafeNumber(sourceSummary.estimatedFixedTotal),
    confirmedFixedExpenses: sanitizeConfirmedFixedExpenses(sourceSummary.confirmedFixedExpenses),
    fixedExpenseCandidates: sanitizeFixedExpenseCandidates(sourceSummary.fixedExpenseCandidates),
    currentMonthIncome: toSafeNumber(sourceSummary.currentMonthIncome),
    currentMonthExpenses: toSafeNumber(sourceSummary.currentMonthExpenses),
    currentMonthSavings: toSafeNumber(sourceSummary.currentMonthSavings),
    previousMonthIncome: toSafeNumber(sourceSummary.previousMonthIncome),
    previousMonthExpenses: toSafeNumber(sourceSummary.previousMonthExpenses),
    previousMonthSavings: toSafeNumber(sourceSummary.previousMonthSavings),
    monthlyBudget: toSafeNullableNumber(sourceSummary.monthlyBudget),
    remainingBudget: toSafeNullableNumber(sourceSummary.remainingBudget),
    budgetUsageRate: toSafeNullableNumber(sourceSummary.budgetUsageRate),
    mobileMicroTotal: toSafeNumber(sourceSummary.mobileMicroTotal),
    prepaidTopupTotal: toSafeNumber(sourceSummary.prepaidTopupTotal),
    prepaidSpendTotal: toSafeNumber(sourceSummary.prepaidSpendTotal),
    estimatedPrepaidBalance: toSafeNumber(sourceSummary.estimatedPrepaidBalance),
    telecomTotal: toSafeNumber(sourceSummary.telecomTotal),
    actualTelecomExpense: toSafeNumber(sourceSummary.actualTelecomExpense),
    budgetRiskLabel: toSafeText(sourceSummary.budgetRiskLabel, 40) || '-',
    budgetRiskText: toSafeText(sourceSummary.budgetRiskText, 240) || '-',
    aiStyle: toSafeText(sourceSummary.aiStyle, 40) || '-',
    aiStyleDetail: toSafeText(sourceSummary.aiStyleDetail, 240) || '-'
  }

  const categoryMap: Record<string, string[]> = {
    식비: ['식비', '외식', '음식'],
    카페: ['카페', '커피'],
    배달: ['배달'],
    교통: ['교통', '택시', '버스', '지하철'],
    쇼핑: ['쇼핑'],
    생활용품: ['생활용품', '주방용품', '세제', '휴지', '물티슈', '샴푸', '린스', '치약', '칫솔'],
    의료: ['의료', '병원', '약국'],
    통신비: ['휴대폰 요금', '통신요금', '인터넷 요금'],
    공과금: ['전기세', '수도세', '가스비'],
    구독: ['구독'],
    보험: ['보험료', '실비'],
    월세: ['월세', '임대료'],
    대출: ['대출', '원리금', '이자납입'],
    관리비: ['관리비', '아파트관리비']
  }

  const prompt = `
너는 개인 가계부 분석 AI야.
반드시 사용자가 제공한 집계 데이터만 기준으로 답변하고, 없는 정보는 추측하지 마.
개별 거래의 날짜, 거래처, 메모는 제공되지 않으므로 해당 내용을 만들어내지 마.
답변은 한국어로, 이해하기 쉽게, 3~6문장 정도로 작성해.
결론, 근거 수치, 짧은 조언 순서로 답하고 사용자가 묻지 않은 소비 성향 설명은 억지로 덧붙이지 마.

분석 기간: ${period}
아래의 총 수입·총 지출·총 저축은 이 분석 기간에 한정된 값이야.

집계 요약:
선택 월 수입: ${summary.totalIncome}원
선택 월 지출: ${summary.totalExpense}원
선택 월 저축: ${summary.totalSavings}원
저축률: ${summary.savingsRate}%
최다 지출 카테고리: ${summary.topCategoryName}
최다 지출 금액: ${summary.topCategoryAmount}원
사용자가 확정한 반복지출 월 평균 합계: ${summary.estimatedFixedTotal}원
확정 반복지출 건수: ${summary.confirmedFixedExpenses.length}건
확정 반복지출 요약: ${JSON.stringify(summary.confirmedFixedExpenses)}
고정지출 후보 건수: ${summary.fixedExpenseCandidates.length}건
고정지출 후보 요약: ${JSON.stringify(summary.fixedExpenseCandidates)}
선택 월 수입(검증용): ${summary.currentMonthIncome}원
선택 월 지출(검증용): ${summary.currentMonthExpenses}원
선택 월 저축(검증용): ${summary.currentMonthSavings}원
이전 월 수입: ${summary.previousMonthIncome}원
이전 월 지출: ${summary.previousMonthExpenses}원
이전 월 저축: ${summary.previousMonthSavings}원
설정 월 예산: ${summary.monthlyBudget === null ? '미설정' : `${summary.monthlyBudget}원`}
남은 예산: ${summary.remainingBudget === null ? '계산 불가' : `${summary.remainingBudget}원`}
예산 사용률: ${summary.budgetUsageRate === null ? '계산 불가' : `${summary.budgetUsageRate}%`}
휴대폰 소액결제 합계: ${summary.mobileMicroTotal}원
충전카드 충전 합계: ${summary.prepaidTopupTotal}원
충전카드 사용 합계: ${summary.prepaidSpendTotal}원
충전카드 잔액 추정: ${summary.estimatedPrepaidBalance}원
통신요금 합계: ${summary.telecomTotal}원
실제 통신비: ${summary.actualTelecomExpense}원
소비 위험도: ${summary.budgetRiskLabel}
소비 위험도 설명: ${summary.budgetRiskText}
소비 스타일: ${summary.aiStyle}
소비 스타일 설명: ${summary.aiStyleDetail}

카테고리별 지출 합계:
${JSON.stringify(categorySummary)}

이전 월 카테고리별 지출 합계:
${JSON.stringify(previousCategorySummary)}

결제수단별 지출 합계:
${JSON.stringify(paymentSummary)}

거래유형별 지출 합계:
${JSON.stringify(transactionTypeSummary)}

카테고리 해석 참고:
${JSON.stringify(categoryMap)}

분석 참고:
충전카드 충전은 실제 소비 총지출에서 중복 포함되지 않도록 주의해.
통신요금과 휴대폰 소액결제가 함께 있으면 중복 가능성을 알려줘.
확정 반복지출과 자동 감지 후보를 구분해. 후보는 최근 2개월 이상 반복된 미확정 항목이며 확정 합계에 포함하지 마.

사용자 질문: ${question}

출력 형식:
반드시 아래 JSON 객체 하나만 반환해. 코드블록과 마크다운은 사용하지 마.
{"answer":"한국어 답변","followUpQuestions":["후속 질문 1","후속 질문 2","후속 질문 3"]}

답변 규칙:
숫자는 원화 단위로 표시해.
answer 안에도 마크다운 기호는 사용하지 말고 일반 텍스트로만 답변해.
따뜻하고 실용적으로 질문에 직접 답해.
카테고리 질문은 카테고리별 지출 합계를 우선 사용해.
데이터가 부족하면 부족하다고 솔직하게 말해.
예산이 미설정이면 수입이나 지출을 예산이라고 부르지 마.
전월 비교 질문은 이전 월 합계와 이전 월 카테고리 합계를 근거로 답해.
전반 분석 질문일 때만 소비 스타일과 위험도를 자연스럽게 반영해.
조언은 바로 실행할 수 있도록 한 가지 이상 구체적으로 제안해.
followUpQuestions는 현재 답변 근거에서 이어서 확인할 수 있는 짧은 질문 2~3개로 작성해.
`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      })
    }
  )

  if (!response.ok) {
    console.error('Gemini 분석 요청 실패:', response.status)
    return NextResponse.json({ error: 'AI 분석에 실패했습니다.' }, { status: 502 })
  }

  const data = await response.json()
  const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!rawResult) {
    return NextResponse.json({ error: 'AI 분석 결과를 받지 못했습니다.' }, { status: 502 })
  }

  let parsedResult: unknown
  try {
    parsedResult = JSON.parse(rawResult)
  } catch {
    parsedResult = { answer: rawResult, followUpQuestions: [] }
  }

  const parsedObject = parsedResult && typeof parsedResult === 'object'
    ? parsedResult as Record<string, unknown>
    : {}
  const answer = toSafeText(parsedObject.answer, 1600)
  const followUpQuestions = Array.isArray(parsedObject.followUpQuestions)
    ? parsedObject.followUpQuestions
        .map((item) => toSafeText(item, 80))
        .filter(Boolean)
        .slice(0, 3)
    : []

  if (!answer) {
    return NextResponse.json({ error: 'AI 분석 결과를 읽지 못했습니다.' }, { status: 502 })
  }

  return NextResponse.json({ answer, followUpQuestions })
}

