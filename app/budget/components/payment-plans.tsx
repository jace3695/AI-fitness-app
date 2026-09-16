'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { getLocalDateKey } from '@/utils/dateKey';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import ConfirmDialog from '@/components/ConfirmDialog';
import MonthlyCheck from './monthly-check';
import type { ExpenseRecord } from '../lib/category-memory';
import { parsePaymentPlan, paymentPlanChecks, pendingPaymentPlanKey, type PaymentPlan, type PaymentPlanRequest, type PaymentPlanValue } from '../lib/payment-plans';

const blank = (today: string) => ({ name: '', amount: '', day: String(Number(today.slice(8))), month: today.slice(0, 7), subscription: false, lastUsed: '', enabled: true });
const formValue = (plan: PaymentPlan) => ({ name: plan.name, amount: String(plan.amount), day: String(plan.due_day), month: plan.start_month.slice(0, 7), subscription: plan.is_subscription, lastUsed: plan.last_used_on || '', enabled: plan.enabled });
const failure = (error: unknown) => error instanceof Error ? error.message : '예정일 설정을 불러오지 못했어요. 다시 확인해 주세요.';

export default function PaymentPlans({ userId, records, month, budget, ready, currency, compact = false, onManage, onRefreshRecords }: {
  userId: string; records: ExpenseRecord[]; month: string; budget: number | null; ready: boolean; currency: string;
  compact?: boolean; onManage?: () => void; onRefreshRecords: () => Promise<boolean>;
}) {
  const client = useMemo(() => createClient(), []);
  const [today, setToday] = useState(() => getLocalDateKey(new Date()));
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PaymentPlanRequest | null>(null);
  const [editing, setEditing] = useState<{ original: PaymentPlan | null } | null>(null);
  const [draft, setDraft] = useState(() => blank(today));
  const [confirmation, setConfirmation] = useState<PaymentPlanRequest | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busyRef = useRef(false), generation = useRef(0), mounted = useRef(false);
  const refreshRecords = useRef(onRefreshRecords);
  refreshRecords.current = onRefreshRecords;
  useUnsavedChanges(Boolean(editing || pending || busy));
  const money = (value: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: ['KRW', 'USD', 'JPY'].includes(currency) ? currency : 'KRW', maximumFractionDigits: 0 }).format(value);

  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoaded(false);
    const result = await client.from('budget_payment_plans').select('*', { count: 'exact' }).eq('user_id', userId).order('id').limit(100);
    if (result.error || result.count === null || result.count !== result.data?.length || new Set(result.data.map(row => row.id)).size !== result.count) throw new Error('결제 예정일 설정을 모두 불러오지 못했어요. 다시 불러와 주세요.');
    const raw = window.localStorage.getItem(pendingPaymentPlanKey(userId));
    const saved = raw ? JSON.parse(raw) as PaymentPlanRequest : null;
    if (saved && (saved.p_owner !== userId || !saved.p_id || !saved.p_request_id || !('p_value' in saved) || !('p_expected' in saved) || saved.p_expected && saved.p_expected.user_id !== userId)) throw new Error('저장 결과 확인 중인 설정을 읽지 못했어요.');
    if (token !== generation.current || !mounted.current) return null;
    setPlans(result.data as PaymentPlan[]); setPending(saved); setLoaded(true);
    return result.data as PaymentPlan[];
  }, [client, userId]);

  useEffect(() => {
    mounted.current = true;
    void load().catch(reason => { if (mounted.current) setError(failure(reason)); });
    const updateDate = () => { if (document.visibilityState === 'visible') setToday(getLocalDateKey(new Date())); };
    const timer = window.setInterval(updateDate, 60000);
    document.addEventListener('visibilitychange', updateDate);
    return () => { mounted.current = false; generation.current += 1; clearInterval(timer); document.removeEventListener('visibilitychange', updateDate); };
  }, [load]);

  const refresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setLoaded(false); setError(''); setMessage('');
    try {
      if (!await refreshRecords.current()) throw new Error('지출 내역을 다시 불러오지 못했어요.');
      if (await load()) setMessage('예정일과 기록을 다시 불러왔어요.');
    } catch (reason) { if (mounted.current) setError(failure(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const perform = async (request: PaymentPlanRequest) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setLoaded(false); setError(''); setMessage(''); setConfirmation(null);
    try {
      const auth = await client.auth.getUser();
      if (auth.error || auth.data.user?.id !== userId) throw new Error('로그인 계정이 바뀌었어요. 다시 로그인해 주세요.');
      if (!mounted.current) return;
      window.localStorage.setItem(pendingPaymentPlanKey(userId), JSON.stringify(request)); setPending(request);
      const result = await client.rpc('save_budget_payment_plan', request);
      if (!mounted.current) return;
      if (result.error) {
        if (result.error.code === 'P0001' || /^(22|23)/.test(result.error.code || '') || result.error.code === 'PGRST202') {
          window.localStorage.removeItem(pendingPaymentPlanKey(userId)); setPending(null); setEditing(null);
          await load();
          throw new Error(result.error.code === 'P0001' ? result.error.message : result.error.code === '23505' ? '같은 장소의 예정일 설정이 이미 있어요. 해당 설정을 수정해 주세요.' : '예정일 설정을 저장하지 못했어요. 입력을 확인해 주세요.');
        }
        throw new Error('저장 응답을 확인하지 못했어요. 같은 요청 결과를 확인해 주세요.');
      }
      if (result.data?.id !== request.p_id || result.data?.revision !== request.p_request_id || result.data?.deleted !== (request.p_value === null)) throw new Error('저장 응답을 확인하지 못했어요. 같은 요청 결과를 확인해 주세요.');
      const latest = await load();
      if (!latest) return;
      const current = latest.find(plan => plan.id === request.p_id);
      window.localStorage.removeItem(pendingPaymentPlanKey(userId)); setPending(null); setEditing(null);
      if (request.p_value === null ? Boolean(current) : current?.revision !== request.p_request_id) throw new Error('저장 이후 다른 곳에서 설정이 바뀌었어요. 현재 설정을 확인해 주세요.');
      setMessage(request.p_value === null ? '예정일 설정을 삭제했어요. 지출 내역은 유지돼요.' : '예정일 설정을 저장하고 다시 확인했어요.');
    } catch (reason) { if (mounted.current) setError(failure(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const review = () => {
    setError(''); setMessage('');
    try {
      const value = parsePaymentPlan(draft, today);
      setConfirmation({ p_owner: userId, p_id: editing?.original?.id || crypto.randomUUID(), p_request_id: crypto.randomUUID(), p_expected: editing?.original || null, p_value: value });
    } catch (reason) { setError(failure(reason)); }
  };
  const startEdit = (original: PaymentPlan | null) => { setEditing({ original }); setDraft(original ? formValue(original) : blank(today)); setError(''); setMessage(''); };
  const disabled = busy || !loaded || Boolean(pending);
  let checks: ReturnType<typeof paymentPlanChecks> = [], calculationError = '';
  try { if (loaded && ready) checks = paymentPlanChecks(plans, records, compact ? today.slice(0, 7) : month, today); }
  catch (reason) { calculationError = failure(reason); }
  const reminders = checks.filter(item => item.needsReview || (item.unusedDays !== null && item.unusedDays >= 30));
  const describe = (value: PaymentPlanValue) => `${value.name} · 매월 ${value.due_day}일 · ${money(value.amount)} · ${value.start_month.slice(0, 7)}부터 · ${value.enabled ? '안내 사용' : '안내 중지'} · ${value.is_subscription ? `구독 / 마지막 사용 ${value.last_used_on || '미입력'}` : '고정비'}`;

  return <>
    <section className="budget-improvement-card" aria-label={compact ? '오늘의 결제 점검' : '결제 예정일과 구독 관리'}>
      <h3>{compact ? '오늘의 결제 점검' : '결제 예정일과 구독 관리'}</h3>
      <p>가계부를 열었을 때 확인하는 안내예요. 앱을 닫아 둔 상태의 푸시 알림은 제공하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}{calculationError && <p role="alert">{calculationError}</p>}{message && <p role="status">{message}</p>}
      {!loaded || !ready ? <p>전체 지출과 예정일을 확인한 뒤 점검합니다.</p> : !calculationError && <>
        {compact ? reminders.length ? reminders.slice(0, 5).map(item => <p key={item.plan.id}><strong>{item.plan.name}</strong> · {item.needsReview ? `${item.due} 예정 · ${item.days < 0 ? '예정일 지남, 기록 확인 필요' : item.days === 0 ? '오늘 예정' : `${item.days}일 뒤 예정`}` : ''}{item.unusedDays !== null && item.unusedDays >= 30 ? ` · 입력한 마지막 사용일로부터 ${item.unusedDays}일 경과` : ''}</p>) : <p>오늘 확인할 예정일·구독 알림이 없어요. 결제 내역을 자동 조회한 결과는 아닙니다.</p>
          : checks.map(item => <div className="budget-change-row" key={item.plan.id}><div>
            <strong>{item.plan.name} · {item.due} 예정 · {money(item.plan.amount)}</strong>
            <p>{item.recordedCount ? `오늘까지 같은 이름 ${item.recordedCount}건 기록됨` : item.days < 0 ? '예정일이 지났지만 기록 미확인' : item.days === 0 ? '오늘 예정 · 기록 미확인' : `${item.days}일 뒤 예정`}{item.count > item.recordedCount ? ' · 미래 날짜 기록 포함' : ''}</p>
            <p>같은 이름의 이 달 기록 {item.count}건 · {money(item.recordedAmount)}. 실제 납부 여부·결제 취소는 직접 확인해 주세요.</p>
            {item.count === 1 && item.recordedAmount !== item.plan.amount && <p>입력한 예정액과 {money(Math.abs(item.recordedAmount - item.plan.amount))} 차이가 있어요. 요금이 바뀌었는지 실제 내역을 확인해 주세요.</p>}
            {item.plan.is_subscription && <p>{item.unusedDays === null ? '마지막 사용일 미입력 · 사용 여부를 판단하지 않았어요.' : `마지막 사용 ${item.plan.last_used_on} · ${item.unusedDays}일 경과${item.unusedDays >= 30 ? ' · 다음 결제 전 계속 이용할지 점검해 보세요. 실제로 사용했다면 사용일을 수정해 주세요.' : ''}`}</p>}
          </div></div>)}
      </>}
      <div className="budget-plan-actions">
        <button type="button" disabled={busy || Boolean(pending)} onClick={() => void refresh()}>예정일·기록 다시 불러오기</button>
        {compact && <button type="button" onClick={onManage}>결제 예정일 관리</button>}
      </div>
      {pending && <div><p>저장 결과 확인 중인 설정이 있어요. 같은 요청으로 중복 없이 확인합니다.</p><button type="button" disabled={busy} onClick={() => void perform(pending)}>같은 예정일 결과 확인</button></div>}
      {!compact && <>
        <p>월 1회 예정일을 직접 입력해 주세요. 해당 일이 없는 달에는 말일로 표시합니다. 장소는 상세 내역과 같은 이름을 쓰세요. 공백·대소문자 외에는 이름을 합치지 않습니다.</p>
        <p>예정액은 지출로 저장되지 않아요. 이번 달 하루 예산 참고치에는 예정액에서 같은 이름의 기록을 뺀 금액만 반영합니다. 안내 중지·삭제는 실제 구독 해지가 아닙니다.</p>
        <button type="button" disabled={disabled || Boolean(editing) || plans.length >= 100} onClick={() => startEdit(null)}>결제 예정일 추가</button>
        <details><summary>저장한 예정일 · {plans.length}개</summary>
          {plans.map(plan => <div className="budget-change-row" key={plan.id}>
            <p>{describe(plan)}</p>
            <div className="budget-plan-actions"><button type="button" disabled={disabled || Boolean(editing)} aria-label={`${plan.name} 예정일 수정`} onClick={() => startEdit(plan)}>수정</button>
              <button type="button" disabled={disabled || Boolean(editing)} aria-label={`${plan.name} 예정일 삭제`} onClick={() => setConfirmation({ p_owner: userId, p_id: plan.id, p_request_id: crypto.randomUUID(), p_expected: plan, p_value: null })}>삭제</button></div>
          </div>)}
        </details>
        {editing && !pending && <form onSubmit={event => { event.preventDefault(); review(); }} aria-label="결제 예정일 입력">
          <fieldset className="budget-plan-form" disabled={disabled}>
            <legend>{editing.original ? '예정일 수정' : '새 결제 예정일'}</legend>
            <label>내역의 장소 이름<input aria-label="내역의 장소 이름" value={draft.name} maxLength={200} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>월 예정 금액<input aria-label="월 예정 금액" inputMode="numeric" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
            <label>매월 결제일<input aria-label="매월 결제일" inputMode="numeric" value={draft.day} onChange={event => setDraft({ ...draft, day: event.target.value })} /></label>
            <label>시작 월<input aria-label="시작 월" type="month" value={draft.month} onChange={event => setDraft({ ...draft, month: event.target.value })} /></label>
            <label><input type="checkbox" checked={draft.subscription} onChange={event => setDraft({ ...draft, subscription: event.target.checked })} /> 구독 서비스</label>
            {draft.subscription && <label>마지막 사용일 (선택)<input aria-label="마지막 사용일" type="date" max={today} value={draft.lastUsed} onChange={event => setDraft({ ...draft, lastUsed: event.target.value })} /></label>}
            <label><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> 예정일 안내와 예상액 반영</label>
            <div className="budget-plan-actions"><button type="submit">예정일 저장 전 확인</button><button type="button" onClick={() => setEditing(null)}>입력 취소</button></div>
          </fieldset>
        </form>}
      </>}
      <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.p_value ? '결제 예정일 저장' : '결제 예정일 삭제'} description="변경 내용을 확인해 주세요." confirmLabel={confirmation?.p_value ? '설정 저장' : '설정 삭제'} onCancel={() => setConfirmation(null)} onConfirm={() => { if (confirmation) void perform(confirmation); }}>
        <div className="budget-edit-preview"><p>변경 전: {confirmation?.p_expected ? describe(confirmation.p_expected) : '새 설정'}</p><p>변경 후: {confirmation?.p_value ? describe(confirmation.p_value) : '예정일 안내 삭제 · 지출 내역 유지'}</p></div>
      </ConfirmDialog>
    </section>
    {!compact && <MonthlyCheck records={records} month={month} today={today} budget={budget} ready={ready && loaded && !pending && !calculationError} currency={currency} plans={plans} />}
  </>;
}
