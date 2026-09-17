import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import type { GrowthResourceRow } from './growthPlatform.ts';
import { confirmResourceUsage, resourceToday, resourceUsage, saveResourceUsage, validResourceUsageDate } from './growthResourceUsage.ts';

test('활용일은 한국 자정 경계와 윤년·30일 경계를 따른다', () => {
  assert.equal(resourceToday(new Date('2026-09-16T14:59:59Z')), '2026-09-16');
  assert.equal(resourceToday(new Date('2026-09-16T15:00:00Z')), '2026-09-17');
  assert.equal(resourceUsage('2024-02-29', '2024-03-29').kind, 'recent');
  assert.equal(resourceUsage('2024-02-29', '2024-03-30').kind, 'revisit');
  assert.equal(resourceUsage('2026-09-17', '2026-09-17').days, 0);
});

test('미기록·잘못된 날짜를 오래 쓰지 않은 자료로 추정하지 않는다', () => {
  for (const value of [undefined, null, '', '2026-02-30', '2026-9-1', '2026-09-18', '1899-12-31']) {
    assert.equal(resourceUsage(value, '2026-09-17').kind, 'unknown');
  }
  for (const value of ['2026-02-29', '2026-09-18', '2026-09-17T01:00:00Z', 'infinity', '']) {
    assert.equal(validResourceUsageDate(value, '2026-09-17'), false);
  }
  assert.equal(validResourceUsageDate(null, '2026-09-17'), true);
  assert.equal(validResourceUsageDate('2024-02-29', '2026-09-17'), true);
});

const row: GrowthResourceRow = { id: 'resource-id', user_id: 'owner-id', routine_id: null, title: '자료', category: 'reference', storage_path: 'owner-id/file.pdf', mime_type: 'application/pdf', size_bytes: 100, classification: 'reference', notes: '보존', last_used_on: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('응답 유실 뒤 읽기 재확인은 쓰기를 반복하지 않고 좁은 변경과 원본 조건을 유지한다', async () => {
  const methods: string[] = [];
  let failRead = true;
  const client = createClient('http://localhost:9999', 'test-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; methods.push(method);
    assert.equal(url.searchParams.get('user_id'), 'eq.owner-id');
    assert.equal(url.searchParams.get('id'), 'eq.resource-id');
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body).sort(), ['last_used_on', 'updated_at']);
      assert.equal(body.last_used_on, '2026-01-02');
      assert.equal(url.searchParams.get('last_used_on'), 'is.null');
      assert.equal(url.searchParams.get('updated_at'), `eq.${row.updated_at}`);
      throw new TypeError('response lost after commit');
    }
    if (failRead) return new Response('offline', { status: 503 });
    return response([{ ...row, last_used_on: '2026-01-02' }]);
  } } });
  assert.equal((await saveResourceUsage(client, row.user_id, row, '2026-01-02')).kind, 'uncertain');
  failRead = false;
  const confirmed = await confirmResourceUsage(client, row.user_id, row.id, '2026-01-02');
  assert.equal(confirmed.kind, 'confirmed');
  assert.equal(methods[0], 'PATCH');
  assert.equal(methods.filter(method => method === 'PATCH').length, 1);
  assert.ok(methods.slice(1).every(method => method === 'GET'));
  assert.ok(methods.length >= 3); // The SDK may retry reads; it must not retry writes.
  if ('row' in confirmed) assert.equal(confirmed.row.storage_path, row.storage_path);
});

test('다른 변경·삭제를 구분하고 잘못된 입력·소유자·미적용 스키마에는 쓰지 않는다', async () => {
  let calls = 0; let stored: GrowthResourceRow[] = [{ ...row, last_used_on: '2026-01-03' }];
  const client = createClient('http://localhost:9999', 'test-key', { auth: { persistSession: false }, global: { fetch: async () => { calls++; return response(stored); } } });
  assert.equal((await saveResourceUsage(client, 'other-owner', row, null)).kind, 'invalid');
  const oldSchema = { ...row }; delete oldSchema.last_used_on;
  assert.equal((await saveResourceUsage(client, row.user_id, oldSchema, null)).kind, 'invalid');
  assert.equal((await saveResourceUsage(client, row.user_id, row, '9999-12-31')).kind, 'invalid');
  assert.equal(calls, 0);
  assert.equal((await confirmResourceUsage(client, row.user_id, row.id, '2026-01-02')).kind, 'changed');
  stored = [];
  assert.equal((await confirmResourceUsage(client, row.user_id, row.id, null)).kind, 'missing');
});
