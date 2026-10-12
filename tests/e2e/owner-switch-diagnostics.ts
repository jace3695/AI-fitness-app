import type { BrowserContext, Page } from '@playwright/test';
import type { State, Traffic } from './fixture';
import { failureLabel } from './navigation-diagnostics';
import { STORAGE_OWNER_KEY, STORAGE_SESSION_KEY, STORAGE_READY_KEY, STORAGE_PROTOCOL_KEY, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME } from '../../app/data/storageTransaction';
import { OWNER_SYNC_DIAGNOSTIC_EVENT, OWNER_SYNC_DIAGNOSTIC_SCHEMA, projectOwnerSyncDiagnostic } from '../../app/data/ownerSyncDiagnostics';

export type OwnerSwitchPhase = 'owner-a-ready' | 'holder-a-ready' | 'lock-held' | 'edit-queued' | 'signout-clicked'
  | 'owner-cleared' | 'lock-released' | 'signed-out' | 'before-b-login' | 'after-b-login' | 'owner-b-ready'
  | 'isolation-verified' | 'before-reload' | 'after-reload' | 'complete';
type References = { ownerA: string; ownerB: string; stateA: State; stateB: State; traffic: Traffic };
const lifecycleBuffer = '__yeoniOwnerSyncDiagnosticBuffer';

/** Passive, document-local collection. This init script neither wraps nor calls
 * auth/storage/route APIs, application handlers, or DOM behavior. */
export async function installOwnerSyncDiagnostics(context: BrowserContext): Promise<void> {
  try {
    await context.addInitScript(({ eventName, bufferName, schema }) => {
      try {
        const target = window as unknown as Record<string, unknown>;
        if (Object.hasOwn(target, bufferName)) return;
        const events: Record<string, string | number>[] = [];
        let index = 0, dropped = 0;
        const data = (object: unknown, key: string): unknown => object && typeof object === 'object'
          ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
        // Calling the native accessor avoids custom event.detail getters.
        const readDetail = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail')?.get;
        if (!readDetail) return;
        window.addEventListener(eventName, event => {
          try {
            if (index >= 10000) { dropped = Math.min(10000, dropped + 1); return; }
            const detail: unknown = readDetail.call(event);
            const component = data(detail, 'component'), stage = data(detail, 'stage');
            if (typeof component !== 'string' || !(schema.component as readonly string[]).includes(component)
              || typeof stage !== 'string' || !(schema.stage as readonly string[]).includes(stage)) return;
            const entry: Record<string, string | number> = { index: ++index, component, stage };
            for (const key of ['ownerRelation', 'epochRelation', 'failure', 'proof', 'outcome', 'reason'] as const) {
              const value = data(detail, key);
              if (typeof value === 'string' && (schema[key] as readonly string[]).includes(value)) entry[key] = value;
            }
            const retirementIndex = data(detail, 'retirementIndex');
            if (typeof retirementIndex === 'number' && Number.isInteger(retirementIndex) && retirementIndex >= 1 && retirementIndex <= 10000) entry.retirementIndex = retirementIndex;
            if (events.length === 48) { events.shift(); dropped = Math.min(10000, dropped + 1); }
            events.push(entry);
          } catch { /* Even malformed observations cannot alter application work. */ }
        });
        Object.defineProperty(target, bufferName, { value: Object.freeze({
          drain() { const result = { events: events.splice(0, 48), dropped }; dropped = 0; return result; },
        }) });
      } catch { /* Missing browser facilities only disable diagnostics. */ }
    }, { eventName: OWNER_SYNC_DIAGNOSTIC_EVENT, bufferName: lifecycleBuffer, schema: OWNER_SYNC_DIAGNOSTIC_SCHEMA });
  } catch { /* Preserve the original scenario if installation is unavailable. */ }
}

async function ownerSyncLifecycleDiagnostic(page: Page, phase: OwnerSwitchPhase, tab: 'first' | 'holder', failed: boolean) {
  const report = (value: { events?: unknown[]; dropped?: number; probe?: 'unavailable' }) => {
    try { console.log('QA_OWNER_SYNC_LIFECYCLE ' + JSON.stringify({ phase, tab, failed, ...value })); } catch { /* Output is best effort too. */ }
  };
  try {
    const result = await page.evaluate(bufferName => {
      const buffer = (window as unknown as Record<string, { drain(): { events: unknown[]; dropped: unknown } }>)[bufferName];
      return buffer ? buffer.drain() : null;
    }, lifecycleBuffer);
    if (!result) return;
    // Reproject even our own collector at the logging boundary. Never forward
    // an arbitrary browser object, error, unknown key or a raw identity.
    const events = (Array.isArray(result.events) ? result.events.slice(0, 48) : []).flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const value = (key: string): unknown => Object.getOwnPropertyDescriptor(entry, key)?.value;
      const projected = projectOwnerSyncDiagnostic(value('component'), value('stage'), entry), index = value('index');
      return projected && typeof index === 'number' && Number.isInteger(index) && index >= 1 && index <= 10000 ? [{ index, ...projected }] : [];
    });
    const dropped = typeof result.dropped === 'number' && Number.isInteger(result.dropped) && result.dropped >= 0 && result.dropped <= 10000 ? result.dropped : 0;
    // Eight maximal primitive-only entries fit the existing 4096-byte line cap.
    for (let offset = 0; offset < events.length || (offset === 0 && dropped > 0); offset += 8) {
      report({ events: events.slice(offset, offset + 8), dropped: offset === 0 ? dropped : 0 });
    }
  } catch {
    report({ probe: 'unavailable' });
  }
}

/** Read-only, best-effort observations, not an atomic snapshot or recovery authority.
 * Never acquire the deliberately held lock or log identity, record, token or DOM text. */
export async function ownerSwitchDiagnostic(page: Page, phase: OwnerSwitchPhase, refs: References, tab: 'first' | 'holder' = 'first', failed = false) {
  try {
    const state = await page.evaluate(async ({ ownerA, ownerB, stateA, stateB, keys }) => {
      const identity = (value: unknown) => value === null || value === undefined ? 'none' : value === ownerA ? 'A' : value === ownerB ? 'B' : 'other';
      const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
      const raw = (key: string) => localStorage.getItem(key);
      const epochRaw = raw(keys.session), epoch = JSON.parse(epochRaw ?? 'null');
      const ready = JSON.parse(raw(keys.ready) ?? 'null');
      const journal = JSON.parse(raw(keys.protocol) ?? 'null');
      const local = Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('ai-fitness-')).map(key => {
        const value = raw(key)!; try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
      }));
      const text = document.body.textContent ?? '';
      const labels = [...document.querySelectorAll('p')].map(node => node.textContent?.trim());
      const hunger = document.querySelector<HTMLSelectElement>('#diet-hunger');
      const email = document.querySelector('input[type="email"]');
      const lock = navigator.locks ? await navigator.locks.query() : null;
      return {
        visibility: document.visibilityState === 'visible' ? 'visible' : 'hidden',
        authGate: text.includes('로그인 확인을 완료하지 못했어요') ? 'failed' : email ? 'login' : hunger ? 'editor' : 'pending',
        sync: labels.includes('서버 반영 완료') ? 'synced' : labels.includes('기록 동기화 실패') ? 'error'
          : labels.includes('기록 충돌 · 선택 필요') ? 'conflict' : labels.includes('기록 동기화 중…') ? 'syncing'
            : labels.includes('기기 기록 · 서버 반영 대기') ? 'pending' : 'absent',
        owner: identity(raw(keys.owner)), desiredOwner: identity(epoch?.userId), readyOwner: identity(ready?.userId),
        readyMatchesEpoch: Boolean(ready && ready.epoch === epochRaw),
        localEmpty: Object.keys(local).length === 0, localMatchesA: canonical(local) === canonical(stateA), localMatchesB: canonical(local) === canonical(stateB),
        editorPrivate: Boolean(hunger?.closest('[hidden], [inert]')), editorPresent: Boolean(hunger),
        lockHeld: lock ? lock.held?.filter(item => item.name === keys.lock).length ?? 0 : null,
        lockPending: lock ? lock.pending?.filter(item => item.name === keys.lock).length ?? 0 : null,
        protocolState: !journal ? 'absent' : journal.state === 'prepared' ? 'prepared' : journal.state === 'committed' ? 'committed' : 'other',
        legacyPresent: raw(keys.legacy) !== null,
        sessionChangedNotice: text.includes('다른 창에서 로그인 상태가 변경되었습니다'),
      };
    }, { ownerA: refs.ownerA, ownerB: refs.ownerB, stateA: refs.stateA, stateB: refs.stateB,
      keys: { owner: STORAGE_OWNER_KEY, session: STORAGE_SESSION_KEY, ready: STORAGE_READY_KEY, protocol: STORAGE_PROTOCOL_KEY, legacy: STORAGE_JOURNAL_KEY, lock: STORAGE_LOCK_NAME } });
    const reads = refs.traffic.entries.filter(entry => entry.table === 'user_app_state' && entry.method === 'GET');
    const last = reads.at(-1);
    console.log('QA_OWNER_SWITCH_STATE ' + JSON.stringify({ phase, tab, failed, ...state,
      reads: reads.length, writes: refs.traffic.entries.filter(entry => entry.table === 'user_app_state' && entry.method !== 'GET').length,
      lastReadOwner: !last ? 'none' : last.owner === refs.ownerA ? 'A' : last.owner === refs.ownerB ? 'B' : 'other',
      lastReadResult: !last ? 'absent' : last.status === 0 ? 'pending' : last.status === 200 && last.delivered ? 'ok' : 'not-confirmed',
    }));
  } catch (error) {
    // Diagnostics never replace the original assertion or retry authentication.
    console.log('QA_OWNER_SWITCH_STATE ' + JSON.stringify({ phase, tab, failed, probe: 'unavailable', failure: failureLabel(error instanceof Error ? error.message : '') }));
  } finally {
    await ownerSyncLifecycleDiagnostic(page, phase, tab, failed);
  }
}
