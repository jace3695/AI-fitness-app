export const FIXED_EXPENSE_PRIORITY_CATEGORIES = ['통신비', '공과금', '구독', '보험', '월세', '대출', '관리비']

const FIXED_EXPENSE_NAME_PATTERNS: Array<{ category: string; label: string; pattern: RegExp }> = [
  { category: '통신비', label: '휴대폰 요금', pattern: /(휴대폰|핸드폰|통신요금|통신비|휴대전화|모바일|kt|skt|sk텔레콤|lg유플러스|유플러스|알뜰폰)/i },
  { category: '공과금', label: '전기세', pattern: /(전기세|전기요금|한전|한국전력)/i },
  { category: '공과금', label: '수도세', pattern: /(수도세|수도요금|상하수도)/i },
  { category: '공과금', label: '가스비', pattern: /(가스비|가스요금|도시가스)/i },
  { category: '관리비', label: '관리비', pattern: /(관리비|아파트관리|주택관리|오피스텔관리)/i },
  { category: '구독', label: '넷플릭스', pattern: /(넷플릭스|netflix)/i },
  { category: '구독', label: '유튜브 프리미엄', pattern: /(유튜브\s*프리미엄|youtube\s*premium|유튜브)/i },
  { category: '구독', label: 'ChatGPT', pattern: /(chatgpt|openai|챗gpt|챗지피티)/i },
  { category: '구독', label: 'Claude', pattern: /(claude|anthropic|클로드)/i },
  { category: '구독', label: '구독', pattern: /(구독|정기결제|멤버십|디즈니플러스|티빙|웨이브|쿠팡플레이|gemini|ai\s*구독)/i },
  { category: '보험', label: '보험료', pattern: /(보험료|보험|생명|손해보험|화재보험|실비)/i },
  { category: '월세', label: '월세', pattern: /(월세|임대료|렌트)/i },
  { category: '대출', label: '대출', pattern: /(대출|상환|원리금|이자납입|카드론)/i },
]

const LIVING_SUPPLIES_CATEGORY_PATTERN = /(다이소|올리브영|아트박스|모던하우스|이케아|생활용품|주방용품|세제|휴지|물티슈|샴푸|린스|치약|칫솔|면도기)/

export const PARSE_SYSTEM = `당신은 가계부 파싱 AI입니다. 반드시 JSON만 반환하세요.

반환 형식:
{"items":[
  {"type":"income 또는 expense 또는 saving","date":"YYYY-MM-DD","amount":숫자,"place":"장소명 또는 수입명 또는 저축명","category":"카테고리","payment":"결제수단","memo":"메모","feedback":"짧은 확인 문구"}
]}

중요 규칙:
- 입력에 거래가 1개여도 반드시 items 배열로 반환하세요.
- 입력에 거래가 여러 개면 각 거래를 items 배열에 하나씩 넣으세요.
- 불필요한 설명, 마크다운, 코드블록 없이 JSON만 반환하세요.
- 날짜가 명확하지 않으면 오늘 날짜를 사용하세요.
- 금액은 반드시 숫자로만 반환하세요.
- "오늘 점심 9000원, 스타벅스 5900원, 버스 1500원" 같이 여러 건이면 3개로 나눠 반환하세요.
- "월급 250만원 들어왔고 점심 9천원 카드" 같이 수입/지출이 섞여 있으면 각각 분리하세요.
- "적금 5만원 넣었어", "저축 3만원" 같은 표현은 saving(저축)으로 분류하세요.

오늘 날짜: DATE_PLACEHOLDER

type 판단 기준:
- income(수입): 월급, 급여, 용돈, 보너스, 이자, 입금, 들어왔어, 받았어, 수입 등
- saving(저축): 저축, 적금, 예금, 청약, 비상금통장, 저금, 넣었어
- expense(지출): 나머지 모든 소비, 결제, 지출

카테고리(지출): 식비/카페/생활용품/쇼핑/교통/구독/통신비/공과금/의료/취미/기타
- 식비: 편의점, CU, GS25, 세븐일레븐, 이마트24, 도시락, 김밥, 라면, 음료수, 생수, 콜라, 간식, 과자, 배달, 식당, 밥, 점심, 저녁, 아침
- 카페: 카페, 커피, 아메리카노, 라떼, 스타벅스, 메가커피, 컴포즈, 투썸, 빽다방, 이디야
- 생활용품: 다이소, 올리브영, 아트박스, 모던하우스, 이케아, 생활용품, 주방용품, 세제, 휴지, 물티슈, 샴푸, 린스, 치약, 칫솔, 면도기
- 생활용품 키워드가 발견되면 다른 자동분류보다 우선해서 category를 반드시 생활용품으로 설정하세요.
- 구독: 넷플릭스, 유튜브 프리미엄, 디즈니플러스, 티빙, 웨이브, 쿠팡플레이, ChatGPT, Claude, Gemini, AI 구독, 멤버십
- 통신비: 휴대폰 요금, 핸드폰 요금, 통신요금, 통신비, 인터넷 요금
- 공과금: 전기세, 수도세, 가스비, 관리비
- 자동분류 실패 시 카테고리는 기타로 두고, 무조건 식비로 보내지 마세요.
카테고리(수입): 월급/용돈/부업/보너스/이자/기타수입
카테고리(저축): 저축
결제수단: 현금/계좌이체/체크카드/휴대폰 소액결제/충전카드
- 휴대폰 소액결제/소액결제라는 단어가 명확히 있을 때만 휴대폰 소액결제로 설정하세요.
- 휴대폰 요금/핸드폰 요금/통신요금/통신비/인터넷 요금은 휴대폰 소액결제가 아니라 통신비 카테고리의 일반 지출입니다.
- 충전카드/선불카드가 있으면 결제수단은 충전카드입니다.
거래유형: 일반 지출/휴대폰 소액결제/충전카드 충전/충전카드 사용
- 카드 충전/충전카드 충전/선불카드 충전처럼 충전 동사가 있을 때만 충전카드 충전입니다.
- 충전카드/선불카드/충전카드 사용/충전카드로는 충전카드 사용입니다.
- 충전카드 충전 조건은 충전카드 사용보다 우선합니다.`

function getRelativeDate(text: string) {
  const now = new Date()
  const date = new Date(now)

  if (text.includes('어제')) {
    date.setDate(date.getDate() - 1)
  } else if (text.includes('그제')) {
    date.setDate(date.getDate() - 2)
  }

  return date.toISOString().split('T')[0]
}

function parseLooseAmount(text: string) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(만원|만 원|천원|천 원|원)?/)
  if (!match) return 0

  const value = Number(String(match[1]).replace(/,/g, ''))
  const unit = match[2] || ''

  if (!value) return 0
  if (unit === '만원' || unit === '만 원') return Math.round(value * 10000)
  if (unit === '천원' || unit === '천 원') return Math.round(value * 1000)
  return Math.round(value)
}

function detectLocalType(text: string) {
  if (/(저축|적금|예금|청약|비상금|저금|넣었어)/.test(text)) return 'saving'
  if (/(월급|급여|용돈|보너스|이자|입금|들어왔|받았|수입)/.test(text)) return 'income'
  return 'expense'
}

const TELECOM_BILL_PATTERN = /(휴대폰\s*요금|핸드폰\s*요금|휴대폰\s*기본요금|통신요금|통신비|인터넷\s*요금)/
const MOBILE_MICRO_PAYMENT_PATTERN = /(휴대폰\s*소액결제|핸드폰\s*소액결제|소액결제)/
const PREPAID_TOPUP_PATTERN = /(카드\s*충전|충전카드\s*충전|선불카드\s*충전)/
const PREPAID_CARD_PATTERN = /(충전카드|선불카드)/

function detectLocalPayment(text: string) {
  if (MOBILE_MICRO_PAYMENT_PATTERN.test(text)) return '휴대폰 소액결제'
  if (PREPAID_CARD_PATTERN.test(text)) return '충전카드'
  if (/(계좌이체|이체)/.test(text)) return '계좌이체'
  if (text.includes('현금')) return '현금'
  if (text.includes('체크카드') || text.includes('카드')) return '체크카드'
  if (TELECOM_BILL_PATTERN.test(text)) return '계좌이체'
  return '체크카드'
}

function detectLocalTransactionType(text: string, payment: string) {
  const isTelecomBill = TELECOM_BILL_PATTERN.test(text)
  const isPrepaidTopup = PREPAID_TOPUP_PATTERN.test(text)
  const isPrepaidUse = /(충전카드(?:\s*사용|\s*로|\s*결제)?|선불카드(?:\s*사용|\s*로|\s*결제)?)/.test(text)
  const isMobileMicro = MOBILE_MICRO_PAYMENT_PATTERN.test(text)

  if (isTelecomBill) return '일반 지출'
  if (isPrepaidTopup) return '충전카드 충전'
  if (isPrepaidUse) return '충전카드 사용'
  if (isMobileMicro || payment === '휴대폰 소액결제') return '휴대폰 소액결제'
  return '일반 지출'
}

export function hasLocalExpenseMetaSignal(text: string) {
  return TELECOM_BILL_PATTERN.test(text)
    || MOBILE_MICRO_PAYMENT_PATTERN.test(text)
    || PREPAID_TOPUP_PATTERN.test(text)
    || PREPAID_CARD_PATTERN.test(text)
    || /(계좌이체|이체|현금|체크카드|카드)/.test(text)
}

export function inferExpenseMeta(text: string, rawPayment?: string, rawTransactionType?: string) {
  if (TELECOM_BILL_PATTERN.test(text)) {
    return {
      payment: detectLocalPayment(text),
      transaction_type: '일반 지출'
    }
  }

  if (PREPAID_TOPUP_PATTERN.test(text)) {
    return {
      payment: PREPAID_CARD_PATTERN.test(text) ? '충전카드' : (rawPayment || detectLocalPayment(text)),
      transaction_type: '충전카드 충전'
    }
  }

  if (PREPAID_CARD_PATTERN.test(text)) {
    return {
      payment: '충전카드',
      transaction_type: '충전카드 사용'
    }
  }

  if (MOBILE_MICRO_PAYMENT_PATTERN.test(text)) {
    return {
      payment: '휴대폰 소액결제',
      transaction_type: '휴대폰 소액결제'
    }
  }

  const payment = rawPayment || detectLocalPayment(text)
  const transaction_type = rawTransactionType || detectLocalTransactionType(text, payment)

  if (transaction_type === '충전카드 사용') {
    return {
      payment: payment === '휴대폰 소액결제' ? payment : '충전카드',
      transaction_type
    }
  }

  if (transaction_type === '충전카드 충전') {
    return { payment, transaction_type }
  }

  if (payment === '휴대폰 소액결제') {
    return { payment, transaction_type: '휴대폰 소액결제' }
  }

  return { payment, transaction_type }
}

export function detectLocalExpenseCategory(text: string) {
  if (LIVING_SUPPLIES_CATEGORY_PATTERN.test(text)) return '생활용품'
  if (TELECOM_BILL_PATTERN.test(text)) return '통신비'
  if (/(관리비|아파트관리|주택관리|오피스텔관리)/.test(text)) return '관리비'
  if (/(전기세|전기요금|수도세|수도요금|가스비|가스요금|공과금)/.test(text)) return '공과금'
  if (/(보험료|보험|실비)/.test(text)) return '보험'
  if (/(월세|임대료)/.test(text)) return '월세'
  if (/(대출|상환|원리금|이자납입)/.test(text)) return '대출'
  if (/(넷플릭스|유튜브\s*프리미엄|디즈니플러스|티빙|웨이브|쿠팡플레이|chatgpt|claude|gemini|ai\s*구독|멤버십)/i.test(text)) return '구독'
  if (/(카페|커피|아메리카노|라떼|스타벅스|메가커피|컴포즈|투썸|빽다방|이디야)/.test(text)) return '카페'
  if (/(편의점|\bCU\b|GS25|세븐일레븐|이마트24|도시락|김밥|라면|음료수|생수|콜라|간식|과자|배달|식당|밥|점심|저녁|아침|식사|햄버거|치킨|피자|음식|요기요|배민|배달의민족|쿠팡이츠)/i.test(text)) return '식비'
  if (/(병원|약국|의료|약)/.test(text)) return '의료'
  if (/(취미|게임|운동|헬스|독서|레슨)/.test(text)) return '취미'
  if (/(택시|버스|지하철|교통)/.test(text)) return '교통'
  if (/(쇼핑|쿠팡|무신사)/.test(text)) return '쇼핑'
  return '기타'
}

function detectLocalIncomeCategory(text: string) {
  if (/(월급|급여)/.test(text)) return '월급'
  if (/(용돈)/.test(text)) return '용돈'
  if (/(부업)/.test(text)) return '부업'
  if (/(보너스)/.test(text)) return '보너스'
  if (/(이자)/.test(text)) return '이자'
  return '기타수입'
}

function detectLocalPlace(text: string, type: string) {
  if (/(스타벅스)/.test(text)) return '스타벅스'
  if (/(택시)/.test(text)) return '택시'
  if (/(버스)/.test(text)) return '버스'
  if (/(지하철)/.test(text)) return '지하철'
  if (/(점심)/.test(text)) return type === 'expense' ? '점심' : '점심'
  if (/(저녁)/.test(text)) return type === 'expense' ? '저녁' : '저녁'
  if (/(아침)/.test(text)) return type === 'expense' ? '아침' : '아침'
  if (/(월급|급여)/.test(text)) return '월급'
  if (/(용돈)/.test(text)) return '용돈'
  if (/(보너스)/.test(text)) return '보너스'
  if (/(적금)/.test(text)) return '적금'
  if (/(저축)/.test(text)) return '저축'
  return type === 'income' ? '수입' : type === 'saving' ? '일반저축' : '미분류'
}

export function parseInputLocally(text: string) {
  const parts = text
    .split(/[,\n]|그리고|하고|랑/)
    .map(part => part.trim())
    .filter(Boolean)

  const items = parts.map((part) => {
    const type = detectLocalType(part)
    const amount = parseLooseAmount(part)
    const date = getRelativeDate(part)
    const place = detectLocalPlace(part, type)

    if (!amount) return null

    return {
      type,
      date,
      amount,
      place,
      category: type === 'income'
        ? detectLocalIncomeCategory(part)
        : type === 'saving'
          ? '저축'
          : detectLocalExpenseCategory(part),
      payment: type === 'expense' ? inferExpenseMeta(part).payment : '',
      transaction_type: type === 'expense' ? inferExpenseMeta(part).transaction_type : '',
      memo: '',
      feedback: '입력 내용을 기준으로 자동 해석했어요.'
    }
  }).filter(Boolean) as any[]

  if (!items.length) {
    throw new Error('거래를 찾지 못했어요.')
  }

  return items
}

function normalizeRecurringText(value?: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[0-9]/g, '')
    .replace(/[^\w가-힣]/g, '')
}

export function getFixedExpenseSignature(item: any) {
  const rawText = `${item.place || ''} ${item.memo || ''} ${item.category || ''}`
  const matched = FIXED_EXPENSE_NAME_PATTERNS.find((entry) => entry.pattern.test(rawText))
  const category = matched?.category || item.category || '기타'
  const normalizedName = matched?.label || normalizeRecurringText(`${item.place || ''} ${item.memo || ''}`) || normalizeRecurringText(item.place || '미분류')

  return {
    category,
    label: matched?.label || item.place || '미분류',
    normalizedName,
    priority: FIXED_EXPENSE_PRIORITY_CATEGORIES.includes(category) || Boolean(matched)
  }
}

export function getRecurringPatternText(monthCount: number, count: number, dayStable: boolean, amountStable: boolean) {
  if (monthCount >= 3 && dayStable && amountStable) {
    return `최근 ${monthCount}개월간 비슷한 시기와 금액으로 지출`
  }

  if (monthCount >= 3 && dayStable) {
    return `최근 ${monthCount}개월간 매달 비슷한 시기에 결제`
  }

  if (monthCount >= 3 && amountStable) {
    return `최근 ${monthCount}개월간 비슷한 금액으로 반복 지출`
  }

  if (monthCount >= 2 && count >= 2) {
    return `최근 ${monthCount}개월간 반복된 지출 흐름`
  }

  return '반복 패턴이 일부 보여요'
}

