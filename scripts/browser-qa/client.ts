// Only the local QA bundle resolves Supabase imports here. No real credentials.
const user = { id: 'fixture-user', email: 'fixture@example.invalid' };
export const isSupabaseConfigured = true;
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ error: null, data: { session: null } }),
  },
  from(table: string) {
    let method = 'GET';
    let payload: unknown;
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      update: (value: unknown) => { method = 'PATCH'; payload = value; return query; },
      insert: (value: unknown) => { method = 'POST'; payload = value; return query; },
      async maybeSingle() {
        const response = await fetch('/api/fixture/state', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table, method, payload, filters }),
        });
        const result = await response.json();
        return { data: result.data, error: result.error ? new Error(result.error) : null };
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return query.maybeSingle().then(resolve, reject);
      },
    };
    return query;
  },
};
export const authenticatedFetch = async () => new Response(JSON.stringify({ history: [] }), { headers: { 'Content-Type': 'application/json' } });
