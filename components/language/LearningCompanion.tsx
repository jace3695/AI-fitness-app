import type { ReactNode } from "react";
import YeoniMascot, { type YeoniAction } from "@/components/YeoniMascot";
import styles from "./learning-focus.module.css";

export default function LearningCompanion({ children, hidden = false, action = "idle", motionKey }: {
  children: ReactNode; hidden?: boolean; action?: YeoniAction; motionKey?: string | number;
}) {
  return <aside className={hidden ? styles.quietGuide : styles.companion} aria-label="연이의 학습 안내">
    {!hidden && <YeoniMascot action={action} motionKey={motionKey} />}
    <div className={styles.bubble}>{!hidden && <span className={styles.guideName}>연이와 함께</span>}<p>{children}</p></div>
  </aside>;
}
