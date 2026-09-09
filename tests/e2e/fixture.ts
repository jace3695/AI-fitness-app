import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export { expect };
export type State = Record<string, unknown>;
const oldDay = '2001-01-02';
export const original: State = {
  'ai-fitness-workout-completed-days': { [oldDay]: { workoutStatus: 'completed', workoutMemo: 'CI original workout', exerciseRecords: [{ exerciseName: 'CI squat', sets: [{ reps: 3 }, { reps: 3 }] }] } },
  'ai-fitness-workout-direction-backup': { savedAt: '2001-01-02T00:00:00.000Z', selectedPlanId: 'ci-original', settings: { marker: 'keep' } },
  'ai-fitness-user-workout-settings': { dayRoutineEdits: {}, exerciseTargets: {} },
  'ai-fitness-daily-notes': { [oldDay]: 'CI original note' },
  'ai-fitness-weight-records': { [oldDay]: { weight: 70, recordedAt: '2001-01-02T00:00:00.000Z' } },
  'ai-fitness-inbody-records': { [oldDay]: { weight: 70, memo: 'CI original' } },
  'ai-fitness-weight-goal': { minKg: 65, maxKg: 67 },
  'ai-fitness-daily-condition': {},
  'ai-fitness-recovery-mode-days': {},
  'ai-fitness-diet-start-date': '2026-08-24',
  'ai-fitness-diet-phase': 'week1',
  'ai-fitness-diet-completed-days': { [oldDay]: { dietStatus: 'normal', dietMemo: 'CI original meal' } },
  'ai-fitness-water-intake': { [oldDay]: 1000 },
  'ai-fitness-diet-meal-log': {},
  'ai-fitness-protein-total': { [oldDay]: 80 },
  'ai-fitness-fasting-mode': 'auto',
  'ai-fitness-diet-symptoms': {},
};
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

type Entry = { method: string; started: number; received: number; status: number; cas: boolean; matched?: boolean; sent?: State; receivedState?: State; synthetic?: boolean; delivered?: boolean };
type Hold = { method: string; phase: 'request' | 'response' | 'loss'; arrived: () => void; wait: Promise<void> };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export class Traffic {
  entries: Entry[] = [];
  blockedOrigins = new Set<string>();
  failReads = false;
  private next?: Hold;
  private releases: (() => void)[] = [];
  holdNext(method: string, phase: Hold['phase']) {
    if (this.next) throw new Error('A hold is already armed');
    const arrived = deferred(); const release = deferred();
    this.releases.push(release.resolve);
    this.next = { method, phase, arrived: arrived.resolve, wait: release.promise };
    return { arrived: arrived.promise, release: release.resolve };
  }
  releaseAll() { this.releases.forEach(release => release()); this.next = undefined; this.failReads = false; }
  async install(context: BrowserContext) {
    await context.route('**/*', async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['http://127.0.0.1:3000', 'http://127.0.0.1:54321'].includes(url.origin)) {
        this.blockedOrigins.add(url.origin); await route.abort('blockedbyclient'); return;
      }
      if (url.origin !== 'http://127.0.0.1:54321' || url.pathname !== '/rest/v1/user_app_state') {
        await route.continue(); return;
      }
      const method = request.method(); const started = Date.now();
      if (!['GET', 'PATCH', 'POST'].includes(method)) { await route.continue(); return; }
      if (method === 'GET' && this.failReads) {
        this.entries.push({ method, started, received: Date.now(), status: 503, cas: false, synthetic: true, delivered: true });
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'CI injected read failure' }) }); return;
      }
      const hold = this.next?.method === method ? this.next : undefined;
      if (hold) this.next = undefined;
      if (hold?.phase === 'request') { hold.arrived(); await hold.wait; }
      // Genuine HTTP to PostgREST with the browser's authenticated headers.
      const response = await route.fetch({ maxRetries: 0 });
      const body = await response.json().catch(() => null);
      const row = Array.isArray(body) ? body[0] : body;
      const entry: Entry = { method, started, received: Date.now(), status: response.status(), cas: url.searchParams.has('updated_at'),
        ...(method !== 'GET' ? { sent: request.postDataJSON()?.state, matched: Boolean(row) } : {}),
        ...(row?.state ? { receivedState: row.state } : {}) };
      this.entries.push(entry);
      if (hold && hold.phase !== 'request') { hold.arrived(); await hold.wait; }
      if (hold?.phase === 'loss') { entry.delivered = false; await route.abort('failed'); }
      else { entry.delivered = true; await route.fulfill({ response }); }
    });
  }
  assertConfirmed(expected: State) {
    const writes = this.entries.filter(e => e.method === 'PATCH' && e.status === 200 && e.matched && e.delivered && e.sent && canonical(e.sent) === canonical(expected));
    expect(writes.length, 'A real conditional PATCH carrying the expected state').toBeGreaterThan(0);
    expect(writes.every(e => e.cas)).toBe(true);
    expect(this.entries.some(e => e.method === 'GET' && e.status === 200 && e.receivedState && canonical(e.receivedState) === canonical(expected)
      && writes.some(write => e.started >= write.received)), 'A subsequent real confirmation GET has the exact PATCH state').toBe(true);
  }
  safeEvidence() {
    return this.entries.map(e => ({ method: e.method, started: e.started, received: e.received, status: e.status, cas: e.cas,
      synthetic: Boolean(e.synthetic), delivered: e.delivered, matched: e.matched,
      ...(e.sent ? { sentKeys: Object.keys(e.sent).length, sentSha256: digest(e.sent) } : {}),
      ...(e.receivedState ? { receivedKeys: Object.keys(e.receivedState).length, receivedSha256: digest(e.receivedState) } : {}) }));
  }
}

type Account = { id: string; email: string; password: string; client: SupabaseClient };
type Qa = {
  account: Account; traffic: Traffic;
  createAccount: () => Promise<Account>;
  read: (account?: Account) => Promise<State>;
};
export const test = base.extend<{ qa: Qa }>({
  qa: async ({ context }, runTest, testInfo) => {
    const status = JSON.parse(readFileSync('.e2e/stack-status.json', 'utf8'));
    if (status.API_URL !== 'http://127.0.0.1:54321' || process.env.YEONI_E2E !== '1') throw new Error('Non-isolated target refused');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
    const accounts: Account[] = [];
    const traffic = new Traffic();
    await traffic.install(context);
    const createAccount = async () => {
      const email = `qa-${randomUUID()}@example.test`; const password = `Qa-${randomUUID()}!`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Fixture user creation failed: ${error?.code}`);
      const client = createClient(status.API_URL, status.ANON_KEY, options);
      const account = { id: data.user.id, email, password, client }; accounts.push(account);
      const auth = await client.auth.signInWithPassword({ email, password });
      if (auth.error) throw new Error(`Fixture login failed: ${auth.error.code}`);
      const seed = await client.from('user_app_state').insert({ user_id: account.id, state: original });
      if (seed.error) throw new Error(`Fixture seed failed: ${seed.error.code}`);
      return account;
    };
    const read = async (account = accounts[0]): Promise<State> => {
      const { data, error } = await account.client.from('user_app_state').select('state').eq('user_id', account.id).single();
      if (error) throw new Error(`Fixture authenticated read failed: ${error.code}`);
      return data.state;
    };
    let cleaned = false;
    try {
      const account = await createAccount();
      await runTest({ account, traffic, createAccount, read });
    } finally {
      traffic.releaseAll();
      // Stop browser writers before removing the synthetic Auth users. Cascade
      // then removes their rows; verify cleanup even when an assertion fails.
      await context.close();
      for (const account of accounts) {
        const removed = await admin.auth.admin.deleteUser(account.id);
        expect(removed.error, 'Synthetic Auth user cleanup').toBeNull();
        const remaining = await admin.from('user_app_state').select('user_id', { count: 'exact', head: true }).eq('user_id', account.id);
        expect(remaining.error).toBeNull(); expect(remaining.count).toBe(0);
      }
      cleaned = true;
      mkdirSync('.e2e/evidence', { recursive: true });
      writeFileSync(`.e2e/evidence/${testInfo.project.name}-${testInfo.testId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`, JSON.stringify({
        title: testInfo.title, syntheticAccountsRemoved: accounts.length, cleaned, originalKeys: Object.keys(original).length,
        traffic: traffic.safeEvidence(), blockedOrigins: [...traffic.blockedOrigins],
      }, null, 2));
      expect(traffic.blockedOrigins.size, 'No requests to hosted or external origins').toBe(0);
    }
  },
});

export async function login(page: Page, account: Account, path = '/diet/settings') {
  await page.goto(path);
  await page.getByLabel('이메일', { exact: true }).fill(account.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
}
export const synced = async (page: Page) => { await expect(page.getByText('서버 반영 완료', { exact: true })).toBeVisible(); };
export const localState = (page: Page): Promise<State> => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('ai-fitness-')).map(key => {
  const value = localStorage.getItem(key)!; try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
})));
export function assertOriginalPreserved(state: State) {
  // These keys are original snapshots, except the dated stores extended by UI
  // saves. Every pre-existing date/value (including backup.savedAt) must remain.
  const datedStores = ['ai-fitness-diet-completed-days', 'ai-fitness-water-intake', 'ai-fitness-diet-meal-log', 'ai-fitness-protein-total'];
  for (const [key, value] of Object.entries(original)) {
    if (datedStores.includes(key)) expect(state[key], key).toMatchObject(value as Record<string, unknown>);
    else expect(state[key], key).toEqual(value);
  }
}
export async function saveMeal(page: Page, memo: string) {
  await page.getByLabel('메모', { exact: true }).fill(memo);
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect(page.getByText('오늘 식단 기록을 저장했습니다.', { exact: true })).toBeVisible();
}
export const mealMemo = (state: State) => (state['ai-fitness-diet-completed-days'] as Record<string, { dietMemo?: string }> | undefined)?.[today()]?.dietMemo;
