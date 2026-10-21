"use client";

import { memo, useEffect, type ReactNode } from "react";
import YeoniMascot, { type YeoniAction } from "./YeoniMascot";
import { useYeoniPreferences } from "./useYeoniPreferences";
import styles from "./app-companion.module.css";
import { useCommonCharacterHost } from './yeoni/CommonCharacterContext';

function AppCompanion({ children, compact = false, home = false, action = "idle", quiet = false, embedded = false }: {
  children: ReactNode;
  compact?: boolean;
  home?: boolean;
  action?: YeoniAction;
  quiet?: boolean;
  embedded?: boolean;
}) {
  const preferences = useYeoniPreferences();
  const host = useCommonCharacterHost();
  useEffect(() => { if (quiet && host) return host.requestQuiet(); }, [host, quiet]);
  return <aside className={styles.guide} data-compact={compact} data-home={home} data-embedded={embedded} data-character={preferences.visible && !host} aria-label="연이의 안내">
    {preferences.visible && <YeoniMascot action={action} motionKey={typeof children === "string" ? children : ""} motion={quiet ? "off" : home ? "ambient" : "once"} />}
    <div className={styles.bubble}><span className={styles.name}>연이</span><p>{children}</p></div>
  </aside>;
}

export default memo(AppCompanion);
