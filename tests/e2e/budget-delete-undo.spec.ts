import { canonical, expect, login, test, today } from './fixture';

type BudgetCase = {
  table: 'budget_transactions' | 'budget_income' | 'budget_savings';
  label: string;
  kindLabel: string;
  row: Record<string, unknown>;
};

test('expense, income and saving deletion can each restore the exact server row', async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = today();
  const cases: BudgetCase[] = [
    {
      table: 'budget_transactions',
      label: 'P1 합성 편의점',
      kindLabel: '지출',
      row: { user_id: qa.account.id, date, amount: 12340, place: 'P1 합성 편의점', category: '생활용품', payment: '체크카드', transaction_type: '일반 지출', memo: '삭제 복원 전체 대조' },
    },
    {
      table: 'budget_income',
      label: 'P1 합성 수입',
      kindLabel: '수입',
      row: { user_id: qa.account.id, date, amount: 543210, name: 'P1 합성 수입', memo: '삭제 복원 전체 대조' },
    },
    {
      table: 'budget_savings',
      label: 'P1 합성 저축',
      kindLabel: '저축',
      row: { user_id: qa.account.id, date, amount: 45670, goal_name: 'P1 합성 저축', memo: '삭제 복원 전체 대조' },
    },
  ];

  const profile = await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: 'P1 합성 사용자' });
  expect(profile.error).toBeNull();

  const originals = new Map<string, Record<string, unknown>>();
  for (const item of cases) {
    const inserted = await qa.account.client.from(item.table).insert(item.row).select('*').single();
    expect(inserted.error, `${item.kindLabel} fixture seed`).toBeNull();
    originals.set(item.table, inserted.data as Record<string, unknown>);
  }

  await login(page, qa.account, '/budget');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: 'the 390px budget view has no horizontal page overflow',
  }).toBe(true);
  await page.getByRole('navigation', { name: '가계부 주요 메뉴' }).getByRole('button', { name: '상세 내역', exact: true }).click();
  await expect(page.getByRole('heading', { name: '상세 내역', exact: true })).toBeVisible();

  for (const item of cases) {
    const original = originals.get(item.table)!;
    await expect(page.getByText(item.label, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${item.label} 내역 삭제`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '선택한 기록 삭제' });
    await expect(dialog.getByText(/삭제 되돌리기/)).toBeVisible();
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();

    await expect(page.getByRole('button', { name: '삭제 되돌리기', exact: true })).toBeVisible();
    await expect.poll(async () => {
      const result = await qa.account.client.from(item.table).select('*').eq('id', original.id as string);
      if (result.error) throw result.error;
      return result.data?.length ?? -1;
    }, { message: `${item.kindLabel} row was actually deleted` }).toBe(0);

    await page.getByRole('button', { name: '삭제 되돌리기', exact: true }).click();
    await expect(page.getByText(`${item.kindLabel} 내역을 삭제 전 그대로 복원했어요.`, { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const result = await qa.account.client.from(item.table).select('*').eq('id', original.id as string).maybeSingle();
      if (result.error) throw result.error;
      return canonical(result.data);
    }, { message: `${item.kindLabel} row exactly matches the pre-delete server row` }).toBe(canonical(original));
    await expect(page.getByText(item.label, { exact: true })).toBeVisible();
  }
});
