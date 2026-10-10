import { storageBrowser, storageTab, FIXTURE_OWNER } from './storage-ui-fixture.ts';
import type * as Auth from '../../app/data/authenticatedStorageOwner.ts';
import type * as Language from '../../app/data/languageCloudSync.ts';
import type { LanguageBytes } from '../../app/data/languageStorageBoundary.ts';

/** Synthetic browser; real authenticated boundary, adapter, snapshots and writers. */
export async function languageWriterFixture(seed: LanguageBytes = {}) {
  const browser = storageBrowser(), tab = storageTab(browser, 'language-writer');
  const auth = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof Auth;
  const language = tab.loadModule('app/data/languageCloudSync.ts') as typeof Language;
  const lease = await auth.verifyAuthenticatedStorageOwner(tab.local, async () => ({ data: { user: { id: FIXTURE_OWNER } }, error: null }), tab.cloud.prepareLocalCloudState);
  let lifecycle = language.createLanguageSyncLifecycle();
  const first = await language.commitLanguageSyncResponse(language.readLanguageSyncRequest(lease, lifecycle, tab.local), seed);
  let context: Language.LanguageRecordContext | null = first.context;
  let refreshes = 0;
  tab.setModule('components/language/LanguageRecordsProvider.tsx', { useLanguageRecords: () => ({ context, refresh: () => { refreshes++; } }) });
  const routes: string[] = [];
  tab.setModule('next/navigation', { useRouter: () => ({ push: (href: string) => routes.push(href), replace: (href: string) => routes.push(href), back() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/language' });
  tab.setModule('next/link', { default: 'a' });
  return {
    browser, tab, language, lease, routes,
    get context() { return context!; }, get refreshes() { return refreshes; },
    snapshot() { if (!context) throw new Error('Synthetic language authority unavailable'); return language.readLanguageRecordSnapshot(context); },
    async rotate() {
      const current = language.readLanguageSyncRequest(lease, lifecycle, tab.local);
      context = (await language.commitLanguageSyncResponse(current, current.local)).context;
      return context;
    },
    pause() { lifecycle.revoke(); context = null; tab.dispatch({ type: 'pagehide' }); },
    async resume() {
      lifecycle = language.createLanguageSyncLifecycle();
      const request = language.readLanguageSyncRequest(lease, lifecycle, tab.local);
      context = (await language.commitLanguageSyncResponse(request, request.local)).context;
      tab.dispatch({ type: 'pageshow' }); return context;
    },
    dispose() { lifecycle.revoke(); tab.dispose(); },
  };
}
