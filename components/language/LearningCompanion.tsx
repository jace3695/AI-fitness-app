"use client";

import type { ReactNode, Ref } from "react";
import { useYeoniPreferences } from "@/components/useYeoniPreferences";
import YeoniMascot, { type YeoniAction, type YeoniMotion } from "@/components/YeoniMascot";
import styles from "./learning-focus.module.css";

export default function LearningCompanion({ children, hidden = false, action = "idle", motionKey, motion = "once", anchorRef }: {
  children: ReactNode; hidden?: boolean; action?: YeoniAction; motionKey?: string | number;
  motion?: YeoniMotion;
  anchorRef?: Ref<HTMLElement>;
}) {
  const preferences = useYeoniPreferences();
  const hideCharacter = hidden || !preferences.visible;
  return <aside ref={anchorRef} className={hideCharacter ? styles.quietGuide : styles.companion} aria-label="연이의 학습 안내">
    {!hideCharacter && <YeoniMascot action={action} motionKey={motionKey} motion={motion} />}
    <div className={styles.bubble}>
      {!hideCharacter && <span className={styles.guideName}>연이</span>}<p>{children}</p>
    </div>
  </aside>;
}
