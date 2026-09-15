import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseBudgetAmountCommand, isBudgetCommandProposal, matchesBudgetReceipt, type BudgetCommandProposal, type BudgetCommandReceipt } from '../lib/assistant-budget-command.ts';
import { applyBudgetAmount, proposeBudgetAmount } from '../lib/assistant-budget-server.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';

const owner = randomUUID(), transactionId = randomUUID();
const original = { id: transactionId, user_id: owner, date: '2026-09-15', place: '합성 카페', amount: 5000, category: '카페', payment: '체크카드', transaction_type: '일반 지출', memo: 'keep' };
const proposal = (): BudgetCommandProposal => ({ domain: 'budget', operation: 'update', requestId: randomUUID(), expected: original, amount: 4500, expiresAt: new Date(Date.now() + 900000).toISOString() });
const receipt = (p: BudgetCommandProposal): BudgetCommandReceipt => ({ id: p.requestId, category: null, field_name: 'amount', field_value: p.amount, entry_count: 1, created_at: new Date().toISOString(), undone_at: null });
const detail = (p: BudgetCommandProposal) => ({ transaction_id: p.expected.id, before_category: null, before_value: p.expected.amount, place: p.expected.place, date: p.expected.date });
function fixture(p: BudgetCommandProposal) {
  const state = { receipt: null as BudgetCommandReceipt | null, currency: 'KRW', rows: [original], calls: [] as { table: string; owner: string | null; body?: Record<string, unknown> }[], failRead: false, failRpc: false };
  const db = createClient('http://127.0.0.1:54321', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split('/').pop()!;
    state.calls.push({ table, owner: url.searchParams.get('user_id'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (table === 'budget_category_changes' && state.failRead) return new Response(JSON.stringify({ message: 'synthetic read failure' }), { status: 503 });
    if (table === 'change_budget_expense_fields') {
      if (state.failRpc) return new Response(JSON.stringify({ code: 'P0001', message: '기록이 다른 곳에서 변경되었습니다.' }), { status: 409 });
      state.receipt = receipt(p); return new Response(JSON.stringify({ count: 1, reused: false, undone: false }));
    }
    const data = table === 'budget_user_settings' ? [{ currency: state.currency }]
      : table === 'budget_category_changes' ? state.receipt ? [state.receipt] : []
      : table === 'budget_category_change_items' ? state.receipt ? [detail(p)] : []
      : table === 'budget_transactions' ? state.rows : [];
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } } });
  return { db, state };
}

test('amount commands resolve one explicit date, merchant and integer without confusing merchant digits', () => {
  assert.deepEqual(parseBudgetAmountCommand('가계부 오늘 GS25 지출 금액을 5,000원으로 수정해줘', '2026-09-15'), { date: '2026-09-15', place: 'GS25', amount: 5000 });
  assert.equal(parseBudgetAmountCommand('어제 합성 카페 지출 4500원으로 변경해주세요', '2026-01-01').date, '2025-12-31');
  assert.equal(parseBudgetAmountCommand('그제 합성 카페 지출 4500원으로 변경해줘', '2026-03-01').date, '2026-02-27');
});
test('uncertain amounts, missing dates, multiple changes and nonexistent dates do not become proposals', () => {
  for (const text of ['가계부 편의점 지출 금액을 5000원으로 수정해줘', '오늘 편의점 지출 5,00원으로 수정해줘', '오늘 편의점 지출 -1원으로 수정해줘', '오늘 편의점 지출 0원으로 수정해줘', '오늘 편의점 지출 1.5원으로 수정해줘', '오늘 편의점 지출 9007199254740992원으로 수정해줘', '2026-02-30 편의점 지출 5000원으로 수정해줘', '오늘 편의점 지출 1000원으로 수정해줘 그리고 삭제해줘']) assert.throws(() => parseBudgetAmountCommand(text, '2026-09-15'));
});
test('a budget draft restores exact reviewed values and rejects another owner or malformed amount', () => {
  const p = proposal(), raw = JSON.stringify({ ownerId: owner, drafts: [{ proposal: p, attempted: true }] });
  assert.deepEqual(readCommandDrafts(raw, owner)[0].proposal, p);
  assert.deepEqual(readCommandDrafts(raw, randomUUID()), []);
  assert.equal(isBudgetCommandProposal({ ...p, amount: '4500' }), false);
  assert.throws(() => readCommandDrafts(JSON.stringify({ ownerId: owner, drafts: [{ proposal: { ...p, expected: { ...p.expected, user_id: randomUUID() } }, attempted: false }] }), owner));
});
test('proposal selection refuses ambiguous and foreign currency records without mutation', async () => {
  const p = proposal(), { db, state } = fixture(p), target = { date: original.date, place: original.place, amount: p.amount };
  const proposed = await proposeBudgetAmount(db, owner, target);
  assert.equal(proposed.expected.id, transactionId); assert.equal(proposed.amount, 4500);
  state.rows = [original, original]; await assert.rejects(proposeBudgetAmount(db, owner, target), /여러 건/);
  state.rows = []; await assert.rejects(proposeBudgetAmount(db, owner, target), /찾지 못/);
  state.currency = 'JPY'; await assert.rejects(proposeBudgetAmount(db, owner, target), /원화/);
  assert.equal(state.calls.filter(c => c.table === 'change_budget_expense_fields').length, 0);
});
test('apply uses the reviewed original and returns the same saved receipt on repeat without a second mutation', async () => {
  const p = proposal(), { db, state } = fixture(p);
  const first = await applyBudgetAmount(db, owner, p); const again = await applyBudgetAmount(db, owner, p);
  assert.deepEqual(again, first);
  const calls = state.calls.filter(c => c.table === 'change_budget_expense_fields'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { p_request_id: p.requestId, p_rows: [{ id: transactionId, expected: original }], p_field: 'amount', p_value: 4500 });
  assert.ok(state.calls.filter(c => c.table !== 'change_budget_expense_fields').every(c => c.owner === `eq.${owner}`));
});
test('expired new requests and changed owners/currency never mutate; expired saved requests only read the receipt', async () => {
  const p = proposal(), { db, state } = fixture(p);
  await assert.rejects(applyBudgetAmount(db, randomUUID(), p), /본인의/); assert.equal(state.calls.length, 0);
  p.expiresAt = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(applyBudgetAmount(db, owner, p), /확인 시간이/);
  state.receipt = receipt(p); assert.equal((await applyBudgetAmount(db, owner, p)).id, p.requestId);
  state.receipt = null; p.expiresAt = new Date(Date.now() + 900000).toISOString(); state.currency = 'USD';
  await assert.rejects(applyBudgetAmount(db, owner, p), /통화/);
  assert.equal(state.calls.filter(c => c.table === 'change_budget_expense_fields').length, 0);
});
test('failed history lookup is not absence; changed-record RPC error is reported and cannot become success', async () => {
  const p = proposal(), { db, state } = fixture(p); state.failRead = true;
  await assert.rejects(applyBudgetAmount(db, owner, p), /이력을 확인하지/);
  assert.equal(state.calls.filter(c => c.table === 'change_budget_expense_fields').length, 0);
  state.failRead = false; state.failRpc = true;
  await assert.rejects(applyBudgetAmount(db, owner, p), /다른 곳/);
  assert.equal(state.receipt, null);
});
test('request collisions cannot report unrelated receipts as this change', async () => {
  const p = proposal(), { db, state } = fixture(p); state.receipt = { ...receipt(p), field_value: 9999 };
  assert.equal(matchesBudgetReceipt(p, state.receipt, [detail(p)]), false);
  await assert.rejects(applyBudgetAmount(db, owner, p), /이미 사용한/);
  assert.equal(state.calls.filter(c => c.table === 'change_budget_expense_fields').length, 0);
});
