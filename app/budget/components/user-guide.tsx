'use client'

import { useEffect } from 'react'
import { BookOpen, ChevronRight, X } from 'lucide-react'

type UserGuideProps = {
  open: boolean
  onClose: () => void
}

const sections = [
  {
    id: 'quick-start',
    title: '1. 처음 시작하기',
    icon: '🚀',
    items: [
      '회원가입 후 닉네임을 설정하면 홈 화면에서 이번 달 수입·지출·저축 현황을 한눈에 볼 수 있어요.',
      '처음에는 설정에서 이번 달 전체 예산과 필요한 카테고리별 예산을 입력해 주세요.',
      '화면 아래 메뉴는 홈, 내역, 기록, 분석, 설정 순서예요. 가운데 기록 버튼으로 거래를 빠르게 추가할 수 있어요.'
    ]
  },
  {
    id: 'records',
    title: '2. 수입·지출·저축 기록하기',
    icon: '✍️',
    items: [
      '기록 화면에 “오늘 점심 9천원 체크카드”처럼 평소 말하듯 입력하세요.',
      '여러 건도 한 번에 입력할 수 있어요. 예: “점심 9천원, 커피 4500원, 택시 12000원”.',
      '마이크 버튼이 보이면 음성으로 말할 수도 있어요. 인식 후 날짜·금액·유형·카테고리·결제수단을 반드시 확인해 주세요.',
      'AI가 분석한 결과가 맞으면 저장하고, 틀린 내용은 저장 전에 직접 수정하세요. 금액은 숫자만 입력하면 됩니다.'
    ],
    examples: ['어제 마트에서 5만 8천원 체크카드', '월급 280만원 들어왔어', '적금 10만원 넣었어']
  },
  {
    id: 'history',
    title: '3. 내역 확인·검색·내보내기',
    icon: '🧾',
    items: [
      '내역에서 거래를 눌러 내용을 확인하고 수정하거나 삭제할 수 있어요.',
      '검색어와 시작일·종료일, 수입/지출/저축 유형, 카테고리 필터를 함께 사용할 수 있어요.',
      'CSV 내보내기는 현재 필터 결과만 저장합니다. 월별 자료가 필요하면 먼저 날짜 범위를 지정한 뒤 내보내세요.',
      '삭제한 기록은 되돌리기 어려우므로 날짜와 금액을 확인한 뒤 삭제하세요.'
    ]
  },
  {
    id: 'budget',
    title: '4. 예산 설정과 확인',
    icon: '🎯',
    items: [
      '분석 화면에서 월을 선택하고 전체 예산과 카테고리별 예산을 설정하세요.',
      '예산은 실제 수입과 별개입니다. 이번 달에 사용해도 되는 목표 금액을 입력하는 기능이에요.',
      '홈의 남은 예산과 사용률은 선택한 달의 저장된 예산을 기준으로 계산됩니다.',
      '예산 알림을 켜면 앱을 열었을 때 90% 또는 100% 도달 여부를 확인해 알려줘요.'
    ]
  },
  {
    id: 'analysis',
    title: '5. 소비 분석과 AI 상담',
    icon: '✨',
    items: [
      '분석에서 월별 수입·지출·저축, 전월 대비 변화, 상위 지출과 소비 흐름을 확인할 수 있어요.',
      'AI 상담에는 기간·카테고리·결제수단을 구체적으로 질문하면 더 정확해요.',
      '답변의 합계나 근거가 중요할 때는 관련 거래 내역도 함께 확인하세요.',
      '기록이 적거나 질문 기간에 데이터가 없으면 분석 결과가 제한될 수 있어요.'
    ],
    examples: ['이번 달 식비 얼마 썼어?', '지난달보다 늘어난 항목은?', '8월 1일부터 10일까지 체크카드 지출만 알려줘']
  },
  {
    id: 'recurring',
    title: '6. 고정·반복지출 관리',
    icon: '🔁',
    items: [
      '비슷한 날짜와 금액으로 반복되는 거래는 고정·반복지출 후보로 표시될 수 있어요.',
      '후보가 맞으면 확정하고, 일회성 지출이면 제외하세요. AI가 자동으로 확정하지는 않아요.',
      '제외한 항목도 필요하면 다시 후보로 복원할 수 있어요.',
      '정확도를 높이려면 상호명과 카테고리를 가능한 한 일정하게 기록하세요.'
    ]
  },
  {
    id: 'report',
    title: '7. 월간 리포트',
    icon: '📊',
    items: [
      '월간 리포트는 선택한 달의 총수입·총지출·저축, 예산 실적과 주요 변화를 요약해요.',
      '월이 끝난 뒤 모든 거래를 입력했는지 확인한 다음 리포트를 보면 더 정확합니다.',
      '전월 기록이 충분해야 전월 대비 분석이 의미 있게 표시돼요.'
    ]
  },
  {
    id: 'settings',
    title: '8. 알림·통화·보안 설정',
    icon: '⚙️',
    items: [
      '통화를 변경하면 화면의 금액 표시 단위가 바뀝니다. 기존 금액을 환율로 자동 변환하는 기능은 아니에요.',
      '브라우저 알림은 권한을 허용해야 하며, 현재는 웹앱을 열었을 때 예산·월말 조건을 확인하는 방식이에요.',
      '아이폰 알림은 Safari에서 웹앱을 홈 화면에 추가한 뒤 권한을 허용해야 정상 동작할 수 있어요.',
      '간편비밀번호는 4~6자리로 설정할 수 있고, Face ID·지문·Windows Hello를 지원하는 기기에서는 생체인증도 등록할 수 있어요.',
      '공용 기기에서는 사용 후 로그아웃하고, 전체 기록 초기화는 복구가 어려우므로 신중하게 사용하세요.'
    ]
  },
  {
    id: 'troubleshooting',
    title: '9. 문제가 생겼을 때',
    icon: '🛠️',
    items: [
      '화면이 갱신되지 않으면 네트워크 연결을 확인한 뒤 새로고침하세요.',
      '음성 입력이 안 되면 브라우저의 마이크 권한을 확인하세요.',
      '알림이 안 오면 설정의 알림 스위치, 브라우저 알림 권한, 아이폰의 홈 화면 추가 여부를 확인하세요.',
      'AI 분석이 이상하면 거래의 날짜·금액·유형·카테고리가 올바른지 먼저 확인하고 질문 기간을 구체적으로 지정하세요.',
      '로그인이 반복해서 풀리면 쿠키 차단이나 시크릿 모드를 해제한 뒤 다시 로그인하세요.'
    ]
  }
]

export default function UserGuide({ open, onClose }: UserGuideProps) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="user-guide-title" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,3,8,0.82)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, height: '100%', background: 'linear-gradient(180deg,#12121C 0%,#0B0B12 100%)', overflowY: 'auto', color: '#F0EDE8' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px', background: 'rgba(18,18,28,0.96)', borderBottom: '1px solid rgba(255,255,255,0.09)', backdropFilter: 'blur(12px)' }}>
          <div>
            <p style={{ margin: '0 0 4px', color: '#E8A87C', fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>오늘의 살림</p>
            <h2 id="user-guide-title" style={{ margin: 0, fontSize: 22 }}>상세 사용 가이드</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="사용 가이드 닫기" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)', color: '#F0EDE8', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </header>

        <main style={{ padding: '20px 18px 40px' }}>
          <div style={{ padding: 18, borderRadius: 18, background: 'linear-gradient(135deg,rgba(232,168,124,0.18),rgba(139,92,246,0.12))', border: '1px solid rgba(232,168,124,0.32)', marginBottom: 18 }}>
            <BookOpen size={26} color="#E8A87C" />
            <h3 style={{ margin: '10px 0 6px', fontSize: 18 }}>가장 쉬운 사용 순서</h3>
            <p style={{ margin: 0, color: '#C7C7D2', fontSize: 13, lineHeight: 1.7 }}>예산 설정 → 거래 기록 → 내역 확인 → 분석·AI 상담 → 월간 리포트 순으로 사용하면 좋아요. AI가 분류한 내용은 저장 전에 한 번 확인해 주세요.</p>
          </div>

          <nav aria-label="가이드 목차" style={{ display: 'grid', gap: 8, marginBottom: 22 }}>
            {sections.map(section => (
              <a key={section.id} href={'#' + section.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, color: '#E5E7EB', textDecoration: 'none', background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 13 }}>
                <span>{section.icon}</span><span style={{ flex: 1 }}>{section.title}</span><ChevronRight size={15} color="#74748A" />
              </a>
            ))}
          </nav>

          <div style={{ display: 'grid', gap: 14 }}>
            {sections.map(section => (
              <section id={section.id} key={section.id} style={{ scrollMarginTop: 92, padding: 18, borderRadius: 16, background: 'rgba(19,19,28,0.78)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 style={{ margin: '0 0 13px', fontSize: 17 }}>{section.icon} {section.title}</h3>
                <ol style={{ margin: 0, paddingLeft: 20, color: '#C7C7D2', fontSize: 13, lineHeight: 1.75 }}>
                  {section.items.map(item => <li key={item} style={{ marginBottom: 7 }}>{item}</li>)}
                </ol>
                {'examples' in section && section.examples && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'rgba(8,8,12,0.55)', border: '1px solid rgba(232,168,124,0.18)' }}>
                    <p style={{ margin: '0 0 7px', color: '#E8A87C', fontSize: 11, fontWeight: 800 }}>입력·질문 예시</p>
                    {section.examples.map(example => <p key={example} style={{ margin: '4px 0', color: '#E5E7EB', fontSize: 12 }}>“{example}”</p>)}
                  </div>
                )}
              </section>
            ))}
          </div>

          <button type="button" onClick={onClose} style={{ width: '100%', marginTop: 20, padding: 14, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#E8A87C,#D4916A)', color: '#111118', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>가이드 닫고 가계부 사용하기</button>
        </main>
      </div>
    </div>
  )
}

