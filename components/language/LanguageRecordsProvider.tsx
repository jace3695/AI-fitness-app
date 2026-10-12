'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { isLanguageRecordContextCurrent, type LanguageRecordContext } from '../../app/data/languageCloudSync.ts';

type LanguageRecordsAccess = { context: LanguageRecordContext | null; refresh: () => void };
const unavailable: LanguageRecordsAccess = { context: null, refresh: () => {} };
const LanguageRecordsContext = createContext<LanguageRecordsAccess>(unavailable);

/** Only the coordinator supplies this exact registered capability. */
export function LanguageRecordsProvider({ context, refresh, children }: LanguageRecordsAccess & { children: ReactNode }) {
  const value = useMemo(() => ({ context, refresh }), [context, refresh]);
  return <LanguageRecordsContext.Provider value={value}>{children}</LanguageRecordsContext.Provider>;
}
export function useLanguageRecords(): LanguageRecordsAccess {
  const value = useContext(LanguageRecordsContext);
  return { context: value.context && isLanguageRecordContextCurrent(value.context) ? value.context : null, refresh: value.refresh };
}
