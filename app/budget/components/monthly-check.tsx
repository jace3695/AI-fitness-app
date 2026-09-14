'use client';

import { buildMonthlyCheck } from '../lib/monthly-check';
import type { ExpenseRecord } from '../lib/category-memory';
import type { PaymentPlan } from '../lib/payment-plans';

export default function MonthlyCheck({ records, month, today, budget, ready, currency, plans = [] }: { records: ExpenseRecord[]; month: string; today: string; budget: number | null; ready: boolean; currency: string; plans?: PaymentPlan[] }) {
  const money = (amount: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: ['KRW', 'USD', 'JPY'].includes(currency) ? currency : 'KRW', maximumFractionDigits: 0 }).format(amount);
  let check;
  try { check = ready ? buildMonthlyCheck(records, month, today, budget, plans) : null; }
  catch (error) { return <section className="budget-improvement-card" aria-label="월별 지출 점검"><h3>월별 지출 점검</h3><p role="alert">{error instanceof Error ? error.message : '기록을 확인해 주세요.'}</p></section>; }
  return <section className="budget-improvement-card" aria-label="월별 지출 점검">
    <h3>월별 지출 점검</h3>
    {!check ? <p>전체 내역과 예산을 확인한 뒤 계산합니다. 조회 오류가 있으면 다시 불러와 주세요.</p> : <>
      <p>선택한 달: {month} · 입력한 기록으로 계산합니다. 누락된 지출이나 결제 취소는 별도 확인이 필요해요.</p>
      <h4>하루 예산 참고치</h4>
      {check.daily === null ? <p>이번 달을 선택하고 월 예산을 저장하면 계산할 수 있어요.</p> : <>
        <p>오늘을 포함해 하루 {money(check.daily)} · 남은 {check.remainingDays}일</p>
        <p>월 예산 {money(budget!)} − 이번 달 기록 {money(check.spent)} − 미기록 고정 항목 예상 {money(check.reserved)}를 남은 날짜로 나눴어요. 실제 계좌 잔액이나 사용 가능한 금액은 아닙니다.</p>
        {plans.length > 0 && <p>입력한 예정액 중 같은 이름의 이번 달 기록을 뺀 {money(check.plannedReserved)}가 포함돼요. 같은 이름의 지난달 추정액을 다시 더하지 않습니다. 안내를 중지한 설정은 예상액에서도 제외해요.</p>}
        {check.remaining! < 0 && <p>기록과 고정 항목 예상액이 예산보다 {money(-check.remaining!)} 많아요. 추가 지출 전에 내역과 예산을 확인해 주세요.</p>}
      </>}
      <details><summary>중복 후보 · {check.duplicates.length}묶음</summary>
        <p>날짜·장소·금액·결제수단·거래 종류가 같은 기록입니다. 실제로 여러 번 결제했을 수 있으므로 상세 내역에서 확인 후 삭제해 주세요. 자동 삭제하지 않습니다.</p>
        {check.duplicates.map(group => <p key={group.ids[0]}>{group.place} · {group.date} · {money(group.amount)} · 같은 기록 {group.count}건</p>)}
      </details>
      <details><summary>고정 항목·구독 점검 · {check.fixed.length}개</summary>
        <p>고정 분류의 이번 달과 지난달 기록을 비교해요. 기록 없음은 미납 확정이 아닙니다. 한 달에 여러 건이면 금액 변경으로 단정하지 않아요.</p>
        {check.fixed.map(item => <div className="budget-change-row" key={item.name}><div>
          <strong>{item.name} · {item.category}</strong>
          <p>{item.recordedCount ? `조회 기준일까지 ${item.recordedCount}건 기록됨` : item.currentCount ? '미래 날짜 기록만 있음' : '이번 달 기록 미확인'} · 이번 달 {money(item.currentAmount)} / 지난달 {money(item.previousAmount)}</p>
          {item.change !== null && item.change !== 0 && <p>각 달 1건 기준 {money(Math.abs(item.change))} {item.change > 0 ? '증가' : '감소'} · 결제 내역에서 금액 변경 여부를 확인해 주세요.</p>}
          {item.estimatedUnrecorded > 0 && <p>지난달 1건을 바탕으로 {money(item.estimatedUnrecorded)}를 하루 참고치에서 먼저 남겨뒀어요.</p>}
        </div></div>)}
      </details>
      <h4>이번 달 확인할 행동</h4>
      {!check.currentCount || !check.previousCount ? <p>선택한 달과 지난달의 같은 기간 기록이 충분하지 않아 증가 항목을 판단하지 않았어요.</p> : check.increases.length ? check.increases.map(item => <div className="budget-change-row" key={item.category}><div>
        <strong>{item.category} · {money(item.increase)} 증가</strong>
        <p>현재 {money(item.currentAmount)} / 지난달 1~{check.comparisonDay}일 {money(item.previousAmount)}. 기록 건수 {item.previousCount}→{item.currentCount}건 · 건당 평균 {item.previousAverage === null ? '지난달 기록 없음' : money(item.previousAverage)}→{money(item.currentAverage)}.</p>
        {item.merchants.map(merchant => <p key={merchant.name}>{merchant.name}: {merchant.previousCount}→{merchant.currentCount}건, {money(merchant.previousAmount)}→{money(merchant.currentAmount)} · {money(merchant.increase)} 증가</p>)}
        <p>증가액이 큰 사용처 최대 2개를 표시했어요. 상품 가격 인상이나 낭비로 단정할 수는 없어요. 다음 지출 전에 이 사용처의 내역을 열어 중복·누락을 확인하고 줄일 수 있는 한 건을 골라보세요.</p>
      </div></div>) : <p>같은 기간 기록에서 증가한 분류가 없어요. 빠뜨린 기록이 있는지 먼저 확인해 주세요.</p>}
    </>}
  </section>;
}
