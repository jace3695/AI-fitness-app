import type { ReactNode, Ref } from "react";
import YeoniMascot, { type YeoniAction, type YeoniMotion } from "@/components/YeoniMascot";
import styles from "./learning-focus.module.css";

export default function LearningCompanion({ children, hidden = false, action = "idle", motionKey, motion = "once", anchorRef }: {
  children: ReactNode; hidden?: boolean; action?: YeoniAction; motionKey?: string | number;
  motion?: YeoniMotion;
  anchorRef?: Ref<HTMLElement>;
}) {
  return <aside ref={anchorRef} className={hidden ? styles.quietGuide : styles.companion} aria-label="연이의 학습 안내">
    {!hidden && <YeoniMascot action={action} motionKey={motionKey} motion={motion} />}
    <div className={styles.bubble}>
      {!hidden && <span className={styles.guideName}>연이</span>}<p>{children}</p>
    </div>
  </aside>;
}
