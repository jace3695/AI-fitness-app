import type { SupabaseClient } from '@supabase/supabase-js';

export type FixtureAccount = {
  id: string;
  email: string;
  password: string;
  client: Pick<SupabaseClient, 'auth'>;
};

/**
 * Browser signOut() is global: it also revokes this independent Node session.
 * Renew only the synthetic verifier's session after the browser login succeeds.
 * This does not alter browser storage, bypass repository getUser(), or retry a
 * failed repository operation with a privileged client.
 */
export async function reauthenticateFixtureAccount(account: FixtureAccount): Promise<void> {
  const { data, error } = await account.client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error || data.user?.id !== account.id || data.session?.user.id !== account.id) {
    throw new Error('Fixture verifier sign-in failed or returned a different owner');
  }
  const verified = await account.client.auth.getUser();
  if (verified.error || verified.data.user?.id !== account.id) {
    throw new Error('Fixture verifier authenticated owner check failed');
  }
}
