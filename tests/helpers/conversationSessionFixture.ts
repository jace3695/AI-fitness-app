import assert from 'node:assert/strict';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab, tick, type UiNode } from './storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../../app/data/authenticatedStorageOwner.ts';
import type { LanguageRecordContext } from '../../app/data/languageCloudSync.ts';
import type { LanguageBytes } from '../../app/data/languageStorageBoundary.ts';

type Row = { state: Record<string, unknown>; updated_at: string };
type SdkResult = { data: Row | { updated_at: string } | null; error: Error | null };
type View = ReturnType<ReturnType<typeof storageTab>['mount']>;

/** Synthetic host and fluent SDK only. AuthGate, LanguageCloudSync, its receive
 * registration, the conversation facade, hook and page all execute shipped code.
 * This is a handler fixture, not evidence of real-browser storage or IME behavior. */
export async function conversationSessionFixture(seed: LanguageBytes = {}, options: { browser?: ReturnType<typeof storageBrowser>; owner?: string; id?: string } = {}) {
  const browser = options.browser ?? storageBrowser(), owner = options.owner ?? FIXTURE_OWNER;
  const tab = storageTab(browser, options.id ?? 'conversation-ui', owner);
  let lease: AuthenticatedStorageOwner | null = null, context: LanguageRecordContext | null = null;
  let refresh = () => {}, remoteRevision = 0;
  const remote = new Map<string, Row>([[owner, { state: { ...seed }, updated_at: 'synthetic-0' }]]);
  const calls: { kind: string; payload: Record<string, unknown>; filters: [string, unknown][]; signal?: AbortSignal }[] = [];
  const audio: { text: string; options: { rate: number; repeatCount: number; repeatDelayMs: number; signal?: AbortSignal } }[] = [];
  const notices: { type: string; detail?: unknown }[] = [], diagnostics: { method: string; values: unknown[] }[] = [];
  const readWaits: ReturnType<typeof deferred<SdkResult>>[] = [];
  let readError: Error | null = null;
  const original = tab.loadModule('app/lib/supabase.ts') as { supabase: { auth: unknown } };
  const sdk = { auth: original.supabase.auth, from(table: string) {
    assert.equal(table, 'language_user_state');
    let kind = 'read', payload: Record<string, unknown> = {}, signal: AbortSignal | undefined;
    const filters: [string, unknown][] = [];
    const execute = async (): Promise<SdkResult> => {
      calls.push({ kind, payload, filters: [...filters], signal });
      const ownerId = kind === 'insert' ? payload.user_id as string : filters.find(([key]) => key === 'user_id')?.[1] as string;
      assert.ok(ownerId); const row = remote.get(ownerId) ?? null;
      if (kind === 'read') return readWaits.shift()?.promise ?? { data: row, error: readError };
      if (kind === 'update' && !filters.some(([key, value]) => key === 'updated_at' && value === row?.updated_at)) return { data: null, error: null };
      const updated = { state: payload.state as Record<string, unknown>, updated_at: `synthetic-${++remoteRevision}` };
      remote.set(ownerId, updated); return { data: { updated_at: updated.updated_at }, error: null };
    };
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      abortSignal(value: AbortSignal) { signal = value; return query; },
      insert(value: Record<string, unknown>) { kind = 'insert'; payload = value; return query; },
      update(value: Record<string, unknown>) { kind = 'update'; payload = value; return query; },
      maybeSingle: execute,
      then(yes: (value: SdkResult) => unknown, no?: (error: unknown) => unknown) { return execute().then(yes, no); },
    }; return query;
  } };
  tab.setModule('app/lib/supabase.ts', { ...tab.loadModule('app/lib/supabase.ts'), supabase: sdk });
  tab.setModule('app/components/AuthenticatedStorageOwner.tsx', { useAuthenticatedStorageOwner: () => lease, AuthenticatedStorageOwnerProvider: 'owner-provider' });
  tab.setModule('components/language/LanguageRecordsProvider.tsx', { LanguageRecordsProvider: 'language-provider', useLanguageRecords: () => ({ context, refresh }) });
  tab.setModule('next/navigation', { useRouter: () => ({ push() {}, replace() {}, back() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/language/conversation' });
  tab.setModule('next/link', { default: 'a' });
  tab.setModule('utils/speakJapanese.ts', { japaneseAudioErrorMessage: () => 'synthetic audio failure', async speakJapaneseWithPreferredTts(text: string, options: typeof audio[number]['options']) { audio.push({ text, options }); } });
  tab.setModule('components/FuriganaText.tsx', { default: 'furigana' });
  tab.setModule('app/lib/authenticatedHeaders.ts', { authenticatedJsonHeaders: async () => { assert.fail('Device-local conversation must not obtain provider credentials'); } });
  tab.setModule('lib/free-mode.ts', { FREE_MODE: true });
  const gate = tab.mount('app/components/AuthGate.tsx', { children: { type: 'synthetic-child', props: {} } });
  await gate.settle();
  const readLease = () => { lease = nodes(gate.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner ?? null; };
  readLease(); assert.ok((lease as AuthenticatedStorageOwner | null)?.isCurrent());
  const sync = tab.mount('components/LanguageCloudSync.tsx', { children: { type: 'synthetic-conversation', props: {} } });
  function syncContext() {
    readLease();
    const provider = nodes(sync.render()).find(node => node.type === 'language-provider');
    context = provider?.props.context as LanguageRecordContext ?? null;
    refresh = provider?.props.refresh as () => void ?? (() => {});
  }
  for (let i = 0; i < 6; i++) { await tick(); syncContext(); }
  const facade = tab.loadModule('app/data/conversationLocalRecords.ts') as typeof import('../../app/data/conversationLocalRecords.ts');
  const language = tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../../app/data/languageCloudSync.ts');
  const participants = tab.loadModule('app/data/languageLocalParticipants.ts') as typeof import('../../app/data/languageLocalParticipants.ts');
  const contracts = tab.loadModule('lib/conversation-session/contracts.ts') as typeof import('../../lib/conversation-session/contracts.ts');
  const mounted: View[] = [];
  function wrap(raw: View): View {
    mounted.push(raw);
    const render = () => { syncContext(); return raw.render(); };
    return { ...raw, render,
      text() { render(); return raw.text(); },
      button(label) { render(); return raw.button(label); },
      click(label) { render(); const result = raw.click(label); syncContext(); return result; },
      async settle(rounds = 6) { for (let i = 0; i < rounds; i++) { await tick(); render(); } return render(); },
    };
  }
  // Event payloads are inspected separately from the storage bytes they notify.
  const originalDispatch = tab.dispatch;
  const observe = (event: { type: string; detail?: unknown }) => notices.push({ type: event.type, detail: event.detail });
  // The public host dispatch remains synthetic; production notices are captured
  // by a listener installed through the same window seen by shipped modules.
  const observerPath = 'tests/helpers/conversationSessionNoticeListener.ts';
  const observer = tab.loadModule(observerPath) as { install(callback: typeof observe): () => void; failNextNotification(): () => void; captureDiagnostics(record: (method: string, values: unknown[]) => void): () => void };
  const unobserve = observer.install(observe), untrace = observer.captureDiagnostics((method, values) => diagnostics.push({ method, values }));
  return {
    browser, tab, gate, sync, facade, language, participants, contracts, calls, audio, notices, diagnostics,
    failNextNotification: observer.failNextNotification,
    get lease() { return lease!; }, get context() { syncContext(); assert.ok(context, sync.text()); return context; },
    snapshot() { syncContext(); assert.ok(context, sync.text()); return facade.readConversationSnapshot(context); },
    mountPage() {
      syncContext();
      // The page's free/paid entry wrapper returns a component; execute the real
      // free component and its pure recap in the same synthetic hook runtime.
      const expand = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(expand);
        if (!value || typeof value !== 'object' || !('props' in value)) return value;
        const node = value as UiNode;
        if (typeof node.type === 'function') return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props.children) } };
      };
      return wrap(tab.mount('app/language/conversation/page.tsx', {}, () => {
        const page = tab.loadModule('app/language/conversation/page.tsx') as { default(): UiNode };
        return expand(page.default()) as UiNode;
      }));
    },
    mountHook<T>(hook: () => T) { let current!: T; const view = wrap(tab.mount('synthetic-hook', {}, () => { current = hook(); return { type: 'synthetic-hook', props: {} }; })); return { view, get current() { view.render(); return current; } }; },
    pause() { originalDispatch({ type: 'pagehide' }); syncContext(); },
    async resume() { originalDispatch({ type: 'pageshow' }); for (let i = 0; i < 6; i++) { await tick(); syncContext(); } },
    async refresh() { originalDispatch({ type: 'focus' }); for (let i = 0; i < 6; i++) { await tick(); syncContext(); } },
    async switchOwner(next: string | null) { tab.emitAuth(next ? 'SIGNED_IN' : 'SIGNED_OUT', next); syncContext(); await tick(); tab.flushTimers(); for (let i = 0; i < 8; i++) { await tick(); syncContext(); } },
    setRemote(state: Record<string, unknown>, ownerId = lease!.userId) { remote.set(ownerId, { state, updated_at: `synthetic-${++remoteRevision}` }); },
    remoteState(ownerId = lease!.userId) { return remote.get(ownerId)?.state; },
    failRead(error = new Error('synthetic language read failure')) { readError = error; },
    holdRead() { const hold = deferred<SdkResult>(); readWaits.push(hold); return hold; },
    dispose() { untrace(); unobserve(); mounted.forEach(view => view.dispose()); sync.dispose(); gate.dispose(); tab.dispose(); },
  };
}
