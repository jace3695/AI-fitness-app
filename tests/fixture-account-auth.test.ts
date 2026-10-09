import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';
import { reauthenticateFixtureAccount, type FixtureAccount } from './e2e/fixture-account-auth.ts';
import { createLanguageLiveLearningRepository } from '../app/data/languageLiveLearningRepository.ts';
import { LanguageLiveError } from '../lib/language-live/types.ts';

test('installed SDK translates server session_not_found to AuthSessionMissingError without retaining the raw code', async () => {
  let requests = 0;
  const client = createClient('http://127.0.0.1:54321', 'synthetic-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      const request = new Request(input, options);
      assert.equal(request.url, 'http://127.0.0.1:54321/auth/v1/user');
      assert.equal(request.method, 'GET'); requests++;
      return Response.json({ code: 'session_not_found', message: 'Synthetic revoked session' }, {
        status: 403, headers: { 'x-supabase-api-version': '2024-01-01' },
      });
    } },
  });
  const result = await client.auth.getUser('synthetic-revoked-access-token');
  assert.equal(requests, 1); assert.equal(result.data.user, null);
  assert.equal(isAuthSessionMissingError(result.error), true);
  assert.equal(result.error?.name, 'AuthSessionMissingError');
  assert.equal(result.error?.code, undefined, 'server code is normalized to the SDK error class');
});

test('global logout revokes an independent fixture session; explicit fresh authentication restores repository verification', async () => {
  const id = randomUUID();
  const user = { id, email: 'synthetic-verifier@example.test', aud: 'authenticated', role: 'authenticated', created_at: '2026-10-09T00:00:00Z', app_metadata: {}, user_metadata: {} };
  const sessions = new Set<string>(), issued = new Set<string>();
  const calls: string[] = [];
  let sequence = 0;
  // The real installed SDK uses a completely synthetic, in-memory transport.
  // Model Auth session revocation separately from an unexpired PostgREST JWT.
  const fetcher: typeof fetch = async (input, options) => {
    const request = new Request(input, options), url = new URL(request.url);
    assert.equal(url.origin, 'http://127.0.0.1:54321');
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.searchParams.get('grant_type'), 'password');
      assert.deepEqual(await request.json(), { email: user.email, password: 'synthetic-fixture-password', gotrue_meta_security: {} });
      const access = `synthetic-access-${++sequence}`;
      sessions.add(access); issued.add(access);
      return Response.json({ access_token: access, refresh_token: `synthetic-refresh-${sequence}`, expires_in: 3600, token_type: 'bearer', user });
    }
    if (url.pathname === '/auth/v1/logout') {
      assert.equal(url.searchParams.get('scope'), 'global');
      assert.ok(sessions.has(token));
      sessions.clear();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/user') {
      return sessions.has(token) ? Response.json(user)
        : Response.json({ code: 'session_not_found', message: 'Synthetic revoked session' }, { status: 403, headers: { 'x-supabase-api-version': '2024-01-01' } });
    }
    if (url.pathname === '/rest/v1/rpc/read_language_live_learning') {
      assert.ok(issued.has(token));
      assert.deepEqual(await request.json(), { p_expected_owner: id });
      return Response.json({ ownerId: id, lessons: [], batches: [] });
    }
    throw new Error('Unexpected synthetic authentication endpoint');
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } };
  const verifier = createClient('http://127.0.0.1:54321', 'synthetic-anon-key', options);
  const browser = createClient('http://127.0.0.1:54321', 'synthetic-anon-key', options);
  const account = { id, email: user.email, password: 'synthetic-fixture-password', client: verifier };
  await reauthenticateFixtureAccount(account);
  assert.equal((await browser.auth.signInWithPassword({ email: account.email, password: account.password })).error, null);
  const repository = createLanguageLiveLearningRepository(verifier, id);
  assert.deepEqual(await repository.readLearning(), { ownerId: id, lessons: [], batches: [] });
  assert.equal((await browser.auth.signOut()).error, null);
  const beforeRejectedRead = calls.length;
  await assert.rejects(repository.readLearning(), error => error instanceof LanguageLiveError && error.code === 'unauthenticated');
  assert.deepEqual(calls.slice(beforeRejectedRead), ['GET /auth/v1/user'], 'revoked verifier is stopped before the repository RPC');
  assert.equal((await browser.auth.signInWithPassword({ email: account.email, password: account.password })).error, null);
  const beforeReauthentication = calls.length;
  await reauthenticateFixtureAccount(account);
  assert.deepEqual(calls.slice(beforeReauthentication), ['POST /auth/v1/token?grant_type=password', 'GET /auth/v1/user']);
  assert.deepEqual(await repository.readLearning(), { ownerId: id, lessons: [], batches: [] });
  assert.equal((await browser.auth.getUser()).data.user?.id, id, 'fixture login leaves the independently signed-in browser valid');
});

test('fixture authentication rejects sign-in errors, absent sessions, wrong owners and failed authoritative identity checks', async () => {
  const id = randomUUID(), other = randomUUID();
  const good = { data: { user: { id }, session: { user: { id } } }, error: null };
  for (const signIn of [
    { ...good, error: { message: 'sensitive provider details' } },
    { ...good, data: { ...good.data, user: null } },
    { ...good, data: { ...good.data, session: null } },
    { ...good, data: { ...good.data, user: { id: other } } },
    { ...good, data: { ...good.data, session: { user: { id: other } } } },
  ]) {
    let verified = false;
    const account = { id, email: 'synthetic@example.test', password: 'synthetic', client: { auth: {
      signInWithPassword: async () => signIn,
      getUser: async () => { verified = true; return { data: { user: { id } }, error: null }; },
    } } } as unknown as FixtureAccount;
    await assert.rejects(reauthenticateFixtureAccount(account), { message: 'Fixture verifier sign-in failed or returned a different owner' });
    assert.equal(verified, false);
  }
  for (const result of [
    { data: { user: { id } }, error: { message: 'sensitive provider details' } },
    { data: { user: null }, error: null },
    { data: { user: { id: other } }, error: null },
  ]) {
    const account = { id, email: 'synthetic@example.test', password: 'synthetic', client: { auth: {
      signInWithPassword: async () => good, getUser: async () => result,
    } } } as unknown as FixtureAccount;
    await assert.rejects(reauthenticateFixtureAccount(account), { message: 'Fixture verifier authenticated owner check failed' });
  }
});
