'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'

type HistoryType = 'all' | 'income' | 'expense' | 'saving'

type HistoryScreenProps = {
  incomeList: any[]
  transactions: any[]
  savings: any[]
  currency: string
  processingRecordKey: string
  onDeleteIncome: (id: string) => void
  onDeleteExpense: (id: string) => void
  onDeleteSaving: (id: string) => void
  onNavigateInput: () => void
  onNotice: (message: string) => void
}

const CATEGORY_MAP: Record<string, { icon: string; color: string }> = {
  식비: { icon: '🍔', color: '#FF6B6B' }, 카페: { icon: '☕', color: '#C8956C' }, 교통: { icon: '🚗', color: '#4ECDC4' },
  쇼핑: { icon: '🛍️', color: '#A78BFA' }, 생활용품: { icon: '🧴', color: '#22C55E' }, 배달: { icon: '🛵', color: '#FB923C' },
  문화: { icon: '🎬', color: '#34D399' }, 의료: { icon: '💊', color: '#F472B6' }, 구독: { icon: '📱', color: '#60A5FA' },
  통신비: { icon: '📞', color: '#38BDF8' }, 공과금: { icon: '💡', color: '#FBBF24' }, 보험: { icon: '🛡️', color: '#818CF8' },
  월세: { icon: '🏠', color: '#F97316' }, 대출: { icon: '🏦', color: '#F87171' }, 관리비: { icon: '🏢', color: '#FBBF24' },
  취미: { icon: '🎯', color: '#A3E635' }, 기타: { icon: '📦', color: '#9CA3AF' }
}

function formatDisplayCurrency(n: number, currency: string) {
  const locale = currency === 'USD' ? 'en-US' : currency === 'JPY' ? 'ja-JP' : 'ko-KR'
  const code = currency === 'USD' || currency === 'JPY' ? currency : 'KRW'
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(n)
}

function getCategoryIcon(category?: string) {
  return CATEGORY_MAP[category || '']?.icon || '📌'
}

function getCardStyle(borderColor = '#1A1A24') {
  return { background: 'linear-gradient(180deg, rgba(24,24,36,0.88) 0%, rgba(19,19,28,0.82) 100%)', border: `1px solid ${borderColor}`, borderRadius: 18, padding: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.22)', backdropFilter: 'blur(8px)' } as const
}

function getPaymentBadgeStyle(payment?: string) {
  const colorMap: Record<string, string> = { 체크카드: '#60A5FA', 현금: '#34D399', 계좌이체: '#F59E0B', '휴대폰 소액결제': '#F472B6', 충전카드: '#A78BFA' }
  const color = colorMap[payment || ''] || '#9CA3AF'
  return { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color, background: `${color}22`, border: `1px solid ${color}55` } as const
}

export default function HistoryScreen({ incomeList, transactions, savings, currency, processingRecordKey, onDeleteIncome, onDeleteExpense, onDeleteSaving, onNavigateInput, onNotice }: HistoryScreenProps) {
  const [showAllIncomeList, setShowAllIncomeList] = useState(false)
  const [showAllExpenseList, setShowAllExpenseList] = useState(false)
  const [showAllSavingsList, setShowAllSavingsList] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [historyStartDate, setHistoryStartDate] = useState('')
  const [historyEndDate, setHistoryEndDate] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState<HistoryType>('all')
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState('all')
  const formatKRW = (n: number) => formatDisplayCurrency(n, currency)
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')
  const matchesHistoryDate = (date?: string) => (!historyStartDate || String(date || '') >= historyStartDate) && (!historyEndDate || String(date || '') <= historyEndDate)
  const includesHistoryQuery = (...values: unknown[]) => !normalizedSearchQuery || values.some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(normalizedSearchQuery))
  const filteredIncomeItems = incomeList.filter((item: any) => (historyTypeFilter === 'all' || historyTypeFilter === 'income') && matchesHistoryDate(item.date) && includesHistoryQuery(item.name, item.memo, item.date))
  const filteredExpenseItems = transactions.filter((item: any) => (historyTypeFilter === 'all' || historyTypeFilter === 'expense') && (historyCategoryFilter === 'all' || item.category === historyCategoryFilter) && matchesHistoryDate(item.date) && includesHistoryQuery(item.place, item.category, item.memo, item.payment, item.date))
  const filteredSavingItems = savings.filter((item: any) => (historyTypeFilter === 'all' || historyTypeFilter === 'saving') && matchesHistoryDate(item.date) && includesHistoryQuery(item.goal_name, item.memo, item.date))
  const historyCategoryOptions = Array.from(new Set(transactions.map((item: any) => String(item.category || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko-KR'))
  const resetHistoryFilters = () => { setSearchQuery(''); setHistoryStartDate(''); setHistoryEndDate(''); setHistoryTypeFilter('all'); setHistoryCategoryFilter('all') }
  const exportFilteredHistoryCsv = () => {
    const rows = [
      ...filteredIncomeItems.map((item: any) => ({ date: item.date, type: '수입', name: item.name || '', category: item.category || '', payment: '', amount: Number(item.amount || 0), memo: item.memo || '' })),
      ...filteredExpenseItems.map((item: any) => ({ date: item.date, type: '지출', name: item.place || '', category: item.category || '', payment: item.payment || '', amount: Number(item.amount || 0), memo: item.memo || '' })),
      ...filteredSavingItems.map((item: any) => ({ date: item.date, type: '저축', name: item.goal_name || '일반저축', category: '저축', payment: '', amount: Number(item.amount || 0), memo: item.memo || '' }))
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)))
    if (!rows.length) { onNotice('내보낼 내역이 없어요.'); return }
    const escapeCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const header = ['날짜', '유형', '내용', '카테고리', '결제수단', '금액', '메모']
    const csv = [header.map(escapeCsvCell).join(','), ...rows.map((row) => [row.date, row.type, row.name, row.category, row.payment, row.amount, row.memo].map(escapeCsvCell).join(','))].join('\\r\\n')
    const blob = new Blob(['\\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ai-budget-${historyStartDate || 'all'}-${historyEndDate || new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
    onNotice(`${rows.length}건을 CSV로 내보냈어요.`)
  }
  const visibleIncomeItems = showAllIncomeList ? filteredIncomeItems : filteredIncomeItems.slice(0, 5)
  const visibleExpenseItems = showAllExpenseList ? filteredExpenseItems : filteredExpenseItems.slice(0, 5)
  const visibleSavingItems = showAllSavingsList ? filteredSavingItems : filteredSavingItems.slice(0, 5)
  const handleDeleteIncome = onDeleteIncome
  const handleDelete = onDeleteExpense
  const handleDeleteSaving = onDeleteSaving

  return (
    <main className="living-finance-view history-screen app-safe-top" style={{ padding: '24px 20px 80px' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px' }}>상세 내역</h2>
    
              <label className="history-search-field">
                <Search size={18} aria-hidden="true" />
                <input aria-label="상세 내역 검색" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="장소, 카테고리, 결제수단, 메모 검색" />
              </label>
    
              <section aria-label="상세 내역 필터" style={{ ...getCardStyle(), padding: 12, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 5, color: '#E0E0EA', fontSize: 12 }}>
                    시작일
                    <input type="date" value={historyStartDate} max={historyEndDate || undefined} onChange={(e) => setHistoryStartDate(e.target.value)} style={{ minHeight: 42, borderRadius: 9, border: '1px solid #2A2A3E', padding: '8px 10px' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 5, color: '#E0E0EA', fontSize: 12 }}>
                    종료일
                    <input type="date" value={historyEndDate} min={historyStartDate || undefined} onChange={(e) => setHistoryEndDate(e.target.value)} style={{ minHeight: 42, borderRadius: 9, border: '1px solid #2A2A3E', padding: '8px 10px' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 5, color: '#E0E0EA', fontSize: 12 }}>
                    유형
                    <select value={historyTypeFilter} onChange={(e) => setHistoryTypeFilter(e.target.value as 'all' | 'income' | 'expense' | 'saving')} style={{ minHeight: 42, borderRadius: 9, border: '1px solid #2A2A3E', padding: '8px 10px' }}>
                      <option value="all">전체</option>
                      <option value="income">수입</option>
                      <option value="expense">지출</option>
                      <option value="saving">저축</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 5, color: '#E0E0EA', fontSize: 12 }}>
                    지출 카테고리
                    <select value={historyCategoryFilter} disabled={historyTypeFilter === 'income' || historyTypeFilter === 'saving'} onChange={(e) => setHistoryCategoryFilter(e.target.value)} style={{ minHeight: 42, borderRadius: 9, border: '1px solid #2A2A3E', padding: '8px 10px' }}>
                      <option value="all">전체</option>
                      {historyCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={resetHistoryFilters} style={{ minHeight: 40, flex: '1 1 120px', borderRadius: 9, border: '1px solid #2A2A3E', padding: '8px 12px', cursor: 'pointer' }}>필터 초기화</button>
                  <button type="button" onClick={exportFilteredHistoryCsv} style={{ minHeight: 40, flex: '1 1 150px', borderRadius: 9, border: '1px solid #4ECDC4', padding: '8px 12px', cursor: 'pointer', color: '#4ECDC4' }}>현재 결과 CSV 저장</button>
                </div>
                <p aria-live="polite" style={{ color: '#9CA3AF', fontSize: 11, margin: '10px 0 0' }}>
                  총 {filteredIncomeItems.length + filteredExpenseItems.length + filteredSavingItems.length}건
                </p>
              </section>
    
              {filteredSavingItems.length > 0 && (
                <>
                  <p style={{ color: '#4ECDC4', fontSize: 12, margin: '0 0 8px', letterSpacing: 1 }}>저축 내역</p>
                  {visibleSavingItems.map((item: any) => (
                    <div key={item.id} style={{ ...getCardStyle('#21403A'), borderRadius: 14, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4ECDC422', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💰</div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{item.goal_name || '일반저축'}</p>
                        <p style={{ color: '#E0E0EA', fontSize: 11, margin: 0 }}>저축 · {item.date}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ color: '#4ECDC4', fontSize: 15, fontFamily: 'monospace', fontWeight: 700, margin: '0 0 2px' }}>+{formatKRW(item.amount)}</p>
                        <button type="button" aria-label={`${item.goal_name || '저축'} 내역 삭제`} onClick={() => handleDeleteSaving(item.id)} disabled={Boolean(processingRecordKey)} style={{ minHeight: 36, background: '#FF6B6B22', border: '1px solid #FF6B6B', borderRadius: 8, color: '#FF6B6B', fontSize: 12, fontWeight: 600, cursor: processingRecordKey ? 'not-allowed' : 'pointer', padding: '6px 10px', opacity: processingRecordKey && processingRecordKey !== `saving:${item.id}` ? 0.45 : 1 }}>{processingRecordKey === `saving:${item.id}` ? '삭제 중…' : '삭제'}</button>
                      </div>
                    </div>
                  ))}
                  {filteredSavingItems.length > 5 && (
                    <button onClick={() => setShowAllSavingsList(!showAllSavingsList)} style={{ width: '100%', background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 10, padding: '10px', cursor: 'pointer', color: '#4ECDC4', fontSize: 13, marginBottom: 12 }}>
                      {showAllSavingsList ? '▲ 접기' : `▼ 더보기 (${filteredSavingItems.length - 5}건)`}
                    </button>
                  )}
                  <div style={{ height: 12 }} />
                </>
              )}
    
              {filteredIncomeItems.length > 0 && (
                <>
                  <p style={{ color: '#4ECDC4', fontSize: 12, margin: '0 0 8px', letterSpacing: 1 }}>수입 내역</p>
                  {visibleIncomeItems.map((item: any) => (
                    <div key={item.id} style={{ ...getCardStyle('#1E3A34'), borderRadius: 14, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4ECDC422', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💚</div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{item.name}</p>
                        <p style={{ color: '#E0E0EA', fontSize: 11, margin: 0 }}>수입 · {item.date}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ color: '#4ECDC4', fontSize: 15, fontFamily: 'monospace', fontWeight: 700, margin: '0 0 2px' }}>+{formatKRW(item.amount)}</p>
                        <button type="button" aria-label={`${item.name || '수입'} 내역 삭제`} onClick={() => handleDeleteIncome(item.id)} disabled={Boolean(processingRecordKey)} style={{ minHeight: 36, background: '#FF6B6B22', border: '1px solid #FF6B6B', borderRadius: 8, color: '#FF6B6B', fontSize: 12, fontWeight: 600, cursor: processingRecordKey ? 'not-allowed' : 'pointer', padding: '6px 10px', opacity: processingRecordKey && processingRecordKey !== `income:${item.id}` ? 0.45 : 1 }}>{processingRecordKey === `income:${item.id}` ? '삭제 중…' : '삭제'}</button>
                      </div>
                    </div>
                  ))}
                  {filteredIncomeItems.length > 5 && (
                    <button onClick={() => setShowAllIncomeList(!showAllIncomeList)} style={{ width: '100%', background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 10, padding: '10px', cursor: 'pointer', color: '#4ECDC4', fontSize: 13, marginBottom: 12 }}>
                      {showAllIncomeList ? '▲ 접기' : `▼ 더보기 (${filteredIncomeItems.length - 5}건)`}
                    </button>
                  )}
                  <div style={{ height: 12 }} />
                </>
              )}
    
              {filteredExpenseItems.length > 0 && (
                <>
                  <p style={{ color: '#FF6B6B', fontSize: 12, margin: '0 0 8px', letterSpacing: 1 }}>지출 내역</p>
                  {visibleExpenseItems.map((t: any) => {
                    const meta = CATEGORY_MAP[t.category] || CATEGORY_MAP['기타']
                    return (
                      <div key={t.id} style={{ ...getCardStyle('#232335'), borderRadius: 14, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{meta.icon}</div>
                        <div style={{ flex: 1 }}>
                          <p style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{t.place}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: '#E0E0EA', fontSize: 11 }}>{getCategoryIcon(t.category)} {t.category}</span>
                            <span style={{ color: '#6A6A7A', fontSize: 11 }}>·</span>
                            <span style={{ color: '#E0E0EA', fontSize: 11 }}>{t.date}</span>
                            {t.payment && <span style={getPaymentBadgeStyle(t.payment)}>{t.payment}</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ color: '#FF6B6B', fontSize: 15, fontFamily: 'monospace', fontWeight: 700, margin: '0 0 2px' }}>-{formatKRW(t.amount)}</p>
                          <button type="button" aria-label={`${t.place || '지출'} 내역 삭제`} onClick={() => handleDelete(t.id)} disabled={Boolean(processingRecordKey)} style={{ minHeight: 36, background: '#FF6B6B22', border: '1px solid #FF6B6B', borderRadius: 8, color: '#FF6B6B', fontSize: 12, fontWeight: 600, cursor: processingRecordKey ? 'not-allowed' : 'pointer', padding: '6px 10px', opacity: processingRecordKey && processingRecordKey !== `expense:${t.id}` ? 0.45 : 1 }}>{processingRecordKey === `expense:${t.id}` ? '삭제 중…' : '삭제'}</button>
                        </div>
                      </div>
                    )
                  })}
                  {filteredExpenseItems.length > 5 && (
                    <button onClick={() => setShowAllExpenseList(!showAllExpenseList)} style={{ width: '100%', background: 'rgba(26,26,46,0.75)', border: '1px solid #2A2A3E', borderRadius: 10, padding: '10px', cursor: 'pointer', color: '#4ECDC4', fontSize: 13, marginBottom: 12 }}>
                      {showAllExpenseList ? '▲ 접기' : `▼ 더보기 (${filteredExpenseItems.length - 5}건)`}
                    </button>
                  )}
                  <div style={{ height: 12 }} />
                </>
              )}
    
              {filteredIncomeItems.length === 0 && filteredExpenseItems.length === 0 && filteredSavingItems.length === 0 && !searchQuery && (
                <div style={{ background: 'rgba(19,19,28,0.72)', border: '1px solid #1A1A24', borderRadius: 16, padding: '28px 20px', textAlign: 'center', marginTop: 8 }}>
                  <p style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>아직 데이터가 없어요</p>
                  <p style={{ color: '#AEB7C6', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                    먼저 기록 탭에서 지출이나 수입을 입력해보세요.
                  </p>
                  <button type="button" onClick={onNavigateInput} style={{ minHeight: 44, marginTop: 14, border: 'none', borderRadius: 12, padding: '10px 16px', color: '#FFFFFF', background: '#668A73', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    첫 기록 남기기
                  </button>
                </div>
              )}
    
              {searchQuery && filteredIncomeItems.length === 0 && filteredExpenseItems.length === 0 && filteredSavingItems.length === 0 && (
                <div style={{ background: 'rgba(19,19,28,0.72)', border: '1px solid #1A1A24', borderRadius: 16, padding: '24px 20px', textAlign: 'center', marginTop: 8 }}>
                  <p style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>검색 결과가 없어요</p>
                  <p style={{ color: '#AEB7C6', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                    장소명, 카테고리, 날짜처럼 다른 키워드로 다시 검색해보세요.
                  </p>
                  <button type="button" onClick={() => setSearchQuery('')} style={{ minHeight: 44, marginTop: 14, border: '1px solid rgba(102,138,115,.35)', borderRadius: 12, padding: '10px 16px', color: '#4F705C', background: 'rgba(102,138,115,.1)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    검색어 지우기
                  </button>
                </div>
              )}
            </main>
  )
}
