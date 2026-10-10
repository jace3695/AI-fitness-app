import type { Page } from '@playwright/test';
import type { State, Traffic } from './fixture';
import { failureLabel } from './navigation-diagnostics';
import { STORAGE_OWNER_KEY, STORAGE_SESSION_KEY, STORAGE_READY_KEY, STORAGE_PROTOCOL_KEY, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME } from '../../app/data/storageTransaction';

export type OwnerSwitchPhase = 'owner-a-ready' | 'holder-a-ready' | 'lock-held' | 'edit-queued' | 'signout-clicked'
  | 'owner-cleared' | 'lock-released' | 'signed-out' | 'before-b-login' | 'after-b-login' | 'owner-b-ready'
  | 'isolation-verified' | 'before-reload' | 'after-reload' | 'complete';
type References = { ownerA: string; ownerB: string; stateA: State; stateB: State; traffic: Traffic };

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
  }
}
