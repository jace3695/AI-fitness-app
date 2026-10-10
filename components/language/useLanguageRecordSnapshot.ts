'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isLanguageRecordContextCurrent, readLanguageRecordSnapshot } from '../../app/data/languageCloudSync.ts';
import type { LanguageBytes, LanguageStorageKey } from '../../app/data/languageStorageBoundary.ts';
import { CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT } from '../../app/data/storageTransaction.ts';
import { RECORD_RESET_EVENT } from '../../app/data/appRecordReset.ts';
import { useLanguageRecords } from './LanguageRecordsProvider.tsx';

const EMPTY: LanguageBytes = Object.freeze({});
/** Coherent source + revision. No raw localStorage fallback or normalization writes. */
export function useLanguageRecordSnapshot(keys?: readonly LanguageStorageKey[]) {
  const { context: recordContext, refresh: refreshRemote } = useLanguageRecords();
  const [revision, setRevision] = useState(0);
  const refreshLocal = useCallback(() => setRevision(value => value + 1), []);
  const keySignature = keys?.join('\0');
  const value = useMemo(() => {
    void revision; // Committed-record events explicitly invalidate the coherent read.
    if (!recordContext) return { snapshot: null, error: '학습 기록을 확인하고 있어요. 입력은 보존됩니다.' };
    try { return { snapshot: readLanguageRecordSnapshot(recordContext, keySignature === undefined ? undefined : keySignature.split('\0') as LanguageStorageKey[]), error: null }; }
    catch (error) { return { snapshot: null, error: error instanceof Error ? error.message : '학습 기록을 읽지 못했습니다. 원본을 보존합니다.' }; }
  }, [recordContext, revision, keySignature]);
  useEffect(() => {
    const signal = recordContext?.signal;
    for (const event of ['storage', RECORDS_CHANGED_EVENT, CLOUD_SESSION_CHANGED_EVENT, RECORD_RESET_EVENT, 'pagehide', 'pageshow']) window.addEventListener(event, refreshLocal);
    document.addEventListener('visibilitychange', refreshLocal);
    signal?.addEventListener('abort', refreshLocal);
    return () => {
      for (const event of ['storage', RECORDS_CHANGED_EVENT, CLOUD_SESSION_CHANGED_EVENT, RECORD_RESET_EVENT, 'pagehide', 'pageshow']) window.removeEventListener(event, refreshLocal);
      document.removeEventListener('visibilitychange', refreshLocal); signal?.removeEventListener('abort', refreshLocal);
    };
  }, [recordContext, refreshLocal]);
  const refresh = useCallback(() => { refreshLocal(); refreshRemote(); }, [refreshRemote, refreshLocal]);
  const current = recordContext && isLanguageRecordContextCurrent(recordContext);
  return { context: current ? recordContext : null, snapshot: current ? value.snapshot : null, records: current ? value.snapshot?.records ?? EMPTY : EMPTY,
    error: current ? value.error : '학습 기록을 다시 확인해 주세요. 입력은 보존됩니다.', refresh };
}
