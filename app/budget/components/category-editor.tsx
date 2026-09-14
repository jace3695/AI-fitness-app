'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import { CATEGORY_CHOICES, pendingCategoryKey, type CategoryChange, type CategoryRequest, type CategoryRule, type ExpenseRecord } from '../lib/category-memory';

export default function CategoryEditor({ userId, records, onChanged }: { userId: string; records: ExpenseRecord[]; onChanged: () => Promise<void> }) {
  const client = useMemo(() => createClient(), []);
  const [selected, setSelected] = useState<ExpenseRecord[]>([]);
  const [category, setCategory] = useState('기타');
  const [remember, setRemember] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [history, setHistory] = useState<CategoryChange[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [pending, setPending] = useState<CategoryRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [undoId, setUndoId] = useState<string | null>(null);
  const [forgetRule, setForgetRule] = useState<CategoryRule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [changeDetails, setChangeDetails] = useState<Record<string, { transaction_id: string; before_category: string | null }[]>>({});
  const [reload, setReload] = useState(0);
  useUnsavedChanges(Boolean(selected.length || pending || busy));

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    const load = async () => {
      try {
        const [changes, memories] = await Promise.all([
          client.from('budget_category_changes').select('id,category,entry_count,created_at,undone_at').eq('user_id', userId).order('created_at', { ascending: false }).order('id').limit(20),
          client.from('budget_category_rules').select('merchant_key,category,revision', { count: 'exact' }).eq('user_id', userId).order('merchant_key').limit(1000),
        ]);
        if (changes.error || memories.error || memories.count !== memories.data?.length) throw new Error('분류 이력을 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.');
        const raw = window.localStorage.getItem(pendingCategoryKey(userId));
        const saved = raw ? JSON.parse(raw) as CategoryRequest : null;
        if (saved && (!saved.p_request_id || !Array.isArray(saved.p_rows) || !saved.p_rows.length || saved.p_rows.some(row => row.expected?.user_id !== userId))) throw new Error('확인 중인 분류 변경을 읽지 못했어요.');
        if (cancelled) return;
        setHistory(changes.data || []); setRules(memories.data || []); setPending(saved); setLoaded(true);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : '분류 이력 조회에 실패했어요.'); }
    };
    void load();
    return () => { cancelled = true; };
  }, [client, userId, reload]);

  const perform = async (operation: () => Promise<string>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: authError } = await client.auth.getUser();
      if (authError || data.user?.id !== userId) throw new Error('로그인 계정이 바뀌었어요. 다시 로그인해 주세요.');
      const result = await operation();
      setMessage(result); setSelected([]); setConfirmation(false); setUndoId(null); setForgetRule(null);
      await onChanged();
      setReload(value => value + 1);
    } catch (reason) { setConfirmation(false); setUndoId(null); setForgetRule(null); setError(reason instanceof Error ? reason.message : '처리 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = () => perform(async () => {
    const request = pending || { p_request_id: crypto.randomUUID(), p_rows: selected.map(record => ({ id: record.id, expected: record })), p_category: category, p_remember: remember };
    window.localStorage.setItem(pendingCategoryKey(userId), JSON.stringify(request));
    setPending(request);
    const { data, error: rpcError } = await client.rpc('change_budget_categories', request);
    if (rpcError) {
      if (rpcError.code === 'P0001' || /^(22|23)/.test(rpcError.code || '') || rpcError.code === 'PGRST202') {
        window.localStorage.removeItem(pendingCategoryKey(userId)); setPending(null); setConfirmation(false); setSelected([]);
        await onChanged();
        throw new Error(rpcError.code === 'P0001' ? rpcError.message : '분류 변경을 저장하지 못했어요. 내역을 다시 확인해 주세요.');
      }
      throw new Error('변경 응답을 확인하지 못했어요. “같은 변경 결과 확인”으로 중복 없이 확인해 주세요.');
    }
    window.localStorage.removeItem(pendingCategoryKey(userId)); setPending(null);
    return data?.undone ? '이미 되돌린 변경입니다. 현재 기록을 유지했어요.' : `${data?.count}건의 분류 변경을 확인했어요.`;
  });
  const undo = () => perform(async () => {
    const { error: rpcError } = await client.rpc('undo_budget_category_change', { p_change_id: undoId });
    if (rpcError) throw new Error(rpcError.code === 'P0001' ? rpcError.message : '되돌리기 결과를 확인하지 못했어요. 같은 이력으로 다시 확인해 주세요.');
    return '분류와 함께 기억한 설정을 변경 전으로 되돌렸어요.';
  });
  const forget = () => perform(async () => {
    if (!forgetRule) throw new Error('지울 분류 기억을 확인해 주세요.');
    const { data, error: deleteError } = await client.from('budget_category_rules').delete().eq('user_id', userId).eq('merchant_key', forgetRule.merchant_key).eq('revision', forgetRule.revision).select('merchant_key');
    if (deleteError || !data?.length) throw new Error('분류 기억이 바뀌었거나 삭제 결과를 확인하지 못했어요. 다시 불러와 주세요.');
    return '분류 기억을 지웠어요. 저장된 지출 분류는 유지됩니다.';
  });
  const showDetails = async (id: string) => {
    const { data, error: detailsError } = await client.from('budget_category_change_items').select('transaction_id,before_category').eq('user_id', userId).eq('change_id', id).order('transaction_id').limit(100);
    if (detailsError) { setError('변경 전 분류를 읽지 못했어요. 다시 확인해 주세요.'); return; }
    setChangeDetails(current => ({ ...current, [id]: data || [] }));
  };

  const disabled = busy || !loaded || Boolean(pending);
  return <section className="budget-improvement-card" aria-label="분류 수정과 변경 이력">
    <h3>분류 수정과 변경 이력</h3>
    <p>내역을 선택해 분류를 함께 바꿀 수 있어요. “이 장소의 분류 기억”을 켜면 다음 입력의 확인 화면에 반영됩니다.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button type="button" disabled={busy || Boolean(pending)} onClick={() => { setError(''); setSelected([]); setReload(value => value + 1); void onChanged(); }}>분류 이력 다시 불러오기</button>
    {pending ? <div><p>저장 결과 확인 중인 변경이 있어요. 새 분류 변경 전에 같은 요청을 확인해 주세요.</p><button type="button" disabled={busy} onClick={() => void save()}>같은 변경 결과 확인</button></div> : <>
      <div className="budget-category-select-list">
        {records.slice(0, 100).map(record => <label key={record.id}>
          <input type="checkbox" disabled={disabled} aria-label={`${record.place || '이름 없는 지출'} ${record.date} 분류 선택`} checked={selected.some(item => item.id === record.id)} onChange={event => setSelected(current => event.target.checked ? [...current, record] : current.filter(item => item.id !== record.id))} />
          <span>{record.place || '이름 없는 지출'} · {record.date} · {record.category || '미분류'}</span>
        </label>)}
      </div>
      {records.length > 100 && <p>검색 결과 중 처음 100건을 표시합니다. 상세 내역 필터로 범위를 줄여 주세요.</p>}
      <div className="budget-category-controls">
        <label>변경할 분류 <select disabled={disabled} value={category} onChange={event => setCategory(event.target.value)}>{CATEGORY_CHOICES.map(choice => <option key={choice}>{choice}</option>)}</select></label>
        <label><input type="checkbox" disabled={disabled} checked={remember} onChange={event => setRemember(event.target.checked)} /> 이 장소의 분류 기억</label>
        <button type="button" disabled={disabled || !selected.length} onClick={() => setConfirmation(true)}>선택 {selected.length}건 분류 변경</button>
      </div>
    </>}
    <details><summary>분류 변경 이력 · 최근 20건</summary>
      <p>분류 변경과 함께 기억한 설정을 되돌립니다. 이후 수정·삭제된 내역이나 바뀐 분류 기억이 있으면 전체 되돌리기를 중단합니다.</p>
      {history.length === 0 && <p>아직 분류 변경 이력이 없어요.</p>}
      {history.map(change => <div key={change.id} className="budget-change-row">
        <span>{new Date(change.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {change.entry_count}건 → {change.category}</span>
        <button type="button" disabled={busy} onClick={() => void showDetails(change.id)} aria-label={`${change.category} ${change.entry_count}건 변경 전후 보기`}>변경 전후</button>
        {change.undone_at ? <span>되돌림 완료</span> : <button type="button" disabled={disabled} aria-label={`${change.category} ${change.entry_count}건 분류 되돌리기`} onClick={() => setUndoId(change.id)}>분류 되돌리기</button>}
        {changeDetails[change.id] && <div style={{ flexBasis: '100%' }}>
          {changeDetails[change.id].map(item => <p key={item.transaction_id}>{records.find(record => record.id === item.transaction_id)?.place || `내역 ${item.transaction_id.slice(-6)}`} · {item.before_category || '미분류'} → {change.category}</p>)}
          {changeDetails[change.id].length < change.entry_count && <p>삭제한 내역의 상세 이력은 남기지 않습니다.</p>}
        </div>}
      </div>)}
    </details>
    <details><summary>기억한 분류 · {rules.length}개</summary>
      <p>같은 장소 이름에만 적용합니다. 분류 기억을 지워도 이미 저장한 내역은 바뀌지 않아요.</p>
      {rules.map(rule => <div className="budget-change-row" key={rule.merchant_key}><span>{rule.merchant_key} → {rule.category}</span><button type="button" disabled={disabled} onClick={() => setForgetRule(rule)} aria-label={`${rule.merchant_key} 분류 기억 지우기`}>기억 지우기</button></div>)}
    </details>
    <ConfirmDialog open={confirmation} title="선택한 분류 변경" description={`${selected.length}건을 ${category}(으)로 바꿉니다.${remember ? ' 같은 장소의 다음 입력에도 이 분류를 제안합니다.' : ''} 금액과 날짜는 유지됩니다.`} confirmLabel="분류 변경" busy={busy} onCancel={() => setConfirmation(false)} onConfirm={() => void save()} />
    <ConfirmDialog open={Boolean(undoId)} title="분류 변경 되돌리기" description="이 변경에 포함된 분류와 분류 기억을 변경 전으로 되돌립니다. 이후 바뀐 내역이 있으면 중단합니다." confirmLabel="되돌리기" busy={busy} onCancel={() => setUndoId(null)} onConfirm={() => void undo()} />
    <ConfirmDialog open={Boolean(forgetRule)} title="분류 기억 지우기" description={`${forgetRule?.merchant_key || ''}의 분류 기억을 지웁니다. 다음 입력부터 기본 분류 제안을 사용해요.`} confirmLabel="기억 지우기" busy={busy} onCancel={() => setForgetRule(null)} onConfirm={() => void forget()} />
  </section>;
}
